// `setupFiles` entry: THE SPAWN FENCE ON WINDOWS (Go core wave 2, fix round 2; the fix wave's re-review N1). Every
// child_process spawner in this worker goes through `pathFence.ts#fenceSpawnArgs`: the child's env is fenced, and a spawn
// whose bash would not be MSYS2's (System32's WSL launcher among them) throws before anything starts. One choke point,
// so no harness opts in and none can skip it. Nothing is wrapped off Windows. Pinned by spawn-fence.test.ts.
import { installSpawnFence } from './pathFence.ts';

installSpawnFence();
