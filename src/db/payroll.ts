import { db } from './db';
import { logActivity } from './activity';
import { accountingSettings } from './chart-setup';
import {
  createAccount,
  createJournal,
  loadLedger,
  newJournalLine,
  roleMap,
  saveJournal,
} from './accounting';
import { nowStamp } from './defaults';
import { getPeopleSettings } from './people';
import type {
  Account,
  ChartTemplateId,
  Company,
  ContributionRates,
  Employee,
  FinalSettlement,
  GccScheme,
  ID,
  ISODate,
  LeaveRecord,
  LoanRecovery,
  ManualJournal,
  PayAdjustment,
  PayLine,
  PayRules,
  PayRun,
  PayrollAccountKey,
  PayrollSettings,
  PeopleSettings,
  ProvisionLine,
  SalaryFileColumn,
  StaffLoan,
  LeavingReason,
} from './types';
import { newId, shortId } from '@/lib/ids';
import { daysBetween, isISODate, today } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { currencyPrecision, fromMinor, round, toMinor } from '@/lib/money';
import { freeAccountCode, type SystemAccountSpec } from '@/lib/payment-methods';
import { GCC_COUNTRIES, insuredWithPifss, LEAVING_REASON_LABELS } from '@/lib/hr/employees';
import {
  balanced,
  calculatePayLine,
  computeSettlement,
  daysInPeriod,
  employedDays,
  eosProvisionFor,
  formatPeriod,
  isPeriod,
  lastMonthDays,
  leaveValue,
  noticeMonthsFor,
  payDateFor,
  payLineWarnings,
  payRunPostings,
  payRunTotals,
  PAYROLL_RULES,
  periodEnd,
  periodOf,
  periodStart,
  provisionPostings,
  ratesOn,
  settlementMissing,
  settlementPostings,
  type Posting,
  type SettlementAmounts,
} from '@/lib/hr/payroll';
import {
  countLeaveDays,
  employeeLeaveBalance,
  dayOffChecker,
  leaveInPeriod,
  MAX_LEAVE_SPAN,
  type DayOff,
  type LeaveBalance,
} from '@/lib/hr/leave';
import { currentLayout, presetLayout, SALARY_FILE_COLUMNS } from '@/lib/hr/salary-file';
import { companyHolidays } from '@/features/company/holidays';
import { interfaceLocale, msg, t } from '@/i18n';
import { localName } from '@/i18n/names';

export class PayrollError extends Error {}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

/** Accounts of the Kuwait chart the payroll posts to; created when a company lacks them. */
export const PAYROLL_ACCOUNTS: Record<PayrollAccountKey, SystemAccountSpec> = {
  salaries: {
    code: '6010',
    name: 'Salaries and wages',
    nameAr: 'الرواتب والأجور',
    type: 'expense',
  },
  allowances: { code: '6020', name: 'Allowances', nameAr: 'البدلات', type: 'expense' },
  pifssExpense: {
    code: '6030',
    name: 'PIFSS – employer share',
    nameAr: 'حصة صاحب العمل في التأمينات الاجتماعية',
    type: 'expense',
  },
  eosExpense: {
    code: '6040',
    name: 'End-of-service indemnity',
    nameAr: 'مكافأة نهاية الخدمة',
    type: 'expense',
  },
  leaveExpense: { code: '6050', name: 'Leave salary', nameAr: 'رواتب الإجازات', type: 'expense' },
  salariesPayable: {
    code: '2300',
    name: 'Salaries payable',
    nameAr: 'رواتب مستحقة',
    type: 'liability_current',
  },
  pifssPayable: {
    code: '2310',
    name: 'PIFSS payable',
    nameAr: 'التأمينات الاجتماعية المستحقة',
    type: 'liability_current',
  },
  leaveProvision: {
    code: '2320',
    name: 'Leave salary provision',
    nameAr: 'مخصص الإجازات',
    type: 'liability_current',
  },
  eosProvision: {
    code: '2700',
    name: 'End-of-service indemnity provision',
    nameAr: 'مخصص مكافأة نهاية الخدمة',
    type: 'liability_non_current',
  },
  advances: {
    code: '1320',
    name: 'Staff advances',
    nameAr: 'سلف الموظفين',
    type: 'asset_current',
  },
  otherDeductions: {
    code: '4500',
    name: 'Other income',
    nameAr: 'إيرادات أخرى',
    type: 'income_other',
  },
};

export const PAYROLL_ACCOUNT_LABELS: Record<PayrollAccountKey, string> = {
  salaries: msg('Salaries'),
  allowances: msg('Allowances and overtime'),
  pifssExpense: msg('PIFSS – employer share'),
  eosExpense: msg('End-of-service indemnity'),
  leaveExpense: msg('Leave salary'),
  salariesPayable: msg('Salaries payable'),
  pifssPayable: msg('PIFSS payable'),
  leaveProvision: msg('Leave salary provision'),
  eosProvision: msg('End-of-service indemnity provision'),
  advances: msg('Staff loans and advances'),
  otherDeductions: msg('Other deductions'),
};

/**
 * Finds a payroll account. In the Kuwait chart the code decides (the account
 * may have been renamed); other charts use the same codes for other things,
 * so there the name must match too.
 */
export function findSystemAccount(
  accounts: Account[],
  spec: SystemAccountSpec,
  template: ChartTemplateId,
): Account | undefined {
  const named = (a: Account) =>
    a.name.trim().toLowerCase() === spec.name.toLowerCase() || a.nameAr?.trim() === spec.nameAr;
  const usable = accounts.filter((a) => !a.archived && a.type === spec.type);
  return (
    usable.find((a) => a.code === spec.code && (template === 'kw' || named(a))) ??
    usable.find(named)
  );
}

/** The account a payroll posting goes to: the one chosen in the settings, else the one found by code. */
export function payrollAccount(
  accounts: Account[],
  settings: Pick<PayrollSettings, 'accounts'>,
  key: PayrollAccountKey,
  template: ChartTemplateId,
): Account | undefined {
  const chosen = settings.accounts[key];
  const account = chosen ? accounts.find((a) => a.id === chosen && !a.archived) : undefined;
  return account ?? findSystemAccount(accounts, PAYROLL_ACCOUNTS[key], template);
}

async function ensureAccounts(
  company: Company,
  settings: PayrollSettings,
  keys: PayrollAccountKey[],
  overrides: Partial<Record<PayrollAccountKey, ID | null>> = {},
): Promise<Record<PayrollAccountKey, ID>> {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const template = accountingSettings(company).template;
  const out = {} as Record<PayrollAccountKey, ID>;
  for (const key of keys) {
    const wanted = overrides[key];
    const chosen = wanted ? accounts.find((a) => a.id === wanted && !a.archived) : undefined;
    let account = chosen ?? payrollAccount(accounts, settings, key, template);
    if (!account) {
      const spec = PAYROLL_ACCOUNTS[key];
      account = createAccount(company.id, {
        code: freeAccountCode(accounts, spec.code),
        name: spec.name,
        nameAr: spec.nameAr,
        type: spec.type,
      });
      await db.accounts.add(account);
      accounts.push(account);
      await logActivity(company.id, 'account', account.id, 'created', {
        text: msg('Account {code} {name} created'),
        vars: { code: account.code, name: account.name },
        arabic: { name: account.nameAr },
      });
    }
    out[key] = account.id;
  }
  return out;
}

/** The bank or cash account money is paid from: the one chosen, else the main bank account. */
async function moneyAccount(company: Company, ...ids: (ID | null | undefined)[]): Promise<Account> {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const wanted = ids.find(Boolean);
  const chosen = wanted ? accounts.find((a) => a.id === wanted) : undefined;
  const account = chosen ?? accounts.find((a) => a.id === roleMap(accounts).bank);
  if (!account || account.type !== 'asset_cash' || account.archived) {
    throw new PayrollError(t('Choose the bank account the money is paid from.'));
  }
  return account;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/** Pay day of companies that have not chosen one: the last day of the month. */
export const LAST_DAY = 31;

export function defaultPayrollSettings(companyId: ID): PayrollSettings {
  return {
    id: companyId,
    companyId,
    dailyDivisor: PAYROLL_RULES.dailyDivisor,
    rateBase: 'wage',
    pifss: [{ ...PAYROLL_RULES.pifss }],
    gcc: [],
    minimumWage: PAYROLL_RULES.minimumWage,
    payDay: LAST_DAY,
    bankAccountId: null,
    accounts: {},
    provisions: true,
    eosForInsured: false,
    pamFileNumber: '',
    salaryFile: presetLayout('wps'),
    updatedAt: nowStamp(),
  };
}

/** A company's payroll settings, with defaults for anything not set. */
export async function getPayrollSettings(companyId: ID): Promise<PayrollSettings> {
  const saved = await db.payrollSettings.get(companyId);
  const settings = { ...defaultPayrollSettings(companyId), ...saved };
  return { ...settings, salaryFile: currentLayout(settings.salaryFile) };
}

const percent = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, round(n, 3))) : 0);
const capOf = (n: number | null) =>
  n === null || !Number.isFinite(n) || n <= 0 ? null : round(n, 3);

export function normalizePayrollSettings(input: PayrollSettings): PayrollSettings {
  const whole = (n: number, min: number, max: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  const byDate = new Map<string, ContributionRates>();
  for (const r of input.pifss) {
    if (!isISODate(r.from)) continue;
    byDate.set(r.from, {
      from: r.from,
      employer: percent(r.employer),
      employee: percent(r.employee),
      cap: capOf(r.cap),
    });
  }
  const byCountry = new Map<string, GccScheme>();
  for (const s of input.gcc) {
    const country = s.country.toUpperCase();
    if (!GCC_COUNTRIES.includes(country)) continue;
    byCountry.set(country, {
      country,
      employer: percent(s.employer),
      employee: percent(s.employee),
      cap: capOf(s.cap),
    });
  }
  const columns = input.salaryFile.columns.filter(
    (c, i, all): c is SalaryFileColumn => c in SALARY_FILE_COLUMNS && all.indexOf(c) === i,
  );
  return {
    ...input,
    id: input.companyId,
    dailyDivisor: whole(input.dailyDivisor, 1, 31, PAYROLL_RULES.dailyDivisor),
    rateBase: input.rateBase === 'basic' ? 'basic' : 'wage',
    pifss: [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from)),
    gcc: [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country)),
    minimumWage: Number.isFinite(input.minimumWage) ? Math.max(0, round(input.minimumWage, 3)) : 0,
    payDay: whole(input.payDay, 1, LAST_DAY, LAST_DAY),
    accounts: Object.fromEntries(
      Object.entries(input.accounts).filter(([key, id]) => key in PAYROLL_ACCOUNTS && id),
    ),
    pamFileNumber: input.pamFileNumber.trim(),
    salaryFile: { ...input.salaryFile, columns: columns.length ? columns : ['iban', 'amount'] },
  };
}

export async function savePayrollSettings(input: PayrollSettings): Promise<PayrollSettings> {
  const settings = { ...normalizePayrollSettings(input), updatedAt: nowStamp() };
  await db.transaction('rw', [db.payrollSettings, db.activities], async () => {
    await db.payrollSettings.put(settings);
    await logActivity(settings.companyId, 'payroll', settings.id, 'settings', {
      text: msg('Payroll settings updated'),
    });
  });
  return settings;
}

/** The rules a run for the month is worked out with. */
export function payRulesFor(settings: PayrollSettings, period: string): PayRules {
  return {
    dailyDivisor: settings.dailyDivisor,
    rateBase: settings.rateBase,
    pifss: ratesOn(settings.pifss, periodStart(period)),
    gcc: settings.gcc.map((s) => ({ ...s })),
    minimumWage: settings.minimumWage,
  };
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

const TABLES = () => [
  db.companies,
  db.accounts,
  db.journals,
  db.activities,
  db.documents,
  db.payments,
  db.expenses,
  db.products,
  db.clients,
  db.employees,
  db.peopleSettings,
  db.payRuns,
  db.payrollSettings,
  db.leaveRecords,
  db.staffLoans,
  db.finalSettlements,
];

/** Public holidays as the company observes them, with the Kuwaiti weekend. */
export function companyDayOff(company: Pick<Company, 'holidays'>): DayOff {
  return dayOffChecker((year) => companyHolidays(company, year).map((h) => h.date));
}

async function loadCompany(companyId: ID): Promise<Company> {
  const company = await db.companies.get(companyId);
  if (!company) throw new PayrollError(t('Company not found.'));
  return company;
}

/** Throws a translated error when a date falls in the locked period. */
function assertOpen(company: Company, ...dates: (ISODate | null | undefined)[]): void {
  const lock = accountingSettings(company).lockDate;
  if (!lock || !dates.some((d) => d && d <= lock)) return;
  throw new PayrollError(
    t(
      'The books are locked up to {date}. Change the lock date in Settings → Accounting to post on an earlier date.',
      { date: formatDate(lock, company.dateFormat, interfaceLocale(company.locale)) },
    ),
  );
}

async function postEntry(
  company: Company,
  accounts: Partial<Record<PayrollAccountKey, ID>>,
  list: Posting[],
  meta: { date: ISODate; sourceId: ID; reference: string },
): Promise<ManualJournal | null> {
  if (list.length === 0) return null;
  if (!balanced(list)) throw new PayrollError(t('Debits and credits must be equal.'));
  const p = currencyPrecision(company.currency);
  return saveJournal(
    createJournal(company.id, {
      ...meta,
      kind: 'payroll',
      status: 'posted',
      lines: list.map((x) =>
        newJournalLine({
          accountId: accounts[x.key] ?? '',
          debit: x.amount > 0 ? fromMinor(x.amount, p) : 0,
          credit: x.amount < 0 ? fromMinor(-x.amount, p) : 0,
          description: t(x.description),
        }),
      ),
    }),
    { system: true },
  );
}

/** Posts money paid from the bank against a liability (salaries payable). */
async function postPayment(
  company: Company,
  input: {
    debit: ID;
    bank: ID;
    amount: number;
    date: ISODate;
    sourceId: ID;
    reference: string;
  },
): Promise<ManualJournal> {
  return saveJournal(
    createJournal(company.id, {
      date: input.date,
      kind: 'payroll',
      sourceId: input.sourceId,
      reference: input.reference,
      status: 'posted',
      lines: [
        newJournalLine({
          accountId: input.debit,
          debit: input.amount,
          description: input.reference,
        }),
        newJournalLine({
          accountId: input.bank,
          credit: input.amount,
          description: input.reference,
        }),
      ],
    }),
    { system: true },
  );
}

/** Undoes a payroll entry with an opposite one on the same date. */
async function reverseEntry(journalId: ID | null): Promise<ID | null> {
  if (!journalId) return null;
  const original = await db.journals.get(journalId);
  if (!original) return null;
  const journal = await saveJournal(
    createJournal(original.companyId, {
      date: original.date,
      kind: 'payroll',
      sourceId: original.sourceId ?? null,
      reversalOf: original.id,
      reference: t('Reversal of {number}', { number: original.number }),
      status: 'posted',
      lines: original.lines.map((l) =>
        newJournalLine({
          accountId: l.accountId,
          description: l.description,
          debit: l.credit,
          credit: l.debit,
          contactId: l.contactId,
        }),
      ),
    }),
    { system: true },
  );
  return journal.id;
}

/* -------------------------------------------------------------------------- */
/* Staff loans                                                                */
/* -------------------------------------------------------------------------- */

const recoveriesOf = (loanId: ID, list: LoanRecovery[]) =>
  list.filter((r) => r.loanId === loanId).map((r) => r.amount);

/** Amount of a loan recovered by approved pay runs and posted settlements, in minor units. */
export function loanRecoveredMinor(
  loanId: ID,
  runs: PayRun[],
  settlements: FinalSettlement[],
  precision: number,
  exceptRunId?: ID,
): number {
  const fromRuns = runs
    .filter((r) => r.status !== 'draft' && r.id !== exceptRunId)
    .flatMap((r) => r.lines.flatMap((l) => recoveriesOf(loanId, l.loans)));
  const fromSettlements = settlements
    .filter((s) => s.status !== 'reversed')
    .flatMap((s) => recoveriesOf(loanId, s.loans));
  return [...fromRuns, ...fromSettlements].reduce((s, a) => s + toMinor(a, precision), 0);
}

/** What the employee still owes on a loan. */
export function loanBalance(
  loan: StaffLoan,
  runs: PayRun[],
  settlements: FinalSettlement[],
  precision: number,
  exceptRunId?: ID,
): number {
  if (loan.status !== 'active') return 0;
  const owed =
    toMinor(loan.amount, precision) -
    loanRecoveredMinor(loan.id, runs, settlements, precision, exceptRunId);
  return fromMinor(Math.max(0, owed), precision);
}

export function createStaffLoan(
  companyId: ID,
  employeeId: ID,
  overrides: Partial<StaffLoan> = {},
): StaffLoan {
  const stamp = nowStamp();
  const date = overrides.date ?? today();
  return {
    id: newId(),
    companyId,
    employeeId,
    date,
    amount: 0,
    instalment: 0,
    firstPeriod: periodOf(date),
    paidFromAccountId: null,
    journalId: null,
    status: 'active',
    cancelJournalId: null,
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/**
 * Records a loan or salary advance: Dr 1320 staff advances, Cr bank on the
 * day it was paid. Loans are interest-free (art. 59). Once recorded, only the
 * instalment, the first month and the notes can change.
 */
export async function saveStaffLoan(input: StaffLoan): Promise<StaffLoan> {
  return db.transaction('rw', TABLES(), async () => {
    const company = await loadCompany(input.companyId);
    const p = currencyPrecision(company.currency);
    const employee = await db.employees.get(input.employeeId);
    if (!employee || employee.companyId !== company.id) {
      throw new PayrollError(t('This employee could not be found.'));
    }
    const existing = await db.staffLoans.get(input.id);
    const amount = round(existing ? existing.amount : input.amount, p);
    const instalment = round(input.instalment, p);
    if (!existing && !(amount > 0)) throw new PayrollError(t('Enter the amount of the loan.'));
    if (!(instalment > 0)) throw new PayrollError(t('Enter the monthly instalment.'));
    if (instalment > amount) {
      throw new PayrollError(t('The instalment can’t be more than the loan.'));
    }
    if (!isPeriod(input.firstPeriod)) {
      throw new PayrollError(t('Choose the first month of repayment.'));
    }
    if (existing) {
      if (existing.status !== 'active') throw new PayrollError(t('This loan was cancelled.'));
      const loan: StaffLoan = {
        ...existing,
        instalment,
        firstPeriod: input.firstPeriod,
        notes: input.notes.trim(),
        updatedAt: nowStamp(),
      };
      await db.staffLoans.put(loan);
      return loan;
    }
    if (!isISODate(input.date)) throw new PayrollError(t('Enter the date the loan was paid.'));
    assertOpen(company, input.date);
    const settings = await getPayrollSettings(company.id);
    const bank = await moneyAccount(company, input.paidFromAccountId, settings.bankAccountId);
    const accounts = await ensureAccounts(company, settings, ['advances']);
    const loan: StaffLoan = {
      ...input,
      amount,
      instalment,
      notes: input.notes.trim(),
      paidFromAccountId: bank.id,
      status: 'active',
      cancelJournalId: null,
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
    };
    const reference = t('Loan to {name}', { name: employee.name });
    const journal = await postPayment(company, {
      debit: accounts.advances,
      bank: bank.id,
      amount,
      date: loan.date,
      sourceId: loan.id,
      reference,
    });
    loan.journalId = journal.id;
    await db.staffLoans.add(loan);
    await logActivity(company.id, 'payroll', loan.id, 'loan', {
      text: msg('Loan to {name} recorded'),
      vars: { name: employee.name },
      arabic: { name: employee.nameAr },
    });
    return loan;
  });
}

/** Cancels a loan nothing was recovered on yet, reversing its payment. */
export async function cancelStaffLoan(id: ID): Promise<StaffLoan> {
  return db.transaction('rw', TABLES(), async () => {
    const loan = await db.staffLoans.get(id);
    if (!loan || loan.status !== 'active') throw new PayrollError(t('This loan was cancelled.'));
    const company = await loadCompany(loan.companyId);
    const p = currencyPrecision(company.currency);
    const [runs, settlements] = await Promise.all([
      db.payRuns.where('companyId').equals(company.id).toArray(),
      db.finalSettlements.where('companyId').equals(company.id).toArray(),
    ]);
    if (loanRecoveredMinor(loan.id, runs, settlements, p) > 0) {
      throw new PayrollError(t('Part of this loan was recovered, so it can’t be cancelled.'));
    }
    assertOpen(company, loan.date);
    const cancelJournalId = await reverseEntry(loan.journalId);
    const next: StaffLoan = {
      ...loan,
      status: 'cancelled',
      cancelJournalId,
      updatedAt: nowStamp(),
    };
    await db.staffLoans.put(next);
    const employee = await db.employees.get(loan.employeeId);
    await logActivity(company.id, 'payroll', loan.id, 'loan_cancelled', {
      text: msg('Loan to {name} cancelled'),
      vars: { name: employee?.name ?? '' },
      arabic: { name: employee?.nameAr },
    });
    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* Leave                                                                      */
/* -------------------------------------------------------------------------- */

export function createLeaveRecord(
  companyId: ID,
  employeeId: ID,
  overrides: Partial<LeaveRecord> = {},
): LeaveRecord {
  const stamp = nowStamp();
  const start = overrides.start ?? today();
  return {
    id: newId(),
    companyId,
    employeeId,
    type: 'annual',
    kind: 'leave',
    start,
    end: start,
    days: 0,
    status: 'approved',
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/**
 * Refuses a change to an employee's leave that would change their pay in a
 * pay run already approved or paid: that pay is in the books (and maybe in
 * the bank), so the run is reopened first and updated after.
 */
async function assertPayUnchanged(
  company: Company,
  employee: Employee,
  before: LeaveRecord[],
  after: LeaveRecord[],
): Promise<void> {
  const runs = (await db.payRuns.where('companyId').equals(company.id).toArray())
    .filter((r) => r.status !== 'draft')
    .sort((a, b) => a.period.localeCompare(b.period));
  const dayOff = companyDayOff(company);
  for (const run of runs) {
    const line = run.lines.find((l) => l.employeeId === employee.id);
    if (!line) continue;
    const employed = { from: line.hireDate, to: line.leavingDate };
    const was = leaveInPeriod(before, run.period, dayOff, employed);
    const now = leaveInPeriod(after, run.period, dayOff, employed);
    if (
      was.unpaidDays === now.unpaidDays &&
      JSON.stringify(was.reducedPay) === JSON.stringify(now.reducedPay)
    ) {
      continue;
    }
    const vars = {
      name: employee.name,
      month: formatPeriod(run.period, interfaceLocale(company.locale)),
    };
    throw new PayrollError(
      run.status === 'paid'
        ? t(
            'This leave changes the pay of {name} in the {month} pay run, which is already paid. Undo its payment and reopen it first, then update it after the leave.',
            vars,
          )
        : t(
            'This leave changes the pay of {name} in the {month} pay run, which is already approved. Reopen the pay run first, then update it after the leave.',
            vars,
          ),
    );
  }
}

/**
 * Records leave (its days counted from the dates, skipping weekends and the
 * company's public holidays where the type counts working days) or a change
 * to the annual leave balance. Leave that changes pay in an approved or paid
 * pay run is refused until the run is reopened.
 */
export async function saveLeaveRecord(input: LeaveRecord): Promise<LeaveRecord> {
  return db.transaction(
    'rw',
    [db.companies, db.employees, db.leaveRecords, db.activities, db.payRuns],
    async () => {
      const company = await loadCompany(input.companyId);
      const employee = await db.employees.get(input.employeeId);
      if (!employee || employee.companyId !== company.id) {
        throw new PayrollError(t('This employee could not be found.'));
      }
      if (!isISODate(input.start)) throw new PayrollError(t('Enter the first day.'));
      const existing = await db.leaveRecords.get(input.id);
      let record: LeaveRecord;
      if (input.kind === 'leave') {
        if (!isISODate(input.end) || input.end < input.start) {
          throw new PayrollError(t('The last day can’t be before the first day.'));
        }
        if (daysBetween(input.start, input.end) + 1 > MAX_LEAVE_SPAN) {
          throw new PayrollError(t('Leave can’t be longer than a year.'));
        }
        const days = countLeaveDays(input.type, input.start, input.end, companyDayOff(company));
        if (days === 0) {
          throw new PayrollError(t('These dates are all weekends or public holidays.'));
        }
        record = { ...input, days };
      } else {
        const days = Math.round(input.days * 100) / 100;
        if (!Number.isFinite(days) || (input.kind === 'opening' ? days < 0 : days === 0)) {
          throw new PayrollError(t('Enter the number of days.'));
        }
        record = { ...input, type: 'annual', end: input.start, days };
      }
      record = { ...record, notes: record.notes.trim(), updatedAt: nowStamp() };
      if (!existing) record.createdAt = record.updatedAt;
      const before = await db.leaveRecords.where('employeeId').equals(employee.id).toArray();
      await assertPayUnchanged(company, employee, before, [
        ...before.filter((r) => r.id !== record.id),
        record,
      ]);
      await db.leaveRecords.put(record);
      await logActivity(company.id, 'payroll', record.id, existing ? 'leave_updated' : 'leave', {
        text: existing ? msg('Leave of {name} updated') : msg('Leave recorded for {name}'),
        vars: { name: employee.name },
        arabic: { name: employee.nameAr },
      });
      return record;
    },
  );
}

/** Cancels leave; refused when that would change pay in an approved or paid pay run. */
export async function cancelLeaveRecord(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.companies, db.employees, db.leaveRecords, db.activities, db.payRuns],
    async () => {
      const record = await db.leaveRecords.get(id);
      if (!record || record.status === 'cancelled') return;
      const employee = await db.employees.get(record.employeeId);
      const company = await db.companies.get(record.companyId);
      const cancelled: LeaveRecord = { ...record, status: 'cancelled', updatedAt: nowStamp() };
      if (employee && company) {
        const before = await db.leaveRecords.where('employeeId').equals(employee.id).toArray();
        await assertPayUnchanged(
          company,
          employee,
          before,
          before.map((r) => (r.id === id ? cancelled : r)),
        );
      }
      await db.leaveRecords.put(cancelled);
      await logActivity(record.companyId, 'payroll', id, 'leave_cancelled', {
        text: msg('Leave of {name} cancelled'),
        vars: { name: employee?.name ?? '' },
        arabic: { name: employee?.nameAr },
      });
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Pay runs                                                                   */
/* -------------------------------------------------------------------------- */

interface Context {
  company: Company;
  precision: number;
  settings: PayrollSettings;
  people: PeopleSettings;
  employees: Employee[];
  leave: LeaveRecord[];
  loans: StaffLoan[];
  runs: PayRun[];
  settlements: FinalSettlement[];
  dayOff: DayOff;
}

async function loadContext(companyId: ID): Promise<Context> {
  const company = await loadCompany(companyId);
  const [settings, people, employees, leave, loans, runs, settlements] = await Promise.all([
    getPayrollSettings(companyId),
    getPeopleSettings(companyId),
    db.employees.where('companyId').equals(companyId).toArray(),
    db.leaveRecords.where('companyId').equals(companyId).toArray(),
    db.staffLoans.where('companyId').equals(companyId).toArray(),
    db.payRuns.where('companyId').equals(companyId).toArray(),
    db.finalSettlements.where('companyId').equals(companyId).toArray(),
  ]);
  return {
    company,
    precision: currencyPrecision(company.currency),
    settings,
    people,
    employees,
    leave,
    loans,
    runs,
    settlements,
    dayOff: companyDayOff(company),
  };
}

const liveSettlement = (s: FinalSettlement) => s.status !== 'reversed';

/**
 * Whether an employee is paid in a month: hired by its end, not gone before
 * its start, and not paid their last salary with a final settlement.
 */
export function onPayroll(
  employee: Employee,
  period: string,
  settlements: FinalSettlement[],
): boolean {
  if (employee.hireDate && employee.hireDate > periodEnd(period)) return false;
  if (
    employee.status === 'left' &&
    (!employee.leavingDate || employee.leavingDate < periodStart(period))
  ) {
    return false;
  }
  return !settlements.some(
    (s) => s.employeeId === employee.id && liveSettlement(s) && s.lastSalary?.period === period,
  );
}

function sortLines(lines: PayLine[]): PayLine[] {
  return [...lines].sort(
    (a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
}

/** Instalments due in the month on the employee's active loans (what is left, at most). */
function loanRecoveries(
  employeeId: ID,
  period: string,
  ctx: Context,
  runId: ID,
  previous: LoanRecovery[] | undefined,
): LoanRecovery[] {
  const out: LoanRecovery[] = [];
  for (const loan of ctx.loans) {
    if (loan.employeeId !== employeeId || loan.status !== 'active' || loan.firstPeriod > period) {
      continue;
    }
    const left = loanBalance(loan, ctx.runs, ctx.settlements, ctx.precision, runId);
    if (left <= 0) continue;
    const before = previous?.find((r) => r.loanId === loan.id);
    const amount = Math.min(before ? before.amount : loan.instalment, left);
    if (before || amount > 0) out.push({ loanId: loan.id, amount: round(amount, ctx.precision) });
  }
  return out;
}

function buildLine(employee: Employee, run: PayRun, ctx: Context, previous?: PayLine): PayLine {
  const leavingDate = employee.status === 'left' ? employee.leavingDate : null;
  const leave = leaveInPeriod(
    ctx.leave.filter((r) => r.employeeId === employee.id),
    run.period,
    ctx.dayOff,
    { from: employee.hireDate, to: leavingDate },
  );
  const line: PayLine = {
    id: previous?.id ?? newId(),
    employeeId: employee.id,
    number: employee.number,
    name: employee.name,
    nameAr: employee.nameAr ?? '',
    jobTitle: employee.jobTitle,
    jobTitleAr: employee.jobTitleAr ?? '',
    category: employee.category,
    nationality: employee.nationality,
    civilId: employee.civilId,
    iban: employee.iban,
    accountNumber: employee.accountNumber ?? '',
    hireDate: employee.hireDate,
    leavingDate,
    permitSalary: employee.permitSalary,
    monthlyBasic: employee.basicSalary,
    allowances: employee.allowances.map((a) => ({
      id: a.id,
      name: a.name,
      nameAr: a.nameAr ?? '',
      monthly: a.amount,
      amount: 0,
    })),
    daysWorked: employedDays(run.period, employee.hireDate, leavingDate),
    daysInMonth: daysInPeriod(run.period),
    overtime: previous?.overtime ?? { normal: 0, restDay: 0, holiday: 0 },
    absentDays: previous?.absentDays ?? 0,
    unpaidLeaveDays: leave.unpaidDays,
    reducedPay: leave.reducedPay,
    leaveBasis: 'calendar',
    adjustments: previous?.adjustments ?? [],
    loans: loanRecoveries(employee.id, run.period, ctx, run.id, previous?.loans),
    basic: 0,
    allowanceTotal: 0,
    overtimePay: 0,
    absenceDeduction: 0,
    additions: 0,
    gross: 0,
    pifssBase: 0,
    pifssEmployee: 0,
    pifssEmployer: 0,
    loanDeduction: 0,
    otherDeductions: 0,
    net: 0,
  };
  return calculatePayLine(line, run.rules, ctx.precision);
}

/** Employees on the payroll in the month, as lines (keeping what was entered on `previous`). */
function linesFor(run: PayRun, ctx: Context, previous: PayLine[] = []): PayLine[] {
  const before = new Map(previous.map((l) => [l.employeeId, l]));
  return sortLines(
    ctx.employees
      .filter((e) => onPayroll(e, run.period, ctx.settlements))
      .map((e) => buildLine(e, run, ctx, before.get(e.id))),
  );
}

/** Starts the pay run of a month with every employee on the payroll. */
export async function createPayRun(companyId: ID, period: string): Promise<PayRun> {
  if (!isPeriod(period)) throw new PayrollError(t('Choose a month.'));
  return db.transaction('rw', TABLES(), async () => {
    const ctx = await loadContext(companyId);
    if (ctx.runs.some((r) => r.period === period)) {
      throw new PayrollError(t('There is already a pay run for this month.'));
    }
    const stamp = nowStamp();
    const run: PayRun = {
      id: newId(),
      companyId,
      period,
      status: 'draft',
      date: periodEnd(period),
      payDate: payDateFor(period, ctx.settings.payDay),
      lines: [],
      rules: payRulesFor(ctx.settings, period),
      deductionAccountId: null,
      journalId: null,
      provisionJournalId: null,
      provisions: null,
      paidOn: null,
      paymentJournalId: null,
      bankAccountId: null,
      reversalJournalIds: [],
      notes: '',
      createdAt: stamp,
      updatedAt: stamp,
    };
    run.lines = linesFor(run, ctx);
    if (run.lines.length === 0) {
      throw new PayrollError(t('No employees were on the payroll in this month.'));
    }
    await db.payRuns.add(run);
    await logActivity(companyId, 'payroll', run.id, 'created', {
      text: msg('Pay run {period} prepared'),
      vars: { period },
    });
    return run;
  });
}

async function loadRun(id: ID): Promise<PayRun> {
  const run = await db.payRuns.get(id);
  if (!run) throw new PayrollError(t('This pay run could not be found.'));
  return run;
}

function assertDraft(run: PayRun): void {
  if (run.status !== 'draft') {
    throw new PayrollError(t('Only a draft pay run can be changed. Reopen it first.'));
  }
}

/**
 * Brings a draft run up to date with the employee records, leave and loans
 * and the current settings, keeping overtime, absence and adjustments.
 */
export async function refreshPayRun(id: ID): Promise<PayRun> {
  return db.transaction('rw', TABLES(), async () => {
    const run = await loadRun(id);
    assertDraft(run);
    const ctx = await loadContext(run.companyId);
    const rules = payRulesFor(ctx.settings, run.period);
    const next: PayRun = { ...run, rules, updatedAt: nowStamp() };
    next.lines = linesFor(next, ctx, run.lines);
    await db.payRuns.put(next);
    return next;
  });
}

export interface PayLineChanges {
  overtime?: PayLine['overtime'];
  absentDays?: number;
  adjustments?: PayAdjustment[];
  loans?: LoanRecovery[];
}

/** Changes what was entered for one employee in a draft run and works the line out again. */
export async function updatePayLine(
  runId: ID,
  lineId: ID,
  changes: PayLineChanges,
): Promise<PayRun> {
  return db.transaction('rw', [db.payRuns, db.companies], async () => {
    const run = await loadRun(runId);
    assertDraft(run);
    const company = await loadCompany(run.companyId);
    const p = currencyPrecision(company.currency);
    const hours = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0);
    const money = (n: number) => (Number.isFinite(n) ? Math.max(0, round(n, p)) : 0);
    const lines = run.lines.map((line) => {
      if (line.id !== lineId) return line;
      const next: PayLine = { ...line };
      if (changes.overtime) {
        next.overtime = {
          normal: hours(changes.overtime.normal),
          restDay: hours(changes.overtime.restDay),
          holiday: hours(changes.overtime.holiday),
        };
      }
      if (changes.absentDays !== undefined) {
        next.absentDays = Math.min(hours(changes.absentDays), line.daysInMonth);
      }
      if (changes.adjustments) {
        next.adjustments = changes.adjustments
          .map((a) => ({
            id: a.id || shortId(),
            type: a.type === 'deduction' ? ('deduction' as const) : ('addition' as const),
            amount: money(a.amount),
            note: a.note.trim(),
          }))
          .filter((a) => a.amount > 0 || a.note);
      }
      if (changes.loans) {
        next.loans = line.loans.map((l) => {
          const changed = changes.loans?.find((c) => c.loanId === l.loanId);
          return changed ? { ...l, amount: money(changed.amount) } : l;
        });
      }
      return calculatePayLine(next, run.rules, p);
    });
    const next: PayRun = { ...run, lines, updatedAt: nowStamp() };
    await db.payRuns.put(next);
    return next;
  });
}

/** Changes the pay date (until paid), the deductions account or the notes of a run. */
export async function updatePayRun(
  id: ID,
  changes: { payDate?: ISODate; deductionAccountId?: ID | null; notes?: string },
): Promise<PayRun> {
  return db.transaction('rw', [db.payRuns], async () => {
    const run = await loadRun(id);
    const next: PayRun = { ...run, updatedAt: nowStamp() };
    if (changes.payDate !== undefined) {
      if (run.status === 'paid') throw new PayrollError(t('This pay run is already paid.'));
      if (!isISODate(changes.payDate)) throw new PayrollError(t('Enter the pay date.'));
      next.payDate = changes.payDate;
    }
    if (changes.deductionAccountId !== undefined) {
      assertDraft(run);
      next.deductionAccountId = changes.deductionAccountId;
    }
    if (changes.notes !== undefined) next.notes = changes.notes.trim();
    await db.payRuns.put(next);
    return next;
  });
}

/** Deletes a draft that was never approved; one that was keeps its history. */
export async function deletePayRun(id: ID): Promise<void> {
  await db.transaction('rw', [db.payRuns, db.activities], async () => {
    const run = await loadRun(id);
    assertDraft(run);
    if (run.reversalJournalIds.length > 0) {
      throw new PayrollError(
        t('This pay run was approved before, so it is kept. Change it and approve it again.'),
      );
    }
    await db.payRuns.delete(id);
    await logActivity(run.companyId, 'payroll', id, 'deleted', {
      text: msg('Pay run {period} deleted'),
      vars: { period: run.period },
    });
  });
}

/** Whether an employee counts as employed at the end of a day. */
function employedOn(employee: Employee, date: ISODate): boolean {
  if (employee.hireDate && employee.hireDate > date) return false;
  return !(employee.status === 'left' && employee.leavingDate && employee.leavingDate <= date);
}

/** Each current employee's end-of-service indemnity and unused leave at a month end. */
function provisionLines(ctx: Context, date: ISODate, rules: PayRules): ProvisionLine[] {
  const p = ctx.precision;
  return ctx.employees
    .filter((e) => employedOn(e, date))
    .map((e) => {
      const eos =
        !ctx.settings.eosForInsured && insuredWithPifss(e.category)
          ? 0
          : eosProvisionFor(e, date, ctx.people.eosDailyDivisor, p);
      // From the leave brought forward, when there is some: nothing before it is posted.
      const balance = employeeLeaveBalance(e, ctx.leave, date).balance;
      const leaveDays = Math.max(0, balance);
      const wage = e.allowances.reduce(
        (s, a) => s + toMinor(a.amount, p),
        toMinor(e.basicSalary, p),
      );
      return {
        employeeId: e.id,
        eos,
        leaveDays,
        leave: leaveValue(leaveDays, fromMinor(wage, p), rules.dailyDivisor, p),
      };
    });
}

/** Balances of accounts in the ledger at the end of a day, in minor units (debit positive). */
async function ledgerBalances(
  company: Company,
  accountIds: ID[],
  date: ISODate,
): Promise<Map<ID, number>> {
  const { lines } = await loadLedger(company);
  const out = new Map<ID, number>(accountIds.map((id) => [id, 0]));
  for (const l of lines) {
    if (l.date <= date && out.has(l.accountId)) {
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.amount);
    }
  }
  return out;
}

/**
 * Approves a draft run and posts it in one entry on the month's last day
 * (see payRunPostings), then, when provisions are on, the month-end
 * end-of-service and leave salary provisions.
 */
export async function approvePayRun(id: ID): Promise<PayRun> {
  return db.transaction('rw', TABLES(), async () => {
    const run = await loadRun(id);
    assertDraft(run);
    const ctx = await loadContext(run.companyId);
    const { company, precision: p } = ctx;
    if (run.lines.length === 0) throw new PayrollError(t('This pay run has no employees.'));
    const lines = run.lines.map((l) => calculatePayLine(l, run.rules, p));
    const negative = lines.filter((l) =>
      payLineWarnings(l, run.rules, p).some((w) => w.code === 'negative_net'),
    );
    if (negative.length) {
      throw new PayrollError(
        t('Net pay can’t be below zero. Lower the deductions of {names}.', {
          names: negative.map((l) => l.name).join(', '),
        }),
      );
    }
    for (const line of lines) {
      if (
        ctx.settlements.some(
          (s) =>
            s.employeeId === line.employeeId &&
            liveSettlement(s) &&
            s.lastSalary?.period === run.period,
        )
      ) {
        throw new PayrollError(
          t('{name} was paid for this month in a final settlement. Update the pay run.', {
            name: line.name,
          }),
        );
      }
      for (const recovery of line.loans) {
        const loan = ctx.loans.find((l) => l.id === recovery.loanId);
        const left = loan ? loanBalance(loan, ctx.runs, ctx.settlements, p, run.id) : 0;
        if (toMinor(recovery.amount, p) > toMinor(left, p)) {
          throw new PayrollError(
            t(
              'The loan recovery of {name} is more than what is left on the loan. Update the pay run.',
              {
                name: line.name,
              },
            ),
          );
        }
      }
    }
    assertOpen(company, run.date);

    const totals = payRunTotals(lines, p);
    const accounts = await ensureAccounts(
      company,
      ctx.settings,
      [
        'salaries',
        'allowances',
        'pifssExpense',
        'salariesPayable',
        'pifssPayable',
        'advances',
        ...(totals.otherDeductions > 0 ? (['otherDeductions'] as const) : []),
      ],
      { otherDeductions: run.deductionAccountId },
    );
    const label = { period: run.period };
    const journal = await postEntry(company, accounts, payRunPostings(totals, p), {
      date: run.date,
      sourceId: run.id,
      reference: t('Payroll {period}', label),
    });

    let provisions: ProvisionLine[] | null = null;
    let provisionJournal: ManualJournal | null = null;
    if (ctx.settings.provisions) {
      provisions = provisionLines(ctx, run.date, run.rules);
      const provisionAccounts = await ensureAccounts(company, ctx.settings, [
        'eosExpense',
        'eosProvision',
        'leaveExpense',
        'leaveProvision',
      ]);
      const eosTarget = provisions.reduce((s, x) => s + toMinor(x.eos, p), 0);
      const leaveTarget = provisions.reduce((s, x) => s + toMinor(x.leave, p), 0);
      // Provisions are credit balances: the change is the target less what is held.
      const held = await ledgerBalances(
        company,
        [provisionAccounts.eosProvision, provisionAccounts.leaveProvision],
        run.date,
      );
      const eosHeld = -(held.get(provisionAccounts.eosProvision) ?? 0);
      const leaveHeld = -(held.get(provisionAccounts.leaveProvision) ?? 0);
      provisionJournal = await postEntry(
        company,
        provisionAccounts,
        provisionPostings(eosTarget - eosHeld, leaveTarget - leaveHeld),
        {
          date: run.date,
          sourceId: run.id,
          reference: t('Payroll provisions {period}', label),
        },
      );
    }

    const next: PayRun = {
      ...run,
      lines,
      status: 'approved',
      journalId: journal?.id ?? null,
      provisionJournalId: provisionJournal?.id ?? null,
      provisions,
      updatedAt: nowStamp(),
    };
    await db.payRuns.put(next);
    await logActivity(company.id, 'payroll', run.id, 'approved', {
      text: msg('Pay run {period} approved'),
      vars: label,
    });
    return next;
  });
}

/** Records the salaries as paid: Dr 2300 salaries payable, Cr bank on the payment date. */
export async function payPayRun(
  id: ID,
  input: { date: ISODate; bankAccountId?: ID | null },
): Promise<PayRun> {
  return db.transaction('rw', TABLES(), async () => {
    const run = await loadRun(id);
    if (run.status !== 'approved') {
      throw new PayrollError(t('Approve the pay run before recording the payment.'));
    }
    const ctx = await loadContext(run.companyId);
    const { company, precision: p } = ctx;
    if (!isISODate(input.date)) throw new PayrollError(t('Enter the payment date.'));
    assertOpen(company, input.date);
    const bank = await moneyAccount(company, input.bankAccountId, ctx.settings.bankAccountId);
    const net = payRunTotals(run.lines, p).net;
    let paymentJournalId: ID | null = null;
    if (net > 0) {
      const accounts = await ensureAccounts(company, ctx.settings, ['salariesPayable']);
      const journal = await postPayment(company, {
        debit: accounts.salariesPayable,
        bank: bank.id,
        amount: net,
        date: input.date,
        sourceId: run.id,
        reference: t('Salaries {period} paid', { period: run.period }),
      });
      paymentJournalId = journal.id;
    }
    const next: PayRun = {
      ...run,
      status: 'paid',
      paidOn: input.date,
      bankAccountId: bank.id,
      paymentJournalId,
      updatedAt: nowStamp(),
    };
    await db.payRuns.put(next);
    await logActivity(company.id, 'payroll', run.id, 'paid', {
      text: msg('Pay run {period} paid'),
      vars: { period: run.period },
    });
    return next;
  });
}

/** Reverses the payment of a run, on its date. */
export async function undoPayRunPayment(id: ID): Promise<PayRun> {
  return db.transaction('rw', TABLES(), async () => {
    const run = await loadRun(id);
    if (run.status !== 'paid') throw new PayrollError(t('This pay run is not paid.'));
    const company = await loadCompany(run.companyId);
    assertOpen(company, run.paidOn);
    const reversal = await reverseEntry(run.paymentJournalId);
    const next: PayRun = {
      ...run,
      status: 'approved',
      paidOn: null,
      paymentJournalId: null,
      reversalJournalIds: [...run.reversalJournalIds, ...(reversal ? [reversal] : [])],
      updatedAt: nowStamp(),
    };
    await db.payRuns.put(next);
    await logActivity(company.id, 'payroll', run.id, 'payment_undone', {
      text: msg('Payment of pay run {period} undone'),
      vars: { period: run.period },
    });
    return next;
  });
}

/** Reopens an approved, unpaid run for changes, reversing its entries on their dates. */
export async function reopenPayRun(id: ID): Promise<PayRun> {
  return db.transaction('rw', TABLES(), async () => {
    const run = await loadRun(id);
    if (run.status === 'paid') {
      throw new PayrollError(t('Undo the payment before reopening the pay run.'));
    }
    if (run.status !== 'approved') throw new PayrollError(t('This pay run is not approved.'));
    const company = await loadCompany(run.companyId);
    assertOpen(company, run.date);
    const reversals = [
      await reverseEntry(run.journalId),
      await reverseEntry(run.provisionJournalId),
    ].filter((r): r is ID => Boolean(r));
    const next: PayRun = {
      ...run,
      status: 'draft',
      journalId: null,
      provisionJournalId: null,
      provisions: null,
      reversalJournalIds: [...run.reversalJournalIds, ...reversals],
      updatedAt: nowStamp(),
    };
    await db.payRuns.put(next);
    await logActivity(company.id, 'payroll', run.id, 'reopened', {
      text: msg('Pay run {period} reopened'),
      vars: { period: run.period },
    });
    return next;
  });
}

/** Whether an employee has payroll records that must be kept (pay runs, loans, leave, settlements). */
export async function employeeHasPayroll(employee: Employee): Promise<boolean> {
  const [runs, loans, leave, settlements] = await Promise.all([
    db.payRuns
      .where('companyId')
      .equals(employee.companyId)
      .filter((r) => r.lines.some((l) => l.employeeId === employee.id))
      .count(),
    db.staffLoans.where('employeeId').equals(employee.id).count(),
    db.leaveRecords.where('employeeId').equals(employee.id).count(),
    db.finalSettlements.where('employeeId').equals(employee.id).count(),
  ]);
  return runs + loans + leave + settlements > 0;
}

/* -------------------------------------------------------------------------- */
/* Final settlement                                                           */
/* -------------------------------------------------------------------------- */

export interface SettlementForm {
  employeeId: ID;
  leavingDate: ISODate;
  reason: LeavingReason;
  pifssOffset: number;
  indemnityOverride: number | null;
  noticeMonths: number;
  leaveDays: number;
  lastSalaryDays: number;
  loans: LoanRecovery[];
  otherDeductions: number;
  deductionNote: string;
  notes: string;
}

export interface SettlementData {
  settings: PayrollSettings;
  people: Pick<PeopleSettings, 'eosDailyDivisor'>;
  leave: LeaveRecord[];
  loans: StaffLoan[];
  runs: PayRun[];
  settlements: FinalSettlement[];
}

export interface SettlementSetup {
  rules: PayRules;
  eosDivisor: number;
  leave: LeaveBalance;
  /** The employee's active loans and what is left on them. */
  loans: { loan: StaffLoan; balance: number }[];
  /** The employee's share of the provisions held. */
  provisions: { eos: number; leave: number };
  /** An approved pay run already pays the leaving month. */
  paidInRun: PayRun | null;
}

/** What a settlement on a date starts from: rules, leave balance, loans, provisions. */
export function settlementSetup(
  employee: Employee,
  leavingDate: ISODate,
  data: SettlementData,
  precision: number,
): SettlementSetup {
  const period = periodOf(leavingDate);
  const withProvisions = data.runs
    .filter((r) => r.status !== 'draft' && r.provisions)
    .sort((a, b) => b.period.localeCompare(a.period))[0];
  const share = withProvisions?.provisions?.find((x) => x.employeeId === employee.id);
  return {
    rules: payRulesFor(data.settings, period),
    eosDivisor: data.people.eosDailyDivisor,
    leave: employeeLeaveBalance(employee, data.leave, leavingDate),
    loans: data.loans
      .filter((l) => l.employeeId === employee.id && l.status === 'active')
      .map((loan) => ({ loan, balance: loanBalance(loan, data.runs, data.settlements, precision) }))
      .filter((x) => x.balance > 0),
    provisions: { eos: share?.eos ?? 0, leave: share?.leave ?? 0 },
    paidInRun:
      data.runs.find(
        (r) =>
          r.period === period &&
          r.status !== 'draft' &&
          r.lines.some((l) => l.employeeId === employee.id),
      ) ?? null,
  };
}

/** A settlement form filled in with what the law and the records give. */
export function settlementDefaults(
  employee: Employee,
  leavingDate: ISODate,
  reason: LeavingReason,
  setup: SettlementSetup,
  precision: number,
): SettlementForm {
  const form: SettlementForm = {
    employeeId: employee.id,
    leavingDate,
    reason,
    pifssOffset: 0,
    indemnityOverride: null,
    noticeMonths: noticeMonthsFor(reason, employee.payBasis),
    leaveDays: Math.max(0, setup.leave.balance),
    lastSalaryDays: setup.paidInRun ? 0 : lastMonthDays(employee.hireDate, leavingDate),
    loans: [],
    otherDeductions: 0,
    deductionNote: '',
    notes: '',
  };
  // Loans are recovered from what is due, as far as it goes.
  const due = computeSettlement(settlementInput(employee, form, setup, precision));
  let available = toMinor(due.net, precision);
  form.loans = setup.loans.map(({ loan, balance }) => {
    const amount = Math.max(0, Math.min(toMinor(balance, precision), available));
    available -= amount;
    return { loanId: loan.id, amount: fromMinor(amount, precision) };
  });
  return form;
}

/** The calculator's input for a settlement form. */
export function settlementInput(
  employee: Employee,
  form: SettlementForm,
  setup: SettlementSetup,
  precision: number,
) {
  return {
    employee,
    leavingDate: form.leavingDate,
    reason: form.reason,
    rules: setup.rules,
    eosDivisor: setup.eosDivisor,
    pifssOffset: form.pifssOffset,
    indemnityOverride: form.indemnityOverride,
    noticeMonths: form.noticeMonths,
    leaveDays: form.leaveDays,
    lastSalaryDays: form.lastSalaryDays,
    loans: form.loans,
    otherDeductions: form.otherDeductions,
    eosProvision: setup.provisions.eos,
    leaveProvision: setup.provisions.leave,
    precision,
  };
}

/**
 * Why a final settlement can't be made for the employee yet (no hire date or
 * no wage on their record), or null when it can.
 */
export function settlementMissingText(
  employee: Pick<Employee, 'name' | 'nameAr' | 'hireDate' | 'basicSalary' | 'allowances'>,
): string | null {
  const missing = settlementMissing(employee);
  const vars = { name: localName(employee) };
  if (missing.hireDate && missing.wage) {
    return t(
      'Add the hire date and the salary to {name}’s record before the final settlement.',
      vars,
    );
  }
  if (missing.hireDate) {
    return t('Add the hire date to {name}’s record before the final settlement.', vars);
  }
  if (missing.wage) {
    return t('Add the salary to {name}’s record before the final settlement.', vars);
  }
  return null;
}

/**
 * Posts a final settlement on the leaving date (see settlementPostings) and
 * marks the employee as left. Refused without a reason for leaving, a hire
 * date or a wage: each of them decides what is due.
 */
export async function postSettlement(form: SettlementForm): Promise<FinalSettlement> {
  return db.transaction('rw', TABLES(), async () => {
    const employee = await db.employees.get(form.employeeId);
    if (!employee) throw new PayrollError(t('This employee could not be found.'));
    const ctx = await loadContext(employee.companyId);
    const { company, precision: p } = ctx;
    if (ctx.settlements.some((s) => s.employeeId === employee.id && liveSettlement(s))) {
      throw new PayrollError(t('This employee already has a final settlement.'));
    }
    const missing = settlementMissingText(employee);
    if (missing) throw new PayrollError(missing);
    if (!form.reason || !(form.reason in LEAVING_REASON_LABELS)) {
      throw new PayrollError(t('Choose the reason for leaving.'));
    }
    if (!isISODate(form.leavingDate)) throw new PayrollError(t('Enter the leaving date.'));
    if (employee.hireDate && form.leavingDate < employee.hireDate) {
      throw new PayrollError(t('The leaving date can’t be before the hire date.'));
    }
    assertOpen(company, form.leavingDate);
    const setup = settlementSetup(employee, form.leavingDate, ctx, p);
    if (setup.paidInRun && form.lastSalaryDays > 0) {
      throw new PayrollError(
        t('The pay run of this month already pays this employee. Set the last salary days to 0.'),
      );
    }
    for (const recovery of form.loans) {
      const loan = setup.loans.find((l) => l.loan.id === recovery.loanId);
      if (toMinor(recovery.amount, p) > toMinor(loan?.balance ?? 0, p)) {
        throw new PayrollError(t('A loan recovery is more than what is left on the loan.'));
      }
    }
    const amounts: SettlementAmounts = computeSettlement(settlementInput(employee, form, setup, p));
    if (amounts.net < 0) {
      throw new PayrollError(
        t('The deductions are more than what is due. Lower the loan recovery or other deductions.'),
      );
    }
    const id = newId();
    const list = settlementPostings(amounts, setup.provisions, p);
    const accounts = await ensureAccounts(company, ctx.settings, [
      ...new Set(list.map((x) => x.key)),
    ]);
    const journal = await postEntry(company, accounts, list, {
      date: form.leavingDate,
      sourceId: id,
      reference: t('Final settlement – {name}', { name: employee.name }),
    });
    const stamp = nowStamp();
    const settlement: FinalSettlement = {
      id,
      companyId: company.id,
      employeeId: employee.id,
      status: 'posted',
      leavingDate: form.leavingDate,
      reason: form.reason,
      years: amounts.years,
      eosWage: amounts.eosWage,
      indemnity: amounts.indemnity,
      pifssOffset: round(Math.max(0, form.pifssOffset), p),
      noticeMonths: Math.max(0, form.noticeMonths),
      noticePay: amounts.noticePay,
      leaveDays: Math.max(0, form.leaveDays),
      leavePay: amounts.leavePay,
      lastSalary: amounts.lastSalary,
      loans: form.loans.filter((l) => toMinor(l.amount, p) > 0),
      otherDeductions: amounts.otherDeductions,
      deductionNote: form.deductionNote.trim(),
      eosProvision: setup.provisions.eos,
      leaveProvision: setup.provisions.leave,
      net: amounts.net,
      journalId: journal?.id ?? null,
      paidOn: null,
      paymentJournalId: null,
      bankAccountId: null,
      reversalJournalIds: [],
      notes: form.notes.trim(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.finalSettlements.add(settlement);
    const vars = { name: employee.name, number: employee.number };
    const arabic = { name: employee.nameAr };
    // The employee's record follows the settlement: leaving date and the reason chosen.
    if (
      employee.status !== 'left' ||
      employee.leavingDate !== form.leavingDate ||
      employee.leavingReason !== form.reason
    ) {
      await db.employees.put({
        ...employee,
        status: 'left',
        leavingDate: form.leavingDate,
        leavingReason: form.reason,
        updatedAt: stamp,
      });
      if (employee.status !== 'left') {
        await logActivity(company.id, 'employee', employee.id, 'left', {
          text: msg('Employee {name} ({number}) marked as left'),
          vars,
          arabic,
        });
      }
    }
    await logActivity(company.id, 'payroll', id, 'settlement', {
      text: msg('Final settlement for {name} posted'),
      vars,
      arabic,
    });
    return settlement;
  });
}

async function loadSettlement(id: ID): Promise<FinalSettlement> {
  const settlement = await db.finalSettlements.get(id);
  if (!settlement) throw new PayrollError(t('This settlement could not be found.'));
  return settlement;
}

/** Pays the amount due to the leaving employee: Dr 2300, Cr bank. */
export async function paySettlement(
  id: ID,
  input: { date: ISODate; bankAccountId?: ID | null },
): Promise<FinalSettlement> {
  return db.transaction('rw', TABLES(), async () => {
    const settlement = await loadSettlement(id);
    if (settlement.status !== 'posted') {
      throw new PayrollError(t('This settlement can’t be paid.'));
    }
    const company = await loadCompany(settlement.companyId);
    if (!isISODate(input.date)) throw new PayrollError(t('Enter the payment date.'));
    assertOpen(company, input.date);
    const settings = await getPayrollSettings(company.id);
    const bank = await moneyAccount(company, input.bankAccountId, settings.bankAccountId);
    const employee = await db.employees.get(settlement.employeeId);
    const name = employee?.name ?? '';
    const nameAr = employee?.nameAr;
    let paymentJournalId: ID | null = null;
    if (settlement.net > 0) {
      const accounts = await ensureAccounts(company, settings, ['salariesPayable']);
      const journal = await postPayment(company, {
        debit: accounts.salariesPayable,
        bank: bank.id,
        amount: settlement.net,
        date: input.date,
        sourceId: settlement.id,
        reference: t('Final settlement – {name} paid', { name }),
      });
      paymentJournalId = journal.id;
    }
    const next: FinalSettlement = {
      ...settlement,
      status: 'paid',
      paidOn: input.date,
      bankAccountId: bank.id,
      paymentJournalId,
      updatedAt: nowStamp(),
    };
    await db.finalSettlements.put(next);
    await logActivity(company.id, 'payroll', id, 'settlement_paid', {
      text: msg('Final settlement for {name} paid'),
      vars: { name },
      arabic: { name: nameAr },
    });
    return next;
  });
}

/** Reverses an unpaid settlement (or the payment of a paid one) on its date. */
export async function reverseSettlement(id: ID): Promise<FinalSettlement> {
  return db.transaction('rw', TABLES(), async () => {
    const settlement = await loadSettlement(id);
    const company = await loadCompany(settlement.companyId);
    const employee = await db.employees.get(settlement.employeeId);
    const vars = { name: employee?.name ?? '' };
    const arabic = { name: employee?.nameAr };
    let next: FinalSettlement;
    if (settlement.status === 'paid') {
      assertOpen(company, settlement.paidOn);
      const reversal = await reverseEntry(settlement.paymentJournalId);
      next = {
        ...settlement,
        status: 'posted',
        paidOn: null,
        paymentJournalId: null,
        reversalJournalIds: [...settlement.reversalJournalIds, ...(reversal ? [reversal] : [])],
      };
      await logActivity(company.id, 'payroll', id, 'settlement_payment_undone', {
        text: msg('Payment of the final settlement for {name} undone'),
        vars,
        arabic,
      });
    } else if (settlement.status === 'posted') {
      assertOpen(company, settlement.leavingDate);
      const reversal = await reverseEntry(settlement.journalId);
      next = {
        ...settlement,
        status: 'reversed',
        reversalJournalIds: [...settlement.reversalJournalIds, ...(reversal ? [reversal] : [])],
      };
      await logActivity(company.id, 'payroll', id, 'settlement_reversed', {
        text: msg('Final settlement for {name} reversed'),
        vars,
        arabic,
      });
    } else {
      throw new PayrollError(t('This settlement was reversed.'));
    }
    next = { ...next, updatedAt: nowStamp() };
    await db.finalSettlements.put(next);
    return next;
  });
}
