// The judge of the Markdown parts' cutter (X2 P6.1 Step 0b2), shared by `docs-md-parts-blocks.test.ts` and
// `docs-md-parts-fuzz.test.ts`: the shared Markdown library's own parse of the whole document, held against each part. A part
// violates when a source line in it is code content in the part and not in the whole document, or the other way round: the
// reader would show text as code, or code as text. Code content is a fence block's lines after its opener (up to its closer),
// as the span of the block's `data-line` mark gives them (the library trims the blank lines at a fence's ends from the code
// text, so its line count is not read), and a bare `pre`'s lines from its first (indented code), at any depth, so a list's and a
// quote's code counts. Blank lines are never compared: a blank line shown as code or as text is no text shown as code.
// A part's own lines are mapped back to the document's: a `reopen` line and a `close` line are not document lines.
import { render } from '@synapsium-labs/pinax-lib/render';
import type { Element, Root, RootContent } from 'hast';
import { collectMdBlocks, partText, type MdPart, type TextBlock } from '../src/docs/range/mdParts';
import { answerRenderJob } from '../src/lib/readerRenderJob';
import { parseRendered, type MdBlock } from '../src/lib/renderTree';

type Node = Root | RootContent;

function classes(el: Element): readonly string[] {
  const c = el.properties?.className;
  return Array.isArray(c) ? c.map(String) : [];
}

/** The 0-based lines of `src` that are code content, by the library's parse of `src`. */
export function codeLines(src: string): Set<number> {
  const r = render(src, { highlight: false });
  if (r.outcome !== 'rendered') throw new Error(`judge: the library did not render (${r.outcome})`);
  const out = new Set<number>();
  const lines = src.split(/\r\n|\r|\n/);
  const visit = (n: Node): void => {
    if (n.type !== 'element') {
      if ('children' in n) for (const c of n.children) visit(c);
      return;
    }
    const dl = n.properties?.dataLine;
    const m = typeof dl === 'string' ? /^(\d+)-(\d+)$/.exec(dl) : null;
    if (m !== null) {
      const first = Number(m[1]) - 1;
      const fenceWrap = (n.tagName === 'div' && classes(n).includes('codehilite')) || (n.tagName === 'figure' && classes(n).includes('mermaid-figure'));
      if (fenceWrap || n.tagName === 'pre') {
        // The mark's span: a fence's lines after its opener, up to its closer (when its last line is one), and an indented
        // block's lines. The library trims the blank lines at a fence's ends from the code text, so the text's own line count is
        // not used (blank lines are never compared, below).
        const last = Number(m[2]) - 1;
        const from = fenceWrap ? first + 1 : first;
        const closed = fenceWrap && last > first && /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.test(lines[last] ?? '');
        for (let i = from; i <= (closed ? last - 1 : last); i += 1) out.add(i);
        return;
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(parseRendered(r.html));
  return out;
}

/** The offsets at which each line of `s` starts, by markdown-it's rule (`\r\n`, a lone `\r` and `\n` end a line). */
export function lineStartsOf(s: string): number[] {
  const a = [0];
  const re = /\r\n|\r|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) a.push(m.index + m[0].length);
  return a;
}

/** The lines of `s` (by markdown-it's rule), without their terminators. */
function lineTexts(s: string): string[] {
  return s.split(/\r\n|\r|\n/);
}

/** The violations of `parts` against the whole document `text`, each as a sentence naming the part, its line and the way. */
export function judgeViolations(text: string, parts: readonly MdPart[]): string[] {
  const docCode = codeLines(text);
  const ls = lineStartsOf(text);
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid]! <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const out: string[] = [];
  parts.forEach((p, i) => {
    const inPart = codeLines(partText(text, p));
    const reopenLines = (p.reopen ?? '').split(/\r\n|\r|\n/).length - 1;
    const slice = text.slice(p.start, p.end);
    const sliceLines = lineStartsOf(slice).length - (/(\r\n|\r|\n)$/.test(slice) ? 1 : 0);
    const base = lineOf(p.start);
    const sliceText = lineTexts(slice);
    for (let s = 0; s < sliceLines; s += 1) {
      const pl = reopenLines + s;
      const dl = base + s;
      // A blank line is no text shown as code, or code shown as text: the library trims blank lines at a fence's end.
      if (sliceText[s]!.trim() === '') continue;
      if (inPart.has(pl) !== docCode.has(dl)) {
        out.push(`part ${i} line ${pl} (document line ${dl}): ${inPart.has(pl) ? 'code in the part, text in the document' : 'text in the part, code in the document'}`);
      }
    }
  });
  return out;
}

/** What the worker answers for a blocks job, wrapped in a promise: `ask` for `collectMdBlocks`. */
export const askLibrary = (src: string): Promise<MdBlock[] | null> => new Promise((resolve) => {
  answerRenderJob({ id: 1, kind: 'render', src, blocks: true }, (r) => {
    resolve(r.outcome.kind === 'blocks' ? [...r.outcome.blocks] : null);
  });
});

/** The blocks of `text` as the cutter gets them, from the library through the worker's job, `windowBytes` a window (the gate). */
export function blocksOf(text: string, windowBytes?: number): Promise<{ blocks: TextBlock[]; tailFrom: number | null }> {
  return collectMdBlocks(text, askLibrary, new AbortController().signal, windowBytes === undefined ? undefined : { windowBytes });
}
