import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { CompanyBankAccount } from '@/db/types';
import { bankFromIban, compactIban, formatIban, isValidIban, KUWAIT_BANKS } from '@/lib/kuwait';
import { currentLanguage, t } from '@/i18n';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PhoneField } from './fields';
import { bankName, kuwaitBank } from './bank';

const OTHER = 'other';

/** What is wrong with an IBAN, or null when it is fine (or still empty). */
export function ibanProblem(value: string): string | null {
  const iban = compactIban(value);
  if (!iban) return null;
  if (iban.startsWith('KW') && iban.length !== 30) {
    return t('A Kuwaiti IBAN has 30 characters. This one has {count}.', { count: iban.length });
  }
  if (!isValidIban(iban)) return t('This IBAN is not valid. Check it for a typing mistake.');
  return null;
}

/** IBAN input: grouped in fours when not being edited, checked as you type. */
function IbanInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      id={id}
      dir="ltr"
      value={text ?? formatIban(value)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(compactIban(e.target.value));
      }}
      onBlur={() => setText(null)}
      placeholder="KW81 CBKU 0000 0000 0000 1234 5601 01"
      autoComplete="off"
      spellCheck={false}
      aria-invalid={invalid}
      className="font-mono text-[13px] uppercase sm:text-sm rtl:text-end"
    />
  );
}

/**
 * The bank account printed on documents: a Kuwaiti bank (or another one),
 * account name, IBAN with live checking and WAMD mobile number.
 */
export function BankAccountFields({
  account,
  onChange,
  wamdPhone,
  onWamdChange,
  accountNamePlaceholder,
}: {
  account: CompanyBankAccount;
  onChange: (patch: Partial<CompanyBankAccount>) => void;
  wamdPhone: string;
  onWamdChange: (value: string) => void;
  accountNamePlaceholder?: string;
}) {
  const language = currentLanguage();
  const [other, setOther] = useState(!account.bankCode && account.bankName.trim() !== '');
  const problem = ibanProblem(account.iban);
  const detected = !problem && account.iban ? bankFromIban(account.iban) : undefined;
  const valid = !problem && account.iban.length > 0;
  const selected = account.bankCode || (other ? OTHER : '');

  const setIban = (iban: string) => {
    const bank = !ibanProblem(iban) ? bankFromIban(iban) : undefined;
    if (bank && bank.code !== account.bankCode) {
      setOther(false);
      onChange({ iban, bankCode: bank.code, bankName: '' });
    } else onChange({ iban });
  };

  const ibanHint = valid ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <CheckCircle2 className="size-3.5" aria-hidden />
      {detected ? t('Valid IBAN at {bank}', { bank: detected.name[language] }) : t('Valid IBAN')}
    </span>
  ) : (
    t('Kuwaiti IBANs start with KW and have 30 characters.')
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('Bank')}>
        {(id) => (
          <Select
            id={id}
            value={selected}
            onChange={(e) => {
              const value = e.target.value;
              setOther(value === OTHER);
              onChange({
                bankCode: value === OTHER ? '' : value,
                bankName: value === OTHER ? account.bankName : '',
              });
            }}
          >
            <option value="">{t('Select…')}</option>
            {KUWAIT_BANKS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name[language]}
              </option>
            ))}
            <option value={OTHER}>{t('Another bank')}</option>
          </Select>
        )}
      </Field>
      {other ? (
        <Field label={t('Bank name')}>
          {(id) => (
            <Input
              id={id}
              value={account.bankName}
              onChange={(e) => onChange({ bankName: e.target.value })}
            />
          )}
        </Field>
      ) : (
        <Field label={t('Account name')} optional>
          {(id) => (
            <Input
              id={id}
              value={account.accountName}
              onChange={(e) => onChange({ accountName: e.target.value })}
              placeholder={accountNamePlaceholder}
              dir="auto"
            />
          )}
        </Field>
      )}
      {other ? (
        <Field label={t('Account name')} optional className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={account.accountName}
              onChange={(e) => onChange({ accountName: e.target.value })}
              placeholder={accountNamePlaceholder}
              dir="auto"
            />
          )}
        </Field>
      ) : null}
      <Field
        label={t('IBAN')}
        className="sm:col-span-2"
        error={problem ?? undefined}
        hint={ibanHint}
      >
        {(id) => (
          <IbanInput id={id} value={account.iban} onChange={setIban} invalid={problem !== null} />
        )}
      </Field>
      <Field label={t('Account number')} optional>
        {(id) => (
          <Input
            id={id}
            value={account.accountNumber}
            onChange={(e) => onChange({ accountNumber: e.target.value })}
            dir="ltr"
            className="rtl:text-end"
          />
        )}
      </Field>
      <Field
        label={t('SWIFT code')}
        optional
        hint={
          kuwaitBank(account.bankCode) && !account.swift
            ? t('{code} is printed for {bank}.', {
                code: kuwaitBank(account.bankCode)!.swift,
                bank: bankName(account, language),
              })
            : undefined
        }
      >
        {(id) => (
          <Input
            id={id}
            value={account.swift}
            onChange={(e) => onChange({ swift: e.target.value.toUpperCase() })}
            dir="ltr"
            maxLength={11}
            className="font-mono uppercase rtl:text-end"
          />
        )}
      </Field>
      <PhoneField
        label={t('WAMD mobile number')}
        optional
        mobile
        value={wamdPhone}
        onChange={onWamdChange}
        hint={t('Customers can pay you instantly with WAMD using this number.')}
        className="sm:col-span-2"
      />
      <Field
        label={t('Other payment details')}
        optional
        className="sm:col-span-2"
        hint={t('Printed after the bank details, e.g. a second account.')}
      >
        {(id) => (
          <Textarea
            id={id}
            value={account.extra}
            onChange={(e) => onChange({ extra: e.target.value })}
            rows={2}
            dir="auto"
          />
        )}
      </Field>
    </div>
  );
}
