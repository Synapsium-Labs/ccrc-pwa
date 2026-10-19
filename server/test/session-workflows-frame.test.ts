// The session socket's `workflows` frame (D-5560): fed by `checkWorkflows` on
// the same 2 s tick and cold start as the tasks frame, deduped on its JSON,
// silent for a session that never ran a workflow. Neutral fixture names.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-a-project-a';
const UUID = 'c'.repeat(36);
const WORKDIR = '/work/project-a';
const MUNGED = '-work-project-a';
const PID = 51515;
const RUN = 'wf_00000000-aaa';
const key = (i: number): string => `v2:${i.toString(16).padStart(64, '0')}`;
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;

let home: string;
let S: string;
const now = Date.now();
beforeEach(() => {
  home = mkTmp('ccrc-sws-wf-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: 'project-a', workdir: WORKDIR, uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: WORKDIR, name: 'project-a', status: 'busy', statusUpdatedAt: now, version: '2.1.302',
    startedAt: now - 600_000,
  }));
  const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID}.jsonl`), line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } }));
  S = path.join(tdir, UUID);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const seedRunning = (): void => {
  const dir = path.join(S, 'subagents', 'workflows', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'journal.jsonl'), [
    line({ type: 'launched' }),
    line({ type: 'started', key: key(1), agentId: 'a1', label: 'build', phase: 'Build' }),
    line({ type: 'result', key: key(1), agentId: 'a1', result: { ok: true } }),
    line({ type: 'started', key: key(2), agentId: 'a2', label: 'verify', phase: 'Verify' }),
  ].join(''));
  const scripts = path.join(S, 'workflows', 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(path.join(scripts, `example-flow-${RUN}.js`), "export const meta = { name: 'example-flow', phases: [{ title: 'Build' }, { title: 'Verify' }] };\n");
};

const runner = (opts: { gone?: boolean } = {}): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') {
    return opts.gone ? { code: 1, stdout: '', stderr: `can't find session: ${ID}` } : { code: 0, stdout: '', stderr: '' };
  }
  if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

const open = (opts: { gone?: boolean } = {}): { stream: SessionStream; frames: SessionStreamMsg[] } => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const run = runner(opts);
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() };
  const frames: SessionStreamMsg[] = [];
  return { stream: new SessionStream(deps, new Bus(), ID, (m) => frames.push(m)), frames };
};
const wfFrames = (frames: SessionStreamMsg[]): Array<SessionStreamMsg & { type: 'workflows' }> =>
  frames.filter((f): f is SessionStreamMsg & { type: 'workflows' } => f.type === 'workflows');

describe('the workflows frame (D-5560)', () => {
  it('on connect, a running workflow is sent with its facts', async () => {
    seedRunning();
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    const sent = wfFrames(frames);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.unreadable).toBeUndefined();
    expect(sent[0]!.workflows).toMatchObject([{ id: RUN, name: 'example-flow', state: 'running', done: 1, total: 2, phase: 'Verify', phases: ['Build', 'Verify'] }]);
  });

  it('a session that never ran a workflow sends no workflows frame at all', async () => {
    const { stream, frames } = open();
    try {
      await stream.start();
      await (stream as unknown as { checkWorkflows(f: string, p: unknown): Promise<void> }).checkWorkflows(`${S}.jsonl`, { kind: 'live', startedAt: now - 600_000 });
    } finally { stream.stop(); }
    expect(wfFrames(frames)).toEqual([]);
  });

  it('a session whose workflows all finished states the empty list on connect — a reconnecting client\'s old rows are cleared', async () => {
    seedRunning();
    const { stream, frames } = open({ gone: true }); // nothing running: the run is interrupted
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames)).toEqual([{ type: 'workflows', workflows: [] }]);
  });

  it('no workflow directory while the hook lists a background workflow: unreadable, not "none"', async () => {
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'done', event: 'Stop', sessionId: UUID, pid: PID, updatedAt: now, ask: null, subagents: [],
      graphQueries: 0, graphGateDenials: 0, bgDelegated: 1, bgDelegatedKinds: 'workflow',
    }));
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames)).toEqual([{ type: 'workflows', workflows: [], unreadable: true }]);
  });


  it('an unchanged read sends nothing; a change sends the new rows', async () => {
    seedRunning();
    const { stream, frames } = open();
    const check = (s: SessionStream): Promise<void> =>
      (s as unknown as { checkWorkflows(f: string, p: unknown): Promise<void> }).checkWorkflows(`${S}.jsonl`, { kind: 'live', startedAt: now - 600_000 });
    try {
      await stream.start();
      await check(stream);
      const j = path.join(S, 'subagents', 'workflows', RUN, 'journal.jsonl');
      writeFileSync(j, `${[
        line({ type: 'launched' }),
        line({ type: 'started', key: key(1), agentId: 'a1', label: 'build', phase: 'Build' }),
        line({ type: 'result', key: key(1), agentId: 'a1', result: { ok: true } }),
        line({ type: 'started', key: key(2), agentId: 'a2', label: 'verify', phase: 'Verify' }),
      ].join('')}${line({ type: 'result', key: key(2), agentId: 'a2', result: 'r' })}`);
      utimesSync(j, new Date(), new Date());
      await check(stream);
    } finally {
      stream.stop();
    }
    expect(wfFrames(frames).map((f) => f.workflows[0]!.done)).toEqual([1, 2]);
  });

  it('a backlog resets the gate: the same rows are stated again after it (the client dropped them on that backlog)', async () => {
    seedRunning();
    const { stream, frames } = open();
    type Priv = {
      resolve(): Promise<{ ok: true; data: unknown } | { ok: false }>;
      sendBacklogAndTail(r: unknown): Promise<void>;
      checkWorkflows(f: string, p: unknown): Promise<void>;
    };
    const p = stream as unknown as Priv;
    try {
      await stream.start();
      const r = await p.resolve();
      if (!r.ok) throw new Error('fixture did not resolve');
      await p.sendBacklogAndTail(r.data);
      await p.checkWorkflows(`${S}.jsonl`, { kind: 'live', startedAt: now - 600_000 });
    } finally {
      stream.stop();
    }
    const sent = wfFrames(frames);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.workflows).toEqual(sent[0]!.workflows);
  });
});
