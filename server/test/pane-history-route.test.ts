// GET /api/sessions/:id/pane/history — the terminal drawer's scrollback.
//
// The drawer attaches with `tmux attach`, which puts the CLIENT on the
// alternate screen; xterm has no scrollback there and turns the wheel into
// arrow keys aimed at the pane. The pane is NOT in alt mode and tmux holds its
// history, so the drawer reads that history instead of driving the pane.
//
// Everything pinned here is about the READ staying a read, and about the three
// answers staying three: content, gone, and could-not-look.
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type ExecResult, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { KeyedQueue } from '../src/inject/queue.js';

const ID = 'claude-a-MekWarLive';

async function makeApp(capture: ExecResult): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const home = mkTmp('ccrc-pane-history-');
  seedRoster(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') return capture;
    return { code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() },
    new Bus(),
  );
  return { app, calls };
}

const HISTORY = 'older output\nolder still\n';

describe('GET /api/sessions/:id/pane/history', () => {
  it('reads the pane history with capture-pane and answers it verbatim', async () => {
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, text: HISTORY, lines: 2000 });
    // THE ARGV IS THE GUARD. `-p` to stdout, `-e` so the history keeps the
    // colours it was written in, `-S -2000` to start above the screen. It is
    // reachable under the agent's existing `['capture-pane']` grant — nothing
    // here widens the closed exec surface, so this change never has to ship to
    // the fleet host ahead of the server.
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-S', '-2000'],
    ]);
    await app.close();
  });

  it('mutates nothing on the pane — no copy-mode, no send-keys, no resize', async () => {
    // The alternative fixes all put the PANE in copy mode, which is shared with
    // every other attached client and, measured against tmux 3.4, makes
    // `send-keys -l` hang for as long as it lasts. This route must stay a read:
    // one capture-pane and nothing else.
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(calls.map((c) => c[1])).toEqual(['capture-pane']);
    await app.close();
  });

  it('tells a dead pane (404) apart from a tmux that could not answer (502)', async () => {
    // tmux 3.4's own message for a session that is not there, measured.
    const gone = await makeApp({ code: 1, stdout: '', stderr: "can't find pane: cc-nope\n" });
    const goneRes = await gone.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(goneRes.statusCode).toBe(404);
    expect(goneRes.json()).toEqual({ ok: false, error: 'gone' });
    await gone.app.close();

    // Anything else is UNKNOWN, never death: an unrecognised future tmux error
    // must read as "we could not look", with the reason carried out to the
    // reader rather than collapsed into the same 404.
    const down = await makeApp({ code: 1, stdout: '', stderr: 'error connecting to /tmp/tmux-1000/default (No such file or directory)\n' });
    const downRes = await down.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(downRes.statusCode).toBe(502);
    expect(downRes.json()).toEqual({
      ok: false,
      error: 'unmeasured',
      detail: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
    });
    await down.app.close();
  });

  it('a failure with nothing to say still says something', async () => {
    const { app } = await makeApp({ code: 3, stdout: '', stderr: '' });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'unmeasured', detail: 'tmux exited 3 with no message' });
    await app.close();
  });

  it('refuses a session id that is not one, before tmux is reached at all', async () => {
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/..%2Fetc/pane/history' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(calls).toEqual([]);
    await app.close();
  });
});
