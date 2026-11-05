# A gone row holds only a reclaim it could overlap — Implementation Plan

**Goal:** A registry row whose workdir is gone stops holding every child on the box. It keeps holding only a reclaim it could really overlap (#2294).

**Architecture:** One bash helper decides, `_ws_reclaim_workdir_shared`, the rows rung every seam asks: the audit, the verb's locked recomputation, `_ws_reclaim_owned` on every arm, the collector and the loose sweep. No new verb, no new refusal word and no token input. The audit documents gain one additive key, `quietRows`, which no server reader reads.

**Two PRs, in this order.** This plan is the first, the safety change. The fleet-level notice follows once it has merged.

## What can be proved when the path is gone

A row can overlap the child in four ways.

| Way | Excluded by |
|---|---|
| Its spelling is at, in or through the child | the literal arms, which already answer for a gone row |
| A component now gone was a link into the child | not by the spelling, and not excluded at all: nothing running means the tree is not in use, and it goes with the child |
| Its tree was moved into the child or a leaf | not by the spelling, and the moved-check's negatives prove little; no checkout at all standing there excludes a moved checkout, never a tree with no `.git` |
| Its session is alive somewhere unknown | the pane positively gone and the unit positively stopped |

The moved-check stays negative evidence. It misses a subdirectory of a moved tree, never looks in a leaf, and finds nothing with a blank admin entry. So a gone row is still never placed by a projection. It is released, unplaced, on a stronger question.

## The change

**`_ws_reclaim_gone_quiet <o> <w>`.** Answers 0 when all of these hold, and 1 otherwise:

- `w` has no control character, is one plain spelling, and its absence is proven.
- The deepest ancestor not proven absent resolves `complete` to its own spelling, so no link stands on what is left of the path.
- `_session_probe` answers `gone`. `live` and `unknown` hold.
- `_ws_unit_stopped` answers stopped. An empty answer holds.

It reads and only reads, and shadows the probe's globals. It stays apart from the four recorded-arm bodies, which keep reading no process, pane or unit state.

**`_ws_unit_stopped <id>`.** `_ws_expire_presence`'s unit block, Darwin arm included, moved with no change in behaviour in its own commit. It says nothing to anybody: each caller words the answer.

**`_ws_reclaim_quiet_row`.** The one test both release sites ask, beside the quiet arm: the entry field is `valid` or `legacy-*`, and the row lies at or under neither `mine` nor a resolved leaf, which `lit` and `llit` miss when the child's own spelling goes through a link.

**`_ws_reclaim_no_checkout`.** The release's other half, asked once after the walk, in the helper itself, so no seam can skip it. No `.git` of any kind stands below the child, or at or below a standing directory leaf. A scan that does not finish holds.

**A row that goes during the walk (the comment on #2294).** `A gone` leaves the `unwalk` arm and is asked again, off the reply loop's stdin. A `.workdir` gone too is the listing arm's answer, and the row is dropped, its entry rules included. Rc 2 is `unread`. Another spelling, or one that resolves whole again, is `unwalk`. A gone row then meets its recorded arms and the quiet arm. A recorded placement here feeds the moved-check and is compared with the child and its leaves, as the pass compares one.

A released row keeps its `A` and `F` walk rules: only `unres` is skipped, and nothing leaves a bucket.

**The audit trail.** `_WS_QUIET_ROWS` holds the rows this pass released, set only once the checkout question has answered clean. `_ws_quiet_rows_json` prints it as `"quietRows":[ids]` beside `legacyRows` and `pendingRows`, in the reclaim document as #2294 asks and in the expiry document too, since the expiry ladder asks the same rung and releases the same rows. `[]` means none was released, and `null` means not counted, as the counts mean it. A child held for another reason still names the rows that were let go. `parseChildReclaimAudit`, `parseChildReclaimAuditFailed` and `parseExpireAudit` read a document with the key exactly as one without it, and a test pins each.

## The docs this amends

- Child-reclamation spec §5.5: the vanished-child limit, the recorded arms' never-list, the release and its residual. §5.6, §5.7 and §7 stop leaning on a blanket hold.
- Path-identity spec §4.5 step 2 and its reason, and the two places that repeat them.
- The un-wedge spec's §4.1 and D6, which stay open for the operator on #2294.
- The contract's R31 and R94, each with a dated amendment, R94's as-built note, R31's cost, R97 and its W3 carry, and the leaf limits it mirrors from the spec.
- The README's box-move paragraph.
- The rung's header. `the accepted fail-closed cost` is about a row that is not absolute, and it still reads true, so it stays, with a pointer that a gone row's cost is narrower.

## Stated costs and limits

- A child with a checkout of its own below its tree or in a leaf stays held while a gone row is released on it: here a checkout is not told from a moved tree. A temp root holding fixture clones is the common case. The hold is that child's alone, retryable, and names the rows by id.
- `gone-row-release-misses-a-tree-with-no-git`: the scan finds a row's tree only by a `.git` of its own, so for a stopped row with a gone spelling, a tree with none is removed with the child. That is a tree inside the child by a link now gone (nothing moved or stripped, and the base refused it on purpose), a row that was never a checkout, a subdirectory of a checkout moved alone, and a tree stripped of its `.git`. It is not in use, because nothing runs for its row, but the pin keeps only what git would add in the child's own tree: an ignored file there, or anything in a leaf, is lost for good.
- The release is the one place process state does more than refuse. The contract's R31 and R94 carry the amendment, and the operator rules on it with D6.
- The trail is the audit document alone. The server reads no `quietRows` yet, so the key is visible where the document is printed, and the collector and the loose sweep, which print no such document, name no release. The fleet-level notice that follows is where the operator reads a held row.
- A row dropped during the walk may still sit in a not-asked bucket it joined in the pass, such as a pending field. The next attempt finds no row.
- The un-wedge spec (`2026-11-04-cleanup-unwedge-design.md`, D6) left narrowing ccd's hold for unrecorded rows open, pending a new proof and a ruling. #2294 asks for the narrowing, and this plan is that proof. The spec's archived-row arm and its naming of the hold are unaffected: a row this release cannot free stays in `unres`.
- `ccd/ccd` grows by 105 net code lines, past the growth limit, under the waiver `D-8019-ccd-ccd.json`: the rung has one home.

## Deviations found

- **D-8019 (2026-11-05)** — A gone row holds only a reclaim it could overlap: the rows rung releases a gone row nothing runs for when no checkout stands under the child or a leaf, and a row that goes during the walk is asked again instead of failing an unrelated child.
