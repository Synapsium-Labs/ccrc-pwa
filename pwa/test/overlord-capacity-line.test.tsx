// The capacity line (Overlord W1 home B, Task 6; plan question 6): each pool's runway and earliest reset from
// `GET /api/pools/runway`. Each `EarliestReset` arm has its own sentence, `unmeasured` says why, a pool of `null` is the
// untagged accounts, the line is NOT drawn for a 404 (an older server) or while the read is in flight, and a 503 reads
// unmeasured. Pool names come only from the read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { EarliestReset, PoolRunwayAnswer, PoolRunwayWire } from '../../shared/loadLines';
import { api, ApiError } from '../src/lib/api';
import { CapacityLine } from '../src/overlord/CapacityLine';
import { CAPACITY_WORDS, CROSSING_WHY, capacityView, resetText, runwayText, spanWords } from '../src/overlord/runwayWords';

const NOW_S = 1_800_000_000;
const MIN = 60;
const HOUR = 3600;

const answer = (over: Partial<PoolRunwayAnswer> = {}): PoolRunwayAnswer => ({
  out: { kind: 'not-before-reset', resetS: NOW_S + 3 * 24 * HOUR },
  lines: { soft: { kind: 'unmeasured', why: 'no-sample' }, hard: { kind: 'unmeasured', why: 'no-sample' }, chat: { kind: 'unmeasured', why: 'no-sample' } },
  earliestReset: { kind: 'none-exhausted' }, ...over,
});
const wire = (pools: PoolRunwayWire['pools']): PoolRunwayWire => ({ ok: true, nowS: NOW_S, pools });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('runwayWords: every arm has its own sentence', () => {
  it('earliest reset: none-exhausted, a reset at atS, and unmeasured with each why', () => {
    expect(resetText({ kind: 'none-exhausted' }, NOW_S)).toBe('reset: no account is exhausted');
    expect(resetText({ kind: 'at', atS: NOW_S + 2 * HOUR + 5 * MIN }, NOW_S)).toBe('earliest reset in about 2 h 5 min');
    expect(resetText({ kind: 'at', atS: NOW_S + 3 * 24 * HOUR }, NOW_S)).toBe('earliest reset in about 3 d');
    expect(resetText({ kind: 'at', atS: NOW_S - 1 }, NOW_S)).toBe(`reset: ${CAPACITY_WORDS.resetDue}`);
    const whys: readonly Extract<EarliestReset, { kind: 'unmeasured' }>['why'][] = ['no-sample', 'rolled', 'stale', 'no-reset'];
    const said = whys.map((why) => resetText({ kind: 'unmeasured', why }, NOW_S));
    expect(new Set(said).size).toBe(4);
    for (const [i, why] of whys.entries()) expect(said[i]).toBe(`earliest reset: unmeasured (${CROSSING_WHY[why]})`);
  });
  it('runway: a projected crossing, one already observed, not before the reset, and unmeasured', () => {
    expect(runwayText({ kind: 'at', atS: NOW_S + 90 * MIN }, NOW_S)).toBe('runway: runs out in about 1 h 30 min');
    expect(runwayText({ kind: 'at', atS: NOW_S }, NOW_S)).toBe(`runway: ${CAPACITY_WORDS.outNow}`);
    expect(runwayText({ kind: 'not-before-reset', resetS: NOW_S + 5 * HOUR }, NOW_S)).toBe('runway: not out before its reset, in about 5 h');
    expect(runwayText({ kind: 'unmeasured', why: 'thin' }, NOW_S)).toBe(`runway: unmeasured (${CROSSING_WHY.thin})`);
  });
  it('a span is never negative, and a weekly span is in days', () => {
    expect(spanWords(-5000)).toBe('0 min');
    expect(spanWords(47 * 3_600_000)).toBe('47 h');
    expect(spanWords(48 * 3_600_000)).toBe('2 d');
  });
  it('capacityView: hidden while loading and for an older server; unmeasured with its words; a stale read keeps its pools', () => {
    expect(capacityView({ state: 'loading' })).toEqual({ kind: 'hidden' });
    expect(capacityView({ state: 'absent' })).toEqual({ kind: 'hidden' });
    expect(capacityView({ state: 'unmeasured', error: 'HTTP 503' })).toEqual({ kind: 'unmeasured', text: 'Capacity unmeasured (HTTP 503)' });
    const stale = capacityView({ state: 'stale', value: wire([{ pool: 'pool-a', runway: answer() }]), at: 1, error: 'timeout' });
    expect(stale).toMatchObject({ kind: 'pools', stale: CAPACITY_WORDS.stale });
  });
});

describe('CapacityLine', () => {
  it('draws each pool\'s runway and reset; a pool of null is "untagged accounts"; names come from the read', async () => {
    vi.spyOn(api, 'poolRunway').mockResolvedValue(wire([
      { pool: 'pool-a', runway: answer({ out: { kind: 'at', atS: NOW_S + 2 * HOUR }, earliestReset: { kind: 'at', atS: NOW_S + HOUR } }) },
      { pool: null, runway: answer({ out: { kind: 'unmeasured', why: 'no-sample' }, earliestReset: { kind: 'unmeasured', why: 'rolled' } }) },
    ]));
    const { container } = render(<CapacityLine />);
    await screen.findByText('pool-a');
    const rows = [...container.querySelectorAll('[data-capacity-pool]')].map((r) => r.textContent);
    expect(rows).toEqual([
      `pool-arunway: runs out in about 2 hearliest reset in about 1 h`,
      `${CAPACITY_WORDS.untagged}runway: unmeasured (${CROSSING_WHY['no-sample']})earliest reset: unmeasured (${CROSSING_WHY.rolled})`,
    ]);
  });

  it('draws the none-exhausted sentence', async () => {
    vi.spyOn(api, 'poolRunway').mockResolvedValue(wire([{ pool: 'pool-b', runway: answer() }]));
    render(<CapacityLine />);
    expect(await screen.findByText('reset: no account is exhausted')).toBeInTheDocument();
  });

  it('draws NO line for a 404 (an older server), and none while the read is in flight', async () => {
    let release: (v: { absent: true }) => void = () => {};
    vi.spyOn(api, 'poolRunway').mockReturnValue(new Promise((r) => { release = r; }));
    const { container } = render(<CapacityLine />);
    expect(container.querySelector('[data-overlord-capacity]')).toBeNull();
    release({ absent: true });
    await waitFor(() => expect(api.poolRunway).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.querySelector('[data-overlord-capacity]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('a 503 reads unmeasured, never "no runway"', async () => {
    vi.spyOn(api, 'poolRunway').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    const { container } = render(<CapacityLine />);
    expect(await screen.findByText('Capacity unmeasured (HTTP 503)')).toBeInTheDocument();
    expect(container.querySelector('[data-capacity-pool]')).toBeNull();
    expect(container.textContent).not.toMatch(/no runway/i);
  });

  it('a 2xx body without its list is a failure, not an empty line', async () => {
    vi.spyOn(api, 'poolRunway').mockResolvedValue({ ok: true } as unknown as PoolRunwayWire);
    render(<CapacityLine />);
    expect(await screen.findByText('Capacity unmeasured (unreadable answer)')).toBeInTheDocument();
  });
});
