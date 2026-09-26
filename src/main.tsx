import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './index.css';
import { App } from './App';
import * as actions from './data/actions';
import { store } from './data/store';
import { sync } from './data/sync';
import { takeKeyFromUrl } from './data/syncKey';
import { bootSync, connectFromLink } from './data/syncSetup';
import { initNav } from './ui/nav';
import { initTheme } from './ui/theme';
import { showToast } from './ui/toast';

// Read a connect link before navigation rewrites the address bar.
const linkKey = takeKeyFromUrl();
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

// Local data first (it's all the Now screen needs), then sync in the background.
store
  .init()
  .then(async () => {
    actions.runRecurring();
    sync.afterPull = () => actions.runRecurring();
    bootSync();
    if (linkKey) showToast({ message: await connectFromLink(linkKey) });
  })
  .catch((err) => console.error('Startup failed', err));

registerSW({ immediate: true });

if (import.meta.env.DEV) {
  Object.assign(window, { __due: { store, actions } });
}
