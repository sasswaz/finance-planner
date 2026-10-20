import type { Bonus, ExpenseCategory, Goal, Person, Plan, YM } from '../types';
import { EXPENSE_CATEGORIES } from '../types';
import { addMonths, monthOf, monthlyEquivalent, monthsBetween, occursIn, yearOf } from './dates';
import { balanceAt, planLoans, plannedExtra, type LoanContext, type LoanPlan, type LoanRow, type LoanSchedule } from './loan';

export interface PlanEvent {
  kind: 'income' | 'expense' | 'loan' | 'info';
  label: string;
  amount: number;
}

export interface MonthRow {
  month: YM;
  salary: number;
  bonus: number;
  otherIncome: number;
  income: number;
  expenses: number;
  byCategory: Record<ExpenseCategory, number>;
  /** Income split by where it comes from ("Me – salary", "Bonuses", "Rental income"…). */
  incomeBySource: Record<string, number>;
  loanRegular: number;
  /** Early repayments plus their fees. */
  loanExtra: number;
  outflow: number;
  net: number;
  /** Savings balance at the end of the month. */
  savings: number;
  /** Total loan principal outstanding at the end of the month. */
  debt: number;
  events: PlanEvent[];
}

export interface YearRow {
  year: number;
  salary: number;
  bonus: number;
  otherIncome: number;
  income: number;
  expenses: number;
  loanRegular: number;
  loanExtra: number;
  outflow: number;
  net: number;
  endSavings: number;
  endDebt: number;
}

export interface Projection {
  rows: MonthRow[];
  years: YearRow[];
  loanPlan: LoanPlan;
  schedules: Record<string, LoanSchedule>;
  lowest: { month: YM; savings: number };
}

const isActive = (item: { startMonth: YM; endMonth?: YM }, ym: YM) =>
  monthsBetween(item.startMonth, ym) >= 0 && (!item.endMonth || monthsBetween(ym, item.endMonth) >= 0);

const emptyCategories = () => Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, number>;

/** Compounding factor applied each January after the plan's first year. */
const growth = (pct: number, start: YM, ym: YM) => Math.pow(1 + pct / 100, Math.max(0, yearOf(ym) - yearOf(start)));

/** Take-home salary in `ym` and whether bonuses are paid, after any salary changes and raises. */
export function salaryAt(person: Person, planStart: YM, ym: YM): { salary: number; bonusesPaid: boolean } {
  let latest: Person['salaryChanges'][number] | undefined;
  for (const c of person.salaryChanges) if (c.month <= ym && (!latest || c.month >= latest.month)) latest = c;
  if (!latest) return { salary: person.netMonthlySalary * growth(person.annualRaisePct, planStart, ym), bonusesPaid: true };
  const from = latest.month > planStart ? latest.month : planStart;
  return { salary: latest.netMonthlySalary * growth(person.annualRaisePct, from, ym), bonusesPaid: latest.bonusesPaid };
}

/** Bonuses actually paid in `ym` (none while a salary change pauses them). */
export function bonusesPaidIn(plan: Plan, ym: YM): { person: Person; amount: number; label: string; month: number }[] {
  const out = [];
  for (const p of plan.people) {
    const now = salaryAt(p, plan.settings.startMonth, ym);
    if (!now.bonusesPaid) continue;
    for (const b of p.bonuses) {
      if (!occursIn(b, ym)) continue;
      const amount = bonusAmount(b, now.salary);
      if (amount > 0) out.push({ person: p, amount, label: b.label, month: monthOf(ym) });
    }
  }
  return out;
}

/** A bonus payment in money, given the monthly net salary at the time. */
export const bonusAmount = (b: Bonus, salary: number) => (b.amountType === 'salary' ? b.amount * salary : b.amount);

/** Everything the loan maths needs from the rest of the plan. */
export function loanContext(plan: Plan): LoanContext {
  // Bonus shares ask about the same months over and over; work each month out once.
  const cache = new Map<YM, ReturnType<typeof bonusesPaidIn>>();
  const paidIn = (ym: YM) => {
    let v = cache.get(ym);
    if (!v) cache.set(ym, (v = bonusesPaidIn(plan, ym)));
    return v;
  };
  const { debtStrategy: strategy, settings } = plan;
  return {
    bonusFor: (ym, filter) =>
      paidIn(ym)
        .filter((b) => (!filter.personId || b.person.id === filter.personId) && (!filter.month || b.month === filter.month))
        .reduce((sum, b) => sum + b.amount, 0),
    // The debt plan can't start before the plan itself.
    strategy: { ...strategy, startMonth: strategy.startMonth > settings.startMonth ? strategy.startMonth : settings.startMonth },
  };
}

/** A loan exists from the month before its first payment; one starting later isn't owed yet. */
export const loanTakenBy = (loan: { firstPaymentMonth: YM }, ym: YM) => ym >= addMonths(loan.firstPaymentMonth, -1);

export function project(plan: Plan): Projection {
  const { settings } = plan;
  const start = settings.startMonth;
  const months = Math.max(1, Math.round(settings.horizonYears * 12));
  const savingsRate = settings.savingsInterestPct / 100 / 12;

  const ctx = loanContext(plan);
  const loanPlan = planLoans(plan.loans, ctx);
  const { schedules } = loanPlan;
  const rowsByMonth = Object.fromEntries(
    plan.loans.map((l) => [l.id, new Map<YM, LoanRow>(schedules[l.id].rows.map((r) => [r.month, r]))]),
  );

  const rows: MonthRow[] = [];
  let savings = settings.startingSavings;

  for (let i = 0; i < months; i++) {
    const month = addMonths(start, i);
    const events: PlanEvent[] = [];

    const incomeBySource: Record<string, number> = {};
    const addSource = (label: string, amount: number) => (incomeBySource[label] = (incomeBySource[label] ?? 0) + amount);

    let salary = 0;
    for (const p of plan.people) {
      const now = salaryAt(p, start, month);
      salary += now.salary;
      if (now.salary) addSource(`${p.name} – salary`, now.salary);
      for (const c of p.salaryChanges) {
        if (c.month === month) events.push({ kind: 'info', label: `${p.name}: ${c.label || 'salary change'}`, amount: 0 });
      }
    }
    let bonus = 0;
    for (const b of bonusesPaidIn(plan, month)) {
      bonus += b.amount;
      addSource('Bonuses', b.amount);
      events.push({ kind: 'income', label: `${b.person.name} – ${b.label || 'bonus'}`, amount: b.amount });
    }

    let otherIncome = 0;
    for (const inc of plan.incomes) {
      if (!occursIn(inc, month)) continue;
      otherIncome += inc.amount;
      addSource(inc.name || 'Other income', inc.amount);
      if (inc.frequency !== 'monthly') events.push({ kind: 'income', label: inc.name, amount: inc.amount });
    }

    const byCategory = emptyCategories();
    const inflation = growth(settings.inflationPct, start, month);
    let expenses = 0;
    for (const e of plan.expenses) {
      if (!occursIn(e, month)) continue;
      const amount = e.amount * inflation;
      byCategory[e.category] += amount;
      expenses += amount;
      if (e.frequency === 'once' || e.frequency === 'yearly') {
        events.push({ kind: 'expense', label: e.name, amount });
      }
    }

    let loanRegular = 0;
    let loanExtra = 0;
    let debt = 0;
    for (const loan of plan.loans) {
      const s = schedules[loan.id];
      const row = rowsByMonth[loan.id].get(month);
      if (row) {
        loanRegular += row.payment;
        loanExtra += row.extra + row.fee;
        const planned = plannedExtra(loan, month, ctx);
        if (planned.lump + planned.bonus > 0 && row.extra > 0) {
          events.push({
            kind: 'loan',
            label: `Early payment – ${loan.name}${planned.bonus > 0 ? ' (from bonus)' : ''}`,
            amount: Math.min(planned.lump + planned.bonus, row.extra),
          });
        }
        if (s.payoffMonth === month) events.push({ kind: 'info', label: `${loan.name} paid off`, amount: 0 });
        for (const c of loan.rateChanges) {
          if (c.month === month) events.push({ kind: 'info', label: `${loan.name} rate becomes ${c.annualRatePct}%`, amount: 0 });
        }
        for (const ri of loanPlan.rollIns[loan.id]) {
          if (ri.startMonth === month) {
            events.push({ kind: 'info', label: `${ri.fromName}'s payment now goes to ${loan.name}`, amount: 0 });
          }
        }
      }
      if (row) debt += row.balance;
      else if (loanTakenBy(loan, month)) debt += balanceAt(loan, s, month);
    }

    const income = salary + bonus + otherIncome;
    const outflow = expenses + loanRegular + loanExtra;
    const net = income - outflow;
    savings = savings * (1 + savingsRate) + net;

    rows.push({
      month,
      salary,
      bonus,
      otherIncome,
      income,
      expenses,
      byCategory,
      incomeBySource,
      loanRegular,
      loanExtra,
      outflow,
      net,
      savings,
      debt,
      events,
    });
  }

  return { rows, years: summarizeYears(rows), loanPlan, schedules, lowest: lowestPoint(rows) };
}

function summarizeYears(rows: MonthRow[]): YearRow[] {
  const years = new Map<number, YearRow>();
  for (const r of rows) {
    const y = yearOf(r.month);
    let yr = years.get(y);
    if (!yr) {
      yr = {
        year: y,
        salary: 0,
        bonus: 0,
        otherIncome: 0,
        income: 0,
        expenses: 0,
        loanRegular: 0,
        loanExtra: 0,
        outflow: 0,
        net: 0,
        endSavings: 0,
        endDebt: 0,
      };
      years.set(y, yr);
    }
    yr.salary += r.salary;
    yr.bonus += r.bonus;
    yr.otherIncome += r.otherIncome;
    yr.income += r.income;
    yr.expenses += r.expenses;
    yr.loanRegular += r.loanRegular;
    yr.loanExtra += r.loanExtra;
    yr.outflow += r.outflow;
    yr.net += r.net;
    yr.endSavings = r.savings;
    yr.endDebt = r.debt;
  }
  return [...years.values()];
}

function lowestPoint(rows: MonthRow[]) {
  let lowest = { month: rows[0].month, savings: rows[0].savings };
  for (const r of rows) if (r.savings < lowest.savings) lowest = { month: r.month, savings: r.savings };
  return lowest;
}

/** Total loan principal owed at the start of the plan. */
export function debtAtStart(plan: Plan, projection: Projection): number {
  const start = plan.settings.startMonth;
  const before = addMonths(start, -1);
  return plan.loans.filter((l) => loanTakenBy(l, start)).reduce((s, l) => s + balanceAt(l, projection.schedules[l.id], before), 0);
}

/** Regular loan payment due in `ym` (0 once paid off), ignoring early payments. */
export function loanPaymentIn(plan: Plan, projection: Projection, loanId: string, ym: YM): number {
  const loan = plan.loans.find((l) => l.id === loanId)!;
  const s = projection.schedules[loanId];
  if (!s.rows.length || (s.payoffMonth && s.payoffMonth < ym)) return 0;
  if (ym < loan.firstPaymentMonth) return loanTakenBy(loan, ym) ? s.initialPayment : 0;
  return s.rows[monthsBetween(loan.firstPaymentMonth, ym)]?.payment ?? s.finalPayment;
}

/** A "normal" month at the start of the plan: no bonuses, one-offs, or early payments. */
export function typicalMonth(plan: Plan, projection: Projection) {
  const ym = plan.settings.startMonth;
  const salary = plan.people.reduce((s, p) => s + salaryAt(p, ym, ym).salary, 0);
  const otherIncome = plan.incomes.filter((i) => isActive(i, ym)).reduce((s, i) => s + monthlyEquivalent(i.amount, i.frequency), 0);
  const expenses = plan.expenses.filter((e) => isActive(e, ym)).reduce((s, e) => s + monthlyEquivalent(e.amount, e.frequency), 0);
  const loans = plan.loans.reduce((s, l) => s + loanPaymentIn(plan, projection, l.id, ym), 0);
  const income = salary + otherIncome;
  return { income, expenses, loans, surplus: income - expenses - loans };
}

export interface GoalStatus {
  goal: Goal;
  /** First month the savings balance reaches the target, if within the horizon. */
  reachedMonth: YM | null;
  onTrack: boolean;
  projectedAtTarget: number;
  /** Extra per month needed (from now) to hit the target on time; 0 if on track or unknown. */
  monthlyGap: number;
  /** The target date is after the plan ends, so whether it's reached in time isn't known. */
  beyondHorizon: boolean;
}

export function goalStatus(plan: Plan, projection: Projection, goal: Goal): GoalStatus {
  const { rows } = projection;
  const reached =
    plan.settings.startingSavings >= goal.targetAmount
      ? plan.settings.startMonth
      : (rows.find((r) => r.savings >= goal.targetAmount)?.month ?? null);
  const last = rows.at(-1)!;
  const beyondHorizon = goal.targetMonth > last.month;
  const atTarget = rows.find((r) => r.month === goal.targetMonth) ?? (goal.targetMonth < rows[0].month ? undefined : last);
  const projectedAtTarget = atTarget ? atTarget.savings : plan.settings.startingSavings;
  // Past the plan's end we only know it's on track if the target is already reached within the plan.
  const onTrack = beyondHorizon ? reached !== null : projectedAtTarget >= goal.targetAmount;
  const monthsLeft = Math.max(1, monthsBetween(plan.settings.startMonth, goal.targetMonth) + 1);
  return {
    goal,
    reachedMonth: reached,
    onTrack,
    projectedAtTarget,
    monthlyGap: onTrack || beyondHorizon ? 0 : (goal.targetAmount - projectedAtTarget) / monthsLeft,
    beyondHorizon,
  };
}
