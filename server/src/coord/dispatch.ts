import type { Tmux } from '../exec.js';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { KeyedQueue } from '../inject/queue.js';
import { measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';
import { readHookState } from '../hookstate.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { sendPrompt } from '../inject/send.js';
import { type AdvanceResult, type CoordStore } from './store.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER, holdReason, queueSystemMail } from './rundefs.js';
import { MAIL_BODY_MAX_BYTES, type RunRefuseCode, type RunState } from '../../../shared/api.js';

/**
 * L1 decision function (architecture doc increment 4 — "deciding split from
 * acting"): everything `POST /api/runs/:id/dispatch` used to decide AND act
 * on, inline in its Fastify closure, now a named function with narrowed deps
 * in and a typed result union out. NO `reply` anywhere below — the route
 * (`routes.ts`) is now purely a union->status map (`sendDispatchOutcome`).
 *
 * Deliberately NOT pure — like `fingerprint.ts`'s `verifyDone`, the model
 * this ring follows, it performs the real I/O and the real fleet acts,
 * injected through `DispatchRunDeps` rather than imported. What makes it L1
 * is not the absence of side effects; it is that every side effect is
 * reached through a narrow, consumer-declared port, nothing here touches
 * `fastify`/`reply`, and the ORDER — precondition, then the irreversible
 * fleet act, then the commit — is owned here, in one place, rather than
 * scattered across a route body interleaved with HTTP concerns.
 *
 * `CoordMutex` stays exactly where it was (`routes.ts`): this function does
 * not serialise itself, the same way `verifyDone` does not lock anything —
 * the caller's job, not the decision's.
 */
export interface DispatchRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  tmux: Tmux; queue: KeyedQueue;
}

export type DispatchOutcome =
  | { ok: true; id: number; sessionId: string; resumed: boolean; clearedAt: number | null;
      briefQueued: boolean; clearError: string | null }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'oversize'; limit: number }
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily' |
        'ambiguous-dispatch' | 'worker-busy'>;
      limit?: number; running?: number; used?: number; candidates?: number }
  | { ok: false; kind: 'registry-unmeasurable' }
  | { ok: false; kind: 'unsupported' }
  | { ok: false; kind: 'fleetFailed'; stderr: string }
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> };

/**
 * Dispatch a run: pause and caps checked FIRST, then either a fresh
 * workspace (wave 1) or a resumed one with an injected `/clear` (wave N>=2,
 * deviation D-1), then the hold, then the transition, then the brief — as
 * MAIL, never injected directly (a fresh pane is `working` for its first
 * seconds, and the delivery lane's own gate is exactly the thing that knows
 * when it is not). `brief` is UNKNOWN off the wire — the route's own JSON
 * parse gives it no shape guarantee, so this function validates it itself,
 * in the same order the route used to (D-46: the transition guard runs
 * BEFORE the body is even looked at).
 */
export async function dispatchRun(deps: DispatchRunDeps, id: number, brief: unknown): Promise<DispatchOutcome> {
  const coord = deps.coord;
  const run = coord.run(id);
  if (!run) return { ok: false, kind: 'unknown-run' };
  // Precondition (D-46; a genuine CLAIM, not a stale read, because the
  // caller runs this whole function behind `CoordMutex` — see that class's
  // own docstring in `routes.ts`): `RUN_TRANSITIONS.dispatched` has no
  // self-edge (`dispatched -> dispatched` is illegal). `advance()` below
  // still re-checks the live row and is still the only WRITER of `state`;
  // this only answers the question early enough that `ccd ensure`/`/clear`/
  // `ws-add`/`ws-hold` never fire for a transition that was always going to
  // be refused.
  if (run.state !== 'planned') {
    return { ok: false, kind: 'bad-transition', from: run.state, to: 'dispatched' };
  }

  if (typeof brief !== 'string' || brief.trim() === '') {
    return { ok: false, kind: 'bad-request' };
  }
  // Fix, review finding 2: the SAME byte cap `POST /api/mail` enforces on its
  // own `body`, applied to the brief — `queueSystemMail` below is a SECOND
  // producer of `mail`/`mail_deliveries` rows that used to bypass every cap
  // the envelope's own cost model depends on.
  if (Buffer.byteLength(brief, 'utf8') > MAIL_BODY_MAX_BYTES) {
    return { ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES };
  }

  // 1: PAUSE / KILL-SWITCH FIRST, before anything is counted or spawned. A
  // directory we cannot list is a pause we cannot rule out — fail-shut, the
  // identical idiom `watch.ts`'s mail sweep uses for its own `mail-disabled`
  // kill-switch marker, and for the same reason. spec:201-205: "no verb, no
  // route, no way for the coordinator to unpause itself."
  const names = await deps.io.readdir(deps.cfg.registryDir);
  if (names === null || names.includes(COORDINATOR_PAUSE_MARKER)) {
    return { ok: false, kind: 'refused', code: 'paused' };
  }
  // Fix, review finding 17: dispatch used to consult ONLY the pause marker —
  // refusing outright (rather than merely skipping the `/clear`) means the
  // run stays `planned` and the retry, once the operator lifts the marker,
  // gets a genuinely fresh dispatch.
  if (names.includes(MAIL_DISABLED_MARKER)) {
    return { ok: false, kind: 'refused', code: 'mail-disabled' };
  }

  // 2: caps. The refusal carries the numbers — a cap that refuses without
  // saying what it is is indistinguishable from a bug.
  const caps = coord.caps();
  const usage = coord.capsUsage();
  if (usage.running >= caps.maxConcurrentWorkers) {
    return { ok: false, kind: 'refused', code: 'cap-concurrency',
      limit: caps.maxConcurrentWorkers, running: usage.running };
  }
  if (usage.dispatchedIn24h >= caps.maxSessionsPerDay) {
    return { ok: false, kind: 'refused', code: 'cap-daily',
      limit: caps.maxSessionsPerDay, used: usage.dispatchedIn24h };
  }

  let sessionId: string; let workspace: string | null; let branch: string | null;
  let resumed: boolean; let clearedAt: number | null = null; let clearError: string | null = null;

  if (run.sessionId === null) {
    // 3/4: fresh spawn — wave 1. Learn the new id by REGISTRY DIFF, never by
    // parsing ccd's own echoed sentence — a prose line nobody wrote a
    // contract for. BEFORE tolerates degradation (the question it answers,
    // "which ids already exist", always tolerates degradation in the SAFE
    // direction); AFTER never does — see the call site's own long-standing
    // comment in the route history for why the asymmetry is the design.
    const before = await readRegistry(deps.io, deps.cfg);
    const beforeIds = new Set(before.map((r) => r.id));
    const argv = CCD_ARGV.wsAdd(run.project);
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!afterRead.listed ||
        afterRead.records.some((r) => r.project === run.project && measuredIdentity(r) === null)) {
      return { ok: false, kind: 'registry-unmeasurable' };
    }
    const after = afterRead.records;
    const candidates = after.filter((r) =>
      !beforeIds.has(r.id) && r.project === run.project && r.workspace !== null);
    if (candidates.length !== 1) {
      // Nothing claimed on a guess: the run stays `planned`, no hold placed
      // — the operator resolves it.
      return { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: candidates.length };
    }
    const winner = candidates[0]!;
    sessionId = winner.id; workspace = winner.workspace; branch = winner.branch;
    resumed = false;
    // Fix, review finding 7: persist the spawn onto the run row RIGHT AWAY —
    // before the hold, which can still fail two steps below.
    coord.setSession(id, sessionId);
  } else {
    // Wave N>=2: resume the SAME workspace (deviation D-1 — no ccd verb can
    // spawn fresh into an existing one), then discard the resumed context
    // with an injected `/clear` through `sendPrompt`'s full proof discipline.
    sessionId = run.sessionId;
    const argv = CCD_ARGV.ensure(sessionId);
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    resumed = true;
    // The live registry, falling back to the run row — the identical
    // fallback `fingerprint.ts`'s `verifyDone` uses for the same reason.
    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!registryRead.listed) {
      return { ok: false, kind: 'registry-unmeasurable' };
    }
    const record = registryRead.records.find((r) => r.id === sessionId);
    const recordIdentity = record !== undefined ? measuredIdentity(record) : null;
    if (record !== undefined && recordIdentity === null) {
      return { ok: false, kind: 'registry-unmeasurable' };
    }
    workspace = record?.workspace ?? run.workspace;
    branch = record?.branch ?? run.branch;
    // Fix, review finding 12: refuse to `/clear` a session that is
    // OBSERVABLY mid-turn.
    const hs = recordIdentity
      ? await readHookState(deps.io, deps.cfg.registryDir, sessionId, recordIdentity.uuid, Date.now())
      : null;
    if (hs !== null && hs.state !== 'done') {
      return { ok: false, kind: 'refused', code: 'worker-busy' };
    }
    const clearRes = await sendPrompt({ tmux: deps.tmux, queue: deps.queue }, sessionId, '/clear');
    // A refused `/clear` is not fatal to dispatch itself — the run still
    // lands in `dispatched` below, with `clearedAt` left null as the honest
    // record that the second step has not run yet.
    clearedAt = clearRes.ok ? Date.now() : null;
    clearError = clearRes.ok ? null : clearRes.error;
  }

  // 5: hold, behind `verbSupported` — the standing convention reason string,
  // DISPLAY-ONLY and never parsed back.
  const holdArgv = CCD_ARGV.wsHold(sessionId, holdReason(run.program, run.wave, run.waveOf));
  if (!verbSupported(deps.fleetState, holdArgv)) {
    return { ok: false, kind: 'unsupported' };
  }
  const holdRes = await deps.runCcd(holdArgv);
  if (!holdRes.ok) return { ok: false, kind: 'fleetFailed', stderr: holdRes.stderr };

  // 6: one call each, so the `run_events` row happens and is independently
  // attributable from the dispatch write. A `/clear` refusal is RECORDED
  // (deviation D-47): `run_events.detail` carries the typed `sendPrompt`
  // error code an operator can otherwise only guess at.
  coord.markDispatched(id, sessionId, workspace, branch, resumed);
  if (clearedAt !== null) coord.setClearedAt(id, clearedAt);
  const adv = coord.advance(id, 'dispatched', 'coordinator',
    clearError !== null ? `clear-refused:${clearError}` : undefined);
  if (!adv.ok) return { ok: false, kind: 'advanceFailed', adv };

  // 7: the brief, as MAIL — never injected directly, and (deviation D-47)
  // queued ONLY when the worker's context is one it can actually land in:
  // wave 1 has never had anything else written into it, and wave N>=2's
  // `/clear` must have actually VERIFIED.
  const briefQueued = !resumed || clearedAt !== null;
  if (briefQueued) {
    queueSystemMail(coord, run, { toId: sessionId, runId: id, kind: 'status', subject: 'wave-brief', body: brief });
  }

  return { ok: true, id, sessionId, resumed, clearedAt, briefQueued, clearError };
}
