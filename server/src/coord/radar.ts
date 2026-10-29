/**
 * Landing order, wave 4b (plan docs/superpowers/plans/2026-10-29-landing-order-wave4b-radar-console.md, Task 1): the
 * PARSER of the one file of wave 3b's radar that the console shows, `$REG/landing/<project>/probe` (`probe_doc` and
 * `measure` in `ccd/ccd-land-probe` write it), and the per-session DERIVATION of what the PWA's chip reads. Pure policy:
 * it imports types and L0 values (`freshWithin`, `RADAR_PROBE_FRESH_S`), reads no file and no clock (`nowMs` is an
 * argument), so every case is a table row. The sibling of `lineage.ts`, with the same `{ok:false, reason}` shape.
 *
 * Fail closed, and absence means unknown (D-7481). Nothing here answers "no conflict" for a head the doc does not name
 * for this session NOW: a doc that is oversized, malformed, foreign, stale or unmeasured reads as no landing at all,
 * and the reason is kept apart for the reader's own warning line (`unreadable`, `stale`, `unmeasured`). The doc's own
 * `why` is checked as a short non-empty string and never kept (D-7478 leaves `main-health`, `store`, `scratch` and
 * `elapsedMs` unread for the same reason: the chip shows none of them).
 *
 * A head is bound to a session only by a POSITIVE match (D-7479, D-7484): a non-empty `id` that exactly one head names,
 * a row of the project holding that `id`, the row's CURRENT branch equal to the head's `branch`, and, when the row has
 * a PR, that PR open and numbered like the head's. The radar's `id: null` can mean no row, two rows, an unlisted
 * registry or a held row, and the record does not say which, so a null-`id` head on a fleet session's branch marks every
 * landing of the project `cut.unbound`: no landing can claim it was paired against that head.
 */
import {
  RADAR_PROBE_FRESH_S, freshWithin,
  type LandingConflict, type SessionLanding,
} from '../../../shared/api.js';

/** The radar writes no cap of its own (D-7482): the reader refuses a `probe` over 512 KiB, measured before the read
 *  and again on the bytes. The largest real doc (100 heads, 45 pairs, 20 paths each) is far below it. */
export const RADAR_PROBE_MAX_BYTES = 524288;
/** Each shown path is cut to this many characters (D-7482). */
export const RADAR_PATH_MAX = 300;
/** A `why` is a short word the radar writes (`rc-<n>`, `budget`...): read as a non-empty string of at most this many
 *  characters, never against a word list, and never shown. */
const WHY_MAX = 64;

const SHA = /^[0-9a-f]{40}$/;

/** One merge answer as the radar writes it, less the `why` that is never shown. */
export type ProbeAnswer =
  | { state: 'clean' }
  | { state: 'conflict'; paths: string[]; pathsCut: boolean }
  | { state: 'unmeasured' };

export interface ProbeHead { pr: number; head: string; branch: string; id: string | null; base: ProbeAnswer }
export interface ProbePair { a: number; b: number; answer: ProbeAnswer }

/** A `probe` that passed every check of `parseProbe`. */
export interface ProbeDoc {
  project: string;
  at: string;
  baseRef: string;
  heads: ProbeHead[];
  headsCut: boolean;
  pairs: ProbePair[];
  pairHeads: number[];
  pairsCut: boolean;
}

export type ProbeRead =
  | { ok: true; doc: ProbeDoc }
  | { ok: false; reason: 'unreadable' | 'stale' | 'unmeasured' };

const isSha = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isPr = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isWhy = (v: unknown): boolean => typeof v === 'string' && v !== '' && v.length <= WHY_MAX;

function parseObject(content: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(content);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** `<answer>`: `{state:'clean'}`, `{state:'conflict', paths[], pathsCut}` or `{state:'unmeasured', why}`; `null` for
 *  anything else (a pair carries its answer inline, so the record read is the pair's own). */
function parseAnswer(o: Record<string, unknown>): ProbeAnswer | null {
  if (o.state === 'clean') return { state: 'clean' };
  if (o.state === 'unmeasured') return isWhy(o.why) ? { state: 'unmeasured' } : null;
  if (o.state !== 'conflict') return null;
  const paths = o.paths;
  if (!Array.isArray(paths) || !(paths as unknown[]).every((p) => typeof p === 'string')) return null;
  if (typeof o.pathsCut !== 'boolean') return null;
  return { state: 'conflict', paths: paths as string[], pathsCut: o.pathsCut };
}

/** One `probe` file's bytes, read against the project it must describe. Unreadable beats stale beats unmeasured. */
export function parseProbe(content: string, project: string, nowMs: number): ProbeRead {
  const bad = { ok: false, reason: 'unreadable' } as const;
  if (Buffer.byteLength(content, 'utf8') > RADAR_PROBE_MAX_BYTES) return bad;
  const o = parseObject(content);
  if (o === null || o.v !== 1 || o.project !== project) return bad;
  if (o.state !== 'measured' && o.state !== 'unmeasured') return bad;
  const measured = o.state === 'measured';

  // A measured doc has a `{ref, sha}` base and no `why`; an unmeasured one has a `why` and a `null` base, or the
  // `{ref, sha}` of a base it did fetch (`gh-failed` keeps it, D-7382), and no heads or pairs.
  const rawBase = o.base;
  let baseRef = '';
  if (rawBase === null) {
    if (measured) return bad;
  } else {
    if (!isRecord(rawBase) || typeof rawBase.ref !== 'string' || rawBase.ref === '' || !isSha(rawBase.sha)) return bad;
    baseRef = rawBase.ref;
  }
  if (measured ? o.why !== undefined : !isWhy(o.why)) return bad;

  if (typeof o.headsCut !== 'boolean' || typeof o.pairsCut !== 'boolean') return bad;

  const rawHeads = o.heads;
  const rawPairs = o.pairs;
  const rawPairHeads = o.pairHeads;
  if (!Array.isArray(rawHeads) || !Array.isArray(rawPairs) || !Array.isArray(rawPairHeads)) return bad;
  if (!measured && (rawHeads.length > 0 || rawPairs.length > 0)) return bad;

  const heads: ProbeHead[] = [];
  const byPr = new Map<number, ProbeHead>();
  for (const e of rawHeads as unknown[]) {
    if (!isRecord(e) || !isPr(e.pr) || !isSha(e.head) || typeof e.branch !== 'string') return bad;
    if (e.id !== null && typeof e.id !== 'string') return bad;
    if (!isRecord(e.base)) return bad;
    const base = parseAnswer(e.base);
    if (base === null || byPr.has(e.pr)) return bad;
    const h: ProbeHead = { pr: e.pr, head: e.head, branch: e.branch, id: e.id, base };
    heads.push(h);
    byPr.set(h.pr, h);
  }

  // `pairHeads` are the bound heads the radar paired: distinct, each a head of this doc with an `id`. The radar's
  // `CCD_LAND_PROBE_PAIR_HEADS` knob has no upper bound, so no constant bounds the length here.
  const pairHeads: number[] = [];
  for (const p of rawPairHeads as unknown[]) {
    const bound = isPr(p) ? byPr.get(p) : undefined;
    if (!isPr(p) || pairHeads.includes(p) || bound === undefined || bound.id === null) return bad;
    pairHeads.push(p);
  }

  const pairs: ProbePair[] = [];
  const seen = new Set<string>();
  for (const e of rawPairs as unknown[]) {
    if (!isRecord(e) || !isPr(e.a) || !isPr(e.b) || e.a >= e.b) return bad;
    if (!pairHeads.includes(e.a) || !pairHeads.includes(e.b)) return bad;
    const key = `${e.a}:${e.b}`;
    if (seen.has(key)) return bad;
    seen.add(key);
    const answer = parseAnswer(e);
    if (answer === null) return bad;
    pairs.push({ a: e.a, b: e.b, answer });
  }

  if (!freshWithin(o.at, RADAR_PROBE_FRESH_S, nowMs)) return { ok: false, reason: 'stale' };
  if (!measured) return { ok: false, reason: 'unmeasured' };
  return {
    ok: true,
    doc: {
      project, at: o.at as string, baseRef, heads, headsCut: o.headsCut, pairs, pairHeads, pairsCut: o.pairsCut,
    },
  };
}

/** A listed registry record of the doc's project, as the lane reads it (`sessionBranchOf` and `sessionPrOf` of
 *  `fleet.ts` are the two derivations the branch and the PR come from): the session's CURRENT branch, and its PR with
 *  `open` meaning `phase === 'open'`. */
export interface RadarRow {
  id: string;
  branch: string | null;
  pr: { number: number; open: boolean } | null;
}

/** A path cut to `RADAR_PATH_MAX` characters, never inside a surrogate pair. */
function cutPath(p: string): string {
  if (p.length <= RADAR_PATH_MAX) return p;
  const end = RADAR_PATH_MAX;
  const code = p.charCodeAt(end - 1);
  return p.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}

function shownBase(a: ProbeAnswer): SessionLanding['base'] {
  return a.state === 'conflict'
    ? { state: a.state, paths: a.paths.map(cutPath), pathsCut: a.pathsCut }
    : { state: a.state };
}

/** What the doc says of each session it matches (D-7479, D-7484), keyed by the row's id. A session with no entry is
 *  one the radar does not speak for: absence means unknown. A doc already out of its window answers an empty map, so
 *  no caller can show a prediction past it (D-7481). */
export function sessionLandingsOf(
  doc: ProbeDoc, rows: readonly RadarRow[], nowMs: number,
): Map<string, SessionLanding> {
  const out = new Map<string, SessionLanding>();
  if (!freshWithin(doc.at, RADAR_PROBE_FRESH_S, nowMs)) return out;

  // The branches some row is on now: a null-`id` head on one is a fleet head the radar left out of its pairs.
  const rowBranches = new Set<string>();
  for (const r of rows) if (r.branch !== null) rowBranches.add(r.branch);
  const unbound = doc.heads.some((h) => h.id === null && rowBranches.has(h.branch));

  const idCount = new Map<string, number>();
  for (const h of doc.heads) if (h.id !== null) idCount.set(h.id, (idCount.get(h.id) ?? 0) + 1);
  const headOfId = new Map<string, ProbeHead>();
  for (const h of doc.heads) if (h.id !== null && h.id !== '' && idCount.get(h.id) === 1) headOfId.set(h.id, h);

  for (const r of rows) {
    const h = headOfId.get(r.id);
    if (h === undefined || r.branch === null || h.branch !== r.branch) continue;
    if (r.pr !== null && !(r.pr.open && r.pr.number === h.pr)) continue;

    const conflicts: LandingConflict[] = [];
    const unmeasuredWith: number[] = [];
    for (const p of doc.pairs) {
      if (p.a !== h.pr && p.b !== h.pr) continue;
      const other = p.a === h.pr ? p.b : p.a;
      if (p.answer.state === 'conflict') {
        conflicts.push({ pr: other, paths: p.answer.paths.map(cutPath), pathsCut: p.answer.pathsCut });
      } else if (p.answer.state === 'unmeasured') {
        unmeasuredWith.push(other);
      }
    }
    out.set(r.id, {
      at: doc.at, pr: h.pr, head: h.head, baseRef: doc.baseRef,
      base: shownBase(h.base),
      paired: doc.pairHeads.includes(h.pr),
      conflicts, unmeasuredWith,
      cut: { heads: doc.headsCut, pairs: doc.pairsCut, unbound },
    });
  }
  return out;
}
