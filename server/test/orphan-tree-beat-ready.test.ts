// Delegation broker wave 5 PR4 (Task 5.4.3, D-7828, D-8011; review 1475 F2): the orphan beat's delegation read, over the REAL
// watcher. `FleetWatcher.delegationCheckpointIfReady()` answers the delegation lane's checkpoint only while its applier is
// `ready`: null before the applier opens, and null while it is `reconstructing` (it starts as an empty checkpoint in that
// phase, so a read that ignored the phase would free every `claude`/`superpowers` tree while the applier rebuilds). The beat the
// watcher builds is wired to that read, so its `leaseHold` stops a `claude` tree while reconstructing and reads the checkpoint
// once ready. W5-O13i runs the beat's own `pass()` over a one-tree box, so the hold the beat hands its sweep is the one
// measured (review 1482 F1). Each world is a fixture home with its own applier directory; nothing here touches a live box.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CcdResult } from '../src/lifecycle.js';
import { ORPHAN_LICENCE_MS } from '../src/orphanTreeLane.js';
import { ORPHAN_TREE_LIVE_MARKER } from '../../shared/switches.js';
import { checkpointWithLease } from './delegationLeaseFixture.js';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { DELEGATION_CHECKPOINT_FILE, type DelegationDurability } from '../src/coord/delegation-checkpoint.js';
import type { DeepReadonly, DelegationCheckpointV1 } from '../src/coord/delegation-model.js';
import { beatLeaseHold } from '../src/orphanTreeBeat.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

type Read = () => DeepReadonly<DelegationCheckpointV1> | null;
interface Lane { applier(): Promise<DelegationDurability | null> }
interface Seen { delegationLane(): Lane; orphanBeat: { checkpointIfReady: Read; pass(): Promise<void>; health(): { leaseUnready?: number } | null } }

const watchers: FleetWatcher[] = [];
afterEach(async () => { await Promise.all(watchers.splice(0).map((w) => w.closeDelegation().catch(() => undefined))); });

/** A box with one token-clean `claude` tree, as ccd would answer for it: its census, its audit, and `ws-orphan` (recorded). */
function oneTreeBox(tree: string) {
  const hex = Buffer.from(tree).toString('hex');
  const calls: string[][] = [];
  const ok = (doc: unknown): CcdResult => ({ ran: true, ok: true, stdout: JSON.stringify(doc), stderr: '', killed: false, signal: null });
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => {
    calls.push([...argv]);
    if (argv[0] === 'ws-audit' && argv.includes('--orphans')) return ok({ mode: 'orphans', truncated: false, rows: [{ pathHex: hex, class: 'claude' }] });
    if (argv[0] === 'ws-audit' && argv.includes('--orphan-hex')) {
      return ok({ mode: 'orphan', pathHex: hex, class: 'claude', verdict: 'token', refusal: null, detail: '', token: 'a'.repeat(64), rescueToken: null });
    }
    if (argv[0] === 'ws-orphan') return ok({ removed: true, pathHex: hex, class: 'claude', branch: 'left', pinned: 0 });
    throw new Error(`unexpected ccd ${argv.join(' ')}`);
  };
  return { runCcd, acts: (): string[][] => calls.filter((c) => c[0] === 'ws-orphan'), audits: (): number => calls.filter((c) => c.includes('--orphan-hex')).length };
}

/** A watcher over a fixture home; `before` lays files in its `~/.ccrc` before anything opens the applier. With `box`, the
 *  watcher's ccd is that box (with the orphan lane's capabilities and its live marker), and its monotonic clock is `clock`. */
function world(before: (ccrcDir: string) => void = () => undefined,
  box?: { runCcd: ReturnType<typeof oneTreeBox>['runCcd']; clock: { now: number } }): { watcher: FleetWatcher; seen: Seen } {
  const home = mkTmp('ccrc-orphan-ready-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-orphan-ready-projects-') } as never);
  mkdirSync(cfg.ccrcDir, { recursive: true });
  before(cfg.ccrcDir);
  const coord = new CoordStore(openCoordDb(path.join(cfg.ccrcDir, 'coord.db')));
  const verbs = box === undefined ? ['caps'] : ['caps', 'orphan-v1', 'reclaim-pause-v1', 'actor-flags-v1'];
  if (box !== undefined) writeFileSync(path.join(cfg.registryDir, ORPHAN_TREE_LIVE_MARKER), '');
  const deps = {
    ...testDeps(home), monotonicMs: box === undefined ? () => Date.now() : () => box.clock.now, cfg, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: verbs }, ...(box === undefined ? {} : { runCcd: box.runCcd }),
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  watchers.push(watcher);
  return { watcher, seen: watcher as unknown as Seen };
}

const TREE = '/p/demo/.claude/worktrees/agent-a';

describe("the orphan beat reads the watcher's ready checkpoint (review 1475 F2)", () => {
  it('W5-O13g: before the applier opens the read is null, and the beat stops a claude tree', async () => {
    const { watcher, seen } = world();
    expect(watcher.delegationCheckpointIfReady()).toBeNull();
    expect(seen.orphanBeat.checkpointIfReady()).toBeNull();
    expect((await beatLeaseHold(seen.orphanBeat.checkpointIfReady)(TREE, 'claude')).kind).toBe('not-ready');
  });

  it('W5-O13g: while the applier is reconstructing the read is null, so the beat stops a claude tree and leaves a ccd-root one free', async () => {
    const { watcher, seen } = world((dir) => { writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), '{"v":1} x\n'); });
    const d = await seen.delegationLane().applier();
    expect(d).not.toBeNull();
    expect(d!.state().phase).toBe('reconstructing');                       // the real applier, refusing a checkpoint it cannot decode
    expect(d!.state().checkpoint).toBeDefined();                            // it still carries a checkpoint: only the phase says not to trust it
    expect(watcher.delegationCheckpointIfReady()).toBeNull();
    expect(seen.orphanBeat.checkpointIfReady()).toBeNull();
    expect((await beatLeaseHold(seen.orphanBeat.checkpointIfReady)(TREE, 'claude')).kind).toBe('not-ready');
    expect((await beatLeaseHold(seen.orphanBeat.checkpointIfReady)('/w/demo/still-cove', 'ccd-root')).kind).toBe('free');   // composed as on main
  });

  it('W5-O13g: once the applier is ready the read is its checkpoint, and the beat is wired to that read', async () => {
    const { watcher, seen } = world();
    const d = await seen.delegationLane().applier();
    expect(d!.state().phase).toBe('ready');
    const cp = watcher.delegationCheckpointIfReady();
    expect(cp).not.toBeNull();
    expect(cp).toBe(d!.state().checkpoint);
    expect(seen.orphanBeat.checkpointIfReady()).toBe(cp);                  // the beat's thunk is the watcher's read, not a stub
    expect((await beatLeaseHold(seen.orphanBeat.checkpointIfReady)(TREE, 'claude')).kind).toBe('free');   // no lease holds it
  });

  /** The beat's own pass, twice: a first sighting, then (an hour on, by the beat's clock) the act job, which asks the hold the
   *  beat hands its sweep. */
  const twoPasses = async (seen: Seen, clock: { now: number }): Promise<void> => {
    await seen.orphanBeat.pass();
    clock.now += ORPHAN_LICENCE_MS + 1;
    await seen.orphanBeat.pass();
  };

  it("W5-O13i: the beat's own pass, the watcher's read reconstructing: the claude tree composes no ws-orphan and is counted lease-unready", async () => {
    const box = oneTreeBox(TREE); const clock = { now: 1_000_000 };
    const { watcher, seen } = world((dir) => { writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), '{"v":1} x\n'); }, { runCcd: box.runCcd, clock });
    expect((await seen.delegationLane().applier())!.state().phase).toBe('reconstructing');
    expect(watcher.delegationCheckpointIfReady()).toBeNull();
    await twoPasses(seen, clock);
    expect(box.audits()).toBe(2);                                          // the act job ran its audit, so it reached the hold
    expect(box.acts()).toEqual([]);
    expect(seen.orphanBeat.health()!.leaseUnready).toBe(1);
  });

  it("W5-O13i: the beat's own pass, the read ready and the tree leased: no ws-orphan; ready and unleased: the act composes it (CONTROL)", async () => {
    for (const [canonicalPath, want] of [[TREE, 0], ['/p/demo/.claude/worktrees/agent-z', 1]] as const) {
      const box = oneTreeBox(TREE); const clock = { now: 1_000_000 };
      const { watcher, seen } = world(() => undefined, { runCcd: box.runCcd, clock });
      // the read ready, holding a retained lease at `canonicalPath` (the applier's real checkpoint holds no lease, so the read is
      // stood in on the watcher itself; the beat's thunk calls it on every act job)
      const cp = checkpointWithLease({ canonicalPath, disposition: 'retained', cleanupDueAt: '2099-01-01T00:00:00.000Z' });
      (watcher as unknown as { delegationCheckpointIfReady: Read }).delegationCheckpointIfReady = () => cp;
      await twoPasses(seen, clock);
      expect(box.audits(), canonicalPath).toBe(2);
      expect(box.acts(), canonicalPath).toHaveLength(want);
      expect(seen.orphanBeat.health()!.leaseUnready, canonicalPath).toBeUndefined();
    }
  });
});
