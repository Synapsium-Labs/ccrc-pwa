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
- **Task 1.3.** Migration 100 by position (renumbered at the landing merge): the `approval_census` table, two
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
- **Censuses.** The census read joins `auth-gate.test.ts` (280 scanned routes), `box-token-census.test.ts`
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
  file still holds the hook's own bytes. A write lost to another event leaves `sent`, and that prompt is uncounted.
- `released-at-mint-not-path-2`: the request route answers a row minted released with a refusal
  (`approval-released`), so the envelope reads `request-refused:approval-released`. The census reads that as a minted
  row (path 3, counted from the row), never path 2.
- `deny-words`: an absent, unreadable or malformed stamp, or an unreadable managed deny file, is `deny-unreadable`;
  a well-formed stamp that is not the current digest is `deny-unknown`. PR 0's history arm changes this gate; its
  words and mine are reconciled at my landing merge.
- `forbidden-match-unrun`: a forbidden match that could not run reads as `forbidden` (fail closed); nothing is sent
  either way.
- `census-key`: an envelope's census row is keyed by the session and the envelope's own stamp (`updatedAt`), not by
  the summary: two identical prompts are two prompts. A menu with no envelope is keyed by its dialog and first
  sighting, so a server restart while that menu stands can count it twice.
- `census-thread-not-agent-id`: the envelope carries no agent id (PR 2's per-agent list will), so a census row keeps
  its thread (`main`, `subagent`, or none for a menu with no envelope) in place of the agent id.
- `envelope-erased-rule`: path 6 is a parsed menu whose first option is `Yes` and one of whose options begins `No`,
  with no envelope, and no approvals row for the child within the hook's longest wait before the sighting.
- `older-hook-not-counted`: an envelope with no route word, or one this build does not know, is not counted.
- `push-source-column`: the binding is a `pushSource` column on the outbox row, written by the unbound insert, since
  approval pushes are unbound. A held prompt's deferred push names its newest covered row.
- `deny-current-unmeasured-until-pr0`: PR 0's `denyCurrent` column is not on `main` yet, so the read counts deny
  currency as `unmeasured` until my landing merge reads the column (owed in that merge).
- `no-capability-word`: `approval-census-v1` is not added. Nothing would read it: the route word is additive, and an
  older server's missing route makes the card say "unmeasured". PR 0 dropped its word for the same reason.
- `command-words-as-written`: a path-qualified command name is kept as written (`/bin/cat`), which the gate does not
  count; a quoted command name leaves no list.
- `literal-options`: in `literalInRoot` an option word (a leading `-`) is a literal but no path; a path at a root
  counts as inside it (a read of the worktree itself).
- `characterization-runtime`: Task 1.1's file takes about 150 s, almost all of it the shared approvals fixture
  (about 6 s a case).
- `baseline-dates`: the card states the baseline rule; the Live dates of PR 0, PR P and PR 1 are owed to this note
  when each goes Live.
