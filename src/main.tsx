// First: a page opened from a link in an email gets its route set before the router starts.
import { authRedirect } from './cloud/boot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerServiceWorker } from './app/pwa';
import { applyStoredTheme } from './app/theme';
import { loadLanguage, storedLanguage } from './i18n';
import { hasSavedSession } from './cloud/client';
import { connectCloud } from './cloud/store';

// The theme is applied before anything renders, so the page never shows
// another theme first (index.html has already painted its background).
applyStoredTheme();

// The Arabic dictionary is loaded before the first render so the app never
// flashes in English.
void loadLanguage(storedLanguage())
  .catch(() => loadLanguage('en'))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // The cloud code loads after the first paint, and only for people who use it.
    if (authRedirect || hasSavedSession()) void connectCloud().catch(() => undefined);
  });

registerServiceWorker();
