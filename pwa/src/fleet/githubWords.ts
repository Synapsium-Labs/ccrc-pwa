// Settings › Integrations › GitHub (D-8932): every word the read-only GitHub card says, and the one
// decision behind its status line. L1: pure, no store, no `lib/api.ts`, no component.
//
// WHAT CCRC USES TODAY. ccrc holds no GitHub key. Every GitHub call that needs a sign-in (pull request state and checks,
// opening a pull request, the repository's visibility, the template pull request, and a merge: a coordinator's
// `gh pr merge` and `ccd pr-admin-merge`) is the fleet box's own GitHub CLI, signed in there by hand, and every session
// on that box runs as the same user, so it uses the same sign-in. The card says so: that the sign-in must be able to
// write, and that it is shared, are the two facts a stored key is about. The console has no route that reports that sign-in, so the card reads nothing new: its status comes from the
// visibility readings the project list already carries (`ProjectLinkingWire.measured`), each of which is one GitHub call
// the fleet box made. A reading that succeeded proves GitHub answered the box THEN; one that failed `unauthenticated`
// proves GitHub refused its sign-in then. Neither says which account it is, what the sign-in may do, or that it still
// holds now, and the words never claim so.
import type { ProjectLinkingWire } from '../../../shared/linking';

/** What the readings say about the fleet box's GitHub sign-in. `unknown`: no reading speaks to it (none taken yet, or
 *  every failure was something else: offline, rate-limited, no remote). */
export type GithubSignIn =
  | { kind: 'answered'; at: number }
  | { kind: 'refused'; at: number }
  | { kind: 'unknown' };

/** The failure word that speaks to the sign-in (ccd's `_gh_fail_reason`: `gh auth login`, "not logged in", HTTP 401). */
const REFUSED = 'unauthenticated';

/** The newest reading that speaks to the sign-in decides: a success or a refusal. Ties go to the refusal, the one the
 *  operator has to act on. */
export function githubSignIn(readings: ReadonlyArray<ProjectLinkingWire['measured']>): GithubSignIn {
  let answered: number | null = null;
  let refused: number | null = null;
  for (const m of readings) {
    if (m.state === 'measured') answered = Math.max(answered ?? m.at, m.at);
    else if (m.state === 'failed' && m.reason === REFUSED) refused = Math.max(refused ?? m.at, m.at);
  }
  if (refused !== null && (answered === null || refused >= answered)) return { kind: 'refused', at: refused };
  return answered === null ? { kind: 'unknown' } : { kind: 'answered', at: answered };
}

/** The card's words. `ago` is the elapsed span as the page's clock words say it ("3h"). */
export const GITHUB_TEXT = {
  uses: 'ccrc holds no GitHub key. It reaches GitHub through the GitHub CLI signed in on the fleet box. '
    + 'That sign-in reads pull requests, their checks and repository visibility, opens pull requests and merges them, '
    + 'so it has to be able to write to the repositories. Every session on the fleet box uses the same one.',
  answered: (ago: string): string => `GitHub answered the fleet box ${ago} ago, so its sign-in worked then.`,
  refused: (ago: string): string =>
    `GitHub refused the fleet box's sign-in ${ago} ago. Run gh auth login on the fleet box, then ccrc doctor to check it.`,
  unknown: 'No reading yet says whether the fleet box is signed in to GitHub. Run ccrc doctor on the fleet box to check it.',
  loading: 'Reading…',
  unread: 'The project list could not be read, so this page cannot say whether GitHub answers the fleet box.',
  coming: 'A GitHub key stored here, like the Linear keys, is coming. Until then nothing on this card can be changed.',
} as const;

/** The card's status line: `loading` draws a skeleton and says nothing; `amber` marks the one line the operator acts on. */
export interface GithubStatus { state: 'loading' | 'unread' | GithubSignIn['kind']; words: string | null; amber: boolean }

/** The status line, from the project list's read: `loading` and `failed` are the list's two ways of not being read, else
 *  the visibility readings of its rows. `ago` says an instant as an elapsed span ("3h"). */
export function githubStatus(
  read: 'loading' | 'failed' | ReadonlyArray<ProjectLinkingWire['measured']>, ago: (at: number) => string,
): GithubStatus {
  if (read === 'loading') return { state: 'loading', words: null, amber: false };
  if (read === 'failed') return { state: 'unread', words: GITHUB_TEXT.unread, amber: false };
  const s = githubSignIn(read);
  switch (s.kind) {
    case 'answered': return { state: s.kind, words: GITHUB_TEXT.answered(ago(s.at)), amber: false };
    case 'refused': return { state: s.kind, words: GITHUB_TEXT.refused(ago(s.at)), amber: true };
    case 'unknown': return { state: s.kind, words: GITHUB_TEXT.unknown, amber: false };
  }
}
