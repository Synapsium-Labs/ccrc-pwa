import { describe, expect, it } from 'vitest';
import { RUN_KINDS, type ChildMark } from '../../shared/api.js';
import { FLEET_ROLES, type FleetRole } from '../../shared/fleetRoles.js';
import * as roleOfModule from '../src/roleOf.js';
import { ROLE_AMBIGUITIES, ROLE_FACTS_CHILD_AXIS, roleOf, sessionRoleOf, sessionRoleOfReading, type RoleAmbiguity, type RoleFacts, type RoleReading } from '../src/roleOf.js';
import { roleFactsOfCases } from './sim/renewalDeciderSets.js';
import { designationFactOfCases, identityOfCases } from './sim/designationSets.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';

const BASE: RoleFacts = { designation: 'none', auditBody: false, replayBody: false, child: { kind: 'none' },
  childRunKind: 'unmeasured', claimsOpenRun: 'no', declaredIntent: 'no' };
const role = (r: FleetRole): RoleReading => ({ kind: 'role', role: r });
const undecided = (between: RoleAmbiguity): RoleReading => ({ kind: 'undecided', between });
const CHILD7: ChildMark = { kind: 'child', runId: 7 };

describe('roleOf: Table 3.3.9a, first match wins', () => {
  it.each<[string, Partial<RoleFacts>, RoleReading]>([
    ['a pending designation is the Overlord, whatever else holds', { designation: 'pending', child: CHILD7, childRunKind: 'work', claimsOpenRun: 'yes' }, role('overlord')],
    ['a live designation is the Overlord', { designation: 'live' }, role('overlord')],
    ['an audit row is the auditor, before a replay row', { auditBody: true, replayBody: true }, role('auditor')],
    ['a replay row is a replay body', { replayBody: true }, role('replay')],
    ['a child of a work run is a worker, even claiming', { child: CHILD7, childRunKind: 'work', claimsOpenRun: 'yes', declaredIntent: 'yes' }, role('worker')],
    ['a child of a review run is a reviewer', { child: CHILD7, childRunKind: 'review' }, role('reviewer')],
    ['a child of a run whose kind this build cannot name is undecided', { child: CHILD7, childRunKind: 'unknown' }, undecided('worker-or-reviewer')],
    ['an unreadable marker is undecided between worker and reviewer', { child: { kind: 'unreadable' }, childRunKind: 'work' }, undecided('worker-or-reviewer')],
    ['a claim on an open run is a coordinator', { claimsOpenRun: 'yes', declaredIntent: 'unmeasured' }, role('coordinator')],
    ['declared intent is a coordinator', { claimsOpenRun: 'unmeasured', declaredIntent: 'yes' }, role('coordinator')],
    ['neither is plain', {}, role('plain')],
    ['an unmeasured claim is never read as no', { claimsOpenRun: 'unmeasured' }, undecided('coordinator-or-plain')],
  ])('%s', (_name, over, want) => { expect(roleOf({ ...BASE, ...over })).toEqual(want); });
});

describe('roleOf: every combination of facts', () => {
  const words = ['yes', 'no', 'unmeasured'] as const;
  const children: ChildMark[] = [{ kind: 'none' }, CHILD7, { kind: 'unreadable' }];
  const cases: RoleFacts[] = [];
  for (const designation of ['none', 'pending', 'live'] as const)
    for (const auditBody of [false, true])
      for (const replayBody of [false, true])
        for (const child of children)
          for (const childRunKind of [...RUN_KINDS, 'unmeasured'] as const)
            for (const claimsOpenRun of words)
              for (const declaredIntent of words)
                cases.push({ designation, auditBody, replayBody, child, childRunKind, claimsOpenRun, declaredIntent });

  it('enumerates 1,296 cases', () => { expect(cases.length).toBe(1296); });

  it('answers every case as the first matching rule says', () => {
    for (const f of cases) {
      const got = roleOf(f);
      const ctx = JSON.stringify(f);
      const r1 = f.designation === 'pending' || f.designation === 'live';
      const r2 = f.auditBody;
      const r3 = f.replayBody;
      const r4 = f.child.kind === 'unreadable';
      const r5 = f.child.kind === 'child';
      const r6 = f.claimsOpenRun === 'yes' || f.declaredIntent === 'yes';
      const r7 = f.claimsOpenRun === 'no' && f.declaredIntent === 'no';
      if (r1) expect(got, ctx).toEqual(role('overlord'));
      if (r2 && !r1) expect(got, ctx).toEqual(role('auditor'));
      if (r3 && !r1 && !r2) expect(got, ctx).toEqual(role('replay'));
      if (r4 && !r1 && !r2 && !r3) expect(got, ctx).toEqual(undecided('worker-or-reviewer'));
      if (r5 && !r1 && !r2 && !r3 && !r4) {
        if (f.childRunKind === 'work') expect(got, ctx).toEqual(role('worker'));
        else if (f.childRunKind === 'review') expect(got, ctx).toEqual(role('reviewer'));
        else expect(got, ctx).toEqual(undecided('worker-or-reviewer'));
      }
      if (r6 && !r1 && !r2 && !r3 && !r4 && !r5) expect(got, ctx).toEqual(role('coordinator'));
      if (r7 && !r1 && !r2 && !r3 && !r4 && !r5 && !r6) expect(got, ctx).toEqual(role('plain'));
      if (!r1 && !r2 && !r3 && !r4 && !r5 && !r6 && !r7) expect(got, ctx).toEqual(undecided('coordinator-or-plain'));
    }
  });

  it('never lets childRunKind change an answer when there is no child mark', () => {
    for (const f of cases.filter((c) => c.child.kind === 'none')) {
      for (const k of [...RUN_KINDS, 'unmeasured'] as const) expect(roleOf({ ...f, childRunKind: k })).toEqual(roleOf(f));
    }
  });

  it('names only roles in FLEET_ROLES and ambiguities in ROLE_AMBIGUITIES', () => {
    for (const f of cases) {
      const got = roleOf(f);
      if (got.kind === 'role') expect(Object.keys(FLEET_ROLES)).toContain(got.role);
      else expect(Object.keys(ROLE_AMBIGUITIES)).toContain(got.between);
    }
  });
});

describe('sessionRoleOfReading: the view', () => {
  it.each(Object.keys(FLEET_ROLES) as FleetRole[])('%s reads its table column', (r) => {
    expect(sessionRoleOfReading(role(r))).toBe(FLEET_ROLES[r].sessionRole);
  });
  it.each(Object.keys(ROLE_AMBIGUITIES) as RoleAmbiguity[])('every member of %s has the same sessionRole', (a) => {
    const members = ROLE_AMBIGUITIES[a];
    const roles = new Set(members.map((m) => FLEET_ROLES[m].sessionRole));
    expect(roles.size).toBe(1);
    expect(sessionRoleOfReading(undecided(a))).toBe(FLEET_ROLES[members[0]].sessionRole);
  });
  it('pins today answers literally', () => {
    expect(sessionRoleOfReading(role('worker'))).toBe('child');
    expect(sessionRoleOfReading(role('reviewer'))).toBe('child');
    expect(sessionRoleOfReading(undecided('worker-or-reviewer'))).toBe('child');
    expect(sessionRoleOfReading(undecided('coordinator-or-plain'))).toBe('coordinator');
  });
});

describe('SessionRole as a view of roleOf', () => {
  it('SessionRole is a view: sessionRoleOf is the column of roleOf over the child axis', () => {
    expect(ROLE_FACTS_CHILD_AXIS).toEqual({ designation: 'none', auditBody: false, replayBody: false,
      childRunKind: 'unmeasured', claimsOpenRun: 'unmeasured', declaredIntent: 'unmeasured' });
    for (const child of [{ kind: 'none' }, { kind: 'child', runId: 7 }, { kind: 'unreadable' }] as const) {
      expect(sessionRoleOf(child)).toBe(sessionRoleOfReading(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child })));
    }
    expect(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child: { kind: 'none' } }))
      .toEqual({ kind: 'undecided', between: 'coordinator-or-plain' });
  });
});

describe('roleFactsOf: the one assembly of a session\'s role facts (Overlord W1a, renewal deciders Task 0)', () => {
  for (const [name, fn] of Object.entries(roleFactsOfCases(roleOfModule))) it(name, fn);
});

describe('designationFactOf (Overlord W1 designation A, Task 3)', () => {
  for (const [name, fn] of Object.entries(designationFactOfCases(roleOfModule))) it(name, fn);
});
describe('identityOf (X5)', () => {
  for (const [name, fn] of Object.entries(identityOfCases(roleOfModule))) it(name, fn);
});

describe('designationFactFrom: every caller narrows a DesignationRead the same way', () => {
  const view = (over: Partial<DesignationView>): DesignationView => ({
    bound: null, pending: null, term: 4, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
    pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [], ...over,
  });
  const pending = (kind: 'designate' | 'rebind') => ({ sessionId: 'overlord-new-owl', kind, deadlineAt: 9, since: 1, actor: 'op', generation: null });
  it('unmeasured stays unmeasured, for the caller to fail closed on', () => {
    expect(roleOfModule.designationFactFrom({ kind: 'unmeasured', why: 'x' })).toBe('unmeasured');
  });
  it('no row is none', () => {
    expect(roleOfModule.designationFactFrom({ kind: 'not-designated', row: null })).toEqual({ kind: 'none' });
  });
  it('a pending-only row is a row with no live id, carrying the pending id, its kind and the row term', () => {
    const r: DesignationRead = { kind: 'not-designated', row: view({ pending: pending('designate') }) };
    expect(roleOfModule.designationFactFrom(r)).toEqual({ kind: 'row', live: null, pending: 'overlord-new-owl', pendingKind: 'designate', term: 4 });
  });
  it('a retired row (no binding, no attempt) is a row with nothing live or pending', () => {
    expect(roleOfModule.designationFactFrom({ kind: 'not-designated', row: view({}) }))
      .toEqual({ kind: 'row', live: null, pending: null, pendingKind: null, term: 4 });
  });
  it('a live binding carries its id and term; a rebind attempt beside it is pending as well', () => {
    const r: DesignationRead = { kind: 'designated', sessionId: 'overlord-quiet-otter', term: 4,
      row: view({ bound: { sessionId: 'overlord-quiet-otter', generation: 'g1' }, pending: pending('rebind') }) };
    expect(roleOfModule.designationFactFrom(r)).toEqual({ kind: 'row', live: 'overlord-quiet-otter', pending: 'overlord-new-owl', pendingKind: 'rebind', term: 4 });
  });
});
