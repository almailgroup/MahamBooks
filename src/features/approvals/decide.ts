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
 * A company kept on this device carries it out at once. In one kept in the
 * cloud, this device's copy may be behind the cloud's (another approver may
 * have rejected it, or carried it out, since): it is carried out only while
 * the cloud has it as approved, and refused while the cloud can't be asked.
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
  if (link) {
    // What the cloud keeps decides, not this device's copy.
    const kept = await keptInCloud(request.companyId, id, manager);
    if (kept !== 'approved') {
      // Its copy is brought here (a sync that can't run leaves it for the next).
      await manager?.syncNow(request.companyId).catch(() => undefined);
      if (kept === 'applied') return 'done';
      throw new ApprovalError(t('This request was decided on another device meanwhile.'));
    }
  }
  await applyApproval(id);
  return 'done';
}

/**
 * The status of a request as the cloud has it now (null: it has none).
 * Throws when the cloud can't be asked.
 */
async function keptInCloud(
  companyId: ID,
  id: ID,
  manager: SyncManager | null,
): Promise<string | null> {
  const unreachable = () =>
    new ApprovalError(
      t(
        'This device can’t reach the cloud, which keeps the last word on this request. Carry it out again once it is online.',
      ),
    );
  if (!manager) throw unreachable();
  const record = await manager.cloudRecord(companyId, 'approvals', id).catch(() => {
    throw unreachable();
  });
  if (!record) return null;
  return typeof record.data.status === 'string' ? record.data.status : 'pending';
}

/**
 * Decides a request that carries nothing out on the approver's device (a pay
 * run's approval, #10: whoever posts the pay run carries it out), and sends
 * the decision to the cloud now. 'waiting' while this device can't reach
 * the cloud. Throws when the cloud refused it (another approver decided
 * first, or the pay run changed since it was sent).
 */
export async function decideAndSend(
  id: ID,
  decision: 'approved' | 'rejected',
  manager: SyncManager | null,
  note = '',
): Promise<Carried> {
  await decideApproval(id, decision, note);
  const request = await db.approvals.get(id);
  const link = request ? await db.syncState.get(request.companyId) : null;
  if (!request || !link) return 'done';
  if (manager) {
    for (let i = 0; i < 3 && (await decisionUnsent(id)); i++) {
      await manager.syncNow(request.companyId).catch(() => undefined);
    }
  }
  if (!(await decisionUnsent(id))) return 'done';
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
