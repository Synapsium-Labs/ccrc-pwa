// `deploy/gen-accounts.mjs` — the CLI `deploy/deploy.sh` runs, with a bare
// `node`, to turn a box's `~/.ccrc/accounts.json` into the text of
// `~/.ccrc/accounts.sh`. Task 10 of the stage-2a plan.
//
// WHY THIS FILE EXISTS AT ALL. The CLI cannot import `shared/roster.ts` — it
// runs under a bare `node` on the deploying workstation, with no build step,
// no `tsx` and no compiled `dist/`, which is the whole reason
// `shared/generate.mjs` and `shared/mark.mjs` are `.mjs` in the first place.
// So it re-implements, in JavaScript, the two things `parseRoster` does that
// it needs: the DERIVATION (`homeAble`, `byIdLengthDesc`, `upstreamId` — none
// of which exist in the JSON on disk) and the VALIDATION.
//
// A hand-copied validator is exactly the drift this stage exists to kill, and
// a comment asking the next author to keep the two in step is not a
// mechanism. This is the mechanism. Three directions, all of them cheap:
//
//  - ACCEPT: for every roster both sides consider valid, the CLI's stdout
//    must equal `markGenerated(generateAccountsSh(parseRoster(json)))`
//    computed through the TypeScript, byte for byte. That covers the
//    derivation as well as the validation — a `byIdLengthDesc` comparator
//    that lost its tie-break reorders `case` arms and fails here.
//  - REJECT: for every roster `parseRoster` throws on, the CLI must exit
//    nonzero and write nothing to stdout. This is the direction that
//    actually protects the fleet: a roster the CLI accepted and the server
//    rejected would deploy a box whose `ccd` works and whose `ccrc.service`
//    crash-loops every three seconds behind a green deploy.
//  - TEXT: the three regex literals `shared/roster-json.mjs` hand-copies out
//    of `shared/roster.ts` are lifted out of BOTH files and required to be
//    equal, character for character. The last block in this file, added in
//    D-1742's second round; its header says why the two directions above
//    cannot do that job.
//
// The asymmetry the CLI's own header claims — it may be stricter, never laxer
// — is what makes the REJECT list the load-bearing one. Every case below is a
// roster `parseRoster` genuinely throws on, asserted here rather than assumed,
// so a case that stops being invalid on the TypeScript side cannot quietly
// stop testing anything.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoster, MODEL_ID_RE, POOL_NAME_RE } from '../../shared/roster.js';
import { PROVIDERS, PROVIDER_IDS } from '../../shared/providers.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { markGenerated, bodyDigest } from '../../shared/mark.mjs';
import { rosterFromJson as rosterFromJsonSync } from '../../shared/roster-json.mjs';
import { baseUrlCases } from './fixtures/baseUrlCases.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const CLI = path.join(ccrcRoot, 'deploy', 'gen-accounts.mjs');

/** Runs the CLI exactly as `deploy.sh` does: a bare `node`, one path argv,
 *  output on stdout. No tsx, no loader, no build — if this ever needs one,
 *  the deploy is broken and this test is where that surfaces. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Writes `json` to a throwaway file and runs the CLI against it. */
function runOn(json: unknown, name = 'accounts.json'): ReturnType<typeof run> {
  const file = path.join(mkTmp('ccrc-gen-accounts-'), name);
  writeFileSync(file, JSON.stringify(json, null, 2));
  return run([file]);
}

/** A roster with no explicit hues at all — `parseRoster` auto-assigns them
 *  and the emitter never reads one, so the CLI must accept it too rather
 *  than demanding a field it does not use. */
const HUELESS_ROSTER = {
  version: 1,
  accounts: [
    { id: 'one', label: 'One', configDirSuffix: '.one', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
    { id: 'two', label: 'Two', configDirSuffix: '.two', exec: { kind: 'generated', secretsFile: '.cc-secrets/two.env' }, homeAble: false, telemetry: 'none' },
  ],
};

/** The same two accounts as `PLAIN_ROSTER` below, carrying every field §4.1
 *  adds. Nothing in `generateAccountsSh`'s output may move because of them —
 *  and `deploy/gen-accounts.mjs` must agree, byte for byte, which is what the
 *  ACCEPT row below asserts. */
const ENRICHED_ROSTER = {
  version: 1,
  accounts: [
    { id: 'one', label: 'team·max', configDirSuffix: '.claude-one',
      exec: { kind: 'upstream', secretsFile: '.cc-secrets/one-oauth.env' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'two', label: 'alt·max', configDirSuffix: '.claude-two',
      exec: {
        kind: 'generated', provider: 'compatible', secretsFile: '.cc-secrets/two.env',
        baseUrl: 'http://127.0.0.1:8642/v1',
        models: {
          opus: 'vendor/opus-1', sonnet: 'vendor/sonnet-1',
          haiku: 'vendor/haiku-1', subagent: 'vendor/haiku-1',
          selectable: [{ id: 'vendor/opus-1', label: 'Opus' }, { id: 'vendor/sonnet-1' }, { id: 'vendor/haiku-1' }],
        },
      },
      homeAble: false, hue: 'violet', telemetry: 'none' },
  ],
};

/** The identical roster with every §4.1 field removed — a roster written before
 *  this spec existed. The pair is the whole measurement. */
const PLAIN_ROSTER = {
  version: 1,
  accounts: [
    { id: 'one', label: 'team·max', configDirSuffix: '.claude-one',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'two', label: 'alt·max', configDirSuffix: '.claude-two',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/two.env' },
      homeAble: false, hue: 'violet', telemetry: 'none' },
  ],
};

/** Ids that are strict textual prefixes of one another — the fixture that
 *  actually exercises the length-descending `case` arm order, which is the
 *  derivation most likely to drift between the two implementations. */
const PREFIX_COLLISION_ROSTER = {
  version: 1,
  accounts: [
    { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'a-b', label: 'AB', configDirSuffix: '.a-b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'a-b-c', label: 'ABC', configDirSuffix: '.a-b-c', exec: { kind: 'generated' }, homeAble: false, hue: 'blue', telemetry: 'none' },
    // Ties `a-b-c` on length, so the `id`-ascending tie-break is the only
    // thing that makes the emitted arm order deterministic.
    { id: 'a-b-d', label: 'ABD', configDirSuffix: '.a-b-d', exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' },
  ],
};

/** Explicit hues on SOME accounts and none on others. The only roster shape
 *  that can observe `assignHues`'s pool subtraction — the step that keeps an
 *  auto-assigned hue off a hue an account explicitly claimed. Every other
 *  fixture here is all-explicit (so `assignHues` is a no-op) or all-hueless (so
 *  the subtraction removes nothing and `pool === HUES` either way), which is
 *  how a broken mirror survived the whole ACCEPT table.
 *
 *  It matters more than it used to: this stage made `hue` GENERATED BYTES
 *  (`_ccrc_hue`), so a mirror that drifts makes the fleet host's `accounts.sh`
 *  differ from the server's projection of the same JSON — which the new
 *  fingerprint check then reports as `roster: 'divergent'` on a fleet whose two
 *  `accounts.json` files are identical. */
const MIXED_HUE_ROSTER = {
  version: 1,
  accounts: [
    { id: 'up', label: 'Up', configDirSuffix: '.up', exec: { kind: 'upstream' }, homeAble: true, hue: 'green', telemetry: 'anthropic' },
    { id: 'auto-one', label: 'Auto One', configDirSuffix: '.auto-one', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    { id: 'mid', label: 'Mid', configDirSuffix: '.mid', exec: { kind: 'generated' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'auto-two', label: 'Auto Two', configDirSuffix: '.auto-two', exec: { kind: 'external' }, homeAble: false, telemetry: 'none' },
  ],
};

/** Seven hueless accounts against six `HUES` — the only shape that reaches
 *  `assignHues`'s modulo wrap AND its empty-pool fallback. `roster.ts`'s own
 *  docstring says the round-robin exists to stop every excess account clumping
 *  onto the last hue; nothing here could see that rule break. */
const OVERFLOW_HUE_ROSTER = {
  version: 1,
  accounts: Array.from({ length: 7 }, (_, i) => ({
    id: `acct${i}`,
    label: `Acct ${i}`,
    configDirSuffix: `.acct${i}`,
    exec: i === 0 ? { kind: 'upstream' } : { kind: 'generated' },
    homeAble: true,
    telemetry: 'anthropic',
  })),
};

/** All six hues explicitly claimed, plus TWO accounts with none — the only
 *  shape that reaches `assignHues`'s empty-pool fallback (`pool.length > 0 ?
 *  pool : HUES`) observably. One hueless account cannot see it: whether the
 *  fallback is the whole list or just its first entry, account #7 gets `cyan`
 *  either way. It takes a second to tell `HUES` from `[HUES[0]]`, and without
 *  that distinction a fallback narrowed to one hue paints every excess account
 *  the same colour with the mirror still "agreeing". */
const EXHAUSTED_HUE_ROSTER = {
  version: 1,
  accounts: [
    ...['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'].map((hue, i) => ({
      id: `claimed${i}`,
      label: `Claimed ${i}`,
      configDirSuffix: `.claimed${i}`,
      exec: i === 0 ? { kind: 'upstream' } : { kind: 'generated' },
      homeAble: true,
      hue,
      telemetry: 'anthropic',
    })),
    { id: 'spill-one', label: 'Spill One', configDirSuffix: '.spill-one', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    { id: 'spill-two', label: 'Spill Two', configDirSuffix: '.spill-two', exec: { kind: 'generated' }, homeAble: false, telemetry: 'none' },
  ],
};

const SHIPPED = ['accounts.default.json'] as const;

describe('gen-accounts.mjs agrees with the TypeScript pipeline it cannot import', () => {
  it.each(SHIPPED)('%s — the roster this repo actually ships parses and generates identically', (name) => {
    const file = path.join(ccrcRoot, 'deploy', name);
    const r = run([file]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    // Read through the SAME file the CLI read, so this is a claim about the
    // committed bytes and not about a transcription of them.
    const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(r.stdout).toBe(markGenerated(generateAccountsSh(parseRoster(json))));
  });

  it.each([
    ["the five-account test default roster", DEFAULT_TEST_ROSTER],
    ['the test default roster with pool tags on some accounts', POOLED_TEST_ROSTER],
    ['a roster with no explicit hues', HUELESS_ROSTER],
    ['a roster carrying provider, baseUrl and models', ENRICHED_ROSTER],
    ['a roster mixing explicit and auto-assigned hues', MIXED_HUE_ROSTER],
    ['seven hueless accounts against six hues', OVERFLOW_HUE_ROSTER],
    ['all six hues claimed, with two accounts still needing one', EXHAUSTED_HUE_ROSTER],
    ['ids that are strict prefixes of one another, two of them tied on length', PREFIX_COLLISION_ROSTER],
  ] as const)('%s: stdout is byte-identical to markGenerated(generateAccountsSh(parseRoster(json)))', (_label, spec) => {
    const r = runOn(spec);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toBe(markGenerated(generateAccountsSh(parseRoster(spec))));
  });

  it('emits the provenance marker on line 2, under the shebang', () => {
    const r = runOn(DEFAULT_TEST_ROSTER);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  // D-69's guard used to sit here: the shipped migration roster
  // (`deploy/accounts.migration.json`) once declared its third generated
  // account with no `secretsFile`, so a wrapper generator reading it would
  // have written a launcher with no auth line, and a test pinned the
  // corrected declaration against the committed file. That roster left the
  // tree with the stage-5 de-brand (spec §5, D-202) — an operator's real
  // roster is theirs, not this repo's — so the guard's subject is gone and
  // the guard went with it. The general rule it deliberately did NOT assert
  // still stands: `secretsFile` is legitimately optional on a `generated`
  // account (`shared/roster.ts`'s `ExecSpec` docstring, `ccd/ccrc-adopt`),
  // and `DEFAULT_TEST_ROSTER` keeps one such account (`claude-b`) so the
  // no-secrets shape stays exercised everywhere the fixture is used.
});

describe('rosterFromJson is importable, and carries the fields the wrapper writer needs', () => {
  it('returns execKind and secretsFile per account', async () => {
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    const r = rosterFromJson(DEFAULT_TEST_ROSTER);
    const byId = new Map(r.accounts.map((a) => [a.id, a]));
    expect(byId.get('claude')?.execKind).toBe('upstream');
    expect(byId.get('claude')?.secretsFile).toBeUndefined();
    expect(byId.get('claude-a')?.execKind).toBe('generated');
    expect(byId.get('claude-a')?.secretsFile).toBe('.cc-secrets/claude-a-oauth.env');
    expect(byId.get('gpt')?.execKind).toBe('external');
    expect(r.upstreamId).toBe('claude');
  });

  it('importing it does NOT run a CLI', async () => {
    // deploy/gen-accounts.mjs sets process.exitCode on import by design. The
    // extracted module must not, or every consumer inherits its exit status.
    const before = process.exitCode;
    await import('../../shared/roster-json.mjs');
    expect(process.exitCode).toBe(before);
  });
});

// The mirror carries three DERIVED LISTS off `shared/providers.ts` — it must,
// or it is laxer than the parser on every provider gate, which is the one
// direction its header (:49-52) forbids. What it must NOT carry is the TABLE:
// the labels, credentials, env vars, connect methods, probes and catalogues
// have exactly one home and `providers.test.ts`'s `git ls-files` scan measures
// that over every tracked file, `.mjs` included.
//
// These three assertions are the mechanism §4.2 claimed already existed. It did
// not: `shared/roster-json.mjs`'s `HUES` is a hand-typed `new Set([…])`, undocumented,
// with nothing comparing it to `shared/roster.ts`'s `HUES` — its agreement is
// caught only INDIRECTLY, because hues reach bash through `_ccrc_hue` and a
// divergent order changes stdout. `provider` reaches no bash at all (§4.3 puts
// it in `~/<configDirSuffix>/settings.json`), so the indirect mechanism does
// not exist here and a direct one has to.
describe('the mirror\'s derived lists agree with the table it cannot import', () => {
  it('its provider id list is PROVIDER_IDS, in order', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared/roster-json.mjs'), 'utf8');
    const m = /const PROVIDER_IDS = new Set\(\[([^\]]*)\]\);/.exec(src);
    expect(m, 'shared/roster-json.mjs must declare `const PROVIDER_IDS = new Set([…]);`').not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual([...PROVIDER_IDS]);
  });

  it('its api-key provider list is the table\'s apiKeyModels column', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared/roster-json.mjs'), 'utf8');
    const m = /const API_KEY_PROVIDERS = new Set\(\[([^\]]*)\]\);/.exec(src);
    expect(m).not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual(PROVIDER_IDS.filter((p) => PROVIDERS[p].apiKeyModels));
  });

  it('its base-url-required list is the table\'s baseUrlRequired column', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared/roster-json.mjs'), 'utf8');
    const m = /const BASE_URL_REQUIRED = new Set\(\[([^\]]*)\]\);/.exec(src);
    expect(m).not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual(PROVIDER_IDS.filter((p) => PROVIDERS[p].baseUrlRequired));
  });

  it('its MODEL_ID_RE is the same regex, SOURCE for source', () => {
    // Source, not behaviour, and that is the point: the last time a regex was
    // copied out of `shared/roster.ts` into this file, the escape text was
    // emitted as the RAW control bytes it describes — twice in one task, with
    // identical behaviour, tsc clean and every suite green
    // (`server/test/source-bytes.test.ts:5-15`, the incident that file is named
    // after). A behavioural comparison would have passed then too.
    const src = readFileSync(path.join(ccrcRoot, 'shared/roster-json.mjs'), 'utf8');
    const m = /const MODEL_ID_RE = (\/.*\/);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(MODEL_ID_RE.toString());
  });

  it('agrees with parseRoster on every row of the endpoint gate\'s own table', () => {
    // The mirror IMPORTS `BASE_URL_OK` — from `shared/base-url.mjs`, the twin
    // Task 2 ships for the bare-`node` callers — so what this row measures is
    // not two spellings of one gate but two PARSERS reaching the same verdict
    // through it: `parseRoster` calls the `.ts`, `rosterFromJson` calls the
    // `.mjs`, and the endpoint's legality has to arrive identically at both.
    // Driven over the SAME rows, the `leastLoaded.ts` pattern one directory
    // over. Agreement is asserted as "both throw or neither does", never as
    // "the mirror throws when I expect": a row that stopped being invalid on
    // the parser side would otherwise keep testing a refusal nobody asks for
    // any more.
    const at = (baseUrl: unknown): unknown => ({ version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane', label: 'team·shared', configDirSuffix: '.claude-lane',
        exec: baseUrl === undefined
          ? { kind: 'generated', provider: 'compatible' }
          : { kind: 'generated', provider: 'compatible', baseUrl },
        homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
    for (const c of baseUrlCases) {
      const spec = at(c.raw);
      expect(throws(() => parseRoster(spec)), `parseRoster: ${c.why}`).toBe(!c.expect.ok);
      expect(throws(() => rosterFromJsonSync(spec)), `rosterFromJson: ${c.why}`).toBe(!c.expect.ok);
    }
    // …and it agrees by IMPORTING the gate, not by carrying a fourth spelling of
    // it. Behaviour alone cannot tell those apart today and would stop being
    // able to the moment one of them drifted, which is the whole lesson of
    // `source-bytes.test.ts`. Asserted last, so the rows above own the failure
    // when the gate is merely wrong rather than merely copied.
    const src = readFileSync(path.join(ccrcRoot, 'shared/roster-json.mjs'), 'utf8');
    expect(src).toMatch(/^import \{ BASE_URL_OK \} from '\.\/base-url\.mjs';$/m);
    // The loopback set has exactly two homes (`shared/base-url.ts` and its
    // `.mjs` twin) and this file is neither of them.
    expect(src).not.toContain("'127.0.0.1'");
  });
});

describe('gen-accounts.mjs rejects everything parseRoster rejects', () => {
  const acct = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'claude', label: 'Claude', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic', ...over,
  });
  const roster = (...accounts: unknown[]): unknown => ({ version: 1, accounts });

  const CASES: [string, unknown][] = [
    ['not an object at all', [1, 2, 3]],
    ['an unknown version', { version: 2, accounts: [acct()] }],
    ['accounts is not an array', { version: 1, accounts: {} }],
    ['no accounts at all', roster()],
    ['an account that is not an object', roster('claude')],
    ['an id with an uppercase letter', roster(acct({ id: 'Claude' }))],
    ['an id containing whitespace', roster(acct({ id: 'cl aude' }))],
    ['an empty label', roster(acct({ label: '' }))],
    ['a configDirSuffix of "." — it resolves to $HOME itself', roster(acct({ configDirSuffix: '.' }))],
    ['a configDirSuffix containing a slash', roster(acct({ configDirSuffix: '.a/b' }))],
    ['a configDirSuffix escaping upward', roster(acct({ configDirSuffix: '..evil' }))],
    ['a configDirSuffix carrying a shell metacharacter', roster(acct({ configDirSuffix: '.a$(id)' }))],
    ['no exec at all', roster(acct({ exec: undefined }))],
    ['an unknown exec.kind', roster(acct({ exec: { kind: 'wrapper' } }))],
    ['a non-string exec.secretsFile', roster(acct({ exec: { kind: 'generated', secretsFile: 7 } }), acct({ id: 'up' }))],
    // exec.secretsFile is embedded inside a double-quoted bash string in the
    // generated wrapper (`[ -r "$HOME/<path>" ] && . "$HOME/<path>"`), so it
    // gets the same conservative path gate configDirSuffix carries. Paired
    // with a distinct, valid upstream account so the roster is rejected ONLY
    // for its secretsFile — not incidentally via "no upstream account" (a
    // single-account `generated` roster would trip that check regardless of
    // this guard, which would make the case pass for the wrong reason).
    ['a secretsFile with a double quote', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/a"b.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a dollar sign', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/$USER.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a backtick', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/`id`.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a backslash', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/a\\b.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a newline', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/a\nb.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a parent-directory hop', roster(acct({ exec: { kind: 'generated', secretsFile: '../.ssh/id_ed25519' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an absolute secretsFile', roster(acct({ exec: { kind: 'generated', secretsFile: '/etc/shadow' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an empty secretsFile', roster(acct({ exec: { kind: 'generated', secretsFile: '' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a trailing slash', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a secretsFile with a space', roster(acct({ exec: { kind: 'generated', secretsFile: '.cc-secrets/a b.env' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a non-boolean homeAble', roster(acct({ homeAble: 'yes' }))],
    // D-1663 (spec §12 P-1), closed in this task. This file's whole argument is the REJECT
    // direction — "a roster the CLI accepted and the server rejected would
    // deploy a box whose `ccd` works and whose `ccrc.service` crash-loops every
    // three seconds behind a green deploy" — and `hidden` was that roster. The
    // validator never learned the field, so `"false"` (a truthy string that
    // erases an account from every surface listing one) sailed through here and
    // died at `loadConfig`. This row was RED on the tree before the mirror
    // learned the field; that measurement is what makes it a mechanism.
    ['a non-boolean hidden — a truthy string that would erase an account', roster(acct({ hidden: 'false' }))],
    // `pool` is embedded UNQUOTED in a generated bash `case` arm and printed
    // with `echo`, so its grammar is `ID_RE`'s and every way out of it is
    // refused on both sides.
    ['a pool name with an uppercase letter', roster(acct({ pool: 'Corp' }))],
    ['an empty pool name', roster(acct({ pool: '' }))],
    ['a non-string pool', roster(acct({ pool: 7 }))],
    ['a pool name carrying a shell metacharacter', roster(acct({ pool: 'a$(id)' }))],
    ['an explicit null pool — absence means untagged, a written null is a half-edit', roster(acct({ pool: null }))],
    // The leading-letter anchor and the charset, measured on BOTH sides rather than
    // on the parser alone. Three one-character drifts of the mirrored literal — a
    // first-character class that admits a hyphen or a digit, and a charset that
    // admits an underscore — are each survived by every other row in this block,
    // and each makes this file LAXER than `parseRoster`, which is the one direction
    // its header forbids. The hyphen row is the load-bearing one: a leading `-` is
    // what `POOL_NAME_RE`'s first-character class exists to refuse, because bash's
    // `echo` swallows an argument of `-` followed by `n`/`e`/`E` and prints nothing.
    ['a pool name starting with a hyphen — what the leading-letter rule exists for', roster(acct({ pool: '-pool' }))],
    ['a pool name starting with a digit', roster(acct({ pool: '1pool' }))],
    ['a pool name containing an underscore', roster(acct({ pool: 'pool_a' }))],
    // The CAP, driven end to end rather than assumed (D-1742). What holds the
    // two copies of the LITERAL equal is the text-extraction block at the end of
    // this file (D-1742's second round) — that is the primary mechanism, and the
    // only one that can speak about a whole charset at once. This row is the
    // other direction, and is not superseded by it: 33 lowercase letters are
    // legal under every spelling of the charset and illegal only under the
    // length, so it drives the cap through a real subprocess and proves the
    // mirror CONSULTS its literal rather than merely holding one. Text equality
    // could never tell you that.
    ['a pool name one character past the 32-character cap', roster(acct({ pool: 'a'.repeat(33) }))],
    // A legal first character followed by an illegal TAIL character — the shape
    // no row in this table had until now, and the gap that let three tail-charset
    // widenings of the mirrored literal survive the whole block (D-1742, second
    // round). Kept as a reader's worked example of what the grammar refuses, NOT
    // as the guard: it catches `[a-zA-Z0-9-]` and neither `[a-z0-9.-]` nor
    // `[a-z0-9+-]`, because a row only ever pins the character it names and the
    // class of widenings is open. The extraction block below is the guard.
    ['a pool name with an uppercase letter in the TAIL', roster(acct({ pool: 'aCorp' }))],
    ['an unknown telemetry', roster(acct({ telemetry: 'openai' }))],
    ['an unknown hue', roster(acct({ hue: 'chartreuse' }))],
    // THE MECHANISM CHECK, added alone and measured red-then-green before the
    // rows below it were trusted to this harness. `parseRoster` has refused a
    // non-boolean `hidden` since the field landed (roster.ts:707-713, its
    // reasoning comment at :702-706 and the `=== true` coercion at :714;
    // pinned by roster.test.ts:141-146) and, before this task, the mirror had
    // never heard of the field at all — measured 2026-09-07, before this
    // commit: `grep -c hidden shared/roster-json.mjs` -> 0.
    // So this roster was ACCEPTED by the deploy-side generator, which then
    // rewrote a box's accounts.sh and wrappers for it, and REFUSED by the
    // server on boot. The mirror being laxer than the parser is the one
    // direction its own header (:49-52) says cannot be tolerated (D-1854).
    ['a non-boolean hidden — a truthy "false" would erase an account', roster(acct({ hidden: 'false' }))],

    // ── the secretsFile gate, on the two kinds it never covered (D-1855) ────
    // Before this task, `shared/roster-json.mjs`'s two secretsFile gates (see
    // its `HOISTED (D-1855)` comment) were both conjoined with
    // `exec['kind'] === 'generated'` while `checkAccount`'s return spread the
    // value unconditionally, so these paths reached `deploy/gen-wrappers.mjs`'s
    // manifest unvalidated on `upstream` and `external` entries. Latent until
    // now: no roster put `secretsFile` on a non-generated entry, and the task
    // before this one is what creates the callers.
    ['a parent-directory hop in an UPSTREAM secretsFile', roster(acct({ exec: { kind: 'upstream', secretsFile: '../.ssh/id_ed25519' } }))],
    ['an absolute EXTERNAL secretsFile', roster(acct(), acct({ id: 'ext', configDirSuffix: '.ext', exec: { kind: 'external', secretsFile: '/etc/shadow' } }))],
    ['a non-string EXTERNAL secretsFile', roster(acct(), acct({ id: 'ext', configDirSuffix: '.ext', exec: { kind: 'external', secretsFile: 7 } }))],

    // ── provider ───────────────────────────────────────────────────────────
    // Invisible to the ACCEPT direction: `provider` never reaches accounts.sh
    // (shared/generate.mjs:206-238 emits ids, home-ability, CCRC_MEASURED, the
    // upstream id, config dirs, labels and hues, and nothing else), so byte
    // agreement stays green whether the mirror validates it or not. This table
    // is the only half of the harness that can see it (D-1861).
    ['an unknown exec.provider on a generated account', roster(acct({ exec: { kind: 'generated', provider: 'anthorpic' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an unknown exec.provider on an external account', roster(acct(), acct({ id: 'ext', configDirSuffix: '.ext', exec: { kind: 'external', provider: 'claude' } }))],
    ['a non-string exec.provider', roster(acct({ exec: { kind: 'generated', provider: 7 } }), acct({ id: 'up', configDirSuffix: '.up' }))],

    // ── baseUrl ────────────────────────────────────────────────────────────
    ['a compatible lane with no exec.baseUrl at all', roster(acct({ exec: { kind: 'generated', provider: 'compatible' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a plain-http exec.baseUrl to somewhere that is not this box', roster(acct({ exec: { kind: 'generated', provider: 'compatible', baseUrl: 'http://orchard-api/v1' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an exec.baseUrl carrying userinfo — a URL is not a place to keep a key', roster(acct({ exec: { kind: 'generated', provider: 'compatible', baseUrl: 'https://user:pass@orchard-api/v1' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an exec.baseUrl carrying a query string', roster(acct({ exec: { kind: 'generated', provider: 'compatible', baseUrl: 'https://orchard-api/v1?beta=true' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an unparseable exec.baseUrl', roster(acct({ exec: { kind: 'generated', provider: 'compatible', baseUrl: 'orchard-api' } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['an invalid exec.baseUrl on an EXTERNAL account, where it is declarative', roster(acct(), acct({ id: 'ext', configDirSuffix: '.ext', exec: { kind: 'external', provider: 'openrouter', baseUrl: 'http://orchard-api/v1' } }))],

    // ── models ─────────────────────────────────────────────────────────────
    ['exec.models on a provider that carries no model map', roster(acct({ exec: { kind: 'generated', provider: 'anthropic', models: { opus: 'a/b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/d' } } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['exec.models missing the subagent alias', roster(acct({ exec: { kind: 'generated', provider: 'openrouter', models: { opus: 'a/b', sonnet: 'a/c', haiku: 'a/d' } } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a model id with a space in it', roster(acct({ exec: { kind: 'generated', provider: 'openrouter', models: { opus: 'a b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/d' } } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['a selectable list that does not offer what opus routes to', roster(acct({ exec: { kind: 'generated', provider: 'openrouter', models: { opus: 'a/b', sonnet: 'a/c', haiku: 'a/d', subagent: 'a/d', selectable: [{ id: 'a/c' }, { id: 'a/d' }] } } }), acct({ id: 'up', configDirSuffix: '.up' }))],
    ['two accounts with the same id', roster(acct(), acct({ exec: { kind: 'generated' } }))],
    // A label reaches a ONE-LINE status bar (`_ccrc_label`) that
    // `server/src/pane/statusline.ts` parses back out of a tmux capture: an
    // embedded newline splits that line and the parser reads the wrong branch
    // off what is left, so the fleet view disagrees with the session itself.
    ['a label containing a newline', roster(acct({ label: 'expo\nmax' }))],
    ['a label containing an escape byte', roster(acct({ label: 'expo\u001b[31mmax' }))],
    // `_ccrc_dir_id` maps a config dir back to ONE account. Two accounts on
    // one dir resolves to whichever the emitter wrote first, and the loser is
    // measured by nothing forever.
    ['two accounts sharing one configDirSuffix', roster(acct(), acct({ id: 'twin', exec: { kind: 'generated' } }))],
    ['no upstream account', roster(acct({ exec: { kind: 'generated' } }))],
    ['two upstream accounts', roster(acct(), acct({ id: 'claude2', configDirSuffix: '.claude2' }))],
  ];

  it.each(CASES)('%s — parseRoster throws on it', (_label, spec) => {
    // Asserted, not assumed: a case that stopped being invalid on the
    // TypeScript side would otherwise turn the CLI assertion below into a
    // test of nothing.
    expect(() => parseRoster(spec)).toThrow();
  });

  it.each(CASES)('%s — the CLI exits nonzero and writes NO bash', (_label, spec) => {
    const r = runOn(spec);
    expect(r.code, 'a roster the server refuses to boot on must fail the deploy, not generate a file')
      .not.toBe(0);
    expect(r.stdout, 'a rejected roster must not produce a single byte of bash').toBe('');
    expect(r.stderr.length, 'a rejection with no diagnostic is unactionable at 2am').toBeGreaterThan(0);
  });

  it('refuses malformed JSON, naming the file', () => {
    const file = path.join(mkTmp('ccrc-gen-accounts-'), 'accounts.json');
    writeFileSync(file, '{ "version": 1, ');
    const r = run([file]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(file);
  });

  it('refuses a file that does not exist rather than emitting an empty roster', () => {
    const r = run([path.join(mkTmp('ccrc-gen-accounts-'), 'nope.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('cannot read');
  });

  it('prints usage and exits 2 with no argument — never reads a default from somewhere', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage:');
  });
});

// `shared/generate.mjs` is the one file in the roster chain this wave does not
// edit, and the reason to PROVE that rather than inspect it is that three
// mechanisms turn on the exact bytes it emits: `ownRosterFp`
// (server/src/server.ts:1056, compared at :1054 against the fleet host's copy
// and answered as `roster: 'divergent'` on GET /api/fleet/health), `ccd`
// sourcing the file on every invocation (ccd:1093), and
// `wrapper-roster-fixture.test.ts`'s two-directional comparison of ccd's parsed
// answer space against the roster. On an AGENT-FIRST wave the fleet box gets
// new code first, so an emitter change shows up as an amber banner over a green
// deploy.
describe('the new roster fields do not reach accounts.sh', () => {
  it('an enriched roster and a plain one project to the SAME bytes', () => {
    const enriched = generateAccountsSh(parseRoster(ENRICHED_ROSTER));
    const plain = generateAccountsSh(parseRoster(PLAIN_ROSTER));
    expect(enriched).toBe(plain);
  });

  it('…and to the same digest, which is the value the two boxes compare', () => {
    // `bodyDigest` over the marked text is what `ownRosterFp` is; comparing the
    // digests rather than only the strings states the property in the terms the
    // divergence banner is computed in.
    expect(bodyDigest(markGenerated(generateAccountsSh(parseRoster(ENRICHED_ROSTER)))))
      .toBe(bodyDigest(markGenerated(generateAccountsSh(parseRoster(PLAIN_ROSTER)))));
  });

  it('the emitted bash never spells provider, baseUrl or models', () => {
    // The direct statement, so a future emitter that started writing one of
    // them reds here and not only in the equality above — which a change
    // emitting the SAME new line for both rosters would satisfy.
    const sh = generateAccountsSh(parseRoster(ENRICHED_ROSTER));
    for (const token of ['provider', 'baseUrl', 'models', 'compatible', 'openrouter', '8642', 'vendor/']) {
      expect(sh, `accounts.sh must not carry ${token}`).not.toContain(token);
    }
    // …and the secrets path is not in there either. It never was — the emitter
    // has no `secretsFile` arm — but §4.1 makes the field legal on the upstream
    // account for the first time, and `accounts.sh` is world-readable at 0644.
    expect(sh).not.toContain('.cc-secrets');
  });

  it('the equality is not vacuous: a difference the emitter DOES read moves the bytes', () => {
    // Without this, an emitter returning a constant satisfies every assertion
    // above. `label` is the cheapest field to move that is not `id`.
    const relabelled = JSON.parse(JSON.stringify(PLAIN_ROSTER)) as typeof PLAIN_ROSTER;
    relabelled.accounts[1]!.label = 'team·shared';
    expect(generateAccountsSh(parseRoster(relabelled)))
      .not.toBe(generateAccountsSh(parseRoster(PLAIN_ROSTER)));
    expect(bodyDigest(markGenerated(generateAccountsSh(parseRoster(relabelled)))))
      .not.toBe(bodyDigest(markGenerated(generateAccountsSh(parseRoster(PLAIN_ROSTER)))));
  });

  it('the two shipped rosters still project exactly as they did', () => {
    // `deploy/accounts.default.json` is the roster a fresh install starts from
    // and `DEFAULT_TEST_ROSTER` is what every ccd fixture home is built out of.
    // §4.1's absence-permitting claim is pinned by keeping both byte-identical
    // and green; this is that pin stated where the bytes are, rather than only
    // as an untouched file in the diff.
    const shipped: unknown = JSON.parse(
      readFileSync(path.join(ccrcRoot, 'deploy', 'accounts.default.json'), 'utf8'));
    expect(generateAccountsSh(parseRoster(shipped)))
      .toContain('CCRC_ACCOUNTS=(claude)');
    expect(generateAccountsSh(parseRoster(DEFAULT_TEST_ROSTER)))
      .toContain('CCRC_MEASURED=(claude claude-a claude-b claude-d)');
  });
});

// ── The third direction: the LITERALS themselves, held equal as TEXT ────────
//
// The two blocks above are BEHAVIOURAL, and behaviour turned out not to hold
// the grammar equal — D-1742's first round concluded that it did, and that
// conclusion was refuted. Three tail-charset widenings of
// `shared/roster-json.mjs`'s mirrored `POOL_NAME_RE` — `[a-zA-Z0-9-]`,
// `[a-z0-9.-]` and `[a-z0-9+-]` — each SURVIVE every row of the REJECT table,
// measured. The reason is structural rather than an oversight in one row: every
// pool row there fails on its FIRST character (`Corp`, `-pool`, `1pool`), on
// length (33), on type (`7`, a written `null`), or on a character none of the
// three widenings admit (`a$(id)`, `pool_a`). Not one paired a legal first
// character with an illegal tail one, so the entire tail charset was unpinned —
// and each widening makes the mirror LAXER than `parseRoster`, the one
// direction `shared/roster-json.mjs`'s own header forbids and the exact shape
// that shipped D-1663's gap behind a green deploy.
//
// Rows are the wrong mechanism for this, which was measured too: the `aCorp`
// row above catches the A–Z widening and neither of the other two. A row pins
// the character it names; the class of tail widenings is open. Text equality is
// a claim about the whole charset at once, so that is what this block makes.
//
// WHAT THIS BLOCK DOES NOT PIN: behaviour. Two files can hold the same pattern
// while one of them never calls `.test` on it, and every assertion here would
// still be green. The REJECT table is what refuses that, and it also covers
// every part of the `pool` gate that is not a regex at all — the type check and
// the refusal of a written `null`. Neither block supersedes the other; a reader
// deciding whether a drift is caught has to read both.
//
// These three literals BY NAME, because no generic scan reaches them:
// `single-definition.test.ts`'s `sources()` filters `/\.tsx?$/`, so a `.mjs` is
// invisible to it, and `server/test/source-bytes.test.ts` does walk that file
// but only for control bytes, never for grammar. `ccd`'s bash copy of
// `POOL_NAME_RE` is wave 2a's parity scan to pin
// (`server/test/pool-name-parity.test.ts`), not this one's.
describe('shared/roster-json.mjs hand-copies three regex literals, and they equal the parser\'s', () => {
  const ROSTER_TS = path.join(ccrcRoot, 'shared', 'roster.ts');
  const ROSTER_MJS = path.join(ccrcRoot, 'shared', 'roster-json.mjs');

  /**
   * Lifts `const NAME = /…/;` — or `export const NAME = /…/;` — out of a file's
   * TEXT and returns the literal's source and flags.
   *
   * The `throw` is this scan's VACUITY TRIPWIRE, and it is the most important
   * line in the block. An extractor that matches nothing compares nothing, and
   * a scan that measures nothing while reporting green is the defect this wave
   * keeps rediscovering — D-1741 lost an entire purity guard to exactly that
   * shape, green against a module the guard never actually read. So a renamed
   * const, or a declaration reformatted off one line, REDS here and says which
   * name in which file it could not find; it never falls through to comparing
   * two empty strings.
   */
  function literalIn(file: string, name: string): { source: string; flags: string } {
    const m = new RegExp(`^(?:export )?const ${name} = /(.+)/([a-z]*);$`, 'm')
      .exec(readFileSync(file, 'utf8'));
    if (m === null) {
      throw new Error(
        `the scan found no literal for ${name} in ${path.relative(ccrcRoot, file)}: nothing `
        + 'there matches `const NAME = /…/;` on a single line, so this scan measured NOTHING. '
        + 'Teach the extractor the new spelling, or restore the declaration — never delete the '
        + 'row, which would leave the two copies of the grammar pinned by nothing again.',
      );
    }
    return { source: m[1]!, flags: m[2]! };
  }

  /** One row per literal `shared/roster-json.mjs` hand-copies out of
   *  `shared/roster.ts`. Three, not one: the class is the point — a mirror is a
   *  mirror in every literal it carries — and the mechanism costs the same for
   *  three as for one.
   *
   *  `POOL_NAME_RE` is exported, so its row compares the mirror against the
   *  IMPORTED OBJECT. At least one row has to reach a runtime value, or the
   *  whole block is two strings agreeing with each other about nothing while the
   *  regex the parser actually runs says something else. `ID_RE` and
   *  `LABEL_UNSAFE_RE` are module-PRIVATE and stay that way — widening a
   *  constant's visibility to make a test easier is how a private decision
   *  becomes an API — so their rows read `shared/roster.ts` as text. */
  const MIRRORED = [
    ['POOL_NAME_RE', (): { source: string; flags: string } =>
      ({ source: POOL_NAME_RE.source, flags: POOL_NAME_RE.flags })],
    ['ID_RE', (): { source: string; flags: string } => literalIn(ROSTER_TS, 'ID_RE')],
    ['LABEL_UNSAFE_RE', (): { source: string; flags: string } => literalIn(ROSTER_TS, 'LABEL_UNSAFE_RE')],
  ] as const;

  it.each(MIRRORED)('%s: the mirrored literal is character-for-character the parser\'s', (name, parserSide) => {
    expect(
      literalIn(ROSTER_MJS, name),
      `shared/roster-json.mjs's ${name} has drifted from shared/roster.ts's. A mirror that is `
      + 'LAXER than the parser deploys a box whose ccd works and whose ccrc.service refuses to '
      + 'boot on the same bytes — see that file\'s header.',
    ).toEqual(parserSide());
  });

  // `POOL_NAME_RE`'s docstring in `shared/roster.ts` says it is "deliberately
  // `ID_RE`'s exact shape, and for `ID_RE`'s exact reason". Nothing measured
  // that sentence until the extractor above existed; with it, the sentence is
  // one assertion.
  //
  // It exists to make a DIVERGENCE DELIBERATE, not to forbid one. The two
  // grammars are identical today because a pool name and an account id reach the
  // same two hazards — an unquoted bash `case` arm and an `echo` whose builtin
  // swallows a leading `-n`/`-e`/`-E`. A later wave with a real reason to
  // separate them changes that sentence and this assertion in the same act; the
  // red is what stops the two drifting apart while the docstring still claims
  // they are one shape.
  it('the pool grammar is still ID_RE\'s exact shape, as roster.ts\'s docstring claims', () => {
    expect(literalIn(ROSTER_TS, 'ID_RE')).toEqual({
      source: POOL_NAME_RE.source, flags: POOL_NAME_RE.flags,
    });
  });
});
