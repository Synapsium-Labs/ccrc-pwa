// X2 P1 Task P1.5: Markdown in parts (X2 spec section 4.3, "Markdown in parts", amended by the coordinator's
// render-gate carry of 2026-11-19). `splitMarkdownParts` cuts a Markdown text above the render gate into parts no
// larger than the gate, counted in UTF-8 bytes as the gate counts them: at top-level headings outside fences first,
// then at a blank line outside fences, then at a line end; a fence longer than the gate is closed at the end of its
// part and reopened at the start of the next; a line longer than the gate is cut at a code point boundary.
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../../shared/utf8';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { partForFragment, partText, splitMarkdownParts, type MdPart } from '../src/docs/range/mdParts';
import { fileKey, pinFor, samePin } from '../src/docs/useDocsVisit';
import { pageOpensDraft } from '../src/docs/docsLinks';
import type { DocPin } from '../../shared/docs';
import { draftOf, entry, holder, pageAt, treeOk } from './docsFixtures';

const GATE = DOCS_RENDER_GATE_BYTES;

/** Every invariant a split must hold: the parts cover the text in order with no gap or overlap, each part's text
 *  (its reopen and close counted) is at most `max` bytes, and a part that is not the first starts where the last ended. */
function checkCover(text: string, parts: readonly MdPart[], max: number): void {
  expect(parts.length).toBeGreaterThan(0);
  expect(parts[0]!.start).toBe(0);
  expect(parts.at(-1)!.end).toBe(text.length);
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    expect(p.end, `part ${i} is not empty`).toBeGreaterThan(p.start);
    if (i > 0) expect(p.start, `part ${i} starts where part ${i - 1} ended`).toBe(parts[i - 1]!.end);
    expect(utf8Bytes(partText(text, p)), `part ${i} is at most ${max} bytes`).toBeLessThanOrEqual(max);
  }
}

/** A section: a level-2 heading and paragraphs of plain ASCII, about `bytes` long. */
function section(n: number, bytes: number): string {
  const head = `## Section ${n}\n\n`;
  const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(16) + '\n\n';
  let body = '';
  while (head.length + body.length + para.length <= bytes) body += para;
  return head + body;
}

/** A text of exactly `bytes` ASCII bytes made of sections. */
function sized(bytes: number): string {
  let t = '';
  let n = 1;
  while (t.length < bytes) t += section(n++, 40000);
  return t.slice(0, bytes - 1) + '\n';
}

describe('splitMarkdownParts', () => {
  it('md parts: 524 287 and 524 288 bytes stay one part, 524 289 bytes make two', () => {
    expect(GATE).toBe(524288);
    for (const n of [GATE - 1, GATE]) {
      const t = sized(n);
      expect(utf8Bytes(t)).toBe(n);
      const { parts } = splitMarkdownParts(t, GATE);
      expect(parts, `${n} bytes`).toEqual([{ start: 0, end: n, continued: false, reopen: null, close: null }]);
    }
    const over = sized(GATE + 1);
    const { parts } = splitMarkdownParts(over, GATE);
    expect(parts.length).toBe(2);
    checkCover(over, parts, GATE);
  });

  it('md parts: every part at most the render gate, 524 288 bytes', () => {
    const t = sized(3565158);
    const { parts } = splitMarkdownParts(t, GATE);
    expect(parts.length).toBeGreaterThanOrEqual(7);
    checkCover(t, parts, GATE);
    // A heading cut: each part after the first begins at a top-level heading, and is not continued.
    for (const p of parts.slice(1)) {
      expect(t.slice(p.start, p.start + 3)).toBe('## ');
      expect(p.continued).toBe(false);
    }
  });

  it('md parts: never cuts inside a fence', () => {
    // One section far above the gate, so every cut is a blank-line or line cut, holding fences of 60 000 bytes whose
    // bodies carry `#` headings and blank lines: a cut there would be preferred if the fences were not tracked.
    const body = ('# not a heading\n\n' + 'x'.repeat(80) + '\n').repeat(600);
    const fence = '```text\n' + body + '```\n';
    let t = '## One long section\n\n';
    while (utf8Bytes(t) < 1500000) t += `lead\n\n${fence}\ntail paragraph\n\n`;
    const { parts } = splitMarkdownParts(t, GATE);
    checkCover(t, parts, GATE);
    for (const p of parts) {
      expect(p.reopen).toBeNull();
      expect(p.close).toBeNull();
      const fences = partText(t, p).split('\n').filter((l) => l.startsWith('```')).length;
      expect(fences % 2, 'every fence a part opens, it closes').toBe(0);
    }
  });

  it('md parts: a fence longer than the gate is closed and reopened across parts, each part at most the gate', () => {
    const body = 'y'.repeat(99).concat('\n').repeat(12000); // 1 200 000 bytes inside one fence
    const t = '# Big\n\n~~~~ json\n' + body + '~~~~\n\nafter\n';
    const { parts } = splitMarkdownParts(t, GATE);
    checkCover(t, parts, GATE);
    // A blank line outside the fence is a better cut than a line inside it, so part 0 ends before the fence opens;
    // part 1 opens it, and every later part reopens it.
    expect(partText(t, parts[0]!)).toBe('# Big\n\n');
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(t.slice(parts[1]!.start).startsWith('~~~~ json\n')).toBe(true);
    for (let i = 1; i < parts.length - 1; i += 1) {
      expect(parts[i]!.close, `part ${i} closes the fence`).toBe('~~~~\n');
      expect(parts[i + 1]!.reopen, `part ${i + 1} reopens it with the same line`).toBe('~~~~ json\n');
      expect(parts[i + 1]!.continued).toBe(true);
    }
    expect(parts[0]!.reopen).toBeNull();
    expect(parts[1]!.reopen).toBeNull();
    expect(parts.at(-1)!.close).toBeNull();
  });

  it('md parts: a section with no blank line is cut at a line end, and a line longer than the gate at a code point boundary', () => {
    const lines = '| a | b |\n'.repeat(80000); // a table of 800 000 bytes: no blank line, no heading
    const t1 = '## Table\n\n' + lines;
    const r1 = splitMarkdownParts(t1, GATE).parts;
    checkCover(t1, r1, GATE);
    for (const p of r1.slice(1)) {
      expect(t1[p.start - 1], 'cut after a newline').toBe('\n');
      expect(p.continued).toBe(true);
    }
    const t2 = 'z'.repeat(1200000);
    const r2 = splitMarkdownParts(t2, GATE).parts;
    checkCover(t2, r2, GATE);
    expect(r2.length).toBe(3);
    expect(r2.slice(1).every((p) => p.continued)).toBe(true);
  });

  it('md parts: a CRLF file cuts as an LF one does: its fences, blank lines and headings are seen', () => {
    const crlf = 'para one\r\n\r\n```sh\r\n# comment\r\necho a\r\n# two\r\n```\r\n\r\n# Next\r\n\r\ntail para\r\n';
    for (const max of [24, 30, 40]) {
      const parts = splitMarkdownParts(crlf, max).parts;
      checkCover(crlf, parts, max);
      for (const p of parts) {
        const fences = partText(crlf, p).split(/\r?\n/).filter((l) => l.startsWith('```')).length;
        expect(fences % 2, `max ${max}: every fence a part opens, it closes: ${JSON.stringify(partText(crlf, p))}`).toBe(0);
        expect(partText(crlf, p).startsWith('# comment') || partText(crlf, p).startsWith('# two'),
          `max ${max}: no heading cut inside the fence`).toBe(false);
      }
    }
  });

  it('md parts: a long fence opening line ends, and every part fits; a part after the fence line keeps the fence', () => {
    const t1 = '```' + 'i'.repeat(30) + '\n' + 'c\n'.repeat(20) + '```\n';
    const r1 = splitMarkdownParts(t1, 32).parts;
    checkCover(t1, r1, 32);
    const t2 = '```aaaaaaaaaaaaaa\ncode line one\ncode two\n```\n';
    const r2 = splitMarkdownParts(t2, 20).parts;
    checkCover(t2, r2, 20);
    expect(r2[1]!.reopen, 'the part after the opening line reopens the fence').not.toBeNull();
  });

  it('md parts: on many small random texts every part fits and the parts cover the text', () => {
    const pieces = ['# H\n', '## H2\n', '### h3\n', '\n', 'text line\n', '```js\n', '```\n', '~~~~\n', '    ```\n', '\r\n',
      'x'.repeat(40) + '\n', '\u{1F600}\u{1F600}\n', '> quote\n', 'y'.repeat(90)];
    let seed = 7;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let k = 0; k < 400; k += 1) {
      let t = '';
      const n = 1 + rnd(40);
      for (let i = 0; i < n; i += 1) t += pieces[rnd(pieces.length)]!;
      const max = 24 + rnd(120);
      checkCover(t, splitMarkdownParts(t, max).parts, max);
    }
  });

  it('md parts: one line thousands of windows long is cut in linear work: each part scans its own window only', () => {
    // A scaled stand-in for one 64 MiB line (an inline base64 image): 300 windows of 1000 bytes on ONE line, with a
    // short line before and after it. The probe counts every character the cutter searches, slices or measures.
    const max = 1000;
    const t = 'head\n' + 'q'.repeat(max * 300) + '\ntail\n';
    const probe = { chars: 0 };
    const { parts } = splitMarkdownParts(t, max, probe);
    checkCover(t, parts, max);
    expect(parts.length).toBeGreaterThanOrEqual(300);
    expect(probe.chars, 'characters examined').toBeGreaterThan(t.length);
    expect(probe.chars, 'characters examined stay a small multiple of the text').toBeLessThanOrEqual(6 * t.length);
    // The probe changes nothing the cutter answers.
    expect(splitMarkdownParts(t, max).parts).toEqual(parts);
  });

  /** The fence lines of a text, whatever their list markers, quote marks and indentation. */
  const fenceLines = (s: string): number => s.split('\n').filter((l) => /^[ \t>\-*+]*(```|~~~)/.test(l)).length;

  it('md parts: never cuts inside a fence in a nested list item, past three columns of indentation', () => {
    // No heading anywhere, and blank lines inside every fence: an untracked fence is cut at one of them.
    const fence = '    - ```text\n' + '      code line\n\n'.repeat(8) + '      ```\n';
    const t = ('- item\n  - sub item\n\n' + fence + '\nplain paragraph text\n\n').repeat(30);
    const max = 400;
    const { parts } = splitMarkdownParts(t, max);
    expect(parts.length).toBeGreaterThan(5);
    checkCover(t, parts, max);
    for (const p of parts) {
      expect(p.reopen).toBeNull();
      expect(p.close).toBeNull();
      expect(fenceLines(partText(t, p)) % 2, JSON.stringify(partText(t, p))).toBe(0);
    }
  });

  it('md parts: never cuts inside a fence in a blockquote', () => {
    // No blank line outside the fences either, so every cut is a line cut, and a cut inside a fence is a line cut too.
    const fence = '> ```text\n' + '> code line\n'.repeat(20) + '> ```\n';
    const t = (fence + 'plain paragraph text\n').repeat(30);
    const max = 400;
    const { parts } = splitMarkdownParts(t, max);
    expect(parts.length).toBeGreaterThan(5);
    checkCover(t, parts, max);
    for (const p of parts) {
      expect(p.reopen).toBeNull();
      expect(p.close).toBeNull();
      expect(fenceLines(partText(t, p)) % 2, JSON.stringify(partText(t, p))).toBe(0);
    }
  });

  it('md parts: a fence closes only on a closer within its container: a nested fence in a Markdown-source fence stays inside it', () => {
    // The outer fence holds a list with an indented fence: its inner `    ```` is content, not the outer's closer.
    const nested = '```markdown\n- item\n    ```js\n    x\n    ```\n```\n';
    const t = nested + 'tail para\n\n# Real heading\n\n' + 'f\n\n'.repeat(200);
    const { parts } = splitMarkdownParts(t, 300);
    checkCover(t, parts, 300);
    expect(parts.some((p) => t.startsWith('# Real heading', p.start)), 'the real heading is still a cut').toBe(true);
    for (const p of parts) expect(p.reopen).toBeNull();
  });

  it('md parts: an indented code block that looks like a fence is not a fence: headings after it are still cuts', () => {
    const t = 'Example:\n\n    ```js\n    let x;\n' + 'prose line\n\n## Sec\n\nmore prose\n\n'.repeat(80);
    const { parts } = splitMarkdownParts(t, 500);
    checkCover(t, parts, 500);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.reopen).toBeNull();
    for (const p of parts.slice(1)) expect(t.startsWith('## ', p.start), JSON.stringify(t.slice(p.start, p.start + 20))).toBe(true);
  });

  /** The lines of `s` that a top-level reader (fences indented at most three columns) holds inside a fence, and whether
   *  one is still open at the end. */
  function topLevelFences(s: string): { inside: Set<string>; openAtEnd: boolean } {
    const inside = new Set<string>();
    let open: string | null = null;
    for (const l of s.split('\n')) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*\S*\s*$/.exec(l);
      if (open !== null) {
        if (m !== null && m[1]![0] === open[0] && m[1]!.length >= open.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(l)) open = null;
        else inside.add(l);
      } else if (m !== null) open = m[1]!;
    }
    return { inside, openAtEnd: open !== null };
  }

  it('md parts: the residual: a container fence longer than a window is cut inside it with no reopen and no close, and the text after it is never code', () => {
    const list = '- item\n    - ```json\n' + '      zzzzzzzzzzzzzzzzzzzz\n'.repeat(60) + '      ```\n' + '\nAfter the list.\n## Next\n';
    const parts = splitMarkdownParts(list, 300).parts;
    checkCover(list, parts, 300);
    expect(parts.length).toBeGreaterThan(3);
    for (const [i, p] of parts.entries()) {
      expect(p.reopen, `part ${i} is not reopened`).toBeNull();
      expect(p.close, `part ${i} is not closed`).toBeNull();
      const f = topLevelFences(partText(list, p));
      expect(f.openAtEnd, `part ${i} opens no top-level fence`).toBe(false);
      expect(f.inside.has('After the list.'), `part ${i}: the paragraph is not code`).toBe(false);
      expect(f.inside.has('## Next'), `part ${i}: the heading is not code`).toBe(false);
    }
    // The closer ends the zone: the heading after it is a cut again.
    const quote = '> ```json\n' + '> yyyyyyyyyyyyyyyyyyyy\n'.repeat(60) + '> ```\n\n## Next\n\n' + 'f\n\n'.repeat(200);
    const rq = splitMarkdownParts(quote, 300).parts;
    checkCover(quote, rq, 300);
    for (const p of rq) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    expect(rq.some((p) => quote.startsWith('## Next', p.start))).toBe(true);
  });

  /** A text that repeats `unit` followed by `pad`, cut in windows of `max`: no part holds half a fence, no part is
   *  reopened or closed (a container fence is never reopened), and the parts fit and cover. */
  function noCutInFences(unit: string, pad: string, count: number, max: number): MdPart[] {
    const t = (unit + pad).repeat(count);
    const { parts } = splitMarkdownParts(t, max);
    expect(parts.length).toBeGreaterThan(3);
    checkCover(t, parts, max);
    for (const p of parts) {
      expect(p.reopen).toBeNull();
      expect(p.close).toBeNull();
      expect(fenceLines(partText(t, p)) % 2, JSON.stringify(partText(t, p))).toBe(0);
    }
    return parts;
  }

  it('md parts: a fence indented at most three columns is a top-level fence: a long one is reopened at column 0 and closed by its own closer', () => {
    const list = '- item\n  ```json\n' + '  zzzzzzzzzzzzzzzzzzzz\n'.repeat(60) + '  ```\n\nAfter the list.\n## Next\n';
    const { parts } = splitMarkdownParts(list, 300);
    checkCover(list, parts, 300);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.filter((p) => p.reopen !== null).length).toBeGreaterThan(2);
    for (const [i, p] of parts.entries()) {
      if (p.reopen !== null) expect(p.reopen, `part ${i} reopens at column 0`).toBe('``` json\n');
      const f = topLevelFences(partText(list, p));
      expect(f.openAtEnd, `part ${i} ends outside a fence`).toBe(false);
      expect(f.inside.has('After the list.'), `part ${i}: the paragraph is not code`).toBe(false);
      expect(f.inside.has('## Next'), `part ${i}: the heading is not code`).toBe(false);
    }
  });

  it('md parts: a fence in a list item after a nested item is never cut, blank lines inside it included', () => {
    noCutInFences('1. Configure\n    - edit\n\n    ```yaml\n    a: 1\n\n    b: 2\n    ```\n', 'plain\n', 40, 200);
  });

  it('md parts: a fence after a lazy line is never cut', () => {
    noCutInFences('- a\n    - b\nlazy\n      ```js\n      x\n\n      y\n      ```\n', 'plain\n', 40, 200);
  });

  it('md parts: a fence in a quoted list is never cut', () => {
    noCutInFences('> - ```json\n>   one\n>\n>   two\n>   ```\n', 'plain\n', 40, 100);
  });

  it('md parts: a fence after a quote marker and a tab is never cut', () => {
    noCutInFences('>\t```text\n>\tone\n>\n>\ttwo\n>\t```\n', 'plain\n', 40, 100);
  });

  it('md parts: list markers inside an indented code block do not make the next fence-looking line a fence', () => {
    const t = 'Para.\n\n    - item\n      ```js\n    x\n' + 'prose\n\n## Sec\n\n'.repeat(80);
    const { parts } = splitMarkdownParts(t, 400);
    checkCover(t, parts, 400);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.reopen).toBeNull();
    for (const p of parts.slice(1)) expect(t.startsWith('## ', p.start), JSON.stringify(t.slice(p.start, p.start + 20))).toBe(true);
  });

  it('md parts: a quoted fence is over where its quote is: a later heading is a cut again', () => {
    const t = '> ```\n> code\nplain para\n# H\n\n' + 'f\n\n'.repeat(200);
    const { parts } = splitMarkdownParts(t, 300);
    checkCover(t, parts, 300);
    expect(parts.some((p) => t.startsWith('# H', p.start)), 'the heading after the quote is a cut').toBe(true);
  });

  it('md parts: a heading-looking line indented three columns and cut off by the window end is not a heading', () => {
    const t = 'a'.repeat(40) + '\n\n' + 'b'.repeat(57) + '\n' + '   #tag text\n' + 'c'.repeat(200) + '\n';
    const { parts } = splitMarkdownParts(t, 100);
    checkCover(t, parts, 100);
    expect(parts[0]!.end, 'the blank-line cut wins').toBe(42);
    expect(parts[1]!.continued).toBe(true);
  });

  it('md parts: a heading-looking line cut off by the window end is not a heading (the line is read a few characters past it)', () => {
    const t = 'a'.repeat(40) + '\n\n' + 'b'.repeat(57) + '\n' + '#tag text\n' + 'c'.repeat(200) + '\n';
    const { parts } = splitMarkdownParts(t, 100);
    checkCover(t, parts, 100);
    expect(parts[0]!.end, 'the blank-line cut wins').toBe(42);
    expect(parts[1]!.continued).toBe(true);
  });

  // This bounds the cutter's own ACCOUNTING of the characters it examines (the probe counts what the code reports), not
  // the engine's real work: it would not red against a per-line slice that the code forgot to report.
  it('md parts: a window of many short lines is cut in linear work', () => {
    const t = 'abc\n'.repeat(100000);
    const probe = { chars: 0 };
    const { parts } = splitMarkdownParts(t, 1000, probe);
    checkCover(t, parts, 1000);
    expect(probe.chars, 'characters examined stay a small multiple of the text').toBeLessThanOrEqual(8 * t.length);
  });

  it('md parts: sizes are UTF-8 bytes, so a part of four-byte characters is cut at the gate\'s bytes', () => {
    const t = '\u{1F600}'.repeat(300000); // 1 200 000 bytes, 600 000 UTF-16 units
    const { parts } = splitMarkdownParts(t, GATE);
    checkCover(t, parts, GATE);
    for (const p of parts) {
      // Never between the two halves of a surrogate pair.
      const code = t.charCodeAt(p.start);
      expect(code >= 0xdc00 && code <= 0xdfff, 'a part never starts on a low surrogate').toBe(false);
    }
    expect(utf8Bytes(partText(t, parts[0]!))).toBe(GATE);
  });
});

describe('partForFragment', () => {
  const ids = (...xs: string[]): Set<string> => new Set(xs);
  it('md parts: a link into part 3 opens part 3', () => {
    expect(partForFragment([ids('a'), ids('b'), ids('c', 'd')], 'd')).toEqual({ part: 2, note: false });
  });
  it('a fragment held by two parts opens the first, as the whole document names it', () => {
    expect(partForFragment([ids('x'), ids('dup'), ids('dup')], 'dup')).toEqual({ part: 1, note: false });
  });
  it('md parts: a part the budget refuses keeps its ids unknown and opens part 1 with a note', () => {
    expect(partForFragment([ids('a'), null, ids('c')], 'gone')).toEqual({ part: 0, note: true });
    expect(partForFragment([ids('a'), null, ids('c')], 'c'), 'a known part still opens').toEqual({ part: 2, note: false });
  });
  it('a percent-encoded fragment finds its part by its decoded id, as fragmentTarget finds its heading', () => {
    expect(partForFragment([ids('a'), ids('café')], 'caf%C3%A9')).toEqual({ part: 1, note: false });
    expect(partForFragment([ids('a'), ids('b')], '%E0%A4%A'), 'a fragment that does not decode matches as written only').toEqual({ part: 0, note: false });
  });

  it('a fragment no part holds, every part known, opens part 1 with no note', () => {
    expect(partForFragment([ids('a'), ids('b')], 'zzz')).toEqual({ part: 0, note: false });
  });
});

// ---- The page pin of a stat-pinned draft (spec 4.3; the carry from X2's review: pinFor must not throw) -------------

describe('the page pin of a draft read through its snapshot', () => {
  const MTIME = '1795125141216123456';
  const bigDraft = treeOk({
    entries: [entry('specs', 'big.md', { draft: draftOf('modified', { size: 5242880, fp: null, mtimeNs: MTIME }) })],
    drafts: holder(),
  });
  const page = pageAt('/docs/demo/specs/big.md?ref=main');
  if (page.kind !== 'path') throw new Error('fixture: not a leaf');

  it('pinFor: a stat-pinned draft between the listing and the prepare does not throw', () => {
    expect(pinFor(bigDraft, page)).toEqual({
      kind: 'draft', branch: 'main', head: 'a'.repeat(40), section: 'specs', path: 'big.md', fp: null,
      stat: { size: 5242880, mtimeNs: MTIME },
    });
  });

  it('pinFor: an older ccd\'s draft with no mtimeNs opens nothing (withheld), and still does not throw', () => {
    const old = treeOk({ entries: [entry('specs', 'big.md', { draft: draftOf('modified', { size: 5242880, fp: null }) })], drafts: holder() });
    // The committed side opens instead: the draft stays withheld too-large, as before.
    expect(pinFor(old, page)).toMatchObject({ kind: 'committed' });
  });

  it('samePin: a stat-pinned listing pin equals the opened pin with the same stat and any digest', () => {
    const listed = pinFor(bigDraft, page)!;
    if (listed.kind !== 'draft') throw new Error('not a draft pin');
    const opened: DocPin = { ...listed, fp: 'd'.repeat(64), stat: { size: 5242880, mtimeNs: MTIME } };
    expect(samePin(listed, opened)).toBe(true);
    expect(samePin(opened, listed)).toBe(true);
    expect(samePin(listed, { ...opened, stat: { size: 5242880, mtimeNs: '1' } }), 'another time').toBe(false);
    expect(samePin(listed, { ...opened, head: 'b'.repeat(40) }), 'another head').toBe(false);
    const fpOnly: DocPin = { kind: 'draft', branch: 'main', head: 'a'.repeat(40), section: 'specs', path: 'big.md', fp: 'd'.repeat(64) };
    expect(samePin(listed, fpOnly), 'a pin with no stat is never the stat-pinned one').toBe(false);
    expect(samePin(opened, fpOnly), 'two digests compare by the digest').toBe(true);
  });

  it('fileKey: takes only the opened pin, and a stat-pinned draft is keyed through the opened pin\'s digest', () => {
    const listed = pinFor(bigDraft, page)!;
    if (listed.kind !== 'draft' || listed.fp !== null) throw new Error('fixture: a stat-pinned draft');
    // Compile-time: the listing's fp-null arm is refused, so it can never be keyed as if its fp were a fingerprint
    // (the directive reds, as an unused one, if fileKey takes a listing pin again).
    // @ts-expect-error a listing pin is not an opened pin
    const refused: (p: typeof listed) => string = (p) => fileKey(p, bigDraft, false);
    expect(typeof refused).toBe('function');
    const a = fileKey({ ...listed, fp: 'a'.repeat(64) }, bigDraft, false);
    const b = fileKey({ ...listed, fp: 'b'.repeat(64) }, bigDraft, false);
    expect(a).toContain('a'.repeat(64));
    expect(a, 'two digests of one stat are two bodies').not.toBe(b);
    expect(a).not.toContain('stat:');
  });

  it('docsLinks: a stat-pinned draft page is a draft page', () => {
    expect(pageOpensDraft(bigDraft, page)).toBe(true);
  });
});
