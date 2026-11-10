// Chat's resolver (chat reading at a desk, Task L, D-8062; spec 2026-11-06 sections 4.1 and 4.2): one of chat's marks, plus the
// session's context, to the address it opens, or null, and the name stays text. `chatMarks.ts` recognises a name and carries no
// URL; this module decides where it points, at render time, because the parse worker caches a parse by its text and cannot see
// the session's repository, branch or the ids the console holds.
//
// L1, Session Conversation: pure, no React, no store, no DOM. It is a module of its own, not part of `chatMarks.ts`, because the
// parse worker loads `chatMarks.ts` and `markdown-purity.test.ts` holds that closure free of the Docs and ledger modules this one
// asks (`docHref`, `itemPath`, `runsRunHref`): another process and its purity boundary (the plan's departure from spec 4.2).
//
// Desktop polish Task C21 (D-8172; spec R15): a PR or commit name opens the repository the message means, or stays text; where
// the code cannot tell, text. A session lives in one project but may coordinate runs whose work lands in other repositories, so
// its home repository is the answer only when nothing says otherwise. The rule, first that applies wins: a name that says its
// repository (`owner/repo#12`) opens it, when the one reader (`chatRepoEvidence.ts#qualifiedRepo`) can tell it; a bare name
// opens the one repository its own message names for it (`chatRepoEvidence.ts`), and none where it names two or one it cannot
// tell; else it opens the home repository only when the message names no other repository and the session claims no open run
// elsewhere (`claimsRunElsewhere`); else it stays text. A qualified name follows GitHub's own notation without knowing that
// the repository exists, so a prose pair such as `client/server#1` may open a real but unrelated page (R15's residual).
import { repoLabel, type ProjectRow, type RunSummary } from '../../../shared/api';
import { docHref, sessionBranchRef } from '../docs/docsLinks';
import { claimedRunsOf } from '../fleet/runWords';
import { itemPath } from '../ledgers/ledgerWords';
import type { Mark } from './chatMarks';
import { namesOtherThan, qualifiedRepo, readRepo, repoKey, reposFor, type MessageRepos } from './chatRepoEvidence';
import { runsRunHref } from './routes';

/** What a session's chat knows to resolve a name: its project's measured repository slug (`repoLabel`: null unless the repo is
 *  `named`), its project, the branch its worktree holds, the runs and items the console holds now, and whether the session
 *  claims an open run whose repository is not its home one (`claimsRunElsewhere`, Task C21). */
export interface ChatRefContext {
  readonly repo: string | null;
  readonly project: string | null;
  readonly branch: string | null;
  readonly knownRuns: ReadonlySet<number>;
  readonly knownItems: ReadonlySet<number>;
  readonly runsElsewhere: boolean;
}

/** Whether session `sessionId` claims an open run (`claimedRunsOf`, the coordinator-side reader: `claimedBy`, not closed by
 *  `isRunClosed`) whose project's repository is not `homeRepo` (Task C21, rule 3b). A run whose project has no `named` repository,
 *  one `repoKey` cannot read, or that no project row names, counts as elsewhere, and so does every claimed open run before the console has read its projects (`projects === null`): what cannot
 *  be shown to be home is not home. */
export function claimsRunElsewhere(
  sessionId: string,
  homeRepo: string | null,
  runs: readonly Pick<RunSummary, 'claimedBy' | 'project' | 'state'>[],
  projects: readonly ProjectRow[] | null,
): boolean {
  const home = homeRepo === null ? null : repoKey(homeRepo);
  return claimedRunsOf(runs, sessionId).some((run) => {
    const slug = repoLabel(projects?.find((p) => p.name === run.project)?.repo);
    const key = slug === null ? null : repoKey(slug);
    return key === null || key !== home;
  });
}

/** Where a name opens: `external`, an outside page in a new tab with no opener; else a path inside the console. */
export type RefTarget = { readonly href: string; readonly external: boolean };

/** A run or item number with fewer digits than this links only when the console holds it (R11), so "run 2 times" and "item 3
 *  of the list" stay text. */
export const SMALL_ID_DIGITS = 3;

/** The id of a run or item mark as a number, or null when it is no positive integer, or is small (`SMALL_ID_DIGITS`) and not
 *  held. */
function heldOrLarge(id: string, known: ReadonlySet<number>): number | null {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return String(n).length >= SMALL_ID_DIGITS || known.has(n) ? n : null;
}

/** The GitHub page of `mark` in repository `slug`, or null when the console's one GitHub grammar refuses the slug
 *  (`readRepo`: `parseGithubRepo` after the one trailing-dot trim; review 1586 A1, review 1758 F4): the address is built from
 *  the owner and name it read, never from the slug as written. */
function githubPage(slug: string | null, mark: Mark): RefTarget | null {
  const gh = slug === null ? null : readRepo(slug);
  if (gh === null) return null;
  const where = mark.kind === 'pr' ? 'issues' : 'commit';
  return { href: `https://github.com/${gh.owner}/${gh.repo}/${where}/${mark.id}`, external: true };
}

/** Task C21's rule for a PR or commit mark, first that applies wins: (1) the repository its name says; (2) the one repository
 *  its message names for it, or text where it names two or one it cannot read; (3) text, where the message names a repository
 *  other than the home one (an unknown one included) or the session claims an open run elsewhere; (4) the home repository. */
function repoPage(mark: Mark, kind: 'pr' | 'commit', ctx: ChatRefContext, said: MessageRepos): RefTarget | null {
  if (mark.repo !== undefined) {
    const own = qualifiedRepo(mark.repo);
    return own.kind === 'named' ? githubPage(own.slug, mark) : null;
  }
  const named = [...reposFor(kind, mark.id, said).values()];
  if (named.length > 0) return named.length === 1 && named[0]!.kind === 'named' ? githubPage(named[0]!.slug, mark) : null;
  const home = ctx.repo === null ? null : repoKey(ctx.repo);
  if (home === null || ctx.runsElsewhere || namesOtherThan(said, home)) return null;
  return githubPage(ctx.repo, mark);
}

/** The address `mark` opens in this session, its message having said `said` (`messageRepos` of the whole message), or null: a
 *  PR or commit whose repository Task C21's rule cannot tell or `parseGithubRepo` refuses, a small run or item id the console
 *  does not hold, or a document path `docHref` refuses (no project, a path outside the four sections). A document opens at the
 *  session's branch when it is in the bare grammar, else the project's default view (R12). */
export function refHref(mark: Mark, ctx: ChatRefContext, said: MessageRepos): RefTarget | null {
  switch (mark.kind) {
    case 'pr':
    case 'commit':
      return repoPage(mark, mark.kind, ctx, said);
    case 'run': {
      const n = heldOrLarge(mark.id, ctx.knownRuns);
      return n === null ? null : { href: runsRunHref(n), external: false };
    }
    case 'item': {
      const n = heldOrLarge(mark.id, ctx.knownItems);
      return n === null ? null : { href: itemPath(n), external: false };
    }
    case 'doc': {
      const href = docHref(mark.id, ctx.project, sessionBranchRef(ctx.branch));
      return href === null ? null : { href, external: false };
    }
  }
}
