import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { NotifyLog } from '../src/notifylog.js';
import { Presence } from '../src/presence.js';
import { askKey } from '../src/askkey.js';
import type { PushPayload } from '../src/push.js';
import { FLEET_SCOPE, PRESENCE_REFRESH_MS, PRESENCE_TTL_MS, type NodeRole, type UpdateChannel } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow, type UpdateIntentPatch } from '../src/coord/store.js';
import { okRuns } from './coordReadHelpers.js';
import type { CcrcConfig } from '../src/config.js';
import type { CataloguePoller } from '../src/update/catalogue.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { FleetState } from '../src/fleetstate.js';

/** Item 3, fix round 1 (F3/F4): a remote-mode fleetState double — a minimal `FleetState`, same shape as
 *  `update-inventory.test.ts`'s own local factory (that file's is not exported; L0/L1 boundaries keep this
 *  file from importing across test files). */
const fleetState = (over: Partial<FleetState> = {}): FleetState =>
  ({ connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, ...over });

const dir = async () => mkdtemp(path.join(tmpdir(), 'push-copy-'));

/** Per-session bookkeeping `markIdle` and the tmux runner both need: the pid
 *  the live-status file is keyed by, and the wrapper config dir it lives
 *  under. */
interface Seeded { pid: number; cfgDir: string }

const liveStatusFile = (s: Seeded): string => path.join(s.cfgDir, 'sessions', `${s.pid}.json`);

const writeLiveStatus = (s: Seeded, id: string, status: 'busy' | 'idle'): void => {
  writeFileSync(liveStatusFile(s), JSON.stringify({
    pid: s.pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now(),
  }));
};

/** Seeds one registry entry + one live-status file (starting `busy`) per
 *  `"<project>/<id>"` spec, all under the `claude` wrapper so every session
 *  shares one cfgDir. */
function seedSessions(home: string, specs: string[]): Map<string, Seeded> {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const info = new Map<string, Seeded>();
  let pid = 41000;
  for (const spec of specs) {
    const [project, id] = spec.split('/');
    pid += 1;
    const fields: Record<string, string> = {
      wrapper: 'claude', project: project!, workdir: `/w/${id!}`, uuid: `u-${id!}`, started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id!}.${f}`), v);
    const seeded: Seeded = { pid, cfgDir };
    info.set(id!, seeded);
    writeLiveStatus(seeded, id!, 'busy');
  }
  return info;
}

/** `has-session` always alive, `list-panes` answers with the right session's
 *  pid (parsed off the `cc-<id>` target tmux itself builds), `capture-pane`
 *  a plain prompt — never a menu, so dialog detection stays inert and only
 *  the busy→idle edge under test can fire a push. */
function runnerFor(info: Map<string, Seeded>, pane = 'ready\n❯ \n'): Runner {
  return async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') {
      const target = args[2] ?? '';
      const id = target.startsWith('cc-') ? target.slice('cc-'.length) : '';
      const pid = info.get(id)?.pid;
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** A pane `paneState` reads as a live menu, so `detectDialogs` raises an ask
 *  push. The default above is a bare prompt precisely so the busy→idle tests
 *  can't have an ask fire underneath them. */
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';

/** The real spinner row from `fixtures/panes/busy.txt`, inlined to match this
 *  file's existing style (panes here are literals, not file reads). Used by
 *  the Stage 2e Task 3 (D-102) case below: an RC-off pane renders this WHILE
 *  a dialog is up, on the same screen. */
const BUSY_LINE = '✳ Cerebrating… (12s · ↑ 1.2k tokens · esc to interrupt)';

/**
 * Write one `<id>.hookstate.json` the way `session-hook.sh` does, with the
 * `sessionId` `seedSessions` gave the registry entry — `readHookState`'s
 * identity gate compares the two, so a mismatch here reads as "a different
 * session wrote this" and the envelope is correctly ignored.
 */
function writeHookState(home: string, id: string, ask: unknown, state = 'waiting'): void {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state, sessionId: `u-${id}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
}

const oneQuestion = (options: { label: string }[]) => ({
  questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options }],
});

/**
 * A `FleetWatcher` over a throwaway fixture home carrying one session per
 * `"<project>/<id>"` spec, all starting `busy` — so the first (priming)
 * `tick()` records `prevStatus: busy` for every one of them and `markIdle`
 * can then drive a genuine busy→idle edge on the next `tick()`.
 */
function watcher(opts: {
  /** Plan W3 Task 3: optional — omitted, the watcher has NO push service,
   *  as a box with no VAPID keys runs (`index.ts` builds `push` only then). */
  push?: { notify: (p: PushPayload) => Promise<void> };
  presence?: Presence;
  notifyLog?: NotifyLog;
  /** Task 10: when true, a real `CoordStore` (over this fixture home's own
   *  `.ccrc/coord.db`) is wired in and returned — the mail/run notify lanes
   *  and the durable feed archive both need one to have anything to read. */
  coord?: boolean;
  sessions: string[];
  pane?: string;
  /** Blocking review finding 2: lets a test degrade a registry field
   *  mid-fixture (a row LISTED but unreadable), the same shape every other
   *  registry-ladder test in this tree uses. */
  io?: FleetIO;
  /** Plan W3 Task 3: fields laid over `testDeps`' config — `{ role: 'fleet' }`
   *  is a fleet-role process, which owns no push subscriptions. */
  cfg?: Partial<CcrcConfig>;
  /** Plan W3 Task 3: the catalogue lane's poller (W2 Task 10's `Deps.catalogue`). */
  catalogue?: CataloguePoller;
  /** Plan W3 Task 3: an EXISTING fixture home. A second watcher over the same
   *  home opens a second connection to the same `coord.db` — a restart. */
  home?: string;
  /** Item 3, fix round 1 (F3/F4): a remote-mode `fleetState` double, so a test can drive the agent link
   *  down (or later flip it up) and exercise `inventorySwept`'s gate for real, through `inventoryNow()`. */
  fleetState?: FleetState;
}): { tick: () => Promise<void>; markIdle: (id: string) => void; markBusy: (id: string) => void; home: string; coord?: CoordStore; w: FleetWatcher } {
  const home = opts.home ?? mkTmp('ccrc-');
  const info = seedSessions(home, opts.sessions);
  const coord = opts.coord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
  const base = testDeps(home, runnerFor(info, opts.pane));
  const deps = {
    ...base,
    ...(opts.cfg ? { cfg: { ...base.cfg, ...opts.cfg } } : {}),
    ...(opts.push ? { push: opts.push as never } : {}),
    presence: opts.presence,
    notifyLog: opts.notifyLog,
    coord,
    ...(opts.io ? { io: opts.io } : {}),
    ...(opts.catalogue ? { catalogue: opts.catalogue } : {}),
    ...(opts.fleetState ? { fleetState: opts.fleetState } : {}),
  };
  // The state cache stays inside the fixture home: without the fourth
  // argument the constructor falls back to `defaultCachePath()`, the LIVE
  // ~/.ccrc — never read by a local-mode tick, but a fixture has no business
  // naming it.
  const w = new FleetWatcher(deps, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  return {
    home,
    coord,
    w,
    tick: () => w.tick(),
    markIdle: (id: string) => {
      const s = info.get(id);
      if (!s) throw new Error(`push-copy.test.ts: no seeded session "${id}"`);
      writeLiveStatus(s, id, 'idle');
    },
    // The mirror of `markIdle`, for a test that needs to drive a session back
    // to work and then finish it again — a REAL busy→idle edge, after some
    // earlier tick has already been asked not to invent one.
    markBusy: (id: string) => {
      const s = info.get(id);
      if (!s) throw new Error(`push-copy.test.ts: no seeded session "${id}"`);
      writeLiveStatus(s, id, 'busy');
    },
  };
}

describe('push copy discipline — project context, presence suppression, log fidelity', () => {
  it('omits the project from the title when only one project is active', async () => {
    // Two sessions, ONE project, both transitioning busy→idle.
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a', 'ccrc-pwa/cc-b'] });
    await w.tick();                    // priming tick — notifies nothing
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished');       // no ' · ccrc-pwa'
  });

  it('names the project when more than one is active', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a', 'rp-llm/cc-b'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished · ccrc-pwa');
  });

  it('fires nothing for a session a client reports visible', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toEqual([]);
  });

  it('fires again once every client has disconnected', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    presence.drop(token);
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
  });

  // PR F whole-branch review, Important 6. A claim was released only by the
  // socket's 'close' handler, and a phone that loses signal in a lift sends no
  // FIN — 'close' never fires, the claim never lapses, and `pushOne` returns
  // BEFORE `notifyLog.record`, so every notification for that session is
  // suppressed for every device AND kept out of the catch-up ring, until the
  // OS eventually gives up retransmitting a write that a quiet stream never
  // makes. The claim expires instead, and expiry means notify.
  it('stops believing a claim nobody has re-stated', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let now = 1_000_000;
    const presence = new Presence(() => now, PRESENCE_TTL_MS);
    presence.setVisible(Symbol('t'), 'cc-a');        // the phone said so, then vanished
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    now += PRESENCE_TTL_MS + 1;                      // no heartbeat ever arrived
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
  });

  it('keeps believing a claim the client keeps re-stating', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let now = 1_000_000;
    const presence = new Presence(() => now, PRESENCE_TTL_MS);
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    // Heartbeats at the client's own cadence carry the claim past the TTL.
    for (let i = 0; i < 4; i++) { now += PRESENCE_REFRESH_MS; presence.setVisible(token, 'cc-a'); }
    expect(now).toBeGreaterThan(1_000_000 + PRESENCE_TTL_MS);
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toEqual([]);
  });

  it('records into the log only what was actually sent', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const log = new NotifyLog(path.join(await dir(), 'n.json'));
    await log.load();
    const w = watcher({ push, presence, notifyLog: log, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    // Suppressed by presence, so the catch-up must not claim it happened.
    expect(sent).toEqual([]);
    expect(log.seq).toBe(0);
  });
});

/** An `io` whose `readFile` passes straight through until `degrade(id, field)`
 *  is called, after which reads of that one `<id>.<field>` file return null
 *  while the file stays LISTED — the "listed but unreadable" shape every
 *  registry-ladder fixture in this tree uses. `heal()` restores normal
 *  reads, so a test can drive a degrade→heal round trip within one fixture. */
function toggleableIO(): { io: FleetIO; degrade: (id: string, field: string) => void; heal: () => void } {
  let bad: { id: string; field: string } | null = null;
  const io = degradedReadIO((p) => bad !== null && p.endsWith(`${bad.id}.${bad.field}`));
  return { io, degrade: (id, field) => { bad = { id, field }; }, heal: () => { bad = null; } };
}

// Blocking review finding 2: a row the registry ladder DEGRADES rather than
// drops now reaches `assembleFleet` for the first time ever — and
// `assembleFleet` has no way to tell a degraded row from a measured one on
// the wire (`FleetSession` carries no `unmeasured` field). Before the fix,
// `tick()`'s busy→idle push loop read straight off `s.status`, which
// `assembleFleet` freezes at its `alive` default of 'idle' for a
// wrapper-degraded row (`configDirFor(cfg, '') === undefined` skips
// `readLiveState` entirely) — so a session that was genuinely still mid-turn
// fired a false "✓ Finished" push AND a recorded feed event asserting a turn
// completed. Written FIRST and confirmed red against the pre-gate code.
describe('a degraded row must never fire the busy→idle "✓ Finished" push (blocking review finding 2)', () => {
  it('suppresses the push while the row is unmeasured, and still fires the real edge once it heals', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const { io, degrade, heal } = toggleableIO();
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a'], io });
    await w.tick();                    // priming tick — prevStatus: busy, nothing pushed

    // `.wrapper` goes LISTED-but-unreadable. The live-status file underneath
    // still reads 'busy' throughout this whole block — nothing about the
    // SESSION changed, only what this tick could measure about it.
    degrade('cc-a', 'wrapper');
    await w.tick();
    expect(sent, 'a degraded row must never assert a turn completed on a guess').toEqual([]);

    // Still degraded, a second tick: still nothing — `prevStatus` must have
    // been left untouched rather than overwritten to the guessed 'idle',
    // or the real edge below would never be able to fire at all.
    await w.tick();
    expect(sent).toEqual([]);

    // Heals, AND the session actually finishes: the real busy→idle edge must
    // still fire exactly once — suppressing the guess must not have
    // permanently lost the transition it was guessing about.
    heal();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished');
  });

  // Blocking review finding 2, SECOND PASS. The test above degrades the field
  // for the whole tick, so BOTH of the tick's registry reads saw it and the
  // suppression set agreed with the assembled row by luck of the fixture.
  // `tick()` used to take TWO independent whole-fleet reads — its own, at the
  // top, which `unmeasuredIds` is computed from, and `assembleFleet`'s own,
  // 31 [registry-read-census:fields] reads per session later — and the gate
  // only ever suppressed rows the FIRST one could not measure. A drop landing
  // in the SECOND
  // window (the "ordinary shape in remote mode" the ladder exists for) left
  // `unmeasuredIds` empty while `assembleFleet` emitted a wrapper-degraded
  // row frozen at its `!cfgDir` default of 'idle' — and the false
  // "✓ Finished" fired exactly as if no gate had ever been added. MEASURED
  // against the pre-fix tree: this fixture pushed `✓ Finished` for a session
  // whose live-status file says 'busy' throughout. The fix is that there is
  // now only ONE read — `tick()` passes its rows into `assembleFleet` — so
  // the evidence and the emitted row cannot be two different observations.
  //
  // AND IT IS CURRENTLY VACUOUS — D-118, measured (wave-1 review minor m4).
  // Neutering the double below (degrade nothing at all) leaves this test
  // GREEN, on both the converted double and the pre-conversion original at
  // `c1a6866`, so it is pre-existing rather than a Task 4 regression. The
  // reason is in the paragraph above: the fix this was written for landed,
  // `tick()` passes its own rows into `assembleFleet`, and there IS no
  // second read for the `readsThisTick > 1` branch to catch. It is kept as a
  // REGRESSION TRIPWIRE for the day someone re-introduces a second
  // whole-fleet read — not as live coverage of the gate, which the FIRST
  // test in this describe provides. Do not read a green run here as evidence
  // that the suppression works.
  it('suppresses the push when the degrade lands on the fleet assembly\'s read rather than the tick\'s ' +
     'own — the suppression set and the assembled rows must be ONE observation', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };

    let armed = false;
    let readsThisTick = 0;
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => {
        // Once armed, `cc-a.wrapper` reads clean exactly ONCE per tick and
        // fails thereafter. The first read of a tick is `tick()`'s own
        // top-of-method `readRegistry` (its very first await), so the
        // suppression set sees a MEASURED row; every later reader in the same
        // tick — the fleet assembly among them — used to see a degraded one.
        if (armed && p.endsWith('cc-a.wrapper')) {
          readsThisTick += 1;
          if (readsThisTick > 1) return { ok: false, reason: 'unreadable' };
        }
        return localIO.readFileMeasured(p);
      },
    };

    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a'], io });
    await w.tick();                    // priming tick, fully clean: prevStatus = busy
    expect(sent).toEqual([]);

    armed = true;
    readsThisTick = 0;
    await w.tick();
    expect(sent, 'a turn that never finished must never be announced as finished').toEqual([]);

    // And the real edge still lands once the session genuinely goes idle,
    // proving the suppression above did not simply wedge this row shut.
    readsThisTick = 0;
    armed = false;
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished');
  });
});

/** The same `FleetIO` shape as `toggleableIO`, aimed one layer down: the LIVE
 *  STATUS FILE rather than a registry field. `<cfgDir>/sessions/<pid>.json` is
 *  the file `assembleFleet` reads to learn busy-vs-idle, and the only one this
 *  double ever degrades. */
function toggleableLiveIO(): { io: FleetIO; degrade: () => void; heal: () => void } {
  let bad = false;
  const io = degradedReadIO((p) => bad
    && p.includes(`${path.sep}sessions${path.sep}`) && p.endsWith('.json'));
  return { io, degrade: () => { bad = true; }, heal: () => { bad = false; } };
}

// D-115 REGRESSION, found by the review round's own refutation probe.
//
// The describe above pins the rule for rows the REGISTRY ladder degrades.
// Task 3 of this branch created a SECOND way a row's status stops being a
// measurement — `assembleFleet` now paints an unreadable `<pid>.json` as
// `busy` rather than leaving it at the `alive` default of 'idle' — and that
// second route reached the push loop looking exactly like a measurement.
//
// `unmeasuredIds` (`watch.ts:849`) is derived from `FleetSession.unmeasured`,
// which is typed `IdentityField[]` and means, precisely, "which of the
// identity TRIPLE this assembly could not measure". An unreadable live-status
// file degrades none of the three, so the new `busy` was not in that set — it
// flowed straight into the busy→idle edge AND into `prevStatus`.
//
// The consequence is a push that asserts a turn completed when none did:
// a GENUINELY IDLE session whose `<pid>.json` blips unreadable for one tick
// reads idle → busy(guessed) → idle, and the heal tick fires
// "✓ Finished — back to idle" at a session that never started.
//
// MEASURED before the fix: this fixture pushed exactly that. The fix does not
// touch the guard — the guard was right — it feeds it: the row now DECLARES
// that its status word is not a measurement, and `unmeasuredIds` is the union
// of the two routes. Note what is NOT done: the marker does not go into
// `unmeasured`, because `measuredIdentity` gates on `unmeasured.length === 0`
// and a non-identity entry there would make every such row's identity read as
// unmeasurable fleet-wide.
describe('an unreadable live-status file must never fire the busy→idle "✓ Finished" push (D-115)', () => {
  it('suppresses the false edge on a genuinely idle session, and still fires the real one', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const { io, degrade, heal } = toggleableLiveIO();
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a'], io });

    // The session is genuinely IDLE and stays idle for this whole block.
    // Nothing about it changes; only what a tick can measure about it does.
    w.markIdle('cc-a');
    await w.tick();                    // priming tick — prevStatus: idle
    expect(sent, 'priming must never push').toEqual([]);

    degrade();
    await w.tick();                    // the blip: status is painted `busy`
    expect(sent, 'a guessed busy is not a turn starting').toEqual([]);

    heal();
    await w.tick();                    // the heal: status measures idle again
    expect(sent,
      'idle → unreadable → idle fired a "Finished" push for a turn that never happened')
      .toEqual([]);

    // The positive control, and the reason the fix suppresses `prevStatus`
    // rather than the push alone: a REAL edge on the same session must still
    // land. If the suppression had merely skipped the push while letting
    // `prevStatus` absorb the guess, this would silently push nothing.
    w.markBusy('cc-a');
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished');
  });
});

describe('ask notifications carry actions only where the route would accept them', () => {
  /** One session, one watcher, a pane the test drives — so a test can put the
   *  menu up and the envelope down in whichever ORDER it needs, and tick as
   *  many times as it needs. */
  function askFixture(): {
    sent: PushPayload[];
    tick: () => Promise<void>;
    showMenu: (text?: string) => void;
    clearMenu: () => void;
    writeAsk: (ask: unknown, state?: string) => void;
  } {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let pane = 'ready\n❯ \n';
    const home = mkTmp('ccrc-');
    const info = seedSessions(home, ['ccrc-pwa/cc-a']);
    const runner: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${info.get('cc-a')!.pid}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher({ ...testDeps(home, runner), push: push as never }, new Bus(), 10_000);
    return {
      sent,
      tick: () => w.tick(),
      showMenu: (text: string = MENU_PANE) => { pane = text; },
      clearMenu: () => { pane = 'ready\n❯ \n'; },
      writeAsk: (ask: unknown, state?: string) => writeHookState(home, 'cc-a', ask, state),
    };
  }

  /** Raise a genuine ask push: prime on a bare prompt (so `dialogIds` is
   *  empty), then tick with the menu up, which is the appear-edge. */
  async function raiseAsk(ask: unknown, opts: { state?: string } = {}): Promise<PushPayload[]> {
    const f = askFixture();
    await f.tick();                                  // priming: no menu, notify=false
    if (ask !== undefined) f.writeAsk(ask, opts.state);
    f.showMenu();
    await f.tick();                                  // the menu appears → one ask push
    return f.sent;
  }

  it('attaches the first two option labels as actions, each carrying the key', async () => {
    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }, { label: 'Green' }]);
    const sent = await raiseAsk(ask);
    expect(sent).toHaveLength(1);
    const key = askKey(ask as never)!;
    expect(sent[0]!.actions).toEqual([
      { action: `ask:${key}:0`, title: 'Red' },
      { action: `ask:${key}:1`, title: 'Blue' },   // exactly two — the Android ceiling
    ]);
  });

  it('attaches NO actions to a multi-question envelope — the route refuses those', async () => {
    const sent = await raiseAsk({
      questions: [
        { question: 'First?', options: [{ label: 'A' }] },
        { question: 'Second?', options: [{ label: 'B' }] },
      ],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions to an approval envelope — it has no key at all', async () => {
    const sent = await raiseAsk({ approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions when the ask came from the pane alone, with no hook envelope', async () => {
    const sent = await raiseAsk(undefined);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions when the hook is not waiting', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: 'Red' }]), { state: 'working' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions to a free-text ask — there is no index to send', async () => {
    const sent = await raiseAsk(oneQuestion([]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  // PR F whole-branch review, Important 2. This used to ship the readable
  // sibling and drop the blank one, which looks like the careful choice and is
  // the opposite. `answerAsk`'s menu-identity gate matches EVERY option in the
  // envelope against the pane's rows through `pairMatches`, and `pairMatches`
  // refuses whenever either side normalises to '' — so ONE whitespace-only
  // label refuses EVERY index with `menu-mismatch`, permanently. The shipped
  // button was therefore a guaranteed refusal wearing a false sentence ("The
  // terminal is showing something else now" about the very menu on screen),
  // which is exactly what `askActions`' own docstring calls worse than no
  // action. It is provable from the envelope alone, so it is decided here.
  it('attaches NO actions when ANY option label is blank — every index would be refused', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: '   ' }, { label: 'Blue' }]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('looks past the two labels it would ship — a blank at index 2 poisons 0 and 1 too', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: 'Red' }, { label: 'Blue' }, { label: ' ' }]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  // PR F whole-branch review (triage). A one-index tap on a multi-select
  // question is accepted by the route and COMMITTED with Enter (that route's
  // "gated on the QUESTION's kind" branch), so a question taking several
  // answers is narrowed to one and submitted irrevocably — and no notification
  // button has room to say "this submits". Answer those in the app.
  it('attaches NO actions to a multi-select question — one tap would commit it', async () => {
    const sent = await raiseAsk({
      questions: [{
        question: 'Which tools?', header: 'Tools', multiSelect: true,
        options: [{ label: 'Bash' }, { label: 'Edit' }],
      }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  // PR F whole-branch review, Important 3. Sweeping hook states before the
  // pane capture narrows the window; it cannot close it (the sweep reads at s,
  // this session's capture happens at c, and a hook write landing in (s, c) is
  // invisible to the push composed at c). The ask push is edge-triggered on
  // the dialog id, and that id is a hash of the menu's labels and title — it
  // does not change while the cursor moves — so with no latch that question
  // stays un-answerable from the phone for its entire life, silently. Here the
  // envelope arrives one tick late and the notification is amended.
  it('amends an action-less ask push once the envelope turns up', async () => {
    const f = askFixture();
    await f.tick();                       // priming, no menu
    f.showMenu();
    await f.tick();                       // menu with no envelope → action-less push
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.actions).toBeUndefined();

    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }]);
    f.writeAsk(ask);
    await f.tick();                       // same dialog id, envelope now readable
    expect(f.sent).toHaveLength(2);
    const key = askKey(ask as never)!;
    expect(f.sent[1]!.actions).toEqual([
      { action: `ask:${key}:0`, title: 'Red' },
      { action: `ask:${key}:1`, title: 'Blue' },
    ]);
    // Same tag, so this REPLACES the un-answerable notification in its slot
    // rather than stacking a second one under it.
    expect(f.sent[1]!.tag).toBe(f.sent[0]!.tag);

    // Exactly once. A third tick with the envelope still there must not
    // re-notify — the operator would be buzzed every 2 s until they answered.
    await f.tick();
    expect(f.sent).toHaveLength(2);
  });

  it('does not re-push while the envelope never arrives, and forgets the question when the menu clears', async () => {
    const f = askFixture();
    await f.tick();
    f.showMenu();
    await f.tick();
    await f.tick();
    await f.tick();
    expect(f.sent).toHaveLength(1);       // one push, still action-less
    // The menu goes; the same question coming back later is a fresh edge, and
    // must not be answered by the stale latch.
    f.clearMenu();
    await f.tick();
    f.writeAsk(oneQuestion([{ label: 'Red' }]));
    await f.tick();                       // no menu, no envelope-triggered push
    expect(f.sent).toHaveLength(1);
  });

  it('reads THIS tick\'s hook state, not last tick\'s', async () => {
    // The ordering pin. `sweepHookStates` runs before `detectDialogs` in
    // `tick()`; reverse them and the envelope written in the same tick as the
    // menu is invisible, so this push would arrive with no actions and whether
    // a question was answerable from the phone would depend on how the 2-second
    // poll happened to straddle the hook's write.
    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }]);
    const sent = await raiseAsk(ask);
    expect(sent[0]!.actions).toHaveLength(2);
  });

  // Stage 2e Task 3 (D-102). Same hazard as sessionws.test.ts's twin case: an
  // RC-off pane renders the busy spinner WHILE a dialog is painted below it —
  // a real, expected combined screen. `detectDialogs`'s own gate asks
  // `hasMenu`, not `paneState() === 'menu'` (the send.ts:320 idiom). Fix
  // round 1 closed the second half: `parseDialog` (pane/dialog.ts:178) also
  // now gates on `hasMenu` instead of vetoing on the busy marker, so the
  // pending set really does pick this session up and the ask push fires.
  it('D-102: a live busy spinner painted alongside a menu still raises the ask push — RC-off panes render both at once', async () => {
    const f = askFixture();
    await f.tick();                                  // priming: no menu
    f.showMenu(`${BUSY_LINE}\n\n${MENU_PANE}`);
    await f.tick();                                   // RC-off: both on screen at once
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.title).toBe('❓ Question');
  });
});

describe('Task 10: the mail/run NotifyEvent lanes and the durable feed', () => {
  it('records ALL kinds into the durable feed beside notifyLog.record, and restart-survives', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const log = new NotifyLog(path.join(await dir(), 'n.json'));
    await log.load();
    const w = watcher({ push, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a', 'ccrc-pwa/cc-b'] });
    await w.tick();                    // priming — records nothing
    w.markIdle('cc-a');
    await w.tick();                    // an ordinary `done` push
    expect(sent).toHaveLength(1);
    expect(log.seq).toBe(1);
    // The archive got the SAME row the ring did — every kind, not just
    // Build 7's two new ones.
    const events = w.coord!.feedEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 1, kind: 'done', sessionId: 'cc-a' });
  });

  it('the presence-gate exemption: a visible session still gets the RECORD, never the PUSH', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    presence.setVisible(Symbol('t'), 'cc-a');
    const log = new NotifyLog(path.join(await dir(), 'n.json'));
    await log.load();
    const w = watcher({ push, presence, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();                    // priming: seeds the mail watermark

    const mail = w.coord!.insertMail({
      fromId: 'coordinator', fromUuid: 'coordinator', toId: 'cc-a', runId: null,
      kind: 'finding', subject: 'watch this', body: 'b', artifacts: [],
    });
    w.coord!.queueDelivery(mail.id, 'cc-a', 'envelope text');
    await w.tick();

    // Suppressed by presence — spec:238-240 says the RECORD is exempt, not
    // the push, and `ask`/`done`/`merged` never carried `recordAlways` at
    // all, so this is new behaviour Task 10 introduces.
    expect(sent).toEqual([]);
    expect(log.seq).toBe(1);
    expect(w.coord!.feedEvents(10).map((e) => e.kind)).toEqual(['mail']);
  });

  describe('the `mail` lane', () => {
    it('fires at QUEUE time, once per message, with a non-collapsing tag', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();                  // priming

      const m1 = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-a', runId: null,
        kind: 'finding', subject: 'first', body: 'b1', artifacts: [],
      });
      w.coord!.queueDelivery(m1.id, 'cc-a', 'e1');
      const m2 = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-a', runId: null,
        kind: 'question', subject: 'second', body: 'b2', artifacts: [],
      });
      w.coord!.queueDelivery(m2.id, 'cc-a', 'e2');
      await w.tick();

      expect(sent).toHaveLength(2);
      // Two DIFFERENT messages to the SAME session must not collapse into
      // one tray slot (spec:236-237) — unlike `ask`/`done`/`merged`'s
      // default `${kind}-${sessionId}` key.
      expect(sent.map((p) => p.tag)).toEqual([`mail-cc-a-${m1.id}`, `mail-cc-a-${m2.id}`]);
      expect(sent[0]!.title).toBe('✉ finding › cc-a');   // no run -> falls back to the session id
      expect(sent[0]!.body).toBe('first');
      expect(sent[0]!.actions).toBeUndefined();           // v1: actionless
    });

    it('does not replay mail queued before the watcher ever started (no boot storm)', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      // Queued BEFORE the first (priming) tick — as if this mail had been
      // sitting in the database since before this process started.
      const stale = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-a', runId: null,
        kind: 'status', subject: 'old news', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(stale.id, 'cc-a', 'e0');

      await w.tick();                  // priming: seeds the watermark past `stale`
      expect(sent).toEqual([]);

      const fresh = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-a', runId: null,
        kind: 'status', subject: 'breaking news', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(fresh.id, 'cc-a', 'e1');
      await w.tick();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toBe('breaking news');
    });

    it('names the run\'s workspace when the mail is run-scoped', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();

      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.markDispatched(run.id, 'cc-a', 'cc-a-ws', 'build7/wave1', false);
      const mail = w.coord!.insertMail({
        fromId: 'cc-a', fromUuid: 'u-a', toId: 'coordinator', runId: run.id,
        kind: 'status', subject: 'wave 1 update', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(mail.id, 'cc-a', 'e1');
      await w.tick();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.title).toBe('✉ status › cc-a-ws');
    });

    it('records the feed row with the run id when the mail is run-scoped (review finding 2)', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const log = new NotifyLog(path.join(await dir(), 'n.json'));
      await log.load();
      const w = watcher({ push, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();

      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.markDispatched(run.id, 'cc-a', 'cc-a-ws', 'build7/wave1', false);
      const mail = w.coord!.insertMail({
        fromId: 'cc-a', fromUuid: 'u-a', toId: 'coordinator', runId: run.id,
        kind: 'status', subject: 'wave 1 update', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(mail.id, 'cc-a', 'e1');
      await w.tick();

      expect(sent).toHaveLength(1);
      // `pushOne` must forward the run the mail lane already knows into the
      // durable feed, not just onto the decorated title — GET
      // /api/feed?program= depends on this column, and its only writer is
      // `pushNewMail`'s `runId: m.runId` (watch.ts).
      expect(w.coord!.feedEvents(10).map((e) => e.runId)).toEqual([run.id]);
    });

    // Review finding 3. `mailQueuedSince`'s `project` comes off a `LEFT
    // JOIN` to the mail's run and is NULL for ad-hoc mail with no run — a
    // fully supported case (`POST /api/mail` treats `runId` as optional) —
    // and every OTHER mail case in this file seeds exactly one project, so
    // the decoration branch was never entered on this lane before now.
    it('falls back to the RECIPIENT session\'s own project for run-less mail in a multi-project fleet', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a', 'rp-llm/cc-b'] });
      await w.tick();                  // priming

      const mail = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-a', runId: null,
        kind: 'finding', subject: 'flaky test', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(mail.id, 'cc-a', 'e1');
      await w.tick();

      expect(sent).toHaveLength(1);
      // NOT the pre-fix `✉ finding › cc-a · ` (a dangling separator with
      // nothing after it) — `cc-a`'s own project, read from this tick's
      // fleet assembly.
      expect(sent[0]!.title).toBe('✉ finding › cc-a · ccrc-pwa');
    });

    it('suppresses the decoration entirely — never a dangling separator — when even the recipient\'s project is unknown', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a', 'rp-llm/cc-b'] });
      await w.tick();

      // `toId` names no live session (e.g. reaped between send and
      // delivery) — no run, and no fleet entry to fall back to either.
      const mail = w.coord!.insertMail({
        fromId: 'cc-b', fromUuid: 'u-b', toId: 'cc-gone', runId: null,
        kind: 'finding', subject: 'flaky test', body: 'b', artifacts: [],
      });
      w.coord!.queueDelivery(mail.id, 'cc-gone', 'e1');
      await w.tick();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.title).toBe('✉ finding › cc-gone');   // no ' · ' at all
    });
  });

  describe('the `run` lane', () => {
    it('fires once per transition, tagged by run id and target state', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();                  // priming: seeds the run-events watermark

      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.setSession(run.id, 'cc-a');
      w.coord!.advance(run.id, 'dispatched', 'coordinator');
      await w.tick();

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        title: '▸ dispatched › ccrc-pwa',        // no workspace set yet -> falls back to project
        body: 'program:build7 wave 1/3',
        tag: `run-${run.id}-dispatched`,
      });

      w.coord!.advance(run.id, 'closing', 'coordinator');
      w.coord!.advance(run.id, 'done', 'coordinator');
      await w.tick();
      // `closing` fires only ONE push per run-worth-acting-on transition —
      // `done` reaches the tray, `closing` does not (review finding 4:
      // `closing` is internal bookkeeping between the close route's two
      // adjacent `advance()` calls, a state the operator can neither act on
      // nor ever observe as resting).
      expect(sent).toHaveLength(2);
      expect(sent[1]!.tag).toBe(`run-${run.id}-done`);
    });

    it('records the `closing` transition into the log and the feed, but never pushes it', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const log = new NotifyLog(path.join(await dir(), 'n.json'));
      await log.load();
      const w = watcher({ push, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();                  // priming

      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.setSession(run.id, 'cc-a');
      w.coord!.advance(run.id, 'dispatched', 'coordinator');
      w.coord!.advance(run.id, 'closing', 'coordinator');
      w.coord!.advance(run.id, 'done', 'coordinator');
      await w.tick();

      // Two pushes (dispatched, done); THREE records — `recordOnly` exempts
      // only the push, never the record, exactly as `recordAlways` exempts
      // only the record from the presence gate above it.
      expect(sent.map((p) => p.tag)).toEqual([`run-${run.id}-dispatched`, `run-${run.id}-done`]);
      expect(log.seq).toBe(3);
      expect(w.coord!.feedEvents(10).map((e) => e.title)).toEqual([
        '▸ dispatched › ccrc-pwa', '▸ closing › ccrc-pwa', '▸ done › ccrc-pwa',
      ]);
      // review finding 1 (fix round 2): the run lane's own feed rows must
      // carry the run they are about — every one of the three, since
      // `recordAlways` records the suppressed `closing` push too.
      expect(w.coord!.feedEvents(10).map((e) => e.runId)).toEqual([run.id, run.id, run.id]);
    });

    it('never pushes or records a NON-transition row on a bound run', async () => {
      // wave 2 review, minor 1. `recordRunEvent` writes a row whose fromState
      // and toState are both the run's CURRENT state — the skill preflight is
      // the first such caller on a run that already carries a sessionId. Its
      // push would be titled and tagged off `toState` alone, so it arrived as a
      // SECOND, byte-identical `dispatched` notification carrying none of the
      // preflight fact that motivated the row. The tray collapses it by tag;
      // the NotifyLog ring and the durable feed did not, and kept the duplicate
      // forever.
      //
      // The row itself still lands in run_events — that trail is what the wave
      // wanted. What is suppressed is only its NOTIFICATION, on the honest
      // ground that a non-transition is not a transition.
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const log = new NotifyLog(path.join(await dir(), 'n.json'));
      await log.load();
      const w = watcher({ push, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();                  // priming

      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.setSession(run.id, 'cc-a');
      w.coord!.advance(run.id, 'dispatched', 'coordinator');
      w.coord!.recordRunEvent(run.id, 'coordinator', 'skill-preflight:absent');
      await w.tick();

      // ONE push and ONE record for the transition; the observational row is
      // in the trail and nowhere else.
      expect(sent.map((p) => p.tag)).toEqual([`run-${run.id}-dispatched`]);
      expect(log.seq).toBe(1);
      expect(w.coord!.feedEvents(10).map((e) => e.title)).toEqual(['▸ dispatched › ccrc-pwa']);
      expect(w.coord!.runEvents(run.id).map((e) => e.detail))
        .toContain('skill-preflight:absent');
    });

    it('skips a transition with no session yet, but still advances past it', async () => {
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();

      // `planned` -> `failed` with NO session ever minted (e.g. a refusal
      // before dispatch) — nothing to badge or presence-gate against.
      const run = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.advance(run.id, 'failed', 'coordinator');
      await w.tick();
      expect(sent).toEqual([]);

      // The watermark still moved past it — a LATER, sessioned transition on
      // a different run is not blocked behind the skipped one.
      const run2 = w.coord!.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 2, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      w.coord!.setSession(run2.id, 'cc-a');
      w.coord!.advance(run2.id, 'dispatched', 'coordinator');
      await w.tick();
      expect(sent).toHaveLength(1);
    });
  });

  // Review finding 1. `tick()`'s own docstring rule is that one bad lane must
  // not kill the others — every neighbouring lane already earns that
  // non-throwing property (sweepPr/sweepNames/sweepMail's `void …().catch`,
  // saveSnapshot's try/catch, readRegistry's swallow-by-construction), and the
  // four synchronous `CoordStore` calls Task 10 added were the exception.
  // `node:sqlite` throws SYNCHRONOUSLY on the next statement once the
  // connection is unusable (a full disk, `BEGIN IMMEDIATE` losing a lock race)
  // — closing the connection reproduces that class of throw directly, without
  // faking an error.
  describe('a broken coord.db degrades, never crashes the poll', () => {
    it('recordFeedEvent, pushNewMail and pushNewRuns each swallow the throw, warn, and let the push through', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const log = new NotifyLog(path.join(await dir(), 'n.json'));
      await log.load();
      const w = watcher({ push, notifyLog: log, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      await w.tick();                    // priming tick — the db is fine here

      w.coord!.db.close();

      w.markIdle('cc-a');
      // Every coord-touching call this tick reaches is now broken: `pushOne`'s
      // `recordFeedEvent` (off the `done` push), `pushNewMail`'s
      // `mailQueuedSince`, `pushNewRuns`'s `runEventsSince`, and `emitRuns`'s
      // `coord.runs()`. None of them may escape `tick()`.
      await expect(w.tick()).resolves.toBeUndefined();

      // The push and the RING record still went through — only the durable
      // ARCHIVE write failed. A regression that let the throw propagate out of
      // `pushOne` would have lost this push too, not just the archive row.
      expect(sent).toHaveLength(1);
      expect(sent[0]!.title).toBe('✓ Finished');
      expect(log.seq).toBe(1);

      const warned = (needle: string) =>
        warnSpy.mock.calls.some(([line]) => String(line).includes(needle));
      expect(warned('recordFeedEvent failed')).toBe(true);
      expect(warned('pushNewMail failed')).toBe(true);
      expect(warned('pushNewRuns failed')).toBe(true);
      expect(warned('emitRuns failed')).toBe(true);
    });

    it('a break on the very first (priming) tick leaves the watermarks at 0 instead of crashing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const push = { notify: async () => {} };
      const w = watcher({ push, coord: true, sessions: ['ccrc-pwa/cc-a'] });
      w.coord!.db.close();                // broken BEFORE the very first tick ever runs

      await expect(w.tick()).resolves.toBeUndefined();
      expect(warnSpy.mock.calls.some(([line]) =>
        String(line).includes('priming the mail/run watermarks failed'))).toBe(true);
    });
  });
});

// ── Plan W3 Task 3: the release push (design 2026-09-20 §13) ────────────────────────────────────────────────
// A fleet-level push with no session (D-3296): decided by the pure `releaseToNotify`
// (Task 2), marked in `releases.notifiedAt` BEFORE the send is started (D-3295), and
// sent straight to `push.notify` — never through `pushOne`, whose presence gate and feed record are about a
// session. Each case calls the watcher's public `pushRelease` directly unless it is about a lane's wiring.
describe('the release push — once per tag, across restarts, sessionless (design 2026-09-20 §13)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const T = 1_790_000_000_000;
  const listed = (tag: string, channel: UpdateChannel = 'stable'): ReleaseListingRow => ({
    tag, channel, publishedAt: T, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
    bundleListed: true, notes: null, draft: false,
  });
  /** A measured node row, label-keyed (a node with no node-id yet — the store admits it, W2 Task 5). */
  const measured = (label: string, role: NodeRole, currentVersion: string | null): NodeMeasurement => ({
    nodeId: label, role, label, currentVersion, currentSha: 'a'.repeat(40), currentRef: 'main',
    currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false, stampRead: 'ok', installState: 'complete',
    provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: role === 'fleet' ? [] : null,
    highestVersion: currentVersion, previousVersion: null, floorRead: currentVersion === null ? 'absent' : 'measured', previousRead: 'absent',
    os: 'linux', measuredAt: T, report: null,
  });
  const recorder = (): { sent: PushPayload[]; push: { notify: (p: PushPayload) => Promise<void> } } => {
    const sent: PushPayload[] = [];
    return { sent, push: { notify: async (p: PushPayload) => { sent.push(p); } } };
  };
  /** The catalogue plus a remote-mode fleet's two measured nodes. */
  const seed = (coord: CoordStore, o: { releases: ReleaseListingRow[]; server: string | null; fleet: string | null }): void => {
    expect(coord.applyReleaseListing(o.releases, T, 'complete')).toMatchObject({ ok: true });
    expect(coord.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', o.server)).ok).toBe(true);
    expect(coord.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', o.fleet)).ok).toBe(true);
  };
  /** The fleet row's intent, through the store's one intent writer and its journal. */
  const intent = (w: { home: string; coord?: CoordStore }, patch: UpdateIntentPatch): void => {
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(path.join(w.home, '.ccrc')));
    expect(w.coord!.setIntent(FLEET_SCOPE, patch, log, T)).toMatchObject({ ok: true });
  };
  const notifiedAt = (coord: CoordStore, tag: string): number | null | undefined =>
    coord.releases().find((r) => r.tag === tag)?.notifiedAt;
  const COPY_V009 = {
    title: 'ccrc v0.0.9 is out',
    body: 'On stable — fleet and server are on v0.0.7. Tap to see what\'s new.',
    tag: 'release-v0.0.9',
    url: '/settings',
  };

  it('sends the pinned copy — title, body, collapse tag and the /settings url, with no session', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9'), listed('v0.0.7')], server: 'v0.0.7', fleet: 'v0.0.7' });
    const outcome = w.w.pushRelease(T);
    expect(sent).toEqual([COPY_V009]);
    expect(Object.keys(sent[0]!).sort()).toEqual(['body', 'tag', 'title', 'url']);   // no sessionId, no actions
    expect(sent[0]!.sessionId).toBeUndefined();
    expect(sent[0]!.actions).toBeUndefined();
    expect(outcome).toEqual({ did: 'pushed', tag: 'v0.0.9', payload: sent[0] });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);
    expect(notifiedAt(w.coord!, 'v0.0.7')).toBeNull();   // only the newest is ever announced
  });

  it("a measured node whose stamp did not read is a MISSING side in the push body, never 'unversioned' (D-3307)", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', 'v0.0.7')).ok).toBe(true);
    // The fleet row WAS measured this sweep, but its stamp did not read — the
    // same shape a local-mode box's EACCES leaves. `measured()` fixes
    // stampRead 'ok', so this overrides it to the unread arm directly.
    expect(w.coord!.upsertNodeMeasurement({ ...measured(FLEET_LABEL, 'fleet', null), stampRead: 'unreadable' }).ok).toBe(true);
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent[0]!.body).toBe('On stable — fleet — · server v0.0.7. Tap to see what\'s new.');
    expect(sent[0]!.body).not.toContain('unversioned');
  });

  it('names each side when the nodes disagree — On dev — fleet v0.0.7 · server v0.0.9', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.10', 'dev'), listed('v0.0.9')], server: 'v0.0.9', fleet: 'v0.0.7' });
    intent(w, { channel: 'dev' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.10' });   // semver: v0.0.10 > v0.0.9
    expect(sent.map((p) => [p.title, p.body, p.tag])).toEqual([
      ['ccrc v0.0.10 is out', 'On dev — fleet v0.0.7 · server v0.0.9. Tap to see what\'s new.', 'release-v0.0.10'],
    ]);
  });

  it('sends once per tag: a second decision after notifiedAt sends nothing and keeps the first mark', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(w.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(w.w.pushRelease(T + 120_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(sent).toHaveLength(1);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);
  });

  it('sends once per tag across a restart: a NEW watcher over the same coord.db sends nothing', () => {
    const first = recorder();
    const a = watcher({ push: first.push, coord: true, sessions: [] });
    seed(a.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(a.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(first.sent).toHaveLength(1);

    const second = recorder();
    a.coord!.db.close();                                // the first process is gone: nothing below reads through its handle
    const b = watcher({ push: second.push, coord: true, sessions: [], home: a.home });
    expect(notifiedAt(b.coord!, 'v0.0.9')).toBe(T);     // a second connection, from disk, reads the committed mark
    expect(b.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(second.sent).toEqual([]);
  });

  it("notify: 'stable' skips a newer dev tag and announces the stable one, on stable", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9', 'dev'), listed('v0.0.8')], server: 'v0.0.7', fleet: 'v0.0.7' });
    intent(w, { channel: 'dev', notify: 'stable' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.8' });
    expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.8']);
    expect(sent[0]!.body).toBe('On stable — fleet and server are on v0.0.7. Tap to see what\'s new.');
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  it("notify: 'off' sends nothing and marks nothing", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    intent(w, { notify: 'off' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  // D-3294: a tag every measured node already runs is marked, not announced.
  it('a fleet already on the newest tag is marked with no push, and the next tag listed afterwards is pushed', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.9', fleet: 'v0.0.9' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'marked', tag: 'v0.0.9' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);

    expect(w.coord!.applyReleaseListing([listed('v0.0.10'), listed('v0.0.9')], T + 1, 'complete')).toMatchObject({ ok: true });
    expect(w.w.pushRelease(T + 1)).toMatchObject({ did: 'pushed', tag: 'v0.0.10' });
    expect(sent.map((p) => p.title)).toEqual(['ccrc v0.0.10 is out']);
  });

  // D-3295: the mark is COMMITTED — visible to another connection — before the send starts.
  it('commits the mark before notify is called: a second connection reads notifiedAt inside the send', () => {
    let reader: CoordStore | null = null;
    const seen: (number | null | undefined)[] = [];
    const push = { notify: async (_p: PushPayload) => { seen.push(reader === null ? undefined : notifiedAt(reader, 'v0.0.9')); } };
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    reader = new CoordStore(openCoordDb(path.join(w.home, '.ccrc', 'coord.db')));
    expect(notifiedAt(reader, 'v0.0.9')).toBeNull();     // control: nothing is marked before the decision
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed' });
    expect(seen).toEqual([T]);
  });

  it('a send that rejects is not retried — at most once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const push = { notify: async (_p: PushPayload) => { calls += 1; throw new Error('endpoint gone'); } };
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    await vi.waitFor(() => expect(warn.mock.calls.some(([l]) =>
      String(l).startsWith('ccrc-server: ') && String(l).includes('release push for v0.0.9 did not send'))).toBe(true));
    expect(w.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(calls).toBe(1);
  });

  it('a mark that loses sends nothing — another writer marked the tag first', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    vi.spyOn(w.coord!, 'markReleaseNotified').mockReturnValue({ ok: false, why: 'already-notified', notifiedAt: T - 1 });
    expect(w.w.pushRelease(T)).toEqual({ did: 'refused', tag: 'v0.0.9', why: 'already-notified' });
    expect(sent).toEqual([]);
  });

  it('a store that throws is a failed decision — warned once per reason, nothing sent, never thrown to the lane', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    w.coord!.db.close();                     // node:sqlite now throws synchronously on every read
    const a = w.w.pushRelease(T);
    const b = w.w.pushRelease(T + 60_000);
    expect(a).toMatchObject({ did: 'failed' });
    expect(b).toEqual(a);
    expect(sent).toEqual([]);
    const decisionWarns = warn.mock.calls.filter(([l]) => String(l).includes('the release push was not decided'));
    expect(decisionWarns).toHaveLength(1);
    expect(String(decisionWarns[0]![0])).toMatch(/^ccrc-server: /);   // item 10, F10: the prefix is pinned, not just present
  });

  it("a fleet-role process neither sends nor marks — push subscriptions are the server box's", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [], cfg: { role: 'fleet' } });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'not-server-role' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  it('no coordination database: nothing to decide', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, sessions: [] });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'no-coord' });
    expect(sent).toEqual([]);
  });

  it('no push service (no VAPID keys) decides and marks nothing — a sender configured later still announces the tag', () => {
    const w = watcher({ coord: true, sessions: [] });   // no `push`: the box `index.ts` builds without VAPID keys
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'no-push-service' });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();   // not used up: nothing was sent
    const { sent, push } = recorder();
    const b = watcher({ push, coord: true, sessions: [], home: w.home });   // the restart after VAPID keys are configured
    expect(b.w.pushRelease(T + 60_000)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.9']);
  });

  it('a visible session does not suppress it — the release push has no session to be looking at', () => {
    const { sent, push } = recorder();
    const presence = new Presence();
    presence.setVisible(Symbol('t'), 'cc-a');
    const w = watcher({ push, presence, coord: true, sessions: ['ccrc-pwa/cc-a'] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(presence.isVisible('cc-a')).toBe(true);        // control: the gate WOULD suppress a pushOne about cc-a
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent).toHaveLength(1);
  });

  it('leaves no feed row and no ring record — it is a push, not a NotifyEvent', async () => {
    const { sent, push } = recorder();
    const log = new NotifyLog(path.join(mkTmp('push-release-log-'), 'n.json'));
    await log.load();
    const w = watcher({ push, notifyLog: log, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed' });
    expect(sent).toHaveLength(1);
    expect(log.seq).toBe(0);
    expect(w.coord!.feedEvents(10)).toEqual([]);
  });

  it('is wired through the inventory lane: inventoryNow() on a local-mode server pushes once the sweep has measured the box', async () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    writeFileSync(path.join(w.home, '.ccrc', NODE_FILES.stamp),
      `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.7' })}\n`);
    // D-3300: before the first sweep no node is measured, so nothing is decided.
    expect(w.w.pushRelease(Date.now())).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    await w.w.inventoryNow();
    expect(sent).toEqual([COPY_V009]);   // local mode: the one `both` row is both sides
  });

  /** A catalogue double whose `poll` lists `v0.0.9` into the watcher's own store, as W2's poller writes. */
  const listingPoller = (store: () => CoordStore): CataloguePoller => ({
    poll: async (now: number) => {
      store().applyReleaseListing([listed('v0.0.9')], now, 'complete');
      return { lastOkAt: now, lastError: null };
    },
    state: () => ({ lastOkAt: null, lastError: null }),
    lastRequestAt: () => null,
  });
  const writeStamp = (home: string, version: string): void => {
    writeFileSync(path.join(home, '.ccrc', NODE_FILES.stamp),
      `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version })}\n`);
  };

  it('is wired through the catalogue lane: once this process has swept, the poll that lists a tag announces it', async () => {
    const { sent, push } = recorder();
    let store: CoordStore | null = null;
    const w = watcher({ push, coord: true, sessions: [], catalogue: listingPoller(() => store!) });
    store = w.coord!;
    writeStamp(w.home, 'v0.0.7');
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });   // control: nothing listed yet
    // This process's first inventory run: it measures the box (v0.0.7) and, with nothing listed, decides nothing.
    await w.w.inventoryNow();
    expect(sent).toEqual([]);
    vi.spyOn(w.w, 'inventoryNow').mockResolvedValue([]);   // the inventory lane stays out: this case is the catalogue's
    await w.tick();
    await vi.waitFor(() => expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.9']));
    expect(sent[0]!.body).toBe('On stable — fleet and server are on v0.0.7. Tap to see what\'s new.');
  });

  // D-3314: until this process's first inventory run rewrites them, the nodes
  // rows are the PREVIOUS process's — after a server-box update, still at the version the update replaced.
  it("the catalogue lane waits for this process's first inventory run — a row from before the restart is never decided on", async () => {
    const { sent, push } = recorder();
    let store: CoordStore | null = null;
    const w = watcher({ push, coord: true, sessions: [], catalogue: listingPoller(() => store!) });
    store = w.coord!;
    // The previous process's row: this box on v0.0.7, measured before the update that placed v0.0.9 and restarted it.
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'both', 'v0.0.7')).ok).toBe(true);
    writeStamp(w.home, 'v0.0.9');                            // this process's tree, which its first run will read
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });   // control: nothing listed yet
    const inventory = vi.spyOn(w.w, 'inventoryNow').mockResolvedValue([]);   // the first run has not finished
    const afterPoll = vi.spyOn(w.w, 'pushReleaseAfterPoll');
    await w.tick();
    await vi.waitFor(() => expect(afterPoll).toHaveBeenCalledTimes(1));
    expect(afterPoll.mock.results[0]!.value).toEqual({ did: 'skipped', why: 'not-yet-swept' });
    expect(w.coord!.releases().map((r) => r.tag)).toEqual(['v0.0.9']);   // control: the poll DID list the tag
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    // The first run finishes: it measures v0.0.9 (the same label-keyed row, rewritten) and decides — marked, no push.
    inventory.mockRestore();
    await w.w.inventoryNow();
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toEqual(expect.any(Number));
  });

  // Fix round 1 (F3, D-3314 amended): `inventorySwept` opens only on a sweep that actually rewrote what the
  // push decides on. A link-down sweep only marks the fleet row unreachable — it does not remeasure it — so
  // this must not count, either for the flag or for the DIRECT `pushRelease` call `sweepThenProject` makes at
  // its own end (the same hazard `pushReleaseAfterPoll` guards for the catalogue lane).
  it("a remote-mode boot with the agent link down never pushes on the previous process's rows — a later sweep that measures the link does (F3, D-3314 amended)", async () => {
    const { sent, push } = recorder();
    const state = fleetState({ connected: false, downSince: T });
    const w = watcher({ push, coord: true, sessions: [], cfg: { fleetMode: 'remote', role: 'server' }, fleetState: state });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    // The previous process's fleet row — already behind the candidate.
    expect(w.coord!.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', 'v0.0.7')).ok).toBe(true);
    writeStamp(w.home, 'v0.0.9');
    await w.w.inventoryNow();   // the link is down: sweepFleet only marks it unreachable, never remeasures
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    expect(w.w.pushReleaseAfterPoll(T + 1)).toEqual({ did: 'skipped', why: 'not-yet-swept' });

    // The link recovers: the next sweep measures the fleet row for real, and this process finally decides.
    state.connected = true;
    await w.w.inventoryNow();
    expect(notifiedAt(w.coord!, 'v0.0.9')).toEqual(expect.any(Number));
  });

  // Fix round 1 (F4, D-3314 amended): a `sweepOwn` throw (a locked/corrupt coord.db, most likely) must not
  // open the flag either — its premise, "this sweep rewrote the rows", is not measured.
  it("a boot whose sweepOwn throws also leaves inventorySwept closed — pushRelease is not tried on the previous process's row (F4, D-3314 amended)", async () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });   // local mode: one `both` row
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    // The previous process's row — already behind the candidate.
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'both', 'v0.0.7')).ok).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(w.coord!, 'upsertNodeMeasurement').mockImplementationOnce(() => { throw new Error('boom'); });
    await w.w.inventoryNow();   // sweepOwn's own write throws, caught as an 'error' outcome
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    expect(w.w.pushReleaseAfterPoll(T + 1)).toEqual({ did: 'skipped', why: 'not-yet-swept' });
    warn.mockRestore();
  });

  // Fix round 1 (F1, D-3313 via remoteSides, moved to L0): on a REMOTE fleet, deciding sides from a
  // pre-filtered row set is what let a `both` server row's own version stand in for a fleet nobody measured.
  // The reviewer's exact rows: a server row recorded `both`, and a separate fleet row whose stamp did not read.
  it('on a remote fleet, a server row recorded as both never states a fleet version nobody measured (F1)', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [], cfg: { fleetMode: 'remote' } });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'both', 'v0.0.7')).ok).toBe(true);
    expect(w.coord!.upsertNodeMeasurement({ ...measured(FLEET_LABEL, 'fleet', null), stampRead: 'unreadable' }).ok).toBe(true);
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent[0]!.body).toBe('On stable — fleet — · server v0.0.7. Tap to see what\'s new.');
  });

  // The narrower D-3313 case: no separate fleet row exists AT ALL, so `versionSides`' own `both`-row fallback
  // is what would fire (a real fleet-role row's mere presence, above, already blocks the fallback regardless
  // of which side-picker runs — this is the case that needs `remoteSides` specifically).
  it('on a remote fleet with no fleet row at all, a lone both row never lends its version to the fleet side (D-3313)', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [], cfg: { fleetMode: 'remote' } });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'both', 'v0.0.7')).ok).toBe(true);
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent[0]!.body).toBe('On stable — fleet — · server v0.0.7. Tap to see what\'s new.');
  });

  // Fix round 1 (F14, D-3316): "unreachable is not current" binds the push body too. An unreachable fleet
  // row carrying an old version does not state its version in the push body, and does not count as current
  // in the decision — it is not the fact that suppresses the push.
  it('an unreachable fleet row carrying an old version does not state its version, and is not treated as current (F14, D-3316)', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [], cfg: { fleetMode: 'remote' } });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', 'v0.0.9')).ok).toBe(true);
    expect(w.coord!.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', 'v0.0.7')).ok).toBe(true);
    expect(w.coord!.markUnreachable(FLEET_LABEL, 'fleet', T + 1).ok).toBe(true);   // the connection then drops
    expect(w.w.pushRelease(T + 1)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });   // never suppressed
    expect(sent[0]!.body).toBe('On stable — fleet — · server v0.0.9. Tap to see what\'s new.');
  });
});
