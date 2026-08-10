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

const ENVELOPE = 'ccrc-mail test payload'; // 23 chars — under ECHO_NEEDLE(24), one line

const emptyBox = '❯ \n';
const echoedBox = (text: string): string => `❯ ${text}\n`;
/** The exact three-capture script a clean `sendPrompt` success consumes:
 *  empty-draft check, echo verification, empty-after-Enter. Lifted from
 *  send.test.ts's own "happy path" fixture. */
const HAPPY_PANES = [emptyBox, echoedBox(ENVELOPE), emptyBox];

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

/** Primes the watcher against a registry with NOTHING in it yet — `tick()`'s
 *  own `detectDialogs` pass then loops zero times and issues zero
 *  `capture-pane` calls, so it can never misalign a later `sendPrompt`'s
 *  scripted panes. Seed the registry/hookstate/livestate fixtures AFTER
 *  calling this, not before. Returns `deps` too, so a test that needs the
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);
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

  it('does NOT deliver on a STALE hookstate — an absent answer is not an idle one', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID, { updatedAt: NOW - HOOKSTATE_FRESH_MS - 60_000 });
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
  });

  it('does NOT deliver while the hook says working', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID, { state: 'working' });
    seedLiveState(h.home);
    queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);

    const { id: id2 } = queueTestDelivery(coord, ID, 'a second message, still within cooldown');
    advance(PAST_SWEEP_MS); // clears the lane gate; well under MAIL_COOLDOWN_MS (120s)
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE]); // no second send
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);
  });
});

describe('sweepMail: the send', () => {
  it('injects through sendPrompt, inside the session KeyedQueue, with the STORED envelope', async () => {
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]); // the exact stored bytes, unaltered
  });

  it('does not double-inject when a second sweep starts before the first sweep\'s send has resolved (review findings 1/5)', async () => {
    // REPRODUCES the pre-fix bug: sweep A passes the whole gate and blocks
    // inside sendPrompt's own KeyedQueue (held here by a stand-in for any
    // other server-originated write on this session). The row is still
    // `queued` — `markDelivered` hasn't run — and `mailCooldown` has no entry
    // yet, so a naive second sweep re-passes the identical gate and enqueues
    // a SECOND send for the same delivery. `mailInFlight` must refuse it.
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]); // exactly ONE send, not two
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
    const h = harness({ panes: [emptyBox, echoedBox(ENVELOPE)] });
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
  it('replays the SAME BYTES after MAIL_REPLAY_MS, never a re-render', async () => {
    const h = harness({ panes: [...HAPPY_PANES, ...HAPPY_PANES] }); // two full sends
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home);
    const { id, mailId } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);
    expect(deliveryRow(coord, id).state).toBe('delivered');

    // What a RE-RENDER would have picked up, had the sweep called
    // `renderEnvelope` again instead of replaying the stored bytes — proves
    // the assertion below isn't vacuously true just because nothing changed.
    coord.db.prepare('UPDATE mail SET body = ? WHERE id = ?').run('a completely different body', mailId);

    advance(MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE]);
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);
    coord.markAcked(id, Date.now());

    advance(MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE]); // no second send — an acked row is never due
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);          // still no re-injection; not due
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);          // deliveredAt+replay passed; edgeAt+replay has not

    vi.setSystemTime(edgeAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE]); // now due, from the EDGE's clock
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE]);

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
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE]);

    // Just past MAIL_COOLDOWN_MS since that replay — under the pre-fix
    // COALESCE clock (still pinned at `edgeAt`) this would already be due
    // again; under the fix it must not be, all the way out past cooldown.
    advance(MAIL_COOLDOWN_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE]); // still no third send

    // Only once MAIL_REPLAY_MS has elapsed from the REPLAY's own deliveredAt
    // does the row become due a third time.
    const { deliveredAt: secondDeliveredAt } = coord.db.prepare(
      'SELECT deliveredAt FROM mail_deliveries WHERE id = ?').get(id) as { deliveredAt: number };
    vi.setSystemTime(secondDeliveredAt + MAIL_REPLAY_MS + 1_000);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE, ENVELOPE]); // send #3
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
    expect(literalSends(h.calls)).toEqual([ENVELOPE, ENVELOPE]);   // the replay fired
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

  it('a recipient LISTED but with one unreadable registry field keeps backing off, never parks ' +
     '(fix, scoped-verify R2 — a regression the fix wave above itself introduced)', async () => {
    // registry.ts:123 drops a row whose `.uuid` file IS listed when a
    // sibling field read merely fails — transient, the identical shape
    // `POST /api/mail`'s own ingress refuses as `registry-unmeasurable`
    // rather than guessing (D-37, mail-routes.test.ts:259). Before this fix,
    // sweepMail's reaped-recipient park (the test right above this one)
    // could not tell that apart from a GENUINELY absent recipient, so this
    // exact fixture would park a LIVE session's mail `rejected('undeliverable')`
    // after MAIL_MAX_ATTEMPTS backoffs — about 15 minutes of one dropped
    // agent-WS round trip on a single field.
    const h = harness();
    const io = withUnreadableField(ID, 'wrapper');
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord, { io });
    seedRegistry(h.home, ID);   // .uuid IS listed; `wrapper` never reads back
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);

    await w.sweepMail();
    let row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(1);
    // Echoes `registry-unmeasurable` — the ingress route's own typed code
    // for the identical condition — in the free-text `lastError` itself
    // (scoped-verify H6), so a maintainer grepping the ROW for that word
    // finds this half of the rule too, not just the source comment.
    expect(row.lastError).toBe('registry row listed but unreadable (registry-unmeasurable)');

    // Drive it well past the point that WOULD park a genuinely absent
    // recipient (MAIL_MAX_ATTEMPTS backoffs, the test above this one) — it
    // must still be backing off, never rejected.
    for (let i = 1; i < MAIL_MAX_ATTEMPTS + 4; i++) {
      row = deliveryRow(coord, id);
      vi.setSystemTime(row.nextAttemptAt + 1_000);
      await w.sweepMail();
    }
    row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.rejectCode).toBeNull();
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
