import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Compare } from './pages/Compare';
import { Expenses } from './pages/Expenses';
import { Goals } from './pages/Goals';
import { Income } from './pages/Income';
import { Loans } from './pages/Loans';
import { Overview } from './pages/Overview';
import { Projection } from './pages/Projection';
import { Settings } from './pages/Settings';
import { confirmDiscard, hasUnsavedChanges } from './drafts';
import { usePlan } from './store';

export type PageId = 'overview' | 'income' | 'expenses' | 'loans' | 'goals' | 'projection' | 'compare' | 'settings';

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PAGES: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: icon('M3 10.5L10 4l7 6.5M5 9v7h10V9') },
  { id: 'income', label: 'Income', icon: icon('M10 16V4M5 9l5-5 5 5') },
  { id: 'expenses', label: 'Expenses', icon: icon('M10 4v12M5 11l5 5 5-5') },
  { id: 'loans', label: 'Loans', icon: icon('M3 7l7-4 7 4M4 7v8M8 7v8M12 7v8M16 7v8M3 16h14') },
  { id: 'goals', label: 'Savings & goals', icon: icon('M10 17a7 7 0 100-14 7 7 0 000 14zM10 13a3 3 0 100-6 3 3 0 000 6z') },
  { id: 'projection', label: 'Projection', icon: icon('M3 16h14M5 13l3-4 3 2 5-6') },
  { id: 'compare', label: 'Compare plans', icon: icon('M7 4v12M13 4v12M4 7h6M10 13h6') },
  {
    id: 'settings',
    label: 'Settings',
    icon: icon(
      'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
    ),
  },
];

const pageFromHash = (): PageId => {
  const id = window.location.hash.slice(1) as PageId;
  return PAGES.some((p) => p.id === id) ? id : 'overview';
};

export function App() {
  const { workspace, history, saveError } = usePlan();
  const [page, setPage] = useState<PageId>(pageFromHash);
  const pageRef = useRef(page);
  /** Set by go(): scroll to the top once the page has actually changed. */
  const scrollOnChange = useRef(false);

  // Every page change — sidebar links, go(), Back/Forward — arrives here, so this is the one place that asks
  // about unsaved edits. Declining puts the address back to the page we're staying on.
  useEffect(() => {
    const onHash = () => {
      const scroll = scrollOnChange.current;
      scrollOnChange.current = false;
      const next = pageFromHash();
      if (next === pageRef.current) return;
      if (!confirmDiscard()) {
        window.history.replaceState(window.history.state, '', `#${pageRef.current}`);
        return;
      }
      pageRef.current = next;
      setPage(next);
      if (scroll) window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Closing or reloading the tab with unsaved edits asks first (Safari needs returnValue set).
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const go = (p: PageId) => {
    if (p === pageRef.current) {
      window.scrollTo({ top: 0 });
      return;
    }
    scrollOnChange.current = true;
    window.location.hash = p;
  };

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {icon('M4 14l4-4 3 2 5-6')}
          </span>
          Finance Planner
        </div>
        <PlanSwitcher />
        <ul>
          {PAGES.map((p) => (
            <li key={p.id}>
              <a href={`#${p.id}`} className={page === p.id ? 'active' : ''} aria-current={page === p.id ? 'page' : undefined}>
                {p.icon}
                <span>{p.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <UndoRedo />
        {saveError ? (
          <p className="sidebar-note save-error" role="alert" style={{ color: 'var(--neg)' }}>
            Couldn't save in this browser — export a backup (Settings)
          </p>
        ) : (
          <p className="sidebar-note">Saved in this browser only</p>
        )}
      </nav>
      {/* Keyed so that switching plans, undo/redo and changes from another tab drop page-local state
          (open editors, unsaved drafts, new-item forms) instead of carrying it into another version. */}
      <main className="main" key={`${workspace.activeId}:${history.version}`}>
        {page === 'overview' && <Overview go={go} />}
        {page === 'income' && <Income />}
        {page === 'expenses' && <Expenses />}
        {page === 'loans' && <Loans />}
        {page === 'goals' && <Goals />}
        {page === 'projection' && <Projection />}
        {page === 'compare' && <Compare go={go} />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}

function PlanSwitcher() {
  const { workspace, activeScenario, scenarios } = usePlan();
  return (
    <div className="plan-switcher">
      <label className="field-label" htmlFor="plan-select">
        Plan
      </label>
      <div className="plan-switcher-row">
        <select
          id="plan-select"
          className="input select"
          value={workspace.activeId}
          onChange={(e) => confirmDiscard() && scenarios.switchTo(e.target.value)}
        >
          {workspace.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-btn"
          title="Copy this plan to try a change"
          aria-label="Copy this plan"
          onClick={() => {
            // The copy becomes the open plan, which closes any open editors.
            if (!confirmDiscard()) return;
            const name = prompt('Name for the copy', `${activeScenario.name} – alternative`);
            if (name?.trim()) scenarios.duplicate(name.trim());
          }}
        >
          {icon('M7 7h9v9H7zM4 13V4h9')}
        </button>
      </div>
    </div>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function UndoRedo() {
  const { history } = usePlan();
  const mod = isMac ? '⌘' : 'Ctrl+';
  return (
    <div className="undo-redo">
      <button
        type="button"
        className="btn ghost"
        disabled={!history.canUndo}
        onClick={() => confirmDiscard() && history.undo()}
        title={`Undo (${mod}Z)`}
      >
        {icon('M8 5L4 9l4 4M4 9h8a4 4 0 010 8h-2')}
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="btn ghost"
        disabled={!history.canRedo}
        onClick={() => confirmDiscard() && history.redo()}
        title={`Redo (${mod}Shift+Z)`}
      >
        {icon('M12 5l4 4-4 4M16 9H8a4 4 0 000 8h2')}
        <span>Redo</span>
      </button>
    </div>
  );
}
