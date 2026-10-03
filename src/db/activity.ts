import { db } from './db';
import type { Activity, ActivityEntity, ID } from './types';
import { newId } from '@/lib/ids';
import { interpolate, t, type Vars } from '@/i18n';

/**
 * What happened, in words. Pass `{ text: msg('Invoice {number} sent'), vars }`
 * so the log can be shown in the reader's language later; a plain string is
 * kept as written.
 */
export type ActivityMessage = string | { text: string; vars?: Vars };

export async function logActivity(
  companyId: ID,
  entity: ActivityEntity,
  entityId: ID,
  action: string,
  message: ActivityMessage,
  refs: { clientId?: ID | null; documentId?: ID | null } = {},
): Promise<void> {
  const activity: Activity = {
    id: newId(),
    companyId,
    at: new Date().toISOString(),
    entity,
    entityId,
    clientId: refs.clientId ?? null,
    documentId: refs.documentId ?? null,
    action,
    message: typeof message === 'string' ? message : interpolate(message.text, message.vars),
    ...(typeof message === 'string'
      ? {}
      : { messageKey: message.text, messageVars: message.vars ?? {} }),
  };
  await db.activities.add(activity);
}

/** An activity's message in the interface language. */
export function activityText(activity: Activity): string {
  return activity.messageKey ? t(activity.messageKey, activity.messageVars) : activity.message;
}

export async function recentActivity(companyId: ID, limit = 20): Promise<Activity[]> {
  return db.activities
    .where('[companyId+at]')
    .between([companyId, ''], [companyId, '￿'])
    .reverse()
    .limit(limit)
    .toArray();
}
