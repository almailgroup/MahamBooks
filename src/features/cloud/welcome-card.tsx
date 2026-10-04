import { CloudUpload, Cloud } from 'lucide-react';
import { t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { useCloud } from '@/cloud/store';

/**
 * On the welcome screen: an account keeps the books in the cloud, on every
 * device and with a team. Signed in, it leads to the account's companies.
 */
export function CloudWelcomeCard() {
  const { configured, user } = useCloud();
  if (!configured) return null;
  if (user) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <span className="bg-primary-50 text-primary-600 flex size-11 shrink-0 items-center justify-center rounded-full">
          <Cloud className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold text-slate-900">
            {tr('Signed in as {email}', {
              email: (
                <span dir="ltr" className="font-semibold">
                  {user.email}
                </span>
              ),
            })}
          </p>
          <p className="text-sm text-slate-600">
            {t('Download a company from your account, or set up a new one below.')}
          </p>
        </div>
        <ButtonLink to="/cloud/companies" variant="outline">
          {t('Your companies')}
        </ButtonLink>
      </Card>
    );
  }
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="bg-primary-50 text-primary-600 flex size-11 shrink-0 items-center justify-center rounded-full">
          <CloudUpload className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">
            {t('Work from any device, with your team')}
          </h2>
          <p className="mt-0.5 text-sm text-pretty text-slate-600">
            {t(
              'Create an account to keep your books safe in the cloud. They still work offline, and invited staff only see what their role allows.',
            )}
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <ButtonLink to="/signup" size="lg" className="w-full">
          {t('Create an account')}
        </ButtonLink>
        <ButtonLink to="/signin" size="lg" variant="outline" className="w-full">
          {t('Sign in')}
        </ButtonLink>
      </div>
    </Card>
  );
}
