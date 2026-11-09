/**
 * The linking standard's vocabulary (D-8147): how a project's pull requests reach their Linear ticket, decided by the
 * repository's visibility.
 *
 * L0. Types and words only; every decision lives in `server/src/linking/policy.ts`. The team key's grammar is
 * `LINEAR_TEAM_KEY_SHAPE` in `./linear.ts`; there is no second one.
 */

/** What GitHub says a repository is. */
export type RepoVisibility = 'public' | 'private' | 'internal';
/** The operator's word, which wins over any reading. */
export type LinkingOverride = 'private' | 'public';
/** Which rule applies: `private` carries the ticket id, `public` never does, `unknown` is nothing measured or set. */
export type LinkingMode = 'private' | 'public' | 'unknown';
/** Whether the repository has the pull request template file. */
export type TemplateState = 'present' | 'absent';

/** One project's linking facts as the wire carries them. */
export interface ProjectLinkingWire {
  teamKey: string | null;
  override: LinkingOverride | null;
  measured:
    | { state: 'measured'; visibility: RepoVisibility; slug: string; template: TemplateState; at: number }
    | { state: 'unmeasured' }
    | { state: 'failed'; reason: string; at: number };
  mode: LinkingMode;
}

/** `GET /api/linking`: a session's read of its own project. */
export interface LinkingShowAnswer extends ProjectLinkingWire { ok: true; project: string }

/** `POST /api/projects/:project/linking`: the operator's write. */
export interface LinkingWriteBody { teamKey: string | null; override: LinkingOverride | null }

/** Every refusal word the linking routes answer; each reaches the PWA through `refusalText`. */
export const LINKING_REFUSALS = ['bad-team-key', 'bad-override', 'no-project', 'repo-public', 'repo-unmeasured',
  'template-exists', 'no-team-key', 'tracker-id-public', 'ticket-slug-public'] as const;
export type LinkingRefusal = (typeof LINKING_REFUSALS)[number];

/** Where a repository's pull request template lives. */
export const LINKING_TEMPLATE_PATH = '.github/pull_request_template.md';
