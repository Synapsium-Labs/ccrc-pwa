# Approvals PR 1, the approval census and M38: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main` since #3036), §3.1, §7 and Tasks 1.1 to 1.5.
Departures are listed by slug. The coordinator mints the numbers.

## What shipped

- **Task 1.1.** `server/test/approval-paths-characterization.test.ts` pins Table 2a's paths as they stood, green on `main`
  before any change and committed first: the hook's silent gates (no print, no request), the mint refusals, the
  released-at-mint reasons, the lapse with its deferred push, and the approval hold's main-thread filter.
- **Task 1.2.** The hook's pre-send approval gates run in `_hook_approval_gate`, before the hookstate write, so the
  approval envelope carries `ask.approval.route`: `sent` or the first gate's skip word. After the request, a refusal
  is patched to `request-refused:<word>` (`http-<code>` when the answer has no kebab word) and a lost answer to
  `request-failed`. The vocabulary is `shared/approval-census.ts`, and `session-hook-approval-route.test.ts` holds the
  hook's words equal to it. `hookstate.ts` carries the word and the hook's `waitBy`.
- **Task 1.3.** Migration 103 by position (quiz PR 2 took 100, forecasts B 101, approvals PR 0 102; door A1 and the Linear
  follow-up take 103 and 104 before this lands, so it renumbers once more at its landing merge): the `approval_census` table, two
  approvals columns kept from mint (`commandWords`, `literalInRoot`) and `push_outbox.pushSource`. The one writer is
  `approvalCensusStore.ts#insertCensusRow`, reached only through the questions owner's `observeCensus`, which the
  watcher calls on every tick a dialog is painted. Its retention is the approvals' (the summary is cleared, the row
  kept).
- **Task 1.4.** `approvalguard.ts` gains `approvalCommandWords` and `literalInRoot` (L1), computed at mint beside the
  class. `approvalCensus.ts` (L1) decides each sighting, each minted row's path and authority, PR 6's read-prompt
  count and the read's answer. The census read is a session-gated GET on its own route file, registered from
  `server.ts`; it answers counts and redacted rows, never an input. Approval pushes carry their source on their
  outbox row: `approval:<row>` or `census:<row>`.
- **Task 1.5.** The M38 card, `pwa/src/fleet/ApprovalCensusSection.tsx`, in Settings › Security after the approvals
  line. A failed read says "unmeasured", never 0.
- **Censuses.** The census read joins `auth-gate.test.ts` (282 scanned routes after the quiz record), `box-token-census.test.ts`
  (`APPROVAL_CENSUS_DOORS`), CLAUDE.md's census sentence, `rings/fastify-l4.data.ts`; the table joins
  `writers-map.test.ts` and the store file joins `core-vocab.test.ts`'s handle holders.
- **Mutations.** Sixteen hand mutations over the hook (a gate's word dropped, the patch's same-bytes guard removed,
  the write dropping the route), the reader, the sighting decider (a released request counted, a recent row
  ignored), the dedupe key (the unique index made plain), the read (an uncut input), the gate (a `literalInRoot`
  false row counted, a released row counted), `literalInRoot` (a glob or a variable admitted, a path outside the
  roots admitted), the push source, the mint's facts, the door's day bound and the writer: all sixteen killed, every
  file restored from its saved copy and checked by hash.

## Departures

- `m38-card-in-settings-until-week`: the PWA has no Week page and no M1 card yet (W3 step one). By the coordinator's
  ruling on ask 586, the card is one component mounted in Settings › Security beside the approvals line. **Carry for
  the plan:** W3's Week page moves it beside M1.
- `gate-before-write`: the hook's pre-send gates moved from the wait (after the hookstate write) to just before the
  write, unchanged in order and effect, so the envelope can carry the word. The cost: on a child's PermissionRequest
  the gate's forks (the deny digest, the forbidden match, the canonical form and its digest, the nonce) run before
  the `waiting` write. Every other session pays one file test.
- `route-patch-after-request`: what only the request can tell is patched by a second hook write, made only when the
  file still holds the hook's own bytes. A write lost to another event leaves `sent`; with no minted row that prompt is
  `unmeasured` (`sent-no-row`), not uncounted. An event writing inside the one-jq-fork window between the patch's
  compare and its `mv` is overwritten, as any two hook writes race (the hookstate write takes no lock; review 2638 F11a,
  the comment now says so).
- `released-at-mint-not-path-2`: the request route answers a row minted released with a refusal
  (`approval-released`), so the envelope reads `request-refused:approval-released`. The census reads that as a minted
  row (path 3, counted from the row), never path 2.
- `deny-words` (reconciled with approvals PR 0, #3045): an absent, unreadable or malformed stamp, or an unreadable
  managed deny file, is `deny-unreadable`; a well-formed stamp that is not the current digest goes on when the
  installer's digest history names it (PR 0's arm, now in the gate: the request carries `denyDigest`, the server mints
  the row `denyCurrent: false`, and the hook and the rule door refuse its allow, `deny-not-current`), and is
  `deny-unknown` when no history names it. PR 0's `_apr_deny_history` moved above the gate with it.
- `forbidden-match-unrun`: a forbidden match that could not run reads as `forbidden` (fail closed); nothing is sent
  either way.
- `census-key` (review 2667 F-C): an envelope's census row is keyed by the session and the envelope's own stamp
  (`updatedAt`). A sighting is decided ONCE (review 2638 F1, F2): a restamp of the same envelope (same tool and summary)
  under the same menu is the same prompt, and new envelope content under the same menu labels starts a new sighting. A
  menu with no envelope is keyed by its dialog id and the FIRST hook-state stamp its sighting saw (`none` with no hook
  state), never by the sighting's time, so a restart, a repaint with the same labels and a one-tick flicker of one
  prompt land on one row, and a new prompt (a new hook state) on a second. A `sent` or failed request finds its own row
  across the hook's whole wait while that row is open (held or released), so a sighting that starts late finds it too.
- `census-thread-not-agent-id`: the envelope carries no agent id (PR 2's per-agent list will), so a census row keeps
  its thread (`main`, `subagent`, or none for a menu with no envelope) in place of the agent id.
- `envelope-erased-rule` (revised by the rulings on reviews 2638 F1, F2, F5 and 2667 F-A, F-B, F-E): path 6 is a
  parsed menu whose first option is `Yes` and one of whose options begins `No`, with a hook state but no envelope on
  ANY tick of its sighting, decided only when the sighting ENDS (its menu clears or is replaced), from the rows minted
  since its first sighting, so a late envelope or a late mint lands on the one decision. Once the sighting saw an
  envelope, the envelope decides, whatever later ticks hold. A TIGHT match (a row held or released, `askAt` within
  `CENSUS_MATCH_MS` of the first sighting, any thread: the hook state's thread describes the event that erased the
  envelope) is that row's prompt; any other row of the child within the hook's longest wait is `unmeasured`
  (`near-miss`). A menu that stood no longer than the watcher's settle window (`ASK_SETTLE_TICKS`) is `unmeasured`
  (`cleared-early`), and one with no hook state on any tick is `unmeasured` (`hookstate-gone`), never path 6.
- `unmeasured-counted` (replaces `older-hook-not-counted`; rulings on F3, F5 and F6): every prompt the census cannot
  place is one `unmeasured` row with its `why` (a census row's new `why` column; `unknown-state` for a minted row), and
  the read counts them on their own (`unmeasured`, `byUnmeasured`), never in `reachedOperator` or M38: an envelope with
  no route word (`no-route`, an older hook), a route word this build does not know (`unknown-route`), a `sent` request
  with no minted row within `CENSUS_ROW_WAIT_MS` (`sent-no-row`), a minted row's unknown state (`unknown-state`), and
  the three above.
- `minted-row-matched-not-timed` (F7, F9b; review 2667 F-F): a `sent` or failed request's own minted row is found by
  its thread on the server's clock, never against the fleet box's `updatedAt` (see `census-key`). A `request-failed`
  with such a row counts as that row, never path 2 as well; any other refusal returns before the insert, so it is
  path 2 with no row match.
- `operator-first-label` (review 2667 F-G): an `operator` row is written on any close of the painted dialog, so the card
  labels `operator-first` "Answered or cleared at the pane before the coordinator". **Carry:** a separate
  `pane-cleared` principal, folded into the ledger PR.
- `table-2a-state-mapping` (ruling on F3): `allowed`/`denied` are ruled (0); `held` is held; a row minted released is
  path 3; `declined` (the claimant handed it over) and `stale` (the hook's ceiling passed with no principal) are their
  own words and reach the operator; `operator` answered inside the claimant's window (`ruledAt < notifyAt`) is
  `operator-first`; a lapse (released at `notifyAt`, or answered by the operator after it) is `escalate` (5) or
  `lapsed` (4) by class; any other state is `unmeasured`.
- `m38-programme-days-from-runs` (ruling on F4; review 2667 F-D, F-H): M38's denominator is the distinct (programme,
  UTC day) pairs on which the programme had a run open, read from the runs, prompt or none, so a day prevention emptied
  still counts; a run's end is exclusive, so one closed at 00:00 UTC does not count the next day. The read's window is
  the last N whole UTC days, today's included (`censusWindow`), so N days are N programme-days for a programme open
  throughout. Its numerator is a programme's prompts that reached the operator. Prompts with no programme (root
  sessions, and children no run names) are reported beside it (`rootReached`, "Prompts with no programme"), never
  inside it, and the headline never says "None" while any of them reached the operator. The card states the rule.
- `summary-cut-before-mask` (F8): the hook cuts the summary at 200 characters before the server can mask it, so a cut
  summary drops its trailing word (which may be the front of a secret) before it is masked and stored.
- `command-words-retention` (F11b): the approvals' daily retention clears a row's `commandWords` with its input.
- `card-deny-currency-note` (F11c): while any counted row's deny currency is unmeasured, the card says the read-prompt
  count treats every row as current.
- `push-source-column`: the binding is a `pushSource` column on the outbox row, written by the unbound insert, since
  approval pushes are unbound. A held prompt's deferred push names its newest covered row, and the "with coordinator"
  replacement push for a held prompt carries the sighting's source too (review 2638 F9a).
- `deny-current-from-pr0` (replaces `deny-current-unmeasured-until-pr0`): the read takes PR 0's `approvals.denyCurrent`
  column (`current` or `not-current`; a row minted before PR 0 reads current, the column's default), and a
  `deny-not-current` row is never a read prompt. The card's deny-currency note shows only while a counted row says
  `unmeasured`.
- `no-capability-word`: `approval-census-v1` is not added. Nothing would read it: the route word is additive, and an
  older server's missing route makes the card say "unmeasured". PR 0 dropped its word for the same reason.
- `command-words-as-written`: a path-qualified command name is kept as written (`/bin/cat`), which the gate does not
  count; a quoted command name leaves no list.
- `literal-options`: in `literalInRoot` an option word (a leading `-`) is a literal but no path; a path at a root
  counts as inside it (a read of the worktree itself).
- `path-guard-w3-releases-hook`: consolidation W3's path guard reds a diff that touches a W3-owned file beside the
  approval signing path. This plan edits the session hook (Task 1.2) beside the questions owner (Task 1.3) by design,
  and W3 has landed (Q3a to Q3g, the last of them Q3f, #1745), so the guard's signing arm drops the session hook as
  its `pwa/` arm was dropped once W7 landed. The verifier and the signer stay on it, and the guard's CONTROL case
  still reds a W3-owned file beside each of them.
- `census-read-masked-by-hook`: the census read is on the answer hook's masked list (`MASKED_GET_ROUTES`), not
  exempt. Its rows carry each prompt's summary, the command text a session wrote, so the secret-masking suite's rule
  puts it on the masked side, though every summary was already masked and redacted at write.
- `run-close-drops-census`: the run-close switch suite's migration case drops every table and column added after
  version 53 by hand before it reopens; it now drops the census table and the two approvals columns too. The
  neighbouring migrations are not idempotent either: this suite's hand drops are their pattern.
- `census-read-through-questions`: the census read reaches the store through the questions owner
  (`questions.ts#censusSources`), not directly, because that owner holds the approvals and census rows (C31) and W3's
  question census keeps every question-table read in that file. `approvalRowsForCensus` joins W3's closed method list
  and `approvalPushSources` its not-a-question list.
- `hook-gate-compacted`: the gate's checks are folded so the hook grows by at most 40 net code lines (the growth
  check's limit), with no waiver: one jq request body with the truncation as a branch, and paired checks that share a
  word on one line.
- `literal-in-root-carry-for-pr6` (F10, carry): `literalInRoot` is looser than its name: an option's attached argument
  (`wc --files0-from=/etc/list`, `ls -I/etc`) stands as an option, and a command with no path operand is true even with
  no trusted cwd. PR 6 must not take it alone as the read rule; its closed option tables and the mutation "admit an
  attached option argument" are the plan's. The read-prompt count here is inflated by these shapes, by a small amount.
- `characterization-runtime`: Task 1.1's file takes about 150 s, almost all of it the shared approvals fixture
  (about 6 s a case).
- `baseline-dates`: the card states the baseline rule; the Live dates of PR 0, PR P and PR 1 are owed to this note
  when each goes Live.
