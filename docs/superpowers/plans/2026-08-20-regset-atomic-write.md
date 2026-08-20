# `_reg_set` Atomic Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every write of a `~/.cc-sessions/<id>.<field>` registry file atomic — a reader never
observes a half-written or empty field — without ever letting the NAME disappear.

**Architecture:** `_reg_set` stops truncating in place. It writes the value to a temporary file **in
`$REG` itself** (same directory, therefore same filesystem) and `mv -fT`s it onto the destination.
`rename(2)` replaces the destination atomically: a concurrent reader sees either the whole old
content or the whole new content, and never an ENOENT. The three writers that bypass the helper
today (`_substrate_mark`, `_ws_unsupervise`, `_ws_archive`'s manifest) are migrated onto it; the
fourth, `_pr_py`'s embedded-python `put()`, gets the identical discipline in python
(`os.replace`) because it cannot call a bash function.

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, **no `-e`**), GNU coreutils `mv`, embedded
python3, vitest (`server/test/*.test.ts`) driving ccd through fixture HOMEs.

**Spec:** none as a standalone file. The wave brief is the spec and is reproduced verbatim in the
program ledger — `docs/superpowers/programs/registry-durability.md` on
`origin/docs/registry-durability-ledger`, section "Next-wave brief". Wave 1's deviation ledger,
which this wave's carried minors come out of, is
`docs/superpowers/plans/2026-08-20-fleetio-measured-read.md` on `main`.

## Global Constraints

- **`ccd/ccd` is agent-side bash: EVERY commit touching it re-stamps the provenance marker IN THAT
  COMMIT.** From the repo root, before `git add`:
  `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`
- **ccd tests run ONLY against fixture HOMEs** (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`).
  Never run ccd against the live `$HOME`. `HOME` is the single isolation boundary the suite has.
- **Suites run from inside the package, foreground, timeout ≥ 600000 ms:**
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. **Never bare `npx vitest`** — it
  resolves a global copy with no jsdom and falsely reports "no tests".
- **TDD red-first.** Every new guard ships with a test that goes RED when the guard is deleted or
  mutated, and the plan's Deviations section records the measured before/after counts.
- **Known load-flaky suites** — `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
  `ccd-session-state`. Re-run in ISOLATION before calling a real break.
- **Commit on this workspace's own branch (`ws/plain-ridge`).** Never cut a `feat/*` branch: the
  done-fingerprint re-measures this branch's tip, and work parked elsewhere wedges the close
  `stale-tip` for ever.
- **Deviation ledger is global and monotonic.** Wave 1 ended at **D-120**; this wave starts at
  **D-121**.
- **Out of scope:** merging, deploying (the coordinator's, agent-first), any new ccd verb, and any
  registry READ-side semantic change beyond the four comment fixes in Tasks 6–9.

---

## Survey (the brief's FIRST TASK)

### S1 — the invariant that must survive, stated explicitly

D-112 (wave 1) reads a measured-`absent` `.hold` as a PROVEN release and short-circuits on it —
`buildRecord` drops a row on a single measured-`absent` identity field with no second listing at
all. That is only sound because **a registry field's name never disappears while its row is alive**.

- **Today** the name never disappears because `_reg_set` is `printf '%s' "$3" > "$REG/$1.$2"`:
  `>` truncates an existing file and creates a missing one. It never unlinks. The window it DOES
  open is a **content** window — zero bytes, or a prefix of the new value — never an ENOENT.
- **After this change** the name still never disappears, for a stronger reason: `rename(2)` is
  specified to replace the destination atomically, and POSIX requires that the destination path
  remain resolvable to either the old or the new inode throughout — *"if the link named by the new
  argument exists, it shall be removed and old renamed to new… [the] new argument shall not be
  removed"*. **There is NO ENOENT window at any point.** The tmp is created under a DIFFERENT name,
  so the destination name is untouched until the instant it flips.

The change therefore strictly narrows what a reader can observe: the empty/partial read disappears
and nothing takes its place. **`_reg_set` must never unlink its destination** — that is the one
line of this wave that D-112 rests on, and Task 1's structural test pins it.

### S2 — every `_reg_set` call site (37 lines, `ccd/ccd`)

Definition at `ccd/ccd:368`. Callers, by field:

| field | sites | note |
|---|---|---|
| `started` | `384` (`_reg_claim`, the ONE writer; 8 call sites go through it) | pinned by `ccd-reg-claim.test.ts` |
| `home` | `507` (`_ws_seed_home`, guarded by `[[ -f ]]`), `9319` | |
| `wrapper` | `1597`, `8469`, `9290` | |
| `project` | `1597`, `8470` | |
| `workdir` | `1598`, `8471` | |
| `uuid` | `1598`, `7279`, `8471` | **also `_pr_py`'s flock target — see S5** |
| `workspace`/`base`/`branch` | `1599`, `1600`, `2166` | |
| `setup` | `1617`, `1619` | |
| `hold` | `2334` | **exit status is load-bearing**: `|| die "…it is NOT held"` |
| `archived`/`archivedreason` | `2509`, `2510` | |
| `reaping` | `6138`, `6382`, `6461`, `6500` | ordering contract, see `_reg_purge` |
| `lastswap`/`lastcompact` | `7582`, `7616`, `7661`, `9291` | read by guarded arithmetic (D-B8-3) |
| `spawn` | `8143` | |
| `supervised` | `8631`, `8690`, `8701`, `9025`, `9206`, `9296` | **the heartbeat — every ~30 s per session** |
| `swapblocked` | `9072` | |

**Cost.** The heartbeat is the hot caller: one `_reg_set` per session per ~30 s. Today that is one
`open`/`write`/`close`. After the change it is `open`/`write`/`close` + `rename` — one extra
in-directory syscall, no fork, no subprocess (`mv` IS a fork; see Task 1's note on why it is
accepted). No caller changes its semantics.

### S3 — every direct `> "$REG/…"` write that bypasses the helper

| site | field | disposition |
|---|---|---|
| `ccd/ccd:542` `_ws_unsupervise` | `stopped` | **MIGRATE** (Task 3). `printf '%s %s' a b` is exactly `_reg_set`'s value with the join done at the call site. Byte-identical. |
| `ccd/ccd:503` `_substrate_mark` | `substrate` | **MIGRATE** (Task 2). First-write-wins is an `[[ -e "$f" ]]` guard ABOVE the write and is unaffected by how the write lands. |
| `ccd/ccd:2464` `_ws_archive_manifest` | `archivemanifest` | **MIGRATE, byte-preserving** (Task 4). It writes `printf '%s\n'` — a TRAILING NEWLINE `_reg_set` does not add. The newline moves into the value (`"$manifest"$'\n'`) so the bytes on disk are unchanged. |
| `ccd/ccd:1143` `_pr_py`'s `put()` | `prphase`, `prnumber`, `prcheckedat` | **MIGRATE IN PYTHON** (Task 5). It cannot call a bash function; it gets `os.replace` with the same tmp scheme. |
| `ccd/ccd:7322,7325,7583,7617,7662,8882,8963,8978,9073,9173,9295` | `$REG/swap.log` | **NOT A FIELD, NOT MIGRATED.** An append-only operator log, `>>`, never read by the registry ladder, never keyed `<id>.<field>`. Atomic replacement is the wrong primitive for an append. |
| `ccd/ccd:1283` `_pr_py` prhistory append | `prhistory` | **NOT MIGRATED** — `open(..., 'a')`, append-only ledger, same reasoning as `swap.log`. Replacing it atomically would destroy the append semantics `_ws_archive_manifest` folds in. |
| `ccd/session-hook.sh:143-145` | `hookstate.json` | **ALREADY ATOMIC.** `tmp="$REG/.$id.$$.hookstate.tmp"; printf … > "$tmp"; mv -f "$tmp" "$f"`. This is the in-tree precedent this wave generalises; its dotted tmp name is where Task 1's scheme comes from. Not touched. |

Nothing outside `ccd/` writes into `$REG`: `agent/src/whitelist.ts:82-83` allows **writes to
`.cc-clips` only** — `.cc-sessions` is read-only over the wire, so neither the server nor the agent
is a writer at all.

### S4 — tmp visibility: every reader of `$REG`'s directory listing

**Scheme chosen: `$REG/.<id>.<field>.<BASHPID>.<seq>.tmp`** — leading dot, trailing `.tmp`, and the
FIELD NAME IS NEVER THE LAST COMPONENT. Both properties are load-bearing and each closes a different
reader class.

*bash globs (no `dotglob` anywhere in ccd) — a leading dot is invisible:*

| site | pattern | verdict |
|---|---|---|
| `ccd/ccd:454` `_reg_purge` | `"$REG/$id".*` | invisible (leading dot ⇒ no prefix match) |
| `ccd/ccd:1382` `_ws_slug_free` | `"$REG/$id".*` | invisible — **and this is the safe direction**: a leaked tmp must not wedge a slug |
| `ccd/ccd:1395` `_ws_slug_residue` | `"$REG/$id".*` | invisible |
| `ccd/ccd:3077, 6812` | `"$REG"/*.workspace` | invisible (leading dot) AND no `.workspace` suffix |
| `ccd/ccd:9451, 9482` | `"$REG"/*.uuid` | invisible (leading dot) AND no `.uuid` suffix |
| `ccd/ccrc:667` `_box_sessions` | `"$reg"/*.uuid` (nullglob) | same, twice over |
| `ccd/ccrc-adopt:433` | `"$HOME"/.cc-sessions/*.wrapper` | same, twice over |

`ccd/ccd:5656` already states this property in the tree for the reap lock: *"the registry is read
through `$REG/*.workspace` and `$REG/$id.<field>`, and a dotfile matches neither"*.

*node `readdir` — DOES return dotfiles, so each consumer is proved individually:*

| site | what it does with the listing | verdict |
|---|---|---|
| `server/src/registry.ts:762` `readRegistryMeasured` | `names.filter(n => n.endsWith('.uuid'))` | ignores — a tmp ends `.tmp`. **This is why the field name may never be the last component.** |
| `server/src/registry.ts:807, 873` second listings | `again.includes('<id>.hold' / '<id>.uuid')` | exact name |
| `server/src/registry.ts:540-674` `buildRecord` | `names.includes(`${id}.${f}`)` throughout | exact name |
| `server/src/registry.ts:869` `readSessionRecord` | `names.includes(`${id}.uuid`)` | exact name |
| `server/src/limits.ts:118` | `regNames.filter(n => n.endsWith('-disabled'))` | ignores — no field name ends `-disabled` |
| `server/src/watch.ts:838` snapshot guard | `names.includes(`${id}.uuid`)` | exact name |
| `server/src/watch.ts:1727` mail sweep kill-switch | `listing.includes(MAIL_DISABLED_MARKER)` | exact name |
| `server/src/watch.ts:1557 → divergence.ts:220` `unclaimedWorktrees` | `n.lastIndexOf('.')`, adds the prefix to `claimedById` | **the one reader that does not ignore it** — see the residual below |
| `server/src/server.ts:551` `knownId` | `names.includes(`${id}.uuid`)` | exact name |
| `server/src/coord/dispatch.ts:189` | `names.includes(COORDINATOR_PAUSE_MARKER / MAIL_DISABLED_MARKER)` | exact name |
| `server/src/coord/routes.ts:413, 569` | `names.includes(`${id}.uuid`)` | exact name |
| `server/src/coord/prhistory.ts:98` | `listing.includes(`${id}.prhistory`)` | exact name |
| `server/src/watch.ts:902` / `emitCoord` | consumes `RegistryRead.names`, exact marker names | exact name |

`server/src/tasks/read.ts:56`, `lifecycle.ts:111-135`, `transcript/resolve.ts:212` and
`coord/gitref.ts:264` list OTHER directories, not `$REG`.

**The one residual, named rather than assumed away.** `unclaimedWorktrees` splits every listing entry
at its LAST dot and adds the prefix to `claimedById`. A live tmp therefore contributes the string
`.<id>.<field>.<pid>` to that set. It is inert: `ccdIdForWorktree` yields `<project>-<slug>` and
`_ws_slug_valid` forbids a leading dot, so the spurious entry can never equal a real ccd id. The
DIRECTION if it ever did is toward SUPPRESSING an "unclaimed worktree" finding on a report-only
kind, never toward a false repair — `ws-gc --prune` is human-only by contract either way. Recorded
as **D-127**.

### S5 — `.uuid` is a lock file, and rename makes it inode-unstable

`_pr_py` takes `fcntl.flock` on **`$REG/<id>.uuid`** (`ccd/ccd:1256`), whose own comment says *"an
existing file, opened read-only, never written here"*. True of that block — but `_reg_set "$id"
uuid` writes it from THREE bash sites (`1598`, `7279`, `8471`), and `8471` is on the ordinary
supervise/start path.

`flock` attaches to an **open file description**, i.e. to an INODE. Truncate-in-place keeps the
inode, so two concurrent `ccd pr-state` runs contend the same lock even across a uuid rewrite.
`rename` replaces the inode: a run that opened the old inode and one that opens the new inode would
BOTH hold `LOCK_EX`, and the compare-and-set that lock exists to serialise (`prcheckedat` /
`prnumber` / `prhistory`) would run twice concurrently — exactly the duplicate-ledger-append and
lost-update pair `ccd/ccd:1287-1300` documents.

**Fix (Task 5): move the lock onto a dedicated file that is never replaced and never unlinked —
`$REG/.prstate-<id>.lock`** — the identical idiom and identical reasoning as the reap lock at
`ccd/ccd:5659` (`$REG/.reap-$id.lock`, *"THE LOCK FILE IS NEVER UNLINKED"*). Recorded as **D-123**.

### S6 — measured facts that shape the implementation

Both measured on this box during the survey, GNU coreutils 9.4:

1. **`mv -f tmp <a directory>` SUCCEEDS at rc 0**, moving the tmp *inside* the directory. `mv -fT`
   refuses with rc 1 (`cannot overwrite directory … with non-directory`). `ccd-hold.test.ts:125`
   ("a failed registry write REFUSES") creates a DIRECTORY at `$REG/<id>.hold` precisely because it
   is the any-uid stand-in for a write failure — so a naive `mv -f` turns that existing test red and
   reintroduces the "`held <id>` on stdout with no hold on disk" lie. **`-T` is mandatory.**
   Recorded as **D-121**.
2. **`$REG` at mode 0500:** `printf > reg/existing.field` still SUCCEEDS (write permission lives on
   the file, not the directory); creating `reg/.tmp` fails `Permission denied`. So updating an
   EXISTING field under a read-only registry directory used to work and now refuses. The direction
   is fail-shut — `cmd_ws_hold` already dies on a non-zero `_reg_set` — and a registry directory
   nothing may create a file in is a broken registry either way. Recorded as **D-122**.

---

## File Structure

- `ccd/ccd` — `_reg_set` (368), `_substrate_mark` (~503), `_ws_unsupervise` (~542),
  `_ws_archive_manifest` (~2464), `_pr_py`'s `put()` + lock (~1143, ~1256). One file, five edits.
- `server/test/ccd-reg-set-atomic.test.ts` — **new.** The whole atomicity contract: bytes, inode
  replacement, no unlink, tmp invisibility, both refusal paths.
- `server/test/ccd-substrate.test.ts`, `server/test/ccd-archive.test.ts`,
  `server/test/ccd-pr-state.test.ts` — existing files, one added test each for the migrated writer.
- `server/test/single-definition.test.ts` — m1.
- `server/src/io.ts`, `agent/src/fileops.ts` — m2 (comments only).
- `server/src/watch.ts` — m3 (comment only).
- `server/test/push-copy.test.ts` — m4 (comment only).

---

### Task 1: `_reg_set` writes through a tmp file and renames

**Files:**
- Modify: `ccd/ccd:368` (the one-line `_reg_set` body)
- Test: `server/test/ccd-reg-set-atomic.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `_reg_set <id> <field> <value>` — unchanged signature, unchanged bytes on disk,
  unchanged exit-status contract (0 iff the value is on disk under its own name). New guarantee: the
  destination is REPLACED, never truncated, and is never unlinked. New tmp path shape
  `$REG/.<id>.<field>.<BASHPID>.<seq>.tmp`, removed on both failure paths.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-reg-set-atomic.test.ts`:

```ts
// server/test/ccd-reg-set-atomic.test.ts
//
// Wave 2 of the registry-durability program. `_reg_set` used to be
// `printf '%s' "$3" > "$REG/$1.$2"` — truncate-then-write, so a reader that
// opened the file inside the window read ZERO BYTES or a prefix of the new
// value. The registry's whole read side (wave 1's measured reads included)
// treats a field's bytes as a fact; a torn field is a fact that was never
// true.
//
// THE INVARIANT D-112 RESTS ON SURVIVES, and this file pins it: the NAME
// never disappears. Truncation never unlinked; rename(2) replaces the
// destination atomically and POSIX requires the new path stay resolvable
// throughout. There is no ENOENT window before or after this change — which
// is why `buildRecord` may keep dropping a row on a single measured-`absent`
// identity field with no second listing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const ccd = readFileSync(CCD, 'utf8');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-regset-'); });
afterEach(() => { h.cleanup(); });

const REG = (hh: CcdHarness): string => path.join(hh.home, '.cc-sessions');

describe('_reg_set writes atomically', () => {
  it('writes the value BYTE-EXACT, with no trailing newline', () => {
    // The pre-existing contract, pinned first: every reader in the tree
    // (`_reg_get`, `field()` in registry.ts) is written against a file whose
    // bytes are exactly the value. An implementation that gained a newline
    // would break `.uuid` matching and every `-eq`/`=~` guard downstream.
    h.sh(`_reg_set demo-quiet-basin wrapper claude2`);
    expect(readFileSync(path.join(REG(h), 'demo-quiet-basin.wrapper'), 'utf8')).toBe('claude2');
  });

  it('REPLACES the inode rather than truncating it — a reader that already opened the file still sees whole, OLD bytes', () => {
    // THE MECHANISM, and the one assertion that cannot be satisfied by the
    // old body. fd 9 is opened on the old inode; `_reg_set` renames a new
    // inode over the name. Under rename the fd still reads the complete old
    // value. Under truncate-in-place the SAME fd reads the new value (or, in
    // the real race, nothing at all) — which is precisely the torn read.
    const out = h.sh(`_reg_set demo-quiet-basin hold 'program:evals wave:1/4'
      exec 9< "$REG/demo-quiet-basin.hold"
      _reg_set demo-quiet-basin hold 'program:evals wave:2/4'
      printf 'through-fd:[%s] on-disk:[%s]' "$(cat <&9)" "$(cat "$REG/demo-quiet-basin.hold")"
      exec 9<&-`);
    expect(out).toContain('through-fd:[program:evals wave:1/4]');
    expect(out).toContain('on-disk:[program:evals wave:2/4]');
  });

  it('never unlinks its destination — the name is resolvable at every instant (D-112 rests on this)', () => {
    // Structural, because the window it denies is sub-millisecond and cannot
    // be sampled reliably. `_reg_set`'s body must contain no `rm` of the
    // destination and no redirection INTO the destination: the only thing
    // that may touch `$REG/$1.$2` is the rename.
    const body = /_reg_set\(\)\s*\{([\s\S]*?)\n\}/.exec(ccd)?.[1] ?? '';
    expect(body, '_reg_set must be a multi-line function by now').not.toBe('');
    expect(body, 'nothing may unlink the destination').not.toMatch(/rm\s+[^\n]*"\$REG\/\$1\.\$2"/);
    expect(body, 'nothing may redirect into the destination').not.toMatch(/>\s*"\$REG\/\$1\.\$2"/);
    expect(body, 'the destination is reached by rename only').toMatch(/mv\s+-[a-zA-Z]*T[a-zA-Z]*\s/);
  });

  it('leaves NO tmp file behind on the success path, and its tmp is invisible to every registry glob', () => {
    h.sh(`_reg_set demo-quiet-basin uuid u1
          _reg_set demo-quiet-basin workspace quiet-basin
          _reg_set demo-quiet-basin wrapper claude`);
    const all = readdirSync(REG(h));
    expect(all.filter((n) => n.endsWith('.tmp')), 'a success-path write must clean up after itself').toEqual([]);
    // The two shapes every consumer keys on. A tmp that ended in the field
    // name would mint a phantom session id in `readRegistryMeasured`
    // (`names.filter(n => n.endsWith('.uuid'))`), which is the failure this
    // naming scheme exists to prevent.
    expect(all.filter((n) => n.endsWith('.uuid'))).toEqual(['demo-quiet-basin.uuid']);
    // And ccd's own globs: `_ws_slug_residue` lists exactly the real fields.
    expect(h.sh('_ws_slug_residue demo quiet-basin').split(', ').sort())
      .toEqual(['uuid', 'workspace', 'wrapper']);
  });

  it('REFUSES when the registry directory cannot be written, and leaves no tmp', () => {
    // The `chmod 500 "$REG"` class, which `cmd_ws_hold`'s `|| die` depends on.
    h.sh(`_reg_set demo-quiet-basin uuid u1`);
    const r = h.sh(`chmod 500 "$REG"; _reg_set demo-quiet-basin wrapper claude; printf 'rc=%s' "$?"; chmod 700 "$REG"`);
    expect(r).toContain('rc=1');
    expect(existsSync(path.join(REG(h), 'demo-quiet-basin.wrapper'))).toBe(false);
    expect(readdirSync(REG(h)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('REFUSES when the destination is a DIRECTORY — it must never move the tmp inside it', () => {
    // MEASURED (GNU coreutils 9.4): `mv -f tmp <dir>` succeeds at rc 0 and
    // puts the tmp INSIDE the directory. That is a false success, and
    // `ccd-hold.test.ts`'s "a failed registry write REFUSES" uses exactly
    // this state as its any-uid stand-in for a write failure. `-T`
    // (--no-target-directory) is what makes the refusal real; drop it and
    // this test and that one both go red.
    mkdirSync(path.join(REG(h), 'demo-quiet-basin.hold'));
    const r = h.sh(`_reg_set demo-quiet-basin hold 'program:evals wave:1/4'; printf 'rc=%s' "$?"`);
    expect(r).toContain('rc=1');
    expect(statSync(path.join(REG(h), 'demo-quiet-basin.hold')).isDirectory()).toBe(true);
    expect(readdirSync(path.join(REG(h), 'demo-quiet-basin.hold')), 'the tmp must not have been moved inside').toEqual([]);
    expect(readdirSync(REG(h)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('two writers of DIFFERENT fields in one process do not collide on a tmp name', () => {
    // The tmp carries the field and a per-process sequence, so no two writes
    // — same process or not — ever name the same tmp. A collision would make
    // one of the two `mv` calls fail ENOENT and return 1, which at
    // `cmd_ws_hold` is a false "NOT held".
    const r = h.sh(`_reg_set demo-quiet-basin uuid u1 & _reg_set demo-quiet-basin wrapper claude & wait
                    printf '[%s][%s]' "$(_reg_get demo-quiet-basin uuid)" "$(_reg_get demo-quiet-basin wrapper)"`);
    expect(r).toContain('[u1][claude]');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-reg-set-atomic.test.ts`
Expected: FAIL. Specifically — `REPLACES the inode` fails (the fd reads the NEW value),
`never unlinks its destination` fails (`_reg_set` is a one-liner, so the body regex finds nothing
and the `mv -T` assertion misses), and `REFUSES when the destination is a DIRECTORY` PASSES already
(today's `printf > dir` is EISDIR) — record that it passes before and must still pass after.

- [ ] **Step 3: Write the implementation**

Replace `ccd/ccd:368` with:

```bash
# ATOMIC BY RENAME (registry-durability wave 2). The old body was
# `printf '%s' "$3" > "$REG/$1.$2"` — truncate-then-write IN PLACE, so any
# reader that opened the file inside the window read ZERO BYTES or a prefix of
# the new value. The registry's read side treats a field's bytes as a fact, and
# a torn field is a fact that was never true. Write to a tmp in THE SAME
# DIRECTORY (hence the same filesystem, hence a real rename(2) rather than a
# copy) and rename it into place: every reader sees the whole old value or the
# whole new one.
#
# D-112'S INVARIANT SURVIVES AND IS STRONGER HERE. `buildRecord` drops a row on
# a single measured-`absent` identity field with no second listing, which is
# only sound if the NAME never disappears. Truncation never unlinked; rename
# never unlinks either — POSIX requires the destination path stay resolvable to
# the old or the new inode throughout. There is NO ENOENT WINDOW at any point,
# before or after this change. Nothing in this function may `rm` the
# destination.
#
# `-T` (--no-target-directory) IS NOT OPTIONAL. Measured, GNU coreutils 9.4: a
# plain `mv -f tmp "$REG/$id.hold"` where `$REG/$id.hold` is a DIRECTORY exits
# 0 having moved the tmp INSIDE it — a false success on the one field whose
# silent absence is destructive (`cmd_ws_hold` reads this exit status and dies
# on it, and `ccd-hold.test.ts` uses exactly that directory as its any-uid
# stand-in for a failed write). With `-T` it exits 1, as `printf > dir` did.
#
# THE TMP NAME: leading dot, trailing `.tmp`, field never last. The dot keeps
# it out of every bash glob in the tree (`$REG/*.uuid`, `$REG/*.workspace`,
# `$REG/$id.*` — none match a dotfile without `dotglob`, which nothing sets),
# and the `.tmp` suffix keeps it out of node's `readdir`, which DOES return
# dotfiles: `readRegistryMeasured` mints session ids from
# `names.filter(n => n.endsWith('.uuid'))`, so a tmp ending in the field name
# would mint a phantom session. `$BASHPID` separates concurrent supervisors
# (and background subshells of one shell, where `$$` would not); the sequence
# separates two writes by one shell. Same shape and same reason as
# `session-hook.sh`'s own `$REG/.$id.$$.hookstate.tmp`.
#
# A SIGKILL between the write and the rename leaks one tmp file, forever:
# `_reg_purge`'s glob cannot see a dotfile, and giving it a second glob that
# could would let one session's purge delete another session's IN-FLIGHT tmp
# (ids may nest — see `_reg_purge`'s own note) and turn that write into a false
# refusal. Disclosed rather than swept: an inert few bytes, the same price
# `$REG/.reap-$id.lock` already pays for a lock whose identity is an inode.
_REG_SET_SEQ=0
_reg_set() {   # id field value -> 0 iff the value is on disk under its own name
  local tmp
  _REG_SET_SEQ=$(( _REG_SET_SEQ + 1 ))
  tmp="$REG/.$1.$2.$BASHPID.$_REG_SET_SEQ.tmp"
  printf '%s' "$3" > "$tmp" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  mv -fT -- "$tmp" "$REG/$1.$2" || { rm -f -- "$tmp"; return 1; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-reg-set-atomic.test.ts`
Expected: PASS, all 7.

- [ ] **Step 5: Run every suite that drives `_reg_set`, and the whole ccd surface**

Run, foreground, in this order:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-hold.test.ts test/ccd-reg-claim.test.ts \
  test/ccd-arith-containment.test.ts test/ccd-substrate.test.ts test/ccd-session-state.test.ts \
  test/ccd-archive.test.ts test/ccd-ws-reap.test.ts test/ccd-ws-gc.test.ts test/registry.test.ts
```

Expected: PASS. `ccd-hold`'s "a failed registry write REFUSES" is the cross-check on `-T`;
`ccd-arith-containment` is the cross-check that a hostile VALUE is still fully quoted.
`ccd-ws-gc` and `ccd-session-state` are known load-flaky — re-run either IN ISOLATION before
calling it a break.

- [ ] **Step 6: Re-stamp provenance and commit**

```bash
cd /home/you/worktrees/ccrc-pwa/plain-ridge
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-reg-set-atomic.test.ts
git commit -m "fix(ccd): _reg_set writes through a tmp and renames — no torn registry field"
```

---

### Task 2: `_substrate_mark` writes through the helper

**Files:**
- Modify: `ccd/ccd:503` (the `printf … > "$f"` line in `_substrate_mark`)
- Test: `server/test/ccd-substrate.test.ts` (add one test)

**Interfaces:**
- Consumes: `_reg_set` from Task 1.
- Produces: nothing new. `$REG/<id>.substrate` keeps its exact bytes (`<epoch> <why> (client …;
  server …)`) and its first-write-wins semantics.

- [ ] **Step 1: Write the failing test**

Append to the first `describe` in `server/test/ccd-substrate.test.ts`:

```ts
  it('rides `_reg_set`, so the marker is written atomically like every other field', () => {
    // Wave 2. `_substrate_mark` used to write `printf … > "$f"` directly,
    // which is the torn-read window `_reg_set` no longer has. FIRST-WRITE-WINS
    // is unaffected: the `[[ -e "$f" ]]` guard sits ABOVE the write and asks
    // about the DESTINATION, which rename replaces without ever unlinking.
    const src = readFileSync(CCD, 'utf8');
    const body = /_substrate_mark\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(body, 'nothing may redirect into the marker path any more').not.toMatch(/>\s*"\$f"/);
    expect(body).toMatch(/_reg_set "\$id" substrate/);
    // And the guard is still there, still ahead of the write.
    expect(body.indexOf('[[ -e "$f" ]] && return 0'))
      .toBeGreaterThanOrEqual(0);
    expect(body.indexOf('[[ -e "$f" ]] && return 0'))
      .toBeLessThan(body.indexOf('_reg_set "$id" substrate'));
  });
```

`ccd-substrate.test.ts` already imports `readFileSync` and `path`; add `CCD` to its import from
`./ccdWsHelpers.js` if it is not there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-substrate.test.ts`
Expected: FAIL — `nothing may redirect into the marker path any more`.

- [ ] **Step 3: Write the implementation**

In `_substrate_mark`, replace the final line

```bash
  printf '%s %s' "$(date +%s)" "$why (client ${client:-unknown}; server ${server:-unreachable})" > "$f"
```

with

```bash
  # Through `_reg_set` (wave 2), so the marker cannot be read half-written like
  # any other field. FIRST-WRITE-WINS is untouched: the `[[ -e "$f" ]]` guard
  # above asks about the DESTINATION name, which rename replaces atomically and
  # never unlinks — there is no instant at which a second supervisor's guard
  # could see the marker missing and re-record a later onset.
  _reg_set "$id" substrate "$(date +%s) $why (client ${client:-unknown}; server ${server:-unreachable})"
```

`local f="$REG/$1.substrate"` stays: the `[[ -e "$f" ]]` guard still reads it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-substrate.test.ts`
Expected: PASS — including the pre-existing `the FIRST write WINS` byte-identical assertion and
`the reason is NEVER empty`.

- [ ] **Step 5: Commit**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-substrate.test.ts
git commit -m "fix(ccd): _substrate_mark rides _reg_set"
```

---

### Task 3: `_ws_unsupervise`'s `stopped` stamp writes through the helper

**Files:**
- Modify: `ccd/ccd:542`
- Test: `server/test/ccd-session-lifecycle.test.ts` (add one test)

**Interfaces:**
- Consumes: `_reg_set` from Task 1.
- Produces: nothing new. `$REG/<id>.stopped` keeps its exact bytes: `<epoch> <surface>`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-session-lifecycle.test.ts`:

```ts
describe('the stop stamp rides _reg_set (registry-durability wave 2)', () => {
  it('writes "<epoch> <surface>" through the helper, not a bare redirection', () => {
    // `_ws_unsupervise` is the single choke point for ws-rm / ws-archive /
    // ws-reap / forget / cmd_stop, and `stopped` is what tells `stopped` from
    // `orphan` in §4.3's ladder. A torn read there reclassifies a session that
    // somebody deliberately stopped.
    const src = readFileSync(CCD, 'utf8');
    const body = /_ws_unsupervise\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(body).not.toMatch(/>\s*"\$REG\/\$id\.stopped"/);
    expect(body).toMatch(/_reg_set "\$id" stopped "\$\(date \+%s\) \$surface"/);
  });

  it('and the bytes are unchanged — epoch, one space, the validated surface word', () => {
    const h = makeCcdHarness('ccrc-ccd-stopstamp-');
    try {
      h.sh(`systemctl() { :; }; date() { [[ "$1" == +%s ]] && echo 1755620112 || command date "$@"; }
            _ws_unsupervise demo-quiet-basin pwa`);
      expect(h.reg('demo-quiet-basin', 'stopped')).toBe('1755620112 pwa');
    } finally { h.cleanup(); }
  });
});
```

Add whatever of `readFileSync` / `CCD` / `makeCcdHarness` that file does not already import.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-session-lifecycle.test.ts`
Expected: FAIL on the first of the two.

- [ ] **Step 3: Write the implementation**

Replace

```bash
  printf '%s %s' "$(date +%s)" "$surface" > "$REG/$id.stopped"
```

with

```bash
  # Through `_reg_set` (wave 2): the two words are one value, so the join moves
  # to the call site and the bytes on disk are unchanged. `_session_state` reads
  # this field to tell a deliberate stop from an orphan — a half-written stamp
  # is a session reclassified.
  _reg_set "$id" stopped "$(date +%s) $surface"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-session-lifecycle.test.ts test/ccd-session-state.test.ts`
Expected: PASS. `ccd-session-state` is known load-flaky (`mid-carry:orphan` vs
`mid-carry:restarting`) — re-run in isolation before calling a break.

- [ ] **Step 5: Commit**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-session-lifecycle.test.ts
git commit -m "fix(ccd): the stop stamp rides _reg_set"
```

---

### Task 4: the archive manifest writes through the helper, byte-for-byte

**Files:**
- Modify: `ccd/ccd:2464`
- Test: `server/test/ccd-archive.test.ts` (add one test)

**Interfaces:**
- Consumes: `_reg_set` from Task 1.
- Produces: nothing new. `$REG/<id>.archivemanifest` keeps its **trailing newline** — the newline
  moves from `printf '%s\n'` into the value.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-archive.test.ts`:

```ts
describe('the archive manifest is written atomically (registry-durability wave 2)', () => {
  it('rides _reg_set and KEEPS its trailing newline — the bytes do not move', () => {
    // The manifest was `printf '%s\n' "$manifest" > …`, and `_reg_set` adds no
    // newline of its own, so the newline is passed IN THE VALUE. Its one
    // consumer (`manifestBytes`, server/src/registry.ts:363) runs JSON.parse
    // and would not notice either way — which is exactly why the bytes are
    // preserved deliberately rather than by luck: a migration that also
    // changes what is on disk is two changes wearing one commit.
    const src = readFileSync(CCD, 'utf8');
    expect(src).not.toMatch(/>\s*"\$REG\/\$id\.archivemanifest"/);
    expect(src).toMatch(/_reg_set "\$id" archivemanifest "\$manifest"\$'\\n'/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts`
Expected: FAIL — the redirection is still there.

- [ ] **Step 3: Write the implementation**

Replace

```bash
  printf '%s\n' "$manifest" > "$REG/$id.archivemanifest"
```

with

```bash
  # Through `_reg_set` (wave 2), with the TRAILING NEWLINE carried in the value:
  # `printf '%s\n'` put one there and `_reg_set` adds none, so passing it
  # explicitly keeps the file byte-identical. `manifestBytes` (registry.ts)
  # JSON.parses this and would tolerate either, which is the reason to be
  # deliberate rather than casual — a migration that also moves the bytes is two
  # changes in one commit.
  _reg_set "$id" archivemanifest "$manifest"$'\n'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/registry.test.ts`
Expected: PASS. `registry.test.ts` is the reader-side cross-check on `archivedBytes`.

- [ ] **Step 5: Commit**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-archive.test.ts
git commit -m "fix(ccd): the archive manifest rides _reg_set, bytes unchanged"
```

---

### Task 5: `_pr_py` writes atomically, and its lock moves off `.uuid`

**Files:**
- Modify: `ccd/ccd` — `_pr_py`'s `put()` (~1143) and its `flock` acquisition (~1255)
- Test: `server/test/ccd-pr-state.test.ts` (add two tests)

**Interfaces:**
- Consumes: nothing from Task 1 (this is python; it cannot call a bash function).
- Produces: `put(field, value)` now writes `<reg>/.<id>.<field>.<pid>.tmp` then `os.replace`s it
  onto `<reg>/<id>.<field>` — same tmp shape as `_reg_set`, same invisibility argument.
  The compare-and-set lock is `<reg>/.prstate-<id>.lock`, created on demand, **never unlinked**.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-pr-state.test.ts`:

```ts
describe('pr-state persists its fields atomically (registry-durability wave 2)', () => {
  it('put() renames rather than truncating, with the same invisible tmp shape as _reg_set', () => {
    const src = readFileSync(CCD, 'utf8');
    const put = /def put\(field, value\):([\s\S]*?)\n\n/.exec(src)?.[1] ?? '';
    expect(put, 'put() must no longer open the destination for writing').not.toMatch(/open\(os\.path\.join\(reg, id_ \+ '\.' \+ field\), 'w'\)/);
    expect(put).toMatch(/os\.replace\(/);
    expect(put, "the tmp must be hidden (leading dot) and not end in the field name").toMatch(/'\.' \+ id_ \+ '\.' \+ field \+/);
    expect(put).toMatch(/\.tmp'/);
  });

  it('the compare-and-set lock is a DEDICATED file, never the .uuid that _reg_set now replaces', () => {
    // `flock` attaches to an INODE. `_reg_set "$id" uuid` renames a new inode
    // over `.uuid` (wave 2), so two `ccd pr-state` runs straddling a uuid
    // rewrite would lock two different inodes and BOTH enter the
    // compare-and-set — the duplicate prhistory append and the lost update
    // this lock exists to prevent. A dedicated file is never replaced.
    const src = readFileSync(CCD, 'utf8');
    expect(src).not.toMatch(/lock_f = open\(os\.path\.join\(reg, id_ \+ '\.uuid'\)\)/);
    expect(src).toMatch(/\.prstate-'/);
  });

  it('still persists phase and number, and creates the lock file on first use', () => {
    // The exact idiom of `describe('binding')`'s "reports merged when every
    // conjunct holds": `GH_STUB` is a shell-function STRING prefixed to the
    // snippet, and the rows go in through `h.ghRows`.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.prstate-demo-quiet-basin.lock'))).toBe(true);
    // And the tmp is gone, and nothing it left behind can mint a session id.
    const names = fs.readdirSync(path.join(h.home, '.cc-sessions'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(names.filter((n) => n.endsWith('.uuid'))).toEqual(['demo-quiet-basin.uuid']);
  });
});
```

`ccd-pr-state.test.ts` already imports `readFileSync`? It imports `fs` and `path`; add
`import { readFileSync } from 'node:fs'` (or use `fs.readFileSync`) and add `CCD` to the existing
`./ccdWsHelpers.js` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts`
Expected: FAIL on the first two (`put()` still opens the destination; the lock is still `.uuid`).

- [ ] **Step 3: Write the implementation**

Replace `put`:

```python
    def put(field, value):
        # ATOMIC, the python half of wave 2's `_reg_set` (ccd:368). `open(…,'w')`
        # truncates in place, so a reader landing inside the window read an
        # EMPTY `prphase`/`prnumber` — and `prphase` is read by `ws-archive`,
        # which files `archivedreason merged:#N` off it. Same tmp shape and same
        # invisibility argument as `_reg_set`: leading dot (out of every bash
        # glob) and a `.tmp` suffix (out of `readRegistryMeasured`'s
        # `endsWith('.uuid')` id minting, which DOES see dotfiles).
        dst = os.path.join(reg, id_ + '.' + field)
        tmp = os.path.join(reg, '.' + id_ + '.' + field + '.' + str(os.getpid()) + '.tmp')
        try:
            with open(tmp, 'w') as f:
                f.write(str(value))
            os.replace(tmp, dst)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
```

Replace the lock acquisition:

```python
    # A DEDICATED lock file, never a registry FIELD — wave 2. `flock` attaches
    # to an open file description, i.e. to an INODE, and `_reg_set "$id" uuid`
    # (ccd:1598, 7279, 8471 — the last on the ordinary supervise path) now
    # RENAMES a new inode over `.uuid`. Two `ccd pr-state` runs straddling that
    # rewrite would take LOCK_EX on two different inodes and both enter the
    # compare-and-set below: the duplicate ledger append and the lost update
    # this lock exists to prevent. `$REG/.prstate-<id>.lock` is never written,
    # never renamed and NEVER UNLINKED — the identical idiom, for the identical
    # reason, as `$REG/.reap-$id.lock` (ccd:5659), which also explains why
    # unlinking a lock while holding it is how two processes come to hold "the
    # lock" on two inodes. Hidden by its leading dot, so no registry glob or
    # id-minting listing sees it; it leaks one 0-byte file per session that has
    # ever run pr-state, which is the disclosed price.
    #
    # UNCHANGED: if the lock cannot be taken AT ALL (no fcntl, unwritable $REG)
    # the write goes ahead unlocked. This guard may only remove races, never add
    # a refusal that stops a phase from ever updating.
    lock_f = None
    try:
        lock_f = open(os.path.join(reg, '.prstate-' + id_ + '.lock'), 'a')
        fcntl.flock(lock_f.fileno(), fcntl.LOCK_EX)
    except OSError:
        if lock_f is not None:
            lock_f.close()
        lock_f = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pr-state.test.ts test/ccd-prhistory.test.ts test/ccd-pr-open.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-pr-state.test.ts
git commit -m "fix(ccd): pr-state persists atomically and locks a dedicated file, not .uuid"
```

---

### Task 6 (m1): the absent/unreadable pair guard is order-insensitive

**Files:**
- Modify: `server/test/single-definition.test.ts:1109`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Write the failing assertion**

The guard is `const PAIR = /'absent'\s*\|\s*'unreadable'/`, which a second copy spelled
`'unreadable' | 'absent'` walks straight past. Add, inside the same `describe`:

```ts
  it('trips on EITHER ordering — a second copy spelled the other way round is still a second copy', () => {
    // Wave-1 review minor m1. The scan is a text scan, so the fingerprint has
    // to be the SET, not one spelling of it. Measured before the fix: a file
    // containing `type X = 'unreadable' | 'absent'` scored zero hits and the
    // suite stayed green.
    expect(PAIR.test("type X = 'unreadable' | 'absent';")).toBe(true);
    expect(PAIR.test("type X = 'absent' | 'unreadable';")).toBe(true);
    // Still not a bare-word scan: `WsAuditUnit = 'enabled' | 'loaded' |
    // 'absent'` must stay invisible, which is the whole reason the fingerprint
    // is a PAIR (see this describe's own header).
    expect(PAIR.test("type WsAuditUnit = 'enabled' | 'loaded' | 'absent';")).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: FAIL on the `'unreadable' | 'absent'` line.

- [ ] **Step 3: Widen the pattern**

```ts
  // ORDER-INSENSITIVE (wave-1 review minor m1). The vocabulary is a SET of two
  // words; a second copy that happens to spell them the other way round is
  // exactly the drift this scan exists to catch, and the original single
  // ordering let it through silently. Still a PAIR rather than either word
  // alone — `shared/api.ts`'s `WsAuditUnit = 'enabled' | 'loaded' | 'absent'`
  // is a legitimate lone `'absent'` and must not trip it.
  const PAIR = /'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: PASS — including the two pre-existing assertions (`declared in exactly one file` and
`registry.ts derives BranchEvidence`).

- [ ] **Step 5: Commit**

```bash
git add server/test/single-definition.test.ts
git commit -m "test(single-definition): the absent/unreadable pair guard trips on either ordering"
```

---

### Task 7 (m2): state the dangling-symlink residual where `absent` is specified

**Files:**
- Modify: `server/src/io.ts:5-10` (the `ReadFailure` docstring)
- Modify: `agent/src/fileops.ts:34-39` (the `ReadResult` docstring)

**Interfaces:** comments only. No behaviour changes, no test changes.

- [ ] **Step 1: Amend `server/src/io.ts`**

```ts
/** Why a read couldn't produce content: `absent` means the path genuinely
 *  does not exist (ENOENT); `unreadable` means everything else — EACCES,
 *  EISDIR, ENOTDIR, ELOOP, a non-errno failure — the path IS there (or the
 *  box can't even tell) and this box just can't read it. Fail-shut on
 *  purpose: only a proven ENOENT is allowed to answer `absent`.
 *
 *  ONE RESIDUAL, stated rather than closed (wave-1 review minor m2): a
 *  DANGLING SYMLINK answers `absent`. `readFile` follows the link, the
 *  TARGET is missing, and the errno is ENOENT — so a name that IS in the
 *  registry listing reads measured-absent, which is the one crack in
 *  D-112's "a proven ENOENT can only come from a purge". No ccd verb
 *  writes a symlink into `$REG`, so the state is reachable only by hand,
 *  and the direction is the safe one for every current consumer (a hold
 *  reads released, an identity field retires the row). An `lstat` ladder
 *  would close it and is deliberately NOT built: it would put a second
 *  syscall on every field read of every session on every tick to
 *  distinguish a state nothing in this system produces. */
export type ReadFailure = 'absent' | 'unreadable';
```

- [ ] **Step 2: Amend `agent/src/fileops.ts`**

```ts
/** `readWhole`'s result: `data` keeps the pre-existing null-for-any-failure
 *  meaning; `absent` is set true only when the failure was ENOENT (the file
 *  genuinely does not exist), so a caller that cares can distinguish that
 *  from EACCES/EISDIR/ELOOP/EIO/anything else — all of which mean the file
 *  IS there and this box just can't read it. Never-throw, same contract as
 *  every other op in this file.
 *
 *  SAME RESIDUAL AS THE SERVER'S `ReadFailure` (wave-1 review minor m2), and
 *  it must be stated on both sides because this is where the wire's own
 *  absent-marker is decided: a DANGLING SYMLINK is followed, the target's
 *  ENOENT is what `readFile` throws, and `absent` comes back true for a name
 *  that is still in the directory listing. Not closed with an `lstat` ladder
 *  here for the same reason as there — a second syscall on every field read
 *  to separate a state no ccd verb can produce. */
export type ReadResult = { data: string | null; absent: boolean };
```

- [ ] **Step 3: Typecheck both packages**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
then `cd ../agent && npm run test`
Expected: PASS. (`typecheck-tests` is known load-flaky — re-run in isolation before calling a break.)

- [ ] **Step 4: Commit**

```bash
git add server/src/io.ts agent/src/fileops.ts
git commit -m "docs(io): state the dangling-symlink residual on both sides of the absent contract"
```

---

### Task 8 (m3): `watch.ts`'s absence-route sentence names both producers

**Files:**
- Modify: `server/src/watch.ts:~1847-1849`

**Interfaces:** comment only.

- [ ] **Step 1: Replace the overclaiming sentence**

The current text reads:

```
        // evidence than the second, not weaker: a listed-then-ENOENT
        // `.uuid`/`.wrapper`/`.workdir` can only come from ccd's
        // `_reg_purge`, i.e. a full reap.
```

Replace with:

```
        // evidence than the second, not weaker, in the ORDINARY case: a
        // listed-then-ENOENT `.uuid`/`.wrapper`/`.workdir` comes from ccd's
        // `_reg_purge`, i.e. a full reap. It is not the ONLY producer, and
        // the earlier "can only come from" here was wrong (wave-1 review
        // minor m3): losing the registry DIRECTORY itself mid-pass produces
        // the same observation — this method's own listing succeeded at the
        // top, the per-field reads afterwards ENOENT, and every row takes
        // this route at once. That case is fleet-wide and lasts ONE PASS
        // (the next sweep's listing fails and the method returns before this
        // loop), where a reap is per-row and permanent; the cost of the
        // difference is that a directory lost for one pass mass-parks
        // deliveries that used to sit degraded.
```

- [ ] **Step 2: Verify nothing keys on the old text and the suite is green**

Run: `cd server && grep -rn "can only come from" src/ test/` — expected: no hits.
Run: `cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/typecheck-tests.test.ts`
Expected: PASS. (`mail-sweep.test.ts` is the suite that drives this method; `typecheck-tests` is
known load-flaky — re-run in isolation before calling a break.)

- [ ] **Step 3: Commit**

```bash
git add server/src/watch.ts
git commit -m "docs(watch): registry-directory loss is a second listed-then-ENOENT producer"
```

---

### Task 9 (m4): mark the dead degrade double at its own site

**Files:**
- Modify: `server/test/push-copy.test.ts:~318` (the second "blocking review finding 2" test)

**Interfaces:** comment only.

- [ ] **Step 1: Add the site comment**

Immediately above the `it('suppresses the push when the degrade lands on the fleet assembly's read …` —
after the existing block comment, so the existing narrative is preserved and then corrected:

```ts
  // AND IT IS CURRENTLY VACUOUS — D-118, measured (wave-1 review minor m4).
  // Neutering the double below (degrade nothing at all) leaves this test
  // GREEN, on both the converted double and the pre-conversion original at
  // `c1a6866`, so it is pre-existing rather than a Task 4 regression. The
  // reason is in the paragraph above: the fix this was written for landed,
  // `tick()` passes its own rows into `assembleFleet`, and there IS no
  // second read for the `readsThisTick > 1` branch to catch. It is kept as a
  // REGRESSION TRIPWIRE for the day someone re-introduces a second
  // whole-fleet read — not as live coverage of the gate, which the FIRST
  // test in this describe provides. Do not read a green run here as evidence
  // that the suppression works.
```

- [ ] **Step 2: Verify the suite is green and the claim is true**

Run: `cd server && ./node_modules/.bin/vitest run test/push-copy.test.ts`
Expected: PASS.
Then MEASURE the vacuity claim rather than inheriting it: temporarily change
`if (readsThisTick > 1) return { ok: false, reason: 'unreadable' };` to `if (false) …`, re-run, and
confirm the test still passes. **Revert the temporary edit** and re-run to confirm green. Record
both counts in the Deviations section.

- [ ] **Step 3: Commit**

```bash
git add server/test/push-copy.test.ts
git commit -m "test(push-copy): name D-118's dead degrade double at its own site"
```

---

### Task 10: full verification and the PR

**Files:** none.

- [ ] **Step 1: Run all three suites, foreground, in full**

```bash
cd server && npm run test
cd ../agent && npm run test
cd ../pwa && npm run test
```

Expected: PASS. Re-run any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
`ccd-session-state` IN ISOLATION before calling a failure real; CI on the quiet box is the arbiter.

- [ ] **Step 2: Fill in the Deviations section of this plan and commit it**

Every `D-N` found during execution, with measured before/after counts for each mutation claim.

- [ ] **Step 3: Push and open the PR from THIS workspace's branch**

```bash
git -C /home/you/worktrees/ccrc-pwa/plain-ridge push -u origin ws/plain-ridge
gh pr create --base main --head ws/plain-ridge \
  --title "fix(ccd): atomic registry writes — _reg_set writes through a tmp and renames" \
  --body "<summary + the deviation ledger>"
```

- [ ] **Step 4: Wait for CI green, then measure the fingerprint ONCE**

```bash
git -C /home/you/worktrees/ccrc-pwa/plain-ridge rev-parse HEAD   # branchTip AND handoffCommit
gh pr view --json number,state
```

Then send the `wave-done` mail with `{branchTip, prNumber, prPhase:"open", handoffCommit}` and
**stop pushing** — a commit landed after the claim moves the tip and the coordinator gets
`stale-tip` for a wave that was finished.

---

## Deviations found

- **D-121 (2026-08-20, survey)** — `mv -f <tmp> <destination that is a DIRECTORY>` exits **0**,
  having moved the tmp INSIDE the directory (measured, GNU coreutils 9.4). `mv -fT` exits 1
  (`cannot overwrite directory … with non-directory`). This is not hypothetical:
  `server/test/ccd-hold.test.ts:125` plants a directory at `$REG/<id>.hold` as its any-uid stand-in
  for a failed write, and depends on `_reg_set` returning non-zero so `cmd_ws_hold` dies rather than
  printing `held <id>` over an empty registry. **`-T` is mandatory**, and that existing test is the
  mutation tripwire for it.
- **D-122 (2026-08-20, survey)** — a behaviour change, in the fail-shut direction, disclosed rather
  than hidden. With `$REG` at mode 0500, updating an EXISTING field used to SUCCEED (`>` needs write
  permission on the file, not the directory; measured) and now fails, because the tmp cannot be
  created. Creating a NEW field failed before and fails now. `cmd_ws_hold` already dies on a
  non-zero `_reg_set`, so the new refusal surfaces as a named refusal, never as a silent loss.
- **D-123 (2026-08-20, survey)** — `_pr_py` takes `fcntl.flock` on `$REG/<id>.uuid`
  (`ccd/ccd:1256`), whose comment says "never written here" — true of that block, but
  `_reg_set "$id" uuid` writes it from three bash sites, one of them the ordinary supervise path.
  `flock` binds an INODE, so rename-based writes make that lock inode-unstable and two concurrent
  `ccd pr-state` runs straddling a uuid rewrite could both hold `LOCK_EX`. Moved to a dedicated,
  never-replaced `$REG/.prstate-<id>.lock` (Task 5), the same idiom as `$REG/.reap-$id.lock`.
- **D-124 (2026-08-20, survey)** — a SIGKILL between the tmp write and the rename leaks one tmp
  file permanently. `_reg_purge`'s glob cannot see a dotfile, and giving it one that could would let
  one id's purge delete a NESTED id's in-flight tmp (`_reg_purge`'s own note documents that
  `<id>.x-y` shape) and turn that write into a false refusal. Disclosed, not swept — inert bytes,
  the same price `$REG/.reap-$id.lock` already pays.
- **D-125 (2026-08-20, survey)** — a registry field that is a SYMLINK is now REPLACED rather than
  written through. `>` follows the link and writes the target; `mv -fT` replaces the link itself.
  No ccd verb creates symlinks in `$REG`, and replacing is the more defensible semantics (the
  registry owns the name), but it is a change and it is stated. Related to m2's read-side residual
  (Task 7), which is the same state observed from the other end.
- **D-126 (2026-08-20, survey)** — `archivemanifest` is the one migrated writer whose bytes differ
  from `_reg_set`'s: `printf '%s\n'` adds a trailing newline. Preserved deliberately by passing it
  in the value (`"$manifest"$'\n'`) rather than allowed to drop, even though the only consumer
  (`manifestBytes`, `server/src/registry.ts:363`) JSON.parses and would not notice.
- **D-127 (2026-08-20, survey)** — the one listing reader that does not simply ignore the tmp:
  `unclaimedWorktrees` (`server/src/divergence.ts:220`) splits every entry at its last dot and adds
  the prefix to `claimedById`, so a live tmp contributes `.<id>.<field>.<pid>`. Inert — a real ccd
  id is `<project>-<slug>` and `_ws_slug_valid` forbids a leading dot — and the direction if it ever
  collided is toward suppressing a report-only "unclaimed worktree" finding, never toward a false
  repair.
- **D-128 (2026-08-20, survey)** — m1 was reported with two halves and only one is done here.
  Order-insensitivity is fixed (Task 6). The second half — `server/test/` being outside
  `single-definition.test.ts`'s four scanned ROOTS, so a second copy of the pair inside a TEST file
  is invisible — is NOT fixed: adding a fifth root changes what every other assertion in that file
  scans (several assert exact `holders` arrays), which is a scope this wave's brief explicitly
  closes ("any registry read-side semantic change beyond the comment fixes named above"). Named here
  so the next owner finds it instead of rediscovering it.

<!-- Execution appends D-129… here, with measured before/after counts for every mutation claim. -->
