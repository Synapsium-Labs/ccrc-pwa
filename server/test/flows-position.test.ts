// Flows wave 3a (plan 2026-11-20-flows-w3a Task 1): where a programme is on its flow, one case per mapping row.
import { describe, expect, it } from 'vitest';
import type { RunState } from '../../shared/api.js';
import type { FlowParse } from '../../shared/flows.js';
import { flowPositionOf, type ProgrammeRunFacts } from '../src/flows/position.js';
import { findTemplate } from '../src/flows/templates.js';

const doc: FlowParse = { ok: true, doc: structuredClone(findTemplate('ccrc')!.doc) };
const at = (state: RunState, wave = 1, waveOf = 2, over: Partial<ProgrammeRunFacts> = {}): ProgrammeRunFacts =>
  ({ programmeState: 'active', work: { id: 12, state, wave, waveOf }, reviewOpen: false, ...over });
const block = (f: ProgrammeRunFacts, d: FlowParse | null = doc): string | null => flowPositionOf(d, f).blockId;

describe('flowPositionOf', () => {
  it('an ended programme is at the end', () => {
    expect(block(at('working', 1, 2, { programmeState: 'done' }))).toBe('end');
    expect(block(at('working', 1, 2, { programmeState: 'abandoned' }))).toBe('end');
  });
  it('no work run yet: before the first wave, on no block', () => {
    expect(flowPositionOf(doc, { programmeState: 'active', work: null, reviewOpen: false }))
      .toEqual({ blockId: null, why: 'before the first wave' });
  });
  it('a planned run is opening the wave', () => expect(block(at('planned'))).toBe('open-wave'));
  it('a dispatched, working or unknown run is in the block the dispatch leads to', () => {
    for (const s of ['dispatched', 'working', 'unknown'] as const) expect(block(at(s))).toBe('build');
  });
  it('awaiting review, or an open review run, is at review', () => {
    expect(block(at('awaiting-review'))).toBe('review');
    expect(block(at('working', 1, 2, { reviewOpen: true }))).toBe('review');
  });
  it('merging or closing is closing the wave', () => {
    expect(block(at('merging'))).toBe('close-wave');
    expect(block(at('closing'))).toBe('close-wave');
  });
  it('a done wave closes it, or ends the programme on the last wave', () => {
    expect(block(at('done', 1, 2))).toBe('close-wave');
    expect(block(at('done', 2, 2))).toBe('end');
  });
  it('a failed wave is on no block, and says so', () => {
    expect(flowPositionOf(doc, at('failed'))).toEqual({ blockId: null, why: 'run 12 failed (wave 1 of 2)' });
  });
  it('names the run fact it read', () => {
    expect(flowPositionOf(doc, at('working', 2, 3)).why).toBe('run 12 is working (wave 2 of 3)');
  });
  it('an unreadable pinned version places nothing', () => {
    expect(flowPositionOf({ ok: false, reason: 'unknown schema 9' }, at('working')))
      .toEqual({ blockId: null, why: 'the pinned version cannot be read: unknown schema 9' });
    expect(flowPositionOf(null, at('working')).blockId).toBeNull();
  });
  it('a dispatch that leads nowhere readable falls back to the dispatch block', () => {
    const d = structuredClone(findTemplate('ccrc')!.doc);
    d.edges = d.edges.filter((e) => e.from !== 'dispatch');
    expect(block(at('working'), { ok: true, doc: d })).toBe('dispatch');
  });
});
