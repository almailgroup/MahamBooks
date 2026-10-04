import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { APP_NAME } from '@/lib/brand';
import { t } from '@/i18n';
import { activateUpdate } from './update';

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;

/**
 * Registers the service worker that lets the app work offline. A new version
 * never reloads the page by itself: the user picks the moment, so nothing
 * typed into an open editor is lost.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  registerSW({
    onNeedRefresh() {
      // Called more than once for updates found by a background check.
      toast(t('A new version of {app} is available', { app: APP_NAME }), {
        id: 'app-update',
        description: t('Save your work, then reload to update.'),
        duration: Infinity,
        action: { label: t('Reload'), onClick: () => activateUpdate(registration?.waiting) },
      });
    },
    onOfflineReady() {
      toast.success(t('{app} now works offline', { app: APP_NAME }), {
        description: t('You can also install it as an app from your browser menu.'),
      });
    },
    onRegisteredSW(_url, registered) {
      registration = registered;
      if (!registered) return;
      // Tabs that stay open for days still learn about new versions.
      setInterval(() => {
        if (navigator.onLine) registered.update().catch(() => undefined);
      }, UPDATE_CHECK_INTERVAL);
    },
  });
}
