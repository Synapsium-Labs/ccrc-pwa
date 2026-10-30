// D-7506 (ARCH-05): the constant-time slot matcher, pinned before it moves inward. `matchDigestSlots` answers the
// index of the FIRST slot equal to the presented digest, or -1, and compares EVERY slot on every call: the call count
// is `slots.length` whether the first, a middle, the last or no slot matches, so which slot matched (or whether any
// did) never changes how many compares run. The move commit changes this file's import only.
import { describe, it, expect } from 'vitest';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { matchDigestSlots } from '../src/coord/token.js';
import { REPO_ROOT, parsedFile } from './scan/symbols.js';

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

/** A comparator that counts its calls and answers what `timingSafeEqual` answers. */
const counting = (): { calls: () => number; compare: (a: Buffer, b: Buffer) => boolean } => {
  let n = 0;
  return { calls: () => n, compare: (a, b) => { n++; return timingSafeEqual(a, b); } };
};

describe('matchDigestSlots answers the first match and compares every slot (D-7506)', () => {
  const slots = ['a', 'b', 'c', 'd', 'e'].map(sha);

  it('answers the index of the slot that matches, in every slot position', () => {
    slots.forEach((slot, i) => {
      expect(matchDigestSlots(Buffer.from(slot), slots), `slot ${i}`).toBe(i);
    });
  });

  it('answers the FIRST matching index when several slots hold the same digest', () => {
    expect(matchDigestSlots(sha('x'), [sha('y'), sha('x'), sha('z'), sha('x')])).toBe(1);
    expect(matchDigestSlots(sha('x'), [sha('x'), sha('x')])).toBe(0);
  });

  it('answers -1 when no slot matches, and on no slots', () => {
    expect(matchDigestSlots(sha('w'), slots)).toBe(-1);
    expect(matchDigestSlots(sha('w'), [])).toBe(-1);
  });

  it('calls compare exactly slots.length times whether or not a slot matches (the constant-time property)', () => {
    for (const presented of [...slots, sha('w')]) {
      const c = counting();
      matchDigestSlots(presented, slots, c.compare);
      expect(c.calls()).toBe(slots.length);
    }
    const none = counting();
    expect(matchDigestSlots(sha('w'), [], none.compare)).toBe(-1);
    expect(none.calls()).toBe(0);
  });

  it('one definition of matchDigestSlots under server/src', () => {
    const srcRoot = path.join(REPO_ROOT, 'server', 'src');
    const files = (readdirSync(srcRoot, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => path.join(srcRoot, f));
    const defining = files.filter((f) => parsedFile(f).symbols.some((s) => s.name === 'matchDigestSlots'));
    expect(defining, 'a second definition of matchDigestSlots').toHaveLength(1);
  });
});
