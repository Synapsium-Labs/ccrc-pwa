// A SIGKILL AFTER EVERY STEP (child-workspace reclamation wave 7, spec 2026-09-22 §5.10). The quarantine record is
// written FIRST and dropped LAST, so a crash at any point leaves it, and it — not the witness, not the journal — is the
// authority the next audit resumes from. Each case kills the verb at one point, checks the invariants at the instant
// of death (no slot without its record; the leaf's inode in exactly one place), then runs "the next audit and verb" to
// quiescence: the job is finished, and nothing but the record's own inode was removed. Then the witness is rewritten,
// dropped and deleted under a standing record: the record is found whatever the witness says. And the record itself is
// lost out of band while its slot stands: the slot is the operator's, listed on every audit, never dropped in silence.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only (`/proc/<pid>/stat`), and only where `mv --no-copy` exists.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, DEAD_RUN, G2_RUN, LINUX, NO_COPY, POINTS, TOKEN, collectAudit, collectVerb, crashAt, crashedAt, custodyHolds,
  devinoOf, docOf, g2Departs, g2Row, g2Spawn, lastVerdict, orphanLeaf, quarantineOf, recordDirOf, recordsOf, settle,
  shownRounds, slotsOf, tokenOf, verdictOf, witnessField, witnessOf, type Orphan,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-crash-'); });
afterEach(() => { h.cleanup(); });

const OTHER = 'demo-quiet-river';
const DECOY = `slot.${COL_ID}.1.1`;
const ours = (): string[] => slotsOf(h).filter((s) => s !== DECOY);
const at = (p: (typeof POINTS)[number]): number => POINTS.indexOf(p);

/** What a resume must never touch: another id's witnessed orphan, and a slot carrying THIS id's own name that no
 *  record names — a slot with no record is never visited. */
const plantDecoys = (): { other: Orphan; forged: string } => {
  const other = orphanLeaf(h, OTHER);
  const forged = path.join(quarantineOf(h), DECOY, 'leaf');
  fs.mkdirSync(forged, { recursive: true });
  fs.chmodSync(quarantineOf(h), 0o700);
  fs.writeFileSync(path.join(forged, 'keep'), 'not the record\'s\n');
  return { other, forged };
};

describe.skipIf(!LINUX || !NO_COPY)('killed after each step: the next audit finds the record and finishes — removing only its inode', () => {
  it.each(POINTS.map((p, i) => [p, i] as const))('killed at `%s`', (point, i) => {
    const o = orphanLeaf(h);
    const d = plantDecoys();
    const r = collectVerb(h, tokenOf(h), COL_ID, crashAt(point));
    expect(crashedAt(h), 'the CONTROL: the kill fired where it was aimed').toBe(point);
    expect(docOf(r.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();

    // AT THE INSTANT OF DEATH.
    custodyHolds(h, COL_ID, [DECOY]);
    const recorded = i >= at('recorded') && i < at('dropped');
    expect(recordsOf(h), 'a record stands from `recorded` until it is dropped, LAST').toHaveLength(recorded ? 1 : 0);
    expect(fs.existsSync(witnessOf(h)), 'the witness stands until `witnessed`').toBe(i < at('witnessed'));
    const inSlot = ours().map((s) => path.join(quarantineOf(h), s, 'leaf'));
    const where = [o.leaf, ...inSlot].filter((p) => devinoOf(p) === o.devino);
    const expected = i < at('moved') ? [o.leaf] : i < at('removed') ? inSlot : [];
    expect(where, 'the leaf\'s inode: at the id before the move, in its slot until step 6, then nowhere').toEqual(expected);
    if (i >= at('moved') && i < at('removed')) expect(inSlot, 'one slot holds it').toHaveLength(1);

    // THE NEXT AUDIT FINDS THE RECORD, AND THE JOB IS FINISHED.
    const first = collectAudit(h);
    if (recorded) expect(docOf(first.stdout)['verdict'], 'a standing record is never "nothing to collect"').not.toBe('not-witnessed');
    expect(fs.existsSync(witnessOf(h)), 'the audit writes nothing').toBe(i < at('witnessed'));
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(o.leaf), 'collected').toBeNull();
    expect(ours(), 'no slot of the id is left').toEqual([]);
    expect(recordsOf(h), 'no record').toEqual([]);
    expect(fs.existsSync(witnessOf(h)), 'no witness').toBe(false);

    // NOTHING BUT THE RECORD'S INODE WAS REMOVED.
    expect(fs.readFileSync(path.join(d.forged, 'keep'), 'utf8'), 'a slot no record names is never visited').toBe('not the record\'s\n');
    expect(devinoOf(d.other.leaf), 'another id\'s orphan is untouched').toBe(d.other.devino);
    expect(witnessField(h, 'run', OTHER), 'and so is its witness').toBe(DEAD_RUN);
  }, 240_000);
});

describe.skipIf(!LINUX || !NO_COPY)('the record is found WHATEVER THE WITNESS SAYS', () => {
  /** The verb killed right after the move: the leaf in its slot, its record standing, the id's path empty. */
  const killedInSlot = (): { o: Orphan; rec: string; kept: string } => {
    const o = orphanLeaf(h);
    collectVerb(h, tokenOf(h), COL_ID, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: the kill fired').toBe('moved');
    const recs = recordsOf(h);
    const slots = slotsOf(h);
    expect(recs, 'the CONTROL: one record stands').toHaveLength(1);
    expect(slots, 'the CONTROL: one slot').toHaveLength(1);
    const kept = path.join(quarantineOf(h), slots[0]!, 'leaf');
    expect(devinoOf(kept), 'the CONTROL: the leaf is in its slot').toBe(o.devino);
    return { o, rec: recs[0]!, kept };
  };

  it('REWRITTEN by a recycled spawn: nothing moves while that child lives; once its own tail has DROPPED the witness, the record is resumed and only its inode goes', () => {
    const c = killedInSlot();
    h.sh(`${g2Row()} && ${g2Spawn()}`);
    const g2 = devinoOf(c.o.leaf);
    expect(g2, 'the CONTROL: a new inode at the id').not.toBe(c.o.devino);
    expect(witnessField(h, 'run'), 'the CONTROL: the witness now names the new child').toBe(G2_RUN);
    for (let n = 0; n < 2; n += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['token'], `no token while a child holds the slug: ${JSON.stringify(d)}`).toBeUndefined();
      expect(d['verdict'], 'the record is found: never "nothing to collect"').not.toBe('not-witnessed');
    }
    expect(devinoOf(c.kept), 'the kept leaf stands').toBe(c.o.devino);
    expect(devinoOf(c.o.leaf), 'the new child\'s leaf stands').toBe(g2);
    expect(fs.readFileSync(path.join(c.o.leaf, 'g2.txt'), 'utf8')).toBe('g2 scratch\n');
    expect(recordsOf(h)).toEqual([c.rec]);
    g2Departs(h);
    expect(fs.existsSync(witnessOf(h)), 'the CONTROL: the later tail dropped the witness').toBe(false);
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), 'found with no witness at all').not.toBe('not-witnessed');
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it.each([
    ['DROPPED by a later tail (`_ws_tmproot_witness_drop`)', `_ws_tmproot_witness_drop ${COL_ID} >/dev/null 2>&1; :`],
    ['ABSENT (deleted by hand)', `rm -f -- "$REG/tmproots/${COL_ID}"`],
  ])('%s: the record alone licenses the resume', (_how, drop) => {
    const c = killedInSlot();
    h.sh(drop);
    expect(fs.existsSync(witnessOf(h)), 'the CONTROL: no witness').toBe(false);
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), 'a standing record is never "nothing to collect"').not.toBe('not-witnessed');
    expect(String(rounds[0]?.doc['token'] ?? ''), 'a resume token, minted from the record').toMatch(TOKEN);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);
});

describe.skipIf(!LINUX || !NO_COPY)('the RECORD lost out of band while its slot stands: the slot is never orphaned in silence', () => {
  // A crash that leaves a slot and a witness, and then something that does not take the reap lock deletes the record:
  // the witness now names a leaf that is gone from the id, which alone is the witness-only arm (a compare-and-drop,
  // nothing moved). A slot of the id standing beside it, with no record naming it, is the operator's — `quarantine-kept`
  // on every audit, the witness kept beside it — never dropped as "nothing left to collect".
  it.each(['moved', 'removed'] as const)('killed at `%s`, then the record deleted by hand: `quarantine-kept`, nothing taken', (point) => {
    const o = orphanLeaf(h);
    collectVerb(h, tokenOf(h), COL_ID, crashAt(point));
    expect(crashedAt(h), 'the CONTROL: the kill fired').toBe(point);
    const [rec] = recordsOf(h);
    const [slot] = slotsOf(h);
    expect(rec, 'the CONTROL: its record stood').toBeDefined();
    expect(slot, 'the CONTROL: and its slot').toBeDefined();
    fs.rmSync(path.join(recordDirOf(h), rec!));
    expect(recordsOf(h), 'the CONTROL: no record now').toEqual([]);
    const witness = fs.readFileSync(witnessOf(h), 'utf8');
    const sleaf = path.join(quarantineOf(h), slot!, 'leaf');
    const inSlot = devinoOf(sleaf);
    expect(inSlot, 'the CONTROL: the leaf is in its slot, or the slot is empty').toBe(point === 'moved' ? o.devino : null);
    expect(devinoOf(o.leaf), 'the CONTROL: nothing stands at the id').toBeNull();
    for (let n = 0; n < 2; n += 1) {
      const rounds = settle(h);
      expect(rounds.map((x) => verdictOf(x)), `audit ${n + 1}: ${shownRounds(rounds)}`).toEqual(['quarantine-kept']);
    }
    expect(slotsOf(h), 'the slot stands').toEqual([slot]);
    expect(devinoOf(sleaf), 'with what it held').toBe(inSlot);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stays beside it, unchanged').toBe(witness);
    expect(eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'refused' && e['refusal'] === 'quarantine-kept'
      && e['verb'] === 'ws-audit').length, 'listed: journaled at every audit').toBeGreaterThanOrEqual(2);
  }, 240_000);
});
