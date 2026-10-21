import { Link } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import { useCompany } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import { t } from '@/i18n';
import { buttonClass } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { ApprovalsInbox } from '@/features/approvals/inbox';

/**
 * Approval requests (طلبات الاعتماد): changes waiting for an approver, the
 * person's own and the decided ones. For companies kept in the cloud: a
 * company kept on this device has nobody to ask.
 */
export default function ApprovalsPage() {
  const company = useCompany();
  const link = useCloudLink(company.id);
  return (
    <div>
      <PageHeader
        title={t('Approval requests')}
        description={t(
          'Changes to issued documents that wait for the owner or a member the owner allowed to approve.',
        )}
      />
      {link === undefined ? (
        <Spinner className="py-24" label={t('Loading…')} />
      ) : link === null ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title={t('Approvals are for companies kept in the cloud')}
            description={t(
              'On this device only, nobody else changes the company, so nothing waits for approval.',
            )}
            action={
              <Link to="/settings/approvals" className={buttonClass('outline')}>
                {t('Approval settings')}
              </Link>
            }
          />
        </Card>
      ) : (
        <ApprovalsInbox />
      )}
    </div>
  );
}
