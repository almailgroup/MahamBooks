import { db } from './db';
import { nowStamp } from './defaults';
import { logActivity } from './activity';
import { getPeopleSettings, normalizePeopleSettings } from './people';
import { getPayrollSettings } from './payroll';
import { draftDocument, saveDocument } from './documents';
import type {
  CostingRate,
  CostingSettings,
  CostingStatus,
  ID,
  InvoiceDocument,
  StaffingCosting,
} from './types';
import { msg, t } from '@/i18n';
import { newId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { currencyPrecision } from '@/lib/money';
import { annualDaysOn } from '@/lib/hr/leave';
import { ratesOn } from '@/lib/hr/payroll';
import {
  averageRates,
  costingSettingsOf,
  normalizeCostingSettings,
  percentOf,
  priceCosting,
  quoteLines,
  COSTING_RULES,
  type CostingBasis,
  type PricedCosting,
} from '@/lib/hr/costing';
import { canSeePeople, canWriteRecord, limitBlocksWrite } from '@/cloud/roles';
import { linkHasFeature } from '@/cloud/features';
import type { CloudLink } from '@/cloud/types';

/**
 * Manpower costing (تسعير العمالة, #3) in Maham People: costings of guard,
 * cleaner and other posts priced from staff cost (lib/hr/costing.ts), and
 * the quote each makes, with sell prices only. Costings are payroll and
 * people data: only owners, admins and accountants see or make them, and
 * the quote carries nothing of them but their id (InvoiceDocument.costingId).
 * Off until switched on (D1); in a company kept in the cloud, only once its
 * server has 20261207000000_staffing_costings.sql (D4).
 */

export class CostingError extends Error {}

async function linkOf(companyId: ID): Promise<CloudLink | null> {
  return (await db.syncState.get(companyId)) ?? null;
}

/** The company may use costings: always on this device, in the cloud once its server has them. */
export function costingsAvailable(link: CloudLink | null | undefined): boolean {
  return link !== undefined && linkHasFeature(link, 'staffing_costings');
}

/** Sees costings: the roles that see payroll (owners, admins and accountants; anyone on this device). */
export function canSeeCostings(link: CloudLink | null | undefined): boolean {
  if (link === undefined) return false;
  return !link || (link.status !== 'removed' && canSeePeople(link.role));
}

/**
 * Makes and changes costings, and turns them on or off: the roles that see
 * payroll, unless the owner made Maham People view only (or no access) for them.
 */
export function canEditCostings(link: CloudLink | null | undefined): boolean {
  if (link === undefined) return false;
  if (!link) return true;
  return (
    canSeeCostings(link) &&
    canWriteRecord(link.role, 'staffingCostings', {}) &&
    !limitBlocksWrite(link.role, link.permissions, 'staffingCostings', {})
  );
}

/** Whether the costing is on: available, and switched on. */
export function costingsInEffect(
  settings: { costing?: CostingSettings } | null | undefined,
  link: CloudLink | null | undefined,
): boolean {
  return costingsAvailable(link) && costingSettingsOf(settings?.costing).on;
}

function assertMayEdit(link: CloudLink | null): void {
  if (!canEditCostings(link)) {
    throw new CostingError(t('Only the owner, an admin or an accountant makes manpower costings.'));
  }
  if (!costingsAvailable(link)) {
    throw new CostingError(
      t(
        'The cloud needs the latest database script first. Ask the owner of the company to run it.',
      ),
    );
  }
}

/** The company's costing settings, with the owner's defaults (off, 10% overhead, 15% margin). */
export async function getCostingSettings(companyId: ID): Promise<CostingSettings> {
  return costingSettingsOf((await getPeopleSettings(companyId)).costing);
}

/** Saves the costing settings: the switch, overhead, margin and rate card. */
async function updateCostingSettings(
  companyId: ID,
  change: (settings: CostingSettings) => CostingSettings,
  message: string,
): Promise<CostingSettings> {
  return db.transaction(
    'rw',
    [db.peopleSettings, db.activities, db.syncState, db.companies],
    async () => {
      assertMayEdit(await linkOf(companyId));
      const company = await db.companies.get(companyId);
      const precision = currencyPrecision(company?.currency ?? 'KWD');
      const before = await getPeopleSettings(companyId);
      const current = costingSettingsOf(before.costing);
      const next = normalizeCostingSettings(change(current), precision);
      if (
        before.costing &&
        JSON.stringify(normalizeCostingSettings(before.costing, precision)) === JSON.stringify(next)
      ) {
        return next;
      }
      const settings = {
        ...normalizePeopleSettings({ ...before, costing: next }),
        updatedAt: nowStamp(),
      };
      await db.peopleSettings.put(settings);
      // Private, like the rest of payroll and people.
      await logActivity(companyId, 'costing', settings.id, 'settings', { text: message });
      return next;
    },
  );
}

/** Turns the costing on or off. Costings and quotes already made stay as they are. */
export function setCostingsOn(companyId: ID, on: boolean): Promise<CostingSettings> {
  return updateCostingSettings(
    companyId,
    (settings) => ({ ...settings, on }),
    on ? msg('Manpower costing turned on') : msg('Manpower costing turned off'),
  );
}

/** Saves the overhead and margin of new costings, and the rate card. */
export function saveCostingSettings(
  companyId: ID,
  input: Pick<CostingSettings, 'overheadPercent' | 'marginPercent'> & { rates?: CostingRate[] },
): Promise<CostingSettings> {
  return updateCostingSettings(
    companyId,
    (settings) => ({
      ...settings,
      overheadPercent: input.overheadPercent,
      marginPercent: input.marginPercent,
      ...(input.rates ? { rates: input.rates } : {}),
    }),
    msg('Manpower costing settings updated'),
  );
}

/**
 * The rate card as the current salaries have it (averages per job title),
 * worked out on this device, only for someone who sees payroll.
 */
export async function rateCardFromSalaries(companyId: ID): Promise<CostingRate[]> {
  if (!canSeeCostings(await linkOf(companyId))) return [];
  const [company, employees] = await Promise.all([
    db.companies.get(companyId),
    db.employees.where('companyId').equals(companyId).toArray(),
  ]);
  return averageRates(employees, currencyPrecision(company?.currency ?? 'KWD'));
}

/** The rate card: the one saved, or the averages of the current salaries until one is. */
export async function rateCard(
  companyId: ID,
): Promise<{ rates: CostingRate[]; fromSalaries: boolean }> {
  const saved = (await getCostingSettings(companyId)).rates;
  if (saved) return { rates: saved, fromSalaries: false };
  return { rates: await rateCardFromSalaries(companyId), fromSalaries: true };
}

/** What posts are priced with today: the company's payroll and People settings. */
export async function costingBasis(companyId: ID): Promise<CostingBasis> {
  const [company, payroll, people] = await Promise.all([
    db.companies.get(companyId),
    getPayrollSettings(companyId),
    getPeopleSettings(companyId),
  ]);
  const on = today();
  return {
    precision: currencyPrecision(company?.currency ?? 'KWD'),
    dailyDivisor: payroll.dailyDivisor,
    rateBase: payroll.rateBase,
    pifss: ratesOn(payroll.pifss, on),
    gcc: payroll.gcc,
    minimumWage: payroll.minimumWage,
    eosDivisor: people.eosDailyDivisor,
    eosForInsured: payroll.eosForInsured,
    annualLeaveDays: annualDaysOn(on, payroll.leavePolicy),
  };
}

/** A new costing, not saved, with the company's overhead and margin. */
export function newCosting(
  companyId: ID,
  settings: Pick<CostingSettings, 'overheadPercent' | 'marginPercent'>,
  clientId: ID | null = null,
): StaffingCosting {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    name: '',
    clientId,
    quoteId: null,
    status: 'draft',
    posts: [],
    overheadPercent: settings.overheadPercent,
    marginPercent: settings.marginPercent,
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

const STATUSES: CostingStatus[] = ['draft', 'quoted', 'won', 'lost'];

/** A costing as it is kept: worked out again with today's settings. */
function priced(input: StaffingCosting, basis: CostingBasis): StaffingCosting {
  const overheadPercent = percentOf(input.overheadPercent, COSTING_RULES.maxOverheadPercent);
  const marginPercent = percentOf(input.marginPercent, COSTING_RULES.maxMarginPercent);
  const result = priceCosting({ posts: input.posts, overheadPercent, marginPercent }, basis);
  return {
    ...input,
    name: input.name.trim(),
    clientId: input.clientId || null,
    quoteId: input.quoteId || null,
    status: STATUSES.includes(input.status) ? input.status : 'draft',
    notes: input.notes ?? '',
    overheadPercent,
    marginPercent,
    posts: result.posts.map((x) => ({
      ...x.post,
      jobTitle: x.post.jobTitle.trim(),
      ...(x.post.jobTitleAr?.trim() ? { jobTitleAr: x.post.jobTitleAr.trim() } : {}),
    })),
  };
}

/** Works out a costing with today's settings, to show before it is saved. */
export async function priceForCompany(
  costing: Pick<StaffingCosting, 'companyId' | 'posts' | 'overheadPercent' | 'marginPercent'>,
): Promise<PricedCosting> {
  return priceCosting(costing, await costingBasis(costing.companyId));
}

/** Saves a costing, worked out again with today's settings. */
export async function saveCosting(input: StaffingCosting): Promise<StaffingCosting> {
  if (!input.name.trim()) throw new CostingError(t('Give the costing a name.'));
  if (input.posts.some((post) => !post.jobTitle.trim())) {
    throw new CostingError(t('Give each post a job title.'));
  }
  const basis = await costingBasis(input.companyId);
  return db.transaction('rw', [db.staffingCostings, db.activities, db.syncState], async () => {
    assertMayEdit(await linkOf(input.companyId));
    const existing = await db.staffingCostings.get(input.id);
    if (existing && existing.companyId !== input.companyId) {
      throw new CostingError(t('Costing not found'));
    }
    const costing: StaffingCosting = {
      ...priced(input, basis),
      createdAt: existing?.createdAt ?? input.createdAt ?? nowStamp(),
      updatedAt: nowStamp(),
    };
    await db.staffingCostings.put(costing);
    await logActivity(
      costing.companyId,
      'costing',
      costing.id,
      existing ? 'updated' : 'created',
      {
        text: existing
          ? msg('Manpower costing {name} updated')
          : msg('Manpower costing {name} created'),
        vars: { name: costing.name },
      },
      { clientId: costing.clientId },
    );
    return costing;
  });
}

/** Marks a costing won or lost, or back to quoted or draft. */
export async function setCostingStatus(id: ID, status: CostingStatus): Promise<StaffingCosting> {
  return db.transaction('rw', [db.staffingCostings, db.activities, db.syncState], async () => {
    const costing = await db.staffingCostings.get(id);
    if (!costing) throw new CostingError(t('Costing not found'));
    assertMayEdit(await linkOf(costing.companyId));
    if (!STATUSES.includes(status)) throw new CostingError(t('Costing not found'));
    if (costing.status === status) return costing;
    const next = { ...costing, status, updatedAt: nowStamp() };
    await db.staffingCostings.put(next);
    await logActivity(
      costing.companyId,
      'costing',
      costing.id,
      'status',
      {
        text:
          status === 'won'
            ? msg('Manpower costing {name} marked as won')
            : status === 'lost'
              ? msg('Manpower costing {name} marked as lost')
              : msg('Manpower costing {name} updated'),
        vars: { name: costing.name },
      },
      { clientId: costing.clientId },
    );
    return next;
  });
}

/** Deletes a costing. A quote made from it stays as it is. */
export async function deleteCosting(id: ID): Promise<void> {
  await db.transaction('rw', [db.staffingCostings, db.activities, db.syncState], async () => {
    const costing = await db.staffingCostings.get(id);
    if (!costing) return;
    assertMayEdit(await linkOf(costing.companyId));
    await db.staffingCostings.delete(id);
    await logActivity(
      costing.companyId,
      'costing',
      costing.id,
      'deleted',
      { text: msg('Manpower costing {name} deleted'), vars: { name: costing.name } },
      { clientId: costing.clientId },
    );
  });
}

/**
 * Makes a quote from a costing: a draft quote for its customer with one line
 * a post (job title, hours and days, headcount and the sell price per person
 * a month), through the documents' own save, so it is numbered and checked
 * like any quote. The quote carries the costing's id and nothing else of
 * it: no salary, allowance, PIFSS, indemnity, cost, overhead or margin, in
 * its lines, notes, terms or activity. The costing keeps the quote's id and
 * is marked quoted. The costing is worked out again first, so the quote has
 * today's prices.
 */
export async function createQuoteFromCosting(id: ID): Promise<InvoiceDocument> {
  const stored = await db.staffingCostings.get(id);
  if (!stored) throw new CostingError(t('Costing not found'));
  assertMayEdit(await linkOf(stored.companyId));
  if (!stored.clientId) throw new CostingError(t('Choose the customer of the costing first.'));
  if (stored.posts.length === 0) throw new CostingError(t('Add a post to the costing first.'));
  const [company, client] = await Promise.all([
    db.companies.get(stored.companyId),
    db.clients.get(stored.clientId),
  ]);
  if (!company) throw new CostingError(t('Company not found'));
  if (!client || client.companyId !== company.id) {
    throw new CostingError(t('Choose the customer of the costing first.'));
  }
  if (stored.posts.some((post) => !post.jobTitle.trim())) {
    throw new CostingError(t('Give each post a job title.'));
  }
  const costing = priced(stored, await costingBasis(stored.companyId));
  const draft = await draftDocument(company, 'quote', client);
  const quote = await saveDocument({
    ...draft,
    items: quoteLines(costing.posts, draft.items[0]?.taxes ?? []),
    costingId: costing.id,
  });
  await db.transaction('rw', [db.staffingCostings, db.activities, db.syncState], async () => {
    const current = (await db.staffingCostings.get(costing.id)) ?? costing;
    await db.staffingCostings.put({
      ...current,
      // As priced for the quote.
      posts: costing.posts,
      overheadPercent: costing.overheadPercent,
      marginPercent: costing.marginPercent,
      quoteId: quote.id,
      status: current.status === 'draft' ? 'quoted' : current.status,
      updatedAt: nowStamp(),
    });
    await logActivity(
      company.id,
      'costing',
      costing.id,
      'quoted',
      quote.number
        ? {
            text: msg('Quote {number} made from manpower costing {name}'),
            vars: { number: quote.number, name: costing.name },
          }
        : { text: msg('A quote made from manpower costing {name}'), vars: { name: costing.name } },
      { clientId: costing.clientId },
    );
  });
  return quote;
}
