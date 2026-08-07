// The sixth lane. (The fifth is hook-state sweeping — watch.ts:104.) Four
// conditions, and the two that are easy to get wrong are which `branch` it
// reads (the registry's, not the assembled one) and when it records the stat
// probe (after the verb gate, never before it).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import type { FleetIO } from '../src/io.js';
import { localIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-mesa';
const UUID = 'a'.repeat(36);
const WORKDIR = '/w/demo/quiet-mesa';
const MUNGED = '-w-demo-quiet-mesa';      // mungePath: /._ -> - (munge.ts:1)

/** Registry row for a workspace still on its born branch. `readRegistry` needs
 *  wrapper+workdir+uuid or it skips the row entirely (registry.ts:122). */
const seed = (home: string, over: Record<string, string | null> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string | null> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa', ...over,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
};

const TITLE = (t: string): string => JSON.stringify({ type: 'ai-title', aiTitle: t });
const USER = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

/** The transcript at exactly the path `transcriptPath(cfgDir, workdir, uuid)`
 *  resolves to for the row `seed` writes: `<home>/.claude/projects/<munged>/<uuid>.jsonl`. */
const transcript = (home: string, lines: string[]): string => {
  const dir = path.join(home, '.claude', 'projects', MUNGED);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
};

/** A statusline pane in the shape `parseStatusline` parses: the branch is the
 *  `⎇` segment, delimited by the box-vertical. Check `src/pane/statusline.ts`
 *  and copy its own fixture idiom if this drifts. */
const pane = (branch: string): string =>
  `  👤 claude │ 🤖 Sonnet 5 │ ⎇ ${branch} │ 🎯 demo`;

interface Harness { home: string; calls: string[][]; run: Runner }

/** A runner that answers tmux well enough and records every ws-rename argv.
 *  It goes through `testDeps`'s guardRunner, so an argv the agent whitelist
 *  refuses throws here rather than being silently recorded. */
const harness = (stdout = `{"renamed":"${ID}","old":"ws/quiet-mesa","new":"ws/x"}`,
                 statusBranch = 'ws/quiet-mesa'): Harness => {
  const home = mkTmp('ccrc-name-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { code: 0, stdout: pane(statusBranch), stderr: '' };
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    if (args[0] === 'ws-rename') { calls.push([...args]); return { code: 0, stdout, stderr: '' }; }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

const renames = (calls: string[][]): string[] => calls.map((a) => a[4]!);

/** The lane gates on `NAME_SWEEP_MS`, which `Date.now()` reads — so a second
 *  sweep in the same millisecond returns early. Every multi-sweep test below
 *  runs on fake timers and moves the clock past the lane between sweeps. */
const PAST_LANE_MS = 11_000;
const again = async (w: FleetWatcher): Promise<void> => {
  await vi.advanceTimersByTimeAsync(PAST_LANE_MS);
  await w.sweepNames();
};

/** Fake timers are the default here, not the exception: see `again`. Tests that
 *  need real ones say so. */
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the naming sweep', () => {
  it('renames a workspace still on its born branch, from the title the model wrote', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go'), TITLE('Brainstorm Helix and slide notes integration')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls[0]).toEqual(
      ['ws-rename', '--session', ID, '--branch', 'ws/brainstorm-helix-and-slide-notes']);
    expect(h.calls).toHaveLength(1);
  });

  it('does not fire once the branch has been renamed', async () => {
    const h = harness();
    seed(h.home, { branch: 'ws/brainstorm-helix-and-slide-notes' });
    transcript(h.home, [TITLE('Brainstorm Helix and slide notes integration')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    await again(w);
    expect(h.calls).toEqual([]);
  });

  // THE ONE THAT IS EASY TO GET WRONG. `FleetSession.branch` is
  // `sl?.branch ?? r.branch` (fleet.ts:155) — the statusline WINS, deliberately
  // — and it only moves when Claude Code re-renders, so it still reports the
  // born branch for some number of ticks after a successful rename. A sweep
  // reading the assembled value would rename the workspace a second time, to a
  // name the registry says it already has.
  //
  // Through `tick()`, because `tick()` is what populates `this.statuslines`
  // from the pane — the sweep alone would leave the map empty and the fixture
  // would prove nothing.
  it('reads the registry branch, not the assembled one the statusline still owns', async () => {
    const h = harness(undefined, 'ws/quiet-mesa');     // the pane still says the born name
    seed(h.home, { branch: 'ws/already-renamed' });    // ...the registry does not
    transcript(h.home, [TITLE('Already renamed')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.branch,
      'the fixture is only a fixture if the pane really was parsed').toBe('ws/quiet-mesa');
    await again(w);
    await again(w);
    expect(h.calls).toEqual([]);
  });

  it('does not fire without a title, and does fire once one appears', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);

    transcript(h.home, [USER('go'), TITLE('The title lands')]);
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/the-title-lands']);
  });

  it('does not fire for a main checkout', async () => {
    const h = harness();
    seed(h.home, { workspace: null, branch: 'main' });
    transcript(h.home, [TITLE('Fix the thing')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);
  });

  // Review finding 2: `ccd ws-archive` "DESTROYS NOTHING" (ccd:1670-1673) — an
  // archived row keeps `workspace`, keeps `branch = ws/<slug>`, keeps its
  // worktree and keeps its transcript, so without this guard the row is fully
  // in scope for conditions 2-4 and a server restart (`attemptedRenames` is
  // empty at boot) would rename a branch the operator can no longer find by
  // name. Same guard, same shape, as `archiveMerged` (watch.ts).
  it('does not rename an archived workspace, even though the row is otherwise eligible', async () => {
    const h = harness();
    seed(h.home, { archived: '1785300123' });
    transcript(h.home, [TITLE('Brainstorm Helix and slide notes integration')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);
  });

  it('does not fire when the title slugifies to the name it already has', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('quiet mesa')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);
  });

  it('does not re-fire after a refusal, even once the transcript grows', async () => {
    const h = harness('{"refused":"has-upstream","detail":"already on the remote","paths":[]}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toHaveLength(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('has-upstream');

    // A grown transcript re-opens the stat gate; condition 4 is what still holds.
    transcript(h.home, [TITLE('Fix the PR sheet'), USER('more work')]);
    await again(w);
    await again(w);
    expect(h.calls).toHaveLength(1);
  });

  // Review finding 1. `has-upstream` is permanent BY CONSTRUCTION — a pushed
  // branch is never un-pushed — so the pair-keyed guard alone is not enough:
  // a live session's transcript keeps growing, the stat gate keeps
  // reopening, and a title that later changes would derive a NEW pair the
  // set has never seen. The session must be retired outright, and cheaply —
  // before another stat, before another 256 KB tail read.
  it('retires the whole SESSION on a permanent refusal, not just the one pair', async () => {
    const h = harness('{"refused":"has-upstream","detail":"already on the remote","paths":[]}');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(h.home);
    const f = transcript(h.home, [TITLE('Fix the PR sheet')]);
    let stats = 0, reads = 0;
    const io: FleetIO = {
      ...localIO,
      stat: (p) => { if (p === f) stats += 1; return localIO.stat(p); },
      readFileFrom: (p, off) => { if (p === f) reads += 1; return localIO.readFileFrom(p, off); },
    };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io }, new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toHaveLength(1);
    expect(reads).toBe(1);
    const statsAfterFirst = stats;

    // A DIFFERENT title, deriving a DIFFERENT pair — the pair-keyed guard
    // alone would let this one through the second time; the session-level
    // retirement must not, and must not even read the transcript to find out.
    writeFileSync(f, TITLE('A completely different title') + '\n');
    await again(w);
    await again(w);
    expect(h.calls, 'still exactly the one call from before the refusal').toHaveLength(1);
    expect(reads, 'a retired session earns no further tail read at all').toBe(1);
    expect(stats, 'nor even the cheaper stat the tail read is gated behind').toBe(statsAfterFirst);
  });

  // The retry key is `<id>:<derived-branch>`, not `<id>` — so a title that
  // changes WHILE THE BRANCH IS STILL AT ITS BORN NAME earns exactly one fresh
  // attempt. Synthetic on purpose: measured on a 91 MB transcript, `ai-title` is
  // rewritten once per turn but the value never changed (1,809 lines, one
  // distinct value), so real data cannot exercise this branch. A key of `<id>`
  // alone passes every other case in this file and fails here.
  it('a title that changes before the rename lands earns one fresh attempt', async () => {
    const h = harness('{"refused":"name-taken-local","detail":"taken","paths":[]}');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(h.home);
    transcript(h.home, [TITLE('First guess at the work')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/first-guess-at-the-work']);

    transcript(h.home, [TITLE('First guess at the work'), TITLE('Second and better guess')]);
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/first-guess-at-the-work', 'ws/second-and-better-guess']);

    // ...and exactly one. The new pair is now attempted too.
    transcript(h.home, [TITLE('First guess at the work'), TITLE('Second and better guess'), USER('x')]);
    await again(w);
    expect(h.calls).toHaveLength(2);
  });

  it('records NO attempt when the fleet’s ccd lacks the verb', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start', 'ws-reap'] };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), fleetState: state }, new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);

    // ccd is installed; the caps lane refreshes the list. The transcript has NOT
    // changed, so this fires only if the unsupported pass recorded no stat probe
    // — i.e. only if verbSupported is asked BEFORE claimTitleRead.
    state.ccdVerbs = ['start', 'ws-reap', 'ws-rename'];
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
  });

  it('joins the per-session queue rather than racing the writes that use it', async () => {
    vi.useRealTimers();   // a held promise plus a real setTimeout, not a clock
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const deps = testDeps(h.home, h.run);
    let release!: () => void;
    // Stands in for POST /workspace/reap (server.ts:702), which holds the same key.
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const w = new FleetWatcher(deps, new Bus(), 2000);

    const sweep = w.sweepNames();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls, 'the rename must wait behind the held key').toEqual([]);

    release();
    await sweep;
    expect(h.calls).toHaveLength(1);
  });

  // Build 2.5 interaction, asserted rather than assumed (rider delta 7). The
  // ccd side is pinned in ccd-ws-rename.test.ts; this is the server side: the
  // sweep itself neither reads nor writes hold or prhistory state, so a held
  // workspace is renamed exactly like an unheld one and nothing in the registry
  // moves except `branch` (which ccd writes, not the sweep).
  it('is indifferent to a hold, and touches no PR lineage', async () => {
    const h = harness();
    seed(h.home, { hold: 'program:agent-evals wave:1/4' });
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
    expect(readFileSync(path.join(h.home, '.cc-sessions', `${ID}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
    expect(h.calls.every((a) => a[0] === 'ws-rename'),
      'the naming lane emits exactly one verb and it is not pr-state').toBe(true);
  });

  // ── the stat gate ──
  it('does not re-read an unchanged transcript, and does re-read a grown one', async () => {
    const h = harness();
    seed(h.home);
    const f = transcript(h.home, [USER('go')]);   // no title: the permanent state
    let reads = 0;
    const io: FleetIO = {
      ...localIO,
      readFileFrom: (p, off) => { if (p === f) reads += 1; return localIO.readFileFrom(p, off); },
    };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io }, new Bus(), 2000);

    await w.sweepNames();
    expect(reads).toBe(1);
    await again(w);
    await again(w);
    expect(reads, 'identical size AND mtime means the bytes cannot have changed').toBe(1);

    writeFileSync(f, readFileSync(f, 'utf8') + USER('more') + '\n');
    await again(w);
    expect(reads).toBe(2);
  });
});

describe('the naming lane', () => {
  it('sweeps once every ten seconds, not once a tick', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go')]);   // no title, so nothing is called either way
    let stats = 0;
    const io: FleetIO = {
      ...localIO,
      stat: (p) => { if (p.endsWith('.jsonl')) stats += 1; return localIO.stat(p); },
    };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io }, new Bus(), 2000);

    await w.sweepNames(); await w.sweepNames(); await w.sweepNames();
    const afterFirst = stats;
    expect(afterFirst, 'the first sweep ran').toBeGreaterThan(0);

    // Under the interval: must NOT sweep. This is the assertion a mutant that
    // shrinks NAME_SWEEP_MS cannot survive.
    await vi.advanceTimersByTimeAsync(5_000);
    await w.sweepNames();
    expect(stats, 'under the interval the lane must not run').toBe(afterFirst);

    // Exactly at the interval, because the gate is `< NAME_SWEEP_MS` -> return.
    await vi.advanceTimersByTimeAsync(5_000);
    await w.sweepNames();
    expect(stats, 'at the interval it must').toBeGreaterThan(afterFirst);
  });

  it('the tick dispatches it, and does NOT wait for it', async () => {
    vi.useRealTimers();
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const deps = testDeps(h.home, h.run);
    let release!: () => void;
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const w = new FleetWatcher(deps, new Bus(), 2000);

    // The tick returns while the sweep is still parked on the queue — awaiting
    // it would put the dialog detector behind a reap that can run for minutes.
    await w.tick();
    expect(h.calls).toEqual([]);
    release();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  });
});
