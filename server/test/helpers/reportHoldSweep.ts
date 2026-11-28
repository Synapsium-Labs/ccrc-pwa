// The mail sweep's driving rig, shared by the suites that watch what the lane types: a fixture HOME with a seeded registry row, a
// tmux double that records every call, a real `FleetWatcher` over a fixture coord.db, and the helpers that queue mail, run sweeps
// past every back-off and read the delivery row. `overlord-report-hold.test.ts` drives the report row through it and
// `mail-prompt-forms.test.ts` drives every row the forms census leaves out (the rows whose `hold` is `acked`).
// The caller owns the clock (`vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(NOW)`) and `removeTmpFixtures()`.
import { vi, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../../src/server.js';
import type { Runner } from '../../src/exec.js';
import { Bus } from '../../src/bus.js';
import { openCoordDb } from '../../src/coord/db.js';
import { CoordStore } from '../../src/coord/store.js';
import { FleetWatcher } from '../../src/watch.js';
import type { FixedLineMailRow } from '../../src/coord/envelope.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import { testDeps, withFakeClock } from '../helpers.js';
import { mkTmp } from '../tmpHelpers.js';
import { quietAtTestEnd } from '../laneQuiet.js';

export const ID = 'lane-a-project-a';
export const PEER = 'lane-b-project-a';
export const UUID = 'a'.repeat(36);
export const PID = 4242;
export const NOW = 1_800_000_000_000;
export const MAIL_QUIET_MS = 60_000;
export const MAIL_REPLAY_MS = 600_000;
export const MAIL_SWEEP_MS = 10_000;
export const emptyBox = '❯ \n';
export const echoedBox = (text: string): string => `❯ ${text}\n`;

export const seedRegistry = (home: string, id = ID, pid = PID, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' })) writeFileSync(path.join(reg, `${id}.${k}`), v);
  writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify({ v: 1, state: 'done', sessionId: uuid, pid, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [] }));
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: uuid, cwd: '/w/demo', name: null, nameSource: null, status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220' }));
};

/** A tmux double: every call recorded, the pane answers the scripted boxes in order (the last one repeats). `dead`: no tmux session. */
export const lane = (panes: string[], dead = false) => {
  const home = mkTmp('ccrc-report-hold-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { ran: true, code: dead ? 1 : 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: dead ? 1 : 0, stdout: dead ? '' : `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') { const pane = panes[Math.min(capIdx, panes.length - 1)] ?? ''; capIdx++; return { ran: true, code: 0, stdout: pane, stderr: '' }; }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};
export const literalSends = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[5]!);
export const keyPresses = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] !== '-l').map((a) => a[3]!);
export const sendCalls = (calls: string[][]): string[][] => calls.filter((a) => a[0] === 'send-keys' || a[0] === 'paste-buffer' || a[0] === 'load-buffer');

export const primed = async (panes: string[], o: { seed?: boolean; dead?: boolean; over?: Partial<Deps> } = {}) => {
  const h = lane(panes, o.dead === true);
  const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(h.home, h.run), coord, ...(o.over ?? {}) } as Deps;
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
  await w.tick();
  if (o.seed !== false) seedRegistry(h.home);
  return { h, coord, w };
};

export const designate = (coord: CoordStore, id: string): void => {
  coord.designationRead = () => ({ kind: 'designated', sessionId: id, term: 1,
    row: { bound: { sessionId: id, generation: 'inc-1' }, pending: null, term: 1, designatedTerm: 1 } }) as unknown as DesignationRead;
};

export const queueMail = (coord: CoordStore, fromId: string, toId: string, session: string, subject: string): { mailId: number; id: number } => {
  const mail = coord.insertMail({ fromId, fromUuid: fromId, toId, runId: null, kind: 'status', subject, body: 'b', artifacts: [] });
  return { mailId: mail.id, id: coord.queueDelivery(mail.id, session, 'ccrc-mail test payload').id };
};
export const rowOf = (coord: CoordStore, id: number): Record<string, unknown> =>
  coord.db.prepare('SELECT * FROM mail_deliveries WHERE id = ?').get(id) as Record<string, unknown>;

/** The next sweep: the clock past every back-off, the replay window and the lane's cadence. */
export const sweepFar = async (w: FleetWatcher): Promise<void> => { vi.setSystemTime(Date.now() + MAIL_REPLAY_MS + MAIL_SWEEP_MS + 1); await w.sweepMail(); };
export const sweepMany = async (w: FleetWatcher, n: number): Promise<void> => { for (let i = 0; i < n; i++) await sweepFar(w); };

/** The delivery is as untouched as a never-swept one: the whole row equal, every column (gate stamp, attempts, times, park). */
export const expectUntouched = (coord: CoordStore, id: number, before: Record<string, unknown>): void => {
  const now = rowOf(coord, id);
  expect(now).toEqual(before);
  expect(now.state).toBe('queued');
  expect(now.attempts).toBe(0);
  expect(now.lastGate).toBeNull();
  expect(now.deliveredAt).toBeNull();
  expect(now.parkedAt ?? null).toBeNull();
};

/**
 * A mail the given held row's `matches` accepts, built from the row's hold WORD (never its name): a row that holds until acked
 * is a report, a session sender's mail to the role. A hold word with no builder, or a built mail the row does not match, throws,
 * so a new hold word cannot slip past the suites that drive its rows.
 */
export const mailForHeldRow = (row: FixedLineMailRow): { fromId: string; toId: string; subject: string } => {
  const built = ((): { fromId: string; toId: string; subject: string } => {
    switch (row.hold) {
      case 'acked': return { fromId: PEER, toId: 'overlord', subject: 'report: request 7 is done' };
      default: throw new Error(`no mail builder for a row whose hold is ${String(row.hold)} (row ${row.name})`);
    }
  })();
  if (!row.matches({ fromId: built.fromId, subject: built.subject, mailToId: built.toId })) throw new Error(`the built mail is not matched by the row ${row.name}`);
  return built;
};

/** Queue `mail` as one delivery to the lane's session, the origin being the mail row itself. */
export const queueBuilt = (coord: CoordStore, mail: { fromId: string; toId: string; subject: string }, session: string = ID): { mailId: number; id: number } =>
  queueMail(coord, mail.fromId, mail.toId, session, mail.subject);
