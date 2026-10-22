import {
  createQuoteFromCosting,
  newCosting,
  saveCosting,
  saveCostingSettings,
  setCostingsOn,
} from '../costings';
import type { CostingRate } from '../types';
import { newPost } from '@/lib/hr/costing';
import type { DemoBooks } from './books';

/** The demo's rate card: invented pay of the posts it supplies with its installations. */
const RATES: CostingRate[] = [
  {
    id: 'demo-guard',
    jobTitle: 'Security Guard',
    jobTitleAr: 'حارس أمن',
    category: 'expat',
    basic: 120,
    allowances: 30,
    otherCosts: 12,
  },
  {
    id: 'demo-cleaner',
    jobTitle: 'Cleaner',
    jobTitleAr: 'عامل نظافة',
    category: 'expat',
    basic: 95,
    allowances: 15,
    otherCosts: 8,
  },
  {
    id: 'demo-cctv',
    jobTitle: 'CCTV Operator',
    jobTitleAr: 'مشغل كاميرات مراقبة',
    category: 'kuwaiti',
    basic: 650,
    allowances: 150,
  },
];

/**
 * Manpower costing (#3) in the demo: switched on with the owner's 10%
 * overhead and 15% margin, a rate card of invented pay, and a costing for
 * the hotel's car park (guards on 12-hour shifts, which the costing flags,
 * cleaners and a CCTV room) with the quote it made, at sell prices only.
 */
export async function costingStory(books: DemoBooks): Promise<void> {
  await setCostingsOn(books.id, true);
  const settings = await saveCostingSettings(books.id, {
    overheadPercent: 10,
    marginPercent: 15,
    rates: RATES,
  });
  const [guard, cleaner, cctv] = RATES;
  const costing = await saveCosting({
    ...newCosting(books.id, settings, books.customers.hotel.id),
    name: 'Hotel car park: guards, cleaners and the CCTV room',
    notes: 'Night shift guards on 12 hours: check the overtime with counsel before sending.',
    posts: [
      { ...newPost(guard), headcount: 6, hoursPerDay: 12 },
      { ...newPost(cleaner), headcount: 3 },
      { ...newPost(cctv), headcount: 2 },
    ],
  });
  await createQuoteFromCosting(costing.id);
}
