import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  FileDown,
  Plus,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createQuoteFromCosting, deleteCosting, newCosting, saveCosting } from '@/db/costings';
import type { CostingCategory, CostingPost, CostingRate, StaffingCosting } from '@/db/types';
import {
  COSTING_CATEGORIES,
  COSTING_CATEGORY_LABELS,
  COSTING_RULES,
  COSTING_STATUS_LABELS,
  costingWarningText,
  newPost,
  priceCosting,
} from '@/lib/hr/costing';
import { GCC_COUNTRIES } from '@/lib/hr/employees';
import { countryName } from '@/lib/geo';
import { lookup } from '@/lib/known';
import { buildCostingSheet } from '@/pdf/costing-model';
import { downloadBlob, pdfFileName } from '@/pdf/client';
import { useCompany, useFormat } from '@/app/company';
import {
  customerChoices,
  useClients,
  useCosting,
  useCostingBasis,
  useCostingView,
  useRateCard,
} from '@/features/people/costing-hooks';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { Button, ButtonLink } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { useConfirm } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { marginExplained } from '@/features/people/costing-text';

const STATUSES: StaffingCosting['status'][] = ['draft', 'quoted', 'won', 'lost'];

/**
 * A manpower costing (#3): its customer, posts, overhead and margin, what
 * each post costs and sells for, and what needs a second look; Make quote
 * (sell prices only) and the internal cost sheet (كشف التكلفة), which is
 * downloaded here and never attached to the quote.
 */
export default function CostingEditorPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const view = useCostingView();
  const stored = useCosting(isNew ? undefined : id);
  const clients = useClients();
  const card = useRateCard();
  const basis = useCostingBasis();
  const [draft, setDraft] = useState<StaffingCosting | null>(null);
  const [busy, setBusy] = useState<'save' | 'quote' | 'sheet' | 'delete' | null>(null);
  const fresh = useMemo(
    () =>
      view.loading
        ? null
        : newCosting(
            company.id,
            view.settings,
            params.get('client') ? String(params.get('client')) : null,
          ),
    // A new costing is made once, when the settings are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.loading, company.id],
  );
  const costing = draft ?? (isNew ? fresh : stored);
  const quote = useLiveQuery(
    async () => (costing?.quoteId ? ((await db.documents.get(costing.quoteId)) ?? null) : null),
    [costing?.quoteId],
  );
  const priced = useMemo(
    () => (costing && basis ? priceCosting(costing, basis) : null),
    [costing, basis],
  );
  const allowNavigation = useUnsavedGuard(draft !== null && busy === null);

  if (view.loading || !clients || !card || !basis || (!isNew && stored === undefined)) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!view.available || !view.on || (!isNew && stored === null) || !costing || !priced) {
    return (
      <Card>
        <EmptyState
          icon={<Calculator />}
          title={!isNew && stored === null ? t('Costing not found') : t('Manpower costing is off')}
          description={
            !view.available
              ? t(
                  'The cloud needs the latest database script first. Ask the owner of the company to run it.',
                )
              : undefined
          }
          action={
            <ButtonLink to="/people/costing" variant="outline">
              <ArrowLeft /> {t('Manpower costing')}
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const editable = view.canEdit;
  const edit = (patch: Partial<StaffingCosting>) => setDraft({ ...costing, ...patch });
  const editPost = (i: number, patch: Partial<CostingPost>) =>
    edit({ posts: costing.posts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const addPost = (rate?: CostingRate) => edit({ posts: [...costing.posts, newPost(rate)] });
  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : t('Something went wrong.'));

  const persist = async (): Promise<StaffingCosting> => {
    const saved = await saveCosting(costing);
    setDraft(null);
    return saved;
  };
  const save = async () => {
    setBusy('save');
    try {
      const saved = await persist();
      toast.success(t('Costing saved'));
      if (isNew) {
        allowNavigation();
        navigate(`/people/costing/${saved.id}`, { replace: true });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const makeQuote = async () => {
    if (quote) {
      const ok = await confirm({
        title: t('Make another quote?'),
        description: t(
          'This costing already has quote {number}. A new quote is made at today’s prices, and the costing points to it. {number} stays as it is.',
          { number: quote.number || t('Draft') },
        ),
        confirmLabel: t('Make quote'),
      });
      if (!ok) return;
    }
    setBusy('quote');
    try {
      const saved = draft || isNew ? await persist() : costing;
      const made = await createQuoteFromCosting(saved.id);
      toast.success(
        made.number ? t('Quote {number} made', { number: made.number }) : t('Draft quote made'),
      );
      allowNavigation();
      navigate(`/quotes/${made.id}`);
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };
  const costSheet = async () => {
    setBusy('sheet');
    try {
      const customer = costing.clientId
        ? localName(clients.find((c) => c.id === costing.clientId))
        : '';
      const model = buildCostingSheet({
        costing,
        priced,
        company: {
          name: company.name,
          nameAr: company.nameAr,
          currency: company.currency,
          logo: company.branding.logo,
        },
        customer,
        printedOn: fmt.date(new Date().toISOString().slice(0, 10)),
      });
      const { renderCostingPdf } = await import('@/pdf/costing');
      const blob = await renderCostingPdf(model);
      downloadBlob(blob, pdfFileName(`Cost sheet ${costing.name}`));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('Delete this costing?'),
      description: quote
        ? t('Quote {number} made from it stays as it is.', { number: quote.number || t('Draft') })
        : t('This can’t be undone.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteCosting(costing.id);
      allowNavigation();
      navigate('/people/costing', { replace: true });
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  const totals = priced.totals;
  const customer = clients.find((c) => c.id === costing.clientId);
  // Quotes are in the company's currency, as the costing is.
  const otherCurrency =
    customer?.currency && customer.currency !== company.currency ? customer.currency : null;
  const options = customerChoices(clients, costing.clientId).map((c) => ({
    value: c.id,
    label: localName(c),
    detail: c.number,
    keywords: `${c.name} ${c.nameAr ?? ''}`,
  }));

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/people/costing" className="hover:underline">
            {t('Manpower costing')}
          </Link>
        }
        title={costing.name || t('New costing')}
        actions={
          <>
            {!isNew ? (
              <Button variant="outline" onClick={() => void costSheet()} disabled={busy !== null}>
                <FileDown /> {t('Cost sheet')}
              </Button>
            ) : null}
            {quote ? (
              <ButtonLink to={`/quotes/${quote.id}`} variant="outline">
                <ScrollText /> {t('Quote {number}', { number: quote.number || t('Draft') })}
              </ButtonLink>
            ) : null}
            {editable ? (
              <>
                {view.canQuote ? (
                  <Button
                    variant="outline"
                    onClick={() => void makeQuote()}
                    disabled={busy !== null || costing.posts.length === 0 || !customer}
                  >
                    <ScrollText /> {t('Make quote')}
                  </Button>
                ) : null}
                <Button onClick={() => void save()} disabled={busy !== null}>
                  {t('Save')}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label={t('Name')} hint={t('For the company only, never on the quote.')}>
              {(fid) => (
                <Input
                  id={fid}
                  value={costing.name}
                  disabled={!editable}
                  placeholder={t('For example: Tower A, night shift')}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('Customer')}
              hint={
                !view.canQuote
                  ? t(
                      'The owner has made quotes view only for you (in Maham Books, and Maham Sales when it has its own app), so no quote can be made from the costing. Ask the owner if you need to change it.',
                    )
                  : otherCurrency
                    ? t(
                        'The quote is made in {currency}, the company’s currency, as the costing is, though this customer’s documents are usually in {other}.',
                        { currency: company.currency, other: otherCurrency },
                      )
                    : undefined
              }
            >
              {(fid) => (
                <Combobox
                  id={fid}
                  value={costing.clientId}
                  options={options}
                  disabled={!editable}
                  placeholder={t('Choose a customer')}
                  onChange={(clientId) => edit({ clientId })}
                />
              )}
            </Field>
            <Field
              label={t('Overhead (%)')}
              hint={t('At most {max}%.', { max: COSTING_RULES.maxOverheadPercent })}
            >
              {(fid) => (
                <NumberInput
                  id={fid}
                  value={costing.overheadPercent}
                  allowNegative={false}
                  disabled={!editable}
                  onValueChange={(n) => edit({ overheadPercent: n })}
                />
              )}
            </Field>
            <Field
              label={t('Margin (% of the sell price)')}
              hint={`${t('At most {max}%.', { max: COSTING_RULES.maxMarginPercent })} ${marginExplained(costing.marginPercent)}`}
            >
              {(fid) => (
                <NumberInput
                  id={fid}
                  value={costing.marginPercent}
                  allowNegative={false}
                  disabled={!editable}
                  onValueChange={(n) => edit({ marginPercent: n })}
                />
              )}
            </Field>
            <Field label={t('Status')}>
              {(fid) => (
                <Select
                  id={fid}
                  value={costing.status}
                  disabled={!editable}
                  onChange={(e) => edit({ status: e.target.value as StaffingCosting['status'] })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(lookup(COSTING_STATUS_LABELS, s, COSTING_STATUS_LABELS.draft))}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('Internal notes')} hint={t('Never on the quote.')} optional>
              {(fid) => (
                <Textarea
                  id={fid}
                  value={costing.notes}
                  disabled={!editable}
                  rows={2}
                  onChange={(e) => edit({ notes: e.target.value })}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('Posts')}
            description={t(
              'Pay per person a month. Hours past 8 a day are overtime at 1.25; days past {days} a month are rest days worked, at 1.5.',
              { days: basis.dailyDivisor },
            )}
          />
          {costing.posts.length === 0 ? (
            <EmptyState
              icon={<Calculator />}
              title={t('No posts yet')}
              description={t('Add the posts the customer asks for, from the rate card or by hand.')}
            />
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {priced.posts.map(({ post, perPerson, total, warnings }, i) => (
                <li key={post.id} className="space-y-3 p-4" data-testid="costing-post">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                    <Field label={t('Job title')} className="col-span-2">
                      {(fid) => (
                        <Input
                          id={fid}
                          value={costing.posts[i].jobTitle}
                          disabled={!editable}
                          onChange={(e) => editPost(i, { jobTitle: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('Arabic job title')} className="col-span-2" optional>
                      {(fid) => (
                        <Input
                          id={fid}
                          dir="rtl"
                          value={costing.posts[i].jobTitleAr ?? ''}
                          disabled={!editable}
                          onChange={(e) => editPost(i, { jobTitleAr: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('Category')}>
                      {(fid) => (
                        <Select
                          id={fid}
                          value={post.category ?? 'expat'}
                          disabled={!editable}
                          onChange={(e) =>
                            editPost(i, { category: e.target.value as CostingCategory })
                          }
                        >
                          {COSTING_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {t(COSTING_CATEGORY_LABELS[c])}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {post.category === 'gcc' ? (
                      <Field label={t('Nationality')}>
                        {(fid) => (
                          <Select
                            id={fid}
                            value={costing.posts[i].nationality ?? ''}
                            disabled={!editable}
                            onChange={(e) => editPost(i, { nationality: e.target.value })}
                          >
                            <option value="">{t('Choose…')}</option>
                            {GCC_COUNTRIES.map((c) => (
                              <option key={c} value={c}>
                                {countryName(c, fmt.locale)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    ) : (
                      <div className="hidden lg:block" />
                    )}
                    <NumberField
                      label={t('Headcount')}
                      value={costing.posts[i].headcount}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { headcount: n })}
                    />
                    <NumberField
                      label={t('Hours a day')}
                      value={costing.posts[i].hoursPerDay}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { hoursPerDay: n })}
                    />
                    <NumberField
                      label={t('Days a month')}
                      value={costing.posts[i].daysPerMonth}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { daysPerMonth: n })}
                    />
                    <NumberField
                      label={t('Basic salary')}
                      value={costing.posts[i].basic}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { basic: n })}
                    />
                    <NumberField
                      label={t('Allowances')}
                      value={costing.posts[i].allowances}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { allowances: n })}
                    />
                    <NumberField
                      label={t('Allowances for indemnity')}
                      value={costing.posts[i].eosAllowances ?? costing.posts[i].allowances}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { eosAllowances: n })}
                    />
                    <NumberField
                      label={t('Other costs')}
                      value={costing.posts[i].otherCosts}
                      disabled={!editable}
                      onChange={(n) => editPost(i, { otherCosts: n })}
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
                    <Amount
                      label={t('Overtime')}
                      value={perPerson.overtime + perPerson.restDayPay}
                    />
                    <Amount label={t('Employer PIFSS')} value={perPerson.employerPifss} />
                    <Amount label={t('Indemnity')} value={perPerson.eosi} />
                    <Amount label={t('Leave')} value={perPerson.leave} />
                    <Amount label={t('Cost a person')} value={perPerson.cost} />
                    <Amount label={t('With overhead')} value={perPerson.fullCost} />
                    <Amount label={t('Sell price a person')} value={perPerson.sell} strong />
                    <Amount label={t('A month')} value={total.sell} strong />
                  </dl>
                  {warnings.map((w) => (
                    <p
                      key={w.kind}
                      className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {costingWarningText(w)}
                    </p>
                  ))}
                  {editable ? (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => edit({ posts: costing.posts.filter((_, j) => j !== i) })}
                      >
                        <Trash2 /> {t('Remove post')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editable ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-3">
              <Button size="sm" variant="ghost" onClick={() => addPost()}>
                <Plus /> {t('Add post')}
              </Button>
              {card.rates.length > 0 ? (
                <div className="w-full sm:w-72">
                  <Select
                    value=""
                    aria-label={t('Add from the rate card')}
                    onChange={(e) => {
                      const rate = card.rates.find((r) => r.id === e.target.value);
                      if (rate) addPost(rate);
                    }}
                  >
                    <option value="">{t('Add from the rate card…')}</option>
                    {card.rates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {`${localName({ name: r.jobTitle, nameAr: r.jobTitleAr })} · ${t(COSTING_CATEGORY_LABELS[r.category])}`}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title={t('Totals a month')}
            description={`${t(
              'The quote shows the job titles, hours, days, people and sell prices only. Costs, salaries and the margin stay here.',
            )} ${t('The sell prices are before tax: tax, when the company charges it, is added on top.')}`}
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">{t('Headcount')}</dt>
                <dd className="tabular text-lg font-semibold">{totals.headcount}</dd>
              </div>
              <Amount label={t('Cost a month')} value={totals.cost} big />
              <Amount label={t('Overhead')} value={totals.overhead} big />
              <Amount label={t('Sell price a month')} value={totals.sell} big strong />
              <Amount label={t('Margin')} value={totals.margin} big />
              <div>
                <dt className="text-slate-500">{t('Margin of the sell price')}</dt>
                <dd className="tabular text-lg font-semibold" dir="ltr">
                  {`${totals.marginPercent}%`}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Markup on cost')}</dt>
                <dd className="tabular text-lg font-semibold" dir="ltr">
                  {`${totals.markupPercent}%`}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {editable && !isNew ? (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}>
              <Trash2 /> {t('Delete costing')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      {(fid) => (
        <NumberInput
          id={fid}
          value={value}
          allowNegative={false}
          disabled={disabled}
          onValueChange={onChange}
        />
      )}
    </Field>
  );
}

function Amount({
  label,
  value,
  strong,
  big,
}: {
  label: string;
  value: number;
  strong?: boolean;
  big?: boolean;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={big ? 'text-lg font-semibold' : strong ? 'font-semibold' : undefined}>
        <MoneyText amount={value} />
      </dd>
    </div>
  );
}
