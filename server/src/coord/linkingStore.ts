// The linking standard's SQL (D-8147): one `project_linking` row per project, holding the operator's team key and
// override (`setLinking`) and the last visibility reading (`recordReading`). It sits beside `store.ts` in the same ring and
// context (Coordination) in `reviewCapStore.ts`'s idiom: every function takes the store's `DatabaseSync` and is
// synchronous, and `CoordStore` keeps one-line delegates. The decision of which rule applies is `linking/policy.ts`'s
// `linkingMode` and nothing here. D-8405: the team key's source, the automatic link and its candidates are this table's
// too (`linkTeamAuto`, `recordTeamCandidates`); who may write the key is `linking/teamLink.ts`'s, and the SQL here holds
// the operator's key against the pass in the same statement that would write it.
import type { DatabaseSync } from 'node:sqlite';
import type {
  LinkingOverride, LinkingWriteBody, ProjectLinkingWire, RepoVisibility, TeamCandidateWire, TeamEvidence, TeamLinkSource,
  TeamLinkWire, TemplateState,
} from '../../../shared/linking.js';
import { isTeamCandidate, isTeamEvidence } from '../../../shared/linking.js';
import { isLinearTeamKey } from '../../../shared/linear.js';
import { linkingMode } from '../linking/policy.js';
import { pairChangedByWrite, teamSourceAfterWrite } from '../linking/teamLink.js';
import { insertCall } from './coordCallsStore.js';
import type { NewCall } from './coordCalls.js';
import { tx } from './tx.js';

interface Row {
  project: string; teamKey: string | null; override: LinkingOverride | null;
  visibility: RepoVisibility | null; slug: string | null; template: TemplateState | null;
  failReason: string | null; measuredAt: number | null;
  initiatives: string; linearOwner: string | null; ownsTeam: number;
  setAt: number | null; teamSource: string | null; teamName: string | null; teamEvidence: string | null;
  teamAt: number | null; teamCandidates: string | null; teamWorkspace: string | null; teamSuggestions: string | null;
  teamCallId: number | null;
}

const COLUMNS = 'project, teamKey, override, visibility, slug, template, failReason, measuredAt, initiatives, linearOwner, ownsTeam, '
  + 'setAt, teamSource, teamName, teamEvidence, teamAt, teamCandidates, teamWorkspace, teamSuggestions, teamCallId';

/** A project with no row: no key, no override, nothing measured. */
export const UNSET_LINKING: ProjectLinkingWire = Object.freeze({
  teamKey: null, override: null, measured: Object.freeze({ state: 'unmeasured' as const }), mode: 'unknown' as const,
  initiatives: 'on' as const, linearOwner: null, ownsTeam: false, teamLink: null, teamCandidates: Object.freeze([]), teamWorkspace: null,
});

/** A stored JSON cell, or undefined when it does not parse. */
const jsonOf = (text: string | null): unknown => {
  if (text === null) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
};

// @anchor link-source-of
/** THE ONE READER of a row's link source (D-8809, option B): every reader of `teamSource` and `teamCallId` goes through it
 *  (`single-definition/team-link-source.test.ts` holds that). Migration 64's CHECK on `teamSource` (`manual`, `auto`) cannot
 *  widen without a table rebuild, so the Overlord's link is stored as `auto` with the call that recorded it in `teamCallId`.
 *  null: no one decided since migration 64, or a word out of the vocabulary. */
export function linkSourceOf(teamSource: string | null, teamCallId: number | null): TeamLinkSource | null {
  if (teamSource === 'manual') return 'manual';
  if (teamSource === 'auto') return teamCallId === null ? 'auto' : 'overlord';
  return null;
}

/** The stored word for a derived source: the Overlord's link is stored as `auto` (its call id written beside it). */
const storedWordOf = (s: TeamLinkSource | null): 'manual' | 'auto' | null => (s === 'overlord' ? 'auto' : s);

/** Who set the key (D-8405). No key: null, unless the operator cleared it (`manual`: the pass then never links it).
 *  `auto` with its team and evidence intact: the pass's link; `overlord` the same plus its call (D-8809: the source comes
 *  from `linkSourceOf`, because the store keeps the Overlord's link as `auto` beside the call's id). Anything else with a key
 *  is the operator's: before migration 64 the operator was the key's only writer. */
function teamLinkOf(row: Row | undefined): TeamLinkWire | null {
  if (row === undefined) return null;
  const source = linkSourceOf(row.teamSource, row.teamCallId);
  if (row.teamKey === null) return source === 'manual' ? { source: 'manual', at: row.teamAt } : null;
  const evidence = jsonOf(row.teamEvidence);
  if (row.teamName !== null && row.teamAt !== null && isTeamEvidence(evidence)) {
    if (source === 'auto') return { source, teamName: row.teamName, evidence, at: row.teamAt };
    if (source === 'overlord' && row.teamCallId !== null) {
      return { source, teamName: row.teamName, evidence, at: row.teamAt, callId: row.teamCallId };
    }
  }
  return { source: 'manual', at: source === 'manual' ? row.teamAt : row.setAt };
}

/** The stored candidates, each through its guard; a cell that does not parse reads as none. */
function candidatesOf(row: Row | undefined): TeamCandidateWire[] {
  const v = jsonOf(row?.teamCandidates ?? null);
  return Array.isArray(v) ? v.filter((c): c is TeamCandidateWire => isTeamCandidate(c, isLinearTeamKey)) : [];
}

/** One stored suggestion (D-8808): a coordinator session's candidate team with its reason. */
export interface TeamSuggestion {
  by: string; key: string; workspaceId: string | null; workspaceName: string | null; teamName: string; why: string; at: number;
}

const isSuggestion = (v: unknown): v is TeamSuggestion => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o['by'] === 'string' && typeof o['teamName'] === 'string' && typeof o['why'] === 'string'
    && typeof o['at'] === 'number' && isLinearTeamKey(o['key'])
    && (o['workspaceId'] === null || typeof o['workspaceId'] === 'string')
    && (o['workspaceName'] === null || typeof o['workspaceName'] === 'string');
};

/** The stored suggestions; a cell that does not parse reads as none. */
function suggestionsOf(text: string | null): TeamSuggestion[] {
  const v = jsonOf(text);
  return Array.isArray(v) ? v.filter(isSuggestion) : [];
}

/** D-8808: each suggestion as a candidate, after the pass's, each through `isTeamCandidate`. */
function suggestedCandidates(row: Row | undefined): TeamCandidateWire[] {
  return suggestionsOf(row?.teamSuggestions ?? null).flatMap((s) => {
    const c: TeamCandidateWire = { key: s.key, name: s.teamName, evidence: { kind: 'suggested', by: s.by, why: s.why } };
    if (s.workspaceId !== null) { c.workspaceId = s.workspaceId; c.workspaceName = s.workspaceName; }
    return isTeamCandidate(c, isLinearTeamKey) ? [c] : [];
  });
}

function wireOf(row: Row | undefined): ProjectLinkingWire {
  const teamKey = row?.teamKey ?? null;
  const override = row?.override ?? null;
  let measured: ProjectLinkingWire['measured'] = { state: 'unmeasured' };
  if (row !== undefined && row.failReason !== null && row.measuredAt !== null) {
    measured = { state: 'failed', reason: row.failReason, at: row.measuredAt };
  } else if (row !== undefined && row.visibility !== null && row.slug !== null && row.template !== null && row.measuredAt !== null) {
    measured = { state: 'measured', visibility: row.visibility, slug: row.slug, template: row.template, at: row.measuredAt };
  }
  // A failed re-read leaves the last good visibility columns in place (`recordReading`), and the rule stays what that
  // reading made it: one `gh` blip must not turn a measured public project 'unknown' (D-8147). A project that never had a
  // good reading has no such columns and stays unknown.
  const ruled: ProjectLinkingWire['measured'] = measured.state === 'failed' && row?.visibility != null && row.slug !== null
    && row.template !== null
    ? { state: 'measured', visibility: row.visibility, slug: row.slug, template: row.template, at: measured.at }
    : measured;
  // D-8181: the hierarchy settings come from their own columns (migration 59); a project with no row reads the defaults.
  return {
    teamKey, override, measured, mode: linkingMode(override, ruled),
    initiatives: row?.initiatives === 'off' ? 'off' : 'on', linearOwner: row?.linearOwner ?? null, ownsTeam: row?.ownsTeam === 1,
    teamLink: teamLinkOf(row), teamCandidates: [...candidatesOf(row), ...suggestedCandidates(row)], teamWorkspace: row?.teamWorkspace ?? null,
  };
}

/** The operator's write: the key and the override, who and when; the reading is left as it is. D-8405: a write that
 *  changes the key makes it the operator's (`teamSourceAfterWrite`), and the pass's team and evidence go with the old key;
 *  one that sends the stored key back keeps whoever set it. D-8808 (final review M3): a write that keeps the key but changes its
 *  workspace changes the pair (`pairChangedByWrite`), so it is the operator's decision too, and the Overlord's call id goes.
 *  D-8808: `w.workspace` is the DECIDED workspace (`workspaceAfterWrite`), written with the key in the same statement: a string or null is written as it is, and ABSENT
 *  leaves the stored workspace untouched here too (one meaning at the wire and at the store: omitted keeps). The route
 *  always passes the decided one. Read and written in one transaction. */
export function setLinking(db: DatabaseSync, project: string, w: LinkingWriteBody, by: string, at: number): void {
  tx(db, () => {
    const before = db.prepare('SELECT teamKey, teamSource, teamCallId, teamWorkspace FROM project_linking WHERE project = ?').get(project) as
      { teamKey: string | null; teamSource: string | null; teamCallId: number | null; teamWorkspace: string | null } | undefined;
    const prior = {
      teamKey: before?.teamKey ?? null, source: linkSourceOf(before?.teamSource ?? null, before?.teamCallId ?? null), workspace: before?.teamWorkspace ?? null,
    };
    const written = { teamKey: w.teamKey, ...(w.workspace === undefined ? {} : { workspace: w.workspace }) };
    const pairChanged = pairChangedByWrite(prior, written);
    db.prepare(
      'INSERT INTO project_linking (project, teamKey, override, setBy, setAt, teamSource, teamAt, teamWorkspace) VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(project) DO UPDATE SET teamKey = excluded.teamKey, override = excluded.override, '
      + 'setBy = excluded.setBy, setAt = excluded.setAt, teamSource = excluded.teamSource'
      + (w.workspace !== undefined ? ', teamWorkspace = excluded.teamWorkspace' : '')
      + (w.teamKey !== null ? ', teamSuggestions = NULL' : '')
      + (pairChanged ? ', teamName = NULL, teamEvidence = NULL, teamAt = excluded.teamAt, teamCallId = NULL' : ''),
    ).run(project, w.teamKey, w.override, by, at, storedWordOf(teamSourceAfterWrite(prior, written)), pairChanged ? at : null, w.workspace ?? null);
  });
}

/** A team link a writer stores: the team's key and name, the evidence and the workspace it lives in. */
export interface TeamLinkWrite { key: string; name: string; evidence: TeamEvidence; workspace?: string | null }

/** THE ONE STATEMENT that links a team without the operator (D-8405, D-8809): the pass's link (`callId` null) and the
 *  Overlord's (the call that recorded it). Written only where no key is stored and the operator has not decided
 *  (`teamSource` is not `manual`), in the same statement, so an operator's write that lands first always wins. Both are
 *  stored as `auto`; `linkSourceOf` tells them apart by the call id. True when the row was written. */
function writeTeamLink(db: DatabaseSync, project: string, link: TeamLinkWrite, callId: number | null, at: number): boolean {
  const res = db.prepare(
    'INSERT INTO project_linking (project, teamKey, teamSource, teamName, teamEvidence, teamAt, teamCandidates, teamWorkspace, teamCallId) '
    + "VALUES (?, ?, 'auto', ?, ?, ?, NULL, ?, ?) "
    + 'ON CONFLICT(project) DO UPDATE SET teamKey = excluded.teamKey, teamSource = excluded.teamSource, '
    + 'teamName = excluded.teamName, teamEvidence = excluded.teamEvidence, teamAt = excluded.teamAt, teamCandidates = NULL, teamWorkspace = excluded.teamWorkspace, teamSuggestions = NULL, '
    + 'teamCallId = excluded.teamCallId '
    + "WHERE project_linking.teamKey IS NULL AND project_linking.teamSource IS NOT 'manual'",
  ).run(project, link.key, link.name, JSON.stringify(link.evidence), at, link.workspace ?? null, callId);
  return Number(res.changes) > 0;
}

/** D-8405: the automatic pass links `key` for a project, with its team's name and the evidence (`writeTeamLink`'s rule). */
export function linkTeamAuto(db: DatabaseSync, project: string, link: TeamLinkWrite, at: number): boolean {
  return writeTeamLink(db, project, link, null, at);
}

/** Thrown inside the transaction to roll the call back when the link's rule refuses. */
class LinkRefused extends Error {}

/** D-8809: the Overlord confirms one candidate, as a call made in the operator's name. The call first (the store's one
 *  INSERT, `insertCall`), then the link with its id under `writeTeamLink`'s rule, in ONE transaction: a link the rule refuses
 *  (a key stored, or the operator decided, meanwhile) rolls the call back. The call's id, or null when refused. */
export function linkTeamOverlord(
  db: DatabaseSync, project: string, link: TeamLinkWrite,
  call: { program: string; madeBy: string; call: NewCall; build: string | null }, at: number,
): number | null {
  try {
    return tx(db, () => {
      const callId = insertCall(db, call.program, call.madeBy, call.call, call.build, at);
      if (!writeTeamLink(db, project, link, callId, at)) throw new LinkRefused();
      return callId;
    });
  } catch (err) {
    if (err instanceof LinkRefused) return null;
    throw err;
  }
}

/** D-8405: the pass's candidates for a project (none: NULL). Written only when they differ from what is stored, so a
 *  pass that finds the same answer writes nothing. */
export function recordTeamCandidates(db: DatabaseSync, project: string, candidates: readonly TeamCandidateWire[]): void {
  if (candidates.length === 0) {
    db.prepare('UPDATE project_linking SET teamCandidates = NULL WHERE project = ? AND teamCandidates IS NOT NULL').run(project);
    return;
  }
  db.prepare(
    'INSERT INTO project_linking (project, teamCandidates) VALUES (?, ?) '
    + 'ON CONFLICT(project) DO UPDATE SET teamCandidates = excluded.teamCandidates '
    + 'WHERE project_linking.teamCandidates IS NOT excluded.teamCandidates',
  ).run(project, JSON.stringify(candidates));
}

/** The most suggestions a project keeps: the newest by `at`. */
export const TEAM_SUGGESTIONS_MAX = 8;

/** D-8808: a coordinator session's suggestion of a team for a project: one per session (a resend replaces its element), at
 *  most `TEAM_SUGGESTIONS_MAX` (the oldest by `at` of the other sessions' goes; never the one being written). A candidate only. UPDATE-only: a project with no row is `no-project`
 *  (a typo mints no phantom project; every listed project has a row from the visibility lane's reading). Written only where no
 *  key is stored, in the same statement (`team-set` otherwise, an operator's key landing first wins). Nothing in the pass or the
 *  decider reads the cell. */
export function recordTeamSuggestion(db: DatabaseSync, project: string, s: TeamSuggestion): 'written' | 'team-set' | 'no-project' {
  return tx(db, () => {
    const row = db.prepare('SELECT teamKey, teamSuggestions FROM project_linking WHERE project = ?').get(project) as
      { teamKey: string | null; teamSuggestions: string | null } | undefined;
    if (row === undefined) return 'no-project';
    // The cap evicts the oldest of the OTHER sessions' suggestions, never the one just written (final review D2).
    const others = suggestionsOf(row.teamSuggestions).filter((e) => e.by !== s.by);
    while (others.length > TEAM_SUGGESTIONS_MAX - 1) {
      let oldest = 0;
      others.forEach((e, i) => { if (e.at < others[oldest]!.at) oldest = i; });
      others.splice(oldest, 1);
    }
    const next = [...others, s];
    const res = db.prepare('UPDATE project_linking SET teamSuggestions = ? WHERE project = ? AND teamKey IS NULL').run(JSON.stringify(next), project);
    return Number(res.changes) > 0 ? 'written' : 'team-set';
  });
}

/** The sweep's reading: a measurement writes the visibility, slug and template and clears any failure; a failure writes
 *  its reason and time and keeps the last visibility columns (the mode keeps ruling by them while the reading is failed);
 *  `unmeasured` clears the reading. The key and override are left as they are. */
export function recordReading(db: DatabaseSync, project: string, r: ProjectLinkingWire['measured']): void {
  if (r.state === 'measured') {
    db.prepare(
      'INSERT INTO project_linking (project, visibility, slug, template, failReason, measuredAt) VALUES (?, ?, ?, ?, NULL, ?) '
      + 'ON CONFLICT(project) DO UPDATE SET visibility = excluded.visibility, slug = excluded.slug, '
      + 'template = excluded.template, failReason = NULL, measuredAt = excluded.measuredAt',
    ).run(project, r.visibility, r.slug, r.template, r.at);
  } else if (r.state === 'failed') {
    db.prepare(
      'INSERT INTO project_linking (project, failReason, measuredAt) VALUES (?, ?, ?) '
      + 'ON CONFLICT(project) DO UPDATE SET failReason = excluded.failReason, measuredAt = excluded.measuredAt',
    ).run(project, r.reason, r.at);
  } else {
    db.prepare(
      'UPDATE project_linking SET visibility = NULL, slug = NULL, template = NULL, failReason = NULL, measuredAt = NULL '
      + 'WHERE project = ?',
    ).run(project);
  }
}

/** One project's facts. A project with no row reads unmeasured, with no key and no override. */
export function linkingOf(db: DatabaseSync, project: string): ProjectLinkingWire {
  const row = db.prepare(`SELECT ${COLUMNS} FROM project_linking WHERE project = ?`).get(project) as Row | undefined;
  return wireOf(row);
}

/** Every stored project's facts in one query. */
export function linkingAll(db: DatabaseSync): Map<string, ProjectLinkingWire> {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM project_linking`).all() as unknown as Row[];
  return new Map(rows.map((r) => [r.project, wireOf(r)]));
}
