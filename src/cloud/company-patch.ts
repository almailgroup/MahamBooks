import type { NumberingRule } from '@/db/types';
import type { CompanyOp } from './api';
import { mergeNumbering } from './numbering';
import { sameData } from './roles';

/**
 * The company record is changed on every device: its settings by owners and
 * admins, its document counters by anyone who numbers a document. So a change
 * travels as the fields that changed since the copy this device last had from
 * the cloud (its base), and those are laid over the cloud's current copy;
 * a device with an older copy never puts back what others changed. Counters
 * (numbering next and period, always together) merge as they always have:
 * they never go back. The database does the same (patch_company).
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keysOf = (...objects: Json[]) => [...new Set(objects.flatMap((o) => Object.keys(o)))];

const COUNTER = new Set(['next', 'period']);

/**
 * Settings that are one value though they are objects: the company type is
 * a reference ({id, name, nameAr}) whose names belong to its id, so it
 * travels whole and two devices' types never mix.
 */
const WHOLE = new Set(['companyType']);

/** Fields whose changes on two devices are never a conflict: counters merge, the time is the time. */
function quiet(path: string[]): boolean {
  return path[0] === 'numbering' || path[0] === 'updatedAt';
}

/** A field set (null included: settings such as the lock date use it) or, when undefined, removed. */
function op(path: string[], value: unknown, base: unknown): CompanyOp {
  const change: CompanyOp = value === undefined ? { path, remove: true } : { path, value };
  if (base !== undefined) change.base = base;
  return change;
}

/**
 * What changed from `base` to `local`: the leaves of nested objects; arrays
 * and the settings that are one value (WHOLE) as a whole.
 */
export function companyOps(base: Json, local: Json): CompanyOp[] {
  const ops: CompanyOp[] = [];
  const walk = (before: unknown, after: unknown, path: string[]) => {
    if (sameData(before, after)) return;
    const whole = path.length === 1 && WHOLE.has(path[0]);
    if (isObject(before) && isObject(after) && !whole) {
      const rule = path.length === 2 && path[0] === 'numbering';
      if (rule && (!sameData(before.next, after.next) || !sameData(before.period, after.period))) {
        // A counter means nothing without its period: they go together.
        ops.push(op([...path, 'next'], after.next, before.next));
        ops.push(op([...path, 'period'], after.period, before.period));
      }
      for (const key of keysOf(before, after)) {
        if (rule && COUNTER.has(key)) continue;
        walk(before[key], after[key], [...path, key]);
      }
      return;
    }
    if (path.length === 0) return;
    ops.push(op(path, after, before));
  };
  walk(base, local, []);
  return ops;
}

/** Only document counters changed (what numbering a document does). */
export function onlyCounters(ops: CompanyOp[]): boolean {
  return (
    ops.length > 0 &&
    ops.every((o) => o.path.length === 3 && o.path[0] === 'numbering' && COUNTER.has(o.path[2]))
  );
}

function getPath(target: unknown, path: string[]): unknown {
  let at: unknown = target;
  for (const key of path) {
    if (!isObject(at)) return undefined;
    at = at[key];
  }
  return at;
}

function setPath(target: Json, path: string[], value: unknown): Json {
  const [head, ...rest] = path;
  if (rest.length === 0) return { ...target, [head]: value };
  const child = isObject(target[head]) ? (target[head] as Json) : {};
  return { ...target, [head]: setPath(child, rest, value) };
}

function removePath(target: Json, path: string[]): Json {
  const [head, ...rest] = path;
  if (!(head in target)) return target;
  if (rest.length === 0) {
    const copy = { ...target };
    delete copy[head];
    return copy;
  }
  const child = target[head];
  return isObject(child) ? { ...target, [head]: removePath(child, rest) } : target;
}

/**
 * Lays this device's changes over `current` (the cloud's copy): counters
 * merge, every other field takes this device's value. `conflicts` lists the
 * fields that had also changed in `current` since this device's base.
 */
export function rebaseCompany(
  current: Json,
  ops: CompanyOp[],
): { data: Json; conflicts: string[][] } {
  let data: Json = { ...current };
  const conflicts: string[][] = [];
  for (const change of ops) {
    const now = getPath(current, change.path);
    const mine = change.remove ? undefined : change.value;
    if (!quiet(change.path) && !sameData(now, change.base) && !sameData(now, mine)) {
      conflicts.push(change.path);
    }
    data = change.remove
      ? removePath(data, change.path)
      : setPath(data, change.path, change.value ?? null);
  }
  const numbering = mergeNumbering(
    current.numbering as Record<string, NumberingRule> | undefined,
    data.numbering as Record<string, NumberingRule> | undefined,
  );
  if (numbering) data = { ...data, numbering };
  return { data, conflicts };
}
