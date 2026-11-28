// Links found in a rendered Markdown tree's prose (desktop-polish wave 186): the item renderer hands the text of every prose
// run to its caller's splitter (an item's `linkRuns`, `ledgers/ledgerLinks.ts`: item references, console paths, repository
// document paths) and draws each link run as an anchor that says where it goes. Text inside code, a fenced block or a link
// is never split, so a path or a number in code stays code and a link never holds a link; a link the writer made is judged by
// the same splitter (`judgeAnchor`), so the text links nothing its prose would not, and a refused link's words are walked as
// prose (fix round 1, F1). The item's anchor draws only what this step marked (`TEXT_LINK_ATTR`): any other anchor is words. Pure and copy-on-write: the tree a
// parse returned (the worker's, or one react-markdown made) is never written, so the same outcome can be drawn twice.
import type { Element, ElementContent, Root, RootContent } from 'hast';

/** One run of a prose text: words as they are, or a link. `external` is an outside page (a new tab, no opener); otherwise
 *  `href` is a path inside the console. The shape of an item's `LinkRun`. */
export type TextLinkRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string; readonly external: boolean };

/** What splits one prose text into runs. */
export type TextLinkSplitter = (text: string) => readonly TextLinkRun[];

/** The property an anchor this step made carries: `external` or `internal`, the splitter's own decision, which the item's
 *  anchor component honours as it is (react-markdown hands it on as `data-text-link`). */
export const TEXT_LINK_PROP = 'dataTextLink';
export const TEXT_LINK_ATTR = 'data-text-link';

/** Elements whose text is never split. */
const NEVER_SPLIT: ReadonlySet<string> = new Set(['a', 'code', 'pre', 'kbd']);

type Parent = Root | Element;

/** A Markdown link the writer made (`[words](address)`, `<address>`), judged by the same splitter as the prose: it stays a
 *  link only when the splitter reads its whole address as one link, which then carries the splitter's address and decision;
 *  otherwise its words stay, as text. So an item's text links exactly what its prose would (an `https` page, a console path,
 *  a repository document path), never a `javascript:` address, an `http:` page or a document outside the Docs reader. */
function judgeAnchor<T extends RootContent | ElementContent>(el: Element, split: TextLinkSplitter): T[] {
  const href = el.properties['href'];
  const runs = typeof href === 'string' && href !== '' ? split(href) : [];
  const only = runs.length === 1 ? runs[0]! : null;
  if (only !== null && only.kind === 'link' && only.text === href) {
    const words = wordsOf(el.children);
    // Words that are an address or a path of their own, other than this one, would say one place and open another: the link
    // is drawn as where it opens (fix round 1 of wave 186, A3).
    const children: ElementContent[] = words !== null && words !== href && LOOKS_LIKE_ADDRESS.test(words) ? [{ type: 'text', value: only.text }] : el.children;
    const judged: Element = { ...el, children, properties: { ...el.properties, href: only.href, [TEXT_LINK_PROP]: only.external ? 'external' : 'internal' } };
    return [judged as T];
  }
  // A refused link is its words, and those words are prose like any other: an autolink inside them is judged by the same
  // splitter, never handed on as it came (fix round 1 of wave 186, F1).
  return splitChildren(el.children as T[], split);
}

/** Words that read as an address or a path: one token holding a scheme's colon or a slash, or starting `www.`. */
const LOOKS_LIKE_ADDRESS = /^(?=\S+$)(?:[A-Za-z][A-Za-z0-9+.-]*:|www\.|.*\/)/;

/** A link's words when they are text alone, else null. */
function wordsOf(children: readonly ElementContent[]): string | null {
  let out = '';
  for (const c of children) {
    if (c.type !== 'text') return null;
    out += c.value;
  }
  return out.trim();
}

/** An image the writer made (`![words](address)`), judged by the same splitter: the item never fetches it, and draws it as a
 *  link only when the splitter reads its whole address as one link (marked as an anchor it made is); otherwise its alt text
 *  stays, as text. So an image cannot link what the prose would not (security review of wave 186). */
function judgeImage<T>(el: Element, split: TextLinkSplitter): T[] {
  const src = el.properties['src'];
  const alt = el.properties['alt'];
  const runs = typeof src === 'string' && src !== '' ? split(src) : [];
  const only = runs.length === 1 ? runs[0]! : null;
  if (only !== null && only.kind === 'link' && only.text === src) {
    return [{ ...el, properties: { ...el.properties, src: only.href, [TEXT_LINK_PROP]: only.external ? 'external' : 'internal' } } as T];
  }
  return typeof alt === 'string' && alt !== '' ? [{ type: 'text', value: alt } as T] : [];
}

/** The children of `parent` with every prose text split, or the same array when nothing changed. */
function splitChildren<T extends RootContent | ElementContent>(children: readonly T[], split: TextLinkSplitter): T[] {
  let out: T[] | null = null;
  children.forEach((node, i) => {
    let next: T[] = [node];
    if (node.type === 'text') {
      const runs = split(node.value);
      if (runs.some((r) => r.kind === 'link')) {
        next = runs.map((r) => (r.kind === 'text'
          ? { type: 'text', value: r.text }
          : {
            type: 'element', tagName: 'a',
            properties: { href: r.href, [TEXT_LINK_PROP]: r.external ? 'external' : 'internal' },
            children: [{ type: 'text', value: r.text }],
          }) as T);
      }
    } else if (node.type === 'element' && node.tagName === 'a') {
      next = judgeAnchor<T>(node, split);
    } else if (node.type === 'element' && node.tagName === 'img') {
      next = judgeImage<T>(node, split);
    } else if (node.type === 'element' && !NEVER_SPLIT.has(node.tagName)) {
      const kids = splitChildren(node.children, split);
      if (kids !== node.children) next = [{ ...node, children: kids } as T];
    }
    if (next.length !== 1 || next[0] !== node) {
      out ??= children.slice(0, i);
      out.push(...next);
    } else if (out !== null) {
      out.push(node);
    }
  });
  return out ?? (children as T[]);
}

/** The tree with its prose texts split by `split`; the same tree when no text holds a link. Recursion follows element depth,
 *  which the parse has already bounded (`MD_MAX_TREE_DEPTH`). */
export function linkProseRuns<T extends Parent>(tree: T, split: TextLinkSplitter): T {
  const kids = splitChildren(tree.children as readonly (RootContent | ElementContent)[], split);
  return kids === tree.children ? tree : { ...tree, children: kids } as T;
}
