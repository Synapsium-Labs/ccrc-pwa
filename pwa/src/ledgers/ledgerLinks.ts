// The ledgers' links (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D26 to D28; ring L1: pure, no store, no DOM).
//
// ONE OWNER of every address the ledger screens draw into Docs: `specHref`, the Docs reader address of a programme's pinned
// spec (moved here from `GoalsPanel`, which drew it alone until PL10); `homeProjectOf`, the repository whose Docs hold a programme's spec (moved here from `ProgrammeScreen`); and
// `programmeSpecHref`, the three put together for one programme, which the item band, each programme group of the combined
// list, the programme view's head and Goals all ask. A document address is built only by `docHref`, which moved to the Docs
// context's link owner, `docs/docsLinks.ts`, when chat came to ask it too (chat reading Task L, D-8062).
//
// `linkRuns` splits an item's text into text and link runs. Only three things are links (D27): an `https` address, a path the
// console routes (`routedHref`, which asks `matchRoute` of the path as the browser resolves it, dot-segments and `%2e` ones too:
// review 1466 F8),
// and a repository document path in one of the Docs reader's four sections, which becomes the Docs reader address in the
// programme's home project (D28). Everything else stays text: `http:`, `javascript:`, `data:`, `vbscript:`, `mailto:`, a path
// the console does not route, a protocol-relative `//host`, a path inside another word or address (review 1466 F7), a document
// path with a `..` step or with no home project to open it in, and an `https` address that links a document outside the Docs
// reader (D28). The candidates, their trim and that last decision are shared/ledgers.ts's (`linkCandidates`, `trimLinkTail`,
// `linksDocumentOutside`), the very ones the raise and return routes refuse by, so the console draws as a link nothing the
// server would refuse (review 1466 F5, F6). This is not the chat's Markdown renderer (`lib/markdown.tsx`): item text is plain
// text, and its link set is an allow-list with a rewrite of its own, so it is a different decision, not a second copy of that
// one (`pl10-linkruns-not-chat-markdown`).
//
// ITEM REFERENCES (D-8194). A coordinator names other items in an item's text: "item 129", "item #12", "items 12 and 13".
// `itemRefsIn` finds them, and `linkRuns` draws each number as a link to that item's page when the caller's `itemHref`
// answers one (the number is an item the page has heard, or one the server read back), and as text otherwise. They are found
// in the text between the other links only, so a number inside an address is never one.
import type { RunSummary } from '../../../shared/api';
import { isSpecPath, linkCandidates, linksDocumentOutside, type GoalsView } from '../../../shared/ledgers';
import { docHref } from '../docs/docsLinks';
import { runHomeProject } from '../fleet/runWords';
import { routedHref } from '../lib/routes';
import { isGoalsFor } from './waitingView';

/** One run of an item's text: words drawn as they are, or a link. `external` is an outside page, which opens in a new tab with
 *  no opener; otherwise `href` is a path inside the console. */
export type LinkRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string; readonly external: boolean };

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

/** The link a candidate is, or null when it stays text. */
function linkOf(text: string, homeProject: string | null): LinkRun | null {
  if (/^https:\/\//i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname === '') return null;
    // A document anywhere but the Docs reader (D28) is text: the boundary the raise and return routes refuse at.
    if (linksDocumentOutside(text)) return null;
    return { kind: 'link', text, href: url.href, external: true };
  }
  if (text.startsWith('docs/')) {
    const href = docHref(text, homeProject);
    return href === null ? null : { kind: 'link', text, href, external: false };
  }
  const href = routedHref(text);
  return href === null ? null : { kind: 'link', text, href, external: false };
}

/** One reference to an item in a text (D-8194): where it starts, its words as written ("item 129", "Item #12", or a later number
 *  of a list, "13"), and the item's id. */
export interface ItemRef { readonly start: number; readonly text: string; readonly id: number }

/** "item N", "items N", with an optional `#`: the head of a reference. The number has no leading zero and no word glued to it. */
const REF_HEAD = /\b(items?)\s+(#?[1-9]\d{0,15})(?!\w)/gi;
/** A later number of the same list: ", 5", ", and 6", " and 6", " or 6", " & 6". */
const REF_MORE = /(\s*,\s*(?:(?:and|or)\s+|&\s*)?|\s+(?:and|or)\s+|\s*&\s*)(#?[1-9]\d{0,15})(?!\w)/iy;
const refId = (digits: string): number | null => {
  const n = Number(digits.replace('#', ''));
  return Number.isSafeInteger(n) ? n : null;
};

/** Every reference to an item in a text, in order (D-8194). The first number of a reference carries its word ("items 12"),
 *  each later number of the same list is its own ("13"). */
export function itemRefsIn(text: string): readonly ItemRef[] {
  const out: ItemRef[] = [];
  for (const m of text.matchAll(REF_HEAD)) {
    const id = refId(m[2]!);
    if (id !== null) out.push({ start: m.index, text: m[0], id });
    REF_MORE.lastIndex = m.index + m[0].length;
    for (let more = REF_MORE.exec(text); more !== null; more = REF_MORE.exec(text)) {
      const next = refId(more[2]!);
      if (next !== null) out.push({ start: more.index + more[1]!.length, text: more[2]!, id: next });
    }
  }
  return out;
}

/** The items several texts name, each once, in the order first named (D-8194). */
export function itemRefIds(texts: readonly string[]): number[] {
  return [...new Set(texts.flatMap((t) => itemRefsIn(t).map((r) => r.id)))];
}

/** An item's text as runs of text and links, in order; the runs' texts put together are the text, and no two text runs are
 *  adjacent. `homeProject` is the programme's home project, where a document path opens; null, a document path stays text.
 *  `itemHref` answers the page of an item a reference names, or null for a number that is no item (D-8194); absent, every
 *  reference stays text. */
export function linkRuns(text: string, homeProject: string | null, itemHref?: (id: number) => string | null): readonly LinkRun[] {
  const out: LinkRun[] = [];
  const pushText = (t: string): void => {
    if (t === '') return;
    const last = out.at(-1);
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  // The words between two links, with the item references in them drawn as links where `itemHref` answers one.
  const pushWords = (t: string): void => {
    if (itemHref === undefined) { pushText(t); return; }
    let from = 0;
    for (const ref of itemRefsIn(t)) {
      const href = itemHref(ref.id);
      if (href === null) continue;
      pushText(t.slice(from, ref.start));
      out.push({ kind: 'link', text: ref.text, href, external: false });
      from = ref.start + ref.text.length;
    }
    pushText(t.slice(from));
  };
  let at = 0;
  for (const { start, text: candidate } of linkCandidates(text)) {
    const link = linkOf(candidate, homeProject);
    if (link === null) continue;
    pushWords(text.slice(at, start));
    out.push(link);
    at = start + candidate.length;
  }
  pushWords(text.slice(at));
  return out;
}
