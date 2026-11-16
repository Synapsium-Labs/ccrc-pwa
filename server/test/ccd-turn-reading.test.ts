// ARCH-50 (#785), ccd's half of K4: `_turn_reading <config-dir> <pid>` is the one read of a session's status file, and
// `_ws_status` and `_idle_for_keystroke` apply their own policy line to it. It answers the same four words as the server's
// `turnWordOf` (`busy | idle | shell | unknown`) with the arm that decided it. `_swap_idle_gate` is NOT a caller: it is the
// auto-swap decision gate (D-5240, D-5349) and keeps its own verdict table.
// Fixture HOME only; the status file is written under it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-turn-reading-'); });
afterEach(() => { h.cleanup(); });

/** `<cfg>/sessions/<pid>.json`, written with `body`; returns the config dir. */
function cfgWith(pid: number, body: string | null): string {
  const cfg = path.join(h.home, 'cfg');
  mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
  if (body !== null) writeFileSync(path.join(cfg, 'sessions', `${pid}.json`), body);
  return cfg;
}
const read = (cfg: string, pid: number): string =>
  h.sh(`_turn_reading ${JSON.stringify(cfg)} ${pid}; echo "rc=$? why=$TR_WHY word=$TR_WORD raw=$TR_RAW"`).trim().split('\n').at(-1)!;

describe('_turn_reading: the status file, once', () => {
  it('names idle, busy and shell; any other extractable word is unknown with why ok', () => {
    const out = ['idle', 'busy', 'shell', 'waiting', 'compacting'].map((w, i) =>
      read(cfgWith(100 + i, `{"pid":${100 + i},"status":"${w}","statusUpdatedAt":1}`), 100 + i));
    expect(out).toEqual([
      'rc=0 why=ok word=idle raw=idle', 'rc=0 why=ok word=busy raw=busy', 'rc=0 why=ok word=shell raw=shell',
      'rc=0 why=ok word=unknown raw=waiting', 'rc=0 why=ok word=unknown raw=compacting',
    ]);
  });

  it('a word ccd cannot extract, or no status key, is no-status', () => {
    expect(read(cfgWith(200, '{"status":"Idle"}'), 200)).toBe('rc=1 why=no-status word=unknown raw=');
    expect(read(cfgWith(201, '{"pid":201}'), 201)).toBe('rc=1 why=no-status word=unknown raw=');
  });

  it('an absent file is absent, and a file that is not a regular file is not-regular (a dangling link included)', () => {
    const cfg = cfgWith(300, null);
    expect(read(cfg, 300)).toBe('rc=1 why=absent word=unknown raw=');
    mkdirSync(path.join(cfg, 'sessions', '301.json'));
    expect(read(cfg, 301)).toBe('rc=1 why=not-regular word=unknown raw=');
    symlinkSync(path.join(h.home, 'nowhere'), path.join(cfg, 'sessions', '302.json'));
    expect(read(cfg, 302)).toBe('rc=1 why=not-regular word=unknown raw=');
  });

  it('leaves the path it read in TR_SF', () => {
    const cfg = cfgWith(400, '{"status":"idle"}');
    expect(h.sh(`_turn_reading ${JSON.stringify(cfg)} 400; echo "$TR_SF"`).trim().split('\n').at(-1)).toBe(`${cfg}/sessions/400.json`);
  });
});
