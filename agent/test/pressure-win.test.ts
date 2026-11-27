// The Windows port, B2: /proc/meminfo is absent on Windows, so the session headroom read null and the automatic wakes'
// memory gate had no data. On win32 the unreadable meminfo now falls back to the host's available physical memory.
import { describe, expect, it } from 'vitest';
import { measureHeadroom } from '../src/pressure.js';

describe.skipIf(process.platform !== 'win32')('measureHeadroom on Windows (B2)', () => {
  it('the real read (no /proc) answers a positive byte count, not null', () => {
    const room = measureHeadroom();
    expect(room).not.toBeNull();
    expect(room!).toBeGreaterThan(0);
  });
});
