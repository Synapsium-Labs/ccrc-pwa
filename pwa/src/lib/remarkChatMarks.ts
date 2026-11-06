// The chat marks plugin (chat reading at a desk, Task M, D-8060; spec 2026-11-06 sections 3.1, 3.3 and 4.2): the one
// remark plugin that reads `chatMarks.ts`'s table over an mdast tree, in chat's two plugin lists only (the sync path's
// `CHAT_REMARK_PLUGINS` and the parse worker's chat profile; never the docs profile). It writes data attributes and
// nothing else: a mark carries a kind and an id, never a URL, because the worker caches its parse by text and cannot
// see the session's repository or the ids the console holds. Resolving a mark is the renderer's, at render time.
//
// What it writes:
//   - a text node becomes `markRuns`' runs: a name is a text node drawn as a `span` carrying `MARK_ATTR.kind` and
//     `MARK_ATTR.id`, a status word in S3's position a `span` carrying `MARK_ATTR.status`;
//   - S2: a `strong` whose whole text is a status word carries `MARK_ATTR.status`;
//   - S1: a `tableCell` whose first child is text starting with a status word has that word split off as a status span;
//   - a root-level paragraph, or the first paragraph of an item of a root-level list, that opens with a `strong`
//     `leadKind` reads as a lead-in gives that `strong` `MARK_ATTR.lead`; a root-level list straight after a root-level
//     paragraph with an action lead-in carries `MARK_ATTR.afterLead`. A lead-in inside a quote or a callout is not
//     marked: there the ground is a tint, and the contrast gate measures these rules on the page ground only.
// It never descends into code, a link, an image, a reference or raw HTML. Explicit-stack walks, as `remarkAlerts`'s, so a
// deep tree cannot overflow the call stack. React-free and DOM-free: the parse worker imports it.
import { MARK_ATTR, leadKind, leadingStatus, markRuns, statusTone, type LeadKind } from './chatMarks';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
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

/** S1: a table cell's first text, split when it starts with a status word. */
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

/** A text node as `markRuns`' runs; `null` when it holds no name and no status word. */
function textRuns(node: MdNode): MdNode[] | null {
  const runs = markRuns(node.value ?? '');
  if (runs.length === 0 || (runs.length === 1 && runs[0]!.kind === 'text')) return null;
  return runs.map((r): MdNode => {
    switch (r.kind) {
      case 'text':
        return { type: 'text', value: r.text };
      case 'mark':
        return span(r.mark.text, { [MARK_ATTR.kind]: r.mark.kind, [MARK_ATTR.id]: r.mark.id });
      case 'status':
        return span(r.text, { [MARK_ATTR.status]: r.tone });
    }
  });
}

/** Chat's marks over an mdast tree, in place. */
export function remarkChatMarks(): (tree: unknown) => void {
  return (tree: unknown): void => {
    const root = tree as MdNode;
    markLeads(root);
    const stack: MdNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'tableCell') splitLeadingStatus(node);
      if (node.type === 'strong') {
        const tone = statusTone(plainText(node));
        if (tone !== null) setAttr(node, MARK_ATTR.status, tone);
      }
      const children = node.children;
      if (!children) continue;
      const next: MdNode[] = [];
      for (const child of children) {
        if (child.type === 'text' && child.data?.hName === undefined) {
          const runs = textRuns(child);
          if (runs === null) next.push(child);
          else for (const run of runs) next.push(run);
          continue;
        }
        next.push(child);
        if (child.children && !SKIP.has(child.type)) stack.push(child);
      }
      node.children = next;
    }
  };
}
