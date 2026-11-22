// The console's authority witness client (Overlord W1 authority journal plan, Task 6): keeps the higher epoch, survives storage that
// throws, tells a refusal from a malformed offer, and exchanges every 60 s while visible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WitnessTuple } from '../../shared/authorityWitness';
import { ApiError } from '../src/lib/apiError';
import { memoryStorage } from '../src/lib/storage';
import { exchangeWitness, nudgeWitness, startWitnessExchange, WITNESS_KEY } from '../src/lib/witness';

const tuple = (authority: number, base = 0): WitnessTuple => ({
  v: 1, epoch: base + authority, base, terms: { authority, privacy: 'absent', act: 'absent' }, boot: 'boot-a',
  authority: authority === 0 ? null : { sequence: authority, digest: 'a'.repeat(64) }, privacy: 'absent', act: 'absent',
  highestIds: { restoreGeneration: 0 }, told: { operatorRung: null, latches: [] },
});
const throwing = (): never => { throw new Error('blocked'); };

describe('exchangeWitness', () => {
  it('keeps the higher epoch: a higher offer replaces, a lower one never does, an equal one keeps held', async () => {
    const mem = memoryStorage();
    const from = () => mem;
    mem.setItem(WITNESS_KEY, JSON.stringify(tuple(3)));
    await exchangeWitness({ ask: async () => ({ offer: tuple(5) }), from });
    expect(JSON.parse(mem.getItem(WITNESS_KEY)!).epoch).toBe(5);
    const low = await exchangeWitness({ ask: async () => ({ offer: tuple(2) }), from });
    expect(JSON.parse(mem.getItem(WITNESS_KEY)!).epoch).toBe(5);
    expect(low).toMatchObject({ kind: 'offer', wrote: false });
    const equal = tuple(5); equal.boot = 'boot-b';
    await exchangeWitness({ ask: async () => ({ offer: equal }), from });
    expect(JSON.parse(mem.getItem(WITNESS_KEY)!).boot).toBe('boot-a');
  });
  it('sends what is held, and held null for nothing stored, a value that does not parse, and storage that throws', async () => {
    const sent: unknown[] = [];
    const ask = async (h: unknown) => { sent.push(h); return { offer: tuple(1) }; };
    const mem = memoryStorage();
    mem.setItem(WITNESS_KEY, JSON.stringify(tuple(4)));
    await exchangeWitness({ ask, from: () => mem });
    await exchangeWitness({ ask, from: () => memoryStorage() });
    const bad = memoryStorage(); bad.setItem(WITNESS_KEY, '{"v":2}');
    await exchangeWitness({ ask, from: () => bad });
    await exchangeWitness({ ask, from: throwing });
    expect(sent).toEqual([tuple(4), null, null, null]);
  });
  it('survives a storage that throws on write: nothing written, no throw', async () => {
    const mem = memoryStorage();
    mem.setItem = () => { throw new Error('quota'); };
    await expect(exchangeWitness({ ask: async () => ({ offer: tuple(2) }), from: () => mem })).resolves.toMatchObject({ kind: 'offer', wrote: false });
    expect(mem.getItem(WITNESS_KEY)).toBeNull();
  });
  it('writes nothing for a malformed offer', async () => {
    const mem = memoryStorage();
    for (const offer of [{ ...tuple(2), v: 2 }, undefined, 'x']) {
      expect(await exchangeWitness({ ask: async () => ({ offer }), from: () => mem })).toEqual({ kind: 'malformed' });
    }
    expect(mem.getItem(WITNESS_KEY)).toBeNull();
  });
  it('tells a refusal from a failure, writes nothing, and does not throw', async () => {
    const mem = memoryStorage();
    const refused = await exchangeWitness({ ask: async () => { throw new ApiError(503, { error: 'auth-off' }); }, from: () => mem });
    expect(refused).toEqual({ kind: 'refused', status: 503, error: 'auth-off' });
    expect(await exchangeWitness({ ask: async () => { throw new TypeError('network'); }, from: () => mem })).toEqual({ kind: 'failed' });
    expect(mem.getItem(WITNESS_KEY)).toBeNull();
  });
});

describe('startWitnessExchange', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const fakeDoc = (state: 'visible' | 'hidden') => {
    const on = new Set<() => void>();
    let now = state;
    const sub = (h: () => void) => { on.add(h); return () => { on.delete(h); }; };
    const doc = { visible: () => now === 'visible', onVisible: sub, onHidden: sub };
    return { doc, set: (s: 'visible' | 'hidden') => { now = s; for (const h of [...on]) h(); } };
  };
  it('exchanges at start and every 60 s while visible, and not while hidden', async () => {
    const exchange = vi.fn(async () => undefined);
    const { doc, set } = fakeDoc('visible');
    const stop = startWitnessExchange({ exchange, page: doc });
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exchange).toHaveBeenCalledTimes(2);
    set('hidden');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(exchange).toHaveBeenCalledTimes(2);
    set('visible');
    expect(exchange).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exchange).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(exchange).toHaveBeenCalledTimes(4);
  });
  it('starts nothing while hidden', async () => {
    const exchange = vi.fn(async () => undefined);
    const stop = startWitnessExchange({ exchange, page: fakeDoc('hidden').doc });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(exchange).not.toHaveBeenCalled();
    stop();
  });
  it('a nudge during a flight runs one more exchange, not two, and never two at once', async () => {
    let release: () => void = () => undefined;
    let live = 0, peak = 0;
    const exchange = vi.fn(() => { live++; peak = Math.max(peak, live); return new Promise<void>((r) => { release = () => { live--; r(); }; }); });
    const stop = startWitnessExchange({ exchange, page: fakeDoc('visible').doc });
    nudgeWitness(); nudgeWitness();
    expect(exchange).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(exchange).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    stop();
    nudgeWitness();
    expect(exchange).toHaveBeenCalledTimes(2);
  });
});
