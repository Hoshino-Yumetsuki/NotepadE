import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import './env.d';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

// <I18nProvider> is the outermost shell so every useT() consumer re-localizes on
// a settings.appLanguage change with NO reload (it self-binds to the MAIN-owned
// setting; '' = follow OS UI language, else the chosen BCP-47 tag). Phase 6 wave 2.
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
