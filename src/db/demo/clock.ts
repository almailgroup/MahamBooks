import type { Table } from 'dexie';
import { db } from '../db';
import type { ISODate } from '../types';
import { today } from '@/lib/dates';

/**
 * The demo is a year of work entered in a few seconds. The seed clock gives
 * what is written while it runs the time it would have had if it was
 * entered on its business date: an invoice from March was created and sent
 * in March, so its activity, "sent" date and the order of recent documents
 * read naturally. Only the timestamps the app sets for itself (createdAt,
 * sentAt, an activity's time…) change; the records are written by the
 * modules' own functions.
 */

/** Timestamp fields the app fills in with the current time. */
const TIMESTAMP_FIELDS = [
  'createdAt',
  'updatedAt',
  'sentAt',
  'paidAt',
  'at',
  'lastIssuedAt',
  'voidedAt',
  'reversedAt',
] as const;

/**
 * Records whose timestamps are shown or order things: the activity log, sent
 * and paid dates, recent documents and payments, when a year was closed, and
 * the order of stock movements of the same day. (Restamping a record that is
 * put makes Dexie read it first, so the others are left alone.)
 */
const STAMPED_TABLES = (): Table[] => [
  db.activities,
  db.documents,
  db.payments,
  db.yearEnds,
  db.recurring,
  db.stockEntries,
  db.landedCosts,
];

/** First record of a day: 09:00 in Kuwait (06:00 UTC); each next record 20 seconds later. */
const DAY_START_UTC_HOUR = 6;
const STEP_MS = 20_000;

export class SeedClock {
  /** The real time the seed started: anything written later was stamped by the app. */
  private readonly started = new Date().toISOString();
  private date: ISODate = today();
  private tick = 0;

  /** Moves the clock to a business date. */
  set(date: ISODate): void {
    if (date === this.date) return;
    this.date = date;
    this.tick = 0;
  }

  /** The next timestamp on the clock's date, never later than the real time. */
  stamp(): string {
    const [y, m, d] = this.date.split('-').map(Number);
    const at = Date.UTC(y, m - 1, d, DAY_START_UTC_HOUR) + this.tick * STEP_MS;
    this.tick += 1;
    return new Date(Math.min(at, Date.parse(this.started) - 1000)).toISOString();
  }

  /** Whether a value is a timestamp the app set while the seed ran. */
  isLive(value: unknown): value is string {
    return typeof value === 'string' && value >= this.started;
  }

  /**
   * Restamps what the modules write while `run` works. The hooks only touch
   * the timestamp fields of new and changed records, and are removed after.
   */
  async around<T>(run: () => Promise<T>): Promise<T> {
    const creating = (_key: unknown, obj: Record<string, unknown>) => {
      let stamp: string | undefined;
      for (const field of TIMESTAMP_FIELDS) {
        if (this.isLive(obj[field])) obj[field] = stamp ??= this.stamp();
      }
    };
    const updating = (changes: object) => {
      const changed = changes as Record<string, unknown>;
      let stamp: string | undefined;
      const out: Record<string, unknown> = {};
      for (const field of TIMESTAMP_FIELDS) {
        if (this.isLive(changed[field])) out[field] = stamp ??= this.stamp();
      }
      return stamp ? out : undefined;
    };
    const tables = STAMPED_TABLES();
    for (const table of tables) {
      table.hook('creating', creating);
      table.hook('updating', updating);
    }
    try {
      return await run();
    } finally {
      for (const table of tables) {
        table.hook('creating').unsubscribe(creating);
        table.hook('updating').unsubscribe(updating);
      }
    }
  }
}
