// The other write lanes' table, decider and reads (Overlord W1, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Task 2; spec §3.5 C48, §3.8 H10). Pure cases over
// handed-in designation reads, a reads double that counts its calls, and the L3 reads over a fixture registry.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import Fastify from 'fastify';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { REFUSAL_STATUS, isOverlordRefusal } from '../../shared/refusal.js';
import {
  OTHER_LANES, OTHER_LANE_KEYS, decideOtherLane, linearLaneOf, otherLaneVerdict,
  type CallerProfileRead, type OtherLane, type OtherLaneReads,
} from '../src/coord/otherLanes.js';
import * as otherLanesModule from '../src/coord/otherLanes.js';
import { otherLaneReadsOf } from '../src/coord/otherLaneReads.js';
import { otherLaneVerdictCases } from './sim/otherLanesSets.js';
import { refuseOtherLane } from '../src/refuse.js';
import { LINEAR_OPS } from '../src/linear/ops.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const BODY = 'lane-a-overlord-quiet-oak';
const OLD = 'lane-a-overlord-old-elm';
const OWED = 'lane-a-overlord-owed';
const PAST = 'lane-a-overlord-past';
const OTHER = 'lane-a-project-a-coord';

const view = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 3, designatedTerm: 1, model: 'opus',
  accountPools: { pools: [], untagged: true }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
  ...over,
});
const pending = (sessionId: string, kind: 'designate' | 'rebind') =>
  ({ sessionId, kind, deadlineAt: 2, since: 1, actor: 'operator', generation: null });
const designated = (sessionId: string, over: Partial<DesignationView> = {}): DesignationRead =>
  ({ kind: 'designated', sessionId, term: 3, row: view({ bound: { sessionId, generation: 'g1' }, ...over }) });
const notDesignated = (row: DesignationView | null): DesignationRead => ({ kind: 'not-designated', row });
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'bad pending kind' };

const verdict = (lane: OtherLane, id: string, designation: DesignationRead, profile: CallerProfileRead = 'not-read') =>
  otherLaneVerdict(lane, id, { designation, profile });

describe('otherLaneVerdict: the refused set', () => {
  it.each(OTHER_LANE_KEYS)('%s refuses the bound body with its row\'s word, and the detail names the route', (lane) => {
    const v = verdict(lane, BODY, designated(BODY));
    expect(v).toEqual({ kind: 'refuse', word: OTHER_LANES[lane].word, detail: expect.stringContaining(OTHER_LANES[lane].route) });
    if (v.kind === 'refuse') expect(v.detail).toContain(BODY);
  });

  it('the run lanes refuse as not-a-coordinator, every other lane as uses-its-doors', () => {
    for (const lane of OTHER_LANE_KEYS) {
      const want = lane === 'runOpen' || lane === 'runReclaim' ? 'overlord-not-a-coordinator' : 'overlord-uses-its-doors';
      expect(verdict(lane, BODY, designated(BODY))).toMatchObject({ kind: 'refuse', word: want });
    }
  });

  it('at runReclaim the detail says the id is the heir\'s', () => {
    const v = verdict('runReclaim', BODY, designated(BODY));
    expect(v.kind === 'refuse' && v.detail.startsWith(`the heir ${BODY} `)).toBe(true);
  });

  it.each(OTHER_LANE_KEYS)('%s refuses a designate attempt\'s and a rebind attempt\'s pending body', (lane) => {
    const word = OTHER_LANES[lane].word;
    expect(verdict(lane, BODY, notDesignated(view({ pending: pending(BODY, 'designate') }))))
      .toMatchObject({ kind: 'refuse', word });
    expect(verdict(lane, BODY, designated(OLD, { pending: pending(BODY, 'rebind') })))
      .toMatchObject({ kind: 'refuse', word });
    expect(verdict(lane, BODY, notDesignated(view({ pending: pending(BODY, 'rebind') }))))
      .toMatchObject({ kind: 'refuse', word });
  });

  it('a rebind\'s old bound body, while the attempt is pending, is refused (it is still live)', () => {
    expect(verdict('peerMail', OLD, designated(OLD, { pending: pending(BODY, 'rebind') })))
      .toMatchObject({ kind: 'refuse', word: 'overlord-uses-its-doors' });
  });

  it.each(OTHER_LANE_KEYS)('%s refuses an id on stopsOwed under designated and under not-designated', (lane) => {
    const word = OTHER_LANES[lane].word;
    expect(verdict(lane, OWED, designated(BODY, { stopsOwed: [OWED] }))).toMatchObject({ kind: 'refuse', word });
    expect(verdict(lane, OWED, notDesignated(view({ stopsOwed: [OWED] })))).toMatchObject({ kind: 'refuse', word });
  });

  it.each(OTHER_LANE_KEYS)('%s passes the same id once drained, on pastIds only', (lane) => {
    expect(verdict(lane, PAST, designated(BODY, { pastIds: [PAST] }))).toEqual({ kind: 'pass' });
    expect(verdict(lane, PAST, notDesignated(view({ pastIds: [PAST] })))).toEqual({ kind: 'pass' });
  });

  it.each(OTHER_LANE_KEYS)('%s passes another session under every measured state', (lane) => {
    expect(verdict(lane, OTHER, designated(BODY, { stopsOwed: [OWED], pending: pending(OLD, 'rebind') })))
      .toEqual({ kind: 'pass' });
    expect(verdict(lane, OTHER, notDesignated(null))).toEqual({ kind: 'pass' });
    expect(verdict(lane, OTHER, notDesignated(view({ pending: pending(BODY, 'designate') })))).toEqual({ kind: 'pass' });
  });

  it('matches the caller by id, never by the term', () => {
    // A caller whose id spells the term is no body; the body is refused whatever the term reads.
    expect(verdict('claimTake', '3', designated(BODY))).toEqual({ kind: 'pass' });
    expect(verdict('claimTake', BODY, { kind: 'designated', sessionId: BODY, term: 99,
      row: view({ bound: { sessionId: BODY, generation: 'g' }, term: 99 }) })).toMatchObject({ kind: 'refuse' });
  });
});

describe('otherLaneVerdict: an unmeasured designation asks the caller\'s profile (question 4)', () => {
  const refusing: [string, CallerProfileRead][] = [
    ['overlord', { kind: 'measured', word: 'overlord' }],
    ['unreadable', { kind: 'unreadable', why: 'profile unreadable' }],
    ['not-read', 'not-read'],
  ];
  it.each(refusing)('profile %s refuses unmeasured on every lane, with the why in the detail', (_n, profile) => {
    for (const lane of OTHER_LANE_KEYS) {
      const v = verdict(lane, OTHER, UNMEASURED, profile);
      expect(v).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
      if (v.kind === 'refuse') {
        expect(v.detail).toContain('bad pending kind');
        expect(v.detail).toContain(OTHER_LANES[lane].route);
      }
    }
  });

  const passing: [string, CallerProfileRead][] = [
    ['coordinator', { kind: 'measured', word: 'coordinator' }],
    ['plain', { kind: 'measured', word: 'plain' }],
    ['absent', { kind: 'absent' }],
  ];
  it.each(passing)('profile %s passes-unmeasured on every lane, with the designation\'s why', (_n, profile) => {
    for (const lane of OTHER_LANE_KEYS) {
      expect(verdict(lane, BODY, UNMEASURED, profile)).toEqual({ kind: 'pass-unmeasured', why: 'bad pending kind' });
    }
  });
});

describe('decideOtherLane', () => {
  const double = (designation: DesignationRead, profile: Exclude<CallerProfileRead, 'not-read'> = { kind: 'absent' }) => {
    const calls = { designation: 0, profile: [] as string[] };
    const reads: OtherLaneReads = {
      designation: () => { calls.designation += 1; return designation; },
      profile: async (id) => { calls.profile.push(id); return profile; },
    };
    return { reads, calls };
  };

  it('reads the designation once and the profile never while the designation is measured', async () => {
    for (const d of [designated(BODY), notDesignated(null), notDesignated(view({ stopsOwed: [OWED] }))]) {
      const { reads, calls } = double(d);
      await decideOtherLane('claimTake', OTHER, reads);
      expect(calls).toEqual({ designation: 1, profile: [] });
    }
  });

  it('reads the caller\'s profile, once, when the designation is unmeasured, and decides on it', async () => {
    const a = double(UNMEASURED, { kind: 'measured', word: 'overlord' });
    expect(await decideOtherLane('peerMail', OTHER, a.reads)).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
    expect(a.calls).toEqual({ designation: 1, profile: [OTHER] });
    const b = double(UNMEASURED, { kind: 'measured', word: 'coordinator' });
    expect(await decideOtherLane('peerMail', OTHER, b.reads)).toEqual({ kind: 'pass-unmeasured', why: 'bad pending kind' });
  });
});

describe('the table', () => {
  it('every row has a route, a word isOverlordRefusal accepts, and a via; no two rows share a route', () => {
    const routes = new Set<string>();
    for (const lane of OTHER_LANE_KEYS) {
      const row = OTHER_LANES[lane];
      expect(row.route).toMatch(/^POST \/api\//);
      expect(isOverlordRefusal(row.word)).toBe(true);
      expect(row.via.length).toBeGreaterThan(0);
      expect(routes.has(row.route)).toBe(false);
      routes.add(row.route);
    }
  });

  it('REFUSAL_STATUS gives every row\'s word 403, and unmeasured 502', () => {
    for (const lane of OTHER_LANE_KEYS) expect(REFUSAL_STATUS[OTHER_LANES[lane].word]).toBe(403);
    expect(REFUSAL_STATUS.unmeasured).toBe(502);
  });

  it('the seven plan-door rows refuse the bound body with overlord-uses-its-doors', () => {
    const planRows = OTHER_LANE_KEYS.filter((l) => OTHER_LANES[l].via === 'plan-door');
    expect(planRows).toEqual(['planDeclare', 'planMet', 'planTickets', 'planTicketsMove', 'planEpicsDrop', 'planPhaseRefs', 'planClose']);
    for (const lane of planRows) {
      expect(verdict(lane, BODY, designated(BODY))).toMatchObject({ kind: 'refuse', word: 'overlord-uses-its-doors' });
    }
  });
});

describe('linearLaneOf', () => {
  it('maps each write verb to its row, and search and every read to null', () => {
    const writes = Object.entries(LINEAR_OPS).filter(([, op]) => op.class === 'write').map(([v]) => v).sort();
    expect(writes).toEqual(['comment', 'create', 'link', 'update']);
    expect(writes.map(linearLaneOf)).toEqual(['linearComment', 'linearCreate', 'linearLink', 'linearUpdate']);
    for (const [verb, op] of Object.entries(LINEAR_OPS)) {
      if (op.class !== 'write') expect(linearLaneOf(verb)).toBeNull();
    }
    expect(linearLaneOf('search')).toBeNull();
    expect(linearLaneOf('constructor')).toBeNull();
  });
});

describe('refuseOtherLane', () => {
  const reply = async (lane: OtherLane, d: DesignationRead, profile: Exclude<CallerProfileRead, 'not-read'> = { kind: 'absent' }) => {
    const app = Fastify({ logger: false });
    let goOn: boolean | undefined;
    const reads: OtherLaneReads = { designation: () => d, profile: async () => profile };
    app.post('/x', async (_req, r) => {
      goOn = await refuseOtherLane(r, lane, BODY, reads);
      return goOn ? r.send({ ok: true }) : r;
    });
    const res = await app.inject({ method: 'POST', url: '/x' });
    await app.close();
    return { goOn, status: res.statusCode, body: res.json() as Record<string, unknown> };
  };

  it('answers false and sends the word\'s status on refuse', async () => {
    const a = await reply('claimTake', designated(BODY));
    expect(a).toMatchObject({ goOn: false, status: 403, body: { ok: false, error: 'overlord-uses-its-doors' } });
    expect(Object.keys(a.body)).toEqual(['ok', 'error', 'detail']);
    const b = await reply('runOpen', designated(BODY));
    expect(b).toMatchObject({ goOn: false, status: 403, body: { ok: false, error: 'overlord-not-a-coordinator' } });
    const c = await reply('peerMail', UNMEASURED, { kind: 'measured', word: 'overlord' });
    expect(c).toMatchObject({ goOn: false, status: 502, body: { ok: false, error: 'unmeasured' } });
  });

  it('answers true for both passes, and sends nothing itself', async () => {
    expect(await reply('claimTake', notDesignated(null))).toEqual({ goOn: true, status: 200, body: { ok: true } });
    expect(await reply('claimTake', UNMEASURED, { kind: 'absent' })).toEqual({ goOn: true, status: 200, body: { ok: true } });
  });
});

describe('otherLaneReadsOf (L3)', () => {
  let home: string;
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    home = mkTmp('other-lane-reads-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warn.mockRestore(); });

  const readsOver = (answers: DesignationRead[]) => {
    const { cfg, io } = testDeps(home, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
    let i = 0;
    return otherLaneReadsOf({ coord: { designationRead: () => answers[Math.min(i++, answers.length - 1)]! }, io, cfg });
  };

  it('logs one line for two unmeasured reads in a row, none for a measured one, and one again after a measured read', () => {
    const lines = () => warn.mock.calls.filter((c) => String(c[0]).includes('Overlord designation is unreadable')).length;
    const reads = readsOver([notDesignated(null), UNMEASURED, UNMEASURED, designated(BODY), UNMEASURED]);
    reads.designation();
    expect(lines()).toBe(0);
    reads.designation(); reads.designation();
    expect(lines()).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('Overlord designation'))[0]).toMatch(/^ccrc-server: the Overlord designation is unreadable \(bad pending kind\)/);
    reads.designation();
    expect(lines()).toBe(1);
    reads.designation();
    expect(lines()).toBe(2);
    readsOver([notDesignated(null)]).designation(); // a measured read on any instance ends the shared episode
  });

  it('two instances share one episode', () => {
    const lines = () => warn.mock.calls.filter((c) => String(c[0]).includes('Overlord designation is unreadable')).length;
    readsOver([notDesignated(null)]).designation();
    readsOver([UNMEASURED]).designation();
    readsOver([UNMEASURED]).designation();
    expect(lines()).toBe(1);
    readsOver([notDesignated(null)]).designation();
  });

  it('reads the profile route field: measured, absent and unreadable kept apart', async () => {
    const reads = readsOver([notDesignated(null)]);
    writeFileSync(path.join(home, '.cc-sessions', `${BODY}.profile`), 'overlord\n');
    expect(await reads.profile(BODY)).toEqual({ kind: 'measured', word: 'overlord' });
    expect(await reads.profile(OTHER)).toEqual({ kind: 'absent' });
    mkdirSync(path.join(home, '.cc-sessions', `${OWED}.profile`)); // a directory reads as unreadable, not absent
    expect(await reads.profile(OWED)).toMatchObject({ kind: 'unreadable' });
  });
});

describe('otherLaneVerdict: the mutant set\'s cases, against the real module', () => {
  const cases = otherLaneVerdictCases(otherLanesModule);
  it.each(Object.keys(cases))('%s', (name) => { cases[name]!(); });
});
