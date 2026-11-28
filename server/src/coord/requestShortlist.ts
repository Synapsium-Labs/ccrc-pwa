// The code shortlist (context C5 Coordination, L1; Overlord W2 request record plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md` §7 and Tasks B1 and B2, ruling F5, RQ3 to RQ5). Pure: no
// node:* import, no fs, no SQL and no clock. The reader (`requestShortlistRead.ts`, L3) gathers the three reads and hands them
// here; every rule about what a read means, which paths are asked and how a programme ranks is in this file.
//
// - `touchedRequestOf`: the one history read an open makes (RQ5): the distinct paths of the first eight expected paths, in the
//   request's order, each on the path grammar `touchedPathOk` holds. Null when no path is asked.
// - `touchedAnswerOf`: what the read answered, as rows of (asked path, session, newest time), or why it could not be measured.
//   Every outcome has its own word, and none reads as "nothing touched": an agent that does not serve the verb, a link that is
//   down, a history that cannot be read, a busy slot and a deadline are each `unmeasured` with a word of their own. The items
//   are data from another box: each is bounded (count, length, characters) and must name the path it was asked; one that
//   does not is refused and the read is `partial`.
// - `touchedReadOf`: the rows mapped to programmes through the sessions' runs (a ccrc id in runs of two programmes counts
//   toward both, an id in none is dropped).
// - `codeShortlist`: Table 7, first match per programme, then ranked and cut at `SHORTLIST_MAX`. It reads no goals text.
//
// Each read the decider is handed says what it is: measured, partial (touched only) or unmeasured with its word, or, for touched,
// not asked. The answer carries those words back, so no caller can mistake an unread input for an empty one.
import { isRegistryId } from '../../../shared/api.js';
import {
  OVERLORD_HISTORY_OUTCOMES, OVERLORD_HISTORY_TOUCHED_PATHS_MAX, OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX, refusedAsUnknownVerb,
  type OverlordHistoryRequest,
} from '../../../shared/overlordHistory.js';
import { REQUEST_BOUNDS, SHORTLIST_MAX, type ExpectedPath } from '../../../shared/overlordRequests.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import { normalizeClaimPath, pathsOverlap } from './claims.js';
import type { HistoryReadOutcome } from './overlordHistory.js';

// ---------------------------------------------------------------------------------------------------------------- the words

/** Why a touched read could not be measured. Each is its own condition, never folded into another or into an empty read. */
export type TouchedUnmeasuredWhy =
  | 'busy' | 'deadline' | 'not-served' | 'link-down' | 'many-agents' | 'history-unreadable' | 'refused' | 'runs-unreadable';
const TOUCHED_UNMEASURED_WHY_MAP: Record<TouchedUnmeasuredWhy, true> = {
  busy: true, deadline: true, 'not-served': true, 'link-down': true, 'many-agents': true, 'history-unreadable': true,
  refused: true, 'runs-unreadable': true,
};
export const TOUCHED_UNMEASURED_WHYS = Object.keys(TOUCHED_UNMEASURED_WHY_MAP) as TouchedUnmeasuredWhy[];

/** Why a touched read covers less than it was asked. A partial read lists every why that holds, in this order. */
export type TouchedPartialWhy = 'more-than-eight' | 'path-refused' | 'budget' | 'shown-below-total' | 'item-refused';
const TOUCHED_PARTIAL_WHY_MAP: Record<TouchedPartialWhy, true> = {
  'more-than-eight': true, 'path-refused': true, budget: true, 'shown-below-total': true, 'item-refused': true,
};
export const TOUCHED_PARTIAL_WHYS = Object.keys(TOUCHED_PARTIAL_WHY_MAP) as TouchedPartialWhy[];

/** Why the programmes or the claims could not be read. */
export type ShortlistReadWhy = 'programmes-unreadable' | 'claims-unreadable';
const SHORTLIST_READ_WHY_MAP: Record<ShortlistReadWhy, true> = { 'programmes-unreadable': true, 'claims-unreadable': true };
export const SHORTLIST_READ_WHYS = Object.keys(SHORTLIST_READ_WHY_MAP) as ShortlistReadWhy[];

/** The shortlist's basis: matched on expected paths, or on live claims alone (RQ4: no expected path). */
export type ShortlistBasis = 'paths' | 'claims-only';
const SHORTLIST_BASIS_MAP: Record<ShortlistBasis, true> = { paths: true, 'claims-only': true };
export const SHORTLIST_BASES = Object.keys(SHORTLIST_BASIS_MAP) as ShortlistBasis[];

/** The kinds a read answers. */
export type ShortlistReadKind = 'measured' | 'partial' | 'unmeasured' | 'not-asked';
const SHORTLIST_READ_KIND_MAP: Record<ShortlistReadKind, true> = { measured: true, partial: true, unmeasured: true, 'not-asked': true };
export const SHORTLIST_READ_KINDS = Object.keys(SHORTLIST_READ_KIND_MAP) as ShortlistReadKind[];

/** Whether a kebab word is one this file or its reader names (the coordination directory's kebab-token census admits a word
 *  only from its declared home): its own maps, and the history op's outcomes it reads (`OVERLORD_HISTORY_OUTCOMES`, L0). */
export const isShortlistKebab = (word: string): boolean =>
  Object.hasOwn(TOUCHED_UNMEASURED_WHY_MAP, word) || Object.hasOwn(TOUCHED_PARTIAL_WHY_MAP, word)
  || Object.hasOwn(SHORTLIST_READ_WHY_MAP, word) || Object.hasOwn(SHORTLIST_BASIS_MAP, word)
  || Object.hasOwn(SHORTLIST_READ_KIND_MAP, word) || (OVERLORD_HISTORY_OUTCOMES as readonly string[]).includes(word);

// ---------------------------------------------------------------------------------------------------------------- the bounds

/** The door's wait for the one touched read, read through the time port (RQ5, Table 11.5b's spec-fix list). Above the
 *  runner's own budget (`ccd/history/overlord-read.mjs#TOUCHED_OPEN_BUDGET_MS`, 4 s), so a read that stops at its budget is
 *  answered before the door gives up; request-shortlist-read.test.ts holds the order. */
export const TOUCHED_OPEN_WAIT_MS = 5_000;
/** The paths one touched read carries: the history op's own bound (RQ5). */
export const SHORTLIST_TOUCHED_PATHS = OVERLORD_HISTORY_TOUCHED_PATHS_MAX;

/** A path's characters: the CLI `touched` reads a path in `[A-Za-z0-9_./-]` only (`ccd/history/lib.mjs#classifyRef`), so
 *  no control, glob, colon or space character is ever asked or taken (RQ3, F12). */
const PATH_CHARS = /^[A-Za-z0-9_./-]+$/;

/** Whether `p` is a path touched may be asked, and an answer item may name: a normalised relative path (`normalizeClaimPath`
 *  answers it unchanged, so no `..`, no absolute path, nothing that leaves its project), within the path bound, in the CLI's
 *  path characters and with no leading `-` (which the CLI would read as an option). */
export function touchedPathOk(p: unknown): p is string {
  return typeof p === 'string' && !p.startsWith('-') && PATH_CHARS.test(p) && utf8Bytes(p) <= REQUEST_BOUNDS.pathBytes
    && normalizeClaimPath(p) === p;
}

// ----------------------------------------------------------------------------------------------------------------- the reads

export interface ClaimByProgramme {
  readonly programme: string;
  readonly project: string;
  readonly paths: readonly string[];
  readonly renewedAt: number;
}
export type ClaimsRead =
  | { readonly kind: 'measured'; readonly claims: readonly ClaimByProgramme[] }
  | { readonly kind: 'unmeasured'; readonly why: 'claims-unreadable' };
export type LiveRead =
  | { readonly kind: 'measured'; readonly live: ReadonlySet<string> }
  | { readonly kind: 'unmeasured'; readonly why: 'programmes-unreadable' };

/** One session's mark on an asked path: a programme it ran in, that run's project, the path and its newest time. */
export interface TouchedHit {
  readonly programme: string;
  readonly project: string;
  readonly file: string;
  readonly latestMs: number | null;
}
export type TouchedRead =
  | { readonly kind: 'measured'; readonly hits: readonly TouchedHit[] }
  | { readonly kind: 'partial'; readonly hits: readonly TouchedHit[]; readonly why: readonly TouchedPartialWhy[] }
  | { readonly kind: 'unmeasured'; readonly why: TouchedUnmeasuredWhy }
  | { readonly kind: 'not-asked' };

// ---------------------------------------------------------------------------------------------------------------- the request

/** The one touched read: the paths it asks, and the words that already hold before it is sent. */
export interface TouchedRequest {
  readonly request: OverlordHistoryRequest;
  readonly paths: readonly string[];
  readonly partial: readonly TouchedPartialWhy[];
}

/** The one history read an open makes (RQ5), or null when there is no path to ask (`not-asked`, or only refused paths). The
 *  first eight expected paths in their stated order, each path once (touched reads a path, not a project), every one on the
 *  path grammar; a path off it is not asked (`path-refused`), and a ninth path is not read (`more-than-eight`). */
export function touchedRequestOf(expected: readonly ExpectedPath[]): TouchedRequest | null {
  const first = expected.slice(0, SHORTLIST_TOUCHED_PATHS);
  const paths: string[] = [];
  let refused = false;
  for (const e of first) {
    if (!touchedPathOk(e.path)) { refused = true; continue; }
    if (!paths.includes(e.path)) paths.push(e.path);
  }
  const partial = TOUCHED_PARTIAL_WHYS.filter((w) =>
    (w === 'more-than-eight' && expected.length > SHORTLIST_TOUCHED_PATHS) || (w === 'path-refused' && refused));
  if (paths.length === 0) return null;
  return { request: { verb: 'touched', target: { kind: 'all' }, agents: false, args: paths }, paths, partial };
}

// ----------------------------------------------------------------------------------------------------------------- the answer

/** One session on one asked path, as the answer named it. */
export interface TouchedRow { readonly path: string; readonly ccrcId: string; readonly latestMs: number | null }
export type TouchedAnswer =
  | { readonly kind: 'rows'; readonly rows: readonly TouchedRow[]; readonly partial: readonly TouchedPartialWhy[] }
  | { readonly kind: 'unmeasured'; readonly why: TouchedUnmeasuredWhy };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const timeOk = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);

/** One item, or null when it is off its shape: the asked index it answers, whether it is whole, and its sessions. A session
 *  off its shape (an id off the registry grammar, a time that is not a count) makes the whole item refused. */
function itemOf(v: unknown, i: number, paths: readonly string[]):
  { readonly whole: boolean; readonly rows: readonly TouchedRow[] } | null {
  if (!isObj(v) || v['asked'] !== i || typeof v['whole'] !== 'boolean' || !Array.isArray(v['sessions'])) return null;
  // The item must name the path it was asked, so its path is one `touchedPathOk` passed (`touchedRequestOf`), and an item
  // past the asked paths names none.
  const file = paths[i];
  if (file === undefined || v['file'] !== file) return null;
  const sessions = v['sessions'] as unknown[];
  if (sessions.length > OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX) return null;
  const rows: TouchedRow[] = [];
  for (const s of sessions) {
    if (!isObj(s) || !isRegistryId(s['ccrcId']) || !timeOk(s['latestMs'])) return null;
    rows.push({ path: file, ccrcId: s['ccrcId'], latestMs: s['latestMs'] });
  }
  return { whole: v['whole'], rows };
}

/** What the one touched read answered (`asked` is `touchedRequestOf`'s answer; `linkDown`: some agent link is not connected).
 *  Total over every outcome; the order of the cases is the order a reader should check them in. */
export function touchedAnswerOf(o: HistoryReadOutcome, asked: TouchedRequest, linkDown: boolean): TouchedAnswer {
  const no = (why: TouchedUnmeasuredWhy): TouchedAnswer => ({ kind: 'unmeasured', why });
  switch (o.kind) {
    case 'no-agent': return no(linkDown ? 'link-down' : 'not-served');
    case 'many-agents': return no('many-agents');
    case 'unsupported': return no('not-served');
    case 'not-started': return no('link-down');
    case 'lost': return no('link-down');
    case 'timeout': return no('deadline');
    case 'answer': break;
  }
  const a = o.answer;
  switch (a.outcome) {
    case 'busy': return no('busy');
    case 'deadline': return no('deadline');
    // An agent built before `touched` refuses the verb with the word its request reader gives any verb it does not know.
    case 'request-refused': return no(refusedAsUnknownVerb(a.word) ? 'not-served' : 'refused');
    case 'verb-refused': return no('history-unreadable');
    case 'store-refused': return no('history-unreadable');
    case 'too-large': return no('history-unreadable');
    case 'failed': return no('history-unreadable');
    case 'rows': break;
  }
  const rows: TouchedRow[] = [];
  let refused = false;
  let cut = false;
  a.items.forEach((item, i) => {
    const it = itemOf(item, i, asked.paths);
    if (it === null) { refused = true; return; }
    if (!it.whole) cut = true;
    rows.push(...it.rows);
  });
  const budget = a.items.length < asked.paths.length || a.shown < a.total;
  const partial = TOUCHED_PARTIAL_WHYS.filter((w) => asked.partial.includes(w) || (w === 'budget' && budget)
    || (w === 'shown-below-total' && cut) || (w === 'item-refused' && refused));
  return { kind: 'rows', rows, partial };
}

/** The runs a ccrc id ran in: each programme and the project the session worked in. */
export interface SessionRun { readonly programme: string; readonly project: string }
export type SessionRunsRead =
  | { readonly kind: 'measured'; readonly runs: ReadonlyMap<string, readonly SessionRun[]> }
  | { readonly kind: 'unmeasured' };

/** The answer as hits by programme: each row once per programme its session ran in (a session in runs of two programmes counts
 *  toward both); a session with no run is dropped. An unreadable runs read leaves the read unmeasured, never empty. */
export function touchedReadOf(answer: TouchedAnswer, runs: SessionRunsRead): TouchedRead {
  if (answer.kind === 'unmeasured') return answer;
  if (runs.kind === 'unmeasured') return { kind: 'unmeasured', why: 'runs-unreadable' };
  const hits: TouchedHit[] = [];
  for (const r of answer.rows) {
    for (const run of runs.runs.get(r.ccrcId) ?? []) hits.push({ programme: run.programme, project: run.project, file: r.path, latestMs: r.latestMs });
  }
  return answer.partial.length === 0 ? { kind: 'measured', hits } : { kind: 'partial', hits, why: answer.partial };
}

// -------------------------------------------------------------------------------------------------------------- the decider

export interface ShortlistCandidate {
  readonly programme: string;
  readonly claimHits: number;
  readonly touchedHits: number;
  readonly newest: number | null;
}
export interface Shortlist {
  /** At most `SHORTLIST_MAX`, ranked. */
  readonly candidates: readonly ShortlistCandidate[];
  readonly basis: ShortlistBasis;
  /** What each read was, so an unread input never reads as an empty one. */
  readonly live: LiveRead['kind'];
  readonly claims: ClaimsRead['kind'];
  readonly touched: TouchedRead['kind'];
  /** The touched read's words: its partial whys, or its one unmeasured why; empty when measured or not asked. */
  readonly touchedWhy: readonly (TouchedPartialWhy | TouchedUnmeasuredWhy)[];
}
export interface ShortlistInput {
  readonly expected: readonly ExpectedPath[];
  readonly claims: ClaimsRead;
  readonly touched: TouchedRead;
  readonly live: LiveRead;
}

const newer = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
const sameExpected = (a: ExpectedPath, b: ExpectedPath): boolean => a.project === b.project && a.path === b.path;

/** Table 7, total over every input. Step 1: a programme not live is never a candidate (an unreadable programmes read leaves
 *  none). Step 2: with no expected path, every programme holding a live claim is one, its `claimHits` its distinct claimed
 *  paths (RQ4). Step 3: `claimHits` counts the expected paths a live claimed path of that programme overlaps in the same project
 *  (`pathsOverlap`: a directory covers what is under it). Step 4: `touchedHits` counts the expected paths a touched hit of that
 *  programme names exactly, in the same project, so a directory reaches a programme only through claims; an unmeasured read
 *  adds none. Step 5: no hit, no candidate. Step 6: more claim hits, then more touched hits, then the newest claim or touch,
 *  then slug; cut at `SHORTLIST_MAX`. */
export function codeShortlist(input: ShortlistInput): Shortlist {
  const expected = input.expected.filter((e, i) => input.expected.findIndex((x) => sameExpected(x, e)) === i);
  const basis: ShortlistBasis = expected.length === 0 ? 'claims-only' : 'paths';
  const claims = input.claims.kind === 'measured' ? input.claims.claims : [];
  const hits = input.touched.kind === 'measured' || input.touched.kind === 'partial' ? input.touched.hits : [];
  const touchedWhy = input.touched.kind === 'partial' ? input.touched.why
    : input.touched.kind === 'unmeasured' ? [input.touched.why] : [];
  const live = input.live.kind === 'measured' ? input.live.live : new Set<string>();

  const programmes = [...new Set([...claims.map((c) => c.programme), ...hits.map((h) => h.programme)])].filter((p) => live.has(p));
  const candidates: ShortlistCandidate[] = [];
  for (const programme of programmes) {
    const own = claims.filter((c) => c.programme === programme);
    const ownHits = hits.filter((h) => h.programme === programme);
    let claimHits = 0;
    let touchedHits = 0;
    let newest: number | null = null;
    if (basis === 'claims-only') {
      claimHits = new Set(own.flatMap((c) => c.paths.map((p) => `${c.project}\0${p}`))).size;
      for (const c of own) newest = newer(newest, c.renewedAt);
    } else {
      for (const e of expected) {
        const meeting = own.filter((c) => c.project === e.project && c.paths.some((p) => pathsOverlap(e.path, p)));
        if (meeting.length > 0) claimHits += 1;
        for (const c of meeting) newest = newer(newest, c.renewedAt);
        const touching = ownHits.filter((h) => h.project === e.project && h.file === e.path);
        if (touching.length > 0) touchedHits += 1;
        for (const h of touching) newest = newer(newest, h.latestMs);
      }
    }
    if (claimHits + touchedHits === 0) continue;
    candidates.push({ programme, claimHits, touchedHits, newest });
  }
  candidates.sort((a, b) => b.claimHits - a.claimHits || b.touchedHits - a.touchedHits
    || (b.newest ?? -1) - (a.newest ?? -1) || (a.programme < b.programme ? -1 : a.programme > b.programme ? 1 : 0));
  return {
    candidates: candidates.slice(0, SHORTLIST_MAX), basis, live: input.live.kind, claims: input.claims.kind,
    touched: input.touched.kind, touchedWhy,
  };
}
