import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Calculator, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { rateCardFromSalaries, saveCostingSettings, setCostingsOn } from '@/db/costings';
import type { CostingCategory, CostingRate, StaffingCosting } from '@/db/types';
import {
  COSTING_CATEGORIES,
  COSTING_CATEGORY_LABELS,
  COSTING_RULES,
  COSTING_STATUS_LABELS,
  normalizeRate,
} from '@/lib/hr/costing';
import { shortId } from '@/lib/ids';
import { lookup } from '@/lib/known';
import { useCompany, useFormat } from '@/app/company';
import {
  useCostings,
  useCostingView,
  useCustomers,
  useRateCard,
  type CostingView,
} from '@/features/people/costing-hooks';
import {
  COSTING_STATUS_TONES,
  costingMonthly,
  marginExplained,
} from '@/features/people/costing-text';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui/misc';
import { ListCard, ListCards, ResponsiveList } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { useConfirm } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/** The costing switch (D1, off until turned on by the owner, an admin or an accountant). */
function CostingSwitch({ view }: { view: CostingView }) {
  const company = useCompany();
  const [busy, setBusy] = useState(false);
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      await setCostingsOn(company.id, on);
      toast.success(on ? t('Manpower costing turned on') : t('Manpower costing turned off'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={t('Manpower costing')}
        description={t(
          'Price posts of guards, cleaners and other staff from what they cost, with overhead and a margin, and make a quote for the customer with sell prices only.',
        )}
      />
      <CardBody className="space-y-4">
        {view.canEdit ? (
          <Switch
            checked={view.on}
            disabled={busy}
            onChange={(on) => void change(on)}
            label={t('Use manpower costing')}
            description={t(
              'Off: nothing changes, as before. On: the owner, admins and accountants make costings here. Costings, their salaries, costs and margins stay private like payroll: staff and viewers never see them, and the quote shows the sell prices only.',
            )}
          />
        ) : (
          <p className="text-sm text-slate-600">
            {view.on
              ? t('Manpower costing is on.')
              : t(
                  'Manpower costing is off. Ask the owner, an admin or an accountant to turn it on.',
                )}
          </p>
        )}
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t(
            'Hours past 8 a day are priced as overtime at 1.25. A post that needs more than 2 hours of overtime a day is flagged: article 66 of Labour Law 6/2010 allows that only with an exemption. Confirm with counsel before quoting such a post.',
          )}
        </p>
      </CardBody>
    </Card>
  );
}

/** Overhead and margin of new costings. */
function CostingDefaults({ view }: { view: CostingView }) {
  const company = useCompany();
  const [draft, setDraft] = useState<{ overhead: number; margin: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const overhead = draft?.overhead ?? view.settings.overheadPercent;
  const margin = draft?.margin ?? view.settings.marginPercent;
  const save = async () => {
    setBusy(true);
    try {
      await saveCostingSettings(company.id, { overheadPercent: overhead, marginPercent: margin });
      setDraft(null);
      toast.success(t('Saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={t('Overhead and margin')}
        description={t('Used by new costings. Each costing can change them.')}
        actions={
          view.canEdit && draft ? (
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {t('Save changes')}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Overhead (%)')} hint={t('Added to the cost of each post.')}>
            {(id) => (
              <NumberInput
                id={id}
                value={overhead}
                allowNegative={false}
                disabled={!view.canEdit}
                onValueChange={(n) => setDraft({ overhead: n, margin })}
              />
            )}
          </Field>
          <Field
            label={t('Margin (% of the sell price)')}
            hint={t('At most {max}%.', { max: COSTING_RULES.maxMarginPercent })}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={margin}
                allowNegative={false}
                disabled={!view.canEdit}
                onValueChange={(n) => setDraft({ overhead, margin: n })}
              />
            )}
          </Field>
        </div>
        <p className="text-sm text-slate-600">{marginExplained(margin)}</p>
      </CardBody>
    </Card>
  );
}

/** The rate card: pay per job title, pre-filled from the current salaries until saved. */
function RateCard({ view }: { view: CostingView }) {
  const company = useCompany();
  const confirm = useConfirm();
  const card = useRateCard();
  const [draft, setDraft] = useState<CostingRate[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!card) return null;
  const rates = draft ?? card.rates;
  const edit = (i: number, patch: Partial<CostingRate>) =>
    setDraft(rates.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    try {
      await saveCostingSettings(company.id, {
        overheadPercent: view.settings.overheadPercent,
        marginPercent: view.settings.marginPercent,
        rates: rates.map((r) => normalizeRate(r)).filter((r) => r.jobTitle),
      });
      setDraft(null);
      toast.success(t('Rate card saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  const refill = async () => {
    const ok = await confirm({
      title: t('Fill the rate card from the current salaries?'),
      description: t(
        'Each job title gets the average basic salary and allowances of the employees who have it now. The rate card is saved only when you save it.',
      ),
      confirmLabel: t('Fill from salaries'),
    });
    if (ok) setDraft(await rateCardFromSalaries(company.id));
  };
  return (
    <Card>
      <CardHeader
        title={t('Rate card')}
        description={t(
          'The pay of each job title that posts are priced from, per person a month. Costings copy it into their posts, where it can be changed.',
        )}
        actions={
          view.canEdit ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void refill()}>
                <RefreshCw /> {t('Fill from salaries')}
              </Button>
              {draft || card.fromSalaries ? (
                <Button size="sm" onClick={() => void save()} disabled={busy}>
                  {t('Save rate card')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {card.fromSalaries && !draft ? (
        <p className="mx-5 mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t(
            'Worked out on this device from the current salaries: the average of each job title. An average of one person is their salary. Save it to keep it, or change it first.',
          )}
        </p>
      ) : null}
      {rates.length === 0 ? (
        <EmptyState
          icon={<Calculator />}
          title={t('No job titles yet')}
          description={t('Add the job titles you price, or add employees with their job titles.')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-5 py-2 text-start font-medium">{t('Job title')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('Arabic job title')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('Category')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('Basic salary')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('Allowances')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('Other costs')}</th>
                <th className="px-5 py-2 text-end font-medium">{t('Employees')}</th>
                {view.canEdit ? <th className="w-10" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rates.map((rate, i) => (
                <tr key={rate.id}>
                  <td className="px-5 py-2">
                    <Input
                      value={rate.jobTitle}
                      disabled={!view.canEdit}
                      aria-label={t('Job title')}
                      className="min-w-36"
                      onChange={(e) => edit(i, { jobTitle: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={rate.jobTitleAr ?? ''}
                      dir="rtl"
                      disabled={!view.canEdit}
                      aria-label={t('Arabic job title')}
                      className="min-w-32"
                      onChange={(e) => edit(i, { jobTitleAr: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={rate.category}
                      disabled={!view.canEdit}
                      aria-label={t('Category')}
                      className="min-w-32"
                      onChange={(e) => edit(i, { category: e.target.value as CostingCategory })}
                    >
                      {COSTING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(COSTING_CATEGORY_LABELS[c])}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      value={rate.basic}
                      allowNegative={false}
                      disabled={!view.canEdit}
                      aria-label={t('Basic salary')}
                      className="min-w-24"
                      onValueChange={(n) => edit(i, { basic: n })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      value={rate.allowances}
                      allowNegative={false}
                      disabled={!view.canEdit}
                      aria-label={t('Allowances')}
                      className="min-w-24"
                      onValueChange={(n) => edit(i, { allowances: n })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      value={rate.otherCosts ?? 0}
                      allowNegative={false}
                      disabled={!view.canEdit}
                      aria-label={t('Other costs')}
                      className="min-w-24"
                      onValueChange={(n) => edit(i, { otherCosts: n })}
                    />
                  </td>
                  <td className="tabular px-5 py-2 text-end text-slate-500">{rate.count ?? '—'}</td>
                  {view.canEdit ? (
                    <td className="pe-3">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('Remove')}
                        onClick={() => setDraft(rates.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.canEdit ? (
        <div className="border-t border-slate-100 p-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft([
                ...rates,
                { id: shortId(), jobTitle: '', category: 'expat', basic: 0, allowances: 0 },
              ])
            }
          >
            <Plus /> {t('Add a job title')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * People → Manpower costing (تسعير العمالة, #3): the company's costings,
 * their overhead and margin, and the rate card, behind the switch (D1).
 * Private: only owners, admins and accountants open Maham People.
 */
export default function CostingListPage() {
  const view = useCostingView();
  const costings = useCostings();
  const customers = useCustomers();
  const fmt = useFormat();
  const [params] = useSearchParams();
  const quoteIds = useMemo(
    () => (costings ?? []).map((c) => c.quoteId).filter((id): id is string => Boolean(id)),
    [costings],
  );
  const quotes = useLiveQuery(
    async () =>
      new Map(
        (await db.documents.bulkGet(quoteIds))
          .filter((d) => d !== undefined)
          .map((d) => [d!.id, d!.number] as const),
      ),
    [quoteIds.join(',')],
  );

  if (view.loading || !costings || !customers || !quotes) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  // New costing from the New menu.
  if (params.get('new') && view.on && view.canEdit) {
    return <Navigate to="/people/costing/new" replace />;
  }
  const byId = new Map(customers.map((c) => [c.id, c]));
  const customerOf = (c: StaffingCosting) =>
    c.clientId ? localName(byId.get(c.clientId)) || t('A customer no longer here') : '—';
  const statusBadge = (c: StaffingCosting) => (
    <Badge tone={lookup(COSTING_STATUS_TONES, c.status, 'gray')}>
      {t(lookup(COSTING_STATUS_LABELS, c.status, COSTING_STATUS_LABELS.draft))}
    </Badge>
  );

  return (
    <div>
      <PageHeader
        title={t('Manpower costing')}
        description={t(
          'Posts priced from staff cost, with overhead and a margin, and the quotes they make.',
        )}
        actions={
          view.on && view.canEdit ? (
            <ButtonLink to="/people/costing/new">
              <Plus /> {t('New costing')}
            </ButtonLink>
          ) : null
        }
      />
      <div className="space-y-6">
        {!view.available ? (
          <Card>
            <EmptyState
              icon={<Calculator />}
              title={t('Manpower costing')}
              description={t(
                'The cloud needs the latest database script first. Ask the owner of the company to run it.',
              )}
            />
          </Card>
        ) : !view.on ? (
          <CostingSwitch view={view} />
        ) : (
          <>
            <Card>
              {costings.length === 0 ? (
                <EmptyState
                  icon={<Calculator />}
                  title={t('No costings yet')}
                  description={t(
                    'A costing prices the posts a customer asks for: guards, cleaners and other staff, their hours and days. It makes a quote with sell prices only.',
                  )}
                  action={
                    view.canEdit ? (
                      <ButtonLink to="/people/costing/new" variant="outline">
                        <Plus /> {t('New costing')}
                      </ButtonLink>
                    ) : undefined
                  }
                />
              ) : (
                <ResponsiveList
                  table={
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs text-slate-500">
                            <th className="px-5 py-2 text-start font-medium">{t('Costing')}</th>
                            <th className="px-3 py-2 text-start font-medium">{t('Customer')}</th>
                            <th className="px-3 py-2 text-end font-medium">{t('Headcount')}</th>
                            <th className="px-3 py-2 text-end font-medium">
                              {t('Sell price a month')}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">{t('Quote')}</th>
                            <th className="px-5 py-2 text-end font-medium">{t('Status')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {costings.map((c) => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              <td className="px-5 py-2.5">
                                <Link
                                  to={`/people/costing/${c.id}`}
                                  className="text-primary-700 font-medium hover:underline"
                                  dir="auto"
                                >
                                  {c.name}
                                </Link>
                                <span className="block text-xs text-slate-500">
                                  {fmt.date(c.updatedAt.slice(0, 10))}
                                </span>
                              </td>
                              <td className="px-3 py-2.5" dir="auto">
                                {customerOf(c)}
                              </td>
                              <td className="tabular px-3 py-2.5 text-end">
                                {c.posts.reduce((s, p) => s + p.headcount, 0)}
                              </td>
                              <td className="px-3 py-2.5 text-end">
                                <MoneyText amount={costingMonthly(c)} />
                              </td>
                              <td className="px-3 py-2.5" dir="ltr">
                                {c.quoteId && quotes.get(c.quoteId) !== undefined
                                  ? quotes.get(c.quoteId) || t('Draft')
                                  : '—'}
                              </td>
                              <td className="px-5 py-2.5 text-end">{statusBadge(c)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  }
                  cards={
                    <ListCards>
                      {costings.map((c) => (
                        <ListCard
                          key={c.id}
                          to={`/people/costing/${c.id}`}
                          title={c.name}
                          subtitle={customerOf(c)}
                          amount={<MoneyText amount={costingMonthly(c)} />}
                          status={statusBadge(c)}
                        />
                      ))}
                    </ListCards>
                  }
                />
              )}
            </Card>
            <CostingDefaults view={view} />
            <RateCard view={view} />
            {view.canEdit ? <CostingSwitch view={view} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
