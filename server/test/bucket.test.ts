import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// The ladder lives in `shared/` because `reviveFleetSession` is its second
// producer — see its docstring, and fleetstate.test.ts's derivation suite.
import { sessionBucket, type BucketInput } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { HookState } from '../src/hookstate.js';
import { mkTmp } from './tmpHelpers.js';

const base: BucketInput = {
  status: 'idle', statusUpdatedAt: 1000, dialogPending: false,
  hookState: null, archivedAt: null, pr: null,
};

describe('sessionBucket', () => {
  it('routes a merged archived workspace to cleanup, not dead', () => {
    // ws-archive STOPS the session, so every cleanup candidate is also dead.
    // Testing dead first would empty this bucket permanently.
    const r = sessionBucket(
      { ...base, status: 'dead', statusUpdatedAt: 9000, archivedAt: 1700, pr: { phase: 'merged' } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 1_700_000 });
  });

  // `cleanup` is a CONJUNCTION, so it is entered at the later of its two
  // events. The auto-archive path hides this — there the archive is the later
  // one — but the manual path inverts it: archive at T0 with the PR still
  // open, open the session at T1 (which acks it at T1), merge at T2. Stamped
  // at T0 the session is dated before the ack that predates the episode, so
  // `isUnseen` computes `T0 > T1` = false and the leapfrog bucket's badge
  // never fires in the one flow it exists for.
  it('dates a workspace archived BEFORE its merge by the merge, not the archive', () => {
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 1700, pr: { phase: 'merged', mergedAt: 5_000_000 } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 5_000_000 });
  });

  it('keeps the archive time when the merge came first — the LATER event, not the merge one', () => {
    // The auto-archive path: sweepPr sees the merge, archiveMerged archives
    // seconds later. Taking `mergedAt` unconditionally would date the session
    // before it was archived, i.e. before it could possibly be in `cleanup`.
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 9000, pr: { phase: 'merged', mergedAt: 5_000_000 } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 9_000_000 });
  });

  it('falls back to the archive time when the registry supplied no mergedAt', () => {
    // `persistedPr` (fleet.ts) carries the phase from the registry with
    // `mergedAt: null` — the pre-sweep answer must degrade to exactly the old
    // one, never to 0.
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 1700, pr: { phase: 'merged', mergedAt: null } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 1_700_000 });
  });

  it('routes an archived workspace with no merged PR to archived', () => {
    const r = sessionBucket({ ...base, status: 'dead', archivedAt: 1700, pr: null }, null);
    expect(r.bucket).toBe('archived');
  });

  it('routes a live dead session to dead', () => {
    expect(sessionBucket({ ...base, status: 'dead', statusUpdatedAt: 42 }, null))
      .toEqual({ bucket: 'dead', bucketSince: 42 });
  });

  it('uses the hook timestamp for a waiting session', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'waiting' }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 5555 });
  });

  it('falls back to statusUpdatedAt when the pane scrape is the reason', () => {
    const r = sessionBucket({ ...base, status: 'busy', dialogPending: true }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 1000 });
  });

  it('does NOT use the hook timestamp for working — it bumps on every PostToolUse', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'working' }, 8888);
    expect(r).toEqual({ bucket: 'working', bucketSince: 1000 });
  });

  it('routes a finished turn to done with the hook timestamp', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777))
      .toEqual({ bucket: 'done', bucketSince: 7777 });
  });

  it('leaves a hookless idle session in idle — no hook evidence, no done claim', () => {
    expect(sessionBucket(base, null)).toEqual({ bucket: 'idle', bucketSince: 1000 });
  });

  it('assembleFleet ships the bucket without moving status', async () => {
    // The Build 1 freeze test (fleet.test.ts, "status is frozen against hook
    // data") asserts status is identical with and without hookstate. This is
    // its sibling: with hookstate present, `bucket` is the field that moved.
    // Harness copied from fleet.test.ts's "status is IDENTICAL..." fixture.
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = {
      wrapper: 'claude2', project: 'claude2-MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: '1'.repeat(36), started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `claude2-MekWarLive.${k}`), v);
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    const withoutHook = await assembleFleet(localIO, cfg, new Tmux(run), 1784600000);
    const waitingHookStates = new Map<string, HookState>([
      ['claude2-MekWarLive', { state: 'waiting', updatedAt: 1784600000000, event: null, ask: null, subagents: [], interrupted: false }],
    ]);
    const withWaitingHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, waitingHookStates,
    );

    const before = withoutHook.find((x) => x.id === 'claude2-MekWarLive')!;
    const afterWaiting = withWaitingHook.find((x) => x.id === 'claude2-MekWarLive')!;

    // status stays frozen — the field this task must not move.
    expect(afterWaiting.status).toBe(before.status);
    // bucket is the field that DOES move, once hook evidence says waiting.
    expect(afterWaiting.bucket).toBe('attention');

    // A hookless session with no dialog and no evidence of a finished turn
    // reports idle — mirrors sessionBucket's own "leaves a hookless idle
    // session in idle" unit test, through the full assembleFleet path.
    const home2 = mkTmp('ccrc-');
    const reg2 = path.join(home2, '.cc-sessions');
    mkdirSync(reg2, { recursive: true });
    writeFileSync(path.join(reg2, 'claude-demo.wrapper'), 'claude');
    writeFileSync(path.join(reg2, 'claude-demo.project'), 'demo');
    writeFileSync(path.join(reg2, 'claude-demo.workdir'), '/data/projects/demo');
    writeFileSync(path.join(reg2, 'claude-demo.uuid'), '1'.repeat(36));
    writeFileSync(path.join(reg2, 'claude-demo.started'), '1');
    const idleRun: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleetNoHookFile = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home2 }), new Tmux(idleRun), 1784600000,
    );
    const noHook = fleetNoHookFile.find((x) => x.id === 'claude-demo')!;
    expect(noHook.status).toBe('idle');
    expect(noHook.bucket).toBe('idle');
  });
});
