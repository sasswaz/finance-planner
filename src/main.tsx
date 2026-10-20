import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlanProvider } from './store';
import { ThemeProvider } from './theme';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PlanProvider>
        <App />
      </PlanProvider>
    </ThemeProvider>
  </StrictMode>,
);
