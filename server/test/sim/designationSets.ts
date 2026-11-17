// The designation deciders' oracles and mutant sets (Overlord W1 designation A, plan Task 2). The cases are written ONCE
// here, as suite cases over a module: `overlord-designation-verdicts.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { DESIGNATE_CCD_WORDS, type DesignationRead, type DesignationView } from '../../../shared/overlord-designation.js';
import type { SharesRead } from '../../src/shares.js';
import { laneFactsOf } from '../../src/limits.js';
import type { ShareReading } from '../../../shared/serviceability.js';
import { parseRoster } from '../../../shared/roster.js';
import type { PoolSet } from '../../../shared/poolset.js';
import type { AccountLimits } from '../../src/limits.js';
import type { DesignationFact } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';
import { openCoordDb } from '../../src/coord/db.js';
import { insertStart, mintGeneration } from '../../src/continuity/continuityStore.js';
import type { AuthorityAppend } from '../../src/coord/overlordAuthorityJournal.js';
import { mkTmp } from '../tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type DesignationModule = typeof import('../../src/coord/overlordDesignation.js');
type Facts = Parameters<DesignationModule['designateVerdict']>[0];
type AFacts = Parameters<DesignationModule['overlordAccounts']>[2];

// ------------------------------------------------------------------------------------------------------------ fixtures

const NOW_S = 2_000_000;
const CONT = { recordedAt: 1 };
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id, label: id, configDirSuffix: `.${id}`, exec: { kind: 'generated', provider: 'anthropic' }, homeAble: true,
  hue: 'cyan', telemetry: 'anthropic', continuity: CONT, ...over,
});
/** Roster order: lane-a (pool-a), lane-b (pool-b), lane-c (pool-a), lane-d (untagged), lane-pay (an API-key lane in
 *  pool-a), lane-off (pool-a, switched off in the limits). */
export const ROSTER = parseRoster({ version: 1, accounts: [
  entry('lane-a', { exec: { kind: 'upstream' }, pool: 'pool-a' }),
  entry('lane-b', { pool: 'pool-b' }),
  entry('lane-c', { pool: 'pool-a' }),
  entry('lane-d'),
  entry('lane-pay', { exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-pay.env' },
    telemetry: 'openrouter', pool: 'pool-a' }),
  entry('lane-off', { pool: 'pool-a' }),
] });

export const limit = (over: Partial<AccountLimits> = {}): AccountLimits => ({
  five: 10, seven: 10, ts: 1, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});
const HEALTHY: Record<string, AccountLimits> = {
  'lane-a': limit(), 'lane-b': limit(), 'lane-c': limit(), 'lane-d': limit(), 'lane-pay': limit(),
  'lane-off': limit({ disabled: true }),
};
const NO_EDGES: ReadonlyMap<string, readonly string[]> = new Map();

/** The door's facts: `lanes` built with `limits.ts#laneFactsOf`, one per roster account (`shares` only feeds that call). */
export const afacts = (
  limits: Record<string, AccountLimits> = HEALTHY, over: Partial<AFacts> & { shares?: Record<string, ShareReading> } = {},
): AFacts => {
  const { shares, ...rest } = over;
  const roster = rest.roster ?? ROSTER;
  const first = shares === undefined ? undefined : Object.values(shares)[0];
  const read: SharesRead = shares === undefined || first === undefined ? { kind: 'absent' }
    : { kind: 'reading', finishedAtS: first.finishedAtS, byAccount: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, v.estimatePct])) };
  const lanes = Object.fromEntries(roster.accounts.map((a) => [a.id, laneFactsOf(a, limits, read)]));
  return { roster, limits, edges: NO_EDGES, lanes, nowS: NOW_S, ...rest };
};

export const SET_AB: PoolSet = { pools: ['pool-b', 'pool-a'], untagged: false };
export const SET_A: PoolSet = { pools: ['pool-a'], untagged: false };

const view = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: SET_AB, pastIds: [], actor: 'op',
  lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND: DesignationRead = {
  kind: 'designated', sessionId: 'overlord-x', term: 2,
  row: view({ bound: { sessionId: 'overlord-x', generation: 'g1' } }),
};
const PENDING_ONLY: DesignationRead = {
  kind: 'not-designated',
  row: view({ pending: { sessionId: 'overlord-y', kind: 'designate', deadlineAt: 9, since: 1, actor: 'op', generation: null } }),
};
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const ROW_NO_BODY: DesignationRead = { kind: 'not-designated', row: view() };
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'the row could not be narrowed' };

const SERVER_WORDS = ['continuity-v1'];
const ALL_CCD = [...DESIGNATE_CCD_WORDS];
const ANSWER = {
  kind: 'answer', answer: { side: 'set:pool-a', verdict: 'serve', poolSide: 'account', poolState: 'untagged', crossing: 'none', account: 'lane-a' },
} as const;

export const dfacts = (over: Partial<Facts> = {}): Facts => ({
  read: NONE, ccdWords: ALL_CCD, serverWords: SERVER_WORDS, builds: 'agreed', probe: ANSWER, model: 'opus', accountPools: SET_AB,
  accounts: afacts(), home: { wrapper: 'lane-a', score: 5 }, ...over,
});

// --------------------------------------------------------------------------------------------------- overlordAccounts

export function overlordAccountsCases(m: DesignationModule): Record<string, SuiteCase> {
  const run = (set: PoolSet, cls: 'fable' | 'opus' = 'opus', f: AFacts = afacts()) => m.overlordAccounts(set, cls, f);
  return {
    'the list is the set\'s pool order, roster order within a pool, and an API-key lane and a disabled lane are neither listed nor counted': () => {
      const r = run(SET_AB);
      expect(r.list).toEqual(['lane-b', 'lane-a', 'lane-c']);
      expect(r.counted).toEqual(['lane-b', 'lane-a', 'lane-c']);
      expect(r.unmeasured).toEqual([]);
    },
    'an account outside the set is not listed': () => {
      expect(run(SET_A).list).toEqual(['lane-a', 'lane-c']);
      expect(run({ pools: ['pool-b'], untagged: false }).list).toEqual(['lane-b']);
    },
    'untagged accounts are listed after every pool, and only when the set admits them': () => {
      expect(run({ pools: ['pool-b', 'pool-a'], untagged: true }).list).toEqual(['lane-b', 'lane-a', 'lane-c', 'lane-d']);
      expect(run({ pools: [], untagged: true }).list).toEqual(['lane-d']);
      expect(run(SET_AB).list).not.toContain('lane-d');
    },
    'the empty set lists and counts nothing': () => {
      expect(run({ pools: [], untagged: false })).toEqual({ list: [], counted: [], unmeasured: [] });
    },
    'a signed-out account is listed and not counted, and is not unmeasured either': () => {
      const r = run(SET_A, 'opus', afacts({ ...HEALTHY, 'lane-c': limit({ authDead: true }) }));
      expect(r).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: [] });
    },
    'an account at the ceiling is listed and not counted': () => {
      const r = run(SET_A, 'opus', afacts({ ...HEALTHY, 'lane-a': limit({ seven: 99 }) }));
      expect(r).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-c'], unmeasured: [] });
    },
    'an account with no continuity record is listed and not counted (a set-side asker)': () => {
      const noCont = parseRoster({ version: 1, accounts: [
        entry('lane-a', { exec: { kind: 'upstream' }, pool: 'pool-a' }), entry('lane-c', { pool: 'pool-a', continuity: undefined }),
      ] });
      const r = run(SET_A, 'opus', afacts(HEALTHY, { roster: noCont }));
      expect(r).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: [] });
    },
    'an unmeasured account is listed, never counted, and named unmeasured': () => {
      const r = run(SET_A, 'opus', afacts({ ...HEALTHY, 'lane-c': limit({ seven: null }) }));
      expect(r).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: ['lane-c'] });
      const gone = run(SET_A, 'opus', afacts({ 'lane-a': limit(), 'lane-off': limit({ disabled: true }) }));
      expect(gone).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: ['lane-c'] });
    },
    'an account with no lane facts is unmeasured, never counted': () => {
      const f = afacts(HEALTHY);
      const { 'lane-c': _gone, ...lanes } = f.lanes;
      void _gone;
      expect(run(SET_A, 'opus', { ...f, lanes })).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: ['lane-c'] });
    },
    'a seven-day window that rolled over is unmeasured, not an inferred zero': () => {
      const r = run(SET_A, 'opus', afacts({ ...HEALTHY, 'lane-c': limit({ seven: 0, sevenRolledOver: true }) }));
      expect(r).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: ['lane-c'] });
    },
    'a fable class reads the share figure: no estimate is unmeasured, a fresh low one counts': () => {
      const billing = parseRoster({ version: 1, accounts: [
        entry('lane-a', { exec: { kind: 'upstream' }, pool: 'pool-a', fableBilling: 'included' }),
        entry('lane-c', { pool: 'pool-a', fableBilling: 'included' }),
      ] });
      const f = afacts(HEALTHY, { roster: billing, shares: { 'lane-a': { estimatePct: 5, finishedAtS: NOW_S - 10 } } });
      expect(run(SET_A, 'fable', f)).toEqual({ list: ['lane-a', 'lane-c'], counted: ['lane-a'], unmeasured: ['lane-c'] });
    },
    'a central edge decides the account\'s pool before the roster\'s': () => {
      const f = afacts(HEALTHY, { edges: new Map([['lane-b', ['pool-a']]]) });
      expect(run(SET_A, 'opus', f).list).toEqual(['lane-a', 'lane-b', 'lane-c']);
    },
  };
}

// ----------------------------------------------------------------------------------------------------- designateVerdict

const refuse = (v: ReturnType<DesignationModule['designateVerdict']>) => (v.act === 'refuse' ? v.word : v.act);

export function designateVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  const verdict = (over: Partial<Facts> = {}) => m.designateVerdict(dfacts(over));
  return {
    'a healthy fleet creates on the wrapper home names, in the set\'s order, with the spelling': () => {
      expect(verdict()).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-b,lane-a,lane-c', poolset: 'pool-a,pool-b' });
    },
    'step 1: a bound session, a pending one, or an unreadable row refuses overlord-exists': () => {
      expect(refuse(verdict({ read: BOUND }))).toBe('overlord-exists');
      expect(refuse(verdict({ read: PENDING_ONLY }))).toBe('overlord-exists');
      expect(verdict({ read: UNMEASURED })).toMatchObject({ act: 'unmeasured' });
      expect(verdict({ read: UNMEASURED, ccdWords: null, builds: 'skewed' })).toMatchObject({ act: 'unmeasured' });
      expect(verdict({ read: BOUND, ccdWords: null })).toMatchObject({ act: 'refuse', word: 'overlord-exists' });
      expect(refuse(verdict({ read: ROW_NO_BODY }))).toBe('create');
      expect(refuse(verdict({ read: NONE }))).toBe('create');
    },
    'a fact that would refuse twice answers the first, step by step': () => {
      const everything = { read: BOUND, ccdWords: null, serverWords: [], builds: 'skewed', probe: { kind: 'not-run' },
        accountPools: { pools: ['bad name'], untagged: false } } as Partial<Facts>;
      expect(refuse(verdict(everything))).toBe('overlord-exists');
      expect(refuse(verdict({ ...everything, read: NONE }))).toBe('capability-missing');
      expect(refuse(verdict({ ...everything, read: NONE, ccdWords: ALL_CCD, serverWords: SERVER_WORDS, probe: ANSWER }))).toBe('launch-profile-unmet');
      expect(refuse(verdict({ ...everything, read: NONE, ccdWords: ALL_CCD, serverWords: SERVER_WORDS, probe: ANSWER, builds: 'agreed' })))
        .toBe('refuse-input');
      expect(refuse(verdict({ accountPools: { pools: [], untagged: false } }))).toBe('overlord-single-account');
    },
    'step 2: ccdWords null names all eight of ccd\'s words, project-add and the create\'s two among them': () => {
      const v = verdict({ ccdWords: null });
      expect(v).toMatchObject({ act: 'refuse', word: 'capability-missing' });
      if (v.act !== 'refuse') throw new Error('no refusal');
      expect(v.needs).toEqual([...DESIGNATE_CCD_WORDS]);
      expect(v.needs).toHaveLength(8);
      for (const w of ['project-add', 'ws-title-v1', 'ws-wrapper-v1', 'pool-set']) expect(v.needs).toContain(w);
    },
    'step 2: each missing ccd word and the server word is named, and only the missing ones': () => {
      const v = verdict({ ccdWords: ALL_CCD.filter((w) => w !== 'hibernate-fresh' && w !== 'ws-wrapper-v1'), serverWords: [] });
      if (v.act !== 'refuse') throw new Error('no refusal');
      expect(v.needs).toEqual(['hibernate-fresh', 'ws-wrapper-v1', 'continuity-v1']);
    },
    'step 2, question 2: the probe\'s answer, or a refusal with code 1, reads the word as present': () => {
      expect(refuse(verdict({ probe: ANSWER }))).toBe('create');
      expect(refuse(verdict({ probe: { kind: 'refused', code: 1 } }))).toBe('create');
    },
    'step 2, question 2: not-run, another code and an unparsed line each refuse naming pool-set': () => {
      const notRun = verdict({ probe: { kind: 'not-run' } });
      expect(notRun).toMatchObject({ act: 'refuse', word: 'capability-missing', needs: ['pool-set'] });
      for (const probe of [{ kind: 'refused', code: 2 }, { kind: 'refused', code: 127 }, { kind: 'unparsed', why: 'verdict' }] as const) {
        const v = verdict({ probe });
        expect(v).toMatchObject({ act: 'refuse', word: 'capability-missing', needs: ['pool-set'] });
        expect(v.act === 'refuse' && v.detail).toContain('the agent\'s pool answer could not be read');
      }
    },
    'step 2: a word absent from ccdWords and a failing probe name pool-set once': () => {
      const v = verdict({ ccdWords: ALL_CCD.filter((w) => w !== 'pool-set'), probe: { kind: 'not-run' } });
      if (v.act !== 'refuse') throw new Error('no refusal');
      expect(v.needs).toEqual(['pool-set']);
    },
    'step 3: skewed and unknown builds refuse launch-profile-unmet with their details; agreed passes': () => {
      const skewed = verdict({ builds: 'skewed' });
      expect(skewed).toMatchObject({ act: 'refuse', word: 'launch-profile-unmet' });
      expect(skewed.act === 'refuse' && skewed.detail).toContain('skewed');
      const unknown = verdict({ builds: 'unknown' });
      expect(unknown).toMatchObject({ act: 'refuse', word: 'launch-profile-unmet' });
      expect(unknown.act === 'refuse' && unknown.detail).toContain('unmeasured');
      expect(refuse(verdict({ builds: 'agreed' }))).toBe('create');
    },
    'step 4: an unspellable set is an input refusal, before the count': () => {
      expect(verdict({ accountPools: { pools: ['Bad Name'], untagged: false } })).toEqual({ act: 'refuse-input', why: 'unspellable' });
    },
    'step 5: the empty set and a one-account set refuse overlord-single-account with counts 0 and 1': () => {
      const none = verdict({ accountPools: { pools: [], untagged: false } });
      expect(none).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 0 });
      const one = verdict({ accountPools: { pools: ['pool-b'], untagged: false } });
      expect(one).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 1 });
    },
    'step 5: a signed-out or unservable account is listed and does not count': () => {
      const lim = { ...HEALTHY, 'lane-c': limit({ authDead: true }) };
      const v = verdict({ accountPools: SET_A, accounts: afacts(lim) });
      expect(v).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 1 });
    },
    'step 5: an unmeasured account never lets the count pass, and the refusal says the count is unmeasured': () => {
      const lim = { ...HEALTHY, 'lane-c': limit({ seven: null }) };
      const v = verdict({ accountPools: SET_A, accounts: afacts(lim) });
      expect(v).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 1 });
      expect(v.act === 'refuse' && v.detail).toContain('unmeasured');
      expect(refuse(verdict({ accountPools: SET_AB, accounts: afacts({ ...lim }) }))).toBe('create');
    },
    'a set admitting an API-key lane does not list it, and the pick never lands on it': () => {
      const v = verdict({ accountPools: SET_A, home: { wrapper: 'lane-pay', score: 0 } });
      expect(v).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-a,lane-c', poolset: 'pool-a' });
    },
    '+untagged admits untagged accounts, listed after every pool': () => {
      const v = verdict({ accountPools: { pools: ['pool-a'], untagged: true } });
      expect(v).toMatchObject({ act: 'create', acctorder: 'lane-a,lane-c,lane-d', poolset: 'pool-a+untagged' });
    },
    'a disabled account is neither listed nor counted': () => {
      const v = verdict({ accountPools: SET_A });
      expect(v).toMatchObject({ act: 'create', acctorder: 'lane-a,lane-c' });
    },
    'the pick is the home when it is counted, otherwise the first counted account': () => {
      expect(verdict({ home: { wrapper: 'lane-c', score: 1 } })).toMatchObject({ act: 'create', wrapper: 'lane-c' });
      expect(verdict({ home: { wrapper: 'lane-d', score: 1 } })).toMatchObject({ act: 'create', wrapper: 'lane-b' });
      expect(verdict({ home: null })).toMatchObject({ act: 'create', wrapper: 'lane-b' });
      const lim = { ...HEALTHY, 'lane-a': limit({ authDead: true }) };
      // The list orders every account, the pick is among the counted: a signed-out account stays in `acctorder`.
      expect(verdict({ accounts: afacts(lim), home: { wrapper: 'lane-a', score: 1 } }))
        .toMatchObject({ act: 'create', wrapper: 'lane-b', acctorder: 'lane-b,lane-a,lane-c' });
    },
  };
}

// ------------------------------------------------------------------------------------------------------- retireVerdict

export function retireVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  return {
    'a live binding retires, with any pending attempt cancelled by the act': () => {
      expect(m.retireVerdict(BOUND)).toEqual({ act: 'retire-live' });
      const both: DesignationRead = { kind: 'designated', sessionId: 'a', term: 1, row: view({
        bound: { sessionId: 'a', generation: 'g' },
        pending: { sessionId: 'b', kind: 'rebind', deadlineAt: 9, since: 1, actor: 'op', generation: null } }) };
      expect(m.retireVerdict(both)).toEqual({ act: 'retire-live' });
    },
    'a pending-only row cancels the attempt': () => { expect(m.retireVerdict(PENDING_ONLY)).toEqual({ act: 'cancel-pending' }); },
    'no row, or a row that binds nothing, is none': () => {
      expect(m.retireVerdict(NONE)).toEqual({ act: 'none' });
      expect(m.retireVerdict(ROW_NO_BODY)).toEqual({ act: 'none' });
    },
    'an unmeasured read is unmeasured': () => { expect(m.retireVerdict(UNMEASURED)).toEqual({ act: 'unmeasured' }); },
  };
}

// ----------------------------------------------------------------------------------------------------------- the sets

const MODULE = path.join(ROOT, 'server/src/coord/overlordDesignation.ts');

const DESIGNATE_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'D1 capability before exists', old: '  // 1. a session is bound or pending.', new: "  { const n: string[] = []; for (const w of DESIGNATE_CCD_WORDS) if (!present(f.ccdWords, w)) n.push(w); if (n.length > 0) return { act: 'refuse', word: 'capability-missing', detail: 'x', needs: n }; }\n  // 1. a session is bound or pending." },
    { id: 'D2 null ccdWords read as present', old: 'words !== null && words.includes(w)', new: 'words === null || words.includes(w)' },
    { id: 'D3 unknown builds pass', old: "f.builds !== 'agreed'", new: "f.builds === 'skewed'" },
    { id: 'D4 pick outside counted', old: 'f.home !== null && counted.includes(f.home.wrapper) ? f.home.wrapper : counted[0]!', new: 'f.home !== null ? f.home.wrapper : counted[0]!' },
    { id: 'D5 refused code 1 is not present', old: "(p.kind === 'refused' && p.code === 1)", new: 'false' },
    { id: 'D6 not-run read as present', old: "return p.kind === 'answer' || (", new: "return p.kind === 'answer' || p.kind === 'not-run' || (" },
    { id: 'D7 one counted account passes', old: 'counted.length < 2', new: 'counted.length < 1' },
    { id: 'D8 unspellable passes', old: "if (spelled.kind === 'unspellable') return { act: 'refuse-input', why: 'unspellable' };", new: '' },
    { id: 'D9 an unreadable row is not its own answer', old: "if (f.read.kind === 'unmeasured') {", new: 'if (false) {' },
    { id: 'D10 a pending attempt is not an existing one', old: ' || (row !== null && row.pending !== null)) {', new: ') {' },
    { id: 'D11 acctorder is the counted list', old: "list.join(',')", new: "counted.join(',')" },
    { id: 'D12 server words unchecked', old: 'for (const w of DESIGNATE_SERVER_WORDS) if (!f.serverWords.includes(w)) needs.push(w);', new: '' },
    { id: 'D13 an unparsed probe passes', old: "return p.kind === 'answer' || (", new: "return p.kind !== 'not-run' && p.kind !== 'refused' || (" },
  ], suite: designateVerdictCases };
const ACCOUNTS_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'A1 an API-key lane listed', old: "if (provider !== 'anthropic') return;", new: '' },
    { id: 'A2 an account outside the set listed', old: 'if (!poolRule(pool, side).ok) return;', new: '' },
    { id: 'A3 a disabled account listed', old: 'if (f.limits[a.id]?.disabled === true) return;', new: '' },
    { id: 'A4 roster order only', old: 'x.rank - y.rank || x.at - y.at', new: 'x.at - y.at' },
    { id: 'A5 untagged before every pool', old: 'named >= 0 ? named : set.pools.length', new: 'named >= 0 ? named : -1' },
    { id: 'A6 a signed-out account counted', old: 'if (f.limits[id]?.authDead === true) continue;', new: '' },
    { id: 'A7 an unmeasured account counted', old: "else if (s.kind !== 'unservable') unmeasured.push(id);", new: "else if (s.kind !== 'unservable') counted.push(id);" },
    { id: 'A8 an unservable account counted', old: "if (s.kind === 'servable') counted.push(id);", new: "if (s.kind !== 'unmeasured') counted.push(id);" },
    { id: 'A9 asked as a project session', old: "'set-side', f.nowS", new: "'other', f.nowS" },
    { id: 'A10 central edges ignored', old: 'resolvedAccountPool(a.id, a, f.edges)', new: 'resolvedAccountPool(a.id, a, new Map())' },
    { id: 'A13 a missing lane counted', old: 'if (lane === undefined) { unmeasured.push(id); continue; }', new: '' },
    { id: 'A12 an unmeasured account dropped', old: "else if (s.kind !== 'unservable') unmeasured.push(id);", new: '' },
  ], suite: overlordAccountsCases };
const RETIRE_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'R1 a live binding cancels', old: "return { act: 'retire-live' }", new: "return { act: 'cancel-pending' }" },
    { id: 'R2 a bodiless row cancels', old: 'read.row !== null && read.row.pending !== null ? ', new: 'read.row !== null ? ' },
    { id: 'R3 an unreadable row is none', old: "if (read.kind === 'unmeasured') return { act: 'unmeasured' };", new: "if (read.kind === 'unmeasured') return { act: 'none' };" },
    { id: 'R4 a pending attempt is none', old: "? { act: 'cancel-pending' } : { act: 'none' };", new: "? { act: 'none' } : { act: 'none' };" },
  ], suite: retireVerdictCases };

// ------------------------------------------------------------------------------- designationFactOf, identityOf (Task 3)

export type RoleOfDesignationModule = typeof import('../../src/roleOf.js');
const row = (live: string | null, pending: string | null, pendingKind: 'designate' | 'rebind' | null): DesignationFact =>
  ({ kind: 'row', live, pending, pendingKind, term: 3 });
const NO_ROW: DesignationFact = { kind: 'none' };

export function designationFactOfCases(m: RoleOfDesignationModule): Record<string, SuiteCase> {
  return {
    'no row reads none for every id': () => { expect(m.designationFactOf('overlord-quiet-otter', NO_ROW)).toBe('none'); },
    'the bound id reads live, and another id none': () => {
      const d = row('overlord-quiet-otter', null, null);
      expect(m.designationFactOf('overlord-quiet-otter', d)).toBe('live');
      expect(m.designationFactOf('lane-a-project-a', d)).toBe('none');
    },
    'a pending id reads pending (a designate attempt, a rebind attempt), and another id none': () => {
      for (const kind of ['designate', 'rebind'] as const) {
        const d = row(null, 'overlord-new-owl', kind);
        expect(m.designationFactOf('overlord-new-owl', d), kind).toBe('pending');
        expect(m.designationFactOf('lane-a-project-a', d), kind).toBe('none');
      }
    },
    'a rebind: the old body reads live and the new one pending': () => {
      const d = row('overlord-quiet-otter', 'overlord-new-owl', 'rebind');
      expect(m.designationFactOf('overlord-quiet-otter', d)).toBe('live');
      expect(m.designationFactOf('overlord-new-owl', d)).toBe('pending');
    },
  };
}

export function identityOfCases(m: RoleOfDesignationModule): Record<string, SuiteCase> {
  return {
    'no row: the session id': () => { expect(m.identityOf('overlord-quiet-otter', NO_ROW)).toBe('overlord-quiet-otter'); },
    'the live bound id is overlord': () => { expect(m.identityOf('overlord-quiet-otter', row('overlord-quiet-otter', null, null))).toBe('overlord'); },
    "a designate attempt's pending id is overlord": () => {
      expect(m.identityOf('overlord-new-owl', row(null, 'overlord-new-owl', 'designate'))).toBe('overlord');
    },
    "a rebind attempt's pending id keeps its own id, and the old body stays overlord": () => {
      const d = row('overlord-quiet-otter', 'overlord-new-owl', 'rebind');
      expect(m.identityOf('overlord-new-owl', d)).toBe('overlord-new-owl');
      expect(m.identityOf('overlord-quiet-otter', d)).toBe('overlord');
    },
    'another id is its own': () => {
      expect(m.identityOf('lane-a-project-a', row('overlord-quiet-otter', 'overlord-new-owl', 'rebind'))).toBe('lane-a-project-a');
      expect(m.identityOf('lane-a-project-a', row(null, 'overlord-new-owl', 'designate'))).toBe('lane-a-project-a');
    },
  };
}

const ROLE_OF_MODULE = path.join(ROOT, 'server/src/roleOf.ts');
const DESIGNATION_FACT_SET: MutantSet<RoleOfDesignationModule> = { modulePath: ROLE_OF_MODULE, mutants: [
    { id: 'F1 pending read as none', old: "if (d.pending === sessionId) return 'pending';", new: "if (d.pending === sessionId) return 'none';" },
    { id: 'F2 the bound id read as none', old: "if (d.live === sessionId) return 'live';", new: "if (d.live === sessionId) return 'none';" },
    { id: 'F3 a row names every id live', old: "if (d.live === sessionId) return 'live';", new: "if (d.live !== null) return 'live';" },
    { id: 'F4 a pending attempt names every id pending', old: "if (d.pending === sessionId) return 'pending';", new: "if (d.pending !== null) return 'pending';" },
  ], suite: designationFactOfCases };
const IDENTITY_SET: MutantSet<RoleOfDesignationModule> = { modulePath: ROLE_OF_MODULE, mutants: [
    { id: 'I1 a rebind pending body keyed overlord', old: "d.pending === sessionId && d.pendingKind === 'designate'", new: 'd.pending === sessionId' },
    { id: 'I2 a designate pending body keyed by its id', old: "d.pending === sessionId && d.pendingKind === 'designate'", new: 'false' },
    { id: 'I3 the live id keyed by its id', old: "if (d.live === sessionId) return 'overlord';", new: '' },
    { id: 'I4 every id keyed overlord under a row', old: "  return sessionId;\n}\n\n/** The one narrowing", new: "  return 'overlord';\n}\n\n/** The one narrowing" },
  ], suite: identityOfCases };

// ------------------------------------------------------------------------------------ retire's generation end (review 2349 F4)

export type DesignationStoreModule = typeof import('../../src/coord/overlordDesignationStore.js');
const STORE_MODULE = path.join(ROOT, 'server/src/coord/overlordDesignationStore.ts');
const APPENDED = { ok: true, kind: 'appended', record: {} } as unknown as AuthorityAppend;

/** A live designation over a minted generation, then a retire, over a coord db opened through the real migrations and an
 *  appender that always appends: no live `overlord` generation may remain. */
export function retireEndsGenerationCases(m: DesignationStoreModule): Record<string, SuiteCase> {
  return {
    'a live retire ends the retired body\'s live overlord generation': () => {
      const db = openCoordDb(path.join(mkTmp('ccrc-designation-sim-'), 'coord.db'));
      try {
        const id = 'overlord-quiet-otter'; const now = 1_800_000_000_000; const j = { appendInTx: () => APPENDED };
        const start = insertStart(db, { sessionId: id, reportId: 'r-1', uuid: '11111111-2222-3333-4444-555555555555', source: 'startup', model: 'claude-opus-5-5',
          rowIncarnation: null, reportedAt: now, receivedAt: now });
        if (!start.ok) throw new Error('start not recorded');
        expect(mintGeneration(db, { identity: id, sessionId: id, role: 'overlord', term: 1, rowIncarnation: null, startId: start.id,
          startReportedAt: now, resumed: false, model: 'claude-opus-5-5', lane: null, host: null, outcome: 'crashed', mono: 1, proc: 'p',
          now }, null, true).ok).toBe(true);
        expect(m.designatePending(db, j, { sessionId: id, deadlineAt: now + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
          actor: 'operator-a', at: now, opKey: 'op-designate-1' }).ok).toBe(true);
        expect(m.goLive(db, j, id, '11111111-2222-3333-4444-555555555555', now + 1)).toMatchObject({ ok: true, changed: true });
        expect(m.retire(db, j, { actor: 'operator-a', at: now + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
        expect(db.prepare("SELECT COUNT(*) AS n FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").get()).toEqual({ n: 0 });
      } finally { db.close(); }
    },
  };
}
const RETIRE_END_SET: MutantSet<DesignationStoreModule> = { modulePath: STORE_MODULE, mutants: [
    { id: 'E1 retire leaves the generation live', old: 'endOverlordGeneration(db, bound);', new: '' },
  ], suite: retireEndsGenerationCases };

export const DESIGNATION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/overlordDesignation.ts#designateVerdict': DESIGNATE_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#overlordAccounts': ACCOUNTS_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#retireVerdict': RETIRE_SET as MutantSet<never>,
  'server/src/roleOf.ts#designationFactOf': DESIGNATION_FACT_SET as MutantSet<never>,
  'server/src/roleOf.ts#identityOf': IDENTITY_SET as MutantSet<never>,
  'server/src/coord/overlordDesignationStore.ts#retire': RETIRE_END_SET as MutantSet<never>,
};
