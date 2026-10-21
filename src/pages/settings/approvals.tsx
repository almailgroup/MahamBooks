import { Link } from 'react-router';
import type { ApprovalRules, DocumentType } from '@/db/types';
import { useCloudLink, useServerFeature } from '@/cloud/hooks';
import { isSuperAdmin } from '@/cloud/roles';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { Field, NumberInput, Switch } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { msg, t } from '@/i18n';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/** Days a request waits before it is cancelled, when the owner first turns the rules on. */
const DEFAULT_EXPIRE_DAYS = 14;

const COVERED: { type: DocumentType; label: string; description: string }[] = [
  {
    type: 'invoice',
    label: msg('Issued invoices need an approver to change'),
    description: msg(
      'Edits, voids and restores of an invoice that has been issued are sent for approval by everyone else.',
    ),
  },
  {
    type: 'credit',
    label: msg('Issued credit notes need an approver to change'),
    description: msg('The same for credit notes.'),
  },
];

/**
 * Settings → Approvals: the owner's rules (Company.approvalRules). Nothing
 * waits for approval until the owner turns them on, and only the owner
 * changes them (the cloud refuses anyone else). For companies kept in the
 * cloud, once the server has the approvals script.
 */
export default function ApprovalSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const link = useCloudLink(draft.id);
  const ready = useServerFeature(draft.id, 'approvals');

  if (link === undefined) return <Spinner className="py-24" label={t('Loading…')} />;
  if (link === null) {
    return (
      <SettingsSection
        title={t('Approvals')}
        description={t(
          'Changes to issued invoices and credit notes that wait for the owner (the Super Admin).',
        )}
      >
        <p className="text-sm text-slate-600">
          {t(
            'Approvals are for companies kept in the cloud, where a team works on them. Keep this company in the cloud first, in Settings → Team.',
          )}
        </p>
      </SettingsSection>
    );
  }
  if (!ready) {
    return (
      <SettingsSection title={t('Approvals')}>
        <p className="text-sm text-slate-600">
          {t(
            'The cloud needs the latest database script first. Ask the owner of the company to run it.',
          )}
        </p>
      </SettingsSection>
    );
  }

  const owner = isSuperAdmin(link.role);
  const rules = draft.approvalRules ?? null;
  const types = rules?.documentTypes ?? [];
  const set = (patch: Partial<ApprovalRules>) =>
    update({
      approvalRules: {
        // Turned on for the first time: issued documents are voided, never
        // deleted, and requests wait two weeks.
        voidInsteadOfDelete: true,
        expireDays: DEFAULT_EXPIRE_DAYS,
        ...rules,
        ...patch,
      },
    });
  const cover = (type: DocumentType, on: boolean) =>
    set({
      documentTypes: on
        ? [...types.filter((x) => x !== type), type]
        : types.filter((x) => x !== type),
    });

  return (
    <ReadOnlyContext.Provider
      value={{
        readOnly: !owner,
        reason: owner ? '' : t('Only the owner changes the approval rules.'),
      }}
    >
      <div className="space-y-6">
        <SettingsSection
          title={t('Approvals')}
          description={t(
            'Changes to issued invoices and credit notes that wait for the owner (the Super Admin).',
          )}
        >
          {!owner ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              {t('Only the owner changes the approval rules.')}
            </p>
          ) : null}
          <div className="space-y-5">
            {COVERED.map((c) => (
              <Switch
                key={c.type}
                checked={types.includes(c.type)}
                onChange={(on) => cover(c.type, on)}
                label={t(c.label)}
                description={t(c.description)}
                disabled={!owner}
              />
            ))}
            <Switch
              checked={rules?.voidInsteadOfDelete ?? false}
              onChange={(on) => set({ voidInsteadOfDelete: on })}
              label={t('Void instead of delete')}
              description={t(
                'Issued invoices and credit notes are voided, never deleted, so their numbers stay used and appear under Void invoices. Drafts can still be deleted.',
              )}
              disabled={!owner}
            />
            <Field
              label={t('Cancel requests still waiting after (days)')}
              hint={t('0 keeps them waiting until they are decided.')}
              className="max-w-xs"
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={rules?.expireDays ?? 0}
                  onValueChange={(v) => set({ expireDays: Math.max(0, Math.round(v)) })}
                  allowNegative={false}
                  disabled={!owner}
                />
              )}
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title={t('Who approves')}>
          <p className="text-sm text-slate-600">
            {t(
              'The owner approves. Up to two admins or accountants the owner allows (Permissions → Can approve, in Settings → Team) approve too, and their own changes need no request.',
            )}{' '}
            <Link to="/settings/team" className="text-primary-700 font-medium hover:underline">
              {t('Team')}
            </Link>
          </p>
          <p className="text-sm text-slate-600">
            {t(
              'Requests are in Approvals, in the Books sidebar, and on the home page. Payments, payment links and retention releases go on as before.',
            )}{' '}
            <Link to="/approvals" className="text-primary-700 font-medium hover:underline">
              {t('Approval requests')}
            </Link>
          </p>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {t(
              'Before turning approvals on, update every device and let it sync. A change an older version makes to an issued invoice is refused and kept aside in Settings → Cloud and sync, where it can be sent for approval.',
            )}
          </p>
        </SettingsSection>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </ReadOnlyContext.Provider>
  );
}
