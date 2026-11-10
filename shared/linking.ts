/**
 * The linking standard's vocabulary (D-8147): how a project's pull requests reach their Linear ticket, decided by the
 * repository's visibility.
 *
 * L0. Types and words only; every decision lives in `server/src/linking/policy.ts`. The team key's grammar is
 * `LINEAR_TEAM_KEY_SHAPE` in `./linear.ts`; there is no second one.
 *
 * The facts a project row carries (`ProjectLinkingWire` and the four words under it) are declared in `./api.ts`, beside
 * `ProjectRepoWire`: `ProjectRow.linking` names them, and `shared/api.ts` takes no sibling import for it (the import
 * pins in `peers-claims-l0.test.ts` and `collect-lane-l0.test.ts` hold at sixteen). They are re-exported from here, so
 * every reader of the linking vocabulary names one module.
 */
import type { LinkingOverride, ProjectLinkingWire } from './api.js';
export type { RepoVisibility, LinkingOverride, LinkingMode, TemplateState, ProjectLinkingWire } from './api.js';
export { REPO_VISIBILITIES, LINKING_OVERRIDES, LINKING_MODES, TEMPLATE_STATES } from './api.js';

/** `GET /api/linking`: a session's read of its own project. */
export interface LinkingShowAnswer extends ProjectLinkingWire { ok: true; project: string }

/** `POST /api/projects/:project/linking`: the operator's write. */
export interface LinkingWriteBody { teamKey: string | null; override: LinkingOverride | null }

/** Every refusal word the linking routes answer; each reaches the PWA through `refusalText`. */
export const LINKING_REFUSALS = ['bad-team-key', 'bad-override', 'no-project', 'repo-public', 'repo-unmeasured',
  'template-exists', 'no-team-key', 'tracker-id-public', 'ticket-slug-public', 'template-failed', 'override-private-public'] as const;
export type LinkingRefusal = (typeof LINKING_REFUSALS)[number];

/** Where a repository's pull request template lives. */
export const LINKING_TEMPLATE_PATH = '.github/pull_request_template.md';
