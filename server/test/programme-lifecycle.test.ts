// Programme lifecycle W1, task 2: `shared/programmeLifecycle.ts`'s two deciders, spec §3's truth table row by row.
// Measured red: folding stored `unknown` into `active`, and counting a `planned` run as not open (the store's `runFactsOf`
// keeps `planned` open: see programme-lifecycle-store.test.ts), each turn a row here red.
import { describe, it, expect } from 'vitest';
import {
  coordinatorLineOf, isEnded, lifecycleOf, PROGRAMME_STORED_STATES,
} from '../../shared/programmeLifecycle.js';
import { isProgramState } from '../../shared/api.js';

describe('lifecycleOf: spec §3, row by row', () => {
  it('stored active: Active with an open dispatched run, Open never dispatched, Idle dispatched with none open', () => {
    expect(lifecycleOf('active', null, { open: 1, dispatched: true })).toBe('active');
    expect(lifecycleOf('active', null, { open: 2, dispatched: false })).toBe('open');
    expect(lifecycleOf('active', null, { open: 0, dispatched: false })).toBe('open');
    expect(lifecycleOf('active', null, { open: 0, dispatched: true })).toBe('idle');
  });
  it('a programme whose only open run is planned after an earlier dispatched wave is Active (wave N+1 before wave N closes)', () => {
    expect(lifecycleOf('active', null, { open: 1, dispatched: true })).toBe('active');
  });
  it('paused, done and abandoned show themselves whatever the runs say', () => {
    for (const runs of [{ open: 0, dispatched: false }, { open: 3, dispatched: true }]) {
      expect(lifecycleOf('paused', null, runs)).toBe('paused');
      expect(lifecycleOf('done', null, runs)).toBe('done');
      expect(lifecycleOf('abandoned', null, runs)).toBe('abandoned');
    }
  });
  it('stored unknown and an out-of-vocabulary value are Unknown, never folded into live or ended', () => {
    expect(lifecycleOf('unknown', null, { open: 1, dispatched: true })).toBe('unknown');
    expect(lifecycleOf('archived', null, { open: 0, dispatched: true })).toBe('unknown');
  });
  it('a filed or withdrawn placeholder has no lifecycle; an unfiled one has its state\'s', () => {
    expect(lifecycleOf('active', 'filed', { open: 0, dispatched: false })).toBeNull();
    expect(lifecycleOf('active', 'withdrawn', { open: 0, dispatched: false })).toBeNull();
    expect(lifecycleOf('active', 'unfiled', { open: 0, dispatched: false })).toBe('open');
  });
});

describe('isEnded: the one end predicate', () => {
  it('done and abandoned only', () => {
    expect(['done', 'abandoned'].map(isEnded)).toEqual([true, true]);
    expect(['active', 'paused', 'unknown', 'archived', ''].map(isEnded)).toEqual([false, false, false, false, false]);
  });
  it('the stored vocabulary is ProgramState\'s, word for word', () => {
    for (const w of PROGRAMME_STORED_STATES) expect(isProgramState(w)).toBe(true);
    expect(PROGRAMME_STORED_STATES).toHaveLength(5);
  });
});

describe('coordinatorLineOf', () => {
  const bound = { session: 'lane-a-one', uuid: 'u-1' };
  const row = (o: Partial<{ uuid: string | null; archived: boolean; carrying: boolean }> = {}) =>
    ({ kind: 'present' as const, uuid: 'u-1', archived: false, carrying: false, ...o });
  it('led: the bound incarnation is present and not archived', () => {
    expect(coordinatorLineOf(bound, row())).toBe('led');
  });
  it('no-coordinator: no binding, an absent row, a uuid mismatch (a new incarnation), an archived row', () => {
    expect(coordinatorLineOf({ session: null, uuid: null }, row())).toBe('no-coordinator');
    expect(coordinatorLineOf(bound, { kind: 'absent' })).toBe('no-coordinator');
    expect(coordinatorLineOf(bound, row({ uuid: 'u-2' }))).toBe('no-coordinator');
    expect(coordinatorLineOf(bound, row({ archived: true }))).toBe('no-coordinator');
  });
  it('unmeasured, never folded into no-coordinator: an unreadable registry, an unreadable uuid, a mid-swap row', () => {
    expect(coordinatorLineOf(bound, { kind: 'unreadable' })).toBe('unmeasured');
    expect(coordinatorLineOf(bound, row({ uuid: null }))).toBe('unmeasured');
    expect(coordinatorLineOf(bound, row({ carrying: true }))).toBe('unmeasured');
  });
  it('a migration-seeded binding (null uuid) is led by any present incarnation until the registry lane stamps it', () => {
    expect(coordinatorLineOf({ session: 'lane-a-one', uuid: null }, row({ uuid: 'u-9' }))).toBe('led');
  });
});
