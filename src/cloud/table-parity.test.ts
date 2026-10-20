import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_TABLES } from '@/db/db';
import { parseBackup } from '@/db/backup';
import { RECORD_LABELS } from './labels';
import { PEOPLE_TABLES, STAFF_TABLES } from './roles';
import { MIGRATIONS } from './sql-harness';

/**
 * The lists of tables kept in several places agree: the device's synced
 * tables, backups, sync problem labels, and the cloud's kinds of record and
 * rules, as the latest migration that defines each leaves them. A table
 * added to one and not the others would be refused by the cloud, lost from
 * backups, or shown to roles that must not see it.
 */

const sources = MIGRATIONS.map((file) => readFileSync(file, 'utf8'));

/** What `pattern` captures in its last match in the migrations, in the order they run. */
function latest(pattern: RegExp): string {
  for (const source of [...sources].reverse()) {
    const found = [...source.matchAll(pattern)].at(-1);
    if (found) return found[1];
  }
  throw new Error(`Not in any migration: ${pattern}`);
}

/** The body of a function as its latest definition has it. */
const functionBody = (name: string) =>
  latest(
    new RegExp(String.raw`create or replace function ${name}\([\s\S]*?\$\$([\s\S]*?)\$\$;`, 'g'),
  );

/** The quoted names of a SQL list. */
const names = (list: string) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const sorted = (list: readonly string[]) => [...list].sort();

describe('the lists of tables', () => {
  it('in the cloud’s kinds of record are the synced tables', () => {
    const allowed = names(latest(/add constraint records_tbl_check check \(tbl in \(([^)]*)\)\)/g));
    expect(sorted(allowed)).toEqual(sorted(DATA_TABLES));
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it('in backups are the synced tables, each there even in a backup made without it', () => {
    const backup = parseBackup(
      JSON.stringify({ app: 'Maham One', format: 1, exportedAt: '', data: { companies: [] } }),
    );
    expect(Object.keys(backup.data)).toEqual([...DATA_TABLES]);
  });

  it('each have a label for the list of sync problems', () => {
    expect(sorted(Object.keys(RECORD_LABELS))).toEqual(sorted(DATA_TABLES));
  });

  it('that are always private are the same in the cloud and on the device', () => {
    const body = functionBody(String.raw`almailbooks\.record_is_private`);
    const always = names(/if p_tbl in \(([^)]*)\)/.exec(body)![1]);
    expect(sorted(always)).toEqual(sorted(PEOPLE_TABLES));
    // The read rule that holds when the first file is run again: approval
    // requests about the same tables.
    const rule = functionBody(String.raw`almailbooks\.can_read_v16_record`);
    const subjects = names(/'subjectTbl', ''\) not in \(([^)]*)\)/.exec(rule)![1]);
    expect(sorted(subjects)).toEqual(sorted(PEOPLE_TABLES));
    for (const table of PEOPLE_TABLES) expect(DATA_TABLES, table).toContain(table);
  });

  it('that staff may change are the same in the cloud and on the device', () => {
    const body = functionBody(String.raw`almailbooks\.staff_can_write`);
    const writable = names(/select p_tbl in \(([^)]*)\)/.exec(body)![1]);
    expect(sorted(writable)).toEqual(sorted(STAFF_TABLES));
    for (const table of STAFF_TABLES) expect(DATA_TABLES, table).toContain(table);
  });
});
