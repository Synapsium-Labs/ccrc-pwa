// The Project linking card's pure readers (D-8405): which rows it draws and what the automatic team link says. L1: no
// store, no `lib/api.ts`, no component; `ProjectLinkingCard.tsx` renders what these answer.
import type { ProjectRow } from '../../../shared/api';
import type { LinearLegacyRow, LinearWorkspaceShown } from '../../../shared/linear';
import type { ProjectLinkingWire, TeamCandidateWire, TeamEvidence, TeamLinkWire } from '../../../shared/linking';
import { callPath, waitingPath } from '../lib/routes';
import { refusalText } from '../lib/refusalWords';
import { hierarchyWriteText } from './hierarchyWords';

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

/** D-8808, D-8809: an Overlord link is a call made for the operator; the card opens that call in "Calls made for you" (a call
 *  has an address on the Waiting on you screen, `callPath`) and says how to overturn it. `call` is the link for a team link with
 *  no readable call id (an older or odd peer), which can only open the screen. */
export const OVERLORD_LINK_WORDS = {
  openCall: 'Open this call in Calls made for you',
  call: 'See it in Calls made for you',
  overturn: 'Change the key to overturn it.',
} as const;

/** The card's link for an Overlord link (D-8808, D-8809): the call's own address, or the list when the wire carries no readable
 *  call id (absence permits); `null` for any other link. */
export function overlordCallLink(t: TeamLinkWire | null | undefined): { href: string; words: string } | null {
  if (t?.source !== 'overlord') return null;
  const id = t.callId as unknown;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
    ? { href: callPath(id), words: OVERLORD_LINK_WORDS.openCall }
    : { href: waitingPath(), words: OVERLORD_LINK_WORDS.call };
}

/** D-8808: the workspace picker's words. */
export const PICKER_WORDS = {
  label: 'Workspace',
  choose: 'Choose a workspace',
  needed: 'Choose a workspace to save this key.',
  unnamed: 'An unnamed workspace',
  unnamedIn: 'In an unnamed workspace',
  ambiguous: 'More than one connected Linear workspace has this key. Choose one in Workspace, then Save.',
  ambiguousUnlisted: 'More than one connected Linear workspace has this key, and this page could not list them. Reload the page, then choose the workspace.',
} as const;

/** D-8808 (review 2997 A3): the key write's own sentence for `unavailable`. The write reads the Linear keys to decide the key's
 *  workspace, and a store it cannot read refuses before anything is written (a 503 the card reads as a refusal, never unconfirmed).
 *  The hierarchy writes keep their own sentence for the same word (`hierarchyWriteText`). */
export const KEY_WRITE_WORDS = {
  unavailable: 'The Linear keys ccrc holds could not be read, so nothing was changed. Try again in a minute.',
} as const;

/** D-8808 (review 2971 F4): what a refused key write says. The server stores a key's workspace in the same write, so a key two
 *  connected workspaces hold, sent with none, is `team-ambiguous`: the sentence points at the picker when the card lists those
 *  workspaces (`holders`, more than one), and says the list could not be read when it does not. `unavailable` is
 *  `KEY_WRITE_WORDS`' sentence. Any other refusal is the write's own sentence (`hierarchyWriteText`). */
export const keyWriteText = (err: unknown, holders: number): string =>
  refusalText(err, {
    'team-ambiguous': holders > 1 ? PICKER_WORDS.ambiguous : PICKER_WORDS.ambiguousUnlisted,
    unavailable: KEY_WRITE_WORDS.unavailable,
  }) ?? hierarchyWriteText(err);

/** D-8808 (review 2971 A1): the workspaces the picker may offer: every file slot, and the legacy key's workspace while it routes
 *  like a slot (learned, with its id, not superseded, and no file slot of the same id), as the server's `routableSlots` reads
 *  them. An unread list (`null`) stays no list. */
export function pickerWorkspacesOf(
  workspaces: readonly LinearWorkspaceShown[] | null, legacy: LinearLegacyRow | null,
): readonly LinearWorkspaceShown[] | null {
  const w = legacy?.workspace ?? null;
  if (workspaces === null || legacy === null || legacy.superseded || w === null || w.workspaceId === undefined) return workspaces;
  const id = w.workspaceId;
  if (workspaces.some((s) => s.id === id)) return workspaces;
  return [...workspaces, { id, name: w.name, urlKey: w.urlKey, user: null, teams: w.teams, keyTail: null, checkedAt: null }];
}

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

/** A candidate row's React key: the key, its workspace, its evidence kind and its suggester, since one pair may be offered by the
 *  pass and by several suggesters (review 2971 A2); the store keeps one suggestion per suggester, so the four are unique. */
export const candidateKeyOf = (c: TeamCandidateWire): string =>
  `${c.key}|${c.workspaceId ?? ''}|${c.evidence.kind}|${c.evidence.kind === 'suggested' ? c.evidence.by : ''}`;
