import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import './env.d';
// Frameless window chrome: body reset (kill stray scrollbar) + drag region.
import './chrome.css';
// Acrylic-approximation surface styles (Phase 7): the .np-acrylic class for the
// settings pane + in-app notification surfaces, driven by per-theme CSS vars.
import './theme/acrylic.css';

// ---------------------------------------------------------------------------
//  Tauri bridge install — runs BEFORE React mounts so every renderer consumer
//  sees window.notepads. Guarded: only activates inside a Tauri webview
//  ('__TAURI_INTERNALS__' is present); vitest/jsdom keeps using test mocks.
// ---------------------------------------------------------------------------
if ('__TAURI_INTERNALS__' in window) {
  const { installBridge } = await import('./bridge/index');
  installBridge();

  // Emit renderer-ready signal: the broker queues activations (cold-start
  // file opens) until this event arrives. Window label = payload so the
  // broker can flush per-window queues.
  const { emit } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await emit('notepads:renderer:ready', getCurrentWindow().label);
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

// <I18nProvider> is the outermost shell so every useT() consumer re-localizes on
// a settings.appLanguage change with NO reload (it self-binds to the MAIN-owned
// setting; '' = follow OS UI language, else the chosen BCP-47 tag). Phase 6 wave 2.
ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
