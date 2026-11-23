// The linking standard's deciders (D-8147). L1: pure; every rule about the convention is decided here and nowhere
// else. A private repository carries the ticket id; a public or unmeasured one never does.
import { LINEAR_TEAM_KEY_SHAPE, isLinearUuid } from '../../../shared/linear.js';
import { WS_SLUG_MAX, fitSlug, slugifyWords } from '../../../shared/slug.js';
import type {
  LinkingMode, LinkingOverride, LinkingWriteBody, ProjectLinkingWire, TeamCandidateWire, TeamConfirmBody, TeamSuggestionBody,
} from '../../../shared/linking.js';
import { TEAM_SUGGESTION_WHY_MAX, teamEvidenceClause } from '../../../shared/linking.js';
import { CALL_OPTIONS_MAX, CALL_OPTION_MAX, CALL_TEXT_MAX, CALL_WHY_MAX } from '../coord/coordCalls.js';
import { measuredProjectTeam, type LinearRoute, type TeamRoutes } from '../linear/route.js';
import { claimsOpenRunOf } from '../roleOf.js';
import { isWsProject } from '../../../shared/slug.js';
import { publicTextClassesFor } from './publicTextClasses.js';

/** A visibility reading is kept this long before the sweep takes another. */
export const VISIBILITY_MAX_AGE_MS = 24 * 3_600_000;

/** Which rule applies: a measured PUBLIC repository is public whatever the override says (a mis-chosen `private` never
 *  turns the id-writing acts on for a public repository); otherwise the override wins; a measured private/internal
 *  repository is private; nothing measured is unknown. */
export function linkingMode(override: LinkingOverride | null, measured: ProjectLinkingWire['measured']): LinkingMode {
  if (measured.state === 'measured' && measured.visibility === 'public') return 'public';
  if (override !== null) return override;
  if (measured.state !== 'measured') return 'unknown';
  return measured.visibility === 'public' ? 'public' : 'private';
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validKey = (k: string | null): k is string => k !== null && LINEAR_TEAM_KEY_SHAPE.test(k.toUpperCase());

/** `ws/key-123-x` → `KEY-123`: the team's ticket at the slug's start, in either case; null otherwise. */
export function ticketRefOfBranch(branch: string, teamKey: string | null): string | null {
  if (!validKey(teamKey)) return null;
  const m = new RegExp(`^(?:ws/)?${escapeRe(teamKey)}-(\\d+)(?:-|$)`, 'i').exec(branch);
  return m ? `${teamKey.toUpperCase()}-${m[1]}` : null;
}

/** The team's tracker ids in `text`, case-insensitive and as whole tokens, uppercased, first-seen order, no repeats. */
export function trackerIdsIn(text: string, teamKey: string | null): string[] {
  if (!validKey(teamKey)) return [];
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(teamKey)}-(\\d+)(?![A-Za-z0-9_])`, 'gi');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const id = `${teamKey.toUpperCase()}-${m[1]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** `text` with the team's tracker ids taken out, line by line, and the punctuation they leave behind tidied
 *  (`fix (KEY-123) login` → `fix login`, `KEY-123: fix` → `fix`). No team key: the text unchanged. */
export function withoutTrackerIds(text: string, teamKey: string | null): string {
  if (trackerIdsIn(text, teamKey).length === 0) return text;
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(teamKey as string)}-\\d+(?![A-Za-z0-9_])`, 'gi');
  return text.split('\n').map((line) => {
    const bare = line.replace(re, '');
    if (bare === line) return line;
    return bare.replace(/\(\s*\)|\[\s*\]/g, '').replace(/(^|\s)[:;,]\s+/g, '$1')
      .replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/\s+([,.:;])/g, '$1').replace(/[ \t]+$/, '');
  }).join('\n');
}

/** The operator's write body: `teamKey` and `override`, and optionally `workspace` (D-8808: a slot id, `isLinearUuid`, or
 *  null); a key in the Linear shape (uppercased) or null. */
export function parseLinkingWrite(body: unknown):
  { ok: true; write: LinkingWriteBody } | { ok: false; error: 'bad-team-key' | 'bad-override' | 'bad-request' } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad-request' };
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o);
  const hasWorkspace = 'workspace' in o;
  if (keys.length !== (hasWorkspace ? 3 : 2) || !('teamKey' in o) || !('override' in o)) return { ok: false, error: 'bad-request' };
  if (hasWorkspace && o.workspace !== null && !isLinearUuid(o.workspace)) return { ok: false, error: 'bad-request' };
  let teamKey: string | null = null;
  if (o.teamKey !== null) {
    if (typeof o.teamKey !== 'string' || !LINEAR_TEAM_KEY_SHAPE.test(o.teamKey.toUpperCase())) return { ok: false, error: 'bad-team-key' };
    teamKey = o.teamKey.toUpperCase();
  }
  if (o.override !== null && o.override !== 'private' && o.override !== 'public') return { ok: false, error: 'bad-override' };
  return { ok: true, write: hasWorkspace ? { teamKey, override: o.override, workspace: o.workspace as string | null } : { teamKey, override: o.override } };
}

/** The identity pair's grammar: the client's SAFE_RE, bounded as the Linear proxy bounds it. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SUGGEST_KEYS: readonly string[] = ['byId', 'byUuid', 'project', 'team', 'workspace', 'why'];

/** D-8808: a session's suggestion body, closed: `byId`, `byUuid`, `project` (a registry project name, `isWsProject`), `team` (the
 *  Linear key shape, uppercased), optionally `workspace` (a slot id, `isLinearUuid`) and `why` (1 to `TEAM_SUGGESTION_WHY_MAX`
 *  characters, one line, no control character). A refusal names the field (`body` for the shape as a whole). */
export function parseTeamSuggestion(body: unknown): { ok: true; value: TeamSuggestionBody } | { ok: false; field: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, field: 'body' };
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !SUGGEST_KEYS.includes(k))) return { ok: false, field: 'body' };
  const byId = o['byId'];
  if (typeof byId !== 'string' || !IDENTITY_RE.test(byId)) return { ok: false, field: 'byId' };
  const byUuid = o['byUuid'];
  if (typeof byUuid !== 'string' || !IDENTITY_RE.test(byUuid)) return { ok: false, field: 'byUuid' };
  const project = o['project'];
  if (typeof project !== 'string' || !isWsProject(project)) return { ok: false, field: 'project' };
  const team = o['team'];
  if (typeof team !== 'string' || !LINEAR_TEAM_KEY_SHAPE.test(team.toUpperCase())) return { ok: false, field: 'team' };
  if ('workspace' in o && !isLinearUuid(o['workspace'])) return { ok: false, field: 'workspace' };
  const why = o['why'];
  // eslint-disable-next-line no-control-regex
  if (typeof why !== 'string' || why.length < 1 || why.length > TEAM_SUGGESTION_WHY_MAX || /[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(why)) return { ok: false, field: 'why' };
  const value: TeamSuggestionBody = { byId, byUuid, project, team: team.toUpperCase(), why };
  if ('workspace' in o) value.workspace = o['workspace'] as string;
  return { ok: true, value };
}

const CONFIRM_KEYS: readonly string[] = ['byId', 'byUuid', 'project', 'team', 'workspace'];

/** D-8809: the Overlord's confirm body, closed: `byId`, `byUuid`, `project` (`isWsProject`), `team` (the Linear key shape,
 *  uppercased) and `workspace` (a slot id, `isLinearUuid`, or null for a candidate stored without one; required). A refusal names
 *  the field (`body` for the shape as a whole), as `parseTeamSuggestion`'s does. */
export function parseTeamConfirm(body: unknown): { ok: true; value: TeamConfirmBody } | { ok: false; field: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, field: 'body' };
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !CONFIRM_KEYS.includes(k))) return { ok: false, field: 'body' };
  const { byId, byUuid, project, team, workspace } = o;
  if (typeof byId !== 'string' || !IDENTITY_RE.test(byId)) return { ok: false, field: 'byId' };
  if (typeof byUuid !== 'string' || !IDENTITY_RE.test(byUuid)) return { ok: false, field: 'byUuid' };
  if (typeof project !== 'string' || !isWsProject(project)) return { ok: false, field: 'project' };
  if (typeof team !== 'string' || !LINEAR_TEAM_KEY_SHAPE.test(team.toUpperCase())) return { ok: false, field: 'team' };
  if (workspace !== null && !isLinearUuid(workspace)) return { ok: false, field: 'workspace' };
  return { ok: true, value: { byId, byUuid, project, team: team.toUpperCase(), workspace: workspace as string | null } };
}

/** D-8809: the current candidate a confirm names, matched by key and workspace (a candidate stored without a workspace is named
 *  by null, and only by null), or null when the pair is none of them. */
export function confirmedCandidate(candidates: readonly TeamCandidateWire[], team: string, workspace: string | null): TeamCandidateWire | null {
  return candidates.find((c) => c.key === team && (c.workspaceId ?? null) === workspace) ?? null;
}

/** D-8808 (final review I2, I3), D-8809: what a (key, workspace) pair's MEASURED route through the live Linear store
 *  (`measuredProjectTeam`) means for a suggestion or a confirm: the workspace of the one slot that holds it; `unavailable` when a
 *  slot the answer depends on could not be read (never `team-unknown`: the pair may well be held there); `team-ambiguous` for a key
 *  two connected workspaces hold with no workspace named (storing it with none would resolve nowhere); `not-configured` when no
 *  Linear workspace is connected at all; every other refusal `team-unknown` (every workspace the pair depends on was read, and none
 *  holds it: for a named workspace, that workspace alone). A refusal carries its fixed `detail`, decided here. */
export function teamPairVerdict(route: LinearRoute | { kind: 'unmeasured' }):
  { ok: true; workspaceId: string } | { ok: false; error: 'team-unknown' | 'team-ambiguous' | 'unavailable' | 'not-configured'; detail: string } {
  if (route.kind === 'slot') return { ok: true, workspaceId: route.slot.workspaceId };
  if (route.kind === 'unmeasured') return { ok: false, error: 'unavailable', detail: 'a Linear workspace the pair depends on could not be read' };
  if (route.word === 'team-ambiguous') return { ok: false, error: 'team-ambiguous', detail: 'more than one connected Linear workspace holds the key' };
  if (route.word === 'not-configured') return { ok: false, error: 'not-configured', detail: 'no Linear workspace is connected' };
  return { ok: false, error: 'team-unknown', detail: 'the pair is not held in the connected Linear workspaces now' };
}

/** One line of at most `max` characters: whitespace runs folded, a longer text cut with an ellipsis. */
const oneLine = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};
/** A candidate as the call names it: the team's NAME and its workspace's display NAME, never a key. */
const teamPhrase = (c: TeamCandidateWire): string => oneLine(c.workspaceId === undefined ? c.name
  : `${c.name} in ${c.workspaceName ?? 'a workspace whose name is unknown'}`, CALL_OPTION_MAX);

/** D-8809: the call body of the Overlord's link, in the call record's own shape (`callBodyOf` reads it as the call route reads a
 *  coordinator's): a big, reversible call naming the project, the team and workspace by name, and the candidate's evidence
 *  (`teamEvidenceClause`), never a team key. The options are the project's current candidates (each once, the chosen one first)
 *  and leaving it unlinked. */
export function overlordLinkCallBody(project: string, chosen: TeamCandidateWire, candidates: readonly TeamCandidateWire[]): Record<string, unknown> {
  const pick = teamPhrase(chosen);
  const others = [...new Set(candidates.map(teamPhrase))].filter((p) => p !== pick).slice(0, CALL_OPTIONS_MAX - 2);
  return {
    class: 'big', reversible: true,
    question: oneLine(`Which Linear team does ${project} link to?`, CALL_TEXT_MAX),
    options: [pick, ...others, oneLine(`Leave ${project} unlinked`, CALL_OPTION_MAX)], chosen: pick,
    why: oneLine(`The Overlord linked it on its evidence: ${teamEvidenceClause(chosen.evidence)}.`, CALL_WHY_MAX),
  };
}

/** D-8808: what the Linear store answers for a team key in a workspace (null: in no named one), through the one resolver
 *  (`routeProjectTeam`), or `unmeasured` when the store could not be read. */
export type PairRoute = (teamKey: string, workspace: string | null) => LinearRoute | 'unmeasured';

/** D-8808, D-8809: the measured route over one store reading (`measuredTeamRoutes`; null when the store could not be listed):
 *  `unmeasured` when a slot the answer depends on cannot be read (`measuredProjectTeam`'s rule), else the route. */
export function measuredPairRoute(routes: TeamRoutes | null): PairRoute {
  return (teamKey, workspace) => {
    const r = measuredProjectTeam(routes, { teamKey, workspaceId: workspace });
    return r.kind === 'unmeasured' ? 'unmeasured' : r;
  };
}

/** D-8808 (review 2971 F5): whether the operator's write must read the Linear store to decide its workspace. Never for a cleared
 *  key, nor for the unchanged key with the workspace omitted (it keeps the stored choice, a stored none included); every other
 *  write with a key does, an explicit `workspace: null` with the unchanged key included. */
export function writeReadsStore(before: { teamKey: string | null }, written: { teamKey: string | null; workspace?: string | null }): boolean {
  return written.teamKey !== null && !(written.workspace === undefined && written.teamKey === before.teamKey);
}

/** D-8808: the workspace a write stores beside the key (spec §3.1.1, review 2971 F4), the ONE writer of which workspace a row
 *  stores. It asks the LIVE Linear store (`route`, asked only when `writeReadsStore`) through the MEASURED route
 *  (`measuredPairRoute`), so a slot the answer depends on that cannot be read is `unavailable` and nothing is written, never
 *  stored as none. The cases, as the coordinator plan reference's `## linking suggest` states them:
 *  - a workspace named: it must hold the key, else `team-unknown` (as with no workspace connected); a named slot that cannot be
 *    read is `unavailable`;
 *  - the workspace omitted with the unchanged key: the stored choice, a stored none included, with no read;
 *  - the workspace omitted with a changed key: a stored workspace while it holds the new key (`unavailable` while it cannot be
 *    read); otherwise as with none named;
 *  - none named (omitted as above, or an explicit null, which reads with the unchanged key too): the one connected workspace that
 *    holds the key; two holders `team-ambiguous`; any slot the answer depends on unread, while two readable ones do not already
 *    hold the key, `unavailable`; a key no connected workspace holds, every one read, or no workspace connected, stored with none;
 *  - the keep of a stored none (review 2971 F2, review 3286 F1): a row stored with no workspace keeps it, with its source, team
 *    name, evidence and time, when its unchanged key is sent back and one readable workspace holds it, named (another slot that
 *    cannot be read does not undo it: naming a holder of the stored key changes nothing) or not (every slot read). Only two
 *    readable holders undo it: the stored none resolves nowhere, so naming one of them is a real change;
 *  - a cleared key stores none; a workspace named with no key is `team-unknown`. */
export function workspaceAfterWrite(a: {
  before: { teamKey: string | null; workspace: string | null };
  written: { teamKey: string | null; workspace?: string | null };
  route: PairRoute;
}): { ok: true; workspace: string | null } | { ok: false; error: 'team-unknown' | 'team-ambiguous' | 'unavailable' } {
  const { before, written } = a;
  const key = written.teamKey;
  if (key === null) return typeof written.workspace === 'string' ? { ok: false, error: 'team-unknown' } : { ok: true, workspace: null };
  if (!writeReadsStore(before, written)) return { ok: true, workspace: before.workspace };
  // The stored none is kept for the unchanged key sent back with a workspace that holds it (F2), unless two readable workspaces hold
  // the key (review 3286 F1: an unread other slot does not undo the keep; asked only once a holder is measured).
  const keptNone = (): boolean => key === before.teamKey && before.workspace === null && !twoHolders(a.route(key, null));
  if (typeof written.workspace === 'string') {
    const named = a.route(key, written.workspace);
    if (named === 'unmeasured') return { ok: false, error: 'unavailable' };
    if (named.kind !== 'slot') return { ok: false, error: 'team-unknown' };
    return { ok: true, workspace: keptNone() ? null : written.workspace };
  }
  if (written.workspace === undefined && before.workspace !== null) {
    const kept = a.route(key, before.workspace);
    if (kept === 'unmeasured') return { ok: false, error: 'unavailable' };
    if (kept.kind === 'slot') return { ok: true, workspace: before.workspace };
  }
  const any = a.route(key, null);
  if (any === 'unmeasured') return { ok: false, error: 'unavailable' };
  if (any.kind === 'slot') return { ok: true, workspace: keptNone() ? null : any.slot.workspaceId };
  return any.word === 'team-ambiguous' ? { ok: false, error: 'team-ambiguous' } : { ok: true, workspace: null };
}

/** Whether a route measured two readable workspaces holding the key (`team-ambiguous`). */
const twoHolders = (r: LinearRoute | 'unmeasured'): boolean => r !== 'unmeasured' && r.kind === 'refused' && r.word === 'team-ambiguous';

/** D-8809 (review 2971 F5): the workspace name the Overlord's confirm stores: the routed slot's own name for the pair in the live
 *  store, else the candidate's, else none. */
export function confirmedWorkspaceName(
  teams: ReadonlyArray<{ key: string; workspaceId: string; workspaceName: string | null }>, chosen: TeamCandidateWire, workspaceId: string,
): string | null {
  return teams.find((t) => t.key === chosen.key && t.workspaceId === workspaceId)?.workspaceName ?? chosen.workspaceName ?? null;
}

/** D-8808 (review 2971 F7, the coordinator's ruling): whether a session may suggest a team: one that claims an open run (a
 *  coordinator of some programme). "Claims an open run" is the role's own decision (`claimsOpenRunOf`, roleOf.ts, review 2997
 *  A4), over the same fact the card and the sleep lane read, the open claimants (`openCoordinatorIds`), so the gate has no rule
 *  of its own. Claimants that could not be read (`unmeasured`) refuse (`run-unreadable`), never pass. */
export function suggesterVerdict(
  sessionId: string, openCoordinators: ReadonlySet<string> | 'unmeasured',
): { ok: true } | { ok: false; error: 'not-a-coordinator' | 'run-unreadable' } {
  const claims = claimsOpenRunOf(sessionId, openCoordinators);
  if (claims === 'unmeasured') return { ok: false, error: 'run-unreadable' };
  return claims === 'yes' ? { ok: true } : { ok: false, error: 'not-a-coordinator' };
}

/** A failed reading is taken again after this long, not after a day: a failure says nothing about the repository. */
export const VISIBILITY_RETRY_MS = 5 * 60_000;

/** The project to measure next: a never-measured one first, then the oldest reading that is due. A reading is due when it
 *  is 24 h old, or, if it failed, when it is `VISIBILITY_RETRY_MS` old; else null. */
export function visibilityDue(rows: readonly { project: string; at: number | null; failed?: boolean }[], now: number): string | null {
  const never = rows.find((r) => r.at === null);
  if (never) return never.project;
  let best: { project: string; at: number } | null = null;
  for (const r of rows) {
    if (r.at === null || now - r.at < (r.failed === true ? VISIBILITY_RETRY_MS : VISIBILITY_MAX_AGE_MS)) continue;
    if (best === null || r.at < best.at) best = { project: r.project, at: r.at };
  }
  return best ? best.project : null;
}

/** The path a text is read as by the hashed class: its exemptions key on a file, and plan text is nobody's file. */
const TEXT_FILE = 'plan-text';

/** D-8808: may a suggestion's reason be stored? It is shown in a console a public mirror may show, so it is read as PUBLIC text:
 *  it may name no ticket id of ANY connected team (`teamKeys`: every distinct key the Linear store reaches), then every other
 *  class is checked once. A hit names its class, never the text. */
export function suggestionReasonVerdict(why: string, teamKeys: readonly string[], privateKeys: readonly string[] = []):
  { ok: true } | { ok: false; word: 'linear-text-public'; class: string; ids?: string[] } {
  for (const key of new Set(teamKeys.map((k) => k.toUpperCase()))) {
    const ids = trackerIdsIn(why, key);
    if (ids.length > 0) return { ok: false, word: 'linear-text-public', class: 'tracker id', ids };
  }
  return publicTextVerdict(why, null, 'public', privateKeys);
}

/** D-8181 (design §4.3, §6.1): may this text reach a tracker? A `private` project's text passes; a `public` or `unknown`
 *  one (unmeasured is treated as public, as `linkingMode` does everywhere) is refused if it names one of the team's
 *  tracker ids (`trackerIdsIn`, the ids listed) or any topology class matches (the class named). A hashed hit names its
 *  class and `#h8`, never the text; the sentence the operator sees is the word's fixed one. Each line is read alone and each
 *  consecutive pair as a phrase broken across a line, as the tree scan reads a file. `privateKeys` are the installer's
 *  private tracker keys (`CCRC_PRIVATE_TRACKER_KEYS`), whose ids the tracker class refuses besides the team's own. */
export function publicTextVerdict(text: string, teamKey: string | null, mode: LinkingMode, privateKeys: readonly string[] = []):
  { ok: true } | { ok: false; word: 'linear-text-public'; class: string; ids?: string[] } {
  if (mode === 'private') return { ok: true };
  const ids = trackerIdsIn(text, teamKey);
  if (ids.length > 0) return { ok: false, word: 'linear-text-public', class: 'tracker id', ids };
  const lines = text.split('\n');
  for (const cls of publicTextClassesFor(privateKeys)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (cls.skipLine?.(line, TEXT_FILE)) continue;
      if (cls.match !== undefined) {
        const hits = [...cls.match(line, TEXT_FILE),
          ...(cls.matchPair !== undefined && i + 1 < lines.length ? cls.matchPair(line, lines[i + 1]!, TEXT_FILE) : [])];
        if (hits.length > 0) return { ok: false, word: 'linear-text-public', class: `${cls.name} #${hits[0]!}` };
        continue;
      }
      for (const m of line.matchAll(cls.pattern!)) {
        if (!cls.allowed?.(m[0])) return { ok: false, word: 'linear-text-public', class: cls.name };
      }
    }
  }
  return { ok: true };
}

/** D-8182 (design §5.6): the workspace slug of a ticket's run in a private project: `key-123-<words>`, lowercase, at most
 *  `WS_SLUG_MAX`. The words are the slug the caller gave, else the ticket's title; a given slug that already starts with the
 *  identifier and a dash (or is the identifier) is kept, fitted. The words are cut to what the identifier leaves, so the
 *  identifier is never the part dropped. */
export function slugForTicket(identifier: string, given: string | undefined, title: string): string {
  const id = slugifyWords(identifier);
  const g = slugifyWords(given ?? '');
  if (g === id || g.startsWith(`${id}-`)) return fitSlug(g, WS_SLUG_MAX).slug;
  const words = g !== '' ? g : slugifyWords(title);
  if (words === '') return id;
  const room = WS_SLUG_MAX - id.length - 1;
  const fitted = room > 0 ? fitSlug(words, room).slug : '';
  return fitted === '' ? id : `${id}-${fitted}`;
}
