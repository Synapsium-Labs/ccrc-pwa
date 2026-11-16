# Architecture rulings of 2026-11-06

The architecture audit left twelve decisions open. The operator ruled all twelve on 2026-11-06. This file is the record
of those rulings, and the two specs now say what was ruled. It holds no plan of work: the code each ruling asks for
lands in other PRs, and nothing here claims that code has landed. Each "Today" line was read against `origin/main` at
`5dd21cdb2`.

**Specs amended:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2.3) and
`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`.

## Deviations found

- **D-8066 (2026-11-06)** — The operator's twelve architecture rulings, recorded below, each with its reason. Every
  ruling is settled: reopening one needs a new operator ruling, not a PR.

## The rulings

### 1. The runs board's memory of which runs had a child

**Ruled:** the server says a run had a child. A new field on finished runs replaces the browser's memory
(`childRunsSeen`).

**Why:** the fact belongs to the server, and there it survives a reload. The recommendation was to keep the memory, and
the operator ruled against it, accepting a medium change across the server, the shared types and the PWA.

**Today:** `childRunsSeen` still exists in `pwa/src/fleet/runWords.ts`, with one caller, `useColdRuns`. No such field
exists: `RunSummary.childIds` holds open runs only.

**Spec:** the agreed exit stands as delete. K10 and ARCH-61's row say how the memory goes. This replaces D-7214's "stays
as a named reader".

### 2. Workspace retire acts and the fleet-wide coordination lock

**Ruled:** stay queue-only, correct the spec, and ticket a late store read.

**Why:** the lock is the one every coordination write shares, and it stays free. A retire act awaits ccd's audit and
verb, so holding that lock would stop every write behind it. Workspace holds already close the main case. The late
store read narrows the cases they miss: a run naming the session as coordinator, a review, and an adopted spawn that
writes before its hold.

**Today:** all four call sites (three in `server/src/watch.ts`, the close route's in `server/src/coord/routes.ts`) go
through `retireExecutor`, which is `queue.run` on the session's own key. `child-spent` and `archive-expired` read the
run store in their decide steps, before the audit. `temp-orphan` re-checks its open-run hold after the audit (`hold` and
`holdLast`).

**Spec:** C4's writers, K1's executor sentence and K1's verdict now say queue-only, and why. The sleep act's sentence
stays, because it does run on the serialiser (`server/src/sleepLane.ts`).

**Follow-up, not landed:** a test-first PR moves the store check as close to the command as it can go for those two
acts. It narrows the window without closing it: the child read is asynchronous, so a wait remains, and a dispatch
mid-way inside the lock would still be missed.

### 3. A file claim whose holder is restarting

**Ruled:** doubt means keep. A restarting holder and a holder whose pane tmux did not answer keep renewing, up to the
8-hour cap. This rules D-6908.

**Why:** it matches the code's stated rule that a fleet hiccup must not mass-expire claims. Asleep and dead holders stay
`gone`, with a pinned test row for the sleeper.

**Today:** both cases read `gone` (`claimProbe` in `server/src/watch.ts`), so they stop renewing and the claim lapses at
the end of its 45-minute lease. The rows are pinned in `server/test/session-ladders-characterization.test.ts`.

**Spec:** K3 records it.

**Follow-up, not landed:** one small behaviour commit with before and after rows. #783 closed with this item open, so
that commit carries it.

### 4. What "one registry listing per tick" means

**Ruled:** selection listings only, and the limits listing folds in.

**Why:** the goal is about the listing that chooses which rows a lane works on. Limits is the only listing with no
safety reason, it runs on every listed tick, and in remote mode each listing is a round trip to the fleet agent.

**Today:** selection listings are 1, held by `server/test/fleet-listing-characterization.test.ts`. With every timer due,
a tick lists 4 times: tick, limits, divergences and mail. The mail lane's listing is the last switch read before it
delivers (D-5864), so it stays.

**Spec:** K13's goal, its Deleted list, ARCH-51's row and W1b's exit say selection listings, and mail keeps its
re-listing.

**Follow-up, not landed:** limits reuses the tick's names. Request-time callers keep listing for themselves. An ordinary
2-second tick then drops from 2 listings to 1, and about 67 a minute to about 37. Those figures are inferred from the
timers, not measured.

### 5. A sleeping session whose sleep marker cannot be read

**Ruled:** read it as asleep, using the stop stamp's time. This applies when the listing shows the marker, the marker
gives no time, and a stop stamp is readable.

**Why:** the server then agrees with ccd. A wrong "asleep" costs one budgeted wake, and a wrong "dead" can cost a
reclaimed run.

**Today:** `parseHibernated`'s answer reaches the row as no marker (`buildRecord` in `server/src/registry.ts`), and a
test pins that.

**Spec:** no line names this, so none changes.

**Follow-up, not landed:** a few lines in `buildRecord`, not the parser. The stop stamp is in seconds, so it is
multiplied by 1000. One test row flips, and one is added for a failed read.

### 6. The new-release push and the one notice sender

**Ruled:** send it through `notifyPushOnly`.

**Why:** a release has no session, which was the reason for the exception (D-3296), and the helper respects that. The
operator sees no difference: the same push, no feed row, once per release.

**Today:** `pushRelease` calls `sender.notify` directly in `server/src/watch.ts`.

**Spec:** stays as written. K6 already lists that call as deleted.

**Follow-up, not landed:** about three lines in `watch.ts`, plus the test's allowance and the comments.

### 7. Four places in bash that find a transcript file

**Ruled:** accept them as different and amend the spec. No code changes.

**Why:** each has its own job. `_ci_addrs` skips the slow scan because it runs on the tick. The doctor cannot call ccd's
functions. `_transcript_matches` is a shared building block, not a copy. `_transcript_path` answers for records that
outlive the session.

**Today:** the four are `_transcript_path`, `_ci_addrs`, `_transcript_matches` and the doctor's own copy in
`ccd/ccrc-doctor-checks`. Only a comment ties `_ci_addrs` to `_transcript_path`, and a keyword search found no test
that does.

**Spec:** K9 says why each of the four exists, and drops `_transcript_matches` from its Deleted list. A parity test was offered as
optional, and is not part of this ruling.

### 8. Raw clock calls in ccd

**Ruled:** narrow the target to the steady tick. No code sweep, and this item closes.

**Why:** the helper exists to save a process start on the hot loop, and that work is done. The time returned is the same
either way.

**Today:** the wording below is true. `cmd_supervise`'s steady tick reads through `_now_s_to` (`t0`, `spent`, `hb`), and
its `unknown` arm is a fault path. `ccd/ccd` has 50 code lines with a raw `date +%s`. `_compact_note`'s read sits on
the tick and repeats on every declining tick, so "elsewhere" covers it, not "rare branches". Changing that read is
optional and was not ruled.

**Spec:** the clock row now reads: the supervise loop's steady-tick timing reads use `_now_s`, and raw `date +%s` is
allowed elsewhere, including rare branches of tick helpers.

### 9. Old `dead` checks on the server

**Ruled:** move two, record the rest. `claimProbe` and the delegation card's word move to the new reading. The other
five checks and the four leftovers are accepted. A count that covers shared code too stops new ones.

**Why:** only those two get doubt wrong. `claimProbe`'s own comment says doubt is held, yet a tmux failure reads `gone`,
and the card can say `stale` when the truth is unmeasured.

**The five checks, accepted:**

1. `hibernateSleepInput`'s `paneDead` (`server/src/coord/hibernate.ts`).
2. The tick's `projects` set for the push copy rule (`server/src/watch.ts`).
3. `noteSessions`' `alive` set (`server/src/watch.ts`).
4. `noteSessions`' dead-row loop (`server/src/watch.ts`).
5. `ownersOf`'s skip of a dead row (`server/src/watch.ts`).

Two carry a caveat. `delegationCircuitBreaker`'s comment says a supervisor mid-restart is not dead, yet `noteSessions`
feeds those rows to it; the comment is what needs correcting. `ownersOf` was not traced far enough to confirm it errs
safely.

**The four leftovers, accepted** (the spec listed each as deleted):

1. `turnverdict.ts`'s one-row `assembleFleet` (`liveRowWithHookFor`, behind `liveRowFor`). The row does take its reading
   from `readSession`.
2. `sessionCommands`' pane read in `server/src/commands.ts` (`hasSession`, `panePid`).
3. `liveVersionOf`'s pane read in `server/src/coord/routes.ts` (`panePid`, `readLiveStateMeasured`).
4. The busy-to-idle edge, in `tick()` in `server/src/watch.ts`. It is gated on `finishedEvidence` (D-5233), and
   `finished.ts`, where the spec placed it, does not exist.

**Today:** the seven server checks are those five plus `claimProbe` and `delegation-projection.ts`. The ruling's card
named one more read in shared code. Measured, `shared/api.ts` has three code lines: two in `sessionBucket` and one in
`inArchivedFold`. They sit outside `server/src`, so a count must cover `shared/` to see them.

**Spec:** K3 and K4 record the accepted items.

**Follow-up, not landed:** one small ticket and one count. The delegation card needs a word for a sleeping parent.

### 10. The single fleet read model that was never built

**Ruled:** ticket a narrowed version: a named options object for `assembleFleet`, and a separate output for pane ids.

**Why:** the speed goal is met, so what remains is shape, and it grows with each new input. A named object ends the
`undefined` padding.

**Today:** `FleetReadModel` is a registry read plus switches (`server/src/fleetReadModel.ts`). `assembleFleet` takes 18
positional parameters, 13 of them optional, at 6 call sites.

**Spec:** K13 says the narrowed shape.

**Follow-up, not landed:** 6 call sites, 117 test calls in 14 files, and a safety test to rewrite. One coordinator route
must keep assembling on request, and the other probably should (inferred). Keeping the first five arguments positional
leaves 52 short calls alone.

### 11. Python that reads transcripts inside ccd

**Ruled:** keep it in Python, record it and count it. `_operator_choice_read` stays as a recorded exception.
`_sanitize_anthropic` stays as a writer. Reopen only on a real fault or if Python leaves ccd.

**Why:** the spec's transcript section never named this reader, and zero Python readers is out of reach either way,
because `ccd/ccd-usage-sweep.py` also reads transcripts and stays. This is the operator's explicit exception to
finishing the refactor fully.

**Today:** `_operator_choice_read` is one Python reader with four call sites. `_sanitize_anthropic` rewrites carried
transcripts. Nothing counts Python readers.

**Spec:** K9 records both.

**Follow-up, not landed:** a count naming the allowed Python readers. It drops the limit-banner reader
(`_transcript_limit_banner`) when that port lands.

### 12. Keeping coordinator routes in one file

**Ruled:** re-affirmed as of 2026-11-06, on new grounds. Moving existing routes out of `coord/routes.ts` stays rejected.
A new group of routes may have its own file if it uses the shared gate and joins the test that checks route gates.

**Why:** this writes down what the code already does, so nobody re-argues it. The old ground no longer describes the
code, because the gate is a shared function, and D-36 and D-39 happened at each call site. The ground now is the cost of
the move. Moving a route also takes it out of what `coord-pause-route.test.ts` reads, which is `coord/routes.ts` alone.
The operator's 2026-10-26 confirmation covered other rejections, so this one carries its own date.

**Today:** the file has 4,486 lines and 62 routes. The gate is `checkMailToken` (`server/src/coord/token.ts`), reached
through `requireMailToken` or called directly. `coord/ledgersRoutes.ts` and `linear/proxyRoutes.ts` already use it from
their own files, and `box-token-census.test.ts` reads each as a lane source.

**Spec:** the 08-10 Rejected entry is dated and rewritten. The three consolidation-wave lines that said "its one auth
gate" now name the shared gate.

## Known limits

- The "Today" lines were read, not run. The test counts are from reading the tests.
- Decision 9's list of the four leftovers comes from the audit behind the ruling, because the ruling's text gives only
  the number. Each was re-read in today's tree.
- The figures quoted from the ruling and marked inferred (decisions 4 and 10) were not re-measured. Decision 10's 117
  test calls and 52 short calls are the ruling's own.
- `docs/superpowers/plans/2026-10-25-arch-48-presence-dead-since.md` and
  `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` still read as written. They are snapshots: D-6908's "until
  it is ruled" and D-7214's "stays" are answered here.
