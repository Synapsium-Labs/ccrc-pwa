/**
 * The linking standard's vocabulary (D-8147): how a project's pull requests reach their Linear ticket, decided by the
 * repository's visibility.
 *
 * L0. Types and words only; every decision lives in `server/src/linking/policy.ts`. The team key's grammar is
 * `LINEAR_TEAM_KEY_SHAPE` in `./linear.ts`; there is no second one.
 *
 * The facts a project row carries (`ProjectLinkingWire` and the four words under it) are declared in `./api.ts`, beside
 * `ProjectRepoWire`: `ProjectRow.linking` names them. They are re-exported from here, so every reader of the linking
 * vocabulary names one module. The team-link vocabulary (the evidence kinds, the link sources, the candidate shape and
 * their guards) is declared here (D-8635, wave 8); `./api.ts` takes only a type-only import of it, for the row's fields.
 */
import type { LinkingOverride, ProjectLinkingWire } from './api.js';
export type {
  RepoVisibility, LinkingOverride, LinkingMode, TemplateState, ProjectLinkingWire,
} from './api.js';
export { REPO_VISIBILITIES, LINKING_OVERRIDES, LINKING_MODES, TEMPLATE_STATES } from './api.js';

/** D-8405: what the automatic team link read, strongest first. `ticket-ids`: `ids` distinct ticket ids of the team's key
 *  among `of` distinct ids of every known team key, in the project's branches, pull request titles and commits (a
 *  private repository only). `name-match`: the project's name or its repository's name equals the team's name or key,
 *  ignoring case. D-8808 `pr-attachments`: `ids` distinct issues of the team attached to this repository's merged pull
 *  requests among `of` distinct attached issues of every team (public and private repositories alike); the pair's
 *  workspace rides the candidate or the link, not the evidence. D-8808 `suggested`: a coordinator session's suggestion (`by`
 *  is the session, `why` its reason, shown in the console and never written to Linear); a candidate only, never a link. */
export type TeamEvidence =
  | { kind: 'ticket-ids'; ids: number; of: number }
  | { kind: 'name-match'; matched: 'project' | 'repo'; on: 'name' | 'key' }
  | { kind: 'pr-attachments'; ids: number; of: number }
  | { kind: 'suggested'; by: string; why: string };
export type TeamEvidenceKind = TeamEvidence['kind'];
/** D-6048 (ARCH-12): the runtime list, derived from the type. */
const TEAM_EVIDENCE_KIND_MAP: Record<TeamEvidenceKind, true> = { 'ticket-ids': true, 'name-match': true, 'pr-attachments': true, suggested: true };

/** D-8808: the longest reason a suggestion carries. */
export const TEAM_SUGGESTION_WHY_MAX = 280;
export const TEAM_EVIDENCE_KINDS: readonly TeamEvidenceKind[] = Object.keys(TEAM_EVIDENCE_KIND_MAP) as TeamEvidenceKind[];

/** D-8405: who set a project's team key. */
export type TeamLinkSource = 'manual' | 'auto';
/** D-6048 (ARCH-12): the runtime list, derived from the type. */
const TEAM_LINK_SOURCE_MAP: Record<TeamLinkSource, true> = { manual: true, auto: true };
export const TEAM_LINK_SOURCES: readonly TeamLinkSource[] = Object.keys(TEAM_LINK_SOURCE_MAP) as TeamLinkSource[];

/** D-8405: a project's team key and who set it. `at` is when (null for a key stored before anyone recorded it). */
export type TeamLinkWire =
  | { source: 'manual'; at: number | null }
  | { source: 'auto'; teamName: string; evidence: TeamEvidence; at: number };

/** D-8405: one team the automatic pass offers for a project, with the evidence that names it. D-8808: and the workspace
 *  it lives in (absent on a candidate an older build stored; `workspaceName` null when the workspace's name is unknown). */
export interface TeamCandidateWire {
  key: string; name: string; evidence: TeamEvidence; workspaceId?: string; workspaceName?: string | null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** D-8405: the one guard of `TeamEvidence`, for a value read back from storage: exactly one of the four shapes. */
export function isTeamEvidence(v: unknown): v is TeamEvidence {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o['kind'] === 'ticket-ids' || o['kind'] === 'pr-attachments') {
    return Object.keys(o).length === 3 && isCount(o['ids']) && isCount(o['of']) && (o['ids'] as number) <= (o['of'] as number);
  }
  if (o['kind'] === 'suggested') {
    return Object.keys(o).length === 3 && typeof o['by'] === 'string' && o['by'] !== ''
      && typeof o['why'] === 'string' && o['why'] !== '' && o['why'].length <= TEAM_SUGGESTION_WHY_MAX;
  }
  if (o['kind'] === 'name-match') {
    return Object.keys(o).length === 3 && (o['matched'] === 'project' || o['matched'] === 'repo')
      && (o['on'] === 'name' || o['on'] === 'key');
  }
  return false;
}

/** D-8405: the one guard of `TeamCandidateWire`; `isKey` is the team key's grammar (`isLinearTeamKey`, `./linear.ts`),
 *  passed in because this file imports no runtime module. */
export function isTeamCandidate(v: unknown, isKey: (k: unknown) => boolean): v is TeamCandidateWire {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (!(isKey(o['key']) && typeof o['name'] === 'string' && isTeamEvidence(o['evidence']))) return false;
  const n = Object.keys(o).length;
  if (n === 3) return true;   // an older build's candidate: no workspace
  return n === 5 && typeof o['workspaceId'] === 'string' && o['workspaceId'] !== ''
    && (o['workspaceName'] === null || typeof o['workspaceName'] === 'string');
}

/** `GET /api/linking`: a session's read of its own project. */
export interface LinkingShowAnswer extends ProjectLinkingWire { ok: true; project: string }

/** `POST /api/linking/suggest` (D-8808): a session's suggestion of a team for its project. Closed: exactly these keys
 *  (`workspace` optional). Never a link; the reason is shown in the console only. */
export interface TeamSuggestionBody { byId: string; byUuid: string; project: string; team: string; workspace?: string; why: string }

/** `POST /api/linking/suggest`'s 200 (D-8808): the caller's own stored suggestion and nothing else about the project, so the door
 *  is no way round `GET /api/linking`'s own-project rule. */
export interface TeamSuggestionAnswer {
  ok: true; project: string;
  suggestion: { key: string; workspaceId: string | null; workspaceName: string | null; teamName: string; why: string; at: number };
}

/** `POST /api/projects/:project/linking`: the operator's write. */
export interface LinkingWriteBody {
  teamKey: string | null; override: LinkingOverride | null;
  /** D-8808: the workspace id the key lives in; null: none; omitted: keep the stored one while it holds the key (`workspaceAfterWrite`). */
  workspace?: string | null;
}

/** Every refusal word the linking routes answer; each reaches the PWA through `refusalText`. */
export const LINKING_REFUSALS = ['bad-team-key', 'bad-override', 'no-project', 'repo-public', 'repo-unmeasured',
  'template-exists', 'no-team-key', 'tracker-id-public', 'ticket-slug-public', 'template-failed', 'override-private-public', 'team-unknown',
  'team-set'] as const;
export type LinkingRefusal = (typeof LINKING_REFUSALS)[number];

/** Where a repository's pull request template lives. */
export const LINKING_TEMPLATE_PATH = '.github/pull_request_template.md';
