// Child reclamation wave 9 (spec §5.9, §5.10): `detailUnsafe` widened from a hand list to every code point of general
// category Cc, Cf, Zl, Zp or Cs, plus U+034F and the whole tag block U+E0000 to U+E007F by range. One case per class,
// so deleting a class reds a named case; the upper bounds of wave 8's hand ranges are pinned, so a narrowed class reds
// too; and LC_LINE_MAX cuts at 2048 and 2049. Built from code points, never escapes: an agent's file write decodes a
// backslash-u escape.
import { describe, it, expect } from 'vitest';
import { LC_LINE_MAX } from '../../shared/api.js';
import { childReclaimDetailText } from '../src/childReclaimSweep.js';

const cp = (n: number): string => String.fromCodePoint(n);

describe('detailUnsafe: one case per class it names (spec §5.9)', () => {
  it.each<readonly [string, number]>([
    ['Cc: ESC', 0x1b],
    ['Cc: the C0 upper bound (US)', 0x1f],
    ['Cc: DEL', 0x7f],
    ['Cc: the C1 upper bound (APC)', 0x9f],
    ['Cf: LRM', 0x200e],
    ['Cf: RLM', 0x200f],
    ['Cf: ALM', 0x061c],
    ['Cf: ZWSP', 0x200b],
    ['Cf: ZWJ', 0x200d],
    ['Cf: the byte-order mark', 0xfeff],
    ['Cf: the soft hyphen', 0x00ad],
    ['Cf: the Mongolian vowel separator', 0x180e],
    ['Cf: the word joiner', 0x2060],
    ['Cf: invisible plus', 0x2064],
    ['Cf: inhibit symmetric swapping', 0x206a],
    ['Cf: nominal digit shapes', 0x206f],
    ['Cf: the interlinear annotation anchor', 0xfff9],
    ['Cf: the interlinear annotation terminator', 0xfffb],
    ['Cf: the bidi override upper bound (RLO)', 0x202e],
    ['Cf: the bidi isolate upper bound (PDI)', 0x2069],
    ['Cf: tag latin small a', 0xe0061],
    ['Zl: the line separator', 0x2028],
    ['Zp: the paragraph separator', 0x2029],
    ['Cs: a lone high surrogate', 0xd800],
    ['Cs: a lone low surrogate', 0xdfff],
    ['U+034F: the combining grapheme joiner (Mn)', 0x034f],
    ['the tag block by range: U+E0000 (Cn)', 0xe0000],
    ['the tag block by range: U+E0002 (Cn)', 0xe0002],
    ['the tag block by range: U+E001F (Cn)', 0xe001f],
  ])('%s becomes one space', (_name, n) => {
    expect(childReclaimDetailText(`left${cp(n)}right`)).toBe('left right');
  });

  it('the CONTROL: the code points just outside every class pass through unchanged', () => {
    for (const n of [0x41, 0x20, 0x7e, 0xa0, 0x034e, 0x0350, 0x2027, 0x202f, 0x2065, 0x2070, 0xfffc, 0xe0080, 0x1f600]) {
      expect(childReclaimDetailText(`left${cp(n)}right`), n.toString(16)).toBe(`left${cp(n)}right`);
    }
  });
});

describe('LC_LINE_MAX bounds the line (spec §5.9)', () => {
  it('is 2048 code points: 2048 are kept whole, 2049 are cut to 2048 and an ellipsis', () => {
    expect(LC_LINE_MAX).toBe(2048);
    expect(childReclaimDetailText('x'.repeat(2048))).toBe('x'.repeat(2048));
    expect(childReclaimDetailText('x'.repeat(2049))).toBe(`${'x'.repeat(2048)}…`);
  });
});
