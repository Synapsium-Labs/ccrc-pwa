// ARCH-47 — the liveness truth table, the OTHER ladders. `session-reading-truth-table.test.ts` pins the destructive
// callers' ladder (`measureClaimant`); this file pins the rest of the server's "is it alive / is it busy" readers on the
// SAME seeded rows (a fixture HOME, a fake tmux), recording today's answer per row and per reader, INCLUDING where they
// differ. They differ on purpose: `liveStatus` answers `dead` for an unlistable or unmeasurable row (its one consumer
// refuses on it), the fleet frame answers `busy` where `liveStatus` answers `idle` (a failed pid or an unreadable live
// file), and `resolve` has no `dead` word for a row the registry could not place. ARCH-48 moves display readers onto the
// tick's reading and destructive readers onto a fresh one; every row here that changes then is a ruled change, listed
// in that PR, and every row that does not is a regression caught.
//
// The readers (the spec's seven): `measureClaimant` (its own file), `liveStatus`, the fleet frame's row (`assembleFleet`),
// `turnverdict.liveRowFor` (the same assembler over one row), `SessionStream.resolve`'s registry ladder, `claimProbe`
// over the frame's rows, and the dead-coordinator predicate over `measureClaimant`'s verdict.
//
// The turn rows are what replaces the MIRRORED comment in `sessionws.ts`: for every live-pane row the fleet card's word
// and the chat header's word are held to ONE word here, so a drift between the pair is red in this file.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { assembleFleet, liveStatus } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { liveRowFor } from '../src/turnverdict.js';
import { readSessionRecord } from '../src/registry.js';
import { SessionStream } from '../src/sessionws.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { claimantMeasuredDead, measureClaimant } from '../src/coord/reclaim.js';
import { deadCoordinatorCrash } from '../src/deadCoordinator.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { seedRoster, testDeps } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';

// Real time: `liveRowFor` assembles at the wall clock, so a heartbeat stamp must be fresh against it too.
const NOW = Date.now();
const SEC = Math.floor(NOW / 1000);
const ID = 'demo-quiet-mesa';
const OTHER = 'demo-brisk-fen';
const PID = 40613;

type Pane = 'live' | 'gone' | 'unknown';
type LiveFile = 'idle' | 'busy' | 'waiting' | 'absent' | 'unreadable';

const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const seedLive = (home: string, status: 'idle' | 'busy' | 'waiting'): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: `u-${ID}`, cwd: `/w/${ID}`, name: 'quiet-mesa-1',
    status, statusUpdatedAt: 1784600000000, version: '2.1.233',
  }));
};

interface Row {
  name: string;
  seed: (home: string) => void;
  pane: Pane;
  /** `list-panes` fails (a loaded tmux server). */
  pidFails?: boolean;
  live?: LiveFile;
  id?: string;
  io?: FleetIO;
}

const row = (name: string, pane: Pane, seed: Row['seed'], more: Partial<Row> = {}): Row => ({ name, pane, seed, ...more });
const stamp = (extra: Record<string, string>): Row['seed'] => (h) => seedRow(h, ID, extra);

const ROWS: Row[] = [
  row('the registry directory will not list', 'gone', stamp({}), { io: { ...localIO, readdir: async () => null } }),
  row('an id that is not a registry id', 'gone', stamp({}), { id: '--flag' }),
  row('no row in a directory that listed cleanly', 'gone', (h) => seedRow(h, OTHER)),
  row('listed but unassembled (a coordinator mid-write, D-1144)', 'gone', (h) => {
    const reg = path.join(h, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
    writeFileSync(path.join(reg, `${ID}.started`), '1');
  }),
  row('a live pane, live file idle', 'live', stamp({}), { live: 'idle' }),
  row('a live pane, live file busy', 'live', stamp({}), { live: 'busy' }),
  row('a live pane, live file waiting (collapsed to busy)', 'live', stamp({}), { live: 'waiting' }),
  row('a live pane, no live file yet (the seconds after ws-add)', 'live', stamp({}), { live: 'absent' }),
  row('a live pane, live file unreadable', 'live', stamp({}), { live: 'unreadable' }),
  row('a live pane, the pane pid read failed', 'live', stamp({}), { live: 'idle', pidFails: true }),
  row('a live pane outranks a stop stamp', 'live', stamp({ stopped: `${SEC} ccd` }), { live: 'idle' }),
  row('tmux did not answer', 'unknown', stamp({}), { live: 'idle' }),
  row('gone + a stop stamp', 'gone', stamp({ stopped: `${SEC} ccd` })),
  row('gone + a stop stamp + hibernated', 'gone', stamp({ stopped: `${SEC} ccd`, hibernated: `${SEC} 7` })),
  row('gone + a long-gone heartbeat, stale hibernated stamp', 'gone',
    stamp({ supervised: String(SEC - 3600), hibernated: `${SEC - 7200} 7` })),
  row('gone + a fresh supervisor heartbeat (restarting)', 'gone', stamp({ supervised: String(SEC) })),
];

interface World {
  cfg: ReturnType<typeof loadConfig>;
  io: FleetIO;
  tmux: Tmux;
  home: string;
  id: string;
}

const world = (r: Row): World => {
  const home = mkTmp('ccrc-ladders-');
  seedRoster(home);
  r.seed(home);
  if (r.live === 'idle' || r.live === 'busy' || r.live === 'waiting') seedLive(home, r.live);
  if (r.live === 'unreadable') seedLive(home, 'idle');
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') {
      if (r.pane === 'live') return { ran: true, code: 0, stdout: '', stderr: '' };
      if (r.pane === 'gone') return { ran: true, code: 1, stdout: '', stderr: "can't find session: x" };
      return { ran: true, code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-0/default' };
    }
    if (args[0] === 'list-panes') {
      return r.pidFails === true
        ? { ran: true, code: 1, stdout: '', stderr: 'server exited unexpectedly' }
        : { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = r.io ?? localIO;
  const io = r.live === 'unreadable' ? degradedReadIO((p) => p.endsWith(`${PID}.json`)) : base;
  return { cfg: loadConfig({ CCRC_HOME: home }), io, tmux: new Tmux(run), home, id: r.id ?? ID };
};

interface Observed {
  liveStatus: string;
  /** The fleet frame's row: `absent` when the frame does not list the id at all. */
  frame: string;
  liveRow: string;
  resolve: string;
  claimProbe: string;
  measuredDead: boolean;
  crash: string;
}

const observe = async (r: Row): Promise<Observed> => {
  const w = world(r);
  const ls = await liveStatus(w.io, w.cfg, w.tmux, w.id);

  const fleet = await assembleFleet(w.io, w.cfg, w.tmux);
  const s = fleet.find((x) => x.id === w.id);
  const frame = s === undefined ? 'absent'
    : `${s.status}${s.statusUnmeasured ? '+unmeasured' : ''}/${s.lifecycle}`;

  const rec = await readSessionRecord(w.io, w.cfg, w.id);
  let liveRow = 'no-record';
  if (rec.kind === 'found') {
    const lr = await liveRowFor({ io: w.io, cfg: w.cfg, tmux: w.tmux, pendingDialogs: () => undefined, statuslines: () => undefined },
      rec.record, rec.record.uuid);
    liveRow = lr === null ? 'null' : `${lr.status}${lr.statusUnmeasured ? '+unmeasured' : ''}/${lr.lifecycle}`;
  }

  const deps = { cfg: w.cfg, runCcd: ccdRunner(async () => ({ ran: true, code: 1, stdout: '', stderr: '' }), w.cfg),
    tmux: w.tmux, io: w.io, queue: new KeyedQueue() };
  const stream = new SessionStream(deps, new Bus(), w.id, () => undefined);
  const res = await (stream as unknown as { resolve(): Promise<{ ok: boolean; reason?: string; data?: { status: string } }> }).resolve();
  const resolve = res.ok ? `ok:${res.data!.status}` : `no:${res.reason}`;

  const coord = new CoordStore(openCoordDb(path.join(w.home, '.ccrc', 'coord.db')));
  const watcher = new FleetWatcher(testDeps(w.home) as never, new Bus(), 10_000);
  const probe = (watcher as unknown as { claimProbe(s: unknown, r: ReadonlySet<string>): { liveness(id: string): string } })
    .claimProbe(fleet, new Set());
  const claimProbe = probe.liveness(w.id);

  const m = await measureClaimant({ coord, io: w.io, cfg: w.cfg, tmux: w.tmux }, w.id, NOW);
  const crash = deadCoordinatorCrash(m, { kind: 'no-history' }).kind;
  return { liveStatus: ls, frame, liveRow, resolve, claimProbe, measuredDead: claimantMeasuredDead(m), crash };
};

/** Recorded from the code as it stands before ARCH-48 moves any of these readers. The columns that differ on a row are
 *  the point: `liveStatus` is `dead` for every row the registry could not place and `idle` where the frame says
 *  `busy+unmeasured`; the frame lists neither an unlistable directory nor a listed-but-unassembled row; `measuredDead`
 *  is true only for a proven absence or a dead lifecycle, and false for a sleeper. */
const EXPECTED: Record<string, Observed> = {
  "the registry directory will not list": { liveStatus: 'dead', frame: 'absent', liveRow: 'no-record', resolve: 'no:unmeasurable', claimProbe: 'gone', measuredDead: false, crash: 'unmeasurable' },
  "an id that is not a registry id": { liveStatus: 'dead', frame: 'absent', liveRow: 'no-record', resolve: 'no:absent', claimProbe: 'gone', measuredDead: false, crash: 'unmeasurable' },
  "no row in a directory that listed cleanly": { liveStatus: 'dead', frame: 'absent', liveRow: 'no-record', resolve: 'no:absent', claimProbe: 'gone', measuredDead: true, crash: 'unmeasured' },
  "listed but unassembled (a coordinator mid-write, D-1144)": { liveStatus: 'dead', frame: 'absent', liveRow: 'no-record', resolve: 'no:absent', claimProbe: 'gone', measuredDead: false, crash: 'unmeasurable' },
  "a live pane, live file idle": { liveStatus: 'idle', frame: 'idle/unsupervised', liveRow: 'idle/unsupervised', resolve: 'ok:idle', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane, live file busy": { liveStatus: 'busy', frame: 'busy/unsupervised', liveRow: 'busy/unsupervised', resolve: 'ok:busy', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane, live file waiting (collapsed to busy)": { liveStatus: 'busy', frame: 'busy/unsupervised', liveRow: 'busy/unsupervised', resolve: 'ok:busy', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane, no live file yet (the seconds after ws-add)": { liveStatus: 'idle', frame: 'idle/unsupervised', liveRow: 'idle/unsupervised', resolve: 'ok:idle', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane, live file unreadable": { liveStatus: 'idle', frame: 'busy+unmeasured/unsupervised', liveRow: 'busy+unmeasured/unsupervised', resolve: 'ok:busy', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane, the pane pid read failed": { liveStatus: 'idle', frame: 'busy+unmeasured/unsupervised', liveRow: 'busy+unmeasured/unsupervised', resolve: 'ok:busy', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "a live pane outranks a stop stamp": { liveStatus: 'idle', frame: 'idle/unsupervised', liveRow: 'idle/unsupervised', resolve: 'ok:idle', claimProbe: 'running', measuredDead: false, crash: 'alive' },
  "tmux did not answer": { liveStatus: 'dead', frame: 'dead/orphan', liveRow: 'dead/orphan', resolve: 'ok:dead', claimProbe: 'gone', measuredDead: false, crash: 'unmeasurable' },
  "gone + a stop stamp": { liveStatus: 'dead', frame: 'dead/stopped', liveRow: 'dead/stopped', resolve: 'ok:dead', claimProbe: 'gone', measuredDead: true, crash: 'stopped' },
  "gone + a stop stamp + hibernated": { liveStatus: 'dead', frame: 'dead/stopped', liveRow: 'dead/stopped', resolve: 'ok:dead', claimProbe: 'gone', measuredDead: false, crash: 'alive' },
  "gone + a long-gone heartbeat, stale hibernated stamp": { liveStatus: 'dead', frame: 'dead/orphan', liveRow: 'dead/orphan', resolve: 'ok:dead', claimProbe: 'gone', measuredDead: true, crash: 'crashed' },
  "gone + a fresh supervisor heartbeat (restarting)": { liveStatus: 'dead', frame: 'dead/restarting', liveRow: 'dead/restarting', resolve: 'ok:dead', claimProbe: 'gone', measuredDead: false, crash: 'alive' },
};

describe('the other liveness ladders, on the same rows (today\'s answers, differences included)', () => {
  for (const r of ROWS) {
    it(r.name, async () => {
      const got = await observe(r);
      expect(got).toEqual(EXPECTED[r.name]);
    });
  }
});

describe('the fleet card and the chat header give one turn word (replaces the MIRRORED comment)', () => {
  for (const r of ROWS.filter((x) => x.pane === 'live')) {
    it(r.name, async () => {
      const got = await observe(r);
      const card = got.frame.split('/')[0]!.replace('+unmeasured', '');
      const header = got.resolve.replace('ok:', '');
      expect(header).toBe(card);
    });
  }
});

describe('claimProbe reads a refused id as doubt before it can read it gone', () => {
  it('a refused id is unmeasurable even though no frame row lists it', () => {
    const watcher = new FleetWatcher(testDeps(mkTmp('ccrc-ladders-')) as never, new Bus(), 10_000);
    const probe = (watcher as unknown as { claimProbe(s: unknown[], r: ReadonlySet<string>): { liveness(id: string): string } })
      .claimProbe([], new Set([ID]));
    expect(probe.liveness(ID)).toBe('unmeasurable');
    expect(probe.liveness(OTHER)).toBe('gone');
  });
});
