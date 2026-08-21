# Upstream-launcher locks — `ccrc adopt` re-keyed, and lock 5 on the write path

**Branch:** `ws/ccrc-adopt-and-wrappers-upstream-account`
**Spec:** [`docs/superpowers/specs/2026-08-21-upstream-launcher-decision-brief.md`](../specs/2026-08-21-upstream-launcher-decision-brief.md)
**Shipped:** 2026-08-21. Bash-only, agent-lane only — no `shared/`, `server/`, `pwa/` or wire change.

---

## What this fixes

ccrc was built on an unwritten premise: **`~/.local/bin/<upstreamId>` is the binary, never a
script.** It was never stated, never tested, and enforced only by two *accidental negative signals* —
"does not start with `#!`" (adopt) and "too big to read" (wrappers). On 2026-08-20 the reference box's
`~/.local/bin/claude` stopped being the installer's ~334 MB symlink into
`~/.local/share/claude/versions/<ver>` and became a 2741-byte launcher that picks a version and
injects the upstream account's OAuth token. Both signals stopped tracking what they stood for, in the
same instant, and neither failure was visible: `ccrc doctor` reported nothing new.

**Why the launcher exists at all**, since this is the root and it is not fixed here: the live roster's
upstream entry *is* the team·max account (`{"id":"claude","label":"team·max","exec":{"kind":"upstream"}}`),
and `ccd` execs accounts by path (`ccd/ccd:8312`, guarded only by `-x`), with no per-account env seam
(`claude-session@.service` carries no `Environment=`). So the one account that needs a secret is the one
account ccrc gives no wrapper — and the binary path is the only seam left to put it in. Recorded as
**D-159** below; the fix is a roster-model change, out of scope for an incident this size.

---

## Tasks

- [x] **1 — Red tests first.** Both defective sites were pinned by *nothing*
      (`ccd/ccrc-adopt`'s script gate; `cmd_wrappers`' `--force`-on-foreign arm), so a green suite
      after any fix would have proven nothing. Six cases added to `server/test/adopt.test.ts`
      (measured 6 failed | 27 passed), three to `server/test/ccrc-wrappers.test.ts` (2 failed).
- [x] **2 — D-155, the adopt gate.** `_wrap_is_script` → `_wrap_declares_config_dir`, asked
      **directly** of the elected path. Riders: the `non-script` literal in the success echo became
      `$UPSTREAM_SHAPE`; both `_wrap_declares_config_dir` call sites size-gated;
      `WRAPPER_OVERSIZE_BYTES` moved into `ccd/ccrc-wrapper-shape` and `ccrc-doctor-checks`'s bare
      `1048576` reads it; the library guard in `_check_wrappers` extended to catch version skew.
- [x] **3 — D-155, cut 2 on the write path.** The `foreign` arm split on `$dok`: `--force` may
      overwrite a file this reader can parse as a wrapper, and nothing else. The remedy sentence
      moved into `_ccrc_foreign_remedy` so its two printers cannot drift.
- [x] **4 — D-156, lock 5.** The witness index: built once off disk before the action pass,
      consulted above the decision table, refusing per id under every flag.
- [x] **5 — Mutations measured**, one at a time, restored between, recorded in the test files.
- [x] **6 — Docs.** README's wrappers and adopt sections; `cmd_wrappers`' lock header gains a fifth
      lock and a "WHY FIVE AND NOT FOUR"; the decision table gains the split row and the lock-5 note.

**Suites, foreground, after the change:** server **160 files / 4282 passed / 3 skipped**, agent
**18 / 279**, pwa **66 / 1755**.

---

## Deviations found

(Next free number at plan time: **D-155**. Verified against `origin/main` *and* the working tree
before allocating — the stage-3a/fleetio collision of 2026-08-20 came from two branches both reading
"next free is D-108" at cut time.)

**D-155 — "is it a script" was a proxy for "is it an account wrapper", and the two parted company.**
`ccd/ccrc-adopt`'s upstream gate read the elected file's first two bytes. The hazard it existed for is
a *cycle* — electing a file that the voters would exec as their upstream while it sets its own
`CLAUDE_CONFIG_DIR` and execs onward. `#!` stood in for that only while the binary path was guaranteed
to hold a binary. Measured before the fix: `exit 1`, nothing written, on a box whose only anomaly is a
launcher — and `ccrc adopt` is the remedy **four** `_check_wrappers` FAILs name
(`ccd/ccrc-doctor-checks:1502`, `:1574`, `:1579`, `:1586`), so the entire re-bootstrap path terminated
in a refusal. Not local: `~/.local/bin/pnpm` and `yarn` on the same box are `#!` shims, so an npm- or
mise-installed Claude Code fails identically.
*Spelling matters and was measured.* The gate asks `_wrap_declares_config_dir` **directly**, not
whether the winner is in `CFG_SCRIPTS`. The membership spelling also encodes pass 0's `-f`/`-x`/ID_RE
filters, so a textbook account wrapper parked at the upstream path whose only anomaly is mode 0644 is
in no list — measured: membership **adopts the cycle and writes it** at exit 0; the direct predicate
refuses. `set -euo pipefail` makes the membership spelling additionally fatal on a missing key.
*Residual, stated not hidden:* the predicate is one line-wise regex, so the two-statement form
(`CLAUDE_CONFIG_DIR=…` then `export CLAUDE_CONFIG_DIR`) does not match, and a cycle built that way is
adopted at exit 0. The old gate did not *detect* that case either — it refused it by accident, along
with every legitimate box.

**D-155-a — the size gate I added to close D-81's hole opened an overloaded null of its own.**
Caught in review of the same change, before it shipped. The first spelling was
`if ! [[ "$sz" =~ ^[0-9]+$ ]] || [ "$sz" -gt "$WRAPPER_OVERSIZE_BYTES" ]`, one test and one sentence
for two conditions. Measured with a `stat` that cannot answer `-c%s` (every BSD-flavoured one): every
102-byte wrapper was reported as *"a script of ? bytes — over 1 MiB"*, all candidates were dropped, and
adopt concluded *"no script under …/.local/bin sets CLAUDE_CONFIG_DIR"*. A box that cannot adopt at
all, with a diagnosis pointing at file sizes. Now two tests, two sentences, same skip — the
no-overloaded-null rule applied to a **message** rather than to a return value.

**D-156 — `foreign` was one classify covering two sentences, and the lock that hid it was a file's
size.** `--force` overwrote *any* foreign file under a generated id. Measured: with `claude` flipped
to `generated` and another account made upstream, `ccrc wrappers --force` rewrote the launcher and
exited **0** — and because `claude2`, `claude-corp` and `claude-dev0` all end
`exec "$HOME/.local/bin/claude" "$@"`, that closed an exec loop across **every lane at once**
(`claude2 --version`: rc 127 → rc **124**, i.e. it stopped terminating). Lock 4 does not catch it: the
staged wrapper execs the *other* account, so it is not self-referential, and lock 4 tests only
self-reference. Until 2026-08-20 the only thing preventing any of it was that the file was ~334 MB and
classified `oversize`, which no flag overrides — **a lock nobody had written down, deleted by a file
getting smaller.**
Two locks, keyed on different evidence, because the header's own standard is that two locks sharing a
predicate are one lock: **cut 2** (`--force` may overwrite only what this reader can parse as a
wrapper) and **lock 5**, the witness index.
*`--force` was never the only route,* which is why lock 5 sits above the decision table: obeying
ccrc's own printed remedy — *move it aside and re-run* — makes the path `absent`, and the absent arm
writes with **no flag at all**; thereafter the file is `ccrc-unmodified` and rewritten on every roster
change. `ccrc install` reaches both (`_inst_wrappers` → `cmd_wrappers` with no args). A lock keyed on
the subject file's bytes cannot survive the subject file being moved away; one keyed on the **other**
files can.
*The old remedy was not reworded.* It stays exactly true for a foreign file nothing execs, and
`ccd/ccrc`'s header forbids weakening it. Instead the gate's placement makes it *unreachable* for a
witnessed id — measured (`'move it aside'`: 1 occurrence → 0) and pinned by an ordering test that
reds when the gate moves below the table.

**D-157 — lock 5 costs one refused run on a legitimate upstream rename that also declares a shim.**
A rename where the roster additionally declares a generated account at the *old* upstream name is
refused on run 1 (the disk wrappers still exec the old name) and converges on run 2, once the run has
retargeted them. Accepted rather than narrowed: the witness set erodes only when the run itself
retargets the witnesses, which is what a rename *is*, while a mis-edit that promotes an existing
wrapper leaves a permanent protected witness. The narrowing exists on paper if it ever bites.

**D-158 — a witness must parse as the full generated shape, so a bespoke launcher casts no vote.**
Measured live: the *loose* witness set for `claude` is 7 files (`claude2`, `claude-corp`,
`claude-dev0`, `ccgpt`, `cck3`, `claude-glm`, `gpt`); the *strict* set is 3. Strict was chosen because
it turns the size cap from a hole into an entailment — a file too big to be 2–3 significant lines is
*provably* not a witness — where a loose "does the text contain an exec line" rule would have made the
cap a silent blind spot. Mutation-measured in the other direction too: dropping the strict rule reds
**11** tests, i.e. an over-broad witness predicate wedges a legitimate box. On a box where the only
thing exec'ing the upstream is bespoke, lock 5 is silent and cut 2 is the remaining guard.

**D-159 — the roster has no way to say "this account's binary lives elsewhere", and that is why the
launcher had to exist.** Not fixed here. `ccrc` gives every account a wrapper except one, and that one
is the account whose lane needs a secret, so the secret has nowhere to live but the binary path —
which is also every other lane's exec target, which is why the launcher's injection guard is as
delicate as it is. The principled fix separates identity from executable (`claude-bin` holds the
executable; `claude` becomes an ordinary generated wrapper for team·max, using the existing 3-line
template). It needs a roster-model change: `ccrc-adopt` hardcodes the upstream's `configDirSuffix` to
`.claude`, so both would claim `~/.claude`. Recorded so the next person meeting this does not
re-derive it.

**D-160 — `ccrc-doctor-checks`'s own size gate measures the link, not the target.** Its
`stat -c%s -- "$bin/$id"` omits `-L`. Measured live: `stat -c%s gpt` = 33 (the length of the target
path string) while `ccgpt` behind it is 7.8 KB — so a symlink to a large file passes that gate and is
then `mapfile`d whole. Lock 5's own scan uses `stat -L`. Recorded, not fixed: it is a different
function with its own test surface, and doctor only reports.

---

## Two things the tests now say that they did not before

- **`ccd/ccrc`'s `--force`-on-foreign arm had ZERO coverage.** Every `--force` case in
  `ccrc-wrappers.test.ts` was `ccrc-edited`, `unreadable`, `oversize`, the untouchable matrix, or a
  stub manifest. A live write capability nothing pinned. It has three cases now, including one that
  keeps the capability cut 2 deliberately *retains*.
- **`ccrc-adopt`'s upstream refusal had zero coverage.** `is itself a script` appeared exactly once in
  the repo and no test reached it. Deleting the whole block left 501/501 green.

## Mutation table

Measured one at a time, restored between each, full-suite counts recorded in the test files beside
the cases they prove.

| mutant | reds |
|---|---|
| adopt: drop the account-wrapper refusal | 2 (the cycle case, the mode-0644 spelling case) |
| adopt: drop the size gate | 1 (the huge-script case) |
| wrappers: fold the `$dok` split back (pre-D-155 arm) | 2 of 3 — the `--force`-still-works case stays green, which is the point of having it |
| wrappers: over-correct, kill `--force` on parseable foreign too | 1 — the opposite one. The pair discriminates a narrowing from a blanket ban |
| lock 5: witness refusal never fires | 2 (move-aside, ordering) |
| lock 5: blind index falls open | 1 (unreadable candidate) |
| lock 5: `foreign` skips the pre-table gate | 1 (ordering) — this is what makes "the old remedy is not a lie" a mechanism |
| lock 5: drop the strict-parse rule | 11 — an over-broad predicate wedges a legitimate box |

**Stated so the table claims no coverage it does not have:** the "under every flag", termination, and
roster-flip cases stay green under the lock-5 deletion mutant, because cut 2 already refuses that file
on its own. They guard both locks regressing, not this one.

---

## Not done here

- The launcher's own two defects (**operator-side, outside this repo, and NOT touched**): the
  `CCRC_CLAUDE_VERSION` pin falls through a bare `else` into "highest installed" when the named
  version is gone, while `claude-prune-versions` keeps only 3 and runs daily — so a rollback pin
  silently un-pins on the third night. And "highest version" is not "the version the installer chose":
  `versions/` currently holds `2.1.228` with the *newest* mtime beside 2.1.235–2.1.238, and the
  launcher runs 2.1.238. Both need the operator's sign-off — every live session execs that file.
- D-159 (the roster model) and D-160 (doctor's missing `-L`).
- The pre-existing `FAIL wrappers` on both boxes (`claude-corp` sources an undeclared secrets file;
  `claude-dev0`/`claude2` roster mismatches) — D-69 era, unrelated, and measured byte-identical before
  and after this change.
