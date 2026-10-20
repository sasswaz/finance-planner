import { useRef, useState } from 'react';
import { Field, Select } from '../components/inputs';
import { Card, PageHeader } from '../components/ui';
import { emptyPlan, examplePlan } from '../example';
import { CURRENCIES, LOCALES } from '../format';
import { normalizeWorkspace, usePlan, wrapPlan } from '../store';
import { useTheme, type ThemePref } from '../theme';

export function Settings() {
  const { plan, setPlan, workspace, activeScenario, replaceWorkspace, scenarios } = usePlan();
  const { pref, setPref } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const s = plan.settings;
  const setSettings = (patch: Partial<typeof s>) => setPlan((p) => ({ ...p, settings: { ...p.settings, ...patch } }));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance-plan-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const next = normalizeWorkspace(raw);
      if (raw?.kind === 'finance-planner-workspace') {
        const n = next.scenarios.length;
        if (!confirm(`Replace all your plans with the ${n} plan${n === 1 ? '' : 's'} in this backup?`)) return;
        replaceWorkspace(next);
        setMessage(`Restored ${n} plan${n === 1 ? '' : 's'} from ${file.name}.`);
      } else {
        // A single plan (older export): add it alongside the existing plans.
        scenarios.addPlan(file.name.replace(/\.json$/i, ''), next.scenarios[0].plan);
        setMessage(`Added ${file.name} as a new plan — switch between plans in the sidebar.`);
      }
    } catch (e) {
      setMessage(`Couldn't import ${file.name}: ${e instanceof Error ? e.message : 'invalid file'}.`);
    }
  };

  const currencyOptions = CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES];

  return (
    <>
      <PageHeader title="Settings" />

      <Card title="Display">
        <div className="form-grid">
          <Field label="Currency">
            <Select value={s.currency} options={currencyOptions} onChange={(currency) => setSettings({ currency })} />
          </Field>
          <Field label="Number format">
            <Select value={s.locale} options={LOCALES} onChange={(locale) => setSettings({ locale })} />
          </Field>
          <Field label="Theme">
            <Select<ThemePref>
              value={pref}
              onChange={setPref}
              options={[
                { value: 'system', label: 'Match system' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card title="Your data" subtitle="Your plans are saved automatically in this browser on this computer. Nothing is sent anywhere.">
        <p className="muted">
          Browser data can be wiped by clearing site data, so export a backup now and then. A backup file also moves your plan to another
          computer or browser.
        </p>
        <div className="button-row">
          <button className="btn primary" onClick={exportJson}>
            Export backup (.json{workspace.scenarios.length > 1 ? `, all ${workspace.scenarios.length} plans` : ''})
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }}
          />
        </div>
        {message && (
          <p className="small" role="status">
            {message}
          </p>
        )}
      </Card>

      <Card title="Start over">
        <div className="button-row">
          <button className="btn" onClick={() => scenarios.addPlan('Example', examplePlan())}>
            Add the example as a new plan
          </button>
          <button className="btn" onClick={() => confirm(`Clear everything in “${activeScenario.name}”?`) && setPlan(emptyPlan())}>
            Empty the current plan
          </button>
          <button
            className="btn danger-ghost"
            onClick={() => confirm('Delete ALL plans and start over with an empty one?') && replaceWorkspace(wrapPlan(emptyPlan()))}
          >
            Delete everything
          </button>
        </div>
      </Card>
    </>
  );
}
