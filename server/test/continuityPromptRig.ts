// The console's prompt route over a one-session registry and a real coord.db, for the renewal hand-offs' tests (Overlord
// W1a, plan `w1a-renewal-handoffs.md` Tasks 2 and 3): the pane answers an empty box, the echo, then the emptied box, so a
// prompt types and submits. Fixture HOMEs only.
import { afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { GenerationState } from '../../shared/continuity.js';
import { seedRoster } from './helpers.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

export const PROMPT_ID = 'claude-a-project-f';
const U1 = '1'.repeat(36);

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  removeTmpFixtures();
});

/** The server over a one-session registry and a real store; the pane answers an empty box, the echo, then the emptied box. */
export async function promptRig(id: string = PROMPT_ID): Promise<{ app: FastifyInstance; coord: CoordStore; calls: string[][]; time: FakeTime }> {
  const home = mkTmp('ccrc-prompt-renewing-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: id, workdir: `/data/projects/${id}`, uuid: U1, started: '1' })) {
    writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
  const panes = ['scrollback\n❯ \n', 'scrollback\n❯ hello\n', 'scrollback\n❯ \n'];
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx += 1;
      return { ran: true, code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const time = fakeTime();
  const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
    time: time.ports, coord }, new Bus());
  await app.ready();
  apps.push(app);
  return { app, coord, calls, time };
}

/** One generation of the session, its `state` and `shadowState` set as a walk would leave them. */
export function generationIn(coord: CoordStore, state: GenerationState, shadowState: GenerationState | null = null): void {
  const s = coord.insertStart({ sessionId: PROMPT_ID, reportId: 'r-1', uuid: U1, source: 'startup', model: null, rowIncarnation: 'inc',
    reportedAt: 1, receivedAt: 1 });
  if (!s.ok) throw new Error('start not recorded');
  const w = coord.mintGeneration({ identity: PROMPT_ID, sessionId: PROMPT_ID, role: 'coordinator', term: 1, rowIncarnation: 'inc',
    startId: s.id, startReportedAt: 1, resumed: false, model: null, lane: 'claude-a', host: null, outcome: 'woken', mono: 1, proc: 'p1',
    now: 1 }, null, true);
  if (!w.ok) throw new Error(`mint: ${w.kind}`);
  coord.db.prepare('UPDATE continuity_generations SET state = ?, shadowState = ?, walk = ? WHERE id = ?')
    .run(state, shadowState, shadowState === null ? 'live' : 'shadow', w.id);
}

