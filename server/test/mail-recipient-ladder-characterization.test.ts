// D-8610, the characterization commit: the mail pass's recipient ladder, the rung after the registry's, as it stands
// before it reads the session through `readSession`. Per row of tmux's pane verdict, the `.hibernated` marker and the
// lifecycle the registry gives a gone pane: the gate the delivery records, whether its attempt counts, and whether the
// pass asks `ccd ensure` to wake it. Green on the old code; the move commit changes none of it.
//
// The rows a `.hibernated` marker sits beside a lifecycle other than `stopped` are the ones the mail pass reads apart
// from `readSession`: the mail pass holds and wakes any gone pane with the marker (D-5242), where `readSession` calls only
// a stopped one asleep. `ccd hibernate` writes the two together, so the rows are rare; they are pinned here so the move
// keeps them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import { quietAtTestEnd } from './laneQuiet.js';

const ID = 'demo-recipient';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000;
const PAST_SWEEP_MS = 11_000;

type Pane = 'live' | 'gone' | 'unknown';
/** The lifecycle a gone pane reads, by what the registry holds: a stop stamp, a fresh supervisor heartbeat, a started
 *  row with neither, a row never started, or a lifecycle field listed but unreadable. */
type Life = 'stopped' | 'restarting' | 'orphan' | 'never-started' | 'unmeasurable';

interface Row { pane: Pane; hibernated: boolean; life: Life }
interface Answer { gate: string | null; attempts: number; state: string; woken: boolean }

const reg = (home: string): string => path.join(home, '.cc-sessions');
const put = (home: string, field: string, body: string): void => writeFileSync(path.join(reg(home), `${ID}.${field}`), body);

function seed(home: string, r: Row): void {
  const sec = Math.floor(NOW / 1000);
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID })) put(home, k, v);
  put(home, 'started', r.life === 'never-started' ? '0' : '1');
  if (r.life === 'stopped') put(home, 'stopped', `${sec} ccd`);
  if (r.life === 'restarting') put(home, 'supervised', String(sec));
  if (r.hibernated) put(home, 'hibernated', `${sec - 7 * 3600} 7`);
}

async function sweep(r: Row): Promise<Answer> {
  const home = mkTmp('ccrc-mail-ladder-');
  mkdirSync(reg(home), { recursive: true });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') {
      if (r.pane === 'live') return { ran: true, code: 0, stdout: '', stderr: '' };
      return { ran: true, code: 1, stdout: '', stderr: r.pane === 'gone' ? "can't find session: cc-x\n" : 'protocol version mismatch\n' };
    }
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  const ensures: string[] = [];
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const deps: Deps = {
    ...base, coord,
    ...(r.life === 'unmeasurable' ? { io: unreadableField(ID, 'started') } : {}),
    runCcd: async (a) => {
      if (a[0] === 'ensure') ensures.push(a[1] ?? '');
      return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null };
    },
  };
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
  await w.tick();
  seed(home, r);
  const mail = coord.insertMail({ fromId: 'demo-sender', fromUuid: 'b'.repeat(36), toId: ID, runId: null,
    kind: 'finding', subject: 'hi', body: 'payload', artifacts: [] });
  const { id } = coord.queueDelivery(mail.id, ID, 'payload');
  vi.setSystemTime(Date.now() + PAST_SWEEP_MS);
  await w.sweepMail();
  const row = coord.db.prepare('SELECT lastGate, attempts, state FROM mail_deliveries WHERE id = ?').get(id) as
    { lastGate: string | null; attempts: number; state: string };
  return { gate: row.lastGate, attempts: row.attempts, state: row.state, woken: ensures.includes(ID) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

const LIVES: readonly Life[] = ['stopped', 'restarting', 'orphan', 'never-started', 'unmeasurable'];
const held = (gate: string): Answer => ({ gate, attempts: 0, state: 'queued', woken: false });

describe('the mail pass\'s recipient ladder (D-8610 characterization)', () => {
  it.each(LIVES)('a live pane reads on past the ladder, whatever the lifecycle or marker (%s)', async (life) => {
    for (const hibernated of [false, true]) {
      const a = await sweep({ pane: 'live', hibernated, life });
      expect(['hibernated', 'wake-pressure', 'tmux-gone', 'session-dead', 'tmux-unknown'], `${life} hibernated=${hibernated}`).not.toContain(a.gate);
      expect(a.woken).toBe(false);
    }
  });

  it.each(LIVES)('a tmux that did not answer is tmux-unknown, never woken, whatever the lifecycle or marker (%s)', async (life) => {
    for (const hibernated of [false, true]) {
      expect(await sweep({ pane: 'unknown', hibernated, life }), `hibernated=${hibernated}`)
        .toMatchObject({ gate: 'tmux-unknown', attempts: 0, state: 'queued', woken: false });
    }
  });

  it('a gone pane with no marker: a dead lifecycle is session-dead and counts; a restarting or unmeasurable one waits tmux-gone', async () => {
    const answers: Record<string, Answer> = {};
    for (const life of LIVES) answers[life] = await sweep({ pane: 'gone', hibernated: false, life });
    expect(answers).toEqual({
      stopped: { gate: 'session-dead', attempts: 1, state: 'queued', woken: false },
      restarting: held('tmux-gone'),
      orphan: { gate: 'session-dead', attempts: 1, state: 'queued', woken: false },
      'never-started': { gate: 'session-dead', attempts: 1, state: 'queued', woken: false },
      unmeasurable: held('tmux-gone'),
    });
  });

  it('a gone pane with the marker is held hibernated and woken, whatever the lifecycle beside it (D-5242)', async () => {
    const answers: Record<string, Answer> = {};
    for (const life of LIVES) answers[life] = await sweep({ pane: 'gone', hibernated: true, life });
    const woken: Answer = { gate: 'hibernated', attempts: 0, state: 'queued', woken: true };
    expect(answers).toEqual({ stopped: woken, restarting: woken, orphan: woken, 'never-started': woken, unmeasurable: woken });
  });
});
