// The one sequence's vocabulary and deciders (Overlord W1 sequence, plan `w1-sequence-monitor.md` Tasks 1 and 3). The L0 words
// are checked here; the deciders' cases live in `sim/sequenceSets.ts`, written once for this file and for the every-run
// mutation floors, and this file runs them against the real module.
import { describe, expect, it } from 'vitest';
import * as m from '../src/coord/overlordSequence.js';
import * as L0 from '../../shared/overlord-sequence.js';
import { GENERATION_STATES } from '../../shared/continuity.js';
import { DESIGNATION_SEQUENCE_STATES } from '../../shared/overlord-designation.js';
import { ACTOR_SUBJECT_MAX } from '../../shared/overlord-identity.js';
import { retentionCutCases, sequenceLineKnownCases, sequenceLineVerdictCases, sequencePageCases } from './sim/sequenceSets.js';

describe('the sequence vocabulary (shared/overlord-sequence.ts)', () => {
  it('stamps two kinds in W1, the generation and the designation, each with its id rule and spec text', () => {
    expect(L0.SEQUENCE_KINDS).toEqual(['generation', 'designation']);
    for (const k of L0.SEQUENCE_KINDS) {
      expect(L0.SEQUENCE_KIND_MAP[k].id.length).toBeGreaterThan(0);
      expect(L0.SEQUENCE_KIND_MAP[k].spec).toMatch(/^§10\.4 /);
    }
  });
  it("each kind's states are its owner's list, by identity, never a copy", () => {
    expect(L0.SEQUENCE_KIND_MAP.generation.states).toBe(GENERATION_STATES);
    expect(L0.SEQUENCE_KIND_MAP.designation.states).toBe(DESIGNATION_SEQUENCE_STATES);
    expect(DESIGNATION_SEQUENCE_STATES).toEqual(['pending', 'live', 'failed', 'retired']);
  });
  it('isSequenceKind takes the table\'s keys only', () => {
    for (const k of L0.SEQUENCE_KINDS) expect(L0.isSequenceKind(k)).toBe(true);
    for (const bad of ['', 'Generation', 'ladder-rung', 'constructor', 'toString', '__proto__', null, undefined, 1, {}]) {
      expect(L0.isSequenceKind(bad)).toBe(false);
    }
  });
  it('the bounds, the keep, the batch and the page: an actor bound is the identity file\'s', () => {
    expect(L0.SEQUENCE_ID_MAX).toBe(200);
    expect(L0.SEQUENCE_ACTOR_MAX).toBe(ACTOR_SUBJECT_MAX);
    expect(L0.SEQUENCE_KEEP_MS).toBe(7_776_000_000);
    expect(L0.SEQUENCE_PRUNE_BATCH).toBe(5_000);
    expect(L0.SEQUENCE_PAGE_MAX).toBe(500);
  });
  it('the kept kind is the designation (slug newest-designation-line-is-kept)', () => {
    expect(m.SEQUENCE_KEPT_KIND).toBe('designation');
  });
});

describe('sequenceLineVerdict', () => {
  for (const [name, fn] of Object.entries(sequenceLineVerdictCases(m))) it(name, fn);
});
describe('sequenceLineKnown', () => {
  for (const [name, fn] of Object.entries(sequenceLineKnownCases(m))) it(name, fn);
});
describe('sequencePage', () => {
  for (const [name, fn] of Object.entries(sequencePageCases(m))) it(name, fn);
});
describe('retentionCut', () => {
  for (const [name, fn] of Object.entries(retentionCutCases(m))) it(name, fn);
});
