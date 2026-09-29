// The server role's bounded `--detach` spawner (`boundedUpdateSpawn`, behind `localUpdateSpawnFor`), run for REAL
// against tiny bash fixture scripts in a temp dir. Never `ccrc`, never `ccd`: every launcher here is a script the
// case wrote. The agent has a twin of this file (`agent/test/update-spawn.test.ts`) over `makeUpdateSpawn`; both
// pin the same rule — its own process group, the whole group killed at the bound, stdout read to EOF or `null`,
// an answer that arrives within `UPDATE_SPAWN_DRAIN_MS` of the parent's exit even while a grandchild that left the
// group holds the pipes. Every process a case starts is killed by its RECORDED pid in `afterEach`, never by name.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { UPDATE_OP_TIMEOUT_MS, UPDATE_SPAWN_DRAIN_MS } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';
import { boundedUpdateSpawn } from '../src/update/spawn.js';
import { localUpdateSpawnFor } from '../src/update/converge.js';

const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0)) {
    // Children first (by the recorded parent pid, never by name): a parent killed alone leaves its own children.
    spawnSync('pkill', ['-9', '-P', String(pid)]);
    for (const target of [-pid, pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

const fixtureDir = (): string => mkTmp('update-spawn-');
/** A bash script at `<dir>/launcher`; `$DIR` is the fixture dir. */
function script(dir: string, body: string): string {
  const file = path.join(dir, 'launcher');
  writeFileSync(file, `#!/bin/bash\nexport DIR='${dir}'\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const ENV = { PATH: '/usr/bin:/bin', HOME: '/fixture-home-not-the-real-one' };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Poll to a recorded pid file: the fixture script writes it before it hangs. */
async function pidFrom(file: string): Promise<number> {
  for (let i = 0; i < 200; i += 1) {
    if (existsSync(file) && readFileSync(file, 'utf8').trim() !== '') return Number(readFileSync(file, 'utf8').trim());
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no pid in ${file}`);
}
async function untilDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
}
/** The moment a process is observed gone (polled every 5 ms). A drain bound is measured from the PARENT'S exit, so the
 *  measurement must not include the script's own start-up: `Date.now()` before the spawn would. */
async function deadAt(pid: number): Promise<number> {
  for (let i = 0; i < 4000; i += 1) { if (!alive(pid)) return Date.now(); await new Promise((r) => setTimeout(r, 5)); }
  throw new Error(`pid ${pid} never exited`);
}
/** The room a kill-path case gives its scripts to write their pid files before the bound can fire. */
const KILL_BOUND_MS = 3000;
/** A grandchild in its OWN session that inherits (and so holds) the parent's stdout and stderr pipes. */
const ESCAPEE = `setsid bash -c 'echo $$ > "$DIR/escapee.pid"; exec sleep 300' &\nwhile [ ! -s "$DIR/escapee.pid" ]; do sleep 0.01; done`;

describe('boundedUpdateSpawn — the real process-group spawner (server role)', () => {
  it("hands the parent exactly the environment it was given", async () => {
    const dir = fixtureDir();
    const file = script(dir, 'printf "%s|%s|%s" "$HOME" "$PATH" "$MARKER"');
    const r = await boundedUpdateSpawn(file, [], { env: { ...ENV, MARKER: 'given' }, timeoutMs: 5000 });
    expect(r).toMatchObject({ code: 0, killed: false, stdout: `${ENV.HOME}|${ENV.PATH}|given` });
  });

  it('reports the spawned process\'s own pid', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'printf "%s" "$$"');
    const r = await boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 5000 });
    expect(r.pid).not.toBeNull();
    expect(r.stdout).toBe(String(r.pid));
  });

  it('passes the argv through untouched, with no shell', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'printf "%s\\n" "$@"');
    const r = await boundedUpdateSpawn(file, ['a b', '$HOME', ';x'], { env: ENV, timeoutMs: 5000 });
    expect(r.stdout).toBe('a b\n$HOME\n;x\n');
  });

  it('keeps stdout to EOF, and stderr, and the exit code', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'echo one; sleep 0.15; echo two; echo err >&2; sleep 0.15; echo three; exit 3');
    const r = await boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 5000 });
    expect(r).toMatchObject({ code: 3, killed: false, stdout: 'one\ntwo\nthree\n', stderr: 'err\n' });
  });

  it('a stdout past the 1 MiB cap reads as incomplete (null), not as a truncated string', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'head -c 1200000 /dev/zero | tr "\\0" a; echo tail-line >&2');
    const r = await boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 10_000 });
    expect(r).toMatchObject({ code: 0, killed: false, stdout: null, stderr: 'tail-line\n' });
  });

  it('a launcher that cannot start answers code 1 with the sentence, and no pid (D-3393)', async () => {
    const dir = fixtureDir();
    const r = await boundedUpdateSpawn(path.join(dir, 'not-there'), [], { env: ENV, timeoutMs: 5000 });
    expect(r).toEqual({ code: 1, stdout: '', stderr: 'could not start the launcher (ENOENT)', killed: false, pid: null });
  });

  it('at the bound the WHOLE group dies, the answer says killed, and no grandchild outlives it', async () => {
    const dir = fixtureDir();
    // The grandchild stays in the parent's group (no setsid): it must die with it. The pid files are written FIRST.
    const file = script(dir, 'echo $$ > "$DIR/parent.pid"\nsleep 300 &\necho $! > "$DIR/grandchild.pid"\nwait');
    const running = boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: KILL_BOUND_MS });
    const parent = await pidFrom(path.join(dir, 'parent.pid'));
    pids.push(parent);   // recorded before the answer, so a red run still cleans up
    const grandchild = await pidFrom(path.join(dir, 'grandchild.pid'));
    pids.push(grandchild);
    const parentGone = deadAt(parent);
    const answeredAt = running.then(() => Date.now());
    const r = await running;
    expect(r.killed).toBe(true);
    expect(r.code).not.toBe(0);
    expect(await untilDead(grandchild), 'the grandchild in the parent\'s group survived the bound').toBe(true);
    expect(r.pid === null || await untilDead(r.pid)).toBe(true);
    expect(await answeredAt - await parentGone).toBeLessThan(UPDATE_SPAWN_DRAIN_MS);
  }, 20_000);

  it('a grandchild that left the group and holds the pipes does not stop the answer: a parent that exits 0 answers within the drain bound, stdout null', async () => {
    const dir = fixtureDir();
    const file = script(dir, `echo $$ > "$DIR/parent.pid"\n${ESCAPEE}\necho parent-done\nexit 0`);
    const running = boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 10_000 });
    const parent = await pidFrom(path.join(dir, 'parent.pid'));
    pids.push(parent);   // recorded before the answer, so a red run still cleans up
    pids.push(await pidFrom(path.join(dir, 'escapee.pid')));
    const parentGone = deadAt(parent);
    const answeredAt = running.then(() => Date.now());
    const r = await running;
    const took = await answeredAt - await parentGone;   // from the PARENT'S exit, not from before the spawn
    expect(r).toMatchObject({ code: 0, killed: false, stdout: null });
    expect(took).toBeGreaterThanOrEqual(UPDATE_SPAWN_DRAIN_MS - 100);
    expect(took).toBeLessThan(UPDATE_SPAWN_DRAIN_MS + 1500);
    expect(took).toBeLessThan(UPDATE_OP_TIMEOUT_MS);
  }, 20_000);

  it('a KILLED parent whose grandchild left the group and holds the pipes answers promptly too', async () => {
    const dir = fixtureDir();
    const file = script(dir, `echo $$ > "$DIR/parent.pid"\n${ESCAPEE}\nsleep 300`);
    const running = boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: KILL_BOUND_MS });
    const parent = await pidFrom(path.join(dir, 'parent.pid'));
    pids.push(parent);   // recorded before the answer, so a red run still cleans up
    pids.push(await pidFrom(path.join(dir, 'escapee.pid')));
    const parentGone = deadAt(parent);
    const answeredAt = running.then(() => Date.now());
    const r = await running;
    const took = await answeredAt - await parentGone;   // from the PARENT'S death at the bound, not from before the spawn
    expect(r).toMatchObject({ killed: true, stdout: null });
    expect(took).toBeLessThan(UPDATE_SPAWN_DRAIN_MS + 1500);
    expect(took).toBeLessThan(UPDATE_OP_TIMEOUT_MS);
  }, 20_000);

  it('a parent that a signal it did not get from us ended answers 128 + signo, not code 1 (M4)', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'kill -TERM $$\nsleep 5');
    const r = await boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 5000 });
    expect(r).toMatchObject({ code: 143, killed: false });
  });

  it('a parent that exits before the bound is not reported killed', async () => {
    const dir = fixtureDir();
    const file = script(dir, 'sleep 0.1; exit 0');
    const r = await boundedUpdateSpawn(file, [], { env: ENV, timeoutMs: 400 });
    expect(r).toMatchObject({ code: 0, killed: false, stdout: '' });
  });

  describe('localUpdateSpawnFor — the two-template capability over the bounded runner', () => {
    function plantLauncher(home: string, body: string): void {
      const bin = path.join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      const file = path.join(bin, 'ccrc');
      writeFileSync(file, `#!/bin/bash\nexport DIR='${home}'\n${body}\n`);
      chmodSync(file, 0o755);
    }

    it('runs the absolute launcher with exactly the template argv and the given environment', async () => {
      const home = fixtureDir();
      plantLauncher(home, 'printf "%s\\n" "$0" "$HOME" "$@"');
      const r = await localUpdateSpawnFor(home, { env: { ...ENV, HOME: home }, timeoutMs: 5000 })('rollback', 'v0.0.9');
      expect(r).toMatchObject({ code: 0, killed: false });
      expect(r.stdout).toBe(
        [path.join(home, '.local', 'bin', 'ccrc'), home, 'rollback', '--to', 'v0.0.9', '--detach', '--from', 'pwa', ''].join('\n'));
    });

    it('kills the launcher\'s group at the injected bound and answers killed', async () => {
      const home = fixtureDir();
      plantLauncher(home, 'echo $$ > "$DIR/parent.pid"\nsleep 300 &\necho $! > "$DIR/grandchild.pid"\nwait');
      const running = localUpdateSpawnFor(home, { env: ENV, timeoutMs: KILL_BOUND_MS })('update', 'v0.0.9');
      pids.push(await pidFrom(path.join(home, 'parent.pid')));   // recorded before the answer, so a red run still cleans up
      const grandchild = await pidFrom(path.join(home, 'grandchild.pid'));
      pids.push(grandchild);
      const r = await running;
      expect(r.killed).toBe(true);
      expect(await untilDead(grandchild)).toBe(true);
    }, 20_000);

    it('a non-tag or a non-kind throws synchronously, before anything runs', () => {
      const home = fixtureDir();
      const spawn = localUpdateSpawnFor(home, { env: ENV, timeoutMs: 400 });
      expect(() => spawn('update', 'v1.2')).toThrow(RangeError);
      expect(() => spawn('reinstall' as never, 'v0.0.9')).toThrow(RangeError);
    });
  });
});
