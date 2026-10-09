// THE RECYCLED SLUG, FORCED AT EVERY STEP BOUNDARY (child-workspace reclamation wave 7, spec 2026-09-22 §5.10).
// The collector's argument: every hand-out of `~/.cc-tmp/<id>` goes through `_child_tmpdir`, which needs `.child`. So
// a spawn on a recycled slug BEFORE the move is seen by step 5's direct lookup and the leaf goes back to it; a spawn
// AFTER the move gets a NEW inode from `mkdir -p`, which step 6 never touches, because it removes only the slot's
// inode, dev:ino-checked. Here a real `_child_tmpdir` runs at each boundary, and each case asserts that the new child's
// leaf stands — restored, kept beside a kept record, or never touched. Never removed. And a straggler that re-creates
// the leaf after the move makes a new, unwitnessed inode that is never taken.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.10).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, G2_RUN, LINUX, NO_COPY, SNAPSHOT_GAP, collectAudit, collectVerb, devinoOf, docOf, factsOf, g2Departs, g2Row,
  g2Spawn, gapAt, gapErrorsOf, gapsOf, lastVerdict, orphanLeaf, quarantineOf, recordsOf, settle, shownRounds, slotsOf,
  tokenOf, witnessField, witnessOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-spawn-'); });
afterEach(() => { h.cleanup(); });

const handedTo = (): string => fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8');

describe.skipIf(!LINUX || !NO_COPY)('the seam: ten step boundaries, in the quarantine order, each at the disk state it names', () => {
  it('a fresh collection: record, slot, move, re-proofs, the slot\'s leaf, the slot, the witness — and the record LAST', () => {
    orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, SNAPSHOT_GAP);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    // Five flags per point: the leaf at the id · a record · a slot · the slot's leaf · the witness.
    expect(factsOf(h)).toEqual([
      ['locked', '10001'], ['consented', '10001'], ['recorded', '11001'], ['slotted', '11101'],
      ['moved', '01111'], ['proven', '01111'], ['removed', '01101'], ['emptied', '01001'],
      ['witnessed', '01000'], ['dropped', '00000'],
    ]);
  }, 120_000);
});

describe.skipIf(!LINUX || !NO_COPY)('a recycled spawn that ADOPTS the old leaf before the move: the leaf goes back to it, whole', () => {
  /** What stands after every arm: the adopted leaf at the id, the same inode, both children's scratch in it, no record,
   *  no slot, and the witness the new child's. */
  const adoptedStandsWhole = (o: { leaf: string; devino: string }): void => {
    expect(devinoOf(o.leaf), 'the new child\'s leaf is the inode it was handed').toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'its scratch survives').toBe('g2 scratch\n');
    expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8'), 'the old scratch is back with it').toBe('old work\n');
    expect(recordsOf(h), 'no record is kept').toEqual([]);
    expect(slotsOf(h), 'and no slot').toEqual([]);
    expect(witnessField(h, 'run'), 'the witness is the new child\'s').toBe(G2_RUN);
  };

  it.each(['locked', 'consented', 'recorded', 'slotted'] as const)(
    'spawned at `%s`: refused; the adopted leaf stands at the id; no record, no slot',
    (point) => {
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ [point]: `${g2Row()} && ${g2Spawn()}` }));
      expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
      expect(gapsOf(h), 'the CONTROL: at its point').toContain(point);
      expect(handedTo(), 'the CONTROL: `mkdir -p` ADOPTED the old leaf').toBe(o.leaf);
      const d = docOf(r.stdout);
      if (point === 'locked') {
        // Ruled (T8 OPEN5): a spawn at the `locked` boundary answers `registered`. The fork's registry rung refuses
        // before the token is compared, and before anything is written.
        expect(r.code, r.stdout + r.stderr).toBe(0);
        expect(d['refused'], r.stdout).toBe('registered');
        expect(gapsOf(h), 'refused inside step 1').toEqual(['locked']);
      } else if (point === 'consented') {
        // AMENDED, ruled `spawn-at-consented-stops-at-the-record` (it follows from Task 6's
        // `record-written-from-a-fresh-witness-read`): the spawn's `_child_tmpdir` rewrote the witness
        // for its own run, and the verb re-reads the witness directly before it writes the record, then reads the record
        // back against what the consent bound. The run differs, so the record is dropped before any slot is made:
        // `failed probe-unmeasured`, a retry, and nothing was moved. The next audit then sees the row.
        expect(r.code, r.stdout + r.stderr).toBe(1);
        expect(d['failed'], r.stdout).toBe('probe-unmeasured');
        expect(String(d['detail']), 'stopped by the read-back, not by a later proof').toContain('its witness is not the one the consent bound');
        expect(gapsOf(h), 'refused before any slot was made').toEqual(['locked', 'consented', 'recorded']);
        const next = docOf(collectAudit(h).stdout);
        expect(next['verdict'], `the next audit sees the new child's row: ${JSON.stringify(next)}`).toBe('registered');
        expect(next['token'], 'and offers no token').toBeUndefined();
      } else {
        expect(r.code, r.stdout + r.stderr).toBe(0);
        expect(d['refused'], r.stdout).toBe('registered');
        expect(gapsOf(h), 'the leaf was moved, and moved back').toContain('moved');
        expect(gapsOf(h), 'step 5 refused, so step 6 never ran').not.toContain('proven');
      }
      adoptedStandsWhole(o);
    },
    120_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('a recycled spawn AFTER the move: a new inode, never touched', () => {
  it('at `moved`: the restore is refused (NOREPLACE) — the new child\'s EMPTY leaf is never replaced — and the record and slot are KEPT until that child leaves', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ moved: `${g2Row()} && ${g2Spawn(COL_ID, '')}` }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    const g2 = devinoOf(o.leaf);
    expect(g2, 'the new child was handed a NEW inode at the id').not.toBeNull();
    expect(g2).not.toBe(o.devino);
    expect(fs.readdirSync(o.leaf), 'untouched, and still EMPTY: a restore that replaced it would have filled it').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    const slots = slotsOf(h);
    expect(slots, 'one slot is kept').toHaveLength(1);
    expect(recordsOf(h), 'named by its record').toEqual([slots[0]!.slice('slot.'.length)]);
    const kept = path.join(quarantineOf(h), slots[0]!, 'leaf');
    expect(devinoOf(kept), 'the old leaf is kept in its slot').toBe(o.devino);
    // While the new child holds the slug, no audit licenses anything, and nothing moves.
    for (let i = 0; i < 2; i += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['token'], `audit ${i + 1} offers no token while a child holds the slug: ${JSON.stringify(d)}`).toBeUndefined();
    }
    expect(devinoOf(kept)).toBe(o.devino);
    expect(devinoOf(o.leaf)).toBe(g2);
    // It leaves, as its own reclaim leaves it: the record is resumed, and only the record's inode goes.
    g2Departs(h);
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(kept), 'the kept leaf went once nothing held the slug').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('SPLIT — `.child` written at `slotted`, the `mkdir -p` at `moved`: the same — a new inode, the restore refused, kept', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: g2Row(), moved: g2Spawn() }));
    expect(gapErrorsOf(h), 'the CONTROL: both halves ran').toEqual([]);
    expect(devinoOf(o.leaf), 'a NEW inode at the id').not.toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'the new child\'s scratch survives').toBe('g2 scratch\n');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    const slots = slotsOf(h);
    expect(slots).toHaveLength(1);
    expect(devinoOf(path.join(quarantineOf(h), slots[0]!, 'leaf')), 'the old leaf is kept in its slot').toBe(o.devino);
    expect(recordsOf(h)).toEqual([slots[0]!.slice('slot.'.length)]);
  }, 120_000);

  it.each(['proven', 'removed'] as const)(
    'at `%s`: step 6 removes the slot\'s inode alone; the new leaf and the new witness stand (compare-and-drop)',
    (point) => {
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ [point]: `${g2Row()} && ${g2Spawn()}` }));
      expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
      const g2 = fs.lstatSync(o.leaf, { bigint: true });
      expect(`${g2.dev}:${g2.ino}`, 'a NEW inode at the id').not.toBe(o.devino);
      expect(fs.readFileSync(path.join(o.leaf, 'g2.txt'), 'utf8'), 'the new child\'s scratch survives').toBe('g2 scratch\n');
      expect(witnessField(h, 'run'), 'the new child\'s witness stands').toBe(G2_RUN);
      expect(witnessField(h, 'ino'), 'naming the new inode').toBe(String(g2.ino));
      expect(slotsOf(h)).toEqual([]);
      expect(recordsOf(h)).toEqual([]);
    },
    120_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('a straggler re-creating the leaf after the move', () => {
  it('at `moved`, with no row and no marker: a new, UNWITNESSED inode — the slot\'s leaf is collected, the straggler\'s is never taken', () => {
    const o = orphanLeaf(h);
    const straggle = `mkdir -p -- "${o.leaf}" && printf 'straggler\\n' > "${o.leaf}/s.txt"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ moved: straggle }));
    expect(gapErrorsOf(h), 'the CONTROL: the straggler ran').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(devinoOf(o.leaf), 'a NEW inode at the id').not.toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 's.txt'), 'utf8'), 'the straggler\'s new leaf stands').toBe('straggler\n');
    expect(fs.existsSync(witnessOf(h)), 'the collected witness went with the collected leaf').toBe(false);
    for (let i = 0; i < 2; i += 1) {
      expect(docOf(collectAudit(h).stdout)['verdict'], 'an unwitnessed leaf is nothing to collect').toBe('not-witnessed');
    }
    expect(fs.readFileSync(path.join(o.leaf, 's.txt'), 'utf8')).toBe('straggler\n');
  }, 120_000);
});
