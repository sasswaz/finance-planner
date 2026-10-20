import { Fragment, useState } from 'react';
import { Legend, MonthLineChart, YearBarChart } from '../components/charts';
import { Field, MonthInput, NumberInput } from '../components/inputs';
import { SettingsForm } from '../components/items';
import { Card, PageHeader } from '../components/ui';
import { yearOf } from '../engine/dates';
import type { MonthRow } from '../engine/projection';
import { usePlan } from '../store';
import { useChartTheme } from '../theme';

export function Projection() {
  const { plan, setPlan, projection, fmt } = usePlan();
  const t = useChartTheme();
  const [openYear, setOpenYear] = useState<number | null>(null);
  const toggle = (year: number) => setOpenYear((o) => (o === year ? null : year));
  const s = plan.settings;

  const barSeries = [
    { key: 'income', name: 'Money in', color: t.series[0] },
    { key: 'outflow', name: 'Money out', color: t.series[1] },
  ];

  const exportCsv = () => {
    const header = [
      'Month',
      'Salaries',
      'Bonuses',
      'Other income',
      'Expenses',
      'Loan payments',
      'Early payments + fees',
      'Net',
      'Savings',
      'Debt',
    ];
    const lines = projection.rows.map((r) =>
      [r.month, r.salary, r.bonus, r.otherIncome, r.expenses, r.loanRegular, r.loanExtra, r.net, r.savings, r.debt]
        .map((v) => (typeof v === 'number' ? v.toFixed(2) : v))
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance-projection-${s.startMonth}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Projection"
        subtitle="Month by month: everything coming in, everything going out, and where your savings end up."
        actions={
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
        }
      />

      <Card>
        <SettingsForm
          source={{ startMonth: s.startMonth, horizonYears: s.horizonYears, inflationPct: s.inflationPct }}
          onSave={(v) => setPlan((p) => ({ ...p, settings: { ...p.settings, ...v } }))}
        >
          {(d, patch) => (
            <div className="form-grid">
              <Field group label="Plan starts">
                <MonthInput value={d.startMonth} onChange={(v) => v && patch({ startMonth: v })} />
              </Field>
              <Field label="Years to plan">
                <NumberInput
                  value={d.horizonYears}
                  min={1}
                  max={50}
                  suffix="years"
                  onChange={(v) => patch({ horizonYears: Math.round(v) })}
                />
              </Field>
              <Field label="Inflation on expenses" hint="Applied every January">
                <NumberInput
                  value={d.inflationPct}
                  step={0.5}
                  min={-10}
                  max={50}
                  suffix="%"
                  onChange={(inflationPct) => patch({ inflationPct })}
                />
              </Field>
            </div>
          )}
        </SettingsForm>
      </Card>

      <div className="grid-2">
        <Card title="Money in vs out, per year" actions={<Legend series={barSeries} />}>
          <YearBarChart data={projection.years} series={barSeries} height={260} />
        </Card>
        <Card title="Savings balance">
          <MonthLineChart data={projection.rows} series={[{ key: 'savings', name: 'Savings', color: t.series[0] }]} height={260} />
        </Card>
      </div>

      <Card title="Year by year" subtitle="Click a year to see its months">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Salaries</th>
                <th className="num">Bonuses</th>
                <th className="num">Other income</th>
                <th className="num">Expenses</th>
                <th className="num">Loan payments</th>
                <th className="num">Early payments</th>
                <th className="num">Net</th>
                <th className="num">Savings</th>
                <th className="num">Debt left</th>
              </tr>
            </thead>
            <tbody>
              {projection.years.map((y) => (
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
                    <td className="num">{fmt.money(y.salary)}</td>
                    <td className="num">{fmt.money(y.bonus)}</td>
                    <td className="num">{fmt.money(y.otherIncome)}</td>
                    <td className="num">{fmt.money(y.expenses)}</td>
                    <td className="num">{fmt.money(y.loanRegular)}</td>
                    <td className="num">{y.loanExtra ? fmt.money(y.loanExtra) : '—'}</td>
                    <td className={`num strong ${y.net < 0 ? 'neg' : 'pos'}`}>{fmt.money(y.net)}</td>
                    <td className={`num strong ${y.endSavings < 0 ? 'neg' : ''}`}>{fmt.money(y.endSavings)}</td>
                    <td className="num">{fmt.money(y.endDebt)}</td>
                  </tr>
                  {openYear === y.year &&
                    projection.rows.filter((r) => yearOf(r.month) === y.year).map((r) => <MonthLine key={r.month} r={r} />)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function MonthLine({ r }: { r: MonthRow }) {
  const { fmt } = usePlan();
  const notes = r.events.map((e) => e.label).join(', ');
  return (
    <tr className="sub-row" title={notes || undefined}>
      <td>
        {fmt.month(r.month)}
        {notes && <span className="row-note">{notes}</span>}
      </td>
      <td className="num">{fmt.money(r.salary)}</td>
      <td className="num">{r.bonus ? fmt.money(r.bonus) : '—'}</td>
      <td className="num">{r.otherIncome ? fmt.money(r.otherIncome) : '—'}</td>
      <td className="num">{fmt.money(r.expenses)}</td>
      <td className="num">{fmt.money(r.loanRegular)}</td>
      <td className="num">{r.loanExtra ? fmt.money(r.loanExtra) : '—'}</td>
      <td className={`num ${r.net < 0 ? 'neg' : 'pos'}`}>{fmt.money(r.net)}</td>
      <td className={`num ${r.savings < 0 ? 'neg' : ''}`}>{fmt.money(r.savings)}</td>
      <td className="num">{fmt.money(r.debt)}</td>
    </tr>
  );
}
