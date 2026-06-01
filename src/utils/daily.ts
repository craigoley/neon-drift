/**
 * Daily challenge date→seed mapping (OPP-09). PURE — no three, no DOM, no
 * storage. Every calendar day maps to ONE fixed road seed, so the same date
 * always produces the same course (the road/traffic/powerups are already fully
 * seeded — see Road.ts/Traffic.ts — so this is just a stable date→seed).
 *
 * TIMEZONE: keyed on the player's LOCAL date (getFullYear/getMonth/getDate), NOT
 * UTC. The challenge therefore rolls over at the player's local midnight. A UTC
 * key would flip the daily mid-evening for western timezones (e.g. ~5–8pm), which
 * would feel broken — "today's" challenge changing while it's still today. Local
 * is the intuitive choice; the small cost is that two players in different zones
 * see different "daily" seeds on the same wall-clock instant, which is fine for a
 * local-only, chase-your-own-best feature.
 */

/** Local calendar date as a YYYYMMDD integer (e.g. 2026-05-31 → 20260531). Stable
 *  within a local day; increments across days; sorts chronologically. */
export function dailyDateKey(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // getMonth is 0-based
  const d = date.getDate();
  return y * 10000 + m * 100 + d;
}

/**
 * The fixed road seed for a given date's daily challenge — a well-spread 32-bit
 * unsigned integer (matching the random-run seed range). The raw YYYYMMDD key
 * only increments by 1 per day, so consecutive days would otherwise produce
 * near-identical roads; the murmur3 finalizer (same mix used by hashNoise)
 * avalanches the key so adjacent dates yield completely different courses.
 */
export function dailySeed(date: Date): number {
  let h = dailyDateKey(date) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}
