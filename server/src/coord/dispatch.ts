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
import {
  MAIL_BODY_MAX_BYTES, WORK_ITEM_MAX, WORK_ITEM_TITLE_MAX,
  type RunRefuseCode, type RunState,
} from '../../../shared/api.js';

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
export async function dispatchRun(
  deps: DispatchRunDeps, id: number, brief: unknown, items: unknown,
): Promise<DispatchOutcome> {
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
  // Fix, review finding 2: the SAME byte cap `POST /api/mail` enforces on
  // its own `body`, applied to the brief — `queueSystemMail` below is a
  // SECOND producer of `mail`/`mail_deliveries` rows that used to bypass
  // every cap the envelope's own cost model depends on (`envelope.ts`'s
  // COST paragraph: the caps exist "precisely so this paragraph's 'a few
  // hundred' [round trips] stays the true worst case"). `server.ts` builds
  // Fastify with no `bodyLimit` override, so without this the ceiling was
  // Fastify's default 1 MiB — a whole plan document pasted as a wave brief
  // types as tens of thousands of `sendPrompt` round trips, one per line,
  // inside this session's single `KeyedQueue` slot.
  if (Buffer.byteLength(brief, 'utf8') > MAIL_BODY_MAX_BYTES) {
    return { ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES };
  }

  // Spec §3.1. The BRIEF stays opaque prose and is parsed by nothing
  // (build7:216-217, :246-248) — the server never learns to read a wave plan
  // out of English. The coordinator, which wrote the brief, declares the item
  // titles beside it, as a structured field. `undefined` and `[]` are the same
  // legal answer: this run declared no ledger, and its tally renders an em
  // dash rather than 0/0 (spec §3.3).
  //
  // Validated HERE, beside the brief's own checks and BEFORE the pause check:
  // a malformed body is the cheapest refusal there is and D-46's ordering rule
  // puts it first — nothing is listed, counted, spawned or held for a request
  // that was never going to be accepted. BYTES, not characters, for
  // `WORK_ITEM_TITLE_MAX`'s own reason (`shared/api.ts`) and the brief cap's
  // just above.
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > WORK_ITEM_MAX) {
      return { ok: false, kind: 'bad-request' };
    }
    for (const t of items) {
      if (typeof t !== 'string' || t.trim() === '' ||
          Buffer.byteLength(t, 'utf8') > WORK_ITEM_TITLE_MAX) {
        return { ok: false, kind: 'bad-request' };
      }
    }
  }
  const itemTitles: readonly string[] = (items as string[] | undefined) ?? [];

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
    // 3/4: fresh spawn — wave 1. Learn the new id by REGISTRY DIFF, never
    // by parsing ccd's own echoed sentence (`workspace <id> on <wrapper> —
    // <path> (branch …)`, `ccd/ccd:1116`) — a prose line nobody wrote a
    // contract for, and this repo has already paid for one of those. Read
    // the registry before and after; exactly one new `workspace !== null`
    // row for this project is the run's session.
    // BEFORE tolerates degradation, deliberately — the question it answers
    // ("which ids already exist") is "does this still exist", and that
    // question tolerates degradation the same way `readRegistry`'s plain,
    // old signature always has (a degraded or dropped row just doesn't
    // count as pre-existing, which is always the SAFE direction to be
    // wrong in here: at worst a real id gets treated as new and trips
    // `ambiguous-dispatch` below, never silently misbound).
    const before = await readRegistry(deps.io, deps.cfg);
    const beforeIds = new Set(before.map((r) => r.id));
    const argv = CCD_ARGV.wsAdd(run.project);
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    // AFTER never tolerates degradation — the question here is "is this
    // NEW", the identity-by-subtraction this whole block performs, and
    // THAT one must not guess. Two drops (or, under the ladder, two
    // degraded same-project rows) could otherwise make an unrelated LIVE
    // workspace the SOLE "new" candidate below, which this function then
    // binds, holds and /clear's — a running worker's context destroyed
    // because of a read failure on a DIFFERENT session entirely. This is
    // the asymmetry to preserve on any future "simplification" of this
    // block back to a plain `readRegistry` call: BEFORE answers "does this
    // still exist" (tolerant); AFTER answers "is this new" (never
    // tolerant).
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
    // fallback `fingerprint.ts`'s `verifyDone` uses for the same reason
    // (see `DoneRun`'s own docstring): the live registry is the fresher
    // source, the run row is what is left when it cannot answer.
    //
    // REFUSE before the busy gate and before EITHER of workspace/branch is
    // persisted onto the run row below (`coord.markDispatched`) — registry
    // ladder, and the spot the design names as most likely to get
    // "simplified" back into a bug, so the reasoning is written at the
    // call site rather than only in the spec: an unmeasured value
    // persisted by `markDispatched` STOPS being a transient read and
    // BECOMES a fact the run row carries forever; and a degraded
    // `record.uuid` (`''`) fed to `readHookState` below looks up a
    // hookstate file that matches no real one, reading back `null` —
    // which the busy gate treats as "not busy" — silently turning a
    // FAIL-SHUT busy gate FAIL-OPEN on a session this read simply could
    // not measure, not one this read proved idle.
    //
    // Fix (blocking review finding 7): the registry read ITSELF must not
    // reopen that same fail-open door one level up. `readRegistry`'s old
    // signature collapses a whole-fleet `io.readdir` failure to `[]` —
    // exactly the shape "no such session" wears — so `record` used to come
    // back `undefined` for TWO different facts this function must tell
    // apart: the session's row is genuinely absent from a LISTABLE
    // registry (the pre-existing, tolerated "honest stale" case
    // `DoneRun`'s own docstring names, which keeps falling back to
    // `run.workspace`/`run.branch` below, same as always), and the
    // registry directory itself could not be listed at all — which proves
    // NOTHING about this session and must refuse exactly like the AFTER
    // read some 40-odd lines above already does. `readRegistryMeasured`
    // draws that line explicitly: `!listed` refuses OUTRIGHT, before
    // `record` is ever computed, so `record === undefined` past this point
    // means only the first, tolerated case — never the second.
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
    // OBSERVABLY mid-turn. `sendPrompt`'s `ok:true` can mean only "the
    // text left the input box" — `watch.ts`'s own mail-sweep comment and
    // `hookstate.ts`'s own docstring both say so in as many words: Claude
    // Code silently QUEUES a prompt sent mid-turn, so "the box reads
    // empty" is not "nothing is pending", and a `clearedAt` stamped from
    // `sendPrompt`'s return alone would assert a measurement the server
    // never made. This reads the SAME hookstate the mail lane's own gate
    // reads; when it is present and says the session is still working, the
    // dispatch is refused OUTRIGHT rather than risking exactly that false
    // record. An UNREADABLE/absent hookstate (no prior turn, or a session
    // whose harness has not written one yet — the ordinary shape for a
    // workspace this fresh) is not, by itself, proof of busy-ness and is
    // left to proceed, same as it always has.
    const hs = recordIdentity
      ? await readHookState(deps.io, deps.cfg.registryDir, sessionId, recordIdentity.uuid, Date.now())
      : null;
    if (hs !== null && hs.state !== 'done') {
      return { ok: false, kind: 'refused', code: 'worker-busy' };
    }
    const clearRes = await sendPrompt({ tmux: deps.tmux, queue: deps.queue }, sessionId, '/clear');
    // A refused `/clear` (dialog open, draft present, an ignored Enter…) is
    // not fatal to dispatch itself — the run still lands in `dispatched`
    // below, with `clearedAt` left null as the honest record that the
    // second step has not run yet; a coordinator that notices retries it
    // like any other failed step (D-1, orchestrator amendment). What
    // "recorded" and "retried" actually need — the refusal CODE, and never
    // queuing a brief into a context D-1's own "genuinely fresh" guarantee
    // was never met for — is deviation D-47 below.
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

  // 6: ONE call, and one transaction (D-B4-4). The dispatch write, the
  // `clearedAt` stamp, the transition and the declared ledger's INSERTs used
  // to be three independent `tx()`s plus (as of spec §3.1) a fourth batch of
  // statements after them — the same split `CoordStore.closeRun` was created
  // to close, reached a second time. `CoordStore.dispatchRun` owns the commit;
  // the `run_events` row still happens inside it and is still independently
  // attributable (`markDispatched`'s own docstring). A `/clear` refusal is
  // RECORDED (deviation D-47, found in Task 9 review) — D-1's own amended
  // text promises "the refusal recorded" and nothing did: `run_events.detail`
  // carries the typed `sendPrompt` error code (`dialog-open`/`draft-present`/
  // `verify-failed`/`enter-ignored`/…) an operator (or Task 11's own record)
  // can otherwise only guess at.
  const adv = coord.dispatchRun({ runId: id, sessionId, workspace, branch, resumed, clearedAt,
    items: itemTitles,
    detail: clearError !== null ? `clear-refused:${clearError}` : undefined });
  if (!adv.ok) return { ok: false, kind: 'advanceFailed', adv };

  // 7: the brief, as MAIL (kind `status`, subject `wave-brief`) — never
  // injected directly, and (deviation D-47) queued ONLY when the worker's
  // context is one it can actually land in: wave 1 has never had anything
  // else written into it, and wave N>=2's `/clear` must have actually
  // VERIFIED. Queuing unconditionally, as before, meant a refused `/clear`
  // still queued a brief into the resumed, un-cleared context — the exact
  // hazard D-1's "genuinely fresh context" sentence exists to make
  // mechanical rather than hopeful. Concretely, on `enter-ignored` the
  // literal text `/clear` is left sitting in the worker's own input box
  // (`send.ts`'s own `draft` return); the delivery lane's very next sweep
  // calls `sendPrompt` with no `replaceDraft`, so it would hit
  // `draft-present` immediately and keep hitting it — parking the brief
  // `rejected('undeliverable')` after `MAIL_MAX_ATTEMPTS`, with nothing
  // surfacing WHY. `clearError` (this outcome's own field) is the signal a
  // coordinator needs to decide what to do next; `POST /api/mail` stays
  // open to send the brief directly once the context is actually fresh.
  const briefQueued = !resumed || clearedAt !== null;
  if (briefQueued) {
    queueSystemMail(coord, run, { toId: sessionId, runId: id, kind: 'status', subject: 'wave-brief', body: brief });
  }

  return { ok: true, id, sessionId, resumed, clearedAt, briefQueued, clearError };
}
