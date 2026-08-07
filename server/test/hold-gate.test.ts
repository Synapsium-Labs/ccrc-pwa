// The server half of workspace holds: `archiveMerged`'s gate becomes
// *merged AND unheld*, and the held branch pushes once per (workspace, PR)
// instead of archiving. Harness copied from `pr-sweep.test.ts`'s
// `archiveMerged` tests (`grep -rln archiveMerged server/test`) — same seed,
// same runner shape, same registry-file idiom for the new `.hold` field.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { readRegistry } from '../src/registry.js';
import { localIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import type { PushPayload } from '../src/push.js';

function seed(ids: string[]): string {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of ids) {
    for (const [f, v] of [['uuid', 'u-' + id], ['wrapper', 'claude'], ['workdir', '/w/' + id],
      ['project', 'demo'], ['workspace', id.slice('demo-'.length)], ['branch', 'ws/' + id],
      ['base', 'origin/main']]) {
      writeFileSync(path.join(reg, `${id}.${f}`), v!);
    }
  }
  return home;
}

const hold = (home: string, id: string, reason: string): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hold`), reason);
};
const release = (home: string, id: string): void => {
  rmSync(path.join(home, '.cc-sessions', `${id}.hold`), { force: true });
};

const mergedLine = (id: string, number = 42): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: 'ws/' + id, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + id, headRefOid: 'deadbee',
    baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
    mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null,
});

/** A runner that answers tmux (idle, alive) and records ccd argv. */
function runnerFor(prOut: string, calls: string[][], pid = '4242'): Runner {
  return async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${pid}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'pr-state') return { code: 0, stdout: prOut, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

const liveIdle = (home: string, pid = '4242'): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${pid}.json`),
    JSON.stringify({ pid: Number(pid), sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', statusUpdatedAt: 1 }));
};

/** `prSweepStartedAt` returns to 0 in `sweepPr`'s own `finally` — the one
 *  signal that a whole sweep (archiveMerged included) has actually finished,
 *  same reasoning as `pr-sweep.test.ts`'s own waits. */
const sweepSettled = (w: FleetWatcher): Promise<void> =>
  vi.waitFor(() => { expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0); });

const forceDue = (w: FleetWatcher): void => {
  (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
};

describe('archiveMerged — merged AND unheld', () => {
  it('merged + held never archives, across many sweeps', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    for (let i = 0; i < 3; i++) {
      forceDue(w);
      await w.tick();
      await sweepSettled(w);
    }
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // Not just "no archive call" — no push carrying the ARCHIVE copy either,
    // across every one of the three sweeps.
    for (const [payload] of notify.mock.calls) expect(payload.body).not.toContain('nothing deleted');
    w.stop();
  });

  it('merged + released archives on the very next sweep — the level re-arms itself', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'w');
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);

    release(home, 'demo-quiet-basin');
    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin']);
    w.stop();
  });

  it('the held-merged push fires ONCE, says held, and names nothing destroyed', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    // A second sweep must not re-fire the latch.
    forceDue(w);
    await w.tick();
    await sweepSettled(w);

    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0]![0];
    expect(payload.title).toContain('✓ merged');
    // The reason string IS the display — verbatim, not paraphrased — and the
    // body says plainly that nothing was destroyed.
    expect(payload.body).toContain('program:agent-evals wave:1/4');
    expect(payload.body).toContain('nothing archived');
    // Same collapse key as the real archive push, so a later real archive
    // push REPLACES this one on the phone rather than stacking.
    expect(payload.tag).toBe('merged-demo-quiet-basin');
    w.stop();
  });

  it('the held-merged push latch resets when the PR number changes', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'w');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    let prNumber = 591;
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'pr-state') return { code: 0, stdout: mergedLine('demo-quiet-basin', prNumber), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { ...testDeps(home, run), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toContain('PR #591');

    prNumber = 601;
    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls[1]![0].body).toContain('PR #601');
    w.stop();
  });
});

describe('SessionRecord.held', () => {
  it('carries the reason verbatim, null when absent', async () => {
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const cfg = loadConfig({ CCRC_HOME: home });
    const records = await readRegistry(localIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe('program:agent-evals wave:1/4');
    expect(records.find((r) => r.id === 'demo-still-cove')?.held).toBeNull();
  });
});
