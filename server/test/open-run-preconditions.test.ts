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
import { mkdirSync, writeFileSync } from 'node:fs';
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
  wave: 2, waveOf: 3, claimedBy: 'coord-1', claimedByUuid: 'u-coord-1', homeProject: 'demo',
} as const;
const REVIEW = {
  kind: 'review', reviews: 7, program: 'demo-program', title: 'Review wave two',
  claimedBy: 'coord-1', claimedByUuid: 'u-coord-1', homeProject: 'demo',
} as const;
const STALE = { ok: false as const, error: 'stale-uuid' as const, detail: 'claimedByUuid does not match the registry — stale sender; re-read your own .uuid' };
const NO_PROJECT_DETAIL = "the claimant's registry row records no project, so its project cannot be stamped";
const CROSSING_DETAIL = "ws-1 is an existing session of demo and the claimant is of demo-home — a crossing wave opens without sessionId and spawns fresh";
const NOT_A_CHILD_DETAIL = 'ws-1 is a registry row with no child marker — a session the operator created is never bound as a child';

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
    fleetCarriesAttribution: true,
    attribute: async () => ({ ok: true }),
    claimantListed: async () => ({ ok: true }),
    claimantProject: async () => ({ kind: 'measured', project: 'demo' }),
    sessionMark: async () => ({ kind: 'absent' }),
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
/** Path identity (spec §2.3): the three id gates' refusals, and ids ccd could read as a flag. */
const BAD_CLAIMANT = { error: 'bad-session-id', detail: 'claimedBy is not a registry id' } as const;
const BAD_SESSION_ID = { error: 'bad-session-id', detail: 'sessionId is not a registry id' } as const;
const BAD_PROJECT = { error: 'bad-request', detail: 'project must not begin with - or .' } as const;

interface Row { name: string; gate: OpenRunGate; f: OpenRunFacts; refusal: Record<string, unknown> }

/** One row per gate, tripping that gate alone. */
const SINGLE: Row[] = [
  { name: 'an unknown kind', gate: 'kind', f: facts({ ...WORK, kind: 'bogus' }),
    refusal: { error: 'bad-request', detail: 'kind must be work or review' } },
  { name: 'an empty title', gate: 'shape', f: facts({ ...WORK, title: '' }),
    refusal: { error: 'bad-request' } },
  { name: 'a claimedBy ccd could read as a flag', gate: 'claimedById', f: facts({ ...WORK, claimedBy: '-coord' }),
    refusal: BAD_CLAIMANT },
  { name: 'a sessionId ccd could read as a flag', gate: 'sessionIdId', f: facts({ ...WORK, sessionId: '-ws' }),
    refusal: BAD_SESSION_ID },
  { name: 'a work project that begins with a dash', gate: 'projectFlag', f: facts({ ...WORK, project: '-demo' }),
    refusal: BAD_PROJECT },
  { name: 'reviews on a work run', gate: 'reviewsOnWork', f: facts({ ...WORK, reviews: 7 }),
    refusal: { error: 'bad-request', detail: 'reviews is only accepted with kind review' } },
  { name: 'a review naming no run id', gate: 'reviewsId', f: facts({ ...REVIEW, reviews: 0 }),
    refusal: { error: 'bad-request', detail: 'reviews must name the work run under review (a positive run id)' } },
  { name: 'a slug with a separator', gate: 'program', f: facts({ ...WORK, program: BAD_SLUG }),
    refusal: { error: 'bad-request', detail: BAD_SLUG_DETAIL } },
  { name: 'a review naming a sessionId', gate: 'reviewSession', f: facts({ ...REVIEW, sessionId: 'ws-1' }),
    refusal: { error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' } },
  { name: 'no claimedByUuid once the fleet carries the client', gate: 'attribution', f: facts({ ...WORK, claimedByUuid: undefined }),
    refusal: { refused: 'attribution-required', detail: "upgrade the fleet box's ccrc-api (ccrc rollout)" } },
  { name: 'an unattributed claimant that is not a listed registry row, before the switch-over', gate: 'attribution',
    f: facts({ ...WORK, claimedByUuid: undefined }, { fleetCarriesAttribution: false,
      claimantListed: async () => ({ ok: false, error: 'unknown-sender', detail: 'no registry row for coord-1' }) }),
    refusal: { error: 'unknown-sender', detail: 'no registry row for coord-1' } },
  { name: 'a stale claimedByUuid', gate: 'attribution', f: facts({ ...WORK }, { attribute: async () => STALE }),
    refusal: { error: 'stale-uuid', detail: STALE.detail } },
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
  { name: 'a claimant whose row records no project', gate: 'claimantProject',
    f: facts({ ...WORK }, { claimantProject: async () => ({ kind: 'none' }) }),
    refusal: { refused: 'project-mismatch', detail: NO_PROJECT_DETAIL } },
  { name: "a claimant whose project field is unreadable", gate: 'claimantProject',
    f: facts({ ...WORK }, { claimantProject: async () => ({ kind: 'unreadable' }) }),
    refusal: { error: 'registry-unmeasurable', detail: "the claimant's registry project could not be read — transient, not a fact about the claimant" } },
  { name: 'a sessionId naming a row with no child marker', gate: 'notAChild',
    f: facts({ ...WORK, sessionId: 'ws-1' }, { sessionMark: async () => ({ kind: 'root' }) }),
    refusal: { refused: 'not-a-child', detail: NOT_A_CHILD_DETAIL } },
  { name: 'a sessionId listed but unbuilt', gate: 'notAChild',
    f: facts({ ...WORK, sessionId: 'ws-1' }, { sessionMark: async () => ({ kind: 'unbuilt' }) }),
    refusal: { error: 'registry-unmeasurable', detail: 'registry row for ws-1 is listed but unreadable — transient, not a fact about the session' } },
  { name: "a crossing coordinator binding an existing child of the run's project", gate: 'crossingSession',
    f: facts({ ...WORK, homeProject: 'demo-home', sessionId: 'ws-1' }, {
      claimantProject: async () => ({ kind: 'measured', project: 'demo-home' }), sessionMark: async () => ({ kind: 'child' }) }),
    refusal: { refused: 'project-mismatch', by: 'demo-home', detail: CROSSING_DETAIL } },
];

/** One row per adjacent order-dependent pair: the body trips both, the
 *  earlier gate answers. The pair is `[earlier, later]`. */
const PAIRS: (Row & { pair: [OpenRunGate, OpenRunGate] })[] = [
  { name: 'unknown kind + empty title', pair: ['kind', 'shape'], gate: 'kind',
    f: facts({ ...WORK, kind: 'bogus', title: '' }),
    refusal: { error: 'bad-request', detail: 'kind must be work or review' } },
  { name: 'empty title + reviews on work', pair: ['shape', 'reviewsOnWork'], gate: 'shape',
    f: facts({ ...WORK, title: '', reviews: 7 }), refusal: { error: 'bad-request' } },
  { name: 'empty title + a dash-led claimedBy', pair: ['shape', 'claimedById'], gate: 'shape',
    f: facts({ ...WORK, title: '', claimedBy: '-coord' }), refusal: { error: 'bad-request' } },
  { name: 'a dash-led claimedBy + a dash-led sessionId', pair: ['claimedById', 'sessionIdId'], gate: 'claimedById',
    f: facts({ ...WORK, claimedBy: '-coord', sessionId: '-ws' }), refusal: BAD_CLAIMANT },
  { name: 'a dash-led sessionId + a dash-led project', pair: ['sessionIdId', 'projectFlag'], gate: 'sessionIdId',
    f: facts({ ...WORK, sessionId: '-ws', project: '-demo' }), refusal: BAD_SESSION_ID },
  { name: 'a dash-led project + reviews on work', pair: ['projectFlag', 'reviewsOnWork'], gate: 'projectFlag',
    f: facts({ ...WORK, project: '-demo', reviews: 7 }), refusal: BAD_PROJECT },
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
  { name: 'sessionId on a review + a stale uuid', pair: ['reviewSession', 'attribution'], gate: 'reviewSession',
    f: facts({ ...REVIEW, sessionId: 'ws-1' }, { attribute: async () => STALE }),
    refusal: { error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' } },
  { name: 'a stale uuid + unreadable target (who asks is decided before the store answers)',
    pair: ['attribution', 'reviewRead'], gate: 'attribution',
    f: facts({ ...REVIEW }, { attribute: async () => STALE, reviewed: () => ({ ok: false, detail: 'database is locked' }) }),
    refusal: { error: 'stale-uuid', detail: STALE.detail } },
  { name: 'no uuid once upgraded + unreadable target', pair: ['attribution', 'reviewRead'], gate: 'attribution',
    f: facts({ ...REVIEW, claimedByUuid: undefined }, { reviewed: () => ({ ok: false, detail: 'database is locked' }) }),
    refusal: { refused: 'attribution-required', detail: "upgrade the fleet box's ccrc-api (ccrc rollout)" } },
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
  // D-5523: a claimant of another project no longer trips `claimantProject`,
  // so its two order rows trip it with the one measured refusal it keeps — a
  // row that records no project.
  { name: 'claimant a worker + claimant row with no project', pair: ['claimantWorker', 'claimantProject'], gate: 'claimantWorker',
    f: facts({ ...WORK }, { openClaimantsOf: () => ['coord-9'], claimantProject: async () => ({ kind: 'none' }) }),
    refusal: { refused: 'claimant-is-a-worker', by: 'coord-9' } },
  { name: 'claimant row with no project + a root named as the child', pair: ['claimantProject', 'notAChild'], gate: 'claimantProject',
    f: facts({ ...WORK, sessionId: 'ws-1' }, {
      claimantProject: async () => ({ kind: 'none' }), sessionMark: async () => ({ kind: 'root' }) }),
    refusal: { refused: 'project-mismatch', detail: NO_PROJECT_DETAIL } },
];

/** Adjacent pairs no single input trips together, and why. Each is bridged by
 *  a PAIRS row to the next gate the earlier one can meet. */
const EXCLUSIVE_PAIRS: { pair: [OpenRunGate, OpenRunGate]; why: string }[] = [
  { pair: ['reviewsOnWork', 'reviewsId'], why: 'the first trips only a work run, the second only a review run' },
  { pair: ['notAChild', 'crossingSession'], why: 'the first trips only a root or an unbuilt row, the second only a child row' },
];

describe('openRunPreconditions — one row per gate (D-5384)', () => {
  it('covers every gate in OPEN_RUN_GATES with a single-gate row, and names no other', async () => {
    const names = OPEN_RUN_GATES.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect([...new Set(SINGLE.map((r) => r.gate))].sort()).toEqual([...names].sort());
  });

  for (const r of SINGLE) {
    it(`${r.gate}: ${r.name}`, async () => {
      expect(await openRunPreconditions(r.f)).toStrictEqual({ ok: false, refusal: { gate: r.gate, ...r.refusal } });
    });
  }
});

describe('openRunPreconditions — the gate-order table (D-5384)', () => {
  for (const r of PAIRS) {
    it(`${r.pair[0]} before ${r.pair[1]}: ${r.name}`, async () => {
      expect(await openRunPreconditions(r.f)).toStrictEqual({ ok: false, refusal: { gate: r.gate, ...r.refusal } });
    });
  }

  it('every adjacent pair in OPEN_RUN_GATES is a table row or a stated exclusive pair', async () => {
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

/** The shape gate, clause by clause: each row breaks ONE clause of the body
 *  shape and nothing else, so dropping any clause turns its row red (the PR
 *  body's V-rows). Every answer is the bare `bad-request`, no `detail` key. */
const SHAPE_CLAUSES: { name: string; body: Record<string, unknown> }[] = [
  { name: 'a non-string program', body: { ...WORK, program: 5 } },
  { name: 'a whitespace-only title', body: { ...WORK, title: ' ' } },
  { name: 'a whitespace-only project on a work run', body: { ...WORK, project: ' ' } },
  { name: 'a non-string project on a review run', body: { ...REVIEW, project: 7 } },
  { name: 'a whitespace-only claimedBy', body: { ...WORK, claimedBy: ' ' } },
  { name: 'a string wave on a work run', body: { ...WORK, wave: '2' } },
  { name: 'a string wave on a review run', body: { ...REVIEW, wave: '2' } },
  { name: 'a string waveOf', body: { ...WORK, waveOf: '3' } },
  { name: 'a numeric sessionId', body: { ...WORK, sessionId: 4 } },
  { name: 'an empty sessionId', body: { ...WORK, sessionId: '' } },
  { name: 'a whitespace-only sessionId', body: { ...WORK, sessionId: ' ' } },
  { name: 'a numeric homeProject', body: { ...WORK, homeProject: 5 } },
  { name: 'a numeric claimedByUuid', body: { ...WORK, claimedByUuid: 5 } },
  { name: 'an empty claimedByUuid', body: { ...WORK, claimedByUuid: '' } },
  { name: 'a whitespace-only claimedByUuid', body: { ...WORK, claimedByUuid: ' ' } },
];

/** A programme's waves may run in ANY project (the cross-repo ruling,
 *  2026-08-11), and since the operator's ruling of 2026-10-18 (D-5523, #601)
 *  its coordinator may sit in ANY project too: the claimant's own project is
 *  stamped, never compared with the run's or the home. What still holds is
 *  who the claimant is (attribution, Task 11b's D-5298) and what it may bind: a
 *  crossing binds only a fresh spawn (D-5388's `crossingSession`) and F1 still
 *  refuses a session another project's history owns. */
describe('openRunPreconditions — a claimant may coordinate from any project (D-5523)', () => {
  // The coordinator sits in `demo-a`; the programme's home and its runs are in
  // `demo-b`, a programme it has already been running (stored home).
  const IN_A = { claimantProject: async () => ({ kind: 'measured' as const, project: 'demo-a' }) };
  const KNOWN_B = { programKnown: () => true, programHome: () => 'demo-b' };
  const WORK_B = { ...WORK, project: 'demo-b', homeProject: 'demo-b', wave: 11 };
  const REVIEW_B = { ...REVIEW, homeProject: 'demo-b' };
  const REVIEWED_B = { reviewed: () => ({ ok: true as const, run: reviewed({ project: 'demo-b', wave: 11 }) }) };

  it('admits the next wave\'s work run of a programme homed elsewhere, stamping the claimant\'s own project', async () => {
    expect(await openRunPreconditions(facts(WORK_B, { ...IN_A, ...KNOWN_B })))
      .toMatchObject({ ok: true, home: { kind: 'agrees' }, open: { kind: 'work', project: 'demo-b', wave: 11, coordProject: 'demo-a' } });
  });
  it('admits a review run of a run it claims, in the reviewed run\'s project', async () => {
    expect(await openRunPreconditions(facts(REVIEW_B, { ...IN_A, ...KNOWN_B, ...REVIEWED_B })))
      .toMatchObject({ ok: true, open: { kind: 'review', reviews: 7, project: 'demo-b', coordProject: 'demo-a' } });
  });
  it('admits a NEW programme homed in another project (any project, the ruling)', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, wave: 1 }, IN_A)))
      .toMatchObject({ ok: true, home: { kind: 'write' }, open: { project: 'demo-b', homeProject: 'demo-b', coordProject: 'demo-a' } });
  });
  it('admits a run in a third project, neither the claimant\'s nor the home', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, project: 'demo-c' }, { ...IN_A, ...KNOWN_B })))
      .toMatchObject({ ok: true, open: { project: 'demo-c', coordProject: 'demo-a' } });
  });
  it('admits an existing programme as it stands: a legacy open, a NULL stored home (backfill), no home anywhere', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, homeProject: undefined }, { ...IN_A, ...KNOWN_B, legacyAccepted: true })))
      .toMatchObject({ ok: true, home: { kind: 'legacy' }, open: { coordProject: 'demo-a' } });
    expect(await openRunPreconditions(facts(WORK_B, { ...IN_A, programKnown: () => true, programHome: () => null })))
      .toMatchObject({ ok: true, home: { kind: 'backfill', home: 'demo-b' } });
    expect(await openRunPreconditions(facts({ ...WORK_B, homeProject: undefined }, { ...IN_A, legacyAccepted: true })))
      .toMatchObject({ ok: true, open: { coordProject: 'demo-a' } });
  });
  it('admits the claimant of the HOME opening elsewhere, as D-5388 did', async () => {
    expect(await openRunPreconditions(facts({ ...WORK, homeProject: 'demo-home' },
      { claimantProject: async () => ({ kind: 'measured', project: 'demo-home' }) })))
      .toMatchObject({ ok: true, open: { project: 'demo', coordProject: 'demo-home' } });
  });
  it('admits a cross-project open naming a sessionId that is not yet a registry row (the dispatch before ws-add)', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, sessionId: 'ws-1' }, { ...IN_A, ...KNOWN_B })))
      .toMatchObject({ ok: true, open: { sessionId: 'ws-1', coordProject: 'demo-a' } });
  });
  it("admits the run project's own claimant binding an existing child", async () => {
    expect(await openRunPreconditions(facts({ ...WORK, sessionId: 'ws-1' }, { sessionMark: async () => ({ kind: 'child' }) })))
      .toMatchObject({ ok: true, open: { sessionId: 'ws-1', coordProject: 'demo' } });
  });

  // (2) ATTRIBUTION UNCHANGED (Task 11b, D-5298): the cross-project claimant proves it is the claimant.
  it('still refuses a cross-project claimant with a mismatched claimedByUuid, before any store read', async () => {
    const programKnown = vi.fn(() => true);
    expect(await openRunPreconditions(facts(WORK_B, { ...IN_A, programKnown, attribute: async () => STALE })))
      .toStrictEqual({ ok: false, refusal: { gate: 'attribution', error: 'stale-uuid', detail: STALE.detail } });
    expect(programKnown).not.toHaveBeenCalled();
  });
  it('still refuses a cross-project claimant with no claimedByUuid once the fleet carries the client', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, claimedByUuid: undefined }, { ...IN_A, ...KNOWN_B })))
      .toStrictEqual({ ok: false, refusal: { gate: 'attribution', refused: 'attribution-required', detail: "upgrade the fleet box's ccrc-api (ccrc rollout)" } });
  });

  // (3) BINDING UNCHANGED (D-5388, F1).
  it("still refuses a cross-project claimant naming an EXISTING child of the run's project: a crossing spawns fresh", async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, sessionId: 'ws-1' }, { ...IN_A, ...KNOWN_B, sessionMark: async () => ({ kind: 'child' }) })))
      .toStrictEqual({ ok: false, refusal: { gate: 'crossingSession', refused: 'project-mismatch', by: 'demo-a',
        detail: 'ws-1 is an existing session of demo-b and the claimant is of demo-a — a crossing wave opens without sessionId and spawns fresh' } });
  });
  it("still refuses naming a session another project's history owns (F1)", async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, sessionId: 'ws-1' }, { ...IN_A, ...KNOWN_B, sessionProject: () => 'demo-a' })))
      .toStrictEqual({ ok: false, refusal: { gate: 'projectMismatch', refused: 'project-mismatch', by: 'demo-a' } });
  });
  it('still refuses an operator-created session named as the child', async () => {
    expect(await openRunPreconditions(facts({ ...WORK_B, sessionId: 'ws-1' }, { ...IN_A, ...KNOWN_B, sessionMark: async () => ({ kind: 'root' }) })))
      .toStrictEqual({ ok: false, refusal: { gate: 'notAChild', refused: 'not-a-child', detail: NOT_A_CHILD_DETAIL } });
  });
  it('the crossing gate compares the body project UNTRIMMED, as F1 does', async () => {
    expect(await openRunPreconditions(facts({ ...WORK, project: ' demo ', sessionId: 'ws-1' }, { sessionMark: async () => ({ kind: 'child' }) })))
      .toMatchObject({ ok: false, refusal: { gate: 'crossingSession', refused: 'project-mismatch', by: 'demo' } });
  });
});

describe('openRunPreconditions — the shape gate, one row per clause (D-5384)', () => {
  for (const r of SHAPE_CLAUSES) {
    it(`shape: ${r.name}`, async () => {
      expect(await openRunPreconditions(facts(r.body))).toStrictEqual({ ok: false, refusal: { gate: 'shape', error: 'bad-request' } });
    });
  }

  it('a null waveOf on a review is admitted, and the plan takes the reviewed run\'s waveOf', async () => {
    expect(await openRunPreconditions(facts({ ...REVIEW, waveOf: null })))
      .toMatchObject({ ok: true, open: { kind: 'review', waveOf: 3 } });
  });
});

describe('openRunPreconditions — what the fact lookups receive (D-5384)', () => {
  it('programKnown and programHome are asked with the SHAPED slug, so a padded slug cannot skip home-mismatch', async () => {
    const programKnown = vi.fn((s: string) => s === 'demo-program');
    const programHome = vi.fn((s: string) => (s === 'demo-program' ? 'other-home' : null));
    expect(await openRunPreconditions(facts({ ...WORK, program: ' demo-program ' }, { programKnown, programHome })))
      .toStrictEqual({ ok: false, refusal: { gate: 'homeVerdict', refused: 'home-mismatch', by: 'other-home' } });
    expect(programKnown).toHaveBeenCalledWith('demo-program');
    expect(programHome).toHaveBeenCalledWith('demo-program');
  });

  it('F1 compares the body project UNTRIMMED, as the inline handler did', async () => {
    const sessionProject = vi.fn(() => 'demo');
    expect(await openRunPreconditions(facts({ ...WORK, project: ' demo ', sessionId: 'ws-1' }, { sessionProject })))
      .toStrictEqual({ ok: false, refusal: { gate: 'projectMismatch', refused: 'project-mismatch', by: 'demo' } });
    expect(sessionProject).toHaveBeenCalledWith('ws-1');
  });
});

describe('openRunPreconditions — the admitted opens (D-5384)', () => {
  it('a work open: its plan is the body\'s, the slug shaped, the home trimmed, the verdict a first write', async () => {
    const v = await openRunPreconditions(facts({ ...WORK, program: ' demo-program ', homeProject: ' demo ', sessionId: 'ws-1' }));
    expect(v).toStrictEqual({
      ok: true, home: { kind: 'write' },
      open: {
        program: 'demo-program', title: 'Wave two', project: 'demo', wave: 2, waveOf: 3,
        claimedBy: 'coord-1', kind: 'work', reviews: null, homeProject: 'demo', sessionId: 'ws-1',
        unattributed: false, coordProject: 'demo',
      },
    });
  });

  it('a review open takes project, wave and waveOf off the reviewed run, never the body', async () => {
    const v = await openRunPreconditions(facts({ ...REVIEW, waveOf: null },
      { reviewed: () => ({ ok: true, run: reviewed({ project: 'demo-2', wave: 4, waveOf: null }) }),
        claimantProject: async () => ({ kind: 'measured', project: 'demo-2' }) }));
    expect(v).toStrictEqual({
      ok: true, home: { kind: 'write' },
      open: {
        program: 'demo-program', title: 'Review wave two', project: 'demo-2', wave: 4, waveOf: null,
        claimedBy: 'coord-1', kind: 'review', reviews: 7, homeProject: 'demo',
        unattributed: false, coordProject: 'demo-2',
      },
    });
  });

  it('a known programme with a NULL home is a backfill; a matching one agrees; the legacy branch stays reachable', async () => {
    expect(await openRunPreconditions(facts({ ...WORK }, { programKnown: () => true, programHome: () => null })))
      .toMatchObject({ ok: true, home: { kind: 'backfill', home: 'demo' } });
    expect(await openRunPreconditions(facts({ ...WORK }, { programKnown: () => true, programHome: () => 'demo' })))
      .toMatchObject({ ok: true, home: { kind: 'agrees' } });
    expect(await openRunPreconditions({ ...facts({ ...WORK, homeProject: undefined }), legacyAccepted: true }))
      .toMatchObject({ ok: true, home: { kind: 'legacy' }, open: { program: 'demo-program' } });
  });

  it('a self-claimed run and an absent waveOf are admitted', async () => {
    const v = await openRunPreconditions(facts({ ...WORK, waveOf: undefined }, { openClaimantsOf: () => ['coord-1'] }));
    expect(v).toMatchObject({ ok: true, open: { waveOf: null } });
  });
});

describe('openRunPreconditions — the switch-over and the binding (D-5298)', () => {
  it('before the fleet carries the client, an open with no claimedByUuid is admitted unattributed, and never attributed', async () => {
    const attribute = vi.fn(async () => STALE);
    const v = await openRunPreconditions(facts({ ...WORK, claimedByUuid: undefined }, { fleetCarriesAttribution: false, attribute }));
    expect(v).toMatchObject({ ok: true, open: { unattributed: true, coordProject: 'demo' } });
    expect(attribute).not.toHaveBeenCalled();
  });

  it('before the switch-over the project and not-a-child gates still refuse an unattributed open', async () => {
    const pre = { fleetCarriesAttribution: false };
    expect(await openRunPreconditions(facts({ ...WORK, claimedByUuid: undefined },
      { ...pre, claimantProject: async () => ({ kind: 'none' }) })))
      .toStrictEqual({ ok: false, refusal: { gate: 'claimantProject', refused: 'project-mismatch', detail: NO_PROJECT_DETAIL } });
    expect(await openRunPreconditions(facts({ ...WORK, claimedByUuid: undefined, sessionId: 'ws-1' },
      { ...pre, sessionMark: async () => ({ kind: 'root' }) })))
      .toStrictEqual({ ok: false, refusal: { gate: 'notAChild', refused: 'not-a-child', detail: NOT_A_CHILD_DETAIL } });
  });

  it('a sent uuid is checked in either state, against the claimant it names', async () => {
    const attribute = vi.fn(async () => STALE);
    expect(await openRunPreconditions(facts({ ...WORK }, { fleetCarriesAttribution: false, attribute })))
      .toStrictEqual({ ok: false, refusal: { gate: 'attribution', error: 'stale-uuid', detail: STALE.detail } });
    expect(attribute).toHaveBeenCalledWith('coord-1', 'u-coord-1');
  });

  it('a child and a row-less id are admitted; a deferred mark is left to the child gate', async () => {
    for (const kind of ['child', 'absent', 'deferred'] as const) {
      expect(await openRunPreconditions(facts({ ...WORK, sessionId: 'ws-1' }, { sessionMark: async () => ({ kind }) })), kind)
        .toMatchObject({ ok: true, open: { sessionId: 'ws-1' } });
    }
  });

  it('before the switch-over a claimant of another project is admitted unattributed (D-5523)', async () => {
    expect(await openRunPreconditions(facts({ ...WORK, claimedByUuid: undefined },
      { fleetCarriesAttribution: false, claimantProject: async () => ({ kind: 'measured', project: 'demo-b' }) })))
      .toMatchObject({ ok: true, open: { unattributed: true, coordProject: 'demo-b' } });
  });
});

describe('openRunPreconditions reads its facts lazily, in gate order (D-5384)', () => {
  it('a malformed body reads nothing; a work open never reads a reviewed run', async () => {
    const spies = {
      reviewed: vi.fn(() => ({ ok: true as const, run: reviewed() })),
      sessionProject: vi.fn(() => null), programKnown: vi.fn(() => false),
      programHome: vi.fn(() => null), openClaimantsOf: vi.fn(() => [] as string[]),
      attribute: vi.fn(async () => ({ ok: true as const })),
      claimantProject: vi.fn(async () => ({ kind: 'measured' as const, project: 'demo' })),
      sessionMark: vi.fn(async () => ({ kind: 'absent' as const })),
    };
    await openRunPreconditions(facts({ ...WORK, title: '' }, spies));
    for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled();
    // D-5298: a refusal at the attribution gate reads no store fact and no
    // later registry fact.
    await openRunPreconditions(facts({ ...REVIEW }, { ...spies, attribute: async () => STALE }));
    expect(spies.reviewed).not.toHaveBeenCalled();
    expect(spies.claimantProject).not.toHaveBeenCalled();
    await openRunPreconditions(facts({ ...WORK }, spies));
    expect(spies.sessionMark).not.toHaveBeenCalled();     // no sessionId, no mark read
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
    // The claimant's registry row (`run-routes.test.ts`'s `seed` field set):
    // since D-5298 an open is attributed against it and its project.
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: '/w/coord-1',
      uuid: 'u-coord-1', started: '1', workspace: 'coord-1', branch: 'ws/coord-1', base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(home, '.cc-sessions', `coord-1.${k}`), v);
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
  it('answers RUN_REFUSAL_STATUS with `{ ok, refused, ...extra }` in that key order', async () => {
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
