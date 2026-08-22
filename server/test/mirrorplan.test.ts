// L1, pure. `frameRead` is the whole of D5's "framing is complete inside one
// call": `readFileFrom` returns [cursor, size) in one shot, a trailing PARTIAL
// line is not consumed, and the cursor advances only to the end of the last
// complete line. THERE IS NO CROSS-CALL CARRY BUFFER ANYWHERE IN THE MIRROR,
// so there is no splice class — and these assertions are what makes that a
// mechanism rather than a claim.
import { describe, it, expect } from 'vitest';
import { frameRead } from '../src/coord/mirrorplan.js';

describe('frameRead: the partial trailing line is NOT consumed', () => {
  it('takes the complete lines and stops the cursor at the last LF', () => {
    const data = 'a\nbb\nccc';        // 2 + 3 + 3 bytes, last line incomplete
    const r = frameRead(100, data, 110, 100);
    expect(r.lines).toEqual(['a', 'bb']);
    expect(r.nextCursor).toBe(100 + 'a\nbb\n'.length);   // 105, NOT 110
    expect(r.shrank).toBe(false);
  });

  it('consumes nothing at all when no LF has arrived yet', () => {
    const r = frameRead(100, '{"uid":"1.2', 111, 100);
    expect(r.lines).toEqual([]);
    expect(r.nextCursor).toBe(100);
  });

  it('consumes everything when the payload ends on an LF', () => {
    const r = frameRead(0, 'a\nb\n', 4, 0);
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.nextCursor).toBe(4);
  });

  it('answers an empty payload with the cursor unmoved — a cursor at EOF is a POSITIVE answer', () => {
    // `readFileFrom` clamps and returns {data:'', size} when from >= size
    // (`io.ts:101-102`), which is what makes "no cross-call carry buffer" true.
    const r = frameRead(410, '', 410, 410);
    expect(r.lines).toEqual([]);
    expect(r.nextCursor).toBe(410);
    expect(r.shrank).toBe(false);
  });

  it('counts BYTES, not characters — a multibyte line must not shift the cursor', () => {
    const data = '{"reason":"héllo ☃"}\n{"partial":';
    const complete = '{"reason":"héllo ☃"}\n';
    const size = Buffer.byteLength(data, 'utf8');
    const r = frameRead(0, data, size, 0);
    expect(r.lines).toEqual(['{"reason":"héllo ☃"}']);
    expect(r.nextCursor).toBe(Buffer.byteLength(complete, 'utf8'));
    expect(r.nextCursor).not.toBe(complete.length);   // bytes vs chars
  });

  it('drops a blank line without stranding the cursor behind it', () => {
    const r = frameRead(0, 'a\n\nb\n', 5, 0);
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.nextCursor).toBe(5);
  });
});

describe('frameRead: a shrink is an ANSWER, not a stall', () => {
  it('reports a shrink and resets the cursor to 0 when size is behind the cursor', () => {
    // An immutably-named generation got smaller: a truncation. `agent/src/
    // tail.ts:53-58` hands the reader a reset it must model, which is exactly
    // why D5 polls instead.
    const r = frameRead(4096, '', 100, 4096);
    expect(r.shrank).toBe(true);
    expect(r.nextCursor).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('calls a shrink a shrink EVEN WHEN THE NEW SIZE IS STILL AHEAD OF THE CURSOR', () => {
    // The condition a cursor test cannot see. Truncated 4096 -> 200 with the
    // cursor at 100: `size > cursor`, so a cursor-only test reads ordinary
    // growth and the mirror ingests the tail of a DIFFERENT file with no gap
    // row — the silent skip D6 forbids, and the reason
    // `lifecycle_generations.size` is a column that is read back.
    const r = frameRead(100, 'a\n', 200, 4096);
    expect(r.shrank).toBe(true);
    expect(r.nextCursor).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('does not call an unchanged size a shrink, and does not call growth one either', () => {
    expect(frameRead(100, '', 100, 100).shrank).toBe(false);
    expect(frameRead(100, 'a\n', 4096, 100).shrank).toBe(false);
  });
});

import { planSweep, type KnownGeneration } from '../src/coord/mirrorplan.js';
import { LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX } from '../../shared/api.js';
import { genFile } from './lifecycleHelpers.js';

const G1 = '1755780000000000000';
const G2 = '1755790000000000000';
const known = (over: Partial<KnownGeneration> = {}): KnownGeneration =>
  ({ gen: G1, cursor: 0, size: 0, retired: false, ...over });

describe('planSweep: an unlistable directory is a FAIL-SHUT, not an empty fleet', () => {
  it('plans nothing and retires nothing when readdir answered null', () => {
    const p = planSweep(null, [known({ cursor: 10, size: 400 })]);
    expect(p.listed).toBe(false);
    expect(p.reads).toEqual([]);
    expect(p.gaps).toEqual([]);
    expect(p.retire).toEqual([]);     // an agent WS drop must not retire a live generation
    expect(p.unorderable).toEqual([]);
  });
});

describe('planSweep: reads', () => {
  it('ignores every name in the directory that is not a generation', () => {
    const p = planSweep([LC_ERRORS_NAME, LC_ROTATE_LOCK_NAME, 'README', genFile(G1)], []);
    expect(p.reads).toEqual([{ gen: G1, from: 0, lastSize: 0 }]);
    expect(p.unorderable).toEqual([]);
  });

  it('reads a generation it has never seen from offset 0, oldest first', () => {
    const p = planSweep([genFile(G2), genFile(G1), LC_ERRORS_NAME], []);
    expect(p.reads).toEqual([
      { gen: G1, from: 0, lastSize: 0 }, { gen: G2, from: 0, lastSize: 0 },
    ]);
  });

  it('orders by MAGNITUDE, not lexicographically — a 20-digit name is newer, not older', () => {
    // The bug `compareGenerations` exists to prevent: `.sort()` puts
    // '10000000000000000000' before '9999999999999999999', so the live
    // generation reads as an old one and the mirror ingests a stale file
    // forever.
    const big = '10000000000000000000';
    const small = '9999999999999999999';
    expect(planSweep([genFile(big), genFile(small)], []).reads.map((r) => r.gen))
      .toEqual([small, big]);
  });

  it('resumes a known generation at its cursor AND carries its last measured size', () => {
    const p = planSweep([genFile(G1)], [known({ cursor: 410, size: 4096 })]);
    expect(p.reads).toEqual([{ gen: G1, from: 410, lastSize: 4096 }]);
  });

  it('re-reads a generation that came BACK after being retired, and records no new gap', () => {
    const p = planSweep([genFile(G1)], [known({ cursor: 410, size: 410, retired: true })]);
    expect(p.reads).toEqual([{ gen: G1, from: 410, lastSize: 410 }]);
    expect(p.gaps).toEqual([]);
  });
});

describe('planSweep: a rotated-away generation is a RECORDED GAP, never a silent skip', () => {
  it('records the undrained bytes and retires the generation', () => {
    const p = planSweep([genFile(G2)], [known({ cursor: 100, size: 4096 })]);
    expect(p.retire).toEqual([G1]);
    expect(p.gaps).toHaveLength(1);
    expect(p.gaps[0]).toMatchObject({
      gen: G1, reason: 'rotated-away', lostFrom: 100, lostTo: 4096,
    });
    expect(p.gaps[0]!.detail).toContain('3996');
  });

  it('retires a FULLY DRAINED generation with no gap — nothing was lost', () => {
    const p = planSweep([genFile(G2)], [known({ cursor: 4096, size: 4096 })]);
    expect(p.retire).toEqual([G1]);
    expect(p.gaps).toEqual([]);
  });

  it('does not re-record a gap for a generation already retired', () => {
    const p = planSweep([genFile(G2)], [known({ cursor: 100, size: 4096, retired: true })]);
    expect(p.gaps).toEqual([]);
    expect(p.retire).toEqual([]);
  });
});

describe('planSweep: a name that LOOKS like a generation but cannot be ORDERED', () => {
  it('names it rather than reading it or ignoring it — it is a hole, not an absence', () => {
    // `looksLikeGenerationFile` true, `parseLifecycleGeneration` null: the
    // mirror saw a file it cannot place in the sequence. Reading it would put
    // it in the wrong place; ignoring it would be the silent skip D6 forbids.
    // The caller records ONE gap per name per process (`JournalMirror`).
    const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
    const p = planSweep([broken, genFile(G1)], []);
    expect(p.unorderable).toEqual([broken]);
    expect(p.reads).toEqual([{ gen: G1, from: 0, lastSize: 0 }]);
  });
});

describe('planSweep: the LifecycleGap invariant — lostFrom/lostTo are coupled, never independently null (task 31 ruling)', () => {
  // `LifecycleGap.lostFrom`/`lostTo` are two INDEPENDENT nullable fields on
  // the wire type (matching Task 27's two schema columns), so nothing in the
  // TYPE stops `{lostFrom: 500, lostTo: null}` or a precise range under
  // `reason:'unknown'`. `planSweep` is the only place in the mirror that
  // constructs a `PlannedGap`, so the invariant is enforced and proven HERE:
  // the two fields are always both null or both numbers, and `reason:
  // 'unknown'` always carries a null pair.
  it('every gap planSweep produces has lostFrom/lostTo both null or both numbers, and reason "unknown" implies both null', () => {
    const scenarios = [
      planSweep([genFile(G2)], [known({ cursor: 100, size: 4096 })]),
      planSweep([genFile(G2)], [known({ cursor: 0, size: 4096 })]),
      planSweep([genFile(G2), genFile(G1)], []),
    ];
    for (const p of scenarios) {
      for (const g of p.gaps) {
        expect.soft(
          (g.lostFrom === null) === (g.lostTo === null),
          `gen ${g.gen}: lostFrom=${String(g.lostFrom)} lostTo=${String(g.lostTo)} must be coupled`,
        ).toBe(true);
        if (g.reason === 'unknown') {
          expect.soft(g.lostFrom, `reason 'unknown' implies lostFrom null for gen ${g.gen}`).toBeNull();
          expect.soft(g.lostTo, `reason 'unknown' implies lostTo null for gen ${g.gen}`).toBeNull();
        }
      }
    }
  });
});

import { lifecycleState, shouldSweep, LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';

const st = (over: Partial<Parameters<typeof lifecycleState>[0]> = {}) => lifecycleState({
  ccdVerbs: ['ws-rm', LC_CAP_TOKEN], lastOkAt: 1_000_000, nowMs: 1_002_000, staleAfterMs: 15_000,
  ...over,
});

describe("lifecycleState: an old ccd's silence must not read as a quiet fleet", () => {
  it('says `unavailable` when caps were measured and lifecycle-v1 is not among them', () => {
    expect(st({ ccdVerbs: ['ws-rm', 'stop-surface'] })).toBe('unavailable');
  });

  it('degrades a NULL caps list to the sweep\'s own freshness — never to `unavailable`', () => {
    // `ccdVerbs === null` is local mode, or an agent old enough not to send a
    // list. `verbSupported`'s own default permits on no evidence for the same
    // reason: an absent list must never grey out the fleet. Here the cost of
    // guessing wrong is one readdir per sweep.
    expect(st({ ccdVerbs: null })).toBe('ok');
  });

  it('says `unknown` when there is no caps evidence AND no sweep has succeeded', () => {
    expect(st({ ccdVerbs: null, lastOkAt: null })).toBe('unknown');
  });

  it('says `unknown` before any sweep has succeeded', () => {
    expect(st({ lastOkAt: null })).toBe('unknown');
  });

  it('says `ok` inside the staleness window and `stale` outside it', () => {
    expect(st({ nowMs: 1_014_999 })).toBe('ok');
    expect(st({ nowMs: 1_015_000 })).toBe('stale');
  });

  it('does not call a FUTURE-dated lastOk fresh', () => {
    // The `>= 0` guard `sessionLifecycle` carries for the identical reason —
    // without it a skewed clock reads fresh forever.
    expect(st({ nowMs: 999_000 })).toBe('stale');
  });
});

describe('shouldSweep', () => {
  it('sweeps on every state except a MEASURED absence of the capability', () => {
    expect(shouldSweep('unavailable')).toBe(false);
    for (const s of ['ok', 'stale', 'unknown'] as const) expect(shouldSweep(s)).toBe(true);
  });
});
