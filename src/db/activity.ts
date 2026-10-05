import { db } from './db';
import type { Activity, ActivityEntity, ID, ISODate } from './types';
import { newId } from '@/lib/ids';
import { currentLanguage, interpolate, t, type Vars } from '@/i18n';

/**
 * What happened, in words. Pass `{ text: msg('Invoice {number} sent'), vars }`
 * so the log can be shown in the reader's language later; a plain string is
 * kept as written. Amounts go in `money` as well as in `vars` (formatted in
 * English for the stored message), so they can be written in the reader's
 * language too, and names that have an Arabic form (an account's, a
 * client's) go in `arabic` as well, for Arabic readers.
 */
export type ActivityMessage =
  | string
  | {
      text: string;
      vars?: Vars;
      money?: Record<string, { amount: number; currency: string }>;
      arabic?: Record<string, string | undefined>;
    };

/** The Arabic names given, without the empty ones. */
function arabicNames(names: Record<string, string | undefined> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names)
      .map(([key, value]) => [key, value?.trim() ?? ''] as const)
      .filter(([, value]) => value !== ''),
  );
}

export async function logActivity(
  companyId: ID,
  entity: ActivityEntity,
  entityId: ID,
  action: string,
  message: ActivityMessage,
  refs: { clientId?: ID | null; documentId?: ID | null; employeeId?: ID | null } = {},
): Promise<void> {
  const activity: Activity = {
    id: newId(),
    companyId,
    at: new Date().toISOString(),
    entity,
    entityId,
    clientId: refs.clientId ?? null,
    documentId: refs.documentId ?? null,
    // About an employee's papers: private, whatever happens to the document.
    ...(refs.employeeId ? { employeeId: refs.employeeId } : {}),
    action,
    message: typeof message === 'string' ? message : interpolate(message.text, message.vars),
    ...(typeof message === 'string'
      ? {}
      : {
          messageKey: message.text,
          messageVars: message.vars ?? {},
          ...(message.money ? { messageMoney: message.money } : {}),
          ...(Object.keys(arabicNames(message.arabic)).length
            ? { messageVarsAr: arabicNames(message.arabic) }
            : {}),
        }),
  };
  await db.activities.add(activity);
}

/** Writes amounts and dates in the reader's language (`useFormat()` gives one). */
export interface ActivityFormat {
  money: (amount: number, currency: string) => string;
  date: (value: ISODate) => string;
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * An activity's message in the interface language, with Arabic names for
 * Arabic readers. With `format`, its amounts and dates are written the
 * reader's way too ("12.500 د.ك").
 */
export function activityText(activity: Activity, format?: ActivityFormat): string {
  const dates = (text: string) => (format ? text.replace(ISO_DATE, (d) => format.date(d)) : text);
  if (!activity.messageKey) return dates(activity.message);
  const vars: Vars = {};
  const names = currentLanguage() === 'ar' ? (activity.messageVarsAr ?? {}) : {};
  for (const [key, value] of Object.entries(activity.messageVars ?? {})) {
    const shown = names[key] ?? value;
    vars[key] = typeof shown === 'string' ? dates(shown) : shown;
  }
  if (format) {
    for (const [key, money] of Object.entries(activity.messageMoney ?? {})) {
      vars[key] = format.money(money.amount, money.currency);
    }
  }
  return t(activity.messageKey, vars);
}

export async function recentActivity(companyId: ID, limit = 20): Promise<Activity[]> {
  return db.activities
    .where('[companyId+at]')
    .between([companyId, ''], [companyId, '￿'])
    .reverse()
    .limit(limit)
    .toArray();
}
