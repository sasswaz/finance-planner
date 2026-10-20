import { useState } from 'react';
import { HBars } from '../components/charts';
import { Select } from '../components/inputs';
import { confirmDiscard, isDraftDirty, RecurringEditor, RecurringRow, useExpanded } from '../components/items';
import { AddButton, Card, Empty, PageHeader, Stat } from '../components/ui';
import { addMonths, monthlyEquivalent } from '../engine/dates';
import { uid } from '../example';
import { useList, usePlan } from '../store';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseItem, type Frequency } from '../types';

const PRESETS: { name: string; category: ExpenseCategory; frequency: Frequency; monthOffset?: number }[] = [
  { name: 'Rent', category: 'Housing', frequency: 'monthly' },
  { name: 'Electricity', category: 'Bills & utilities', frequency: 'monthly' },
  { name: 'Water', category: 'Bills & utilities', frequency: 'monthly' },
  { name: 'Heating', category: 'Bills & utilities', frequency: 'monthly' },
  { name: 'Internet & phone', category: 'Bills & utilities', frequency: 'monthly' },
  { name: 'Groceries', category: 'Groceries', frequency: 'monthly' },
  { name: 'Home insurance', category: 'Insurance', frequency: 'yearly' },
  { name: 'Car insurance', category: 'Insurance', frequency: 'yearly' },
  { name: 'Health insurance', category: 'Insurance', frequency: 'monthly' },
  { name: 'Fuel', category: 'Transport', frequency: 'monthly' },
  { name: 'Kindergarten / school', category: 'Children', frequency: 'monthly' },
  { name: 'Summer holiday', category: 'Holidays', frequency: 'yearly' },
  { name: 'Winter holiday', category: 'Holidays', frequency: 'yearly' },
];

export function Expenses() {
  const { plan, projection, fmt } = usePlan();
  const expenses = useList('expenses');
  const [filter, setFilter] = useState<'All' | ExpenseCategory>('All');
  const expanded = useExpanded();
  const [adding, setAdding] = useState<ExpenseItem | null>(null);

  const next12 = projection.rows.slice(0, 12);
  const total12 = next12.reduce((s, r) => s + r.expenses, 0);
  const byCategory = EXPENSE_CATEGORIES.map((c) => ({
    label: c,
    value: next12.reduce((s, r) => s + r.byCategory[c], 0) / Math.max(1, next12.length),
  }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const recurringMonthly = expenses.items
    .filter((e) => !e.endMonth || e.endMonth >= plan.settings.startMonth)
    .reduce((s, e) => s + monthlyEquivalent(e.amount, e.frequency), 0);
  const oneOffs = expenses.items
    .filter((e) => e.frequency === 'once' && e.startMonth >= plan.settings.startMonth)
    .reduce((s, e) => s + e.amount, 0);

  const add = (preset?: (typeof PRESETS)[number]) => {
    // Don't throw away a half-filled new expense without asking.
    if (adding && isDraftDirty(adding.id) && !confirmDiscard('Discard the new expense you were adding?')) return;
    const item: ExpenseItem = {
      id: uid(),
      name: preset?.name ?? '',
      category: preset?.category ?? (filter === 'All' ? 'Other' : filter),
      amount: 0,
      frequency: preset?.frequency ?? 'monthly',
      startMonth: preset?.frequency === 'yearly' ? addMonths(plan.settings.startMonth, 1) : plan.settings.startMonth,
    };
    setAdding(item);
  };

  const changeFilter = (next: 'All' | ExpenseCategory) => {
    if (next === filter) return;
    // Switching category closes the open editors, so check them for unsaved edits first.
    const editing = expenses.items.filter((e) => expanded.isOpen(e.id));
    if (
      editing.some((e) => isDraftDirty(e.id)) &&
      !confirmDiscard('Changing the filter closes the expenses you’re editing. Discard your unsaved changes?')
    )
      return;
    setFilter(next);
    expanded.clear();
  };

  const shown = expenses.items.filter((e) => filter === 'All' || e.category === filter);
  const categoryOptions = ['All', ...EXPENSE_CATEGORIES].map((c) => ({
    value: c as 'All' | ExpenseCategory,
    label: c === 'All' ? `All categories (${expenses.items.length})` : `${c} (${expenses.items.filter((e) => e.category === c).length})`,
  }));

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Everything except loan repayments (those go on the Loans page). Holidays and one-off purchases belong here too."
      />

      <div className="stats">
        <Stat label="Average per month" value={fmt.money(recurringMonthly)} detail="Yearly and quarterly bills spread out" />
        <Stat label="Next 12 months" value={fmt.money(total12)} detail={`Grows ${plan.settings.inflationPct}% a year (inflation)`} />
        <Stat label="Planned one-offs" value={fmt.money(oneOffs)} detail="All future one-off expenses" />
      </div>

      <Card
        title="Your expenses"
        actions={
          <>
            <Select value={filter} options={categoryOptions} onChange={changeFilter} ariaLabel="Filter by category" />
            <AddButton onClick={() => add()}>Add expense</AddButton>
          </>
        }
      >
        <div className="chips" aria-label="Quick add">
          <span className="muted small">Quick add:</span>
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="chip" onClick={() => add(p)}>
              + {p.name}
            </button>
          ))}
        </div>
        {adding && (
          <RecurringEditor
            key={adding.id}
            item={adding}
            isNew
            noun="expense"
            withCategory
            onSave={(item) => {
              expenses.add(item);
              setAdding(null);
            }}
            onCancel={() => setAdding(null)}
          />
        )}
        {shown.length === 0 && !adding ? (
          <Empty>No expenses{filter !== 'All' ? ` in ${filter}` : ''} yet.</Empty>
        ) : (
          <div className="item-list">
            {shown.map((e) =>
              expanded.isOpen(e.id) ? (
                <RecurringEditor
                  key={e.id}
                  item={e}
                  noun="expense"
                  withCategory
                  onSave={(item) => {
                    expenses.update(e.id, item);
                    expanded.set(e.id, false);
                  }}
                  onCancel={() => expanded.set(e.id, false)}
                  onDelete={() => {
                    expenses.remove(e.id);
                    expanded.set(e.id, false);
                  }}
                />
              ) : (
                <RecurringRow key={e.id} item={e} onEdit={() => expanded.set(e.id, true)} />
              ),
            )}
          </div>
        )}
      </Card>

      <Card title="Where the money goes" subtitle="Average per month over the next 12 months, including yearly bills and holidays">
        {byCategory.length === 0 ? <Empty>Nothing yet.</Empty> : <HBars rows={byCategory} format={fmt.money} />}
      </Card>
    </>
  );
}
