import { db, DATA_TABLES } from '../db';
import type { Company } from '../types';
import { DemoBooks } from './books';
import { Calendar, Timeline } from './calendar';
import { SeedClock } from './clock';
import { closeLastYear, closingDate, importNbkStatement } from './closing';
import { moneyStory } from './money';
import { peopleStory } from './people';
import { purchasesStory } from './purchases';
import { registerStory } from './register';
import { salesStory } from './sales';
import { setUpCompany } from './setup';

/**
 * Creates the demo company: Rawdat Al Khaleej General Trading & Contracting,
 * a W.L.L. in Shuwaikh Industrial that supplies and installs lighting, CCTV
 * and smart locks. A year of its work ends today: quotes, orders, delivery
 * notes and invoices, post-dated cheques (one returned and replaced), the
 * Ministry's 5% retention released against a clearance certificate, imports
 * with customs and freight, payroll with PIFSS and end of service, expiring
 * residencies, fixed assets, last year's close with the statutory reserve and
 * an NBK statement to reconcile. Everything is in KWD with no VAT, and is
 * created through the modules' own functions, so the books balance.
 *
 * Runs as one transaction, so the app only switches over once everything is
 * in place.
 */
export async function seedDemoCompany(): Promise<Company> {
  const clock = new SeedClock();
  // The link too: saving a vehicle asks whether the cloud keeps them (never, for the demo).
  const tables = [...DATA_TABLES.map((name) => db[name]), db.meta, db.syncState];
  // An async scope function, so Dexie keeps the transaction across the awaits.
  return clock.around(() => db.transaction('rw', tables, async () => seed(clock)));
}

async function seed(clock: SeedClock): Promise<Company> {
  const calendar = new Calendar();
  const books = new DemoBooks(calendar);
  // The books were opened at the end of the month a year before this one.
  const opening = calendar.monthEnd(-13);
  clock.set(opening);
  await setUpCompany(books, opening);

  const timeline = new Timeline(calendar);
  salesStory(books, timeline);
  purchasesStory(books, timeline);
  peopleStory(books, timeline);
  moneyStory(books, timeline);
  await timeline.play((date) => clock.set(date));

  clock.set(calendar.today);
  await importNbkStatement(books);
  // Closing last year locks it, so it comes after everything dated in it.
  clock.set(closingDate(calendar));
  await closeLastYear(books);
  clock.set(calendar.today);
  await registerStory(books);
  // Marked so it never goes to the cloud.
  await db.companies.update(books.company.id, { demo: true });
  return books.refresh();
}
