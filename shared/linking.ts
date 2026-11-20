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
 *  ignoring case. */
export type TeamEvidence =
  | { kind: 'ticket-ids'; ids: number; of: number }
  | { kind: 'name-match'; matched: 'project' | 'repo'; on: 'name' | 'key' };
export type TeamEvidenceKind = TeamEvidence['kind'];
/** D-6048 (ARCH-12): the runtime list, derived from the type. */
const TEAM_EVIDENCE_KIND_MAP: Record<TeamEvidenceKind, true> = { 'ticket-ids': true, 'name-match': true };
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

/** D-8405: one team the automatic pass offers for a project, with the evidence that names it. */
export interface TeamCandidateWire { key: string; name: string; evidence: TeamEvidence }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** D-8405: the one guard of `TeamEvidence`, for a value read back from storage: exactly one of the two shapes. */
export function isTeamEvidence(v: unknown): v is TeamEvidence {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o['kind'] === 'ticket-ids') {
    return Object.keys(o).length === 3 && isCount(o['ids']) && isCount(o['of']) && (o['ids'] as number) <= (o['of'] as number);
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
  return Object.keys(o).length === 3 && isKey(o['key']) && typeof o['name'] === 'string' && isTeamEvidence(o['evidence']);
}

/** `GET /api/linking`: a session's read of its own project. */
export interface LinkingShowAnswer extends ProjectLinkingWire { ok: true; project: string }

/** `POST /api/projects/:project/linking`: the operator's write. */
export interface LinkingWriteBody {
  teamKey: string | null; override: LinkingOverride | null;
  /** D-8808: the workspace id the key lives in; null: none; omitted: keep the stored one while it holds the key (`workspaceAfterWrite`). */
  workspace?: string | null;
}

/** Every refusal word the linking routes answer; each reaches the PWA through `refusalText`. */
export const LINKING_REFUSALS = ['bad-team-key', 'bad-override', 'no-project', 'repo-public', 'repo-unmeasured',
  'template-exists', 'no-team-key', 'tracker-id-public', 'ticket-slug-public', 'template-failed', 'override-private-public'] as const;
export type LinkingRefusal = (typeof LINKING_REFUSALS)[number];

/** Where a repository's pull request template lives. */
export const LINKING_TEMPLATE_PATH = '.github/pull_request_template.md';
