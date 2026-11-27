// The console's view of one project's landing line (landing order wave 5k). L1: the wire guard over `GET /api/landing`'s
// answer, the card's view model, the withdraw sheet's preview, and the per-card state one read leaves. Pure: types and
// the shared vocabulary's readers, the PWA's guard kit, its one structural equality and the line's words; never a
// screen, a store or `lib/api.ts`.
//
// The console decides nothing about the line (the plan's Global Constraints). The order, the head, the pause and each
// wait are the read's own fields; the one edge read here is the sheet's preview of direct dependants, which the sheet
// labels "as this page read the line".
import type {
  LandingEntry, LandingHold, LandingLineView, LandingOrder, LandingPauseBy, LandingWait,
} from '../../../shared/landingLine';
import { LANDING_ENTRY_TERMINAL, LANDING_PAUSE_BYS, isLandingEjectionKind, isLandingEntryState } from '../../../shared/landingLine';
import { isNum, isOneOf, isRecord } from '../lib/wire';
import { sameJson } from '../lib/sameJson';
import type { PollOutcome } from '../lib/usePoll';
import {
  EJECTED_TEXT, PAUSE_LABEL, ROLE_TEXT, STATUS_HELD, STATUS_NONE_READY, STATUS_PAUSED, STATUS_RED_FIXES_MAIN, STATUS_RUNNING,
  UNREADABLE_ANSWER_TEXT, WAITS_TEXT, landingFailureOf, type LandingFailure,
} from './landingWords';

const ENTRIES_SCOPES: readonly NonNullable<LandingLineView['entriesScope']>[] = ['open', 'pr'];
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNumList = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);

function entryOf(v: unknown): LandingEntry | null {
  if (!isRecord(v)) return null;
  const { id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind, ejections, afterIds, fixesMain, setBy, pinnedAt } = v;
  if (!isNum(id) || !isStr(project) || !isNum(pr) || !isStr(pinnedSha) || !isStr(handoffCommit)) return null;
  if (!(runId === null || isNum(runId)) || !isLandingEntryState(state) || !(baseSha === null || isStr(baseSha))) return null;
  if (!(ejectionKind === null || isLandingEjectionKind(ejectionKind)) || !isNum(ejections) || !isNumList(afterIds)) return null;
  if (!isBool(fixesMain) || !isStr(setBy) || !isNum(pinnedAt)) return null;
  return { id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind, ejections, afterIds: [...afterIds], fixesMain, setBy, pinnedAt };
}
function entriesOf(v: unknown): LandingEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: LandingEntry[] = [];
  for (const x of v) { const e = entryOf(x); if (e === null) return null; out.push(e); }
  return out;
}
function holdOf(v: unknown): LandingHold | undefined | null {
  if (v === undefined) return undefined;
  if (!isRecord(v) || v['reason'] !== 'landing-recovery-unresolved' || !isNumList(v['subjectIds'])) return null;
  return { reason: 'landing-recovery-unresolved', subjectIds: [...v['subjectIds']] };
}
function waitsOf(v: unknown): LandingWait[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return null;
  const out: LandingWait[] = [];
  for (const w of v) {
    if (!isRecord(w) || !isNum(w['entryId']) || w['reason'] !== 'withdrawn' || !Array.isArray(w['on'])) return null;
    const on: { entryId: number; pr: number }[] = [];
    for (const t of w['on'] as unknown[]) {
      if (!isRecord(t) || !isNum(t['entryId']) || !isNum(t['pr'])) return null;
      on.push({ entryId: t['entryId'], pr: t['pr'] });
    }
    out.push({ entryId: w['entryId'], reason: 'withdrawn', on });
  }
  return out;
}
function orderOf(v: unknown): LandingOrder | null {
  if (!isRecord(v) || !isBool(v['paused'])) return null;
  const order = entriesOf(v['order']);
  const held = holdOf(v['held']);
  const waits = waitsOf(v['waits']);
  if (order === null || held === null || waits === null) return null;
  const extra = { ...(held === undefined ? {} : { held }), ...(waits === undefined ? {} : { waits }) };
  if (v['paused']) {
    const by = v['by'];
    if (!Array.isArray(by) || !by.every((b) => isOneOf(LANDING_PAUSE_BYS, b))) return null;
    return { paused: true, by: [...by] as LandingPauseBy[], order, ...extra };
  }
  const head = v['head'] === null ? null : entryOf(v['head']);
  if (head === null && v['head'] !== null) return null;
  return { paused: false, order, head, ...extra };
}

/** The wire guard: `{ok: true, ...LandingLineView}` with the fields the console reads, or `null`. Additive fields pass and
 *  are not kept: the answer it returns has no `binding` and no `recovery`, which the console does not draw. */
export function readLandingLine(raw: unknown): LandingLineView | null {
  if (!isRecord(raw) || raw['ok'] !== true) return null;
  const { project, operatorPaused, mainRedHold, entriesScope } = raw;
  if (!isStr(project) || !isBool(operatorPaused) || !isBool(mainRedHold)) return null;
  const entries = entriesOf(raw['entries']);
  const order = orderOf(raw['order']);
  if (entries === null || order === null) return null;
  const scope = isOneOf(ENTRIES_SCOPES, entriesScope) ? { entriesScope } : {};
  return { project, operatorPaused, mainRedHold, entries, order, ...scope };
}

/** The one reader of "this entry has no run" (the plan's section 11, C7): a row's tag, the preview and the door's answer. */
export const landingRunless = (entry: Pick<LandingEntry, 'runId'>): boolean => entry.runId === null;

/** The read's entries still in the line: an older server's `entries` were every entry. */
const openOf = (view: LandingLineView): LandingEntry[] => view.entries.filter((e) => !LANDING_ENTRY_TERMINAL[e.state]);

export type LandingRowRole = 'head' | 'waits' | 'in-line' | 'ejected' | 'unknown';
/** Every row is an open entry, and every open entry offers `Withdraw…` (R1): the server, not the row, decides. */
export interface LandingRow { entryId: number; pr: number; role: LandingRowRole; text: string; fixesMain: boolean; runless: boolean }
export type LandingStatus =
  | { kind: 'running'; headPr: number | null } | { kind: 'paused'; by: LandingPauseBy[]; held: boolean }
  | { kind: 'held' } | { kind: 'red-fixes-main'; headPr: number };
export interface LandingLineCard {
  project: string; status: LandingStatus; statusText: string; rows: LandingRow[];
  pauseLabel: string; pauseBusyLabel: string; pauseNext: boolean;
}

function statusOf(view: LandingLineView): LandingStatus {
  const o = view.order;
  if (o.paused) return { kind: 'paused', by: [...o.by], held: o.held !== undefined };
  if (o.held !== undefined) return { kind: 'held' };
  if (view.mainRedHold && o.head !== null && o.head.fixesMain) return { kind: 'red-fixes-main', headPr: o.head.pr };
  return { kind: 'running', headPr: o.head?.pr ?? null };
}
const STATUS_TEXT: { readonly [K in LandingStatus['kind']]: (s: Extract<LandingStatus, { kind: K }>) => string } = {
  running: (s) => (s.headPr === null ? STATUS_NONE_READY : STATUS_RUNNING(s.headPr)),
  paused: (s) => STATUS_PAUSED(s.by) + (s.held ? ` ${STATUS_HELD}` : ''),
  held: () => STATUS_HELD,
  'red-fixes-main': (s) => STATUS_RED_FIXES_MAIN(s.headPr),
};
const statusTextOf = (s: LandingStatus): string => (STATUS_TEXT[s.kind] as (x: LandingStatus) => string)(s);

function rowOf(e: LandingEntry, view: LandingLineView): LandingRow {
  const o = view.order;
  const base = { entryId: e.id, pr: e.pr, fixesMain: e.fixesMain, runless: landingRunless(e) };
  if (e.state === 'ejected') return { ...base, role: 'ejected', text: EJECTED_TEXT(e.ejectionKind) };
  if (e.state === 'unknown') return { ...base, role: 'unknown', text: ROLE_TEXT.unknown };
  if (!o.paused && o.head !== null && o.head.id === e.id) return { ...base, role: 'head', text: ROLE_TEXT.head };
  const wait = o.waits?.find((w) => w.entryId === e.id);
  if (wait !== undefined) return { ...base, role: 'waits', text: WAITS_TEXT(wait.on.map((t) => t.pr)) };
  return { ...base, role: 'in-line', text: ROLE_TEXT['in-line'] };
}

/** `null` when there is nothing to say: no open entry and no operator pause (Q2: main red alone says nothing). */
export function landingCardOf(view: LandingLineView): LandingLineCard | null {
  const open = openOf(view);
  if (open.length === 0 && !view.operatorPaused) return null;
  const byId = new Map(open.map((e) => [e.id, e]));
  const seen = new Set<number>();
  const ordered: LandingEntry[] = [];
  for (const x of [...view.order.order.map((e) => byId.get(e.id)), ...open]) {
    if (x === undefined || seen.has(x.id)) continue;
    seen.add(x.id);
    ordered.push(x);
  }
  const status = statusOf(view);
  return {
    project: view.project, status, statusText: statusTextOf(status), rows: ordered.map((e) => rowOf(e, view)),
    pauseLabel: view.operatorPaused ? PAUSE_LABEL.resume : PAUSE_LABEL.pause,
    pauseBusyLabel: view.operatorPaused ? PAUSE_LABEL.resuming : PAUSE_LABEL.pausing,
    pauseNext: !view.operatorPaused,
  };
}

/** The sheet's snapshot (R3): the entry as read, its DIRECT dependants as read, and the view they were read from (for the
 *  answer's PRs). */
export interface WithdrawPreview {
  entry: LandingEntry; dependants: { entryId: number; pr: number }[]; runless: boolean; view: LandingLineView;
}
/** The entry and its DIRECT dependants as read (open entries whose `afterIds` name it); `null` when it is not open. An
 *  `unknown` entry has a preview like any other (R1). */
export function withdrawPreviewOf(view: LandingLineView, entryId: number): WithdrawPreview | null {
  const open = openOf(view);
  const entry = open.find((e) => e.id === entryId);
  if (entry === undefined) return null;
  const dependants = open.filter((e) => e.id !== entryId && e.afterIds.includes(entryId)).map((e) => ({ entryId: e.id, pr: e.pr }));
  return { entry, dependants, runless: landingRunless(entry), view };
}

export type LandingCardState =
  | { kind: 'none' }
  | { kind: 'line'; view: LandingLineView; card: LandingLineCard; stale: LandingFailure | null };
const NONE: LandingCardState = { kind: 'none' };

/** One card's next state from its previous state and one read's outcome (D-9109, round 2): a failure is drawn only over a
 *  line already drawn, and `absent` (`not-configured`) draws nothing anywhere. */
export function landingCardStateOf(prev: LandingCardState | undefined, outcome: PollOutcome): LandingCardState {
  let failure: LandingFailure;
  if (outcome.ok) {
    const view = readLandingLine(outcome.raw);
    if (view !== null) {
      const card = landingCardOf(view);
      return card === null ? NONE : { kind: 'line', view, card, stale: null };
    }
    failure = { text: UNREADABLE_ANSWER_TEXT, scope: 'box', outcomeUnknown: false };
  } else {
    failure = landingFailureOf(outcome.err, 'read');
  }
  if (failure.scope === 'absent' || prev === undefined || prev.kind === 'none') return NONE;
  return { kind: 'line', view: prev.view, card: prev.card, stale: failure };
}

/** What the sheet would send and preview: the open entries' identity, state, pin time, run and order. */
const sentOf = (view: LandingLineView) => openOf(view).map((e) => ({ id: e.id, pr: e.pr, state: e.state, pinnedAt: e.pinnedAt, runId: e.runId, afterIds: e.afterIds }));
/** Equal when the card draws the same thing and the sheet would send and preview the same (m3): `card`, `stale` and the
 *  open entries' `id`, `pr`, `state`, `pinnedAt`, `runId` and `afterIds`, compared by `sameJson`; never the raw view. A
 *  re-pin changes `pinnedAt`, so it gives a new state object, which is what lets the sheet adopt it after a refusal (R3). */
export function sameLandingState(a: LandingCardState, b: LandingCardState): boolean {
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  return sameJson(a.card, b.card) && sameJson(a.stale, b.stale) && sameJson(sentOf(a.view), sentOf(b.view));
}

const HOLD_LETTER: { readonly [K in LandingStatus['kind']]: (s: Extract<LandingStatus, { kind: K }>) => string } = {
  running: (s) => (s.headPr === null ? 'n' : 'r'),
  paused: (s) => (s.held ? 'q' : 'p'),
  held: () => 'h',
  'red-fixes-main': () => 'm',
};
/** The card's part of `FleetCards`' view-hold key (F8, R8): `''` for `none` or no state; else the row count, then the
 *  status kind's letter (`r` running with a head, `n` running with none ready, `p` paused, `q` paused and held, `h` held,
 *  `m` red with a fixing head), then `s` while the stale sentence shows. */
export function landingLineHoldPart(state: LandingCardState | undefined): string {
  if (state === undefined || state.kind === 'none') return '';
  const s = state.card.status;
  return `${state.card.rows.length}${(HOLD_LETTER[s.kind] as (x: LandingStatus) => string)(s)}${state.stale === null ? '' : 's'}`;
}
