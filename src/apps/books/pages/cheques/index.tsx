import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Banknote,
  CircleDollarSign,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteSecurityCheque } from '@/db/cheques';
import type { ChequeDetails, Client, Payment, SecurityCheque } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  bankName,
  chequePayments,
  daysToMaturity,
  isOpenCheque,
  matchesChequeFilter,
  maturity,
  paymentMinor,
  sortCheques,
  type ChequeFilter,
  type MaturityBucket,
} from '@/lib/cheques';
import { printedLeafChanged } from '@/lib/cheque-print';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { securityChequeStatusMeta } from '@/lib/status';
import { cn } from '@/lib/cn';
import { currentLanguage, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { PaymentStatusBadge } from '@/apps/books/features/payments/status-badge';
import {
  ChequeActionDialog,
  ChequeActionsMenu,
  type ChequeAction,
} from '@/apps/books/features/cheques/action-dialogs';
import {
  CashSecurityDialog,
  GiveBackDialog,
  SecurityChequeDialog,
} from '@/apps/books/features/cheques/security-dialogs';
import {
  CHEQUE_FILTERS,
  filterLabel,
  maturityText,
  registerFilter,
  registerTab,
  type RegisterTab,
} from '@/apps/books/features/cheques/register';
import type { ApprovalRequest } from '@/db/types';
import { ChequeConfirmationRequiredError } from '@/db/cheque-rules';
import { requestChequeConfirmation } from '@/db/cheque-approvals';
import {
  useApprovalView,
  useChequeView,
  useMemberNames,
  useMyName,
  usePendingChequeRequests,
} from '@/features/approvals/hooks';
import { ChequeRequestCard } from '@/features/approvals/cheque-request-card';
import { onRegisterTab } from '@/features/approvals/cheque-changes';

type ChequePayment = Payment & { cheque: ChequeDetails };

function Tile({
  label,
  bucket,
  danger,
  money,
}: {
  label: string;
  bucket: MaturityBucket;
  danger?: boolean;
  money: (minor: number) => string;
}) {
  const alert = danger && bucket.count > 0;
  return (
    <Card className={cn('p-4', alert && 'border-red-200 bg-red-50/60')}>
      <p className={cn('text-sm font-medium', alert ? 'text-red-700' : 'text-slate-500')}>
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 text-xl font-semibold tracking-tight',
          alert ? 'text-red-700' : 'text-slate-900',
        )}
      >
        {money(bucket.amount)}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {tp(bucket.count, '{count} cheque', '{count} cheques')}
      </p>
    </Card>
  );
}

/** Cheques waiting for an approver's confirmation (#9): not in the books until confirmed. */
function WaitingList({
  requests,
  clients,
  names,
  approver,
  userId,
}: {
  requests: ApprovalRequest[];
  clients: Map<string, Client>;
  names: Map<string, string>;
  approver: boolean;
  userId: string | null;
}) {
  if (requests.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-slate-500">
        {t('Nothing is waiting for confirmation.')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {[...requests]
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
        .map((request) => (
          <li key={request.id} className="px-5 py-4">
            <ChequeRequestCard
              request={request}
              clients={clients}
              names={names}
              approver={approver}
              userId={userId}
              showSubject
            />
          </li>
        ))}
    </ul>
  );
}

export default function ChequeRegisterPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = registerTab(params.get('tab'));
  const filter = registerFilter(params.get('filter'));
  // Cheques waiting for an approver's confirmation, on their own (#9).
  const pendingView = params.get('filter') === 'pending';
  const chequeView = useChequeView(company);
  const approvalView = useApprovalView(company);
  const waiting = usePendingChequeRequests(company.id);
  const names = useMemberNames(company.id, approvalView.link, (waiting?.length ?? 0) > 0);
  const myName = useMyName();
  // "?q=" from search opens the register searched for one cheque ("&all=1": not
  // only those held), also when the register is open already: taken into the
  // search box each time it comes, then dropped from the address (below).
  const linkedQuery = params.get('q');
  const linkedAll = params.get('all') === '1';
  const [query, setQuery] = useState(() => linkedQuery ?? '');
  const [applied, setApplied] = useState(linkedQuery);
  const [action, setAction] = useState<{ action: ChequeAction; payment: ChequePayment } | null>(
    null,
  );
  const [security, setSecurity] = useState<
    | { kind: 'edit'; cheque: SecurityCheque | null }
    | { kind: 'give'; cheque: SecurityCheque }
    | { kind: 'cash'; cheque: SecurityCheque }
    | null
  >(null);
  const [showAllSecurity, setShowAllSecurity] = useState(linkedAll);
  if (linkedQuery !== applied) {
    setApplied(linkedQuery);
    if (linkedQuery !== null) {
      setQuery(linkedQuery);
      setShowAllSecurity(linkedAll);
    }
  }
  useEffect(() => {
    if (linkedQuery === null) return;
    setParams(
      (p) => {
        p.delete('q');
        p.delete('all');
        return p;
      },
      { replace: true },
    );
  }, [linkedQuery, setParams]);

  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const securityCheques = useLiveQuery(
    () => db.securityCheques.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const [now] = useState(today);
  const precision = currencyPrecision(company.currency);
  const companyMoney = (minor: number) => fmt.money(fromMinor(minor, precision), company.currency);
  const language = currentLanguage();

  const setView = (patch: { tab?: RegisterTab; filter?: ChequeFilter | 'pending' }) => {
    const next = new URLSearchParams(params);
    if (patch.tab) next.set('tab', patch.tab);
    if (patch.filter) next.set('filter', patch.filter);
    setParams(next, { replace: true });
  };

  const byClient = useMemo(
    () => new Map<string, Client>((clients ?? []).map((c) => [c.id, c])),
    [clients],
  );

  const received = useMemo(() => chequePayments(payments ?? [], 'in'), [payments]);
  const issued = useMemo(() => chequePayments(payments ?? [], 'out'), [payments]);
  const list = tab === 'issued' ? issued : received;

  const strip = maturity(
    list.map((p) => ({
      date: p.cheque.date,
      status: p.cheque.status,
      amount: paymentMinor(p, company.currency, precision),
    })),
    now,
  );

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered = list.filter((p) => {
      if (!matchesChequeFilter(p.cheque, filter, now)) return false;
      if (!q) return true;
      const client = byClient.get(p.clientId);
      return `${p.cheque.number} ${p.cheque.drawer} ${p.number} ${client?.name ?? ''} ${client?.nameAr ?? ''} ${bankName(p.cheque.bank, language)} ${p.cheque.bank}`
        .toLowerCase()
        .includes(q);
    });
    return sortCheques(filtered, filter);
  }, [list, filter, now, q, byClient, language]);

  const securityRows = useMemo(() => {
    return (securityCheques ?? [])
      .filter((s) => showAllSecurity || s.status === 'held')
      .filter((s) => {
        if (!q) return true;
        const client = s.clientId ? byClient.get(s.clientId) : undefined;
        return `${s.number} ${s.drawer} ${s.purpose} ${client?.name ?? ''} ${client?.nameAr ?? ''} ${bankName(s.bank, language)}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt));
  }, [securityCheques, showAllSecurity, q, byClient, language]);

  if (!payments || !clients || !securityCheques || !waiting) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  const waitingHere = waiting.filter((r) => onRegisterTab(r, tab));
  // Cheques with a change (or their deletion) waiting for confirmation.
  const waitingOn = new Set(waiting.map((r) => r.subjectId));
  const showWaiting = chequeView.on || waitingHere.length > 0;
  const waitingList = (
    <WaitingList
      requests={waitingHere}
      clients={byClient}
      names={names}
      approver={approvalView.approver}
      userId={approvalView.link?.userId ?? null}
    />
  );
  const waitingLink =
    waitingHere.length > 0 ? (
      <Button variant="outline" size="sm" onClick={() => setView({ filter: 'pending' })}>
        {t('Waiting for confirmation')} ({waitingHere.length})
      </Button>
    ) : null;

  const openCount = (items: ChequePayment[]) =>
    items.filter((p) => isOpenCheque(p.cheque.status)).length;
  const heldSecurity = securityCheques.filter((s) => s.status === 'held');
  const heldTotal = heldSecurity
    .filter((s) => s.currency === company.currency)
    .reduce((sum, s) => sum + paymentMinor(s, company.currency, precision), 0);
  const rowsTotal = rows
    .filter((p) => !p.voided)
    .reduce((sum, p) => sum + paymentMinor(p, company.currency, precision), 0);

  const newAction =
    tab === 'security' ? (
      <Button onClick={() => setSecurity({ kind: 'edit', cheque: null })}>
        <Plus /> {t('Add security cheque')}
      </Button>
    ) : (
      <ButtonLink
        to={tab === 'issued' ? '/payments-made/new?method=cheque' : '/payments/new?method=cheque'}
      >
        <Plus /> {tab === 'issued' ? t('Record cheque issued') : t('Record cheque received')}
      </ButtonLink>
    );

  const partyName = (p: Payment) => {
    const client = byClient.get(p.clientId);
    return client ? localName(client) : '';
  };

  const removeSecurity = async (cheque: SecurityCheque) => {
    const ok = await confirm({
      title: t('Delete security cheque {number}?', { number: cheque.number }),
      description: t('Use this only for a cheque entered by mistake.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSecurityCheque(cheque.id);
      toast.success(t('Security cheque {number} deleted', { number: cheque.number }));
    } catch (error) {
      if (error instanceof ChequeConfirmationRequiredError) {
        // One given out is deleted once an approver confirms it.
        try {
          await requestChequeConfirmation(error.ask, { byName: myName });
          toast.success(t('Sent for confirmation'));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('Something went wrong.'));
        }
        return;
      }
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    }
  };

  return (
    <div>
      <PageHeader
        title={t('Cheques')}
        description={t('Post-dated cheques received and issued, and security cheques you hold.')}
        actions={
          <>
            {tab === 'issued' && company.chequePrinting ? (
              <ButtonLink variant="outline" to="/cheques/layouts">
                <LayoutTemplate /> {t('Cheque layouts')}
              </ButtonLink>
            ) : null}
            <ButtonLink
              variant="outline"
              to={`/cheques/print?tab=${tab}&filter=${filter}${tab === 'security' && showAllSecurity ? '&all=1' : ''}`}
            >
              <Printer /> {t('Print')}
            </ButtonLink>
            {newAction}
          </>
        }
      />

      <Segmented
        className="mb-5"
        value={tab}
        onChange={(value) => setView({ tab: value })}
        options={[
          { value: 'received', label: t('Cheques received'), count: openCount(received) },
          { value: 'issued', label: t('Cheques issued'), count: openCount(issued) },
          { value: 'security', label: t('Security cheques'), count: heldSecurity.length },
        ]}
      />

      {tab !== 'security' ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={tab === 'issued' ? t('Past date, not cleared') : t('Overdue to deposit')}
              bucket={strip.overdue}
              danger
              money={companyMoney}
            />
            <Tile label={t('Due today')} bucket={strip.today} money={companyMoney} />
            <Tile label={t('Next 7 days')} bucket={strip.week} money={companyMoney} />
            <Tile label={t('Next 30 days')} bucket={strip.month} money={companyMoney} />
          </div>

          {list.length === 0 && !pendingView ? (
            <Card>
              <EmptyState
                icon={<Banknote />}
                title={tab === 'issued' ? t('No cheques issued yet') : t('No cheques received yet')}
                description={
                  tab === 'issued'
                    ? t('Pay a bill by cheque to follow it here until the vendor presents it.')
                    : t(
                        'Record a payment by cheque to follow it here until it clears. Post-dated cheques show when they can be deposited.',
                      )
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {newAction}
                    {waitingLink}
                  </div>
                }
              />
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
                <Segmented
                  size="sm"
                  value={pendingView ? 'pending' : filter}
                  onChange={(value) => setView({ filter: value })}
                  options={[
                    ...CHEQUE_FILTERS.map((f) => ({
                      value: f as ChequeFilter | 'pending',
                      label: filterLabel(f, tab),
                    })),
                    ...(showWaiting
                      ? [
                          {
                            value: 'pending' as const,
                            label: t('Waiting for confirmation'),
                            count: waitingHere.length,
                          },
                        ]
                      : []),
                  ]}
                />
                <div className="relative lg:w-72">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('Search cheques…')}
                    className="ps-9"
                    aria-label={t('Search cheques')}
                  />
                </div>
              </div>
              {pendingView ? (
                waitingList
              ) : rows.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-slate-500">
                  {t('No cheques match.')}
                </p>
              ) : (
                <>
                  {/* Phones: one card per cheque. */}
                  <ul className="divide-y divide-slate-100 md:hidden">
                    {rows.map((p) => (
                      <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span dir="ltr" className="font-medium text-slate-900">
                              {p.cheque.number}
                            </span>
                            <PaymentStatusBadge payment={p} />
                          </div>
                          <p dir="auto" className="truncate text-sm text-slate-600">
                            {p.cheque.drawer || partyName(p)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {fmt.date(p.cheque.date)} · {maturityText(p.cheque, now)}
                            {p.cheque.bank ? ` · ${bankName(p.cheque.bank, language)}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              'tabular text-sm font-medium',
                              p.voided ? 'text-slate-500 line-through' : 'text-slate-900',
                            )}
                          >
                            {fmt.money(p.amount, p.currency)}
                          </span>
                          <ChequeActionsMenu
                            payment={p}
                            onAction={(a) => setAction({ action: a, payment: p })}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* Wider screens: the register as a table. */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                          <th className="px-5 py-3 text-start">{t('Cheque date')}</th>
                          <th className="px-3 py-3 text-start">{t('Number')}</th>
                          <th className="px-3 py-3 text-start">{t('Bank')}</th>
                          <th className="px-3 py-3 text-start">
                            {tab === 'issued' ? t('Payee') : t('Drawer')}
                          </th>
                          <th className="px-3 py-3 text-end">{t('Amount')}</th>
                          <th className="px-3 py-3 text-start">{t('Status')}</th>
                          <th className="px-3 py-3 text-start">{t('Days to maturity')}</th>
                          <th className="w-12 px-3 py-3">
                            <span className="sr-only">{t('Actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((p) => {
                          const days = daysToMaturity(p.cheque.date, now);
                          const late = p.cheque.status === 'held' && days < 0;
                          return (
                            <tr key={p.id} className="hover:bg-slate-50/60">
                              <td className="px-5 py-3 whitespace-nowrap text-slate-700">
                                {fmt.date(p.cheque.date)}
                              </td>
                              <td className="px-3 py-3">
                                <span dir="ltr" className="font-medium text-slate-900">
                                  {p.cheque.number}
                                </span>
                                <Link
                                  to={`${tab === 'issued' ? '/payments-made' : '/payments'}/${p.id}`}
                                  className="hover:text-primary-700 block text-xs text-slate-500"
                                >
                                  {p.number}
                                </Link>
                              </td>
                              <td className="max-w-40 truncate px-3 py-3 text-slate-600">
                                {p.cheque.bank ? bankName(p.cheque.bank, language) : '—'}
                              </td>
                              <td className="max-w-52 px-3 py-3 text-slate-700">
                                <span dir="auto" className="block truncate">
                                  {p.cheque.drawer || partyName(p) || '—'}
                                </span>
                                {p.cheque.drawer &&
                                partyName(p) &&
                                p.cheque.drawer !== partyName(p) ? (
                                  <span
                                    dir="auto"
                                    className="block truncate text-xs text-slate-500"
                                  >
                                    {partyName(p)}
                                  </span>
                                ) : null}
                              </td>
                              <td
                                className={cn(
                                  'tabular px-3 py-3 text-end font-medium whitespace-nowrap',
                                  p.voided ? 'text-slate-500 line-through' : 'text-slate-900',
                                )}
                              >
                                {fmt.money(p.amount, p.currency)}
                              </td>
                              <td className="px-3 py-3">
                                <PaymentStatusBadge payment={p} />
                                {p.cheque.status === 'returned' && p.cheque.returnReason ? (
                                  <span className="mt-0.5 block max-w-40 truncate text-xs text-slate-500">
                                    {p.cheque.returnReason}
                                  </span>
                                ) : null}
                                {p.cheque.replacedById ? (
                                  <span className="mt-0.5 block text-xs text-slate-500">
                                    {t('Replaced')}
                                  </span>
                                ) : null}
                                {waitingOn.has(p.id) ? (
                                  <span className="mt-0.5 block text-xs font-medium text-amber-700">
                                    {t('Waiting for confirmation')}
                                  </span>
                                ) : null}
                                {p.cheque.printedAt ? (
                                  p.cheque.status === 'held' && printedLeafChanged(p) ? (
                                    <span className="mt-0.5 block text-xs font-medium text-amber-700">
                                      {t('Changed after printing')}
                                    </span>
                                  ) : (
                                    <span className="mt-0.5 block text-xs text-slate-500">
                                      {t('Printed')}
                                    </span>
                                  )
                                ) : null}
                              </td>
                              <td
                                className={cn(
                                  'px-3 py-3 whitespace-nowrap',
                                  late ? 'font-medium text-red-600' : 'text-slate-600',
                                )}
                              >
                                {maturityText(p.cheque, now)}
                              </td>
                              <td className="px-3 py-3 text-end">
                                <ChequeActionsMenu
                                  payment={p}
                                  onAction={(a) => setAction({ action: a, payment: p })}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {pendingView ? (
                <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                  {t(
                    'Not in the books, the invoices and bills or the totals above until confirmed.',
                  )}
                </p>
              ) : (
                <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                  <span>{tp(rows.length, '{count} cheque', '{count} cheques')}</span>
                  <span>
                    {t('Total')}{' '}
                    <strong className="tabular text-slate-900">{companyMoney(rowsTotal)}</strong>
                  </span>
                </div>
              )}
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <ShieldCheck className="size-4 text-amber-500" aria-hidden />
              {t('Held as security')}
            </span>
            <strong className="tabular text-lg text-slate-900">{companyMoney(heldTotal)}</strong>
            <span className="text-slate-500">
              {tp(heldSecurity.length, '{count} cheque', '{count} cheques')}
            </span>
            <span className="text-slate-500 sm:ms-auto">{t('Not in the books until cashed.')}</span>
          </Card>
          {securityCheques.length === 0 && !pendingView ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck />}
                title={t('No security cheques')}
                description={t(
                  'Keep guarantee cheques here, such as rent deposits. They stay off the books, and only become a payment if you cash them.',
                )}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {newAction}
                    {waitingLink}
                  </div>
                }
              />
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                <Segmented
                  size="sm"
                  value={pendingView ? 'pending' : showAllSecurity ? 'all' : 'held'}
                  onChange={(value) => {
                    if (value === 'pending') {
                      setView({ filter: 'pending' });
                      return;
                    }
                    if (pendingView) {
                      setParams(
                        (p) => {
                          p.delete('filter');
                          return p;
                        },
                        { replace: true },
                      );
                    }
                    setShowAllSecurity(value === 'all');
                  }}
                  options={[
                    { value: 'held', label: t('Held') },
                    { value: 'all', label: t('All') },
                    ...(showWaiting
                      ? [
                          {
                            value: 'pending' as const,
                            label: t('Waiting for confirmation'),
                            count: waitingHere.length,
                          },
                        ]
                      : []),
                  ]}
                />
                <div className="relative sm:w-72">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('Search cheques…')}
                    className="ps-9"
                    aria-label={t('Search cheques')}
                  />
                </div>
              </div>
              {pendingView ? (
                waitingList
              ) : securityRows.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-slate-500">
                  {t('No cheques match.')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {securityRows.map((s) => {
                    const meta = securityChequeStatusMeta(s.status);
                    const client = s.clientId ? byClient.get(s.clientId) : undefined;
                    return (
                      <li
                        key={s.id}
                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span dir="ltr" className="font-medium text-slate-900">
                              {s.number}
                            </span>
                            <Badge tone={meta.tone}>{t(meta.label)}</Badge>
                            {s.direction === 'out' ? <Badge>{t('Given')}</Badge> : null}
                            {waitingOn.has(s.id) ? (
                              <Badge tone="amber">{t('Waiting for confirmation')}</Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-sm text-slate-700">
                            <bdi>{s.drawer || (client ? localName(client) : '—')}</bdi>
                            {s.purpose ? (
                              <span className="text-slate-500"> · {s.purpose}</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500">
                            {s.date ? fmt.date(s.date) : t('Undated')}
                            {s.bank ? ` · ${bankName(s.bank, language)}` : ''}
                            {s.status === 'returned' && s.returnedOn
                              ? ` · ${t('Given back on {date}', { date: fmt.date(s.returnedOn) })}`
                              : ''}
                            {s.status === 'cashed' && s.cashedOn
                              ? ` · ${t('Cashed on {date}', { date: fmt.date(s.cashedOn) })}`
                              : ''}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end">
                          <span className="tabular font-medium text-slate-900">
                            {fmt.money(s.amount, s.currency)}
                          </span>
                          <DropdownMenu>
                            <DropdownTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('Actions for cheque {number}', { number: s.number })}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownTrigger>
                            <DropdownContent>
                              {s.status === 'held' ? (
                                <>
                                  <DropdownItem
                                    icon={<CircleDollarSign />}
                                    onSelect={() => setSecurity({ kind: 'cash', cheque: s })}
                                  >
                                    {t('Mark cashed')}
                                  </DropdownItem>
                                  <DropdownItem
                                    icon={<Undo2 />}
                                    onSelect={() => setSecurity({ kind: 'give', cheque: s })}
                                  >
                                    {s.direction === 'out'
                                      ? t('Mark given back to us')
                                      : t('Give back to the drawer')}
                                  </DropdownItem>
                                  <DropdownItem
                                    icon={<Pencil />}
                                    onSelect={() => setSecurity({ kind: 'edit', cheque: s })}
                                  >
                                    {t('Edit')}
                                  </DropdownItem>
                                  <DropdownSeparator />
                                  <DropdownItem
                                    icon={<Trash2 />}
                                    danger
                                    onSelect={() => void removeSecurity(s)}
                                  >
                                    {t('Delete')}
                                  </DropdownItem>
                                </>
                              ) : s.paymentId ? (
                                <DropdownItem
                                  icon={<Banknote />}
                                  onSelect={() =>
                                    navigate(
                                      `${s.direction === 'out' ? '/payments-made' : '/payments'}/${s.paymentId}`,
                                    )
                                  }
                                >
                                  {t('Open the payment')}
                                </DropdownItem>
                              ) : (
                                <DropdownItem disabled>{t('No actions')}</DropdownItem>
                              )}
                            </DropdownContent>
                          </DropdownMenu>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      {action ? (
        <ChequeActionDialog
          action={action.action}
          payment={action.payment}
          onClose={() => setAction(null)}
        />
      ) : null}
      {security?.kind === 'edit' ? (
        <SecurityChequeDialog cheque={security.cheque} onClose={() => setSecurity(null)} />
      ) : null}
      {security?.kind === 'give' ? (
        <GiveBackDialog cheque={security.cheque} onClose={() => setSecurity(null)} />
      ) : null}
      {security?.kind === 'cash' ? (
        <CashSecurityDialog
          cheque={security.cheque}
          onClose={() => setSecurity(null)}
          onCashed={() =>
            setView({ tab: security.cheque.direction === 'out' ? 'issued' : 'received' })
          }
        />
      ) : null}
    </div>
  );
}
