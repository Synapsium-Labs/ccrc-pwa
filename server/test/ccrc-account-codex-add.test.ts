// The Codex lane's add arm (accounts plan Task A24; spec §7.2, §9 row 5, §11, G2, G20; D-5519, N4). `ccrc account add
// --provider openai` makes a ccrc-owned Codex lane: a free port pair, a fresh authDir, the row off, converged. `remove`
// deletes that folder unless told to keep it. Sign in again signs in to scratch, and only a credential that passes its
// check moves into the lane. Every case runs in a fixture HOME; the sign-in talks to `fakeAuthServer`, never a provider.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { buildAccountArgv } from '../../shared/account-argv.js';
import {
  ATTEMPT, AUTH_ROSTER, HOST_OSTYPE, answerOf, authBox, authEnv, ccrcAuth, plantAttempt, reapAll, scratchOf, scrollbacks, statusOf, waitQuiet,
  waitState,
} from './authAttemptFixture.js';
import { LANE_FOLDER_FAULTS, fakeAuthServer, plantBackendCredential, runAuthDriver, syntheticJwt } from './codexAuthFixture.js';
import { freePort, freePorts, plantCodexBins, plantFakeRuntime, probeRuntime, probeRuntimeCalls } from './codexLaneFixture.js';
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

  it('the first lane on a box: the refusal names the build that needs no lane, and what it leaves gets the add through', async () => {
    const { home, base } = await codexBox('ccrc-codex-add-first-', { runtime: false });
    const refused = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(answerOf(refused)['error']).toBe('codex-runtime-absent');
    // `ccrc install` builds nothing here: its step answers "none" until a row exists, and this verb writes the row.
    expect(String(answerOf(refused)['detail'])).toContain("Run 'ccgpt-runtime build'");
    plantFakeRuntime(home);
    const r = add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(home, 'lane-g')!['exec']['kind']).toBe('codex');
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
    expect(a['atProvider']).toEqual([{ kind: 'codex', state: 'still-valid', revokeAt: 'chatgpt-settings' }]);
  }, 60_000);

  it.each([['remove'], ['discard']])('a lane nobody signed in lists nothing at the provider: --mode %s', async (mode) => {
    const { home, base } = await codexBox('ccrc-codex-remove-unsigned-');
    expect(add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base }).code).toBe(0);
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', '--mode', mode], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['atProvider']).toEqual([]);
  }, 60_000);

  it('a cancelled first sign-in lists nothing at the provider either', async () => {
    const { home, base } = await codexBox('ccrc-codex-remove-cancelled-');
    expect(add(home, 'lane-g', [], { CCRC_ACCOUNT_CODEX_PORT_BASE: base }).code).toBe(0);
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-1234', interval: 1 } }],
      deviceToken: Array.from({ length: 20 }, () => ({ status: 403, body: {} })),
    });
    try {
      expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-g', '--method', 'openai-login', '--attempt', ATTEMPT], '',
        { CCRC_CODEX_AUTH_BASE: srv.base, CCRC_AUTH_TIMEOUT: '60' }).code).toBe(0);
      await waitFor(() => statusOf(home, 'lane-g')?.['userCode'] === 'ABCD-1234');
      expect(ccrcAuth(home, ['account', 'auth-cancel', '--id', 'lane-g', '--attempt', ATTEMPT]).code).toBe(0);
      expect(await waitState(home, 'lane-g', ['cancelled', 'failed', 'done'], 40_000)).toBe('cancelled');
      await waitQuiet(home);
    } finally {
      await srv.close();
    }
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', '--mode', 'discard'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['atProvider']).toEqual([]);
  }, 120_000);

  // A crash between a checkpoint's fsync and its rename, on a first sign-in, leaves a whole sign-in the library's `read`
  // does not see: it reads `auth.json` alone, and only a settle under the lock promotes the checkpoint (D-8016 (12)).
  it.each<[string, string, string[]]>([
    ['--mode remove', 'remove', []],
    ['--mode discard', 'discard', []],
    ['--keep-codex-auth', 'remove', ['--keep-codex-auth']],
  ])('a folder holding only a crash checkpoint keeps the provider row, though the library reads `absent`: %s', async (_name, mode, extra) => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-checkpoint-');
    renameSync(join(authDir, 'auth.json'), join(authDir, 'auth.pending.json'));
    const read = spawnSync('python3', ['-IS', join(REPO, 'ccd', 'ccgpt-auth.py'), 'status', '--auth-dir', authDir], { encoding: 'utf8' });
    expect(JSON.parse(read.stdout)['credential'], 'the premise').toBe('absent');
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g', '--mode', mode, ...extra], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)[extra.length > 0 ? 'kept' : 'removed']).toContain(authDir);
    expect(answerOf(r)['atProvider']).toEqual([{ kind: 'codex', state: 'still-valid', revokeAt: 'chatgpt-settings' }]);
  }, 60_000);

  it('anything at the checkpoint path keeps the row, a link to nothing included: the library would have to settle it to say', async () => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-checkpoint-link-');
    rmSync(join(authDir, 'auth.json'));
    symlinkSync(join(home, 'nothing-here'), join(authDir, 'auth.pending.json'));
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['atProvider']).toEqual([expect.objectContaining({ kind: 'codex' })]);
  }, 60_000);

  it('a library that names no checkpoint path has said nothing, so the row stays', async () => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-nopath-');
    rmSync(join(authDir, 'auth.json'));
    const lib = join(home, '.local', 'bin', 'ccgpt-auth.py');
    rmSync(lib);  // a link into this tree: written through, it would change the real library
    writeFileSync(lib, [
      'import subprocess, sys',
      'if sys.argv[1] == "secret-files": sys.exit(1)',
      `sys.exit(subprocess.call([sys.executable, "-IS", ${JSON.stringify(join(REPO, 'ccd', 'ccgpt-auth.py'))}] + sys.argv[1:]))`,
    ].join('\n'));
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['atProvider']).toEqual([expect.objectContaining({ kind: 'codex' })]);
  }, 60_000);

  it('a folder that holds neither lists nothing: its lock and status are not a sign-in', async () => {
    const { home, authDir } = await signedInLane('ccrc-codex-remove-emptied-');
    rmSync(join(authDir, 'auth.json'));
    writeFileSync(join(authDir, 'auth.json.lock'), '', { mode: 0o600 });
    writeFileSync(join(authDir, 'auth.status.json'), '{}', { mode: 0o600 });
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(answerOf(r)['removed']).toContain(authDir);
    expect(answerOf(r)['atProvider']).toEqual([]);
  }, 60_000);

  it('a folder the library cannot call empty keeps the provider row: an unfinished sign-in, and a library that cannot answer', async () => {
    const unfinished = await signedInLane('ccrc-codex-remove-unfinished-');
    writeFileSync(join(unfinished.authDir, 'auth.json'), JSON.stringify({ device_code_requested_at: 1 }), { mode: 0o600 });
    const a = ccrcAuth(unfinished.home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(answerOf(a)['atProvider']).toEqual([expect.objectContaining({ kind: 'codex' })]);

    const blind = await signedInLane('ccrc-codex-remove-blind-');
    rmSync(join(blind.home, '.local', 'bin', 'ccgpt-auth.py'));
    const b = ccrcAuth(blind.home, ['account', 'remove', '--id', 'lane-g'], '', host);
    expect(b.code, b.stdout + b.stderr).toBe(0);
    expect(answerOf(b)['atProvider']).toEqual([expect.objectContaining({ kind: 'codex' })]);
  }, 90_000);

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

describe('the guard is the path, not who made the folder (D-8016 (6))', () => {
  it('a hand-written lane under ccrc\'s home is deleted by default, and `--keep-codex-auth` keeps it', async () => {
    const first = await codexLane('ccrc-codex-remove-handmade-');
    const r = ccrcAuth(first.home, ['account', 'remove', '--id', 'lane-c'], '', host);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(existsSync(first.authDir), 'no record says who made it, so it goes').toBe(false);
    expect(answerOf(r)['removed']).toContain(first.authDir);
    expect(answerOf(r)['operator-steps']).toEqual([]);

    const second = await codexLane('ccrc-codex-remove-handmade-kept-');
    const kept = ccrcAuth(second.home, ['account', 'remove', '--id', 'lane-c', '--keep-codex-auth'], '', host);
    expect(kept.code, kept.stdout + kept.stderr).toBe(0);
    expect(readFileSync(join(second.authDir, 'auth.json'), 'utf8')).toBe(second.old);
    expect(answerOf(kept)['kept']).toContain(second.authDir);
  }, 90_000);
});

describe('a folder another lane reaches stays, however its row spells it (D-8016 (6))', () => {
  /** lane-h beside a signed-in lane-g, on a folder this case names, and valid enough for `ccrc wrappers`. */
  async function beside(prefix: string, name: (rel: string) => string): Promise<{ home: string; authDir: string; rel: string; other: string }> {
    const { home, authDir, rel } = await signedInLane(prefix);
    const roster = rosterOf(home);
    const lane = roster.accounts.find((a) => a['id'] === 'lane-g')!;
    const ports = (await freePorts(8)).slice(-2);   // past the two the add took from the same allocator
    const other = name(rel);
    roster.accounts.push({ ...lane, id: 'lane-h', label: 'lane·h', configDirSuffix: '.claude-lane-h', hue: 'blue',
      exec: { ...lane['exec'], authDir: other, proxyPort: ports[0], litellmPort: ports[1] } });
    seedRoster(home, roster);
    const wrote = ccrcAuth(home, ['wrappers'], '', host);
    expect(wrote.code, wrote.stdout + wrote.stderr).toBe(0);
    return { home, authDir, rel, other };
  }
  const keptAndNamed = (r: ReturnType<typeof ccrcAuth>, authDir: string, rel: string): void => {
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const a = answerOf(r);
    expect(existsSync(authDir), 'the sign-in folder').toBe(true);
    expect(a['kept']).toContain(authDir);
    expect(a['removed']).not.toContain(authDir);
    expect(String(a['operator-steps'])).toContain(rel);
  };

  it.each<[string, (rel: string) => string]>([
    ['a doubled slash', (rel) => rel.replace('/codex/', '/codex//')],
    ['a doubled slash further up', (rel) => rel.replace('.local/', '.local//')],
    ['a trailing dot', (rel) => `${rel}/.`],
  ])('the same folder spelled with %s', async (_name, name) => {
    const { home, authDir, rel } = await beside('ccrc-codex-remove-spelled-', name);
    keptAndNamed(ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host), authDir, rel);
  }, 90_000);

  it('a folder inside it: lane-h keeps its credential', async () => {
    const { home, authDir, rel, other } = await beside('ccrc-codex-remove-nested-', (r) => `${r}/sub`);
    const cred = plantBackendCredential(join(home, other));
    keptAndNamed(ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host), authDir, rel);
    expect(JSON.parse(readFileSync(join(home, other, 'auth.json'), 'utf8'))['refresh_token']).toBe(cred.refresh);
  }, 90_000);

  it('a folder around it: lane-h\'s folder is not emptied of what stands inside it', async () => {
    const { home, authDir, rel } = await beside('ccrc-codex-remove-around-', () => AUTH_ROOT);
    keptAndNamed(ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host), authDir, rel);
  }, 90_000);

  it('a link that lane-h names: the folder it points at is a credential in use', async () => {
    const { home, authDir, rel, other } = await beside('ccrc-codex-remove-alias-', () => `${AUTH_ROOT}/alias`);
    symlinkSync(authDir, join(home, other));
    keptAndNamed(ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host), authDir, rel);
  }, 90_000);

  it.each([
    ['fails', 'exit 1'],
    ['answers nothing', 'exit 0'],
    ['answers a word nobody knows', `printf '%s\\n' '{"ok":true,"fate":"maybe"}'; exit 0`],
  ])('a judge that %s keeps the folder: a delete cannot be taken back', async (_name, body) => {
    const { home, authDir, rel } = await signedInLane('ccrc-codex-remove-unanswered-');
    writeFileSync(join(home, '.local', 'bin', 'node'),
      `#!/bin/sh\ncase " $* " in *" auth-dir-fate "*) ${body} ;; esac\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
    const r = ccrcAuth(home, ['account', 'remove', '--id', 'lane-g'], '', host);
    keptAndNamed(r, authDir, rel);
    expect(String(answerOf(r)['operator-steps'])).toContain('could not be told');
  }, 60_000);
});

describe('`auth-dir-fate`, the judge of that folder', () => {
  const lane = (id: string, authDir: string, port: number) => ({
    id, label: `${id}·x`, configDirSuffix: `.claude-${id}`, homeAble: true, hue: 'green', telemetry: 'codex',
    exec: { kind: 'codex', provider: 'openai', proxyPort: port, litellmPort: port + 1, authDir },
  });
  const fate = (home: string, dir: string): string => {
    const r = spawnSync(process.execPath, [ACCOUNT_OP, 'auth-dir-fate', '--file', join(home, '.ccrc', 'accounts.json'), '--home', home, '--auth-dir', dir],
      { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    return String(JSON.parse(r.stdout)['fate']);
  };
  const box = (others: string[]): string => {
    const home = authBox('ccrc-codex-fate-', { roster: { ...AUTH_ROSTER, accounts: [...AUTH_ROSTER.accounts,
      ...others.map((o, i) => lane(`lane-${'hijk'[i]}`, o, 14000 + 2 * i))] } });
    homes.push(home);
    mkdirSync(join(home, AUTH_ROOT), { recursive: true });
    return home;
  };
  const mine = `${AUTH_ROOT}/lane-g-5655e6`;

  it.each<[string, string, string[], string]>([
    ['nothing else names it', mine, [], 'delete'],
    ['a sibling shares only its first letters', mine, [`${mine}0`], 'delete'],
    ['it names the same folder', mine, [mine], 'named'],
    ['a row spells it with a doubled slash', mine, [mine.replace('/codex/', '/codex//')], 'named'],
    ['a row spells it with a trailing dot', mine, [`${mine}/.`], 'named'],
    ['it is spelled so itself', `${AUTH_ROOT}//lane-g-5655e6`, [mine], 'named'],
    ['a row sits inside it', mine, [`${mine}/sub/deeper`], 'named'],
    ['a row holds it', `${mine}/sub`, [mine], 'named'],
    ['a row is the home itself', mine, [AUTH_ROOT], 'named'],
    ['it is the home itself', `${AUTH_ROOT}/.`, [], 'outside'],
    ['it is another home with the same first letters', '.local/share/ccrc/codexes/a', [], 'outside'],
    ['it is elsewhere', '.handoff/auth', [], 'outside'],
  ])('%s', (_name, dir, others, want) => {
    expect(fate(box(others), dir)).toBe(want);
  });

  it('a path that leaves the home through a link is outside, and a link at the end goes, not what it points at', () => {
    const home = box([`${AUTH_ROOT}/real`]);
    mkdirSync(join(home, '.handoff', 'sub'), { recursive: true });
    symlinkSync(join(home, '.handoff'), join(home, AUTH_ROOT, 'out'));
    expect(fate(home, `${AUTH_ROOT}/out/sub`)).toBe('outside');
    mkdirSync(join(home, AUTH_ROOT, 'real'));
    symlinkSync(join(home, AUTH_ROOT, 'real'), join(home, AUTH_ROOT, 'link'));
    expect(fate(home, `${AUTH_ROOT}/link`), 'rm removes the link alone').toBe('delete');
  });
});

const CODEX_ROSTER = (ports: number[]) => ({
  ...AUTH_ROSTER,
  accounts: [...AUTH_ROSTER.accounts, {
    id: 'lane-c', label: 'lane·c', configDirSuffix: '.claude-lane-c', homeAble: true, hue: 'green', telemetry: 'codex',
    exec: { kind: 'codex', provider: 'openai', proxyPort: ports[0], litellmPort: ports[1], authDir: `${AUTH_ROOT}/lane-c` },
  }],
});

async function codexLane(prefix: string, opts: { runtime?: boolean } = {}): Promise<{ home: string; authDir: string; old: string }> {
  const { home } = await codexBox(prefix, { ...opts, roster: CODEX_ROSTER(await freePorts(2)) });
  const authDir = join(home, AUTH_ROOT, 'lane-c');
  plantBackendCredential(authDir);
  return { home, authDir, old: readFileSync(join(authDir, 'auth.json'), 'utf8') };
}

const fetched = { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW };
const setCodex = (home: string, env: NodeJS.ProcessEnv = fetched) =>
  ccrcAuth(home, ['account', 'set', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '', { ...host, ...env });
const scratchDir = (home: string): string => join(scratchOf(home, 'lane-c'), 'codex');
/** A refused install: the old credential byte-identical, nothing beside it, and the check's catalogue kept in scratch. */
const laneUntouched = (home: string, authDir: string, old: string): void => {
  expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(old);
  expect(readdirSync(authDir)).toEqual(['auth.json']);
  expect(existsSync(join(home, '.ccrc', 'models', 'lane-c.json')), 'the check wrote the lane\'s catalogue').toBe(false);
};

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

  it('a scratch credential the backend does not answer leaves the lane byte-identical', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-refused-');
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const r = setCodex(home, { CCRC_MODELS_PROBE_FIXTURE: '/nonexistent/answer' });
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('token-unverified');
    laneUntouched(home, authDir, old);
  }, 60_000);

  it.each<[string, string]>([
    ['unreadable', '{"access_token": '],
    ['another family\'s', JSON.stringify({ OPENAI_API_KEY: 'x', tokens: null })],
  ])('a lane file that reads %s refuses before any code is asked for: the operator approves nothing they cannot keep', async (_name, body) => {
    const { home, authDir } = await codexLane('ccrc-codex-reauth-lanefile-');
    writeFileSync(join(authDir, 'auth.json'), body, { mode: 0o600 });
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-5678', interval: 1 } }],
      deviceToken: [{ status: 200, body: { authorization_code: 'code-1', code_challenge: 'challenge-1', code_verifier: 'verifier-1' } }],
    });
    try {
      expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '',
        { CCRC_CODEX_AUTH_BASE: srv.base, CCRC_AUTH_TIMEOUT: '60', ...fetched }).code).toBe(0);
      expect(await waitState(home, 'lane-c', ['done', 'failed'], 60_000), JSON.stringify(scrollbacks(home))).toBe('failed');
      await waitQuiet(home);
      const status = statusOf(home, 'lane-c');
      expect(status?.['error']).toBe('lane-credential-refused');
      expect(status?.['userCode'] ?? null, 'a code was published').toBeNull();
      expect(srv.requests, 'a request went to the provider').toHaveLength(0);
      expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(body);
      expect(readdirSync(authDir)).toEqual(['auth.json']);
      expect(existsSync(scratchOf(home, 'lane-c'))).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120_000);

  it('a lane file that went bad during the sign-in is the same code at the install, never a write failure', async () => {
    const { home, authDir } = await codexLane('ccrc-codex-reauth-lanefile-late-');
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    writeFileSync(join(authDir, 'auth.json'), '{"access_token": ', { mode: 0o600 });
    const r = setCodex(home);
    expect(r.code).toBe(1);
    expect(answerOf(r)['error']).toBe('lane-credential-refused');
    expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe('{"access_token": ');
  }, 60_000);

  // `lane-credential-refused` says the lane's own file is bad and that no code was asked for. A folder that cannot be
  // made says neither, and `ccrc doctor` would have no file to name (D-8016 (16)).
  it.skipIf(process.getuid?.() === 0)('a first sign-in whose lane folder cannot be made is a write failure: the lane has no file to blame', async () => {
    const { home } = await codexBox('ccrc-codex-reauth-nofolder-', { roster: CODEX_ROSTER(await freePorts(2)) });
    const above = join(home, AUTH_ROOT);
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    mkdirSync(above, { recursive: true });
    chmodSync(above, 0o555);
    try {
      const r = setCodex(home);
      expect(r.code).toBe(1);
      expect(answerOf(r)['error']).toBe('credential-write');
      expect(String(answerOf(r)['detail'])).not.toContain('will not write over');
      expect(r.stderr).toContain('cannot be created (EACCES)');
    } finally {
      chmodSync(above, 0o755);
    }
  }, 60_000);

  // No lane file is in question when `lstat` cannot see one, so neither the code nor its line may name one: there is no
  // file for `ccrc doctor` to name (D-8016 (16)).
  it.each(LANE_FOLDER_FAULTS)('an install where the lane folder %s is a write failure, never the lane\'s file (%s)', async (_name, word, plant) => {
    const { home } = await codexBox('ccrc-codex-reauth-folder-', { roster: CODEX_ROSTER(await freePorts(2)) });
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const undo = plant(join(home, AUTH_ROOT, 'lane-c'));
    try {
      const r = setCodex(home);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(answerOf(r)['error']).toBe('credential-write');
      expect(String(answerOf(r)['detail'])).not.toContain('will not write over');
      expect(r.stderr).toContain(`(${word})`);
    } finally {
      undo();
    }
  }, 60_000);

  it.each(LANE_FOLDER_FAULTS)('an attempt where the lane folder %s ends on a write failure before any code: nothing of a lane\'s file (%s)', async (_name, word, plant) => {
    const { home } = await codexBox('ccrc-codex-reauth-folder-start-', { roster: CODEX_ROSTER(await freePorts(2)) });
    const undo = plant(join(home, AUTH_ROOT, 'lane-c'));
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-5678', interval: 1 } }],
      deviceToken: [{ status: 200, body: { authorization_code: 'code-1', code_challenge: 'challenge-1', code_verifier: 'verifier-1' } }],
    });
    try {
      expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '',
        { CCRC_CODEX_AUTH_BASE: srv.base, CCRC_AUTH_TIMEOUT: '60', ...fetched }).code).toBe(0);
      expect(await waitState(home, 'lane-c', ['done', 'failed'], 60_000), JSON.stringify(scrollbacks(home))).toBe('failed');
      await waitQuiet(home);
      const status = statusOf(home, 'lane-c');
      expect(status?.['error']).toBe('credential-write');
      expect(status?.['userCode'] ?? null, 'a code was published').toBeNull();
      expect(srv.requests, 'a request went to the provider').toHaveLength(0);
      const pane = Object.values(scrollbacks(home)).join('\n');
      expect(pane).toContain(`(${word})`);
      expect(pane).toContain('no code was asked for');
      expect(pane, 'there is no file for it to name').not.toContain('ccrc doctor');
      expect(existsSync(scratchOf(home, 'lane-c'))).toBe(false);
    } finally {
      undo();
      await srv.close();
    }
  }, 120_000);

  it.skipIf(process.getuid?.() === 0)('a scratch root that refuses the sign-in, after the operator approved the code, blames neither the lane nor the code', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-reauth-noscratch-');
    const root = join(home, '.ccrc', 'auth-scratch');
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o500);
    const fresh = syntheticJwt({ exp: Math.floor(Date.now() / 1000) + 3600, jti: 'fresh-sign-in' });
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-5678', interval: 1 } }],
      deviceToken: [{ status: 200, body: { authorization_code: 'code-1', code_challenge: 'challenge-1', code_verifier: 'verifier-1' } }],
      token: [{ status: 200, body: { access_token: fresh, refresh_token: 'rtok-fresh', id_token: fresh } }],
    });
    try {
      expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '',
        { CCRC_CODEX_AUTH_BASE: srv.base, CCRC_AUTH_TIMEOUT: '60', ...fetched }).code).toBe(0);
      expect(await waitState(home, 'lane-c', ['done', 'failed'], 60_000), JSON.stringify(scrollbacks(home))).toBe('failed');
      await waitQuiet(home);
      const status = statusOf(home, 'lane-c');
      expect(status?.['userCode']).toBe('ABCD-5678');
      expect(status?.['error']).not.toBe('lane-credential-refused');
      expect(status?.['error']).toMatch(/exited 1 /);
      const pane = Object.values(scrollbacks(home)).join('\n');
      expect(pane).toContain('cannot be created (EACCES)');
      expect(pane, 'the lane is signed in').not.toContain('is not logged in');
      expect(pane).not.toContain('no code was asked for');
      expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).toBe(old);
      expect(readdirSync(authDir)).toEqual(['auth.json']);
    } finally {
      chmodSync(root, 0o700);
      await srv.close();
    }
  }, 120_000);

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

// NO FIXTURE SEAM BELOW. `CCRC_MODELS_PROBE_FIXTURE` replaces the fetch, and with it the arm's own reading of the
// credential, so a case on the seam cannot say which credential the check used or what it refused. `probeRuntime` is the
// real arm's interpreter: it records what it read and sent, answers from a file, and refuses every socket.
describe('the check of a sign-in, on the real fetch arm', () => {
  const realArm = (home: string, answer = CODEX_RAW): string => {
    const pr = probeRuntime(home, answer);
    plantFakeRuntime(home, { python: pr.python });
    return pr.rec;
  };
  const answerFile = (home: string, body: string): string => {
    const f = join(home, 'provider-answer');
    writeFileSync(f, body);
    return f;
  };
  const sent = (rec: string) => probeRuntimeCalls(rec).flatMap((c) => c.requests);
  const set = (home: string) => setCodex(home, {});
  const detailOf = (r: ReturnType<typeof set>): string => String(answerOf(r)['detail']);

  it('it reads the scratch credential and sends that one, never the lane\'s', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-scratch-');
    const rec = realArm(home);
    plantAttempt(home, 'lane-c', ATTEMPT);
    const cred = plantBackendCredential(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const calls = probeRuntimeCalls(rec);
    expect(calls.map((c) => c.env['CHATGPT_TOKEN_DIR'])).toEqual([scratchDir(home)]);
    // Booleans: a failing `toBe` would print the planted (synthetic) token.
    expect(calls[0]!.requests[0]!.headers['authorization'] === `Bearer ${cred.access}`, 'the bearer is the new sign-in\'s').toBe(true);
    expect(readFileSync(join(authDir, 'auth.json'), 'utf8')).not.toBe(old);
  }, 60_000);

  it.each<[string, (dir: string) => void]>([
    ['it is already expired', (d) => { plantBackendCredential(d, { expiresIn: -60 }); }],
    ['the folder holds no credential', (d) => { mkdirSync(d, { recursive: true }); }],
    ['it does not parse', (d) => { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'auth.json'), 'not json', { mode: 0o600 }); }],
    ['it is unfinished', (d) => { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'auth.json'), JSON.stringify({ device_code_requested_at: 1 }), { mode: 0o600 }); }],
  ])('a scratch credential refused before any request, beside a good lane credential, is `no-credential`: %s', async (_name, plant) => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-local-');
    const rec = realArm(home);
    plantAttempt(home, 'lane-c', ATTEMPT);
    plant(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('no-credential');
    expect(detailOf(r)).toContain('nothing was sent');
    expect(detailOf(r)).not.toContain('did not accept');
    expect(sent(rec), 'a request was made').toEqual([]);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('a scratch credential the tier barred is `no-credential`, and nothing is sent', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-barred-');
    const rec = realArm(home);
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home), { expiresIn: 30 });
    const srv = await fakeAuthServer({ token: [{ status: 400, body: { error: 'invalid_grant' } }] });
    try {
      await runAuthDriver(home, { authDir: scratchDir(home), ops: [{ op: 'ensure_fresh', lane: 'lane-c' }] }, { CCRC_CODEX_AUTH_BASE: srv.base });
    } finally {
      await srv.close();
    }
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('no-credential');
    expect(sent(rec), 'a request was made').toEqual([]);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('a request that gets no answer is `token-unverified`, the one code that blames the provider', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-silent-');
    const answer = answerFile(home, '{}');
    const rec = realArm(home, answer);
    rmSync(answer);
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('token-unverified');
    expect(sent(rec)).toHaveLength(1);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('an answer that is no model list is `codex-answer-unreadable`: the provider did answer', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-drift-');
    const rec = realArm(home, answerFile(home, '{"not":"a catalogue"}'));
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('codex-answer-unreadable');
    expect(detailOf(r)).not.toContain('did not accept');
    expect(sent(rec)).toHaveLength(1);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('no runtime is `codex-runtime-absent`: nothing ran, and its remedy is the code', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-no-runtime-', { runtime: false });
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('codex-runtime-absent');
    expect(detailOf(r)).toContain('nothing was sent');
    expect(detailOf(r)).toContain('ccrc install');
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('a check that cannot run is `codex-check-unrun`, which blames neither the sign-in nor the provider', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-no-library-');
    const rec = realArm(home);
    rmSync(join(home, '.local', 'bin', 'ccgpt-auth.py'));
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home));
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('codex-check-unrun');
    expect(detailOf(r)).not.toContain('did not accept');
    expect(sent(rec), 'a request was made').toEqual([]);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('a credential the provider took but that is not this user\'s alone is the library\'s refusal, at exit 4', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-mode-');
    const rec = realArm(home);
    plantAttempt(home, 'lane-c', ATTEMPT);
    plantBackendCredential(scratchDir(home), { mode: 0o644 });
    const r = set(home);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(answerOf(r)['error']).toBe('no-credential');
    expect(detailOf(r)).toContain('would not install');
    expect(sent(rec)).toHaveLength(1);
    laneUntouched(home, authDir, old);
  }, 60_000);

  it('an attempt approved on a box with no runtime ends on the code that names the remedy, not on the provider', async () => {
    const { home, authDir, old } = await codexLane('ccrc-codex-check-attempt-', { runtime: false });
    const fresh = syntheticJwt({ exp: Math.floor(Date.now() / 1000) + 3600, jti: 'fresh-sign-in' });
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-5678', interval: 1 } }],
      deviceToken: [{ status: 200, body: { authorization_code: 'code-1', code_challenge: 'challenge-1', code_verifier: 'verifier-1' } }],
      token: [{ status: 200, body: { access_token: fresh, refresh_token: 'rtok-fresh', id_token: fresh } }],
    });
    try {
      expect(ccrcAuth(home, ['account', 'auth-start', '--id', 'lane-c', '--method', 'openai-login', '--attempt', ATTEMPT], '',
        { CCRC_CODEX_AUTH_BASE: srv.base, CCRC_AUTH_TIMEOUT: '60' }).code).toBe(0);
      expect(await waitState(home, 'lane-c', ['done', 'failed'], 60_000), JSON.stringify(scrollbacks(home))).toBe('failed');
      await waitQuiet(home);
      expect(statusOf(home, 'lane-c')?.['error']).toBe('codex-runtime-absent');
      laneUntouched(home, authDir, old);
    } finally {
      await srv.close();
    }
  }, 120_000);
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

