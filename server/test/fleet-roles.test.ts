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
      expect(FLEET_ROLES[r].probeSet, r).toBeNull();
    }
  });
  it('every role has a launch profile; only the long-lived roles compact on their own terms, only plain switches memory (H1, H14, C39)', () => {
    for (const r of FLEET_ROLE_NAMES) {
      const p = FLEET_ROLES[r].launchProfile;
      expect(p, r).not.toBeNull();
      for (const k of Object.keys(p.env)) expect(k, r).toMatch(/^CLAUDE_CODE_[A-Z_]+$/);
    }
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].launchProfile.compaction !== null)).toEqual(['overlord', 'coordinator']);
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].launchProfile.autoMemory === 'switch')).toEqual(['plain']);
    for (const r of ['overlord', 'coordinator'] as const) {
      expect(FLEET_ROLES[r].launchProfile.compaction).toStrictEqual({ settings: { idleCompaction: false }, aboveHardCapPts: 10 });
    }
    expect(FLEET_ROLES.overlord.launchProfile.env).toStrictEqual({ CLAUDE_CODE_FORK_SUBAGENT: '0', CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' });
    for (const r of FLEET_ROLE_NAMES.filter((x) => x !== 'overlord')) expect(FLEET_ROLES[r].launchProfile.env, r).toStrictEqual({});
    for (const r of FLEET_ROLE_NAMES) expect(FLEET_ROLES[r].launchProfile.settings, r).toStrictEqual({});
  });
  it('every role carries its compaction text; auditor and replay take plain\'s (C51)', () => {
    for (const r of FLEET_ROLE_NAMES) expect(typeof FLEET_ROLES[r].compactInstructions, r).toBe('string');
    expect(FLEET_ROLES.auditor.compactInstructions).toBe(FLEET_ROLES.plain.compactInstructions);
    expect(FLEET_ROLES.replay.compactInstructions).toBe(FLEET_ROLES.plain.compactInstructions);
  });
  it('the card renderer: one per role, auditor and replay take plain (C51)', () => {
    expect(FLEET_ROLE_NAMES.map((r) => FLEET_ROLES[r].cardRenderer))
      .toEqual(['overlord', 'plain', 'plain', 'worker', 'reviewer', 'coordinator', 'plain']);
  });
  it('a row must carry every column (a compile-time pin, read by the test typecheck)', () => {
    // @ts-expect-error a row with no sessionRole is not a FleetRoleRow
    const partial: FleetRoleRow = { longLived: false, launchProfile: { env: {}, settings: {}, autoMemory: 'off', compaction: null }, cardRenderer: 'plain', compactInstructions: '', probeSet: null };
    expect(partial.longLived).toBe(false);
  });
  it('isFleetRole accepts exactly the table keys', () => {
    for (const r of FLEET_ROLE_NAMES) expect(isFleetRole(r)).toBe(true);
    for (const v of ['child', '', 'Overlord', '__proto__', 'toString', null, undefined, 7, {}]) expect(isFleetRole(v)).toBe(false);
  });
});
