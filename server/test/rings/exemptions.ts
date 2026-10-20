/**
 * D-6045 (Task C0k; ARCH-04 (#545), stage 1). The shape every ring rule's data file uses for an entry that its rule
 * allows by name: an allowlist member or an exemption. Each entry says why, in one line, and when the entry was
 * written or last re-dated. The sets live in per-rule `*.data.ts` files beside their rule, so a PR that adds or
 * drops an entry edits that rule's data alone, never a file every PR edits.
 */

export interface Entry {
  /** Why this path (or module) is allowed, in one line. */
  reason: string;
  /** `YYYY-MM-DD`: the day the entry was written or its reason last re-dated. */
  since: string;
}

export type EntrySet = Readonly<Record<string, Entry>>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The entries whose reason is blank or multi-line, or whose date is not a real `YYYY-MM-DD` day on or before
 *  `today`, each as `key: what is wrong`. Empty when every entry is well formed. */
export function malformedEntries(set: EntrySet, today: Date = new Date()): string[] {
  const out: string[] = [];
  const todayIso = today.toISOString().slice(0, 10);
  for (const [key, e] of Object.entries(set)) {
    if (e.reason.trim() === '' || /\n/.test(e.reason)) out.push(`${key}: the reason must be one non-empty line`);
    const m = DATE_RE.exec(e.since);
    const d = new Date(`${e.since}T00:00:00Z`);
    const real = m !== null && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === e.since;
    if (!real) out.push(`${key}: since '${e.since}' is not a YYYY-MM-DD day`);
    else if (e.since > todayIso) out.push(`${key}: since '${e.since}' is in the future`);
  }
  return out;
}
