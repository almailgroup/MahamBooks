import { createCompany, createClient, createDocument, emptyTotals } from '@/db/defaults';
import { createEmployee } from '@/db/people';
import { createComplianceDocument } from '@/db/renewals';
import { createPayment, newCheque } from '@/db/payments';
import type { ComplianceMark, InvoiceDocument, Payment } from '@/db/types';
import type { AlertData } from './collect';

/**
 * A made-up company for the alerts tests, seen on 6 October 2026: papers
 * expiring and expired, a PIFSS payment due, cheques, bills and invoices,
 * each with a twin that must not be reported.
 */

export const TODAY = '2026-10-06';

export function sampleData(): AlertData {
  const company = createCompany({
    id: 'company-acme',
    name: 'Acme Trading',
    nameAr: 'أكمي للتجارة',
    createdAt: '2026-09-20T08:00:00.000Z',
  });
  const c = company.id;
  const employee = (id: string, name: string, nameAr: string, extra = {}) =>
    createEmployee(c, { id, name, nameAr, ...extra });
  const employees = [
    // Residency at its 30-day reminder (25 days left).
    employee('emp-ravi', 'Ravi Kumar', 'رافي كومار', {
      category: 'expat',
      nationality: 'IN',
      residencyNumber: 'R-1',
      residencyExpiry: '2026-10-31',
      civilId: '290010100001',
      civilIdExpiry: '2027-06-01',
    }),
    // Civil ID expired; Kuwaiti, so the company pays PIFSS.
    employee('emp-noura', 'Noura Salem', 'نورة سالم', {
      category: 'kuwaiti',
      civilId: '290010100002',
      civilIdExpiry: '2026-10-01',
    }),
    // Civil ID at the 7-day reminder.
    employee('emp-omar', 'Omar Ali', 'عمر علي', {
      civilId: '290010100003',
      civilIdExpiry: '2026-10-11',
    }),
    // Passport valid for 90 days: nothing yet.
    employee('emp-maria', 'Maria Cruz', 'ماريا كروز', {
      category: 'domestic',
      passportNumber: 'P-4',
      passportExpiry: '2027-01-04',
    }),
    // Has left: their papers are no longer followed.
    employee('emp-left', 'Former Person', 'موظف سابق', {
      status: 'left',
      leavingDate: '2026-08-31',
      civilId: '290010100005',
      civilIdExpiry: '2026-09-01',
    }),
  ];
  const complianceDocuments = [
    createComplianceDocument(c, {
      id: 'licence',
      type: 'commercial_licence',
      number: 'CL-77',
      expiryDate: '2026-12-01',
    }),
    createComplianceDocument(c, {
      id: 'old-licence',
      type: 'commercial_licence',
      expiryDate: '2026-09-01',
      archived: true,
    }),
  ];
  const complianceMarks: ComplianceMark[] = [];

  const clients = [
    createClient(c, { id: 'client-gulf', name: 'Gulf Hotel', nameAr: 'فندق الخليج' }),
    createClient(c, { id: 'vendor-paper', name: 'Paper Supplies', nameAr: 'مستلزمات الورق' }),
  ];
  const doc = (
    id: string,
    type: 'invoice' | 'bill',
    status: InvoiceDocument['status'],
    dueDate: string | null,
    balance: number,
    extra: Partial<InvoiceDocument> = {},
  ) =>
    createDocument(c, type, {
      id,
      number: id.toUpperCase(),
      status,
      clientId: type === 'invoice' ? 'client-gulf' : 'vendor-paper',
      issueDate: '2026-09-01',
      dueDate,
      totals: { ...emptyTotals(), total: balance, balance },
      ...extra,
    });
  const documents = [
    doc('inv-late', 'invoice', 'sent', '2026-09-30', 250),
    doc('inv-partial', 'invoice', 'partial', '2026-10-05', 120.5),
    doc('inv-today', 'invoice', 'sent', TODAY, 90),
    doc('inv-draft', 'invoice', 'draft', '2026-09-01', 40),
    doc('inv-paid', 'invoice', 'paid', '2026-09-01', 0),
    doc('bill-week', 'bill', 'sent', '2026-10-10', 75, { vendorReference: 'PS-881' }),
    doc('bill-late', 'bill', 'partial', '2026-10-01', 30),
    doc('bill-later', 'bill', 'sent', '2026-11-01', 60),
  ];

  const cheque = (
    id: string,
    direction: 'in' | 'out',
    date: string,
    status: 'held' | 'deposited' | 'cleared',
    extra: Partial<Payment> = {},
  ) =>
    createPayment(c, {
      id,
      direction,
      clientId: direction === 'in' ? 'client-gulf' : 'vendor-paper',
      method: 'cheque',
      amount: 500,
      date: '2026-09-15',
      cheque: newCheque({ number: id.toUpperCase(), bank: 'NBOK', date, status }),
      ...extra,
    });
  const payments = [
    cheque('chq-due', 'in', '2026-10-08', 'held'),
    cheque('chq-late', 'in', '2026-10-01', 'held'),
    cheque('chq-at-bank', 'in', '2026-10-07', 'deposited'),
    cheque('chq-later', 'in', '2026-10-20', 'held'),
    cheque('chq-out', 'out', TODAY, 'held'),
    cheque('chq-void', 'in', '2026-10-07', 'held', { voided: true }),
    cheque('chq-cleared', 'in', '2026-10-07', 'cleared'),
  ];

  return {
    company,
    employees,
    complianceDocuments,
    complianceMarks,
    peopleSettings: null,
    documents,
    payments,
    clients,
  };
}
