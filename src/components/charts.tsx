import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YM } from '../types';
import { usePlan } from '../store';
import { useChartTheme } from '../theme';

export interface Series {
  key: string;
  name: string;
  color: string;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className="swatch" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}

function TooltipBox({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
  total,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormat: (l: string) => string;
  valueFormat: (v: number) => string;
  total?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const sum = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="tooltip">
      <div className="tooltip-title">{labelFormat(String(label))}</div>
      {payload.map((p) => (
        <div className="tooltip-row" key={String(p.dataKey)}>
          <span className="swatch" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="num">{valueFormat(p.value ?? 0)}</span>
        </div>
      ))}
      {total && payload.length > 1 && (
        <div className="tooltip-row total">
          <span />
          <span>Total</span>
          <span className="num">{valueFormat(sum)}</span>
        </div>
      )}
    </div>
  );
}

/** Year ticks for long ranges, quarterly month ticks for short ones. */
function monthTicks(months: YM[]): YM[] {
  if (months.length <= 30) return months.filter((m, i) => i === 0 || ['01', '04', '07', '10'].includes(m.slice(5)));
  const januaries = months.filter((m) => m.endsWith('-01'));
  const step = Math.ceil(januaries.length / 12);
  return januaries.filter((_, i) => i % step === 0);
}

function useAxes(months: YM[]) {
  const { fmt } = usePlan();
  const t = useChartTheme();
  const short = months.length <= 30;
  const axisProps = {
    stroke: t.axis,
    tick: { fill: t.muted, fontSize: 12 },
    tickLine: false,
  };
  return {
    t,
    fmt,
    xAxis: (
      <XAxis
        dataKey="month"
        ticks={monthTicks(months)}
        tickFormatter={(m: string) => (short ? fmt.month(m) : m.slice(0, 4))}
        interval="preserveStartEnd"
        minTickGap={14}
        {...axisProps}
      />
    ),
    yAxis: (
      <YAxis
        tickFormatter={(v: number) => fmt.compact(v)}
        width={64}
        {...axisProps}
        axisLine={false}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      />
    ),
    grid: <CartesianGrid vertical={false} stroke={t.grid} />,
  };
}

export interface GoalMarker {
  month: YM;
  value: number;
  label: string;
}

export function MonthLineChart<Row extends { month: YM }>({
  data,
  series,
  height = 260,
  markers = [],
}: {
  data: Row[];
  series: Series[];
  height?: number;
  markers?: GoalMarker[];
}) {
  const months = data.map((d) => d.month);
  const { t, fmt, xAxis, yAxis, grid } = useAxes(months);
  const inRange = new Set(months);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        {grid}
        {xAxis}
        {yAxis}
        <ReferenceLine y={0} stroke={t.baseline} />
        <Tooltip
          cursor={{ stroke: t.axis }}
          content={<TooltipBox labelFormat={fmt.month} valueFormat={fmt.money} />}
          isAnimationActive={false}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: s.color, stroke: t.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            type="monotone"
          />
        ))}
        {markers
          .filter((m) => inRange.has(m.month))
          .map((m) => (
            <ReferenceDot
              key={m.label + m.month}
              x={m.month}
              y={m.value}
              r={5}
              fill={t.series[0]}
              stroke={t.surface}
              strokeWidth={2}
              label={{
                value: m.label,
                position: 'top',
                fill: t.muted,
                fontSize: 12,
                stroke: t.surface,
                strokeWidth: 4,
                paintOrder: 'stroke',
              }}
            />
          ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MonthStackedArea<Row extends { month: YM }>({
  data,
  series,
  height = 260,
}: {
  data: Row[];
  series: Series[];
  height?: number;
}) {
  const months = data.map((d) => d.month);
  const { t, fmt, xAxis, yAxis, grid } = useAxes(months);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        {grid}
        {xAxis}
        {yAxis}
        <Tooltip
          cursor={{ stroke: t.axis }}
          content={<TooltipBox labelFormat={fmt.month} valueFormat={fmt.money} total />}
          isAnimationActive={false}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="1"
            stroke={s.color}
            strokeWidth={2}
            fill={s.color}
            fillOpacity={0.14}
            activeDot={{ r: 4, fill: s.color, stroke: t.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            type="monotone"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function YearBarChart<Row extends { year: number }>({
  data,
  series,
  height = 260,
}: {
  data: Row[];
  series: Series[];
  height?: number;
}) {
  const { fmt } = usePlan();
  const t = useChartTheme();
  const axisProps = { stroke: t.axis, tick: { fill: t.muted, fontSize: 12 }, tickLine: false };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis tickFormatter={(v: number) => fmt.compact(v)} width={64} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ fill: t.grid, fillOpacity: 0.5 }}
          content={<TooltipBox labelFormat={(l) => l} valueFormat={fmt.money} />}
          isAnimationActive={false}
        />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Plain HTML horizontal bars — one series, labels never clipped. */
export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format: (n: number) => string }) {
  const t = useChartTheme();
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: t.series[0] }} />
          </span>
          <span className="hbar-value num">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
