// D-7055 (W8 Task C8c; ARCH-73 (#808), its spawn half): the characterization of the bounded update spawner, ONE
// table run against BOTH of its wrappers through their public signatures — the server role's `boundedUpdateSpawn`
// (`server/src/update/spawn.ts`) and the agent's `makeUpdateSpawn` (`agent/src/server.ts`). Real child processes,
// tiny bash fixture scripts in a temp dir, a fixture HOME that is not the real one; never `ccrc`, never `ccd`. Every
// process a case starts is killed by its RECORDED pid in `afterEach`, never by name.
//
// It lands before either wrapper moves onto `shared/spawn.mjs#boundedSpawn`, green on the base, and it is the proof
// that the move changed no answer: the two packages' own spawn suites (`update-spawn.test.ts`,
// `update-spawn-deadline.test.ts`, each package's) run unchanged beside it. Rows the per-package suites did not hold
// before this file: the setsid row measured from the SPAWN (`timeoutMs + UPDATE_SPAWN_DRAIN_MS`, the drain's whole
// budget), and "nothing fires after the answer" (no late kill of the group once the parent has answered).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { UPDATE_SPAWN_DRAIN_MS, type UpdateSpawnResult } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';
import { boundedUpdateSpawn } from '../src/update/spawn.js';
import { makeUpdateSpawn } from '../../agent/src/server.js';

type Run = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<UpdateSpawnResult>;
const WRAPPERS: ReadonlyArray<readonly [string, Run]> = [
  ['server/src/update/spawn.ts#boundedUpdateSpawn', (file, args, opts) => boundedUpdateSpawn(file, args, opts)],
  ['agent/src/server.ts#makeUpdateSpawn', (file, args, opts) => makeUpdateSpawn(opts.env)(file, args, opts.timeoutMs)],
];

const pids: number[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const pid of pids.splice(0)) {
    spawnSync('pkill', ['-9', '-P', String(pid)]);
    for (const target of [-pid, pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

/** A bash script at `<dir>/launcher`; `$DIR` is the fixture dir. */
function script(dir: string, body: string): string {
  const file = path.join(dir, 'launcher');
  writeFileSync(file, `#!/bin/bash\nexport DIR='${dir}'\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const ENV = { PATH: '/usr/bin:/bin', HOME: '/fixture-home-not-the-real-one' };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function pidFrom(file: string): Promise<number> {
  for (let i = 0; i < 400; i += 1) {
    if (existsSync(file) && readFileSync(file, 'utf8').trim() !== '') return Number(readFileSync(file, 'utf8').trim());
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no pid in ${file}`);
}
async function untilDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 150; i += 1) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
}
/** The parent's own exit time in ms, written just before its `exit 0` by the test's own node (the D-6608 idiom). */
const EXIT_STAMP = `'${process.execPath}' -e 'process.stdout.write(String(Date.now()))' > "$DIR/exit.ms"`;
/** A grandchild in its OWN session (libuv's setsid() under `detached: true`) that inherits, and so holds, the
 *  launcher's stdout and stderr pipes; the launcher waits (bounded by bash's `SECONDS`) until it has written its pid. */
const ESCAPEE = `'${process.execPath}' -e 'require("child_process").spawn("bash", ["-c", "echo $$ > \\"$DIR/escapee.pid\\"; exec sleep 300"], { detached: true, stdio: "inherit" }).unref()'\n`
  + 'w=$((SECONDS + 3)); while [ ! -s "$DIR/escapee.pid" ] && [ "$SECONDS" -lt "$w" ]; do sleep 0.05; done\n'
  + '[ -s "$DIR/escapee.pid" ] || { echo "fixture: the escapee never wrote its pid" >&2; exit 91; }';
const pgidOf = (pid: number): number => Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
/** The room a kill-path case gives its scripts to write their pid files before the bound fires. */
const KILL_BOUND_MS = 3000;
/** Timer and event-loop lateness a loaded runner adds to a ceiling (the per-package suites' own 1500 ms). */
const SLACK_MS = 1500;

describe.each(WRAPPERS)('the bounded update spawner, through %s (D-7055 characterization)', (_name, run) => {
  it('exit 0 with stdout: the parent\'s stdout, code 0, not killed, its pid', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const r = await run(script(dir, 'printf "%s|%s" "$HOME" "$$"'), [], { env: ENV, timeoutMs: 10_000 });
    expect(r).toMatchObject({ code: 0, killed: false, stderr: '' });
    expect(r.pid).not.toBeNull();
    expect(r.stdout).toBe(`${ENV.HOME}|${String(r.pid)}`);
  });

  it('exit 3 with stderr: the parent\'s own code and its stderr, stdout to EOF', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const r = await run(script(dir, 'echo out; echo err-line >&2; exit 3'), [], { env: ENV, timeoutMs: 10_000 });
    expect(r).toMatchObject({ code: 3, killed: false, stdout: 'out\n', stderr: 'err-line\n' });
  });

  it('a stdout over 1 MiB reads as incomplete: stdout null, stderr kept', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const r = await run(script(dir, 'head -c 1200000 /dev/zero | tr "\\0" a; echo tail-line >&2'), [], { env: ENV, timeoutMs: 15_000 });
    expect(r).toMatchObject({ code: 0, killed: false, stdout: null, stderr: 'tail-line\n' });
  });

  it('a parent past the bound: killed, and its whole group is gone (a grandchild in the group is dead)', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const file = script(dir, 'echo $$ > "$DIR/parent.pid"\nsleep 300 &\necho $! > "$DIR/grandchild.pid"\nwait');
    const running = run(file, [], { env: ENV, timeoutMs: KILL_BOUND_MS });
    const parent = await pidFrom(path.join(dir, 'parent.pid'));
    pids.push(parent);
    const grandchild = await pidFrom(path.join(dir, 'grandchild.pid'));
    pids.push(grandchild);
    expect(pgidOf(grandchild), 'the grandchild is in the parent\'s group').toBe(parent);
    const r = await running;
    expect(r.killed).toBe(true);
    expect(r.code).not.toBe(0);
    expect(r.pid).toBe(parent);
    expect(await untilDead(grandchild), 'a grandchild in the group is dead').toBe(true);
    expect(await untilDead(parent)).toBe(true);
  }, 30_000);

  it('a grandchild that left the group (setsid) holding a pipe: a KILLED parent answers within timeoutMs + UPDATE_SPAWN_DRAIN_MS of the spawn, stdout null', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const file = script(dir, `echo $$ > "$DIR/parent.pid"\n${ESCAPEE}\nsleep 300`);
    const t0 = Date.now();
    const running = run(file, [], { env: ENV, timeoutMs: KILL_BOUND_MS });
    const parent = await pidFrom(path.join(dir, 'parent.pid'));
    pids.push(parent);
    const escapee = await pidFrom(path.join(dir, 'escapee.pid'));
    pids.push(escapee);
    expect(pgidOf(escapee), 'the escapee left the parent\'s group').not.toBe(parent);
    const r = await running;
    const took = Date.now() - t0;
    expect(r).toMatchObject({ killed: true, stdout: null });
    expect(took, 'the answer within timeout + drain').toBeLessThan(KILL_BOUND_MS + UPDATE_SPAWN_DRAIN_MS + SLACK_MS);
    expect(took).toBeGreaterThanOrEqual(KILL_BOUND_MS);
  }, 30_000);

  it('a grandchild that left the group holding a pipe: a parent that exits 0 answers one drain after its exit, stdout null', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const file = script(dir, `echo $$ > "$DIR/parent.pid"\n${ESCAPEE}\necho parent-done\n${EXIT_STAMP}\nexit 0`);
    const running = run(file, [], { env: ENV, timeoutMs: 15_000 });
    pids.push(await pidFrom(path.join(dir, 'parent.pid')));
    pids.push(await pidFrom(path.join(dir, 'escapee.pid')));
    const r = await running;
    const answeredAt = Date.now();
    const stamp = await pidFrom(path.join(dir, 'exit.ms'));
    expect(r).toMatchObject({ code: 0, killed: false, stdout: null });
    // The floor from the parent's own stamp: the drain is armed by the exit, so a missing or zero drain reads short.
    expect(answeredAt - stamp, 'the drain ran').toBeGreaterThanOrEqual(UPDATE_SPAWN_DRAIN_MS - 100);
    expect(answeredAt - stamp, 'the answer within the drain').toBeLessThan(UPDATE_SPAWN_DRAIN_MS + SLACK_MS);
  }, 30_000);

  it('a parent ended by a signal not ours answers 128 + signo, not killed', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const r = await run(script(dir, 'kill -TERM $$\nsleep 5'), [], { env: ENV, timeoutMs: 10_000 });
    expect(r).toMatchObject({ code: 128 + os.constants.signals.SIGTERM, killed: false });
  });

  it('an absent launcher answers code 1, `could not start the launcher (ENOENT)`, pid null (D-3393)', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const r = await run(path.join(dir, 'not-there'), [], { env: ENV, timeoutMs: 10_000 });
    expect(r).toEqual({ code: 1, stdout: '', stderr: 'could not start the launcher (ENOENT)', killed: false, pid: null });
  });

  it('nothing resolves twice and nothing fires after the answer: no group kill once the parent has answered', async () => {
    const dir = mkTmp('update-spawn-wrappers-');
    const kill = vi.spyOn(process, 'kill');
    const bound = 4000;
    let settled = 0;
    const running = run(script(dir, 'echo once; exit 0'), [], { env: ENV, timeoutMs: bound });
    void running.then(() => { settled += 1; });
    const r = await running;
    expect(r).toMatchObject({ code: 0, killed: false, stdout: 'once\n' });
    // Past the bound and a drain: a kill timer or a drain timer left armed would fire here.
    await new Promise((res) => setTimeout(res, bound + UPDATE_SPAWN_DRAIN_MS + 200));
    expect(settled).toBe(1);
    expect(kill.mock.calls.filter(([target, sig]) => target === -(r.pid ?? 0) && sig === 'SIGKILL')).toEqual([]);
  }, 30_000);
});
