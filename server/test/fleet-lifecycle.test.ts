// §4.4's wire half, end to end: registry stamps on disk -> `buildRecord` ->
// `sessionLifecycle` -> the `FleetSession` the PWA receives. The unit ladder is
// pinned in session-lifecycle.test.ts and the bash twin in
// ccd-session-lifecycle.test.ts; what is only provable HERE is that
// `assembleFleet` wires the right evidence into it, on the right timebase, and
// moves nothing else while doing so.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { SUBSTRATE_UNREADABLE } from '../src/registry.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';

const NOW_SEC = 1785300000;
const ID = 'demo-quiet-basin';

/** A registry with one session and whatever stamps the case wants. `alive`
 *  drives the tmux stub, exactly as the fixture rows drive `_alive` on the bash
 *  side — the pane's liveness is an input here too. */
const fixture = (fields: Record<string, string>, alive: boolean) => {
  const home = mkTmp('ccrc-lifecycle-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const base = { uuid: 'a'.repeat(36), wrapper: 'claude', project: 'demo', workdir: '/w' };
  for (const [k, v] of Object.entries({ ...base, ...fields })) {
    writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: alive ? 0 : 1, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { cfg: loadConfig({ CCRC_HOME: home }), tmux: new Tmux(run) };
};

const one = async (fields: Record<string, string>, alive: boolean) => {
  const { cfg, tmux } = fixture(fields, alive);
  const fleet = await assembleFleet(localIO, cfg, tmux, NOW_SEC);
  return fleet.find((s) => s.id === ID)!;
};

describe('assembleFleet ships the lifecycle', () => {
  it('classifies a live, freshly-supervised session as running', async () => {
    // Kills the seconds/milliseconds mutant in BOTH directions: a heartbeat 5
    // seconds old is fresh only if `supervisedAt` and `nowMs` are on the same
    // timebase. Forget one `* 1000` and the age becomes ~1.785 billion ms
    // (unsupervised) or ~ -1.785 billion (running for the wrong reason, which
    // the stale case below then catches).
    const s = await one({ supervised: String(NOW_SEC - 5), started: '1' }, true);
    expect(s.lifecycle).toBe('running');
  });

  it('classifies a live session whose supervisor stopped heartbeating as unsupervised', async () => {
    const s = await one({ supervised: String(NOW_SEC - 600), started: '1' }, true);
    expect(s.lifecycle).toBe('unsupervised');
  });

  it('classifies a stopped row as stopped, and says who and when — in epoch MS', async () => {
    // The wire timebase is MS, matching `statusUpdatedAt`/`bucketSince` and the
    // PWA's relative-time helpers. (`archivedAt` is the one exception, in
    // seconds, because it shipped that way; a second exception would make the
    // unit a coin toss at every call site.)
    const s = await one({ stopped: `${NOW_SEC - 90} pwa` }, false);
    expect(s.lifecycle).toBe('stopped');
    expect(s.stoppedBy).toEqual({ at: (NOW_SEC - 90) * 1000, surface: 'pwa' });
  });

  it('classifies a dead, unstopped, unwatched row that once ran as orphan', async () => {
    const s = await one({ started: '1' }, false);
    expect(s.lifecycle).toBe('orphan');
    expect(s.stoppedBy).toBeNull();
  });

  it('classifies a registry row that never had a session as never-started', async () => {
    expect((await one({}, false)).lifecycle).toBe('never-started');
  });

  it('never infers orphan from an unreadable stamp — the whole point of rule (b)', async () => {
    // The remote-mode shape: the file is LISTED, its bytes never come back.
    // Before the ladder existed this row printed a confident `orphan` about a
    // session nobody managed to look at.
    const { cfg, tmux } = fixture({ stopped: `${NOW_SEC - 90} pwa`, started: '1' }, false);
    const blind = degradedReadIO((p) => p.endsWith(`${ID}.stopped`));
    const fleet = await assembleFleet(blind, cfg, tmux, NOW_SEC);
    expect(fleet.find((s) => s.id === ID)!.lifecycle).toBe('unmeasurable');
  });

  it('carries a swap refusal onto the wire, with its reason verbatim', async () => {
    // §2.4/M9: the registry is the durable channel — a notify banner raised
    // with no socket open is gone, and this field is what is still there for
    // whoever was not watching.
    const s = await one({ swapblocked: `${NOW_SEC - 300} no transcript found under claude` }, false);
    expect(s.swapBlocked).toEqual({
      at: (NOW_SEC - 300) * 1000, reason: 'no transcript found under claude',
    });
  });

  it('leaves all three fields null for a row with no stamps, and never undefined', async () => {
    const s = await one({ started: '1' }, true);
    expect(s.lifecycle).toBe('unsupervised');   // measured, not null: no heartbeat is evidence
    expect(s.stoppedBy).toBeNull();
    expect(s.swapBlocked).toBeNull();
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['lifecycle', 'stoppedBy', 'swapBlocked']));
  });

  it('moves neither status nor bucket — a stopped row is still `dead`/`dead` (M10)', async () => {
    // The negative this whole task is bounded by. The bucket ladder is
    // untouched; the qualifier rides beside it.
    const s = await one({ stopped: `${NOW_SEC - 90} agent` }, false);
    expect(s.status).toBe('dead');
    expect(s.bucket).toBe('dead');
    expect(s.lifecycle).toBe('stopped');
  });

  // Binding finding #1 (task-8 review, routed to task 9), proven end-to-end:
  // a zero-byte `.stopped` on a dead, started row must classify `unmeasurable`,
  // never `orphan`. `assembleFleet` never sees the raw stamp — only whatever
  // `buildRecord`'s ladder decided — so this is the proof that the ladder's
  // `lifecycleUnmeasured` verdict actually reaches `sessionLifecycle`'s input,
  // not just that `registry.test.ts`'s narrower unit check does.
  it('classifies a zero-byte .stopped as unmeasurable, never orphan — the proven bash/TS divergence', async () => {
    const s = await one({ stopped: '', started: '1' }, false);
    expect(s.lifecycle).toBe('unmeasurable');
    expect(s.stoppedBy).toBeNull();
  });
});

describe('§1.6b — the spawn verdict reaches the wire off the SHIPPED `spawn` field', () => {
  it('projects the rc, keeping the `<epoch-seconds> <rc>` encoding untouched', async () => {
    const s = await one(
      { supervised: String(NOW_SEC - 5), started: '1', spawn: `${NOW_SEC - 30} 5` }, true);
    expect(s.spawnState).toBe('blocked');
    expect(s.started).toBe(true);
  });

  it('a row with NO $REG/<id>.spawn file is null — not `ready`, not a warning', async () => {
    // THIS IS swift-harbor's EXACT SHAPE, and the reason F8's detection keys on
    // `unclaimed` rather than on the spawn verdict: the class is the ABSENT CLAIM,
    // not the failed attempt. A `null` laundered into `ready` would assert a
    // measurement nobody made; laundered into a warning it would light every one of
    // the 18 live sessions that has not spawned since PR #50.
    const s = await one({ supervised: String(NOW_SEC - 5), started: '1' }, true);
    expect(s.spawnState).toBeNull();
  });

  it('an unparseable rc is `spawn: null` at the record and null on the wire', async () => {
    const s = await one({ started: '1', spawn: `${NOW_SEC - 30} banana` }, true);
    expect(s.spawnState).toBeNull();
  });

  it('carries `started: false` onto the wire — the only signal swift-harbor emits', async () => {
    const s = await one({ supervised: String(NOW_SEC - 5) }, true);
    expect(s.started).toBe(false);
    expect(s.spawnState).toBeNull();
    expect(s.lifecycle).toBe('unclaimed');
  });
});

describe('the substrate axis reaches the wire — projected, not re-read (D-310 (was D-B8-14), spec §3)', () => {
  it('projects a seeded marker as {at: seconds*1000, text} — conversion at THIS seam only', async () => {
    // The exact-MS assertion is this task's mutation tooth: drop the `* 1000`
    // and the stamp is off by three orders of magnitude. Same seam, same
    // timebase rule as `stoppedBy` (`fleet.ts:370`) — the registry is epoch
    // SECONDS, the wire is epoch MS, and the conversion happens here only.
    const s = await one({
      started: '1', supervised: String(NOW_SEC - 5),
      substrate: `${NOW_SEC - 120} protocol version mismatch (client 8, server 7)`,
    }, true);
    expect(s.substrate).toEqual({
      at: (NOW_SEC - 120) * 1000, text: 'protocol version mismatch (client 8, server 7)',
    });
  });

  it('a row without a marker ships substrate: null, and never undefined', async () => {
    const s = await one({ started: '1' }, true);
    expect(s.substrate).toBeNull();
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['substrate']));
  });

  it('an unreadable marker keeps `at: 0` on the wire — fail-shut text, no fabricated 1970 stamp', async () => {
    // The `.hold` ladder's remote-mode shape again: the file is LISTED, its
    // bytes never come back. `buildRecord` already ruled fail-shut
    // (SUBSTRATE_UNREADABLE, `at: 0`); what is only provable HERE is that the
    // verdict crosses the seam intact — 0 stays 0, so the PWA can render
    // text-only instead of a confident "since 1970".
    const { cfg, tmux } = fixture({ started: '1', substrate: `${NOW_SEC - 120} x` }, true);
    const blind = degradedReadIO((p) => p.endsWith(`${ID}.substrate`));
    const fleet = await assembleFleet(blind, cfg, tmux, NOW_SEC);
    expect(fleet.find((s) => s.id === ID)!.substrate).toEqual({ at: 0, text: SUBSTRATE_UNREADABLE });
  });

  it('moves neither status nor bucket — a faulted stopped row is still `dead`/`dead` (M10)', async () => {
    // The negative this task is bounded by, same as the lifecycle's own M10
    // pin above: the axis rides BESIDE status/bucket/lifecycle, it never
    // moves them.
    const s = await one({ stopped: `${NOW_SEC - 90} agent`, substrate: `${NOW_SEC - 60} wedged` }, false);
    expect(s.status).toBe('dead');
    expect(s.bucket).toBe('dead');
    expect(s.lifecycle).toBe('stopped');
    expect(s.substrate).toEqual({ at: (NOW_SEC - 60) * 1000, text: 'wedged' });
  });
});
