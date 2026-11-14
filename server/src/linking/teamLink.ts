// The automatic team link's decider (D-8405). L1: pure, no I/O; the lane (`visibilityLane.ts`) gathers the facts and
// acts, and `coord/linkingStore.ts` is the one writer of the linking row. Every rule of the automatic link is here:
// which evidence counts, the threshold that makes it decisive, when the operator's key wins, and what the row offers
// when nothing is decisive. Nothing team-, workspace- or machine-specific: the teams are whatever the box's Linear
// keys reach, read at run time.
//
// The evidence, strongest first:
//   (a) TICKET IDS (a private repository only; a public or unmeasured one never carries them): the distinct `KEY-123`
//       ids of each known team key in the project's branch names, pull request titles and commits. Decisive when one
//       key has at least `TEAM_LINK_MIN_IDS` of them and at least `TEAM_LINK_MIN_SHARE` of every id seen of any known key.
//   (b) NAME MATCH: the project's name, or its repository's name, equals a team's name or key, ignoring case. Decisive
//       when exactly one team matches and (a) saw no id of any OTHER team.
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

/** A team the box's Linear keys reach. */
export interface KnownTeam { key: string; name: string }

/** What the decider reads for one project. `tally` is `ticketTally` of its texts; `repo` the repository's name (the
 *  slug's last part), or null when not measured. */
export interface TeamLinkFacts {
  project: string;
  repo: string | null;
  mode: LinkingMode;
  teams: readonly KnownTeam[];
  tally: ReadonlyMap<string, number>;
}

export type TeamLinkDecision =
  | { kind: 'link'; key: string; name: string; evidence: TeamEvidence }
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

/** The teams once each, by uppercased key, first kept (a key two workspaces share is one key to link). */
function distinctTeams(teams: readonly KnownTeam[]): KnownTeam[] {
  const out = new Map<string, KnownTeam>();
  for (const t of teams) {
    const key = t.key.toUpperCase();
    if (!out.has(key)) out.set(key, { key, name: t.name });
  }
  return [...out.values()];
}

/** (b): each team whose name or key equals the project's or the repository's name, with what matched what. */
function nameMatches(f: TeamLinkFacts, teams: readonly KnownTeam[]): Map<string, TeamEvidence> {
  const out = new Map<string, TeamEvidence>();
  const names: Array<['project' | 'repo', string]> = [['project', f.project]];
  if (f.repo !== null && f.repo !== '') names.push(['repo', f.repo]);
  for (const [matched, n] of names) {
    const lower = n.toLowerCase();
    for (const t of teams) {
      if (out.has(t.key)) continue;
      if (t.name.toLowerCase() === lower) out.set(t.key, { kind: 'name-match', matched, on: 'name' });
      else if (t.key.toLowerCase() === lower) out.set(t.key, { kind: 'name-match', matched, on: 'key' });
    }
  }
  return out;
}

/** The decision for a project with no key: link when one team's evidence is decisive, else the candidates. */
export function decideTeamLink(f: TeamLinkFacts): TeamLinkDecision {
  const teams = distinctTeams(f.teams);
  const byKey = new Map(teams.map((t) => [t.key, t]));
  // (a) only where ticket ids may be: a private repository. `unknown` reads as public, as `linkingMode` does everywhere.
  const counted = f.mode === 'private'
    ? teams.map((t) => ({ team: t, ids: f.tally.get(t.key) ?? 0 })).filter((c) => c.ids > 0).sort((x, y) => y.ids - x.ids)
    : [];
  const total = counted.reduce((n, c) => n + c.ids, 0);
  const best = counted[0];
  if (best !== undefined && best.ids >= TEAM_LINK_MIN_IDS && best.ids >= TEAM_LINK_MIN_SHARE * total) {
    return { kind: 'link', key: best.team.key, name: best.team.name, evidence: { kind: 'ticket-ids', ids: best.ids, of: total } };
  }
  const named = nameMatches(f, teams);
  if (named.size === 1) {
    const [key, evidence] = [...named][0]!;
    // Decisive only when no id names another team: ids of a different team are evidence against the name.
    if (counted.every((c) => c.team.key === key)) {
      const t = byKey.get(key)!;
      return { kind: 'link', key: t.key, name: t.name, evidence };
    }
  }
  const candidates: TeamCandidateWire[] = counted.map((c) => ({
    key: c.team.key, name: c.team.name, evidence: { kind: 'ticket-ids', ids: c.ids, of: total },
  }));
  for (const [key, evidence] of named) {
    if (!candidates.some((c) => c.key === key)) candidates.push({ key, name: byKey.get(key)!.name, evidence });
  }
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
  link: { key: string; name: string; evidence: TeamEvidence } | null;
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
  const link = { key: d.key, name: d.name, evidence: d.evidence };
  return { link: autoLinkAllowed(stored.teamKey, stored.source) ? link : null, candidates: [link] };
}
