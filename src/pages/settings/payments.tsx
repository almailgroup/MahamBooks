import { toast } from 'sonner';
import { LayoutTemplate } from 'lucide-react';
import type { Company, CompanyBankAccount, PaymentSettings } from '@/db/types';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { t } from '@/i18n';
import { ButtonLink } from '@/components/ui/button';
import { Field, Input, Switch } from '@/components/ui/form';
import { useRoleView } from '@/features/cloud/role-gates';
import { BankAccountFields, ibanProblem } from '@/features/company/bank-fields';
import { bankAccountOf, withBankAccount } from '@/features/company/bank';
import { printedBankDetails } from '@/pdf/model';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/** The company with cheque printing on or off; off leaves the setting out, as before. */
function withChequePrinting(company: Company, on: boolean): Company {
  const { chequePrinting: _old, ...rest } = company;
  return on ? { ...rest, chequePrinting: true } : rest;
}

export default function PaymentSettingsPage() {
  const { draft, setDraft, dirty, saving, save, reset } = useCompanyDraft();
  const { role, readOnly } = useRoleView();
  // Part of the company record: staff and viewers only look at it.
  const locked = readOnly.readOnly || role === 'staff';
  const p = draft.payment;
  const account = bankAccountOf(draft);
  const profile = kuwaitProfile(draft);
  const set = (patch: Partial<PaymentSettings>) =>
    setDraft((d) => ({ ...d, payment: { ...d.payment, ...patch } }));
  const setAccount = (patch: Partial<CompanyBankAccount>) =>
    setDraft((d) => withBankAccount(d, { ...bankAccountOf(d), ...patch }));
  const setWamd = (wamdPhone: string) =>
    setDraft((d) =>
      withBankAccount({ ...d, kuwait: { ...kuwaitProfile(d), wamdPhone } }, bankAccountOf(d)),
    );
  const linkInvalid =
    p.paymentLink.trim() !== '' && !/^https?:\/\/\S+$/i.test(p.paymentLink.trim());

  const onSave = () => {
    if (ibanProblem(account.iban)) {
      toast.error(t('Check the IBAN before saving.'));
      return;
    }
    void save();
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Bank account')}
        description={t('Printed on invoices while a balance is due, so customers know how to pay.')}
      >
        <BankAccountFields
          account={account}
          onChange={setAccount}
          wamdPhone={profile.wamdPhone}
          onWamdChange={setWamd}
          accountNamePlaceholder={draft.legalName || draft.name}
        />
        {p.bankDetails ? (
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200/70">
            <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('Printed on documents')}
            </p>
            <p dir="auto" className="text-sm whitespace-pre-line text-slate-700">
              {printedBankDetails(draft)}
            </p>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('Payment instructions')}>
        <Field label={t('Instructions')} optional>
          {(id) => (
            <Input
              id={id}
              value={p.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
              placeholder={t('Please use the invoice number as the payment reference.')}
              dir="auto"
            />
          )}
        </Field>
      </SettingsSection>

      <SettingsSection
        title={t('Online payment link')}
        description={t(
          'A link where customers can pay by KNET or card, e.g. from MyFatoorah, Tap or your bank.',
        )}
      >
        <Field
          label={t('Payment link')}
          optional
          error={linkInvalid ? t('Enter a full link starting with https://') : undefined}
        >
          {(id) => (
            <Input
              id={id}
              value={p.paymentLink}
              onChange={(e) => set({ paymentLink: e.target.value })}
              placeholder="https://"
              aria-invalid={linkInvalid}
              dir="ltr"
              inputMode="url"
              className="rtl:text-end"
            />
          )}
        </Field>
        <Switch
          checked={p.showQrCode}
          onChange={(showQrCode) => set({ showQrCode })}
          label={t('Print a QR code')}
          description={t('Customers can scan it with their phone to open the payment link.')}
        />
      </SettingsSection>

      <SettingsSection
        id="cheques"
        title={t('Cheque printing')}
        description={t(
          'Print cheques issued to vendors straight onto Burgan Bank and KFH cheque leaves. Every print is recorded on the cheque; nothing is posted.',
        )}
        actions={
          draft.chequePrinting ? (
            <ButtonLink variant="outline" size="sm" to="/cheques/layouts">
              <LayoutTemplate /> {t('Cheque layouts')}
            </ButtonLink>
          ) : null
        }
      >
        <Switch
          checked={Boolean(draft.chequePrinting)}
          disabled={locked}
          onChange={(on) => setDraft((d) => withChequePrinting(d, on))}
          label={t('Print cheques issued')}
          description={t(
            'Adds Print cheque to cheques issued, on the payment and in the cheque register. Check the layout with a test print on plain paper first.',
          )}
        />
        {locked ? (
          <p className="text-sm text-slate-500">
            {t('Owners, admins and accountants turn cheque printing on or off.')}
          </p>
        ) : null}
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
