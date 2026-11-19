// Approvals PR 2 (plan 2026-11-18, Task 2.1; Table 2a, path 6): the session stream sends the approval surface for a
// subagent's painted permission menu. Hook state's `ask` was erased by a sibling's event, but the hook's per-agent list
// keeps the prompt, and while the pane paints that prompt's menu the stream's `ask` frame is the entry
// (`paintedApprovalOf`), marked `thread: 'subagent'`; when the menu clears, so does the envelope. One real
// `SessionStream` over a seeded home (the Q3g harness's shape, `askPairingStream.ts`), polled by hand, never sleeping.
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;
const pane = (name: string): string => readFileSync(path.join(__dirname, 'fixtures', 'panes', `${name}.txt`), 'utf8');
/** The recorded Bash prompt (its command `touch rigfile.txt`), and the busy pane with no menu. */
const PERMISSION = pane('cc280-permission-wrapped-100');
const BUSY = pane('busy');
const ENTRY = { agentId: 'a0000000000000001', tool: 'Bash', summary: 'touch rigfile.txt', route: 'sent', at: 1_786_000_000_000 };

type Step = { pane: string; hook: Record<string, unknown> | null };
async function run(steps: Step[]): Promise<Array<{ step: number; frame: SessionStreamMsg }>> {
  const home = mkTmp('ccrc-aprenv-stream-');
  try {
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' })) {
      writeFileSync(path.join(reg, `${ID}.${k}`), v);
    }
    const sess = path.join(home, '.claude-a', 'sessions');
    mkdirSync(sess, { recursive: true });
    writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.300',
    }));
    const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
    mkdirSync(tdir, { recursive: true });
    writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), '');
    const hookFile = path.join(reg, `${ID}.hookstate.json`);
    let current = BUSY;
    const runner: Runner = async (_cmd, args) => {
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: current, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { cfg, runCcd: ccdRunner(runner, cfg), tmux: new Tmux(runner), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports, coord };
    const set = (s: Step): void => {
      current = s.pane;
      if (s.hook === null) rmSync(hookFile, { force: true });
      else writeFileSync(hookFile, JSON.stringify({ v: 1, sessionId: UUID_A, pid: PID, updatedAt: Date.now(), subagents: [], ...s.hook }));
    };
    const out: Array<{ step: number; frame: SessionStreamMsg }> = [];
    let step = 0;
    set(steps[0]!);
    const stream = new SessionStream(deps, new Bus(), ID, (m) => {
      if (m.type === 'ask' || m.type === 'ask_cleared' || m.type === 'dialog' || m.type === 'dialog_cleared') out.push({ step, frame: m });
    }, undefined, NO_TICK);
    try {
      await stream.start();
      for (let i = 0; i < steps.length; i++) {
        step = i + 1;
        set(steps[i]!);
        await (stream as unknown as { tick: () => Promise<void> }).tick();
        await (stream as unknown as { feed?: { poll(): Promise<void> } }).feed?.poll();
      }
    } finally { stream.stop(); }
    return out;
  } finally { rmSync(home, { recursive: true, force: true }); }
}

const asks = (frames: Array<{ step: number; frame: SessionStreamMsg }>) =>
  frames.filter((f) => f.frame.type === 'ask' || f.frame.type === 'ask_cleared')
    .map((f) => [f.step, f.frame.type, f.frame.type === 'ask' ? (f.frame as { ask: unknown }).ask : null]);

describe('the session stream sends a subagent\'s painted prompt as the approval surface', () => {
  it('ask erased, the entry kept: the painted menu\'s ask frame is the entry, marked a subagent\'s; the clear clears it', async () => {
    const erased = { state: 'working', event: 'PostToolUse', ask: null, approvals: [ENTRY] };
    const frames = await run([{ pane: PERMISSION, hook: erased }, { pane: PERMISSION, hook: erased }, { pane: BUSY, hook: erased }]);
    const sub = { approval: { tool: 'Bash', summary: 'touch rigfile.txt', thread: 'subagent' } };
    expect(asks(frames)).toEqual([[0, 'ask', sub], [3, 'ask_cleared', null]]);
  });
  it('an entry for another command leaves the bare menu, exactly as before', async () => {
    const other = { state: 'working', event: 'PostToolUse', ask: null, approvals: [{ ...ENTRY, summary: 'git push origin main' }] };
    const frames = await run([{ pane: PERMISSION, hook: other }]);
    expect(asks(frames)).toEqual([[0, 'ask_cleared', null]]);
  });
});
