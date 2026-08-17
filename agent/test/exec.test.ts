import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** A fake `tmux` binary that echoes its args, so exec tests can assert real
 *  stdout/stderr/code flow through the agent without depending on a real
 *  tmux install or an actual session existing in this sandbox. */
//
// ROUND 3. This file used to keep its OWN `stubDirs` array plus its own
// `afterAll` — a second temp-dir registry inside a package that already has
// one, which is exactly the pattern the previous round's class_check claimed
// had been resisted ("the registry is now one per package"). It never leaked,
// because its hook was a hook; the defect was that the discipline was
// re-derived here instead of imported, so the guard in `tmpfixtures.test.ts`
// could not see it, and the next file to copy this one would copy the
// re-derivation and not necessarily the hook. `mkTmp` is the one registry.
function makeStubBinary(name: string, body: string): string {
  const dir = mkTmp('ccrc-agent-bin-');
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

interface ExecRes {
  ok: boolean; code?: number; stdout?: string; stderr?: string; err?: string;
  killed?: boolean; signal?: string | null;
}

describe('ccrc-agent exec whitelist', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  // `rejects a whitelisted command with a non-whitelisted subcommand` below sends
  // `tmux kill-server`. Its safety does NOT come from this file: it comes from
  // test/contain-path.setup.ts, which puts a harmless `tmux` earliest on PATH for
  // every agent test process. That containment is structural on purpose —
  // measured three times in one morning, a widening mutation of EXEC_WHITELIST
  // (`tmux: [[]]`) let that argv through to the real binary and killed the box's
  // tmux server, all eleven ccrc sessions with it, including the one driving the
  // sweep. A negative test that stays harmless only while the code under test is
  // correct is a loaded gun pointed at the fleet.
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

  it('runs a whitelisted tmux subcommand and returns its exit code', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // No real tmux session exists, but `has-session` is whitelisted — the
    // agent must actually invoke it (nonzero exit, not a forbidden error).
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session', '-t', 'cc-nope'] });
    expect(res.ok).toBe(true);
    expect(typeof res.code).toBe('number');
  });

  it('runs a whitelisted ccd subcommand by exact bare command name', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // Bare "ccd" — exact match, no basename matching — resolves via PATH.
    // Even if it 404s (ENOENT) the whitelist check itself must pass, and
    // execFile's ENOENT still comes back as a real (non-forbidden) result.
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'ccd', args: ['ensure', 'foo'] });
    expect(res.ok).toBe(true);
    expect(typeof res.code).toBe('number');
  });

  it('rejects a non-whitelisted command entirely', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'rm', args: ['-rf', '/'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('rejects a whitelisted command with a non-whitelisted subcommand', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['kill-server'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('rejects ccd with a non-whitelisted subcommand', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'ccd', args: ['ls'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('actually invokes the binary and returns its real stdout/stderr/exit code', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // Exec now requires an EXACT bare command name ("tmux"), so to exercise
    // real process invocation with controlled output we put our stub on
    // PATH under that exact name rather than passing an absolute path.
    const bin = makeStubBinary('tmux', 'echo "out:$1"; echo "err:$1" 1>&2; exit 7');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session'] });
      expect(res).toMatchObject({ ok: true, code: 7, stdout: 'out:has-session\n', stderr: 'err:has-session\n' });
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('rejects an absolute path even when its basename matches a whitelisted command (no basename matching)', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const bin = makeStubBinary('ccd', 'exit 0');
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: bin, args: ['swap', 'x'] });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'forbidden' });
  });

  it('answers forbidden for gh pr create over the real WS surface', async () => {
    // The unit test above proves the predicate; this proves the WIRE. A gh
    // grant would be invisible to a predicate test that nobody updated.
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, {
      op: 'exec', cmd: 'gh',
      args: ['pr', 'create', '--repo', 'o/r', '--head', 'x', '--base', 'main', '--title', 't', '--body', 'b'],
    });
    expect(res.ok).toBe(false);
    expect(res.err).toBe('forbidden');
  });

  it('answers forbidden for a ws-reap without --expect', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const res = await client.req<ExecRes>(1, { op: 'exec', cmd: 'ccd', args: ['ws-reap', 'demo-quiet-basin'] });
    expect(res.ok).toBe(false);
    expect(res.err).toBe('forbidden');
  });

  it('advertises the deployed ccd verbs in its ready frame', async () => {
    // A verb can pass the whitelist and not exist on the box, because
    // ~/.local/bin/ccd is a COPY. Without this the UI shows a merged-purple
    // dot that never resolves.
    fixture = makeFixture();
    const bin = path.join(fixture.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccd'), '#!/bin/sh\n[ "$1" = caps ] && printf "start\\nws-reap\\n"\n');
    chmodSync(path.join(bin, 'ccd'), 0o755);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    const ready = await client.hello();
    expect((ready as { ccdVerbs?: string[] }).ccdVerbs).toEqual(['start', 'ws-reap']);
  });

  it('reports no verbs rather than crashing when ccd is missing entirely', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    const ready = await client.hello();
    expect((ready as { ccdVerbs?: string[] }).ccdVerbs).toEqual([]);
  });

  it('ignores stdout from a failing ccd caps call — only a clean exit is evidence', async () => {
    // A nonzero exit with something ON stdout (a usage banner, a partial
    // dump before a crash) must not leak through as advertised verbs.
    fixture = makeFixture();
    const bin = path.join(fixture.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccd'), '#!/bin/sh\n[ "$1" = caps ] && printf "start\\n"\nexit 1\n');
    chmodSync(path.join(bin, 'ccd'), 0o755);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    const ready = await client.hello();
    expect((ready as { ccdVerbs?: string[] }).ccdVerbs).toEqual([]);
  });

  it('trims incidental whitespace from each ccd caps line before matching', async () => {
    fixture = makeFixture();
    const bin = path.join(fixture.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccd'), '#!/bin/sh\n[ "$1" = caps ] && printf "  start \\nws-reap\\n"\n');
    chmodSync(path.join(bin, 'ccd'), 0o755);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    const ready = await client.hello();
    expect((ready as { ccdVerbs?: string[] }).ccdVerbs).toEqual(['start', 'ws-reap']);
  });

  it('accepts a 300 s exec timeout — ws-reap on a multi-GB worktree needs it', () => {
    // Asserted on the constant rather than by sleeping 300 s.
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(src).toContain('const MAX_EXEC_TIMEOUT_MS = 300_000;');
  });

  it('tells a SIGTERM at the deadline apart from a plain non-zero exit (§1.4)', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // Two children that both answer `code: 1` today and are byte-identical on the
    // wire: one that REFUSED, one we KILLED. That collapse is why the dispatch
    // layer cannot tell a real failure from a timeout, and §1.5's adoption gate
    // rests entirely on telling them apart.
    //
    // Both argv are WHITELISTED subcommands (`has-session`, `capture-pane`): the
    // exec op checks `isExecAllowed` BEFORE it ever spawns, so a made-up token
    // like `hang` would be answered `forbidden` and never reach `runExec`. The
    // stub keys its sleep off the subcommand instead.
    const bin = makeStubBinary('tmux', 'if [ "$1" = capture-pane ]; then sleep 30; fi; exit 1');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const refused = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session'] });
      expect(refused).toMatchObject({ ok: true, code: 1, killed: false, signal: null });

      const killed = await client.req<ExecRes>(2, {
        op: 'exec', cmd: 'tmux', args: ['capture-pane'], timeoutMs: 200,
      });
      expect(killed).toMatchObject({ ok: true, code: 1, killed: true });
      expect((killed as { signal?: unknown }).signal).toBe('SIGTERM');
    } finally {
      process.env.PATH = origPath;
    }
  }, 20_000);

  it('leaves stderr empty on a kill, and the reason is NOT "a killed child writes nothing"', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // C2's correction, worth pinning because the false version is written down in
    // this repo: `execFile` DELIVERS whatever the child had already buffered. The
    // stderr is empty because NO STDERR-WRITING STATEMENT WAS REACHED — the child
    // was still asleep. This stub proves it by writing to stderr BEFORE it sleeps.
    const bin = makeStubBinary('tmux', 'echo "partial" 1>&2; sleep 30');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const res = await client.req<ExecRes>(1, {
        op: 'exec', cmd: 'tmux', args: ['capture-pane'], timeoutMs: 300,
      });
      expect(res).toMatchObject({ ok: true, killed: true });
      expect((res as { stderr?: string }).stderr).toContain('partial');
    } finally {
      process.env.PATH = origPath;
    }
  }, 20_000);
});

describe('resolveSpawnCmd — ccd resolved against the agent home (systemd PATH lacks ~/.local/bin)', () => {
  it('resolves bare ccd to $HOME/.local/bin/ccd and leaves tmux to PATH', async () => {
    const { resolveSpawnCmd } = await import('../src/server.js');
    expect(resolveSpawnCmd('ccd', '/home/you')).toBe('/home/you/.local/bin/ccd');
    expect(resolveSpawnCmd('tmux', '/home/you')).toBe('tmux');
  });
});
