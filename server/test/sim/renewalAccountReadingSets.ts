// The account readings' oracles and mutant sets (Overlord W1, plan `w1-renewal-readings.md`, PR D: Task 7). Each mapper's
// cases are written ONCE here, as suite cases over a module: `continuity-renewal-readings.test.ts` runs them against the real
// module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors). The expected
// answers are written out, never read from the code they judge. The pool answers are real `ccd pool-answer` lines, the shape
// pool set B1's suite (`ccd-pool-answer.test.ts`) pins, parsed by the one parser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';
import type { LaneFacts } from '../../../shared/serviceability.js';
import type { Roster } from '../../../shared/roster.js';
import type { Candidate, Candidates } from '../../src/accountLoad.js';
import type { AccountLimits } from '../../src/limits.js';
import { parsePoolAnswer, type PoolAnswerRead } from '../../src/poolrule.js';
import type { TurnMarkRead } from '../../src/coord/stall.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/continuity/renewalReadings.ts');

type RenewalReadingsModule = typeof import('../../src/continuity/renewalReadings.js');

const NOW_S = 2_000_000_000;
const measured = <T>(value: T) => ({ kind: 'measured' as const, value });
const unmeasured = (why: string) => ({ kind: 'unmeasured' as const, why });
const FALSE = measured(false);
const TRUE = measured(true);

/** One `ccd pool-answer` line, as the agent's runner hands it over, parsed by the one parser. */
const line = (side: string, verdict: string, poolSide: string, poolState: string, crossing: string, account = 'lane-a'): PoolAnswerRead =>
  parsePoolAnswer({ ran: true, code: 0,
    stdout: `pool-answer side=${side} verdict=${verdict} pool-side=${poolSide} pool-state=${poolState} crossing=${crossing} account=${account}\n` });
/** Pool set B1's own mismatch line under a set: decided on the account side (fix round 1, F1). */
const OUTSIDE = line('set:pool-b', 'mismatch', 'account', 'named:pool-a', 'none');
const SERVE = line('set:pool-a', 'serve', 'account', 'named:pool-a', 'none');
const CROSSED = line('set:pool-b', 'mismatch', 'account', 'named:pool-a', 'valid');
const CROSSING_UNREAD = line('set:pool-b', 'mismatch', 'account', 'named:pool-a', 'unreadable');
const STALE = line('set:pool-a', 'undecidable', 'account', 'stale', 'none');
const BAD_SET = line('set-malformed', 'undecidable', 'set', 'malformed', 'none');
const SET_UNREAD = line('set-unreadable', 'undecidable', 'set', 'unreadable', 'none');
const PROJECT_SIDE = line('untagged', 'mismatch', 'project', 'untagged', 'none');

const lim = (pct: number | null, ago = 60): AccountLimits => ({
  five: pct, seven: pct, ts: NOW_S - ago, fiveResetAt: NOW_S + 9_000, sevenResetAt: NOW_S + 300_000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false,
});
const cand = (id: string, serves: Candidate['serves'], limits: AccountLimits | undefined = lim(50)): Candidate => ({ id, limits, serves });
const cands = (...list: Candidate[]): Candidates => ({ kind: 'candidates', list });
const NOT_DESIGNATED: Candidates = { kind: 'not-designated' };
const DESIGNATION_UNREAD: Candidates = { kind: 'unmeasured', why: 'designation-unreadable' };
const HOLDS_UNREAD = { ok: false as const, detail: 'locked' };

// ------------------------------------------------------------------------------------------------- accountOutsideSetOf

function outsideSetCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  const SERVING = cands(cand('lane-b', 'yes'));
  return {
    'F1: pool set B1\'s mismatch line under a set, with a servable candidate, is due (the side word says "has a set")': () => {
      expect(OUTSIDE).toMatchObject({ kind: 'answer', answer: { poolSide: 'account' } });
      expect(m.accountOutsideSetOf(OUTSIDE, SERVING, 'not-wired')).toEqual(TRUE);
    },
    'the same line with `verdict=serve` is not due': () => {
      expect(m.accountOutsideSetOf(SERVE, SERVING, 'not-wired')).toEqual(FALSE);
    },
    'with no designation the row does not apply: measured false, whatever the answer': () => {
      for (const a of [OUTSIDE, { kind: 'not-run' } as const, PROJECT_SIDE]) expect(m.accountOutsideSetOf(a, NOT_DESIGNATED, 'not-wired')).toEqual(FALSE);
    },
    'with the designation unreadable: unmeasured, never false': () => {
      expect(m.accountOutsideSetOf(SERVE, DESIGNATION_UNREAD, 'not-wired')).toEqual(unmeasured('designation unreadable'));
      expect(m.accountOutsideSetOf(OUTSIDE, DESIGNATION_UNREAD, 'not-wired')).toEqual(unmeasured('designation unreadable'));
    },
    'not run, refused and unparsed each read unmeasured, naming which': () => {
      expect(m.accountOutsideSetOf({ kind: 'not-run' }, SERVING, 'not-wired')).toEqual(unmeasured('pool answer not run'));
      expect(m.accountOutsideSetOf({ kind: 'refused', code: 1 }, SERVING, 'not-wired')).toEqual(unmeasured('pool answer refused (1)'));
      expect(m.accountOutsideSetOf({ kind: 'unparsed', why: 'side' }, SERVING, 'not-wired')).toEqual(unmeasured('pool answer unparsed: side'));
    },
    'a project word on the route record: unmeasured `no set on the route record`': () => {
      expect(m.accountOutsideSetOf(PROJECT_SIDE, SERVING, 'not-wired')).toEqual(unmeasured('no set on the route record'));
      expect(m.accountOutsideSetOf(line('named:pool-a', 'mismatch', 'project', 'untagged', 'none'), SERVING, 'not-wired'))
        .toEqual(unmeasured('no set on the route record'));
    },
    'a bad set passes the set test and reads undecidable, with its pool state': () => {
      expect(m.accountOutsideSetOf(BAD_SET, SERVING, 'not-wired')).toEqual(unmeasured('undecidable: malformed'));
      expect(m.accountOutsideSetOf(SET_UNREAD, SERVING, 'not-wired')).toEqual(unmeasured('undecidable: unreadable'));
      expect(m.accountOutsideSetOf(STALE, SERVING, 'not-wired')).toEqual(unmeasured('undecidable: stale'));
    },
    'a crossing that stands is not due (the operator\'s move stands until the next renewal)': () => {
      expect(m.accountOutsideSetOf(CROSSED, SERVING, 'not-wired')).toEqual(FALSE);
    },
    'a crossing that cannot be read is unmeasured, never "none"': () => {
      expect(m.accountOutsideSetOf(CROSSING_UNREAD, SERVING, 'not-wired')).toEqual(unmeasured('crossing unreadable'));
    },
    'F7: the answer\'s account held is outside the set, whatever the verdict': () => {
      const held = { ok: true as const, lanes: ['lane-a'] };
      for (const a of [SERVE, CROSSED, STALE]) expect(m.accountOutsideSetOf(a, SERVING, held)).toEqual(TRUE);
      expect(m.accountOutsideSetOf(SERVE, cands(cand('lane-b', 'at-ceiling')), held)).toEqual(FALSE);
    },
    'holds read that do not name the account leave a served answer measured': () => {
      expect(m.accountOutsideSetOf(SERVE, SERVING, { ok: true, lanes: ['lane-c'] })).toEqual(FALSE);
      expect(m.accountOutsideSetOf(CROSSED, SERVING, { ok: true, lanes: [] })).toEqual(FALSE);
    },
    'holds unread: a served or crossed answer is unmeasured, since a hold might decide': () => {
      expect(m.accountOutsideSetOf(SERVE, SERVING, HOLDS_UNREAD)).toEqual(unmeasured('holds unread: locked'));
      expect(m.accountOutsideSetOf(CROSSED, SERVING, HOLDS_UNREAD)).toEqual(unmeasured('holds unread: locked'));
      expect(m.accountOutsideSetOf(OUTSIDE, SERVING, HOLDS_UNREAD)).toEqual(TRUE);
    },
    'F5: outside the set, an unmeasured candidate never folds into a proven absence': () => {
      expect(m.accountOutsideSetOf(OUTSIDE, cands(cand('lane-b', 'yes'), cand('lane-c', 'unmeasured')), 'not-wired'))
        .toEqual(unmeasured('a candidate unmeasured'));
      expect(m.accountOutsideSetOf(OUTSIDE, cands(cand('lane-c', 'unmeasured')), 'not-wired')).toEqual(unmeasured('a candidate unmeasured'));
    },
    'outside the set with none serving is not due (nothing to land on: stranded)': () => {
      expect(m.accountOutsideSetOf(OUTSIDE, cands(cand('lane-b', 'at-ceiling'), cand('lane-c', 'at-ceiling')), 'not-wired')).toEqual(FALSE);
      expect(m.accountOutsideSetOf(OUTSIDE, cands(), 'not-wired')).toEqual(FALSE);
    },
    'monotonic: an unmeasured input never turns a false into a true': () => {
      const serving = SERVING;
      expect(m.accountOutsideSetOf(SERVE, serving, HOLDS_UNREAD).kind).not.toBe('measured');
      expect(m.accountOutsideSetOf(OUTSIDE, cands(cand('lane-b', 'at-ceiling'), cand('lane-c', 'unmeasured')), 'not-wired').kind).toBe('unmeasured');
    },
  };
}

const OUTSIDE_SET_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    // F1: "has a set" read from the side the verdict was decided on, not the session's side word.
    { id: 'O1 poolSide tested for the set', old: 'const hasSet = isSetSide(a.answer.side);', new: "const hasSet = a.answer.poolSide === 'set';" },
    { id: 'O2 crossing none read as valid', old: "a.answer.crossing === 'valid'", new: "a.answer.crossing !== 'unreadable'" },
    { id: 'O3 the servable-account check dropped', old: "c.list.some((x) => x.serves === 'yes')", new: 'true' },
    { id: 'O4 an unmeasured candidate folded into none serving', old: "  if (c.list.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');\n", new: '' },
    { id: 'O5 the held check dropped', old: 'const held = holds !== \'not-wired\' && holds.ok && holds.lanes.includes(a.answer.account);', new: 'const held = false;' },
    { id: 'O6 unread holds read as none', old: "if (holds !== 'not-wired' && !holds.ok) return unmeasured(`holds unread: ${holds.detail}`);", new: '' },
    { id: 'O7 undecidable read as serve', old: "  if (a.answer.verdict === 'undecidable') return unmeasured(`undecidable: ${a.answer.poolState}`);\n", new: '' },
    { id: 'O8 crossing unreadable read as none', old: "  if (a.answer.crossing === 'unreadable') return unmeasured('crossing unreadable');\n", new: '' },
    { id: 'O9 no set read as a set', old: "  if (!hasSet) return unmeasured('no set on the route record');\n", new: '' },
    { id: 'O10 not designated read as applying', old: "  if (c.kind === 'not-designated') return { kind: 'measured', value: false };\n  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  if (a.kind", new: "  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  if (a.kind" },
    { id: 'O11 an unread pool answer read as serve', old: "  if (a.kind === 'not-run') return unmeasured('pool answer not run');\n", new: "  if (a.kind === 'not-run') return { kind: 'measured', value: false };\n" },
  ],
  suite: outsideSetCases,
};

// --------------------------------------------------------------------------------------------------- classUnservableOf

const lane = (seven: number | null, continuity: LaneFacts['continuity'] = 'recorded'): LaneFacts =>
  ({ anthropic: true, seven, share: null, fableBilling: 'included', continuity });
const ON = (over: Partial<{ account: string | null; model: string | null; own: LaneFacts | undefined }> = {}) =>
  ({ account: 'lane-a' as string | null, model: 'claude-opus-5-5' as string | null, own: lane(99) as LaneFacts | undefined, ...over });

function classUnservableCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  const OTHER_SERVES = cands(cand('lane-a', 'at-ceiling'), cand('lane-b', 'yes'));
  return {
    'unservable here and another candidate serves: due': () => {
      expect(m.classUnservableOf(ON(), OTHER_SERVES, NOW_S)).toEqual(TRUE);
    },
    'servable here: not due, whatever the others say': () => {
      expect(m.classUnservableOf(ON({ own: lane(50) }), OTHER_SERVES, NOW_S)).toEqual(FALSE);
      expect(m.classUnservableOf(ON({ own: lane(50) }), cands(cand('lane-b', 'unmeasured')), NOW_S)).toEqual(FALSE);
    },
    'the account\'s own answer unmeasured: unmeasured with its word': () => {
      expect(m.classUnservableOf(ON({ own: lane(null) }), OTHER_SERVES, NOW_S)).toEqual(unmeasured('no-figure'));
    },
    'the set side is asked: an account with no continuity record is unservable here': () => {
      expect(m.classUnservableOf(ON({ own: lane(10, 'none') }), OTHER_SERVES, NOW_S)).toEqual(TRUE);
    },
    'no other candidate serves: not due (stranded, Table 3.4b); this account itself is never the other': () => {
      expect(m.classUnservableOf(ON(), cands(cand('lane-a', 'yes'), cand('lane-b', 'at-ceiling')), NOW_S)).toEqual(FALSE);
      expect(m.classUnservableOf(ON(), cands(), NOW_S)).toEqual(FALSE);
    },
    'F5: another candidate unmeasured reads unmeasured, never "none serves"; this account\'s own word is not counted': () => {
      expect(m.classUnservableOf(ON(), cands(cand('lane-b', 'yes'), cand('lane-c', 'unmeasured')), NOW_S)).toEqual(unmeasured('a candidate unmeasured'));
      expect(m.classUnservableOf(ON(), cands(cand('lane-a', 'unmeasured'), cand('lane-b', 'yes')), NOW_S)).toEqual(TRUE);
    },
    'the class unknown, the account unknown and its facts unread each read unmeasured': () => {
      expect(m.classUnservableOf(ON({ model: null }), OTHER_SERVES, NOW_S)).toEqual(unmeasured('model unknown'));
      expect(m.classUnservableOf(ON({ model: 'gpt-9' }), OTHER_SERVES, NOW_S)).toEqual(unmeasured('model unknown'));
      expect(m.classUnservableOf(ON({ account: null }), OTHER_SERVES, NOW_S)).toEqual(unmeasured('account unknown'));
      expect(m.classUnservableOf(ON({ own: undefined }), OTHER_SERVES, NOW_S)).toEqual(unmeasured('account facts unread'));
    },
    'no designation: measured false; the designation unreadable: unmeasured': () => {
      expect(m.classUnservableOf(ON(), NOT_DESIGNATED, NOW_S)).toEqual(FALSE);
      expect(m.classUnservableOf(ON({ own: lane(50) }), DESIGNATION_UNREAD, NOW_S)).toEqual(unmeasured('designation unreadable'));
    },
  };
}

const CLASS_UNSERVABLE_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'U1 the servable-account check dropped', old: "others.some((x) => x.serves === 'yes')", new: 'true' },
    { id: 'U2 an unmeasured other folded into none serving', old: "  if (others.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');\n", new: '' },
    { id: 'U3 this account counted as another', old: 'const others = c.list.filter((x) => x.id !== on.account);', new: 'const others = c.list;' },
    { id: 'U4 the own reading ignored', old: "  if (own.kind === 'measured' && !own.value) return own;\n", new: '' },
    { id: 'U5 an unmeasured own reading read as unservable', old: "  if (own.kind === 'unmeasured') return own;\n", new: '' },
    { id: 'U6 the other side asked', old: "serviceability(cls, on.own, 'set-side', nowS)", new: "serviceability(cls, on.own, 'other', nowS)" },
    { id: 'U7 not designated read as applying', old: "  if (c.kind === 'not-designated') return { kind: 'measured', value: false };\n  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  const cls", new: "  if (c.kind === 'not-designated') return { kind: 'measured', value: true };\n  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  const cls" },
  ],
  suite: classUnservableCases,
};

// ------------------------------------------------------------------------------------------- accountLoadOf and the move

function accountLoadCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'at the hard line with a fresh other under the soft line: due': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(90)), cand('lane-b', 'yes', lim(40))), NOW_S)).toEqual(TRUE);
    },
    'under the hard line: not due': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(40)), cand('lane-b', 'yes', lim(10))), NOW_S)).toEqual(FALSE);
    },
    'every counted other at or past the soft line: not due': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(90)), cand('lane-b', 'yes', lim(75))), NOW_S)).toEqual(FALSE);
    },
    'F5: an unmeasured other never folds into "no counted other" (the guard until serviceability B reads it)': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(90)), cand('lane-b', 'unmeasured', lim(10))), NOW_S))
        .toEqual(unmeasured('a candidate unmeasured'));
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(90)), cand('lane-b', 'yes', lim(75)), cand('lane-c', 'unmeasured')), NOW_S))
        .toEqual(unmeasured('a candidate unmeasured'));
    },
    'this account\'s own serves word is not an other\'s: an unmeasured current account does not trip the guard': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'unmeasured', lim(90)), cand('lane-b', 'yes', lim(75))), NOW_S)).toEqual(FALSE);
    },
    'the producer\'s own unmeasured answer passes through': () => {
      expect(m.accountLoadOf('lane-a', cands(cand('lane-a', 'yes', lim(90)), cand('lane-b', 'yes', lim(10, 7_200))), NOW_S))
        .toEqual(unmeasured('load-unmeasured'));
    },
    'an account not among the candidates, or unknown: unmeasured': () => {
      expect(m.accountLoadOf('lane-z', cands(cand('lane-a', 'yes', lim(90))), NOW_S)).toEqual(unmeasured('account not a candidate'));
      expect(m.accountLoadOf(null, cands(cand('lane-a', 'yes', lim(90))), NOW_S)).toEqual(unmeasured('account unknown'));
    },
    'no designation: measured false; the designation unreadable: unmeasured': () => {
      expect(m.accountLoadOf('lane-a', NOT_DESIGNATED, NOW_S)).toEqual(FALSE);
      expect(m.accountLoadOf('lane-a', DESIGNATION_UNREAD, NOW_S)).toEqual(unmeasured('designation unreadable'));
    },
  };
}

const ACCOUNT_LOAD_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'L1 the F5 guard dropped', old: "  if (load.kind === 'measured' && !load.value && others.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');\n", new: '' },
    { id: 'L2 the current account counted among the others', old: 'const others = c.list.filter((x) => x !== current);', new: 'const others = c.list;' },
    { id: 'L3 an account not a candidate read as not due', old: "  if (current === undefined) return unmeasured('account not a candidate');\n", new: "  if (current === undefined) return { kind: 'measured', value: false };\n" },
    { id: 'L4 not designated read as unmeasured', old: "  if (c.kind === 'not-designated') return { kind: 'measured', value: false };\n  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  if (account === null)", new: "  if (c.kind === 'not-designated') return unmeasured('designation unreadable');\n  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');\n  if (account === null)" },
  ],
  suite: accountLoadCases,
};

const mark = (state: 'working' | 'done' | 'failed'): TurnMarkRead => ({
  ok: true, sessionId: 'lane-a-project-a', state, event: 'Stop', at: 1, turnAt: null, stopAt: null, bg: 0, bgKinds: [], bgIds: [], err: null,
  restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null,
});

function loadMoveCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'a due load on an idle session is due': () => {
      expect(m.accountLoadMoveOf(TRUE, mark('done'))).toEqual(TRUE);
      expect(m.accountLoadMoveOf(TRUE, mark('failed'))).toEqual(TRUE);
    },
    'a measured busy session is not due, whatever the load says': () => {
      expect(m.accountLoadMoveOf(TRUE, mark('working'))).toEqual(FALSE);
      expect(m.accountLoadMoveOf(unmeasured('load-unmeasured'), mark('working'))).toEqual(FALSE);
    },
    'a load that is not due is not due, marker or no marker': () => {
      expect(m.accountLoadMoveOf(FALSE, mark('done'))).toEqual(FALSE);
      expect(m.accountLoadMoveOf(FALSE, { ok: false, reason: 'absent' })).toEqual(FALSE);
    },
    'an unread marker with a due load: unmeasured, naming the marker': () => {
      expect(m.accountLoadMoveOf(TRUE, { ok: false, reason: 'absent' })).toEqual(unmeasured('turn marker absent'));
      expect(m.accountLoadMoveOf(TRUE, { ok: false, reason: 'stale' })).toEqual(unmeasured('turn marker stale'));
    },
    'an unmeasured load on an idle session keeps the load\'s reason': () => {
      expect(m.accountLoadMoveOf(unmeasured('load-unmeasured'), mark('done'))).toEqual(unmeasured('load-unmeasured'));
      expect(m.accountLoadMoveOf(unmeasured('load-unmeasured'), { ok: false, reason: 'absent' })).toEqual(unmeasured('load-unmeasured'));
    },
  };
}

const LOAD_MOVE_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'M1 the idle conjunct dropped', old: '  const idle: Reading<boolean> = turn.ok', new: '  return load;\n  const idle: Reading<boolean> = turn.ok' },
    { id: 'M2 an unread marker read as idle', old: ": unmeasured(`turn marker ${turn.reason}`);", new: ": { kind: 'measured', value: true };" },
    { id: 'M3 a failed turn read as busy', old: "turn.state !== 'working'", new: "turn.state === 'done'" },
    { id: 'M4 the unmeasured load preferred to a measured busy', old: "  if (load.kind === 'measured' && !load.value) return load;\n  if (idle.kind === 'measured' && !idle.value) return idle;\n", new: "  if (load.kind === 'unmeasured') return load;\n  if (load.kind === 'measured' && !load.value) return load;\n  if (idle.kind === 'measured' && !idle.value) return idle;\n" },
  ],
  suite: loadMoveCases,
};

// ------------------------------------------------------------------------------------- the candidates, built and bound

const VIEW = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: { sessionId: 'lane-a-project-a', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'device:console-a', lastAttempt: null, stopsOwed: [], ...over,
} as DesignationView);
const BOUND: DesignationRead = { kind: 'designated', sessionId: 'lane-a-project-a', term: 1, row: VIEW() };
const ROSTER = { accounts: ['lane-a', 'lane-b', 'lane-c'].map((id) => ({ id, homeAble: true, exec: { kind: 'upstream' }, pool: 'pool-a' })) } as unknown as Roster;
const FACTS = (lanes: Record<string, LaneFacts>) => ({ roster: ROSTER, limits: { 'lane-a': lim(40), 'lane-b': lim(40), 'lane-c': lim(40) },
  edges: new Map<string, readonly string[]>(), lanes, nowS: NOW_S });

function candidatesCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'the designated set\'s accounts, in order, each with its serves word': () => {
      const got = m.overlordCandidatesOf(BOUND, FACTS({ 'lane-a': lane(40), 'lane-b': lane(99), 'lane-c': lane(null) }));
      expect(got).toMatchObject({ kind: 'candidates', list: [{ id: 'lane-a', serves: 'yes' }, { id: 'lane-b', serves: 'at-ceiling' }, { id: 'lane-c', serves: 'unmeasured' }] });
    },
    'no designation: `not-designated`; unreadable: unmeasured, never `not-designated`': () => {
      expect(m.overlordCandidatesOf({ kind: 'not-designated', row: null }, FACTS({}))).toEqual({ kind: 'not-designated' });
      expect(m.overlordCandidatesOf({ kind: 'unmeasured', why: 'locked' }, FACTS({}))).toEqual({ kind: 'unmeasured', why: 'designation-unreadable' });
    },
    'bound to this session: the candidates; to another session (a rebind): the row does not apply': () => {
      const c = cands(cand('lane-a', 'yes'));
      expect(m.boundCandidates(BOUND, 'lane-a-project-a', c)).toBe(c);
      expect(m.boundCandidates({ ...BOUND, sessionId: 'lane-b-project-a' } as DesignationRead, 'lane-a-project-a', c)).toEqual({ kind: 'not-designated' });
      expect(m.boundCandidates({ kind: 'not-designated', row: VIEW() }, 'lane-a-project-a', NOT_DESIGNATED)).toEqual(NOT_DESIGNATED);
      expect(m.boundCandidates({ kind: 'unmeasured', why: 'x' }, 'lane-a-project-a', DESIGNATION_UNREAD)).toEqual(DESIGNATION_UNREAD);
    },
  };
}

const CANDIDATES_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'C1 the ordered list not asked', old: "d.kind === 'designated' ? overlordAccounts(d.row.accountPools, d.row.model, f).list : []", new: '[]' },
  ],
  suite: candidatesCases,
};

const BOUND_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'B1 a rebind read as this session\'s', old: "boundTo(d, sessionId) === false ? { kind: 'not-designated' } : c", new: 'c' },
  ],
  suite: candidatesCases,
};

export const ACCOUNT_READING_CASES = { outsideSetCases, classUnservableCases, accountLoadCases, loadMoveCases, candidatesCases };

export const RENEWAL_ACCOUNT_READING_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#accountOutsideSetOf': OUTSIDE_SET_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#classUnservableOf': CLASS_UNSERVABLE_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#accountLoadOf': ACCOUNT_LOAD_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#accountLoadMoveOf': LOAD_MOVE_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#overlordCandidatesOf': CANDIDATES_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#boundCandidates': BOUND_SET as MutantSet<never>,
};
