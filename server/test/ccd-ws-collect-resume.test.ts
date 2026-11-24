// `ws-collect`'s resume (child reclamation wave 7, spec §5.10): a run that died anywhere leaves its quarantine RECORD,
// and the next pass resumes FROM IT — never recomputing the tree token or the idle floor (the move stamped the leaf's
// ctime), re-proving the slot's leaf against the record and step 5's proofs before anything is removed. A record not
// provably this verb's (its body names another id: the reader answers 2, ruling G5), or whose leaf is not the one it
// names, is never taken; a record or a slot leaf that VANISHED inside the lock is a retry, never that terminal word.
// A crash is the verb's process exiting inside a seam (`crashAt`): no trap runs, and the kernel frees the lock.
// Every resume token here is the one `ws-audit --collect` mints (`collectToken`), never computed by hand.
// FIXTURE HOME ONLY.
//
// EVERY CASE CARRIES A MEASURED BUDGET, NOT THE SUITE'S 20 s (the collect-resume flake, `Refs #2491`). A case is a
// sequence of real ccd runs: each sources ccd whole and forks about 185 processes (about 120 execs, nine of them
// python3; `strace -f` over this file, 62 runs), and some ask the real `/proc` walk (`_ws_path_users`). Alone on the
// fleet box a run took 0.2 to 2 s and a case 0.2 to 5.6 s. CI's server shard 10 packs this file beside
// `session-hook-append-race.test.ts` on two workers, and that file's eight-lane `mv` race is a fork storm for 22 s:
// every case this file had in flight then took 3 to 6 times as long (measured here beside it, ten runs: the slowest
// case 12.4 to 18.5 s, one run 6.3 s), and three CI runs on 2026-11-17 timed out at 20 s, each inside that window.
// So a case's budget is its runs at `RUN_MS` each, plus `WALK_BOUND_MS` for each real walk (the walk's own bound: a
// walk that needs it all still answers, and the assertion, not the clock, decides). The walk is stubbed
// (`PROBE_STUB`, answering "nobody", which the real walk answers here too) in every case whose subject is not the
// in-use answer; one case per arm keeps the real walk: the resume from `moved`, the resume from an empty slot then a
// fresh pass, and the order resumed from `removed`. `plan` states both counts, and each case measures them (`runs`
// through the harness, `walks` through the walk's `/proc` seam) and fails when they differ, so a budget never goes
// stale silently.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { scaled } from './timeScale.js';
import {
  COL_ID, GAP_LOG, PROBE_STUB, WRONG_TOKEN, collectAudit, collectToken, collectVerb, crashAt, docOf, evalSays, gapAt,
  gaps, inoAt, makeOrphan, quarantineOf, records, recordsDir, regOf, slots, witnessOf,
} from './wsCollectFixture.js';

/** One ccd run's budget: the slowest run measured beside the fork storm (6.3 s, walks included), about doubled. */
const RUN_MS = 12_000;
/** One real walk's budget: `WS_PATH_USERS_SCAN_S`, the bound ccd itself puts on the walk, read from its source. */
const WALK_BOUND_MS = 1000 * Number(/^WS_PATH_USERS_SCAN_S=(\d+)\b/m.exec(ccdSource())?.[1] ?? NaN);
/** Counts every real walk: `_ws_path_users_many` asks this seam once per walk, after every path is resolved. */
const WALK_COUNT = '_ws_path_users_proc_root() { printf \'w\\n\' >> "$HOME/walks"; printf \'%s\' /proc; };';
interface Plan { walk: 'real' | 'stub'; runs: number; walks: number }
/** A case that asks the real walk `walks` times over `runs` ccd runs. */
const real = (runs: number, walks: number): Plan => ({ walk: 'real', runs, walks });
/** A case whose walk is the stub: `runs` ccd runs, and no real walk at all. */
const stub = (runs: number): Plan => ({ walk: 'stub', runs, walks: 0 });
const budgetMs = (p: Plan): number => scaled(p.runs * RUN_MS + p.walks * WALK_BOUND_MS);

let h: PrHarness;
let plan: Plan | undefined;
let runs = 0;
beforeEach(() => {
  h = makePrHarness('ccrc-ws-collect-resume-');
  plan = undefined;
  runs = 0;
  // Every ccd run of the case, `makeOrphan`'s included, goes through these two, so each is counted and carries the
  // case's walk: the counting seam always, and the stub before the snippet's own seams when the plan says so.
  const sh = h.sh;
  const run = h.run;
  const seams = (): string => `${WALK_COUNT} ${plan?.walk === 'stub' ? PROBE_STUB : ''}`;
  h.sh = (snippet, env) => { runs += 1; return sh(`${seams()} ${snippet}`, env); };
  h.run = (snippet) => { runs += 1; return run(`${seams()} ${snippet}`); };
});
afterEach(() => { h.cleanup(); });

/** A case run under its plan: the budget is the plan's, and the case ends by measuring the plan's two counts. */
function planned(name: string, p: Plan, body: () => void): void {
  it(name, () => {
    plan = p;
    body();
    const walks = fs.existsSync(path.join(h.home, 'walks'))
      ? fs.readFileSync(path.join(h.home, 'walks'), 'utf8').split('\n').filter(Boolean).length : 0;
    expect({ runs, walks }, 'the measured counts its budget is written from').toEqual({ runs: p.runs, walks: p.walks });
  }, budgetMs(p));
}

describe('the budget', () => {
  it('reads the walk’s bound from ccd: 10 s, so a real walk is budgeted at what ccd allows it', () => {
    expect(WALK_BOUND_MS).toBe(10_000);
  });
});

const LINUX = process.platform === 'linux';
const recPath = (): string => path.join(recordsDir(h), records(h)[0]!);
const slotDir = (): string => path.join(quarantineOf(h), slots(h)[0]!);
const intents = (): number => eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'intent').length;

describe.skipIf(!LINUX)('a run that died resumes FROM ITS RECORD', () => {
  planned('died after the move: the next pass re-proves, removes and finishes — resumed, and no second record', real(5, 8), () => {
    const o = makeOrphan(h);
    const r1 = collectVerb(h, collectToken(h), { pre: crashAt('moved') });
    expect(r1.code).toBe(137);
    expect(fs.existsSync(o.leaf)).toBe(false);
    expect(records(h)).toHaveLength(1);
    const name = records(h)[0]!;
    const r2 = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, record: name, resumed: true, witness: 'dropped' });
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded', 'slotted', 'moved',
      'locked', 'consented', 'moved', 'proven', 'removed', 'emptied', 'witnessed', 'dropped']);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
    expect(fs.existsSync(witnessOf(h))).toBe(false);
    const ev = eventsOf(h.home, 'collect').slice(-2);
    expect(ev.map((e) => e['outcome'])).toEqual(['intent', 'done']);
    expect(measOf(ev[0]!)['resumed']).toBe(name);
  });

  planned('a resume never re-asks the idle floor: the move stamped the leaf’s ctime, and the floor is back at its production value', stub(5), () => {
    makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const r = collectVerb(h, collectToken(h, { floor: false }), { floor: false });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, resumed: true });
  });

  planned('died before the move (a record and an empty slot): the leaf keeps its place AND its witness; state-changed; then a fresh pass collects', real(7, 6), () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('slotted') }).code).toBe(137);
    expect(slots(h)).toHaveLength(1);
    expect(records(h)).toHaveLength(1);
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
    expect(docOf(collectVerb(h, collectToken(h)).stdout)).toMatchObject({ collected: COL_ID, resumed: false });
  });

  planned('died before the move, then a slot or record that cannot be cleared: failed quarantine-kept — the record KEPT, the leaf and its witness where they were', stub(5), () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('slotted') }).code).toBe(137);
    const nodrop = "_ws_collect_record_drop() { _WS_QREC_WHY='stub: not proven gone'; return 2; };";
    const r = collectVerb(h, collectToken(h), { pre: nodrop });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^the quarantine record \S+ is kept, and nothing further was removed: the leaf never left /);
    expect(records(h), 'the record, kept').toHaveLength(1);
    expect(inoAt(o.leaf), 'the leaf, where it was').toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
  });

  planned('died before the move, then a stray entry reaches the empty slot inside the lock: the unwind is an rmdir, never a recursive remove — KEPT, the entry standing', stub(5), () => {
    // The evaluation found the slot empty (an `unmoved` resume); what reaches it after the consent is not this verb's
    // to empty (review 369's C3: a recursive remove at this call site stayed green).
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('slotted') }).code).toBe(137);
    const slot = slotDir();
    const r = collectVerb(h, collectToken(h), { pre: gapAt('consented', `printf s > '${slot}/stray'`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^the quarantine record \S+ is kept, and nothing further was removed: the leaf never left /);
    expect(fs.readFileSync(path.join(slot, 'stray'), 'utf8'), 'the stray entry stands').toBe('s');
    expect(records(h), 'the record, kept').toHaveLength(1);
    expect(inoAt(o.leaf), 'the leaf, where it was').toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
  });

  for (const [point, witness] of [['removed', 'dropped'], ['emptied', 'dropped'], ['witnessed', 'absent']] as const) {
    planned(`died at ${point}: the order finishes from there — witness ${witness}, the record last`, point === 'removed' ? real(5, 4) : stub(5), () => {
      makeOrphan(h);
      expect(collectVerb(h, collectToken(h), { pre: crashAt(point) }).code).toBe(137);
      expect(records(h)).toHaveLength(1);
      const r = collectVerb(h, collectToken(h));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness });
      expect(slots(h)).toEqual([]);
      expect(records(h)).toEqual([]);
    });
  }

  planned('died at removed, but ~/.cc-tmp reads off the record’s device: failed probe-unmeasured — the record, its empty slot and the witness as they were; on the record’s own device, it finishes', stub(7), () => {
    // An absence needs the recorded device (departure collect-absence-needs-the-recorded-device): with `~/.cc-tmp`'s
    // volume missing and its mount point empty, `removed` would drop the witness and the record over a slot that still
    // holds the leaf. A forged `dev=` in the record stands for the missing volume, with no mount.
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('removed') }).code).toBe(137);
    const rec = recPath();
    const slot = slotDir();
    const real = fs.readFileSync(rec, 'utf8');
    const forged = real.replace(/\bdev=\d+\b/, 'dev=1');
    fs.writeFileSync(rec, forged);
    const audit = JSON.parse(collectAudit(h).stdout.trim().split('\n').pop()!) as Record<string, unknown>;
    expect([audit['verdict'], (audit['collect'] as Record<string, unknown>)['unmeasured']], 'the audit')
      .toEqual(['unmeasured', 'device']);
    const r = collectVerb(h, WRONG_TOKEN, { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toMatch(/ is on device \d+, not on device 1 that the quarantine record \S+ carries /);
    expect(gaps(h).slice(-1), 'refused at the verdict point').toEqual(['locked']);
    expect(fs.readFileSync(rec, 'utf8'), 'the record').toBe(forged);
    expect(fs.readdirSync(slot), 'the slot, standing empty').toEqual([]);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness').toBe(o.witness);
    expect(intents(), 'no second intent: it acted on nothing').toBe(1);
    fs.writeFileSync(rec, real);
    expect(docOf(collectVerb(h, collectToken(h)).stdout), 'the CONTROL: on the record’s own device it finishes')
      .toMatchObject({ collected: COL_ID, resumed: true, witness: 'dropped' });
  });

  planned('a resume re-proves step 5: a child that took the id after the crash stops it, and the leaf goes back', stub(4), () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const rec = recPath();
    fs.writeFileSync(path.join(regOf(h), `${COL_ID}.child`), '8\n');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, rec) });
    expect(docOf(r.stdout)['refused']).toBe('registered');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });

  planned('a record whose slot cannot be derived (the reader’s rc 3, ruling R-a): failed probe-unmeasured and retried — never quarantine-kept, nothing touched', stub(6), () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const rec = recPath();
    const slot = slotDir();
    // the physical ~/.cc-tmp stops resolving between `_ws_collect_qdir` and the resume's read: Task 4's reader answers 3
    const unresolved = '_ws_collect_record_read() { [[ -e "$1" ]] || return 1;'
      + ' _WS_QPATH_WHY=\'stub: ~/.cc-tmp cannot be resolved\'; return 3; };';
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN, rec)} ${unresolved}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('was never derived');
    expect(records(h), 'the record stands').toHaveLength(1);
    expect(inoAt(path.join(slot, 'leaf')), 'the slot’s leaf, untouched').toBe(o.ino);
    expect(eventsOf(h.home, 'collect').at(-1)!['refusal']).toBe('probe-unmeasured');
    expect(intents(), 'no second intent: it acted on nothing').toBe(1);
    expect(docOf(collectVerb(h, collectToken(h)).stdout), 'resolvable again, the next pass finishes from the record')
      .toMatchObject({ collected: COL_ID, resumed: true });
  });

  planned('a record that VANISHED between the evaluation and the verb’s read, inside the lock (ruling R-l): refused state-changed and retried — never quarantine-kept', stub(5), () => {
    // Only an actor that does not take the reap lock removes a record; the next audit reads the id afresh. The real
    // evaluation runs (so the consent is the audit's own resume token), and the record is removed directly after it.
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const slot = slotDir();
    const vanish = 'eval "$(declare -f _ws_collect_fork | sed \'1s/^_ws_collect_fork /_ws_collect_fork_real /\')";'
      + ' _ws_collect_fork() { _ws_collect_fork_real "$@"; local r=$?; rm -f -- "$_WS_COLLECT_RECORD"; return $r; };';
    const r = collectVerb(h, collectToken(h), { pre: vanish });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('state-changed');
    expect(String(doc['detail'])).toContain('vanished');
    expect(records(h), 'the record is gone, as the race left it').toEqual([]);
    expect(inoAt(path.join(slot, 'leaf')), 'the slot’s leaf, untouched').toBe(o.ino);
    expect(eventsOf(h.home, 'collect').at(-1)!['refusal']).toBe('state-changed');
    expect(intents(), 'no second intent: it acted on nothing').toBe(1);
  });

  planned('a slot leaf that VANISHED between the evaluation and the verb’s identity check: failed probe-unmeasured and retried — never quarantine-kept', stub(6), () => {
    // `_ws_collect_ident`'s rc 1 is also "nothing stands, PROVEN"; a leaf gone from its slot is no foreign object in
    // it. The next pass reads the phase `removed` off the disk and finishes the order.
    makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const rec = recPath();
    fs.rmSync(path.join(slotDir(), 'leaf'), { recursive: true });
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, rec) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('vanished');
    expect(records(h), 'the record stands').toHaveLength(1);
    expect(intents(), 'no second intent: it acted on nothing').toBe(1);
    expect(docOf(collectVerb(h, collectToken(h)).stdout), 'the next pass finishes from the record')
      .toMatchObject({ collected: COL_ID, resumed: true, witness: 'dropped' });
  });
});

describe.skipIf(!LINUX)('a record that is not provably this verb’s is never taken', () => {
  planned('a slot whose leaf is not the one its record names: quarantine-kept, nothing touched — at the audit and at the verb', stub(5), () => {
    const o = makeOrphan(h);
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    const slot = slotDir();
    fs.renameSync(path.join(slot, 'leaf'), path.join(slot, 'leaf.orig'));
    fs.mkdirSync(path.join(slot, 'leaf'));
    expect(JSON.parse(collectAudit(h).stdout.trim().split('\n').pop()!).verdict, 'the audit').toBe('quarantine-kept');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, recPath()) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(inoAt(path.join(slot, 'leaf.orig'))).toBe(o.ino);
    expect(fs.existsSync(path.join(slot, 'leaf'))).toBe(true);
    expect(records(h)).toHaveLength(1);
    expect(eventsOf(h.home, 'collect').at(-1)!['refusal']).toBe('quarantine-kept');
    expect(intents(), 'the verb journaled no second intent: it acted on nothing').toBe(1);
  });

  planned('a forged record — named for this id, its body naming another — is never taken, and what its slot holds stands', stub(3), () => {
    const o = makeOrphan(h);
    const name = `${COL_ID}.1791000000000000000.4242`;
    const slot = path.join(quarantineOf(h), `slot.${name}`);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(path.join(slot, 'leaf'), { recursive: true });
    fs.writeFileSync(path.join(slot, 'leaf', 'precious.txt'), 'not the collector’s\n');
    const st = fs.lstatSync(path.join(slot, 'leaf'), { bigint: true });
    const at = /at=(\d{13})/.exec(o.witness)![1]!;
    fs.mkdirSync(recordsDir(h), { recursive: true });
    const rec = path.join(recordsDir(h), name);
    fs.writeFileSync(rec, `v=1 id=demo-quiet-other dev=${st.dev} ino=${st.ino}`
      + ` btime=${st.birthtimeNs / 1_000_000_000n} run=7 at=${at} token=${WRONG_TOKEN} checkouts=\n`);
    // the CONTROL: Task 4's reader refuses the forgery whole (rc 2, every field cleared, ruling G5), so the verb's own
    // read of the record is what stands between it and an act
    expect(h.sh(`_ws_collect_record_read '${rec}'; printf '%s|%s' "$?" "$_WS_QREC_SLOT"`)).toBe('2|');
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN, rec) });
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(slot, 'leaf', 'precious.txt'), 'utf8')).toBe('not the collector’s\n');
    expect(inoAt(o.leaf), 'the real leaf, untouched').toBe(o.ino);
  });
});
