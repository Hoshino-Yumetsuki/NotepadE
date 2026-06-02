import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './env.d';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
