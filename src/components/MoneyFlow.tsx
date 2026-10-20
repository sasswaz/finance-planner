import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MonthRow } from '../engine/projection';
import { usePlan } from '../store';
import { useChartTheme } from '../theme';
import { EXPENSE_CATEGORIES } from '../types';
import { Legend } from './charts';

type Group = 'income' | 'fromSavings' | 'spending' | 'loans' | 'saved';

interface Flow {
  id: string;
  label: string;
  value: number;
  group: Group;
}

const MAX_SOURCES = 6;
const MAX_SPENDING = 6;

/** Keeps the largest flows and folds the rest into one "other" flow. */
function fold(flows: Flow[], keep: number, other: Omit<Flow, 'value'>): Flow[] {
  const sorted = flows.filter((f) => f.value > 0.5).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep + 1) return sorted;
  const rest = sorted.slice(keep).reduce((s, f) => s + f.value, 0);
  return [...sorted.slice(0, keep), { ...other, value: rest }];
}

export function flowsFromRows(rows: MonthRow[]) {
  const income: Record<string, number> = {};
  const spending: Record<string, number> = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]));
  let loanRegular = 0;
  let loanExtra = 0;
  let net = 0;
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.incomeBySource)) income[k] = (income[k] ?? 0) + v;
    for (const c of EXPENSE_CATEGORIES) spending[c] += r.byCategory[c];
    loanRegular += r.loanRegular;
    loanExtra += r.loanExtra;
    net += r.net;
  }
  const sources = fold(
    Object.entries(income).map(([label, value]) => ({ id: `in:${label}`, label, value, group: 'income' as const })),
    MAX_SOURCES,
    { id: 'in:other', label: 'Other income', group: 'income' },
  );
  if (net < -0.5) sources.push({ id: 'in:savings', label: 'From savings', value: -net, group: 'fromSavings' });

  // The "Other" category and any small categories end up together in one "Other spending" flow.
  const { Other: otherCategory, ...named } = spending;
  const kept = fold(
    Object.entries(named).map(([label, value]) => ({ id: `out:${label}`, label, value, group: 'spending' as const })),
    MAX_SPENDING,
    { id: 'out:other', label: 'Other spending', group: 'spending' },
  );
  const folded = kept.find((f) => f.id === 'out:other');
  if (folded) folded.value += otherCategory;
  else if (otherCategory > 0.5) kept.push({ id: 'out:other', label: 'Other spending', value: otherCategory, group: 'spending' });
  const targets = [...kept.filter((f) => f.id !== 'out:other'), ...kept.filter((f) => f.id === 'out:other')];
  if (loanRegular > 0.5) targets.push({ id: 'out:loans', label: 'Loan payments', value: loanRegular, group: 'loans' });
  if (loanExtra > 0.5) targets.push({ id: 'out:early', label: 'Early loan payments', value: loanExtra, group: 'loans' });
  if (net > 0.5) targets.push({ id: 'out:saved', label: 'Saved', value: net, group: 'saved' });

  const total = sources.reduce((s, f) => s + f.value, 0);
  return { sources, targets, total };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A band from (x0, y0..y0+h) to (x1, y1..y1+h), curved horizontally. */
function band(x0: number, y0: number, x1: number, y1: number, h: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z`;
}

interface Placed extends Flow {
  y: number;
  h: number;
  /** Where this flow's band meets the hub. */
  hubY: number;
}

export function MoneyFlow({ rows, periodLabel }: { rows: MonthRow[]; periodLabel: string }) {
  const { fmt } = usePlan();
  const t = useChartTheme();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const { sources, targets, total } = useMemo(() => flowsFromRows(rows), [rows]);

  const color: Record<Group, string> = {
    income: t.series[0],
    spending: t.series[1],
    saved: t.series[2],
    loans: t.series[3],
    fromSavings: t.muted,
  };
  const legend = [
    { key: 'income', name: 'Income', color: color.income },
    { key: 'spending', name: 'Spending', color: color.spending },
    ...(targets.some((f) => f.group === 'loans') ? [{ key: 'loans', name: 'Loans', color: color.loans }] : []),
    ...(targets.some((f) => f.group === 'saved') ? [{ key: 'saved', name: 'Saved', color: color.saved }] : []),
  ];

  const narrow = width < 560;
  const labelW = narrow ? Math.min(112, width * 0.3) : Math.min(200, width * 0.22);
  const nodeW = 10;
  const hubW = 14;
  const gap = 30; // room for a two-line label between nodes
  const padTop = 30;
  const n = Math.max(sources.length, targets.length);
  const height = Math.max(300, n * 46 + padTop + 12);
  const avail = height - padTop - 12;
  const k = total > 0 ? (avail - gap * (n - 1)) / total : 0;
  const leftX = labelW;
  const rightX = width - labelW - nodeW;
  const hubX = (leftX + nodeW + rightX) / 2 - hubW / 2;
  const hubH = total * k;
  const hubTop = padTop + (avail - hubH) / 2;

  const place = (flows: Flow[]): Placed[] => {
    const colH = flows.reduce((s, f) => s + f.value * k, 0) + gap * (flows.length - 1);
    let y = padTop + (avail - colH) / 2;
    let hy = hubTop;
    return flows.map((f) => {
      const h = f.value * k;
      const placed = { ...f, y, h, hubY: hy };
      y += h + gap;
      hy += h;
      return placed;
    });
  };
  const left = place(sources);
  const right = place(targets);
  const maxChars = Math.max(6, Math.floor((labelW - 10) / 6.6));
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const opacity = (id: string) => (!hover ? 0.3 : hover.id === id ? 0.6 : 0.08);
  const hovered = hover && [...left, ...right].find((f) => f.id === hover.id);

  const onMove = (id: string) => (e: React.MouseEvent) => {
    const box = ref.current!.getBoundingClientRect();
    setHover({ id, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const nodeLabel = (f: Placed, side: 'left' | 'right') => {
    const x = side === 'left' ? leftX - 8 : rightX + nodeW + 8;
    const cy = f.y + f.h / 2;
    return (
      <g key={`label-${f.id}`} textAnchor={side === 'left' ? 'end' : 'start'}>
        <text x={x} y={cy - 3} className="flow-label">
          {clip(f.label)}
        </text>
        <text x={x} y={cy + 12} className="flow-value">
          {fmt.money(f.value)}
        </text>
      </g>
    );
  };

  return (
    <div className="money-flow">
      {total > 0 && <Legend series={legend} />}
      <div ref={ref} className="flow-canvas" onMouseLeave={() => setHover(null)}>
        {total <= 0 && <p className="muted">No money coming in or going out in this period.</p>}
        {total > 0 && width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Money flow for ${periodLabel}: ${fmt.money(total)} in total. See the table below for details.`}
          >
            {left.map((f) => (
              <path
                key={f.id}
                d={band(leftX + nodeW, f.y, hubX, f.hubY, f.h)}
                fill={color[f.group]}
                fillOpacity={opacity(f.id)}
                onMouseMove={onMove(f.id)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
            {right.map((f) => (
              <path
                key={f.id}
                d={band(hubX + hubW, f.hubY, rightX, f.y, f.h)}
                fill={color[f.group]}
                fillOpacity={opacity(f.id)}
                onMouseMove={onMove(f.id)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
            {[...left.map((f) => ({ f, x: leftX })), ...right.map((f) => ({ f, x: rightX }))].map(({ f, x }) => (
              <rect
                key={`node-${f.id}`}
                x={x}
                y={f.y}
                width={nodeW}
                height={Math.max(2, f.h)}
                rx={2}
                fill={color[f.group]}
                onMouseMove={onMove(f.id)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
            <rect x={hubX} y={hubTop} width={hubW} height={hubH} rx={3} fill={t.axis} />
            <text x={hubX + hubW / 2} y={hubTop - 10} textAnchor="middle" className="flow-hub">
              {fmt.money(total)}
            </text>
            {left.map((f) => nodeLabel(f, 'left'))}
            {right.map((f) => nodeLabel(f, 'right'))}
          </svg>
        )}
        {hover && hovered && (
          <div className="tooltip flow-tooltip" style={{ left: Math.min(hover.x + 14, width - 200), top: hover.y + 14 }}>
            <div className="tooltip-row">
              <span className="swatch" style={{ background: color[hovered.group] }} />
              <span>{hovered.label}</span>
              <span className="num">{fmt.money(hovered.value)}</span>
            </div>
            <div className="muted small">
              {pct(hovered.value)} of {hovered.id.startsWith('in:') ? 'money in' : 'money out'} · {periodLabel}
            </div>
          </div>
        )}
      </div>
      {total > 0 && (
        <details className="details">
          <summary>Show as a table</summary>
          <div className="grid-2 flow-tables">
            {[
              { title: 'Money in', flows: sources },
              { title: 'Money out', flows: targets },
            ].map(({ title, flows }) => (
              <table className="data-table" key={title}>
                <thead>
                  <tr>
                    <th>{title}</th>
                    <th className="num">Amount</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {flows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.label}</td>
                      <td className="num">{fmt.money(f.value)}</td>
                      <td className="num muted">{pct(f.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
