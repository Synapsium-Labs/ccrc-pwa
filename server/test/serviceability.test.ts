// Routing spec 2026-09-14 §5.4 — the serviceability clause, in L0, pure. The
// bash twin (`_serviceable`, ccd/ccd) is driven over the same fixture table in
// `ccd-serviceable.test.ts`; this file pins the TypeScript side's own edges.
import { describe, it, expect } from 'vitest';
import {
  FABLE_SHARE_CEILING_PCT, SEVEN_DAY_CEILING_PCT, SHARE_FRESH_S,
  classBelow, serviceability, type LaneFacts,
} from '../../shared/serviceability.js';
import { CLASSES } from '../../shared/models.js';

const NOW = 1_800_000_000;
const lane = (o: Partial<LaneFacts> = {}): LaneFacts =>
  ({ anthropic: true, seven: 20, share: { estimatePct: 10, finishedAtS: NOW - 60 }, ...o });

describe('classBelow — one rung down the CLASSES ladder', () => {
  it('walks CLASSES in order and stops at the bottom', () => {
    expect(classBelow('fable')).toBe('opus');
    expect(classBelow('opus')).toBe('sonnet');
    expect(classBelow('sonnet')).toBe('haiku');
    expect(classBelow('haiku')).toBeNull();
    // derived, not respelled: every member maps to its predecessor or null
    for (let i = 0; i < CLASSES.length; i++) expect(classBelow(CLASSES[i]!)).toBe(i === 0 ? null : CLASSES[i - 1]);
  });
});

describe('serviceability — five answers', () => {
  it('class default is SKIPPED, whatever the lane says', () => {
    expect(serviceability('default', lane({ seven: 99, share: null }), NOW)).toEqual({ kind: 'skipped' });
  });

  it('fable: the share estimate against FABLE_SHARE_CEILING_PCT, at the ceiling is unservable', () => {
    expect(serviceability('fable', lane({ share: { estimatePct: FABLE_SHARE_CEILING_PCT - 1, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'servable', figurePct: FABLE_SHARE_CEILING_PCT - 1 });
    expect(serviceability('fable', lane({ share: { estimatePct: FABLE_SHARE_CEILING_PCT, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'unservable', why: 'ceiling', figurePct: FABLE_SHARE_CEILING_PCT, ceilingPct: FABLE_SHARE_CEILING_PCT });
  });

  it('fable: no reading, a null estimate, or a stale pass is UNMEASURED — never servable, never unservable', () => {
    expect(serviceability('fable', lane({ share: null }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    expect(serviceability('fable', lane({ share: { estimatePct: null, finishedAtS: NOW } }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    expect(serviceability('fable', lane({ share: { estimatePct: 5, finishedAtS: NOW - SHARE_FRESH_S - 1 } }), NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(serviceability('fable', lane({ share: { estimatePct: 5, finishedAtS: NOW - SHARE_FRESH_S } }), NOW)).toEqual({ kind: 'servable', figurePct: 5 });
  });

  it('fable on a lane whose backend is not Anthropic is unservable by BACKEND, before any figure is read', () => {
    expect(serviceability('fable', lane({ anthropic: false, share: { estimatePct: 0, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'unservable', why: 'backend' });
  });

  it.each(['opus', 'sonnet', 'haiku'] as const)('%s: the seven-day figure against SEVEN_DAY_CEILING_PCT; null is unmeasured', (c) => {
    expect(serviceability(c, lane({ seven: SEVEN_DAY_CEILING_PCT - 1 }), NOW)).toEqual({ kind: 'servable', figurePct: SEVEN_DAY_CEILING_PCT - 1 });
    expect(serviceability(c, lane({ seven: SEVEN_DAY_CEILING_PCT }), NOW))
      .toEqual({ kind: 'unservable', why: 'ceiling', figurePct: SEVEN_DAY_CEILING_PCT, ceilingPct: SEVEN_DAY_CEILING_PCT });
    expect(serviceability(c, lane({ seven: null }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    // the share is irrelevant to these classes
    expect(serviceability(c, lane({ seven: 10, share: null, anthropic: false }), NOW)).toEqual({ kind: 'servable', figurePct: 10 });
  });

  it('the constants are what the spec says until the operator moves them', () => {
    expect(FABLE_SHARE_CEILING_PCT).toBe(40);
    expect(SHARE_FRESH_S).toBe(28_800);
    expect(SEVEN_DAY_CEILING_PCT).toBe(98);
  });
});
