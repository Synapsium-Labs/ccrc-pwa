// FORGERIES AND SWAPS (child-workspace reclamation wave 7, spec 2026-09-22 §5.10). The quarantine record and its slot
// are same-uid writable, like the witness, so they share its trust note: they guard against ccd's own mistakes and a
// recycled id, and a forgery is caught only where it fails a re-proof. Each case forges one thing a re-proof asks — the
// slot's leaf, the record's id, its body, a slot no record names — and asserts the forgery is never taken, and that a
// kept record is LISTED (the audit journals its terminal refusal). Then a file and a link are swapped in at the id:
//   - between step 2's lstat and the move (the `slotted` gap): the move asks the source's identity before it renames,
//     so nothing is renamed — the empty slot and the record are cleared, and the swapped object stands where it was put;
//   - INSIDE the move, after that identity ask and before the rename: what reaches the slot is not the witnessed leaf,
//     so it is KEPT there with its record, listed, never moved back and never unlinked;
//   - into the slot after step 5's last proof (the `proven` gap): the removal refuses a link or file under the
//     collector's alias, so it is never unlinked, and the move back asks what stands in the slot first: not the
//     witnessed leaf, so it is KEPT there with its record, TERMINAL, as at the step-5 proof (ruling T8 OPEN5).
// Nothing that is not the witnessed directory is ever unlinked, on that pass or any later one. Each swapped object is
// followed by its `dev:ino` and its content: a file's bytes, a link's target.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.10).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, G2_RUN, LINUX, NO_COPY, collectAudit, collectVerb, crashAt, crashedAt, devinoOf, docOf, gapAt, gapErrorsOf,
  gapsOf, lastVerdict, orphanLeaf, quarantineOf, recordDirOf, recordsOf, regOf, settle, shownRounds, slotsOf, tokenOf,
  verdictOf, witnessOf, type Orphan,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-forge-'); });
afterEach(() => { h.cleanup(); });

const OTHER = 'demo-quiet-river';
/** The verb killed right after the move: the leaf in its slot, its genuine record standing. */
const killedInSlot = (): { o: Orphan; rec: string; slot: string; kept: string } => {
  const o = orphanLeaf(h);
  collectVerb(h, tokenOf(h), COL_ID, crashAt('moved'));
  expect(crashedAt(h), 'the CONTROL: the kill fired').toBe('moved');
  const [rec] = recordsOf(h);
  const [slot] = slotsOf(h);
  expect(rec, 'the CONTROL: a genuine record').toBeDefined();
  expect(slot, 'the CONTROL: its slot').toBeDefined();
  const kept = path.join(quarantineOf(h), slot!, 'leaf');
  expect(devinoOf(kept), 'the CONTROL: the leaf is in its slot').toBe(o.devino);
  return { o, rec: rec!, slot: slot!, kept };
};
/** A terminal word is LISTED, never silent (spec §5.10): the audit journals it, act `collect`, verb `ws-audit`. */
const listedAtAudit = (word: string): number => eventsOf(h.home, 'collect')
  .filter((e) => e['outcome'] === 'refused' && e['refusal'] === word && e['verb'] === 'ws-audit').length;
const keptListed = (): number => listedAtAudit('quarantine-kept');

describe.skipIf(!LINUX || !NO_COPY)('a forged record or slot is never taken — kept, and listed', () => {
  it('a FORGED SLOT LEAF — the record\'s slot now holds another directory: `quarantine-kept`, and neither tree is touched', () => {
    const c = killedInSlot();
    const genuine = path.join(h.home, 'genuine');
    fs.renameSync(c.kept, genuine);
    fs.mkdirSync(c.kept, { mode: 0o700 });
    fs.writeFileSync(path.join(c.kept, 'precious.txt'), 'not the leaf\n');
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('quarantine-kept');
    expect(rounds, 'no token: nothing was ever spent').toHaveLength(1);
    expect(fs.readFileSync(path.join(c.kept, 'precious.txt'), 'utf8'), 'the planted tree survives').toBe('not the leaf\n');
    expect(devinoOf(genuine), 'the genuine leaf, moved out, is untouched').toBe(c.o.devino);
    expect(recordsOf(h), 'the record is kept for the operator').toEqual([c.rec]);
    expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('a record COPIED under another id\'s name, its body naming this id: kept for that id, and never applied to either', () => {
    const c = killedInSlot();
    const other = orphanLeaf(h, OTHER);
    const forged = `${OTHER}.${c.rec.slice(COL_ID.length + 1)}`;
    fs.copyFileSync(path.join(recordDirOf(h), c.rec), path.join(recordDirOf(h), forged));
    const copied = docOf(collectAudit(h, OTHER).stdout);
    expect(copied['verdict'], 'the id in the body is not the id in the name').toBe('quarantine-kept');
    // The READER refused it (rc 2, ruling R-a), not the resume eval's or the verb's later id compare, which backstop it.
    expect(String(copied['detail']), 'refused by the reader, not by a later compare').toContain('cannot be read as ccd writes it');
    // The genuine record still resumes its own id; the copy touches neither id's leaf.
    expect(lastVerdict(settle(h)), 'the genuine id finishes').toBe('not-witnessed');
    expect(devinoOf(c.kept)).toBeNull();
    expect(devinoOf(other.leaf), 'the other id\'s leaf is untouched').toBe(other.devino);
    expect(fs.existsSync(witnessOf(h, OTHER)), 'and its witness').toBe(true);
    const later = settle(h, OTHER);
    expect(verdictOf(later[0]), shownRounds(later)).toBe('quarantine-kept');
    expect(devinoOf(other.leaf)).toBe(other.devino);
  }, 240_000);

  it('a MALFORMED record — garbage under this id\'s exact record name: `quarantine-kept`; the id\'s own leaf is not taken past it', () => {
    const o = orphanLeaf(h);
    fs.mkdirSync(recordDirOf(h), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(recordDirOf(h), `${COL_ID}.1791000000000000000.4242`), 'garbage\n');
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('quarantine-kept');
    expect(rounds).toHaveLength(1);
    expect(devinoOf(o.leaf), 'the leaf stands').toBe(o.devino);
    expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8')).toBe('old work\n');
    expect(keptListed()).toBeGreaterThanOrEqual(1);
  }, 180_000);

  // A slot no record names may hold an earlier leaf of the id, so the present leaf is never collected beside it
  // (departure fresh-collect-refuses-beside-a-standing-slot): collecting it would drop the witness, the id would leave
  // the population, and the slot would be listed by no audit again.
  it('a FORGED SLOT with no record — a directory named like this id\'s slot: never visited, and the id\'s own leaf is not collected beside it: `quarantine-kept`, listed', () => {
    const o = orphanLeaf(h);
    const forged = path.join(quarantineOf(h), `slot.${COL_ID}.1.1`, 'leaf');
    fs.mkdirSync(forged, { recursive: true });
    fs.chmodSync(quarantineOf(h), 0o700);
    fs.writeFileSync(path.join(forged, 'precious.txt'), 'planted\n');
    const witness = fs.readFileSync(witnessOf(h), 'utf8');
    const rounds = settle(h);
    expect(verdictOf(rounds[0]), shownRounds(rounds)).toBe('quarantine-kept');
    expect(rounds, 'no token: nothing was ever spent').toHaveLength(1);
    expect(devinoOf(o.leaf), 'the witnessed leaf stands').toBe(o.devino);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'its witness stays').toBe(witness);
    expect(fs.readFileSync(path.join(forged, 'precious.txt'), 'utf8'), 'the unrecorded slot is untouched').toBe('planted\n');
    expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
  }, 180_000);
});

/** A precious directory a swapped-in LINK points at: a link's target is never followed. */
const precious = (): string => path.join(h.home, 'precious');
const plantPrecious = (): void => {
  fs.mkdirSync(precious());
  fs.writeFileSync(path.join(precious(), 'keep.txt'), 'precious\n');
};
const preciousWhole = (): void => {
  expect(fs.readFileSync(path.join(precious(), 'keep.txt'), 'utf8'), 'a link\'s target is never followed').toBe('precious\n');
};
type Kind = 'file' | 'link' | 'dir';
/** What a swap leaves at `$1`: a regular FILE holding `swapped in`, a LINK to the precious directory, or ANOTHER
 *  DIRECTORY holding `in.txt`. Its own `dev:ino` is written to `$HOME/swapped-devino` by the swap that places it. */
const SWAPS = [
  ['a regular FILE', 'file', 'printf \'swapped in\\n\' > "$1"'],
  ['a LINK to a directory', 'link', 'ln -s -- "$HOME/precious" "$1"'],
  ['ANOTHER DIRECTORY', 'dir', 'mkdir -m 0700 -- "$1" && printf \'swapped in\\n\' > "$1/in.txt"'],
] as const;
/** The `dev:ino` the swap planted, or '' when no swap ran. */
const swappedDevino = (): string => {
  try { return fs.readFileSync(path.join(h.home, 'swapped-devino'), 'utf8').trim(); } catch { return ''; }
};
/** Where the swapped-in entry stands now — at the id, or as a slot's leaf — by its own `dev:ino`. */
const swappedWhere = (o: Orphan): string[] => {
  const di = swappedDevino();
  return [o.leaf, ...slotsOf(h).map((s) => path.join(quarantineOf(h), s, 'leaf'))].filter((p) => devinoOf(p) === di);
};
/** The swapped-in entry at `p` is whole: a file's bytes, a link's target (never followed), a directory's file. */
const swappedWhole = (p: string, kind: Kind): void => {
  if (kind === 'file') expect(fs.readFileSync(p, 'utf8'), `the swapped-in file at ${p}, kept whole`).toBe('swapped in\n');
  else if (kind === 'link') expect(fs.readlinkSync(p), `the swapped-in link at ${p}, its target unchanged`).toBe(precious());
  else expect(fs.readFileSync(path.join(p, 'in.txt'), 'utf8'), `the swapped-in directory at ${p}, kept whole`).toBe('swapped in\n');
};
/** A bash function `_race_swap <path>`: the witnessed directory at `<path>` moved aside to `$HOME/aside`, `put` leaves
 *  something else at `<path>`, and that thing's OWN `dev:ino` lands in `$HOME/swapped-devino`. */
const swapFn = (put: string): string => `_race_swap() { mv -T -- "$1" "$HOME/aside" && { ${put}; }`
  + ' && stat -c %d:%i -- "$1" > "$HOME/swapped-devino"; };';
const aside = (): string => path.join(h.home, 'aside');

describe.skipIf(!LINUX || !NO_COPY)('a file, a link or another directory swapped in at the id around the move: never unlinked, never moved back, never taken', () => {
  it.each(SWAPS)(
    '%s at `slotted`: the move asks the source\'s identity first and renames NOTHING — `failed probe-unmeasured`; the swapped object stands at the id, the slot and the record are cleared',
    (_what, kind, put) => {
      // AMENDED (Task 4's `move-asks-identity-before-the-rename`, ruled at the 4B re-review): the draft had the swap
      // reach the slot and be kept there. The move now proves its source is the witnessed directory before it renames,
      // so a swap at `slotted` is refused before any rename: the empty slot is cleared, the record dropped, and the
      // answer is the retryable unmeasured one, exit 1.
      plantPrecious();
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, `${swapFn(put)} ${gapAt({ slotted: `_race_swap "$HOME/.cc-tmp/${COL_ID}"` })}`);
      expect(gapErrorsOf(h), 'the CONTROL: the swap ran').toEqual([]);
      expect(swappedDevino(), 'the CONTROL: it planted something').toMatch(/^[0-9]+:[0-9]+$/);
      const d = docOf(r.stdout);
      expect(d['collected'], `nothing that is not the witnessed directory is taken: ${r.stdout}`).toBeUndefined();
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(d['failed'], r.stdout).toBe('probe-unmeasured');
      expect(gapsOf(h), 'the move was never proven').not.toContain('moved');
      expect(swappedWhere(o), 'the swapped-in entry stands AT THE ID, by its own dev:ino').toEqual([o.leaf]);
      swappedWhole(o.leaf, kind);
      expect(slotsOf(h), 'the empty slot is cleared').toEqual([]);
      expect(recordsOf(h), 'and the record').toEqual([]);
      expect(devinoOf(aside()), 'the moved-aside leaf is untouched').toBe(o.devino);
      expect(fs.readFileSync(path.join(aside(), 'scratch', 'a.txt'), 'utf8')).toBe('old work\n');
      preciousWhole();
      // Every later audit offers it to the operator, TERMINAL, and takes nothing.
      const rounds = settle(h);
      expect(rounds.map((x) => verdictOf(x)), shownRounds(rounds)).toEqual(['witness-mismatch']);
      expect(swappedWhere(o), 'and no later audit or verb unlinks it').toEqual([o.leaf]);
      swappedWhole(o.leaf, kind);
      expect(devinoOf(aside())).toBe(o.devino);
      preciousWhole();
      expect(listedAtAudit('witness-mismatch'), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
    },
    240_000,
  );

  it.each(SWAPS)(
    '%s swapped in INSIDE the move — after its identity ask, before its rename: it REACHES THE SLOT and is KEPT there with its record, `quarantine-kept` now and on every later audit; never unlinked',
    (_what, kind, put) => {
      // Ruling T8 OPEN5's "something reached a slot" arm, which only a race INSIDE `_ws_collect_move` can reach now.
      // The shim is `_ws_collect_mv`, the ONE rename: on the forward move (its destination a slot's leaf) it swaps the
      // source, then runs the real `mv -T -n --no-copy`, which carries the swapped object into the slot.
      plantPrecious();
      const o = orphanLeaf(h);
      const race = `${swapFn(put)} _ws_collect_mv() { if [[ "$2" == "$HOME/.cc-tmp/.ccd-quarantine/slot."*/leaf ]]; then`
        + ' _race_swap "$1" || return 99; fi; mv -T -n --no-copy -- "$1" "$2"; };';
      const r = collectVerb(h, tokenOf(h), COL_ID, `${race} ${gapAt({})}`);
      expect(swappedDevino(), 'the CONTROL: the swap ran inside the move').toMatch(/^[0-9]+:[0-9]+$/);
      const d = docOf(r.stdout);
      expect(d['collected'], `nothing that is not the witnessed directory is taken: ${r.stdout}`).toBeUndefined();
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(d['refused'], r.stdout).toBe('quarantine-kept');
      // `moved` is called only once the move is PROVEN (Task 6's seam, ruling G7), and what reached the slot's leaf is
      // not the witnessed directory, so the point is never reached.
      expect(gapsOf(h), 'the move was never proven').not.toContain('moved');
      const [slot] = slotsOf(h);
      expect(slot, 'one slot is kept').toBeDefined();
      const sleaf = path.join(quarantineOf(h), slot!, 'leaf');
      expect(swappedWhere(o), 'the swapped-in entry IS the slot\'s leaf, by its own dev:ino').toEqual([sleaf]);
      swappedWhole(sleaf, kind);
      expect(recordsOf(h), 'with its record').toEqual([slot!.slice('slot.'.length)]);
      expect(devinoOf(o.leaf), 'nothing was moved back to the id').toBeNull();
      expect(devinoOf(aside()), 'the moved-aside leaf is untouched').toBe(o.devino);
      preciousWhole();
      const rounds = settle(h);
      expect(rounds.map((x) => verdictOf(x)), 'every later audit lists it and takes nothing').toEqual(['quarantine-kept']);
      expect(swappedWhere(o), 'and no later audit or verb unlinks it').toEqual([sleaf]);
      swappedWhole(sleaf, kind);
      expect(recordsOf(h)).toEqual([slot!.slice('slot.'.length)]);
      preciousWhole();
      expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
    },
    240_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('a file, a link or another directory swapped into the SLOT after step 5\'s last proof: the removal refuses it, the move back asks first', () => {
  it.each(SWAPS)(
    '%s at `proven`: never unlinked, never moved back — `refused quarantine-kept` at exit 0, TERMINAL; the record and the slot are KEPT, and every later audit lists it',
    (_what, kind, put) => {
      // Task 6's `alias-refuses-a-non-directory-leaf`: `_ws_leaf_remove` unlinks a link or file leaf for the tail's
      // callers, but under the collector's alias its leaf is the recorded directory and nothing else, so it refuses
      // (rc 1, untouched); another directory fails its dev:ino check (rc 1, untouched). Ruled at the Task 8 review
      // (I1, ruling T8 OPEN5): the move back asks what stands in the slot
      // FIRST, and something that is not the witnessed leaf is the operator's, TERMINAL — the word step 5's own
      // identity proof answers for the same swap one gap earlier.
      plantPrecious();
      const o = orphanLeaf(h);
      const r = collectVerb(h, tokenOf(h), COL_ID, `${swapFn(put)} ${gapAt({ proven: '_race_swap "$3/leaf"' })}`);
      expect(gapErrorsOf(h), 'the CONTROL: the swap ran').toEqual([]);
      expect(swappedDevino(), 'the CONTROL: it planted something').toMatch(/^[0-9]+:[0-9]+$/);
      const d = docOf(r.stdout);
      expect(d['collected'], `nothing that is not the witnessed directory is taken: ${r.stdout}`).toBeUndefined();
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(d['refused'], r.stdout).toBe('quarantine-kept');
      expect(String(d['detail']), 'the kept clause leads, then why').toMatch(/^kept in its slot with the quarantine record \S+, listed for the operator, and nothing was moved back or removed: the slot's leaf is not the witnessed directory /);
      expect(gapsOf(h), 'step 6 removed nothing').not.toContain('removed');
      const [slot] = slotsOf(h);
      expect(slot, 'one slot is kept').toBeDefined();
      const sleaf = path.join(quarantineOf(h), slot!, 'leaf');
      expect(swappedWhere(o), 'the swapped-in entry still IS the slot\'s leaf, by its own dev:ino').toEqual([sleaf]);
      swappedWhole(sleaf, kind);
      expect(recordsOf(h), 'with its record').toEqual([slot!.slice('slot.'.length)]);
      expect(devinoOf(o.leaf), 'nothing was moved back to the id').toBeNull();
      expect(devinoOf(aside()), 'the witnessed leaf, where the swap put it, is untouched').toBe(o.devino);
      expect(fs.readFileSync(path.join(aside(), 'scratch', 'a.txt'), 'utf8')).toBe('old work\n');
      preciousWhole();
      const rounds = settle(h);
      expect(rounds.map((x) => verdictOf(x)), shownRounds(rounds)).toEqual(['quarantine-kept']);
      expect(swappedWhere(o), 'and no later audit or verb unlinks it').toEqual([sleaf]);
      swappedWhole(sleaf, kind);
      expect(recordsOf(h)).toEqual([slot!.slice('slot.'.length)]);
      preciousWhole();
      expect(keptListed(), 'listed: journaled at the audit').toBeGreaterThanOrEqual(1);
    },
    240_000,
  );
});

describe.skipIf(!LINUX || !NO_COPY)('the slot\'s leaf GONE before the move back: a retry, never a terminal word', () => {
  it('step 5 doubts (a `.child` lands at `moved`), and the slot\'s leaf is taken away at `restoring`: `failed probe-unmeasured` — the record and its empty slot stand, the next pass finishes from them, and what was taken is never touched', () => {
    // Ruled at the Task 8 review (I1): a slot leaf PROVEN gone has nothing to move back — the retry step 5 answers for
    // the same vanish (`vanished-slot-leaf-is-a-retry`), never the operator's terminal word.
    const o = orphanLeaf(h);
    const seam = '_ws_collect_gap() { echo "$1" >> "$HOME/gaps"; case "$1" in'
      + ` moved) _reg_set "$2" child ${G2_RUN} ;; restoring) mv -T -- "$3/leaf" "$HOME/gone" ;; esac; };`;
    const r = collectVerb(h, tokenOf(h), COL_ID, seam);
    expect(gapsOf(h), 'the CONTROL: step 5 doubted, and the move back began').toContain('restoring');
    expect(devinoOf(path.join(h.home, 'gone')), 'the CONTROL: the witnessed leaf was taken away').toBe(o.devino);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r.stdout);
    expect(d['failed'], r.stdout).toBe('probe-unmeasured');
    expect(String(d['detail'])).toMatch(/^the record and its slot stand, and nothing was moved back or removed: the witnessed leaf vanished from its slot /);
    const [slot] = slotsOf(h);
    expect(slot, 'the slot stands').toBeDefined();
    expect(fs.readdirSync(path.join(quarantineOf(h), slot!)), 'empty').toEqual([]);
    expect(recordsOf(h), 'named by its record').toEqual([slot!.slice('slot.'.length)]);
    expect(devinoOf(o.leaf), 'nothing at the id').toBeNull();
    // While the row stands the record is not resumed; once it is gone the next pass finishes the order from it.
    const held = docOf(collectAudit(h).stdout);
    expect([held['resume'], held['verdict'], held['token']], JSON.stringify(held)).toEqual(['removed', 'registered', undefined]);
    fs.rmSync(path.join(regOf(h), `${COL_ID}.child`));
    const rounds = settle(h);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
    expect(devinoOf(path.join(h.home, 'gone')), 'what was taken away is never touched').toBe(o.devino);
    expect(fs.readFileSync(path.join(h.home, 'gone', 'scratch', 'a.txt'), 'utf8')).toBe('old work\n');
  }, 240_000);
});
