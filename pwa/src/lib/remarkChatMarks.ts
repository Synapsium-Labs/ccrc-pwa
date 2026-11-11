// The chat marks plugin (chat reading at a desk, Task M, D-8060; spec 2026-11-06 sections 3.1, 3.3 and 4.2): the one
// remark plugin that reads `chatMarks.ts`'s table over an mdast tree, in chat's two plugin lists only (the sync path's
// `CHAT_REMARK_PLUGINS` and the parse worker's chat profile; never the docs profile). It writes data attributes and
// nothing else: a mark carries a kind and an id, never a URL, because the worker caches its parse by text and cannot
// see the session's repository or the ids the console holds. Resolving a mark is the renderer's, at render time.
//
// What it writes:
//   - a text node becomes `markRuns`' runs: a name is a text node drawn as a `span` carrying `MARK_ATTR.kind` and
//     `MARK_ATTR.id` (and `MARK_ATTR.repo` when the name says its repository, `owner/repo#12`: desktop polish Task C21),
//     a status word in S3's position a `span` carrying `MARK_ATTR.status`; a qualified name at a text node's edge is a name
//     only where the message's SOURCE gives it a name boundary there (`edgeQualified`: under `_` emphasis it is text, as the
//     raw-text evidence reader reads it; review 1760 F4);
//   - S2: a `strong` whose whole content is plain text that is a status word carries `MARK_ATTR.status` (a bold holding
//     inline code or a link is never marked: fix round 1, review 1574 F-B);
//   - S1: a body cell whose first child is text starting with a status word has that word split off as a status span;
//   - a table's header row (its first row) carries no status label of any kind, S1, S2 or S3; a name in it is still
//     marked (fix round 1, review 1574 P4; fix round 2, review 1575 F3);
//   - a root-level paragraph, or the first paragraph of an item of a root-level list, that opens with a `strong`
//     `leadKind` reads as a lead-in gives that `strong` `MARK_ATTR.lead`; a root-level list straight after a root-level
//     paragraph with an action lead-in carries `MARK_ATTR.afterLead`. A lead-in inside a quote or a callout is not
//     marked: there the ground is a tint, and the contrast gate measures these rules on the page ground only.
// It never descends into code, a link, an image, a reference or raw HTML. Explicit-stack walks, as `remarkAlerts`'s, so a
// deep tree cannot overflow the call stack. React-free and DOM-free: the parse worker imports it.
//
// S3's label check reads past its own text node (chat reading Task C fix round 2, review 1592 F4; c-s3-negation): the
// text nodes of a paragraph, a heading or a table cell share one `LabelScan` over the block's flattened text, so a
// negator back to the start of a label's clause, or a `?` ending its sentence, counts from a neighbouring node:
// "**No** tests failed." and "Has #651 merged into `main`?" give no label. The block's nodes are asked in document
// order, so the scan is one pass. The context never makes or moves a name or a label; only `chatMarks.ts` reads it.
// Inline code, link text and raw html hold no sentence end, a name in link text is a name there too, and a `<br>` is a
// line break (review 1601 F3; desktop-polish Task C14, D-8110).
import {
  LabelScan, MARK_ATTR, leadKind, leadingStatus, markRuns, nameSpans, qualifiedNames, statusTone, wordAfter, wordBefore,
  type LeadKind, type MarkRun, type Span,
} from './chatMarks';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** The node types the walk never enters: a name inside one is not prose. */
const SKIP: ReadonlySet<string> = new Set([
  'inlineCode', 'code', 'link', 'linkReference', 'image', 'imageReference', 'definition', 'html',
]);

function setAttr(node: MdNode, attr: string, value: string): void {
  const data = (node.data ??= {});
  data.hProperties = { ...data.hProperties, [attr]: value };
}

/** A text node the plugin made, drawn as a `span` with `props`. */
const span = (value: string, props: Record<string, string>): MdNode => ({
  type: 'text', value, data: { hName: 'span', hProperties: props },
});

/** The blocks whose inline text is one run of prose for S3's label check. */
const BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'tableCell']);

/** Raw html that is a line break: `<br>`, `<br/>`, `<br />`. */
const BREAK_HTML = /^<br\s*\/?>$/i;

/** `markRuns`' runs of each plain text node the walk will reach below `block`, with the block as their context: its
 *  text as written (inline code included, a hard break or a `<br>` as a line break), scanned once, in document order.
 *  Inline code, link text and raw html are not prose for the `?` rule (the scan's quiet stretches), and a name in link
 *  text is registered as a name, in order with the names `markRuns` registers (review 1601 F3). */
function blockRuns(block: MdNode, into: Map<MdNode, readonly MarkRun[]>): void {
  let flat = '';
  const at: { node: MdNode; offset: number }[] = [];
  const quiet: Span[] = [];
  const linkNames: Span[] = [];
  const stack: { node: MdNode; walked: boolean; link: boolean }[] = [{ node: block, walked: true, link: false }];
  while (stack.length > 0) {
    const { node: n, walked, link } = stack.pop()!;
    const lineBreak = n.type === 'break' || (n.type === 'html' && BREAK_HTML.test((n.value ?? '').trim()));
    const value = lineBreak ? '\n' : n.value;
    if (typeof value === 'string') {
      const from = flat.length;
      if (walked && n.type === 'text' && n.data?.hName === undefined) at.push({ node: n, offset: from });
      if (!lineBreak && (!walked || n.type === 'inlineCode' || n.type === 'html')) {
        quiet.push({ start: from, end: from + value.length });
      }
      if (link && n.type === 'text') for (const s of nameSpans(value)) linkNames.push({ start: from + s.start, end: from + s.end });
      flat += value;
    }
    const c = n.children;
    const below = walked && !SKIP.has(n.type);
    const inLink = link || n.type === 'link' || n.type === 'linkReference';
    if (c) for (let i = c.length - 1; i >= 0; i -= 1) stack.push({ node: c[i]!, walked: below, link: inLink });
  }
  const scan = new LabelScan(flat, quiet);
  let next = 0;
  for (const { node, offset } of at) {
    for (; next < linkNames.length && linkNames[next]!.start < offset; next += 1) {
      scan.name(linkNames[next]!.start, linkNames[next]!.end);
    }
    into.set(node, markRuns(node.value ?? '', { scan, offset }));
  }
}

/** The text of `node` and everything below it, as written (inline code included), by an explicit stack. */
function plainText(node: MdNode): string {
  let out = '';
  const stack: MdNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (typeof n.value === 'string') out += n.value;
    const c = n.children;
    if (c) for (let i = c.length - 1; i >= 0; i -= 1) stack.push(c[i]!);
  }
  return out;
}

/** The lead-in a paragraph opens with: its first child's kind when that child is a `strong`, marked on it. */
function markLead(paragraph: MdNode | undefined): LeadKind | null {
  if (paragraph?.type !== 'paragraph') return null;
  const first = paragraph.children?.[0];
  if (first?.type !== 'strong') return null;
  const kind = leadKind(plainText(first));
  if (kind !== null) setAttr(first, MARK_ATTR.lead, kind);
  return kind;
}

/** Lead-ins, at the top level only: root paragraphs, the first paragraph of each item of a root list, and the root
 *  list straight after an action lead-in. */
function markLeads(root: MdNode): void {
  let afterAction = false;
  for (const block of root.children ?? []) {
    if (block.type === 'paragraph') {
      afterAction = markLead(block) === 'action';
      continue;
    }
    if (block.type === 'list') {
      if (afterAction) setAttr(block, MARK_ATTR.afterLead, 'action');
      for (const item of block.children ?? []) markLead(item.children?.[0]);
    }
    afterAction = false;
  }
}

/** S1: a body cell's first text, split when it starts with a status word. */
function splitLeadingStatus(cell: MdNode): void {
  const first = cell.children?.[0];
  if (first?.type !== 'text' || first.data?.hName !== undefined) return;
  const lead = leadingStatus(first.value ?? '');
  if (lead === null) return;
  const rest = (first.value ?? '').slice(lead.word.length);
  const parts = [span(lead.word, { [MARK_ATTR.status]: lead.tone })];
  if (rest !== '') parts.push({ type: 'text', value: rest });
  cell.children!.splice(0, 1, ...parts);
}

/** Whether the qualified name (`owner/repo#n`) at `from`..`to` of text node `node` is refused because the message's SOURCE
 *  puts a word character right before or after it, where the node itself starts or ends (Task C21, review 1760 F4). Under
 *  `_` or `__` emphasis the node holds `org-b/project-b#12` while the source reads `_org-b/project-b#12_`; the message
 *  evidence reader (`chatRepoEvidence.ts`) reads the source, where `_` is a word character and the name is no name, so the
 *  grammar reads that boundary too and the two agree: under `_` neither counts it, under `*` both do. A node with no position
 *  or a plugin run with no source keeps the node's own boundary. */
function edgeQualified(node: MdNode, from: number, to: number, source: string | null): boolean {
  if (source === null) return false;
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (from === 0 && start !== undefined && wordBefore(source, start)) return true;
  return to === (node.value ?? '').length && end !== undefined && wordAfter(source, end);
}

/** The qualified names (`owner/repo#n`, as `${repo}#${id}`) that the message's SOURCE holds over text node `node`'s own range,
 *  read by the evidence reader's own walk (`qualifiedNames`), or null for a node with no position or a plugin run with no
 *  source, which keeps the node's own reading (review 1762 F4; Task C20 fix round 1, review 1766 F4). A qualified name the
 *  node holds is a name only where its range's source holds it too: an escape or an entity inside the name
 *  (`owner/repo\#12`, `owner/repo&#35;12`) decodes to a name the raw-text evidence reader (`chatRepoEvidence.ts`) never
 *  counted, so the grammar refuses it too and the two agree. A container's prefix on a middle line of a list item, a quote or
 *  an alert, and an escape elsewhere in the node, change nothing: the name is looked for, not lined up. */
function sourceNames(node: MdNode, source: string | null): ReadonlySet<string> | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (source === null || start === undefined || end === undefined) return null;
  return new Set(qualifiedNames(source.slice(start, end)).map((q) => `${q.repo}#${q.id}`));
}

/** A text node as `markRuns`' runs (`blockRuns`' when its block made them); `null` when there is nothing to mark. Where
 *  `labels` is false (a header cell) a status run stays text, joined to the text beside it, and only names are marked. A
 *  qualified name the source's boundary refuses (`edgeQualified`), or that the source does not hold over the node's range
 *  (`sourceNames`), stays text. */
function textRuns(node: MdNode, labels: boolean, made: readonly MarkRun[] | undefined, source: string | null): MdNode[] | null {
  const out: MdNode[] = [];
  let marked = false;
  const pushText = (value: string): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.data === undefined) last.value = (last.value ?? '') + value;
    else out.push({ type: 'text', value });
  };
  let at = 0;
  let held: ReadonlySet<string> | null | undefined;
  /** The source's qualified names over this node, read once and only when a qualified name needs them. */
  const heldNames = (): ReadonlySet<string> | null => (held === undefined ? (held = sourceNames(node, source)) : held);
  for (const r of made ?? markRuns(node.value ?? '')) {
    const from = at;
    at += r.kind === 'mark' ? r.mark.text.length : r.text.length;
    if (r.kind === 'text' || (r.kind === 'status' && !labels)) {
      pushText(r.text);
    } else if (r.kind === 'mark' && r.mark.repo !== undefined && (edgeQualified(node, from, at, source)
      || heldNames()?.has(`${r.mark.repo}#${r.mark.id}`) === false)) {
      pushText(r.mark.text);
    } else if (r.kind === 'mark') {
      marked = true;
      const attrs: Record<string, string> = { [MARK_ATTR.kind]: r.mark.kind, [MARK_ATTR.id]: r.mark.id };
      if (r.mark.repo !== undefined) attrs[MARK_ATTR.repo] = r.mark.repo;
      out.push(span(r.mark.text, attrs));
    } else {
      marked = true;
      out.push(span(r.text, { [MARK_ATTR.status]: r.tone }));
    }
  }
  return marked ? out : null;
}

/** Chat's marks over an mdast tree, in place. */
export function remarkChatMarks(): (tree: unknown, file?: unknown) => void {
  return (tree: unknown, file?: unknown): void => {
    const root = tree as MdNode;
    const value = (file as { value?: unknown } | undefined)?.value;
    // The message's source, for `edgeQualified`: react-markdown and the parse worker both hand the plugin a file holding it.
    const source = typeof value === 'string' ? value : null;
    markLeads(root);
    // Each entry carries `labels`: false inside a table's header row (its first row), where no status label of any
    // kind is written, S1, S2 or S3 (fix round 2, review 1575 F3). This flag is the one place that gates all three.
    const stack: { node: MdNode; labels: boolean }[] = [{ node: root, labels: true }];
    const made = new Map<MdNode, readonly MarkRun[]>();
    while (stack.length > 0) {
      const { node, labels } = stack.pop()!;
      if (labels && node.type === 'tableCell') splitLeadingStatus(node);
      if (labels && BLOCKS.has(node.type)) blockRuns(node, made);
      if (labels && node.type === 'strong' && (node.children ?? []).every((c) => c.type === 'text')) {
        const tone = statusTone(plainText(node));
        if (tone !== null) setAttr(node, MARK_ATTR.status, tone);
      }
      const children = node.children;
      if (!children) continue;
      const next: MdNode[] = [];
      children.forEach((child, index) => {
        if (child.type === 'text' && child.data?.hName === undefined) {
          const runs = textRuns(child, labels, made.get(child), source);
          if (runs === null) next.push(child);
          else for (const run of runs) next.push(run);
          return;
        }
        next.push(child);
        const header = node.type === 'table' && index === 0;
        if (child.children && !SKIP.has(child.type)) stack.push({ node: child, labels: labels && !header });
      });
      node.children = next;
    }
  };
}
