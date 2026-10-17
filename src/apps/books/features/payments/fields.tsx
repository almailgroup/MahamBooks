import { useState } from 'react';
import { AlertTriangle, Ban, Info } from 'lucide-react';
import type {
  Account,
  ChequeDetails,
  Company,
  ID,
  PaymentMethod,
  PaymentProvider,
} from '@/db/types';
import { roleMap } from '@/db/accounting';
import { accountingSettings } from '@/db/chart-setup';
import { useFormat } from '@/app/company';
import { currentLanguage, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { cn } from '@/lib/cn';
import { daysBetween } from '@/lib/dates';
import { isValidCivilId, KUWAIT_BANKS } from '@/lib/kuwait';
import { CASH_RULES, kuwaitProfile } from '@/lib/kuwait-rules';
import {
  cashAllowed,
  checkCash,
  defaultDestination,
  findPaymentAccount,
  kwdValue,
  offeredMethods,
  PAYMENT_ACCOUNTS,
  providersFor,
  type CashCheck,
  type PaymentDirection,
} from '@/lib/payment-methods';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { DateField } from '@/components/ui/date-field';

const byCode = (a: Account, b: Account) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

const accountLabel = (a: Account) => `${a.code} ${localName(a)}`;

/** Payment methods to choose from; cash is left out where the business may not take it. */
export function MethodSelect({
  id,
  value,
  onChange,
  direction,
  company,
  creditNotes = true,
}: {
  id?: string;
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  direction: PaymentDirection;
  company: Company;
  creditNotes?: boolean;
}) {
  const noCash = direction === 'in' && !cashAllowed(kuwaitProfile(company).activity);
  const methods = offeredMethods(direction, { current: value, creditNotes }).filter(
    (m) => !(noCash && m.cash && m.value !== value),
  );
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
      {methods.map((m) => (
        <option key={m.value} value={m.value}>
          {t(m.label)}
        </option>
      ))}
    </Select>
  );
}

/** Why cash is missing from the methods, for businesses that may not take it. */
export function noCashHint(company: Company, direction: PaymentDirection): string | undefined {
  const activity = kuwaitProfile(company).activity;
  if (direction !== 'in' || cashAllowed(activity)) return undefined;
  return t('Cash is not offered: {activity} businesses may not take cash (MOCI rules).', {
    activity: t(CASH_RULES[activity].label),
  });
}

export function ProviderSelect({
  id,
  method,
  value,
  onChange,
}: {
  id?: string;
  method: PaymentMethod;
  value: PaymentProvider | null | undefined;
  onChange: (provider: PaymentProvider | null) => void;
}) {
  return (
    <Select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as PaymentProvider | null)}
    >
      <option value="">{t('Not specified')}</option>
      {providersFor(method).map((p) => (
        <option key={p.value} value={p.value}>
          {t(p.label)}
        </option>
      ))}
    </Select>
  );
}

/**
 * Where the money went (or came from). Empty means the method's default:
 * the KNET clearing account for KNET, cards and links, cash for cash, the
 * bank otherwise.
 */
export function PaymentAccountSelect({
  id,
  value,
  onChange,
  accounts,
  company,
  direction,
  method,
}: {
  id?: string;
  value: ID | null | undefined;
  onChange: (accountId: ID | null) => void;
  accounts: Account[];
  company: Company;
  direction: PaymentDirection;
  method: PaymentMethod;
}) {
  const template = accountingSettings(company).template;
  const clearing = findPaymentAccount(accounts, 'clearing', template);
  const listed = accounts
    .filter(
      (a) =>
        a.id === value ||
        (!a.archived &&
          (a.type === 'asset_cash' ||
            (direction === 'out' && a.type === 'liability_credit_card') ||
            (direction === 'in' && a.id === clearing?.id))),
    )
    .sort(byCode);
  const roles = roleMap(accounts);
  const destination = defaultDestination(method, direction, false);
  const auto =
    destination === 'clearing'
      ? clearing
      : accounts.find(
          (a) => a.id === (destination === 'cash' ? (roles.cash ?? roles.bank) : roles.bank),
        );
  const spec = PAYMENT_ACCOUNTS.clearing;
  const autoLabel = auto
    ? accountLabel(auto)
    : destination === 'clearing'
      ? `${spec.code} ${currentLanguage() === 'ar' ? spec.nameAr : spec.name}`
      : t('Bank');
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{t('{account} (default)', { account: autoLabel })}</option>
      {listed.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </Select>
  );
}

/** A bank or cash account (for clearing cheques and paying charges). */
export function BankAccountSelect({
  id,
  value,
  onChange,
  accounts,
}: {
  id?: string;
  value: ID | null | undefined;
  onChange: (accountId: ID | null) => void;
  accounts: Account[];
}) {
  const bankId = roleMap(accounts).bank;
  const listed = accounts
    .filter((a) => a.type === 'asset_cash' && (!a.archived || a.id === value))
    .sort(byCode);
  return (
    <Select
      id={id}
      value={value ?? bankId ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {listed.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </Select>
  );
}

const OTHER_BANK = '__other';
const isKnownBank = (value: string) => KUWAIT_BANKS.some((b) => b.code === value);

/** A Kuwaiti bank from the list, or another bank's name typed in. */
export function BankSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (bank: string) => void;
}) {
  const [other, setOther] = useState(Boolean(value) && !isKnownBank(value));
  const language = currentLanguage();
  return (
    <div className="space-y-2">
      <Select
        id={id}
        value={other ? OTHER_BANK : value}
        onChange={(e) => {
          if (e.target.value === OTHER_BANK) {
            setOther(true);
            onChange('');
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{t('Choose a bank…')}</option>
        {KUWAIT_BANKS.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name[language]}
          </option>
        ))}
        <option value={OTHER_BANK}>{t('Another bank')}</option>
      </Select>
      {other ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('Bank name')}
          aria-label={t('Bank name')}
        />
      ) : null}
    </div>
  );
}

/** Number, bank, date and drawer of a cheque received or issued. */
export function ChequeFields({
  cheque,
  onChange,
  direction,
  paymentDate,
  disabled,
}: {
  cheque: ChequeDetails;
  onChange: (patch: Partial<ChequeDetails>) => void;
  direction: PaymentDirection;
  paymentDate: string;
  disabled?: boolean;
}) {
  const civilId = (cheque.drawerCivilId ?? '').replace(/\s/g, '');
  const civilError = civilId && !isValidCivilId(civilId);
  const days = cheque.date ? daysBetween(paymentDate, cheque.date) : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('Cheque number')}>
        {(fid) => (
          <Input
            id={fid}
            value={cheque.number}
            onChange={(e) => onChange({ number: e.target.value })}
            inputMode="numeric"
            dir="ltr"
            className="rtl:text-end"
            disabled={disabled}
          />
        )}
      </Field>
      <Field label={t('Bank')}>
        {(fid) => (
          <BankSelect id={fid} value={cheque.bank} onChange={(bank) => onChange({ bank })} />
        )}
      </Field>
      <Field
        label={t('Cheque date')}
        hint={
          days > 0
            ? tp(days, 'Post-dated by {count} day', 'Post-dated by {count} days')
            : t('The date written on the cheque.')
        }
      >
        {(fid) => (
          <DateField
            id={fid}
            value={cheque.date}
            onChange={(iso) => onChange({ date: iso })}
            disabled={disabled}
          />
        )}
      </Field>
      <Field label={direction === 'out' ? t('Pay to') : t('Drawer')}>
        {(fid) => (
          <Input
            id={fid}
            value={cheque.drawer}
            onChange={(e) => onChange({ drawer: e.target.value })}
            placeholder={
              direction === 'out' ? t('Name written on the cheque') : t('Who signed the cheque')
            }
          />
        )}
      </Field>
      {direction === 'in' ? (
        <Field
          label={t('Drawer’s Civil ID')}
          optional
          error={civilError ? t('Check the Civil ID number: it has 12 digits.') : undefined}
          hint={t('Kept in case the cheque is returned.')}
        >
          {(fid) => (
            <Input
              id={fid}
              value={cheque.drawerCivilId ?? ''}
              onChange={(e) => onChange({ drawerCivilId: e.target.value })}
              inputMode="numeric"
              dir="ltr"
              className="rtl:text-end"
              aria-invalid={civilError || undefined}
              maxLength={14}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

/** The cash rules for a payment being recorded, worked out from the company's activity. */
export function useCashCheck(
  company: Company,
  input: {
    method: PaymentMethod;
    direction: PaymentDirection;
    amount: number;
    currency: string;
    exchangeRate?: number;
  },
): CashCheck {
  const activity = kuwaitProfile(company).activity;
  return checkCash(
    activity,
    input.method,
    input.direction,
    kwdValue(input.amount, input.currency, company.currency, input.exchangeRate),
  );
}

/** Explains the cash rules and asks for confirmation when a payment breaks them. */
export function CashRuleNotice({
  company,
  check,
  confirmed,
  onConfirm,
  className,
}: {
  company: Company;
  check: CashCheck;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  className?: string;
}) {
  const fmt = useFormat();
  if (check.status === 'ok') return null;
  const activity = t(CASH_RULES[kuwaitProfile(company).activity].label);
  if (check.status === 'limited') {
    return (
      <p className={cn('flex gap-2 text-sm text-slate-600', className)}>
        <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
        {t('{activity} businesses may take up to {limit} in cash per payment.', {
          activity,
          limit: fmt.money(check.limit, 'KWD'),
        })}
      </p>
    );
  }
  const banned = check.status === 'banned';
  return (
    <div
      role="alert"
      className={cn(
        'space-y-3 rounded-lg border p-3 text-sm',
        banned
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900',
        className,
      )}
    >
      <p className="flex gap-2">
        {banned ? (
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>
          {banned
            ? t('{activity} businesses may not take cash (MOCI rules).', { activity })
            : t(
                '{activity} businesses may not take more than {limit} in cash in one payment (MOCI Decision 32/2026).',
                { activity, limit: fmt.money(check.limit, 'KWD') },
              )}{' '}
          {t(
            'Record it only if it is correct; keeping to the rules is the business’s responsibility.',
          )}
        </span>
      </p>
      <Checkbox
        checked={confirmed}
        onChange={(e) => onConfirm(e.target.checked)}
        label={t('I confirm this cash payment')}
      />
    </div>
  );
}
