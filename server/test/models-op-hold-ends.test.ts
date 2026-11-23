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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { STEP_CATALOGUE, STEP_REGISTRY, stepAdvance, stepRoster, stepRow } from './fixtures/advanceCases.js';
import type { Advance } from '../../shared/model-advance.mjs';
import { aliasesFileName } from '../../shared/models.mjs';
import { readLaneModels } from '../src/laneModels.js';
import type { FleetIO } from '../src/io.js';

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
/** `advance-commit` to `to` through a copy of the op whose one advance writer first logs each object it is handed, one
 *  JSON line each, to a file: every other byte is the op. The writes it made, in order. */
function commitLogged(to: string): Advance[] {
  const line = 'function writeAdvance(id, advance) {\n  let parsed;';
  let src = fs.readFileSync(OP, 'utf8');
  expect(src.split(line), 'the op has its one advance writer').toHaveLength(2);
  src = src.replace(line, 'function writeAdvance(id, advance) {\n'
    + "  writeFileSync(process.env.CCRC_TEST_ADVANCE_LOG, `${JSON.stringify(advance)}\\n`, { flag: 'a' });\n  let parsed;");
  src = src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
    .replaceAll("from './models-anthropic.mjs'", `from '${pathToFileURL(path.join(REPO, 'deploy', 'models-anthropic.mjs')).href}'`);
  const copy = path.join(home, 'models-op-logged.mjs');
  const log = path.join(home, 'advance-writes.jsonl');
  fs.writeFileSync(copy, src);
  const r = spawnSync(process.execPath, [copy, 'advance-commit', '--file', rosterPath(), '--id', 'lane-a', '--class', 'opus',
    '--from', G56, '--to', to, '--canary', 'passed'],
  { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: LATER, CCRC_TEST_ADVANCE_LOG: log }, encoding: 'utf8' });
  expect(JSON.parse((r.stdout ?? '').split('\n')[0]!), r.stderr).toMatchObject({ outcome: 'moved', to });
  return fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Advance);
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

  it('the Revert names what it left: the hold carries from', () => {
    revertedCodex();
    expect(advOf('lane-a').classes.opus.hold).toEqual({ at: NOW, by: 'revert', from: G61 });
  });

  it('a revert hold ends once a model newer than the one it left appears: the commit moves and clears it in one write', () => {
    revertedCodex(WITH_G62);
    expect(opusRow()).toMatchObject({ held: false, candidate: G62, reason: 'newer' });
    const r = commit(G62);
    expect(r.body).toMatchObject({ outcome: 'moved', from: G56, to: G62, push: true });
    expect(pinsOf('lane-a')['opus']).toBe(G62);
    const opus = advOf('lane-a').classes.opus;
    expect(opus.hold).toBeNull();
    expect(opus.previous).toEqual({ model: G56, effort: 'max' });
    expect(opus.history.at(-1)).toMatchObject({ at: LATER, how: 'advance', from: G56, to: G62, ok: true, cause: 'newer',
      reason: `the hold ended: ${G62} is newer than ${G61}` });
    expect(advOf('lane-a').pending).toBeNull();
  });

  it('a hand hold ends at the next newer model: its from is the held pin', () => {
    plantCodex({ advance: stepAdvance({ opus: { hold: { at: NOW, by: 'hand' } } }) });
    expect(opusRow()).toMatchObject({ held: false, candidate: G61 });
    expect(commit(G61).body).toMatchObject({ outcome: 'moved', to: G61 });
    expect(advOf('lane-a').classes.opus.hold).toBeNull();
  });

  it('an ending hold planned on one candidate never moves to another: the commit abandons held', () => {
    revertedCodex(WITH_G62);
    expect(commit(G61).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    expect(advOf('lane-a').classes.opus.hold).not.toBeNull();
  });

  it('a revert hold an older build wrote (no from) is read from the history: held while 6.1 is newest', () => {
    // The revert entry names what the Revert left (6.1), so 6.1 itself does not end the hold.
    const REVERT_ENTRY = { at: NOW, how: 'revert', from: G61, to: G56, ok: true, canary: 'not-run',
      effort: { from: 'xhigh', to: 'max' } };
    plantCodex({ advance: stepAdvance({ opus: { hold: { at: NOW, by: 'revert' }, history: [ADVANCE_ENTRY, REVERT_ENTRY] } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G61 });
  });

  it('a revert hold an older build wrote ends once a model newer than the one its history says it left appears', () => {
    const REVERT_ENTRY = { at: NOW, how: 'revert', from: G61, to: G56, ok: true, canary: 'not-run',
      effort: { from: 'xhigh', to: 'max' } };
    plantCodex({ catalogue: WITH_G62,
      advance: stepAdvance({ opus: { hold: { at: NOW, by: 'revert' }, history: [ADVANCE_ENTRY, REVERT_ENTRY] } }) });
    expect(opusRow()).toMatchObject({ held: false, candidate: G62 });
    expect(commit(G62).body).toMatchObject({ outcome: 'moved', to: G62 });
  });

  it('a held pin the retire grace has retired ends its hold: the class takes the move an unheld class would', () => {
    const gone = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G61) };
    plantCodex({ registry: ADVANCED_REGISTRY, catalogue: gone, advance: stepAdvance({ opus: {
      hold: { at: '2026-09-09T00:00:00Z', by: 'hand' },
      missing: { model: G61, since: '2026-09-09T18:26:40Z', seen: '2026-09-10T00:26:40Z' } } }) });
    expect(opusRow()).toMatchObject({ held: false, candidate: G56, reason: 'retired' });
    expect(commit(G56, { from: G61 }).body).toMatchObject({ outcome: 'moved', to: G56 });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
    const opus = advOf('lane-a').classes.opus;
    expect(opus.hold).toBeNull();
    expect(opus.history.at(-1)).toMatchObject({ cause: 'retired',
      reason: `the hold ended: ${G61} left the catalogue past its grace` });
  });

  it('a held pin inside the retire grace keeps its hold', () => {
    const gone = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G61) };
    plantCodex({ registry: ADVANCED_REGISTRY, catalogue: gone, advance: stepAdvance({ opus: {
      hold: { at: '2026-09-09T00:00:00Z', by: 'hand' },
      missing: { model: G61, since: '2026-09-09T20:00:00Z', seen: '2026-09-10T00:26:40Z' } } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: null });
  });

  it('a revert hold nothing derives a from for stays held, and the hourly refresh stamps the candidate as its from', () => {
    // An older build's revert hold whose history no longer names what it left: it never ends on a newer model unread.
    plantCodex({ catalogue: WITH_G62, advance: stepAdvance({ opus: { hold: { at: NOW, by: 'revert' } } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G62 });
    expect(commit(G62).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
    const m = op(LATER, 'materialise', '--file', rosterPath(), '--id', 'lane-a', '--refresh', 'true');
    expect(m.code, m.out).toBe(0);
    expect(advOf('lane-a').classes.opus.hold, 'stamped, and not ended on its own pass').toEqual({ at: NOW, by: 'revert', from: G62 });
    expect(opusRow()).toMatchObject({ held: true, candidate: G62 });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
  });

  it('a held pin gone past the grace ends its hold though the model the Revert left is still listed (call 469)', () => {
    // 5.6 (the held pin) has left the catalogue; 6.1, what the Revert left, is listed, so the family rule answers it
    // `newer`, never `retired`: only the grace on the pin ends the hold, and the class takes that move, canary first.
    const gone = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G56) };
    plantCodex({ catalogue: gone, advance: stepAdvance({ opus: { hold: { at: '2026-09-09T00:00:00Z', by: 'revert', from: G61 },
      missing: { model: G56, since: '2026-09-09T18:26:40Z', seen: '2026-09-10T00:26:40Z' } } }) });
    expect(opusRow()).toMatchObject({ held: false, candidate: G61, reason: 'newer' });
    expect(commit(G61).body).toMatchObject({ outcome: 'moved', to: G61 });
    const opus = advOf('lane-a').classes.opus;
    expect(opus.hold).toBeNull();
    expect(opus.history.at(-1)).toMatchObject({ to: G61, reason: `the hold ended: ${G56} left the catalogue past its grace` });
  });

  it('inside the grace the same hold stays held', () => {
    const gone = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== G56) };
    plantCodex({ catalogue: gone, advance: stepAdvance({ opus: { hold: { at: '2026-09-09T00:00:00Z', by: 'revert', from: G61 },
      missing: { model: G56, since: '2026-09-09T20:00:00Z', seen: '2026-09-10T00:26:40Z' } } }) });
    expect(opusRow()).toMatchObject({ held: true, candidate: G61 });
    expect(commit(G61).body).toMatchObject({ outcome: 'abandoned', why: 'held' });
  });

  it('the commit that ends a hold writes an intent carrying endsHold, then ONE write with the move and the hold cleared', () => {
    revertedCodex(WITH_G62);
    const writes = commitLogged(G62);
    const intents = writes.filter((w) => w.pending !== null);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.pending).toMatchObject({ class: 'opus', from: G56, to: G62, endsHold: true });
    expect(intents[0]!.classes.opus.hold, 'the intent lands before the move: the hold still stands').not.toBeNull();
    const last = writes.at(-1)!;
    expect(last.pending).toBeNull();
    expect(last.classes.opus.history.at(-1)).toMatchObject({ how: 'advance', from: G56, to: G62, ok: true });
    expect(last.classes.opus.hold, 'the write that records the move clears the hold').toBeNull();
    const withMove = writes.filter((w) => w.classes.opus.history.some((e) => e.to === G62 && e.ok === true));
    expect(withMove, 'no write records the move with the hold still standing').toEqual([last]);
  });

  it('a failed canary on an ending hold records the failure and keeps the hold', () => {
    revertedCodex(WITH_G62);
    expect(commit(G62, { canary: 'failed' }).body).toMatchObject({ outcome: 'failed', push: true });
    const opus = advOf('lane-a').classes.opus;
    expect(opus.hold).toMatchObject({ by: 'revert', from: G61 });
    expect(opus.history.at(-1)).toMatchObject({ how: 'advance', from: G56, to: G62, ok: false, canary: 'failed' });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
  });

  it('a failed move after a passed canary restores the registry and keeps the hold', () => {
    revertedCodex(WITH_G62);
    // The lane's settings file is made a directory, so the move's materialise fails and the previous registry comes back.
    const settings = path.join(home, '.claude-lane-a', 'settings.json');
    fs.rmSync(settings, { force: true });
    fs.mkdirSync(settings);
    const r = commit(G62);
    expect(r.body).toMatchObject({ outcome: 'failed' });
    expect(pinsOf('lane-a')['opus']).toBe(G56);
    expect(advOf('lane-a').classes.opus.hold).toMatchObject({ by: 'revert', from: G61 });
  });

  it('the op says it ends revert holds by itself, a constant of its answer', () => {
    revertedCodex();
    expect(op(NOW, 'show', '--file', rosterPath(), '--id', 'lane-a').body['revertHoldEnds']).toBe(true);
  });

  it('the server reads that fact, and an answer without it, or with anything but true, as "does not"', async () => {
    revertedCodex();
    const body = op(NOW, 'show', '--file', rosterPath(), '--id', 'lane-a').body;
    const ioOf = (b: Record<string, unknown>): FleetIO =>
      ({ models: async () => ({ kind: 'exited', code: 0, stdout: `${JSON.stringify(b)}\n` }) }) as unknown as FleetIO;
    expect(await readLaneModels(ioOf(body), '', 'lane-a', { fresh: true })).toMatchObject({ kind: 'read', revertHoldEnds: true });
    for (const v of [undefined, false, 'yes']) {
      const read = await readLaneModels(ioOf({ ...body, revertHoldEnds: v }), '', 'lane-a', { fresh: true });
      expect(read.kind).toBe('read');
      expect(read).not.toHaveProperty('revertHoldEnds');
    }
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

const C4 = '2026-11-17T18:00:00Z';
const T4 = '2026-11-17T20:00:00Z';

const regDir = (): string => path.join(home, 'reg');
const advPath = (): string => path.join(modelsDir(), `${LANE}.advance.json`);
/** The lane's revert hold as a build from before the field wrote it, with no move in the history to derive `from` by. */
function bareRevertHold(): void {
  const adv = advOf(LANE);
  const { from: _from, ...hold } = adv.classes.opus.hold!;
  fs.writeFileSync(advPath(), `${JSON.stringify({ ...adv, classes: { ...adv.classes,
    opus: { ...adv.classes.opus, hold, history: [] } } }, null, 2)}\n`);
}
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

  it('the Revert names the id it left, read from the aliases file', () => {
    revertedAlias();
    expect(advOf(LANE).classes.opus.hold).toEqual({ at: R1, by: 'revert', model: X1, from: X2 });
  });

  it('a re-revert with no aliases row a launch can use keeps what the hold it replaces waited for, unrefused', () => {
    revertedAlias();
    fs.rmSync(path.join(modelsDir(), aliasesFileName(LANE)));
    // The revert over its own hold reads `previous` (X1); the file says nothing about the alias, so it keeps X2 (call 469).
    const r = aliasVerb(T2, 'revert');
    expect(r.code, r.out).toBe(0);
    expect(advOf(LANE).classes.opus.hold).toEqual({ at: T2, by: 'revert', model: X1, from: X2 });
  });

  it('a revert with no aliases row and nothing to derive leaves from out, and the next refresh stamps it', () => {
    revertedAlias();
    bareRevertHold();
    fs.rmSync(path.join(modelsDir(), aliasesFileName(LANE)));
    const r = aliasVerb(T2, 'revert');
    expect(r.code, r.out).toBe(0);
    expect(advOf(LANE).classes.opus.hold).toEqual({ at: T2, by: 'revert', model: X1 });
    plantCache(C3, X2);
    expect(refresh(T3).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold).toEqual({ at: T2, by: 'revert', model: X1, from: X2 });
  });

  it('a revert hold with no from while the alias still names the id it left: held, and stamped with that id', () => {
    revertedAlias();
    bareRevertHold();
    plantCache(C3, X2);
    expect(refresh(T2).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold, 'stamped, not ended on its own pass').toEqual({ at: R1, by: 'revert', model: X1, from: X2 });
    // From then on it ends only on a third id seen after it.
    plantCache(C4, X3);
    expect(refresh(T4).body['moved']).toEqual([{ class: 'opus', from: X1, to: X3 }]);
    expect(advOf(LANE).classes.opus.hold).toBeNull();
  });

  it('a revert hold with no from reads it off the newest move from the held id: the id it left never ends it', () => {
    revertedAlias();
    const adv = advOf(LANE);
    const { from: _from, ...hold } = adv.classes.opus.hold!;
    fs.writeFileSync(advPath(), `${JSON.stringify({ ...adv, classes: { ...adv.classes, opus: { ...adv.classes.opus, hold } } }, null, 2)}\n`);
    plantCache(C3, X2);
    expect(refresh(T2).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.hold, 'derived, so nothing is stamped').toEqual(hold);
    plantCache(C4, X3);
    expect(refresh(T4).body['moved']).toEqual([{ class: 'opus', from: X1, to: X3 }]);
  });

  it('a revert hold ends once the alias names a third id observed after the hold: one move, the hold cleared in that write', () => {
    revertedAlias();
    plantCache(C3, X3);
    const r = refresh(T2);
    expect(r.body['moved']).toEqual([{ class: 'opus', from: X1, to: X3 }]);
    expect(aliasId()).toBe(X3);
    const opus = advOf(LANE).classes.opus;
    expect(opus.hold).toBeNull();
    expect(opus.releasedAt).toBe(T2);
    expect(opus.releasedHold).toBeUndefined();
    expect(opus.previous).toEqual({ model: X1, effort: null });
    expect(opus.history).toHaveLength(2);
    expect(opus.history.at(-1)).toMatchObject({ at: T2, how: 'advance', from: X1, to: X3, ok: true, evidenceAt: C3 });
    // The aliases file this refresh wrote reads as unheld, and the next refresh records nothing twice.
    expect(JSON.parse(fs.readFileSync(path.join(modelsDir(), aliasesFileName(LANE)), 'utf8')).classes.opus.heldRow).toBeNull();
    expect(refresh(T3).body['moved']).toEqual([]);
    expect(advOf(LANE).classes.opus.history).toHaveLength(2);
  });

  it('a refresh cut short after it ended a hold records the move once: the next refresh answers it and appends nothing', () => {
    revertedAlias();
    plantCache(C3, X3);
    // The aliases write of the refresh that ended the hold fails: its file is put back as it was.
    const aliasesPath = path.join(modelsDir(), aliasesFileName(LANE));
    const before = fs.readFileSync(aliasesPath, 'utf8');
    expect(refresh(T2).body['moved']).toEqual([{ class: 'opus', from: X1, to: X3 }]);
    fs.writeFileSync(aliasesPath, before);
    const again = refresh(T3);
    expect(again.body['moved']).toEqual([{ class: 'opus', from: X1, to: X3 }]);
    expect(advOf(LANE).classes.opus.history).toHaveLength(2);
    expect(advOf(LANE).classes.opus.previous).toEqual({ model: X1, effort: null });
  });

  it('a hand hold ends once the alias names another id observed after the hold', () => {
    fs.mkdirSync(regDir(), { recursive: true });
    plantCache(C1, X1);
    expect(refresh(T0).code).toBe(0);
    expect(aliasVerb(T1, 'hold').code).toBe(0);
    plantCache(C3, X2);
    expect(refresh(T2).body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
    expect(advOf(LANE).classes.opus.hold).toBeNull();
  });
});
