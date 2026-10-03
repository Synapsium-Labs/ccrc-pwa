/**
 * `landingVerdict` — the landing lane's DECISIONS, pure (landing-order wave 2, D-3883). The lane in `watch.ts`
 * (`sweepLanding`) keeps the reads and the deliveries; every question "tell whom, tell what, tell at all, is it
 * already told, latch or defer" is answered here from plain data, on the stall watch's precedent
 * (`stall-verdict.test.ts`). `pr-queue-lane.test.ts` pins the same decisions end to end through the watcher; these
 * are the direct cases, one decision each, with no store and no clock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  landingAsk, landingVerdict, renderDequeueBrief, renderMergedBrief,
  type LandingAsk, type LandingFacts, type LandingLine, type LandingStep,
} from '../src/coord/landing.js';
import { dequeuedSubject, mergedSubject } from '../src/coord/rundefs.js';

const ID = 'demo-quiet-basin';
const T1 = '2026-09-23T11:30:00Z';
const COORD = 'ccrc-pwa-coordinator';

const line = (over: Partial<LandingLine> = {}): LandingLine => ({
  sessionId: ID, workspace: 'quiet-basin', number: 42, phase: 'open',
  queue: { state: 'dequeued', at: T1 }, ...over,
});
const ask = (over: Partial<LandingLine> = {}): LandingAsk => {
  const a = landingAsk(line(over), new Set());
  if (a === null) throw new Error('fixture asked for nothing');
  return a;
};
const merged = (): LandingAsk => ask({ phase: 'merged', queue: { state: 'landed', at: T1 } });
const step = (a: LandingAsk, f: LandingFacts): LandingStep => landingVerdict(a, f);

describe('landingAsk — which notice a line asks for, and its latch key', () => {
  it('a dequeued reading asks for the dequeue notice, keyed by PR and removal time', () => {
    expect(landingAsk(line(), new Set())).toEqual({
      notice: 'dequeued', key: `${ID}#42:dequeued@${T1}`, number: 42, at: T1, sessionId: ID, workspace: 'quiet-basin',
    });
  });

  it('a merged phase asks for the merged notice, keyed by PR alone', () => {
    const a = landingAsk(line({ phase: 'merged', queue: { state: 'landed', at: T1 } }), new Set());
    expect(a).toMatchObject({ notice: 'merged', key: `${ID}#42:merged@`, number: 42, at: null });
  });

  it('a dequeue without a well-shaped time keys on the PR alone', () => {
    expect(ask({ queue: { state: 'dequeued', at: null } }).key).toBe(`${ID}#42:dequeued@`);
  });

  it('the dequeue wins over a merged phase — the word that asks for an act decides', () => {
    expect(ask({ phase: 'merged' }).notice).toBe('dequeued');
  });

  it('asks nothing for queued, landed, none, unmeasured, absent, or no queue read, on an open PR', () => {
    for (const state of ['queued', 'landed', 'none', 'unmeasured', 'absent'] as const) {
      expect(landingAsk(line({ queue: { state, at: null } }), new Set()), state).toBeNull();
    }
    expect(landingAsk(line({ queue: undefined }), new Set())).toBeNull();
  });

  it('asks nothing without a PR number', () => {
    expect(landingAsk(line({ number: null }), new Set())).toBeNull();
    expect(landingAsk(line({ number: null, phase: 'merged' }), new Set())).toBeNull();
  });

  it('asks nothing for a key already latched, and a different removal is a different key', () => {
    const a = ask();
    expect(landingAsk(line(), new Set([a.key]))).toBeNull();
    expect(landingAsk(line({ queue: { state: 'dequeued', at: '2026-09-23T12:05:00Z' } }), new Set([a.key]))).not.toBeNull();
  });
});

describe('landingVerdict — a dequeue', () => {
  it('reads the run rows first', () => {
    expect(step(ask(), {})).toEqual({ step: 'runs' });
  });

  it('unreadable run rows DEFER — never "no open run", never a latch', () => {
    expect(step(ask(), { runs: { ok: false, detail: 'fixture' } })).toEqual({ step: 'defer', detail: 'fixture' });
  });

  it('an open run asks for its coordinator, then for the mail-subject proof of "already told"', () => {
    const a = ask();
    const runs: LandingFacts['runs'] = { ok: true, run: { id: 7 } };
    expect(step(a, { runs })).toEqual({ step: 'coordinator', runId: 7 });
    expect(step(a, { runs, coordinator: COORD })).toEqual({
      step: 'toldMail', runId: 7, toId: COORD, subject: dequeuedSubject(42, T1),
    });
  });

  it('open run + coordinator, not yet told: a status mail from the operator AND the feed record', () => {
    const v = step(ask(), { runs: { ok: true, run: { id: 7 } }, coordinator: COORD, told: false });
    expect(v).toEqual({
      step: 'deliver',
      mail: { fromId: 'operator', toId: COORD, runId: 7, kind: 'status',
        subject: dequeuedSubject(42, T1), body: renderDequeueBrief(ID, 42) },
      record: { title: '⤺ dequeued › quiet-basin', runId: 7, tag: `queue-${ID}#42:dequeued@${T1}`,
        recordAlways: true,
        body: `PR #42 left the merge queue without landing (removed ${T1}); GitHub does not re-enqueue it. Mailed coordinator ${COORD}.` },
    });
  });

  it('no open run: the proof of "already told" is the FEED body, and the delivery is the record alone', () => {
    const a = ask();
    const runs: LandingFacts['runs'] = { ok: true, run: null };
    const body = `PR #42 left the merge queue without landing (removed ${T1}); GitHub does not re-enqueue it. `
      + 'No open run names a coordinator to tell.';
    expect(step(a, { runs })).toEqual({ step: 'toldFeed', body });
    const v = step(a, { runs, told: false });
    expect(v).toMatchObject({ step: 'deliver', mail: null, record: { body, runId: null, recordAlways: true } });
  });

  it('an open run whose coordinator does not resolve is the feed-only path too — never a guess', () => {
    const v = step(ask(), { runs: { ok: true, run: { id: 7 } }, coordinator: null });
    expect(v).toMatchObject({ step: 'toldFeed' });
    expect(step(ask(), { runs: { ok: true, run: { id: 7 } }, coordinator: null, told: false }))
      .toMatchObject({ step: 'deliver', mail: null, record: { runId: 7 } });
  });

  it('a notice a durable read found is latched and says nothing — by mail and by feed', () => {
    expect(step(ask(), { runs: { ok: true, run: { id: 7 } }, coordinator: COORD, told: true })).toEqual({ step: 'latch' });
    expect(step(ask(), { runs: { ok: true, run: null }, told: true })).toEqual({ step: 'latch' });
  });

  it('a removal without a time falls back to the subject per PR, and says so in the record', () => {
    const a = ask({ queue: { state: 'dequeued', at: null } });
    const v = step(a, { runs: { ok: true, run: { id: 7 } }, coordinator: COORD, told: false });
    expect(v).toMatchObject({ mail: { subject: dequeuedSubject(42, null) },
      record: { body: `PR #42 left the merge queue without landing; GitHub does not re-enqueue it. Mailed coordinator ${COORD}.` } });
  });
});

describe('landingVerdict — a merge', () => {
  const runs: LandingFacts['runs'] = { ok: true, run: { id: 7 } };

  it('no open run, or a run with no coordinator, is nobody to tell: latch, and no further read', () => {
    expect(step(merged(), { runs: { ok: true, run: null } })).toEqual({ step: 'latch' });
    expect(step(merged(), { runs, coordinator: null })).toEqual({ step: 'latch' });
  });

  it('unreadable run rows defer, and so does an unreadable run state — neither is "not at merging"', () => {
    expect(step(merged(), { runs: { ok: false, detail: 'a' } })).toEqual({ step: 'defer', detail: 'a' });
    expect(step(merged(), { runs, coordinator: COORD, runState: { ok: false, detail: 'b' } }))
      .toEqual({ step: 'defer', detail: 'b' });
  });

  it('asks the run state of the survivor once it has a coordinator', () => {
    expect(step(merged(), { runs, coordinator: COORD })).toEqual({ step: 'runState', runId: 7 });
  });

  it('merging: asks for the mail-subject proof, then mails merged:#<n> and records nothing', () => {
    const f: LandingFacts = { runs, coordinator: COORD, runState: { ok: true, state: 'merging' } };
    expect(step(merged(), f)).toEqual({ step: 'toldMail', runId: 7, toId: COORD, subject: mergedSubject(42) });
    expect(step(merged(), { ...f, told: false })).toEqual({
      step: 'deliver',
      mail: { fromId: 'operator', toId: COORD, runId: 7, kind: 'status',
        subject: mergedSubject(42), body: renderMergedBrief(ID, 42) },
      record: null,
    });
  });

  it('not at merging — any other state, or a run row that is gone — asks for nothing: latch', () => {
    for (const state of ['working', 'awaiting-review', 'planned', null]) {
      expect(step(merged(), { runs, coordinator: COORD, runState: { ok: true, state } }), String(state))
        .toEqual({ step: 'latch' });
    }
  });

  it('already told (durable): latch, say nothing', () => {
    expect(step(merged(), { runs, coordinator: COORD, runState: { ok: true, state: 'merging' }, told: true }))
      .toEqual({ step: 'latch' });
  });
});

describe('the notice bodies', () => {
  it('the dequeue brief reads why from the queue\'s own run, disarms first, re-enqueues at the exact SHA, never --admin', () => {
    const b = renderDequeueBrief(ID, 42);
    expect(b).toContain('`gh pr merge 42 --match-head-commit <handoffCommit>`');
    expect(b.replace('never `--admin`', '')).not.toContain('--admin');
    expect(b).toContain('`gh run list --event merge_group');
    expect(b).toContain('`gh pr merge 42 --disable-auto`');
  });

  it('the merged brief asks for the merge proof', () => {
    expect(renderMergedBrief(ID, 42)).toContain('`gh pr view 42 --json state,headRefOid`');
  });
});

// `stall-vocabulary.test.ts`'s purity pin, for this file's header's claim: the coord-ring scan in
// `single-definition.test.ts` sees only a direct `./db.js` or `node:sqlite` import, so an import of `./rundefs.js`
// (which holds the handle) or of `node:fs` would pass it. This reads the import block itself.
describe('landing.ts is the pure L1 module its docstring says it is', () => {
  const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'landing.ts'), 'utf8');
  /** Comments blanked, positions kept: the header names the things it promises not to use. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  const NODE_BUILTIN = /\bfrom\s*['"]node:/;
  const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]/m;
  const RE_EXPORT = /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\b/m;
  /** The specifier of every import that is not `import type`; the clause holds no quote, so a match cannot run on
   *  into a later import's specifier. */
  const valueImportSpecifiers = (c: string): string[] =>
    [...c.matchAll(/^\s*import\s+(type\s+)?[^'"]*?\bfrom\s*(['"])([^'"]+)\2/gm)]
      .filter((m) => m[1] === undefined).map((m) => m[3]!);

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function landingVerdict');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });
  it('CONTROL: the scans see either quote, a re-export, and a second import behind a first', () => {
    expect(NODE_BUILTIN.test(`import { readFileSync } from "node:fs";`)).toBe(true);
    expect(NODE_BUILTIN.test(`import { readFileSync } from 'node:fs';`)).toBe(true);
    expect(NODE_BUILTIN.test(`import { x } from '../../../shared/api.js';`)).toBe(false);
    expect(SIDE_EFFECT_IMPORT.test(`import "./rundefs.js";`)).toBe(true);
    expect(SIDE_EFFECT_IMPORT.test(`import { x } from './rundefs.js';`)).toBe(false);
    expect(RE_EXPORT.test(`export { survivorOf } from './rundefs.js';`)).toBe(true);
    expect(RE_EXPORT.test(`export const x = 1;`)).toBe(false);
    expect(valueImportSpecifiers(`import { survivorOf } from "./rundefs.js";\nimport { x } from '../../../shared/api.js';`))
      .toEqual(['./rundefs.js', '../../../shared/api.js']);
    expect(valueImportSpecifiers(`import type { A } from './rundefs.js';`)).toEqual([]);
  });
  it('has no clock, no fs and no other node builtin', () => {
    expect(code(), 'landing.ts reads the clock').not.toMatch(/\bDate\s*\.\s*now\s*\(|performance\s*\.\s*now|\bnew\s+Date\b/);
    expect(code(), 'landing.ts imports a node builtin').not.toMatch(NODE_BUILTIN);
    expect(code(), 'landing.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });
  it('has no fastify, no reply, no store, no handle', () => {
    expect(code(), 'landing.ts answers HTTP').not.toMatch(/\breply\s*\.|\bFastify|\bapp\s*\./);
    expect(code(), 'landing.ts reaches the store').not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\.|\bdb\s*\.|\.prepare\s*\(/);
  });
  it('imports values only from shared/api.ts (L0); anything else is a type import', () => {
    const c = code();
    expect(c, 'a side-effect import').not.toMatch(SIDE_EFFECT_IMPORT);
    expect(c, 'a dynamic import').not.toMatch(/\bimport\s*\(/);
    expect(c, 'a re-export').not.toMatch(RE_EXPORT);
    for (const spec of valueImportSpecifiers(c)) {
      expect(spec, `landing.ts takes a value import from ${spec}`).toBe('../../../shared/api.js');
    }
  });
});
