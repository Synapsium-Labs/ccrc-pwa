// The load lines over the Overlord's accounts, and the two load readings the renewal readings piece wires (Overlord W1
// serviceability PR B, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4; spec §6.8
// Table 6.8a, C57 Table 3.4b, H16). Ring L1, context C1: pure decisions over facts the caller gathers. No I/O, no clock.
//
// A load line never folds an unmeasured account into a value (slug `under-is-proven-past-needs-all`): "under" is proven
// by any one candidate that can serve with a fresh load under the line; "past" needs every candidate at or past it, at
// any age, because inside a window a load only rises until the window resets.
import { LOAD_FRESH_S, LOAD_LINE_PCT, LOAD_LINES, type LineState, type LoadLine } from '../../shared/loadLines.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { ConditionReading } from '../../shared/overlord-ladder.js';
import { serviceability, type LaneFacts, type Serviceability } from '../../shared/serviceability.js';
import type { ModelClass } from '../../shared/models.js';
import type { Roster } from '../../shared/roster.js';
import { laneFactsOf, measured, type AccountLimits } from './limits.js';
import type { AccountFacts } from './coord/overlordDesignation.js';
// `Reading` is `continuity/renewalDue.ts#Reading` (L1, C3), imported as a type: an L1-to-L1 import across contexts, named
// by the plan (F17), so the renewal readings receive the type they declare.
import type { Reading } from './continuity/renewalDue.js';

/** The class an account falls back to when the designated one cannot serve (the plan's "the fallback (`opus`)"). */
export const LOAD_FALLBACK_CLASS: ModelClass = 'opus';

/** One candidate account. `serves`: `yes` when the designated class or the fallback is servable; `at-ceiling` when one is
 *  refused by the seven-day ceiling (a load refusal) and neither is servable; `unmeasured` otherwise. A candidate is never
 *  dropped for load (F1). */
export interface Candidate {
  readonly id: string; readonly limits: AccountLimits | undefined;
  readonly serves: 'yes' | 'at-ceiling' | 'unmeasured';
}
export type Candidates =
  | { readonly kind: 'candidates'; readonly list: readonly Candidate[] }
  | { readonly kind: 'not-designated' }
  | { readonly kind: 'unmeasured'; readonly why: 'designation-unreadable' };

/** What the candidates read: the tick's limits, each account's serviceability facts (`limits.ts#laneFactsOf`; a missing
 *  entry is unmeasured), and the time. */
export interface LoadFacts {
  readonly limits: Readonly<Record<string, AccountLimits>>;
  readonly lanes: Readonly<Record<string, LaneFacts>>;
  readonly nowS: number;
}

/** A refusal for load: the seven-day ceiling, on a class other than `fable` (Fable's `ceiling` is its share, not load). */
const loadRefusal = (cls: ModelClass, s: Serviceability): boolean => s.kind === 'unservable' && s.why === 'ceiling' && cls !== 'fable';

/** The Overlord's candidates: `list` is `overlordAccounts`' list for the designation's set and class (designation A),
 *  which the caller computes, since a designation read that is not `designated` has no set. Left out (F1): a signed-out
 *  account, and one whose two answers are both refused by a non-load word. Nobody designated is `not-designated`; an
 *  unreadable designation is `unmeasured`, never `not-designated` (the designation plan's X7). */
export function overlordLoadCandidates(read: DesignationRead, list: readonly string[], f: LoadFacts): Candidates {
  if (read.kind === 'unmeasured') return { kind: 'unmeasured', why: 'designation-unreadable' };
  if (read.kind === 'not-designated') return { kind: 'not-designated' };
  const cls = read.row.model;
  const out: Candidate[] = [];
  for (const id of list) {
    const limits = f.limits[id];
    if (limits?.authDead === true) continue;
    const lane = f.lanes[id];
    if (lane === undefined) { out.push({ id, limits, serves: 'unmeasured' }); continue; }
    const answers = ([cls, LOAD_FALLBACK_CLASS] as const).map((c) => ({ c, s: serviceability(c, lane, 'set-side', f.nowS) }));
    if (answers.some(({ s }) => s.kind === 'servable')) { out.push({ id, limits, serves: 'yes' }); continue; }
    if (answers.some(({ c, s }) => loadRefusal(c, s))) { out.push({ id, limits, serves: 'at-ceiling' }); continue; }
    if (answers.every(({ s }) => s.kind === 'unservable')) continue;
    out.push({ id, limits, serves: 'unmeasured' });
  }
  return { kind: 'candidates', list: out };
}

/** The account's load under the line, proven: `measured()` (the larger window, both read and unrolled) on a fresh reading. */
function freshLoad(l: AccountLimits | undefined, nowS: number): number | null {
  const m = measured(l);
  return m === null || l === undefined || l.ts === null || nowS - l.ts > LOAD_FRESH_S ? null : m;
}

/** The account's load as a lower bound, at any age: the larger of its read, unrolled windows. One known window bounds
 *  `max(five, seven)` from below, so it proves "past" alone and never "under" (slug `one-window-proves-past`). */
function pastLoad(l: AccountLimits | undefined): number | null {
  if (l === undefined) return null;
  const m = measured(l);
  if (m !== null) return m;
  const known = [
    l.fiveWindowMinutes === 0 || l.fiveRolledOver ? null : l.five,
    l.sevenRolledOver ? null : l.seven,
  ].filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

function lineState(pct: number, list: readonly Candidate[], nowS: number): LineState {
  if (list.length === 0) return { kind: 'unmeasured', why: 'no-candidate' };
  if (list.some((c) => { const v = c.serves === 'yes' ? freshLoad(c.limits, nowS) : null; return v !== null && v < pct; })) return { kind: 'under' };
  const past = list.map((c) => pastLoad(c.limits));
  if (past.every((v): v is number => v !== null && v >= pct)) return { kind: 'past', leastPct: Math.min(...past) };
  return { kind: 'unmeasured', why: 'stale' };
}

/** Every load line now, over the candidates (plan question 14, ruled F1). */
export function loadLines(list: readonly Candidate[], nowS: number): Readonly<Record<LoadLine, LineState>> {
  return Object.fromEntries(LOAD_LINES.map((l) => [l, lineState(LOAD_LINE_PCT[l], list, nowS)])) as Record<LoadLine, LineState>;
}

/** A load line as a ladder condition (Table 7.5a's 95% row, ruled F3): nobody designated lifts it; an unreadable
 *  designation, absent facts or an unmeasured line is `unmeasured`, which the ladder applies as its cap; `past` stands and
 *  `under` lifts. `listOf` is `overlordAccounts`' list for the designated row (designation A), asked only when designated. */
export function loadLineReading(read: DesignationRead, listOf: (row: DesignationView) => readonly string[], f: LoadFacts | null,
  line: LoadLine): ConditionReading {
  if (read.kind === 'unmeasured') return 'unmeasured';
  if (read.kind === 'not-designated') return 'lifted';
  if (f === null) return 'unmeasured';
  const c = overlordLoadCandidates(read, listOf(read.row), f);
  if (c.kind !== 'candidates') return c.kind === 'not-designated' ? 'lifted' : 'unmeasured';
  const s = loadLines(c.list, f.nowS)[line];
  return s.kind === 'past' ? 'standing' : s.kind === 'under' ? 'lifted' : 'unmeasured';
}

/** The facts the load lines read, from the tick's reading: `limits.ts#laneFactsOf` per roster account with no Fable share
 *  read. A share decides only Fable's answer, and Fable serves where `opus` does not only when the seven-day figure is at
 *  the ceiling (98, past every line) or unread (no fresh load, so no "under"), so no line reads differently without it
 *  (slug `load-lines-read-no-share`). */
export function loadFactsOf(roster: Roster, limits: Readonly<Record<string, AccountLimits>>,
  edges: ReadonlyMap<string, readonly string[]>, nowS: number): AccountFacts {
  const lanes: Record<string, LaneFacts> = {};
  for (const a of roster.accounts) lanes[a.id] = laneFactsOf(a, limits as Record<string, AccountLimits>, { kind: 'absent' });
  return { roster, limits, edges, lanes, nowS };
}

/** Table 3.4b's `classUnservable`, from the server's twin (slug `class-unservable-from-the-server-twin`). */
export function classUnservableReading(s: Serviceability): Reading<boolean> {
  switch (s.kind) {
    case 'unservable': return { kind: 'measured', value: true };
    case 'servable': case 'skipped': return { kind: 'measured', value: false };
    case 'unmeasured': return { kind: 'unmeasured', why: s.why };
    default: { const unreachable: never = s; return unreachable; }
  }
}

/** Table 3.4b's `accountLoadMove` (C57): only `others` that can serve are counted (F16). `true` when the current account
 *  is at or past `hard` and a counted other has a fresh load under `soft`; `false` when the current account has a fresh
 *  load under `hard`, or every counted other is at or past `soft` (no counted other is a `false` too); otherwise
 *  unmeasured, so a counted other nobody measured never reads as "no counted other". Idleness is the renewal lane's. */
export function accountLoadMoveReading(current: Candidate, others: readonly Candidate[], nowS: number): Reading<boolean> {
  const cur = freshLoad(current.limits, nowS);
  if (cur !== null && cur < LOAD_LINE_PCT.hard) return { kind: 'measured', value: false };
  const counted = others.filter((o) => o.serves === 'yes');
  const curPast = pastLoad(current.limits);
  if (curPast !== null && curPast >= LOAD_LINE_PCT.hard
    && counted.some((o) => { const v = freshLoad(o.limits, nowS); return v !== null && v < LOAD_LINE_PCT.soft; })) {
    return { kind: 'measured', value: true };
  }
  if (counted.every((o) => { const v = pastLoad(o.limits); return v !== null && v >= LOAD_LINE_PCT.soft; })) {
    return { kind: 'measured', value: false };
  }
  return { kind: 'unmeasured', why: 'load-unmeasured' };
}
