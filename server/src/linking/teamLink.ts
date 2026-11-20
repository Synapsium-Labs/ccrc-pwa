// The automatic team link's decider (D-8405). L1: pure, no I/O; the lane (`visibilityLane.ts`) gathers the facts and
// acts, and `coord/linkingStore.ts` is the one writer of the linking row. Every rule of the automatic link is here:
// which evidence counts, the threshold that makes it decisive, when the operator's key wins, and what the row offers
// when nothing is decisive. Nothing team-, workspace- or machine-specific: the teams are whatever the box's Linear
// keys reach, read at run time.
//
// The evidence, strongest first:
// D-8808: a team is a (workspace, key) PAIR; a key two connected workspaces share is never merged into one team. A ticket id
// names a key and no workspace, so (a) decides a KEY and the pass links only when that key is held by exactly one pair.
//   (a) TICKET IDS (a private repository only; a public or unmeasured one never carries them): the distinct `KEY-123`
//       ids of each known team key in the project's branch names, pull request titles and commits. Decisive when one
//       key has at least `TEAM_LINK_MIN_IDS` of them and at least `TEAM_LINK_MIN_SHARE` of every id seen of any known key,
//       and one pair holds that key (two pairs: each is a candidate).
// D-8808 (Task 8.3): ATTACHED ISSUES, evidence that names its workspace and that a public repository carries too: the distinct
// issues Linear attaches to this repository's merged pull requests, counted per (workspace, key) pair (`attachedIssues.ts`
// reads them; null when that read is off or unmeasured, and then the decision is exactly what it was without it). Decisive at
// the same bar as (a) (`TEAM_LINK_MIN_IDS` issues and `TEAM_LINK_MIN_SHARE` of every attached issue). Weighed beside (a):
// ticket ids decisive for a DIFFERENT key leave no link; ticket ids decisive for a key two workspaces hold take the one pair
// that attachments name; and attachments short of the bar offer their pairs as candidates, after the ticket ids.
//   (b) NAME MATCH: the project's name, or its repository's name, equals a team's name or key, ignoring case. Decisive
//       when exactly one PAIR matches and (a) saw no id of any OTHER key.
//   (c) nothing: no link, and no candidate.
// Anything short of decisive offers the best candidates on the row, for the operator's one tap; it never links.
import type { LinkingMode, TeamCandidateWire, TeamEvidence, TeamLinkSource } from '../../../shared/linking.js';
import { LINEAR_TEAM_KEY_SHAPE } from '../../../shared/linear.js';

/** (a)'s floor: a team's key needs at least this many distinct ticket ids. */
export const TEAM_LINK_MIN_IDS = 3;
/** (a)'s share: and at least this share of every distinct id seen of a known team key. */
export const TEAM_LINK_MIN_SHARE = 0.8;
/** The most candidates a row offers. */
export const TEAM_CANDIDATES_MAX = 3;

/** A team the box's Linear keys reach: a (workspace, key) pair. `workspaceName` is null when it is not known. */
export interface KnownTeam { key: string; name: string; workspaceId: string; workspaceName: string | null }

/** D-8808: one pair's distinct attached issues (`key` uppercased). */
export interface AttachedPair { workspaceId: string; key: string; ids: number }
/** D-8808: the distinct issues attached to the repository's merged pull requests: `total` of every team, `pairs` per
 *  (workspace, key). The decider's input; `attachedIssues.ts` builds it. */
export interface AttachedTally { total: number; pairs: readonly AttachedPair[] }

/** What the decider reads for one project. `tally` is `ticketTally` of its texts; `repo` the repository's name (the
 *  slug's last part), or null when not measured. */
export interface TeamLinkFacts {
  project: string;
  repo: string | null;
  mode: LinkingMode;
  teams: readonly KnownTeam[];
  tally: ReadonlyMap<string, number>;
  /** D-8808: the attached issues, or null when the read is off or unmeasured (the decision is then exactly as before). */
  attached: AttachedTally | null;
}

export type TeamLinkDecision =
  | { kind: 'link'; key: string; name: string; workspaceId: string; workspaceName: string | null; evidence: TeamEvidence }
  | { kind: 'candidates'; candidates: TeamCandidateWire[] };

/** A ticket id's shape: a team key, a dash and a number, as a whole token in either case. */
const TICKET_RE = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]{0,15})-(\d{1,9})(?![A-Za-z0-9_])/g;

/** Every distinct ticket id in `texts`, counted per key (uppercased): `ws/aaa-12-x`, `AAA-12: fix` and `aaa-12` are one
 *  id of `AAA`. A key in no team's shape is not counted. */
export function ticketTally(texts: readonly string[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const text of texts) {
    for (const m of text.matchAll(TICKET_RE)) {
      const key = m[1]!.toUpperCase();
      if (!LINEAR_TEAM_KEY_SHAPE.test(key)) continue;
      const ids = seen.get(key) ?? new Set<string>();
      ids.add(String(Number(m[2])));
      seen.set(key, ids);
    }
  }
  return new Map([...seen].map(([k, ids]) => [k, ids.size]));
}

/** `owner/repo` → `repo`; anything without a slash is itself. */
export const repoNameOf = (slug: string): string => slug.slice(slug.lastIndexOf('/') + 1);

/** One pair's identity: its uppercased key and its workspace. */
const pairId = (t: KnownTeam): string => `${t.key.toUpperCase()}\u0000${t.workspaceId}`;

/** The pairs once each (same uppercased key and same workspace), first kept. Two workspaces' teams are never merged. */
function distinctPairs(teams: readonly KnownTeam[]): KnownTeam[] {
  const out = new Map<string, KnownTeam>();
  for (const t of teams) {
    const id = pairId(t);
    if (!out.has(id)) out.set(id, { ...t, key: t.key.toUpperCase() });
  }
  return [...out.values()];
}

const candidateOf = (t: KnownTeam, evidence: TeamEvidence): TeamCandidateWire =>
  ({ key: t.key, name: t.name, evidence, workspaceId: t.workspaceId, workspaceName: t.workspaceName });

/**
 * The pair a decisive key means: the one that holds it, or null when several do. THE SEAM for evidence that names a
 * workspace (D-8808, `attachedPairs` above): `named` is the workspace such evidence names, and with it a key held in two
 * workspaces picks the pair in that one.
 */
function pairForKey(holders: readonly KnownTeam[], named: string | null = null): KnownTeam | null {
  if (named !== null) {
    const own = holders.filter((t) => t.workspaceId === named);
    return own.length === 1 ? own[0]! : null;
  }
  return holders.length === 1 ? holders[0]! : null;
}

/** (b): each pair whose name or key equals the project's or the repository's name, with what matched what. */
function nameMatches(f: TeamLinkFacts, teams: readonly KnownTeam[]): Map<string, { team: KnownTeam; evidence: TeamEvidence }> {
  const out = new Map<string, { team: KnownTeam; evidence: TeamEvidence }>();
  const names: Array<['project' | 'repo', string]> = [['project', f.project]];
  if (f.repo !== null && f.repo !== '') names.push(['repo', f.repo]);
  for (const [matched, n] of names) {
    const lower = n.toLowerCase();
    for (const t of teams) {
      const id = pairId(t);
      if (out.has(id)) continue;
      if (t.name.toLowerCase() === lower) out.set(id, { team: t, evidence: { kind: 'name-match', matched, on: 'name' } });
      else if (t.key.toLowerCase() === lower) out.set(id, { team: t, evidence: { kind: 'name-match', matched, on: 'key' } });
    }
  }
  return out;
}

/** D-8808: the attached pairs a known team holds, with at least one attached issue, most first. A pair no known team holds is ignored. */
function attachedPairs(f: TeamLinkFacts, teams: readonly KnownTeam[]): Array<{ team: KnownTeam; ids: number }> {
  if (f.attached === null) return [];
  const out: Array<{ team: KnownTeam; ids: number }> = [];
  for (const p of f.attached.pairs) {
    const team = teams.find((t) => t.key === p.key.toUpperCase() && t.workspaceId === p.workspaceId);
    if (team !== undefined && p.ids > 0) out.push({ team, ids: p.ids });
  }
  return out.sort((x, y) => y.ids - x.ids);
}

/** The decision for a project with no key: link when one pair's evidence is decisive, else the candidates. */
export function decideTeamLink(f: TeamLinkFacts): TeamLinkDecision {
  const teams = distinctPairs(f.teams);
  // (a) only where ticket ids may be: a private repository. `unknown` reads as public, as `linkingMode` does everywhere.
  // Counted per KEY: a ticket id names no workspace.
  const keys = [...new Set(teams.map((t) => t.key))];
  const counted = f.mode === 'private'
    ? keys.map((key) => ({ key, ids: f.tally.get(key) ?? 0 })).filter((c) => c.ids > 0).sort((x, y) => y.ids - x.ids)
    : [];
  const total = counted.reduce((n, c) => n + c.ids, 0);
  const best = counted[0];
  const idsKey = best !== undefined && best.ids >= TEAM_LINK_MIN_IDS && best.ids >= TEAM_LINK_MIN_SHARE * total ? best : null;
  const attached = attachedPairs(f, teams);
  const attachedTotal = f.attached?.total ?? 0;
  const top = attached[0];
  const attachedBest = top !== undefined && top.ids >= TEAM_LINK_MIN_IDS && top.ids >= TEAM_LINK_MIN_SHARE * attachedTotal ? top : null;
  const linkOf = (t: KnownTeam, evidence: TeamEvidence): TeamLinkDecision =>
    ({ kind: 'link', key: t.key, name: t.name, workspaceId: t.workspaceId, workspaceName: t.workspaceName, evidence });
  // Ticket ids and attachments each decisive, for different keys: they disagree, so nothing links (both are offered).
  const against = idsKey !== null && attachedBest !== null && attachedBest.team.key !== idsKey.key;
  if (idsKey !== null && !against) {
    const holders = teams.filter((t) => t.key === idsKey.key);
    const evidence: TeamEvidence = { kind: 'ticket-ids', ids: idsKey.ids, of: total };
    let pair = pairForKey(holders);
    if (pair === null) {
      // The key is shared: the attachments name the workspace when exactly one of its pairs has an attached issue.
      const named = attached.filter((a) => a.team.key === idsKey.key);
      if (named.length === 1) pair = pairForKey(holders, named[0]!.team.workspaceId);
    }
    if (pair !== null) return linkOf(pair, evidence);
  }
  if (attachedBest !== null && !against) {
    return linkOf(attachedBest.team, { kind: 'pr-attachments', ids: attachedBest.ids, of: attachedTotal });
  }
  const named = nameMatches(f, teams);
  if (!against && named.size === 1) {
    const { team, evidence } = [...named.values()][0]!;
    // Decisive only when no id names another key: ids of a different key are evidence against the name.
    if (counted.every((c) => c.key === team.key)) return linkOf(team, evidence);
  }
  const candidates: TeamCandidateWire[] = [];
  const offer = (c: TeamCandidateWire): void => {
    if (!candidates.some((x) => x.key === c.key && x.workspaceId === c.workspaceId)) candidates.push(c);
  };
  for (const c of counted) {
    for (const t of teams.filter((x) => x.key === c.key)) offer(candidateOf(t, { kind: 'ticket-ids', ids: c.ids, of: total }));
  }
  for (const a of attached) offer(candidateOf(a.team, { kind: 'pr-attachments', ids: a.ids, of: attachedTotal }));
  for (const { team, evidence } of named.values()) offer(candidateOf(team, evidence));
  return { kind: 'candidates', candidates: candidates.slice(0, TEAM_CANDIDATES_MAX) };
}

/** Whether the automatic pass may link a project: only one with no key that the operator has not decided. A key the
 *  operator typed, chose or cleared is theirs, and the pass never writes over it (it still offers candidates). */
export const autoLinkAllowed = (teamKey: string | null, source: TeamLinkSource | null): boolean =>
  teamKey === null && source !== 'manual';

/** Who set the key after the operator's write: a write that changes the key (sets, replaces or clears it) is the
 *  operator's; one that sends the stored key back (an override change re-sends it) keeps whoever set it. */
export const teamSourceAfterWrite = (
  before: { teamKey: string | null; source: TeamLinkSource | null }, written: string | null,
): TeamLinkSource | null => (written === before.teamKey ? before.source : 'manual');

/** What the pass does for one project: link `link` (when the store takes it), else record `candidates`. */
export interface TeamLinkPlan {
  link: { key: string; name: string; workspaceId: string; workspaceName: string | null; evidence: TeamEvidence } | null;
  candidates: TeamCandidateWire[];
}

/**
 * The pass's step for one project, from its stored key and source and the facts. A project with a key keeps no
 * candidates. With none: the decisive team is linked when `autoLinkAllowed`, and is still the one candidate if the store
 * refuses the write (the operator's write landed first) or the operator has decided; otherwise the decider's candidates.
 */
export function planTeamLink(stored: { teamKey: string | null; source: TeamLinkSource | null }, f: TeamLinkFacts): TeamLinkPlan {
  if (stored.teamKey !== null) return { link: null, candidates: [] };
  const d = decideTeamLink(f);
  if (d.kind === 'candidates') return { link: null, candidates: d.candidates };
  const link = { key: d.key, name: d.name, workspaceId: d.workspaceId, workspaceName: d.workspaceName, evidence: d.evidence };
  return { link: autoLinkAllowed(stored.teamKey, stored.source) ? link : null, candidates: [link] };
}
