# Caps Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent stops serving a verb list it read at boot, so installing a new `ccd` makes its verbs callable within 60 seconds without restarting anything.

**Architecture:** A new `caps` op on the agent WS protocol. The agent's cached verb list moves from a by-value parameter into a mutable holder that both the `ready` frame and the new handler read, so a refresh survives the next reconnect. The agent stat-gates the re-exec on the resolved `ccd` path. On the server, `FleetClient` gains a `caps()` method and `FleetWatcher` gains a fourth lane at 60s.

**Tech Stack:** TypeScript ESM (Node ≥22), `ws`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-ccrc-caps-refresh-design.md`

## Global Constraints

- **The four pinned assertions must pass untouched.** `agent/test/exec.test.ts:178-184`, `:186-198`, `server/test/remote-connect.test.ts:31`, `server/test/whitelist-subset.test.ts:188-192`. A failed `ccd caps` still yields `[]`, and `[]` still means "refuse every gated verb". If a step makes one of these fail, the step is wrong.
- **`ccd caps` stays off `EXEC_WHITELIST`.** It is reachable only as a protocol op. The stance at `agent/src/server.ts:293-296` stands.
- **No module-level `let` in `agent/src`.** Every module binding in the package is `const`, and agent tests boot several real agents in one process (`agent/test/helpers.ts:33-43`), so module-scoped mutable state would leak between concurrently-live agents. All new state is per-`startAgent` closure state.
- **Both sides of the wire ship together.** `infra/ccrc/` is the live deploy source until spec 3; any change here also lands in `ccrc-pwa` (finding 4 of `2026-08-03-ccrc-pwa-findings-for-specs-1-3.md`).
- **Mutation sweep the whole diff** — one literal-string mutant per added construct, full suite per mutant, sha256-verified restore between. Per `.superpowers/sdd/<plan>/CONSTRAINTS.md`.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `infra/ccrc/shared/agent-protocol.ts` | the wire contract, single source of truth for both sides | add `CapsReq`, extend `AgentReq`, document the reply payload |
| `infra/ccrc/agent/src/server.ts` | agent WS surface: validate, dispatch, exec | verb list becomes a holder; add `caps` validate + handle; stat-gate the re-read |
| `infra/ccrc/agent/test/caps.test.ts` | new — the refresh's agent-side behaviour | create |
| `infra/ccrc/server/src/remote/client.ts` | fleet transport, `FleetState` owner | add `caps()`; `onReady` unchanged |
| `infra/ccrc/server/src/server.ts` | `Deps` declaration | add the optional `refreshCaps` seam |
| `infra/ccrc/server/src/index.ts` | composition root | wire `refreshCaps` in remote mode only |
| `infra/ccrc/server/src/watch.ts` | the sweep lanes | add `CAPS_REFRESH_MS` lane |
| `infra/ccrc/server/test/caps-refresh.test.ts` | new — server-side lane + reconnect behaviour | create |

`readCcdVerbs` keeps its name, its 10s bound and its `[]`-on-failure contract. Only its *call frequency* and where its result is stored change.

---

### Task 1: The `caps` op exists on the wire

**Files:**
- Modify: `infra/ccrc/shared/agent-protocol.ts:13-30`

**Interfaces:**
- Consumes: nothing.
- Produces: `CapsReq` — `{ t: 'req'; id: number; op: 'caps' }`. Reply payload: `{ verbs: string[] }` on `ResOk`. `AgentReq` gains `CapsReq`.

- [ ] **Step 1: Add the request interface**

Insert after the `StatReq` line (`agent-protocol.ts:18`), keeping the file's one-line-per-interface style:

```ts
export interface CapsReq   { t: 'req'; id: number; op: 'caps' }
```

- [ ] **Step 2: Extend the union**

Replace the `AgentReq` line (`:25`):

```ts
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq;
```

- [ ] **Step 3: Document the reply payload**

In the payload comment block (`:28-30`), append to the last line:

```ts
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}
```

- [ ] **Step 4: Typecheck**

Run: `cd infra/ccrc/server && npx tsc --noEmit`
Expected: PASS. Nothing consumes `CapsReq` yet, so this is a pure addition.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/shared/agent-protocol.ts
git commit -m "feat(ccrc): the wire learns a caps op

A request the server can send to re-ask what ccd implements, rather than
inferring it forever from the ready frame the agent sent at boot."
```

---

### Task 2: The agent's verb list becomes refreshable

**Files:**
- Modify: `infra/ccrc/agent/src/server.ts:297-306` (`readCcdVerbs`), `:308` (`handleConnection` signature), `:340` (the `ready` send), `:417-421` (the call site and `wss.on('connection')`)
- Test: `infra/ccrc/agent/test/caps.test.ts` (create)

**Interfaces:**
- Consumes: `CapsReq` from Task 1; `statPath` from `./fileops.js` (already imported at `server.ts:26`, returns `{mtimeMs, size} | null`, never throws); `resolveSpawnCmd` (already exported, `server.ts:82`).
- Produces: `type VerbCache = { verbs: string[]; mtimeMs: number | null; size: number | null }`, created per `startAgent` and passed to `handleConnection` as its 4th parameter in place of `string[]`. `refreshVerbs(cache, home): Promise<string[]>` — re-execs only when the stat differs, returns the current list either way.

**Why a holder and not a `let`:** `handleConnection` takes the list by value (`server.ts:308`) and closes over that parameter when it sends `ready` (`:340`). Reassigning an outer `let` would not reach a live connection, and a module-level `let` would leak between the several agents the test suite boots in one process. A holder object is mutated in place and every connection sees the same one.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/agent/test/caps.test.ts`. It follows the suite's existing shape — a real agent on port 0 via `boot(fixture)`, a real `ws` client, and a `#!/bin/sh` stub ccd written into `fixture.home/.local/bin/ccd`, which works because `resolveSpawnCmd` resolves against `home` rather than PATH.

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface CapsRes { ok: boolean; verbs?: string[]; err?: string }

/** Writes the ccd the agent will actually exec: `resolveSpawnCmd` resolves
 *  `ccd` against `home`, never PATH, so a stub here is the whole fake. */
function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe('caps op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('answers with the verbs ccd currently prints, not the ones it printed at boot', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start\necho stop');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop'] });

    // A new ccd lands under the running agent — the case the outage was.
    writeCcd(fixture.home, 'echo start\necho stop\necho ws-rename');
    expect(await client.req<CapsRes>(2, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop', 'ws-rename'] });
  });

  it('a caps read that fails yields [] rather than keeping a list that no longer holds', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start'] });

    writeCcd(fixture.home, 'exit 1');
    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: [] });
  });

  it('an unchanged ccd is not re-execed', async () => {
    fixture = makeFixture();
    // Appends a line per invocation, so the file's length counts execs.
    const marker = path.join(fixture.home, 'execs');
    writeCcd(fixture.home, `echo x >> ${marker}\necho start`);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    await client.req<CapsRes>(1, { op: 'caps' });
    const after1 = readFileSync(marker, 'utf8').length;
    await client.req<CapsRes>(2, { op: 'caps' });
    expect(readFileSync(marker, 'utf8').length).toBe(after1);
  });
});
```

`readFileSync` joins the `node:fs` import above. The third test is the stat gate's only direct proof — without it a mutant that always re-execs passes every other assertion in this file.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/agent && npx vitest run test/caps.test.ts`
Expected: FAIL. The agent replies `{ok: false, err: 'bad-request'}` because `validateReq`'s `default: return null` (`server.ts:288-289`) rejects the unknown op before `handleReq` is reached.

- [ ] **Step 3: Add the cache type and the refresh function**

Replace `readCcdVerbs` (`server.ts:297-306`) — keep the function and its comment exactly as they are, and add below it:

```ts
/** The list `readCcdVerbs` last produced, plus the stat of the script that
 *  produced it. Per-`startAgent` state, never module-level: the test suite
 *  boots several agents in one process and they must not share a cache. */
type VerbCache = { verbs: string[]; mtimeMs: number | null; size: number | null };

/** Re-exec `ccd caps` only when the script it would exec has changed. `caps`
 *  is a static heredoc and does no I/O, but a spawn on every server tick would
 *  be tens of thousands of bash processes a day to learn nothing. A replacement
 *  identical in mtime AND size reads as no change — the accepted cost of not
 *  hashing. */
async function refreshVerbs(cache: VerbCache, home: string): Promise<string[]> {
  const st = await statPath(resolveSpawnCmd('ccd', home));
  const mtimeMs = st === null ? null : st.mtimeMs;
  const size = st === null ? null : st.size;
  if (mtimeMs === cache.mtimeMs && size === cache.size) return cache.verbs;
  cache.verbs = await readCcdVerbs(home);
  cache.mtimeMs = mtimeMs;
  cache.size = size;
  return cache.verbs;
}
```

- [ ] **Step 4: Thread the cache through the connection**

Change `handleConnection`'s 4th parameter (`server.ts:308`) from `ccdVerbs: string[]` to:

```ts
function handleConnection(ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number, verbCache: VerbCache): void {
```

and the `ready` send (`:340`) from `send(ws, { t: 'ready', v: 1, ccdVerbs });` to:

```ts
      send(ws, { t: 'ready', v: 1, ccdVerbs: verbCache.verbs });
```

This is the step that stops a reconnect undoing the refresh: `FleetClient.onReady` assigns `state.ccdVerbs` from whatever this frame carries (`remote/client.ts:276-278`), so it must carry the refreshed list rather than a boot-time snapshot.

- [ ] **Step 5: Build the cache at start**

Replace the call site (`server.ts:417`) and the connection arrow (`:421`):

```ts
  const verbCache: VerbCache = {
    verbs: await readCcdVerbs(opts.home),
    mtimeMs: null,
    size: null,
  };
```
```ts
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache));
```

`mtimeMs`/`size` start `null` deliberately: the first `caps` request always re-execs, so a ccd swapped between boot and the first refresh is caught rather than masked by a stat taken after the swap.

- [ ] **Step 6: Validate the op**

In `validateReq`, immediately before the `default:` arm (`server.ts:288`):

```ts
    case 'caps':
      return { t: 'req', id, op: 'caps' } satisfies CapsReq;
```

Add `CapsReq` to the type import list in `server.ts:6-25`, alphabetically — it sorts before `ExecReq`.

- [ ] **Step 7: Handle the op**

In `handleReq`'s switch, alongside the other arms:

```ts
    case 'caps': {
      const verbs = await refreshVerbs(verbCache, ctx.cfg.home);
      send(ws, { t: 'res', id: req.id, ok: true, verbs });
      return;
    }
```

`handleReq` must receive `verbCache`; thread it from `handleConnection` the same way `ctx` is threaded.

- [ ] **Step 8: Run the new test and the pinned ones**

Run: `cd infra/ccrc/agent && npx vitest run`
Expected: PASS, including `test/exec.test.ts:178-184` and `:186-198` unchanged.

- [ ] **Step 9: Commit**

```bash
git add infra/ccrc/agent/src/server.ts infra/ccrc/agent/test/caps.test.ts
git commit -m "feat(ccrc): the agent re-reads ccd caps when ccd changes

The list stops being a value handed to each connection at boot and becomes a
holder every connection shares, so a refresh reaches the next ready frame
instead of being overwritten by it. Stat-gated on the script the agent would
actually exec, so an unchanged ccd costs a stat rather than a bash process."
```

---

### Task 3: The server can ask

**Files:**
- Modify: `infra/ccrc/server/src/remote/client.ts` (add `caps()` beside the existing request methods), `infra/ccrc/server/src/server.ts` (the `Deps` interface), `infra/ccrc/server/src/index.ts` (composition)
- Test: `infra/ccrc/server/test/caps-refresh.test.ts` (create)

**Interfaces:**
- Consumes: the `caps` op from Task 1; `FleetClient`'s existing private `req` machinery (`client.ts:158-178`, a `pending` map keyed by id with a timer).
- Produces: `FleetClient.caps(): Promise<string[] | null>` — `null` when the agent refuses or the transport fails, so a `bad-request` from an older agent is distinguishable from a real empty list. `Deps.refreshCaps?: () => Promise<void>` — present in remote mode only.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/server/test/caps-refresh.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import { type ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe('caps refresh', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close(); fleet = undefined;
    if (agent) await agent.close(); agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('caps() returns what ccd prints now, not what it printed at agent boot', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.ccdVerbs).toEqual(['start']), { timeout: 3000 });

    writeCcd(fixture.home, 'echo start\necho ws-rename');
    expect(await fleet.client.caps()).toEqual(['start', 'ws-rename']);
  });

  it('answers null — not [] — when there is no answer to trust', async () => {
    // No ccd in the fixture home at all: the agent's boot read failed, so its
    // ready frame carried []. A caps() that cannot be trusted must be null, or
    // the seam in index.ts would overwrite a good list with an empty one.
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    await fleet.close(); fleet = undefined;
    // With the transport gone, caps() must resolve null rather than throw.
    expect(await fleet?.client.caps() ?? null).toBeNull();
  });

  it('a reconnect after a refresh does not regress to the agent boot list', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.ccdVerbs).toEqual(['start']), { timeout: 3000 });

    writeCcd(fixture.home, 'echo start\necho ws-rename');
    expect(await fleet.client.caps()).toEqual(['start', 'ws-rename']);

    // Force a reconnect. onReady reassigns state.ccdVerbs from the ready frame,
    // so this fails unless the agent's ready frame serves the refreshed holder.
    fleet.client.ws?.close();
    await vi.waitFor(
      () => expect(fleet!.state.ccdVerbs).toEqual(['start', 'ws-rename']),
      { timeout: 5000 },
    );
  });
});
```

The third test is the regression guard for Task 2 Step 4 and the reason that step exists: it fails if the agent's `ready` frame ever goes back to serving a boot-time snapshot. If `FleetClient` exposes no handle to force a reconnect, add the narrowest one the test needs rather than reaching into private state — and say so in the report.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/caps-refresh.test.ts`
Expected: FAIL with `client.caps is not a function`.

- [ ] **Step 3: Add the method**

In `FleetClient`, beside the other request methods:

```ts
  /** `null` means "no answer to trust" — an agent that predates the op replies
   *  `bad-request` (its `validateReq` rejects unknown ops before `handleReq`),
   *  and a transport failure looks the same. Neither is evidence the fleet has
   *  no verbs, so neither may overwrite a list that worked. */
  async caps(): Promise<string[] | null> {
    try {
      const res = await this.req({ op: 'caps' });
      const verbs = (res as { verbs?: unknown }).verbs;
      if (!Array.isArray(verbs) || !verbs.every((v) => typeof v === 'string')) return null;
      return verbs as string[];
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Add the seam**

In `Deps` (`server/src/server.ts`), add:

```ts
  /** Remote mode only. Local mode reads ccd directly and has nothing to
   *  refresh, so its absence is the mode test — the same shape `fleetState`
   *  already uses. */
  refreshCaps?: () => Promise<void>;
```

In `index.ts`, inside the remote-mode branch where `connectFleet` is already built, add to the deps object:

```ts
    refreshCaps: async () => {
      const verbs = await fleet.client.caps();
      if (verbs !== null) fleet.state.ccdVerbs = verbs;
    },
```

`if (verbs !== null)` is the whole safety property: a refusal or a dropped connection leaves `ccdVerbs` exactly as it was.

- [ ] **Step 5: Run the tests**

Run: `cd infra/ccrc/server && npx vitest run test/caps-refresh.test.ts test/remote-connect.test.ts`
Expected: PASS, `remote-connect.test.ts:31` untouched.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/src/remote/client.ts infra/ccrc/server/src/server.ts infra/ccrc/server/src/index.ts infra/ccrc/server/test/caps-refresh.test.ts
git commit -m "feat(ccrc): the server can ask the fleet what ccd implements

caps() answers null rather than [] when there is no answer to trust, so an
agent too old to know the op cannot be mistaken for a fleet with no verbs."
```

---

### Task 4: The fourth lane

**Files:**
- Modify: `infra/ccrc/server/src/watch.ts` (lane constant beside `TASK_SWEEP_MS:21`, gate inside `tick()`)
- Test: `infra/ccrc/server/test/caps-refresh.test.ts` (extend)

**Interfaces:**
- Consumes: `Deps.refreshCaps` from Task 3.
- Produces: `CAPS_REFRESH_MS = 60_000`, and a `lastCapsAt` field on `FleetWatcher` gating it, matching how the task and PR sweeps gate themselves.

- [ ] **Step 1: Write the failing test**

Append to `test/caps-refresh.test.ts`:

In a new `describe` block in the same file, using the `testDeps` factory the
server suite already has (`test/helpers.ts:31`) and the concrete `Bus`:

```ts
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';

describe('the caps lane', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('asks once a minute, not once a tick', async () => {
    let calls = 0;
    const deps = { ...testDeps(), refreshCaps: async () => { calls += 1; } };
    const w = new FleetWatcher(deps, new Bus(), 2000);

    vi.useFakeTimers();
    await w.tick(); await w.tick(); await w.tick();
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(61_000);
    await w.tick();
    expect(calls).toBe(2);
  });

  it('local mode has nothing to refresh and does not throw', async () => {
    const w = new FleetWatcher(testDeps(), new Bus(), 2000);
    await expect(w.tick()).resolves.not.toThrow();
  });
});
```

`testDeps()` supplies a `runCcd` that always fails, which is what the rest of a
tick wants here — this test asserts only the lane's cadence, and a tick that
finds no sessions is the cheapest way to reach it.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/caps-refresh.test.ts -t 'once a minute'`
Expected: FAIL — `calls` is 0, nothing calls `refreshCaps`.

- [ ] **Step 3: Add the constant**

Beside `TASK_SWEEP_MS` (`watch.ts:21`), with the comment style its neighbours use:

```ts
/** The fourth lane. A ccd install is a deliberate act by a human who is
 *  waiting, so a minute is the longest anyone should have to wonder whether
 *  the fleet noticed — and the agent's stat gate means an unchanged ccd costs
 *  a stat, not a bash process. */
const CAPS_REFRESH_MS = 60_000;
```

- [ ] **Step 4: Gate it inside the tick**

In `tick()`, alongside the other lanes:

```ts
    if (this.deps.refreshCaps && Date.now() - this.lastCapsAt >= CAPS_REFRESH_MS) {
      this.lastCapsAt = Date.now();
      await this.deps.refreshCaps();
    }
```

with the field declared beside the watcher's other lane timestamps:

```ts
  private lastCapsAt = 0;
```

`lastCapsAt = 0` means the first tick after start always refreshes — which is what recovers a server that connected to an agent whose caps read had failed.

- [ ] **Step 5: Run the full server suite**

Run: `cd infra/ccrc/server && npx vitest run`
Expected: PASS, all four pinned assertions included.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/src/watch.ts infra/ccrc/server/test/caps-refresh.test.ts
git commit -m "feat(ccrc): a 60s lane asks the fleet what it can do

lastCapsAt starts at 0 so the first tick after start always asks — which is
what recovers a server that connected to an agent whose boot-time caps read
had already failed."
```

---

### Task 5: Gates

- [ ] **Step 1: Full suites, both packages**

Run: `cd infra/ccrc/agent && npx vitest run && cd ../server && npx vitest run && cd ../pwa && npx vitest run`
Expected: PASS. Record the counts; the PWA count must be unchanged from baseline — this plan touches no PWA file.

- [ ] **Step 2: Typecheck**

Run: `cd infra/ccrc/server && npx tsc --noEmit && cd ../agent && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Mutation sweep**

Sweep the whole diff. One literal mutant per added construct — including `CAPS_REFRESH_MS`'s value, the `verbs !== null` guard in `refreshCaps`, the `mtimeMs === cache.mtimeMs && size === cache.size` conjunction (mutate each side independently), and `lastCapsAt`'s initial `0`. Full suite per mutant, sha256-verified restore between. A survivor is a finding, not a pass.

- [ ] **Step 4: Verify the real thing**

On openclaw, with the branch deployed: note `ccd caps`' current output, touch `~/.local/bin/ccd`, and confirm within 60s that `GET /api/fleet` still reports real PR phases rather than `unsupported`. Then confirm the negative: stop the agent, and check `ccdVerbs` is not cleared.

---

## Spec Coverage

| spec section | task |
|---|---|
| The refresh — `caps` op, 60s lane | 1, 3, 4 |
| The agent's cached list stops being a boot-time constant | 2 (Steps 4-5) |
| Pull not push; `bad-request` from an old agent | 1, 3 |
| Cannot deadlock itself — op, not exec; stays off the whitelist | 1 (no whitelist change anywhere in this plan) |
| Stat-gated re-read on `resolveSpawnCmd('ccd', home)` | 2 (Step 3) |
| `[]` encoding unchanged; four pinned assertions untouched | Global Constraints; verified in 2 (Step 8), 3 (Step 5), 4 (Step 5) |
| Error-handling table, every row | 2 (Steps 1, 3), 3 (Steps 1, 3-4), 4 (Step 1) |
| Definition of done | 5 (Step 4) |

## Final Verification

The definition of done is behavioural and must be demonstrated, not inferred: install a ccd with a verb the fleet did not have, touch nothing else, and watch a control that was greyed out become live inside a minute. Then reconnect the server and confirm it stays live — that is the half a passing unit suite would not have caught.
