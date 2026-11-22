// server/test/models-op-hold-ends.test.ts — when a class's hold ends (programme model-class-advance, follow-up
// revert-ends-itself). The owner's ruling: classes always advance, and a Revert holds the class only until a newer model
// appears. Each case runs the REAL writers, `deploy/models-op.mjs`'s Codex `revert`, `advance-plan` and `advance-commit`
// and its Anthropic `revert` and `aliases-refresh`, against a `mkTmp` HOME, so what is pinned is what a lane's files say.
//
// THE CASES, Codex arm: a revert hold waits while the newest model is the one the Revert left, and ends once a model newer
// than that appears; a hand hold, and a revert hold an older build wrote (no `from`), derive what they wait to be passed;
// a held pin the retire grace has retired ends its hold; a failed canary keeps the hold. Anthropic arm: a revert hold ends
// on a third alias id observed after the hold, never on the id the Revert left, never on evidence older than the hold.
//
// Neutral ids only (`model-<v>-gamma`, `claude-opus-9-<n>`), lanes `lane-a` (codex-kind) and `lane-c` (Anthropic): this
// repository is public.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { STEP_CATALOGUE, STEP_REGISTRY, stepAdvance, stepRoster, stepRow } from './fixtures/advanceCases.js';
import type { Advance } from '../../shared/model-advance.mjs';
import { aliasesFileName } from '../../shared/models.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const OP = path.join(REPO, 'deploy', 'models-op.mjs');

const NOW = '2026-10-23T09:00:00Z';
const LATER = '2026-10-23T10:00:00Z';
const PORTS = { proxyPort: 45060, litellmPort: 45061 };

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hold-ends-');
  fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'accounts.json'),
    `${JSON.stringify(stepRoster({ ...PORTS, authDir: codexAuthDir('lane-a') }), null, 2)}\n`);
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

interface Result { code: number; body: Record<string, unknown>; out: string }
const rosterPath = (): string => path.join(home, '.ccrc', 'accounts.json');
/** One op, its clock at `at`. Exactly one JSON line on stdout is the op's contract. */
function op(at: string, ...args: string[]): Result {
  const r = spawnSync(process.execPath, [OP, ...args],
    { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: at }, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const lines = (r.stdout ?? '').split('\n');
  expect(lines, out).toHaveLength(2);
  return { code: r.status ?? -1, body: JSON.parse(lines[0]!), out };
}
const modelsDir = (): string => path.join(home, '.ccrc', 'models');
const advOf = (id: string): Advance => JSON.parse(fs.readFileSync(path.join(modelsDir(), `${id}.advance.json`), 'utf8'));
const pinsOf = (id: string): Record<string, string | null> =>
  JSON.parse(fs.readFileSync(path.join(modelsDir(), `${id}.classes.json`), 'utf8')).classes;

// ── the Codex arm ───────────────────────────────────────────────────────────────────────────────────────────────────
const G56 = 'model-5.6-gamma';
const G61 = 'model-6.1-gamma';
const G62 = 'model-6.2-gamma';
/** STEP_CATALOGUE plus `model-6.2-gamma`, newer than every gamma before it. */
const WITH_G62 = { ...STEP_CATALOGUE, models: [...STEP_CATALOGUE.models, stepRow(G62, ['low', 'medium', 'high', 'xhigh'])] };
/** lane-a after one automatic advance of opus from 5.6 to 6.1, at `effort` xhigh. */
const ADVANCED_REGISTRY = { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: G61 },
  effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } };
const ADVANCE_ENTRY = { at: '2026-10-21T14:05:11Z', how: 'advance', from: G56, to: G61, ok: true, canary: 'passed',
  effort: { from: 'max', to: 'xhigh' }, cause: 'newer' };

function plantCodex(o: { registry?: unknown; catalogue?: unknown; advance?: unknown } = {}): void {
  fs.writeFileSync(path.join(modelsDir(), 'lane-a.classes.json'), `${JSON.stringify(o.registry ?? STEP_REGISTRY, null, 2)}\n`,
    { mode: 0o600 });
  fs.writeFileSync(path.join(modelsDir(), 'lane-a.json'), JSON.stringify(o.catalogue ?? STEP_CATALOGUE));
  fs.writeFileSync(path.join(modelsDir(), 'lane-a.advance.json'), `${JSON.stringify(o.advance ?? stepAdvance(), null, 2)}\n`,
    { mode: 0o600 });
  const m = op(NOW, 'materialise', '--file', rosterPath(), '--id', 'lane-a');
  expect(m.code, m.out).toBe(0);
}
/** The lane after a real Revert of opus's advance (6.1 back to 5.6), the catalogue as `catalogue` says. */
function revertedCodex(catalogue: unknown = STEP_CATALOGUE): void {
  plantCodex({ registry: ADVANCED_REGISTRY, catalogue,
    advance: stepAdvance({ opus: { previous: { model: G56, effort: 'max' }, history: [ADVANCE_ENTRY] } }) });
  const r = op(NOW, 'revert', '--file', rosterPath(), '--id', 'lane-a', '--class', 'opus');
  expect(r.code, r.out).toBe(0);
  expect(pinsOf('lane-a')['opus']).toBe(G56);
}
const opusRow = (at = LATER): Record<string, unknown> =>
  (op(at, 'advance-plan', '--file', rosterPath(), '--id', 'lane-a').body['classes'] as Record<string, unknown>[])[2]!;
const commit = (to: string, o: { at?: string; canary?: string; from?: string } = {}): Result =>
  op(o.at ?? LATER, 'advance-commit', '--file', rosterPath(), '--id', 'lane-a', '--class', 'opus', '--from', o.from ?? G56,
    '--to', to, '--canary', o.canary ?? 'passed', ...(o.canary === 'failed' ? ['--reason', 'http 500: upstream error'] : []));

describe('the Codex arm: a held class and the advance step', () => {
  it('a revert hold while the newest model is the one the Revert left: held, and the commit abandons', () => {
    revertedCodex();
    expect(advOf('lane-a').classes.opus.hold).toMatchObject({ at: NOW, by: 'revert' });
    expect(opusRow()).toMatchObject({ held: true, candidate: G61 });
    expect(commit(G61).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
  });

  it('a revert hold once a model newer than the one it left appears: held, and the commit abandons', () => {
    revertedCodex(WITH_G62);
    expect(opusRow()).toMatchObject({ held: true, candidate: G62 });
    expect(commit(G62).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
    expect(advOf('lane-a').classes.opus.hold).not.toBeNull();
  });

  it('a hand hold with a newer model in its family: held, and the commit abandons', () => {
    plantCodex({ advance: stepAdvance({ opus: { hold: { at: NOW, by: 'hand' } } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G61 });
    expect(commit(G61).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
  });

  it('a revert hold an older build wrote (no from) is read from the history: held while 6.1 is newest', () => {
    // The revert entry names what the Revert left (6.1), so 6.1 itself does not end the hold.
    const REVERT_ENTRY = { at: NOW, how: 'revert', from: G61, to: G56, ok: true, canary: 'not-run',
      effort: { from: 'xhigh', to: 'max' } };
    plantCodex({ advance: stepAdvance({ opus: { hold: { at: NOW, by: 'revert' }, history: [ADVANCE_ENTRY, REVERT_ENTRY] } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G61 });
  });

  it('a held pin the retire grace has retired: held, and the commit abandons', () => {
    const gone = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G61) };
    plantCodex({ registry: ADVANCED_REGISTRY, catalogue: gone, advance: stepAdvance({ opus: {
      hold: { at: '2026-09-09T00:00:00Z', by: 'hand' },
      missing: { model: G61, since: '2026-09-09T18:26:40Z', seen: '2026-09-10T00:26:40Z' } } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G56, reason: 'retired' });
    expect(commit(G56, { from: G61 }).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    expect(pinsOf('lane-a')['opus']).toBe(G61);
  });

  it('a failed canary on a held class records nothing and keeps the hold', () => {
    revertedCodex(WITH_G62);
    const before = fs.readFileSync(path.join(modelsDir(), 'lane-a.advance.json'), 'utf8');
    expect(commit(G62, { canary: 'failed' }).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    expect(fs.readFileSync(path.join(modelsDir(), 'lane-a.advance.json'), 'utf8')).toBe(before);
  });
});

// ── the Anthropic arm ───────────────────────────────────────────────────────────────────────────────────────────────
const LANE = 'lane-c';
const SUFFIX = '.claude-lane-c';
const X1 = 'claude-opus-9-1';
const X2 = 'claude-opus-9-2';
const X3 = 'claude-opus-9-3';
const C1 = '2026-11-16T00:00:00Z';
const T0 = '2026-11-16T06:00:00Z';
const C2 = '2026-11-16T12:00:00Z';
const T1 = '2026-11-16T18:00:00Z';
const R1 = '2026-11-16T20:00:00Z';
const C3 = '2026-11-17T00:00:00Z';
const T2 = '2026-11-17T06:00:00Z';
const T3 = '2026-11-17T12:00:00Z';

const regDir = (): string => path.join(home, 'reg');
/** One catalogue cache file of the lane's home, in the current format, naming `target` as opus's alias. */
function plantCache(fetchedAt: string, target: string): void {
  const p = path.join(home, SUFFIX, 'cache', 'model-catalog', 'cache-fixture.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify({
    version: 2, fetchedAt: Date.parse(fetchedAt), staleAt: Date.parse(fetchedAt) + 3_600_000, resolution: 'token_org',
    catalog: { config: {
      provider_alias_targets: { opus: { default: target } },
      models: [X1, X2, X3].map((id) => ({ id, name: `Name ${id}`, min_claude_code_version: null,
        runtime: { effort_levels: ['low', 'high'], default_effort: 'high' }, thinking: { type: 'effort' } })),
    } },
  })}\n`);
}
const refresh = (at: string): Result => op(at, 'aliases-refresh', '--file', rosterPath(), '--id', LANE, '--reg', regDir());
const aliasVerb = (at: string, verb: string): Result => op(at, verb, '--file', rosterPath(), '--id', LANE, '--class', 'opus');
const aliasId = (): string | null => JSON.parse(fs.readFileSync(path.join(modelsDir(), aliasesFileName(LANE)), 'utf8'))
  .classes.opus.id;

/** opus's alias moved X1 to X2 (recorded at T1), then a real Revert at R1 holds it at X1. */
function revertedAlias(): void {
  fs.mkdirSync(regDir(), { recursive: true });
  plantCache(C1, X1);
  expect(refresh(T0).code).toBe(0);
  plantCache(C2, X2);
  expect(refresh(T1).body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
  const r = aliasVerb(R1, 'revert');
  expect(r.code, r.out).toBe(0);
  expect(advOf(LANE).classes.opus.hold).toMatchObject({ at: R1, by: 'revert', model: X1 });
}

describe('the Anthropic arm: a held class and the aliases refresh', () => {
  it('a revert hold while the alias still names the id the Revert left, on evidence newer than the hold: no move', () => {
    revertedAlias();
    plantCache(C3, X2);
    const r = refresh(T2);
    expect(r.body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold).toMatchObject({ by: 'revert', model: X1 });
  });

  it('a revert hold while the alias names a third id on evidence older than the hold: no move', () => {
    revertedAlias();
    // C2 is older than the hold (R1): the alias may have named X3 before the Revert, so it is unobserved.
    plantCache(C2, X3);
    expect(refresh(T2).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold).toMatchObject({ by: 'revert', model: X1 });
  });

  it('a revert hold once the alias names a third id observed after the hold: no move, the hold stands', () => {
    revertedAlias();
    plantCache(C3, X3);
    const r = refresh(T2);
    expect(r.body['moved']).toEqual([]);
    expect(aliasId()).toBe(X3);
    expect(advOf(LANE).classes.opus.hold).toMatchObject({ by: 'revert', model: X1 });
    expect(advOf(LANE).classes.opus.history).toHaveLength(1);
    expect(refresh(T3).body['moved']).toEqual([]);
  });

  it('a hand hold once the alias names another id observed after the hold: no move, the hold stands', () => {
    fs.mkdirSync(regDir(), { recursive: true });
    plantCache(C1, X1);
    expect(refresh(T0).code).toBe(0);
    expect(aliasVerb(T1, 'hold').code).toBe(0);
    plantCache(C3, X2);
    expect(refresh(T2).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold).toMatchObject({ by: 'hand', model: X1 });
  });
});
