/** A calendar month as "YYYY-MM" — the planner works at month granularity. */
export type YM = string;

export type Frequency = 'monthly' | 'quarterly' | 'yearly' | 'once';

export interface Bonus {
  id: string;
  label: string;
  /** How often it's paid. The first payment is in `startMonth`, which also sets the month(s) it repeats in. */
  frequency: Frequency;
  startMonth: YM;
  endMonth?: YM;
  /** 'fixed': `amount` in money. 'salary': `amount` × the monthly net salary at the time (1 = a 13th salary). */
  amountType: 'fixed' | 'salary';
  amount: number;
}

/** A new take-home salary from a given month: new job, parental leave, retirement… */
export interface SalaryChange {
  id: string;
  month: YM;
  netMonthlySalary: number;
  label: string;
  /** Whether bonuses keep being paid while this salary applies. */
  bonusesPaid: boolean;
}

export interface Person {
  id: string;
  name: string;
  /** Take-home pay per month, after tax. */
  netMonthlySalary: number;
  /** Applied every January after the plan starts (or after a salary change). */
  annualRaisePct: number;
  bonuses: Bonus[];
  salaryChanges: SalaryChange[];
}

export interface IncomeItem {
  id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  startMonth: YM;
  endMonth?: YM;
}

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Bills & utilities',
  'Insurance',
  'Groceries',
  'Transport',
  'Children',
  'Subscriptions',
  'Holidays',
  'Health',
  'Other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseItem {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  frequency: Frequency;
  startMonth: YM;
  endMonth?: YM;
}

export const LOAN_KINDS = ['Mortgage', 'Car loan', 'Personal loan', 'Other'] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];

export interface ExtraPayment {
  id: string;
  startMonth: YM;
  amount: number;
  frequency: 'once' | 'monthly' | 'yearly';
  endMonth?: YM;
  /** 'fixed' (default): `amount` each time. 'bonus': a share of bonuses, whenever they're paid. */
  kind?: 'fixed' | 'bonus';
  /** For 'bonus': percentage of the matching bonuses. */
  bonusPct?: number;
  /** For 'bonus': only this person's bonuses (everyone's if unset). */
  bonusPersonId?: string;
  /** For 'bonus': only bonuses paid in this calendar month, 1–12 (any month if unset). */
  bonusMonth?: number;
}

/** For variable-rate loans: the rate from a given month on. */
export interface RateChange {
  id: string;
  month: YM;
  annualRatePct: number;
}

export interface Loan {
  id: string;
  name: string;
  kind: LoanKind;
  /** Principal still owed just before the payment in `firstPaymentMonth`. */
  balance: number;
  annualRatePct: number;
  firstPaymentMonth: YM;
  /** Whether the regular payment is derived from the remaining term, or entered directly. */
  inputMode: 'term' | 'payment';
  remainingMonths: number;
  monthlyPayment: number;
  /** What the bank does after an early payment: keep the payment and finish sooner, or lower the payment. */
  strategy: 'reduce-term' | 'reduce-payment';
  /** Fee charged on each early repayment, as % of the amount repaid. */
  earlyRepaymentFeePct: number;
  extraPayments: ExtraPayment[];
  rateChanges: RateChange[];
  /** Once paid off, keep paying the same amount into this other loan (debt snowball). */
  rollInto?: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetMonth: YM;
}

export interface Settings {
  currency: string;
  locale: string;
  startMonth: YM;
  horizonYears: number;
  /** Savings balance at the start of `startMonth`. */
  startingSavings: number;
  savingsInterestPct: number;
  /** Yearly increase applied to expenses every January (loans excluded). */
  inflationPct: number;
}

export interface Scenario {
  id: string;
  name: string;
  plan: Plan;
}

/** Everything stored: one or more alternative plans, one of which is being edited. */
export interface Workspace {
  kind: 'finance-planner-workspace';
  version: 1;
  activeId: string;
  scenarios: Scenario[];
}

/**
 * How loans are paid off together. 'manual': each loan follows its own early payments and
 * roll-over. 'avalanche' / 'snowball': an extra monthly budget, plus the payment of every loan
 * that's paid off, goes to the highest-rate / smallest-balance loan still open.
 */
export interface DebtStrategy {
  mode: 'manual' | 'avalanche' | 'snowball';
  extraMonthly: number;
  startMonth: YM;
}

export interface Plan {
  version: 1;
  isExample?: boolean;
  settings: Settings;
  people: Person[];
  incomes: IncomeItem[];
  expenses: ExpenseItem[];
  loans: Loan[];
  goals: Goal[];
  debtStrategy: DebtStrategy;
}
