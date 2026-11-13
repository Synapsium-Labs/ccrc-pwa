// The Project linking card's pure readers (D-8405): which rows it draws and what the automatic team link says. L1: no
// store, no `lib/api.ts`, no component; `ProjectLinkingCard.tsx` renders what these answer.
import type { ProjectRow } from '../../../shared/api';
import type { ProjectLinkingWire, TeamCandidateWire, TeamEvidence } from '../../../shared/linking';

/**
 * One row per PROJECT. `GET /api/projects` answers one row per checkout directory (`listProjects` keys its rows by
 * workdir: the projects root's directory and every registry workdir that is not a linked worktree, such as a second
 * clone), so one project can arrive several times. Linking is a fact of the project, stored once by its name, so the card
 * shows it once: the first row that carries a cell, in the route's order. A row with no cell (an older server) is not
 * drawn.
 */
export function linkingRowsOf(rows: readonly ProjectRow[]): Array<{ name: string; linking: ProjectLinkingWire }> {
  const out = new Map<string, ProjectLinkingWire>();
  for (const r of rows) if (r.linking !== undefined && !out.has(r.name)) out.set(r.name, r.linking);
  return [...out].map(([name, linking]) => ({ name, linking }));
}

/** What the evidence was, as a clause: "9 of 10 ticket ids in its branches, pull requests and commits use AAA". */
export function evidenceWords(e: TeamEvidence, key: string): string {
  if (e.kind === 'ticket-ids') return `${e.ids} of ${e.of} ticket ids in its branches, pull requests and commits use ${key}`;
  return `the ${e.matched === 'project' ? 'project' : 'repository'} name matches the team ${e.on === 'name' ? 'name' : 'key'}`;
}

/** The line under the key field about who set it, or null when there is nothing to say (no key and nothing decided, a
 *  key the operator typed, or an older server). */
export function teamLinkLine(l: ProjectLinkingWire): string | null {
  const t = l.teamLink;
  if (t === undefined || t === null) return null;
  if (t.source === 'auto' && l.teamKey !== null) return `Linked automatically to ${t.teamName}: ${evidenceWords(t.evidence, l.teamKey)}.`;
  if (t.source === 'manual' && l.teamKey === null) return 'The key was cleared here, so it is not linked automatically.';
  return null;
}

/** The candidates the row offers: only while it has no key. */
export const candidatesShown = (l: ProjectLinkingWire): readonly TeamCandidateWire[] =>
  (l.teamKey === null ? (l.teamCandidates ?? []) : []);

/** A candidate's one-tap button: the key alone, short enough for one line at any width. */
export const candidateLabel = (c: TeamCandidateWire): string => `Link ${c.key}`;

/** The line under a candidate's button: the team's name, which may be long and wraps, and why it is offered. */
export const candidateWhy = (c: TeamCandidateWire): string => `${c.name}: ${evidenceWords(c.evidence, c.key)}`;
