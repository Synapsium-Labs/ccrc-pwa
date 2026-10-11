// Child reclamation (spec §5.9): ccd's journal `detail` reaches a banner, a chip and a feed row only through
// `childReclaimDetailText`, which replaces every character its docstring names. One character from each named
// class, so deleting any one arm of the guard is a red row. Built from code points, never written as escapes: an
// agent's file write decodes a backslash-u escape.
import { describe, it, expect } from 'vitest';
import { childReclaimDetailText } from '../src/childReclaimSweep.js';

const cp = (n: number): string => String.fromCodePoint(n);

describe('childReclaimDetailText replaces one character from each class it names (spec §5.9)', () => {
  it.each<readonly [string, number]>([
    ['a C0 control other than a newline (ESC)', 0x1b],
    ['a C0 control other than a newline (TAB)', 0x09],
    ['DEL', 0x7f],
    ['a C1 control (NEL)', 0x85],
    ['a C1 control (CSI)', 0x9b],
    ['the line separator', 0x2028],
    ['the paragraph separator', 0x2029],
    ['a bidi embedding (LRE)', 0x202a],
    ['a bidi override (LRO)', 0x202d],
    ['a bidi isolate (LRI)', 0x2066],
  ])('%s becomes one space', (_name, n) => {
    expect(childReclaimDetailText(`left${cp(n)}right`)).toBe('left right');
  });

  it('the CONTROL: the characters just outside each class pass through unchanged', () => {
    for (const n of [0x20, 0x7e, 0xa0, 0x2027, 0x202f, 0x2065, 0x206a]) {
      expect(childReclaimDetailText(`left${cp(n)}right`), n.toString(16)).toBe(`left${cp(n)}right`);
    }
  });
});
