// D-5384 (audit ticket ARCH-21, CCRCP-120): `POST /api/runs`' synchronous
// preconditions — the body shape, the review arm, the home shaping, F1, the
// home verdict and §12 — decided by one pure L1 decider,
// `coord/openRun.ts`'s `openRunPreconditions`, before coordinator-first
// Task 11b adds its own gates as rows here.
//
// THE GATE-ORDER TABLE. Every gate has a row that trips it alone, and every
// adjacent pair of gates that one body can trip together has a row that trips
// BOTH and names the earlier one as the answer. Swapping any such pair in
// `OPEN_RUN_GATES` turns its row red: that is the recorded reorder mutant per
// pair (the PR body's mutation table). Pairs that no single input can trip
// together are listed in `EXCLUSIVE_PAIRS` with the reason, and bridged to the
// next gate instead. Nothing here asserts the order list itself — a swap must
// be caught by what the decider ANSWERS, not by a copy of its spelling.
//
// The bodies copy the committed open-body shape (`home-project-required.test.ts`'s
// OPEN_BODY, `run-routes.test.ts`'s review opens) with neutral ids.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { refuseRun } from '../src/refuse.js';
import { RUN_REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { shapeProgramSlug } from '../../shared/api.js';
import {
  OPEN_RUN_GATES, openRunPreconditions,
  type OpenRunFacts, type OpenRunGate, type ReviewedRunFacts,
} from '../src/coord/openRun.js';

const WORK = {
  program: 'demo-program', title: 'Wave two', project: 'demo',
  wave: 2, waveOf: 3, claimedBy: 'coord-1', homeProject: 'demo',
} as const;
const REVIEW = {
  kind: 'review', reviews: 7, program: 'demo-program', title: 'Review wave two',
  claimedBy: 'coord-1', homeProject: 'demo',
} as const;

const reviewed = (over: Partial<ReviewedRunFacts> = {}): ReviewedRunFacts => ({
  kind: 'work', state: 'awaiting-review', program: 'demo-program', claimedBy: 'coord-1',
  project: 'demo', wave: 2, waveOf: 3, ...over,
});

function facts(body: Record<string, unknown>, over: Partial<OpenRunFacts> = {}): OpenRunFacts {
  return {
    body, legacyAccepted: false,
    reviewed: () => ({ ok: true, run: reviewed() }),
    sessionProject: () => null,
    programKnown: () => false,
    programHome: () => null,
    openClaimantsOf: () => [],
    ...over,
  };
}

const BAD_SLUG = 'a/b';
const BAD_SLUG_DETAIL = ((): string => {
  const s = shapeProgramSlug(BAD_SLUG);
  if (s.ok) throw new Error('fixture: a/b must be a refused slug');
  return s.detail;
})();
const BAD_HOME_DETAIL = 'homeProject must be a single path segment, not "a/b"';

interface Row { name: string; gate: OpenRunGate; f: OpenRunFacts; refusal: Record<string, unknown> }

/** One row per gate, tripping that gate alone. */
const SINGLE: Row[] = [
  { name: 'an unknown kind', gate: 'kind', f: facts({ ...WORK, kind: 'bogus' }),
    refusal: { error: 'bad-request', detail: 'kind must be work or review' } },
  { name: 'an empty title', gate: 'shape', f: facts({ ...WORK, title: '' }),
    refusal: { error: 'bad-request' } },
  { name: 'reviews on a work run', gate: 'reviewsOnWork', f: facts({ ...WORK, reviews: 7 }),
    refusal: { error: 'bad-request', detail: 'reviews is only accepted with kind review' } },
  { name: 'a review naming no run id', gate: 'reviewsId', f: facts({ ...REVIEW, reviews: 0 }),
    refusal: { error: 'bad-request', detail: 'reviews must name the work run under review (a positive run id)' } },
  { name: 'a slug with a separator', gate: 'program', f: facts({ ...WORK, program: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: BAD_SLUG_DETAIL } },
  { name: 'a review naming a sessionId', gate: 'reviewSession', f: facts({ ...REVIEW, sessionId: 'ws-1' }),
    refusal: { error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' } },
  { name: 'an unreadable reviewed run', gate: 'reviewRead',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: false, detail: 'database is locked' }) }),
    refusal: { error: 'run-unreadable', detail: 'database is locked' } },
  { name: 'a reviewed run that does not exist', gate: 'reviewRead',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: null }) }),
    refusal: { error: 'bad-request', detail: 'reviews names no run' } },
  { name: 'a reviewed review run', gate: 'reviewKind',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ kind: 'review' }) }) }),
    refusal: { error: 'bad-request', detail: 'reviews must name a work run, not one of kind review' } },
  { name: 'a reviewed run not at awaiting-review', gate: 'reviewState',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ state: 'dispatched' }) }) }),
    refusal: { error: 'bad-request', detail: 'reviews must name a run at awaiting-review, not dispatched' } },
  { name: 'a review of another programme', gate: 'reviewProgram',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ program: 'other-program' }) }) }),
    refusal: { error: 'bad-request', detail: "program must be the reviewed run's (other-program)" } },
  { name: "a review by another coordinator", gate: 'reviewClaimant',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ claimedBy: 'coord-2' }) }) }),
    refusal: { error: 'bad-request', detail: "claimedBy must be the reviewed run's coordinator" } },
  { name: 'a review naming another project', gate: 'reviewProject', f: facts({ ...REVIEW, project: 'other' }),
    refusal: { error: 'bad-request', detail: "project must be the reviewed run's (demo)" } },
  { name: 'a review naming another wave', gate: 'reviewWave', f: facts({ ...REVIEW, wave: 9 }),
    refusal: { error: 'bad-request', detail: "wave must be the reviewed run's (2)" } },
  { name: 'a review naming another waveOf', gate: 'reviewWaveOf', f: facts({ ...REVIEW, waveOf: 9 }),
    refusal: { error: 'bad-request', detail: "waveOf must be the reviewed run's (3)" } },
  { name: 'a home with a separator', gate: 'homeShape', f: facts({ ...WORK, homeProject: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: BAD_HOME_DETAIL } },
  { name: 'a session bound to another project', gate: 'projectMismatch',
    f: facts({ ...WORK, sessionId: 'ws-1' }, { sessionProject: () => 'elsewhere' }),
    refusal: { refused: 'project-mismatch', by: 'elsewhere' } },
  { name: 'a home that differs from the stored one', gate: 'homeVerdict',
    f: facts({ ...WORK }, { programKnown: () => true, programHome: () => 'other-home' }),
    refusal: { refused: 'home-mismatch', by: 'other-home' } },
  { name: 'no home at all', gate: 'homeVerdict', f: facts({ ...WORK, homeProject: undefined }),
    refusal: { error: 'bad-request', detail: 'homeProject is required' } },
  { name: "a claimant that is somebody else's worker", gate: 'claimantWorker',
    f: facts({ ...WORK }, { openClaimantsOf: () => ['coord-1', 'coord-9', 'coord-8'] }),
    refusal: { refused: 'claimant-is-a-worker', by: 'coord-9' } },
];

/** One row per adjacent order-dependent pair: the body trips both, the
 *  earlier gate answers. The pair is `[earlier, later]`. */
const PAIRS: (Row & { pair: [OpenRunGate, OpenRunGate] })[] = [
  { name: 'unknown kind + empty title', pair: ['kind', 'shape'], gate: 'kind',
    f: facts({ ...WORK, kind: 'bogus', title: '' }),
    refusal: { error: 'bad-request', detail: 'kind must be work or review' } },
  { name: 'empty title + reviews on work', pair: ['shape', 'reviewsOnWork'], gate: 'shape',
    f: facts({ ...WORK, title: '', reviews: 7 }), refusal: { error: 'bad-request' } },
  { name: 'reviews on work + bad slug (bridges the exclusive reviews-on-work/reviews-id pair)',
    pair: ['reviewsOnWork', 'program'], gate: 'reviewsOnWork',
    f: facts({ ...WORK, reviews: 7, program: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: 'reviews is only accepted with kind review' } },
  { name: 'no review id + bad slug', pair: ['reviewsId', 'program'], gate: 'reviewsId',
    f: facts({ ...REVIEW, reviews: 0, program: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: 'reviews must name the work run under review (a positive run id)' } },
  { name: 'bad slug + sessionId on a review', pair: ['program', 'reviewSession'], gate: 'program',
    f: facts({ ...REVIEW, program: BAD_SLUG, sessionId: 'ws-1' }),
    refusal: { error: 'bad-request', detail: BAD_SLUG_DETAIL } },
  { name: 'sessionId on a review + unreadable target', pair: ['reviewSession', 'reviewRead'], gate: 'reviewSession',
    f: facts({ ...REVIEW, sessionId: 'ws-1' }, { reviewed: () => ({ ok: false, detail: 'database is locked' }) }),
    refusal: { error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' } },
  { name: 'missing target (the kind gate reads the target the read gate loads)',
    pair: ['reviewRead', 'reviewKind'], gate: 'reviewRead',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: null }) }),
    refusal: { error: 'bad-request', detail: 'reviews names no run' } },
  { name: 'target of kind review + not awaiting-review', pair: ['reviewKind', 'reviewState'], gate: 'reviewKind',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ kind: 'review', state: 'dispatched' }) }) }),
    refusal: { error: 'bad-request', detail: 'reviews must name a work run, not one of kind review' } },
  { name: 'not awaiting-review + another programme', pair: ['reviewState', 'reviewProgram'], gate: 'reviewState',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ state: 'dispatched', program: 'other-program' }) }) }),
    refusal: { error: 'bad-request', detail: 'reviews must name a run at awaiting-review, not dispatched' } },
  { name: 'another programme + another coordinator', pair: ['reviewProgram', 'reviewClaimant'], gate: 'reviewProgram',
    f: facts({ ...REVIEW }, { reviewed: () => ({ ok: true, run: reviewed({ program: 'other-program', claimedBy: 'coord-2' }) }) }),
    refusal: { error: 'bad-request', detail: "program must be the reviewed run's (other-program)" } },
  { name: 'another coordinator + another project', pair: ['reviewClaimant', 'reviewProject'], gate: 'reviewClaimant',
    f: facts({ ...REVIEW, project: 'other' }, { reviewed: () => ({ ok: true, run: reviewed({ claimedBy: 'coord-2' }) }) }),
    refusal: { error: 'bad-request', detail: "claimedBy must be the reviewed run's coordinator" } },
  { name: 'another project + another wave', pair: ['reviewProject', 'reviewWave'], gate: 'reviewProject',
    f: facts({ ...REVIEW, project: 'other', wave: 9 }),
    refusal: { error: 'bad-request', detail: "project must be the reviewed run's (demo)" } },
  { name: 'another wave + another waveOf', pair: ['reviewWave', 'reviewWaveOf'], gate: 'reviewWave',
    f: facts({ ...REVIEW, wave: 9, waveOf: 9 }),
    refusal: { error: 'bad-request', detail: "wave must be the reviewed run's (2)" } },
  { name: 'another waveOf + bad home', pair: ['reviewWaveOf', 'homeShape'], gate: 'reviewWaveOf',
    f: facts({ ...REVIEW, waveOf: 9, homeProject: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: "waveOf must be the reviewed run's (3)" } },
  { name: 'bad home + session bound elsewhere', pair: ['homeShape', 'projectMismatch'], gate: 'homeShape',
    f: facts({ ...WORK, homeProject: BAD_SLUG, sessionId: 'ws-1' }, { sessionProject: () => 'elsewhere' }),
    refusal: { error: 'bad-request', detail: BAD_HOME_DETAIL } },
  { name: 'session bound elsewhere + differing home', pair: ['projectMismatch', 'homeVerdict'], gate: 'projectMismatch',
    f: facts({ ...WORK, sessionId: 'ws-1' }, { sessionProject: () => 'elsewhere', programKnown: () => true, programHome: () => 'other-home' }),
    refusal: { refused: 'project-mismatch', by: 'elsewhere' } },
  { name: 'differing home + claimant a worker', pair: ['homeVerdict', 'claimantWorker'], gate: 'homeVerdict',
    f: facts({ ...WORK }, { programKnown: () => true, programHome: () => 'other-home', openClaimantsOf: () => ['coord-9'] }),
    refusal: { refused: 'home-mismatch', by: 'other-home' } },
  { name: 'no home + claimant a worker', pair: ['homeVerdict', 'claimantWorker'], gate: 'homeVerdict',
    f: facts({ ...WORK, homeProject: undefined }, { openClaimantsOf: () => ['coord-9'] }),
    refusal: { error: 'bad-request', detail: 'homeProject is required' } },
];

/** Adjacent pairs no single input trips together, and why. Each is bridged by
 *  a PAIRS row to the next gate the earlier one can meet. */
const EXCLUSIVE_PAIRS: { pair: [OpenRunGate, OpenRunGate]; why: string }[] = [
  { pair: ['reviewsOnWork', 'reviewsId'], why: 'the first trips only a work run, the second only a review run' },
];

describe('openRunPreconditions — one row per gate (D-5384)', () => {
  it('covers every gate in OPEN_RUN_GATES with a single-gate row, and names no other', () => {
    const names = OPEN_RUN_GATES.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect([...new Set(SINGLE.map((r) => r.gate))].sort()).toEqual([...names].sort());
  });

  for (const r of SINGLE) {
    it(`${r.gate}: ${r.name}`, () => {
      expect(openRunPreconditions(r.f)).toStrictEqual({ ok: false, refusal: { gate: r.gate, ...r.refusal } });
    });
  }
});

describe('openRunPreconditions — the gate-order table (D-5384)', () => {
  for (const r of PAIRS) {
    it(`${r.pair[0]} before ${r.pair[1]}: ${r.name}`, () => {
      expect(openRunPreconditions(r.f)).toStrictEqual({ ok: false, refusal: { gate: r.gate, ...r.refusal } });
    });
  }

  it('every adjacent pair in OPEN_RUN_GATES is a table row or a stated exclusive pair', () => {
    const names = OPEN_RUN_GATES.map(([n]) => n);
    const covered = new Set([...PAIRS, ...EXCLUSIVE_PAIRS].map((p) => p.pair.join('>')));
    const missing: string[] = [];
    for (let i = 0; i + 1 < names.length; i++) {
      const k = `${names[i]}>${names[i + 1]}`;
      if (!covered.has(k)) missing.push(k);
    }
    expect(missing).toEqual([]);
  });
});

describe('openRunPreconditions — the admitted opens (D-5384)', () => {
  it('a work open: its plan is the body\'s, the slug shaped, the home trimmed, the verdict a first write', () => {
    const v = openRunPreconditions(facts({ ...WORK, program: ' demo-program ', homeProject: ' demo ', sessionId: 'ws-1' }));
    expect(v).toStrictEqual({
      ok: true, home: { kind: 'write' },
      open: {
        program: 'demo-program', title: 'Wave two', project: 'demo', wave: 2, waveOf: 3,
        claimedBy: 'coord-1', kind: 'work', reviews: null, homeProject: 'demo', sessionId: 'ws-1',
      },
    });
  });

  it('a review open takes project, wave and waveOf off the reviewed run, never the body', () => {
    const v = openRunPreconditions(facts({ ...REVIEW, waveOf: null },
      { reviewed: () => ({ ok: true, run: reviewed({ project: 'demo-2', wave: 4, waveOf: null }) }) }));
    expect(v).toStrictEqual({
      ok: true, home: { kind: 'write' },
      open: {
        program: 'demo-program', title: 'Review wave two', project: 'demo-2', wave: 4, waveOf: null,
        claimedBy: 'coord-1', kind: 'review', reviews: 7, homeProject: 'demo',
      },
    });
  });

  it('a known programme with a NULL home is a backfill; a matching one agrees; the legacy branch stays reachable', () => {
    expect(openRunPreconditions(facts({ ...WORK }, { programKnown: () => true, programHome: () => null })))
      .toMatchObject({ ok: true, home: { kind: 'backfill', home: 'demo' } });
    expect(openRunPreconditions(facts({ ...WORK }, { programKnown: () => true, programHome: () => 'demo' })))
      .toMatchObject({ ok: true, home: { kind: 'agrees' } });
    expect(openRunPreconditions({ ...facts({ ...WORK, homeProject: undefined }), legacyAccepted: true }))
      .toMatchObject({ ok: true, home: { kind: 'legacy' }, open: { program: 'demo-program' } });
  });

  it('a self-claimed run and an absent waveOf are admitted', () => {
    const v = openRunPreconditions(facts({ ...WORK, waveOf: undefined }, { openClaimantsOf: () => ['coord-1'] }));
    expect(v).toMatchObject({ ok: true, open: { waveOf: null } });
  });
});

describe('openRunPreconditions reads its facts lazily, in gate order (D-5384)', () => {
  it('a malformed body reads nothing; a work open never reads a reviewed run', () => {
    const spies = {
      reviewed: vi.fn(() => ({ ok: true as const, run: reviewed() })),
      sessionProject: vi.fn(() => null), programKnown: vi.fn(() => false),
      programHome: vi.fn(() => null), openClaimantsOf: vi.fn(() => [] as string[]),
    };
    openRunPreconditions(facts({ ...WORK, title: '' }, spies));
    for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled();
    openRunPreconditions(facts({ ...WORK }, spies));
    expect(spies.reviewed).not.toHaveBeenCalled();
    expect(spies.sessionProject).not.toHaveBeenCalled();   // no sessionId, no F1 read
    expect(spies.programHome).not.toHaveBeenCalled();      // an unknown programme has no stored home to ask for
    expect(spies.openClaimantsOf).toHaveBeenCalledWith('coord-1');
  });
});

describe('the route answers the decider\'s refusals with the inline sends\' exact bytes (D-5384)', () => {
  const TOKEN = 'f'.repeat(64);
  const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });
  const openApp = async (): Promise<FastifyInstance> => {
    const home = mkTmp('ccrc-open-run-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return buildServer({ ...testDeps(home, runner), mailToken: TOKEN, coord });
  };
  const post = (a: FastifyInstance, body: Record<string, unknown>) => a.inject({
    method: 'POST', url: '/api/runs', headers: { 'x-ccrc-mail-token': TOKEN }, payload: body,
  });

  it('a bare shape refusal, a detailed one, a 503 read and a 409 conflict — status and body bytes, key order included', async () => {
    app = await openApp();
    const bare = await post(app, { ...WORK, title: '' });
    expect([bare.statusCode, bare.body]).toEqual([400, '{"ok":false,"error":"bad-request"}']);
    const required = await post(app, { ...WORK, homeProject: undefined });
    expect([required.statusCode, required.body])
      .toEqual([400, '{"ok":false,"error":"bad-request","detail":"homeProject is required"}']);
    const none = await post(app, { ...REVIEW });
    expect([none.statusCode, none.body])
      .toEqual([400, '{"ok":false,"error":"bad-request","detail":"reviews names no run"}']);
    const first = await post(app, { ...WORK });
    expect(first.statusCode).toBe(200);
    const mismatch = await post(app, { ...WORK, wave: 3, homeProject: 'other-home' });
    expect([mismatch.statusCode, mismatch.body]).toEqual([409, '{"ok":false,"refused":"home-mismatch","by":"demo"}']);
  });
});

describe('refuseRun (D-5384)', () => {
  it('answers RUN_REFUSAL_STATUS with `{ ok, refused, ...extra }` in that key order', () => {
    const sent: { code?: number; body?: unknown } = {};
    const reply = {
      code(n: number) { sent.code = n; return reply; },
      send(b: unknown) { sent.body = b; return reply; },
    } as unknown as FastifyReply;
    refuseRun(reply, 'claimant-is-a-worker', { by: 'coord-9' });
    expect(sent.code).toBe(409);
    expect(JSON.stringify(sent.body)).toBe('{"ok":false,"refused":"claimant-is-a-worker","by":"coord-9"}');
    for (const code of Object.keys(RUN_REFUSAL_STATUS)) expect(RUN_REFUSAL_STATUS[code as keyof typeof RUN_REFUSAL_STATUS]).toBe(409);
    // @ts-expect-error — 'unknown-item' is a RunRefuseCode the open route never answers in `refused`
    refuseRun(reply, 'unknown-item');
    // @ts-expect-error — an extra may not overwrite the code
    refuseRun(reply, 'home-mismatch', { refused: 'project-mismatch' });
  });
});
