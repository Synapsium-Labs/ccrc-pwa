// L4 delivery, context C5: the Overlord's readiness lane (Overlord spec §6.4, C23, H20, C56, C57; Table 11.1c's readiness lane;
// plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md` Task 3). Its rules are decided elsewhere:
// `readinessFactsOf` maps each producer's answer to a fact, `overlordReadiness` decides the word, `readinessNotices` what the
// operator is told, and `servedReadiness` what the read door serves. This file gathers, calls them and acts. It decides
// nothing: the subject it gathers for is `readinessSubjectOf`'s, and the body is designation B's `overlordBodyOf`.
//
// ONE PASS, IN THIS ORDER (the watcher calls it on its `overlordReadiness` cadence, with the tick's listing or `listed: false`):
//  1. Gather. The designation; for a subject only, the ladder, the body, the generation and restarts, the candidates and their
//     resets, the turn marker and hookstate, the inbox, the served reads and the card reads, each in its own catch (a throw is
//     that producer's unmeasured answer); then `readinessNow`. On a failed listing only the designation and the store.
//  2. Decide: facts, then the word.
//  3. Record (`recordReadiness`). A refused write stops the pass: no notice for a word the record does not hold, and the
//     pass mark is not moved, so the read goes `stale` if writes keep failing. One log line per failure kind.
//  4. Tell: the notices for the written answer: the dead push (after the commit that marked it), then each item's close,
//     settle or raise through the port, in the decider's order.
//  5. Mark the pass on the monotonic clock; once a day, prune.
//
// ITS MEMORY (never stored, so no second writer of any fact): the first pass of this process (`boot`), the first sighting of
// a body `down` and of a dialog, keyed by session id, the last pass's monotonic time and the last prune. A restart
// re-observes them: the first pass reads `unmeasured` (`boot`), and a bound restarts from the next sighting (question 4).
import type { DatabaseSync } from 'node:sqlite';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { EarliestReset } from '../../../shared/loadLines.js';
import type { Rung } from '../../../shared/overlord-ladder.js';
import type { FleetSession, MarkerState } from '../../../shared/api.js';
import { READINESS_PRUNE_EVERY_MS, READINESS_KEEP_MS, READINESS_RESTART_WINDOW_MS, type ReadinessItemKind, type ReadinessWire } from '../../../shared/overlord-readiness.js';
import { overlordBodyOf } from './overlordDesignation.js';
import {
  overlordReadiness, readinessCountOf, readinessFactsOf, readinessNotices, readinessSubjectOf, servedReadiness,
  type GenerationReading, type NoticeInputs, type ReadinessAnswer, type SubjectReadings,
} from './overlordReadiness.js';
import { closeReadinessItem, openReadinessItems, pruneReadiness, readinessNow, recordReadiness } from './overlordReadinessStore.js';
import type { Candidates } from '../accountLoad.js';
import type { TurnMarkRead } from './stall.js';
import type { HookStateRead } from '../hookstate.js';
import type { MessageFacts } from './overlordInbox.js';
import type { SessionRecord } from '../registry.js';
import type { GenRow } from '../continuity/continuityStore.js';

/** What one tick hands the lane: the failed listing, or the assembled fleet with its listing (F2, F4, F6). */
export type ReadinessTick =
  | { readonly listed: false }
  | { readonly listed: true; readonly sessions: readonly FleetSession[]; readonly records: readonly SessionRecord[];
      readonly listedIds: ReadonlySet<string>; readonly names: readonly string[] };

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };
type StoreRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

/** The lane's port, declared by its consumer: each producer's one reader, and the acts the composition wires. */
export interface ReadinessLanePort {
  /** The coordination database the readiness store writes. */
  readonly db: DatabaseSync;
  readonly clock: { wall(): number; mono(): number };
  designation(): DesignationRead;
  /** The ladder's composed read: the operator's rung. */
  ladder(): { readonly kind: 'read'; readonly operatorRung: Rung } | { readonly kind: 'unmeasured'; readonly why: string };
  /** `readSwitches(names)[MAIL_DISABLED_MARKER]`, `unmeasurable` on a null listing. */
  mailDisabled(names: readonly string[] | null): MarkerState;
  /** The generation identity of a session (`roleOf.ts#identityOf` over this designation). */
  identityOf(sessionId: string, d: DesignationRead): string;
  liveGeneration(identity: string): { ok: true; row: GenRow | null } | { ok: false; detail: string };
  /** `effectiveGeneration(row, continuity live)`: the one accessor of the state and deadline. */
  effective(row: GenRow): { readonly state: GenRow['state']; readonly deadlineAt: number | null };
  restartsSince(identity: string, sinceMs: number): { ok: true; count: number } | { ok: false; detail: string };
  /** Serviceability B's candidates over designation A's list (`renewalReadings.ts#overlordCandidatesOf`). */
  candidates(d: DesignationRead): Candidates;
  /** `poolRunway.ts#earliestReset` over each account alone. */
  resets(accounts: readonly string[]): Read<Readonly<Record<string, EarliestReset>>>;
  turnMark(record: SessionRecord): Promise<TurnMarkRead>;
  hookState(record: SessionRecord): Promise<HookStateRead>;
  /** `strandUnreadable` is the registry's own sentinel test (`STRANDED_UNREADABLE`). */
  strandUnreadable(record: SessionRecord): boolean;
  unsettled(): StoreRead<readonly MessageFacts[]>;
  lastServedReadAt(generation: number, sinceMs: number): StoreRead<number | 'none'>;
  lastContinuityRead(sessionId: string): { ok: true; at: number | null } | { ok: false; detail: string };
  /** Renewal readings PR H's holds: `not-wired` until it lands. */
  holds(): NoticeInputs['holds'];
  /** The dead push, sent after the commit that marked it (the push outbox's one sender, behind `notify`). */
  push(n: { readonly rowId: number; readonly withRestart: boolean }): void;
  /** Raise an item and its record in one transaction; settle an item and stamp its record (sequence B's checked writers). */
  raiseItem(item: ReadinessItemKind, key: string, at: number): void;
  settleItem(recordId: number, note: string, at: number): void;
  log(line: string): void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
function safe<T>(fn: () => T, onThrow: (detail: string) => T): T {
  try { return fn(); } catch (e) { return onThrow(errText(e)); }
}
async function safeAsync<T>(fn: () => Promise<T>, onThrow: (detail: string) => T): Promise<T> {
  try { return await fn(); } catch (e) { return onThrow(errText(e)); }
}

/** One readiness lane per server: its memory and its pass. */
export class ReadinessLane {
  private booted = false;
  private lastPassMono: number | null = null;
  private lastPruneMono: number | null = null;
  private readonly downSince = new Map<string, number>();
  private readonly dialogSince = new Map<string, number>();
  private readonly logged = new Set<string>();

  constructor(private readonly port: ReadinessLanePort) {}

  /** What the read door and the board are served (F2). */
  read(): { ok: true; wire: ReadinessWire } | { ok: false; detail: string } {
    const now = readinessNow(this.port.db);
    if (!now.ok) return { ok: false, detail: now.detail };
    return { ok: true, wire: servedReadiness(now.now, { lastPassMono: this.lastPassMono, nowMono: this.port.clock.mono(), nowWall: this.port.clock.wall() }) };
  }

  /** One pass. Never throws: a failure is logged once per kind and leaves the previous word standing. */
  async pass(tick: ReadinessTick): Promise<ReadinessAnswer | null> {
    const p = this.port;
    const registry = !this.booted ? 'boot' : tick.listed ? 'listed' : 'failed';
    this.booted = true;
    const designation = safe(() => p.designation(), (d): DesignationRead => ({ kind: 'unmeasured', why: d }));
    const sessionId = readinessSubjectOf(designation);
    const subject = sessionId !== null && tick.listed ? await this.gather(sessionId, designation, tick) : null;
    if (sessionId === null) { this.downSince.clear(); this.dialogSince.clear(); }
    const now = p.clock.wall();
    const stored = safe(() => readinessNow(p.db), (detail) => ({ ok: false as const, detail }));
    const facts = readinessFactsOf({
      registry, designation, mailDisabled: safe(() => p.mailDisabled(tick.listed ? tick.names : null), (): MarkerState => 'unmeasurable'),
      stored: stored.ok ? { ok: true, value: stored.now } : stored, subject,
    }, now);
    const answer = overlordReadiness(facts, now);
    const written = recordReadiness(p.db, { ...answer, sessionId }, now);
    if (!written.ok) { this.once(`record-${written.why}`, `ccrc-server: the Overlord readiness lane could not record the word ${answer.word} (${written.why})`); return null; }
    this.tell(answer, written, subject);
    this.lastPassMono = p.clock.mono();
    this.prune(now);
    return answer;
  }

  private async gather(sessionId: string, d: DesignationRead, tick: Extract<ReadinessTick, { listed: true }>): Promise<SubjectReadings> {
    const p = this.port;
    const now = p.clock.wall();
    const session = tick.sessions.find((s) => s.id === sessionId) ?? null;
    const record = tick.records.find((r) => r.id === sessionId) ?? null;
    const mapped = overlordBodyOf({ sessionId, listedIds: tick.listedIds, session });
    if (mapped.kind === 'down') { if (!this.downSince.has(sessionId)) this.downSince.set(sessionId, now); } else this.downSince.delete(sessionId);
    const body = mapped.kind === 'down' ? { kind: 'down' as const, since: this.downSince.get(sessionId) ?? now } : mapped;
    if (session?.dialogPending === true) { if (!this.dialogSince.has(sessionId)) this.dialogSince.set(sessionId, now); } else this.dialogSince.delete(sessionId);
    const identity = safe(() => p.identityOf(sessionId, d), () => sessionId);
    const gen = safe(() => p.liveGeneration(identity), (detail) => ({ ok: false as const, detail }));
    const genReading = safe((): Read<GenerationReading | null> => {
      if (!gen.ok) return gen;
      if (gen.row === null) return { ok: true, value: null };
      const e = p.effective(gen.row);
      return { ok: true, value: { state: e.state, deadlineAt: e.deadlineAt, proven: gen.row.proven, startReportedAt: gen.row.startReportedAt, n: gen.row.n } };
    }, (detail) => ({ ok: false as const, detail }));
    const restarts = safe(() => p.restartsSince(identity, now - READINESS_RESTART_WINDOW_MS), (detail) => ({ ok: false as const, detail }));
    const candidates = safe(() => p.candidates(d), (): Candidates => ({ kind: 'unmeasured', why: 'designation-unreadable' }));
    const resets = safe(() => p.resets(candidates.kind === 'candidates' ? candidates.list.map((c) => c.id) : []), (detail) => ({ ok: false as const, detail }));
    const unread = { ok: false as const, reason: 'unmeasured' as const };
    const turnMark = record === null ? unread : await safeAsync(() => p.turnMark(record), () => unread);
    const hookState = record === null ? unread : await safeAsync(() => p.hookState(record), () => unread);
    const g = genReading.ok ? genReading.value : null;
    return {
      ladder: safe(() => p.ladder(), (why) => ({ kind: 'unmeasured' as const, why })),
      body,
      generation: genReading,
      restarts: restarts.ok ? { ok: true, value: restarts.count } : restarts,
      candidates, resets,
      strand: record === null ? { kind: 'no-record' } : record.stranded === null ? { kind: 'none' }
        : safe(() => p.strandUnreadable(record), () => true) ? { kind: 'unreadable' } : { kind: 'marked', reason: record.stranded.reason },
      swapBlocked: record?.swapBlocked ?? null,
      turnMark, hookState,
      sessionStatus: session?.status ?? null,
      dialogSince: this.dialogSince.get(sessionId) ?? null,
      unsettled: safe(() => p.unsettled(), (why) => ({ kind: 'unmeasured' as const, why })),
      servedReadAt: g === null ? { kind: 'unmeasured', why: 'no live generation' }
        : safe(() => p.lastServedReadAt(g.n, g.startReportedAt), (why) => ({ kind: 'unmeasured' as const, why })),
      continuityReadAt: safe(() => { const r = p.lastContinuityRead(sessionId); return r.ok ? { ok: true as const, value: r.at } : r; }, (detail) => ({ ok: false as const, detail })),
    };
  }

  /** Step 4: the notices for the written answer, acted in the decider's order, each act in its own catch. */
  private tell(answer: ReadinessAnswer, written: { rowId: number | null; episodeFirst: boolean }, s: SubjectReadings | null): void {
    const p = this.port;
    const at = p.clock.wall();
    const records = safe(() => openReadinessItems(p.db), (detail) => ({ ok: false as const, detail }));
    if (!records.ok) this.once('items', `ccrc-server: the Overlord readiness lane could not read its items (${records.detail})`);
    const count = readinessCountOf(s?.candidates ?? null);
    const notices = readinessNotices({
      written: { answer, episodeFirst: written.episodeFirst, rowId: written.rowId },
      records: records.ok ? records.rows : [], count: records.ok ? count : { kind: 'unmeasured', why: 'items unread' },
      holds: records.ok ? safe(() => p.holds(), () => ({ kind: 'unmeasured' as const })) : { kind: 'unmeasured' },
    });
    for (const n of notices) {
      safe(() => {
        if (n.kind === 'dead-push') p.push({ rowId: n.rowId, withRestart: n.withRestart });
        else if (n.kind === 'close') closeReadinessItem(p.db, n.recordId, at);
        else if (n.kind === 'settle') p.settleItem(n.recordId, n.note, at);
        else p.raiseItem(n.item, n.key, at);
      }, (detail) => { this.once(`notice-${n.kind}`, `ccrc-server: the Overlord readiness lane could not ${n.kind === 'dead-push' ? 'send the dead push' : `${n.kind} an item`} (${detail})`); });
    }
  }

  private prune(now: number): void {
    const mono = this.port.clock.mono();
    if (this.lastPruneMono !== null && mono - this.lastPruneMono < READINESS_PRUNE_EVERY_MS) return;
    this.lastPruneMono = mono;
    safe(() => pruneReadiness(this.port.db, now - READINESS_KEEP_MS), (detail) => { this.once('prune', `ccrc-server: the Overlord readiness lane could not prune (${detail})`); return { removed: 0 }; });
  }

  private once(kind: string, line: string): void {
    if (this.logged.has(kind)) return;
    this.logged.add(kind);
    this.port.log(line);
  }
}
