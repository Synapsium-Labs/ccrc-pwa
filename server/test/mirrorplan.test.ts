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
