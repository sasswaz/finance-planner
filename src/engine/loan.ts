import type { DebtStrategy, Loan, YM } from '../types';
import { addMonths, monthsBetween, occursIn } from './dates';

/** Longest schedule we simulate; anything beyond is reported as never paying off. */
const MAX_MONTHS = 600;
const EPS = 0.005;

export interface LoanRow {
  month: YM;
  payment: number;
  interest: number;
  principal: number;
  /** All early repayment this month, including money rolled over from other loans or the debt budget. */
  extra: number;
  /** The part of `extra` that came from outside this loan's own plan (roll-overs, debt budget). */
  rolled: number;
  fee: number;
  balance: number;
  ratePct: number;
}

export interface LoanSchedule {
  rows: LoanRow[];
  initialPayment: number;
  /** The regular payment in force at the end (it changes with rate changes or "lower payment"). */
  finalPayment: number;
  totalInterest: number;
  totalFees: number;
  totalExtra: number;
  /** Month of the final payment, or null if the loan never pays off. */
  payoffMonth: YM | null;
}

/** Money freed by a paid-off loan, paid into another loan every month from `startMonth`. */
export interface RollIn {
  fromLoanId: string;
  fromName: string;
  startMonth: YM;
  amount: number;
}

export interface BonusFilter {
  personId?: string;
  month?: number;
}

/** What loan maths needs to know about the rest of the plan. */
export interface LoanContext {
  /** Bonus money paid in `ym` that matches the filter. */
  bonusFor?: (ym: YM, filter: BonusFilter) => number;
  strategy?: DebtStrategy;
}

/** Standard annuity payment for principal `p` at monthly rate `r` over `n` months. */
export function annuityPayment(p: number, r: number, n: number): number {
  if (n <= 0) return p;
  if (r === 0) return p / n;
  return (p * r) / (1 - Math.pow(1 + r, -n));
}

/** Months needed to repay `p` with payment `pmt`; Infinity if the payment doesn't cover interest. */
export function monthsToRepay(p: number, r: number, pmt: number): number {
  if (p <= 0) return 0;
  if (pmt <= 0) return Infinity;
  if (r === 0) return Math.ceil(p / pmt);
  if (pmt <= p * r) return Infinity;
  return Math.ceil(-Math.log(1 - (p * r) / pmt) / Math.log(1 + r) - 1e-9);
}

/** The regular payment at the loan's starting rate. */
export function regularPayment(loan: Loan): number {
  return loan.inputMode === 'payment' ? loan.monthlyPayment : annuityPayment(loan.balance, loan.annualRatePct / 1200, loan.remainingMonths);
}

/** Interest rate in force in `ym`, taking rate changes into account. */
export function rateFor(loan: Loan, ym: YM): number {
  let rate = loan.annualRatePct;
  let from = '';
  for (const c of loan.rateChanges) {
    if (c.month <= ym && c.month >= from) {
      from = c.month;
      rate = c.annualRatePct;
    }
  }
  return rate;
}

/** Early repayment planned on this loan for `ym`: regular monthly amounts, lump sums, and bonus shares. */
export function plannedExtra(loan: Loan, ym: YM, ctx: LoanContext = {}): { monthly: number; lump: number; bonus: number } {
  const out = { monthly: 0, lump: 0, bonus: 0 };
  for (const x of loan.extraPayments) {
    if (x.kind === 'bonus') {
      if (ctx.bonusFor && occursIn({ ...x, frequency: 'monthly' }, ym)) {
        out.bonus += ((x.bonusPct ?? 0) / 100) * ctx.bonusFor(ym, { personId: x.bonusPersonId, month: x.bonusMonth });
      }
    } else if (occursIn(x, ym)) {
      if (x.frequency === 'monthly') out.monthly += x.amount;
      else out.lump += x.amount;
    }
  }
  return out;
}

export function extraDueIn(loan: Loan, ym: YM, ctx: LoanContext = {}): number {
  const p = plannedExtra(loan, ym, ctx);
  return p.monthly + p.lump + p.bonus;
}

/** Steps one loan forward a month at a time, so several loans can be simulated side by side. */
class LoanStepper {
  private r: number;
  payment: number;
  private initialPayment: number;
  private balance: number;
  private termLeft: number;
  readonly rows: LoanRow[] = [];
  private totalInterest = 0;
  private totalFees = 0;
  private totalExtra = 0;

  constructor(
    readonly loan: Loan,
    private readonly withExtras: boolean,
    private readonly ctx: LoanContext,
  ) {
    this.r = loan.annualRatePct / 1200;
    this.payment = regularPayment(loan);
    this.initialPayment = this.payment;
    this.balance = loan.balance;
    // Months left on the contract; banks recalculate the payment over this when the rate changes.
    this.termLeft = loan.inputMode === 'term' ? loan.remainingMonths : monthsToRepay(this.balance, this.r, this.payment);
  }

  get paidOff() {
    return this.balance <= EPS;
  }

  get done() {
    return this.paidOff || this.rows.length >= MAX_MONTHS;
  }

  get nextMonth(): YM {
    return addMonths(this.loan.firstPaymentMonth, this.rows.length);
  }

  /** Pays one month. `offered` is outside money available for early repayment; returns how much was used. */
  step(offered = 0): number {
    const { loan } = this;
    const month = this.nextMonth;
    const ratePct = rateFor(loan, month);
    if (ratePct / 1200 !== this.r) {
      this.r = ratePct / 1200;
      if (this.termLeft > 0 && Number.isFinite(this.termLeft)) this.payment = annuityPayment(this.balance, this.r, this.termLeft);
    }
    if (this.rows.length === 0) this.initialPayment = this.payment;

    const interest = this.balance * this.r;
    const paid = Math.min(this.payment, this.balance + interest);
    const principal = paid - interest;
    this.balance -= principal;

    const planned = this.withExtras ? Math.min(extraDueIn(loan, month, this.ctx), Math.max(this.balance, 0)) : 0;
    const rolled = Math.min(Math.max(offered, 0), Math.max(this.balance - planned, 0));
    const extra = planned + rolled;
    const fee = (extra * loan.earlyRepaymentFeePct) / 100;
    this.balance -= extra;
    this.termLeft -= 1;

    if (extra > 0 && this.balance > EPS) {
      // "Lower payment" applies to this loan's own early payments. Money rolled in from elsewhere
      // (roll-overs, the debt plan) is meant to keep total spending flat, so it shortens the loan.
      if (loan.strategy === 'reduce-payment' && planned > 0 && Number.isFinite(this.termLeft) && this.termLeft > 0) {
        this.payment = Math.min(this.payment, annuityPayment(this.balance, this.r, this.termLeft));
      } else {
        this.termLeft = monthsToRepay(this.balance, this.r, this.payment);
      }
    }

    this.totalInterest += interest;
    this.totalFees += fee;
    this.totalExtra += extra;
    this.rows.push({ month, payment: paid, interest, principal, extra, rolled, fee, balance: Math.max(this.balance, 0), ratePct });
    return rolled;
  }

  schedule(): LoanSchedule {
    return {
      rows: this.rows,
      initialPayment: this.initialPayment,
      finalPayment: this.payment,
      totalInterest: this.totalInterest,
      totalFees: this.totalFees,
      totalExtra: this.totalExtra,
      // A loan with nothing left to pay counts as paid off before its first payment.
      payoffMonth: this.balance > EPS ? null : (this.rows.at(-1)?.month ?? addMonths(this.loan.firstPaymentMonth, -1)),
    };
  }
}

export function amortize(loan: Loan, opts: { withExtras?: boolean; rollIns?: RollIn[]; ctx?: LoanContext } = {}): LoanSchedule {
  const withExtras = opts.withExtras ?? true;
  const rollIns = withExtras ? (opts.rollIns ?? []) : [];
  const stepper = new LoanStepper(loan, withExtras, opts.ctx ?? {});
  while (!stepper.done) {
    const month = stepper.nextMonth;
    let offered = 0;
    for (const ri of rollIns) if (month >= ri.startMonth) offered += ri.amount;
    stepper.step(offered);
  }
  return stepper.schedule();
}

/** Outstanding balance at the end of `ym` (the full balance before the first payment). */
export function balanceAt(loan: Loan, schedule: LoanSchedule, ym: YM): number {
  if (ym < loan.firstPaymentMonth) return loan.balance;
  // Rows are consecutive months from firstPaymentMonth, so the row for `ym` is found by index.
  const row = schedule.rows[monthsBetween(loan.firstPaymentMonth, ym)];
  if (row) return row.balance;
  return schedule.payoffMonth ? 0 : (schedule.rows.at(-1)?.balance ?? loan.balance);
}

/**
 * Roll-over targets with invalid links removed: unknown loans, self-links, and any link
 * that would close a cycle (checked in list order, so the first links win).
 */
export function rollTargets(loans: Loan[]): Record<string, string | undefined> {
  const ids = new Set(loans.map((l) => l.id));
  const targets: Record<string, string | undefined> = {};
  for (const loan of loans) {
    const t = loan.rollInto;
    if (!t || t === loan.id || !ids.has(t)) continue;
    let cur: string | undefined = t;
    let cycle = false;
    while (cur) {
      if (cur === loan.id) {
        cycle = true;
        break;
      }
      cur = targets[cur];
    }
    if (!cycle) targets[loan.id] = t;
  }
  return targets;
}

/** Payoff order for avalanche (highest rate first) or snowball (smallest balance first). */
export function debtOrder(loans: Loan[], mode: 'avalanche' | 'snowball', start: YM, baselines: Record<string, LoanSchedule>): string[] {
  const before = addMonths(start, -1);
  const info = loans.map((l, i) => ({
    id: l.id,
    i,
    rate: rateFor(l, l.firstPaymentMonth > start ? l.firstPaymentMonth : start),
    balance: balanceAt(l, baselines[l.id], before),
  }));
  info.sort((a, b) =>
    mode === 'avalanche' ? b.rate - a.rate || a.balance - b.balance || a.i - b.i : a.balance - b.balance || b.rate - a.rate || a.i - b.i,
  );
  return info.map((x) => x.id);
}

export interface LoanPlan {
  mode: DebtStrategy['mode'];
  /** Schedules with early payments, roll-overs and the debt plan. */
  schedules: Record<string, LoanSchedule>;
  /** Schedules with regular payments only. */
  baselines: Record<string, LoanSchedule>;
  /** Manual roll-overs (empty when an automatic debt plan is on). */
  rollIns: Record<string, RollIn[]>;
  targets: Record<string, string | undefined>;
  /** Payoff order of the automatic debt plan (empty in manual mode). */
  order: string[];
}

export function planLoans(loans: Loan[], ctx: LoanContext = {}): LoanPlan {
  const baselines: Record<string, LoanSchedule> = {};
  for (const loan of loans) baselines[loan.id] = amortize(loan, { withExtras: false, ctx });
  const strategy = ctx.strategy;
  const rollIns: Record<string, RollIn[]> = Object.fromEntries(loans.map((l) => [l.id, []]));

  if (strategy && strategy.mode !== 'manual') {
    const order = debtOrder(loans, strategy.mode, strategy.startMonth, baselines);
    return { mode: strategy.mode, schedules: simulateDebtPlan(loans, order, strategy, ctx), baselines, rollIns, targets: {}, order };
  }

  const targets = rollTargets(loans);
  const schedules: Record<string, LoanSchedule> = {};
  const compute = (loan: Loan) => {
    if (schedules[loan.id]) return;
    // Loans that roll into this one must be scheduled first, so their freed payments are known.
    for (const src of loans) if (targets[src.id] === loan.id) compute(src);
    const s = amortize(loan, { rollIns: rollIns[loan.id], ctx });
    schedules[loan.id] = s;
    const target = targets[loan.id];
    if (target && s.payoffMonth) {
      const carried = rollIns[loan.id].filter((ri) => ri.startMonth <= s.payoffMonth!).reduce((sum, ri) => sum + ri.amount, 0);
      rollIns[target].push({
        fromLoanId: loan.id,
        fromName: loan.name,
        startMonth: addMonths(s.payoffMonth, 1),
        amount: s.finalPayment + carried,
      });
    }
  };
  for (const loan of loans) compute(loan);
  return { mode: 'manual', schedules, baselines, rollIns, targets, order: [] };
}

/**
 * Simulates all loans together. From the plan's start, a monthly pool — the extra budget plus the
 * regular payment of every loan already paid off — goes to open loans in priority order.
 * Money the loans can't absorb stays in savings.
 */
function simulateDebtPlan(loans: Loan[], order: string[], strategy: DebtStrategy, ctx: LoanContext): Record<string, LoanSchedule> {
  const steppers = Object.fromEntries(loans.map((l) => [l.id, new LoanStepper(l, true, ctx)]));
  const finished = new Set<string>();
  let freed = 0;
  let month = loans.map((l) => l.firstPaymentMonth).sort()[0];
  for (let k = 0; month && k < MAX_MONTHS * 2 && loans.some((l) => !steppers[l.id].done); k++, month = addMonths(month, 1)) {
    let pool = month >= strategy.startMonth ? freed + Math.max(0, strategy.extraMonthly) : 0;
    for (const id of order) {
      const st = steppers[id];
      if (st.done || st.nextMonth !== month) continue;
      pool -= st.step(pool);
    }
    for (const l of loans) {
      const st = steppers[l.id];
      if (st.done && !finished.has(l.id)) {
        finished.add(l.id);
        // Only payments freed while the plan runs join the pool: not loans that ended earlier,
        // and not loans that merely hit the simulation limit without being paid off.
        if (st.paidOff && st.rows.length && month >= addMonths(strategy.startMonth, -1)) freed += st.payment;
      }
    }
  }
  return Object.fromEntries(loans.map((l) => [l.id, steppers[l.id].schedule()]));
}

export interface PrepaymentImpact {
  baseline: LoanSchedule;
  planned: LoanSchedule;
  /** False when the loan never pays off on regular payments alone, so there's nothing to compare against. */
  comparable: boolean;
  interestSaved: number;
  monthsSaved: number;
  /** Interest saved minus early-repayment fees. */
  netSaving: number;
}

export function compareSchedules(baseline: LoanSchedule, planned: LoanSchedule): PrepaymentImpact {
  if (baseline.payoffMonth === null) {
    return { baseline, planned, comparable: false, interestSaved: 0, monthsSaved: 0, netSaving: 0 };
  }
  const interestSaved = baseline.totalInterest - planned.totalInterest;
  return {
    baseline,
    planned,
    comparable: true,
    interestSaved,
    monthsSaved: baseline.rows.length - planned.rows.length,
    netSaving: interestSaved - planned.totalFees,
  };
}

export const impactOf = (lp: LoanPlan, id: string) => compareSchedules(lp.baselines[id], lp.schedules[id]);

/** Interest plus early-repayment fees across all loans, from `from` on. */
export function totalCost(lp: LoanPlan, from: YM = ''): number {
  let sum = 0;
  for (const s of Object.values(lp.schedules)) for (const r of s.rows) if (r.month >= from) sum += r.interest + r.fee;
  return sum;
}

/** Month the last loan is paid off; null if one never is, undefined if there are no loans. */
export function debtFreeMonth(lp: LoanPlan): YM | null | undefined {
  const payoffs = Object.values(lp.schedules).map((s) => s.payoffMonth);
  if (!payoffs.length) return undefined;
  if (payoffs.some((p) => p === null)) return null;
  return (payoffs as YM[]).sort().at(-1);
}
