// X2 P6.1 review F3: a closed HTML comment (`<!-- ... -->`) at the top level is its OWN cut candidate in the block cutter. The
// library draws no block for it (`pwa-lib`'s `blockComment`), so before this a comment joined the unit of the block before it, and
// when that unit was larger than a part the line cutter cut INSIDE the comment and commented-out text showed. The cases render
// through the real library (the worker's own blocks job, `mdPartsJudge.ts`) and hold each part against the library's render: no
// word of a comment shows in any part.
import { render } from '@synapsium-labs/pinax-lib/render';
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../../shared/utf8';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { READER_BLOCKS_MAX_BYTES } from '../src/lib/readerLimits';
import { answerRenderJob, type ReaderRenderOutcome, type ReaderRenderReply } from '../src/lib/readerRenderJob';
import { collectMdBlocks, cutMarkdownText, MarkdownCutter, partText, splitMarkdownParts, splitMarkdownPartsAt, type BlocksJob, type MdPart, type TextBlock } from '../src/docs/range/mdParts';
import { askLibrary, blocksOf } from './mdPartsJudge';

/** The parts cover the text in order, and each part's text (its reopen and close counted) is at most `max` bytes. */
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

/** The block cutter on `text`, its blocks from the library. */
async function cut(text: string, max: number): Promise<MdPart[]> {
  const { blocks, tailFrom } = await blocksOf(text);
  expect(tailFrom, 'the library read the whole text').toBeNull();
  return splitMarkdownPartsAt(text, max, blocks, tailFrom).parts;
}

/** `s` without its closed comments (`<!--` up to the first `-->` that starts after the opener's end, so `<!-->` closes nothing): what
 *  is left of a part's text outside every comment.
 *  An index walk, left to right: an opener with no closer after it, and everything from there on, is kept. */
const outsideComments = (s: string): string => {
  let out = '';
  let at = 0;
  for (;;) {
    const open = s.indexOf('<!--', at);
    if (open < 0) break;
    const close = s.indexOf('-->', open + '<!--'.length);
    if (close < 0) break;
    out += s.slice(at, open);
    at = close + '-->'.length;
  }
  return out + s.slice(at);
};

/** How many times `needle` stands in `s`, counted left to right without overlap. */
const occurrences = (s: string, needle: string): number => {
  let n = 0;
  for (let at = s.indexOf(needle); at >= 0; at = s.indexOf(needle, at + needle.length)) n += 1;
  return n;
};

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** A cut that fits and covers, in which no part shows a word of the text `hidden` (the comment's own words): by the part's own
 *  text with its closed comments taken out, and by the library's render of the part. */
async function cutsHidden(text: string, max: number, hidden: string): Promise<MdPart[]> {
  const parts = await cut(text, max);
  checkCover(text, parts, max);
  parts.forEach((p, i) => {
    const src = partText(text, p);
    expect(outsideComments(src), `part ${i} holds no comment text outside a comment`).not.toContain(hidden);
    const r = render(src, { highlight: false });
    expect(r.outcome, `part ${i} renders`).toBe('rendered');
    if (r.outcome === 'rendered') expect(r.html, `part ${i} shows no comment text`).not.toContain(hidden);
    expect(LONE_SURROGATE.test(src), `part ${i} holds no lone surrogate`).toBe(false);
    // The close line is on a line of its own: after a line end it is `-->` alone, after the middle of a line a newline comes first.
    if (p.close !== null) {
      const atLineEnd = /[\r\n]$/.test(text.slice(p.start, p.end));
      expect(p.close, `part ${i}: the close line after ${atLineEnd ? 'a line end' : 'the middle of a line'}`).toBe(atLineEnd ? '-->\n' : '\n-->\n');
    }
  });
  return parts;
}

/** The marker's occurrences in the library's render of `src` (-1 when it does not render). */
const shown = (src: string, marker: string): number => {
  const r = render(src, { highlight: false });
  return r.outcome === 'rendered' ? occurrences(r.html, marker) : -1;
};

/** The conservative rule's fit and cover (wave 64): the parts cover the text in order, and each part is at most `max` bytes, its
 *  reopen and close counted, or else it holds a comment opener and was kept whole (no reopen, no close). Answers the indexes of the
 *  parts above `max`. */
function coverByRule(text: string, parts: readonly MdPart[], max: number): number[] {
  expect(parts.length).toBeGreaterThan(0);
  expect(parts[0]!.start).toBe(0);
  expect(parts.at(-1)!.end).toBe(text.length);
  const over: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    expect(p.end, `part ${i} is not empty`).toBeGreaterThan(p.start);
    if (i > 0) expect(p.start, `part ${i} starts where part ${i - 1} ended`).toBe(parts[i - 1]!.end);
    if (utf8Bytes(partText(text, p)) <= max) continue;
    over.push(i);
    expect(text.slice(p.start, p.end).includes('<!--'), `part ${i}, above ${max} bytes, holds a comment opener`).toBe(true);
    expect(p.reopen, `part ${i}, above ${max} bytes, is whole: no reopen`).toBeNull();
    expect(p.close, `part ${i}, above ${max} bytes, is whole: no close`).toBeNull();
  }
  return over;
}

/** The block cutter on `text` under the conservative rule (wave 64), held against the library's render of the whole document: the
 *  whole hides `marker` (asserted first, the measurement against the pinned library), no part shows it, every part renders, and the
 *  parts show `visible` (a word the whole shows) exactly as often as the whole does, so no cut hides shown text either. */
async function cutsByRule(text: string, max: number, marker: string, visible?: string): Promise<MdPart[]> {
  expect(shown(text, marker), 'the library hides the marker in the whole document (the measurement)').toBe(0);
  const parts = await cut(text, max);
  coverByRule(text, parts, max);
  const counts = parts.map((p) => shown(partText(text, p), marker));
  expect(counts.every((n) => n >= 0), `every part renders (per part: ${counts.join(',')})`).toBe(true);
  expect(counts.reduce((a, b) => a + b, 0), `${parts.length} parts at ${max} bytes show the marker (per part: ${counts.join(',')})`).toBe(0);
  if (visible !== undefined) {
    const w = shown(text, visible);
    expect(w, 'CONTROL: the whole shows the visible word').toBeGreaterThan(0);
    const per = parts.map((p) => shown(partText(text, p), visible));
    expect(per.reduce((a, b) => a + b, 0), `the parts at ${max} bytes show "${visible}" as often as the whole (per part: ${per.join(',')})`).toBe(w);
  }
  return parts;
}

/** The cut fed window by window through `MarkdownCutter` is `splitMarkdownPartsAt` of the same blocks. */
async function feedEqualsOneShot(text: string, max: number, windowBytes: number): Promise<void> {
  const cutter = new MarkdownCutter(text, max);
  const early: MdPart[] = [];
  const got = await collectMdBlocks(text, askLibrary, new AbortController().signal, {
    windowBytes,
    onBlocks: (blocks, frontier) => { for (const p of cutter.feed(blocks, frontier)) early.push(p); },
  });
  const rest = cutter.finish(got.tailFrom);
  expect([...early, ...rest], `window ${windowBytes}`).toEqual(splitMarkdownPartsAt(text, max, got.blocks, got.tailFrom).parts);
}

const HIDDEN = 'hiddenword';
const bigComment = (lines: number, word = HIDDEN): string => '<!--\n' + `${word} line\n\n`.repeat(lines) + '-->\n';

// The cases render through the library, so a loaded box may need more than vitest's default five seconds.
describe('a closed comment is its own cut candidate (review F3)', { timeout: 120000 }, () => {
  it('md parts comments: the reported input at 200 bytes (a fence, then a 50-line comment, then a heading) shows no commented text', async () => {
    const text = 'para\n\n' + '```\ncode\n```\n' + '<!--\n' + 'hiddenword line\n\n'.repeat(50) + '-->\n# Next\n';
    const parts = await cutsHidden(text, 200, HIDDEN);
    expect(parts.length).toBeGreaterThan(3);
    // The comment is closed and reopened: a part that ends inside it closes it, the next one reopens it.
    const inside = parts.filter((p) => p.reopen !== null || p.close !== null);
    expect(inside.length).toBeGreaterThan(2);
    for (const p of inside) {
      expect(p.reopen === null || p.reopen === '<!--\n').toBe(true);
      expect(p.close === null || p.close === '-->\n' || p.close === '\n-->\n').toBe(true);
    }
    // The heading after the comment starts the last part, not continued.
    const last = parts.at(-1)!;
    expect(text.startsWith('# Next', last.start)).toBe(true);
    expect(last.continued).toBe(false);
  });

  it('md parts comments: a heading then a 60-line comment, at a size the comment exceeds', async () => {
    const text = '# Title\n' + bigComment(60);
    for (const max of [150, 200, 300]) {
      expect(utf8Bytes(text.slice(8))).toBeGreaterThan(max);
      await cutsHidden(text, max, HIDDEN);
    }
    // The heading is cut off the comment, the comment's own parts start at its opener.
    const parts = await cut(text, 200);
    expect(parts[0]!.end).toBe(8);
    expect(parts[1]!.start).toBe(8);
    expect(parts[1]!.continued).toBe(true);
  });

  it('md parts comments: a comment that fits is one cut candidate beside its block, never cut inside', async () => {
    // A paragraph and the comment right after it (no blank line: the line cutter would cut anywhere in the comment) are more than a
    // part, the comment alone is not: the part ends before the comment.
    const para = (k: number): string => `Paragraph ${k} ` + 'w'.repeat(180) + '\n';
    const comment = '<!--\n' + `${HIDDEN} one\n`.repeat(8) + '-->\n';
    const text = para(1) + comment + para(2) + comment + para(3);
    const max = 300;
    expect(utf8Bytes(para(1) + comment)).toBeGreaterThan(max);
    expect(utf8Bytes(comment)).toBeLessThan(max);
    const parts = await cutsHidden(text, max, HIDDEN);
    for (const p of parts) {
      expect(p.reopen, 'no part reopens a comment').toBeNull();
      expect(p.close, 'no part closes a comment').toBeNull();
      const src = text.slice(p.start, p.end);
      expect(occurrences(src, '<!--'), 'every comment a part holds is whole').toBe(occurrences(src, '-->'));
    }
    expect(parts.some((p) => text.startsWith('<!--', p.start)), 'a part starts at a comment').toBe(true);
    for (const p of parts.slice(1)) expect(p.continued, 'a part that starts at a comment or after one is continued').toBe(true);
    // A comment with a few spaces before its opener, and a one-line comment, are candidates too.
    const spaced = para(1) + '   <!-- ' + HIDDEN + ' one-line -->\n' + para(2);
    const sp = await cutsHidden(spaced, 220, HIDDEN);
    expect(sp.some((p) => spaced.startsWith('   <!--', p.start)), 'a part starts at the spaced one-line comment').toBe(true);
  });

  it('md parts comments: a comment larger than a part is closed at the end of a part and reopened at the start of the next', async () => {
    const text = 'Before the comment.\n\n' + bigComment(120) + '\nAfter the comment.\n';
    const max = 240;
    const parts = await cutsHidden(text, max, HIDDEN);
    const open = text.indexOf('<!--');
    const close = text.indexOf('-->') + 4;
    const inComment = parts.filter((p) => p.start >= open && p.end <= close);
    expect(inComment.length).toBeGreaterThan(5);
    // Cut at line ends: every part inside but the last ends with a close line of its own after a whole line.
    for (const p of inComment.slice(0, -1)) {
      expect(p.close).toBe('-->\n');
      expect(text[p.end - 1], 'cut at a line end').toBe('\n');
    }
    for (const p of inComment.slice(1)) expect(p.reopen).toBe('<!--\n');
    expect(inComment[0]!.reopen).toBeNull();
    expect(inComment.at(-1)!.close).toBeNull();
    // The words of the comment reach the reader nowhere: the parts' render shows only the text outside it.
    const shown = parts.map((p) => render(partText(text, p), { highlight: false })).map((r) => (r.outcome === 'rendered' ? r.html : '')).join('');
    expect(shown).toContain('Before the comment.');
    expect(shown).toContain('After the comment.');
    expect(shown).not.toContain(HIDDEN);
    // The line after the closer's line starts the next cut candidate: the blank line and the paragraph after it are one part (a
    // comment's own parts end at the comment's end, and no part of just the blank line is left over).
    const last = parts.at(-1)!;
    expect(text.slice(last.start)).toBe('\nAfter the comment.\n');
    expect(last.continued).toBe(true);
  });

  it('md parts comments: every part fits at every size from 24 to 130 bytes (the closer on its own line, and after text)', async () => {
    const own = 'Before.\n\n' + bigComment(6) + 'After.\n';
    const after = 'Before.\n\n<!--\nhiddenword one\nhiddenword two\nhiddenword three -->  \n\nAfter.\n';
    const spaced = 'Before.\n\n<!--\n' + 'hiddenword line\n'.repeat(6) + '-->' + ' '.repeat(10) + '\n\nAfter.\n';
    for (let max = 24; max <= 130; max += 1) {
      for (const text of [own, after, spaced]) {
        const parts = await cut(text, max);
        checkCover(text, parts, max);
        for (const p of parts) expect(outsideComments(partText(text, p)), `max ${max}`).not.toContain(HIDDEN);
      }
    }
  });

  it('md parts comments: a closer line too long to fit a part beside the reopen line keeps the comment whole, above the part size (wave 64, the conservative rule)', async () => {
    // The closer and the rest of its line always end the comment's last part, whole, after `<!--`: when the two do not fit one
    // part, the comment is not cut as one (`cutComment` answers null). Until wave 64 P1 then cut the unit and its hidden text could
    // show (class 10); now the unit is one part, whatever its size, and every other part fits.
    const long = 'Before.\n\n<!--\n' + 'hiddenword line\n'.repeat(6) + '-->' + ' '.repeat(60) + '\n\nAfter.\n';
    const unit = long.slice(long.indexOf('<!--'), long.indexOf('\nAfter.'));
    for (let max = 24; max <= 70; max += 1) {
      const parts = await cutsByRule(long, max, HIDDEN, 'After');
      if (utf8Bytes('<!--\n' + '-->' + ' '.repeat(60) + '\n') > max) {
        expect(parts.some((p) => long.slice(p.start, p.end).startsWith(unit)), `max ${max}: the comment is one part`).toBe(true);
      }
    }
  });

  it('md parts comments: a comment, then a heading: the heading starts a part, not continued', async () => {
    const text = 'Intro paragraph.\n\n' + bigComment(40) + '## Next\n\ntext after.\n';
    const parts = await cutsHidden(text, 200, HIDDEN);
    const last = parts.at(-1)!;
    expect(text.startsWith('## Next', last.start)).toBe(true);
    expect(last.continued).toBe(false);
    expect(last.reopen).toBeNull();
  });

  it('md parts comments: CRLF line ends give the same shape', async () => {
    const text = ('para\n\n' + '```\ncode\n```\n' + '<!--\n' + 'hiddenword line\n\n'.repeat(50) + '-->\n# Next\n').replace(/\n/g, '\r\n');
    const parts = await cutsHidden(text, 200, HIDDEN);
    const inside = parts.filter((p) => p.reopen !== null || p.close !== null);
    expect(inside.length).toBeGreaterThan(2);
    for (const p of inside.slice(0, -1)) expect(p.close).toBe('-->\n');
    const last = parts.at(-1)!;
    expect(text.startsWith('# Next', last.start)).toBe(true);
    // A lone CR as the line end too.
    const cr = text.replace(/\r\n/g, '\r');
    await cutsHidden(cr, 200, HIDDEN);
  });

  it('md parts comments: a line longer than a part is cut at a code point boundary, never between a surrogate pair, and the closer is whole', async () => {
    const wide = '😀'.repeat(300);
    const text = 'Lead.\n\n<!-- ' + HIDDEN + wide + ' --> \n\nTail.\n';
    for (let max = 40; max <= 120; max += 7) {
      const parts = await cutsHidden(text, max, HIDDEN);
      for (const p of parts) {
        const src = partText(text, p);
        expect(occurrences(src, '<!--'), `max ${max}: an opener in a part is closed in it`).toBe(occurrences(src, '-->'));
      }
    }
    // A multi-line comment whose middle line is long, and whose closer line has text before it.
    const long = '<!--\n' + HIDDEN + ' ' + 'x'.repeat(500) + '\n' + HIDDEN + ' tail text -->\n';
    for (let max = 40; max <= 160; max += 13) await cutsHidden('Lead.\n\n' + long + 'End.\n', max, HIDDEN);
  });

  it('md parts comments: an unclosed comment is text, and is not closed or reopened', async () => {
    const text = 'para\n\n<!--\n' + 'plain line\n\n'.repeat(60) + 'end\n';
    const parts = await cut(text, 200);
    checkCover(text, parts, 200);
    for (const p of parts) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
  });

  it('md parts comments: a closer followed by text on its line is no comment (the library reads a paragraph there), and an opener indented four columns is no comment', () => {
    // Synthetic blocks: a gap the library would not leave with such lines in it, so the rule is held on the gap reader itself.
    const body = '<!--\n' + 'plain line\n'.repeat(40) + '--> trailing words\n';
    const text = 'para\n\n' + body + 'next\n';
    const blocks = [{ start: 0, end: 5, kind: 'other' as const }, { start: 6 + body.length, end: text.length, kind: 'other' as const }];
    // (Since wave 64 the unit, which holds an opener, is one part above the size: the conservative rule. What this pins is that no
    // part closes or reopens a comment there.)
    const parts = splitMarkdownPartsAt(text, 120, blocks, null).parts;
    coverByRule(text, parts, 120);
    for (const p of parts) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    const indented = 'para\n\n    <!--\n' + 'plain line\n'.repeat(40) + '    -->\nnext\n';
    const ib = [{ start: 0, end: 5, kind: 'other' as const }, { start: indented.length - 5, end: indented.length, kind: 'other' as const }];
    const ip = splitMarkdownPartsAt(indented, 120, ib, null).parts;
    coverByRule(indented, ip, 120);
    for (const p of ip) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
  });

  it('md parts comments: a comment at the start of the text, one after another, and one at the end', async () => {
    const one = '<!--\n' + `${HIDDEN} a\n`.repeat(30) + '-->\n';
    const text = one + one + 'Middle paragraph.\n\n' + one + '<!-- ' + HIDDEN + ' last -->\n';
    for (const max of [120, 200, 400]) await cutsHidden(text, max, HIDDEN);
  });

  // Review of the fix round: after a comment's closer line the rest of the unit went to P1 as new parts even when it fitted, and
  // the line after a comment being `---` skips that cut candidate (no part starts at dashes), so P1's tail part began with `---`,
  // which the library reads as front matter: both rules vanished. The rest now stays in the last part when it fits, and a tail
  // never starts at a line of dashes.
  describe('a comment followed by lines of dashes (the library reads a part that starts at dashes as front matter)', () => {
    const SECRET = 'zq hidden';
    const comment = '<!--\n' + 'zq hidden line\n'.repeat(20) + '-->\n';
    /** The rules (`<hr>`) the library draws for `src`. */
    const rules = (src: string): number => {
      const r = render(src, { highlight: false });
      return r.outcome === 'rendered' ? (r.html.match(/<hr\b/g) ?? []).length : -1;
    };
    /** The cut shows as many rules as the whole document does, every part fits, and no part shows the comment's words. */
    async function sameRules(text: string, max: number): Promise<MdPart[]> {
      const parts = await cutsHidden(text, max, SECRET);
      const whole = rules(text);
      expect(whole, 'the whole document has rules').toBeGreaterThan(0);
      const sum = parts.reduce((n, p) => n + rules(partText(text, p)), 0);
      expect(sum, `${parts.length} parts at ${max} bytes show as many rules as the whole`).toBe(whole);
      return parts;
    }

    it('md parts comments: two rules after the comment (`---` twice, and with a blank line between) keep both, at 120 bytes', async () => {
      for (const after of ['---\n---\npara\n', '---\n\n---\npara\n']) {
        const parts = await sameRules('intro\n\n' + comment + after, 120);
        const text = 'intro\n\n' + comment + after;
        expect(parts.map((p) => partText(text, p)).filter((s) => /^[-\s]*$/.test(s)), 'no part of dashes alone').toEqual([]);
      }
    });

    it('md parts comments: a comment followed by short text that fits makes no extra tiny part', async () => {
      const text = 'intro\n\n' + comment + '---\n\npara\n';
      const parts = await sameRules(text, 120);
      const closer = parts.find((p) => text.slice(p.start, p.end).includes('-->'))!;
      expect(text.slice(closer.start, closer.end), 'the last part of the comment holds the rule after it').toContain('---');
      expect(parts.map((p) => partText(text, p)).filter((s) => /^[-\s]*$/.test(s)), 'no part of dashes alone').toEqual([]);
    });

    it('md parts comments: text after the rule that the library draws no block for (a reference definition) stays in the comment\'s last part when it fits', async () => {
      // (Sixteen lines: the comment's last part is then well under 120 bytes, with room for the rule and the definition.)
      const text = 'intro\n\n<!--\n' + 'zq hidden line\n'.repeat(16) + '-->\n---\n[r]: http://example.test/r\n\npara\n';
      const parts = await sameRules(text, 120);
      const closer = parts.find((p) => text.slice(p.start, p.end).includes('-->'))!;
      expect(text.slice(closer.start, closer.end), 'the rule and the definition are in the last part of the comment').toContain('[r]: http');
      expect(parts.filter((p) => p.start >= closer.end).map((p) => partText(text, p)).join(''), 'only the paragraph is left after it').toBe('para\n');
    });

    it('md parts comments: when the open part has no room for the rule, the closer takes a part of its own and the rules go after it', async () => {
      // The comment's last line is padded 0..39 bytes, which moves where its last part fills up: some pad leaves the open part with
      // no room for the rules, and then the closer is in a part of its own (`<!--` `-->` and the rules), never a tail at dashes.
      // (Three rules: until wave 64 thirty, of which P1 cut all but the first; now a run that no part holds keeps the unit whole,
      // the next case.)
      let own = 0;
      for (let pad = 0; pad < 40; pad += 1) {
        const text = 'intro\n\n<!--\n' + 'zq hidden line\n'.repeat(20) + 'zq hidden ' + 'y'.repeat(pad) + '\n-->\n' + '---\n\n'.repeat(3) + 'para\n';
        const parts = await sameRules(text, 120);
        const closer = parts.find((p) => text.slice(p.start, p.end).includes('-->'))!;
        if (partText(text, closer).startsWith('<!--\n-->\n---')) own += 1;
        const after = text.slice(closer.end);
        if (after !== '') expect(after.startsWith('---'), `pad ${pad}: the tail starts elsewhere than at dashes`).toBe(false);
      }
      expect(own, 'some pad puts the closer in a part of its own').toBeGreaterThan(0);
    });

    it('md parts comments: a run of rules that does not fit after the comment keeps the comment and the rules whole, one part (wave 64)', async () => {
      // Until wave 64 the last part took what it could and P1 cut the rest, whose later parts could start at dashes; now no part
      // starts at a rule there and every rule shows.
      const text = 'intro\n\n' + comment + '---\n\n'.repeat(40) + 'para\n';
      for (const max of [60, 90, 120, 200]) {
        const parts = await cut(text, max);
        const over = coverByRule(text, parts, max);
        expect(over.map((i) => text.slice(parts[i]!.start, parts[i]!.end)), `max ${max}: the comment and its rules are the one part above the size`).toEqual([comment + '---\n\n'.repeat(40)]);
        const shownRules = parts.reduce((n, p) => n + rules(partText(text, p)), 0);
        expect(shownRules, `max ${max}: every rule shows`).toBe(rules(text));
        for (const p of parts) expect(shown(partText(text, p), SECRET), `max ${max}: no part shows the comment`).toBe(0);
      }
    });
  });

  it('md parts comments: the cut fed window by window is the one-shot cut on the same blocks', async () => {
    const texts: [string, number][] = [
      ['para\n\n' + '```\ncode\n```\n' + '<!--\n' + 'hiddenword line\n\n'.repeat(50) + '-->\n# Next\n', 200],
      ['# Title\n' + bigComment(60), 200],
      ['Intro paragraph.\n\n' + bigComment(40) + '## Next\n\ntext after.\n', 200],
      [('para\n\n' + '```\ncode\n```\n' + '<!--\n' + 'hiddenword line\n\n'.repeat(50) + '-->\n# Next\n').replace(/\n/g, '\r\n'), 200],
      [Array.from({ length: 30 }, (_, k) => `Paragraph ${k} ${'w'.repeat(60)}\n\n<!--\n${HIDDEN} ${k}\n${HIDDEN} more\n-->\n\n`).join(''), 300],
      [Array.from({ length: 12 }, (_, k) => `## Section ${k}\n\ntext ${k}\n\n${bigComment(20)}\n`).join(''), 250],
    ];
    for (const [text, max] of texts) {
      for (const windowBytes of [256, 700, 1500]) await feedEqualsOneShot(text, max, windowBytes);
      await feedEqualsOneShot(text, max, 524288);
    }
  });

  it('md parts comments: the comment candidates cost linear work (many openers, one closer far away)', () => {
    // Synthetic blocks: one paragraph, then a gap of 20 000 `<!--` lines closed by one `-->` at the end. The gap scan finds the
    // closer once; every candidate is one comment.
    const gap = '<!--\n'.repeat(20000) + '-->\n';
    const text = 'para\n\n' + gap + 'next\n';
    const blocks = [{ start: 0, end: 5, kind: 'other' as const }, { start: 6 + gap.length, end: text.length, kind: 'other' as const }];
    const probe = { chars: 0 };
    const { parts } = splitMarkdownPartsAt(text, 4000, blocks, null, probe);
    checkCover(text, parts, 4000);
    expect(probe.chars, 'work on a gap of 20 000 openers').toBeLessThanOrEqual(24 * text.length);
    // Openers with no closer in the gap are not comments at all and cost one search.
    const open = 'para\n\n' + '<!--\n'.repeat(20000) + 'next\n';
    const ob = [{ start: 0, end: 5, kind: 'other' as const }, { start: 6 + 5 * 20000, end: open.length, kind: 'other' as const }];
    const po = { chars: 0 };
    const cutOpen = splitMarkdownPartsAt(open, 4000, ob, null, po).parts;
    // (Since wave 64 the unit, which holds the openers, is one part: the conservative rule reads the text, closed or not.)
    coverByRule(open, cutOpen, 4000);
    for (const p of cutOpen) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    expect(po.chars, 'work on a gap of 20 000 unclosed openers').toBeLessThanOrEqual(24 * open.length);
  });
});

// ---- Wave 64: the conservative rule ---------------------------------------------------------------------------------------------
// The block cutter never cuts inside a unit (a top-level block and the text after it up to the next cut candidate, a list item or a
// quote's own block, a paragraph) whose text holds a comment opener `<!--`: such a unit, when it alone is larger than a part, goes
// whole into one part, above the part size. Cuts between units stay as they are, and a top-level comment is still closed and
// reopened as before (`cutComment`), the unit kept whole only where that cut has no room. Each leak case (`cutsByRule`) holds the
// library's render of the whole document as its control: what it hides no part shows, and what it shows the parts show as often. The
// cases on a part's shape and size (the fence, the dashes, a tail, the text before the first block, the gate's answer, the cost) hold
// the parts' bounds and offsets instead (review 4221 A2).

const GATE = DOCS_RENDER_GATE_BYTES;
const lines = (prefix: string, n: number, word = HIDDEN): string => `${prefix}${word} line\n`.repeat(n);

describe('the conservative rule: no cut inside a unit that holds a comment opener (wave 64, x2-fu-comments-in-parts)', { timeout: 600000 }, () => {
  it('md parts rule: at the real part size, a list item larger than a part that holds a comment is one part, and the next item its own', async () => {
    const text = '- item\n  <!--\n' + lines('  ', 34000) + '  -->\n- next\n';
    expect(utf8Bytes(text)).toBeGreaterThan(GATE);
    const parts = await cutsByRule(text, GATE, HIDDEN, 'next');
    // The item is kept whole, exactly: one part from its marker to the next item's, which the cut between items still starts.
    expect(parts.map((p) => [p.start, p.end]), 'the item whole, then the next item').toEqual([[0, text.indexOf('- next')], [text.indexOf('- next'), text.length]]);
    expect(utf8Bytes(partText(text, parts[0]!)), 'above the part size').toBeGreaterThan(GATE);
  });

  it('md parts rule: at the real part size, a quote larger than a part that holds a comment shows none of it', async () => {
    const text = '> Quoted.\n>\n> <!--\n' + lines('> ', 34000) + '> -->\n>\n> More quoted.\n\nAfter the quote.\n';
    expect(utf8Bytes(text)).toBeGreaterThan(GATE);
    await cutsByRule(text, GATE, HIDDEN, 'More');
  });

  it('md parts rule: at the real part size, a paragraph with text before the opener, and one with text after the first closer (the 576 089-byte old table)', async () => {
    const before = 'Intro paragraph.\n\nThe old version follows <!--\n' + lines('', 36000) + '-->\n\n# Next\n\ntext\n';
    expect(utf8Bytes(before)).toBeGreaterThan(GATE);
    await cutsByRule(before, GATE, HIDDEN, 'follows');
    const table = 'Intro paragraph.\n\n<!-- old table, kept for reference\n' + '| HIDDENW | old |\n'.repeat(32000) + '--> (removed 2026-11)\n\n# Next\n\ntext\n';
    expect(utf8Bytes(table)).toBe(576089);
    await cutsByRule(table, GATE, 'HIDDENW', 'removed');
  });

  it('md parts rule: at the real part size, an opener indented four columns, six, or by a tab, that continues a paragraph', async () => {
    for (const indent of ['    ', '      ', '\t']) {
      const text = 'An intro paragraph line\n' + indent + '<!--\n' + lines('', 36000) + '-->\n\n# Next\n\ntext\n';
      expect(utf8Bytes(text)).toBeGreaterThan(GATE);
      await cutsByRule(text, GATE, HIDDEN, 'intro');
    }
  });

  it('md parts rule: at the real part size, a closer line longer than a part (white space after a block comment\'s closer, and text after a paragraph\'s)', async () => {
    const block = 'Before.\n\n<!--\n' + lines('', 20000) + '-->' + ' '.repeat(GATE + 10) + '\n\nAfter.\n';
    await cutsByRule(block, GATE, HIDDEN, 'After');
    const para = 'Before.\n\n<!--\n' + lines('', 20000) + '--> shownword ' + 'tail '.repeat(120000) + '\n\nAfter.\n';
    await cutsByRule(para, GATE, HIDDEN, 'shownword');
  });

  it('md parts rule: at the real part size, a quote whose comment lines are lazy, and list items whose content column is past the marker and one space', async () => {
    await cutsByRule('> start\nlazy <!--\n' + lines('', 34000) + '--> after\n\nnext\n', GATE, HIDDEN, 'after');
    await cutsByRule('-   item shown\n      <!--\n' + lines('      ', 24000) + '      -->\n- next\n', GATE, HIDDEN, 'shown');
    await cutsByRule('10.  item shown\n       <!--\n' + lines('       ', 24000) + '       -->\n11. next\n', GATE, HIDDEN, 'shown');
  });

  it('md parts rule: the four container shapes P6.1 measured at 200 bytes (commented text in 4 of 5, 4 of 4, 4 of 4 and 4 of 5 parts) show none', async () => {
    await cutsByRule('- item\n  <!--\n' + lines('  ', 40) + '  -->\n- next\n', 200, HIDDEN, 'next');
    await cutsByRule('- item\n  <!--\n' + lines('  ', 40) + '  -->\n', 200, HIDDEN, 'item');
    await cutsByRule('> <!--\n' + lines('> ', 40) + '> -->\n', 200, HIDDEN);
    await cutsByRule('- item\n  ```js\n  z\n  ```\n  <!--\n' + lines('  ', 40) + '  -->\n', 200, HIDDEN, 'item');
  });

  it('md parts rule: every size, for the shapes wave 62 measured wrong at every size (a lazy quote, a wide list item, an opener after text)', async () => {
    const sweep = async (text: string, lo: number, hi: number, visible: string): Promise<void> => {
      for (let max = lo; max <= hi; max += 1) await cutsByRule(text, max, HIDDEN, visible);
    };
    // Wrong at 91 of 91 sizes, 111 of 111, and 111 of 111 for each opener, on the cutter before this rule.
    await sweep('> start\nlazy <!--\n' + lines('', 12) + '--> after\n\nnext\n', 30, 120, 'after');
    await sweep('-   item shown\n      <!--\n' + lines('      ', 12) + '      -->\n- next\n', 60, 170, 'shown');
    await sweep('Lead text here <!---> ' + HIDDEN + ' a\n' + lines('', 8) + '--> after\n\nEnd.\n', 40, 150, 'after');
    await sweep('Lead text here <!--> ' + HIDDEN + ' a\n' + lines('', 8) + '--> after\n\nEnd.\n', 40, 150, 'after');
  });

  it('md parts rule: every size from 30 to 130 bytes, an item, a quote, an opener on an item\'s marker line, and an opener indented four columns in a paragraph', async () => {
    const texts: [string, string][] = [
      ['- item\n  <!--\n' + lines('  ', 12) + '  -->\n- next\n', 'next'],
      ['> <!--\n' + lines('> ', 12) + '> -->\n\nAfter.\n', 'After'],
      ['- a <!-- ' + HIDDEN + ' x\n' + lines('  ', 8) + '  --> b\n- next\n', 'next'],
      ['para\n    <!--\n' + lines('', 12) + '-->\n\n# Next\n', 'Next'],
    ];
    for (const [text, visible] of texts) for (let max = 30; max <= 130; max += 1) await cutsByRule(text, max, HIDDEN, visible);
  });

  it('md parts rule: lines of dashes after a top-level comment whose closer line does not fit a part are never a part\'s first line (no front matter)', async () => {
    // The closer line, `-->` and 120 spaces, does not fit beside the `<!--` reopen line below 129 bytes: the comment is kept whole with
    // the dashes after it, where P1 used to cut and could start a part at `---` (the shown line lost at 52 of 171 sizes).
    const text = 'Before.\n\n<!--\n' + lines('', 4) + '-->' + ' '.repeat(120) + '\n---\n--- SHOWNW ---\n---\nend\n';
    for (let max = 24; max <= 200; max += 1) {
      const parts = await cutsByRule(text, max, HIDDEN, 'SHOWNW');
      for (const p of parts.slice(1)) expect(text.startsWith('---', p.start) && p.reopen === null, `max ${max}: a part starts at dashes`).toBe(false);
    }
  });

  it('md parts rule: cuts between units stay as they are (a list whose third item holds the comment: only that item is kept whole)', async () => {
    const item = (k: number): string => `- item ${k} ` + 'w'.repeat(150) + '\n';
    const text = item(1) + item(2) + '- item 3\n  <!--\n' + lines('  ', 20) + '  -->\n' + item(4) + item(5) + '\nAfter.\n';
    const parts = await cutsByRule(text, 200, HIDDEN, 'item');
    const starts = parts.map((p) => p.start);
    for (const k of [2, 3, 4, 5]) expect(starts, `a part starts at item ${k}`).toContain(text.indexOf(`- item ${k}`));
    const over = coverByRule(text, parts, 200);
    expect(over.map((i) => text.slice(parts[i]!.start, parts[i]!.end).startsWith('- item 3')), 'the one part above the size is item 3').toEqual([true]);
  });

  it('md parts rule: a fence larger than a part whose code holds `<!--` is kept whole too (the rule reads the text, not the parse)', async () => {
    const text = 'Intro.\n\n```html\n' + '<!-- a sample comment -->\n<p>x</p>\n'.repeat(20) + '```\n\nAfter.\n';
    const parts = await cut(text, 200);
    const over = coverByRule(text, parts, 200);
    expect(over.length, 'the fence is one part').toBe(1);
    expect(parts[over[0]!]!.reopen, 'not closed and reopened').toBeNull();
    // A fence with no opener is closed and reopened as before.
    const plain = 'Intro.\n\n```html\n' + '<p>a sample paragraph</p>\n<p>x</p>\n'.repeat(20) + '```\n\nAfter.\n';
    const pp = await cut(plain, 200);
    checkCover(plain, pp, 200);
    expect(pp.some((p) => p.reopen !== null), 'a fence with no opener is reopened').toBe(true);
  });

  it('md parts rule: no cut hides what the library shows (a `<!-->` line, a code span, an escape, a table, a blank line, a heading, a tight item\'s block)', async () => {
    const same = async (text: string): Promise<void> => {
      const parts = await cut(text, 120);
      coverByRule(text, parts, 120);
      const w = shown(text, 'SHOWNW');
      expect(w, 'CONTROL: the whole shows the marker').toBeGreaterThan(0);
      const per = parts.map((p) => shown(partText(text, p), 'SHOWNW'));
      expect(per.reduce((a, b) => a + b, 0), `per part: ${per.join(',')}`).toBe(w);
    };
    const shownLines = (n: number): string => 'SHOWNW line\n'.repeat(n);
    await same('para\n\n<!-->\n' + shownLines(30) + '-->\n\nEnd.\n');
    await same('- item\n  <!-->\n' + '  SHOWNW line\n'.repeat(30) + '  -->\n- next\n');
    await same('Some `<!--\n' + shownLines(30) + '-->` code\n\nEnd.\n');
    await same('Some \\<!--\n' + shownLines(30) + '-->\n\nEnd.\n');
    await same('| a | b |\n|---|---|\n| <!-- x | y |\n' + '| SHOWNW | z |\n'.repeat(30) + '| --> | w |\n\nEnd.\n');
    await same('para <!--\n\n' + shownLines(30) + '-->\n\nEnd.\n');
    await same('para <!--\n# SHOWNW head\n' + shownLines(30) + '-->\n\nEnd.\n');
    await same('- a <!--\n  <details>\n' + '  SHOWNW line\n'.repeat(30) + '  -->\n- next\n');
  });

  it('md parts rule: the cut fed window by window is the one-shot cut on the same blocks', async () => {
    const texts = [
      '- item\n  <!--\n' + lines('  ', 60) + '  -->\n- next\n',
      '> <!--\n' + lines('> ', 60) + '> -->\n\nAfter.\n',
      'Intro <!--\n' + lines('', 60) + '-->\n\n# Next\n',
      'Before.\n\n<!--\n' + lines('', 30) + '-->' + ' '.repeat(300) + '\n---\nend\n',
    ];
    for (const text of texts) for (const windowBytes of [256, 700, 1500]) await feedEqualsOneShot(text, 200, windowBytes);
  });

  it('md parts rule: the largest part the rule keeps whole is a blocks window (READER_BLOCKS_MAX_BYTES); a unit past it is the unread tail\'s', async () => {
    // A unit's two ends are cut candidates the same window confirmed, so it is at most one window of the blocks read, which doubles
    // up to READER_BLOCKS_MAX_BYTES. A list item just under it is one part of four render gates; one just over it ends the blocks
    // read at its start, and from there the line cutter cuts (P1's path, the unread tail).
    const item = (n: number): string => '- item\n  <!--\n' + lines('  ', n) + '  -->\n- next\n\nAfter.\n';
    const under = item(Math.floor((READER_BLOCKS_MAX_BYTES - 200) / 18));
    const parts = await cutsByRule(under, GATE, HIDDEN, 'After');
    const over = coverByRule(under, parts, GATE);
    expect(over, 'the item is the one part above the gate').toEqual([0]);
    const bytes = utf8Bytes(partText(under, parts[0]!));
    expect(bytes, 'above three render gates').toBeGreaterThan(3 * GATE);
    expect(bytes, 'within the blocks read\'s cap').toBeLessThan(READER_BLOCKS_MAX_BYTES);
    const past = item(Math.ceil((READER_BLOCKS_MAX_BYTES + 200) / 18));
    const read = await blocksOf(past);
    expect(read.tailFrom, 'the blocks read stops at the item').toBe(0);
    checkCover(past, splitMarkdownPartsAt(past, GATE, read.blocks, read.tailFrom).parts, GATE);
  });

  it('md parts rule: measured, the one shape past a window: blocks that each start with three dashes join the unit before them (no part starts at dashes), so one holding an opener is one part as long as the run', async () => {
    // (Paragraphs whose first line starts with `---`, a few hundred blocks: a run of `<hr>` lines this long is half a million blocks,
    // which the test slice's memory cap kills.)
    const dashed = '--- ' + 'w'.repeat(5000) + '\n\n';
    const text = 'A paragraph <!-- note --> with a comment.\n\n' + dashed.repeat(Math.ceil((READER_BLOCKS_MAX_BYTES + 100000) / dashed.length)) + 'end\n';
    const { blocks, tailFrom } = await blocksOf(text);
    expect(tailFrom, 'the blocks read covers the text').toBeNull();
    const parts = splitMarkdownPartsAt(text, GATE, blocks, tailFrom).parts;
    const over = coverByRule(text, parts, GATE);
    expect(over, 'the paragraph and its rules are one part').toEqual([0]);
    expect(utf8Bytes(partText(text, parts[0]!)), 'past the blocks read\'s window').toBeGreaterThan(READER_BLOCKS_MAX_BYTES);
    expect(text.slice(parts[1]!.start), 'the rest').toBe('end\n');
  });

  it('md parts rule: when the blocks stop at a block that starts with dashes, the unit before is kept whole only up to there, and the tail is still the line cutter\'s (review of wave 64)', async () => {
    // A paragraph of `--- w…` lines longer than the blocks read's cap: the read stops at it, and no candidate is made there (no part
    // starts at dashes), so the unit before runs on to the end. The rule reads that unit up to where the blocks stop.
    const dashed = ('--- ' + 'w'.repeat(76) + '\n').repeat(Math.ceil((READER_BLOCKS_MAX_BYTES + 100000) / 81)) + '\nend\n';
    const lead = 'A paragraph <!-- note --> with a comment.\n\n';
    const text = lead + dashed;
    const read = await blocksOf(text);
    expect(read.tailFrom, 'the blocks read stops at the dashes').toBe(lead.length);
    const parts = splitMarkdownPartsAt(text, GATE, read.blocks, read.tailFrom).parts;
    expect(coverByRule(text, parts, GATE), 'no part above the gate').toEqual([]);
    expect(parts[0]!.end, 'the paragraph with the opener is its own part').toBe(lead.length);
    expect(parts[1]!.reopen, 'the tail\'s first part begins with a blank line, not at dashes').toBe('\n');
    // A tail that starts at a line of three dashes alone, which the library reads as front matter at a part's start (synthetic
    // blocks: the read stopped there): the blank line keeps its text shown, as often as the whole document shows it.
    const fm = 'Lead <!-- note --> ' + 'w '.repeat(60) + '\n\n';
    const t3 = fm + '---\nSHOWNW words\n---\n' + 'more text line\n'.repeat(30);
    const p3 = splitMarkdownPartsAt(t3, 120, [{ start: 0, end: fm.length - 2, kind: 'other' }], fm.length).parts;
    coverByRule(t3, p3, 120);
    expect(p3[1]!.reopen).toBe('\n');
    expect(shown(t3, 'SHOWNW'), 'CONTROL: the whole shows it').toBeGreaterThan(0);
    expect(p3.reduce((n, p) => n + shown(partText(t3, p), 'SHOWNW'), 0), 'the parts show the line after the dashes').toBe(shown(t3, 'SHOWNW'));
    expect(shown(t3.slice(p3[1]!.start, p3[1]!.end), 'SHOWNW'), 'CONTROL: that part without its blank line shows none (front matter)').toBe(0);
    expect(parts.length, 'the tail is cut').toBeGreaterThan(3);
    // With the opener only in the tail and none before it, the cut is as before the rule: P1 cuts the unit (synthetic blocks).
    const plain = 'A paragraph with no comment.\n\n';
    const t2 = plain + ('--- x\n'.repeat(400)) + 'x <!-- y\n' + '--- z\n'.repeat(100);
    const p2 = splitMarkdownPartsAt(t2, 120, [{ start: 0, end: plain.length - 2, kind: 'other' }], plain.length).parts;
    checkCover(t2, p2, 120);
    expect(p2.length, 'cut by the line cutter').toBeGreaterThan(20);
    // Byte for byte as on main (review 4221 F2): main cut that unit, which runs into the tail, by the line cutter from the text's
    // start, as it cuts the whole text; the corpus digest reads only whole texts, so this is the case that holds this branch.
    expect(p2, 'the cut main makes: the line cutter over the whole text').toEqual(splitMarkdownParts(t2, 120).parts);
    // And a read that stopped at offset 0 on a text with no opener: the line cutter over the whole text, as on main.
    const t0 = '--- x\n'.repeat(300) + 'plain words\n'.repeat(40);
    expect(splitMarkdownPartsAt(t0, 120, [], 0).parts, 'tailFrom 0, no opener: as on main').toEqual(splitMarkdownParts(t0, 120).parts);
  });

  it('md parts rule: the part before such a tail is cut by the rule as any unit is: a top-level comment closed and reopened, a list cut between its items (review of wave 64)', () => {
    const tail = '---\n' + 'tail line\n'.repeat(30);
    // (A) The last candidate is a top-level comment, the tail right after its closer line (synthetic blocks: the read stopped there).
    const a = 'para\n\n' + bigComment(30);
    const ta = a + tail;
    const pa = splitMarkdownPartsAt(ta, 120, [{ start: 0, end: 5, kind: 'other' }], a.length).parts;
    expect(coverByRule(ta, pa, 120), 'no part above the size').toEqual([]);
    expect(pa.some((p) => p.reopen === '<!--\n'), 'the comment is closed and reopened').toBe(true);
    for (const p of pa) expect(outsideComments(partText(ta, p)), 'no comment text outside a comment').not.toContain(HIDDEN);
    expect(pa.find((p) => p.start === a.length)?.reopen, 'the tail begins after a blank line').toBe('\n');
    // (B) A list whose third item holds the comment, then the tail: cut between its items, only the third whole.
    const item = (k: number): string => `- item ${k} ` + 'w'.repeat(90) + '\n';
    const third = '- item 3\n  <!--\n' + lines('  ', 10) + '  -->\n';
    const b = item(1) + item(2) + third;
    const tb = b + tail;
    const at = (k: number): number => b.indexOf(`- item ${k}`);
    const items = [{ start: 0, end: at(2), kind: 'other' as const }, { start: at(2), end: at(3), kind: 'other' as const }, { start: at(3), end: b.length, kind: 'other' as const }];
    const pb = splitMarkdownPartsAt(tb, 120, [{ start: 0, end: b.length, kind: 'list', items }], b.length).parts;
    const over = coverByRule(tb, pb, 120);
    expect(pb.map((p) => p.start), 'a part starts at items 2 and 3').toEqual(expect.arrayContaining([at(2), at(3)]));
    expect(over.map((i) => pb[i]!.start), 'only the third item is above the size').toEqual([at(3)]);
  });

  it('md parts rule: a part above the gate gets the gate\'s answer: the render job refuses it, and the console\'s own view (Format anyway) shows a comment as text', () => {
    // What a part kept whole above the gate gets is what any Markdown above the gate gets: no render (so no frame and none of its caps),
    // and the console's view when the reader asks for it, which draws raw HTML as text, a comment's words with it.
    const part = '- item\n  <!--\n' + lines('  ', 34000) + '  -->\n';
    expect(utf8Bytes(part)).toBeGreaterThan(GATE);
    const job: ReaderRenderReply[] = [];
    answerRenderJob({ id: 1, kind: 'render', src: part }, (r) => { job.push(r); });
    expect(job[0]!.outcome, 'the reader\'s render job').toEqual({ kind: 'not-rendered', why: 'over-limit' });
    const view = parseMarkdown(part, 'docs');
    expect(view.kind, 'the console\'s parse').toBe('tree');
    expect(JSON.stringify(view.kind === 'tree' ? view.tree : null), 'the console\'s view shows the comment\'s words').toContain(HIDDEN);
  });

  it('md parts rule: text before the first block that holds an opener is one part, and the unread tail is still the line cutter\'s (synthetic blocks)', () => {
    // Synthetic blocks: the text the library draws no block for before the first one (an opener after text on its line is no comment
    // candidate), and the same text as the unread tail, from where the blocks stop.
    const lead = 'x <!-- ' + HIDDEN + '\n' + lines('', 20) + '-->\n';
    const text = lead + 'para\n';
    const before = splitMarkdownPartsAt(text, 120, [{ start: lead.length, end: text.length, kind: 'other' }], null).parts;
    expect(coverByRule(text, before, 120), 'the lead is one part').toEqual([0]);
    expect(before[0]!.end).toBe(lead.length);
    const tail = 'para\n\n' + lead;
    const raw = splitMarkdownPartsAt(tail, 120, [{ start: 0, end: 5, kind: 'other' }], 6).parts;
    checkCover(tail, raw, 120);
    expect(raw.length, 'the unread tail is cut by the line cutter, as before').toBeGreaterThan(2);
  });

  it('md parts rule: the opener test costs linear work (a list of 300 items larger than a part, each holding an opener, and one nested in a quote)', () => {
    const itemText = '- item\n' + '  text line\n'.repeat(400) + '  <!-- x -->\n';
    const n = 300;
    const text = itemText.repeat(n) + '\nAfter.\n';
    const items = Array.from({ length: n }, (_, k) => ({ start: k * itemText.length, end: (k + 1) * itemText.length, kind: 'other' as const }));
    const blocks = [{ start: 0, end: n * itemText.length, kind: 'list' as const, items }, { start: n * itemText.length + 1, end: text.length, kind: 'other' as const }];
    const probe = { chars: 0 };
    const { parts } = splitMarkdownPartsAt(text, 4000, blocks, null, probe);
    expect(coverByRule(text, parts, 4000).length, 'each item whole').toBe(n);
    expect(probe.chars, 'work on 300 oversize items with an opener').toBeLessThanOrEqual(24 * text.length);
    // The same paragraphs as a quote's own blocks, the quote holding a one-item list at its end.
    const para = '> ' + 'quoted text line\n> '.repeat(300) + '<!-- x -->\n>\n';
    const quoted = para.repeat(n) + '> - an item\n\nAfter.\n';
    const listAt = n * para.length;
    const own = [
      ...Array.from({ length: n }, (_, k) => ({ start: k * para.length, end: (k + 1) * para.length - 2, kind: 'other' as const })),
      { start: listAt, end: listAt + 12, kind: 'list' as const, items: [{ start: listAt, end: listAt + 12, kind: 'other' as const }] },
    ];
    expect(quoted.slice(listAt, listAt + 12)).toBe('> - an item\n');
    const qb = [{ start: 0, end: listAt + 12, kind: 'quote' as const, items: own }, { start: listAt + 13, end: quoted.length, kind: 'other' as const }];
    const pq = { chars: 0 };
    const qp = splitMarkdownPartsAt(quoted, 4000, qb, null, pq).parts;
    expect(coverByRule(quoted, qp, 4000).length, 'each of the quote\'s paragraphs whole').toBe(n);
    expect(pq.chars, 'work on a quote of 300 oversize paragraphs with an opener').toBeLessThanOrEqual(24 * quoted.length);
  });
});

// ---- Wave 64: a document with no comment opener is cut as on main ---------------------------------------------------------------
// The rule acts only on a unit whose text holds `<!--`. A document with none is cut byte for byte as `main` cut it at 3fd477ee57:
// the digest of every part of a seeded corpus (the residual classes' shapes, near misses of an opener, and documents at the real part
// size) at five sizes was measured on that cutter before the rule was written, and is pinned here.
describe('a document with no comment opener is cut as before the rule (wave 64)', { timeout: 600000 }, () => {
  /** FNV-1a, 32 bits, over the code units of `s`. */
  const fnv = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  /** mulberry32, seeded. */
  const prng = (seed: number): (() => number) => {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const corpus = (): string[] => {
    const rnd = prng(20261128);
    const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
    const words = (n: number): string => Array.from({ length: n }, () => pick(['alpha', 'beta', 'gamma', 'lorem', 'ipsum', 'x', 'data'])).join(' ');
    const near = (): string => pick(['Text <!- not one -->', '<!DOCTYPE html>', 'a --> b', '<! -- spaced', '&lt;!-- escaped', '<!-', '-->']);
    const piece = (): string => {
      const r = int(0, 11);
      if (r === 0) return `${pick(['#', '##', '###'])} ${words(int(1, 4))}\n`;
      if (r === 1) return Array.from({ length: int(1, 30) }, () => words(int(2, 9)) + '\n').join('');
      if (r === 2) return words(4) + '\n' + Array.from({ length: int(1, 12) }, () => '    ' + words(3) + '\n').join('');
      if (r === 3) return Array.from({ length: int(1, 8) }, () => `${pick(['-', '*', '1.', '10.'])}${pick([' ', '   '])}${words(3)}\n` + (rnd() < 0.3 ? '  ```js\n' + '  code ' + near() + '\n'.repeat(1) + '  ```\n' : '') + (rnd() < 0.3 ? 'lazy ' + words(2) + '\n' : '')).join('');
      if (r === 4) return Array.from({ length: int(1, 20) }, () => (rnd() < 0.2 ? 'lazy ' : '> ') + words(3) + '\n').join('');
      if (r === 5) return '```' + pick(['', 'js', 'html']) + '\n' + Array.from({ length: int(1, 40) }, () => pick([words(3), near(), '', '# not a heading']) + '\n').join('') + '```\n';
      if (r === 6) return '| a | b |\n|---|---|\n' + Array.from({ length: int(1, 20) }, () => `| ${words(1)} | ${words(2)} |\n`).join('');
      if (r === 7) return '---\n';
      if (r === 8) return '\n';
      if (r === 9) return '<details>\n<summary>' + words(2) + '</summary>\n\n' + words(5) + '\n\n</details>\n';
      if (r === 10) return near() + '\n';
      return '> ```py\n' + Array.from({ length: int(1, 15) }, () => '> ' + words(2) + '\n').join('') + '> ```\n';
    };
    const docs: string[] = [];
    for (let d = 0; d < 80; d += 1) docs.push(Array.from({ length: int(3, 25) }, () => piece() + (rnd() < 0.6 ? '\n' : '')).join(''));
    // At the real part size: a long list item, a long quote, a long paragraph and a long fence, none with an opener.
    docs.push('- item\n' + '  plain line of the item\n'.repeat(26000) + '- next\n');
    docs.push('> ' + 'a quoted line of text\n> '.repeat(26000) + 'end\n\nAfter.\n');
    docs.push('Lead line\n' + '    a continued line\n'.repeat(30000) + '\n# Next\n');
    docs.push('```js\n' + 'const a = "-->"; // <!- near\n'.repeat(20000) + '```\n\nAfter.\n');
    return docs;
  };

  it('md parts rule: the corpus has no opener, and its cut at 40, 80, 150, 300 and 700 bytes and at the gate is the digest measured on main', async () => {
    const docs = corpus();
    let all = '';
    let count = 0;
    for (const text of docs) {
      expect(text.includes('<!--'), 'the corpus holds no comment opener').toBe(false);
      const { blocks, tailFrom } = await blocksOf(text);
      for (const max of [40, 80, 150, 300, 700, GATE]) {
        const { parts } = splitMarkdownPartsAt(text, max, blocks, tailFrom);
        count += parts.length;
        all += JSON.stringify(parts) + '\n';
      }
    }
    expect(count, 'CONTROL: the corpus is cut into many parts').toBeGreaterThan(docs.length * 6 * 4);
    // Measured on main at 3fd477ee57, before the rule (wave 64). The digest reads the library's blocks too: a new library pin may
    // change it with no change of the cutter; then measure it again on the cutter before the change, never on the one after it.
    expect(fnv(all).toString(16), `the digest of ${docs.length} documents at six sizes`).toBe('8eb520e2');
  });
});

// ---- Wave 64, item 2: P1's own paths, measured against the rule, and the one cure built ----------------------------------------
// The line cutter reads no comment, and it alone cuts three paths: the unread tail (the blocks were not read from there), the whole
// text after the block cutter throws, and the console with no render job. Each is MEASURED here against the rule's cut (logged, with
// the fit and the cover asserted); the plan's Results carry the numbers and why only one is cured: a tail that starts at a closed
// top-level comment, a comment unit since this wave. The console's own view shows a comment as text whole or cut (the case "a part
// above the gate gets the gate's answer"), so on screen the cut changes nothing there.
describe('P1\'s own paths, measured against the rule (wave 64, item 2)', { timeout: 600000 }, () => {
  const shownParts = (text: string, parts: readonly MdPart[]): number[] => parts.map((p) => shown(partText(text, p), HIDDEN));
  const job: BlocksJob = async (src, o) => {
    let out: ReaderRenderOutcome | null = null;
    answerRenderJob({ id: 1, kind: 'render', src, blocks: o.blocks }, (r) => { out = r.outcome; });
    return out!;
  };

  it('md parts P1 paths: the line cutter alone (the fallback after a throw, no render job) and the block cutter under the rule, at 200 bytes and at the gate', async () => {
    const shapes: [string, string, number][] = [
      ['top-level comment', 'para\n\n<!--\n' + lines('', 40) + '-->\n\n# Next\n', 200],
      ['list item', '- item\n  <!--\n' + lines('  ', 40) + '  -->\n- next\n', 200],
      ['quote', '> <!--\n' + lines('> ', 40) + '> -->\n', 200],
      ['paragraph, text after the closer', 'para\n\n<!--\n' + lines('', 40) + '--> tail\n', 200],
      ['list item at the gate', '- item\n  <!--\n' + lines('  ', 34000) + '  -->\n- next\n', GATE],
      ['quote at the gate', '> <!--\n' + lines('> ', 34000) + '> -->\n\nAfter.\n', GATE],
    ];
    for (const [name, text, max] of shapes) {
      const p1 = splitMarkdownParts(text, max).parts;
      checkCover(text, p1, max);
      const rule = await cut(text, max);
      coverByRule(text, rule, max);
      const ruleShown = shownParts(text, rule);
      expect(ruleShown.every((n) => n === 0), `${name}: the block cutter under the rule shows none`).toBe(true);
      const p1Shown = shownParts(text, p1);
      // The residual, pinned as measured: the line cutter alone shows hidden text (a cure of these paths would flip this line).
      expect(p1Shown.some((n) => n > 0), `${name}: the line cutter alone shows hidden text`).toBe(true);
      console.info(`md parts P1 paths: ${name}: ${utf8Bytes(text)} bytes at ${max}: the line cutter's ${p1.length} parts show hidden lines ${p1Shown.join(',')} (${p1Shown.filter((n) => n > 0).length} parts); the rule's ${rule.length} parts show none`);
    }
  });

  it('md parts P1 paths: the unread tail, for real: a top-level comment past the blocks read\'s cap ends the read at its start, and is closed and reopened, not cut by the line cutter (item 2\'s cure)', async () => {
    const big = 'Intro.\n\n<!--\n' + lines('', 140000) + '-->\n\n# Next\n\ntext\n';
    const { tailFrom } = await blocksOf(big);
    expect(tailFrom, 'the blocks read stops at the comment').toBe(8);
    const parts = await cutMarkdownText(big, job, new AbortController().signal);
    checkCover(big, parts, GATE);
    expect(parts[0]!.end, 'the intro, then the comment from its opener').toBe(8);
    expect(parts.filter((p) => p.reopen === '<!--\n').length, 'the comment is reopened in each part after its first').toBeGreaterThan(2);
    const per = shownParts(big, parts);
    expect(per.every((n) => n === 0), `no part shows the comment (per part: ${per.join(',')}; before the cure the line cutter showed all 140 000 lines)`).toBe(true);
    expect(parts.reduce((n, p) => n + shown(partText(big, p), 'Next'), 0), 'the heading after it shows').toBe(1);
  });

  it('md parts P1 paths: a tail that starts at a closed top-level comment is a comment unit, the rest after it the unread tail (synthetic blocks: the read stopped there)', () => {
    const run = (text: string, blocks: readonly TextBlock[], tailFrom: number, max: number): MdPart[] => {
      const parts = splitMarkdownPartsAt(text, max, blocks, tailFrom).parts;
      checkCover(text, parts, max);
      for (const p of parts) expect(outsideComments(partText(text, p)), `max ${max}: no comment text outside a comment`).not.toContain(HIDDEN);
      return parts;
    };
    // After a block, and at the text's start (the read stopped at offset 0).
    const a = 'Intro.\n\n' + bigComment(40) + '# Next\n\ntext\n';
    const pa = run(a, [{ start: 0, end: 6, kind: 'other' }], 8, 200);
    expect(pa.some((p) => p.reopen === '<!--\n'), 'closed and reopened').toBe(true);
    expect(pa.some((p) => a.startsWith('# Next', p.start) || a.startsWith('\n# Next', p.start)), 'the rest after the comment is cut on its own').toBe(true);
    const b = bigComment(40) + 'After.\n';
    run(b, [], 0, 200);
    // Followed by lines of dashes: the rest begins after a blank line, never at the dashes (front matter).
    const c = 'Intro.\n\n' + bigComment(40) + '---\nSHOWNW line\n---\n' + 'more\n'.repeat(60);
    const pc = run(c, [{ start: 0, end: 6, kind: 'other' }], 8, 200);
    expect(pc.reduce((n, p) => n + shown(partText(c, p), 'SHOWNW'), 0), 'the line after the dashes shows').toBe(shown(c, 'SHOWNW'));
    // A closer line with text after it is no block comment (the library reads a paragraph): the tail is the line cutter's, as before.
    const d = 'Intro.\n\n<!--\n' + lines('', 40) + '--> tail words\n\nEnd.\n';
    const pd = splitMarkdownPartsAt(d, 200, [{ start: 0, end: 6, kind: 'other' }], 8).parts;
    checkCover(d, pd, 200);
    expect(pd.some((p) => p.reopen === '<!--\n'), 'not closed and reopened').toBe(false);
    // CRLF line ends give the same shape.
    const e = a.replace(/\n/g, '\r\n');
    const pe = run(e, [{ start: 0, end: 6, kind: 'other' }], e.indexOf('<!--'), 200);
    expect(pe.some((p) => p.reopen === '<!--\n'), 'CRLF: closed and reopened').toBe(true);
    // `<!-->` closes on its own line (the library shows what follows): a one-line unit, the rest the line cutter's.
    const f = 'Intro.\n\n<!-->\n' + 'SHOWNW line\n'.repeat(40) + '-->\n\nEnd.\n';
    const pf = splitMarkdownPartsAt(f, 200, [{ start: 0, end: 6, kind: 'other' }], 8).parts;
    checkCover(f, pf, 200);
    expect(pf.reduce((n, p) => n + shown(partText(f, p), 'SHOWNW'), 0), '`<!-->`: every shown line shows').toBe(shown(f, 'SHOWNW'));
    // A closer line that does not fit a part beside the reopen line: no comment unit (it would be one part as long as itself).
    const g = 'Intro.\n\n<!--\n' + lines('', 40) + '-->' + ' '.repeat(300) + '\n\nEnd.\n';
    const pg = splitMarkdownPartsAt(g, 200, [{ start: 0, end: 6, kind: 'other' }], 8).parts;
    checkCover(g, pg, 200);
    // Fed as the incremental cutter is, the cut is the one-shot cut.
    for (const [text, tailFrom, blocks] of [[a, 8, [{ start: 0, end: 6, kind: 'other' as const }]], [b, 0, []], [c, 8, [{ start: 0, end: 6, kind: 'other' as const }]]] as const) {
      const m = new MarkdownCutter(text, 200);
      const got = [...m.feed(blocks, tailFrom), ...m.finish(tailFrom)];
      expect(got, `incremental at tailFrom ${tailFrom}`).toEqual(splitMarkdownPartsAt(text, 200, blocks, tailFrom).parts);
    }
  });

  it('md parts P1 paths: a tail comment whose closer line is exactly what fits beside the reopen line is cut, not the line cutter\'s (review 4221 A4)', () => {
    // The bound is `cutComment`'s: the reopen line and the closer's line, its terminator counted, at most a part. At 120 bytes a
    // closer line of 115 bytes fits, with an LF end (`-->`, 111 spaces, LF) and with no terminator at the text's end (112 spaces).
    // With a CRLF end (110 spaces, the terminator's two bytes counted) and a lone CR end (111 spaces), the text's lines in the same
    // terminator (review 4228 A2).
    const head = 'Intro.\n\n<!--\n' + lines('', 40);
    for (const [name, text] of [
      ['an LF end', head + '-->' + ' '.repeat(111) + '\n'],
      ['no terminator', head + '-->' + ' '.repeat(112)],
      ['a CRLF end', head.replace(/\n/g, '\r\n') + '-->' + ' '.repeat(110) + '\r\n'],
      ['a lone CR end', head.replace(/\n/g, '\r') + '-->' + ' '.repeat(111) + '\r'],
    ] as const) {
      const at = text.indexOf('<!--');
      const parts = splitMarkdownPartsAt(text, 120, [{ start: 0, end: 6, kind: 'other' }], at).parts;
      checkCover(text, parts, 120);
      expect(parts.some((p) => p.reopen === '<!--\n'), `${name}: closed and reopened`).toBe(true);
      const per = parts.map((p) => shown(partText(text, p), HIDDEN));
      expect(per.every((n) => n === 0), `${name}: no part shows the comment (per part: ${per.join(',')})`).toBe(true);
      // One byte more and the closer line does not fit: the tail is the line cutter's, as before (not closed and reopened).
      const over = text.replace('-->', '--> ');
      const po = splitMarkdownPartsAt(over, 120, [{ start: 0, end: 6, kind: 'other' }], at).parts;
      checkCover(over, po, 120);
      expect(po.some((p) => p.reopen === '<!--\n'), `${name}, one byte over: not closed and reopened`).toBe(false);
    }
  });
});

// ---- Wave 64, fix round 1 (review 4221 F1): a comment opened in a footnote definition ----------------------------------------------
// The footnote rule reads a definition's lines with the document's end as theirs, so `[^1]: <!--` hides everything up to its closer,
// top-level headings included, as a comment opened in a list item does. In a blocks window that does not hold the closer, the opener is
// footnote text and the lines after it ordinary blocks, so the window must end before the definition, as it does before a list item
// that opens one (`containerPrefix` reads the label `[^label]:` as a container prefix).

describe('a comment opened in a footnote definition (wave 64, fix round 1, review 4221 F1)', { timeout: 600000 }, () => {
  const region = (n: number): string => '\n\n' + '# Private heading\n\nSECRETW one\n\n'.repeat(n) + '-->\n\nPublic end.\n';
  const filler = 'lorem ipsum dolor sit amet\n\n'.repeat(14300);

  it('md parts footnote: at the real part size, a footnote definition\'s comment across the blocks window\'s end shows none of it, both forms, with and without a reference', async () => {
    const forms: [string, string][] = [
      ['a definition', 'Intro.\n\n' + filler + '[^1]: <!-- private' + region(9400)],
      ['a referenced definition', 'Intro[^1].\n\n' + filler + '[^1]: <!-- private' + region(9400)],
      ['a definition in a list item', 'Intro.\n\n' + filler + '- [^1]: <!-- private' + region(9400)],
      ['a referenced definition in a list item', 'Intro[^1].\n\n' + filler + '- [^1]: <!-- private' + region(9400)],
      // Its first line draws no block, so its block starts at the opener's indented line (review of fix round 1, measured: two
      // parts showed all 9 400 hidden lines).
      ['a referenced definition with an empty first line', 'Intro.\n\n' + filler + 'See[^1].\n\n[^1]:\n    <!--' + region(9400)],
    ];
    for (const [name, text] of forms) {
      const opener = text.indexOf('<!--');
      expect(opener, `${name}: the opener is inside the first window`).toBeLessThan(GATE);
      expect(text.indexOf('-->'), `${name}: the closer is past it`).toBeGreaterThan(GATE);
      const parts = await cutsByRule(text, GATE, 'SECRETW', 'Public');
      expect(parts.some((p) => text.startsWith('# Private', p.start)), `${name}: no part starts at a heading in the comment`).toBe(false);
    }
  });

  it('md parts footnote: the shapes that hide past their own container read as one comment across every window, and cut with none shown', async () => {
    // Measured on the library: each hides the marker in the whole render. A window that ends inside one confirms only the blocks
    // before it, so the blocks are the whole read's at every window size, and a cut at 700 bytes shows none.
    const lead = 'lorem ipsum dolor sit amet\n\n'.repeat(70);
    const body = (n: number): string => '\n\n' + '## Private heading\n\nSECRETW one\n\n'.repeat(n) + '-->\n\nPublic end.\n';
    const shapes: [string, string][] = [
      ['a footnote definition', '[^1]: <!-- note'],
      ['its label, then the opener with no space', '[^n]:<!--'],
      ['a label of other characters', '[^a.b_c-1]: <!--'],
      ['a label that holds an opener, then an opener', '[^a<!--b]: <!--'],
      ['indented by two spaces', '  [^1]: <!--'],
      ['a list marker inside the definition', '[^1]: - <!--'],
      ['in a list item', '- [^1]: <!--'],
      ['an opener on a later line of the definition', '[^1]: note\n\n    <!--'],
      ['an opener on a later line of a referenced definition', 'See[^1].\n\n[^1]: note\n\n    <!--'],
      // A named definition whose first line draws no block: its block starts at the opener's own line (review of fix round 1).
      ['a referenced definition with an empty first line', 'See[^1].\n\n[^1]:\n    <!--'],
      ['a referenced definition with an empty first line, the opener after a tab', 'See[^1].\n\n[^1]:\n\t<!--'],
      ['a referenced definition, a blank line, then the opener', 'See[^1].\n\n[^1]:\n\n    <!--'],
      ['a referenced definition whose first line is a closed comment', 'See[^1].\n\n[^1]: <!-- a -->\n\n    <!--'],
      ['a referenced definition whose first line is a link reference definition', 'See[^1].\n\n[^1]: [a]: /u\n\n    <!--'],
      ['a list item\'s first line', '- <!--'],
      ['a list item\'s later line', '- item\n\n  <!--'],
      ['a details line, then the opener', '<details>\n<!--'],
    ];
    for (const [name, open] of shapes) {
      const referenced = open.startsWith('See[^1]');
      const text = lead + open + body(40) + 'after the comment.\n\n'.repeat(60);
      expect(shown(text, 'SECRETW'), `${name}: the library hides it in the whole`).toBe(0);
      const whole = await blocksOf(text, READER_BLOCKS_MAX_BYTES);
      for (const w of [1024, 2048, 3000]) {
        const small = await blocksOf(text, w);
        // A definition whose reference stands in an earlier window is drawn in no block in its own (the window does not hold the
        // reference), so for that shape the blocks are not the whole read's, by the windows and not by the comment; the cut below
        // still shows none.
        if (!referenced) expect(small, `${name}: window ${w}`).toEqual(whole);
        const [o, c] = [text.indexOf('<!--', lead.length), text.indexOf('-->', lead.length)];
        const inside = small.blocks.filter((b) => b.start > o && b.start <= c).map((b) => `${b.start}:${b.kind}`);
        expect(inside, `${name}: window ${w}: no block starts inside the comment`).toEqual([]);
        const parts = splitMarkdownPartsAt(text, 700, small.blocks, small.tailFrom).parts;
        coverByRule(text, parts, 700);
        const per = parts.map((p) => shown(partText(text, p), 'SECRETW'));
        expect(per.every((n) => n === 0), `${name}: window ${w}: no part shows it (per part: ${per.join(',')})`).toBe(true);
      }
    }
  });

  it('md parts footnote: KNOWN LEAK, ticket x2-fu-footnote-item-block-start: a named definition whose first line draws no block, then content indented under it, then an opener, shows the comment (pinned as it is today; the cure turns this case over)', async () => {
    // Measured by the round's review and the worker: the whole render hides all 40 hidden lines, and every part size measured (400,
    // 700, 2 000 bytes and the gate) shows all of them, with the whole text read in one window too. The cause is the blocks, and both
    // paths follow from it: the render's tree takes a footnote item's block from its inner blocks, so when the label line draws none
    // the definition's block starts at its first drawn line, indented four columns, which is a cut candidate that a part starting
    // there reads as code, and a window's cap lands at that start, so the next window reads the comment's inner lines as blocks.
    // Older than wave 64.
    // The control (a first line that draws a block) shows none. This case passes while the leak stands: green here is NOT closed.
    const lead = 'lorem ipsum dolor sit amet\n\n'.repeat(70);
    const body = '\n\n' + '## Private heading\n\nSECRETW one\n\n'.repeat(40) + '-->\n\nPublic end.\n';
    const sum = (text: string, blocks: readonly TextBlock[], tf: number | null, max: number): number =>
      splitMarkdownPartsAt(text, max, blocks, tf).parts.reduce((n, p) => n + shown(partText(text, p), 'SECRETW'), 0);
    const forms = ['See[^1].\n\n[^1]:\n    para\n\n    <!--', 'See[^1].\n\n[^1]:\n    - a\n\n      <!--', 'See[^1].\n\n[^1]:\n    - a\n    - <!--', 'See[^1].\n\n[^1]:\n\tpara\n\n\t<!--', 'See[^1].\n\n[^1]:\n    - <!--', 'See[^1].\n\n[^1]: <!-- a -->\n\n    para\n\n    <!--', 'See[^1].\n\n[^1]: [a]: /u\n\n    para\n\n    <!--', 'See[^1].\n\n[^1]:\n    > q\n\n    <!--',
      // First lines the render draws no block for (review 4228 A1): a `<details>`, `</details>` or `<summary>` line.
      'See[^1].\n\n[^1]: <details>\n    para\n\n    <!--', 'See[^1].\n\n[^1]: </details>\n    para\n\n    <!--', 'See[^1].\n\n[^1]: <summary>x</summary>\n    para\n\n    <!--'];
    for (const open of forms) {
      const text = lead + open + body + 'after the comment.\n\n'.repeat(60);
      expect(shown(text, 'SECRETW'), `${JSON.stringify(open)}: the library hides it in the whole`).toBe(0);
      const whole = await blocksOf(text, READER_BLOCKS_MAX_BYTES);
      const w1024 = await blocksOf(text, 1024);
      for (const [label, got] of [['whole read, 700', sum(text, whole.blocks, whole.tailFrom, 700)], ['whole read, 2000', sum(text, whole.blocks, whole.tailFrom, 2000)], ['window 1024, 700', sum(text, w1024.blocks, w1024.tailFrom, 700)]] as const) {
        expect(got, `${JSON.stringify(open)}, ${label}: KNOWN LEAK (x2-fu-footnote-item-block-start), all 40 shown`).toBe(40);
      }
    }
    const control = lead + 'See[^1].\n\n[^1]: note\n\n    para\n\n    <!--' + body + 'after the comment.\n\n'.repeat(60);
    const cw = await blocksOf(control, READER_BLOCKS_MAX_BYTES);
    expect(sum(control, cw.blocks, cw.tailFrom, 700), 'CONTROL: a first line that draws a block shows none').toBe(0);
  });

  it('md parts footnote: adjacent definitions, today\'s window bound (the start of the block before the opener), told from the end of it (review 4228 F1)', async () => {
    // This records the bound the tip uses, not a claim that it is the better one: on adjacent definitions the end of the block
    // before the opener matches the whole read where the start does not, and neither shows hidden text (review 4228: 308 of 2 640
    // runs differ); whether the end is the better bound is weighed in the wave of ticket x2-fu-footnote-item-block-start.
    const body = '\n\n' + '## Private heading\n\nSECRETW one\n\n'.repeat(40) + '-->\n\nPublic end.\n';
    const a = 'x\n\nSee[^1][^2].\n\n[^1]: a\n[^2]:\n    <!--' + body;
    const wa = await blocksOf(a, READER_BLOCKS_MAX_BYTES);
    expect(splitMarkdownPartsAt(a, 300, wa.blocks, wa.tailFrom).parts.map((p) => p.start).slice(0, 3), 'the whole read: a part starts at [^1]').toEqual([0, 17, 1366]);
    const b = 'x\n\nSee[^1][^2].\n\n[^1]:\n    x\n[^2]:\n    <!--' + body;
    const wb = await blocksOf(b, READER_BLOCKS_MAX_BYTES);
    expect(wb.blocks.find((k) => k.start === 23)?.kind, 'the whole read: [^1]\'s block is not code').toBe('other');
    for (const w of [256, 1024]) {
      const sa = await blocksOf(a, w);
      const pa = splitMarkdownPartsAt(a, 300, sa.blocks, sa.tailFrom).parts;
      expect(sa.blocks.some((k) => k.start === 17), `window ${w}: today's bound drops [^1]'s block (the next window lacks its reference)`).toBe(false);
      expect(pa.map((p) => p.start).slice(0, 3), `window ${w}: today's cut`).toEqual([0, 3, 1366]);
      expect(pa.reduce((n, p) => n + shown(partText(a, p), 'SECRETW'), 0), `window ${w}: no hidden text shown`).toBe(0);
      const sb = await blocksOf(b, w);
      expect(sb.blocks.find((k) => k.start === 23)?.kind, `window ${w}: today's bound reads [^1]'s indented line as code`).toBe('code');
      expect(splitMarkdownPartsAt(b, 300, sb.blocks, sb.tailFrom).parts.reduce((n, p) => n + shown(partText(b, p), 'SECRETW'), 0), `window ${w}: no hidden text shown`).toBe(0);
    }
  });

  it('md parts footnote: measured, the shapes whose opener the library confines to its own line or container need no cure', () => {
    // The library shows the marker after each of these (its comment ends with its container, or is no comment), so a cut after the
    // container cannot hide what the whole shows: a quote, a table cell, a link reference definition (its destination or title),
    // a definition-list shape (no such plugin), a heading, and text before the opener in a paragraph.
    const body = '\n\n# Private heading\n\nSECRETW one\n\n-->\n\nPublic end.\n';
    for (const open of ['> <!--', '> [^1]: <!--', '| a |\n|---|\n| <!-- |', '[a]: <!--', '[a]: /u "<!--', 'Term\n: <!--', '# <!--', 'Intro <!--']) {
      expect(shown('Intro.\n\n' + open + body, 'SECRETW'), `${JSON.stringify(open)}: the library shows what follows`).toBeGreaterThan(0);
    }
  });
});
