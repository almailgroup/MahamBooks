import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerServiceWorker } from './app/pwa';
import { loadLanguage, storedLanguage } from './i18n';

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
  });

registerServiceWorker();
