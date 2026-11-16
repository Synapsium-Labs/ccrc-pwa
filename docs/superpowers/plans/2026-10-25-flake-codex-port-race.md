# The codex-lane fixture's free ports cannot be taken before they are bound

**Size:** S. **Deploy class:** server test fixtures only (`server/test/codexLaneFixture.ts`, `server/test/ccgpt-proxy.test.ts`); no `ccd/`, `agent/`, `pwa/` or wire change. One task.

## Problem

`freePort` listened on port 0, read the port, closed it, and handed the number to a case that bound it later: a listener the case spawns, or a tier ccrc starts from the roster. In between, any other test in the same CI shard that bound port 0 could be handed the same port by the kernel, and the later bind failed with `EADDRINUSE`. `ccgpt-proxy.test.ts` had its own copy of the same helper.

## Task 1: choose ports nobody else draws from (D-6856)

**Files:** `server/test/codexLaneFixture.ts` (the ports section), `server/test/codex-lane-ports.test.ts` (new), `server/test/ccgpt-proxy.test.ts` (drops its local `freePort`).

**Steps:** `freePort` probes ports in 12000-31999, below every supported kernel's ephemeral range, skipping 26000-28999 (`shutdown-seal.test.ts` binds `26000 + pid % 3000`). Each vitest worker draws from its own 500-port slice, keyed by `VITEST_POOL_ID`, starting at a random point, and never issues a port twice.

**Verify:** `codex-lane-ports`, the codex-lane suites, `ccgpt-proxy`, `dtbd`, `deviation-refs`, `single-definition`.

## Deviations found

- **D-6856** — `flake-codex-port-race`: the codex-lane test fixture's `freePort` chooses ports below the kernel's ephemeral range, outside the fixed band of `shutdown-seal.test.ts`, from a slice owned by one vitest worker (by `VITEST_POOL_ID`), and never twice in one process. A port-0 bind elsewhere, the seal suite, or a parallel worker can no longer take a port between the probe and the bind. `ccgpt-proxy.test.ts` uses the same helper instead of its own port-0 copy.
