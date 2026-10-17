# Centralised update management, wave 20: the Docs helper's group stop survives Darwin's EPERM (stable blocker B2): Implementation Plan

The operator ruled on 2026-10-17 at 15:50 UTC that this programme repairs stable blocker B2, which the operator had authorised to the native Docs reader programme on 2026-10-16 (programme ledger, the 15:50 entry; the Docs reader's coordinator acknowledged the handoff). Run 566 carries it, with deviation block 5333 to 5342. A plan workflow's drafter prototyped the change on 2026-10-17 from `main` at `67f4c17bdc9b0c7804f3d5d713423583ff6bba8e`, in its own worktree. Its session died twice (the shared session slice sat at its 24 GiB cap, and the out-of-memory killer took the coordinator's process with its in-process agents), before it wrote a plan or recorded its measurements. The coordinator wrote this plan from that prototype's diff on the same day. **Nothing in it is measured.** Every red and green it names is marked *(unmeasured: the worker measures it)*, and the worker measures each before it relies on it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** row 64 of `server/test/ccd-docs-tree.test.ts` ("a status stdout overflow under a lowered `stdout_cap` is too-many; the committed listing is intact") goes green on the macOS runner, with nothing else in the Docs helper changing.

**The defect, as measured by the Docs reader programme** (its diagnostic run 38893503016, `test-macos 3/4`, 2026-10-16; macOS 26.6.2 arm64, CPython 3.15.0):
- `git status` overflowed the lowered `stdout_cap` (overflow true, timed_out false, 200 bytes kept).
- The helper's `Sys._stop` sent the group SIGTERM, and that first `os.killpg(PGID, SIGTERM)` raised PermissionError, errno 1 (EPERM).
- `_signal_group` re-raises every OSError except ESRCH. So the error left `_stop` and the spawn before `Spawned` returned. The snapshot's OSError arm then answered `unreadable`, with detail "spawn: Operation not permitted".
- **Not measured:** why the kernel answered EPERM, whether any member of the group was live, and whether the leader had exited or been reaped.

**The fitting hypothesis, not a measured cause:** Darwin answers EPERM, not ESRCH, from `killpg` while every member left in the group is a zombie. An exited `git` that its parent has not yet reaped is one. Linux signals such a group with rc 0, which is why row 64 is green on every Linux leg. The change below is correct whether or not the hypothesis holds:
- it absorbs an EPERM only at the first signal, the SIGTERM, and only when the leader turns out to have exited, and reaps it;
- any other EPERM still raises, a leader that is still alive included, and so does every EPERM at the SIGKILL (D-5335);
- a live member other than the leader is still signalled through the existing grace and SIGKILL path, and one that refuses the SIGKILL makes it raise, so the refusal is never hidden.

**Architecture:** one function changes shape, inside the Docs helper's `Sys` class in `ccd/ccd`. `_signal_group` takes the `Popen`, not its pgid, so it can tell an exited leader from a live one at the moment EPERM arrives. `_stop` passes the `Popen`, and only its SIGTERM call asks for the absorb, by an explicit argument (D-5335). `_group_alive` is unchanged. The test replays Darwin's answer on Linux through the helper's own seam: the helper's `os` is the unit's `os`, so a unit can swap `os.killpg`.

**Deploy class:** fleet-first. `ccd/ccd` reaches each home through the install spine, and the Docs verbs run on the fleet box.

**Landing order:** after #410 (claim 1557 holds `ccd/ccd`), then whichever of this wave and #448 is ready first. Every later `ccd/ccd` lander restamps line 2. The disjointness was measured at planning: #410's last `ccd/ccd` hunk starts at line 35817, and #448, #441 and #435 edit nothing after line 22879. This wave's hunk is at `_stop`, line 36796 at `67f4c17bd`. Anchor by content, not by number.

## Not in this wave

- Any other change to the Docs helper, its caps, its deadline or its verbs. Row 64 itself stays **byte-unchanged**, because it is the macOS proof.
- `_group_alive`'s EPERM reading. It still reads EPERM as alive. After `_signal_group` has reaped the leader, an empty group answers ESRCH and the wait ends. On Darwin the reaped leader's exited children can stay in the group as zombies until launchd reaps them, and through that window `_group_alive` reads EPERM as alive, which only keeps the loop polling. The window is transient, bounded by launchd's reap; if it outlasts `KILL_GRACE_S` the SIGKILL arm raises (loud, no leak). Changing `_group_alive` would not help, because any raise comes from `_signal_group`. Reading 2 asks the coordinator to confirm this.
- The Docs reader programme's diagnostic branch. It stays unlanded, by that programme's own ruling.

## Global Constraints

- **Files:** `ccd/ccd` (the three functions and the stamp on line 2) and `server/test/ccd-docs-tree.test.ts` (a new describe appended at the end). Nothing else changes.
- **Claims:** take a claim on both files at the start. Claim 1557 (run 433) holds `ccd/ccd` until #410 lands. Do not edit `ccd/ccd` until the coordinator's brief says either that the holder consented or that #410 landed.
- **Fixture HOMEs only:** every unit runs under the file's harness HOME. Never run a `ccd` verb against the live HOME, and never touch real tmux, `systemctl --user`, `launchctl` or `claude-session@` units.
- **Memory:** the shared session slice is at its cap. Run one vitest file at a time, foreground, with `-t '<case>'` where a row names one case, `--pool=forks --maxWorkers=1`, and a short real TMPDIR. Do not start a run while `anon` in the slice's `memory.stat` reads above 22 GiB.
- **Public repo:** noreply identity, and no hosts, home paths, lane or account names in code, commits or the PR body.

## Review Focus

- Is the EPERM absorbed **only** at the SIGTERM, and only when the leader had not been reaped before the signal and `poll()` now shows it exited? Linux EPERM, a live leader's EPERM, an already-reaped leader's EPERM and every EPERM at the SIGKILL must all still raise.
- Does a live non-leader member still get SIGTERM and then, after `KILL_GRACE_S`, SIGKILL?
- Does the injected row really discriminate: green with the change, and red on `main` and under each mutation row?
- Is row 64 byte-unchanged, and is the stamp recomputed rather than copied?

## Risk notes

- **Linux EPERM stays loud.** On Linux EPERM means a real refusal, a member owned by another user. The absorb arm requires both conditions: the leader was unreaped before the call, and `poll()` reaps it now. A refusal with a live leader still raises.
- **The reap racing the signal.** `poll()` reaps at most the leader, so a later `killpg` on an emptied group answers ESRCH, which is already absorbed. The second unit's two halves cover one path: in both, the leader is an unreaped zombie at the first signal, one having exited on its own and one killed as that signal was sent. `_stop` does nothing between its start and its first `killpg`, so there is no separate window to model.
- **Darwin versions.** The runner had macOS 26.6.2 and CPython 3.15.0. The replay models XNU's answer: ESRCH for no member, EPERM when every member is a zombie, otherwise the real call. Only the dispatched full run proves the macOS leg.
- **The replay reads `/proc`,** so its describe is `skipIf(process.platform !== 'linux')`. On macOS, row 64 itself is the test.

## Deviations found

- **D-5333.** `Sys._signal_group` takes the `Popen` instead of its pgid. It absorbs an EPERM when the leader was unreaped before the call and `poll()` reaps it now, and raises every other EPERM. `_stop` passes the `Popen` to both of its signal calls. Why: the Docs reader programme measured EPERM from the first SIGTERM after an overflow on macOS, and the old function, which re-raised everything but ESRCH, turned it into `unreadable`. The cause is a hypothesis, so the arm keys on the one fact that makes the absorb safe, an exited leader, rather than on the platform.
- **D-5334.** The test replays Darwin's `killpg` answer on Linux, through the helper's `os` seam, from `/proc`'s member states. It logs every answer to `$HOME/killpg.log` so a green row proves the EPERM was met. Row 64 stays byte-unchanged as the macOS proof. Why: a pull request skips `test-macos`, and a fix proved only on the platform it cannot reach would ship unpinned on Linux CI.
- **D-5335** (the coordinator's ruling on review 573's F1). The absorb applies at `_stop`'s SIGTERM call only, asked for by an explicit argument (`_signal_group(proc, signal.SIGTERM, absorb_reaped=True)`); at the SIGKILL call an EPERM raises exactly as before D-5333, even with a leader that `poll()` would now reap. Why: at the SIGKILL no wait follows but the leader's, so an absorb there could hide a refusal to stop a live member with foreign credentials, and fail-loud (`unreadable`) is the safer error. Row 64's case meets the zombie leader at the first signal, which the SIGTERM absorb still covers. The cost: a leader that exits in the last poll gap before the SIGKILL, leaving a group of zombies, raises `unreadable` again; that is as rare, and loud. A fourth case pins it, and mutation row T20-M6 reds it.
- Numbers 5336 to 5338 are the coordinator's. The worker's reserve is 5339 to 5342, spent in order, each defined here before use.

## File structure

- `ccd/ccd`: in the Docs helper's `class Sys`, `_stop` changes in two lines and `_signal_group` changes in its signature, its body and a new docstring. Line 2 is restamped.
- `server/test/ccd-docs-tree.test.ts`: one new describe at the end of the file, with three cases and the `T20_DARWIN_KILLPG` preamble (four cases after fix round 1). It uses the existing `t14phase` (its `pre` option), `t14holder`, `T14_S`, `t14fs`, `t14path`, `h` and `unitJson`.

## Tasks

### Task 1: the red row first

- [x] **Step 1.** Take the claims (Global Constraints). Append the describe below to the end of `server/test/ccd-docs-tree.test.ts`, exactly:

```ts
// ---------------------------------------------------------------------------------------------------------------
// Row 64 on Darwin, replayed on Linux (centralised update wave 20, stable blocker B2). On macOS the overflow row 64
// above read `unreadable`, never `too-many`: Sys._stop's first killpg(SIGTERM) met EPERM and raised before Spawned
// returned. Darwin answers EPERM, not ESRCH, while every member of the group is a zombie, and a git that has exited
// but is not yet reaped is one; Linux signals that group with rc 0, so row 64 is green here and only the macOS leg
// can see it. These units replay Darwin's answer through the helper's own seam: the helper's `os` is the unit's
// `os`, so the unit swaps `os.killpg` for one that reads the group's members from /proc and answers as XNU's
// killpg does (no member: ESRCH; every member a zombie: EPERM; else the real call). Linux only (/proc); row 64
// itself stays byte-unchanged as the macOS proof. Its first answer waits (bounded) for the leader to have exited,
// so the zombie leader is a fact of the run, not a race won. Every answer is logged to $HOME/killpg.log, so a green
// row shows that the EPERM was met.
const T20_DARWIN_KILLPG: string[] = [
  'import errno as _t20_errno',
  'import os as _t20_os',
  'import time as _t20_time',
  '_t20_real = _t20_os.killpg',
  '_t20_log = _t20_os.path.join(_t20_os.environ["HOME"], "killpg.log")',
  'def _t20_members(pgid):',
  '    got = []',
  '    for d in _t20_os.listdir("/proc"):',
  '        if d.isdigit():',
  '            try:',
  '                with open("/proc/" + d + "/stat") as f:',
  '                    s = f.read()',
  '            except OSError:',
  '                continue',
  '            rest = s[s.rindex(")") + 2:].split()',
  '            if int(rest[2]) == pgid:',
  '                got.append(rest[0])',
  '    return got',
  'def _t20_answer(sig, word):',
  '    with open(_t20_log, "a") as f:',
  '        f.write("%d %s\\n" % (sig, word))',
  'def _t20_killpg(pgid, sig):',
  '    if not _t20_os.path.exists(_t20_log):',
  '        end = _t20_time.monotonic() + 5',
  '        while _t20_time.monotonic() < end and "Z" not in _t20_members(pgid):',
  '            _t20_time.sleep(0.01)',
  '    m = _t20_members(pgid)',
  '    if not m:',
  '        _t20_answer(sig, "ESRCH")',
  '        raise OSError(_t20_errno.ESRCH, "No such process")',
  '    if all(st == "Z" for st in m):',
  '        _t20_answer(sig, "EPERM")',
  '        raise OSError(_t20_errno.EPERM, "Operation not permitted")',
  '    _t20_answer(sig, "ok")',
  '    return _t20_real(pgid, sig)',
  '_t20_os.killpg = _t20_killpg',
];
const t20log = (): string[] => {
  const p = t14path.join(h.home, 'killpg.log');
  return t14fs.existsSync(p) ? t14fs.readFileSync(p, 'utf8').trim().split('\n') : [];
};

describe.skipIf(process.platform !== 'linux')('row 64 on Darwin: killpg answers EPERM for a group of zombies (wave 20, B2)', () => {
  it('row 64, Darwin answer injected: a status overflow whose git exited unreaped is too-many, never unreadable', () => {
    const { wt, head } = t14holder({ [`${T14_S}a.md`]: 'aaaa\n' });
    for (let i = 0; i < 20; i++) t14fs.writeFileSync(t14path.join(wt, T14_S, `long-name-${i}-${'x'.repeat(40)}.md`), 'n\n');
    const o = t14phase({ served: head, kw: 'stdout_cap=200', pre: T20_DARWIN_KILLPG });
    expect(o.facts).toMatchObject({ state: 'too-many', branch: 'ws/a', worktree: wt });
    expect(o.facts['bytes']).toBe(200);
    expect(o.entries).toBe(1);
    // Non-vacuity: the stop met Darwin's EPERM first, then found the group empty.
    expect(t20log()).toEqual(['15 EPERM', '0 ESRCH']);
  }, 60000);

  it('_stop: a leader that exited before the stop, or between the reap and the signal, is reaped and the call returns', () => {
    const got = unitJson<Record<string, unknown>>(h.home, [
      ...T20_DARWIN_KILLPG,
      'import signal, subprocess',
      'res = {}',
      "p = subprocess.Popen(['true'], start_new_session=True)",
      'H.SYS._stop(p)',
      "res['exited'] = p.returncode",
      "q = subprocess.Popen(['sleep', '30'], start_new_session=True)",
      'def _t20_racing(pgid, sig):',
      '    _t20_real(pgid, signal.SIGKILL)   # the leader dies after the stop began, before this signal lands',
      '    _t20_os.killpg = _t20_killpg',
      '    return _t20_killpg(pgid, sig)',
      '_t20_os.killpg = _t20_racing',
      'H.SYS._stop(q)',
      "res['raced'] = q.returncode",
      'out(res)',
    ].join('\n'), { timeoutMs: 60_000 });
    expect(got).toEqual({ exited: 0, raced: -9 });
    expect(t20log()).toEqual(['15 EPERM', '0 ESRCH', '15 EPERM', '0 ESRCH']);
  }, 60000);

  it('EPERM stays loud: a live leader that refuses, and a leader already reaped that refuses, both raise EPERM', () => {
    const got = unitJson<Record<string, string>>(h.home, [
      'import errno, os, signal, subprocess',
      'real = os.killpg',
      'def refuse(pgid, sig):',
      '    raise OSError(errno.EPERM, "Operation not permitted")',
      'def stop(p):',
      '    os.killpg = refuse',
      '    try:',
      '        H.SYS._stop(p)',
      "        return 'returned'",
      '    except OSError as e:',
      "        return 'raised ' + errno.errorcode[e.errno]",
      '    finally:',
      '        os.killpg = real',
      'res = {}',
      "live = subprocess.Popen(['sleep', '3'], start_new_session=True)",
      "res['live'] = stop(live)",
      'try:',
      '    real(live.pid, signal.SIGKILL)',
      'except OSError:',
      '    pass',
      'live.wait()',
      "done = subprocess.Popen(['true'], start_new_session=True)",
      'done.wait()',
      "res['reaped'] = stop(done)",
      'out(res)',
    ].join('\n'), { timeoutMs: 60_000 });
    expect(got).toEqual({ live: 'raised EPERM', reaped: 'raised EPERM' });
  }, 60000);
});
```

- [x] **Step 2.** Run only the new describe on unchanged `ccd/ccd`. Expected *(unmeasured: the worker measures it)*:
  - case 1 is red, with state `unreadable`;
  - case 2 is red, because `_stop` raises EPERM;
  - case 3 is green, because both of its refusals raise on `main` too.

  Record the output.

```bash
cd server && TMPDIR=~/.cc-tmp/w20 ./node_modules/.bin/vitest run test/ccd-docs-tree.test.ts -t 'row 64 on Darwin' --pool=forks --maxWorkers=1
```

  **Measured (worker, 2026-10-17, on this branch's unchanged Docs helper (base `0b3ff2f62` plus wave 15); slice anon 20.96 GiB):** `Tests 2 failed | 1 passed | 184 skipped (187)`, exactly the expected split.
  - Case 1 is red: `expected { state: 'unreadable', …(4) } to match object { state: 'too-many', …(2) }`.
  - Case 2 is red: `docs helper unit exited 1: PermissionError: [Errno 1] Operation not permitted`, raised out of `_stop`.
  - Case 3 is green.

### Task 2: the change in `ccd/ccd`

- [x] **Step 1.** Apply this hunk to `class Sys` (anchor `def _stop(self, proc):`). It changes nothing else:

```diff
diff --git a/ccd/ccd b/ccd/ccd
index bd6e1e20c..da3a3c7b2 100755
--- a/ccd/ccd
+++ b/ccd/ccd
@@ -36800,21 +36800,29 @@ class Sys(Sys):
         later gets SIGKILL. The leader is reaped as it goes, so a group that
         has emptied answers ESRCH, which ends the wait early."""
         pgid = proc.pid
-        self._signal_group(pgid, signal.SIGTERM)
+        self._signal_group(proc, signal.SIGTERM)
         until = self.monotonic() + KILL_GRACE_S
         while self.monotonic() < until:
             if proc.poll() is not None and not self._group_alive(pgid):
                 break
             time.sleep(GROUP_POLL_S)
         else:
-            self._signal_group(pgid, signal.SIGKILL)
+            self._signal_group(proc, signal.SIGKILL)
         proc.wait()
 
-    def _signal_group(self, pgid, sig):
+    def _signal_group(self, proc, sig):
+        """killpg the leader's group. ESRCH, a group already empty, is no
+        error. Darwin answers EPERM, not ESRCH, while every member left is a
+        zombie, and an exited leader not yet reaped is one: an EPERM met while
+        the leader was unreaped reaps it (poll) and is no error either, and
+        _stop's wait judges whatever is left. Any other EPERM, a leader
+        already reaped included, is a refusal and raises; on Linux, which
+        signals a zombie leader's group with rc 0, that is the only kind."""
         try:
-            os.killpg(pgid, sig)
+            os.killpg(proc.pid, sig)
         except OSError as e:
-            if e.errno != errno.ESRCH:
+            reaped = e.errno == errno.EPERM and proc.returncode is None and proc.poll() is not None
+            if e.errno != errno.ESRCH and not reaped:
                 raise
 
     def _group_alive(self, pgid):
```

- [x] **Step 2.** Restamp by recomputing: from the checkout root, run `ccd/ccrc restamp ccd/ccd`. Then `node shared/mark.mjs --check ccd/ccd` must print `ccrc-unmodified`, and `grep -c '^# ccrc:generated' ccd/ccd` must print 1. Never copy a stamp from this plan, a PR or another branch.
  **Measured (worker, 2026-10-17):**
  - The hunk applied by exact-string replacement, one match per site, in `_stop` at `ccd/ccd:36730` (`_signal_group` at `:36747`, before the edit). It went onto this branch's tree, base `0b3ff2f62` plus wave 15.
  - `git diff --numstat` gives `14 6 ccd/ccd`, and `wc -l` goes from 39777 to **39785** (+8: the 7-line docstring and the `reaped` line). The file mode stays 100755.
  - `~/.local/bin/ccrc restamp ccd/ccd` printed `restamp: ccd/ccd: restamped`. `--check` gives `ccrc-unmodified`, and the `# ccrc:generated` count is 1.
  - `_signal_group` has no other caller in `ccd`, `server/src` or `server/test`.
- [x] **Step 3.** Re-run Task 1 Step 2's command. All three cases are green, and case 1's log reads `15 EPERM`, then `0 ESRCH` *(unmeasured: the worker measures it)*. Then run the whole file once, alone. Row 64 and every older row stay green on Linux.
  **Measured:**
  - The describe gives `3 passed | 184 skipped`. Its `killpg.log` assertions held: case 1 logged `['15 EPERM', '0 ESRCH']` and case 2 logged the doubled sequence.
  - The whole file, alone: **187 passed** (75 s).

### Task 3: mutation rows

Before each row, `cp ccd/ccd "$SCRATCH/ccd.good"`. Apply the mutant (not restamped), run the describe with `-t 'row 64 on Darwin'`, record which cases red, then restore with `cp` and check with `cmp`. Never use `git checkout --` or a bare `git stash`. All rows are *(unmeasured: the worker measures them)*.

| Row | Mutant in `_signal_group` | Expected red |
|---|---|---|
| T20-M1 | `reaped = False` (the old behaviour: only ESRCH absorbed) | cases 1 and 2 |
| T20-M2 | drop `proc.returncode is None and` (absorb whenever `poll()` shows an exit) | case 3's `reaped` arm |
| T20-M3 | drop `and proc.poll() is not None` (absorb any EPERM while the leader is unreaped) | case 3's `live` arm |
| T20-M4 | `if e.errno not in (errno.ESRCH, errno.EPERM): raise` | case 3, both arms |

**Measured (worker, 2026-10-17): every row's red equals its expected set.**

| Row | Measured red |
|---|---|
| T20-M1 | cases 1 and 2 |
| T20-M2 | case 3, with `reaped` reading `returned` and `live` still `raised EPERM` |
| T20-M3 | case 3, with `live` reading `returned` and `reaped` still `raised EPERM` |
| T20-M4 | case 3, with both arms reading `returned` |

Each row was restored with `cp`, and `cmp` matched. `--check` was `ccrc-unmodified` after each restore.

`ownership.test.ts` is red under every unrestamped mutant. That red belongs to no row.

### Task 4: the gate and the PR

- [x] **Step 1.** Run one file at a time: `ccd-docs-tree.test.ts` (whole), `ownership.test.ts`, `mark-check.test.ts`, and the three ledger guards `topology-clean`, `deviation-refs` and `dtbd` (run `git fetch origin main` before `deviation-refs`). A known load flake re-runs alone.
  **Measured (worker, 2026-10-17).** One file at a time, with `--pool=forks --maxWorkers=1` and a short TMPDIR. Slice anon read 20.4 to 21.5 GiB at each start, and every file is green.
  - **This wave's gate:** `ccd-docs-tree` 187, `ownership` 14, `mark-check` 7, `topology-clean` 55, `deviation-refs` 31, `dtbd` 1.
  - **The obligations the `ccd/ccd` holder named:**
    - `session-hook`'s citation corpus (`-t 'the compaction card — every line citation is anchored'`): 13.
    - `archived-expiry-policy`: 76. No failed or refused site was added.
    - `ccd-id-cap` cannot be measured here: the file exists only on #410's branch. It is measured after #410 lands and `main` is merged.
  - **Wave 15's gate files, re-run:** `ccd-supervised-start` 28 (4 skipped), `macos-platform` 104 (11 skipped).
  - **The other suites that load the Docs helper, since `_stop` serves every verb:** `ccd-docs-index` 256, `ccd-docs-fetch` 31, `ccd-docs-show` 86, `docs-budget` 19, `docs-grammar` 158, `docs-parity` 54.
- [ ] **Step 2.** Commit on the workspace branch. Open the PR with a body that says what changed, why (B2), and that it is proved on macOS only by a dispatched full run. Use noreply identity, and put no hosts, paths, lane or account names in it.
- [ ] **Step 3.** Send the wave-done. The suite line follows the worker skill. Name the dispatched full run the coordinator must trigger on the branch (`gh workflow run ci.yml --ref <branch> -f mode=full`). The worker runs no `gh` writes itself. The coordinator triggers the run and reads the `test-macos` shard that runs `ccd-docs-tree`: on full run 39050387114 that was `test-macos 2/4` (job 117447659194), not 3/4.

### Fix round 1 (review 573, 2026-10-17)

The coordinator's mail ruled on review 573's six findings at `97493f9b2`. F1: the absorb applies at the SIGTERM call only (D-5335). F2: case 3 gains an EINVAL arm against an exited, unreaped leader, and mutation row T20-M5 joins the table. F3: `_t20_racing` bound-waits for the `Z` member after its real SIGKILL, through the same `_t20_await_zombie` the first answer uses. F4, F5 and F6 correct this plan's prose: "Not in this wave", the Risk note and case 2's title, and the proof shard.

- [x] **Step 1 (red first).** Case 4 is new: `the absorb is the SIGTERM call's alone: at the SIGKILL, an EPERM against an exited, unreaped leader raises (D-5335)`. Its fake `killpg` swallows the SIGTERM, so the leader (`sleep 30`) outlives the grace. At the SIGKILL it makes the real call, waits with `waitid(WNOWAIT)` until the leader has exited unreaped, and answers EPERM, Darwin's answer for that group of zombies.
  **Measured at `97493f9b2` with the new rows:** `1 failed | 3 passed | 184 skipped`. Case 4 is red, reading `kill: returned` with signals `[15, 9]`. Case 3's new `einval` arm is already green there, because the old code raises every errno but EPERM.

## Readings (for the coordinator to rule)

1. **The proof.** Is a green row 64 on the dispatched full run's macOS leg (`test-macos 2/4`, job 117447659194, on run 39050387114, where row 64 ran and passed) enough proof of the fix, given that the cause is a hypothesis? The coordinator proposes yes: row 64 is the measured failure, and it goes green or it does not.
2. **`_group_alive`.** Leave it unchanged, by the argument in "Not in this wave"? The coordinator proposes yes.
3. **No plan attack lenses ran.** The memory cap killed them. The held-out review panel reads this plan with the wave.
