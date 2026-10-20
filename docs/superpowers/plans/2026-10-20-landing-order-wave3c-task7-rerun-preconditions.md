# Landing order, wave 3c — Task 7's re-run preconditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task 7's re-run able to pass. Four things go wrong today, and each was measured on 2026-10-20: the landing lane cannot see this project, a failed PR sweep is silent, two suite flakes remove PRs from the queue, and the runbook has three gaps. This wave fixes each of them.

**Architecture:**
- **ccd.** `ccd pr-state --project` keeps every answer it gives today. For each workspace it now reads the PR rows' head commits with one batched `git cat-file --batch-check` and one `git rev-list <tip>`, instead of two `git` processes per listed PR.
- **Server.** The PR sweep says which way a read failed, and it logs a failure once, not on every pass. The server's close waits for the server-caps write a tick started.
- **Tests.** The supervisor tick diet's differential file is split by locale, so that no CI shard carries both halves.
- **Runbook.** Task 7's text in the wave-2 plan gains the re-run's three changes.

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
2. **The same oid in two rows**, and an existing oid beside a missing one. The batch dedupes, and every row still gets its own answer. (Task 1, Step 1 (c).)
3. **`pick` mode's empty tip.**
   - `_ws_reap_eval` passes the tip raw, so an empty tip reaches `merge-base … ""`. That exits 128, and the row answers false.
   - The batched form must answer false as well, through a failed `rev-list ""`. It must never answer true through the `tip is None` arm. (Task 1, Step 1 (e).)
4. **Two failed sweeps with the same reason log once.** A sweep that recovers logs that it recovered. A later failure logs again. There is no line every 30 s and no silence after a recovery. (Task 2, Step 1 (d).)
5. **A close while the caps write is in flight waits for it.** A failed write still lets close finish, because `serverCapsNow` never rejects. (Task 3, Step 1.)

## File Structure

| File | Task | Change |
|---|---|---|
| `ccd/ccd` | 1 | `_pr_py`: `is_ours` becomes `ours_of`, one batched read per call; `annotate` calls it once (≈5702–5741 at `b2c17f859`) |
| `server/test/ccd-pr-state.test.ts` | 1 | the batched read's cases and its git-count pin |
| `shared/api.ts` | 2 | `PrReason` gains `overrun` |
| `server/src/prstate.ts` | 2 | `sweepFailureReason` (pure) |
| `server/src/watch.ts` | 2, 3 | `sweepPr` names the failure; `backoffPr` logs on a change; the success arm logs a recovery |
| `pwa/src/session/PrKeycap.tsx` | 2 | `REASON_TEXT.overrun` |
| `server/test/pr-sweep.test.ts`, `server/test/prstate.test.ts`, `server/test/single-definition.test.ts` | 2 | tests; the count moves 12 → 13 |
| `server/src/server.ts` | 3 | the `onClose` hook awaits the caps write |
| `server/test/server-caps.test.ts` | 3 | the close-waits case |
| `server/test/ccd-tick-diet-equivalence.test.ts`, new `server/test/tickDietRunner.ts`, new `server/test/ccd-tick-diet-equivalence-utf8.test.ts` | 4 | the split |
| `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` | 5 | Task 7's runbook |

## Pre-flight findings (measured while planning; not deviations)

1. **The project read costs ~60 s here, and the server allows 25 s.**
   - Timed on the fleet box at load ~18 on 16 cores: `ccd pr-state --project` took 56.6 s, and earlier 62.1 s and 59.5 s.
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
- Modify: `ccd/ccd`, inside `_pr_py`: `def is_ours(` through the end of `def annotate(` (≈5702–5741 at `b2c17f859`).
- Test: `server/test/ccd-pr-state.test.ts` (new describe `'binding, batched'` after `describe('binding')`).

**Interfaces:**
- Consumes: nothing new.
- Produces: `ours_of(main, tip, oids) -> list[bool]` inside `_pr_py`. `annotate(rows, main, tip, branch, base_short)` keeps its signature and output: every dict row gains `ours`, and non-dict rows are dropped. `pick` mode's call (≈6364) is unchanged.

- [ ] **Step 1: Write the failing tests**

Add after `describe('binding')`'s closing `});` in `server/test/ccd-pr-state.test.ts`. Also add the import `import { plantGitRecorder, type RecordedGitCall } from './ccdDocsHelpers.js';` at the top.

```ts
describe('binding, batched (landing-order wave 3c)', () => {
  /** A recorded call's subcommand and its arguments: what follows `-C <dir>`. */
  const sub = (c: RecordedGitCall): string[] => c.argv.slice(c.argv.indexOf('-C') + 2);
  /** Exactly the binding proof's shapes, old and new; `pr-state`'s other git calls (`rev-list --count` for `ahead`,
   *  `log`, `status`) never match. If Step 2 shows another call of one of these shapes from outside `annotate`,
   *  narrow this filter to the proof's own argv and say so in the wave-done. */
  const annotateCalls = (calls: RecordedGitCall[]): string[] =>
    calls.map(sub).filter((a) =>
      (a[0] === 'cat-file' && (a[1] === '-e' || a[1]?.startsWith('--batch-check') === true))
      || (a[0] === 'merge-base' && a[1] === '--is-ancestor')
      || (a[0] === 'rev-list' && a.length === 3 && a[2] === '--'))
      .map((a) => a.slice(0, 2).join(' '));

  it('(a) reads every row of a session with one batch and one ancestry list', () => {
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    const rows = Array.from({ length: 20 }, (_, i) => mergedRow({ number: 100 + i, headRefName: `ws/other-${i}`, headRefOid: tip }));
    rows.push(mergedRow({ headRefOid: tip }));
    h.ghRows(rows);
    const rec = plantGitRecorder(h.home);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.rows.every((r: { ours: boolean }) => r.ours === true)).toBe(true);
    expect(annotateCalls(rec.calls())).toEqual(['cat-file --batch-check=%(objectname) %(objecttype)', 'rev-list ' + tip]);
    void main;
  });

  it('(b) a --project read makes two annotate calls per workspace, whatever the row count', () => {
    // A REAL commit, so the batch finds it and the ancestry list runs for both workspaces (the worktrees share one
    // object store); a missing oid would skip `rev-list` and prove less.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    workspaceWithCommit('demo', 'still-cove');
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
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    fs.writeFileSync(path.join(h.home, 'pick-rows.json'), JSON.stringify([mergedRow({ headRefOid: tip })]));
    // _pr_py pick <main> <branch> <base_short> <tip>, the rows on stdin — `_ws_reap_eval`'s call (≈12810).
    const out = h.sh(`_pr_py pick '${main}' ws/quiet-basin main '' < "$HOME/pick-rows.json"`);
    expect(out.trim()).toBe('!pr-head-not-ours');
  });
});
```

- [ ] **Step 2: Run them and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts -t 'binding, batched'`

Expected on `main`'s `ccd/ccd`:
- (a) and (b) fail: the recorder sees `cat-file -e` and `merge-base` per row.
- (c), (d) and (e) pass. They pin today's answers, which the change must keep.

Record the counts.

- [ ] **Step 3: Replace `is_ours` and `annotate`, line for line**

In `ccd/ccd`, replace the block from `def is_ours(main, tip, oid):` through the line `    return out` that ends `annotate`. Keep the line count exact. Keep the current docstring's argument as written: the recycled slug, the fork, the cat-file rung, `tip is None`. Trim its wording to make room for the code below; never pad another region.

```python
def ours_of(main, tip, oids):
    """Proof 0, for every row at once — the PR's head commit exists locally AND, where we have a tip to reach
    from, is reachable from it. This is what a recycled slug and a stranger's fork both fail.

    The SAME answers `is_ours` gave one row at a time (cat-file -e, then merge-base --is-ancestor), from ONE
    `cat-file --batch-check` and at most ONE `rev-list`: two git processes per call instead of two per row,
    which cost a --project sweep ~200 spawns per workspace (landing-order wave 3c). The oids go on STDIN,
    never an argv (spec §7), and only after `fullmatch`: `OID.match` lets a trailing newline through, and a
    newline on stdin would shift every later answer. `cat-file` peels `^{commit}` and answers `missing` for a
    blob or a stranger; reachability is membership in `rev-list <tip>`, which is what `--is-ancestor` asks.
    `tip is None` (the registry's branch did not resolve) skips the ancestry rung, as before; any other tip
    that `rev-list` cannot read answers False, as `merge-base` with that tip did (pick mode's raw '')."""
    cands = sorted({o for o in oids if isinstance(o, str) and OID.fullmatch(o)})
    full = {}
    if cands:
        r = subprocess.run(['git', '-C', main, 'cat-file', '--batch-check=%(objectname) %(objecttype)'],
                           input=''.join(o + '^{commit}\n' for o in cands), capture_output=True, text=True)
        got = r.stdout.split('\n')
        if r.returncode == 0 and len(got) > len(cands):
            for o, ln in zip(cands, got):
                f = ln.split(' ')
                if len(f) == 2 and f[1] == 'commit' and re.fullmatch(r'[0-9a-f]{40}', f[0]):
                    full[o] = f[0]
    reach = None
    if tip is not None and full:
        r = git(main, 'rev-list', tip, '--')
        reach = set(r.stdout.split()) if r.returncode == 0 else set()
    return [isinstance(o, str) and o in full and (reach is None or full[o] in reach) for o in oids]

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
- `-C main` and `subprocess.run` are as before.
- `git()` is the existing helper.
- `len(got) > len(cands)` holds because the batch's output ends with a newline.

Then fix the two comments that name `is_ours` (≈5667 and the `annotate` callers' comments, if any) to name `ours_of`, in place. Measure the block's line count before and after with `awk`: it must be equal.

- [ ] **Step 4: Restamp and run the tests**

```bash
bash ccd/ccrc restamp ccd/ccd && node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts
./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts test/ccd-lifecycle-pairs.test.ts test/ccd-prhistory.test.ts test/ccd-pr-queue.test.ts test/ccd-bounded-reads.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the compaction card'
./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/ownership.test.ts test/mark-check.test.ts
```

Expected:
- `mark --check` answers `ccrc-unmodified`.
- Every case passes, the new ones included.
- The census's `'ccd/ccd': 147` is unchanged.

- [ ] **Step 5: Mutations, then commit**

Record each red, then restore `ccd/ccd` byte for byte (`cmp`):
- **M1:** `OID.fullmatch(o)` becomes `OID.match(o)`. Expected: (d) reds.
- **M2:** `(reach is None or full[o] in reach)` becomes `True`. Expected: the existing `'refuses a PR whose head commit IS here but is not reachable from our tip'` reds, and so does (c).
- **M3:** `reach = None` before the `if` becomes `reach = set()` with no `rev-list`. Expected: the `tip: null` cases at `describe` ≈813 red.
- **M4:** the old per-row loop is restored. Expected: (a) and (b) red.

```bash
git add ccd/ccd server/test/ccd-pr-state.test.ts
git commit -m "fix(pr-state): read a workspace's PR rows in two git calls, same answers"
```

### Task 2: The PR sweep names how a read failed, and logs it once

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify:
  - `shared/api.ts` (`PrReason` ≈933, `PR_REASON_MAP` ≈954);
  - `server/src/prstate.ts` (new export after `queueFor`);
  - `server/src/watch.ts` (`sweepPr` ≈8155, `backoffPr` ≈8257, the success arm `this.prBackoff.delete(project)`);
  - `pwa/src/session/PrKeycap.tsx` (`REASON_TEXT` ≈70);
  - `server/test/single-definition.test.ts` (≈166).
- Test: `server/test/prstate.test.ts` and `server/test/pr-sweep.test.ts`.

**Interfaces:**
- Consumes: `CcdResult` (`server/src/coord/ports.ts:20-33`) and `ccdEnding` (`server/src/lifecycle.ts`).
- Produces:
  - `sweepFailureReason(res: CcdResult): PrReason`, which answers `'overrun'` or `'agent-down'`;
  - the new `PrReason` word `'overrun'`.

- [ ] **Step 1: Write the failing tests**

(a) In `server/test/prstate.test.ts`:

```ts
import { sweepFailureReason } from '../src/prstate.js';
import { UNMEASURED } from '../src/unmeasured.js';

describe('sweepFailureReason (landing-order wave 3c)', () => {
  const base = { ok: false as const, stdout: '', stderr: '' };
  it.each([
    ['the agent killed it at its deadline', { ...base, killed: true, signal: 'SIGTERM' }, 'overrun'],
    ["the server's own wait ran out", { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false as const, reason: 'timeout' as const, detail: 'timeout' }, 'overrun'],
    ['the link dropped', { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false as const, reason: 'transport' as const, detail: 'disconnected' }, 'agent-down'],
    ['the agent declined it', { ...base, killed: UNMEASURED, signal: UNMEASURED, ran: false as const, reason: 'spawn' as const, detail: 'x' }, 'agent-down'],
    ['ccd exited non-zero by itself', { ...base, killed: false, signal: null }, 'agent-down'],
    ['an older agent measured nothing', { ...base, killed: UNMEASURED, signal: UNMEASURED }, 'agent-down'],
  ])('%s', (_what, res, want) => {
    expect(sweepFailureReason(res)).toBe(want);
  });
});
```

(b) In `server/test/pr-sweep.test.ts`, inside `describe('backoffPr — …')`, a case that copies the first case's fixture. Its failing arm returns `{ code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' }`. It asserts `quiet.reason` is `'overrun'`.

(c) The same describe, a case whose failing arm returns `{ code: 1, stdout: '', stderr: 'timeout', ran: false, reason: 'timeout', detail: 'timeout' }`. It asserts `'overrun'`.

(d) A logging case on the same fixture. Spy with `const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})` and use `const sweeps = () => warn.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('PR sweep of demo'))`. The sequence is:
1. Fail, forcing the next pass due by setting `lastPrSweep = 0` and clearing `prBackoff`.
2. Fail again with the same result.
3. Succeed.
4. Fail.

Expected `sweeps()` after each step:
1. one line matching `/^ccrc-server: PR sweep of demo failed \(overrun\)/`;
2. still one line;
3. two, the second `ccrc-server: PR sweep of demo recovered`;
4. three.

Restore the spy with `warn.mockRestore()`.

(e) In `server/test/single-definition.test.ts`, change `expect(PR_REASONS).toHaveLength(12)` to `13`.

- [ ] **Step 2: Run them and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/prstate.test.ts test/pr-sweep.test.ts test/single-definition.test.ts`

Expected:
- (a) fails: `sweepFailureReason is not a function`.
- (b) and (c) read `agent-down`.
- (d) finds no line.
- (e) reads 12.

- [ ] **Step 3: Implement**

`shared/api.ts`: add `| 'overrun'` to `PrReason`, and `overrun: true,` to `PR_REASON_MAP`. Its docstring line reads: `overrun: ccrc's own read of the PRs took longer than the server allows (the sweep, not GitHub)`.

`pwa/src/session/PrKeycap.tsx`, in `REASON_TEXT`: `overrun: 'ccrc took too long to read the PRs.',`

`server/src/prstate.ts`, after `queueFor`:

```ts
/** How a failed `pr-state --project` call failed, for the sweep's backoff (landing-order wave 3c). A deadline —
 *  the agent's own kill (`ccdEnding` `deadline`) or this server's wait running out (`ran: false`, `timeout`) — is
 *  `overrun`: the read is too slow for its bound, a fact about the read, not about the link. Everything else keeps
 *  the sweep's old word, `agent-down`, unchanged, because nothing else here was measured to be anything more. */
export function sweepFailureReason(res: CcdResult): PrReason {
  if (res.ran === false) return res.reason === 'timeout' ? 'overrun' : 'agent-down';
  return ccdEnding(res).kind === 'deadline' ? 'overrun' : 'agent-down';
}
```

Import `ccdEnding` from `./lifecycle.js` and `type CcdResult` from `./coord/ports.js`, unless `prstate.ts` already imports them. Keep the import block's ring.

`server/src/watch.ts`:
- In `sweepPr`, `if (!res.ok) { this.backoffPr(project, now, 'agent-down', records); continue; }` becomes `if (!res.ok) { this.backoffPr(project, now, sweepFailureReason(res), records); continue; }`.
- At the end of `backoffPr`, after the loop:

```ts
    // Said once per change (landing-order wave 3c): a blind lane used to be invisible, every pass backing off as
    // `agent-down` with nothing in the journal. The latch is the reason, so a new reason speaks and a repeat does not.
    if (this.prSweepFailure.get(project) !== reason) {
      console.warn(`ccrc-server: PR sweep of ${project} failed (${reason}); retrying in ${Math.round(step / 1000)}s`);
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
cd server && ./node_modules/.bin/vitest run test/prstate.test.ts test/pr-sweep.test.ts test/single-definition.test.ts test/pr-routes.test.ts test/pr-queue-lane.test.ts test/remote-runner.test.ts
cd ../pwa && ./node_modules/.bin/vitest run src/session
cd ../server && npm run build
```

Expected: all pass, and the build exits 0.

- [ ] **Step 5: Mutations, then commit**

- **M5:** `sweepFailureReason(res)` becomes `'agent-down'`. Expected: (b) and (c) red.
- **M6:** the latch test `!== reason` becomes `true`. Expected: (d) reds at its second step.
- **M7:** delete the recovery line. Expected: (d) reds at step 3.

Restore each.

```bash
git add shared/api.ts server/src/prstate.ts server/src/watch.ts pwa/src/session/PrKeycap.tsx server/test/prstate.test.ts server/test/pr-sweep.test.ts server/test/single-definition.test.ts
git commit -m "fix(pr-sweep): name an overrun, and log a failed sweep once per change"
```

### Task 3: The server's close waits for the server-caps write a tick started

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `server/src/server.ts` (the `onClose` hook, ≈3908).
- Test: `server/test/server-caps.test.ts`.

**Interfaces:**
- Consumes: `FleetWatcher.serverCapsSettled(): Promise<void>` (`watch.ts:1710`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `server/test/server-caps.test.ts`, a case that holds the write open:

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
  const deps = testDeps(home);
  const bus = new Bus();
  const watcher = new FleetWatcher(deps, bus);
  const app = await buildServer(deps, bus, watcher);   // fleetws.test.ts's `connect` does the same
  await watcher.tick();
  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  await new Promise((r) => setTimeout(r, 50));
  expect(closed, 'close must not finish while the caps write is in flight').toBe(false);
  release();
  await closing;
  expect(closed).toBe(true);
  spy.mockRestore();
});
```

Imports this case adds, unless the file already has them: `buildServer` from `../src/server.js`, and `seedRoster` from `./helpers.js`. The mock stands in for the write and sets the watcher's private `serverCapsRun` exactly as the real `serverCapsNow` does (`watch.ts:1692-1708`). So `serverCapsSettled()` sees a write in flight, and the real writer is never asked to write under the fixture.

- [ ] **Step 2: Run it and record the red**

Run: `cd server && ./node_modules/.bin/vitest run test/server-caps.test.ts -t 'closing the server waits'`

Expected: FAIL. `closed` is true while the write is held.

- [ ] **Step 3: Implement**

`server/src/server.ts` changes from

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

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/server-caps.test.ts test/fleetws.test.ts test/boot.test.ts
```

Expected: all pass. `boot.test.ts` is known base-red on a loaded box (wall-clock). If it reds, run it alone on `main` too and record both.

- [ ] **Step 5: Mutation, then commit**

- **M8:** drop `await watcher.serverCapsSettled();`. Expected: the new case reds. Restore.

```bash
git add server/src/server.ts server/test/server-caps.test.ts
git commit -m "fix(server): close waits for an in-flight server-caps write"
```

### Task 4: The tick-diet differential file runs as two files, one per locale

**Model routing:** `sonnet`, effort `high`. The move is mechanical but large, and every row must still run exactly once per locale.

**Files:**
- Create: `server/test/tickDietRunner.ts` (not a `.test.ts`).
- Create: `server/test/ccd-tick-diet-equivalence-utf8.test.ts`.
- Modify: `server/test/ccd-tick-diet-equivalence.test.ts`.

**Interfaces:**
- Produces: `tickDietRunner.ts` exports:
  - the runner and helpers the file defines today (`PRELUDE`, `BLOBS`, `runBatch`, `UTF8_LOCALE`, `LOCALES`, `NO_UTF8`, `runScript`, and every helper they use);
  - `registerLocaleRows(loc: (typeof LOCALES)[number]): void`, which registers E3, E5, E6, E7, E8, E9 and E10 for that one locale, under the same describe names `describe.each(LOCALES)` gives them today.
- The C file calls `registerLocaleRows(LOCALES[0])` and keeps the locale-free blocks: E0, E1, E2, E8d, E8g, E10d and E4. The UTF-8 file calls `registerLocaleRows(LOCALES[1])` alone.

- [ ] **Step 1: Measure the inventory before moving anything**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence.test.ts --reporter=json --outputFile.json=/tmp/<scratch>/diet-before.json
```

(Run it in the foreground. Let it run past the tool bound if it must, as bounded parts per describe: `-t 'E0'`, `-t 'E3'`, and so on. Record the bound you used.) Keep the list of full test names and their states: it is the oracle for Step 4. Also run `git grep -n 'ccd-tick-diet-equivalence.test.ts:[0-9]'`. It is expected to find none; if it finds any, they move with their lines and the wave-done lists them.

- [ ] **Step 2: Move, without changing a test body**

- Move the helper block (≈69–704 at `b2c17f859`) into `tickDietRunner.ts`. Then move the seven `describe.each(LOCALES)(…)` blocks into `registerLocaleRows`, each becoming `describe(<the same title, with the locale's name>, …)`.
- The UTF-8 skip-or-red behaviour (`NO_UTF8`: skipped on Darwin, red on Linux) moves with them unchanged.
- Leave the header comment in the C file. Correct its "(E5 sits above E4 in the file.)" sentences to say where each part now lives.
- The UTF-8 file's header says, in two sentences, why the split exists: one shard carried both halves at ~21 min median against a 30-minute bound, and the planner never splits a file.

- [ ] **Step 3: Check the move is a move**

- `git diff --stat` shows the test bodies moved, not rewritten.
- `git diff -M` on the moved hunks shows only indentation and the describe titles' locale argument.

- [ ] **Step 4: Run both files, and compare inventories**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence.test.ts --reporter=json --outputFile.json=/tmp/<scratch>/diet-c.json
./node_modules/.bin/vitest run test/ccd-tick-diet-equivalence-utf8.test.ts --reporter=json --outputFile.json=/tmp/<scratch>/diet-utf8.json
```

Expected: the union of the two files' full test names equals Step 1's list exactly (the same names, the same states), and no name is in both files. Put the comparison script and its output in the wave-done.

- [ ] **Step 5: Check CI selects both files**

Run `.github/ci/select-tests.mjs` the way `ci.yml`'s `select` job does, for a change to `ccd/ccd` alone, with the current map (read the job's step for the exact invocation). Record whether the UTF-8 file is selected while the map does not yet know it.
- If it is not, do not hack the selector. Report it in the wave-done: the coordinator rules (a full-mode run on the PR, or the map rebuilt by the next merge to `main`).
- Also run `server/test/ci-shards.test.ts` and `server/test/ci-pipeline.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add server/test/tickDietRunner.ts server/test/ccd-tick-diet-equivalence.test.ts server/test/ccd-tick-diet-equivalence-utf8.test.ts
git commit -m "test(tick-diet): run the differential file as two files, one per locale"
```

### Task 5: Task 7's runbook carries the re-run's changes (text only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, Task 7 Steps 5 and 6.

- [ ] **Step 1: Before (a0), a live reading of the lane**

At the start of Step 5, before the paragraph that begins `Make FIVE TRIVIAL PRs`, insert:

```markdown
**First, the lane must be seen to work on this project (landing-order wave 3c).** The 2026-10-20 run found it blind: the project's `pr-state` read took longer than the server's bound, every sweep failed silently, and no `queue` event or landing mail could appear. Before Step 4's write, on both boxes' current build:
- time `ccd pr-state --project <project>` on the fleet box (read-only) — it must finish in under half of the server's `pr-state` bound (`server/src/remote/runner.ts`);
- the server's journal carries no `PR sweep of <project> failed` line newer than its last `recovered` line;
- `~/.local/bin/ccrc-api feed list --limit 50` holds a `merged` event for the newest PR merged on this project since that build was applied.
Any one missing is a stop before the write, not a stop rule: the queue is never armed over a blind lane.
```

- [ ] **Step 2: (e) before (a1), on the same PR**

In Step 5, move the (e) paragraph so that it comes directly after (a0) and before (a1), and amend both:
- (e)'s first sentence becomes: `(e) **The dequeue lane** — on the fourth PR, BEFORE (a1) pushes to it (a push made outside its workspace moves the PR's head off the workspace's own tip, and the lane then no longer binds it): enqueue it once its required checks are green, read the entry back, then remove it with GraphQL's `dequeuePullRequest`, and within one sweep (≤ 120 s):`
- (a1)'s first sentence gains, after its first clause: `It runs on the same fourth PR after (e), so (e)'s reading is not spent on a PR the lane cannot bind.`

- [ ] **Step 3: Never switch the requirement off over entries**

In Step 6, stop rule 3's `Roll back:` sentence becomes:

```markdown
Roll back: first read the queue (`gh api graphql -f query='{repository(owner:"<o>",name:"<r>"){mergeQueue(branch:"main"){entries(first:50){nodes{pullRequest{number}}}}}}'`) and remove EVERY entry with `dequeuePullRequest`, reading each PR's timeline back for its `RemovedFromMergeQueueEvent` — switching the requirement off with entries in it drops them silently (2026-10-20: no removal event, the last act stays `Added`, and no lane can announce it) — then re-apply `ruleset-rollback.json` (queue off, approvals 1, maintain bypass back), and comment on each removed PR that is not this proof's. Landing returns to `--admin` exactly as before this runbook, because the every-session `--admin` deny (wave 2b) is not live.
```

Stop rule 5's `roll back as in 3` is unchanged: it now includes the dequeue.

- [ ] **Step 4: A bypass merge is an observation**

After stop rule 7, add:

```markdown
A merge to `main` through the admin bypass while the queue is on (another programme's landing; wave 2b's deny is not live) makes the queue rebuild its groups on the new base. That is recorded with its time and PR, and is not a stop by itself; a rebuilt group that then fails for a reason not its PR's own is stop rule 3.
```

- [ ] **Step 5: Check and commit**

```bash
grep -c 'dequeuePullRequest' docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
cd server && ./node_modules/.bin/vitest run test/docs-grammar.test.ts test/deviation-refs.test.ts
git add docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
git commit -m "docs(landing-order): Task 7's runbook carries the re-run's changes"
```

Expected: the `dequeuePullRequest` count is at least 3: (e), the rollback, and the read. Both tests pass. If a docs test pins Task 7's text, it is updated in this commit and named in the wave-done.

### Task 6: The wave's gate, the PR and the wave-done

**Model routing:** `sonnet`, effort `medium`.

- [ ] **Step 1: The whole wave's owning gates, one file at a time, in the foreground**

- Server:
  - `ccd-pr-state`, `ccd-ws-audit`, `ccd-ws-reap`, `ccd-lifecycle-pairs`, `ccd-prhistory`, `ccd-pr-queue`, `ccd-bounded-reads`;
  - `pr-sweep`, `prstate`, `pr-routes`, `pr-queue-lane`, `remote-runner`, `pr-timeout-budget`;
  - `server-caps`, `fleetws`, `boot`;
  - both tick-diet files;
  - `single-definition`, `ownership`, `mark-check`, `deviation-refs` (after `git fetch origin main`), `docs-grammar`;
  - `session-hook -t 'the compaction card'`.
- PWA: `src/session`.
- Builds: `server` and `pwa`, `npm run build`.

The known load flakes are in `CLAUDE.md`. Re-run one alone before calling it a break, and name every re-run.

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
