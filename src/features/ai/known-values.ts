import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Employee, ID, PayLine } from '@/db/types';
import type { HiddenKind, KnownValue } from './scrub';

/**
 * This company's own values that are never sent to the AI assistant, as
 * this device holds them: the ID numbers and bank details of its employees
 * (and of the pay runs, which keep their own copies), the Civil IDs of its
 * customers and vendors, and its own IBANs and account numbers. What the
 * person types is checked against them (scrubText), with digits folded and
 * spaces left out, before anything is sent. They are read here and kept in
 * memory only while the chat is open; they never leave the device.
 */

const EMPLOYEE_FIELDS = [
  ['civilId', 'id'],
  ['passportNumber', 'id'],
  ['residencyNumber', 'id'],
  ['workPermitNumber', 'id'],
  ['centralCardNumber', 'id'],
  ['pifssNumber', 'id'],
  ['iban', 'iban'],
  ['accountNumber', 'account'],
] as const satisfies readonly (readonly [keyof Employee, HiddenKind])[];

const PAY_LINE_FIELDS = [
  ['civilId', 'id'],
  ['centralCardNumber', 'id'],
  ['iban', 'iban'],
  ['accountNumber', 'account'],
] as const satisfies readonly (readonly [keyof PayLine, HiddenKind])[];

export async function knownValues(companyId: ID): Promise<KnownValue[]> {
  const [employees, clients, company, accounts, runs] = await Promise.all([
    db.employees.where('companyId').equals(companyId).toArray(),
    db.clients.where('companyId').equals(companyId).toArray(),
    db.companies.get(companyId),
    db.accounts.where('companyId').equals(companyId).toArray(),
    db.payRuns.where('companyId').equals(companyId).toArray(),
  ]);
  const found: KnownValue[] = [];
  // Records from older versions or other devices may miss a field, or hold another type.
  const add = (value: unknown, kind: HiddenKind) => {
    if (typeof value === 'string' && value.trim() !== '') found.push({ value, kind });
  };
  for (const employee of employees) {
    for (const [field, kind] of EMPLOYEE_FIELDS) add(employee[field], kind);
  }
  // Customers and vendors alike (vendors are clients that sell to the company).
  for (const client of clients) add(client.civilId, 'id');
  add(company?.bankAccount?.iban, 'iban');
  add(company?.bankAccount?.accountNumber, 'account');
  for (const account of accounts) {
    add(account.bank?.iban, 'iban');
    add(account.bank?.accountNumber, 'account');
  }
  for (const run of runs) {
    for (const line of Array.isArray(run.lines) ? run.lines : []) {
      for (const [field, kind] of PAY_LINE_FIELDS) add(line?.[field], kind);
    }
  }
  return found;
}

/** The values for the company, kept up to date; undefined until they are read. */
export function useKnownValues(companyId: ID): readonly KnownValue[] | undefined {
  return useLiveQuery(() => knownValues(companyId), [companyId]);
}
