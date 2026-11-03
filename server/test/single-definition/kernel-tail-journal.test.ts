// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
// W8's journal chain (D-7058; ARCH-73 #808, its journal half; plan 2026-10-26-consolidation-w8-journals-spawn-launchd.md,
// Task C8f): the log-first journals' epoch reader, their MAX(file, db) floor and their journal-before-row order are
// `server/src/journalKernel.ts`'s, stated once. Each count reached its wave target in C8f, so each is pinned here,
// may-only-shrink at zero (spec 2026-10-19 §5.1 rule 3); the lists come from `census-w8/journal.ts`'s named queries.
// Task C8g (D-7059) adds the NDJSON framer of the lifecycle mirror and the collect-lane journal (2 framers -> 1,
// `splitJournalRecords`), and the delegation journal's separation from the kernel (spec §3.19), each pinned the same way.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO } from '../consolidationCensus.js';
import {
  appendBeforeApplySites, appendThenApplyBreaks, delegationKernelImports, epochFloorReaders, journalFloorSites, journalFramers,
} from '../census-w8/journal.js';
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

  it('every appendThenApply call in store.ts is inside a tx() and appends before it writes', () => {
    expect(appendThenApplyBreaks(), 'a kernel call outside tx(), or one whose write precedes its journal append').toEqual([]);
  });

  it('the two store queries are not over nothing: store.ts parses, opens transactions and calls the kernel four times', () => {
    const calls = parsedFile(path.join(REPO, 'server/src/coord/store.ts')).calls;
    expect(calls.filter((c) => c.callee === 'tx').length).toBeGreaterThan(4);
    expect(calls.filter((c) => c.name === 'appendThenApply').map((c) => c.line)).toHaveLength(4);
  });

  it('no hand-rolled NDJSON framer in the lifecycle mirror or the collect-lane journal (2 -> 1, splitJournalRecords)', () => {
    expect(journalFramers(), 'a journal splits its text on newlines by hand: call splitJournalRecords').toEqual([]);
  });

  it('the framer query is not over nothing: frameRead and parseCollectLaneJournal each call splitJournalRecords', () => {
    const callers = (rel: string): string[] => parsedFile(path.join(REPO, rel)).calls
      .filter((c) => c.name === 'splitJournalRecords').map((c) => c.callee);
    expect(callers('server/src/coord/mirrorplan.ts')).toEqual(['splitJournalRecords']);
    expect(callers('server/src/collectLane.ts')).toEqual(['splitJournalRecords']);
  });

  it('the delegation journal stays separate: no coord/delegation-*.ts file imports journalKernel.ts (spec §3.19)', () => {
    expect(delegationKernelImports(), 'the delegation journal is an authority, not a projection: it shares nothing with the kernel')
      .toEqual([]);
    expect(readdirSync(path.join(REPO, 'server/src/coord')).filter((n) => /^delegation-.*\.ts$/.test(n)).length)
      .toBeGreaterThan(0);
  });

  it('the kernel imports nothing (ring L1, no I/O)', () => {
    expect(parsedFile(path.join(REPO, 'server/src/journalKernel.ts')).imports).toEqual([]);
  });
});
