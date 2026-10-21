import { db } from '@/db/db';
import { ApprovalError, applyApproval, decideApproval, decisionUnsent } from '@/db/approvals';
import type { ID } from '@/db/types';
import type { SyncManager } from '@/cloud/manager';
import { t } from '@/i18n';

/** What became of an approval: carried out, or waiting for this device to reach the cloud. */
export type Carried = 'done' | 'waiting';

/**
 * Approves a request. In a company kept in the cloud it is carried out once
 * the cloud has the decision (see decideApproval): the company is synced
 * now, which carries it out. 'waiting' while this device can't reach the
 * cloud: the sync that sends the decision carries it out. Throws when the
 * cloud kept another decision, or the change can't be carried out (the
 * request then stays approved).
 */
export async function approve(id: ID, manager: SyncManager | null, note = ''): Promise<Carried> {
  if (await decideApproval(id, 'approved', note)) return 'done';
  return carryOut(id, manager);
}

/**
 * Carries out an approved request (again), once the cloud has the decision.
 * A company kept on this device carries it out at once.
 */
export async function carryOut(id: ID, manager: SyncManager | null): Promise<Carried> {
  const request = await db.approvals.get(id);
  if (!request) throw new ApprovalError(t('This request has already been decided.'));
  const link = await db.syncState.get(request.companyId);
  if (link && manager) {
    // A sync already running may have started before the decision was saved.
    for (let i = 0; i < 3 && (await decisionUnsent(id)); i++) {
      await manager.syncNow(request.companyId).catch(() => undefined);
    }
  }
  const now = await db.approvals.get(id);
  if (now?.status === 'applied') return 'done';
  if (now?.status !== 'approved') {
    throw new ApprovalError(t('This request was decided on another device meanwhile.'));
  }
  if (link && (await decisionUnsent(id))) {
    const refused = await db.outbox
      .where('[table+id]')
      .equals(['approvals', id])
      .filter((e) => e.parked === 1)
      .count();
    if (refused) {
      throw new ApprovalError(
        t('The cloud did not take this decision. See Settings → Cloud and sync.'),
      );
    }
    return 'waiting';
  }
  // The cloud has it as approved: carried out here (the sync may have tried, and said nothing).
  await applyApproval(id);
  return 'done';
}
