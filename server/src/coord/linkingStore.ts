// The linking standard's SQL (D-8147): one `project_linking` row per project, holding the operator's team key and
// override (`setLinking`) and the last visibility reading (`recordReading`). It sits beside `store.ts` in the same ring and
// context (Coordination) in `reviewCapStore.ts`'s idiom: every function takes the store's `DatabaseSync` and is
// synchronous, and `CoordStore` keeps one-line delegates. The decision of which rule applies is `linking/policy.ts`'s
// `linkingMode` and nothing here.
import type { DatabaseSync } from 'node:sqlite';
import type {
  LinkingOverride, LinkingWriteBody, ProjectLinkingWire, RepoVisibility, TemplateState,
} from '../../../shared/linking.js';
import { linkingMode } from '../linking/policy.js';

interface Row {
  project: string; teamKey: string | null; override: LinkingOverride | null;
  visibility: RepoVisibility | null; slug: string | null; template: TemplateState | null;
  failReason: string | null; measuredAt: number | null;
}

const COLUMNS = 'project, teamKey, override, visibility, slug, template, failReason, measuredAt';

/** A project with no row: no key, no override, nothing measured. */
export const UNSET_LINKING: ProjectLinkingWire = Object.freeze({
  teamKey: null, override: null, measured: Object.freeze({ state: 'unmeasured' as const }), mode: 'unknown' as const,
});

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
  return { teamKey, override, measured, mode: linkingMode(override, ruled) };
}

/** The operator's write: the key and the override, who and when; the reading is left as it is. */
export function setLinking(db: DatabaseSync, project: string, w: LinkingWriteBody, by: string, at: number): void {
  db.prepare(
    'INSERT INTO project_linking (project, teamKey, override, setBy, setAt) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(project) DO UPDATE SET teamKey = excluded.teamKey, override = excluded.override, '
    + 'setBy = excluded.setBy, setAt = excluded.setAt',
  ).run(project, w.teamKey, w.override, by, at);
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
