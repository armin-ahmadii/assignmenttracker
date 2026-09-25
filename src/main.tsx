import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './index.css';
import { App } from './App';
import * as actions from './data/actions';
import { bootAuth } from './data/auth';
import { store } from './data/store';
import { sync } from './data/sync';
import { initNav } from './ui/nav';
import { initTheme } from './ui/theme';

initTheme();
initNav();

// iOS doesn't resize the layout for the on-screen keyboard; lift bottom sheets above it.
const viewport = window.visualViewport;
if (viewport) {
  const syncKeyboard = () => {
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(covered)}px`);
  };
  viewport.addEventListener('resize', syncKeyboard);
  viewport.addEventListener('scroll', syncKeyboard);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Local data first (it's all the Now screen needs), then auth and sync in the background.
store
  .init()
  .then(() => {
    actions.runRecurring();
    sync.afterPull = () => actions.runRecurring();
    return bootAuth();
  })
  .catch((err) => console.error('Startup failed', err));

registerSW({ immediate: true });

if (import.meta.env.DEV) {
  Object.assign(window, { __due: { store, actions } });
}
