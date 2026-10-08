// The box-token driver, ring L4 (spec §5): its own unref'd 60 s timer, one
// tick at a time, and nothing decided here — every step is `nextAction`'s
// answer (token/policy.ts, L1), and every state change is a policy function.
// The driver owns the timer, the in-memory values (in the holder), the order of
// the file steps, and the log lines. It is registered from `index.ts`, never a
// lane in `watch.ts`.
//
// Never logs a value, a code or a digest: its lines carry generation sequence
// numbers, words and node labels only.
import { valueDigestHex } from './files.js';
import { ClaimDoor } from './door.js';
import {
  DRIVER_TICK_MS, FAILURES_FOR_BANNER, ROTATE_NOW_MIN_INTERVAL_MS, STALL_ALERT_MS, TOKEN_FILE_REREAD_MS, applySyncResult,
  backoffMs, extendedGraceState, handedOutState, nextAction, owe, mintedState, phaseOf, promotedState, rotationGate,
  oweForRetiredPresentation, pendingExitOpen, retiringDigests, retiringLanded, retiringRecorded, stagedState, type BoxTokenState, type GateInput, type GateVerdict, type GenerationObservation, type SyncResult, type WriteRecord,
} from './policy.js';
import type { BothRoleWriter, GateRowsSource, GenerationReader, TokenStore, TokenSyncLink } from './ports.js';
import type { BoxTokenHolder, HolderSlots } from '../coord/token.js';
import type { BootResult } from './boot.js';
import type { TokenRouteDriver } from './routes.js';
import type { BoxTokenView, OwedReason, RotateAnswer, TokenFileProblem, TokenHold } from '../../../shared/box-token.js';

/** The re-read's finding, as a log phrase (plan assembly). Words only: never a value, a digest or a length. */
const FILE_PROBLEM_TEXT: Readonly<Record<TokenFileProblem, string>> = {
  missing: 'is missing', unusable: 'carries no usable value', placeholder: 'holds the shipped placeholder',
  unreadable: 'cannot be read', changed: 'was changed outside the server', retired: 'holds a retired value',
};
type FileProblem = NonNullable<BoxTokenView['fileProblem']>;

export interface DriverDeps {
  store: TokenStore; holder: BoxTokenHolder; door?: ClaimDoor;
  link: TokenSyncLink | null;
  generation: GenerationReader | null;
  rows: GateRowsSource;
  env: Pick<GateInput, 'fleetMode' | 'role' | 'roleSource' | 'agentEnvMarksFleet'>;
  bothWriter: BothRoleWriter | null;
  now?: () => number; warn?: (line: string) => void;
}

const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? (e instanceof Error ? e.message : 'error');
const MAX_STEPS = 8;

export class BoxTokenDriver implements TokenRouteDriver {
  readonly door: ClaimDoor;
  private state: BoxTokenState | null;
  private mintFailed: boolean;
  private hold: { hold: TokenHold; node: string | null } | null = null;
  private learned: GateInput['learned'] = null;
  private backoffUntil: number | null = null;
  private lastReadySeen: number | null = null;
  private rotateRequested = false;
  /** A send or a promotion is running (D-4413): the only in-flight state "Rotate now" may call `joined` on. */
  private busy = 0;
  private lastRotateStart = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private presentedBase: number;
  private lastObs: GenerationObservation | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly warn: (line: string) => void;
  /** The values in memory, mirrored into the holder by `pushSlots`. `previous` is loaded once from its file. */
  private cur: string | null;
  private readonly pend = new Map<string, string>();
  private prev: { value: string; until: number } | null | undefined = undefined;
  // Plan assembly (review findings): the re-read's clock and its warned findings, the generations already reported
  // unaccounted for, when this process first saw a rotation owed (the stall alert), and when a failed mint began.
  private lastReread = Number.NEGATIVE_INFINITY;
  private readonly fileWarned = new Set<string>();
  private readonly unaccounted = new Set<string>();
  private owedSince: number | null = null;
  private mintFailedSince: number | null;
  private mintGuardWarned = false;
  // Final review (D-4409 item 6): the generations presented in a pending slot, and the slot layout they are read against.
  private readonly presentedPending = new Set<string>();
  private slotIds: string[] = [];
  private pendSeen: number[] = [0, 0, 0];
  // D-4412: the retired presentations already weighed, and when one last owed a rotation (in memory; the persisted
  // owed flag is what survives a restart).
  private retiredSeen = 0;
  private retiredOwedAt: number | null = null;
  // D-4410: a retired digest whose append keeps failing is warned about once while it stands.
  private retiringWarned = false;
  private retiredUnreadableWarned = false;

  constructor(private readonly deps: DriverDeps, boot: BootResult) {
    this.now = deps.now ?? Date.now;
    this.warn = deps.warn ?? ((l) => console.warn(l));
    this.state = boot.state;
    this.mintFailed = boot.mintFailed;
    this.mintFailedSince = boot.mintFailed ? (boot.state?.mintFailedAt ?? this.now()) : null;
    this.door = deps.door ?? new ClaimDoor({ valueOf: (g) => this.deps.holder.pendingValue(g), warn: this.warn });
    this.cur = deps.holder.currentValue();
    for (const p of boot.state?.pending ?? []) {
      const v = deps.holder.pendingValue(p.id);
      if (v !== null) this.pend.set(p.id, v);
    }
    this.presentedBase = deps.holder.counters().matched.current;
    this.slotIds = [...this.pend.keys()];
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, DRIVER_TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Single-flight: a tick while one runs joins it. */
  tick(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.runTick()
      .catch((e) => { this.warn(`ccrc-server: box token: a driver tick failed (${errno(e)}); the next tick retries`); })
      .finally(() => { this.running = null; });
    return this.running;
  }

  /** "Rotate now". `joined` only while a send or a promotion is actually in flight (D-4413): a send running, a promotion
   *  running or recorded, or an unspent press whose tick is still running. A press during a confirm wait or an own-write
   *  backoff is a new request (`started`); it may stage one more rotation once that wait ends. At the pending cap the
   *  `pending-cap` hold answers first, before the rate limit; with nothing in flight that is the answer, not `joined`. */
  async rotateNow(now: number): Promise<RotateAnswer> {
    const s = this.state;
    if (this.busy > 0 || s?.promoting != null || (this.rotateRequested && this.running !== null)) {
      return { ok: true, outcome: 'joined', view: this.view() };
    }
    const gate = this.gate(now);
    if (!gate.open && gate.hold === 'pending-cap') return { ok: false, error: 'held', hold: gate.hold, node: gate.node, view: this.view() };
    const since = now - this.lastRotateStart;
    if (since < ROTATE_NOW_MIN_INTERVAL_MS) {
      return { ok: false, error: 'rate-limited', retryAfterS: Math.ceil((ROTATE_NOW_MIN_INTERVAL_MS - since) / 1000) };
    }
    if (!gate.open) return { ok: false, error: 'held', hold: gate.hold, node: gate.node, view: this.view() };
    this.rotateRequested = true;
    this.lastRotateStart = now;
    void this.tick();
    return { ok: true, outcome: 'started', view: this.view() };
  }

  /** The claim door's hand-out, persisted (fsynced) BEFORE the 200 (D-4394). A failed write discards the
   *  generation, so it is never handed out, and rejects: the route answers 503. */
  async commitHandOut(generation: string, at: number): Promise<void> {
    const s = this.state;
    if (s === null || !s.pending.some((p) => p.id === generation && p.handedOutAt === null)) {
      throw new Error('commitHandOut: the generation is not staged');
    }
    const next = handedOutState(s, generation, at);
    // In memory FIRST, in the same synchronous step as the check above, as `commit()` does (final review, D-4409 item 5):
    // a lost op result folded while the write below is in flight must see the value handed out and keep it. Assigning
    // this snapshot after the await would overwrite whatever that fold wrote, and drop a value the fleet is about to hold.
    this.state = next;
    try {
      await this.persist(next);
      const g = next.pending.find((p) => p.id === generation);
      this.warn(`ccrc-server: box token: generation #${g?.seq} handed out`);
    } catch (e) {
      await this.discard([generation]);
      this.warn(`ccrc-server: box token: the hand-out of a generation could not be recorded (${errno(e)}); it was discarded`);
      throw e;
    }
  }

  view(): BoxTokenView {
    const s = this.state;
    const c = this.deps.holder.counters();
    const obs = this.lastObs?.read;
    const fleetConfirmed: BoxTokenView['fleetConfirmed'] =
      s !== null && s.current.id !== null && s.fleetConfirmed === s.current.id ? (this.deps.bothWriter !== null ? 'own-write' : 'current')
        : obs === undefined ? 'unknown' : obs.kind === 'id' ? 'behind' : obs.kind;
    const now = this.now();
    const stalled: BoxTokenView['stalled'] = this.mintFailed && this.mintFailedSince !== null
      ? { why: 'mint-failed', since: this.mintFailedSince }
      : this.owedSince !== null && now - this.owedSince >= STALL_ALERT_MS ? { why: 'owed', since: this.owedSince } : null;
    return {
      phase: phaseOf(s, this.hold?.hold ?? null, this.deps.holder.hasCurrent()),
      origin: s?.origin ?? null,
      currentSeq: s?.current.seq ?? null,
      currentSince: s?.current.since ?? null,
      lastRotationAt: s?.lastRotationAt ?? null,
      rotationOwed: s?.rotationOwed ?? false,
      owedWhy: s?.owedWhy ?? null,
      hold: this.hold?.hold ?? null,
      holdNode: this.hold?.node ?? null,
      failures: s?.failures ?? 0,
      lastFailure: this.mintFailed ? 'mint-failed' : s?.lastFailure ?? null,
      banner: (s?.failures ?? 0) >= FAILURES_FOR_BANNER,
      stalled,
      fileProblem: s?.fileProblem ?? null,
      fleetConfirmed,
      fleetTransport: s?.lastSync?.transport ?? null,
      lastSync: s?.lastSync ? { at: s.lastSync.at, word: s.lastSync.word } : null,
      previousPresented: c.matched.previous,
      retiredPresented: c.retired,
      retiredRefused: s?.retiredRefusedAt != null,
      lastBootRecovery: s?.lastBootRecovery ?? null,
      role: this.deps.env.role,
    };
  }

  // ── one tick ───────────────────────────────────────────────────────────────

  private async runTick(): Promise<void> {
    const ready = this.deps.rows.lastReadyAt();
    if (ready !== null && ready !== this.lastReadySeen) {
      if (this.lastReadySeen !== null) this.backoffUntil = null;   // a fresh ready resets the backoff (spec §5.1)
      this.lastReadySeen = ready;
    }
    await this.loadPrevious();
    await this.settleRetiring();
    await this.drainDoorAlerts();
    await this.noteCounters();
    await this.noteRetiredPresentations(this.now());
    await this.reread(this.now());
    this.noteUnaccounted(this.now());
    this.noteOwed(this.now());
    let obs: GenerationObservation | null = null;
    if (this.deps.generation !== null && this.deps.rows.linkUp() && this.state !== null) {
      obs = await this.deps.generation.read();
      this.lastObs = obs;
    }
    for (let step = 0; step < MAX_STEPS; step++) {
      const now = this.now();
      const a = nextAction({ state: this.state, gate: this.gate(now), generation: obs,
        rotateRequested: this.rotateRequested, backoffUntil: this.backoffUntil, now });
      if (a.kind !== 'hold') await this.setHold(null);
      switch (a.kind) {
        case 'none': case 'backoff': return;
        case 'hold':
          this.rotateRequested = false;   // a closed gate spends the press (F3a): it must not outlive the hold and bypass a later backoff
          await this.setHold({ hold: a.hold, node: a.node }); return;
        case 'retry-mint': if (!(await this.retryMint(now))) return; break;
        case 'stage': if (!(await this.stage(a.why, now))) return; break;
        case 'send': await this.inFlight(() => this.send(a.generation, a.nodeId)); return;
        case 'promote': await this.inFlight(() => this.promote(a.generation, a.via)); return;
        case 'retire': await this.retire(a.why); break;
        case 'extend-grace': await this.commit(extendedGraceState(this.mustState(), now));
          this.warn('ccrc-server: box token: grace extended: the new value has not been presented yet; a forward rotation is owed');
          break;
      }
    }
  }

  private gate(now: number): GateVerdict {
    const handedOut = this.state?.pending.filter((p) => p.handedOutAt !== null).length ?? 0;
    return rotationGate({ ...this.deps.env, nodes: this.deps.rows.nodes(), linkUp: this.deps.rows.linkUp(),
      learned: this.learned, lastReadyAt: this.deps.rows.lastReadyAt(), handedOutUnconfirmed: handedOut,
      pendingExit: pendingExitOpen(this.state?.pending ?? [], now), mintFailed: this.mintFailed, now });
  }

  /** Run a send or a promotion with `busy` raised, so `rotateNow` can tell one in flight from a pending value that
   *  nothing is working on (D-4413). */
  private async inFlight(fn: () => Promise<void>): Promise<void> {
    this.busy++;
    try { await fn(); } finally { this.busy--; }
  }

  private async retryMint(now: number): Promise<boolean> {
    if (!this.mintFailed) {
      // `nextAction` asks for a mint on a null state too; a mint over a mail.token that boot did not fail to mint would
      // replace a value this process never read. Unreachable today (boot returns a null state only after a failed mint).
      if (!this.mintGuardWarned) {
        this.mintGuardWarned = true;
        this.warn('ccrc-server: box token: a mint was asked for but no mint failed at boot; mail.token is left as it is');
      }
      return false;
    }
    const store = this.deps.store;
    const v = store.mintValue();
    let rec: WriteRecord;
    try {
      rec = await store.writeValue(store.paths.current, v);
    } catch (e) {
      // A rejection from the post-rename directory fsync means mail.token WAS replaced with its durability unproven:
      // the target is unknown, never assumed unchanged. Read it back, as boot does (D-4404 item 4).
      const after = await store.readValue(store.paths.current);
      if (after.kind !== 'value' || after.value !== v) return false;
      rec = { dev: after.meta.dev, ino: after.meta.ino, writtenAtMs: Math.ceil(after.meta.mtimeMs) };
      this.warn(`ccrc-server: box token: could not confirm the directory sync after writing ${store.paths.current} (${errno(e)}); the new value is in place`);
    }
    const owed: OwedReason | null = this.state === null ? null : 'recovered';
    this.state = mintedState(now, rec, this.state, owed, store.mintGenerationId());
    this.mintFailed = false;
    this.mintFailedSince = null;
    this.cur = v;
    this.pushSlots();
    await this.commit(this.state);
    this.warn(`ccrc-server: box token: minted a new value at ${store.paths.current} after a failed mint`);
    return true;
  }

  private async stage(why: OwedReason | 'rotate-now', now: number): Promise<boolean> {
    const store = this.deps.store;
    const id = store.mintGenerationId();
    const v = store.mintValue();
    let s = this.mustState();
    try {
      const rec = await store.writeValue(store.paths.pending(id), v);
      s = stagedState(this.mustState(), id, now, rec);
    } catch (e) {
      // The write may have replaced the file before its directory fsync rejected; the id is recorded nowhere, so the
      // file would be an orphan holding a value: remove it (idempotent).
      await store.removeValue(store.paths.pending(id)).catch(() => {});
      // F3(a)(b): the press is spent whether the stage worked or not, and the backoff is set BEFORE the commit, which
      // can throw on the same fault (ENOSPC, EROFS) and would otherwise leave no backoff at all.
      this.rotateRequested = false;
      this.backoffUntil = now + backoffMs(s.failures + 1);
      this.warn(`ccrc-server: box token: could not stage a generation (${errno(e)}); retrying with backoff`);
      await this.commit({ ...s, failures: s.failures + 1, lastFailure: 'mint-failed' });
      return false;
    }
    if (why !== 'rotate-now') s = owe(s, why);
    this.rotateRequested = false;
    this.backoffUntil = null;   // a stage that worked proves the disk: a bypassed backoff was spent on this value (F3c)
    this.state = s;
    this.pend.set(id, v);
    this.pushSlots();                 // the check accepts G from staging (spec §5)
    await this.commit(s);
    this.warn(`ccrc-server: box token: rotation started (generation #${s.pending[s.pending.length - 1].seq}, ${why})`);
    return true;
  }

  private async send(id: string, nodeId: string): Promise<void> {
    const link = this.deps.link;
    if (link === null) return;
    const code = this.door.issue(id, nodeId, this.now());
    let r: SyncResult;
    try { r = await link.send(code); } finally { this.door.revoke(id); }   // the code never outlives the op, however it ends
    const before = this.mustState();
    const out = applySyncResult(before, id, r, this.now());
    if (out.learned !== null) {
      this.learned = out.learned;
      this.warn(`ccrc-server: box token: held: ${out.learned.hold} (re-probed on the next ready, or in an hour)`);
    }
    const dropped = before.pending.filter((p) => !out.state.pending.some((q) => q.id === p.id)).map((p) => p.id);
    this.state = out.state;
    await this.discard(dropped);
    if (out.state.failures > before.failures) {
      this.backoffUntil = this.now() + backoffMs(out.state.failures);
      this.warn(`ccrc-server: box token: sync failed (${out.state.lastFailure}); attempt ${out.state.failures}, retrying with backoff`);
    }
    if (r.kind === 'synced') this.backoffUntil = null;
    await this.commit(this.mustState());
    if (out.promote !== null) await this.promote(out.promote, 'op-result');
  }

  /** Spec §5 promotion, in its order; each step is safe to run again. */
  private async promote(id: string, via: 'op-result' | 'generation-read' | 'own-write'): Promise<void> {
    const store = this.deps.store;
    const s0 = this.mustState();
    const g = s0.pending.find((p) => p.id === id);
    const value = this.pend.get(id) ?? null;
    if (g === undefined || value === null) {
      // `promotedState` throws on an id that left `pending`, and `nextAction` returns `promote` from a persisted
      // `promoting.id` unchecked: clear it (persisted), promote nothing this tick, owe a rotation, and say so once
      // (no value). An entry that is still pending but has no value in memory is dropped too (persisted): left in
      // `pending`, a generation read naming it would select this same promotion every tick, forever (D-4409 item 5).
      await this.discard([id]);
      await this.commit(owe({ ...this.mustState(), promoting: null }, 'recovered'));
      this.warn('ccrc-server: box token: a promotion named no pending value; it was abandoned and a rotation is owed');
      return;
    }
    if (via === 'own-write') {
      try { await this.deps.bothWriter?.write(value, id); } catch (e) {
        const f = s0.failures + 1;
        this.backoffUntil = this.now() + backoffMs(f);   // F3(b): before the commit, which can throw on the same fault
        this.warn(`ccrc-server: box token: could not write the fleet file on this both box (${errno(e)}); retrying with backoff`);
        await this.commit({ ...s0, failures: f, lastFailure: 'write-failed' });
        return;
      }
    }
    // A previous value still in grace is retired first: the fleet has confirmed a later one. This is the third exit from
    // Previous (D-4411, beside "grace passed and the new current presented" and the hard bound): it logs the retire
    // action's line and records its digest exactly as that action does (D-4410).
    if (s0.previous !== null) this.logRetired('grace', await this.retireValue());
    await this.commit({ ...this.mustState(), promoting: { id } });                                   // (a)
    const renamed = (await store.readValue(store.paths.pending(id))).kind === 'absent';
    let prevWrite = null;
    // (b): the old current is still in memory until the swap below, so a retry after a completed (c) rewrites it.
    prevWrite = this.cur !== null ? await store.writeValue(store.paths.previous, this.cur) : null; // (b)
    let currentWrite: WriteRecord | null = null;
    if (!renamed) {
      try {
        await store.renameOver(store.paths.pending(id), store.paths.current);                       // (c)
      } catch (e) {
        // A rejection from the post-rename directory fsync means mail.token WAS replaced with its durability unproven:
        // the target is unknown, never assumed unchanged. Re-read it; if it carries the value, (c) is done.
        const after = await store.readValue(store.paths.current);
        if (after.kind !== 'value' || after.value !== value) throw e;
        this.warn(`ccrc-server: box token: could not confirm the directory sync after promoting a generation (${errno(e)}); the new value is in place`);
      }
    } else {
      // The pending file is gone: usually this promotion's own rename (an interrupted earlier attempt), but a file
      // removed out of band looks the same. Read mail.token back; when it does not carry the value, the fleet-confirmed
      // value is rewritten from memory, atomically, rather than promoting over a file that never received it (D-4408).
      const after = await store.readValue(store.paths.current);
      if (after.kind !== 'value' || after.value !== value) {
        currentWrite = await store.writeValue(store.paths.current, value);
        this.warn('ccrc-server: box token: the pending file was gone but mail.token did not carry the promoted value; it was rewritten from memory');
      }
    }
    const now = this.now();
    const before = this.mustState();
    this.attributePending();   // a presentation of G while it was pending counts for the new current (D-4409 item 6)
    let next = promotedState({ ...before, promoting: null }, id, now, prevWrite,                       // (d)
      { via, presented: this.presentedPending.has(id) });
    if (via === 'own-write') next = { ...next, fleetConfirmed: id };
    if (currentWrite !== null) next = { ...next, current: { ...next.current, write: currentWrite } };
    // Only the values that actually left `pending` are discarded: promotedState keeps a LATER handed-out one (D-4400).
    const left = before.pending.filter((p) => p.id !== id && !next.pending.some((q) => q.id === p.id)).map((p) => p.id);
    for (const o of left) { this.door.revoke(o); await store.removeValue(store.paths.pending(o)); this.pend.delete(o); }
    this.prev = this.cur !== null && next.previous !== null ? { value: this.cur, until: next.previous.hardUntil } : null;
    this.cur = value;
    this.pend.delete(id);
    this.presentedPending.delete(id);
    this.state = next;
    // The base is taken in the same synchronous step as the swap, BEFORE it: the new current is accepted from
    // `pushSlots`, so a presentation of it during the commit below must count (D-4409).
    this.presentedBase = this.deps.holder.counters().matched.current;
    this.pushSlots();
    await this.commit(next);
    this.warn(`ccrc-server: box token: generation #${g.seq} confirmed (${via}) and promoted; the previous value stays accepted for grace`);
  }

  private async retire(why: 'grace' | 'hard-bound'): Promise<void> {
    this.logRetired(why, await this.retireValue());
  }

  /** The retirement line (spec §7.1): one wording for the `retire` action and for the early retirement at a promotion. */
  private logRetired(why: 'grace' | 'hard-bound', refused: boolean): void {
    this.warn(why === 'hard-bound'
      ? 'ccrc-server: box token: the previous value was retired at the hard bound, before the new value was presented'
      : `ccrc-server: box token: grace ended; the previous value was retired${refused ? ' and is refused' : ''}`);
  }

  /** Retirement (D-4410): the digest is written to `box-token.json` (the `retiring` record) BEFORE the value leaves the
   *  accept set, and stays there until the append to `box-token-retired.json` has landed; a failed append is retried
   *  from that record on every tick and never drops the digest. If the record cannot be written, the value is not
   *  retired (it stays accepted) and this throws, so the tick retries. Then the slot is emptied, the file deleted,
   *  the check run with the retiring value and "retired value refused" recorded (spec §5, §10.3). Answers whether the
   *  self-check refused it, the stamp it wrote being the only reading of "refused" (D-4407). */
  private async retireValue(): Promise<boolean> {
    const store = this.deps.store;
    const now = this.now();
    let v = this.prev?.value ?? null;
    if (v === null) { const r = await store.readValue(store.paths.previous); v = r.kind === 'value' ? r.value : null; }
    const digest = v === null ? null : valueDigestHex(v);
    if (digest !== null) {
      await this.commit(retiringRecorded(this.mustState(), digest, now));      // durable BEFORE the value leaves
    }
    await store.removeValue(store.paths.previous);
    this.prev = null;
    this.pushSlots();
    await this.landRetiring();
    const refused = v !== null && this.deps.holder.match(v) === null && this.deps.holder.isRetired(v);
    await this.commit({ ...this.mustState(), previous: null, retiredRefusedAt: refused ? now : this.mustState().retiredRefusedAt });
    return refused;
  }

  /** The retired list in memory after a read of the file: its digests plus those still waiting in `box-token.json`
   *  (D-4410). A file that cannot be read back keeps what memory already has and adds the waiting ones, so a transient
   *  read error never forgets a retired value. */
  private refreshRetired(rr: Awaited<ReturnType<TokenStore['readRetired']>>): void {
    const waiting = this.state ? retiringDigests(this.state) : [];
    if (rr.kind === 'retired') { this.retiredUnreadableWarned = false; this.deps.holder.setRetired([...rr.digests, ...waiting]); return; }
    if (rr.kind === 'unreadable') {
      if (!this.retiredUnreadableWarned) {
        this.retiredUnreadableWarned = true;
        this.warn(`ccrc-server: box token: ${this.deps.store.paths.retired} cannot be read (${rr.code}); the retired list in memory is kept`);
      }
    } else this.retiredUnreadableWarned = false;
    this.deps.holder.addRetired(waiting);
  }

  /** Append every digest waiting in the `retiring` record to the retired file; the ones that land leave the record. A
   *  failure keeps the record and is warned about once while it stands (never the digest, never the value). */
  private async landRetiring(): Promise<void> {
    const s = this.state;
    const waiting = s ? retiringDigests(s) : [];
    if (s === null || waiting.length === 0) { this.retiringWarned = false; return; }
    const store = this.deps.store;
    const landed: string[] = [];
    for (const e of s.retiring ?? []) {
      try { await store.appendRetired(e.sha256, e.at); landed.push(e.sha256); } catch (err) {
        if (!this.retiringWarned) {
          this.retiringWarned = true;
          this.warn(`ccrc-server: box token: could not record a retired digest (${errno(err)}); it stays in ${store.paths.state} and the append is retried`);
        }
      }
    }
    // The holder learns the list BEFORE the record is cleared: an append that landed is a retired value from then on, even if
    // the commit below throws and a later tick finds nothing waiting (review of batch 2).
    this.refreshRetired(await store.readRetired());
    if (landed.length > 0) await this.commit(retiringLanded(this.mustState(), landed));
    if (retiringDigests(this.mustState()).length === 0) this.retiringWarned = false;
  }

  /** Every tick: a digest still waiting for its append is retried (D-4410). */
  private async settleRetiring(): Promise<void> {
    if (this.state === null || retiringDigests(this.state).length === 0) return;
    await this.landRetiring();
  }

  /** D-4412: a retired value presented on any box-token lane makes one forward rotation owed with its own word, within
   *  the policy's bound. The holder counts the presentations; `oweForRetiredPresentation` decides; this only feeds it. */
  private async noteRetiredPresentations(now: number): Promise<void> {
    const total = this.deps.holder.counters().retired;
    const fresh = total - this.retiredSeen;
    this.retiredSeen = total;
    if (this.state === null || fresh <= 0) return;
    const next = oweForRetiredPresentation({ state: this.state, fresh, busy: this.busy > 0, lastOwedAt: this.retiredOwedAt, now });
    if (next === null) return;
    this.retiredOwedAt = now;
    this.warn('ccrc-server: box token: a retired value was presented on a box-token lane; a forward rotation is owed (retired-presented)');
    await this.commit(next);
  }

  // ── bookkeeping ────────────────────────────────────────────────────────────

  private mustState(): BoxTokenState {
    if (this.state === null) throw new Error('box token driver: no state');
    return this.state;
  }

  private async loadPrevious(): Promise<void> {
    if (this.prev !== undefined) return;
    const s = this.state;
    if (s?.previous == null) { this.prev = null; return; }
    const r = await this.deps.store.readValue(this.deps.store.paths.previous);
    this.prev = r.kind === 'value' ? { value: r.value, until: s.previous.hardUntil } : null;
  }

  /** Final review, D-4409 item 6: which handed-out generations were presented in a PENDING slot. The holder counts per
   *  slot index, so each delta is attributed to the generation that held that slot before the layout changes. The
   *  driver only records; `promotedState` decides what it means (spec §5: the fleet's own proof call presents it). */
  private attributePending(): void {
    const m = this.deps.holder.counters().matched;
    const counts = [m.pending0, m.pending1, m.pending2];
    this.slotIds.forEach((id, i) => {
      if ((counts[i] ?? 0) > (this.pendSeen[i] ?? 0) && (this.state?.pending.find((p) => p.id === id)?.handedOutAt ?? null) !== null) {
        this.presentedPending.add(id);
      }
    });
    this.pendSeen = counts;
  }

  private pushSlots(): void {
    this.attributePending();
    const slots: HolderSlots = {
      current: this.cur,
      pending: (this.state?.pending ?? []).filter((p) => this.pend.has(p.id)).map((p) => ({ id: p.id, value: this.pend.get(p.id) as string })),
      previous: this.prev ?? null,
    };
    this.slotIds = slots.pending.map((p) => p.id);
    this.deps.holder.setSlots(slots);
  }

  private async discard(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    // The value leaves the code door, the holder and the state (persisted) BEFORE its file is deleted (final review,
    // D-4409 item 7): a delete that fails (EACCES, EIO) then leaves only an orphan file, which boot treats as
    // unverifiable, instead of a dropped value (e.g. one an outside party claimed) still accepted and recorded.
    for (const id of ids) { this.door.revoke(id); this.pend.delete(id); this.presentedPending.delete(id); }
    if (this.state !== null) {
      this.state = { ...this.state, pending: this.state.pending.filter((p) => !ids.includes(p.id)) };
      this.pushSlots();
      try { await this.persist(this.state); } catch (e) {
        this.warn(`ccrc-server: box token: could not record a discarded generation (${errno(e)}); the value is still dropped from memory`);
      }
    } else this.pushSlots();
    for (const id of ids) {
      try { await this.deps.store.removeValue(this.deps.store.paths.pending(id)); } catch (e) {
        this.warn(`ccrc-server: box token: could not delete the file of a discarded generation (${errno(e)}); the value is no longer accepted`);
      }
    }
  }

  /** The door's alerts, ACTED on (D-4406): a generation whose code expired or was presented from the wrong node was
   *  burned by the door, which promised "the driver must discard" it. A staged value (never handed out) is revoked,
   *  dropped from state and holder and its file deleted; a handed-out value is never dropped here (only a later
   *  confirmation or the fleet's own `code-used` drops one). A wrong node also owes a forward rotation. Idempotent. */
  private async drainDoorAlerts(): Promise<void> {
    const a = this.door.alerts;
    const gone = [...new Set([...a.expired, ...a.wrongNode])];
    const misbound = a.wrongNode.length > 0;
    a.wrongNode.splice(0);
    a.expired.splice(0);
    let s = this.state;
    if (s === null) return;
    if (misbound) s = owe(s, 'claim-misbound');
    for (const id of gone) this.door.revoke(id);
    const drop = gone.filter((id) => s !== null && s.pending.some((p) => p.id === id && p.handedOutAt === null));
    this.state = s;
    if (drop.length > 0) {
      const seqs = s.pending.filter((p) => drop.includes(p.id)).map((p) => `#${p.seq}`).join(', ');
      await this.discard(drop);
      this.warn(`ccrc-server: box token: discarded the staged generation ${seqs}: its claim code was burned by the door`);
    }
    if (drop.length > 0 || misbound) await this.commit(this.mustState());
  }

  private async noteCounters(): Promise<void> {
    const s = this.state;
    if (s === null) return;
    this.attributePending();
    const c = this.deps.holder.counters();
    let next = s;
    if (s.previous !== null && !s.previous.currentPresented && c.matched.current > this.presentedBase) {
      next = { ...next, previous: { ...s.previous, currentPresented: true } };
    }
    if (s.counters.previousPresented !== c.matched.previous || s.counters.retiredPresented !== c.retired) {
      next = { ...next, counters: { previousPresented: c.matched.previous, retiredPresented: c.retired } };
    }
    if (next !== s) await this.commit(next);
  }

  /** The hold is recorded in memory AND in `box-token.json` whenever it (or its node) actually changes: Part B's
   *  doctor reads `held:<TokenHold>` from that file, so a hold that lived in memory only would read as a plain owed
   *  rotation with the wrong remedy (D-4409). The write goes through the serialised `commit`. */
  private async setHold(h: { hold: TokenHold; node: string | null } | null): Promise<void> {
    const same = (this.hold?.hold ?? null) === (h?.hold ?? null) && (this.hold?.node ?? null) === (h?.node ?? null);
    this.hold = h;
    const s = this.state;
    const changed = s !== null && (s.hold !== (h?.hold ?? null) || s.holdNode !== (h?.node ?? null));
    if (s !== null) this.state = { ...s, hold: h?.hold ?? null, holdNode: h?.node ?? null };
    if (!same && h !== null) this.warn(`ccrc-server: box token: held: ${h.hold}${h.node !== null ? ` (${h.node})` : ''}`);
    // Spec §5.1 "Pending values": reaching the cap takes repeated lost hand-outs, which is itself the alert.
    if (!same && h?.hold === 'pending-cap') {
      this.warn('ccrc-server: box token: handed-out values unaccounted for: the pending cap is reached, and no rotation starts until the fleet confirms one, or both are past their confirm deadline');
    }
    if (changed) await this.commit(this.mustState());
  }

  /** Spec 4.2's run-time re-read (plan assembly), at the readiness cadence: every server token file this driver holds
   *  a value for is read again and compared with memory. Memory always wins: an out-of-band edit is never adopted at
   *  run time (a restart adopts it, as today), a broken file never empties a slot, and a retired value written back is
   *  never accepted. A finding is warned once while it stands; the first one is recorded for doctor and the card. */
  private async reread(now: number): Promise<void> {
    if (now - this.lastReread < TOKEN_FILE_REREAD_MS) return;
    this.lastReread = now;
    const store = this.deps.store;
    const checks: { file: FileProblem['file']; path: string; want: string }[] = [];
    if (this.cur !== null) checks.push({ file: 'current', path: store.paths.current, want: this.cur });
    for (const [id, v] of this.pend) checks.push({ file: 'pending', path: store.paths.pending(id), want: v });
    if (this.prev) checks.push({ file: 'previous', path: store.paths.previous, want: this.prev.value });
    let found: FileProblem | null = null;
    const standing = new Set<string>();
    for (const c of checks) {
      const r = await store.readValue(c.path);
      const word: TokenFileProblem | null = r.kind === 'value'
        ? (r.value === c.want ? null : this.deps.holder.isRetired(r.value) ? 'retired' : 'changed')
        : r.kind === 'absent' ? 'missing' : r.kind;
      if (word === null) continue;
      found ??= { at: now, file: c.file, word };
      const key = `${c.path} ${word}`;
      standing.add(key);
      if (!this.fileWarned.has(key)) {
        this.warn(`ccrc-server: box token: ${c.path} ${FILE_PROBLEM_TEXT[word]} on re-read; the last good value is kept in memory`);
      }
    }
    this.fileWarned.clear();
    for (const k of standing) this.fileWarned.add(k);
    const s = this.state;
    const was = s?.fileProblem ?? null;
    if (s !== null && (was?.file !== found?.file || was?.word !== found?.word)) await this.commit({ ...s, fileProblem: found });
  }

  /** Spec §6 "Someone claims first": a handed-out value past its deadline is unaccounted for. Once per generation. */
  private noteUnaccounted(now: number): void {
    for (const p of this.state?.pending ?? []) {
      if (p.confirmBy === null || now <= p.confirmBy || this.unaccounted.has(p.id)) continue;
      this.unaccounted.add(p.id);
      this.warn(`ccrc-server: box token: a handed-out value is unaccounted for (generation #${p.seq}); it stays accepted until a later generation is confirmed`);
    }
  }

  /** The stall alert's clock: when this process first saw a rotation owed; cleared once nothing is owed. */
  private noteOwed(now: number): void {
    if (this.state?.rotationOwed !== true) this.owedSince = null;
    else if (this.owedSince === null) this.owedSince = now;
  }

  /** Set and persist the state; writes are serialised so a later write never lands before an earlier one. */
  private async commit(s: BoxTokenState): Promise<void> {
    this.state = s;
    await this.persist(s);
  }

  private persist(s: BoxTokenState): Promise<void> {
    const run = this.persistChain.then(() => this.deps.store.writeState(s));
    this.persistChain = run.catch(() => {});
    return run;
  }
}
