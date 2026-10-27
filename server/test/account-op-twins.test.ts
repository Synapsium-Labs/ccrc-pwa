// D-7057 (W8 Task C8e; ARCH-73 (#808); spec K17 "Audited one at a time"): the characterization of the account-op
// spawn pair, ONE table run against BOTH arms through their public signatures — the server's local arm
// `localAccountOps(…).run` (`server/src/accounts/ops.ts`) and the agent's `makeAccountOpSpawn(env)` port
// (`agent/src/accountop.ts`). Real child processes: a stub `ccrc` inside a fixture HOME that is not the real one; never
// a real verb, never `ccd`. Every process a case starts is killed by its RECORDED pid in `afterEach`, never by name.
//
// It lands before either body moves (OA-C8a (a), D-7060: the fold into `shared/spawn.mjs#boundedStdinSpawn`), green
// on the base, and it is the proof that the moves changed no answer: both packages' own account-op suites
// (`account-ops.test.ts`, `agent/test/account-op.test.ts`) run unchanged beside it. The one row the two arms answer
// differently at the base is a group kill that throws other than ESRCH: the agent falls back to the child alone,
// the local arm does nothing. It is recorded per arm (`NON_ESRCH_LEADER_KILLED`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildAccountArgv } from '../../shared/account-argv.js';
import { updateLauncherPath } from '../../shared/agent-protocol.js';
import type { AccountSub } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { localAccountOps, type AccountOpFields } from '../src/accounts/ops.js';
import { makeAccountOpSpawn } from '../../agent/src/accountop.js';
import { tokenSyncEnv } from '../../agent/src/tokensync.js';

interface Bounds { timeoutMs: number; killGraceMs: number; maxOutputBytes: number }
type Outcome = { kind: string; code?: number; stdout?: string };
type Arm = (home: string, sub: AccountSub, id: string | null, fields: AccountOpFields, stdin: Buffer | undefined, b: Bounds) => Promise<Outcome>;

const LOCAL = 'server/src/accounts/ops.ts#localAccountOps.run';
const AGENT = 'agent/src/accountop.ts#makeAccountOpSpawn';
const ARMS: ReadonlyArray<readonly [string, Arm]> = [
  [LOCAL, (home, sub, id, fields, stdin, b) =>
    localAccountOps({ home, timeoutMs: () => b.timeoutMs, killGraceMs: b.killGraceMs, maxOutputBytes: b.maxOutputBytes }).run(sub, id, fields, stdin)],
  [AGENT, (home, sub, id, fields, stdin, b) => {
    // The agent's op builds the argv and the launcher path before it calls the port (`agent/src/server.ts`).
    const built = buildAccountArgv(sub, id, fields, stdin !== undefined);
    if (!built.ok) throw new Error(`fixture: the builder refused ${built.why}`);
    return makeAccountOpSpawn(tokenSyncEnv(home))(updateLauncherPath(home), built.argv, stdin ?? null, b);
  }],
];

/**
 * The one row the arms answer differently at the base: the group kill throws EPERM (not ESRCH). `true` is "the leader
 * was killed anyway" (the agent's fallback to `child.kill(s)`); `false` is "nothing was killed" (the local arm).
 */
const NON_ESRCH_LEADER_KILLED: Readonly<Record<string, boolean>> = { [LOCAL]: false, [AGENT]: true };

const pids: number[] = [];
const SECRET_VARS = ['CCRC_AGENT_TOKEN', 'CCRC_HETZNER_TOKEN', 'CCRC_VAPID_PRIVATE'] as const;
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const v of SECRET_VARS) { saved.set(v, process.env[v]); process.env[v] = `planted-${v}-value`; }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [v, was] of saved) { if (was === undefined) delete process.env[v]; else process.env[v] = was; }
  saved.clear();
  for (const pid of pids.splice(0)) {
    for (const target of [-pid, pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

/** A fixture HOME whose `ccrc` is `body` under bash, with `$rec` its record directory (a shell variable, not exported:
 *  a row that hands it to a member says `export rec` itself, so the environ row reads only what the arm gave). */
function fixtureHome(body: string): { home: string; rec: string } {
  const home = mkTmp('ccrc-account-op-twins-');
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const rec = path.join(home, 'rec');
  mkdirSync(rec, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), `#!/bin/bash\nrec=${JSON.stringify(rec)}\n${body}\n`);
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  return { home, rec };
}
/** Writes `$$` (or `$1`'s pid) to `$rec/<name>` atomically. */
const writePid = (name: string, pid = '$$'): string => `echo ${pid} > "$rec/${name}.tmp"; mv "$rec/${name}.tmp" "$rec/${name}"`;
async function pidFrom(file: string): Promise<number> {
  for (let i = 0; i < 400; i += 1) {
    if (existsSync(file) && readFileSync(file, 'utf8').trim() !== '') {
      const pid = Number(readFileSync(file, 'utf8').trim());
      pids.push(pid);
      return pid;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no pid in ${file}`);
}
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function untilDead(pid: number, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  return !alive(pid);
}

const BIG: Bounds = { timeoutMs: 20_000, killGraceMs: 400, maxOutputBytes: 8 * 1024 * 1024 };
/** The bound a kill-path case gives its stub to install its traps and write its pids (D-5623: load, not a port). */
const KILL: Bounds = { timeoutMs: 2_000, killGraceMs: 400, maxOutputBytes: 8 * 1024 * 1024 };

describe.each(ARMS)('the account-op spawn, through %s (D-7057 characterization)', (name, run) => {
  it('stdin reaches the child exactly: the bytes as given, no newline added, then EOF', async () => {
    const { home, rec } = fixtureHome('cat > "$rec/stdin"; printf \'{"ok":true}\'');
    const secret = Buffer.from(`CANARY-${process.pid}-twins`);
    expect(await run(home, 'credential', 'lane-a', {}, secret, BIG)).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true}' });
    expect(readFileSync(path.join(rec, 'stdin'))).toEqual(secret);
    // No stdin is an empty stdin, then EOF: `cat` returns.
    const none = fixtureHome('cat > "$rec/stdin"');
    expect(await run(none.home, 'roster', null, {}, undefined, BIG)).toMatchObject({ kind: 'exited', code: 0 });
    expect(readFileSync(path.join(none.rec, 'stdin'), 'utf8')).toBe('');
  });

  it("the child's environment is exactly three names: HOME, LANG, PATH (no CCRC_* reaches it)", async () => {
    const { home, rec } = fixtureHome('/usr/bin/env > "$rec/environ"');
    expect(await run(home, 'roster', null, {}, undefined, BIG)).toMatchObject({ kind: 'exited', code: 0 });
    const environ = readFileSync(path.join(rec, 'environ'), 'utf8');
    expect(environ).not.toContain('planted-');
    const names = environ.split('\n').filter((l) => l.includes('=')).map((l) => l.slice(0, l.indexOf('=')))
      .filter((n) => n !== '_' && n !== 'PWD' && n !== 'SHLVL').sort();
    expect(names).toEqual(['HOME', 'LANG', 'PATH']);
    expect(environ).toContain(`HOME=${home}\n`);
  });

  it('stdout past the cap answers too-large, and the whole group is killed', async () => {
    const { home, rec } = fixtureHome([
      'export rec',
      `/bin/sh -c '${writePid('member')}; while :; do sleep 0.05; done' </dev/null >/dev/null 2>&1 &`,
      'while [ ! -s "$rec/member" ]; do sleep 0.02; done',
      'head -c 4096 /dev/zero',
      'while :; do sleep 0.05; done',
    ].join('\n'));
    expect(await run(home, 'roster', null, {}, undefined, { ...BIG, maxOutputBytes: 1024 })).toEqual({ kind: 'too-large' });
    const member = await pidFrom(path.join(rec, 'member'));
    expect(await untilDead(member), 'a group member outlived a too-large answer').toBe(true);
  }, 20_000);

  it('a sub past its bound gets TERM, then KILL after the grace, and answers timeout', async () => {
    const { home, rec } = fixtureHome([
      'trap \'echo term >> "$rec/signals"\' TERM',
      writePid('leader'),
      'while :; do sleep 0.05; done',
    ].join('\n'));
    const t0 = Date.now();
    expect(await run(home, 'check', 'lane-a', {}, undefined, KILL)).toEqual({ kind: 'timeout' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(KILL.timeoutMs + KILL.killGraceMs - 50);
    const leader = await pidFrom(path.join(rec, 'leader'));
    expect(readFileSync(path.join(rec, 'signals'), 'utf8')).toContain('term');
    expect(await untilDead(leader), 'the TERM-trapping leader outlived the KILL').toBe(true);
  }, 20_000);

  it('the KILL is never cancelled: a member that ignores TERM after the leader exits on it is killed after the grace', async () => {
    const { home, rec } = fixtureHome([
      'export rec',
      `/bin/sh -c 'trap "" TERM; ${writePid('member')}; while :; do sleep 0.05; done' </dev/null >/dev/null 2>&1 &`,
      'while [ ! -s "$rec/member" ]; do sleep 0.02; done',
      'while :; do sleep 0.05; done',
    ].join('\n'));
    expect(await run(home, 'check', 'lane-a', {}, undefined, KILL)).toEqual({ kind: 'timeout' });
    const member = await pidFrom(path.join(rec, 'member'));
    expect(await untilDead(member, KILL.killGraceMs + 3000), 'the KILL was cancelled by the leader\'s exit').toBe(true);
  }, 20_000);

  it('a launcher that cannot start answers not-started', async () => {
    const home = mkTmp('ccrc-account-op-twins-none-');
    expect(await run(home, 'roster', null, {}, undefined, BIG)).toEqual({ kind: 'not-started' });
  });

  it('a child ended by a signal not ours answers the shell\'s 128 + signo', async () => {
    const { home } = fixtureHome('kill -KILL $$');
    expect(await run(home, 'roster', null, {}, undefined, BIG)).toEqual({ kind: 'exited', code: 128 + 9, stdout: '' });
  });

  it('a group kill that throws other than ESRCH: the arm\'s recorded answer (OA-C8a (a), D-7060)', async () => {
    const { home, rec } = fixtureHome([writePid('leader'), 'while :; do sleep 0.05; done'].join('\n'));
    const real = process.kill.bind(process);
    // Only the group kill fails, with EPERM; every other kill (the probe, a pid) is the real one.
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
      if (pid < 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      return real(pid, sig);
    }) as typeof process.kill);
    const pending = run(home, 'check', 'lane-a', {}, undefined, KILL);
    const leader = await pidFrom(path.join(rec, 'leader'));
    expect(await pending).toEqual({ kind: 'timeout' });
    vi.restoreAllMocks();
    expect(await untilDead(leader, 1000), `${name}: was the leader killed when the group kill threw EPERM`)
      .toBe(NON_ESRCH_LEADER_KILLED[name]);
  }, 20_000);
});
