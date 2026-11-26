// The Overlord's readiness word, its deciders (Overlord spec §6.4, Table 6.4a, C23, H20, C56, C57; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md` Task 1). Ring L1, context C5: pure decisions, no I/O and no
// clock (every time arrives as an argument). Six functions:
// - `readinessFactsOf` maps each producer's raw answer (the lane's gather) to one fact: every mapping of the plan's Table 2
//   but the body, which is designation B's one mapper (`overlordBodyOf`);
// - `overlordReadiness` is Table 6.4a, first match, and an unmeasured input answers `unmeasured` at the first row that
//   reads it, naming the input (question 2), so the word only ever falls with doubt;
// - `readinessNotices` decides what the operator is told: the dead push on the episode's edge, and which items to raise,
//   settle and close;
// - `servedReadiness` decides what the door and the board are served: the stored word while this process's lane is
//   fresh, else `unmeasured` with `boot` or `stale` (fix round 1, F2);
// - `readinessPushOf` and `readinessItemTextOf` decide the words of the dead push and of each item (plan Task 4), from L0's
//   text data and the pass's readings: an unreadable input reads "unmeasured" in the text, never a throw.
// Runtime imports: L0, designation B's L1 module, the renewal act's `RENEWING_STATES` and the stall watch's StopFailure
// classifier (`stopFailureClass`, L1); every other import is a type.
import {
  READINESS_DEAF_MS, READINESS_DIALOG_MS, READINESS_FRESH_MS, READINESS_HOOK_QUIET_MS, READINESS_ITEM_TEXT,
  READINESS_LONG_TURN_MS, READINESS_PUSH_TEXT, READINESS_RESTART_BOUND_MS, READINESS_RESTARTS_PER_HOUR, READINESS_SERVED_WHY,
  READINESS_WORDS, isReadinessWord, isStrandCause,
  type ReadinessItemKind, type ReadinessItemText, type ReadinessWire, type ReadinessWord, type StrandCause,
} from '../../../shared/overlord-readiness.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { GenerationState } from '../../../shared/continuity.js';
import type { ItemState } from '../../../shared/ledgers.js';
import type { EarliestReset } from '../../../shared/loadLines.js';
import type { Rung } from '../../../shared/overlord-ladder.js';
import type { MarkerState, SessionStatus } from '../../../shared/api.js';
import { restartVerdict, type OverlordBodyState } from './overlordDesignation.js';
import { RENEWING_STATES } from '../continuity/renewalFeed.js';
import { stopFailureClass } from './stopFailure.js';
import type { Candidates } from '../accountLoad.js';
import type { TurnMarkRead } from './stall.js';
import type { HookStateRead } from '../hookstate.js';
import type { MessageFacts } from './overlordInbox.js';

// ── The facts ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Fact<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };
/** A fact whose input this build may not have yet (question 6): `not-built` is "this row has no input", never a measured no. */
export type Buildable<T> = Fact<T> | { readonly kind: 'not-built' };
const measured = <T>(value: T): Fact<T> => ({ kind: 'measured', value });
const unmeasured = (why: string): { readonly kind: 'unmeasured'; readonly why: string } => ({ kind: 'unmeasured', why });

/** The generation as the decider reads it: renewing (with its deadline), degraded, or proven. */
export type GenerationFact = { readonly kind: 'renewing'; readonly until: number | null } | { readonly kind: 'degraded' }
  | { readonly kind: 'proven' };

/** Everything `overlordReadiness` reads. The body is designation B's `OverlordBodyState`, with `down.since` the lane's own first
 *  sighting. */
export interface ReadinessFacts {
  readonly subject: Fact<{ readonly sessionId: string; readonly bound: boolean } | null>;
  readonly off: Fact<'rung' | 'mail-disabled' | null>;
  /** Unmeasured with why `boot` on this process's first pass, and `registry` on a failed listing. */
  readonly registry: Fact<'read'>;
  readonly body: OverlordBodyState;
  /** `restartsSince` over the hour, plus the restart in progress (question 3). */
  readonly restarts: Fact<number>;
  readonly generation: Fact<GenerationFact>;
  readonly stranded: Fact<StrandCause | null>;
  readonly dialogSince: number | null;
  readonly wedged: Fact<boolean>;
  /** The operator-message half of `deaf`. */
  readonly deaf: Buildable<boolean>;
  /** The held-rows half of `deaf`: W1 has no held rows, so `not-built`. */
  readonly heldDeaf: Buildable<boolean>;
  /** W1 has no admission test, so `not-built`. */
  readonly saturated: Buildable<boolean>;
  readonly proofAt: Fact<number | null>;
  /** The `at` of the first row after the newest `ready` row, or null (the word never left `ready`, or was never `ready`). */
  readonly leftReadyAt: number | null;
  /** Designation B's `restartVerdict(...).ok`: the Restart door would act. */
  readonly restartable: boolean;
}

export interface ReadinessAnswer {
  readonly word: ReadinessWord; readonly why: string | null; readonly until: number | null;
  readonly strandCause: StrandCause | null; readonly restartable: boolean;
}

// ── Table 6.4a, first match ─────────────────────────────────────────────────────────────────────────────────────────

const answer = (word: ReadinessWord, why: string | null = null, extra: Partial<ReadinessAnswer> = {}): ReadinessAnswer =>
  ({ word, why, until: null, strandCause: null, restartable: false, ...extra });

/** Table 6.4a, first match, total and pure. Each numbered comment is the table's row, counted from `absent` as 1. */
export function overlordReadiness(f: ReadinessFacts, now: number): ReadinessAnswer {
  // 1. absent
  if (f.subject.kind === 'measured' && f.subject.value === null) return answer('absent');
  // 2. off
  if (f.off.kind === 'measured' && f.off.value !== null) return answer('off', f.off.value);
  // 3. unmeasured: the subject, the registry, the brakes or the body. The registry is named before the brakes: a failed
  //    listing is why `mail-disabled` could not be read, so `why` names the cause (`registry`, `boot`), not its echo.
  for (const x of [f.subject, f.registry, f.off, f.body]) if (x.kind === 'unmeasured') return answer('unmeasured', x.why);
  const body = f.body;
  // 4. dead: a third restart in the hour, whatever the body and the generation say; or it measures dead and is not renewing
  if (f.restarts.kind === 'unmeasured') return answer('unmeasured', f.restarts.why);
  if (f.restarts.value > READINESS_RESTARTS_PER_HOUR) return answer('dead', 'third-restart', { restartable: f.restartable });
  const downPast = body.kind === 'down' && body.since !== null && now - body.since > READINESS_RESTART_BOUND_MS;
  if (body.kind === 'gone' || body.kind === 'asleep' || downPast) {
    if (f.generation.kind === 'unmeasured') return answer('unmeasured', f.generation.why);
    if (f.generation.value.kind !== 'renewing') {
      const why = body.kind === 'gone' ? body.cause : body.kind === 'asleep' ? 'asleep' : 'restart-bound';
      return answer('dead', why, { restartable: f.restartable });
    }
  }
  // 5. restarting: down within the bound, at most two restarts in the hour (a third read `dead` above)
  if (body.kind === 'down' && !downPast) {
    return answer('restarting', null, { until: body.since === null ? null : body.since + READINESS_RESTART_BOUND_MS });
  }
  // 6. renewing
  if (f.generation.kind === 'unmeasured') return answer('unmeasured', f.generation.why);
  const gen = f.generation.value;
  if (gen.kind === 'renewing') return answer('renewing', null, { until: gen.until });
  // 7. degraded
  if (gen.kind === 'degraded') return answer('degraded');
  // 8. stranded
  if (f.stranded.kind === 'unmeasured') return answer('unmeasured', f.stranded.why);
  if (f.stranded.value !== null) return answer('stranded', f.stranded.value, { strandCause: f.stranded.value });
  // 9. dialog-open
  if (f.dialogSince !== null && now - f.dialogSince >= READINESS_DIALOG_MS) return answer('dialog-open');
  // 10. wedged
  if (f.wedged.kind === 'unmeasured') return answer('unmeasured', f.wedged.why);
  if (f.wedged.value) return answer('wedged');
  // 11. deaf: either half measured true; either half unmeasured answers here; `not-built` is no input
  if ((f.deaf.kind === 'measured' && f.deaf.value) || (f.heldDeaf.kind === 'measured' && f.heldDeaf.value)) return answer('deaf');
  for (const x of [f.deaf, f.heldDeaf]) if (x.kind === 'unmeasured') return answer('unmeasured', x.why);
  // 12. saturated
  if (f.saturated.kind === 'measured' && f.saturated.value) return answer('saturated');
  if (f.saturated.kind === 'unmeasured') return answer('unmeasured', f.saturated.why);
  // 13. unproved: no proof newer than the last leaving of `ready` (equal is not newer)
  if (f.proofAt.kind === 'unmeasured') return answer('unmeasured', f.proofAt.why);
  const p = f.proofAt.value;
  if (p === null || (f.leftReadyAt !== null && p <= f.leftReadyAt)) return answer('unproved');
  // 14. ready
  return answer('ready');
}

// ── The raw readings and their mapping ──────────────────────────────────────────────────────────────────────────────

/** The live generation of the subject's own identity, narrowed by the lane through the one accessor (`effectiveGeneration`). */
export interface GenerationReading {
  readonly state: GenerationState; readonly deadlineAt: number | null; readonly proven: boolean;
  readonly startReportedAt: number; readonly n: number;
}
type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };
type StoreRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

/** What the lane gathers for a subject, each its producer's own answer (Table 2). */
export interface SubjectReadings {
  /** The ladder's composed read: the operator's rung, or why it could not be read. */
  readonly ladder: { readonly kind: 'read'; readonly operatorRung: Rung } | { readonly kind: 'unmeasured'; readonly why: string };
  /** Designation B's `overlordBodyOf`, with `down.since` filled from the lane's first sighting. */
  readonly body: OverlordBodyState;
  readonly generation: Read<GenerationReading | null>;
  readonly restarts: Read<number>;
  /** Serviceability B's candidates (renewal readings' `overlordCandidatesOf`). */
  readonly candidates: Candidates;
  /** `poolRunway.ts#earliestReset` over each candidate alone: exhausted (`at`), clear (`none-exhausted`), or unmeasured. */
  readonly resets: Read<Readonly<Record<string, EarliestReset>>>;
  /** The record's strand marker: none, its reason, a listed marker that could not be read, or no assembled record. */
  readonly strand: { readonly kind: 'none' } | { readonly kind: 'marked'; readonly reason: string } | { readonly kind: 'unreadable' }
    | { readonly kind: 'no-record' };
  readonly swapBlocked: { readonly at: number; readonly reason: string } | null;
  readonly turnMark: TurnMarkRead;
  readonly hookState: HookStateRead;
  readonly sessionStatus: SessionStatus | null;
  /** The lane's first sighting of `dialogPending`, or null when no dialog stands. */
  readonly dialogSince: number | null;
  readonly unsettled: StoreRead<readonly MessageFacts[]>;
  /** The private store's `lastServedReadAt` for the current generation. */
  readonly servedReadAt: StoreRead<number | 'none'>;
  /** `continuityStore.ts#lastContinuityRead`. */
  readonly continuityReadAt: Read<number | null>;
}

/** The stored word the lane last wrote, as `readinessNow` answers it. */
export interface ReadinessNowRow {
  readonly id: number; readonly sessionId: string | null; readonly word: ReadinessWord; readonly why: string | null;
  readonly until: number | null; readonly strandCause: StrandCause | null; readonly restartable: boolean; readonly at: number;
  /** The newest `ready` row's `at`, or null. */
  readonly readySince: number | null;
  /** The `at` of the first row after the newest `ready` row, or null. */
  readonly leftReadyAt: number | null;
  /** While the word is `dead`: its episode's first row id and that row's `pushedAt`; otherwise null. */
  readonly episodeFirstId: number | null; readonly pushedAt: number | null;
}

/** One pass's raw record. */
export interface ReadinessReadings {
  /** `boot` on this process's first pass, `failed` on a failed listing, `listed` otherwise. */
  readonly registry: 'boot' | 'failed' | 'listed';
  readonly designation: DesignationRead;
  /** `readSwitches(names)[MAIL_DISABLED_MARKER]`: `unmeasurable` on a failed listing. */
  readonly mailDisabled: MarkerState;
  /** `readinessNow`: what the lane last wrote. */
  readonly stored: Read<ReadinessNowRow | 'none'>;
  /** Read only for a subject; null otherwise. */
  readonly subject: SubjectReadings | null;
}

/** The subject: the bound session, else the pending one (§6.4: a pending designation reads through generation 1), else none. */
function subjectOf(d: DesignationRead): ReadinessFacts['subject'] {
  if (d.kind === 'unmeasured') return unmeasured(`designation: ${d.why}`);
  if (d.kind === 'designated') return measured({ sessionId: d.sessionId, bound: true });
  return measured(d.row?.pending ? { sessionId: d.row.pending.sessionId, bound: false } : null);
}

/** The session the lane gathers for: the subject's id, or null for none or an unreadable designation. */
export function readinessSubjectOf(d: DesignationRead): string | null {
  const s = subjectOf(d);
  return s.kind === 'measured' && s.value !== null ? s.value.sessionId : null;
}

/** The generation fact: renewing while a walk is in flight or not yet proven; a pending subject with no generation yet reads
 *  renewing; a bound one with none reads unmeasured (nothing minted it, so nothing says it is not renewing). */
function generationOf(r: SubjectReadings['generation'], bound: boolean, pendingUntil: number | null): Fact<GenerationFact> {
  if (!r.ok) return unmeasured(`generation: ${r.detail}`);
  const g = r.value;
  if (g === null) return bound ? unmeasured('generation: none live') : measured({ kind: 'renewing', until: pendingUntil });
  if (RENEWING_STATES.has(g.state)) return measured({ kind: 'renewing', until: g.deadlineAt });
  if (g.state === 'degraded') return measured({ kind: 'degraded' });
  return g.proven ? measured({ kind: 'proven' }) : measured({ kind: 'renewing', until: g.deadlineAt });
}

/** The strand cause, first measured cause in C57's order; unmeasured only when no cause is measured and an input is unread. */
function strandedOf(s: SubjectReadings): Fact<StrandCause | null> {
  const unread: string[] = [];
  const c = s.candidates;
  if (c.kind === 'unmeasured') unread.push('candidates');
  else if (c.kind === 'candidates') {
    if (c.list.length === 0) return measured('set-admits-none');
    const yes = c.list.some((x) => x.serves === 'yes');
    if (!yes) {
      if (c.list.every((x) => x.serves === 'at-ceiling')) return measured('limited');
      const resets = s.resets;
      if (!resets.ok) unread.push('resets');
      else {
        if (c.list.every((x) => resets.value[x.id]?.kind === 'at')) return measured('limited');
        if (c.list.some((x) => x.serves === 'unmeasured')) unread.push('candidates');
      }
    }
  }
  if (s.swapBlocked !== null) return measured('swap-blocked');
  // The account failed the turn when the stall watch's one classifier puts the token in its account class (slug
  // account-failure-reads-the-stopfailure-classes); a token it cannot classify is neither a failure nor a pass: unread.
  const t = s.turnMark;
  const cls = t.ok && t.state === 'failed' ? stopFailureClass(t.err) : undefined;
  if (cls === 'account') return measured('turn-failed');
  if (cls === null) unread.push('turn-failed token unclassified');
  if (!t.ok && t.reason !== 'absent') unread.push('turn-marker');
  if (s.strand.kind === 'marked') return measured('unread');
  if (s.strand.kind === 'unreadable' || s.strand.kind === 'no-record') unread.push('strand-marker');
  return unread.length > 0 ? unmeasured(`stranded: ${unread[0]} unread`) : measured(null);
}

/** A turn over ten minutes, or working with no hook event for five. An absent marker or state reads not working. */
function wedgedOf(s: SubjectReadings, now: number): Fact<boolean> {
  const t = s.turnMark; const h = s.hookState;
  if (t.ok && t.state === 'working' && t.turnAt !== null && now - t.turnAt > READINESS_LONG_TURN_MS) return measured(true);
  if (h.ok && h.state.state === 'working' && now - h.state.updatedAt > READINESS_HOOK_QUIET_MS) return measured(true);
  if (!t.ok && t.reason !== 'absent') return unmeasured(`wedged: turn marker ${t.reason}`);
  if (!h.ok && h.reason !== 'no-state') return unmeasured('wedged: hook state unmeasured');
  return measured(false);
}

/** The states a message waits in for the Overlord to pick it up. */
const AWAITING: ReadonlySet<string> = new Set(['recorded', 'queued', 'delivered']);

/** An operator message not picked up two minutes past the later of its arrival and `readySince` (F18). */
function deafOf(s: SubjectReadings, readySince: Read<number | null>, now: number): Fact<boolean> {
  if (s.unsettled.kind === 'unmeasured') return unmeasured(`inbox: ${s.unsettled.why}`);
  if (s.unsettled.value.some((m) => m.state === 'unknown')) return unmeasured('inbox: a message state this build does not know');
  if (!readySince.ok) return unmeasured(`inbox: ${readySince.detail}`);
  const since = readySince.value;
  if (since === null) return measured(false);
  return measured(s.unsettled.value.some((m) => AWAITING.has(m.state) && now - Math.max(m.at, since) >= READINESS_DEAF_MS));
}

/** The newest proof of the current generation (question 7): a served read, a card or notes read, or an idle word over a finished
 *  turn, each counted only when newer than the generation's start. All three unread: unmeasured. */
function proofOf(s: SubjectReadings, gen: GenerationReading | null): Fact<number | null> {
  const start = gen?.startReportedAt ?? null;
  const fresh = (at: number | null): number | null => (at !== null && (start === null || at > start) ? at : null);
  const got: (number | null)[] = [];
  let unread = 0;
  if (s.servedReadAt.kind === 'measured') got.push(fresh(s.servedReadAt.value === 'none' ? null : s.servedReadAt.value)); else unread += 1;
  if (s.continuityReadAt.ok) got.push(fresh(s.continuityReadAt.value)); else unread += 1;
  const t = s.turnMark;
  if (t.ok) got.push(t.state === 'done' && t.stopAt !== null && s.sessionStatus === 'idle' ? fresh(t.stopAt) : null);
  else if (t.reason === 'absent') got.push(null); else unread += 1;
  if (unread === 3) return unmeasured('proof: no proof source could be read');
  const best = got.filter((x): x is number => x !== null);
  return measured(best.length === 0 ? null : Math.max(...best));
}

/** The producers' raw answers to facts: every mapping of the plan's Table 2 but the body (designation B's). */
export function readinessFactsOf(raw: ReadinessReadings, now: number): ReadinessFacts {
  const subject = subjectOf(raw.designation);
  const registry: Fact<'read'> = raw.registry === 'listed' ? measured('read') : unmeasured(raw.registry === 'boot' ? 'boot' : 'registry');
  const mail = raw.mailDisabled === 'set' ? 'mail-disabled' : raw.mailDisabled === 'unmeasurable' ? 'unmeasurable' : null;
  const stored = raw.stored;
  const leftReadyAt = stored.ok && stored.value !== 'none' ? stored.value.leftReadyAt : null;
  const readySince: Read<number | null> = stored.ok ? { ok: true, value: stored.value === 'none' ? null : stored.value.readySince } : stored;
  const s = raw.subject;
  const d = raw.designation;
  const empty: Pick<ReadinessFacts, 'body' | 'restarts' | 'generation' | 'stranded' | 'wedged' | 'deaf' | 'proofAt'> = {
    body: unmeasured('body: not read'), restarts: unmeasured('restarts: not read'), generation: unmeasured('generation: not read'),
    stranded: unmeasured('stranded: not read'), wedged: unmeasured('wedged: not read'), deaf: unmeasured('inbox: not read'),
    proofAt: unmeasured('proof: not read'),
  };
  // The brakes: mail-disabled is read from the listing whatever the subject; the rung only for a subject.
  const off: Fact<'rung' | 'mail-disabled' | null> = mail === 'mail-disabled' ? measured('mail-disabled')
    : s === null ? (mail === 'unmeasurable' ? unmeasured('mail-disabled: the listing could not be read') : measured(null))
      : s.ladder.kind === 'unmeasured' ? unmeasured(`ladder: ${s.ladder.why}`)
        : s.ladder.operatorRung === 'off' ? measured('rung')
          : mail === 'unmeasurable' ? unmeasured('mail-disabled: the listing could not be read') : measured(null);
  const base = { subject, off, registry, dialogSince: s?.dialogSince ?? null, heldDeaf: { kind: 'not-built' } as const,
    saturated: { kind: 'not-built' } as const, leftReadyAt };
  if (s === null || subject.kind !== 'measured' || subject.value === null) return { ...base, ...empty, restartable: false };
  const pending = d.kind !== 'unmeasured' ? d.row?.pending ?? null : null;
  const generation = generationOf(s.generation, subject.value.bound, subject.value.bound ? null : pending?.deadlineAt ?? null);
  const genRow = s.generation.ok ? s.generation.value : null;
  // The restart in progress: while the body is down and the generation is not renewing (a doubt about the generation counts).
  const inProgress = s.body.kind === 'down' && !(generation.kind === 'measured' && generation.value.kind === 'renewing') ? 1 : 0;
  const restarts: Fact<number> = s.restarts.ok ? measured(s.restarts.value + inProgress) : unmeasured(`restarts: ${s.restarts.detail}`);
  const binding = d.kind === 'designated'
    ? { sessionId: d.sessionId, pending: pending === null ? null : { sessionId: pending.sessionId, deadlineAt: pending.deadlineAt } } : null;
  return {
    ...base, body: s.body, restarts, generation, stranded: strandedOf(s), wedged: wedgedOf(s, now),
    deaf: deafOf(s, readySince, now), proofAt: proofOf(s, genRow),
    restartable: restartVerdict(binding, s.body, now).ok,
  };
}

// ── What the operator is told ───────────────────────────────────────────────────────────────────────────────────────

/** One open record of `overlord_readiness_items`, joined to its item's own state (`missing` when the item row is gone). */
export interface ReadinessItemRecord {
  readonly id: number; readonly item: ReadinessItemKind; readonly key: string; readonly itemId: number; readonly raisedAt: number;
  readonly itemState: ItemState | 'missing';
}

export interface NoticeInputs {
  readonly written: { readonly answer: ReadinessAnswer; readonly episodeFirst: boolean; readonly rowId: number | null };
  /** Open records, each with its item's own state. */
  readonly records: readonly ReadinessItemRecord[];
  /** The candidates with `serves === 'yes'` (F11), unmeasured if any candidate is. */
  readonly count: Fact<number>;
  /** Renewal readings PR H's holds; `not-wired` until it lands. */
  readonly holds: { readonly kind: 'not-wired' } | { readonly kind: 'unmeasured' } | { readonly kind: 'read'; readonly lanes: readonly string[] };
}

export type ReadinessNotice =
  | { readonly kind: 'dead-push'; readonly rowId: number; readonly withRestart: boolean }
  | { readonly kind: 'raise'; readonly item: ReadinessItemKind; readonly key: string }
  | { readonly kind: 'settle'; readonly recordId: number; readonly note: string }
  | { readonly kind: 'close'; readonly recordId: number };

/** The settle notes: the cause cleared, or the Overlord was retired (F9). */
export const READINESS_SETTLE_NOTE = { cleared: 'cleared', retired: 'retired' } as const;

/** The readiness module's own words, each a fact's or a notice's kind, a dead or unread cause, a push field or a log kind; none
 *  is a refusal or a `reject.code`. With the fourteen words and the strand causes, the coordination kebab census admits them. */
const READINESS_KEBAB_MAP = {
  'not-built': 'a fact this build has no input for', 'not-wired': 'the holds port before renewal readings PR H',
  'no-record': 'no registry record for the subject', 'no-state': 'no hook state yet', 'dead-push': 'the dead push notice',
  'restart-bound': 'down past the restart bound', 'third-restart': 'a third restart in the hour',
  'strand-marker': 'the strand marker unread', 'turn-marker': 'the turn marker unread', 'notice-raise': 'a refused raise, logged once',
  'notice-settle': 'a refused settle, logged once', 'overlord-readiness': 'the push tag', 'overlord-restart': 'the push\'s Restart action',
  'none-exhausted': 'no candidate reads exhausted', 'at-ceiling': 'a candidate at its ceiling', 'mail-disabled': 'the mail switch',
  'designation-unreadable': 'the candidates of an unreadable designation',
} as const;
export const isReadinessKebab = (word: string): boolean =>
  isReadinessWord(word) || isStrandCause(word) || Object.prototype.hasOwnProperty.call(READINESS_KEBAB_MAP, word);
const COUNT_KEY = 'count';
const LIVE_ITEM_STATES: ReadonlySet<string> = new Set(['open', 'checking']);
const STRANDED_AT = READINESS_WORDS.indexOf('stranded');

/** What the operator is told, total and pure. Reconcile first (F8), so the item rules see only live records. */
export function readinessNotices(n: NoticeInputs): readonly ReadinessNotice[] {
  const out: ReadinessNotice[] = [];
  const a = n.written.answer;
  if (a.word === 'dead' && n.written.episodeFirst && n.written.rowId !== null) {
    out.push({ kind: 'dead-push', rowId: n.written.rowId, withRestart: a.restartable });
  }
  const live: ReadinessItemRecord[] = [];
  for (const r of n.records) {
    if (LIVE_ITEM_STATES.has(r.itemState)) live.push(r); else out.push({ kind: 'close', recordId: r.id });
  }
  const settle = (r: ReadinessItemRecord, note: string): void => { out.push({ kind: 'settle', recordId: r.id, note }); };
  if (a.word === 'absent') {
    for (const r of live) settle(r, READINESS_SETTLE_NOTE.retired);
    return out;
  }
  // The stranded item: measured only by `stranded` itself or a word after it in the order, never by `unmeasured`.
  const strandedLive = live.filter((r) => r.item === 'stranded');
  const at = READINESS_WORDS.indexOf(a.word);
  const strandMeasured = a.word !== 'unmeasured' && at >= STRANDED_AT;
  const cause = a.word === 'stranded' ? a.strandCause : null;
  if (strandMeasured) {
    for (const r of strandedLive) if (r.key !== cause) settle(r, READINESS_SETTLE_NOTE.cleared);
    if (cause !== null && !strandedLive.some((r) => r.key === cause)) out.push({ kind: 'raise', item: 'stranded', key: cause });
  }
  // The count item: its place is taken while a `set-admits-none` stranded item stands (C56, C57).
  const setNamed = strandMeasured ? cause === 'set-admits-none' : strandedLive.some((r) => r.key === 'set-admits-none');
  const countLive = live.filter((r) => r.item === 'count');
  if (n.count.kind === 'measured') {
    const low = n.count.value < 2;
    for (const r of countLive) if (!low || setNamed) settle(r, READINESS_SETTLE_NOTE.cleared);
    if (low && !setNamed && countLive.length === 0) out.push({ kind: 'raise', item: 'count', key: COUNT_KEY });
  }
  // The hold item: one per held lane.
  if (n.holds.kind === 'read') {
    const held = new Set(n.holds.lanes);
    const holdLive = live.filter((r) => r.item === 'hold');
    for (const r of holdLive) if (!held.has(r.key)) settle(r, READINESS_SETTLE_NOTE.cleared);
    for (const lane of n.holds.lanes) if (!holdLive.some((r) => r.key === lane)) out.push({ kind: 'raise', item: 'hold', key: lane });
  }
  return out;
}

/** The count item's figure (F11): the candidates that serve on either class; unmeasured if any candidate is, or no list. */
export function readinessCountOf(c: Candidates | null): Fact<number> {
  if (c === null) return unmeasured('count: not read');
  if (c.kind !== 'candidates') return unmeasured(`count: ${c.kind}`);
  if (c.list.some((x) => x.serves === 'unmeasured')) return unmeasured('count: a candidate is unmeasured');
  return measured(c.list.filter((x) => x.serves === 'yes').length);
}

// ── The words of the push and of the items (plan Task 4) ────────────────────────────────────────────────────────────────

/** The dead push as `notify` takes it: the payload's copy, its tag and its per-episode-row key. */
export interface ReadinessPush {
  readonly title: string; readonly body: string; readonly tag: 'overlord-readiness'; readonly url: string;
  /** The Restart control, only when the door would act. */
  readonly actions: { readonly action: string; readonly title: string }[];
  /** One push per episode: `overlord-dead:<the episode's first row id>`. */
  readonly dedupeKey: string;
}

/** The dead push (Task 4): L0's words, the Restart action only with `withRestart`, the key per episode row. */
export function readinessPushOf(rowId: number, withRestart: boolean): ReadinessPush {
  return {
    title: READINESS_PUSH_TEXT.title,
    body: withRestart ? READINESS_PUSH_TEXT.body.withRestart : READINESS_PUSH_TEXT.body.withoutRestart,
    tag: 'overlord-readiness', url: READINESS_PUSH_TEXT.url,
    actions: withRestart ? [{ action: 'overlord-restart', title: 'Restart' }] : [],
    dedupeKey: `overlord-dead:${rowId}`,
  };
}

/** `poolRunway.ts#earliestReset` over the candidates together: the earliest reset still to come, `none-exhausted` when no
 *  candidate has one, or `unmeasured` with why when any candidate's reset or the list cannot be read (the earliest of the rest
 *  would not be the earliest). */
export type CandidatesReset = { readonly kind: 'at'; readonly atS: number } | { readonly kind: 'none-exhausted' }
  | { readonly kind: 'unmeasured'; readonly why: string };

export function readinessEarliestReset(s: Pick<SubjectReadings, 'candidates' | 'resets'>): CandidatesReset {
  const c = s.candidates;
  if (c.kind !== 'candidates') return unmeasured('candidates');
  if (c.list.length === 0) return unmeasured('no candidates');
  if (!s.resets.ok) return unmeasured(s.resets.detail);
  let earliest: number | null = null;
  for (const x of c.list) {
    const r = s.resets.value[x.id];
    if (r === undefined) return unmeasured(`no reset read for ${x.id}`);
    if (r.kind === 'unmeasured') return unmeasured(r.why);
    if (r.kind === 'at' && (earliest === null || r.atS < earliest)) earliest = r.atS;
  }
  return earliest === null ? { kind: 'none-exhausted' } : { kind: 'at', atS: earliest };
}

/** What an item's text reads beyond its (item, key): the pass's raw readings for a subject (null when none were gathered)
 *  and the count item's figure. */
export interface ReadinessItemContext {
  readonly readings: SubjectReadings | null;
  readonly count: Fact<number>;
}

const UNMEASURED_WORD = 'unmeasured';
/** A UTC time with whole seconds, `2026-11-26T12:00:00Z`: no clock and no zone of the reader's is involved. */
const utcOf = (epochS: number): string => {
  const d = new Date(epochS * 1000);
  return Number.isNaN(d.getTime()) ? UNMEASURED_WORD : `${d.toISOString().slice(0, 19)}Z`;
};

/** The one measured sentence a stranded text appends to its `why`, from the readings of the cause it names. */
function strandDetail(cause: StrandCause, r: SubjectReadings | null): string | null {
  switch (cause) {
    case 'limited': {
      const e = r === null ? unmeasured('not read') : readinessEarliestReset(r);
      return e.kind === 'at' ? `The earliest reset is ${utcOf(e.atS)}.`
        : e.kind === 'none-exhausted' ? 'No account reads exhausted, so no reset is pending.'
          : `The earliest reset is ${UNMEASURED_WORD}.`;
    }
    case 'swap-blocked':
      return r?.swapBlocked != null ? `ccd recorded the refusal: "${r.swapBlocked.reason}".` : `The refusal is ${UNMEASURED_WORD}.`;
    case 'turn-failed': {
      const t = r?.turnMark;
      return `The account's failure word is ${t !== undefined && t.ok && t.err !== null ? t.err : UNMEASURED_WORD}.`;
    }
    case 'unread':
      return r?.strand.kind === 'marked' ? `ccd's reason: "${r.strand.reason}".` : `ccd's reason is ${UNMEASURED_WORD}.`;
    case 'projection': case 'set-unreadable': case 'set-admits-none':
      return null;
  }
}

const withDetail = (t: ReadinessItemText, detail: string | null): ReadinessItemText =>
  detail === null ? t : { ...t, why: `${t.why} ${detail}` };

/** The words of one item to raise (Task 4): L0's title, `why` and `how` for its item and cause, with the one measured detail
 *  the cause needs. An input that could not be read reads "unmeasured" in the text; a stranded key this build does not know
 *  gets L0's fallback text. Never throws. */
export function readinessItemTextOf(n: { readonly item: ReadinessItemKind; readonly key: string }, ctx: ReadinessItemContext): ReadinessItemText {
  if (n.item === 'stranded') {
    return isStrandCause(n.key)
      ? withDetail(READINESS_ITEM_TEXT.stranded[n.key], strandDetail(n.key, ctx.readings))
      : READINESS_ITEM_TEXT.strandedUnknown;
  }
  if (n.item === 'count') {
    const c = ctx.count;
    return withDetail(READINESS_ITEM_TEXT.count,
      c.kind === 'measured' ? `It counts ${c.value} account${c.value === 1 ? '' : 's'} that can serve it.` : `The count is ${UNMEASURED_WORD}.`);
  }
  return { ...READINESS_ITEM_TEXT.hold, title: `${READINESS_ITEM_TEXT.hold.title}: ${n.key}` };
}

// ── What is served ──────────────────────────────────────────────────────────────────────────────────────────────────

/** What the door and the board are served (F2): the stored row while this process's last pass is within `READINESS_FRESH_MS`
 *  by the monotonic clock; before the first pass `unmeasured` `boot`; past the limit `unmeasured` `stale`. */
export function servedReadiness(stored: ReadinessNowRow | 'none',
  freshness: { readonly lastPassMono: number | null; readonly nowMono: number; readonly nowWall: number }): ReadinessWire {
  const doubt = (why: string, since: number): ReadinessWire =>
    ({ word: 'unmeasured', since, why, until: null, questionsGo: 'operator', restartable: false, strandCause: null });
  const { lastPassMono, nowMono, nowWall } = freshness;
  if (lastPassMono === null) return doubt(READINESS_SERVED_WHY.boot, nowWall);
  const age = nowMono - lastPassMono;
  if (age > READINESS_FRESH_MS) return doubt(READINESS_SERVED_WHY.stale, nowWall - (age - READINESS_FRESH_MS));
  if (stored === 'none') return doubt(READINESS_SERVED_WHY.boot, nowWall);
  return {
    word: stored.word, since: stored.at, why: stored.why, until: stored.until, questionsGo: 'operator',
    restartable: stored.word === 'dead' && stored.restartable, strandCause: stored.strandCause,
  };
}
