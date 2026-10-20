/**
 * Values read from stored records may come from a newer version of the app
 * (on another device, through the cloud or a backup) and be missing from
 * this version's lists. Looking them up through these gives a fallback
 * instead of undefined, so an older version shows something sensible rather
 * than failing.
 */

/** Whether `value` is one of the keys of `map` (never one it inherits). */
export function isKnown<K extends string>(map: Record<K, unknown>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(map, value);
}

/** `map[value]`, or `fallback` for a value this version doesn't know. */
export function lookup<K extends string, V>(map: Record<K, V>, value: unknown, fallback: V): V {
  return isKnown(map, value) ? map[value] : fallback;
}
