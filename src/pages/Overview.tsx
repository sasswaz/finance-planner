import { useState } from 'react';
import { MonthLineChart, Legend } from '../components/charts';
import { Select } from '../components/inputs';
import { MoneyFlow } from '../components/MoneyFlow';
import { Card, Empty, PageHeader, Stat, Status } from '../components/ui';
import { yearOf } from '../engine/dates';
import { debtFreeMonth, impactOf } from '../engine/loan';
import { debtAtStart, goalStatus, typicalMonth } from '../engine/projection';
import { emptyPlan } from '../example';
import { usePlan } from '../store';
import { useChartTheme } from '../theme';
import type { PageId } from '../App';
import type { ExpenseCategory, Plan } from '../types';

export function Overview({ go }: { go: (p: PageId) => void }) {
  const { plan, setPlan, projection, fmt, workspace, activeScenario } = usePlan();
  const t = useChartTheme();
  const { rows } = projection;
  const last = rows.at(-1)!;
  const [chosenPeriod, setFlowPeriod] = useState<string>('next12');
  // A year picked earlier may no longer be in the plan (another plan, a shorter horizon).
  const flowPeriod = projection.years.some((y) => String(y.year) === chosenPeriod) ? chosenPeriod : 'next12';
  const flowRows = flowPeriod === 'next12' ? rows.slice(0, 12) : rows.filter((r) => String(yearOf(r.month)) === flowPeriod);
  const flowOptions = [
    { value: 'next12', label: 'Next 12 months' },
    ...projection.years.map((y) => ({
      value: String(y.year),
      label: `${y.year}${y.year === yearOf(rows[0].month) || y.year === yearOf(last.month) ? ' (part year)' : ''}`,
    })),
  ];
  const flowLabel = flowOptions.find((o) => o.value === flowPeriod)?.label ?? '';
  const typical = typicalMonth(plan, projection);
  const next12 = rows.slice(0, 12);
  const saved12 = next12.reduce((s, r) => s + r.net, 0);

  const debtNow = debtAtStart(plan, projection);
  const debtFree = debtFreeMonth(projection.loanPlan);
  const neverPaid = debtFree === null;
  // Loans that never pay off without early payments have no baseline to measure a saving against.
  const interestSaved = plan.loans.reduce((s, l) => {
    const imp = impactOf(projection.loanPlan, l.id);
    return imp.comparable ? s + imp.netSaving : s;
  }, 0);

  const upcoming = next12.flatMap((r) => r.events.map((e) => ({ ...e, month: r.month })));
  const goals = plan.goals.map((g) => goalStatus(plan, projection, g));

  const series = [
    { key: 'savings', name: 'Savings', color: t.series[0] },
    ...(plan.loans.length ? [{ key: 'debt', name: 'Debt remaining', color: t.series[1] }] : []),
  ];

  const isEmpty = !plan.people.length && !plan.expenses.length && !plan.loans.length && !plan.incomes.length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${workspace.scenarios.length > 1 ? `${activeScenario.name} · ` : ''}${fmt.month(rows[0].month)} – ${fmt.month(last.month)} · ${plan.settings.horizonYears}-year plan`}
      />

      {plan.isExample && (
        <div className="banner">
          <div>
            <strong>This is example data.</strong> Look around, then start your own plan or edit this one.
          </div>
          <div className="banner-actions">
            <button
              className="btn primary"
              onClick={() => {
                if (confirm('Clear the example and start with an empty plan?')) setPlan(emptyPlan());
              }}
            >
              Start an empty plan
            </button>
            <button className="btn" onClick={() => setPlan((p) => ({ ...p, isExample: undefined }))}>
              Keep and edit this one
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <Card>
          <Empty
            action={
              <button className="btn primary" onClick={() => go('income')}>
                Add income
              </button>
            }
          >
            Your plan is empty. Start by adding your family's salaries and bonuses, then expenses and loans.
          </Empty>
        </Card>
      ) : (
        <>
          <SmallAmountsAlert go={go} />
          <MissingExpensesAlert go={go} />

          {projection.lowest.savings < 0 && (
            <div className="alert">
              <Status ok={false}>Cash shortfall</Status>
              Savings drop to <strong>{fmt.money(projection.lowest.savings)}</strong> in {fmt.month(projection.lowest.month)}. Move a big
              expense or an early payment, or reduce spending.
            </div>
          )}

          <div className="stats">
            <Stat label="Monthly income" value={fmt.money(typical.income)} detail="Net salaries + other income, no bonuses" />
            <Stat
              label="Monthly spending"
              value={fmt.money(typical.expenses + typical.loans)}
              detail={`${fmt.money(typical.expenses)} expenses · ${fmt.money(typical.loans)} loans`}
            />
            <Stat
              label="Left over each month"
              value={fmt.money(typical.surplus)}
              tone={typical.surplus >= 0 ? 'good' : 'bad'}
              detail="Yearly bills averaged in"
            />
            <Stat
              label="Saved in the next 12 months"
              value={fmt.money(saved12)}
              tone={saved12 >= 0 ? 'good' : 'bad'}
              detail="Includes bonuses, holidays, early payments"
            />
          </div>

          <div className="stats">
            <Stat
              label={`Savings by ${fmt.month(last.month)}`}
              value={fmt.money(last.savings)}
              detail={`Starting from ${fmt.money(plan.settings.startingSavings)}`}
            />
            <Stat label="Debt today" value={fmt.money(debtNow)} detail={`${plan.loans.length} loan${plan.loans.length === 1 ? '' : 's'}`} />
            <Stat
              label="Debt-free"
              value={neverPaid ? 'Never' : debtFree ? fmt.month(debtFree) : '—'}
              tone={neverPaid ? 'bad' : undefined}
              detail={neverPaid ? 'A loan payment doesn’t cover its interest' : 'Last loan paid off'}
            />
            <Stat
              label="Saved by early payments"
              value={fmt.money(interestSaved)}
              detail="Interest avoided, minus fees"
              tone={interestSaved > 0 ? 'good' : undefined}
            />
          </div>

          <SavingsBreakdown />

          <Card title="Savings and debt over time" actions={<Legend series={series} />}>
            <MonthLineChart data={rows} series={series} height={300} />
          </Card>

          <Card
            title="Where the money goes"
            subtitle="Everything coming in, and where it ends up. Hover a flow for details."
            actions={<Select value={flowPeriod} options={flowOptions} onChange={setFlowPeriod} ariaLabel="Period" />}
          >
            <MoneyFlow rows={flowRows} periodLabel={flowLabel.toLowerCase()} />
          </Card>

          <div className="grid-2">
            <Card title="Coming up in the next 12 months" subtitle="Bonuses, yearly bills, holidays, early payments">
              {upcoming.length === 0 ? (
                <Empty>Nothing irregular planned.</Empty>
              ) : (
                <ul className="events">
                  {upcoming.map((e, i) => (
                    <li key={i}>
                      <span className="event-month">{fmt.month(e.month)}</span>
                      <span className={`event-dot ${e.kind}`} aria-hidden="true" />
                      <span className="event-label">{e.label}</span>
                      <span className={`num ${e.kind === 'income' ? 'pos' : ''}`}>
                        {e.amount ? (e.kind === 'income' ? '+' : '−') + fmt.money(e.amount) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Savings goals"
              actions={
                <button className="btn ghost" onClick={() => go('goals')}>
                  Edit
                </button>
              }
            >
              {goals.length === 0 ? (
                <Empty
                  action={
                    <button className="btn" onClick={() => go('goals')}>
                      Add a goal
                    </button>
                  }
                >
                  No goals yet.
                </Empty>
              ) : (
                <ul className="goal-list">
                  {goals.map((g) => (
                    <li key={g.goal.id}>
                      <div className="goal-row">
                        <span className="goal-name">{g.goal.name}</span>
                        {g.beyondHorizon && !g.onTrack ? (
                          <span className="status neutral">After the plan ends</span>
                        ) : (
                          <Status ok={g.onTrack}>{g.onTrack ? 'On track' : 'Behind'}</Status>
                        )}
                      </div>
                      <div className="meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.max(0, (g.projectedAtTarget / g.goal.targetAmount) * 100))}%` }} />
                      </div>
                      <div className="goal-detail">
                        {fmt.money(g.goal.targetAmount)} by {fmt.month(g.goal.targetMonth)} ·{' '}
                        {g.onTrack
                          ? `reached ${g.reachedMonth ? fmt.month(g.reachedMonth) : ''}`
                          : g.beyondHorizon
                            ? 'make the plan longer to check'
                            : `save ${fmt.money(g.monthlyGap)}/month more`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Amounts so small they were probably typed with a thousands separator and saved wrong
 * (earlier versions read "1,200" as 1.2).
 */
function smallAmounts(plan: Plan): { label: string; amount: number; page: PageId }[] {
  const out: { label: string; amount: number; page: PageId }[] = [];
  const check = (label: string, amount: number, limit: number, page: PageId) => {
    if (amount > 0 && amount < limit) out.push({ label, amount, page });
  };
  for (const p of plan.people) {
    check(`${p.name} – salary`, p.netMonthlySalary, 100, 'income');
    for (const b of p.bonuses) if (b.amountType === 'fixed') check(`${p.name} – ${b.label || 'bonus'}`, b.amount, 100, 'income');
    for (const c of p.salaryChanges) check(`${p.name} – ${c.label || 'salary change'}`, c.netMonthlySalary, 100, 'income');
  }
  for (const i of plan.incomes) check(i.name, i.amount, 10, 'income');
  for (const e of plan.expenses) check(e.name, e.amount, 10, 'expenses');
  for (const l of plan.loans) {
    check(`${l.name} – balance`, l.balance, 1000, 'loans');
    if (l.inputMode === 'payment') check(`${l.name} – monthly payment`, l.monthlyPayment, 10, 'loans');
    for (const x of l.extraPayments) if (x.kind !== 'bonus') check(`${l.name} – early payment`, x.amount, 10, 'loans');
  }
  return out;
}

function SmallAmountsAlert({ go }: { go: (p: PageId) => void }) {
  const { plan, fmt } = usePlan();
  const items = smallAmounts(plan);
  if (!items.length) return null;
  const pages = [...new Set(items.map((i) => i.page))];
  return (
    <div className="alert warn">
      <div>
        <Status ok={false}>Check these amounts</Status> {items.length === 1 ? 'This amount looks' : 'These amounts look'} too small — maybe
        typed with a thousands separator (earlier versions read “1,200” as 1.20):{' '}
        {items
          .slice(0, 6)
          .map((i) => `${i.label} ${fmt.money2(i.amount)}`)
          .join(' · ')}
        {items.length > 6 && ` · and ${items.length - 6} more`}
      </div>
      <div className="button-row">
        {pages.map((p) => (
          <button key={p} className="btn small-btn" onClick={() => go(p)}>
            Fix on {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Everyday costs people often forget, by category, with examples for the hint. */
const COMMONLY_MISSED: { category: ExpenseCategory; examples: string }[] = [
  { category: 'Groceries', examples: 'food and household shopping' },
  { category: 'Health', examples: 'pharmacy, dentist, doctors' },
  { category: 'Holidays', examples: 'trips and travel' },
  { category: 'Other', examples: 'eating out, clothes, gifts' },
];

/**
 * A plan without everyday costs projects savings that will never happen. Flags missing
 * categories and expenses that are a suspiciously small share of income.
 */
function MissingExpensesAlert({ go }: { go: (p: PageId) => void }) {
  const { plan, projection, fmt } = usePlan();
  const typical = typicalMonth(plan, projection);
  const missing = COMMONLY_MISSED.filter((m) => !plan.expenses.some((e) => e.category === m.category));
  const share = typical.income > 0 ? typical.expenses / typical.income : 1;
  if (!plan.people.length || (missing.length === 0 && share >= 0.3)) return null;
  return (
    <div className="alert warn">
      <div>
        <Status ok={false}>Are all your expenses in?</Status> Everyday costs are {fmt.money(typical.expenses)} a month —{' '}
        {Math.round(share * 100)}% of your income — so the plan has you saving {fmt.money(typical.surplus)} a month before bonuses.
        {missing.length > 0 && <> Nothing yet for: {missing.map((m) => `${m.category.toLowerCase()} (${m.examples})`).join('; ')}.</>} If
        your savings don't actually grow that fast, the difference is spending that isn't in the plan.
      </div>
      <div className="button-row">
        <button className="btn small-btn" onClick={() => go('expenses')}>
          Add expenses
        </button>
      </div>
    </div>
  );
}

function SavingsBreakdown() {
  const { plan, projection, fmt } = usePlan();
  const { rows } = projection;
  const last = rows.at(-1)!;
  const sum = (k: 'salary' | 'bonus' | 'otherIncome' | 'expenses' | 'loanRegular' | 'loanExtra' | 'net' | 'income' | 'outflow') =>
    rows.reduce((s, r) => s + r[k], 0);
  const start = plan.settings.startingSavings;
  const interest = last.savings - start - sum('net');
  const lines: { label: string; value: number; sign: '+' | '−' | '' }[] = [
    { label: `Savings at the start (${fmt.month(rows[0].month)})`, value: start, sign: '' },
    { label: 'Salaries', value: sum('salary'), sign: '+' },
    { label: 'Bonuses', value: sum('bonus'), sign: '+' },
    { label: 'Other income', value: sum('otherIncome'), sign: '+' },
    { label: 'Expenses (with inflation)', value: sum('expenses'), sign: '−' },
    { label: 'Regular loan payments', value: sum('loanRegular'), sign: '−' },
    { label: 'Early loan payments and fees', value: sum('loanExtra'), sign: '−' },
    { label: `Interest on savings (${plan.settings.savingsInterestPct}% a year)`, value: interest, sign: interest < 0 ? '−' : '+' },
  ];
  const months = rows.length;
  return (
    <details className="card breakdown">
      <summary>
        <span className="breakdown-title">How the savings figure adds up</span>
        <span className="muted small">
          {' '}
          · {fmt.money(last.savings)} by {fmt.month(last.month)}
        </span>
      </summary>
      <table className="data-table breakdown-table">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}>
              <td>
                <span className="sign">{l.sign}</span> {l.label}
              </td>
              <td className="num">{fmt.money(Math.abs(l.value))}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>
              <span className="sign">=</span> Savings by {fmt.month(last.month)}
            </td>
            <td className="num strong">{fmt.money(last.savings)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        Over {months} months that's on average {fmt.money(sum('income') / months)} coming in and {fmt.money(sum('outflow') / months)} going
        out each month, so {fmt.money(sum('net') / months)} saved a month. If that looks too high, check that every regular cost is on the
        Expenses page and that the amounts are right. The Projection page shows it year by year.
      </p>
    </details>
  );
}
