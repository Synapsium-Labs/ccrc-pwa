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

  it('stages the catalogue write beside its destination, not in a shared temp dir (§4.2)', () => {
    // spec §4.2 is tmp + mv in the SAME directory as the destination: a
    // cross-filesystem `mv` (staging under `$TMPDIR`/`mktemp -d`, then moving
    // into `~/.ccrc/models`) degrades to copy+unlink, which a reader (the
    // fleet poll, ccd, the verbs) can observe mid-write. A temp DIRECTORY is
    // still fine for the RAW fetch's own scratch space — it is only ever
    // read, never renamed into place — so this checks the lines that actually
    // get moved onto the destination, not every temp-file use in the file.
    const src = fs.readFileSync(PROBE, 'utf8');
    expect(src).toContain('"$OUT.tmp.$$"');
    expect(src).toMatch(/mktemp -d/); // the RAW fetch's scratch dir — still fine, see above
    // The probe is a standalone executable and cannot source ccd's platform
    // block, so the rename goes through the local `_probe_mv_notdir` helper,
    // not a bare GNU `mv -fT` — `macos-platform.test.ts`'s GNU-only scan
    // forbids that flag at any call site outside the block.
    const movedLines = src.split('\n').filter((l) => l.includes('_probe_mv_notdir "$NORM" "$OUT"'));
    expect(movedLines.length).toBeGreaterThan(0);
    for (const l of movedLines) expect(l).not.toMatch(/\$TMPD\b/);
    const codeLines = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(codeLines.some((l) => /(?<![-_a-zA-Z])mv\s+-[a-zA-Z]*T/.test(l)),
      'a bare mv -T outside a comment means the write stopped routing through _probe_mv_notdir')
      .toBe(false);
  });

  it('--out an existing directory refuses instead of writing inside it', () => {
    // `_probe_mv_notdir`, not a bare `mv -f`: it REFUSES when the destination
    // is a directory rather than moving the staged file inside it, which
    // would "succeed" into the wrong place. Exit 1 — the same family as every
    // other write failure past usage validation (`die`), not exit 2 (usage):
    // the arguments themselves were fine, the destination was not.
    const dir = path.join(home, 'existing-dir');
    fs.mkdirSync(dir);
    const r = run(['gpt', 'codex', '--out', dir], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('--out a symlink to a directory replaces the link, like GNU mv -fT does', () => {
    // `[ -d "$2" ]` alone follows symlinks, so a naive fix would just exclude
    // a symlink from the refusal above and leave the actual move as a plain
    // `mv -f` — and measured, `mv -f "$1" symlink-to-dir` (no `-T` available
    // to this file) FOLLOWS the link and drops the file INSIDE the target
    // directory, which is the exact wrong-place write the refusal exists for,
    // now silent instead of refused. The correct behaviour, matching GNU
    // `mv -fT` and ccd/ccd's darwin `_plat_mv_notdir` arm: the link itself is
    // replaced by the catalogue, and the directory it pointed at is
    // untouched.
    const target = path.join(home, 'symlink-target-dir');
    fs.mkdirSync(target);
    const link = path.join(home, 'out-link');
    fs.symlinkSync(target, link);
    const r = run(['gpt', 'codex', '--out', link], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.lstatSync(link).isSymbolicLink(), 'the link must be REPLACED, not left pointing at a now-populated directory').toBe(false);
    const cat = parseCatalogue(JSON.parse(fs.readFileSync(link, 'utf8')));
    expect(cat.probe).toBe('codex');
    expect(fs.readdirSync(target), 'the directory the link pointed at must stay untouched').toEqual([]);
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
    // Pin fetchedAt to a sentinel the failure path could never reproduce by
    // coincidence. `Date.now()`-derived timestamps are `int(time.time())` —
    // whole SECONDS — and the two `run()` calls in this test are typically
    // well under a second apart, so comparing "before" and "after" against
    // each other lets a mutant that refreshes fetchedAt slip through most of
    // the time (measured: 18/20 mutant reds in a tight repeat loop, not a
    // reliable single-run signal). A sentinel far from `Date.now()` makes the
    // check deterministic instead of probabilistic.
    const seededPath = path.join(home, '.ccrc', 'models', 'gpt.json');
    const seeded = JSON.parse(fs.readFileSync(seededPath, 'utf8')) as { fetchedAt: number };
    seeded.fetchedAt = 1600000000;
    fs.writeFileSync(seededPath, JSON.stringify(seeded));
    const before = parseCatalogue(catalogueAt('gpt'));
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/keeping the previous catalogue/);
    const after = parseCatalogue(catalogueAt('gpt'));
    expect(after.stale).toBe(true);
    expect(after.lastError).toBeTruthy();
    expect(after.models).toEqual(before.models);
    expect(after.fetchedAt).toBe(1600000000);
  });

  it('a failed probe does not downgrade the catalogue\'s mode', () => {
    // Measured before the fix: 0600 after the successful seed, 0664 after the
    // next failed run — `_mark_stale`'s python rewrite created the staged
    // file with `open(dst, "w")`, which takes the umask, and nothing chmod'd
    // it before the rename. An OpenRouter catalogue carries the lane's price
    // list, so a failure must not loosen its mode.
    run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const out = path.join(home, '.ccrc', 'models', 'gpt.json');
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    const r = run(['gpt', 'codex'], { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'no-such-file') });
    expect(r.code).toBe(1);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
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

const OPENROUTER_RAW = path.join(here, 'fixtures', 'catalogues', 'openrouter-raw-page.json');
const COMPATIBLE_RAW = path.join(here, 'fixtures', 'catalogues', 'compatible-raw.json');
const ENDPOINTS_RAW = path.join(here, 'fixtures', 'catalogues', 'openrouter-endpoints-raw.json');

describe('the OpenRouter arm (§5)', () => {
  it('carries ids, labels, context and PRICES, and flags nothing hidden', () => {
    const r = run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    expect(r.code).toBe(0);
    expect(curlCalls()).toEqual([]);
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.probe).toBe('openrouter');
    expect(cat.models.map((m) => m.id))
      .toEqual(['anthropic/claude-opus-4.5', 'z-ai/glm-5.2', 'qwen/qwen3.5-9b']);
    const opus = cat.models[0]!;
    expect(opus.label).toBe('Anthropic: Claude Opus 4.5');
    expect(opus.context).toBe(200000);
    expect(opus.maxContext).toBe(64000);
    expect(opus.priceIn).toBeCloseTo(0.000005, 12);
    expect(opus.priceOut).toBeCloseTo(0.000025, 12);
    // OpenRouter advertises no reasoning levels — an EMPTY list, which
    // `effortFile` reads as "unknown", never as "none offered".
    expect(opus.efforts).toEqual([]);
    expect(cat.models.every((m) => !m.hidden)).toBe(true);
  });

  it('a null max_completion_tokens is null, not zero', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.models.find((m) => m.id === 'qwen/qwen3.5-9b')!.maxContext).toBeNull();
  });

  it('a zero price is ZERO, not null — a free model is a fact, not a gap', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const cat = parseCatalogue(catalogueAt('router'));
    expect(cat.models.find((m) => m.id === 'qwen/qwen3.5-9b')!.priceIn).toBe(0);
  });

  it('refuses a body with no data array', () => {
    const p = path.join(home, 'no-data.json');
    fs.writeFileSync(p, JSON.stringify({ models: [] }));
    expect(run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: p }).code).toBe(1);
  });
});

describe('the compatible arm (§5)', () => {
  it('needs a base URL', () => {
    const r = run(['lane', 'compatible']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--base-url/);
  });

  it('carries the ids and nothing else — a bare /v1/models says nothing more', () => {
    const r = run(['lane', 'compatible', '--base-url', 'https://api.cortecs.ai'],
      { CCRC_MODELS_PROBE_FIXTURE: COMPATIBLE_RAW });
    expect(r.code).toBe(0);
    const cat = parseCatalogue(catalogueAt('lane'));
    expect(cat.probe).toBe('compatible');
    expect(cat.models).toEqual([
      { id: 'glm-5.2', label: 'glm-5.2', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
      { id: 'qwen3.5-9b', label: 'qwen3.5-9b', context: null, maxContext: null, efforts: [], hidden: false, priceIn: null, priceOut: null },
    ]);
  });

  it('a 404 leaves "never probed" — no file, exit 1 (§5)', () => {
    const r = run(['lane', 'compatible', '--base-url', 'https://api.cortecs.ai'],
      { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'lane.json'))).toBe(false);
  });
});

describe('--endpoints: the ownership-whitelist question (§5, §8)', () => {
  it('writes the RAW endpoints body to --out and no catalogue at all', () => {
    const out = path.join(home, 'endpoints.json');
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', out],
      { CCRC_MODELS_PROBE_FIXTURE: ENDPOINTS_RAW, ANTHROPIC_AUTH_TOKEN: 'lane-token' });
    expect(r.code).toBe(0);
    const body = JSON.parse(fs.readFileSync(out, 'utf8')) as { data: { endpoints: unknown[] } };
    expect(body.data.endpoints).toHaveLength(2);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'router.json'))).toBe(false);
  });

  it('requires --out — the body is an ANSWER to one question, not a lane\'s catalogue', () => {
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2'],
      { CCRC_MODELS_PROBE_FIXTURE: ENDPOINTS_RAW, ANTHROPIC_AUTH_TOKEN: 'lane-token' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--endpoints needs --out/);
  });

  it('is refused on any probe kind but openrouter', () => {
    const r = run(['gpt', 'codex', '--endpoints', 'gpt-5.6-sol', '--out', path.join(home, 'e.json')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--endpoints is an OpenRouter question/);
  });

  it('a failed fetch under --endpoints never marks any catalogue stale', () => {
    run(['router', 'openrouter'], { CCRC_MODELS_PROBE_FIXTURE: OPENROUTER_RAW });
    const before = fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.json'), 'utf8');
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', path.join(home, 'e.json')],
      { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    expect(r.code).toBe(1);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.json'), 'utf8')).toBe(before);
  });

  it('a failed fetch under --endpoints never rewrites a PRE-EXISTING --out file either (fix round 1, finding 1)', () => {
    // The previous test proves `router.json` is untouched, but that is true
    // even without the short-circuit, because `--out` for `--endpoints` is
    // never `router.json` (it is mandatory and always names a different
    // path). The guard's real job is protecting whatever already sits AT
    // `--out` — a previous, valid endpoints answer — from `_mark_stale`
    // finding it, treating it as a catalogue, and rewriting it with
    // `stale`/`lastError` keys.
    const out = path.join(home, 'e.json');
    const previousAnswer = JSON.stringify({ data: { endpoints: [] } });
    fs.writeFileSync(out, previousAnswer);
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', out],
      { CCRC_MODELS_PROBE_FIXTURE: path.join(home, 'nope') });
    expect(r.code).toBe(1);
    expect(fs.readFileSync(out, 'utf8')).toBe(previousAnswer);
  });

  it('--out an existing directory refuses instead of writing inside it (fix round 1, finding 2)', () => {
    // Mirrors the Codex catalogue arm's own directory-refusal test:
    // `_probe_mv_notdir` on the final rename must REFUSE when --out names an
    // existing directory, not "succeed" by dropping the answer inside it
    // under $RAW's basename.
    const dir = path.join(home, 'endpoints-existing-dir');
    fs.mkdirSync(dir);
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', dir],
      { CCRC_MODELS_PROBE_FIXTURE: ENDPOINTS_RAW, ANTHROPIC_AUTH_TOKEN: 'lane-token' });
    expect(r.code).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('the endpoints call needs the lane\'s key — the LIST stays credential-free (fix round 1, finding 3)', () => {
    // NO fixture here, deliberately: the fixture seam short-circuits `_fetch`
    // before the credential check ever runs (it answers for the whole
    // function, real network or not), so routing this case through the seam
    // would make it pass trivially without ever exercising the check. Leaving
    // the seam unset drives the refusal off the real openrouter arm's own
    // token gate, which sits before its `curl` call — so the poisoned curl in
    // this suite must still see nothing, proving the token is never sent.
    //
    // `ANTHROPIC_AUTH_TOKEN: ''` is required, not optional: `env()` spreads
    // `process.env` before `extra`, so an ambient token in the vitest
    // process's own environment would otherwise leak through and satisfy the
    // probe's `[ -n … ]` check, making this refusal test pass or fail on the
    // operator's shell rather than on the code (fix round 2 — reviewer
    // reproduced with `ANTHROPIC_AUTH_TOKEN=sk-ambient-leak-test`). An empty
    // string overrides the spread and still fails `[ -n … ]`.
    const r = run(['router', 'openrouter', '--endpoints', 'z-ai/glm-5.2', '--out', path.join(home, 'e.json')],
      { ANTHROPIC_AUTH_TOKEN: '' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the endpoints question needs the lane's key: set ANTHROPIC_AUTH_TOKEN/);
    expect(fs.existsSync(path.join(home, 'e.json'))).toBe(false);
    expect(curlCalls()).toEqual([]);
  });
});
