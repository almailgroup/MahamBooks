import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { ComplianceDocumentType, Employee, ID, PayLine } from '@/db/types';
import type { HiddenKind, KnownValue } from './scrub';

/**
 * This company's own values that are never sent to the AI assistant, as
 * this device holds them: the ID numbers and bank details of its employees
 * (and of the pay runs, which keep their own copies), the Civil IDs of its
 * customers and vendors, of whoever signed for a delivery and of the
 * drawers of cheques, the numbers of identity and other private papers in
 * the register, and its own IBANs and account numbers. What the
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

/**
 * Papers whose number is never sent, whoever owns them: identity papers,
 * and those that carry a person's details or pay (plan 3d, Compliance).
 */
const PRIVATE_PAPERS: ReadonlySet<ComplianceDocumentType> = new Set<ComplianceDocumentType>([
  'civil_id',
  'passport',
  'residency',
  'work_permit',
  'central_agency_card',
  'driving_licence',
  'health_insurance',
  'employment_contract',
  'authorised_signatories',
  'pam_salary_certificate',
  'customer_cost',
]);

export async function knownValues(companyId: ID): Promise<KnownValue[]> {
  const [employees, clients, company, accounts, runs, deliveries, payments, cheques, papers] =
    await Promise.all([
      db.employees.where('companyId').equals(companyId).toArray(),
      db.clients.where('companyId').equals(companyId).toArray(),
      db.companies.get(companyId),
      db.accounts.where('companyId').equals(companyId).toArray(),
      db.payRuns.where('companyId').equals(companyId).toArray(),
      // Only delivery notes say who signed for the goods.
      db.documents.where('[companyId+type]').equals([companyId, 'delivery_note']).toArray(),
      db.payments.where('companyId').equals(companyId).toArray(),
      db.securityCheques.where('companyId').equals(companyId).toArray(),
      db.complianceDocuments.where('companyId').equals(companyId).toArray(),
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
  for (const note of deliveries) add(note.receiverCivilId, 'id');
  for (const payment of payments) add(payment.cheque?.drawerCivilId, 'id');
  for (const cheque of cheques) add(cheque.drawerCivilId, 'id');
  for (const paper of papers) {
    if (PRIVATE_PAPERS.has(paper.type)) add(paper.number, 'id');
  }
  return found;
}

/** The values for the company, kept up to date; undefined until they are read. */
export function useKnownValues(companyId: ID): readonly KnownValue[] | undefined {
  return useLiveQuery(() => knownValues(companyId), [companyId]);
}
