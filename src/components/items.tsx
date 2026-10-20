import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { clearDraftDirty, markDraftDirty } from '../drafts';
import { monthlyEquivalent } from '../engine/dates';
import type { Formatters } from '../format';
import { usePlan } from '../store';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Frequency, type YM } from '../types';
import { Field, FREQUENCY_OPTIONS, MoneyInput, MonthInput, Select, TextInput } from './inputs';

export { confirmDiscard, hasUnsavedChanges, isDraftDirty } from '../drafts';

// ---------------------------------------------------------------------------
// Drafts: edits stay local until Save, so totals only change when you mean them to.

/**
 * A local copy of `source` to edit until Save. `key` identifies the item being edited for
 * `isDraftDirty`; it defaults to `source.id`.
 */
export function useDraft<T>(source: T, key?: string) {
  const [draft, setDraft] = useState<T>(source);
  const sourceJson = JSON.stringify(source);
  const dirty = JSON.stringify(draft) !== sourceJson;
  const sourceId = (source as { id?: unknown } | null | undefined)?.id;
  const itemKey = key ?? (typeof sourceId === 'string' ? sourceId : undefined);

  // If the saved value changes underneath (undo, switching plans) and nothing was edited, follow it.
  const previous = useRef(sourceJson);
  useEffect(() => {
    if (previous.current === sourceJson) return;
    const before = previous.current;
    previous.current = sourceJson;
    setDraft((d) => (JSON.stringify(d) === before ? (JSON.parse(sourceJson) as T) : d));
  }, [sourceJson]);

  const editorId = useId();
  useEffect(() => {
    if (!dirty) return;
    markDraftDirty(editorId, itemKey);
    return () => clearDraftDirty(editorId);
  }, [dirty, editorId, itemKey]);

  return {
    draft,
    setDraft,
    patch: (p: Partial<T>) => setDraft((d) => ({ ...d, ...p })),
    dirty,
    reset: () => setDraft(JSON.parse(sourceJson) as T),
  };
}

/** A form that saves on Enter and cancels on Escape. */
export function EditForm({
  onSave,
  onCancel,
  error,
  className = '',
  children,
}: {
  onSave: () => void;
  onCancel: () => void;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      className={`edit-form ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!error) onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      {children}
    </form>
  );
}

export function EditActions({
  isNew,
  dirty,
  error,
  onCancel,
  onDelete,
  sticky,
}: {
  isNew?: boolean;
  dirty: boolean;
  error?: string | null;
  onCancel: () => void;
  onDelete?: () => void;
  sticky?: boolean;
}) {
  return (
    <div className={`edit-actions${sticky ? ' sticky' : ''}`}>
      <button type="submit" className="btn primary" disabled={!!error}>
        {isNew ? 'Add' : 'Save'}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <span className="edit-status" role="status">
        {error ? <span className="neg">{error}</span> : dirty && !isNew ? 'Unsaved changes' : ''}
      </span>
      {onDelete && (
        <button type="button" className="btn danger-ghost" onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  );
}

export function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn ghost small-btn edit-btn" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      Edit
    </button>
  );
}

/** Settings-style form (always open): Save and Cancel appear once something changes. */
export function SettingsForm<T>({
  source,
  onSave,
  children,
}: {
  source: T;
  onSave: (value: T) => void;
  children: (draft: T, patch: (p: Partial<T>) => void) => ReactNode;
}) {
  const { draft, patch, dirty, reset } = useDraft(source);
  // Enter in an untouched form must not save: every save is an undo step.
  const save = () => {
    if (dirty) onSave(draft);
  };
  return (
    <EditForm onSave={save} onCancel={reset}>
      {children(draft, patch)}
      {dirty && <EditActions dirty onCancel={reset} />}
    </EditForm>
  );
}

/** Keeps track of which list items are expanded for editing. */
export function useExpanded() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return {
    isOpen: (id: string) => open.has(id),
    /** Closes every editor. */
    clear: () => setOpen((s) => (s.size ? new Set() : s)),
    set: (id: string, on: boolean) =>
      setOpen((s) => {
        const next = new Set(s);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
  };
}

// ---------------------------------------------------------------------------
// Recurring money items (other income and expenses) share a summary row and editor.

export interface RecurringLike {
  id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  startMonth: YM;
  endMonth?: YM;
  category?: ExpenseCategory;
}

const PER: Record<Frequency, string> = { monthly: '/ month', quarterly: '/ quarter', yearly: '/ year', once: 'once' };

export function periodText(item: Pick<RecurringLike, 'frequency' | 'startMonth' | 'endMonth'>, fmt: Formatters, planStart: YM): string {
  if (item.frequency === 'once') return fmt.month(item.startMonth);
  const short = (m: number) => fmt.monthName(m).slice(0, 3);
  const first = Number(item.startMonth.slice(5));
  const parts: string[] = [];
  if (item.frequency === 'yearly') parts.push(`each ${short(first)}`);
  if (item.frequency === 'quarterly') {
    const months = [0, 3, 6, 9].map((k) => ((first - 1 + k) % 12) + 1).sort((a, b) => a - b);
    parts.push(`each ${months.map(short).join('/')}`);
  }
  if (item.startMonth > planStart) parts.push(`from ${fmt.month(item.startMonth)}`);
  if (item.endMonth) parts.push(`until ${fmt.month(item.endMonth)}`);
  return parts.join(' · ') || 'ongoing';
}

export function RecurringRow({ item, onEdit }: { item: RecurringLike; onEdit: () => void }) {
  const { plan, fmt } = usePlan();
  const ended = !!item.endMonth && item.endMonth < plan.settings.startMonth;
  return (
    <div className={`item-row recurring-grid${ended ? ' ended' : ''}`} onDoubleClick={onEdit}>
      <div className="item-main">
        <span className="item-name">{item.name}</span>
        {item.category && <span className="item-sub">{item.category}</span>}
      </div>
      <div className="num">
        {item.amount < 100 && !Number.isInteger(item.amount) ? fmt.money2(item.amount) : fmt.money(item.amount)}{' '}
        <span className="muted small">{PER[item.frequency]}</span>
      </div>
      <div className="muted small">{ended ? 'ended' : periodText(item, fmt, plan.settings.startMonth)}</div>
      <div className="num muted small">
        {item.frequency === 'once' ? '' : `${fmt.money(monthlyEquivalent(item.amount, item.frequency))}/mo`}
      </div>
      <EditButton onClick={onEdit} label={`Edit ${item.name}`} />
    </div>
  );
}

export function RecurringEditor<T extends RecurringLike>({
  item,
  isNew,
  noun,
  withCategory,
  onSave,
  onCancel,
  onDelete,
}: {
  item: T;
  isNew?: boolean;
  noun: string;
  withCategory?: boolean;
  onSave: (item: T) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { draft, patch, dirty } = useDraft(item);
  const once = draft.frequency === 'once';
  const error = !draft.name.trim()
    ? 'Give it a name'
    : !once && draft.endMonth && draft.endMonth < draft.startMonth
      ? 'It ends before it starts'
      : null;
  return (
    <EditForm
      className="item-editor"
      error={error}
      onCancel={onCancel}
      onSave={() => onSave({ ...draft, name: draft.name.trim(), endMonth: once ? undefined : draft.endMonth })}
    >
      {isNew && <div className="editor-title">New {noun}</div>}
      <div className="form-grid">
        <Field label="Name">
          <TextInput value={draft.name} autoFocus={isNew} onChange={(name) => patch({ name } as Partial<T>)} />
        </Field>
        {withCategory && (
          <Field label="Category">
            <Select
              value={draft.category ?? 'Other'}
              options={EXPENSE_CATEGORIES}
              onChange={(category) => patch({ category } as Partial<T>)}
            />
          </Field>
        )}
        <Field label="Amount">
          <MoneyInput value={draft.amount} onChange={(amount) => patch({ amount } as Partial<T>)} />
        </Field>
        <Field label="How often">
          <Select value={draft.frequency} options={FREQUENCY_OPTIONS} onChange={(frequency) => patch({ frequency } as Partial<T>)} />
        </Field>
        <Field label={once ? 'When' : draft.frequency === 'yearly' ? 'First time (sets the month)' : 'From'}>
          <MonthInput value={draft.startMonth} onChange={(v) => v && patch({ startMonth: v } as Partial<T>)} />
        </Field>
        {!once && (
          <Field label="Until">
            <MonthInput
              value={draft.endMonth}
              optional
              invalid={!!draft.endMonth && draft.endMonth < draft.startMonth}
              onChange={(endMonth) => patch({ endMonth } as Partial<T>)}
            />
          </Field>
        )}
      </div>
      <EditActions isNew={isNew} dirty={dirty} error={error} onCancel={onCancel} onDelete={onDelete} />
    </EditForm>
  );
}
