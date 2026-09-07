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
// mechanism. This is the mechanism. Two directions, both of them cheap:
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
import { parseRoster, MODEL_ID_RE } from '../../shared/roster.js';
import { PROVIDERS, PROVIDER_IDS } from '../../shared/providers.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { rosterFromJson as rosterFromJsonSync } from '../../shared/roster-json.mjs';
import { baseUrlCases } from './fixtures/baseUrlCases.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
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
    ['a roster with no explicit hues', HUELESS_ROSTER],
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
