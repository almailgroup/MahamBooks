import type {
  ChequeDetails,
  Client,
  Company,
  ComplianceDocument,
  ComplianceMark,
  Employee,
  ID,
  InvoiceDocument,
  ISODate,
  Payment,
  PeopleSettings,
} from '@/db/types';
import { accountingSettings } from '@/db/chart-setup';
import {
  complianceCalendar,
  DUE_SOON_DAYS,
  expiryStatus,
  normalizeReminderDays,
  overdueSince,
  registerEntries,
  statutoryContextOf,
  type RegisterEntry,
  type StatutoryDeadline,
} from '@/lib/compliance';
import { withPeopleDefaults } from '@/lib/hr/people-settings';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { addDaysISO, daysBetween } from '@/lib/dates';
import { isOpenCheque } from '@/lib/cheques';
import { ALERT_TOPICS, type AlertTopic } from './topics';

/**
 * What the morning email reports: papers and licences that expire soon or
 * have expired, statutory deadlines, cheques coming due, bills to pay and
 * invoices customers haven't paid on time. The same rules as the app's
 * dashboard and compliance calendar, worked out from the company's records
 * as the cloud keeps them.
 *
 * Each alert has a key for the stage it has reached (a document's 30-day
 * reminder, an invoice becoming overdue…): an email marks the alerts that
 * are new since the last one by their keys.
 */

export {
  ALERT_TOPICS,
  isAlertTopic,
  TOPIC_DESCRIPTIONS,
  TOPIC_LABELS,
  topicLabel,
  type AlertTopic,
} from './topics';

/** Cheques and bills falling due within this many days (today included) are reported. */
export const DUE_WINDOW_DAYS = 7;

/** A company's records as the alerts need them. */
export interface AlertData {
  company: Company;
  employees: Employee[];
  complianceDocuments: ComplianceDocument[];
  complianceMarks: ComplianceMark[];
  peopleSettings: Partial<PeopleSettings> | null;
  /** Invoices and bills (only the open ones are needed). */
  documents: InvoiceDocument[];
  /** Payments (only those with an open cheque are needed). */
  payments: Payment[];
  clients: Pick<Client, 'id' | 'name' | 'nameAr'>[];
}

export type AlertTone = 'red' | 'amber';

interface AlertBase {
  topic: AlertTopic;
  /** The item and the stage it has reached; emailed as new once. */
  key: string;
  /** The date it is about: expiry, due date or cheque date. */
  date: ISODate;
  /** Days from today to `date` (negative when past). */
  daysLeft: number;
  tone: AlertTone;
}

export type Alert =
  | (AlertBase & { topic: 'documents'; entry: RegisterEntry; expired: boolean })
  | (AlertBase & { topic: 'deadlines'; deadline: StatutoryDeadline; overdue: boolean })
  | (AlertBase & {
      topic: 'cheques';
      payment: Payment & { cheque: ChequeDetails };
      received: boolean;
      /** A received cheque whose date has passed and that is still in hand. */
      late: boolean;
    })
  | (AlertBase & { topic: 'bills'; doc: InvoiceDocument; overdue: boolean })
  | (AlertBase & { topic: 'invoices'; doc: InvoiceDocument });

const isOpenDocument = (d: InvoiceDocument) =>
  (d.status === 'sent' || d.status === 'partial') && d.totals.balance > 0;

function documentAlerts(data: AlertData, today: ISODate): Alert[] {
  const settings = withPeopleDefaults(data.company.id, data.peopleSettings);
  const entries = registerEntries({
    employees: data.employees,
    documents: data.complianceDocuments,
    reminderDays: normalizeReminderDays(settings.reminderDays),
  });
  const alerts: Alert[] = [];
  for (const entry of entries) {
    if (!entry.expiryDate) continue;
    const info = expiryStatus(entry.expiryDate, entry.reminderDays, today);
    if (info.status === 'valid' || info.daysLeft === null) continue;
    const expired = info.status === 'expired';
    const stage = expired ? 'expired' : `${info.reminder}d`;
    alerts.push({
      topic: 'documents',
      key: `documents:${entry.key}:${entry.expiryDate}:${stage}`,
      date: entry.expiryDate,
      daysLeft: info.daysLeft,
      tone: expired || info.daysLeft <= 7 ? 'red' : 'amber',
      entry,
      expired,
    });
  }
  return alerts;
}

function deadlineAlerts(data: AlertData, today: ISODate): Alert[] {
  const { company } = data;
  const settings = withPeopleDefaults(company.id, data.peopleSettings);
  const ctx = statutoryContextOf({
    fiscalYearEnd: accountingSettings(company).fiscalYearEnd,
    profile: kuwaitProfile(company),
    settings,
    employees: data.employees,
  });
  const items = complianceCalendar({
    ctx,
    entries: [],
    marks: data.complianceMarks,
    from: today,
    days: DUE_SOON_DAYS,
    overdueSince: overdueSince(company.createdAt, today),
  });
  return items.flatMap((item): Alert[] => {
    if (!item.deadline || (item.status !== 'overdue' && item.status !== 'due_soon')) return [];
    const overdue = item.status === 'overdue';
    return [
      {
        topic: 'deadlines',
        key: `deadlines:${item.key}:${overdue ? 'overdue' : 'soon'}`,
        date: item.dueDate,
        daysLeft: item.daysLeft,
        tone: overdue ? 'red' : 'amber',
        deadline: item.deadline,
        overdue,
      },
    ];
  });
}

function chequeAlerts(data: AlertData, today: ISODate): Alert[] {
  const windowEnd = addDaysISO(today, DUE_WINDOW_DAYS - 1);
  const alerts: Alert[] = [];
  for (const p of data.payments) {
    if (p.voided || p.method !== 'cheque' || !p.cheque) continue;
    const cheque = p.cheque;
    if (!isOpenCheque(cheque.status)) continue;
    const received = p.direction !== 'out';
    // Received and still in hand after its date: it should have gone to the bank.
    const late = received && cheque.status === 'held' && cheque.date < today;
    // Received ones already at the bank only wait for it to clear.
    const due =
      cheque.date >= today && cheque.date <= windowEnd && (!received || cheque.status === 'held');
    if (!late && !due) continue;
    alerts.push({
      topic: 'cheques',
      key: `cheques:${p.id}:${cheque.date}:${late ? 'late' : 'due'}`,
      date: cheque.date,
      daysLeft: daysBetween(today, cheque.date),
      tone: late || cheque.date === today ? 'red' : 'amber',
      payment: { ...p, cheque },
      received,
      late,
    });
  }
  return alerts;
}

function billAlerts(data: AlertData, today: ISODate): Alert[] {
  const windowEnd = addDaysISO(today, DUE_WINDOW_DAYS - 1);
  return data.documents.flatMap((doc): Alert[] => {
    if (doc.type !== 'bill' || !isOpenDocument(doc)) return [];
    const due = doc.dueDate ?? doc.issueDate;
    if (due > windowEnd) return [];
    const overdue = due < today;
    return [
      {
        topic: 'bills',
        key: `bills:${doc.id}:${due}:${overdue ? 'overdue' : 'due'}`,
        date: due,
        daysLeft: daysBetween(today, due),
        tone: overdue ? 'red' : 'amber',
        doc,
        overdue,
      },
    ];
  });
}

function invoiceAlerts(data: AlertData, today: ISODate): Alert[] {
  return data.documents.flatMap((doc): Alert[] => {
    if (doc.type !== 'invoice' || !isOpenDocument(doc) || !doc.dueDate || doc.dueDate >= today) {
      return [];
    }
    return [
      {
        topic: 'invoices',
        key: `invoices:${doc.id}:${doc.dueDate}:overdue`,
        date: doc.dueDate,
        daysLeft: daysBetween(today, doc.dueDate),
        tone: 'red',
        doc,
      },
    ];
  });
}

const COLLECTORS: Record<AlertTopic, (data: AlertData, today: ISODate) => Alert[]> = {
  documents: documentAlerts,
  deadlines: deadlineAlerts,
  cheques: chequeAlerts,
  bills: billAlerts,
  invoices: invoiceAlerts,
};

/**
 * Everything that needs attention on `today` (the company's local date), for
 * the chosen topics: by topic, then soonest first.
 */
export function collectAlerts(
  data: AlertData,
  today: ISODate,
  topics: readonly AlertTopic[] = ALERT_TOPICS,
): Alert[] {
  return ALERT_TOPICS.filter((topic) => topics.includes(topic)).flatMap((topic) =>
    COLLECTORS[topic](data, today).sort(
      (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
    ),
  );
}

/** Names of employees and clients by id, for the email. */
export function alertLookups(data: AlertData): {
  employees: Map<ID, Employee>;
  clients: Map<ID, Pick<Client, 'id' | 'name' | 'nameAr'>>;
} {
  return {
    employees: new Map(data.employees.map((e) => [e.id, e])),
    clients: new Map(data.clients.map((c) => [c.id, c])),
  };
}
