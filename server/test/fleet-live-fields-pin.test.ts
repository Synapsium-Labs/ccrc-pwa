// D-7512 (RS9, the ring-exemption drain, server half; ARCH-05). The characterization the fleet assembly's live-state
// read is moved under: every live field of a fleet row, under each of the live file's five conditions, read through
// `assembleFleet` itself. `livestate.test.ts` holds the reader's conditions directly and `fleet.test.ts` holds a few
// of these columns; this file holds the whole table in one place, so the port commit (the read reaches the reader
// `assembleFleet` is handed) is judged against rows written before it.
//
// The live fields, as the wire carries them: `status`, `name`, `statusUpdatedAt`, `version`, `statusUnmeasured`; and
// three reached through locals: `liveWaiting` as `dialogPending`, `liveWaitingFor` as `askSummary` (through
// `hookAskSummary`), and `liveCoversWorkflows` as whether a statusline Workflow row promotes `idle` to `busy`. The read
// count is the live file's own: one read, or two when the first body is torn (the 50 ms re-read, D-5234).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver, type LiveStateRead } from '../src/livestate.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { Statusline } from '../src/pane/statusline.js';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';

const ID = 'claude-live-pin';
const PID = 4242;
const LIVE = path.join('sessions', `${PID}.json`);

/** One registry row in a temp home and an alive pane whose pid is `PID`. No live file is written to disk: each
 *  condition's body comes from the io double, and the absent condition is `localIO`'s own proven ENOENT. */
const home = mkTmp('ccrc-live-pin-');
seedRoster(home);
{
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: ID, workdir: `/data/projects/${ID}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
}
const cfg = loadConfig({ CCRC_HOME: home });
const run: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
  return { ran: true, code: 0, stdout: '', stderr: '' };
};
const tmux = new Tmux(run);

/** The one call of `assembleFleet` in this file. */
const assemble = (io: FleetIO, statuslines?: Map<string, Statusline>): Promise<FleetSession[]> =>
  assembleFleet(io, cfg, tmux, liveStateReaderOver(io), undefined, undefined, statuslines);

/** Counts the live file's reads and delegates every read to `inner`. */
const counted = (inner: FleetIO): { io: FleetIO; reads: () => number } => {
  let n = 0;
  const io: FleetIO = {
    ...inner,
    readFileMeasured: async (p, t, sig) => {
      if (p.endsWith(LIVE)) n += 1;
      return inner.readFileMeasured(p, t, sig);
    },
  };
  return { io, reads: () => n };
};

/** The live file answers `bodies` in order, the last one repeating (the shape of `livestate.test.ts`'s
 *  `sequencedLiveIO`, written here). */
const bodiesIO = (bodies: string[]): FleetIO => {
  let n = 0;
  return {
    ...localIO,
    readFileMeasured: async (p, t, sig) => {
      if (!p.endsWith(LIVE)) return localIO.readFileMeasured(p, t, sig);
      const body = bodies[Math.min(n, bodies.length - 1)]!;
      n += 1;
      return { ok: true, content: body };
    },
  };
};

const TORN = '{"pid":4242,"sessionId":"3';
const body = (status: string, version: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
  pid: PID, sessionId: '3'.repeat(36), cwd: `/data/projects/${ID}`, name: 'live pin work', nameSource: 'chosen',
  status, statusUpdatedAt: 1784600000000, version, ...extra,
});
const WAITING = body('waiting', '2.1.283', { waitingFor: 'a reason' });

type Condition = 'absent' | 'unreadable' | 'torn once' | 'torn twice' | 'well formed';
const ioFor = (c: Condition, whole: string): FleetIO => {
  switch (c) {
    case 'absent': return localIO;
    case 'unreadable': return degradedReadIO((p) => p.endsWith(LIVE));
    case 'torn once': return bodiesIO([TORN, whole]);
    case 'torn twice': return bodiesIO([TORN, TORN]);
    case 'well formed': return bodiesIO([whole]);
  }
};

const project = (s: FleetSession) => ({
  status: s.status, name: s.name, statusUpdatedAt: s.statusUpdatedAt, version: s.version,
  statusUnmeasured: s.statusUnmeasured, dialogPending: s.dialogPending, askSummary: s.askSummary,
});

const NOTHING = { name: null, statusUpdatedAt: null, version: null, dialogPending: false, askSummary: null };
const READ_WAITING = {
  status: 'busy' as const, name: 'live pin work', statusUpdatedAt: 1784600000000, version: '2.1.283',
  statusUnmeasured: false, dialogPending: true, askSummary: 'a reason',
};

describe('assembleFleet: every live field under each of the live file\'s five conditions (D-7512)', () => {
  const rows: [Condition, ReturnType<typeof project>, number][] = [
    ['absent', { status: 'idle', ...NOTHING, statusUnmeasured: false }, 1],
    ['unreadable', { status: 'busy', ...NOTHING, statusUnmeasured: true }, 1],
    ['torn once', READ_WAITING, 2],
    ['torn twice', { status: 'busy', ...NOTHING, statusUnmeasured: true }, 2],
    ['well formed', READ_WAITING, 1],
  ];

  it.each(rows)('%s: the row\'s live fields, and how many times the live file was read', async (c, expected, reads) => {
    const live = counted(ioFor(c, WAITING));
    const fleet = await assemble(live.io);
    expect(project(fleet.find((x) => x.id === ID)!)).toEqual(expected);
    expect(live.reads()).toBe(reads);
  });
});

describe('assembleFleet: whether a statusline Workflow row promotes idle, under each condition (D-7512)', () => {
  const workflow = new Map<string, Statusline>([[ID, { ultracode: false, workflowActive: true }]]);
  const rows: [string, Condition, string, string][] = [
    ['absent', 'absent', '2.1.283', 'busy'],
    ['unreadable', 'unreadable', '2.1.283', 'busy'],
    ['torn once (2.1.283 counts the workflow)', 'torn once', '2.1.283', 'idle'],
    ['torn twice', 'torn twice', '2.1.283', 'busy'],
    ['well formed at 2.1.283 (it counts the workflow)', 'well formed', '2.1.283', 'idle'],
    ['well formed at 2.1.276 (below the floor, the row speaks)', 'well formed', '2.1.276', 'busy'],
  ];

  it.each(rows)('%s: an idle body under a running Workflow row', async (_title, c, version, status) => {
    const fleet = await assemble(ioFor(c, body('idle', version)), workflow);
    expect(fleet.find((x) => x.id === ID)!.status).toBe(status);
  });
});

describe('the two live verdicts have one home: livestate.ts re-exports liveVerdicts.ts\'s bindings (D-7512)', () => {
  it('liveSessionStatus and liveStatusCoversDelegation are the same functions through either module', async () => {
    const verdicts = await import('../src/liveVerdicts.js');
    const livestate = await import('../src/livestate.js');
    expect(livestate.liveSessionStatus).toBe(verdicts.liveSessionStatus);
    expect(livestate.liveStatusCoversDelegation).toBe(verdicts.liveStatusCoversDelegation);
  });
});

// D-7512, the seam: the live fields come from the reader `assembleFleet` is handed, never from `io`. Each row hands a
// reader that disagrees with what `io` holds, so a read that went round the port to `io` reds here.
describe('assembleFleet: the live fields come from the handed reader, never from io (D-7512)', () => {
  it('io holds no live file, the reader answers a well-formed idle at 2.1.283: the row reads the reader\'s state', async () => {
    const idle: LiveStateRead = { ok: true, state: {
      pid: PID, sessionId: '3'.repeat(36), cwd: `/data/projects/${ID}`, name: 'from the reader', nameSource: 'chosen',
      status: 'idle', statusUpdatedAt: 1784600000001, startedAt: null, version: '2.1.283', waitingFor: null,
    } };
    const fleet = await assembleFleet(localIO, cfg, tmux, async () => idle);
    expect(project(fleet.find((x) => x.id === ID)!)).toEqual({
      status: 'idle', name: 'from the reader', statusUpdatedAt: 1784600000001, version: '2.1.283',
      statusUnmeasured: false, dialogPending: false, askSummary: null,
    });
  });

  it('io holds a well-formed file, the reader answers unmeasured: the row is busy and declared unmeasured', async () => {
    const unmeasured: LiveStateRead = { ok: false, reason: 'unmeasured' };
    const fleet = await assembleFleet(bodiesIO([body('idle', '2.1.283')]), cfg, tmux, async () => unmeasured);
    expect(project(fleet.find((x) => x.id === ID)!)).toEqual({ status: 'busy', ...NOTHING, statusUnmeasured: true });
  });
});
