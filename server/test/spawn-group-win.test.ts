// spawnSyncGroup's bound on Windows (Go core wave 2, Task 9b): node's own spawnSync timeout kills the direct child
// only, and a child's children keep the pipes open, so a hung hook (an MSYS2 bash and its subshells) stalled a run for
// 40 minutes. The Windows arm kills the whole tree at the bound (winTreeKill.cjs) and answers as a timeout does.
import { describe, it, expect } from 'vitest';
import { HARNESS_BASH } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

describe.skipIf(process.platform !== 'win32')('spawnSyncGroup on Windows: the bound kills the tree', () => {
  it('a hung bash whose subshell holds stdout returns at the bound as ETIMEDOUT, not when the subshell ends', () => {
    const t0 = Date.now();
    const r = spawnSyncGroup(HARNESS_BASH, ['-c', 'node -e "setTimeout(() => {}, 60000)" & sleep 60'], { encoding: 'utf8', timeout: 2000 });
    expect(Date.now() - t0, 'returned near its bound').toBeLessThan(15_000);
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
    expect(r.status).toBeNull();
  });
  it('a call that ends inside its bound answers its own status and output', () => {
    const r = spawnSyncGroup(HARNESS_BASH, ['-c', 'cat; echo out; exit 3'], { encoding: 'utf8', timeout: 20_000, input: 'in\n' });
    expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 3, stdout: 'in\nout\n' });
  });
});
