// The fixture the accounts plan's Task A11 suites share: `ccrc-account-lane-state`, `-lock`, `-kill` and
// `-backfill` (D-5517, D-5518, D-5755). It is `ccrc-account.test.ts`'s harness cut to what these four need, and it
// keeps that file's containment: HOME is a throwaway directory, `ccrc` runs out of `<home>/ccrc/ccd/ccrc` (the shape
// of a deployed box, which `CCRC_HERE` resolves `../deploy/account-op.mjs` against), and every tool that could reach
// the network, a real manager or a real tmux server is a poison first on PATH. Nothing here runs against the live
// `$HOME`, and no fixture holds a real-shaped secret: the credential is a fixed canary string.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { assertManagerStandIns, MANAGER_STANDIN_MARK } from './codexLaneFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
export const ACCOUNT_OP = join(REPO, 'deploy', 'account-op.mjs');
export const HEALTH_SRC = join(REPO, 'ccd', 'ccd-account-health');

/** bash's absolute path, resolved once under this process's real PATH. */
export const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
/** Whether this box has `flock`: the verbs need it, and stock macOS does not ship it. */
export const HAVE_FLOCK = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;

/** A fixed, non-secret credential. Every case asserts it never reaches a lane-state file. */
export const CANARY = 'CANARY-a11-lane-state-not-a-token';
/** The node-id the fixture box carries, so `fleetIdentity` has a value to be measured against. */
export const NODE_ID = '0a11a11a-0000-4000-8000-00000000a11a';

/** One upstream and one generated Anthropic token lane, in the plan's lane vocabulary. */
export const FIXTURE_ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane·b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ],
};

export const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');
export const laneStateDir = (home: string): string => join(home, '.cc-sessions', '.accounts');
export const laneStatePath = (home: string, id: string): string => join(laneStateDir(home), `${id}.json`);

/** The lane's state as parsed JSON, or `null` when the file is absent. */
export function laneState(home: string, id: string): Record<string, unknown> | null {
  const p = laneStatePath(home, id);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown> : null;
}

/** Permission bits of a path, as an octal string such as `600`. */
export const modeOf = (p: string): string => (statSync(p).mode & 0o777).toString(8);

export function seedRoster(home: string, roster: unknown = FIXTURE_ROSTER): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  const g = spawnSync('node', [join(REPO, 'deploy', 'gen-accounts.mjs'), join(home, '.ccrc', 'accounts.json')],
    { encoding: 'utf8' });
  if (g.status !== 0) throw new Error(`gen-accounts refused the fixture roster: ${g.stderr}`);
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), g.stdout);
}

/** The env every runner here spawns under: `ghContainedEnv` plus this file's poisons, then the manager check. */
export function boxEnv(home: string): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home });
  const poison = (name: string, ifAbsent = false): void => {
    const p = join(home, '.local', 'bin', name);
    if (ifAbsent && existsSync(p)) return;
    writeFileSync(p, `#!/bin/sh\n${MANAGER_STANDIN_MARK}\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "the lane-state suites never reach a real ${name}" >&2\nexit 97\n`, { mode: 0o755 });
  };
  for (const n of ['curl', 'systemctl', 'systemd-run', 'launchctl']) poison(n);
  poison('tmux', true);
  for (const k of Object.keys(e)) if (k.startsWith('CCRC_')) delete e[k];
  assertManagerStandIns(e, home);
  return e;
}

/** A box carrying the tree, a roster, the upstream binary, the six installer recorders and a node-id. */
export function laneBox(prefix: string, roster: unknown = FIXTURE_ROSTER): string {
  const home = mkTmp(prefix);
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccd-account-health']) {
    symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  symlinkSync(join(REPO, 'deploy'), join(home, 'ccrc', 'deploy'));
  symlinkSync(join(REPO, 'shared'), join(home, 'ccrc', 'shared'));
  seedRoster(home, roster);
  writeFileSync(join(home, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), 'PKnot-a-script\n', { mode: 0o755 });
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const n of ['install-session-hooks.sh', 'install-coordinator-skill.sh', 'install-worker-skill.sh',
    'install-reviewer-skill.sh', 'install-graphify-skill.sh', 'install-history-skill.sh']) {
    writeFileSync(join(reg, n),
      `#!/bin/sh\nprintf '%s %s\\n' "${n}" "$*" >> "$HOME/installer-calls"\n`
      + `[ "${n}" = install-session-hooks.sh ] && [ -f "$HOME/slow-installer" ] && sleep 3\nexit 0\n`,
      { mode: 0o755 });
  }
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\n[ "$1" = list-sessions ] && exit 0\nexit 90\n', { mode: 0o755 });
  boxEnv(home);
  return home;
}

export interface Result { code: number; stdout: string; stderr: string }

/** `ccrc <args>` under umask 022, so a file that is 0600 is 0600 because the writer made it so. */
export function ccrcRun(home: string, args: string[], stdin = '', extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
    { env: { ...boxEnv(home), ...extraEnv }, encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The same, spawned in its own process group so a case can signal the whole group as the agent does. */
export function ccrcSpawn(home: string, args: string[], stdin = ''): ChildProcess {
  const c = spawn(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
    { env: boxEnv(home), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  c.stdin!.end(stdin);
  return c;
}

/** The one JSON object a verb prints. */
export function answer(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) throw new Error(`expected one JSON line, got ${lines.length}: ${r.stdout}${r.stderr}`);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

/** `ccrc account add` of a compatible token lane, the credential on stdin. */
export function addLane(home: string, id: string, credential = CANARY): Result {
  return ccrcRun(home, ['account', 'add', '--id', id, '--provider', 'compatible', '--label', `${id}·x`,
    '--hue', 'amber', '--base-url', 'https://orchard-api/v1', '--credential', '-'], `${credential}\n`);
}

/** The lane's launcher replaced by a probe stub: `auth status` says logged in, and a probe turn answers ok. */
export function plantProbe(home: string, id: string): void {
  writeFileSync(join(home, '.local', 'bin', id), [
    '#!/bin/sh',
    'if [ "$1" = auth ]; then echo \'{"loggedIn":true,"authMethod":"claudeai"}\'; exit 0; fi',
    'echo \'{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0}\'',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
}

/** The writer called directly, as the mint verbs (A32) will call it. */
export function writeLaneState(home: string, args: string[]): Result {
  const r = spawnSync(BASH, ['-c', 'umask 022; exec node "$@"', '_', ACCOUNT_OP, 'lane-state', ...args],
    { env: { ...boxEnv(home) }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Every secret temp under `~/.cc-secrets` for one lane. */
export function secretTemps(home: string, id: string): string[] {
  const d = join(home, '.cc-secrets');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => n.startsWith(`.${id}-`) && n.includes('.tmp.'));
}

/** Waits for a file to appear, bounded. */
export async function waitFor(p: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!existsSync(p)) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${p}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Resolves with the child's exit status (a signal counts as 128 + its number). */
export function exited(c: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    c.on('exit', (code, sig) => resolve(code ?? (sig === 'SIGKILL' ? 137 : sig === 'SIGTERM' ? 143 : -1)));
  });
}
