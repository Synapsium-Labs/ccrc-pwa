// `ccd/ccrc-models-probe` — the catalogue fetcher (§5), its atomic write and
// its stale-on-failure rule (§11).
//
// IT IS KEYED BY PROBE KIND, not by a roster provider (round-2 ruling 10): the
// three arms are `codex`, `openrouter` and `compatible`, which is exactly the
// `probe` field of `~/.ccrc/models/<id>.classes.json`.
//
// ── HOW THE FIXTURE CONTAINS IT ──────────────────────────────────────────
//  1. HOME is a throwaway `mkTmp` directory. The probe writes
//     `$HOME/.ccrc/models/<id>.json` and nothing else; the live `~/.ccrc` on
//     the box this suite runs on holds the operator's real catalogues.
//  2. `ghContainedEnv` plants the poisoned `gh`, and this file plants a
//     poisoned `curl` beside it. Every case asserts the curl log is EMPTY:
//     the probe must reach the network through NOTHING in these tests.
//  3. `CCRC_MODELS_PROBE_FIXTURE` is the one seam that makes (2) possible —
//     it replaces the FETCH with a `cat` of the named file and touches no
//     other line of the probe. A missing file through that seam is exactly a
//     failed fetch, which is how the stale path below is driven.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { parseCatalogue } from '../../shared/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const PROBE = path.join(REPO, 'ccd', 'ccrc-models-probe');
const CODEX_RAW = path.join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

let home: string;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home, ...extra });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-poison"\n'
    + 'echo "the probe must never reach the network under test" >&2\nexit 97\n', { mode: 0o755 });
  return e;
}

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [PROBE, ...args], { env: env(extra), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const curlCalls = (): string[] => {
  const p = path.join(home, 'curl-poison');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const catalogueAt = (id: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', `${id}.json`), 'utf8'));

beforeEach(() => { home = mkTmp('ccrc-models-probe-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('usage', () => {
  it('with no arguments exits 2 and prints the usage line', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage: ccrc-models-probe <accountId> <probe>/);
  });

  it('refuses an unknown probe kind at exit 2, naming the three', () => {
    const r = run(['gpt', 'gemini']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/codex, openrouter, compatible/);
  });

  it('refuses `openai` by name — that is the account-connections PROVIDER spelling', () => {
    // Round-2 ruling 10: probes are keyed by `registry.probe`. `openai` is a
    // ProviderId on a branch that is not on main, and accepting it here would
    // let a stale caller write a catalogue this build cannot parse.
    const r = run(['gpt', 'openai']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the Codex probe kind is spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence — those classes are the client\'s defaults (§5)', () => {
    const r = run(['claude', 'anthropic']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/anthropic lanes have no catalogue/);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models'))).toBe(false);
  });

  it('refuses an account id that is not an id', () => {
    const r = run(['../escape', 'codex']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/account id/);
  });
});

describe('the Codex arm (§5)', () => {
  it('writes the nine models, hidden flagged, efforts carried', () => {
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(curlCalls()).toEqual([]);
    const cat = parseCatalogue(catalogueAt('gpt'));
    expect(cat.probe).toBe('codex');
    expect(cat.stale).toBe(false);
    expect(cat.models.map((m) => m.id)).toEqual([
      'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
      'gpt-reserve', 'codex-auto-review',
    ]);
    expect(cat.models.filter((m) => m.hidden).map((m) => m.id))
      .toEqual(['gpt-reserve', 'codex-auto-review']);
    const astra = cat.models[0]!;
    expect(astra.label).toBe('GPT-6-Astra');
    expect(astra.context).toBe(272000);
    expect(astra.maxContext).toBe(872000);
    expect(astra.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    // Luna has no `ultra` and Astra does — the asymmetry §4.1 validates
    // `effort` against, so it has to survive the probe.
    expect(cat.models.find((m) => m.id === 'gpt-5.6-luna')!.efforts).not.toContain('ultra');
    // A Codex row carries no prices.
    expect(astra.priceIn).toBeNull();
    expect(astra.priceOut).toBeNull();
  });

  it('stamps fetchedAt with a plausible epoch second, not a millisecond', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const cat = parseCatalogue(catalogueAt('gpt'));
    const now = Math.floor(Date.now() / 1000);
    expect(cat.fetchedAt).toBeGreaterThan(now - 120);
    expect(cat.fetchedAt).toBeLessThanOrEqual(now + 1);
  });

  it('writes atomically — no temp file survives, and the mode is 0600', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readdirSync(path.join(home, '.ccrc', 'models'))).toEqual(['gpt.json']);
    const mode = fs.statSync(path.join(home, '.ccrc', 'models', 'gpt.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('--out redirects the write and leaves the default path alone', () => {
    const out = path.join(home, 'elsewhere.json');
    const r = run(['gpt', 'codex', '--out', out], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('never touches the lane\'s REGISTRY file', () => {
    // The probe writes catalogues. The registry is the operator's, written only
    // by the verbs (§4.1) — a probe that could rewrite it would be a second
    // opinion about what a lane routes to.
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    const regPath = path.join(home, '.ccrc', 'models', 'gpt.classes.json');
    fs.writeFileSync(regPath, '{"kept":true}');
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readFileSync(regPath, 'utf8')).toBe('{"kept":true}');
  });
});

describe('failure keeps the previous catalogue and marks it stale (§11)', () => {
  it('a failed fetch rewrites the previous file with stale:true and lastError, and NOTHING else changes', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = parseCatalogue(catalogueAt('gpt'));
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/keeping the previous catalogue/);
    const after = parseCatalogue(catalogueAt('gpt'));
    expect(after.stale).toBe(true);
    expect(after.lastError).toBeTruthy();
    expect(after.models).toEqual(before.models);
    expect(after.fetchedAt).toBe(before.fetchedAt);
  });

  it('a failed fetch with NO previous catalogue writes nothing at all', () => {
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('a SUCCESSFUL probe clears the stale flag and the error', () => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const cat = parseCatalogue(catalogueAt('gpt'));
    expect(cat.stale).toBe(false);
    expect(cat.lastError).toBeUndefined();
  });
});

describe('schema drift refuses the WHOLE response (§11)', () => {
  const bad = (name: string, body: unknown): string => {
    const p = path.join(home, name);
    fs.writeFileSync(p, JSON.stringify(body));
    return p;
  };

  it.each([
    ['no models array', { data: [] }],
    ['a model with no slug', { models: [{ display_name: 'x' }] }],
    ['a model that is not an object', { models: ['gpt-5.6-sol'] }],
    ['a body that is not an object', [1, 2, 3]],
  ] as const)('refuses %s, keeping the previous catalogue', (why, body) => {
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = catalogueAt('gpt');
    const r = run(['gpt', 'codex'],
      { CCRC_MODELS_PROBE_FIXTURE: bad(`drift-${why.replace(/\W+/g, '-')}.json`, body) });
    expect(r.code).toBe(1);
    const after = parseCatalogue(catalogueAt('gpt'));
    expect(after.stale).toBe(true);
    expect(after.models).toEqual(parseCatalogue(before).models);
  });

  it('a partial catalogue is never written — one bad model kills the whole file', () => {
    // Eight good rows and one with no slug. Writing the eight would RETIRE the
    // ninth on every surface (§4.3), which is a warning about a model that
    // answers fine.
    const raw = JSON.parse(fs.readFileSync(CODEX_RAW, 'utf8')) as { models: unknown[] };
    raw.models.push({ display_name: 'no slug here' });
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: bad('partial.json', raw) });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });
});

describe('the test seam is a seam and not a second code path', () => {
  it('CCRC_MODELS_PROBE_FIXTURE is read in exactly one place', () => {
    // A seam that appeared in two branches would be a second implementation of
    // "fetch", and the network arm would stop being the thing under test.
    const src = fs.readFileSync(PROBE, 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('CCRC_MODELS_PROBE_FIXTURE'))).toHaveLength(1);
  });

  it('the probe is executable and has a bash shebang', () => {
    expect(fs.statSync(PROBE).mode & 0o111).toBeGreaterThan(0);
    expect(fs.readFileSync(PROBE, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bash');
  });
});
