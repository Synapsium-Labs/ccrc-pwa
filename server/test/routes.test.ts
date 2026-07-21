import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Bus } from '../src/bus.js';
import type { SessionStreamMsg } from '../../shared/api.js';

const ID = 'claude2-MekWarLive';

const seedSession = (home: string, id: string, wrapper: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** Server over a seeded one-session registry; capture-pane returns scripted panes in order (last repeats). */
async function makeApp(panes: (string | null)[]): Promise<{ app: FastifyInstance; calls: string[][]; bus: Bus }> {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
  seedSession(home, ID, 'claude2');
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const bus = new Bus();
  const app = await buildServer({ cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run) }, bus);
  return { app, calls, bus };
}

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');

const OPTS = ['A + B drawer (Recommended)', 'A pure', 'B first, A later', 'Other'];
function menuPane(selected: number): string {
  const lines = ['● Which architecture should we go with?', ''];
  OPTS.forEach((label, i) => {
    const n = i + 1;
    lines.push(`${n === selected ? '❯' : ' '} ${n}. ${label}`);
  });
  lines.push('', 'Enter to confirm · Esc to cancel');
  return lines.join('\n') + '\n';
}
const DIALOG_ID = parseDialog(menuPane(1))!.id;

describe('write routes', () => {
  it('POST prompt happy path returns 200 {ok:true}', async () => {
    const { app, calls } = await makeApp(['scrollback\n❯ \n', 'scrollback\n❯ hello\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', 'hello'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('POST prompt with a draft present returns 409 with the draft in the body', async () => {
    const { app } = await makeApp(['❯ half-typed thought\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'draft-present', draft: 'half-typed thought' });
    await app.close();
  });

  it('POST dialog happy path walks and confirms', async () => {
    const { app, calls } = await makeApp([menuPane(1), menuPane(2)]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/dialog`,
      payload: { dialogId: DIALOG_ID, optionIndex: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Down'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('POST dialog with a stale id returns 409', async () => {
    const { app, calls } = await makeApp([menuPane(1)]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/dialog`,
      payload: { dialogId: 'deadbeef', optionIndex: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  it('POST interrupt on a busy pane sends Escape', async () => {
    const { app, calls } = await makeApp(['✻ Pondering… (esc to interrupt)\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/interrupt`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Escape']]);
    await app.close();
  });

  it('POST interrupt on an idle pane returns 409 not-busy', async () => {
    const { app } = await makeApp(['❯ \n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/interrupt`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-busy' });
    await app.close();
  });

  it('unknown session id returns 404 on all three routes', async () => {
    const { app } = await makeApp(['❯ \n']);
    for (const [url, payload] of [
      ['/api/sessions/nope/prompt', { text: 'hi' }],
      ['/api/sessions/nope/dialog', { dialogId: 'x', optionIndex: 1 }],
      ['/api/sessions/nope/interrupt', {}],
    ] as const) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});

describe('notify ingestion', () => {
  it('POST /api/notify with a swap message emits notice and the session event', async () => {
    const { app, bus } = await makeApp(['❯ \n']);
    const notices: string[] = [];
    const sessionMsgs: SessionStreamMsg[] = [];
    bus.on('notice', (n) => notices.push(n.message));
    bus.on(`session:${ID}`, (m) => sessionMsgs.push(m));
    const message = `cc swap: ${ID} moved claude2 -> claude (limits) — reopen it on claude.ai under the claude account`;
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(notices).toEqual([message]);
    expect(sessionMsgs).toEqual([{ type: 'notice', message }]);
    await app.close();
  });

  it('POST /api/notify with a non-swap message emits only notice', async () => {
    const { app, bus } = await makeApp(['❯ \n']);
    const notices: string[] = [];
    const sessionMsgs: SessionStreamMsg[] = [];
    bus.on('notice', (n) => notices.push(n.message));
    bus.on(`session:${ID}`, (m) => sessionMsgs.push(m));
    const message = 'deploy finished on server-box';
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(notices).toEqual([message]);
    expect(sessionMsgs).toEqual([]);
    await app.close();
  });
});
