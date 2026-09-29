// D-3400 (amended), D-3413 — the spawn bound's OUTCOME by attributed re-measurement, on the AGENT role (fix round 1,
// item 2; review run 175 F3/F4). A `--detach` parent that outlives the bound is killed, and the op no longer guesses:
// it read `update.json` BEFORE the spawn and reads it AFTER the kill, and L0's `decideKilledSpawn` attributes the change.
//   A. nothing queued (both reads readable and identical, or absent at both; stdout read to EOF with neither the WARN
//      nor the `detached` line)  -> `not-queued`: the server releases idle, the request standing;
//   B. the re-read report names the killed parent's pid and the lease's tag -> ok `accepted` carrying the words: HELD;
//   D. anything else -> ok `accepted` carrying what was seen and that it could not be attributed: HELD.
//
// Three families. (1) The arms against a recorder whose "parent" plants what a real one would have left, each asserting
// the WHOLE reply (F4: the words are the claim, so a wrong sentence reds). (2) END TO END against the REAL `ccd/ccrc`
// behind the REAL launcher in a fixture HOME, through the REAL bounded `makeUpdateSpawn`: arm B (the poisoned
// `systemd-run` records and HANGS, so the real parent has written `queued` and blocks in it) and arm A (`rollback`,
// its release-host `curl` stub sleeping past the bound). Containment is `updateRealBox.ts`'s: an env built from scratch,
// nothing ever starts a unit, and each case asserts the recorder saw exactly what it should and that the sleeping stub
// is dead afterwards. The arm-B case is also the MEASUREMENT of the ruling's pid question: the pid the spawner holds
// is the pid the real parent's `queued` report carries, through the real launcher. (3) The op-level half of "an answer
// that arrives before UPDATE_OP_TIMEOUT_MS while a grandchild holds the pipes" (`update-spawn-deadline.test.ts` pins the
// spawner's half).
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { UPDATE_OP_TIMEOUT_MS, UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS } from '../../shared/agent-protocol.js';
import { makeUpdateSpawn, type RunningAgent, type UpdateSpawn } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { TERMINAL_REPORT, plantRealBox } from './updateRealBox.js';

const linux = process.platform === 'linux';
interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; accepted?: boolean }

const BOUND = `${UPDATE_SPAWN_TIMEOUT_MS} ms`;
const TAG = 'v0.0.9';
/** The three sentences, spelled out (the builder is L0's; a test that called it would agree with any wording). */
const armA = `the --detach parent was stopped at the ${BOUND} bound before it queued anything; nothing started`;
const armB = (pid: number): string =>
  `the --detach parent was stopped at the ${BOUND} bound after it queued ${TAG} (pid ${pid}); the run may have started, lease held`;
const armD = (seen: string, tag = TAG): string =>
  `stopped at the bound; ${seen} - it could not be attributed; lease for ${tag} held until the report or deadline`;

const reportText = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: TAG, phase: 'queued', startedAt: 1790000000, updatedAt: 1790000001, detail: null, from: 'pwa', pid: 4242, ...o,
})}\n`;

describe('the bound\'s arms against a recorder whose parent plants what a real one would have left (agent role)', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  const reportFile = (home: string): string => path.join(home, '.ccrc', 'update.json');
  /** A real agent whose spawn port answers KILLED, after running `during(home)` (what the killed parent left behind). */
  async function up(opts: {
    before?: string | 'fifo'; stdout?: string | null; pid?: number | null; during?: (home: string) => void;
  }): Promise<{ c: TestClient; home: string; calls: number }> {
    fixture = makeFixture();
    const home = fixture.home;
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    if (opts.before === 'fifo') expect(spawnSync('mkfifo', [reportFile(home)]).status).toBe(0);
    else if (opts.before !== undefined) writeFileSync(reportFile(home), opts.before);
    const state = { calls: 0 };
    const spawn: UpdateSpawn = async () => {
      state.calls += 1;
      opts.during?.(home);
      return { code: 137, stdout: opts.stdout === undefined ? '' : opts.stdout, stderr: '', killed: true, pid: opts.pid === undefined ? 4242 : opts.pid };
    };
    agent = await boot(fixture, { spawnUpdate: spawn });
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return { c, home, get calls() { return state.calls; } };
  }
  const ask = (c: TestClient, tag = TAG): Promise<Res> => c.req<Res>(1, { op: 'update', tag });

  describe('arm A — nothing was queued: not-queued, the request stands, update.json untouched', () => {
    it('both reads identical bytes (a terminal report), stdout at EOF and empty', async () => {
      const { c, home } = await up({ before: TERMINAL_REPORT });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: false, err: 'not-queued', detail: armA });
      expect(readFileSync(reportFile(home), 'utf8')).toBe(TERMINAL_REPORT);
    });

    it('absent at BOTH reads is arm A too (a box that never wrote a report)', async () => {
      const { c, home } = await up({});
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: false, err: 'not-queued', detail: armA });
      expect(existsSync(reportFile(home))).toBe(false);
    });

    it('stdout may carry other lines: only the WARN and the detached line disqualify it', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, stdout: 'update: resolving the release\nupdate: checking the lock\n' });
      expect(await ask(c)).toMatchObject({ ok: false, err: 'not-queued', detail: armA });
    });
  });

  describe('arm B — the re-read report is the killed parent\'s own queued write for the lease\'s tag: HELD', () => {
    it('pid and tag match: ok accepted, carrying the queued-at-the-bound words', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), reportText()) });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armB(4242) });
    });

    it('B wins over the printed lines: a parent that queued AND detached is still B (it did queue)', async () => {
      const { c } = await up({
        before: TERMINAL_REPORT, stdout: "update: detached — 'update --to v0.0.9' runs as a transient systemd --user unit\n",
        during: (home) => writeFileSync(reportFile(home), reportText()),
      });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armB(4242) });
    });

    it('a parent report in a NON-in-flight phase (it queued, then failed) is still the parent\'s: B', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), reportText({ phase: 'failed' })) });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armB(4242) });
    });
  });

  describe('arm D — anything else is HELD, and the words say what was seen and that it could not be attributed', () => {
    it('update.json unreadable after the stop (a directory planted at the name)', async () => {
      const { c } = await up({
        before: TERMINAL_REPORT,
        during: (home) => { rmSync(reportFile(home)); mkdirSync(reportFile(home)); },
      });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armD('update.json was unreadable after the stop') });
    });

    it('update.json unreadable BEFORE the spawn (a FIFO) and after: there is no readable before, so not A', async () => {
      const { c } = await up({ before: 'fifo' });
      expect(await ask(c)).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD('update.json was unreadable before and after'),
      });
    });

    it('changed to ANOTHER pid (not the parent\'s)', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), reportText({ pid: 777 })) });
      expect(await ask(c)).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD(`update.json changed, but not by the parent (pid 777, target ${TAG})`),
      });
    });

    it('changed to ANOTHER tag under the parent\'s own pid', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), reportText({ target: 'v0.0.11' })) });
      expect(await ask(c)).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD("update.json changed to the parent's report for another target (v0.0.11)"),
      });
    });

    it('changed to text that is not a report at all', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), 'not json\n') });
      expect(await ask(c)).toEqual({
        t: 'res', id: 1, ok: true, accepted: true, detail: armD('update.json changed to something unparseable'),
      });
    });

    it('the report was REMOVED', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => rmSync(reportFile(home)) });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armD('update.json was removed') });
    });

    it('unchanged, but the parent printed the update.json WARN: it got further than arm A may assume', async () => {
      const { c } = await up({
        before: TERMINAL_REPORT,
        stdout: 'update: WARN: could not write ~/.ccrc/update.json (phase queued) — the console will not see this phase; the update continues\n',
      });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armD('the parent printed the update.json WARN') });
    });

    it('unchanged, but the parent printed the detached line', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, stdout: "update: detached — 'update --to v0.0.9' runs as a transient systemd --user unit\n" });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armD("the parent printed 'detached'") });
    });

    it('unchanged, but stdout never reached EOF (an escapee held the pipe): not A', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, stdout: null });
      expect(await ask(c)).toEqual({ t: 'res', id: 1, ok: true, accepted: true, detail: armD('its stdout did not reach EOF') });
    });

    it('the report names our tag but the spawner has no pid for the parent: B cannot match, so D', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, pid: null, during: (home) => writeFileSync(reportFile(home), reportText()) });
      expect(await ask(c)).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD(`update.json changed, but not by the parent (pid 4242, target ${TAG})`),
      });
    });

    // Review of f7762afcc, I1: the ending names the lease's tag, which took room from the reasons; a reason that did not fit
    // was cut mid-token (`target v0.0.123` read `target v0.0.12`, a real, different tag) and its `(+N more)` dropped.
    it('a longer tag and pid: the reason is whole, not cut to a different tag (I1, measured case 1)', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, during: (home) => writeFileSync(reportFile(home), reportText({ pid: 1234567, target: 'v0.0.123' })) });
      expect(await ask(c, 'v0.0.100')).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD('update.json changed, but not by the parent (pid 1234567, target v0.0.123)', 'v0.0.100'),
      });
    });

    it('a second reason that cannot fit is COUNTED, not silently dropped (I1, measured case 2)', async () => {
      const { c } = await up({ before: TERMINAL_REPORT, stdout: null, during: (home) => writeFileSync(reportFile(home), reportText({ pid: 123456, target: 'v0.0.40' })) });
      expect(await ask(c, 'v0.0.40')).toEqual({
        t: 'res', id: 1, ok: true, accepted: true,
        detail: armD('update.json changed, but not by the parent (pid 123456, target v0.0.40) (+1 more)', 'v0.0.40'),
      });
    });

    it('every detail is one printable line within the op\'s detail bound, whatever was seen', async () => {
      const { c } = await up({
        before: 'fifo', stdout: 'update: WARN: could not write ~/.ccrc/update.json\nupdate: detached\n',
        during: (home) => { rmSync(reportFile(home)); mkdirSync(reportFile(home)); },
      });
      const res = await ask(c);
      expect(res.detail!.length).toBeLessThanOrEqual(200);
      expect(res.detail!.endsWith(`lease for ${TAG} held until the report or deadline`)).toBe(true);
      // Five reasons cannot all fit: the ones that do are whole, the rest are counted, and the ending is intact.
      expect(res.detail).toContain('(+');
      expect(res.detail).toMatch(/^[\x20-\x7e]+$/);
    });
  });

  it('after a kill the gate is released: the next op spawns again (D-3392 stays true on the arm paths)', async () => {
    const made = await up({ before: TERMINAL_REPORT });
    expect(await ask(made.c)).toMatchObject({ ok: false, err: 'not-queued' });
    expect(await made.c.req<Res>(2, { op: 'update', tag: TAG })).toMatchObject({ ok: false, err: 'not-queued' });
    expect(made.calls).toBe(2);
  });
});

describe.skipIf(!linux)('the bound against the REAL ccrc: the pid measurement, arm B and arm A end to end (agent role)', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  const stubPids: { home: string; file: string }[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    // A stub that failed to die is killed by the pid it recorded, never by name.
    for (const { home, file } of stubPids.splice(0)) {
      try { process.kill(Number(readFileSync(path.join(home, file), 'utf8').trim()), 'SIGKILL'); } catch { /* gone, as intended */ }
    }
  });

  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  async function untilDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 60 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
    return !alive(pid);
  }
  /** A real agent whose spawn port is the REAL `makeUpdateSpawn(env)` with `boundMs` in place of the 20 s bound. */
  async function up(opts: Parameters<typeof plantRealBox>[1], boundMs: number): Promise<{ c: TestClient; home: string }> {
    fixture = makeFixture();
    const env = plantRealBox(fixture.home, opts);
    const real = makeUpdateSpawn(env);
    agent = await boot(fixture, { spawnUpdate: (file, args) => real(file, args, boundMs) });
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return { c, home: fixture.home };
  }
  const askSlow = async (c: TestClient, body: Record<string, unknown>): Promise<Res> => {
    c.send({ t: 'req', id: 1, op: 'update', ...body });
    return c.waitFor<Res>((m) => (m as { t?: unknown; id?: unknown }).t === 'res' && (m as { id?: unknown }).id === 1, 25_000);
  };

  it('arm B: the real parent writes `queued` and blocks in a hanging systemd-run; the bound kills the group; the re-read names the spawner\'s pid and the tag (the pid IS the report\'s)', async () => {
    const { c, home } = await up({ systemdRun: 'hang' }, 6000);
    stubPids.push({ home, file: 'systemd-run-pid' });
    const res = await askSlow(c, { tag: TAG, kind: 'update' });
    expect(res).toMatchObject({ t: 'res', id: 1, ok: true, accepted: true });
    // The report is the REAL parent's: `queued` for our tag, stamped with the pid of the process that wrote it.
    const report = JSON.parse(readFileSync(path.join(home, '.ccrc', 'update.json'), 'utf8')) as { pid: number; target: string; phase: string; from: string };
    expect(report).toMatchObject({ phase: 'queued', target: TAG, from: 'pwa' });
    // THE MEASUREMENT: arm B matched, so the pid the spawner held is exactly the pid the parent's report carries.
    expect(res.detail).toBe(armB(report.pid));
    expect(report.pid).toBeGreaterThan(1);
    // Containment: the stub recorded exactly ONE call, never started a unit, and its sleeping process is dead.
    expect(readFileSync(path.join(home, 'systemd-run-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(path.join(home, 'systemd-run-argv'), 'utf8')).toContain(`ccrc-detach update --to ${TAG} --from pwa`);
    expect(existsSync(path.join(home, 'systemctl-argv'))).toBe(false);
    const stub = Number(readFileSync(path.join(home, 'systemd-run-pid'), 'utf8').trim());
    expect(await untilDead(stub), 'the hanging systemd-run stub survived the group kill').toBe(true);
    expect(await untilDead(report.pid), 'the killed parent survived').toBe(true);
  }, 30_000);

  it('arm A: a rollback parent stopped inside its release-host question, BEFORE `queued`: not-queued, update.json byte-identical', async () => {
    const { c, home } = await up({ curl: 'sleep' }, 3000);
    stubPids.push({ home, file: 'curl-pid' });
    const res = await askSlow(c, { tag: 'v0.0.9', kind: 'rollback' });
    expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'not-queued', detail: armA });
    expect(readFileSync(path.join(home, '.ccrc', 'update.json'), 'utf8')).toBe(TERMINAL_REPORT);
    // The question ran (against the stub, once), and nothing after it did: no unit, no systemctl.
    expect(readFileSync(path.join(home, 'curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(path.join(home, 'systemd-run-argv')), 'the parent got past the release-host question').toBe(false);
    expect(existsSync(path.join(home, 'systemctl-argv'))).toBe(false);
    expect(await untilDead(Number(readFileSync(path.join(home, 'curl-pid'), 'utf8').trim())), 'the sleeping curl stub survived the group kill').toBe(true);
  }, 30_000);
});

describe.skipIf(!linux)('an answer arrives before UPDATE_OP_TIMEOUT_MS while a grandchild holds the pipes (agent op)', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;
  let home = '';
  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    // The escapee left its own session on purpose, so the group kill missed it: kill it by the pid it recorded.
    try { process.kill(Number(readFileSync(path.join(home, 'gc-pid'), 'utf8').trim()), 'SIGKILL'); } catch { /* gone */ }
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('a parent that hangs past the bound while a setsid grandchild holds stdout: the reply comes within bound + drain, and says stdout never reached EOF (arm D, HELD)', async () => {
    fixture = makeFixture();
    home = fixture.home;
    const bin = path.join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    const launcher = path.join(bin, 'ccrc');
    // The fixture launcher: an escapee in its own session that inherits the pipes, then the parent hangs. NOT the real
    // ccrc — this case is about the spawner's pipes, so the script is the smallest thing that holds them.
    writeFileSync(launcher, `#!/bin/sh\nsetsid sh -c 'echo $$ > "$HOME/gc-pid"; exec sleep 300' &\nexec sleep 300\n`);
    chmodSync(launcher, 0o755);
    const real = makeUpdateSpawn({ HOME: home, PATH: '/usr/bin:/bin' });
    const BOUND_MS = 300;
    agent = await boot(fixture, { spawnUpdate: (file, args) => real(file, args, BOUND_MS) });
    client = new TestClient(agent.port);
    await client.hello();
    const started = Date.now();
    client.send({ t: 'req', id: 1, op: 'update', tag: TAG });
    const res = await client.waitFor<Res>((m) => (m as { t?: unknown; id?: unknown }).t === 'res' && (m as { id?: unknown }).id === 1, 20_000);
    const elapsed = Date.now() - started;
    // Within the bound plus ONE drain (with slack for a loaded box), and far inside the op's own deadline.
    expect(elapsed).toBeGreaterThanOrEqual(BOUND_MS);
    expect(elapsed).toBeLessThan(BOUND_MS + UPDATE_SPAWN_DRAIN_MS + 4000);
    expect(elapsed).toBeLessThan(UPDATE_OP_TIMEOUT_MS);
    // Its own words, on the wire: HELD, and the reason is the missing EOF.
    expect(res).toEqual({
      t: 'res', id: 1, ok: true, accepted: true,
      detail: armD('its stdout did not reach EOF'),
    });
    // The grandchild really did hold the pipe past the group kill (so the case measured what it says it did).
    expect(existsSync(path.join(home, 'gc-pid'))).toBe(true);
  }, 30_000);
});
