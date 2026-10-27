// Shared fixture for the `ccrc-codex` test family (D-6878): the box, the runners and the lane helpers that
// `ccrc-codex.test.ts`, `ccrc-codex-lifecycle.test.ts` and `ccrc-codex-bridge.test.ts` use, moved out of what was one test
// file so that each part runs within a port budget of its own (D-6856's allocator issues at most 500 ports to one file).
// The root `afterEach` that file carried is `installCcrcCodexHooks()`, which each file of the family calls once at its top
// level. The helpers moved verbatim; nothing here is a case, and the containment they keep is described in
// `ccrc-codex.test.ts`'s header.
import { expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { codexRoster, freePorts, killLaneProcesses, plantSystemd } from './codexLaneFixture.js';
import {
  AUTH_ROUTES, driverLines, fakeAuthServer, plantBackendCredential, runAuthDriver, type AuthAnswer,
} from './codexAuthFixture.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
export const PY = pythonOrSkip();
/** Spec §5.4's `runtime.env`, whole: one line, one trailing newline. */
export const KEY_FILE = /^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/;

/** An `exec.kind: "external"` row whose TELEMETRY says codex: the shape of a
 *  Codex lane that another launcher runs. `ext-a` is fixture vocabulary, not
 *  any box's lane. `CCRC_CODEX_BACKEND` names it; the library must never run
 *  it. */
export const EXTERNAL_CODEX_TELEMETRY = {
  id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
  exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
};

export const homes: string[] = [];
export function installCcrcCodexHooks(): void {
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });
}

export function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(h, { ...process.env, HOME: h }, { systemd: true, tmux: true });
  fs.writeFileSync(join(h, '.local', 'bin', 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-poison"\n'
    + 'echo "the codex lane library must never reach curl" >&2\nexit 97\n', { mode: 0o755 });
  // Nothing ambient steers the library: its own knobs, the tiers' variables,
  // and COLUMNS (which truncates `ps`'s argv — a case sets it deliberately).
  // CCRC_CODEX_AUTH_BASE is the one CCRC_CODEX_ name kept: `ghContainedEnv`
  // sets it to a loopback endpoint (codex-bridge Stage 1, Task 6), so no auth
  // library this suite reaches can ask a live one.
  // CCGPT_BRIDGE_UPSTREAM_BASE is the one CCGPT_ name kept, for the same
  // reason: `ghContainedEnv` sets it to a loopback endpoint (codex-bridge
  // Stage 2, Task 7, D-6838), so no bridge this suite starts can reach the
  // live backend.
  for (const k of Object.keys(e)) {
    if ((/^(CCRC_CODEX_|CCGPT_)/.test(k) && k !== 'CCRC_CODEX_AUTH_BASE' && k !== 'CCGPT_BRIDGE_UPSTREAM_BASE')
      || ['CHATGPT_TOKEN_DIR', 'LITELLM_MASTER_KEY', 'COLUMNS'].includes(k)) {
      delete e[k];
    }
  }
  return { ...e, ...extra };
}

/** A box: the tree `ccrc` resolves against, the fake manager, the poisons. */
export function box(prefix: string, opts: { userManager?: boolean } = {}): string {
  const h = mkTmp(prefix);
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape']) fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  plantSystemd(h, { userManager: opts.userManager ?? false });   // BEFORE env() — header, point 2
  env(h);
  homes.push(h);
  return h;
}

export interface Result { code: number; stdout: string; stderr: string }

/** Source ccrc, then run `script` — one bash, the library's own shell.
 *  `umask 022` FIRST (ruling PF-9, as Tasks 6 and 8 do): a runner whose
 *  ambient umask already gives 0700 would make row 19's mutation (dropping
 *  `umask 077 &&` from the lane-dir `mkdir`) pass by coincidence, and the
 *  0700 pin would bind nothing. */
export function lib(h: string, script: string, extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n${script}`],
    { env: env(h, extra), encoding: 'utf8', input: '', timeout: 15_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `ccrc <args>` as a box runs it. */
export function ccrc(h: string, args: string[]): Result {
  const r = spawnSync(BASH, [join(h, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(h), encoding: 'utf8', input: '', timeout: 15_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export type Ports = Record<string, { proxyPort: number; litellmPort: number }>;

/** codex-a (telemetry codex), codex-b (telemetry none), and the external
 *  telemetry-codex row — the roster on which `exec.kind` and
 *  `CCRC_CODEX_BACKEND` disagree in BOTH directions. */
export async function twoLanes(h: string): Promise<Ports> {
  const [a1, a2, b1, b2] = await freePorts(4);
  codexRoster(h, [
    { id: 'codex-a', proxyPort: a1!, litellmPort: a2! },
    { id: 'codex-b', proxyPort: b1!, litellmPort: b2!, telemetry: 'none' },
  ], [EXTERNAL_CODEX_TELEMETRY]);
  return { 'codex-a': { proxyPort: a1!, litellmPort: a2! }, 'codex-b': { proxyPort: b1!, litellmPort: b2! } };
}

export const laneDir = (h: string, id: string): string => join(h, '.ccrc', 'codex', id);
export const laneJson = (h: string, id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(laneDir(h, id), 'lane.json'), 'utf8')) as Record<string, unknown>;
export const litellmYaml = (h: string, id: string): string => join(laneDir(h, id), 'litellm.yaml');
export const sha256 = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
/** The litellm tier's code identity (codex-bridge Stage 1, Task 6): the sha256 of the
 *  generation's stamp's bytes followed by the placed auth library's. */
export const litellmCode = (stamp: string, h: string): string =>
  createHash('sha256').update(fs.readFileSync(stamp)).update(fs.readFileSync(authLib(h))).digest('hex');
/** The bridge's code identity (the whole-wave fix round of codex bridge Stage 2, L2): the litellm tier's shape, the
 *  sha256 of the placed shim's bytes followed by the placed auth library's, which the bridge loads for its whole life. */
export const bridgeCode = (shim: string, h: string): string =>
  createHash('sha256').update(fs.readFileSync(shim)).update(fs.readFileSync(authLib(h))).digest('hex');
/** Where `_codex_auth_lib` names the library: `plantCodexBins` places it there. */
export const authLib = (h: string): string => join(h, '.local', 'bin', 'ccgpt-auth.py');

/** Drive the auth library's own refresher once over the authDir `dir` (an expired backend credential planted there
 *  first) against a fake endpoint whose one token answer is `answer`, so the status file a case reads is the library's
 *  own, never a hand-made one (codex-bridge Stage 1, Task 8). `word` is the refusal the refresh must end in, and the
 *  state the status file must then hold. The driver runs under `home`, a fixture HOME, as every library spawn does. */
export async function refusedRefresh(home: string, dir: string, answer: AuthAnswer, word: string): Promise<void> {
  plantBackendCredential(dir, { expiresIn: -120 });
  const srv = await fakeAuthServer({ token: [answer] });
  try {
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'ensure_fresh', lane: 'codex-a' }] },
      { CCRC_CODEX_AUTH_BASE: srv.base });
    expect(r.timedOut, r.stderr).toBe(false);
    expect(driverLines(r.stdout)[0]?.['error'], r.stdout + r.stderr).toBe(word);
    expect(srv.requests.map((q) => q.path)).toEqual([AUTH_ROUTES.token]);
  } finally {
    await srv.close();
  }
  const status = JSON.parse(fs.readFileSync(join(dir, 'auth.status.json'), 'utf8')) as Record<string, unknown>;
  expect(status['state']).toBe(word);
}
