// The Codex lane's add arm (accounts plan Task A24; spec §7.2, §9 row 5, §11, G2, G20; D-5519, N4). `ccrc account add
// --provider openai` makes a ccrc-owned Codex lane: a free port pair, a fresh authDir, the row off, converged. `remove`
// deletes that folder unless told to keep it. Sign in again signs in to scratch, and only a credential that passes its
// check moves into the lane. Every case runs in a fixture HOME; the sign-in talks to `fakeAuthServer`, never a provider.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { buildAccountArgv } from '../../shared/account-argv.js';
import {
  ATTEMPT, AUTH_ROSTER, HOST_OSTYPE, answerOf, authBox, authEnv, ccrcAuth, plantAttempt, reapAll, scratchOf, scrollbacks, statusOf, waitQuiet,
  waitState,
} from './authAttemptFixture.js';
import { fakeAuthServer, plantBackendCredential, syntheticJwt } from './codexAuthFixture.js';
import { freePort, freePorts, plantCodexBins, plantFakeRuntime } from './codexLaneFixture.js';
import { ACCOUNT_OP, BASH, HAVE_FLOCK, REPO, laneState, seedRoster } from './laneStateFixture.js';
import { makeCcdHarness } from './ccdWsHelpers.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homes: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const h of homes.splice(0)) reapAll(h);
});

const AUTH_ROOT = '.local/share/ccrc/codex';
/** What the model probe's fetch answers, read through `CCRC_MODELS_PROBE_FIXTURE`. */
const CODEX_RAW = join(REPO, 'server', 'test', 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const host = { OSTYPE: HOST_OSTYPE };
const rosterOf = (home: string): { accounts: Array<Record<string, any>> } =>
  JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
const rowOf = (home: string, id: string): Record<string, any> | undefined => rosterOf(home).accounts.find((a) => a['id'] === id);
const add = (home: string, id: string, extra: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  ccrcAuth(home, ['account', 'add', '--id', id, '--provider', 'openai', '--label', `${id}·gpt`, '--hue', 'green', ...extra], '',
    { ...host, ...env });

/** A box with the Codex runtime and its bins, and the lanes' first free port the case's own. */
async function codexBox(prefix: string, opts: { roster?: unknown; runtime?: boolean } = {}): Promise<{ home: string; base: string }> {
  const home = authBox(prefix, opts.roster === undefined ? {} : { roster: opts.roster });
  homes.push(home);
  plantCodexBins(home);
  if (opts.runtime !== false) plantFakeRuntime(home);
  symlinkSync(join(REPO, 'ccd', 'ccrc-models-probe'), join(home, 'ccrc', 'ccd', 'ccrc-models-probe'));
  return { home, base: String(await freePort()) };
}

function listen(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => { servers.push(s); resolve(); });
  });
}

/** Everything an add that refuses must not have written. */
function nothingOf(home: string, id: string): void {
  expect(rowOf(home, id), 'the roster row').toBeUndefined();
  expect(existsSync(join(home, `.claude-${id}`)), 'the config dir').toBe(false);
  expect(existsSync(join(home, '.local', 'bin', id)), 'the launcher').toBe(false);
  expect(existsSync(join(home, '.cc-sessions', `${id}-disabled`)), 'the off marker').toBe(false);
  expect(existsSync(join(home, '.ccrc', 'models', `${id}.json`)), 'the class registry').toBe(false);
  expect(existsSync(join(home, '.ccrc', 'codex', id)), 'the lane directory').toBe(false);
}

describe('`add --provider openai` (spec §7.2 step 3; G2)', () => {
  it('an add writes a codex row with a free port pair and a fresh authDir, off and converged', async () => {
    const { home, base } = await codexBox('ccrc-codex-add-');
    await listen(Number(base));
    const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['ok']).toBe(true);

    const row = rowOf(home, 'lane-g')!;
    expect(row['homeAble']).toBe(true);
    expect(row['telemetry']).toBe('codex');
    expect(row['exec']['kind']).toBe('codex');
    expect(row['exec']['provider']).toBe('openai');
    expect(row['exec']['authDir']).toMatch(new RegExp(`^${AUTH_ROOT}/lane-g-[0-9a-f]{6}$`));
    expect(existsSync(join(home, row['exec']['authDir'])), 'the sign-in makes the folder, the add does not').toBe(false);
    const ports = [row['exec']['proxyPort'], row['exec']['litellmPort']] as number[];
    expect(ports[0]).not.toBe(ports[1]);
    expect(ports, 'a port a listener holds').not.toContain(Number(base));

    expect(existsSync(join(home, '.cc-sessions', 'lane-g-disabled')), 'the lane starts off').toBe(true);
    expect(readFileSync(join(home, '.local', 'bin', 'lane-g'), 'utf8')).toContain('ccrc-codex');
    expect(existsSync(join(home, '.ccrc', 'models', 'lane-g.classes.json')), 'models init codex').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'codex', 'lane-g', 'litellm.yaml')), 'a catalogue needs a signed-in lane').toBe(false);
    expect(laneState(home, 'lane-g')?.['addedAt']).toBeTypeOf('string');
    expect(String(answerOf(r)['operator-steps'])).toContain('ccrc-codex-usage@lane-g.timer');
  }, 60_000);

  it('two lanes never share a port, though neither has started: the roster is probed as well as the listeners', async () => {
    const { home, base } = await codexBox('ccrc-codex-add-roster-');
    for (const id of ['lane-g', 'lane-h']) {
      const r = add(home, id, [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
      expect(r.code, r.stdout + r.stderr).toBe(0);
    }
    const [g, h] = ['lane-g', 'lane-h'].map((id) => rowOf(home, id)!['exec']);
    expect(new Set([g['proxyPort'], g['litellmPort'], h['proxyPort'], h['litellmPort']]).size).toBe(4);
  }, 60_000);

  it('a port base with no free pair in reach refuses `no-free-port` and writes nothing', async () => {
    const { home } = await codexBox('ccrc-codex-add-noport-');
    const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: '65535' });
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('no-free-port');
    nothingOf(home, 'lane-g');
  }, 60_000);

  it('a re-add of the same id gets a different authDir', async () => {
    const { home, base } = await codexBox('ccrc-codex-readd-');
    expect(add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base }).code).toBe(0);
    const first = rowOf(home, 'lane-g')!['exec']['authDir'] as string;
    plantBackendCredential(join(home, first));
    const gone = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', '--keep-codex-auth'], '', host);
    expect(gone.code, gone.stdout + gone.stderr).toBe(0);
    expect(existsSync(join(home, first)), 'kept, so a reuse would inherit it').toBe(true);

    // The config dir stays (spec §11), so the re-add takes it over by name; the sign-in folder is never taken over.
    const again = add(home, 'lane-g', ['--adopt'], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(again.code, again.stdout + again.stderr).toBe(0);
    const second = rowOf(home, 'lane-g')!['exec']['authDir'] as string;
    expect(second).not.toBe(first);
    expect(second).toMatch(new RegExp(`^${AUTH_ROOT}/lane-g-[0-9a-f]{6}$`));
  }, 60_000);

  it('an existing authDir refuses `authdir-occupied` and writes nothing', async () => {
    const { home, base } = await codexBox('ccrc-codex-add-occupied-');
    // The fresh name is six random hex digits; this `od` makes it known, so the case can stand something there first.
    writeFileSync(join(home, '.local', 'bin', 'od'), '#!/bin/sh\necho " ab cd ef"\n', { mode: 0o755 });
    const taken = join(home, AUTH_ROOT, 'lane-g-abcdef');
    mkdirSync(taken, { recursive: true });
    const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('authdir-occupied');
    nothingOf(home, 'lane-g');
    expect(readdirSync(taken)).toEqual([]);
  }, 60_000);

  it('no venv refuses `codex-runtime-absent` and writes nothing, and builds nothing', async () => {
    const { home, base } = await codexBox('ccrc-codex-add-no-venv-', { runtime: false });
    const cli = join(home, '.local', 'bin', 'ccgpt-runtime');
    const real = readFileSync(cli, 'utf8');
    writeFileSync(cli, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$HOME/runtime-calls"\n[ "\${1:-}" = build ] && mkdir -p "$HOME/built"\n${real.replace(/^#!.*\n/, '')}`,
      { mode: 0o755 });
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('codex-runtime-absent');
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    nothingOf(home, 'lane-g');
    expect(existsSync(join(home, 'built')), 'a venv was built under the verb').toBe(false);
    expect(readFileSync(join(home, 'runtime-calls'), 'utf8').trim().split('\n')).not.toContain('build');
  }, 60_000);

  it.each([
    [['--credential', '-'], 'credential-not-managed'],
    [['--base-url', 'https://orchard-api/v1'], 'base-url-not-supported'],
    [['--models', '{"opus":"a"}'], 'models-not-supported'],
    [['--method', 'login'], 'method-not-supported'],
  ])('%j is not an openai lane\'s to take: `%s`, and nothing is written', async (flags, code) => {
    const { home, base } = await codexBox('ccrc-codex-add-flags-');
    const r = add(home, 'lane-g', flags as string[], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(r.code).not.toBe(0);
    expect(answerOf(r)['error']).toBe(code);
    nothingOf(home, 'lane-g');
  }, 60_000);

  it('`declare --provider openai` still records a launcher somebody else owns', async () => {
    const { home } = await codexBox('ccrc-codex-declare-');
    writeFileSync(join(home, '.local', 'bin', 'lane-d'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = ccrcAuth(home, ['account', 'declare', '--id', 'lane-d', '--provider', 'openai', '--label', 'lane·d', '--hue', 'violet'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(home, 'lane-d')!['exec']).toEqual({ kind: 'external', provider: 'openai' });
  }, 60_000);
});

/** A signed-in lane, ready to remove: added through the verb, with a credential in its folder. */
async function signedInLane(prefix: string, roster?: unknown): Promise<{ home: string; authDir: string; rel: string }> {
  const { home, base } = await codexBox(prefix, roster === undefined ? {} : { roster });
  const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const rel = rowOf(home, 'lane-g')!['exec']['authDir'] as string;
  plantBackendCredential(join(home, rel));
  return { home, authDir: join(home, rel), rel };
}

describe('remove and the lane\'s sign-in folder (spec §11 step 4; G20, Q11)', () => {
  const uiArgv = (id: string, fields: Record<string, string>): string[] => {
    const built = buildAccountArgv('remove', id, fields, false);
    if (!built.ok) throw new Error(`the builder refused: ${built.why}`);
    return [...built.argv];
  };

  it.each([
    ['the argv the route builds today', {}],
    ['the same with the sheet\'s line ticked', { deleteCodexAuth: 'true' }],
  ])('remove from the UI path deletes the authDir: %s', async (_name, fields) => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-ui-');
    const r = ccrcAuth(home, uiArgv('lane-g', { mode: 'remove', ...fields }), '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(existsSync(authDir), 'the sign-in folder').toBe(false);
    const a = answerOf(r);
    expect(a['removed']).toContain(authDir);
    expect(a['kept']).not.toContain(authDir);
    expect(a['atProvider']).toEqual([expect.objectContaining({ kind: 'codex' })]);
  }, 60_000);

  it.each([['--keep-codex-auth'], ['--keep-credential']])('%s keeps it, and says so', async (flag) => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-keep-');
    const bytes = readFileSync(join(authDir, 'auth.json'), 'utf8');
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', flag], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(bytes);
    expect(answerOf(r)['kept']).toContain(authDir);
  }, 60_000);

  it('the two flags together refuse, before anything is touched', async () => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-both-');
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', '--delete-codex-auth', '--keep-codex-auth'], '', host);
    expect(r.code).toBe(2);
    expect(answerOf(r)['error']).toBe('bad-argument');
    expect(existsSync(authDir)).toBe(true);
    expect(rowOf(home, 'lane-g')).toBeDefined();
  }, 60_000);

  it('a folder ccrc did not make is kept and named, as is one another lane still names', async () => {
    const { home, authDir, rel } = await signedInLane('ccrc-codex-remove-foreign-');
    const roster = rosterOf(home);
    const lane = roster.accounts.find((a) => a['id'] === 'lane-g')!;
    const ports = (await freePorts(8)).slice(-2);   // past the two the add took from the same allocator
    roster.accounts.push({ ...lane, id: 'lane-h', label: 'lane·h', configDirSuffix: '.claude-lane-h', hue: 'blue',
      exec: { ...lane['exec'], proxyPort: ports[0], litellmPort: ports[1] } });
    seedRoster(home, roster);
    const wrote = ccrcAuth(home, ['wrappers'], '', host);
    expect(wrote.code, wrote.stdout + wrote.stderr).toBe(0);
    const shared = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(shared.code, shared.stdout + shared.stderr).toBe(0);
    expect(existsSync(authDir), 'lane-h still signs in with this folder').toBe(true);
    expect(answerOf(shared)['kept']).toContain(authDir);
    expect(String(answerOf(shared)['operator-steps'])).toContain(rel);

    const outside = '.handoff/chatgpt-auth-h';
    const now = rosterOf(home);
    now.accounts.find((a) => a['id'] === 'lane-h')!['exec']['authDir'] = outside;
    seedRoster(home, now);
    plantBackendCredential(join(home, outside));
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-h'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(home, outside, 'auth.json')), 'a folder ccrc did not make').toBe(true);
    expect(answerOf(r)['kept']).toContain(join(home, outside));
    expect(String(answerOf(r)['operator-steps'])).toContain(outside);
  }, 90_000);
});

const CODEX_ROSTER = (ports: number[]) => ({
  ...AUTH_ROSTER,
  accounts: [...AUTH_ROSTER.accounts, {
    id: 'lane-c', label: 'lane·c', configDirSuffix: '.claude-lane-c', homeAble: true, hue: 'green', telemetry: 'codex',
    exec: { kind: 'codex', provider: 'openai', proxyPort: ports[0], litellmPort: ports[1], authDir: `${AUTH_ROOT}/lane-c` },
  }],
});

async function codexLane(prefix: string): Promise<{ home: string; authDir: string; old: string }> {
  const { home } = await codexBox(prefix, { roster: CODEX_ROSTER(await freePorts(2)) });
  const authDir = join(home, AUTH_ROOT, 'lane-c');
  plantBackendCredential(authDir);
  return { home, authDir, old: readFileSync(join(authDir, 'auth.json'), 'utf8') };
}

const fetched = { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW };
const setCodex = (home: string, env: NodeJS.ProcessEnv = fetched) =>
  ccrcAuth(home, ['account', 'set', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '', { ...host, ...env });
const scratchDir = (home: string): string => join(scratchOf(home, 'lane-c'), 'codex');

describe('Sign in again on a Codex lane (spec §9 row 5)', () => {
  it('a Codex Sign in again keeps the old `authDir` contents until the scratch sign-in passes its check, and a cancelled one leaves them byte-identical', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-');
    const fresh = syntheticJwt({ exp: Math.floor(Date.now() / 1000) + 3600, jti: 'fresh-sign-in' });
    const code = (user: string) => ({ status: 200, body: { device_auth_id: 'dev-1', user_code: user, interval: 1 } });
    const pending = await fakeAuthServer({ usercode: [code('ABCD-1234')], deviceToken: Array.from({ length: 20 }, () => ({ status: 403, body: {} })) });
    const approved = await fakeAuthServer({
      usercode: [code('ABCD-5678')],
      deviceToken: [{ status: 200, body: { authorization_code: 'code-1', code_challenge: 'challenge-1', code_verifier: 'verifier-1' } }],
      token: [{ status: 200, body: { access_token: fresh, refresh_token: 'rtok-fresh', id_token: fresh } }],
    });
    const start = (base: string) => ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '',
      { CCRC_CODEX_AUTH_BASE: base, CCRC_AUTH_TIMEOUT: '60', ...fetched });
    try {
      // Cancelled: the code is on the operator's screen and the old sign-in has not moved.
      expect(start(pending.base).code).toBe(0);
      await waitFor(() => statusOf(home, 'lane-c')?.['userCode'] === 'ABCD-1234');
      expect(readFileSync(join(authDir, 'auth.json'), 'utf8'), 'waiting').toBe(old);
      expect(ccrcAuth(home, ['account', 'auth-cancel', '--id', 'lane-c', '--attempt', ATTEMPT]).code).toBe(0);
      expect(await waitState(home, 'lane-c', ['cancelled', 'failed', 'done'], 40_000)).toBe('cancelled');
      await waitQuiet(home);
      expect(readFileSync(join(authDir, 'auth.json'), 'utf8'), 'cancelled').toBe(old);
      expect(readdirSync(authDir)).toEqual(['auth.json']);
      expect(existsSync(scratchOf(home, 'lane-c'))).toBe(false);

      // Finished: the sign-in lands in scratch, passes its check, and only then replaces the old one.
      expect(start(approved.base).code).toBe(0);
      const ended = await waitState(home, 'lane-c', ['done', 'failed'], 60_000);
      expect(ended, JSON.stringify(scrollbacks(home))).toBe('done');
      await waitQuiet(home);
      const next = JSON.parse(readFileSync(join(authDir, 'auth.json'), 'utf8'));
      expect(next['refresh_token']).toBe('rtok-fresh');
      expect(existsSync(scratchOf(home, 'lane-c'))).toBe(false);
    } finally {
      await pending.close();
      await approved.close();
    }
  }, 150_000);

  it.each([
    ['the backend does not answer it', {}, { CCRC_MODELS_PROBE_FIXTURE: '/nonexistent/answer' }, 'token-unverified'],
    ['it is already expired', { expiresIn: -60 }, fetched, 'no-credential'],
  ])('a scratch credential that fails its check leaves the lane byte-identical: %s', async (_name, cred, env, code) => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-refused-');
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home), cred);
    const r = setCodex(home, env);
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe(code);
    expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(old);
    expect(readdirSync(authDir)).toEqual(['auth.json']);
    expect(existsSync(join(home, '.ccrc', 'models', 'lane-c.json')), 'the check wrote the lane\'s catalogue').toBe(false);
  }, 60_000);

  it('no sign-in in scratch refuses `no-credential`, and another attempt\'s refuses `no-auth-attempt`', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-none-');
    plantAttempt(home, 'lane-c', ATTEMPT);
    const none = setCodex(home);
    expect(none.code).toBe(1);
    expect(answerOf(none)['error']).toBe('no-credential');

    plantAttempt(home, 'lane-c', 'f'.repeat(32));
    plantBackendCredential(scratchDir(home));
    const other = setCodex(home);
    expect(other.code).toBe(1);
    expect(answerOf(other)['error']).toBe('no-auth-attempt');
    expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(old);
  }, 60_000);

  it('a passing install replaces the credential, clears the old check and leaves no scratch', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-install-');
    const wrote = spawnSync(BASH, ['-c', 'exec node "$@"', '_', ACCOUNT_OP, 'lane-state', '--id', 'lane-c', '--check-verdict', 'auth-dead',
      '--check-at', '2026-11-01T00:00:00Z'], { env: authEnv(home, host), encoding: 'utf8' });
    expect(wrote.status, wrote.stdout + wrote.stderr).toBe(0);
    plantAttempt(home, 'lane-c', ATTEMPT);
    const cred = plantBackendCredential(scratchDir(home));
    const r = setCodex(home);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(cred.refresh);
    const now = readFileSync(join(authDir, 'auth.json'), 'utf8');
    expect(now).not.toBe(old);
    expect(JSON.parse(now)['refresh_token']).toBe(cred.refresh);
    expect(existsSync(scratchDir(home))).toBe(false);
    expect(laneState(home, 'lane-c')?.['check']).toBeUndefined();
  }, 60_000);

  it('a first sign-in renders the lane\'s LiteLLM config, so the check that follows can start its gateway', async () => {
    const { home, base } = await codexBox('ccrc-codex-first-');
    expect(add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base }).code).toBe(0);
    plantAttempt(home, 'lane-g', ATTEMPT);
    plantBackendCredential(join(scratchOf(home, 'lane-g'), 'codex'));
    const r = ccrcAuth(home, ['account', 'set', '--id', 'lane-g', '--method', 'openai-login', '--attempt', ATTEMPT], '', { ...host, ...fetched });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(home, rowOf(home, 'lane-g')!['exec']['authDir'], 'auth.json'))).toBe(true);
    expect(existsSync(join(home, '.ccrc', 'codex', 'lane-g', 'litellm.yaml')), r.stderr).toBe(true);
  }, 60_000);

  it('Sign in again renders nothing on a lane that has its config, so no tier restarts', async () => {
    const { home } = await codexLane('ccrc-codex-reauth-norender-');
    // A registry, so a refresh would have a lane to render: without one it refuses, and this case would prove nothing.
    expect(ccrcAuth(home, ['models', 'lane-c', 'init', 'codex'], '', host).code).toBe(0);
    const yaml = join(home, '.ccrc', 'codex', 'lane-c', 'litellm.yaml');
    mkdirSync(join(home, '.ccrc', 'codex', 'lane-c'), { recursive: true });
    writeFileSync(yaml, 'as-it-was\n');
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    expect(setCodex(home).code).toBe(0);
    expect(readFileSync(yaml, 'utf8')).toBe('as-it-was\n');
  }, 60_000);

  it('`set --method openai-login` is a Codex lane\'s alone', async () => {
    const { home } = await codexLane('ccrc-codex-reauth-kind-');
    plantAttempt(home, 'lane-s', ATTEMPT);
    const r = ccrcAuth(home, ['account', 'set', '--id', 'lane-s', '--method', 'openai-login', '--attempt', ATTEMPT], '', host);
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('method-not-supported');
  }, 60_000);
});

describe('`ccd caps` (N4)', () => {
  it('`ccd caps` lists `account-codex-v1`', () => {
    const h = makeCcdHarness('ccd-caps-codex-');
    homes.push(h.home);
    expect(h.sh('cmd_caps').split('\n')).toContain('account-codex-v1');
  });
});

async function waitFor(cond: () => boolean, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return;
    await new Promise((r) => { setTimeout(r, 100); });
  }
  throw new Error('the condition never held');
}

