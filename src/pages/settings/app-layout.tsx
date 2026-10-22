import { useState } from 'react';
import { toast } from 'sonner';
import type { Company } from '@/db/types';
import { saveCompany } from '@/db/records';
import { useCompany } from '@/app/company';
import { Switch } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { appLayoutOf } from '@/suite/apps';
import { SettingsSection } from './shared';

/** The company with Sales and Inventory as their own apps, or back to the four apps (D1: missing). */
export function withAppLayout(company: Company, split: boolean): Company {
  const { appLayout: _layout, ...rest } = company;
  return split ? { ...rest, appLayout: 'split' } : rest;
}

/**
 * Settings → Team, above the access grid: whether Maham Books is one app or
 * three (Maham Sales, Maham Books and Maham Inventory), for everyone in the
 * company. Off until the owner or an admin turns it on. Only the sidebars,
 * the switcher, the home and search change: every page, address and record
 * stays as it is, and so do the owner's limits on members. `inline` puts it
 * inside another section (a company kept on this device only), as a block.
 */
export function AppLayoutSection({
  canChange,
  inline = false,
}: {
  canChange: boolean;
  inline?: boolean;
}) {
  const company = useCompany();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const split = appLayoutOf(company) === 'split';
  const name = localName(company);

  const change = async (on: boolean) => {
    if (on) {
      const ok = await confirm({
        title: t('Give Sales and Inventory their own apps?'),
        description: t(
          'Everyone in {company} sees Maham Sales, Maham Books and Maham Inventory in place of Maham Books, on each device once it syncs. Pages, addresses and records stay as they are. You can switch back at any time.',
          { company: name },
        ),
        confirmLabel: t('Switch on'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await saveCompany(withAppLayout(company, on));
      toast.success(t('App layout saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save settings.'));
    } finally {
      setBusy(false);
    }
  };

  const title = t('App layout');
  const description = t('The apps everyone in {company} sees.', { company: name });
  const body = (
    <>
      <Switch
        checked={split}
        onChange={(on) => void change(on)}
        disabled={!canChange || busy}
        label={t('Maham Sales and Maham Inventory as their own apps')}
        description={t(
          'Maham Sales has quotes, orders, invoices, payments received and customers; Maham Inventory has items and stock. Maham Books keeps purchases, cheques, banking, accounting and reports, with invoices under Receivables. Pages, addresses and records stay as they are.',
        )}
      />
      {canChange ? null : (
        <p className="text-sm text-slate-500">
          {t('Only the owner or an admin changes the app layout.')}
        </p>
      )}
    </>
  );

  if (inline) {
    return (
      <section aria-label={title} className="space-y-3 border-t border-slate-100 pt-5">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {body}
      </section>
    );
  }
  return (
    <SettingsSection id="app-layout" title={title} description={description}>
      {body}
    </SettingsSection>
  );
}
