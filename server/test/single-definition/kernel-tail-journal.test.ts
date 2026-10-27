// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
// W8's journal chain (D-7058; ARCH-73 #808, its journal half; plan 2026-10-26-consolidation-w8-journals-spawn-launchd.md,
// Task C8f): the log-first journals' epoch reader, their MAX(file, db) floor and their journal-before-row order are
// `server/src/journalKernel.ts`'s, stated once. Each count reached its wave target in C8f, so each is pinned here,
// may-only-shrink at zero (spec 2026-10-19 §5.1 rule 3); the lists come from `census-w8/journal.ts`'s named queries.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { REPO } from '../consolidationCensus.js';
import { appendBeforeApplySites, epochFloorReaders, journalFloorSites } from '../census-w8/journal.js';
import { parsedFile } from '../scan/symbols.js';

describe('the journal kernel: one epoch reader, one floor, one append-then-apply (D-7058)', () => {
  it('no epoch regex under server/src outside journalKernel.ts (byte-twin readers 2 -> 1, maxJournalEpoch)', () => {
    expect(epochFloorReaders(), 'a journal reader hand-rolls `"epoch":(\\d+)`: hand its text to maxJournalEpoch').toEqual([]);
  });

  it('no hand-written MAX(file, db) floor under server/src outside journalKernel.ts (3 -> 0, journalFloor)', () => {
    expect(journalFloorSites(), 'a writer takes MAX(file, db) by hand: call journalFloor').toEqual([]);
  });

  it('no hand-written journal-then-row ordering in store.ts outside appendThenApply (4 -> 0, setCollectLane moved)', () => {
    expect(appendBeforeApplySites(), 'a tx() appends a journal and then writes a row by hand: use appendThenApply').toEqual([]);
  });

  it('the kernel imports nothing (ring L1, no I/O)', () => {
    expect(parsedFile(path.join(REPO, 'server/src/journalKernel.ts')).imports).toEqual([]);
  });
});
