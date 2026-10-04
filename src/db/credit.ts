import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import type { ID } from './types';
import { msg } from '@/i18n';

/**
 * Puts a customer on credit hold (no new invoices or sales orders without
 * an override) or lifts the hold. Logged, so it is clear who was held when.
 */
export async function setCreditHold(clientId: ID, hold: boolean): Promise<void> {
  await db.transaction('rw', [db.clients, db.activities], async () => {
    const client = await db.clients.get(clientId);
    if (!client || Boolean(client.creditHold) === hold) return;
    await db.clients.put({ ...client, creditHold: hold, updatedAt: nowStamp() });
    await logActivity(
      client.companyId,
      'client',
      client.id,
      hold ? 'credit_hold' : 'credit_hold_lifted',
      {
        text: hold ? msg('{name} put on credit hold') : msg('Credit hold lifted for {name}'),
        vars: { name: client.name },
        arabic: { name: client.nameAr },
      },
      { clientId: client.id },
    );
  });
}
