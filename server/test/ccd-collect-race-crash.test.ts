// A SIGKILL AFTER EVERY STEP (child-workspace reclamation wave 7, spec 2026-09-22 §5.10). The quarantine record is
// written FIRST and dropped LAST, so a crash at any point leaves it, and it — not the witness, not the journal — is the
// authority the next audit resumes from. Each case kills the verb at one point, checks the invariants at the instant
// of death (no slot without its record; the leaf's inode in exactly one place), then runs "the next audit and verb" to
// quiescence: the job is finished, and nothing but the record's own inode was removed. A kill before the move leaves
// the leaf at its id, so a pass there is a fresh collection, which a forged slot of the id that no record names holds
// at `quarantine-kept` until the operator clears it (fresh-collect-refuses-beside-a-standing-slot). Then the witness is rewritten,
// dropped and deleted under a standing record: the record is found whatever the witness says. And the record itself is
// lost out of band while its slot stands: the slot is the operator's, listed on every audit, never dropped in silence
// by the COLLECTOR's own arms (the reclaim tail's witness drop still ignores a recordless slot, a stated residual:
// `tail-drop-ignores-a-recordless-slot`). Last, one stated residual is pinned as it stands, widened
// (`crash-at-moved-residual-widened`): a crash after the move once a recycled spawn adopted the leaf.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only (`/proc/<pid>/stat`), and only where `mv --no-copy` exists.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, DEAD_RUN, G2_RUN, LINUX, NO_COPY, POINTS, TOKEN, collectAudit, collectVerb, crashAt, crashedAt, custodyHolds,
  devinoOf, docOf, g2Departs, g2Row, g2Spawn, gapErrorsOf, lastVerdict, orphanLeaf, quarantineOf, recordDirOf,
  recordsOf, regOf, settle, shownRounds, slotsOf, tokenOf, verdictOf, witnessField, witnessOf, type Orphan,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-crash-'); });
afterEach(() => { h.cleanup(); });

const OTHER = 'demo-quiet-river';
const DECOY = `slot.${COL_ID}.1.1`;
const ours = (): string[] => slotsOf(h).filter((s) => s !== DECOY);
const at = (p: (typeof POINTS)[number]): number => POINTS.indexOf(p);

/** What a resume must never touch: another id's witnessed orphan, and a slot carrying THIS id's own name that no
 *  record names — a slot with no record is never visited. The forged slot is planted AFTER the kill: beside a present
 *  leaf it stops a FRESH collection (departure fresh-collect-refuses-beside-a-standing-slot), so with it standing first
 *  the audit would mint no token to kill a verb with. */
const plantForged = (): string => {
  const forged = path.join(quarantineOf(h), DECOY, 'leaf');
  fs.mkdirSync(forged, { recursive: true });
  fs.chmodSync(quarantineOf(h), 0o700);
  fs.writeFileSync(path.join(forged, 'keep'), 'not the record\'s\n');
  return forged;
};

describe.skipIf(!LINUX || !NO_COPY)('killed after each step: the next audit finds the record and finishes — removing only its inode', () => {
  it.each(POINTS.map((p, i) => [p, i] as const))('killed at `%s`', (point, i) => {
    const o = orphanLeaf(h);
    const other = orphanLeaf(h, OTHER);
    const r = collectVerb(h, tokenOf(h), COL_ID, crashAt(point));
    expect(crashedAt(h), 'the CONTROL: the kill fired where it was aimed').toBe(point);
    expect(docOf(r.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();
    const forged = plantForged();

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
    if (i < at('moved')) {
      // THE LEAF NEVER LEFT ITS ID: with no record, or once an `unmoved` resume has cleared its record and slot, the
      // next pass is a FRESH collection, and the forged slot of this id stands beside the leaf — so it refuses
      // `quarantine-kept`, listed, and takes nothing. Once the operator clears that slot, the pass finishes.
      const held = settle(h);
      expect(held.map((x) => verdictOf(x)), shownRounds(held))
        .toEqual(recorded ? ['collectable', 'quarantine-kept'] : ['quarantine-kept']);
      expect(devinoOf(o.leaf), 'the leaf stands at its id').toBe(o.devino);
      expect(fs.existsSync(witnessOf(h)), 'and its witness').toBe(true);
      expect(recordsOf(h), 'no record').toEqual([]);
      expect(ours(), 'no slot of the collector’s').toEqual([]);
      expect(fs.readFileSync(path.join(forged, 'keep'), 'utf8'), 'a slot no record names is never visited').toBe('not the record\'s\n');
      fs.rmSync(path.dirname(forged), { recursive: true });
    }
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(o.leaf), 'collected').toBeNull();
    expect(ours(), 'no slot of the id is left').toEqual([]);
    expect(recordsOf(h), 'no record').toEqual([]);
    expect(fs.existsSync(witnessOf(h)), 'no witness').toBe(false);

    // NOTHING BUT THE RECORD'S INODE WAS REMOVED.
    if (i >= at('moved')) {
      expect(fs.readFileSync(path.join(forged, 'keep'), 'utf8'), 'a slot no record names is never visited').toBe('not the record\'s\n');
    }
    expect(devinoOf(other.leaf), 'another id\'s orphan is untouched').toBe(other.devino);
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

describe.skipIf(!LINUX || !NO_COPY)('the RECORD lost out of band while its slot stands: the collector’s own arms never orphan the slot in silence', () => {
  // A crash that leaves a slot and a witness, and then something that does not take the reap lock deletes the record:
  // the witness now names a leaf that is gone from the id, which alone is the witness-only arm (a compare-and-drop,
  // nothing moved). A slot of the id standing beside it, with no record naming it, is the operator's — `quarantine-kept`
  // on every audit, the witness kept beside it — never dropped as "nothing left to collect". This is the COLLECTOR's
  // promise only: the reclaim tail's own witness drop (`_ws_tmproot_remove`) still drops the witness of an id whose
  // recordless slot stands, a stated residual (`tail-drop-ignores-a-recordless-slot`) carried to wave 9.
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

describe.skipIf(!LINUX || !NO_COPY)('a stated residual: a crash after the move once a recycled spawn ADOPTED the leaf', () => {
  // `crash-at-moved-after-a-spawn-keeps-the-leaf-in-its-slot` (ruled at the Task 8 review, M7: an accepted residual,
  // pinned here as it stands, ccd unchanged), WIDENED at fix round 1 of review 369 (F7: `crash-at-moved-residual-widened`,
  // a residual, ccd unchanged again — the retaken-path arm stays ABOVE the registry, as ruling T8 OPEN4, R-e and R66
  // rule). Without a crash, step 5 sees the spawn's `.child` and moves the adopted leaf back. A SIGKILL in the window
  // leaves the record, the adopted leaf in its slot and nothing at the id. The residual is wider than first stated in
  // three ways:
  // (i) THE KILL WINDOW runs from the move to the putback's move-back RENAME, not just to the re-proof: a kill at
  //     `restoring` (the putback's own seam, before its rename) leaves the same state as a kill at `moved`. The widened
  //     case below is measured at both.
  // (ii) THE SPAWN WINDOW: a recycled child minted for the SAME run (dev, ino, btime and run all match, so its witness
  //     write writes nothing), or one whose witness write failed (only warned), passes the record's read-back, so
  //     adoption opens at the fork's registry read, and `spawn-at-consented-stops-at-the-record` is false for it. These
  //     cases spawn at `slotted`, after the record, so they do not measure (ii); they state it.
  // (iii) WHAT THE AUDIT ANSWERS: until the adopting child's `_child_tmpdir` runs again, nothing stands at the id, so
  //     the resume reads phase `moved` off the disk, then asks the registry: `registered`, no token, nothing moved.
  //     Once that `mkdir -p` re-creates the original path, the resume's retaken-path arm answers TERMINAL
  //     `quarantine-kept`, journaled `refused` on EVERY pass for the child's life; read off the disk, it clears by
  //     itself once the path is free again (R-e), and the registry answers once more.
  // Throughout, the live child's adopted leaf — its scratch in it — waits in the slot for the child's whole life,
  // never lost while the child holds the slug and never handed back to it either, and it is collected from the record
  // once the child's row is gone.
  it('crash-at-moved-after-a-spawn-keeps-the-leaf-in-its-slot: `registered` with no token until the child spawns again — the adopted leaf stays in its slot, by inode — then collected once its row is gone', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, crashAt('moved', { slotted: `${g2Row()} && ${g2Spawn()}` }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(crashedAt(h), 'the CONTROL: the kill fired at `moved`').toBe('moved');
    expect(fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8'), 'the CONTROL: `mkdir -p` ADOPTED the old leaf').toBe(o.leaf);
    expect(docOf(r.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();
    const [rec] = recordsOf(h);
    const [slot] = slotsOf(h);
    expect(rec, 'the CONTROL: the record stands').toBeDefined();
    expect(slot, 'the CONTROL: and its slot').toBeDefined();
    const kept = path.join(quarantineOf(h), slot!, 'leaf');
    expect(devinoOf(kept), 'the adopted leaf is in the slot, the same inode').toBe(o.devino);
    expect(devinoOf(o.leaf), 'nothing stands at the id').toBeNull();
    expect(witnessField(h, 'run'), 'the witness is the new child\'s').toBe(G2_RUN);
    for (let n = 0; n < 2; n += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['resume'], `audit ${n + 1} reads the phase off the disk: ${JSON.stringify(d)}`).toBe('moved');
      expect(d['verdict'], 'while the child holds the slug').toBe('registered');
      expect(d['token'], 'no token').toBeUndefined();
    }
    expect(devinoOf(kept), 'the adopted leaf stays in its slot').toBe(o.devino);
    expect(fs.readFileSync(path.join(kept, 'g2.txt'), 'utf8'), 'with the child\'s scratch in it').toBe('g2 scratch\n');
    expect(fs.readFileSync(path.join(kept, 'scratch', 'a.txt'), 'utf8'), 'and the old scratch').toBe('old work\n');
    expect(devinoOf(o.leaf), 'nothing was handed back to the id').toBeNull();
    expect(recordsOf(h)).toEqual([rec]);
    // The child leaves as its own reclaim leaves it: its tail finds no leaf at the id and drops the witness, and its
    // row goes. The record then resumes, and the verb collects what the slot holds.
    g2Departs(h);
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('collectable');
    expect(rounds[0]?.answer?.['collected'], shownRounds(rounds)).toBe(COL_ID);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(kept), 'collected from the record').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  /** The rows the audit journals for a TERMINAL `quarantine-kept`, one per pass. */
  const keptRows = (): number => eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'refused'
    && e['refusal'] === 'quarantine-kept' && e['verb'] === 'ws-audit').length;

  it.each(['moved', 'restoring'] as const)('crash-at-moved-residual-widened, killed at `%s`: `registered` until the child spawns again; then TERMINAL `quarantine-kept`, journaled on every pass, nothing moved or removed; once the path is free it clears by itself', (point) => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, crashAt(point, { slotted: `${g2Row()} && ${g2Spawn()}` }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(crashedAt(h), 'the CONTROL: the kill fired where it was aimed').toBe(point);
    expect(fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8'), 'the CONTROL: `mkdir -p` ADOPTED the old leaf').toBe(o.leaf);
    expect(docOf(r.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();
    const [rec] = recordsOf(h);
    const [slot] = slotsOf(h);
    expect(rec, 'the CONTROL: the record stands').toBeDefined();
    expect(slot, 'the CONTROL: and its slot').toBeDefined();
    const kept = path.join(quarantineOf(h), slot!, 'leaf');
    expect(devinoOf(kept), '(i): the adopted leaf is in its slot, by inode, whichever of the two points the kill hit').toBe(o.devino);
    expect(devinoOf(o.leaf), '(i): and nothing stands at the id').toBeNull();

    // (iii) BEFORE the child spawns again: the live child has no TMPDIR directory at all.
    const before = docOf(collectAudit(h).stdout);
    expect([before['resume'], before['verdict'], before['token']], `before the respawn: ${JSON.stringify(before)}`)
      .toEqual(['moved', 'registered', undefined]);
    expect(keptRows(), 'a retryable `registered` is journaled nowhere').toBe(0);

    // THE RESPAWN: the live child's next spawn asks `_child_tmpdir` again, and its `mkdir -p` re-creates the original
    // path: a NEW directory, witnessed for the child's run.
    h.sh(g2Spawn(COL_ID, 'respawn.txt'));
    const retaken = devinoOf(o.leaf);
    expect(retaken, 'the CONTROL: a directory stands at the id again').not.toBeNull();
    expect(retaken, 'the CONTROL: a new one, not the adopted leaf').not.toBe(o.devino);
    expect(witnessField(h, 'run'), 'the CONTROL: witnessed for the live child').toBe(G2_RUN);

    // (iii) AFTER it: the retaken-path arm, TERMINAL, journaled on every pass, and nothing moved or removed.
    for (let n = 1; n <= 2; n += 1) {
      const d = docOf(collectAudit(h).stdout);
      expect(d['verdict'], `pass ${n} after the respawn: ${JSON.stringify(d)}`).toBe('quarantine-kept');
      expect(d['token'], 'no token').toBeUndefined();
      expect(String(d['detail']), 'the retaken path is what it names').toContain('the original path was retaken');
      expect(keptRows(), `journaled \`refused\` on pass ${n}`).toBe(n);
    }
    expect(recordsOf(h), 'the record stands').toEqual([rec]);
    expect(slotsOf(h), 'and its slot').toEqual([slot]);
    expect(devinoOf(kept), 'with the adopted leaf in it, by inode').toBe(o.devino);
    expect(fs.readFileSync(path.join(kept, 'g2.txt'), 'utf8'), 'the child’s first scratch in it').toBe('g2 scratch\n');
    expect(fs.readFileSync(path.join(kept, 'scratch', 'a.txt'), 'utf8'), 'and the old scratch').toBe('old work\n');
    expect(devinoOf(o.leaf), 'the retaken path stands, untouched').toBe(retaken);
    expect(fs.readFileSync(path.join(o.leaf, 'respawn.txt'), 'utf8'), 'with the child’s new scratch').toBe('g2 scratch\n');

    // R-e: the child's own tail frees the path while its row still stands. Read off the disk, the terminal word clears
    // by itself, and the registry answers again: `registered`, retryable, nothing moved.
    h.sh(`_ws_tmproot_remove ${COL_ID} >/dev/null 2>&1; :`);
    expect(devinoOf(o.leaf), 'the CONTROL: the path is free').toBeNull();
    const freed = docOf(collectAudit(h).stdout);
    expect([freed['resume'], freed['verdict'], freed['token']], `once the path is free: ${JSON.stringify(freed)}`)
      .toEqual(['moved', 'registered', undefined]);
    expect(keptRows(), 'no further `refused` row').toBe(2);
    // Its row goes: the record resumes, and the verb collects what the slot holds.
    for (const f of ['uuid', 'project', 'workdir', 'child']) fs.rmSync(path.join(regOf(h), `${COL_ID}.${f}`), { force: true });
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('collectable');
    expect(rounds[0]?.answer?.['collected'], shownRounds(rounds)).toBe(COL_ID);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(kept), 'collected from the record').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);
});
