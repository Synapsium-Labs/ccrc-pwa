# Landing order, wave 3c — Task 7's re-run preconditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task 7's re-run able to pass. Four things go wrong today, each found on 2026-10-20: the landing lane cannot see this project (its slow read measured, the server's timeouts inferred), a failed PR sweep is silent, two suite flakes remove PRs from the queue, and the runbook has four gaps. This wave fixes each of them.

**Architecture:**
- **ccd.** `ccd pr-state --project` keeps every answer it gives today. For each workspace it now reads the PR rows' head commits with one batched `git cat-file --batch-check` and one `git rev-list <tip>`, instead of two `git` processes per listed PR.
- **Server.** The PR sweep says which way a read failed, and it logs a failure once, not on every pass. The server's close waits for the server-caps write a tick started.
- **Tests.** The supervisor tick diet's differential file is split by locale, so that no CI shard carries both halves.
- **Runbook.** Task 7's text in the wave-2 plan gains the re-run's four changes.

**Tech Stack:** bash 5.2, python 3.12 (embedded in `ccd/ccd`), git 2.43, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.2: the queue, the landing lane and its two notices;
- §7: no GitHub-sourced string in an argv.

**Other sources:**
- The programme ledger: `docs/superpowers/programs/landing-order.md`, Decisions, "2026-10-20 13:00 — Task 7's proof run, stopped by stop rule 3".
- The runbook this wave amends: Task 7 of `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`.

**Prerequisite:** none beyond current `main`. This wave's workspace is a fresh child from `main`.

## Global Constraints

- **Public repository.** No private host, path, account, project, person, tracker or live fleet count goes in code, tests, docs, commits or the PR. Fixtures use neutral names (`demo`, `project-a`, `lane-a`).
- **`ccd/ccd` is generated.** After editing it, run `bash ccd/ccrc restamp ccd/ccd`. Then `node shared/mark.mjs --check ccd/ccd` must answer `ccrc-unmodified`.
- **Task 1's `ccd/ccd` edit is line-neutral.** The block from `def is_ours(` through the last line of `annotate` keeps its exact line count. The compaction-card citation census in `server/test/session-hook.test.ts` (`'ccd/ccd': 147`) cites lines far below this block, so any net line moves it.
- **No GitHub-sourced string in an argv** (spec §7). The batched read passes oids on stdin, and only oids that pass the shape check in full.
- **Fixture HOMEs only.** Never run `ccd` against the live `$HOME`. Use `makePrHarness`, `makeCcdHarness` and `plantGitRecorder`.
- **Single definition.** A new `PrReason` is added to `PR_REASON_MAP` in `shared/api.ts` and to `REASON_TEXT` in `pwa/src/session/PrKeycap.tsx`, and nowhere else. `server/test/single-definition.test.ts`'s count moves from 12 to 13.
- **Server log lines** are `console.warn('ccrc-server: …')`; `req.log` is a no-op.
- **The wire is additive.** `FLEET_PROTO` does not change.
- **Run suites in the foreground**, with a timeout of at least 600000 ms, package-local: `./node_modules/.bin/vitest run test/<file>`.
- **Each new guard ships with a red.** Its wave-done names the mutation and the red count.
- **Deviation numbers are issued by the coordinator at run-open.** A departure is named in the wave-done mail; a worker never calls the allocator.
- **Branch discipline.** Commit on the workspace's own branch. Never use a feature branch, `update-branch`, a rebase or a force push.

## Review Focus

1. **An oid with a trailing newline**, such as `"abc1234\n"`.
   - Today `OID.match` accepts it, because `$` matches before a final newline. `cat-file -e` then refuses it, so `ours` is false.
   - On stdin the newline would split one line into two and shift every later answer of the batch.
   - The batched read must reject the oid before writing stdin. That row reads `ours: false`, and every other row keeps its own answer. (Task 1, Step 1 (d).)
2. **The split runs every tick-diet row exactly once per locale.** No row is dropped and none runs twice, so the union of the two files' test names equals the old file's. (Task 4, Step 4.) (For Task 1, the same oid in two rows and an existing oid beside a missing one are pinned by Step 1 (c).)
3. **`pick` mode's empty tip.**
   - `pick` mode takes its tip raw, with no `or None`. So an empty tip, if one ever came, reaches `merge-base … ""`, which exits 128, and the row answers false. `_ws_reap_eval` returns before calling `pick` without a tip today (its C0), so the case pins `pick` called directly.
   - The batched form must answer false as well, through a failed `rev-list ""`. It must never answer true through the `tip is None` arm. (Task 1, Step 1 (e).)
4. **Two failed sweeps with the same reason log once.** A sweep that recovers logs that it recovered. A later failure logs again. There is no line every 30 s and no silence after a recovery. (Task 2, Step 1 (d).)
5. **A close while the caps write is in flight waits for it.** A failed write still lets close finish, because `serverCapsNow` never rejects. (Task 3, Step 1.)

## File Structure

| File | Task | Change |
|---|---|---|
| `ccd/ccd` | 1 | `_pr_py`: `is_ours` becomes `ours_of`, one batched read per call; `annotate` calls it once (≈5702–5741 at `b2c17f859`) |
| `server/test/ccd-pr-state.test.ts` | 1 | the batched read's cases and its git-count pin |
| `shared/api.ts` | 2 | `PrReason` gains `cut-short` |
| `server/src/prstate.ts` | 2 | `sweepFailureReason` (pure) |
| `server/src/watch.ts` | 2 | `sweepPr` names the failure; `backoffPr` logs on a change; the success arm logs a recovery |
| `pwa/src/session/PrKeycap.tsx` | 2 | `REASON_TEXT['cut-short']` |
| `server/test/pr-sweep.test.ts`, `server/test/prstate.test.ts`, `server/test/single-definition.test.ts` | 2 | tests; the count moves 12 → 13 |
| `server/src/server.ts` | 2, 3 | the PR route's failure fold; the `onClose` hook awaits the caps write |
| `server/test/server-caps.test.ts`, `server/test/fleetws.test.ts`, six stub-watcher tests | 3 | the close-waits case; the teardown; `serverCapsSettled` on each stub |
| `server/test/ccd-tick-diet-equivalence.test.ts`, new `server/test/ccdTickDietRunner.ts`, new `server/test/ccd-tick-diet-equivalence-utf8.test.ts` | 4 | the split |
| `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` | 5 | Task 7's runbook |

## Task order

Tasks 2, 3, 4 and 5 never touch `ccd/ccd`, and Task 1 touches nothing else they touch. If another session holds the claim on `ccd/ccd` when the wave starts, do Tasks 2–5 first and Task 1 once that claim is yours: a 409 names the holder, who is the one to ask. Never edit `ccd/ccd` while another session holds it. Task 6 Step 2 needs Task 1.

## Pre-flight findings (measured while planning; not deviations)

1. **The project read costs ~60 s here, and the server allows 25 s.**
   - Timed on the fleet box under heavy load: `ccd pr-state --project` took 56.6 s, and earlier 62.1 s and 59.5 s.
   - An `strace -f -e trace=execve` of one call shows each workspace's python `state` process running 100 `git cat-file -e` and 99 `git merge-base --is-ancestor`: one pair per row of the single `gh pr list --state all --limit 100`. Python's PATH search adds four failed `execve` per call.
   - The `gh` calls take about 4.4 s together.
   - The server's bound is `'pr-state': 25_000` (`server/src/remote/runner.ts:37`). `pr-timeout-budget.test.ts` reserves 30% of it for "a dozen-odd git spawns plus one python start per workspace", far fewer than the ~200 measured.
2. **Most of that work cannot change any answer.**
   - The server binds a row only when `headRefName === branch && ours === true`: `boundRow` and `isMergedRow`, `server/src/prstate.ts:135-151`.
   - `childSpent` also reads other rows, but only from `--session` lines (`server/src/coord/childSpent.ts:269`), whose rows `gh --head` has already filtered to the branch.
   - This wave still keeps every row's `ours` as it is today, so the wire does not change. Reading fewer rows is a later choice, if it is ever wanted.
3. **The batched form costs ~36 ms per workspace.**
   - Measured on this repository (2,593 commits on `main`): one `cat-file --batch-check` of 100 `<oid>^{commit}` lines takes 18 ms, and one `rev-list origin/main` takes 18 ms.
   - The batch prints one line per input line, either `<40-hex> commit` or `<input> missing`. A blob prints `missing`, with an error on stderr. An annotated tag peels to its commit. `rev-list ""` exits 128.
   - Ancestry is exactly membership: `merge-base --is-ancestor A T` is true iff A is in `rev-list T`.
4. **The sweep hides a timeout.**
   - `sweepPr` reads only `!res.ok` and backs off with the fixed reason `'agent-down'`, logging nothing (`server/src/watch.ts:8155-8156`).
   - The runner result already tells a deadline apart:
     - `killed: true` comes from the agent's own kill;
     - `ran: false` with `reason: 'timeout'` comes from the server's 30 s client wait;
     - `reason: 'transport'` means the link dropped.
   - See `server/src/lifecycle.ts:19-54` (`ccdEnding`) and `server/src/remote/runner.ts:213-252`.
5. **The `fleetws.test.ts` flake.**
   - One case's only tick fires `void this.serverCapsNow()` (`server/src/watch.ts:2443-2445`), four `fs/promises` hops under `<home>/.ccrc`.
   - The `onClose` hook only stops the timer (`server/src/server.ts:3908`), and `stop()` is synchronous (`watch.ts:1679-1685`). The test's `afterEach` then runs `rmSync(home)` while a hop is still landing, and `rmdir` fails with `ENOTEMPTY`.
   - `serverCapsSettled()` already exists (`watch.ts:1710-1712`).
6. **The tick-diet file is near its shard's 30-minute bound everywhere.**
   - On 2026-10-20 the shard that ran `ccd-tick-diet-equivalence.test.ts` alone took a median of 20.9 min, p90 26.7 and max 29.8 over 171 successful runs.
   - Two runs hit the 30-minute cut: one queue run and one pull-request run.
   - Almost all of the time is the `beforeAll` batches of E5, E7, E8 and E9, once per locale. The two locale halves are independent (each has its own harness HOME) and within ~10% of each other.
   - The shard planner (`.github/ci/shards.mjs`) never splits a file, and gives a long file a shard of its own.
7. **Turning the queue requirement off drops entries silently** (ledger, 2026-10-20 13:00). After the rollback, four PRs read open, not queued and not armed, and each timeline's last queue act was still `AddedToMergeQueueEvent`.
8. **(a1)'s pushes unbind the PR.** Pushes made outside the workspace move the PR's head off the workspace's own tip, so `pr-state` reads `none` for it, and (e) on the same PR can never reach the lane.

---

### Task 1: `pr-state` reads a workspace's rows in two `git` calls, with the same answers

**Model routing:** `opus`, effort `high`. It decides which PR binds a workspace, and that is the archive trigger.

**Files:**
- Modify: `ccd/ccd`, inside `_pr_py`:
  - `def is_ours(` through the end of `def annotate(` (≈5702–5741 at `b2c17f859`, 40 lines);
  - the comment above them that names `is_ours` (≈5667);
  - the two comments that say a killed read reads as `agent-down` (≈5380 and ≈5616): after Task 2 it reads `cut-short`.
  - Every edit is in place and line-neutral.
- Test: `server/test/ccd-pr-state.test.ts` (a new describe after `describe('binding')`; also its comment at ≈269 about a killed read).

**Interfaces:**
- Consumes: nothing new.
- Produces: `ours_of(main, tip, oids) -> list[bool]` and `one_ours(main, tip, oid) -> bool` inside `_pr_py`. `one_ours` is the old one-row proof, kept for a batch that did not answer cleanly. `annotate(rows, main, tip, branch, base_short)` keeps its signature and output: every dict row gains `ours`, and non-dict rows are dropped. `pick` mode's call (≈6364) is unchanged.

**What "the same answers" covers.** A review harness compared old and new over 684 (tip × oid) pairs. It used commits, an unreachable commit, annotated tags to a commit, tree, blob and tag, a tree, a blob, a commit/commit collision and a commit/blob collision on a 7-hex prefix. The tips were None, `''`, a full sha, an unresolvable name, a branch, a tag, a tree, a blob and `^HEAD`. With the code below, every pair agrees.

Two shapes needed the code below and not the first draft:
- **An abbreviation that is ambiguous between a commit and another object.** `cat-file -e X^{commit}` passes, because the hint picks the commit. But `merge-base --is-ancestor -- X tip` resolves the bare `X`, finds it ambiguous and exits 128. So the batch also sends each bare name, and a bare `ambiguous` answers False wherever the old code would have reached `merge-base`.
- **A batch that does not answer cleanly** (a non-zero exit, or misaligned lines). It falls back to the old row-by-row proof. So one broken object still costs only its own row, never a bound MERGED row's persisted number.

A 7-hex collision costs about 2^28 hashes to build, so the suite carries no case for it. The review harness is that evidence.

- [ ] **Step 1: Write the failing tests**

Add after `describe('binding')`'s closing `});` in `server/test/ccd-pr-state.test.ts`. Also add `import { plantGitRecorder, type RecordedGitCall } from './ccdDocsHelpers.js';` at the top.

```ts
describe('binding, batched (landing-order wave 3c)', () => {
  /** A recorded call's subcommand and its arguments: what follows `-C <dir>`. */
  const sub = (c: RecordedGitCall): string[] => c.argv.slice(c.argv.indexOf('-C') + 2);
  /** Exactly the binding proof's shapes, old and new. `pr-state`'s own bash runs `rev-list --count … --` for `ahead`,
   *  and no `cat-file -e` or `merge-base` (measured at review), so none of its calls match. */
  const annotateCalls = (calls: RecordedGitCall[]): string[] =>
    calls.map(sub).filter((a) =>
      (a[0] === 'cat-file' && (a[1] === '-e' || a[1]?.startsWith('--batch-check') === true))
      || (a[0] === 'merge-base' && a[1] === '--is-ancestor')
      || (a[0] === 'rev-list' && a[1] === '--end-of-options'))
      .map((a) => a.slice(0, 2).join(' '));

  it('(a) reads every row of a session with one batch and one ancestry list', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    const rows = Array.from({ length: 20 }, (_, i) => mergedRow({ number: 100 + i, headRefName: `ws/other-${i}`, headRefOid: tip }));
    rows.push(mergedRow({ headRefOid: tip }));
    h.ghRows(rows);
    const rec = plantGitRecorder(h.home);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.rows.every((r: { ours: boolean }) => r.ours === true)).toBe(true);
    expect(annotateCalls(rec.calls())).toEqual(['cat-file --batch-check=%(objectname) %(objecttype)', 'rev-list --end-of-options']);
  });

  it('(b) a --project read makes two annotate calls per workspace, whatever the row count', () => {
    // A REAL commit, so the batch finds it and the ancestry list runs for both workspaces (the worktrees share one
    // object store); a missing oid would skip `rev-list` and prove less. The second workspace is added with `ws-add`
    // alone, as the existing --project tests do: a second `workspaceWithCommit` would re-create the repo and die.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.ghRows(Array.from({ length: 30 }, (_, i) => mergedRow({ number: 200 + i, headRefOid: tip })));
    const rec = plantGitRecorder(h.home);
    h.sh(`${GH_STUB} cmd_pr_state --project demo`);
    const got = annotateCalls(rec.calls());
    expect(got.filter((c) => c.startsWith('cat-file --batch-check'))).toHaveLength(2);
    expect(got.filter((c) => c.startsWith('rev-list'))).toHaveLength(2);
    expect(got.filter((c) => c === 'cat-file -e' || c.startsWith('merge-base'))).toEqual([]);
  });

  it('(c) dedupes an oid that two rows name, and still answers each row', () => {
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(main, 'checkout', '-q', '-b', 'someone-else');
    fs.writeFileSync(path.join(main, 'other.txt'), 'theirs\n');
    h.git(main, 'add', 'other.txt');
    h.git(main, 'commit', '-m', 'someone else');
    const stranger = h.git(main, 'rev-parse', 'HEAD');
    h.ghRows([
      mergedRow({ number: 1, headRefOid: tip }), mergedRow({ number: 2, headRefOid: stranger }),
      mergedRow({ number: 3, headRefOid: tip }), mergedRow({ number: 4, headRefOid: '0'.repeat(40) }),
      mergedRow({ number: 5, headRefOid: tip.slice(0, 7) }),
    ]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows.map((r: { ours: boolean }) => r.ours)).toEqual([true, false, true, false, true]);
  });

  it('(d) a trailing-newline oid is refused before the batch, and shifts no other answer', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      mergedRow({ number: 1, headRefOid: `${tip.slice(0, 7)}\n` }),
      mergedRow({ number: 2, headRefOid: tip }),
      mergedRow({ number: 3, headRefOid: '0'.repeat(40) }),
    ]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows.map((r: { ours: boolean }) => r.ours)).toEqual([false, true, false]);
  });

  it('(e) pick mode with an empty tip answers false for an existing commit, as merge-base "" did', () => {
    // `_ws_reap_eval` never passes an empty tip (its C0 returns first); this pins `pick` called directly.
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    fs.writeFileSync(path.join(h.home, 'pick-rows.json'), JSON.stringify([mergedRow({ headRefOid: tip })]));
    const out = h.sh(`_pr_py pick '${main}' ws/quiet-basin main '' < "$HOME/pick-rows.json"`);
    expect(out.trim()).toBe('!pr-head-not-ours');
  });

  it('(f) a batch that fails answers row by row, exactly as before', () => {
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(main, 'checkout', '-q', '-b', 'someone-else');
    fs.writeFileSync(path.join(main, 'other.txt'), 'theirs\n');
    h.git(main, 'add', 'other.txt');
    h.git(main, 'commit', '-m', 'someone else');
    const stranger = h.git(main, 'rev-parse', 'HEAD');
    h.ghRows([mergedRow({ number: 1, headRefOid: tip }), mergedRow({ number: 2, headRefOid: stranger }),
      mergedRow({ number: 3, headRefOid: '0'.repeat(40) })]);
    const rec = plantGitRecorder(h.home, { failWhen: ['--batch-check'] });
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows.map((r: { ours: boolean }) => r.ours)).toEqual([true, false, false]);
    expect(annotateCalls(rec.calls()).filter((c) => c === 'cat-file -e')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts -t 'binding, batched'`

Expected on `main`'s `ccd/ccd`:
- (a) and (b) fail: the recorder sees `cat-file -e` and `merge-base` per row (measured at review: 21 pairs for (a)).
- (c), (d), (e) and (f) pass. They pin today's answers, which the change must keep. (f) passes on `main` because nothing there runs `--batch-check`.

Record the counts.

- [ ] **Step 3: Replace `is_ours` and `annotate`, line for line**

In `ccd/ccd`, replace the block from `def is_ours(main, tip, oid):` through the line `    return out` that ends `annotate` with the code below.

The block must keep its exact line count (40 at `b2c17f859`), and the docstrings absorb the difference. If the code is shorter, carry more of the old docstring's argument: the 128-versus-1 rung, deviation 7's `tip is None` paragraph, and the recycled slug and the fork. If it is longer, say that argument in fewer lines. Never pad and never touch another region. Measure the count before and after with `awk`.

```python
def ours_of(main, tip, oids):
    """Proof 0, for every row at once — the PR's head commit exists locally AND, where we have a tip to reach
    from, is reachable from it: what a recycled slug and a stranger's fork both fail. The SAME answers the
    one-row proof gives (cat-file -e, then merge-base --is-ancestor), from ONE `cat-file --batch-check` and at
    most ONE `rev-list`, where the one-row loop cost a --project sweep ~200 spawns per workspace (landing-order
    wave 3c). Oids go on STDIN, never an argv (spec §7), and only after `fullmatch`: `OID.match` lets a trailing
    newline through, and on stdin that would shift every later answer. Each candidate is asked twice, peeled
    (`X^{commit}`, as cat-file -e asked) and bare (as merge-base resolves it), so a name that is ambiguous bare
    answers False wherever merge-base would have refused it. Reachability is membership in `rev-list <tip>`;
    `tip is None` (the registry's branch did not resolve) skips that rung, as before, and a tip rev-list cannot
    read answers False, as merge-base with it did. A batch that does not answer cleanly falls back to `one_ours`
    row by row, so one broken object never costs more than its own row."""
    cands = sorted({o for o in oids if isinstance(o, str) and OID.fullmatch(o)})
    full, amb = {}, set()
    if cands:
        r = subprocess.run(['git', '-C', main, 'cat-file', '--batch-check=%(objectname) %(objecttype)'],
                           input=''.join(o + '^{commit}\n' + o + '\n' for o in cands), capture_output=True, text=True)
        got = r.stdout.split('\n')
        if r.returncode != 0 or len(got) != 2 * len(cands) + 1 or got[-1] != '':
            return [one_ours(main, tip, o) for o in oids]
        for k, o in enumerate(cands):
            f = got[2 * k].split(' ')
            if len(f) == 2 and f[1] == 'commit' and re.fullmatch(r'[0-9a-f]{40}', f[0]):
                full[o] = f[0]
            if got[2 * k + 1] == o + ' ambiguous':
                amb.add(o)
    reach = None
    if tip is not None and full:
        r = git(main, 'rev-list', '--end-of-options', tip, '--')
        reach = set(r.stdout.split()) if r.returncode == 0 else set()
    return [isinstance(o, str) and o in full and (reach is None or (full[o] in reach and o not in amb)) for o in oids]

def one_ours(main, tip, oid):
    """The one-row proof, kept for a batch that did not answer cleanly (its answers define ours_of's)."""
    if not isinstance(oid, str) or not OID.match(oid) or git(main, 'cat-file', '-e', oid + '^{commit}').returncode != 0:
        return False
    return tip is None or git(main, 'merge-base', '--is-ancestor', '--', oid, tip).returncode == 0

def annotate(rows, main, tip, branch, base_short):
    out = [r for r in rows if isinstance(r, dict)]
    for r, ours in zip(out, ours_of(main, tip, [r.get('headRefOid') for r in out])):
        r['ours'] = ours
    return out
```

Notes on what is preserved:
- `annotate(None, …)` still raises `TypeError`, as the old loop did.
- An empty candidate set runs no git at all.
- With `tip is None` there is no `rev-list`.
- `git()` is the existing helper, and `re` is already imported.

Then the comments:
- **≈5667.** Reword it in place, at the same line count, to say that `headRefOid` is GitHub-sourced and that `ours_of` gives it to git on stdin, after the shape check. Renaming alone would leave it claiming an argv.
- **≈5380, ≈5616 and the test's ≈269.** They say a killed read reads as `agent-down`; it now reads `cut-short` (Task 2).
- **Stale `is_ours` mentions in test comments.** These are in `ccd-pr-state.test.ts` (≈705, ≈1436), `ccd-bounded-reads`, `ccd-prhistory`, `prstate.test.ts` and `update-branch-absent`. Update each that describes the function, comment-only, and list them in the wave-done.

- [ ] **Step 4: Restamp and run the tests**

```bash
bash ccd/ccrc restamp ccd/ccd && node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts
./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts test/ccd-lifecycle-pairs.test.ts test/ccd-prhistory.test.ts test/ccd-pr-queue.test.ts test/ccd-bounded-reads.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the compaction card'
./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/ownership.test.ts test/mark-check.test.ts test/citations.test.ts
```

Expected:
- `mark --check` answers `ccrc-unmodified`.
- Every case passes, the new ones included.
- The census's `'ccd/ccd': 147` is unchanged. Measured at review: a 34-line block reds three census cases, and a 40-line block is green.
- `ccd-pr-state`'s "names the SESSION…" case runs no git here and is load-sensitive (35 s at load 45). If it reds, re-run it alone.

- [ ] **Step 5: Mutations, then commit**

Record each red, then restore `ccd/ccd` byte for byte (`cmp`):
- **M1:** `OID.fullmatch(o)` becomes `OID.match(o)`. Expected: (d) reds.
- **M2:** `(reach is None or (full[o] in reach and o not in amb))` becomes `True`. Expected: three cases red, `'refuses a PR whose head commit IS here but is not reachable from our tip'`, (c) and (e).
- **M3:** drop the `rev-list` call, so `reach` stays None for every tip. Expected: `'keeps a bound MERGED answer…'` and `'keeps rc 1 and rc 128 apart'` red (`describe` ≈813).
- **M4:** the old per-row loop is restored. Expected: (a) and (b) red.
- **M5:** the fallback `return [one_ours(…) …]` becomes `return [False for o in oids]`. Expected: (f) reds.

```bash
git add ccd/ccd server/test/ccd-pr-state.test.ts
git commit -m "fix(pr-state): read a workspace's PR rows in two git calls, same answers"
```

### Task 2: The PR sweep names a read that was cut short, and logs a failure once

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify:
  - `shared/api.ts` (`PrReason` ≈933, `PR_REASON_MAP` ≈954);
  - `server/src/prstate.ts` (new export after `queueFor`);
  - `server/src/watch.ts` (`sweepPr` ≈8155, `backoffPr` ≈8257, the success arm `this.prBackoff.delete(project)`);
  - `server/src/server.ts` (`GET /api/sessions/:id/pr`'s failure fold, ≈3561-3562);
  - `pwa/src/session/PrKeycap.tsx` (`REASON_TEXT` ≈70);
  - `server/test/single-definition.test.ts` (≈166).
- Test: `server/test/prstate.test.ts`, `server/test/pr-sweep.test.ts` and `server/test/pr-routes.test.ts`.

**Interfaces:**
- Consumes: `CcdResult` (`server/src/coord/ports.ts:20-33`) and `ccdEnding` (`server/src/lifecycle.ts`). Both `prstate.ts` and `lifecycle.ts` classify as L1, so the import is sideways.
- Produces:
  - `sweepFailureReason(res: CcdResult): PrReason`, which answers `'cut-short'` or `'agent-down'`;
  - the new `PrReason` word `'cut-short'`.

**What `cut-short` claims, and no more.** `killed: true` is the agent's own kill. That is usually the deadline, but node also sets it when a child passes `execFile`'s output cap. `ran: false` with `reason: 'timeout'` is this server's wait running out, which a link that died without a close also produces until the heartbeat notices. So the word says the read was cut short, not that it was slow. The log line carries the detail so that a reader can tell which case it was.

- [ ] **Step 1: Write the failing tests**

(a) In `server/test/prstate.test.ts`:

```ts
import { sweepFailureReason } from '../src/prstate.js';
import { UNMEASURED } from '../src/unmeasured.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { PrReason } from '../../shared/api.js';

describe('sweepFailureReason (landing-order wave 3c)', () => {
  const base = { ok: false as const, stdout: '', stderr: '' };
  const rows: [string, CcdResult, PrReason][] = [
    ['the agent killed it', { ...base, killed: true, signal: 'SIGTERM' }, 'cut-short'],
    ["the server's own wait ran out", { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false, reason: 'timeout', detail: 'timeout' }, 'cut-short'],
    ['the link dropped', { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false, reason: 'transport', detail: 'disconnected' }, 'agent-down'],
    ['the agent declined it', { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false, reason: 'spawn', detail: 'x' }, 'agent-down'],
    ['ccd exited non-zero by itself', { ...base, killed: false, signal: null }, 'agent-down'],
    ['an older agent measured nothing', { ...base, killed: UNMEASURED, signal: UNMEASURED }, 'agent-down'],
  ];
  it.each(rows)('%s', (_what, res, want) => {
    expect(sweepFailureReason(res)).toBe(want);
  });
});
```

(b) In `server/test/pr-sweep.test.ts`, inside `describe('backoffPr — …')`, add a case that copies the first case's fixture. Its failing arm returns `{ code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' }`. It asserts that `quiet.reason` is `'cut-short'`.

(c) In the same describe, add a case whose failing arm returns `{ code: 1, stdout: '', stderr: 'timeout', ran: false, reason: 'timeout', detail: 'timeout' }`. It asserts `'cut-short'`.

(d) A logging case on the same fixture. Spy with `const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})` and `const sweeps = () => warn.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('PR sweep of demo'))`. Restore the spy in a `finally`.

Before every forced pass after the first, wait as the first case does: `await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0))`. Then set `lastPrSweep = 0` and clear `prBackoff`, or the single-flight latch and the backoff bounce the pass.

The sequence:
1. Fail.
2. Fail again with the same result.
3. Succeed.
4. Fail.

Expected `sweeps()` after each step:
1. one line matching `/^ccrc-server: PR sweep of demo failed \(cut-short/`;
2. still one line;
3. two, the second `ccrc-server: PR sweep of demo recovered`;
4. three.

(e) In `server/test/pr-routes.test.ts`, beside `'answers unknown/agent-down rather than 502 when ccd fails'` (≈116), add a case whose runner answers `{ code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' }`. It expects `reason: 'cut-short'`.

(f) In `server/test/single-definition.test.ts`, change `expect(PR_REASONS).toHaveLength(12)` to `13`.

- [ ] **Step 2: Run them and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/prstate.test.ts test/pr-sweep.test.ts test/pr-routes.test.ts test/single-definition.test.ts`

Expected:
- (a) fails: `sweepFailureReason is not a function`.
- (b), (c) and (e) read `agent-down`.
- (d) finds no line.
- (f) reads 12.

- [ ] **Step 3: Implement**

`shared/api.ts`: add `| 'cut-short'` to `PrReason`, and `'cut-short': true,` to `PR_REASON_MAP`. Its docstring line reads: `cut-short: ccrc's own read of the PRs was ended before it answered — the runner's kill or the server's wait (not GitHub)`.

`pwa/src/session/PrKeycap.tsx`, in `REASON_TEXT`: `'cut-short': 'ccrc could not finish reading the PRs in time.',`

`server/src/prstate.ts`, after `queueFor`:

```ts
/** How a failed `pr-state` call failed (landing-order wave 3c). The runner's kill (`ccdEnding` `deadline`: the
 *  deadline, or node's output cap) and this server's own wait running out (`ran: false`, `timeout`; also a link
 *  that died without a close, until the heartbeat sees it) are `cut-short`: the read was ended before it answered.
 *  Everything else keeps the old word, `agent-down`, because nothing else here was measured to be anything more. */
export function sweepFailureReason(res: CcdResult): PrReason {
  if (res.ran === false) return res.reason === 'timeout' ? 'cut-short' : 'agent-down';
  return ccdEnding(res).kind === 'deadline' ? 'cut-short' : 'agent-down';
}
```

Import `ccdEnding` from `./lifecycle.js` and `type CcdResult` from `./coord/ports.js`, unless `prstate.ts` already imports them.

`server/src/server.ts`, in `GET /api/sessions/:id/pr`: the failure fold that answers `unknownView('agent-down')` for a failed `pr-state --session` answers `unknownView(sweepFailureReason(res))` instead. `res` is the route's own `CcdResult`.

`server/src/watch.ts`:
- In `sweepPr`, `if (!res.ok) { this.backoffPr(project, now, 'agent-down', records); continue; }` becomes `if (!res.ok) { this.backoffPr(project, now, sweepFailureReason(res), records, failureDetail(res)); continue; }`. Here `failureDetail` is a small local function in `watch.ts`: `res.ran === false ? res.detail : res.stderr.split('\n')[0]`, cut to 160 characters.
- `backoffPr` gains an optional last parameter `detail = ''`. The id-less failure arm passes nothing. At the end of `backoffPr`, after the loop:

```ts
    // Said once per change (landing-order wave 3c): a blind lane used to be invisible, every pass backing off as
    // `agent-down` with nothing in the journal. The latch is the reason, so a new reason speaks and a repeat does not.
    if (this.prSweepFailure.get(project) !== reason) {
      console.warn(`ccrc-server: PR sweep of ${project} failed (${reason}${detail ? `: ${detail}` : ''}); retrying in ${Math.round(step / 1000)}s`);
      this.prSweepFailure.set(project, reason);
    }
```

- Beside `prBackoff`'s declaration: `private readonly prSweepFailure = new Map<string, PrState['reason']>();`.
- Directly after `this.prBackoff.delete(project);` in the success arm:

```ts
        if (this.prSweepFailure.delete(project)) console.warn(`ccrc-server: PR sweep of ${project} recovered`);
```

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/prstate.test.ts test/pr-sweep.test.ts test/pr-routes.test.ts test/single-definition.test.ts test/pr-queue-lane.test.ts test/remote-runner.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd ../pwa && ./node_modules/.bin/vitest run test/pr-keycap.test.tsx
cd ../server && npm run build && cd ../pwa && npm run build
```

Expected: all pass, and both builds exit 0. `single-definition`'s "literal source pins" case is known to time out at 20 s on a loaded box with no source change; re-run it alone before calling it a break. `typecheck-tests` is a known load flake (`CLAUDE.md`).

- [ ] **Step 5: Mutations, then commit**

Record each red, then restore:
- **M6:** `sweepFailureReason(res)` becomes `'agent-down'` in `sweepPr`. Expected: (b), (c) and (d) red. (d) reds through its step-1 pattern.
- **M7:** the latch test `!== reason` becomes `true`. Expected: (d) reds at its second step.
- **M8:** delete the recovery line. Expected: (d) reds at step 3.
- **M9:** the route's fold goes back to `'agent-down'`. Expected: (e) reds.

```bash
git add shared/api.ts server/src/prstate.ts server/src/watch.ts server/src/server.ts pwa/src/session/PrKeycap.tsx server/test/prstate.test.ts server/test/pr-sweep.test.ts server/test/pr-routes.test.ts server/test/single-definition.test.ts
git commit -m "fix(pr-sweep): name a read that was cut short, and log a failed sweep once per change"
```

### Task 3: The server's close waits for the server-caps write a tick started

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `server/src/server.ts` (the `onClose` hook, ≈3908).
- Modify six tests whose stub watcher (`{ …, stop: () => {} } as unknown as FleetWatcher`) gains `serverCapsSettled: async () => {}`:
  - `server/test/dispatch-live-gate.test.ts`;
  - `server/test/interrupt-route.test.ts`;
  - `server/test/lifecycle.test.ts`;
  - `server/test/projects-route-placement.test.ts`;
  - `server/test/archive-door.test.ts`;
  - `server/test/auth-gate.test.ts`.
  Measured at review: without the stub method, 49 of their 386 tests red with `TypeError: watcher.serverCapsSettled is not a function`. Find every stub with `git grep -n 'as unknown as FleetWatcher' server/test`, and give each one the method.
- Modify: `server/test/fleetws.test.ts`'s `afterEach` (≈92-97).
- Test: `server/test/server-caps.test.ts`.

**Interfaces:**
- Consumes: `FleetWatcher.serverCapsSettled(): Promise<void>` (`watch.ts:1710`).
- Produces: nothing new.

**What this fixes, and what it does not.** The measured failure (run 39423071534, "reports unmeasurable for BOTH markers…") is a case that builds a server, and the close fix covers it. About sixteen other `fleetws` cases tick a bare `new FleetWatcher` with no server, so no `onClose` ever runs for them. Their first tick starts the same write, and the same `afterEach` removes the home. The teardown change covers those. Both changes are needed.

- [ ] **Step 1: Write the failing test**

In `server/test/server-caps.test.ts`, add a case that holds the write open:

```ts
it('closing the server waits for a server-caps write a tick started (landing-order wave 3c)', async () => {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const spy = vi.spyOn(FleetWatcher.prototype, 'serverCapsNow').mockImplementation(function (this: FleetWatcher) {
    const run = held.then(() => null);
    (this as unknown as { serverCapsRun: Promise<unknown> | null }).serverCapsRun = run;
    void run.finally(() => { (this as unknown as { serverCapsRun: Promise<unknown> | null }).serverCapsRun = null; });
    return run;
  });
  try {
    const deps = testDeps(home);
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    const app = await buildServer(deps, bus, watcher);   // fleetws.test.ts's `connect` does the same
    await watcher.tick();
    const closing = app.close().then(() => 'closed' as const);
    const first = await Promise.race([closing, new Promise((r) => setTimeout(() => r('held'), 2000))]);
    expect(first, 'close must not finish while the caps write is in flight').toBe('held');
    release();
    expect(await closing).toBe('closed');
  } finally {
    release?.();
    spy.mockRestore();
  }
});
```

Imports this case adds, unless the file already has them: `buildServer` from `../src/server.js`, and `seedRoster` from `./helpers.js`. The mock stands in for the write and sets the watcher's private `serverCapsRun` exactly as the real `serverCapsNow` does (`watch.ts:1692-1708`). So `serverCapsSettled()` sees a write in flight, and the real writer is never asked to write under the fixture. The 2 s race makes the red independent of how fast `close` is on a loaded box.

- [ ] **Step 2: Run it and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/server-caps.test.ts -t 'closing the server waits'`

Expected: FAIL, because `first` is `'closed'`.

- [ ] **Step 3: Implement**

In `server/src/server.ts`, change

```ts
  if (watcher) app.addHook('onClose', async () => { watcher.stop(); });
```

to

```ts
  // Stop the beat, then let a server-caps write a tick already started land (landing-order wave 3c): it writes under
  // `<ccrcDir>`, and a caller that removes that directory after close (a test's teardown) raced it (`ENOTEMPTY`).
  // `serverCapsNow` never rejects, so this never fails a close.
  if (watcher) app.addHook('onClose', async () => { watcher.stop(); await watcher.serverCapsSettled(); });
```

Then add `serverCapsSettled: async () => {}` to each stub watcher listed under Files.

In `fleetws.test.ts`'s `afterEach`, change `rmSync(home, { recursive: true, force: true });` to `rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });`. Above it, add one comment line: the bare-watcher cases' first tick can still be landing a server-caps write here, and `maxRetries` covers `ENOTEMPTY`.

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/server-caps.test.ts test/fleetws.test.ts test/dispatch-live-gate.test.ts test/interrupt-route.test.ts test/lifecycle.test.ts test/projects-route-placement.test.ts test/archive-door.test.ts test/auth-gate.test.ts
./node_modules/.bin/vitest run test/boot.test.ts
```

Expected: all pass. `boot.test.ts`'s hung-ccd case is known red on a loaded box (wall-clock). If it reds, run it alone on `main`'s tree too, and record both results.

- [ ] **Step 5: Mutation, then commit**

- **M10:** drop `await watcher.serverCapsSettled();`. Expected: the new case reds. Restore it.

```bash
git add server/src/server.ts server/test/server-caps.test.ts server/test/fleetws.test.ts server/test/dispatch-live-gate.test.ts server/test/interrupt-route.test.ts server/test/lifecycle.test.ts server/test/projects-route-placement.test.ts server/test/archive-door.test.ts server/test/auth-gate.test.ts
git commit -m "fix(server): close waits for an in-flight server-caps write"
```

### Task 4: The tick-diet differential file runs as two files, one per locale

**Model routing:** `sonnet`, effort `high`. The move is mechanical but large, and every row must still run exactly once per locale.

**Files:**
- Create: `server/test/ccdTickDietRunner.ts`. It is not a `.test.ts`. Its name must match `/^ccd.*\.ts$/`, because `ccd-workspaces.test.ts:1448` checks every bash spawn in such files for `ghContainedEnv` and the systemd and tmux poisons. A name outside that pattern would silently drop three spawns from the check: the UTF-8 probe ≈672, `runBatch` ≈578 and `runScript` ≈693.
- Create: `server/test/ccd-tick-diet-equivalence-utf8.test.ts`.
- Modify: `server/test/ccd-tick-diet-equivalence.test.ts`.
- Never edit `server/test/fixtures/tick-diet-legacy.bash`. E0 pins its sha256. Its comment that names the old file stays as it is.

**Interfaces:**
- Produces: `ccdTickDietRunner.ts` exports everything the seven per-locale blocks and the blocks that stay need:
  - the runner and helpers (`PRELUDE`, `BLOBS`, `runBatch`, `UTF8_LOCALE`, `LOCALES`, `NO_UTF8`, `runScript`, and every helper they use);
  - the row builders and constants the per-locale blocks read, spread over ≈1033–2324 at `b2c17f859` (`w1Rows`, `LIM_*`, `e6aRows`, `LF_*`, `w2FieldRows`, `REG_*`, `w3RegRows`, `RT_*`, `w3RouteRows`, `HM_*`, `w3HomeRows`, and whatever else the compiler names);
  - anything the blocks that stay import from it (E8d and E10d use `rawRegGetCalls` and `rawHomeMeasuredCalls`);
  - `registerLocaleRows(loc: (typeof LOCALES)[number]): void`.
- Inside `registerLocaleRows`, each of the seven blocks keeps its `describe.each(...)` form with its title unchanged, called on a one-element array: `describe.each([loc])(<the title, unchanged>, ({ locale }) => …)`. Vitest quotes a string `$name` (`under 'C' (…)`), so this keeps every full test name byte-identical. A template-literal title would drop the quotes, and Step 4's comparison would fail.
- The C file calls `registerLocaleRows(LOCALES[0])` and keeps the locale-free blocks: E0, E1, E2, E8d, E8g, E10d and E4. The UTF-8 file calls `registerLocaleRows(LOCALES[1])` alone.

- [ ] **Step 1: Measure the inventory before moving anything**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence.test.ts --reporter=json --outputFile.json=<scratch>/diet-before.json
```

Run it in the foreground. If the whole file cannot fit one call, run bounded parts by describe (`-t 'E0'`, `-t 'E3'`, …) and record the bound you used. `-t` is a substring match (`-t 'E1'` also matches E10 and E10d), so build the list by full test name and deduplicate it. Keep that list of full test names and their states: it is the oracle for Step 4. Also run `git grep -n 'ccd-tick-diet-equivalence.test.ts:[0-9]'`. It is expected to find none; if it finds any, they move with their lines, and the wave-done lists them.

- [ ] **Step 2: Move, without changing a test body**

- Move the runner, the helpers, the row builders and the constants into `ccdTickDietRunner.ts`.
- Move the seven per-locale `describe.each(LOCALES)(…)` blocks into `registerLocaleRows`, each as `describe.each([loc])(<same title>, …)`.
- The UTF-8 skip-or-red behaviour (`NO_UTF8`: skipped on Darwin, red on Linux) moves with them unchanged.
- Leave the header comment in the C file. Correct its "(E5 sits above E4 in the file.)" sentences to say where each part now lives.
- The UTF-8 file's header says, in two sentences, why the split exists: one shard carried both halves at a 20.9-minute median against a 30-minute bound, and the planner never splits a file.

- [ ] **Step 3: Check the move is a move**

- `git diff --stat` shows the test bodies moved, not rewritten.
- `git diff -M --color-moved=zebra` on the moved hunks shows only indentation and the `describe.each` argument changing.

- [ ] **Step 4: Run both files, and compare inventories**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence.test.ts --reporter=json --outputFile.json=<scratch>/diet-c.json
./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence-utf8.test.ts --reporter=json --outputFile.json=<scratch>/diet-utf8.json
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/raw-spawn-census.test.ts test/typecheck-tests.test.ts
```

Expected:
- The union of the two files' full test names equals Step 1's list exactly, with the same names in the same states.
- No name is in both files.
- The spawn and census checks pass, and the runner's three spawns are inside `ccd-workspaces`' check.

Put the comparison script and its output in the wave-done.

- [ ] **Step 5: CI selection, read rather than run**

`.github/ci/select-tests.mjs` (≈237-241, rule 1) selects any test file its map does not know. So the UTF-8 file is selected on every PR until a merge to `main` re-traces it. Confirm by reading that rule at the branch's tip, and quote it in the wave-done.

Until the next trusted `testtimes` artifact, `shards.mjs` gives the new file the median duration and packs it into an ordinary shard. That shard then runs ~8–15 minutes of work against a 30-minute bound, which is unbalanced but safe. Run `server/test/ci-shards.test.ts` and `server/test/ci-pipeline.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add server/test/ccdTickDietRunner.ts server/test/ccd-tick-diet-equivalence.test.ts server/test/ccd-tick-diet-equivalence-utf8.test.ts
git commit -m "test(tick-diet): run the differential file as two files, one per locale"
```

### Task 5: Task 7's runbook carries the re-run's changes (text only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, Task 7 Steps 1, 4, 5 and 6.

The runbook's own shape stays: five trivial PRs, where A, B and C land, the fourth carries (a0) and (e), and the fifth carries (a1). The 2026-10-20 collision of (a1) and (e) on one PR came from the 2026-10-07 departure (the ledger's three-dispatch shape), not from this text. So this task moves (e) earlier and adds rules. It does not rewrite Step 5.

- [ ] **Step 1: The sweep is measured before arming (Step 1's preconditions)**

Append to the end of Task 7 Step 1 (the preconditions step), as its last paragraph:

```markdown
**The project's PR sweep finishes within its bound (landing-order wave 3c).** The 2026-10-20 run found the landing lane blind: the project's `pr-state` read took longer than the server's `pr-state` bound (`server/src/remote/runner.ts`), so most likely every sweep timed out, silently, and no `queue` event or landing mail could appear. Before Step 4's write, on both boxes' current build:
- on the fleet box, time `ccd pr-state --project <project>` three times — the same call the server's sweep makes every two minutes (it writes the same registry fields the sweep writes, so it is not a read-only probe, and it is no new act either) — and the SLOWEST must finish in under half of that bound;
- on the server box, since the server's last start (`systemctl --user show ccrc -p ActiveEnterTimestamp`), `journalctl --user -u ccrc --since "<that time>" | grep 'PR sweep of <project>'` shows no `failed` line after the last `recovered` line;
- `~/.local/bin/ccrc-api feed list --limit 50` holds a `merged` event for a PR merged on this project since that build was applied: the sweep completed and the merged lane spoke.
Any one missing stops the runbook here, before any write. A removal cannot be announced before the queue is on; (e) is the first reading inside the window for that reason (Step 5).
```

- [ ] **Step 2: The rollback empties the queue first (Step 4)**

In Step 4, replace the last sentence of its last paragraph,

```markdown
Keep `ruleset-rollback.json`: `gh api -X PUT "repos/{owner}/{repo}/rulesets/$RS" --input ruleset-rollback.json` is the rollback, and restores the ruleset exactly as it was, maintain bypass included.
```

with

````markdown
Keep `ruleset-rollback.json`: it restores the ruleset exactly as it was, maintain bypass included. **THE ROLLBACK empties the queue before it writes** (landing-order wave 3c): switching the requirement off with entries in it drops them silently. On 2026-10-20 four PRs read open, not queued and not armed, with no removal event; each timeline's last queue act stayed `Added`, so no lane could announce it. Every rollback, a stop rule's or an unplanned one, is this block:

```bash
q='query($o:String!,$n:String!){repository(owner:$o,name:$n){mergeQueue(branch:"main"){entries(first:50){nodes{state pullRequest{id number}}}}}}'
dq='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{state}}}'
seen=""
for pass in 1 2 3 4 5 6 7 8 9 10; do
  rows=$(gh api graphql -F o='{owner}' -F n='{repo}' -f query="$q" --jq '.data.repository.mergeQueue.entries.nodes[] | [.state, .pullRequest.id, .pullRequest.number] | @tsv')
  [ -z "$rows" ] && break
  while IFS=$'\t' read -r st id num; do
    seen="$seen $num"
    [ "$st" = LOCKED ] && continue        # already merging: let it land, and read again
    gh api graphql -F id="$id" -f query="$dq" >/dev/null || gh api graphql -F id="$id" -f query="$dq" >/dev/null \
      || echo "DEQUEUE FAILED #$num"
  done <<<"$rows"
  sleep 10
done
gh api -X PUT "repos/{owner}/{repo}/rulesets/$RS" --input ruleset-rollback.json --jq '{id, rules: [.rules[].type]}'
echo "seen:$seen"
```

Expected: the loop ends on an empty read, then the ruleset reads `rules: ["pull_request"]`. Re-read every PR in `seen` with (a2)'s timeline read: each one that did not merge ends in a `RemovedFromMergeQueueEvent`. Two cases are written anyway, and the PR is recorded as silently dropped, with a comment on it:
- a `DEQUEUE FAILED` line;
- an entry still listed after the tenth pass (a `LOCKED` one that never cleared, or entries that kept arriving).
Comment on each removed PR that is not the proof's: say that the queue went off and the PR must be landed again by the pre-queue path.
````

In Step 6, stop rule 3's sentence `Roll back: re-apply `ruleset-rollback.json` (queue off, approvals 1, maintain bypass back).` becomes `Roll back with Step 4's rollback block (the queue emptied first, then queue off, approvals 1, maintain bypass back).` Stop rule 5's `roll back as in 3` is unchanged.

- [ ] **Step 3: (e) first inside the window, on the fourth PR (Step 5)**

Move the (e) paragraph, with its code block and its Expected, from after (d) to directly after (a0)'s Expected. Then:
- Replace its first sentence, `(e) **The dequeue lane** — enqueue a fourth trivial PR and remove it from the queue in GitHub's UI ("Remove from queue") before it lands; within one sweep (≤ 120 s):`, with `(e) **The dequeue lane, FIRST inside the window** — on the fourth PR, right after (a0) and before (a1) or any landing (landing-order wave 3c: a lane that cannot announce a removal must be found before the landings wait on it): once its required checks are green, enqueue it with the landing spelling, read the entry back with (a0)'s read, then remove it — GitHub's UI ("Remove from queue"), or `gh api graphql -F id=<its node id> -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{state}}}'`; within one sweep (≤ 120 s):`
- In its Expected, delete the clause `and still NO `queue` event names any of the three PRs that landed in (a)–(b) — one that does is a spurious dequeue (stop rule 6)`. (a2) already reads the feed for that, after the landings.
- Append to its Expected: `NO such event within 120 s is stop rule 8. (e) never runs on a PR that (a1) has pushed to: a push made outside a PR's workspace moves the PR's head off the workspace's own tip, the PR no longer binds, and its removal cannot reach the lane (2026-10-20).`

- [ ] **Step 4: Stop rule 8, and the bypass merge (Step 6)**

After stop rule 7, add:

```markdown
8. **(e)'s removal was not announced within one sweep** — no `queue` event names the fourth PR's workspace 120 s after its removal, on a PR that still binds (`ccd pr-state --session` reads it `open`). The lane is blind: roll back with Step 4's rollback block before any landing is queued, and do not plan wave 2b.

A merge to `main` through the admin bypass while the queue is on (another programme's landing; wave 2b's deny is not live) makes the queue rebuild its groups on the new base. It is recorded with its time and PR, and is not a stop by itself; a rebuilt group that then fails for a reason not its PR's own is stop rule 3.
```

- [ ] **Step 5: Check and commit**

```bash
f=docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
grep -o 'dequeuePullRequest' "$f" | wc -l          # expected 2: the rollback block's mutation and (e)'s
grep -o "Step 4's rollback block" "$f" | wc -l     # expected 2: stop rules 3 and 8
cd server && ./node_modules/.bin/vitest run test/docs-grammar.test.ts test/deviation-refs.test.ts test/docs-policy.test.ts
git add "$f"
git commit -m "docs(landing-order): Task 7's runbook carries the re-run's changes"
```

Measure both counts and record them as found. If they differ from the comments, say why in the wave-done, rather than editing the text to fit. If a docs test pins Task 7's text, update it in this commit and name it.

### Task 6: The wave's gate, the PR and the wave-done

**Model routing:** `sonnet`, effort `medium`.

- [ ] **Step 1: The whole wave's owning gates, one file at a time, in the foreground**

- Server:
  - `ccd-pr-state`, `ccd-ws-audit`, `ccd-ws-reap`, `ccd-lifecycle-pairs`, `ccd-prhistory`, `ccd-pr-queue`, `ccd-bounded-reads`;
  - `pr-sweep`, `prstate`, `pr-routes`, `pr-queue-lane`, `remote-runner`, `pr-timeout-budget`;
  - `server-caps`, `fleetws`, `boot`, and Task 3's six stub-watcher files;
  - both tick-diet files, `ccd-workspaces`, `raw-spawn-census`;
  - `single-definition`, `typecheck-tests`, `ownership`, `mark-check`, `citations`, `deviation-refs` (after `git fetch origin main`), `docs-grammar`, `docs-policy`;
  - `session-hook -t 'the compaction card'`.
- PWA: `test/pr-keycap.test.tsx`.
- Builds: `server` and `pwa`, `npm run build`.

The known load flakes are in `CLAUDE.md`, plus `single-definition`'s "literal source pins" case at 20 s. Re-run one alone before calling it a break, and name every re-run.

- [ ] **Step 2: Measure the read in a fixture HOME, never the live one**

`pr-state`'s `state` mode WRITES. It writes the persisted number and phase, `.prhistory` and its lock. So the branch's `ccd` never runs against the live registry, not even "read-only".

The measurement:
- In a scratch script that uses `makePrHarness` exactly as `ccd-pr-state.test.ts` does, build 8 workspaces of one project and 100 gh rows whose `headRefOid`s are real commits of that repository.
- Time `cmd_pr_state --project demo` three times on `main`'s `ccd/ccd` (`git show origin/main:ccd/ccd > <scratch>/ccd-main`, sourced the same way) and three times on the branch's.
- Count the binding proof's git calls with `plantGitRecorder` and the Task 1 filter.

Record the six times and the two counts. Expected: the count falls from 8 × ~200 to 8 × 2, and the time falls by most of the difference. This is evidence, not a test: no timing bound is committed.

- [ ] **Step 3: Push, open the PR, and report**

Push the workspace branch and open the PR (`ccd pr-open` or `gh pr create`, as the worker skill says). The body:
- names the four fixes and the pre-flight findings they answer;
- links the ledger's 2026-10-20 13:00 entry by its GitHub blob URL;
- says nothing is armed or re-run by it.

Send the wave-done with the measured fingerprint, the suite line, every mutation's red, Task 4's inventory comparison, Task 5's grep, and Step 2's times.

**Deploy:** ccrc's updater, from the console, fleet node first. Nobody moves a box by hand. After both boxes run the build, the coordinator takes Task 5 Step 1's live reading, and only then plans the re-run.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open. **A worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail: what departed, where, and why. The coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file.
