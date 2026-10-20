import { useState } from 'react';
import { MonthLineChart } from '../components/charts';
import { Field, MoneyInput, MonthInput, NumberInput, TextInput } from '../components/inputs';
import { confirmDiscard, EditActions, EditButton, EditForm, isDraftDirty, SettingsForm, useDraft, useExpanded } from '../components/items';
import { AddButton, Card, Empty, PageHeader, Status } from '../components/ui';
import { addMonths } from '../engine/dates';
import { goalStatus, type GoalStatus } from '../engine/projection';
import { uid } from '../example';
import { useList, usePlan } from '../store';
import { useChartTheme } from '../theme';
import type { Goal } from '../types';

export function Goals() {
  const { plan, setPlan, projection, fmt } = usePlan();
  const goals = useList('goals');
  const expanded = useExpanded();
  const [adding, setAdding] = useState<Goal | null>(null);
  const t = useChartTheme();
  const s = plan.settings;

  const startAdding = () => {
    // Don't throw away a half-filled new goal without asking.
    if (adding && isDraftDirty(adding.id) && !confirmDiscard('Discard the new goal you were adding?')) return;
    setAdding({ id: uid(), name: '', targetAmount: 10_000, targetMonth: addMonths(s.startMonth, 24) });
  };

  return (
    <>
      <PageHeader
        title="Savings & goals"
        subtitle="Goals are milestones for your total savings. Big purchases you’ll actually pay for belong in Expenses as one-offs."
      />

      <Card title="Savings today">
        <SettingsForm
          source={{ startingSavings: s.startingSavings, savingsInterestPct: s.savingsInterestPct }}
          onSave={(v) => setPlan((p) => ({ ...p, settings: { ...p.settings, ...v } }))}
        >
          {(d, patch) => (
            <div className="form-grid">
              <Field label="Current savings" hint={`Balance at the start of ${fmt.month(s.startMonth)}`}>
                <MoneyInput value={d.startingSavings} onChange={(startingSavings) => patch({ startingSavings })} />
              </Field>
              <Field label="Interest on savings (yearly)" hint="Savings account or deposit rate">
                <NumberInput
                  value={d.savingsInterestPct}
                  step={0.25}
                  min={0}
                  max={30}
                  suffix="%"
                  onChange={(savingsInterestPct) => patch({ savingsInterestPct })}
                />
              </Field>
            </div>
          )}
        </SettingsForm>
      </Card>

      <Card title="Goals" actions={<AddButton onClick={startAdding}>Add goal</AddButton>}>
        {adding && (
          <GoalEditor
            key={adding.id}
            goal={adding}
            isNew
            onSave={(g) => {
              goals.add(g);
              setAdding(null);
            }}
            onCancel={() => setAdding(null)}
          />
        )}
        {goals.items.length === 0 && !adding ? (
          <Empty>Add a goal like “Emergency fund – 6 months of expenses” or “Deposit for a new car”.</Empty>
        ) : (
          <div className="item-list">
            {goals.items.map((g) =>
              expanded.isOpen(g.id) ? (
                <GoalEditor
                  key={g.id}
                  goal={g}
                  onSave={(next) => {
                    goals.update(g.id, next);
                    expanded.set(g.id, false);
                  }}
                  onCancel={() => expanded.set(g.id, false)}
                  onDelete={() => {
                    goals.remove(g.id);
                    expanded.set(g.id, false);
                  }}
                />
              ) : (
                <GoalRow key={g.id} status={goalStatus(plan, projection, g)} onEdit={() => expanded.set(g.id, true)} />
              ),
            )}
          </div>
        )}
      </Card>

      <Card title="Projected savings" subtitle="Dots mark your goals">
        <MonthLineChart
          data={projection.rows}
          series={[{ key: 'savings', name: 'Savings', color: t.series[0] }]}
          markers={goals.items.map((g) => ({ month: g.targetMonth, value: g.targetAmount, label: g.name }))}
          height={300}
        />
      </Card>
    </>
  );
}

function GoalRow({ status, onEdit }: { status: GoalStatus; onEdit: () => void }) {
  const { fmt } = usePlan();
  const { goal: g, onTrack, reachedMonth, projectedAtTarget, monthlyGap, beyondHorizon } = status;
  // Past the plan's end we can't tell whether it's reached in time, so don't call it behind.
  const unknown = beyondHorizon && !onTrack;
  return (
    <div className="item-row goal-grid" onDoubleClick={onEdit}>
      <div className="item-main">
        <span className="item-name">{g.name}</span>
        <span className="item-sub">
          {fmt.money(g.targetAmount)} by {fmt.month(g.targetMonth)}
        </span>
      </div>
      <div>
        {unknown ? (
          <span className="status neutral">After the plan ends — make the plan longer to check</span>
        ) : (
          <Status ok={onTrack}>
            {onTrack ? `Reached ${reachedMonth ? fmt.month(reachedMonth) : ''}` : `Save ${fmt.money(monthlyGap)}/mo more`}
          </Status>
        )}
      </div>
      <div className="num muted small">
        {/* Past the plan's end, the projection stops at its last month. */}
        {beyondHorizon ? `At the plan’s end: ${fmt.money(projectedAtTarget)}` : `Projected then: ${fmt.money(projectedAtTarget)}`}
      </div>
      <EditButton onClick={onEdit} label={`Edit ${g.name}`} />
    </div>
  );
}

function GoalEditor({
  goal,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  goal: Goal;
  isNew?: boolean;
  onSave: (g: Goal) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { draft, patch, dirty } = useDraft(goal);
  const error = !draft.name.trim() ? 'Give it a name' : null;
  return (
    <EditForm className="item-editor" error={error} onCancel={onCancel} onSave={() => onSave({ ...draft, name: draft.name.trim() })}>
      {isNew && <div className="editor-title">New goal</div>}
      <div className="form-grid">
        <Field label="Goal">
          <TextInput value={draft.name} autoFocus={isNew} placeholder="e.g. Emergency fund" onChange={(name) => patch({ name })} />
        </Field>
        <Field label="Target savings">
          <MoneyInput value={draft.targetAmount} onChange={(targetAmount) => patch({ targetAmount })} />
        </Field>
        <Field group label="By">
          <MonthInput value={draft.targetMonth} onChange={(v) => v && patch({ targetMonth: v })} />
        </Field>
      </div>
      <EditActions isNew={isNew} dirty={dirty} error={error} onCancel={onCancel} onDelete={onDelete} />
    </EditForm>
  );
}
