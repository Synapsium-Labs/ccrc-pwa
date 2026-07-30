import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import WebSocket from 'ws';
import { startAgent, type AgentOpts, type RunningAgent } from '../src/server.js';

export const TOKEN = 'test-token-abc123';

/** Fixture $HOME with the whitelisted subdirs pre-created, plus a sibling
 *  projects root and an "elsewhere" dir outside every whitelist prefix. */
export interface Fixture { home: string; projectsRoot: string; outside: string }

// Every fixture dir this module hands out, removed once per importing file.
// Same discipline as the server suite's tmpHelpers: mkdtemp with no cleanup
// leaked 2 dirs per run here, ×50-120 per mutation sweep, on a disk that has
// twice filled with test fixtures. Never a global /tmp sweep — files run in
// parallel processes and must only remove what they created.
const made: string[] = [];
afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(d);
  return d;
}

export function makeFixture(): Fixture {
  const home = tmp('ccrc-agent-home-');
  for (const dir of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude', '.claude-personal']) {
    mkdirSync(path.join(home, dir), { recursive: true });
  }
  const projectsRoot = tmp('ccrc-agent-projects-');
  const outside = tmp('ccrc-agent-outside-');
  return { home, projectsRoot, outside };
}

/** Boots a real agent on an ephemeral loopback port against `fixture`. */
export async function boot(fixture: Fixture, extra: Partial<AgentOpts> = {}): Promise<RunningAgent> {
  return startAgent({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    home: fixture.home,
    projectsRoot: fixture.projectsRoot,
    helloTimeoutMs: 300, // keep the "no hello" test fast
    ...extra,
  });
}

/** Thin WS client with a demuxing message buffer — `waitFor` can pick a
 *  specific frame (e.g. a `res` by id) out of order relative to interleaved
 *  `tail` pushes, matching how a real caller consumes the connection. */
export class TestClient {
  readonly ws: WebSocket;
  private readonly buffered: unknown[] = [];
  private readonly waiters: Array<{ pred: (m: unknown) => boolean; resolve: (m: unknown) => void }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (raw) => {
      const msg: unknown = JSON.parse(String(raw));
      const idx = this.waiters.findIndex((w) => w.pred(msg));
      if (idx >= 0) {
        const w = this.waiters.splice(idx, 1)[0]!;
        w.resolve(msg);
      } else {
        this.buffered.push(msg);
      }
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  closed(): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
      this.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<T = unknown>(pred: (m: unknown) => boolean, timeoutMs = 3000): Promise<T> {
    const idx = this.buffered.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.buffered.splice(idx, 1)[0] as T);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m as T); } });
    });
  }

  async hello(token = TOKEN): Promise<void> {
    await this.opened();
    this.send({ t: 'hello', token });
    await this.waitFor((m) => (m as { t?: unknown }).t === 'ready');
  }

  async req<T = unknown>(id: number, req: Record<string, unknown>): Promise<T> {
    this.send({ t: 'req', id, ...req });
    return this.waitFor<T>((m) => (m as { t?: unknown; id?: unknown }).t === 'res' && (m as { id?: unknown }).id === id);
  }
}
