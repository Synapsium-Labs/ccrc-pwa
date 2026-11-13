# W1a start report: departures found while building it

A note for the programme's ledger pull request, written by the worker of run 1886 (#2740). It adds to
`docs/superpowers/plans/2026-11-10-overlord/w1a-start-report.md`, as that plan's Global Constraints direct. Each entry is
a slug and its reason. The one number this piece was issued, D-8557, is defined in the plan and in the index plan.

## The door and the store (Tasks 1 and 2)

- **attribution-reused** — the door calls the tree's one attribution gate, injected as `attribute` over
  `attributionVerdict` with `'fromUuid'`, and answers through `refuseRoute`, as every box-token lane does.
- **registry-unmeasurable-502** — a registry that cannot be read answers 502 `registry-unmeasurable`, never a guess.
- **not-owner-for-id-mismatch** — a body whose `fromId` is not the path's session answers 403 `not-owner`, the word the
  other box-token lanes use for that.
- **shape-before-attribution** — the body's shape is checked before the registry is read, so a malformed report never
  costs a registry read; a malformed report from a stale uuid is a 400, not a 403.
- **malformed-rowIncarnation-400** — a `rowIncarnation` outside the generation grammar is refused 400; an absent one
  is stored as null.
- **rowIncarnation-is-a-uuid** — the plan's `regGen` is the registry row's generation as the spawn exports it
  (`CCRC_SESSION_GENERATION`), a lowercase uuid, stored as TEXT under the name `rowIncarnation`.
- **generation-shape-imported** (review 1911, F5) — the door checks `rowIncarnation` against `REG_GENERATION_SHAPE`
  from `shared/api.ts`, which `child-reclaim-generation-shape.test.ts` holds equal to ccd's `_reg_generation_valid`.
  The hook spells the grammar inline, because bash cannot import, beside a comment naming both.
- **started-uuid-is-data** (review 1911, F4) — the door attributes the SENDER, `fromUuid`, against the registry at
  send time, and records the reported conversation's uuid from the additive body field `startedUuid`. A body without
  it (an older hook) records `fromUuid` and meets the same check as before. The hook rewrites `fromUuid` to its current
  `session_id` on every resend, so a report spooled before a `/clear` or a fork hop lands once the registry follows,
  as spec §3.3.11 promises ("A start the server did not receive is reported again when the server is back").
- **startsSince-answer-shape** — the read answers `{ok: true, rows}` or `{ok: false, detail}`, never a null that
  means two things.
- **start-vocabulary-in-l0** (review 1911, F10) — `START_SOURCES`, `StartSource`, `StartRow` and `startSourceOf`, the
  rule that reads any other source word as `other`, live at the foot of `shared/api.ts`. The store's writer and its
  read both go through that one rule, so a word a newer build wrote reads `other` after a rollback. The generations
  lane, an L1 decider, reads them without the store.
- **claude-md-untouched** — `CLAUDE.md`'s box-token census sentence names only the `requireMailToken` sites of
  `coord/routes.ts`, and the sibling `checkMailToken` lanes (linking, the plan verbs, the Linear proxy) are not named
  there either, so the new lane adds no sentence.

## The hook's report, spool and resend (Task 3)

- **startpending-field** — the spool is one dot-free registry field, `$REG/<id>.startpending`, so `_reg_purge` and
  `_ws_slug_residue` take it with the row.
- **spool-header-carries-drop-and-backoff** — line 1 is `<not-before ms>\t<dropped count>`; each later line is
  `<tries>\t<report JSON>`, oldest first. No separate drop counter.
- **drop-count-has-no-reader-in-w1a** (review 1911, F8) — nothing in W1a reads the dropped count; the generations
  piece reads it. Until then a header-only field (`0\t<n>`) stands after a drop for the row's life and is rewritten on
  each SessionStart and UserPromptSubmit.
- **resend-folded-into-start-report** — the resend pass is part of `_hook_start_report`, with its helpers
  `_hook_start_send` and `_hook_start_keep`.
- **resend-on-start-and-prompt-only** — only SessionStart and UserPromptSubmit resend; tool events and Stop make no
  call.
- **fork-not-reported** — a `fork` start shares the pane's id under a new uuid, so its report could never be
  attributed; it is not sent.
- **start-report-before-the-exit** — the report runs before the hook's early exit for a compact start, so compact
  starts are reported too (coordinator ruling F2 of mail 18315).
- **one-budget-fresh-first** (review 1911, F2) — the whole event spends at most `START_BUDGET_MS` (4 s): one
  millisecond deadline from `_hook_epoch_ms` at entry, the fresh report sent first, then the resends, each send's
  `_hook_timeout` given what is left.
- **budget-floor-skips-not-stretches** (review 1911, F2) — the ruling's "1 s floor" is read as the least time a send
  may start with: no send starts with under a second left, and a send that starts gets exactly what is left, never
  more. So the event never runs past the budget; a report not sent for want of time is kept untried.
- **every-answered-send-counts-a-try** — a send the server answered without taking the report counts a try, the
  fresh send included, so "refused START_RESEND_TRIES times" holds for every report. Before this round only resends
  counted. No answer, and no time left, count none.
- **older-server-answers-count-a-try** (review 1911, F3, option (a)) — a 404 or a 401 from the door (an older server
  during a rollout that moved the fleet box first, or a token being rotated) is "no answer": the report is kept, a try
  is counted, and the pass ends. No new cap word.
- **fivexx-counts-a-try** (review 1911, F6) — a 5xx keeps the report, counts a try and ends the pass, so
  `START_RESEND_TRIES` bounds every kept report. This corrects the plan's Task 3 wording, which keeps a 5xx "with 0
  tries"; the plan's goal, "a bounded number of times", is what holds.
- **local-refusal-counts-a-try** — the client's own refusal (exit 2) keeps the report, counts a try and ends the pass,
  as a 5xx does.
- **backoff-by-how-the-pass-ended** (review 1911, F7, F12, F15) — the pass stamps `START_RESEND_BACKOFF_MS` (30 s) when
  a send ended it (no answer, a 404, a 401, a 5xx or a local refusal), a report spooled in this same pass included, and
  `START_STALE_BACKOFF_MS` (5 s, one supervisor tick) after a `stale-uuid` or a spent budget, so a `/clear` start lands
  on the first prompt after `_sync_uuid` has followed. A stamp further out than the long back-off (a wall clock that
  stepped back) is read as the long back-off. A pass that sent nothing (inside the back-off) leaves the stamp.
- **one-ccd-line-closes-the-purge-race** (review 1911, F1; replaces `no-ccd-edit`) — the plan built the piece with no
  `ccd/ccd` edit (R5). The coordinator lifted that for one line: `_reg_purge`'s trailing one-call `rm` takes
  `$REG/<id>.startpending` once more after `generation`, with `joined`, `joinedprev` and `deleg`, and its fallback
  names it. That is side (b) of the join record's two-sided rule; side (a) is the hook's re-check below. One call, so
  `ccd-workspaces.test.ts`'s unlink count stays 29.
- **purge-recheck-after-spool-write** (plan review 1896, R12) — after writing the spool the hook looks at `generation`
  again and removes the spool if the row is gone, side (a) of the same rule.
- **no-lock-on-the-spool** (review 1911, F11) — the spool is read, sent and rewritten without a lock. If a SessionStart
  and a UserPromptSubmit of one session ever overlap, the later writer can lose the earlier one's freshly kept report
  or count. A duplicate is harmless (the server dedups on `reportId`). A lock was kept out deliberately (the coordinator's
  ruling on F11): a lock there could hold one event behind another's whole 4 s pass.
- **growth-waiver-d-8557** (review 1911, F13) — the fixes put `ccd/session-hook.sh` at +51 net code lines against the
  merge-base, over the limit of 40. D-8557 waives it to 56 (`server/test/growth-waivers/D-8557-session-hook.json`),
  and the back-off decision has lines of its own again. This retires `back-off-test-joined-for-growth`, the join that
  held the earlier build at +40.
- **d-8557-in-both-plans** — the ruling named this piece's plan for D-8557's entry, but `growth-check`'s waiver test
  and `deviation-refs` read only top-level plans. The coordinator ruled (ask 373) that the full entry stays in this
  plan and a two-line entry, the one the guards read, goes in the index plan, `2026-11-10-overlord.md`, beside D-8251's,
  as D-8251 was done: the piece's entry is spelled `**D-8557, <slug>, scope**`, as D-8251's is, so the cross-tree
  collision scan reads only the index's as the definition. The guards are not widened.

## Open risk

- **clear-start-lands-on-next-prompt** — a `/clear` start meets `stale-uuid` until `_sync_uuid` moves the registry to
  the new uuid, about one supervisor tick (5 s) later. Its report is kept with a 5 s back-off and lands on the first
  prompt after that. The tail: dispatch types the `/clear` and then the brief, so a prompt can arrive inside that tick
  (the gap is not measured). That prompt finds the back-off standing and sends nothing; tool events never resend, so
  for a working worker the report waits for its next prompt, which can be its next mail, hours later. A prompt that
  arrives after the back-off but before the registry follows meets `stale-uuid` again and counts a try, and five such
  misses drop the report. The report is stamped `receivedAt` when the server takes it, and the generations plan ages a
  start from `receivedAt`, so a late landing shifts that generation's clock by the delay.
