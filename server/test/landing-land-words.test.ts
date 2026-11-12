// Landing order wave 5h (Task 2): the `closed` word, the terminal map and the land decision, from values. Pure.
import { describe, it, expect } from 'vitest';
import {
  LANDING_ENTRY_STATES, LANDING_ENTRY_TERMINAL, LANDING_TERMINAL_STATES,
} from '../../shared/landingLine.js';
import type { LandingEntry, LandingRecovery, LandingRecoverySubject } from '../../shared/landingLine.js';
import {
  decideLandingLand, isLandable, landingHoldGate, LANDING_LANDABLE_STATES,
} from '../src/coord/landingEntry.js';
import type { LandingLand, LandingOutcome, LandingProjectionRead } from '../src/coord/landingEntry.js';

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const BASE = 'd'.repeat(40);
const MERGE = 'e'.repeat(40);
const TRAIN = 'f'.repeat(40);
const READABLE: LandingProjectionRead = { kind: 'readable', quarantine: null };

const entry = (patch: Partial<LandingEntry> = {}): LandingEntry => ({
  id: 3, project: 'project-a', pr: 7, pinnedSha: HEAD, handoffCommit: 'c'.repeat(40), runId: 1, state: 'pinned',
  baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'coordinator', pinnedAt: 100, ...patch,
});
const merged = (patch: Partial<Extract<LandingOutcome, { word: 'merged' }>> = {}): LandingOutcome =>
  ({ word: 'merged', head: HEAD, base: BASE, mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE, train: null, ...patch });
const land = (outcome: LandingOutcome, patch: Partial<LandingLand> = {}): LandingLand =>
  ({ kind: 'land', project: 'project-a', pr: 7, by: 'reader', at: 5000, outcome, expect: { id: 3, pinnedAt: 100 }, ...patch });

describe('the closed word and the terminal map', () => {
  it('closed is a state word, and the terminal map classifies every state', () => {
    expect(LANDING_ENTRY_STATES).toContain('closed');
    expect(Object.keys(LANDING_ENTRY_TERMINAL).sort()).toEqual([...LANDING_ENTRY_STATES].sort());
    expect(LANDING_ENTRY_TERMINAL).toEqual({ pinned: false, ejected: false, unknown: false, landed: true, withdrawn: true, closed: true });
  });
  it('the terminal list is derived from the map', () => {
    expect([...LANDING_TERMINAL_STATES].sort()).toEqual(['closed', 'landed', 'withdrawn']);
  });
});

describe('isLandable', () => {
  it('is pinned or ejected over a readable projection with no marker', () => {
    expect(LANDING_LANDABLE_STATES).toEqual(['pinned', 'ejected']);
    expect(isLandable('pinned', READABLE)).toBe(true);
    expect(isLandable('ejected', READABLE)).toBe(true);
    for (const s of ['landed', 'withdrawn', 'closed', 'unknown'] as const) expect(isLandable(s, READABLE)).toBe(false);
    expect(isLandable('pinned', null)).toBe(false);
    expect(isLandable('pinned', { kind: 'unreadable' })).toBe(false);
    expect(isLandable('pinned', { kind: 'readable', quarantine: 'stale-episode-head' })).toBe(false);
  });
});

describe('decideLandingLand', () => {
  it('no row is no-entry', () => {
    expect(decideLandingLand({ land: land(merged()), current: null, projection: null })).toEqual({ act: 'none', write: { kind: 'no-entry' } });
  });
  it('an expect whose id or pinnedAt differs is moved', () => {
    expect(decideLandingLand({ land: land(merged(), { expect: { id: 3, pinnedAt: 99 } }), current: entry(), projection: READABLE }))
      .toEqual({ act: 'none', write: { kind: 'moved' } });
    expect(decideLandingLand({ land: land(merged(), { expect: { id: 4, pinnedAt: 100 } }), current: entry(), projection: READABLE }))
      .toEqual({ act: 'none', write: { kind: 'moved' } });
  });
  it('a row that is not landable is kept, with its state', () => {
    expect(decideLandingLand({ land: land(merged()), current: entry({ state: 'landed' }), projection: READABLE }))
      .toEqual({ act: 'none', write: { kind: 'kept', state: 'landed' } });
    expect(decideLandingLand({ land: land(merged()), current: entry(), projection: { kind: 'unreadable' } }))
      .toEqual({ act: 'none', write: { kind: 'kept', state: 'pinned' } });
  });
  it('a null expect (the close) skips the compare-and-set', () => {
    const d = decideLandingLand({ land: land(merged(), { by: 'close', expect: null }), current: entry({ pinnedAt: 555 }), projection: READABLE });
    expect(d).toMatchObject({ act: 'land', id: 3, state: 'landed' });
  });
  it('merged marks landed; at the pinned head the detail has no head key', () => {
    const d = decideLandingLand({ land: land(merged()), current: entry(), projection: READABLE });
    if (d.act !== 'land') throw new Error('expected a mark');
    expect(d.state).toBe('landed');
    expect(JSON.parse(d.detail)).toEqual({ v: 1, by: 'reader', at: 5000, word: 'merged', base: BASE, mergedAt: '2026-11-11T10:00:00Z',
      mergeCommit: MERGE, train: null, trainMergeCommit: null });
  });
  it('merged at another head carries it', () => {
    const d = decideLandingLand({ land: land(merged({ head: HEAD2 })), current: entry({ state: 'ejected' }), projection: READABLE });
    if (d.act !== 'land') throw new Error('expected a mark');
    expect(JSON.parse(d.detail)).toMatchObject({ word: 'merged', head: HEAD2 });
  });
  it('a train outcome carries train and trainMergeCommit; unmeasured facts stay null', () => {
    const d = decideLandingLand({ land: land(merged({ train: { number: 12, mergeCommit: TRAIN }, mergedAt: null, mergeCommit: null })),
      current: entry(), projection: READABLE });
    if (d.act !== 'land') throw new Error('expected a mark');
    expect(JSON.parse(d.detail)).toEqual({ v: 1, by: 'reader', at: 5000, word: 'merged', base: BASE, mergedAt: null,
      mergeCommit: null, train: 12, trainMergeCommit: TRAIN });
  });
  it('closed and absent mark closed and carry only v, by, at and word', () => {
    for (const word of ['closed', 'absent'] as const) {
      const d = decideLandingLand({ land: land({ word }, { by: 'close', expect: null }), current: entry(), projection: READABLE });
      if (d.act !== 'land') throw new Error('expected a mark');
      expect(d.state).toBe('closed');
      expect(JSON.parse(d.detail)).toEqual({ v: 1, by: 'close', at: 5000, word });
    }
  });
});

describe('landingHoldGate, the land kind', () => {
  const subject = (patch: Partial<LandingRecoverySubject>): LandingRecoverySubject => ({
    id: 3, project: 'project-a', pr: 7, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 },
    projection: { kind: 'missing', association: 'unmeasured' }, authority: { kind: 'not-set' }, ...patch,
  });
  const held = (...subjects: LandingRecoverySubject[]): LandingRecovery =>
    ({ subjects, hold: { reason: 'landing-recovery-unresolved', subjectIds: subjects.map((s) => s.id) } });
  const key = { project: 'project-a', pr: 7 };
  it('passes when nothing is held', () => {
    expect(landingHoldGate({ subjects: [], hold: null }, 'land', key, READABLE)).toEqual({ ok: true, own: null });
  });
  it('an identity conflict anywhere in the project is refused by its own word', () => {
    const r = held(subject({ id: 9, pr: 99, projection: { kind: 'identity-conflict', conflicts: [{ id: 9, project: 'project-b', pr: 5 }] } }));
    expect(landingHoldGate(r, 'land', key, READABLE)).toEqual({ ok: false, error: 'landing-identity-conflict' });
  });
  it('the entry\'s own subject among the recovered is refused', () => {
    expect(landingHoldGate(held(subject({})), 'land', key, READABLE)).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
  });
  it('another held subject in the project passes', () => {
    expect(landingHoldGate(held(subject({ id: 9, pr: 99 })), 'land', key, READABLE)).toEqual({ ok: true, own: null });
  });
});
