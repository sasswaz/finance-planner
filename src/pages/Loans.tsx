import { Fragment, useMemo, useState } from 'react';
import { Legend, MonthLineChart, MonthStackedArea } from '../components/charts';
import { DeleteButton, Field, MoneyInput, MonthInput, NumberInput, Segmented, Select, TextInput } from '../components/inputs';
import { confirmDiscard, EditActions, EditButton, EditForm, isDraftDirty, SettingsForm, useDraft, useExpanded } from '../components/items';
import { AddButton, Card, Empty, PageHeader, Stat, Status } from '../components/ui';
import { addMonths, monthsBetween, yearOf } from '../engine/dates';
import {
  balanceAt,
  debtFreeMonth,
  impactOf,
  monthsToRepay,
  planLoans,
  rateFor,
  totalCost,
  regularPayment,
  type LoanPlan,
  type LoanRow,
  type LoanSchedule,
} from '../engine/loan';
import { debtAtStart, loanContext, loanPaymentIn, loanTakenBy } from '../engine/projection';
import { uid } from '../example';
import { removeById, updateById, useList, usePlan } from '../store';
import { useChartTheme } from '../theme';
import { LOAN_KINDS, type DebtStrategy, type ExtraPayment, type Loan, type Plan, type RateChange, type YM } from '../types';

const MAX_CHART_MONTHS = 50 * 12;

const interestFrom = (s: LoanSchedule, from: YM) => s.rows.reduce((sum, r) => (r.month >= from ? sum + r.interest : sum), 0);

export function Loans() {
  const { plan, projection, fmt } = usePlan();
  const loans = useList('loans');
  const t = useChartTheme();
  const lp = projection.loanPlan;
  const start = plan.settings.startMonth;
  const expanded = useExpanded();
  const [adding, setAdding] = useState<Loan | null>(null);

  // Balances over the whole life of the loans, not just the plan horizon.
  const { chartData, yearly } = useMemo(() => {
    const lastPayoff = loans.items
      .map((l) => lp.schedules[l.id].payoffMonth ?? addMonths(start, MAX_CHART_MONTHS))
      .sort()
      .at(-1);
    const span = lastPayoff ? Math.min(MAX_CHART_MONTHS, Math.max(12, monthsBetween(start, lastPayoff) + 1)) : 0;
    const byMonth = Object.fromEntries(loans.items.map((l) => [l.id, new Map(lp.schedules[l.id].rows.map((r) => [r.month, r]))]));
    const data = Array.from({ length: span }, (_, i) => {
      const month = addMonths(start, i);
      const row: Record<string, number | string> = { month };
      for (const l of loans.items) row[l.id] = byMonth[l.id].get(month)?.balance ?? balanceAt(l, lp.schedules[l.id], month);
      return row as { month: string } & Record<string, number>;
    });
    const years = new Map<number, { year: number; paid: number; interest: number; balances: Record<string, number> }>();
    for (const row of data) {
      const y = yearOf(row.month);
      const entry = years.get(y) ?? { year: y, paid: 0, interest: 0, balances: {} };
      for (const l of loans.items) {
        const r = byMonth[l.id].get(row.month);
        if (r) {
          entry.paid += r.payment + r.extra + r.fee;
          entry.interest += r.interest;
        }
        entry.balances[l.id] = row[l.id];
      }
      years.set(y, entry);
    }
    return { chartData: data, yearly: [...years.values()] };
  }, [loans.items, lp, start]);

  const series = loans.items.map((l, i) => ({ key: l.id, name: l.name, color: t.series[Math.min(i, t.series.length - 1)] }));
  const totalInterest = loans.items.reduce((s, l) => s + interestFrom(lp.schedules[l.id], start), 0);
  const totalMonthly = loans.items.reduce((s, l) => s + loanPaymentIn(plan, projection, l.id, start), 0);

  const addLoan = () => {
    // Don't throw away a half-filled new loan without asking.
    if (adding && isDraftDirty(adding.id) && !confirmDiscard('Discard the new loan you were adding?')) return;
    const loan: Loan = {
      id: uid(),
      name: '',
      kind: 'Car loan',
      balance: 10_000,
      annualRatePct: 6,
      firstPaymentMonth: addMonths(start, 1),
      inputMode: 'term',
      remainingMonths: 60,
      monthlyPayment: 0,
      strategy: 'reduce-term',
      earlyRepaymentFeePct: 0,
      extraPayments: [],
      rateChanges: [],
    };
    setAdding(loan);
  };

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle="Mortgages, car loans and other credit: what's left to pay, and what early payments would save."
        actions={<AddButton onClick={addLoan}>Add loan</AddButton>}
      />

      {adding && (
        <LoanEditor
          key={adding.id}
          source={adding}
          isNew
          onSave={(loan) => {
            loans.add(loan);
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}

      {loans.items.length === 0 ? (
        !adding && (
          <Card>
            <Empty
              action={
                <button className="btn primary" onClick={addLoan}>
                  Add your first loan
                </button>
              }
            >
              No loans — nice.
            </Empty>
          </Card>
        )
      ) : (
        <>
          <div className="stats">
            <Stat label={`Owed at ${fmt.month(start)}`} value={fmt.money(debtAtStart(plan, projection))} />
            <Stat label="Monthly repayments" value={fmt.money(totalMonthly)} />
            <Stat label="Interest still to pay" value={fmt.money(totalInterest)} detail="With your planned early payments" />
          </div>

          <Card
            title="Remaining balance over the years"
            subtitle="Including planned early payments and roll-overs"
            actions={<Legend series={series} />}
          >
            <MonthStackedArea data={chartData} series={series} height={280} />
            <details className="details">
              <summary>Show year-by-year table</summary>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      {loans.items.map((l) => (
                        <th className="num" key={l.id}>
                          {l.name} left
                        </th>
                      ))}
                      <th className="num">Total left</th>
                      <th className="num">Paid that year</th>
                      <th className="num">of which interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearly.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td>
                        {loans.items.map((l) => (
                          <td className="num" key={l.id}>
                            {fmt.money(y.balances[l.id] ?? 0)}
                          </td>
                        ))}
                        <td className="num strong">{fmt.money(Object.values(y.balances).reduce((s, v) => s + v, 0))}</td>
                        <td className="num">{fmt.money(y.paid)}</td>
                        <td className="num muted">{fmt.money(y.interest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <DebtPlan />

          <h2 className="list-title">Your loans</h2>
          <div className="loan-list">
            {loans.items.map((l, i) =>
              expanded.isOpen(l.id) ? (
                <LoanEditor
                  key={l.id}
                  source={l}
                  onSave={(next) => {
                    loans.update(l.id, next);
                    expanded.set(l.id, false);
                  }}
                  onCancel={() => expanded.set(l.id, false)}
                  onDelete={() => {
                    if (confirm(`Delete "${l.name}" and its early payments?`)) loans.remove(l.id);
                  }}
                />
              ) : (
                <LoanSummary key={l.id} loan={l} color={series[i].color} onEdit={() => expanded.set(l.id, true)} />
              ),
            )}
          </div>
        </>
      )}
    </>
  );
}

function LoanEditor({
  source,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  source: Loan;
  isNew?: boolean;
  onSave: (loan: Loan) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { plan, fmt } = usePlan();
  const t = useChartTheme();
  const { draft: loan, patch: onChange, dirty } = useDraft(source);
  // Results below are a preview of the plan with this draft in it.
  const allLoans = useMemo(
    () => (isNew ? [...plan.loans, loan] : plan.loans.map((l) => (l.id === loan.id ? loan : l))),
    [plan.loans, loan, isNew],
  );
  const lp = useMemo(() => planLoans(allLoans, loanContext(plan)), [allLoans, plan]);
  const endsTooEarly = loan.extraPayments.some(
    (x) => (x.kind === 'bonus' || x.frequency !== 'once') && !!x.endMonth && x.endMonth < x.startMonth,
  );
  const error = !loan.name.trim()
    ? 'Give the loan a name'
    : loan.balance <= 0
      ? 'Enter the balance'
      : endsTooEarly
        ? 'An early payment ends before it starts'
        : null;
  const start = plan.settings.startMonth;
  const impact = impactOf(lp, loan.id);
  const { baseline, planned } = impact;
  const r = loan.annualRatePct / 100 / 12;
  const payment = regularPayment(loan);
  const derivedTerm = monthsToRepay(loan.balance, r, loan.monthlyPayment);
  const rollIns = lp.rollIns[loan.id];
  const hasExtras = planned.totalExtra > 0 || loan.extraPayments.length > 0;
  const firstRolled = planned.rows.find((r) => r.rolled > 0);
  const maxRolled = Math.max(0, ...planned.rows.map((r) => r.rolled));
  const paymentChanges = Math.abs(planned.finalPayment - planned.initialPayment) > 0.5;

  const setExtras = (extraPayments: ExtraPayment[]) => onChange({ extraPayments });
  const setRates = (rateChanges: RateChange[]) => onChange({ rateChanges });

  // A loan can roll into any other loan that doesn't (eventually) roll back into this one.
  const rollOptions = allLoans.filter((other) => {
    if (other.id === loan.id) return false;
    for (let cur: string | undefined = other.id; cur; cur = lp.targets[cur]) if (cur === loan.id) return false;
    return true;
  });
  const rollTarget = allLoans.find((l) => l.id === lp.targets[loan.id]);
  const rollTargetEnds = rollTarget ? lp.schedules[rollTarget.id].payoffMonth : null;

  const chartData = baseline.rows.map((row, i) => ({
    month: row.month,
    baseline: row.balance,
    planned: planned.rows[i]?.balance ?? 0,
  }));
  const chartSeries = [
    { key: 'planned', name: 'With early payments', color: t.series[0] },
    { key: 'baseline', name: 'Regular payments only', color: t.baseline },
  ];

  return (
    <Card
      className="loan-editor"
      title={isNew ? 'New loan' : loan.name || 'Loan'}
      subtitle={
        dirty
          ? 'Not saved yet — the results below are a preview of your changes.'
          : 'Change the details, then Save. Results below update as you type.'
      }
    >
      <EditForm error={error} onCancel={onCancel} onSave={() => onSave({ ...loan, name: loan.name.trim() })}>
        <div className="form-grid">
          <Field label="Name">
            <TextInput value={loan.name} autoFocus={isNew} onChange={(name) => onChange({ name })} />
          </Field>
          <Field label="Type">
            <Select value={loan.kind} options={LOAN_KINDS} onChange={(kind) => onChange({ kind })} />
          </Field>
          <Field label="Balance" hint="Today's balance from your bank — or the original amount, if you enter the first-ever payment month">
            <MoneyInput value={loan.balance} onChange={(balance) => onChange({ balance })} />
          </Field>
          <Field group label="Payment month for that balance" hint="Your next payment, or the loan's first payment">
            <MonthInput value={loan.firstPaymentMonth} onChange={(v) => v && onChange({ firstPaymentMonth: v })} />
          </Field>
          <Field label="Interest rate (yearly)">
            <NumberInput
              value={loan.annualRatePct}
              step={0.1}
              min={0}
              max={100}
              suffix="%"
              onChange={(annualRatePct) => onChange({ annualRatePct })}
            />
          </Field>
        </div>

        {loan.firstPaymentMonth < start && loan.balance > 0 && (
          <p className="hint-box">
            This balance is as of {fmt.month(loan.firstPaymentMonth)}, so by {fmt.month(start)} it's down to{' '}
            <strong>{fmt.money(balanceAt(loan, lp.baselines[loan.id], addMonths(start, -1)))}</strong>. If {fmt.money(loan.balance)} is what
            you owe today, set the payment month to your next payment instead.
          </p>
        )}

        <div className="form-grid">
          <Field group label="I know the…">
            <Segmented
              value={loan.inputMode}
              onChange={(inputMode) =>
                onChange(
                  inputMode === 'payment'
                    ? { inputMode, monthlyPayment: Math.round(payment * 100) / 100 }
                    : { inputMode, remainingMonths: Number.isFinite(derivedTerm) ? derivedTerm : loan.remainingMonths || 120 },
                )
              }
              options={[
                { value: 'term', label: 'Remaining term' },
                { value: 'payment', label: 'Monthly payment' },
              ]}
            />
          </Field>
          {loan.inputMode === 'term' ? (
            <Field
              label="Months left (from that payment)"
              hint={`${fmt.duration(loan.remainingMonths)} → payment ${fmt.money2(payment)}/month`}
            >
              <NumberInput
                value={loan.remainingMonths}
                min={1}
                max={600}
                step={12}
                suffix="months"
                onChange={(v) => onChange({ remainingMonths: Math.round(v) })}
              />
            </Field>
          ) : (
            <Field
              label="Monthly payment"
              hint={Number.isFinite(derivedTerm) ? `${fmt.duration(derivedTerm)} left` : 'Too low — doesn’t cover the interest'}
            >
              <MoneyInput value={loan.monthlyPayment} onChange={(monthlyPayment) => onChange({ monthlyPayment })} />
            </Field>
          )}
          <Field group label="After an early payment, the bank gives…">
            <Segmented
              value={loan.strategy}
              onChange={(strategy) => onChange({ strategy })}
              options={[
                { value: 'reduce-term', label: 'Shorter term' },
                { value: 'reduce-payment', label: 'Lower payment' },
              ]}
            />
          </Field>
          <Field label="Early repayment fee" hint="Charged on each early payment — check your contract">
            <NumberInput
              value={loan.earlyRepaymentFeePct}
              step={0.25}
              min={0}
              max={20}
              suffix="%"
              onChange={(earlyRepaymentFeePct) => onChange({ earlyRepaymentFeePct })}
            />
          </Field>
        </div>

        <div className="section">
          <div className="section-head">
            <div>
              <h3>Interest rate changes</h3>
              <p className="card-sub">For variable-rate loans. The bank recalculates the payment so the loan still ends on time.</p>
            </div>
            <AddButton
              onClick={() =>
                setRates([
                  ...loan.rateChanges,
                  {
                    id: uid(),
                    month: addMonths(loan.firstPaymentMonth, 12),
                    annualRatePct: Math.round((loan.annualRatePct + 0.5) * 100) / 100,
                  },
                ])
              }
            >
              Add rate change
            </AddButton>
          </div>
          {loan.rateChanges.length > 0 && (
            <div className="table-wrap">
              <table className="edit-table compact-table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th className="num">New rate</th>
                    <th className="num">Payment then</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {[...loan.rateChanges]
                    .sort((a, b) => a.month.localeCompare(b.month))
                    .map((c) => {
                      const row = planned.rows.find((x) => x.month === c.month);
                      return (
                        <tr key={c.id}>
                          <td>
                            <MonthInput
                              value={c.month}
                              ariaLabel="From"
                              onChange={(v) => v && setRates(updateById(loan.rateChanges, c.id, { month: v }))}
                            />
                          </td>
                          <td>
                            <NumberInput
                              value={c.annualRatePct}
                              step={0.1}
                              min={0}
                              max={100}
                              suffix="%"
                              width={120}
                              ariaLabel="New rate"
                              onChange={(annualRatePct) => setRates(updateById(loan.rateChanges, c.id, { annualRatePct }))}
                            />
                          </td>
                          <td className="num">{row ? fmt.money2(row.payment) : <span className="muted">after payoff</span>}</td>
                          <td>
                            <DeleteButton onClick={() => setRates(removeById(loan.rateChanges, c.id))} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-head">
            <h3>Early payments</h3>
            <div className="card-actions">
              <AddButton
                onClick={() =>
                  setExtras([
                    ...loan.extraPayments,
                    { id: uid(), startMonth: addMonths(loan.firstPaymentMonth, 1), amount: 1000, frequency: 'once', kind: 'fixed' },
                  ])
                }
              >
                Add early payment
              </AddButton>
              <AddButton
                onClick={() =>
                  setExtras([
                    ...loan.extraPayments,
                    { id: uid(), startMonth: loan.firstPaymentMonth, amount: 0, frequency: 'monthly', kind: 'bonus', bonusPct: 50 },
                  ])
                }
              >
                Add share of bonuses
              </AddButton>
            </div>
          </div>
          {loan.extraPayments.length === 0 ? (
            <p className="muted">
              None planned. Add a one-off or regular amount, or a share of your bonuses (say, half of every bonus), and see what it saves
              below.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="edit-table">
                <thead>
                  <tr>
                    <th>When / from</th>
                    <th>Amount</th>
                    <th>Repeat</th>
                    <th>Until</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {loan.extraPayments.map((x) => (
                    <EarlyPaymentRow
                      key={x.id}
                      x={x}
                      onChange={(patch) => setExtras(updateById(loan.extraPayments, x.id, patch))}
                      onDelete={() => setExtras(removeById(loan.extraPayments, x.id))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lp.mode === 'manual' ? (
            <>
              {rollIns.length > 0 && (
                <ul className="roll-list">
                  {rollIns.map((ri) => (
                    <li key={ri.fromLoanId}>
                      <span className="roll-icon" aria-hidden="true">
                        ↪
                      </span>
                      {planned.payoffMonth && ri.startMonth > planned.payoffMonth ? (
                        <span className="muted">
                          {ri.fromName} ends after this loan, so its {fmt.money(ri.amount)}/month has nothing to roll into.
                        </span>
                      ) : (
                        <span>
                          <strong>{fmt.money2(ri.amount)}/month</strong> rolled over from {ri.fromName} from {fmt.month(ri.startMonth)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="roll-into">
                <Field
                  label="When this loan is paid off, move its payment to"
                  hint={
                    rollTarget
                      ? rollTargetEnds && planned.payoffMonth && rollTargetEnds <= planned.payoffMonth
                        ? `${rollTarget.name} is already paid off by then — the money stays in your savings.`
                        : `From ${planned.payoffMonth ? fmt.month(addMonths(planned.payoffMonth, 1)) : '—'} you keep paying ${fmt.money2(planned.finalPayment)}/month, but into ${rollTarget.name} (debt snowball).`
                      : 'The freed-up money goes to your savings.'
                  }
                >
                  <Select
                    value={lp.targets[loan.id] ?? ''}
                    onChange={(v) => onChange({ rollInto: v || undefined })}
                    options={[
                      { value: '', label: 'Savings (keep the money)' },
                      ...rollOptions.map((o) => ({ value: o.id, label: o.name })),
                    ]}
                  />
                </Field>
              </div>
            </>
          ) : (
            <p className="plan-note">
              <span className="roll-icon" aria-hidden="true">
                ↪
              </span>{' '}
              Number {lp.order.indexOf(loan.id) + 1} of {lp.order.length} in your {lp.mode} debt plan (above).
              {firstRolled && ` From ${fmt.month(firstRolled.month)} it also gets freed-up money — up to ${fmt.money(maxRolled)}/month.`}
            </p>
          )}
        </div>

        <EditActions sticky isNew={isNew} dirty={dirty} error={error} onCancel={onCancel} onDelete={onDelete} />
      </EditForm>

      <div className="stats compact">
        <Stat
          label="Paid off"
          value={planned.payoffMonth ? fmt.month(planned.payoffMonth) : 'Never'}
          tone={planned.payoffMonth ? undefined : 'bad'}
          detail={
            hasExtras && baseline.payoffMonth
              ? impact.monthsSaved > 0
                ? `${fmt.duration(impact.monthsSaved)} sooner than ${fmt.month(baseline.payoffMonth)}`
                : `Same as without early payments`
              : `${fmt.duration(planned.rows.length)} of payments`
          }
        />
        <Stat
          label="Total interest"
          value={fmt.money(planned.totalInterest)}
          detail={hasExtras && impact.comparable ? `instead of ${fmt.money(baseline.totalInterest)}` : 'over the rest of the loan'}
        />
        {impact.comparable ? (
          <Stat
            label="You save"
            value={fmt.money(impact.netSaving)}
            tone={impact.netSaving > 0 ? 'good' : impact.netSaving < 0 ? 'bad' : undefined}
            detail={
              planned.totalFees > 0
                ? `${fmt.money(impact.interestSaved)} interest − ${fmt.money(planned.totalFees)} fees`
                : 'interest avoided'
            }
          />
        ) : (
          // Regular payments alone never clear the loan, so there's no "without early payments" to compare with.
          <Stat label="You save" value="n/a" detail="Without early payments this loan is never paid off" />
        )}
        <Stat
          label="Monthly payment"
          value={fmt.money2(planned.initialPayment)}
          detail={paymentChanges ? `${fmt.money2(planned.finalPayment)} by the end` : undefined}
        />
      </div>

      <WhatIf loan={loan} allLoans={allLoans} lp={lp} onAdd={(x) => setExtras([...loan.extraPayments, x])} />

      <div className="section">
        <div className="section-head">
          <h3>Balance over time</h3>
          <Legend series={hasExtras ? chartSeries : chartSeries.slice(1)} />
        </div>
        <MonthLineChart data={chartData} series={hasExtras ? chartSeries : chartSeries.slice(1)} height={240} />
      </div>

      <Schedule rows={planned.rows} showRate={loan.rateChanges.length > 0} rolledLabel={lp.mode === 'manual' ? 'roll-over' : 'debt plan'} />
    </Card>
  );
}

function LoanSummary({ loan, color, onEdit }: { loan: Loan; color: string; onEdit: () => void }) {
  const { plan, projection, fmt } = usePlan();
  const lp = projection.loanPlan;
  const start = plan.settings.startMonth;
  const imp = impactOf(lp, loan.id);
  const taken = loanTakenBy(loan, start);
  return (
    <div className="item-row loan-grid loan-card" onDoubleClick={onEdit}>
      <div className="item-main">
        <span className="item-name">
          <span className="swatch" style={{ background: color }} /> {loan.name}
        </span>
        <span className="item-sub">
          {loan.kind} · {loan.annualRatePct}%{loan.rateChanges.length > 0 ? ' variable' : ''}
        </span>
      </div>
      <div className="num">
        <span className="cell-label">Balance now</span>
        {taken ? (
          fmt.money(balanceAt(loan, lp.schedules[loan.id], addMonths(start, -1)))
        ) : (
          // Not taken out yet at the plan's start, so nothing is owed now.
          <span className="muted" title={`First payment ${fmt.month(loan.firstPaymentMonth)}`}>
            Starts {fmt.month(addMonths(loan.firstPaymentMonth, -1))}
          </span>
        )}
      </div>
      <div className="num">
        <span className="cell-label">Payment</span>
        {fmt.money2(loanPaymentIn(plan, projection, loan.id, start))}
      </div>
      <div>
        <span className="cell-label">Paid off</span>
        {imp.planned.payoffMonth ? fmt.month(imp.planned.payoffMonth) : <Status ok={false}>Never</Status>}
      </div>
      <div className="num">
        <span className="cell-label">Early payments save</span>
        {imp.comparable && imp.netSaving > 0.5 ? fmt.money(imp.netSaving) : '—'}
      </div>
      <EditButton onClick={onEdit} label={`Edit ${loan.name}`} />
    </div>
  );
}

const MODES: { value: DebtStrategy['mode']; label: string; detail: string }[] = [
  { value: 'manual', label: 'Manual', detail: 'Each loan follows its own early payments and roll-over setting' },
  { value: 'avalanche', label: 'Avalanche', detail: 'Highest interest rate first — costs the least' },
  { value: 'snowball', label: 'Snowball', detail: 'Smallest balance first — quickest wins' },
];

function DebtPlan() {
  const { plan, setPlan, projection, fmt } = usePlan();
  const strategy = plan.debtStrategy;
  const start = plan.settings.startMonth;
  const set = (patch: Partial<DebtStrategy>) => setPlan((p) => ({ ...p, debtStrategy: { ...p.debtStrategy, ...patch } }));

  const lp = projection.loanPlan;
  // The same plan under each approach, so the choice is made on real numbers. The approach in use
  // is already worked out in the projection; only the other two need planning here.
  const variants = useMemo(
    () =>
      MODES.map((m) => {
        const mlp =
          m.value === lp.mode ? lp : planLoans(plan.loans, loanContext({ ...plan, debtStrategy: { ...plan.debtStrategy, mode: m.value } }));
        return { ...m, cost: totalCost(mlp, start), debtFree: debtFreeMonth(mlp) };
      }),
    [plan, start, lp],
  );
  const cheapest = Math.min(...variants.map((v) => v.cost));
  const byId = Object.fromEntries(plan.loans.map((l) => [l.id, l]));

  return (
    <Card
      title="Debt payoff plan"
      subtitle="Put an extra amount towards your loans each month. Whenever a loan is paid off, its payment moves to the next one in line."
    >
      <SettingsForm source={{ extraMonthly: strategy.extraMonthly, startMonth: strategy.startMonth }} onSave={set}>
        {(d, patch) => (
          <div className="form-grid">
            <Field label="Extra towards loans each month" hint="On top of regular payments. Used by avalanche and snowball.">
              <MoneyInput value={d.extraMonthly} onChange={(extraMonthly) => patch({ extraMonthly })} />
            </Field>
            <Field group label="Starting">
              <MonthInput value={d.startMonth} onChange={(v) => v && patch({ startMonth: v })} />
            </Field>
          </div>
        )}
      </SettingsForm>
      <div className="table-wrap">
        <table className="data-table strategy-table">
          <thead>
            <tr>
              <th>Approach</th>
              <th>Debt-free</th>
              <th className="num">Interest + fees still to pay</th>
              <th aria-label="Choose" />
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.value} className={v.value === strategy.mode ? 'selected' : ''}>
                <td>
                  <strong>{v.label}</strong>
                  <div className="muted small">{v.detail}</div>
                </td>
                <td>{v.debtFree === undefined ? '—' : v.debtFree === null ? 'Never' : fmt.month(v.debtFree)}</td>
                <td className={`num ${v.cost <= cheapest + 0.5 ? 'strong' : ''}`}>{fmt.money(v.cost)}</td>
                <td className="num">
                  {v.value === strategy.mode ? (
                    <span className="badge">In use</span>
                  ) : (
                    <button className="btn small-btn" onClick={() => set({ mode: v.value })}>
                      Use this
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lp.mode !== 'manual' && lp.order.length > 0 && (
        <ol className="payoff-order">
          {lp.order.map((id) => {
            const l = byId[id];
            const s = lp.schedules[id];
            return (
              <li key={id}>
                <span className="strong">{l.name}</span>
                <span className="muted">
                  {' '}
                  · {rateFor(l, start)}% · {fmt.money(balanceAt(l, lp.baselines[id], addMonths(start, -1)))}
                </span>
                <span className="payoff-when">{s.payoffMonth ? `paid off ${fmt.month(s.payoffMonth)}` : 'never paid off'}</span>
              </li>
            );
          })}
        </ol>
      )}
      {strategy.mode !== 'manual' && strategy.extraMonthly === 0 && (
        <p className="muted small">With no extra amount, only the payments of finished loans move on to the next one.</p>
      )}
    </Card>
  );
}

/** What a bonus-share early payment comes to over its first 12 months. */
function bonusSharePerYear(plan: Plan, x: ExtraPayment): number {
  const { bonusFor } = loanContext(plan);
  const from = x.startMonth > plan.settings.startMonth ? x.startMonth : plan.settings.startMonth;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const month = addMonths(from, i);
    if (x.endMonth && month > x.endMonth) break;
    sum += bonusFor!(month, { personId: x.bonusPersonId, month: x.bonusMonth });
  }
  return (sum * (x.bonusPct ?? 0)) / 100;
}

type Repeat = ExtraPayment['frequency'] | 'bonus';

function EarlyPaymentRow({
  x,
  onChange,
  onDelete,
}: {
  x: ExtraPayment;
  onChange: (p: Partial<ExtraPayment>) => void;
  onDelete: () => void;
}) {
  const { plan, fmt } = usePlan();
  const isBonus = x.kind === 'bonus';
  const recurring = isBonus || x.frequency !== 'once';
  return (
    <tr>
      <td>
        <MonthInput value={x.startMonth} ariaLabel={recurring ? 'From' : 'When'} onChange={(v) => v && onChange({ startMonth: v })} />
      </td>
      <td>
        {isBonus ? (
          <div className="bonus-share">
            <NumberInput
              value={x.bonusPct ?? 50}
              min={0}
              max={100}
              step={5}
              suffix="%"
              width={84}
              ariaLabel="Share of bonuses"
              onChange={(bonusPct) => onChange({ bonusPct })}
            />
            <span className="muted">of</span>
            <Select
              value={x.bonusPersonId ?? ''}
              ariaLabel="Whose bonuses"
              options={[{ value: '', label: 'everyone’s' }, ...plan.people.map((p) => ({ value: p.id, label: `${p.name}’s` }))]}
              onChange={(v) => onChange({ bonusPersonId: v || undefined })}
            />
            <Select
              value={x.bonusMonth ?? 0}
              ariaLabel="Which bonuses"
              options={[
                { value: 0, label: 'bonuses' },
                ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `bonuses paid in ${fmt.monthName(i + 1)}` })),
              ]}
              onChange={(v) => onChange({ bonusMonth: v || undefined })}
            />
            <span className="field-hint">≈ {fmt.money(bonusSharePerYear(plan, x))} a year</span>
          </div>
        ) : (
          <MoneyInput value={x.amount} ariaLabel="Amount" width={130} onChange={(amount) => onChange({ amount })} />
        )}
      </td>
      <td>
        <Select<Repeat>
          value={isBonus ? 'bonus' : x.frequency}
          ariaLabel="Repeat"
          options={[
            { value: 'once', label: 'Once' },
            { value: 'monthly', label: 'Every month' },
            { value: 'yearly', label: 'Every year' },
            { value: 'bonus', label: 'With bonuses' },
          ]}
          onChange={(v) =>
            onChange(
              v === 'bonus'
                ? { kind: 'bonus', frequency: 'monthly', bonusPct: x.bonusPct ?? 50 }
                : { kind: 'fixed', frequency: v, amount: x.amount || 1000 },
            )
          }
        />
      </td>
      <td>
        {recurring && (
          <MonthInput
            value={x.endMonth}
            optional
            emptyLabel="Until paid off"
            ariaLabel="Until"
            invalid={!!x.endMonth && x.endMonth < x.startMonth}
            onChange={(endMonth) => onChange({ endMonth })}
          />
        )}
      </td>
      <td>
        <DeleteButton onClick={onDelete} />
      </td>
    </tr>
  );
}

function WhatIf({ loan, allLoans, lp, onAdd }: { loan: Loan; allLoans: Loan[]; lp: LoanPlan; onAdd: (x: ExtraPayment) => void }) {
  const { plan, fmt } = usePlan();
  const [amount, setAmount] = useState(100);
  const [frequency, setFrequency] = useState<ExtraPayment['frequency']>('monthly');
  const [startMonth, setStartMonth] = useState(loan.firstPaymentMonth);

  // Re-plan every loan: paying one off sooner can free money for the others (roll-over, debt plan).
  const current = lp;
  const trialPlan = useMemo(() => {
    const extra: ExtraPayment = { id: 'what-if', amount, frequency, startMonth, kind: 'fixed' };
    const loans = allLoans.map((l) => (l.id === loan.id ? { ...l, extraPayments: [...l.extraPayments, extra] } : l));
    return planLoans(loans, loanContext(plan));
  }, [allLoans, loan.id, plan, amount, frequency, startMonth]);
  const cur = current.schedules[loan.id];
  const trial = trialPlan.schedules[loan.id];
  const monthsSaved = cur.rows.length - trial.rows.length;
  const saved = totalCost(current) - totalCost(trialPlan);
  const knockOn = allLoans.some((l) => l.id !== loan.id && trialPlan.schedules[l.id].payoffMonth !== current.schedules[l.id].payoffMonth);

  // Overpaying "earns" the loan's interest rate; savings earn the savings rate.
  const loanRate = rateFor(loan, startMonth);
  const savingsRate = plan.settings.savingsInterestPct;
  const overpayWins = loanRate > savingsRate;

  return (
    <div className="what-if">
      <div className="what-if-inputs">
        <strong>What if I paid</strong>
        <MoneyInput value={amount} onChange={setAmount} width={130} ariaLabel="Extra amount" />
        <Select
          value={frequency}
          ariaLabel="How often"
          onChange={setFrequency}
          options={[
            { value: 'monthly', label: 'extra every month' },
            { value: 'yearly', label: 'extra every year' },
            { value: 'once', label: 'once' },
          ]}
        />
        <span>from</span>
        <MonthInput value={startMonth} onChange={(v) => v && setStartMonth(v)} ariaLabel="Starting" />
      </div>
      <div className="what-if-result">
        {amount <= 0 ? (
          <span className="muted">Enter an amount to see the effect.</span>
        ) : (
          <>
            <span>
              {cur.payoffMonth === null ? (
                // Without a payoff date today there's nothing meaningful to compare savings against.
                trial.payoffMonth ? (
                  <>
                    The loan would be <strong>paid off in {fmt.month(trial.payoffMonth)}</strong> — today it never is
                  </>
                ) : (
                  <span className="muted">Still not enough to ever pay this loan off.</span>
                )
              ) : loan.strategy === 'reduce-term' ? (
                <>
                  Paid off <strong>{fmt.duration(monthsSaved)} sooner</strong>
                  {trial.payoffMonth && <> ({fmt.month(trial.payoffMonth)})</>}
                </>
              ) : (
                <>
                  Payment drops to <strong>{fmt.money2(trial.finalPayment)}</strong>
                </>
              )}
              {cur.payoffMonth !== null && (
                <>
                  {' · '}save <strong className="pos">{fmt.money(saved)}</strong>
                  {trial.totalFees > cur.totalFees && <span className="muted"> after fees</span>}
                  {knockOn && <span className="muted"> (other loans finish sooner too)</span>}
                </>
              )}
            </span>
            <button className="btn" onClick={() => onAdd({ id: uid(), amount, frequency, startMonth, kind: 'fixed' })}>
              Add to early payments
            </button>
          </>
        )}
      </div>
      <p className="what-if-note small">
        {overpayWins ? (
          <>
            Overpaying is like a guaranteed {loanRate}% return, versus the {savingsRate}% your savings earn — so it pays off, as long as you
            keep enough savings for emergencies.
          </>
        ) : (
          <>
            Your savings earn {savingsRate}%, more than this loan costs ({loanRate}%
            {loan.earlyRepaymentFeePct ? ` plus a ${loan.earlyRepaymentFeePct}% fee` : ''}) — keeping the money in savings may be better.
          </>
        )}
      </p>
    </div>
  );
}

function Schedule({ rows, showRate, rolledLabel }: { rows: LoanRow[]; showRate: boolean; rolledLabel: string }) {
  const { fmt } = usePlan();
  const [openYear, setOpenYear] = useState<number | null>(null);
  const toggle = (year: number) => setOpenYear((o) => (o === year ? null : year));
  const years = useMemo(() => {
    const map = new Map<
      number,
      { year: number; rows: LoanRow[]; payment: number; extra: number; interest: number; principal: number; fee: number; balance: number }
    >();
    for (const r of rows) {
      const y = yearOf(r.month);
      const e = map.get(y) ?? { year: y, rows: [], payment: 0, extra: 0, interest: 0, principal: 0, fee: 0, balance: 0 };
      e.rows.push(r);
      e.payment += r.payment;
      e.extra += r.extra;
      e.interest += r.interest;
      e.principal += r.principal;
      e.fee += r.fee;
      e.balance = r.balance;
      map.set(y, e);
    }
    return [...map.values()];
  }, [rows]);

  return (
    <details className="details">
      <summary>Repayment schedule ({rows.length} payments)</summary>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              {showRate && <th className="num">Rate</th>}
              <th className="num">Regular payments</th>
              <th className="num">Early payments</th>
              <th className="num">Interest</th>
              <th className="num">Principal</th>
              <th className="num">Fees</th>
              <th className="num">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <Fragment key={y.year}>
                <tr className="clickable" onClick={() => toggle(y.year)}>
                  <td>
                    <button
                      type="button"
                      className="row-toggle"
                      aria-expanded={openYear === y.year}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(y.year);
                      }}
                    >
                      <span className="caret" aria-hidden="true">
                        {openYear === y.year ? '▾' : '▸'}
                      </span>{' '}
                      {y.year}
                      <span className="visually-hidden"> month by month</span>
                    </button>
                  </td>
                  {showRate && <td className="num">{y.rows.at(-1)!.ratePct}%</td>}
                  <td className="num">{fmt.money(y.payment)}</td>
                  <td className="num">{y.extra ? fmt.money(y.extra) : '—'}</td>
                  <td className="num">{fmt.money(y.interest)}</td>
                  <td className="num">{fmt.money(y.principal + y.extra)}</td>
                  <td className="num">{y.fee ? fmt.money(y.fee) : '—'}</td>
                  <td className="num strong">{fmt.money(y.balance)}</td>
                </tr>
                {openYear === y.year &&
                  y.rows.map((r) => (
                    <tr key={r.month} className="sub-row">
                      <td>{fmt.month(r.month)}</td>
                      {showRate && <td className="num">{r.ratePct}%</td>}
                      <td className="num">{fmt.money2(r.payment)}</td>
                      <td className="num">
                        {r.extra ? fmt.money2(r.extra) : '—'}
                        {r.rolled > 0 && <span className="muted small"> ({rolledLabel})</span>}
                      </td>
                      <td className="num">{fmt.money2(r.interest)}</td>
                      <td className="num">{fmt.money2(r.principal + r.extra)}</td>
                      <td className="num">{r.fee ? fmt.money2(r.fee) : '—'}</td>
                      <td className="num">{fmt.money2(r.balance)}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
