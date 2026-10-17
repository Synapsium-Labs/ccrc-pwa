// The server's capability words (D-5232's mechanism; plan docs/superpowers/plans/2026-10-16-working-state-and-
// interruptions.md, Task 9b; spec §6.1): the file's grammar (`renderServerCaps` / `parseServerCaps`, shared/api.ts),
// and the server's own writer of it on a `server` or `both` node, on the watcher's own minute beat — never on a
// `fleet` role, never tied to the coordination database. Fixture HOMEs only (mkTmp); nothing here reads the live
// $HOME.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  SERVER_CAPS, SERVER_CAPS_FILE, SERVER_CAPS_LEASE_S, isServerCapWord, parseServerCaps, renderServerCaps,
  type NodeRole,
} from '../../shared/api.js';
import { SERVER_CAPS_FILE_MODE, SERVER_CAPS_WRITE_MS, writeServerCaps } from '../src/update/serverCaps.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { mkTmp } from './tmpHelpers.js';
import { testDeps } from './helpers.js';

const AT = 1_790_000_000;

afterEach(() => { vi.useRealTimers(); });

describe('the file\'s grammar: renderServerCaps then parseServerCaps (spec §6.1)', () => {
  it('round-trips the words, and an empty list', () => {
    const text = renderServerCaps(['dispatch-live-gate-v1', 'hook-main-state-v1'], AT);
    expect(text).toBe(`at ${AT}\ncaps dispatch-live-gate-v1 hook-main-state-v1\nend\n`);
    expect(parseServerCaps(text, AT)).toEqual({ ok: true, at: AT, words: ['dispatch-live-gate-v1', 'hook-main-state-v1'] });
    const empty = renderServerCaps([], AT);
    expect(empty).toBe(`at ${AT}\ncaps\nend\n`);
    expect(parseServerCaps(empty, AT)).toEqual({ ok: true, at: AT, words: [] });
    expect(parseServerCaps(renderServerCaps(SERVER_CAPS, AT), AT)).toEqual({ ok: true, at: AT, words: [...SERVER_CAPS] });
  });

  it('answers torn without `end`, and on a write cut anywhere short of it', () => {
    const whole = renderServerCaps(['dispatch-live-gate-v1'], AT);
    expect(parseServerCaps(`at ${AT}\ncaps dispatch-live-gate-v1\n`, AT)).toEqual({ ok: false, why: 'torn' });
    expect(parseServerCaps(`at ${AT}\ncaps dispatch-live-gate-v1\nen`, AT)).toEqual({ ok: false, why: 'torn' });
    expect(parseServerCaps(`at ${AT}\ncaps dispatch-live-gate-v1\nend`, AT)).toEqual({ ok: false, why: 'torn' });
    expect(parseServerCaps('', AT)).toEqual({ ok: false, why: 'torn' });
    for (let n = 0; n < whole.length; n++) {
      expect(parseServerCaps(whole.slice(0, n), AT), JSON.stringify(whole.slice(0, n))).toEqual({ ok: false, why: 'torn' });
    }
  });

  it('answers malformed on a bad word, a 12-digit `at`, a doubled space and anything after `end`', () => {
    expect(parseServerCaps(`at ${AT}\ncaps Dispatch\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps a_b\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps ${'a'.repeat(65)}\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps a  b\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps a \nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at 179000000000\ncaps\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps\nend\nmore\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\ncaps\nend\nx`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`caps\nat ${AT}\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
    expect(parseServerCaps(`at ${AT}\r\ncaps\nend\n`, AT)).toEqual({ ok: false, why: 'malformed' });
  });

  it('answers stale at `at` + 181 s and ok at + 180 s, future at `at` - 1 s, never folding one into another', () => {
    const text = renderServerCaps(['dispatch-live-gate-v1'], AT);
    expect(SERVER_CAPS_LEASE_S).toBe(180);
    expect(parseServerCaps(text, AT + 180)).toEqual({ ok: true, at: AT, words: ['dispatch-live-gate-v1'] });
    expect(parseServerCaps(text, AT + 181)).toEqual({ ok: false, why: 'stale' });
    expect(parseServerCaps(text, AT - 1)).toEqual({ ok: false, why: 'future' });
  });

  it('renders nothing the reader would refuse', () => {
    expect(() => renderServerCaps(['Bad'], AT)).toThrow(RangeError);
    expect(() => renderServerCaps([''], AT)).toThrow(RangeError);
    expect(() => renderServerCaps([], 179_000_000_000)).toThrow(RangeError);
    expect(() => renderServerCaps([], 1.5)).toThrow(RangeError);
    expect(() => renderServerCaps([], -1)).toThrow(RangeError);
  });

  it('every advertised word is on the grammar, listed once, and the file\'s name is the one the fleet reads', () => {
    expect(SERVER_CAPS).toContain('dispatch-live-gate-v1');
    expect(new Set(SERVER_CAPS).size).toBe(SERVER_CAPS.length);
    for (const w of SERVER_CAPS) expect(isServerCapWord(w), w).toBe(true);
    expect(SERVER_CAPS_FILE).toBe('server-caps');
  });
});

describe('writeServerCaps: tmp then one rename, 0600, never throws', () => {
  it('writes the rendered words at 0600 under a permissive umask, and leaves no tmp', async () => {
    const dir = path.join(mkTmp('ccrc-server-caps-write-'), '.ccrc');
    const old = process.umask(0o022);
    try {
      const r = await writeServerCaps(dir, SERVER_CAPS, AT);
      expect(r).toEqual({ ok: true, path: path.join(dir, SERVER_CAPS_FILE) });
    } finally { process.umask(old); }
    expect(readFileSync(path.join(dir, SERVER_CAPS_FILE), 'utf8')).toBe(renderServerCaps(SERVER_CAPS, AT));
    expect(statSync(path.join(dir, SERVER_CAPS_FILE)).mode & 0o777).toBe(SERVER_CAPS_FILE_MODE);
    expect(SERVER_CAPS_FILE_MODE).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('a directory at the path refuses, and a bad word refuses, both without throwing', async () => {
    const dir = path.join(mkTmp('ccrc-server-caps-dir-'), '.ccrc');
    mkdirSync(path.join(dir, SERVER_CAPS_FILE), { recursive: true });
    const r = await writeServerCaps(dir, SERVER_CAPS, AT);
    expect(r).toMatchObject({ ok: false, why: 'unwritable' });
    expect(readdirSync(dir).filter((n) => n.startsWith('.'))).toEqual([]);
    const bad = await writeServerCaps(path.join(mkTmp('ccrc-server-caps-bad-'), '.ccrc'), ['Bad'], AT);
    expect(bad).toMatchObject({ ok: false, why: 'unwritable', code: null });
  });
});

describe('the watcher writes the file on its own minute beat (spec §6.1: never the inventory lane\'s)', () => {
  const watcher = (prefix: string, role: NodeRole, ccrcDir?: string): { w: FleetWatcher; file: string } => {
    const home = mkTmp(prefix);
    const base = testDeps(home);
    // NO `coord`: testDeps carries none, so the inventory lane never runs here (`watch.ts`'s `this.deps.coord`
    // gate). A beat tied to that lane writes nothing at all on this watcher.
    const cfg = { ...base.cfg, role, ...(ccrcDir !== undefined ? { ccrcDir } : {}) };
    expect((base as { coord?: unknown }).coord).toBeUndefined();
    return {
      w: new FleetWatcher({ ...base, cfg }, new Bus(), 2000, path.join(home, 'state-cache.json')),
      file: path.join(cfg.ccrcDir, SERVER_CAPS_FILE),
    };
  };
  const atOf = (file: string): number => {
    const p = parseServerCaps(readFileSync(file, 'utf8'), Math.floor(Date.now() / 1000));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    return p.ok ? p.at : NaN;
  };

  it('with no coord, writes at the first tick and rewrites each minute, its `at` advancing past the lease', async () => {
    vi.useFakeTimers({ now: AT * 1000 });
    const { w, file } = watcher('ccrc-server-caps-beat-', 'both');
    await w.tick();
    await w.serverCapsSettled();
    expect(SERVER_CAPS_WRITE_MS).toBe(60_000);
    expect(parseServerCaps(readFileSync(file, 'utf8'), AT)).toEqual({ ok: true, at: AT, words: [...SERVER_CAPS] });
    // Not once a tick: a tick 2 s later leaves the file as it was.
    await vi.advanceTimersByTimeAsync(2_000);
    await w.tick(); await w.serverCapsSettled();
    expect(atOf(file)).toBe(AT);
    // Each minute beat rewrites it, so it never ages past the lease while the server runs.
    for (let m = 1; m <= 4; m++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await w.tick(); await w.serverCapsSettled();
    }
    const nowS = Math.floor(Date.now() / 1000);
    expect(nowS - AT).toBeGreaterThan(SERVER_CAPS_LEASE_S);
    expect(atOf(file)).toBeGreaterThan(AT + 180);
    expect(parseServerCaps(readFileSync(file, 'utf8'), nowS)).toMatchObject({ ok: true });
  });

  it('writes on a `server` role, at 0600', async () => {
    const { w, file } = watcher('ccrc-server-caps-server-', 'server');
    await w.tick(); await w.serverCapsSettled();
    expect(parseServerCaps(readFileSync(file, 'utf8'), Math.floor(Date.now() / 1000))).toMatchObject({ ok: true, words: [...SERVER_CAPS] });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('never writes on a `fleet` role (the update-sync timer is that node\'s writer)', async () => {
    vi.useFakeTimers({ now: AT * 1000 });
    const { w, file } = watcher('ccrc-server-caps-fleet-', 'fleet');
    await w.tick(); await w.serverCapsSettled();
    await vi.advanceTimersByTimeAsync(60_000);
    await w.tick(); await w.serverCapsSettled();
    expect(existsSync(file)).toBe(false);
  });

  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(runningAsRoot)('an unwritable directory warns once across two beats, and again after a success', async () => {
    vi.useFakeTimers({ now: AT * 1000 });
    const dir = path.join(mkTmp('ccrc-server-caps-unwritable-'), 'no-write-here');
    mkdirSync(dir, { recursive: true });
    const { w, file } = watcher('ccrc-server-caps-warn-', 'both', dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      chmodSync(dir, 0o500);
      await w.tick(); await w.serverCapsSettled();
      await vi.advanceTimersByTimeAsync(60_000);
      await w.tick(); await w.serverCapsSettled();
      const capsWarns = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(SERVER_CAPS_FILE));
      expect(capsWarns()).toHaveLength(1);
      expect(capsWarns()[0]).toMatch(/^ccrc-server: .*server-caps.*EACCES/);
      chmodSync(dir, 0o700);
      await vi.advanceTimersByTimeAsync(60_000);
      await w.tick(); await w.serverCapsSettled();
      expect(existsSync(file)).toBe(true);
      expect(capsWarns()).toHaveLength(1);
      chmodSync(dir, 0o500);
      await vi.advanceTimersByTimeAsync(60_000);
      await w.tick(); await w.serverCapsSettled();
      expect(capsWarns()).toHaveLength(2);
    } finally {
      chmodSync(dir, 0o700);
      warn.mockRestore();
    }
  });
});
