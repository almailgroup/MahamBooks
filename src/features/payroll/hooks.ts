import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { getPayrollSettings } from '@/db/payroll';
import type {
  Account,
  FinalSettlement,
  ID,
  LeaveRecord,
  PayRun,
  PayrollSettings,
  StaffLoan,
} from '@/db/types';
import { useCompany } from '@/app/company';

/** Payroll settings, with defaults. */
export function usePayrollSettings(): PayrollSettings | undefined {
  const company = useCompany();
  return useLiveQuery(() => getPayrollSettings(company.id), [company.id]);
}

/** The company's pay runs, latest month first. */
export function usePayRuns(): PayRun[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    async () =>
      (await db.payRuns.where('companyId').equals(company.id).toArray()).sort((a, b) =>
        b.period.localeCompare(a.period),
      ),
    [company.id],
  );
}

/** Leave records of one employee, or of the whole company. */
export function useLeaveRecords(employeeId?: ID): LeaveRecord[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () =>
      employeeId
        ? db.leaveRecords.where('employeeId').equals(employeeId).toArray()
        : db.leaveRecords.where('companyId').equals(company.id).toArray(),
    [company.id, employeeId],
  );
}

/** Staff loans of one employee, or of the whole company. */
export function useStaffLoans(employeeId?: ID): StaffLoan[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () =>
      employeeId
        ? db.staffLoans.where('employeeId').equals(employeeId).toArray()
        : db.staffLoans.where('companyId').equals(company.id).toArray(),
    [company.id, employeeId],
  );
}

export function useSettlements(employeeId?: ID): FinalSettlement[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () =>
      employeeId
        ? db.finalSettlements.where('employeeId').equals(employeeId).toArray()
        : db.finalSettlements.where('companyId').equals(company.id).toArray(),
    [company.id, employeeId],
  );
}

export function useAccounts(): Account[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
}
