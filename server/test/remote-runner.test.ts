import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet, FleetClient } from '../src/remote/client.js';
import { createRunner } from '../src/remote/runner.js';
import { SPAWN_STALL_MS } from '../../shared/api.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

describe('remote Runner — exec over the agent WS', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('runs a whitelisted tmux subcommand through the client and returns a real exit code', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(typeof res.code).toBe('number');
    expect(typeof res.stdout).toBe('string');
    expect(typeof res.stderr).toBe('string');
  });

  it('a non-whitelisted command comes back as a non-zero result, never throws', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    const res = await fleet.runner('rm', ['-rf', '/']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('forbidden');
  });

  it('never throws when the fleet is disconnected — returns a failing ExecResult', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });

    await agent.close(); // yank the transport out from under the client
    agent = undefined; // already closed — afterEach shouldn't double-close
    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(res).toMatchObject({ code: 1, stdout: '' });
    expect(res.stderr.length).toBeGreaterThan(0);
  });
});

describe('wireCmd — absolute ccdBin normalization (agent whitelist takes bare names only)', () => {
  it('maps any …/ccd path to bare ccd, leaves everything else alone', async () => {
    const { wireCmd } = await import('../src/remote/runner.js');
    expect(wireCmd('/home/you/.local/bin/ccd')).toBe('ccd');
    expect(wireCmd('ccd')).toBe('ccd');
    expect(wireCmd('tmux')).toBe('tmux');
    expect(wireCmd('/usr/bin/tmux')).toBe('/usr/bin/tmux'); // only ccd is re-homed
  });
});

describe('per-verb timeouts', () => {
  const seen: number[] = [];
  const client = {
    request: async (req: { timeoutMs?: number }) => { seen.push(req.timeoutMs ?? -1); return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as FleetClient;

  it.each([
    [['pr-state', '--session', 'x'], 20_000],
    // Same reach and same number as pr-state: it shells out to `git
    // ls-remote` before it will rename. Without this row, deleting or
    // changing the entry in CCD_VERB_TIMEOUT_MS cannot fail a single test.
    [['ws-rename', '--session', 'x', '--branch', 'ws/x'], 20_000],
    [['ws-archive', '--session', 'x'], 60_000],
    [['ws-restore', '--session', 'x'], 60_000],
    [['ws-audit', '--session', 'x'], 90_000],
    [['ws-reap', '--expect', 'a'.repeat(64), '--session', 'x'], 240_000],
    // The two SPAWNING verbs (F8, 2026-08-12). Both run `_spawn`, which blocks
    // in `_accept_first_run_prompts` until the new pane renders a ready banner
    // — a COLD Claude Code start in a fresh workspace HOME, which on the live
    // fleet took well past 90 s (MCP servers awaiting authentication slow the
    // boot). At the flat default the agent killed `ws-add` MID-SPAWN, after the
    // worktree and the registry rows were written and before `_reg_set started
    // 1`, orphaning a fully-registered workspace with no session and answering
    // the dispatch with `fleetFailed` and an EMPTY stderr. These two rows are
    // what stop that budget quietly reverting to the flat default.
    [['ws-add', 'ccrc-pwa'], 300_000],
    [['ensure', 'x'], 300_000],
    // The table is a SUBSET check, so a new row reds nothing on its own — which is
    // the discipline this table already states about `ws-rename` ("Without this
    // row, deleting or changing the entry cannot fail a single test"). These two
    // inherited the flat 90 s. Both outcomes of `_supervised_start` are BOUNDED,
    // so this is a correctness fix rather than a latent F8 — but the unsupervised
    // fallback's bound is `SPAWN_SETTLE_S` (240 s), which the old 90 s did not
    // cover. A verb whose worst case exceeds its budget should say so here.
    [['start', 'demo-quiet-basin'], 300_000],
    [['enable', 'demo-quiet-basin'], 300_000],
  ])('sends %j with a %i ms budget', async (args, ms) => {
    seen.length = 0;
    await createRunner(client)('/home/u/.local/bin/ccd', args as string[]);
    expect(seen[0]).toBe(ms);
  });

  it('still gives tmux its own short budget', async () => {
    seen.length = 0;
    await createRunner(client)('tmux', ['has-session', '-t', 'x']);
    expect(seen[0]).toBe(10_000);
  });

  it('falls back to the flat ccd default rather than throwing when args is empty', async () => {
    seen.length = 0;
    await createRunner(client)('/home/u/.local/bin/ccd', []);
    expect(seen[0]).toBe(90_000);
  });

  it('SPAWN_STALL_MS >= the `ws-add` budget this runner actually enforces — the console never calls a ' +
     'dispatch stalled while the runner is still legitimately waiting', async () => {
    // THE INEQUALITY BECOMES A MECHANISM. `SPAWN_STALL_MS` (shared/api.ts) is a
    // RENDERING threshold and the number above is a TIMEOUT — two different
    // questions, deliberately two constants, neither derived from the other
    // (`single-definition` sees one of each and would refuse a copy). But
    // "deliberately >= the ceiling" lived only in prose, in two files, and a
    // comment is a request: widen the `ws-add` row past 360 s and the console
    // would start rendering *dispatch never completed — a workspace may exist*
    // over a spawn the runner is still waiting on.
    //
    // PRECISELY WHAT THIS ADDS, since the row above is not nothing: that row
    // pins the EXACT budget, so a widening does already cost a test — but the
    // intended maintenance move is to update the row to the new number, and at
    // that moment nothing anywhere mentions the threshold. This line is what
    // speaks up then. The exact-value row makes the CHANGE visible; this makes
    // the RELATIONSHIP load-bearing, which is the half that was prose.
    //
    // MEASURED, NOT RE-STATED. The budget is read back through the same
    // `createRunner` seam the table above uses rather than by exporting
    // `CCD_VERB_TIMEOUT_MS` or `timeoutMsFor` — those are module-private on
    // purpose, and this asserts the number that reaches the wire, which is what
    // the runner enforces and therefore the only number the inequality is about.
    // Deleting the `ws-add` row keeps this green, correctly: the fall-through is
    // 90 s, further BELOW the threshold, and the render still waits past it.
    //
    // `ws-add` ONLY, and the omission is deliberate: `ensure` shares the 300 s
    // budget but is the D-1 RESUME verb, which mints no workspace and stamps no
    // `dispatchStartedAt` at all (`run-routes.test.ts` pins that scope), so its
    // ceiling can never move what this threshold renders.
    seen.length = 0;
    await createRunner(client)('/home/u/.local/bin/ccd', ['ws-add', 'ccrc-pwa']);
    expect(SPAWN_STALL_MS).toBeGreaterThanOrEqual(seen[0]);
  });
});

describe('§1.4 — asExecResult stops narrowing a distinction it received', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ccrcRoot = path.resolve(here, '..', '..');
  const clientAnswering = (res: unknown) =>
    ({ request: async () => res }) as unknown as FleetClient;

  it('carries `killed` through the adapter', async () => {
    // THE L3 RULE ("an adapter may not narrow a distinction it received") failing
    // in exactly the place §1.5 depends on: `asExecResult` rebuilds the object
    // field by field, so anything the agent sends beyond code/stdout/stderr is
    // DISCARDED. The three hops are `ExecResult` (server/src/exec.ts), this
    // function, and `ccd()` (server/src/lifecycle.ts). There is no type called
    // `ExecRes` in either `src` tree.
    const r = await createRunner(clientAnswering(
      { code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' },
    ))('/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBe(true);
  });

  it('reads an older agent\'s omission as absent, never as true', async () => {
    const r = await createRunner(clientAnswering({ code: 1, stdout: '', stderr: 'boom' }))(
      '/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBeUndefined();
  });

  it('refuses a non-boolean `killed` rather than coercing it', async () => {
    const r = await createRunner(clientAnswering({ code: 1, stdout: '', stderr: '', killed: 'yes' }))(
      '/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBeUndefined();
  });

  it('THE CATCH PATH NEVER CLAIMS A KILL — three facts sit on code 1, not two', () => {
    // ccd refused, we killed ccd, and WE DO NOT KNOW BECAUSE THE LINK FAILED.
    // `createRunner`'s catch returns `{code:1, stderr: e.message}` for any
    // transport failure — a dropped socket, a client-side wait expiry — and §1.5
    // must not adopt on it. Pinned as SOURCE because the arm is unreachable
    // through a client stub that resolves.
    const src = readFileSync(
      path.join(ccrcRoot, 'server/src/remote/runner.ts'), 'utf8');
    expect(src).toContain(
      "return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };");
    expect(src).not.toMatch(/catch[\s\S]{0,200}killed:\s*true/);
  });
});
