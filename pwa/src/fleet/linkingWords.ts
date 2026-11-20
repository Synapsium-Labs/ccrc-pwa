// The Project linking card's pure readers (D-8405): which rows it draws and what the automatic team link says. L1: no
// store, no `lib/api.ts`, no component; `ProjectLinkingCard.tsx` renders what these answer.
import type { ProjectRow } from '../../../shared/api';
import type { LinearWorkspaceShown } from '../../../shared/linear';
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
  switch (e.kind) {
    case 'ticket-ids': return `${e.ids} of ${e.of} ticket ids in its branches, pull requests and commits use ${key}`;
    case 'name-match': return `the ${e.matched === 'project' ? 'project' : 'repository'} name matches the team ${e.on === 'name' ? 'name' : 'key'}`;
    case 'pr-attachments': return `${e.ids} of ${e.of} issues attached to this repository's merged pull requests are ${key} issues`;
    case 'suggested': return `suggested by ${e.by} — ${e.why}`;
    default: { const never: never = e; return never; }
  }
}

/** The line under the key field about who set it, or null when there is nothing to say (no key and nothing decided, a
 *  key the operator typed, or an older server). */
export function teamLinkLine(l: ProjectLinkingWire): string | null {
  const t = l.teamLink;
  if (t === undefined || t === null) return null;
  if (t.source === 'auto' && l.teamKey !== null) return `Linked automatically to ${t.teamName}: ${evidenceWords(t.evidence, l.teamKey)}.`;
  if (t.source === 'overlord' && l.teamKey !== null) {
    return `Linked by the Overlord for you to ${t.teamName}: ${evidenceWords(t.evidence, l.teamKey)}. ${OVERLORD_LINK_WORDS.overturn}`;
  }
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

/** D-8808: an Overlord link is a call made for the operator; the card links to "Calls made for you" (a call has no address of
 *  its own on the Waiting on you screen, so the link is to the screen) and says how to overturn it. */
export const OVERLORD_LINK_WORDS = {
  call: 'See it in Calls made for you',
  overturn: 'Change the key to overturn it.',
} as const;

/** D-8808: the workspace picker's words. */
export const PICKER_WORDS = {
  label: 'Workspace',
  choose: 'Choose a workspace',
  needed: 'Choose a workspace to save this key.',
  unnamed: 'An unnamed workspace',
  unnamedIn: 'In an unnamed workspace',
} as const;

/** The connected workspaces that hold a team key (compared uppercased), each by the name the picker shows. An unreadable
 *  read (`null`) is no list: the picker is left out, never guessed. */
export function workspacesHoldingKey(read: readonly LinearWorkspaceShown[] | null, key: string): Array<{ id: string; name: string }> {
  const k = key.trim().toUpperCase();
  if (read === null || k === '') return [];
  return read.filter((w) => w.teams.some((t) => t.key.toUpperCase() === k))
    .map((w) => ({ id: w.id, name: w.name ?? w.urlKey ?? PICKER_WORDS.unnamed }));
}

/** The `workspace` a save sends: the one workspace that holds the key; the chosen one while the key is held by several;
 *  nothing (the server answers as it does today) for none, or for no valid choice yet. */
export function workspaceToWrite(holders: ReadonlyArray<{ id: string }>, chosen: string): string | undefined {
  if (holders.length === 1) return holders[0]!.id;
  return holders.length > 1 && holders.some((h) => h.id === chosen) ? chosen : undefined;
}

/** D-8808 (final review I2): what a candidate's one-tap Link does. A candidate with a workspace writes its pair. One stored with no
 *  workspace writes the key in the one connected workspace that holds it (none known: the key alone, as before); when several hold
 *  it, nothing is written (a key with no workspace would resolve nowhere): the key goes into the field and the picker asks. */
export function candidateTap(c: TeamCandidateWire, read: readonly LinearWorkspaceShown[] | null): { kind: 'write'; workspace?: string } | { kind: 'pick' } {
  if (c.workspaceId !== undefined) return { kind: 'write', workspace: c.workspaceId };
  const holders = workspacesHoldingKey(read, c.key);
  if (holders.length > 1) return { kind: 'pick' };
  return holders.length === 1 ? { kind: 'write', workspace: holders[0]!.id } : { kind: 'write' };
}

/** A candidate's workspace, as a line; null for a candidate an older build stored. */
export function candidateWorkspaceLine(c: TeamCandidateWire): string | null {
  if (c.workspaceId === undefined) return null;
  return c.workspaceName === null || c.workspaceName === undefined ? PICKER_WORDS.unnamedIn : `In workspace ${c.workspaceName}`;
}

/** The button's accessible name: the label, and the workspace when the candidate has one, so two rows of one key differ. */
export const candidateAriaLabel = (c: TeamCandidateWire): string =>
  (c.workspaceId === undefined ? candidateLabel(c) : `${candidateLabel(c)} in workspace ${c.workspaceName ?? PICKER_WORDS.unnamed.toLowerCase()}`);

/** A candidate row's React key: the key and its workspace, since several rows may share a key. */
export const candidateKeyOf = (c: TeamCandidateWire): string => `${c.key}|${c.workspaceId ?? ''}`;
