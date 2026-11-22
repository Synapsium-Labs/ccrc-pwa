// The Project linking card's pure readers (D-8405): which rows it draws and what the automatic team link says. L1: no
// store, no `lib/api.ts`, no component; `ProjectLinkingCard.tsx` renders what these answer.
import type { ProjectRow } from '../../../shared/api';
import type { LinearLegacyRow, LinearWorkspaceShown } from '../../../shared/linear';
import type { ProjectLinkingWire, TeamCandidateWire, TeamEvidence, TeamLinkWire } from '../../../shared/linking';
import type { HierarchyProjectRow } from '../../../shared/plan';
import { callPath, waitingPath } from '../lib/routes';
import { refusalText } from '../lib/refusalWords';
import {
  hierarchyWriteText, inboundShortWords, inboundUnowned, inboundUnownedWords, mapWaitingWords, ownerShortWords, owningUnchosen, owningUnchosenWords, stateWords,
} from './hierarchyWords';

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
 *  workspace, and a store it cannot read, or a workspace the answer depends on that it cannot read, refuses before anything is
 *  written (a 503 the card reads as a refusal, never unconfirmed). An unread workspace stays unread until its key is checked, so
 *  the sentence says to try later, not in a minute (review 3286 F4). The hierarchy writes keep their own sentence for the same
 *  word (`hierarchyWriteText`). */
export const KEY_WRITE_WORDS = {
  unavailable: 'The Linear keys, or a Linear workspace, could not be read, so nothing was changed. Try again later.',
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

// ── The compact list (D-8932) ─────────────────────────────────────────────────────────────────────
// Settings › Integrations › Project linking draws one line per linked project, opens a row that waits for the operator,
// and folds every project with no team and nothing to decide into one group. Everything below DECIDES that: which kind a
// row is, why it waits, and what its one line says. The card renders the answers and decides nothing.

/** The team's name for a row's stored key, or null when nothing says it. An automatic or an Overlord link carries the
 *  name. A key set by hand carries none, so it is looked up in the connected workspaces: the stored workspace's team when
 *  one is stored, else the name every workspace holding the key agrees on. Two workspaces that name the key differently,
 *  an unread list and a key no workspace holds all answer null: the row then shows the key alone, never a guess. */
export function linkedTeamName(l: ProjectLinkingWire, workspaces: readonly LinearWorkspaceShown[] | null): string | null {
  if (l.teamKey === null) return null;
  const t = l.teamLink;
  if (t !== undefined && t !== null && t.source !== 'manual') return t.teamName;
  if (workspaces === null) return null;
  const key = l.teamKey.toUpperCase();
  const stored = l.teamWorkspace ?? null;
  const names = new Set<string>();
  for (const w of workspaces) {
    if (stored !== null && w.id !== stored) continue;
    for (const team of w.teams) if (team.key.toUpperCase() === key) names.add(team.name);
  }
  return names.size === 1 ? [...names][0]! : null;
}

/** The compact row's words. */
export const LINKING_ROW_WORDS = {
  notLinked: 'Not linked',
  flag: 'Needs a decision',
  more: 'More settings',
  /** An unlinked row's "More settings": one short word on the line, so the field, Save and it share a phone's width; the
   *  control's full name says which project's. */
  moreShort: 'More',
  moreFor: (project: string): string => `More settings for ${project}`,
  auto: 'linked automatically',
  overlord: 'linked by the Overlord',
  manual: 'set by hand',
  public: 'public',
  noTemplate: 'no PR template',
  notRead: 'visibility not read',
  /** The unlinked list's one line above its rows: it names the field once, so the rows do not each repeat a label. */
  unlinkedHint: 'Team key: to link a project, type the key of its Linear team and save it.',
  /** The accessible name of an unlinked row's key field, which has no visible label of its own. */
  keyFor: (project: string): string => `Team key for ${project}`,
} as const;

/** The template button's rule: a private project (measured or overridden), a template reading of `absent`, and a key. */
export const templateOffered = (l: ProjectLinkingWire): boolean =>
  l.mode === 'private' && l.teamKey !== null && l.measured.state === 'measured' && l.measured.template === 'absent';

/** How the key came to be, in a few words; null with no key, or when an older server does not say. */
export function linkedHowWords(l: ProjectLinkingWire): string | null {
  const t = l.teamLink;
  if (l.teamKey === null || t === undefined || t === null) return null;
  switch (t.source) {
    case 'auto': return LINKING_ROW_WORDS.auto;
    case 'overlord': return LINKING_ROW_WORDS.overlord;
    case 'manual': return LINKING_ROW_WORDS.manual;
    default: { const never: never = t; return never; }
  }
}

/** Why a row waits for the operator. The order is the order a row says its reasons in. */
export type LinkingDecisionKind = 'suggested' | 'workspace' | 'owning' | 'map' | 'inbound';
/** The one control that settles a reason, which the row draws directly under it: the key cell (the field, Save, the
 *  workspace picker and the suggested teams), the Owning project box, the link to the waiting map, or the Linear owner. */
export type LinkingControl = 'key' | 'owning' | 'map' | 'owner';
export interface LinkingDecision { kind: LinkingDecisionKind; words: string; control: LinkingControl }

/** A stored key that more than one connected workspace holds, with no workspace stored for it: the key resolves nowhere
 *  until one is chosen. Never asked of an older server's row (no `teamWorkspace` field: it could not store the answer),
 *  nor over an unread workspace list. */
export function keyNeedsWorkspace(l: ProjectLinkingWire, workspaces: readonly LinearWorkspaceShown[] | null): boolean {
  if (l.teamKey === null || l.teamWorkspace === undefined) return false;
  const holders = workspacesHoldingKey(workspaces, l.teamKey);
  return holders.length > 1 && workspaceToWrite(holders, l.teamWorkspace ?? '') === undefined;
}

const suggestedWords = (cs: readonly TeamCandidateWire[]): string => (cs.length === 1
  ? `Team ${cs[0]!.key} (${cs[0]!.name}) is suggested for this project. Link it, or type another key.`
  : `${cs.length} teams are suggested for this project. Link one, or type another key.`);

/** The reasons one project's row waits for the operator, in plain words, each with the control that settles it; empty
 *  when nothing waits. `hierarchy` is the hierarchy answer's rows, or null while there is none (unread, failed, or an
 *  older server): its three reasons are then not said, never assumed. `workspaceOf` is every project's stored
 *  workspace (`owningUnchosen` reads it: one key in two workspaces is two teams). */
export function linkingDecisions(
  name: string, l: ProjectLinkingWire, workspaces: readonly LinearWorkspaceShown[] | null, hierarchy: readonly HierarchyProjectRow[] | null,
  workspaceOf: ReadonlyMap<string, string | null> = new Map(),
): LinkingDecision[] {
  const out: LinkingDecision[] = [];
  const candidates = candidatesShown(l);
  if (candidates.length > 0) out.push({ kind: 'suggested', control: 'key', words: suggestedWords(candidates) });
  if (keyNeedsWorkspace(l, workspaces)) {
    out.push({ kind: 'workspace', control: 'key', words: `Team key ${l.teamKey} exists in more than one Linear workspace. Choose its workspace, then Save.` });
  }
  if (hierarchy !== null) {
    const shared = owningUnchosen(name, hierarchy, workspaceOf);
    if (shared !== null) out.push({ kind: 'owning', control: 'owning', words: owningUnchosenWords(shared) });
    const h = hierarchy.find((p) => p.project === name);
    if (h !== undefined && h.state === 'map-waiting') out.push({ kind: 'map', control: 'map', words: mapWaitingWords(h.teamKey) });
    const unowned = h === undefined ? null : inboundUnowned(h);
    if (unowned !== null) out.push({ kind: 'inbound', control: 'owner', words: inboundUnownedWords(unowned) });
  }
  return out;
}

/** The controls a row draws above the rest of its form, each under the reason it settles: the ones it already drew
 *  (`kept`), then any a new reason names. A reason that goes leaves its control where it is, so the control the operator
 *  just used does not move from under their hand; the row forgets them when it is shut (`ProjectLinkingCard.tsx`). */
export function liftedControls(kept: readonly LinkingControl[], decisions: readonly LinkingDecision[]): LinkingControl[] {
  const out = [...kept];
  for (const d of decisions) if (!out.includes(d.control)) out.push(d.control);
  return out;
}

/** Where a row is drawn: `decision` (open, flagged, first), `linked` (one line), or `unlinked` (in the one group at the
 *  foot). */
export type LinkingRowKind = 'decision' | 'linked' | 'unlinked';
export const linkingRowKind = (l: ProjectLinkingWire, decisions: readonly LinkingDecision[]): LinkingRowKind =>
  (decisions.length > 0 ? 'decision' : l.teamKey !== null ? 'linked' : 'unlinked');

/** A listed row's one line: the team it is linked to (key and name) and how, who owns it, where its migration stands,
 *  and `notes`, the few words that say how it differs from a quiet row (inbound issues waiting, a public repository or
 *  one whose visibility is not read, a private one with no PR template). A row with no key yet (one that waits on a
 *  suggested team) says so, and nothing else. The owner, the state and the inbound count are a team's, so they are not
 *  said with no key, nor with no hierarchy answer. */
export interface LinkingSummary { team: string; owner: string | null; state: string | null; notes: string[] }
export function linkingSummary(
  name: string, l: ProjectLinkingWire, workspaces: readonly LinearWorkspaceShown[] | null, hierarchy: readonly HierarchyProjectRow[] | null,
): LinkingSummary {
  if (l.teamKey === null) return { team: LINKING_ROW_WORDS.notLinked, owner: null, state: null, notes: [] };
  const teamName = linkedTeamName(l, workspaces);
  const how = linkedHowWords(l);
  const team = `${teamName === null ? l.teamKey : `${l.teamKey} · ${teamName}`}${how === null ? '' : `, ${how}`}`;
  const h = hierarchy?.find((p) => p.project === name) ?? null;
  const notes = [
    h === null ? null : inboundShortWords(h.inboundWaiting),
    l.mode === 'public' ? LINKING_ROW_WORDS.public : l.mode === 'unknown' ? LINKING_ROW_WORDS.notRead : null,
    templateOffered(l) ? LINKING_ROW_WORDS.noTemplate : null,
  ].filter((w): w is string => w !== null);
  return { team, owner: h === null ? null : ownerShortWords(h), state: h === null ? null : stateWords(h), notes };
}

/** One row of the list, decided: where it is drawn, why it waits, and what its line says. `linking` is the list's own
 *  cell, passed through untouched. */
export interface LinkingListRow {
  name: string; linking: ProjectLinkingWire; kind: LinkingRowKind; decisions: LinkingDecision[]; summary: LinkingSummary;
}

/** How many rows there are of each kind. */
export interface LinkingCounts { decisions: number; linked: number; unlinked: number }

/** The whole list, decided once. `listed`: the rows that wait for the operator first, then the linked ones, each in the
 *  route's order. `unlinked`: the rest, which the card folds into one group. `held` is the projects whose row waited
 *  while this page was open: a linked row among them keeps its place with the rows that wait, so the row the operator
 *  just settled does not jump down the list from under its answer. */
export function linkingList(
  rows: readonly ProjectRow[], workspaces: readonly LinearWorkspaceShown[] | null, hierarchy: readonly HierarchyProjectRow[] | null,
  held: ReadonlySet<string> = new Set(),
): { listed: LinkingListRow[]; unlinked: LinkingListRow[]; counts: LinkingCounts } {
  const cells = linkingRowsOf(rows);
  const workspaceOf = new Map(cells.map(({ name, linking }) => [name, linking.teamWorkspace ?? null] as const));
  const all = cells.map(({ name, linking }): LinkingListRow => {
    const decisions = linkingDecisions(name, linking, workspaces, hierarchy, workspaceOf);
    return { name, linking, decisions, kind: linkingRowKind(linking, decisions), summary: linkingSummary(name, linking, workspaces, hierarchy) };
  });
  const first = (r: LinkingListRow): boolean => r.kind === 'decision' || (r.kind === 'linked' && held.has(r.name));
  const of = (kind: LinkingRowKind): LinkingListRow[] => all.filter((r) => r.kind === kind);
  return {
    listed: [...all.filter(first), ...all.filter((r) => r.kind === 'linked' && !first(r))],
    unlinked: of('unlinked'),
    counts: { decisions: of('decision').length, linked: of('linked').length, unlinked: of('unlinked').length },
  };
}

/** The card's head line: how many rows need the operator, how many are linked and how many are not, each said only when
 *  there are some; null for a card with no row. */
export function linkingCountsWords(c: LinkingCounts): string | null {
  const parts = [
    c.decisions === 0 ? null : c.decisions === 1 ? '1 needs a decision' : `${c.decisions} need a decision`,
    c.linked === 0 ? null : `${c.linked} linked`,
    c.unlinked === 0 ? null : `${c.unlinked} not linked`,
  ].filter((w): w is string => w !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The group every project with no team and nothing to decide folds into. */
export const unlinkedGroupWords = (n: number): string => (n === 1 ? '1 project not linked to Linear' : `${n} projects not linked to Linear`);

/** Whether that group starts open: only when it is the whole card (no project is linked and none waits), so a fleet that
 *  has linked nothing yet sees where a key is typed. */
export const unlinkedGroupOpenAtFirst = (listed: number): boolean => listed === 0;
