// The Markdown parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10). `parseMarkdown` is
// pure: it runs in the parse worker and in tests, and it never throws. In order:
//   1. the pre-scan (`markdownGuard.ts`); a refusal ends here;
//   2. react-markdown's own processor, called stage by stage: remark-parse, then remark-gfm and the alert
//      callouts, then remark-rehype with raw HTML kept as `raw` nodes; `runSync(parse(src), src)`;
//   3. every `raw` node becomes a `text` node, so raw HTML renders as literal text, never as markup; in the docs
//      profile alone, a `raw` node whose whole value is `<br>`, `<br/>` or `<br />` becomes an empty `br` element
//      instead (the 2026-10-12 spec's A16; W5 Task 4): built here, never parsed, so nothing else is markup;
//   4. one walk drops `position` and measures the tree: deeper than `MD_MAX_TREE_DEPTH` is `too-deep`, more than
//      `DOCS_MAX_RENDER_ELEMENTS` elements is `too-wide`, an inline `code` counting the chips its component draws
//      (`inlineCodeExtraElements`, W5 bound 2-2). The cap bounds the parsed tree's elements, not the whole DOM: a
//      fenced block counts as its `pre` and `code`, while CodeBlock draws its chrome around them and highlight.js
//      adds a span per token, which are bounded instead by the highlight page budgets (`markdownLimits.ts`);
//   5. any exception is `threw`, carrying the error's name only.
// Steps 3 and 4 are explicit-stack walks: a tree that reached them is not yet known to be shallow.
//
// The worker's first-party imports name no React, no highlight.js and no stylesheet, up to the allowed package names
// (`markdown-purity.test.ts`); that the BUILT worker loads with no DOM is `markdown-worker-built.test.ts`'s pin, since
// a package's bundler-chosen entry is beyond the source scan.
import type { Root as HastRoot } from 'hast';
import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { remarkAlerts } from './remarkAlerts';
import { keystrokeParts, prescanMarkdown } from './markdownGuard';
import { DOCS_MAX_RENDER_ELEMENTS, MD_MAX_TREE_DEPTH } from './markdownLimits';

/** Who asked: a label carried through the worker protocol and the runner. The pipeline is the same for both. */
export type MarkdownProfile = 'chat' | 'docs';

export type ParseOutcome =
  | { kind: 'tree'; tree: HastRoot; depth: number }
  | { kind: 'refused'; why: 'container-depth' | 'delimiter-run'; line: number; value: number }
  | { kind: 'too-deep'; depth: number }
  | { kind: 'too-wide'; elements: number } // over DOCS_MAX_RENDER_ELEMENTS
  | { kind: 'threw'; error: string } // error.name only
  | { kind: 'timeout'; budgetMs: number } // runner only
  | { kind: 'worker-unavailable' } // runner only
  | { kind: 'worker-failed'; error: string }; // runner only

/** Chat's plugin order (`ChatMarkdown`'s list): GFM, then the alert callouts. */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkAlerts];

/** The remark plugins by profile: one list for both. `markdown-parse.test.ts` holds the two profiles' outcomes
 *  equal except for step 3's docs `<br>` (A16), so a divergence here is a deliberate change that reds it first. */
const PLUGINS_BY_PROFILE: Readonly<Record<MarkdownProfile, PluggableList>> = {
  chat: REMARK_PLUGINS,
  docs: REMARK_PLUGINS,
};

/** A hast node as the two walks see it. */
interface WalkNode {
  type: string;
  tagName?: string;
  /** An element's properties; step 3 writes `{}` for the docs `br` and reads no one's. */
  properties?: Record<string, unknown>;
  value?: string;
  children?: WalkNode[];
  position?: unknown;
}

/** The name of whatever was thrown: `error.name` for an error (a `DOMException` included), else its `typeof`. */
function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** The one raw spelling the docs profile draws (A16): a whole value of `<br>`, `<br/>` or `<br />`, lower case, with
 *  no attribute. `<BR>`, `<br class=x>` and a block-level raw node holding more than the tag do not match. */
const DOCS_BR = /^<br(?: ?\/)?>$/;

/** Step 3: every `raw` node becomes a `text` node with the same value, in place, with an explicit stack; in the
 *  docs profile a raw node `DOCS_BR` matches becomes an empty `br` element instead. No HTML is parsed: the element
 *  is built here, and every other raw value stays text in both profiles. */
function rawToText(tree: WalkNode, profile: MarkdownProfile): void {
  const stack: WalkNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = node.children;
    if (!children) continue;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (child.type === 'raw') {
        const value = child.value ?? '';
        children[i] = profile === 'docs' && DOCS_BR.test(value)
          ? { type: 'element', tagName: 'br', properties: {}, children: [] }
          : { type: 'text', value };
      } else if (child.children) {
        stack.push(child);
      }
    }
  }
}

/** The elements `SHARED_COMPONENTS.code` draws for an inline code span of `text` beyond the one `code` element the
 *  walk already counts (W5 bound 2-2): a chord of N parts draws `span.kbd-combo`, N `kbd` and N - 1 `span.kbd-plus`,
 *  2N elements in place of one, so 2N - 1 more; any other span draws its one `code`, so 0. The component and this
 *  count call the same `keystrokeParts`, so a span over `MD_KEYSTROKE_MAX_CHARS` adds nothing to either. */
export function inlineCodeExtraElements(text: string): number {
  const keys = keystrokeParts(text);
  return keys === null ? 0 : 2 * keys.length - 1;
}

/** Step 4: drops `position` from every node and measures the deepest node below the root (the root is 0) and
 *  the element count, in one walk with an explicit stack. A `code` element whose parent is not a `pre` (inline
 *  code; a fenced block's `code` is `CodeBlock`'s, which draws no chips) adds `inlineCodeExtraElements` of its text
 *  children's text, the text its component receives. */
function measure(tree: WalkNode): { depth: number; elements: number } {
  const nodes: WalkNode[] = [tree];
  const depths: number[] = [0];
  const parents: (string | undefined)[] = [undefined];
  let depth = 0;
  let elements = 0;
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    const d = depths.pop()!;
    const parent = parents.pop();
    delete node.position;
    if (node.type === 'element') elements += 1;
    if (node.type === 'element' && node.tagName === 'code' && parent !== 'pre') {
      let text = '';
      for (const child of node.children ?? []) if (child.type === 'text') text += child.value ?? '';
      elements += inlineCodeExtraElements(text);
    }
    if (d > depth) depth = d;
    const children = node.children;
    if (children) {
      const tag = node.type === 'element' ? node.tagName : undefined;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        nodes.push(children[i]!);
        depths.push(d + 1);
        parents.push(tag);
      }
    }
  }
  return { depth, elements };
}

/** Steps 3 and 4 over a hast tree, in place: the outcome the pipeline gives for it in `profile` (absent means
 *  `'chat'`, so a one-argument caller keeps chat's raw step). Exported so tests can hand it a tree no Markdown source
 *  could produce (a 100 000-deep one) and prove both walks keep no recursion. */
export function settleHast(tree: HastRoot, profile: MarkdownProfile = 'chat'): ParseOutcome {
  const node = tree as unknown as WalkNode;
  rawToText(node, profile);
  const { depth, elements } = measure(node);
  if (depth > MD_MAX_TREE_DEPTH) return { kind: 'too-deep', depth };
  if (elements > DOCS_MAX_RENDER_ELEMENTS) return { kind: 'too-wide', elements };
  return { kind: 'tree', tree, depth };
}

/** Steps 2 to 5 for one profile. */
function run(src: string, profile: MarkdownProfile): ParseOutcome {
  try {
    const processor = unified()
      .use(remarkParse)
      .use(PLUGINS_BY_PROFILE[profile])
      .use(remarkRehype, { allowDangerousHtml: true });
    return settleHast(processor.runSync(processor.parse(src), src), profile);
  } catch (e) {
    return { kind: 'threw', error: errorName(e) };
  }
}

/** The whole pipeline, pre-scan first. Never throws. */
export function parseMarkdown(src: string, profile: MarkdownProfile = 'chat'): ParseOutcome {
  const scan = prescanMarkdown(src);
  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };
  return run(src, profile);
}

/** Steps 2 to 5 without the pre-scan: the control for the pre-scan's refusals (M4.P1), never a production path. */
export function parseWithoutPrescan(src: string): ParseOutcome {
  return run(src, 'chat');
}

/** One job for the parse worker, as the runner posts it. */
export interface MarkdownJob {
  readonly id: number;
  readonly src: string;
  readonly profile: MarkdownProfile;
}

/** The worker's answer to the job with the same `id`. */
export interface MarkdownReply {
  readonly id: number;
  readonly outcome: ParseOutcome;
}

/** Everything the parse worker does with one message (`markdownWorker.ts` is only the wiring), here so tests never
 *  import the worker entry. A message with no finite numeric `id` is dropped: there is nothing to answer to. A
 *  non-string `src`, or a `profile` other than `'chat'` and `'docs'`, answers `threw` `TypeError`. Otherwise the
 *  answer is `parseMarkdown`'s outcome. Both the parse and the post are wrapped: a parse that throws (the pre-scan
 *  runs outside `parseMarkdown`'s own try) answers `threw` and the thrown name, and a `post` that throws (a structured
 *  clone's `DataCloneError`) is answered once more with `threw` and the thrown name, and a throw from that second
 *  post is swallowed, so the runner's budget answers the job. */
export function answerMarkdownJob(data: unknown, post: (reply: MarkdownReply) => void): void {
  if (typeof data !== 'object' || data === null) return;
  const job = data as { readonly id?: unknown; readonly src?: unknown; readonly profile?: unknown };
  const id = job.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  let outcome: ParseOutcome;
  try {
    outcome =
      typeof job.src === 'string' && (job.profile === 'chat' || job.profile === 'docs')
        ? parseMarkdown(job.src, job.profile)
        : { kind: 'threw', error: 'TypeError' };
  } catch (e) {
    // `parseMarkdown` wraps its pipeline but not its pre-scan: a throw from there is answered like any other.
    outcome = { kind: 'threw', error: errorName(e) };
  }
  try {
    post({ id, outcome });
  } catch (e) {
    try {
      post({ id, outcome: { kind: 'threw', error: errorName(e) } });
    } catch {
      // Nothing more can be said from here: the runner's budget timer answers this job.
    }
  }
}
