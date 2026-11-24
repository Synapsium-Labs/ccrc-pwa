// The designation deciders' oracles and mutant sets (Overlord W1 designation A, plan Task 2). The cases are written ONCE
// here, as suite cases over a module: `overlord-designation-verdicts.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
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
import { gateActorOf } from '../../src/accounts/audit.js';
import { attributionIdentity } from '../../src/auth/attributionIdentity.js';

/** The operator's actor as a designation writer takes it: the account gate's actor minted through the identity port (gates A). */
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));

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

// ------------------------------------------------------------- the Settings doors (designation C, plan Tasks 8 and 9)

const PENDING_AND_BOUND: DesignationRead = { kind: 'designated', sessionId: 'overlord-x', term: 2, row: view({
  bound: { sessionId: 'overlord-x', generation: 'g1' },
  pending: { sessionId: 'overlord-z', kind: 'rebind', deadlineAt: 9, since: 1, actor: 'op', generation: null } }) };

/** lane-a, lane-b and lane-c can serve `fable` set-side: billing included and a fresh share reading under the ceiling. */
const FABLE_ROSTER: AFacts['roster'] = { ...ROSTER, accounts: ROSTER.accounts.map((a) => ({ ...a, fableBilling: 'included' as const })) };
const fableFacts = (): AFacts => afacts(HEALTHY, { roster: FABLE_ROSTER,
  shares: Object.fromEntries(['lane-a', 'lane-b', 'lane-c'].map((id) => [id, { finishedAtS: NOW_S, estimatePct: 5 }])) });
const atFable = (r: DesignationRead): DesignationRead =>
  (r.kind === 'unmeasured' || r.row === null ? r : { ...r, row: { ...r.row, model: 'fable' } }) as DesignationRead;

export function modelClassVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  return {
    'fable asks the step-up and opus does not (C45, §11.2)': () => {
      expect(m.modelStepUp('fable')).toBe(true);
      expect(m.modelStepUp('opus')).toBe(false);
    },
    'a change of class that two accounts serve is set, naming the bound body': () => {
      expect(m.modelClassVerdict(BOUND, 'fable', fableFacts())).toEqual({ act: 'set', bodies: ['overlord-x'], warnings: [] });
      expect(m.modelClassVerdict(atFable(BOUND), 'opus', afacts())).toEqual({ act: 'set', bodies: ['overlord-x'], warnings: [] });
    },
    'the bound body and a pending one both take the class; a pending-only row its pending body': () => {
      expect(m.modelClassVerdict(PENDING_AND_BOUND, 'fable', fableFacts())).toEqual({ act: 'set', bodies: ['overlord-x', 'overlord-z'], warnings: [] });
      expect(m.modelClassVerdict(PENDING_ONLY, 'fable', fableFacts())).toEqual({ act: 'set', bodies: ['overlord-y'], warnings: [] });
    },
    'C56 re-counted under the new class: fewer than two refuses while bound (model-door-recounts-c56)': () => {
      expect(m.modelClassVerdict(BOUND, 'fable', afacts())).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 0 });
    },
    'C56 re-counted under the new class: fewer than two refuses while pending': () => {
      expect(m.modelClassVerdict(PENDING_ONLY, 'fable', afacts())).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 0 });
    },
    'C56 re-counted under the new class: with no body the class is saved for the next Start, with the warning': () => {
      expect(m.modelClassVerdict(ROW_NO_BODY, 'fable', afacts())).toEqual({ act: 'set', bodies: [],
        warnings: [{ warning: 'overlord-single-account', count: 0 }] });
    },
    'a move to opus is a narrowing: fewer than two only warns, bound or pending, never refuses (review 2410 F2)': () => {
      const warned = { warning: 'overlord-single-account', count: 0 };
      expect(m.modelClassVerdict(atFable(BOUND), 'opus', afacts(HEALTHY, { lanes: {} })))
        .toEqual({ act: 'set', bodies: ['overlord-x'], warnings: [warned] });
      expect(m.modelClassVerdict(atFable(PENDING_ONLY), 'opus', afacts(HEALTHY, { lanes: {} })))
        .toEqual({ act: 'set', bodies: ['overlord-y'], warnings: [warned] });
    },
    'an unchanged class is none, and is never counted': () => { expect(m.modelClassVerdict(BOUND, 'opus', afacts(HEALTHY, { lanes: {} }))).toEqual({ act: 'none' }); },
    'no row is not-found; an unmeasured read is unmeasured': () => {
      expect(m.modelClassVerdict(NONE, 'fable', fableFacts())).toEqual({ act: 'not-found' });
      expect(m.modelClassVerdict(UNMEASURED, 'fable', fableFacts())).toMatchObject({ act: 'unmeasured' });
    },
  };
}

export function setWidensCases(m: DesignationModule): Record<string, SuiteCase> {
  return {
    'a pool added widens': () => { expect(m.setWidens(SET_A, SET_AB)).toBe(true); },
    'untagged turned on widens': () => { expect(m.setWidens(SET_A, { pools: ['pool-a'], untagged: true })).toBe(true); },
    'a narrowing does not widen': () => {
      expect(m.setWidens(SET_AB, SET_A)).toBe(false);
      expect(m.setWidens({ pools: ['pool-a'], untagged: true }, SET_A)).toBe(false);
    },
    'a pure reorder does not widen': () => { expect(m.setWidens(SET_AB, { pools: ['pool-a', 'pool-b'], untagged: false })).toBe(false); },
  };
}

/** Org labels on the fixture roster: lane-a and lane-c `org-a`, lane-b `org-b`; lane-d none. */
const withOrgs = (labels: Record<string, string>): AFacts['roster'] =>
  ({ ...ROSTER, accounts: ROSTER.accounts.map((a) => ({ ...a, org: labels[a.id] ?? null })) });
const ORGS = { 'lane-a': 'org-a', 'lane-b': 'org-b', 'lane-c': 'org-a' };
const REORDERED: PoolSet = { pools: ['pool-a', 'pool-b'], untagged: false };
const ONLY_B: PoolSet = { pools: ['pool-b'], untagged: false };
const EMPTY: PoolSet = { pools: [], untagged: false };
type SetVerdict = ReturnType<DesignationModule['accountSetVerdict']>;
const saved = (v: SetVerdict) => { if (v.act !== 'set' && v.act !== 'none') throw new Error(`expected a save, got ${v.act}`); return v; };

export function accountSetVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  return {
    'the step-up the door asks: a widening, an unreadable row; never a narrowing, a reorder or no row': () => {
      expect(m.accountSetStepUp(BOUND, { pools: ['pool-b', 'pool-a', 'pool-c'], untagged: false })).toBe(true);
      expect(m.accountSetStepUp(BOUND, SET_A)).toBe(false);
      expect(m.accountSetStepUp(BOUND, REORDERED)).toBe(false);
      expect(m.accountSetStepUp(UNMEASURED, SET_A)).toBe(true);
      expect(m.accountSetStepUp(NONE, SET_AB)).toBe(false);
    },
    'no row is not-found, an unmeasured read unmeasured, an unspellable set refuse-input': () => {
      expect(m.accountSetVerdict(NONE, SET_A, afacts(), true)).toEqual({ act: 'not-found' });
      expect(m.accountSetVerdict(UNMEASURED, SET_A, afacts(), true)).toMatchObject({ act: 'unmeasured' });
      expect(m.accountSetVerdict(BOUND, { pools: ['Bad Name'], untagged: false }, afacts(), true)).toEqual({ act: 'refuse-input', why: 'unspellable' });
    },
    'a widening the gate did not step up refuses step-up-required, re-read against the row it holds': () => {
      expect(m.accountSetVerdict(view2(SET_A), SET_AB, afacts(), false)).toMatchObject({ act: 'refuse', word: 'step-up-required' });
      expect(m.accountSetVerdict(view2(SET_A), SET_AB, afacts(), true).act).toBe('set');
      expect(m.accountSetVerdict(BOUND, SET_A, afacts(), false).act).toBe('set');
    },
    'below two refuses while bound or pending, with the count and no organization word': () => {
      for (const read of [BOUND, PENDING_ONLY]) {
        const v = m.accountSetVerdict(read, ONLY_B, afacts(HEALTHY, { roster: withOrgs(ORGS) }), true);
        expect(v).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 1 });
        expect(v).not.toHaveProperty('orgSpread');
      }
    },
    'an empty set refuses while bound, and is saved with a warning while unbound': () => {
      expect(m.accountSetVerdict(BOUND, EMPTY, afacts(), true)).toMatchObject({ act: 'refuse', word: 'overlord-single-account', count: 0 });
      const v = saved(m.accountSetVerdict(ROW_NO_BODY, EMPTY, afacts(), true));
      expect(v).toMatchObject({ act: 'set', bodies: [], poolset: '', acctorder: '' });
      expect(v.warnings).toEqual([{ warning: 'overlord-single-account', count: 0 }]);
    },
    'below two with no body is saved for the next Start and warns': () => {
      const v = saved(m.accountSetVerdict(ROW_NO_BODY, ONLY_B, afacts(), true));
      expect(v.act).toBe('set');
      expect(v.warnings).toEqual([{ warning: 'overlord-single-account', count: 1 }]);
    },
    'the same set re-sent is none, and its count only warns even while bound': () => {
      const low = { ...BOUND, row: view({ bound: { sessionId: 'overlord-x', generation: 'g1' }, accountPools: ONLY_B }) } as DesignationRead;
      const v = saved(m.accountSetVerdict(low, ONLY_B, afacts(), true));
      expect(v.act).toBe('none');
      expect(v.warnings).toEqual([{ warning: 'overlord-single-account', count: 1 }]);
      expect(saved(m.accountSetVerdict(BOUND, SET_AB, afacts(), true)).act).toBe('none');
    },
    'a set carries the spelling, the list in the set\'s order, the bodies, and unknown names as warnings': () => {
      const v = saved(m.accountSetVerdict(PENDING_AND_BOUND, { pools: ['pool-a', 'pool-z', 'pool-b'], untagged: false }, afacts(), true));
      expect(v).toMatchObject({ act: 'set', bodies: ['overlord-x', 'overlord-z'], acctorder: 'lane-a,lane-c,lane-b' });
      expect(v.poolset).not.toBe('');
      expect(v.warnings).toEqual([{ warning: 'unknown-pool', pool: 'pool-z' }]);
      expect(v.accounts.counted).toEqual(['lane-a', 'lane-c', 'lane-b']);
    },
    'the route\'s list is C56\'s whole list, a signed-out account included, never only the counted ones': () => {
      const v = saved(m.accountSetVerdict(BOUND, REORDERED, afacts({ ...HEALTHY, 'lane-c': limit({ authDead: true }) }), true));
      expect(v.accounts.counted).toEqual(['lane-a', 'lane-b']);
      expect(v.acctorder).toBe('lane-a,lane-c,lane-b');
    },
    'a reorder is a set (the order lives in the row) and needs no step-up': () => {
      const v = saved(m.accountSetVerdict(BOUND, REORDERED, afacts(), false));
      expect(v).toMatchObject({ act: 'set', acctorder: 'lane-a,lane-c,lane-b' });
    },
    'K2a: a set across two organizations saves and warns many': () => {
      const v = saved(m.accountSetVerdict(BOUND, REORDERED, afacts(HEALTHY, { roster: withOrgs(ORGS) }), true));
      expect(v.act).toBe('set');
      expect(v.orgSpread).toEqual({ kind: 'many', orgs: 2, unlabelled: 0 });
    },
    'K2a: one organization says one, some unlabelled say partly, none labelled say none': () => {
      expect(saved(m.accountSetVerdict(BOUND, SET_A, afacts(HEALTHY, { roster: withOrgs(ORGS) }), true)).orgSpread.kind).toBe('one');
      expect(saved(m.accountSetVerdict(BOUND, SET_A, afacts(HEALTHY, { roster: withOrgs({ 'lane-a': 'org-a' }) }), true)).orgSpread)
        .toEqual({ kind: 'partly', orgs: 1, unlabelled: 1 });
      expect(saved(m.accountSetVerdict(BOUND, SET_A, afacts(), true)).orgSpread.kind).toBe('none');
    },
    'K2a: an unmeasured count warns nothing': () => {
      const f = afacts(HEALTHY, { roster: withOrgs(ORGS) });
      const lanes = { ...f.lanes };
      delete lanes['lane-b'];
      const v = saved(m.accountSetVerdict(BOUND, REORDERED, { ...f, lanes }, true));
      expect(v.orgSpread).toEqual({ kind: 'unmeasured', orgs: 0, unlabelled: 0 });
    },
  };
}
/** A bound row holding the given set. */
const view2 = (accountPools: PoolSet): DesignationRead =>
  ({ kind: 'designated', sessionId: 'overlord-x', term: 2, row: view({ bound: { sessionId: 'overlord-x', generation: 'g1' }, accountPools }) });

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

const MODEL_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'M1 fable asks no step-up', old: "model === 'fable';", new: 'false;' },
    { id: 'M2 an unchanged class is set', old: "if (read.row.model === model) return { act: 'none' };", new: '' },
    { id: 'M5 the model door does not re-count C56', old: 'if (modelStepUp(model) && bodies.length > 0 && count <= 1) {', new: 'if (false) {' },
    { id: 'M7 a move to opus refuses below two', old: 'if (modelStepUp(model) && bodies', new: 'if (bodies' },
    { id: 'M8 below two never warns', old: "count <= 1 ? [{ warning: 'overlord-single-account', count }] : []", new: '[]' },
    { id: 'M6 the re-count is under the old class', old: 'overlordAccounts(read.row.accountPools, model, f)', new: 'overlordAccounts(read.row.accountPools, read.row.model, f)' },
    { id: 'M3 no row is set', old: "if (read.row === null) return { act: 'not-found' };", new: "if (read.row === null) return { act: 'set', bodies: [] };" },
    { id: 'M4 a pending body is not written', old: '[v.bound?.sessionId, v.pending?.sessionId]', new: '[v.bound?.sessionId]' },
  ], suite: modelClassVerdictCases };
const WIDENS_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'W1 a reorder read as a widening', old: 'next.pools.some((p) => !old.pools.includes(p))', new: 'next.pools.some((p, n) => old.pools[n] !== p)' },
    { id: 'W2 untagged on is no widening', old: '(next.untagged && !old.untagged) || ', new: '' },
  ], suite: setWidensCases };
const ACCOUNT_SET_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'S1 the count skipped while bound', old: 'if (bodies.length > 0 && !same) {', new: 'if (false) {' },
    { id: 'S2 the step-up not re-checked', old: 'if (!stepped && setWidens(row.accountPools, next)) {', new: 'if (false) {' },
    { id: 'S3 an unreadable row asks no step-up', old: "if (read.kind === 'unmeasured') return true;", new: "if (read.kind === 'unmeasured') return false;" },
    { id: 'S4 an unknown pool not warned', old: '!poolRostered(f.roster, p)', new: 'false' },
    { id: 'S5 an unbound count not warned', old: "warnings.push({ warning: 'overlord-single-account', count });", new: '' },
    { id: 'S6 the same set is set', old: "act: same ? 'none' : 'set'", new: "act: 'set'" },
    { id: 'S7 a partial figure warns', old: "accounts.unmeasured.length > 0 ? 'unmeasured' : ", new: '' },
    { id: 'K1 many refuses (K2a)', old: '  const org = new Map(', new: "  if (orgSpread(accounts.counted.map((id) => f.roster.accounts.find((a) => a.id === id)?.org ?? null)).kind === 'many') return { act: 'refuse', word: 'overlord-single-account', detail: 'many', count };\n  const org = new Map(" },
    { id: 'S8 the list is the counted list', old: '[...accounts.list]', new: '[...accounts.counted]' },
    { id: 'S9 no row reads a save', old: "if (row === null) return { act: 'not-found' };", new: "if (row === null) return { act: 'unmeasured', why: 'x' };" },
  ], suite: accountSetVerdictCases };

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
          actor: OPERATOR, at: now, opKey: 'op-designate-1' }).ok).toBe(true);
        expect(m.goLive(db, j, id, '11111111-2222-3333-4444-555555555555', now + 1)).toMatchObject({ ok: true, changed: true });
        expect(m.retire(db, j, { actor: OPERATOR, at: now + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
        expect(liveOverlordGenerations(db)).toBe(0);
      } finally { db.close(); }
    },
    'a pending-only retire ends the cancelled body\'s generation (review 2366 N3)': () => pendingCase((db, id, now) => {
      expect(m.retire(db, PENDING_J, { actor: OPERATOR, at: now + 1, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true, owed: [id] });
    }, m),
    'a live retire with a pending attempt ends the pending body\'s generation (review 2366 N3)': () => {
      const db = openCoordDb(path.join(mkTmp('ccrc-designation-sim-'), 'coord.db'));
      try {
        const bound = 'overlord-brisk-heron'; const id = 'overlord-quiet-otter'; const now = 1_800_000_000_000;
        expect(m.designatePending(db, PENDING_J, { sessionId: bound, deadlineAt: now + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
          actor: OPERATOR, at: now, opKey: 'op-designate-1' }).ok).toBe(true);
        expect(m.goLive(db, PENDING_J, bound, '66666666-7777-8888-9999-000000000000', now + 1)).toMatchObject({ ok: true, changed: true });
        mintOverlord(db, id, now);
        db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = 1, pendingDeadlineAt = 2, pendingActor = 'o', "
          + "pendingActorKind = 'operator', pendingActorIssuer = 'account-gate', pendingActorStrength = 'operator'").run(id);
        expect(m.retire(db, PENDING_J, { actor: OPERATOR, at: now + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
        expect(liveOverlordGenerations(db)).toBe(0);
      } finally { db.close(); }
    },
  };
}
const PENDING_J = { appendInTx: () => APPENDED };
const liveOverlordGenerations = (db: DatabaseSync): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").get() as { n: number }).n;
/** One live `overlord` generation for the pending body `id` (identity `overlord`, as `identityOf` names it), minted from a recorded start. */
function mintOverlord(db: DatabaseSync, id: string, now: number): void {
  const start = insertStart(db, { sessionId: id, reportId: `r-${id}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: now, receivedAt: now });
  if (!start.ok) throw new Error('start not recorded');
  expect(mintGeneration(db, { identity: 'overlord', sessionId: id, role: 'overlord', term: 1, rowIncarnation: null, startId: start.id,
    startReportedAt: now, resumed: false, model: 'claude-opus-5-5', lane: null, host: null, outcome: 'crashed', mono: 1, proc: 'p',
    now }, null, true).ok).toBe(true);
}
/** A pending designation whose body started (a live `overlord` generation), then `act`: no live `overlord` generation may remain. */
function pendingCase(act: (db: DatabaseSync, id: string, now: number) => void, m: DesignationStoreModule): void {
  const db = openCoordDb(path.join(mkTmp('ccrc-designation-sim-'), 'coord.db'));
  try {
    const id = 'overlord-quiet-otter'; const now = 1_800_000_000_000;
    mintOverlord(db, id, now);
    expect(m.designatePending(db, PENDING_J, { sessionId: id, deadlineAt: now + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
      actor: OPERATOR, at: now, opKey: 'op-designate-1' }).ok).toBe(true);
    act(db, id, now);
    expect(liveOverlordGenerations(db)).toBe(0);
  } finally { db.close(); }
}
const RETIRE_END_SET: MutantSet<DesignationStoreModule> = { modulePath: STORE_MODULE, mutants: [
    { id: 'E1 retire leaves the generation live', old: 'endOverlordGeneration(db, bound);', new: '' },
    { id: 'E2 a pending-only retire leaves the pending body\'s generation live', old: 'endOverlordGeneration(db, id);', new: '' },
    { id: 'E3 a live retire leaves the pending body\'s generation live', old: 'if (p !== null) endOverlordGeneration(db, p.sessionId);', new: '' },
  ], suite: retireEndsGenerationCases };

/** A failed pending attempt whose body started: `failPending` ends its generation (review 2366 N3). */
export function failPendingEndsGenerationCases(m: DesignationStoreModule): Record<string, SuiteCase> {
  return {
    'failPending ends the failed attempt\'s generation': () => pendingCase((db, id, now) => {
      expect(m.failPending(db, id, 'create-failed', now + 1, true)).toEqual({ ok: true, changed: true });
    }, m),
  };
}
const FAIL_END_SET: MutantSet<DesignationStoreModule> = { modulePath: STORE_MODULE, mutants: [
    { id: 'E4 failPending leaves the generation live', old: 'endOverlordGeneration(db, sessionId);', new: '' },
  ], suite: failPendingEndsGenerationCases };

// ------------------------------------------------------------------------- designation B: rebind, Restart, the deadline sweep

type RebindFacts = Parameters<DesignationModule['rebindVerdict']>[0];
const PEND = (over: Record<string, unknown> = {}) => ({
  sessionId: 'overlord-new-owl', kind: 'rebind' as const, deadlineAt: 100, since: 1, actor: 'op', generation: 'g2' as string | null, ...over,
});
/** A live binding (`overlord-x`), with the row's own class and set and whatever else is asked of it. */
export const boundRead = (over: Partial<DesignationView> = {}): DesignationRead =>
  ({ kind: 'designated', sessionId: 'overlord-x', term: 2, row: view({ bound: { sessionId: 'overlord-x', generation: 'g1' }, ...over }) });
/** Rebind's facts: a live binding, its old body dead, no force; the class and the set are the ROW's, so they are not facts. */
export const rfacts = (over: Partial<RebindFacts> = {}): RebindFacts => {
  const { model: _m, accountPools: _p, ...rest } = dfacts();
  void _m; void _p;
  return { ...rest, read: boundRead(), old: 'dead', force: false, ...over };
};

export function rebindVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  const verdict = (over: Partial<RebindFacts> = {}) => m.rebindVerdict(rfacts(over));
  const word = (v: ReturnType<DesignationModule['rebindVerdict']>) => (v.act === 'refuse' ? v.word : v.act);
  return {
    'a healthy fleet, a dead old body: creates under the row\'s own set, in its order': () => {
      expect(verdict()).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-b,lane-a,lane-c', poolset: 'pool-a,pool-b' });
    },
    'step 1: an unreadable row is unmeasured, whatever else is wrong': () => {
      expect(verdict({ read: UNMEASURED, old: 'alive', ccdWords: null })).toMatchObject({ act: 'unmeasured' });
    },
    'step 2: no live binding is not-found (none, a row with no body, a pending-only row), whatever else is wrong': () => {
      for (const read of [NONE, ROW_NO_BODY, PENDING_ONLY]) {
        expect(word(verdict({ read, old: 'alive', ccdWords: null, builds: 'skewed' }))).toBe('not-found');
      }
    },
    'step 3: a pending attempt refuses overlord-attempt-pending, before the old body is measured': () => {
      const read = boundRead({ pending: PEND() });
      expect(word(verdict({ read, old: 'alive', ccdWords: null }))).toBe('overlord-attempt-pending');
      expect(word(verdict({ read, old: 'unmeasurable', force: true }))).toBe('overlord-attempt-pending');
    },
    'step 4: an alive body, and one that cannot be measured, refuse overlord-body-alive; dead passes': () => {
      expect(verdict({ old: 'alive' })).toMatchObject({ act: 'refuse', word: 'overlord-body-alive' });
      expect(verdict({ old: 'unmeasurable' })).toMatchObject({ act: 'refuse', word: 'overlord-body-alive' });
      expect(word(verdict({ old: 'dead' }))).toBe('create');
    },
    'force lifts only the alive step': () => {
      expect(word(verdict({ old: 'alive', force: true }))).toBe('create');
      expect(word(verdict({ old: 'unmeasurable', force: true }))).toBe('create');
      expect(word(verdict({ old: 'alive', force: true, ccdWords: null }))).toBe('capability-missing');
      expect(word(verdict({ old: 'alive', force: true, builds: 'skewed' }))).toBe('launch-profile-unmet');
      expect(word(verdict({ old: 'alive', force: true, read: boundRead({ pending: PEND() }) }))).toBe('overlord-attempt-pending');
      expect(word(verdict({ old: 'alive', force: true, read: NONE }))).toBe('not-found');
    },
    'designate\'s steps follow, in order: capability, launch profile, unspellable set, one account': () => {
      const all = { ccdWords: null, serverWords: [], builds: 'skewed', probe: { kind: 'not-run' } } as Partial<RebindFacts>;
      const bad = boundRead({ accountPools: { pools: ['bad name'], untagged: false } });
      expect(word(verdict({ ...all, read: bad }))).toBe('capability-missing');
      expect(word(verdict({ ...all, read: bad, ccdWords: ALL_CCD, serverWords: SERVER_WORDS, probe: ANSWER }))).toBe('launch-profile-unmet');
      expect(word(verdict({ read: bad }))).toBe('refuse-input');
      expect(word(verdict({ read: boundRead({ accountPools: { pools: ['pool-b'], untagged: false } }) }))).toBe('overlord-single-account');
    },
    'the class is the row\'s: a fable row with no fable share facts counts no account': () => {
      expect(verdict({ read: boundRead({ model: 'fable' }) })).toMatchObject({ act: 'refuse', word: 'overlord-single-account' });
      expect(word(verdict({ read: boundRead({ model: 'opus' }) }))).toBe('create');
    },
    'the set is the row\'s: a one-pool row counts that pool only, and its order rides the create': () => {
      expect(verdict({ read: boundRead({ accountPools: SET_A }) })).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-a,lane-c', poolset: 'pool-a' });
      expect(verdict({ read: boundRead({ accountPools: { pools: ['pool-a', 'pool-b'], untagged: false } }) }))
        .toMatchObject({ act: 'create', acctorder: 'lane-a,lane-c,lane-b' });
    },
    'the pick stays inside the counted list': () => {
      expect(verdict({ home: { wrapper: 'lane-off', score: 1 } })).toMatchObject({ act: 'create', wrapper: 'lane-b' });
    },
  };
}

type PendingTime = Parameters<DesignationModule['pendingDeadlineOf']>;
export function pendingDeadlineCases(m: DesignationModule): Record<string, SuiteCase> {
  const OWN = { kind: 'reported', sessionId: 'overlord-new-owl', startId: 7, generation: 'g2', held: true } as const;
  const none = { kind: 'no-report' } as const;
  const pend = (over: Record<string, unknown> = {}, row: Partial<DesignationView> = {}): DesignationRead =>
    boundRead({ pending: PEND(over), ...row });
  const run = (...a: PendingTime) => m.pendingDeadlineOf(...a);
  return {
    'an unreadable row, and no row at all, act on nothing': () => {
      expect(run(UNMEASURED, OWN, 1_000)).toEqual({ kind: 'none' });
      expect(run(NONE, OWN, 1_000)).toEqual({ kind: 'none' });
    },
    'pending one tick before its deadline with no report: nothing': () => { expect(run(pend(), none, 99)).toEqual({ kind: 'none' }); },
    'pending at exactly its deadline: expire deadline-passed': () => {
      expect(run(pend(), none, 100)).toEqual({ kind: 'expire', sessionId: 'overlord-new-owl', outcome: 'deadline-passed' });
    },
    'past the deadline with its own held report: authority-unrecorded': () => {
      expect(run(pend(), OWN, 101)).toEqual({ kind: 'expire', sessionId: 'overlord-new-owl', outcome: 'authority-unrecorded' });
      expect(run(pend(), OWN, 100)).toMatchObject({ kind: 'expire', outcome: 'authority-unrecorded' });
    },
    'past the deadline with a failed report: deadline-passed': () => {
      expect(run(pend(), { ...OWN, held: false }, 101)).toEqual({ kind: 'expire', sessionId: 'overlord-new-owl', outcome: 'deadline-passed' });
    },
    'past the deadline with a held report of another generation or another session: deadline-passed': () => {
      expect(run(pend(), { ...OWN, generation: 'g9' }, 101)).toMatchObject({ kind: 'expire', outcome: 'deadline-passed' });
      expect(run(pend(), { ...OWN, sessionId: 'overlord-other-owl' }, 101)).toMatchObject({ kind: 'expire', outcome: 'deadline-passed' });
      expect(run(pend(), { ...OWN, generation: null }, 101)).toMatchObject({ kind: 'expire', outcome: 'deadline-passed' });
    },
    'an unread or absent report never makes a held one': () => {
      expect(run(pend(), { kind: 'unread', why: 'x' }, 101)).toMatchObject({ kind: 'expire', outcome: 'deadline-passed' });
    },
    'inside the deadline with its own report: resettle that start, held or not': () => {
      expect(run(pend(), OWN, 50)).toEqual({ kind: 'resettle', sessionId: 'overlord-new-owl', startId: 7 });
      expect(run(pend(), { ...OWN, held: false, startId: 9 }, 99)).toEqual({ kind: 'resettle', sessionId: 'overlord-new-owl', startId: 9 });
    },
    'inside the deadline with another generation\'s or session\'s report: no resettle; owed stops drain, else nothing': () => {
      expect(run(pend(), { ...OWN, generation: 'g9' }, 50)).toEqual({ kind: 'none' });
      expect(run(pend(), { ...OWN, sessionId: 'overlord-other-owl' }, 50)).toEqual({ kind: 'none' });
      expect(run(pend({}, { stopsOwed: ['o-1', 'o-2'] }), { ...OWN, generation: 'g9' }, 50)).toEqual({ kind: 'drain', ids: ['o-1', 'o-2'] });
    },
    'a pending generation not yet answered is never resettled, even by a report that names none': () => {
      expect(run(pend({ generation: null }), OWN, 50)).toEqual({ kind: 'none' });
      expect(run(pend({ generation: null }), { ...OWN, generation: null }, 50)).toEqual({ kind: 'none' });
    },
    'no pending attempt: owed stops drain with those ids, else nothing': () => {
      expect(run(boundRead({ stopsOwed: ['o-1'] }), none, 1_000)).toEqual({ kind: 'drain', ids: ['o-1'] });
      expect(run(boundRead(), none, 1_000)).toEqual({ kind: 'none' });
      expect(run(ROW_NO_BODY, OWN, 1_000)).toEqual({ kind: 'none' });
    },
    'a pending attempt past its deadline expires before any drain': () => {
      expect(run(pend({}, { stopsOwed: ['o-1'] }), none, 100)).toMatchObject({ kind: 'expire' });
    },
  };
}

type OverlordBodyLike = Parameters<DesignationModule['restartVerdict']>[1];
export function restartVerdictCases(m: DesignationModule): Record<string, SuiteCase> {
  const bound = { sessionId: 'overlord-x' };
  const ref = (b: typeof bound | null, body: OverlordBodyLike) => m.restartVerdict(b, body);
  const alive = { ok: false, error: 'overlord-body-alive' } as const;
  return {
    'no live binding is not-found, whatever the body reads': () => {
      for (const body of [{ kind: 'up' }, { kind: 'asleep' }, { kind: 'gone', cause: 'absent' }] as OverlordBodyLike[]) {
        expect(ref(null, body)).toEqual({ ok: false, error: 'not-found' });
      }
    },
    'an up body refuses overlord-body-alive (alive)': () => { expect(ref(bound, { kind: 'up' })).toEqual({ ...alive, detail: 'alive' }); },
    'a down body refuses overlord-body-alive (restarting): the supervisor has it': () => {
      expect(ref(bound, { kind: 'down', since: 5 })).toEqual({ ...alive, detail: 'restarting' });
      expect(ref(bound, { kind: 'down', since: null })).toEqual({ ...alive, detail: 'restarting' });
    },
    'an unmeasured body refuses overlord-body-alive (unmeasured)': () => {
      expect(ref(bound, { kind: 'unmeasured', why: 'x' })).toEqual({ ...alive, detail: 'unmeasured' });
    },
    'an asleep body and a gone one may be restarted': () => {
      expect(ref(bound, { kind: 'asleep' })).toEqual({ ok: true });
      for (const cause of ['absent', 'stopped', 'orphan', 'never-started'] as const) expect(ref(bound, { kind: 'gone', cause })).toEqual({ ok: true });
    },
  };
}

const REBIND_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'R1 the unreadable row is not its own answer', old: "if (f.read.kind === 'unmeasured') return { act: 'unmeasured', why: `the designation could not be read: ${f.read.why}` };\n  if (f.read.kind !== 'designated')",
      new: "if (f.read.kind !== 'designated')" },
    { id: 'R2 no binding is not not-found', old: "if (f.read.kind !== 'designated') return { act: 'refuse', word: 'not-found'", new: "if (false) return { act: 'refuse', word: 'not-found'" },
    { id: 'R3 rebind drops the pending step', old: "if (row.pending !== null) return { act: 'refuse', word: 'overlord-attempt-pending'", new: "if (false) return { act: 'refuse', word: 'overlord-attempt-pending'" },
    { id: 'R4 rebind drops the alive step', old: "if (f.old !== 'dead' && !f.force) {", new: 'if (false) {' },
    { id: 'R5 an unmeasurable body is dead', old: "if (f.old !== 'dead' && !f.force) {", new: "if (f.old === 'alive' && !f.force) {" },
    { id: 'R6 force is ignored', old: "if (f.old !== 'dead' && !f.force) {", new: "if (f.old !== 'dead') {" },
    { id: 'R7 the pending step after the alive one', old: "if (row.pending !== null) return { act: 'refuse', word: 'overlord-attempt-pending', detail: 'an attempt is already pending on the designation' };\n  if (f.old !== 'dead' && !f.force) {",
      new: "if (f.old !== 'dead' && !f.force) {" },
    { id: 'R8 the class is not the row\'s', old: 'model: row.model, accountPools: row.accountPools', new: "model: 'opus', accountPools: row.accountPools" },
    { id: 'R9 the set is not the row\'s', old: 'model: row.model, accountPools: row.accountPools', new: "model: row.model, accountPools: { pools: ['pool-a', 'pool-b'], untagged: false }" },
    { id: 'R10 the capability step is skipped under force', old: 'return createSteps({ ...f,', new: 'if (f.force) return { act: \'create\', wrapper: \'lane-a\', acctorder: \'\', poolset: \'\' };\n  return createSteps({ ...f,' },
  ], suite: rebindVerdictCases };
const RESTART_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'S1 an up body may be restarted', old: "case 'up': return { ok: false, error: 'overlord-body-alive', detail: 'alive' };", new: "case 'up': return { ok: true };" },
    { id: 'S2 a restarting body may be restarted', old: "case 'down': return { ok: false, error: 'overlord-body-alive', detail: 'restarting' };", new: "case 'down': return { ok: true };" },
    { id: 'S3 an unmeasured body may be restarted', old: "case 'unmeasured': return { ok: false, error: 'overlord-body-alive', detail: 'unmeasured' };", new: "case 'unmeasured': return { ok: true };" },
    { id: 'S4 no binding is restartable', old: "if (binding === null) return { ok: false, error: 'not-found' };", new: '' },
    { id: 'S5 an asleep body is not restartable', old: "case 'asleep': case 'gone': return { ok: true };", new: "case 'asleep': return { ok: false, error: 'overlord-body-alive', detail: 'alive' };\n    case 'gone': return { ok: true };" },
  ], suite: restartVerdictCases };
const DEADLINE_SET: MutantSet<DesignationModule> = { modulePath: MODULE, mutants: [
    { id: 'T1 expires one tick early', old: 'if (now >= p.deadlineAt)', new: 'if (now >= p.deadlineAt - 1)' },
    { id: 'T2 expires one tick late', old: 'if (now >= p.deadlineAt)', new: 'if (now > p.deadlineAt)' },
    { id: 'T3 a held attempt expires deadline-passed', old: "own?.held === true ? 'authority-unrecorded' : 'deadline-passed'", new: "'deadline-passed'" },
    { id: 'T4 a failed report expires authority-unrecorded', old: "own?.held === true ? 'authority-unrecorded' : 'deadline-passed'", new: "own !== null ? 'authority-unrecorded' : 'deadline-passed'" },
    { id: 'T5 another session\'s report is its own', old: 'settle.sessionId === p.sessionId && ', new: '' },
    { id: 'T6 another generation\'s report is its own', old: ' && settle.generation === p.generation', new: '' },
    { id: 'T7 an unanswered generation is resettled', old: 'p.generation !== null && ', new: '' },
    { id: 'T8 an own report is never resettled', old: 'if (own !== null) return { kind: \'resettle\'', new: 'if (false) return { kind: \'resettle\'' },
    { id: 'T9 the resettle names no start', old: 'startId: own.startId };', new: 'startId: 0 };' },
    { id: 'T10 owed stops are never drained', old: 'return read.row.stopsOwed.length > 0 ? {', new: 'return read.row.stopsOwed.length < 0 ? {' },
    { id: 'T11 the drain names no ids', old: "{ kind: 'drain', ids: read.row.stopsOwed }", new: "{ kind: 'drain', ids: [] }" },
    { id: 'T12 an unreadable row is read', old: "if (read.kind === 'unmeasured' || read.row === null) return { kind: 'none' };", new: "if (read.row === null) return { kind: 'none' };" },
  ], suite: pendingDeadlineCases };

export const DESIGNATION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/overlordDesignation.ts#designateVerdict': DESIGNATE_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#overlordAccounts': ACCOUNTS_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#retireVerdict': RETIRE_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#modelClassVerdict': MODEL_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#setWidens': WIDENS_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#accountSetVerdict': ACCOUNT_SET_SET as MutantSet<never>,
  'server/src/roleOf.ts#designationFactOf': DESIGNATION_FACT_SET as MutantSet<never>,
  'server/src/roleOf.ts#identityOf': IDENTITY_SET as MutantSet<never>,
  'server/src/coord/overlordDesignationStore.ts#retire': RETIRE_END_SET as MutantSet<never>,
  'server/src/coord/overlordDesignationStore.ts#failPending': FAIL_END_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#rebindVerdict': REBIND_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#restartVerdict': RESTART_SET as MutantSet<never>,
  'server/src/coord/overlordDesignation.ts#pendingDeadlineOf': DEADLINE_SET as MutantSet<never>,
};
