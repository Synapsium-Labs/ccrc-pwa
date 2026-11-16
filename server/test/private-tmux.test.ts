// The real-tmux suites' shared private-server helper (desktop polish Task C12, item 11): `privateTmux.ts`.
//
// RED FIRST, and what each case catches:
//   the reset that returns before the server has gone, or never kills it ...... "the reset leaves no server on the socket"
//   no watchdog (an exit-empty-off server outlives its killed worker) ......... "a server whose owner is killed is killed too"
//   a watchdog that kills while its owner lives .............................. "…and not while the owner lives"
//   a stop that leaves the watchdog running ................................... "a stopped watchdog kills nothing"
//   a suite that starts an exit-empty-off server and arms no watchdog ........ "every suite that keeps an empty server…"
//
// NOTHING here touches a live tmux server: every call is on a `-L` socket this run made, with TMUX, TMUX_PANE and
// TMUX_TMPDIR stripped, and `-f /dev/null`.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { privateSocketPath, removePrivateSocket, resetPrivateServer, watchPrivateServer } from './privateTmux.js';

const REAL_TMUX: string | null = (() => {
  const r = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  const p = (r.stdout ?? '').trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
})();
const BEHAVIOURAL = 'the private tmux server helper (real tmux, private socket)'
  + (REAL_TMUX === null ? ' — SKIPPED: no tmux on PATH, so there is no real tmux to measure against' : '');

const env = (): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env };
  delete e.TMUX;
  delete e.TMUX_PANE;
  delete e.TMUX_TMPDIR;
  return e;
};
/** Short (macOS `sun_path`) and unique per case. */
const sockName = (): string => `ptx${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const tmuxOn = (sock: string) => (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync(REAL_TMUX!, ['-L', sock, '-f', '/dev/null', ...args], { encoding: 'utf8', env: env() });
const serverUp = (T: ReturnType<typeof tmuxOn>): boolean => T('list-sessions').status === 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (ok()) return true;
  return ok();
}

const socks: string[] = [];
const owners: ChildProcess[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const o of owners.splice(0)) { try { o.kill('SIGKILL'); } catch { /* gone */ } }
  for (const s of socks.splice(0)) { tmuxOn(s)('kill-server'); removePrivateSocket(s); }
});

/** A private server that stays up with no session, as `drawer-window-sized-client` starts its own. */
function startEmptyServer(): { sock: string; T: ReturnType<typeof tmuxOn> } {
  const sock = sockName();
  socks.push(sock);
  const T = tmuxOn(sock);
  const r = T('start-server', ';', 'set-option', '-s', 'exit-empty', 'off');
  expect(r.status, `start-server: ${r.stderr}`).toBe(0);
  expect(serverUp(T), 'the empty server is up').toBe(true);
  return { sock, T };
}
/** A stand-in for the vitest worker: a process this case can SIGKILL. */
function owner(): ChildProcess {
  const o = spawn('sleep', ['60'], { stdio: 'ignore' });
  owners.push(o);
  return o;
}

// Text, not behaviour: a suite whose private server stays up with no session is the one a killed worker leaks, so it
// arms the watchdog. Read over every server test file but this one, which starts such servers to test the watchdog.
describe('the suites that keep an empty private server', () => {
  it('every suite that keeps an empty server up (exit-empty off) arms the watchdog', () => {
    const dir = import.meta.dirname;
    const keepers = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts') && f !== 'private-tmux.test.ts')
      .filter((f) => /'exit-empty',\s*'off'/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(keepers, 'the scan finds the suite it is for').toContain('drawer-window-sized-client.test.ts');
    for (const f of keepers) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).toMatch(/\bwatchPrivateServer\(/);
    }
  });
});

describe.skipIf(REAL_TMUX === null)(BEHAVIOURAL, () => {
  it('the reset leaves no server on the socket, even one that is exiting', () => {
    const sock = sockName();
    socks.push(sock);
    const T = tmuxOn(sock);
    expect(T('new-session', '-d', '-s', 'a', 'exec sleep 60').status).toBe(0);
    resetPrivateServer(T, sock);
    const r = T('list-sessions');
    expect({ status: r.status, gone: /no server running|error connecting/.test(r.stderr) }).toEqual({ status: 1, gone: true });
  });

  it('a server whose owner is killed is killed too, and its socket goes, and not while the owner lives', async () => {
    const { sock, T } = startEmptyServer();
    const o = owner();
    stops.push(watchPrivateServer(REAL_TMUX!, sock, '/dev/null', o.pid!));
    await sleep(1_000);
    expect(serverUp(T), 'the owner lives, so the server stays').toBe(true);
    o.kill('SIGKILL');
    expect(await until(() => !serverUp(T), 10_000), 'the server went after its owner').toBe(true);
    const socket = privateSocketPath(sock);
    if (socket !== null) expect(await until(() => !fs.existsSync(socket), 5_000), 'and its socket file').toBe(true);
  }, 30_000);

  it('a stopped watchdog kills nothing', async () => {
    const { sock, T } = startEmptyServer();
    const o = owner();
    const stop = watchPrivateServer(REAL_TMUX!, sock, '/dev/null', o.pid!);
    await sleep(300);
    stop();
    await sleep(300);
    o.kill('SIGKILL');
    await sleep(1_500);
    expect(serverUp(T), 'the stopped watchdog left the server alone').toBe(true);
  }, 30_000);
});
