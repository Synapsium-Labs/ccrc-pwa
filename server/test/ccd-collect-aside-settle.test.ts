// path-identity W2, TR6 A (the settle): an orphaned compare-and-drop aside is settled UNDER THE REAP LOCK — restored,
// unlinked or left (path-identity spec §3.6). `_ws_collect_witness_cad` moves a witness aside to `.<id>.drop.<pid>` by
// one NOREPLACE rename, reads it there, then unlinks it or moves it back; a SIGKILL between the rename and the unlink,
// or a move back that fails, leaves an aside and no witness. `_ws_tmproot_aside_settle` RESTORES a sole aside that reads
// as the id's witness by `link`, a dev:ino proof and `rm` (never a rename: a witness a writer made meanwhile is never
// replaced), UNLINKS an aside that is the standing witness (one inode, or the same fields), and LEAVES any other, named.
// ws-collect settles after its pause and before its evaluation, and its doubt blocks only an act; the reclaim and expiry
// tail settles before step (6), and its doubt only warns (`tail-aside-warns-without-keeping`). The settle prints
// nothing; its callers warn.
// FIXTURE HOME ONLY (`makePrHarness`): every path derives from `h.home`, every verb runs as a SOURCED function, and no
// case walks the real /proc for the in-use probe (`PROBE_STUB`, `NOBODY`, or Darwin's unasked probe). #17's expiry
// audit and verb do walk it, through the expiry ladder's own probe (`_ws_expire_cwd_users`), which nothing here
// stubs, so CLAUDE.md lists this file as a load flake. A verb that answers at exit 0 hands
// back no stderr through the harness, so a case that reads stderr sends it to `$HOME/verb-err`. Planted asides carry a
// pid no kernel hands out (9999999, 9999998), so a compare-and-drop under test (`.<id>.drop.$BASHPID`) can never pick
// the same name. The collector's cases are Linux with `mv --no-copy`, as the collector is; the tail's are Linux; the
// Darwin pin and the settle's own answers run on either host.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { PAUSE, secondsAgoNs, walkAt } from './collectFixture.js';
import {
  COL_ID, PROBE_STUB, WRONG_TOKEN, collectToken, collectVerb, crashAt, docOf, gapAt, inoAt, linesOf, makeOrphan,
  quarantineOf, records, regOf, slots, witnessOf,
} from './wsCollectFixture.js';
import {
  COL_ID as RACE_ID, LINUX, NOBODY, NO_COPY, ROOT_USER, collectVerb as raceVerb, lastVerdict,
  leafOf as raceLeafOf, orphanLeaf, recordsOf, settle, shownRounds, slotsOf, tokenOf, witnessOf as raceWitnessOf,
} from './collectRaceFixture.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireEvalOf, expireVerb, makeArchived } from './wsExpireFixture.js';
import { DARWIN_IDENT_SHIMS } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-aside-settle-'); });
afterEach(() => { h.cleanup(); });

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tmproots = (): string => path.join(regOf(h), 'tmproots');
/** What stands in `tmproots/` now, sorted; [] when the directory is gone. */
const namesIn = (): string[] => (fs.existsSync(tmproots()) ? fs.readdirSync(tmproots()).sort() : []);
/** An aside of `id`, at a pid no kernel hands out. */
const asideOf = (id: string, pid = 9_999_999): string => path.join(tmproots(), `.${id}.drop.${pid}`);
/** The verb's stderr, sent to a file: a verb that answers at exit 0 hands back none through the harness. */
const ERR = '2>"$HOME/verb-err"';
const errOf = (): string => {
  const p = path.join(h.home, 'verb-err');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
/** A leaf at `~/.cc-tmp/<id>` and the witness the REAL writer writes for it (run 7); the witness's bytes. */
const plantWitness = (id: string): string => {
  const leaf = path.join(h.home, '.cc-tmp', id);
  fs.mkdirSync(leaf, { recursive: true, mode: 0o700 });
  h.sh(`_ws_tmproot_witness_write ${id} '${leaf}' 7`);
  const w = path.join(tmproots(), id);
  expect(fs.existsSync(w), 'the CONTROL: the real writer witnessed the leaf').toBe(true);
  return fs.readFileSync(w, 'utf8');
};

/** Kills the verb's own shell (SIGKILL: no trap runs, nothing is cleaned up) the instant its compare-and-drop unlinks
 *  an aside of `id`: the crash between the rename and the unlink, which leaves an aside and no witness.
 *  `$HOME/killed` says it fired. */
const KILL_AT_ASIDE_UNLINK = (id: string): string =>
  `rm() { if [[ "$*" == *"/tmproots/.${id}.drop."* ]]; then : > "$HOME/killed"; kill -KILL $$; fi; command rm "$@"; };`;
/** `link`, logged to `$HOME/link-calls`, then run. */
const LINK_SPY = 'link() { printf \'%s\\n\' "$*" >> "$HOME/link-calls"; command link "$@"; };';
/** The logged `link` calls that name `tmproots/`. The verb's compactions lock and its generation read link under
 *  `$REG` too (measured: three such calls in #16a's reclaim, before any settle existed), and neither is a settle's. */
const tmprootLinks = (): string[] => linesOf(h, 'link-calls').filter((l) => l.includes('/tmproots/'));
/** `rm`, logged to `$HOME/rm-calls`, then run. */
const RM_SPY = 'rm() { printf \'%s\\n\' "$*" >> "$HOME/rm-calls"; command rm "$@"; };';
/** A writer wins the name INSIDE `link`, before the real link runs: a newer (run 9) witness stands there. */
const LINK_LOSES = 'link() { printf \'%s\\n\' "$(sed \'s/ run=7 / run=9 /\' "$1")" > "$2"; command link "$@"; };';
/** A writer replaces the name right AFTER the link took: the witness's name now holds another inode (run 9). */
const LINK_THEN_REPLACED = 'link() { command link "$@"; sed \'s/ run=7 / run=9 /\' "$1" > "$2.t"; mv -f "$2.t" "$2"; };';
/** A writer wins the name at the settle's own parse of its aside, before any restore is tried, once (`$HOME/wrote`):
 *  a restore that is not no-clobber would overwrite it. Every other parse is the real one. */
const WRITER_AT_PARSE = 'eval "_t_parse_real()$(declare -f _ws_tmproot_witness_parse | tail -n +2)";'
  + ' _ws_tmproot_witness_parse() { _t_parse_real "$@"; local rc=$?;'
  + ' if [[ "${FUNCNAME[1]}" == _ws_tmproot_aside_settle && "$1" == */tmproots/.*.drop.* && ! -e "$HOME/wrote" ]]; then'
  + ' : > "$HOME/wrote"; sed \'s/ run=7 / run=9 /\' "$1" > "$REG/tmproots/$2"; fi; return $rc; };';
/** `_ws_collect_fork`, spied: on entry it appends `1` to `$HOME/fork-saw` when the witness's own name stands, else `0`. */
const FORK_SPY = 'eval "_t_fork_real()$(declare -f _ws_collect_fork | tail -n +2)";'
  + ' _ws_collect_fork() { if [[ -e "$REG/tmproots/$1" ]]; then echo 1; else echo 0; fi >> "$HOME/fork-saw"; _t_fork_real "$@"; };';
/** At `emptied`, the witness is rewritten for run 8: not the generation this collection acted on. */
const RUN8_AT_EMPTIED = gapAt('emptied', 'sed -i "s/ run=7 / run=8 /" "$REG/tmproots/$2"');
/** The compare-and-drop's move back is DENIED: `tmproots/` turns read-only the instant a move names the witness's own
 *  path as its destination, which only the move back does. */
const MOVE_BACK_DENIED = `mv() { if [[ "\${@: -1}" == "$REG/tmproots/${COL_ID}" ]]; then chmod 0500 "$REG/tmproots"; fi; command mv "$@"; };`;
/** The compare-and-drop's move back LOSES: a newer (run 9) witness is written at the witness's own path the instant
 *  the move back is tried, and the NOREPLACE rename refuses to replace it. */
const MOVE_BACK_LOSES = `mv() { if [[ "\${@: -1}" == "$REG/tmproots/${COL_ID}" ]]; then`
  + ` sed 's/ run=8 / run=9 /' "\${@: -2:1}" > "\${@: -1}"; fi; command mv "$@"; };`;
const DARWIN = 'CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=0;';
/** On a Linux host the Darwin arm's `stat -f` reads the filesystem, not the file, so `_plat_devino` takes GNU's
 *  spelling there, and since path-identity W3 `_plat_btime` too (the tail's owned check measures identities): the
 *  fixture's one host-conditional pair, `DARWIN_IDENT_SHIMS`. On a Darwin host nothing is shimmed. */
const DEVINO_SHIM = DARWIN_IDENT_SHIMS;

const childWitness = (): string => path.join(tmproots(), CHILD_ID);
const childLeaf = (): string => path.join(h.home, '.cc-tmp', CHILD_ID);
/** A real child whose temp root the REAL writer made and witnessed (run 7); the witness's bytes. */
const witnessedChild = (): string => {
  makeChild(h);
  h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
  expect(fs.existsSync(childWitness()), 'the CONTROL: the real writer witnessed the child’s leaf').toBe(true);
  expect(fs.statSync(childLeaf()).isDirectory(), 'the CONTROL: the leaf stands').toBe(true);
  return fs.readFileSync(childWitness(), 'utf8');
};
const reclaimed = (r: { code: number; stdout: string }): void => {
  expect(r.code, r.stdout + errOf()).toBe(0);
  expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
};
const reclaimDone = (): Record<string, unknown> => eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;

describe.skipIf(!LINUX || !NO_COPY)('ws-collect settles an aside under the reap lock, after the pause and before the evaluation (path-identity spec §3.6)', () => {
  /** The witnessed orphan of `makeOrphan`, its leaf gone and its witness renamed to an aside, byte for byte. */
  const asideOnly = (): { witness: string; aside: string } => {
    const o = makeOrphan(h);
    fs.rmSync(o.leaf, { recursive: true, force: true });
    const aside = asideOf(COL_ID);
    fs.renameSync(witnessOf(h), aside);
    return { witness: o.witness, aside };
  };

  it('#1: a crash inside the witness-only compare-and-drop leaves an aside alone; the next audit and verb restore and drop it, and tmproots/ ends empty', () => {
    orphanLeaf(h);
    fs.rmSync(raceLeafOf(h), { recursive: true, force: true });
    const crash = raceVerb(h, tokenOf(h), RACE_ID, KILL_AT_ASIDE_UNLINK(RACE_ID));
    expect(crash.code, 'the CONTROL: the verb died').not.toBe(0);
    expect(fs.existsSync(path.join(h.home, 'killed')), 'the CONTROL: at the aside’s unlink').toBe(true);
    expect(namesIn(), 'the CONTROL: an aside, and no witness')
      .toEqual([expect.stringMatching(new RegExp(`^\\.${esc(RACE_ID)}\\.drop\\.[0-9]+$`))]);
    const rounds = settle(h);
    expect(rounds.map((r) => r.answer?.['witness'] ?? null), shownRounds(rounds)).toContain('dropped');
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(namesIn(), 'no witness and no aside is left').toEqual([]);
  }, 120_000);

  it('#2: the same crash inside _ws_collect_finish (the leaf present): the record resumes, the settle restores the witness, and it is dropped', () => {
    orphanLeaf(h);
    const crash = raceVerb(h, tokenOf(h), RACE_ID, KILL_AT_ASIDE_UNLINK(RACE_ID));
    expect(crash.code, 'the CONTROL: the verb died').not.toBe(0);
    expect(fs.existsSync(path.join(h.home, 'killed')), 'the CONTROL: at the aside’s unlink').toBe(true);
    expect(recordsOf(h), 'the CONTROL: the record stands (it goes LAST)').toHaveLength(1);
    expect(slotsOf(h), 'the CONTROL: the slot was emptied and removed').toEqual([]);
    expect(fs.existsSync(raceWitnessOf(h)), 'the CONTROL: no witness under its own name').toBe(false);
    const rounds = settle(h);
    expect(rounds[0]?.answer, shownRounds(rounds)).toMatchObject({ collected: RACE_ID, resumed: true, witness: 'dropped' });
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(namesIn(), 'no witness and no aside is left').toEqual([]);
    expect(recordsOf(h), 'the record went last').toEqual([]);
  }, 120_000);

  it('#3: an aside alone beside a standing leaf is restored, and the leaf meets the full ladder: a young tree is refused changed-recently', () => {
    const o = makeOrphan(h);
    const aside = asideOf(COL_ID);
    fs.renameSync(witnessOf(h), aside);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${PROBE_STUB} ${walkAt(secondsAgoNs(0))}`, floor: false, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)['refused'], 'judged by the full ladder, under the production floor').toBe('changed-recently');
    expect(fs.existsSync(witnessOf(h)), 'the witness is restored under its own name').toBe(true);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'byte for byte the aside it was').toBe(o.witness);
    expect(fs.existsSync(aside), 'the aside is gone').toBe(false);
    expect(fs.existsSync(o.leaf), 'nothing was moved').toBe(true);
    expect(errOf(), 'a restore warns nothing').not.toContain('compare-and-drop aside');
  }, 60_000);

  it.each([
    ['#4: a writer that wins the name inside link', LINK_LOSES],
    ['#4b: a writer that wins the name at the settle’s parse, before any restore', WRITER_AT_PARSE],
    ['#5: a writer that replaces the name right after the link (the dev:ino proof fails)', LINK_THEN_REPLACED],
  ] as const)('%s: its newer witness stands untouched, the aside is left and warned, and the verb answers on the newer witness', (_what, seam) => {
    const o = asideOnly();
    const t = collectToken(h, { pre: PROBE_STUB });
    const r = collectVerb(h, t, { pre: `${PROBE_STUB} ${seam}`, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)['refused'], 'the token bound the aside’s generation').toBe('state-changed');
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the newer witness stands, untouched').toMatch(/ run=9 /);
    expect(fs.readFileSync(o.aside, 'utf8'), 'the aside is left as it was, never unlinked').toBe(o.witness);
    expect(errOf()).toContain('ccd: warn: ');
    expect(errOf(), 'the warning names the aside').toContain(o.aside);
  }, 60_000);

  it.each([
    ['one inode under two names (a restore’s crash state)', (w: string, a: string): void => { fs.linkSync(w, a); }],
    ['a copy of its very bytes', (w: string, a: string): void => { fs.copyFileSync(w, a); }],
  ] as const)('#6: an aside that is the standing witness is unlinked, and the witness keeps its inode: %s', (_what, plant) => {
    const o = makeOrphan(h);
    fs.rmSync(o.leaf, { recursive: true, force: true });
    const aside = asideOf(COL_ID);
    plant(witnessOf(h), aside);
    const ino = inoAt(witnessOf(h));
    const r = collectVerb(h, WRONG_TOKEN, { pre: PROBE_STUB, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)['refused'], 'nothing acts on a token that does not match').toBe('state-changed');
    expect(fs.existsSync(aside), 'the equal aside is unlinked').toBe(false);
    expect(inoAt(witnessOf(h)), 'the witness keeps its inode').toBe(ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    expect(errOf(), 'an equal aside goes in silence').not.toContain('compare-and-drop aside');
  }, 60_000);

  it.each([
    ['a parseable aside of another generation (run 8)',
      (w: string, a: string): void => { fs.writeFileSync(a, fs.readFileSync(w, 'utf8').replace(' run=7 ', ' run=8 ')); }],
    ['a malformed aside (the order pin’s shape)', (_w: string, a: string): void => { fs.writeFileSync(a, 'x'); }],
    ['a symbolic link at an aside’s name, pointing at the witness', (w: string, a: string): void => { fs.symlinkSync(w, a); }],
  ] as const)('#7: beside a witness it is not, %s is left and warned, and the verb collects on the witness', (_what, plant) => {
    const o = makeOrphan(h);
    fs.rmSync(o.leaf, { recursive: true, force: true });
    const aside = asideOf(COL_ID);
    plant(witnessOf(h), aside);
    const ino = fs.lstatSync(aside, { bigint: true }).ino;
    const r = collectVerb(h, collectToken(h, { pre: PROBE_STUB }), { pre: PROBE_STUB, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, witness: 'dropped' });
    expect(fs.lstatSync(aside, { bigint: true }).ino, 'the aside is left where it stands').toBe(ino);
    expect(errOf()).toContain('ccd: warn: ');
    expect(errOf(), 'the warning names the aside').toContain(aside);
  }, 60_000);

  it('#8: two asides and no witness beside a standing record: the act fails probe-unmeasured, and the record, the slot and both asides stand', () => {
    makeOrphan(h);
    expect(collectVerb(h, collectToken(h, { pre: PROBE_STUB }), { pre: `${PROBE_STUB} ${crashAt('moved')}` }).code,
      'the CONTROL: the verb died after the move').toBe(137);
    const a1 = asideOf(COL_ID);
    const a2 = asideOf(COL_ID, 9_999_998);
    fs.renameSync(witnessOf(h), a1);
    fs.copyFileSync(a1, a2);
    const bodies = [fs.readFileSync(a1, 'utf8'), fs.readFileSync(a2, 'utf8')];
    const rec = records(h);
    const slot = slots(h);
    expect(rec, 'the CONTROL: one record').toHaveLength(1);
    expect(slot, 'the CONTROL: one slot').toHaveLength(1);
    const r = collectVerb(h, collectToken(h, { pre: PROBE_STUB }), { pre: PROBE_STUB, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toMatch(
      new RegExp(`^nothing was moved or removed: 2 compare-and-drop asides of ${esc(COL_ID)} stand and no witness does`));
    expect(records(h), 'the record stands').toEqual(rec);
    expect(slots(h), 'the slot stands').toEqual(slot);
    expect(fs.existsSync(path.join(quarantineOf(h), slot[0]!, 'leaf')), 'the leaf stands in its slot').toBe(true);
    expect([fs.readFileSync(a1, 'utf8'), fs.readFileSync(a2, 'utf8')], 'both asides stand as they were').toEqual(bodies);
    expect(fs.existsSync(witnessOf(h)), 'nothing was restored').toBe(false);
  }, 90_000);

  it('#9: two asides and no witness beside a registry row: refused registered (the doubt never outranks the refusal), warned, and both asides stand', () => {
    const o = asideOnly();
    const a2 = asideOf(COL_ID, 9_999_998);
    fs.copyFileSync(o.aside, a2);
    fs.writeFileSync(path.join(regOf(h), `${COL_ID}.uuid`), '8');
    const r = collectVerb(h, WRONG_TOKEN, { pre: PROBE_STUB, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('registered');
    expect(fs.readFileSync(o.aside, 'utf8')).toBe(o.witness);
    expect(fs.readFileSync(a2, 'utf8')).toBe(o.witness);
    expect(fs.existsSync(witnessOf(h))).toBe(false);
    expect(errOf(), 'the doubt is warned, since the refusal outranks it')
      .toContain(`ccd: warn: 2 compare-and-drop asides of ${COL_ID} stand and no witness does`);
  }, 60_000);

  it('#10: the pause stands: refused paused, and the aside is exactly as it was — the settle runs after the pause', () => {
    const o = asideOnly();
    const ino = inoAt(o.aside);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${PROBE_STUB} ${PAUSE}`, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('paused');
    expect(inoAt(o.aside), 'the aside keeps its inode').toBe(ino);
    expect(fs.readFileSync(o.aside, 'utf8')).toBe(o.witness);
    expect(fs.existsSync(witnessOf(h)), 'nothing was restored').toBe(false);
  }, 60_000);

  it('#11: the order — the witness stands again under its own name when the evaluation begins', () => {
    makeOrphan(h);
    fs.renameSync(witnessOf(h), asideOf(COL_ID));
    const r = collectVerb(h, WRONG_TOKEN,
      { pre: `${PROBE_STUB} ${walkAt(secondsAgoNs(0))} ${FORK_SPY}`, floor: false, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(linesOf(h, 'fork-saw'), 'the fork, entered once, saw the witness under its own name').toEqual(['1']);
  }, 60_000);

  it.skipIf(ROOT_USER)('#12: a move back that fails with no witness standing warns "could not be moved back", never "a newer one stands"', () => {
    makeOrphan(h);
    try {
      const r = collectVerb(h, collectToken(h, { pre: PROBE_STUB }),
        { pre: `${PROBE_STUB} ${RUN8_AT_EMPTIED} ${MOVE_BACK_DENIED}`, extra: ERR });
      expect(r.code, r.stdout + errOf()).toBe(0);
      expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, witness: 'kept' });
    } finally { fs.chmodSync(tmproots(), 0o700); }
    expect(fs.existsSync(witnessOf(h)), 'the CONTROL: no witness stands').toBe(false);
    expect(errOf()).toContain('could not be moved back');
    expect(errOf()).toContain('the next settle under the reap lock restores it');
    expect(errOf()).not.toContain('a newer one stands');
  }, 90_000);

  it('#12b: a move back that loses to a newer witness warns "a newer one stands", and that the next settle leaves it beside it', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h, { pre: PROBE_STUB }),
      { pre: `${PROBE_STUB} ${RUN8_AT_EMPTIED} ${MOVE_BACK_LOSES}`, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, witness: 'kept' });
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the CONTROL: the newer witness stands').toMatch(/ run=9 /);
    expect(errOf()).toContain('a newer one stands');
    expect(errOf()).toContain('the next settle under the reap lock leaves it beside the newer witness');
    expect(errOf()).not.toContain('could not be moved back');
  }, 90_000);
});

describe.skipIf(!LINUX)('the reclaim and expiry tail settles an aside before step (6), and its doubt only warns (path-identity spec §3.6)', () => {
  it('#13: an aside alone is restored, and step (6) removes the leaf and drops the restored witness: tmproots/ ends empty', () => {
    const before = witnessedChild();
    const aside = asideOf(CHILD_ID);
    fs.renameSync(childWitness(), aside);
    expect(fs.readFileSync(aside, 'utf8')).toBe(before);
    reclaimed(childReclaimVerb(h, evalOf(h).token, { pre: NOBODY, extra: ERR }));
    expect(fs.existsSync(childLeaf()), 'the leaf is removed').toBe(false);
    expect(namesIn(), 'the restored witness was dropped, and no aside is left').toEqual([]);
    expect(measOf(reclaimDone())['tmpRootKept']).toBeUndefined();
    expect(errOf(), 'a restore warns nothing').not.toContain('compare-and-drop aside');
  }, 90_000);

  it('#14: an aside of another generation beside the witness is left and warned; the witness is handled as before', () => {
    const before = witnessedChild();
    const aside = asideOf(CHILD_ID);
    const older = before.replace(' run=7 ', ' run=6 ');
    fs.writeFileSync(aside, older);
    reclaimed(childReclaimVerb(h, evalOf(h).token, { pre: NOBODY, extra: ERR }));
    expect(fs.existsSync(childLeaf()), 'the leaf is removed').toBe(false);
    expect(namesIn(), 'the witness was dropped with its leaf; the aside is left').toEqual([path.basename(aside)]);
    expect(fs.readFileSync(aside, 'utf8')).toBe(older);
    expect(errOf()).toContain('ccd: warn: ');
    expect(errOf(), 'the warning names the aside').toContain(aside);
    expect(measOf(reclaimDone())['tmpRootKept']).toBeUndefined();
  }, 90_000);

  it('#15: two asides and no witness: the reclaim completes, warns, leaves both, and keeps no leaf for them', () => {
    const before = witnessedChild();
    const a1 = asideOf(CHILD_ID);
    const a2 = asideOf(CHILD_ID, 9_999_998);
    fs.renameSync(childWitness(), a1);
    fs.copyFileSync(a1, a2);
    reclaimed(childReclaimVerb(h, evalOf(h).token, { pre: NOBODY, extra: ERR }));
    expect(fs.existsSync(childLeaf()), 'the leaf is removed').toBe(false);
    expect([fs.readFileSync(a1, 'utf8'), fs.readFileSync(a2, 'utf8')], 'both asides stand as they were').toEqual([before, before]);
    expect(namesIn()).toEqual([path.basename(a1), path.basename(a2)].sort());
    expect(errOf()).toContain(`ccd: warn: ${CHILD_ID}'s compare-and-drop asides were not settled: 2 compare-and-drop asides of ${CHILD_ID} stand and no witness does`);
    expect(measOf(reclaimDone())['tmpRootKept'], 'an aside keeps no leaf: what it would be without them').toBeUndefined();
  }, 90_000);

  it('#15b: a sole aside that does not read as the witness, and no witness: never restored, the reclaim completes, warns, and the aside stands', () => {
    witnessedChild();
    const aside = asideOf(CHILD_ID);
    fs.renameSync(childWitness(), aside);
    fs.writeFileSync(aside, 'x\n');
    reclaimed(childReclaimVerb(h, evalOf(h).token, { pre: NOBODY, extra: ERR }));
    expect(fs.existsSync(childLeaf()), 'the leaf is removed').toBe(false);
    expect(fs.existsSync(aside), 'the aside stands: it was never linked to the witness’s name').toBe(true);
    expect(fs.readFileSync(aside, 'utf8'), 'the aside stands as it was').toBe('x\n');
    expect(namesIn(), 'only the aside stands: nothing was linked to the witness’s name').toEqual([path.basename(aside)]);
    expect(errOf()).toContain(`ccd: warn: ${CHILD_ID}'s compare-and-drop asides were not settled: the one compare-and-drop aside of ${CHILD_ID}`
      + ` does not read as its witness, so it is never restored: ${aside}`);
    expect(measOf(reclaimDone())['tmpRootKept'], 'an aside keeps no leaf: what it would be without it').toBeUndefined();
  }, 90_000);

  it('#17: ws-expire takes the same tail: an aside alone is restored, then dropped with its absent leaf, and tmproots/ ends empty', () => {
    makeArchived(h);
    plantWitness(EXP_ID);
    const aside = asideOf(EXP_ID);
    fs.renameSync(path.join(tmproots(), EXP_ID), aside);
    fs.rmSync(path.join(h.home, '.cc-tmp', EXP_ID), { recursive: true, force: true });
    const r = expireVerb(h, expireEvalOf(h).token, { pre: NOBODY, extra: ERR });
    expect(r.code, r.stdout + errOf()).toBe(0);
    expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(namesIn(), 'restored, then dropped by step (6)').toEqual([]);
    const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['tmpRootKept'], 'nothing is kept over a leaf proven absent').toBeUndefined();
  }, 120_000);
});

describe('the tail settles on Darwin through link, never a GNU move (path-identity spec §3.6)', () => {
  const pre = `${DARWIN} ${DEVINO_SHIM}`;

  it('#16a: no aside — no link, and no rm of an aside path; the witness goes as before', () => {
    witnessedChild();
    fs.rmSync(childLeaf(), { recursive: true, force: true });
    reclaimed(childReclaimVerb(h, evalOf(h, { pre }).token, { pre: `${pre} ${LINK_SPY} ${RM_SPY}`, extra: ERR }));
    expect(tmprootLinks(), 'no link was made in tmproots/').toEqual([]);
    expect(linesOf(h, 'rm-calls').filter((l) => l.includes(`/tmproots/.${CHILD_ID}.drop.`)), 'no rm of an aside path').toEqual([]);
    expect(namesIn(), 'the witness of a leaf proven absent is dropped').toEqual([]);
  }, 90_000);

  it('#16b: one aside — restored through one link, then dropped with the leaf’s absence', () => {
    witnessedChild();
    fs.rmSync(childLeaf(), { recursive: true, force: true });
    const aside = asideOf(CHILD_ID);
    fs.renameSync(childWitness(), aside);
    reclaimed(childReclaimVerb(h, evalOf(h, { pre }).token, { pre: `${pre} ${LINK_SPY} ${RM_SPY}`, extra: ERR }));
    expect(tmprootLinks(), 'one link, the aside to the witness’s own name').toEqual([`${aside} ${childWitness()}`]);
    expect(namesIn(), 'restored, then dropped').toEqual([]);
  }, 90_000);
});

describe('the settle alone: its answers, and it prints nothing (path-identity spec §3.6)', () => {
  const ID = 'demo-quiet-mesa';
  const w = (): string => path.join(tmproots(), ID);
  /** One settle, sourced, its stderr folded into its stdout: what it prints is only the echo of its answer. */
  const SETTLE = (id: string, pre = ''): string =>
    `exec 2>&1; ${pre} _ws_tmproot_aside_settle '${id}'; echo "[rc=$?] $_WS_ASIDE_DID|$_WS_ASIDE_WHY"`;

  it('#18a: no tmproots/ at all: none, and nothing else is printed', () => {
    expect(fs.existsSync(tmproots()), 'the CONTROL: no tmproots/').toBe(false);
    expect(h.run(SETTLE(ID)).stdout).toBe('[rc=0] none|');
  }, 30_000);

  it('#18b: a sole aside and no witness: restored — the witness IS the aside’s inode (a link, never a copy)', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.renameSync(w(), aside);
    const ino = inoAt(aside);
    expect(h.run(SETTLE(ID)).stdout).toBe('[rc=0] restored|');
    expect(inoAt(w()), 'the restored witness is the aside’s own inode').toBe(ino);
    expect(fs.readFileSync(w(), 'utf8')).toBe(body);
    expect(fs.existsSync(aside)).toBe(false);
  }, 30_000);

  it('#18c: an aside that is the witness (one inode, two names — a restore’s crash state): unlinked', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.linkSync(w(), aside);
    expect(h.run(SETTLE(ID)).stdout).toBe('[rc=0] unlinked|');
    expect(fs.existsSync(aside)).toBe(false);
    expect(fs.readFileSync(w(), 'utf8')).toBe(body);
  }, 30_000);

  it('#18d: an aside of another generation beside the witness: left, named, and only the answer is printed', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    const older = body.replace(' run=7 ', ' run=8 ');
    fs.writeFileSync(aside, older);
    expect(h.run(SETTLE(ID)).stdout).toBe(`[rc=0] left|a compare-and-drop aside of ${ID} was left beside its witness,`
      + ` never restored over it: ${aside} (not the witness that stands at ${w()})`);
    expect(fs.readFileSync(aside, 'utf8')).toBe(older);
    expect(fs.readFileSync(w(), 'utf8')).toBe(body);
  }, 30_000);

  it.each(['.demo-quiet-mesa.drop.1', '-x', '..'])('#18e: an id no witness is named for (%s): unmeasured, and nothing is looked at', (id) => {
    plantWitness(ID);
    fs.writeFileSync(asideOf(ID), 'x');
    expect(h.run(SETTLE(id)).stdout).toBe(`[rc=2] |'${id}' is not an id a witness is named for, so no aside of it was looked at`);
    expect(fs.readFileSync(asideOf(ID), 'utf8')).toBe('x');
  }, 30_000);

  it('#18f: an aside that is the witness’s own inode, beside a witness that does not read as one: unlinked', () => {
    fs.mkdirSync(tmproots(), { recursive: true });
    fs.writeFileSync(w(), 'x');
    fs.linkSync(w(), asideOf(ID));
    expect(h.run(SETTLE(ID)).stdout).toBe('[rc=0] unlinked|');
    expect(fs.existsSync(asideOf(ID))).toBe(false);
    expect(fs.readFileSync(w(), 'utf8'), 'the witness stands as it was').toBe('x');
  }, 30_000);

  it('#18g: restored but not unlinked (the state a death between link and rm leaves): unmeasured, one inode under two names; the next settle unlinks the aside', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.renameSync(w(), aside);
    const RM_FAILS = 'rm() { if [[ "$*" == *"/tmproots/."*".drop."* ]]; then return 1; fi; command rm "$@"; };';
    expect(h.run(SETTLE(ID, RM_FAILS)).stdout).toBe(`[rc=2] |the compare-and-drop aside of ${ID} was restored as its`
      + ` witness, but it could not be unlinked after, so one witness stands under two names until the next settle: ${aside}`);
    expect(inoAt(aside), 'one inode under two names').toBe(inoAt(w()));
    expect(h.run(SETTLE(ID)).stdout, 'the next settle reads it as the witness itself').toBe('[rc=0] unlinked|');
    expect(fs.existsSync(aside)).toBe(false);
    expect(fs.readFileSync(w(), 'utf8')).toBe(body);
  }, 30_000);

  it('#18h: the asides cannot be listed: unmeasured, and an aside it never listed is never read as none', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.renameSync(w(), aside);
    const UNLISTED = '_ws_collect_asides_of() { _WS_ASIDES_WHY=stub; return 2; };';
    expect(h.run(SETTLE(ID, UNLISTED)).stdout)
      .toBe(`[rc=2] |the compare-and-drop asides of ${ID} could not be listed (stub), so none was settled`);
    expect(fs.readFileSync(aside, 'utf8'), 'the aside stands as it was').toBe(body);
    expect(fs.existsSync(w()), 'nothing was restored').toBe(false);
  }, 30_000);

  it('#18i: whether a witness stands cannot be asked: unmeasured, and the one aside is untouched', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.renameSync(w(), aside);
    // `_ws_reclaim_absent` cannot ask about the witness's own name (rc 2, `stub`); every other path is the real ask.
    const WITNESS_UNASKED = 'eval "_t_absent_real()$(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ` _ws_reclaim_absent() { if [[ "$1" == */tmproots/${ID} ]]; then _WS_ABSENT_WHY=stub; return 2; fi; _t_absent_real "$@"; };`;
    expect(h.run(SETTLE(ID, WITNESS_UNASKED)).stdout)
      .toBe(`[rc=2] |whether a witness of ${ID} stands could not be asked (stub), so no aside of it was settled`);
    expect(fs.readFileSync(aside, 'utf8'), 'the aside stands as it was').toBe(body);
    expect(fs.existsSync(w()), 'nothing was restored').toBe(false);
  }, 30_000);

  it('#18j: a link that fails with no witness standing after: unmeasured, and the one aside is untouched', () => {
    const body = plantWitness(ID);
    const aside = asideOf(ID);
    fs.renameSync(w(), aside);
    const LINK_FAILS = 'link() { return 1; };';
    expect(h.run(SETTLE(ID, LINK_FAILS)).stdout).toBe(`[rc=2] |the compare-and-drop aside of ${ID} was not restored,`
      + ` and no witness is proven to stand at ${w()} after: ${aside}`);
    expect(fs.readFileSync(aside, 'utf8'), 'the aside stands as it was').toBe(body);
    expect(fs.existsSync(w()), 'nothing was restored').toBe(false);
  }, 30_000);

  it('#18k: the one aside does not read as a witness (a body of x), no witness, the leaf standing: unmeasured, the aside untouched and nothing at the witness’s name', () => {
    plantWitness(ID);
    fs.rmSync(w());
    const aside = asideOf(ID);
    fs.writeFileSync(aside, 'x\n');
    expect(h.run(SETTLE(ID)).stdout).toBe(`[rc=2] |the one compare-and-drop aside of ${ID} does not read as its witness, so it is never restored: ${aside}`);
    expect(fs.readFileSync(aside, 'utf8'), 'the aside stands as it was').toBe('x\n');
    expect(fs.existsSync(w()), 'nothing stands at the witness’s name').toBe(false);
    expect(namesIn(), 'and nothing else was made').toEqual([path.basename(aside)]);
  }, 30_000);
});
