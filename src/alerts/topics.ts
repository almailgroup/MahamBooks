import { lookup } from '@/lib/known';
import { msg } from '@/i18n';

/** What the morning email can cover; each person picks theirs in Settings → Email alerts. */
export const ALERT_TOPICS = ['documents', 'deadlines', 'cheques', 'bills', 'invoices'] as const;
export type AlertTopic = (typeof ALERT_TOPICS)[number];

export function isAlertTopic(value: unknown): value is AlertTopic {
  return (ALERT_TOPICS as readonly unknown[]).includes(value);
}

export const TOPIC_LABELS: Record<AlertTopic, string> = {
  documents: msg('Papers and licences'),
  deadlines: msg('Deadlines'),
  cheques: msg('Cheques'),
  bills: msg('Bills to pay'),
  invoices: msg('Overdue invoices'),
};

/** A topic in words (English key), also one a newer version saved. */
export function topicLabel(topic: string): string {
  return lookup(TOPIC_LABELS, topic, msg('Other'));
}

export const TOPIC_DESCRIPTIONS: Record<AlertTopic, string> = {
  documents: msg(
    'Civil IDs, residencies, passports, contracts and company licences, at your reminder days and when they expire.',
  ),
  deadlines: msg('PIFSS payments, filings and the other dates of the compliance calendar.'),
  cheques: msg(
    'Cheques to deposit this week or not deposited yet, and cheques you wrote that fall due.',
  ),
  bills: msg('Bills due this week or late.'),
  invoices: msg('Invoices your customers have not paid by their due date.'),
};
