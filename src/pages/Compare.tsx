import { useMemo, useRef, useState } from 'react';
import { Legend, MonthLineChart } from '../components/charts';
import { Segmented } from '../components/inputs';
import { Card, Empty, PageHeader } from '../components/ui';
import { debtFreeMonth, impactOf } from '../engine/loan';
import { debtAtStart, goalStatus, project, typicalMonth, type Projection } from '../engine/projection';
import { usePlan } from '../store';
import { useChartTheme } from '../theme';
import type { PageId } from '../App';
import type { Plan } from '../types';

type Metric = 'diff' | 'net' | 'savings' | 'debt';

const METRICS: { value: Metric; label: string; title: string }[] = [
  { value: 'diff', label: 'Difference', title: 'How much better or worse off each plan is' },
  { value: 'net', label: 'Savings − debt', title: 'Net position: savings minus loans still owed' },
  { value: 'savings', label: 'Savings', title: 'Savings balance' },
  { value: 'debt', label: 'Debt', title: 'Loans still owed' },
];

export function Compare({ go }: { go: (p: PageId) => void }) {
  const { workspace, activeScenario, projection, scenarios, fmt } = usePlan();
  const t = useChartTheme();
  const [metric, setMetric] = useState<Metric>('diff');

  // The plan being edited is already projected by the store. The others are projected here, once per
  // version of each plan, so editing the active plan doesn't re-run them.
  const cache = useRef(new WeakMap<Plan, Projection>());
  const projections = useMemo(
    () =>
      workspace.scenarios.map((s) => {
        if (s.id === activeScenario.id) return projection;
        let p = cache.current.get(s.plan);
        if (!p) cache.current.set(s.plan, (p = project(s.plan)));
        return p;
      }),
    [workspace.scenarios, activeScenario.id, projection],
  );

  const results = useMemo(
    () =>
      workspace.scenarios.map((s, i) => {
        const p = projections[i];
        const last = p.rows.at(-1)!;
        const debtFree = debtFreeMonth(p.loanPlan);
        const goals = s.plan.goals.map((g) => goalStatus(s.plan, p, g));
        const start = s.plan.settings.startMonth;
        return {
          scenario: s,
          color: t.series[Math.min(i, t.series.length - 1)],
          projection: p,
          last,
          surplus: typicalMonth(s.plan, p).surplus,
          saved12: p.rows.slice(0, 12).reduce((sum, r) => sum + r.net, 0),
          debtNow: debtAtStart(s.plan, p),
          debtFree: debtFree === undefined ? null : debtFree === null ? 'never' : debtFree,
          interestLeft: s.plan.loans.reduce(
            (sum, l) => sum + p.schedules[l.id].rows.reduce((acc, r) => (r.month >= start ? acc + r.interest : acc), 0),
            0,
          ),
          // Only loans that would also be paid off without early payments have a saving to measure.
          earlySaving: s.plan.loans.reduce((sum, l) => {
            const imp = impactOf(p.loanPlan, l.id);
            return imp.comparable ? sum + imp.netSaving : sum;
          }, 0),
          goalsOnTrack: goals.filter((g) => g.onTrack).length,
          goalsTotal: goals.length,
        };
      }),
    [workspace.scenarios, projections, t],
  );

  if (workspace.scenarios.length < 2) {
    return (
      <>
        <PageHeader title="Compare plans" subtitle="Try a change without losing your current plan, then see which works out better." />
        <Card>
          <Empty
            action={
              <button
                className="btn primary"
                onClick={() => {
                  const name = prompt('Name for the copy', `${activeScenario.name} – alternative`);
                  if (name?.trim()) scenarios.duplicate(name.trim());
                }}
              >
                Copy my plan
              </button>
            }
          >
            Make a copy of your plan and change one thing — say, put your bonuses into the mortgage instead of savings, or pay off the car
            loan early. You'll edit the copy; your original stays as it is, and this page shows both side by side.
          </Empty>
        </Card>
      </>
    );
  }

  // Union of all months, since plans can start at different times or run for different lengths.
  const months = new Set<string>();
  for (const r of results) for (const row of r.projection.rows) months.add(row.month);
  const sorted = [...months].sort();
  const lookup = results.map((r) => new Map(r.projection.rows.map((row) => [row.month, row])));
  const chartData = sorted.map((month) => {
    const row: Record<string, string | number | undefined> = { month };
    const base = lookup[0].get(month);
    results.forEach((r, i) => {
      const m = lookup[i].get(month);
      if (!m) return;
      if (metric === 'diff') row[r.scenario.id] = base ? m.savings - m.debt - (base.savings - base.debt) : undefined;
      else row[r.scenario.id] = metric === 'net' ? m.savings - m.debt : metric === 'savings' ? m.savings : m.debt;
    });
    return row as { month: string };
  });
  const series = results.map((r) => ({ key: r.scenario.id, name: r.scenario.name, color: r.color }));

  const best = (values: number[], higherIsBetter: boolean) => {
    const target = higherIsBetter ? Math.max(...values) : Math.min(...values);
    return values.map((v) => values.some((x) => Math.abs(x - target) > 0.5) && Math.abs(v - target) <= 0.5);
  };

  type Row = { label: string; cells: string[]; best?: boolean[] };
  const money = (k: keyof (typeof results)[number], higher: boolean): Pick<Row, 'cells' | 'best'> => {
    const values = results.map((r) => r[k] as number);
    return { cells: values.map(fmt.money), best: best(values, higher) };
  };
  const debtFreeIndex = (v: string | null) => (v === null ? '0000' : v === 'never' ? '9999' : v);
  const debtFreeValues = results.map((r) => debtFreeIndex(r.debtFree));
  const earliest = [...debtFreeValues].sort()[0];

  const rows: Row[] = [
    { label: 'Left over each month', ...money('surplus', true) },
    { label: 'Saved in the next 12 months', ...money('saved12', true) },
    {
      label: 'Savings at the end',
      cells: results.map((r) => `${fmt.money(r.last.savings)} · ${fmt.month(r.last.month)}`),
      best: best(
        results.map((r) => r.last.savings),
        true,
      ),
    },
    {
      label: 'Debt at the end',
      cells: results.map((r) => fmt.money(r.last.debt)),
      best: best(
        results.map((r) => r.last.debt),
        false,
      ),
    },
    {
      label: 'Savings − debt at the end',
      cells: results.map((r) => fmt.money(r.last.savings - r.last.debt)),
      best: best(
        results.map((r) => r.last.savings - r.last.debt),
        true,
      ),
    },
    {
      label: 'Lowest savings',
      cells: results.map((r) => `${fmt.money(r.projection.lowest.savings)} · ${fmt.month(r.projection.lowest.month)}`),
      best: best(
        results.map((r) => r.projection.lowest.savings),
        true,
      ),
    },
    {
      label: 'Debt-free',
      cells: results.map((r) => (r.debtFree === null ? '—' : r.debtFree === 'never' ? 'Never' : fmt.month(r.debtFree))),
      best: debtFreeValues.map((v) => debtFreeValues.some((x) => x !== earliest) && v === earliest),
    },
    { label: 'Interest still to pay', ...money('interestLeft', false) },
    { label: 'Saved by early payments', ...money('earlySaving', true) },
    {
      label: 'Goals on track',
      cells: results.map((r) => (r.goalsTotal ? `${r.goalsOnTrack} of ${r.goalsTotal}` : '—')),
    },
  ];

  return (
    <>
      <PageHeader
        title="Compare plans"
        subtitle="The same numbers for each of your plans. The best value in each row is in bold."
        actions={
          <button
            className="btn"
            onClick={() => {
              const name = prompt('Name for the copy', `${activeScenario.name} – alternative`);
              if (name?.trim()) scenarios.duplicate(name.trim());
            }}
          >
            Copy current plan
          </button>
        }
      />

      <Card>
        <div className="table-wrap">
          <table className="data-table compare-table">
            <thead>
              <tr>
                <th />
                {results.map((r) => (
                  <th key={r.scenario.id} className="num">
                    <div className="compare-head">
                      <span>
                        <span className="swatch" style={{ background: r.color }} /> {r.scenario.name}
                      </span>
                      {r.scenario.id === workspace.activeId ? (
                        <span className="badge">Editing</span>
                      ) : (
                        <button className="btn ghost small-btn" onClick={() => scenarios.switchTo(r.scenario.id)}>
                          Edit this one
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="muted">{row.label}</td>
                  {row.cells.map((c, i) => (
                    <td key={i} className={`num ${row.best?.[i] ? 'strong' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td />
                {results.map((r) => (
                  <td key={r.scenario.id} className="num">
                    <span className="button-row end">
                      <button
                        className="btn ghost small-btn"
                        onClick={() => {
                          const name = prompt('Rename plan', r.scenario.name);
                          if (name?.trim()) scenarios.rename(r.scenario.id, name.trim());
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn ghost small-btn danger-text"
                        onClick={() => confirm(`Delete the plan "${r.scenario.name}"?`) && scenarios.remove(r.scenario.id)}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={METRICS.find((m) => m.value === metric)!.title}
        subtitle={
          metric === 'diff'
            ? `Savings minus debt, compared with “${results[0].scenario.name}”. Above zero means better off.`
            : metric === 'net'
              ? 'The fairest comparison when one plan pays off loans and another saves the money'
              : undefined
        }
        actions={
          <>
            <Segmented value={metric} onChange={setMetric} options={METRICS} ariaLabel="What to compare" />
            <Legend series={series} />
          </>
        }
      >
        <MonthLineChart data={chartData} series={series} height={320} />
      </Card>

      <p className="muted small">
        Tip: plans are independent copies. Changes you make now apply to “{activeScenario.name}”.{' '}
        <button className="link-btn" onClick={() => go('overview')}>
          Go to its overview
        </button>
      </p>
    </>
  );
}
