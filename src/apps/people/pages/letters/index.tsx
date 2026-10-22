import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FilePlus2, Files, Mails, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { setLettersOn } from '@/db/letters';
import type { EmployeeLetter, ID } from '@/db/types';
import { useCompany } from '@/app/company';
import { useEmployees } from '@/features/people/hooks';
import {
  pendingByLetter,
  useLetterRequests,
  useLetters,
  useLettersView,
  type LettersView,
} from '@/features/people/letter-hooks';
import { LetterDialog, LetterRequestCard } from '@/features/people/letter-dialog';
import { LettersTable } from '@/features/people/letters-table';
import { useMemberNames } from '@/features/approvals/hooks';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/form';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
} from '@/components/ui/misc';
import { msg, t } from '@/i18n';

type Tab = 'print' | 'drafts' | 'issued' | 'void';

const TABS: { value: Tab; label: string }[] = [
  { value: 'print', label: msg('To print') },
  { value: 'drafts', label: msg('Drafts') },
  { value: 'issued', label: msg('Issued') },
  { value: 'void', label: msg('Void') },
];

const inTab = (letter: EmployeeLetter, tab: Tab) =>
  tab === 'print'
    ? letter.status === 'issued' && !letter.printedAt
    : tab === 'drafts'
      ? letter.status === 'draft'
      : tab === 'issued'
        ? letter.status === 'issued'
        : letter.status === 'void';

/**
 * The letters switch (D1, off until the owner or an admin turns it on),
 * with what the owner should know before.
 */
export function LettersSwitch({ view }: { view: LettersView }) {
  const company = useCompany();
  const [busy, setBusy] = useState(false);
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      await setLettersOn(company.id, on);
      toast.success(on ? t('Employee letters turned on') : t('Employee letters turned off'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={t('Employee letters')}
        description={t(
          'Salary, experience and employment certificates, warning letters and no objection certificates, filled from each employee’s record and printed with the company’s letterhead.',
        )}
      />
      <CardBody className="space-y-4">
        {view.canSwitch ? (
          <Switch
            checked={view.on}
            disabled={busy}
            onChange={(on) => void change(on)}
            label={t('Use employee letters')}
            description={t(
              'Off: nothing changes, as before. On: accountants draft letters and ask for approval; the owner, admins and the members allowed to approve issue them. Each letter gets a number when it is issued (HR-2026-0001, from 1 again each year), which is never used twice.',
            )}
          />
        ) : (
          <p className="text-sm text-slate-600">
            {view.on
              ? t('Employee letters are on. Only the owner or an admin turns them off.')
              : t('Employee letters are off. Ask the owner or an admin to turn them on.')}
          </p>
        )}
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t(
            'Warning letters and no objection certificates have legal weight under the Labour Law: ask your lawyer to check their wording in Letter templates before they are issued. Letters are printed, never emailed, and only the owner, admins and approvers print the company stamp on them.',
          )}
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * People → Letters: the letters to print, drafts (automatic ones too),
 * issued and void letters, and the requests to issue a letter waiting for
 * an approver.
 */
export default function LettersPage() {
  const company = useCompany();
  const navigate = useNavigate();
  const view = useLettersView();
  const letters = useLetters();
  const employees = useEmployees();
  const requests = useLetterRequests();
  const names = useMemberNames(company.id, view.link, Boolean(requests?.length));
  const [params, setParams] = useSearchParams();
  const [chosen, setOpen] = useState<EmployeeLetter | null | 'new'>(null);
  // New letter from the New menu (?new=1), on this page or from another.
  const open = chosen ?? (params.get('new') ? 'new' : null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<ID>>(new Set());

  const byId = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const pending = useMemo(() => pendingByLetter(requests), [requests]);

  if (view.loading || !letters || !employees || !requests) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const counts = Object.fromEntries(
    TABS.map((x) => [x.value, letters.filter((l) => inTab(l, x.value)).length]),
  ) as Record<Tab, number>;
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((x) => x.value === asked)
    ? asked!
    : counts.print > 0
      ? 'print'
      : counts.drafts > 0
        ? 'drafts'
        : 'issued';
  const q = query.trim().toLowerCase();
  const shown = letters.filter((letter) => {
    if (!inTab(letter, tab)) return false;
    if (!q) return true;
    const employee = byId.get(letter.employeeId);
    return `${letter.number} ${employee?.name ?? ''} ${employee?.nameAr ?? ''} ${employee?.number ?? ''}`
      .toLowerCase()
      .includes(q);
  });
  const waiting = requests.filter((r) => r.status === 'pending');
  const printable = (ids: ID[]) =>
    navigate(`/people/letters/print?ids=${ids.map(encodeURIComponent).join(',')}`);
  const picked = shown.filter((l) => selected.has(l.id)).map((l) => l.id);

  const closeDialog = () => {
    setOpen(null);
    if (params.get('new')) {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  };

  return (
    <div>
      <PageHeader
        title={t('Letters')}
        description={t('Letters to and about employees, made from the company’s templates.')}
        actions={
          view.on ? (
            <>
              <ButtonLink to="/people/letters/templates" variant="outline">
                <Files /> {t('Letter templates')}
              </ButtonLink>
              {view.canDraft ? (
                <Button onClick={() => setOpen('new')}>
                  <FilePlus2 /> {t('New letter')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="space-y-6">
        {!view.available ? (
          <Card>
            <EmptyState
              icon={<Mails />}
              title={t('Employee letters')}
              description={t(
                'The cloud needs the latest database script first. Ask the owner of the company to run it.',
              )}
            />
          </Card>
        ) : !view.on ? (
          <LettersSwitch view={view} />
        ) : (
          <>
            {waiting.length > 0 &&
            (view.approver || waiting.some((r) => r.requestedBy === view.link?.userId)) ? (
              <Card>
                <CardHeader
                  title={t('Waiting for approval')}
                  description={
                    view.approver
                      ? t(
                          'Letters accountants asked to issue. Approving issues the letter on this device.',
                        )
                      : t('Letters you asked to issue, until an approver decides.')
                  }
                />
                <ul className="divide-y divide-slate-100">
                  {waiting
                    .filter((r) => view.approver || r.requestedBy === view.link?.userId)
                    .map((request) => (
                      <li key={request.id} className="px-5 py-4">
                        <LetterRequestCard request={request} names={names} showSubject />
                      </li>
                    ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                <Segmented
                  value={tab}
                  onChange={(next) => {
                    setSelected(new Set());
                    setParams({ tab: next }, { replace: true });
                  }}
                  options={TABS.map((x) => ({
                    value: x.value,
                    label: t(x.label),
                    count:
                      x.value === 'print' || x.value === 'drafts' ? counts[x.value] : undefined,
                  }))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('Search by name or number')}
                      aria-label={t('Search letters')}
                      className="w-56 ps-9"
                    />
                  </div>
                  {tab === 'print' && shown.length > 0 ? (
                    <Button
                      variant="outline"
                      onClick={() => printable(picked.length ? picked : shown.map((l) => l.id))}
                    >
                      <Printer /> {picked.length ? t('Print selected') : t('Print all')}
                    </Button>
                  ) : null}
                </div>
              </div>
              {shown.length === 0 ? (
                <EmptyState
                  icon={<Mails />}
                  title={
                    tab === 'print'
                      ? t('Nothing to print')
                      : tab === 'drafts'
                        ? t('No drafts')
                        : tab === 'issued'
                          ? t('No letters issued yet')
                          : t('No void letters')
                  }
                  description={
                    tab === 'print'
                      ? t('Letters show here once they are issued, until they are printed.')
                      : tab === 'drafts'
                        ? t(
                            'Drafts made by hand, and those the templates make when an employee joins, leaves or has their salary changed. A person checks and issues each one.',
                          )
                        : undefined
                  }
                  action={
                    view.canDraft && tab !== 'void' ? (
                      <Button variant="outline" onClick={() => setOpen('new')}>
                        <FilePlus2 /> {t('New letter')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <LettersTable
                  letters={shown}
                  employees={byId}
                  pending={pending}
                  onOpen={(letter) => setOpen(letter)}
                  selected={tab === 'print' ? selected : undefined}
                  onSelect={setSelected}
                />
              )}
            </Card>

            {view.canSwitch ? <LettersSwitch view={view} /> : null}
          </>
        )}
      </div>
      {open && view.on ? (
        <LetterDialog
          letter={open === 'new' ? null : open}
          employeeId={
            open === 'new' && params.get('employee') && byId.has(params.get('employee')!)
              ? params.get('employee')!
              : undefined
          }
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
}
