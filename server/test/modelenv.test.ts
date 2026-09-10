// `shared/modelenv.mjs` — the pure half of the materialiser (§6.1, §6.4, §7).
// Pure in the sense that matters here: `modelEnvBlock`, `effortFile` and
// `classesTsv` touch no disk at all, and `mergeSettingsEnv` touches exactly
// one path the caller names. Every case below runs against a `mkTmp` HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
} from '../../shared/modelenv.mjs';
import { CLASSES, parseRegistry } from '../../shared/models.js';
import type { Registry } from '../../shared/models.js';
import { CODEX, SEEDED, UNSEEDED } from './fixtures/modelCases.js';

const MODELENV_MJS_URL = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'modelenv.mjs'),
).href;

/** Runs `count` real, separate node processes at once, each importing
 *  `shared/modelenv.mjs` fresh and calling ONLY the named export with the
 *  given (JSON-serialisable) arguments — no roster parsing, no registry
 *  read, nothing else on the way to the call, so the processes arrive at
 *  the write this is testing closer together in wall-clock time than a
 *  `deploy/models-op.mjs` CLI round trip (roster read, parse, validate) puts
 *  them: models-op.test.ts's own concurrency test measures a lower but
 *  still non-zero collision rate through that CLI (23-27/360 with a fixed
 *  tmp name), so the CLI does not hide the bug, it just surfaces it less
 *  often. Even through THIS harness the collision stays a race, not a sure
 *  thing: reverting a tmp name to a fixed path below and re-running the
 *  concurrency test it drives (15 rounds x 8 processes) failed 2 of 12
 *  runs in one measurement on the implementer's box (a reviewer saw 0 of 6 on a loaded box) — a race, not a guard, measured for round 3 of the re-review — most
 *  runs land green on the exact regression it exists to catch. That test
 *  stays below as a smoke test (real processes, real disk, genuinely
 *  concurrent writes), but the deterministic guard is the static source pin
 *  further down this file, which reds every run. */
function concurrentCalls(fn: 'mergeSettingsEnv' | 'clearSettingsEnv', args: unknown[], count: number)
  : Promise<{ code: number; err: string }[]> {
  const script = `import { ${fn} } from ${JSON.stringify(MODELENV_MJS_URL)};\n`
    + `${fn}(${args.map((a) => JSON.stringify(a)).join(', ')});\n`;
  return Promise.all(Array.from({ length: count }, () => new Promise<{ code: number; err: string }>((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script]);
    let err = '';
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? -1, err }));
  })));
}

let home: string;
beforeEach(() => { home = mkTmp('ccrc-modelenv-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

// Fix round 1, follow-up: `over` and the return value are both typed as
// `Registry` now — the untyped `Record<string, unknown>` this used to return
// satisfied nothing that took a `Registry`, which `test/tsconfig.tests.json`
// (server/test/'s own typecheck project, `typecheck-tests.test.ts`) reported
// as TS2739 at every call site below. `JSON.parse` clones `SEEDED` structurally
// but returns `any`; typing `over` as `Partial<Registry>` and the return as
// `Registry` is what makes the merge itself checked, with no cast anywhere.
const reg = (over: Partial<Registry>): Registry =>
  ({ ...JSON.parse(JSON.stringify(SEEDED)), ...over });

describe('modelEnvBlock', () => {
  it('is the seven variables, byte for byte, for the seeded gpt registry (§6.1)', () => {
    expect(modelEnvBlock(SEEDED, null)).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.6-luna',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.6-terra',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: 'gpt-5.6-sol',
      ANTHROPIC_SMALL_FAST_MODEL: 'gpt-5.6-luna',
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
    });
  });

  it('writes a SENTINEL for every null slot, never leaves the key unset', () => {
    // Unset, the alias falls through to Anthropic's own id and the proxied
    // backend answers with an opaque 404 — today's Fable-on-gpt failure. The
    // sentinel makes `/model fable` fail with a name that says what is missing.
    // Two sub-cases, not one: fix round 1, v2 (2026-09-09) restricts
    // `subagent` to haiku/sonnet, and each needs its OWN slot non-null to be
    // a legal choice — so no single registry here can leave both haiku and
    // sonnet null while still naming a valid subagent, the way the original
    // one-shot version of this test did with `subagent: 'opus'`.
    const subagentOnHaiku = reg({ classes: { haiku: 'h', sonnet: null, opus: 'x', fable: null },
      subagent: 'haiku', discovery: ['x', 'h'], effort: {} });
    const b1 = modelEnvBlock(subagentOnHaiku, null);
    expect(b1.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('ccrc-unavailable-sonnet');
    expect(b1.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(Object.keys(b1)).toHaveLength(7);

    const subagentOnSonnet = reg({ classes: { haiku: null, sonnet: 's', opus: 'x', fable: null },
      subagent: 'sonnet', discovery: ['x', 's'], effort: {} });
    const b2 = modelEnvBlock(subagentOnSonnet, null);
    expect(b2.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('ccrc-unavailable-haiku');
    expect(b2.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(Object.keys(b2)).toHaveLength(7);
  });

  it('CLAUDE_CODE_SUBAGENT_MODEL is the alias `subagent` — the registry\'s explicit choice', () => {
    // Round-2 ruling 3: `subagent` is a class name the operator sets, never a
    // derivation. Pointing it at sonnet must move the variable, with no other
    // key changing. Measured 2026-09-09 on Claude Code 2.1.267: the value
    // must be the alias itself, not the id it resolves to — a model id in
    // this key is silently ignored and the subagent falls back to
    // ANTHROPIC_SMALL_FAST_MODEL instead. `opus`, not tested here: fix round
    // 1, v2 (2026-09-09) measured that it and `fable` both run the subagent
    // on the sonnet slot's model regardless, so `modelEnvBlock` refuses them
    // (see the REFUSES cases below) rather than writing them.
    const onSonnet = reg({ subagent: 'sonnet' });
    expect(modelEnvBlock(onSonnet, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet');
    const onHaiku = reg({ subagent: 'haiku' });
    expect(modelEnvBlock(onHaiku, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
    expect(modelEnvBlock(onHaiku, null).ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
  });

  it('pins the alias form against both the classes[subagent] mutant and a hardcoded alias', () => {
    // Two mutants this guard must catch: (1) reverting the renderer to
    // `classes[registry.subagent]` (the old, id-valued code), and (2) a
    // renderer that writes back some fixed alias regardless of the
    // registry's own `subagent` field. Two different `subagent` choices,
    // each checked against both the written value and CLASSES membership,
    // catch both: mutant 1 would return a model id here, which is never a
    // member of CLASSES; mutant 2 would return the same alias for both.
    const onSonnet = reg({ subagent: 'sonnet' });
    const sonnetValue = modelEnvBlock(onSonnet, null).CLAUDE_CODE_SUBAGENT_MODEL;
    expect(sonnetValue).toBe('sonnet');
    expect(CLASSES).toContain(sonnetValue);
    const onHaiku = reg({ subagent: 'haiku' });
    const haikuValue = modelEnvBlock(onHaiku, null).CLAUDE_CODE_SUBAGENT_MODEL;
    expect(haikuValue).toBe('haiku');
    expect(CLASSES).toContain(haikuValue);
    expect(haikuValue).not.toBe(sonnetValue);
  });

  it.each(['opus', 'fable'] as const)(
    'reads a legacy subagent %s as written (the renderer refuses it)',
    (cls) => {
      // Fix round 2A (N1): `subagent: 'opus'`/`'fable'` was legal before the
      // 2026-09-09 narrowing and is still LEGAL ON DISK — `parseRegistry`
      // (`shared/models.mjs`) gates `subagent` on `CLASSES` alone, exactly as
      // before that narrowing, so a registry carrying either value still
      // PARSES unchanged. Refusing it there would brick every verb on that
      // lane, including the one that repairs it, the moment this ships (see
      // `parseRegistry`'s doc comment). It is `modelEnvBlock` — the RENDERER
      // — that refuses to materialise an env block for it, naming the same
      // remedy `deploy/models-op.mjs`'s `set-subagent` does.
      const json = { ...JSON.parse(JSON.stringify(SEEDED)), subagent: cls };
      // SEEDED's `fable` slot is null — give it a model so this case
      // exercises ONLY the `SUBAGENT_CLASSES` gate, not the separate
      // null-slot gate `parseRegistry` runs first (that is its own test).
      if (cls === 'fable') (json.classes as Record<string, unknown>)['fable'] = 'gpt-6-astra';
      const parsed = parseRegistry(json);
      expect(parsed.subagent).toBe(cls);
      expect(() => modelEnvBlock(parsed, null)).toThrow(ModelEnvInvalid);
      expect(() => modelEnvBlock(parsed, null)).toThrow(/set-subagent <haiku\|sonnet>/);
      expect(() => modelEnvBlock(parsed, null)).toThrow(/sonnet slot/);
    },
  );

  it('REFUSES when subagent names a null slot, rather than writing a sentinel there', () => {
    // §6.1: "refused if that slot is null". A sentinel in this one variable
    // would make every subagent on the lane fail at the provider, one turn at a
    // time, with nothing having said so at materialise time. `sonnet`, not
    // `fable`: fix round 1, v2 (2026-09-09) restricts `subagent` to
    // haiku/sonnet, so this case has to null one of those two rather than the
    // class the earlier draft used.
    const bad = reg({ classes: { ...SEEDED.classes, sonnet: null }, subagent: 'sonnet' });
    expect(() => modelEnvBlock(bad, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(bad, null)).toThrow(/subagent/);
  });

  it('ANTHROPIC_MODEL falls opus → sonnet → haiku', () => {
    const noOpus = reg({ classes: { haiku: 'h', sonnet: 's', opus: null, fable: null },
      subagent: 'sonnet', discovery: ['h', 's'], effort: {} });
    expect(modelEnvBlock(noOpus, null).ANTHROPIC_MODEL).toBe('s');
    const haikuOnly = reg({ classes: { haiku: 'h', sonnet: null, opus: null, fable: null },
      subagent: 'haiku', discovery: ['h'], effort: {} });
    expect(modelEnvBlock(haikuOnly, null).ANTHROPIC_MODEL).toBe('h');
  });

  it('ANTHROPIC_SMALL_FAST_MODEL falls haiku → sonnet', () => {
    const noHaiku = reg({ classes: { haiku: null, sonnet: 's', opus: 'o', fable: null },
      subagent: 'sonnet', discovery: ['s', 'o'], effort: {} });
    expect(modelEnvBlock(noHaiku, null).ANTHROPIC_SMALL_FAST_MODEL).toBe('s');
  });

  // C1, narrowed by fix round 1, v2 (2026-09-09): this used to be the ONE
  // case that could tell the sentinel apart from a fall-through to `fable` —
  // both haiku and sonnet null, with BOTH opus and fable non-null, subagent
  // pointed at opus so the registry stayed otherwise legal. That registry no
  // longer exists: `subagent` now accepts only haiku or sonnet, and both are
  // null here, so `modelEnvBlock`'s own subagent gate refuses this shape
  // before ANTHROPIC_SMALL_FAST_MODEL is ever computed — there is no longer a
  // way to reach the SMALL_FAST line with both haiku and sonnet null, because
  // a valid subagent now REQUIRES one of the two to be non-null. The
  // SMALL_FAST chain's own sentinel fallback (`?? sentinel('haiku')`) is
  // consequently unreachable through any registry this function accepts; the
  // regression this pinned — a `?? fable` silently added to that chain — can
  // no longer be exercised through `modelEnvBlock`, only reasoned about from
  // the source, so this test now pins the refusal instead.
  it('a lane with both haiku and sonnet null is refused before ANTHROPIC_SMALL_FAST_MODEL is ever computed (C1, narrowed 2026-09-09)', () => {
    const noHaikuNoSonnet = reg({ classes: { haiku: null, sonnet: null, opus: 'o', fable: 'f' },
      subagent: 'sonnet', discovery: ['o', 'f'], effort: {} });
    expect(() => modelEnvBlock(noHaikuNoSonnet, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(noHaikuNoSonnet, null)).toThrow(/subagent/);
  });

  it('ANTHROPIC_MODEL never reaches `fable`, and a fable-only lane is refused', () => {
    // §6.1 spells TWO chains that stop short of `fable`, deliberately: a lane
    // whose only class is Fable would otherwise silently run every
    // unqualified request — including the small-fast ones — on the most
    // expensive model it has. This case only exercises the ONE chain a
    // registry can still reach through `modelEnvBlock`, `ANTHROPIC_MODEL`
    // (opus ?? sonnet ?? haiku): a fable-only registry has no primary class,
    // so it is refused before `ANTHROPIC_MODEL` is even computed. Fix round
    // 2A (N4): the sibling case for `ANTHROPIC_SMALL_FAST_MODEL` (haiku ??
    // sonnet) no longer has a registry that can reach it either — every
    // shape that used to (haiku and sonnet both null) is refused earlier now,
    // by the narrowed `subagent` gate — so that chain is pinned in SOURCE
    // instead, in `single-definition.test.ts`'s "the model files" describe.
    const fableOnly = reg({ classes: { haiku: null, sonnet: null, opus: null, fable: 'f' },
      subagent: 'fable', discovery: ['f'], effort: {} });
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(/a lane needs at least one class/);
  });

  it('refuses an UNSEEDED registry (§11) — it is legal on disk and materialises to nothing', () => {
    expect(() => modelEnvBlock(UNSEEDED, null)).toThrow(/a lane needs at least one class/);
  });

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS is min(ANTHROPIC_MODEL\'s context, 200000), as a STRING '
    + '(§6.1, amended 2026-09-08, Task 16c)', () => {
    // ANTHROPIC_MODEL resolves opus ?? sonnet ?? haiku — SEEDED's opus slot is
    // gpt-5.6-sol, and CODEX lists it with context 272000 — advertised, not
    // usable: fleet-host measurement 2026-09-08 found the largest prompt EVER
    // ACCEPTED on gpt-5.6-sol, over 2,339 transcripts, was 196,341 tokens, with
    // 30 refusals past that wall. The key never raises the client's own 200k
    // default on an advertised number alone. Env values are strings everywhere
    // else in this block; a bare number here would be the one key that reads
    // differently from the other seven.
    const b = modelEnvBlock(SEEDED, CODEX);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('200000');
    expect(Object.keys(b)).toHaveLength(8);
  });

  it('is the row\'s OWN context when it is below the client default — a 128k model must compact '
    + 'at 128k, not 200k (§6.1, amended 2026-09-08, Task 16c)', () => {
    // subagent is `sonnet`, not `opus`: fix round 1, v2 (2026-09-09) restricts
    // `subagent` to haiku/sonnet. `opus` stays the PRIMARY class (ANTHROPIC_MODEL
    // resolves opus ?? sonnet ?? haiku, so opus still wins the narrow-context
    // model this case is testing) — sonnet is assigned only so the registry
    // can legally name a subagent at all.
    const narrow = reg({
      classes: { haiku: null, sonnet: 'gpt-5.6-terra', opus: 'gpt-5.3-codex-spark', fable: null },
      subagent: 'sonnet', discovery: ['gpt-5.3-codex-spark', 'gpt-5.6-terra'], effort: {},
    });
    const b = modelEnvBlock(narrow, CODEX);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000');
  });

  it('is ABSENT when the catalogue is stale — a stale window is not a measured one', () => {
    const b = modelEnvBlock(SEEDED, { ...CODEX, stale: true });
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('is ABSENT with no catalogue at all — never probed is not "assume 200k is fine"', () => {
    const b = modelEnvBlock(SEEDED, null);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('is ABSENT when the catalogue lists the resolved model with context: null', () => {
    const noContext = { ...CODEX,
      models: CODEX.models.map((m) => (m.id === 'gpt-5.6-sol' ? { ...m, context: null } : m)) };
    const b = modelEnvBlock(SEEDED, noContext);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(Object.keys(b)).toHaveLength(7);
  });

  it.each([0, -1, 131072.5])(
    'is ABSENT when the resolved model\'s context is %s — never "unknown" as a sentinel '
    + '(§6.1, amended 2026-09-08, Task 16c fix round 1)', (bad) => {
      // Zero, a negative, and a non-integer are none of them a measured
      // window: writing them verbatim ("0", "-1", "131072.5") would put a
      // number on disk with no window it describes. The omit rule's existing
      // reason applies unchanged — there is no "unavailable" reading for a
      // context window, only "unknown", and the client's own default already
      // means "unknown".
      const badContext = { ...CODEX,
        models: CODEX.models.map((m) => (m.id === 'gpt-5.6-sol' ? { ...m, context: bad } : m)) };
      const b = modelEnvBlock(SEEDED, badContext);
      expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
      expect(Object.keys(b)).toHaveLength(7);
    });
});

describe('mergeSettingsEnv', () => {
  const settings = (): string => path.join(home, '.claude-gpt', 'settings.json');

  it('creates the file when it is absent, with the env block and nothing else', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    const r = mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(r).toEqual({ changed: true });
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j)).toEqual(['env']);
    expect(j.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('ADDS and UPDATES, and never removes another key — the lane owns its own settings', () => {
    // `ccgpt`'s `_sync_gpt_config` mirrors an allow-list into this same file
    // and never removes the lane's own keys (measured, spec §1). The
    // materialiser has to be equally careful in the other direction.
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({
      alwaysThinkingEnabled: true,
      env: { DISABLE_TELEMETRY: '1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'stale-id' },
    }, null, 2));
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(j.alwaysThinkingEnabled).toBe(true);
    expect(j.env.DISABLE_TELEMETRY).toBe('1');
    expect(j.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.6-sol');
  });

  it('PRUNES CLAUDE_CODE_MAX_CONTEXT_TOKENS when a re-materialise\'s block stops emitting it', () => {
    // The eighth key can go from present to absent — a catalogue going stale,
    // or the lane's default model changing to one with no measured context —
    // and unlike every other key here it carries no sentinel: leaving the
    // STALE number on disk would misstate the window rather than merely miss
    // one. This is the one member of MODEL_ENV_KEYS this function ever
    // deletes on its own; the case above shows a key OUTSIDE that set is
    // still never touched.
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, CODEX));
    expect(JSON.parse(fs.readFileSync(settings(), 'utf8')).env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)
      .toBe('200000');
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j.env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
    expect(j.env.ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
  });

  it('reports changed:false on a second identical call, and rewrites nothing', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const before = fs.statSync(settings()).mtimeMs;
    const r = mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(r).toEqual({ changed: false });
    expect(fs.statSync(settings()).mtimeMs).toBe(before);
  });

  it('writes 2-space indent and a trailing newline', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    const text = fs.readFileSync(settings(), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "env": {');
  });

  it('leaves no temp file behind — the write is atomic', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
    expect(fs.readdirSync(path.join(home, '.claude-gpt'))).toEqual(['settings.json']);
  });

  // C8: unpinned before this — dropping `{ mode: 0o600 }` at this write site
  // survived the whole covering suite (127/127, measured). The settings file
  // this writes carries every model alias a lane routes to.
  //
  // The mode pin is vacuous under a STRICT test-runner umask (round 3
  // re-review, M4 — the previous wording had this backwards): dropping
  // `{ mode: 0o600 }` falls back to `writeFileSync`'s default (0o666), and
  // 0o666 masked by umask 077 is ALSO 0o600 — the mutant survives with no
  // change to this assertion. Under a PERMISSIVE umask (022, or this box's
  // own default 0002) the un-forced pin already catches the dropped mode —
  // measured directly against `shared/modelenv.mjs` with `{ mode: 0o600 }`
  // dropped: `(umask 077; …)` writes 0o600 anyway (vacuous), `(umask 022;
  // …)` writes 0o644 (caught). Forcing a known 022 umask around the write
  // means the mutant lands on 0o644 (0o666 & ~0o022) instead, so this reds
  // under any runner umask, strict or permissive. Measured:
  // `(umask 077; npx vitest run test/modelenv.test.ts)` against the mutant
  // (the `{ mode: 0o600 }` dropped) passed before this change and fails after.
  it('writes settings.json at 0600 (C8)', () => {
    const prevUmask = process.umask(0o022);
    try {
      fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
      mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null));
      expect(fs.statSync(settings()).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });

  // C7's fix for `deploy/models-op.mjs`'s two tmp sites (`materialise`'s
  // concurrency test, models-op.test.ts) never exercises THIS write:
  // `op('init', …)` there already materialises the identical settings block
  // once, so every later concurrent `materialise` call finds `changed:
  // false` and `existed: true` and returns from the `!changed && existed`
  // short-circuit before it ever reaches this function's own tmp write —
  // 120 calls prove nothing about this site. This test calls
  // `mergeSettingsEnv` directly, with nothing ahead of it, and deletes the
  // settings file before every round so `existed` is always false and the
  // short-circuit cannot fire: every one of the round's calls must reach
  // the tmp write, genuinely concurrently.
  it('concurrent mergeSettingsEnv calls on the same settings file all succeed — unique tmp names, not a race on one', async () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    const block = modelEnvBlock(SEEDED, null);
    const rounds = 15;
    const width = 8;
    for (let round = 0; round < rounds; round += 1) {
      fs.rmSync(settings(), { force: true });
      const results = await concurrentCalls('mergeSettingsEnv', [settings(), block], width);
      for (const r of results) expect(r.code, `round ${round}: ${r.err}`).toBe(0);
    }
  });

  it('refuses a settings file that is not JSON, rather than overwriting it', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '{ this is not json');
    expect(() => mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null))).toThrow(ModelEnvInvalid);
    expect(fs.readFileSync(settings(), 'utf8')).toBe('{ this is not json');
  });

  it('refuses a settings file whose top level is not an object', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '[]');
    expect(() => mergeSettingsEnv(settings(), modelEnvBlock(SEEDED, null))).toThrow(ModelEnvInvalid);
  });
});

// Round 3 re-review, M2/M7: the concurrency test above is a race — measured
// 2 of 12 separate runs red against a tmp name reverted to a fixed path (see
// that test's own docstring) — so a regression here would land green on most
// CI runs. This is the deterministic guard: it reads the actual bytes of the
// two files that build C7's tmp names — `fs.readFileSync`, never `git show`,
// so it sees a working-tree edit whether or not it is committed — and checks
// EVERY site that assembles one of those names for the substring that makes
// it unique per process, `${process.pid}`. Reverting any one of the five
// sites (two in shared/modelenv.mjs, three in deploy/models-op.mjs) reds
// this on every run, because it is a text match, not a timing window.
describe('C7\'s tmp names are unique per process — a static pin, not a race (round 3, M2/M7)', () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  /** Every `const tmp = \`...\`;` assignment in a file, as raw source lines —
   *  not the comment at deploy/models-op.mjs:298 that also mentions one of
   *  these names in prose, which this pattern does not match. */
  const tmpAssignmentLines = (file: string): string[] =>
    fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\s*const tmp = `/.test(l));

  it('both tmp-name sites in shared/modelenv.mjs (mergeSettingsEnv, clearSettingsEnv) carry ${process.pid}', () => {
    const lines = tmpAssignmentLines(path.join(REPO_ROOT, 'shared', 'modelenv.mjs'));
    expect(lines.length, `expected 2 tmp-name sites, found: ${JSON.stringify(lines)}`).toBe(2);
    for (const l of lines) expect(l).toContain('${process.pid}');
  });

  it('all three tmp-name sites in deploy/models-op.mjs (writeRegistry, materialise, litellm render) carry ${process.pid}', () => {
    const lines = tmpAssignmentLines(path.join(REPO_ROOT, 'deploy', 'models-op.mjs'));
    expect(lines.length, `expected 3 tmp-name sites, found: ${JSON.stringify(lines)}`).toBe(3);
    for (const l of lines) expect(l).toContain('${process.pid}');
  });
});

describe('MODEL_ENV_KEYS', () => {
  it('is the eight keys modelEnvBlock can write, frozen, so a caller never spells them twice', () => {
    // Against a catalogue that names ANTHROPIC_MODEL's context (§6.1,
    // amended 2026-09-08), all eight keys are live at once.
    expect([...MODEL_ENV_KEYS].sort()).toEqual(Object.keys(modelEnvBlock(SEEDED, CODEX)).sort());
    expect(Object.isFrozen(MODEL_ENV_KEYS)).toBe(true);
  });

  // C26 (moved here from the monorepo review, whose own pin read a sibling
  // worktree by a session-scoped absolute path and skipped everywhere else):
  // `API_TIMEOUT_MS` and `CLAUDE_CODE_MAX_RETRIES` ride in the ccgpt wrapper
  // (infra/handoff/ccgpt), never in a lane's settings.json — a re-materialise
  // that ever wrote them here would silently override the operator's own
  // timeout/retry knobs the next time `mergeSettingsEnv` ran. Pinned in-tree,
  // on the shared/modelenv.mjs side, where this export actually lives.
  it('never carries API_TIMEOUT_MS or CLAUDE_CODE_MAX_RETRIES — those ride in the ccgpt wrapper (C26)', () => {
    expect(MODEL_ENV_KEYS).not.toContain('API_TIMEOUT_MS');
    expect(MODEL_ENV_KEYS).not.toContain('CLAUDE_CODE_MAX_RETRIES');
  });
});

describe('clearSettingsEnv — ccrc models <id> rm\'s whole settings step (§4.1 Lifecycle, §10)', () => {
  const settings = (): string => path.join(home, '.claude-gpt', 'settings.json');

  it('clears exactly the eight keys, leaving every other env key untouched', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({
      alwaysThinkingEnabled: true,
      env: { ...modelEnvBlock(SEEDED, CODEX), DISABLE_TELEMETRY: '1' },
    }, null, 2));
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: true });
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(j.alwaysThinkingEnabled).toBe(true);
    expect(j.env).toEqual({ DISABLE_TELEMETRY: '1' });
  });

  // C8: unpinned before this — dropping `{ mode: 0o600 }` at this write site
  // survived the whole covering suite (120/120, measured).
  //
  // Same vacuousness as `mergeSettingsEnv`'s pin above, same fix: force a
  // known 022 umask around the write so the dropped-mode mutant lands on
  // 0o644, not on 0o600 by coincidence of the runner's own umask.
  it('the rewrite lands at 0600 (C8)', () => {
    const prevUmask = process.umask(0o022);
    try {
      fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
      fs.writeFileSync(settings(), JSON.stringify({
        alwaysThinkingEnabled: true,
        env: { ...modelEnvBlock(SEEDED, CODEX), DISABLE_TELEMETRY: '1' },
      }, null, 2));
      clearSettingsEnv(settings(), MODEL_ENV_KEYS);
      expect(fs.statSync(settings()).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });

  it('removes env entirely once emptied by the deletion, rather than writing {}', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({ env: modelEnvBlock(SEEDED, null) }, null, 2));
    clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    expect(Object.keys(j)).toEqual([]);
  });

  it('a missing settings file is changed:false, and nothing is written', () => {
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: false });
    expect(fs.existsSync(settings())).toBe(false);
  });

  it('a second call is idempotent — changed:false, and rewrites nothing', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({ env: modelEnvBlock(SEEDED, null) }, null, 2));
    clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    const before = fs.statSync(settings()).mtimeMs;
    const r = clearSettingsEnv(settings(), MODEL_ENV_KEYS);
    expect(r).toEqual({ changed: false });
    expect(fs.statSync(settings()).mtimeMs).toBe(before);
  });

  it('refuses a settings file that is not JSON, rather than overwriting it', () => {
    fs.mkdirSync(path.join(home, '.claude-gpt'), { recursive: true });
    fs.writeFileSync(settings(), '{ this is not json');
    expect(() => clearSettingsEnv(settings(), MODEL_ENV_KEYS)).toThrow(ModelEnvInvalid);
    expect(fs.readFileSync(settings(), 'utf8')).toBe('{ this is not json');
  });
});

describe('classesTsv — three columns, availability as its own marker (§7)', () => {
  it('is four lines in CLASSES order: class, modelId, state', () => {
    expect(classesTsv(SEEDED, CODEX)).toBe(
      'haiku\tgpt-5.6-luna\tassigned\n'
      + 'sonnet\tgpt-5.6-terra\tassigned\n'
      + 'opus\tgpt-5.6-sol\tassigned\n'
      + 'fable\t\tunassigned\n');
  });

  it('a RETIRED class keeps its id in column 2 and says so in column 3', () => {
    // Round-2 ruling 6 and §4.3: retirement never empties a slot, and ccd reads
    // column 3 rather than inferring unavailability from an empty field — the
    // two states are different and the operator's assignment is theirs.
    const retired = { ...SEEDED,
      classes: { ...SEEDED.classes, sonnet: 'gpt-5.5-mini' },
      discovery: 'catalogue' as const };
    expect(classesTsv(retired, CODEX)).toContain('sonnet\tgpt-5.5-mini\tretired\n');
  });

  it('a stale catalogue retires nothing here either', () => {
    const retired = { ...SEEDED, classes: { ...SEEDED.classes, sonnet: 'gpt-5.5-mini' } };
    expect(classesTsv(retired, { ...CODEX, stale: true })).toContain('sonnet\tgpt-5.5-mini\tassigned\n');
  });

  it('with NO catalogue every non-null class is assigned, never retired', () => {
    expect(classesTsv(SEEDED, null)).toBe(
      'haiku\tgpt-5.6-luna\tassigned\n'
      + 'sonnet\tgpt-5.6-terra\tassigned\n'
      + 'opus\tgpt-5.6-sol\tassigned\n'
      + 'fable\t\tunassigned\n');
  });

  it('is four lines even when every slot is null', () => {
    expect(classesTsv(UNSEEDED, null)).toBe(
      'haiku\t\tunassigned\nsonnet\t\tunassigned\nopus\t\tunassigned\nfable\t\tunassigned\n');
    expect(classesTsv(UNSEEDED, null).split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('the second field is empty ONLY when the state is unassigned', () => {
    // The invariant Plan 2's bash reader depends on: `cut -f2` is meaningful
    // exactly when `cut -f3` is not `unassigned`.
    for (const [r, c] of [[SEEDED, CODEX], [SEEDED, null], [UNSEEDED, null]] as const) {
      for (const line of classesTsv(r, c).split('\n').filter(Boolean)) {
        const [, id, state] = line.split('\t');
        expect(state, line).toMatch(/^(assigned|unassigned|retired)$/);
        expect(id === '', `${line} — empty id with state ${state}`).toBe(state === 'unassigned');
      }
    }
  });

  it('never emits the sentinel — that string lives in the env block alone (§6.1)', () => {
    expect(classesTsv(SEEDED, CODEX)).not.toContain('ccrc-unavailable-');
  });
});

describe('effortFile', () => {
  it('keys the lane defaults by MODEL ID, so the shim never parses the registry (§6.4)', () => {
    expect(effortFile(SEEDED, CODEX)).toEqual({
      byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' },
    });
  });

  it('drops a class whose slot is null — there is no model to key it on', () => {
    // SEEDED's `effort.fable` is 'max' and its `classes.fable` is null.
    expect(Object.keys(effortFile(SEEDED, CODEX).byModel)).not.toContain('');
    expect(Object.keys(effortFile(SEEDED, CODEX).byModel)).toHaveLength(3);
  });

  it('drops a level the catalogue says that model does not offer', () => {
    // Luna has no `ultra`; Astra does (§4.1). A lane default the provider
    // rejects turns every turn on that class into a 400.
    const bad = { ...SEEDED, effort: { ...SEEDED.effort, haiku: 'ultra' } };
    expect(effortFile(bad, CODEX).byModel['gpt-5.6-luna']).toBeUndefined();
    expect(effortFile(bad, CODEX).byModel['gpt-5.6-terra']).toBe('high');
  });

  it('keeps an unvalidatable level when there is no catalogue at all', () => {
    // §4.1: accepted unvalidated when no catalogue exists, flagged by doctor
    // once one appears. Dropping it would silently un-configure a lane the
    // operator has never been able to probe.
    expect(effortFile(SEEDED, null).byModel['gpt-5.6-sol']).toBe('max');
  });

  it('keeps a level when the catalogue lists the model with NO efforts at all', () => {
    // An OpenRouter or `compatible` row carries no effort list; an empty
    // `efforts` is "unknown", not "none offered".
    const noEfforts = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, efforts: [] })) };
    expect(effortFile(SEEDED, noEfforts).byModel['gpt-5.6-sol']).toBe('max');
  });

  it('is an empty byModel when the registry has no effort map', () => {
    const { effort: _drop, ...noEffort } = SEEDED;
    expect(effortFile(noEffort, CODEX)).toEqual({ byModel: {} });
  });
});
