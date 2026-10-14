// D-5005 — A WINDOW-SIZED CLIENT MOVES NOTHING, measured on real tmux.
//
// The terminal drawer (a browser xterm) attaches to a tmux session as a client
// EXACTLY the size of the tmux window: PINNED_WINDOW_COLS columns by
// PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS rows, because tmux's status line takes
// one row from every attached client. A client exactly the window's size gives
// tmux nothing to pan and nothing to fill. This suite uses tmux's own formats
// to prove the geometry, and a deterministic stub app to prove the client
// stream carries no filler.
//
// Spec: docs/superpowers/specs/2026-10-14-terminal-drawer-every-width-design.md
// §5.1, §9 (W6, W8). Target form discipline: D-3525.
//
// NOTHING here touches a live tmux server. The suite runs on a private `-L`
// socket, kills only that server, strips TMUX/TMUX_PANE/TMUX_TMPDIR from every
// environment (node-pty turns an `undefined` env value into the literal string
// "undefined", which tmux then refuses, so we `delete` the keys instead), and
// uses `-f ccd/tmux.conf` on every tmux invocation.
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as pty from 'node-pty';
import { tmuxName, tmuxTarget } from '../../shared/tmux-target.js';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api.js';

const ROOT = path.resolve(__dirname, '..', '..');
const STUB = path.join(__dirname, 'fixtures', 'drawer-stub-alt.mjs');
const CONF = path.join(ROOT, 'ccd', 'tmux.conf');

/** The real tmux, resolved on the ambient PATH and absolute. */
const REAL_TMUX: string | null = (() => {
  const r = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  const p = (r.stdout ?? '').trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
})();
const NO_TMUX = REAL_TMUX === null;
const BEHAVIOURAL = 'D-5005 — a window-sized client moves nothing (real tmux, private socket)'
  + (NO_TMUX ? ' — SKIPPED: no tmux on PATH, so there is no real tmux to measure against' : '');

/** Short (macOS `sun_path`) and unique per run (concurrent suites). */
const SOCK = `dws${process.pid}${Math.random().toString(36).slice(2, 6)}`;

const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.TMUX_TMPDIR;
  return env;
};

/** The real tmux on the private socket, using ccd/tmux.conf. */
const T = (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync(REAL_TMUX!, ['-L', SOCK, '-f', CONF, ...args], { encoding: 'utf8', env: cleanEnv() });

const clients = (): string => T('list-clients', '-F', '#{client_width} #{client_height}').stdout.trim();
const windowSize = (target: string): string =>
  T('display', '-p', '-t', target, '#{window_width}x#{window_height}').stdout.trim();
const windowSizeOpt = (target: string): string =>
  T('show-options', '-w', '-v', '-t', target, 'window-size').stdout.trim();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// (e) The attach and the expectations both read the shared constants, so a
// change to the constants moves the test with them. The expectations never
// read ATTACH_*, so a wrong attach on its own goes red (the mutation table).
const ATTACH_COLS = PINNED_WINDOW_COLS;
const ATTACH_ROWS = PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS;
const CLIENT = `${PINNED_WINDOW_COLS} ${PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS}`;
const WINDOW = `${PINNED_WINDOW_COLS}x${PINNED_WINDOW_ROWS}`;

interface AttachedSession {
  p: pty.IPty;
  target: string;
  /** Mutable chunks from the node-pty client stream; join before reading. */
  stream: string[];
  ready: 'stream' | 'pane-then-stream';
}

/** Every client this file attached, so `afterEach` detaches it even when a case
 *  failed before its own `p.kill()`. */
const attached: pty.IPty[] = [];

const spawnAndAttach = async (id: string): Promise<AttachedSession> => {
  const name = tmuxName(id);
  const target = tmuxTarget(id);

  const node = process.execPath;
  const cmd = `'${node}' '${STUB}'`;

  const ns = T('new-session', '-d', '-s', name, '-x', String(PINNED_WINDOW_COLS), '-y', String(PINNED_WINDOW_ROWS), cmd);
  expect(ns.status, `new-session ${name}: ${ns.stderr}`).toBe(0);

  const rw = T('resize-window', '-t', target, '-x', String(PINNED_WINDOW_COLS), '-y', String(PINNED_WINDOW_ROWS));
  expect(rw.status, `resize-window ${name}: ${rw.stderr}`).toBe(0);

  const so = T('set-option', '-t', target, 'window-size', 'latest');
  expect(so.status, `set-option window-size latest ${name}: ${so.stderr}`).toBe(0);

  const stream: string[] = [];
  let lastStreamAt = 0;
  const joined = (): string => stream.join('');
  const p = pty.spawn(REAL_TMUX!, ['-L', SOCK, '-f', CONF, 'attach', '-t', target], {
    name: 'xterm-256color',
    cols: ATTACH_COLS,
    rows: ATTACH_ROWS,
    env: cleanEnv(),
  });
  attached.push(p);
  p.onData((chunk) => {
    stream.push(chunk);
    lastStreamAt = Date.now();
  });

  const deadline = Date.now() + 10000;
  let paneReadyAt = 0;
  while (Date.now() < deadline) {
    if (joined().includes('STUB-READY')) {
      return { p, target, stream, ready: 'stream' };
    }
    if (paneReadyAt === 0) {
      const cap = T('capture-pane', '-p', '-t', target);
      if (cap.status === 0 && cap.stdout.includes('STUB-READY')) {
        paneReadyAt = Date.now();
      }
    } else if (lastStreamAt > paneReadyAt) {
      return { p, target, stream, ready: 'pane-then-stream' };
    }
    await sleep(50);
  }
  throw new Error(`STUB-READY not observed for ${name}`);
};

const waitForEcho = async (target: string, text: string): Promise<void> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const cap = T('capture-pane', '-p', '-t', target);
    if (cap.status === 0 && cap.stdout.includes(text)) return;
    await sleep(50);
  }
  throw new Error(`echo of "${text}" not seen in pane ${target}`);
};

/** The client and the window, read together so a red line shows both: a wrong
 *  attach moves the window under `latest`, and the diff says where it went. */
const geometry = (target: string): { client: string; window: string } =>
  ({ client: clients(), window: windowSize(target) });
const EXPECTED = { client: CLIENT, window: WINDOW };

const assertGeometry = (target: string): void => {
  expect(windowSizeOpt(target), 'window-size option').toBe('latest');
  expect(geometry(target), 'client and window geometry').toEqual(EXPECTED);
};

describe.skipIf(NO_TMUX)(BEHAVIOURAL, () => {
  afterAll(() => {
    if (REAL_TMUX !== null) T('kill-server');
    if (typeof process.getuid === 'function') {
      fs.rmSync(path.join('/tmp', `tmux-${process.getuid()}`, SOCK), { force: true });
    }
  });

  afterEach(async () => {
    for (const p of attached.splice(0)) {
      try { p.kill(); } catch { /* already gone */ }
    }
    const ls = T('list-sessions', '-F', '#{session_name}');
    if (ls.status === 0) {
      for (const name of ls.stdout.split('\n').filter(Boolean)) {
        T('kill-session', '-t', `=${name}:`);
      }
    }
  });

  it('(a) under window-size latest the client is the window plus one status row', async () => {
    const { p, target } = await spawnAndAttach('demo-a');
    assertGeometry(target);
    p.kill();
  }, 30_000);

  it('(b) typing 20 printable characters keeps the geometry', async () => {
    const { p, target } = await spawnAndAttach('demo-b');
    assertGeometry(target);
    const text = 'abcdefghij0123456789';
    p.write(text);
    await waitForEcho(target, text);
    assertGeometry(target);
    p.kill();
  }, 30_000);

  it('(c) latching manual at the window size still keeps the geometry', async () => {
    const { p, target } = await spawnAndAttach('demo-c');
    assertGeometry(target);

    const latch = T('resize-window', '-t', target, '-x', String(PINNED_WINDOW_COLS), '-y', String(PINNED_WINDOW_ROWS));
    expect(latch.status, `resize-window latch: ${latch.stderr}`).toBe(0);
    expect(windowSizeOpt(target), 'window-size option after latch').toBe('manual');

    expect(geometry(target), 'client and window geometry after the manual latch').toEqual(EXPECTED);

    const text = 'klmnopqrstuvwxyz1234';
    p.write(text);
    await waitForEcho(target, text);

    expect(geometry(target), 'client and window geometry after typing under manual').toEqual(EXPECTED);
    expect(windowSizeOpt(target), 'window-size option after typing').toBe('manual');
    p.kill();
  }, 30_000);

  it('(d) after manual latch the client stream contains no middle-dot filler', async () => {
    const { p, target, stream } = await spawnAndAttach('demo-d');

    // Latch manual.
    const latch = T('resize-window', '-t', target, '-x', String(PINNED_WINDOW_COLS), '-y', String(PINNED_WINDOW_ROWS));
    expect(latch.status, `resize-window latch: ${latch.stderr}`).toBe(0);
    expect(windowSizeOpt(target), 'window-size option after latch').toBe('manual');

    // Type a marker and wait for its echo so tmux has redrawn the client.
    const text = 'marker-for-no-filler';
    p.write(text);
    await waitForEcho(target, text);

    // Let the client stream settle.
    await sleep(300);

    const collected = stream.join('');
    expect(collected, 'collected client stream').not.toContain('\u00b7');
    expect(fs.readFileSync(STUB, 'utf8'), 'stub source never prints middle-dot').not.toContain('\u00b7');
    p.kill();
  }, 30_000);
});

// MUTATION TABLE (D-5005), RUN on tmux 3.7c, 2026-10-14: each mutant edits
// ONLY the attach line (ATTACH_COLS / ATTACH_ROWS), the suite runs alone, and the
// file is restored after. CLIENT and WINDOW derive from the shared constants on
// their own, so the attach cannot move the expectations with it. Under `latest`
// a wrong attach drags the window to the client's size minus the status row.
//
// | Mutant (attach) | Observed |
// |---|---|
// | 220x50 | (a), (b), (c) RED: `{ client: '220 50', window: '220x49' }`, expected `{ client: '220 51', window: '220x50' }` |
// | 220x52 | (a), (b), (c) RED: `{ client: '220 52', window: '220x51' }` |
// | 200x51 | (a), (b), (c) RED: `{ client: '200 51', window: '200x50' }` |
// | 300x51 | (a), (b), (c) RED: `{ client: '300 51', window: '300x50' }`; and (d) RED: once `manual` latches the window at 220, tmux fills the client past it with U+00B7 (`collected client stream: expected '…' not to contain` it) |
//
// The red-first run was the 220x50 row, before the attach read the constants.
