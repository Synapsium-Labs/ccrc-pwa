import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
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

/** Server over a seeded one-session registry; capture-pane returns scripted panes in order (last repeats).
 *  `status` seeds the authoritative live status file (used by the interrupt route). `panes` may be a
 *  function of `home` when a test needs a clip path scripted into the pane text — `home` is a fresh
 *  mkdtemp dir created inside this call, so it can't be known before calling. */
async function makeApp(
  panes: (string | null)[] | ((home: string) => (string | null)[]),
  opts: { status?: 'busy' | 'idle' } = {},
): Promise<{ app: FastifyInstance; calls: string[][]; bus: Bus; home: string }> {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
  const resolvedPanes = typeof panes === 'function' ? panes(home) : panes;
  seedSession(home, ID, 'claude2');
  const PANE_PID = 4242;
  if (opts.status) {
    const sdir = path.join(home, '.claude-personal', 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, `${PANE_PID}.json`), JSON.stringify({
      pid: PANE_PID, sessionId: '1'.repeat(36), cwd: `/data/projects/${ID}`,
      name: 'mek', status: opts.status, statusUpdatedAt: 1784600000000, version: '2.1.216',
    }));
  }
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = resolvedPanes[Math.min(capIdx, resolvedPanes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PANE_PID}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const bus = new Bus();
  const app = await buildServer({ cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io: localIO }, bus);
  return { app, calls, bus, home };
}

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');

/** An empty input box — capture-pane before/after any injection attempt. */
const EMPTY_BOX = '❯ \n';

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
    // Three panes: empty box, the echo verify, then the emptied box that proves
    // Enter submitted (see sendPrompt's post-Enter check).
    const { app, calls } = await makeApp(['scrollback\n❯ \n', 'scrollback\n❯ hello\n', 'scrollback\n❯ \n']);
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

  it('POST interrupt on a busy session (live status) sends Escape', async () => {
    const { app, calls } = await makeApp(['generation…\n❯ \n'], { status: 'busy' });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/interrupt`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Escape']]);
    await app.close();
  });

  it('POST interrupt on an idle session returns 409 not-busy', async () => {
    const { app } = await makeApp(['❯ \n'], { status: 'idle' });
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

describe('prompt route attachment handling', () => {
  it('rejects an attachment outside this session’s clips dir', async () => {
    const { app, home } = await makeApp([EMPTY_BOX]);
    for (const bad of [
      '/etc/passwd',
      '/home/u/.cc-clips/other-session/clip-20260726-150340-a1b2.png',
      `${home}/.cc-clips/${ID}/../../x/clip-20260726-150340-a1b2.png`,
    ]) {
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${ID}/prompt`,
        payload: { text: 'hi', attachments: [bad] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('bad-attachment');
    }
    await app.close();
  });

  it('rejects a fifth attachment', async () => {
    const { app, home } = await makeApp([EMPTY_BOX]);
    const many = Array.from({ length: 5 }, (_, i) =>
      `${home}/.cc-clips/${ID}/clip-20260726-15034${i}-a1b2.png`);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi', attachments: many },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-attachment');
    await app.close();
  });

  // `home` is a fresh mkdtemp dir created inside makeApp, so the clip path (which
  // must resolve under it) can only be built from the `home` the callback receives.
  const clipOf = (home: string) => `${home}/.cc-clips/${ID}/clip-20260726-150340-a1b2.png`;

  it('accepts a staged attachment alongside text, typed as one turn', async () => {
    const { app, calls, home } = await makeApp((home) => [
      'scrollback\n❯ \n',
      `scrollback\n❯ ${clipOf(home)}\n`,
      'scrollback\n❯ \n',
    ]);
    const clip = clipOf(home);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`,
      payload: { text: 'what is this', attachments: [clip] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', clip],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'M-Enter'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', 'what is this'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('accepts an image-only prompt (no text) when an attachment is present', async () => {
    const { app, calls, home } = await makeApp((home) => [
      'scrollback\n❯ \n',
      `scrollback\n❯ ${clipOf(home)}\n`,
      'scrollback\n❯ \n',
    ]);
    const clip = clipOf(home);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`,
      payload: { text: '', attachments: [clip] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', clip],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('still rejects an empty prompt with no attachments', async () => {
    const { app } = await makeApp([EMPTY_BOX]);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-request');
    await app.close();
  });
});

describe('upload route id handling', () => {
  const png = (name = 'shot.png') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(8)], { type: 'image/png' }), name);
    return form;
  };

  it('stages a picked image and returns where it landed', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/upload`, payload: png(),
    });
    expect(res.statusCode).toBe(200);
    const clip = res.json().clip as { path: string; name: string; bytes: number };
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
    expect(clip.path).toContain(`/.cc-clips/${ID}/`);
  });

  it('refuses a traversing session id before touching the filesystem', async () => {
    const { app } = await makeApp([null]);
    for (const bad of ['..%2F..%2F.ssh', '%2Fetc', '..']) {
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${bad}/upload`, payload: png(),
      });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.json().ok).toBe(false);
    }
  });

  it('404s an unknown but well-formed session', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/claude2-NoSuchProject/upload', payload: png(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown-session');
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
