// The reclaim tail's bounded wait for the pane's processes (child reclamation
// wave 6, spec §5.6). MEASURED 2026-10-04: the tail removed
// `~/.cc-tmp/ccrc-pwa-swift-hollow` while the killed pane's processes still
// ran with TMPDIR=<leaf>, and one re-created the leaf 3.7 s after `reclaim
// done`. Now the tail asks `_ws_path_users` after the kill, until it answers
// nobody or the bound passes, and asks again at the instant of removal; a leaf
// still in use, or unmeasured, is KEPT and recorded, and the act completes.
// The stragglers are REAL processes (`pathUsersFixture.ts`), spawned by vitest
// — never by ccd — with TMPDIR inside the fixture HOME.
// FIXTURE HOME ONLY: `CHILD_STUBS` records the unit and pane calls; the bound
// is lowered through `CCD_RECLAIM_TMPROOT_WAIT_S`, which can only lower it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, CHILD_RUN, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';
import { holdProc, type Held } from './pathUsersFixture.js';

let h: PrHarness;
let held: Held[] = [];
beforeEach(() => { h = makePrHarness('ccrc-tmproot-wait-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });
const { KILL } = verbHelpers(() => h);
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };
const LINUX = process.platform === 'linux';
const leafOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const doneOf = (act: string): Record<string, unknown> => eventsOf(h.home, act).find((e) => e['outcome'] === 'done')!;
const probes = (): string[] => h.calls().filter((l) => l.startsWith('probe'));

describe('the bound: at most 15 s, and the override can only LOWER it', () => {
  it.each([
    // '010' and '08' pin the `10#`: read as octal, '010' is 8 and '08' is no number at all.
    [undefined, '15'], ['3', '3'], ['0', '0'], ['010', '10'], ['08', '8'], ['15', '15'],
    ['16', '15'], ['99', '15'], ['abc', '15'], ['', '15'], ['-1', '15'],
  ] as const)('CCD_RECLAIM_TMPROOT_WAIT_S=%s -> %s', (v, want) => {
    const set = v === undefined ? 'unset CCD_RECLAIM_TMPROOT_WAIT_S;' : `CCD_RECLAIM_TMPROOT_WAIT_S='${v}';`;
    expect(h.sh(`${set} _ws_reclaim_tmproot_wait_s`)).toBe(want);
  }, 60_000);
});

describe('_ws_reclaim_tmproot_quiet — asked until nobody, or the bound', () => {
  const COUNTING = (nobodyAt: number): string =>
    `_ws_path_users() { echo probe >> "$HOME/ccd-calls"; [[ $(grep -c '^probe' "$HOME/ccd-calls") -ge ${nobodyAt} ]] && return 0; return 1; };`;

  it('asks every quarter second until nobody — three asks, then 0', () => {
    const rc = h.sh(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${COUNTING(3)} _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf '%s' "$?"`);
    expect(rc).toBe('0');
    expect(probes()).toHaveLength(3);
  }, 60_000);

  it('a bound of 0 asks exactly once, and answers what it was told', () => {
    const rc = h.sh(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=0; ${COUNTING(99)} _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf '%s' "$?"`);
    expect(rc).toBe('1');
    expect(probes()).toHaveLength(1);
  }, 60_000);

  it('on Darwin it asks ONCE — waiting cannot change an answer that never looks', () => {
    const t0 = Date.now();
    const rc = h.sh('CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=5;'
      + ' _ws_path_users() { echo probe >> "$HOME/ccd-calls"; return 2; };'
      + ' _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf \'%s\' "$?"');
    expect(rc).toBe('2');
    expect(probes()).toHaveLength(1);
    expect(Date.now() - t0, 'it did not sit out the bound').toBeLessThan(4_000);
  }, 60_000);

  /** Runs the wait on a 1 s bound with a probe that answers 1 forever (after `delay`, when given), and
   *  answers its rc and its own elapsed time, measured in the shell around the one call. */
  const neverLeaves = (opts: { delay?: string; pre?: string } = {}): { rc: string; ms: number } => {
    const out = h.sh(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=1; ${opts.pre ?? ''}`
      + ` _ws_path_users() { echo probe >> "$HOME/ccd-calls"; ${opts.delay ? `sleep ${opts.delay};` : ''} return 1; };`
      + ' t0=$EPOCHREALTIME; _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; rc=$?; t1=$EPOCHREALTIME;'
      + ' printf \'%s %s\' "$rc" "$(( (${t1/[.,]/} - ${t0/[.,]/}) / 1000 ))"');
    const [rc = '', ms = ''] = out.split(' ');
    return { rc, ms: Number(ms) };
  };

  it('a user that never leaves: the wait sits out its bound, and overruns it by no more than one sleep', () => {
    const { rc, ms } = neverLeaves();
    expect(rc).toBe('1');
    expect(ms, 'it sat out the bound').toBeGreaterThanOrEqual(1_000);
    expect(ms, 'never past the bound by more than a sleep (and slack)').toBeLessThan(1_000 + 250 + 1_500);
    expect(probes().length, 'asked more than once').toBeGreaterThanOrEqual(2);
    expect(probes().length, 'at most bound*4+1 asks').toBeLessThanOrEqual(5);
  }, 60_000);

  it('the CLOCK ends the wait: a probe that takes 0.3 s is asked fewer than bound*4+1 times', () => {
    // Each ask and its sleep take at least 0.55 s, so a 1 s bound admits three asks at most. Only a
    // wait the clock does not end reaches the count's fifth.
    const { rc, ms } = neverLeaves({ delay: '0.3' });
    expect(rc).toBe('1');
    expect(ms, 'it sat out the bound').toBeGreaterThanOrEqual(1_000);
    expect(probes().length, 'the clock, not the count, ended it').toBeLessThanOrEqual(4);
  }, 60_000);

  it('a clock that never advances cannot hold the wait: it ends after bound*4+1 asks', () => {
    // `_plat_epoch_ms` stands still. After 40 reads it jumps ahead, and says so, so that a wait the
    // count does not end still ends, and the case reds instead of hanging.
    const FROZEN = '_plat_epoch_ms() { echo x >> "$HOME/clock-reads";'
      + ' if (( $(wc -l < "$HOME/clock-reads") > 40 )); then echo clock-escape >> "$HOME/ccd-calls"; printf 9999999999999;'
      + ' else printf 1000000000000; fi; };';
    const { rc } = neverLeaves({ pre: FROZEN });
    expect(rc).toBe('1');
    expect(h.calls(), 'the count ended it, not the escape').not.toContain('clock-escape');
    expect(probes()).toHaveLength(5);
  }, 60_000);
});

describe('the tail', () => {
  it('waits AFTER the kill and BEFORE the worktree goes, then asks again at the instant of removal', () => {
    const c = makeChild(h);
    fs.mkdirSync(leafOf(CHILD_ID), { recursive: true });
    const pre = `_ws_path_users() { if [[ -d "${c.wt}" ]]; then echo "probe wt-present $1" >> "$HOME/ccd-calls";`
      + ` else echo "probe wt-gone $1" >> "$HOME/ccd-calls"; fi; _WS_PATH_USERS_WHY=''; return 0; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(probes()).toEqual([`probe wt-present ${leafOf(CHILD_ID)}`, `probe wt-gone ${leafOf(CHILD_ID)}`]);
    expect(h.calls().indexOf(KILL), 'the kill comes first').toBeLessThan(h.calls().indexOf(probes()[0]!));
    expect(fs.existsSync(leafOf(CHILD_ID)), 'nobody: the helper removed it').toBe(false);
  }, 90_000);

  /** A probe's reason its own cleaning lets through (it cleans C0 and DEL in a path, never bytes 0x80-0xFF,
   *  and caps nothing): a tab, a byte 0xFF, and 400 more of those. Raw, each 0xFF reaches the encoder as
   *  U+FFFD, six bytes of `\ufffd`, and the row outgrows the journal's line cap. */
  const dirtyWhy = (head: string): string =>
    `_WS_PATH_USERS_WHY="${head}"$'\\t\\xff'"$(printf '\\xff%.0s' {1..400})"`;
  /** The kept reason on the done row: ONE short clean line, and the row keeps its `meas`. */
  const cleanReason = (done: Record<string, unknown>, word: string): string => {
    expect(done['truncated'], 'the row was never cut down to fit').toBeUndefined();
    expect(measOf(done)['childOf'], 'the row keeps its meas').toBe(String(CHILD_RUN));
    expect(measOf(done)['tip'], 'the row keeps its meas').toMatch(/^[0-9a-f]{40}$/);
    const detail = String(done['detail']);
    const head = `temp root ${leafOf(CHILD_ID)} kept (${word}): `;
    expect(detail.startsWith(head), detail).toBe(true);
    const why = detail.slice(head.length);
    expect(why.endsWith('…'), 'a cut is marked').toBe(true);
    expect(why.slice(0, -1), 'printable ASCII only').toMatch(/^[ -~]*$/);
    expect(Buffer.byteLength(why.slice(0, -1), 'utf8'), 'cut at 300 bytes').toBeLessThanOrEqual(300);
    return why;
  };

  it('a probe that answers UNMEASURED keeps the temp root; the act completes and says why, as one short clean line', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(leafOf(CHILD_ID), 'cdk.out'), { recursive: true });
    const pre = `CCD_RECLAIM_TMPROOT_WAIT_S=1; _ws_path_users() { _WS_PATH_USERS_PIDS=''; ${dirtyWhy('stub: not measured')}; return 2; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(fs.existsSync(path.join(leafOf(CHILD_ID), 'cdk.out')), 'kept').toBe(true);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('stub: not measured');
    const why = cleanReason(done, 'unmeasured');
    expect(why.startsWith('stub: not measured??'), why).toBe(true);
  }, 90_000);

  it('a probe that answers IN USE keeps the temp root; its reason reaches the row as one short clean line', () => {
    makeChild(h);
    fs.mkdirSync(path.join(leafOf(CHILD_ID), 'cdk.out'), { recursive: true });
    const pre = `CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; ${dirtyWhy('stub: in use')}; return 1; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(leafOf(CHILD_ID), 'cdk.out')), 'kept').toBe(true);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('in-use');
    const why = cleanReason(done, 'in-use');
    expect(why.startsWith('still in use after the bounded wait - stub: in use??'), why).toBe(true);
  }, 90_000);

  it('a clock that never advances cannot hold the tail: the wait ends after bound*4+1 asks, and the temp root is kept', () => {
    makeChild(h);
    fs.mkdirSync(leafOf(CHILD_ID), { recursive: true });
    // The clock stands still for the WAIT alone; every other reader gets the real one. After 40 reads
    // it jumps ahead, and says so, so that a wait the count does not end still ends, and the case reds.
    const pre = 'CCD_RECLAIM_TMPROOT_WAIT_S=1;'
      + ' eval "_t_epoch_real()$(declare -f _plat_epoch_ms | tail -n +2)";'
      + ' _plat_epoch_ms() { [[ "${FUNCNAME[1]}" == _ws_reclaim_tmproot_quiet ]] || { _t_epoch_real; return; };'
      + ' echo x >> "$HOME/clock-reads";'
      + ' if (( $(wc -l < "$HOME/clock-reads") > 40 )); then echo clock-escape >> "$HOME/ccd-calls"; printf 9999999999999;'
      + ' else printf 1000000000000; fi; };'
      + ' _ws_path_users() { echo "probe ${FUNCNAME[1]}" >> "$HOME/ccd-calls";'
      + " _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY='stub: in use'; return 1; };";
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(h.calls(), 'the count ended the wait, not the escape').not.toContain('clock-escape');
    expect(probes().filter((l) => l === 'probe _ws_reclaim_tmproot_quiet'), 'bound*4+1 asks (Darwin: one)')
      .toHaveLength(LINUX ? 5 : 1);
    expect(probes().filter((l) => l === 'probe _ws_reclaim_tail'), 'step (6) asked once more').toHaveLength(1);
    expect(fs.existsSync(leafOf(CHILD_ID)), 'kept').toBe(true);
    expect(measOf(doneOf('reclaim'))['tmpRootKept']).toBe('in-use');
  }, 90_000);

  it.each(['link', 'file'] as const)('a %s leaf is no one’s temp root: never kept for its users — unlinked on every platform, its target untouched', (shape) => {
    makeChild(h);
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the child’s');
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    if (shape === 'link') fs.symlinkSync(outside, leafOf(CHILD_ID));
    else fs.writeFileSync(leafOf(CHILD_ID), 'a file where the root should be');
    // The Darwin answer, forced on any host: the probe cannot measure. A link or file leaf goes anyway.
    const pre = "CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY='stub: not measured'; return 2; };";
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(() => fs.lstatSync(leafOf(CHILD_ID)), `the ${shape} leaf itself is unlinked`).toThrow();
    expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'its target is untouched').toBe('not the child’s');
    expect(fs.existsSync(path.join(h.home, '.cc-tmp')), 'the root itself stays').toBe(true);
    expect(measOf(doneOf('reclaim'))['tmpRootKept'], 'nothing was kept').toBeUndefined();
  }, 90_000);

  it.each([['in use', 1], ['unmeasured', 2]] as const)('a probe answering %s over a temp root that does NOT stand records nothing — kept means something stands', (_label, rc) => {
    // Every Darwin `ws-expire` of a non-child meets this: the probe answers unmeasured, and no temp root ever stood.
    makeArchived(h);
    expect(fs.existsSync(leafOf(EXP_ID)), 'the CONTROL: no temp root stands').toBe(false);
    const pre = `CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY='stub: answered ${rc}'; return ${rc}; };`;
    const r = expireVerb(h, expireToken(h), { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    const done = doneOf('expire');
    expect(measOf(done)['tmpRootKept']).toBeUndefined();
    expect(String(done['detail'] ?? ''), 'no detail claims a temp root was kept').not.toContain('temp root');
  }, 90_000);
});

/** A straggler: it waits for the kill (the `_ws_unsupervise` stub below touches `killed` right before
 *  the tail's kill), then for 8 s it re-creates the leaf the moment it disappears — the swift-hollow
 *  write — and otherwise writes into the leaf that stands and exits. `$2` records which it did. */
const STRAGGLER = [
  'k="$1"; out="$2"; i=0',
  'while [ ! -e "$k" ] && [ "$i" -lt 1200 ]; do sleep 0.05; i=$((i+1)); done',
  'i=0',
  'while [ "$i" -lt 160 ]; do',
  '  if [ ! -d "$TMPDIR" ]; then mkdir -p "$TMPDIR"; echo late > "$TMPDIR/late"; echo recreated > "$out"; exit 0; fi',
  '  sleep 0.05; i=$((i+1))',
  'done',
  'echo late > "$TMPDIR/late"; echo wrote-in-place > "$out"',
].join('\n');
const MARK_KILL = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; : > "$HOME/killed"; };';

describe.skipIf(!LINUX)('real stragglers (Linux /proc)', () => {
  it('THE SWIFT-HOLLOW RACE: a straggler with TMPDIR=<leaf> that outlives the kill is waited for, and the leaf goes after it', async () => {
    makeChild(h);
    const leaf = leafOf(CHILD_ID);
    fs.mkdirSync(path.join(leaf, 'cdk.out'), { recursive: true });
    const branch = path.join(h.home, 'straggler-branch');
    const s = hold({ cwd: h.home, tmpdir: leaf, script: STRAGGLER, args: [path.join(h.home, 'killed'), branch] });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${MARK_KILL} CCD_RECLAIM_TMPROOT_WAIT_S=14;` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    await s.exited;
    expect(fs.readFileSync(branch, 'utf8').trim(), 'the straggler outlived the kill and wrote while the leaf stood')
      .toBe('wrote-in-place');
    expect(fs.existsSync(leaf), 'the straggler did not re-create the leaf after the reclaim').toBe(false);
    expect(measOf(doneOf('reclaim'))['tmpRootKept'], 'nothing was kept').toBeUndefined();
  }, 120_000);

  it('a straggler that outlives the BOUND: the reclaim completes, the temp root is KEPT and recorded `in-use`', () => {
    const c = makeChild(h);
    const leaf = leafOf(CHILD_ID);
    fs.mkdirSync(leaf, { recursive: true });
    fs.writeFileSync(path.join(leaf, 'scratch'), 'kept');
    const s = hold({ cwd: h.home, tmpdir: leaf });
    // The WAIT is timed, never the verb (which alone takes longer than the bound): the real probe is
    // wrapped, and each ask logs its caller and the clock as it starts and as it ends.
    const TIMED = 'eval "_t_path_users_real()$(declare -f _ws_path_users | tail -n +2)";'
      + ' _ws_path_users() { local r; echo "probe-start ${FUNCNAME[1]} $(_plat_epoch_ms)" >> "$HOME/ccd-calls";'
      + ' _t_path_users_real "$@"; r=$?; echo "probe-end ${FUNCNAME[1]} $(_plat_epoch_ms)" >> "$HOME/ccd-calls"; return $r; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `CCD_RECLAIM_TMPROOT_WAIT_S=2; ${TIMED}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const asks = probes().map((l) => { const [kind = '', fn = '', t = ''] = l.split(' '); return { kind, fn, t: Number(t) }; });
    const at = (fn: string, kind: string): number[] => asks.filter((e) => e.fn === fn && e.kind === kind).map((e) => e.t);
    const qS = at('_ws_reclaim_tmproot_quiet', 'probe-start');
    const qE = at('_ws_reclaim_tmproot_quiet', 'probe-end');
    const step6 = at('_ws_reclaim_tail', 'probe-start');
    expect(qS.length, 'the tail waited: it asked from the wait').toBeGreaterThanOrEqual(1);
    expect(qE.at(-1)! - qS[0]!, 'the wait sat out its bound').toBeGreaterThanOrEqual(2_000 - 200);
    expect(qS.at(-1)! - qS[0]!, 'no ask of the wait began past the bound (and one sleep, and slack)')
      .toBeLessThan(2_000 + 250 + 1_500);
    expect(step6, 'step (6) asked once more').toHaveLength(1);
    expect(step6[0]!, 'after the wait').toBeGreaterThanOrEqual(qE.at(-1)!);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row').toBeNull();
    expect(fs.readFileSync(path.join(leaf, 'scratch'), 'utf8'), 'the temp root is kept').toBe('kept');
    const events = eventsOf(h.home, 'reclaim');
    expect(events.map((e) => e['outcome']), 'a completed act, not a refusal').toEqual(['intent', 'done']);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('in-use');
    expect(String(done['detail'])).toContain(`temp root ${leaf} kept (in-use)`);
    expect(String(done['detail'])).toContain(`process ${s.pid} carries TMPDIR=${leaf}`);
  }, 120_000);

  it('ws-expire’s tail waits and keeps the same way — `in-use` on the expire done row', () => {
    makeArchived(h);
    const leaf = leafOf(EXP_ID);
    fs.mkdirSync(leaf, { recursive: true });
    hold({ cwd: h.home, tmpdir: leaf });
    const r = expireVerb(h, expireToken(h), { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=1;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(fs.existsSync(leaf)).toBe(true);
    expect(measOf(doneOf('expire'))['tmpRootKept']).toBe('in-use');
  }, 120_000);
});
