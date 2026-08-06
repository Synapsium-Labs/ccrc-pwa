import { describe, it, expect, beforeEach } from 'vitest';
import { loadAcks, isUnseen, ack, prune, ackAll } from '../src/lib/seen';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession =>
  ({ id: 'cc-a', bucket: 'attention', bucketSince: 1000, ...over } as FleetSession);

beforeEach(() => localStorage.clear());

describe('seen watermark', () => {
  it('is unseen when the bucket started after the ack', () => {
    expect(isUnseen(s({}), { 'cc-a': 999 })).toBe(true);
  });

  it('is seen when the ack is at or after the bucket start', () => {
    expect(isUnseen(s({}), { 'cc-a': 1000 })).toBe(false);
    expect(isUnseen(s({}), { 'cc-a': 1001 })).toBe(false);
  });

  it('is unseen with no ack at all', () => {
    expect(isUnseen(s({}), {})).toBe(true);
  });

  it('never badges working or idle — nothing is being asked of you', () => {
    expect(isUnseen(s({ bucket: 'working' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'idle' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'dead' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'archived' }), {})).toBe(false);
  });

  it('badges attention, done and cleanup', () => {
    for (const bucket of ['attention', 'done', 'cleanup'] as const) {
      expect(isUnseen(s({ bucket }), {})).toBe(true);
    }
  });

  it('is seen when there is no evidence of when the bucket began', () => {
    // A null bucketSince cannot prove anything is new; badging it would fire on
    // every render forever.
    expect(isUnseen(s({ bucketSince: null }), {})).toBe(false);
  });

  it('round-trips through localStorage', () => {
    ack('cc-a', 4242);
    expect(loadAcks()).toEqual({ 'cc-a': 4242 });
  });

  it('survives a corrupt store by starting empty', () => {
    localStorage.setItem('ccrc:seen:v1', 'not json');
    expect(loadAcks()).toEqual({});
  });

  it('prune drops ids that are no longer in the fleet', () => {
    ack('cc-a', 1); ack('cc-gone', 1);
    expect(prune(new Set(['cc-a']))).toEqual({ 'cc-a': 1 });
  });

  it('ackAll marks every given session seen at the given time', () => {
    const acks = ackAll([s({ id: 'cc-a' }), s({ id: 'cc-b' })], 5000);
    expect(acks).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
  });
});
