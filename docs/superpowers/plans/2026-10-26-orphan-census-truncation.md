# Orphan census truncation and pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub #1565. A truncated orphan census is asked again on a back-off that starts at `ORPHAN_RETRY_MS` and says so in the feed (wave 1), and the lane's pressure mode reads the disk alarm's `critical` state (wave 2).

**Architecture:** This is two waves and two PRs, and both change only the server (Coordinator ruling 1). The decisions go into `server/src/orphanTreeLane.ts` (L1). Wave 1: the sweep (`orphanTreeSweep.ts`, L4) gets a truncated arm that keeps a streak of truncated censuses in its memory, asks again on the L1 back-off, and writes a feed row through its existing `record` port. Wave 2: `OrphanTreeBeat` (L4) gets a third constructor port, `diskBlock`, which reads the disk alarm's held block, and it folds that block through the L1 `orphanPressure`. `watch.ts` supplies `() => this.diskAlarm.block()` by changing its one construction line, with no new import. Wave 2 is dispatched once the live claim on `watch.ts` is released.

**Tech Stack:** TypeScript (ESM), vitest, in `server/`.

**Spec:** `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` §2.3 (census bound :141, cadence :175), §4 "Fail toward keeping" (:385), Ruling 4 (:14) and §2.5.1 (:227). The issue is GitHub #1565. All anchors are at `origin/main` `ea1e84c09`.

## Global Constraints

- **Server side only.** Do not touch `ccd/ccd`: open PR #1404 moves the census verb (`WS_ORPHAN_CENSUS_ROWS=4096; WS_ORPHAN_CENSUS_S=60`, `ccd/ccd:16608`). The census document does not change either, because a new field there would collide with #1404.
- **Wave 1 touches neither `server/src/watch.ts` nor `server/src/orphanTreeBeat.ts`** (Coordinator ruling 1). Another wave holds `watch.ts` under a live claim, and the beat's pressure line is wave 2's.
- **In wave 2, `server/src/watch.ts` is touched in exactly one line**, the `orphanBeat` field at `watch.ts:1021`. There is no other route. `Deps` (`server/src/deps.ts`) has no disk field, and the disk alarm is a private `FleetWatcher` field (`watch.ts:1088`). It is a soak-watched file, so the change must have zero net growth (`growth-check.test.ts` lists it at :61).
- Ring rules: decisions live in `orphanTreeLane.ts` (L1, pure, no IO, no clock). The sweep and beat only wire them (L4). Log lines are `console.warn('ccrc-server: …')` and never `req.log`.
- No overloaded null at a seam. A `null` disk block means unknown. It folds to "no pressure" in ONE named L1 function, because the lane treats unknown and not-critical alike: the slower 6 h cadence is the fail-toward-keeping side.
- No change to the wire. `DiskOrphanTrees` (`shared/disk.ts:126-129`) is counts only (`byClass`, `byOutcome`), so it has no slot for a census outcome. `health()` is left as it is (see Scope item 4).
- TDD red-first. Every new guard has a test row that goes red when the guard is removed. Record each before/after measurement in the PR body.
- Deviations: write no D-number. Use the wave's deviation block, which is issued at run open and named in the brief. The only existing number cited here is D-6631.
- Tests run in the foreground from inside `server/` with `./node_modules/.bin/vitest run <file>` and a timeout of at least 600000 ms. Never use bare `npx vitest`.
- The repo is public: keep hostnames, home paths and account names out of the code, tests, commit messages and the PR body.

## Scope decisions (for the coordinator)

1. **Retry, on a back-off (Coordinator ruling 2).** A truncated census sets `lastCensus` the way the unreadable arm does (`orphanTreeSweep.ts:123`), but the wait grows. The first truncated census in a row is asked again after `ORPHAN_RETRY_MS` (15 min), and each further one in a row doubles the wait, capped at the regular cadence: 15, 30, 60, 120 and 240 min, then 6 h. A whole census resets the streak. An unreadable census keeps today's flat `ORPHAN_RETRY_MS`. The streak lives in the sweep's memory, so like the rest of that memory it starts over on a restart. The pass still returns before any offers, so a truncated census audits nothing that pass, not even the trees already in memory (Coordinator ruling 5: the stricter reading of spec :141, "audits nothing new"). Memory, `rows` and `measured` are left untouched, so the memory learned before stays.
2. **Feed row.** Each truncated census writes one row with the new title `orphan census truncated`, through `deps.record`, plus one `console.warn`. The census document carries only `truncated: boolean` (`parseOrphanCensus`, `orphanTreeLane.ts:49`), so the answer does not say which bound it hit. The row says that, and gives the rows seen (`c.rows.length`) and the seconds the census call took, read off the monotonic clock before and after the call (Coordinator ruling 3). The time is how a reader tells which bound stopped it. The server does not copy ccd's 4096 or 60 s into a constant of its own, because a second copy would drift once #1404 lands. There is no once-per-episode flag, because the issue asks for one row per truncated census; the back-off bounds how many there are. A pass with no census due writes nothing.
3. **Pressure: WIRED, not removed (wave 2).** A readable signal exists within the ring rules. `DiskAlarmLane.block()` (`diskAlarmLane.ts:26`) carries `pressure`, which `diskBlockOf` sets as `v.level === 'critical'` (`server/src/disk.ts:216`) and `unmeasuredDiskBlock` holds across an unmeasured read (`server/src/disk.ts:224-233`). Both the beat and the watcher are L4. The thunk hands the beat the held block, and the L1 `orphanPressure` reads it. Ruling 4 and §2.5.1 make pressure raise pacing only (hourly census, 4 audits per pass), and the act cap stays at one per pass. That is already what the pressure branch does, so `ORPHAN_CENSUS_PRESSURE_MS` and `ORPHAN_AUDITS_PER_PASS_PRESSURE` stay.
4. **health(): unchanged.** `DiskOrphanTrees` has no field for a census outcome. Adding one would be a change to the wire (`shared/disk.ts` type plus `readOrphanTrees` plus the PWA reader), and that is outside this small fix. The feed row is the signal. `health()` stays `null` until the first whole census, which the one reader treats as UNKNOWN, and after that it carries the last whole census's counts.

## Review Focus

- A box whose every census truncates (the measured live case: 59.7 s, 88 rows): the lane asks after 15, 30, 60, 120 and 240 min, then every 6 h, writes one row per ask and never populates. The cost is at most one bounded census per back-off step, and about 4 a day in the steady state (Coordinator ruling 7), against the 96 a day a flat 15 min retry would run on the very box whose load caused the truncation. The expected behaviour is a slowing, honest row stream with no audit. Pinned by the back-off and feed rows of Task 1.
- A whole census after a run of truncated ones resets the back-off, so the next truncation is asked again after 15 min. Pinned by the reset row.
- A truncated census after a whole one: earlier outcomes must not be re-said or forgotten, and `health()` must not drop to null. Pinned by `a truncated census keeps the memory it learned before`.
- The disk alarm has not swept yet (`block()` is null) or reads unmeasured: the lane must stay on the 6 h cadence unless a held `critical` stands. Pinned by the `orphanPressure` unit rows.
- Pressure flips between a truncated census and its retry. The retry instant is computed with that pass's `censusMs`. This was already true of the unreadable arm (`:123`) and is accepted, not fixed: the disk level is debounced, and the worst case is pressure→clear, a retry that waits 5 h 15 min instead of 15 min. It is called out in the PR body.
- The beat ignores its port, or `watch.ts` passes `() => false` again. Pinned by the beat test and the `watch.ts` source pin in Task 2.

---

### Task 1 (wave 1): A truncated census retries on a back-off and says so

**Files:**
- Modify: `server/src/orphanTreeLane.ts:10-21` (constants block), `:182-186` (`ORPHAN_FEED_TITLE`), and add the helpers after `orphanFeedRow` (`:188-196`)
- Modify: `server/src/orphanTreeSweep.ts:15-20` (import), `:119-125` (the census call and its arms), and the header comment at `:5-6`
- Test: `server/test/orphan-tree-lane.test.ts` (rig `:24-74`; new rows after `a truncated census audits nothing new`, `:226-232`; feed rows in `describe('the feed and the health block')`)

**Interfaces:**
- Produces (L1, `orphanTreeLane.ts`):
  - `ORPHAN_FEED_TITLE.truncated = 'orphan census truncated'` (a new key on the existing `as const` object)
  - `orphanTruncatedWaitMs(streak: number, censusMs: number): number`, the back-off: `streak` counts the truncated censuses in a row, this one included (1 for the first), and the wait is `ORPHAN_RETRY_MS * 2 ** (streak - 1)`, capped at `censusMs`, the pass's regular cadence. That is 15, 30, 60, 120 and 240 min, then 6 h, at the 6 h cadence.
  - `orphanCensusRetryMono(nowMono: number, censusMs: number, waitMs: number): number`, which returns `nowMono - censusMs + waitMs`: the `lastCensus` that makes the next census due `waitMs` after now. The unreadable arm uses it with `ORPHAN_RETRY_MS`, and the truncated arm with `orphanTruncatedWaitMs`.
  - `orphanTruncatedRow(rowsSeen: number, tookMs: number, waitMs: number): { readonly title: string; readonly body: string }` with the body exactly `` `the orphan census stopped at its bound after ${rowsSeen} rows in ${(tookMs / 1000).toFixed(1)} s (the answer does not say whether rows or time); nothing was audited this pass, asked again in ${waitMs / 60_000} min` ``
- The sweep keeps `truncatedStreak` in its memory: a truncated census adds one, a whole census sets it to 0, and an unreadable census or a pass with no census leaves it where it stood.

- [ ] **Step 1: Write the failing tests** (in `orphan-tree-lane.test.ts`; import `vi`, `ORPHAN_RETRY_MS`, `ORPHAN_CENSUS_PRESSURE_MS`, `orphanTruncatedRow`, `orphanTruncatedWaitMs`, `orphanCensusRetryMono`; `censuses = (r) => r.calls.filter((c) => c[1] === '--orphans').length`; the rig gains `censusTakes(ms)`, which advances its clock inside the census call, and `garbled(v)`, which makes the census answer unparseable)

```ts
const MIN = 60_000;
it('a truncated census is asked again on a back-off: 15, 30, 60, 120 and 240 min, then 6 h', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); expect(censuses(r)).toBe(1);
  let n = 1;
  for (const wait of [15, 30, 60, 120, 240, 360, 360]) {
    r.advance(wait * MIN - 1); await r.sweep.pass(); expect(censuses(r), `before ${wait} min`).toBe(n);
    r.advance(1); await r.sweep.pass(); n += 1; expect(censuses(r), `at ${wait} min`).toBe(n);
  }
});
it('a whole census resets the back-off', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); r.advance(15 * MIN); await r.sweep.pass(); r.advance(30 * MIN); await r.sweep.pass();
  r.truncate(false); r.advance(60 * MIN); await r.sweep.pass(); expect(censuses(r)).toBe(4);
  r.truncate(true); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass(); expect(censuses(r)).toBe(5);
  r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass(); expect(censuses(r)).toBe(5);
  r.advance(1); await r.sweep.pass(); expect(censuses(r)).toBe(6);
});
it('an unreadable census is asked again after ORPHAN_RETRY_MS, and not before', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.garbled(true);
  await r.sweep.pass(); expect(censuses(r)).toBe(1);
  for (let i = 2; i <= 4; i += 1) {
    r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass(); expect(censuses(r)).toBe(i - 1);
    r.advance(1); await r.sweep.pass(); expect(censuses(r)).toBe(i);
  }
  expect(r.feed).toEqual([]);
});
it('an unreadable census between truncated ones neither resets nor extends the back-off', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); r.advance(15 * MIN); await r.sweep.pass();
  r.garbled(true); r.advance(30 * MIN); await r.sweep.pass(); r.garbled(false);
  r.advance(ORPHAN_RETRY_MS); await r.sweep.pass(); expect(censuses(r)).toBe(4);
  r.advance(60 * MIN - 1); await r.sweep.pass(); expect(censuses(r)).toBe(4);
  r.advance(1); await r.sweep.pass(); expect(censuses(r)).toBe(5);
});
it('a truncated census keeps the memory it learned before, and audits nothing that pass', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', refused('dirty'));
  await r.sweep.pass(); const before = r.sweep.health(); const audits = r.calls.filter((c) => c[1] === '--orphan-hex').length;
  r.truncate(true); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
  expect(r.sweep.health()).toEqual(before);
  expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toHaveLength(audits);
  r.truncate(false); r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
  expect(r.feed.filter((f) => f.title === 'orphan worktree left')).toHaveLength(1);
});
// in 'the feed and the health block':
it('each truncated census writes one feed row and one log line with the rows it saw, the time it took and the wait', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.add('/p/.claude/worktrees/b', 'claude', clean('b'));
    r.truncate(true); r.censusTakes(59_700);
    await r.sweep.pass(); await r.sweep.pass();
    expect(r.feed).toEqual([orphanTruncatedRow(2, 59_700, ORPHAN_RETRY_MS)]);
    expect(r.feed[0]!.title).toBe('orphan census truncated');
    expect(r.feed[0]!.body).toContain('after 2 rows in 59.7 s'); expect(r.feed[0]!.body).toContain('asked again in 15 min');
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: orphan census truncated'))).toHaveLength(1);
    r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
    expect(r.feed).toHaveLength(2); expect(r.feed[1]!.body).toContain('asked again in 30 min');
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: orphan census truncated'))).toHaveLength(2);
  } finally { warn.mockRestore(); }
});
it('a truncated census leaves health unknown before the first whole census', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); expect(r.sweep.health()).toBeNull();
});
// in 'L1: the readers and the licence':
it('the back-off doubles from ORPHAN_RETRY_MS and stops at the pass cadence; the retry instant is the wait after now', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 40].map((s) => orphanTruncatedWaitMs(s, ORPHAN_CENSUS_MS) / MIN)).toEqual([15, 30, 60, 120, 240, 360, 360, 360]);
  expect([1, 2, 3, 4].map((s) => orphanTruncatedWaitMs(s, ORPHAN_CENSUS_PRESSURE_MS) / MIN)).toEqual([15, 30, 60, 60]);
  expect(orphanCensusRetryMono(10 * HOUR, ORPHAN_CENSUS_MS, ORPHAN_RETRY_MS)).toBe(10 * HOUR - ORPHAN_CENSUS_MS + ORPHAN_RETRY_MS);
  expect(orphanCensusRetryMono(10 * HOUR, HOUR, 30 * MIN)).toBe(9 * HOUR + 30 * MIN);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts`
Expected: FAIL. The new imports are undefined, the back-off row reads one census at 15 min, and `feed` is `[]`. The unreadable row PASSES already, because the flat retry exists; it pins that arm so that changing it later reds.

- [ ] **Step 3: Implement**

In `orphanTreeLane.ts`, add the Interfaces items. In `orphanTreeSweep.ts`, add `private truncatedStreak = 0`. Read `d.mono()` inside the queued census call, just before `censusOrphans`, as `askedAt`. The unreadable arm becomes `this.lastCensus = orphanCensusRetryMono(now, censusMs, ORPHAN_RETRY_MS)`. Before `this.lastCensus = now`, add the truncated arm: add one to the streak, take `waitMs = orphanTruncatedWaitMs(streak, censusMs)`, set `lastCensus = orphanCensusRetryMono(now, censusMs, waitMs)`, build `orphanTruncatedRow(c.rows.length, now - askedAt, waitMs)`, `console.warn(`ccrc-server: ${row.title}: ${row.body}`)`, `d.record(row.title, row.body)` and return. A whole census sets the streak to 0. Leave `rows`, `memory` and `measured` untouched. Update the header comment to say that a truncated census audits nothing and is asked again on the back-off. Cite no line numbers in code (the `citations` ratchet).

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts`
Expected: PASS, including the existing `a truncated census audits nothing new`.

- [ ] **Step 5: Mutation rows** (measured, recorded in the PR body)

Each mutant is made on the source file, run alone, and restored from a saved copy checked with `cmp`. Never use `git checkout`.
- The truncated arm's `lastCensus` back to `now`: the back-off row reds.
- `orphanTruncatedWaitMs` flat at `ORPHAN_RETRY_MS`: the back-off row and the L1 row red.
- The cap removed: the back-off row reds at the 6 h step, and the L1 row reds.
- The reset on a whole census removed: the reset row reds.
- The unreadable arm adding to or clearing the streak: the interleave row reds.
- The unreadable arm's `lastCensus` back to `now`: the unreadable row reds.
- The `d.record` call deleted: the feed row reds.
- The `console.warn` deleted: the feed row's spy assertion reds.
- `orphanTruncatedRow` ignoring `rowsSeen`, or `askedAt` read after the call: the feed row reds.
- The truncated arm taking `this.rows = c.rows`: the memory row reds.

- [ ] **Step 6: Gates** (Coordinator ruling 6, and the brief)

From `server/`, one file at a time, under `nice -n 19 ionice -c3`, with `--pool=forks --maxWorkers=2`: `orphan-tree-lane`; every `single-definition/*.test.ts`; `GROWTH_CHECK=1` `growth-check`; `citations`; `docs-parity`; `topology-clean`; `private-names`; `dtbd`; `typecheck-tests`; then `deviation-refs` after `git fetch origin main`. No whole suite runs locally.

- [ ] **Step 7: Commit**

```bash
git add server/src/orphanTreeLane.ts server/src/orphanTreeSweep.ts server/test/orphan-tree-lane.test.ts
git commit -m "fix(orphan-lane): a truncated census retries on a back-off and writes one feed row (#1565)"
```

### Wave 2 (Task 2): Pressure reads the disk alarm's critical state

This task is wave 2 (Coordinator ruling 1). It is not part of wave 1's commits or gates, and it is dispatched once the live claim on `server/src/watch.ts` is released. Its anchors are at `ea1e84c09`; re-read them at wave 2's base.

**Files:**
- Modify: `server/src/orphanTreeLane.ts` (a new L1 function beside `orphanCensusDue`, `:213-215`)
- Modify: `server/src/orphanTreeBeat.ts:19` (constructor), `:32` (`pressure: () => false`)
- Modify: `server/src/watch.ts:1021` (ONE line, net zero, no new import: `watch.ts` imports only `OrphanTreeBeat` from the lane's files, at `:238`)
- Modify: `README.md:4545-4548` (the lane paragraph)
- Test: `server/test/orphan-tree-lane.test.ts` (rig `:59`), Create: `server/test/orphan-tree-beat.test.ts`

**Interfaces:**
- Consumes: `DiskHealth` from `shared/disk.ts:132-142` (`pressure: boolean`), `DiskAlarmLane.block(): DiskHealth | null`
- Produces:
  - `orphanPressure(block: Pick<DiskHealth, 'pressure'> | null): boolean` in `orphanTreeLane.ts`, which returns `block?.pressure === true`. Its doc comment says: null is unknown and reads as no pressure, the 6 h side, which fails toward keeping.
  - `new OrphanTreeBeat(deps: () => Deps, mono: () => number, diskBlock: () => Pick<DiskHealth, 'pressure'> | null)`. The third parameter is REQUIRED, so leaving it out is a compile error. The sweep's port becomes `pressure: () => orphanPressure(this.diskBlock())`.

- [ ] **Step 1: Write the failing tests**

In `orphan-tree-lane.test.ts`, the rig gets `let pressure = false;`, `pressure: () => pressure` at `:59` and a returned helper `pressured: (v: boolean): void => { pressure = v; }`. Import `ORPHAN_CENSUS_PRESSURE_MS`, `ORPHAN_AUDITS_PER_PASS`, `ORPHAN_AUDITS_PER_PASS_PRESSURE` and `orphanPressure`.

```ts
it('under pressure the census is hourly, and not otherwise', async () => {
  for (const p of [true, false]) {
    const r = rig(); r.pressured(p); r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass(); r.advance(ORPHAN_CENSUS_PRESSURE_MS); await r.sweep.pass();
    expect(censuses(r), `pressure ${p}`).toBe(p ? 2 : 1);
  }
});
it('under pressure a pass offers 4 learning audits, else 2', async () => {
  for (const p of [true, false]) {
    const r = rig(); r.pressured(p);
    for (const c of 'abcde') r.add(`/p/.claude/worktrees/${c}`, 'claude', clean(c));
    await r.sweep.pass();
    expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toHaveLength(p ? ORPHAN_AUDITS_PER_PASS_PRESSURE : ORPHAN_AUDITS_PER_PASS);
  }
});
it('orphanPressure is true only on a held pressure block; null is unknown and reads as none', () => {
  expect(orphanPressure(null)).toBe(false);
  expect(orphanPressure({ pressure: false })).toBe(false);
  expect(orphanPressure({ pressure: true })).toBe(true);
});
```

`server/test/orphan-tree-beat.test.ts` (new): it builds `new OrphanTreeBeat(() => fakeDeps, () => mono, () => block)`, where `block` is `null`, `{ pressure: false }` or `{ pressure: true }`. `fakeDeps` is `as unknown as Deps` with `coord: {}`, `cfg: { registryDir: '/reg' }`, `io.readdirMeasured` returning no markers, `fleetState: { ccdVerbs: ['orphan-v1', 'reclaim-pause-v1', 'actor-flags-v1'] }`, `queue: { run: (_k, fn) => fn() }`, `fleetIdentity: undefined`, and `runCcd` answering `ws-audit --orphans` with `{ mode: 'orphans', truncated: false, rows: [] }` while counting the calls. An empty census writes no row, so `notifyLog` is never reached.

```ts
it('the beat hands its pressure port to the sweep', async () => { /* {pressure:true}: pass, mono += ORPHAN_CENSUS_PRESSURE_MS, pass → 2 censuses; {pressure:false} and null → 1 */ });
it('watch.ts builds the beat with the disk alarm\'s pressure', () => {
  const src = readFileSync(new URL('../src/watch.ts', import.meta.url), 'utf8');
  expect(src).toMatch(/new OrphanTreeBeat\([^\n]*,\s*\(\) => this\.diskAlarm\.block\(\)\)/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts test/orphan-tree-beat.test.ts`
Expected: FAIL. `orphanPressure` is not exported, the beat test reads 1 census under pressure (the port is ignored, `:32`), and the source pin finds no match. The rig's two cadence rows already PASS, because the sweep's branch exists. They pin the branch so that removing it later reds.

- [ ] **Step 3: Implement**

Add `orphanPressure` to `orphanTreeLane.ts`. In the beat, add a third constructor parameter `private readonly diskBlock: () => Pick<DiskHealth, 'pressure'> | null` (a type-only import of `DiskHealth` from `shared/disk.js`, beside the existing `DiskOrphanTrees` import at `:13`), and pass `pressure: () => orphanPressure(this.diskBlock())` in place of `() => false` at `:32`. In `watch.ts:1021`, make the field read `new OrphanTreeBeat(() => this.deps, () => this.childReclaimLaneNow().monoMs, () => this.diskAlarm.block())` on the same single line. The thunk is lazy, so `diskAlarm` being declared later (`:1088`) is fine. Run `growth-check.test.ts` to confirm the delta is 0.

Update the README paragraph to say that pressure mode is the disk alarm's `critical`, and that a truncated census audits nothing, writes one `orphan census truncated` row and is asked again on the back-off (15 minutes, doubling to the 6 hour cadence, reset by a whole census; wave 1). Keep the paragraph's line count where you can, and run the README citation and docs-parity tests named below.

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts test/orphan-tree-beat.test.ts test/growth-check.test.ts test/single-definition.test.ts`
Then: `cd server && ./node_modules/.bin/tsc --noEmit -p .`
Expected: all PASS, and `tsc` exits 0.

- [ ] **Step 5: Mutation rows** (measured)

Put `pressure: () => false` back in the beat, and the beat port row reds. Change `watch.ts`'s thunk to `() => null`, and the source pin reds. Make `orphanPressure` return `block !== null`, and its unit row reds. Make the sweep's `orphanCensusDue` call pass `false`, and the hourly row reds. Make the sweep always use `ORPHAN_AUDITS_PER_PASS`, and the 4/2 row reds. Restore each from a saved copy.

- [ ] **Step 6: Whole server suite, in the foreground**

Run: `cd server && npm run test` (timeout 600000 ms)
Expected: green. Any of the known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in isolation before it is called a break.

- [ ] **Step 7: Commit**

```bash
git add server/src/orphanTreeLane.ts server/src/orphanTreeBeat.ts server/src/watch.ts server/test/orphan-tree-lane.test.ts server/test/orphan-tree-beat.test.ts README.md
git commit -m "fix(orphan-lane): pressure mode reads the disk alarm's critical state (#1565)"
```

## Deviations found

Wave 1 was issued D-6987 to D-6990 at dispatch (run 986).

- **D-6987** — the truncated census's back-off, and its reset. A truncated census is asked again after `ORPHAN_RETRY_MS`, and each further truncated census in a row doubles the wait (`orphanTruncatedWaitMs`): 15, 30, 60, 120 and 240 min, then 6 h. A whole census resets the streak. Two readings the rulings left open, decided here: the cap is the PASS's cadence (`censusMs`), which is `ORPHAN_CENSUS_MS` on every pass until wave 2 wires pressure, so under pressure a truncating box never waits longer than the hourly cadence a healthy one keeps; and an unreadable census neither resets nor extends the streak (it keeps its own flat retry, D-6989). The streak lives in the sweep's memory and starts over on a restart.
- **D-6988** — the truncated census's feed row, `orphan census truncated`, and its `console.warn`. One per truncated census, with the rows seen, the seconds the census call took (read off the monotonic clock inside the queued call, before and after) and the wait before the next ask. ccd's row and time bounds are not copied into the server.
- **D-6989** — the unreadable census's flat `ORPHAN_RETRY_MS` retry, unchanged in behaviour, now computed by the shared `orphanCensusRetryMono` and pinned by a row of its own.
- **D-6990** — spare, unused.

## Coordinator rulings (2026-10-26)

The worker applies these rulings to this plan as its second commit and records each change in As built.

1. **Two waves.** Task 2 needs one line in `server/src/watch.ts`. Another wave holds that file under a live claim until the delegation broker's soak ends on 2026-10-31. So this wave is Task 1 only, and Task 2 becomes wave 2, dispatched once that claim is released. Take Task 2 out of this wave's commits and gates. Keep its text in the plan, retitled "Wave 2", so the next worker starts from it.
2. **A back-off, not a flat 15 minutes.** On a box where every census truncates, a flat `ORPHAN_RETRY_MS` retry runs a 60 s walk 96 times a day and writes 96 rows, on the very box whose load caused the truncation. So:
   - the first retry after a truncated census comes after `ORPHAN_RETRY_MS`;
   - each further truncated census in a row doubles the wait, capped at the regular cadence (`ORPHAN_CENSUS_MS`);
   - a whole census resets it;
   - an unreadable census keeps today's flat `ORPHAN_RETRY_MS`.
   Name the L1 helper by its job, for example `orphanTruncatedRetryMono(nowMono, censusMs, streak)`. Keep the streak in the sweep's memory: like the rest of that memory, it starts over on a restart. Pin the sequence (15, 30, 60, 120 and 240 min, then 6 h) and the reset, with rows.
3. **The row names the bound by time.** Take the critique's fix: read the monotonic clock before and after the census call, and put the elapsed seconds in the body ("after N rows in T s"). Do not copy ccd's 4096 and 60 constants. Add the row that pins it.
4. **The unreadable arm's retry gets its own row,** as the critique asks: a census answer that cannot be parsed is asked again after `ORPHAN_RETRY_MS`, and not before. Add its mutation line too.
5. **Scope decision 1 keeps the strict reading.** A truncated pass also skips audits of trees already in memory, the stricter reading of spec :141. Say so in Scope decision 1.
6. **Gates.**
   - Run growth-check with `GROWTH_CHECK=1`.
   - Add `citations` and `docs-parity` if README or a cited comment changes.
   - Correct the two drifted anchors.
   - Add `vi` to the test file's import, for the warn spy.
7. **Review Focus** names the cost: at most one bounded census per back-off step, and about 4 a day in the steady state on a box that always truncates.

## As built

### The rulings, applied to this plan (wave 1's second commit)

- **Ruling 1:** the Goal and Architecture name two waves. A Global Constraint keeps `watch.ts` and `orphanTreeBeat.ts` out of wave 1. Task 2 is retitled "Wave 2 (Task 2)" and keeps its text, with a note that it is not part of wave 1's commits or gates.
- **Ruling 2:** Scope decision 1 is now the back-off (15, 30, 60, 120 and 240 min, then 6 h, reset by a whole census; an unreadable census keeps the flat retry). Task 1's interfaces become `orphanTruncatedWaitMs(streak, censusMs)` and `orphanCensusRetryMono(nowMono, censusMs, waitMs)`, the second shared by both arms, and the streak lives in the sweep. Task 1 gains the back-off, reset and interleave rows and their mutation lines. The helper is split by job: the back-off is one function and the retry instant another, because the unreadable arm needs the second without the first.
- **Ruling 3:** the row's body says "after N rows in T s" and the wait. `orphanTruncatedRow` takes the rows, the milliseconds the call took and the wait. The rig gains `censusTakes(ms)`, and the feed row pins `in 59.7 s`.
- **Ruling 4:** Task 1 gains the row `an unreadable census is asked again after ORPHAN_RETRY_MS, and not before` and its mutation line. The rig gains `garbled(v)`.
- **Ruling 5:** Scope decision 1 says that a truncated pass skips the audits of trees already in memory too. The memory row asserts that no audit runs on that pass.
- **Ruling 6:** the gates are listed in Task 1 Step 6, with `GROWTH_CHECK=1`, `citations` and `docs-parity`. The test imports `vi` for the warn spy. Three drifted anchors are corrected: `parseOrphanCensus`'s truncated check (`orphanTreeLane.ts:49`, was `:48`); `unmeasuredDiskBlock` (`server/src/disk.ts:224-233`, was the unqualified `disk.ts:220-231`, which also reads as `shared/disk.ts`); and the README lane paragraph (`README.md:4545-4548`, was `:4546-4548`). Task 1's own anchors are re-measured at `ea1e84c09`.
- **Ruling 7:** Review Focus names the cost: at most one bounded census per back-off step, and about 4 a day in the steady state.
- Wave 2's README step now says the back-off rather than "after 15 minutes".
