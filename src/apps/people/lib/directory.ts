import type { Department, Employee, ID, ISODate, LeaveRecord } from '@/db/types';
import { isCurrent } from '@/lib/hr/employees';
import { departmentKey, findDepartment } from '@/lib/hr/departments';
import { addDaysISO } from '@/lib/dates';
import { compactSearch, normalizeSearch } from '@/features/search/normalize';

/**
 * The staff directory: who works here, what they do and how to reach them.
 * A contact card holds only these fields; salaries, IBANs and papers stay on
 * the employee's own page.
 */
export interface Contact {
  id: ID;
  name: string;
  nameAr?: string;
  jobTitle: string;
  jobTitleAr?: string;
  /** The English name, as employees keep it (and links carry it). */
  department: string;
  /** Its Arabic name, from the company's list of departments. */
  departmentAr?: string;
  phone: string;
  email: string;
  photoId?: ID | null;
  onLeave: boolean;
}

/** The Arabic name of the department an employee keeps by its English name, if the list has one. */
function arabicDepartment(list: readonly Department[] | undefined, name: string) {
  const found = findDepartment(list, name);
  return found && departmentKey(found.name) === departmentKey(name) && found.nameAr
    ? found.nameAr
    : undefined;
}

/** Only what a contact card shows, so nothing else can reach it. */
export function toContact(e: Employee, onLeave: boolean, list?: readonly Department[]): Contact {
  const departmentAr = arabicDepartment(list, e.department);
  return {
    id: e.id,
    name: e.name,
    nameAr: e.nameAr,
    jobTitle: e.jobTitle,
    jobTitleAr: e.jobTitleAr,
    department: e.department.trim(),
    ...(departmentAr ? { departmentAr } : {}),
    phone: e.phone,
    email: e.email,
    photoId: e.photoId,
    onLeave: onLeave || e.status === 'on_leave',
  };
}

/** Approved leave covering a day: who is away. */
export function awayOn(records: readonly LeaveRecord[], day: ISODate): Map<ID, LeaveRecord> {
  const away = new Map<ID, LeaveRecord>();
  for (const r of records) {
    if (r.kind !== 'leave' || r.status !== 'approved') continue;
    if (r.start <= day && day <= r.end) away.set(r.employeeId, r);
  }
  return away;
}

/** The current staff as contacts, by name; departments get their Arabic names from `list`. */
export function directory(
  employees: readonly Employee[],
  away: ReadonlyMap<ID, unknown> = new Map(),
  list?: readonly Department[],
): Contact[] {
  return employees
    .filter(isCurrent)
    .map((e) => toContact(e, away.has(e.id), list))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Departments with their headcount, the biggest first; "" for those without
 * one. `name` is what employees keep (for links), `nameAr` the list's
 * Arabic name.
 */
export function departments(
  contacts: readonly Contact[],
): { name: string; nameAr?: string; count: number }[] {
  const groups = new Map<string, { name: string; nameAr?: string; count: number }>();
  for (const c of contacts) {
    const group = groups.get(c.department);
    if (group) group.count += 1;
    else {
      groups.set(c.department, {
        name: c.department,
        ...(c.departmentAr ? { nameAr: c.departmentAr } : {}),
        count: 1,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Contacts matching every word typed, in English or Arabic, and the department chosen. */
export function findContacts(
  contacts: readonly Contact[],
  query: string,
  department: string | null = null,
): Contact[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  return contacts.filter((c) => {
    if (department !== null && c.department !== department) return false;
    if (!words.length) return true;
    const text = normalizeSearch(
      [c.name, c.nameAr, c.jobTitle, c.jobTitleAr, c.department, c.departmentAr, c.email]
        .filter(Boolean)
        .join(' '),
    );
    // Phone numbers are found however they are spaced: "9999 1234" or "99991234".
    const phone = compactSearch(c.phone);
    return words.every((w) => {
      if (text.includes(w)) return true;
      const digits = compactSearch(w);
      return digits !== '' && phone.includes(digits);
    });
  });
}

export type MilestoneKind = 'probation' | 'contract' | 'joined';

export interface Milestone {
  employeeId: ID;
  kind: MilestoneKind;
  date: ISODate;
}

/**
 * What comes up for the current staff in the next `days` days: probation
 * and fixed-term contracts ending, and people who start.
 */
export function comingUp(employees: readonly Employee[], today: ISODate, days = 30): Milestone[] {
  const end = addDaysISO(today, days);
  const within = (date: ISODate | null | undefined): date is ISODate =>
    Boolean(date && date >= today && date <= end);
  const list: Milestone[] = [];
  for (const e of employees) {
    if (!isCurrent(e)) continue;
    if (within(e.probationEnd))
      list.push({ employeeId: e.id, kind: 'probation', date: e.probationEnd });
    if (e.contractType === 'fixed' && within(e.contractEnd))
      list.push({ employeeId: e.id, kind: 'contract', date: e.contractEnd });
    if (within(e.hireDate) && e.hireDate !== today)
      list.push({ employeeId: e.id, kind: 'joined', date: e.hireDate });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Current staff hired in the last `days` days. */
export function newJoiners(employees: readonly Employee[], today: ISODate, days = 30): Employee[] {
  const since = addDaysISO(today, -days);
  return employees.filter(
    (e) => isCurrent(e) && e.hireDate && e.hireDate >= since && e.hireDate <= today,
  );
}
