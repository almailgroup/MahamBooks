import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/ui/overlay';
import { router } from '@/app/router';
import { t } from '@/i18n';
import { LanguageProvider, useLanguage } from '@/i18n/provider';
import { ThemeProvider, useTheme } from '@/features/theme/provider';

function Notifications() {
  const { dir } = useLanguage();
  const { theme } = useTheme();
  return (
    <Toaster
      dir={dir}
      theme={theme.scheme}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      richColors
      closeButton
      containerAriaLabel={t('Notifications')}
      toastOptions={{ closeButtonAriaLabel: t('Close') }}
      // On phones, above the tab bar and an editor's action bar.
      mobileOffset={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
          <Notifications />
        </ConfirmProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
