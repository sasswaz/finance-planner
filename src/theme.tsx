import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

const KEY = 'finance-planner/theme';

/** Chart colours per theme. Mirrors the CSS tokens in styles.css. */
export const CHART_THEME = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    surface: '#fcfcfb',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    muted: '#898781',
    baseline: '#a8a69e',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    surface: '#1a1a19',
    grid: '#2c2c2a',
    axis: '#383835',
    muted: '#898781',
    baseline: '#6f6d66',
  },
};

const ThemeContext = createContext<{ pref: ThemePref; setPref: (p: ThemePref) => void; resolved: Resolved }>({
  pref: 'system',
  setPref: () => {},
  resolved: 'light',
});

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // ignore
    }
  }, [pref]);

  const resolved: Resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  return <ThemeContext.Provider value={{ pref, setPref, resolved }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useChartTheme = () => CHART_THEME[useTheme().resolved];
