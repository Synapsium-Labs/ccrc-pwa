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
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
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
    [undefined, '15'], ['3', '3'], ['0', '0'], ['007', '7'], ['15', '15'],
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

  it('a probe that answers UNMEASURED keeps the temp root; the act completes and says why', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(leafOf(CHILD_ID), 'cdk.out'), { recursive: true });
    const pre = "CCD_RECLAIM_TMPROOT_WAIT_S=1; _ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY='stub: not measured'; return 2; };";
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(fs.existsSync(path.join(leafOf(CHILD_ID), 'cdk.out')), 'kept').toBe(true);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('stub: not measured');
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
    const t0 = Date.now();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=2;' });
    expect(Date.now() - t0, 'the tail sat out its bound').toBeGreaterThanOrEqual(2_000);
    expect(r.code, r.stdout + r.stderr).toBe(0);
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
