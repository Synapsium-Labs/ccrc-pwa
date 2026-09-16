// The learned item height — the number virtuoso opens the chat with.
//
// Testable where the list itself is not: jsdom reports every rendered height as
// 0, so nothing here can measure a bubble. What it CAN do is hold the arithmetic
// and the storage contract, which is where this can go wrong quietly — a value
// that drifts out of band, or a browser that refuses storage, both end as a
// scrollbar that lies and neither raises anything.
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_ITEM_HEIGHT, MAX_ITEM_HEIGHT, MIN_ITEM_HEIGHT,
  clampHeight, meanSize, rememberHeight, rememberedHeight,
} from '../src/session/itemHeight';

const KEY = 'ccrc:chat-item-height';

/** A Storage that works, so the tests do not depend on jsdom's own. */
const fake = (seed?: string): Storage => {
  const m = new Map<string, string>();
  if (seed !== undefined) m.set(KEY, seed);
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
};

/** A Storage that refuses everything — a private window, or site data blocked. */
const hostile = (): Storage => ({
  get length(): number { throw new Error('denied'); },
  clear: () => { throw new Error('denied'); },
  getItem: () => { throw new Error('denied'); },
  key: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
}) as Storage;

describe('meanSize', () => {
  // Virtuoso reports 0 for an item it has not measured yet. Averaging those in
  // would drag the estimate toward zero on every fast scroll — which is the
  // lying scrollbar again, pointing the other way.
  it('averages only what was actually measured', () => {
    expect(meanSize([100, 0, 200, 0])).toBe(150);
  });

  it('says nothing rather than zero when nothing was measured', () => {
    expect(meanSize([])).toBeNull();
    expect(meanSize([0, 0])).toBeNull();
    expect(meanSize([Number.NaN, -5])).toBeNull();
  });
});

describe('the remembered height stays inside a sane band', () => {
  // One transcript of nothing but giant tables must not teach the list that
  // every row is 2000px; a run of one-line dividers must not teach it 12px.
  // Either way the NEXT visit opens with the same lie, pointing the other way.
  it('clamps both ends', () => {
    expect(clampHeight(5000)).toBe(MAX_ITEM_HEIGHT);
    expect(clampHeight(3)).toBe(MIN_ITEM_HEIGHT);
    expect(clampHeight(137.4)).toBe(137);
  });

  it('never stores a value outside the band, however extreme the sample', () => {
    const s = fake();
    rememberHeight(99_999, s);
    expect(Number(s.getItem(KEY))).toBeLessThanOrEqual(MAX_ITEM_HEIGHT);
    const t = fake();
    rememberHeight(1, t);
    expect(Number(t.getItem(KEY))).toBeGreaterThanOrEqual(MIN_ITEM_HEIGHT);
  });
});

describe('rememberedHeight', () => {
  it('falls back when this browser has measured nothing yet', () => {
    expect(rememberedHeight(fake())).toBe(FALLBACK_ITEM_HEIGHT);
  });

  it('returns what was learned', () => {
    expect(rememberedHeight(fake('240'))).toBe(240);
  });

  // Hand-edited, half-written, or left over from another build. A bad value is
  // not a reason to render badly.
  it('ignores a value that is not a usable number', () => {
    for (const junk of ['', 'abc', '0', '-30', 'NaN', 'Infinity']) {
      expect(rememberedHeight(fake(junk)), junk).toBe(FALLBACK_ITEM_HEIGHT);
    }
  });

  it('survives a browser that refuses storage outright', () => {
    expect(rememberedHeight(hostile())).toBe(FALLBACK_ITEM_HEIGHT);
    expect(() => rememberHeight(200, hostile())).not.toThrow();
  });
});

describe('a new visit nudges the estimate rather than seizing it', () => {
  // One atypical session — a long tool-only run, a single enormous report —
  // should move the number, not replace it. Otherwise the estimate oscillates
  // between session shapes and the scrollbar jumps on every other visit.
  it('blends towards the new sample', () => {
    const s = fake('100');
    rememberHeight(200, s);
    const after = Number(s.getItem(KEY));
    expect(after).toBeGreaterThan(100);
    expect(after).toBeLessThan(200);
  });

  it('takes the first sample whole — there is nothing to blend with', () => {
    const s = fake();
    rememberHeight(180, s);
    expect(Number(s.getItem(KEY))).toBe(180);
  });

  it('converges rather than drifting, when the content keeps its shape', () => {
    const s = fake('100');
    for (let i = 0; i < 25; i++) rememberHeight(200, s);
    expect(Number(s.getItem(KEY))).toBeGreaterThan(195);
    expect(Number(s.getItem(KEY))).toBeLessThanOrEqual(200);
  });

  it('refuses a sample that measured nothing', () => {
    const s = fake('150');
    rememberHeight(0, s);
    rememberHeight(Number.NaN, s);
    expect(s.getItem(KEY)).toBe('150');
  });
});
