// Version skew on GET /api/coord/run-close (D-8078): a build that does not know a group or a `why` skips it and keeps the rest, and a
// build that knows more groups than the server sends renders the ones it was sent.
import { describe, it, expect } from 'vitest';
import { asRunCloseView } from '../src/screens/runCloseWords';

const group = (name: string, list: unknown = null) => ({
  group: name, choice: 'shadow', marker: 'clear', state: 'shadow', held: null, list, closed7d: 0, refused7d: 0, updatedAt: null,
});
const NOW = 1_800_000_000_000;

describe('asRunCloseView across versions', () => {
  it('an older PWA skips a group a newer server sends and keeps the groups it knows', () => {
    const v = asRunCloseView({ groups: [group('never-started'), group('a-group-from-the-future'), group('claimant-crashed')] }, NOW);
    expect(v?.groups.map((g) => g.group)).toEqual(['never-started', 'claimant-crashed']);
  });

  it('an unknown reason in a known group is dropped from the would-close list, not an error', () => {
    const list = { would: [
      { runId: 1, program: 'p', at: NOW, why: 'never-started' }, { runId: 2, program: 'p', at: NOW, why: 'a-reason-from-the-future' },
    ], named: [] };
    const v = asRunCloseView({ groups: [group('never-started', list)] }, NOW);
    expect(v?.groups[0]?.list?.would.map((w) => w.runId)).toEqual([1]);
  });

  it('a newer PWA reads an older server that sends two groups', () => {
    const v = asRunCloseView({ groups: [group('never-started'), group('claimant-crashed')] }, NOW);
    expect(v?.groups).toHaveLength(2);
  });

  it('a malformed group of a known name is still an error', () => {
    expect(asRunCloseView({ groups: [{ ...group('never-started'), closed7d: 'x' }] }, NOW)).toBeNull();
    expect(asRunCloseView({ groups: [null] }, NOW)).toBeNull();
  });
});
