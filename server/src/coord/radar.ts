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
 * landing of the project `cut.unbound`: no landing can claim it was paired against that head. A row whose `.project`
 * would not read is held by the radar, so its branch is checked against every project's null-`id` heads
 * (`radarRowsOf`, wave 5a).
 */
import {
  RADAR_PROBE_FRESH_S, freshWithin, isRadarStamp, isRegistryId,
  type LandingConflict, type LandingMergeState, type SessionLanding,
} from '../../../shared/api.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';   // L0 vocabulary: absent | unreadable, declared once
import type { ProjectEvidence } from '../registry.js';   // type-only: no ring edge

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
  | { state: Extract<LandingMergeState, 'clean'> }
  | { state: Extract<LandingMergeState, 'conflict'>; paths: string[]; pathsCut: boolean }
  | { state: Extract<LandingMergeState, 'unmeasured'> };

export interface ProbeHead { pr: number; head: string; branch: string; id: string | null; base: ProbeAnswer }
export interface ProbePair { a: number; b: number; answer: ProbeAnswer }

/** A `probe` that passed every check of `parseProbe`. */
export interface ProbeDoc {
  project: string;
  at: string;
  baseRef: string;
  /** The producer's fetched base sha (`base.sha`, already validated as 40-hex): the only measured base of the wave. */
  baseSha: string;
  heads: ProbeHead[];
  headsCut: boolean;
  pairs: ProbePair[];
  pairHeads: number[];
  pairsCut: boolean;
}

export type ProbeRead =
  | { ok: true; doc: ProbeDoc }
  | { ok: false; reason: 'unreadable' | 'stale' | 'unmeasured' };

/** Why one control document (lander marker, probe, main health) is not a measurement. Wave 5i: every distinction survives
 *  to the binding decider. `oversize` is a file that is there and over its cap (`size` is what was measured), never an
 *  absence; `late` is the pass's deadline; `refused` a listed name that is no safe project segment; `unmeasured` an io
 *  that cannot answer, or a file that changed under the read. The legacy probe parser keeps its own `unreadable` for a
 *  malformed doc; the new parsers say `malformed`. */
export type ControlFailure = {
  ok: false;
  reason: ReadFailure | 'oversize' | 'malformed' | 'stale' | 'unmeasured' | 'late' | 'refused';
  size?: number;
};

/** The pre-pass marker `$REG/landing/<project>/lander` (producer `reconcile_enabled`): `{v:1, project, lander, at}`. */
export interface LanderDoc { project: string; lander: 'coordinator'; at: string }
export type LanderRead = { ok: true; doc: LanderDoc } | ControlFailure;

/** `$REG/landing/<project>/main-health`: the producer's verdict on the base tip's required checks. The producer's own
 *  `state` is authoritative; rendered names may collide after truncation, so nothing here recomputes a colour. */
export interface MainHealthDoc {
  project: string;
  at: string;
  sha: string | null;
  state: 'green' | 'red' | 'unmeasured';
  required: { name: string; app: number | null }[];
  failing: string[];
  pending: string[];
  why?: string;
}
export type MainHealthRead = { ok: true; doc: MainHealthDoc } | ControlFailure;

/** One bounded, coherent control bundle of a project (wave 5i): the three documents the binding head is decided from,
 *  each read on its own and each judged on its own window. */
export interface LandingControlRead {
  lander: LanderRead;
  probe: ProbeRead | ControlFailure;
  health: MainHealthRead;
}

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
  let baseSha = '';
  if (rawBase === null) {
    if (measured) return bad;
  } else {
    if (!isRecord(rawBase) || typeof rawBase.ref !== 'string' || rawBase.ref === '' || !isSha(rawBase.sha)) return bad;
    baseRef = rawBase.ref;
    baseSha = rawBase.sha;
  }
  if (measured ? o.why !== undefined : !isWhy(o.why)) return bad;

  if (typeof o.headsCut !== 'boolean' || typeof o.pairsCut !== 'boolean') return bad;
  // The radar's own stamp shape; a missing, non-string or odd-shaped `at` is no doc of the radar's, not a stale one.
  if (!isRadarStamp(o.at)) return bad;

  const rawHeads = o.heads;
  const rawPairs = o.pairs;
  const rawPairHeads = o.pairHeads;
  if (!Array.isArray(rawHeads) || !Array.isArray(rawPairs) || !Array.isArray(rawPairHeads)) return bad;
  if (!measured && (rawHeads.length > 0 || rawPairs.length > 0)) return bad;

  const heads: ProbeHead[] = [];
  const byPr = new Map<number, ProbeHead>();
  for (const e of rawHeads as unknown[]) {
    if (!isRecord(e) || !isPr(e.pr) || !isSha(e.head) || typeof e.branch !== 'string') return bad;
    // An `id` is `null` or a registry id: the empty string is no id, and is not `null` either (it would enter `pairHeads`
    // and never set `unbound`).
    if (e.id !== null && !isRegistryId(e.id)) return bad;
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
  const pairHeadSet = new Set<number>();
  for (const p of rawPairHeads as unknown[]) {
    const bound = isPr(p) ? byPr.get(p) : undefined;
    if (!isPr(p) || pairHeadSet.has(p) || bound === undefined || bound.id === null) return bad;
    pairHeads.push(p);
    pairHeadSet.add(p);
  }

  const pairs: ProbePair[] = [];
  const seen = new Set<string>();
  for (const e of rawPairs as unknown[]) {
    if (!isRecord(e) || !isPr(e.a) || !isPr(e.b) || e.a >= e.b) return bad;
    if (!pairHeadSet.has(e.a) || !pairHeadSet.has(e.b)) return bad;
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
      project, at: o.at as string, baseRef, baseSha, heads, headsCut: o.headsCut, pairs, pairHeads, pairsCut: o.pairsCut,
    },
  };
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNameList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isNonEmptyString);
const isAppId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** The lander marker's bytes, read against the project it must describe. Structure first (`malformed`, foreign project
 *  included), then the clock (`stale`). The marker is written in the tick's pre-pass, so its `at` is compared with
 *  nothing but the window. */
export function parseLander(content: string, project: string, nowMs: number): LanderRead {
  const bad = { ok: false, reason: 'malformed' } as const;
  const o = parseObject(content);
  if (o === null || o.v !== 1 || o.project !== project || o.lander !== 'coordinator' || !isRadarStamp(o.at)) return bad;
  if (!freshWithin(o.at, RADAR_PROBE_FRESH_S, nowMs)) return { ok: false, reason: 'stale' };
  return { ok: true, doc: { project, lander: 'coordinator', at: o.at } };
}

/** `main-health`'s bytes, read against the project it must describe. Green and red need a full sha and a non-empty
 *  required set with failing and pending names drawn from it (green: both empty; red: failing non-empty); an
 *  unmeasured doc keeps whatever lists the producer retained, with a null or full sha and a short non-empty `why`. */
export function parseMainHealth(content: string, project: string, nowMs: number): MainHealthRead {
  const bad = { ok: false, reason: 'malformed' } as const;
  const o = parseObject(content);
  if (o === null || o.v !== 1 || o.project !== project || !isRadarStamp(o.at)) return bad;
  if (o.state !== 'green' && o.state !== 'red' && o.state !== 'unmeasured') return bad;
  const state = o.state;
  if (o.sha !== null && !isSha(o.sha)) return bad;
  const rawRequired = o.required;
  if (!Array.isArray(rawRequired) || !isNameList(o.failing) || !isNameList(o.pending)) return bad;
  const required: { name: string; app: number | null }[] = [];
  for (const e of rawRequired as unknown[]) {
    if (!isRecord(e) || !isNonEmptyString(e.name) || (e.app !== null && !isAppId(e.app))) return bad;
    required.push({ name: e.name, app: e.app });
  }
  const failing = o.failing;
  const pending = o.pending;
  if (state === 'unmeasured') {
    if (!isWhy(o.why)) return bad;
  } else {
    if (o.why !== undefined || o.sha === null || required.length === 0) return bad;
    const names = new Set(required.map((e) => e.name));
    if (![...failing, ...pending].every((n) => names.has(n))) return bad;
    if (state === 'green' ? failing.length > 0 || pending.length > 0 : failing.length === 0) return bad;
  }
  if (!freshWithin(o.at, RADAR_PROBE_FRESH_S, nowMs)) return { ok: false, reason: 'stale' };
  return {
    ok: true,
    doc: { project, at: o.at, sha: o.sha, state, required, failing, pending, ...(state === 'unmeasured' ? { why: o.why as string } : {}) },
  };
}

/** A listed registry record of the doc's project, as the lane reads it (`sessionBranchOf` and `sessionPrOf` of
 *  `fleet.ts` are the two derivations the branch and the PR come from): the session's CURRENT branch, and its PR with
 *  `open` meaning `phase` is `'open'` or `'draft'` (D-7515: a draft is an open PR to GitHub and to the radar). */
export interface RadarRow {
  id: string;
  branch: string | null;
  pr: { number: number; open: boolean } | null;
}

/** The field's one reader (wave 5a, 4b F5): which rows each project's doc is matched against, and which branches the
 *  radar holds for a row it cannot place. A `measured` `.project` joins its project's rows. An `unreadable` one gives
 *  only its current branch, as `stray`: the row may belong to any project. An `absent` one joins nothing, as the
 *  radar's own `project_rows` treats a row with no `.project`. */
export function radarRowsOf<R extends { readonly project: string; readonly projectEvidence: ProjectEvidence }>(
  records: readonly R[], rowOf: (r: R) => RadarRow,
): { byProject: Map<string, RadarRow[]>; stray: ReadonlySet<string> } {
  const byProject = new Map<string, RadarRow[]>();
  const stray = new Set<string>();
  for (const r of records) {
    if (r.projectEvidence === 'measured') {
      const list = byProject.get(r.project);
      if (list === undefined) byProject.set(r.project, [rowOf(r)]); else list.push(rowOf(r));
    } else if (r.projectEvidence === 'unreadable') {
      const branch = rowOf(r).branch;
      if (branch !== null) stray.add(branch);
    }
  }
  return { byProject, stray };
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
  doc: ProbeDoc, rows: readonly RadarRow[], nowMs: number, stray: ReadonlySet<string>,
): Map<string, SessionLanding> {
  const out = new Map<string, SessionLanding>();
  if (!freshWithin(doc.at, RADAR_PROBE_FRESH_S, nowMs)) return out;

  // The branches some row is on now, and the `stray` ones (a row whose `.project` would not read, which may be this
  // project's): a null-`id` head on one is a fleet head the radar left out of its pairs.
  const rowBranches = new Set<string>();
  for (const r of rows) if (r.branch !== null) rowBranches.add(r.branch);
  const unbound = doc.heads.some((h) => h.id === null && (rowBranches.has(h.branch) || stray.has(h.branch)));

  const idCount = new Map<string, number>();
  for (const h of doc.heads) if (h.id !== null) idCount.set(h.id, (idCount.get(h.id) ?? 0) + 1);
  const headOfId = new Map<string, ProbeHead>();
  for (const h of doc.heads) if (h.id !== null && idCount.get(h.id) === 1) headOfId.set(h.id, h);

  for (const r of rows) {
    const h = headOfId.get(r.id);
    if (h === undefined || r.branch === null || h.branch !== r.branch) continue;
    // A row WITH a PR number matches only an open (or draft) PR of the head's number. One whose PR is merged or closed
    // keeps a number the radar no longer measures, and one whose sweep is backing off (`unknown`, `unchecked`) keeps its
    // number too, so it matches nothing while the sweep fails: it fails closed, deliberately (D-7515). A row with no
    // number (no PR yet) still matches by id and branch.
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
