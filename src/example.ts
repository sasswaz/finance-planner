import { addMonths, currentYM } from './engine/dates';
import type { Plan } from './types';

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const year = (offset: number) => String(Number(currentYM().slice(0, 4)) + offset);

export function emptyPlan(): Plan {
  return {
    version: 1,
    settings: {
      currency: 'EUR',
      locale: 'en-GB',
      startMonth: currentYM(),
      horizonYears: 10,
      startingSavings: 0,
      savingsInterestPct: 0,
      inflationPct: 3,
    },
    people: [],
    incomes: [],
    expenses: [],
    loans: [],
    goals: [],
    debtStrategy: { mode: 'manual', extraMonthly: 0, startMonth: currentYM() },
  };
}

export function examplePlan(): Plan {
  const now = currentYM();
  const next = addMonths(now, 1);
  const mortgageId = uid();
  const meId = uid();
  return {
    ...emptyPlan(),
    isExample: true,
    settings: { ...emptyPlan().settings, startingSavings: 6500, savingsInterestPct: 2 },
    people: [
      {
        id: meId,
        name: 'Me',
        netMonthlySalary: 2900,
        annualRaisePct: 4,
        bonuses: [
          { id: uid(), label: 'Performance bonus', frequency: 'yearly', startMonth: `${year(1)}-03`, amountType: 'fixed', amount: 4000 },
          { id: uid(), label: '13th salary', frequency: 'yearly', startMonth: `${year(0)}-12`, amountType: 'salary', amount: 1 },
        ],
        salaryChanges: [],
      },
      {
        id: uid(),
        name: 'Partner',
        netMonthlySalary: 2100,
        annualRaisePct: 3,
        bonuses: [
          { id: uid(), label: 'Quarterly bonus', frequency: 'quarterly', startMonth: `${year(1)}-01`, amountType: 'fixed', amount: 400 },
        ],
        salaryChanges: [],
      },
    ],
    incomes: [
      { id: uid(), name: 'Rental income – studio', amount: 450, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Child benefit', amount: 60, frequency: 'monthly', startMonth: now },
    ],
    expenses: [
      { id: uid(), name: 'Electricity, water, heating', category: 'Bills & utilities', amount: 210, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Internet & phones', category: 'Bills & utilities', amount: 55, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Groceries', category: 'Groceries', amount: 750, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Fuel & parking', category: 'Transport', amount: 180, frequency: 'monthly', startMonth: now },
      {
        id: uid(),
        name: 'Kindergarten',
        category: 'Children',
        amount: 220,
        frequency: 'monthly',
        startMonth: now,
        endMonth: `${year(2)}-06`,
      },
      { id: uid(), name: 'Streaming & apps', category: 'Subscriptions', amount: 35, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Home insurance', category: 'Insurance', amount: 240, frequency: 'yearly', startMonth: `${year(1)}-03` },
      {
        id: uid(),
        name: 'Car insurance (CASCO + liability)',
        category: 'Insurance',
        amount: 680,
        frequency: 'yearly',
        startMonth: `${year(1)}-05`,
      },
      { id: uid(), name: 'Life insurance', category: 'Insurance', amount: 45, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Property tax', category: 'Housing', amount: 160, frequency: 'yearly', startMonth: `${year(1)}-04` },
      { id: uid(), name: 'Summer holiday', category: 'Holidays', amount: 3200, frequency: 'yearly', startMonth: `${year(1)}-07` },
      { id: uid(), name: 'Ski trip', category: 'Holidays', amount: 1400, frequency: 'yearly', startMonth: `${year(1)}-02` },
      { id: uid(), name: 'Christmas presents', category: 'Other', amount: 600, frequency: 'yearly', startMonth: `${year(0)}-12` },
      { id: uid(), name: 'Eating out & entertainment', category: 'Other', amount: 350, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Clothes & shoes', category: 'Other', amount: 180, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Pharmacy & dentist', category: 'Health', amount: 90, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Kids’ sports & classes', category: 'Children', amount: 120, frequency: 'monthly', startMonth: now },
      { id: uid(), name: 'Car service & tyres', category: 'Transport', amount: 700, frequency: 'yearly', startMonth: `${year(1)}-04` },
      { id: uid(), name: 'Home repairs & appliances', category: 'Housing', amount: 1200, frequency: 'yearly', startMonth: `${year(1)}-09` },
      { id: uid(), name: 'New sofa', category: 'Other', amount: 1800, frequency: 'once', startMonth: `${year(1)}-03` },
      { id: uid(), name: 'Next car – down payment', category: 'Transport', amount: 9000, frequency: 'once', startMonth: `${year(4)}-05` },
    ],
    loans: [
      {
        id: mortgageId,
        name: 'Home mortgage',
        kind: 'Mortgage',
        balance: 148_000,
        annualRatePct: 2.9,
        firstPaymentMonth: next,
        inputMode: 'term',
        remainingMonths: 26 * 12,
        monthlyPayment: 0,
        strategy: 'reduce-term',
        earlyRepaymentFeePct: 0,
        extraPayments: [{ id: uid(), startMonth: now, amount: 0, frequency: 'monthly', kind: 'bonus', bonusPct: 50, bonusPersonId: meId }],
        rateChanges: [{ id: uid(), month: `${year(2)}-01`, annualRatePct: 3.4 }],
      },
      {
        id: uid(),
        name: 'Car loan',
        kind: 'Car loan',
        balance: 13_500,
        annualRatePct: 6.4,
        firstPaymentMonth: next,
        inputMode: 'payment',
        remainingMonths: 0,
        monthlyPayment: 365,
        strategy: 'reduce-term',
        earlyRepaymentFeePct: 1,
        extraPayments: [],
        rateChanges: [],
        rollInto: mortgageId,
      },
    ],
    goals: [
      { id: uid(), name: 'Emergency fund (6 months)', targetAmount: 15_000, targetMonth: `${year(1)}-12` },
      { id: uid(), name: 'New kitchen', targetAmount: 30_000, targetMonth: `${year(3)}-06` },
    ],
  };
}
