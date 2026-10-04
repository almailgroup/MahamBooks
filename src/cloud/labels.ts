import { msg } from '@/i18n';
import type { DataTable } from '@/db/db';
import type { CloudErrorCode } from './api';

/** What a synced record is, in words (English keys). */
export const RECORD_LABELS: Record<DataTable, string> = {
  companies: msg('Company settings'),
  clients: msg('Contact'),
  products: msg('Item'),
  taxRates: msg('Tax rate'),
  documents: msg('Document'),
  payments: msg('Payment'),
  recurring: msg('Recurring invoice'),
  activities: msg('Activity entry'),
  accounts: msg('Account'),
  journals: msg('Journal'),
  expenses: msg('Expense'),
  attachments: msg('File'),
  vatReturns: msg('Tax return'),
  bankTransactions: msg('Bank statement line'),
  employees: msg('Employee'),
  complianceDocuments: msg('Document in the register'),
  renewals: msg('Renewal'),
  complianceMarks: msg('Compliance item'),
  peopleSettings: msg('People settings'),
  securityCheques: msg('Security cheque'),
  assets: msg('Fixed asset'),
  depreciationRuns: msg('Depreciation run'),
  yearEnds: msg('Year-end close'),
  payRuns: msg('Pay run'),
  payrollSettings: msg('Payroll settings'),
  leaveRecords: msg('Leave'),
  staffLoans: msg('Staff loan'),
  finalSettlements: msg('Final settlement'),
  warehouses: msg('Warehouse'),
  stockMovements: msg('Stock movement'),
  stockEntries: msg('Stock entry'),
  landedCosts: msg('Landed cost'),
};

/** Why a change was refused, for the list of sync problems. */
export const PARKED_REASONS: Partial<Record<CloudErrorCode, string>> = {
  permission: msg('Your role can’t make this change.'),
  too_large: msg('Too large to sync.'),
  invalid: msg('The cloud did not accept it.'),
};
