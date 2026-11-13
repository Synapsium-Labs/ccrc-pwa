import { describe, expect, it } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES, isFleetRole, type FleetRoleRow } from '../../shared/fleetRoles.js';

describe('FLEET_ROLES (Overlord spec §3.3.9, C49)', () => {
  it("names the seven roles in Table 3.3.9a's order", () => {
    expect(FLEET_ROLE_NAMES).toEqual(['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain']);
  });
  it('long-lived is the table: overlord and coordinator only', () => {
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].longLived)).toEqual(['overlord', 'coordinator']);
  });
  it("today's view: worker, reviewer, auditor and replay are children; the rest coordinators", () => {
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].sessionRole === 'child'))
      .toEqual(['auditor', 'replay', 'worker', 'reviewer']);
  });
  it('every column that waits for a later piece is null on every row', () => {
    // One line per column, so the piece that fills a column deletes its own line (plan review I14).
    for (const r of FLEET_ROLE_NAMES) {
      expect(FLEET_ROLES[r].launchProfile, r).toBeNull();
      expect(FLEET_ROLES[r].compactInstructions, r).toBeNull();
      expect(FLEET_ROLES[r].probeSet, r).toBeNull();
    }
  });
  it('the card renderer: one per role, auditor and replay take plain (C51)', () => {
    expect(FLEET_ROLE_NAMES.map((r) => FLEET_ROLES[r].cardRenderer))
      .toEqual(['overlord', 'plain', 'plain', 'worker', 'reviewer', 'coordinator', 'plain']);
  });
  it('a row must carry every column (a compile-time pin, read by the test typecheck)', () => {
    // @ts-expect-error a row with no sessionRole is not a FleetRoleRow
    const partial: FleetRoleRow = { longLived: false, launchProfile: null, cardRenderer: 'plain', compactInstructions: null, probeSet: null };
    expect(partial.longLived).toBe(false);
  });
  it('isFleetRole accepts exactly the table keys', () => {
    for (const r of FLEET_ROLE_NAMES) expect(isFleetRole(r)).toBe(true);
    for (const v of ['child', '', 'Overlord', '__proto__', 'toString', null, undefined, 7, {}]) expect(isFleetRole(v)).toBe(false);
  });
});
