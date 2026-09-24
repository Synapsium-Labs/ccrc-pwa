// The release-tag comparator — design 2026-09-20 decision 2 and §9.
//
// L0, and it imports NOTHING, not even a type: the PWA bundles `shared/`, and
// this file's one job is arithmetic over three digit strings. The canonical
// form of a version everywhere is the TAG (`vX.Y.Z`); the `v` is stripped
// HERE, inside the comparator, and nowhere else — every column, message and
// argument keeps it.
//
// PRECONDITION, not validation: callers validate with `isReleaseTag`
// (`shared/api.ts`), the ONE tag-shape guard. This file cannot import it, so
// `digitsOf` below restates the grammar STRUCTURALLY, only to refuse loudly
// what a caller forgot to validate — a non-tag is a RangeError, never ordered,
// because ordering one silently is how "v0.0.9 " would outrank "v0.0.10".
// `update-semver.test.ts` holds this parse's accept set equal to
// `isReleaseTag`'s on a fixture list, so the two statements cannot drift.
//
// Digit strings, not numbers: a component is compared by length after its
// leading zeros are stripped, then lexically — exact at any length, where
// `Number()` loses precision past 2^53. `v0.0.010` and `v0.0.10` therefore
// compare EQUAL, as they do under `ccd/ccrc`'s `_ver_newer` (`10#` arithmetic),
// the bash twin this is pinned to agree with, alongside `sort -V`.

const ZERO = 48; // '0'
const NINE = 57; // '9'

function refuse(v: unknown): never {
  throw new RangeError(`compareReleaseTags: not a release tag: ${JSON.stringify(v)}`);
}

/** The three components of a tag with their leading zeros stripped (`'000'`
 *  → `'0'`), or a RangeError. */
function digitsOf(v: unknown): readonly [string, string, string] {
  if (typeof v !== 'string' || v.charCodeAt(0) !== 0x76 /* v */) refuse(v);
  const parts = v.slice(1).split('.');
  if (parts.length !== 3) refuse(v);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length === 0) refuse(v);
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c < ZERO || c > NINE) refuse(v);
    }
    let z = 0;
    while (z < p.length - 1 && p.charCodeAt(z) === ZERO) z++;
    out.push(p.slice(z));
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when the same version.
 *  Throws RangeError when either argument is not a release tag. */
export function compareReleaseTags(a: string, b: string): -1 | 0 | 1 {
  const x = digitsOf(a);
  const y = digitsOf(b);
  for (let i = 0; i < 3; i++) {
    const p = x[i]!;
    const q = y[i]!;
    if (p.length !== q.length) return p.length > q.length ? 1 : -1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/** Whether `a` is STRICTLY newer than `b` — `_ver_newer a b`'s exit status 0. */
export function isNewerTag(a: string, b: string): boolean {
  return compareReleaseTags(a, b) === 1;
}

/** The newest tag of the list, or `null` for an empty list. Among tags of
 *  equal version the FIRST in the list wins, so the answer is stable. Throws
 *  RangeError when any element is not a release tag. */
export function newestTag(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (best === null) { digitsOf(t); best = t; continue; }
    if (compareReleaseTags(t, best) === 1) best = t;
  }
  return best;
}
