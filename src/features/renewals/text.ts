import type { Company, Employee } from '@/db/types';
import { DOCUMENT_TYPES, OWNER_LABELS, type RegisterEntry } from '@/lib/compliance';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/** "Today", "In 5 days" or "3 days ago". */
export function daysText(daysLeft: number): string {
  if (daysLeft === 0) return t('Today');
  if (daysLeft > 0) return tp(daysLeft, 'In {count} day', 'In {count} days');
  return tp(-daysLeft, '{count} day ago', '{count} days ago');
}

/** A register entry's name: its own title or the document type. */
export function entryTitle(entry: Pick<RegisterEntry, 'title' | 'type'>): string {
  return entry.title.trim() || t(DOCUMENT_TYPES[entry.type].label);
}

/** Who a document belongs to, in the interface language. */
export function entryOwner(
  entry: Pick<RegisterEntry, 'ownerType' | 'ownerName' | 'employeeId'>,
  employees: Map<string, Employee>,
  company: Company,
): string {
  if (entry.ownerType === 'employee') {
    return localName(employees.get(entry.employeeId ?? '')) || t(OWNER_LABELS.employee);
  }
  if (entry.ownerType === 'company') return localName(company);
  return entry.ownerName || t(OWNER_LABELS[entry.ownerType]);
}

/** "Expires today" or "Expires in 12 days". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return t('Expires today');
  return tp(daysLeft, 'Expires in {count} day', 'Expires in {count} days');
}
