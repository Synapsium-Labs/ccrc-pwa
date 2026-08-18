// The seventh lane. Six gate conjuncts (plus the priming rule, a seventh
// short-circuit ahead of all of them), one send discipline borrowed whole
// from `sendPrompt`, and a replay-until-ack loop dated off the hook's own
// `UserPromptSubmit` edge. Modelled on `name-sweep.test.ts` (fake timers, a
// recording Runner, a public sweep method) with one addition that lane never
// needed: `sweepMail` ends in an actual injection, and `sendPrompt`'s own
// polling loops run on REAL setTimeout — watch.ts hands it no `sleep`
// override to fake. So this file fakes `Date` alone (`toFake: ['Date']`,
// `pr-sweep.test.ts`'s own idiom for the same reason): `Date.now()` is
// controllable so the gate arithmetic is deterministic, while real timers
// keep flowing underneath so sendPrompt's echo/submit polls actually settle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { renderEnvelope, renderMailNudge } from '../src/coord/envelope.js';
import { HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-coordinator';
const UUID = 'a'.repeat(36);
const PID = 4242;
const FROM_ID = 'demo-quiet-mesa';
const FROM_UUID = 'b'.repeat(36);
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms, no relation to real time

// Local mirrors of watch.ts's own (private, unexported) lane constants — same
// idiom as name-sweep.test.ts's PAST_LANE_MS: this file has no import path to
// the real ones, so it redeclares them and a drift shows up as a failing
// test rather than a silently-wrong assertion.
const MAIL_SWEEP_MS = 10_000;
const MAIL_QUIET_MS = 60_000;
const MAIL_COOLDOWN_MS = 120_000;
const MAIL_REPLAY_MS = 600_000;
const MAIL_MAX_ATTEMPTS = 6;
const MAIL_BACKOFF_BASE_MS = 30_000;
const MAIL_BACKOFF_MAX_MS = 900_000; // watch.ts's own PR_BACKOFF_MAX_MS, mirrored — see its own comment
const PAST_SWEEP_MS = MAIL_SWEEP_MS + 1_000; // clears the lane's own re-sweep gate

// The STORED envelope's own bytes — `mail_deliveries.envelope`, what
// `queueTestDelivery` writes below. Under the reference-nudge lane
// (robust-mail-delivery) this is no longer what gets TYPED — it is served
// verbatim over `GET /api/mail/:id` instead (`mail-routes.test.ts`'s own
// coverage) — so its content is arbitrary here; only its presence in the
// `mail_deliveries` row matters to these tests.
const ENVELOPE = 'ccrc-mail test payload';
// The single-line reference the delivery lane actually types, for THIS
// file's one recipient (`ID`). `renderMailNudge` is a pure function of
// `toId` alone — the same bytes every test in this file that reaches a
// successful send should see land in the pane, regardless of which
// delivery triggered it (spec §1.1's "ID-AGNOSTIC… one nudge drains all").
const NUDGE = renderMailNudge(ID);

const emptyBox = '❯ \n';
const echoedBox = (text: string): string => `❯ ${text}\n`;
/** The exact three-capture script a clean `sendPrompt` success consumes:
 *  empty-draft check, echo verification, empty-after-Enter. Lifted from
 *  send.test.ts's own "happy path" fixture. */
const HAPPY_PANES = [emptyBox, echoedBox(NUDGE), emptyBox];

const seedRegistry = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A fresh, `done`, ask-free hookstate — the gate's own idle. Every field a
 *  test doesn't care about is a value that passes; override only the one
 *  that matters. */
const seedHookState = (home: string, id: string, over: Record<string, unknown> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const body = {
    v: 1, state: 'done', sessionId: UUID, pid: PID, event: null,
    updatedAt: NOW - 61_000, ask: null, subagents: [],
    ...over,
  };
  writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify(body));
};

/** A live-state file that has been idle for comfortably longer than
 *  MAIL_QUIET_MS. */
const seedLiveState = (home: string, over: Record<string, unknown> = {}): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  const body = {
    pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220',
    ...over,
  };
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify(body));
};

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/**
 * An `io` whose `readdir` fails exactly once, on its NEXT call, then answers
 * normally forever after — set-and-forget via the returned setter. Plain
 * `unlistableIO` (`{ ...localIO, readdir: async () => null }`,
 * `mail-routes.test.ts`'s own fixture for this exact kill-switch on the
 * ingress side) is unusable here: `sweepMail`'s kill-switch check and
 * `readRegistry` both call `io.readdir` on the SAME `registryDir`, so an
 * unconditional null also empties the registry and blocks the send for an
 * unrelated reason (`rec` not found) — a fail-OPEN mutant on the kill-switch
 * line would still leave every test green, exactly the gap review finding 8
 * names. Failing only the ONE read under test — the kill-switch's own,
 * transient in the way a single dropped agent-WS round trip is — isolates
 * the fail-shut behaviour from the registry read that follows it.
 */
const onceUnlistableIO = (): { io: FleetIO; failNext: () => void } => {
  let fail = false;
  const io: FleetIO = { ...localIO, readdir: async (p) => {
    if (fail) { fail = false; return null; }
    return localIO.readdir(p);
  } };
  return { io, failNext: () => { fail = true; } };
};

/**
 * An `io` whose `readdir` passes through untouched until `arm()` is called,
 * then ALTERNATES pass/fail on every subsequent call to the registry
 * directory — the shape a single dropped agent-WS round trip produces on
 * only the SECOND of `sweepMail`'s own two directory reads (the kill-switch
 * listing, then `readRegistryMeasured`'s own internal one), sweep after
 * sweep, without ever tripping the kill-switch itself. Unarmed during
 * `primedWatcher`'s own priming tick (which fires several unrelated
 * `readdir` calls of its own, over a registry directory `harness()` creates
 * empty-but-listable) so those never perturb the parity; a test calls `arm()` once
 * its fixtures are seeded and it is about to drive `sweepMail()` directly
 * (blocking review findings 1/5).
 */
const alternatingUnlistableIO = (): { io: FleetIO; arm: () => void } => {
  let armed = false;
  let n = 0;
  const io: FleetIO = { ...localIO, readdir: async (p) => {
    if (!armed) return localIO.readdir(p);
    n += 1;
    return n % 2 === 0 ? null : localIO.readdir(p);
  } };
  return { io, arm: () => { armed = true; } };
};

/** A registry whose directory listing is fine but one specific session's
 *  field read is not — `readRegistry` drops that row entirely
 *  (`registry.ts:123`) even though its `.uuid` file is still listed. Mirrors
 *  `mail-routes.test.ts`'s own fixture of the same name for the ingress side
 *  of this identical distinction (D-37). */
const withUnreadableField = (id: string, field: string): FleetIO => ({
  ...localIO,
  readFile: async (p) => (p.endsWith(`${id}.${field}`) ? null : localIO.readFile(p)),
});

const queueTestDelivery = (coord: CoordStore, toId: string, envelope: string): { mailId: number; id: number } => {
  const mail = coord.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId: null,
    kind: 'finding', subject: 'hi', body: envelope, artifacts: [] });
  const delivery = coord.queueDelivery(mail.id, toId, envelope);
  return { mailId: mail.id, id: delivery.id };
};

const deliveryRow = (coord: CoordStore, id: number):
  { state: string; attempts: number; nextAttemptAt: number; lastError: string | null; rejectCode: string | null } =>
  coord.db.prepare('SELECT state, attempts, nextAttemptAt, lastError, rejectCode FROM mail_deliveries WHERE id = ?')
    .get(id) as { state: string; attempts: number; nextAttemptAt: number; lastError: string | null; rejectCode: string | null };

interface Harness { home: string; calls: string[][]; run: Runner }

/** A runner that answers tmux well enough to drive the gate and, when the
 *  gate lets the sweep through, `sendPrompt` itself. `panes` scripts every
 *  `capture-pane` call IN ORDER (the last entry repeats for any call past
 *  the end of the script — the same convention send.test.ts's `fakeTmux`
 *  uses). */
const harness = (opts: { hasSession?: boolean; panes?: (string | null)[] } = {}): Harness => {
  const home = mkTmp('ccrc-mail-sweep-');
  // Empty, but LISTABLE (blocking review findings 1/3): `primedWatcher`'s
  // priming tick now takes the typed `readRegistryMeasured` read, and
  // `io.readdir` cannot distinguish "this directory was never created" from
  // "this directory could not be listed" (`io.ts`'s `readdir` maps every
  // `fs` error, ENOENT included, to `null` — a documented, deliberate limit,
  // see `io.test.ts`'s own pin and `coord-fingerprint.test.ts`'s identical
  // comment). Left absent, priming would hit `{listed:false}` and `tick()`
  // would correctly fail shut without ever setting `primed`, and every
  // `sweepMail()` call in this file would then no-op forever on its own
  // `if (!this.primed) return`. Created here rather than left to
  // `seedRegistry` (which runs AFTER priming in every test) — same fix,
  // same reasoning, as `fleetws.test.ts`'s "writes the very first snapshot"
  // test and `coord-fingerprint.test.ts`'s `fingerprintDeps`. On a REAL
  // fleet host `.cc-sessions` always exists once `ccd` has ever run.
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  let capIdx = 0;
  const panes = opts.panes ?? [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: opts.hasSession === false ? 1 : 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'send-keys') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

/** Primes the watcher against a registry with NOTHING in it yet — empty but
 *  LISTABLE (`harness()` creates `.cc-sessions` before this runs) — so
 *  `tick()`'s typed registry read sees `{listed: true, records: []}`, not
 *  `{listed: false}`. `tick()`'s own `detectDialogs` pass then loops zero
 *  times and issues zero `capture-pane` calls, so it can never misalign a
 *  later `sendPrompt`'s scripted panes. Seed the registry/hookstate/livestate
 *  fixtures AFTER calling this, not before. Returns `deps` too, so a test that needs the
 *  SAME `KeyedQueue` the sweep will use (to prove injection actually goes
 *  through it) can reach in. */
const primedWatcher = async (
  h: Harness, coord: CoordStore, over: Partial<Deps> = {},
): Promise<{ w: FleetWatcher; deps: Deps }> => {
  const deps: Deps = { ...testDeps(h.home, h.run), coord, ...over };
  const w = new FleetWatcher(deps, new Bus(), 2000);
  await w.tick();
  return { w, deps };
};

const literalSends = (calls: string[][]): string[] =>
  calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[4]!);
const keyPresses = (calls: string[][]): string[] =>
  calls.filter((a) => a[0] === 'send-keys' && a[3] !== '-l').map((a) => a[3]!);

const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('sweepMail: the gate', () => {
  it('delivers to a session that is alive, idle, quiet, dialog-free and off cooldown', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('does NOT deliver while $REG/mail-disabled exists — and skips the whole sweep, not one row', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id: id1 } = queueTestDelivery(coord, ID, ENVELOPE);
    const { id: id2 } = queueTestDelivery(coord, ID, 'a second queued message');
    writeFileSync(path.join(h.home, '.cc-sessions', 'mail-disabled'), '');

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, id1).state).toBe('queued');
    expect(deliveryRow(coord, id2).state).toBe('queued');
  });

  it('does NOT deliver when the kill-switch directory listing itself fails — an unreadable kill-switch fails SHUT (review finding 8)', async () => {
    // Mutation-tested (review finding 8): flipping the fail-shut read to
    // fail-open left this suite's PRE-fix state fully green, because nothing
    // in it ever made `io.readdir` return null. This is that missing case —
    // everything else about the fixture is the ordinary happy-path setup, so
    // a fail-open regression here sends the envelope exactly like the first
    // test in this file does. Only the KILL-SWITCH's own read fails — the
    // registry read that follows it inside the same sweep succeeds normally
    // — so a naive `io.readdir` stub that fails every call cannot be used
    // here: it would also empty the registry and block the send via `rec`
    // not being found, leaving the fail-shut line itself unexercised.
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { io, failNext } = onceUnlistableIO();
    const { w } = await primedWatcher(h, coord, { io });
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    failNext();
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does NOT deliver to a session tmux does not have', async () => {
    const h = harness({ hasSession: false, panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  // Hard case (b) / F6b closed (robust-mail-delivery spec §2.1): this used to
  // assert NO delivery — the OLD gate (`hs === null || hs.state !== 'done' ||
  // hs.ask !== null`) treated a stale-therefore-null hookstate as proof of
  // busy, forever. A resumed long-idle worker, or one whose `/clear` emitted
  // no registered hook, has no fresh hookstate but is plainly deliverable —
  // the live status file, read unconditionally four lines below in
  // `sweepMail`, can see it is idle. The gate is relaxed to
  // `hs !== null && hs.ask !== null`: a null/stale hookstate is now
  // NON-BLOCKING, and idle authority moves wholly to the live signal
  // (`readLiveState`/`liveSessionStatus` + `MAIL_QUIET_MS`, seeded idle+quiet
  // below exactly as every other happy-path test in this file already does).
  it('DELIVERS on a STALE/null hookstate when the LIVE signal affirmatively says idle+quiet — F6b closed', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID, { updatedAt: NOW - HOOKSTATE_FRESH_MS - 60_000 }); // readHookState -> null
    seedLiveState(h.home); // affirmatively idle, quiet past MAIL_QUIET_MS
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  // The second-order consequence of the same relaxation: `hs.state` is no
  // longer read by the gate AT ALL — only `hs.ask`. A FRESH hookstate that
  // says `working` (not `done`) used to `continue` unconditionally; it no
  // longer does, on its own. This models the realistic disagreement window —
  // the hook write raced the live file's own update — where the two signals
  // briefly disagree and the live file (the newer, more authoritative read)
  // wins.
  it('a FRESH hookstate reporting `working` no longer blocks delivery by itself — only `ask` does; live-idle+quiet is sole authority now', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID, { state: 'working' });
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('does NOT deliver while an ask or a dialog is pending — never into a menu', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    // `done` on purpose: this pins the `ask !== null` clause specifically,
    // not the `state !== 'done'` clause one line above it in the gate.
    seedHookState(h.home, ID, { ask: { approval: { tool: 'Bash', summary: 'ls -la' } } });
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does NOT deliver until the session has been quiet for MAIL_QUIET_MS', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home, { statusUpdatedAt: NOW - (MAIL_QUIET_MS - 5_000) });
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does NOT deliver twice inside MAIL_COOLDOWN_MS to the same session', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);

    const { id: id2 } = queueTestDelivery(coord, ID, 'a second message, still within cooldown');
    advance(PAST_SWEEP_MS); // clears the lane gate; well under MAIL_COOLDOWN_MS (120s)
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]); // no second send
    expect(deliveryRow(coord, id2).state).toBe('queued'); // untouched, still waiting
  });

  it('reads liveStatus AFFIRMATIVELY: an unreadable live file is not idle', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    // No live-state file at all: `readLiveState` -> null. A gate that defaults
    // a missing/unreadable answer to idle would deliver here; the real one
    // must not.
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does NOT deliver while the live status file affirmatively says busy — hookstate `done` is not enough on its own (review finding 7)', async () => {
    // Mutation-tested (review finding 7): deleting the `liveSessionStatus(...)
    // !== 'idle'` half of the conjunct (leaving only `!live`) left this
    // suite's PRE-fix state fully green — no fixture anywhere wrote a
    // non-idle `status` into the live file. This is that missing case: the
    // hook says `done` (conjunct 4 passes) but the live file, read fresh,
    // affirmatively disagrees — a fresh turn that started between the hook's
    // write and this sweep. sweepMail's own "WHAT THIS CANNOT SEE" paragraph
    // names typing into a mid-turn pane as the exact hazard this rung exists
    // to prevent.
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home, { status: 'busy' });
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does not fire on the priming tick — a restart delivers no storm', async () => {
    // The one test in this file that seeds the registry BEFORE priming, on
    // purpose: it has to prove the FIRST tick injects nothing even with an
    // eligible recipient and a due delivery already sitting there. Every
    // other test primes against an empty registry (see `primedWatcher`) so
    // that its own `detectDialogs` pass never touches the sendPrompt script
    // below — here it does, once, so the pane script gets one extra leading
    // entry to absorb it.
    const h = harness({ panes: [emptyBox, ...HAPPY_PANES] });
    const coord = store(h.home);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), coord }, new Bus(), 2000);

    await w.tick();
    expect(literalSends(h.calls)).toEqual([]);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
  });
});

// robust-mail-delivery spec §4 / requirements (a)-(d): the hard cases the
// design was written to pin explicitly, exercised end to end through
// `sweepMail` — gate, injection and (for (c)) the residue clear all in one
// pass, the same shape a real sweep runs.
describe('sweepMail: hard cases', () => {
  it('(a) a large multi-line body is delivered via the tiny nudge — the body itself is never typed, never wraps, never verify-fails', async () => {
    // A real ~3KB, 80-line rendered envelope — the exact F7 shape ("a
    // multi-line ~3KB brief verify-fails") the old typed-envelope lane could
    // not deliver reliably. Stored as `mail_deliveries.envelope` (served
    // later over `GET /api/mail/:id`) but never typed.
    const bigBody = Array.from({ length: 80 }, (_, i) => `line ${i}: ${'x'.repeat(60)}`).join('\n');
    const bigEnvelope = renderEnvelope({
      id: 4242, fromId: FROM_ID, toId: ID, runId: null, program: null, wave: null, waveOf: null,
      kind: 'finding', subject: 'a big finding', body: bigBody, artifacts: [],
    });
    expect(bigEnvelope.length).toBeGreaterThan(3000);
    expect(bigEnvelope.split('\n').length).toBeGreaterThan(20);

    // The ORDINARY 3-capture happy-path script, sized for a single-line
    // nudge — if the 80-line body were what actually got typed, this script
    // would starve (no M-Enter entries scripted, echo needle would never
    // match) and the send would fail verification.
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, bigEnvelope);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(literalSends(h.calls).some((s) => s.includes('line 0:'))).toBe(false);
    // No M-Enter anywhere: a multi-line body would need one per line break;
    // the nudge is one line, so `sendPrompt`'s join loop never fires.
    expect(keyPresses(h.calls)).not.toContain('M-Enter');
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  // (c): the wave-2 acceptance walkthrough (spec §4) — a session whose box
  // holds accumulated non-human paste-chip fragments from the OLD lane's
  // failed retries (modelled on the already-corrupted `ccrc-pwa-amber-harbor`
  // worker the orchestrator will re-run this proof against live), idle+quiet,
  // with a PRIOR attempt on this delivery already on record. No human clears
  // the box.
  it('(c) a DIRTY box (accumulated non-human residue) on an idle+quiet worker with a prior attempt is CLEARED then delivered', async () => {
    const dirtyBox = '❯ [Pasted text #1 +212 lines]\n';
    const h = harness({ panes: [dirtyBox, emptyBox, echoedBox(NUDGE), emptyBox] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    // `prior` (watch.ts) = attempts>0 || deliveredAt!==null — model the
    // corrupted worker's own history honestly instead of a first attempt.
    coord.db.prepare('UPDATE mail_deliveries SET attempts = 3 WHERE id = ?').run(id);

    await w.sweepMail();
    // The chip was cleared (C-u), THEN the nudge was typed and submitted —
    // never retyped over, never left stranded.
    expect(keyPresses(h.calls)).toContain('C-u');
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('(c, continued) the SAME dirty box on a NEVER-attempted delivery is left untouched — clearMailResidue needs a prior attempt on record', async () => {
    const dirtyBox = '❯ [Pasted text #1 +212 lines]\n';
    const h = harness({ panes: [dirtyBox] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE); // attempts: 0, deliveredAt: null

    await w.sweepMail();
    expect(keyPresses(h.calls)).toEqual([]); // no C-u at all — never even attempted a clear
    expect(literalSends(h.calls)).toEqual([]);
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.lastError).toBe('draft-present');
  });

  it('(d) a genuine human draft is STILL never cleared or typed over, even with a prior attempt on record — clearMailResidue does not widen what counts as human text', async () => {
    const humanBox = '❯ can you also check the staging deploy\n';
    const h = harness({ panes: [humanBox] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = 3 WHERE id = ?').run(id); // prior = true

    await w.sweepMail();
    expect(keyPresses(h.calls)).toEqual([]);
    expect(literalSends(h.calls)).toEqual([]);
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.lastError).toBe('draft-present');
  });
});

describe('sweepMail: the send', () => {
  it('injects through sendPrompt, inside the session KeyedQueue, with the NUDGE — never the stored envelope bytes', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w, deps } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    let release!: () => void;
    // Stands in for any other server-originated write on this session — the
    // real `KeyedQueue` `sendPrompt` itself joins, not a private one.
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const sweep = w.sweepMail();
    await new Promise((r) => setTimeout(r, 20)); // real timer — only Date is faked
    expect(literalSends(h.calls), 'the send must wait behind the held key').toEqual([]);

    release();
    await sweep;
    expect(literalSends(h.calls)).toEqual([NUDGE]); // the tiny nudge, not d.envelope
  });

  it('does not double-inject when a second sweep starts before the first sweep\'s send has resolved (review findings 1/5)', async () => {
    // REPRODUCES the pre-fix bug: sweep A passes the whole gate and blocks
    // inside sendPrompt's own KeyedQueue (held here by a stand-in for any
    // other server-originated write on this session). The row is still
    // `queued` — `markDelivered` hasn't run — and `mailCooldown` has no entry
    // yet, so a naive second sweep re-passes the identical gate and enqueues
    // a SECOND send for the same delivery. `mailInFlight` must refuse it.
    //
    // This pins ONLY the narrow window `mailInFlight` has always covered —
    // sweep A already blocked INSIDE `sendPrompt`, by which point the claim
    // has already landed under either the pre- or post-fix code. It is a
    // guarantee worth keeping on its own, but it cannot discriminate the
    // deeper race D-68 fixes — see the next test for the window this one
    // cannot reach, and why a real 20ms timer here happened to be "long
    // enough" on an idle box and too short under full-suite load.
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w, deps } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    let release!: () => void;
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const sweepA = w.sweepMail();
    await new Promise((r) => setTimeout(r, 20)); // real timer — let sweepA reach and block on the held key

    advance(PAST_SWEEP_MS); // clears the lane's own cadence gate for a second sweep
    expect(deliveryRow(coord, id).state).toBe('queued'); // sweep A has not written back yet
    const sweepB = w.sweepMail(); // must see the row still queued and mailCooldown unset

    release();
    await Promise.all([sweepA, sweepB]);
    expect(literalSends(h.calls)).toEqual([NUDGE]); // exactly ONE send, not two
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('does not double-inject when a second sweep\'s gate walk overlaps the first\'s, BEFORE either has claimed (D-68, orchestrator full-suite finding)', async () => {
    // The REAL race: pre-fix, `mailInFlight` was written only right before
    // `sendPrompt` — AFTER all four gate awaits (`hasSession`,
    // `hookStateFor`, `panePid`, `readLiveState`). Sweep A can pass the
    // `.has` check and yield inside ANY of those four; a sweep B that starts
    // in that window sees `mailInFlight` exactly as empty as sweep A saw it.
    // The test above can never exercise this: it blocks sweep A INSIDE
    // `sendPrompt`'s own KeyedQueue, by which point the claim has already
    // landed regardless of fix state. This one blocks sweep A on
    // `tmux.hasSession` instead — the FIRST of the four gate awaits — via a
    // promise released explicitly here, and every synchronization point
    // below is a call count or a settled promise, never a wall-clock
    // duration: that is precisely what made the old version of this file
    // pass 5/5 in isolation and fail under a loaded 86-file run.
    const home = mkTmp('ccrc-mail-sweep-');
    // Same empty-but-listable fix as `harness()` above — this test builds its
    // own `Harness` by hand rather than calling that factory, so it needs the
    // same `.cc-sessions` directory created before `primedWatcher` primes.
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const calls: string[][] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });
    let hasSessionCalls = 0;
    let capIdx = 0;
    // Enough scripted captures for TWO full happy-path sends — sendPrompt
    // itself serializes through the session's real KeyedQueue, so a
    // reproduced double-send plays out as two full, back-to-back
    // injections in strict order, never an interleaved one.
    const panes = [...HAPPY_PANES, ...HAPPY_PANES];
    const run: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === 'has-session') {
        hasSessionCalls++;
        await gate;   // every call parks here until releaseGate() below
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') {
        const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
        capIdx++;
        return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
      }
      if (args[0] === 'send-keys') return { code: 0, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const h: Harness = { home, calls, run };
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    const sweepA = w.sweepMail();
    // Sweep A is PROVEN parked inside the gate — not "probably, after a
    // real 20ms" — before this test does anything else.
    await vi.waitFor(() => expect(hasSessionCalls).toBeGreaterThanOrEqual(1));

    advance(PAST_SWEEP_MS); // clears the lane's own cadence gate for a second sweep
    expect(deliveryRow(coord, id).state).toBe('queued'); // sweep A has not written back yet

    let sweepBSettled = false;
    const sweepB = w.sweepMail();
    void sweepB.finally(() => { sweepBSettled = true; });
    // By now sweep B has EITHER been refused immediately (fixed code: sweep
    // A's claim already landed, synchronously, before sweep A ever reached
    // `hasSession`) and settled on its own — OR walked the identical gate
    // all the way to its own `hasSession` call and is now ALSO parked on
    // the same promise (pre-fix code). Either way, sweep B's own read of
    // `mailInFlight` has ALREADY happened by the time this resolves; no
    // amount of further waiting changes what it saw.
    await vi.waitFor(() => expect(hasSessionCalls >= 2 || sweepBSettled).toBe(true));

    releaseGate();
    await Promise.all([sweepA, sweepB]);
    expect(literalSends(h.calls), 'exactly ONE send, not two').toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('never passes replaceDraft — a human mid-sentence wins, every time', async () => {
    const h = harness({ panes: ['❯ mid-sentence draft\n'] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    // draft-present with NO key pressed at all is reachable only when
    // `replaceDraft` was never passed: sendPrompt's replace branch would have
    // fired at least one C-u instead of refusing outright.
    expect(keyPresses(h.calls)).toEqual([]);
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, id).lastError).toBe('draft-present');
  });

  it('F3 / bug #21: resumes its OWN unsubmitted nudge rather than self-blocking with draft-present', async () => {
    // REPRODUCES the dogfood self-block (build4.md's F3, live wave-1) under
    // the reference-nudge lane: a PRIOR sweep typed the nudge and its Enter
    // was lost, so the box now holds OUR OWN text, byte for byte — the shape
    // `echoedBox` fixtures throughout this file already model for a
    // freshly-typed nudge. Pre-fix, `sendPrompt` (never passed
    // `replaceDraft`) would read this as `draft-present` and back off —
    // FOREVER, since nothing ever empties the box again. Post-fix,
    // `resumeIfOwn` recognizes the marker row as our own text and finishes
    // the submit: no C-u, no retyping (`literalSends` stays empty — it is
    // never composed again), exactly one `Enter`.
    const h = harness({ panes: [echoedBox(NUDGE), emptyBox] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(keyPresses(h.calls)).toEqual(['Enter']);
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  it('F3: a genuine human draft is still never touched, even with resumeIfOwn now in play', async () => {
    // The sacred guard F2 already proved: `resumeIfOwn` only ever presses
    // Enter on a box that matches THIS delivery's OWN needle. Unrelated
    // human text — including text that, like this fixture, sits in the box
    // the moment the sweep looks — must fall straight through to the
    // ordinary `draft-present` refusal, with NO key pressed at all.
    const h = harness({ panes: ['❯ can you also check the staging deploy\n'] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(keyPresses(h.calls)).toEqual([]);
    expect(literalSends(h.calls)).toEqual([]);
    const row = deliveryRow(coord, id);
    expect(row.lastError).toBe('draft-present');
    expect(row.state).toBe('queued');
  });

  // SUPERSEDED by the reference-nudge lane, kept as a record of why the old
  // per-delivery discrimination test no longer applies HERE: pre-nudge, the
  // lane typed `renderEnvelope`'s own multi-line output, whose FIRST line is
  // the SAME constant fence ("```ccrc-mail") on every envelope, so a
  // marker-row-only match could not tell two DIFFERENT envelopes to the same
  // session apart — a draft left by envelope A's lost Enter could be
  // mis-submitted under envelope B's identity. `renderMailNudge` is a pure
  // function of `toId` ALONE (no delivery id anywhere in it, spec §1.1's
  // "ID-AGNOSTIC by design") — so within this lane there is no longer a
  // second envelope for a stray draft to be confused WITH: whatever nudge
  // sits in the box for this session, resuming it is always correct,
  // regardless of which due delivery this sweep is actually attempting. The
  // underlying `matchesOwnDraft` machinery this bug lived in is unchanged and
  // still pinned directly, for a generic multi-line caller, in
  // `send.test.ts`'s own "resumeIfOwn discriminates PER DELIVERY" suite.
  it('a stale OWN nudge is resumed regardless of WHICH queued delivery this sweep actually attempts — nothing left to mis-attribute', async () => {
    const h = harness({ panes: [echoedBox(NUDGE), emptyBox] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);

    // TWO separate deliveries queued for the same session — under the old
    // lane these had two different rendered bodies; under the nudge lane
    // both would produce the IDENTICAL typed text (`NUDGE`), so there is
    // nothing for a stray draft to be mistaken for besides "ours".
    queueTestDelivery(coord, ID, 'first queued delivery — unrelated stored envelope bytes');
    const { id: secondId } = queueTestDelivery(coord, ID, 'a second, later delivery');

    await w.sweepMail();
    // No C-u, no retype — only the resumed Enter.
    expect(keyPresses(h.calls)).toEqual(['Enter']);
    expect(literalSends(h.calls)).toEqual([]);
    // Only ONE row is attempted per session per sweep (`seen`) — the second
    // stays queued, untouched by this sweep either way.
    expect(deliveryRow(coord, secondId).state).toBe('queued');
  });

  it('backs off with exponential spacing on draft-present / dialog-open / verify-failed', async () => {
    const h = harness({ panes: ['❯ half-typed draft\n'] }); // draft-present every time it's read
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    let row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('draft-present');
    expect(row.nextAttemptAt).toBe(NOW + MAIL_BACKOFF_BASE_MS);

    advance(MAIL_BACKOFF_BASE_MS + 1_000); // clears the lane gate AND this row's own backoff
    await w.sweepMail();
    row = deliveryRow(coord, id);
    expect(row.attempts).toBe(2);
    expect(row.nextAttemptAt).toBe(NOW + MAIL_BACKOFF_BASE_MS + 1_000 + MAIL_BACKOFF_BASE_MS * 2);

    // dialog-open feeds the identical branch — same backoff mechanism, a
    // different trigger. A fresh fixture, so this isn't re-deriving the
    // exponential math a second time, just confirming the OTHER error kinds
    // land in the same place rather than, say, parking immediately.
    const menuPane = 'esc to interrupt\n\n❯ 1. Yes\n  2. No\n  Enter to select\n'; // send.test.ts's own fixture
    const h2 = harness({ panes: [menuPane] });
    const coord2 = store(h2.home);
    const { w: w2 } = await primedWatcher(h2, coord2);
    seedRegistry(h2.home, ID);
    seedHookState(h2.home, ID);
    seedLiveState(h2.home);
    const { id: id2 } = queueTestDelivery(coord2, ID, ENVELOPE);
    await w2.sweepMail();
    const row2 = deliveryRow(coord2, id2);
    expect(row2.state).toBe('queued');
    expect(row2.attempts).toBe(1);
    expect(row2.lastError).toBe('dialog-open');
  });

  it('parks as rejected(undeliverable) at MAIL_MAX_ATTEMPTS, mail row intact', async () => {
    const h = harness({ panes: ['❯ half-typed draft\n'] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id, mailId } = queueTestDelivery(coord, ID, ENVELOPE);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(MAIL_MAX_ATTEMPTS - 1, id);

    await w.sweepMail();
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('rejected');
    expect(row.rejectCode).toBe('undeliverable');
    // spec:170-172 — the record of what was said survives the failure to say
    // it: the mail row this delivery pointed at is untouched by the park.
    expect(coord.db.prepare('SELECT id FROM mail WHERE id = ?').get(mailId)).toBeTruthy();
  });

  it('parks IMMEDIATELY on enter-ignored — the text is in the box and a blind retry is forbidden', async () => {
    // Echoes on the first read, then NEVER clears — `submitted()` never sees
    // our text leave the box, on either Enter press.
    const h = harness({ panes: [emptyBox, echoedBox(NUDGE)] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id, mailId } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('rejected');
    expect(row.rejectCode).toBe('undeliverable');
    expect(row.lastError).toBe('enter-ignored');
    // Parked on the FIRST attempt — never routed through the ordinary
    // backoff counter at all, which `rejectDelivery` never touches.
    expect(row.attempts).toBe(0);
    expect(coord.db.prepare('SELECT id FROM mail WHERE id = ?').get(mailId)).toBeTruthy();
  }, 10_000);

  it('a DELIVERED row never parks as rejected on repeated replay failures — it backs off, unbounded, until acked (review findings 4/9)', async () => {
    // The pre-fix bug: `attempts` is one cumulative counter shared by
    // pre-delivery AND post-delivery (replay) failures, so a row that
    // delivered cleanly once and then failed six replays in a row (a human
    // draft sitting in the box every time) hit MAIL_MAX_ATTEMPTS and parked
    // `rejected('undeliverable')` — a false record: the message WAS said.
    // This also proves review finding 9's other half: once a delivered row
    // is no longer capped at MAIL_MAX_ATTEMPTS, `attempts` climbs high enough
    // for `Math.min(...)` to actually clamp at MAIL_BACKOFF_MAX_MS, which a
    // never-delivered row's own (attempts 1..5) schedule can never reach.
    const h = harness({ panes: [...HAPPY_PANES, '❯ half-typed draft\n'] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id, mailId } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(deliveryRow(coord, id).state).toBe('delivered');

    // Advance far enough each round to clear BOTH the replay window and any
    // backoff step, including the ceiling — draft-present never advances
    // `deliveredAt`, so this is the row's own replay clock, unmoved.
    const STEP = MAIL_BACKOFF_MAX_MS + 10_000;
    let t = Date.now();
    for (let i = 0; i < MAIL_MAX_ATTEMPTS + 3; i++) {
      t += STEP;
      vi.setSystemTime(t);
      seedHookState(h.home, ID, { updatedAt: t - 1_000 }); // stay fresh past HOOKSTATE_FRESH_MS
      await w.sweepMail();
    }

    const row = deliveryRow(coord, id);
    expect(row.state).toBe('delivered');                       // never rejected
    expect(row.rejectCode).toBeNull();
    expect(row.attempts).toBeGreaterThan(MAIL_MAX_ATTEMPTS);   // the pre-delivery budget did not stop it
    expect(row.nextAttemptAt - t).toBe(MAIL_BACKOFF_MAX_MS);   // the ceiling is genuinely reached
    expect(coord.db.prepare('SELECT id FROM mail WHERE id = ?').get(mailId)).toBeTruthy();
  });
});

describe('sweepMail: replay until ack', () => {
  // Hard case (e) — half of it: replay-until-ack keeps working, and every
  // replay types the SAME nudge (`renderMailNudge` is a pure function of
  // `toId` alone — never `d.envelope`, and never re-rendered from `mail.body`
  // either, unlike the old lane where `renderEnvelope` ran once at queue time
  // and the stored bytes had to be replayed verbatim).
  it('replays the SAME NUDGE after MAIL_REPLAY_MS — insensitive to the mail body, never a re-render of anything', async () => {
    const h = harness({ panes: [...HAPPY_PANES, ...HAPPY_PANES] }); // two full sends
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id, mailId } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');

    // What a re-render (of either the envelope OR the nudge) could have
    // picked up, had either been derived from `mail.body` — proves the
    // assertion below isn't vacuously true just because nothing changed.
    coord.db.prepare('UPDATE mail SET body = ? WHERE id = ?').run('a completely different body', mailId);

    advance(MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);
  });

  it('stops replaying the moment the delivery is acked', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    coord.markAcked(id, Date.now());

    advance(MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]); // no second send — an acked row is never due
  });

  it('records the UserPromptSubmit edge the moment it appears — long before the row would ever become due for replay (review finding 3)', async () => {
    // The pre-fix bug: `markIngested` was called ONLY from inside the loop
    // over `dueDeliveries()`, which does not select a `delivered` row until
    // MAIL_REPLAY_MS has already elapsed — so the edge could only ever be
    // observed 10 minutes after delivery, by which point the turn it was
    // meant to prove had long since ended. This seeds the edge seconds after
    // delivery — the realistic case — and proves it is sampled immediately,
    // not 595 seconds late.
    const h = harness({ panes: [...HAPPY_PANES, ...HAPPY_PANES] }); // two full sends: the initial + one replay
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(deliveryRow(coord, id).state).toBe('delivered');
    const { deliveredAt } = coord.db.prepare('SELECT deliveredAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { deliveredAt: number };

    // The recipient's turn starts a few seconds later — nowhere near
    // MAIL_REPLAY_MS away, so a row scoped to `dueDeliveries`'s own result
    // would never even be looked at here.
    advance(PAST_SWEEP_MS);
    const edgeAt = Date.now();
    seedHookState(h.home, ID, { state: 'working', event: 'UserPromptSubmit', updatedAt: edgeAt });

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);          // still no re-injection; not due
    const ingestedNow = () => (coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { ingestedAt: number | null }).ingestedAt;
    expect(ingestedNow()).toBe(edgeAt);                         // sampled immediately, not 600 s later

    // And the replay clock is dated from THAT edge, not from `deliveredAt`
    // (review findings 2/6 also cover this arithmetic at the store level):
    // at deliveredAt + MAIL_REPLAY_MS — which has already passed — the row
    // must NOT replay; only at edgeAt + MAIL_REPLAY_MS does it become due.
    seedHookState(h.home, ID); // the recipient goes idle again
    vi.setSystemTime(deliveredAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);          // deliveredAt+replay passed; edgeAt+replay has not

    vi.setSystemTime(edgeAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]); // now due, from the EDGE's clock
  });

  it('a REPLAY (a fresh markDelivered) advances the due-clock past a stale ingestedAt — the spacing does not collapse to cooldown (review findings 2/6)', async () => {
    // REPRODUCES the pre-fix bug: once ingestedAt has ever been written, a
    // COALESCE-based clock is pinned there forever and a later successful
    // REPLAY's own fresh deliveredAt is silently ignored — so every replay
    // after the first ingested edge was due again almost immediately,
    // spaced only by MAIL_COOLDOWN_MS (120 s) instead of MAIL_REPLAY_MS
    // (600 s).
    const h = harness({ panes: [...HAPPY_PANES, ...HAPPY_PANES, ...HAPPY_PANES] }); // three full sends
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();                                        // send #1 (initial delivery)
    expect(literalSends(h.calls)).toEqual([NUDGE]);

    // The UserPromptSubmit edge lands early, well inside the replay window.
    advance(PAST_SWEEP_MS);
    const edgeAt = Date.now();
    seedHookState(h.home, ID, { state: 'working', event: 'UserPromptSubmit', updatedAt: edgeAt });
    await w.sweepMail();
    expect((coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { ingestedAt: number | null }).ingestedAt).toBe(edgeAt);

    // The row goes idle again and the FIRST replay fires, off the edge's own
    // clock — a fresh, later `deliveredAt`, with `ingestedAt` untouched.
    seedHookState(h.home, ID);
    vi.setSystemTime(edgeAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();                                        // send #2 (the replay)
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);

    // Just past MAIL_COOLDOWN_MS since that replay — under the pre-fix
    // COALESCE clock (still pinned at `edgeAt`) this would already be due
    // again; under the fix it must not be, all the way out past cooldown.
    advance(MAIL_COOLDOWN_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]); // still no third send

    // Only once MAIL_REPLAY_MS has elapsed from the REPLAY's own deliveredAt
    // does the row become due a third time.
    const { deliveredAt: secondDeliveredAt } = coord.db.prepare(
      'SELECT deliveredAt FROM mail_deliveries WHERE id = ?').get(id) as { deliveredAt: number };
    vi.setSystemTime(secondDeliveredAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE, NUDGE]); // send #3
  });

  it('a SECOND, later UserPromptSubmit edge does not push the replay clock out again (review finding 31)', async () => {
    // The pre-fix bug: `markIngested` fired on EVERY `UserPromptSubmit` edge
    // newer than the last stamp, so a session that keeps submitting prompts
    // — the ordinary shape of a session doing WORK — kept re-dating the
    // replay clock and the delivery was never re-injected for as long as
    // that continued.
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(deliveryRow(coord, id).state).toBe('delivered');

    advance(PAST_SWEEP_MS);
    const edge1At = Date.now();
    seedHookState(h.home, ID, { state: 'working', event: 'UserPromptSubmit', updatedAt: edge1At });
    await w.sweepMail();
    expect((coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { ingestedAt: number | null }).ingestedAt).toBe(edge1At);

    // A SECOND edge, well inside the replay window opened by the first —
    // under the pre-fix behaviour this would push ingestedAt out to edge2At.
    advance(60_000);
    const edge2At = Date.now();
    seedHookState(h.home, ID, { state: 'working', event: 'UserPromptSubmit', updatedAt: edge2At });
    await w.sweepMail();
    expect((coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { ingestedAt: number | null }).ingestedAt).toBe(edge1At);   // frozen at the FIRST edge

    // Due from edge1At + MAIL_REPLAY_MS — which, under the pre-fix bug,
    // would NOT yet be due (the clock would have been pushed to edge2At).
    seedHookState(h.home, ID);   // idle again
    vi.setSystemTime(edge1At + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);   // the replay fired
  });
});

describe('sweepMail: a dead recipient eventually parks (review finding 30)', () => {
  it('a delivery whose recipient has no registry row backs off, then parks rejected(undeliverable)', async () => {
    const h = harness();   // no seedRegistry at all for ID — the recipient is simply gone
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    // The registry DIRECTORY exists (an ordinary fleet host always has one
    // once ccd has run) even though this ONE id's row does not — an
    // unlistable directory is the SEPARATE kill-switch fail-shut case, not
    // this one.
    mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    let row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('recipient not in registry');

    // Advance past each backoff step and re-sweep until the ceiling parks it.
    for (let i = 1; i < MAIL_MAX_ATTEMPTS; i++) {
      row = deliveryRow(coord, id);
      vi.setSystemTime(row.nextAttemptAt + 1_000);
      await w.sweepMail();
    }

    row = deliveryRow(coord, id);
    expect(row.state).toBe('rejected');
    expect(row.rejectCode).toBe('undeliverable');
    // `rejectDelivery` never touches `attempts` (same convention the
    // existing enter-ignored/MAIL_MAX_ATTEMPTS tests above already pin) —
    // the column stops at the last `backOff` call, one short of the ceiling
    // that triggered the park.
    expect(row.attempts).toBe(MAIL_MAX_ATTEMPTS - 1);
    // The mail ROW itself survives — spec:170-172's "the record of what was
    // said survives the failure to say it."
    const { mailId } = queueTestDelivery(coord, ID, ENVELOPE);   // sanity: table still writable
    expect(mailId).toEqual(expect.any(Number));
  });

  it('a recipient LISTED but with one unreadable registry field keeps backing off, never parks, and NEVER ' +
     'ratchets attempts (registry ladder: the row is now DEGRADED, not dropped, and `countsAsAttempt: false`' +
     ' keeps this branch off the park-eligible counter entirely)', async () => {
    // registry.ts's identity ladder DEGRADES (never drops) a row whose
    // `.uuid` file IS listed when a sibling identity field merely fails to
    // read — transient, the identical shape `POST /api/mail`'s own ingress
    // refuses as `registry-unmeasurable` rather than guessing (D-37,
    // mail-routes.test.ts:259). Before the ladder, sweepMail's reaped-
    // recipient park (the test right above this one) could not tell that
    // apart from a GENUINELY absent recipient, so this exact fixture would
    // park a LIVE session's mail `rejected('undeliverable')` after
    // MAIL_MAX_ATTEMPTS backoffs — about 15 minutes of one dropped agent-WS
    // round trip on a single field.
    const h = harness();
    const io = withUnreadableField(ID, 'wrapper');
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord, { io });
    seedRegistry(h.home, ID);   // .uuid IS listed; `wrapper` never reads back
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    let row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    // NEVER ratcheted: `store.backOff`'s `countsAsAttempt: false` on this
    // branch — attempts is SEND-FAILURE budget, and this row was never
    // attempted at all, only found unmeasurable before any send-eligibility
    // gate could even run. The mutant this kills: dropping the fourth
    // argument (or defaulting it to `true`) would make this `1`, exactly
    // the old (pre-ladder) behaviour this test used to pin.
    expect(row.attempts).toBe(0);
    // Echoes `registry-unmeasurable` — the ingress route's own typed code
    // for the identical condition — in the free-text `lastError` itself
    // (scoped-verify H6), so a maintainer grepping the ROW for that word
    // finds this half of the rule too, not just the source comment.
    expect(row.lastError).toBe('registry row listed but unreadable (registry-unmeasurable)');

    // Drive it well past the point that WOULD park a genuinely absent
    // recipient (MAIL_MAX_ATTEMPTS backoffs, the test above this one) — it
    // must still be backing off, never rejected, and attempts must STILL
    // read 0 — the ladder promises "forever", not merely "longer".
    for (let i = 1; i < MAIL_MAX_ATTEMPTS + 4; i++) {
      row = deliveryRow(coord, id);
      vi.setSystemTime(row.nextAttemptAt + 1_000);
      await w.sweepMail();
    }
    row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.rejectCode).toBeNull();
    expect(row.attempts).toBe(0);
  });

  it('does NOT terminally park a listed, live recipient\'s mail when only the SECOND of sweepMail\'s ' +
     'own two directory reads drops — the kill-switch listing succeeds, readRegistryMeasured\'s own ' +
     'internal readdir fails, and that whole-fleet collapse must fail SHUT exactly like the kill-' +
     'switch\'s own read already does, never be read as "recipient not in registry" (blocking review ' +
     'findings 1/5)', async () => {
    // MEASURED (blocking review finding 5): before this fix, `sweepMail`
    // sourced `records` from `readRegistry`'s OLD signature ([] on an
    // unlistable directory) — the SAME shape "this recipient is not in the
    // registry" wears below (`rec === undefined`) — so a single dropped
    // agent-WS round trip on ONLY this second read (the kill-switch's own,
    // three lines above inside `sweepMail`, succeeded) made every due row
    // read `unmeasurable = false`, ratchet `attempts`, and terminally
    // `rejectDelivery(..., 'undeliverable', 'recipient not in registry')` on
    // the sixth sweep — for a recipient this fixture keeps fully listed and
    // readable throughout. `alternatingUnlistableIO` reproduces exactly that:
    // armed AFTER priming/seeding, it passes the kill-switch's own read
    // (odd call) and fails readRegistryMeasured's own internal one (even
    // call), every sweep, without ever tripping the kill-switch.
    const h = harness();
    const coord = store(h.home);
    const { io, arm } = alternatingUnlistableIO();
    const { w } = await primedWatcher(h, coord, { io });
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    arm();
    for (let i = 0; i < MAIL_MAX_ATTEMPTS; i++) {
      // Clears both the MAIL_SWEEP_MS lane throttle and (were the bug still
      // present) every backoff step up to MAIL_BACKOFF_MAX_MS between sweeps.
      advance(MAIL_BACKOFF_MAX_MS + 1_000);
      await w.sweepMail();
    }

    expect(literalSends(h.calls),
      'never reaches the send it would need to for the row to move any other way').toEqual([]);
    const row = deliveryRow(coord, id);
    expect(row.state, 'a whole-fleet read failure must never be read as "recipient not in registry"')
      .toBe('queued');
    expect(row.rejectCode).toBeNull();
    // A row this method could never even LIST must never accrue toward the
    // park ceiling either — the identical rule the per-field-degraded branch
    // above already keeps, extended to the whole-fleet collapse.
    expect(row.attempts, 'a whole-fleet read failure must never ratchet attempts').toBe(0);
  });

  it('an ORDINARY gate (busy, on cooldown, no tmux session) never accrues an attempt', async () => {
    // Only the registry-absent gate backs off; every other gate must stay
    // free to hold indefinitely without ever parking a legitimately busy
    // session's mail.
    const h = harness({ hasSession: false });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    for (let i = 0; i < MAIL_MAX_ATTEMPTS + 2; i++) {
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
    }
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(0);
  });
});

describe('sweepMail: successful replays eventually park too (review finding 20)', () => {
  it('parks rejected(undeliverable) after MAIL_REPLAY_MAX_ATTEMPTS unacked replays', async () => {
    const MAIL_REPLAY_MAX_ATTEMPTS = 20;
    // 21 real sends, each polling `sendPrompt`'s own (unfaked) setTimeout
    // loops — comfortably past the default 5 s test timeout.
    // One full HAPPY_PANES script per send: the initial delivery plus every
    // successful replay up to and past the ceiling.
    const panes = Array.from({ length: MAIL_REPLAY_MAX_ATTEMPTS + 2 }, () => HAPPY_PANES).flat();
    const h = harness({ panes });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();   // the initial delivery — never counts against the replay ceiling
    expect(deliveryRow(coord, id).state).toBe('delivered');

    for (let i = 0; i < MAIL_REPLAY_MAX_ATTEMPTS; i++) {
      const { deliveredAt } = coord.db.prepare('SELECT deliveredAt FROM mail_deliveries WHERE id = ?')
        .get(id) as { deliveredAt: number };
      const t = deliveredAt + MAIL_REPLAY_MS + 1_000;
      vi.setSystemTime(t);
      seedHookState(h.home, ID, { updatedAt: t - 1_000 });   // stay fresh past HOOKSTATE_FRESH_MS
      seedLiveState(h.home, { statusUpdatedAt: t - MAIL_QUIET_MS - 1_000 });   // stay affirmatively idle+quiet
      await w.sweepMail();
    }

    const row = coord.db.prepare('SELECT state, rejectCode, replayCount FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string; rejectCode: string | null; replayCount: number };
    expect(row.state).toBe('rejected');
    expect(row.rejectCode).toBe('undeliverable');
    expect(row.replayCount).toBe(MAIL_REPLAY_MAX_ATTEMPTS);
  }, 30_000);

  it('an acked delivery never accrues a replay count at all', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    coord.markAcked(id, Date.now());
    advance(MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    const row = coord.db.prepare('SELECT state, replayCount FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string; replayCount: number };
    expect(row.state).toBe('acked');
    expect(row.replayCount).toBe(0);
  });
});

// TASK 407 — the wedge `dispatch.ts` documents creating, end to end through
// the lane that has to live with it. A resumed worker's `/clear` came back
// `enter-ignored`, so the literal sits in its box; every sweep after that
// refuses `draft-present`, and the wave brief parks `undeliverable` with
// nothing anywhere saying why.
//
// The fix is PROVENANCE-GATED, and these two tests are the same box with two
// different answers: the delivery lane clears a `/clear` the ledger proves
// this system typed, and refuses a byte-identical one it cannot.
describe('sweepMail: the /clear a dispatch stranded', () => {
  const CLEAR_BOX = '❯ /clear\n';
  /** The pane script for a box holding `/clear`: the guard's read, then the
   *  post-C-u read, then the echo, then the box after Enter. */
  const STRANDED_PANES = [CLEAR_BOX, emptyBox, echoedBox(NUDGE), emptyBox];

  /** A run dispatched onto `ID` whose post-resume `/clear` was refused with
   *  `code` — the durable record `CoordStore.strandedClear` reads. */
  const dispatchRefusedClear = (coord: CoordStore, code: string): void => {
    const opened = coord.openRun({ program: 'build8', title: 'T', project: 'demo',
      wave: 2, waveOf: 3, claimedBy: 'demo-boss' });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    coord.dispatchRun({ runId: opened.id, sessionId: ID, workspace: '/w/demo', branch: 'ws/demo',
      resumed: true, clearedAt: null, items: [], detail: `clear-refused:${code}` });
  };

  it('clears the /clear and delivers, when the ledger proves the Enter was ignored', async () => {
    const h = harness({ panes: STRANDED_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    dispatchRefusedClear(coord, 'enter-ignored');
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(keyPresses(h.calls)).toContain('C-u');
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');
  });

  // THE SAME BOX, NO RECORD. `/clear` is four characters an operator types
  // too, and nothing about the text tells them apart — so the default is the
  // refusal, not the clear.
  it('refuses a byte-identical /clear with no such record — not one keystroke', async () => {
    const h = harness({ panes: STRANDED_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(keyPresses(h.calls)).not.toContain('C-u');
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, id).state).toBe('queued');
    expect(deliveryRow(coord, id).lastError).toBe('draft-present');
  });

  it('refuses when the recorded refusal is a code that proves nothing about the box', async () => {
    const h = harness({ panes: STRANDED_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    dispatchRefusedClear(coord, 'verify-failed');
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, id).lastError).toBe('draft-present');
  });
});
