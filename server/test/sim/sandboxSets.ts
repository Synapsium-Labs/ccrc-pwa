// The sandbox check's oracle and mutant sets (Overlord W1 sandbox PR B, Tasks 8 and 9: w1-sandbox.md). Its cases are written
// ONCE here, as suite cases over a module: `sandbox-check.test.ts` and `sandbox-settle.test.ts` run them against the real
// module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import type { StartLoadsRow } from '../../src/continuity/startLoads.js';
import type { StartRow } from '../../../shared/continuity.js';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';
import { SANDBOX_PROPERTIES, type ClaudeCodeOwnLists, type SandboxProperty } from '../../../shared/overlord-sandbox.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type SandboxModule = typeof import('../../src/continuity/sandboxCheck.js');
type Expected = NonNullable<ReturnType<SandboxModule['expectedSurfaceOf']>>;

/** An isolated fixture build and its own lists (review 3325 F4): no real build, and never the release's table, which lists none. */
export const BUILD = '0.0.0-fixture';
export const FIXTURE_OWN_LISTS: ClaudeCodeOwnLists = { [BUILD]: { agents: ['Explore'], skills: ['dataviz'] } };
export const GEN = '11111111-2222-3333-4444-555555555555';
export const BODY = 'lane-a-overlord';
const WS = { kind: 'measured', project: 'overlord' } as const;

/** A report every property of which holds, against `e`. */
export function heldReport(e: Expected, over: Partial<StartLoadsRow> = {}, loaded: Partial<StartLoadsRow['loaded']> = {}): StartLoadsRow {
  return {
    startId: 7, profileRole: 'overlord', profileDigest: e.digest, launchRc: 'off', claudeVersion: BUILD,
    permissionMode: 'bypassPermissions', cwdInWorkspace: true, carriedFrom: null, conflicted: false,
    loaded: {
      instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: e.constitutionSha256 }],
      hooks: [e.hookSha256], skills: ['ccrc-overlord', 'dataviz'], agents: ['Explore', 'overlord-reader'],
      tools: ['Agent', 'Skill', 'mcp__door__act', 'mcp__door__read'], toolServers: ['door'], ...loaded,
    },
    ...over,
  };
}

export const startRow = (over: Partial<StartRow> = {}): StartRow => ({
  id: 7, sessionId: BODY, reportId: 'r-0001-abcd', uuid: 'u-1', source: 'startup', model: null, rowIncarnation: GEN,
  reportedAt: 1000, receivedAt: 1000, ...over,
});

const view = (pending: DesignationView['pending'], bound: DesignationView['bound'] = null): DesignationView => ({
  bound, pending, term: 1, designatedTerm: 0, model: 'opus', accountPools: { pools: [], untagged: true }, pastIds: [], actor: 'flag-off',
  lastAttempt: null, stopsOwed: [],
});
export const pendingRead = (over: Partial<NonNullable<DesignationView['pending']>> = {}): DesignationRead => ({
  kind: 'not-designated',
  row: view({ sessionId: BODY, kind: 'designate', deadlineAt: 9e12, since: 1, actor: 'flag-off', generation: GEN, ...over }),
});

export function sandboxCases(m: SandboxModule): Record<string, SuiteCase> {
  const e = m.expectedSurfaceOf('overlord', FIXTURE_OWN_LISTS)!;
  const state = (r: StartLoadsRow | null, p: SandboxProperty, ws: Parameters<SandboxModule['sandboxVerdict']>[2] = WS,
    carry?: Parameters<SandboxModule['sandboxVerdict']>[3]) => m.sandboxVerdict(e, r, ws, carry).properties.find((x) => x.property === p)?.state;
  const unread = (k: keyof StartLoadsRow['loaded']) => heldReport(e, {}, { [k]: 'unmeasured' });
  return {
    'a held report holds every property, in the board order, and is engaged': () => {
      const r = m.sandboxVerdict(e, heldReport(e), WS);
      expect(r.properties.map((p) => p.property)).toStrictEqual([...SANDBOX_PROPERTIES]);
      expect(r.properties.every((p) => p.state === 'held')).toBe(true);
      expect(r.engaged).toBe(true);
    },
    'only the overlord row has an expected surface': () => {
      expect(m.expectedSurfaceOf('coordinator')).toBeNull();
      expect(e.toolServer).toBe('door');
      expect(e.readerTypes).toStrictEqual(['overlord-reader']);
    },
    'no report, and a conflicted report, read every property unmeasured': () => {
      for (const r of [null, heldReport(e, { conflicted: true })]) {
        const v = m.sandboxVerdict(e, r, WS);
        expect(v.engaged).toBe(false);
        expect(v.properties.map((p) => p.state)).toStrictEqual(SANDBOX_PROPERTIES.map(() => 'unmeasured'));
      }
    },
    'profile: another role or another build\'s digest fails; none named is unmeasured': () => {
      expect(state(heldReport(e, { profileRole: 'plain' }), 'profile')).toBe('failed');
      expect(state(heldReport(e, { profileDigest: 'f'.repeat(64) }), 'profile')).toBe('failed');
      expect(state(heldReport(e, { profileDigest: null }), 'profile')).toBe('unmeasured');
      expect(state(heldReport(e, { profileRole: null }), 'profile')).toBe('unmeasured');
    },
    'tools: a tool outside the profile fails, no door tool fails, unread is unmeasured': () => {
      expect(state(heldReport(e, {}, { tools: ['Agent', 'Bash', 'mcp__door__read'] }), 'tools')).toBe('failed');
      expect(state(heldReport(e, {}, { tools: ['Agent', 'mcp__plug__x', 'mcp__door__read'] }), 'tools')).toBe('failed');
      expect(state(heldReport(e, {}, { tools: ['Agent', 'Skill'] }), 'tools')).toBe('failed');
      expect(state(unread('tools'), 'tools')).toBe('unmeasured');
    },
    'tool-servers: exactly door; none, a plugin server or two fail; unread is unmeasured': () => {
      expect(state(heldReport(e, {}, { toolServers: [] }), 'tool-servers')).toBe('failed');
      expect(state(heldReport(e, {}, { toolServers: ['plug'] }), 'tool-servers')).toBe('failed');
      expect(state(heldReport(e, {}, { toolServers: ['door', 'plug'] }), 'tool-servers')).toBe('failed');
      expect(state(unread('toolServers'), 'tool-servers')).toBe('unmeasured');
    },
    'instructions: two files, another name, a file outside, another digest fail; unread is unmeasured': () => {
      const c = { type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: e.constitutionSha256 };
      expect(state(heldReport(e, {}, { instructions: [c, { ...c, name: 'w0-rule.md' }] }), 'instructions')).toBe('failed');
      expect(state(heldReport(e, {}, { instructions: [{ ...c, name: 'AGENTS.md' }] }), 'instructions')).toBe('failed');
      expect(state(heldReport(e, {}, { instructions: [{ ...c, inWorkspace: false }] }), 'instructions')).toBe('failed');
      expect(state(heldReport(e, {}, { instructions: [{ ...c, sha256: 'e'.repeat(64) }] }), 'instructions')).toBe('failed');
      expect(state(heldReport(e, {}, { instructions: [] }), 'instructions')).toBe('failed');
      expect(state(unread('instructions'), 'instructions')).toBe('unmeasured');
    },
    'skills: a plugin skill or a missing ccrc-overlord fails; an unlisted build is unmeasured, naming it': () => {
      expect(state(heldReport(e, {}, { skills: ['ccrc-overlord', 'plug:thing'] }), 'skills')).toBe('failed');
      expect(state(heldReport(e, {}, { skills: ['dataviz'] }), 'skills')).toBe('failed');
      expect(state(unread('skills'), 'skills')).toBe('unmeasured');
      const v = m.sandboxVerdict(e, heldReport(e, { claudeVersion: '9.9.9' }), WS).properties;
      expect(v.find((p) => p.property === 'skills')).toMatchObject({ state: 'unmeasured', detail: expect.stringContaining('9.9.9') });
      expect(v.find((p) => p.property === 'agents')).toMatchObject({ state: 'unmeasured', detail: expect.stringContaining('9.9.9') });
      expect(state(heldReport(e, { claudeVersion: null }), 'skills')).toBe('unmeasured');
    },
    'the release lists no build: a 2.1.330 report reads skills and agents unmeasured, naming it, and is not engaged (review 3325 F4)': () => {
      const p = m.expectedSurfaceOf('overlord')!;
      expect(Object.keys(p.ownLists)).toStrictEqual([]);
      const v = m.sandboxVerdict(p, heldReport(p, { claudeVersion: '2.1.330' }), WS);
      expect(v.properties.filter((x) => x.state !== 'held').map((x) => [x.property, x.state])).toStrictEqual([['skills', 'unmeasured'], ['agents', 'unmeasured']]);
      expect(v.properties.find((x) => x.property === 'skills')?.detail).toContain('2.1.330');
      expect(v.engaged).toBe(false);
      expect(m.profileEngagedOf({ start: startRow(), report: heldReport(p, { claudeVersion: '2.1.330' }) }, p, WS)).toBe('not-engaged');
    },
    'fromAccount (renewal readings PR H): an extra load is the account\'s, a missing one, the workspace\'s or the launch\'s is not': () => {
      const acct = (r: StartLoadsRow, p: SandboxProperty) => m.sandboxVerdict(e, r, WS).properties.find((x) => x.property === p)?.fromAccount;
      // every property of a held report, and of an unread one, is never the account's
      for (const x of m.sandboxVerdict(e, heldReport(e), WS).properties) expect(x.fromAccount, x.property).toBe(false);
      for (const k of ['tools', 'toolServers', 'instructions', 'skills', 'agents', 'hooks'] as const) {
        for (const x of m.sandboxVerdict(e, unread(k), WS).properties) expect(x.fromAccount, `${k} unread: ${x.property}`).toBe(false);
      }
      expect(acct(heldReport(e, {}, { skills: ['ccrc-overlord', 'dataviz', 'plug:thing'] }), 'skills')).toBe(true);
      expect(acct(heldReport(e, {}, { skills: ['dataviz'] }), 'skills')).toBe(false);
      expect(acct(heldReport(e, {}, { agents: ['Explore', 'overlord-reader', 'plug:agent'] }), 'agents')).toBe(true);
      expect(acct(heldReport(e, {}, { agents: ['Explore'] }), 'agents')).toBe(false);
      expect(acct(heldReport(e, {}, { hooks: [e.hookSha256, 'd'.repeat(64)] }), 'hooks')).toBe(true);
      expect(acct(heldReport(e, {}, { hooks: [] }), 'hooks')).toBe(false);
      expect(acct(heldReport(e, {}, { tools: ['Agent', 'mcp__door__act', 'mcp__other__x'] }), 'tools')).toBe(true);
      expect(acct(heldReport(e, {}, { tools: ['Agent', 'Skill'] }), 'tools')).toBe(false);
      expect(acct(heldReport(e, {}, { toolServers: ['door', 'other'] }), 'tool-servers')).toBe(true);
      expect(acct(heldReport(e, {}, { toolServers: ['other'] }), 'tool-servers')).toBe(true);
      expect(acct(heldReport(e, {}, { toolServers: [] }), 'tool-servers')).toBe(false);
      expect(acct(heldReport(e, {}, { toolServers: ['door', 'door'] }), 'tool-servers')).toBe(false);
      const con = { type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: e.constitutionSha256 };
      const user = { type: 'User', name: 'CLAUDE.md', inWorkspace: false, sha256: 'a'.repeat(64) };
      const parent = { type: 'Project', name: 'CLAUDE.md', inWorkspace: false, sha256: 'b'.repeat(64) };
      expect(acct(heldReport(e, {}, { instructions: [con, user] }), 'instructions')).toBe(true);
      expect(acct(heldReport(e, {}, { instructions: [user] }), 'instructions')).toBe(true);
      expect(acct(heldReport(e, {}, { instructions: [con, parent] }), 'instructions')).toBe(false);
      expect(acct(heldReport(e, {}, { instructions: [con, { ...user, inWorkspace: true }] }), 'instructions')).toBe(false);
      expect(acct(heldReport(e, {}, { instructions: [parent] }), 'instructions')).toBe(false);
      expect(acct(heldReport(e, {}, { instructions: [{ ...con, sha256: 'e'.repeat(64) }] }), 'instructions')).toBe(false);
      expect(acct(heldReport(e, {}, { instructions: [con, { ...con, name: 'AGENTS.md' }] }), 'instructions')).toBe(false);
      // the launch's own composition and the workspace never are
      expect(acct(heldReport(e, { launchRc: 'on' }), 'remote-control')).toBe(false);
      expect(acct(heldReport(e, { permissionMode: 'default' }), 'permission-mode')).toBe(false);
      expect(acct(heldReport(e, { profileDigest: 'x' }), 'profile')).toBe(false);
      expect(m.sandboxVerdict(e, heldReport(e, { cwdInWorkspace: false }), WS).properties.find((x) => x.property === 'workspace')?.fromAccount).toBe(false);
    },
    'newestStartVerdict (renewal readings PR H): the newest start\'s own report, with its id; none, no report or another start\'s is unmeasured': () => {
      expect(m.newestStartVerdict(null, e, WS)).toBeNull();
      expect(m.newestStartVerdict({ start: startRow(), report: null, carry: { kind: 'none' } }, e, WS)).toEqual({ startId: 7, verdict: 'unmeasured' });
      expect(m.newestStartVerdict({ start: startRow({ id: 8 }), report: heldReport(e), carry: { kind: 'none' } }, e, WS)).toEqual({ startId: 8, verdict: 'unmeasured' });
      const v = m.newestStartVerdict({ start: startRow(), report: heldReport(e, {}, { hooks: [e.hookSha256, 'd'.repeat(64)] }), carry: { kind: 'none' } }, e, WS);
      expect(v?.startId).toBe(7);
      expect(v?.verdict !== 'unmeasured' && v?.verdict.properties.find((x) => x.property === 'hooks')).toMatchObject({ state: 'failed', fromAccount: true });
      // the start's own carry is the one read: a resume carrying a vouched startup holds its carried kinds
      const vouched = { kind: 'read', source: 'startup', report: { profileDigest: e.digest, claudeVersion: BUILD, conflicted: false } } as const;
      const carried = m.newestStartVerdict({ start: startRow({ source: 'resume' }), report: heldReport(e, { carriedFrom: 'r-0000-abcd' }), carry: vouched }, e, WS);
      expect(carried?.verdict !== 'unmeasured' && carried?.verdict.properties.find((x) => x.property === 'hooks')?.state).toBe('held');
    },
    'agents: a plugin agent or a missing reader type fails; unread is unmeasured': () => {
      expect(state(heldReport(e, {}, { agents: ['Explore', 'overlord-reader', 'plug:agent'] }), 'agents')).toBe('failed');
      expect(state(heldReport(e, {}, { agents: ['Explore'] }), 'agents')).toBe('failed');
      expect(state(unread('agents'), 'agents')).toBe('unmeasured');
    },
    'hooks: a foreign hook (one that failed included) fails, ccrc\'s missing fails; unread is unmeasured': () => {
      expect(state(heldReport(e, {}, { hooks: [e.hookSha256, 'd'.repeat(64)] }), 'hooks')).toBe('failed');
      expect(state(heldReport(e, {}, { hooks: ['d'.repeat(64)] }), 'hooks')).toBe('failed');
      expect(state(unread('hooks'), 'hooks')).toBe('unmeasured');
    },
    'remote-control and permission-mode: held, failed and unmeasured': () => {
      expect(state(heldReport(e, { launchRc: 'on' }), 'remote-control')).toBe('failed');
      expect(state(heldReport(e, { launchRc: null }), 'remote-control')).toBe('unmeasured');
      expect(state(heldReport(e, { permissionMode: 'default' }), 'permission-mode')).toBe('failed');
      expect(state(heldReport(e, { permissionMode: null }), 'permission-mode')).toBe('unmeasured');
    },
    'workspace: another project or a cwd outside fails; an unmeasured project or cwd is unmeasured': () => {
      expect(state(heldReport(e), 'workspace', { kind: 'measured', project: 'project-a' })).toBe('failed');
      expect(state(heldReport(e, { cwdInWorkspace: false }), 'workspace')).toBe('failed');
      expect(state(heldReport(e), 'workspace', { kind: 'unmeasured', reason: 'registry' })).toBe('unmeasured');
      expect(state(heldReport(e, { cwdInWorkspace: null }), 'workspace')).toBe('unmeasured');
      const c = { type: 'Project', name: 'CLAUDE.md', inWorkspace: false, sha256: e.constitutionSha256 };
      expect(state(heldReport(e, {}, { instructions: [c] }), 'workspace')).toBe('failed');
      expect(state(unread('instructions'), 'workspace')).toBe('unmeasured');
    },
    'a carry the server cannot vouch for reads instructions and hooks unmeasured (review 2135 F9)': () => {
      const carried = heldReport(e, { carriedFrom: 'r-0000-start' });
      const good = { kind: 'read', source: 'startup', report: { profileDigest: e.digest, claudeVersion: BUILD, conflicted: false } } as const;
      expect(state(carried, 'instructions', WS, good)).toBe('held');
      expect(state(carried, 'hooks', WS, good)).toBe('held');
      for (const bad of [{ kind: 'none' } as const, { kind: 'absent' } as const, { kind: 'unmeasured', reason: 'x' } as const,
        { ...good, source: 'resume' } as const, { ...good, report: null }, { ...good, report: { ...good.report, conflicted: true } },
        { ...good, report: { ...good.report, profileDigest: 'f'.repeat(64) } }, { ...good, report: { ...good.report, claudeVersion: '2.1.329' } }]) {
        expect(state(carried, 'instructions', WS, bad)).toBe('unmeasured');
        expect(state(carried, 'hooks', WS, bad)).toBe('unmeasured');
      }
    },
    'one property that is not held is enough to be not engaged': () => {
      for (const r of [heldReport(e, { launchRc: null }), heldReport(e, {}, { toolServers: [] }), unread('tools')]) {
        expect(m.sandboxVerdict(e, r, WS).engaged).toBe(false);
      }
    },
    'profileEngagedOf: no start, a start with no report, and an unheld report read not-engaged': () => {
      expect(m.profileEngagedOf(null, e, WS)).toBe('not-engaged');
      expect(m.profileEngagedOf({ start: startRow(), report: null }, e, WS)).toBe('not-engaged');
      expect(m.profileEngagedOf({ start: startRow(), report: heldReport(e, { launchRc: 'on' }) }, e, WS)).toBe('not-engaged');
      expect(m.profileEngagedOf({ start: startRow(), report: heldReport(e) }, e, WS)).toBe('engaged');
      expect(m.profileEngagedOf({ start: startRow({ source: 'resume' }), report: heldReport(e) }, e, WS)).toBe('engaged');
    },
    'profileEngagedOf: a report of any start but the newest reads not-engaged, never an older start\'s (review 3325 F8)': () => {
      expect(m.profileEngagedOf({ start: startRow({ id: 9 }), report: heldReport(e, { startId: 7 }) }, e, WS)).toBe('not-engaged');
      expect(m.profileEngagedOf({ start: startRow({ id: 9 }), report: heldReport(e, { startId: 9 }) }, e, WS)).toBe('engaged');
    },
    'profileEngagedOf: a carried resume is engaged only on a carry the server vouches for': () => {
      const start = startRow({ source: 'resume' });
      const carried = heldReport(e, { carriedFrom: 'r-0000-start' });
      const good = { kind: 'read', source: 'startup', report: { profileDigest: e.digest, claudeVersion: BUILD, conflicted: false } } as const;
      expect(m.profileEngagedOf({ start, report: carried }, e, WS, good)).toBe('engaged');
      expect(m.profileEngagedOf({ start, report: carried }, e, WS, { kind: 'absent' })).toBe('not-engaged');
      expect(m.profileEngagedOf({ start, report: carried }, e, WS)).toBe('not-engaged');
    },
  };
}

export function settleCases(m: SandboxModule): Record<string, SuiteCase> {
  const e = m.expectedSurfaceOf('overlord', FIXTURE_OWN_LISTS)!;
  const held = m.sandboxVerdict(e, heldReport(e), WS);
  const failed = m.sandboxVerdict(e, heldReport(e, { launchRc: 'on' }), WS);
  const unmeasured = m.sandboxVerdict(e, null, WS);
  return {
    'a held verdict at the pending start goes live with its generation': () => {
      expect(m.sandboxSettle(pendingRead(), 7, startRow(), held)).toStrictEqual({ kind: 'go-live', sessionId: BODY, generation: GEN });
    },
    'a failed or unmeasured verdict at pending fails the attempt, naming what was not held': () => {
      const f = m.sandboxSettle(pendingRead(), 7, startRow(), failed);
      expect(f).toMatchObject({ kind: 'fail-pending', sessionId: BODY });
      expect(f.kind === 'fail-pending' && f.properties.map((p) => p.property)).toStrictEqual(['remote-control']);
      expect(m.sandboxSettle(pendingRead(), 7, startRow(), unmeasured).kind).toBe('fail-pending');
    },
    'a resume that is the newest start at pending settles': () => {
      expect(m.sandboxSettle(pendingRead(), 9, startRow({ id: 9, source: 'resume' }), held).kind).toBe('go-live');
    },
    'a report for an older start than the newest changes nothing': () => {
      expect(m.sandboxSettle(pendingRead(), 7, startRow({ id: 9 }), held)).toStrictEqual({ kind: 'none' });
      expect(m.sandboxSettle(pendingRead(), 7, startRow({ id: 9 }), failed)).toStrictEqual({ kind: 'none' });
      expect(m.sandboxSettle(pendingRead(), 7, null, failed)).toStrictEqual({ kind: 'none' });
    },
    'another session\'s report, another generation, an unbound generation change nothing': () => {
      expect(m.sandboxSettle(pendingRead(), 7, startRow({ sessionId: 'lane-a-project-a' }), failed).kind).toBe('none');
      expect(m.sandboxSettle(pendingRead(), 7, startRow({ rowIncarnation: 'other' }), failed).kind).toBe('none');
      expect(m.sandboxSettle(pendingRead({ generation: null }), 7, startRow(), held).kind).toBe('none');
    },
    'no pending row (a settled start resent, a live binding) and an unreadable row change nothing': () => {
      const live: DesignationRead = { kind: 'designated', sessionId: BODY, term: 1, row: view(null, { sessionId: BODY, generation: GEN }) };
      expect(m.sandboxSettle(live, 7, startRow(), failed).kind).toBe('none');
      expect(m.sandboxSettle({ kind: 'not-designated', row: null }, 7, startRow(), held).kind).toBe('none');
      expect(m.sandboxSettle({ kind: 'unmeasured', why: 'x' }, 7, startRow(), held).kind).toBe('none');
    },
    // Designation B: a pending rebind settles as a designate does (sandbox B's slug `settle-acts-on-designate-only-until-rebind`).
    'a pending rebind settles: go-live on a held report, fail-pending on a failed one': () => {
      expect(m.sandboxSettle(pendingRead({ kind: 'rebind' }), 7, startRow(), held)).toStrictEqual({ kind: 'go-live', sessionId: BODY, generation: GEN });
      expect(m.sandboxSettle(pendingRead({ kind: 'rebind' }), 7, startRow(), failed).kind).toBe('fail-pending');
    },
  };
}

/** `settleEvidenceStands`'s cases (review 3366 F4): the same evidence read twice stands; a newer start, another report or
 *  carry, and a changed designation, each with the rest unchanged, do not. */
export function settleEvidenceCases(m: SandboxModule): Record<string, SuiteCase> {
  const e = m.expectedSurfaceOf('overlord', FIXTURE_OWN_LISTS)!;
  type Evidence = Parameters<SandboxModule['settleEvidenceStands']>[0];
  const newest: NonNullable<Evidence['newest']> = { start: startRow(), report: heldReport(e), carry: { kind: 'none' } };
  const ev = (over: Partial<Evidence> = {}): Evidence => ({ designation: pendingRead(), newest, ...over });
  return {
    'the same evidence, read again, stands': () => {
      expect(m.settleEvidenceStands(ev(), ev({ designation: pendingRead(), newest: { ...newest, start: startRow() } }))).toBe(true);
    },
    'a newer start, another report, another carry or no start, the designation unchanged, does not stand': () => {
      expect(m.settleEvidenceStands(ev(), ev({ newest: { ...newest, start: startRow({ id: 8 }) } }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ newest: { ...newest, report: heldReport(e, { conflicted: true }) } }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ newest: { ...newest, report: null } }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ newest: { ...newest, carry: { kind: 'absent' } } }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ newest: null }))).toBe(false);
    },
    'a designation that changed, the newest start unchanged, does not stand (review 3366 F4)': () => {
      expect(m.settleEvidenceStands(ev(), ev({ designation: pendingRead({ generation: 'other' }) }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ designation: { kind: 'not-designated', row: null } }))).toBe(false);
      expect(m.settleEvidenceStands(ev(), ev({ designation: { kind: 'unmeasured', why: 'locked' } }))).toBe(false);
    },
  };
}

export function skewCases(m: SandboxModule): Record<string, SuiteCase> {
  const base: Parameters<SandboxModule['skewNoticeOf']>[0] = { sessionId: BODY, running: false, digestStands: true, agreement: 'skewed',
    fleetBuild: 'v0.9.1', serverBuild: 'v0.9.2', noticed: () => false };
  return {
    'a dead Overlord under skew answers one notice naming both builds': () => {
      const n = m.skewNoticeOf(base);
      expect(n?.body).toContain('v0.9.1');
      expect(n?.body).toContain('v0.9.2');
      expect(n?.key).toBe(`${BODY}:v0.9.1:v0.9.2`);
    },
    'a live or unmeasured body, agreed builds, no digest, and a pair already noticed answer none': () => {
      expect(m.skewNoticeOf({ ...base, running: true })).toBeNull();
      expect(m.skewNoticeOf({ ...base, running: 'unmeasured' })).toBeNull();
      expect(m.skewNoticeOf({ ...base, agreement: 'agreed' })).toBeNull();
      expect(m.skewNoticeOf({ ...base, agreement: 'unknown' })).toBeNull();
      expect(m.skewNoticeOf({ ...base, digestStands: false })).toBeNull();
      expect(m.skewNoticeOf({ ...base, sessionId: null })).toBeNull();
      expect(m.skewNoticeOf({ ...base, noticed: (k) => k === `${BODY}:v0.9.1:v0.9.2` })).toBeNull();
    },
    'a new build pair is noticed again': () => {
      expect(m.skewNoticeOf({ ...base, serverBuild: 'v0.9.3', noticed: (k) => k === `${BODY}:v0.9.1:v0.9.2` })).not.toBeNull();
    },
    'the notice says what is measured: the builds differ and a digest mismatch can keep it from respawning (review 3325 F1)': () => {
      const body = m.skewNoticeOf(base)!.body;
      expect(body).toContain('is down while the two boxes run different builds');
      expect(body).toContain('the digest mismatch can keep it from respawning');
      expect(body).not.toMatch(/refused|stays down|would be|impossible|cannot respawn/);
    },
    'skewRunningOf: here runs; gone and asleep are down; doubt and an unlisted session are unmeasured (review 3325 F9)': () => {
      expect(m.skewRunningOf({ presence: 'alive' })).toBe(true);
      expect(m.skewRunningOf({ presence: 'dead' })).toBe(false);
      expect(m.skewRunningOf({ presence: 'asleep' })).toBe(false);
      expect(m.skewRunningOf({ presence: 'unknown', lifecycle: 'unmeasurable' })).toBe(false);
      expect(m.skewRunningOf({ presence: 'alive', lifecycle: 'restarting' })).toBe('unmeasured');
      expect(m.skewRunningOf({ presence: 'unknown' })).toBe('unmeasured');
      expect(m.skewRunningOf(undefined)).toBe('unmeasured');
    },
  };
}

const MODULE = path.join(ROOT, 'server/src/continuity/sandboxCheck.ts');

/** `sandboxVerdict`'s mutants: a property that reads `unmeasured` (or fails) as held, an empty tool-server set passing, a
 *  dropped property. */
const SANDBOX_VERDICT_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'S1', old: "out.push(v('profile', 'unmeasured', 'the report names no profile'))", new: "out.push(v('profile', 'held', 'x'))" },
    { id: 'S2', old: "out.push(v('tools', 'unmeasured', 'the offered tools were not read'))", new: "out.push(v('tools', 'held', 'x'))" },
    { id: 'S3', old: "out.push(v('tool-servers', 'unmeasured', 'the tool servers were not read'))", new: "out.push(v('tool-servers', 'held', 'x'))" },
    { id: 'S4', old: "out.push(v('instructions', 'unmeasured', 'the instruction files were not read'))", new: "out.push(v('instructions', 'held', 'x'))" },
    { id: 'S5', old: "out.push(L.skills === UNMEASURED ? v('skills', 'unmeasured', 'the skills were not read')", new: "out.push(L.skills === UNMEASURED ? v('skills', 'held', 'x')" },
    { id: 'S6', old: "out.push(L.agents === UNMEASURED ? v('agents', 'unmeasured', 'the agent types were not read')", new: "out.push(L.agents === UNMEASURED ? v('agents', 'held', 'x')" },
    { id: 'S7', old: "out.push(v('hooks', 'unmeasured', 'the SessionStart hooks were not read'))", new: "out.push(v('hooks', 'held', 'x'))" },
    { id: 'S8', old: "out.push(v('remote-control', 'unmeasured', 'the launch record names no remote control'))", new: "out.push(v('remote-control', 'held', 'x'))" },
    { id: 'S9', old: "out.push(v('permission-mode', 'unmeasured', 'the payload named no permission mode'))", new: "out.push(v('permission-mode', 'held', 'x'))" },
    { id: 'S10', old: "if (workspace.kind === 'unmeasured') out.push(v('workspace', 'unmeasured', workspace.reason));", new: "if (workspace.kind === 'unmeasured') out.push(v('workspace', 'held', 'x'));" },
    { id: 'S11', old: "if (lists === undefined) return v(property, 'unmeasured',", new: "if (lists === undefined) return v(property, 'held'," },
    { id: 'S12', old: "else if (L.toolServers.length === 1 && L.toolServers[0] === expected.toolServer)", new: "else if (L.toolServers.length <= 1 && (L.toolServers.length === 0 || L.toolServers[0] === expected.toolServer))" },
    { id: 'S13', old: "  if (report.conflicted) return whole('two different loads reports for this start');\n", new: '' },
    { id: 'S14', old: "  if (carry.report.conflicted) return \"the carried start's report is conflicted\";\n", new: '' },
    { id: 'S15', old: "  return { engaged: out.every((p) => p.state === 'held'), properties: out };", new: "  return { engaged: out.every((p) => p.state === 'held'), properties: out.filter((p) => p.property !== 'workspace') };" },
    { id: 'S16', old: "else if (!names(L.tools).some((t) => t.startsWith(door)))", new: 'else if (false)' },
    // renewal readings PR H: which failure is the account's (`fromAccount`)
    { id: 'FA1 a missing skill is the account\'s', old: "if (missing.length > 0) return v(property, 'failed', `the profile's ${list(missing)} not loaded`);", new: "if (missing.length > 0) return v(property, 'failed', `the profile's ${list(missing)} not loaded`, true);" },
    { id: 'FA2 an extra skill is not the account\'s', old: "if (extra.length > 0) return v(property, 'failed', `not in the profile: ${list(extra)}`, true);", new: "if (extra.length > 0) return v(property, 'failed', `not in the profile: ${list(extra)}`);" },
    { id: 'FA3 any outside file is the account\'s', old: "f.type === 'User' && !f.inWorkspace", new: '!f.inWorkspace' },
    { id: 'FA4 a User file in the workspace is the account\'s', old: "f.type === 'User' && !f.inWorkspace", new: "f.type === 'User'" },
    { id: 'FA5 an extra tool is not the account\'s', old: "`not in the profile: ${list(extra)}`, true));\n    else if (!names", new: "`not in the profile: ${list(extra)}`));\n    else if (!names" },
    { id: 'FA6 a foreign hook is not the account\'s', old: "SessionStart hook(s) not ccrc's`, true));", new: "SessionStart hook(s) not ccrc's`));" },
    { id: 'FA7 only the door server is the account\'s', old: 'names(L.toolServers).some((n) => n !== expected.toolServer)', new: 'true' },
  ],
  suite: (mod) => sandboxCases(mod),
};

/** `profileEngagedOf`'s mutants (review 3325 F8): a start with no report, a report of an older start, and a carry dropped. */
const PROFILE_ENGAGED_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'S17', old: "if (newest === null || newest.report === null) return 'not-engaged';", new: "if (newest === null) return 'not-engaged'; if (newest.report === null) return 'engaged';" },
    { id: 'P1', old: "  if (newest.report.startId !== newest.start.id) return 'not-engaged';\n", new: '' },
    { id: 'P2', old: "return sandboxVerdict(expected, newest.report, workspace, carry).engaged", new: "return sandboxVerdict(expected, newest.report, workspace, { kind: 'read', source: 'startup', report: { profileDigest: expected.digest, claudeVersion: newest.report.claudeVersion, conflicted: false } }).engaged" },
  ],
  suite: (mod) => sandboxCases(mod),
};

/** `sandboxSettle`'s mutants: settle an older start's report or another session's report, refuse a rebind row (designation B), go
 *  live on a failed verdict, settle another generation. */
const SANDBOX_SETTLE_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'T1', old: '|| newest === null || newest.id !== reportStartId) return', new: '|| newest === null) return' },
    { id: 'T2', old: "if (p === null || p.sessionId !== newest.sessionId)", new: "if (p === null || p.kind !== 'designate' || p.sessionId !== newest.sessionId)" },
    { id: 'T3', old: "if (verdict.engaged) return { kind: 'go-live'", new: "if (true) return { kind: 'go-live'" },
    { id: 'T4', old: "if (p.generation === null || p.generation !== newest.rowIncarnation) return { kind: 'none' };", new: "if (p.generation === null) return { kind: 'none' };" },
    { id: 'T7', old: "if (p === null || p.sessionId !== newest.sessionId)", new: "if (p === null)" },
  ],
  suite: (mod) => settleCases(mod),
};

/** `skewNoticeOf`'s and `skewRunningOf`'s mutants (review 3325 F8, F9): notice a live Overlord, notice twice, notice without the
 *  digest or under unknown builds, and read doubt, asleep or an unlisted session as down or running. */
const SKEW_NOTICE_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'T5', old: "if (f.sessionId === null || f.running !== false ||", new: "if (f.sessionId === null || f.running === 'unmeasured' ||" },
    { id: 'T6', old: '  if (f.noticed(key)) return null;\n', new: '' },
    { id: 'K1', old: "|| !f.digestStands ||", new: '||' },
    { id: 'K2', old: "|| f.agreement !== 'skewed') return null;", new: "|| f.agreement === 'agreed') return null;" },
    { id: 'R1', old: "return st === 'doubt' ? 'unmeasured' : st === 'here';", new: "return st === 'here';" },
    { id: 'R2', old: "return st === 'doubt' ? 'unmeasured' : st === 'here';", new: "return st === 'doubt' ? 'unmeasured' : st !== 'gone';" },
    { id: 'R3', old: "if (row === undefined) return 'unmeasured';", new: 'if (row === undefined) return false;' },
  ],
  suite: (mod) => skewCases(mod),
};

/** `settleEvidenceStands`'s mutants (review 3366 F4): either half of the check dropped, and the newest start compared by its
 *  id alone. */
const SETTLE_EVIDENCE_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'E1', old: ' && JSON.stringify(before.designation) === JSON.stringify(after.designation)', new: '' },
    { id: 'E2', old: 'JSON.stringify(before.newest) === JSON.stringify(after.newest) && ', new: '' },
    { id: 'E3', old: 'JSON.stringify(before.newest) === JSON.stringify(after.newest)', new: 'before.newest?.start.id === after.newest?.start.id' },
  ],
  suite: (mod) => settleEvidenceCases(mod),
};

/** `newestStartVerdict`'s mutants (renewal readings PR H): a start with no report, and a report of another start, read as a verdict. */
const NEWEST_VERDICT_SET: MutantSet<SandboxModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'N1 another start\'s report read', old: ' || newest.report.startId !== newest.start.id) return { startId', new: ') return { startId' },
    { id: 'N2 no start read as unmeasured', old: '  if (newest === null) return null;\n', new: '  if (newest === null) return { startId: 0, verdict: \'unmeasured\' };\n' },
    { id: 'N3 the carry dropped', old: 'sandboxVerdict(expected, newest.report, workspace, newest.carry) };', new: 'sandboxVerdict(expected, newest.report, workspace) };' },
  ],
  suite: (mod) => sandboxCases(mod),
};
export const SANDBOX_MUTANT_SETS: Readonly<Record<string, MutantSet<SandboxModule>>> = {
  'server/src/continuity/sandboxCheck.ts#newestStartVerdict': NEWEST_VERDICT_SET,
  'server/src/continuity/sandboxCheck.ts#sandboxVerdict': SANDBOX_VERDICT_SET,
  'server/src/continuity/sandboxCheck.ts#profileEngagedOf': PROFILE_ENGAGED_SET,
  'server/src/continuity/sandboxCheck.ts#sandboxSettle': SANDBOX_SETTLE_SET,
  'server/src/continuity/sandboxCheck.ts#skewNoticeOf': SKEW_NOTICE_SET,
  'server/src/continuity/sandboxCheck.ts#settleEvidenceStands': SETTLE_EVIDENCE_SET,
};
