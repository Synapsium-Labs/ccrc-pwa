import { describe, it, expect, beforeEach } from 'vitest';
import { loadMark, saveMark, applyCatchUp } from '../src/lib/notifymark';
import type { CatchUp, NotifyEvent } from '../../shared/api';

const ev = (seq: number): NotifyEvent =>
  ({ seq, at: 1_000 + seq, kind: 'ask', sessionId: 'cc-a', title: `t${seq}`, body: '' });

beforeEach(() => localStorage.clear());

describe('the client watermark', () => {
  it('round-trips as ONE json value', () => {
    saveMark({ epoch: 'e1', seq: 7 });
    expect(loadMark()).toEqual({ epoch: 'e1', seq: 7 });
    // One key, not two. Two keys is the torn write the epoch exists to make
    // detectable, and it would be undetectable if the client itself split them.
    expect(Object.keys(localStorage)).toEqual(['ccrc:notify:v1']);
  });

  it('has no mark on a fresh install', () => {
    expect(loadMark()).toBeNull();
  });

  it('has no mark when the store is corrupt', () => {
    localStorage.setItem('ccrc:notify:v1', 'not json at all');
    expect(loadMark()).toBeNull();
  });

  it('rejects a half-written pair rather than trusting it', () => {
    for (const bad of [
      '{"epoch":"e1"}', '{"seq":3}', '{"epoch":"","seq":3}',
      '{"epoch":"e1","seq":-1}', '{"epoch":"e1","seq":1.5}', '{"epoch":1,"seq":3}',
      '[]', 'null',
    ]) {
      localStorage.setItem('ccrc:notify:v1', bad);
      expect(loadMark(), bad).toBeNull();
    }
  });

  it('survives a storage that refuses to write', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      expect(() => saveMark({ epoch: 'e1', seq: 1 })).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

describe('applying a catch-up', () => {
  it('adopts the server pair and returns the missed events', () => {
    const r: CatchUp = { epoch: 'e1', seq: 9, resync: false, events: [ev(8), ev(9)] };
    expect(applyCatchUp(r).map((e) => e.seq)).toEqual([8, 9]);
    expect(loadMark()).toEqual({ epoch: 'e1', seq: 9 });
  });

  it('surfaces NOTHING retroactively on a resync, but still adopts the pair', () => {
    saveMark({ epoch: 'old', seq: 7 });
    // A server that says resync cannot prove the client saw everything, so any
    // badge built from this response would be fabricated. The fleet snapshot on
    // the same connection already shows what currently wants the operator.
    const r: CatchUp = { epoch: 'new', seq: 3, resync: true, events: [ev(1)] };
    expect(applyCatchUp(r)).toEqual([]);
    expect(loadMark()).toEqual({ epoch: 'new', seq: 3 });
  });

  it('moves the mark forward even when nothing was missed', () => {
    saveMark({ epoch: 'e1', seq: 4 });
    expect(applyCatchUp({ epoch: 'e1', seq: 6, resync: false, events: [] })).toEqual([]);
    expect(loadMark()).toEqual({ epoch: 'e1', seq: 6 });
  });
});
