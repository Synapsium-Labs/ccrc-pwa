import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { nextDialogFrame, type DialogSeen } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { AskQuestion, Dialog } from '../../shared/api.js';

const ID = 'claude2-MekWarLive';
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const WORKDIR = '/data/projects/MekWarLive';
const MUNGED = '-data-projects-MekWarLive';
const PID = 40613;

const userLine = (uuid: string, text: string): string =>
  JSON.stringify({
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp: '2026-07-20T21:00:00.000Z',
    type: 'user',
    message: { role: 'user', content: text },
  }) + '\n';

/** Registry entry + live state + transcript A with two user messages. */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude2', project: 'MekWarLive', workdir: WORKDIR, uuid: UUID_A, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);

  const sess = path.join(home, '.claude-personal', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'mekwar-a1',
    status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));

  const tdir = path.join(home, '.claude-personal', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), userLine('u1', 'one') + userLine('u2', 'two'));
};

// Queue-based collector so no message is dropped between sequential awaits.
const collect = (ws: WebSocket) => {
  const queue: unknown[] = [];
  const waiters: Array<(m: unknown) => void> = [];
  ws.on('message', (d) => {
    const m: unknown = JSON.parse(String(d));
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return (timeoutMs = 3000): Promise<any> =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeoutMs);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
};

const opened = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

const ASK: AskQuestion = {
  question: 'Which fill strategy?',
  header: 'Backfill',
  multiSelect: false,
  options: [{ label: 'Forward-fill per class', description: 'per-class carry', preview: '07-01' }],
};

const menu = (over: Partial<Dialog> = {}): Dialog => ({
  id: 'abc123', title: 'Which fill strategy?', options: [
    { index: 1, label: 'Forward-fill per class' },
    { index: 2, label: 'Chat about this' },
  ],
  selectedIndex: 1, parsed: true, raw: 'pane', ...over,
});

const NONE: DialogSeen = { id: null, ask: null };

describe('dialog frame gate', () => {
  it('sends a menu the first time it is seen, and not again unchanged', () => {
    const first = nextDialogFrame(NONE, menu());
    expect(first.msg).toEqual({ type: 'dialog', dialog: menu() });
    expect(nextDialogFrame(first.seen, menu()).msg).toBeNull();
  });

  it('sends again — same id — when the ask only becomes readable on a later read', () => {
    const bare = nextDialogFrame(NONE, menu());
    expect((bare.msg as { dialog: Dialog }).dialog.ask).toBeUndefined();
    const rich = nextDialogFrame(bare.seen, menu({ ask: ASK }));
    expect(rich.msg).not.toBeNull();
    const d = (rich.msg as { dialog: Dialog }).dialog;
    expect(d.ask).toEqual(ASK);
    expect(d.id).toBe('abc123'); // id stays purely pane-derived
    // and the upgrade only fires once
    expect(nextDialogFrame(rich.seen, menu({ ask: ASK })).msg).toBeNull();
  });

  it('never downgrades: a read that lost the ask sends nothing and keeps it latched', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const missed = nextDialogFrame(rich.seen, menu());
    expect(missed.msg).toBeNull();
    expect(missed.seen.ask).toEqual(ASK);
  });

  it('a different menu resets the latch', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const next = nextDialogFrame(rich.seen, menu({ id: 'def456' }));
    expect((next.msg as { dialog: Dialog }).dialog.ask).toBeUndefined();
    expect(next.seen).toEqual({ id: 'def456', ask: null });
  });

  it('clears once when the menu vanishes, and stays quiet after', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const cleared = nextDialogFrame(rich.seen, null);
    expect(cleared.msg).toEqual({ type: 'dialog_cleared' });
    expect(cleared.seen).toEqual(NONE);
    expect(nextDialogFrame(cleared.seen, null).msg).toBeNull();
  });
});

describe('session WS', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;
  let fileA: string;
  let fileB: string;

  beforeEach(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-sws-'));
    seed(home);
    fileA = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    fileB = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_B}.jsonl`);

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps: Deps = { cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io: localIO };
    app = await buildServer(deps, new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  it('sends backlog, streams appended events, and follows uuid rotation', { timeout: 20_000 }, async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    const backlog = await next();
    expect(backlog.type).toBe('backlog');
    expect(backlog.uuid).toBe(UUID_A);
    expect(backlog.missing).toBe(false);
    expect(backlog.file).toBe(fileA);
    expect(backlog.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);
    expect(backlog.offset).toBe(statSync(fileA).size);

    appendFileSync(fileA, userLine('u3', 'three'));
    const ev = await next(6000);
    expect(ev.type).toBe('events');
    expect(ev.uuid).toBe(UUID_A);
    expect(ev.events).toHaveLength(1);
    expect(ev.events[0]).toMatchObject({ kind: 'user', uuid: 'u3', text: 'three' });
    expect(ev.offset).toBe(statSync(fileA).size);

    // Rotate: new transcript file, registry uuid flipped (clear/compact/swap).
    writeFileSync(fileB, userLine('r1', 'fresh transcript'));
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.uuid`), UUID_B);

    const rotated = await next(8000);
    expect(rotated).toEqual({ type: 'rotated', uuid: UUID_B });
    const backlog2 = await next(6000);
    expect(backlog2.type).toBe('backlog');
    expect(backlog2.uuid).toBe(UUID_B);
    expect(backlog2.file).toBe(fileB);
    expect(backlog2.events.map((e: { uuid: string }) => e.uuid)).toEqual(['r1']);

    ws.close();
  });

  it('reconnect with ?since=<uuid>:<offset> skips the backlog and resumes from the offset', { timeout: 15_000 }, async () => {
    const offset = statSync(fileA).size;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}?since=${UUID_A}:${offset}`);
    const next = collect(ws);
    await opened(ws);

    appendFileSync(fileA, userLine('u9', 'after resume'));
    const first = await next(6000);
    expect(first.type).toBe('events'); // no backlog on a matching `since` resume
    expect(first.uuid).toBe(UUID_A);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u9']);

    ws.close();
  });

  it('delivers an ALREADY-pending dialog on connect (menu was up before the client joined)', { timeout: 15_000 }, async () => {
    // A real AskUserQuestion menu: numbered options with descriptions + footer.
    const menuPane =
      'earlier assistant text\n' +
      '❯ 1. Approve as built\n     do it now\n' +
      '  2. Reject\n     revert\n' +
      '  3. Chat about this\n' +
      '\nEnter to select · ↑/↓ to navigate · Esc to cancel\n';
    const menuRun: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: menuPane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const menuApp = await buildServer({ cfg: loadConfig({ CCRC_HOME: home }), run: menuRun, tmux: new Tmux(menuRun), io: localIO }, new Bus());
    await menuApp.listen({ host: '127.0.0.1', port: 0 });
    const a = menuApp.server.address();
    const p = typeof a === 'object' && a !== null ? a.port : 0;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/ws/session/${ID}`);
      const next = collect(ws);
      await opened(ws);
      // backlog first, then the pending dialog (order not otherwise constrained).
      let dialogMsg: any = null;
      for (let i = 0; i < 4 && !dialogMsg; i++) {
        const m = await next(6000);
        if (m.type === 'dialog') dialogMsg = m;
      }
      expect(dialogMsg).not.toBeNull();
      expect(dialogMsg.dialog.parsed).toBe(true);
      expect(dialogMsg.dialog.options.map((o: { index: number }) => o.index)).toEqual([1, 2, 3]);
      ws.close();
    } finally {
      await menuApp.close();
    }
  });

  it('missing transcript sends backlog with missing:true and streams once the file appears', { timeout: 15_000 }, async () => {
    rmSync(fileA);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    const backlog = await next();
    expect(backlog.type).toBe('backlog');
    expect(backlog.missing).toBe(true);
    expect(backlog.file).toBe(fileA);
    expect(backlog.events).toEqual([]);
    expect(backlog.offset).toBe(0);

    writeFileSync(fileA, userLine('u1', 'file appeared'));
    const ev = await next(6000);
    expect(ev.type).toBe('events');
    expect(ev.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1']);

    ws.close();
  });
});
