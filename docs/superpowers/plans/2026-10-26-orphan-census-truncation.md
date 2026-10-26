# Orphan census truncation and pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub #1565. A truncated orphan census is asked again after `ORPHAN_RETRY_MS` and says so in the feed, and the lane's pressure mode reads the disk alarm's `critical` state.

**Architecture:** This is one wave and one PR, and it changes only the server. The decisions go into `server/src/orphanTreeLane.ts` (L1). The sweep (`orphanTreeSweep.ts`, L4) gets a truncated arm that mirrors the unreadable arm and writes a feed row through its existing `record` port. `OrphanTreeBeat` (L4) gets a third constructor port, `diskBlock`, which reads the disk alarm's held block, and it folds that block through the L1 `orphanPressure`. `watch.ts` supplies `() => this.diskAlarm.block()` by changing its one construction line, with no new import.

**Tech Stack:** TypeScript (ESM), vitest, in `server/`.

**Spec:** `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` §2.3 (census bound :141, cadence :175), §4 "Fail toward keeping" (:385), Ruling 4 (:14) and §2.5.1 (:227). The issue is GitHub #1565. All anchors are at `origin/main` `ea1e84c09`.

## Global Constraints

- **Server side only.** Do not touch `ccd/ccd`: open PR #1404 moves the census verb (`WS_ORPHAN_CENSUS_ROWS=4096; WS_ORPHAN_CENSUS_S=60`, `ccd/ccd:16608`). The census document does not change either, because a new field there would collide with #1404.
- **`server/src/watch.ts` is touched in exactly one line**, the `orphanBeat` field at `watch.ts:1021`. There is no other route. `Deps` (`server/src/deps.ts`) has no disk field, and the disk alarm is a private `FleetWatcher` field (`watch.ts:1088`). It is a soak-watched file, so the change must have zero net growth (`growth-check.test.ts` lists it at :61).
- Ring rules: decisions live in `orphanTreeLane.ts` (L1, pure, no IO, no clock). The sweep and beat only wire them (L4). Log lines are `console.warn('ccrc-server: …')` and never `req.log`.
- No overloaded null at a seam. A `null` disk block means unknown. It folds to "no pressure" in ONE named L1 function, because the lane treats unknown and not-critical alike: the slower 6 h cadence is the fail-toward-keeping side.
- No change to the wire. `DiskOrphanTrees` (`shared/disk.ts:126-129`) is counts only (`byClass`, `byOutcome`), so it has no slot for a census outcome. `health()` is left as it is (see Scope item 4).
- TDD red-first. Every new guard has a test row that goes red when the guard is removed. Record each before/after measurement in the PR body.
- Deviations: write no D-number. Use the wave's deviation block, which is issued at run open and named in the brief. The only existing number cited here is D-6631.
- Tests run in the foreground from inside `server/` with `./node_modules/.bin/vitest run <file>` and a timeout of at least 600000 ms. Never use bare `npx vitest`.
- The repo is public: keep hostnames, home paths and account names out of the code, tests, commit messages and the PR body.

## Scope decisions (for the coordinator)

1. **Retry.** A truncated census sets `lastCensus` the way the unreadable arm does (`orphanTreeSweep.ts:123`), so the next census is `ORPHAN_RETRY_MS` (15 min) away. The pass still returns before any offers, so a truncated census audits nothing that pass (spec :141, "audits nothing new"). Memory, `rows` and `measured` are left untouched, so the memory learned before stays.
2. **Feed row.** Each truncated census writes one row with the new title `orphan census truncated`, through `deps.record`, plus one `console.warn`. The census document carries only `truncated: boolean` (`parseOrphanCensus`, `orphanTreeLane.ts:48`), so the answer does not say which bound it hit. The row says that, and gives the rows seen (`c.rows.length`). The server does not copy ccd's 4096 or 60 s into a constant of its own, because a second copy would drift once #1404 lands. There is no once-per-episode flag, because the issue asks for one row per truncated census. A pass with no census due writes nothing.
3. **Pressure: WIRED, not removed.** A readable signal exists within the ring rules. `DiskAlarmLane.block()` (`diskAlarmLane.ts:26`) carries `pressure`, which `diskBlockOf` sets as `v.level === 'critical'` (`disk.ts:216`) and `unmeasuredDiskBlock` holds across an unmeasured read (`disk.ts:220-231`). Both the beat and the watcher are L4. The thunk hands the beat the held block, and the L1 `orphanPressure` reads it. Ruling 4 and §2.5.1 make pressure raise pacing only (hourly census, 4 audits per pass), and the act cap stays at one per pass. That is already what the pressure branch does, so `ORPHAN_CENSUS_PRESSURE_MS` and `ORPHAN_AUDITS_PER_PASS_PRESSURE` stay.
4. **health(): unchanged.** `DiskOrphanTrees` has no field for a census outcome. Adding one would be a change to the wire (`shared/disk.ts` type plus `readOrphanTrees` plus the PWA reader), and that is outside this small fix. The feed row is the signal. `health()` stays `null` until the first whole census, which the one reader treats as UNKNOWN, and after that it carries the last whole census's counts.

## Review Focus

- A box whose every census truncates (the measured live case: 59.7 s, 88 rows): the lane asks every 15 min, writes one row per ask and never populates. The expected behaviour is a steady, honest row stream with no audit. Pinned by the retry and feed rows of Task 1.
- A truncated census after a whole one: earlier outcomes must not be re-said or forgotten, and `health()` must not drop to null. Pinned by `a truncated census keeps the memory it learned before`.
- The disk alarm has not swept yet (`block()` is null) or reads unmeasured: the lane must stay on the 6 h cadence unless a held `critical` stands. Pinned by the `orphanPressure` unit rows.
- Pressure flips between a truncated census and its retry. The retry instant is computed with that pass's `censusMs`. This was already true of the unreadable arm (`:123`) and is accepted, not fixed: the disk level is debounced, and the worst case is pressure→clear, a retry that waits 5 h 15 min instead of 15 min. It is called out in the PR body.
- The beat ignores its port, or `watch.ts` passes `() => false` again. Pinned by the beat test and the `watch.ts` source pin in Task 2.

---

### Task 1: A truncated census retries and says so

**Files:**
- Modify: `server/src/orphanTreeLane.ts:11-21` (constants block), `:182-186` (`ORPHAN_FEED_TITLE`), and append a helper after `orphanFeedRow` (`:188-195`)
- Modify: `server/src/orphanTreeSweep.ts:15-20` (import), `:122-125` (census arms)
- Test: `server/test/orphan-tree-lane.test.ts` (new rows after `a truncated census audits nothing new`, :226-232; feed rows in `describe('the feed and the health block')`)

**Interfaces:**
- Produces (L1, `orphanTreeLane.ts`):
  - `ORPHAN_FEED_TITLE.truncated = 'orphan census truncated'` (a new key on the existing `as const` object)
  - `orphanCensusRetryMono(nowMono: number, censusMs: number): number`, which returns `nowMono - censusMs + ORPHAN_RETRY_MS` ("the next census is due `ORPHAN_RETRY_MS` after now"). The unreadable arm and the truncated arm both use it.
  - `orphanTruncatedRow(rowsSeen: number): { readonly title: string; readonly body: string }` with the body exactly `` `the orphan census stopped at its bound after ${rowsSeen} rows (the answer does not say whether rows or time); nothing new was audited, asked again in ${ORPHAN_RETRY_MS / 60_000} min` ``

- [ ] **Step 1: Write the failing tests** (in `orphan-tree-lane.test.ts`; import `ORPHAN_RETRY_MS`, `orphanTruncatedRow`, `orphanCensusRetryMono`; `censuses = () => r.calls.filter((c) => c[1] === '--orphans').length`)

```ts
it('a truncated census is asked again after ORPHAN_RETRY_MS, not ORPHAN_CENSUS_MS', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); expect(censuses(r)).toBe(1);
  r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass(); expect(censuses(r)).toBe(1);
  r.advance(1); await r.sweep.pass(); expect(censuses(r)).toBe(2);
});
it('a truncated census keeps the memory it learned before', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', refused('dirty'));
  await r.sweep.pass(); const before = r.sweep.health();
  r.truncate(true); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
  expect(r.sweep.health()).toEqual(before);
  r.truncate(false); r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
  expect(r.feed.filter((f) => f.title === 'orphan worktree left')).toHaveLength(1);
});
// in 'the feed and the health block':
it('each truncated census writes one feed row with the rows it saw, and a pass with no census writes none', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.add('/p/.claude/worktrees/b', 'claude', clean('b')); r.truncate(true);
  await r.sweep.pass(); await r.sweep.pass();
  expect(r.feed).toEqual([orphanTruncatedRow(2)]);
  expect(r.feed[0]!.title).toBe('orphan census truncated');
  expect(r.feed[0]!.body).toContain('after 2 rows'); expect(r.feed[0]!.body).toContain('15 min');
  r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
  expect(r.feed).toHaveLength(2);
});
it('a truncated census leaves health unknown before the first whole census', async () => {
  const r = rig(); r.add('/p/.claude/worktrees/a', 'claude', clean('a')); r.truncate(true);
  await r.sweep.pass(); expect(r.sweep.health()).toBeNull();
});
it('orphanCensusRetryMono puts the next census ORPHAN_RETRY_MS away at either cadence', () => {
  expect(orphanCensusRetryMono(10 * HOUR, ORPHAN_CENSUS_MS)).toBe(10 * HOUR - ORPHAN_CENSUS_MS + ORPHAN_RETRY_MS);
  expect(orphanCensusRetryMono(10 * HOUR, HOUR)).toBe(9 * HOUR + ORPHAN_RETRY_MS);
});
```

Also add one `vi.spyOn(console, 'warn')` assertion to the feed row test: exactly one call per truncated census, whose first argument starts with `'ccrc-server: orphan census truncated'`. Restore the spy in `finally`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts`
Expected: FAIL. The import of `orphanTruncatedRow`/`orphanCensusRetryMono` is undefined, and once they are stubbed, the retry row reads `censuses === 1` at the third pass and `feed` is `[]`.

- [ ] **Step 3: Implement**

In `orphanTreeLane.ts`, add the three Interfaces items. In `orphanTreeSweep.ts`, the unreadable arm becomes `this.lastCensus = orphanCensusRetryMono(now, censusMs)`. Then, before `this.lastCensus = now`, add a truncated arm: `if (c.truncated) { this.lastCensus = orphanCensusRetryMono(now, censusMs); const row = orphanTruncatedRow(c.rows.length); console.warn(`ccrc-server: ${row.title}: ${row.body}`); d.record(row.title, row.body); return; }`. Leave `rows`, `memory` and `measured` untouched. Update the header comment at `:5-6` to say that a truncated census is asked again after 15 min.

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts`
Expected: PASS, including the existing `a truncated census audits nothing new`.

- [ ] **Step 5: Mutation rows** (measured, recorded in the PR body)

Revert the truncated arm's `lastCensus` to `now`, and the retry row reds. Delete the `d.record` call, and the feed row test reds. Delete the `console.warn`, and the spy assertion reds. Make `orphanTruncatedRow` ignore `rowsSeen`, and `toContain('after 2 rows')` reds. Restore each mutation from a saved copy and check the sha. Never use `git checkout`.

- [ ] **Step 6: Commit**

```bash
git add server/src/orphanTreeLane.ts server/src/orphanTreeSweep.ts server/test/orphan-tree-lane.test.ts
git commit -m "fix(orphan-lane): a truncated census is asked again after 15 min and writes one feed row (#1565)"
```

### Task 2: Pressure reads the disk alarm's critical state

**Files:**
- Modify: `server/src/orphanTreeLane.ts` (a new L1 function beside `orphanCensusDue`, `:213-215`)
- Modify: `server/src/orphanTreeBeat.ts:19` (constructor), `:32` (`pressure: () => false`)
- Modify: `server/src/watch.ts:1021` (ONE line, net zero, no new import: `watch.ts` imports only `OrphanTreeBeat` from the lane's files, at `:238`)
- Modify: `README.md:4546-4548` (the lane paragraph)
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

Update the README paragraph to say that pressure mode is the disk alarm's `critical`, and that a truncated census audits nothing new, writes one `orphan census truncated` row and is asked again after 15 minutes. Keep the paragraph's line count where you can, and run the README citation and docs-parity tests named below.

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

Use the wave's deviation block, which is issued at run open and named in the brief. No number is written here.

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
