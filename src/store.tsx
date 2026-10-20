import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { confirmDiscard } from './drafts';
import { currentYM, isValidYM } from './engine/dates';
import { project, type Projection } from './engine/projection';
import { emptyPlan, examplePlan, uid } from './example';
import { makeFormatters, type Formatters } from './format';
import {
  EXPENSE_CATEGORIES,
  LOAN_KINDS,
  type ExpenseCategory,
  type Frequency,
  type LoanKind,
  type Plan,
  type Scenario,
  type Workspace,
} from './types';

const STORAGE_KEY = 'finance-planner/workspace/v1';
/** Single-plan storage used before scenarios existed; migrated on first load. */
const LEGACY_KEY = 'finance-planner/plan/v1';
const HISTORY_LIMIT = 100;

type Updater = Plan | ((p: Plan) => Plan);

interface PlanContextValue {
  plan: Plan;
  setPlan: (u: Updater) => void;
  projection: Projection;
  fmt: Formatters;
  workspace: Workspace;
  activeScenario: Scenario;
  scenarios: {
    switchTo: (id: string) => void;
    duplicate: (name: string) => void;
    rename: (id: string, name: string) => void;
    remove: (id: string) => void;
    addPlan: (name: string, plan: Plan) => void;
  };
  replaceWorkspace: (ws: Workspace) => void;
  /** `version` changes on undo, redo and when another tab saves: anything kept outside the store is stale. */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; version: number };
  /** The last attempt to save to this browser's storage failed. */
  saveError: boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export const wrapPlan = (plan: Plan, name = 'My plan'): Workspace => {
  const id = uid();
  return { kind: 'finance-planner-workspace', version: 1, activeId: id, scenarios: [{ id, name, plan }] };
};

interface Loaded {
  ws: Workspace;
  /** Stored data couldn't be read nor copied aside: don't overwrite it. */
  keepStored?: boolean;
}

/** Reads the saved workspace. Unreadable data is copied aside first, so falling back never destroys it. */
export function loadWorkspace(storage: Storage = localStorage): Loaded {
  let keepStored = false;
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      break; // Storage unavailable.
    }
    if (raw == null) continue;
    try {
      return { ws: normalizeWorkspace(JSON.parse(raw)), keepStored };
    } catch {
      try {
        storage.setItem(`${key}.unreadable-${Date.now()}`, raw);
      } catch {
        keepStored = true;
      }
    }
  }
  return { ws: wrapPlan(examplePlan()), keepStored };
}

export interface HistoryState {
  ws: Workspace;
  past: Workspace[];
  future: Workspace[];
  /** Bumped on undo, redo and sync, i.e. whenever the workspace jumps rather than being edited. */
  version: number;
}

export type HistoryAction =
  | { type: 'set'; update: (ws: Workspace) => Workspace }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Another tab saved: take its workspace as is. */
  | { type: 'sync'; ws: Workspace };

export const initialHistory = (ws: Workspace): HistoryState => ({ ws, past: [], future: [], version: 0 });

const same = (a: Workspace, b: Workspace) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Every change is its own undo step (drafts already batch typing); changes that change nothing are dropped. */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'set': {
      const ws = action.update(state.ws);
      if (same(ws, state.ws)) return state;
      return { ws, past: [...state.past, state.ws].slice(-HISTORY_LIMIT), future: [], version: state.version };
    }
    case 'undo':
      if (!state.past.length) return state;
      return {
        ws: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.ws, ...state.future],
        version: state.version + 1,
      };
    case 'redo':
      if (!state.future.length) return state;
      return { ws: state.future[0], past: [...state.past, state.ws], future: state.future.slice(1), version: state.version + 1 };
    case 'sync':
      if (same(action.ws, state.ws)) return state;
      return { ws: action.ws, past: [], future: [], version: state.version + 1 };
  }
}

/** Where Cmd/Ctrl+Z belongs to the browser or an open editor, not to plan history. */
const inEditingContext = (el: EventTarget | null) =>
  el instanceof Element && (!!el.closest('input, select, textarea, form') || (el as HTMLElement).isContentEditable);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [loaded] = useState(loadWorkspace);
  const [state, dispatch] = useReducer(historyReducer, loaded.ws, initialHistory);
  const { ws } = state;
  const [saveError, setSaveError] = useState(false);
  /** Set while stored data we couldn't read (or back up) must not be overwritten. */
  const keepStored = useRef(!!loaded.keepStored);
  /** The workspace last loaded from another tab: already in storage, so not written back. */
  const fromOtherTab = useRef<Workspace | null>(null);

  useEffect(() => {
    if (ws === fromOtherTab.current) return;
    if (keepStored.current) {
      setSaveError(true);
      return;
    }
    try {
      const json = JSON.stringify(ws);
      if (localStorage.getItem(STORAGE_KEY) !== json) localStorage.setItem(STORAGE_KEY, json);
      localStorage.removeItem(LEGACY_KEY);
      setSaveError(false);
    } catch {
      // Storage full or blocked: the plan still works for this session, but say so.
      setSaveError(true);
    }
  }, [ws]);

  // Another tab saved: switch to its version instead of overwriting it with ours on the next edit.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      try {
        if (e.storageArea && e.storageArea !== localStorage) return;
        const next = normalizeWorkspace(JSON.parse(e.newValue));
        fromOtherTab.current = next;
        keepStored.current = false;
        dispatch({ type: 'sync', ws: next });
      } catch {
        // Unreadable: keep what we have.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Cmd/Ctrl+Z undoes saved plan changes — but not from inside a field or an open editor,
  // where it would undo something unrelated to what the user is looking at.
  const historyRef = useRef(state);
  useEffect(() => {
    historyRef.current = state;
  }, [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (inEditingContext(document.activeElement) || inEditingContext(e.target)) return;
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      const { past, future } = historyRef.current;
      if (!(redo ? future : past).length || !confirmDiscard()) return;
      dispatch({ type: redo ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = useCallback((fn: (ws: Workspace) => Workspace) => dispatch({ type: 'set', update: fn }), []);

  const activeScenario = ws.scenarios.find((s) => s.id === ws.activeId) ?? ws.scenarios[0];
  const plan = activeScenario.plan;

  const setPlan = useCallback(
    (u: Updater) =>
      update((w) => ({
        ...w,
        scenarios: w.scenarios.map((s) => (s.id === w.activeId ? { ...s, plan: typeof u === 'function' ? u(s.plan) : u } : s)),
      })),
    [update],
  );

  const scenarios = useMemo(
    () => ({
      switchTo: (id: string) => update((w) => ({ ...w, activeId: id })),
      duplicate: (name: string) =>
        update((w) => {
          const src = w.scenarios.find((s) => s.id === w.activeId) ?? w.scenarios[0];
          const id = uid();
          return { ...w, activeId: id, scenarios: [...w.scenarios, { id, name, plan: structuredClone(src.plan) }] };
        }),
      rename: (id: string, name: string) =>
        update((w) => ({ ...w, scenarios: w.scenarios.map((s) => (s.id === id ? { ...s, name } : s)) })),
      remove: (id: string) =>
        update((w) => {
          if (w.scenarios.length <= 1) return w;
          const rest = w.scenarios.filter((s) => s.id !== id);
          return { ...w, scenarios: rest, activeId: w.activeId === id ? rest[0].id : w.activeId };
        }),
      addPlan: (name: string, p: Plan) =>
        update((w) => {
          const id = uid();
          return { ...w, activeId: id, scenarios: [...w.scenarios, { id, name, plan: p }] };
        }),
    }),
    [update],
  );

  const replaceWorkspace = useCallback((next: Workspace) => update(() => next), [update]);

  const history = useMemo(
    () => ({
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      version: state.version,
    }),
    [state.past.length, state.future.length, state.version],
  );

  const projection = useMemo(() => project(plan), [plan]);
  const fmt = useMemo(() => makeFormatters(plan.settings), [plan.settings]);

  const value = useMemo(
    () => ({ plan, setPlan, projection, fmt, workspace: ws, activeScenario, scenarios, replaceWorkspace, history, saveError }),
    [plan, setPlan, projection, fmt, ws, activeScenario, scenarios, replaceWorkspace, history, saveError],
  );
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used inside PlanProvider');
  return ctx;
}

type ListKey = 'people' | 'incomes' | 'expenses' | 'loans' | 'goals';
type Item<K extends ListKey> = Plan[K][number];

/** Add / update / remove helpers for one of the plan's top-level lists. */
export function useList<K extends ListKey>(key: K) {
  const { plan, setPlan } = usePlan();
  return useMemo(
    () => ({
      items: plan[key] as Item<K>[],
      add: (item: Item<K>) => setPlan((p) => ({ ...p, [key]: [...p[key], item] })),
      update: (id: string, patch: Partial<Item<K>>) =>
        setPlan((p) => ({ ...p, [key]: (p[key] as Item<K>[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      remove: (id: string) => setPlan((p) => ({ ...p, [key]: (p[key] as Item<K>[]).filter((x) => x.id !== id) })),
    }),
    [plan, key, setPlan],
  );
}

export const updateById = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>) =>
  list.map((x) => (x.id === id ? { ...x, ...patch } : x));
export const removeById = <T extends { id: string }>(list: T[], id: string) => list.filter((x) => x.id !== id);

// ---------------------------------------------------------------------------
// Validation for stored and imported data: coerce every field, drop junk.

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: any, d = '') => (typeof v === 'string' ? v : d);
const ym = (v: any, d = currentYM()) => (isValidYM(v) ? v : d);
const optYm = (v: any) => (isValidYM(v) ? v : undefined);
/** A list of objects: anything else in it (null, numbers…) is dropped rather than breaking the whole plan. */
const arr = (v: any): any[] => (Array.isArray(v) ? v.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const oneOf = <T extends string>(v: any, options: readonly T[], d: T): T => (options.includes(v) ? v : d);
const FREQS: Frequency[] = ['monthly', 'quarterly', 'yearly', 'once'];

/** Accepts a workspace export, or a single plan (older exports), and returns a workspace. */
export function normalizeWorkspace(raw: any): Workspace {
  if (raw?.kind !== 'finance-planner-workspace') return wrapPlan(normalizePlan(raw));
  const scenarios: Scenario[] = [];
  const ids = new Set<string>();
  for (const s of arr(raw.scenarios)) {
    try {
      const plan = normalizePlan(s.plan);
      // Ids must be unique: a copy sharing its original's id would be edited and deleted along with it.
      let id = str(s.id);
      if (!id || ids.has(id)) id = uid();
      ids.add(id);
      scenarios.push({ id, name: str(s.name, 'Plan') || 'Plan', plan });
    } catch {
      // Skip a broken scenario rather than losing the rest.
    }
  }
  if (!scenarios.length) throw new Error('No plans found in this file');
  const activeId = scenarios.some((s) => s.id === raw.activeId) ? raw.activeId : scenarios[0].id;
  return { kind: 'finance-planner-workspace', version: 1, activeId, scenarios };
}

export function normalizePlan(raw: any): Plan {
  if (!raw || typeof raw !== 'object' || !raw.settings || typeof raw.settings !== 'object') {
    throw new Error('Not a finance planner file');
  }
  const d = emptyPlan().settings;
  const s = raw.settings;
  const settings = {
    currency: str(s.currency, d.currency) || d.currency,
    locale: str(s.locale, d.locale) || d.locale,
    startMonth: ym(s.startMonth, d.startMonth),
    horizonYears: Math.min(50, Math.max(1, num(s.horizonYears, d.horizonYears))),
    startingSavings: num(s.startingSavings),
    savingsInterestPct: num(s.savingsInterestPct),
    inflationPct: num(s.inflationPct, d.inflationPct),
  };
  return {
    version: 1,
    isExample: raw.isExample === true || undefined,
    settings,
    people: arr(raw.people).map((p) => ({
      id: str(p.id) || uid(),
      name: str(p.name, 'Person'),
      netMonthlySalary: num(p.netMonthlySalary),
      annualRaisePct: num(p.annualRaisePct),
      bonuses: arr(p.bonuses).map((b) => {
        // Older plans stored only a calendar month (yearly bonus); place it in the plan's first year.
        const legacyMonth = Math.min(12, Math.max(1, Math.round(num(b.month, 12))));
        return {
          id: str(b.id) || uid(),
          label: str(b.label),
          frequency: oneOf(b.frequency, FREQS, 'yearly'),
          startMonth: ym(b.startMonth, `${settings.startMonth.slice(0, 4)}-${String(legacyMonth).padStart(2, '0')}`),
          endMonth: optYm(b.endMonth),
          amountType: oneOf(b.amountType, ['fixed', 'salary'] as const, 'fixed'),
          amount: num(b.amount),
        };
      }),
      salaryChanges: arr(p.salaryChanges).map((c) => ({
        id: str(c.id) || uid(),
        month: ym(c.month),
        netMonthlySalary: num(c.netMonthlySalary),
        label: str(c.label),
        bonusesPaid: c.bonusesPaid !== false,
      })),
    })),
    incomes: arr(raw.incomes).map((i) => ({
      id: str(i.id) || uid(),
      name: str(i.name, 'Income'),
      amount: num(i.amount),
      frequency: oneOf(i.frequency, FREQS, 'monthly'),
      startMonth: ym(i.startMonth),
      endMonth: optYm(i.endMonth),
    })),
    expenses: arr(raw.expenses).map((e) => ({
      id: str(e.id) || uid(),
      name: str(e.name, 'Expense'),
      category: oneOf<ExpenseCategory>(e.category, EXPENSE_CATEGORIES, 'Other'),
      amount: num(e.amount),
      frequency: oneOf(e.frequency, FREQS, 'monthly'),
      startMonth: ym(e.startMonth),
      endMonth: optYm(e.endMonth),
    })),
    loans: arr(raw.loans).map((l) => ({
      id: str(l.id) || uid(),
      name: str(l.name, 'Loan'),
      kind: oneOf<LoanKind>(l.kind, LOAN_KINDS, 'Other'),
      balance: num(l.balance),
      annualRatePct: num(l.annualRatePct),
      firstPaymentMonth: ym(l.firstPaymentMonth),
      inputMode: oneOf(l.inputMode, ['term', 'payment'] as const, 'term'),
      remainingMonths: Math.max(1, Math.round(num(l.remainingMonths, 1))),
      monthlyPayment: num(l.monthlyPayment),
      strategy: oneOf(l.strategy, ['reduce-term', 'reduce-payment'] as const, 'reduce-term'),
      earlyRepaymentFeePct: num(l.earlyRepaymentFeePct),
      extraPayments: arr(l.extraPayments).map((x) => ({
        id: str(x.id) || uid(),
        startMonth: ym(x.startMonth),
        amount: num(x.amount),
        frequency: oneOf(x.frequency, ['once', 'monthly', 'yearly'] as const, 'once'),
        endMonth: optYm(x.endMonth),
        kind: oneOf(x.kind, ['fixed', 'bonus'] as const, 'fixed'),
        bonusPct: Math.min(100, Math.max(0, num(x.bonusPct, 50))),
        bonusPersonId: str(x.bonusPersonId) || undefined,
        bonusMonth: Number.isInteger(x.bonusMonth) && x.bonusMonth >= 1 && x.bonusMonth <= 12 ? x.bonusMonth : undefined,
      })),
      rateChanges: arr(l.rateChanges).map((c) => ({
        id: str(c.id) || uid(),
        month: ym(c.month),
        annualRatePct: num(c.annualRatePct),
      })),
      rollInto: str(l.rollInto) || undefined,
    })),
    goals: arr(raw.goals).map((g) => ({
      id: str(g.id) || uid(),
      name: str(g.name, 'Goal'),
      targetAmount: num(g.targetAmount),
      targetMonth: ym(g.targetMonth),
    })),
    debtStrategy: {
      mode: oneOf(raw.debtStrategy?.mode, ['manual', 'avalanche', 'snowball'] as const, 'manual'),
      extraMonthly: Math.max(0, num(raw.debtStrategy?.extraMonthly)),
      startMonth: ym(raw.debtStrategy?.startMonth, settings.startMonth),
    },
  };
}
