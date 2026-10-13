// D-3411 — a lock-held refusal is `busy`, END TO END, on the agent role: the REAL `ccd/ccrc` behind the REAL
// `~/.local/bin/ccrc` launcher, in a fixture HOME, spawned by the agent's own `makeUpdateSpawn(env)`, with a real
// `flock` holding `update.lock`. The unit cases (`update-op.test.ts`) pin the mapping against a recorder; this file
// pins the SENTENCE, because a recorder's stderr is whatever the test wrote and only the script knows what it prints.
//
// CONTAINMENT, structural, for every case here that runs the real script:
//  - the child's env is built FROM SCRATCH (never spread from `process.env`): HOME is the fixture and PATH is
//    `<fixture>/bin:/usr/local/bin:/usr/bin:/bin`, never the operator's `~/.local/bin`;
//  - a poisoned, RECORDING `systemd-run` and `systemctl` sit first on that PATH: each appends its argv to a file in the
//    fixture and exits 97. A lock this harness failed to hold would reach `systemd-run`, so the case asserts that file
//    does not exist — it reds instead of starting a real transient unit on the box the suite runs on. The control
//    case releases the lock and asserts the recorder IS reached, so the absence above is not a vacuous one;
//  - `curl` is a stub answering 200 (the `rollback` kind asks the release host before its lock probe), so nothing
//    here reaches the network.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { UPDATE_LOCK_HELD_PREFIX, isUpdateLockHeldLine } from '../../shared/agent-protocol.js';
import type { RequestKind } from '../../shared/api.js';
import { makeUpdateSpawn, type RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { CCRC_SRC, TERMINAL_REPORT, plantRealBox } from './updateRealBox.js';

const linux = process.platform === 'linux';

describe.skipIf(!linux)('the update op against the REAL ccrc — a held lock is busy (D-3411, review F1)', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];
  const holders: ChildProcess[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    // Each holder is ONE process (bash execs into sleep), so its recorded pid is the one holding the lock.
    for (const h of holders.splice(0)) {
      if (h.pid !== undefined) { try { process.kill(h.pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });

  const lockPath = (home: string): string => path.join(home, '.ccrc', 'update.lock');
  const lockFree = (home: string): boolean =>
    spawnSync('bash', ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const holdLock = (home: string): void => {
    const h = spawn('bash', ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 60', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    for (let i = 0; i < 400 && lockFree(home); i++) spawnSync('sleep', ['0.025']);
    expect(lockFree(home), 'the fixture holder never took the lock').toBe(false);
  };
  const up = async (): Promise<{ c: TestClient; home: string; report: string }> => {
    fixture = makeFixture();
    const env = plantRealBox(fixture.home);
    agent = await boot(fixture, { spawnUpdate: makeUpdateSpawn(env) });
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return { c, home: fixture.home, report: path.join(fixture.home, '.ccrc', 'update.json') };
  };
  interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; accepted?: boolean }

  it.each(['update', 'rollback'] as const satisfies readonly RequestKind[])(
    '%s: the lock held by a real flock answers busy with the lock line, and update.json is byte-identical', async (kind) => {
      const { c, home, report } = await up();
      holdLock(home);
      const res = await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind });
      expect(res).toMatchObject({ t: 'res', id: 1, ok: false, err: 'busy' });
      // The sentence is the one `_upd_busy_die` really prints: the L0 prefix, then the holder in parentheses.
      expect(res.detail).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(.*\) - a live updater that hangs answers busy on every sweep: ack the row or mend the box$/);
      expect(res.detail!.startsWith(UPDATE_LOCK_HELD_PREFIX)).toBe(true);
      expect(isUpdateLockHeldLine(res.detail!)).toBe(true);
      expect(readFileSync(report, 'utf8')).toBe(TERMINAL_REPORT);
      expect(existsSync(path.join(home, 'systemd-run-argv')), 'a lock the harness failed to hold reached systemd-run').toBe(false);
      expect(existsSync(path.join(home, 'systemctl-argv')), 'the script reached systemctl').toBe(false);
      if (kind === 'rollback') {
        // The existence question ran (it precedes the lock probe), against the STUB.
        expect(readFileSync(path.join(home, 'curl-argv'), 'utf8')).toContain('/download/v0.0.9/SHA256SUMS');
      }
    });

  it.each(['update', 'rollback'] as const satisfies readonly RequestKind[])(
    '%s (control): with the lock FREE the script goes on to systemd-run, so the absence above is a measurement', async (kind) => {
      const { c, home } = await up();
      expect(lockFree(home)).toBe(true);
      const res = await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind });
      // The poisoned systemd-run answers 97: the parent dies AFTER its `queued` write, with its own sentence.
      expect(res).toMatchObject({ ok: false, err: 'spawn-failed' });
      expect(res.detail).toMatch(/could not start the detached run \(systemd-run exited 97\)/);
      expect(readFileSync(path.join(home, 'systemd-run-argv'), 'utf8')).toContain(`ccrc-detach ${kind} --to v0.0.9 --from pwa`);
    });

  it('the declared prefix is the sentence `_upd_busy_die` prints — read from the script, not restated', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const die = /^_upd_busy_die\(\) \{[^\n]*\}$/m.exec(src);
    expect(die, '_upd_busy_die not found in ccd/ccrc').not.toBeNull();
    // `_ccrc_die` prefixes `$PROG: ` (PROG is `ccrc`), and the holder rides in parentheses after the prefix.
    expect(die![0]).toContain(`_ccrc_die "${UPDATE_LOCK_HELD_PREFIX.slice('ccrc: '.length)} (`);
    expect(/^PROG=ccrc$/m.test(src), '`_ccrc_die`\'s prefix is PROG').toBe(true);
  });
});
