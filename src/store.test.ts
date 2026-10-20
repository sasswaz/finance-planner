import { describe, expect, it } from 'vitest';
import { historyReducer, initialHistory, loadWorkspace, normalizePlan, normalizeWorkspace, wrapPlan, type HistoryState } from './store';
import { emptyPlan } from './example';
import type { Loan, Plan, Workspace } from './types';

const plan = (over: Partial<Plan> = {}): Plan => {
  const p = emptyPlan();
  return { ...p, settings: { ...p.settings, startMonth: '2026-01' }, ...over };
};

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'l',
  name: 'Mortgage',
  kind: 'Mortgage',
  balance: 100_000,
  annualRatePct: 4,
  firstPaymentMonth: '2026-01',
  inputMode: 'term',
  remainingMonths: 120,
  monthlyPayment: 0,
  strategy: 'reduce-term',
  earlyRepaymentFeePct: 0,
  extraPayments: [],
  rateChanges: [],
  ...over,
});

/** A minimal in-memory Storage. */
function memoryStorage(initial: Record<string, string> = {}, { failWrites = false } = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => {
      if (failWrites) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
  };
}

describe('normalizePlan', () => {
  it('drops null and non-object entries instead of losing the plan', () => {
    const raw = {
      ...plan(),
      expenses: [null, 5, 'x', [], { id: 'e', name: 'Rent', amount: 800, frequency: 'monthly', startMonth: '2026-01' }],
      people: [{ id: 'p', name: 'A', netMonthlySalary: 2000, bonuses: [null], salaryChanges: [null] }],
      loans: [null, { ...loan(), extraPayments: [null], rateChanges: [7] }],
      goals: [undefined],
      incomes: null,
    };
    const p = normalizePlan(raw);
    expect(p.expenses.map((e) => e.id)).toEqual(['e']);
    expect(p.people[0].bonuses).toEqual([]);
    expect(p.people[0].salaryChanges).toEqual([]);
    expect(p.loans).toHaveLength(1);
    expect(p.loans[0].extraPayments).toEqual([]);
    expect(p.loans[0].rateChanges).toEqual([]);
    expect(p.goals).toEqual([]);
    expect(p.incomes).toEqual([]);
  });

  it('keeps every scenario of a workspace when one list contains null', () => {
    const ws = normalizeWorkspace({
      kind: 'finance-planner-workspace',
      activeId: 'a',
      scenarios: [null, { id: 'a', name: 'A', plan: { ...plan(), loans: [null, loan()] } }],
    });
    expect(ws.scenarios.map((s) => s.id)).toEqual(['a']);
    expect(ws.scenarios[0].plan.loans).toHaveLength(1);
  });

  it('keeps loan terms at least one month', () => {
    const p = normalizePlan({
      ...plan(),
      loans: [loan({ remainingMonths: 0 }), loan({ id: 'b', remainingMonths: -5 }), { ...loan({ id: 'c' }), remainingMonths: 'x' }],
    });
    expect(p.loans.map((l) => l.remainingMonths)).toEqual([1, 1, 1]);
    expect(normalizePlan({ ...plan(), loans: [loan({ remainingMonths: 240 })] }).loans[0].remainingMonths).toBe(240);
  });

  it("starts the debt strategy at the plan's own start month by default", () => {
    const raw: any = plan();
    raw.settings.startMonth = '2024-05';
    delete raw.debtStrategy;
    expect(normalizePlan(raw).debtStrategy.startMonth).toBe('2024-05');
    raw.debtStrategy = { mode: 'avalanche', extraMonthly: 100, startMonth: 'garbage' };
    expect(normalizePlan(raw).debtStrategy).toEqual({ mode: 'avalanche', extraMonthly: 100, startMonth: '2024-05' });
    raw.debtStrategy.startMonth = '2025-02';
    expect(normalizePlan(raw).debtStrategy.startMonth).toBe('2025-02');
  });

  it('still migrates old calendar-month bonuses to yearly ones', () => {
    const raw: any = { ...plan(), people: [{ id: 'p', name: 'A', bonuses: [{ id: 'b', month: 7, amount: 500 }] }] };
    expect(normalizePlan(raw).people[0].bonuses[0]).toMatchObject({ frequency: 'yearly', startMonth: '2026-07', amount: 500 });
  });

  it('rejects data without settings', () => {
    expect(() => normalizePlan({ settings: 'x' })).toThrow();
    expect(() => normalizePlan(null)).toThrow();
  });
});

describe('normalizeWorkspace', () => {
  it('gives duplicate scenario ids new ones and keeps the active id valid', () => {
    const ws = normalizeWorkspace({
      kind: 'finance-planner-workspace',
      activeId: 'a',
      scenarios: [
        { id: 'a', name: 'A', plan: plan() },
        { id: 'a', name: 'Copy', plan: plan() },
        { id: '', name: 'No id', plan: plan() },
      ],
    });
    const ids = ws.scenarios.map((s) => s.id);
    expect(ws.scenarios.map((s) => s.name)).toEqual(['A', 'Copy', 'No id']);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('a');
    expect(ws.activeId).toBe('a');
  });

  it('falls back to the first plan when the active id is missing', () => {
    const ws = normalizeWorkspace({ kind: 'finance-planner-workspace', activeId: 42, scenarios: [{ id: 'x', name: 'X', plan: plan() }] });
    expect(ws.activeId).toBe('x');
  });
});

describe('loadWorkspace', () => {
  const KEY = 'finance-planner/workspace/v1';
  const LEGACY = 'finance-planner/plan/v1';

  it('loads a saved workspace', () => {
    const ws = normalizeWorkspace(wrapPlan(plan(), 'Mine'));
    const storage = memoryStorage({ [KEY]: JSON.stringify(ws) });
    expect(loadWorkspace(storage).ws).toEqual(ws);
  });

  it('copies unreadable data aside before falling back to the example', () => {
    const storage = memoryStorage({ [KEY]: '{not json' });
    const loaded = loadWorkspace(storage);
    expect(loaded.ws.scenarios[0].plan.isExample).toBe(true);
    expect(loaded.keepStored).toBe(false);
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
    const backup = keys.find((k) => k.startsWith(`${KEY}.unreadable-`));
    expect(backup).toBeDefined();
    expect(storage.getItem(backup!)).toBe('{not json');
    expect(storage.getItem(KEY)).toBe('{not json');
  });

  it('does the same for the legacy single-plan key', () => {
    const storage = memoryStorage({ [LEGACY]: '[1,2' });
    loadWorkspace(storage);
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
    expect(keys.some((k) => k.startsWith(`${LEGACY}.unreadable-`))).toBe(true);
  });

  it('asks not to overwrite unreadable data it could not copy', () => {
    const storage = memoryStorage({ [KEY]: '{not json' }, { failWrites: true });
    expect(loadWorkspace(storage).keepStored).toBe(true);
  });
});

describe('history reducer', () => {
  const ws0: Workspace = wrapPlan(plan(), 'A');
  const setSavings =
    (n: number) =>
    (w: Workspace): Workspace => ({
      ...w,
      scenarios: w.scenarios.map((s) => ({ ...s, plan: { ...s.plan, settings: { ...s.plan.settings, startingSavings: n } } })),
    });
  const savings = (s: HistoryState) => s.ws.scenarios[0].plan.settings.startingSavings;

  it('makes every change its own undo step, however quickly they come', () => {
    let s = initialHistory(ws0);
    s = historyReducer(s, { type: 'set', update: setSavings(1) });
    s = historyReducer(s, { type: 'set', update: setSavings(2) });
    expect(s.past).toHaveLength(2);
    s = historyReducer(s, { type: 'undo' });
    expect(savings(s)).toBe(1);
  });

  it('ignores changes that leave the workspace identical', () => {
    const s = historyReducer(initialHistory(ws0), { type: 'set', update: setSavings(1) });
    expect(historyReducer(s, { type: 'set', update: (w) => w })).toBe(s);
    expect(historyReducer(s, { type: 'set', update: (w) => structuredClone(w) })).toBe(s);
    expect(historyReducer(s, { type: 'set', update: setSavings(1) })).toBe(s);
  });

  it('bumps the version on undo, redo and sync, but not on edits', () => {
    let s = initialHistory(ws0);
    s = historyReducer(s, { type: 'set', update: setSavings(1) });
    expect(s.version).toBe(0);
    s = historyReducer(s, { type: 'undo' });
    expect([s.version, savings(s), s.future.length]).toEqual([1, 0, 1]);
    s = historyReducer(s, { type: 'redo' });
    expect([s.version, savings(s), s.future.length]).toEqual([2, 1, 0]);
    expect(historyReducer(s, { type: 'redo' })).toBe(s);
  });

  it('takes another tab’s workspace and clears history on sync', () => {
    let s = initialHistory(ws0);
    s = historyReducer(s, { type: 'set', update: setSavings(1) });
    const other = setSavings(9)(ws0);
    s = historyReducer(s, { type: 'sync', ws: other });
    expect(s.ws).toBe(other);
    expect([s.past.length, s.future.length, s.version]).toEqual([0, 0, 1]);
    expect(historyReducer(s, { type: 'sync', ws: structuredClone(other) })).toBe(s);
  });

  it('starts a new branch after undo', () => {
    let s = initialHistory(ws0);
    s = historyReducer(s, { type: 'set', update: setSavings(1) });
    s = historyReducer(s, { type: 'undo' });
    s = historyReducer(s, { type: 'set', update: setSavings(5) });
    expect(s.future).toEqual([]);
    expect(savings(s)).toBe(5);
  });
});
