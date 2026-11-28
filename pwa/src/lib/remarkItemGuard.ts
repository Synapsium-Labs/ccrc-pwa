// The item profile's guard (desktop-polish wave 186): Waiting-on-you item text is Markdown now, but every item raised before
// this wave is plain prose that was never written for a Markdown parser. This step keeps that prose reading as it was written,
// in the item profile only (`PLUGINS_BY_PROFILE.item`, `markdownParse.ts`); the transcript and the Docs reader never run it,
// so their output does not change by one byte.
//
// What plain CommonMark does to old prose, measured, and what this step does instead:
//   - an underscore never makes emphasis: `__init__`, `_x_` and every snake_case name stay as written (writers are told to
//     use asterisks);
//   - an asterisk or tilde run makes emphasis or a strikethrough only when its outer side is free: the character before the
//     opening run is not a letter, a digit, `/` or `.`, and the character after the closing run is not a letter, a digit or
//     `/`. So `src/*.ts and docs/*.md` and `5*3*2` stay as written, while `*this*.` still ends a sentence in emphasis (a full
//     stop after a closing run is the end of a sentence, never part of a name), and its inner side reads as no glob: the
//     character after the opening run is not `.` or `/` and the character before the closing run is not `/`. So
//     `Remove *.log. Keep src/* as it is.` stays as written, while `*the end.*` is still emphasis;
//   - a list of ONE item on one line stays a paragraph with its marker: `2026. was the year.` and `- then run it` read as the
//     sentences they are, while two or more such lines make a list;
//   - no indented code: a line indented four spaces is prose (a block is a fence);
//   - no block quote: `> 5 failures` keeps its greater-than sign;
//   - no `#` heading: `# of retries is 3` keeps its number sign. A setext heading (a line underlined with `===` or `---`) is
//     drawn as bold text by the item's components;
//   - no footnote and no reference definition: `see[^1]` and `[draft]: docs/x.md` are words, never a footnote section or a
//     line that vanishes (fix round 1 of wave 186, A4);
//   - a backslash before punctuation and a character reference stay as written: `ccrc-[0-9]+\.log` keeps its backslash and
//     `AT&amp;T` its reference (A2). The parser still reads an escaped mark as no mark; the walk puts the source back.
// Those constructs are switched off in the parser itself (micromark's `disable`), the rest is one walk over the parsed
// tree that puts the marks back as literal text from the source, so nothing is invented. Pure: no React, no DOM; it runs in
// the parse worker too (`markdown-purity.test.ts`).

/** The parser constructs the item profile switches off: a block is a fence, and a `#` or `>` line is a sentence. */
export const ITEM_DISABLED_CONSTRUCTS: readonly string[] = [
  'codeIndented', 'headingAtx', 'blockQuote', 'definition', 'gfmFootnoteDefinition', 'gfmFootnoteCall', 'gfmPotentialFootnoteCall',
];

/** A node of the parsed tree as this walk reads it. */
interface MdNode {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** Before an opening run: a letter, a digit, `/` or `.` means the run belongs to a word, a path or a glob. */
const BOUND_BEFORE = /[\p{L}\p{N}/.]/u;
/** After a closing run: a letter, a digit or `/`. A full stop there ends the sentence. */
const BOUND_AFTER = /[\p{L}\p{N}/]/u;
// Inside an opening run: `.` or `/` starts a glob's extension or directory (`*.log`, `*/x`).
const GLOB_AFTER_OPEN = /[./]/;
/** Inside a closing run: `/` ends a glob's directory (`src/*`). A full stop there ends an emphasised sentence. */
const GLOB_BEFORE_CLOSE = '/';
const RUN_TYPES: ReadonlySet<string> = new Set(['emphasis', 'strong', 'delete']);

const startOf = (n: MdNode | undefined): number | undefined => n?.position?.start?.offset;
const endOf = (n: MdNode | undefined): number | undefined => n?.position?.end?.offset;
const text = (value: string): MdNode => ({ type: 'text', value });

/** A text node whose source holds an escape or a character reference, back to its source: `\.` and `&amp;` read as written.
 *  Any other text keeps its parsed value (a soft line break's indent is the parser's). */
function asWritten(node: MdNode, src: string): void {
  const s = startOf(node);
  const e = endOf(node);
  if (s === undefined || e === undefined) return;
  const raw = src.slice(s, e);
  if (raw !== node.value && (raw.includes('\\') || raw.includes('&'))) node.value = raw;
}

/** The literal nodes an emphasis, strong or strikethrough node goes back to, or null when it stays a mark. */
function unwrapRun(node: MdNode, src: string): MdNode[] | null {
  const s = startOf(node);
  const e = endOf(node);
  const kids = node.children ?? [];
  const first = startOf(kids[0]);
  const last = endOf(kids[kids.length - 1]);
  if (s === undefined || e === undefined || first === undefined || last === undefined) return null;
  const free = src[s] !== '_'
    && !(s > 0 && BOUND_BEFORE.test(src[s - 1]!))
    && !(e < src.length && BOUND_AFTER.test(src[e]!))
    && !GLOB_AFTER_OPEN.test(src[first] ?? '')
    && src[last - 1] !== GLOB_BEFORE_CLOSE;
  return free ? null : [text(src.slice(s, first)), ...kids, text(src.slice(last, e))];
}

/** A list of one item on one line, as a paragraph that keeps its marker; null for any other list. */
function loneListLine(node: MdNode, src: string): MdNode | null {
  const items = node.children ?? [];
  if (items.length !== 1) return null;
  const item = items[0]!;
  // A task list item (`- [ ] x`) is a checkbox the writer asked for.
  if (item.checked === true || item.checked === false) return null;
  const para = item.children?.length === 1 ? item.children[0]! : null;
  const s = startOf(item);
  const e = endOf(item);
  const p = startOf(para ?? undefined);
  if (para === null || para.type !== 'paragraph' || s === undefined || e === undefined || p === undefined) return null;
  if (src.slice(s, e).includes('\n')) return null;
  return { type: 'paragraph', children: [text(src.slice(s, p)), ...(para.children ?? [])], position: item.position };
}

/** The walk: every parent's children, rewritten in place, with an explicit stack (a tree that reached here is not yet known
 *  to be shallow). An unwrapped run's children are walked as the parent's own, so a run inside a run is judged too. */
export function guardItemTree(tree: MdNode, src: string): void {
  const parents: MdNode[] = [tree];
  while (parents.length > 0) {
    const parent = parents.pop()!;
    const pending = [...(parent.children ?? [])].reverse();
    const out: MdNode[] = [];
    while (pending.length > 0) {
      const node = pending.pop()!;
      const literal = RUN_TYPES.has(node.type) ? unwrapRun(node, src) : null;
      if (literal !== null) {
        for (let i = literal.length - 1; i >= 0; i -= 1) pending.push(literal[i]!);
        continue;
      }
      if (node.type === 'text') asWritten(node, src);
      const kept = node.type === 'list' ? loneListLine(node, src) ?? node : node;
      out.push(kept);
      if (kept.children !== undefined) parents.push(kept);
    }
    if (parent.children !== undefined) parent.children = out;
  }
}

/** The remark plugin: switches the three constructs off in the parser, then guards the tree against its own source. */
// `this` is the unified processor (as remark-gfm reads it); typed `unknown` here, so the plugin is assignable wherever a
// processor plugin is, and only its `data()` is read.
export function remarkItemGuard(this: unknown): (tree: MdNode, file: { value?: unknown }) => void {
  const data = (this as { data(): Record<string, unknown> }).data();
  const extensions = (data['micromarkExtensions'] ??= []) as unknown[];
  extensions.push({ disable: { null: [...ITEM_DISABLED_CONSTRUCTS] } });
  return (tree, file) => {
    guardItemTree(tree, typeof file.value === 'string' ? file.value : String(file.value ?? ''));
  };
}
