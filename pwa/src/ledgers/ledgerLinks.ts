// The ledgers' links (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D26 to D28; ring L1: pure, no store, no DOM).
//
// ONE OWNER of every address the ledger screens draw into Docs: `docHref`, the Docs reader address of a repository document in
// a home project; `specHref`, the same for a programme's pinned spec (moved here from `GoalsPanel`, which drew it alone until
// PL10); `homeProjectOf`, the repository whose Docs hold a programme's spec (moved here from `ProgrammeScreen`); and
// `programmeSpecHref`, the three put together for one programme, which the item band, each programme group of the combined
// list, the programme view's head and Goals all ask. A document address is built only through `docsPageUrl(docsLocation(…))`,
// as every Docs link is (refinement (q)).
//
// `linkRuns` splits an item's text into text and link runs. Only three things are links (D27): an `https` address, a path the
// console routes (`matchRoute`), and a repository document path in one of the Docs reader's four sections, which becomes the
// Docs reader address in the programme's home project (D28). Everything else stays text: `http:`, `javascript:`, `data:`,
// `vbscript:`, `mailto:`, a path the console does not route, a protocol-relative `//host`, a document path with a `..` step
// or with no home project to open it in. This is not the chat's Markdown renderer (`lib/markdown.tsx`): item text is plain
// text, and its link set is an allow-list with a rewrite of its own, so it is a different decision, not a second copy of that
// one (`pl10-linkruns-not-chat-markdown`).
import type { RunSummary } from '../../../shared/api';
import { DOC_SECTIONS, DOC_SECTION_SLUGS, docsPageUrl, isDocsProject, isDocsRelPath } from '../../../shared/docs';
import { isSpecPath, type GoalsView } from '../../../shared/ledgers';
import { docsLocation } from '../docs/docsLinks';
import { runHomeProject } from '../fleet/runWords';
import { matchRoute } from '../lib/routes';
import { isGoalsFor } from './waitingView';

/** One run of an item's text: words drawn as they are, or a link. `external` is an outside page, which opens in a new tab with
 *  no opener; otherwise `href` is a path inside the console. */
export type LinkRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string; readonly external: boolean };

/** The Docs reader address of a repository document path (`docs/superpowers/specs/x.md`) in `homeProject`, or null: no home
 *  project, a home the Docs grammar refuses, or a path outside the four sections or outside their path grammar. */
export function docHref(repoPath: string, homeProject: string | null): string | null {
  if (homeProject === null || !isDocsProject(homeProject)) return null;
  for (const section of DOC_SECTION_SLUGS) {
    const dir = `${DOC_SECTIONS[section]}/`;
    if (!repoPath.startsWith(dir)) continue;
    const path = repoPath.slice(dir.length);
    if (!isDocsRelPath(path)) return null;
    return docsPageUrl(docsLocation(
      { kind: 'project', project: homeProject, ref: null },
      { kind: 'path', section, path, dirSlash: false },
    ));
  }
  return null;
}

/** The Docs page of a pinned spec in the programme's home project, or null: no pin, a path that is not a spec path
 *  (`isSpecPath`: under the specs directory, Markdown, no `..`), or no usable home project. Null has those three meanings and
 *  no caller needs to tell them apart. */
export function specHref(specPath: string | null, homeProject: string | null): string | null {
  return specPath === null || !isSpecPath(specPath) ? null : docHref(specPath, homeProject);
}

/** The newest run of the programme that names a home project: the repository whose Docs hold its spec. `null` when none does. */
export function homeProjectOf(slug: string, runs: readonly RunSummary[]): string | null {
  const mine = runs.filter((r) => r.program === slug).sort((a, b) => b.id - a.id);
  for (const r of mine) { const home = runHomeProject(r); if (home !== null) return home; }
  return null;
}

/** The Docs page of programme `slug`'s pinned spec, from the Goals views the page holds and the runs it has heard, or null. An
 *  entry is read on the programme view's own terms (`isGoalsFor`), so a box, a list group and the view never disagree. */
export function programmeSpecHref(slug: string, goals: readonly unknown[], runs: readonly RunSummary[]): string | null {
  const entry = goals.find((g) => isGoalsFor(g, slug));
  return specHref(entry === undefined ? null : (entry as GoalsView).specPath, homeProjectOf(slug, runs));
}

/** A candidate starts at the text's start or after a space or an opening bracket or quote, and is an `https://` (any case), a
 *  single `/`, or `docs/`; it runs to the next space or quote or angle bracket. */
const CANDIDATE = /(^|[\s([{"'])((?:[hH][tT][tT][pP][sS]:\/\/|\/(?!\/)|docs\/)[^\s<>"'`]*)/g;
/** What may end a sentence after a link, and is not part of it. */
const TRAILING = /[.,;:!?]$/;
const CLOSER_OF: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };
/** A console path: segments of unreserved and percent-escaped characters, then an optional query or fragment. */
const CONSOLE_PATH = /^(\/[A-Za-z0-9._~%/-]*)([?#][^\s]*)?$/;

/** The candidate without what follows it in the sentence: trailing punctuation, and a closing bracket it never opened. */
function trimmed(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.at(-1);
    if (last === undefined) return s;
    if (TRAILING.test(last)) { s = s.slice(0, -1); continue; }
    const opener = CLOSER_OF[last];
    if (opener !== undefined && s.split(opener).length <= s.split(last).length - 1) { s = s.slice(0, -1); continue; }
    return s;
  }
}

/** The link a candidate is, or null when it stays text. */
function linkOf(text: string, homeProject: string | null): LinkRun | null {
  if (/^https:\/\//i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname === '') return null;
    return { kind: 'link', text, href: url.href, external: true };
  }
  if (text.startsWith('docs/')) {
    const href = docHref(text, homeProject);
    return href === null ? null : { kind: 'link', text, href, external: false };
  }
  const m = CONSOLE_PATH.exec(text);
  if (m === null || m[1] === undefined || m[1] === '/' || matchRoute(m[1]) === null) return null;
  return { kind: 'link', text, href: text, external: false };
}

/** An item's text as runs of text and links, in order; the runs' texts put together are the text, and no two text runs are
 *  adjacent. `homeProject` is the programme's home project, where a document path opens; null, a document path stays text. */
export function linkRuns(text: string, homeProject: string | null): readonly LinkRun[] {
  const out: LinkRun[] = [];
  const pushText = (t: string): void => {
    if (t === '') return;
    const last = out.at(-1);
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  let at = 0;
  for (const m of text.matchAll(CANDIDATE)) {
    const lead = m[1] ?? '';
    const raw = m[2] ?? '';
    const start = (m.index ?? 0) + lead.length;
    const candidate = trimmed(raw);
    const link = candidate === '' ? null : linkOf(candidate, homeProject);
    if (link === null) continue;
    pushText(text.slice(at, start));
    out.push(link);
    at = start + candidate.length;
  }
  pushText(text.slice(at));
  return out;
}
