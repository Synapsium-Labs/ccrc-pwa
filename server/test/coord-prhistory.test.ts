import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetIO } from '../src/io.js';
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

  // Fix-round finding 1. The pre-fix reader read-then-listed with no second
  // look: a file CREATED in the gap between the two — exactly what ccd's one
  // append chokepoint does at a merge, the moment a run is most likely to
  // close — named itself in the listing with nothing behind the first read,
  // and was reported `unreadable` about a file that was present, readable and
  // correct. Modelled with a stub `FleetIO` rather than a real race (which
  // cannot be made deterministic): `readdir` plays the role of "something else
  // wrote the file just now", and the assertion is that the SECOND read, not
  // the listing, is what the reader trusts.
  it('re-reads rather than refusing when the file appears between the read and the listing', async () => {
    const d = reg();
    const f = path.join(d, 'demo-quiet-mesa.prhistory');
    let reads = 0;
    const io: FleetIO = {
      ...localIO,
      readFile: async (p) => {
        if (p !== f) return localIO.readFile(p);
        reads += 1;
        return reads === 1 ? null : localIO.readFile(p);
      },
      readdir: async (p) => {
        // The race, spelled directly: the file did not exist for the read
        // above and exists by the time anything lists the directory.
        writeFileSync(f, `${LINE(1)}\n`);
        return localIO.readdir(p);
      },
    };
    expect(await readPrHistory(io, d, 'demo-quiet-mesa'))
      .toEqual({ ok: true, entries: [expect.objectContaining({ pr: 1 })] });
    expect(reads).toBe(2);
  });

  // Fix-round finding 4. `listing === null` is the arm production actually
  // takes (remote mode makes `readdir` an agent round trip — README:445), and
  // the pre-fix suite never exercised it: every case above uses a registry dir
  // that exists and is readable, so `io.readdir` never returned null anywhere
  // in this file. Both cases below need no root dependency and no mocking —
  // measured against the unmutated reader before this fix landed.
  it('REFUSES when the registry directory itself does not exist — no listing, no evidence', async () => {
    const d = path.join(mkTmp('ccrc-prh-'), 'never-created', '.cc-sessions');
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa'))
      .toEqual({ ok: false, error: 'unreadable' });
  });

  it.skipIf(process.getuid?.() === 0)(
    'REFUSES when the registry directory itself is unreadable — chmod 000 on the DIRECTORY', async () => {
      const parent = mkTmp('ccrc-prh-');
      const d = path.join(parent, '.cc-sessions');
      mkdirSync(d);
      chmodSync(d, 0o000);
      try {
        expect(await readPrHistory(localIO, d, 'demo-quiet-mesa'))
          .toEqual({ ok: false, error: 'unreadable' });
      } finally {
        chmodSync(d, 0o755); // restore — afterAll's recursive rm needs to list it
      }
    });

  // Fix-round finding 5. The four shape guards (`pr` a real integer, `branch`
  // and `phase` strings, `recordedAt` a number) reject valid JSON that is the
  // wrong SHAPE — a case distinct from the torn-tail test above, which never
  // reaches the guards at all because `JSON.parse` throws first. Pre-fix,
  // deleting all four guard lines left every test in this file byte-identical
  // — this is the case that tells the difference.
  it('drops a line that parses as JSON but fails the shape guards — wrong types, not bad syntax', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      '{"pr":"577","branch":null,"phase":7}\n{}\n',
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });
});
