import { db } from '@/db/db';
import { newCopyFiles } from '@/db/renewals';
import type { ApprovalRequest, Company } from '@/db/types';
import {
  latestRenewals,
  normalizeReminderDays,
  normalizeReminderDaysByType,
  registerEntries,
} from '@/lib/compliance';
import { withPeopleDefaults } from '@/lib/hr/people-settings';
import {
  ALERT_TOPICS,
  collectAlerts,
  type Alert,
  type AlertData,
  type AlertTopic,
} from '@/alerts/collect';
import { canOpen, type AccessMap } from '@/suite/apps';
import { lookup } from '@/lib/known';
import { today as localToday } from '@/lib/dates';
import type { AppId } from '@/suite/types';

/**
 * What needs attention across the apps, for the suite's home: the same items
 * as the morning email (src/alerts/collect.ts), worked out from the records
 * on this device, and only those of apps the person may open.
 */

/** The app each kind of alert belongs to. */
export const TOPIC_APPS: Record<AlertTopic, AppId> = {
  documents: 'compliance',
  deadlines: 'compliance',
  cheques: 'books',
  bills: 'books',
  invoices: 'books',
};

/** Where the whole list of a topic is. */
export const TOPIC_PAGES: Record<AlertTopic, string> = {
  documents: '/compliance/documents',
  deadlines: '/compliance',
  cheques: '/cheques',
  bills: '/bills?status=unpaid',
  invoices: '/invoices?status=overdue',
};

/** The app a topic belongs to; null for a topic this version doesn't know. */
export function topicApp(topic: string): AppId | null {
  return lookup<AlertTopic, AppId | null>(TOPIC_APPS, topic, null);
}

/** Where a topic's whole list is; the home for a topic this version doesn't know. */
export function topicPage(topic: string): string {
  return lookup(TOPIC_PAGES, topic, '/');
}

export function homeTopics(access: AccessMap): AlertTopic[] {
  return ALERT_TOPICS.filter((topic) => {
    const app = topicApp(topic);
    return app !== null && canOpen(access[app]);
  });
}

/**
 * The company's records as the alerts need them. Employees (and their
 * papers) only for those who may see People.
 */
export async function loadHomeAlertData(company: Company, people: boolean): Promise<AlertData> {
  const id = company.id;
  const [
    employees,
    complianceDocuments,
    complianceMarks,
    peopleSettings,
    documents,
    payments,
    clients,
  ] = await Promise.all([
    people ? db.employees.where('companyId').equals(id).toArray() : [],
    db.complianceDocuments.where('companyId').equals(id).toArray(),
    db.complianceMarks.where('companyId').equals(id).toArray(),
    db.peopleSettings.where('companyId').equals(id).first(),
    db.documents
      .where('companyId')
      .equals(id)
      .filter((d) => d.type === 'invoice' || d.type === 'bill')
      .toArray(),
    db.payments
      .where('companyId')
      .equals(id)
      .filter((p) => p.method === 'cheque')
      .toArray(),
    db.clients.where('companyId').equals(id).toArray(),
  ]);
  // An employee's own papers, and confidential documents, stay with People.
  const papers = people
    ? complianceDocuments
    : complianceDocuments.filter((d) => !d.employeeId && d.confidential !== true);
  const data: AlertData = {
    company,
    employees,
    complianceDocuments: papers,
    complianceMarks,
    peopleSettings: peopleSettings ?? null,
    documents,
    payments,
    clients,
  };
  // Renewed papers' new copies (#18), once the company asks for them.
  const settings = withPeopleDefaults(id, peopleSettings);
  if (settings.newCopyGraceDays) {
    const renewals = await db.renewals.where('companyId').equals(id).toArray();
    const entries = registerEntries({
      employees,
      documents: papers,
      reminderDays: normalizeReminderDays(settings.reminderDays),
      reminderDaysByType: normalizeReminderDaysByType(settings.reminderDaysByType),
    });
    data.renewals = renewals;
    data.copies = await newCopyFiles(id, entries, latestRenewals(renewals), settings, localToday());
  }
  return data;
}

/** Everything that needs attention today, the most urgent first. */
export function homeAlerts(data: AlertData, today: string, topics: readonly AlertTopic[]): Alert[] {
  const rank = (a: Alert) => (a.tone === 'red' ? 0 : 1);
  return collectAlerts(data, today, topics).sort(
    (a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
  );
}

/** The page where an alert is dealt with. */
export function alertPage(alert: Alert, people: boolean): string {
  switch (alert.topic) {
    case 'documents':
      return people && alert.entry.employeeId
        ? `/employees/${alert.entry.employeeId}`
        : TOPIC_PAGES.documents;
    case 'deadlines':
      return TOPIC_PAGES.deadlines;
    case 'cheques':
      return `/payments${alert.received ? '' : '-made'}/${alert.payment.id}`;
    case 'bills':
      return `/bills/${alert.doc.id}`;
    case 'invoices':
      return `/invoices/${alert.doc.id}`;
  }
}

/**
 * Approval requests that need the person: every waiting one for an approver,
 * their own waiting ones for anyone else (who can only take them back).
 */
export function approvalsWaiting(
  requests: readonly Pick<ApprovalRequest, 'status' | 'requestedBy'>[],
  { approver, userId }: { approver: boolean; userId: string | null },
): number {
  return requests.filter(
    (r) => r.status === 'pending' && (approver || (userId !== null && r.requestedBy === userId)),
  ).length;
}
