# Capture every new Claude Code build, and trust a build only once its capture passes

## Goal

The operator's ruling SH-1 (2026-11-10): a Claude Code build counts as trusted only after the test box records its hook
and status-file output and the replay tests pass. Every new build is captured automatically, so it becomes trusted
within about a day. Today child approvals trust a fixed list of four builds, so every child on a newer build is refused
`version-unverified`.

## What was read first

- **The trusted list was code.** `APPROVAL_HOOK_VERSIONS` and `APPROVAL_CWD_TRUSTED` in `shared/api.ts` named 2.1.296
  and 2.1.300 to 2.1.302, from the 2026-10-18 rig record. `createQuestions`' `raiseApproval`
  (`server/src/coord/questions.ts`) refused every other build `version-unverified`, with a detail that gave no reason.
  Nothing else read the list.
- **No capture or replay machinery exists yet.** The tree has no recorded hook payloads or status files per build, and no
  replay suite over them. The session-host research (`docs/superpowers/specs/2026-11-09-session-host-research.md` §3,
  "Version skew is live now") asks for both. It also says a build without captures is unverified and its readers fail
  closed. The readers it means are the event-based readers that replace the pane parsers, and none of them exists yet.
  The live-status reader `liveStatusCoversDelegation` (`server/src/liveVerdicts.ts`) keeps its 2.1.277 floor here.
- **The test box connection** (D-7411, D-8166) reaches the box only through the fleet agent: the `testbox` op's status,
  the tools sync, and the `ccrc testbox-admin` verb's closed subs (`shared/testbox-admin.ts`). None of them runs a
  Claude Code build on the box, and none can be given a build to capture.
- **The newest-build signal** (D-8276) is measured from the running sessions: `fleetClaudeLatest` over each
  `FleetSession.version` (`shared/claudeVersion.ts`). The roll lane reads it on every pass. Spec §6.2's node file still
  has no writer.
- **The binary lifecycle spec** (`docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` §10) gates
  adoption on a canary. That gate proves a build starts and stays healthy. It does not prove the hook and status-file
  contract, which is what a capture proves, so the two records stay separate.

## Deviations found

- **D-8289 (2026-11-11)** — the trusted set of Claude Code builds is a coord.db record of capture verdicts, not a list in
  code; every build the fleet runs gets one capture row, queued for the test box; child approvals read the record and
  refuse an untrusted build with a typed reason; Settings › Automation › Test box lists the builds and their verdicts

## Design (the smallest one)

1. **The record.** Migration 60 adds `claude_builds` (slots 58 and 59 went first, to `practice_cases` and the plan
   model): one row per build. The columns are the build, its `source` (`rig` or `fleet`), its `capture` (`queued`,
   `pass` or `fail`), whether the capture proved a PermissionRequest's `cwd` follows the shell (`cwd`), when the row
   was first recorded, how many capture jobs were sent and when the last one went, when the verdict landed, and the
   replay output's tail. The migration seeds the four rig builds as `pass` with `cwd`, so they stay trusted as they
   were. The two constants are deleted. The writers are `CoordStore` methods over `coord/claudeBuildsStore.ts`.
2. **The decider** (`shared/claudeBuildTrust.ts`, L0) holds `buildTrustOf(records, version)`. It answers `trusted` with
   its `cwd`, or `untrusted` with one of five reasons: `unread` (no version), `record-unreadable`, `not-captured`,
   `capture-queued` or `capture-failed`. The same file holds the queue's two pure choices, `unrecordedBuilds` and
   `nextCaptureJob`, and the result's one reader, `readBuildCaptureResult`.
3. **Approvals read the record.** `ApprovalRaiseDeps.liveVersionOf` is unchanged. The ladder's step 10 now reads
   `coord.claudeBuilds()` through `buildTrustOf`, and its `cwd` replaces `APPROVAL_CWD_TRUSTED`. A refusal is still
   `version-unverified` (409). Its detail now names the reason, and its body carries `trust`, the reason word. Any future
   event reader asks the same decider and refuses the same way.
4. **The queue** (`server/src/buildCaptureLane.ts`, L4) runs once a minute from the watcher's tick, on that tick's
   sessions, beside the roll. Every well-formed build a session runs that has no row gets one (`source: fleet`,
   `queued`). This covers both a new build (D-8276's signal) and every build already live (the backfill). One job is
   out at a time, newest build first. A build whose last job got no verdict waits `BUILD_CAPTURE_RETRY_MS` (one hour)
   before it is sent again, so a new build is captured within an hour of the box being able to take it, well within a day.
   Only a job that actually went out is an attempt (`attempts`). A try the transport answers `no-test-box` or `no-runner`
   sent nothing: it stamps the retry clock (`lastAttemptAt`) and records why (`notSent`), and counts no attempt, so the
   card never says "sent 24 times" for a job that was never sent.
5. **The transport** is a port, `BuildCaptureTransport`. The job goes over the existing test box connection, and the
   answer is a verdict (read through `readBuildCaptureResult`) or `unavailable` with a reason. A verdict updates the row.
   A failure stays untrusted and raises one `coord` notice (push, opening Settings), keyed by build and attempt so a
   restart never repeats it. Tests use a fake transport, and no Claude Code runs anywhere in this work. The production
   adapter (`testboxCaptureTransport`) reads the test box lane's block. It answers `no-test-box` while no box answers,
   and `no-runner` otherwise, until the box-side runner lands (Open). So nothing becomes untrusted that is trusted
   today. `captureBlockedBy(records)` reads the queued build tried last: when it sent nothing, the console says no build
   can be captured yet and why, so the operator is not left waiting on a capture that cannot happen.
6. **The console.** Settings › Automation › Test box lists every build: its verdict in words, where the row came from,
   and for a failure, the replay output behind a disclosure and a **Capture again** control
   (`POST /api/testbox/builds/capture`, session-gated, the operator's act). The list is one column of short rows that
   wrap, so phone (390), laptop (1280) and wide (1920) share one layout. `GET /api/testbox/builds` is the read, also
   session-gated.

## Two PRs

`server/src/coord/questions.ts` is a W3-owned file, and `consolidation-path-guard.test.ts` refuses a diff that touches one
beside a `pwa/` path. So the work lands as two PRs: the server PR (this plan, the record, the queue, the routes, approvals
reading the record, the README) and, stacked on it, the PWA PR (`TestBoxBuilds`, its `api.ts` entries, the CSS and the
browser test). The PWA PR is rebased onto `main` once the server PR merges, so its own diff is `pwa/` alone.

## Tasks

- [x] T1. Plan (this file).
- [x] T2. Tests first, red: `claude-build-trust` (the decider, the queue's choices, the result reader), `claude-builds-store`
  (the migration, the seed, the writers), `build-capture-lane` (backfill, new build, one job at a time, retry spacing,
  pass, fail and its notice, unavailable), `testbox-builds-route` (the read and the operator's re-capture), and the
  approvals rows (an uncaptured build is refused with `trust`, a captured one passes, a `pass` without `cwd` gives the
  classifier no `cwd`).
- [x] T3. `shared/claudeBuildTrust.ts`, migration 60, `coord/claudeBuildsStore.ts` and its `CoordStore` methods,
  `buildCaptureLane.ts` with the port and the adapter, the watcher's call, the two routes, and approvals reading the record.
- [x] T4. PWA: `TestBoxBuilds.tsx`, its words and its jsdom test, mounted in the test box card, and
  `browser/testbox-builds.browser.test.ts`, which measures the list at 390, 1280 and 1920.
- [x] T5. Typechecks, the test-file typecheck, and the census and ratchet suites.

## Open

- **The box-side capture runner.** It is a `ccrc testbox-admin` sub (or a test service frame) that installs the build in
  a scratch home on the box, drives it to record its hook payloads, status file and statusline JSON, and runs the replay
  suite over them. It answers the JSON `readBuildCaptureResult` reads. Until it lands, every new build stays `queued`
  (`capture-queued`), and children on those builds are refused as before, now with that reason.
- **The replay suite** (one contract test per hook event and per build, over recorded fixtures) lands with the runner.
- **The live-status reader** and the pane parsers move onto `buildTrustOf` once live builds have passing captures.
  Moving them now would turn off D-5231's background-aware state on every live build at once.
