// path-identity W2 (TR12 B; path-identity spec §3.9): six LATE recycled-spawn boundaries of the collector, forced
// through the real verb. `ccd-collect-race-spawn.test.ts` forces a spawn on the recycled slug before the move and at
// `moved`, `proven` and `removed`. Review 369's C1 built thirteen later boundaries through the verb and measured each
// safe, and none was pinned. This file pins six of them, one for each guard that alone keeps the new child whole:
//   a fresh collection's `emptied`: the compare-and-drop, fed the record's fields;
//   its `witnessed`: the temp-file reap, which waits for a free slug;
//   its `dropped`: the next audit's registry rung;
//   the putback's `restoring`: the restore's NOREPLACE rename, behind a doubt that is not the registry;
//   the witness-only arm's `witnessed`: the reap again, on the arm that makes no record;
//   a resume past `removed`, at its `emptied`: the compare-and-drop, on a path with no step 5 and no registry ask.
// At each one, a real `_child_tmpdir` hands the slug to a new child. Each case asserts what stands on disk afterwards:
// the new child's leaf and its witness, never touched.
// THESE ARE FENCES, NOT RED-FIRST TESTS. C1 measured every one of these paths safe on the code this file was written
// against, so no case was red before a fix: there is no fix here. Each case is proven by a mutation that deletes an
// EXISTING guard of ccd and is measured red (the path-identity W2 plan's table for this file). The compare-and-drop's
// own row is measured once the reclaim tail's generation-exact witness drop stands. The file is re-run after every
// later W2 change to the witness drop or to the compare-and-drop aside.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`, `makePrHarness`). Linux only, and only where `mv --no-copy` exists
// (child-workspace reclamation spec §5.10): anywhere else the collector moves nothing, so a case would measure
// nothing. Every audit and verb stubs the in-use probe (`COLLECT_STUBS`), so no case walks /proc. No case asserts
// `meas.leaf`: its own pins own that key.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, DEAD_RUN, G2_RUN, LINUX, NO_COPY, collectAudit, collectVerb, crashAt, crashedAt, devinoOf, docOf, g2Departs,
  g2Row, g2Spawn, gapAt, gapErrorsOf, gapsOf, lastVerdict, leafOf, orphanLeaf, quarantineOf, recordsOf, regOf, settle,
  shownRounds, slotsOf, tokenOf, verdictOf, witnessField, witnessOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-spawn-late-'); });
afterEach(() => { h.cleanup(); });

/** A recycled-slug spawn, whole: `ws-add`'s registry half, then `_child_tmpdir` and the new child's first scratch file. */
const SPAWN = `${g2Row()} && ${g2Spawn()}`;
/** The witness writer's dead temp file of this id: the exact shape `_ws_collect_reap_temps` removes while the slug
 *  reads free, planted two hours old (`ccd-ws-collect-order.test.ts`'s `plant()`). */
const AGED_TEMP = `.${COL_ID}.4242.17.tmp`;
const agedTempOf = (): string => path.join(regOf(h), 'tmproots', AGED_TEMP);
const plantAgedTemp = (): void => {
  const old = Date.now() / 1000 - 7200;
  fs.writeFileSync(agedTempOf(), 'x');
  fs.utimesSync(agedTempOf(), old, old);
};
/** The in-use probe answers "in use" once `$HOME/in-use` exists, and "nobody" before. It is placed AFTER
 *  `COLLECT_STUBS` (which `collectVerb` puts first), so it wins over their `NOBODY`. It walks no /proc. */
const INUSE_AFTER_FLAG = '_ws_path_users() { if [[ -e "$HOME/in-use" ]]; then _WS_PATH_USERS_PIDS=4242;'
  + ' _WS_PATH_USERS_WHY="process 4242 has its working directory at $1"; return 1; fi;'
  + " _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY=''; return 0; };";
/** The compare-and-drop asides of this id (`.<id>.drop.<pid>`) in `tmproots/`: none may be left behind. */
const asidesOf = (): string[] => {
  const d = path.join(regOf(h), 'tmproots');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.startsWith(`.${COL_ID}.drop.`)) : [];
};
/** The new child's leaf and its witness stand, untouched: the leaf `_child_tmpdir` handed it, its scratch, and a
 *  witness for its run that names that leaf's inode. */
const newChildStands = (): void => {
  const leaf = leafOf(h);
  expect(fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8'), 'the CONTROL: the spawn was handed the id-derived leaf')
    .toBe(leaf);
  expect(fs.readFileSync(path.join(leaf, 'g2.txt'), 'utf8'), 'the new child\'s scratch stands').toBe('g2 scratch\n');
  expect(witnessField(h, 'run'), 'the new child\'s witness stands').toBe(G2_RUN);
  expect(witnessField(h, 'ino'), 'naming the new child\'s leaf').toBe(String(fs.lstatSync(leaf, { bigint: true }).ino));
};
/** The next audit refuses `registered` and offers no token: the new child holds the slug. */
const nextAuditRegistered = (what: string): void => {
  const d = docOf(collectAudit(h).stdout);
  expect(d['verdict'], `${what}: ${JSON.stringify(d)}`).toBe('registered');
  expect(d['token'], `${what}: no token while a child holds the slug`).toBeUndefined();
};
/** The detail of the last collect `done` row. Its decisive words lead it, before any path, so it holds under the
 *  300-byte cut whatever this HOME's length. */
const lastDoneDetail = (): string =>
  String(eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'done').at(-1)?.['detail']);

describe.skipIf(!LINUX || !NO_COPY)('six late recycled-spawn boundaries, forced through the real verb (TR12 B): the new child\'s leaf and witness always stand', () => {
  it('late-1 fresh emptied: the compare-and-drop, fed the record\'s fields, keeps the spawn\'s witness', () => {
    orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ emptied: SPAWN }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(gapsOf(h), 'the CONTROL: at `emptied`, after the slot was rmdir\'d').toContain('emptied');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), r.stdout).toMatchObject({ collected: COL_ID, resumed: false, witness: 'kept' });
    newChildStands();
    expect(slotsOf(h), 'the slot went').toEqual([]);
    expect(recordsOf(h), 'and the record, last').toEqual([]);
    expect(asidesOf(), 'the new witness was moved back: no aside is left').toEqual([]);
    nextAuditRegistered('the next audit sees the new child\'s row');
  }, 120_000);

  it('late-2 fresh witnessed: the temp-file reap holds while the slug is taken, and the spawn\'s witness survives the record drop', () => {
    orphanLeaf(h);
    plantAgedTemp();
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ witnessed: SPAWN }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(gapsOf(h), 'the CONTROL: at `witnessed`').toContain('witnessed');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), r.stdout).toMatchObject({ collected: COL_ID, resumed: false, witness: 'dropped' });
    newChildStands();
    expect(fs.existsSync(agedTempOf()), 'the reap held: the slug was taken when it ran').toBe(true);
    expect(lastDoneDetail()).toMatch(/^witness dropped; 0 stale witness temp file\(s\) removed; /);
    expect(slotsOf(h), 'the slot went').toEqual([]);
    expect(recordsOf(h), 'and the record, last').toEqual([]);
    nextAuditRegistered('the next audit sees the new child\'s row');
  }, 120_000);

  it('late-3 fresh dropped: the next audits refuse registered and license nothing until the child leaves', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ dropped: SPAWN }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(gapsOf(h), 'the CONTROL: at `dropped`').toContain('dropped');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), r.stdout).toMatchObject({ collected: COL_ID, resumed: false, witness: 'dropped' });
    newChildStands();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
    const g2 = devinoOf(o.leaf);
    for (let i = 0; i < 2; i += 1) nextAuditRegistered(`audit ${i + 1} while the new child holds the slug`);
    expect(devinoOf(o.leaf), 'the audits touched nothing').toBe(g2);
    // It leaves, as its own reclaim leaves it, and the next passes find nothing to collect.
    g2Departs(h);
    const rounds = settle(h);
    console.info(`late-3 settle rounds: ${rounds.length} ${JSON.stringify(rounds.map((x) => verdictOf(x)))}`);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(o.leaf), 'nothing stands at the id').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('late-4 putback restoring: NOREPLACE alone keeps the new child\'s empty leaf, and the old one stays in its slot', () => {
    const o = orphanLeaf(h);
    const pre = `${gapAt({ moved: 'touch "$HOME/in-use"', restoring: `${g2Row()} && ${g2Spawn(COL_ID, '')}` })}`
      + ` ${INUSE_AFTER_FLAG}`;
    const r = collectVerb(h, tokenOf(h), COL_ID, pre);
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(gapsOf(h), 'the CONTROL: step 5 refused in-use, and the putback reached its seam').toContain('restoring');
    expect(gapsOf(h), 'step 6 never ran').not.toContain('proven');
    expect(fs.readFileSync(path.join(h.home, 'g2-dir'), 'utf8'), 'the CONTROL: the spawn was handed the id-derived leaf')
      .toBe(o.leaf);
    const g2 = devinoOf(o.leaf);
    expect(g2, 'the new child was handed a NEW inode at the id').not.toBeNull();
    expect(g2).not.toBe(o.devino);
    expect(fs.readdirSync(o.leaf), 'untouched, and still EMPTY: a restore that replaced it would have filled it').toEqual([]);
    expect(witnessField(h, 'run'), 'the new child\'s witness stands').toBe(G2_RUN);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const d = docOf(r.stdout);
    expect(d['refused'], r.stdout).toBe('quarantine-kept');
    expect(String(d['detail']))
      .toMatch(/^kept in its slot with the quarantine record \S+, listed for the operator, and nothing was removed: /);
    const slots = slotsOf(h);
    expect(slots, 'one slot is kept').toHaveLength(1);
    expect(recordsOf(h), 'named by its record').toEqual([slots[0]!.slice('slot.'.length)]);
    const kept = path.join(quarantineOf(h), slots[0]!, 'leaf');
    expect(devinoOf(kept), 'the old leaf is kept in its slot').toBe(o.devino);
    // The doubt clears and the new child leaves: the record resumes, and only the record's inode goes.
    fs.rmSync(path.join(h.home, 'in-use'));
    g2Departs(h);
    const rounds = settle(h);
    console.info(`late-4 settle rounds: ${rounds.length} ${JSON.stringify(rounds.map((x) => verdictOf(x)))}`);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(kept), 'the kept leaf went once nothing held the slug').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('late-5 witness-only witnessed: the spawn\'s leaf and witness stand, the reap holds, and no quarantine is ever made', () => {
    const o = orphanLeaf(h);
    fs.rmSync(o.leaf, { recursive: true });
    plantAgedTemp();
    const t = tokenOf(h);
    const r = collectVerb(h, t, COL_ID, gapAt({ witnessed: SPAWN }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    expect(gapsOf(h), 'the CONTROL: the witness-only arm: no record, no slot, no move')
      .toEqual(['locked', 'consented', 'witnessed']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), r.stdout).toMatchObject({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    newChildStands();
    expect(fs.existsSync(agedTempOf()), 'the reap held: the slug was taken when it ran').toBe(true);
    expect(lastDoneDetail()).toMatch(/^witness dropped; 0 stale witness temp file\(s\) removed; no leaf stood at /);
    expect(fs.existsSync(quarantineOf(h)), 'no quarantine was ever made: nothing moved').toBe(false);
    expect(recordsOf(h)).toEqual([]);
    nextAuditRegistered('the next audit sees the new child\'s row');
  }, 120_000);

  it('late-6 resume past removed, at emptied: no step 5 and no registry ask, so the compare-and-drop alone keeps the new witness', () => {
    const o = orphanLeaf(h);
    const k = collectVerb(h, tokenOf(h), COL_ID, crashAt('removed'));
    expect(crashedAt(h), 'the CONTROL: the kill fired at `removed`').toBe('removed');
    expect(docOf(k.stdout)['collected'], 'a killed verb reports nothing').toBeUndefined();
    const recs = recordsOf(h);
    expect(recs, 'the CONTROL: one record stands').toHaveLength(1);
    expect(slotsOf(h), 'the CONTROL: its slot stands').toEqual([`slot.${recs[0]!}`]);
    expect(fs.existsSync(path.join(quarantineOf(h), `slot.${recs[0]!}`, 'leaf')), 'the CONTROL: the slot\'s leaf was removed')
      .toBe(false);
    expect(devinoOf(o.leaf), 'the CONTROL: nothing stands at the id').toBeNull();
    expect(witnessField(h, 'run'), 'the CONTROL: the witness is still the dead run\'s').toBe(DEAD_RUN);
    const before = gapsOf(h).length;
    const t = tokenOf(h);
    const r = collectVerb(h, t, COL_ID, gapAt({ emptied: SPAWN }));
    expect(gapErrorsOf(h), 'the CONTROL: the spawn ran').toEqual([]);
    const resumed = gapsOf(h).slice(before);
    expect(resumed, 'the resume entered the order at the slot\'s rmdir').toEqual(['locked', 'consented', 'emptied', 'witnessed', 'dropped']);
    expect(resumed, 'no move after the crash').not.toContain('moved');
    expect(resumed, 'and no step 5').not.toContain('proven');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), r.stdout).toMatchObject({ collected: COL_ID, resumed: true, witness: 'kept' });
    newChildStands();
    expect(slotsOf(h), 'the slot went').toEqual([]);
    expect(recordsOf(h), 'and the record, last').toEqual([]);
    expect(asidesOf(), 'no aside is left').toEqual([]);
  }, 120_000);
});
