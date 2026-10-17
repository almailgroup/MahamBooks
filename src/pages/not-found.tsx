import { FileQuestion } from 'lucide-react';
import { t } from '@/i18n';
import { ButtonLink } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/misc';

export default function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={<FileQuestion />}
        title={t('Page not found')}
        description={t("The page you were looking for doesn't exist or has moved.")}
        action={<ButtonLink to="/">{t('Go to the home page')}</ButtonLink>}
      />
    </Card>
  );
}
