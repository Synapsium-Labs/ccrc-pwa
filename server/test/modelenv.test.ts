// `shared/modelenv.mjs` — the pure half of the materialiser (§6.1, §6.4, §7).
// Pure in the sense that matters here: `modelEnvBlock`, `effortFile` and
// `classesTsv` touch no disk at all, and `mergeSettingsEnv` touches exactly
// one path the caller names. Every case below runs against a `mkTmp` HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
} from '../../shared/modelenv.mjs';
import { CODEX, SEEDED, UNSEEDED } from './fixtures/modelCases.js';

let home: string;
beforeEach(() => { home = mkTmp('ccrc-modelenv-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (over: Record<string, unknown>): Record<string, unknown> =>
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
      CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-5.6-terra',
    });
  });

  it('writes a SENTINEL for every null slot, never leaves the key unset', () => {
    // Unset, the alias falls through to Anthropic's own id and the proxied
    // backend answers with an opaque 404 — today's Fable-on-gpt failure. The
    // sentinel makes `/model fable` fail with a name that says what is missing.
    const only = reg({ classes: { haiku: null, sonnet: null, opus: 'x', fable: null },
      subagent: 'opus', discovery: ['x'], effort: {} });
    const b = modelEnvBlock(only, null);
    expect(b.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('ccrc-unavailable-haiku');
    expect(b.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('ccrc-unavailable-sonnet');
    expect(b.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(Object.keys(b)).toHaveLength(7);
  });

  it('CLAUDE_CODE_SUBAGENT_MODEL is classes[subagent] — the registry\'s explicit choice', () => {
    // Round-2 ruling 3: `subagent` is a class name the operator sets, never a
    // derivation. Pointing it at opus must move the variable, with no other
    // key changing.
    const onOpus = reg({ subagent: 'opus' });
    expect(modelEnvBlock(onOpus, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
    const onHaiku = reg({ subagent: 'haiku' });
    expect(modelEnvBlock(onHaiku, null).CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-luna');
    expect(modelEnvBlock(onHaiku, null).ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
  });

  it('REFUSES when subagent names a null slot, rather than writing a sentinel there', () => {
    // §6.1: "refused if that slot is null". A sentinel in this one variable
    // would make every subagent on the lane fail at the provider, one turn at a
    // time, with nothing having said so at materialise time.
    const bad = reg({ subagent: 'fable' });
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

  it('neither fallback chain ever reaches `fable`, and a fable-only lane is refused', () => {
    // The two chains are spelled in §6.1 and STOP where they stop, deliberately:
    // a lane whose only class is Fable would otherwise silently run every
    // unqualified request — including the small-fast ones — on the most
    // expensive model it has.
    const fableOnly = reg({ classes: { haiku: null, sonnet: null, opus: null, fable: 'f' },
      subagent: 'fable', discovery: ['f'], effort: {} });
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(ModelEnvInvalid);
    expect(() => modelEnvBlock(fableOnly, null)).toThrow(/a lane needs at least one class/);
  });

  it('refuses an UNSEEDED registry (§11) — it is legal on disk and materialises to nothing', () => {
    expect(() => modelEnvBlock(UNSEEDED, null)).toThrow(/a lane needs at least one class/);
  });

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS is ANTHROPIC_MODEL\'s context, as a STRING (§6.1, amended 2026-09-08)', () => {
    // ANTHROPIC_MODEL resolves opus ?? sonnet ?? haiku — SEEDED's opus slot is
    // gpt-5.6-sol, and CODEX lists it with context 272000. Env values are
    // strings everywhere else in this block; a bare number here would be the
    // one key that reads differently from the other seven.
    const b = modelEnvBlock(SEEDED, CODEX);
    expect(b.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
    expect(Object.keys(b)).toHaveLength(8);
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
      .toBe('272000');
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

describe('MODEL_ENV_KEYS', () => {
  it('is the eight keys modelEnvBlock can write, frozen, so a caller never spells them twice', () => {
    // Against a catalogue that names ANTHROPIC_MODEL's context (§6.1,
    // amended 2026-09-08), all eight keys are live at once.
    expect([...MODEL_ENV_KEYS].sort()).toEqual(Object.keys(modelEnvBlock(SEEDED, CODEX)).sort());
    expect(Object.isFrozen(MODEL_ENV_KEYS)).toBe(true);
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
