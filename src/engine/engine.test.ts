import { describe, expect, it } from 'vitest';
import { normalizeWorkspace } from '../store';
import type { Loan, Person, Plan } from '../types';
import { addMonths, monthsBetween, occursIn } from './dates';
import {
  amortize,
  annuityPayment,
  compareSchedules,
  debtFreeMonth,
  debtOrder,
  monthsToRepay,
  planLoans,
  rollTargets,
  totalCost,
} from './loan';
import { bonusesPaidIn, debtAtStart, goalStatus, loanContext, project, salaryAt, typicalMonth } from './projection';

const prepaymentImpact = (loan: Loan) => compareSchedules(amortize(loan, { withExtras: false }), amortize(loan));

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p',
  name: 'A',
  netMonthlySalary: 1000,
  annualRaisePct: 0,
  bonuses: [],
  salaryChanges: [],
  ...over,
});

const mortgage = (over: Partial<Loan> = {}): Loan => ({
  id: 'm',
  name: 'Mortgage',
  kind: 'Mortgage',
  balance: 200_000,
  annualRatePct: 3,
  firstPaymentMonth: '2026-11',
  inputMode: 'term',
  remainingMonths: 360,
  monthlyPayment: 0,
  strategy: 'reduce-term',
  earlyRepaymentFeePct: 0,
  extraPayments: [],
  rateChanges: [],
  ...over,
});

const basePlan = (over: Partial<Plan> = {}): Plan => ({
  version: 1,
  settings: {
    currency: 'EUR',
    locale: 'en-GB',
    startMonth: '2026-01',
    horizonYears: 2,
    startingSavings: 1000,
    savingsInterestPct: 0,
    inflationPct: 0,
  },
  people: [],
  incomes: [],
  expenses: [],
  loans: [],
  goals: [],
  debtStrategy: { mode: 'manual', extraMonthly: 0, startMonth: '2026-01' },
  ...over,
});

describe('dates', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-10', '2027-10')).toBe(12);
  });

  it('handles frequencies and end months', () => {
    const q = { startMonth: '2026-01', frequency: 'quarterly' as const, endMonth: '2026-12' };
    expect(['2026-01', '2026-04', '2026-07', '2026-10'].every((m) => occursIn(q, m))).toBe(true);
    expect(occursIn(q, '2026-02')).toBe(false);
    expect(occursIn(q, '2027-01')).toBe(false);
    expect(occursIn({ startMonth: '2026-08', frequency: 'yearly' }, '2028-08')).toBe(true);
  });
});

describe('loan maths', () => {
  it('matches standard annuity payments', () => {
    expect(annuityPayment(200_000, 0.03 / 12, 360)).toBeCloseTo(843.21, 2);
    expect(annuityPayment(20_000, 0.06 / 12, 60)).toBeCloseTo(386.66, 2);
    expect(annuityPayment(1200, 0, 12)).toBe(100);
  });

  it('pays off exactly on term without extras', () => {
    const s = amortize(mortgage());
    expect(s.rows).toHaveLength(360);
    expect(s.payoffMonth).toBe(addMonths('2026-11', 359));
    expect(s.rows.at(-1)!.balance).toBeCloseTo(0, 2);
    expect(s.totalInterest).toBeCloseTo(843.21 * 360 - 200_000, -1);
  });

  it('derives the term from an entered payment', () => {
    expect(monthsToRepay(200_000, 0.03 / 12, 843.21)).toBe(360);
    const s = amortize(mortgage({ inputMode: 'payment', monthlyPayment: 843.21 }));
    expect(s.rows.length).toBe(360);
  });

  it('flags loans whose payment does not cover interest', () => {
    const s = amortize(mortgage({ inputMode: 'payment', monthlyPayment: 400 }));
    expect(s.payoffMonth).toBeNull();
  });

  it('early payment with reduce-term shortens the loan and saves interest', () => {
    const loan = mortgage({
      extraPayments: [{ id: 'x', startMonth: '2027-12', amount: 20_000, frequency: 'once' }],
    });
    const impact = prepaymentImpact(loan);
    expect(impact.monthsSaved).toBeGreaterThan(30);
    expect(impact.interestSaved).toBeGreaterThan(20_000);
    expect(impact.planned.rows.every((r) => Math.abs(r.payment - 843.21) < 0.01 || r === impact.planned.rows.at(-1))).toBe(true);
  });

  it('early payment with reduce-payment keeps the term and lowers the payment', () => {
    const loan = mortgage({
      strategy: 'reduce-payment',
      earlyRepaymentFeePct: 1,
      extraPayments: [{ id: 'x', startMonth: '2027-12', amount: 20_000, frequency: 'once' }],
    });
    const s = amortize(loan);
    expect(s.rows).toHaveLength(360);
    expect(s.rows.at(-1)!.payment).toBeLessThan(843.21 * 0.92);
    expect(s.totalFees).toBeCloseTo(200, 6);
  });

  it('never prepays more than the remaining balance', () => {
    const loan = mortgage({
      balance: 5000,
      remainingMonths: 12,
      extraPayments: [{ id: 'x', startMonth: '2026-11', amount: 50_000, frequency: 'once' }],
    });
    const s = amortize(loan);
    expect(s.rows).toHaveLength(1);
    expect(s.totalExtra).toBeLessThan(5000);
    expect(s.rows[0].balance).toBe(0);
  });
});

describe('projection', () => {
  it('adds bonuses in their months and accumulates savings', () => {
    const plan = basePlan({
      people: [
        person({
          name: 'Alex',
          netMonthlySalary: 3000,
          bonuses: [
            { id: 'b1', label: 'Summer', frequency: 'yearly', startMonth: '2026-08', amountType: 'fixed', amount: 2000 },
            { id: 'b2', label: 'Christmas', frequency: 'yearly', startMonth: '2026-12', amountType: 'fixed', amount: 3000 },
          ],
        }),
      ],
      expenses: [
        { id: 'e', name: 'Rent', category: 'Housing', amount: 1000, frequency: 'monthly', startMonth: '2026-01' },
        { id: 'h', name: 'Summer holiday', category: 'Holidays', amount: 2500, frequency: 'yearly', startMonth: '2026-07' },
      ],
    });
    const p = project(plan);
    expect(p.rows).toHaveLength(24);
    expect(p.rows[7].bonus).toBe(2000);
    expect(p.rows[11].bonus).toBe(3000);
    expect(p.rows[6].byCategory.Holidays).toBe(2500);
    expect(p.years[0].net).toBe(12 * 2000 + 5000 - 2500);
    expect(p.years[0].endSavings).toBe(1000 + 26_500);
  });

  it('applies raises and inflation from the following January', () => {
    const plan = basePlan({
      settings: { ...basePlan().settings, startMonth: '2026-10', inflationPct: 10 },
      people: [person({ annualRaisePct: 5 })],
      expenses: [{ id: 'e', name: 'Bills', category: 'Bills & utilities', amount: 100, frequency: 'monthly', startMonth: '2026-01' }],
    });
    const rows = project(plan).rows;
    expect(rows[2].salary).toBe(1000);
    expect(rows[3].salary).toBeCloseTo(1050);
    expect(rows[3].expenses).toBeCloseTo(110);
  });

  it('includes loan payments and early repayments in cash flow and tracks debt', () => {
    const loan = mortgage({
      balance: 12_000,
      annualRatePct: 0,
      remainingMonths: 12,
      firstPaymentMonth: '2026-03',
      extraPayments: [{ id: 'x', startMonth: '2026-06', amount: 2000, frequency: 'once' }],
    });
    const p = project(basePlan({ loans: [loan] }));
    expect(p.rows[0].debt).toBe(0); // first payment in March: the loan exists from February
    expect(p.rows[1].debt).toBe(12_000);
    expect(p.rows[2].loanRegular).toBe(1000);
    expect(p.rows[5].loanExtra).toBe(2000);
    expect(p.schedules.m.payoffMonth).toBe('2026-12');
    expect(p.rows.at(-1)!.debt).toBe(0);
    expect(p.lowest.savings).toBeLessThan(0);
  });

  it('reports goal status', () => {
    const plan = basePlan({
      people: [person()],
    });
    const p = project(plan);
    const hit = goalStatus(plan, p, { id: 'g', name: 'Fund', targetAmount: 6000, targetMonth: '2026-06' });
    expect(hit.onTrack).toBe(true);
    expect(hit.reachedMonth).toBe('2026-05');
    const miss = goalStatus(plan, p, { id: 'g2', name: 'Car', targetAmount: 20_000, targetMonth: '2026-12' });
    expect(miss.onTrack).toBe(false);
    expect(miss.monthlyGap).toBeCloseTo((20_000 - 13_000) / 12);
  });
});

describe('variable rates', () => {
  it('recalculates the payment over the remaining term when the rate changes', () => {
    const loan = mortgage({ rateChanges: [{ id: 'r', month: '2027-11', annualRatePct: 5 }] });
    const s = amortize(loan);
    expect(s.rows).toHaveLength(360);
    expect(s.rows[11].payment).toBeCloseTo(843.21, 2);
    expect(s.rows[12].ratePct).toBe(5);
    const balanceAfterYear = s.rows[11].balance;
    expect(s.rows[12].payment).toBeCloseTo(annuityPayment(balanceAfterYear, 0.05 / 12, 348), 6);
    expect(s.rows.at(-1)!.balance).toBeCloseTo(0, 2);
  });

  it('applies rate changes to the regular-payments-only baseline too', () => {
    const loan = mortgage({ rateChanges: [{ id: 'r', month: '2027-11', annualRatePct: 5 }] });
    expect(amortize(loan, { withExtras: false }).totalInterest).toBeCloseTo(amortize(loan).totalInterest, 6);
  });

  it('keeps a shortened term after early payments when the rate changes', () => {
    const loan = mortgage({
      extraPayments: [{ id: 'x', startMonth: '2027-01', amount: 50_000, frequency: 'once' }],
      rateChanges: [{ id: 'r', month: '2028-01', annualRatePct: 4 }],
    });
    const withoutChange = amortize({ ...loan, rateChanges: [] });
    expect(amortize(loan).rows.length).toBe(withoutChange.rows.length);
  });
});

describe('roll-over (snowball)', () => {
  const car = (over: Partial<Loan> = {}) =>
    mortgage({ id: 'c', name: 'Car', balance: 6000, annualRatePct: 0, remainingMonths: 12, rollInto: 'm', ...over });

  it('pays a finished loan’s payment into the target loan', () => {
    const lp = planLoans([car(), mortgage()]);
    expect(lp.schedules.c.payoffMonth).toBe('2027-10');
    expect(lp.rollIns.m).toEqual([{ fromLoanId: 'c', fromName: 'Car', startMonth: '2027-11', amount: 500 }]);
    const row = lp.schedules.m.rows.find((r) => r.month === '2027-11')!;
    expect(row.rolled).toBe(500);
    expect(lp.schedules.m.payoffMonth! < lp.baselines.m.payoffMonth!).toBe(true);
  });

  it('accumulates through a chain of loans', () => {
    const a = car({ id: 'a', name: 'A', balance: 1200, remainingMonths: 6, rollInto: 'c' });
    const lp = planLoans([a, car(), mortgage()]);
    expect(lp.rollIns.c[0]).toMatchObject({ fromLoanId: 'a', startMonth: '2027-05', amount: 200 });
    expect(lp.rollIns.m[0].amount).toBe(700);
    expect(lp.schedules.c.payoffMonth! < '2027-10').toBe(true);
  });

  it('ignores self-links and cycles', () => {
    expect(rollTargets([car({ rollInto: 'c' })])).toEqual({});
    const targets = rollTargets([car(), mortgage({ rollInto: 'c' })]);
    expect(targets).toEqual({ c: 'm' });
  });

  it('keeps cash flow the same while rolling over', () => {
    const p = project(
      basePlan({ settings: { ...basePlan().settings, startMonth: '2027-09', horizonYears: 1 }, loans: [car(), mortgage()] }),
    );
    const [sep, oct, nov] = p.rows;
    expect(sep.loanRegular + sep.loanExtra).toBeCloseTo(oct.loanRegular + oct.loanExtra, 6);
    expect(nov.loanRegular + nov.loanExtra).toBeCloseTo(oct.loanRegular + oct.loanExtra, 6);
    expect(nov.events.some((e) => e.label.includes('now goes to'))).toBe(true);
  });
});

describe('salary changes', () => {
  const p = person({
    netMonthlySalary: 2000,
    annualRaisePct: 10,
    bonuses: [{ id: 'b', label: 'Xmas', frequency: 'yearly', startMonth: '2026-12', amountType: 'fixed', amount: 1000 }],
    salaryChanges: [
      { id: 'c1', month: '2026-06', netMonthlySalary: 800, label: 'Parental leave', bonusesPaid: false },
      { id: 'c2', month: '2027-06', netMonthlySalary: 2200, label: 'Back to work', bonusesPaid: true },
    ],
  });

  it('switches salary from the change month and restarts raises after it', () => {
    expect(salaryAt(p, '2026-01', '2026-05').salary).toBe(2000);
    expect(salaryAt(p, '2026-01', '2026-06')).toEqual({ salary: 800, bonusesPaid: false });
    expect(salaryAt(p, '2026-01', '2027-01').salary).toBeCloseTo(880);
    expect(salaryAt(p, '2026-01', '2027-06').salary).toBe(2200);
    expect(salaryAt(p, '2026-01', '2028-01').salary).toBeCloseTo(2420);
  });

  it('skips bonuses while they are not paid', () => {
    const rows = project(basePlan({ people: [p] })).rows;
    expect(rows[11].bonus).toBe(0);
    expect(rows[23].bonus).toBe(1000);
    expect(rows[5].events.map((e) => e.label)).toContain('A: Parental leave');
  });
});

describe('plan-level figures', () => {
  it('reports debt at plan start for a loan entered from its original start', () => {
    const loan = mortgage({ balance: 12_000, annualRatePct: 0, remainingMonths: 12, firstPaymentMonth: '2025-07' });
    const plan = basePlan({ loans: [loan] });
    const p = project(plan);
    expect(debtAtStart(plan, p)).toBe(6000);
    expect(typicalMonth(plan, p).loans).toBe(1000);
    expect(p.rows[6].loanRegular).toBe(0);
  });
});

describe('workspace import', () => {
  it('wraps an old single-plan export into a workspace', () => {
    const ws = normalizeWorkspace(basePlan());
    expect(ws.scenarios).toHaveLength(1);
    expect(ws.activeId).toBe(ws.scenarios[0].id);
    expect(ws.scenarios[0].plan.people).toEqual([]);
  });

  it('keeps valid scenarios and fixes a bad active id', () => {
    const ws = normalizeWorkspace({
      kind: 'finance-planner-workspace',
      activeId: 'nope',
      scenarios: [
        { id: 'a', name: 'A', plan: basePlan() },
        { id: 'b', name: 'B', plan: { junk: true } },
      ],
    });
    expect(ws.scenarios.map((s) => s.id)).toEqual(['a']);
    expect(ws.activeId).toBe('a');
  });

  it('fills in fields added in later versions', () => {
    const old = basePlan({ loans: [mortgage()], people: [person()] }) as any;
    delete old.loans[0].rateChanges;
    delete old.people[0].salaryChanges;
    const plan = normalizeWorkspace(old).scenarios[0].plan;
    expect(plan.loans[0].rateChanges).toEqual([]);
    expect(plan.people[0].salaryChanges).toEqual([]);
  });
});

describe('early payments from bonuses', () => {
  const plan = (pausedFrom?: string) =>
    basePlan({
      people: [
        person({
          id: 'me',
          bonuses: [
            { id: 'b1', label: 'Summer', frequency: 'yearly', startMonth: '2026-08', amountType: 'fixed', amount: 2000 },
            { id: 'b2', label: 'Christmas', frequency: 'yearly', startMonth: '2026-12', amountType: 'fixed', amount: 4000 },
          ],
          salaryChanges: pausedFrom ? [{ id: 'c', month: pausedFrom, netMonthlySalary: 500, label: 'Leave', bonusesPaid: false }] : [],
        }),
        person({
          id: 'p2',
          bonuses: [{ id: 'b3', label: 'Xmas', frequency: 'yearly', startMonth: '2026-12', amountType: 'fixed', amount: 1000 }],
        }),
      ],
      loans: [
        mortgage({
          extraPayments: [{ id: 'x', startMonth: '2026-01', amount: 0, frequency: 'monthly', kind: 'bonus', bonusPct: 50, bonusMonth: 12 }],
        }),
      ],
    });

  it('pays the chosen share of matching bonuses into the loan', () => {
    const p = project(plan());
    const dec26 = p.schedules.m.rows.find((r) => r.month === '2026-12')!;
    expect(dec26.extra).toBe(2500);
    expect(p.schedules.m.rows.find((r) => r.month === '2027-08')!.extra).toBe(0);
    const dec = p.rows.find((r) => r.month === '2026-12')!;
    expect(dec.events.some((e) => e.label === 'Early payment – Mortgage (from bonus)' && e.amount === 2500)).toBe(true);
  });

  it('filters by person and skips paused bonuses', () => {
    const base = plan();
    const onlyMe = {
      ...base,
      loans: [{ ...base.loans[0], extraPayments: [{ ...base.loans[0].extraPayments[0], bonusPersonId: 'me', bonusMonth: undefined }] }],
    };
    const s = project(onlyMe).schedules.m;
    expect(s.rows.find((r) => r.month === '2027-08')!.extra).toBe(1000);
    expect(s.rows.find((r) => r.month === '2027-12')!.extra).toBe(2000);
    const paused = project(plan('2026-06')).schedules.m;
    expect(paused.rows.find((r) => r.month === '2026-12')!.extra).toBe(500);
  });

  it('counts the bonus share as outflow in the projection', () => {
    const dec = project(plan()).rows.find((r) => r.month === '2026-12')!;
    expect(dec.bonus).toBe(5000);
    expect(dec.loanExtra).toBe(2500);
  });
});

describe('automatic debt plan', () => {
  const card = mortgage({ id: 'card', name: 'Card', balance: 3000, annualRatePct: 18, remainingMonths: 24 });
  const car = mortgage({ id: 'car', name: 'Car', balance: 8000, annualRatePct: 6, remainingMonths: 48 });
  const home = mortgage({ id: 'home', name: 'Home', balance: 1500, annualRatePct: 2, remainingMonths: 12 });
  const loans = [car, home, card];
  const strategy = (mode: 'avalanche' | 'snowball', extraMonthly = 200) => ({ mode, extraMonthly, startMonth: '2026-11' });

  it('orders by rate for avalanche and by balance for snowball', () => {
    const baselines = planLoans(loans).baselines;
    expect(debtOrder(loans, 'avalanche', '2026-11', baselines)).toEqual(['card', 'car', 'home']);
    expect(debtOrder(loans, 'snowball', '2026-11', baselines)).toEqual(['home', 'card', 'car']);
  });

  it('sends the budget to the first loan in line, then moves on', () => {
    const lp = planLoans(loans, { strategy: strategy('avalanche') });
    expect(lp.schedules.card.rows[0].rolled).toBe(200);
    expect(lp.schedules.car.rows[0].rolled).toBe(0);
    const cardDone = lp.schedules.card.payoffMonth!;
    const after = lp.schedules.car.rows.find((r) => r.month > cardDone)!;
    expect(after.rolled).toBeGreaterThan(200);
  });

  it('keeps total monthly debt spending constant until everything is paid off', () => {
    const lp = planLoans(loans, { strategy: strategy('snowball') });
    const lastPayoff = Object.values(lp.schedules)
      .map((s) => s.payoffMonth!)
      .sort()
      .at(-1)!;
    const totalIn = (m: string) =>
      Object.values(lp.schedules).reduce((sum, s) => {
        const r = s.rows.find((x) => x.month === m);
        return sum + (r ? r.payment + r.extra : 0);
      }, 0);
    const first = totalIn('2026-11');
    for (let m = '2026-12'; m < lastPayoff; m = addMonths(m, 1)) {
      // The month a loan finishes, its last payment is partial; the leftover isn't redistributed that month.
      if (Object.values(lp.schedules).some((s) => s.payoffMonth === m)) continue;
      expect(totalIn(m)).toBeCloseTo(first, 6);
    }
  });

  it('beats paying loans separately, and avalanche costs the least interest', () => {
    const separate = totalCost(planLoans(loans));
    const avalanche = totalCost(planLoans(loans, { strategy: strategy('avalanche') }));
    const snowball = totalCost(planLoans(loans, { strategy: strategy('snowball') }));
    expect(avalanche).toBeLessThan(separate);
    expect(snowball).toBeLessThan(separate);
    expect(avalanche).toBeLessThanOrEqual(snowball + 1e-6);
  });

  it('does nothing before the plan starts and ignores manual roll-overs', () => {
    const lp = planLoans([{ ...car, rollInto: 'home' }, home], {
      strategy: { mode: 'snowball', extraMonthly: 100, startMonth: '2027-03' },
    });
    expect(lp.schedules.home.rows.filter((r) => r.month < '2027-03').every((r) => r.rolled === 0)).toBe(true);
    expect(lp.targets).toEqual({});
  });

  it('runs inside the projection with the plan’s strategy', () => {
    const plan = basePlan({ loans, debtStrategy: strategy('avalanche') });
    const p = project(plan);
    expect(loanContext(plan).strategy?.mode).toBe('avalanche');
    expect(p.loanPlan.order).toEqual(['card', 'car', 'home']);
    expect(p.rows.find((r) => r.month === '2026-11')!.loanExtra).toBeCloseTo(200, 6);
  });
});

describe('bonuses on any schedule', () => {
  const at = (bonuses: Person['bonuses'], salaryChanges: Person['salaryChanges'] = [], raise = 0) =>
    project(basePlan({ people: [person({ netMonthlySalary: 2000, annualRaisePct: raise, bonuses, salaryChanges })] })).rows;

  it('pays quarterly bonuses every three months from the first one', () => {
    const rows = at([{ id: 'q', label: 'Q', frequency: 'quarterly', startMonth: '2026-02', amountType: 'fixed', amount: 300 }]);
    expect(
      rows
        .filter((r) => r.bonus > 0)
        .map((r) => r.month)
        .slice(0, 4),
    ).toEqual(['2026-02', '2026-05', '2026-08', '2026-11']);
  });

  it('pays a one-off bonus once and respects an end month', () => {
    const rows = at([
      { id: 'o', label: 'Sign-on', frequency: 'once', startMonth: '2026-04', amountType: 'fixed', amount: 5000 },
      { id: 'm', label: 'Commission', frequency: 'monthly', startMonth: '2026-01', endMonth: '2026-03', amountType: 'fixed', amount: 100 },
    ]);
    expect(rows.reduce((s, r) => s + r.bonus, 0)).toBe(5300);
    expect(rows[3].bonus).toBe(5000);
  });

  it('works out salary multiples from the salary at the time, including raises and changes', () => {
    const rows = at(
      [{ id: 's', label: '13th salary', frequency: 'yearly', startMonth: '2026-12', amountType: 'salary', amount: 1 }],
      [{ id: 'c', month: '2027-06', netMonthlySalary: 3000, label: 'Promotion', bonusesPaid: true }],
      10,
    );
    expect(rows.find((r) => r.month === '2026-12')!.bonus).toBe(2000);
    expect(rows.find((r) => r.month === '2027-12')!.bonus).toBe(3000);
  });

  it('feeds bonus-share early payments by the month the bonus is actually paid', () => {
    const plan = basePlan({
      people: [
        person({
          id: 'me',
          bonuses: [{ id: 'q', label: 'Q', frequency: 'quarterly', startMonth: '2026-03', amountType: 'fixed', amount: 1000 }],
        }),
      ],
    });
    expect(bonusesPaidIn(plan, '2026-06')).toMatchObject([{ amount: 1000, month: 6 }]);
    expect(loanContext(plan).bonusFor!('2026-09', { month: 9 })).toBe(1000);
    expect(loanContext(plan).bonusFor!('2026-09', { month: 12 })).toBe(0);
  });

  it('migrates bonuses saved by older versions (calendar month only)', () => {
    const old = basePlan({ people: [person()] }) as any;
    old.people[0].bonuses = [{ id: 'x', month: 8, amount: 2000, label: 'Summer' }];
    const b = normalizeWorkspace(old).scenarios[0].plan.people[0].bonuses[0];
    expect(b).toEqual({
      id: 'x',
      label: 'Summer',
      frequency: 'yearly',
      startMonth: '2026-08',
      endMonth: undefined,
      amountType: 'fixed',
      amount: 2000,
    });
  });
});

describe('review fixes', () => {
  it('treats a loan with nothing left to pay as paid off, not "never"', () => {
    const lp = planLoans([mortgage({ balance: 0 })]);
    expect(lp.schedules.m.payoffMonth).toBe('2026-10');
    expect(debtFreeMonth(lp)).toBe('2026-10');
  });

  it("doesn't pool payments of loans that ended before the debt plan, or that never pay off", () => {
    const old = mortgage({ id: 'old', balance: 1200, annualRatePct: 0, remainingMonths: 12, firstPaymentMonth: '2020-01' });
    const home = mortgage({ id: 'home' });
    const lp = planLoans([old, home], { strategy: { mode: 'avalanche', extraMonthly: 0, startMonth: '2026-01' } });
    expect(lp.schedules.home.rows.every((r) => r.rolled === 0)).toBe(true);

    const stuck = mortgage({
      id: 'stuck',
      balance: 100_000,
      annualRatePct: 12,
      inputMode: 'payment',
      monthlyPayment: 500,
      firstPaymentMonth: '2000-01',
    });
    const long = mortgage({ id: 'long', remainingMonths: 360, firstPaymentMonth: '2026-01' });
    const lp2 = planLoans([stuck, long], { strategy: { mode: 'avalanche', extraMonthly: 0, startMonth: '2026-01' } });
    expect(lp2.schedules.stuck.payoffMonth).toBeNull();
    expect(lp2.schedules.long.rows.every((r) => r.rolled === 0)).toBe(true);
  });

  it('keeps total debt spending flat in a debt plan even for "lower payment" loans', () => {
    const a = mortgage({ id: 'a', balance: 20_000, annualRatePct: 5, remainingMonths: 120, strategy: 'reduce-payment' });
    const b = mortgage({ id: 'b', balance: 30_000, annualRatePct: 4, remainingMonths: 180, strategy: 'reduce-payment' });
    const lp = planLoans([a, b], { strategy: { mode: 'avalanche', extraMonthly: 300, startMonth: '2026-11' } });
    const total = (m: string) =>
      Object.values(lp.schedules).reduce((sum, s) => {
        const r = s.rows.find((x) => x.month === m);
        return sum + (r ? r.payment + r.extra : 0);
      }, 0);
    const first = total('2026-11');
    for (const m of ['2027-05', '2027-11', '2028-11']) expect(total(m)).toBeCloseTo(first, 6);
  });

  it("never raises the payment of a loan whose payment doesn't cover the interest", () => {
    const loan = mortgage({
      balance: 100_000,
      annualRatePct: 12,
      inputMode: 'payment',
      monthlyPayment: 500,
      strategy: 'reduce-payment',
      extraPayments: [{ id: 'x', startMonth: '2027-01', amount: 10_000, frequency: 'once' }],
    });
    expect(Math.max(...amortize(loan).rows.map((r) => r.payment))).toBeLessThanOrEqual(500);
  });

  it("doesn't claim savings against a loan that never pays off on regular payments", () => {
    const loan = mortgage({
      balance: 100_000,
      annualRatePct: 12,
      inputMode: 'payment',
      monthlyPayment: 900,
      extraPayments: [{ id: 'x', startMonth: '2027-01', amount: 50_000, frequency: 'once' }],
    });
    const impact = compareSchedules(amortize(loan, { withExtras: false }), amortize(loan));
    expect(impact.comparable).toBe(false);
    expect(impact.netSaving).toBe(0);
  });

  it('marks goals after the plan ends instead of inventing a gap', () => {
    const plan = basePlan({ people: [person()] });
    const p = project(plan);
    const g = goalStatus(plan, p, { id: 'g', name: 'Later', targetAmount: 40_000, targetMonth: '2029-12' });
    expect(g.beyondHorizon).toBe(true);
    expect(g.monthlyGap).toBe(0);
    const reached = goalStatus(plan, p, { id: 'g2', name: 'Soon', targetAmount: 5000, targetMonth: '2030-12' });
    expect(reached.onTrack).toBe(true);
  });

  it("doesn't count a loan that starts later as owed today", () => {
    const later = mortgage({ id: 'later', balance: 20_000, firstPaymentMonth: '2027-06', remainingMonths: 60 });
    const plan = basePlan({ loans: [later] });
    const p = project(plan);
    expect(debtAtStart(plan, p)).toBe(0);
    expect(typicalMonth(plan, p).loans).toBe(0);
    expect(p.rows.find((r) => r.month === '2027-04')!.debt).toBe(0);
    expect(p.rows.find((r) => r.month === '2027-05')!.debt).toBe(20_000);
  });
});
