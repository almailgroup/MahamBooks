import { db } from '@/db/db';
import type { Company } from '@/db/types';
import {
  ALERT_TOPICS,
  collectAlerts,
  type Alert,
  type AlertData,
  type AlertTopic,
} from '@/alerts/collect';
import { canOpen, type AccessMap } from '@/suite/apps';
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

export function homeTopics(access: AccessMap): AlertTopic[] {
  return ALERT_TOPICS.filter((topic) => canOpen(access[TOPIC_APPS[topic]]));
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
  return {
    company,
    employees,
    // An employee's own papers stay with People.
    complianceDocuments: people
      ? complianceDocuments
      : complianceDocuments.filter((d) => !d.employeeId),
    complianceMarks,
    peopleSettings: peopleSettings ?? null,
    documents,
    payments,
    clients,
  };
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
