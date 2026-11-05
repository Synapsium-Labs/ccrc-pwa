// Delegation broker wave 5 PR4 (Task 5.4.3, D-7828, D-8011; review 1475 F2): the orphan beat's delegation read, over the REAL
// watcher. `FleetWatcher.delegationCheckpointIfReady()` answers the delegation lane's checkpoint only while its applier is
// `ready`: null before the applier opens, and null while it is `reconstructing` (it starts as an empty checkpoint in that
// phase, so a read that ignored the phase would free every `claude`/`superpowers` tree while the applier rebuilds). The beat the
// watcher builds is wired to that read, so its `leaseHold` stops a `claude` tree while reconstructing and reads the checkpoint
// once ready. Each world is a fixture home with its own applier directory; nothing here touches a live box.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
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
interface Seen { delegationLane(): Lane; orphanBeat: { checkpointIfReady: Read } }

const watchers: FleetWatcher[] = [];
afterEach(async () => { await Promise.all(watchers.splice(0).map((w) => w.closeDelegation().catch(() => undefined))); });

/** A watcher over a fixture home; `before` lays files in its `~/.ccrc` before anything opens the applier. */
function world(before: (ccrcDir: string) => void = () => undefined): { watcher: FleetWatcher; seen: Seen } {
  const home = mkTmp('ccrc-orphan-ready-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-orphan-ready-projects-') } as never);
  mkdirSync(cfg.ccrcDir, { recursive: true });
  before(cfg.ccrcDir);
  const coord = new CoordStore(openCoordDb(path.join(cfg.ccrcDir, 'coord.db')));
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, coord, fleetState: { connected: true, downSince: null, ccdVerbs: ['caps'] } };
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

  it('W5-O13g: while the applier is reconstructing the read is null, so the beat stops a claude tree and frees no ccd-root one by a lease', async () => {
    const { watcher, seen } = world((dir) => { writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), '{"v":1} x\n'); });
    const d = await seen.delegationLane().applier();
    expect(d).not.toBeNull();
    expect(d!.state().phase).toBe('reconstructing');                       // the real applier, refusing a checkpoint it cannot decode
    expect(d!.state().checkpoint).toBeDefined();                            // it still carries a checkpoint: only the phase says not to trust it
    expect(watcher.delegationCheckpointIfReady()).toBeNull();
    expect(seen.orphanBeat.checkpointIfReady()).toBeNull();
    expect((await beatLeaseHold(seen.orphanBeat.checkpointIfReady)(TREE, 'claude')).kind).toBe('not-ready');
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
});
