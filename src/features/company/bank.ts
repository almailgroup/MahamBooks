import type { Company, CompanyBankAccount } from '@/db/types';
import { compactIban, formatIban, KUWAIT_BANKS, type KuwaitBank } from '@/lib/kuwait';

export function emptyBankAccount(): CompanyBankAccount {
  return {
    bankCode: '',
    bankName: '',
    accountName: '',
    iban: '',
    accountNumber: '',
    swift: '',
    extra: '',
  };
}

/**
 * The company's bank account. Companies that typed their bank details as
 * free text before keep that text in `extra`, so nothing printed changes.
 */
export function bankAccountOf(
  company: Pick<Company, 'bankAccount' | 'payment'>,
): CompanyBankAccount {
  if (company.bankAccount) return { ...emptyBankAccount(), ...company.bankAccount };
  return { ...emptyBankAccount(), extra: company.payment.bankDetails };
}

export function kuwaitBank(code: string): KuwaitBank | undefined {
  return code ? KUWAIT_BANKS.find((b) => b.code === code) : undefined;
}

/** The bank's name in a language, or the name typed for another bank. */
export function bankName(account: CompanyBankAccount, language: 'en' | 'ar'): string {
  const bank = kuwaitBank(account.bankCode);
  return bank ? bank.name[language] : account.bankName.trim();
}

/**
 * The payment details printed on documents, built from the bank account and
 * the WAMD number: one fact per line, IBAN grouped in fours.
 */
export function composeBankDetails(account: CompanyBankAccount, wamdPhone = ''): string {
  const bank = kuwaitBank(account.bankCode);
  const lines: string[] = [];
  const name = bank ? `${bank.name.en} · ${bank.name.ar}` : account.bankName.trim();
  if (name) lines.push(name);
  if (account.accountName.trim()) lines.push(`Account name: ${account.accountName.trim()}`);
  const iban = compactIban(account.iban);
  if (iban) lines.push(`IBAN: ${formatIban(iban)}`);
  if (account.accountNumber.trim()) lines.push(`Account no.: ${account.accountNumber.trim()}`);
  const swift = account.swift.trim().toUpperCase() || (iban && bank ? bank.swift : '');
  if (swift) lines.push(`SWIFT: ${swift}`);
  if (wamdPhone.trim()) lines.push(`WAMD: ${wamdPhone.trim()}`);
  if (account.extra.trim()) lines.push(account.extra.trim());
  return lines.join('\n');
}

/** The company with a new bank account (or WAMD number) and the printed text to match. */
export function withBankAccount(
  company: Company,
  account: CompanyBankAccount,
  wamdPhone: string = company.kuwait?.wamdPhone ?? '',
): Company {
  const clean = { ...account, iban: compactIban(account.iban) };
  return {
    ...company,
    bankAccount: clean,
    payment: { ...company.payment, bankDetails: composeBankDetails(clean, wamdPhone) },
  };
}
