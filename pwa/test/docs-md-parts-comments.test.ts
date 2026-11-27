// X2 P6.1 review F3: a closed HTML comment (`<!-- ... -->`) at the top level is its OWN cut candidate in the block cutter. The
// library draws no block for it (`pwa-lib`'s `blockComment`), so before this a comment joined the unit of the block before it, and
// when that unit was larger than a part the line cutter cut INSIDE the comment and commented-out text showed. The cases render
// through the real library (the worker's own blocks job, `mdPartsJudge.ts`) and hold each part against the library's render: no
// word of a comment shows in any part.
import { render } from '@synapsium-labs/pinax-lib/render';
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../../shared/utf8';
import { collectMdBlocks, MarkdownCutter, partText, splitMarkdownPartsAt, type MdPart } from '../src/docs/range/mdParts';
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

/** `s` without its closed comments (`<!--` up to the first `-->`): what is left of a part's text outside every comment. */
const outsideComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

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
      expect((src.match(/<!--/g) ?? []).length, 'every comment a part holds is whole').toBe((src.match(/-->/g) ?? []).length);
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

  it('md parts comments: a closer line too long to fit a part beside the reopen line leaves the comment to P1, every part still in size (class 10)', async () => {
    // The closer and the rest of its line always end the comment's last part, whole, after `<!--`: when the two do not fit one
    // part, the comment is not cut as one (`cutComment` answers null) and P1 cuts the unit. Its hidden text may show then (residual
    // class 10, ticket x2-fu-comment-in-container); what this pins is the size of every part.
    const long = 'Before.\n\n<!--\n' + 'hiddenword line\n'.repeat(6) + '-->' + ' '.repeat(60) + '\n\nAfter.\n';
    for (let max = 24; max <= 70; max += 1) checkCover(long, await cut(long, max), max);
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
        expect((src.match(/<!--/g) ?? []).length, `max ${max}: an opener in a part is closed in it`).toBe((src.match(/-->/g) ?? []).length);
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
    const parts = splitMarkdownPartsAt(text, 120, blocks, null).parts;
    checkCover(text, parts, 120);
    for (const p of parts) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    const indented = 'para\n\n    <!--\n' + 'plain line\n'.repeat(40) + '    -->\nnext\n';
    const ib = [{ start: 0, end: 5, kind: 'other' as const }, { start: indented.length - 5, end: indented.length, kind: 'other' as const }];
    const ip = splitMarkdownPartsAt(indented, 120, ib, null).parts;
    checkCover(indented, ip, 120);
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
      // no room for `---`, and then the closer is in a part of its own (`<!--` `-->` and the rules), never a tail at dashes.
      let own = 0;
      for (let pad = 0; pad < 40; pad += 1) {
        const text = 'intro\n\n<!--\n' + 'zq hidden line\n'.repeat(20) + 'zq hidden ' + 'y'.repeat(pad) + '\n-->\n' + '---\n\n'.repeat(30) + 'para\n';
        const parts = await cutsHidden(text, 120, SECRET);
        const closer = parts.find((p) => text.slice(p.start, p.end).includes('-->'))!;
        if (partText(text, closer).startsWith('<!--\n-->\n---')) own += 1;
        const after = text.slice(closer.end);
        if (after !== '') expect(after.startsWith('---'), `pad ${pad}: the tail starts elsewhere than at dashes`).toBe(false);
      }
      expect(own, 'some pad puts the closer in a part of its own').toBeGreaterThan(0);
    });

    it('md parts comments: a run of rules that does not fit after the comment: the last part takes what it can, no tail starts at dashes', async () => {
      const text = 'intro\n\n' + comment + '---\n\n'.repeat(40) + 'para\n';
      for (const max of [60, 90, 120, 200]) {
        // (The tail itself is P1's, whose later parts may start at dashes as before: only the first one is this fix's, so the rules
        // are not counted over the whole run here.)
        const parts = await cutsHidden(text, max, SECRET);
        const closer = parts.find((p) => text.slice(p.start, p.end).includes('-->'))!;
        const after = text.slice(closer.end);
        // The part that follows the comment's last part never starts with a line of dashes.
        if (after !== '') expect(after.startsWith('---'), `max ${max}: the tail after the closer's part starts elsewhere than at dashes`).toBe(false);
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
    checkCover(open, cutOpen, 4000);
    for (const p of cutOpen) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    expect(po.chars, 'work on a gap of 20 000 unclosed openers').toBeLessThanOrEqual(24 * open.length);
  });
});

// ---- Measured, not fixed: a closed comment inside a container ------------------------------------------------------------------
// The library draws a list item's or a quote's comment inside the container's block, so the comment is not in a top-level gap and
// is no candidate. What the cut shows for each is MEASURED here (logged, with the fit and the cover asserted), not claimed fixed.
describe('a closed comment inside a container (measured)', { timeout: 120000 }, () => {
  const measure = async (name: string, text: string, max: number): Promise<void> => {
    const parts = await cut(text, max);
    checkCover(text, parts, max);
    const bad = parts.map((p, i) => ({ i, src: partText(text, p) })).filter(({ src }) => {
      const r = render(src, { highlight: false });
      return r.outcome === 'rendered' && r.html.includes(HIDDEN);
    });
    console.info(`md parts comments (container): ${name}: ${utf8Bytes(text)} bytes at ${max}, ${parts.length} parts, ${bad.length} parts show commented text${bad.length > 0 ? ` (parts ${bad.map((b) => b.i + 1).join(', ')})` : ''}`);
  };

  it('md parts comments: containers, as measured', async () => {
    const hidden = (prefix: string, n: number): string => `${prefix}${HIDDEN} line\n`.repeat(n);
    await measure('list item with a comment', '- item\n  <!--\n' + hidden('  ', 40) + '  -->\n- next\n', 200);
    await measure('list item with a comment, single item', '- item\n  <!--\n' + hidden('  ', 40) + '  -->\n', 200);
    await measure('quote with a comment', '> <!--\n' + hidden('> ', 40) + '> -->\n', 200);
    await measure('list item with a fence then a long comment', '- item\n  ```js\n  z\n  ```\n  <!--\n' + hidden('  ', 40) + '  -->\n', 200);  });
});
