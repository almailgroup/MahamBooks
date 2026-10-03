import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/ui/overlay';
import { router } from '@/app/router';
import { LanguageProvider, useLanguage } from '@/i18n/provider';

function Notifications() {
  const { dir } = useLanguage();
  return (
    <Toaster
      dir={dir}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      richColors
      closeButton
      // On phones, above the tab bar and an editor's action bar.
      mobileOffset={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}
    />
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
        <Notifications />
      </ConfirmProvider>
    </LanguageProvider>
  );
}
