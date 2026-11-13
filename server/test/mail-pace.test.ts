import { describe, it, expect } from 'vitest';
import type { ChildMark } from '../../shared/api.js';
import { FLEET_ROLE_NAMES, type FleetRole } from '../../shared/fleetRoles.js';
import { ROLE_AMBIGUITIES, roleOf, type RoleAmbiguity } from '../src/roleOf.js';
import { MAIL_PACE, mailLaneRoleFacts, mailPaceOf } from '../src/coord/mailPace.js';

// Literal on purpose, never read back from the table: a value change is a behaviour change and must turn this red.
const WORKER = { quietMs: 60_000, cooldownMs: 120_000 };
const COORDINATOR = { quietMs: 15_000, cooldownMs: 30_000 };
/** Every child fact the mail lane can pass: the three `ChildMark` kinds, and no record at all. */
const CHILDREN: readonly (ChildMark | undefined)[] = [
  { kind: 'none' }, { kind: 'child', runId: 7 }, { kind: 'unreadable' }, undefined,
];

// A role with no row, or a row for no role, is a compile error twice over: the table `satisfies
// Readonly<Record<FleetRole, MailPace>>` in its own file, and this exact-key check here, which `typecheck-tests`
// compiles. The second holds even if the first is ever loosened to `Record<string, MailPace>`.
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const MAIL_PACE_IS_TOTAL: SameKeys<keyof typeof MAIL_PACE, FleetRole> = true;

describe('MAIL_PACE (Overlord spec §6.4, C24, C49 and H19)', () => {
  it('is keyed by exactly FleetRole (a compile-time check; this case only keeps it referenced)', () => {
    expect(MAIL_PACE_IS_TOTAL).toBe(true);
  });
  it('has a row for every role in FLEET_ROLES, in its order, and no other', () => {
    expect(Object.keys(MAIL_PACE)).toEqual([...FLEET_ROLE_NAMES]);
  });
  it("today's two rows keep their values; the Overlord's row starts at 15 s and 30 s", () => {
    expect(MAIL_PACE).toEqual({
      overlord: COORDINATOR, auditor: WORKER, replay: WORKER, worker: WORKER,
      reviewer: WORKER, coordinator: COORDINATOR, plain: WORKER,
    });
  });
  it('each row keeps the cooldown longer than the quiet time', () => {
    for (const p of Object.values(MAIL_PACE)) expect(p.cooldownMs).toBeGreaterThan(p.quietMs);
  });
});

describe('mailPaceOf: a reading picks its row', () => {
  it('a decided role reads its own row', () => {
    for (const role of FLEET_ROLE_NAMES) expect(mailPaceOf({ kind: 'role', role })).toBe(MAIL_PACE[role]);
  });
  it('each ambiguity has a member at least as slow as every other on both fields', () => {
    for (const a of Object.keys(ROLE_AMBIGUITIES) as RoleAmbiguity[]) {
      const rows = ROLE_AMBIGUITIES[a].map((r) => MAIL_PACE[r]);
      const slowest = rows.find((s) => rows.every((r) => s.quietMs >= r.quietMs && s.cooldownMs >= r.cooldownMs));
      expect(slowest, a).toBeDefined();
    }
  });
  it('an undecided reading takes the slower row (spec §3.3.9)', () => {
    expect(mailPaceOf({ kind: 'undecided', between: 'coordinator-or-plain' })).toEqual(WORKER);
    expect(mailPaceOf({ kind: 'undecided', between: 'worker-or-reviewer' })).toEqual(WORKER);
  });
});

describe("mailLaneRoleFacts: the lane's facts, and today's answers", () => {
  it('a claimant with no child mark reads the coordinator row; a non-claimant the worker pair', () => {
    expect(mailPaceOf(roleOf(mailLaneRoleFacts({ kind: 'none' }, true)))).toEqual(COORDINATOR);
    expect(mailPaceOf(roleOf(mailLaneRoleFacts({ kind: 'none' }, false)))).toEqual(WORKER);
  });
  it('every child shape that claims nothing reads the worker pair', () => {
    for (const c of CHILDREN) expect(mailPaceOf(roleOf(mailLaneRoleFacts(c, false))), JSON.stringify(c)).toEqual(WORKER);
  });
  it("no fact the lane passes selects the Overlord's, an auditor's or a replay body's row", () => {
    for (const c of CHILDREN) for (const claim of [true, false]) {
      const r = roleOf(mailLaneRoleFacts(c, claim));
      if (r.kind === 'role') expect(['overlord', 'auditor', 'replay'], JSON.stringify([c, claim])).not.toContain(r.role);
    }
  });
  it('declared intent is not read: a non-claimant stays undecided, never a coordinator', () => {
    expect(roleOf(mailLaneRoleFacts({ kind: 'none' }, false))).toEqual({ kind: 'undecided', between: 'coordinator-or-plain' });
  });
  it('an absent record is a child mark not measured, read as an unreadable one', () => {
    expect(mailLaneRoleFacts(undefined, true).child).toEqual({ kind: 'unreadable' });
  });
});
