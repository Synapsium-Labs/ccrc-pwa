// The lane-state backfill (accounts plan Task A11; D-5518, G35; D-5755). A lane rostered before the lane-state file
// existed has none, and `enable`'s readiness (A13) reads it, so `ccrc install` writes one with `check` absent for every
// rostered lane that lacks one, and leaves an existing file byte for byte. `ccrc update` runs the staged tree's install
// spine (`_upd_*`; `ccrc-update.test.ts` pins that it does), so it backfills through the same step: the cases below
// drive that step, `_inst_lane_state`, sourced, and pin its place in `CCRC_INST_SPINE`.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  BASH, CCRC_SRC, HAVE_FLOCK, NODE_ID, boxEnv, ccrcIn, laneBox, laneState, laneStateDir, laneStatePath, modeOf,
} from './laneStateFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

/** The spine step, sourced, under the role `ccrc install`/`update` would give it. */
function backfill(home: string, role: 'both' | 'fleet' | 'server' = 'both'): { code: number; out: string; err: string } {
  const r = spawnSync(BASH, ['-c', `umask 022; . "$1"; INST_ROLE=${role}; _inst_lane_state`, '_', ccrcIn(home)],
    { env: boxEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe('the backfill (G35)', () => {
  it('`ccrc update` writes a lane-state file for a legacy lane, with `check` absent, and leaves an existing one untouched', () => {
    const home = laneBox('ccrc-lane-backfill-');
    // `claude` is a legacy lane with no file; `lane-b` already has one, in a shape this writer would never produce.
    mkdirSync(laneStateDir(home), { recursive: true, mode: 0o700 });
    const existing = '{"check":{"verdict":"ok","at":"2026-10-01T00:00:00Z"},"keyHash":"kh0b11"}';
    writeFileSync(laneStatePath(home, 'lane-b'), existing, { mode: 0o600 });

    const r = backfill(home);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('install: lane-state: wrote 1, kept 1\n');
    expect(laneState(home, 'claude')).toEqual({ fleetIdentity: NODE_ID });
    expect(laneState(home, 'claude')).not.toHaveProperty('check');
    expect(modeOf(laneStatePath(home, 'claude'))).toBe('600');
    expect(readFileSync(laneStatePath(home, 'lane-b'), 'utf8')).toBe(existing);

    // A second run is a no-op.
    expect(backfill(home).out).toBe('install: lane-state: wrote 0, kept 2\n');
  });

  it('a server-role box hosts no sessions, so it backfills nothing', () => {
    const home = laneBox('ccrc-lane-backfill-server-');
    const r = backfill(home, 'server');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('install: lane-state: skipped — a server-role box hosts no sessions\n');
    expect(laneState(home, 'claude')).toBeNull();
  });

  it('a lane a verb holds is left to that verb', () => {
    const home = laneBox('ccrc-lane-backfill-busy-');
    const r = spawnSync(BASH, ['-c', `mkdir -p -m 0700 "$HOME/.ccrc/locks"; exec 9>>"$HOME/.ccrc/locks/claude.lock"; `
      + 'flock -n 9 || exit 3; umask 022; . "$1"; INST_ROLE=both; _inst_lane_state', '_', ccrcIn(home)],
    { env: boxEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('install: lane-state: wrote 1, kept 0, 1 left to the account verb acting on it\n');
    expect(laneState(home, 'claude')).toBeNull();
    expect(laneState(home, 'lane-b')).toEqual({ fleetIdentity: NODE_ID });
  });

  it('runs in the install spine `ccrc update` runs, after the wrappers and before the completed-install record', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const spine = /^CCRC_INST_SPINE=\(([\s\S]*?)\n\)/m.exec(src)![1]!.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = spine.indexOf('_inst_lane_state');
    expect(at, 'the backfill is a spine step').toBeGreaterThan(-1);
    expect(spine.indexOf('_inst_wrappers')).toBeLessThan(at);
    expect(spine[spine.length - 1]).toBe('_inst_installed');
  });
});
