// OpenRouter by paste on the box (accounts plan Task A26; spec §8.3–§8.6; D-5520, D-5521, D-5556, D-8023; G7, G8, G28).
// `add` reads the catalogue, then checks the key against `GET /api/v1/key`, and only then writes. `credential` keeps the
// old file until the new key passes, and `check` reads the credit again. Every OpenRouter call here reaches a stub
// `curl`, first on PATH, that records its argv and stdin and answers as a scripted OpenRouter: nothing leaves the
// fixture, and no key is real-shaped in this file (each is assembled at run time).
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ACCOUNT_OP, HAVE_FLOCK, answer, boxEnv, ccrcRun, laneBox, laneState, secretTemps, type Result,
} from './laneStateFixture.js';
import { KEY_HINT_RE, LANE_KEY_SOURCES, laneStateOf, stateWordFor } from '../../shared/accounts.js';
import { MODEL_ID_RE, type Catalogue } from '../../shared/models.js';
import { suggestedClasses, suggestedModelMap } from '../../shared/model-suggest.mjs';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const orKey = (tail: string): string => ['sk', 'or', 'v1', `not-a-real-key-${tail}`].join('-');
const KEY = orKey('a26a');
const KEY_NEW = orKey('b26b');
const LANE = 'lane-d';
const KEY_FILE = `${LANE}-openrouter.env`;

/** OpenRouter's list, in its measured shape: newest first, `:batch` variants beside each id, and other vendors. */
const CATALOGUE = {
  data: [
    'openai/gpt-9', 'anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5:batch', 'anthropic/claude-sonnet-5.5',
    'anthropic/claude-sonnet-5.5:batch', 'anthropic/claude-opus-5.5', 'anthropic/claude-opus-5.5:batch',
    'anthropic/claude-fable-5.1', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'anthropic/claude-opus-4.8',
    'anthropic/claude-haiku-4.5',
  ].map((id) => ({ id, name: id, context_length: 200_000, top_provider: {}, pricing: {} })),
};
const SUGGESTED = {
  opus: 'anthropic/claude-opus-5.5', sonnet: 'anthropic/claude-sonnet-5.5', haiku: 'anthropic/claude-haiku-5.5',
  subagent: 'anthropic/claude-sonnet-5.5',
};
const KEY_BODY = {
  label: 'ccrc lane-d', limit: 20, limit_remaining: 18.4, limit_reset: 'monthly', usage: 1.6, is_free_tier: false,
  is_management_key: false, is_provisioning_key: false,
};

/** The scripted OpenRouter. `$HOME/or-key` is the key route's `<status>\n<body>`; a missing file is a dead network. It
 *  echoes what it heard on stderr, so a verb that kept curl's stderr would show the key. */
function plantCurl(home: string): NodeJS.ProcessEnv {
  const bin = join(home, 'or-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/bash',
    'printf \'%s\\n\' "$*" >> "$HOME/curl-argv"',
    'url=""; for a in "$@"; do case "$a" in https://*) url="$a" ;; esac; done',
    'case "$url" in',
    '  */api/v1/key)',
    '    heard="$(cat; echo x)"; heard="${heard%x}"; printf \'%s\' "$heard" >> "$HOME/curl-stdin"',
    '    printf \'the header on my stdin is %s\' "$heard" >&2',
    '    [ -f "$HOME/or-key" ] || exit 7',
    '    { read -r status; body="$(cat)"; } < "$HOME/or-key"',
    '    printf \'%s\\n%s\' "$body" "$status" ;;',
    '  */api/v1/models)',
    '    [ -f "$HOME/or-catalogue" ] || exit 22',
    '    cat "$HOME/or-catalogue" ;;',
    '  *) exit 99 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  writeFileSync(join(bin, 'tmutil'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });   // a Mac's backup exclusion, in a fixture
  writeFileSync(join(home, 'or-catalogue'), JSON.stringify(CATALOGUE));
  scriptKey(home, 200, { data: KEY_BODY });
  return { PATH: `${bin}:${boxEnv(home)['PATH'] ?? ''}` };
}
const scriptKey = (home: string, status: number, body: unknown): void => {
  writeFileSync(join(home, 'or-key'), `${status}\n${JSON.stringify(body)}`);
};

const addArgs = (...extra: string[]): string[] => ['account', 'add', '--id', LANE, '--provider', 'openrouter', '--method', 'paste',
  '--label', 'lane·d', '--hue', 'amber', '--credential', '-', ...extra];
const roster = (home: string): { id: string; homeAble: boolean; telemetry: string; exec: Record<string, unknown> }[] =>
  (JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: never[] }).accounts;
const row = (home: string, id: string) => roster(home).find((a) => a.id === id);
const curlArgv = (home: string): string[] => (existsSync(join(home, 'curl-argv'))
  ? readFileSync(join(home, 'curl-argv'), 'utf8').trim().split('\n') : []);

/** Everything a refused add must not have left. */
function expectNothingWritten(home: string): void {
  expect(existsSync(join(home, '.cc-secrets', KEY_FILE)), 'the key file').toBe(false);
  expect(secretTemps(home, LANE), 'a secret temp').toEqual([]);
  expect(row(home, LANE), 'the roster entry').toBeUndefined();
  expect(existsSync(join(home, `.claude-${LANE}`)), 'the config dir').toBe(false);
  expect(existsSync(join(home, '.cc-sessions', `${LANE}-disabled`)), 'the off marker').toBe(false);
  expect(laneState(home, LANE), 'the lane state').toBeNull();
  const scratch = join(home, '.ccrc', 'auth-scratch');
  expect(existsSync(scratch) ? readdirSync(scratch) : [], 'the catalogue scratch').toEqual([]);
  const models = join(home, '.ccrc', 'models');
  expect(existsSync(models) ? readdirSync(models) : [], 'the lane\'s model files').toEqual([]);
}
const refuses = (r: Result, code: number, word: string): void => {
  expect(r.code, r.stderr).toBe(code);
  expect(answer(r)['error']).toBe(word);
};

describe('the key is checked first (spec §8.3, D-5520)', () => {
  it('the key is on stdin as one header line and on no argv', () => {
    const home = laneBox('ccrc-or-stdin-');
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, plantCurl(home));
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'curl-stdin'), 'utf8')).toBe(`Authorization: Bearer ${KEY}\n`);
    expect(readFileSync(join(home, 'curl-argv'), 'utf8')).not.toContain(KEY);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('the hostile key `"\\noutput = <tmp>/pwned` refuses `key-charset` and no file appears, and curl reads a header, never a config', () => {
    const home = laneBox('ccrc-or-hostile-');
    const env = plantCurl(home);
    const pwned = join(home, 'pwned');
    const r = ccrcRun(home, addArgs(), `"\noutput = ${pwned}`, env);
    refuses(r, 2, 'key-charset');
    expect(existsSync(pwned)).toBe(false);
    expectNothingWritten(home);
    expect(existsSync(join(home, 'curl-stdin')), 'the key route was never called').toBe(false);
    // A one-line key with a config directive in it reaches curl, where it is only ever a header's value.
    expect(ccrcRun(home, addArgs(), `x" output = ${pwned}\n`, env).code).toBe(0);
    const keyCall = curlArgv(home).find((l) => l.endsWith('/api/v1/key'))!;
    expect(keyCall).toContain('-H @-');
    expect(keyCall).not.toMatch(/(^| )(-K|--config)( |$)/);
  });

  it.each([
    ['is_management_key', { ...KEY_BODY, is_management_key: true }],
    ['is_provisioning_key', { ...KEY_BODY, is_provisioning_key: true }],
  ])('a management key (%s) refuses `wrong-key-kind` and writes nothing', (_flag, body) => {
    const home = laneBox('ccrc-or-kind-');
    const env = plantCurl(home);
    scriptKey(home, 200, { data: body });
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, env);
    refuses(r, 1, 'wrong-key-kind');
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expectNothingWritten(home);
  });

  it('a 401 writes nothing', () => {
    const home = laneBox('ccrc-or-401-');
    const env = plantCurl(home);
    scriptKey(home, 401, { error: { code: 401, message: 'No auth credentials found' } });
    refuses(ccrcRun(home, addArgs(), `${KEY}\n`, env), 1, 'key-rejected');
    expectNothingWritten(home);
  });

  it.each([
    ['a 500', 500, { error: { code: 500 } }],
    ['a 200 with no `data`', 200, { label: 'x' }],
    ['a 200 whose flag is no boolean', 200, { data: { ...KEY_BODY, is_management_key: 'yes' } }],
    ['a 200 of an empty `data`', 200, { data: {} }],
    ['a 200 of facts and no flag', 200, { data: { label: 'x', limit: null, limit_remaining: null } }],
    ['a 200 whose two flags are null', 200, { data: { ...KEY_BODY, is_management_key: null, is_provisioning_key: null } }],
    ['a 200 with no `is_management_key`', 200, { data: { label: 'x', is_provisioning_key: false } }],
    ['a 200 whose `is_management_key` is null', 200, { data: { ...KEY_BODY, is_management_key: null } }],
    ['a 200 whose `is_provisioning_key` is null', 200, { data: { ...KEY_BODY, is_provisioning_key: null } }],
    ['a 200 whose `is_provisioning_key` is no boolean', 200, { data: { ...KEY_BODY, is_provisioning_key: 'no' } }],
  ])('%s refuses `key-unverified`, with no save anyway', (_name, status, body) => {
    const home = laneBox('ccrc-or-unverified-');
    const env = plantCurl(home);
    scriptKey(home, status, body);
    refuses(ccrcRun(home, addArgs(), `${KEY}\n`, env), 1, 'key-unverified');
    expectNothingWritten(home);
  });

  it('a 200 that drops only the deprecated `is_provisioning_key` still proves the key', () => {
    const home = laneBox('ccrc-or-deprecated-');
    const env = plantCurl(home);
    const { is_provisioning_key: _dropped, ...body } = KEY_BODY;
    scriptKey(home, 200, { data: body });
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, env);
    expect(r.code, r.stderr).toBe(0);
    expect(laneState(home, LANE)).toMatchObject({ keySource: 'pasted', keyHint: 'sk-or-v1-…a26a' });
  });

  it('a network that does not answer refuses `key-unverified`', () => {
    const home = laneBox('ccrc-or-down-');
    const env = plantCurl(home);
    spawnSync('rm', [join(home, 'or-key')]);
    refuses(ccrcRun(home, addArgs(), `${KEY}\n`, env), 1, 'key-unverified');
    expectNothingWritten(home);
  });

  it('every OpenRouter call uses `--proto =https --max-redirs 0`', () => {
    const home = laneBox('ccrc-or-flags-');
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, plantCurl(home));
    expect(r.code, r.stderr).toBe(0);
    const calls = curlArgv(home);
    expect(calls.map((c) => c.split(' ').at(-1))).toEqual(['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/key']);
    for (const c of calls) {
      expect(c).toContain('--proto =https');
      expect(c).toContain('--max-redirs 0');
    }
    expect(calls[1]).toContain('--max-time 10');
  });
});

describe('a good key makes a lane (spec §3.4, §8.4, §8.6)', () => {
  it('the lane state carries the hint and the credit fields, and the key file holds the key', () => {
    const home = laneBox('ccrc-or-state-');
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, plantCurl(home));
    expect(r.code, r.stderr).toBe(0);
    const file = join(home, '.cc-secrets', KEY_FILE);
    expect(readFileSync(file, 'utf8')).toBe(`export ANTHROPIC_AUTH_TOKEN=${KEY}\n`);
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
    const st = laneState(home, LANE)!;
    expect(st).toMatchObject({
      keyHint: 'sk-or-v1-…a26a', keySource: 'pasted', keyLabel: 'ccrc lane-d', keyLimit: 20, limitReset: 'monthly',
      credit: { limit: 20, limit_remaining: 18.4, usage: 1.6, is_free_tier: false }, credential: 'held',
    });
    expect(typeof st['validatedAt']).toBe('string');
    expect(JSON.stringify(st)).not.toContain(KEY);
    // The server's reader takes every field of these it carries.
    expect(laneStateOf(st)).toMatchObject({ keyHint: 'sk-or-v1-…a26a', keySource: 'pasted', credit: { limit: 20, remaining: 18.4 } });
    expect(laneStateOf(st)!.validatedAt).toBeGreaterThan(0);
  });

  it('a key with no limit keeps null, which the reader reads as no limit', () => {
    const home = laneBox('ccrc-or-nolimit-');
    const env = plantCurl(home);
    scriptKey(home, 200, { data: { ...KEY_BODY, limit: null, limit_remaining: null, limit_reset: null } });
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    expect(laneStateOf(laneState(home, LANE))!.credit).toEqual({ limit: null, remaining: null });
  });

  // What `add` writes is what the Accounts card speaks: the screen already draws the hint, the age and the credit words.
  it.each([
    ['credit low', 20, 1.5, 'expiring', 'credit low · $1.50 of $20 left'],
    ['credit used up', 20, 0, 'rate-limited', 'credit used up · $0.00 of $20 left'],
  ])('%s, as `add` writes it, is the state word the card shows', (_name, limit, remaining, word, source) => {
    const home = laneBox('ccrc-or-words-');
    const env = plantCurl(home);
    scriptKey(home, 200, { data: { ...KEY_BODY, limit, limit_remaining: remaining } });
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    const state = laneStateOf(laneState(home, LANE))!;
    expect(stateWordFor({
      disabled: false, authDead: false, five: null, seven: null, fiveResetAt: null, sevenResetAt: null,
      provider: 'openrouter', kind: 'key', lane: { kind: 'read', state }, now: Date.now(),
    })).toEqual({ word, source });
  });

  it('a fact off its grammar is left out, and the key stands', () => {
    const home = laneBox('ccrc-or-grammar-');
    const env = plantCurl(home);
    scriptKey(home, 200, { data: { ...KEY_BODY, label: 'bad\u0007label', limit: 'lots', limit_reset: 'Not A Word' } });
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    const st = laneState(home, LANE)!;
    for (const k of ['keyLabel', 'keyLimit', 'limitReset', 'credit']) expect(st, k).not.toHaveProperty(k);
    expect(st).toMatchObject({ keyHint: 'sk-or-v1-…a26a', keySource: 'pasted' });
  });

  it('openrouter and compatible rows carry their own telemetry', () => {
    const home = laneBox('ccrc-or-telemetry-');
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, plantCurl(home)).code).toBe(0);
    expect(row(home, LANE)!.telemetry).toBe('openrouter');
    const c = ccrcRun(home, ['account', 'add', '--id', 'lane-e', '--provider', 'compatible', '--label', 'lane·e', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1', '--credential', '-'], `${KEY}\n`);
    expect(c.code, c.stderr).toBe(0);
    expect(row(home, 'lane-e')!.telemetry).toBe('none');
    expect(row(home, 'lane-e')!.homeAble).toBe(true);
  });

  it('`--placement` defaults to overflow; `full` makes the lane home-able; another provider refuses it', () => {
    const home = laneBox('ccrc-or-placement-');
    const env = plantCurl(home);
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    expect(row(home, LANE)!.homeAble).toBe(false);
    const full = ccrcRun(home, ['account', 'add', '--id', 'lane-e', '--provider', 'openrouter', '--method', 'paste', '--label', 'lane·e',
      '--hue', 'amber', '--credential', '-', '--placement=full'], `${KEY}\n`, env);
    expect(full.code, full.stderr).toBe(0);
    expect(row(home, 'lane-e')!.homeAble).toBe(true);
    refuses(ccrcRun(home, ['account', 'add', '--id', 'lane-f', '--provider', 'openrouter', '--method', 'paste', '--label', 'lane·f',
      '--hue', 'amber', '--credential', '-', '--placement', 'sideways'], `${KEY}\n`, env), 2, 'placement-not-supported');
    refuses(ccrcRun(home, ['account', 'add', '--id', 'lane-f', '--provider', 'compatible', '--label', 'lane·f', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1', '--credential', '-', '--placement', 'full'], `${KEY}\n`, env), 2, 'placement-not-supported');
  });

  it('the writer\'s key source and hint grammar are the reader\'s', () => {
    const op = readFileSync(ACCOUNT_OP, 'utf8');
    expect(op).toContain(`const LANE_KEY_SOURCES = [${LANE_KEY_SOURCES.map((s) => `'${s}'`).join(', ')}];`);
    expect(op).toContain(`const KEY_HINT_RE = ${String(KEY_HINT_RE)};`);
  });
});

describe('the suggested models (spec §8.5, D-5556)', () => {
  it('without `--models`, the roster, the settings and the class registry all carry the suggestion', () => {
    const home = laneBox('ccrc-or-models-');
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, plantCurl(home));
    expect(r.code, r.stderr).toBe(0);
    expect(row(home, LANE)!.exec['models']).toEqual(SUGGESTED);
    const env = (JSON.parse(readFileSync(join(home, `.claude-${LANE}`, 'settings.json'), 'utf8')) as { env: Record<string, string> }).env;
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1', ANTHROPIC_DEFAULT_OPUS_MODEL: SUGGESTED.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: SUGGESTED.sonnet, ANTHROPIC_DEFAULT_HAIKU_MODEL: SUGGESTED.haiku,
      // The registry's materialise has the last word, and it names the class, as on every registry lane.
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', ANTHROPIC_DEFAULT_FABLE_MODEL: 'anthropic/claude-fable-5.1',
    });
    const reg = JSON.parse(readFileSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8')) as Record<string, unknown>;
    expect(reg).toMatchObject({
      probe: 'openrouter', subagent: 'sonnet',
      classes: { opus: SUGGESTED.opus, sonnet: SUGGESTED.sonnet, haiku: SUGGESTED.haiku, fable: 'anthropic/claude-fable-5.1' },
    });
    expect(existsSync(join(home, '.ccrc', 'models', `${LANE}.json`)), 'the catalogue the suggestion read').toBe(true);
    expect(readdirSync(join(home, '.ccrc', 'auth-scratch')), 'the scratch').toEqual([]);
    // The registry and the settings agree: `show` reports no drift.
    const show = ccrcRun(home, ['models', LANE, 'show', '--json']);
    expect(show.code, show.stderr).toBe(0);
    expect(answer(show)['settingsDrift']).toEqual([]);
  });

  it.each([
    ['unreadable', (home: string) => { spawnSync('rm', [join(home, 'or-catalogue')]); }],
    ['not a catalogue', (home: string) => { writeFileSync(join(home, 'or-catalogue'), '{"nope":1}'); }],
    ['missing a class', (home: string) => {
      writeFileSync(join(home, 'or-catalogue'), JSON.stringify({ data: CATALOGUE.data.filter((m) => !m.id.includes('haiku')) }));
    }],
  ])('an %s catalogue writes nothing, and the key is not read', (_name, breakIt) => {
    const home = laneBox('ccrc-or-catalogue-');
    const env = plantCurl(home);
    breakIt(home);
    refuses(ccrcRun(home, addArgs(), `${KEY}\n`, env), 1, 'catalogue-unreachable');
    expectNothingWritten(home);
    expect(existsSync(join(home, 'curl-stdin')), 'the key route was never called').toBe(false);
  });

  it('a refused key leaves no catalogue behind', () => {
    const home = laneBox('ccrc-or-refused-catalogue-');
    const env = plantCurl(home);
    scriptKey(home, 401, {});
    refuses(ccrcRun(home, addArgs(), `${KEY}\n`, env), 1, 'key-rejected');
    expectNothingWritten(home);
  });

  it('a typed `--models` asks no catalogue and makes no registry', () => {
    const home = laneBox('ccrc-or-typed-');
    const env = plantCurl(home);
    const models = JSON.stringify({ opus: 'a/b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/c' });
    const r = ccrcRun(home, addArgs('--models', models), `${KEY}\n`, env);
    expect(r.code, r.stderr).toBe(0);
    expect(curlArgv(home).map((c) => c.split(' ').at(-1))).toEqual(['https://openrouter.ai/api/v1/key']);
    expect(row(home, LANE)!.exec['models']).toEqual(JSON.parse(models));
    expect(existsSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`))).toBe(false);
  });

  it.each([
    ['a registry file it cannot read', (home: string) => {
      mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`), '{ not json');
    }],
    // `_models_lock` refuses by `exit`, which must end the registry step and not the verb.
    ['a models lock it cannot open', (home: string) => { mkdirSync(join(home, '.ccrc', 'locks', `models-${LANE}.lock`), { recursive: true }); }],
  ])('%s: a registry that cannot be made refuses with one answer, and says what stands', (_name, breakIt) => {
    const home = laneBox('ccrc-or-registry-');
    const env = plantCurl(home);
    breakIt(home);
    const r = ccrcRun(home, addArgs(), `${KEY}\n`, env);
    refuses(r, 1, 'models-registry');
    expect(answer(r)['detail']).toContain(`ccrc models ${LANE} init openrouter --suggested`);
    expect(row(home, LANE)!.exec['models']).toEqual(SUGGESTED);
    expect(laneState(home, LANE)).toMatchObject({ keyHint: 'sk-or-v1-…a26a' });
  });

  it('`init --suggested` reads the catalogue itself, so a lane left with no registry has one command to make it', () => {
    const home = laneBox('ccrc-or-init-fetch-');
    const env = plantCurl(home);
    const models = JSON.stringify({ opus: 'a/b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/c' });
    expect(ccrcRun(home, addArgs('--models', models), `${KEY}\n`, env).code).toBe(0);
    const r = ccrcRun(home, ['models', LANE, 'init', 'openrouter', '--suggested'], '', env);
    expect(r.code, r.stderr).toBe(0);
    const reg = JSON.parse(readFileSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8')) as { classes: Record<string, unknown> };
    expect(reg.classes['opus']).toBe(SUGGESTED.opus);
  });

  it('a bare `init openrouter` stays unseeded, and `--suggested` needs a catalogue that suggests', () => {
    const home = laneBox('ccrc-or-init-');
    const env = plantCurl(home);
    const models = JSON.stringify({ opus: 'a/b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/c' });
    expect(ccrcRun(home, addArgs('--models', models), `${KEY}\n`, env).code).toBe(0);
    spawnSync('rm', [join(home, 'or-catalogue')]);
    refuses(ccrcRun(home, ['models', LANE, 'init', 'openrouter', '--suggested'], '', env), 1, 'no-suggestion');
    expect(existsSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`))).toBe(false);
    const bare = ccrcRun(home, ['models', LANE, 'init', 'openrouter']);
    expect(bare.code, bare.stderr).toBe(0);
    const reg = JSON.parse(readFileSync(join(home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8')) as { classes: Record<string, unknown> };
    expect(reg.classes).toEqual({ haiku: null, sonnet: null, opus: null, fable: null });
  });
});

describe('`suggestedClasses` (D-8023)', () => {
  const cat = (...ids: (string | [string, boolean])[]): Catalogue => ({
    probe: 'openrouter', fetchedAt: 1, stale: false,
    models: ids.map((x) => {
      const [id, hidden] = Array.isArray(x) ? x : [x, false];
      return { id, label: id, context: null, maxContext: null, efforts: [], hidden, priceIn: null, priceOut: null };
    }),
  });
  const base = ['anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5'];

  it('takes the newest of each class by version, whatever the order', () => {
    expect(suggestedClasses(cat(...base, 'anthropic/claude-opus-4.10', 'anthropic/claude-opus-4.9'))).toEqual({
      opus: 'anthropic/claude-opus-4.10', sonnet: 'anthropic/claude-sonnet-4.6', haiku: 'anthropic/claude-haiku-4.5', fable: null,
    });
  });
  it('never suggests a variant, a hidden row, another vendor or an id off the grammar', () => {
    const c = suggestedClasses(cat(...base, 'anthropic/claude-opus-9:batch', ['anthropic/claude-opus-9', true], 'other/claude-opus-9',
      'anthropic/claude-opus-9-preview', 'anthropic/claude-3.5-opus'));
    expect(c!.opus).toBe('anthropic/claude-opus-4.8');
  });
  it('keeps the catalogue\'s order on equal versions', () => {
    expect(suggestedClasses(cat(...base, 'anthropic/claude-opus-4.8.0'))!.opus).toBe('anthropic/claude-opus-4.8');
  });
  it('fills fable when the catalogue lists one, and is null without opus, sonnet or haiku', () => {
    expect(suggestedClasses(cat(...base, 'anthropic/claude-fable-5'))!.fable).toBe('anthropic/claude-fable-5');
    for (const gone of base) expect(suggestedClasses(cat(...base.filter((m) => m !== gone), 'anthropic/claude-fable-5'))).toBeNull();
  });
  it('the map is the roster\'s four aliases, every id a model id, subagents on sonnet', () => {
    const m = suggestedModelMap(suggestedClasses(cat(...base))!);
    expect(m).toEqual({ opus: base[0], sonnet: base[1], haiku: base[2], subagent: base[1] });
    for (const id of Object.values(m)) expect(MODEL_ID_RE.test(id)).toBe(true);
  });
});

describe('Replace key validates first (`credential`, spec §9)', () => {
  const box = (prefix: string): { home: string; env: NodeJS.ProcessEnv; before: string } => {
    const home = laneBox(prefix);
    const env = plantCurl(home);
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    return { home, env, before: readFileSync(join(home, '.cc-secrets', KEY_FILE), 'utf8') };
  };
  const replace = (home: string, env: NodeJS.ProcessEnv): Result => ccrcRun(home, ['account', 'credential', '--id', LANE, '--credential', '-'], `${KEY_NEW}\n`, env);

  it.each([
    ['key-rejected', 401, {}],
    ['key-unverified', 500, {}],
    ['wrong-key-kind', 200, { data: { ...KEY_BODY, is_provisioning_key: true } }],
    ['key-unverified', 200, { data: { label: 'x', limit: null, limit_remaining: null } }],
  ])('%s keeps the old file and the old facts', (word, status, body) => {
    const { home, env, before } = box('ccrc-or-replace-no-');
    const state = laneState(home, LANE);
    scriptKey(home, status, body);
    const r = replace(home, env);
    refuses(r, 1, word);
    expect(answer(r)['detail']).toContain('the old credential file stands');
    expect(readFileSync(join(home, '.cc-secrets', KEY_FILE), 'utf8')).toBe(before);
    expect(laneState(home, LANE)).toEqual(state);
  });

  it('a good key replaces the file, and the hint and the credit with it', () => {
    const { home, env } = box('ccrc-or-replace-ok-');
    scriptKey(home, 200, { data: { ...KEY_BODY, limit_remaining: 5, label: 'ccrc lane-d 2' } });
    const r = replace(home, env);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.cc-secrets', KEY_FILE), 'utf8')).toBe(`export ANTHROPIC_AUTH_TOKEN=${KEY_NEW}\n`);
    expect(laneState(home, LANE)).toMatchObject({
      keyHint: 'sk-or-v1-…b26b', keySource: 'pasted', keyLabel: 'ccrc lane-d 2', credit: { limit: 20, limit_remaining: 5 },
    });
    expect(readFileSync(join(home, 'curl-stdin'), 'utf8')).toContain(`Authorization: Bearer ${KEY_NEW}\n`);
  });

  it('a new key whose answer leaves a fact out keeps none of the old key\'s facts: its credit is not the old key\'s', () => {
    const { home, env } = box('ccrc-or-replace-facts-');
    scriptKey(home, 200, { data: { ...KEY_BODY, limit_remaining: 0 } });
    expect(ccrcRun(home, ['account', 'check', '--id', LANE], '', env).code).toBeLessThanOrEqual(1);
    expect(laneState(home, LANE)).toMatchObject({ credit: { limit: 20, limit_remaining: 0 }, keyLabel: 'ccrc lane-d' });
    scriptKey(home, 200, { data: { is_management_key: false, is_provisioning_key: false } });
    const r = replace(home, env);
    expect(r.code, r.stderr).toBe(0);
    const state = laneState(home, LANE);
    expect(state).toMatchObject({ keyHint: 'sk-or-v1-…b26b', keySource: 'pasted' });
    for (const old of ['credit', 'keyLabel', 'keyLimit', 'limitReset']) expect(state, old).not.toHaveProperty(old);
  });

  it('a compatible lane is not asked of OpenRouter', () => {
    const home = laneBox('ccrc-or-compatible-');
    const env = plantCurl(home);
    const add = ccrcRun(home, ['account', 'add', '--id', 'lane-e', '--provider', 'compatible', '--label', 'lane·e', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1', '--credential', '-'], `${KEY}\n`, env);
    expect(add.code, add.stderr).toBe(0);
    const r = ccrcRun(home, ['account', 'credential', '--id', 'lane-e', '--credential', '-'], `${KEY_NEW}\n`, env);
    expect(r.code, r.stderr).toBe(0);
    expect(curlArgv(home)).toEqual([]);
  });
});

describe('`check` reads the credit again (D-5521, G8)', () => {
  /** A launcher the probe runs that answers one good turn. The lane's wrapper execs it. */
  const box = (prefix: string): { home: string; env: NodeJS.ProcessEnv } => {
    const home = laneBox(prefix);
    const env = plantCurl(home);
    expect(ccrcRun(home, addArgs(), `${KEY}\n`, env).code).toBe(0);
    writeFileSync(join(home, '.local', 'bin', 'claude'),
      '#!/bin/sh\necho \'{"type":"result","subtype":"success","is_error":false,"result":"ok"}\'\n', { mode: 0o755 });
    return { home, env };
  };
  const check = (home: string, env: NodeJS.ProcessEnv): Result => ccrcRun(home, ['account', 'check', '--id', LANE], '', env);

  it('a good read moves the credit and the time, sends the key on stdin, and keeps the hint', () => {
    const { home, env } = box('ccrc-or-check-');
    const before = laneState(home, LANE)!;
    writeFileSync(join(home, 'curl-stdin'), '');
    scriptKey(home, 200, { data: { ...KEY_BODY, limit_remaining: 2, usage: 18 } });
    const r = check(home, env);
    expect(r.code, r.stderr).toBe(0);
    const st = laneState(home, LANE)!;
    expect(st).toMatchObject({ keyHint: before['keyHint'], credit: { limit: 20, limit_remaining: 2, usage: 18 } });
    expect(st['validatedAt']).not.toBe(before['validatedAt']);
    expect(readFileSync(join(home, 'curl-stdin'), 'utf8')).toBe(`Authorization: Bearer ${KEY}\n`);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('an external launcher\'s secrets file is not read: only a lane ccrc wrote is asked about', () => {
    const { home, env } = box('ccrc-or-check-external-');
    const accounts = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: Record<string, unknown>[] };
    accounts.accounts.push({ id: 'lane-x', label: 'lane·x', configDirSuffix: '.lane-x', homeAble: false, hue: 'green', telemetry: 'none',
      exec: { kind: 'external', provider: 'openrouter', secretsFile: '.cc-secrets/lane-x-openrouter.env' } });
    writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify(accounts));
    writeFileSync(join(home, '.cc-secrets', 'lane-x-openrouter.env'), 'touch "$HOME/sourced"\n', { mode: 0o600 });
    writeFileSync(join(home, '.local', 'bin', 'lane-x'),
      '#!/bin/sh\necho \'{"type":"result","subtype":"success","is_error":false,"result":"ok"}\'\n', { mode: 0o755 });
    const r = ccrcRun(home, ['account', 'check', '--id', 'lane-x'], '', env);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'sourced')), 'the launcher\'s file was sourced').toBe(false);
  });

  it.each([
    ['a dead network', (home: string): void => { spawnSync('rm', [join(home, 'or-key')]); }],
    ['a 200 that proves no kind', (home: string): void => { scriptKey(home, 200, { data: { label: 'x', limit: 5, limit_remaining: 0 } }); }],
  ])('a failed read keeps the last reading: %s', (_name, breakIt) => {
    const { home, env } = box('ccrc-or-check-down-');
    const before = laneState(home, LANE)!;
    breakIt(home);
    expect(check(home, env).code).toBe(0);
    const st = laneState(home, LANE)!;
    expect(st['credit']).toEqual(before['credit']);
    expect(st['validatedAt']).toBe(before['validatedAt']);
  });

  it('a management key found on a lane is said beside the verdict', () => {
    const { home, env } = box('ccrc-or-check-kind-');
    scriptKey(home, 200, { data: { ...KEY_BODY, is_management_key: true } });
    const r = check(home, env);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.stringify(answer(r))).toContain('management key');
  });
});
