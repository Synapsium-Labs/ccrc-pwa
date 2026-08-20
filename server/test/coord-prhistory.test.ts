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
    // Full-object equality, not `objectContaining({ pr })` — finding 1. The
    // `objectContaining` form asserts only `pr`, so a mapping bug at the push
    // site (`branch`/`phase`/`recordedAt` swapped for constants) is invisible
    // to this suite. Measured: `entries.push({ pr: o['pr'], branch: '',
    // phase: '', recordedAt: 0 })` left the pre-fix suite at 8/8 green.
    const d = reg();
    writeFileSync(path.join(d, 'demo-quiet-mesa.prhistory'), `${LINE(1)}\n${LINE(2)}\n`);
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({
      ok: true,
      entries: [
        { pr: 1, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 },
        { pr: 2, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 },
      ],
    });
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
      readFileMeasured: async (p) => {
        if (p !== f) return localIO.readFileMeasured(p);
        reads += 1;
        return reads === 1 ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p);
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

  // Fix-round finding 5, RE-REVIEWED (findings 2 and 4). The prior version of
  // this case wrote ONE record wrong in three fields at once
  // (`{"pr":"577","branch":null,"phase":7}`) plus a bare `{}` — both die on
  // the very FIRST guard (`typeof o['pr'] !== 'number'`), so every later
  // guard is unreachable in the reject direction and the record read as
  // covered when it wasn't. Measured, one construct at a time, restored
  // between (baseline 8/8 green): dropping `!Number.isInteger(o['pr'])`
  // alone, dropping `typeof o['branch'] !== 'string' || typeof o['phase']
  // !== 'string'` alone, and dropping `typeof o['recordedAt'] !== 'number'`
  // alone each left the bundled fixture byte-identical — only deleting all
  // four guard lines together killed it. Each case below is wrong in exactly
  // ONE field, everything else well-typed, so each guard construct has its
  // own fixture that dies with it.
  it('drops a line whose pr is the wrong type', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      `${JSON.stringify({ pr: '577', branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 })}\n`,
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('drops a line whose pr is a number but not an integer', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      `${JSON.stringify({ pr: 577.5, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 })}\n`,
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('drops a line whose branch is the wrong type', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      `${JSON.stringify({ pr: 577, branch: null, phase: 'merged', recordedAt: 1 })}\n`,
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('drops a line whose phase is the wrong type', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      `${JSON.stringify({ pr: 577, branch: 'ws/quiet-mesa', phase: 7, recordedAt: 1 })}\n`,
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('drops a line whose recordedAt is the wrong type', async () => {
    const d = reg();
    writeFileSync(
      path.join(d, 'demo-quiet-mesa.prhistory'),
      `${JSON.stringify({ pr: 577, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: '1' })}\n`,
    );
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });

  it('drops a completely empty object the same way', async () => {
    const d = reg();
    writeFileSync(path.join(d, 'demo-quiet-mesa.prhistory'), '{}\n');
    expect(await readPrHistory(localIO, d, 'demo-quiet-mesa')).toEqual({ ok: true, entries: [] });
  });
});
