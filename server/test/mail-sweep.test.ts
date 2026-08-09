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
const primedWatcher = async (h: Harness, coord: CoordStore): Promise<{ w: FleetWatcher; deps: Deps }> => {
  const deps: Deps = { ...testDeps(h.home, h.run), coord };
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

  it('records the UserPromptSubmit edge and dates the replay clock from it', async () => {
    const h = harness({ panes: HAPPY_PANES });
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

    // The recipient's turn started (`working`, not `done`) — the state gate
    // below refuses to re-inject, but the edge is still proof the mail was
    // seen, and re-dates the replay clock so a still-thinking session isn't
    // treated as one that ignored it.
    advance(MAIL_REPLAY_MS + 1_000);
    const edgeAt = deliveredAt + 5_000;
    seedHookState(h.home, ID, { state: 'working', event: 'UserPromptSubmit', updatedAt: edgeAt });

    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([ENVELOPE]); // no re-injection while working
    const { ingestedAt } = coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { ingestedAt: number | null };
    expect(ingestedAt).toBe(edgeAt);
  });
});
