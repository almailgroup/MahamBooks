import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  approverOf,
  rulesInEffect,
  voidsInsteadOfDeleting,
  waitsForApproval,
} from '@/db/approvals';
import { chequeWaits, isChequeRequest } from '@/db/cheque-rules';
import type { ApprovalRequest, ApprovalRules, Company, InvoiceDocument } from '@/db/types';
import { useCloudLink } from '@/cloud/hooks';
import { useRuntimeStatus } from '@/cloud/status';
import { useCloud } from '@/cloud/store';
import type { CloudLink } from '@/cloud/types';

/** The company's approval rules and the person's place in them. */
export interface ApprovalView {
  /** The company's link to the cloud: null kept on this device, undefined while it is read. */
  link: CloudLink | null | undefined;
  /** The rules in effect (none for a company kept on this device only). */
  rules: ApprovalRules | null;
  /** The person decides requests (the owner, or someone the owner allowed). */
  approver: boolean;
  /** Changes of this issued document wait for an approver, for this person. */
  waits: (doc: Pick<InvoiceDocument, 'type' | 'status'>) => boolean;
  /** The rules void this document instead of deleting it. */
  voidsInstead: (doc: Pick<InvoiceDocument, 'type' | 'status'>) => boolean;
}

export function useApprovalView(company: Pick<Company, 'id' | 'approvalRules'>): ApprovalView {
  const link = useCloudLink(company.id);
  const rules = rulesInEffect(company, link);
  return {
    link,
    rules,
    approver: link !== undefined && approverOf(link),
    // Until the link is read nothing is said to wait: the save says so anyway.
    waits: (doc) => link !== undefined && waitsForApproval(company, link, doc),
    voidsInstead: (doc) => voidsInsteadOfDeleting(company, link, doc),
  };
}

/** The company's cheque rules (#9) and the person's place in them. */
export interface ChequeView {
  /** The rules cover some cheques (Settings → Approvals → Cheques). */
  on: boolean;
  /** The person confirms cheques (the owner, or someone the owner allowed). */
  approver: boolean;
  /** Storing `after` over `before` waits for an approver's confirmation, for this person. */
  waits: (
    table: 'payments' | 'securityCheques',
    before: object | null | undefined,
    after: object | null | undefined,
  ) => boolean;
}

export function useChequeView(company: Pick<Company, 'id' | 'approvalRules'>): ChequeView {
  const link = useCloudLink(company.id);
  const cheques = rulesInEffect(company, link)?.cheques;
  return {
    on: Boolean(cheques && (cheques.issued || cheques.received || cheques.securityOut)),
    approver: link !== undefined && approverOf(link),
    waits: (table, before, after) => chequeWaits(company, link, table, before, after),
  };
}

/** The company's cheque requests waiting for confirmation, kept up to date. */
export function usePendingChequeRequests(companyId: string): ApprovalRequest[] | undefined {
  return useLiveQuery(
    async () =>
      (
        await db.approvals.where('[companyId+status]').equals([companyId, 'pending']).toArray()
      ).filter(isChequeRequest),
    [companyId],
  );
}

/**
 * Whether this device has caught up with the cloud since the app started
 * (always, for a company kept on this device): requests are expired only
 * then, as one this device still has waiting may have been decided on
 * another device meanwhile.
 */
export function useCaughtUp(companyId: string): boolean {
  const link = useCloudLink(companyId);
  const runtime = useRuntimeStatus(companyId);
  return (
    link === null || (link !== undefined && link.status === 'ready' && runtime.syncedOnce === true)
  );
}

/**
 * Whether a decision made on this device hasn't reached the cloud yet: an
 * approval is carried out once it has (see decideApproval).
 */
export function useDecisionUnsent(id: string): boolean {
  return (
    useLiveQuery(
      async () => (await db.outbox.where('[table+id]').equals(['approvals', id]).count()) > 0,
      [id],
    ) ?? false
  );
}

/** The request waiting on a record, kept up to date. */
export function usePendingRequest(subjectId: string | undefined): ApprovalRequest | undefined {
  return useLiveQuery(
    async () =>
      subjectId
        ? db.approvals
            .where('subjectId')
            .equals(subjectId)
            .filter((r) => r.status === 'pending')
            .first()
        : undefined,
    [subjectId],
  );
}

/** The company's requests waiting for a decision, kept up to date. */
export function usePendingRequests(companyId: string): ApprovalRequest[] | undefined {
  return useLiveQuery(
    () => db.approvals.where('[companyId+status]').equals([companyId, 'pending']).toArray(),
    [companyId],
  );
}

/**
 * Names of the company's members by account, from the cloud when it can be
 * asked (the requests keep the name of whoever asked for the rest).
 */
export function useMemberNames(
  companyId: string,
  link: CloudLink | null | undefined,
  /** Asked only when there is someone to name. */
  wanted = true,
) {
  const { api, user } = useCloud();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const signedIn = Boolean(link && user && user.id === link.userId);
  useEffect(() => {
    if (!api || !signedIn || !wanted) return;
    let cancelled = false;
    api
      .companyTeam(companyId)
      .then((team) => {
        if (!cancelled) {
          setNames(new Map(team.map((m) => [m.userId, m.fullName || m.email])));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, companyId, signedIn, wanted]);
  return names;
}

/** The name the team knows the person by, to keep with what they ask. */
export function useMyName(): string {
  const { user } = useCloud();
  return user ? user.fullName || user.email : '';
}
