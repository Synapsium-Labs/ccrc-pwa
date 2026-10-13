// THE SHUTDOWN SEAL (fix round 5, D-4916). Two halves. The first runs `installShutdownSeal` (src/shutdownseal.ts) against a
// recorder in place of `process`, pinning its ORDER (stop the watcher, seal within the bound, say a refusal in one warn
// line, re-raise the same signal), that it NEVER THROWS, and that it never waits past its bound. The second is the wiring:
// it spawns THIS EXACT composition root (`src/index.ts`, via `tsx`, as `boot.test.ts` does) in a fixture HOME over a fixture
// database whose breaker state reads `sealed`, waits until the lane's first pass has unsealed it, sends SIGTERM, and reads
// the state again: `sealed`, with the child dead OF THE SIGNAL. It goes red when `index.ts` stops installing the handler.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installShutdownSeal, SHUTDOWN_SEAL_BOUND_MS, type SealingWatcher, type SignalHost } from '../src/shutdownseal.js';
import type { DeadCoordinatorSealResult } from '../src/deadCoordinator.js';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const tsx = path.join(serverRoot, 'node_modules', '.bin', 'tsx');
const indexTs = path.join(serverRoot, 'src', 'index.ts');

/** A `process` stand-in: records `once`, `removeListener` and `kill`, and fires a signal on demand. */
const recorder = () => {
  const once = new Map<string, () => void>();
  const events: string[] = [];
  const host: SignalHost = {
    pid: 4242,
    once: (sig, fn) => { once.set(sig, fn); events.push(`once ${sig}`); return host; },
    removeListener: (sig, fn) => { if (once.get(sig) === fn) once.delete(sig); events.push(`remove ${sig}`); return host; },
    kill: (pid, sig) => { events.push(`kill ${pid} ${sig}`); return true; },
  };
  return { host, events, // `process.once` removes the listener before it runs, as Node does
    fire: (sig: string) => { const fn = once.get(sig); once.delete(sig); return fn?.(); }, installed: () => [...once.keys()].sort() };
};
const logs = () => {
  const lines: string[] = [];
  return { log: { log: (m: string) => { lines.push(`log ${m}`); }, warn: (m: string) => { lines.push(`warn ${m}`); } }, lines };
};
const settle = async (until: () => boolean, ms = 2000): Promise<void> => {
  for (let t = 0; t < ms && !until(); t += 5) await new Promise((r) => setTimeout(r, 5));
};

describe('installShutdownSeal: the handler\'s order, its bound, and that it never throws (D-4916)', () => {
  it('installs SIGTERM and SIGINT, and nothing else', () => {
    const r = recorder();
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: async () => ({ sealed: true, generation: 3 }) }, r.host, 50, logs().log);
    expect(r.installed()).toEqual(['SIGINT', 'SIGTERM']);
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    it(`${sig}: stops the watcher, THEN seals within the bound, THEN removes the handlers and re-raises the same signal`, async () => {
      const r = recorder();
      const order: string[] = [];
      const w: SealingWatcher = {
        stop: () => { order.push('stop'); },
        sealDeadCoordinatorBreaker: async (bound) => { order.push(`seal ${bound}`); return { sealed: true, generation: 3 }; },
      };
      const l = logs();
      installShutdownSeal(w, r.host, 1234, l.log);
      r.fire(sig);
      await settle(() => r.events.some((e) => e.startsWith('kill')));
      expect(order).toEqual(['stop', 'seal 1234']);
      expect(r.events.filter((e) => e.startsWith('kill'))).toEqual([`kill 4242 ${sig}`]);
      expect(r.events.indexOf(`kill 4242 ${sig}`), 'the handlers are gone before the signal is re-raised').toBeGreaterThan(r.events.lastIndexOf('remove SIGTERM'));
      expect(r.installed(), 'both handlers removed: the default action runs').toEqual([]);
      expect(l.lines.filter((x) => x.startsWith('warn')), 'a seal that landed is not a warning').toEqual([]);
    });
  }
  it('a REFUSAL is one warn line naming the reason, and the signal is still re-raised', async () => {
    const r = recorder();
    const l = logs();
    const refusal: DeadCoordinatorSealResult = { sealed: false, reason: 'changes-pending' };
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: async () => refusal }, r.host, 50, l.log);
    r.fire('SIGTERM');
    await settle(() => r.events.some((e) => e.startsWith('kill')));
    const warns = l.lines.filter((x) => x.startsWith('warn'));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/^warn ccrc-server: shutdown: .*changes-pending/);
    expect(r.events).toContain('kill 4242 SIGTERM');
  });
  // THE WARN LINE'S TAIL SAYS WHAT THE NEXT START DOES (review 411, F3). `no-landed-write` and `already-sealed` leave a state the
  // next start may TRUST (a seal that already stands), so they must never say it "seeds it conservatively"; every other
  // refusal, the bound and a throw leave a state it does not trust, and say so.
  const refusalLine = async (reason: Extract<DeadCoordinatorSealResult, { sealed: false }>['reason']): Promise<string> => {
    const r = recorder();
    const l = logs();
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: async () => ({ sealed: false, reason }) }, r.host, 50, l.log);
    r.fire('SIGTERM');
    await settle(() => r.events.some((e) => e.startsWith('kill')));
    const warns = l.lines.filter((x) => x.startsWith('warn'));
    expect(warns, reason).toHaveLength(1);
    return warns[0]!;
  };
  for (const reason of ['no-landed-write', 'already-sealed'] as const) {
    it(`${reason}: the line names the reason and does NOT say the next start seeds conservatively (a seal that stands is trusted)`, async () => {
      const line = await refusalLine(reason);
      expect(line).toContain(`(${reason})`);
      expect(line).not.toContain('conservatively');
      expect(line).toContain('trusts');
    });
  }
  for (const reason of ['no-store', 'pass-in-flight', 'changes-pending', 'not-durably-clean', 'key-mismatch', 'write-failed'] as const) {
    it(`${reason}: the line names the reason and says the next start seeds it conservatively`, async () => {
      const line = await refusalLine(reason);
      expect(line).toContain(`(${reason})`);
      expect(line).toContain('the next start seeds it conservatively');
    });
  }
  it('a seal that does not answer within the bound says the next start seeds it conservatively', async () => {
    const r = recorder();
    const l = logs();
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: () => new Promise<never>(() => {}) }, r.host, 40, l.log);
    r.fire('SIGTERM');
    await settle(() => r.events.some((e) => e.startsWith('kill')), 3000);
    expect(l.lines.filter((x) => x.startsWith('warn') && x.includes('no answer within 40 ms') && x.includes('the next start seeds it conservatively'))).toHaveLength(1);
  });
  it('A DIFFERENT signal during the bound (a SIGINT inside a SIGTERM\'s) is handled by the other listener, still installed: the first signal\'s handler re-raises first, and the process dies of it (review 411, F3)', async () => {
    const r = recorder();
    const l = logs();
    let calls = 0;
    // Both seal calls wait on the SAME pass in flight, as the lane's do, and resolve in call order; the second finds it sealed.
    let release = (): void => {};
    const pass = new Promise<void>((resolve) => { release = resolve; });
    const w: SealingWatcher = {
      stop: () => {},
      sealDeadCoordinatorBreaker: async () => {
        calls += 1;
        const first = calls === 1;
        await pass;
        return first ? { sealed: true as const, generation: 3 } : { sealed: false as const, reason: 'already-sealed' as const };
      },
    };
    installShutdownSeal(w, r.host, 5000, l.log);
    r.fire('SIGTERM');                                   // the first signal: its seal waits on the pass
    expect(r.installed(), 'the other signal\'s listener is still installed').toEqual(['SIGINT']);
    r.fire('SIGINT');                                    // the other signal, inside the bound: handled, not lost
    await settle(() => calls === 2);
    release();
    await settle(() => r.events.filter((e) => e.startsWith('kill')).length >= 1);
    expect(r.events.filter((e) => e.startsWith('kill'))[0], 'the first handler re-raises its own signal first: that kill ends the process').toBe('kill 4242 SIGTERM');
  });
  it('NEVER THROWS: a seal that rejects, a watcher that cannot stop — each one warn line, and the signal is re-raised', async () => {
    const r = recorder();
    const l = logs();
    installShutdownSeal({ stop: () => { throw new Error('stop broke'); }, sealDeadCoordinatorBreaker: async () => { throw new Error('seal broke'); } }, r.host, 50, l.log);
    r.fire('SIGINT');
    await settle(() => r.events.some((e) => e.startsWith('kill')));
    expect(l.lines.filter((x) => x.startsWith('warn') && x.includes('stop broke'))).toHaveLength(1);
    expect(l.lines.filter((x) => x.startsWith('warn') && x.includes('seal broke'))).toHaveLength(1);
    expect(r.events).toContain('kill 4242 SIGINT');
  });
  it('NEVER WAITS PAST ITS BOUND: a seal that never answers is abandoned, one warn line, the signal re-raised', async () => {
    const r = recorder();
    const l = logs();
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: () => new Promise<never>(() => {}) }, r.host, 40, l.log);
    const t0 = Date.now();
    r.fire('SIGTERM');
    await settle(() => r.events.some((e) => e.startsWith('kill')), 3000);
    expect(r.events).toContain('kill 4242 SIGTERM');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(l.lines.filter((x) => x.startsWith('warn') && x.includes('no answer within 40 ms'))).toHaveLength(1);
  });
  it('A SECOND SIGNAL during the bound is NOT handled: the listeners are `once`, so after the first fires nothing is installed for it and it reaches the default action (kills at once, no seal) (review of fix round 5, F4)', async () => {
    const r = recorder();
    let sealed = 0;
    installShutdownSeal({ stop: () => {}, sealDeadCoordinatorBreaker: () => { sealed += 1; return new Promise<never>(() => {}); } }, r.host, 40, logs().log);
    r.fire('SIGTERM');                                   // the first signal: the seal begins and never answers
    expect(r.installed(), 'SIGTERM\'s listener was consumed by the first signal').toEqual(['SIGINT']);
    expect(r.fire('SIGTERM'), 'a second identical signal finds no handler').toBeUndefined();
    expect(sealed, 'one seal attempt, not two').toBe(1);
    expect(r.events.filter((e) => e.startsWith('kill')), 'and the handler itself has not re-raised yet').toEqual([]);
  });
  it('the bound is well inside systemd\'s default 90 s stop timeout', () => {
    expect(SHUTDOWN_SEAL_BOUND_MS).toBeGreaterThan(0);
    expect(SHUTDOWN_SEAL_BOUND_MS).toBeLessThanOrEqual(10_000);
  });
});

// ── the wiring: the real composition root, SIGTERM, and the state it leaves ───────────────────────────────────────────
let child: ChildProcess | undefined;
let currentHome: string | undefined;
let shortTmp: string | undefined;
afterEach(async () => {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  child = undefined;
  await new Promise((r) => setTimeout(r, 50));
  currentHome = undefined;
  if (shortTmp !== undefined) { try { rmSync(shortTmp, { recursive: true, force: true }); } catch { /* gone */ } }
  shortTmp = undefined;
});

/** The child's whole environment, built from an ALLOWLIST (review 411, F9): nothing the runner exported — no `CCRC_COORD_DB`,
 *  `CCRC_FLEET`, `CCRC_AGENT_URL`, `CCRC_PROJECTS_ROOT`, `CCRC_MAIL_TOKEN_PATH`, `CCRC_ACCOUNTS`, no `HOME` — can point the
 *  spawned server off the fixture, because none of it is passed on. `HOME` is the fixture too, so a path defaulted from
 *  `homedir()` lands in it. `TMPDIR` is a SHORT directory of its own: tsx opens an IPC socket under it, and a long path
 *  (a runner whose TMPDIR is on a deep mount) fails the spawn with `listen EINVAL`. */
const childEnv = (home: string, port: number, tmp: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  ...(process.env.LANG === undefined ? {} : { LANG: process.env.LANG }),
  HOME: home,
  TMPDIR: tmp,
  CCRC_HOME: home,
  CCRC_HOST: '127.0.0.1',
  CCRC_PORT: String(port),
});

const writeRoster = (home: string): void => {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: [{ id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }],
  }));
};
const writeStubCcd = (home: string): void => {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, '#!/bin/sh\nexit 0\n');
  chmodSync(p, 0o755);
};
/** The breaker's state word, read through a second connection (WAL). */
const stateWord = (db: string): string | null => {
  if (!existsSync(db)) return null;
  const raw = new DatabaseSync(db, { readOnly: true });
  try {
    const row = raw.prepare('SELECT state FROM dead_coordinator_breaker_state WHERE id = 1').get() as { state: string } | undefined;
    return row?.state ?? null;
  } catch { return null; } finally { raw.close(); }
};

describe('the real composition root installs the handler (D-4916)', () => {
  it('SIGTERM to the server whose lane has run seals the breaker\'s state, and the process dies OF THE SIGNAL', async () => {
    const home = mkTmp('ccrc-shutdown-seal-');
    currentHome = home;
    writeRoster(home);
    writeStubCcd(home);
    mkdirSync(path.join(home, '.cc-sessions', '.lifecycle'), { recursive: true });   // the registry the lane reads
    const db = path.join(home, '.ccrc', 'coord.db');
    const seed = openCoordDb(db);
    seed.exec(`INSERT INTO dead_coordinator_breaker_state (id, generation, state, held, writtenAt) VALUES (1, 1, 'sealed', 'dead-coordinator-breaker-held:', 1)`);
    seed.close();
    const port = 26000 + (process.pid % 3000);
    shortTmp = mkdtempSync(path.join('/tmp', 'ccrc-ss-'));
    child = spawn(tsx, [indexTs], {
      cwd: serverRoot,
      env: childEnv(home, port, shortTmp),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stderr = '';
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    // The lane's first pass unseals (`clean`): the process has landed a write, and a seal would now be permitted.
    for (let t = 0; t < 40_000 && stateWord(db) === 'sealed'; t += 100) await new Promise((r) => setTimeout(r, 100));
    expect(stateWord(db), `the lane\'s first pass unsealed the state (stderr: ${stderr.slice(-400)})`).toBe('clean');
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child!.on('exit', (code, signal) => resolve({ code, signal }));
    });
    process.kill(child.pid!, 'SIGTERM');
    const out = await Promise.race([exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 20_000))]);
    expect(out, 'the process ended').not.toBe('timeout');
    // `tsx` relays the child's end: 143 is 128 + SIGTERM, the status a process killed by the signal leaves; a handler that
    // exited by itself (`process.exit(0)`) would leave 0, one that swallowed the signal would not end at all.
    expect(out === 'timeout' ? null : out.signal === 'SIGTERM' || out.code === 143, `exit ${JSON.stringify(out)}: the signal was re-raised`).toBe(true);
    expect(stateWord(db), 'a clean shutdown sealed it').toBe('sealed');
  }, 90_000);
});
