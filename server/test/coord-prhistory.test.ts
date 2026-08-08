import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readPrHistory } from '../src/coord/prhistory.js';
import { mkTmp } from './tmpHelpers.js';

const reg = (): string => {
  const d = path.join(mkTmp('ccrc-prh-'), '.cc-sessions');
  mkdirSync(d, { recursive: true });
  return d;
};
const LINE = (pr: number) =>
  JSON.stringify({ pr, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 });

describe('readPrHistory', () => {
  it('reads JSONL in order, dropping nothing it can parse', async () => {
    const d = reg();
    writeFileSync(path.join(d, 'demo-quiet-mesa.prhistory'), `${LINE(1)}\n${LINE(2)}\n`);
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa'))
      .toEqual({ ok: true, entries: [expect.objectContaining({ pr: 1 }), expect.objectContaining({ pr: 2 })] });
  });

  it('answers a MEASURED [] when the file is absent — the workspace retired no PR', async () => {
    expect(await readPrHistory(localIO, reg(), 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('skips a torn last line rather than rejecting the whole ledger', async () => {
    // ccd appends with O_APPEND from python; a record larger than the buffer
    // can split (`ccd/ccd:855-858` and the scout's own caveat). A half-line is
    // one lost record, not a lost history.
    const d = reg();
    writeFileSync(path.join(d, 'demo-quiet-mesa.prhistory'), `${LINE(1)}\n{"pr":2,"bra`);
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa'))
      .toEqual({ ok: true, entries: [expect.objectContaining({ pr: 1 })] });
  });

  // The `chmod 000` case does not discriminate when the suite runs as root
  // (CI does not; the fleet host does not) — root reads through any mode bit.
  // Guarded rather than silently passing for the wrong reason.
  it.skipIf(process.getuid?.() === 0)(
    'REFUSES when the file is present and unreadable — not knowing is not []', async () => {
      const d = reg();
      const f = path.join(d, 'demo-quiet-mesa.prhistory');
      writeFileSync(f, `${LINE(1)}\n`);
      chmodSync(f, 0o000);
      expect(await readPrHistory(localIO, d, 'demo-quiet-mesa'))
        .toEqual({ ok: false, error: 'unreadable' });
    });
});
