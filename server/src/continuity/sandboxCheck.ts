// L1, context C3 (Session Conversation): the Overlord's sandbox check (Overlord spec §3.6 H4, §3.2 C2, §7.5 Table 7.5a; W1
// sandbox, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`, Tasks 8 and 9). Pure: the expected surface,
// the stored loads report, the workspace fact, the designation and the build agreement arrive as arguments; nothing reads a
// clock, a file or the database.
//
// NO VERDICT IS STORED (slug `verdict-computed-on-read`). Every reader computes it here, from the report of the session's
// newest `startup` or `resume` start (`continuityStore.ts#startLoadsOfNewestStart`, joined by `startId`) and the server's own
// profile, so no reader sees an older start's report or a verdict computed against another build's profile.
//
// UNMEASURED IS NEVER HELD (Review Focus 3). A property whose input is missing, of a shape this build does not know, or carried
// from a start the server cannot vouch for reads `unmeasured`, and `engaged` needs every property `held`.
//
// - `sandboxVerdict`: per property, held, failed or unmeasured, and `engaged`.
// - `profileEngagedOf`: the ladder's condition input (`launch-profile-unengaged`, read by the gate order's step 6).
// - `newestStartVerdict`: the newest start's verdict with its id, for the generations pass's account hold (renewal readings H).
// - `sandboxSettle`: what the first report of a pending designation does to it: go live, fail the attempt, or nothing.
// - `skewNoticeOf`: the one operator notice when a dead Overlord waits for the two boxes to run one build (question 5).
import { createHash } from 'node:crypto';
import type { BuildAgreement } from '../../../shared/api.js';
import type { StartRow } from '../../../shared/continuity.js';
import { FLEET_ROLES, type FleetRole } from '../../../shared/fleetRoles.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import {
  CLAUDE_CODE_OWN_LISTS, SANDBOX_PROPERTIES, UNMEASURED, type ClaudeCodeOwnLists, type LoadedEntry, type LoadedInstruction,
  type SandboxProperty,
} from '../../../shared/overlord-sandbox.js';
import { rowStanding, type RowStandingFacts } from '../sessionReading.js';
import { LAUNCH_HOOK_COMMAND, launchDigestOf } from './launchProfile.js';
import type { StartLoadsRow } from './startLoads.js';

export type { SandboxProperty };

/** What the check compares a report against: the server's own `overlord` row, never the report's. */
export interface ExpectedSurface {
  readonly role: FleetRole;
  /** `launchDigestOf(role)`: the row ccd should have composed. */
  readonly digest: string;
  /** `--tools`: the main thread's built-in tools. */
  readonly tools: readonly string[];
  /** The one tool server; its tools are `mcp__<server>__<tool>`. */
  readonly toolServer: string;
  /** The declared reader types (`--agents`). */
  readonly readerTypes: readonly string[];
  /** The skills the profile lists beside Claude Code's own. */
  readonly skills: readonly string[];
  /** sha256 of the constitution, the workspace memory file. */
  readonly constitutionSha256: string;
  /** sha256 of ccrc's hook command, as the hook hashes a SessionStart hook's command (its bytes, no newline). */
  readonly hookSha256: string;
  /** Claude Code's own agent types and skills, by build (question 4). */
  readonly ownLists: ClaudeCodeOwnLists;
}

/** The expected surface of a role, or null for a role whose profile has no surface. `ownLists` is the release's table; only a
 *  test passes its own isolated lists (review 3325 F4). */
export function expectedSurfaceOf(role: FleetRole, ownLists: ClaudeCodeOwnLists = CLAUDE_CODE_OWN_LISTS): ExpectedSurface | null {
  const s = FLEET_ROLES[role].launchProfile.surface;
  if (s === null) return null;
  return {
    role, digest: launchDigestOf(role), tools: s.tools, toolServer: s.toolServer, readerTypes: Object.keys(s.readerTypes),
    skills: s.skills, constitutionSha256: s.constitutionSha256,
    hookSha256: createHash('sha256').update(LAUNCH_HOOK_COMMAND, 'utf8').digest('hex'), ownLists,
  };
}

export type PropertyState = 'held' | 'failed' | 'unmeasured';
/** `fromAccount` (renewal readings PR H, §3.6): the property failed because the start loaded something the profile does not
 *  list from the account's own config directory, so another account may start clean; false for every other answer (held,
 *  unmeasured, something missing, the launch's own composition, or a file the workspace or its parents hold). THE HARNESS
 *  KNOWLEDGE LIVES HERE, beside the check that reads the report, never in the hold's decider (`holdOfStart`): an extra tool,
 *  tool server, skill, agent type or SessionStart hook is read as the account's, because the profile pins the setting sources
 *  to the project, names the one tool server under the strict tool-server config and stages the workspace's only skills and
 *  file, and no project settings file can stand in the workspace (§3.6), so what is left is the account's config directory
 *  (its mods, skills, agents and settings); an extra instruction file is the account's only when Claude Code typed it `User`
 *  (the config directory's own memory file) and it lies outside the workspace. */
export interface PropertyVerdict {
  readonly property: SandboxProperty; readonly state: PropertyState; readonly detail: string; readonly fromAccount: boolean;
}
export interface SandboxVerdict { readonly engaged: boolean; readonly properties: readonly PropertyVerdict[] }

/** What the server knows of the session's workspace: the registry row's project, measured or not. */
export type WorkspaceFact = { readonly kind: 'measured'; readonly project: string } | { readonly kind: 'unmeasured'; readonly reason: string };

/** The start a resume's report says it carried `instructions` and `hooks` from (`carriedFrom`), as the server reads it (review
 *  2135 F9): `none` when the report names no carry; `read` with that start's source and its own report's digest, build and
 *  conflict flag (`report: null` when that start has no report); `absent` when no start of this session carries that
 *  `reportId`; `unmeasured` when it could not be read. */
export type CarryFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'read'; readonly source: StartRow['source'];
      readonly report: { readonly profileDigest: string | null; readonly claudeVersion: string | null; readonly conflicted: boolean } | null }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unmeasured'; readonly reason: string };

const v = (property: SandboxProperty, state: PropertyState, detail: string, fromAccount = false): PropertyVerdict =>
  ({ property, state, detail, fromAccount });
/** A loaded instruction file that is the account's own: Claude Code's `User` memory file, outside the workspace. */
const accountFile = (f: LoadedInstruction): boolean => f.type === 'User' && !f.inWorkspace;
const names = (k: readonly LoadedEntry[]): string[] => k.filter((e): e is string => typeof e === 'string');
const list = (xs: readonly string[]): string => xs.join(', ');

/** Whether a resume's carried kinds can stand: the start it names is a `startup` of this session whose own report is not
 *  conflicted and records this report's digest and build. Anything else, the carried kinds read `unmeasured`. */
function carryWhy(report: StartLoadsRow, carry: CarryFact): string | null {
  if (report.carriedFrom === null) return null;
  if (carry.kind === 'none') return 'the carried start was not read';
  if (carry.kind === 'absent') return `no start of this session carries ${report.carriedFrom}`;
  if (carry.kind === 'unmeasured') return `the carried start could not be read: ${carry.reason}`;
  if (carry.source !== 'startup') return `the carried start is a ${carry.source} start, not a startup`;
  if (carry.report === null) return 'the carried start has no loads report';
  if (carry.report.conflicted) return "the carried start's report is conflicted";
  if (carry.report.profileDigest !== report.profileDigest || carry.report.claudeVersion !== report.claudeVersion) {
    return "the carried start's digest or build differs from this report's";
  }
  return null;
}

/** A listed kind against the profile's names and the build's own list: within both, and every profile name present. */
function listed(property: 'skills' | 'agents', got: readonly LoadedEntry[], profile: readonly string[], build: string | null,
  own: ExpectedSurface['ownLists']): PropertyVerdict {
  const lists = build === null ? undefined : own[build];
  if (lists === undefined) return v(property, 'unmeasured', `Claude Code ${build ?? '(unknown build)'} has no measured own lists`);
  const allowed = new Set([...profile, ...lists[property]]);
  const have = names(got);
  const extra = have.filter((n) => !allowed.has(n));
  if (extra.length > 0) return v(property, 'failed', `not in the profile: ${list(extra)}`, true);
  const missing = profile.filter((n) => !have.includes(n));
  if (missing.length > 0) return v(property, 'failed', `the profile's ${list(missing)} not loaded`);
  return v(property, 'held', `${have.length} listed`);
}

/** Total and pure: `engaged` only when every property is `held`. A null or conflicted report reads every property
 *  `unmeasured`. */
export function sandboxVerdict(expected: ExpectedSurface, report: StartLoadsRow | null, workspace: WorkspaceFact,
  carry: CarryFact = { kind: 'none' }): SandboxVerdict {
  const whole = (detail: string): SandboxVerdict => ({ engaged: false, properties: SANDBOX_PROPERTIES.map((p) => v(p, 'unmeasured', detail)) });
  if (report === null) return whole('no loads report for this start');
  if (report.conflicted) return whole('two different loads reports for this start');
  const L = report.loaded;
  const carried = carryWhy(report, carry);
  const out: PropertyVerdict[] = [];

  // profile: the role and the digest of the row ccd composed.
  if (report.profileRole === null || report.profileDigest === null) out.push(v('profile', 'unmeasured', 'the report names no profile'));
  else if (report.profileRole !== expected.role) out.push(v('profile', 'failed', `the role is ${report.profileRole}`));
  else if (report.profileDigest !== expected.digest) out.push(v('profile', 'failed', "the digest is not this server's profile"));
  else out.push(v('profile', 'held', expected.role));

  // tools: the offered tools are the profile's built-ins and the tool server's tools, and the server's are offered.
  const door = `mcp__${expected.toolServer}__`;
  if (L.tools === UNMEASURED) out.push(v('tools', 'unmeasured', 'the offered tools were not read'));
  else {
    const extra = names(L.tools).filter((t) => !expected.tools.includes(t) && !t.startsWith(door));
    if (extra.length > 0) out.push(v('tools', 'failed', `not in the profile: ${list(extra)}`, true));
    else if (!names(L.tools).some((t) => t.startsWith(door))) out.push(v('tools', 'failed', `no ${expected.toolServer} tool offered`));
    else out.push(v('tools', 'held', `${L.tools.length} offered`));
  }

  // tool-servers: exactly the one server.
  if (L.toolServers === UNMEASURED) out.push(v('tool-servers', 'unmeasured', 'the tool servers were not read'));
  else if (L.toolServers.length === 1 && L.toolServers[0] === expected.toolServer) out.push(v('tool-servers', 'held', expected.toolServer));
  else if (L.toolServers.length === 0) out.push(v('tool-servers', 'failed', 'no tool server'));
  else out.push(v('tool-servers', 'failed', `servers: ${list(names(L.toolServers))}`, names(L.toolServers).some((n) => n !== expected.toolServer)));

  // instructions: exactly one file, the workspace's CLAUDE.md, with the constitution's digest.
  const instr = L.instructions === UNMEASURED ? null : L.instructions.filter((e): e is LoadedInstruction => typeof e !== 'string');
  if (carried !== null) out.push(v('instructions', 'unmeasured', carried));
  else if (instr === null) out.push(v('instructions', 'unmeasured', 'the instruction files were not read'));
  else if (instr.length !== 1) out.push(v('instructions', 'failed', `${instr.length} instruction files`, instr.some(accountFile)));
  else if (instr[0]!.name !== 'CLAUDE.md' || !instr[0]!.inWorkspace) out.push(v('instructions', 'failed', `the file is ${instr[0]!.name}`, accountFile(instr[0]!)));
  else if (instr[0]!.sha256 !== expected.constitutionSha256) out.push(v('instructions', 'failed', 'the file is not the constitution'));
  else out.push(v('instructions', 'held', 'the constitution'));

  // skills and agents: within the profile's names and the build's own lists, and the profile's names present.
  out.push(L.skills === UNMEASURED ? v('skills', 'unmeasured', 'the skills were not read')
    : listed('skills', L.skills, expected.skills, report.claudeVersion, expected.ownLists));
  out.push(L.agents === UNMEASURED ? v('agents', 'unmeasured', 'the agent types were not read')
    : listed('agents', L.agents, expected.readerTypes, report.claudeVersion, expected.ownLists));

  // hooks: every SessionStart hook is ccrc's, and ccrc's ran (a failing one is read beside the ones that succeeded).
  if (carried !== null) out.push(v('hooks', 'unmeasured', carried));
  else if (L.hooks === UNMEASURED) out.push(v('hooks', 'unmeasured', 'the SessionStart hooks were not read'));
  else {
    const foreign = names(L.hooks).filter((h) => h !== expected.hookSha256).length;
    if (foreign > 0) out.push(v('hooks', 'failed', `${foreign} SessionStart hook(s) not ccrc's`, true));
    else if (!names(L.hooks).includes(expected.hookSha256)) out.push(v('hooks', 'failed', "ccrc's hook did not run"));
    else out.push(v('hooks', 'held', "ccrc's hook only"));
  }

  // remote-control: ccd's record of the flags it spliced (slug `remote-control-read-from-the-spawn-record`).
  if (report.launchRc === null) out.push(v('remote-control', 'unmeasured', 'the launch record names no remote control'));
  else out.push(v('remote-control', report.launchRc === 'off' ? 'held' : 'failed', report.launchRc));

  // permission-mode: bypass, so no permission prompt ever waits on the operator.
  if (report.permissionMode === null) out.push(v('permission-mode', 'unmeasured', 'the payload named no permission mode'));
  else out.push(v('permission-mode', report.permissionMode === 'bypassPermissions' ? 'held' : 'failed', report.permissionMode));

  // workspace: the registry row's project, the session's cwd, and every instruction file inside the workspace.
  if (workspace.kind === 'unmeasured') out.push(v('workspace', 'unmeasured', workspace.reason));
  else if (workspace.project !== 'overlord') out.push(v('workspace', 'failed', `the project is ${workspace.project}`));
  else if (report.cwdInWorkspace === null) out.push(v('workspace', 'unmeasured', 'the cwd was not measured'));
  else if (!report.cwdInWorkspace) out.push(v('workspace', 'failed', 'the cwd is outside the workspace'));
  else if (carried !== null || instr === null) out.push(v('workspace', 'unmeasured', 'the instruction files were not read'));
  else if (instr.some((f) => !f.inWorkspace)) out.push(v('workspace', 'failed', 'an instruction file lies outside the workspace'));
  else out.push(v('workspace', 'held', 'overlord'));

  return { engaged: out.every((p) => p.state === 'held'), properties: out };
}

/** The ladder's condition input: the verdict of the session's newest `startup` or `resume` start, by that start's own
 *  report. The read (`startLoadsOfNewestStart`) already passes over `clear` and `compact` starts. No such start, one with no
 *  report, or a report of any other start (never an older start's, review 3325 F8), reads `not-engaged`. */
export function profileEngagedOf(newest: { readonly start: StartRow; readonly report: StartLoadsRow | null } | null,
  expected: ExpectedSurface, workspace: WorkspaceFact, carry: CarryFact = { kind: 'none' }): 'engaged' | 'not-engaged' {
  if (newest === null || newest.report === null) return 'not-engaged';
  if (newest.report.startId !== newest.start.id) return 'not-engaged';
  return sandboxVerdict(expected, newest.report, workspace, carry).engaged ? 'engaged' : 'not-engaged';
}

/** The verdict of the session's newest `startup` or `resume` start, by that start's own report, with the start's id: the read
 *  the generations pass asks before it holds an account (renewal readings PR H, `holdOfStart`). No such start is null; a start
 *  with no report yet, or a report of another start (as `profileEngagedOf` reads it), is `unmeasured`, so the pass asks again. */
export function newestStartVerdict(newest: { readonly start: StartRow; readonly report: StartLoadsRow | null; readonly carry: CarryFact } | null,
  expected: ExpectedSurface, workspace: WorkspaceFact): { readonly startId: number; readonly verdict: SandboxVerdict | 'unmeasured' } | null {
  if (newest === null) return null;
  if (newest.report === null || newest.report.startId !== newest.start.id) return { startId: newest.start.id, verdict: 'unmeasured' };
  return { startId: newest.start.id, verdict: sandboxVerdict(expected, newest.report, workspace, newest.carry) };
}

export type SettleAct =
  | { readonly kind: 'none' }
  | { readonly kind: 'go-live'; readonly sessionId: string; readonly generation: string }
  | { readonly kind: 'fail-pending'; readonly sessionId: string; readonly properties: readonly PropertyVerdict[] };

/** What a loads report does to the designation (Task 9; slug `settle-takes-the-report-start-id`). It acts only for a pending
 *  attempt, a `designate` or (designation B) a `rebind`, whose session is the newest start's and whose generation is the one
 *  that start reported, and only when the report's start IS that newest `startup` or `resume` start (a respawn before the first
 *  `Stop` makes a `resume` start, and its report settles). Every other report is `none`, and so is a resend once settled,
 *  because settling clears the pending slot. */
export function sandboxSettle(designation: DesignationRead, reportStartId: number, newest: StartRow | null,
  verdict: SandboxVerdict): SettleAct {
  if (designation.kind === 'unmeasured' || newest === null || newest.id !== reportStartId) return { kind: 'none' };
  const p = designation.row?.pending ?? null;
  if (p === null || p.sessionId !== newest.sessionId) return { kind: 'none' };
  if (p.generation === null || p.generation !== newest.rowIncarnation) return { kind: 'none' };
  if (verdict.engaged) return { kind: 'go-live', sessionId: p.sessionId, generation: p.generation };
  return { kind: 'fail-pending', sessionId: p.sessionId, properties: verdict.properties.filter((x) => x.state !== 'held') };
}

/** What a settle read before its registry await: the designation and the session's newest start with its report and carry. */
export interface SettleEvidence {
  readonly designation: DesignationRead;
  readonly newest: { readonly start: StartRow; readonly report: StartLoadsRow | null; readonly carry: CarryFact } | null;
}

/** Whether the evidence a settle read still stands after its registry await (review 3346 F3): the same newest start, the same
 *  stored report and carry, and the same designation. The start and loads doors write outside the coordination serialiser,
 *  so a newer start or a second body can land during that await; a settle on the obsolete snapshot then decides nothing. */
export function settleEvidenceStands(before: SettleEvidence, after: SettleEvidence): boolean {
  return JSON.stringify(before.newest) === JSON.stringify(after.newest) && JSON.stringify(before.designation) === JSON.stringify(after.designation);
}

/** The facts the skew notice reads: the designated Overlord body (never a pending attempt), whether it runs, whether its
 *  route carries `profiledigest`, the build agreement and both builds, and the pairs already noticed. */
export interface SkewFacts {
  readonly sessionId: string | null;
  readonly running: boolean | 'unmeasured';
  readonly digestStands: boolean;
  readonly agreement: BuildAgreement;
  readonly fleetBuild: string | null;
  readonly serverBuild: string | null;
  /** Whether a notice with this key was raised already (the feed's once-only key, `CoordStore.hasNotice`). */
  readonly noticed: (key: string) => boolean;
}

/** The one notice a dead Overlord under build skew raises (question 5, slug `dead-overlord-waits-for-build-agreement`): once
 *  per session and build pair. A live body, an unmeasured one, one whose route no longer carries the digest, and agreed or
 *  unknown builds raise none; `key` is what the caller records so the same pair is never noticed again. The words say what
 *  is measured (review 3325 F1): the builds differ, and a digest mismatch CAN keep the body from respawning. Nothing here reads
 *  whether a respawn was refused, and a release that leaves the `overlord` row alone keeps its digest, so the notice never says
 *  a respawn was or will be refused. */
export function skewNoticeOf(f: SkewFacts): { readonly key: string; readonly body: string } | null {
  if (f.sessionId === null || f.running !== false || !f.digestStands || f.agreement !== 'skewed') return null;
  const fleet = f.fleetBuild ?? 'an unread build';
  const server = f.serverBuild ?? 'an unread build';
  const key = `${f.sessionId}:${fleet}:${server}`;
  if (f.noticed(key)) return null;
  return { key, body: `The Overlord (${f.sessionId}) is down while the two boxes run different builds: the fleet box runs ${fleet}, the server ${server}. Its route carries its launch profile's digest, and if the two builds disagree on that profile, the digest mismatch can keep it from respawning until both boxes run one build.` };
}

/** Whether the Overlord's body runs, for the skew notice (review 3325 F9), from its fleet-state row read through
 *  `rowStanding`: `here` runs; `gone` and `asleep` are down; `doubt`, or a session the state does not list, is unmeasured and
 *  raises nothing. */
export function skewRunningOf(row: RowStandingFacts | undefined): boolean | 'unmeasured' {
  if (row === undefined) return 'unmeasured';
  const st = rowStanding(row);
  return st === 'doubt' ? 'unmeasured' : st === 'here';
}
