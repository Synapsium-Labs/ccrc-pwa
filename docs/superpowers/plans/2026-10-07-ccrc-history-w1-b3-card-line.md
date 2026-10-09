# ccrc history, wave 1 B3 (card line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W1-B3 "card line" of the ccrc history spec (rev 3.5, §8.6) as ONE PR on `main`, after B1 ("capture") and B2 ("recall") merge. After a compaction of a session's main thread, its SessionStart(compact) context gains one grammar-gated line that names the leaf the compaction is about to become:

`History: node L03a9c1… (this compaction) · parent N7c1e2f… · ~/.local/bin/ccrc history describe L03a9c1`

The line is built from four pieces:
- a PreCompact scope marker, `~/.ccrc/history/scope/<id>` = `<scope> <psid> <ms>`, so the line never reaches a subagent's context;
- a builtin-only hook reader, `_hook_history_card`, that folds the line above the compact card when both fit the compact clip;
- a 513-character reserve in the compact card's render on a box with history;
- the sweep's per-session predictions, `card/<id>/<uuid>.txt`: written at end-of-file, deleted when the boundary that consumed them is ingested, and their delivery measured from the transcript (W1-e).

B3 also carries the one README `:2900` re-anchor and the S6-R11 census re-measure that pays for the hook insertion above it, the two lifecycle rows, `measure-history.py`'s W1-e query, and a short README paragraph. It cannot precede B2: the line names `ccrc history describe`.

**Architecture:** Fleet-side only. There is no wire, server, PWA, `ccd/ccd`, `ccd/ccrc`, `compact-card.mjs`, doctor, coord.db or schema change; no new hook event arm, no new `--op` verb, no `WRITING_FORMS` entry and no `historyPaths` key. Ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only) makes every card decision, appended at the end of the file (Tasks 1–3):
- the vocabulary: `CARD_DIR`, `SCOPE_DIR`, `CARD_LINE_MAX` (512), `CARD_DESCRIBE_CMD`, `CARD_LINE_PATTERN` (the spec grammar character for character, built from B1's `CARD_PREFIX`), `CARD_LINE_RE`, `PURGED_FILES_GRACE_MS` (7 days), `CARD_MEASURE_ROWS` (40), `CARD_MEASURE_MAX_WAIT_MS` (24 h), `CARD_ATTACHMENT_MAX_BYTES` (1 MiB), `SCOPE_MARKER_MAX_AGE_MS` (the hook's `COMPACT_CARD_MAX_AGE`, in ms), `CARD_CONSUMED_SCOPES` and `CARD_WITHDRAW_REASONS`;
- the path helpers `cardDirOf`, `cardFileOf` and `scopeMarkerOf`, in the shape of B2's `recallOffPath`, which run `idOk` and `UUID_RE` before any path is formed;
- the line builder `cardLine`, which answers only grammar-valid lines;
- the prediction `planCardPrediction` (with `predictedSpanStart`), which calls B2's `planSpans`, `decideLeafId`, `planFanIn`, `FAN_IN` and `displayPrefixes`, so no span, fork, fan-in or prefix rule is spelled twice; the file decision `decideCardFile`, over a `Presence`; and `decideCardGenFile`, the generation record beside a prediction that the hook compares `recall-off/<id>` with when neither the env nor the registry resolves a generation (coordinator ruling R-recalloff-parity);
- the delivery and purge decisions `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery` and `decidePurgedEntry`;
- the consumption's scope fold, `consumedBoundaryTs` and `decideConsumedScope` (ruling RC3), and the withdrawal decision `decideCardWithdraw` (ruling RC2).

*L3 `ccd/history/store.mjs`* is unchanged. B3 uses B1's `writeFileAtomic`, `bump`, `withTx` and `unbrotli`, and B2's `getStep`, `setStep` and `parentOf`.

*L4:*
- `ccd/history/derive.mjs` (B2) exports `epochCopySlots` and `holdingCopyOf`, extracted in place with no change of behaviour (Task 4). The card's parent prediction and its delivery window then read the very lists and copy that fan-in and the leaves read (ruling RB4).
- A new module, `ccd/history/card.mjs` (Tasks 5–7), has no entry guard, is imported only by `sweep.mjs`, imports only `node:fs`, lib, store and derive, and reads no `process.env`. It owns:
  - `ensureHistoryDirs(db, home)`: makes `scope/` and `card/` 0700, and refuses and counts a link or a file there;
  - `cardStep(db, ictx, budget)`: first `measureCardDelivery`, then `consumeAndWriteCards`, whose budget bounds a write and never the consume/delete decision (ruling RC2), and which writes beside each prediction, first, `card/<id>/<uuid>.gen`, the generation B2's CLI resolves for the id under `'newest'` (coordinator ruling R-recalloff-parity), and which counts each consumption `card_consumed:<main|other|unknown>` by the scope marker its compaction left (ruling RC3);
  - `withdrawCards(db, home, pass, out)`: on a pass lib's `decideCardWithdraw` says runs no card step, every `card/<id>/<uuid>.txt` is unlinked, lstat-checked and never through a link, counted `card_withdrawn:<reason>` (ruling RC2, fail closed);
  - `collectPurgedHistoryFiles(db, home, nowMs)`.
- `ccd/history/sweep.mjs` gains one import and seven call sites, all above the R1 entry guard:
  - `cardStep(db, ictx, ctx.budget)`, directly below B2's `deriveNodes` line and under the same ingest/not-paused gate, with `withdrawCards` directly below it over the tick's facts (its pause, its per-chunk floor stop, an ingest an unreadable roster skipped, the budget read before the card step);
  - `withdrawCards` on the three other ways a pass ends: in `holdPass` (no DB open: the count goes on the pass's outcome line), below `scheduledPass`'s `held` line, and below its `planRun` line for every arm that is not `run` (the migrate, recover and hold arms);
  - `ensureHistoryDirs(db, ctx.home)`, unconditionally, directly below B1's spool-directory line `if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);`;
  - `if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now())`, directly above B1's `markScan` line.
  `makeIngestCtx`'s object also gains `readRegPresence`. `tick`'s doc comment gains one numbered item for each new step the body calls with `db` (`cardStep`, `withdrawCards`, `collectPurgedHistoryFiles`, `ensureHistoryDirs`), in body order, because B1's `history-sweep.test.ts` reads that list against the body (its review 316 F39 describe). The recover arm (`recoverPass`) never ticks, so no card is written or consumed while a recovery step runs; the pass that takes that arm withdraws every prediction first.

*The hook, `ccd/session-hook.sh`* (bash; enqueue-only contract):
- **Above `state="" ask_json=`**, the ONE sanctioned insertion above README's anchor (D-4748 (`history-card-reader-above-the-arm`); Task 9): `HISTORY_CARD_MAX=512`, `HISTORY_CARD_RE='<the spec grammar>'`, `HISTORY_SCOPE_DIR`, `HISTORY_CARD_DIR` and `_hook_history_card`. The reader is builtin-only and forks nothing. Its checks run in this order:
  1. no `agent_id`;
  2. `history-off` absent;
  3. the 224-char id bound and a lowercase-UUID psid;
  4. `recall-off/<id>` honoured for this family's resolved generation, read the way B2's CLI reads it, and a read that fills its `CCRC_ID_MAX`-character window read as OFF (ruling RC4). The generation is `CCRC_SESSION_GENERATION`'s, else `$REG/<id>.generation`'s, else the one the sweep recorded beside the prediction, `card/<id>/<psid>.gen` (the CLI's own `'newest'` resolution, which the hook cannot compute without the store); with none of the three, a recall-off file that exists withholds the line (coordinator ruling R-recalloff-parity: fail closed);
  5. a fresh `main <psid> <ms>` scope marker, its age taken from `EPOCHREALTIME`, read once into a local as B1's spool block reads it, and at most `COMPACT_CARD_MAX_AGE`;
  6. a regular card file, read with `read -N $(( HISTORY_CARD_MAX + 1 ))`, one LF stripped;
  7. the grammar;
  8. the room.
  Then it folds: `CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"`.
- **In place, line-neutral:** `[[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }` (Task 9), and the helper's `--max-chars "$(( COMPACT_CARD_MAX_CHARS - ${HISTORY_CARD_RESERVE:-0} ))"` (Task 10).
- **In the tail, below every cited anchor:**
  - directly below the `esac` that closes `case "$event" in`, one builtin line that empties this id's existing scope marker on a main-thread PreCompact, before any tail exit can run (Task 8);
  - the reserve: reset to 0, then set to `HISTORY_CARD_MAX + 1` on PreCompact when `card/` exists and `history-off` is absent (Task 10);
  - `unset CS_SCOPE`, directly above the `_hook_compact_pre` call;
  - the `# >>> history-scope` block, directly below that call (Task 8). It reuses a set `CS_SCOPE`, runs `_hook_compact_scope` itself when the card did not, and writes only a decided verdict, so an undecided one, or a run that exits before the block, leaves the marker empty.

*L0 `shared/lifecycle.ts`* gains `history-scope-markers` and `history-card-files` (Task 12).

**Census.** S6-R11 is paid once, in Task 9, for the reader's insertion. README's quoted `_hook_emit_context` call is re-pointed by content first, and the dated census paragraph lands in the same commit. Tasks 8, 10 and 11 each measure their own zero move, and Task 14 re-runs the instrument over the whole PR. The forecast, measured on a prototype, is a zero-move census.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `node:fs` (`lstat`, `O_NOFOLLOW` opens), `node:sqlite` through `store.mjs` only, `node:crypto` in lib;
- bash for the hook, builtins only on the SessionStart path; `strace` for the fork pins on Linux;
- vitest in `server/`; Python 3 for the read-only `deploy/measure-history.py` query and the scratch mutation and census tools;
- GitHub Actions: the `node-floor` leg's heredoc gains `test/history-card.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.5. Rev 3.5's changes (W1-B1's corrections and the substring belt, §17) add pins to B1 and B2 only (§10.5), none to B3. Rev 3.4 was rev 3.3 plus the operator's rulings on Q15–Q19 and on prune at low disk (§15.1):
- §10.5: B3's contents and pins; §10.6: the sequencing; §10.7: the acceptance (W1-e, W1-h);
- §8.6: the card line; §5.1 and §5.3: the scope marker; §8.9: the C pins; §5.5: the S pins;
- §9.4: the lifecycle rows; §9.7: recall-off; §13: the cross-cutting invariants; §16: the slugs;
- §6.1 and §5.1 as rev 3.4 amends them: a SessionStart(fork) is spooled from W1-B2 and confirms as a resume line does (Task 5's spooled-fork case, Task 9's fork row).

**Builds on:**
- `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md`: B1 is its Tasks 3–36. Every B1 name this plan consumes is the name that plan produces: lib, store and sweep exports, `historyHelpers.ts`, `historyFixtures.ts`, the hook's spool block, `measure-history.py` and the O13, O14 and O17 describes.
- `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md`: B2's tasks. This plan uses its derivation (Tasks 5, 8 and 9), its recall-off reading (Tasks 1 and 11), its recovery step (Tasks 7 and 25–29), its test helpers, and its coordinator rulings RB1–RB17. Task 5's spooled-fork case also uses B2 Task 34, the fork spooling (ruled Q16, B2's D-4734 (`history-fork-spooled`)): `fork` in the hook's source whitelist, `SPOOL_SOURCES` and `EPOCH_CAUSES`, and a fork line confirmed as a resume line is. B3 changes no code for it.

**Base:** `main` after B1's and B2's PRs merge. B4 may or may not be on the base; where it matters, a task says what changes when B4 merged first.
- **Files B1 or B2 created are anchored by content, never by line.** These are `ccd/history/{lib,store,sweep,cli,derive}.mjs`, `lib.d.mts`, `server/test/history*.test.ts`, `historyHelpers.ts`, `historyFixtures.ts`, `deploy/measure-history.py` and its test. An anchor is a function, const or marker name, a quoted line, or "above the entry guard".
- **Pre-existing files were measured at `f7e51156f`**, a few also at origin/main `9a255a746`, and each anchor says which. Re-anchor every one by its quoted content at B3's base.
- **B1's and B2's merged code may differ from their plan text.** Read it before editing it. Every task's Step 1 measures its anchors and stops on a difference.
- **Other programmes' PRs touch the same files.** #248 (landing order W3), #299 (session continuity W4) and #284 (delegation broker W1, which appends `sessend=""` to the hook's state line) are merged: origin/main `9a255a746` carries them, and so does B3's base. The anchors quoted "at origin/main 9a255a746" were measured on that tree. #189 (stale) rewrites the identity block beside the reader's insertion: whichever of #189 and B3 lands second rebases by content, and B3's census runs on B3's own base.

**PR:** B3 is one PR. It merges after B2 and in either order with B4 (B1's D-4246 (`history-w1b-three-prs`)). It edits `.github/workflows/ci.yml` (Task 1's node-floor line), so its CI selects the full suite; the coordinator dispatches the full run. The rollout, the W1-e reading and the W1-h check are coordinator or operator steps named in the PR body (Task 14), never the worker's.

**Pins (spec §10.5, B3).** Each is implemented and tested by the task named:
- **S16**, and the marker halves of **S2**, **S3** and **S8**: Task 8.
- **C18**, **C19** (with C68's card half, which B2 hands to B3), **C20**, **C21**, **C22** and **C37**, and the card halves of **S2**, **S3** and **S8**: Task 9. C37's end-to-end case consumes Task 8's marker.
- **C38**: Task 10.
- Every one of them is measured red with a mutant before it goes green (IV6): Task 8's eighteen mutants, Task 9's thirty-eight and Task 10's five. Three kinds of case are not a mutant's: a CONTROL no mutant reds, such as Task 9's parity-table CONTROL (Task 8's `CONTROL: an existing regular marker is replaced by this run's decided verdict` is the exception: `T8-M17-absent-only` measures it red); C37's `empty` marker row, which two guards refuse independently (the scope-word test and the ms digit test), so no single-guard mutant can red it, and Task 9 names it as defence in depth rather than claim it measured; and the `unset` row of Task 9's clock case, which the age test refuses with or without the clock grammar (an empty reading is `now` 0), so `T9-M12-clock-guard` reds only its `malformed` row.
- Halves B1 left for B3: O17's B3 rows (`history-scope-markers`, `history-card-files`) in Task 12, and O14's hook half of `CARD_PREFIX` in Task 11.
- Plan pins with no spec number:
  - the pure decisions: Tasks 1–3;
  - the slot extraction: Task 4;
  - prediction parity with derivation (a spooled fork's epoch among the cases, ruled Q16), the end-of-file gate, the file's modes, the registry gate, the withdrawal on every pass that runs no card step (ruling RC2) and each consumption's scope (ruling RC3): Task 5, over Task 3's pure tables;
  - the delivery counters and their window: Task 6;
  - the purged-session collector: Task 7;
  - the reader's no-fork, POSIX, locale and recall-off parity pins, and a SessionStart(fork) that never serves: Task 9;
  - the reserve's env hygiene and its PreCompact gate: Task 10;
  - the W1-e query: Task 13.
- Not B3's: C68's CLI half (B2); O39, O40, O43 and O44's segment case (B4); C59's steer clause and the PreCompact print (W3).

**Operator rulings (spec §15.1, rev 3.4, 2026-10-07; binding).** The operator ruled Q15–Q19 and prune at low disk. B3 implements each as ruled:
- **Q15 yes** (the export's due rule reads each row's own copies, `EXPORT_REDUCERS.perCopy`, the default from B2): no B3 effect. B3 computes no due rule; the census, doctor and B4's export pass read the default B2 sets.
- **Q16 yes** (SessionStart(fork) is spooled, from B2; B2's D-4734 (`history-fork-spooled`), which reverses B1's `history-fork-not-spooled`): no B3 code change, one sweep case and one hook row.
  - B2's fork line chains a fresh sid as a new epoch, cause `fork`, at the drain that confirms it, by its `reg` or by the observation at the rename, as a resume line confirms. A fork whose sid is already an epoch (Claude Code's same-id arm) confirms that epoch and adds none. So a fork's session gets its first prediction a few ticks after the fork (the drain that confirms it, then an end-of-file pass), and a fork `/clear`ed inside one 30-minute registry-scan interval is chained too. B1 left forks to that scan, with cause `import`.
  - Until the fork epoch confirms, `planCardPrediction` answers `skip: no-epoch`, as for any unconfirmed sid.
  - The card reads no epoch's `cause` or `declared_by` (`card.mjs`'s `epochOf` is derive.mjs's rule: any confirmed epoch of an unmerged family), so a `fork` epoch is predicted for exactly as a startup, clear or import epoch is.
  - Task 5 pins it through real passes: a fresh-sid fork whose copy holds the parent's copied rows and boundary starts its next span at that boundary's head, as derivation does, and replaces the parent's prediction (one file per id). Task 2 says why the `fork-qualified` skip is unchanged, Task 6 why the delivery measure is, Task 8 why the scope marker is, and Task 9 adds `fork` to the sources that never serve.
  - B2's one hook edit is in place on the spool block's source line, below README's anchor, so B3's anchors and its S6-R11 census forecast are unchanged.
- **Q17 as recommended** (the kept line, the close line naming `--purge-history`, the decommission runbook): no B3 effect. `scope/` and `card/` sit under `~/.ccrc/history`, inside the store the kept line names.
- **Q18 yes, a W2 matter**: before W2's window opens, the W2 open record carries the smallest passing point uptake computed from B1 and B3's data. No W1 task, and none in B3. B3's `card_consumed:<scope>` counters and the boundaries are among the data it reads.
- **Q19 no, not in W1**: no B3 effect. An unmapped transcript has no epoch, so it gets no prediction.
- **Prune at low disk: confirmed.** `prune --apply` is gated on reachability only and bounds its own WAL growth; B2's `history-prune-not-floor-gated` is ruled, no longer provisional, and spec §9.3 is amended. B3 does not touch prune.

**Coordinator rulings (RC1–RC4).** Every choice that awaited a ruling is ruled, and the tasks implement each as ruled. Each NEW slug is in "Deviations found".
- **RC1: accepted as the plan implements them.**
  - Every main-thread PreCompact empties the id's existing scope marker directly below `esac`, before any tail exit, and the marker block writes only a decided verdict (Task 8). This ruling is now spec §5.1's rule, "The early truncation" (rev 3.5; S16's rev 3.5 rows pin it), so it is cited there and is no departure. Without it, an undecided scope, which writes nothing, or the hookstate write's two exits before the block would leave a fresh `main` marker from an earlier compaction to serve a subagent's.
  - The hook spells four card names once each, each bound to lib (Tasks 9 and 11; D-4750 (`history-hook-card-names-once`)). §8.6 says "no new card constant beyond the reserve".
  - `.` and `..` are refused structurally, because under `scope/` and `card/` they name directories, which no write or read can open; the 224-char bound is a builtin test (Tasks 8 and 9; within B1's D-4170 (`history-id-grammar`)).
  - The reader carries no separate 512-char length test. The read's bound and the grammar (at most 145 chars) make one unreachable, which was measured (Task 9).
  - W1-e's named query ships in B3, beside the counters it reads, although §10.5 does not list `deploy/measure-history.py` among B3's contents (Task 13; D-4752 (`history-w1e-query-in-b3`)).
  - The delivery window: 40 rows, the next boundary, end-of-file past the raw-leaf grace, a copy no longer live, or 24 h. Leaves derived before the measure's first pass are never measured (Tasks 3 and 6; D-4739 (`history-card-measure-window`)).
  - The sweep makes `scope/` and `card/` (Task 5; D-4741 (`history-card-dirs-made-by-sweep`)), keeps one prediction per id (Task 5; D-4742 (`history-card-one-file-per-id`)), predicts only for the uuid the registry names (Task 5; D-4743 (`history-card-registry-names-the-session`)), predicts from the live copy written last (Task 5; D-4744 (`history-card-newest-live-copy`)), and ages purged files by their own mtime (Task 7; D-4745 (`history-purged-files-aged-by-mtime`)).
  - `history-card-files`' creator is spelled `ccd/history/sweep.mjs (through card.mjs)`, by the precedent of B1's `history-store` row, where §9.4 writes `sweep.mjs` (Task 12; D-4751 (`history-card-files-creator-through-card`)).
  - README gains a short card-line paragraph (Task 14; D-4753 (`history-readme-card-paragraph`)). CLAUDE.md's README figure is re-measured in that commit, and changed only if README crosses it (Task 14 Step 3).
  - The reserve stays at 513, as C38 pins, although the longest valid line is 145 chars (Task 10).
  - The card spells `~/.local/bin/ccrc`, as §8.6's grammar requires (Task 1). Spec rev 3.3 corrected §16's B2's D-4682 (`history-skill-literal-path`) row to agree with §8.6 (the card line `~/.local/bin/ccrc`, the skill `$HOME/.local/bin/ccrc`), so no erratum is left. B2's `HISTORY_CMD` keeps its own spelling.
- **RC2: fail closed** (D-4740 (`history-card-withdrawn-when-not-ticking`), NEW). Every scheduled pass that runs but does not run the card step withdraws every `card/<id>/<uuid>.txt`: lstat-checked, unlink only, never through a link, counted `card_withdrawn:<reason>` with one reason word per path. The paths are the ruling's (a cap pause, a floor pause, a per-chunk floor stop, a budget already spent before the card step, the recover arm, and a held, refused or unbound store) and, under its "every path", the three others a scheduled pass can take without a card step over a caught-up ingest: an ingest an unreadable roster skipped, the migrate arm, and an unreachable store. A hold with no DB open records the count on its outcome line, because nothing is counted there (IV2). Which state withdraws is lib's L1 decision, `decideCardWithdraw` (Task 3); `card.mjs` and `sweep.mjs` only measure and act (Task 5). In `consumeAndWriteCards` the budget is checked only before a WRITE, never before the consume/delete decision (Task 5). A dead timer stays a named residual in the PR body (Task 14).
- **RC3: classify each consumption by scope** (D-4738 (`history-card-consumed-counter`)). When a consumption is counted, `card.mjs` reads `scope/<id>` read-only, never through a link, and lib's `decideConsumedScope` folds it as `card_consumed:main` (the marker reads `main <uuid> <ms>`, ms not after the consumed boundary's ts and within `COMPACT_CARD_MAX_AGE` of it), `card_consumed:other` (`subagent` or `ambiguous` in that window) or `card_consumed:unknown` (anything else: overwritten, emptied, unreadable) (Tasks 3 and 5). W1-e's `served_share = served / (main + unknown)`, with `other` and `unknown` reported beside it; the mismatch share stays over served plus mismatch (Task 13).
- **RC4: recall-off parity, fail closed** (D-4749 (`history-card-recall-off-unreadable-off`)). The hook's recall-off reader treats a read that filled its read window (`CCRC_ID_MAX` characters, untrimmed) as OFF, the side that withholds the line. The parity table gains the row "130 spaces followed by the resolved generation G" (the CLI answers exit 8, the hook serves no line) and its mutant. The reader block grows, and Task 9's census measurement and expected numbers carry its new length (Task 9).

## Global Constraints

- **Base and anchors.** B3 is cut from `main` after B1 and B2 merge. Anchors into B1- and B2-created files are by content, never by line. Pre-existing anchors were measured at `f7e51156f` and are re-anchored by their quoted content at B3's base:
  - `^state="" ask_json=`: origin/main appends ` sessend=""`, so anchor on the prefix;
  - `    [[ "$src" == compact ]] && { _hook_compact_card || true; }`;
  - `    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \` (the only such line);
  - `if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi` (two spaces before `]]` and two after the function name);
  - the line `esac` that closes `case "$event" in` (`:2916` at f7e51156f; the first line after the `case` that is exactly `esac`);
  - README's `` `_hook_emit_context "$CARD" "$CARD_COMPACT"` `` sentence;
  - B1's `# >>> history-spool (spec 2026-10-05 §5.1)` and `# <<< history-spool` markers.
- **R1 (entry guards; coordinator ruling).** `sweep.mjs` and `cli.mjs` end in `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, with no top-level await, and every block B3 adds goes ABOVE that guard. `card.mjs` and `derive.mjs` have no guard. Check placement with `grep -c 'import.meta.url === pathToFileURL' <file>`, which must print 1, and `grep -nE '^(await|(const|let|var) [^=]+= *await)\b' <file>`, which must print nothing.
- **Rings by imports.**
  - `lib.mjs` imports `node:crypto` only and holds every card decision.
  - `store.mjs` stays the sole `node:sqlite` importer.
  - `card.mjs`, `derive.mjs` and `sweep.mjs` are L4: they deliver without deciding. `card.mjs` is imported only by `sweep.mjs`, and never imports `sweep.mjs` or `cli.mjs`, so there is no cycle.
  - `shared/lifecycle.ts` is L0 and imports nothing.
  - No adapter narrows a distinction: an unreadable registry, card, marker or recall-off file is never folded into absent.
- **Spec values, verbatim.**
  - The grammar, in bash and in lib, with U+2026 and U+00B7 written as themselves: `^History: node L[0-9a-f]{6,20}… \(this compaction\)( · parent N[0-9a-f]{6,20}…)? · ~/\.local/bin/ccrc history describe L[0-9a-f]{6,20}$`.
  - The card read is `IFS= read -r -N "$(( HISTORY_CARD_MAX + 1 ))"`, with one trailing LF stripped.
  - The reserve is 513 (`HISTORY_CARD_MAX + 1`). The helper's argv carries ` --max-chars 3487 --max-files 12 ` with `card/` present, and ` --max-chars 4000 ` without `card/` or under `history-off`. The variable is `HISTORY_CARD_RESERVE`.
  - `COMPACT_CARD_MAX_AGE` is 1200 s (the marker's freshness). `COMPACT_CARD_MAX_CHARS` (4000) and `CARD_TOTAL_MAX_CHARS` (6401) are unchanged: one envelope, no new budget.
  - The fold happens only when `${#v} + 1 + ${#CARD_COMPACT}` is at most `COMPACT_CARD_MAX_CHARS`, in the emitter's own unit.
  - The marker is `~/.ccrc/history/scope/<id>` = `<scope> <psid> <ms>`, at most 64 B. The card file is `~/.ccrc/history/card/<id>/<uuid>.txt`, at most 512 B, mode 0600, in 0700 directories; beside it, written first, its generation record `<uuid>.gen` (a generation or nothing, and one LF: at most 37 B, 0600; coordinator ruling R-recalloff-parity). Purged sessions' files are collected after 7 days.
  - A display prefix is `L` or `N` plus at least 6 hex (`NODE_ID_DISPLAY_MIN`, ruling RB2), unique within the family.
- **Hook contract.**
  - The hook only enqueues.
  - `_hook_history_card`, the reserve gate, the marker's early invalidation and the marker gate fork nothing: no `$( )` (not even `$(_hook_epoch_ms)` in the reader), no backticks, no `${…@…}` transformation (`@P` runs prompt expansion, B1's S1 rule), and no `jq`, `find`, `cat`, `date` or `stat`. The reader expands `EPOCHREALTIME` once, as B1's spool block does. The marker block may fork only after its builtin gates pass, because PreCompact is not on the hot path.
  - Every working variable is `local`. The hook never makes a directory, and it gains no new `case "$event"` arm (install-session-hooks parity).
  - `$'\n'` never appears inside `${…:+…}`: `nl=$'\n'` is assigned outside the quotes, because `bash --posix` does not expand it there (measured).
  - Every redirection sits under `{ …; } 2>/dev/null`, so nothing reaches stdout or stderr.
  - Every hook line that names `history-off` carries its own standalone `[[ -e` or `[[ ! -e` test (B1's O13 READ pattern; a compound `[[ -d X && ! -e …history-off ]]` fails it, measured).
  - The reader does not inherit compact-card-off, the generation gate or the card lock, and it is keyed on `psid` (lowercase UUID grammar).
  - The tail resets `HISTORY_CARD_RESERVE` and unsets `CS_SCOPE` before either is read, so neither can come from a pane's environment (the `hcat=""` precedent).
- **Citation corpus and S6-R11.**
  - B3 pays the census once, in Task 9. The hook insertion, the `:2893` edit, the README re-point and the dated census paragraph land in ONE commit, gated on the census guard's rc read green in a separate call.
  - README's quoted `ccd/session-hook.sh:2900` is re-pointed by content BEFORE the census is measured. With README stale, the census reads 22 for the hook and reds the README case (measured).
  - The instrument is the landing-order wave-1 plan's `cite-remeasure.py`, run with an ABSOLUTE scratch dir and `--files` naming every cited file the step edited. Its default swaps only `ccd/ccd` and README, and its base leg then reads red.
  - Expect `stated = base = tree` for every key, at the values the instrument prints as `stated` at B3's base (B1's and B2's merges, and other programmes', can move them, so this plan quotes no number; trust the instrument's own `stated`), with `ENTERED []` and `LEFT []`. Never `--write`.
  - The frozen corpus documents (`specs/2026-09-09-graphify-compaction-card-design.md`, `plans/2026-09-10-graphify-compaction-card-plan-a.md`) stay byte-identical.
  - New README prose carries no `file.ext:N` token (README's resolved and checked counts stay 7).
  - `session-hook.test.ts` and `single-definition.test.ts` are end-append only, with no new import line; the one in-place edit is Task 11's inside B1's end-appended O14 describe. The dated paragraph goes in the byFile map's comment block above `'ccd/ccd': <n>,`, plus one line above `expect(total, …)`, and quotes none of the instrument's anchor strings.
- **B2 rulings that bind.**
  - RB2: display prefixes of at least 6 hex.
  - RB4: fan-in runs per holding copy and per epoch. The card's parent prediction reads the same slot lists (exported from `derive.mjs`) and runs `planFanIn` itself.
  - RB5: a parser crash is recorded, not retried. A crashed boundary has no leaf, so its delivery is never measured (a known undercount).
  - RB6 and RB12–RB14: B3 adds no `WRITING_FORMS` entry and no `--op` verb, so the `GT_FORMS` and recovering-forms CONTROLs stay untouched. Nothing on the recover arm writes or consumes cards, because `recoverPass` never ticks; the pass that takes the arm withdraws every prediction before it (ruling RC2).
  - Prune is reachability-gated, never floor-gated (`history-prune-not-floor-gated`, ruled by the operator 2026-10-07, spec rev 3.4), and B3 does not touch it.
- **B2's fork spooling (ruled Q16) binds too.** A SessionStart(fork) writes a spool line and chains a `fork` epoch, or confirms the existing one for the same sid. B3 reads no epoch cause and edits no spool-block line; its fork pins are Task 5's spooled-fork case and Task 9's fork row.
- **Single definition.**
  - Every new constant and vocabulary is declared once, in `lib.mjs`.
  - Paths are built from `historyPaths(home).root` (or `HISTORY_ROOT_REL`) plus those names, never re-spelled (B2's `RECALL_OFF_DIR` precedent). B1 pins `historyPaths`' exact key set, so B3 adds no key.
  - Bash spells the grammar, the 512 cap and the two directory names once each, bound to lib by Task 11's end-appended single-definition describe. No `ccd/history/*.mjs` spells `/history-off` outside `SWITCHES`.
  - `lib.d.mts` is hand-written: every new export is declared exactly once, in the same commit (`skipLibCheck` hides a duplicate, so count them).
- **Deviations.** This plan's departures are numbered D-4736 through D-4753 ("Deviations found"); a slug B1 or B2 defined keeps its issued number, cited as "B1's D-N" or "B2's D-N". A departure you find that the plan does not list takes the next unused number from the wave's run block, named in the brief, and is defined in "Deviations found" in the em-dash form in the commit that first cites it. Never write a number you were not issued. Existing `D-N` refs in source comments are history: read them as authoritative and never delete them.
- **Tests.**
  - Fixture HOMEs only: `makeHistoryBox` and `mkTmp`, and `session-hook.test.ts`'s module `home`, whose stub tmux answers `cc-demo-quiet-basin`. `tmux`, `claude`, `gh` and `curl` are poisoned. Scrub `CLAUDECODE`, `CLAUDE_CONFIG_DIR`, `TMUX`, `CCRC_RECALL_*` and `HISTORY_TEST_*`.
  - Run from `server/` with `./node_modules/.bin/vitest run test/<f>.test.ts`, in the FOREGROUND, with a timeout of at least 600000 ms; never bare `npx`.
  - Red-first. Every guard ships with a mutant measured red, then green (IV6). Mutation scratch lives under `.superpowers/sdd/history-w1-b3/scratch`, never in `git stash`.
  - There are two mutation runners: Task 1's `mutate.mjs` (Tasks 1–7, JSON mutants) and Task 8's `mutate.py` (Tasks 8–11, Python mutants). Both keep their pristine copies in `scratch/keep/`, each named by its file's path with `/` written as `__`, so `mutate.mjs`'s header loop restores either runner's leftovers. Each refuses to start while a copy is left there, so never run them concurrently. Tasks 12 and 13 mutate by hand with their own saved copies.
  - The S6-R11 instrument runs only through Task 8's `cite-run.sh`, which copies every file the instrument touches to `scratch/keep-cite/` first (Tasks 8–11). Every commit step in Tasks 1–11 is gated on `keep/` (and from Task 8, `keep-cite/`) being empty, read in its own call.
  - Sweep and hook-spawn tests skip on darwin; lib tests run there. A red in a known load-flake file (`session-hook` among them) is re-run alone before it is called a break.
  - The new `history-card.test.ts` joins `ci.yml`'s node-floor heredoc in the commit that creates it.
- **Env.** In `ccd/history/*.mjs`, `process.env` is read only for `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION`, and `card.mjs` reads none. Children are launched as `node --no-warnings`, never with `{ env: process.env }`.
- **Safety and publicity.** No worker step touches the live fleet, tmux, `~/.cc-sessions`, `~/.cc-limits`, `~/.ccrc`, the live store, journal or export, or any account home. No `ccd`, `ccrc` or history verb runs on the box, and no secret file's contents are printed. The repo is public, so plan text, PR text and fixtures name no host, user, account, wrapper, home, real pool, session id, IP or docserver URL. Fixture paths look like `/home/u/tree`.
- **CLAUDE.md's README figure** is a conflict hot spot between B1, B2, B3, B4 and every other programme that grows README. It is re-measured in the commit that grows README, and only if README grows (`pools-prose`: within 100 lines).

## Review Focus

These are the inputs most likely to break the plan's synthetic fixtures. Each one has a test in its owning task.

1. **A main compaction writes `main <psid> <ms>`. Within 20 minutes a subagent of the same pane compacts with the parent's session_id, and its scope is undecided** (`_hook_compact_scope` answers rc 1, or the unset arm's payload read fails), **or its PreCompact exits before the marker block** (a hookstate write or `mv` that fails on a full disk or an unwritable registry, or a failed `jq` compose). Writing no marker alone would leave the earlier `main` marker fresh for this psid, which is why spec §5.1 states "The early truncation" (rev 3.5).
   - Expected: no History line reaches the subagent's SessionStart(compact) context. Directly below `esac`, before any tail exit, a builtin `{ : > …; } 2>/dev/null` empties the id's existing marker on every main-thread PreCompact. The block after the card's call writes only a decided verdict, and the reader treats an empty marker as absent.
   - Owning tasks:
     - **Task 8**: `an undecided verdict empties a fresh main marker this psid left, and creates nothing where none was`, `a hookstate write that fails empties an older fresh main marker, so a following SessionStart(compact) serves no line` (both red under mutant `T8-M5-no-early-invalidation`), and `S16: scope rc 1 (no readable transcript) writes no marker` (mutant `T8-M11-empty-scope-as-main`);
     - **Task 9**: the `empty` row of `C37: a scope marker reading %s serves no line`, and `C37: end to end — a main compaction serves, a subagent's does not (Task 8 writes the marker)`.
   - Ruled RC1, now spec §5.1's "The early truncation" (rev 3.5) and S16's rev 3.5 rows: cited, not a departure.
2. **Two compactions of one session land between two ticks, the boundary that consumed a prediction is ingested on a pass that ends short of end-of-file or of its budget, or a pass cannot run the card step at all**, so the end-of-file-gated writer cannot rewrite the file.
   - Expected: the consumer runs on every tick that runs the card step, whatever the end-of-file state and whatever budget is left: the budget bounds a write, never the consume/delete decision (ruling RC2). As soon as the store holds a boundary whose span start moved past the file's predicted leaf, the file is deleted (counted `card_consumed:<scope>`); it is rewritten only at end-of-file, and only while the run's budget is left. A second SessionStart after that ingest finds no file and serves nothing. A second compaction before the ingest serves the stale line, which the delivery measure counts as `card_id_mismatch`, never as `card_served`.
   - A scheduled pass that runs but does not run the card step withdraws every prediction instead, counted `card_withdrawn:<reason>` (ruling RC2: fail closed): a cap or floor pause, a per-chunk floor stop, an ingest an unreadable roster skipped, a budget already spent before the card step (after the step's consume/delete has run), the recover or migrate arm, and a held, refused, unbound or unreachable store. A second compaction in any of those states finds no file and serves nothing.
   - Owning tasks:
     - **Task 5**: `the end-of-file gate: a torn last line holds the write; a boundary ingested on a pass that ends short of end-of-file consumes and deletes the prediction` (mutants `8.6 Timing: a consumed prediction kept until end-of-file` and `… written short of end-of-file`); `a floor pause withdraws every prediction …` (mutants `RC2: the tick withdraws nothing` and `RC2: a withdrawal through a linked card/<id>`); `a registered recovery step withdraws the card …` (mutant `RC2: the recover, migrate and hold arms withdraw nothing`); `a budget spent before the card step: the consume and delete still run …` (mutants `RC2: the budget gates the consume and delete` and `RC2: a write past the budget`); `a hold withdraws too …` (mutants `RC2: a held pass withdraws nothing`, `RC2: a hold with no DB withdraws nothing`, `RC2: a withdrawal on a hold with no DB left unrecorded` and `RC2: a withdrawal through a linked card/`); and every case that writes a prediction (mutant `RC2: a tick that ran its card step withdraws anyway`);
     - **Task 2**: `decideCardFile`'s table rows `the leaf moved, off end-of-file` (delete, consumed) and `the leaf moved, at end-of-file` (write, consumed);
     - **Task 3**: `decideCardWithdraw` names a reason for every pass that runs no card step …, one row per path;
     - **Task 6**: `an attachment naming the derived leaf counts card_served, one naming another leaf card_id_mismatch, none at all nothing; each by producer`.
   - Residuals, named in the PR body's fixed `### Known W1-e distortions` list (Task 14): two compactions inside one tick; and a pass that never runs (the sweep's timer dead) or meets the store's write lock (busy, which only a test injects), which neither consumes nor withdraws, so a second compaction in that state is served the last prediction.
3. **Standing cards (graph, hold, ccrc) are present on the compaction's SessionStart.** `_hook_emit_context` joins the standing text and the compact subject with ONE space at the `:97` clip, so in the transcript attachment the History line follows the standing text on the same physical line. C18's "first line" holds only inside the compact positional.
   - Expected: the delivery measure finds `History: node L……` anywhere in the attachment's string leaves (`cardIdsIn` is unanchored) and counts `card_served`. The compact positional's first line is still the History line.
   - Owning tasks:
     - **Task 3**: `cardIdsIn finds the History id at a line start, after standing-card text on the same line, and inside nested string-array content`;
     - **Task 6**: the first sweep case, whose served line is planted after `STANDING` (mutant `W1-e: the served line read only at a line start`);
     - **Task 9**: `with standing cards present the compact positional still begins with the line`.
   - B2's CLI pasted-line path is unchanged; the PR body's distortions list notes it (Task 14).
4. **recall-off parity between the hook and the CLI.** The rows: `recall-off/<id>` unreadable (mode 000), a directory or a symlink; content with a trailing LF or surrounding spaces; 130 spaces followed by the resolved generation; `CCRC_SESSION_GENERATION` malformed while `$REG/<id>.generation` holds the assigned UUID; `.generation` unreadable or symlinked; and, under coordinator ruling R-recalloff-parity, neither readable: an invalid env generation with an unreadable or absent `.generation` while `recall-off/<id>` holds the id's newest family's G (the CLI exits 8), an empty recall-off file against a legacy or a G newest family, no generation recorded at all, and a linked or malformed record; and, under coordinator ruling R-recalloff-trim (the final check's R1), a no-break space (U+00A0) or a byte-order mark (U+FEFF) before the resolved generation G.
   - Expected: for every row the hook serves the line if and only if the CLI recalls (`decideRecallOff` answers `none` or `stale`) over the generation the CLI resolves: the env's, else the registry's (lib `resolveGeneration`), else, under `'newest'`, the id's newest family's (`''` for a legacy family or none), never `resolveGeneration(…).value ?? ''`. The hook cannot read the store, so under `'newest'` it reads the record the sweep writes beside the prediction, `card/<id>/<psid>.gen` (Task 5, by the CLI's rule; Task 2's `decideCardGenFile`), and with no usable record a recall-off file that exists withholds the line (fail closed). The hook reads `recall-off/<id>` with one bounded builtin read of `CCRC_ID_MAX` (128) characters, `_ct_read`'s width, and a read that fills that window is OFF before it is trimmed or compared (ruling RC4: fail closed). `.generation` and the record are read through `_ct_read` (rc 0 read, 1 absent, 2 unmeasurable), never through a link.
   - The one deliberate asymmetry (coordinator ruling R-recalloff-trim): the hook trims `recall-off/<id>` of ASCII whitespace only (space, tab, LF, VT, FF, CR, in every locale), where B2's `presenceOf` and `decideRecallOff` trim with JS `String.prototype.trim`, which also strips U+00A0, U+FEFF and the Unicode spaces. So a value that, after the hook's trim, holds any character outside the generation grammar (empty, or `[0-9a-f-]`) withholds the line, whatever the CLI answers. It is in the safe direction: the hook withholds where the CLI may recall (a no-break space before another generation), and never serves where the CLI answers exit 8 (a no-break space before this one).
   - Owning tasks: **Task 9**, `C19/C68 (card half), recall-off parity: %s` (29 rows, each expectation computed by B2's own `decideRecallOff` and `resolveGeneration` and, under `'newest'`, the fixture's record standing for the store's newest family) with `CONTROL: the parity table reaches every answer, so it cannot pass by serving always or never`; mutants `T9-M5` to `T9-M8`, `T9-M26-recall-off-equality`, `T9-M30-recall-off-window`, `T9-M34` to `T9-M38` and `T9-M39-recall-off-grammar`. **Task 5**, `the generation record: …`, which measures the sweep's record against B2's `familiesOf` (the CLI's own newest-family read) and holds a prediction whose record cannot be written, and `a record that cannot be written beside a kept prediction …` (coordinator ruling R-recalloff-keep, the final check's R2), which removes the kept prediction too; **Task 2**, `decideCardGenFile`'s table (a stale record never stands beside a prediction).
   - Ruled RC4: the CLI keeps 4,096 bytes where the hook reads 128 characters, so a file a hand edit pads past character 128 is OFF in the hook. With this generation after the padding the CLI answers exit 8 too (the new parity row). With anything else after the padding (another generation, or text where no generation resolves) the hook withholds a line the CLI's stale answer would not: the side the ruling accepts.
5. **Prediction parity with derivation.** The cases: the first compaction of an epoch (span start = the holding copy's first stored row under B2's `copyRows` filter); later compactions (`head_uuid ?? uuid` of the copy's previous boundary); several live copies of one transcript after a swap carry; a leaf not yet final in the run; the 8th leaf of a run in one holding copy; a plain id already bound to another boundary (two copies of one transcript compacted after one head, §6.1's fork); a spooled SessionStart(fork) under a fresh sid, whose copy holds the parent's copied rows and boundary (ruled Q16).
   - Expected: after the compaction lands and `derive.mjs` mints its leaf, the derived leaf id starts with the printed `L` prefix. For the 8th leaf, the derived depth-1 parent starts with the printed `N` prefix: the slot list comes from `derive.mjs`'s exported reader, and the span formula from `planSpans` itself. A fork-qualified next leaf writes no file (`card_skipped:fork-qualified`). A fork skip still carries the plain id the next leaf would have had, so a prediction consumed just before a fork skip is still counted `card_consumed:<scope>`. A spooled fork's next span starts at the head of the last boundary its copy holds, the parent's copied one included, exactly where derivation starts it, and its prediction replaces the parent's.
   - Owning tasks:
     - **Task 2**: `the span start: … equal to planSpans' over the whole copy` and `the leaf is the plain id; its depth-1 parent is predicted when it is the 8th final, unparented slot of the run`;
     - **Task 4**: `the parents deriveParents mints are exactly parentId over planFanIn's groups of those lists: …`;
     - **Task 5**, through real sweep passes:
       - `the first compaction: …`;
       - `the 8th leaf of a run: …`;
       - `a leaf not final in the run stops the prediction: …`;
       - `a next leaf the fork rule would qualify: no card, counted card_skipped:fork-qualified; CONTROL: …`, whose two copies also pin the newest-copy rule;
       - `a consumed prediction whose next leaf the fork rule would qualify: deleted and still counted card_consumed`;
       - `a spooled fork (ruled Q16): …` (mutant `6.1: a fork's copied boundaries ignored by the span start`).
6. **A main-thread compaction the hook scoped `ambiguous` (a fan-out writing at the time) consumes a prediction.** It can never carry a line, and W1-e's served share must not count it as a miss.
   - Expected: the consumption is counted `card_consumed:other`, out of `served_share`'s denominator and reported beside it; a `main` marker inside the consumed boundary's window counts `card_consumed:main`; a marker that is absent, emptied, unreadable, a link, another uuid's or outside the window counts `card_consumed:unknown`, which stays in the denominator (ruling RC3).
   - Owning tasks:
     - **Task 3**: `decideConsumedScope folds the marker …` (one row per shape) and `consumedBoundaryTs names the boundary whose span the file printed …`;
     - **Task 5**: `a consumption is counted by the scope marker its compaction's PreCompact left …` (mutants `RC3: a consumption counted unscoped`, `RC3: a scope marker read through a link` and `RC3: the consumed boundary's time never measured`);
     - **Task 13**: `W1-e: the served share is over main and unknown consumptions …`.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | Appended at the end: the card vocabulary (`CARD_DIR`, `SCOPE_DIR`, `CARD_LINE_MAX`, `CARD_DESCRIBE_CMD`, `CARD_LINE_PATTERN`, `CARD_LINE_RE`, `PURGED_FILES_GRACE_MS`, `CARD_MEASURE_ROWS`, `CARD_MEASURE_MAX_WAIT_MS`, `CARD_ATTACHMENT_MAX_BYTES`, `SCOPE_MARKER_MAX_AGE_MS`, `CARD_CONSUMED_SCOPES`, `CARD_WITHDRAW_REASONS`); `cardDirOf`, `cardFileOf`, `scopeMarkerOf`; `cardLine`; `predictedSpanStart`, `planCardPrediction`, `decideCardFile`, `decideCardGenFile` (ruling R-recalloff-parity); `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery`, `decidePurgedEntry`; `consumedBoundaryTs`, `decideConsumedScope` (ruling RC3); `decideCardWithdraw` (ruling RC2) | L1 | 1, 2, 3 |
| `ccd/history/lib.d.mts` | modify | One hand-written declaration per new export, plus `CardBoundary`, `CardSlot`, `CardPredictionInputs`, `CardPrediction`, `CardBoundaryAt`, `CardConsumedScope`, `CardWithdrawReason` and `CardPassFacts`; reuses B1's `Presence` | types | 1, 2, 3 |
| `ccd/history/derive.mjs` | modify | Behaviour-neutral extraction: `deriveEpochParents`' slot loop becomes the exported `epochCopySlots`; `holdingCopyOf` wraps the private `holdingCopy` | L4 | 4 |
| `ccd/history/card.mjs` | create | `ensureHistoryDirs`; `consumeAndWriteCards` (predict, consume, write `card/<id>/<uuid>.txt` temp-then-rename 0600, with its generation record `card/<id>/<uuid>.gen` written first (ruling R-recalloff-parity), one file per id, end-of-file-gated writes that the budget bounds, each consumption counted by its compaction's scope marker); `withdrawCards` (every prediction unlinked on a pass that runs no card step); `measureCardDelivery` (derivation step `card-measure`, version 1); `cardStep`; `collectPurgedHistoryFiles`. No entry guard. Spec §6.4's `card.mjs` row (W1-B3) gives its ring and imports, and its `sweep.mjs` row admits the `./card.mjs` import | L4 | 5, 6, 7 |
| `ccd/history/sweep.mjs` | modify | One import from `card.mjs`; `makeIngestCtx` hands `readRegPresence`; in `tick`, `cardStep` below `deriveNodes` with `withdrawCards` below it, `ensureHistoryDirs` below B1's spool-directory line (`if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);`), and the collector above `markScan`; `tick`'s doc comment gains a numbered item per new step (B1's F39 list); `withdrawCards` in `holdPass`, on `scheduledPass`'s `held` path and below its `planRun` line. All above the R1 guard | L4 | 5, 7 |
| `ccd/session-hook.sh` | modify | Above `state="" ask_json=`: the four constants and `_hook_history_card`. In place: the compact guard's call and `:1515`'s reserve. Tail: the scope marker's early invalidation directly below `esac`, the reserve's reset and gated set, `unset CS_SCOPE`, the `history-scope` block; the turn-marker note and B1's spool-block sentence reworded | hook (bash) | 8, 9, 10 |
| `README.md` | modify | Task 9: the quoted emitter call's `ccd/session-hook.sh:<n>` re-pointed by content, line-neutral. Task 14: an 8-line card-line paragraph in B2's history section, with no `file:N` token | docs (citation corpus) | 9, 14 |
| `CLAUDE.md` | modify, only if needed | The `README.md (~N lines)` figure, re-measured by the round-to-100 rule | docs | 14 |
| `shared/lifecycle.ts` | modify | The `history-scope-markers` and `history-card-files` rows, before the closing `];` | L0 | 12 |
| `server/test/lifecycle.test.ts` | modify | `HISTORY_LANDED` gains `'B3'`; two `declares …` cases and one case binding the rows' numbers to lib | test | 12 |
| `server/test/history-card.test.ts` | create | The pure lib cases (on darwin too), the withdrawal and scope-fold tables among them; the slot-list cases; the sweep cases for the writer, consumer, parity, end-of-file gate, modes, registry, the withdrawal on each pass that runs no card step, the consumption's scope, delivery counters and window, and the collector (each sweep describe skips on darwin) | test | 1–7 |
| `server/test/history-lib.test.ts` | modify | In place, one row in B1's ring census `RINGS`: `'card.mjs'` (L4, forbidding `node:sqlite`, `./sweep.mjs` and `./cli.mjs`), because `every ccd/history/*.mjs has a ring` compares the directory with `RINGS` exactly | test | 5 |
| `server/test/historyFixtures.ts` | modify | Appended: `sessionStartAttachment({ uuid, ts, text, … })` over B1's `attachmentRow` | test helper | 6 |
| `server/test/session-hook.test.ts` | modify | End-appended describes for the scope marker, the card line and the reserve (no import line); the dated S6-R11 paragraph beside the byFile map and the headline (comments only) | test (citation corpus) | 8, 9, 10 |
| `server/test/single-definition.test.ts` | modify | In place in B1's O14 describe: `VOCABS` gains B3's lib names, and one case title is reworded. End-appended: the describe binding the hook's grammar, cap, directory names and marker age to lib | test (citation corpus) | 11 |
| `deploy/measure-history.py` | modify | `w1e_statistic` and the report's `w1e` key (served over main plus unknown consumptions, other and unknown reported beside it; mismatch over served plus mismatch; null on a zero denominator); classifies no model (O32) | operator instrument | 13 |
| `server/test/measure-history.test.ts` | modify | An end-appended W1-e describe over planted counters | test | 13 |
| `.github/workflows/ci.yml` | modify | The node-floor heredoc gains `test/history-card.test.ts`, in Task 1's commit | CI | 1 |

---

### Task 1: lib: card and scope vocabulary, paths, and the line builder

**Files:**
- Modify: `ccd/history/lib.mjs` (B1-created; B2 appends to it). Append one block at the END of the file; `lib.mjs` has no entry guard. The block reads B2 Task 1's module-private `escapeRe`, the line `const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');`, which sits above every block B3 appends, and B2's exports in the same module by name.
- Modify: `ccd/history/lib.d.mts` (B1-created, hand-written): append one block at the end.
- Create: `server/test/history-card.test.ts` (this task's describe is pure and runs on darwin; Tasks 5-7 append describes that skip there).
- Modify: `.github/workflows/ci.yml` (pre-existing): one line in the `node-floor` job's `Test` step heredoc. Measured at `f7e51156f`, that heredoc opens at `:727` (`          cat > "$RUNNER_TEMP/tests.txt" <<'EOF'`) and closes at `:729` (`          EOF`); B1 and B2 add lines between, so anchor on the closing `          EOF` line of that heredoc, by content.
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutate.mjs`, `scratch/keep/`, `scratch/mutants-task1.json`.

**Interfaces:**
- Consumes:
  - B1 `lib.mjs`: `CARD_PREFIX` (`'History: '`), `idOk(id): boolean`, `UUID_RE`, `historyPaths(home).root`, `leafId(ccrcId, ccUuid, spanStartUuid, boundaryUuid?)`.
  - B2 `lib.mjs` (Task 1): the module-private `escapeRe(s)`, and `extractNodeId(raw): { ok: true; id: string } | { ok: false; error: string; hint?: string }` (the test reads it back).
- Produces (`lib.mjs`, each declared once in `lib.d.mts`):
  - `export const CARD_DIR = 'card'`, `export const SCOPE_DIR = 'scope'`, `export const CARD_LINE_MAX = 512`;
  - `export const CARD_DESCRIBE_CMD = '~/.local/bin/ccrc history describe'`;
  - `export const CARD_LINE_PATTERN: string`, equal character for character to the spec §8.6 grammar, built from `CARD_PREFIX` and `CARD_DESCRIBE_CMD`; `export const CARD_LINE_RE = new RegExp(CARD_LINE_PATTERN)`;
  - `export const PURGED_FILES_GRACE_MS = 7 * 24 * 60 * 60 * 1000`;
  - `export function cardDirOf(home: string, id: string): string` → `<home>/.ccrc/history/card/<id>`;
  - `export function cardFileOf(home: string, id: string, uuid: string): string` → `<home>/.ccrc/history/card/<id>/<uuid>.txt`;
  - `export function scopeMarkerOf(home: string, id: string): string` → `<home>/.ccrc/history/scope/<id>`;
  - each throws `TypeError` before forming a path when `id` fails `idOk` or `uuid` fails `UUID_RE`;
  - `export function cardLine(i: { leaf: string; parent?: string | null }): string`, which throws `TypeError` on any line `CARD_LINE_RE` refuses.
  - `server/test/history-card.test.ts`, its module-scope `libCard` namespace import, `SPEC_GRAMMAR`, `SPEC_EXAMPLE`, `HEX20`.
  - The gitignored mutation runner `.superpowers/sdd/history-w1-b3/scratch/mutate.mjs`, which Tasks 2-7 reuse.
- Later consumers: Task 2 (`cardLine`, `CARD_LINE_RE`), Task 3 (`PURGED_FILES_GRACE_MS`), Task 5 (`CARD_DIR`, `SCOPE_DIR`, `CARD_LINE_MAX`, `cardDirOf`, `cardFileOf`, and `scopeMarkerOf` for the consumption's scope read), Task 7 (`SCOPE_DIR`), Task 11 (binds the hook's literals to `CARD_LINE_PATTERN`, `CARD_LINE_MAX`, `CARD_DIR`, `SCOPE_DIR`, and adds those four and `CARD_DESCRIBE_CMD` to O14's `VOCABS`), Task 12 (`PURGED_FILES_GRACE_MS`, `CARD_LINE_MAX`).

**Spec:**
- §8.6 Shape and "The grammar gate" (6 hex after `L`/`N`, rev 3.3); §5.1, §5.2 (`scope/` and `card/` under the root); §9.4 (the roots of `history-scope-markers` and `history-card-files`, and their 7-day collectors); §8.2 and §8.9 C66's shape (`idOk` before any path); §13 (single definition).
- Pins: this task's plan pins (the grammar equals the spec's; the builder answers only grammar-valid lines, the longest 145 chars; the path helpers refuse `.`, `..`, `../x`, a 225-char id and a non-lowercase-UUID uuid before forming a path). The hook's half of each binding is Task 11's.
- Departures: B1's D-4170 (`history-id-grammar`) (every id and uuid checked before it becomes a path); D-4736 (`history-card-fold-and-reserve`) (`CARD_LINE_MAX` is the spec's 512 cap, the reserve its + 1; the longest grammar-valid line is 145 characters, and the cap is not tightened here); B2's D-4682 (`history-skill-literal-path`) (the card spells `~/.local/bin/ccrc`, the grammar's spelling; spec rev 3.3 corrected the slug's §16 row to agree with §8.6, the card line `~/.local/bin/ccrc` and the skill `$HOME/.local/bin/ccrc`, so the spec now agrees and no erratum is left: ruling RC1).

Choices this task makes:
- **The path helpers check first** (B1's D-4170 (`history-id-grammar`)): `cardDirOf`, `cardFileOf` and `scopeMarkerOf` run `idOk` on the id, and `cardFileOf` runs `UUID_RE` on the uuid, before any path is formed, and throw `TypeError` otherwise. The hook's half of the grammar (the 224-char builtin bound; `.` and `..` refused structurally) is Tasks 8 and 9's.

- [ ] **Step 1: Confirm the B1 and B2 names this task builds on.** From the repository root:

```bash
grep -c "^const escapeRe = (s) => s.replace" ccd/history/lib.mjs                                          # 1
grep -c "^export const CARD_PREFIX = 'History: ';$" ccd/history/lib.mjs                                   # 1
grep -c "^export function extractNodeId(\|^export function displayPrefixes(\|^export function planSpans(\|^export function decideLeafId(\|^export function planFanIn(" ccd/history/lib.mjs   # 5
grep -c "^export const CARD_DIR\|^export const SCOPE_DIR\|^export function cardLine(" ccd/history/lib.mjs # 0
```

Expected: `1`, `1`, `5`, `0`. Anything else means B2 is not merged at this base, or this task already ran: stop and report.

- [ ] **Step 2: Write the failing tests.** Create `server/test/history-card.test.ts`:

```ts
// server/test/history-card.test.ts: the card line's sweep half (spec 2026-10-05 §8.6, §5.1, §5.2, §9.2 step 6,
// §9.4, §10.7 W1-e; W1-B3 plan Tasks 1-7).
//   - Tasks 1-3: pure lib cases (the vocabulary, the line, the prediction, the file, delivery and purge decisions).
//     They run on darwin too.
//   - Task 4: derive.mjs's exported slot lists, in-process against a store built by hand.
//   - Tasks 5-7: the sweep's card writer, delivery measure and collector, through REAL sweep passes in fixture HOMEs
//     (historyHelpers' makeHistoryBox). Each of those describes calls skipOnDarwin() inside its own body, so the pure
//     describes above still run on darwin.
// Nothing here reads or writes the live ~/.ccrc, a registry or an account home.
import { describe, it, expect } from 'vitest';
import * as libCard from '../../ccd/history/lib.mjs';

/** Spec §8.6's grammar, as the spec spells it. */
const SPEC_GRAMMAR = String.raw`^History: node L[0-9a-f]{6,20}… \(this compaction\)( · parent N[0-9a-f]{6,20}…)? · ~/\.local/bin/ccrc history describe L[0-9a-f]{6,20}$`;
/** Spec §8.6's example line (rev 3.3). */
const SPEC_EXAMPLE = 'History: node L03a9c1… (this compaction) · parent N7c1e2f… · ~/.local/bin/ccrc history describe L03a9c1';
const HEX20 = '0123456789abcdef0123';

describe('the card line: vocabulary, grammar, paths and line builder (spec 8.6, 5.2; W1-B3 Task 1)', () => {
  it('the directories, the cap, the describe command and the purge grace are spelled once, in lib', () => {
    expect(libCard.CARD_DIR).toBe('card');
    expect(libCard.SCOPE_DIR).toBe('scope');
    expect(libCard.CARD_LINE_MAX).toBe(512);
    expect(libCard.CARD_DESCRIBE_CMD).toBe('~/.local/bin/ccrc history describe');
    expect(libCard.PURGED_FILES_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('CARD_LINE_PATTERN is the spec grammar character for character, and it opens with CARD_PREFIX', () => {
    expect(libCard.CARD_LINE_PATTERN).toBe(SPEC_GRAMMAR);
    expect(libCard.CARD_LINE_PATTERN.startsWith(`^${libCard.CARD_PREFIX}node `)).toBe(true);
    expect(libCard.CARD_LINE_RE.source).toBe(new RegExp(SPEC_GRAMMAR).source);
  });

  it('the grammar takes the spec example and its parent-less form, and refuses trailing text, a newline, upper case, 5 hex, an N leaf, an L parent and another path', () => {
    const re = libCard.CARD_LINE_RE;
    expect(re.test(SPEC_EXAMPLE)).toBe(true);
    expect(re.test('History: node L03a9c1… (this compaction) · ~/.local/bin/ccrc history describe L03a9c1')).toBe(true);
    for (const bad of [
      `${SPEC_EXAMPLE} && rm -rf /`, `${SPEC_EXAMPLE}\nextra`, SPEC_EXAMPLE.replace('L03a9c1…', 'L03A9C1…'),
      SPEC_EXAMPLE.replace('L03a9c1…', 'L03a9c…'), SPEC_EXAMPLE.replace('node L03a9c1', 'node N03a9c1'),
      SPEC_EXAMPLE.replace('parent N7c1e2f', 'parent L7c1e2f'), SPEC_EXAMPLE.replace('~/.local', '$HOME/.local'),
    ]) expect(re.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it('cardLine writes the spec example exactly; 6- and 20-hex ids with and without a parent pass the grammar, the longest in 145 characters', () => {
    expect(libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' })).toBe(SPEC_EXAMPLE);
    expect(libCard.cardLine({ leaf: 'L03a9c1' })).toBe('History: node L03a9c1… (this compaction) · ~/.local/bin/ccrc history describe L03a9c1');
    const pairs: Array<[string, string | null]> = [['L03a9c1', null], [`L${HEX20}`, `N${HEX20}`], [`L${HEX20}`, null], ['L03a9c1', `N${HEX20}`]];
    for (const [leaf, parent] of pairs) {
      const line = libCard.cardLine({ leaf, parent });
      expect(libCard.CARD_LINE_RE.test(line), line).toBe(true);
      expect(line.length, line).toBeLessThanOrEqual(libCard.CARD_LINE_MAX);
    }
    expect(libCard.cardLine({ leaf: `L${HEX20}`, parent: `N${HEX20}` })).toHaveLength(145);
  });

  it('cardLine throws on an N leaf, an L parent, upper case, 5 or 21 hex digits, or anything else the grammar refuses', () => {
    const bad: Array<{ leaf: string; parent?: string | null }> = [
      { leaf: 'N03a9c1' }, { leaf: 'L03a9c1', parent: 'L7c1e2f' }, { leaf: 'L03A9C1' }, { leaf: 'L03a9c' },
      { leaf: `L${HEX20}0` }, { leaf: 'L03a9c1 x' }, { leaf: 'L03a9c1', parent: 'N7c1e2f\nx' },
    ];
    // The builder's own message, not just any TypeError: before the lib block exists, calling the missing export
    // throws `TypeError: libCard.cardLine is not a function`, which a bare toThrow(TypeError) would accept.
    for (const b of bad) expect(() => libCard.cardLine(b), JSON.stringify(b)).toThrow(/^cardLine: not a card line/);
  });

  it('B2 describe reads the line this builder writes: extractNodeId takes its structural leaf id', () => {
    expect(libCard.extractNodeId(libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' }))).toEqual({ ok: true, id: 'L03a9c1' });
    expect(libCard.extractNodeId(libCard.cardLine({ leaf: `L${HEX20}` }))).toEqual({ ok: true, id: `L${HEX20}` });
  });

  it('the path helpers run idOk on the id and the UUID grammar on the uuid before any path is formed (C66 shape)', () => {
    const home = '/home/u';
    const U = '0189abcd-1234-4678-9abc-0000000000c1';
    expect(libCard.cardDirOf(home, 'demo-quiet-basin')).toBe('/home/u/.ccrc/history/card/demo-quiet-basin');
    expect(libCard.cardFileOf(home, 'demo-quiet-basin', U)).toBe(`/home/u/.ccrc/history/card/demo-quiet-basin/${U}.txt`);
    expect(libCard.scopeMarkerOf(home, 'demo-quiet-basin')).toBe('/home/u/.ccrc/history/scope/demo-quiet-basin');
    expect(libCard.cardDirOf(home, 'x'.repeat(224))).toBe(`/home/u/.ccrc/history/card/${'x'.repeat(224)}`);
    for (const id of ['.', '..', '../x', 'a/b', '', 'x'.repeat(225)]) {
      expect(() => libCard.cardDirOf(home, id), id).toThrow(TypeError);
      expect(() => libCard.cardFileOf(home, id, U), id).toThrow(TypeError);
      expect(() => libCard.scopeMarkerOf(home, id), id).toThrow(TypeError);
    }
    for (const uuid of [U.toUpperCase(), `${U}.txt`, '../x', '']) {
      expect(() => libCard.cardFileOf(home, 'demo-quiet-basin', uuid), uuid).toThrow(TypeError);
    }
  });
});
```

The ellipsis and the middle dot in `SPEC_GRAMMAR`, `SPEC_EXAMPLE` and the cases are the characters U+2026 (`…`) and U+00B7 (`·`) written as themselves, never as escapes (an agent's write can decode a backslash-u escape into the character, or the reverse). Check after writing: `grep -c '…' server/test/history-card.test.ts` is at least 6, and `grep -c '\\u2026\|\\u00b7' server/test/history-card.test.ts` is `0`.

- [ ] **Step 3: Put the new file on the floor leg.** In `.github/workflows/ci.yml`, in the `node-floor` job's `Test` step, add this line directly above the heredoc's closing `          EOF` line, at the same ten-space indentation as the other lines:

```
          test/history-card.test.ts
```

B1's `ci-pipeline.test.ts` pin derives the list from every `server/test/history-*.test.ts`, so the new file reds it until this line exists; the pin sorts both sides, so the line's position does not matter. An edit under `.github/` makes the PR's CI select the full suite: the coordinator dispatches that run, never the worker.

- [ ] **Step 4: Run the tests and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
```

Expected: 7 failed. The first case with `expected undefined to be 'card'`; the pattern case with `expected undefined to be '^History: node …'`; the grammar case with `Cannot read properties of undefined (reading 'test')`; the builder, extractNodeId and path cases with `libCard.cardLine is not a function` / `libCard.cardDirOf is not a function`; the cardLine-throws case with `expected [Function] to throw error matching /^cardLine: not a card line/ but got 'libCard.cardLine is not a function'`. That case asserts the builder's own message, so a missing builder cannot pass it.

- [ ] **Step 5: Implement the lib block.** Append to the end of `ccd/history/lib.mjs`:

```js

// ===========================================================================
// The card line (spec 2026-10-05 §8.6, §5.1, §5.2, §9.4; W1-B3 plan Tasks 1-3). Pure. The sweep's card.mjs (L4)
// measures the store, the registry and the history root's files and hands the facts in; the hook spells the
// grammar, the cap and the two directory names once more in bash, bound to these by single-definition.test.ts
// (W1-B3 Task 11). Every id that becomes a path passes idOk first, and every uuid UUID_RE
// (D-4170).
// ===========================================================================

/** `~/.ccrc/history/card/<id>/<uuid>.txt`: the sweep's one-line predictions (§5.2, §8.6). */
export const CARD_DIR = 'card';
/** `~/.ccrc/history/scope/<id>`: the PreCompact scope markers the hook writes (§5.1). */
export const SCOPE_DIR = 'scope';
/** The longest card line the hook serves, in characters: it reads 513 and refuses more than 512 (§8.6, C21), and
 *  the render reserves CARD_LINE_MAX + 1 (C38). The grammar's own longest line is 145 characters; the cap is the
 *  spec's and is not tightened here. D-4736 (history-card-fold-and-reserve) */
export const CARD_LINE_MAX = 512;
/** The command the card names, as the grammar spells it: the literal `~/.local/bin/ccrc`, which bash expands at the
 *  start of a word. B2's `next:` lines keep their own spelling, HISTORY_CMD. B2's D-4682 (history-skill-literal-path) */
export const CARD_DESCRIBE_CMD = '~/.local/bin/ccrc history describe';
/** The card line's one positive grammar (§8.6), character for character, built from CARD_PREFIX and
 *  CARD_DESCRIBE_CMD so neither is spelled twice. The ellipsis and the middle dot are U+2026 and U+00B7, written as
 *  themselves. */
export const CARD_LINE_PATTERN = `^${escapeRe(CARD_PREFIX)}node L[0-9a-f]{6,20}… \\(this compaction\\)( · parent N[0-9a-f]{6,20}…)? · ${escapeRe(CARD_DESCRIBE_CMD)} L[0-9a-f]{6,20}$`;
export const CARD_LINE_RE = new RegExp(CARD_LINE_PATTERN);
/** How long a purged session's scope marker and card directory stay (§9.4: "the files of purged sessions after
 *  7 days"). */
export const PURGED_FILES_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function cardIdOk(fn, id) {
  if (!idOk(id)) throw new TypeError(`${fn}: not a session id: ${JSON.stringify(id)}`);
}

/** `~/.ccrc/history/card/<id>`. The id passes idOk before the path exists (C66's shape). */
export function cardDirOf(home, id) {
  cardIdOk('cardDirOf', id);
  return `${historyPaths(home).root}/${CARD_DIR}/${id}`;
}

/** `~/.ccrc/history/card/<id>/<uuid>.txt`: one session's prediction, keyed on the uuid the hook reads as `psid`. */
export function cardFileOf(home, id, uuid) {
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid)) throw new TypeError(`cardFileOf: not a session uuid: ${JSON.stringify(uuid)}`);
  return `${cardDirOf(home, id)}/${uuid}.txt`;
}

/** `~/.ccrc/history/scope/<id>`: one session's PreCompact scope marker (§5.1). */
export function scopeMarkerOf(home, id) {
  cardIdOk('scopeMarkerOf', id);
  return `${historyPaths(home).root}/${SCOPE_DIR}/${id}`;
}

/** The card line for a leaf display prefix and, when one is named, a parent's (§8.6 Shape). Only a line the grammar
 *  takes is ever answered: a leaf that is not `L` plus 6 to 20 lowercase hex, a parent that is not `N` plus the
 *  same, or anything else the grammar refuses throws, so no caller can write a line the hook would refuse. */
export function cardLine({ leaf, parent = null }) {
  const line = `${CARD_PREFIX}node ${String(leaf)}… (this compaction)${parent === null ? '' : ` · parent ${String(parent)}…`} · ${CARD_DESCRIBE_CMD} ${String(leaf)}`;
  if (!CARD_LINE_RE.test(line)) throw new TypeError(`cardLine: not a card line: ${JSON.stringify(line)}`);
  return line;
}
```

Notes:
- `escapeRe`, `CARD_PREFIX`, `idOk`, `UUID_RE` and `historyPaths` are this module's own (B1, B2 Task 1). `historyPaths` gains no key: B1 pins its key set, so the two directories are spelled here and joined to `root`, as B2's `RECALL_OFF_DIR` and `recallOffPath` are.
- In a template literal `\\(` is the two characters `\(`. `escapeRe('~/.local/bin/ccrc history describe')` is `~/\.local/bin/ccrc history describe`, so the pattern equals the spec's grammar exactly; Step 7 measures it.
- Check the two special characters: `grep -c '…' ccd/history/lib.mjs` rose by exactly 2 (it counts lines: the pattern's line and `cardLine`'s template line), and `grep -c '\\u2026\|\\u00b7' ccd/history/lib.mjs` printed the same number before and after. If in doubt, `od -c` the pattern line.

- [ ] **Step 6: Declare them.** Append to the end of `ccd/history/lib.d.mts`:

```ts

// --- W1-B3 Task 1: the card line's vocabulary, paths and line (spec §8.6, §5.1, §5.2, §9.4)
export const CARD_DIR: 'card';
export const SCOPE_DIR: 'scope';
export const CARD_LINE_MAX: 512;
export const CARD_DESCRIBE_CMD: '~/.local/bin/ccrc history describe';
export const CARD_LINE_PATTERN: string;
export const CARD_LINE_RE: RegExp;
export const PURGED_FILES_GRACE_MS: number;
export function cardDirOf(home: string, id: string): string;
export function cardFileOf(home: string, id: string, uuid: string): string;
export function scopeMarkerOf(home: string, id: string): string;
export function cardLine(i: { leaf: string; parent?: string | null }): string;
```

Check each is declared once, from the repository root:

```bash
for n in cardDirOf cardFileOf scopeMarkerOf cardLine; do printf '%s %s\n' "$n" "$(grep -c "^export function $n(" ccd/history/lib.d.mts)"; done
for n in CARD_DIR SCOPE_DIR CARD_LINE_MAX CARD_DESCRIBE_CMD CARD_LINE_PATTERN CARD_LINE_RE PURGED_FILES_GRACE_MS; do printf '%s %s\n' "$n" "$(grep -c "^export const $n: " ccd/history/lib.d.mts)"; done
```

Expected: every line ends in `1`.

- [ ] **Step 7: Run the tests, the CI list pin, the lib suite, single-definition and the typecheck.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts test/ci-pipeline.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts test/single-definition.test.ts test/license.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every case passes and `tsc` prints nothing. `single-definition.test.ts`'s B1/B2 history describes see seven new `lib.mjs` constants, none of them an O14 vocabulary yet (Task 11 binds them), and no `/history-off` spelling. A red in any of them is this task's defect: fix the block, never a B1 or B2 assertion.

- [ ] **Step 8: Write the mutation runner.** It is B2's runner (B2 plan Task 8 Step 12) with the scratch path changed to this plan's. From the repository root:

```bash
mkdir -p .superpowers/sdd/history-w1-b3/scratch/keep
cat > .superpowers/sdd/history-w1-b3/scratch/mutate.mjs <<'EOF'
// .superpowers/sdd/history-w1-b3/scratch/mutate.mjs: measures each guard RED with it mutated, then GREEN with
// it restored (the B3 plan's mutation-pin rule). Run from server/, in the foreground, with a timeout of at least
// 600000 ms:
//   node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs <mutants.json>
// A mutant is {name, file, test, filter, edits: [{anchor, replacement}]}. `file` is repo-relative, `test` is
// server/-relative, and each anchor must occur exactly once in the file as the earlier edits leave it. The
// pristine file is copied to scratch/keep/<file with '/' as '__'>.orig BEFORE it is touched, and the copy is
// removed only after the file is restored from it. A kill no handler sees therefore leaves the original findable,
// and the next run REFUSES while any copy is left. To restore by hand, from the repository root:
//   for f in .superpowers/sdd/history-w1-b3/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const KEEP = '../.superpowers/sdd/history-w1-b3/scratch/keep';
mkdirSync(KEEP, { recursive: true });
const left = readdirSync(KEEP).filter((n) => n.endsWith('.orig'));
if (left.length > 0) {
  console.log(`REFUSED: ${left.join(', ')} in ${KEEP}. An earlier run was interrupted and a source may hold a mutant: restore as this file's header says.`);
  process.exit(1);
}
const keepOf = (file) => `${KEEP}/${file.replaceAll('/', '__')}.orig`;
const restoreAll = () => {
  for (const n of readdirSync(KEEP)) {
    if (!n.endsWith('.orig')) continue;
    copyFileSync(`${KEEP}/${n}`, `../${n.slice(0, -'.orig'.length).replaceAll('__', '/')}`);
    rmSync(`${KEEP}/${n}`);
  }
};
// Every way out restores: the loop's end, process.exit and an uncaught throw all emit 'exit', and a signal is
// turned into an exit. A signal sent while the synchronous loop holds the thread is handled after the current
// child returns; a Ctrl-C also reaches the vitest child, and the loop stops on the child's signal below.
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(130));
const vitest = (test, filter) => spawnSync('./node_modules/.bin/vitest', ['run', test, '-t', filter], { encoding: 'utf8' });
const mutants = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const m of mutants) {
  const target = `../${m.file}`;
  if (!existsSync(target)) { console.log(`NO SUCH FILE       ${m.name}`); bad += 1; continue; }
  const keep = keepOf(m.file);
  copyFileSync(target, keep);
  let src = readFileSync(keep, 'utf8');
  let unique = true;
  for (const e of m.edits) {
    const at = src.indexOf(e.anchor);
    if (at < 0 || src.indexOf(e.anchor, at + 1) >= 0) { unique = false; break; }
    src = src.slice(0, at) + e.replacement + src.slice(at + e.anchor.length);
  }
  if (!unique) { rmSync(keep); console.log(`ANCHOR NOT UNIQUE  ${m.name}`); bad += 1; continue; }
  writeFileSync(target, src);
  const red = vitest(m.test, m.filter);
  copyFileSync(keep, target);
  rmSync(keep);
  if (red.signal !== null) { console.log(`INTERRUPTED (${red.signal})  ${m.name}`); process.exit(130); }
  const failed = /Tests\s+(\d+) failed/.exec(red.stdout)?.[1] ?? '?';
  if (red.status === 0) { console.log(`STAYED GREEN       ${m.name}`); bad += 1; } else console.log(`red (${failed} failed)   ${m.name}`);
  const green = vitest(m.test, m.filter);
  if (green.signal !== null) { console.log(`INTERRUPTED (${green.signal})  ${m.name}`); process.exit(130); }
  if (green.status !== 0) { console.log(`RED AFTER RESTORE  ${m.name}`); bad += 1; } else console.log(`green              ${m.name}`);
}
console.log(bad === 0 ? 'every guard measured red, then green' : `${bad} guard(s) not measured`);
process.exit(bad === 0 ? 0 : 1);
EOF
```

Tasks 2-7 run this same file. Each of them first checks it is present; if it is not (a scratch directory can be wiped between sessions), run this step's two commands again exactly as written here.

- [ ] **Step 9: Measure every guard red, then green.** From the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task1.json <<'EOF'
[
  { "name": "8.6: the grammar admits a 5-hex leaf", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "spec grammar character",
    "edits": [{ "anchor": "export const CARD_LINE_PATTERN = `^${escapeRe(CARD_PREFIX)}node L[0-9a-f]{6,20}",
                "replacement": "export const CARD_LINE_PATTERN = `^${escapeRe(CARD_PREFIX)}node L[0-9a-f]{5,20}" }] },
  { "name": "8.6: cardLine answers a line the grammar refuses", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "cardLine throws",
    "edits": [{ "anchor": "  if (!CARD_LINE_RE.test(line)) throw", "replacement": "  if (false) throw" }] },
  { "name": "C66 shape: cardDirOf forms a path from '..'", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "path helpers",
    "edits": [{ "anchor": "  cardIdOk('cardDirOf', id);\n", "replacement": "" }] },
  { "name": "C66 shape: scopeMarkerOf forms a path from '..'", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "path helpers",
    "edits": [{ "anchor": "  cardIdOk('scopeMarkerOf', id);\n", "replacement": "" }] },
  { "name": "C66 shape: cardFileOf forms a path from a non-uuid", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "path helpers",
    "edits": [{ "anchor": "  if (typeof uuid !== 'string' || !UUID_RE.test(uuid)) throw", "replacement": "  if (false) throw" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task1.json)
```

Expected: every row prints `red (N failed)` with a number N, then `green`; the last line is `every guard measured red, then green`; the exit code is 0. A row printing `red (?)` ran a filter that matched no case (vitest exits non-zero on `No test found`): it is unmeasured, never red; fix its filter and re-run it. This holds for every mutants file in this plan. The grammar row reds `CARD_LINE_PATTERN is the spec grammar` with `expected '^History: node L[0-9a-f]{5,20}…' to be '^History: node L[0-9a-f]{6,20}…'`; the `cardLine` row reds on `expected [Function] to throw an error` for the N leaf; the three path rows red on `expected [Function] to throw an error` for `'..'` or the upper-case uuid.

- [ ] **Step 10: Confirm every file is restored, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts test/ci-pipeline.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Expected: every case passes and the last line is `RESTORED`. On anything else, stop and restore as the runner's header says. Only after `RESTORED`, in a separate call, on this workspace's own branch:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-card.test.ts .github/workflows/ci.yml
git commit -m "feat(history): the card line's vocabulary, grammar, paths and line builder (W1-B3 task 1)"
```

### Task 2: lib: planCardPrediction and decideCardFile

**Files:**
- Modify: `ccd/history/lib.mjs`: append one block at the END of the file (after Task 1's block).
- Modify: `ccd/history/lib.d.mts`: append one block at the end.
- Modify: `server/test/history-card.test.ts` (Task 1): one import line directly below the file's last top-of-file `import` line, and one describe at the end of the file.
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task2.json`.

**Interfaces:**
- Consumes:
  - B1 `lib.mjs`: `leafId`, `parentId(childIds): string`.
  - B2 `lib.mjs` (Task 5): `planSpans(i: { rows: readonly SpanRow[]; boundaries: readonly SpanBoundary[] }): { leaves: SpanLeaf[]; liveTail: string[] }`, `decideLeafId(i: { ccrcId; ccUuid; spanStartUuid; boundaryUuid; plainBoundOther }): { id: string; forked: boolean }`, `planFanIn(i: { slots: readonly FanInSlot[]; width: number }): string[][]`, `FAN_IN` (`{ leaf: 8, condensed: 4 }`); (Task 1) `displayPrefixes(ids): Map<string, string>`, `HISTORY_NODE_ID_RE` (`/^[LN][0-9a-f]{20}$/`), `escapeRe`; B1's `Presence<T>` type (`lib.d.mts`).
  - B2 `historyFixtures.ts` (Task 5): `compactionSequence(o: CompactionSequenceOpts): CompactionSequence`.
  - Task 1: `cardLine`, `CARD_LINE_RE`, `CARD_PREFIX` (B1).
- Produces (`lib.mjs`, declared in `lib.d.mts`):
  - `export interface CardBoundary { readonly uuid: string; readonly headUuid: string | null }`
  - `export interface CardSlot { readonly nodeId: string | null; readonly parented: boolean }`
  - `export interface CardPredictionInputs { ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; lastBoundary: CardBoundary | null; plainBoundOther: boolean; slots: readonly CardSlot[]; newestCondensed: string | null; familyIds: readonly string[] }`
  - `export type CardPrediction = { act: 'write'; line: string; leafId: string; parentId: string | null; parentKind: 'predicted' | 'newest-condensed' | null } | { act: 'skip'; reason: 'fork-qualified'; plainLeafId: string } | { act: 'skip'; reason: 'no-epoch' | 'no-rows' }`. A fork skip carries the plain id the next leaf would have had, so `decideCardFile` can still tell that a file's leaf was consumed.
  - `export function predictedSpanStart(i: { firstRowUuid: string | null; lastBoundary: CardBoundary | null }): string | null`
  - `export function planCardPrediction(i: CardPredictionInputs): CardPrediction`
  - `export function decideCardFile(i: { current: Presence<string>; prediction: CardPrediction; atEof: boolean }): { act: 'keep' | 'write' | 'delete' | 'none'; consumed: boolean }`
  - `export function decideCardGenFile(i: { current: Presence<string>; generation: string; card: 'keep' | 'write' | 'delete' | 'none'; mayWrite: boolean }): 'keep' | 'write' | 'delete' | 'none'`: the generation record `card/<id>/<uuid>.gen` beside a prediction (coordinator ruling R-recalloff-parity; spec §9.7, §8.2, C68). `generation` is what B2's CLI resolves under `'newest'`, the id's newest family's (`''` for a legacy family or none); `card` is `decideCardFile`'s act.
- Later consumers: Task 5 (`card.mjs` measures each input and acts on each decision; it writes the record), Task 9 (the hook reads the record when neither `CCRC_SESSION_GENERATION` nor `$REG/<id>.generation` resolves a generation).

**Spec:**
- §8.6: the parent rule ("this leaf's parent when it is predictable (the 8th leaf of a run); otherwise the epoch's newest condensed node; otherwise omitted"), Timing (a prediction only; written only at end-of-file; deleted when the boundary that consumed it is ingested), and 6-hex display prefixes (RB2).
- §6.1: the span rule per holding copy, the plain and fork-qualified leaf ids, "ids are displayed as the shortest prefix unique within the scope, minimum 6"; §6.3: fan-in 8 per holding copy and epoch (RB4), only over final leaves.
- Pins: this task's plan pins (the span start equals planSpans' over the whole copy; the predicted parent is parentId over the 8 slots planFanIn would group; a gap or a parented slot never regroups; the fallback chain; fork, no-rows and no-epoch skips; prefixes unique over the family; the file decision table; the generation record's table, coordinator ruling R-recalloff-parity).
- §9.7 and §8.2 with C68 (coordinator ruling R-recalloff-parity): the CLI, the hook and the card agree on recall-off in every case. The hook cannot read the store, so when neither `CCRC_SESSION_GENERATION` nor `$REG/<id>.generation` resolves a generation it compares `recall-off/<id>` with the generation the sweep recorded beside the prediction, by the CLI's rule. `decideCardGenFile` decides that record: while a prediction stands (`card` is `write` or `keep`) the record must hold `generation` and one LF; one that differs, is absent or cannot be read is written where a write is allowed (`mayWrite`, the end-of-file and budget gate `decideCardFile` was given) and removed otherwise, so the hook withholds the line rather than compare with a stale record (fail closed); with no prediction standing the record is left alone, because the hook reads it only beside a prediction.
- Departures: B2's D-4688 (`history-span-per-boundary-copy`) and B2's D-4689 (`history-leaf-id-fork-qualified`) (both B2's, reused unchanged: the prediction calls planSpans and decideLeafId, so neither rule is spelled twice); D-4737 (`history-card-measured-from-transcript`) is Task 6's. D-4738 (`history-card-consumed-counter`) (NEW, Task 5's): `decideCardFile` reports each consumption, a fork skip's included, so the counters Task 5 folds by scope (`card_consumed:<main|other|unknown>`, ruling RC3) count every prediction a boundary consumed. Unreadable is never absent here: `decideCardFile` takes a `Presence` (§13, IV5).

**Choices this task makes:**
- **`fork-qualified` is §6.1's two-copies rule, and spooled forks (ruled Q16) leave it unchanged.** The skip fires when the next leaf's plain id, `leafId(ccrcId, ccUuid, start)`, is already bound to another boundary. That needs two live copies of ONE transcript (one cc uuid) each compacted after the same head: a swap carry's copies, or the copy Claude Code's same-id fork arm continues. B2's fork line confirms the existing epoch for the same-id arm and adds none, so that case reaches this function exactly as before. A fresh-sid fork chains its own `fork` epoch over its own transcript, and its leaves hash its own sid, so no plain id of the fork can equal one of the parent's. It is therefore never fork-qualified on the parent's account; Task 5's spooled-fork case predicts its plain id. `planCardPrediction` takes the ccrc id and the uuid, never an epoch's cause, so the new cause needs no branch and this task no new case.

- [ ] **Step 1: Add the import line.** In `server/test/history-card.test.ts`, directly below the line `import * as libCard from '../../ccd/history/lib.mjs';`, add:

```ts
import { compactionSequence } from './historyFixtures.js';
```

- [ ] **Step 2: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Task 2: the prediction and the card file decision (spec §8.6, §6.1, §6.3). Pure.
// ===========================================================================
describe('the card prediction and the card file decision (spec 8.6, 6.1, 6.3; W1-B3 Task 2)', () => {
  const ID = 'demo-quiet-basin';
  const U = '0189abcd-1234-4678-9abc-0000000000c2';
  const leafOf = (start: string): string => libCard.leafId(ID, U, start);
  const base: libCard.CardPredictionInputs = {
    ccrcId: ID, ccUuid: U, firstRowUuid: 'r-first', lastBoundary: null, plainBoundOther: false, slots: [],
    newestCondensed: null, familyIds: [],
  };
  const writeOf = (p: libCard.CardPrediction): Extract<libCard.CardPrediction, { act: 'write' }> => {
    if (p.act !== 'write') throw new Error(`expected a write, got ${JSON.stringify(p)}`);
    return p;
  };

  it("the span start: the copy's first row before any boundary, else the last boundary's head (its uuid when it has none), equal to planSpans' over the whole copy", () => {
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: null })).toBe('r-first');
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: { uuid: 'b-1', headUuid: 'h-1' } })).toBe('h-1');
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: { uuid: 'b-1', headUuid: null } })).toBe('b-1');
    expect(libCard.predictedSpanStart({ firstRowUuid: null, lastBoundary: null })).toBeNull();
    for (const trigger of ['manual', 'auto'] as const) {
      const s = compactionSequence({ n: 3, trigger, seed: 0xc2 });
      const rows = s.rows.map((r, pos) => {
        const uuid = String(r['uuid']);
        return { uuid, pos, isBoundary: s.boundaryUuids.includes(uuid), isSummary: s.summaryUuids.includes(uuid) };
      });
      const boundaries = s.boundaryUuids.map((uuid, k) => ({
        uuid, headUuid: s.headUuids[k]!, kept: new Set(s.keptUuids[k]!), summaryUuid: s.summaryUuids[k]!,
      }));
      const spans = libCard.planSpans({ rows, boundaries }).leaves;
      expect(spans).toHaveLength(3);
      spans.forEach((leaf, k) => {
        const predicted = libCard.predictedSpanStart({
          firstRowUuid: rows[0]!.uuid,
          lastBoundary: k === 0 ? null : { uuid: s.boundaryUuids[k - 1]!, headUuid: s.headUuids[k - 1]! },
        });
        expect(predicted, `${trigger} leaf ${k}`).toBe(leaf.spanStartUuid);
      });
    }
  });

  it('the leaf is the plain id; its depth-1 parent is predicted when it is the 8th final, unparented slot of the run', () => {
    const seven = Array.from({ length: 7 }, (_, k) => leafOf(`s-${k}`));
    const leaf = leafOf('h-7');
    const p = writeOf(libCard.planCardPrediction({
      ...base, lastBoundary: { uuid: 'b-7', headUuid: 'h-7' }, slots: seven.map((nodeId) => ({ nodeId, parented: false })),
    }));
    expect({ leafId: p.leafId, parentId: p.parentId, parentKind: p.parentKind })
      .toEqual({ leafId: leaf, parentId: libCard.parentId([...seven, leaf]), parentKind: 'predicted' });
  });

  it('grouping starts at the first unparented slot; a parented slot never regroups; a slot not yet final stops the run', () => {
    const ids = Array.from({ length: 15 }, (_, k) => leafOf(`s-${k}`));
    const leaf = leafOf('h-15');
    const at = { ...base, lastBoundary: { uuid: 'b-15', headUuid: 'h-15' } };
    const after8 = writeOf(libCard.planCardPrediction({ ...at, slots: ids.map((nodeId, k) => ({ nodeId, parented: k < 8 })) }));
    expect([after8.parentId, after8.parentKind]).toEqual([libCard.parentId([...ids.slice(8), leaf]), 'predicted']);
    const gap = writeOf(libCard.planCardPrediction({ ...at, slots: ids.map((nodeId, k) => ({ nodeId: k === 10 ? null : nodeId, parented: k < 8 })) }));
    expect([gap.leafId, gap.parentId, gap.parentKind]).toEqual([leaf, null, null]);
    const ninth = writeOf(libCard.planCardPrediction({ ...at, slots: ids.slice(0, 9).map((nodeId, k) => ({ nodeId, parented: k < 8 })) }));
    expect([ninth.parentId, ninth.parentKind]).toEqual([null, null]);
  });

  it("with no predicted parent the epoch's newest condensed node is named; a malformed one, or none, names no parent", () => {
    const N = `N${'c'.repeat(20)}`;
    const p = writeOf(libCard.planCardPrediction({ ...base, newestCondensed: N }));
    expect([p.parentId, p.parentKind]).toEqual([N, 'newest-condensed']);
    expect(p.line).toContain(` · parent ${N.slice(0, 7)}…`);
    for (const bad of [`L${'c'.repeat(20)}`, 'Nbad', `N${'C'.repeat(20)}`, `N${'c'.repeat(19)}`]) {
      const q = writeOf(libCard.planCardPrediction({ ...base, newestCondensed: bad }));
      expect([q.parentId, q.parentKind], bad).toEqual([null, null]);
    }
  });

  it('no epoch, no rows, and a plain id already bound elsewhere (a fork: the qualified id would hash a boundary not yet written) each skip', () => {
    expect(libCard.planCardPrediction({ ...base, ccrcId: null })).toEqual({ act: 'skip', reason: 'no-epoch' });
    expect(libCard.planCardPrediction({ ...base, firstRowUuid: null })).toEqual({ act: 'skip', reason: 'no-rows' });
    expect(libCard.planCardPrediction({ ...base, plainBoundOther: true }), 'a fork skip names the plain id it could not use')
      .toEqual({ act: 'skip', reason: 'fork-qualified', plainLeafId: leafOf('r-first') });
  });

  it('display prefixes are at least 6 hex and unique over the family: a family id sharing 7 hex digits with the leaf forces 8', () => {
    const leaf = leafOf('r-first');
    const plain = writeOf(libCard.planCardPrediction(base));
    expect(plain.line).toBe(libCard.cardLine({ leaf: leaf.slice(0, 7) }));
    const twin = `${leaf.slice(0, 8)}${leaf[8] === '0' ? '1' : '0'}${leaf.slice(9)}`;
    const p = writeOf(libCard.planCardPrediction({ ...base, familyIds: [twin, `N${'d'.repeat(20)}`] }));
    expect(p.line).toBe(libCard.cardLine({ leaf: leaf.slice(0, 9) }));
  });

  it('decideCardFile: write only at end-of-file, keep an unchanged line, delete a consumed or orphaned prediction off end-of-file; consumed exactly when the leaf moved', () => {
    const leaf = leafOf('h-1');
    const next = leafOf('h-2');
    const lineOf = (id: string, parent: string | null = null): string => libCard.cardLine({ leaf: id.slice(0, 7), parent });
    const write = (id: string, line: string): libCard.CardPrediction => ({ act: 'write', line, leafId: id, parentId: null, parentKind: null });
    const value = (v: string): libCard.Presence<string> => ({ state: 'value', value: v });
    const absent: libCard.Presence<string> = { state: 'absent' };
    const unreadable: libCard.Presence<string> = { state: 'unreadable' };
    const now = write(leaf, lineOf(leaf));
    const reRendered = write(leaf, lineOf(leaf, `N${'e'.repeat(6)}`));
    const moved = write(next, lineOf(next));
    expect(next.startsWith(leaf.slice(0, 7)), 'CONTROL: the two fixture leaves differ in their first 7 characters').toBe(false);
    const rows: Array<[string, libCard.Presence<string>, libCard.CardPrediction, boolean, { act: string; consumed: boolean }]> = [
      ['no file, at end-of-file', absent, now, true, { act: 'write', consumed: false }],
      ['no file, off end-of-file', absent, now, false, { act: 'none', consumed: false }],
      ['the same line and its LF', value(`${lineOf(leaf)}\n`), now, true, { act: 'keep', consumed: false }],
      ['the same leaf, a parent now, at end-of-file', value(`${lineOf(leaf)}\n`), reRendered, true, { act: 'write', consumed: false }],
      ['the same leaf, a parent now, off end-of-file', value(`${lineOf(leaf)}\n`), reRendered, false, { act: 'keep', consumed: false }],
      ['the leaf moved, at end-of-file', value(`${lineOf(leaf)}\n`), moved, true, { act: 'write', consumed: true }],
      ['the leaf moved, off end-of-file', value(`${lineOf(leaf)}\n`), moved, false, { act: 'delete', consumed: true }],
      ['a file that is no card line, at end-of-file', value('free text\n'), now, true, { act: 'write', consumed: false }],
      ['a file that is no card line, off end-of-file', value('free text\n'), now, false, { act: 'delete', consumed: false }],
      ['an unreadable file, at end-of-file', unreadable, now, true, { act: 'write', consumed: false }],
      ['an unreadable file, off end-of-file', unreadable, now, false, { act: 'delete', consumed: false }],
      ['a fork skip, the leaf unmoved', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: leaf }, true, { act: 'delete', consumed: false }],
      ['a fork skip after the leaf moved', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, true, { act: 'delete', consumed: true }],
      ['a fork skip after the leaf moved, off end-of-file', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, false, { act: 'delete', consumed: true }],
      ['a no-epoch skip, with a file', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'no-epoch' }, true, { act: 'delete', consumed: false }],
      ['a fork skip over a file that is no card line', value('free text\n'), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, true, { act: 'delete', consumed: false }],
      ['a skip, with none', absent, { act: 'skip', reason: 'no-epoch' }, true, { act: 'none', consumed: false }],
    ];
    for (const [name, current, prediction, atEof, want] of rows) {
      expect(libCard.decideCardFile({ current, prediction, atEof }), name).toEqual(want);
    }
  });

  // R-recalloff-parity (spec §9.7, §8.2, C68): the record the hook compares recall-off/<id> with when neither the env
  // nor the registry resolves a generation. A stale record must never stand beside a prediction: it is rewritten
  // where a write is allowed and removed where it is not, so the hook withholds rather than serve on it.
  it('decideCardGenFile: the generation record beside a standing prediction is kept only when it names the resolved generation; a stale one is rewritten at a write, removed otherwise; none without a prediction', () => {
    const G = '0189abcd-1234-4678-9abc-0000000000c0';
    const G2 = '0189abcd-1234-4678-9abc-0000000000c9';
    const value = (v: string): libCard.Presence<string> => ({ state: 'value', value: v });
    const absent: libCard.Presence<string> = { state: 'absent' };
    const unreadable: libCard.Presence<string> = { state: 'unreadable' };
    const rows: Array<[string, libCard.Presence<string>, string, 'keep' | 'write' | 'delete' | 'none', boolean, string]> = [
      ['a prediction written, no record', absent, G, 'write', true, 'write'],
      ['a prediction written, the record equal', value(`${G}\n`), G, 'write', true, 'keep'],
      ['a prediction written, the record naming another generation', value(`${G2}\n`), G, 'write', true, 'write'],
      ['a record without its LF is rewritten', value(G), G, 'write', true, 'write'],
      ['a prediction kept, the record equal', value(`${G}\n`), G, 'keep', false, 'keep'],
      ['a prediction kept at end-of-file, the record stale', value(`${G2}\n`), G, 'keep', true, 'write'],
      ['a prediction kept off end-of-file, the record stale', value(`${G2}\n`), G, 'keep', false, 'delete'],
      ['a prediction kept off end-of-file, no record', absent, G, 'keep', false, 'none'],
      ['a prediction kept off end-of-file, an unreadable record', unreadable, G, 'keep', false, 'delete'],
      ['a legacy newest family: the record is one LF', value('\n'), '', 'keep', false, 'keep'],
      ['a legacy newest family against a record naming G', value(`${G}\n`), '', 'keep', false, 'delete'],
      ['no prediction standing: a stale record left alone', value(`${G2}\n`), G, 'delete', false, 'none'],
      ['no prediction at all', absent, G, 'none', true, 'none'],
    ];
    for (const [name, current, generation, card, mayWrite, want] of rows) {
      expect(libCard.decideCardGenFile({ current, generation, card, mayWrite }), name).toBe(want);
    }
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'card prediction')
```

Expected: 8 failed, each with `libCard.predictedSpanStart is not a function`, `libCard.planCardPrediction is not a function`, `libCard.decideCardFile is not a function` or `libCard.decideCardGenFile is not a function`.

- [ ] **Step 4: Implement the block.** Append to the end of `ccd/history/lib.mjs`:

```js

/** The boundary the next compaction will write, as planSpans is shown it: a uuid no transcript row carries. */
const CARD_NEXT_BOUNDARY = 'card-prediction:next-boundary';

/** The span start of the leaf the next compaction of one copy will become (§6.1), taken from planSpans itself so
 *  the rule is never spelled twice: a copy of two rows, its last boundary (or, with none, its first stored row) and
 *  a synthetic next boundary. The answer is the last boundary's head, its own uuid when it has none, or the copy's
 *  first row; null for a copy with no rows. B2's D-4688 (history-span-per-boundary-copy) */
export function predictedSpanStart({ firstRowUuid, lastBoundary }) {
  const rows = [];
  const boundaries = [];
  if (lastBoundary !== null) {
    rows.push({ uuid: lastBoundary.uuid, pos: 0, isBoundary: true, isSummary: false });
    boundaries.push({ uuid: lastBoundary.uuid, headUuid: lastBoundary.headUuid, kept: new Set(), summaryUuid: null });
  } else if (firstRowUuid !== null) {
    rows.push({ uuid: firstRowUuid, pos: 0, isBoundary: false, isSummary: false });
  } else {
    return null;
  }
  rows.push({ uuid: CARD_NEXT_BOUNDARY, pos: 1, isBoundary: true, isSummary: false });
  boundaries.push({ uuid: CARD_NEXT_BOUNDARY, headUuid: null, kept: new Set(), summaryUuid: null });
  const next = planSpans({ rows, boundaries }).leaves.find((l) => l.boundaryUuid === CARD_NEXT_BOUNDARY);
  return next === undefined ? null : next.spanStartUuid;
}

const isNodeIdOf = (kind, id) => typeof id === 'string' && HISTORY_NODE_ID_RE.test(id) && id[0] === kind;

/** What the card for one session's next compaction says (§8.6), or why there is none. The sweep measures the inputs
 *  over the copy the next boundary will be written to, within the epoch and family that copy's transcript belongs to.
 *  - No confirmed, unmerged epoch of this id names the uuid (`ccrcId` null): skip `no-epoch`.
 *  - The copy holds no row: skip `no-rows`.
 *  - The plain id is already bound to another boundary: decideLeafId would qualify this leaf with a boundary uuid that
 *    does not exist yet, so no line can name it: skip `fork-qualified` (B2's D-4689 (history-leaf-id-fork-qualified)). The skip
 *    carries that plain id, so decideCardFile can still count a prediction the boundary before it consumed.
 *  - Otherwise the leaf is the plain id. Its parent is the depth-1 parent planFanIn groups it into when it is the 8th
 *    final, unparented slot of this copy's run (`predicted`, parentId over that group: grouping starts at the first
 *    unparented slot and stops at a slot not yet final, RB4); else the epoch's newest condensed node when that is a
 *    well-formed N id (`newest-condensed`); else none.
 *  Both print as displayPrefixes over the family's node ids and themselves: at least NODE_ID_DISPLAY_MIN hex digits,
 *  unique within the family the reader's default scope is (RB2). */
export function planCardPrediction(i) {
  if (i.ccrcId === null) return { act: 'skip', reason: 'no-epoch' };
  const start = predictedSpanStart(i);
  if (start === null) return { act: 'skip', reason: 'no-rows' };
  const d = decideLeafId({
    ccrcId: i.ccrcId, ccUuid: i.ccUuid, spanStartUuid: start, boundaryUuid: CARD_NEXT_BOUNDARY, plainBoundOther: i.plainBoundOther,
  });
  if (d.forked) return { act: 'skip', reason: 'fork-qualified', plainLeafId: leafId(i.ccrcId, i.ccUuid, start) };
  const leaf = d.id;
  const slots = [
    ...i.slots.map((x) => ({ nodeId: x.nodeId, final: x.nodeId !== null, parented: x.parented })),
    { nodeId: leaf, final: true, parented: false },
  ];
  const group = planFanIn({ slots, width: FAN_IN.leaf }).find((g) => g.includes(leaf));
  let parent = null;
  let parentKind = null;
  if (group !== undefined) {
    parent = parentId(group);
    parentKind = 'predicted';
  } else if (isNodeIdOf('N', i.newestCondensed)) {
    parent = i.newestCondensed;
    parentKind = 'newest-condensed';
  }
  const shown = displayPrefixes([...i.familyIds, leaf, ...(parent === null ? [] : [parent])]);
  return {
    act: 'write', line: cardLine({ leaf: shown.get(leaf), parent: parent === null ? null : shown.get(parent) }),
    leafId: leaf, parentId: parent, parentKind,
  };
}

const CARD_LEAF_RE = new RegExp(`^${escapeRe(CARD_PREFIX)}node (L[0-9a-f]{6,20})…`);

/** The leaf display prefix a grammar-valid card line names, or null for any other text. */
function cardLeafOf(text) {
  return CARD_LINE_RE.test(text) ? CARD_LEAF_RE.exec(text)[1] : null;
}

/** What to do with one session's card file (§8.6 Timing). `current` is the file as read: absent, unreadable, or its
 *  text (one trailing LF is the writer's and is not part of the line). A new line is written only at end-of-file; a
 *  file whose leaf the prediction no longer names was CONSUMED by the boundary ingested since, and goes off
 *  end-of-file rather than wait; a file that is no card line, or cannot be read, is replaced at end-of-file and
 *  removed otherwise; a skip removes any file. A fork skip names the plain id the next leaf would have had, so a
 *  file whose leaf no longer prefixes it was consumed too, and is counted (W1-e's denominator,
 *  D-4738 (history-card-consumed-counter)); a no-epoch or no-rows skip names no leaf and counts nothing.
 *    absent                      → write at end-of-file, else none;
 *    the same line               → keep;
 *    the same leaf, re-rendered  → write at end-of-file, else keep (its parent or prefix moved, the leaf did not);
 *    another leaf                → consumed: write at end-of-file, else delete;
 *    no card line, unreadable    → write at end-of-file, else delete;
 *    a skip                      → delete; consumed when it is a fork skip whose plain id the file's leaf no
 *                                  longer prefixes. */
export function decideCardFile({ current, prediction, atEof }) {
  const present = current.state !== 'absent';
  const text = current.state === 'value' ? current.value.replace(/\n$/, '') : null;
  const was = text === null ? null : cardLeafOf(text);
  if (prediction.act !== 'write') {
    const moved = was !== null && typeof prediction.plainLeafId === 'string' && !prediction.plainLeafId.startsWith(was);
    return { act: present ? 'delete' : 'none', consumed: moved };
  }
  if (!present) return { act: atEof ? 'write' : 'none', consumed: false };
  if (text === prediction.line) return { act: 'keep', consumed: false };
  if (was === null) return { act: atEof ? 'write' : 'delete', consumed: false };
  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'delete', consumed: true };
  return { act: atEof ? 'write' : 'keep', consumed: false };
}

/** The generation record beside a prediction, `card/<id>/<uuid>.gen` (spec §9.7, §8.2, C68; coordinator ruling
 *  R-recalloff-parity). The hook cannot read the store: when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation
 *  resolves a generation, it compares recall-off/<id> with this record, which holds the generation B2's CLI resolves
 *  then (the id's newest family's: '' for a legacy family or none), and with no usable record it withholds the line.
 *  `card` is decideCardFile's act and `mayWrite` the write gate decideCardFile was given (end-of-file and budget).
 *  The record's text is the generation and one LF.
 *    a prediction stands (write or keep), the record equal      → keep;
 *    it stands, the record absent, another or unreadable       → write when a write is allowed, else delete (none
 *                                                                 when absent): never a stale record (fail closed);
 *    no prediction stands (delete or none)                      → none: the hook reads the record only beside one. */
export function decideCardGenFile({ current, generation, card, mayWrite }) {
  if (card !== 'write' && card !== 'keep') return 'none';
  if (current.state === 'value' && current.value === `${generation}\n`) return 'keep';
  if (mayWrite) return 'write';
  return current.state === 'absent' ? 'none' : 'delete';
}
```

Notes:
- `planSpans`, `decideLeafId`, `planFanIn`, `FAN_IN`, `displayPrefixes`, `HISTORY_NODE_ID_RE` and `escapeRe` are B2's, `leafId`, `parentId` and `CARD_PREFIX` B1's, `cardLine` and `CARD_LINE_RE` Task 1's, all in this module.
- A fork skip's `plainLeafId` is `leafId(ccrcId, ccUuid, start)`, the id `decideLeafId` found already bound. Without it, a prediction consumed by the boundary just before a fork skip would be deleted uncounted, while the delivery measure still counts its `card_served`, so W1-e's served share would gain a numerator with no denominator.
- `CARD_NEXT_BOUNDARY` only names a row planSpans never sees in a store; no node or file is keyed by it. Under the fork rule, `decideLeafId` would hash it, which is exactly why that branch skips.
- `CARD_LEAF_RE` holds one U+2026, written as itself.

- [ ] **Step 5: Declare them.** Append to the end of `ccd/history/lib.d.mts`:

```ts

// --- W1-B3 Task 2: the card prediction and the card file decision (spec §8.6, §6.1, §6.3)
export interface CardBoundary { readonly uuid: string; readonly headUuid: string | null }
export interface CardSlot { readonly nodeId: string | null; readonly parented: boolean }
export interface CardPredictionInputs {
  ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; lastBoundary: CardBoundary | null;
  plainBoundOther: boolean; slots: readonly CardSlot[]; newestCondensed: string | null; familyIds: readonly string[];
}
export type CardPrediction =
  | { act: 'write'; line: string; leafId: string; parentId: string | null; parentKind: 'predicted' | 'newest-condensed' | null }
  | { act: 'skip'; reason: 'fork-qualified'; plainLeafId: string }
  | { act: 'skip'; reason: 'no-epoch' | 'no-rows' };
export function predictedSpanStart(i: { firstRowUuid: string | null; lastBoundary: CardBoundary | null }): string | null;
export function planCardPrediction(i: CardPredictionInputs): CardPrediction;
export function decideCardFile(i: { current: Presence<string>; prediction: CardPrediction; atEof: boolean }):
  { act: 'keep' | 'write' | 'delete' | 'none'; consumed: boolean };
export function decideCardGenFile(i: {
  current: Presence<string>; generation: string; card: 'keep' | 'write' | 'delete' | 'none'; mayWrite: boolean;
}): 'keep' | 'write' | 'delete' | 'none';
```

Check, from the repository root:

```bash
for n in predictedSpanStart planCardPrediction decideCardFile decideCardGenFile; do printf '%s %s\n' "$n" "$(grep -c "^export function $n(" ccd/history/lib.d.mts)"; done
for n in CardBoundary CardSlot CardPredictionInputs; do printf '%s %s\n' "$n" "$(grep -c "^export interface $n " ccd/history/lib.d.mts)"; done
grep -c '^export type CardPrediction =$' ccd/history/lib.d.mts
```

Expected: every count is `1`.

- [ ] **Step 6: Run them and see them pass, with the typecheck.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts test/history-parser.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every case passes (B2's span, fan-in and parser cases unchanged) and `tsc` prints nothing.

- [ ] **Step 7: Measure every guard red, then green.** First `test -f .superpowers/sdd/history-w1-b3/scratch/mutate.mjs && echo PRESENT || echo MISSING`; on `MISSING`, run Task 1 Step 8's two commands again exactly as written there. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task2.json <<'EOF'
[
  { "name": "6.1: the prediction ignores the last boundary's head", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "the span start",
    "edits": [{ "anchor": "    boundaries.push({ uuid: lastBoundary.uuid, headUuid: lastBoundary.headUuid, kept: new Set(), summaryUuid: null });",
                "replacement": "    boundaries.push({ uuid: lastBoundary.uuid, headUuid: null, kept: new Set(), summaryUuid: null });" }] },
  { "name": "6.1: a fork-qualified leaf is predicted under the plain id", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "each skip",
    "edits": [{ "anchor": "  if (d.forked) return { act: 'skip', reason: 'fork-qualified', plainLeafId: leafId(i.ccrcId, i.ccUuid, start) };\n", "replacement": "" }] },
  { "name": "W1-e: a prediction consumed before a fork skip never counted", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardFile",
    "edits": [{ "anchor": "    const moved = was !== null && typeof prediction.plainLeafId === 'string' && !prediction.plainLeafId.startsWith(was);",
                "replacement": "    const moved = false;" }] },
  { "name": "8.6: the 8th leaf's parent never predicted", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "8th final",
    "edits": [{ "anchor": "  if (group !== undefined) {", "replacement": "  if (false) {" }] },
  { "name": "8.6: a malformed newest condensed node named", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "newest condensed node is named",
    "edits": [{ "anchor": "  } else if (isNodeIdOf('N', i.newestCondensed)) {", "replacement": "  } else if (i.newestCondensed !== null) {" }] },
  { "name": "RB2: a fixed 6-hex prefix, unique or not", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "display prefixes",
    "edits": [{ "anchor": "line: cardLine({ leaf: shown.get(leaf),", "replacement": "line: cardLine({ leaf: leaf.slice(0, 7)," }] },
  { "name": "8.6: a consumed prediction never counted", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardFile",
    "edits": [{ "anchor": "  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'delete', consumed: true };",
                "replacement": "  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'delete', consumed: false };" }] },
  { "name": "8.6: a consumed prediction kept off end-of-file", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardFile",
    "edits": [{ "anchor": "  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'delete', consumed: true };",
                "replacement": "  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'keep', consumed: true };" }] },
  { "name": "8.6: a write off end-of-file", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardFile",
    "edits": [{ "anchor": "  if (!present) return { act: atEof ? 'write' : 'none', consumed: false };",
                "replacement": "  if (!present) return { act: 'write', consumed: false };" }] },
  { "name": "R-recalloff-parity: a stale record kept beside a prediction off end-of-file", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardGenFile",
    "edits": [{ "anchor": "  return current.state === 'absent' ? 'none' : 'delete';\n}",
                "replacement": "  return current.state === 'absent' ? 'none' : 'keep';\n}" }] },
  { "name": "R-recalloff-parity: a record never compared with the resolved generation", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardGenFile",
    "edits": [{ "anchor": "  if (current.state === 'value' && current.value === `${generation}\\n`) return 'keep';",
                "replacement": "  if (current.state === 'value') return 'keep';" }] },
  { "name": "R-recalloff-parity: a record acted on with no prediction standing", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardGenFile",
    "edits": [{ "anchor": "  if (card !== 'write' && card !== 'keep') return 'none';\n", "replacement": "" }] },
  { "name": "R-recalloff-parity: a missing or stale record never written", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardGenFile",
    "edits": [{ "anchor": "  if (mayWrite) return 'write';\n", "replacement": "" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task2.json)
```

Expected: every row prints `red (…)` then `green`; the last line is `every guard measured red, then green`; exit 0. The span row reds both triggers' leaf 1 (`expected 'b-…' to be 'h-…'` shape: the boundary's own uuid where the head was); the fork row answers a write where a skip is expected; the fork-skip row reds `a fork skip after the leaf moved` (`consumed: false` where `true` was expected); the malformed row throws inside `cardLine` (`not a card line`) for the L parent. The four R-recalloff-parity rows, measured on a node extract of `decideCardGenFile` and this table (each row's anchor applied to the function's text, the rows run in order, first red reported): the stale-kept row reds `a prediction kept off end-of-file, the record stale` (`expected 'keep' to be 'delete'`); the never-compared row reds `a prediction written, the record naming another generation` (`expected 'keep' to be 'write'`); the no-prediction row reds `no prediction standing: a stale record left alone` (`expected 'delete' to be 'none'`); the never-written row reds `a prediction written, no record` (`expected 'none' to be 'write'`). The anchor `\\n` in the second row is JSON for the two characters backslash and `n` that the template literal spells.

- [ ] **Step 8: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-card.test.ts
git commit -m "feat(history): predict the card's leaf and parent by B2's span, fork and fan-in rules, and decide the card file (W1-B3 task 2)"
```

### Task 3: lib: delivery, consumption-scope, withdrawal and purge decisions

**Files:**
- Modify: `ccd/history/lib.mjs`: append one block at the END of the file (after Task 2's).
- Modify: `ccd/history/lib.d.mts`: append one block at the end.
- Modify: `server/test/history-card.test.ts`: one describe at the end of the file (no new import).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task3.json`.

**Interfaces:**
- Consumes: B1 `CARD_PREFIX`, `leafId`, `passOutcome(word): { word; exit }` and `EXIT` (its `DB` exit is 5, the refusals that wait on the operator); B2 Task 1's `escapeRe`; Task 1's `PURGED_FILES_GRACE_MS` and `cardLine` (tests); Task 2's `predictedSpanStart` and its module-private `cardLeafOf`; B1's `Presence<T>` type.
- Produces (`lib.mjs`, declared in `lib.d.mts`):
  - `export const CARD_MEASURE_ROWS = 40` (chosen: RV17 measured the SessionStart attachment within 40 rows of the boundary for 75 of 75 boundaries).
  - `export const CARD_MEASURE_MAX_WAIT_MS = 24 * 60 * 60 * 1000` (chosen: the wait bound that keeps one window from holding the measure's cursor for good).
  - `export const CARD_ATTACHMENT_MAX_BYTES = 1024 * 1024` (chosen: the largest attachment body, by its stored `raw_len`, the measure decodes; a SessionStart attachment stays far below it, and a re-attached file of many MiB is skipped unread).
  - `export function cardIdsIn(attachment: unknown): string[]`: the leaf display prefixes every `History: node L…` names in a `hook_additional_context` attachment's string leaves, de-duplicated and sorted; `[]` for any other attachment type or a non-object.
  - `export function cardWindowComplete(i: { live: boolean; rowsSeen: number; nextBoundary: boolean; eofAfter: boolean; waitedMs: number }): boolean`.
  - `export function decideCardDelivery(i: { ids: readonly string[]; leafId: string; windowComplete: boolean }): 'served' | 'mismatch' | 'none' | 'wait'`.
  - `export function decidePurgedEntry(i: { reg: 'present' | 'absent' | 'unmeasured'; newestMtimeMs: number | null; nowMs: number }): 'keep' | 'remove'`.
  - Ruling RC3, the consumption's scope:
    - `export const SCOPE_MARKER_MAX_AGE_MS = 1200 * 1000`: the hook's `COMPACT_CARD_MAX_AGE` (1200 s) in ms, the age within which its reader serves a `main` marker; Task 11 binds the two;
    - `export const CARD_CONSUMED_SCOPES = Object.freeze(['main', 'other', 'unknown'])`;
    - `export function consumedBoundaryTs(i: { current: Presence<string>; ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; boundaries: readonly CardBoundaryAt[] }): number | null`: the time of the boundary whose leaf the consumed file printed, by the span rule over one copy's boundaries in order;
    - `export function decideConsumedScope(i: { marker: Presence<string>; uuid: string; boundaryTsMs: number | null }): CardConsumedScope`: `main`, `other` or `unknown`.
  - Ruling RC2, the withdrawal:
    - `export const CARD_WITHDRAW_REASONS`, frozen: `at-cap`, `low-disk`, `floor-stop`, `roster-unreadable`, `budget`, `recovering`, `migrating`, `held`, `unreachable`, `refused`, `unbound`;
    - `export function decideCardWithdraw(p: CardPassFacts): { act: 'withdraw'; reason: CardWithdrawReason } | { act: 'keep' }`, where a pass's facts are `{ arm: 'hold'; word }` (a pass word), `{ arm: 'migrate' }`, `{ arm: 'recover' }`, or `{ arm: 'run'; pause; floorStop; ingested; budgetLeft }`.
  - Types: `CardBoundaryAt`, `CardConsumedScope`, `CardWithdrawReason`, `CardPassFacts`.
- Later consumers: Task 5 (`consumedBoundaryTs`, `decideConsumedScope`, `decideCardWithdraw`), Task 6 (`cardIdsIn`, `cardWindowComplete`, `decideCardDelivery`, `CARD_MEASURE_ROWS`, `CARD_MEASURE_MAX_WAIT_MS`, `CARD_ATTACHMENT_MAX_BYTES`), Task 7 (`decidePurgedEntry`), Task 11 (adds `CARD_MEASURE_ROWS`, `CARD_MEASURE_MAX_WAIT_MS`, `CARD_ATTACHMENT_MAX_BYTES`, `PURGED_FILES_GRACE_MS`, `SCOPE_MARKER_MAX_AGE_MS`, `CARD_CONSUMED_SCOPES` and `CARD_WITHDRAW_REASONS` to O14's `VOCABS`, and binds `SCOPE_MARKER_MAX_AGE_MS` to the hook's `COMPACT_CARD_MAX_AGE`), Task 13 (its test reads `CARD_CONSUMED_SCOPES`).

**Spec:**
- §8.6 "Delivery is measured, not receipted" (RV17: the post-boundary SessionStart `hook_additional_context` attachment; `card_served`, `card_id_mismatch`); §8.6 Timing and Scope, and §5.1 (the marker `<scope> <psid> <ms>`); §10.7 W1-e; §9.4 (both rows' collectors: "the files of purged sessions after 7 days"); §13 (unreadable is not absent, IV5).
- Pins: this task's plan pins (ids found at a line start, mid-line after standing-card text, inside string-array content; not after `History: node N`, in upper case, with fewer than 6 hex, in another attachment type; the delivery table; the window's five closers; the purge table with `unmeasured` kept; the scope fold's table and the consumed boundary's walk (ruling RC3); a reason for every pass that runs no card step, and keep only for a card step over a caught-up ingest (ruling RC2)).
- Departures:
  - D-4737 (`history-card-measured-from-transcript`).
  - D-4739 (`history-card-measure-window`) (NEW). §8.6 says delivery is read from "the post-boundary SessionStart attachment" and names no window. Chosen: the CARD_MEASURE_ROWS rows after the boundary in its holding copy, up to the next boundary; a leaf with no History line there is decided only once the window is closed (40 rows, the next boundary, its copy read to the end past the raw-leaf grace, its copy no longer live, or CARD_MEASURE_MAX_WAIT_MS since the leaf was derived), and the measure's first pass starts at the newest node (Task 6), so pre-B3 leaves are never read as unserved. An attachment body over CARD_ATTACHMENT_MAX_BYTES in the window is counted as a row and skipped unread.
  - D-4738 (`history-card-consumed-counter`) (NEW, ruled RC3): a consumption is counted under the scope its compaction's PreCompact marker gives it, so W1-e's served share can leave out a compaction that never carried a line.
  - D-4740 (`history-card-withdrawn-when-not-ticking`) (NEW, ruled RC2): which pass withdraws every prediction, and under which reason word, is decided here; Task 5 measures and acts.
- The extraction is unanchored on purpose: `_hook_emit_context` joins the standing cards and the compact subject with one space (`ccd/session-hook.sh:97` at `f7e51156f`), so with standing cards present the History line is mid-line in the attachment.

- [ ] **Step 1: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Task 3: card delivery, consumption-scope, withdrawal and purge decisions (spec §8.6 RV17, §9.4, §10.7 W1-e;
// rulings RC2 and RC3). Pure.
// ===========================================================================
describe('card delivery, scope, withdrawal, window and purge decisions (spec 8.6 RV17, 9.4, 10.7 W1-e; rulings RC2, RC3; W1-B3 Task 3)', () => {
  const ctx = (...content: unknown[]): Record<string, unknown> =>
    ({ type: 'hook_additional_context', content, hookName: 'SessionStart:compact' });
  const line = libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' });

  it('cardIdsIn finds the History id at a line start, after standing-card text on the same line, and inside nested string-array content', () => {
    expect(libCard.cardIdsIn(ctx(`${line}\nCompaction card: files touched.`))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx(`Graph: fixture. Hold: none. ${line}\nCompaction card: files touched.`))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx('first', ['nested', `x ${line}`]))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx(`${line} ${libCard.cardLine({ leaf: 'L000001abc' })}`))).toEqual(['L000001abc', 'L03a9c1']);
  });

  it('cardIdsIn ignores a parent first, upper case, fewer than 6 hex, a longer word, another attachment type and a non-object', () => {
    for (const text of ['History: node N7c1e2f… (this compaction)', 'History: node L03A9C1… (this compaction)',
      'History: node L03a9c… (this compaction)', 'History: node L03a9c1x… (this compaction)']) {
      expect(libCard.cardIdsIn(ctx(text)), text).toEqual([]);
    }
    expect(libCard.cardIdsIn({ type: 'todo_reminder', content: [line] })).toEqual([]);
    for (const v of [null, line, [line], 7, undefined]) expect(libCard.cardIdsIn(v), String(v)).toEqual([]);
  });

  it('decideCardDelivery: served when an id prefixes the leaf, mismatch when ids name only others, none once the window closed empty, wait while it is open', () => {
    const leaf = `L03a9c1${'0'.repeat(13)}`;
    expect(libCard.decideCardDelivery({ ids: ['L03a9c1'], leafId: leaf, windowComplete: false })).toBe('served');
    expect(libCard.decideCardDelivery({ ids: ['Lffffff', 'L03a9c1'], leafId: leaf, windowComplete: false })).toBe('served');
    expect(libCard.decideCardDelivery({ ids: ['Lffffff'], leafId: leaf, windowComplete: false })).toBe('mismatch');
    expect(libCard.decideCardDelivery({ ids: [], leafId: leaf, windowComplete: true })).toBe('none');
    expect(libCard.decideCardDelivery({ ids: [], leafId: leaf, windowComplete: false })).toBe('wait');
  });

  it('cardWindowComplete: CARD_MEASURE_ROWS rows, the next boundary, the copy read to its end past the grace, a copy not live, or the wait bound closes it', () => {
    expect(libCard.CARD_MEASURE_ROWS).toBe(40);
    expect(libCard.CARD_MEASURE_MAX_WAIT_MS).toBe(24 * 60 * 60 * 1000);
    expect(libCard.CARD_ATTACHMENT_MAX_BYTES).toBe(1024 * 1024);
    const open = { live: true, rowsSeen: libCard.CARD_MEASURE_ROWS - 1, nextBoundary: false, eofAfter: false, waitedMs: 0 };
    expect(libCard.cardWindowComplete(open)).toBe(false);
    expect(libCard.cardWindowComplete({ ...open, rowsSeen: libCard.CARD_MEASURE_ROWS })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, nextBoundary: true })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, eofAfter: true })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, live: false })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, waitedMs: libCard.CARD_MEASURE_MAX_WAIT_MS })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, waitedMs: libCard.CARD_MEASURE_MAX_WAIT_MS - 1 })).toBe(false);
  });

  it('decidePurgedEntry: removes only a registry-absent entry older than 7 days; present, unmeasured, young or undated is kept', () => {
    const now = Date.UTC(2026, 9, 7);
    const old = now - libCard.PURGED_FILES_GRACE_MS - 1;
    const rows: Array<[string, 'present' | 'absent' | 'unmeasured', number | null, 'keep' | 'remove']> = [
      ['absent, 7 days and 1 ms', 'absent', old, 'remove'],
      ['absent, exactly 7 days', 'absent', now - libCard.PURGED_FILES_GRACE_MS, 'keep'],
      ['absent, 6 days', 'absent', now - 6 * 24 * 60 * 60 * 1000, 'keep'],
      ['present, 8 days', 'present', old, 'keep'],
      ['unmeasured, 8 days', 'unmeasured', old, 'keep'],
      ['absent, no time', 'absent', null, 'keep'],
    ];
    for (const [name, reg, newestMtimeMs, want] of rows) {
      expect(libCard.decidePurgedEntry({ reg, newestMtimeMs, nowMs: now }), name).toBe(want);
    }
  });

  it("decideConsumedScope folds the marker its compaction left: main inside the boundary's window, other for subagent or ambiguous there, unknown for anything else (ruling RC3)", () => {
    const U = '0189abcd-1234-4678-9abc-0000000000c3';
    const OTHER = '0189abcd-1234-4678-9abc-0000000000c4';
    const B = Date.UTC(2026, 9, 7, 12);
    const MAX = libCard.SCOPE_MARKER_MAX_AGE_MS;
    const v = (value: string): libCard.Presence<string> => ({ state: 'value', value });
    expect(MAX).toBe(1200 * 1000);
    expect(libCard.CARD_CONSUMED_SCOPES).toEqual(['main', 'other', 'unknown']);
    const rows: Array<[string, libCard.Presence<string>, number | null, libCard.CardConsumedScope]> = [
      ['main, a second before the boundary, with its LF', v(`main ${U} ${B - 1000}\n`), B, 'main'],
      ['main, at the boundary', v(`main ${U} ${B}`), B, 'main'],
      ['main, exactly the max age before', v(`main ${U} ${B - MAX}`), B, 'main'],
      ['main, older than the max age', v(`main ${U} ${B - MAX - 1}`), B, 'unknown'],
      ['main, after the boundary (a later PreCompact overwrote it)', v(`main ${U} ${B + 1}`), B, 'unknown'],
      ['ambiguous, a second before', v(`ambiguous ${U} ${B - 1000}`), B, 'other'],
      ['subagent, a second before', v(`subagent ${U} ${B - 1000}`), B, 'other'],
      ['ambiguous, after the boundary', v(`ambiguous ${U} ${B + 1}`), B, 'unknown'],
      ['another uuid', v(`main ${OTHER} ${B - 1000}`), B, 'unknown'],
      ['emptied by a later main PreCompact', v(''), B, 'unknown'],
      ['a non-numeric ms', v(`main ${U} soon`), B, 'unknown'],
      ['a word the hook never writes', v(`card ${U} ${B - 1000}`), B, 'unknown'],
      ['a second line', v(`main ${U} ${B - 1000}\nmain ${U} ${B - 1000}\n`), B, 'unknown'],
      ['absent', { state: 'absent' }, B, 'unknown'],
      ['unreadable', { state: 'unreadable' }, B, 'unknown'],
      ['no boundary time', v(`main ${U} ${B - 1000}`), null, 'unknown'],
    ];
    for (const [name, marker, boundaryTsMs, want] of rows) {
      expect(libCard.decideConsumedScope({ marker, uuid: U, boundaryTsMs }), name).toBe(want);
    }
  });

  it("consumedBoundaryTs names the boundary whose span the file printed: the first for a first-row prediction, a later one by its predecessor's head (its uuid with none); null for no card line, no epoch, or no boundary yet (ruling RC3)", () => {
    const ID = 'demo-quiet-basin';
    const U = '0189abcd-1234-4678-9abc-0000000000c5';
    const bs: libCard.CardBoundaryAt[] = [
      { uuid: 'b-1', headUuid: 'h-1', tsMs: 1000 }, { uuid: 'b-2', headUuid: null, tsMs: 2000 }, { uuid: 'b-3', headUuid: 'h-3', tsMs: 3000 },
    ];
    const prefixOf = (start: string): string => libCard.leafId(ID, U, start).slice(0, 7);
    const fileOf = (start: string): libCard.Presence<string> => ({ state: 'value', value: `${libCard.cardLine({ leaf: prefixOf(start) })}\n` });
    const at = (current: libCard.Presence<string>, ccrcId: string | null = ID): number | null =>
      libCard.consumedBoundaryTs({ current, ccrcId, ccUuid: U, firstRowUuid: 'r-first', boundaries: bs });
    expect(new Set(['r-first', 'h-1', 'b-2', 'h-3'].map(prefixOf)).size, 'CONTROL: the four fixture leaves differ in their first 7 characters').toBe(4);
    expect(at(fileOf('r-first'))).toBe(1000);
    expect(at(fileOf('h-1'))).toBe(2000);
    expect(at(fileOf('b-2')), 'b-2 has no head: its own uuid starts the next span').toBe(3000);
    expect(at(fileOf('h-3')), "the next compaction's prediction: no boundary consumed it yet").toBeNull();
    expect(at({ state: 'value', value: 'free text\n' })).toBeNull();
    expect(at({ state: 'absent' })).toBeNull();
    expect(at(fileOf('r-first'), null), 'no epoch names the session').toBeNull();
  });

  it('decideCardWithdraw names a reason for every pass that runs no card step, and keeps the predictions only when the step ran over a caught-up ingest (ruling RC2)', () => {
    const run = (o: { pause?: 'at-cap' | 'low-disk' | null; floorStop?: boolean; ingested?: boolean; budgetLeft?: boolean }): libCard.CardPassFacts =>
      ({ arm: 'run', pause: null, floorStop: false, ingested: true, budgetLeft: true, ...o });
    const rows: Array<[string, libCard.CardPassFacts, libCard.CardWithdrawReason]> = [
      ['a cap pause', run({ pause: 'at-cap' }), 'at-cap'],
      ['a floor pause', run({ pause: 'low-disk' }), 'low-disk'],
      ['a per-chunk floor stop', run({ floorStop: true }), 'floor-stop'],
      ['an ingest an unreadable roster skipped', run({ ingested: false }), 'roster-unreadable'],
      ['a budget spent before the card step', run({ budgetLeft: false }), 'budget'],
      ['a floor pause with the budget spent too: the pause names it', run({ pause: 'low-disk', budgetLeft: false }), 'low-disk'],
      ['the recover arm', { arm: 'recover' }, 'recovering'],
      ['the migrate arm', { arm: 'migrate' }, 'migrating'],
      ['a writer token still to come', { arm: 'hold', word: 'held' }, 'held'],
      ['a migration held for room', { arm: 'hold', word: 'migration-refused' }, 'held'],
      ['a volume that did not answer', { arm: 'hold', word: 'store-unreachable' }, 'unreachable'],
      ['a store.id naming another store', { arm: 'hold', word: 'store-mismatch' }, 'refused'],
      ['a newer schema', { arm: 'hold', word: 'schema-newer' }, 'refused'],
      ['a DB no store.id binds', { arm: 'hold', word: 'store-unbound' }, 'unbound'],
    ];
    for (const [name, pass, reason] of rows) expect(libCard.decideCardWithdraw(pass), name).toEqual({ act: 'withdraw', reason });
    expect(libCard.decideCardWithdraw(run({})), 'the card step ran over a caught-up ingest').toEqual({ act: 'keep' });
    expect([...new Set(rows.map(([, , r]) => r))].sort(), 'every reason word is reached, and none outside the vocabulary')
      .toEqual([...libCard.CARD_WITHDRAW_REASONS].sort());
    expect(() => libCard.decideCardWithdraw({ arm: 'off' } as unknown as libCard.CardPassFacts)).toThrow(/^decideCardWithdraw: not a pass arm/);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'window and purge')
```

Expected: 8 failed, with `libCard.cardIdsIn is not a function`, `libCard.decideCardDelivery is not a function`, `expected undefined to be 40`, `libCard.decidePurgedEntry is not a function`, `expected undefined to be 1200000` (the scope fold), `libCard.consumedBoundaryTs is not a function` (after its CONTROL line passes: B1's `leafId` and Task 1's `cardLine` exist) and `libCard.decideCardWithdraw is not a function`.

- [ ] **Step 3: Implement the block.** Append to the end of `ccd/history/lib.mjs`:

```js

/** The rows after a boundary, in its holding copy, that the delivery measure reads for the SessionStart attachment
 *  (chosen: RV17 found it within 40 rows of the boundary for 75 of 75 boundaries, M). D-4739 (history-card-measure-window) */
export const CARD_MEASURE_ROWS = 40;
/** How long after its leaf was derived a delivery window may stay open (chosen). A copy that stops being read (its
 *  home left the roster, its file unreadable) never closes its window any other way, and the measure's cursor waits
 *  on the oldest open window. */
export const CARD_MEASURE_MAX_WAIT_MS = 24 * 60 * 60 * 1000;
/** The largest attachment body the delivery measure decodes, by the blob's stored `raw_len` (the bytes of its JSON;
 *  chosen). The hook clips its whole SessionStart output at CARD_TOTAL_MAX_CHARS characters, a few bytes each once
 *  JSON-escaped, so a SessionStart attachment stays far below this even beside other hooks' context. A larger body,
 *  such as a re-attached file of many MiB, is skipped unread rather than decompressed only to read its `type`.
 *  D-4739 (history-card-measure-window) */
export const CARD_ATTACHMENT_MAX_BYTES = 1024 * 1024;

const CARD_ID_IN_TEXT_RE = new RegExp(`${escapeRe(CARD_PREFIX)}node (L[0-9a-f]{6,20})(?![0-9A-Za-z])`, 'g');

/** The leaf display prefixes a SessionStart attachment names (§8.6 RV17): every `History: node L…` in the string
 *  leaves of a `hook_additional_context` attachment, wherever it sits in a string, because `_hook_emit_context` joins
 *  the standing cards and the compact subject with one space. Any other attachment type, or a value that is not an
 *  object, names none. Sorted, each once. */
export function cardIdsIn(attachment) {
  if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) return [];
  if (attachment.type !== 'hook_additional_context') return [];
  const ids = new Set();
  const stack = [attachment];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') {
      for (const m of v.matchAll(CARD_ID_IN_TEXT_RE)) ids.add(m[1]);
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v)) stack.push(x);
    }
  }
  return [...ids].sort();
}

/** Whether a leaf's delivery window is closed, so no History line can still arrive in it: CARD_MEASURE_ROWS rows read
 *  after its boundary; the next boundary of its copy reached; its copy read to the end at least RAW_LEAF_GRACE_MS
 *  after the boundary (`eofAfter`, lib eofAfterBoundary); its copy no longer live (gone, retired, exported, or none);
 *  or CARD_MEASURE_MAX_WAIT_MS since the leaf was derived. D-4739 (history-card-measure-window) */
export function cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs }) {
  return !live || nextBoundary || rowsSeen >= CARD_MEASURE_ROWS || eofAfter || waitedMs >= CARD_MEASURE_MAX_WAIT_MS;
}

/** One leaf's delivery (§8.6, W1-e): `served` when a History line in its window names a prefix of it; `mismatch`
 *  when History lines there name only other leaves (a stale or a mispredicted card); `none` when the window closed
 *  with no History line; `wait` while it is open. D-4737 (history-card-measured-from-transcript) */
export function decideCardDelivery({ ids, leafId, windowComplete }) {
  if (ids.some((p) => leafId.startsWith(p))) return 'served';
  if (ids.length > 0) return 'mismatch';
  return windowComplete ? 'none' : 'wait';
}

/** A purged session's scope marker or card directory (§9.4): removed once the registry no longer names the session
 *  (`$REG/<id>.uuid` absent) and its newest write is more than PURGED_FILES_GRACE_MS old. A registry entry that
 *  could not be measured is never read as absent, and an entry with no measured time is kept. */
export function decidePurgedEntry({ reg, newestMtimeMs, nowMs }) {
  if (reg !== 'absent' || newestMtimeMs === null) return 'keep';
  return nowMs - newestMtimeMs > PURGED_FILES_GRACE_MS ? 'remove' : 'keep';
}

// ── The consumption's scope (ruling RC3) ───────────────────────────────────────────────────────────────────────────
/** How long a PreCompact scope marker speaks for the compaction it was written at, in ms: the hook's
 *  COMPACT_CARD_MAX_AGE (1200 s), the age within which its reader serves a `main` marker (§8.6). The hook cannot
 *  import lib, so single-definition.test.ts binds the two (W1-B3 Task 11). D-4738 (history-card-consumed-counter) */
export const SCOPE_MARKER_MAX_AGE_MS = 1200 * 1000;
/** The words a consumption is counted under, `card_consumed:<word>`. W1-e's served share is over `main` and
 *  `unknown`; `other` is reported beside it (ruling RC3). */
export const CARD_CONSUMED_SCOPES = Object.freeze(['main', 'other', 'unknown']);
/** The scope words the hook writes into a marker (§5.1: `_hook_compact_scope`'s verdicts). */
const SCOPE_MARKER_WORDS = Object.freeze(['main', 'subagent', 'ambiguous']);

/** A marker's one line, `<scope> <uuid> <ms>` (one trailing LF is the hook's), or null for any other text. The uuid
 *  is compared with the consumed file's own, which passed UUID_RE before it became a path, so it needs no grammar
 *  of its own here. */
function parseScopeMarker(text) {
  const m = /^([a-z]+) (\S+) ([1-9][0-9]{0,15})$/.exec(text.replace(/\n$/, ''));
  if (m === null || !SCOPE_MARKER_WORDS.includes(m[1])) return null;
  return { scope: m[1], uuid: m[2], ms: Number(m[3]) };
}

/** The time of the boundary that consumed a card file (ruling RC3): of one copy's boundaries, in order, the one
 *  whose leaf, by the span rule (predictedSpanStart over the boundary before it, or the copy's first row for the
 *  first), the file's printed leaf prefixes. Walked newest first, where the consuming boundary almost always is. Its
 *  `tsMs`, or null when the file prints no card line or no boundary there matches (with no epoch, `ccrcId` is null,
 *  and the leaf ids it hashes are not the file's). */
export function consumedBoundaryTs({ current, ccrcId, ccUuid, firstRowUuid, boundaries }) {
  const was = current.state === 'value' ? cardLeafOf(current.value.replace(/\n$/, '')) : null;
  if (was === null) return null;
  for (let k = boundaries.length - 1; k >= 0; k -= 1) {
    const start = predictedSpanStart({ firstRowUuid, lastBoundary: k === 0 ? null : boundaries[k - 1] });
    if (start !== null && leafId(ccrcId, ccUuid, start).startsWith(was)) return boundaries[k].tsMs;
  }
  return null;
}

/** The scope a consumed prediction is counted under (W1-e's denominator, ruling RC3). `marker` is scope/<id> as
 *  read: absent, unreadable, or its text. `uuid` is the consumed file's, and `boundaryTsMs` the consumed boundary's
 *  time, null when it is not known:
 *    main     the marker reads `main <uuid> <ms>`, its ms not after the boundary and within SCOPE_MARKER_MAX_AGE_MS of
 *             it: the hook scoped THIS compaction main, so a line was due;
 *    other    it reads `subagent` or `ambiguous` for this uuid in the same window: no line was ever due;
 *    unknown  anything else: no marker, unreadable, emptied, another uuid, or a ms outside the window (overwritten by a
 *             later PreCompact, or older than this compaction). Unknown stays in W1-e's denominator, so it can only
 *             lower the served share. D-4738 (history-card-consumed-counter) */
export function decideConsumedScope({ marker, uuid, boundaryTsMs }) {
  if (marker.state !== 'value') return 'unknown';
  const m = parseScopeMarker(marker.value);
  if (m === null || m.uuid !== uuid) return 'unknown';
  const age = boundaryTsMs === null ? null : boundaryTsMs - m.ms;
  if (age === null || age < 0 || age > SCOPE_MARKER_MAX_AGE_MS) return 'unknown';
  return m.scope === 'main' ? 'main' : 'other';
}

// ── The withdrawal (ruling RC2: fail closed) ───────────────────────────────────────────────────────────────────────
/** The words a withdrawal is counted under, `card_withdrawn:<word>`: one per way a scheduled pass can run without a
 *  card step over a caught-up ingest. */
export const CARD_WITHDRAW_REASONS = Object.freeze([
  'at-cap', 'low-disk', 'floor-stop', 'roster-unreadable', 'budget', 'recovering', 'migrating', 'held', 'unreachable',
  'refused', 'unbound',
]);

const withdrawFor = (reason) => ({ act: 'withdraw', reason });

/** Whether a scheduled pass withdraws every card prediction, and under which word (ruling RC2: fail closed). A
 *  prediction is consumed only by a card step that sees the boundary that consumed it. So a pass that runs none, or
 *  whose ingest may have stopped short of that boundary, withdraws them all rather than leave a stale line for the
 *  next compaction:
 *    hold     `store-unbound` → unbound; `store-unreachable` → unreachable; any other word passOutcome answers with
 *             EXIT.DB (a refusal that waits on the operator) → refused; the rest (held, a migration held for room or
 *             time) → held;
 *    migrate  → migrating;   recover → recovering;
 *    run      a cap or floor pause → its own word (at-cap, low-disk); the per-chunk floor stopped the ingest →
 *             floor-stop; no ingest ran (an unreadable roster) → roster-unreadable; the run's budget spent before the
 *             card step → budget (the step still consumes and deletes; it only writes nothing); otherwise keep.
 *  A pass that never reaches this (history-off, a server box, a pass no timer starts) withdraws nothing; the hook
 *  serves no line under the first two. D-4740 (history-card-withdrawn-when-not-ticking) */
export function decideCardWithdraw(p) {
  if (p.arm === 'hold') {
    if (p.word === 'store-unbound') return withdrawFor('unbound');
    if (p.word === 'store-unreachable') return withdrawFor('unreachable');
    return withdrawFor(passOutcome(p.word).exit === EXIT.DB ? 'refused' : 'held');
  }
  if (p.arm === 'migrate') return withdrawFor('migrating');
  if (p.arm === 'recover') return withdrawFor('recovering');
  if (p.arm !== 'run') throw new TypeError(`decideCardWithdraw: not a pass arm: ${JSON.stringify(p.arm)}`);
  if (p.pause === 'at-cap' || p.pause === 'low-disk') return withdrawFor(p.pause);
  if (p.floorStop) return withdrawFor('floor-stop');
  if (!p.ingested) return withdrawFor('roster-unreadable');
  if (!p.budgetLeft) return withdrawFor('budget');
  return { act: 'keep' };
}
```

Notes:
- `passOutcome`, `EXIT` and `leafId` are B1's, `predictedSpanStart` and `cardLeafOf` Task 2's, all in this module (a function declaration is hoisted, so Task 2's private `cardLeafOf` is in scope here). `passOutcome` throws on a word that is not a pass word, as `holdExit` already does on the same word, so a caller's bug never folds into a reason.
- The scope words `main`, `subagent` and `ambiguous` are the hook's verdicts (§5.1); `SCOPE_MARKER_WORDS` is module-private, because nothing else in the history modules reads a marker.
- Every test in `decideConsumedScope` and `decideCardWithdraw` is a guard with its own mutant in Step 6. `consumedBoundaryTs`' `was === null` is an early return, not a guard: with no card line, no leaf id can start with it, so removing it changes no answer, and it carries no mutant. That is also why there is no separate test for a null `ccrcId`: the leaf ids it hashes are never the file's, which the table's `no epoch names the session` row pins as behaviour.

- [ ] **Step 4: Declare them.** Append to the end of `ccd/history/lib.d.mts`:

```ts

// --- W1-B3 Task 3: card delivery, window and purge decisions (spec §8.6 RV17, §9.4, §10.7 W1-e)
export const CARD_MEASURE_ROWS: 40;
export const CARD_MEASURE_MAX_WAIT_MS: number;
export const CARD_ATTACHMENT_MAX_BYTES: number;
export function cardIdsIn(attachment: unknown): string[];
export function cardWindowComplete(i: { live: boolean; rowsSeen: number; nextBoundary: boolean; eofAfter: boolean; waitedMs: number }): boolean;
export function decideCardDelivery(i: { ids: readonly string[]; leafId: string; windowComplete: boolean }): 'served' | 'mismatch' | 'none' | 'wait';
export function decidePurgedEntry(i: { reg: 'present' | 'absent' | 'unmeasured'; newestMtimeMs: number | null; nowMs: number }): 'keep' | 'remove';
// rulings RC3 (the consumption's scope) and RC2 (the withdrawal)
export const SCOPE_MARKER_MAX_AGE_MS: number;
export type CardConsumedScope = 'main' | 'other' | 'unknown';
export const CARD_CONSUMED_SCOPES: readonly CardConsumedScope[];
export type CardWithdrawReason =
  | 'at-cap' | 'low-disk' | 'floor-stop' | 'roster-unreadable' | 'budget' | 'recovering' | 'migrating' | 'held'
  | 'unreachable' | 'refused' | 'unbound';
export const CARD_WITHDRAW_REASONS: readonly CardWithdrawReason[];
export interface CardBoundaryAt { readonly uuid: string; readonly headUuid: string | null; readonly tsMs: number | null }
export type CardPassFacts =
  | { arm: 'hold'; word: string }
  | { arm: 'migrate' | 'recover'; word?: string | null }
  | { arm: 'run'; pause: 'at-cap' | 'low-disk' | null; floorStop: boolean; ingested: boolean; budgetLeft: boolean };
export function consumedBoundaryTs(i: {
  current: Presence<string>; ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; boundaries: readonly CardBoundaryAt[];
}): number | null;
export function decideConsumedScope(i: { marker: Presence<string>; uuid: string; boundaryTsMs: number | null }): CardConsumedScope;
export function decideCardWithdraw(p: CardPassFacts): { act: 'withdraw'; reason: CardWithdrawReason } | { act: 'keep' };
```

Check, from the repository root:

```bash
for n in cardIdsIn cardWindowComplete decideCardDelivery decidePurgedEntry consumedBoundaryTs decideConsumedScope decideCardWithdraw; do printf '%s %s\n' "$n" "$(grep -c "^export function $n(" ccd/history/lib.d.mts)"; done
grep -c '^export const CARD_MEASURE_ROWS: 40;$\|^export const CARD_MEASURE_MAX_WAIT_MS: number;$\|^export const CARD_ATTACHMENT_MAX_BYTES: number;$\|^export const SCOPE_MARKER_MAX_AGE_MS: number;$' ccd/history/lib.d.mts
grep -c '^export const CARD_CONSUMED_SCOPES: \|^export const CARD_WITHDRAW_REASONS: \|^export interface CardBoundaryAt \|^export type CardConsumedScope = \|^export type CardWithdrawReason =$\|^export type CardPassFacts =$' ccd/history/lib.d.mts
```

Expected: `1` seven times, then `4`, then `6`.

- [ ] **Step 5: Run them and see them pass, with the typecheck.** In the foreground, with a timeout of at least 600000 ms, each as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every case passes; `tsc` prints nothing.

- [ ] **Step 6: Measure every guard red, then green.** Check the runner is present as in Task 2 Step 7. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task3.json <<'EOF'
[
  { "name": "RV17: any attachment type read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "cardIdsIn ignores",
    "edits": [{ "anchor": "  if (attachment.type !== 'hook_additional_context') return [];\n", "replacement": "" }] },
  { "name": "RV17: an id inside a longer word read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "cardIdsIn ignores",
    "edits": [{ "anchor": "node (L[0-9a-f]{6,20})(?![0-9A-Za-z])`, 'g');", "replacement": "node (L[0-9a-f]{6,20})`, 'g');" }] },
  { "name": "W1-e: any History line counted as served", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardDelivery",
    "edits": [{ "anchor": "  if (ids.some((p) => leafId.startsWith(p))) return 'served';", "replacement": "  if (ids.length > 0) return 'served';" }] },
  { "name": "window: no wait bound", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "cardWindowComplete",
    "edits": [{ "anchor": " || eofAfter || waitedMs >= CARD_MEASURE_MAX_WAIT_MS;", "replacement": " || eofAfter;" }] },
  { "name": "IV5: an unmeasured registry read as absent", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decidePurgedEntry",
    "edits": [{ "anchor": "  if (reg !== 'absent' || newestMtimeMs === null) return 'keep';", "replacement": "  if (reg === 'present' || newestMtimeMs === null) return 'keep';" }] },
  { "name": "RC3: an ambiguous compaction counted main", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "  return m.scope === 'main' ? 'main' : 'other';", "replacement": "  return 'main';" }] },
  { "name": "RC3: a marker written after the boundary read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "age === null || age < 0 || age > SCOPE_MARKER_MAX_AGE_MS", "replacement": "age === null || age > SCOPE_MARKER_MAX_AGE_MS" }] },
  { "name": "RC3: a marker older than the max age read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "age === null || age < 0 || age > SCOPE_MARKER_MAX_AGE_MS", "replacement": "age === null || age < 0" }] },
  { "name": "RC3: no boundary time read as inside the window", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "age === null || age < 0 || age > SCOPE_MARKER_MAX_AGE_MS", "replacement": "age < 0 || age > SCOPE_MARKER_MAX_AGE_MS" }] },
  { "name": "RC3: another uuid's marker read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "  if (m === null || m.uuid !== uuid) return 'unknown';", "replacement": "  if (m === null) return 'unknown';" }] },
  { "name": "RC3: a word the hook never writes read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "  if (m === null || !SCOPE_MARKER_WORDS.includes(m[1])) return null;", "replacement": "  if (m === null) return null;" }] },
  { "name": "RC3: a non-numeric ms read", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "const m = /^([a-z]+) (\\S+) ([1-9][0-9]{0,15})$/.exec(", "replacement": "const m = /^([a-z]+) (\\S+) (\\S+)$/.exec(" }] },
  { "name": "RC3: an absent or unreadable marker parsed", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideConsumedScope",
    "edits": [{ "anchor": "  if (marker.state !== 'value') return 'unknown';\n", "replacement": "" }] },
  { "name": "RC3: the consumed boundary's span read off by one", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "consumedBoundaryTs",
    "edits": [{ "anchor": "lastBoundary: k === 0 ? null : boundaries[k - 1] });", "replacement": "lastBoundary: boundaries[k] });" }] },
  { "name": "RC2: a cap or floor pause keeps the predictions", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (p.pause === 'at-cap' || p.pause === 'low-disk') return withdrawFor(p.pause);\n", "replacement": "" }] },
  { "name": "RC2: a per-chunk floor stop keeps them", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (p.floorStop) return withdrawFor('floor-stop');\n", "replacement": "" }] },
  { "name": "RC2: an ingest the roster skipped keeps them", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (!p.ingested) return withdrawFor('roster-unreadable');\n", "replacement": "" }] },
  { "name": "RC2: a budget spent before the card step keeps them", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (!p.budgetLeft) return withdrawFor('budget');\n", "replacement": "" }] },
  { "name": "RC2: the recover arm keeps them", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (p.arm === 'recover') return withdrawFor('recovering');", "replacement": "  if (p.arm === 'recover') return { act: 'keep' };" }] },
  { "name": "RC2: the migrate arm keeps them", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (p.arm === 'migrate') return withdrawFor('migrating');", "replacement": "  if (p.arm === 'migrate') return { act: 'keep' };" }] },
  { "name": "RC2: an unbound store read as refused", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "    if (p.word === 'store-unbound') return withdrawFor('unbound');\n", "replacement": "" }] },
  { "name": "RC2: a refusal read as a hold", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "passOutcome(p.word).exit === EXIT.DB ? 'refused' : 'held'", "replacement": "'held'" }] },
  { "name": "RC2: an unreachable volume read as a hold", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "    if (p.word === 'store-unreachable') return withdrawFor('unreachable');\n", "replacement": "" }] },
  { "name": "RC2: an arm outside the four read as a run", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "decideCardWithdraw",
    "edits": [{ "anchor": "  if (p.arm !== 'run') throw new TypeError(", "replacement": "  if (false) throw new TypeError(" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task3.json)
```

Expected: every row `red (…)` then `green`; the last line `every guard measured red, then green`; exit 0. The longer-word row reds on `L03a9c1x` (the unguarded pattern takes `L03a9c1`).
  - The scope rows red the fold's table at its own row: `ambiguous, a second before` (`expected 'main' to be 'other'`), `main, after the boundary`, `main, older than the max age`, `no boundary time` (a null age passes both comparisons), `another uuid`, `a word the hook never writes` (read as `other`) and `a non-numeric ms` (a NaN age passes both comparisons, read as `main`). The absent-marker row throws on `absent` (`Cannot read properties of undefined (reading 'replace')`).
  - The off-by-one row reds `consumedBoundaryTs` at its first walk (`expected null to be 1000`: each boundary is then measured against its own head).
  - Each withdrawal row reds the table at its own row (`expected { act: 'keep' } to deeply equal { act: 'withdraw', reason: … }`); the unbound row reads `refused` where `unbound` was expected; the refusal row reads `held` for `store-mismatch`; the unreachable row reads `held`; the arm row answers `roster-unreadable` for `{ arm: 'off' }` where a throw was expected.

- [ ] **Step 7: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-card.test.ts
git commit -m "feat(history): card delivery, delivery-window, consumption-scope, withdrawal and purged-file decisions (W1-B3 task 3)"
```

### Task 4: derive.mjs: export the holding-copy reader and the level-0 slot builder (no behaviour change)

**Files:**
- Modify: `ccd/history/derive.mjs` (B2-created, L4, no entry guard, no `.d.mts`):
  - in place: the body of `function deriveEpochParents(db, ictx, sessionPk, epochSeq) {` (B2 Task 9) loses its slot-building loop to a call of the new `epochCopySlots`;
  - append, at the END of the file: `export function epochCopySlots(...)` and `export function holdingCopyOf(...)`.
- Modify: `server/test/history-card.test.ts`: four import lines directly below the file's last top-of-file `import` line, and one module-scope block plus one describe at the end of the file.
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task4.json`.

**Interfaces:**
- Consumes (B2 `derive.mjs`, module-private, read in the MERGED file before editing):
  - `stmts(db)` (Task 8: `files`, `member`, …), `holdingCopy(s, pass, b)` (Task 8: lib `pickHoldingCopy` over the transcript's measured files; `pass` needs `{ files: Map }`, `b` needs `{ entry_id, transcript_pk }`; answers `{ file_id, eof_ms, source_key }` or null);
  - `parentStmts(db)` (Task 9: `epochTranscripts`, `bounds`, `leafAt`), `fanInLevels(db, ictx, level0)`, `deriveEpochParents`, the exported `deriveParents(db, ictx, budget): number`.
  - B1/B2 `store.mjs`: `createStore(home, opts?)`, `openWriter(dbPath)`, `closeWriter(db)`, `brotli(buf)`; B1 `sweep.mjs`: `newBudget(now?, limits?)`; B1 `lib.mjs`: `makePairIndex([])`, `historyPaths`, `leafId`, `parentId`; B2 lib `planFanIn`, `FAN_IN`; `server/test/tmpHelpers.ts` `mkTmp(prefix)`.
- Produces (`derive.mjs`):
  - `export function epochCopySlots(db: DatabaseSync, sessionPk: number, epochSeq: number): Map<number, Array<string | null>>`: one epoch's level-0 slot lists, keyed by holding `file_id`, each in `boundaries.ord` order (a leaf's id, or null while the boundary has none). deriveEpochParents now reads it.
  - `export function holdingCopyOf(db: DatabaseSync, b: { entry_id: number; transcript_pk: number }): { file_id: number; eof_ms: number | null; source_key: string } | null`: the holding copy of one boundary, by the same `holdingCopy`, over a fresh file cache.
  - `history-card.test.ts` module scope: `Derive4`, `derive4()`, `sweep4()`, `E4`, `uid4`, `forkStore4(n, holders)`.
- Later consumers: Task 5 (`epochCopySlots` for the parent prediction), Task 6 (`holdingCopyOf` for the delivery window).

**Spec:**
- §6.3 fan-in per holding copy and epoch (the coordinator's ruling RB4); §6.1 "The copy" (pickHoldingCopy: a live copy first, then the smaller file_id).
- Pins: this task's plan pin (on a fixture with two forked copies, epochCopySlots answers one list per holding copy, and the parents deriveParents mints are exactly parentId over planFanIn's groups of those lists). Behaviour-neutral: B2's `history-derive.test.ts` and `history-recall.test.ts` stay green, unchanged.
- Departures: B2's D-4688 (`history-span-per-boundary-copy`) (B2's, extended to fan-in by RB4; unchanged here). No new departure: this is an extraction with no change of behaviour.

- [ ] **Step 1: Read the merged function, and run B2's suites before the edit.** From the repository root:

```bash
sed -n "$(grep -n '^function deriveEpochParents(db, ictx, sessionPk, epochSeq) {$' ccd/history/derive.mjs | cut -d: -f1),/^}$/p" ccd/history/derive.mjs
grep -c '^function holdingCopy(s, pass, b) {$\|^function parentStmts(db) {$\|^function fanInLevels(db, ictx, level0) {$' ccd/history/derive.mjs   # 3
grep -c '^export function epochCopySlots(\|^export function holdingCopyOf(' ccd/history/derive.mjs                                          # 0
```

Expected: the function prints as B2 Task 9 wrote it (below, Step 4's "before"), and the counts are `3` and `0`. If the merged body differs from that text, keep the merged body exactly and move only its slot-building loop (the statements that fill the `copies` Map) into `epochCopySlots`; report the difference in the task report. Then, in the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
```

Expected: green (B2's own suites; a red here is a base defect: stop and report it before editing anything).

- [ ] **Step 2: Add the import lines.** In `server/test/history-card.test.ts`, directly below the line `import { compactionSequence } from './historyFixtures.js';`, add:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { brotli, closeWriter, createStore, openWriter } from '../../ccd/history/store.mjs';
```

(`createHash`, `brotli` and `closeWriter` are first used by Tasks 5 and 6; importing them here keeps those tasks to one import edit.)

- [ ] **Step 3: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Task 4: derive.mjs's level-0 slot lists, exported unchanged (spec §6.3, ruling RB4). In-process, against a
// store built by hand in the shape of B2's epochFixture9: one family, one confirmed epoch, one main transcript whose
// boundaries are held by live file 1, file 2 or both.
// ===========================================================================
interface Derive4 {
  epochCopySlots(db: DatabaseSync, sessionPk: number, epochSeq: number): Map<number, Array<string | null>>;
  holdingCopyOf(db: DatabaseSync, b: { entry_id: number; transcript_pk: number }): { file_id: number; eof_ms: number | null; source_key: string } | null;
  deriveParents(db: DatabaseSync, ictx: object, budget: object): number;
}
const derive4 = async (): Promise<Derive4> => (await import('../../ccd/history/derive.mjs')) as unknown as Derive4;
const sweep4 = async (): Promise<{ newBudget(): object }> => (await import('../../ccd/history/sweep.mjs')) as unknown as { newBudget(): object };
const E4 = 'd4e00000-1111-4111-8111-111111111111';
const uid4 = (n: number): string => `d4e00000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** `n` boundaries in one transcript, boundary k held by the live files `holders(k)` names, each with a native leaf. */
function forkStore4(n: number, holders: (k: number) => readonly number[]): { db: DatabaseSync; leafIds: string[] } {
  const home = mkTmp('ccrc-hist-card-slots-');
  createStore(home);
  const db = openWriter(libCard.historyPaths(home).dbFile);
  const leafIds: string[] = [];
  db.exec('BEGIN');
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'card-slots', '', 'demo', 1)").run();
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E4);
  db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(E4);
  const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (?, 1, ?, 1, 'live', 1)");
  file.run(1, 4001);
  file.run(2, 4002);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 4), Buffer.from([0]));
  const ent = db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'system', 'compact_boundary', 'harness', 1, 0, 0, 1, ?)");
  const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, 1, ?)');
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  const leaf = db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, boundary_entry_id, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'not-requested', ?, ?, ?, ?, 100, 0, 0, 1, 1)");
  for (let k = 1; k <= n; k += 1) {
    ent.run(k, uid4(k), 1000 * k);
    bnd.run(k, k);
    for (const f of holders(k)) member.run(f, k, k);
    const id = libCard.leafId('card-slots', E4, `span-${k}`);
    leafIds.push(id);
    leaf.run(id, `Leaf ${k} did part ${k}.`, k, 1000 * k, 1000 * k + 500);
  }
  db.exec('COMMIT');
  return { db, leafIds };
}

/** Boundaries 1-3 in both copies (a shared head: the smaller file_id holds it), 4-9 in file 1 only, 10-17 in file 2. */
const FORKED4 = (k: number): readonly number[] => (k <= 3 ? [1, 2] : k <= 9 ? [1] : [2]);

describe('derive.mjs exports the slot lists fan-in reads, unchanged (spec 6.3, ruling RB4; W1-B3 Task 4)', () => {
  it("epochCopySlots splits one epoch's level-0 slots per holding copy, in ord; holdingCopyOf picks a live copy, then the smaller file_id", async () => {
    const d = await derive4();
    const fx = forkStore4(17, FORKED4);
    try {
      const slots = d.epochCopySlots(fx.db, 1, 1);
      expect([...slots.keys()].map(Number).sort((x, y) => x - y)).toEqual([1, 2]);
      expect(slots.get(1)).toEqual(fx.leafIds.slice(0, 9));
      expect(slots.get(2)).toEqual(fx.leafIds.slice(9));
      expect(Number(d.holdingCopyOf(fx.db, { entry_id: 2, transcript_pk: 1 })!.file_id)).toBe(1);
      expect(Number(d.holdingCopyOf(fx.db, { entry_id: 12, transcript_pk: 1 })!.file_id)).toBe(2);
      expect(d.holdingCopyOf(fx.db, { entry_id: 99, transcript_pk: 1 })).toBeNull();
    } finally {
      fx.db.close();
    }
  });

  it("the parents deriveParents mints are exactly parentId over planFanIn's groups of those lists: the card's prediction and fan-in read one list", async () => {
    const d = await derive4();
    const s = await sweep4();
    const fx = forkStore4(17, FORKED4);
    try {
      const want = [...d.epochCopySlots(fx.db, 1, 1).values()].flatMap((list) => libCard.planFanIn({
        slots: list.map((nodeId) => ({ nodeId, final: nodeId !== null, parented: false })), width: libCard.FAN_IN.leaf,
      })).map((g) => [libCard.parentId(g), g] as const);
      expect(want.map(([, g]) => g), 'one group per copy, never one across the fork').toEqual([fx.leafIds.slice(0, 8), fx.leafIds.slice(9, 17)]);
      d.deriveParents(fx.db, { nowMs: 5_000, fts: false, pairIdx: libCard.makePairIndex([]) }, s.newBudget());
      const made = (fx.db.prepare('SELECT node_id FROM nodes WHERE depth = 1 ORDER BY node_id').all() as Array<{ node_id: string }>).map((r) => r.node_id);
      expect(made).toEqual(want.map(([id]) => id).sort());
      for (const [id, g] of want) {
        const kids = (fx.db.prepare('SELECT child_id FROM node_children WHERE node_id = ? ORDER BY ord').all(id) as Array<{ child_id: string }>).map((r) => r.child_id);
        expect(kids, id).toEqual(g);
      }
    } finally {
      fx.db.close();
    }
  });
});
```

- [ ] **Step 4: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'slot lists')
```

Expected: 2 failed, each with `d.epochCopySlots is not a function`.

- [ ] **Step 5: Extract the slot builder.** In `ccd/history/derive.mjs`, replace B2 Task 9's function (the "before")

```js
function deriveEpochParents(db, ictx, sessionPk, epochSeq) {
  const s = parentStmts(db);
  const ds = stmts(db);
  const pass = { files: new Map() };
  const copies = new Map();   // holding file_id → its level-0 slots, in ord
  for (const t of s.epochTranscripts.all(sessionPk, epochSeq)) {
    for (const b of s.bounds.all(t.transcript_pk)) {
      const holding = holdingCopy(ds, pass, b);
      if (holding === null) continue;
      const copyKey = holding.file_id;
      if (!copies.has(copyKey)) copies.set(copyKey, []);
      const leaf = s.leafAt.get(b.entry_id);
      copies.get(copyKey).push(leaf === undefined ? null : leaf.node_id);
    }
  }
  let made = 0;
  for (const key of [...copies.keys()].sort((x, y) => Number(x) - Number(y))) made += fanInLevels(db, ictx, copies.get(key));
  return made;
}
```

with (the "after"; its doc comment above it is kept as it is):

```js
function deriveEpochParents(db, ictx, sessionPk, epochSeq) {
  const copies = epochCopySlots(db, sessionPk, epochSeq);
  let made = 0;
  for (const key of [...copies.keys()].sort((x, y) => Number(x) - Number(y))) made += fanInLevels(db, ictx, copies.get(key));
  return made;
}
```

Then append to the END of `ccd/history/derive.mjs`:

```js

// ── The slot lists and the holding copy, for the card line (W1-B3 Task 4; spec §6.3, §8.6) ─────────────────────
// Extracted from deriveEpochParents with no change of behaviour, and exported so the card's parent prediction
// (card.mjs, W1-B3 Task 5) and its delivery measure (Task 6) read exactly the lists and the copy fan-in and the
// leaves read (the coordinator's ruling RB4).

/** One epoch's level-0 slot lists, one per HOLDING COPY: each boundary of the epoch's main transcripts, in `ord`,
 *  joins the list of the file holdingCopy picks for it (a live file first, then the smallest file_id, among the
 *  files that hold it), as its leaf's id or null while it has none. A boundary no file holds joins no list. Keys are
 *  the files' `file_id`s as the store answers them. */
export function epochCopySlots(db, sessionPk, epochSeq) {
  const s = parentStmts(db);
  const ds = stmts(db);
  const pass = { files: new Map() };
  const copies = new Map();   // holding file_id → its level-0 slots, in ord
  for (const t of s.epochTranscripts.all(sessionPk, epochSeq)) {
    for (const b of s.bounds.all(t.transcript_pk)) {
      const holding = holdingCopy(ds, pass, b);
      if (holding === null) continue;
      const copyKey = holding.file_id;
      if (!copies.has(copyKey)) copies.set(copyKey, []);
      const leaf = s.leafAt.get(b.entry_id);
      copies.get(copyKey).push(leaf === undefined ? null : leaf.node_id);
    }
  }
  return copies;
}

/** The copy that holds one boundary (§6.1 "The copy"): holdingCopy over a fresh file cache, answering that file's
 *  `{ file_id, eof_ms, source_key }`, or null. */
export function holdingCopyOf(db, b) {
  return holdingCopy(stmts(db), { files: new Map() }, b);
}
```

Check, from the repository root: `grep -c '^export function epochCopySlots(db, sessionPk, epochSeq) {$\|^export function holdingCopyOf(db, b) {$' ccd/history/derive.mjs` prints `2`; `grep -c 'const copyKey = holding.file_id;' ccd/history/derive.mjs` prints `1` (the loop exists once, in `epochCopySlots`); `node --check ccd/history/derive.mjs` prints nothing.

- [ ] **Step 6: Run the new cases, then B2's suites unchanged, and the typecheck.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every case passes, the two B2 files with the same counts as Step 1, and `tsc` prints nothing. A B2 case that was green in Step 1 and is red now is this extraction's defect: undo it and redo Step 5.

- [ ] **Step 7: Measure the guard red, then green.** Check the runner is present as in Task 2 Step 7. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task4.json <<'EOF'
[
  { "name": "RB4: one slot list for the whole transcript", "file": "ccd/history/derive.mjs", "test": "test/history-card.test.ts", "filter": "slot lists",
    "edits": [{ "anchor": "      const copyKey = holding.file_id;", "replacement": "      const copyKey = 0;" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task4.json)
```

Expected: `red (2 failed)` then `green`; the first case reds on `expected [ 0 ] to deeply equal [ 1, 2 ]`, the second on `one group per copy, never one across the fork` (the single list groups leaves 1-8 and 9-16).

- [ ] **Step 8: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts test/history-derive.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/derive.mjs server/test/history-card.test.ts
git commit -m "refactor(history): export derive.mjs's holding copy and per-copy slot lists, unchanged (W1-B3 task 4)"
```

### Task 5: card.mjs: consume and write predictions in the tick, count each consumption by scope, withdraw them on a pass that runs no card step; scope/ and card/ made by the sweep

**Files:**
- Create: `ccd/history/card.mjs` (L4; no entry guard, no `.d.mts`; imported only by `sweep.mjs`).
- Modify: `ccd/history/sweep.mjs` (B1-created, B2-extended; every edit by content, all above the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`):
  - one import line directly below the import statement whose last line ends `from './derive.mjs';` (B2 Tasks 8, 21 and 23 grow that statement's name list; anchor on its last line);
  - in place, in `makeIngestCtx`: the return object's tail `fts: false, admitFile, budgetLeft, isBusy };` (B2 Task 8) gains `readRegPresence`, and one sentence joins its doc comment;
  - in `tick`, one comment and three lines directly below B2 Task 8's line `  if (ctx.ingest && !(ing !== null && ing.paused)) deriveNodes(db, ictx, ctx.budget);`, inside the `// >>> history tick steps` … `// <<< history tick steps` markers: the tick's facts for the withdrawal, the card step, and the withdrawal;
  - in `tick`, one line directly below B1's spool-directory line `  if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);` (below the `// <<< history tick steps` marker and its FU8 comment, above `  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');`);
  - in `tick`'s doc comment (the `/**` directly above `export async function tick(db, ctx) {`), three numbered items: `cardStep` and `withdrawCards` directly below B2's `deriveNodes` item, and `ensureHistoryDirs` below the last item (`markScan`, or B4's `exportStep` if B4 merged first; the body calls `ensureHistoryDirs` last on either base), every item renumbered in order. B1's `history-sweep.test.ts` describe `tick()'s docstring names its steps in the order the body runs them (review 316 F39)` requires every `name(db` call in the body to be a numbered item, in body order;
  - in `holdPass` (B1 Task 24), one line directly above its `  return holdExit(word);` (two-space indent, the only such line);
  - in `scheduledPass` (B1 Task 24), one line directly below `      out('history-sweep: held');` (the writer-token hold), and a comment and one line directly below the line that begins `    const run = planRun({ historyOff: false, store: { act: 'open' },` (four-space indent; B2 Task 25 ends it `recovering: isRecovering(db) });`, and `importRoom`'s own two-space, multi-line `planRun({` call is not it).
- Modify: `server/test/history-card.test.ts`: one import line edited in place and three added below the last top-of-file import; one module-scope helper block and one describe at the end of the file.
- Modify: `server/test/history-lib.test.ts` (B1-created, B2-extended), in place, one line and no import: B1's ring census `RINGS` gains `'card.mjs'`. Its case `every ccd/history/*.mjs has a ring` compares `readdirSync(ccd/history)`'s `.mjs` names with `Object.keys(RINGS)` exactly, so `card.mjs` reds it until the row lands, and no `card.mjs` fix can green it (B2 Task 8 adds `derive.mjs` the same way).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task5.json`.

**Interfaces:**
- Consumes:
  - B1 `sweep.mjs`: `tick(db, ctx)` and its markers; `makeIngestCtx(home, homes, nowMs, ids, floorProbe?)`, whose object carries `home`, `nowMs` (the tick's start, the value `recordExamined` writes into `ingest_files.eof_ms` for every file this tick left at end-of-file: `eof_ms = coalesce(?, eof_ms)` with `f.atEof ? ctx.nowMs : null`), `historyOff()`, and after B2 Task 8 `admitFile`, `budgetLeft(budget)`, `isBusy(e)`; the exported `readRegPresence(path): Presence<string>` (type-checked before open: a FIFO is never opened; trims the value).
  - B1 `store.mjs`: `bump`, `writeFileAtomic(path, text, mode)` (temp in the same directory, `fchmod`, fsync, rename, fsync of the directory); B2 `store.mjs`: `parentOf(db, nodeId)`, `getStep`, `setStep`; B1 `unbrotli`, `withTx`.
  - Task 4: `epochCopySlots(db, sessionPk, epochSeq)`, `holdingCopyOf(db, b)`. Tasks 1-3: `CARD_DIR`, `SCOPE_DIR`, `CARD_LINE_MAX`, `CARD_MEASURE_ROWS`, `CARD_ATTACHMENT_MAX_BYTES`, `cardDirOf`, `cardFileOf`, `scopeMarkerOf`, `predictedSpanStart`, `planCardPrediction`, `decideCardFile`, `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery`, `decidePurgedEntry`, `consumedBoundaryTs`, `decideConsumedScope`, `decideCardWithdraw`. B1/B2 lib: `UUID_RE`, `idOk`, `historyPaths`, `leafId`, `eofAfterBoundary`, `producerOf`.
  - B1 `sweep.mjs` (Task 24): `holdPass(home, P, word, now, out)` (a hold with no DB open: the journal half, the word, its exit); `scheduledPass`, its writer-token hold `out('history-sweep: held')`, and its `planRun` line, whose `run.arm` is `run`, `migrate`, `hold` or, after B2 Task 25, `recover`, with `run.holdWord`; `passCtx`'s `pause` (planRun's `'at-cap' | 'low-disk' | null`) and `out`; `budgetLeft(budget)`; `ingestTick`'s `paused` (the per-chunk floor stopped the ingest) and its `null` when an unreadable roster skips it. B2 Task 25: the `run.arm === 'recover'` branch, which returns `recoverPass(…)`.
  - Test helpers: B1 `historyHelpers.ts` `makeHistoryBox(prefix, { role? })`, `runSweep(box, args?, { env? })`, `runDriver(box, deps)` (B2 Task 25's `budgetBytes` among its deps), `plantSession`, `plantTranscript`, `spoolLine`, `openStoreRO`, `counters`, `skipOnDarwin`, `type HistoryBox`; the statfs preload's `HISTORY_TEST_STATFS=<bavail>:<size>` (every spawn carries the preload); B1 lib `floorThreshold(fsSizeBytes)` and `historyPaths(home).writer` and `.storeId`; B2 `recoverRow(box)`; B1/B2 `historyFixtures.ts` `compactionSequence`, `userRow`, `type Row`.
- Produces:
  - `card.mjs`: `export function ensureHistoryDirs(db: DatabaseSync, home: string): { scope: 'made' | 'present' | 'refused'; card: 'made' | 'present' | 'refused' }`; `export function consumeAndWriteCards(db, ictx, budget): { written: number; consumed: number; deleted: number }`; `export function cardStep(db, ictx, budget): { measure: object | null; cards: object | null }` (Task 6 fills `measure`); `export function withdrawCards(db: DatabaseSync | null, home: string, pass: CardPassFacts, out: (line: string) => void): number`.
  - Counters: `card_written`, `card_consumed:<main|other|unknown>` (W1-e's denominator by scope, ruling RC3), `card_withdrawn:<reason>` (a `CARD_WITHDRAW_REASONS` word, ruling RC2), `card_skipped:<reason>` (a write due at end-of-file that the prediction refused; `fork-qualified` in practice), `card_dir_refused`, `card_write_failed`, `card_unrecorded_removed` (a prediction on disk removed because its generation record was due and could not be written or removed; coordinator ruling R-recalloff-keep), `card_cleanup_failed` (the id's other predictions could not all be removed after a write that landed), `history_dir_refused:<scope|card>`. A hold with no DB open prints `history-sweep: card_withdrawn:<reason> <n>` instead, after its own word.
  - `sweep.mjs`: `import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';`; `makeIngestCtx`'s object gains `readRegPresence`; in `tick`, `if (ctx.ingest && !(ing !== null && ing.paused)) cardStep(db, ictx, ctx.budget);` with `withdrawCards(db, ctx.home, cardPass, ctx.out);` below it, and `ensureHistoryDirs(db, ctx.home);`; `tick`'s doc comment items `cardStep`, `withdrawCards` and `ensureHistoryDirs`; `withdrawCards` in `holdPass`, on the writer-token hold and for every `planRun` arm that is not `run`.
  - `history-lib.test.ts`: the `RINGS` row `'card.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' || s === './sweep.mjs' || s === './cli.mjs' },`.
  - `history-card.test.ts` module scope: `CARD_SLUG`, `CARD_GEN`, `T0C`, `FS_C`, `FLOOR_C`, `sidC`, `SeqC`, `cutBefore`, `firstUuidC`, `plantC`, `passC`, `settleC`, `pokeC`, `appendRows`, `cardPath`, `cardOf`, `qC`, `leavesC`, `childrenC`, `familyC`, `consumedC`, `expectedCard`, `printed` (Tasks 6 and 7 reuse them).
  - Files: `card/<id>/<uuid>.txt` (the line and one LF) and, written before it, `card/<id>/<uuid>.gen` (coordinator ruling R-recalloff-parity): the generation B2's CLI resolves for the id under `'newest'`, the newest unmerged family's by `first_seen_ms` then `session_pk` (`''` for a legacy family or none), and one LF, 0600, kept, written or removed as Task 2's `decideCardGenFile` says. At most 37 bytes, so with the line (at most 145 characters) a session's `card/<id>/` stays within §9.4's 512 B.
- Later consumers: Task 6 (`cardStep` gains the measure), Task 7 (the collector beside it, and its own doc-comment item; it unlinks every file of a purged id's directory, the record included), Task 12 (the `history-card-files` row's collector promises), Tasks 9 and 10 (the hook reads `card/<id>/<psid>.txt`, and `card/<id>/<psid>.gen` when neither the env nor the registry resolves a generation, and gates its reserve on `card/` existing).

**Spec:**
- §6.4's `card.mjs` row (W1-B3): this task creates `ccd/history/card.mjs`, an L4 module importing `node:fs`, `./lib.mjs`, `./store.mjs` and `./derive.mjs` only (never `node:sqlite`, `./sweep.mjs` or `./cli.mjs`, as its `RINGS` row pins), and `sweep.mjs` gains one import, `./card.mjs`, which §6.4's `sweep.mjs` row admits as `{ cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards }` (this task imports `{ cardStep, ensureHistoryDirs, withdrawCards }`, Steps 5 and 6; Task 7 adds the collector). `card.mjs` keeps the card's measure, its writes and its collector out of a module that is already the writer's whole tick, as B2's `derive.mjs` keeps derivation out; every decision is still lib's, and the sweep still runs every step, so §9.2's order and §9.4's writer hold through it.
- §8.6 Timing: the file is written only when the transcript's cursor is at end-of-file, and deleted when the indexer ingests the boundary that consumed it; §9.2 step 6 (derive; measure delivery; then write `card/` files temp-then-rename; under the tick's budget, never on the recover arm, which never ticks); §5.1 S4 (the hook never makes a directory); §5.2; §9.6 (card files 0600, history directories 0700); §9.4 `history-card-files`; §5.1 (the scope marker the consumption's scope is read from); §9.3 and §9.14 (the pauses and holds a withdrawal follows).
- Rulings: RC2 (fail closed: every pass that runs no card step withdraws every prediction; the budget bounds a write, never the consume/delete decision) and RC3 (each consumption counted by the scope marker its compaction left).
- Pins: this task's plan pins (parity with derivation for the first compaction, the 8th leaf and the newest condensed fallback; a not-final slot names no parent; the fork skip, and a consumption just before one still counted; a spooled fork's epoch predicted from the parent's boundary its copy holds, its prediction replacing the parent's (ruled Q16); the end-of-file gate with a consumption off end-of-file; the file's text, mode, one-per-id and the symlink refusal; registry-named sessions only; a write failure counted, never fatal, and leaving no temp (a CONTROL on B1's `writeFileAtomic`, which removes its own temp on a failure before the rename); a failed cleanup counted apart from the write; a generation record that was due and could not be written or removed takes the kept prediction with it, at end-of-file and off it (coordinator ruling R-recalloff-keep); the two directories made 0700 by a bound store's first tick and by nothing else; a consumption counted `main`, `other` or `unknown` by its compaction's marker, never through a link; every prediction withdrawn, never through a link, under a floor pause, on the recover arm, under a spent budget after the consume and delete ran, on a writer-token hold and on a refused store with no DB open).
- Departures:
  - B1's D-4224 (`history-tick-order`) (the card step's place: after the leaves and parents, under their gate).
  - D-4741 (`history-card-dirs-made-by-sweep`) (NEW): the spec says the hook never makes `scope/`, which it writes, and never says who does; the sweep makes both directories at every bound store's tick, so the hook's marker and the render reserve arm within one tick of `ccrc update` and never on a box without history.
  - D-4742 (`history-card-one-file-per-id`) (NEW): §9.4 bounds the row "≤512 B per session"; writing a new uuid's prediction removes the id's other `<uuid>.txt` (a `/clear`'d or forked session's), rather than leaving it until purge.
  - D-4743 (`history-card-registry-names-the-session`) (NEW): a prediction is written only for the uuid `$REG/<id>.uuid` names. The periodic scan reads every known transcript to its end each 30 minutes, so end-of-file alone would write a file for every session the store ever saw; the hook serves only the pane's own uuid, which the registry names. A file the registry no longer names is still consumed and deleted.
  - D-4744 (`history-card-newest-live-copy`) (NEW): the prediction reads the transcript's live copy written last (newest `mtime_ns`, then the larger `file_id`, §6.1's newest-copy rule), the one Claude Code appends the next boundary to; the spec names "the transcript's cursor" in the singular.
  - D-4738 (`history-card-consumed-counter`) (NEW, ruled RC3): each prediction a boundary of the main transcript consumed, a fork skip's included (Task 2), is counted `card_consumed:<scope>`. The scope is lib's `decideConsumedScope` over the scope marker the compaction's PreCompact left, read read-only and never through a link, and the consumed boundary's time (lib `consumedBoundaryTs`): `main`, `other` (the hook scoped it `subagent` or `ambiguous`, so it could never carry a line) or `unknown`. A subagent's own compaction lands in its own transcript and is never counted. W1-e's served share is over `main` and `unknown` (Task 13).
  - D-4740 (`history-card-withdrawn-when-not-ticking`) (NEW, ruled RC2): a scheduled pass that runs but does not run the card step over a caught-up ingest withdraws every `card/<id>/<uuid>.txt`, counted `card_withdrawn:<reason>` (lib `decideCardWithdraw` decides; this task measures and unlinks). In `consumeAndWriteCards` the budget is checked only before a write.
  - B2's D-4734 (`history-fork-spooled`) (B2-defined, ruled Q16): consumed by the spooled-fork case only. No B3 code reads an epoch's cause.
- Coordinator ruling R-recalloff-parity (spec §9.7, §8.2, C68): the sweep, which can read the store, records beside each prediction the generation the CLI resolves for the id when neither the env nor the registry names one, by the CLI's own rule, so the hook can agree with the CLI there. The record is the ruling's own mechanism, not a departure; spec §8.6, §9.4's `history-card-files` row and §9.7 carry it once the coordinator folds the ruling into the spec.
- Coordinator ruling R-recalloff-keep (the final check's R2; spec §8.6's "It never leaves a stale record beside a standing prediction"): when the record was due (`write` or `delete`) and that act fails, `oneCard`'s catch unlinks `<uuid>.txt` too, counted `card_unrecorded_removed`. The ruling names the `keep` arm; this task applies it to the `write` arm over an existing prediction as well, the same hazard (Step 5's notes).

**Choices this task makes:**
- **The record's query is spelled here, and pinned against the CLI's.** `card.mjs` may not import `recall.mjs` (§6.4's `card.mjs` row: lib, store, `derive.mjs`, `node:fs`), so `cardStmts`' `newestFamily` spells B2's `NEWEST_FAMILY_SQL` order (`merged_into IS NULL`, `first_seen_ms DESC, session_pk DESC`). The case `the generation record: …` compares the record with B2's exported `familiesOf` over the same store at three states (the planted family, a newer family, a legacy newest family), so a drift between the two spellings reds a case rather than splitting the eval's arms. A restore or rebuild that swaps the store between ticks leaves the record as stale as the prediction beside it until the next card step; both are rewritten there.
- **The card step's place in the tick** (B1's D-4224 (`history-tick-order`)): `cardStep` runs directly after B2's `deriveNodes`, under the same ingest-and-not-paused gate, with `withdrawCards` below it; `ensureHistoryDirs` runs last, below B1's spool-directory line. None of them runs on the recover arm, which never ticks: that pass withdraws every prediction before it runs (Step 6 item 7).
- **Spooled forks (ruled Q16) need no code here, and one case pins them.**
  - `cardStmts`' `epochOf` reads any confirmed epoch of an unmerged family, whatever its `cause` or `declared_by` (derive.mjs's own rule). So a `fork` epoch is predicted for exactly as a startup, clear or import epoch is, from the drain that confirms it (B2's fork line, observed at the rename as a resume line is) rather than from the 30-minute registry scan B1 left forks to.
  - The registry gate (D-4743 (`history-card-registry-names-the-session`)) follows `.uuid`, which `_sync_uuid` moves to the fork's sid. One file per id (D-4742 (`history-card-one-file-per-id`)) then removes the parent's prediction, as after a `/clear`.
  - What is new is the input shape. A fresh-sid fork's copy holds the parent's rows and boundary, each one entry with a membership in each file, while `boundaries.transcript_pk` stays the parent's (the first claim). `lastBoundary`, `firstRow` and `boundaries` read a copy by membership, as derive.mjs's `copyRows` does, so the fork's next span starts at the head of the last boundary the copy holds, the parent's copied one included. That is where derivation starts the fork's leaf. lib's `consumedBoundaryTs` (Task 3) walks the same membership-ordered list, so a fork's consumption finds its boundary the same way.
  - The case `a spooled fork (ruled Q16): …` pins that parity through real passes. Its mutant, `6.1: a fork's copied boundaries ignored by the span start`, narrows `lastBoundary` to the copy's own transcript's boundaries, a plausible slip that every single-transcript case survives: it reds only this case.
  - Claude Code's same-id fork arm confirms the existing epoch and continues the same transcript. In its one file that is an ordinary continuation; in a copy in a second home it is the two-copies shape the two `fork rule` cases already cover (Task 2's choice).

- [ ] **Step 1: Confirm the anchors at the base.** From the repository root:

```bash
grep -c "^  if (ctx.ingest && !(ing !== null && ing.paused)) deriveNodes(db, ictx, ctx.budget);$" ccd/history/sweep.mjs   # 1
grep -c "^  if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);$" ccd/history/sweep.mjs             # 1
grep -c "fts: false, admitFile, budgetLeft, isBusy };" ccd/history/sweep.mjs                                               # 1
grep -c "^export function readRegPresence(path) {$" ccd/history/sweep.mjs                                                   # 1
grep -n "from './derive.mjs';$" ccd/history/sweep.mjs                                                                       # one line
grep -c 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs                                                           # 1
grep -cF 'const tmp = `${path}.tmp.${process.pid}`;' ccd/history/store.mjs                                                 # 1
test -e ccd/history/card.mjs && echo EXISTS || echo ABSENT                                                                  # ABSENT
grep -c '^  return holdExit(word);$' ccd/history/sweep.mjs                                                                  # 1 (holdPass)
grep -cF "      out('history-sweep: held');" ccd/history/sweep.mjs                                                         # 1
grep -c "^    const run = planRun({ historyOff: false, store: { act: 'open' }," ccd/history/sweep.mjs                   # 1
grep -c "^    if (run.arm === 'recover') {$" ccd/history/sweep.mjs                                                        # 1 (B2 Task 25)
grep -cxF '  const ing = ctx.ingest && !ctx.rosterUnreadable ? await ingestTick(db, ictx, ctx.budget) : null;' ccd/history/sweep.mjs   # 1
grep -cE '^ \* +[0-9]+\. `deriveNodes`' ccd/history/sweep.mjs                                                              # 1 (B2's tick doc-comment item)
grep -cE '^ \* +[0-9]+\. `markScan`' ccd/history/sweep.mjs                                                                 # 1
grep -c "^    'derive.mjs': { ring: 'L4'" server/test/history-lib.test.ts                                                 # 1 (B2 Task 8's RINGS row)
grep -c "^    'card.mjs':" server/test/history-lib.test.ts                                                                # 0
```

Expected: `1`, `1`, `1`, `1`, exactly one line number, `1`, `1`, `ABSENT`, then `1` five times, then `1`, `1`, `1` and `0`. The second `1` is B1's spool-directory line (FU8: it makes `spool/` only when what stands there is not `'other'`), which `ensureHistoryDirs` goes below; the new line stays unconditional, whatever stands at `spool/`. The `1` after the guard's count is `writeFileAtomic`'s temp name, `<path>.tmp.<pid>`, which `removeOtherCards`' pattern matches for a writer killed mid-write (B1's `writeFileAtomic` removes its own temp on any failure before the rename, so `oneCard` unlinks none); a `0` there means B1 merged another name: spell `removeOtherCards`' pattern to match it, and report it. The five after `ABSENT` are the withdrawal's anchors: `holdPass`'s return, the writer-token hold's outcome line, `scheduledPass`'s `planRun` line, B2's recover arm (which the `planRun` line's withdrawal must precede), and the tick's `ing` line (`null` when an unreadable roster skips the ingest). The last four: `tick`'s doc comment carries a `deriveNodes` item and a `markScan` item (B1's F39 case already requires B2's `deriveNodes(db` call to be listed, so a `0` for it means B2 merged with that case red: stop and report it), B2's `derive.mjs` row is in `RINGS`, and no `card.mjs` row is yet. Any other difference: B1 or B2 merged a different spelling. Read the merged `tick` and its doc comment, `makeIngestCtx`, `holdPass`, `scheduledPass` and `RINGS`, re-anchor on the merged lines that do the same thing, and report the difference.

- [ ] **Step 2: Edit the test file's imports.** In `server/test/history-card.test.ts`, replace the line `import { compactionSequence } from './historyFixtures.js';` with:

```ts
import { compactionSequence, userRow, type Row } from './historyFixtures.js';
```

and directly below the line `import { brotli, closeWriter, createStore, openWriter } from '../../ccd/history/store.mjs';` add:

```ts
import fs from 'node:fs';
import path from 'node:path';
import {
  makeHistoryBox, runSweep, runDriver, plantSession, plantTranscript, spoolLine, openStoreRO, counters, skipOnDarwin,
  recoverRow, type HistoryBox,
} from './historyHelpers.js';
```

(`runDriver` is first used by Task 7.)

- [ ] **Step 3: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Tasks 5-7: the sweep's card work through REAL passes. Each box is a fixture HOME; a session is planted as
// B2's derivation tests plant one (registry rows, a transcript in compactionSequence's measured shape, the
// SessionStart(startup) line the hook spools), and sweep.mjs runs as the shim would. A Stop line spooled before a
// pass hints its session, so that pass reads the transcript to its end: the end-of-file a prediction is written at.
// ===========================================================================
const CARD_SLUG = '-home-u-worktrees-p-card-demo';
const CARD_GEN = '0189abcd-1234-4678-9abc-0000000000c0';
/** A day before now: every raw-leaf grace (lib RAW_LEAF_GRACE_MS) is long past, so a boundary read to the end is final. */
const T0C = Date.now() - 86_400_000;
/** The filesystem the statfs seam describes for a floor-pause case, and lib's own floor over it (never retyped). */
const FS_C = 10 * 1024 ** 3;
const FLOOR_C = libCard.floorThreshold(FS_C);
const sidC = (n: number): string => `0189abcd-1234-4678-9abc-${n.toString(16).padStart(12, '0')}`;
type SeqC = ReturnType<typeof compactionSequence>;
/** The index of boundary k in a sequence's rows: rows.slice(0, it) is the transcript just before compaction k. */
const cutBefore = (s: SeqC, k: number): number => s.rows.findIndex((r) => r['uuid'] === s.boundaryUuids[k]);
const firstUuidC = (s: SeqC): string => String(s.rows[0]!['uuid']);

/** One session: its registry rows (generation CARD_GEN), its transcript under `account`, and the SessionStart(startup)
 *  line whose `reg` is its sid, so the drain confirms the epoch on the line's own evidence. Returns the transcript. */
function plantC(box: HistoryBox, id: string, uuid: string, rows: readonly Row[], account = 'claude'): string {
  plantSession(box, id, { uuid, generation: CARD_GEN, project: 'demo', workdir: '/home/u/worktrees/p/card-demo' });
  const p = plantTranscript(box, account, CARD_SLUG, uuid, [...rows]);
  spoolLine(box, id, { v: 1, ev: 'SessionStart', id, sid: uuid, src: 'startup', reg: uuid, gen: CARD_GEN });
  return p;
}
function passC(box: HistoryBox): void {
  const r = runSweep(box);
  expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
}
/** B2's settle: pass 1 makes the store, runs the first registry scan (each registry-named session gets a confirmed
 *  `import` epoch and its transcript is ingested and derived in that tick) and renames the spool; pass 2 drains the
 *  SessionStart lines; pass 3 is one more. Rows planted BEFORE a boundary leave the store empty of nodes through pass 1. */
function settleC(box: HistoryBox): void {
  for (let i = 0; i < 3; i += 1) passC(box);
}
/** A Stop line per id, then one pass: that pass reads each id's transcripts to their end. */
function pokeC(box: HistoryBox, ...ids: string[]): void {
  for (const id of ids) spoolLine(box, id, { v: 1, ev: 'Stop', id });
  passC(box);
}
function appendRows(p: string, rows: readonly Row[]): void {
  fs.appendFileSync(p, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}
const cardPath = (box: HistoryBox, id: string, uuid: string): string => path.join(box.root, 'card', id, `${uuid}.txt`);
const cardOf = (box: HistoryBox, id: string, uuid: string): string | null =>
  (fs.existsSync(cardPath(box, id, uuid)) ? fs.readFileSync(cardPath(box, id, uuid), 'utf8') : null);
function qC<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as unknown as T[]; } finally { db.close(); }
}
/** A transcript's leaves, in boundary order. */
const leavesC = (box: HistoryBox, uuid: string): string[] => qC<{ node_id: string }>(box,
  `SELECT n.node_id FROM nodes n JOIN boundaries b ON b.entry_id = n.boundary_entry_id
   JOIN transcripts t ON t.transcript_pk = n.transcript_pk WHERE t.cc_session_uuid = ? AND n.depth = 0 ORDER BY b.ord`, uuid)
  .map((r) => r.node_id);
const childrenC = (box: HistoryBox, nodeId: string): string[] => qC<{ child_id: string }>(box,
  'SELECT child_id FROM node_children WHERE node_id = ? ORDER BY ord', nodeId).map((r) => r.child_id);
/** Every node of a session id's families: the set a card's display prefixes are unique within. */
const familyC = (box: HistoryBox, id: string): string[] => qC<{ node_id: string }>(box,
  'SELECT n.node_id FROM nodes n JOIN sessions s ON s.session_pk = n.session_pk WHERE s.ccrc_id = ?', id).map((r) => r.node_id);
/** Every consumption counter, scoped or not (ruling RC3): a bare `card_consumed` would show here too. A case that
 *  plants no scope marker expects `card_consumed:unknown`. */
const consumedC = (box: HistoryBox): Record<string, number> =>
  Object.fromEntries(Object.entries(counters(box)).filter(([k]) => k === 'card_consumed' || k.startsWith('card_consumed:')));
/** The text a correct prediction file holds: lib's line over the family's display prefixes, and one LF. */
const expectedCard = (family: readonly string[], leaf: string, parent: string | null = null): string => {
  const shown = libCard.displayPrefixes([...family, leaf, ...(parent === null ? [] : [parent])]);
  return `${libCard.cardLine({ leaf: shown.get(leaf)!, parent: parent === null ? null : shown.get(parent)! })}\n`;
};
/** The leaf and parent prefixes a card file prints. */
const printed = (text: string): { leaf: string; parent: string | null } => {
  const m = /^History: node (L[0-9a-f]{6,20})… \(this compaction\)(?: · parent (N[0-9a-f]{6,20})…)?/.exec(text);
  if (m === null) throw new Error(`not a card line: ${text}`);
  return { leaf: m[1]!, parent: m[2] ?? null };
};

describe('the sweep writes and consumes card/<id>/<uuid>.txt at end-of-file (spec 8.6 Timing, 9.2 step 6; W1-B3 Task 5)', () => {
  skipOnDarwin();

  it("the first compaction: the card names the epoch's first leaf and no parent; ingested, that is the leaf derivation mints, and the next prediction replaces the consumed one", () => {
    const box = makeHistoryBox('ccrc-hist-card-first-');
    const [ID, U] = ['card-first', sidC(0xf1)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf1, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    const card0 = cardOf(box, ID, U);
    expect(card0).toBe(expectedCard([], want0));
    expect(printed(card0!).parent).toBeNull();
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    pokeC(box, ID);
    expect(leavesC(box, U)).toEqual([want0]);
    expect(want0.startsWith(printed(card0!).leaf), 'derivation minted the leaf the card printed').toBe(true);
    expect(consumedC(box), 'no scope marker beside it: counted unknown').toEqual({ 'card_consumed:unknown': 1 });
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
  }, 240_000);

  it("the 8th leaf of a run: the card names its depth-1 parent, which derivation then mints over the same 8 leaves; after it, the epoch's newest condensed node", () => {
    const box = makeHistoryBox('ccrc-hist-card-eighth-');
    const [ID, U] = ['card-eighth', sidC(0xf2)];
    const s = compactionSequence({ n: 8, trigger: 'auto', seed: 0xf2, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 7)));
    settleC(box);
    pokeC(box, ID);
    const seven = leavesC(box, U);
    expect(seven).toHaveLength(7);
    const l7 = libCard.leafId(ID, U, s.headUuids[6]!);
    const P = libCard.parentId([...seven, l7]);
    const card = cardOf(box, ID, U)!;
    expect(card).toBe(expectedCard(seven, l7, P));
    appendRows(p, s.rows.slice(cutBefore(s, 7)));
    pokeC(box, ID);
    expect(leavesC(box, U)).toEqual([...seven, l7]);
    expect(childrenC(box, P), 'derivation minted the predicted parent over the same eight leaves').toEqual([...seven, l7]);
    expect(P.startsWith(printed(card).parent!)).toBe(true);
    const l8 = libCard.leafId(ID, U, s.headUuids[7]!);
    expect(cardOf(box, ID, U), 'the next leaf is no 8th: the newest condensed node is named').toBe(expectedCard(familyC(box, ID), l8, P));
  }, 240_000);

  it('a leaf not final in the run stops the prediction: no predicted parent and, with no condensed node, no parent at all', () => {
    const box = makeHistoryBox('ccrc-hist-card-gap-');
    const [ID, U] = ['card-gap', sidC(0xf3)];
    // Rows two minutes old: boundary 3, its summary row dropped, is inside the raw-leaf grace, so it has no leaf yet.
    const s = compactionSequence({ n: 8, trigger: 'manual', seed: 0xf3, sessionId: U, startMs: Date.now() - 120_000 });
    plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 7)).filter((r) => r['uuid'] !== s.summaryUuids[3]));
    settleC(box);
    pokeC(box, ID);
    const leaves = leavesC(box, U);
    expect(leaves, 'six leaves; boundary 3 waits').toHaveLength(6);
    expect(cardOf(box, ID, U)).toBe(expectedCard(leaves, libCard.leafId(ID, U, s.headUuids[6]!)));
  }, 240_000);

  it('a next leaf the fork rule would qualify: no card, counted card_skipped:fork-qualified; CONTROL: the same copy with no other fork gets one', () => {
    const box = makeHistoryBox('ccrc-hist-card-fork-');
    const [ID, U] = ['card-fork', sidC(0xf4)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf4, sessionId: U, startMs: T0C });
    const other = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xf5, sessionId: U, startMs: T0C + 600_000 });
    // Copy A (the first account's home) compacted again after pre's head; copy B (the second's) did not, and is the
    // copy written last.
    const a = plantTranscript(box, 'claude', CARD_SLUG, U, [...pre.rows, ...other.rows]);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(a, hourAgo, hourAgo);
    plantC(box, ID, U, [...pre.rows, userRow({ uuid: sidC(0xbf4), ts: new Date(T0C + 900_000).toISOString(), sessionId: U, text: 'fork b' })], 'claude-a');
    const [ID2, U2] = ['card-fork-control', sidC(0xf6)];
    const pre2 = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf6, sessionId: U2, startMs: T0C });
    plantC(box, ID2, U2, pre2.rows, 'claude-a');
    settleC(box);
    pokeC(box, ID, ID2);
    expect(leavesC(box, U), "copy A's second boundary holds the plain id of the span B would start next").toContain(libCard.leafId(ID, U, pre.headUuids[0]!));
    expect(cardOf(box, ID, U)).toBeNull();
    expect(counters(box)['card_skipped:fork-qualified']).toBeGreaterThanOrEqual(1);
    expect(cardOf(box, ID2, U2), 'CONTROL').toBe(expectedCard(familyC(box, ID2), libCard.leafId(ID2, U2, pre2.headUuids[0]!)));
  }, 240_000);

  it('a consumed prediction whose next leaf the fork rule would qualify: deleted and still counted card_consumed', () => {
    const box = makeHistoryBox('ccrc-hist-card-fork-consumed-');
    const [ID, U] = ['card-fork-consumed', sidC(0xf5c)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf5c, sessionId: U, startMs: T0C });
    const other = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xf5d, sessionId: U, startMs: T0C + 600_000 });
    const head = pre.rows.slice(0, cutBefore(pre, 0));
    // Copies A (the first account's home) and B (the second's: the registry's session, written last) start equal,
    // before pre's boundary, so B's first prediction is the epoch's first leaf, bound nowhere yet.
    const a = plantTranscript(box, 'claude', CARD_SLUG, U, [...head]);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(a, hourAgo, hourAgo);
    const b = plantC(box, ID, U, head, 'claude-a');
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(pre));
    expect(cardOf(box, ID, U), 'the first prediction, before any boundary').toBe(expectedCard([], want0));
    // A compacts at pre's boundary and again after its head; B compacts at pre's boundary only and stays the copy
    // written last. B's next span starts at pre's head, whose plain id A's second boundary now holds.
    appendRows(a, [...pre.rows.slice(cutBefore(pre, 0)), ...other.rows]);
    fs.utimesSync(a, hourAgo, hourAgo);
    appendRows(b, [...pre.rows.slice(cutBefore(pre, 0)),
      userRow({ uuid: sidC(0xbf5c), ts: new Date(T0C + 900_000).toISOString(), sessionId: U, text: 'fork b' })]);
    pokeC(box, ID);
    expect(leavesC(box, U), 'derivation minted the leaf the first card printed').toContain(want0);
    expect(leavesC(box, U), "CONTROL: A's second boundary holds the plain id of B's next span").toContain(libCard.leafId(ID, U, pre.headUuids[0]!));
    expect(counters(box)['card_skipped:fork-qualified'], 'CONTROL: the fixture reached the fork skip').toBeGreaterThanOrEqual(1);
    expect(cardOf(box, ID, U), 'the consumed prediction is deleted, and none is written in its place').toBeNull();
    expect(consumedC(box), 'the consumption is counted though the next prediction is a skip').toEqual({ 'card_consumed:unknown': 1 });
  }, 240_000);

  it("a spooled fork (ruled Q16): once B2's fork line confirms the fork's epoch, its card starts at the head of the parent's boundary its copy holds, derivation mints that leaf, and the fork's prediction replaces the parent's", () => {
    const box = makeHistoryBox('ccrc-hist-card-forked-');
    const [ID, U, UF] = ['card-forked', sidC(0xfb1), sidC(0xfb2)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xfb1, sessionId: U, startMs: T0C });
    const own = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xfb2, sessionId: UF, startMs: T0C + 600_000 });
    plantC(box, ID, U, pre.rows);
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U), "CONTROL: the parent's prediction").toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, pre.headUuids[0]!)));
    // An in-pane /branch (spec 6.1): a fresh sid whose transcript copies the parent's rows verbatim, so each is one
    // entry with a membership in each file, and the parent's boundary stays the parent transcript's. The hook's line
    // carries the parent's uuid as `reg` (it fires before _sync_uuid moves .uuid), and .uuid names the fork before the
    // sweep observes the line, so the fork epoch confirms by the observation, as a resume line would.
    plantSession(box, ID, { uuid: UF });
    const f = plantTranscript(box, 'claude', CARD_SLUG, UF, [...pre.rows]);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: UF, src: 'fork', reg: U, gen: CARD_GEN });
    settleC(box);
    pokeC(box, ID);
    expect(qC<{ cause: string; declared_by: string }>(box,
      'SELECT cause, declared_by FROM epochs WHERE cc_session_uuid = ? AND confirmed_ms IS NOT NULL', UF)
      .map((r) => `${r.cause}/${r.declared_by}`), "CONTROL: B2's fork line chained a confirmed fork epoch").toEqual(['fork/hook']);
    const wantF = libCard.leafId(ID, UF, pre.headUuids[0]!);
    expect(cardOf(box, ID, UF), "the fork's next leaf starts at the head of the parent's boundary its copy holds")
      .toBe(expectedCard(familyC(box, ID), wantF));
    expect(cardOf(box, ID, U), "one prediction per id: the parent's is removed").toBeNull();
    expect(consumedC(box), 'a removal is no consumption').toEqual({});
    appendRows(f, own.rows);
    pokeC(box, ID);
    expect(leavesC(box, UF), 'derivation minted the leaf the card printed').toEqual([wantF]);
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    expect(cardOf(box, ID, UF), "the fork's own boundary starts its next span")
      .toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, UF, own.headUuids[0]!)));
  }, 240_000);

  it('the end-of-file gate: a torn last line holds the write; a boundary ingested on a pass that ends short of end-of-file consumes and deletes the prediction', () => {
    const box = makeHistoryBox('ccrc-hist-card-eof-');
    const [ID, U] = ['card-eof', sidC(0xf7)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0xf7, sessionId: U, startMs: T0C });
    /** One whole row's JSON with no LF after it: a line still being written. */
    const torn = (n: number): string => JSON.stringify(userRow({ uuid: sidC(0xbf70 + n), ts: new Date(T0C + 3_600_000 + n).toISOString(), sessionId: U, text: `still being written ${n}` }));
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    fs.appendFileSync(p, torn(1));
    settleC(box);
    pokeC(box, ID);
    expect(leavesC(box, U), 'boundary 0 is final: its leaf exists').toHaveLength(1);
    expect(cardOf(box, ID, U), 'never at end-of-file: no prediction').toBeNull();
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
    appendRows(p, s.rows.slice(cutBefore(s, 1), cutBefore(s, 2)));
    fs.appendFileSync(p, torn(2));
    pokeC(box, ID);
    expect(leavesC(box, U)).toHaveLength(2);
    expect(cardOf(box, ID, U), 'consumed short of end-of-file: deleted, not rewritten').toBeNull();
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it("the file: the line and one LF, 0600, in 0700 directories, one per id (a /clear's replaces the last), other names kept; a symlinked card/<id> refused and its target untouched", () => {
    const box = makeHistoryBox('ccrc-hist-card-file-');
    const [ID, U1, U2] = ['card-file', sidC(0xf8), sidC(0xf9)];
    plantC(box, ID, U1, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf8, sessionId: U1, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U1)).not.toBeNull();
    fs.writeFileSync(path.join(box.root, 'card', ID, 'notes'), "not the writer's");
    // A /clear: the registry names the new uuid, and the hook spools the clear line.
    const s2 = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf9, sessionId: U2, startMs: T0C + 3_600_000 });
    plantSession(box, ID, { uuid: U2 });
    plantTranscript(box, 'claude', CARD_SLUG, U2, s2.rows);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U2, src: 'clear', gen: CARD_GEN });
    settleC(box);
    pokeC(box, ID);
    const f = cardPath(box, ID, U2);
    expect(fs.readFileSync(f, 'utf8')).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U2, s2.headUuids[0]!)));
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    for (const d of [path.join(box.root, 'card'), path.join(box.root, 'card', ID)]) expect(fs.statSync(d).mode & 0o777, d).toBe(0o700);
    // U1's prediction and its generation record went with the write; U2's record stands beside its prediction.
    expect(fs.readdirSync(path.join(box.root, 'card', ID)).sort()).toEqual([`${U2}.gen`, `${U2}.txt`, 'notes']);
    const [ID3, U3] = ['card-link', sidC(0xfa)];
    plantC(box, ID3, U3, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfa, sessionId: U3, startMs: T0C }).rows);
    const target = path.join(box.home, 'elsewhere');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'kept');
    fs.symlinkSync(target, path.join(box.root, 'card', ID3));
    settleC(box);
    pokeC(box, ID3);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
    expect(fs.lstatSync(path.join(box.root, 'card', ID3)).isSymbolicLink()).toBe(true);
    expect(counters(box)['card_dir_refused']).toBeGreaterThanOrEqual(1);
  }, 240_000);

  it('only the session the registry names gets a prediction; one it no longer names is still consumed and deleted when its boundary is ingested', () => {
    const box = makeHistoryBox('ccrc-hist-card-reg-');
    const [ID, U] = ['card-reg', sidC(0xfd)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xfd, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
    fs.rmSync(path.join(box.reg, `${ID}.uuid`));
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    pokeC(box, ID);
    expect(leavesC(box, U)).toHaveLength(2);
    expect(cardOf(box, ID, U), 'consumed, and not written again: the registry names no session').toBeNull();
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'still unnamed: still no prediction').toBeNull();
    plantSession(box, ID, { uuid: U });
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it.skipIf(process.getuid?.() === 0)('a card directory the sweep cannot write: counted card_write_failed, nothing written, and the pass still exits 0', () => {
    const box = makeHistoryBox('ccrc-hist-card-ro-');
    const [ID, U] = ['card-ro', sidC(0xfb)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfb, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    const dir = path.join(box.root, 'card', ID);
    // card/ exists once the sweep has ticked (Task 5's ensureHistoryDirs); made here too, so that before Task 5 the
    // case reds at card_write_failed rather than at an ENOENT from the mkdir below.
    fs.mkdirSync(path.join(box.root, 'card'), { recursive: true, mode: 0o700 });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { mode: 0o500 });
    try {
      pokeC(box, ID);
      expect(counters(box)['card_write_failed']).toBeGreaterThanOrEqual(1);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  }, 240_000);

  // The temp half is a CONTROL on B1's writeFileAtomic, which removes its own `<path>.tmp.<pid>` on any failure before
  // the rename: card.mjs unlinks no temp, so no card.mjs mutant reds it. The cleanup half is card.mjs's own guard.
  it("a card write that fails after its temp exists leaves no temp behind (CONTROL: B1's writeFileAtomic cleanup, not card.mjs); a cleanup that fails never loses the write's count", () => {
    const box = makeHistoryBox('ccrc-hist-card-temp-');
    const [ID, U] = ['card-temp', sidC(0xfe)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfe, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    const dir = path.join(box.root, 'card', ID);
    fs.mkdirSync(path.join(box.root, 'card'), { recursive: true, mode: 0o700 });
    fs.rmSync(dir, { recursive: true, force: true });
    // A directory where the prediction goes: the temp is opened and written, and its rename fails (EISDIR).
    fs.mkdirSync(path.join(dir, `${U}.txt`), { recursive: true, mode: 0o700 });
    pokeC(box, ID);
    expect(counters(box)['card_write_failed']).toBeGreaterThanOrEqual(1);
    // The generation record is written first and lands (R-recalloff-parity); the prediction's rename then fails.
    expect(fs.readdirSync(dir).sort(), 'a failed write left its temp behind').toEqual([`${U}.gen`, `${U}.txt`]);
    // A directory under another uuid's card name: the write lands, and removing that name fails (unlink: EISDIR).
    fs.rmSync(path.join(dir, `${U}.txt`), { recursive: true });
    fs.mkdirSync(path.join(dir, `${sidC(0xff)}.txt`));
    const written = counters(box)['card_written'] ?? 0;
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'the write landed').not.toBeNull();
    expect(counters(box)['card_cleanup_failed']).toBeGreaterThanOrEqual(1);
    expect(counters(box)['card_written'], 'the write is counted although its cleanup failed').toBe(written + 1);
  }, 240_000);

  // R-recalloff-parity (spec §9.7, §8.2, C68): when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation resolves a
  // generation, B2's CLI compares recall-off/<id> with the id's newest family's generation, which only the store knows.
  // The hook reads the record this writes instead (Task 9). The expectation is B2's own familiesOf over the fixture
  // store, folded as B2's readContext folds it under 'newest' (`own.length === 1 ? own[0].generation : ''`), never a
  // second spelling of the newest-family query.
  it('the generation record: beside each prediction the sweep records the generation the CLI resolves under newest, follows a newer or a legacy newest family, and a record it cannot write holds the prediction', async () => {
    const box = makeHistoryBox('ccrc-hist-card-gen-');
    const [ID, U] = ['card-gen', sidC(0xf10)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf10, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    const genPath = path.join(box.root, 'card', ID, `${U}.gen`);
    const recall = (await import('../../ccd/history/recall.mjs')) as unknown as {
      familiesOf(db: unknown, sel: object): ReadonlyArray<{ generation: string }>;
    };
    const cliGen = (): string => {
      const db = openStoreRO(box);
      try {
        const own = recall.familiesOf(db, { kind: 'family', id: ID, generation: null, project: null, workdir: null, workdirReal: null });
        return own.length === 1 ? own[0]!.generation : '';
      } finally {
        db.close();
      }
    };
    const setGen = (sql: string, ...args: (string | number)[]): void => {
      const w = openWriter(libCard.historyPaths(box.home).dbFile);
      try { w.prepare(sql).run(...args); } finally { closeWriter(w); }
    };
    expect(cardOf(box, ID, U), 'CONTROL: a prediction stands').not.toBeNull();
    expect(cliGen(), 'CONTROL: the newest family is the planted one').toBe(CARD_GEN);
    expect(fs.readFileSync(genPath, 'utf8'), 'the record is the generation the CLI resolves, and one LF').toBe(`${cliGen()}\n`);
    expect(fs.statSync(genPath).mode & 0o777).toBe(0o600);
    // A newer family of the same id (the id reused under another generation): the CLI resolves it now, and so must
    // the record, at the next write.
    const G2 = sidC(0xf11);
    setGen('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, ?, ?)', ID, G2, 'demo', Date.now());
    expect(cliGen(), 'CONTROL: the CLI resolves the newer family').toBe(G2);
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the next prediction stands').not.toBeNull();
    expect(fs.readFileSync(genPath, 'utf8'), 'the record follows the newest family').toBe(`${G2}\n`);
    // A legacy newest family: the CLI compares with '', and the record is one LF; a kept prediction refreshes it.
    const line = cardOf(box, ID, U);
    setGen("UPDATE sessions SET generation = '' WHERE ccrc_id = ? AND generation = ?", ID, G2);
    expect(cliGen(), 'CONTROL: the CLI resolves the legacy family').toBe('');
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the prediction is kept, not rewritten').toBe(line);
    expect(fs.readFileSync(genPath, 'utf8'), 'a legacy newest family is recorded as one LF').toBe('\n');
    // A record that cannot be written (a directory at its name): the prediction is not written beside it.
    fs.rmSync(cardPath(box, ID, U));
    fs.rmSync(genPath);
    fs.mkdirSync(genPath);
    const failed = counters(box)['card_write_failed'] ?? 0;
    pokeC(box, ID);
    expect(counters(box)['card_write_failed'], 'the record write failed').toBe(failed + 1);
    expect(cardOf(box, ID, U), 'no prediction beside a record that could not be written').toBeNull();
  }, 240_000);

  // R-recalloff-keep (the final check's R2): a record that is due beside a prediction that STANDS (kept, its line
  // unchanged) and cannot be acted on takes the prediction with it. A directory at the record's name is unreadable,
  // so the record is due: rewritten at end-of-file (writeFileAtomic's rename refuses a directory) and removed off it
  // (unlink refuses a directory), and both fail, while the prediction's own unlink succeeds: the ENOSPC shape, where
  // a write fails and an unlink does not. Root meets the same two refusals, so the case runs as root too. Off
  // end-of-file is a torn last line, as in the end-of-file gate case: the pass reads to it and stops short.
  it('a record that cannot be written or removed beside a kept prediction removes the prediction too, counted card_unrecorded_removed, at end-of-file and off it', () => {
    const box = makeHistoryBox('ccrc-hist-card-genkeep-');
    const [ID, U] = ['card-genkeep', sidC(0xf20)];
    const p = plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf20, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const genPath = path.join(box.root, 'card', ID, `${U}.gen`);
    const line = cardOf(box, ID, U);
    expect(line, 'CONTROL: a prediction stands').not.toBeNull();
    expect(fs.readFileSync(genPath, 'utf8'), 'CONTROL: its record stands').toBe(`${CARD_GEN}\n`);
    const removed = (): number => counters(box)['card_unrecorded_removed'] ?? 0;
    const failed = (): number => counters(box)['card_write_failed'] ?? 0;
    const blockRecord = (): void => { fs.rmSync(genPath, { recursive: true, force: true }); fs.mkdirSync(genPath); };
    // At end-of-file: the prediction is kept, and its record is due for a rewrite that fails.
    blockRecord();
    let [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(failed(), 'at end-of-file: the record write failed').toBe(f0 + 1);
    expect(cardOf(box, ID, U), 'at end-of-file: no prediction left beside the record').toBeNull();
    expect(removed(), 'at end-of-file: counted').toBe(r0 + 1);
    // CONTROL: the record unblocked, the same pass shape writes both back, and nothing is removed.
    fs.rmSync(genPath, { recursive: true });
    [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the prediction is written back').toBe(line);
    expect(fs.readFileSync(genPath, 'utf8'), 'CONTROL: and its record').toBe(`${CARD_GEN}\n`);
    expect([removed(), failed()], 'CONTROL: nothing failed, nothing removed').toEqual([r0, f0]);
    // Off end-of-file (a torn last line): CONTROL first, a healthy record keeps both.
    fs.appendFileSync(p, JSON.stringify(userRow({ uuid: sidC(0xbf20), ts: new Date(T0C + 3_600_000).toISOString(), sessionId: U, text: 'still being written' })));
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: off end-of-file a recorded prediction is kept').toBe(line);
    // Then the record is due for a removal that fails.
    blockRecord();
    [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(failed(), 'off end-of-file: the record removal failed').toBe(f0 + 1);
    expect(cardOf(box, ID, U), 'off end-of-file: no prediction left beside the record').toBeNull();
    expect(removed(), 'off end-of-file: counted').toBe(r0 + 1);
  }, 240_000);

  it('scope/ and card/ are made 0700 by a bound store\'s first tick, and by nothing else: not on a server-role box, not under history-off, not when the store is refused', () => {
    const box = makeHistoryBox('ccrc-hist-card-dirs-');
    passC(box);
    for (const d of ['scope', 'card']) expect(fs.statSync(path.join(box.root, d)).mode & 0o777, d).toBe(0o700);
    const server = makeHistoryBox('ccrc-hist-card-dirs-server-', { role: 'server' });
    expect(runSweep(server).code).toBe(0);
    const off = makeHistoryBox('ccrc-hist-card-dirs-off-');
    fs.writeFileSync(path.join(off.home, '.ccrc', 'history-off'), '');
    expect(runSweep(off).code).toBe(0);
    const refused = makeHistoryBox('ccrc-hist-card-dirs-refused-');
    fs.mkdirSync(refused.root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(refused.root, 'store.id'), `${sidC(0xd1)}\n`);
    expect(runSweep(refused).code, 'store-missing is refused').not.toBe(0);
    for (const b of [server, off, refused]) {
      for (const d of ['scope', 'card']) expect(fs.existsSync(path.join(b.root, d)), `${b.home}: ${d}`).toBe(false);
    }
  }, 240_000);

  it('a registered recovery step withdraws the card: the recover arm removes every prediction, counted card_withdrawn:recovering, and consumes and writes none; the tick after it writes the next', () => {
    const box = makeHistoryBox('ccrc-hist-card-recover-');
    const [ID, U] = ['card-recover', sidC(0xfc)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xfc, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    // A recovery step registered on the box's store, as a restore's commit leaves one (B2's registerRecovery).
    const db = openWriter(libCard.historyPaths(box.home).dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
    } finally {
      closeWriter(db);
    }
    let passes = 0;
    while ((recoverRow(box)?.completed_ms ?? null) === null) {
      passC(box);
      passes += 1;
      expect(passes, 'the recovery step completes within five passes').toBeLessThanOrEqual(5);
      expect(cardOf(box, ID, U), `recovery pass ${passes}: withdrawn, never left for a second compaction`).toBeNull();
      expect(consumedC(box), 'the recover arm consumes nothing').toEqual({});
    }
    expect(counters(box)['card_withdrawn:recovering'], 'one prediction, withdrawn once').toBe(1);
    pokeC(box, ID);
    expect(consumedC(box), 'a withdrawn prediction is never counted consumed later').toEqual({});
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it('a floor pause withdraws every prediction, counted card_withdrawn:low-disk, and never through a linked card/<id>; the next plain pass writes it again', () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-floor-');
    const [ID, U] = ['card-withdraw-floor', sidC(0xf0a)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0a, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const before = cardOf(box, ID, U);
    expect(before, 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    // A card/<id> that is a link to a directory holding a file under a card name: never walked, never unlinked.
    const elsewhere = path.join(box.home, 'elsewhere-card');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${sidC(0xf0e)}.txt`), 'not this writer\'s\n');
    fs.symlinkSync(elsewhere, path.join(box.root, 'card', 'card-linked'));
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: `${FLOOR_C - 4096}:${FS_C}` } });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(counters(box)['capture_paused_low_disk'], 'CONTROL: the pass was a floor pause').toBeGreaterThanOrEqual(1);
    expect(cardOf(box, ID, U), 'withdrawn under the floor pause').toBeNull();
    expect(counters(box)['card_withdrawn:low-disk'], 'one prediction; the linked directory is never walked').toBe(1);
    expect(fs.readdirSync(elsewhere), "the link's target is untouched").toEqual([`${sidC(0xf0e)}.txt`]);
    expect(consumedC(box), 'a withdrawal is no consumption').toEqual({});
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'the next plain pass at end-of-file writes it again').toBe(before);
  }, 240_000);

  it('a budget spent before the card step: the consume and delete still run, nothing is written, and the predictions left are withdrawn, counted card_withdrawn:budget', () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-budget-');
    const [A, UA] = ['card-budget-a', sidC(0xf0b)];
    const [B, UB] = ['card-budget-b', sidC(0xf0c)];
    const sa = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf0b, sessionId: UA, startMs: T0C });
    const pa = plantC(box, A, UA, sa.rows.slice(0, cutBefore(sa, 1)));
    plantC(box, B, UB, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0c, sessionId: UB, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, A, B);
    expect(cardOf(box, A, UA), 'CONTROL: A has a prediction').not.toBeNull();
    expect(cardOf(box, B, UB), 'CONTROL: B has a prediction').not.toBeNull();
    const written = counters(box)['card_written'] ?? 0;
    const boundariesOf = (uuid: string): number => qC<{ n: number }>(box,
      'SELECT count(*) AS n FROM boundaries b JOIN transcripts t ON t.transcript_pk = b.transcript_pk WHERE t.cc_session_uuid = ?', uuid)[0]!.n;
    expect(boundariesOf(UA)).toBe(1);
    appendRows(pa, sa.rows.slice(cutBefore(sa, 1)));
    spoolLine(box, A, { v: 1, ev: 'Stop', id: A });
    // One byte of budget: the ingest checks the budget before each chunk, so A's one chunk of new rows is read, and
    // the run's budget is spent long before the card step.
    const r = runDriver(box, { budgetBytes: 1 });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(boundariesOf(UA), "CONTROL: A's second boundary was ingested within the budget").toBe(2);
    expect(cardOf(box, A, UA), "A's prediction was consumed and deleted").toBeNull();
    expect(consumedC(box), 'the consumption is counted, never swallowed by the withdrawal').toEqual({ 'card_consumed:unknown': 1 });
    expect(counters(box)['card_written'] ?? 0, 'no write past the budget').toBe(written);
    expect(cardOf(box, B, UB), "B's prediction is withdrawn").toBeNull();
    expect(counters(box)['card_withdrawn:budget'], "B's alone: A's was already consumed").toBe(1);
  }, 240_000);

  it("a hold withdraws too: a writer token gone (held, its DB open) counts card_withdrawn:held; a store.id naming another store (refused, no DB open) puts the count on the pass's outcome line; a linked card/ is never walked", () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-hold-');
    const [ID, U] = ['card-withdraw-hold', sidC(0xf0d)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0d, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const line = cardOf(box, ID, U);
    expect(line, 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    const P = libCard.historyPaths(box.home);
    fs.rmSync(P.writer);
    const held = runSweep(box);
    expect(held.code, `${held.stderr}${held.stdout}`).toBe(0);
    expect(held.stdout, 'CONTROL: the pass held on the writer token').toContain('history-sweep: held');
    expect(cardOf(box, ID, U), 'withdrawn by the held pass').toBeNull();
    expect(counters(box)['card_withdrawn:held']).toBe(1);
    // A store.id naming another store: refused before any DB opens, so nothing is counted and the outcome line says it.
    fs.writeFileSync(cardPath(box, ID, U), line!, { mode: 0o600 });
    fs.writeFileSync(P.storeId, `${sidC(0xd2)}\n`);
    const refused = runSweep(box);
    expect(refused.code, 'store-mismatch waits on the operator').toBe(5);
    expect(refused.stdout).toContain('history-sweep: store-mismatch\n');
    expect(refused.stdout).toContain('history-sweep: card_withdrawn:refused 1\n');
    expect(cardOf(box, ID, U), 'withdrawn by the refused pass').toBeNull();
    // card/ itself a link to a directory that holds a card name: the next refused pass never walks it.
    const elsewhere = path.join(box.home, 'elsewhere-root');
    fs.mkdirSync(path.join(elsewhere, ID), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, ID, `${U}.txt`), line!);
    fs.rmSync(path.join(box.root, 'card'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(box.root, 'card'));
    const linked = runSweep(box);
    expect(linked.code, 'CONTROL: still store-mismatch').toBe(5);
    expect(linked.stdout, 'nothing withdrawn through a linked card/').not.toContain('card_withdrawn');
    expect(fs.existsSync(path.join(elsewhere, ID, `${U}.txt`)), "the link's target is untouched").toBe(true);
  }, 240_000);

  it("a consumption is counted by the scope marker its compaction's PreCompact left: ambiguous as card_consumed:other, out of W1-e's denominator; main as card_consumed:main; a marker through a link as unknown", () => {
    const box = makeHistoryBox('ccrc-hist-card-scope-');
    const runs = [
      { id: 'card-scope-amb', uuid: sidC(0xa1), seed: 0xa1, word: 'ambiguous', link: false },
      { id: 'card-scope-main', uuid: sidC(0xa2), seed: 0xa2, word: 'main', link: false },
      { id: 'card-scope-link', uuid: sidC(0xa3), seed: 0xa3, word: 'main', link: true },
    ].map((r) => ({ ...r, s: compactionSequence({ n: 1, trigger: 'manual', seed: r.seed, sessionId: r.uuid, startMs: T0C }) }));
    const paths = runs.map((r) => plantC(box, r.id, r.uuid, r.s.rows.slice(0, cutBefore(r.s, 0))));
    settleC(box);
    pokeC(box, ...runs.map((r) => r.id));
    for (const r of runs) expect(cardOf(box, r.id, r.uuid), `CONTROL: ${r.id} has its first prediction`).not.toBeNull();
    // What the hook's PreCompact writes a second before each boundary (Task 8's marker); the third through a link.
    for (const r of runs) {
      const ts = Date.parse(String(r.s.rows[cutBefore(r.s, 0)]!['timestamp']));
      const text = `${r.word} ${r.uuid} ${ts - 1000}\n`;
      const marker = path.join(box.root, 'scope', r.id);
      if (r.link) {
        fs.writeFileSync(path.join(box.home, 'marker-target'), text);
        fs.symlinkSync(path.join(box.home, 'marker-target'), marker);
      } else {
        fs.writeFileSync(marker, text);
      }
    }
    runs.forEach((r, i) => appendRows(paths[i]!, r.s.rows.slice(cutBefore(r.s, 0))));
    pokeC(box, ...runs.map((r) => r.id));
    for (const r of runs) expect(leavesC(box, r.uuid), `CONTROL: ${r.id}'s boundary was ingested`).toHaveLength(1);
    expect(consumedC(box)).toEqual({ 'card_consumed:other': 1, 'card_consumed:main': 1, 'card_consumed:unknown': 1 });
  }, 240_000);
});
```

Notes:
- `claude` and `claude-a` are the default test roster's two account ids (`server/test/helpers.ts` `DEFAULT_TEST_ROSTER`): fixture names, not real ones.
- The fork case relies on derivation's own behaviour (B2's DM37): copy A's second boundary takes the plain id of the span after `pre`'s head, so copy B's next boundary would be fork-qualified.
- The spooled-fork case relies on B2 Task 34, the fork spooling (ruled Q16, DM48's in-pane shape; B2's D-4734 (`history-fork-spooled`)): B2's `parseSpoolLine` accepts `src:"fork"` with `reg`, and `decideEpochLine` takes the line through the resume path, so a line whose `reg` is the parent's uuid confirms by the `.uuid` observed at the rename. Its transcript copies the parent's rows verbatim. B1's modules read no row's `sessionId` (none spells it, measured on B1's branch at plan time), so each copied row is one entry with a membership in each file, and the parent's boundary keeps the parent's `boundaries.transcript_pk`. The fork is in the parent's family (same id, same generation), so `familyC` holds the parent's leaf too and the display prefixes are over both.
- The recovery case writes the `('recover', <ms>)` row exactly as B2's `registerRecovery` does (that helper is module-local to `history-recover.test.ts`). The loop runs at most five passes, each a recover-arm pass that never ticks (B2 Task 25: `recoverPass` never calls `tick`). The first of them withdraws the prediction (ruling RC2), so every later one finds none and counts nothing.
- The floor case plants the low-disk pause through the statfs preload every spawned pass carries (`HISTORY_TEST_STATFS=<bavail>:<size>`, `bavail` 4 KiB under lib's own `floorThreshold`): B1's `holds` cases plant it the same way.
- The budget case passes `budgetBytes: 1` through `runDriver` (B2 Task 25's `deps.budget`, never an environment variable). The ingest checks the budget before each chunk, so A's one chunk of new rows is read and the budget is spent after it; B is not hinted and has no new bytes, so its copy is not at end-of-file this tick.
- The hold case's first pass is B1's writer-token hold (`store.writer` gone: the DB opens, `ids` is null, the pass prints `held` and exits 0); its second is B1's `store-mismatch`, a refusal before any DB opens (exit 5), whose outcome lines are the hold's whole record (IV2).
- The scope case writes each marker as Task 8's block would, `<scope> <uuid> <ms>` with the ms a second before its boundary's `timestamp`, which ingest stores as the boundary's `ts_ms`.

- [ ] **Step 4: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'writes and consumes')
```

Expected: 19 failed (18 as root, where the write-failure case is skipped). The generation-record case and the kept-prediction record case (`a record that cannot be written or removed beside a kept prediction …`, coordinator ruling R-recalloff-keep) fail at `CONTROL: a prediction stands` (`expected null not to be null`). The prediction cases fail at their first `cardOf(…)` with `expected null to be 'History: node L…'` (no tick writes a card yet), the fork-consumed case among them (`the first prediction, before any boundary`) and the spooled-fork case (`CONTROL: the parent's prediction`); the fork case at `card_skipped:fork-qualified` (`expected undefined to be greater than or equal to 1`); the end-of-file and registry cases at their first written card; the file case at `expect(cardOf(box, ID, U1)).not.toBeNull()`; the dirs case with `ENOENT … scope` from `fs.statSync`; the write-failure and temp cases at `card_write_failed` (`expected undefined to be greater than or equal to 1`: the case makes `card/` itself, so its own mkdir cannot fail first); the recovery, floor, budget, hold and scope cases at their first CONTROL that a prediction exists (`expected null not to be null`).

The fork-consumed and temp cases were written for this plan and not run on a prototype, unlike the others, and so were the floor, budget, hold and scope cases that rulings RC2 and RC3 added. If one of them reds after Step 6 at one of its CONTROL lines or at a fixture step, the fixture missed its shape (the copies' order, a directory where the fixture expects a file, a step before the ingest that spent the one byte of budget, a hold word the merged B1 spells otherwise): fix the fixture, never the rule, and say so in the task report. The spooled-fork case, which ruling Q16 added, was not run on a prototype either, and it also needs B2 Task 34, the fork spooling. A red at its epoch CONTROL means B2 merged that task otherwise (another cause word, or a fork confirmed by another route): read B2's merged `decideEpochLine` and its DM48 case, fit the fixture to them, and report it.

- [ ] **Step 5: Write `ccd/history/card.mjs`.** Create it with exactly this content:

```js
// ccd/history/card.mjs: the card line's sweep half (spec 2026-10-05 §8.6, §5.1, §5.2, §9.2 step 6, §9.4; W1-B3 plan
// Tasks 5, 6 and 7).
//
// L4 delivery, as derive.mjs is. It measures the store, the registry and the history root's card/ and scope/
// entries, and hands every decision to lib.mjs (L1): planCardPrediction (B2's span, fork, fan-in and display-prefix
// rules, each called, never re-spelled), decideCardFile, and the delivery and purge decisions. The slot lists the
// parent prediction reads are derive.mjs's own (epochCopySlots), so the parent a card names and the parent derivation
// mints come from one list. sweep.mjs imports this module and hands it, on the ingest context, the sweep helpers it
// needs (budgetLeft, historyOff, readRegPresence): this module imports nothing of the sweep or the CLI, and reads no
// environment.
//
// What it writes: card/<id>/<uuid>.txt, the line and one LF, 0600, temp then rename (store.mjs writeFileAtomic),
// under 0700 directories it makes; beside it, FIRST, card/<id>/<uuid>.gen, the generation B2's CLI resolves for the
// id when neither the env nor the registry names one (its newest family's, '' for a legacy family or none) and one
// LF, which the hook compares recall-off/<id> with then, because the hook cannot read the store (coordinator ruling
// R-recalloff-parity; lib decideCardGenFile); and the scope/ directory the hook writes its markers into, because the
// hook never makes a directory (S4). What it removes: a consumed prediction, every prediction on a pass that runs no card
// step (withdrawCards; ruling RC2, fail closed), and a prediction whose record was due and could not be written or
// removed (coordinator ruling R-recalloff-keep), each an unlink that never goes through a link. What it only reads:
// scope/<id>, to count each consumption by its compaction's scope (ruling RC3). Nothing here journals: a prediction is
// derived again at the next end-of-file after any rebuild. A write that fails is counted and never ends the tick.
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmdirSync, unlinkSync,
} from 'node:fs';
import {
  CARD_ATTACHMENT_MAX_BYTES, CARD_DIR, CARD_LINE_MAX, CARD_MEASURE_ROWS, SCOPE_DIR, UUID_RE, cardDirOf, cardFileOf,
  cardIdsIn, cardWindowComplete, consumedBoundaryTs, decideCardDelivery, decideCardFile, decideCardGenFile,
  decideCardWithdraw, decideConsumedScope, decidePurgedEntry, eofAfterBoundary, historyPaths, idOk, leafId, planCardPrediction,
  predictedSpanStart, producerOf, scopeMarkerOf,
} from './lib.mjs';
import { bump, getStep, parentOf, setStep, unbrotli, withTx, writeFileAtomic } from './store.mjs';
import { epochCopySlots, holdingCopyOf } from './derive.mjs';

/** A path's kind by lstat, never following a link: 'dir', 'file', 'link', 'other', 'absent' (ENOENT), or
 *  'unmeasured' (any other failure; never read as absent). */
function lstatKind(p) {
  let st;
  try { st = lstatSync(p); } catch (e) { return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured'; }
  if (st.isSymbolicLink()) return 'link';
  if (st.isDirectory()) return 'dir';
  return st.isFile() ? 'file' : 'other';
}

/** `scope/` and `card/` under the history root, made 0700 when absent (§5.1, §5.2): the hook writes its markers into
 *  `scope/`, reads `card/` and gates its render reserve on `card/` existing, and never makes a directory (S4). So a
 *  box with history is armed by its sweep's first tick, and a box without history (a server, a refused store, a
 *  `history-off` box: no tick runs) never is. A path there that is a link, a file or unmeasurable is refused, left as
 *  it is, and counted `history_dir_refused:<name>`. D-4741 (history-card-dirs-made-by-sweep) */
export function ensureHistoryDirs(db, home) {
  const root = historyPaths(home).root;
  const out = {};
  for (const name of [SCOPE_DIR, CARD_DIR]) {
    const dir = `${root}/${name}`;
    const kind = lstatKind(dir);
    let state = kind === 'dir' ? 'present' : 'refused';
    if (kind === 'absent') {
      try {
        mkdirSync(dir, { mode: 0o700 });
        state = 'made';
      } catch {
        state = lstatKind(dir) === 'dir' ? 'present' : 'refused';
      }
    }
    if (state === 'refused') bump(db, `history_dir_refused:${name}`);
    out[name] = state;
  }
  return out;
}

const CARD_STMTS = new WeakMap();

/** The statements the card writer reads by, one set per connection, each naming its columns.
 *  - `epochOf` is derive.mjs's own epoch rule (a confirmed epoch of an unmerged family, the lowest session_pk), so the
 *    leaf id hashes the ccrc id derivation will hash.
 *  - `copy` is the transcript's live copy written last (newest mtime_ns, then the larger file_id: §6.1's newest copy),
 *    the one Claude Code appends the next boundary to. D-4744 (history-card-newest-live-copy)
 *  - `firstRow` joins blobs as derive.mjs's copyRows does, so an epoch's first span starts at the row derivation reads
 *    as the copy's first.
 *  - `boundaries` is the copy's boundaries in line order with their times, which lib consumedBoundaryTs walks to find
 *    the one that consumed a prediction (ruling RC3).
 *  - `newestFamily` is the family B2's CLI reads under 'newest' (recall.mjs's ownFamily with no generation: the id's
 *    newest unmerged family by first_seen_ms, then session_pk), whose generation the record beside a prediction
 *    carries (coordinator ruling R-recalloff-parity). */
function cardStmts(db) {
  let s = CARD_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    epochOf: db.prepare(`SELECT e.session_pk AS session_pk, e.seq AS seq, s.ccrc_id AS ccrc_id
      FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk
      WHERE e.cc_session_uuid = ? AND e.confirmed_ms IS NOT NULL AND s.merged_into IS NULL
      ORDER BY e.session_pk LIMIT 1`),
    transcript: db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''"),
    copy: db.prepare(`SELECT file_id, eof_ms FROM ingest_files
      WHERE transcript_pk = ? AND source_key = '' AND status = 'live' ORDER BY mtime_ns DESC, file_id DESC LIMIT 1`),
    firstRow: db.prepare(`SELECT e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      JOIN blobs bl ON bl.blob_id = e.blob_id WHERE m.file_id = ? ORDER BY m.line LIMIT 1`),
    lastBoundary: db.prepare(`SELECT e.uuid AS uuid, b.head_uuid AS head_uuid FROM memberships m
      JOIN boundaries b ON b.entry_id = m.entry_id JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? ORDER BY m.line DESC LIMIT 1`),
    boundaries: db.prepare(`SELECT e.uuid AS uuid, b.head_uuid AS head_uuid, e.ts_ms AS ts_ms FROM memberships m
      JOIN boundaries b ON b.entry_id = m.entry_id JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? ORDER BY m.line`),
    nodeBound: db.prepare('SELECT 1 AS x FROM nodes WHERE node_id = ?'),
    newestCondensed: db.prepare(`SELECT node_id FROM nodes WHERE session_pk = ? AND epoch_seq = ? AND kind = 'condensed'
      ORDER BY rowid DESC LIMIT 1`),
    familyIds: db.prepare('SELECT node_id FROM nodes WHERE session_pk = ?'),
    newestFamily: db.prepare(`SELECT generation FROM sessions WHERE ccrc_id = ? AND merged_into IS NULL
      ORDER BY first_seen_ms DESC, session_pk DESC LIMIT 1`),
  };
  CARD_STMTS.set(db, s);
  return s;
}

/** The generation B2's CLI compares recall-off/<id> with when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation
 *  resolves one (readContext under 'newest'; spec §8.2, §8.8 Generation row, §9.7): the id's newest family's, '' for a
 *  legacy family or when the store holds none. The hook cannot read the store, so the sweep records this beside each
 *  prediction (coordinator ruling R-recalloff-parity). The case `the generation record …` measures it against
 *  recall.mjs's own familiesOf, so the CLI's rule is pinned, never assumed. */
function cliGenerationOf(s, id) {
  const r = s.newestFamily.get(id);
  return r === undefined ? '' : r.generation;
}

/** A card file as a Presence: absent (ENOENT); unreadable (any other failure, or not a regular file: a link, a FIFO
 *  or a directory is never read); or its first 4 × CARD_LINE_MAX bytes as text, more than any line of CARD_LINE_MAX
 *  characters takes. */
function readCard(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    return e && e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' };
  }
  try {
    if (!fstatSync(fd).isFile()) return { state: 'unreadable' };
    const buf = Buffer.alloc(4 * CARD_LINE_MAX);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return { state: 'value', value: buf.subarray(0, n).toString('utf8') };
  } catch {
    return { state: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

/** The sessions the registry names now: `$REG/<id>.uuid` for each id that passes idOk, read through the sweep's own
 *  type-checked reader (a FIFO there is never opened). A prediction is written only for one of these: the hook serves
 *  the pane's own uuid, and the periodic scan reads every known transcript to its end, so end-of-file alone would
 *  write a file for every session the store ever saw. D-4743 (history-card-registry-names-the-session) */
function registeredPairs(ictx) {
  const reg = historyPaths(ictx.home).reg;
  const out = new Map();
  let names;
  try { names = readdirSync(reg); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.uuid')) continue;
    const id = n.slice(0, -'.uuid'.length);
    if (!idOk(id)) continue;
    const v = ictx.readRegPresence(`${reg}/${n}`);
    if (v.state === 'value' && UUID_RE.test(v.value)) out.set(id, v.value);
  }
  return out;
}

/** Every `card/<id>/<uuid>.txt` on disk under a real `card/<id>` directory, so a prediction the registry no longer
 *  names is still consumed when its boundary is ingested. Other names are not this writer's and are not read. */
function cardFilesUnder(root) {
  const out = [];
  let ids;
  try { ids = readdirSync(root); } catch { return out; }
  for (const id of ids) {
    if (!idOk(id) || lstatKind(`${root}/${id}`) !== 'dir') continue;
    let names;
    try { names = readdirSync(`${root}/${id}`); } catch { continue; }
    for (const n of names) {
      const uuid = n.endsWith('.txt') ? n.slice(0, -'.txt'.length) : '';
      if (UUID_RE.test(uuid)) out.push({ id, uuid });
    }
  }
  return out;
}

/** One session's prediction, measured over the copy its next boundary will be written to (lib planCardPrediction
 *  decides): the epoch derive.mjs would read, the copy's first row or last boundary, whether the plain id is bound
 *  already, this copy's level-0 slots in its epoch (derive.mjs epochCopySlots: the list fan-in reads) and whether each
 *  is parented, the epoch's newest condensed node, and the family's node ids. */
function predict(db, s, id, uuid) {
  const ep = s.epochOf.get(uuid);
  const ccrcId = ep !== undefined && ep.ccrc_id === id ? id : null;
  const t = ccrcId === null ? undefined : s.transcript.get(uuid);
  const copy = t === undefined ? undefined : s.copy.get(t.transcript_pk);
  const last = copy === undefined ? undefined : s.lastBoundary.get(copy.file_id);
  const first = copy === undefined || last !== undefined ? undefined : s.firstRow.get(copy.file_id);
  const lastBoundary = last === undefined ? null : { uuid: last.uuid, headUuid: last.head_uuid ?? null };
  const firstRowUuid = first === undefined ? null : first.uuid;
  const start = copy === undefined ? null : predictedSpanStart({ firstRowUuid, lastBoundary });
  const plainBoundOther = start !== null && s.nodeBound.get(leafId(ccrcId, uuid, start)) !== undefined;
  const slots = copy === undefined ? [] : (epochCopySlots(db, ep.session_pk, ep.seq).get(copy.file_id) ?? [])
    .map((nodeId) => ({ nodeId, parented: nodeId !== null && parentOf(db, nodeId) !== null }));
  const newest = copy === undefined ? undefined : s.newestCondensed.get(ep.session_pk, ep.seq);
  const familyIds = copy === undefined ? [] : s.familyIds.all(ep.session_pk).map((r) => r.node_id);
  return {
    copy: copy ?? null,
    ccrcId,
    prediction: planCardPrediction({
      ccrcId, ccUuid: uuid, firstRowUuid, lastBoundary, plainBoundOther, slots,
      newestCondensed: newest === undefined ? null : newest.node_id, familyIds,
    }),
  };
}

/** One prediction per session id (D-4742 (history-card-one-file-per-id)): every other `<uuid>.txt` in card/<id>/ and its
 *  `<uuid>.gen` record, and any `<uuid>.txt.tmp.<pid>` or `<uuid>.gen.tmp.<pid>` a killed writer left, is unlinked (a
 *  link itself, never its target). Other names stay. */
function removeOtherCards(dir, uuid) {
  for (const name of readdirSync(dir)) {
    if (name === `${uuid}.txt` || name === `${uuid}.gen`) continue;
    const m = /^([0-9a-f-]{36})\.(?:txt|gen)(?:\.tmp\.[0-9]+)?$/.exec(name);
    if (m === null || !UUID_RE.test(m[1])) continue;
    unlinkSync(`${dir}/${name}`);
  }
}

/** The scope a consumption is counted under (W1-e's denominator; ruling RC3, D-4738 (history-card-consumed-counter)): the
 *  consumed boundary's time, found by lib consumedBoundaryTs over this copy's boundaries in order and its first row,
 *  and scope/<id> read read-only through readCard (an O_NOFOLLOW open and an fstat type check: the lstat type without
 *  its race, so a link is never followed and a FIFO never waited on), folded by lib decideConsumedScope. */
function consumedScopeOf(s, home, id, uuid, current, copy, ccrcId) {
  const fileId = copy === null ? null : copy.file_id;
  const boundaries = fileId === null ? [] : s.boundaries.all(fileId).map((r) => ({
    uuid: r.uuid, headUuid: r.head_uuid ?? null, tsMs: r.ts_ms === null ? null : Number(r.ts_ms),
  }));
  const first = fileId === null ? undefined : s.firstRow.get(fileId);
  const boundaryTsMs = consumedBoundaryTs({
    current, ccrcId, ccUuid: uuid, firstRowUuid: first === undefined ? null : first.uuid, boundaries,
  });
  return decideConsumedScope({ marker: readCard(scopeMarkerOf(home, id)), uuid, boundaryTsMs });
}

/** One (id, uuid): measure, let lib decide, act, count. A write is due only at end-of-file of the copy the registry's
 *  session appends to, this tick (its eof_ms is this tick's start: B1's recordExamined), and only while the run's
 *  budget is left: the budget bounds a WRITE, never the consume and delete decision, which decideCardFile then takes
 *  as it does off end-of-file (ruling RC2). A card/<id> that is a link or not a directory is never read or written
 *  through. Each prediction a boundary of the main transcript consumed is counted `card_consumed:<scope>`, the scope
 *  its compaction's marker gives it (ruling RC3). D-4738 (history-card-consumed-counter)
 *  The generation record beside a standing prediction is acted on FIRST, as lib decideCardGenFile says, so a
 *  prediction never lands beside a missing or stale record: a record that cannot be written holds the prediction's
 *  write too, counted card_write_failed (coordinator ruling R-recalloff-parity). A record that was due (written or
 *  removed) and could not be acted on, beside a prediction already on disk, takes that prediction with it, counted
 *  card_unrecorded_removed (coordinator ruling R-recalloff-keep): an unlink succeeds where a write meets ENOSPC or
 *  EDQUOT, so no prediction stands beside a stale record until its boundary consumes it. */
function oneCard(db, s, ictx, budget, id, uuid, registered, out) {
  const { copy, ccrcId, prediction } = predict(db, s, id, uuid);
  const atEof = registered && copy !== null && copy.eof_ms !== null && Number(copy.eof_ms) === ictx.nowMs;
  const mayWrite = atEof && ictx.budgetLeft(budget);
  const dir = cardDirOf(ictx.home, id);
  const dirKind = lstatKind(dir);
  if (dirKind !== 'dir' && dirKind !== 'absent') {
    if (atEof) bump(db, 'card_dir_refused');
    return;
  }
  const file = cardFileOf(ictx.home, id, uuid);
  const genFile = `${dir}/${uuid}.gen`;
  const current = dirKind === 'absent' ? { state: 'absent' } : readCard(file);
  if (atEof && prediction.act === 'skip') bump(db, `card_skipped:${prediction.reason}`);
  const d = decideCardFile({ current, prediction, atEof: mayWrite });
  const gen = cliGenerationOf(s, id);
  const g = decideCardGenFile({
    current: dirKind === 'absent' ? { state: 'absent' } : readCard(genFile), generation: gen, card: d.act, mayWrite,
  });
  let recorded = g !== 'write' && g !== 'delete';
  try {
    if (dirKind === 'absent' && d.act === 'write') mkdirSync(dir, { mode: 0o700 });
    if (g === 'write') writeFileAtomic(genFile, `${gen}\n`, 0o600);
    if (g === 'delete') unlinkSync(genFile);
    recorded = true;
    if (d.act === 'write') {
      writeFileAtomic(file, `${prediction.line}\n`, 0o600);
    } else if (d.act === 'delete') {
      unlinkSync(file);
    }
  } catch {
    // writeFileAtomic removes its own `<file>.tmp.<pid>` on any failure before the rename, so nothing is left here to
    // unlink; a temp a KILLED writer left is removeOtherCards' (its `.tmp.<pid>` arm) at the id's next write.
    bump(db, 'card_write_failed');
    // The record was due and is not acted on: the prediction on disk, if one stands (a kept one, or the one a write
    // was to replace), goes too, so the hook never compares recall-off with a stale record (R-recalloff-keep). An
    // absent prediction fails this unlink with ENOENT and is not counted.
    if (!recorded) {
      try {
        unlinkSync(file);
        bump(db, 'card_unrecorded_removed');
      } catch { /* none stands, or it cannot be removed either: the next tick decides both again */ }
    }
    return;
  }
  if (d.act === 'write') {
    // The id's other predictions go once this one is on disk. A cleanup that fails is counted on its own and never
    // costs the write's or the consumption's count.
    try { removeOtherCards(dir, uuid); } catch { bump(db, 'card_cleanup_failed'); }
    bump(db, 'card_written');
    out.written += 1;
  }
  if (d.act === 'delete') out.deleted += 1;
  if (d.consumed) {
    const scope = consumedScopeOf(s, ictx.home, id, uuid, current, copy, ccrcId);
    bump(db, `card_consumed:${scope}`);
    out.consumed += 1;
  }
}

/** The consumer and the writer (§8.6 Timing, §9.2 step 6), over every session the registry names and every card file
 *  on disk, in a stable order, stopping at history-off. The run's budget is read before each WRITE (oneCard), never
 *  before the consume and delete decision, so a spent budget still consumes (ruling RC2). */
export function consumeAndWriteCards(db, ictx, budget) {
  const out = { written: 0, consumed: 0, deleted: 0 };
  const root = `${historyPaths(ictx.home).root}/${CARD_DIR}`;
  if (lstatKind(root) !== 'dir') return out;
  const s = cardStmts(db);
  const live = registeredPairs(ictx);
  const cands = new Map();
  for (const [id, uuid] of live) cands.set(`${id}/${uuid}`, { id, uuid });
  for (const c of cardFilesUnder(root)) cands.set(`${c.id}/${c.uuid}`, c);
  for (const key of [...cands.keys()].sort()) {
    if (ictx.historyOff()) break;
    const { id, uuid } = cands.get(key);
    oneCard(db, s, ictx, budget, id, uuid, live.get(id) === uuid, out);
  }
  return out;
}

/** The card's part of the tick (§9.2 step 6: measure delivery, then write card/ files). tick calls it under the
 *  derivation's gate, so it never runs on the recover arm (recoverPass never ticks), under a cap or floor pause, or
 *  past history-off; a pass that does not run it withdraws every prediction instead (withdrawCards, below). */
export function cardStep(db, ictx, budget) {
  if (ictx.historyOff()) return { measure: null, cards: null };
  const measure = null;
  const cards = consumeAndWriteCards(db, ictx, budget);
  return { measure, cards };
}

// ── The withdrawal (ruling RC2: fail closed; W1-B3 Task 5) ─────────────────────────────────────────────────────────
// A prediction is consumed only by a card step that sees the boundary that consumed it. A scheduled pass that runs
// none, or whose ingest may have stopped short of that boundary, would leave every prediction in place, and a second
// compaction in that state would be served a stale line. So such a pass withdraws them all. lib decideCardWithdraw
// says whether, and under which reason word; this only measures and unlinks. D-4740 (history-card-withdrawn-when-not-ticking)

/** Withdraws every `card/<id>/<uuid>.txt` when lib's decideCardWithdraw says the pass `pass` does. The path is
 *  lstat-checked where a link could be walked through: a `card/` (here) or a `card/<id>` (cardFilesUnder) that is a
 *  link or not a directory is never entered. Each name is then only unlinked, which removes a link itself, never its
 *  target, and refuses a directory; a name that cannot be unlinked is left for the next pass that withdraws. Counted
 *  `card_withdrawn:<reason>` on `db`; a pass with no DB open (a hold before the open, where nothing is counted: IV2)
 *  prints `history-sweep: card_withdrawn:<reason> <n>` through `out` instead, beside its own word. Answers the number
 *  withdrawn. */
export function withdrawCards(db, home, pass, out) {
  const d = decideCardWithdraw(pass);
  if (d.act !== 'withdraw') return 0;
  const root = `${historyPaths(home).root}/${CARD_DIR}`;
  if (lstatKind(root) !== 'dir') return 0;
  let n = 0;
  for (const { id, uuid } of cardFilesUnder(root)) {
    try {
      unlinkSync(cardFileOf(home, id, uuid));
      n += 1;
    } catch { /* a directory under a card name, or a name already gone: left for the next pass that withdraws */ }
  }
  if (n > 0 && db !== null) bump(db, `card_withdrawn:${d.reason}`, n);
  if (n > 0 && db === null) out(`history-sweep: card_withdrawn:${d.reason} ${n}`);
  return n;
}
```

Notes:
- `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery`, `decidePurgedEntry`, `eofAfterBoundary`, `producerOf`, `CARD_MEASURE_ROWS`, `CARD_ATTACHMENT_MAX_BYTES`, `getStep`, `setStep`, `unbrotli`, `withTx`, `holdingCopyOf` and `rmdirSync` are imported here once and first used by Tasks 6 and 7, which append to this file; an unused import is harmless in an ES module.
- `card.mjs` reads no `process.env` (B1's allow-list pin over `ccd/history/*.mjs` holds), declares none of the O14 vocabularies, spells no `/history-off` (history-off reaches it as `ictx.historyOff()`), never spells `.ccrc/history/db`, and has no `SELECT *`.
- The temp name `<file>.tmp.<pid>` is B1's `writeFileAtomic`'s own (`const tmp = `${path}.tmp.${process.pid}`;` in `store.mjs`), and so is its cleanup: `writeFileAtomic` removes any entry at that name first, and in its `finally` removes the temp on every failure before the rename (its doc comment: "a failure before the rename removes the temp"). So `oneCard`'s catch unlinks no temp: a second unlink of it there would be a guard nothing can trip. The one unlink the catch does make is the prediction's own, when its record was due and failed (coordinator ruling R-recalloff-keep, the next note). A temp that a KILLED writer left, which no `finally` reaches, is matched by `removeOtherCards`' `\.tmp\.[0-9]+` arm and unlinked at the id's next write. Step 1 measures the name.
- A record that was due and failed takes the prediction on disk with it (coordinator ruling R-recalloff-keep, the final check's R2). `decideCardGenFile` answers `write` or `delete` only while a prediction stands (`decideCardFile`'s `keep` or `write`), so `recorded` is false exactly when that record act, or the `mkdir` before it, threw. The prediction a `keep` leaves, or the older one a `write` was to replace, would otherwise stand beside a stale record, against Task 2's contract (a stale record never stands beside a prediction), and the hook would compare `recall-off/<id>` with the old generation on every tick until the boundary consumed it. The finding's trigger is ENOSPC on the home volume, where the floor probe measures `db/` and §9.3 lets `db/` live on another volume; an unlink succeeds under ENOSPC and EDQUOT. The ruling names the `keep` arm; the `write` arm over an existing file is the same hazard (the gen-record case's newer family, had its record write failed, leaves the older line beside the older record), so this one test covers both. An absent prediction fails the unlink with ENOENT, uncounted, which is why no `current.state` test precedes it: such a test would change no outcome. The case `a record that cannot be written or removed beside a kept prediction …` measures both of the record's acts, and the mutant `R-recalloff-keep: a kept prediction left beside a failed record` reds it.
- A busy store throws out of `bump` or `writeFileAtomic`'s neighbours exactly as it does out of `deriveNodes`: the sweep is the only writer under its lock, so busy is a test's injection, and the pass handles it where it handles derivation's. A tick that meets the lock returns before the card step and before its withdrawal; that residual is named in the PR body (Task 14).
- Ruling RC2 says "lstat-checked" for the withdrawal, and ruling RC3 "lstat-typed, never following a link" for the scope read. The withdrawal lstats the two directories a link could be walked through, `card/` and each `card/<id>`, and only unlinks the names under them: an unlink removes a link itself and refuses a directory, so a per-name lstat could change no answer, and this plan does not spell a guard nothing can trip. Both directory checks have mutants (Step 8: `RC2: a withdrawal through a linked card/` and `… through a linked card/<id>`). The scope read uses `readCard`, whose `O_NOFOLLOW | O_NONBLOCK` open refuses a link and whose `fstat` refuses anything but a regular file: the type an lstat gives, without the race between an lstat and a later open. One guard, not two, so its mutant reds (Step 8, `RC3: a scope marker read through a link`).
- A withdrawal's outcome line on a hold with no DB open is `history-sweep: card_withdrawn:<reason> <n>`, printed only when something was withdrawn, after the hold's own word (and `journal-unwritable`, when that line is printed). The shim reads no stdout, and no B1 or B2 case plants a card file before a hold, so no existing outcome assertion meets the line.

- [ ] **Step 6: Wire it into the sweep.** In `ccd/history/sweep.mjs`:
  1. Directly below the import statement whose last line ends `from './derive.mjs';`, add:

```js
import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';
```

  2. In `makeIngestCtx`, replace `fts: false, admitFile, budgetLeft, isBusy };` with `fts: false, admitFile, budgetLeft, isBusy, readRegPresence };`, and add this sentence at the end of its doc comment: `readRegPresence is handed to card.mjs the same way: it names the sessions a card may be written for (W1-B3 Task 5).`
  3. In `tick`, directly below the line `  if (ctx.ingest && !(ing !== null && ing.paused)) deriveNodes(db, ictx, ctx.budget);`, add:

```js
  // §9.2 step 6, after the leaves and parents (W1-B3 Task 5): measure card delivery, then consume and write the
  // card/ predictions, under the derivation's gate. A tick that does not reach the card step over a caught-up ingest
  // (a cap or floor pause, a per-chunk floor stop, an ingest an unreadable roster skipped, a budget spent before the
  // step) withdraws every prediction instead, fail closed: lib decideCardWithdraw names the reason (ruling RC2). The
  // budget is read here, before the step. D-4224 D-4740 (history-card-withdrawn-when-not-ticking)
  const cardPass = { arm: 'run', pause: ctx.pause, floorStop: ing !== null && ing.paused, ingested: ing !== null, budgetLeft: budgetLeft(ctx.budget) };
  if (ctx.ingest && !(ing !== null && ing.paused)) cardStep(db, ictx, ctx.budget);
  withdrawCards(db, ctx.home, cardPass, ctx.out);
```

  4. Directly below B1's spool-directory line `  if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);` (after the `// <<< history tick steps` marker and its FU8 comment), and so above `  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');`, add this line. It is unconditional: B1's line skips `spool/` when something that is not a directory stands there, and `ensureHistoryDirs` measures `scope/` and `card/` itself, whatever stands at `spool/`.

```js
  ensureHistoryDirs(db, ctx.home);
```

  4a. Name the three new steps in `tick`'s doc comment, the `/**` directly above `export async function tick(db, ctx) {`. B1's `history-sweep.test.ts` describe `tick()'s docstring names its steps in the order the body runs them (review 316 F39)` reads every `name(db` call in the body (comments stripped; `bump`, `countOutside` and `scanDue` excepted) and requires each to be an item matching `^\s*\*\s+\d+\.\s+`name``, listed in the order the body first calls them. `cardStep(db`, `withdrawCards(db` and `ensureHistoryDirs(db` are new calls, so the case `every step the body calls with db is listed` reds without this edit. The script is order-independent with B4, as B4's own is. `cardStep` and `withdrawCards` go directly below the `deriveNodes` item. `ensureHistoryDirs` goes below the LAST item, whatever it is: the body calls it below B1's spool-directory line, after the `// <<< history tick steps` marker, so it is the body's last `name(db` call on every base. That last item is `markScan` on B1 and B2, or B4's `exportStep` if B4 merged first (B4 calls it directly above that marker, after `markScan`). The last item's closing `.` becomes `;` when it has one, with no assertion on it, and the new item takes the `.`. From the repository root:

```bash
python3 - <<'PYEOF'
import re
p = 'ccd/history/sweep.mjs'
t = open(p, encoding='utf8').read()
at = t.index('export async function tick(db, ctx) {')
start = t.rindex('/**', 0, at)
lines = t[start:at].split('\n')
item = re.compile(r'^ \*\s*\d+\. `([A-Za-z]\w*)`')
cont = re.compile(r'^ \*\s{4,}\S')                   # an item's continuation line: four or more spaces after the `*`
names = [m.group(1) for l in lines if (m := item.match(l))]
assert names.count('deriveNodes') == 1 and names.count('markScan') == 1, names
assert not {'cardStep', 'withdrawCards', 'ensureHistoryDirs'} & set(names), names
def after(name):
    i = next(k for k, l in enumerate(lines) if (m := item.match(l)) and m.group(1) == name)
    while i + 1 < len(lines) and cont.match(lines[i + 1]) and not item.match(lines[i + 1]):
        i += 1
    return i
i = after('deriveNodes')
lines[i + 1:i + 1] = [
    ' * 0. `cardStep`: §9.2 step 6 under the derivation\'s gate: the card delivery measure, then the card/ predictions',
    ' *     consumed, deleted and written (card.mjs; W1-B3 Tasks 5 and 6);',
    ' * 0. `withdrawCards`: every card/ prediction unlinked when this tick ran no card step over a caught-up ingest',
    ' *     (ruling RC2: fail closed; lib decideCardWithdraw names the reason);',
]
names = [m.group(1) for l in lines if (m := item.match(l))]
prev = names[-1]                                     # the body's last step before this one: markScan, or B4's exportStep
assert prev in ('markScan', 'exportStep'), names
j = after(prev)
if lines[j].endswith('.'):
    lines[j] = lines[j][:-1] + ';'
lines[j + 1:j + 1] = [
    ' * 0. `ensureHistoryDirs`: last, below the spool/ line the next sentence names, scope/ and card/ made 0700, a link',
    ' *     or a file there refused and counted (card.mjs; W1-B3 Task 5).',
]
n = 0
for k, l in enumerate(lines):
    if item.match(l):
        n += 1
        lines[k] = re.sub(r'^ \*\s*\d+\.', ' *' + f'{n:>3}' + '.', l, count=1)
t = t[:start] + '\n'.join(lines) + t[at:]
open(p, 'w', encoding='utf8').write(t)
print(f'tick doc comment: {n} steps, ensureHistoryDirs at {n}, below {prev}')
PYEOF
```

Expected: `tick doc comment: 21 steps, ensureHistoryDirs at 21, below markScan` on a base with B1 and B2 only (B1 left 16; B2 left 18, with its Task 8's `deriveNodes` at 15 and its Task 29's `beltNodesStep` at 7; so 21 here), or `tick doc comment: 22 steps, ensureHistoryDirs at 22, below exportStep` if B4 merged first (its `exportStep` at 19, below `markScan`). An assertion error means the list is not one this plan knows: read `tick` and its doc comment, place each item where the body calls it, and report it. The items keep B1's form, ` *  9.` below ten and ` * 10.` from ten, and the numbering runs 1 to `<n>` in body order, which is what B1's F39 describe reads (its `every listed step is called in the body, in the listed order` and `every step the body calls with db is listed`).

  5. In `holdPass`, directly above its line `  return holdExit(word);`, add:

```js
  withdrawCards(null, home, { arm: 'hold', word }, out);   // W1-B3 (ruling RC2): no DB is open, so the count is a line
```

  6. In `scheduledPass`, directly below the line `      out('history-sweep: held');`, add:

```js
      withdrawCards(db, home, { arm: 'hold', word: 'held' }, out);   // W1-B3 (ruling RC2)
```

  7. In `scheduledPass`, directly below the line that begins `    const run = planRun({ historyOff: false, store: { act: 'open' },`, add:

```js
    // W1-B3 (ruling RC2, fail closed): the migrate, recover and hold arms never reach the card step, so each withdraws
    // every prediction here, before it runs; the run arm decides in the tick, over the tick's own facts.
    if (run.arm !== 'run') withdrawCards(db, home, { arm: run.arm, word: run.holdWord ?? 'held' }, out);
```

  7a. Give `card.mjs` its ring. In `server/test/history-lib.test.ts`, in B1's `const RINGS: Record<string, { ring: 'L1' | 'L3' | 'L4'; forbids: (s: string) => boolean }> = {` object, directly below the row that begins `    'derive.mjs': { ring: 'L4'` (B2 Task 8's), add this one line, with no import change:

```ts
    'card.mjs': { ring: 'L4', forbids: (s) => s === 'node:sqlite' || s === './sweep.mjs' || s === './cli.mjs' },
```

  B1's `every ccd/history/*.mjs has a ring` compares the directory's `.mjs` names with `Object.keys(RINGS)` exactly, so `card.mjs` reds it without this row, and no change to `card.mjs` can green it. With the row, the cases that walk `Object.keys(RINGS)` read `card.mjs` too: `each module imports nothing its ring forbids, and reaches no module by another door` (it imports `node:fs`, `./lib.mjs`, `./store.mjs` and `./derive.mjs` only, through `from` forms), `store.mjs is the sole node:sqlite importer`, and B2's per-module compact-card form table `CARD_FORMS` (case `only L4 imports ../compact-card.mjs, and only the forms CARD_FORMS names`), which needs no `card.mjs` row: `card.mjs` imports nothing from `../compact-card.mjs`, so the case skips it (a module with no row may take nothing).

  8. Check placement and syntax, from the repository root:

```bash
grep -c "^import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';$" ccd/history/sweep.mjs     # 1
grep -c 'fts: false, admitFile, budgetLeft, isBusy, readRegPresence };' ccd/history/sweep.mjs                  # 1
grep -c '^  if (ctx.ingest && !(ing !== null && ing.paused)) cardStep(db, ictx, ctx.budget);$' ccd/history/sweep.mjs   # 1
grep -c '^  withdrawCards(db, ctx.home, cardPass, ctx.out);$' ccd/history/sweep.mjs                            # 1
grep -c '^  ensureHistoryDirs(db, ctx.home);$' ccd/history/sweep.mjs                                           # 1
grep -c "^  withdrawCards(null, home, { arm: 'hold', word }, out);" ccd/history/sweep.mjs                      # 1
grep -c "^      withdrawCards(db, home, { arm: 'hold', word: 'held' }, out);" ccd/history/sweep.mjs            # 1
grep -c "^    if (run.arm !== 'run') withdrawCards(db, home, { arm: run.arm, word: run.holdWord ?? 'held' }, out);$" ccd/history/sweep.mjs   # 1
grep -c 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs                                               # 1
g=$(grep -n 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs | cut -d: -f1)
for pat in 'cardStep(db, ictx, ctx.budget);' 'withdrawCards(db, ctx.home, cardPass' 'ensureHistoryDirs(db, ctx.home);' "withdrawCards(null, home" "withdrawCards(db, home, { arm: 'hold', word: 'held' }" 'withdrawCards(db, home, { arm: run.arm'; do l=$(grep -nF "$pat" ccd/history/sweep.mjs | cut -d: -f1); [ "$l" -lt "$g" ] && echo "above the guard: $pat" || echo "BELOW THE GUARD: $pat"; done
a=$(grep -n "withdrawCards(db, home, { arm: run.arm" ccd/history/sweep.mjs | cut -d: -f1); r=$(grep -n "^    if (run.arm === 'recover') {$" ccd/history/sweep.mjs | cut -d: -f1); [ "$a" -lt "$r" ] && echo 'withdrawn before the recover arm' || echo 'AFTER THE RECOVER ARM'
grep -nE '^(await|(const|let|var) [^=]+= *await)\b' ccd/history/sweep.mjs ccd/history/card.mjs                  # nothing
grep -nE "^import|^} from" ccd/history/card.mjs                                                                 # node:fs, ./lib.mjs, ./store.mjs, ./derive.mjs only
grep -c 'process.env' ccd/history/card.mjs                                                                      # 0
node --check ccd/history/card.mjs && node --check ccd/history/sweep.mjs
grep -cE '^ \* +[0-9]+\. `(cardStep|withdrawCards|ensureHistoryDirs)`' ccd/history/sweep.mjs                  # 3
grep -c "^    'card.mjs': { ring: 'L4'" server/test/history-lib.test.ts                                        # 1
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'docstring names its steps')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'has a ring|imports nothing its ring forbids|sole node:sqlite importer')
```

Expected: the eight counts are `1`, the guard's count is `1`; all six lines print `above the guard`; then `withdrawn before the recover arm`; the `grep -nE` for top-level await prints nothing; `card.mjs` imports only `node:fs`, `./lib.mjs`, `./store.mjs` and `./derive.mjs` (no `./sweep.mjs`, no `./cli.mjs`: no cycle); `0`; `node --check` prints nothing; `3` and `1`; then `3 passed` (B1's F39 describe: at least ten items, every item called in order, every `name(db` call listed) and `3 passed` (the ring census, the ring case and the `node:sqlite` case). A red in the F39 describe means an item is missing or out of body order: fix the doc comment, never the case.

- [ ] **Step 7: Run the card cases, then every suite the tick touches, and the typecheck.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts test/history-drain.test.ts test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts test/history-store.test.ts test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts test/history-cli.test.ts test/single-definition.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every case green; `tsc` clean.
  - Every B1 and B2 tick now also measures (nothing, until Task 6), consumes and writes predictions for registered sessions, and makes `scope/` and `card/`. B1's two exact counters-map assertions (`S6/O25`, `DM17 (store half)`) run no tick; B1's `S7` lists the root only for a refused store, where no tick runs. So no B1 or B2 assertion meets the new counters, files or directories.
  - Every B1 and B2 hold, pause, migration and recovery pass now also asks lib whether to withdraw, and withdraws only `card/<id>/<uuid>.txt` names. No B1 or B2 case plants one, so each such pass withdraws nothing, bumps no `card_withdrawn:*` counter and prints no outcome line; on a store with no `card/` the withdrawal stops at its first lstat. `history-holds.test.ts` (in the second line above) runs every hold and pause; `history-recover.test.ts` runs the recover arm.
  - Two B1 cases read this task's edits as text, and stay green only through them: `history-sweep.test.ts`'s F39 describe (`tick()'s docstring names its steps …`, in the second line above) through Step 6's doc-comment items, and `history-lib.test.ts`'s `every ccd/history/*.mjs has a ring` (in the fourth line) through Step 6's `RINGS` row. A red in either is fixed by those edits, never by loosening an assertion.
  - Any other red there is this task's defect: fix `card.mjs` or its wiring, never a B1 or B2 assertion. If one of them asserts an exact counters map or an exact outcome after a pass and reds only on a `card_*` or `history_dir_refused:*` key or a `card_withdrawn:` line, stop and report it: the coordinator rules on that pin.
  - `history-ingest.test.ts`'s O20 RSS case measures a tick that now also predicts; if it reds on the floor interpreter, report it, never raise the bound.
  - Known load flakes: re-run an isolated red file alone before calling it a break.

- [ ] **Step 8: Measure every guard red, then green.** Check the runner is present as in Task 2 Step 7. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task5.json <<'EOF'
[
  { "name": "9.2 step 6: the tick runs no card step", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "the first compaction",
    "edits": [{ "anchor": "  if (ctx.ingest && !(ing !== null && ing.paused)) cardStep(db, ictx, ctx.budget);\n", "replacement": "" }] },
  { "name": "8.6 Timing: a consumed prediction kept until end-of-file", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "end-of-file gate",
    "edits": [{ "anchor": "  const d = decideCardFile({ current, prediction, atEof: mayWrite });", "replacement": "  if (!mayWrite) return;\n  const d = decideCardFile({ current, prediction, atEof: mayWrite });" }] },
  { "name": "8.6 Timing: a prediction written short of end-of-file", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "end-of-file gate",
    "edits": [{ "anchor": "  const d = decideCardFile({ current, prediction, atEof: mayWrite });", "replacement": "  const d = decideCardFile({ current, prediction, atEof: copy !== null });" }] },
  { "name": "one file per id: a /clear's prediction leaves the last", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "one per id",
    "edits": [{ "anchor": "    try { removeOtherCards(dir, uuid); } catch { bump(db, 'card_cleanup_failed'); }\n", "replacement": "" }] },
  { "name": "a failed cleanup loses the write's count", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "leaves no temp behind",
    "edits": [{ "anchor": "    try { removeOtherCards(dir, uuid); } catch { bump(db, 'card_cleanup_failed'); }\n", "replacement": "" },
              { "anchor": "      writeFileAtomic(file, ", "replacement": "      removeOtherCards(dir, uuid);\n      writeFileAtomic(file, " }] },
  { "name": "a symlinked card/<id> written through", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "one per id",
    "edits": [{ "anchor": "  if (dirKind !== 'dir' && dirKind !== 'absent') {", "replacement": "  if (false) {" }] },
  { "name": "S4: no tick makes scope/ and card/", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "made 0700",
    "edits": [{ "anchor": "  ensureHistoryDirs(db, ctx.home);\n", "replacement": "" }] },
  { "name": "6.1: the fork rule ignored by the sweep", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "fork rule",
    "edits": [{ "anchor": "  const plainBoundOther = start !== null && s.nodeBound.get(leafId(ccrcId, uuid, start)) !== undefined;", "replacement": "  const plainBoundOther = false;" }] },
  { "name": "6.1: a fork's copied boundaries ignored by the span start", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "a spooled fork",
    "edits": [{ "anchor": "      WHERE m.file_id = ? ORDER BY m.line DESC LIMIT 1`),",
                "replacement": "      WHERE m.file_id = ? AND b.transcript_pk = (SELECT f.transcript_pk FROM ingest_files f WHERE f.file_id = m.file_id) ORDER BY m.line DESC LIMIT 1`)," }] },
  { "name": "a session the registry does not name gets a prediction", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "registry names",
    "edits": [{ "anchor": "  const atEof = registered && copy !== null", "replacement": "  const atEof = copy !== null" }] },
  { "name": "a prediction the registry no longer names is never consumed", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "registry names",
    "edits": [{ "anchor": "  for (const c of cardFilesUnder(root)) cands.set(`${c.id}/${c.uuid}`, c);\n", "replacement": "" }] },
  { "name": "8.6 parent rule: the run's slot list never read", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "8th leaf",
    "edits": [{ "anchor": "  const slots = copy === undefined ? [] : (epochCopySlots(db, ep.session_pk, ep.seq).get(copy.file_id) ?? [])", "replacement": "  const slots = copy === undefined ? [] : ([])" }] },
  { "name": "a failed card write ends the tick", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "cannot write",
    "edits": [{ "anchor": "    bump(db, 'card_write_failed');\n", "replacement": "    throw new Error('mutant: a failed card write ends the tick');\n" }] },
  { "name": "RC2: the tick withdraws nothing", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "floor pause withdraws",
    "edits": [{ "anchor": "  withdrawCards(db, ctx.home, cardPass, ctx.out);\n", "replacement": "" }] },
  { "name": "RC2: a withdrawal through a linked card/<id>", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "floor pause withdraws",
    "edits": [{ "anchor": "    if (!idOk(id) || lstatKind(`${root}/${id}`) !== 'dir') continue;", "replacement": "    if (!idOk(id)) continue;" }] },
  { "name": "RC2: the recover, migrate and hold arms withdraw nothing", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "recovery step withdraws",
    "edits": [{ "anchor": "    if (run.arm !== 'run') withdrawCards(db, home, { arm: run.arm, word: run.holdWord ?? 'held' }, out);\n", "replacement": "" }] },
  { "name": "RC2: a withdrawal through a linked card/", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "a hold withdraws",
    "edits": [{ "anchor": "  if (lstatKind(root) !== 'dir') return 0;\n", "replacement": "" }] },
  { "name": "RC2: a tick that ran its card step withdraws anyway", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "the first compaction",
    "edits": [{ "anchor": "  if (d.act !== 'withdraw') return 0;\n", "replacement": "" }] },
  { "name": "RC2: a withdrawal on a hold with no DB left unrecorded", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "a hold withdraws",
    "edits": [{ "anchor": "  if (n > 0 && db === null) out(`history-sweep: card_withdrawn:${d.reason} ${n}`);\n", "replacement": "" }] },
  { "name": "RC2: a held pass withdraws nothing", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "a hold withdraws",
    "edits": [{ "anchor": "      withdrawCards(db, home, { arm: 'hold', word: 'held' }, out);", "replacement": "      void 0;" }] },
  { "name": "RC2: a hold with no DB withdraws nothing", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "a hold withdraws",
    "edits": [{ "anchor": "  withdrawCards(null, home, { arm: 'hold', word }, out);", "replacement": "  void 0;" }] },
  { "name": "RC2: the budget gates the consume and delete", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "budget spent before",
    "edits": [{ "anchor": "    if (ictx.historyOff()) break;\n    const { id, uuid } = cands.get(key);", "replacement": "    if (!ictx.budgetLeft(budget) || ictx.historyOff()) break;\n    const { id, uuid } = cands.get(key);" }] },
  { "name": "RC2: a write past the budget", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "budget spent before",
    "edits": [{ "anchor": "  const mayWrite = atEof && ictx.budgetLeft(budget);", "replacement": "  const mayWrite = atEof;" }] },
  { "name": "RC3: a consumption counted unscoped", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "scope marker its compaction",
    "edits": [{ "anchor": "    bump(db, `card_consumed:${scope}`);", "replacement": "    bump(db, 'card_consumed');" }] },
  { "name": "RC3: a scope marker read through a link", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "scope marker its compaction",
    "edits": [{ "anchor": "openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)", "replacement": "openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)" }] },
  { "name": "RC3: the consumed boundary's time never measured", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "scope marker its compaction",
    "edits": [{ "anchor": "  return decideConsumedScope({ marker: readCard(scopeMarkerOf(home, id)), uuid, boundaryTsMs });", "replacement": "  return decideConsumedScope({ marker: readCard(scopeMarkerOf(home, id)), uuid, boundaryTsMs: null });" }] },
  { "name": "R-recalloff-parity: the record names the oldest family", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "the generation record",
    "edits": [{ "anchor": "      ORDER BY first_seen_ms DESC, session_pk DESC LIMIT 1`),", "replacement": "      ORDER BY first_seen_ms, session_pk LIMIT 1`)," }] },
  { "name": "R-recalloff-parity: no record written beside a prediction", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "the generation record",
    "edits": [{ "anchor": "    if (g === 'write') writeFileAtomic(genFile, `${gen}\\n`, 0o600);\n", "replacement": "" }] },
  { "name": "R-recalloff-parity: the prediction written before its record", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "the generation record",
    "edits": [{ "anchor": "    if (g === 'write') writeFileAtomic(genFile, `${gen}\\n`, 0o600);\n", "replacement": "" },
              { "anchor": "      writeFileAtomic(file, `${prediction.line}\\n`, 0o600);\n",
                "replacement": "      writeFileAtomic(file, `${prediction.line}\\n`, 0o600);\n      if (g === 'write') writeFileAtomic(genFile, `${gen}\\n`, 0o600);\n" }] },
  { "name": "R-recalloff-keep: a kept prediction left beside a failed record", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "beside a kept prediction",
    "edits": [{ "anchor": "    if (!recorded) {\n", "replacement": "    if (false) {\n" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task5.json)
```

Expected: every row `red (…)` then `green`; the last line `every guard measured red, then green`; exit 0. As root the `a failed card write ends the tick` row prints `STAYED GREEN` (its case is skipped there): run that row as a non-root user, or report it unmeasured as root, never drop it. Each row re-runs one case of real sweep passes: a row takes a minute or two.
  - No row targets the temp: `writeFileAtomic` (B1) removes it, and `card.mjs` spells no unlink of it, so the case's `a failed write left its temp behind` is a CONTROL on B1's cleanup, measured by B1's own suite.
  - The cleanup row runs the cleanup inside the write's `try`, ahead of the write; its throw is counted `card_write_failed` and the write never happens, so the case reds at `the write landed`.
  - The fork-rule row reds both fork cases: the consumed-then-skip case at its CONTROL (`the fixture reached the fork skip`).
  - The consumed-before-a-fork-skip rule itself is Task 2's lib mutant; this task's sweep case is its integration, and it reds under that mutant too.
  - The copied-boundaries row reds only the spooled-fork case, at `the fork's next leaf starts at the head of the parent's boundary its copy holds`: with only its own transcript's boundaries, the fork's copy has none before its own first compaction, so the prediction starts at the copy's first row (the parent's first copied row) where derivation starts it at the parent boundary's head. Every other case's copies belong to one transcript, so the row leaves them green.
  - The tick-withdrawal row reds the floor case at `withdrawn under the floor pause` (`expected 'History: node L…' to be null`). The linked-card/<id> row walks the link: the withdrawal lstats `card/card-linked/<uuid>.txt` through it, finds a file and unlinks the target's, so the case reds at `one prediction; the linked directory is never walked` (`expected 2 to be 1`).
  - The arms row reds the recovery case at `recovery pass 1: withdrawn …`. The held and no-DB rows red the hold case at `withdrawn by the held pass` and `withdrawn by the refused pass` (the outcome line's `toContain` first). The linked-card/ row walks the link: its pass unlinks the target's file and prints `card_withdrawn:refused 1`, so the case reds at `nothing withdrawn through a linked card/`. The unrecorded row withdraws but prints nothing: `toContain('history-sweep: card_withdrawn:refused 1\n')` reds. The always-withdraw row removes every prediction its own tick wrote: the first compaction case reds at its first `cardOf` (`expected null to be 'History: node L…'`).
  - The budget-gate row breaks the loop before any candidate, so A's prediction is not consumed but withdrawn with B's: the case reds at `the consumption is counted, never swallowed by the withdrawal` (`expected {} to deeply equal { 'card_consumed:unknown': 1 }`). The write-past-the-budget row rewrites A's consumed prediction at end-of-file: `no write past the budget` reads one more `card_written`.
  - The three scope rows red the scope case's counters map: a bare `card_consumed: 3`; the link's `main` counted twice and no `unknown`; and every consumption `unknown`.
  - The decision table behind every withdrawal and scope is Task 3's, with its own mutants; these rows measure that `card.mjs` and `sweep.mjs` act on it at each place a pass ends.
  - The three R-recalloff-parity rows (predicted: the case was not run on a prototype). The oldest-family row keeps `CARD_GEN` in the record after the newer family lands: `the record follows the newest family` reds (`expected '…c0\n' to be '…f11\n'`). The no-record row reds at the first record read (`ENOENT … .gen`). The record-after row writes the prediction, then fails on the record directory: `no prediction beside a record that could not be written` reds (`expected 'History: node L…' to be null`). The record's table (when to keep, write or remove it) is Task 2's, with its own mutants.
  - The R-recalloff-keep row never unlinks the kept prediction: the case reds at `at end-of-file: no prediction left beside the record` (`expected 'History: node L…' to be null`). Measured on an extract of `oneCard`'s act block (Task 2's `decideCardGenFile`, B1's `writeFileAtomic` from origin/main, a directory at the record's name): before the ruling and under this mutant the prediction stands at end-of-file (`keep`/`write`) and off it (`keep`/`delete`), counted only `card_write_failed`; with the ruling it is gone in both, counted `card_unrecorded_removed`, and with a healthy record (`keep`/`keep`) nothing moves. The case itself was not run on a prototype (no B2 tree): a red at one of its CONTROL lines is the fixture's to fix (the torn line, the poke), never the rule.
  - The `a failed card write ends the tick` row's anchor is the `card_write_failed` bump alone, because the catch now continues past it (the R-recalloff-keep unlink) before its `return`: the thrown error still ends the tick there.

- [ ] **Step 9: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/card.mjs ccd/history/sweep.mjs server/test/history-card.test.ts server/test/history-lib.test.ts
git commit -m "feat(history): write and consume card/<id>/<uuid>.txt at end-of-file, count each consumption by scope, withdraw them all on a pass that runs no card step; the sweep makes scope/ and card/ (W1-B3 task 5)"
```

### Task 6: card.mjs: measure card delivery from the transcript

**Files:**
- Modify: `ccd/history/card.mjs` (Task 5): append one section at the END of the file; one line of `cardStep` in place.
- Modify: `server/test/historyFixtures.ts` (B1-created, B2-extended; a helper module with no `describe`): append one builder at the end of the file.
- Modify: `server/test/history-card.test.ts`: one import line edited in place; two describes at the end of the file.
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task6.json`.

**Interfaces:**
- Consumes:
  - B2 `store.mjs`: `getStep(db, step, version): { cursor: string | null; completedMs: number | null } | null`, `setStep(db, step, version, cursor, completedMs?)`; B1 `withTx`, `bump`, and `unbrotli(z, maxLen)` (`maxLen` is the blob's stored `raw_len`, required).
  - B2 lib: `eofAfterBoundary({ eofMs, boundaryTsMs })` (with `RAW_LEAF_GRACE_MS`); B1 lib `producerOf(models)`.
  - Task 4 `holdingCopyOf`; Task 3 `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery`, `CARD_MEASURE_ROWS`, `CARD_MEASURE_MAX_WAIT_MS`, `CARD_ATTACHMENT_MAX_BYTES`; B1's `blobs.raw_len` (the byte length of the stored JSON body, which for an attachment row is its `attachment` object).
  - B1 `historyFixtures.ts`: `attachmentRow(o: RowBase & { attachment: Record<string, unknown> }): Row`, `type RowBase`, `type Row`.
  - B1 `sweep.mjs` (in-process tests): `makeIngestCtx`, `newBudget`; B1 `store.mjs` `brotli`, `createStore`, `openWriter`.
  - Task 5's test helpers (`plantC`, `settleC`, `pokeC`, `appendRows`, `cardOf`, `leavesC`, `qC`, `cutBefore`, `firstUuidC`, `sidC`, `T0C`, `SeqC`).
- Produces:
  - `card.mjs`: `export function measureCardDelivery(db: DatabaseSync, ictx: { nowMs: number; budgetLeft(b: object): boolean }, budget: object): { measured: number; served: number; mismatch: number; waiting: number }`, called first by `cardStep`, whose `measure` member it fills; the module-private step `('card-measure', 1)`, whose cursor is the highest `nodes.rowid` decided.
  - Counters `card_served:<backend>` and `card_id_mismatch:<backend>` (`<backend>` a `BACKENDS` word: the boundary's producer, B2's `leaf_status:<status>:<backend>` precedent).
  - `historyFixtures.ts`: `export const sessionStartAttachment: (o: RowBase & { text: string }) => Row`.
- Later consumers: Task 13 (`measure-history.py`'s W1-e query sums both counters over `card_consumed:main` and `card_consumed:unknown`, ruling RC3).

**Spec:**
- §8.6 "Delivery is measured, not receipted" (RV17); §10.7 W1-e (≥ 95% served; `card_id_mismatch` ≤ 2%) and W1-h's card half; §9.2 step 6 (measure card delivery before writing `card/` files); §6.2 (attachment rows stored, their blob the `attachment` object); §6.1 (the holding copy).
- Pins: this task's plan pins (served, mismatch and nothing through real passes, mid-line after standing text included; the window held open and the cursor with it, then closed by 40 rows; a leaf behind an open window waits and is then counted once; subagent leaves never measured; leaves older than the first measuring pass never measured; the count and the cursor in one transaction; a copy no longer live and the wait bound each close a window; an attachment body over `CARD_ATTACHMENT_MAX_BYTES` is never decoded).
- Departures: D-4737 (`history-card-measured-from-transcript`); D-4739 (`history-card-measure-window`) (Task 3's, implemented here); B1's D-4196 (`history-producer-backend`) (the counters' backend is the boundary's producer).
- Known undercount, listed in the PR body's fixed `### Known W1-e distortions` (Task 14): a boundary whose parse crashed before its leaf was written (RB5's `leaf-crashed` marker) has no leaf, so its delivery is never measured.

**Choices this task makes:**
- **The delivery counters are keyed by the producer** (B1's D-4196 (`history-producer-backend`)): `card_served:<backend>` and `card_id_mismatch:<backend>`, where `<backend>` is the boundary's producer, the first real assistant row after its summary (`unknown` for a NULL or `<synthetic>` model), never the last row before it.
- **Spooled forks (ruled Q16) change nothing in the measure.** A leaf is measured in its own boundary's holding copy: `holdingCopyOf` picks among the files of that boundary's transcript (`boundaries.transcript_pk`, the first claim). So a parent's leaf is read in the parent's copy, never in a fork's file that copied its boundary and the SessionStart attachment after it, and no attachment is counted for two leaves. A fork's own leaves are measured in the fork's copy, as any epoch's are. The measure reads no epoch cause and keys nothing by one, and a fork adds no counter, so this task gains no case.
- **`attachmentOf` parses the decoded body with `JSON.parse`, not B1's `parseStoredJson` (accepted by the coordinator).** `parseStoredJson` carries the nesting bound of B1's D-4345 (`history-json-structure-bound`), but it lives in `sweep.mjs`, which `card.mjs` may not import, and B1's census scans `sweep.mjs` only. (The bound's predicate itself, `jsonWithinStructureBound`, is lib's and `card.mjs` could call it; it is not needed here, for the reason that follows.) Deep nesting is safe here, though not because `JSON.parse` refuses it: V8's `JSON.parse` is not recursive, and on Node 24.14.1 `JSON.parse('['.repeat(500000) + ']'.repeat(500000))`, which fits under the bound below, parses without throwing (measured). What keeps it safe is the walk: `cardIdsIn` walks the parsed value with an explicit stack, never recursion, so no nesting depth can overflow the call stack, and its work is linear in the parsed nodes. The body is bounded by `CARD_ATTACHMENT_MAX_BYTES` (1 MiB, by its stored `raw_len`) before it is decoded, which bounds those nodes. A body that is not JSON still throws in `JSON.parse`, and `attachmentOf`'s catch returns `null`: no card id, so it counts nothing served.

- [ ] **Step 1: Add the attachment builder.** Append to the end of `server/test/historyFixtures.ts`:

```ts

// ---------------------------------------------------------------------------
// W1-B3 Task 6: the attachment Claude Code records after a compaction for the context the SessionStart(compact) hook
// printed (spec 2026-10-05 §8.6 RV17: "a SessionStart hook_additional_context attachment", found within 40 rows of the
// boundary). Its `type` and its string-array `content` are what the measure reads. Plan-chosen: the `hookName` value;
// nothing reads it, and the measure ignores every key but `type` and the strings.
// ---------------------------------------------------------------------------
export const sessionStartAttachment = (o: RowBase & { text: string }): Row => attachmentRow({
  uuid: o.uuid, ts: o.ts, parentUuid: o.parentUuid ?? null, ...(o.sessionId === undefined ? {} : { sessionId: o.sessionId }),
  attachment: { type: 'hook_additional_context', content: [o.text], hookName: 'SessionStart:compact' },
});
```

- [ ] **Step 2: Edit the test file's import.** In `server/test/history-card.test.ts`, replace the line `import { compactionSequence, userRow, type Row } from './historyFixtures.js';` with:

```ts
import { compactionSequence, sessionStartAttachment, userRow, type Row } from './historyFixtures.js';
```

- [ ] **Step 3: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Task 6: card delivery measured from the transcript (spec §8.6 RV17, §10.7 W1-e).
// ===========================================================================
/** The measure's cursor, ('card-measure', 1): the highest nodes.rowid it has decided. */
const measureCursor = (box: HistoryBox): string | null =>
  qC<{ cursor: string | null }>(box, "SELECT cursor FROM derivation_state WHERE step = 'card-measure' AND version = 1")[0]?.cursor ?? null;
const topLeafRow = (box: HistoryBox): number =>
  Number(qC<{ r: number }>(box, 'SELECT max(rowid) AS r FROM nodes WHERE depth = 0')[0]!.r);
const STANDING = 'Graph: fixture graph card. Hold: none.';
const COMPACT_CARD = 'Compaction card (fixture): the files touched before the compaction.';

/** A sequence's rows with the SessionStart attachment carrying `text` spliced in right after summary k. */
function withAttachment(s: SeqC, k: number, text: string, uuid: string, sessionId: string): Row[] {
  const at = s.rows.findIndex((r) => r['uuid'] === s.summaryUuids[k]);
  const ts = new Date(Date.parse(String(s.rows[at]!['timestamp'])) + 500).toISOString();
  return [...s.rows.slice(0, at + 1), sessionStartAttachment({ uuid, ts, sessionId, text }), ...s.rows.slice(at + 1)];
}

describe("card delivery is measured from the transcript's SessionStart attachment (spec 8.6 RV17, 10.7 W1-e; W1-B3 Task 6)", () => {
  skipOnDarwin();

  it('an attachment naming the derived leaf counts card_served, one naming another leaf card_id_mismatch, none at all nothing; each by producer', () => {
    const box = makeHistoryBox('ccrc-hist-card-measure-');
    const runs = [
      { id: 'card-served', uuid: sidC(0xe1), seed: 0xe1 },
      { id: 'card-mismatch', uuid: sidC(0xe2), seed: 0xe2 },
      { id: 'card-none', uuid: sidC(0xe3), seed: 0xe3 },
    ].map((r) => ({ ...r, s: compactionSequence({ n: 1, trigger: 'manual', seed: r.seed, sessionId: r.uuid, startMs: T0C }) }));
    const paths = runs.map((r) => plantC(box, r.id, r.uuid, r.s.rows.slice(0, cutBefore(r.s, 0))));
    settleC(box);
    pokeC(box, ...runs.map((r) => r.id));
    const [served, mismatch] = runs;
    const line = cardOf(box, served!.id, served!.uuid)!.replace(/\n$/, '');
    const leafM = libCard.leafId(mismatch!.id, mismatch!.uuid, firstUuidC(mismatch!.s));
    const other = libCard.cardLine({ leaf: `L${leafM[1] === 'f' ? '0' : 'f'}${leafM.slice(2, 7)}` });
    // The served line sits mid-line, after the standing cards, as _hook_emit_context joins them with one space.
    const texts = [`${STANDING} ${line}\n${COMPACT_CARD}`, `${other}\n${COMPACT_CARD}`, COMPACT_CARD];
    runs.forEach((r, i) => {
      appendRows(paths[i]!, withAttachment(r.s, 0, texts[i]!, sidC(0xea0 + i), r.uuid).slice(cutBefore(r.s, 0)));
    });
    pokeC(box, ...runs.map((r) => r.id));
    for (const r of runs) expect(leavesC(box, r.uuid), r.id).toEqual([libCard.leafId(r.id, r.uuid, firstUuidC(r.s))]);
    const c = counters(box);
    expect(Object.fromEntries(Object.entries(c).filter(([k]) => /^card_(served|id_mismatch):/.test(k))))
      .toEqual({ 'card_served:anthropic': 1, 'card_id_mismatch:anthropic': 1 });
    expect(measureCursor(box), 'every leaf decided: the none window closed at end-of-file past the grace').toBe(String(topLeafRow(box)));
  }, 240_000);

  it('an open window holds the cursor, and a leaf behind it waits with it; each is then counted once, and 40 rows close a window with no line', () => {
    const box = makeHistoryBox('ccrc-hist-card-window-');
    const [A, UA] = ['card-wait-a', sidC(0xe4)];
    const [B, UB] = ['card-wait-b', sidC(0xe5)];
    const [C, UC] = ['card-wait-c', sidC(0xe6)];
    // A: compacted a minute ago, no attachment yet, a few rows after the boundary: its window is open. A is planted
    // BEFORE its boundary: B1's first pass is a registry scan that maps every registry-named session (a confirmed
    // `import` epoch) and ingests its transcript in that same tick, and the derivation after the ingest mints a leaf
    // for any boundary already stored, so a transcript planted whole would have its leaf before the measure's first
    // pass, and the cursor would start past it.
    const sa = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe4, sessionId: UA, startMs: Date.now() - 60_000 });
    const pa = plantC(box, A, UA, sa.rows.slice(0, cutBefore(sa, 0)));
    settleC(box);
    expect(measureCursor(box), "the first pass started at the empty store's top").toBe('0');
    appendRows(pa, sa.rows.slice(cutBefore(sa, 0)));
    pokeC(box, A);
    const [leafA] = leavesC(box, UA);
    expect(leafA).toBe(libCard.leafId(A, UA, firstUuidC(sa)));
    expect(measureCursor(box), "A's open window holds it").toBe('0');
    // B: served, but derived after A.
    const sb = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe5, sessionId: UB, startMs: T0C });
    const pb = plantC(box, B, UB, sb.rows.slice(0, cutBefore(sb, 0)));
    settleC(box);
    pokeC(box, B);
    const lineB = cardOf(box, B, UB)!.replace(/\n$/, '');
    appendRows(pb, withAttachment(sb, 0, lineB, sidC(0xeb5), UB).slice(cutBefore(sb, 0)));
    pokeC(box, B);
    expect(leavesC(box, UB)).toHaveLength(1);
    expect(counters(box)['card_served:anthropic'], "B waits behind A's open window").toBeUndefined();
    expect(measureCursor(box)).toBe('0');
    // A's attachment arrives: A is decided, then B, each once.
    appendRows(pa, [sessionStartAttachment({
      uuid: sidC(0xea4), ts: new Date().toISOString(), sessionId: UA, text: libCard.cardLine({ leaf: leafA!.slice(0, 7) }),
    })]);
    pokeC(box, A);
    expect(counters(box)['card_served:anthropic'], 'A, then B').toBe(2);
    const top = topLeafRow(box);
    expect(measureCursor(box)).toBe(String(top));
    // C: open, with no line; 40 more rows close it, and nothing is counted.
    const sc = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe6, sessionId: UC, startMs: Date.now() - 60_000 });
    const pc = plantC(box, C, UC, sc.rows);
    settleC(box);
    expect(leavesC(box, UC)).toHaveLength(1);
    expect(measureCursor(box), "C's window is open").toBe(String(top));
    appendRows(pc, Array.from({ length: libCard.CARD_MEASURE_ROWS }, (_, i) => userRow({
      uuid: sidC(0xec000 + i), ts: new Date().toISOString(), sessionId: UC, text: `row ${i}`,
    })));
    pokeC(box, C);
    expect(measureCursor(box)).toBe(String(topLeafRow(box)));
    expect(counters(box)['card_served:anthropic']).toBe(2);
  }, 240_000);
});

// In-process, against a store built by hand: a case can put a leaf on a subagent transcript, fail the cursor's write,
// mark a copy gone, or age a leaf. B2's epochFixture9 shape, with attachment and assistant rows.
interface Card6 {
  measureCardDelivery(db: DatabaseSync, ictx: object, budget: object): { measured: number; served: number; mismatch: number; waiting: number };
}
interface Sweep6 {
  makeIngestCtx(home: string, homes: string[], nowMs: number, ids: unknown): Record<string, unknown>;
  newBudget(): object;
}
const card6 = async (): Promise<Card6> => (await import('../../ccd/history/card.mjs')) as unknown as Card6;
const sweep6 = async (): Promise<Sweep6> => (await import('../../ccd/history/sweep.mjs')) as unknown as Sweep6;
const E6 = 'd6e00000-1111-4111-8111-111111111111';
interface Store6 {
  home: string;
  db: DatabaseSync;
  leaf(k: number, o: { transcript: 1 | 2; serve: boolean; createdMs?: number }): string;
  attach(k: number, o: { transcript: 1 | 2; text: string; rawLen?: number }): void;
}

/** One family and one confirmed epoch; its main transcript (pk 1, file 1) and a subagent transcript of the same uuid
 *  (pk 2, agent 'agent-x', file 2), both live and read to their end now. leaf(k) puts boundary k at line 100k of its
 *  transcript's file, a minute old (inside the raw-leaf grace, so end-of-file alone closes no window), and a leaf over
 *  it; with `serve`, the SessionStart attachment naming that leaf at 100k+1 and an assistant row at 100k+2.
 *  attach(k) puts one more hook_additional_context attachment carrying `text` at 100k+3, its blob's raw_len set to
 *  `rawLen` when one is given (the stored body itself stays small, so only the declared size differs). */
function store6(): Store6 {
  const home = mkTmp('ccrc-hist-card-measure6-');
  createStore(home);
  const db = openWriter(libCard.historyPaths(home).dbFile);
  const now = Date.now();
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'card-measure', '', 'demo', 1)").run();
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E6);
  db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (1, ?, ''), (2, ?, 'agent-x')").run(E6, E6);
  db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, eof_ms, parser_version) VALUES (1, 1, 6001, 1, 'live', ?, 1), (2, 1, 6002, 2, 'live', ?, 1)").run(now, now);
  const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)");
  const ent = db.prepare(`INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, model, provenance, prov_version,
    struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, ?, ?, ?, ?, 'harness', 1, 0, 0, ?, ?)`);
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  let entry = 0;
  const row = (t: number, line: number, type: string, subtype: string | null, model: string | null, body: unknown): number => {
    entry += 1;
    const raw = Buffer.from(JSON.stringify(body));
    const b = Number(blob.run(createHash('sha256').update(raw).digest(), brotli(raw), raw.length).lastInsertRowid);
    ent.run(entry, `d6e00000-0000-4000-8000-${entry.toString(16).padStart(12, '0')}`, t, type, subtype, model, b, now - 60_000 + line);
    member.run(t, entry, line);
    return entry;
  };
  const leaf = (k: number, o: { transcript: 1 | 2; serve: boolean; createdMs?: number }): string => {
    const t = o.transcript;
    const id = libCard.leafId('card-measure', E6, `span-${t}-${k}`);
    const b = row(t, 100 * k, 'system', 'compact_boundary', null, { boundary: k, t });
    db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)').run(b, t, k);
    if (o.serve) {
      row(t, 100 * k + 1, 'attachment', null, null, { type: 'hook_additional_context', content: [libCard.cardLine({ leaf: id.slice(0, 7) })], k, t });
      row(t, 100 * k + 2, 'assistant', null, 'claude-fixture-4', { answer: k, t });
    }
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, boundary_entry_id,
      parser_version, created_ms) VALUES (?, 1, 1, ?, 'native_leaf', 0, 'not-requested', ?, 1, ?)`).run(id, t, b, o.createdMs ?? now);
    return id;
  };
  const attach = (k: number, o: { transcript: 1 | 2; text: string; rawLen?: number }): void => {
    const e = row(o.transcript, 100 * k + 3, 'attachment', null, null, { type: 'hook_additional_context', content: [o.text], k, extra: true });
    if (o.rawLen !== undefined) {
      db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE entry_id = ?)').run(o.rawLen, e);
    }
  };
  return { home, db, leaf, attach };
}

describe("in-process: the measure's cursor, scope and transaction (spec 8.6 RV17, 10.7 W1-e; W1-B3 Task 6)", () => {
  const run6 = async (fx: Store6): Promise<ReturnType<Card6['measureCardDelivery']>> => {
    const C = await card6();
    const S = await sweep6();
    return C.measureCardDelivery(fx.db, S.makeIngestCtx(fx.home, [], Date.now(), null), S.newBudget());
  };
  const counters6 = (db: DatabaseSync): Record<string, number> => Object.fromEntries(
    (db.prepare("SELECT name, n FROM counters WHERE name LIKE 'card%' ORDER BY name").all() as Array<{ name: string; n: number }>)
      .map((r) => [r.name, Number(r.n)]));
  const cursor6 = (db: DatabaseSync): string | null =>
    (db.prepare("SELECT cursor FROM derivation_state WHERE step = 'card-measure' AND version = 1").get() as { cursor: string | null } | undefined)?.cursor ?? null;

  it('the first measuring pass reads no leaf that already exists: it starts the cursor at the newest node; a leaf derived after it is measured', async () => {
    const fx = store6();
    try {
      fx.leaf(1, { transcript: 1, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      expect(cursor6(fx.db)).toBe('1');
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      fx.leaf(2, { transcript: 1, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('a leaf of a subagent transcript is never measured, whatever its window holds', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: true });
      fx.leaf(2, { transcript: 2, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('the count and the cursor commit together: a cursor write that fails leaves no count, and the retry counts once', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: true });
      fx.db.exec(`CREATE TRIGGER card_measure_fail_i BEFORE INSERT ON derivation_state WHEN NEW.step = 'card-measure'
        BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END`);
      fx.db.exec(`CREATE TRIGGER card_measure_fail_u BEFORE UPDATE ON derivation_state WHEN NEW.step = 'card-measure'
        BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END`);
      await expect(run6(fx)).rejects.toThrow(/injected cursor failure/);
      expect(counters6(fx.db)).toEqual({});
      expect(cursor6(fx.db)).toBe('0');
      fx.db.exec('DROP TRIGGER card_measure_fail_i; DROP TRIGGER card_measure_fail_u;');
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('a window cannot wedge the walk: a copy no longer live decides at once, and so does a leaf past CARD_MEASURE_MAX_WAIT_MS; a young open one waits', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: false });
      expect(await run6(fx), 'young, live, short of 40 rows, no next boundary: it waits').toMatchObject({ measured: 0, waiting: 1 });
      expect(cursor6(fx.db)).toBe('0');
      fx.db.prepare("UPDATE ingest_files SET status = 'gone' WHERE file_id = 1").run();
      expect(await run6(fx), 'its copy gone: decided, nothing counted').toMatchObject({ measured: 1, waiting: 0 });
      fx.db.prepare("UPDATE ingest_files SET status = 'live' WHERE file_id = 1").run();
      fx.leaf(2, { transcript: 1, serve: false, createdMs: Date.now() - libCard.CARD_MEASURE_MAX_WAIT_MS - 1000 });
      expect(await run6(fx), 'past the wait bound: decided').toMatchObject({ measured: 1, waiting: 0 });
      expect(counters6(fx.db)).toEqual({});
    } finally {
      fx.db.close();
    }
  });

  it('an attachment body past CARD_ATTACHMENT_MAX_BYTES is never decoded, so even a History line in one counts nothing; CONTROL: the same row within the bound is read', async () => {
    const fx = store6();
    try {
      await run6(fx);
      // Each leaf is past the wait bound, so its window is closed while its copy stays live and is read.
      const old = Date.now() - libCard.CARD_MEASURE_MAX_WAIT_MS - 1000;
      fx.leaf(1, { transcript: 1, serve: false, createdMs: old });
      fx.attach(1, { transcript: 1, text: libCard.cardLine({ leaf: 'Lffffff' }), rawLen: libCard.CARD_ATTACHMENT_MAX_BYTES + 1 });
      expect(await run6(fx), 'decided with the large body unread').toMatchObject({ measured: 1, mismatch: 0 });
      fx.leaf(2, { transcript: 1, serve: false, createdMs: old });
      fx.attach(2, { transcript: 1, text: libCard.cardLine({ leaf: 'Lffffff' }) });
      expect(await run6(fx), 'CONTROL: within the bound the line is read, and names another leaf').toMatchObject({ measured: 1, mismatch: 1 });
    } finally {
      fx.db.close();
    }
  });
});
```

Notes:
- The fixture model `claude-fixture-4` is `anthropic` by B1's `backendOf` (a name starting `claude`).
- The trigger pair is how the in-process case fails the cursor's write without a seam in `card.mjs`: `setStep` is an upsert, and SQLite fires the BEFORE INSERT trigger first, and the BEFORE UPDATE one on the conflict's update; either aborts the transaction.
- The `withAttachment` rows keep the uuids and order of the sequence and add one row; `appendRows` of `.slice(cutBefore(…))` appends exactly what was not planted.

- [ ] **Step 4: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'measured from the transcript|the measure')
```

Expected: 7 failed. The two sweep cases at their counter assertions (`expected {} to deeply equal { 'card_served:anthropic': 1, … }`, and the window case at `expected null to be '0'`: no measure step runs, so no cursor exists); the five in-process cases with `C.measureCardDelivery is not a function`.

- [ ] **Step 5: Implement the measure.** Append to the end of `ccd/history/card.mjs`:

```js

// ── Card delivery, measured from the transcript (spec §8.6 "Delivery is measured, not receipted", RV17; §10.7 W1-e;
// W1-B3 Task 6) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The hook writes no receipt. After a compaction Claude Code records what the SessionStart(compact) hook printed as a
// `hook_additional_context` attachment a few rows after the boundary (M: 75 of 75 within 40 rows). For every new leaf of
// a main transcript this reads that window in the leaf's holding copy (derive.mjs holdingCopyOf) and folds lib's
// verdict, counted under the boundary's producer (the first real assistant row after it, B1's producerOf):
//   card_served:<backend>       a History line there names this leaf;
//   card_id_mismatch:<backend>  History lines there name only other leaves;
//   nothing                     the window closed with no History line.
// Cursor ('card-measure', 1): the highest nodes.rowid decided. The first pass sets it to the newest node there is, so a
// leaf derived before this build is never read as unserved. A window still open stops the walk: no leaf is decided past
// an undecided one, so each is counted once. A count and the cursor commit in one transaction.
// D-4737 (history-card-measured-from-transcript) D-4739 (history-card-measure-window) D-4196
const CARD_MEASURE_STEP = 'card-measure';
const CARD_MEASURE_VERSION = 1;
const MEASURE_STMTS = new WeakMap();

function measureStmts(db) {
  let s = MEASURE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    top: db.prepare('SELECT max(rowid) AS r FROM nodes'),
    leaves: db.prepare(`SELECT n.rowid AS rid, n.node_id AS node_id, n.boundary_entry_id AS boundary_entry_id,
        n.transcript_pk AS transcript_pk, n.created_ms AS created_ms
      FROM nodes n JOIN transcripts t ON t.transcript_pk = n.transcript_pk
      WHERE n.rowid > ? AND n.depth = 0 AND n.boundary_entry_id IS NOT NULL AND t.agent_id = ''
      ORDER BY n.rowid`),
    status: db.prepare('SELECT status FROM ingest_files WHERE file_id = ?'),
    lineOf: db.prepare('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?'),
    stampAt: db.prepare(`SELECT e.ts_ms AS ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line <= ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1`),
    window: db.prepare(`SELECT e.type AS type, e.blob_id AS blob_id,
        CASE WHEN b.entry_id IS NULL THEN 0 ELSE 1 END AS is_boundary
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id LEFT JOIN boundaries b ON b.entry_id = e.entry_id
      WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT ?`),
    blobZ: db.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?'),
    modelsAfter: db.prepare(`SELECT e.model AS model FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' ORDER BY m.line`),
  };
  MEASURE_STMTS.set(db, s);
  return s;
}

/** An attachment row's stored body (its `attachment` object, B1's blobBodyOf), or null for a tombstone, a body that
 *  is not JSON, or a body whose raw_len is over CARD_ATTACHMENT_MAX_BYTES, which is skipped unread: a SessionStart
 *  attachment never comes near that bound, and a re-attached file of many MiB is not decompressed only to read its
 *  `type`. The compressed bytes of a body read count against the run's byte budget, as derivation's reads do. The
 *  decode is bounded by the blob's own stored raw_len, as B1's unbrotli requires (it throws a TypeError without a
 *  bound, and a RangeError for a body that decodes past it): either throw reads as no body here. */
function attachmentOf(s, blobId, budget) {
  const r = s.blobZ.get(blobId);
  if (r === undefined || r.z === null || Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) return null;
  budget.bytes += r.z.length;
  try { return JSON.parse(unbrotli(r.z, Number(r.raw_len)).toString('utf8')); } catch { return null; }
}

/** The boundary's producer: B1's producerOf over the assistant rows after it, read lazily, in its copy's order. */
function producerAfter(s, fileId, line) {
  function* models() {
    for (const r of s.modelsAfter.iterate(fileId, line)) yield r.model;
  }
  return producerOf(models());
}

/** One leaf's delivery verdict, and the backend it is counted under when it is counted. */
function deliveryOf(db, s, ictx, n, budget) {
  const holding = holdingCopyOf(db, { entry_id: n.boundary_entry_id, transcript_pk: n.transcript_pk });
  const at = holding === null ? undefined : s.lineOf.get(holding.file_id, n.boundary_entry_id);
  const ids = [];
  let live = false;
  let rowsSeen = 0;
  let nextBoundary = false;
  let eofAfter = false;
  let line = null;
  if (holding !== null && at !== undefined) {
    line = Number(at.line);
    live = holding.source_key === '' && s.status.get(holding.file_id)?.status === 'live';
    for (const r of s.window.all(holding.file_id, line, CARD_MEASURE_ROWS)) {
      if (r.is_boundary === 1) {
        nextBoundary = true;
        break;
      }
      rowsSeen += 1;
      if (r.type === 'attachment') ids.push(...cardIdsIn(attachmentOf(s, r.blob_id, budget)));
    }
    const stamp = s.stampAt.get(holding.file_id, line);
    eofAfter = eofAfterBoundary({
      eofMs: holding.eof_ms === null ? null : Number(holding.eof_ms), boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),
    });
  }
  const windowComplete = cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs: ictx.nowMs - Number(n.created_ms) });
  const verdict = decideCardDelivery({ ids, leafId: n.node_id, windowComplete });
  const backend = verdict === 'served' || verdict === 'mismatch' ? producerAfter(s, holding.file_id, line) : null;
  return { verdict, backend };
}

/** Every new leaf of a main transcript, in rowid order, within the run's budget (§9.2 step 6: before the card files
 *  are written). Returns what it decided this pass. */
export function measureCardDelivery(db, ictx, budget) {
  const s = measureStmts(db);
  const out = { measured: 0, served: 0, mismatch: 0, waiting: 0 };
  const step = getStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION);
  if (step === null || step.cursor === null) {
    const top = s.top.get().r;
    withTx(db, 'NORMAL', () => { setStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION, String(top === null ? 0 : Number(top)), null); });
    return out;
  }
  for (const n of s.leaves.all(Number(step.cursor))) {
    if (!ictx.budgetLeft(budget)) break;
    const w = deliveryOf(db, s, ictx, n, budget);
    if (w.verdict === 'wait') { out.waiting += 1; break; }
    withTx(db, 'NORMAL', () => {
      if (w.verdict === 'served') bump(db, `card_served:${w.backend}`);
      if (w.verdict === 'mismatch') bump(db, `card_id_mismatch:${w.backend}`);
      setStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION, String(Number(n.rid)), null);
    });
    out.measured += 1;
    if (w.verdict === 'served') out.served += 1;
    if (w.verdict === 'mismatch') out.mismatch += 1;
  }
  return out;
}
```

Then, in `cardStep`, replace the line `  const measure = null;` with:

```js
  const measure = measureCardDelivery(db, ictx, budget);
```

Notes:
- The window's rows are filtered by `type = 'attachment'` before a blob is read, and by the blob's `raw_len` against lib's `CARD_ATTACHMENT_MAX_BYTES`, so only attachment bodies of a bounded size are decompressed; a skipped row still counts toward `rowsSeen`. lib's `cardIdsIn` still decides which attachment counts (`hook_additional_context`). The bound is a read bound, as `CARD_MEASURE_ROWS` is the window query's `LIMIT`: lib holds the number, and this module only applies it.
- The decode itself is bounded by the blob's own stored `raw_len`: `unbrotli(r.z, Number(r.raw_len))`. B1's `unbrotli(z, maxLen)` throws a `TypeError` when `maxLen` is not a safe non-negative integer and a `RangeError` for a body that decodes past it (its FPM10 rule; B1's own census pins that bound on `sweep.mjs`'s decodes). Called with no bound it would throw on every row, which `attachmentOf`'s catch would turn into `null`: no attachment would ever be read, and `card_served` and `card_id_mismatch` would never be counted. The size mutant (`window: an attachment of any size decoded`) still reds: with the size test removed, the planted body whose `raw_len` is declared `CARD_ATTACHMENT_MAX_BYTES + 1` decodes under that bound (its stored bytes are small), and its line counts as a mismatch.
- `window` reads at most `CARD_MEASURE_ROWS` rows after the boundary and stops at the next boundary row of the same copy, so a later compaction's attachment is never read as this one's.
- `modelsAfter` is read lazily through `iterate()`; `producerOf` stops at the first backend that is not `unknown`, and the generator's return ends the statement. Nothing writes between the read and the `withTx`.
- Check: `node --check ccd/history/card.mjs` prints nothing, and `grep -c '^  const measure = measureCardDelivery(db, ictx, budget);$' ccd/history/card.mjs` prints `1`.

- [ ] **Step 6: Run them and see them pass, then the suites the tick touches.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts test/history-sweep.test.ts test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts test/history-maint.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: green and `tsc` clean. Every tick now also measures; the measure only reads, bumps two counter families and keeps one derivation row, and no B1 or B2 assertion reads either (Task 5 Step 7's rule applies to a red).

- [ ] **Step 7: Measure every guard red, then green.** Check the runner is present as in Task 2 Step 7. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task6.json <<'EOF'
[
  { "name": "W1-e: the first pass measures every leaf the store already has", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "first measuring pass",
    "edits": [{ "anchor": "String(top === null ? 0 : Number(top))", "replacement": "'0'" }] },
  { "name": "W1-e: a subagent leaf measured", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "subagent transcript",
    "edits": [{ "anchor": "AND n.boundary_entry_id IS NOT NULL AND t.agent_id = ''", "replacement": "AND n.boundary_entry_id IS NOT NULL" }] },
  { "name": "a count committed apart from the cursor", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "commit together",
    "edits": [{ "anchor": "    withTx(db, 'NORMAL', () => {\n      if (w.verdict === 'served') bump(db, `card_served:${w.backend}`);",
                "replacement": "    if (w.verdict === 'served') bump(db, `card_served:${w.backend}`);\n    withTx(db, 'NORMAL', () => {" }] },
  { "name": "a leaf decided past an open window", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "open window",
    "edits": [{ "anchor": "    if (w.verdict === 'wait') { out.waiting += 1; break; }", "replacement": "    if (w.verdict === 'wait') { out.waiting += 1; continue; }" }] },
  { "name": "window: rows never close it", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "open window",
    "edits": [{ "anchor": "s.window.all(holding.file_id, line, CARD_MEASURE_ROWS)", "replacement": "s.window.all(holding.file_id, line, 1)" }] },
  { "name": "window: a copy gone still waits", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "cannot wedge",
    "edits": [{ "anchor": "    live = holding.source_key === '' && s.status.get(holding.file_id)?.status === 'live';", "replacement": "    live = true;" }] },
  { "name": "W1-e: the served line read only at a line start", "file": "ccd/history/lib.mjs", "test": "test/history-card.test.ts", "filter": "each by producer",
    "edits": [{ "anchor": "const CARD_ID_IN_TEXT_RE = new RegExp(`${escapeRe(CARD_PREFIX)}", "replacement": "const CARD_ID_IN_TEXT_RE = new RegExp(`^${escapeRe(CARD_PREFIX)}" }] },
  { "name": "9.2 step 6: the tick measures nothing", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "each by producer",
    "edits": [{ "anchor": "  const measure = measureCardDelivery(db, ictx, budget);", "replacement": "  const measure = null;" }] },
  { "name": "window: an attachment of any size decoded", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "is never decoded",
    "edits": [{ "anchor": " || Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) return null;", "replacement": ") return null;" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task6.json)
```

Expected: every row `red (…)` then `green`; the last line `every guard measured red, then green`; exit 0.
  - The `continue` row reds the window case at `B waits behind A's open window` (`expected 1 to be undefined`): the tick that ingests B's boundary walks past A, whose window is still open, counts B and moves the cursor past A, so `'A, then B'` is never reached.
  - The line-start row (a `^` with no `m` flag) misses the served line, which sits after the standing text: `card_served:anthropic` is absent.
  - The size row decodes the large body, whose History line names another leaf: `decided with the large body unread` reads `mismatch: 1` where 0 was expected.
  - The last two rows' filter `each by producer` selects the first sweep case (its title ends with it). A filter that matches no case makes vitest exit non-zero with `No test found`, which the runner would print as `red (?)`: a row printing `red (?)` is unmeasured, never red.

- [ ] **Step 8: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/card.mjs server/test/historyFixtures.ts server/test/history-card.test.ts
git commit -m "feat(history): measure card delivery from the transcript's SessionStart attachment (W1-B3 task 6)"
```

### Task 7: card.mjs: collect purged sessions' scope markers and card directories

**Files:**
- Modify: `ccd/history/card.mjs` (Tasks 5, 6): append one section at the END of the file.
- Modify: `ccd/history/sweep.mjs` (every edit by content, above the entry guard):
  - in place: Task 5's line `import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';`;
  - in `tick`, one comment and one call directly above B1's line `  if (scan && !ctx.rosterUnreadable) markScan(db, ctx.now());`, inside the tick-steps markers;
  - in `tick`'s doc comment, one numbered item, `collectPurgedHistoryFiles`, directly above the `markScan` item, every item renumbered: B1's F39 describe in `history-sweep.test.ts` requires the new `collectPurgedHistoryFiles(db` call to be listed, between `recordTick` and `markScan`, as the body calls it.
- Modify: `server/test/history-card.test.ts`: one describe at the end of the file (no import change: Task 5 imported `runDriver`).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b3/scratch/mutants-task7.json`.

**Interfaces:**
- Consumes:
  - B1 `sweep.mjs` `tick`: its `const scan = scanDue(db, ctx.now());` (the 30-minute registry scan, meta `scan_ms`) and the `markScan` line; B1 lib `historyPaths(home).reg` (`<home>/.cc-sessions`), `historyPaths(home).root`, `idOk`; B1 `store.mjs` `bump`.
  - Task 3 `decidePurgedEntry`, Task 1 `SCOPE_DIR`, `CARD_DIR`, `PURGED_FILES_GRACE_MS`; Task 5's `lstatKind`.
  - Tests: B1 `runDriver(box, deps: { offsetMs?: number }, args?)` (the pass clock moved forward, so the scan is due), B1 lib `SCAN_INTERVAL_MS`; Task 5's helpers.
- Produces:
  - `card.mjs`: `export function collectPurgedHistoryFiles(db: DatabaseSync, home: string, nowMs: number): { scope: number; card: number }` (entries removed).
  - Counters `scope_files_purged` and `card_files_purged`.
  - `sweep.mjs`: `import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';`; in `tick`, `if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now());`, and its doc-comment item between `recordTick` and `markScan`.
- Later consumers: Task 12 (both lifecycle rows' collector text names this behaviour).

**Spec:**
- §9.4: `history-scope-markers` and `history-card-files`, collector "ccd-history-sweep (the files of purged sessions after 7 days)"; §5.2 (the registry is read-only); §13 (unreadable is not absent; ccrc writes and removes only what it owns).
- Pins: this task's plan pins (a registry-absent entry older than 7 days removed and counted; 6 days kept; registry present kept; registry unmeasurable kept; a link unlinked, its target untouched; an id failing `idOk` skipped; a card directory holding a directory kept whole; `spool/` and `journal/` never touched; nothing collected at a tick whose scan is not due).
- Departures: D-4745 (`history-purged-files-aged-by-mtime`) (NEW): ccd's purge (`_reg_purge`) leaves no time the sweep may read, so "7 days after purge" is measured from the entry's own newest write once the registry no longer names the session; a file last written long before its session was purged can therefore go at the first scan after the purge.

- [ ] **Step 1: Confirm the anchors.** From the repository root:

```bash
grep -c "^  const scan = scanDue(db, ctx.now());$" ccd/history/sweep.mjs                      # 1
grep -c "^  if (scan && !ctx.rosterUnreadable) markScan(db, ctx.now());$" ccd/history/sweep.mjs # 1
grep -c "^import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';$" ccd/history/sweep.mjs    # 1
grep -cE '^ \* +[0-9]+\. `(recordTick|markScan)`' ccd/history/sweep.mjs                                    # 2
```

Expected: `1`, `1`, `1`, `2` (the doc comment's `recordTick` and `markScan` items, which the collector's item goes between); otherwise re-anchor on the merged lines that do the same thing and report it.

- [ ] **Step 2: Write the failing tests.** Append to the end of `server/test/history-card.test.ts`:

```ts

// ===========================================================================
// W1-B3 Task 7: purged sessions' scope markers and card directories, collected at the scan, 7 days on (spec §9.4).
// runDriver moves the pass clock past SCAN_INTERVAL_MS, so that pass's registry scan is due.
// ===========================================================================
describe("purged sessions' scope markers and card directories go 7 days on, at the scan (spec 9.4; W1-B3 Task 7)", () => {
  skipOnDarwin();
  const DAY = 24 * 60 * 60 * 1000;
  const SCAN_LATER = { offsetMs: libCard.SCAN_INTERVAL_MS + 60_000 };
  /** Sets an entry's own times (a link's, never its target's) to `ms` ago. */
  const age = (p: string, ms: number): void => {
    const t = (Date.now() - ms) / 1000;
    fs.lutimesSync(p, t, t);
  };
  const scopeOf = (box: HistoryBox, id: string): string => path.join(box.root, 'scope', id);
  /** A short transcript: two rows, no boundary yet, so its card predicts the epoch's first leaf. */
  const tiny = (uuid: string, n: number): Row[] => [
    userRow({ uuid: sidC(n), ts: new Date(T0C).toISOString(), sessionId: uuid, text: 'a request' }),
    userRow({ uuid: sidC(n + 1), ts: new Date(T0C + 1000).toISOString(), sessionId: uuid, text: 'a follow-up' }),
  ];
  /** A session with its prediction written and a scope marker (as the hook would write it), all aged `days`. */
  const seeded = (box: HistoryBox, rows: ReadonlyArray<readonly [string, string, number]>): void => {
    rows.forEach(([id, uuid], i) => plantC(box, id, uuid, tiny(uuid, 0x7100 + 16 * i)));
    settleC(box);
    pokeC(box, ...rows.map(([id]) => id));
    for (const [id, uuid, days] of rows) {
      expect(cardOf(box, id, uuid), id).not.toBeNull();
      fs.writeFileSync(scopeOf(box, id), `main ${uuid} ${Date.now()}\n`);
      for (const p of [scopeOf(box, id), cardPath(box, id, uuid), path.join(box.root, 'card', id)]) age(p, days * DAY);
    }
  };
  const purge = (box: HistoryBox, id: string): void => {
    for (const f of fs.readdirSync(box.reg).filter((n) => n.startsWith(`${id}.`))) fs.rmSync(path.join(box.reg, f));
  };

  it('registry absent and 8 days old: removed and counted; 6 days old, or still in the registry: kept; nothing at a pass whose scan is not due', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-');
    const fam = [['card-gone', sidC(0x71), 8], ['card-young', sidC(0x72), 6], ['card-live', sidC(0x73), 8]] as const;
    seeded(box, fam);
    purge(box, 'card-gone');
    purge(box, 'card-young');
    passC(box);
    for (const [id] of fam) expect(fs.existsSync(scopeOf(box, id)), `${id}: this pass's scan was not due`).toBe(true);
    expect(counters(box)['scope_files_purged']).toBeUndefined();
    const r = runDriver(box, SCAN_LATER);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(fs.existsSync(scopeOf(box, 'card-gone'))).toBe(false);
    expect(fs.existsSync(path.join(box.root, 'card', 'card-gone'))).toBe(false);
    for (const [id, uuid] of fam.slice(1)) {
      expect(fs.existsSync(scopeOf(box, id)), id).toBe(true);
      expect(cardOf(box, id, uuid), id).not.toBeNull();
    }
    const c = counters(box);
    expect([c['scope_files_purged'], c['card_files_purged']]).toEqual([1, 1]);
  }, 240_000);

  it.skipIf(process.getuid?.() === 0)('a registry entry that cannot be measured keeps the files: unmeasured is never absent', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-eacces-');
    const ID = 'card-unmeasured';
    const U = sidC(0x74);
    seeded(box, [[ID, U, 8]]);
    fs.chmodSync(box.reg, 0o600);
    let code: number | null = null;
    try {
      code = runDriver(box, SCAN_LATER).code;
    } finally {
      fs.chmodSync(box.reg, 0o700);
    }
    expect(code, 'the pass ran its scan to the end').toBe(0);
    expect(fs.existsSync(scopeOf(box, ID))).toBe(true);
    expect(cardOf(box, ID, U)).not.toBeNull();
    expect(counters(box)['scope_files_purged']).toBeUndefined();
  }, 240_000);

  it('a link is unlinked and its target kept; a name failing idOk, a card directory holding a directory, and the other history directories stay', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-shapes-');
    passC(box);
    const outside = path.join(box.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'target');
    const link = scopeOf(box, 'card-link');
    fs.symlinkSync(outside, link);
    const bad = scopeOf(box, 'bad name');
    fs.writeFileSync(bad, 'x');
    const nested = path.join(box.root, 'card', 'card-nested');
    fs.mkdirSync(path.join(nested, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(nested, 'note'), 'x');
    for (const p of [link, bad, path.join(nested, 'note'), path.join(nested, 'sub'), nested]) age(p, 8 * DAY);
    const listing = (d: string): string[] => (fs.existsSync(path.join(box.root, d)) ? fs.readdirSync(path.join(box.root, d)).sort() : []);
    const journal = listing('journal');
    const r = runDriver(box, SCAN_LATER);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(() => fs.lstatSync(link), 'the link itself is gone').toThrow();
    expect(fs.readdirSync(outside), 'its target is untouched').toEqual(['keep.txt']);
    expect(fs.existsSync(bad), 'a name failing idOk is never read as a session').toBe(true);
    expect(fs.readdirSync(nested).sort(), 'a directory this writer never makes keeps its card directory whole').toEqual(['note', 'sub']);
    expect(listing('journal'), 'journal/ is never walked').toEqual(journal);
    expect(fs.statSync(path.join(box.root, 'spool')).isDirectory()).toBe(true);
    expect(counters(box)['scope_files_purged']).toBe(1);
  }, 240_000);
});
```

Notes:
- The seeded sessions stay in the store after their registry rows go, so their predictions do not change: the card writer keeps each file as it is (Task 5's `keep`) and never refreshes its time, and no prediction is written for a session the registry does not name (D-4743 (`history-card-registry-names-the-session`)). That is what lets an aged file reach the collector.
- `fs.lutimesSync` sets a link's own times; `fs.utimesSync` would set its target's.
- `card-gone`, `card-young` and `card-live` are fixture session ids.

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'go 7 days on')
```

Expected: 2 failed and 1 passed (as root: 2 failed and 1 skipped, the unmeasured case being skipped there). The first case fails at `expect(fs.existsSync(scopeOf(box, 'card-gone'))).toBe(false)` (nothing collects yet), the third at `the link itself is gone`. The unmeasured case passes before the collector exists, as a keep-pin does; its red is measured in Step 7 with a mutant that reads an unmeasured registry as absent.

- [ ] **Step 4: Implement the collector.** Append to the end of `ccd/history/card.mjs`:

```js

// ── Purged sessions' files (spec §9.4: history-scope-markers and history-card-files, "the files of purged sessions
// after 7 days"; W1-B3 Task 7) ──────────────────────────────────────────────────────────────────────────────────────
// At the periodic scan, every scope/<id> and card/<id> whose session the registry no longer names (`$REG/<id>.uuid`
// absent; ccd's _reg_purge removes every field of the id) and whose newest write is more than PURGED_FILES_GRACE_MS
// old is removed (lib decidePurgedEntry decides). ccd's purge leaves no time to read, so the age is the entry's own
// newest write. D-4745 (history-purged-files-aged-by-mtime)
// Removal never follows a link and never recurses: a link or a file is unlinked; a card directory has its links and
// files unlinked and is removed, unless it holds a directory, which this writer never makes. Only scope/ and card/ are
// walked, and only names that pass idOk. A failure leaves the rest for the next scan.

/** `$REG/<id>.uuid` by lstat: present, absent (ENOENT), or unmeasured (any other failure). */
function registryKind(reg, id) {
  try {
    lstatSync(`${reg}/${id}.uuid`);
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }
  return 'present';
}

/** An entry's newest write, by lstat (a link's own time): itself, and each entry of a real directory; null when any of
 *  them cannot be measured. */
function newestMtimeMs(p) {
  let st;
  try { st = lstatSync(p); } catch { return null; }
  let newest = st.mtimeMs;
  if (!st.isDirectory()) return newest;
  let names;
  try { names = readdirSync(p); } catch { return null; }
  for (const n of names) {
    try { newest = Math.max(newest, lstatSync(`${p}/${n}`).mtimeMs); } catch { return null; }
  }
  return newest;
}

/** Removes one scope marker or card directory without following a link. Answers whether it is gone. */
function removeEntry(p) {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) {
      unlinkSync(p);
      return true;
    }
    const names = readdirSync(p).sort();
    if (names.some((n) => lstatSync(`${p}/${n}`).isDirectory())) return false;
    for (const n of names) unlinkSync(`${p}/${n}`);
    rmdirSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The scan's collection of purged sessions' scope markers and card directories (§9.4), counted
 *  `scope_files_purged` and `card_files_purged`. A registry directory that cannot be listed measures no session absent,
 *  so then nothing is removed. */
export function collectPurgedHistoryFiles(db, home, nowMs) {
  const P = historyPaths(home);
  const out = { scope: 0, card: 0 };
  if (lstatKind(P.reg) !== 'dir') return out;
  for (const [kind, name] of [['scope', SCOPE_DIR], ['card', CARD_DIR]]) {
    const dir = `${P.root}/${name}`;
    if (lstatKind(dir) !== 'dir') continue;
    let ids;
    try { ids = readdirSync(dir).sort(); } catch { continue; }
    for (const id of ids) {
      if (!idOk(id)) continue;
      const verdict = decidePurgedEntry({ reg: registryKind(P.reg, id), newestMtimeMs: newestMtimeMs(`${dir}/${id}`), nowMs });
      if (verdict === 'remove' && removeEntry(`${dir}/${id}`)) out[kind] += 1;
    }
  }
  if (out.scope > 0) bump(db, 'scope_files_purged', out.scope);
  if (out.card > 0) bump(db, 'card_files_purged', out.card);
  return out;
}
```

- [ ] **Step 5: Wire it into the tick.** In `ccd/history/sweep.mjs`:
  1. Replace the line `import { cardStep, ensureHistoryDirs, withdrawCards } from './card.mjs';` with:

```js
import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';
```

  2. Directly above the line `  if (scan && !ctx.rosterUnreadable) markScan(db, ctx.now());`, add:

```js
  // §9.4 (W1-B3 Task 7): the scope markers and card directories of purged sessions, 7 days on, at the periodic scan.
  if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now());
```

  2a. Name the step in `tick`'s doc comment (the `/**` directly above `export async function tick(db, ctx) {`), directly above the `markScan` item, renumbering every item. B1's F39 describe requires every `name(db` call to be an item, in body order, and the collector is called between `recordTick` and `markScan`. From the repository root:

```bash
python3 - <<'PYEOF'
import re
p = 'ccd/history/sweep.mjs'
t = open(p, encoding='utf8').read()
at = t.index('export async function tick(db, ctx) {')
start = t.rindex('/**', 0, at)
lines = t[start:at].split('\n')
item = re.compile(r'^ \*\s*\d+\. `([A-Za-z]\w*)`')
names = [m.group(1) for l in lines if (m := item.match(l))]
assert names.count('markScan') == 1 and 'collectPurgedHistoryFiles' not in names, names
assert names.index('recordTick') + 1 == names.index('markScan'), names
j = next(k for k, l in enumerate(lines) if (m := item.match(l)) and m.group(1) == 'markScan')
lines[j:j] = [' * 0. `collectPurgedHistoryFiles`: at a due scan, the scope markers and card directories of purged sessions,',
              ' *     7 days on (card.mjs; W1-B3 Task 7);']
n = 0
for k, l in enumerate(lines):
    if item.match(l):
        n += 1
        lines[k] = re.sub(r'^ \*\s*\d+\.', ' *' + f'{n:>3}' + '.', l, count=1)
t = t[:start] + '\n'.join(lines) + t[at:]
open(p, 'w', encoding='utf8').write(t)
print(f'tick doc comment: {n} steps')
PYEOF
```

Expected: `tick doc comment: <n> steps`, one more than Task 5 left (22: B1's 16, B2's `beltNodesStep` and `deriveNodes`, Task 5's three, and this one; 23 if B4 merged first, with its `exportStep` below `markScan`, which this item does not touch).

  3. Check, from the repository root:

```bash
grep -c "^import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';$" ccd/history/sweep.mjs   # 1
grep -c '^  if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now());$' ccd/history/sweep.mjs                         # 1
grep -cE '^ \* +[0-9]+\. `collectPurgedHistoryFiles`' ccd/history/sweep.mjs                                                # 1
g=$(grep -n 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs | cut -d: -f1); l=$(grep -nF 'collectPurgedHistoryFiles(db, ctx.home' ccd/history/sweep.mjs | cut -d: -f1); [ "$l" -lt "$g" ] && echo above || echo BELOW
node --check ccd/history/card.mjs && node --check ccd/history/sweep.mjs
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'docstring names its steps')
```

Expected: `1`, `1`, `1`, `above`, `node --check` prints nothing, and `3 passed` (B1's F39 describe). Without step 2a its `every step the body calls with db is listed` reds with `expected [ 'collectPurgedHistoryFiles' ] to deeply equal []`.

- [ ] **Step 6: Run the whole file, the suites the tick touches, and the typecheck.** In the foreground, with a timeout of at least 600000 ms, each line as its own call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts test/history-drain.test.ts test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/ci-pipeline.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: green; `tsc` clean. The collector runs only at a due scan and walks only `scope/` and `card/`; no B1 or B2 case plants either.

- [ ] **Step 7: Measure every guard red, then green.** Check the runner is present as in Task 2 Step 7. Then, from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
cat > .superpowers/sdd/history-w1-b3/scratch/mutants-task7.json <<'EOF'
[
  { "name": "9.4: a session the registry still names collected", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "still in the registry",
    "edits": [{ "anchor": "    return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';\n  }\n  return 'present';", "replacement": "    return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';\n  }\n  return 'absent';" }] },
  { "name": "IV5: an unmeasured registry read as absent", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "cannot be measured",
    "edits": [{ "anchor": "    return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';\n  }\n  return 'present';", "replacement": "    return 'absent';\n  }\n  return 'present';" }] },
  { "name": "a link followed into its target", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "link is unlinked",
    "edits": [{ "anchor": "    if (!st.isDirectory()) {\n      unlinkSync(p);", "replacement": "    if (!st.isDirectory() && !st.isSymbolicLink()) {\n      unlinkSync(p);" }] },
  { "name": "a card directory holding a directory emptied", "file": "ccd/history/card.mjs", "test": "test/history-card.test.ts", "filter": "link is unlinked",
    "edits": [{ "anchor": "    if (names.some((n) => lstatSync(`${p}/${n}`).isDirectory())) return false;\n", "replacement": "" }] },
  { "name": "collected at every tick, not at the scan", "file": "ccd/history/sweep.mjs", "test": "test/history-card.test.ts", "filter": "still in the registry",
    "edits": [{ "anchor": "  if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now());", "replacement": "  collectPurgedHistoryFiles(db, ctx.home, ctx.now());" }] }
]
EOF
(cd server && node ../.superpowers/sdd/history-w1-b3/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b3/scratch/mutants-task7.json)
```

Expected: every row `red (N failed)` then `green`; the last line `every guard measured red, then green`; exit 0.
  - The first row removes `card-live` at the scan; the last removes `card-gone` at the pass whose scan was not due.
  - The link row treats the link as a directory: `readdirSync` follows it and unlinks the target's `keep.txt`, then `rmdirSync` fails on the link (ENOTDIR), so the link survives and the case reds first at `the link itself is gone` (`expected [Function] to throw an error`); the target's listing, checked next, would read `[]`.
  - The nested row unlinks `note` (first in sorted order), then fails on `sub`: the directory is left half-emptied (`expected [ 'sub' ] to deeply equal [ 'note', 'sub' ]`).
  - As root, the IV5 row prints `STAYED GREEN` (its case is skipped there): run it as a non-root user, or report it unmeasured as root; never drop it.

- [ ] **Step 8: Confirm the restore, then commit.** In the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b3/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git add ccd/history/card.mjs ccd/history/sweep.mjs server/test/history-card.test.ts
git commit -m "feat(history): collect purged sessions' scope markers and card directories at the scan, 7 days on (W1-B3 task 7)"
```

### Task 8: Hook: the PreCompact scope marker (tail, after `_hook_compact_pre`)

**Files:**
- Modify: `ccd/session-hook.sh`, in the tail only. Three edits:
  - directly below the line `esac` that closes `case "$event" in` (the first line after `case "$event" in` that is exactly `esac`; `:2916` at f7e51156f, below README's anchor at the emitter call), a 7-line comment and one builtin line that empties this id's existing scope marker on a main-thread PreCompact. It runs before every exit the tail can take on the way to the marker block, the hookstate `jq` compose's, the 64 KB cap's and the hookstate write's two among them (`:3602-3616` at f7e51156f).

  The other two sit around the line `if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi` (two spaces before `]]` and two after the function name). That line is `:3626` at f7e51156f and `:3741` at origin/main 9a255a746, and B1's spool block moves it about 69 lines further down. Anchor by its content:
  - directly above it: a 4-line comment and the line `unset CS_SCOPE`;
  - directly below it, and above `if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi`: the block that runs from `# >>> history-scope (spec 2026-10-05 §5.1)` to `# <<< history-scope`.
  - The comment above both stays verbatim. It begins `# The two compaction arms run LAST, after the` (`:3622-3625` at f7e51156f), and its "Nothing below prints" stays true: the new block prints nothing.
  - Every added line is below README's anchor and below every spec and plan anchor into the hook (the highest is `:2472`), so no citation moves. Step 7 measures that.
- Test: `server/test/session-hook.test.ts`. Append one describe after the file's last line, which is after B1's `history spool` describe and B2's C17 describe. Add no import line: the census cites this file by line, up to `:7056`.
- Scratch (gitignored under `.superpowers/`, never committed): `.superpowers/sdd/history-w1-b3/scratch/`, holding `mutate.py`, `mutants-t8.py`, `cite-remeasure.py`, `cite-run.sh`, `keep/` and `keep-cite/`.

**Interfaces:**
- Consumes, from the hook (all pre-existing at f7e51156f):
  - the globals `event`, `paid` (non-empty for an `agent_id` payload), `psid` (the payload's `session_id`, cleaned to `[A-Za-z0-9_-]`), `id` (matched to `^[A-Za-z0-9._-]+$`), `payload`, `HOME` and `REG`;
  - `CS_SCOPE`, a plain global with no initialiser. `_hook_compact_scope` empties it first, then answers `main`, `subagent` or `ambiguous` with rc 0, or rc 1 when nothing may be said. `_hook_compact_pre` overlays `ambiguous` on an overlap, and returns before scoping under compact-card-off (`[ -e "$COMPACT_CARD_OFF" ] && return 0`) or when its payload read fails;
  - `_hook_compact_scope <transcript_path> <trigger>` (`:950`) and `_hook_epoch_ms` (`:41`).
- Consumes, from B1: the `# >>> history-spool` block (the epoch line S8 asks for), and `SPOOL_ID_MAX` (224) from `ccd/history/lib.mjs`, in the test only.
- Consumes, from the test file's module scope: `runFull` (asserts exit 0 and returns stdout and stderr), `hookEnv(env)` (B1's one definition of every hook spawn's env, which `run`, `runFull` and the spool describe's `runSpoolBounded` share; a hand-built spawn takes `env: hookEnv(SCRUB)`), `home`, `HOOK`, `GENERATION`, `preCompact(tree, transcript, trigger)`, `plantSession({ sid, lines, parentAge, subagents })`, `setFile()`, `tl`, `LIVE` (5 s), `DEAD` (600 s), `itLinux`, `spawnSync` and `execFileSync` (the FIFO case's `mkfifo`, as B1's spool FIFO row runs it). `preCompact` hard-codes `session_id: 'sess-1'`, so the cases override it with a UUID.
- Consumes, from Task 1, in the test only: lib's `cardLine`, by dynamic import.
- Produces:
  - the marker `~/.ccrc/history/scope/<id>`, one line `<scope> <psid> <ms>\n`. `scope` is `main`, `subagent` or `ambiguous`, `psid` a lowercase UUID, `ms` epoch milliseconds; 61 bytes at most. Every main-thread PreCompact first empties an existing marker (the line below `esac`, before any tail exit); the block then writes only a decided verdict. So an undecided verdict, or a run that exits before the block, leaves the marker empty, and no file is created where none was. Task 9's reader consumes it;
  - the tail function `_hook_history_scope`, between the markers `# >>> history-scope (spec 2026-10-05 §5.1)` and `# <<< history-scope`;
  - `unset CS_SCOPE`, directly above the `_hook_compact_pre` call, under a comment whose first line is ``# `CS_SCOPE` is the compaction card's scope verdict, a plain global with no``. Task 10 puts the reserve directly above that comment;
  - three lines that spell `"$HOME/.ccrc/history/scope"`: the block's `local f=…` and its gate, and the early line below `esac`. Task 9 re-points all three to its `HISTORY_SCOPE_DIR`.

**Spec:** §5.1 "The PreCompact scope marker" (where, gates, the `CS_SCOPE` verdict, the write), §5.3 (the scope-marker row), §5.2 (the hook never mkdirs; the marker is one of the three writes that are not the store's), §5.5 S16 and the marker halves of S2, S3 and S8, §13 (PreCompact writes one marker after the card's arm, outside the spool block). §5.1's "A regular file or nothing, in a real `scope/`", §5.3 and S16's rev 3.5 cases (ruled R-B3-fifo, review finding R74): the marker follows B1's D-4418 (`history-spool-append-regular-file-only`) rule, so `scope/` must be a real directory, not a symlink (`! -L` beside the gate's `-d` and beside the early truncation's `-f`; RV9: only `db/` may link out of the history root), and the block writes only where `[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]]` holds, tested with builtins on the line directly above the `>`. A FIFO planted at `scope/<id>` before the run would otherwise block the `>` open until Claude Code kills the hook (600 s), and a symlinked `scope/` would be written through. §5.1's "The early truncation" (rev 3.5, S16's rev 3.5 rows; coordinator ruling RC1, stated in the spec as the rule, so it is no departure and has no §16 row or ledger number): writing nothing on a set-but-empty verdict, and the write's site after `_hook_compact_pre`, which runs after the hookstate write's two `exit 0`s, would each leave a fresh `main` marker from an earlier compaction of the same psid in place, and the next SessionStart(compact), which may be a subagent's, would serve the card line from it. So every main-thread PreCompact (no `agent_id`, a compacting subagent's included) empties an existing marker directly below `esac`, before any tail exit, and only a decided verdict is written after the card's call; S16's "a hookstate write that fails → no marker" then holds with an earlier marker too. An emptied marker also folds a later consumption as `card_consumed:unknown` (Task 5, ruling RC3), which stays in W1-e's denominator. Departures:
- D-4746 (`history-scope-marker-after-card`): the site, the reuse of a set `CS_SCOPE`, and scope run by the block when the card did not.
- D-4747 (`history-card-main-scope-only`): the marker is what keeps the card line out of a subagent's context.
- B1's D-4252 (`history-epoch-lines-survive-off`), marker half: `history-off` silences the marker, never the epoch lines.

**Choices this task makes:**
- **The id bound is a builtin test** (B1's D-4170 (`history-id-grammar`), applied as bash can): `_hook_history_scope` tests `(( ${#id} <= 224 ))`, B1's `SPOOL_ID_MAX`, before anything at `scope/<id>` is tested or opened (mutant `T8-M6-id-bound`); `.` and `..` are refused structurally (next item).
- **`.` and `..` get no test of their own.** The hook's id grammar admits both. Under `scope/` they name directories: `scope/.` is `scope/` itself and `scope/..` is the history root. Neither the write nor the truncation can open a directory. A builtin test there could not be told apart from its absence by any input, and this repo does not ship a guard nothing can trip (`_hook_compact_mark_served`'s own comment says so). One case pins the structural fact instead: ids `.` and `..` leave `scope/` empty and touch nothing else. (The regular-file test above the write, "A regular file or nothing" below, now refuses a directory too, so the write is not even tried; the early truncation's `-f` already refused one. Neither is a test of the id.) The 224-char bound does get a test, because a 225-char name is writable.
- **A lowercase-UUID psid is required.** The card file is `card/<id>/<uuid>.txt`, so a marker for any other psid could never be read.
- **A regular file or nothing, in a real `scope/`** (spec §5.1, §5.3 and S16; B1's D-4418 (`history-spool-append-regular-file-only`) rule, ruled R-B3-fifo). The block's gate adds `! -L` on `scope/` beside its `-d`, and the block tests `[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]]`, B1's spool test, on the line directly above its write, after the scope rule and the clock have run, so only builtins stand between the test and the `>`. That one test replaces the block's earlier `[[ ! -L "$f" ]]` line, so the symlink case and its mutant `T8-M8-symlink` measure the same line the FIFO case does (a second `! -L` higher up would leave each mutant a backstop and nothing to red); a symlink at the marker's path now costs the block its jq, scope and clock forks before the refusal, which PreCompact, off the hot path, can pay. The early truncation adds `! -L` on `scope/` beside its existing `-f` and `! -L` on the marker (`-f scope/<id>` already implies a directory or a link to one). So a symlink at the marker's path, dangling or not, a FIFO or any other node writes nothing, and a symlinked `scope/` is neither written nor truncated through. Cases pin a FIFO planted before the run (exit 0 within a 10 s deadline, the FIFO left a FIFO), a symlinked `scope/` (nothing written or truncated at its target) and a CONTROL (an existing regular marker is replaced by this run's verdict), each with a mutant (Step 6: `T8-M14` to `T8-M17`), and the source pin requires the type test directly above the write (`T8-M18`).
- **What is left is the post-test swap.** Bash has no `O_NOFOLLOW` or `O_NONBLOCK` redirection, so a node swapped in AFTER the test is still opened: a link is followed, a FIFO blocks until Claude Code kills the hook (`install-session-hooks.sh` `HOOK_TIMEOUT_S`). That is the residue B1's spool block names in the same words (its "a regular file or nothing" comment), and only that residue: a node present when the test runs is refused, here as there. No case can measure the swap window, so none is added, and the block's comment names it.
- **The unset arm parses the payload with one jq**, printing `.transcript_path` and `.trigger // "auto"` on two lines, as `_hook_compact_pre` reads them. A failed parse leaves the path empty, the scope rule answers rc 1, and the verdict is undecided.
- **The invalidation runs first, directly below `esac`, and is builtin-only.** The tail can exit between `esac` and the marker block (the hookstate compose, the 64 KB cap, the hookstate write and `mv`), and a hook kill can land there too. Emptying the marker before any of them means each of those leaves an empty marker, never an older fresh `main` one. It runs under `history-off` too: emptying serves nothing and grows nothing, and the reader refuses under `history-off` anyway. It needs neither the id bound nor the psid test, because it only truncates a regular non-link file that already exists in a `scope/` that is not a symlink.
- **A spooled SessionStart(fork) (ruled Q16) changes nothing here.** The marker is written and emptied on PreCompact only, and a SessionStart(fork) neither writes nor reads it (the reader runs on a compact SessionStart only, Task 9). A fork's own compactions write and empty `scope/<id>` as any main thread's do, keyed on its own psid, so a marker the parent left before a `/branch` names the parent's sid and cannot serve a fresh-sid fork. B2's one hook edit is `fork` added in place to the spool block's source whitelist, outside this block and below README's anchor, so no line this task anchors on or measures moves.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -cxF 'if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi' ccd/session-hook.sh
grep -cxF 'if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi' ccd/session-hook.sh
grep -cxF '# >>> history-spool (spec 2026-10-05 §5.1)' ccd/session-hook.sh
grep -c '^_hook_compact_scope() {' ccd/session-hook.sh
grep -c 'history-scope' ccd/session-hook.sh
grep -cxF 'unset CS_SCOPE' ccd/session-hook.sh
awk '/^case "\$event" in$/{c=NR} c && !e && /^esac$/{e=NR} END{print (c && e) ? "case " c " esac " e : "NO CASE/ESAC"}' ccd/session-hook.sh
grep -cF 'history/scope/$id" && ! -L' ccd/session-hook.sh
grep -c '^out=\$(jq -cn' ccd/session-hook.sh
```

Expected: `1`, `1`, `1`, `1`, `0`, `0`, then `case <n> esac <m>`, the event case's first and last lines, both above the `_hook_compact_pre` call (`case 2771 esac 2916` at f7e51156f), then `0`, then `1` (the hookstate compose, `:3591` at f7e51156f; its `|| exit 0`, the 64 KB cap's and the write's two follow it). Any other answer means a base this task was not written against: stop and report it to the coordinator.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/session-hook.test.ts`, after its last line:

```ts
// ── ccrc history: the PreCompact scope marker (history spec 2026-10-05 §5.1, §5.5 S16; W1-B3 task 8) ──
// APPENDED, with NO new import line: the citation census cites this file by line.
// `runFull`/`hookEnv`/`home`/`preCompact`/`plantSession`/`setFile`/`tl`/`LIVE`/`DEAD`/`GENERATION` are
// this file's module-level fixture (a fixture HOME, a stub tmux answering
// cc-demo-quiet-basin, the row's 36-byte generation file).
describe('history scope marker: PreCompact records whose context is compacting (spec §5.1, S16)', () => {
  const SID = '7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
  const ID = 'demo-quiet-basin';
  /** spec §10.1: the operator's own session must not reach the hook through `hookEnv`'s `...process.env`; every
   *  inherited `CCRC_RECALL_*` is blanked too, as B1's spool describe blanks them. */
  const SCRUB: Record<string, string> = {
    TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
    ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('CCRC_RECALL_')).map((k) => [k, ''])),
  };
  const histDir = (...p: string[]): string => path.join(home, '.ccrc', 'history', ...p);
  const scopeDir = (): string => histDir('scope');
  const marker = (id = ID): string => histDir('scope', id);
  const plantScope = (): void => { fs.mkdirSync(scopeDir(), { recursive: true, mode: 0o700 }); };
  const cardOff = (): void => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
  };
  const historyOff = (): void => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'history-off'), '');
  };
  /** PreCompact with this describe's UUID session id: the module's `preCompact` hard-codes `sess-1`. */
  const pre = (transcript: string, trigger = 'manual', extra: object = {}): object =>
    ({ ...preCompact(home, transcript, trigger), session_id: SID, ...extra });
  /** The marker's three fields, asserted to be one line of at most 64 bytes. */
  const read = (id = ID): { scope: string; sid: string; ms: number } => {
    const raw = fs.readFileSync(marker(id), 'utf8');
    expect(Buffer.byteLength(raw), 'the marker is at most 64 bytes').toBeLessThanOrEqual(64);
    expect(raw.endsWith('\n') && raw.indexOf('\n') === raw.length - 1, 'one line').toBe(true);
    const [scope, sid, ms] = raw.trimEnd().split(' ');
    return { scope: scope!, sid: sid!, ms: Number(ms) };
  };
  /** Re-point the stub tmux at an id of exactly `n` characters. */
  const longId = (n: number): string => {
    const id = 'a'.repeat(n);
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(home, '.cc-sessions', `${id}.generation`), GENERATION);
    return id;
  };

  it('S16: with no scope/ directory there is no marker, nothing is created, and stdout and stderr are both empty', () => {
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.existsSync(histDir()), 'the hook never mkdirs').toBe(false);
  });

  // The case above cannot see the gate on scope/: without it, the block's write into a missing directory fails
  // silently and leaves the same nothing behind. What the gate saves is the block's forks, so this case counts them
  // against the same run under history-off, whose own gate stops the block. compact-card-off keeps the card from
  // scoping, so CS_SCOPE stays unset and the block, past its gate, would run its own jq, scope and clock.
  itLinux('S16: with no scope/ directory the gate forks nothing: the same forks as the run under history-off', () => {
    cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const forks = (): number => {
      const trace = path.join(home, 'scope-trace.txt');
      const r = spawnSync('strace', ['-f', '-o', trace, '-e', 'trace=clone,clone3,fork,vfork', 'bash', HOOK], {
        input: JSON.stringify(pre(transcript)), encoding: 'utf8', env: hookEnv(SCRUB),
      });
      expect(r.status, `strace ran the hook: ${r.stderr}`).toBe(0);
      const lines = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => l !== '');
      fs.rmSync(trace);
      const root = /^(\d+)\s/.exec(lines[0] ?? '')?.[1];
      expect(root, 'strace traced a fork').toBeDefined();
      return lines.filter((l) => new RegExp(`^${root}\\s+(?:clone3?|v?fork)\\(`).test(l)).length;
    };
    forks();                                              // WARM-UP: a first run may make state no later run repeats
    const open = forks();
    historyOff();
    expect(open, 'the block forked although scope/ is absent').toBe(forks());
    expect(fs.existsSync(histDir()), 'the hook never mkdirs').toBe(false);
  }, 60_000);

  it('S16: under compact-card-off a manual compaction is scoped by the marker itself — main <psid> <ms>', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const before = Date.now();
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    const m = read();
    expect([m.scope, m.sid]).toEqual(['main', SID]);
    expect(m.ms).toBeGreaterThanOrEqual(before - 1000);
    expect(m.ms).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('S16: the card\'s own verdict is reused — an unconsumed set inside the window makes it ambiguous', () => {
    plantScope();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    fs.writeFileSync(setFile(), '{}\n');                 // a young canonical set: the card's overlap check
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(read().scope).toBe('ambiguous');
  });

  it('S16: one live subagent beside a quiet parent is scoped subagent, on the card\'s path and under compact-card-off alike', () => {
    plantScope();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')], parentAge: DEAD,
      subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }] });
    runFull(pre(transcript, 'auto'), SCRUB);
    expect(read().scope).toBe('subagent');
    fs.rmSync(marker());
    cardOff();
    runFull(pre(transcript, 'auto'), SCRUB);
    expect(read().scope).toBe('subagent');
  });

  it('S16: scope rc 1 (no readable transcript) writes no marker', () => {
    plantScope();
    expect(runFull(pre(path.join(home, 'missing.jsonl')), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.existsSync(marker())).toBe(false);
    cardOff();                                            // the unset arm's own scope run answers rc 1 too
    expect(runFull(pre(path.join(home, 'missing.jsonl')), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('an undecided verdict empties a fresh main marker this psid left, and creates nothing where none was', () => {
    plantScope();
    fs.writeFileSync(marker(), `main ${SID} ${Date.now()}\n`);
    expect(runFull(pre(path.join(home, 'missing.jsonl')), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.readFileSync(marker(), 'utf8'), 'the earlier main marker survived an undecided compaction').toBe('');
  });

  it.skipIf(process.getuid?.() === 0)('S16: a hookstate write that fails leaves no marker and still exits 0, silent', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const reg = path.join(home, '.cc-sessions');
    fs.chmodSync(reg, 0o500);                             // root writes through 0500, so root skips this
    try {
      expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    } finally {
      fs.chmodSync(reg, 0o700);
    }
    expect(fs.existsSync(marker()), 'a marker landed although the hookstate write failed').toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('a hookstate write that fails empties an older fresh main marker, so a following SessionStart(compact) serves no line', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    plantScope(); cardOff();
    fs.writeFileSync(marker(), `main ${SID} ${Date.now()}\n`);  // an earlier main compaction's, still fresh
    fs.mkdirSync(histDir('card', ID), { recursive: true, mode: 0o700 });
    fs.writeFileSync(histDir('card', ID, `${SID}.txt`), `${lib.cardLine({ leaf: 'L03a9c1', parent: null })}\n`, { mode: 0o600 });
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const reg = path.join(home, '.cc-sessions');
    fs.chmodSync(reg, 0o500);                             // the hookstate write fails, and the tail exits there
    try {
      expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    } finally {
      fs.chmodSync(reg, 0o700);
    }
    expect(fs.readFileSync(marker(), 'utf8'), 'the older main marker survived a PreCompact that exited at its hookstate write').toBe('');
    // Once Task 9's reader exists, this is the end-to-end form: an emptied marker serves no line.
    const r = runFull({ hook_event_name: 'SessionStart', source: 'compact', cwd: home, transcript_path: path.join(home, 't.jsonl'),
      session_id: SID, prompt_id: 'p1', model: 'claude-opus-5' }, SCRUB);
    expect(r.stdout.includes('History: node '), 'a line served from an emptied marker').toBe(false);
  });

  it('S16: a CS_SCOPE exported into the pane is never read as this run\'s verdict', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')], parentAge: DEAD,
      subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }] });
    runFull(pre(transcript, 'auto'), { ...SCRUB, CS_SCOPE: 'main' });
    expect(read().scope).toBe('subagent');
  });

  it('S2 (marker half): a payload with agent_id writes no marker', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    runFull(pre(transcript, 'manual', { agent_id: 'agent-7' }), SCRUB);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('S3 (marker half): history-off present writes no marker', () => {
    plantScope(); cardOff(); historyOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('S8 (marker half): under history-off a PreCompact writes no marker while a SessionStart(clear) still spools its epoch line', () => {
    plantScope(); cardOff(); historyOff();
    fs.mkdirSync(histDir('spool'), { recursive: true, mode: 0o700 });
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    runFull(pre(transcript), SCRUB);
    expect(fs.existsSync(marker())).toBe(false);
    runFull({ hook_event_name: 'SessionStart', source: 'clear', session_id: SID }, SCRUB);
    expect(fs.readFileSync(histDir('spool', `${ID}.jsonl`), 'utf8')).toContain('"ev":"SessionStart"');
  });

  it('the id bound is SPOOL_ID_MAX: a 224-char id is marked, a 225-char id is not', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const fits = longId(lib.SPOOL_ID_MAX);
    runFull(pre(transcript), SCRUB);
    expect(read(fits).scope).toBe('main');
    const over = longId(lib.SPOOL_ID_MAX + 1);
    runFull(pre(transcript), SCRUB);
    expect(fs.existsSync(marker(over))).toBe(false);
  });

  it('an id of . or .. names a directory, so no marker can land and nothing outside scope/ changes', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    for (const id of ['.', '..']) {
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
      expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    }
    expect(fs.readdirSync(scopeDir())).toEqual([]);
    expect(fs.readdirSync(histDir()).sort()).toEqual(['scope']);
  });

  it('a session_id that is not a lowercase UUID writes no marker', () => {
    plantScope(); cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    runFull(pre(transcript, 'manual', { session_id: 'sess-1' }), SCRUB);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('a symlink where the marker goes is left alone, and its target is never written', () => {
    plantScope(); cardOff();
    const target = path.join(home, 'elsewhere.txt');
    fs.writeFileSync(target, 'keep\n');
    fs.symlinkSync(target, marker());
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.readFileSync(target, 'utf8')).toBe('keep\n');
    expect(fs.lstatSync(marker()).isSymbolicLink()).toBe(true);
  });

  // B1's F24 rows, for the marker (spec §5.1 and S16; B1's D-4418 rule, ruled R-B3-fifo). A
  // FIFO already standing at scope/<id> passes a test that keeps only `! -L`, and the `>` open then blocks with no
  // reader, so the run is bounded: a blocked hook is killed at the deadline, never left to hang the suite.
  const runBounded = (payload: object): ReturnType<typeof spawnSync> => spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', env: hookEnv(SCRUB),
  });

  it('a FIFO where the marker goes writes no marker and never blocks: exit 0, silent, the FIFO left as it was', () => {
    plantScope(); cardOff();
    execFileSync('mkfifo', [marker()]);
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    const r = runBounded(pre(transcript));
    expect(r.signal, 'the hook blocked opening the FIFO and was killed at the deadline').toBeNull();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(fs.lstatSync(marker()).isFIFO()).toBe(true);
  }, 30_000);

  it('a symlinked scope/ is neither written nor truncated through', () => {
    fs.mkdirSync(histDir(), { recursive: true, mode: 0o700 });
    const elsewhere = path.join(home, 'elsewhere');
    fs.mkdirSync(elsewhere, { mode: 0o700 });
    fs.symlinkSync(elsewhere, scopeDir());
    cardOff();
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.readdirSync(elsewhere), 'the block wrote a marker through a symlinked scope/').toEqual([]);
    fs.writeFileSync(path.join(elsewhere, ID), 'keep\n');
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect(fs.readFileSync(path.join(elsewhere, ID), 'utf8'), 'a file behind a symlinked scope/ was truncated or overwritten').toBe('keep\n');
  });

  it('CONTROL: an existing regular marker is replaced by this run\'s decided verdict', () => {
    plantScope(); cardOff();
    fs.writeFileSync(marker(), `subagent ${SID} ${Date.now() - 60_000}\n`);
    const { transcript } = plantSession({ sid: SID, lines: [tl.user('x')] });
    expect(runFull(pre(transcript), SCRUB)).toEqual({ stdout: '', stderr: '' });
    expect([read().scope, read().sid]).toEqual(['main', SID]);
  });

  it('the block sits after the card\'s call and before PostCompact\'s, and its gate forks nothing', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    const open = src.indexOf('# >>> history-scope (spec 2026-10-05 §5.1)');
    const close = src.indexOf('# <<< history-scope');
    const preCall = src.indexOf('if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi');
    expect(open, 'no history-scope block').toBeGreaterThan(-1);
    expect(src.indexOf('# >>> history-scope', open + 1), 'two history-scope blocks').toBe(-1);
    expect(open, 'the marker must follow the card, whose verdict it reuses').toBeGreaterThan(preCall);
    expect(close).toBeLessThan(src.indexOf('if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi'));
    expect(src.split('\n').filter((l) => l === 'unset CS_SCOPE'), 'CS_SCOPE is unset once').toHaveLength(1);
    expect(src, 'unset directly above the card\'s call').toContain(
      'unset CS_SCOPE\nif [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi');
    const gate = src.slice(open, close).split('\n').find((l) => l.startsWith('if [[ "$event" == PreCompact && -z "$paid" ]]'));
    expect(gate, 'the gate line').toBeDefined();
    expect(gate!.slice(0, gate!.indexOf('; then')), 'the gate forks').not.toMatch(/\$\(|`/);
    // The early invalidation: below the event case, above every tail exit, builtin-only.
    const early = src.split('\n').filter((l) => l.startsWith('[[ "$event" == PreCompact && -z "$paid" ]] && [[ -f '));
    expect(early, 'one early invalidation line').toHaveLength(1);
    const at = src.indexOf(`\n${early[0]!}\n`);
    expect(at, 'below the event case').toBeGreaterThan(src.indexOf('\nesac\n'));
    expect(at, 'above the hookstate compose and every exit after it').toBeLessThan(src.indexOf('\nout=$(jq -cn'));
    expect(early[0], 'the invalidation forks').not.toMatch(/\$\(|`/);
    // B1's S1 form (its FR2a): a `${…@…}` transformation forks too, since `@P` runs prompt expansion and so command
    // substitution. The early line, the gate and `_hook_history_scope`'s body spell none (past the gates the body may
    // fork, but only by the forms its comment names: one jq, the scope rule, the clock).
    const fnAt = src.indexOf('\n_hook_history_scope() {');
    expect(fnAt, 'no _hook_history_scope definition').toBeGreaterThan(-1);
    const fnCode = src.slice(fnAt, src.indexOf('\n}\n', fnAt)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(`${early[0]!}\n${gate!}\n${fnCode}`.match(/\$\{[^}]*@/)?.[0] ?? null, 'a ${…@…} transformation in the marker lines (@P forks)').toBeNull();
    // B1's D-4418 rule (spec §5.1): the type test is the line DIRECTLY above the write,
    // so nothing but builtins runs between the test and the `>`; the gate and the early line refuse a symlinked scope/.
    const fnLines = fnCode.split('\n');
    const w = fnLines.findIndex((l) => l.includes('> "$f"; } 2>/dev/null'));
    expect(w, 'no marker write').toBeGreaterThan(0);
    expect(fnLines[w - 1]!.trim(), 'the regular-file test sits directly above the write, builtins only')
      .toBe('[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0');
    // Either spelling of the directory: Task 9 re-points these lines to its HISTORY_SCOPE_DIR constant.
    const notLinkedScope = /&& ! -L "(?:\$HOME\/\.ccrc\/history\/scope|\$HISTORY_SCOPE_DIR)" \]\]/;
    expect(gate, 'the gate refuses a symlinked scope/').toMatch(notLinkedScope);
    expect(early[0], 'the early line refuses a symlinked scope/').toMatch(notLinkedScope);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history scope marker')
```

Expected on Linux as a non-root user: `9 failed | 12 passed` among the describe's 21 cases (root skips the two hookstate cases; Darwin has no strace case):
- `S16: under compact-card-off a manual compaction is scoped by the marker itself …`, `S16: the card's own verdict is reused …`, `S16: one live subagent beside a quiet parent …`, `S16: a CS_SCOPE exported into the pane …` and `the id bound is SPOOL_ID_MAX …` each fail with `ENOENT: no such file or directory, open '…/.ccrc/history/scope/demo-quiet-basin'` (or the 224-char id's name);
- `an undecided verdict empties a fresh main marker …` fails with `the earlier main marker survived an undecided compaction: expected 'main 7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d…' to be ''`;
- `a hookstate write that fails empties an older fresh main marker …` fails with `the older main marker survived a PreCompact that exited at its hookstate write: expected 'main 7d0c3f5e-…' to be ''`;
- `CONTROL: an existing regular marker is replaced …` fails with `expected [ 'subagent', '7d0c3f5e-…' ] to deeply equal [ 'main', '7d0c3f5e-…' ]` (nothing replaces the planted marker yet);
- `the block sits after the card's call …` fails with `no history-scope block: expected -1 to be greater than -1`.

The twelve that pass assert an absence the hook cannot yet violate: no scope directory, its fork count, scope rc 1, the failed hookstate write with no earlier marker, S2, S3, S8, ids `.` and `..`, a non-UUID psid, a symlink, a FIFO at the marker's path (nothing opens it yet), and a symlinked `scope/`. Step 6's mutants are what measure them, except `.` and `..`, which no guard serves (this task's second choice).

- [ ] **Step 4: Insert the marker.** In `ccd/session-hook.sh`, directly below the line `esac` that closes `case "$event" in` (Step 1's awk names it), insert these eight lines. The capture arm's comment, which follows `esac` today, then follows them:

```bash
# THE HISTORY SCOPE MARKER, FAIL-CLOSED (ccrc history spec 2026-10-05 §5.1,
# W1-B3): a main-thread PreCompact empties this id's existing marker HERE, before
# any exit below can run, and the `history-scope` block after the compaction
# card's call writes only a decided verdict. So a hookstate write or a jq that
# fails, or a verdict nobody reached, leaves an EMPTY marker, never an older
# fresh `main` one for a subagent (spec §5.1, "The early truncation").
# Builtins only; no file is made; only a regular non-link file in a non-link scope/.
[[ "$event" == PreCompact && -z "$paid" ]] && [[ -f "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope" ]] && { : > "$HOME/.ccrc/history/scope/$id"; } 2>/dev/null
```

Then, directly above the line `if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi`, insert these five lines:

```bash
# `CS_SCOPE` is the compaction card's scope verdict, a plain global with no
# initialiser. It is unset here, every run, so the history scope marker below
# reads only a verdict THIS run reached, never one exported into the pane
# (the `hcat` reset's reasoning).
unset CS_SCOPE
```

Directly below that same line, and above `if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi`, insert the block:

```bash
# >>> history-scope (spec 2026-10-05 §5.1)
# THE PRECOMPACT SCOPE MARKER (ccrc history spec 2026-10-05 §5.1, W1-B3):
# ~/.ccrc/history/scope/<id> holds one line, `<scope> <psid> <ms>` (at most 64
# bytes), which the SessionStart(compact) history card reads so its line reaches
# a MAIN compaction only. A compacting subagent fires this hook with the
# parent's session_id and no agent key, so this word is the one thing that
# keeps the card line out of a subagent's context
# (D-4747 (history-card-main-scope-only)).
#
# HERE, after `_hook_compact_pre`, because the card's verdict is reused
# (D-4746 (history-scope-marker-after-card)). `CS_SCOPE` has no initialiser and this
# file is `set -u`, so it is read only as `${CS_SCOPE+x}` / `${CS_SCOPE-}`:
#   set, non-empty: the card's scope step ran, and its word is the marker's,
#                   the card's overlap `ambiguous` included;
#   set, empty:     scope answered rc 1, and nothing may be said;
#   unset:          the card returned before scoping (compact-card-off, or a
#                   failed payload read), so this block parses the payload and
#                   runs `_hook_compact_scope` itself: the plain scope rule
#                   decides, independent of compact-card-off.
# `CS_SCOPE` is unset directly above the card's call, so a value exported into
# the pane can never stand in for a verdict this run did not reach.
#
# AN UNDECIDED VERDICT WRITES NOTHING, AND THE MARKER IS ALREADY EMPTY: the
# line directly below the event `case` emptied this id's existing marker on
# this main-thread PreCompact, before any exit above could run
# (spec §5.1, "The early truncation"). So a fresh `main` line an
# earlier compaction of this psid wrote can never serve this one.
#
# GATES, builtins first and before any fork: PreCompact, the main thread
# (`$paid`), the scope directory the sweep made, a real directory and never a
# symlink (the hook never mkdirs; only db/ may link out of the history root),
# and history-off absent. Then the id's bound (SPOOL_ID_MAX, as the spool block's;
# `.` and `..` need no test of their own, since under scope/ they name
# directories, which no write can open) and a lowercase-UUID psid (the card file
# is keyed on it).
#
# A REGULAR FILE OR NOTHING, as the spool block's append (its D-4418 rule;
# spec §5.1): the line DIRECTLY above the write
# refuses a symlink, dangling or not, a FIFO and any other node, so a FIFO that
# stands at scope/<id> when the test runs never blocks the `>` open. The tests
# are builtin, here and on the early line below the event `case`, and bash has
# no O_NOFOLLOW or O_NONBLOCK redirection, so what is left is a node swapped in
# AFTER the test: it is opened, a link followed, a FIFO blocking until Claude
# Code kills the hook (install-session-hooks.sh HOOK_TIMEOUT_S).
#
# PreCompact is off the hot path, so past the gates this block may
# fork (one jq on the unset arm, the scope rule's finds, the clock). Every
# redirection is under `{ …; } 2>/dev/null`, so nothing reaches stdout or
# stderr. A hookstate write or a jq compose that fails exits above, after the
# early line emptied any older marker, so it leaves an empty marker or none:
# the fail-closed direction.
_hook_history_scope() {   # -> scope/<id> = "<scope> <psid> <ms>" when decided; silent
  local f="$HOME/.ccrc/history/scope/$id" scope="" ms="" tp="" trig=""
  (( ${#id} <= 224 )) || return 0
  [[ "$psid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 0
  if [[ -z "${CS_SCOPE+x}" ]]; then
    { read -r tp; read -r trig; } < <(jq -r '(.transcript_path // "" | tostring), (.trigger // "auto" | tostring)' <<<"$payload" 2>/dev/null)
    _hook_compact_scope "$tp" "$trig" || true
  fi
  scope="${CS_SCOPE-}"
  [[ -n "$scope" ]] || return 0
  ms=$(_hook_epoch_ms)
  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0
  { printf '%s %s %s\n' "$scope" "$psid" "$ms" > "$f"; } 2>/dev/null
  return 0
}
if [[ "$event" == PreCompact && -z "$paid" ]] && [[ -d "$HOME/.ccrc/history/scope" && ! -L "$HOME/.ccrc/history/scope" ]] && [[ ! -e "$HOME/.ccrc/history-off" ]]; then _hook_history_scope || true; fi
# <<< history-scope
```

Then check it:

```bash
bash -n ccd/session-hook.sh && echo hook-syntax-ok
grep -c '^_hook_history_scope() {' ccd/session-hook.sh
grep -cF '$HOME/.ccrc/history/scope' ccd/session-hook.sh
awk '/^esac$/ && !e {e=NR} /history\/scope\/\$id" && ! -L/ {print NR - e}' ccd/session-hook.sh
```

Expected: `hook-syntax-ok`, then `1`, then `3` (the early line, the block's `local f=` and its gate), then `8`: the early line is the eighth after the event case's `esac`.

- [ ] **Step 5: Run the cases and the fork pins, and see them pass.** In the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history scope marker')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'first held section forks|the helper runs through')
```

Expected:
- the first run: all 21 cases green on Linux as a non-root user (19 under root; 20 on Darwin);
- the second: `6 passed`, the strace describe's five and the `:2721` argv case (` --max-chars 4000 --max-files 12 `). The strace multisets stay exact, `{ '(subshell)': 1, find: 2, jq: 1, link: 1, mv: 1, rm: 1 }` and the AMBIGUOUS run's `rm: 2` among them. The AMBIGUOUS window runs to the END of the trace, past this block. Its fixture has no `scope/` directory, so the early line's file test and the block's builtin gate both fail before any fork. (That run's psid is `sess-1`, so it could not see the gate's forks anyway; this describe's own strace case is the one that measures the `scope/` gate.)

`session-hook.test.ts` is a known load-flake file. Re-run a red that is not one of these cases alone before calling it a break.

- [ ] **Step 6: Measure every guard red with a mutant.** Write the runner. It is a gitignored scratch tool, never committed, and Tasks 9 to 11 use it too. It is the second runner in this plan: Task 1's `mutate.mjs` serves Tasks 1 to 7, whose mutants are JSON. Both keep their pristine copies in `scratch/keep/`, each named by its file's repo-relative path with `/` written as `__` (`keep/ccd__session-hook.sh.orig`), so one restore loop, `mutate.mjs`'s header line, serves either runner's leftovers. Each refuses to start while a copy is left there, so never run the two at once. From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
cat > "$SCRATCH/mutate.py" <<'PYEOF'
#!/usr/bin/env python3
"""mutate.py <mutants.py> [name ...]: each guard measured RED with it mutated, then GREEN restored (W1-B3).

<mutants.py> defines MUTANTS, a list of (name, file, test, filter, edits), where edits is a list of
(old, new) pairs: each `old` must occur exactly once in `file` as the earlier edits leave it, and an
`old` of None appends `new` at the end of the file. Per
mutant: copy `file` to keep/, apply the edits, run `vitest run <test> -t <filter>` from server/ (it must
report a failed test), restore the copy byte for byte, run again (it must pass with none failed).
Given names, only those mutants run. The pristine copy is keep/<file with '/' as '__'>.orig, the name
mutate.mjs gives its own copies. A run killed mid-mutant leaves it there, and the next run refuses until it
is restored by hand, from the repository root:
  for f in .superpowers/sdd/history-w1-b3/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
"""
import os, re, runpy, shutil, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
keep = os.path.join(here, 'keep')
os.makedirs(keep, exist_ok=True)
assert not os.listdir(keep), f'{keep} holds a copy from a run that died: restore it first'
def tests_line(test, filt):
    r = subprocess.run(['./node_modules/.bin/vitest', 'run', test, '-t', filt],
                       cwd='server', capture_output=True, text=True, timeout=900)
    lines = [l.strip() for l in r.stdout.splitlines() if re.match(r'^\s+Tests\s', l)]
    return r.returncode, (lines[-1] if lines else 'no Tests line')
only = set(sys.argv[2:])
bad = 0
for name, path, test, filt, edits in runpy.run_path(sys.argv[1])['MUTANTS']:
    if only and name not in only:
        continue
    src = open(path, encoding='utf8').read()
    text = src
    for old, new in edits:
        if old is None:
            text += new
            continue
        if text.count(old) != 1:
            sys.exit(f'{name}: an anchor occurs {text.count(old)} times in {path}; fix the row, nothing was mutated')
        text = text.replace(old, new)
    copy = os.path.join(keep, path.replace('/', '__') + '.orig')
    shutil.copyfile(path, copy)
    try:
        open(path, 'w', encoding='utf8').write(text)
        rc, red = tests_line(test, filt)
    finally:
        shutil.copyfile(copy, path)
        os.remove(copy)
    assert open(path, encoding='utf8').read() == src, f'{path} was not restored byte for byte'
    rc2, green = tests_line(test, filt)
    ok = rc != 0 and ' failed' in red and rc2 == 0 and ' passed' in green and ' failed' not in green
    print(f"{'RED->GREEN  ' if ok else 'NOT MEASURED'} {name}\n    mutated:  {red}\n    restored: {green}")
    bad += 0 if ok else 1
sys.exit(1 if bad else 0)
PYEOF
```

Write this task's mutants:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
cat > "$SCRATCH/mutants-t8.py" <<'PYEOF'
# Task 8's mutants (W1-B3): each names the guard it deletes or inverts, and the case that must go red.
H, T = 'ccd/session-hook.sh', 'test/session-hook.test.ts'
MUTANTS = [
    ('T8-M1-paid', H, T, 'S2 \\(marker half\\)', [
        (r'''if [[ "$event" == PreCompact && -z "$paid" ]] && [[ -d''', r'''if [[ "$event" == PreCompact ]] && [[ -d''')]),
    ('T8-M2-history-off', H, T, 'S3 \\(marker half\\)|S8 \\(marker half\\)', [
        (r''' && [[ ! -e "$HOME/.ccrc/history-off" ]]; then _hook_history_scope''', r'''; then _hook_history_scope''')]),
    ('T8-M3-bare-CS_SCOPE', H, T, 'scoped by the marker itself', [
        (r'''  if [[ -z "${CS_SCOPE+x}" ]]; then''', r'''  if [[ -z "$CS_SCOPE" ]]; then''')]),
    ('T8-M4-no-unset', H, T, 'exported into the pane', [
        ('unset CS_SCOPE\nif [[ "$event" == PreCompact  ]]', 'if [[ "$event" == PreCompact  ]]')]),
    ('T8-M5-no-early-invalidation', H, T, 'empties a fresh main marker|empties an older fresh main marker', [
        (r'''[[ "$event" == PreCompact && -z "$paid" ]] && [[ -f "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope" ]] && { : > "$HOME/.ccrc/history/scope/$id"; } 2>/dev/null''' + '\n', '')]),
    ('T8-M6-id-bound', H, T, 'the id bound is SPOOL_ID_MAX: a 224-char id is marked', [
        ('  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ ^', '  [[ "$psid" =~ ^')]),
    ('T8-M7-psid-grammar', H, T, 'not a lowercase UUID writes no marker', [
        ('  [[ "$psid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 0\n  if [[ -z "${CS_SCOPE+x}" ]]; then', '  if [[ -z "${CS_SCOPE+x}" ]]; then')]),
    ('T8-M8-symlink', H, T, 'a symlink where the marker goes', [
        (r'''  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0''', r'''  [[ -f "$f" || ! -e "$f" ]] || return 0''')]),
    ('T8-M9-hookstate-not-fatal', H, T, 'hookstate write that fails leaves no marker', [
        (r'''{ printf '%s\n' "$out" > "$tmp"; } 2>/dev/null || { rm -f "$tmp"; exit 0; }''', r'''{ printf '%s\n' "$out" > "$tmp"; } 2>/dev/null || rm -f "$tmp"'''),
        (r'''mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp"; exit 0; }''', r'''mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"''')]),
    ('T8-M10-fork-before-gate', H, T, 'the AMBIGUOUS run forks', [
        (r'''if [[ "$event" == PreCompact && -z "$paid" ]] && [[ -d''', '_hm_probe=$(_hook_epoch_ms)\n' + r'''if [[ "$event" == PreCompact && -z "$paid" ]] && [[ -d''')]),
    ('T8-M11-empty-scope-as-main', H, T, 'scope rc 1|empties a fresh main marker', [
        (r'''  scope="${CS_SCOPE-}"''', r'''  scope="${CS_SCOPE:-main}"''')]),
    ('T8-M12-no-scope-dir-gate', H, T, 'with no scope/ directory the gate forks nothing', [
        (r''' && [[ -d "$HOME/.ccrc/history/scope" && ! -L "$HOME/.ccrc/history/scope" ]] && [[ ! -e''', r''' && [[ ! -e''')]),
    ('T8-M13-transformation', H, T, "the block sits after the card's call", [
        (r'''  scope="${CS_SCOPE-}"''', r'''  scope="${CS_SCOPE-}"; scope="${scope@P}"''')]),
    # spec §5.1's regular-file gate (B1's D-4418 rule, ruled R-B3-fifo):
    ('T8-M14-fifo-only-not-link', H, T, 'a FIFO where the marker goes', [
        (r'''  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0''', r'''  [[ ! -L "$f" ]] || return 0''')]),
    ('T8-M15-scope-dir-link-gate', H, T, 'a symlinked scope/ is neither', [
        (r'''[[ -d "$HOME/.ccrc/history/scope" && ! -L "$HOME/.ccrc/history/scope" ]]''', r'''[[ -d "$HOME/.ccrc/history/scope" ]]''')]),
    ('T8-M16-early-scope-dir-link', H, T, 'a symlinked scope/ is neither', [
        (r''' && ! -L "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope" ]] && { :''', r''' && ! -L "$HOME/.ccrc/history/scope/$id" ]] && { :''')]),
    ('T8-M17-absent-only', H, T, 'CONTROL: an existing regular marker', [
        (r'''  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0''', r'''  [[ ! -L "$f" && ! -e "$f" ]] || return 0''')]),
    ('T8-M18-type-test-not-adjacent', H, T, "the block sits after the card's call", [
        ('  ms=$(_hook_epoch_ms)\n  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0\n',
         '  [[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0\n  ms=$(_hook_epoch_ms)\n')]),
]
PYEOF
```

Run them in the foreground, with a timeout of at least 3600000 ms (eighteen mutants, two vitest runs each):

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
python3 "$SCRATCH/mutate.py" "$SCRATCH/mutants-t8.py"; echo "rc=$?"
git status --short
```

Expected: eighteen `RED->GREEN` lines, then `rc=0`, then `git status` lists only `ccd/session-hook.sh` and `server/test/session-hook.test.ts` as modified. Each mutant and its red, as measured on a prototype of this exact text for T8-M1 to T8-M4 and T8-M6 to T8-M10; T8-M5's target line, T8-M11, T8-M12 and T8-M13 (the B1 re-check's `${…@…}` form) were added after the prototype, and their reds below are argued from the code. T8-M14 to T8-M18 came with ruling R-B3-fifo, which also moved T8-M5's, T8-M7's, T8-M8's and T8-M12's anchors; their reds through vitest are predicted, not measured on the hook. What was measured is this step's own text: Step 4's three insertions, extracted from this plan with `_hook_compact_pre`, `_hook_compact_scope` and `_hook_epoch_ms` stubbed, every T8 anchor found exactly once in them, and T8-M8 and T8-M14 to T8-M18 applied and run under `timeout 3` against the cases' shapes. Unmutated: a FIFO at the marker's path returns at once and stays a FIFO; a symlinked `scope/` and a regular file behind it are left untouched; a regular marker is replaced by `main <psid> <ms>`; a link to a regular file is not followed. T8-M14 blocks on the FIFO (rc 124); T8-M15 writes `demo` behind the symlinked `scope/`; T8-M16 empties the file behind it; T8-M17 leaves the CONTROL's marker empty; T8-M8 writes through the link; T8-M18 changes no behaviour (its red is the source pin's). A `NOT MEASURED` on any of these is reported with the case's output:

| Mutant | Guard removed | The case that goes red, and how |
|---|---|---|
| T8-M1-paid | `-z "$paid"` in the gate | S2 (marker half): `expected true to be false` |
| T8-M2-history-off | the history-off test in the gate | S3 and S8 (marker halves): `expected true to be false`, twice |
| T8-M3-bare-CS_SCOPE | `${CS_SCOPE+x}` read bare, as `$CS_SCOPE` | the compact-card-off case: `the hook contract: exit 0 on every path: expected 1 to be +0` (the `set -u` abort) |
| T8-M4-no-unset | `unset CS_SCOPE` | the exported-CS_SCOPE case: `expected 'main' to be 'subagent'` |
| T8-M5-no-early-invalidation | the early invalidation below `esac` | the undecided case (`the earlier main marker survived an undecided compaction`) and the failed-hookstate case with an earlier marker (`the older main marker survived a PreCompact that exited at its hookstate write`) |
| T8-M6-id-bound | `(( ${#id} <= 224 ))` | the id-bound case: `expected true to be false` |
| T8-M7-psid-grammar | the psid UUID test | the non-UUID case: `expected true to be false` |
| T8-M8-symlink | the `! -L "$f"` half of the regular-file test above the write (the test keeps `-f "$f" \|\| ! -e "$f"`, which a link to a regular file passes) | the symlink case: `expected 'main 7d0c…' to be 'keep\n'` |
| T8-M9-hookstate-not-fatal | the two `exit 0`s of a failed hookstate write | `a marker landed although the hookstate write failed` |
| T8-M10-fork-before-gate | a fork added above the gate | the strace AMBIGUOUS run: `expected { '(subshell)': 2, … } to deeply equal { '(subshell)': 1, … }` |
| T8-M11-empty-scope-as-main | an empty verdict read as `main` (`${CS_SCOPE:-main}`) | scope rc 1: `expected true to be false` (a `main` marker lands); the undecided case: `expected 'main …' to be ''` |
| T8-M12-no-scope-dir-gate | `[[ -d … scope ]]` in the gate | the new strace case: `the block forked although scope/ is absent` (the block's jq, scope finds and clock run, and its write fails silently into the missing directory) |
| T8-M13-transformation | none: it ADDS `; scope="${scope@P}"` to `_hook_history_scope`'s verdict line, a `${…@…}` transformation (`@P` runs prompt expansion, so command substitution) | the source pin: `a ${…@…} transformation in the marker lines (@P forks): expected '${scope@' to be null` |
| T8-M14-fifo-only-not-link | the regular-file half of the test above the write: only `[[ ! -L "$f" ]]` is kept (spec S18's CONTROL shape for the spool, applied to the marker) | the FIFO case (predicted): the `>` open blocks with no reader, the 10 s deadline kills the hook, `the hook blocked opening the FIFO and was killed at the deadline: expected 'SIGKILL' to be null` |
| T8-M15-scope-dir-link-gate | `! -L` on `scope/` in the block's gate | the symlinked-`scope/` case (predicted): `-d` follows the link, so the block writes `elsewhere/demo-quiet-basin`: `the block wrote a marker through a symlinked scope/: expected [ 'demo-quiet-basin' ] to deeply equal []` |
| T8-M16-early-scope-dir-link | `! -L` on `scope/` in the early truncation | the symlinked-`scope/` case's second run (predicted): `-f` follows the directory link, so the early line empties the file behind it: `a file behind a symlinked scope/ was truncated or overwritten: expected '' to be 'keep\n'` |
| T8-M17-absent-only | the test made absent-only (`[[ ! -L "$f" && ! -e "$f" ]]`), refusing the regular file the CONTROL needs written | the CONTROL (predicted): the early line empties the planted marker and the block refuses to write it, so `read()` finds no line: `one line: expected false to be true` |
| T8-M18-type-test-not-adjacent | the test moved above the clock's `ms=$(_hook_epoch_ms)`, so a fork stands between the test and the `>` | the source pin (predicted): `the regular-file test sits directly above the write, builtins only: expected 'ms=$(_hook_epoch_ms)' to be '[[ ! -L "$f" && ( -f "$f" \|\| ! -e "$f" ) ]] \|\| return 0'` |

A `NOT MEASURED` row means its case passed with the guard gone. The case is then wrong: fix the case, never the mutant. A run killed mid-mutant leaves `keep/<file with / as __>.orig`, and the runner refuses to start until it is restored with the loop its docstring gives (the same loop as `mutate.mjs`'s header). Never use `git stash`.

C37's `empty` marker and S16's `no scope/ directory → no marker` stay as absence pins: the first is Task 9's (refused by two guards at once), and the second cannot see its gate, which T8-M12 measures through the strace case instead.

- [ ] **Step 7: Re-measure the S6-R11 census.** The block sits below every corpus anchor, so the forecast is zero movement. Measure it rather than trust it. Extract the instrument by its docstring: it is the landing-order wave-1 plan's `cite-remeasure.py`, the child-reclamation tool with a `--files` argument. It runs over this task's uncommitted edits, and it keeps their only other copy in memory: its base leg overwrites each `--files` path with `HEAD`'s text, and both legs rewrite `server/test/session-hook.test.ts` with probe lines naming an absolute scratch path, restoring all of them in a `finally` that a SIGKILL (a pane-scope OOM) skips. So it is run only through `cite-run.sh`, written here, which copies every file the instrument touches to `scratch/keep-cite/` first, refuses to start while a copy is left there, and removes the copies only after `cmp` shows the tree matches them. Tasks 9 to 11 use it too. (The pre-push hook, which refuses identity residue, is the backstop against a probe line reaching a push.) From the repository root, with nothing uncommitted beyond this task's two files:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
[ -f "$SCRATCH/cite-remeasure.py" ] || python3 - "$SCRATCH/cite-remeasure.py" <<'PYEOF'
import re, sys
plan = open('docs/superpowers/plans/2026-09-24-landing-order-wave1-absorb-rules-and-advisory.md', encoding='utf8').read()
hits = [b for b in re.findall(r'^```python\n(.*?)^```$', plan, flags=re.S | re.M)
        if "Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT" in b]
assert len(hits) == 1, f'expected one instrument block, found {len(hits)}'
open(sys.argv[1], 'w', encoding='utf8').write(hits[0])
PYEOF
cat > "$SCRATCH/cite-run.sh" <<'SHEOF'
#!/usr/bin/env bash
# cite-run.sh <files,csv>: runs cite-remeasure.py against HEAD over this tree's uncommitted edits, with every file
# the instrument touches copied to keep-cite/ first (W1-B3). The instrument swaps each --files path to HEAD for its
# base leg and probes server/test/session-hook.test.ts, keeping the originals only in memory, so a SIGKILL would
# lose the edits or leave the test file probed. The run refuses while a copy is left; the copies go only after cmp
# shows the tree matches them. To restore by hand, from the repository root:
#   for f in .superpowers/sdd/history-w1-b3/scratch/keep-cite/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
set -uo pipefail
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
KC="$SCRATCH/keep-cite"
mkdir -p "$KC"
if [ -n "$(ls -A "$KC")" ]; then echo "REFUSED: $KC holds copies from a run that died; restore them as this file's header says"; exit 1; fi
IFS=, read -r -a files <<<"$1"
for f in "${files[@]}" server/test/session-hook.test.ts; do cp -p "$f" "$KC/${f//\//__}.orig" || exit 1; done
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files "$1"; rc=$?
bad=0
for c in "$KC"/*.orig; do
  t="$(basename "$c" .orig)"; t="${t//__//}"
  cmp -s "$c" "$t" || { echo "NOT RESTORED: $t (restore: cp $c $t)"; bad=1; }
done
if [ "$bad" = 0 ]; then rm -f "$KC"/*.orig; echo 'keep-cite: the tree matches its copies; copies removed'; fi
exit $(( rc != 0 ? rc : bad ))
SHEOF
bash "$SCRATCH/cite-run.sh" ccd/session-hook.sh,README.md
```

Expected:
- the first line reads `files swapped to HEAD: ccd/session-hook.sh, README.md`, and the last `keep-cite: the tree matches its copies; copies removed`;
- every `byFile[…]` line reads `stated N  base N  tree N`, with no `<-- MOVED or unstated`, at the values B3's base carries (trust the printed `stated`; this plan quotes no number, because B1's, B2's and other programmes' merges can move them);
- `total` reads three equal numbers;
- `ENTERED []` and `LEFT    []` for the composition, the row array and the site array.

The scratch argument must be an absolute path (`cite-run.sh` passes one): a relative one fails with `FileNotFoundError` on `byfile.json`. If any `base` differs from its `stated`, the tree was red before this task: stop and report it. If anything moved, the insertion landed above an anchor: move the insertion. Never pass `--write`. If `cite-run.sh` prints `REFUSED` or `NOT RESTORED`, restore from `keep-cite/` with the loop in its header before anything else. Then run the citation cases and the hook's structural suites, each in the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/install-session-hooks.test.ts test/macos-platform.test.ts)
```

Expected: `7 passed` for the first (only the passed count is pinned; the skipped count grows with every appended describe), and every file green for the second. `install-session-hooks` derives the wired event set from the first `case "$event" in` block, which ends at the `esac` the early line follows, so the block is untouched. `macos-platform` scans the hook for GNU-only spellings, and the new lines have none.

- [ ] **Step 8: Confirm the scratch copies are gone, then commit.** First, in its own call:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
test -z "$(ls -A "$SCRATCH/keep" 2>/dev/null)" && test -z "$(ls -A "$SCRATCH/keep-cite" 2>/dev/null)" && echo RESTORED
```

It must print `RESTORED`. On anything else, stop and restore with the loop in `mutate.py`'s docstring or `cite-run.sh`'s header. Only then, in a separate call, on this workspace's branch:

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(history): the PreCompact scope marker (W1-B3 task 8)

After the compaction card's own PreCompact arm, the hook writes
~/.ccrc/history/scope/<id> = '<scope> <psid> <ms>'. It reuses the card's
CS_SCOPE verdict when the card scoped, and runs the scope rule itself when
it did not (compact-card-off). Directly below the event case, before any
tail exit, a main-thread PreCompact empties the id's older marker, so an
undecided verdict or a failed hookstate write leaves it empty. Gated with
builtins on PreCompact, the main thread, a scope directory that is no
symlink and history-off; the marker is written or emptied only when it is
a regular non-link file or absent, so a planted FIFO never blocks the hook.
CS_SCOPE is unset before the card's call. Tail only: the S6-R11
census does not move."
```

### Task 9: Hook: `_hook_history_card` above the arm, the `:2893` call, README's `:2900` re-anchor, and the one S6-R11 census re-measure

**Files:**
- Modify: `ccd/session-hook.sh`:
  - Insert the reader block directly above the line that begins `state="" ask_json=`. That line is `:2770` at f7e51156f, where it ends `hts="" msid=""`; origin/main 9a255a746 appends ` sessend=""`, so anchor on the prefix. The two lines above it are `[[ -n "$event" ]] || exit 0` and a blank line, and the blank line stays. The block is 122 lines followed by one new blank line, 123 lines in all (95 before ruling RC4 widened its recall-off read by six lines; 101 before the re-check against B1's final code read the clock once, one line, and named the swap residue and the one-read rule in the header, four lines; 106 before ruling R-recalloff-parity added the generation record's read, six code lines, and its header sentence, five; 117 before coordinator ruling R-recalloff-trim added the recall-off grammar test, one code line, and its header sentence, five, and made the trim ASCII-only in place). It is the ONE insertion above README's anchor this PR makes. Nothing in the spec or the plan cites a hook line between the highest corpus anchor (`:2472`) and this one.
  - In place, line-neutral: `    [[ "$src" == compact ]] && { _hook_compact_card || true; }` (`:2893` at f7e51156f and at origin/main) becomes `    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }`.
  - In place, in Task 8's lines in the tail: the three lines that spell `"$HOME/.ccrc/history/scope"` (the block's `local f=…` and its gate, and the early invalidation below `esac`) spell `"$HISTORY_SCOPE_DIR"` instead.
  - The turn-marker note's last line is extended and gains five lines after it. That line is the only one matching `^# that line \(marker-logic-in-the-tail \(D-[0-9]+\)\)\.$` (`:2945` at f7e51156f, `:2946` at origin/main); this plan quotes it as a pattern because it writes no deviation number. The note's existing text, its deviation number included, stays verbatim.
  - In B1's history-spool block, the comment line `# it is in the tail because nothing new may land above :2900.` is reworded into two lines.
  - All of the last three edits are below README's anchor.
- Modify: `README.md`, in place and line-neutral: the line number in `` (`ccd/session-hook.sh:2900`) ``, inside the sentence that quotes `` `_hook_emit_context "$CARD" "$CARD_COMPACT"` ``. It is `:4703` at f7e51156f and `:4722` at origin/main, and B2's README rows move it again. README's other two hook anchors in that sentence (`:97`, `:103-105`) lie in `_hook_emit_context`, above the insertion, and do not move.
- Modify: `server/test/session-hook.test.ts`:
  - one describe appended after the file's last line, which is Task 8's describe;
  - the dated S6-R11 paragraph, comments only. It goes directly above the byFile map's `      'ccd/ccd': <n>,` entry (`:8356` at f7e51156f), plus one line directly above `    expect(total, 'the narrated headline is the sum of the census, and this is it').toBe(<n>);` (`:8663`). Both sit below `:7056`, the highest line of this file the corpus cites.

**Interfaces:**
- Consumes, from the hook:
  - `_ct_read <path>`: rc 0 read, rc 1 absent, rc 2 unmeasurable (not a readable regular file). It sets `CT_V` to at most `CCRC_ID_MAX` (128) chars, trimmed both ends, with no fork. The reader uses it for `$REG/<id>.generation`, the sweep's generation record `card/<id>/<psid>.gen` (Task 5; coordinator ruling R-recalloff-parity) and the scope marker;
  - `CCRC_ID_MAX` (128, `:2677` at f7e51156f): the recall-off read's window. Ruling RC4 needs the read's untrimmed width, which `_ct_read` trims away, so the reader reads `recall-off/<id>` itself, with `_ct_read`'s bound and its type tests, and a trim of ASCII whitespace only, in every locale (coordinator ruling R-recalloff-trim; `_ct_read`'s `[[:space:]]` takes the Unicode spaces too in a UTF-8 locale);
  - `CARD_COMPACT`, which `_hook_compact_card` resets to "" and sets only when it serves the compact card;
  - `COMPACT_CARD_MAX_CHARS` (4000), `COMPACT_CARD_MAX_AGE` (1200 s), `REG`, `id`, `psid`, `paid`, `HOME`, `CCRC_SESSION_GENERATION` and `EPOCHREALTIME`;
  - `_hook_compact_mark_served`, which returns 0 at once when `COMPACT_SERVE_NONCE` is empty;
  - Task 8's marker, `<scope> <psid> <ms>`.
- Consumes, from lib (the test only, by dynamic import):
  - B1: `SPOOL_ID_MAX`;
  - B2: `decideRecallOff({ file: Presence<string>, generation: string }) → 'off' | 'stale' | 'none'` and `resolveGeneration({ envGen, regGen }) → { value: string | null, via }`;
  - Task 1: `cardLine({ leaf, parent }) → string`, with `leaf` an `L` id or display prefix and `parent` an `N` one or `null`, and `CARD_LINE_MAX` (512).
- Consumes, from the test file's module scope: `runFull`, `hookEnv(env)` (B1's one spawn env; the FIFO and strace spawns take `env: hookEnv(SCRUB)`), `card(stdout)` (asserts exactly one stdout line, a SessionStart envelope, and returns its `additionalContext`), `home`, `HOOK`, `HELPER_SRC` (the path of `ccd/compact-card.mjs`), `GENERATION`, `setFile()`, `cardFile()`, `cardTree()`, `plantSession`, `preCompact`, `LIVE`, `DEAD`, `tl`, `itLinux`, `IS_DARWIN`, `execFileSync` and `spawnSync`. The describe-local `plantPair` (in `'the compaction card — SessionStart(compact) (spec §3.3)'`) is not in scope, so the describe re-declares its shape as `plantCompactCard`.
- Produces:
  - four constants above the `case`: `HISTORY_CARD_MAX=512`, `HISTORY_CARD_RE='<the spec grammar>'`, `HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"` and `HISTORY_CARD_DIR="$HOME/.ccrc/history/card"`. Task 10 uses the first and the last; Task 11 binds all four to lib;
  - `_hook_history_card`, called only from the SessionStart arm's compact guard, after `_hook_compact_card`, so it folds into the compact card that function set;
  - the fold `CARD_COMPACT="<line>${CARD_COMPACT:+<LF><card>}"`, done only when it fits;
  - README's re-pointed anchor;
  - the S6-R11 paragraph.

**Spec:** §8.6 (the shape, timing, scope, the hook mechanism, `_hook_history_card`'s placement and checks, the grammar gate, the fold; `served` keeps its meaning; delivery measured, not receipted), §9.7 (`recall-off` honoured only for the resolved generation), §5.5 (the card halves of S2, S3 and S8), §8.9 (C18 to C22, C37, and C19 with C68's card half), §10.5 ("Citation-corpus tax": the S6-R11 re-measure in B3; README repaired, not counted), §13 (builtins on the hook's path; one envelope). C68's three card-half CONTROLs (rev 3.5, ruling R-recalloff-parity) each have a mutant here or in the task that owns the mechanism: a hook that leaves the generation `''` when env and registry are unreadable is `T9-M34-no-record-read` (both `R-recalloff: …` parity rows); a sweep that writes no record is Task 5's `R-recalloff-parity: no record written beside a prediction` (and `… the record names the oldest family` for a record that does not follow the newest family); a stale record kept beside a standing prediction is Task 2's `R-recalloff-parity: a stale record kept beside a prediction off end-of-file` and `… a record never compared with the resolved generation`. C68's row "no resolvable generation and no switch → line served" is the parity row `nothing recorded and no recall-off file serves`. Departures:
- D-4748 (`history-card-reader-above-the-arm`): the one sanctioned insertion above README's anchor, which is re-pointed by content.
- D-4736 (`history-card-fold-and-reserve`): the fold and its room test (Task 10 adds the reserve). The fold is spelled `CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"`, with `nl=$'\n'` assigned outside the quotes, where §8.6 writes `$'\n'` inside `${…:+…}`: `bash --posix` does not expand it there (measured; `T9-M20-posix-lf` pins it). The behaviour is §8.6's; only the spelling departs.
- D-4747 (`history-card-main-scope-only`): the reader serves only on a fresh `main` marker for this psid.
- B2's D-4680 (`history-recall-off-generation`): the reader honours `recall-off/<id>` only when it names this family's generation, resolved as the CLI resolves it: the env's, the registry's, else the sweep's record of the id's newest family (coordinator ruling R-recalloff-parity).
- B1's D-4252 (`history-epoch-lines-survive-off`), card half: `history-off` silences the line, never a clear epoch line.
- B2's D-4734 (`history-fork-spooled`) (B2-defined, ruled Q16): B2 spools SessionStart(fork); the reader still serves only a compact SessionStart, and the compact-only case gains its `fork` row.
- D-4737 (`history-card-measured-from-transcript`): the hook writes no receipt.
- B1's D-4170 (`history-id-grammar`), applied as bash can: the 224-char bound is a builtin test, and `.` and `..` are refused structurally, because under `scope/` and `card/` they name directories.
- D-4749 (`history-card-recall-off-unreadable-off`) NEW, ruled RC4. §8.6 reads "treating it as set only when its content equals this session's generation". B2's `decideRecallOff` answers an unreadable file `off`, and its `presenceOf` reads a symlink or a non-file as unreadable. The hook follows the CLI, so the eval's control arm never sees the card line while its CLI answers exit 8. Its read is `CCRC_ID_MAX` (128) characters where the CLI's is 4,096 bytes, so a read that fills that window is OFF too, the side that withholds the line (ruling RC4: fail closed).
- D-4750 (`history-hook-card-names-once`) NEW. §8.6's D-4736 (`history-card-fold-and-reserve`) says "no new card constant beyond the reserve". The hook gains one number, `HISTORY_CARD_MAX`, from which the reserve derives, plus three spellings: the grammar and the two directories. These are not budgets, and each is declared once and bound to lib by Task 11.

**Choices this task makes:**
- **No separate length test.** §8.6 says the read "refuses a value over 512 chars". The read takes at most `HISTORY_CARD_MAX + 1` chars, and the grammar admits no line over 145 chars, so a test of `${#v} <= 512` could never refuse what the grammar did not. It was measured: deleting it left every case green, while its sibling mutant (a permissive grammar) reds the over-512 case. C21's over-512 case stands and is measured through the grammar.
- **`.` and `..` get no test**, for the reason in Task 8: `scope/.` and `scope/..` are directories, which `_ct_read` refuses as rc 2.
- **No clock, no line.** Without a well-formed `EPOCHREALTIME` the marker's age cannot be measured without a fork, so nothing is served. A malformed value would otherwise abort `$(( ))` under `set -u`; its case pins both rows, but only the `malformed` row can red without the test (`T9-M12-clock-guard`): an unset clock reads as `now` 0, which is never fresh, so it serves nothing either way.
- **The clock is read once.** Each expansion of `EPOCHREALTIME` reads the clock anew, so a reader that tests one expansion and slices another can take its seconds and its fraction from two readings (B1's spool block reads it once into `_hs_t` for this reason, and pins it). The reader reads it once into the local `t`, tests `t` with B1's grammar `^[1-9][0-9]{0,11}[.,][0-9]*$` (one clock grammar in the hook), and slices `t`. The case `EPOCHREALTIME is read once …`, modelled on B1's, moves the clock between the test and the slice with a `BASH_ENV` DEBUG trap (`set -T` carries it into the function), and the source pin counts one expansion. Neither was run on a prototype; a red at the fixture (a trap that does not reach the function) is the fixture's to fix, never the reader's.
- **A future `<ms>` is not fresh.** The marker is written by the PreCompact that precedes this SessionStart, so its ms is never after now on one clock.
- **A regular file only.** A FIFO at the card's path would block `read` with the serve lock held. `[[ -f ]]` refuses a FIFO that is there when the test runs, and a case runs the hook against one under a 20 s deadline. The test is builtin, and bash has no `O_NOFOLLOW` or `O_NONBLOCK` redirection, so a node swapped in after it is opened: a link is followed, a FIFO blocks until Claude Code kills the hook (`install-session-hooks.sh` `HOOK_TIMEOUT_S`). B1's spool block names the same residue in the same words, and the reader's header now does too; no case can measure the window, so none is added.
- **`recall-off` is read the way the CLI reads it, and a read that fills its window is OFF (ruling RC4).** A symlink, a non-file or an unreadable file is OFF, and a symlinked or unreadable `.generation` names no generation. The hook reads `recall-off/<id>` itself, with `_ct_read`'s bound (`CCRC_ID_MAX`, 128 chars), type tests and trim, where the CLI's `presenceOf` keeps 4,096 bytes. A read that fills those 128 chars is OFF before it is trimmed or compared, so text a hand edit pads past char 128 always withholds the line:
  - with THIS generation after the padding, both withhold: the CLI reads the generation and answers OFF, exit 8 (the parity row `130 spaces followed by the resolved generation G`, mutant `T9-M30-recall-off-window`);
  - with anything else after the padding, the hook withholds where the CLI reads the text as stale: the side that withholds a line, which the ruling accepts.
  - Only a hand edit makes such a file: the W2 verb writes 37 bytes.
- **The one deliberate asymmetry: a recall-off value outside the generation grammar withholds (coordinator ruling R-recalloff-trim, the final check's R1).** B2's `presenceOf` decodes UTF-8 and trims with JS `String.prototype.trim`, and `decideRecallOff` trims again; that trim also strips U+00A0, U+FEFF, U+202F, U+2007 and, which bash's `[[:space:]]` takes only in a UTF-8 locale, U+3000 and U+2000 to U+200A. A builtin trim cannot match it in every locale, so the hook trims ASCII whitespace only (space, tab, LF, VT, FF, CR, spelled as one `$'…'` local, so the trim is the same under `LC_ALL=C`, a UTF-8 locale and `--posix`), and then withholds the line when the value holds any character outside the generation grammar (empty, or `[0-9a-f-]`, tested by a bracket with no range, so no locale's collation widens it). A no-break space or a byte-order mark before this generation then withholds, where the CLI exits 8: the parity rows `a no-break space …` and `a byte-order mark …`, mutant `T9-M39-recall-off-grammar`. The same character before ANOTHER generation withholds too, where the CLI reads stale and recalls: the side that withholds a line, which the ruling accepts. A value inside the grammar is compared exactly as before, so no other parity row moves. Builtins only: a glob test, no fork.
  - `.generation` is ccd's own 36-byte file and keeps `_ct_read`, because RC4 rules the recall-off read. A `.generation` that a hand edit pads past char 128 still reads as no generation here, where the CLI reads the generation. That is named for the coordinator in the PR body, with no B3 change.
- **With neither the env nor the registry resolving a generation, the sweep's record stands in for the store (coordinator ruling R-recalloff-parity).** B2's CLI then compares `recall-off/<id>` with the id's newest family's generation (`''` for a legacy family or none), which only the store knows, and this hook runs builtins only and reads no store. So it reads `card/<id>/<psid>.gen`, which Task 5 writes beside the prediction by the CLI's own rule, before the prediction and never left stale (Task 2's `decideCardGenFile`). The record is read only then (`via` empty), through `_ct_read`, never through a link (`[[ -L ]]` first, as for `.generation`), and only when it is empty or has the UUID grammar; anything else, or no record at all, withholds the line whenever a recall-off file exists (fail closed). An absent or unreadable recall-off file answers as it does for the CLI, whatever the generation. The record is per prediction, so it is read for the same `<id>/<psid>` pair the card is: beside a recall-off file, a prediction with no record never serves to a session whose generation the hook cannot otherwise resolve. The env or registry generation, when either resolves, always wins over the record, as it does in the CLI (mutant `T9-M35-record-over-env`).
- **The C18 cases pin a locale.** `${#…}` and the emitter's `${2:0:N}` count in the hook's locale unit: bytes under C, chars under a UTF-8 locale. The line is 109 bytes and 103 chars. The fold's room test is in the emitter's own unit, so it is right in both. The cases plant an ASCII compact card, whose width is the same everywhere, run under `LC_ALL=C` (and `C.UTF-8` on Linux), and measure the line in that unit.
- **A SessionStart(fork) never serves (ruled Q16).** B2 spools a fork line, but the reader's call stays inside the compact guard: a fork's context describes no compaction. The case `only a compact SessionStart serves` gains `fork` beside `startup`, `resume` and `clear`, with a fresh `main` marker and a prediction present for the same psid, the state Claude Code's same-id fork arm resumes into. Mutant `T9-M31-fork-source` widens the guard to `fork` and reds that row alone; `T9-M23` reds the case at `startup` first, so it cannot measure the new row. B2's whitelist edit is in place on the spool block's source line, below README's anchor, so Step 8's census and its expected numbers are unchanged.
- **The tests never spell `served:` or `.served`.** The describe titled "the compaction card — no test reads served off a set (plan Task 9)" scans this whole file for both spellings and pins its `raw` count at 11. So `plantCompactCard`'s set carries no `served` member; the hook's serve arm reads only the set's nonce.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -cE '^state="" ask_json=' ccd/session-hook.sh
grep -B2 -E '^state="" ask_json=' ccd/session-hook.sh | head -2
grep -cxF '    [[ "$src" == compact ]] && { _hook_compact_card || true; }' ccd/session-hook.sh
grep -cF '_hook_emit_context "$CARD" "$CARD_COMPACT"' README.md
grep -cE '^# that line \(marker-logic-in-the-tail \(D-[0-9]+\)\)\.$' ccd/session-hook.sh
grep -cxF '# it is in the tail because nothing new may land above :2900.' ccd/session-hook.sh
grep -cF '$HOME/.ccrc/history/scope' ccd/session-hook.sh
grep -c '^_hook_history_card() {' ccd/session-hook.sh
grep -cE "^      'ccd/ccd': [0-9]+,$" server/test/session-hook.test.ts
grep -cF "this is it').toBe(" server/test/session-hook.test.ts
grep -cx 'CCRC_ID_MAX=128' ccd/session-hook.sh
```

Expected:
- `1`;
- the two lines `[[ -n "$event" ]] || exit 0` and an empty line;
- `1`, `1`, `1`;
- `1`. A `0` means B1 merged that comment worded otherwise. Find the sentence in the history-spool block that names `:2900`, and reword it in Step 4 the same way;
- `3`: Task 8's block's two and its early line below `esac`;
- `0`, `1`, `1`;
- `1`: the recall-off read's window (ruling RC4).

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/session-hook.test.ts`, after Task 8's describe:

```ts
// ── ccrc history: the card line SessionStart(compact) folds into the compact subject (history spec 2026-10-05 §8.6, §8.9; W1-B3 task 9) ──
// APPENDED, with NO new import line: the citation census cites this file by line.
// The history lib is reached by dynamic import. `run`/`runFull`/`hookEnv`/`card`/`home`/
// `HOOK`/`HELPER_SRC`/`GENERATION`/`setFile`/`cardFile`/`cardTree`/`plantSession`/
// `preCompact`/`LIVE`/`DEAD`/`tl` are this file's module-level fixture.
describe('history card line: SessionStart(compact) serves the sweep\'s prediction to a main compaction (spec §8.6)', () => {
  const SID = '7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
  const OTHER = '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4';
  const G2 = '0189abcd-1234-5678-9abc-0123456789ff';
  const ID = 'demo-quiet-basin';
  const ROOT = process.getuid?.() === 0;
  /** spec §10.1, as B1's spool describe scrubs: the operator's session, and every inherited `CCRC_RECALL_*`. */
  const SCRUB: Record<string, string> = {
    TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
    ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('CCRC_RECALL_')).map((k) => [k, ''])),
  };
  let lib: typeof import('../../ccd/history/lib.mjs');
  let LINE = '';
  beforeEach(async () => {
    lib = await import('../../ccd/history/lib.mjs');
    LINE = lib.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' });
  });
  const histDir = (...p: string[]): string => path.join(home, '.ccrc', 'history', ...p);
  const reg = (f: string): string => path.join(home, '.cc-sessions', f);
  /** The two directories the sweep makes (Task 5); the hook never makes them. */
  const plantDirs = (id = ID): void => {
    fs.mkdirSync(histDir('scope'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(histDir('card', id), { recursive: true, mode: 0o700 });
  };
  /** What Task 8's marker writes, planted directly: `<scope> <psid> <ms>`. */
  const mark = (text = `main ${SID} ${Date.now()}`, id = ID): void => fs.writeFileSync(histDir('scope', id), `${text}\n`);
  const cardPath = (sid = SID, id = ID): string => histDir('card', id, `${sid}.txt`);
  /** The whole fixture of a servable compaction: both directories, a fresh main marker, the prediction. */
  const plantAll = (text?: string, id = ID): void => {
    plantDirs(id); mark(undefined, id);
    fs.writeFileSync(cardPath(SID, id), text ?? `${LINE}\n`, { mode: 0o600 });
  };
  const offFile = (name: string): string => path.join(home, '.ccrc', name);
  const touchOff = (name: string): void => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(offFile(name), '');
  };
  /** SessionStart(compact) with a UUID session id: the module's `compactStart` hard-codes `sess-1`. */
  const start = (extra: object = {}): object =>
    ({ hook_event_name: 'SessionStart', source: 'compact', cwd: home, transcript_path: path.join(home, 't.jsonl'),
      session_id: SID, prompt_id: 'p1', model: 'claude-opus-5', ...extra });
  /** The additionalContext the hook printed, or null when it printed nothing; silent stderr asserted. */
  const served = (payload: object = start(), env: Record<string, string> = {}): string | null => {
    const r = runFull(payload, { ...SCRUB, ...env });
    expect(r.stderr, 'the hook is silent on stderr').toBe('');
    return r.stdout === '' ? null : card(r.stdout);
  };
  const hasLine = (out: string | null): boolean => out !== null && out.includes('History: node ');
  /** A compact card pair as `_hook_compact_pre` leaves it: the shape of the describe-local `plantPair` above, whose
   *  serve arm reads only the set's nonce. A fresh nonce per pair, because a served nonce is never served again. */
  let pairs = 0;
  const plantCompactCard = (text: string): void => {
    pairs += 1;                                  // a fresh nonce per pair: a served nonce is never served again
    const nonce = `compact-${pairs}-1-2-3`;
    fs.writeFileSync(setFile(), JSON.stringify({ v: 1, at: 1, nonce, scope: 'main', agent: null, transcript: '/t.jsonl',
      parentLive: null, liveAgents: 0, cwd: null, built: null, fresh: null, steered: false, files: null, stats: null }) + '\n');
    fs.writeFileSync(cardFile(), `${nonce}\n${text}\n`);
  };
  /** The helper's own footer, read from its source rather than retyped. */
  const FOOTER = (): string => /^const FOOTER = '(.*)';$/m.exec(fs.readFileSync(HELPER_SRC, 'utf8'))![1]!;
  /** ASCII, like everything else in the synthetic card below, so its width is the same in every locale. */
  const HEADER = 'graphify card - this context\'s working set at compaction, from graphify-out/ (built at deadbeef, fresh):';
  /** A compact card of exactly `n` chars, shaped as `renderCard` shapes a truncated one: header, a row, the
   *  `(+k files not shown)` line, the blast line, and the helper's footer last. All ASCII, so `n` chars are `n`
   *  bytes and the hook's `${#…}` reads `n` under any locale; only the history line's width depends on it. */
  const compactCardOf = (n: number): string => {
    const row = (k: number): string => `- server/src/a.ts [touched] - symbols ${'s'.repeat(k)}`;
    const parts = (k: number): string[] => [HEADER, row(k), '(+4 files not shown)',
      'Blast radius: 0 files import or call something in these 5 files.', FOOTER()];
    const text = parts(n - parts(0).join('\n').length).join('\n');
    expect(text.length).toBe(n);
    return text;
  };
  /** A BASH_ENV that strips the dynamic EPOCHREALTIME builtin and, given a value, plants a plain one. */
  const epochEnv = (value: string | null): string => {
    const f = path.join(home, 'epochrealtime.bash');
    fs.writeFileSync(f, value === null ? 'unset EPOCHREALTIME\n' : `unset EPOCHREALTIME\nEPOCHREALTIME='${value}'\n`);
    return f;
  };

  it('serves the prediction, alone, as the compact subject of a main compaction', () => {
    plantAll();
    expect(served()).toBe(LINE);
  });

  it('a parent-less line and a 20-hex line pass the grammar too', () => {
    plantAll(`${lib.cardLine({ leaf: 'L03a9c1', parent: null })}\n`);
    expect(served()).toBe(lib.cardLine({ leaf: 'L03a9c1', parent: null }));
    const long = lib.cardLine({ leaf: `L${'0123456789abcdef0123'}`, parent: `N${'fedcba9876543210fedc'}` });
    fs.writeFileSync(cardPath(), `${long}\n`);
    expect(served()).toBe(long);
  });

  // THE UNIT. `${#…}` and the emitter's `${2:0:N}` count in the hook's locale: bytes under C, characters under a
  // UTF-8 locale. The history line carries `…` and `·`, so its width is 109 bytes but 103 characters, and the
  // fold's room test must be in the emitter's own unit or a fold could still be cut. Each case below pins a
  // locale and measures the line in that locale's unit.
  it('C18: a reserved 3,487-char compact card plus the line — the line first, the header second, the footer last, within 4,000, one JSON line', () => {
    plantAll();
    const reserved = compactCardOf(4000 - (lib.CARD_LINE_MAX + 1));
    plantCompactCard(reserved);
    const out = served(start(), { LC_ALL: 'C' })!;   // `card` asserts exactly one stdout line, a SessionStart envelope
    const lines = out.split('\n');
    expect(lines[0]).toBe(LINE);
    expect(lines[1]).toBe(HEADER);
    expect(lines[lines.length - 1]).toBe(FOOTER());
    expect(out).toBe(`${LINE}\n${reserved}`);
    expect(Buffer.byteLength(out), 'within the compact clip in its strictest unit').toBeLessThanOrEqual(4000);
  });

  it('C18: a 4,000-char card rendered before install leaves no room — no history line, the card intact', () => {
    plantAll();
    const full = compactCardOf(4000);
    plantCompactCard(full);
    expect(served(start(), { LC_ALL: 'C' })).toBe(full);
  });

  it.each([
    ['C', (l: string) => Buffer.byteLength(l)],
    ...(IS_DARWIN ? [] : [['C.UTF-8', (l: string) => l.length] as const]),
  ] as const)('C18: under LC_ALL=%s the room test is inclusive — 4000 - line - 1 folds, one more does not', (locale, width) => {
    plantAll();
    const fits = compactCardOf(4000 - width(LINE) - 1);
    plantCompactCard(fits);
    expect(served(start(), { LC_ALL: locale })).toBe(`${LINE}\n${fits}`);
    plantAll();
    const over = compactCardOf(4000 - width(LINE));
    plantCompactCard(over);
    expect(served(start(), { LC_ALL: locale })).toBe(over);
  });

  it('with standing cards present the compact positional still begins with the line', () => {
    const tree = cardTree();
    plantAll();
    const out = served(start({ cwd: tree }))!;
    expect(out).toContain('graphify: this tree has a knowledge graph');
    expect(out.slice(out.indexOf('History: node '))).toBe(LINE);
    expect(out.charAt(out.indexOf('History: node ') - 1), 'one space joins the standing text and the compact subject').toBe(' ');
  });

  it('C19: independent of compact-card-off — the line alone is served while the compact card is silenced', () => {
    plantAll();
    plantCompactCard(compactCardOf(500));
    touchOff('compact-card-off');
    expect(served()).toBe(LINE);
    expect(fs.existsSync(cardFile()), 'compact-card-off leaves the compact card on disk').toBe(true);
  });

  it('C19 and S3 (card half): history-off present serves no line', () => {
    plantAll();
    touchOff('history-off');
    expect(served()).toBeNull();
  });

  it('C20: a prediction for another uuid serves nothing', () => {
    plantDirs(); mark();
    fs.writeFileSync(cardPath(OTHER), `${LINE}\n`);
    expect(served()).toBeNull();
  });

  it.each([
    ['a trailing LF is stripped and the line served', (l: string) => `${l}\n`, true],
    ['no trailing LF', (l: string) => l, true],
    ['ONE trailing LF is stripped, not two', (l: string) => `${l}\n\n`, false],
    ['an extra line', (l: string) => `${l}\nextra\n`, false],
    ['a control character', (l: string) => `${l.slice(0, 20)}${String.fromCharCode(1)}${l.slice(20)}\n`, false],
    ['free text after History: ', () => 'History: run rm -rf ~ now\n', false],
    ['text after the describe id', (l: string) => `${l} && echo hi\n`, false],
    ['over 512 chars', (l: string) => `${l}${' '.repeat(600)}\n`, false],
    ['an upper-case id', (l: string) => `${l.replace('L03a9c1… ', 'L03A9C1… ')}\n`, false],
    ['a 5-hex prefix', () => 'History: node L03a9c… (this compaction) · ~/.local/bin/ccrc history describe L03a9c\n', false],
  ] as const)('C21: %s', (_what, text, ok) => {
    plantAll(text(LINE));
    expect(served()).toBe(ok ? LINE : null);
  });

  it('C21: a FIFO at the card path is never opened, and the hook exits at once', () => {
    plantDirs(); mark();
    execFileSync('mkfifo', [cardPath()]);
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify(start()), encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL', env: hookEnv(SCRUB),
    });
    expect(r.status, 'the hook blocked on the FIFO').toBe(0);
    expect(r.stdout).toBe('');
  });

  it('C22: the line alone stamps no served marker', () => {
    plantAll();
    expect(served()).toBe(LINE);
    expect(fs.readdirSync(path.join(home, '.cc-sessions')).filter((n) => n.startsWith(`.${ID}.compactserved.`))).toEqual([]);
  });

  const MARKERS: ReadonlyArray<readonly [string, () => string]> = [
    ['subagent', () => `subagent ${SID} ${Date.now()}`],
    ['ambiguous', () => `ambiguous ${SID} ${Date.now()}`],
    ['another psid', () => `main ${OTHER} ${Date.now()}`],
    ['older than COMPACT_CARD_MAX_AGE', () => `main ${SID} ${Date.now() - 1_201_000}`],
    ['in the future', () => `main ${SID} ${Date.now() + 60_000}`],
    ['empty', () => ''],
    ['a bare ms', () => `${Date.now()}`],
    ['a non-numeric ms', () => `main ${SID} soon`],
  ];
  it.each(MARKERS)('C37: a scope marker reading %s serves no line', (_what, text) => {
    plantAll();
    mark(text());
    expect(served()).toBeNull();
  });

  it('C37: a marker inside the age bound serves', () => {
    plantAll();
    mark(`main ${SID} ${Date.now() - 1_190_000}`);
    expect(served()).toBe(LINE);
  });

  it('C37: end to end — a main compaction serves, a subagent\'s does not (Task 8 writes the marker)', () => {
    plantDirs();
    fs.writeFileSync(cardPath(), `${LINE}\n`);
    const main = plantSession({ sid: SID, lines: [tl.user('x')] });
    runFull({ ...preCompact(home, main.transcript, 'manual'), session_id: SID }, SCRUB);
    expect(served(start({ transcript_path: main.transcript }))).toBe(LINE);
    fs.rmSync(setFile(), { force: true });       // PostCompact's to consume; left, it reads as an overlap
    const sub = plantSession({ sid: SID, lines: [tl.user('x')], parentAge: DEAD,
      subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }] });
    runFull({ ...preCompact(home, sub.transcript, 'auto'), session_id: SID }, SCRUB);
    expect(fs.readFileSync(histDir('scope', ID), 'utf8')).toMatch(/^subagent /);
    expect(served(start({ transcript_path: sub.transcript }))).toBeNull();
  });

  it('S2 (card half): a SessionStart(compact) payload with agent_id serves no line', () => {
    plantAll();
    expect(served(start({ agent_id: 'agent-7' }))).toBeNull();
  });

  it('only a compact SessionStart serves: startup, resume, clear and fork (spooled from B2, ruled Q16) never read the prediction', () => {
    plantAll();
    for (const source of ['startup', 'resume', 'clear', 'fork']) expect(hasLine(served(start({ source }))), source).toBe(false);
  });

  it('S8 (card half): under history-off a SessionStart(clear) still spools its epoch line and prints no card line', () => {
    plantAll();
    fs.mkdirSync(histDir('spool'), { recursive: true, mode: 0o700 });
    touchOff('history-off');
    expect(hasLine(served(start({ source: 'clear' })))).toBe(false);
    expect(fs.readFileSync(histDir('spool', `${ID}.jsonl`), 'utf8')).toContain('"src":"clear"');
  });

  it('the id bound is SPOOL_ID_MAX: a 224-char id is served, a 225-char id is not', () => {
    for (const [n, ok] of [[lib.SPOOL_ID_MAX, true], [lib.SPOOL_ID_MAX + 1, false]] as const) {
      const id = 'a'.repeat(n);
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
      plantAll(undefined, id);
      expect(served(), `${n} chars`).toBe(ok ? LINE : null);
    }
  });

  it('a session_id that is not a lowercase UUID serves nothing, even beside a marker and a file keyed on it', () => {
    plantDirs();
    mark(`main sess-1 ${Date.now()}`);
    fs.writeFileSync(cardPath('sess-1'), `${LINE}\n`);
    expect(served(start({ session_id: 'sess-1' }))).toBeNull();
  });

  it.each([
    ['unset', null],
    ['malformed', 'not-a-clock'],
  ] as const)('EPOCHREALTIME %s serves no line and never forks a clock', (_what, value) => {
    plantAll();
    expect(served(start(), { BASH_ENV: epochEnv(value) })).toBeNull();
  });

  // B1's F37 shape (its spool block): each expansion of EPOCHREALTIME reads the clock anew, so the reader reads it ONCE.
  // A DEBUG trap (`set -T` carries it into the function) hands the grammar test a valid reading, 1700000000.999999, and
  // every other command one with no fraction, 1700000001. Read once, the reader tests and slices the no-fraction reading
  // and serves nothing; the tested reading alone would put the marker 101 ms in the future and serve nothing either. Only
  // a reader that tests one reading and slices another serves: its `now` takes 1700000001's digits as the fraction.
  it('EPOCHREALTIME is read once: a clock that moves between the test and the slice serves no mis-aged line', () => {
    plantAll();
    mark(`main ${SID} 1700000001100`);
    const trapFile = path.join(home, 'epochtrap.bash');
    fs.writeFileSync(trapFile, 'set -T\nunset EPOCHREALTIME\nEPOCHREALTIME=1700000001\n'
      + 'trap \'case $BASH_COMMAND in *"=~ ^[1-9]"*) EPOCHREALTIME=1700000000.999999 ;; *) EPOCHREALTIME=1700000001 ;; esac\' DEBUG\n');
    expect(served(start(), { BASH_ENV: trapFile }), 'a line served on a clock no single reading gave').toBeNull();
  });

  // RECALL-OFF PARITY (spec §9.7, §8.2, C68; B2's D-4680 (history-recall-off-generation); coordinator ruling
  // R-recalloff-parity): every row runs the hook, and its expectation is the CLI's own decision over the
  // fixture, so the card and `ccrc history` can never put one family in two eval arms. The CLI resolves the
  // generation as B2's readContext does: the env's, else the registry's (lib resolveGeneration), else, under
  // 'newest', the id's newest family's ('' for a legacy family or none), which only the store knows. The hook
  // cannot read the store, so there it reads the record the sweep writes beside the prediction,
  // card/<id>/<psid>.gen (Task 5 pins that record against B2's familiesOf); this fixture's record IS the
  // store's newest family. With no usable record the CLI's answer is the store's, which the hook cannot know:
  // a recall-off file that exists then withholds the line (fail closed), and an absent or unreadable one
  // answers as it does for the CLI whatever the generation.
  // The one deliberate asymmetry (coordinator ruling R-recalloff-trim): the hook trims ASCII whitespace only, where
  // B2's presenceOf decodes UTF-8 and trims with String.prototype.trim, which also strips U+00A0 and U+FEFF. So a
  // value that holds a character outside the generation grammar after the hook's trim withholds the line: the
  // `G-nbsp` and `G-bom` rows read OFF in the CLI (exit 8) and withhold here. The characters are built from their
  // code points, never written as escapes or as themselves, so no write can turn them into something else.
  const NBSP_G = `${String.fromCharCode(0xa0)}${GENERATION}\n`;
  const BOM_G = `${String.fromCharCode(0xfeff)}${GENERATION}\n`;
  type Reg = 'G' | 'G2' | 'absent' | 'unreadable' | 'symlink-G';
  type Off = 'absent' | 'G' | 'G-padded' | 'G-wide' | 'G-nbsp' | 'G-bom' | 'G2' | 'empty' | 'unreadable' | 'dir' | 'symlink-G';
  type Rec = 'G' | 'G2' | 'legacy' | 'absent' | 'junk' | 'symlink-G';
  /** B1's Presence, as a type-only import expression: this file gains no import line (the census cites it by line). */
  type Pres = import('../../ccd/history/lib.mjs').Presence<string>;
  const PARITY: ReadonlyArray<readonly [string, string, Reg, Off, Rec]> = [
    ['no recall-off file', GENERATION, 'G', 'absent', 'G'],
    ['recall-off names this generation', GENERATION, 'G', 'G', 'G'],
    ['recall-off names it inside whitespace', GENERATION, 'G', 'G-padded', 'G'],
    // Ruling RC4: 130 spaces push the generation past the hook's CCRC_ID_MAX-char read, inside the CLI's 4,096 bytes.
    ['130 spaces followed by the resolved generation G', GENERATION, 'G', 'G-wide', 'G'],
    // Ruling R-recalloff-trim: the CLI's trim strips each, so it reads G and exits 8; the hook withholds.
    ['a no-break space before the resolved generation G', GENERATION, 'G', 'G-nbsp', 'G'],
    ['a byte-order mark before the resolved generation G', GENERATION, 'G', 'G-bom', 'G'],
    ['recall-off names another generation (stale)', GENERATION, 'G', 'G2', 'G'],
    ['an empty recall-off file beside a generation', GENERATION, 'G', 'empty', 'G'],
    ['an unreadable recall-off file', GENERATION, 'G', 'unreadable', 'G'],
    ['a directory at recall-off/<id>', GENERATION, 'G', 'dir', 'G'],
    ['a symlink at recall-off/<id>', GENERATION, 'G', 'symlink-G', 'G'],
    ['a malformed env generation falls back to .generation (named)', 'not-a-uuid', 'G', 'G', 'G'],
    ['a malformed env generation falls back to .generation (stale)', 'not-a-uuid', 'G', 'G2', 'G'],
    ['the env generation wins over .generation (named)', GENERATION, 'G2', 'G', 'G'],
    ['the env generation wins over .generation (stale)', GENERATION, 'G2', 'G2', 'G'],
    // R-recalloff-parity: no env or registry generation, so the CLI compares with the newest family's generation.
    // No resolvable generation and an empty file: the CLI compares '' with '' (a legacy newest family, or a store
    // holding no family of the id, which Task 5's record writes the same way) and exits 8; the hook agrees.
    ['a legacy newest family recorded empty and an empty recall-off file', '', 'absent', 'empty', 'legacy'],
    ['the newest family recorded G and an empty recall-off file reads stale', '', 'absent', 'empty', 'G'],
    ['no env or registry generation and recall-off names the recorded newest family', '', 'absent', 'G', 'G'],
    ['recall-off names G while the recorded newest family is G2', '', 'absent', 'G', 'G2'],
    ['an unreadable .generation is no generation, the record decides', '', 'unreadable', 'G', 'G'],
    ['a symlinked .generation is no generation', '', 'symlink-G', 'G', 'G2'],
    // The ruling's pin: the CLI exits 8 here, so the card line must not reach the control arm.
    ['R-recalloff: an invalid env generation, an unreadable .generation, recall-off naming the recorded G', 'not-a-uuid', 'unreadable', 'G', 'G'],
    ['R-recalloff: an invalid env generation, no .generation, recall-off naming the recorded G', 'not-a-uuid', 'absent', 'G', 'G'],
    ['nothing recorded withholds a line beside a recall-off value', '', 'absent', 'G2', 'absent'],
    ['nothing recorded and no recall-off file serves', '', 'absent', 'absent', 'absent'],
    ['a symlinked record is no record', '', 'absent', 'G2', 'symlink-G'],
    ['a malformed record is no record', '', 'absent', 'G2', 'junk'],
    ['the env generation wins over the record', GENERATION, 'absent', 'G2', 'G2'],
    ['the registry generation wins over the record', '', 'G', 'G2', 'G2'],
  ];
  const parityRows = PARITY.filter(([, , r, o]) => !ROOT || (r !== 'unreadable' && o !== 'unreadable'));
  const plantParity = (regKind: Reg, offKind: Off, recKind: Rec): void => {
    const genFile = reg(`${ID}.generation`);
    fs.rmSync(genFile, { force: true });
    if (regKind === 'G') fs.writeFileSync(genFile, GENERATION);
    if (regKind === 'G2') fs.writeFileSync(genFile, G2);
    if (regKind === 'unreadable') { fs.writeFileSync(genFile, GENERATION); fs.chmodSync(genFile, 0o000); }
    if (regKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'gen-target'), GENERATION); fs.symlinkSync(path.join(home, 'gen-target'), genFile); }
    const off = histDir('recall-off', ID);
    fs.mkdirSync(histDir('recall-off'), { recursive: true, mode: 0o700 });
    if (offKind === 'G') fs.writeFileSync(off, `${GENERATION}\n`);
    if (offKind === 'G-padded') fs.writeFileSync(off, `  ${GENERATION}  \n\n`);
    if (offKind === 'G-wide') fs.writeFileSync(off, `${' '.repeat(130)}${GENERATION}\n`);
    if (offKind === 'G-nbsp') fs.writeFileSync(off, NBSP_G);
    if (offKind === 'G-bom') fs.writeFileSync(off, BOM_G);
    if (offKind === 'G2') fs.writeFileSync(off, `${G2}\n`);
    if (offKind === 'empty') fs.writeFileSync(off, '');
    if (offKind === 'unreadable') { fs.writeFileSync(off, `${G2}\n`); fs.chmodSync(off, 0o000); }
    if (offKind === 'dir') fs.mkdirSync(off);
    if (offKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'off-target'), `${G2}\n`); fs.symlinkSync(path.join(home, 'off-target'), off); }
    // The sweep's generation record beside the prediction (Task 5; plantAll made card/<id>/).
    const rec = histDir('card', ID, `${SID}.gen`);
    fs.rmSync(rec, { force: true });
    if (recKind === 'G') fs.writeFileSync(rec, `${GENERATION}\n`);
    if (recKind === 'G2') fs.writeFileSync(rec, `${G2}\n`);
    if (recKind === 'legacy') fs.writeFileSync(rec, '\n');
    if (recKind === 'junk') fs.writeFileSync(rec, 'not-a-generation\n');
    if (recKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'rec-target'), `${GENERATION}\n`); fs.symlinkSync(path.join(home, 'rec-target'), rec); }
  };
  /** The generation B2's CLI compares recall-off/<id> with over the same fixture: lib resolveGeneration's value
   *  when it answers 'env' or 'registry'; under 'newest', the newest family's, which the record stands for
   *  ('' for a legacy family); null when no usable record says it (the store's answer, unknown to the hook).
   *  Never `resolveGeneration(…).value ?? ''`: B2's readContext forbids that comparison under 'newest'. */
  const cliGeneration = (envGen: string, regGen: Pres, recKind: Rec): string | null => {
    const r = lib.resolveGeneration({ envGen, regGen });
    if (r.via !== 'newest') return r.value;
    return recKind === 'G' ? GENERATION : recKind === 'G2' ? G2 : recKind === 'legacy' ? '' : null;
  };
  /** The CLI's reading of the same fixture (B2's presenceOf: absent, unreadable — a symlink or a non-file
   *  included — or the trimmed value), handed to B2's own decideRecallOff with the CLI's generation. `unknown`:
   *  a recall-off value the CLI decides against a store this fixture has none of. */
  const cliVerdict = (envGen: string, regKind: Reg, offKind: Off, recKind: Rec): string => {
    const regGen: Pres = regKind === 'G' ? { state: 'value', value: GENERATION }
      : regKind === 'G2' ? { state: 'value', value: G2 }
        : regKind === 'absent' ? { state: 'absent' } : { state: 'unreadable' };
    const file: Pres = offKind === 'absent' ? { state: 'absent' }
      : offKind === 'G' || offKind === 'G-padded' || offKind === 'G-wide' || offKind === 'G-nbsp' || offKind === 'G-bom'
        ? { state: 'value', value: GENERATION }
        : offKind === 'G2' ? { state: 'value', value: G2 }
          : offKind === 'empty' ? { state: 'value', value: '' } : { state: 'unreadable' };
    const generation = cliGeneration(envGen, regGen, recKind);
    // An absent or unreadable file needs no generation (B2 readContext's offNow): decided now, whatever it is.
    if (generation === null) return file.state === 'value' ? 'unknown' : lib.decideRecallOff({ file, generation: GENERATION });
    return lib.decideRecallOff({ file, generation });
  };
  /** The hook serves exactly when the CLI recalls (`none` or `stale`); `off` and `unknown` withhold. */
  const serves = (verdict: string): boolean => verdict === 'none' || verdict === 'stale';

  it('CONTROL: the parity table reaches every answer, so it cannot pass by serving always or never', () => {
    const verdicts = PARITY.map(([, env, r, o, k]) => cliVerdict(env, r, o, k));
    expect(new Set(verdicts)).toEqual(new Set(['none', 'stale', 'off', 'unknown']));
    // The two R-recalloff-trim rows' CLI reading: presenceOf's String.prototype.trim over the planted text.
    expect([NBSP_G, BOM_G].map((t) => t.trim()), 'the CLI reads both as the generation').toEqual([GENERATION, GENERATION]);
  });

  it.each(parityRows)('C19/C68 (card half), recall-off parity: %s', (_what, envGen, regKind, offKind, recKind) => {
    plantAll();
    plantParity(regKind, offKind, recKind);
    try {
      const verdict = cliVerdict(envGen, regKind, offKind, recKind);
      expect(served(start(), { CCRC_SESSION_GENERATION: envGen }), `the CLI reads ${verdict}`)
        .toBe(serves(verdict) ? LINE : null);
    } finally {
      for (const f of [reg(`${ID}.generation`), histDir('recall-off', ID)]) {
        try { fs.chmodSync(f, 0o700); } catch { /* absent or a symlink */ }
      }
    }
  });

  it.each([
    ['POSIXLY_CORRECT=1', { POSIXLY_CORRECT: '1' }],
    ['LC_ALL=C', { LC_ALL: 'C' }],
    ...(IS_DARWIN ? [] : [['LC_ALL=C.UTF-8', { LC_ALL: 'C.UTF-8' }] as const]),
  ] as const)('the fold puts the line on its own first line under %s', (_what, env) => {
    plantAll();
    plantCompactCard(compactCardOf(600));
    const out = served(start(), env)!;
    expect(out.split('\n').slice(0, 2)).toEqual([LINE, HEADER]);
  });

  it('_hook_history_card is defined above the case, outside it, called only beside the compact card, and spells no fork', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    const def = src.indexOf('\n_hook_history_card() {');
    const kase = src.indexOf('\ncase "$event" in\n');
    expect(def, 'no _hook_history_card definition').toBeGreaterThan(-1);
    expect(def, 'defined after the case: the SessionStart arm would call an undefined function').toBeLessThan(kase);
    expect(src.indexOf('\n_hook_history_card() {', def + 1), 'defined twice').toBe(-1);
    const calls = src.split('\n').filter((l) => !l.trim().startsWith('#') && /_hook_history_card \|\| true/.test(l));
    expect(calls).toEqual(['    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }']);
    const body = src.slice(def, src.indexOf('\n}\n', def));
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    // B1's S1 string pin, in its final grammar, over the reader: no `$(` (an arithmetic `$((` is not one), no backtick,
    // no `${…@…}` transformation (its FR2a: `@P` runs prompt expansion, and so command substitution), and none of its
    // external commands, plus `find` and `link`, which the card path could reach for.
    expect(code, 'a command substitution forks').not.toMatch(/\$\((?!\()/);
    expect(code).not.toContain('`');
    expect(code.match(/\$\{[^}]*@/)?.[0] ?? null, 'a ${…@…} transformation in the reader (@P forks)').toBeNull();
    const external = /(?<![\w-])(jq|cat|date|mkdir|mv|cp|ln|rm|touch|tee|awk|sed|grep|head|tail|tr|cut|stat|find|readlink|realpath|dirname|basename|env|timeout|flock|link|node|python3?|tmux|command|eval|exec|source)(?![\w-])/;
    expect(code.match(external)?.[0] ?? null, 'an external command in the reader').toBeNull();
    // B1's F37 rule: the clock is read once, so its test and its slice see one reading.
    expect((code.match(/\$\{?EPOCHREALTIME\b/g) ?? []).length, 'EPOCHREALTIME expanded more than once').toBe(1);
  });

  itLinux('forks nothing at runtime: serving the line takes exactly the forks a box without history takes', () => {
    const traced = (): { forks: number; stdout: string } => {
      const trace = path.join(home, 'card-trace.txt');
      const r = spawnSync('strace', ['-f', '-o', trace, '-e', 'trace=clone,clone3,fork,vfork', 'bash', HOOK], {
        input: JSON.stringify(start()), encoding: 'utf8', env: hookEnv(SCRUB),
      });
      expect(r.status, `strace ran the hook: ${r.stderr}`).toBe(0);
      const lines = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => l !== '');
      fs.rmSync(trace);
      const root = /^(\d+)\s/.exec(lines[0] ?? '')?.[1];
      expect(root, 'strace traced a fork').toBeDefined();
      // One START line per fork, complete or `<unfinished ...>`; a `resumed` line is the same fork's tail.
      return { forks: lines.filter((l) => new RegExp(`^${root}\\s+(?:clone3?|v?fork)\\(`).test(l)).length, stdout: r.stdout };
    };
    // WARM-UP: the first acquisition on a fresh row mints the stable lock (mktemp + link), which no later run
    // repeats, so one unmeasured serve comes first and the two measured runs start from the same row.
    plantCompactCard(compactCardOf(600));
    expect(served()).not.toBeNull();
    plantCompactCard(compactCardOf(600));        // both runs serve a compact card: the same emit, the same marker
    const without = traced();
    expect(hasLine(card(without.stdout))).toBe(false);
    plantAll();
    plantCompactCard(compactCardOf(600));
    const withLine = traced();
    expect(card(withLine.stdout).startsWith(`${LINE}\n`), 'the measured run served the line').toBe(true);
    expect(withLine.forks).toBe(without.forks);
  }, 60_000);
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history card line')
```

Expected on Linux: `29 failed | 46 passed` among the describe's 75 cases (29 of them parity rows: ruling R-recalloff-parity grew the table from 17 rows to 27, four serving and six withholding, and ruling R-recalloff-trim by two withholding). On Darwin the two `C.UTF-8` rows and the strace case are absent, and under root the three unreadable-file parity rows are skipped. The 29 are every case that expects the line, plus the source pin and the runtime fork pin:
- every case that expects the line fails with `expected null to be 'History: node L03a9c1… (this compacti…'`, or with the folded text, or with `the measured run served the line: expected false to be true`. These are the plain serve, the parent-less and 20-hex lines, C18's reserved card and both inclusive rows, the standing-cards case, C19, C21's two served rows, C22, C37's in-bound marker and its end-to-end case, the id bound, the eleven parity rows whose CLI verdict is `none` or `stale`, and the three fold-under-a-locale rows;
- `_hook_history_card is defined above the case …` fails with `no _hook_history_card definition: expected -1 to be greater than -1`.

The 46 that pass assert that no line is served, which a hook without a reader cannot violate; the parity row `130 spaces followed by the resolved generation` (ruling RC4), the two `R-recalloff: …` rows, the two R-recalloff-trim rows (`a no-break space …` and `a byte-order mark …`) and `EPOCHREALTIME is read once …` are among them. The two R-recalloff-trim rows were measured on an extract of the reader block below (`_ct_read` from origin/main, the env generation G, `.generation` G, the record G, a fresh `main` marker and a prediction), under `LC_ALL=C` and `LC_ALL=C.UTF-8`, each plain and under `bash --posix` with `POSIXLY_CORRECT=1`: the block withholds both in all four, the block without its grammar test (`T9-M39-recall-off-grammar`) serves both in all four, and the same extract's controls (recall-off absent, empty or `G2`: served; `G` or `G-padded`: withheld) agree with the CLI either way. Against the reader as it stood before ruling R-recalloff-parity (no record read; `gen` stays empty when neither the env nor the registry resolves one), eight of the new rows red, measured on an extract of the reader (`_ct_read` from origin/main and the reader block, driven over the 27 rows' fixtures, as a non-root user): the two `R-recalloff: …` rows, `no env or registry generation and recall-off names the recorded newest family`, `an unreadable .generation is no generation, the record decides`, `nothing recorded withholds …`, `a symlinked record …` and `a malformed record …` serve where the CLI exits 8 or its answer is unknown, and `the newest family recorded G and an empty recall-off file reads stale` withholds where the CLI recalls. The reader below passed all 27 on the same extract before ruling R-recalloff-trim made its trim ASCII-only and added the grammar test; no recall-off text among those 27 holds anything but ASCII whitespace and the grammar's characters, so neither change can move one of them, and the R-recalloff-trim extract above re-ran the shapes among them that reach the trim (`G`, `G-padded`, `G2`, `empty`). Step 7's mutants measure every one of them but three. The parity table's CONTROL is pure and guards nothing. C37's `empty` marker row is refused by two guards at once (the scope-word test and the ms digit test), so no single-guard mutant can red it: it is defence in depth, and it is named here rather than claimed measured. The `unset` row of `EPOCHREALTIME %s serves no line …` stays green under `T9-M12-clock-guard`, which reds only the `malformed` row: an empty reading makes `now` 0, which the age test refuses whether or not the clock grammar runs, so that row is an absence pin, named here rather than claimed measured.

- [ ] **Step 4: Write the reader and its call.** In `ccd/session-hook.sh`, directly above the line that begins `state="" ask_json=`, insert these 122 lines and then one blank line. The existing blank line above stays where it is:

```bash
# ── THE HISTORY CARD LINE (ccrc history spec 2026-10-05 §8.6, W1-B3) ─────
# One line folded into the compact subject of SessionStart(compact)'s one
# envelope, `History: node L…… (this compaction)[ · parent N……] ·
# ~/.local/bin/ccrc history describe L…`, naming the leaf this compaction is
# about to become. SessionStart(compact) runs before PostCompact and before the
# indexer can have seen the boundary, so the line is ccd-history-sweep's
# PREDICTION, `card/<id>/<uuid>.txt`: written only at end-of-file, deleted when
# the boundary that consumed it is ingested. This hook only reads it, and
# writes no receipt: delivery is measured from the transcript
# (D-4737 (history-card-measured-from-transcript)).
#
# DEFINED HERE, ABOVE THE `case`: the SessionStart arm calls it, and the arm runs
# inside the case, before the tail. This block is the ONE sanctioned insertion
# above README's anchor into this file (the emitter call in the SessionStart
# arm); README re-points that anchor by content (D-4748 (history-card-reader-above-the-arm)).
#
# BUILTINS ONLY: no command substitution and no external command, because the
# compact card's serve lock may still be held when the arm calls this. `_ct_read`
# is a builtin `read -N` that sets CT_V. The clock is EPOCHREALTIME, read ONCE
# into `t` (each expansion reads the clock anew, so two reads could straddle a
# second: the spool block's rule), and without it no line is served (never a
# `date` fork). `$(( ))` is arithmetic, not a fork.
#
# THE CHECKS, in the spec's order (§8.6):
#   1. the main thread (`$paid` empty);
#   2. history-off absent;
#   3. the id within SPOOL_ID_MAX, and a lowercase-UUID psid (the file's key).
#      `.` and `..` need no test of their own: under scope/ and card/ they name
#      directories, which `_ct_read` and `[[ -f ]]` refuse;
#   4. recall-off/<id>, honoured only when it names THIS family's generation
#      (B2's D-4680 (history-recall-off-generation)): CCRC_SESSION_GENERATION when it has the
#      UUID grammar, else `$REG/<id>.generation` when it does, else the record
#      the sweep wrote beside this prediction, card/<id>/<psid>.gen: the id's
#      newest family's generation, '' for a legacy family or none, which is what
#      B2's CLI compares with then (coordinator ruling R-recalloff-parity). With
#      none of the three, or a linked, unreadable or malformed record, a
#      recall-off file that exists withholds the line (fail closed). It is
#      read the way B2's CLI reads it, so the card and `ccrc history` never put
#      one family in two eval arms: a symlink, a non-file or an unreadable file
#      is OFF (D-4749 (history-card-recall-off-unreadable-off)), and a symlinked or
#      unreadable `.generation` names no generation. The read is CCRC_ID_MAX
#      chars where the CLI's is 4,096 bytes, so a read that FILLS the window is
#      OFF before it is trimmed: a hand edit that pads the file past it withholds
#      the line, never serves one the CLI answers exit 8 for (W2's verb writes
#      37 bytes). The ONE deliberate asymmetry (coordinator ruling
#      R-recalloff-trim): this trim takes ASCII whitespace only, in every
#      locale, where the CLI's JS trim also strips U+00A0, U+FEFF and the
#      Unicode spaces, so a value that still holds a character outside the
#      generation grammar (empty, or [0-9a-f-]) withholds the line: it may
#      withhold where the CLI recalls, never serve where the CLI exits 8;
#   5. the PreCompact scope marker reads `main <psid> <ms>`, the ms no older than
#      COMPACT_CARD_MAX_AGE and not in the future (D-4747 (history-card-main-scope-only));
#   6. one bounded read of the card file, a regular file only (a FIFO would
#      block the read), at most HISTORY_CARD_MAX + 1 chars, ONE trailing LF
#      stripped. The read's bound IS the 512-char cap: the grammar admits no
#      line over 145 chars, so a separate length test would be one no input
#      can reach, and this file does not spell guards nothing can trip. The
#      tests are builtin; a node swapped in after the test is opened: a link is
#      followed, a FIFO blocks until Claude Code kills the hook
#      (install-session-hooks.sh HOOK_TIMEOUT_S), as the spool block says;
#   7. the grammar, one positive pattern held in a variable;
#   8. the room: line + LF + card within COMPACT_CARD_MAX_CHARS.
# THE FOLD puts the line on its own line ABOVE the compact card, and only when it
# fits, so the emitter's `${2:0:$COMPACT_CARD_MAX_CHARS}` clip never cuts the
# card's footer; the render reserves the room in the tail
# (D-4736 (history-card-fold-and-reserve)). The LF is a variable assigned outside the
# quotes, because `$'\n'` inside `${…:+…}` is not expanded under `bash --posix`.
# Nothing here touches COMPACT_SERVE_NONCE, so the line alone stamps no `served`.
#
# The four names below are this file's one spelling of the card's cap, grammar
# and two directories, each bound to lib.mjs's CARD_LINE_MAX, CARD_LINE_PATTERN,
# SCOPE_DIR and CARD_DIR by single-definition.test.ts; the tail derives the
# reserve from the cap (D-4750 (history-hook-card-names-once)).
HISTORY_CARD_MAX=512
HISTORY_CARD_RE='^History: node L[0-9a-f]{6,20}… \(this compaction\)( · parent N[0-9a-f]{6,20}…)? · ~/\.local/bin/ccrc history describe L[0-9a-f]{6,20}$'
HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"
HISTORY_CARD_DIR="$HOME/.ccrc/history/card"
_hook_history_card() {   # folds the history line into CARD_COMPACT; silent; builtins only
  local uuid_re='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  local off="$HOME/.ccrc/history/recall-off/$id" gen="" via="" o="" ms="" now="" t="" s="" f="" v="" nl=$'\n' ws=$' \t\n\v\f\r'
  [[ -z "$paid" ]] || return 0
  [[ -e "$HOME/.ccrc/history-off" ]] && return 0
  (( ${#id} <= 224 )) || return 0
  [[ "$psid" =~ $uuid_re ]] || return 0
  if [[ "${CCRC_SESSION_GENERATION:-}" =~ $uuid_re ]]; then
    gen="$CCRC_SESSION_GENERATION" via=session
  elif [[ ! -L "$REG/$id.generation" ]] && _ct_read "$REG/$id.generation" && [[ "$CT_V" =~ $uuid_re ]]; then
    gen="$CT_V" via=registry
  fi
  [[ -L "$off" ]] && return 0
  if [[ -e "$off" ]]; then
    [[ -f "$off" && -r "$off" ]] || return 0
    IFS= read -r -N "$CCRC_ID_MAX" o 2>/dev/null < "$off"
    (( ${#o} < CCRC_ID_MAX )) || return 0
    o="${o#"${o%%[!$ws]*}"}"; o="${o%"${o##*[!$ws]}"}"
    [[ "$o" == *[!0123456789abcdef-]* ]] && return 0
    if [[ -z "$via" ]]; then
      [[ -L "$HISTORY_CARD_DIR/$id/$psid.gen" ]] && return 0
      _ct_read "$HISTORY_CARD_DIR/$id/$psid.gen" || return 0
      [[ -z "$CT_V" || "$CT_V" =~ $uuid_re ]] || return 0
      gen="$CT_V"
    fi
    [[ "$o" == "$gen" ]] && return 0
  fi
  _ct_read "$HISTORY_SCOPE_DIR/$id" || return 0
  [[ "$CT_V" == "main $psid "* ]] || return 0
  ms="${CT_V#"main $psid "}"
  [[ "$ms" =~ ^[1-9][0-9]{0,15}$ ]] || return 0
  t="${EPOCHREALTIME:-}"
  [[ "$t" =~ ^[1-9][0-9]{0,11}[.,][0-9]*$ ]] || return 0
  s="${t%%[.,]*}" f="${t#*[.,]}000"
  now=$(( s * 1000 + 10#${f:0:3} ))
  (( now >= ms && now - ms <= COMPACT_CARD_MAX_AGE * 1000 )) || return 0
  f="$HISTORY_CARD_DIR/$id/$psid.txt"
  [[ -f "$f" ]] || return 0
  IFS= read -r -N "$(( HISTORY_CARD_MAX + 1 ))" v 2>/dev/null < "$f"
  v="${v%"$nl"}"
  [[ "$v" =~ $HISTORY_CARD_RE ]] || return 0
  (( ${#v} + 1 + ${#CARD_COMPACT} <= COMPACT_CARD_MAX_CHARS )) || return 0
  CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"
  return 0
}
```

The `…` and `·` in `HISTORY_CARD_RE` are U+2026 and U+00B7, written as themselves. An agent's write can decode a backslash-u escape into the character, and can also do the reverse, so write the two characters themselves and check them with Step 4's grep. Then make the in-place edits with one script: the `:2893` call, Task 8's two scope-directory spellings, the turn-marker note and B1's spool-block sentence. Each anchor must occur exactly once, or the script stops before writing anything:

```bash
python3 - <<'PYEOF'
import re
p = 'ccd/session-hook.sh'
t = open(p, encoding='utf8').read()
# The turn-marker note's last line ends in the deviation number its rule was issued under. This plan writes no
# deviation number, so the line is found by pattern and kept verbatim.
turn = re.findall(r'^# that line \(marker-logic-in-the-tail \(D-[0-9]+\)\)\.$', t, flags=re.M)
assert len(turn) == 1, turn
turn = turn[0]
for old, new in [
    ('    [[ "$src" == compact ]] && { _hook_compact_card || true; }\n',
     '    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }\n'),
    # Task 8's three lines that spell the scope directory, now the one constant above the case
    ('  local f="$HOME/.ccrc/history/scope/$id" scope="" ms="" tp="" trig=""\n',
     '  local f="$HISTORY_SCOPE_DIR/$id" scope="" ms="" tp="" trig=""\n'),
    ('[[ -d "$HOME/.ccrc/history/scope" && ! -L "$HOME/.ccrc/history/scope" ]] && [[ ! -e "$HOME/.ccrc/history-off" ]]; then _hook_history_scope',
     '[[ -d "$HISTORY_SCOPE_DIR" && ! -L "$HISTORY_SCOPE_DIR" ]] && [[ ! -e "$HOME/.ccrc/history-off" ]]; then _hook_history_scope'),
    ('[[ -f "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope/$id" && ! -L "$HOME/.ccrc/history/scope" ]] && { : > "$HOME/.ccrc/history/scope/$id"; } 2>/dev/null\n',
     '[[ -f "$HISTORY_SCOPE_DIR/$id" && ! -L "$HISTORY_SCOPE_DIR/$id" && ! -L "$HISTORY_SCOPE_DIR" ]] && { : > "$HISTORY_SCOPE_DIR/$id"; } 2>/dev/null\n'),
    # the turn-marker note's one sentence naming the exception (below the anchor: free to grow)
    (turn + '\n',
     turn + ' ONE SANCTIONED EXCEPTION since\n'
     '# ccrc history W1-B3: `_hook_history_card` and its four constants sit above the\n'
     '# `case`, because the SessionStart arm calls the function before the tail runs.\n'
     "# README's anchor moved with them and was re-pointed by content, so \":2900\" here\n"
     "# reads \"README's anchor\": the emitter call in the SessionStart arm, found by\n"
     '# its text (D-4748 (history-card-reader-above-the-arm)). The rule itself stands.\n'),
    # B1's spool-block sentence, reworded in place
    ('# it is in the tail because nothing new may land above :2900.\n',
     "# it is in the tail because nothing new may land above README's anchor (the\n"
     '# emitter call in the SessionStart arm, found by content).\n'),
]:
    assert t.count(old) == 1, f'{t.count(old)} x {old[:60]!r}'
    t = t.replace(old, new)
open(p, 'w', encoding='utf8').write(t)
print('in-place edits applied')
PYEOF
bash -n ccd/session-hook.sh && echo hook-syntax-ok
grep -cF "HISTORY_CARD_RE='^History: node L[0-9a-f]{6,20}… " ccd/session-hook.sh
awk '/^# ── THE HISTORY CARD LINE/{s=NR} /^state="" ask_json=/{print NR-s}' ccd/session-hook.sh
grep -cF '$HOME/.ccrc/history/scope' ccd/session-hook.sh
```

Expected: `in-place edits applied`, `hook-syntax-ok`, `1` (the grammar holds a literal `…`, not an escape), `123`, and `1`: the one constant, `HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"`, is now the only line that spells it.

- [ ] **Step 5: Re-point README's anchor by content.** README is repaired, never counted. Do it before Step 8 measures: with README stale, the census reads `ccd/session-hook.sh` 22 and `total` 198 (README's stale `:2900` counts as a failing reference into the hook), and the README case reds with `a README anchor stopped naming what its own sentence quotes: expected [ 'ccd/session-hook.sh:2900' ] to deeply equal []`. Both were measured. The hook has a second, comment-line mention of the call (`:2053` at f7e51156f), so the lookup skips comment lines. From the repository root:

```bash
python3 - <<'PYEOF'
import re
hook = open('ccd/session-hook.sh', encoding='utf8').read().split('\n')
q = '_hook_emit_context "$CARD" "$CARD_COMPACT"'
hits = [i + 1 for i, l in enumerate(hook) if q in l and not l.lstrip().startswith('#')]
assert len(hits) == 1, hits
r = open('README.md', encoding='utf8').read()
pat = r'(`_hook_emit_context "\$CARD" "\$CARD_COMPACT"` \(`ccd/session-hook\.sh:)(\d+)(`\))'
found = re.findall(pat, r)
assert len(found) == 1, found
new, k = re.subn(pat, lambda m: f'{m.group(1)}{hits[0]}{m.group(3)}', r)
assert k == 1
open('README.md', 'w', encoding='utf8').write(new)
print(f'README: ccd/session-hook.sh:{found[0][1]} -> :{hits[0]}')
PYEOF
git diff --stat README.md
```

Expected: one line, `README: ccd/session-hook.sh:<old> -> :<old + 123>`, where `<old>` is the number README carried at this task's base. Then `1 file changed, 1 insertion(+), 1 deletion(-)`: README keeps its length, so `CLAUDE.md`'s README figure does not move.

- [ ] **Step 6: Run the cases and see them pass.** In the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history card line|history scope marker')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'first held section forks|the helper runs through|TWO CLIPS|clip ceilings|served. off a set')
```

Expected:
- the first: all 75 cases of this describe (Step 3's count) and Task 8's 21 green, so `96 passed` on Linux as a non-root user. Task 8's `a hookstate write that fails empties an older fresh main marker …` now runs end to end: its SessionStart(compact) meets a real reader and an emptied marker, and serves no line;
- the second: green. It covers the strace pins, the `:2721` argv case, the two-clips case, the spill-budget case and the `served` scan (`raw union matches` 11).

- [ ] **Step 7: Measure every guard red with a mutant.** Tasks 8 to 11 share the runner, which Task 8 Step 6 wrote. From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/mutate.py" ] || { echo 'no mutate.py: write it with the first block of Task 8 Step 6'; exit 1; }
cat > "$SCRATCH/mutants-t9.py" <<'PYEOF'
# Task 9's mutants (W1-B3): each names the guard it deletes or inverts, and the case that must go red.
H, T = 'ccd/session-hook.sh', 'test/session-hook.test.ts'
MUTANTS = [
    ('T9-M1-paid', H, T, 'S2 \\(card half\\)', [
        ('  [[ -z "$paid" ]] || return 0\n  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n',
         '  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n')]),
    ('T9-M2-history-off', H, T, 'S3 \\(card half\\)', [
        ('  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ $uuid_re ]]',
         '  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ $uuid_re ]]')]),
    ('T9-M3-id-bound', H, T, 'the id bound is SPOOL_ID_MAX: a 224-char id is served', [
        ('  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ $uuid_re ]]', '  [[ "$psid" =~ $uuid_re ]]')]),
    ('T9-M4-psid-grammar', H, T, 'not a lowercase UUID serves nothing', [
        ('  [[ "$psid" =~ $uuid_re ]] || return 0\n', '')]),
    ('T9-M5-recall-off-symlink', H, T, 'recall-off parity: a symlink at recall-off', [
        (r'''  [[ -L "$off" ]] && return 0''', r'''  :''')]),
    ('T9-M6-recall-off-unreadable', H, T, 'recall-off parity: an unreadable recall-off file|recall-off parity: a directory at', [
        (r'''    [[ -f "$off" && -r "$off" ]] || return 0''', r'''    :''')]),
    ('T9-M7-generation-symlink', H, T, 'recall-off parity: a symlinked \\.generation', [
        (r'''  elif [[ ! -L "$REG/$id.generation" ]] && _ct_read''', r'''  elif _ct_read''')]),
    ('T9-M8-env-generation-first', H, T, 'recall-off parity: the env generation wins', [
        ('  if [[ "${CCRC_SESSION_GENERATION:-}" =~ $uuid_re ]]; then\n    gen="$CCRC_SESSION_GENERATION" via=session\n  elif', '  if')]),
    ('T9-M9-stale-marker', H, T, 'C37: a scope marker reading older than', [
        (r'''  (( now >= ms && now - ms <= COMPACT_CARD_MAX_AGE * 1000 )) || return 0''', r'''  (( now >= ms )) || return 0''')]),
    ('T9-M10-future-marker', H, T, 'C37: a scope marker reading in the future', [
        (r'''  (( now >= ms && now - ms <= COMPACT_CARD_MAX_AGE * 1000 )) || return 0''', r'''  (( now - ms <= COMPACT_CARD_MAX_AGE * 1000 )) || return 0''')]),
    ('T9-M11-marker-prefix', H, T, 'C37: a scope marker reading a bare ms', [
        (r'''  [[ "$CT_V" == "main $psid "* ]] || return 0''', r'''  :''')]),
    ('T9-M12-clock-guard', H, T, 'EPOCHREALTIME (unset|malformed)', [
        (r'''  [[ "$t" =~ ^[1-9][0-9]{0,11}[.,][0-9]*$ ]] || return 0''', r'''  :''')]),
    ('T9-M13-regular-file', H, T, 'a FIFO at the card path', [
        (r'''  [[ -f "$f" ]] || return 0''', r'''  :''')]),
    ('T9-M14-keep-the-LF', H, T, 'C21: a trailing LF is stripped', [
        (r'''  v="${v%"$nl"}"''', r'''  :''')]),
    ('T9-M15-strip-every-line', H, T, 'C21: ONE trailing LF|C21: an extra line', [
        (r'''  v="${v%"$nl"}"''', r'''  v="${v%%"$nl"*}"''')]),
    ('T9-M16-grammar', H, T, 'C21', [
        (r'''HISTORY_CARD_RE='^History: node L[0-9a-f]{6,20}… \(this compaction\)( · parent N[0-9a-f]{6,20}…)? · ~/\.local/bin/ccrc history describe L[0-9a-f]{6,20}$''' + "'",
         "HISTORY_CARD_RE='^History: '")]),
    ('T9-M17-no-room-test', H, T, 'C18: a 4,000-char card', [
        (r'''  (( ${#v} + 1 + ${#CARD_COMPACT} <= COMPACT_CARD_MAX_CHARS )) || return 0''', r'''  :''')]),
    ('T9-M18-room-exclusive', H, T, 'the room test is inclusive', [
        (r'''  (( ${#v} + 1 + ${#CARD_COMPACT} <= COMPACT_CARD_MAX_CHARS )) || return 0''', r'''  (( ${#v} + 1 + ${#CARD_COMPACT} < COMPACT_CARD_MAX_CHARS )) || return 0''')]),
    ('T9-M19-space-join', H, T, 'C18: a reserved 3,487-char', [
        (r'''  CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"''', r'''  CARD_COMPACT="$v${CARD_COMPACT:+ $CARD_COMPACT}"''')]),
    ('T9-M20-posix-lf', H, T, 'under POSIXLY_CORRECT=1', [
        (r'''  CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"''', r'''  CARD_COMPACT="$v${CARD_COMPACT:+$'\n'$CARD_COMPACT}"''')]),
    ('T9-M21-a-fork', H, T, 'forks nothing at runtime|spells no fork', [
        (r'''  now=$(( s * 1000 + 10#${f:0:3} ))''', r'''  now=$(_hook_epoch_ms)''')]),
    ('T9-M22-served-without-nonce', H, T, 'C22', [
        ('  [[ -n "$COMPACT_SERVE_NONCE" ]] || return 0\n', '')]),
    ('T9-M23-any-source', H, T, 'only a compact SessionStart serves', [
        (r'''    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }''',
         r'''    [[ "$src" == compact ]] && { _hook_compact_card || true; }; _hook_history_card || true''')]),
    ('T9-M24-S8-both-guards', H, T, 'S8 \\(card half\\)', [
        (r'''    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }''',
         r'''    [[ "$src" == compact ]] && { _hook_compact_card || true; }; _hook_history_card || true'''),
        ('  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ $uuid_re ]]',
         '  (( ${#id} <= 224 )) || return 0\n  [[ "$psid" =~ $uuid_re ]]')]),
    ('T9-M25-scope-word-and-psid', H, T, 'C37: a scope marker reading (subagent|ambiguous|another psid)|C37: end to end', [
        ('  [[ "$CT_V" == "main $psid "* ]] || return 0\n  ms="${CT_V#"main $psid "}"\n', '  ms="${CT_V##* }"\n')]),
    ('T9-M26-recall-off-equality', H, T,
     'recall-off parity: (recall-off names this generation|recall-off names it inside whitespace|a malformed env generation falls back to .generation \\(named\\)|a legacy newest family recorded empty|no env or registry generation and recall-off names the recorded|an unreadable .generation is no generation, the record decides)', [
        ('    [[ "$o" == "$gen" ]] && return 0\n', '')]),
    ('T9-M27-card-key', H, T, 'C20: a prediction for another uuid', [
        (r'''  f="$HISTORY_CARD_DIR/$id/$psid.txt"''', r'''  for f in "$HISTORY_CARD_DIR/$id"/*.txt; do break; done''')]),
    ('T9-M28-ms-digits', H, T, 'C37: a scope marker reading a non-numeric ms', [
        (r'''  [[ "$ms" =~ ^[1-9][0-9]{0,15}$ ]] || return 0''' + '\n', '')]),
    ('T9-M29-inherits-compact-card-off', H, T, 'C19: independent of compact-card-off', [
        ('  [[ -z "$paid" ]] || return 0\n  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n',
         '  [[ -z "$paid" ]] || return 0\n  [ -e "$COMPACT_CARD_OFF" ] && return 0\n  [[ -e "$HOME/.ccrc/history-off" ]] && return 0\n')]),
    ('T9-M30-recall-off-window', H, T, 'recall-off parity: 130 spaces', [
        ('    (( ${#o} < CCRC_ID_MAX )) || return 0\n', '')]),
    ('T9-M31-fork-source', H, T, 'only a compact SessionStart serves', [
        (r'''    [[ "$src" == compact ]] && { _hook_compact_card || true; _hook_history_card || true; }''',
         r'''    [[ "$src" == compact || "$src" == fork ]] && { _hook_compact_card || true; _hook_history_card || true; }''')]),
    ('T9-M32-transformation', H, T, 'spells no fork', [
        (r'''  v="${v%"$nl"}"''', r'''  v="${v@P}"''')]),
    ('T9-M33-clock-read-twice', H, T, 'EPOCHREALTIME is read once|spells no fork', [
        ('  t="${EPOCHREALTIME:-}"\n  [[ "$t" =~ ^[1-9][0-9]{0,11}[.,][0-9]*$ ]] || return 0\n  s="${t%%[.,]*}" f="${t#*[.,]}000"\n',
         '  [[ "${EPOCHREALTIME:-}" =~ ^[1-9][0-9]{0,11}[.,][0-9]*$ ]] || return 0\n  s="${EPOCHREALTIME%%[.,]*}" f="${EPOCHREALTIME#*[.,]}000"\n')]),
    # Ruling R-recalloff-parity: the generation record the sweep writes beside the prediction (Task 5).
    ('T9-M34-no-record-read', H, T, 'recall-off parity: (R-recalloff|nothing recorded withholds)', [
        ('    if [[ -z "$via" ]]; then\n      [[ -L "$HISTORY_CARD_DIR/$id/$psid.gen" ]] && return 0\n'
         '      _ct_read "$HISTORY_CARD_DIR/$id/$psid.gen" || return 0\n'
         '      [[ -z "$CT_V" || "$CT_V" =~ $uuid_re ]] || return 0\n      gen="$CT_V"\n    fi\n', '')]),
    ('T9-M35-record-over-env', H, T, 'recall-off parity: the (env|registry) generation wins over the record', [
        ('    if [[ -z "$via" ]]; then\n', '    if :; then\n')]),
    ('T9-M36-record-symlink', H, T, 'recall-off parity: a symlinked record is no record', [
        ('      [[ -L "$HISTORY_CARD_DIR/$id/$psid.gen" ]] && return 0\n', '')]),
    ('T9-M37-no-record-falls-through', H, T, 'recall-off parity: nothing recorded withholds', [
        ('      _ct_read "$HISTORY_CARD_DIR/$id/$psid.gen" || return 0\n', '      _ct_read "$HISTORY_CARD_DIR/$id/$psid.gen"\n')]),
    ('T9-M38-record-grammar', H, T, 'recall-off parity: a malformed record is no record', [
        ('      [[ -z "$CT_V" || "$CT_V" =~ $uuid_re ]] || return 0\n', '')]),
    # Ruling R-recalloff-trim: a value that holds a character outside the generation grammar after the ASCII trim.
    ('T9-M39-recall-off-grammar', H, T, 'recall-off parity: a (no-break space|byte-order mark) before', [
        ('    [[ "$o" == *[!0123456789abcdef-]* ]] && return 0\n', '')]),
]
PYEOF
python3 "$SCRATCH/mutate.py" "$SCRATCH/mutants-t9.py"; echo "rc=$?"
git status --short
```

Run it in the foreground, with a timeout of at least 6240000 ms: 39 mutants, two runs each. Expected: 39 `RED->GREEN` lines, `rc=0`, and only this task's three files modified. Each mutant's red, as measured on a prototype of this exact text for T9-M1 to T9-M24; T9-M25 to T9-M29 were added after the prototype, and their reds were measured on an extract of the reader against the same marker and parity rows. Ruling RC4 then replaced the recall-off read's three `_ct_read` lines with the bounded read, so T9-M6's and T9-M26's anchors are the new read's lines and T9-M30 is new: those three reds are argued from the code, not measured on the prototype. T9-M31 came with ruling Q16, and its red is argued the same way: the SessionStart arm treats `fork` as it treats `startup`, which T9-M23 measured. T9-M32 and T9-M33 came with the re-check against B1's final code (its `${…@…}` form and its read-once clock), and T9-M12's anchor moved to the read-once test: those three reds are argued from the code too (a `NOT MEASURED` among these seven is reported with the case's output). T9-M34 to T9-M38 came with ruling R-recalloff-parity, which also moved T9-M8's anchor (the env branch now sets `via`) and T9-M26's filter (the renamed `newest` rows). Those seven, and T9-M7 over its re-planted row, were measured on an extract of the reader (`_ct_read` from origin/main and this block, driven over the 27 parity rows' fixtures as a non-root user, outside vitest): each reds every row its filter names (T9-M26 and T9-M34 also red rows outside their filters, which other mutants own), and the unmutated block agrees with every row; T9-M5, T9-M6 and T9-M30 were re-measured on the same extract too:

| Mutant | Guard removed or inverted | The case that goes red |
|---|---|---|
| T9-M1-paid | `[[ -z "$paid" ]]` | S2 (card half) |
| T9-M2-history-off | the history-off test | C19 and S3 (card half) |
| T9-M3-id-bound | `(( ${#id} <= 224 ))` | the id bound: `225 chars: expected 'History: node …' to be null` |
| T9-M4-psid-grammar | the psid UUID test | the non-UUID session id |
| T9-M5-recall-off-symlink | `[[ -L "$off" ]]` | parity: a symlink at recall-off/<id> (`the CLI reads off`) |
| T9-M6-recall-off-unreadable | `[[ -f "$off" && -r "$off" ]]` in the recall-off read | parity: the unreadable file and the directory (the read then fails silently, `o` stays empty, and the line is served where the CLI reads off) |
| T9-M7-generation-symlink | `! -L` on `.generation` | parity: a symlinked `.generation` (`the CLI reads stale`) |
| T9-M8-env-generation-first | the env branch | parity: the three env-wins rows (over `.generation`, named and stale, and over the record) |
| T9-M9-stale-marker | the age bound | C37: older than COMPACT_CARD_MAX_AGE |
| T9-M10-future-marker | `now >= ms` | C37: in the future |
| T9-M11-marker-prefix | `[[ "$CT_V" == "main $psid "* ]]` | C37: a bare ms |
| T9-M12-clock-guard | the clock grammar test on `t` | the `malformed` row only: `exit 0 on every path: expected 1 to be +0` (`$(( s * 1000 + … ))` meets the unbound name `not` in `not-a-clock` under `set -u` and aborts). The `unset` row stays green under this mutant: an empty `t` gives `s=""` and `f="000"`, bash arithmetic reads the empty `s` as 0, so `now` is 0, the age test fails and nothing is served (measured on the reader's lines under `set -u`, bash 5.2: exit 0 for the empty reading, `not: unbound variable` and exit 1 for `not-a-clock`). The `unset` row is an absence pin, as the parity CONTROL is |
| T9-M13-regular-file | `[[ -f "$f" ]]` | the FIFO: `the hook blocked on the FIFO: expected null to be +0` (it waits out the 20 s deadline) |
| T9-M14-keep-the-LF | the one-LF strip | C21: a trailing LF |
| T9-M15-strip-every-line | the strip made greedy | C21: two LFs, and an extra line |
| T9-M16-grammar | the grammar made `^History: ` | 8 of C21's 11 rows, over-512 among them |
| T9-M17-no-room-test | the room test | C18's 4,000-char card: the footer cut |
| T9-M18-room-exclusive | `<=` made `<` | both inclusive rows |
| T9-M19-space-join | the LF join made a space | C18's reserved card |
| T9-M20-posix-lf | `$nl` made `$'\n'` inside `${…:+…}` | the fold under POSIXLY_CORRECT=1 |
| T9-M21-a-fork | the inline clock made `$(_hook_epoch_ms)` | the source pin and the strace pin (`expected 23 to be 22` in the prototype) |
| T9-M22-served-without-nonce | `_hook_compact_mark_served`'s nonce test, which C22 relies on | C22: `expected [ '.demo-quiet-basin.compactserved.' ] to deeply equal []` |
| T9-M23-any-source | the call moved out of the compact guard | only a compact SessionStart serves: `startup: expected true to be false` |
| T9-M24-S8-both-guards | the compact guard AND the history-off test | S8 (card half). Either guard alone keeps S8 green, which is why each has its own case above |
| T9-M25-scope-word-and-psid | the `main <psid> ` prefix test and its strip, replaced by taking the last word | C37's `subagent`, `ambiguous` and `another psid` rows (`expected 'History: node …' to be null`), and C37's end-to-end case at the subagent's compaction. T9-M11 alone cannot red those rows: the strip that follows it leaves the whole marker, which the digit test refuses |
| T9-M26-recall-off-equality | the OFF test `[[ "$o" == "$gen" ]]` | the parity rows whose CLI verdict is `off` by the equality: names this generation, inside whitespace, the malformed env's named row, a legacy newest family recorded empty beside an empty file, recall-off naming the recorded newest family, and an unreadable `.generation` with the record deciding (`the CLI reads off: expected 'History: node …' to be null`) |
| T9-M27-card-key | the card path keyed on `$psid`, made the first `*.txt` in `card/<id>/` | C20: `expected 'History: node …' to be null` |
| T9-M28-ms-digits | the ms digit test | C37's `non-numeric ms`: `exit 0 on every path: expected 1 to be +0` (`soon: unbound variable` inside `$(( ))`, a `set -u` abort) |
| T9-M29-inherits-compact-card-off | none: it ADDS compact-card-off's test to the reader, the inheritance §8.6 forbids | C19, independent of compact-card-off: `expected null to be 'History: node …'` |
| T9-M30-recall-off-window | `(( ${#o} < CCRC_ID_MAX ))`, the window test ruling RC4 adds | parity: 130 spaces followed by the resolved generation G (`the CLI reads off: expected 'History: node …' to be null`: the read keeps 128 spaces, which trim to empty, and an empty value is not this generation) |
| T9-M31-fork-source | the compact guard widened to `fork`, the source B2 spools (ruled Q16) | only a compact SessionStart serves: `fork: expected true to be false` (the startup, resume and clear rows stay green under it) |
| T9-M32-transformation | none: it makes the one-LF strip `v="${v@P}"`, a `${…@…}` transformation (`@P` runs prompt expansion, so command substitution) | the source pin: `a ${…@…} transformation in the reader (@P forks): expected '${v@' to be null` |
| T9-M33-clock-read-twice | the one read into `t`, made the two-expansion form (the grammar test on one reading, the slice on another) | `EPOCHREALTIME is read once …`: `a line served on a clock no single reading gave: expected 'History: node …' to be null` (the slice takes 1700000001 whole as the fraction's digits, so `now` reads 1700000001170, and the marker 70 ms old); and the source pin: `EPOCHREALTIME expanded more than once: expected 3 to be 1` |
| T9-M34-no-record-read | the whole record read (ruling R-recalloff-parity): with neither the env nor the registry resolving a generation, `gen` stays empty, as before the ruling | parity: both `R-recalloff: …` rows and `nothing recorded withholds …` (`the CLI reads off` / `the CLI reads unknown: expected 'History: node …' to be null`) |
| T9-M35-record-over-env | `[[ -z "$via" ]]`: the record read whatever resolved the generation | parity: `the env generation wins over the record` and `the registry generation wins over the record` (`the CLI reads stale: expected null to be 'History: node …'`) |
| T9-M36-record-symlink | `[[ -L … .gen ]]` | parity: `a symlinked record is no record` (`the CLI reads unknown`) |
| T9-M37-no-record-falls-through | the `return 0` on the record's `_ct_read` failing: an absent record read as `''` | parity: `nothing recorded withholds …` (`the CLI reads unknown`) |
| T9-M38-record-grammar | the record's grammar test (empty or a UUID) | parity: `a malformed record is no record` (`the CLI reads unknown`) |
| T9-M39-recall-off-grammar | the recall-off grammar test after the ASCII trim (coordinator ruling R-recalloff-trim) | parity: `a no-break space before the resolved generation G` and `a byte-order mark before the resolved generation G` (`the CLI reads off: expected 'History: node …' to be null`). Measured on an extract of the reader under `LC_ALL=C` and `C.UTF-8`, plain and `--posix`: the unmutated block withholds both, this mutant serves both |

A `NOT MEASURED` row means its case is wrong: fix the case, never the mutant. Never use `git stash`.

C37's `empty` row is refused by both the prefix test and the digit test, so no single mutant above reds it; it is defence in depth, as Step 3 says.

- [ ] **Step 8: Re-measure the S6-R11 census: the one hook insertion above README's anchor.** Run the instrument with both cited files swapped, against this task's base, through Task 8's `cite-run.sh`: this step runs it over this task's uncommitted reader, `:2893` edit and README re-point, which a killed run would otherwise lose. From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/cite-remeasure.py" ] && [ -f "$SCRATCH/cite-run.sh" ] || { echo 'no cite-remeasure.py or cite-run.sh: write both with Task 8 Step 7'; exit 1; }
bash "$SCRATCH/cite-run.sh" ccd/session-hook.sh,README.md
```

`--files` must name the hook. With the default, only `ccd/ccd` and README are swapped, the edited hook stays in the base leg, and `base` reads red. The census was measured on a prototype that carried this block before ruling RC4, 95 lines in all, over origin/main plus B1's spool block. RC4 grew the block to 101 lines in all, the re-check against B1's final code (the one clock read, the swap residue named) to 106, ruling R-recalloff-parity (the generation record's read and its header sentence) to 117, and ruling R-recalloff-trim (the recall-off grammar test and its header sentence) to 123, every added line inside it. The census keys do not depend on the block's length, because no spec or plan anchor lies between the highest corpus anchor (`:2472`) and the insertion. Only README's re-pointed number moves with the length, by Step 5's content lookup. So the expectation below stands for the 123-line block, and this run is its measurement:
- `files swapped to HEAD: ccd/session-hook.sh, README.md`, and last `keep-cite: the tree matches its copies; copies removed`;
- every `byFile[…]` line `stated N  base N  tree N` with no `<-- MOVED or unstated`, `total` likewise, at the values B3's base carries. Trust the printed `stated` at this base; this plan quotes no number, because B1's, B2's and other programmes' merges can move them;
- `ENTERED []` / `LEFT    []` for the composition, the row array and the site array.

If anything moved, the insertion landed above a cited anchor, or README was not re-pointed. Find which and fix it; never `--write`. Then write the dated paragraph. The script reads the date with `date -u` and the base with `git rev-parse`, and takes both numbers from the test's own literals. It quotes none of the instrument's anchor strings, which the instrument asserts occur exactly once:

```bash
python3 - "$(date -u +%F)" "$(git rev-parse --short=9 HEAD)" <<'PYEOF'
import re, sys
date, base = sys.argv[1], sys.argv[2]
p = 'server/test/session-hook.test.ts'
t = open(p, encoding='utf8').read()
m = re.findall(r"^      'ccd/ccd': (\d+),$", t, re.M)
h = re.findall(r"^    expect\(total, 'the narrated headline is the sum of the census, and this is it'\)\.toBe\((\d+)\);$", t, re.M)
assert len(m) == 1 and len(h) == 1, (m, h)
n, total = m[0], h[0]
para = (
    f"      // {n} -> {n} at ccrc history W1-B3 (Task 9), measured {date} by `cite-remeasure.py` with\n"
    f"      // `--files ccd/session-hook.sh,README.md` against `{base}`: stated = base = tree for every key,\n"
    "      // `ENTERED []`, `LEFT []`, and the row and site arrays unmoved. The hook gained one block ABOVE\n"
    "      // README's anchor (`_hook_history_card` and its four constants, 123 lines with their blank line,\n"
    "      // defined above the event `case` because the SessionStart arm calls it before the tail runs), and\n"
    "      // every spec and plan anchor into the hook sits above that block (the highest is `:2472`), so none\n"
    "      // moved. README's own anchor moved with the block, and README is repaired, never counted: its quoted\n"
    "      // emitter call was re-pointed by content before this map was measured. Every other hook edit is in\n"
    "      // place or in the tail. Both corpus documents are byte-identical to `origin/main`. S6-R11, no D-number.\n"
)
t = t.replace(f"      'ccd/ccd': {n},\n", para + f"      'ccd/ccd': {n},\n", 1)
head = f"    expect(total, 'the narrated headline is the sum of the census, and this is it').toBe({total});\n"
t = t.replace(head, f"    // {total} -> {total} at ccrc history W1-B3 (Task 9), {date}: stated, base and tree {total}, no key moved (argued beside the map).\n" + head, 1)
open(p, 'w', encoding='utf8').write(t)
print(f'paragraph written: {n} -> {n}, {total} -> {total}, {date}, base {base}')
PYEOF
```

Then re-run the instrument once more, because the paragraph must not disturb its anchors. Expect the same output as above. Run the citation cases and check the frozen corpus:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
bash "$SCRATCH/cite-run.sh" ccd/session-hook.sh,README.md
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus')
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: the instrument unchanged, `7 passed`, and `corpus-frozen`.

- [ ] **Step 9: Run every suite that reads the hook or README, in the foreground.** Re-run a red in a known load-flake file alone before calling it a break:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/install-session-hooks.test.ts test/macos-platform.test.ts test/compact-card-ship.test.ts test/compact-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook-turnmark.test.ts test/session-hook-merge-deny.test.ts test/session-hook-sync-advisory.test.ts test/hookstate.test.ts test/ci-testmap.test.ts)
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/oss-metadata.test.ts test/topology-clean.test.ts test/readme-roster-mirror.test.ts test/source-bytes.test.ts)
```

Expected: every file green.

- [ ] **Step 10: Commit, gated on the census guard's own result and the empty scratch copies.** First, in its own call, re-run the README case and the citation debt, and check that no runner left a copy behind, and read the result:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'README HAS|CITATION DEBT')
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
test -z "$(ls -A "$SCRATCH/keep" 2>/dev/null)" && test -z "$(ls -A "$SCRATCH/keep-cite" 2>/dev/null)" && echo RESTORED
```

It must read `2 passed`, then `RESTORED`. Only then, in a separate call, commit. The hook insertion, the `:2893` edit, the README re-point and the census paragraph go into one commit: a red census between two commits is a red PR.

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts README.md
git commit -m "feat(history): the card line, read and folded by SessionStart(compact) (W1-B3 task 9)

_hook_history_card is defined above the hook's event case, the one
sanctioned insertion above README's anchor. It is builtin-only and reads the
sweep's prediction card/<id>/<psid>.txt only for a main compaction (a fresh
'main <psid> <ms>' scope marker) outside history-off and the family's own
recall-off. It requires one grammar and folds the line above the compact
card only when both fit the compact clip. README's anchor is re-pointed by
content, and the S6-R11 census is re-measured: no key moved."
```

### Task 10: Hook: the 513-char reserve (`:1515` in place, a tail reset and a PreCompact-gated set)

**Files:**
- Modify: `ccd/session-hook.sh`:
  - In place, line-neutral, inside `_hook_compact_pre`'s helper argv: `    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \` (`:1515` at f7e51156f and at origin/main; the only line of the file with that text) becomes `    --max-chars "$(( COMPACT_CARD_MAX_CHARS - ${HISTORY_CARD_RESERVE:-0} ))" --max-files "$COMPACT_WORKSET_MAX" \`. Keep the trailing backslash. No corpus document cites `:1515`.
  - In the tail: twelve lines, inserted directly above Task 8's comment that begins ``# `CS_SCOPE` is the compaction card's scope verdict, a plain global with no``. That puts them above `unset CS_SCOPE` and the `_hook_compact_pre` call, and below every anchor.
- Test: `server/test/session-hook.test.ts`, one describe appended after Task 9's.

**Interfaces:**
- Consumes:
  - Task 9's `HISTORY_CARD_MAX` (512) and `HISTORY_CARD_DIR` (`"$HOME/.ccrc/history/card"`), both assigned above the `case`, so both are set in the tail;
  - `COMPACT_CARD_MAX_CHARS` (4000, `:2464`);
  - `event`, and Task 8's `unset CS_SCOPE` comment as the anchor;
  - Task 1's `CARD_LINE_MAX` (lib, test only);
  - the test file's module scope: `runFull`, `hookEnv(env)` (B1's one spawn env; the strace spawn takes `env: hookEnv(SCRUB)`), `home`, `HOOK`, `GENERATION`, `stub(name, body)`, `HELPER_ONLY` (narrows a `timeout` stub to the helper's call), `plantHelper()`, `cardTree()`, `plantSession`, `workLines(tree)`, `preCompact`, `itLinux` and `spawnSync`.
- Produces:
  - `HISTORY_CARD_RESERVE`: 0 on every run, and `HISTORY_CARD_MAX + 1` (513) on PreCompact when `card/` exists and `history-off` is absent;
  - the helper's `--max-chars`: `COMPACT_CARD_MAX_CHARS - HISTORY_CARD_RESERVE`, so 3487 on a history box and 4000 elsewhere.
  - Task 9's fold then always has room above a reserved card: the longest grammar-valid line is 145 chars.

**Spec:** §8.6 "The room is reserved in the render" (the in-place `:1515`, the tail set, the builtin tests, a box without history rendering at 4,000), §8.9 C38, §13 (no fork on the hook's path; one envelope, no new budget). Departure: D-4736 (`history-card-fold-and-reserve`).

**Choices this task makes:**
- **The reserve is reset to 0 on every run**, before the gated set. That is the hook's `hcat=""` precedent: a value the environment must not supply is reset. Without the reset, an exported `HISTORY_CARD_RESERVE=999999` renders at `-995999`, which the helper's argument parser refuses, so no compact card is written. An exported `abc` aborts `$(( ))` under `set -u`. One case pins each.
- **The event test comes first**, so no other event pays the `card/` stat. A PostToolUse is the hot path. A case runs one under `strace -e trace=file` and finds no syscall naming the card directory.
- **513 is never spelled.** It is `HISTORY_CARD_MAX + 1`, and Task 11 pins that spelling. Spec C38's 3,487 is `4000 - 513`; the reserve is about 3.5 times the longest valid line, and C38 pins it, so it stays.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -cxF '    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \' ccd/session-hook.sh
grep -cxF "# \`CS_SCOPE\` is the compaction card's scope verdict, a plain global with no" ccd/session-hook.sh
grep -cxF 'unset CS_SCOPE' ccd/session-hook.sh
grep -cE '^HISTORY_CARD_(MAX|DIR)=' ccd/session-hook.sh
grep -c 'HISTORY_CARD_RESERVE' ccd/session-hook.sh
```

Expected: `1`, `1`, `1`, `2`, `0`.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/session-hook.test.ts`, after Task 9's describe:

```ts
// ── ccrc history: the compact card's reserved room (history spec 2026-10-05 §8.6, §8.9 C38; W1-B3 task 10) ──
// APPENDED, with NO new import line: the citation census cites this file by line. `run`/`runFull`/`hookEnv`/`home`/
// `HOOK`/`stub`/`HELPER_ONLY`/`plantHelper`/`cardTree`/`plantSession`/`workLines`/`preCompact` are this
// file's module-level fixture.
describe('history card reserve: the compact card renders HISTORY_CARD_MAX + 1 chars short on a history box (spec §8.6, C38)', () => {
  /** spec §10.1, as B1's spool describe scrubs: the operator's session, and every inherited `CCRC_RECALL_*`. */
  const SCRUB: Record<string, string> = {
    TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
    ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('CCRC_RECALL_')).map((k) => [k, ''])),
  };
  const cardDir = (): string => path.join(home, '.ccrc', 'history', 'card');
  /** PreCompact through the real arm with a stub `timeout` recording the helper's argv (the `:2721` case's idiom). */
  const helperArgv = (env: Record<string, string> = {}): string => {
    const tree = cardTree(); plantHelper();
    stub('timeout', [HELPER_ONLY, 'printf \'%s\\n\' "$*" > "$HOME/timeout-argv"; shift; exec "$@"'].join('\n'));
    const { transcript } = plantSession({ lines: workLines(tree) });
    const r = runFull(preCompact(tree, transcript), { ...SCRUB, ...env });
    expect(r).toEqual({ stdout: '', stderr: '' });
    return fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8');
  };

  it('C38: card/ present — the helper renders at 4000 - (HISTORY_CARD_MAX + 1) = 3487', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    fs.mkdirSync(cardDir(), { recursive: true, mode: 0o700 });
    expect(4000 - (lib.CARD_LINE_MAX + 1)).toBe(3487);
    expect(helperArgv()).toContain(' --max-chars 3487 --max-files 12 ');
  });

  it('C38: card/ absent — 4000, exactly as before history', () => {
    expect(helperArgv()).toContain(' --max-chars 4000 --max-files 12 ');
  });

  it('history-off present beside card/ — 4000', () => {
    fs.mkdirSync(cardDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(home, '.ccrc', 'history-off'), '');
    expect(helperArgv()).toContain(' --max-chars 4000 --max-files 12 ');
  });

  it.each(['999999', 'abc'])('an exported HISTORY_CARD_RESERVE=%s is reset — 4000, exit 0, silent', (value) => {
    expect(helperArgv({ HISTORY_CARD_RESERVE: value })).toContain(' --max-chars 4000 --max-files 12 ');
  });

  itLinux('no other event pays for it: a PostToolUse with card/ present names no history path in any syscall', () => {
    fs.mkdirSync(cardDir(), { recursive: true, mode: 0o700 });
    const trace = path.join(home, 'reserve-trace.txt');
    const r = spawnSync('strace', ['-f', '-o', trace, '-e', 'trace=file', 'bash', HOOK], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, cwd: home }), encoding: 'utf8',
      env: hookEnv(SCRUB),
    });
    expect(r.status, `strace ran the hook: ${r.stderr}`).toBe(0);
    const touched = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => l.includes('/.ccrc/history/card'));
    expect(touched, 'a PostToolUse stats the card directory').toEqual([]);
  }, 60_000);

  it('the reserve is spelled from HISTORY_CARD_MAX, reset unconditionally, and set directly above the scope reset', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src).toContain('    --max-chars "$(( COMPACT_CARD_MAX_CHARS - ${HISTORY_CARD_RESERVE:-0} ))" --max-files "$COMPACT_WORKSET_MAX" \\\n');
    const reset = src.indexOf('\nHISTORY_CARD_RESERVE=0\n');
    const set = src.indexOf('\n[[ "$event" == PreCompact ]] && [[ -d "$HISTORY_CARD_DIR" ]] && [[ ! -e "$HOME/.ccrc/history-off" ]] && HISTORY_CARD_RESERVE=$(( HISTORY_CARD_MAX + 1 ))\n');
    expect(reset, 'no unconditional reset').toBeGreaterThan(-1);
    expect(set, 'no PreCompact-gated set').toBeGreaterThan(reset);
    expect(set, 'the reserve must be set before the card renders').toBeLessThan(src.indexOf('\nunset CS_SCOPE\n'));
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history card reserve')
```

Expected: `2 failed | 5 passed` among the describe's 7 cases (6 on Darwin, without the strace case):
- `C38: card/ present …` fails with `expected '8 node …/.cc-sessions/compact-card.mjs card --transcript …' to contain ' --max-chars 3487 --max-files 12 '`;
- `the reserve is spelled from HISTORY_CARD_MAX …` fails with `expected '#!/usr/bin/env bash\n# session-hook.s…' to contain '    --max-chars "$(( COMPACT_CARD_MAX…'`.

The five that pass assert today's 4000, which no reserve exists yet to change. Step 6's mutants measure them.

- [ ] **Step 4: Write the reserve.** In `ccd/session-hook.sh`, replace the `:1515` line in place:

```bash
python3 - <<'PYEOF'
p = 'ccd/session-hook.sh'
t = open(p, encoding='utf8').read()
old = '    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \\\n'
new = '    --max-chars "$(( COMPACT_CARD_MAX_CHARS - ${HISTORY_CARD_RESERVE:-0} ))" --max-files "$COMPACT_WORKSET_MAX" \\\n'
assert t.count(old) == 1, t.count(old)
open(p, 'w', encoding='utf8').write(t.replace(old, new))
print('reserve wired into the render')
PYEOF
```

Then, directly above the comment line that begins ``# `CS_SCOPE` is the compaction card's scope verdict, a plain global with no``, insert these twelve lines:

```bash
# THE HISTORY CARD'S ROOM (ccrc history spec 2026-10-05 §8.6, W1-B3). The compact
# card renders HISTORY_CARD_MAX + 1 chars short (`_hook_compact_pre`'s
# `--max-chars` subtracts HISTORY_CARD_RESERVE), so the history line and its LF
# always fit above it inside the one compact clip and never cost it its footer
# (D-4736 (history-card-fold-and-reserve)). Only on PreCompact, and only when the sweep
# has made card/ and history-off is absent: a box without history renders at
# COMPACT_CARD_MAX_CHARS exactly as before. Builtin tests, the event first, so
# no other event pays a stat. RESET FIRST, on every run (the `hcat` reset's
# reasoning): an exported HISTORY_CARD_RESERVE must never shrink a card, and a
# non-numeric one would abort the `$(( ))` under `set -u`.
HISTORY_CARD_RESERVE=0
[[ "$event" == PreCompact ]] && [[ -d "$HISTORY_CARD_DIR" ]] && [[ ! -e "$HOME/.ccrc/history-off" ]] && HISTORY_CARD_RESERVE=$(( HISTORY_CARD_MAX + 1 ))
```

Check:

```bash
bash -n ccd/session-hook.sh && echo hook-syntax-ok
grep -c 'HISTORY_CARD_RESERVE' ccd/session-hook.sh
```

Expected: `hook-syntax-ok`, then `5`: the `:1515` read, the reset, the set, and two comment lines.

- [ ] **Step 5: Run the cases and see them pass, with the pins they sit beside.** In the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'history card reserve|history card line|history scope marker')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the helper runs through|the constants are the spec|TWO CLIPS|clip ceilings|first held section forks|p95|costs no more than')
```

Expected:
- the first: green, `103 passed` on Linux as a non-root user (7 + 75 + 21: Task 9's describe holds 75 cases, its 29 parity rows among them);
- the second: green. It covers the `:2721` pin, which still reads ` --max-chars 4000 --max-files 12 ` because its fixture has no `card/`; the constants pin (`COMPACT_CARD_MAX_CHARS=4000` unchanged); the two clips; the spill budget; the strace multisets; and the PostToolUse p95 and SessionStart ratio cases. The reserve's builtin tests cost those runs nothing measurable. `session-hook.test.ts` is a known load-flake file: re-run a timing red alone before calling it a break.

- [ ] **Step 6: Measure every guard red with a mutant.** From the repository root, with a timeout of at least 1800000 ms:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/mutate.py" ] || { echo 'no mutate.py: write it with the first block of Task 8 Step 6'; exit 1; }
cat > "$SCRATCH/mutants-t10.py" <<'PYEOF'
# Task 10's mutants (W1-B3): each names the guard it deletes or inverts, and the case that must go red.
H, T = 'ccd/session-hook.sh', 'test/session-hook.test.ts'
MUTANTS = [
    ('T10-M1-no-reset', H, T, 'an exported HISTORY_CARD_RESERVE', [
        ('HISTORY_CARD_RESERVE=0\n[[ "$event" == PreCompact ]]', '[[ "$event" == PreCompact ]]')]),
    ('T10-M2-no-card-dir-test', H, T, 'C38: card/ absent', [
        (r''' && [[ -d "$HISTORY_CARD_DIR" ]] && [[ ! -e''', r''' && [[ ! -e''')]),
    ('T10-M3-no-history-off-test', H, T, 'history-off present beside card/', [
        (r''' && [[ ! -e "$HOME/.ccrc/history-off" ]] && HISTORY_CARD_RESERVE=''', r''' && HISTORY_CARD_RESERVE=''')]),
    ('T10-M4-stat-first', H, T, 'no other event pays for it', [
        (r'''[[ "$event" == PreCompact ]] && [[ -d "$HISTORY_CARD_DIR" ]] &&''', r'''[[ -d "$HISTORY_CARD_DIR" ]] && [[ "$event" == PreCompact ]] &&''')]),
    ('T10-M5-render-unreserved', H, T, 'C38: card/ present', [
        (r'''    --max-chars "$(( COMPACT_CARD_MAX_CHARS - ${HISTORY_CARD_RESERVE:-0} ))" --max-files''', r'''    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files''')]),
]
PYEOF
python3 "$SCRATCH/mutate.py" "$SCRATCH/mutants-t10.py"; echo "rc=$?"
git status --short
```

Expected: five `RED->GREEN` lines, `rc=0`, and only `ccd/session-hook.sh` and `server/test/session-hook.test.ts` modified. As measured on a prototype of this exact text:

| Mutant | Guard removed | The case that goes red |
|---|---|---|
| T10-M1-no-reset | the unconditional `HISTORY_CARD_RESERVE=0` | both exported-value rows: `999999` reads `--max-chars -995999`; `abc` aborts, `exit 0 on every path: expected 1 to be +0` |
| T10-M2-no-card-dir-test | `[[ -d "$HISTORY_CARD_DIR" ]]` | C38 card/ absent: `expected '8 node …' to contain ' --max-chars 4000 --max-files 12 '` |
| T10-M3-no-history-off-test | the history-off test | history-off beside card/: the same message |
| T10-M4-stat-first | the event test moved after the stat | the PostToolUse strace case: `a PostToolUse stats the card directory: expected [ Array(1) ] to deeply equal []` |
| T10-M5-render-unreserved | the `:1515` subtraction | C38 card/ present: `… to contain ' --max-chars 3487 --max-files 12 '` |

- [ ] **Step 7: Re-measure the S6-R11 census.** `:1515` is edited in place and the rest is in the tail, so the forecast is zero movement. Measure it, through Task 8's `cite-run.sh` (it runs over this task's uncommitted edits). From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/cite-remeasure.py" ] && [ -f "$SCRATCH/cite-run.sh" ] || { echo 'no cite-remeasure.py or cite-run.sh: write both with Task 8 Step 7'; exit 1; }
bash "$SCRATCH/cite-run.sh" ccd/session-hook.sh,README.md
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus')
```

Expected:
- every `byFile[…]` line reads `stated N  base N  tree N`, with `ENTERED []` and `LEFT    []` three times, and the last line of the run reads `keep-cite: the tree matches its copies; copies removed`. README's anchor does not move: nothing is inserted above the emitter call;
- then `7 passed`.

If anything moved, a line landed above an anchor: move it, never `--write`. Then run the hook's suites once, in the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/install-session-hooks.test.ts test/macos-platform.test.ts test/compact-card-ship.test.ts)
```

Expected: every file green.

- [ ] **Step 8: Confirm the scratch copies are gone, then commit.** First, in its own call:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
test -z "$(ls -A "$SCRATCH/keep" 2>/dev/null)" && test -z "$(ls -A "$SCRATCH/keep-cite" 2>/dev/null)" && echo RESTORED
```

It must print `RESTORED`; on anything else, restore as Task 8 Step 8 says. Only then, in a separate call, on this workspace's branch:

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(history): the compact card renders 513 chars short on a history box (W1-B3 task 10)

_hook_compact_pre's --max-chars subtracts HISTORY_CARD_RESERVE, which the
tail resets to 0 on every run and sets to HISTORY_CARD_MAX + 1 on PreCompact
when ~/.ccrc/history/card exists and history-off is absent, so the history
line always fits above the card. A box without history renders at 4000, as
before. Builtin tests, the event first; census unmoved."
```

### Task 11: single-definition: the hook half of the card grammar, cap and prefix

**Files:**
- Modify: `server/test/single-definition.test.ts`. It is a citation-corpus file, cited at `:32-37`, `:1274` and `:1298-1327`, and every edit below lies in its end region, under those lines:
  - in place, in B1's end-appended O14 describe, whose title is `'ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses (spec 2026-10-05 §9.11 O14)'`: its `const VOCABS = [` array gains B3's twelve names before its closing `] as const;`, and its case title `'COVERAGE is this-box, and the word is a literal in lib.mjs alone; CARD_PREFIX is declared (its hook half lands in B3)'` is reworded;
  - one describe appended after the file's last line, with no import line.
- Test: `server/test/single-definition.test.ts`.

**Interfaces:**
- Consumes:
  - from B1's end-appended O14 describe: only its `it.each(VOCABS)` row `'%s is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen'`, which re-runs over the widened `VOCABS`. That describe stays the sole consumer of `DECL_CORPUS` and `declares`, which are local to its callback, so the appended describe cannot see them and does not use them; nor does it use the module-scope `HISTORY_DIR` or `HISTORY_MJS`. Each is found by its name (`const DECL_CORPUS =`, `const declares =`, `const HISTORY_DIR =`, `const HISTORY_MJS =`); no step reads a line number of them, and B1's fix rounds moved them;
  - from the file's module scope: `ccrcRoot` (`:32`), `codeLines(f)` (`const codeLines = (f: string): string[] =>`; a bash file's lines that are not comments), `path`. These are the new describe's only dependencies;
  - from `ccd/history/lib.mjs`, by dynamic import:
    - B1: `CARD_PREFIX` (`'History: '`) and `HISTORY_ROOT_REL` (`'.ccrc/history'`);
    - B2: `RECALL_OFF_DIR` (`'recall-off'`);
    - Task 1: `CARD_LINE_PATTERN`, `CARD_LINE_RE`, `CARD_LINE_MAX` (512), `CARD_DIR` (`'card'`), `SCOPE_DIR` (`'scope'`), `CARD_DESCRIBE_CMD` and `PURGED_FILES_GRACE_MS`;
    - Task 3: `CARD_MEASURE_ROWS`, `CARD_MEASURE_MAX_WAIT_MS`, `CARD_ATTACHMENT_MAX_BYTES`, and the rulings' `SCOPE_MARKER_MAX_AGE_MS` (RC3), `CARD_CONSUMED_SCOPES` (RC3) and `CARD_WITHDRAW_REASONS` (RC2).
  - From the hook: Task 9's four constants and its recall-off path, Tasks 9 and 10's two spellings of `HISTORY_CARD_MAX + 1`, and the pre-existing `COMPACT_CARD_MAX_AGE=1200` (`:2482` at f7e51156f), whose age `SCOPE_MARKER_MAX_AGE_MS` restates in ms.
- Produces:
  - the describe `'ccrc history card line: the hook and lib spell one grammar, one cap and one prefix (spec 2026-10-05 §8.6, O14)'`, with six cases;
  - `VOCABS` gains `'CARD_LINE_PATTERN', 'CARD_LINE_MAX', 'CARD_DIR', 'SCOPE_DIR', 'CARD_DESCRIBE_CMD', 'CARD_MEASURE_ROWS', 'CARD_MEASURE_MAX_WAIT_MS', 'CARD_ATTACHMENT_MAX_BYTES', 'PURGED_FILES_GRACE_MS', 'SCOPE_MARKER_MAX_AGE_MS', 'CARD_CONSUMED_SCOPES', 'CARD_WITHDRAW_REASONS'`: every constant B3 adds to lib, so none can be declared a second time anywhere in the history modules. The two word lists are frozen arrays, as the O14 row requires. `CARD_LINE_RE` is left out, because a `RegExp` is an object the O14 row requires frozen;
  - B1's title now ends `(its hook half: the card line describe below)`.

**Spec:** §9.11 O14 (every vocabulary declared once and bound to its uses; CARD_PREFIX's hook half), §13 (single definition over `.mjs` and bash), §8.6 (the grammar the hook and lib both spell). Departure: D-4750 (`history-hook-card-names-once`) (NEW, Task 9's): this task is the pin that makes the hook's four spellings safe.

**Choices this task makes:**
- **The cases are green on arrival, and their red is the mutants'.** They bind spellings Tasks 1, 9 and 10 already made. There is no state of this branch in which the hook's grammar disagrees with lib's, so a red-first run cannot exist. Step 5 measures each case red with a mutant that perturbs the one spelling it guards. That is the red the mutation-table rule asks for.
- **B2's `NODE_CARD_RE` is not bound here.** It is the private prefix-only parser inside `extractNodeId` (`History: node (L[0-9a-f]{6,20})…?`), a different regex with a different job. It reads a pasted card line, and does not gate one.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -c "^describe('ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses" server/test/single-definition.test.ts
grep -c 'const VOCABS = \[' server/test/single-definition.test.ts
grep -cF "CARD_PREFIX is declared (its hook half lands in B3)" server/test/single-definition.test.ts
grep -cF "'EXPAND_LABEL'] as const;" server/test/single-definition.test.ts
grep -c "ccrc history card line" server/test/single-definition.test.ts
node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); for (const n of ['CARD_LINE_PATTERN','CARD_LINE_MAX','CARD_DIR','SCOPE_DIR','CARD_DESCRIBE_CMD','CARD_MEASURE_ROWS','CARD_MEASURE_MAX_WAIT_MS','CARD_ATTACHMENT_MAX_BYTES','PURGED_FILES_GRACE_MS','SCOPE_MARKER_MAX_AGE_MS','CARD_CONSUMED_SCOPES','CARD_WITHDRAW_REASONS','RECALL_OFF_DIR','HISTORY_ROOT_REL']) console.log(n, typeof l[n]);"
grep -cx 'COMPACT_CARD_MAX_AGE=1200' ccd/session-hook.sh
```

Expected:
- `1`, `1`, `1`;
- `1`: B2's list ends with `'EXPAND_LABEL'`. A `0` means the array closes on another name; Step 2's edit does not depend on it;
- `0`;
- fourteen lines: `CARD_LINE_PATTERN string`, `CARD_LINE_MAX number`, `CARD_DIR string`, `SCOPE_DIR string`, `CARD_DESCRIBE_CMD string`, `CARD_MEASURE_ROWS number`, `CARD_MEASURE_MAX_WAIT_MS number`, `CARD_ATTACHMENT_MAX_BYTES number`, `PURGED_FILES_GRACE_MS number`, `SCOPE_MARKER_MAX_AGE_MS number`, `CARD_CONSUMED_SCOPES object`, `CARD_WITHDRAW_REASONS object`, `RECALL_OFF_DIR string`, `HISTORY_ROOT_REL string`. An `undefined` means the task that owns that name spelled it differently: fix it in that task's file and its `lib.d.mts` line, never here;
- `1`: the compact card's age, one line, as the binding case reads it.

- [ ] **Step 2: Widen VOCABS and reword B1's title, in place.** From the repository root:

```bash
python3 - <<'PYEOF'
p = 'server/test/single-definition.test.ts'
t = open(p, encoding='utf8').read()
i = t.index('  const VOCABS = [')
j = t.index('] as const;', i)
head = t[:j].rstrip()
assert not head.endswith(','), 'VOCABS ends with a trailing comma: edit it by hand'
add = ("\n    // W1-B3: every constant the card line adds to lib, declared there once (Task 11 binds the hook's spellings).\n"
       "    'CARD_LINE_PATTERN', 'CARD_LINE_MAX', 'CARD_DIR', 'SCOPE_DIR', 'CARD_DESCRIBE_CMD',\n"
       "    'CARD_MEASURE_ROWS', 'CARD_MEASURE_MAX_WAIT_MS', 'CARD_ATTACHMENT_MAX_BYTES', 'PURGED_FILES_GRACE_MS',\n"
       "    'SCOPE_MARKER_MAX_AGE_MS', 'CARD_CONSUMED_SCOPES', 'CARD_WITHDRAW_REASONS'")
t = head + ',' + add + t[j:]
old = 'CARD_PREFIX is declared (its hook half lands in B3)'
assert t.count(old) == 1, t.count(old)
t = t.replace(old, 'CARD_PREFIX is declared (its hook half: the card line describe below)')
open(p, 'w', encoding='utf8').write(t)
print('VOCABS widened; title reworded')
PYEOF
```

- [ ] **Step 3: Append the binding describe** at the end of `server/test/single-definition.test.ts`, after its last line:

```ts
// CCRC HISTORY W1-B3 (spec 2026-10-05 §8.6, §9.11 O14): the card line's HOOK HALF. APPENDED after the last
// describe, with no import line, for the reason the blocks above state; lib is imported dynamically. The hook
// cannot import lib.mjs (no fork on the hook's path), so it spells the grammar, the cap and the two directory
// names once each, in bash, and this binds every one of those spellings to lib's single definition.
describe('ccrc history card line: the hook and lib spell one grammar, one cap and one prefix (spec 2026-10-05 §8.6, O14)', () => {
  const HOOK_SH = path.join(ccrcRoot, 'ccd', 'session-hook.sh');
  type Lib = Record<string, unknown>;
  const lib = async (): Promise<Lib> => (await import('../../ccd/history/lib.mjs')) as unknown as Lib;
  /** The value of a top-level `NAME='…'` or `NAME="…"` or `NAME=<digits>` assignment, from code lines only. */
  const assigned = (lines: readonly string[], name: string): string[] =>
    lines.flatMap((l) => {
      const m = new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)"|([0-9]+))$`).exec(l);
      return m ? [m[1] ?? m[2] ?? m[3]!] : [];
    });

  it('CONTROL: the extractor reads each quoting, and refuses an indented or commented line', () => {
    expect(assigned(["A='x y'", 'A="$HOME/z"', 'A=512'], 'A')).toEqual(['x y', '$HOME/z', '512']);
    expect(assigned(["  A='x'", "# A='x'", "AB='x'"], 'A')).toEqual([]);
    expect(codeLines(HOOK_SH).some((l) => l.startsWith('HISTORY_CARD_RE=')), 'the hook defines the grammar').toBe(true);
  });

  it('the hook\'s one HISTORY_CARD_RE literal is lib\'s CARD_LINE_PATTERN, character for character, and begins with CARD_PREFIX', async () => {
    const l = await lib();
    const defs = assigned(codeLines(HOOK_SH), 'HISTORY_CARD_RE');
    expect(defs, 'HISTORY_CARD_RE is assigned once, single-quoted').toHaveLength(1);
    expect(defs[0]).toBe(l['CARD_LINE_PATTERN']);
    expect(defs[0]!.startsWith(`^${String(l['CARD_PREFIX'])}`)).toBe(true);
    expect((l['CARD_LINE_RE'] as RegExp).source).toBe(new RegExp(defs[0]!).source);
  });

  it('`History: ` is spelled on one hook code line, the grammar\'s', () => {
    expect(codeLines(HOOK_SH).filter((x) => x.includes('History: ')).map((x) => x.slice(0, x.indexOf('=')))).toEqual(['HISTORY_CARD_RE']);
  });

  it('HISTORY_CARD_MAX is CARD_LINE_MAX, and the read and the reserve are spelled from it, never as 512 or 513', async () => {
    const l = await lib();
    const code = codeLines(HOOK_SH);
    expect(assigned(code, 'HISTORY_CARD_MAX')).toEqual([String(l['CARD_LINE_MAX'])]);
    expect(code.filter((x) => /(?<![\w.])51[23](?![\w.])/.test(x)), 'a hand-kept 512 or 513').toEqual([`HISTORY_CARD_MAX=${String(l['CARD_LINE_MAX'])}`]);
    const spelled = code.filter((x) => x.includes('HISTORY_CARD_MAX + 1'));
    expect(spelled.length, 'the read and the reserve').toBe(2);
    expect(spelled.some((x) => /\bread -r -N "\$\(\( HISTORY_CARD_MAX \+ 1 \)\)"/.test(x)), 'the read').toBe(true);
    expect(spelled.some((x) => /HISTORY_CARD_RESERVE=\$\(\( HISTORY_CARD_MAX \+ 1 \)\)$/.test(x)), 'the reserve').toBe(true);
  });

  it('the card and scope directories are spelled once each, under HISTORY_ROOT_REL, named as lib names them', async () => {
    const l = await lib();
    const code = codeLines(HOOK_SH);
    const root = String(l['HISTORY_ROOT_REL']);
    for (const [name, dir] of [['HISTORY_CARD_DIR', l['CARD_DIR']], ['HISTORY_SCOPE_DIR', l['SCOPE_DIR']]] as const) {
      expect(assigned(code, name), name).toEqual([`$HOME/${root}/${String(dir)}`]);
      expect(code.filter((x) => x.includes(`${root}/${String(dir)}`)), `${root}/${String(dir)} spelled twice`).toHaveLength(1);
    }
    expect(code.filter((x) => x.includes(`${root}/${String(l['RECALL_OFF_DIR'])}/`)), 'the recall-off path, once').toHaveLength(1);
  });

  it("SCOPE_MARKER_MAX_AGE_MS is the hook's COMPACT_CARD_MAX_AGE in ms: the window a consumption's marker is read within is the one the reader serves within (ruling RC3)", async () => {
    const l = await lib();
    const age = assigned(codeLines(HOOK_SH), 'COMPACT_CARD_MAX_AGE');
    expect(age, 'COMPACT_CARD_MAX_AGE is assigned once, in whole seconds').toHaveLength(1);
    expect(Number(age[0]) * 1000).toBe(l['SCOPE_MARKER_MAX_AGE_MS']);
  });
});
```

- [ ] **Step 4: Run them.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history card line')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'every vocabulary is declared once|switches have readers only')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected:
- the first: `6 passed`. These cases are green on arrival (see the choices above); Step 5 measures each red;
- the second: green, now with twelve more `… is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen` rows. B1's O13 describe stays green too: every hook line that names `/history-off` (the marker gate, the reader's test, the reserve's set) carries its own standalone `[[ -e` or `[[ ! -e` test, which O13's READ pattern requires;
- the third: the whole file green.

- [ ] **Step 5: Measure every case red with a mutant.** From the repository root, with a timeout of at least 1800000 ms:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/mutate.py" ] || { echo 'no mutate.py: write it with the first block of Task 8 Step 6'; exit 1; }
cat > "$SCRATCH/mutants-t11.py" <<'PYEOF'
# Task 11's mutants (W1-B3): each perturbs one spelling the binding describe pins, and that case must go red.
H, C, L, SD = 'ccd/session-hook.sh', 'ccd/history/card.mjs', 'ccd/history/lib.mjs', 'test/single-definition.test.ts'
F = 'ccrc history card line'
MUTANTS = [
    ('T11-M1-grammar-drift', H, SD, F, [
        (r'''HISTORY_CARD_RE='^History: node L[0-9a-f]{6,20}…''', r'''HISTORY_CARD_RE='^History: node L[0-9a-f]{5,20}…''')]),
    ('T11-M2-cap-drift', H, SD, F, [
        ('HISTORY_CARD_MAX=512\n', 'HISTORY_CARD_MAX=511\n')]),
    ('T11-M3-hand-kept-513', H, SD, F, [
        (r'''IFS= read -r -N "$(( HISTORY_CARD_MAX + 1 ))" v''', r'''IFS= read -r -N 513 v''')]),
    ('T11-M4-card-dir-twice', H, SD, F, [
        (r'''  f="$HISTORY_CARD_DIR/$id/$psid.txt"''', r'''  f="$HOME/.ccrc/history/card/$id/$psid.txt"''')]),
    ('T11-M5-scope-dir-renamed', H, SD, F, [
        (r'''HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"''', r'''HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scopes"''')]),
    ('T11-M6-prefix-spelled-again', H, SD, F, [
        (r'''HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"''', 'HISTORY_CARD_HEAD=\'History: \'\n' + r'''HISTORY_SCOPE_DIR="$HOME/.ccrc/history/scope"''')]),
]
MUTANTS.append(('T11-M7-second-pattern', C, SD, 'CARD_LINE_PATTERN is declared in ccd/history/lib\\.mjs', [
    (None, "\nexport const CARD_LINE_PATTERN = '^History: ';\n")]))
MUTANTS.append(('T11-M8-scope-age-drift', L, SD, F, [
    ('export const SCOPE_MARKER_MAX_AGE_MS = 1200 * 1000;', 'export const SCOPE_MARKER_MAX_AGE_MS = 1260 * 1000;')]))
PYEOF
python3 "$SCRATCH/mutate.py" "$SCRATCH/mutants-t11.py"; echo "rc=$?"
git status --short
```

Expected: eight `RED->GREEN` lines, `rc=0`, and only `server/test/single-definition.test.ts` modified. The first seven were measured on a prototype of this exact text, the seventh against a stand-in `card.mjs`. T11-M8 came with ruling RC3, and its red is argued from the code:

| Mutant | Spelling perturbed | The case that goes red |
|---|---|---|
| T11-M1-grammar-drift | the hook's `{6,20}` made `{5,20}` | `the hook's one HISTORY_CARD_RE literal is lib's CARD_LINE_PATTERN …`: `expected '^History: node L[0-9a-f]{5,20}… \(thi…' to be '^History: node L[0-9a-f]{6,20}… \(thi…'` |
| T11-M2-cap-drift | `HISTORY_CARD_MAX=511` | `HISTORY_CARD_MAX is CARD_LINE_MAX …`: `expected [ '511' ] to deeply equal [ '512' ]` |
| T11-M3-hand-kept-513 | the read's size spelled `513` | the same case: `a hand-kept 512 or 513` |
| T11-M4-card-dir-twice | the reader's card path spelled out | `the card and scope directories are spelled once each …`: `.ccrc/history/card spelled twice` |
| T11-M5-scope-dir-renamed | `HISTORY_SCOPE_DIR` names `scopes` | the same case: `expected [ '$HOME/.ccrc/history/scopes' ] to deeply equal [ '$HOME/.ccrc/history/scope' ]` |
| T11-M6-prefix-spelled-again | a second `History: ` assignment | `` `History: ` is spelled on one hook code line, the grammar's `` |
| T11-M7-second-pattern | a second `CARD_LINE_PATTERN` declaration in `ccd/history/card.mjs` | B1's O14 row: `CARD_LINE_PATTERN: a second declaration`, listing `ccd/history/card.mjs` beside `ccd/history/lib.mjs` |
| T11-M8-scope-age-drift | lib's `SCOPE_MARKER_MAX_AGE_MS` made 1260 s | `SCOPE_MARKER_MAX_AGE_MS is the hook's COMPACT_CARD_MAX_AGE in ms …`: `expected 1200000 to be 1260000` |

- [ ] **Step 6: Re-measure the S6-R11 census for this cited file.** Every edit is in the file's end region, below `:1327`, so the forecast is zero movement. Measure it with the instrument swapping this file, through Task 8's `cite-run.sh` (it runs over this task's uncommitted edits). From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
[ -f "$SCRATCH/cite-remeasure.py" ] && [ -f "$SCRATCH/cite-run.sh" ] || { echo 'no cite-remeasure.py or cite-run.sh: write both with Task 8 Step 7'; exit 1; }
bash "$SCRATCH/cite-run.sh" server/test/single-definition.test.ts
```

Expected:
- `files swapped to HEAD: server/test/single-definition.test.ts`, and last `keep-cite: the tree matches its copies; copies removed`;
- `byFile['server/test/single-definition.test.ts']  stated 8  base 8  tree 8` (8 at f7e51156f; trust the printed `stated`), and every other key equal across its three numbers;
- `ENTERED []` / `LEFT    []` for the composition, the row array and the site array.

If anything moved, an edit landed above a cited line: move it, never `--write`.

- [ ] **Step 7: Confirm the scratch copies are gone, then commit.** First, in its own call:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"
test -z "$(ls -A "$SCRATCH/keep" 2>/dev/null)" && test -z "$(ls -A "$SCRATCH/keep-cite" 2>/dev/null)" && echo RESTORED
git status --short
```

It must print `RESTORED`, and `git status` must list only `server/test/single-definition.test.ts`: Step 5's mutants touched `ccd/session-hook.sh`, `ccd/history/card.mjs` and `ccd/history/lib.mjs` too, and all three must read as committed. On anything else, restore as Task 8 Step 8 says. Only then, in a separate call, on this workspace's branch:

```bash
git add server/test/single-definition.test.ts
git commit -m "test(history): the hook's card grammar, cap and directories bound to lib (W1-B3 task 11)

An end-appended describe binds the hook's HISTORY_CARD_RE literal to lib's
CARD_LINE_PATTERN character for character, HISTORY_CARD_MAX to CARD_LINE_MAX
(the read and the reserve spelled only as HISTORY_CARD_MAX + 1), and the
card and scope directories to CARD_DIR and SCOPE_DIR under HISTORY_ROOT_REL,
each spelled once, and lib's SCOPE_MARKER_MAX_AGE_MS to the hook's
COMPACT_CARD_MAX_AGE. O14's VOCABS gains B3's twelve names. End region only:
census unmoved."
```

### Task 12: Lifecycle rows `history-scope-markers` and `history-card-files` (O17's B3 half)

**Files:**
- Modify: `shared/lifecycle.ts`. Insert two rows immediately before the closing `];` of `export const LIFECYCLE: readonly LifecycleClass[] = [`.
  - That `];` is the only line of the file that is exactly `];`. At f7e51156f it is `:45`. At origin/main 9a255a746 it is `:53`, below #299's `scope-sweep-verdicts` row.
  - B1 and B2 append their history rows directly above it. So the new rows land after the last history row: B2's `history-backups`, or B4's `history-export` if B4 merged first. The last line of B2's row reads:

```ts
    ruling: 'operator-made by `ccrc history doctor --backup`; remove by hand (the next --backup removes a stale .tmp first)' },
```

- Modify: `server/test/lifecycle.test.ts`:
  - in place, B1's `const HISTORY_LANDED: readonly HistoryPr[] = [` line;
  - insert three cases immediately before the closing `});` of `describe('shared/lifecycle.ts — the policy §4(a) manifest', () => {`. That describe opens at `:993` at both f7e51156f and origin/main, and its closing `});` is the file's last line (`:1039` and `:1049`). B1's history block and B2's `history-backups` case sit directly above that `});`, and B4's `history-export` case does too if B4 merged first.
- Test: `server/test/lifecycle.test.ts`.

**Interfaces:**
- Consumes:
  - `LifecycleClass` and `LIFECYCLE` (`shared/lifecycle.ts:5-16` at f7e51156f; the interface line reads `export interface LifecycleClass {`). The test already imports `LIFECYCLE` (`import { LIFECYCLE } from '../../shared/lifecycle.js';`).
  - B1's test-side table in `lifecycle.test.ts`: `HISTORY_ROWS_BY_PR` (its `B3: ['history-scope-markers', 'history-card-files'],` entry), `type HistoryPr`, `HISTORY_LANDED`, and the cases `'the history classes are §9.4\'s thirteen, …'` (O17) and `'every history class names its creators and its tier'`.
  - B2's `HISTORY_LANDED` entry `'B2'` and its `history-backups` row and case.
  - From Task 1, through lib.d.mts: `PURGED_FILES_GRACE_MS: number` and `CARD_LINE_MAX: 512`.
  - The collector behaviour each row promises, each pinned in `server/test/history-card.test.ts`:
    - consumption by `cardStep`'s `consumeAndWriteCards` (Task 5, counters `card_consumed:<scope>`);
    - withdrawal by `withdrawCards` on a pass that runs no card step (Task 5, counters `card_withdrawn:<reason>`; ruling RC2);
    - the 7-day purge by `collectPurgedHistoryFiles(db, home, nowMs)` (Task 7, counters `scope_files_purged` and `card_files_purged`).
- Produces:
  - two `LifecycleClass` rows, `history-scope-markers` and `history-card-files`;
  - `HISTORY_LANDED` gains `'B3'`;
  - three cases:
    - `declares history-scope-markers: …`;
    - `declares history-card-files: …`;
    - `the B3 rows' numbers are the code's own: …`.
  - No field is added to `LifecycleClass`. `shared/lifecycle.ts` stays L0 and imports nothing.

**Spec:** §9.4 (the two rows: root, pattern R, creators, collector, bound and tier, lands in B3), §9.11 O17 (its B3 half), §10.5 (B3's contents). Departures carried in row text: D-4742 (`history-card-one-file-per-id`) (NEW, Task 5's: the collector text names the id's next prediction as a second way a file goes), D-4740 (`history-card-withdrawn-when-not-ticking`) (NEW, Task 5's, ruling RC2: the collector text names the withdrawal as a third) and D-4751 (`history-card-files-creator-through-card`) (NEW: the creator is spelled `ccd/history/sweep.mjs (through card.mjs)` where §9.4 writes `sweep.mjs`; ruled RC1). Everything else is the spec's.

**Choices this task makes:**
- `history-card-files`'s creator is spelled `'ccd/history/sweep.mjs (through card.mjs)'`, by the precedent of B1's `history-store` row (`'ccd/history/sweep.mjs (through store.mjs)'`, itself the spec's §9.4 wording for that row). §9.4 writes `sweep.mjs` for the card row. The parenthesis names the module that writes the file, so a reader looking for the writer finds it. It is a departure from §9.4's text, carried as D-4751 (`history-card-files-creator-through-card`), and ruling RC1 accepted it.
- The rows' "7 days" and "512 B" are bound to `PURGED_FILES_GRACE_MS` and `CARD_LINE_MAX` by a test, so the manifest cannot drift from the collector it describes. The `<=64 B` marker tier has no lib constant (the marker's longest form is `ambiguous <36-char uuid> <13-digit ms>` plus its LF, 61 bytes), so it stays a stated bound.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -n "const HISTORY_LANDED: readonly HistoryPr\[\] = \[" server/test/lifecycle.test.ts
grep -c "B3: \['history-scope-markers', 'history-card-files'\]," server/test/lifecycle.test.ts
grep -c "  { name: 'history-" shared/lifecycle.ts
grep -cx '\];' shared/lifecycle.ts
```

Expected:
- The first command prints one line. It ends `= ['B1', 'B2'];`, or `= ['B1', 'B2', 'B4'];` if B4 merged first.
- Then `1`.
- Then `7`: B1's six rows plus B2's `history-backups`. It is `8` if B4 merged first.
- Then `1`.

Any other answer means a base this plan was not written against. Stop and report it to the coordinator.

- [ ] **Step 2: Write the failing cases.**
  - In `server/test/lifecycle.test.ts`, replace the `HISTORY_LANDED` line in place, appending `'B3'` as the array's last element. On the usual base the line becomes:

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3'];
```

  - If B4 merged first, it becomes `['B1', 'B2', 'B4', 'B3']`, in merge order.
  - Then insert immediately before the closing `});` of the `'shared/lifecycle.ts — the policy §4(a) manifest'` describe:

```ts
  // ── ccrc history W1-B3 (spec 2026-10-05 §9.4, O17's B3 half) ────────────
  // The card line's two classes. Both are rolling (R):
  //   - the hook rewrites a session's scope marker on every PreCompact;
  //   - the sweep rewrites, consumes, withdraws and collects the card predictions.
  // Each collector promise has its own case in history-card.test.ts:
  //   - consumption: consumeAndWriteCards, counters card_consumed:<scope>;
  //   - withdrawal on a pass that runs no card step: withdrawCards, counters card_withdrawn:<reason>;
  //   - the 7-day purge: collectPurgedHistoryFiles, counters scope_files_purged and card_files_purged.
  // A collector promise with no test can go false without a red, which is why each one names its case here.
  it('declares history-scope-markers: an R class the hook writes and the sweep collects once its session is purged', () => {
    const c = LIFECYCLE.find((x) => x.name === 'history-scope-markers');
    expect(c, 'shared/lifecycle.ts declares no history-scope-markers class').toBeTruthy();
    expect(c!.pattern).toBe('R');
    expect(c!.creators).toEqual(['ccd/session-hook.sh']);
    expect(c!.collector).toContain('ccd-history-sweep');
    expect(c!.collector).toContain('the files of purged sessions after 7 days');
    expect(c!.root).toBe('~/.ccrc/history/scope/<id>');
    expect(c!.tier).toBe('<=64 B per session');
    expect(c!.ruling).toBeNull();
  });

  it('declares history-card-files: an R class the sweep writes through card.mjs, deletes on consumption, withdraws on a pass that runs no card step and collects once its session is purged', () => {
    const c = LIFECYCLE.find((x) => x.name === 'history-card-files');
    expect(c, 'shared/lifecycle.ts declares no history-card-files class').toBeTruthy();
    expect(c!.pattern).toBe('R');
    expect(c!.creators).toEqual(['ccd/history/sweep.mjs (through card.mjs)']);
    expect(c!.collector).toContain('ccd-history-sweep');
    expect(c!.collector).toContain('deleted on consumption');
    expect(c!.collector).toContain('withdrawn by a pass that runs no card step');
    expect(c!.collector).toContain('the files of purged sessions after 7 days');
    expect(c!.root).toBe('~/.ccrc/history/card/<id>/<uuid>.txt');
    // R-recalloff-parity: the generation record Task 5 writes beside each prediction is in the same class.
    expect(c!.bound, 'the class names no generation record').toContain('generation record <uuid>.gen');
    expect(c!.tier).toBe('<=512 B per session');
    expect(c!.ruling).toBeNull();
  });

  it("the B3 rows' numbers are the code's own: 7 days is PURGED_FILES_GRACE_MS, 512 B is CARD_LINE_MAX", async () => {
    // The manifest is L0 and imports nothing, so its prose numbers are bound here instead. The writer prints only
    // a grammar-valid line (at most 145 characters, 152 bytes with its LF), so the reader's CARD_LINE_MAX
    // character cap is the file's bound; with its generation record (37 B, R-recalloff-parity) a session holds at
    // most 189 B there.
    const { PURGED_FILES_GRACE_MS, CARD_LINE_MAX } = await import('../../ccd/history/lib.mjs');
    const days = PURGED_FILES_GRACE_MS / 86_400_000;
    expect(Number.isInteger(days), 'PURGED_FILES_GRACE_MS is not a whole number of days').toBe(true);
    for (const n of ['history-scope-markers', 'history-card-files']) {
      const c = LIFECYCLE.find((x) => x.name === n);
      expect(c, `shared/lifecycle.ts declares no ${n} class`).toBeTruthy();
      expect(c!.collector, `${n}'s collector names another grace than the sweep's`)
        .toContain(`the files of purged sessions after ${days} days`);
    }
    expect(LIFECYCLE.find((x) => x.name === 'history-card-files')!.tier).toBe(`<=${CARD_LINE_MAX} B per session`);
  });
```

- [ ] **Step 3: Run them and see them fail.** Run `(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'policy')` in the foreground (timeout ≥ 600000 ms). Expected RED:
  - B1's O17 case: `history-scope-markers lands in B3, which has landed, and shared/lifecycle.ts declares no such class: expected false to be true`.
  - `declares history-scope-markers…`: `shared/lifecycle.ts declares no history-scope-markers class: expected undefined to be truthy`. `declares history-card-files…` fails the same way.
  - `the B3 rows' numbers…`: `shared/lifecycle.ts declares no history-scope-markers class: expected undefined to be truthy`.
  - B1's `'every history class names its creators and its tier'` stays green, over the rows that exist.

- [ ] **Step 4: Add the two rows.** In `shared/lifecycle.ts`, insert immediately before the closing `];`:

```ts
  // ccrc history, W1-B3 (spec 2026-10-05 §9.4): the card line's two rolling classes. The hook rewrites a session's
  // scope marker on every PreCompact; the sweep writes one card prediction per session id through card.mjs, deletes
  // it once the boundary that consumed it is ingested, and withdraws them all on a pass that runs no card step; both
  // are collected 7 days after their session is purged from the registry.
  { name: 'history-scope-markers', root: '~/.ccrc/history/scope/<id>', pattern: 'R',
    creators: ['ccd/session-hook.sh'],
    collector: 'ccd-history-sweep (the files of purged sessions after 7 days)',
    bound: 'one per session id, overwritten on each PreCompact; collected 7 days after its session is purged', tier: '<=64 B per session', ruling: null },
  { name: 'history-card-files', root: '~/.ccrc/history/card/<id>/<uuid>.txt', pattern: 'R',
    creators: ['ccd/history/sweep.mjs (through card.mjs)'],
    collector: 'ccd-history-sweep (deleted on consumption: when the boundary that consumed the prediction is ingested, or when the id\'s next prediction names another uuid; withdrawn by a pass that runs no card step; the files of purged sessions after 7 days)',
    bound: 'one prediction per session id, until consumed or withdrawn, or 7 days after its session is purged; beside it, its generation record <uuid>.gen (at most 37 B, coordinator ruling R-recalloff-parity), replaced with the id\'s next prediction', tier: '<=512 B per session', ruling: null },
```

- [ ] **Step 5: Run them and see them pass; typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The whole file is green. That includes:
  - `'is L0: imports nothing at all'`;
  - `'every collector-less class carries a non-empty operator ruling'`;
  - B1's O17 case, which now reads 13 table names, of which B1's, B2's and B3's nine (ten if B4 landed) are declared;
  - B1's creators-and-tier case, over the two new rows too.
- tsc prints nothing. The PWA bundles `shared/`, so both rows must satisfy `LifecycleClass`, and the dynamic import of `lib.mjs` is typed by `lib.d.mts`.

- [ ] **Step 6: Mutations: a missing row, a row before its PR, a drifted grace, a collector that forgets the withdrawal, and a class that forgets the generation record.** From the repository root, open each call with `SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"`. Save both files first:

```bash
cp shared/lifecycle.ts "$SCRATCH/lifecycle.ts.orig"; cp server/test/lifecycle.test.ts "$SCRATCH/lifecycle.test.ts.orig"
```

Run each mutant with `(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'policy')`. After each, restore both files with `cp "$SCRATCH/lifecycle.ts.orig" shared/lifecycle.ts; cp "$SCRATCH/lifecycle.test.ts.orig" server/test/lifecycle.test.ts`.

  1. **The card row deleted.** Run `sed -i "/^  { name: 'history-card-files',/,/ruling: null },\$/d" shared/lifecycle.ts`, then `grep -c "name: 'history-card-files'" shared/lifecycle.ts`, which prints `0`. Expected RED:
     - O17: `history-card-files lands in B3, which has landed, and shared/lifecycle.ts declares no such class: expected false to be true`;
     - `shared/lifecycle.ts declares no history-card-files class: expected undefined to be truthy`, in both the declares case and the numbers case.
  2. **A row before its PR.** Run `sed -i "s/^\(  const HISTORY_LANDED: readonly HistoryPr\[\] = \[.*\), 'B3'\];\$/\1];/" server/test/lifecycle.test.ts`, then `grep -c "'B3'\];" server/test/lifecycle.test.ts`, which prints `0`. Expected RED on O17: `history-scope-markers lands in B3 and is declared before it: expected true to be false`.
  3. **A grace that is not the sweep's.** Run `sed -i "s/collector: 'ccd-history-sweep (the files of purged sessions after 7 days)',/collector: 'ccd-history-sweep (the files of purged sessions after 8 days)',/" shared/lifecycle.ts`, then `grep -c 'after 8 days' shared/lifecycle.ts`, which prints `1`. Expected RED:
     - the scope declares case: `expected 'ccd-history-sweep (the files of purged sessions after 8 days)' to contain 'the files of purged sessions after 7 days'`;
     - the numbers case: `history-scope-markers's collector names another grace than the sweep's`.
  4. **The withdrawal left out of the card row (ruling RC2).** Run `sed -i "s/; withdrawn by a pass that runs no card step;/;/" shared/lifecycle.ts`, then `grep -c 'withdrawn by a pass' shared/lifecycle.ts`, which prints `0`. Expected RED in the card declares case: `expected 'ccd-history-sweep (deleted on consumption: …' to contain 'withdrawn by a pass that runs no card step'`.
  5. **The generation record left out of the card row (coordinator ruling R-recalloff-parity).** Run `sed -i "s/; beside it, its generation record <uuid>.gen (at most 37 B, coordinator ruling R-recalloff-parity), replaced with the id\\\\'s next prediction'/'/" shared/lifecycle.ts`, then `grep -c 'generation record' shared/lifecycle.ts`, which prints `0`. Expected RED in the card declares case (predicted): `the class names no generation record: expected 'one prediction per session id, until consumed or withdrawn, or 7 days after its session is purged' to contain 'generation record <uuid>.gen'`.

  After the last restore, re-run the command and see it green. Then run `git diff --stat -- shared/lifecycle.ts server/test/lifecycle.test.ts`. It shows only Steps 2 and 4's edits.

- [ ] **Step 7: Commit.**

```bash
git add shared/lifecycle.ts server/test/lifecycle.test.ts
git commit -m "feat(lifecycle): the two W1-B3 history classes, scope markers and card files (spec 2026-10-05 §9.4, O17)

history-scope-markers (the hook's PreCompact marker) and history-card-files
(the sweep's per-session prediction, through card.mjs), both rolling,
collected 7 days after their session is purged; the card file is also
deleted on consumption and withdrawn by a pass that runs no card step.
HISTORY_LANDED gains B3, and a case binds the rows' 7 days and 512 B to
PURGED_FILES_GRACE_MS and CARD_LINE_MAX."
```

### Task 13: measure-history.py: the W1-e named query

**Files:**
- Modify: `deploy/measure-history.py` (B1 Task 35's file). Make four edits, each anchored by content; read the merged file first. Each anchor line below must occur exactly once (Step 1 measures that):
  - the module docstring: a `w1e` entry after the two `w1c_duplicate_entries` lines. The second of those reads exactly `                          because the acceptance row is this number`;
  - a new function `w1e_statistic`, directly above `def main():`;
  - inside `main()`'s `report = {` literal, a `'w1e': None,` entry directly after the `'w1c_duplicate_entries'` entry. That entry's second line reads exactly `                'SELECT count(*) FROM (SELECT uuid FROM entries GROUP BY uuid HAVING count(*) > 1)').fetchone()[0],`;
  - one line directly above `        if a.families is not None:`, the eight-space-indented line inside the `try:`. It is distinct from the four-space `    if a.families is not None and (…` near the top of `main()`.
- Modify: `server/test/measure-history.test.ts` (B1 Task 35's file): one describe appended at the end of the file, with no import line.
- Test: `server/test/measure-history.test.ts`.

**Interfaces:**
- Consumes:
  - From B1's `measure-history.py`: `main()`'s `report` dict, whose `counters` entry is `{name: n}` over every `counters` row (`SELECT name, n FROM counters ORDER BY name`), and the report's key order (`store_id`, `user_version`, `counters`, `w1b_lag_p95_ms`, `w1c_duplicate_entries`, `w1f_grep_p95_ms`, `w2`).
  - From B1's `measure-history.test.ts` (module scope): `report(args: string[]): Report`, `interface Report`, `NOW`.
  - Imports already at the top of that file: `mkTmp`, `createStore`, `DatabaseSync` and `path`.
  - The counter names Tasks 5 and 6 write:
    - `card_consumed:main`, `card_consumed:other` and `card_consumed:unknown` (Task 5; lib's `CARD_CONSUMED_SCOPES`, ruling RC3);
    - `card_written`, `card_skipped:<reason>` and `card_withdrawn:<reason>` (Task 5; W1-e reads none of them);
    - `card_served:<backend>` and `card_id_mismatch:<backend>` (Task 6).
  - From Task 3, by dynamic import in the test only: lib's `CARD_CONSUMED_SCOPES`.
- Produces:
  - `w1e_statistic(counters: dict) -> dict`, answering `{'consumed_main': int, 'consumed_other': int, 'consumed_unknown': int, 'served': int, 'mismatch': int, 'served_share': float | None, 'mismatch_share': float | None}`;
  - the report key `w1e`, placed between `w1c_duplicate_entries` and `w1f_grep_p95_ms`, so the W1 rows read in order.
  - The definitions (ruling RC3):
    - `served_share = served / (consumed_main + consumed_unknown)`, or None when neither was counted; `consumed_other` and `consumed_unknown` are reported beside it;
    - `mismatch_share = mismatch / (served + mismatch)`, or None when no line was found at all.

**Spec:** §10.7 W1-e ("card line served on main-scope compactions with a caught-up indexer: ≥ 95%; `card_id_mismatch` ≤ 2%"; data source: transcript attachments, §8.6), §10.7 W1-h (its card half reads the same counters on a gateway-lane node), §10.2 (the census never classifies a model; pin O32). Departures: D-4737 (`history-card-measured-from-transcript`) (the counters this query reads are measured from the transcript, never receipted), D-4738 (`history-card-consumed-counter`) (NEW, Task 5's, ruled RC3: the scoped `card_consumed:<scope>` counters are W1-e's denominator) and D-4752 (`history-w1e-query-in-b3`) (NEW: §10.5 does not list `deploy/measure-history.py` among B3's contents, but W1-e's counters first exist in B3, so its named query ships beside them; ruled RC1).

**Choices this task makes:**
- **`served_share`'s denominator is the main and unknown consumptions (ruling RC3).** A prediction file is written only once the sweep has read the transcript to its end, and only for the main transcript the registry names, so every consumption is a main-transcript compaction. Task 5 counts each one by the scope marker its PreCompact left: `main` (a line was due), `other` (the hook scoped it `subagent` or `ambiguous`, an auto-compaction while subagents or Workflow agents were writing, so no line was ever due) or `unknown` (the marker overwritten, emptied or unreadable). W1-e is about main-scope compactions (§8.6 Scope: the line is served only on a `main` marker), so `other` leaves the denominator and is reported beside the share, and `unknown` stays in it: an unreadable marker can only lower the share, never raise it. A subagent's own compaction lands in its own transcript, which the card never predicts, so it is not counted at all.
- **A reading is void if a restore or rebuild ran in its window.** B2's restore or rebuild (a completed `recover` step) re-derives leaves the measure may count again, with no matching consumption, so `served_share` can read high, and above 1 is a sure tell. The recover arm withdraws every prediction (ruling RC2, Task 5), so a restore no longer adds a spurious consumption. The operator knows when a recovery ran, and the reading procedure excludes that window. The docstring and the PR body's reading procedure say so; the query itself adds no flag.
- **`mismatch_share`'s denominator is the lines that arrived: served plus mismatch.** §10.7 bounds `card_id_mismatch` at 2% without naming a denominator. A compaction whose attachment carried no line is already a miss in the served share, so it should not also dilute the mismatch share.
- **A share whose denominator is 0 is `null`, never 0.** This follows B1's p95 idiom: no evidence is not a perfect score.
- **The backend word is summed over and never read**, so O32 holds: no model test, no `startswith`.

- [ ] **Step 1: Read the base.** From the repository root:

```bash
grep -c '^                          because the acceptance row is this number$' deploy/measure-history.py
grep -c '^def main():$' deploy/measure-history.py
grep -cF "                'SELECT count(*) FROM (SELECT uuid FROM entries GROUP BY uuid HAVING count(*) > 1)').fetchone()[0]," deploy/measure-history.py
grep -c '^        if a.families is not None:$' deploy/measure-history.py
grep -niE 'claude|startswith|<synthetic>' deploy/measure-history.py
```

Expected: `1` four times, then nothing (O32's three banned patterns are absent before this task, and must stay absent after it). If a count is not 1, the merged file differs from B1's plan text. Re-anchor on the merged text, keeping each edit's position relative to its neighbours, and say so in the PR body.

- [ ] **Step 2: Write the failing cases.** Append at the very end of `server/test/measure-history.test.ts`, after its last line, one blank line and exactly:

```ts
// ── W1-B3: W1-e, the card line's delivery (spec 2026-10-05 §10.7, §8.6; ruling RC3). END-APPENDED. ────────────
// The sweep measures delivery from each compaction's transcript (card_served:<backend>, card_id_mismatch:<backend>)
// and counts each prediction a later main boundary consumed by its compaction's scope marker
// (card_consumed:main, :other, :unknown). W1-e is read from those counters alone, so each case plants counters in a
// store createStore made, and nothing else.
describe('measure-history.py: W1-e, the card line served and its id mismatches (spec 2026-10-05 §10.7; ruling RC3)', () => {
  interface W1e {
    consumed_main: number; consumed_other: number; consumed_unknown: number; served: number; mismatch: number;
    served_share: number | null; mismatch_share: number | null;
  }
  type ReportW1e = Report & { w1e: W1e };

  /** A real store holding exactly `counters`. */
  const cardStore = (counters: Record<string, number>): string => {
    const home = mkTmp('ccrc-measure-history-w1e-');
    createStore(home);
    const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('DELETE FROM counters');
      const ins = db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)');
      for (const [k, v] of Object.entries(counters)) ins.run(k, v);
    } finally {
      db.close();
    }
    return dbPath;
  };
  const w1eOf = (db: string): W1e => (report(['--db', db, '--now', String(NOW)]) as ReportW1e).w1e;

  it("W1-e CONTROL: the scope words planted below are lib's CARD_CONSUMED_SCOPES, the words the sweep counts under", async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.CARD_CONSUMED_SCOPES).toEqual(['main', 'other', 'unknown']);
  });

  it('W1-e: the served share is over main and unknown consumptions, other reported beside it and out of the denominator: 20 of 21 served, 1 of 21 mismatched', () => {
    const r = w1eOf(cardStore({
      'card_served:anthropic': 19, 'card_served:other': 1, 'card_id_mismatch:anthropic': 1,
      'card_consumed:main': 19, 'card_consumed:unknown': 2, 'card_consumed:other': 5,
      card_written: 30, 'card_skipped:fork-qualified': 2, 'card_withdrawn:low-disk': 4,   // the writer's own: W1-e reads none
    }));
    expect(r).toMatchObject({ consumed_main: 19, consumed_other: 5, consumed_unknown: 2, served: 20, mismatch: 1 });
    expect(r.served_share).toBeCloseTo(20 / 21, 12);
    expect(r.mismatch_share).toBeCloseTo(1 / 21, 12);
  });

  it('W1-e: the mismatch share is of the lines that arrived (served + mismatch), the served share of the main and unknown consumptions', () => {
    // 24 main or unknown consumptions; 19 lines named their own leaf, 1 named another, 4 compactions carried no line.
    // Here the two denominators differ (20 and 24), and main and unknown differ from main alone (20), which the case
    // above cannot tell apart.
    const r = w1eOf(cardStore({
      'card_served:anthropic': 18, 'card_served:unknown': 1, 'card_id_mismatch:other': 1,
      'card_consumed:main': 20, 'card_consumed:unknown': 4,
    }));
    expect(r).toMatchObject({ consumed_main: 20, consumed_other: 0, consumed_unknown: 4, served: 19, mismatch: 1 });
    expect(r.served_share).toBeCloseTo(19 / 24, 12);
    expect(r.mismatch_share).toBeCloseTo(1 / 20, 12);
  });

  it('W1-e: a share with nothing under it is null, never 0; consumptions scoped other alone leave the served share null', () => {
    expect(w1eOf(cardStore({ raw_only: 3 }))).toEqual({
      consumed_main: 0, consumed_other: 0, consumed_unknown: 0, served: 0, mismatch: 0, served_share: null, mismatch_share: null,
    });
    const r = w1eOf(cardStore({ 'card_id_mismatch:anthropic': 2, 'card_consumed:other': 3 }));
    expect(r).toMatchObject({ consumed_main: 0, consumed_other: 3, consumed_unknown: 0, served: 0, mismatch: 2, served_share: null });
    expect(r.mismatch_share).toBe(1);
  });

  it('W1-e sits between W1-c and W1-f in the report, which stays headed by its store id', () => {
    expect(Object.keys(report(['--db', cardStore({}), '--now', String(NOW)]))).toEqual(['store_id', 'user_version', 'counters',
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2']);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** Run `(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W1-e')` in the foreground (timeout ≥ 600000 ms). Expected `4 failed | 1 passed`. The four fail because the report has no `w1e` key yet:
  - the first two: `expected undefined to match object { consumed_main: 19, consumed_other: 5, … }`, and the same with `consumed_main: 20`;
  - the null case: `expected undefined to deeply equal { consumed_main: 0, consumed_other: 0, … }`;
  - the key-order case: the received array lacks `'w1e'`.

  The CONTROL passes: Task 3 already put `CARD_CONSUMED_SCOPES` in lib. B1's own cases in the file are not selected by `-t 'W1-e'`: no B1 title contains `W1-e`.

- [ ] **Step 4: Write the query.** Make four edits to `deploy/measure-history.py`. None of them may spell the three O32 patterns (`claude`, `startswith`, `<synthetic>`, matched case-insensitively over the whole file, docstrings included). That is why the backend suffix is cut with `partition`.

  1. In the module docstring, directly after the line `                          because the acceptance row is this number`, insert:

```text
  w1e                     W1-e: the card line's delivery, from the counters the sweep folds (it measures
                          delivery from each compaction's transcript, never from a receipt):
                          consumed_main, consumed_other and consumed_unknown are card_consumed:<scope>
                          (a prediction a later main boundary consumed, by the scope marker its
                          compaction left); served and mismatch are card_served:* and card_id_mismatch:*
                          summed over their backend words; served_share = served / (consumed_main +
                          consumed_unknown) (target >= 0.95), other reported beside it and out of the
                          denominator, and mismatch_share = mismatch / (served + mismatch) (target
                          <= 0.02), each null, never 0, when its denominator is 0. A reading whose
                          window holds a restore or rebuild is void; a served_share above 1 is its tell
```

  2. Directly above `def main():`, insert this function followed by two blank lines:

```python
def w1e_statistic(counters):
    """W1-e (spec 2026-10-05 §10.7, §8.6; ruling RC3): the card line's delivery, from the counters alone. The
    sweep counts each prediction file a later main boundary consumed as card_consumed:<scope>, by the scope marker
    the hook wrote at that compaction's PreCompact: main (a line was due), other (subagent or ambiguous: no line
    was ever due) or unknown (the marker overwritten, emptied or unreadable). It counts card_served:<backend> or
    card_id_mismatch:<backend> once per leaf whose post-boundary SessionStart attachment named a node: its own
    leaf, or another. The backend word after the colon is summed over and never read, so no model is classified
    here (O32).

    served_share = served / (main + unknown): other is out of the denominator and reported beside it, and unknown
    stays in it, so an unreadable marker can only lower the share. The mismatch share is of the lines that
    arrived, so a compaction whose attachment carried no line lowers the served share and leaves the mismatch
    share alone. A reading whose window holds a restore or rebuild (a completed `recover` step) is void:
    re-derived leaves are measured again, so a served share above 1 is the tell."""
    def total(word):
        return sum(n for name, n in counters.items() if name.partition(':')[0] == word)

    def consumed(scope):
        return sum(n for name, n in counters.items() if name == 'card_consumed:' + scope)

    main, other, unknown = consumed('main'), consumed('other'), consumed('unknown')
    served, mismatch = total('card_served'), total('card_id_mismatch')
    return {'consumed_main': main, 'consumed_other': other, 'consumed_unknown': unknown,
            'served': served, 'mismatch': mismatch,
            'served_share': served / (main + unknown) if main + unknown else None,
            'mismatch_share': mismatch / (served + mismatch) if served + mismatch else None}
```

  3. In `main()`'s `report = {` literal, directly after the line `                'SELECT count(*) FROM (SELECT uuid FROM entries GROUP BY uuid HAVING count(*) > 1)').fetchone()[0],`, insert this line, at the literal's twelve-space indent:

```python
            'w1e': None,   # W1-e: filled from 'counters' below the literal, in this place in the key order
```

  4. Directly above `        if a.families is not None:` (eight spaces, inside the `try:`), insert:

```python
        report['w1e'] = w1e_statistic(report['counters'])
```

  Assigning to a key the literal already holds keeps that key's place, so `w1e` stays between W1-c and W1-f. That is why the literal carries the placeholder rather than the assignment appending a new key after `w2`.

- [ ] **Step 5: Run them and see them pass; the whole file and O32.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W1-e')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
grep -niE 'claude|startswith|<synthetic>' deploy/measure-history.py
python3 -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf8").read())' deploy/measure-history.py && echo parses
```

Expected:
- The five W1-e cases, its CONTROL among them, are green.
- The whole file is green:
  - B1's O32 pair, including `expect(src).toContain('SELECT name, n FROM counters')`;
  - the O52 named queries, whose `counters` map is unchanged, because W1-e adds a key and edits no counter;
  - the read-only case;
  - the missing-input case;
  - the sweep case, which skips on darwin.
- `grep` prints nothing, then `parses`. The check uses `ast.parse` and writes no bytecode, and the tests run python with `PYTHONDONTWRITEBYTECODE=1`, so `deploy/` gains no `__pycache__`.

- [ ] **Step 6: Mutations: each definition goes red.** From the repository root, open each call with `SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"`.
  - First, `cp deploy/measure-history.py "$SCRATCH/mh.orig"`.
  - Run each mutant with Step 5's first command. After each, check that it applied (`cmp -s "$SCRATCH/mh.orig" deploy/measure-history.py && echo NOT-APPLIED` prints nothing).
  - Restore with `cp "$SCRATCH/mh.orig" deploy/measure-history.py`.
  - Before ruling RC3, each sed was applied to a copy of B1's planned file carrying Step 4's edits, and each went red against the four cases then planned. RC3 rewrote the denominators, so the seds below are rewritten to match, and their reds are argued from the code: a row that stays green is reported with its output, never dropped.
  1. **The served share over the lines that arrived.** Run `sed -i "s|'served_share': served / (main + unknown) if main + unknown else None,|'served_share': served / (served + mismatch) if served + mismatch else None,|" deploy/measure-history.py`. Expected RED:
     - the second case: `served_share` is 0.95, where 19/24 ≈ 0.7917 was expected;
     - the null case: `served_share` is 0, where null was expected.
     The first case stays green: its two denominators are both 21, which is why the second case exists.
  2. **`other` in the denominator (ruling RC3).** Run `sed -i "s|'served_share': served / (main + unknown) if main + unknown else None,|'served_share': served / (main + other + unknown) if main + other + unknown else None,|" deploy/measure-history.py`. Expected RED:
     - the first case: about 0.769 (20/26), where 20/21 ≈ 0.952 was expected;
     - the null case: `served_share` is 0, where null was expected.
  3. **`unknown` out of the denominator (ruling RC3).** Run `sed -i "s|'served_share': served / (main + unknown) if main + unknown else None,|'served_share': served / main if main else None,|" deploy/measure-history.py`. Expected RED in the first case (20/19, where 20/21 was expected) and the second (19/20, where 19/24 was expected).
  4. **The mismatch share over the consumptions.** Run `sed -i "s|'mismatch_share': mismatch / (served + mismatch) if served + mismatch else None}|'mismatch_share': mismatch / (main + unknown) if main + unknown else None}|" deploy/measure-history.py`. Expected RED:
     - the second case: about 0.0417, where 1/20 = 0.05 was expected;
     - the null case: null, where 1 was expected.
  5. **Zero for no evidence.** Run `sed -i "s|'served_share': served / (main + unknown) if main + unknown else None,|'served_share': served / (main + unknown) if main + unknown else 0,|" deploy/measure-history.py`. Expected RED in the null case: `served_share` is 0, where null was expected.
  6. **A backend-suffixed counter not summed.** Run `sed -i "s|if name.partition(':')\[0\] == word)|if name == word)|" deploy/measure-history.py`. Expected RED in the first case: `served` is 0, where 20 was expected.
  7. **A scope word the sweep never writes (ruling RC3).** Run `sed -i "s|consumed('main'), consumed('other'), consumed('unknown')|consumed('main'), consumed('ambiguous'), consumed('unknown')|" deploy/measure-history.py`. Expected RED in the first case: `consumed_other` is 0, where 5 was expected.
  8. **The key appended after `w2`.** Run `sed -i "/^            'w1e': None,/d" deploy/measure-history.py`, then `grep -c "'w1e': None," deploy/measure-history.py`, which prints `0`. Expected RED in the key-order case: `'w1e'` is last, after `'w2'`.

  After the last restore, re-run Step 5's first two commands and see them green. `git diff --stat -- deploy/measure-history.py` shows Step 4's four edits only.

- [ ] **Step 7: Commit.**

```bash
git add deploy/measure-history.py server/test/measure-history.test.ts
git commit -m "feat(deploy): measure-history.py reads W1-e, the card line's delivery (spec 2026-10-05 §10.7)

w1e sums card_served:* and card_id_mismatch:* over their backend words and
reads card_consumed:main, :other and :unknown: served_share = served /
(main + unknown) (target >= 0.95), other reported beside it;
mismatch_share = mismatch / (served + mismatch) (target <= 0.02); each null
when its denominator is 0. It classifies no model (O32) and sits between
W1-c and W1-f in the report."
```

### Task 14: Docs and wrap-up: README card paragraph, CLAUDE.md figure, final verification, PR body

**Files:**
- Modify: `README.md`. Add a new paragraph inside B2's section, which is headed exactly ``### Session history: lossless recall (`ccrc history`)``. Anchor by content:
  - The paragraph goes after the line `whole exit table and tells a session when to recall.`, which ends B2's "Every answer opens with a header…" paragraph.
  - It goes before the blank line above the line that begins `**Box verbs and operator verbs.**`.
  - Step 1 measures that both lines occur exactly once.
  - This section lies below README's quoted hook call (Task 9's re-pointed `ccd/session-hook.sh:<n>`), so the insertion moves no citation of any other file.
- Modify, only when Step 3's measurement calls for it: `CLAUDE.md:10`, its `README.md (~N lines)` figure, in place. At f7e51156f the line begins ``**`README.md` (~5700 lines) is the canonical system overview.``; at origin/main 9a255a746 it says `~5800`.
- Create (gitignored scratch, not committed): `.superpowers/sdd/history-w1-b3/pr-body.md`.
- Test: the suites and checks in Steps 4 and 6 to 10.

**Interfaces:**
- Consumes:
  - B2's README section;
  - every earlier task's work. In particular:
    - Task 9's README re-point and census paragraph;
    - Task 10's `HISTORY_CARD_MAX + 1` reserve;
    - Task 11's single-definition binding;
    - Task 12's rows;
    - Task 13's `w1e`;
    - Task 1's `ci.yml` heredoc line.
  - The landing-order wave-1 plan's `cite-remeasure.py`, extracted by content in Step 6.
- Produces:
  - an 8-line paragraph in README, plus its leading blank line;
  - CLAUDE.md's README figure, re-measured;
  - the PR body file.

**Spec:** §10.5 (B3's contents and pins, its README assignment, the citation-corpus tax), §10.6 (B3 after B2; either order with B4), §10.7 (W1-e, W1-h, the W1 kill rules), §8.6 (the card line), §16. Departures:
- B1's D-4246 (`history-w1b-three-prs`): B3 after B2, either order with B4.
- D-4753 (`history-readme-card-paragraph`) (NEW, ruled RC1): §10.5 assigns B3 only README's `:2900` re-anchor. But B2's history section says nothing of the card line, and the 513-character reserve changes what every compaction card on a history box renders. So B3 adds one paragraph to that section, and CLAUDE.md's README figure is re-measured in the same commit (Step 3). The two "print nothing" sentences remain W3's.

**Choices this task makes:**
- The README paragraph is written, not skipped. Without it, an operator who sees the compaction card shrink, or a `History:` line, has no prose to read.
- This task edits no `ci.yml`. If the floor leg's wall time (Step 9) nears its deadline, that is reported to the coordinator rather than decided here.

- [ ] **Step 1: Measure the base.** From the repository root:

```bash
wc -l < README.md
sed -n 10p CLAUDE.md | grep -oE 'README\.md` \(~[0-9,]+ lines\)'
grep -c '^### Session history: lossless recall (`ccrc history`)$' README.md
grep -cx 'whole exit table and tells a session when to recall\.' README.md
grep -c '^\*\*Box verbs and operator verbs\.\*\*' README.md
grep -c '^\*\*The card line\.\*\*' README.md
```

Expected:
- a count; note it as `B`;
- ``README.md` (~N lines)``; note `N`;
- then `1`, `1`, `1`, `0`.

A `0` in place of a `1` means B2's section was reworded at merge. Find its paragraph about the exit table by reading the section, insert after it, and record the anchor you used in the PR body.

- [ ] **Step 2: Insert the paragraph.** After the line `whole exit table and tells a session when to recall.`, insert one blank line and then exactly these eight lines. The blank line that already precedes `**Box verbs and operator verbs.**` stays below them.

```markdown
**The card line.** After a compaction of a session's main thread, its `SessionStart` context gains one
line, directly above any compaction card, naming the leaf that compaction becomes and, when known, its parent:
`History: node L03a9c1… (this compaction) · parent N7c1e2f… · ~/.local/bin/ccrc history describe L03a9c1`.
The sweep writes that prediction under `~/.ccrc/history/card/` once it has read the session's transcript
to its end, and the hook only reads it, so `describe` answers exit 3 until the sweep has indexed that
compaction. A subagent's compaction, `~/.ccrc/history-off` and a session whose recall is switched off
get no line. On a box with history the compaction card renders 513 characters shorter, to leave the
line its room, and the sweep counts from each transcript whether the line arrived and named its leaf.
```

  - The `…` and `·` are U+2026 and U+00B7, written as themselves, as in spec §8.6's example. Check with `grep -c 'L03a9c1… (this compaction) · parent N7c1e2f…' README.md`, which prints `1`.
  - The paragraph carries:
    - no `file.ext:N` token, because README's census entry must stay empty and its resolved count stay 7;
    - no host, account or session name; the ids are the spec's example hex.

- [ ] **Step 3: Re-measure CLAUDE.md's README figure.**
  - Run `n=$(wc -l < README.md); echo "$n"`. It must print `B + 9`: the blank line and the eight lines. Any other number means the insertion added or dropped a line. Fix the edit, never the expectation.
  - Compute `echo $(( (n + 50) / 100 * 100 ))`. This is B1's and B2's rule: the count rounded to the nearest hundred.
  - If the result differs from Step 1's `N`, change that number in place on `CLAUDE.md:10`. That is one number on one line, and nothing else changes. If it equals `N`, leave `CLAUDE.md` untouched.

- [ ] **Step 4: Run every suite that reads README or CLAUDE.md, and the citation cases.** Run in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/oss-metadata.test.ts test/topology-clean.test.ts test/readme-roster-mirror.test.ts test/source-bytes.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus')
```

Expected:
- All green.
- `pools-prose` holds the figure within 100 lines of README.
- `topology-clean` finds no identity residue in the paragraph.
- `source-bytes` finds no control byte; `…` and `·` are not control bytes.
- The citation line reads `7 passed`. Its skipped count grows with every end-appended describe, and only the passed count is pinned. README's own entry stays empty and its resolved and checked counts stay 7.

If `pools-prose` reds, Step 3's figure was not applied. If `topology-clean` reds, a token in the paragraph reads as a host or id: replace it with the spec's example, never widen the scan.

- [ ] **Step 5: Commit the docs.**

```bash
git add README.md CLAUDE.md
git commit -m "docs(history): README's card-line paragraph in the ccrc history section, and CLAUDE.md's README figure"
```

If `CLAUDE.md` did not change in Step 3, `git add` stages nothing for it, and the commit carries README alone.

- [ ] **Step 6: Re-measure the S6-R11 census across the whole PR.** Task 9 measured the reader's insertion. Since then:
  - Task 10 edited the hook in place and in its tail;
  - Task 11 edited `single-definition.test.ts`, a cited file too (its census entry is 8 at f7e51156f), in place in B1's end-appended O14 describe and by an end-appended describe;
  - this task grew README.

  So the instrument swaps all three cited files this PR edits.

  This step re-runs the instrument once against the PR's own base, so the composition is stated for the PR as it will merge. From the repository root, with a clean tree (`git status --short` prints nothing):

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
[ -f "$SCRATCH/cite-remeasure.py" ] || python3 - "$SCRATCH/cite-remeasure.py" <<'EOF'
import re, sys
plan = open('docs/superpowers/plans/2026-09-24-landing-order-wave1-absorb-rules-and-advisory.md', encoding='utf8').read()
hits = [b for b in re.findall(r'^```python\n(.*?)^```$', plan, flags=re.S | re.M)
        if "Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT" in b]
assert len(hits) == 1, f'expected one instrument block, found {len(hits)}'
open(sys.argv[1], 'w', encoding='utf8').write(hits[0])
EOF
git fetch origin main
BASE="$(git merge-base HEAD origin/main)"; echo "base $BASE"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" "$BASE" --files ccd/session-hook.sh,README.md,server/test/single-definition.test.ts
git status --short
```

The extraction was checked against the landing-order plan as it stands on main: it yields one block, which compiles. Expected:
- the first printed line names `ccd/session-hook.sh, README.md, server/test/single-definition.test.ts` as the swapped files;
- every `byFile[…]` line reads `stated N  base N  tree N`, with no `<-- MOVED or unstated`, at the values B3's base carries (this plan quotes no number: B1's, B2's and other programmes' merges can move them);
- `total` reads the same three numbers. Trust the printed `stated`;
- the `byFile composition` lines read `ENTERED []` and `LEFT    []`;
- the row array and the site array each read equal stated, base and tree numbers, each with `ENTERED []` and `LEFT    []`;
- `git status --short` prints nothing: the instrument restores every file it swapped, and asserts it byte for byte.

If anything moved, an edit landed above a cited anchor. Find which task's edit it is and move the edit. Never run `--write`, and never touch the census literals by hand. Task 9's dated paragraph already records this PR's zero move, so a clean run adds nothing to the test file.

- [ ] **Step 7: Static checks: syntax, entry guards, rings, the lane, the frozen documents.** From the repository root:

```bash
bash -n ccd/session-hook.sh && echo hook-syntax-ok
for f in ccd/history/sweep.mjs ccd/history/cli.mjs ccd/history/card.mjs ccd/history/derive.mjs; do
  node --check "$f" || echo "SYNTAX $f"
  F="$f" node -e '
const lines = require("fs").readFileSync(process.env.F, "utf8").split("\n");
const open = "if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {";
const at = lines.flatMap((l, i) => (l === open ? [i] : []));
const tla = lines.filter((l) => /^[^\s\/]/.test(l) && /\bawait\b/.test(l));
const guarded = /\/(sweep|cli)\.mjs$/.test(process.env.F);
const below = at.length === 1 ? lines.filter((l, i) => i > at[0] && /^\S/.test(l)) : [];
const ok = tla.length === 0 && (guarded ? at.length === 1 && below.length === 1 && below[0] === "}" : at.length === 0);
console.log(process.env.F, ok ? (guarded ? "guard last, no top-level await" : "no guard, no top-level await")
  : `NOT OK: guards=${at.length} below=${JSON.stringify(below)} tla=${JSON.stringify(tla)}`);
'
done
grep -nE "^import " ccd/history/lib.mjs
grep -rlE "from '\./card\.mjs'" ccd/
grep -nE "from '\./(sweep|cli)\.mjs'" ccd/history/card.mjs
grep -lE "from 'node:sqlite'" ccd/history/*.mjs
grep -n 'process\.env' ccd/history/card.mjs
grep -nHE '/history-off' ccd/history/card.mjs ccd/history/sweep.mjs | grep -vE ':[0-9]+:\s*(//|\*|/\*)'
git fetch origin main
BASE="$(git merge-base HEAD origin/main)"
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/compact-card.mjs ccd/ccrc ccd/ccrc-doctor-checks server/src pwa agent shared/api.ts \
  && echo "nothing outside the fleet-side lane"
git diff --quiet origin/main -- docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo "corpus documents frozen"
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
git diff --name-only "$BASE" HEAD | sort > "$SCRATCH/changed.txt"
printf '%s\n' .github/workflows/ci.yml CLAUDE.md README.md ccd/history/card.mjs ccd/history/derive.mjs ccd/history/lib.d.mts \
  ccd/history/lib.mjs ccd/history/sweep.mjs ccd/session-hook.sh deploy/measure-history.py server/test/history-card.test.ts \
  server/test/history-lib.test.ts server/test/historyFixtures.ts server/test/lifecycle.test.ts server/test/measure-history.test.ts \
  server/test/session-hook.test.ts server/test/single-definition.test.ts shared/lifecycle.ts | sort > "$SCRATCH/planned.txt"
comm -23 "$SCRATCH/changed.txt" "$SCRATCH/planned.txt"
```

Expected, in order:
- `hook-syntax-ok`.
- Four lines:
  - `ccd/history/sweep.mjs guard last, no top-level await` (R1);
  - `ccd/history/cli.mjs guard last, no top-level await` (R1);
  - `ccd/history/card.mjs no guard, no top-level await`;
  - `ccd/history/derive.mjs no guard, no top-level await`.
- One `import` line in lib.mjs, from `node:crypto` (L1).
- `ccd/history/sweep.mjs` alone: it is card.mjs's only importer.
- Nothing: card.mjs imports neither sweep.mjs nor cli.mjs, so there is no cycle.
- `ccd/history/store.mjs` alone: the sole `node:sqlite` importer (L3). Comments that name `node:sqlite`, which sweep.mjs carries, do not match `from 'node:sqlite'`.
- Nothing: card.mjs reads no `process.env`.
- Nothing: neither L4 module spells `/history-off` on a code line. Holds come through lib's `SWITCHES` and the paths table (O13's holder list is exact). The second `grep` drops comment lines, which O13 does not read either.
- `nothing outside the fleet-side lane`: no wire, server, PWA, `ccd/ccd`, `compact-card.mjs`, `ccrc` or doctor change.
- `corpus documents frozen`.
- `comm` prints nothing. A line it does print is a file some task touched beyond the plan's file map. Name it in the PR body under "Choices the tasks made", with the task that touched it; never revert it here.

- [ ] **Step 8: Run every suite the PR touches or whose subject it changed, in the foreground.** Run each line on its own, with a timeout of at least 600000 ms. A red in a known load-flake file (`session-hook` among them) is re-run in isolation before it is called a break.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts test/history-parser.test.ts test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts test/history-drain.test.ts test/history-ingest.test.ts test/history-holds.test.ts test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts test/history-cli.test.ts test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook-turnmark.test.ts test/session-hook-merge-deny.test.ts test/session-hook-sync-advisory.test.ts test/install-session-hooks.test.ts test/macos-platform.test.ts test/compact-card.test.ts test/compact-card-ship.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/lifecycle.test.ts test/ci-pipeline.test.ts test/source-bytes.test.ts)
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/oss-metadata.test.ts test/topology-clean.test.ts test/readme-roster-mirror.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: every line is green, and tsc prints nothing. Copy each line's `Test Files … | Tests …` summary, as printed, into the PR body (Step 12).
- Every spawning history suite skips on darwin; on Linux they run whole.
- `history-lib.test.ts`'s `every ccd/history/*.mjs has a ring` now sees `card.mjs` through Task 5's `RINGS` row, and `history-sweep.test.ts`'s F39 describe sees Tasks 5 and 7's `tick` doc-comment items: a red in either means a row or an item is missing, never an assertion to loosen.
- Why these suites:
  - `history-recover` and `history-maint` run the sweep paths `cardStep`'s tick wiring sits beside: a recovery pass must still write no card.
  - `ccrc-doctor` relays the history check, which mode-checks `card/` (dirs 0700, files 0600).
- If `ccrc-doctor` exceeds the bound, run it in parts by `-t` with its describe names, each in the foreground.
- `ccrc-install.test.ts` is left to the full CI run (the PR body's coordinator step 1). B3 changes no installer, unit or install-time doctor answer, and that file's whole-file time exceeds the 10-minute foreground bound.

- [ ] **Step 9: Measure the floor leg's wall time on its own list, as CI runs it.** Task 1 added `history-card.test.ts` to the `node-floor` job's list, and B2 sized that job's deadline. From the repository root:

```bash
SCRATCH="$(git rev-parse --show-toplevel)/.superpowers/sdd/history-w1-b3/scratch"; mkdir -p "$SCRATCH"
grep -E '^ {10}test/' .github/workflows/ci.yml | sed 's/^ *//' > "$SCRATCH/floor-list.txt"; wc -l < "$SCRATCH/floor-list.txt"
grep -c '^test/history-card\.test\.ts$' "$SCRATCH/floor-list.txt"
sed -n '/^  node-floor:$/,/^    timeout-minutes:/p' .github/workflows/ci.yml | tail -1
(cd server && CCRC_TEST_LIST="$SCRATCH/floor-list.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts 2>&1 | tail -6)
```

Expected:
- `17`: B1's ten, B2's six and `history-card`. It is `18` if B4 merged first, with its `history-export`.
- Then `1`.
- Then the job's `timeout-minutes:` line.
- Then a green summary whose last lines carry `Duration`.

Copy the summary and its `Duration` into the PR body. If `Duration` exceeds half the job's `timeout-minutes`, or the foreground bound cuts the run off, report it to the coordinator in the wave-done and leave `ci.yml` alone.

- [ ] **Step 10: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red means a deviation number is defined in two plans. Report it to the coordinator. Never renumber it yourself: numbers are minted by the coordinator, never chosen. This plan's numbers were minted when it was committed (D-4736 through D-4753); a number this wave defines comes from its run block.

- [ ] **Step 11: Confirm the tree holds only this PR's work.** Run `git status --short`. It prints nothing:
  - every task committed its own files;
  - every scratch file sits under the ignored `.superpowers/`;
  - no step of this plan read or wrote a live `~/.ccrc`: every test ran in a `mkTmp` HOME, and every history verb ran against a fixture store.

- [ ] **Step 12: Write the PR body.** Write `.superpowers/sdd/history-w1-b3/pr-body.md` with exactly the text below. Then replace its three parenthesised lines:
  - the one under `### Departures`: the plan's `## Deviations found` list, one line per entry, with the numbers as the coordinator minted them;
  - the one under `### Choices the tasks made`: every task's "Choices this task makes" bullets and every "needs ruling" note, one line each, with its task number first, plus any file Step 7's `comm` printed;
  - the one under `### Tests run`: Step 8's summary lines as printed, then Step 9's floor-leg summary and `Duration`.

  Use the file as the body of the wave's PR, opened the way the brief says.

```markdown
## ccrc history W1-B3 "card line"

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.5), §10.5's B3 bullet.
Plan: the B3 plan this wave's brief names.

The card-line PR of W1 Part B, on top of B1 ("capture") and B2 ("recall"):

- a PreCompact scope marker, `~/.ccrc/history/scope/<id>` = `<scope> <psid> <ms>`, written in the hook's tail
  after `_hook_compact_pre` and emptied first, directly below the event `case`, so the line reaches only a
  main-thread compaction (a regular file or nothing, in a `scope/` that is no symlink, so a planted FIFO
  never blocks the hook);
- `_hook_history_card`, defined above the hook's event `case` (the one sanctioned insertion above README's hook
  anchor), builtin-only, folding one grammar-gated line into the compact subject when it fits:
  `History: node L… (this compaction)[ · parent N…] · ~/.local/bin/ccrc history describe L…`;
- the 513-character reserve that leaves that line room in the compact card's render, on a box where
  `~/.ccrc/history/card/` exists;
- `ccd/history/card.mjs`: the sweep makes `scope/` and `card/` (0700), writes one prediction per session id
  (`card/<id>/<uuid>.txt`, 0600, only once it has read the transcript to its end, and only while the run's
  budget is left), deletes it when a later boundary consumes it and counts that consumption by the scope marker
  its compaction left (`card_consumed:main`, `:other`, `:unknown`), withdraws every prediction on a pass that
  runs no card step (`card_withdrawn:<reason>`: fail closed), measures delivery from the post-boundary
  SessionStart attachment (`card_served`, `card_id_mismatch`), and collects purged sessions' files after 7 days;
- README's hook anchor re-pointed by content, and the S6-R11 census re-measured for the whole PR (no key moved); the
  `history-scope-markers` and `history-card-files` lifecycle rows; `measure-history.py`'s W1-e query; a short
  card-line paragraph in README's history section.

No wire, server, PWA, `ccd/ccd`, `compact-card.mjs` or doctor change; no new hook event arm and no new `--op` verb.
B3 follows B2; B3 and B4 merge in either order.

### Pins

S16, C18-C22, C37, C38; the marker and card halves of S2, S3 and S8, each measured red with a mutant (IV6);
O17's B3 half; O14's hook half of `CARD_PREFIX` (the hook's grammar, cap and directory names bound to lib).
Not a mutant's: C37's `empty` marker row, which two guards refuse at once (defence in depth), the clock case's
`unset` row (an empty reading is never fresh, clock grammar or not), and the CONTROLs no mutant reds, such as the
recall-off parity table's (the marker's regular-marker CONTROL is measured, by `T8-M17-absent-only`).

### Known W1-e distortions

Read W1-e (step 7 below) with these in hand. None is fixed in this PR.

- **Unknown consumptions stay in the denominator.** Each consumption is counted by the scope marker its
  compaction's PreCompact left (ruling RC3). A main compaction the hook scoped `ambiguous` (subagents or Workflow
  agents writing at the time) counts `card_consumed:other`, out of `served_share`'s denominator and reported
  beside it. One whose marker was overwritten by a later compaction, emptied by an undecided one, unreadable, or
  never written (a box where `scope/` did not exist yet) counts `card_consumed:unknown`, which stays in the
  denominator: it can only lower the share. A large `consumed_unknown` says the markers were not readable.
- **Two compactions of one session between two ticks.** The second SessionStart is served the first's stale line,
  counted `card_id_mismatch`.
- **No pass, no consumption and no withdrawal.** Every scheduled pass that runs but does not run the card step
  withdraws every prediction (ruling RC2: a cap or floor pause, a per-chunk floor stop, an ingest an unreadable
  roster skipped, a budget spent before the step, the recover or migrate arm, a held, refused, unbound or
  unreachable store), so a compaction in those states is served nothing. Named residuals: with the sweep's timer
  dead no pass runs at all, and a pass that meets the store's write lock (busy, which only a test injects: the
  sweep is the only writer under its lock) returns before both; in either, a second compaction is served the last
  prediction (counted `card_id_mismatch` once derivation resumes). An `--op` pass neither ticks nor withdraws; the
  next scheduled pass decides. A compaction while the predictions are withdrawn carries no line and is not
  counted consumed: its indexer was not caught up, which W1-e excludes.
- **A crashed boundary is never measured.** A boundary whose parse crashed before its leaf was written (RB5's
  `leaf-crashed`) has no leaf, so its delivery is never counted (an undercount).
- **A restore or rebuild inside the reading window voids the reading.** Re-derived leaves can be measured again with
  no matching consumption, so a `served_share` above 1 is the tell. The recover arm withdraws every prediction
  (ruling RC2), so a restore no longer adds a spurious consumption.
- **Not a distortion, a note: B2's pasted-line path is unchanged.** The card names its own command, `describe
  L<prefix>`, a bare id. A paste that starts at `History: node` gives B2's parser the leaf. A paste of the whole
  physical line from a transcript, where the standing cards sit in front of it, names the leaf and the parent, and
  B2's parser refuses it as several ids. B3 changes nothing on the CLI side.

### Departures

(the plan's `## Deviations found` list, as minted)

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR edits `.github/workflows/ci.yml`, which selects the full suite. If the PR's
   `select tests` summary does not show a full run, dispatch one:
   `gh workflow run ci.yml --ref <this branch> -f mode=full`. `ccrc-install.test.ts` was not run on the
   worker's box (it exceeds the foreground bound), so the full run is its measurement.
2. **Numbers.** The departures this plan defines (the thirteen marked NEW, among them
   `history-card-withdrawn-when-not-ticking`, and the five spec §16 slugs it defines first) were minted when the
   plan was committed: D-4736 through D-4753. A slug B2 defined keeps the number it was issued there. B1's departures are
   already cited by their numbers (B1's D-NNNN) and are not in the list.
3. **Rulings applied (RC1–RC4, and the operator's Q15–Q19), for the record.** Each is implemented as ruled; nothing
   here waits on a ruling.
   - RC1, accepted as implemented: the scope marker's early truncation (every main-thread PreCompact
     empties the id's older marker directly below the hook's event `case`, before any tail exit, and only a
     decided verdict is written after the card's call), now spec §5.1's rule "The early truncation" (rev 3.5),
     so cited there and not a departure; `history-hook-card-names-once`; `.` and `..` refused
     structurally within `history-id-grammar`; no separate 512-char length test; `history-w1e-query-in-b3`; the
     card measure's window (`history-card-measure-window`: 40 rows after the boundary, an attachment body over
     1 MiB skipped unread); the sweep makes `scope/` and `card/`, keeps one prediction per id, predicts only for
     the uuid the registry names, from the live copy written last, and ages purged files by their own mtime;
     `history-card-files-creator-through-card`; `history-readme-card-paragraph`, with CLAUDE.md's README figure
     re-measured; the reserve stays 513 (C38); the card spells `~/.local/bin/ccrc`, and spec rev 3.3's §16
     `history-skill-literal-path` row now agrees with §8.6, so no erratum is left.
   - RC2, fail closed (`history-card-withdrawn-when-not-ticking`): every scheduled pass that runs but does not run
     the card step withdraws every `card/<id>/<uuid>.txt`, lstat-checked, unlink only, never through a link,
     counted `card_withdrawn:<reason>` (a hold with no DB open prints the count on its outcome line). lib's
     `decideCardWithdraw` decides; the budget bounds a write, never the consume/delete decision. The dead timer
     is a named residual (the third distortion above).
   - RC3, classify (`history-card-consumed-counter`): each consumption is counted `card_consumed:main`, `:other`
     or `:unknown` by the scope marker its compaction left; `served_share = served / (main + unknown)`, with
     `other` and `unknown` reported beside it; the mismatch share stays over served plus mismatch.
   - RC4, parity fail closed (`history-card-recall-off-unreadable-off`): the hook's recall-off read treats a read
     that fills its 128-character window as OFF, so a hand-padded file never serves where the CLI answers exit 8
     (parity row: 130 spaces followed by the resolved generation).
   - R-recalloff-parity: when neither `CCRC_SESSION_GENERATION` nor `$REG/<id>.generation` resolves a generation,
     the CLI compares `recall-off/<id>` with the id's newest family's generation, which only the store knows. The
     sweep records that generation beside each prediction, `card/<id>/<uuid>.gen` (written before the prediction,
     removed rather than left stale where no write is allowed), and the hook compares with it there; with no
     usable record, a recall-off file that exists withholds the line. Parity rows: an invalid env generation and an
     unreadable or absent `.generation` with recall-off holding the newest family's G (no line; the CLI exits 8),
     and the empty-file rows against a legacy and a G newest family. A store swapped between ticks (a restore or a
     rebuild) leaves the record as stale as the prediction beside it until the next card step; a pass that runs no
     card step (the recover arm, for one) withdraws that prediction, and with it the record's only reader.
   - R-recalloff-trim (the final check's R1): the hook trims `recall-off/<id>` of ASCII whitespace only, where the
     CLI's JS trim also strips U+00A0, U+FEFF and the Unicode spaces, and withholds the line when the trimmed value
     holds any character outside the generation grammar (empty, or `[0-9a-f-]`). The one deliberate asymmetry, in the
     safe direction: it may withhold where the CLI recalls, never serve where the CLI exits 8. Parity rows: a
     no-break space and a byte-order mark before the resolved generation G (no line; the CLI exits 8).
   - R-recalloff-keep (the final check's R2): a generation record that was due (written or removed) and could not
     be acted on, beside a prediction that stands, removes that prediction too, counted `card_unrecorded_removed`,
     so no prediction is left beside a stale record until the boundary consumes it.
   - The operator's rev 3.4 rulings (2026-10-07), for the record. Q15, Q17, Q18 (a W2 matter), Q19 and prune at
     low disk change nothing in B3. Q16 (SessionStart(fork) spooled from B2, `history-fork-spooled`) changes no B3
     code: the card reads no epoch cause, so a fork's confirmed epoch is predicted for as any other is. B3 pins it
     with one sweep case (a fresh-sid fork's card starts at the parent boundary its copy holds, as derivation does)
     and one hook row (a SessionStart(fork) never serves).
   - Named for the coordinator, no B3 change: the attachment shape the card measure reads
     (`hook_additional_context`, string-array content) is B1's fixture shape and has not been measured on a live
     transcript in the tree; the first W1-e reading (step 7 below) is its check. And `$REG/<id>.generation`,
     ccd's own 36-byte file, keeps `_ct_read`'s 128-character read, which RC4 did not rule: a `.generation` that
     a hand edit pads past character 128 reads as no generation in the hook, where the CLI reads the generation.
4. **Programme ledgers.** README's hook anchor is no longer `:2900`. The rule other programmes quote ("nothing new
   above `:2900`") now reads: nothing new above the line that reads `if _hook_emit_context "$CARD" "$CARD_COMPACT"`,
   found by content. B3 is its one sanctioned insertion (`history-card-reader-above-the-arm`). A wave that
   inserts lines above that line pays the S6-R11 census again; a line-neutral edit there does not.
5. **Merge order.**
   - #248 (landing order W3), #299 (session continuity W4) and #284 (delegation broker W1) are already on this
     PR's base. #189 rewrites the identity block beside the reader's insertion: whichever of #189 and B3 lands
     second rebases by content and re-measures the S6-R11 census on its own tree.
   - CLAUDE.md's README figure is a conflict hot spot. Re-measure it on the second PR's tree.
   - If B4 lands after B3, it appends `'B4'` to `HISTORY_LANDED` after `'B3'`, and its row goes below B3's.

### Operator steps (none of them arms anything)

6. **Arming.** Once a session-hosting node runs a release that carries this PR, its first scheduled tick creates
   `~/.ccrc/history/scope/` and `~/.ccrc/history/card/` (0700), and the hook half goes live with them. Confirm
   with existence checks only: `ls -ld ~/.ccrc/history/scope ~/.ccrc/history/card`. A node with
   `~/.ccrc/history-off` stays unarmed.
7. **W1-e.** After about a week of post-install compactions, run `python3 deploy/measure-history.py` on each node,
   read-only, as the store's own user. Its `w1e.served_share` must be at least 0.95, and its
   `w1e.mismatch_share` at most 0.02. A `null` share means nothing was measured yet, never a pass. Read it only
   over a window in which `ccrc doctor` showed no capture pause and the sweep's timer ran, and in which no
   restore or rebuild completed; a `served_share` above 1 means one did, and voids the reading. Record
   `consumed_main`, `consumed_other` and `consumed_unknown` beside the two shares: the served share is over
   main and unknown, and a large unknown count (markers not readable) makes it conservative, as the distortions
   list describes. Record the numbers per node on this PR or in the programme ledger.
8. **W1-h, the card half.** On one gateway-lane session (whichever launch kind is live), the post-compaction
   SessionStart context of a main-thread compaction carries the `History:` line, and
   `"$HOME/.local/bin/ccrc" history describe <its L prefix>` exits 0 once the sweep has indexed that compaction.
9. **Kill switch.** `~/.ccrc/history-off` silences both the marker and the line. There is no new switch.

### Choices the tasks made where the spec and the rulings are silent

(every task's "Choices this task makes" bullets and "needs ruling" notes, one line each, its task number first)

### Tests run (foreground, on the worker's box)

(Step 8's summary lines as printed, then Step 9's floor-leg summary and Duration)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

  - The three parenthesised lines are the only text this step replaces. Every other line is final, the fixed `### Known W1-e distortions` list included: it is the W1-e caveats the tasks name (Review Focus 2, 3 and 6, Tasks 5, 6 and 13), written once here so the reading in step 7 has them, and the `### Steps for the coordinator` record of rulings RC1–RC4 and of the operator's rev 3.4 rulings.
  - The body names no host, account, home or session id. Check with `grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|\.ts\.net|/home/' .superpowers/sdd/history-w1-b3/pr-body.md`, which must print nothing.
  - The file stays under `.superpowers/` (gitignored) and is not committed. No further commit is needed: Step 5 committed this task's only tracked change, and Steps 6 to 11 leave the tree clean.

## Deviations found

Every departure this plan takes from the spec is listed once below, in the order its first task meets it, with the task(s) that carry it. The text is the spec's §16 departure, except for the NEW departures, which no §16 row covers. Each of those is marked "NEW departure (no spec §16 row)" with its one-line why.

**D-4736 through D-4753 were issued in one block by the allocator (`POST /api/ledger/deviations`, 2026-10-09) and are defined here.** A slug the B2 plan defines (marked "B2-defined") is listed with B2's number and is not defined again. A departure B1 defined is not listed here: B1 is merged, so the tasks cite it by its issued number as "B1's D-NNNN (`<slug>`)", defined in `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md`'s `## Deviations found`. A departure found while executing the wave takes a number from the wave's run block, named in its brief, and is appended below.

- **D-4736** — `history-card-fold-and-reserve` (Tasks 1, 9, 10): The history line folds into `CARD_COMPACT` and its room is reserved in the render; no new card constant beyond the reserve (§8.6). This plan defines it first. The reserve is `HISTORY_CARD_MAX + 1`; the hook's one new number is D-4750 (`history-hook-card-names-once`)'s. The fold is spelled `CARD_COMPACT="$v${CARD_COMPACT:+$nl$CARD_COMPACT}"` with `nl=$'\n'` assigned outside the quotes, where §8.6 writes `$'\n'` inside `${…:+…}`, which `bash --posix` does not expand (measured; Task 9's `T9-M20` pins it): the same behaviour, a different spelling.
- B2's D-4682 (`history-skill-literal-path`) (Task 1): The skill uses the literal `$HOME/.local/bin/ccrc` and the card line `~/.local/bin/ccrc`, as §8.6's grammar pins it (rev 3.3); no installer substitution, no `ccrc-history` binary (G2). B2-defined. Spec rev 3.3 corrected this §16 row to agree with §8.6, so the card's spelling is the spec's and no erratum is left (ruling RC1); B2's `HISTORY_CMD` keeps its own spelling.
- B2's D-4688 (`history-span-per-boundary-copy`) (Tasks 2, 4): Span positions come from the copy that holds each boundary; rows absent from it join no leaf (§6.1; Q8). B2-defined, and extended to fan-in by ruling RB4. The card's prediction calls `planSpans` itself and reads Task 4's exported per-copy slot lists.
- B2's D-4689 (`history-leaf-id-fork-qualified`) (Task 2): When two forks claim one span start, the later leaf's id also hashes its boundary uuid (§6.1; Q8). B2-defined. A next leaf the fork rule would qualify gets no prediction (`card_skipped:fork-qualified`), because the boundary uuid it would hash does not exist yet.
- **D-4737** — `history-card-measured-from-transcript` (Tasks 2, 3, 6, 9, 13): Card delivery is measured from the transcript; no card receipt (§8.6). This plan defines it first.
- **D-4738** — `history-card-consumed-counter` (Tasks 2, 3, 5, 13): NEW departure (no spec §16 row), ruled RC3. The spec names only `card_served` and `card_id_mismatch`, and "with a caught-up indexer" cannot be measured without a record of the prediction. Each prediction a later boundary of the main transcript consumed, one deleted on a fork skip included, is counted `card_consumed:<scope>`: `main` when the scope marker its compaction's PreCompact left reads `main <uuid> <ms>` with the ms not after the consumed boundary's time and within `COMPACT_CARD_MAX_AGE` of it, `other` for `subagent` or `ambiguous` in that window, `unknown` otherwise (overwritten, emptied, unreadable). `card.mjs` reads `scope/<id>` read-only, never through a link; lib's `decideConsumedScope` folds it. W1-e's `served_share = served / (main + unknown)`, with `other` and `unknown` reported beside it.
- **D-4739** — `history-card-measure-window` (Tasks 3, 6): NEW departure (no spec §16 row), ruled RC1 (accepted). §8.6 reads delivery from "the post-boundary SessionStart attachment" and names no window. A leaf is decided within `CARD_MEASURE_ROWS` (40) rows after its boundary in its holding copy, or at the next boundary, or once that copy is read to its end `RAW_LEAF_GRACE_MS` past the boundary, or once the copy is no longer live, or `CARD_MEASURE_MAX_WAIT_MS` (24 h) after the leaf was derived. Leaves derived before the measure's first pass are never measured, so pre-B3 leaves never read as unserved. An attachment body over `CARD_ATTACHMENT_MAX_BYTES` (1 MiB, by its stored `raw_len`) counts as a window row and is skipped unread.
- **D-4740** — `history-card-withdrawn-when-not-ticking` (Tasks 3, 5, 12): NEW departure (no spec §16 row), ruled RC2. §8.6 deletes a prediction only when the boundary that consumed it is ingested, and says nothing of a pass that cannot ingest it, which would leave a stale line for the next compaction. So every scheduled pass that runs but does not run the card step over a caught-up ingest (a cap or floor pause, a per-chunk floor stop, an ingest an unreadable roster skipped, a budget already spent before the card step, the recover or migrate arm, a held, refused, unbound or unreachable store) withdraws every `card/<id>/<uuid>.txt`: lstat-checked, unlink only, never through a link, counted `card_withdrawn:<reason>`, or, on a hold with no DB open, printed on the pass's outcome line. lib's `decideCardWithdraw` decides; `card.mjs` and `sweep.mjs` measure and act. The budget bounds a write, never the consume/delete decision. A dead timer is a named residual.
- **D-4741** — `history-card-dirs-made-by-sweep` (Task 5): NEW departure (no spec §16 row), ruled RC1 (accepted). The spec says the hook never makes `scope/`, which it writes, and names no creator for it or for `card/`. So the sweep makes both (0700) at every bound store's tick: the marker and the reserve arm within one tick of an update, and never on a box without history.
- **D-4742** — `history-card-one-file-per-id` (Tasks 5, 12): NEW departure (no spec §16 row), ruled RC1 (accepted). §8.6 deletes a prediction only on consumption. Writing a new uuid's prediction also removes the id's other `<uuid>.txt` (a `/clear`ed or forked session's), so §9.4's "≤512 B per session" holds without waiting for the 7-day purge.
- **D-4743** — `history-card-registry-names-the-session` (Tasks 5, 7): NEW departure (no spec §16 row), ruled RC1 (accepted). A prediction is written only for the uuid `$REG/<id>.uuid` names. The 30-minute scan reads every known transcript to its end, so end-of-file alone would write a file for every session the store ever saw. A file the registry no longer names is still consumed and deleted.
- **D-4744** — `history-card-newest-live-copy` (Task 5): NEW departure (no spec §16 row), ruled RC1 (accepted). §8.6 names "the transcript's cursor" in the singular. With several live copies (after a swap carry), the prediction reads the copy written last (newest `mtime_ns`, then the larger `file_id`), the one Claude Code appends the next boundary to. A wrong guess is counted as a mismatch, never served silently.
- B2's D-4734 (`history-fork-spooled`) (Tasks 5, 9): SessionStart(fork) writes a spool line from W1-B2: `fork` joins the hook's source whitelist in place (no hook line moves, no S6-R11 census change), `SPOOL_SOURCES` and `EPOCH_CAUSES`; the line carries `src` and `reg` and confirms exactly as resume does; a fork whose sid is already an epoch confirms that epoch, a fresh sid chains a `fork` epoch, and copied rows follow the per-copy span rule (§5.1, §6.1, §9.14; DM48; ruled Q16, rev 3.4). B2-defined. B3 changes no code for it: the card reads no epoch cause. Task 5's spooled-fork case pins a fork epoch's prediction over the parent's boundary its copy holds, and Task 9's fork row pins that a SessionStart(fork) never serves.
- **D-4745** — `history-purged-files-aged-by-mtime` (Task 7): NEW departure (no spec §16 row), ruled RC1 (accepted). §9.4 collects "the files of purged sessions after 7 days", but ccd's purge leaves no time the sweep can read. So the age is the entry's own newest write, once the registry no longer names the session, and a file last written long before the purge can go at the first scan after it.
- **D-4746** — `history-scope-marker-after-card` (Task 8): The PreCompact scope marker is written after `_hook_compact_pre`, outside the spool block, gated on `scope/`; it reuses a set `CS_SCOPE`, writes nothing on a set-but-empty one, and runs scope itself when the card did not (§5.1; rev 3.2 review, CT1, FE7). This plan defines it first. Its "writes nothing on a set-but-empty one" is completed by spec §5.1's "The early truncation" (rev 3.5; ruled RC1, stated in the spec as the rule, so not a departure): every main-thread PreCompact first empties an existing marker below the event `case`.
- **D-4747** — `history-card-main-scope-only` (Tasks 8, 9): A PreCompact scope marker gates the card line to main compactions (§5.1, §8.6). This plan defines it first.
- **D-4748** — `history-card-reader-above-the-arm` (Task 9): `_hook_history_card` is defined above `:2771`; README's `:2900` re-anchored by content (§8.6). This plan defines it first. The insertion sits directly above the line that begins `state="" ask_json=`, and README's anchor is now the emitter call found by its text.
- B2's D-4680 (`history-recall-off-generation`) (Task 9): `recall-off/<id>` holds the generation it was assigned to and is honoured only for that family (§9.7, §10.2; rev 3 review, Q7). B2-defined. The hook resolves the generation as B2's CLI does (coordinator ruling R-recalloff-parity): the env value with the UUID grammar, else `$REG/<id>.generation` with it (B2's `resolveGeneration`), else the id's newest family's generation, `''` for a legacy family or none, which the hook reads from the record the sweep writes beside the prediction (`card/<id>/<psid>.gen`, Tasks 2 and 5) because it cannot read the store; with no usable record, a recall-off file that exists withholds the line (fail closed). Tasks 5 and 9 carry the record (Task 2 decides it); the record is the ruling's mechanism, not a new departure.
- **D-4749** — `history-card-recall-off-unreadable-off` (Task 9): NEW departure (no spec §16 row), ruled RC4. §8.6 honours recall-off "only when its content equals" the generation, but B2's `decideRecallOff` answers an unreadable, symlinked or non-file `recall-off/<id>` `off`. The hook follows the CLI, so one family is never put in two eval arms. The hook reads `CCRC_ID_MAX` (128) characters of the file where the CLI reads 4,096 bytes, so a read that fills that window is OFF too, the side that withholds the line: a hand-padded file never serves where the CLI answers exit 8 (the parity row "130 spaces followed by the resolved generation G"). With anything else after the padding, such a file withholds a line the CLI's stale answer would not, which the ruling accepts. Coordinator ruling R-recalloff-trim adds the one deliberate trim asymmetry on the same side: the hook trims ASCII whitespace only, where the CLI's JS trim also strips U+00A0, U+FEFF and the Unicode spaces, so a value that holds a character outside the generation grammar after the hook's trim withholds the line (the parity rows "a no-break space …" and "a byte-order mark before the resolved generation G").
- **D-4750** — `history-hook-card-names-once` (Tasks 9, 11): NEW departure (no spec §16 row), ruled RC1 (accepted). D-4736 (`history-card-fold-and-reserve`) says "no new card constant beyond the reserve". The hook gains one number, `HISTORY_CARD_MAX`, from which the reserve and the read size derive, plus one spelling each of the grammar and the two directories. None is a budget; each is declared once and bound to lib by Task 11.
- **D-4751** — `history-card-files-creator-through-card` (Task 12): NEW departure (no spec §16 row), ruled RC1 (accepted). §9.4 writes the `history-card-files` row's creator as `sweep.mjs`; the row spells `ccd/history/sweep.mjs (through card.mjs)`, after B1's `history-store` row (`(through store.mjs)`, §9.4's own wording there), so a reader looking for the writer finds the module that writes the file.
- **D-4752** — `history-w1e-query-in-b3` (Task 13): NEW departure (no spec §16 row), ruled RC1 (accepted). §10.5 does not list `deploy/measure-history.py` among B3's contents; W1-e's counters first exist in B3, so its named query ships beside them.
- **D-4753** — `history-readme-card-paragraph` (Task 14): NEW departure (no spec §16 row), ruled RC1 (accepted). §10.5 assigns B3 only README's `:2900` re-anchor. But B2's history section says nothing of the card line, and the reserve shortens every compaction card on a history box, so B3 adds one paragraph to that section. CLAUDE.md's README figure is re-measured in the commit that grows README.

23 slugs in all: 13 NEW to this plan (`history-card-withdrawn-when-not-ticking` came with ruling RC2), and 10 spec §16 slugs. The scope marker's regular-file gate (ruled R-B3-fifo, review finding R74), its early truncation (ruled RC1; once a NEW departure of this plan, retired to the spec) and the `card.mjs` module (review finding R77) are spec rev 3.5's rule (§5.1, §5.3 and S16, §5.1's "The early truncation"; §6.4), cited in Tasks 5 and 8, and are not departures. Of those 10, 5 are B2-defined (`history-fork-spooled` came with the operator's ruling Q16), and this plan defines 5 first. B1's departures D-4170 (`history-id-grammar`), D-4224 (`history-tick-order`), D-4196 (`history-producer-backend`), D-4252 (`history-epoch-lines-survive-off`), D-4246 (`history-w1b-three-prs`) and D-4418 (`history-spool-append-regular-file-only`) are cited by number in the tasks and not listed. The five this plan defines first: `history-card-fold-and-reserve`, `history-card-measured-from-transcript`, `history-scope-marker-after-card`, `history-card-main-scope-only` and `history-card-reader-above-the-arm`.
