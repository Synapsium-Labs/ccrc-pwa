// Chat's resolver (chat reading at a desk, Task L, D-8062; spec 2026-11-06 sections 4.1 and 4.2): one of chat's marks, plus the
// session's context, to the address it opens, or null, and the name stays text. `chatMarks.ts` recognises a name and carries no
// URL; this module decides where it points, at render time, because the parse worker caches a parse by its text and cannot see
// the session's repository, branch or the ids the console holds.
//
// L1, Session Conversation: pure, no React, no store, no DOM. It is a module of its own, not part of `chatMarks.ts`, because the
// parse worker loads `chatMarks.ts` and `markdown-purity.test.ts` holds that closure free of the Docs and ledger modules this one
// asks (`docHref`, `itemPath`, `runsRunHref`): another process and its purity boundary (the plan's departure from spec 4.2).
import { docHref, sessionBranchRef } from '../docs/docsLinks';
import { itemPath } from '../ledgers/ledgerWords';
import type { Mark } from './chatMarks';
import { runsRunHref } from './routes';

/** What a session's chat knows to resolve a name: its project's measured repository slug (`repoLabel`: null unless the repo is
 *  `named`), its project, the branch its worktree holds, and the runs and items the console holds now. */
export interface ChatRefContext {
  readonly repo: string | null;
  readonly project: string | null;
  readonly branch: string | null;
  readonly knownRuns: ReadonlySet<number>;
  readonly knownItems: ReadonlySet<number>;
}

/** Where a name opens: `external`, an outside page in a new tab with no opener; else a path inside the console. */
export type RefTarget = { readonly href: string; readonly external: boolean };

/** A run or item number with fewer digits than this links only when the console holds it (R11), so "run 2 times" and "item 3
 *  of the list" stay text. */
export const SMALL_ID_DIGITS = 3;

/** A repository slug as GitHub spells one, `owner/name` (an owner of letters, digits and `-`; a name of those, `_` and `.`,
 *  never `.` or `..` alone): anything else is no repository to link into. */
const REPO_SLUG = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;

/** The id of a run or item mark as a number, or null when it is no positive integer, or is small (`SMALL_ID_DIGITS`) and not
 *  held. */
function heldOrLarge(id: string, known: ReadonlySet<number>): number | null {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return String(n).length >= SMALL_ID_DIGITS || known.has(n) ? n : null;
}

/** The address `mark` opens in this session, or null: a PR or commit with no repository, a small run or item id the console
 *  does not hold, or a document path `docHref` refuses (no project, a path outside the four sections). A document opens at the
 *  session's branch when it is in the bare grammar, else the project's default view (R12). */
export function refHref(mark: Mark, ctx: ChatRefContext): RefTarget | null {
  switch (mark.kind) {
    case 'pr':
    case 'commit': {
      if (ctx.repo === null || !REPO_SLUG.test(ctx.repo)) return null;
      const where = mark.kind === 'pr' ? 'issues' : 'commit';
      return { href: `https://github.com/${ctx.repo}/${where}/${mark.id}`, external: true };
    }
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
