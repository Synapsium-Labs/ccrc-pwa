# W1a start report: departures found while building it

A note for the programme's ledger pull request, written by the worker of run 1886 (#2740). It adds to
`docs/superpowers/plans/2026-11-10-overlord/w1a-start-report.md`, as that plan's Global Constraints direct. Each entry is
a slug and its reason. The one number this piece was issued, D-8557, has one definition, the index plan's
(`2026-11-10-overlord.md`); this piece's plan carries the full entry under a spelling that is not a definition.

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
  `session_id` on a resend of a `clear`, `resume` or `compact` report, so a report spooled before a `/clear` lands once
  the registry follows, as spec §3.3.11 promises ("A start the server did not receive is reported again when the server
  is back"). `startedUuid` is data the server cannot check against the sender.
- **startup-keeps-its-own-sender** (review 1949, G2) — a `startup` report is resent with its own `fromUuid`, never
  rewritten. Another Claude process that inherits this pane (a nested `claude -p` from the session's own shell) runs
  this hook under the row's id; its `startup` meets `stale-uuid`, is kept, and is then refused on every resend and
  dropped, so a nested `startup` is never recorded as the row's own start. Only a source that changes the row's own
  conversation (`clear`, `resume`, `compact`) is rewritten, so a nested process's `clear`, `resume` or `compact` (a
  `claude -p --resume`, say) is rewritten like the row's own and can still land as the row's, with its own uuid as
  `startedUuid` (review 1975, H2; a case pins a nested `resume`). The generations piece must check `startedUuid`
  against the registry's history (the coordinator's carry).
  The cost, accepted as part of G2 (review 1975, H1): the row's own `startup` kept through an outage and then a
  `/clear` is lost. Its `fromUuid` is the uuid the registry named at startup; once `/clear` moves the registry on, the
  door no longer names that sender, so the report meets `stale-uuid` on every pass and is dropped after
  `START_RESEND_TRIES`, counted. The generations piece knows a session's first generation can lack its `startup` row.
- **startsSince-answer-shape** — the read answers `{ok: true, rows}` or `{ok: false, detail}`, never a null that
  means two things.
- **id-order-is-receipt-order** (review 1949, G3) — id order is receipt order; a session's start order is
  `reportedAt`. The hook sends the fresh report first and the kept ones after it, so a start kept and resent can land
  after a newer one. `StartRow` says so; the generations piece orders a session's starts by `reportedAt` (the
  coordinator's carry). No schema change.
- **start-vocabulary-in-l0** (reviews 1911 F10, 1949 G8) — `START_SOURCES` (derived from one map), `StartSource`, its
  guard `isStartSource`, `StartRow` and `startSourceOf`, the rule that reads any other source word as `other`, live in
  `shared/continuity.ts` beside the generation vocabulary. The store's writer and its read both go through that one
  rule, so a word a newer build wrote reads `other` after a rollback. The generations lane, an L1 decider, reads them
  without the store.
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
- **one-budget-fresh-first** (reviews 1911 F2, 1949 G4) — the report spends at most `START_BUDGET_MS` (4 s): one
  millisecond deadline from `_hook_epoch_ms` at its entry, the fresh report sent first, then the resends, each send's
  `_hook_timeout` given what is left. The budget is the report's, not the event's: on a `clear`, `compact` or `resume`
  SessionStart the roster card's own bound comes before it.
- **budget-floor-skips-not-stretches** (review 1911, F2) — the ruling's "1 s floor" is read as the least time a send
  may start with: no send starts with under a second left, and a send that starts gets exactly what is left, never
  more. So the report never runs past its budget (the budget is the report's, as `one-budget-fresh-first` says); a
  report not sent for want of time is kept untried.
- **every-answered-send-counts-a-try** — a send the server answered without taking the report counts a try, the
  fresh send included, so "refused START_RESEND_TRIES times" holds for every report. Before this round only resends
  counted. No answer, and no time left, count none.
- **stale-uuid-ends-the-pass** (review 1949, G5; narrowed by review 1975, H1) — a `stale-uuid` on a send that
  carried this event's `session_id` (the fresh report, or a rewritten `clear`, `resume` or `compact` report) ends the
  pass with the short back-off, so one stale answer spends one try, not one per kept report sent after it. A kept
  `startup`, which keeps its own sender, counts its try on `stale-uuid` and the pass goes on, so a stale `startup` at
  the head of the spool never holds back the reports behind it. A case pins each half: one stale answer on the fresh
  send, and a nested `startup` ahead of a `clear` that lands on the same pass.
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
  `START_STALE_BACKOFF_MS` (5 s, one supervisor tick) after a `stale-uuid` that ended the pass (review 1975, H1: a kept
  `startup`'s stamps nothing) or a spent budget, so a `/clear` start lands
  on the first prompt after `_sync_uuid` has followed. Each stamp counts from the end of the pass, not its start
  (review 1949, G7). A fresh report taken clears a standing stamp, so the kept reports go on the next event (G7). A
  stamp further out than the long back-off (a wall clock that stepped back) is read as the long back-off. A pass that
  sent nothing (inside the back-off) leaves the stamp.
- **empty-session-id-skips-the-resend** (review 1949, G6) — a payload whose `session_id` is empty after the hook's
  filter skips the resend pass and keeps every report, rather than sending an empty sender the door refuses for good.
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
- **growth-waiver-d-8557** (reviews 1911 F13, 1949, 1975) — the fixes put `ccd/session-hook.sh` at +55 net code lines
  against the merge-base (2865 to 2920, against `ef91420ff`), over the limit of 40. D-8557 waives it to 56 (`server/test/growth-waivers/D-8557-session-hook.json`),
  and the back-off decision has lines of its own again. This retires `back-off-test-joined-for-growth`, the join that
  held the earlier build at +40.
- **d-8557-defined-once** (reviews 1911, 1949 G10) — D-8557 has one definition, the index plan's two-line entry
  (`2026-11-10-overlord.md`, beside D-8251's), which `growth-check`'s waiver test reads (it lists top-level plans only).
  This piece's plan keeps the full entry, spelled `**D-8557, <slug>, scope**` as D-8251's is. That comma spelling, not
  the file's path, is what keeps it from counting as a second definition: `deviation-refs`' cross-tree scan reads every
  plan, subdirectories included, and its definition grammar does not match that spelling (ask 373). The guards are not
  widened. The index entry rides a merge commit of this branch, so a redone merge must keep it.

## Open risk

- **clear-start-lands-on-next-prompt** — a `/clear` start meets `stale-uuid` until `_sync_uuid` moves the registry to
  the new uuid, about one supervisor tick (5 s) later. Its report is kept with a 5 s back-off and lands on the first
  prompt after that. The tail: dispatch types the `/clear` and then the brief, so a prompt can arrive inside that tick
  (the gap is not measured). That prompt finds the back-off standing and sends nothing; tool events never resend, so
  for a working worker the report waits for its next prompt, which can be its next mail, hours later. A prompt that
  arrives after the back-off but before the registry follows meets `stale-uuid` again, counts a try and ends the pass;
  the fresh send's miss is the first of the five tries, so four more such prompts drop the report. The report is stamped `receivedAt` when the server takes it, and the generations plan ages a
  start from `receivedAt`, so a late landing shifts that generation's clock by the delay.
