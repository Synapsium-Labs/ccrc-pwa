import { describe, expect, it } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES, isFleetRole, type FleetRoleRow } from '../../shared/fleetRoles.js';
import { PROBE_CLASSES } from '../../shared/continuity.js';

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
    // W1 sandbox Task 2: the subagent-model pin (C55, W0-11) joins the overlord's env, and its settings carry the surface's
    // switches (proposal 5's acceptance, measured by Task 1's M3; inbound peer messages refused, §3.6 H1).
    expect(FLEET_ROLES.overlord.launchProfile.env).toStrictEqual({ CLAUDE_CODE_FORK_SUBAGENT: '0', CLAUDE_CODE_DISABLE_AGENT_VIEW: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' });
    expect(FLEET_ROLES.overlord.launchProfile.settings).toStrictEqual({ enableWorkflows: false, switchModelsOnFlag: true,
      skipDangerousModePermissionPrompt: true, crossSessionInbound: 'refuse', remoteControlAtStartup: false });
    for (const r of FLEET_ROLE_NAMES.filter((x) => x !== 'overlord')) expect(FLEET_ROLES[r].launchProfile.env, r).toStrictEqual({});
    for (const r of FLEET_ROLE_NAMES.filter((x) => x !== 'overlord')) expect(FLEET_ROLES[r].launchProfile.settings, r).toStrictEqual({});
  });
  it('only the overlord has a surface, and every word of it is argv-safe (W1 sandbox Task 2, index question 12)', () => {
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].launchProfile.surface !== null)).toEqual(['overlord']);
    const s = FLEET_ROLES.overlord.launchProfile.surface!;
    for (const w of [...s.tools, ...s.deny, ...s.skills]) expect(w).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const w of [...s.tools, ...s.deny]) expect(w).toMatch(/^[A-Za-z0-9_]+$/);
    const target = /^[a-z0-9-]+(\/[a-z0-9.-]+)*$/;
    for (const [name, t] of Object.entries(s.stagedSkills)) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(t).toMatch(target);
      expect(t.split('/')).not.toContain('..');
    }
    expect(s.memory).toMatch(target);
    expect(s.memory.split('/')).not.toContain('..');
    expect(s.toolServer).toBe('door');
    expect(Object.keys(s.readerTypes).length).toBeGreaterThan(0);
    for (const [t, rt] of Object.entries(s.readerTypes)) {
      expect(rt.model, t).toBe('sonnet');
      expect(rt.tools, t).toStrictEqual(['mcp__door__read']);
    }
    expect(s.skills).toStrictEqual(['ccrc-overlord']);
    expect(Object.keys(s.stagedSkills)).toStrictEqual(s.skills);
    expect(s.settingSources).toStrictEqual(['project']);
    // The cron tools are denied (proposal 3), with every command, edit, web, peer-message and workflow tool.
    expect(s.deny).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'SendMessage',
      'ListAgents', 'Workflow', 'CronCreate', 'CronList', 'CronDelete']));
    expect(FLEET_ROLES.overlord.launchProfile.settings.crossSessionInbound).toBe('refuse');
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
  it('the probe set: total, empty for every role that is not long-lived; a coordinator asks its own rows, the Overlord every class (C41, C52)', () => {
    for (const r of FLEET_ROLE_NAMES) {
      expect(FLEET_ROLES[r].probeSet.length > 0, r).toBe(FLEET_ROLES[r].longLived);
      expect(new Set(FLEET_ROLES[r].probeSet).size, r).toBe(FLEET_ROLES[r].probeSet.length);
    }
    expect(FLEET_ROLES.coordinator.probeSet).toEqual(['fact', 'temporal', 'abstention', 'continuation']);
    expect(FLEET_ROLES.overlord.probeSet).toEqual(PROBE_CLASSES);
  });
  it('the timer cap: set on every row, the Overlord 50, a coordinator 20, every other role 5 (Table 11.1b, C65)', () => {
    for (const r of FLEET_ROLE_NAMES) expect(Number.isSafeInteger(FLEET_ROLES[r].timerCap) && FLEET_ROLES[r].timerCap > 0, r).toBe(true);
    expect(FLEET_ROLE_NAMES.map((r) => FLEET_ROLES[r].timerCap)).toEqual([50, 5, 5, 5, 5, 20, 5]);
  });
  it('a row must carry every column (a compile-time pin, read by the test typecheck)', () => {
    // @ts-expect-error a row with no sessionRole is not a FleetRoleRow
    const partial: FleetRoleRow = { longLived: false, launchProfile: { env: {}, settings: {}, autoMemory: 'off', compaction: null, surface: null }, cardRenderer: 'plain', compactInstructions: '', probeSet: [], timerCap: 5 };
    expect(partial.longLived).toBe(false);
  });
  it('isFleetRole accepts exactly the table keys', () => {
    for (const r of FLEET_ROLE_NAMES) expect(isFleetRole(r)).toBe(true);
    for (const v of ['child', '', 'Overlord', '__proto__', 'toString', null, undefined, 7, {}]) expect(isFleetRole(v)).toBe(false);
  });
});
