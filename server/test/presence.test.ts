// D-5242 (plan Task 17a, spec §5.11): the presence contract. Beside the VISIBLE claim (a screen on display, which
// suppresses pushes, unchanged) `Presence` keeps an OPEN claim per `/ws/session/:id` connection: stamped at connect and
// by every frame, visible or hidden, believed for `PRESENCE_OPEN_TTL_MS` after its last frame, dropped at close. The
// cases are AT THE TTLs, not at t = 0: an open claim on the visible TTL would pass every t = 0 case and lapse at 45 s.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { Presence } from '../src/presence.js';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { PRESENCE_OPEN_TTL_MS, PRESENCE_REFRESH_MS, PRESENCE_TTL_MS } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'lane-a-project-a';
const T0 = 1_800_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;

const clocked = () => {
  const c = { t: T0 };
  return { c, p: new Presence(() => c.t) };
};

describe('PRESENCE_OPEN_TTL_MS', () => {
  it('is ten minutes: a hidden tab\'s timers may be throttled to one wake-up a minute, so it outlives several missed beats', () => {
    expect(PRESENCE_OPEN_TTL_MS).toBe(10 * MIN);
    expect(PRESENCE_OPEN_TTL_MS).toBeGreaterThan(PRESENCE_TTL_MS);
  });
});

describe('Presence: the open claim', () => {
  it('a connection that reported visible:false and then beat hidden every 15 s is still open at 46 s, past PRESENCE_TTL_MS', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    p.touch(tok);
    p.setVisible(tok, null);
    for (let at = PRESENCE_REFRESH_MS; at <= 45 * SEC; at += PRESENCE_REFRESH_MS) {
      c.t = T0 + at;
      p.touch(tok);
      p.setVisible(tok, null);
    }
    c.t = T0 + 46 * SEC;
    expect(p.isOpen(ID)).toBe(true);
    expect(p.isVisible(ID)).toBe(false);
  });

  it('a throttled tab, one beat a minute, is open at 9 minutes and in every gap between its beats', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    for (let m = 1; m <= 9; m++) {
      // Just before the next beat: 59 s after the last frame, past PRESENCE_TTL_MS — red against a 45 s open claim.
      c.t = T0 + m * MIN - 1 * SEC;
      expect(p.isOpen(ID), `${m} min, before the beat`).toBe(true);
      c.t = T0 + m * MIN;
      p.touch(tok);
      expect(p.isOpen(ID), `${m} min`).toBe(true);
      expect(p.isVisible(ID), `${m} min`).toBe(false);
    }
  });

  it('one hidden frame and then silence: still open at 46 s, past PRESENCE_TTL_MS (red against the visible TTL)', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    p.touch(tok);
    p.setVisible(tok, null);
    c.t = T0 + 46 * SEC;
    expect(p.isOpen(ID)).toBe(true);
    expect(p.isVisible(ID)).toBe(false);
  });

  it('with no frame for PRESENCE_OPEN_TTL_MS + 1 ms it is not open; one millisecond earlier it is', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    c.t = T0 + PRESENCE_OPEN_TTL_MS - 1;
    expect(p.isOpen(ID)).toBe(true);
    c.t = T0 + PRESENCE_OPEN_TTL_MS + 1;
    expect(p.isOpen(ID)).toBe(false);
  });

  it('touch re-stamps: a beat at 9 minutes keeps it open at 18', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    c.t = T0 + 9 * MIN;
    p.touch(tok);
    c.t = T0 + 18 * MIN;
    expect(p.isOpen(ID)).toBe(true);
  });

  it('touch on a token that was never marked open opens nothing', () => {
    const { p } = clocked();
    p.touch(Symbol('stray'));
    expect(p.isOpen(ID)).toBe(false);
  });

  it('the claim is per connection: dropping one tab leaves the other open', () => {
    const { p } = clocked();
    const a = Symbol('a');
    const b = Symbol('b');
    p.markOpen(a, ID);
    p.markOpen(b, ID);
    p.drop(a);
    expect(p.isOpen(ID)).toBe(true);
    p.drop(b);
    expect(p.isOpen(ID)).toBe(false);
  });

  it('a closed socket drops both claims at once', () => {
    const { p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    p.setVisible(tok, ID);
    p.drop(tok);
    expect(p.isOpen(ID)).toBe(false);
    expect(p.isVisible(ID)).toBe(false);
  });

  it('isOpen names only its own id', () => {
    const { p } = clocked();
    p.markOpen(Symbol('a'), ID);
    expect(p.isOpen('project-a-quiet-basin')).toBe(false);
  });
});

describe('Presence: the visible claim keeps its exact meaning', () => {
  it('a visible connection\'s isVisible still lapses at 45 s without a beat, while it stays open', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.markOpen(tok, ID);
    p.setVisible(tok, ID);
    c.t = T0 + PRESENCE_TTL_MS - 1;
    expect(p.isVisible(ID)).toBe(true);
    c.t = T0 + PRESENCE_TTL_MS;
    expect(p.isVisible(ID)).toBe(false);
    expect(p.isOpen(ID)).toBe(true);
  });

  it('touch does not re-stamp the visible claim: only a visible frame does', () => {
    const { c, p } = clocked();
    const tok = Symbol('a');
    p.setVisible(tok, ID);
    c.t = T0 + 30 * SEC;
    p.touch(tok);
    c.t = T0 + PRESENCE_TTL_MS;
    expect(p.isVisible(ID)).toBe(false);
  });
});

// The server's own handler: the claim is stamped at connect, re-stamped by EVERY frame before it is parsed, and dropped
// at close. Driven over a real socket against a server whose Presence runs on a clock the case moves.
describe('/ws/session/:id keeps the open claim', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;
  const clock = { t: T0 };
  let presence: Presence;

  beforeEach(async () => {
    home = mkTmp('ccrc-presence-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    clock.t = T0;
    presence = new Presence(() => clock.t);
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), presence };
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

  const open = async (): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return ws;
  };
  const until = async (pred: () => boolean, what: string): Promise<void> => {
    const end = Date.now() + 5000;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('connecting opens the claim, with no frame sent', async () => {
    const ws = await open();
    try {
      await until(() => presence.isOpen(ID), 'the open claim at connect');
      expect(presence.isVisible(ID)).toBe(false);
    } finally {
      ws.close();
    }
  });

  it('a hidden frame re-stamps the open claim and sets no visible one', async () => {
    const ws = await open();
    try {
      await until(() => presence.isOpen(ID), 'the open claim at connect');
      clock.t = T0 + 9 * MIN;
      ws.send(JSON.stringify({ type: 'visible', visible: false }));
      // Let the frame land, then move past the connect stamp's TTL: only the frame's stamp can keep it open.
      await new Promise((r) => setTimeout(r, 100));
      clock.t = T0 + 18 * MIN;
      expect(presence.isOpen(ID)).toBe(true);
      expect(presence.isVisible(ID)).toBe(false);
    } finally {
      ws.close();
    }
  });

  it('a frame that fails to parse still re-stamps the open claim: it proves the socket alive', async () => {
    const ws = await open();
    try {
      await until(() => presence.isOpen(ID), 'the open claim at connect');
      clock.t = T0 + 9 * MIN;
      ws.send('not json');
      await new Promise((r) => setTimeout(r, 100));
      clock.t = T0 + 18 * MIN;
      expect(presence.isOpen(ID)).toBe(true);
    } finally {
      ws.close();
    }
  });

  it('closing the socket drops both claims at once', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'visible', visible: true }));
    await until(() => presence.isVisible(ID), 'the visible claim');
    expect(presence.isOpen(ID)).toBe(true);
    ws.close();
    await until(() => !presence.isOpen(ID) && !presence.isVisible(ID), 'both claims dropped at close');
  });
});
