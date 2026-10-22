import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  asksToIssue,
  canDraftLetters,
  canIssueLetters,
  lettersAvailable,
  lettersInEffect,
  listTemplates,
} from '@/db/letters';
import { approverOf } from '@/db/approvals';
import type {
  ApprovalRequest,
  EmployeeLetter,
  ID,
  LetterTemplate,
  PeopleSettings,
} from '@/db/types';
import { useCompany } from '@/app/company';
import { isLetterApproval, switchesLetters } from '@/cloud/roles';
import { useCloudLink } from '@/cloud/hooks';
import type { CloudLink } from '@/cloud/types';
import { usePeopleSettings } from './hooks';

/**
 * Employee letters (#19) for the person on this device: whether the company
 * may use them and has them on, and what the person may do with them.
 */
export interface LettersView {
  /** The company's link to the cloud: null kept on this device, undefined while it is read. */
  link: CloudLink | null | undefined;
  settings: PeopleSettings | undefined;
  /** Still reading the link or the settings. */
  loading: boolean;
  /** The company may use letters (always on this device; in the cloud once its server has them). */
  available: boolean;
  /** Letters are on. */
  on: boolean;
  /** Turns letters on or off: the owner or an admin. */
  canSwitch: boolean;
  /** Makes drafts and templates. */
  canDraft: boolean;
  /** Issues, voids, and lets templates show private details: the owner, an admin or an approver. */
  canIssue: boolean;
  /** Asks an approver to issue (an accountant who isn't one). */
  asks: boolean;
  /** Decides requests to issue a letter. */
  approver: boolean;
}

export function useLettersView(): LettersView {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const settings = usePeopleSettings();
  const known = link !== undefined;
  return {
    link,
    settings,
    loading: !known || settings === undefined,
    available: lettersAvailable(link),
    on: lettersInEffect(settings, link),
    canSwitch: known && switchesLetters(link?.role ?? null),
    canDraft: canDraftLetters(link),
    canIssue: canIssueLetters(link),
    asks: asksToIssue(link),
    approver: known && Boolean(link) && approverOf(link),
  };
}

/** The company's letters, or one employee's, the latest first. */
export function useLetters(employeeId?: ID): EmployeeLetter[] | undefined {
  const company = useCompany();
  return useLiveQuery(async () => {
    const list = employeeId
      ? await db.employeeLetters.where('employeeId').equals(employeeId).toArray()
      : await db.employeeLetters.where('companyId').equals(company.id).toArray();
    return list
      .filter((l) => l.companyId === company.id)
      .sort(
        (a, b) =>
          (b.issuedOn ?? b.createdAt).localeCompare(a.issuedOn ?? a.createdAt) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [company.id, employeeId]);
}

/** The company's templates, stored and default, kept up to date. */
export function useLetterTemplates(): LetterTemplate[] | undefined {
  const company = useCompany();
  return useLiveQuery(() => listTemplates(company.id), [company.id]);
}

/** The company's requests to issue a letter, kept up to date. */
export function useLetterRequests(): ApprovalRequest[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    async () =>
      (await db.approvals.where('companyId').equals(company.id).toArray()).filter(isLetterApproval),
    [company.id],
  );
}

/** The request of each letter still waiting, by letter. */
export function pendingByLetter(requests: readonly ApprovalRequest[] | undefined) {
  return new Map(
    (requests ?? []).filter((r) => r.status === 'pending').map((r) => [r.subjectId, r]),
  );
}
