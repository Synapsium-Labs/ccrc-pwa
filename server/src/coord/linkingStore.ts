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
import { teamSourceAfterWrite } from '../linking/teamLink.js';
import { tx } from './tx.js';

interface Row {
  project: string; teamKey: string | null; override: LinkingOverride | null;
  visibility: RepoVisibility | null; slug: string | null; template: TemplateState | null;
  failReason: string | null; measuredAt: number | null;
  initiatives: string; linearOwner: string | null; ownsTeam: number;
  setAt: number | null; teamSource: string | null; teamName: string | null; teamEvidence: string | null;
  teamAt: number | null; teamCandidates: string | null;
}

const COLUMNS = 'project, teamKey, override, visibility, slug, template, failReason, measuredAt, initiatives, linearOwner, ownsTeam, '
  + 'setAt, teamSource, teamName, teamEvidence, teamAt, teamCandidates';

/** A project with no row: no key, no override, nothing measured. */
export const UNSET_LINKING: ProjectLinkingWire = Object.freeze({
  teamKey: null, override: null, measured: Object.freeze({ state: 'unmeasured' as const }), mode: 'unknown' as const,
  initiatives: 'on' as const, linearOwner: null, ownsTeam: false, teamLink: null, teamCandidates: Object.freeze([]),
});

/** A stored JSON cell, or undefined when it does not parse. */
const jsonOf = (text: string | null): unknown => {
  if (text === null) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
};

/** The key's source as stored: one of the two words, or null (no one decided since migration 64, or a value out of
 *  the vocabulary). */
const sourceOf = (v: string | null): TeamLinkSource | null => (v === 'manual' || v === 'auto' ? v : null);

/** Who set the key (D-8405). No key: null, unless the operator cleared it (`manual`: the pass then never links it).
 *  `auto` with its team and evidence intact: the pass's link. Anything else with a key is the operator's: before
 *  migration 64 the operator was the key's only writer. */
function teamLinkOf(row: Row | undefined): TeamLinkWire | null {
  if (row === undefined) return null;
  if (row.teamKey === null) return row.teamSource === 'manual' ? { source: 'manual', at: row.teamAt } : null;
  const evidence = jsonOf(row.teamEvidence);
  if (row.teamSource === 'auto' && row.teamName !== null && row.teamAt !== null && isTeamEvidence(evidence)) {
    return { source: 'auto', teamName: row.teamName, evidence, at: row.teamAt };
  }
  return { source: 'manual', at: row.teamSource === 'manual' ? row.teamAt : row.setAt };
}

/** The stored candidates, each through its guard; a cell that does not parse reads as none. */
function candidatesOf(row: Row | undefined): TeamCandidateWire[] {
  const v = jsonOf(row?.teamCandidates ?? null);
  return Array.isArray(v) ? v.filter((c): c is TeamCandidateWire => isTeamCandidate(c, isLinearTeamKey)) : [];
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
    teamLink: teamLinkOf(row), teamCandidates: candidatesOf(row),
  };
}

/** The operator's write: the key and the override, who and when; the reading is left as it is. D-8405: a write that
 *  changes the key makes it the operator's (`teamSourceAfterWrite`), and the pass's team and evidence go with the old key;
 *  one that sends the stored key back keeps whoever set it. Read and written in one transaction. */
export function setLinking(db: DatabaseSync, project: string, w: LinkingWriteBody, by: string, at: number): void {
  tx(db, () => {
    const before = db.prepare('SELECT teamKey, teamSource FROM project_linking WHERE project = ?').get(project) as
      { teamKey: string | null; teamSource: string | null } | undefined;
    const prior = { teamKey: before?.teamKey ?? null, source: sourceOf(before?.teamSource ?? null) };
    const keyChanged = w.teamKey !== prior.teamKey;
    db.prepare(
      'INSERT INTO project_linking (project, teamKey, override, setBy, setAt, teamSource, teamAt) VALUES (?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(project) DO UPDATE SET teamKey = excluded.teamKey, override = excluded.override, '
      + 'setBy = excluded.setBy, setAt = excluded.setAt, teamSource = excluded.teamSource'
      + (keyChanged ? ', teamName = NULL, teamEvidence = NULL, teamAt = excluded.teamAt' : ''),
    ).run(project, w.teamKey, w.override, by, at, teamSourceAfterWrite(prior, w.teamKey), keyChanged ? at : null);
  });
}

/** D-8405: the automatic pass links `key` for a project, with its team's name and the evidence. Written only where no
 *  key is stored and the operator has not decided (`teamSource` is not `manual`), in the same statement, so an operator's
 *  write that lands first always wins. True when the row was written. */
export function linkTeamAuto(
  db: DatabaseSync, project: string, link: { key: string; name: string; evidence: TeamEvidence }, at: number,
): boolean {
  const res = db.prepare(
    'INSERT INTO project_linking (project, teamKey, teamSource, teamName, teamEvidence, teamAt, teamCandidates) '
    + "VALUES (?, ?, 'auto', ?, ?, ?, NULL) "
    + 'ON CONFLICT(project) DO UPDATE SET teamKey = excluded.teamKey, teamSource = excluded.teamSource, '
    + 'teamName = excluded.teamName, teamEvidence = excluded.teamEvidence, teamAt = excluded.teamAt, teamCandidates = NULL '
    + "WHERE project_linking.teamKey IS NULL AND project_linking.teamSource IS NOT 'manual'",
  ).run(project, link.key, link.name, JSON.stringify(link.evidence), at);
  return Number(res.changes) > 0;
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
