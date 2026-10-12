// The Markdown parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10). `parseMarkdown` is
// pure: it runs in the parse worker and in tests, and it never throws. In order:
//   1. the pre-scan (`markdownGuard.ts`); a refusal ends here;
//   2. react-markdown's own processor, called stage by stage: remark-parse, then remark-gfm and the alert
//      callouts, then remark-rehype with raw HTML kept as `raw` nodes; `runSync(parse(src), src)`;
//   3. every `raw` node becomes a `text` node, so raw HTML renders as literal text, never as markup;
//   4. one walk drops `position` and measures the tree: deeper than `MD_MAX_TREE_DEPTH` is `too-deep`, more than
//      `DOCS_MAX_RENDER_ELEMENTS` elements is `too-wide`;
//   5. any exception is `threw`, carrying the error's name only.
// Steps 3 and 4 are explicit-stack walks: a tree that reached them is not yet known to be shallow.
//
// The worker's import closure: no React, no DOM, no highlight.js, no stylesheet (`markdown-purity.test.ts`).
import type { Root as HastRoot } from 'hast';
import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { remarkAlerts } from './remarkAlerts';
import { prescanMarkdown } from './markdownGuard';
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
 *  equal, so a divergence here is a deliberate change that reds it first. */
const PLUGINS_BY_PROFILE: Readonly<Record<MarkdownProfile, PluggableList>> = {
  chat: REMARK_PLUGINS,
  docs: REMARK_PLUGINS,
};

/** A hast node as the two walks see it. */
interface WalkNode {
  type: string;
  value?: string;
  children?: WalkNode[];
  position?: unknown;
}

/** The name of whatever was thrown: `error.name` for an error (a `DOMException` included), else its `typeof`. */
function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** Step 3: every `raw` node becomes a `text` node with the same value, in place, with an explicit stack. */
function rawToText(tree: WalkNode): void {
  const stack: WalkNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = node.children;
    if (!children) continue;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };
      else if (child.children) stack.push(child);
    }
  }
}

/** Step 4: drops `position` from every node and measures the deepest node below the root (the root is 0) and
 *  the element count, in one walk with an explicit stack. */
function measure(tree: WalkNode): { depth: number; elements: number } {
  const nodes: WalkNode[] = [tree];
  const depths: number[] = [0];
  let depth = 0;
  let elements = 0;
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    const d = depths.pop()!;
    delete node.position;
    if (node.type === 'element') elements += 1;
    if (d > depth) depth = d;
    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        nodes.push(children[i]!);
        depths.push(d + 1);
      }
    }
  }
  return { depth, elements };
}

/** Steps 3 and 4 over a hast tree, in place: the outcome the pipeline gives for it. Exported so tests can hand it
 *  a tree no Markdown source could produce (a 100 000-deep one) and prove both walks keep no recursion. */
export function settleHast(tree: HastRoot): ParseOutcome {
  const node = tree as unknown as WalkNode;
  rawToText(node);
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
    return settleHast(processor.runSync(processor.parse(src), src));
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
 *  answer is `parseMarkdown`'s outcome. Both the parse and the post are wrapped: a `post` that throws (a structured
 *  clone's `DataCloneError`) is answered once more with `threw` and the thrown name, and a throw from that second
 *  post is swallowed, so the runner's budget answers the job. */
export function answerMarkdownJob(data: unknown, post: (reply: MarkdownReply) => void): void {
  if (typeof data !== 'object' || data === null) return;
  const job = data as { readonly id?: unknown; readonly src?: unknown; readonly profile?: unknown };
  const id = job.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  const outcome: ParseOutcome =
    typeof job.src === 'string' && (job.profile === 'chat' || job.profile === 'docs')
      ? parseMarkdown(job.src, job.profile)
      : { kind: 'threw', error: 'TypeError' };
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
