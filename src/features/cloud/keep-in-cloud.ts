import { useConfirm } from '@/components/ui/overlay';
import type { Company } from '@/db/types';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { cloudError } from '@/cloud/api';
import { allowOnDevice } from '@/cloud/kept-off';
import { startDownload, startUpload, type SyncContext } from '@/cloud/sync';

/**
 * "Keep in the cloud" for a company of this device. When the account already
 * has it in the cloud (a restored backup, a copy kept on this device), the
 * cloud's copy is never overwritten: the person is offered to download it
 * instead, replacing this device's copy. Resolves to what was started, or
 * null when the person chose neither.
 */
export function useKeepInCloud() {
  const confirm = useConfirm();
  return async (company: Company, ctx: SyncContext): Promise<'upload' | 'download' | null> => {
    try {
      await startUpload(company.id, ctx);
      return 'upload';
    } catch (error) {
      const e = cloudError(error);
      if (e.code !== 'company_exists') throw e;
      const inCloud = (await ctx.api.myCompanies()).find((c) => c.id === company.id);
      if (!inCloud) throw e;
      const ok = await confirm({
        title: t('{name} is already in your cloud account', { name: localName(company) }),
        description: t(
          'The copy in the cloud may have newer work from your team, so it is not replaced. Download it to this device instead? The copy on this device is replaced.',
        ),
        confirmLabel: t('Download from the cloud'),
        danger: true,
      });
      if (!ok) return null;
      await allowOnDevice(ctx.userId, company.id);
      await startDownload(inCloud, ctx);
      return 'download';
    }
  };
}
