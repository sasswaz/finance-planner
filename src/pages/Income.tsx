import { useState } from 'react';
import { DeleteButton, Field, MoneyInput, MonthInput, NumberInput, Select, TextInput } from '../components/inputs';
import {
  confirmDiscard,
  EditActions,
  EditButton,
  EditForm,
  isDraftDirty,
  periodText,
  RecurringEditor,
  RecurringRow,
  useDraft,
  useExpanded,
} from '../components/items';
import { AddButton, Card, Empty, PageHeader, Stat } from '../components/ui';
import { addMonths } from '../engine/dates';
import { bonusAmount, salaryAt } from '../engine/projection';
import type { Formatters } from '../format';
import { uid } from '../example';
import { removeById, updateById, useList, usePlan } from '../store';
import type { Bonus, ExtraPayment, Frequency, IncomeItem, Person, YM } from '../types';

export function Income() {
  const { plan, setPlan, projection, fmt } = usePlan();
  const people = useList('people');
  const incomes = useList('incomes');
  const peopleOpen = useExpanded();
  const incomesOpen = useExpanded();
  const [newPerson, setNewPerson] = useState<Person | null>(null);
  const [newIncome, setNewIncome] = useState<IncomeItem | null>(null);
  const next12 = projection.rows.slice(0, 12);
  const sum = (k: 'salary' | 'bonus' | 'otherIncome') => next12.reduce((s, r) => s + r[k], 0);

  const startPerson = () => {
    // Don't throw away a half-filled new person without asking.
    if (newPerson && isDraftDirty(newPerson.id) && !confirmDiscard('Discard the family member you were adding?')) return;
    setNewPerson({
      id: uid(),
      name: people.items.length === 0 ? 'Me' : people.items.length === 1 ? 'Partner' : '',
      netMonthlySalary: 0,
      annualRaisePct: 3,
      bonuses: [],
      salaryChanges: [],
    });
  };

  const startIncome = () => {
    if (newIncome && isDraftDirty(newIncome.id) && !confirmDiscard('Discard the income you were adding?')) return;
    setNewIncome({ id: uid(), name: '', amount: 0, frequency: 'monthly', startMonth: plan.settings.startMonth });
  };

  /** Removes a person together with loan early payments paid from their bonuses, which would otherwise dangle. */
  const removePerson = (person: Person) => {
    const fromBonuses = (x: ExtraPayment) => x.kind === 'bonus' && x.bonusPersonId === person.id;
    const linked = plan.loans.reduce((n, l) => n + l.extraPayments.filter(fromBonuses).length, 0);
    const also = linked
      ? ` This also removes ${linked === 1 ? 'the early loan payment' : `${linked} early loan payments`} paid from their bonuses.`
      : '';
    if (!confirm(`Remove ${person.name} and their bonuses?${also}`)) return;
    setPlan((p) => ({
      ...p,
      people: removeById(p.people, person.id),
      loans: p.loans.map((l) =>
        l.extraPayments.some(fromBonuses) ? { ...l, extraPayments: l.extraPayments.filter((x) => !fromBonuses(x)) } : l,
      ),
    }));
    peopleOpen.set(person.id, false);
  };

  return (
    <>
      <PageHeader title="Income" subtitle="Enter take-home (net) amounts — what actually lands in your account." />

      <div className="stats">
        <Stat label="Salaries, next 12 months" value={fmt.money(sum('salary'))} />
        <Stat label="Bonuses, next 12 months" value={fmt.money(sum('bonus'))} />
        <Stat label="Other income, next 12 months" value={fmt.money(sum('otherIncome'))} />
      </div>

      <Card
        title="Family members"
        subtitle="Monthly salary, yearly raise, and bonuses in the months they're paid."
        actions={<AddButton onClick={startPerson}>Add person</AddButton>}
      >
        {people.items.length === 0 && !newPerson && <Empty>Add yourself and anyone else who brings income into the household.</Empty>}
        <div className="person-grid">
          {newPerson && (
            <PersonEditor
              key={newPerson.id}
              person={newPerson}
              isNew
              onSave={(p) => {
                people.add(p);
                setNewPerson(null);
              }}
              onCancel={() => setNewPerson(null)}
            />
          )}
          {people.items.map((p) =>
            peopleOpen.isOpen(p.id) ? (
              <PersonEditor
                key={p.id}
                person={p}
                onSave={(next) => {
                  people.update(p.id, next);
                  peopleOpen.set(p.id, false);
                }}
                onCancel={() => peopleOpen.set(p.id, false)}
                onDelete={() => removePerson(p)}
              />
            ) : (
              <PersonSummary key={p.id} person={p} onEdit={() => peopleOpen.set(p.id, true)} lastMonth={projection.rows.at(-1)!.month} />
            ),
          )}
        </div>
      </Card>

      <Card
        title="Other income"
        subtitle="Rental income, child benefit, side jobs, a one-off sale…"
        actions={<AddButton onClick={startIncome}>Add income</AddButton>}
      >
        {newIncome && (
          <RecurringEditor
            key={newIncome.id}
            item={newIncome}
            isNew
            noun="income"
            onSave={(item) => {
              incomes.add(item);
              setNewIncome(null);
            }}
            onCancel={() => setNewIncome(null)}
          />
        )}
        {incomes.items.length === 0 && !newIncome ? (
          <Empty>No other income.</Empty>
        ) : (
          <div className="item-list">
            {incomes.items.map((i) =>
              incomesOpen.isOpen(i.id) ? (
                <RecurringEditor
                  key={i.id}
                  item={i}
                  noun="income"
                  onSave={(item) => {
                    incomes.update(i.id, item);
                    incomesOpen.set(i.id, false);
                  }}
                  onCancel={() => incomesOpen.set(i.id, false)}
                  onDelete={() => {
                    incomes.remove(i.id);
                    incomesOpen.set(i.id, false);
                  }}
                />
              ) : (
                <RecurringRow key={i.id} item={i} onEdit={() => incomesOpen.set(i.id, true)} />
              ),
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function PersonSummary({ person: p, onEdit, lastMonth }: { person: Person; onEdit: () => void; lastMonth: string }) {
  const { plan, fmt } = usePlan();
  const bonuses = p.bonuses.filter((b) => b.amount > 0);
  const salaryNow = salaryAt(p, plan.settings.startMonth, plan.settings.startMonth).salary;
  const changes = [...p.salaryChanges].sort((a, b) => a.month.localeCompare(b.month));
  return (
    <div className="person summary" onDoubleClick={onEdit}>
      <div className="person-head">
        <span className="person-name">{p.name}</span>
        <EditButton onClick={onEdit} label={`Edit ${p.name}`} />
      </div>
      <div className="person-salary">
        <span className="stat-value">{fmt.money(p.netMonthlySalary)}</span>
        <span className="muted"> / month net{p.annualRaisePct ? ` · +${p.annualRaisePct}% each January` : ''}</span>
      </div>
      <dl className="facts">
        <dt>Bonuses</dt>
        <dd>
          {bonuses.length ? bonuses.map((b) => <div key={b.id}>{bonusText(b, salaryNow, fmt, plan.settings.startMonth)}</div>) : 'None'}
        </dd>
        {changes.length > 0 && (
          <>
            <dt>Changes</dt>
            <dd>
              {changes.map((c) => `${fmt.month(c.month)}: ${fmt.money(c.netMonthlySalary)}${c.label ? ` (${c.label})` : ''}`).join(' · ')}
            </dd>
          </>
        )}
        {(changes.length > 0 || p.annualRaisePct !== 0) && (
          <>
            <dt>By {fmt.month(lastMonth)}</dt>
            <dd>{fmt.money(salaryAt(p, plan.settings.startMonth, lastMonth).salary)} / month</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function PersonEditor({
  person,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  person: Person;
  isNew?: boolean;
  onSave: (p: Person) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { plan } = usePlan();
  const { draft: p, patch, dirty } = useDraft(person);
  const endsTooEarly = p.bonuses.some((b) => b.frequency !== 'once' && !!b.endMonth && b.endMonth < b.startMonth);
  const error = !p.name.trim() ? 'Give them a name' : endsTooEarly ? 'A bonus ends before it starts' : null;
  const save = () =>
    onSave({
      ...p,
      name: p.name.trim(),
      // A one-off bonus has no end month.
      bonuses: p.bonuses.map((b) => (b.frequency === 'once' && b.endMonth ? { ...b, endMonth: undefined } : b)),
    });

  return (
    <EditForm className="person editing" error={error} onCancel={onCancel} onSave={save}>
      {isNew && <div className="editor-title">New family member</div>}
      <Field label="Name">
        <TextInput value={p.name} autoFocus={isNew} onChange={(name) => patch({ name })} />
      </Field>
      <div className="form-row">
        <Field label="Net salary / month">
          <MoneyInput value={p.netMonthlySalary} onChange={(v) => patch({ netMonthlySalary: v })} />
        </Field>
        <Field label="Raise each January">
          <NumberInput value={p.annualRaisePct} step={0.5} min={-50} max={100} suffix="%" onChange={(v) => patch({ annualRaisePct: v })} />
        </Field>
      </div>

      <div className="sub-head">Bonuses</div>
      {p.bonuses.length === 0 && (
        <p className="muted small">
          None yet. Add any bonus — yearly, quarterly, monthly or one-off, as an amount or a multiple of salary.
        </p>
      )}
      {p.bonuses.map((b) => (
        <BonusEditor
          key={b.id}
          bonus={b}
          salary={p.netMonthlySalary}
          onChange={(patchB) => patch({ bonuses: updateById(p.bonuses, b.id, patchB) })}
          onDelete={() => patch({ bonuses: removeById(p.bonuses, b.id) })}
        />
      ))}
      <AddButton
        onClick={() =>
          patch({
            bonuses: [
              ...p.bonuses,
              {
                id: uid(),
                label: '',
                frequency: 'yearly',
                startMonth: addMonths(plan.settings.startMonth, 1),
                amountType: 'fixed',
                amount: 0,
              },
            ],
          })
        }
      >
        Add bonus
      </AddButton>

      <div className="sub-head">Salary changes</div>
      {p.salaryChanges.length === 0 && (
        <p className="muted small">New job, parental leave, part-time, retirement — add the new take-home pay from that month.</p>
      )}
      {[...p.salaryChanges]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((c) => (
          <div className="change-block" key={c.id}>
            <div className="change-row">
              <MonthInput
                value={c.month}
                ariaLabel="From"
                onChange={(v) => v && patch({ salaryChanges: updateById(p.salaryChanges, c.id, { month: v }) })}
              />
              <TextInput
                value={c.label}
                placeholder="e.g. Parental leave"
                ariaLabel="What changes"
                onChange={(label) => patch({ salaryChanges: updateById(p.salaryChanges, c.id, { label }) })}
              />
              <MoneyInput
                value={c.netMonthlySalary}
                ariaLabel="New net salary"
                onChange={(v) => patch({ salaryChanges: updateById(p.salaryChanges, c.id, { netMonthlySalary: v }) })}
              />
              <DeleteButton onClick={() => patch({ salaryChanges: removeById(p.salaryChanges, c.id) })} label="Remove salary change" />
            </div>
            <label className="check small">
              <input
                type="checkbox"
                checked={c.bonusesPaid}
                onChange={(e) => patch({ salaryChanges: updateById(p.salaryChanges, c.id, { bonusesPaid: e.target.checked }) })}
              />
              Bonuses still paid during this time
            </label>
          </div>
        ))}
      <AddButton
        onClick={() =>
          patch({
            salaryChanges: [
              ...p.salaryChanges,
              {
                id: uid(),
                month: addMonths(plan.settings.startMonth, 12),
                netMonthlySalary: Math.round(p.netMonthlySalary),
                label: '',
                bonusesPaid: true,
              },
            ],
          })
        }
      >
        Add salary change
      </AddButton>

      <EditActions isNew={isNew} dirty={dirty} error={error} onCancel={onCancel} onDelete={onDelete} />
    </EditForm>
  );
}

const BONUS_FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'yearly', label: 'Every year' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'monthly', label: 'Every month' },
  { value: 'once', label: 'Once' },
];

/** "Performance bonus €4,000 · each Mar" or "13th salary 1× salary (≈ €2,900) · each Dec". */
function bonusText(b: Bonus, salary: number, fmt: Formatters, planStart: YM): string {
  const amount = b.amountType === 'salary' ? `${b.amount}× salary (≈ ${fmt.money(bonusAmount(b, salary))})` : fmt.money(b.amount);
  const when =
    b.frequency === 'monthly'
      ? ['every month', periodText(b, fmt, planStart)].filter((x) => x !== 'ongoing').join(' · ')
      : periodText(b, fmt, planStart);
  return `${b.label || 'Bonus'} ${amount} · ${when}`;
}

function BonusEditor({
  bonus: b,
  salary,
  onChange,
  onDelete,
}: {
  bonus: Bonus;
  salary: number;
  onChange: (p: Partial<Bonus>) => void;
  onDelete: () => void;
}) {
  const { fmt } = usePlan();
  const once = b.frequency === 'once';
  return (
    <div className="bonus-block">
      <div className="bonus-line">
        <TextInput value={b.label} placeholder="e.g. Performance bonus" ariaLabel="Bonus name" onChange={(label) => onChange({ label })} />
        <Select<Bonus['amountType']>
          value={b.amountType}
          ariaLabel="Amount type"
          options={[
            { value: 'fixed', label: 'Amount' },
            { value: 'salary', label: '× salary' },
          ]}
          onChange={(amountType) => onChange({ amountType, amount: amountType === 'salary' ? 1 : Math.round(b.amount * salary) || 0 })}
        />
        {b.amountType === 'salary' ? (
          <NumberInput
            value={b.amount}
            min={0}
            max={24}
            step={0.5}
            suffix="× salary"
            ariaLabel="Months of salary"
            onChange={(amount) => onChange({ amount })}
          />
        ) : (
          <MoneyInput value={b.amount} ariaLabel="Amount" onChange={(amount) => onChange({ amount })} />
        )}
        <DeleteButton onClick={onDelete} label="Remove bonus" />
      </div>
      <div className="bonus-line">
        <Select value={b.frequency} options={BONUS_FREQUENCIES} ariaLabel="How often" onChange={(frequency) => onChange({ frequency })} />
        <span className="muted small">{once ? 'in' : 'first'}</span>
        <MonthInput value={b.startMonth} ariaLabel={once ? 'Paid in' : 'First paid'} onChange={(v) => v && onChange({ startMonth: v })} />
        {!once && (
          <>
            <span className="muted small">until</span>
            <MonthInput
              value={b.endMonth}
              optional
              ariaLabel="Until"
              invalid={!!b.endMonth && b.endMonth < b.startMonth}
              onChange={(endMonth) => onChange({ endMonth })}
            />
          </>
        )}
      </div>
      {b.amountType === 'salary' && (
        <span className="field-hint">≈ {fmt.money(bonusAmount(b, salary))} at today's salary — grows with raises and salary changes</span>
      )}
    </div>
  );
}
