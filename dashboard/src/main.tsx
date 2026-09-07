import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';
import samcheBrandLogo from './assets/branding/samche-company-llc-logo.png';
import { setSamCheFavicon } from './lib/branding';
import { registerDashboardServiceWorker } from './lib/pwa';
import './styles/globals.css';

setSamCheFavicon(samcheBrandLogo);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void registerDashboardServiceWorker(); });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProviders><AppRouter /></AppProviders>
    </BrowserRouter>
  </React.StrictMode>,
);

