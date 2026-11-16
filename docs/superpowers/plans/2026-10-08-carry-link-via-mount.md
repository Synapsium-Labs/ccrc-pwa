# #317: the sidecar carry links through a common mount, and a copy says why and how much. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** On a box where each `~/.claude-*` is its own bind mount of one filesystem, a sidecar carry should link
instead of copying whenever a second, read-write mount of that filesystem exposes both account roots. Any carry
that still copies should say why and how many bytes, in swap.log, on stderr and in `deploy/measure-continuity.py`.
This is issue #317's proposal items 1 and 2, the scope the operator set in the issue's comment. Items 3 (drop the
source) and 4 (`carry-dedupe`) are not part of it, and neither is the doctor check this plan first carried as its
Task 6 (dropped by the operator at dispatch; a follow-up, below).

**Architecture.**
- There is one route function, written in Python inside the carry's one embedded program. `_swap_carry_merge_walk`'s
  heredoc becomes `_carry_py`, which runs in one of two modes, `walk` or `route`.
- The route runs **lazily**. It is computed only after a direct link has already failed, so a box where linking
  works runs exactly today's code.
- It reads the kernel's own `/proc/self/mountinfo` and proves an alias before using it: the alias must have the same
  `(st_dev, st_ino)` as the original. Only then does ccd link through it.
- When the copy fallback runs, it names a cause from a closed vocabulary and the bytes it copied.

**Tech stack:** Bash (`ccd/ccd`), Python 3 (embedded walker, `deploy/measure-continuity.py`), vitest 4.

**Inputs:**
- Issue #317 and its scope comment.
- Spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md`: §1.2 item 1, §5.1, §8 and §9.
- Two candidate designs, A and B, judged below.

---

## 0. The judgement: what was taken from A, from B, and what neither had

**Chosen mechanism.** The base is B: lazy, verified and in Python, with B's cause vocabulary and B's walker protocol (rows
before an unchanged `merged` row). Several ideas come from A, and five things are new.

**Taken from A:**
- Read `/proc/self/mountinfo` directly, not `findmnt -J`. There is no util-linux dependency and no JSON schema to
  drift. The test seam `CCD_MOUNTINFO` defaults to an absent fixture path in the harness, so no test ever reads the
  CI host's table.
- No Darwin special case: an absent table answers `mounts-absent`. This is what lets every geometry test run on
  test-macos.
- Octal decoding, plus the component-boundary and stacked-mount cases.
- The stderr warning.
- Two regression pins: "the transcript is still copied" and "diverged rows name account paths".

**Corrections to A:**
- A places its route in the platform block. That block's whole contract is "EVERY FUNCTION BELOW IS THE GNU
  COMMAND, VERBATIM, ON LINUX", and its byte-identity pin would also drag about 60 lines into `ccrc`.
- A routes eagerly, so new code runs on every carry.
- A collapses three conditions that have different remedies into its answers:
  - "the alias cannot be stat'ed" and "the alias is a different directory" both become one word;
  - a link that fails through a verified alias becomes `link-failed`.

**Corrections to B:**
- B gives Darwin a shortcut: equal devices answer `link-failed`. That contradicts B's own claim that its geometry
  rows run on test-macos: on a Mac every via-route case would answer `link-failed`, because the fixture's two roots
  share one device.
- `findmnt -J` adds a dependency and a JSON format that can drift.

**New, in neither design:**
- **A mount *beneath* either tree, or stacked over an alias path, rules the alias out.** A mount at or under a
  sidecar would make the alias show different content. This was measured on a real kernel: a bind mount inside a
  source sidecar carried the mounted file correctly only because the route refused.
- **`ccd/ccd` must be restamped after every edit** (`bash ccd/ccrc restamp ccd/ccd`; `server/test/ownership.test.ts`).
- **`server/test/dtbd.test.ts` fails on any concrete placeholder token in a tracked file**, so placeholders never
  reach a commit.
- **The route's output is NUL-delimited**, because a mount point can contain `\012`.
- **A route that crashes inside the walk is contained.** Without the catch, the whole merge turns into `(kept: error)`
  (measured).

### Verified, not taken on trust

**Root cause, on a real kernel** (a container's 6.12 kernel, a tmpfs mounted whole at a path holding a space, and two
binds of its subdirectories at `~/.claude` and `~/.claude-d`):
- Both roots have one `st_dev`.
- `ln` and `os.link` between the binds fail with `EXDEV`. The same link through the whole mount succeeds, with a
  shared inode.
- `cp -al` builds the whole directory skeleton, fails on every file, and returns rc 1.
- **Today's `_swap_carry_sidecars` logs `(copy)`** on a first carry (two inodes) **and `(merged +1 ~0 !0)`** on a
  merge (two inodes).

**A prototype of this plan**, on the same kernel:

| scenario | logged |
|---|---|
| first carry | `(link: via-mount)`, nlink 2 |
| merge | `(merged +1 ~0 !0, via-mount 1)`, shared inode |
| read-only whole mount | `(copy: exdev-no-root 9 bytes)` |
| forged table pointing at a decoy | `root-mismatch`, nothing written to the decoy |
| other filesystem | `exdev-other-fs` |
| mount point 0700 for a non-root user | `root-unreachable` |
| bind mount inside the source sidecar | `root-mismatch`, mounted content carried |
| mount point holding a space | escape decoding verified (`\040`, `\134`) |

**Checked for the tests:**
- GNU `du -sb` charges directories 0. BSD `cp -al` links on macOS.
- `unshare -Urm` with `mount --bind` works for an unprivileged user where user namespaces are allowed, and gets EPERM
  where they are not, which is why the real-kernel case is probe-gated.

## 1. What was read (origin/main `852c0451`)

**`ccd/ccd`:**
- The platform block: `_plat_devino`, `_plat_bytes`, `_plat_cp_replace`.
- `_pr_py`'s fd-3 idiom.
- The environment-override rule (`CCD_DISK_FLOOR_GB`'s comment).
- `_swap_carry_jsonl` (copy-not-link).
- THE CARRY MERGES (the NAMED COST at its foot); `CARRY_MERGE_BUDGET`; `_carry_slot_take`.
- `_swap_carry_merge_walk`: the table, the QUICK CHECK, the `absent` arm, the summary row.
- `_swap_carry_sidecars`: the header, with "every carry since the move logs `(copy)`"; the merge parse; the first carry.
- `cmd_swap`'s calls.

**Elsewhere:**
- `deploy/measure-continuity.py` (`CARRY`, `MERGED`, `carry_counts`).
- Tests:
  - `ccdWsHelpers.ts`: `ghContainedEnv`, `makeCcdHarness`;
  - `tmpHelpers.ts`: `mkTmp` (already resolves the path);
  - `ccd-swap.test.ts`, `ccd-swap-carry-merge.test.ts`, `measure-continuity.test.ts`, `macos-platform.test.ts`;
  - `session-hook.test.ts`'s citation corpus, which cites no `ccd/ccd` line in the carry region, so these edits
    move no anchor;
  - `dtbd.test.ts`.
- Docs: the README's carry section; the spec's header, §1.2, §5.1, §8 and §9; the programme ledger
  `docs/superpowers/programs/session-continuity.md`; CONTRIBUTING.md and CLAUDE.md.

## 2. Root cause

`link(2)` and `linkat(2)` return `EXDEV` whenever the two paths resolve through different **vfsmounts**. This holds even
when both are the same superblock (`do_linkat`: `old_path.mnt != new_path.mnt`).

Each `~/.claude-X` is a separate bind mount of one volume, so every carry between two accounts crosses mounts:
- a first carry's `cp -al` fails; ccd clears the skeleton and runs `cp -a`;
- the merge walk's `os.link` fails, and it falls back to `copy2`.

ccd never asks whether a third mount (the volume mounted whole) exposes both paths. The fallbacks are also silent:
- a first carry logs only `(copy)`;
- a merge's `+N` counts links and copies together;
- no byte count appears anywhere.

## 3. The design

### 3.1 `route(a, b)` in the carry program (Python)

`route(a, b)` answers `('via', a2, b2)` or `('none', cause)`. In order:

1. `os.stat` both paths. If the devices differ, the answer is `exdev-other-fs`.
2. Read `os.environ.get('CCD_MOUNTINFO') or '/proc/self/mountinfo'` as bytes.
   - `FileNotFoundError` gives `mounts-absent`. This is macOS, or a Linux box without `/proc`.
   - Any other `OSError`, or no line that parses, gives `mounts-unreadable`.
   - Parsing: split each line on single spaces. A row must have a `-` field at index 6 or later.
   - Each row keeps four things: `majmin = f[2]`, `root = unesc(f[3])`, `target = unesc(f[4])`, and `rw` (whether
     `rw` is in `f[5].split(',')`).
   - `unesc` replaces each `\NNN` octal escape with its byte, then `os.fsdecode`s the result.
3. Take `ra, rb = realpath(a), realpath(b)` and find the mount holding each.
   - The holding mount is the longest `target` that is a **component-boundary** ancestor:
     `anc == '/' or p == anc or p.startswith(anc + '/')`.
   - When two rows have the same target, the later row in the table wins (`>=`).
   - If either path has no holding mount, the answer is `mounts-unreadable`.
   - If the destination's holding mount is read-only, the answer is `link-failed`: `link(2)` refuses there with
     `EROFS` before it compares mounts, and no route may get around a read-only mount (review of #317).
   - If one mount holds both, the answer is `root-mismatch` when a mount sits strictly inside either tree (only that
     mount can have refused the link), and `link-failed` otherwise (review of #317).
   - If the two holding mounts have different `majmin`, the answer is `exdev-other-fs`.
4. Work out where each path sits inside the filesystem: `v = holder.root + (r − holder.target)`.
5. The candidates are rows that are on the same `majmin`, are `rw`, and have a `root` that is a component-boundary
   ancestor of both `v`s. They are ordered by longest `root` first, then by `target`. For each candidate:
   - **Build the aliases.** `a2 = target + (va − root)`, and `b2` the same way.
   - **Skip the candidate when another mount is stacked over an alias path.** That is when `holder(a2)` or
     `holder(b2)` is a different row.
   - **Refuse it when a mount sits inside a tree.** That is any row whose `target` lies strictly under `ra`, `rb`,
     `a2` or `b2`. This is noted as `root-mismatch`, because the alias would not show the same tree.
   - **Note an alias that cannot be stat'ed** as `root-unreachable`.
   - **Use the alias only on proof.** When `(st_dev, st_ino)` of `a2` equals `a`'s, and `b2`'s equals `b`'s, the
     answer is `('via', a2, b2)`.
   - **Otherwise** note `root-mismatch`.
6. When no candidate is proved, the answer is `root-mismatch` if any candidate was a mismatch; otherwise
   `root-unreachable` if any was unreachable; otherwise `exdev-no-root`.

`safe_route` wraps `route` so that any exception becomes `route-error`, with the cause on stderr.

**Route mode output.** The `route` mode writes three NUL-terminated byte fields to `sys.stdout.buffer`, using
`os.fsencode` and not the `backslashreplace` stdout the walk uses. The fields are `via a2 b2`, or `none <cause>` and an
empty third field.

**The vocabulary is spelled once, in Python:** `CARRY_CAUSES = ('exdev-other-fs', 'exdev-no-root', 'root-unreachable',
'root-mismatch', 'root-failed', 'mounts-absent', 'mounts-unreadable', 'link-failed', 'route-error')`. The program
unpacks it into named constants (`EXDEV_OTHER_FS`, …, `ROUTE_ERROR`) and every answer names one, so a misspelling is a
`NameError`, not a new word in swap.log (review of #317: the first cut re-typed each word as a literal at about fifteen
sites). The bash side sets only its `route-error` default and `root-failed`. Three census cases pin it: R10b (every
bash `CARRY_ROUTE=` word is in the tuple), R10c (every member is produced by some case, and no case produces another
word) and R10d (no cause-shaped literal in the program outside the tuple line; the walk's action kinds, read from its
own `queue()` calls, are the only other hyphenated words).

### 3.2 First carry (`_swap_carry_sidecars`)

- `cp -al "$src" "$dst"` runs first, unchanged.
- **On failure:**
  1. Clear the skeleton.
  2. Call `_carry_link_route "$src" "$dstcfg/projects/$pdir"`. It sets the caller's local `CARRY_ROUTE`/`CARRY_A2`/`CARRY_B2`,
     in the same caller-scope idiom as `CARRY_SLOT_FD`. It reads the fields with three `IFS= read -r -d ''` calls,
     and it accepts a cause only when the word matches `^[a-z][a-z-]*$`.
  3. On `via`, run `cp -al "$CARRY_A2" "$CARRY_B2/$uuid"`.
     - Success logs `(link: via-mount)`.
     - Failure **clears `$dst` again** and sets `CARRY_ROUTE=root-failed`.
  4. If nothing linked, run `cp -a`, then `b=$(_plat_bytes "$dst")`, or `?` when that refuses.
  5. Log `(copy: <cause> <b> bytes)` and print `ccd: warn: sidecar <uuid> carried to <dst> as a COPY (<cause>, <b> bytes)`
     on stderr.
- The anti-nesting rule and the total-failure branch are unchanged.

### 3.3 Merge walk (the `absent` arm)

- `os.link(sp, dp)` runs first, as today.
- **On `OSError e`:**
  - If `e.errno == EXDEV`: compute `memo = safe_route(src, dst)` once per walk. On `via`, run
    `os.link(a2/rel, b2/rel)`: success counts `via += 1`, and a failure is `root-failed`. Otherwise the cause is the
    route's own.
  - Any other errno is `link-failed`.
- A copy keeps today's temp-and-rename and counts `copied[cause] += [1, st_size]`.
- Everything else (the compares, `mkparents`, `~R`, the `diverged` rows) keeps the **account** paths.
- A `diverged` row writes a newline in a path as `\n`, so every row is one line the walk printed whole, and no file
  name can forge a `via` or `copied` row (review of #317: a file named `x<newline>via 9` added `, via-mount 9`).
- **New rows, printed before `merged`:** `via <V>`, and `copied <cause> <F> <B>` (one per cause, sorted). The `merged
  N R D K` row is unchanged, so the bash regex that reads it is too.
- **Bash appends to the log line:** `, via-mount V`, and one `, copy: <cause> <F> files <B> bytes` per cause.
  With any copy present, it also warns on stderr.

### 3.4 The swap.log grammar after this change

Each form, and what it means:
- `(link)` — unchanged: the direct link worked.
- `(link: via-mount)` — linked through the common mount.
- `(copy: <cause> <B|?> bytes)` — a first carry copied, for that cause.
- `(merged +N ~R !D[, deferred K][, via-mount V][, copy: <cause> <F> files <B> bytes]…)` — a merge, with its links
  and copies.

The legacy bare `(copy)` stays readable. The instrument's `[^()]*` is still unambiguous, because no form contains a
parenthesis.

| cause | fact | the operator's fix |
|---|---|---|
| `exdev-other-fs` | different filesystems (by `stat`, or the two holding mounts name different devices) | put both roots on one filesystem |
| `exdev-no-root` | separate mounts; no read-write mount of that filesystem exposes both | mount the filesystem, or a directory above every account root, read-write at a second path |
| `root-unreachable` | the alias could not be stat'ed | give the fleet user search permission along the common mount's path |
| `root-mismatch` | the alias is another directory, or a mount sits inside a tree (also when one mount holds both) | inspect `findmnt`: a mount inside an account tree makes every carry of it copy; nothing was written through the alias |
| `root-failed` | the link failed through a verified alias | check that the filesystem is writable, and for EMLINK, ENOSPC or a quota |
| `mounts-absent` | no table: expected on macOS; on Linux, no `/proc` | nothing on macOS; on Linux, mount `/proc` |
| `mounts-unreadable` | the table could not be read, no line parses, or no mount holds a tree | check the fleet user can read `/proc/self/mountinfo`; otherwise report it |
| `link-failed` | the link failed on one mount (EMLINK, ENOSPC, EPERM), or the destination's mount is read-only | check the disk and the link counts, and whether the destination root is mounted read-only |
| `route-error` | python3 is missing (nothing on stderr), the route program crashed (its exception on stderr), or it answered outside its shape (nothing on stderr) | read the swap's stderr; with no crash line, install python3 if the box has none, else report it |

### 3.5 The instrument

**`measure-continuity.py`'s `carry_counts`** reads every form above and adds keys only:
- `link_via_mount` and `merged_via_mount`;
- `copy_legacy`, for bare `(copy)`, and `copy_unsized`, for `?`;
- `copy_by_cause{cause:{first_carries, merged_files, bytes}}`;
- `copied_bytes{first_carry, merge}`.

`by_mode` still counts every new form as `link`, `copy` or `merged`, and never as `other`.

### 3.6 Deliberately unchanged

- Transcripts keep copy semantics, because they are appended to (`_swap_carry_jsonl`'s header).
- `~R` replacements stay temp-and-rename copies.
- The task-list `cp -r` is unchanged.
- The budget still prices an absent file at its size, even when it will link.
- No new ccd verb, no `CCD_LINK_ROOT` knob, and no change to the wire or to `FLEET_PROTO`.

## 4. Global constraints (every task)

- **Fixture HOMEs only.** Never run ccd against the live `$HOME`. Real fleet paths, devices and mount points never
  enter the repo; fixtures use `0:99`, `vol` and `-w-quiet-mesa`.
- **Foreground runs, one file per process:**

  ```
  ( cd server && ./node_modules/.bin/vitest run test/<file> --maxWorkers=1 )
  ```

  Never use bare `npx`.
- **After every `ccd/ccd` edit**, run `bash ccd/ccrc restamp ccd/ccd`, then `ownership.test.ts` and
  `macos-platform.test.ts`.
- **After any README edit**, run the five citation cases:

  ```
  ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
  ```

  Write no `file:line` anchors in new README text.
- **Comments.** Every new function opens with a reasoning comment at ccd's density, citing its deviation number.
- **Re-measure at dispatch.** Other in-flight runs edit `ccd/ccd`. Before Task 2:
  - run `git log --oneline origin/main -- ccd/ccd`;
  - re-anchor the carry region by content.

  Land by `git merge origin/main` (never a rebase). On a conflict in the stamp line, take either side and restamp.

## 5. Tasks

### Task 1: The test rig, and the route's geometry tests (red: no route exists)

**Files:**
- New `server/test/fixtures/fakeMountKernel.ts`.
- `server/test/ccdWsHelpers.ts`: `makeCcdHarness`'s `sh`.
- New `server/test/ccd-carry-link-route.test.ts`.

- [ ] **The harness seam.** `ccdWsHelpers.ts` exports `FIXTURE_MOUNTINFO = '.fixture-mountinfo'`. `sh` passes
  `CCD_MOUNTINFO: path.join(home, FIXTURE_MOUNTINFO)` before `...env`, so a test can override it, and `''` restores
  the real table.
  - Comment why: the CI host's table must never decide a verdict.
- [ ] **`fakeMountKernel.ts`, the single definition of the fake.** It exports:
  - `mountRow({id, majmin, root, target, opts})`, with octal escaping;
  - `bindFixture(home, {common: 'rw'|'ro'|'none', decoy?, vol?, extra?})`. It builds `.claude*` as real directories,
    and `vol/home/.claude*` as **symlinks** back to them, so each alias is a different string that `-ef`s the
    original, exactly as a bind mount behaves. It writes the table and returns `env`.
  - `plantFakeKernel(home)`. It writes `<home>/.fake-kernel/sitecustomize.py` and returns `{env, cpStub}`.
- [ ] **What the fake kernel does.** `os.link` raises `EXDEV` when the two *lexical* absolute paths sit under different
  fixture mounts (the longest mount point at a component boundary). Its knobs are environment variables:
  - `FAKE_KERNEL_MOUNTINFO`, the table it reads;
  - `FAKE_LINK_ERRNO=<name>`, which forces that errno on every link;
  - `FAKE_ROUTE_CRASH=1`, which makes `os.path.realpath` raise `RuntimeError`.

  The `cpStub` is a bash `cp()` that fails `-al` with `mkdir -p "$3"`, either when the source and the destination's
  parent are on different fake mounts, or when `FAKE_CP_AL_FAIL=1` is set. Every other `cp` call runs the real `cp`.
- [ ] **Red: the `_carry_link_route` geometry cases.** Each calls the function directly and prints
  `$CARRY_ROUTE|$CARRY_A2|$CARRY_B2`.

  | case | expected |
  |---|---|
  | R1 | `via`, with the exact alias paths |
  | R2 | a path through a symlink still routes `via` (needs `realpath`) |
  | R3 | a root of `/home/.cl` is not an ancestor: `exdev-no-root` |
  | R4 | two rows on one target, `ro` then `rw`: `via`, because the later row wins |
  | R5 | a mount stacked over `vol/home`: `exdev-no-root` |
  | R6 | one mount: `link-failed` (R6b: one mount, and a mount inside a tree: `root-mismatch`) |
  | R7 | a garbage table: `mounts-unreadable` (R7b: no row holds the path; R7c: a directory where the table should be, a non-ENOENT read error) |
  | R8 | an absent table: `mounts-absent` |
  | R9 | differing devices (`/dev/shm` when `crossDevice`, else skipped): `exdev-other-fs` (R9b: the table's two holders on different devices, every platform) |
  | R10 | each route-mode word is in `CARRY_CAUSES` (R10b: the bash side's words too) |
  | R11 | the destination root's own mount read-only, a common mount present: `link-failed` |
  | R10c, R10d | at the file's foot: every `CARRY_CAUSES` member produced by some case and no other word; no cause-shaped literal in the program outside the tuple |

  - **How it fails:** `_carry_link_route: command not found`, so `CARRY_ROUTE` is empty in every case.
- [ ] **Verify:** `( cd server && ./node_modules/.bin/vitest run test/ccd-carry-link-route.test.ts --maxWorkers=1 )`. It must be red.

### Task 2: The route (`_carry_py` route mode and `_carry_link_route`)

**Files:** `ccd/ccd`. Rename `_swap_carry_merge_walk`'s body to `_carry_py() { python3 /dev/fd/3 "$@" 3<<'PY' … }`, keep
`_swap_carry_merge_walk() { _carry_py walk "$@"; }`, and add `_carry_link_route`.

- [ ] Move `argv` to the mode-first form. Add `CARRY_CAUSES`, `unesc`, `mounts`, `under`, `holder`, `route` and
  `safe_route` exactly as §3.1 gives them, and the `route` mode output.
- [ ] Write the header comment. It must say:
  - the vfsmount rule, and that it was measured;
  - why the route is lazy;
  - why it reads `mountinfo` and not `findmnt`;
  - that the inode proof is the safety property: a wrong table costs a copy, never a link into another tree (the
    proof covers the roots; the content beneath them rests on the table listing every mount, which the kernel's
    always does — narrowed in the review of #317);
  - the TOCTOU residue;
  - that `CCD_MOUNTINFO` is a harness seam, like `CCD_RECLAIM_RESIDUE_ROOT`, which satisfies the reason
    `CCD_DISK_FLOOR_GB`'s comment gives for an override (it cannot aim a write at another tree);
  - why there is no `CCD_LINK_ROOT`: who triggers a swap must not decide link vs copy.
- [ ] Restamp.
- [ ] **Verify:** Task 1's file passes. Also run `ccd-swap-carry-merge.test.ts`, which must stay unchanged and green
  (the walk's argv move), `ownership.test.ts` and `macos-platform.test.ts`.

### Task 3: The first carry links through the route, and a copy says why

**Files:** `ccd/ccd` (`_swap_carry_sidecars`'s first-carry block, and its header),
`server/test/ccd-carry-link-route.test.ts` (the carry describe), and `server/test/ccd-swap.test.ts`.

- [ ] **Red: carry cases**, all through `bindFixture` and `plantFakeKernel`:

  | case | expected |
  |---|---|
  | C1 | `(link: via-mount)`, a shared inode, and no `<uuid>/<uuid>` |
  | C2 | no common row: `(copy: exdev-no-root N bytes)`, with N ≥ the planted bytes and differing inodes |
  | C3 | a read-only common mount: `exdev-no-root` |
  | C4 | a decoy (real directories under `vol`): `root-mismatch`; the real bytes land; the decoy is unchanged |
  | C5 | an absent table: `mounts-absent` |
  | C6 | a mount point holding a space and a backslash: `via-mount` |
  | C7 | a row inside the source sidecar: `root-mismatch` |
  | C8 | `vol/home` chmod 000 (skipped as root): `root-unreachable` |
  | C9 | `FAKE_CP_AL_FAIL=1`: `root-failed`, no nest, and the content landed |
  | C10 | no fake kernel but a routable table: `(link)`, never via (the laziness pin) |
  | C11 | a copy prints the `COPY` warning on stderr |
  | C12 | `command -v python3` fails: the `route-error` default, the tree still copied and sized |
  | C13 | `_carry_py` dies before it answers: `route-error` |
  | C14 | `_plat_bytes` fails: `(copy: exdev-no-root ? bytes)` |
  | C15 | the program answers a cause that is not one lowercase word: `route-error` |
  | C16 | the program answers `via` with aliases that are not directories: `route-error`, nothing made through them |

  **How they fail on today's `ccd/ccd`:** `(copy)` in C1–C9 and C11. C10 is the control, and it is green before
  and after.
- [ ] **Red: `ccd-swap.test.ts`.**
  - **Update** "falls back to a full copy without nesting" to expect `/\(copy: mounts-absent \d+ bytes\)/`.
    The harness default makes it the same on Linux and macOS.
  - **New** "`cmd_swap` links the sidecar through the common mount, and the transcript is still a copy". It needs the
    fixture plus the fake kernel; the sidecar inode is shared, the transcript inode differs. Today's code fails the
    sidecar half.
- [ ] **Implement §3.2.** Rewrite the header sentence "every carry since the move logs `(copy)`" and the NAMED COST
  as dated history plus the new behaviour.
- [ ] Restamp.
- [ ] **Verify:** `ccd-carry-link-route.test.ts`, `ccd-swap.test.ts`, `ccd-swap-pin.test.ts` and
  `ccd-account-ok.test.ts` (the last two stub `_swap_carry_sidecars`).
- [ ] **Real kernel (gated).** Add an `itLinux` case guarded by a probe: `unshare -Urm sh -c 'mount -t tmpfs t "$1"' _ <dir>`
  must exit 0. Inside `unshare -Urm`, it mounts a tmpfs and two binds, sources ccd with `CCD_MOUNTINFO=''`, runs a
  first carry and a merge, and expects `via-mount` with shared inodes. A control asserts that a direct `ln` fails.
  - The PR records whether the case ran. GitHub's ubuntu-24.04 runners restrict user namespaces, so CI skips it.

### Task 4: The merge walk links through the route, and counts its copies by cause

**Files:** `ccd/ccd` (the walker's `absent` arm and summary rows, the table's absent row, the QUICK CHECK, and the
merge-parse block), `server/test/ccd-swap-carry-merge.test.ts`, and the new route file's merge describe.

- [ ] **Red: merge cases:**

  | case | expected |
  |---|---|
  | M1 | `(merged +1 ~0 !0, via-mount 1)`, shared inode |
  | M2 | no common row: `(merged +1 ~0 !0, copy: exdev-no-root 1 files 7 bytes)` |
  | M3 | `FAKE_LINK_ERRNO=EMLINK`: `copy: link-failed 1 files 7 bytes` (only `EXDEV` routes) |
  | M4 | a same-size, different-content file older than the routed one, so its `diverged` row is written AFTER the alias link: it names the account paths, `via-mount 1`, and no alias path reaches swap.log |
  | M5 | `FAKE_ROUTE_CRASH=1`: `copy: route-error 1 files 7 bytes`, and the merge still lands |
  | M6 | copies of one cause are one clause, files and bytes summed: `copy: exdev-no-root 2 files 9 bytes` |
  | M7 | `FAKE_LINK_ERRNO=EXDEV`, so the link through the proved alias fails too: `copy: root-failed 2 files 9 bytes`, and the walk keeps merging |
  | M8 | no fake kernel over a routable table: `(merged +1 ~0 !0)`, never routed (the walk's laziness pin) |
  | M9 | a diverged file named `x<newline>via 9`: no `via-mount`, the row written with `\n` |
  | M10 | diverged files named `via 9` and `copied link-failed 5 5`: nothing counted (the anchors) |

  - **Update** the `/dev/shm` case to expect `(merged +1 ~0 !0, copy: exdev-other-fs 1 files 2 bytes)`.
  - **How they fail today:** the bare `(merged +1 ~0 !0)` / `(merged +1 ~0 !1)`.
- [ ] **Implement §3.3.** In the `rows` loop, parse the `via` and `copied` rows with anchored regexes.
- [ ] Restamp.
- [ ] **Verify:** both carry files, plus `ccd-swap.test.ts`.

### Task 5: The instrument reads the new grammar

**Files:** `deploy/measure-continuity.py` (the stage-1 header block, `MERGED`, `carry_counts`), and `server/test/measure-continuity.test.ts`.

- [ ] **Red, end-to-end.** Run the real carry through the fake kernel: a first carry via-mount, a first carry with no
  common row, and a merge with one copy. Then:
  - `by_mode.other` must be 0;
  - `link_via_mount` must be 1;
  - `copy_by_cause['exdev-no-root']` must be `{first_carries:1, merged_files:1, bytes:≥…}`.
- [ ] **Red, synthetic.** Run a log of every form, including legacy `(copy)` and `?` bytes, and check
  `copy_legacy`, `copy_unsized` and `copied_bytes`.
  - **How they fail today:** the new forms land in `other`.
- [ ] **Implement §3.5's keys.** Parse causes generically, as `[a-z-]+`.
- [ ] **Verify:** `measure-continuity.test.ts`.

### Task 6: Docs, deviations, whole-branch verification

- [ ] **Docs** (below). Run the citation cases.
- [ ] **Deviation numbers.** Issued at dispatch (below). Write them into the spec amendments and the ccd comments.
  Then run `git fetch origin main`, `deviation-refs.test.ts` and `dtbd.test.ts`.
- [ ] **Whole-branch run, one file per process:**
  - `ccd-carry-link-route`, `ccd-swap`, `ccd-swap-carry-merge`, `ccd-swap-pin`, `ccd-account-ok`;
  - `measure-continuity`, `ownership`, `macos-platform`;
  - `single-definition`, `deviation-refs`, `dtbd`, `topology-clean`, plus the citation cases;
  - and every file `.github/ci/select-tests.mjs` selects for the branch's diff.
- [ ] **Real-kernel transcript for the PR.** A privileged Linux container with python3 and the repo mounted read-only:
  mount a tmpfs at a path holding a space, add two binds, and run a first carry and a merge with the branch's
  `ccd/ccd`. Paste the inode lines into the PR.
- [ ] **PR.** Confirm that CI's `select tests` lists the new test file and `measure-continuity.test.ts`.
- [ ] **Deploy.** Deploy AGENT-FIRST, with `ccrc rollout` taking the fleet box first.

## Mutation-table plan

Every row was re-measured on the branch (macOS; each mutation applied alone, the named suites run, then restored).
The predicted reds all held; the measured column adds what else went red. The column was measured again after the
review of #317 added its cases (R6b, R7c, R11, R10c, R10d, C12–C16, M7–M10), so it names those too; R9 and the
real-kernel case are skipped on macOS, and C8 runs (not root).

| guard | mutation | reds (predicted) | measured |
|---|---|---|---|
| inode proof | `if True:` | C4 decoy | C4 |
| `rw` filter | drop `c[3]` | C3 | C3 |
| a mount inside a tree | `if False:` | C7 | C7 |
| component boundary | `p.startswith(anc)` | R3, R5, C2, C3, M2 | R3, R5, C2, C3, C14, M2, M6, M9, M10, R10c |
| octal decoding | `unesc` = identity | C6 | C6 |
| stacked mounts, later row wins | `>=` → `>` | R4 | R4, R11 |
| only `EXDEV` routes | `if True:` | M3 | M3 |
| the second clear | drop it | C9: nest present | C9 |
| `realpath` | `ra, rb = a, b` | R2 | R2, M5 (`FAKE_ROUTE_CRASH` patches `os.path.realpath`) |
| alias holder check | `if False:` | R5 | R5 |
| byte count | drop `$b bytes` | C2–C9 | C2–C5, C7–C9, C11–C16, R10c, and ccd-swap's nest case (C6 links) |
| route-crash containment | `safe_route` → `route` in the walk | M5: becomes `(kept: error)` | M5 |
| laziness | route before the direct `cp -al` | C10 | C10 |
| the walker's via link | drop it | M1 | M1, M4 |
| the copy warnings | drop the first carry's / the merge's `echo … >&2` | C11 / M2 | C11 / M2 |
| the merge copy clause | drop `csuf+=…` | M2 | M2, M3, M5, M6, M7, M9, M10, and measure-continuity's end-to-end case (the `/dev/shm` case is Linux-only) |
| a cause outside the vocabulary | the final `exdev-no-root` returned as a misspelt literal | R10 | R3, R5, R10, C2, C3, C14, M2, M6, M9, M10, R10c, R10d |
| the bash census | `CARRY_ROUTE=root-failed` misspelt | R10b | R10b, C9, R10c |
| the harness seam | drop the `CCD_MOUNTINFO` default | the ccd-swap nest case on Linux, which turns into `link-failed` (macOS is green either way) | on macOS: ccd-swap green, as predicted, but R1–R7c, R9b, R11 and R10c red (they write their table at the seam's default path; R8 is green either way, R9 skipped) |
| the instrument's parse | the old `MERGED` | Task 5 cases | both Task 5 cases |
| *review of #317:* the walk's `root-failed` word | `cause = ROOT_FAILED` → `LINK_FAILED` | M7 | M7 |
| *review:* the walk's `root-failed` catch | `except OSError` → `except ZeroDivisionError` (the walk dies: `(kept: error)`) | M7 | M7 |
| *review:* aliases never replace the account paths | after the alias link, `src, dst = r[1], r[2]` | M4 | M4 |
| *review:* the `route-error` default | `CARRY_ROUTE=` (empty) | C12, C13 | C12, C13, C15, C16 |
| *review:* the `?` byte count | drop `&& [[ "$b" =~ ^[0-9]+$ ]] \|\| b='?'` | C14 | C14 |
| *review:* a table that cannot be read | the non-ENOENT `OSError` → `MOUNTS_ABSENT` | R7c | R7c |
| *review:* the walk is lazy | the walk routes before its direct `os.link` | M8 | M8 |
| *review:* the alias must be a directory | the bash `-d` check → `true` | C16 | C16 |
| *review:* a cause is one lowercase word | the bash cause filter → `true` | C15 | C15, R10c |
| *review:* a newline in a diverged path | `row_path` returns the path raw | M9 | M9 |
| *review:* the `via` anchor | drop `^` | M10 | M9, M10 |
| *review:* the `copied` anchor | drop `^` | M10 | M10 |
| *review:* a read-only destination mount | `if not mb[3]:` → `if False:` | R11 | R11 |
| *review:* one mount, a mount inside a tree | `ROOT_MISMATCH if inside(…) else LINK_FAILED` → `LINK_FAILED` | R6b | R6b |
| *review:* a cause literal re-typed | `cause = ROOT_FAILED` → `cause = 'root-failed'` | R10d | R10d |
| *review:* a member no case produces | add `'never-made'` to the tuple (and its name to the unpack) | R10c | R10c |

## Edge cases, macOS, back-compat

- **Safety rests on the inode proof.** A stale table, an overmount or a forged `CCD_MOUNTINFO` can only cause a copy,
  never a link into another tree (measured: the decoy was untouched). The proof covers the two roots; the content
  beneath them rests on the table listing every mount inside the trees, which the kernel's own always does, so only
  a hand-made table that left one out could link the file such a mount hides (narrowed in the review of #317).
- **Known limitation: a read-only SOURCE mount is not checked.** The route refuses a read-only destination
  (`link-failed`), but a read-only source root still routes: the link writes only the destination's directory, yet
  the source inode gains a writable name. No such mount exists on the fleet; left as a named limitation.
- **The residue is TOCTOU.** A mount operation between the proof and the link can still redirect it. Only root can do
  that, the window is narrow, and it is named in the header.
- **Mount namespaces:** `/proc/self` is the namespace that links. None of the shipped units sets
  `PrivateMounts`/`Protect*` (checked `ccd/` and `deploy/`). A sandboxed caller that cannot see the whole mount copies,
  and the log names it.
- **macOS:** the route runs only when a link fails. With no table, the answer is `mounts-absent`. Every rig case runs
  on test-macos (C8 skips as root). The real-kernel case is Linux and probe-gated.
- **Back-compat:**
  - Only `measure-continuity.py` parses sidecar modes (checked with `git grep swap.log`), and it ships in this PR.
  - An old instrument would count the new forms as `other`.
  - No wire, `FLEET_PROTO` or server change.
- **Shared inodes return** (the state before the bind-mount move): appends are shared. Spec §5.1 already judges this
  harmless, and `(link: via-mount)` is the evidence.

## Deviations found

Two departures, issued by the allocator at dispatch and defined here, in the commit that first cites them.

- **D-4500** `carry-links-through-common-mount` (Tasks 2–4) — amends spec §5.1 and §1.2 item 1. "absent →
  hardlink, or copy when linking fails" becomes "…, else through a verified common mount on `EXDEV`, else a copy";
  "The first carry to an account keeps today's path unchanged" is reversed for failures: the direct `cp -al` is
  unchanged, but its failure now routes before copying. §1.2 item 1's "every first carry since 2026-09-22 is
  `(copy)`" becomes dated history. The route is lazy, reads the kernel's mount table, and links through an alias
  only once its inode is proved equal to the original's. *Extended by the review of #317 (same number):* a read-only
  destination holding mount answers `link-failed` and is never routed around; when one mount holds both trees, a
  mount inside either tree answers `root-mismatch` rather than `link-failed`; and the program names every cause only
  through constants unpacked from `CARRY_CAUSES`. A read-only SOURCE mount stays unchecked, a named limitation.
- **D-4501** `carry-copy-says-why` (Tasks 3–5) — changes the swap.log grammar (§3.4), adds the stderr warning, and
  adds the instrument's keys (§3.5). Amends §5.1's "The log line becomes…" and §9's stage-1 row, which gains copy
  bytes by cause. *Extended by the review of #317 (same number):* the walk writes a newline in a `diverged` path as
  `\n`, so no file name can forge a `via` or `copied` row into the verdict, and the cause table's remedies cover every
  condition each word stands for.

The plan's original third departure, a doctor check that reads a ccd log, was dropped with its task and holds no number.

## Docs to touch

- **README.** §"A return visit merges the session's sidecar": the route, the grammar, and the cause table (§3.4).
  No `file:line` anchors.
- **Spec.**
  - A rev-9 header line.
  - Dated amendments to §1.2 item 1 and §5.1.
  - §8: the stale-table and TOCTOU failure modes.
  - §9: stage 1 gains "sidecar bytes copied, by cause", with a target of `exdev-*` at 0 on a box with a common
    read-write mount.
- **`deploy/measure-continuity.py`'s stage-1 header comment.**
- **The programme ledger.** A dated entry citing #317, the two numbers, and the deploy order.
- **`ccd/ccd` comments.** Rewrite the NAMED COST, the sidecar header, the walker table's absent row and the QUICK
  CHECK as dated history plus the new behaviour. The stale "one environment override" comment was first left alone;
  the review of #317 rewrote it to state the rule rather than a count, and `CCD_MOUNTINFO`'s header cites the rule.
- **CLAUDE.md:** no change.

## Risks, and what is deliberately out of scope

**Risks:**
- **The whole-volume mount may not be read-write, or traversable, for the fleet user** in every caller (a shell, the
  unit, the agent). Then every carry logs `exdev-no-root` or `root-unreachable`. That is loud, and it is no worse
  than today. The read-only check to run before deploy: `stat -c %d:%i` of each `~/.claude-X` against its path under
  the whole mount. Verified by the operator at dispatch: each account root and its path under the whole mount have
  identical `dev:inode`, the mount is read-write for the fleet user, and the units have no private mount namespace.
- **`du` over-counts per account** once inodes are shared.
- **Overlap with in-flight `ccd/ccd` waves:** re-anchor and restamp when merging.

**Out of scope:**
- Dropping the source after a carry (issue item 3).
- `carry-dedupe`, which is the only way to reclaim the space the existing copies hold: a merge sees those copies as
  equal and never relinks them.
- Transcript bytes, which are copied on purpose.
- Linking `~R` replacements.
- Pricing a link at zero in the budget.
- A ccd route verb.
- `CCD_LINK_ROOT`.

**Follow-ups:**
- **Doctor `carry`** (this plan's dropped Task 6): a check reading the last seven days of swap.log's sidecar lines,
  one WARN per cause seen with that cause's own remedy, PASS on links only, SKIP on a server-role box, no log, or no
  carry from this build; never FAIL. It needs its own deviation number when it is planned.
- #317 items 3–4.

## PR description outline

1. **Title:** `ccd: carry sidecars by link through a common mount; a copy says why and how much (#317 items 1–2)`.
2. **The problem, measured:** the root cause (vfsmount `EXDEV`), and the real-kernel transcript: today's `(copy)`
   against the branch's `(link: via-mount)`, with inode lines.
3. **The mechanism:** the route is lazy; it reads mountinfo; it proves an alias by inode before linking; it refuses a
   mount over or inside a tree; it is one Python program with two modes.
4. **The grammar and the cause table.** Additive; the instrument ships alongside.
5. **Not changed:** transcripts, `~R`, existing copies, the budget's pricing.
6. **Tests:** the rig (simulated binds, the fake kernel, the harness seam), the case list, and the mutation table as
   measured, along with whether the real-kernel case ran.
7. **Deploy:** AGENT-FIRST, the pre-deploy read-only check, and how to verify afterwards (`--stage 1 --json`).
8. **The deviations**, D-4500 and D-4501.
9. **Follow-ups:** doctor `carry`; #317 items 3–4.
10. The Claude Code footer line.
