# Mail inbox and clean client output — Implementation Plan

> **For agentic workers:** eleven PRs, Tasks MI-1 to MI-11, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (**Routing** line). Band 1 is mechanical and may go to `handoff-run`. Band 2 is spec-able and may go to `handoff-run` when the weekly pace says so, with the orchestrator reviewing the diff. Band 3 is written and reviewed natively and never handed off. Workers do not edit §Deviations found.

**Spec:** `docs/superpowers/specs/2026-10-24-mail-inbox-design.md` (rev 2).

**Deviation:** D-6772, issued by the ledger for this work. The eleven further decisions are `D-TBD-api-status-optin` to `D-TBD-inbox-cards` (eleven, in task order, MI-11 last), one contiguous block the ledger issues for this plan, defined in §Deviations found in the same commit that substitutes them.

**Base:** `origin/main` `10813b401`. Anchors are `≈:` hints into that commit, and each names its function. Re-ground every anchor in Step 0.

**Deploy class.** MI-1, MI-2, MI-7, MI-8 and MI-9 are FLEET (`ccd/` files and skills, installed by `ccrc update`'s spine, agent lane first). MI-3 to MI-6, MI-10 and MI-11 are SERVER (the PWA ships with the server). No task restarts a session, and each takes effect at the next ordinary release.

## Gates

- **The ledger block (this PR, before merge).** The eleven `D-TBD-<slug>` entries in §Deviations found take one contiguous block from `ccrc-api ledger allocate`, substituted in this PR. `server/test/dtbd.test.ts` is red until then; this Gate is deleted in the same commit.
- **Wave 3 waits for wave 2 on the server.** MI-7 and MI-9 teach a route the server must already serve. Release them only once the server box runs MI-6's release (`ccrc update --check` on the server, or `GET /api/updates`).
- **Wave 4 waits for wave 3 on the fleet and on the server.** MI-10 sets `MAIL_INBOX_SINCE` to the release tag MI-7 merged into. That tag is known only after MI-7's merge cuts its prerelease. MI-10 also waits until the server box serves MI-11's PWA, so mail read through `mail inbox` shows as cards from the first nudge that names it (spec §3.8).
- **Open PRs.** Measure them in Step 0 of each task (`gh pr list --state open --json number,files`). The files this plan edits that other work also edits often are `ccd/session-hook.sh`, `ccd/ccrc`, `server/src/watch.ts`, `server/src/coord/routes.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts` and `shared/api.ts`. Rebase past any open PR that holds them, and take the next free migration number in MI-4 if one lands first.

## Global constraints

- **Public repo.** Fixtures use neutral names (`project-a`, `lane-a`, `demo-ws`). Never write a host, an account or lane name, another project's name, an absolute home path or a private tracker id.
- **SAFETY.** FIXTURE HOMEs only (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). No test runs the client or a hook against a live `$HOME` or a live server. Nobody touches tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` out of band. No test prints the box token.
- **The closed client stays closed.** No URL, host, path or raw argument (`ccrc-api-closed.test.ts`). Every new request goes through `ROUTES` and the one curl call.
- **Exit codes do not change** (spec §3.1, Q1). 0 = an answer, 2 = local refusal, 3 = no response.
- **One writer.** `mail_deliveries` is written only through `writeDeliveries` (D-5997). A new writer method delegates to it and joins `mail-hardening.test.ts`'s census.
- **Wire: additive only.** No `FLEET_PROTO` bump. A new field has one reader, and its absence means the old behaviour.
- **Skill clauses are mechanisms.** A pinned clause and its test change in the same commit.
- **Tests:** `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time, in the foreground, from the package directory. Re-run a known load flake alone before calling it a break.
- **Commits:** a characterization commit (green on the old code) before any commit that moves existing behaviour (MI-3).

## Review focus

1. **Nothing is acked whose write failed, and nothing is acked when fd 1 is a pipe or `/dev/null`.** The ack follows a write that succeeded, delivery by delivery, and a failed write stops the loop. That is all the client can know: a successful write reached fd 1, not a reader (spec §2, §4). Check that the show-only test runs before the read, that a bare run under the measured tool capture still acks, that the footer names every acked delivery, and that the redirect-to-file residual is pinned by a test named as the residual.
2. **Nothing printed is hidden from replay unless it was acked.** Only an attributed recipient fetch stamps `fetchedAt`. The inbox read stamps nothing.
3. **The printed set is the ackable set the mailbox still shows.** The inbox selects with the hoisted ack guard AND `OUTSTANDING_OR_ABANDONED_SQL`, so no row is printed forever and refused forever, and no closed run's replay-ceiling park is printed as live.
4. **Identity is the pane's, and its absence narrows nothing.** No flag or body field selects another session. The server re-measures the pair with `attributionVerdict`. `mail fetch` never refuses for lack of identity: a derive failure fetches unattributed, as today.
5. **No skew wedges a reader.** The opt-in works with old and new clients. The nudge names `mail inbox` only when the fleet's client carries it.
6. **No stamped row outlives today's ceiling.** Every `OUTSTANDING_STATES_SQL` holder frees a fetched-but-unacked row when it frees today (spec §3.6's walk), and a repoint clears the stamp.
7. **A stamp speaks only for the uuid that fetched.** The replay skip and the bound park both compare `fetchedUuid` with the registry's current uuid for `toId`, in `sweepMail`, after the registry was listed. A mismatch clears the stamp and the row replays as today.
8. **The operator's transcript keeps its mail cards.** An inbox print renders as one card per well-formed entry, and a forged fence, a cut print or a malformed entry renders none (spec §3.8).

## Tasks

Waves: **1** MI-1 and MI-2 (clean output, fleet), **2** MI-3 to MI-6 (the server half), **3** MI-7 to MI-9 (the client verb and the skills, fleet) and MI-11 (the PWA's inbox cards, server), **4** MI-10 (the nudge switch, server).

| Task | Band | Lane | Depends on |
|---|---|---|---|
| MI-1 status parsers opt in | 1 | FLEET | none |
| MI-2 clean stdout by default; skill prose | 2 | FLEET | MI-1 merged |
| MI-3 one ackable guard; `inboxFor` | 2 | SERVER | none |
| MI-4 `fetchedAt` and the replay predicate | 3 | SERVER | none |
| MI-5 attributed fetch stamps | 2 | SERVER | MI-4 |
| MI-6 inbox renderer, page and route | 3 | SERVER | MI-3 |
| MI-7 `ccrc-api mail inbox` | 3 | FLEET | MI-6 on the server box |
| MI-8 `mail fetch` sends identity | 2 | FLEET | MI-5 |
| MI-9 skills, references, README | 3 | FLEET (skills) | MI-7 |
| MI-10 the nudge switch | 3 | SERVER | MI-7's release tag; MI-11 on the server box |
| MI-11 the PWA renders inbox prints as mail cards | 2 | SERVER (PWA) | MI-6 |

### Task MI-1: the two status parsers opt in (spec §3.1, §1.3)

**Routing:** band 1. **Lane:** FLEET.

**Files:**
- Modify `ccd/session-hook.sh#_apr_call` (≈:5062-5070): run the client as `CCRC_API_STATUS=line "$apr_api" "$@" 2>&1`. The parse is unchanged.
- Modify `ccd/ccrc#_inst_approval_key` (≈:15765-15775): the same prefix on `"$api" approvals key`.
- Modify `server/test/session-hook-approval-wait.test.ts` and `server/test/ccrc-approval-key.test.ts`: the stub client records its environment.

- [ ] **Step 0: Re-ground.** Find both call sites by symbol. Confirm with `grep -rn 'http \*\|##\*http' ccd/ deploy/` that no third parser exists. If one does, it joins this task.
- [ ] **Step 1: Red.** "the approval hook runs the client with `CCRC_API_STATUS=line`"; "the install's key pin runs it with `CCRC_API_STATUS=line`"; "a stub that prints `http 201` only when the variable is set still yields `APR_CODE` 201" (the variable is passed through the substitution, not lost to a subshell).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the prefix dropped from `_apr_call` | "the approval hook runs the client with `CCRC_API_STATUS=line`" and the 201 case |
  | the prefix dropped from `_inst_approval_key` | "the install's key pin runs it …" |
  | the variable misspelled (`CCRC_API_STATUSES`) | the 201 case |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-approval-key.test.ts --maxWorkers=2
      bash -n ccd/session-hook.sh && bash -n ccd/ccrc

### Task MI-2: clean stdout by default (spec §3.1)

**Routing:** band 2. **Lane:** FLEET. Lands after MI-1 has merged, so no release carries a quiet client and a parser that has not opted in.

**Files:**
- Modify `ccd/ccrc-api#main`'s tail (≈:584-589): after `cat "$out"`, print `\n` unless the body is empty or already ends in one (`tail -c 1` into a test, no `$( )` around `refuse`). Then: with `CCRC_API_STATUS=line`, `printf 'http %s\n' "$code" >&2` exactly as today; otherwise nothing on a 2xx, and `ccrc-api: the server answered <code>` on stderr on any other code. Exit 0 in every case, as today.
- Modify `ccd/ccrc-api`'s header comment and `usage`: say stdout is the body and one newline, and name the variable.
- Modify `server/test/ccrc-api.test.ts`: the five `^http NNN$` cases (≈:349, ≈:360, ≈:372, ≈:384, ≈:954) run with the variable set; new cases pin the default.
- Modify `ccd/coordinator-skill/SKILL.md` (≈:141-155), `ccd/worker-skill/SKILL.md` (≈:197-211) and `ccd/reviewer-skill/SKILL.md` (≈:143): stdout is the body and only the body; the status is not printed on success; the exit-code contract is unchanged. Update the tests that pin these paragraphs (`coordinator-skill.test.ts` ≈:1565-1572 and its neighbours).
- Modify `README.md`'s `ccrc-api` section (≈:3610-3625).

- [ ] **Step 0: Re-ground.** Read `main`'s tail and the D-2724 comments around `server_url` and `read_token`: nothing may move a `refuse` into a `$( )`.
- [ ] **Step 1: Red.**
  - "a 2xx body with no trailing newline is printed with exactly one";
  - "a body that already ends in a newline gets no second one";
  - "an empty body prints nothing on stdout";
  - "a 2xx answer writes nothing to stderr";
  - "a 409 answer writes `ccrc-api: the server answered 409` to stderr and exits 0, with the body on stdout";
  - "with `CCRC_API_STATUS=line`, stderr's last line is `http 200` on a 200 and `http 409` on a 409, and nothing else is on stderr";
  - "stdout parses as JSON with no cleanup, for a 200 and for a 409";
  - "the transport failure is unchanged: exit 3 and the transport envelope";
  - "the token appears on neither stream, on any path" (the existing case, re-run under both modes).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the newline never added | "printed with exactly one" |
  | the newline added unconditionally | "gets no second one" |
  | `http <code>` printed in the default mode | "a 2xx answer writes nothing to stderr" |
  | the opt-in ignored | "with `CCRC_API_STATUS=line` …" |
  | `exit 1` on a non-2xx | "exits 0, with the body on stdout" |
  | the human line printed in `line` mode as well | "and nothing else is on stderr" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2

### Task MI-3: one ackable guard, and `inboxFor` (spec §3.3 step 3, §1.5)

**Routing:** band 2. **Lane:** SERVER (L3).

**Files:**
- Modify `server/src/coord/store.ts`: hoist `writeDeliveries`' `'ack'` arm (≈:5373-5376, the negative form plus the replay-ceiling exception and its `MAIL_REPLAY_CEILING_ERROR` argument) into one named fragment, `ACKABLE_DELIVERY_SQL` with its argument list, next to `OUTSTANDING_STATES_SQL`. `writeDeliveries` uses it unchanged. The write has no table alias and the read has `d`, so the fragment is one builder, `ackableDeliverySql(prefix)` (`''` for the write, `'d.'` for the read), and there is still one spelling.
- Add `CoordStore.inboxFor(toId)`: `SELECT d.id AS deliveryId, d.envelope FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs rr ON rr.id = m.runId WHERE d.toId = ? AND <ACKABLE_DELIVERY_SQL> AND ${OUTSTANDING_OR_ABANDONED_SQL} ORDER BY d.id ASC`. The join is `outstandingMailFor`'s (≈:5152-5160), so `ABANDONED_PARK_SQL`'s `COALESCE(rr.state, '')` reads the same run.
- Add `abandonedCount(toId)`: the rows `outstandingMailFor`'s predicate admits that `inboxFor` does not. Since `inboxFor` ⊆ `outstandingMailFor` by construction, this is a plain difference.
- Docstring on `inboxFor`: the rule (spec §3.3 step 3), and why the ack guard alone would print a closed run's replay-ceiling park as live.
- Create `server/test/mail-inbox-store.test.ts`.
- Modify `server/test/single-definition.test.ts`: the fragment's SQL text appears once in `server/src`.

- [ ] **Step 0: Re-ground.** Read `markAcked` (≈:5678-5690) and its I2(b) docstring, and `OUTSTANDING_OR_ABANDONED_SQL`.
- [ ] **Step 1: Characterize (green on the old code, its own commit).** `mail-deliveries-writer.test.ts` already pins the ack guard's answers. Add any case it lacks for a `queued` row, a parked `queued` row, the replay-ceiling `rejected` row, a `run closed` park and an `acked` row, and run it green on `main` before hoisting.
- [ ] **Step 2: Red.**
  - "`inboxFor` returns a `queued`, a parked, a `delivered`, a replay-ceiling row of a live run and a replay-ceiling row with no run, and not an `acked`, a `run closed` park or a park-ceiling rejection";
  - "a replay-ceiling row whose run is closed is neither printed nor counted" (`inboxFor` omits it, `abandonedCount` does not count it, and `markAcked` still accepts it, as today);
  - "it returns only the caller's rows (`toId`)";
  - "it returns them oldest first";
  - "for every fixture row, `inboxFor` includes it only if `markAcked` changes it AND `outstandingMailFor` lists it" (the property: `inboxFor` ⊆ markAcked-changeable ∩ `outstandingMailFor`), and "every row in that intersection is in `inboxFor`" (equality, so nothing ackable and shown is left behind);
  - "`abandonedCount` equals `outstandingMailFor`'s count minus `inboxFor`'s, and counts the park-ceiling rejection and nothing `inboxFor` returns".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `inboxFor` uses `OUTSTANDING_OR_ABANDONED_SQL` alone (no ack guard) | "only if `markAcked` changes it" and "not … a park-ceiling rejection" |
  | `inboxFor` uses the ack guard alone (no read predicate) | "a replay-ceiling row whose run is closed is neither printed nor counted" |
  | `LEFT JOIN runs` made an inner join | "a replay-ceiling row with no run" |
  | the I2(b) exception dropped from the fragment | "a replay-ceiling row" and the characterization |
  | `ORDER BY id DESC` | "oldest first" |
  | the `toId` filter dropped | "only the caller's rows" |
  | a second copy of the fragment's text | `single-definition.test.ts` |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-inbox-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-deliveries-writer.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task MI-4: `fetchedAt` and `fetchedUuid`, the replay skips a row fetched by the current uuid, and its lifetime stays bounded (spec §3.6)

**Routing:** band 3. **Lane:** SERVER (L3, migration).

**Files:**
- Modify `server/src/coord/schema.ts`: migration 30, `ALTER TABLE mail_deliveries ADD COLUMN fetchedAt INTEGER` and `ADD COLUMN fetchedUuid TEXT`, both in the one migration (≈:1765 is 29, the last today). Take the next free number if another migration lands first.
- Modify `server/src/coord/store.ts`: `markFetched(id, at, uuid): DeliveryWrite`, through `writeDelivery` with `'non-terminal'`: `fetchedAt = CASE WHEN fetchedUuid IS ? THEN COALESCE(fetchedAt, ?) ELSE ? END, fetchedUuid = ?`, so the first stamp per uuid stands and a different uuid replaces both. `clearFetched(id, staleUuid): DeliveryWrite`, through `writeDelivery` with `'non-terminal'` and `WHERE fetchedUuid = ?`, setting both columns NULL, so a fresh stamp written in between is never erased. `dueDeliveries` (≈:5488-5510) keeps both arms as they are and adds `fetchedAt` and `fetchedUuid` to the rows it returns.
- Add `CoordStore.fetchedPastReplayBound(now, replayMs, maxReplays): {id: number; mailId: number; toId: string; fetchedUuid: string}[]`: `state = 'delivered' AND fetchedAt IS NOT NULL AND MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0)) + (? - replayCount) * ? <= ?`, ordered by id. It selects `state = 'delivered'` directly, not through `OUTSTANDING_STATES_SQL`, so it is not a new holder (spec §3.6).
- Modify `repointCoordinatorMail` (≈:2210-2216): its SET becomes `toId = ?, fetchedAt = NULL, fetchedUuid = NULL`. Its docstring says why: a stamp is a fact about the old recipient.
- Modify `server/src/watch.ts#sweepMail`, after the registry read and `uuidByToId` (≈:7482-7486), with one pure helper, `stampHolds(row, uuidByToId)`: true only when `row.fetchedAt !== null` and `row.fetchedUuid === uuidByToId.get(row.toId)`.
  - In the due loop, a `delivered` row with `fetchedAt` set is skipped when `stampHolds`, and otherwise has its stamp cleared (`clearFetched(id, row.fetchedUuid)`, through `this.landed(…)`) and replays as an unstamped row does today.
  - One pass after the parked-row ceiling (≈:7545-7560) takes each row `fetchedPastReplayBound(now, MAIL_REPLAY_MS, MAIL_REPLAY_MAX_ATTEMPTS)` returns. A row for which `stampHolds` is false has its stamp cleared and is not parked. Every other row is parked through `store.rejectDelivery(id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR)` and `this.landed(…)`. Nothing is typed, and no sender is told (the ceiling at ≈:8083 tells nobody either). Set `ceilinged` when any row parks, so `due` is re-read.
- Modify `server/test/mail-hardening.test.ts` (the writer census names `markFetched`), `server/test/coord-db.test.ts` (the migration), and `server/test/mail-sweep.test.ts` (the replay cases near ≈:1027-1111).
- Modify `server/src/watch.ts`'s `MAIL_REPLAY_MS` docstring (≈:606-610) and `MAIL_REPLAY_MAX_ATTEMPTS`' (≈:668-677): a fetched row is not replayed, and parks at the moment its owed replays would have reached the ceiling.
- Modify the store's `OUTSTANDING_STATES_SQL` holder walk (≈:2311ff) only if the scan finds a new holder; the walk in spec §3.6 is the reasoning, and its rows go into `fetchedPastReplayBound`'s docstring.
- Modify `server/test/mail-peer-quota.test.ts` (the `peer-quota` and `duplicate` bound cases), `server/test/coord-kickoff.test.ts` (`queueSystemMail`'s dedupe on a run-less kickoff) and `server/test/digest.test.ts` (the correction's `duplicate`) for the bound cases.

- [ ] **Step 0: Re-ground.** Read `sweepMail`'s registry read (`readRegistryMeasured`, the early return when it is not listed, and `uuidByToId`, ≈:7482-7486), `ccd/ccd#_sync_uuid` (≈:17810-17816) for when the registry's uuid changes, `db.ts`'s migration loop and its rule for a higher `user_version`, `bumpReplayCount`, the replay ceiling in `sweepMail` (≈:8070-8083), `repointCoordinatorMail`, the store's `OUTSTANDING_STATES_SQL` holder walk (≈:2311ff), and `stallDeafMail` (`stall.ts` ≈:925-958). Re-run spec §3.6's holder walk against the code: a holder added since the spec joins the walk and gets a bound case.
- [ ] **Step 1: Red.**
  - Every "stamped" below means stamped by the uuid the fixture registry still holds for `toId`, unless the case says otherwise.
  - "a `delivered`, unacked row stamped by the recipient's current uuid is not replayed at `deliveredAt + MAIL_REPLAY_MS + 1`";
  - "a uuid rotation after the fetch re-arms the replay": stamp under uuid U1, rotate the fixture registry's `.uuid` to U2 (what `_sync_uuid` writes after a `/clear`), sweep at `deliveredAt + MAIL_REPLAY_MS + 1`: the nudge is typed, `replayCount` grows, and `fetchedAt` and `fetchedUuid` are NULL;
  - "a reused session name re-arms the replay": the same with the registry record removed and re-created under the same id and a new uuid;
  - "a recipient missing from the registry clears the stamp" and the row then follows today's absent-recipient path, as an unstamped row does;
  - "an unlistable registry changes no stamp" (the sweep returns before the decision, as it does today);
  - "a rotated stamp is not parked by the bound": a row stamped under U1 with the registry at U2 is still `delivered` after a sweep past the bound, its stamp is cleared, and it is parked later only by today's replay ceiling;
  - "`clearFetched` does not erase a fresh stamp": stamp U1, re-stamp U2, then `clearFetched(id, 'U1')` answers `changed: false` and U2 stands;
  - "`markFetched` under a new uuid replaces the stamp, and under the same uuid keeps the first time";
  - "a stamped row parks without a nudge": at `deliveredAt + MAIL_REPLAY_MAX_ATTEMPTS × MAIL_REPLAY_MS` the sweep leaves it `rejected` / `undeliverable` with `MAIL_REPLAY_CEILING_ERROR`, the fake tmux saw no keys for it, and no sender mail was queued; one millisecond earlier it is still `delivered`;
  - "a stamped row with `replayCount` 19 parks one `MAIL_REPLAY_MS` after its last delivery" (the bound subtracts the replays already made);
  - "a parked stamped row is still ackable (I2(b)) and still listed by `outstandingMailFor` while its run is live";
  - "a stamped peer mail does not hold a peer-quota slot past the bound": three stamped, unacked A-to-B peer mails refuse a fourth `peer-quota` before the bound, and after the sweep parks them a fourth is accepted;
  - "a stamped peer mail does not hold its subject past the bound" (`duplicate` before, accepted after);
  - "`queueSystemMail`'s dedupe frees after the bound": a run-less system mail stamped and unacked makes a repeat answer `queued: false` before the bound and `queued: true` after it; the same for a digest correction's `duplicate`;
  - "`repointCoordinatorMail` clears the stamp": a stamped coordinator brief repointed to the heir has `fetchedAt` NULL and is due for replay to the heir;
  - "the same row unstamped is due" (today's behaviour);
  - "a stamped `queued` row is still due for its first delivery";
  - "`markFetched` keeps the first stamp" (two calls under one uuid, the first time stands);
  - "`markFetched` on an `acked` or `rejected` row changes nothing and answers `changed: false`";
  - "a stamped row's `replayCount` stops growing across ten replay intervals, and the row stays `delivered`";
  - "`stallDeafMail` still answers deaf at `COORD_DEAF_MS` for a stamped, unacked `wave-done`" (`stall-verdict.test.ts`);
  - "a database at 29 migrates to 30 with both columns, and a server that knows 29 still reads a database at 30" (`coord-db.test.ts`'s existing rollback shape).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the stamp test dropped (every stamped row replays) | "stamped by the recipient's current uuid is not replayed" |
  | `stampHolds` ignores the uuid (any stamp silences) | "a uuid rotation after the fetch re-arms the replay", "a reused session name re-arms the replay" |
  | an absent registry entry read as a match | "a recipient missing from the registry clears the stamp" |
  | the bound pass parks without `stampHolds` | "a rotated stamp is not parked by the bound" |
  | a mismatch skips the replay without clearing the stamp | the rotation case's "`fetchedAt` and `fetchedUuid` are NULL" |
  | `clearFetched` without `WHERE fetchedUuid = ?` | "`clearFetched` does not erase a fresh stamp" |
  | `markFetched` keeps the old uuid on a new one | "under a new uuid replaces the stamp" |
  | migration 30 adds only `fetchedAt` | `coord-db.test.ts`'s column case |
  | the bound pass removed | "parks without a nudge", "does not hold a peer-quota slot", "dedupe frees after the bound" |
  | the bound pass types the nudge before it parks | "the fake tmux saw no keys for it" |
  | the bound without `− replayCount` | "with `replayCount` 19 parks one `MAIL_REPLAY_MS` after" |
  | the bound parks with another `lastError` | "still ackable (I2(b))" |
  | the bound pass tells the sender | "no sender mail was queued" |
  | the repoint keeps `fetchedAt` or `fetchedUuid` | "`repointCoordinatorMail` clears the stamp" (both columns asserted NULL) |
  | the predicate added to the `queued` arm too | "still due for its first delivery" |
  | `COALESCE` dropped | "keeps the first stamp" |
  | `'non-terminal'` replaced by no guard | "on an `acked` or `rejected` row changes nothing" |
  | `markFetched` writes with its own `UPDATE` | the writer census |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-deliveries-writer.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stall-verdict.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/digest.test.ts --maxWorkers=2

### Task MI-5: an attributed fetch by the recipient stamps the row (spec §3.6)

**Routing:** band 2. **Lane:** SERVER (L4).

**Files:**
- Modify `server/src/coord/routes.ts`'s `GET /api/mail/:id` (≈:1250-1264): read optional `fromId` and `fromUuid` from the query. With both present, run `attributionVerdict(fromId, fromUuid, 'fromUuid')` (≈:643-672). Stamp with `markFetched(id, now, fromUuid)` only when the verdict is `ok` and `row.toId === fromId`, so the stamp carries the uuid the registry just confirmed. Serve the envelope in every case, as today.
- Add the answer's `fetch` field: `'stamped'`, `'unattributed'` (no pair), `'not-yours'` (verdict ok, `toId` differs), or `'unmeasured'` (verdict `registry-unmeasurable`). A `stale-uuid` or `unknown-sender` verdict answers `'not-yours'` with its code in `fetchRefused`. In `shared/api.ts`: `MAIL_FETCH_MARKS` and its reader, `readMailFetchMark`, which reads an absent field as `'unattributed'`.
- Modify `server/test/mail-routes.test.ts`.

- [ ] **Step 0: Re-ground.** Read the ack route's ladder (≈:1059-1131), so the fetch uses the same verdict and not a copy of it.
- [ ] **Step 1: Red.**
  - "a fetch with the recipient's current pair stamps the row with that uuid (`fetchedUuid`) and answers `fetch: 'stamped'`";
  - "a second fetch after a `/clear` (the registry's uuid rotated, the new pair) re-stamps with the new uuid";
  - "a fetch with no pair serves the envelope, stamps nothing, and answers `'unattributed'`";
  - "a fetch by another registered session serves the envelope, stamps nothing, and answers `'not-yours'`";
  - "a stale uuid serves the envelope, stamps nothing, and answers `'not-yours'` with `fetchRefused: 'stale-uuid'`";
  - "an unlistable registry serves the envelope, stamps nothing, and answers `'unmeasured'`";
  - "the envelope bytes are identical in all five cases" (no narrowing);
  - "`readMailFetchMark` reads an absent field as `'unattributed'`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the `toId === fromId` check dropped | "by another registered session … stamps nothing" |
  | the stamp written without the uuid | "stamps the row with that uuid" |
  | the verdict skipped (a pair alone stamps) | "a stale uuid … stamps nothing" |
  | a failed verdict answers 403 instead of serving | "identical in all five cases" |
  | `'unmeasured'` folded into `'unattributed'` | "answers `'unmeasured'`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2

### Task MI-6: the inbox renderer, its page and its route (spec §3.3, §3.4)

**Routing:** band 3. **Lane:** SERVER (L0, L1, L4).

**Files:**
- Modify `shared/api.ts`: `MAIL_INBOX_PAGE_MAX_BYTES = 20 * 1024`, `MAIL_INBOX_FENCE_INFO = 'ccrc-inbox'`, the wire types `MailInboxEntry {deliveryId: number; text: string}` and `MailInboxAnswer {ok: true; deliveries: MailInboxEntry[]; remaining: number; abandoned: number}`, and `readMailInboxAnswer(x: unknown): MailInboxAnswer | null`.
- Modify `server/src/coord/envelope.ts`: `renderInboxEntry(deliveryId, storedEnvelope)`, pure. Parse with `parseMailEnvelope`. On `ok`, render `delivery:`, `from:`, `to:`, `kind:`, `subject:`, `run:` (when set, in `renderEnvelope`'s `run:` shape), `artifacts:` (when any), `--` and the body, inside a fence from `fenceFor` with the info string. On `malformed` or `not-mail`, the stored text verbatim. Also `pageInbox(entries, budget)`, pure: it takes entries in order while the running byte total fits, always at least one, and answers `{page, remaining}`.
- Modify `server/src/coord/routes.ts`: `GET /api/mail/inbox`, registered with the mail routes: `requireMailToken`, `fromId`/`fromUuid` from the query (both strings, else 400 `bad-kind`), `requireAttribution(reply, fromId, fromUuid, 'fromUuid')`, then `inboxFor`, then render, mask (`maskDeep`, D-5513), page, `abandonedCount`, and the answer.
- Modify `server/src/auth/gate.ts`'s `EXEMPT` (≈:210-225): `GET /api/mail/inbox`, "a session reading and then acking its own mail: box-token gated and attribution-checked".
- Modify `server/test/box-token-census.test.ts` and `server/test/auth-gate.test.ts` for the new door.
- Create `server/test/mail-inbox-render.test.ts` and `server/test/mail-inbox-route.test.ts`.

- [ ] **Step 0: Re-ground.** Read `renderEnvelope`, `fenceFor`, `parseMailEnvelope`, `requireAttribution`, and the fetch route's masking.
- [ ] **Step 1: Red (renderer and page).**
  - "an entry shows `delivery`, `from`, `to`, `kind`, `subject`, `run` with program and wave, the artifacts and the body, in that order, and no `ack:` line";
  - "an entry never shows the mail row's own id" (a fixture whose mail id differs from its delivery id);
  - "a body holding a run of six backticks gets a seven-backtick fence";
  - "a body holding a fake `delivery: 9` line stays inside the fence";
  - "a malformed stored envelope is printed verbatim";
  - "the info string is not `MAIL_ENVELOPE_FENCE`, and `parseMailEnvelope` answers `not-mail` on a rendered entry";
  - "`pageInbox` stops before the entry that would cross the budget and counts it in `remaining`";
  - "`pageInbox` always takes the first entry, even one over the budget".
- [ ] **Step 2: Red (route).**
  - "without the box token: 401 `unauthenticated`";
  - "with a stale uuid: 403 `stale-uuid`, recorded as a mail rejection";
  - "with an unlistable registry: `registry-unmeasurable`";
  - "the caller's two ackable deliveries come back oldest first, each with its `deliveryId`";
  - "another session's mail is never in the answer";
  - "a park-ceiling rejection is counted in `abandoned` and not returned";
  - "a replay-ceiling park whose run is closed is neither returned nor counted in `abandoned`";
  - "the text is masked" (a fixture secret shape in a body);
  - "the read changes no row" (`state`, `fetchedAt`, `attempts` and `replayCount` before and after);
  - "`GET /api/mail/inbox` is not answered by the `:id` route" (a 200 with the inbox shape, never a 400 `bad-request`).
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the `ack:` lines kept | "no `ack:` line" |
  | `fenceFor` replaced by a fixed three-backtick fence | "a seven-backtick fence" |
  | the info string set to `MAIL_ENVELOPE_FENCE` | "`parseMailEnvelope` answers `not-mail`" |
  | a malformed envelope dropped | "printed verbatim" |
  | `pageInbox` may return an empty page | "always takes the first entry" |
  | `requireAttribution` skipped | "with a stale uuid: 403" |
  | masking skipped | "the text is masked" |
  | the route stamps `fetchedAt` | "the read changes no row" |
  | `EXEMPT` entry dropped | `auth-gate.test.ts` |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-inbox-render.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-inbox-route.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-envelope.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-envelope-parse.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task MI-7: `ccrc-api mail inbox` (spec §3.5)

**Routing:** band 3. **Lane:** FLEET. Released only once the server box runs MI-6 (§Gates).

**Files:**
- Modify `ccd/ccrc-api`:
  - a row `[mail.inbox]='GET|/api/mail/inbox|no|-'`; the header's and `ROUTES`' count word becomes thirty-two;
  - extract the request block of `main` (≈:545-589: URL, temp file, curl with the token on stdin, transport check) into one function that sets the body and code, so the inbox loop and every other row share it, and no `refuse` moves into a `$( )`;
  - `mail inbox`: refuse any argument (`unexpected-id`, `bad-args`); refuse `no-jq` without `jq`; `derive_identity`; decide show-only before the read (`[[ /dev/stdout -ef /dev/null ]] || [[ -p /dev/stdout ]]`, spec §3.5 step 2), and in a show-only run print the "nothing was acked; run it bare" line first and last and send no ack; read with the derived pair as the query; on a non-200, print the body and the "did not serve the inbox" line (spec §3.5 step 5) and exit 0; on a 200, check the shape with `jq` (a bad shape prints the body and acks nothing); then for each entry in order: `printf '%s\n'` the text, stop on a failed write, ack through the shared request function with the synthesized body, and print the outcome line; then the footer, with the line naming every delivery this run acked;
  - `usage`: the verb, and that its stdout is plain text.
- Modify `server/test/ccrc-api-closed.test.ts`: the body-fill census (≈:316) names the synthesized ack body; the row census and count word.
- Modify `server/test/ccrc-api.test.ts`, or create `server/test/ccrc-api-inbox.test.ts`, with its fake server (the existing `reply` harness, extended to answer per path).

- [ ] **Step 0: Re-ground and measure.** Read `derive_identity`, the `approvals show` and `asks list` identity blocks (≈:528-543), `splice_body_field`, and the D-2724 comments. Then **measure what fd 1 is under the Claude Code Bash tool** in the implementing session, which runs on the fleet's own build: `[[ -p /dev/stdout ]]`, `[[ -f /dev/stdout ]]`, and `stat -L -c %i /dev/fd/1 /dev/fd/2` (`-f %i` on darwin), and record the result and `claude --version` in the PR body. Spec §1.2 measured one regular file shared with fd 2 (2.1.308, darwin). Also measure fd 1 under the test harness's `spawn` (expected: a socket, neither `-p` nor `-f`).
  - If fd 1 under the tool **is not a pipe**, build the show-only guard as written.
  - If it **is a pipe**, stop and report to the orchestrator before writing code: the guard would make every bare run show-only. The footer's acked-delivery line is built either way. Spec Q7 is the operator's ruling on this case.
  - If fd 1 under the harness's `spawn` is a pipe, the ack-path cases run with stdout on a temp file's descriptor instead, which is the tool's measured shape.
- [ ] **Step 1: Red.**
  - "two entries are printed in order, each followed by `inbox: acked delivery <n>`, and the fake server saw two acks with the pane's `fromId` and `fromUuid`";
  - "each ack names the `deliveryId` from the answer";
  - "the ack for entry two is sent only after entry two's text was written" (the fake server records the order of reads and acks, and the client's stdout is a temp file the test reads when each ack arrives);
  - "stdout closed (`>&-`): the first write fails with `EBADF`, no ack is sent, and the failure is named on stderr" (deterministic: the descriptor is closed before the client starts);
  - "stdout on `/dev/full`: the first write fails with `ENOSPC` and no ack is sent" (Linux only, skipped where `/dev/full` does not exist; deterministic: every write fails);
  - "stdout a FIFO whose reader has gone: no ack is sent" (the test makes the FIFO, opens its read end non-blocking, opens the write end for the client, and closes the read end before spawning, so the reader is gone before the first byte; the fake server records zero acks);
  - "stdout a FIFO with a live reader (the `| tail` shape): every entry is printed, no ack is sent, and the first and last lines are the `run … bare` line";
  - "stdout on `/dev/null`: no ack is sent";
  - "RESIDUAL (spec §4): stdout redirected to a regular file acks every entry it wrote, and the footer names each acked delivery" (the case's name says it pins the residual; it is the same shape as the tool's own capture);
  - "stdout and stderr on one regular file (the tool's measured shape): every entry is printed and acked, and nothing on that file breaks the entries' fences";
  - "an ack answered `stale-uuid` prints `NOT acked` and the loop goes on to the next entry";
  - "an ack with no response prints `NOT acked (transport)` and the exit code is still 0";
  - "`already: true, parked: false` prints `was already acked`; `parked: true` prints `was closed before this ack` with `lastError`";
  - "`remaining: 3` prints the `run mail inbox again` line; `abandoned: 1` prints the `mail list --to` line";
  - "an empty inbox prints `inbox: no unread mail` and sends no ack";
  - "a 400 `bad-request` on the read (an older server) prints the hint and sends no ack";
  - "no `TMUX_PANE` refuses `no-pane` and sends nothing";
  - "`mail inbox --to x` refuses `bad-args`";
  - "without `jq` on `PATH`: `no-jq`, and nothing is sent";
  - "the token appears on neither stream" and "the token rides curl's stdin on every request" (the read and each ack).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | ack before print | "only after entry two's text was written" |
  | the write's status ignored | "stdout closed (`>&-`) … no ack is sent", "on `/dev/full`" |
  | the `-p` test dropped | "a FIFO with a live reader … no ack is sent" |
  | the `/dev/null` test dropped | "stdout on `/dev/null`: no ack is sent" |
  | show-only decided after the first ack | "a FIFO with a live reader" (the first entry would be acked) |
  | the `run … bare` line printed only last | "the first and last lines" |
  | the acked-delivery footer dropped | "RESIDUAL … the footer names each acked delivery" |
  | a regular file treated as show-only | "RESIDUAL …" and "the tool's measured shape" |
  | the loop stops at the first failed ack | "goes on to the next entry" |
  | identity from a `--to` flag | "`mail inbox --to x` refuses" |
  | the id parsed from the text instead of `deliveryId` | "each ack names the `deliveryId`" |
  | exit 1 when an ack fails | "the exit code is still 0" |
  | the `jq` check dropped | "`no-jq`, and nothing is sent" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api-inbox.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts --maxWorkers=2
      bash -n ccd/ccrc-api

### Task MI-8: `mail fetch` sends the pane's identity (spec §3.5, §3.6)

**Routing:** band 2 (it refactors `derive_identity`; the orchestrator reviews the diff). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccrc-api`: add `try_derive_identity`, the non-refusing derive. It runs `derive_identity`'s checks in the same order, sets `DERIVED_ID` and `DERIVED_UUID` on success, and on any failure leaves both empty, sets `DERIVE_WHY` to the code `derive_identity` would have refused with (`no-pane`, `bad-pane`, `no-tmux`, `bad-session`, `no-uuid`, `bad-uuid`) and returns 1. It never calls `refuse` and never prints. `derive_identity` becomes `try_derive_identity || refuse "$DERIVE_WHY" "<the same detail as today>"`, so every existing caller refuses with today's code and detail.
- On `mail.fetch`: when `TMUX_PANE` is set, `try_derive_identity`. On success add `fromId` and `fromUuid` to the query. On failure fetch unattributed, exactly as today, and write `ccrc-api: mail fetch sent no identity (<DERIVE_WHY>); this fetch does not stop the replay` to stderr. With no `TMUX_PANE`, fetch unattributed and silent, as today.
- Modify `server/test/ccrc-api.test.ts`.

- [ ] **Step 1: Red.**
  - "inside a pane, `mail fetch 7` sends `fromId` and `fromUuid` from the pane";
  - "with no pane, it sends neither, still fetches, and writes nothing to stderr";
  - "a pane whose identity cannot be derived still fetches, unattributed": one case each for a bad `TMUX_PANE`, a tmux session name outside `SAFE_RE`, a missing `.uuid` and an empty `.uuid`; each prints the envelope on stdout, exits 0, sends no pair, and writes the `sent no identity (<code>)` line naming its code;
  - "every existing `derive_identity` caller still refuses with today's code and detail" (`whoami`, `asks list`, `approvals show`, `ledger allocate` without `--by`; the existing cases, re-run).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | identity never sent | "sends `fromId` and `fromUuid`" |
  | a missing pane refuses | "with no pane … still fetches" |
  | derive failure refuses (`mail fetch` calls `derive_identity`) | "a pane whose identity cannot be derived still fetches, unattributed" |
  | `try_derive_identity` calls `refuse` on one check | that check's "still fetches" case |
  | the stderr note dropped | "writes the `sent no identity (<code>)` line" |
  | `derive_identity` no longer refuses (its `refuse` fallback dropped) | "every existing `derive_identity` caller still refuses" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2

### Task MI-9: the skills, references and README teach `mail inbox` (spec §3.7)

**Routing:** band 3. **Lane:** FLEET (skills ship with the fleet install). Lands with or after MI-7.

**Files:**
- Every skill clause that names `mail inbox` says: run it bare, by its full path, with no pipe, no redirect and no `head` or `tail`; a piped run acks nothing; and the footer lists the deliveries it acked, for `mail fetch <delivery>` if their text did not reach you.
- Modify `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:218-222) becomes one call, with the three calls kept as the fallback for an inbox the server does not serve. The pinned ack clause (`worker-skill.test.ts` ≈:60) says `mail inbox` acks what it printed, and that the 20 replays apply to a delivery nobody fetched.
- Modify `ccd/coordinator-skill/SKILL.md` clause 3 (≈:291-299) and its pin in `coordinator-skill.test.ts`.
- Modify `ccd/reviewer-skill/SKILL.md`'s ack clause and its pin (`reviewer-skill.test.ts` ≈:22).
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` §3 (≈:425-480) and `references/mail-envelope.md`: the inbox first, the old nudge quoted as the older form, and the fetch reader's ack unchanged.
- Modify `README.md`: the verb list (≈:3616) and its mail paragraphs.
- The executable-corpus parity in `ccrc-api-closed.test.ts` (≈:116) covers the new call.

- [ ] **Step 0: Re-ground.** Read every pinned clause the edit touches, and `install-coordinator-skill.test.ts`, which pins the shipped tree.
- [ ] **Step 1: Red.** Each changed clause's new text is pinned before the prose changes; "every skill that reads mail names `mail inbox`"; "every clause that names `mail inbox` says to run it bare (no pipe, no redirect, no `head` or `tail`)"; "no skill shows `mail inbox` followed by `|` or `>` in an example"; "no skill teaches the three calls as the first way"; "the corpora's `ccrc-api` calls all map to `ROUTES`" (the existing parity, which reds until MI-7's row exists).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | a clause left at its old text | its verbatim pin |
  | the run-it-bare sentence dropped from one skill | "every clause that names `mail inbox` says to run it bare" |
  | an example `mail inbox \| tail -n 40` added | "no skill shows `mail inbox` followed by `\|` or `>`" |
  | a skill calls a verb `ROUTES` lacks (`mail read`) | the corpus parity |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2

### Task MI-10: the nudge names `mail inbox` once the fleet carries it (spec §3.7)

**Routing:** band 3. **Lane:** SERVER.

**Files:**
- Modify `shared/api.ts`: `MAIL_INBOX_SINCE`, the release tag MI-7 merged into, beside `RUNS_ATTRIBUTION_SINCE` (≈:9501).
- Modify `server/src/fleetstate.ts`: `fleetCarriesMailInbox(role, own, fleet)`, in `fleetCarriesRunsAttribution`'s shape (≈:249-278), pure.
- Modify `server/src/coord/envelope.ts`: `renderMailNudge(toId, form: 'inbox' | 'list')`, with today's text as `'list'`, byte-identical, and the spec's inbox text. Both share the 24-character head. Add `isOwnNudge(box, toId)`, true for either form.
- Modify `server/src/watch.ts`: `sweepMail` chooses the form at send time from `fleetCarriesMailInbox` (≈:8064). The park's own-nudge test (≈:8052) uses `isOwnNudge`.
- Modify `server/test/coord-envelope.test.ts` (≈:160-200) and `server/test/mail-sweep.test.ts`; create `server/test/fleet-mail-inbox.test.ts` on `runs-attribution-switch.test.ts`'s model.

- [ ] **Step 0: Re-ground.** Read `renderMailNudge`'s docstring (D-738, D-791, the 24-character needle) and `sendPrompt`'s echo needle.
- [ ] **Step 1: Red.**
  - "`fleetCarriesMailInbox` is true on a `both` box, on agreed builds, and at or past the floor; false below it, on a tagless divergent build, and with no fleet stamp";
  - "the `'list'` form is byte-identical to today's nudge";
  - "the `'inbox'` form starts with the same 24 characters, names `~/.local/bin/ccrc-api mail inbox`, says `Run it bare: no pipe, no redirect, no head or tail`, and names no route, no `curl -`, no `deliveryId` and no toId";
  - "the sweep types the `'inbox'` form when the fleet carries it and the `'list'` form when it does not";
  - "a box holding the `'list'` form is resumed by a park retry while the sweep would type the `'inbox'` form" (and the reverse);
  - "a box holding other text is held with nothing pressed" (unchanged).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the floor check dropped (always `'inbox'`) | "false below it" |
  | the `both` arm dropped | "true on a `both` box" |
  | the head changed in the inbox form | "the same 24 characters" |
  | the run-it-bare sentence dropped | "says `Run it bare …`" |
  | `isOwnNudge` accepts only the current form | "resumed by a park retry … (and the reverse)" |
  | the list form edited | "byte-identical to today's nudge" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/coord-envelope.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-mail-inbox.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/runs-attribution-switch.test.ts --maxWorkers=2

### Task MI-11: the PWA renders an inbox print as mail cards (spec §3.8)

**Routing:** band 2. **Lane:** SERVER (the PWA bundle ships with the server). Lands before MI-10 (§Gates).

**Files:**
- Modify `shared/api.ts`: `MailCardFields` (the `MailEnvelope` fields less `id`), and `parseInboxPrint(text): InboxPrintParse`, pure, beside `parseFetchedMailEnvelope` (≈:5601). `InboxPrintParse` is `{ok: true; entries: {deliveryId: number; card: MailCardFields}[]} | {ok: false; why: 'not-inbox'} | {ok: false; why: 'malformed'; at: number}`, a typed union and never a bare null, for the reason `MailEnvelopeParse`'s docstring gives. The rules are spec §3.8's, and its docstring repeats the rank-3 caveat word for word: it asserts nothing about authenticity.
- Modify `pwa/src/session/chatItems.ts`: in the `tool_result` branch (≈:78-110), under the same `isError` and `truncatedBytes` guards, try `parseInboxPrint` only when `parseFetchedMailEnvelope` did not answer `ok`, and push one `{kind: 'mail'}` item per entry, keyed `mail-<toolId>-<n>`. The `mail` member's `envelope` type becomes `MailCardFields`, and its docstring names the third door (an inbox print).
- Modify `ui/src/components/mail-card.tsx`: `MailCard` and `runLabel` take `MailCardFields`. Nothing they render changes.
- Modify `pwa/test/mail-card.test.tsx` (its `buildChatItems` cases) and `server/test/mail-envelope-parse.test.ts` (where `parseFetchedMailEnvelope`'s cases live) for the parser.

- [ ] **Step 0: Re-ground.** Read the `tool_result` arm, `parseFetchedMailEnvelope` and its tests, `MailCard`, and `ChatList`'s height estimate for a `mail` item (≈:259), which reads `artifacts` and `body` only. Read MI-6's merged `renderInboxEntry` and build the fixtures from it, so the parser and the renderer agree by test and not by prose.
- [ ] **Step 1: Red (parser).**
  - "a print of two entries, each followed by its `inbox: acked delivery <n>` line, and the footer, parses to two entries in order with their delivery ids and card fields";
  - "`parseInboxPrint(renderInboxEntry(...))` gives back the fields the renderer was given" (a round trip over every field, run and no run, artifacts and none);
  - "a forged fence in a body stays body": a body holding a three-backtick `ccrc-inbox` fence with its own `delivery: 9` header, inside a `fenceFor` fence, parses to ONE entry whose body holds the forged text verbatim;
  - "a body holding a fake `inbox: acked delivery 9` line and a fake `--` stays body";
  - "a closing fence of a different length does not close the entry", and an entry with no closing fence (a `| head` cut) makes the whole print `not-inbox`;
  - "a line outside the entries that starts with neither `inbox: ` nor `ccrc-api: ` makes the print `not-inbox`" (the `| grep` shape);
  - "a show-only print (the `run … bare` line first and last) still parses its whole entries";
  - "a malformed stored envelope printed verbatim gives no entry", and "a `kind` outside `MailKind` refuses its entry";
  - "a `mail fetch` result is not an inbox print, and an inbox print is not a fetched envelope" (each parser answers `not-…` on the other's text).
- [ ] **Step 2: Red (chat items).**
  - "an inbox `tool_result` of two entries yields its tool card and then two mail cards, keyed `mail-<toolId>-0` and `-1`";
  - "an `isError` inbox result yields no mail card", and "a result with `truncatedBytes > 0` yields none";
  - "a forged-fence body yields one card, not two";
  - "a fetched envelope still yields exactly one card, as today" (the existing cases, re-run unchanged);
  - "`MailCard` renders an inbox card with sender, recipient, kind, subject, run, artifacts and body, and no control".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the closing fence matched by any run of three or more backticks | "a forged fence in a body stays body" |
  | stray lines outside entries ignored | "makes the print `not-inbox`" (the `| grep` shape) |
  | an unclosed last entry kept as a card | "an entry with no closing fence … `not-inbox`" |
  | the `truncatedBytes` guard skipped for the inbox arm | "a result with `truncatedBytes > 0` yields none" |
  | the inbox arm tried before the fetch arm and a fetched envelope parsed twice | "a fetched envelope still yields exactly one card" |
  | the key without the entry's index | "keyed `mail-<toolId>-0` and `-1`" |
  | the header walk accepts fields out of order | the round trip |

- [ ] **Step 5: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/mail-card.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/transcript-rows.test.tsx --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-envelope-parse.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-inbox-render.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/tsc --noEmit

## Operator acts

None is needed to build or land a task. Each of these is the operator's:

- **Rule the spec's §8 questions** before MI-2 (Q1, Q4), MI-4 (Q2), MI-6 (Q5), MI-7 (Q7) and MI-9 (Q3).
- **Deploy wave 2 to the server box before releasing wave 3** (§Gates).
- **Re-run the transcript audit** seven days after MI-10 deploys, against the bar Q6 sets.

## Rollback

- **MI-1, MI-2, MI-7, MI-8, MI-9:** `ccrc rollback`, fleet lane. An older client ignores `CCRC_API_STATUS` and prints the status line, so the opted-in parsers keep working. A rolled-back client lacks `mail inbox`. MI-10's floor then reads the fleet as below it, and the nudge goes back to the list form at the next send.
- **MI-3 to MI-6:** a revert, or `ccrc rollback`. An older server ignores `fetchedAt`, so fetched rows replay again (the safe direction), and answers `GET /api/mail/inbox` with the `:id` route's 400, which the client reports as "did not serve the inbox".
- **MI-10:** a revert. The nudge returns to today's text.
- **MI-11:** a revert. An inbox print then shows as a plain tool card, and a fetched envelope still shows as a mail card. Revert MI-10 first, so the default read path keeps its cards.

## Deviations found

- **D-6772** — Mail inbox and clean client output (this plan, spec 2026-10-24). One finding against the brief: it says the client prints `http NNN` on stdout. It does not. `ccd/ccrc-api` has printed it on stderr since its first commit (`main`'s tail, ≈:585). The defect is that the body ends with no newline and a session's shell tool shows both streams together, so the reader sees `}http 200` on one line. The design (spec §3.1) is written for what the code does.
- **D-TBD-api-status-optin** — (MI-1) The two in-tree status parsers, `_apr_call` and `_inst_approval_key`, run the client with `CCRC_API_STATUS=line`. They land one release before the default changes.
- **D-TBD-api-clean-stdout** — (MI-2) stdout is the body plus exactly one newline. stderr is silent on a 2xx, says `ccrc-api: the server answered <code>` otherwise, and carries the bare `http <code>` line only under `CCRC_API_STATUS=line`. Exit codes are unchanged. The one stderr line on a 2xx is `mail fetch`'s local note (D-TBD-fetch-identity).
- **D-TBD-ackable-guard** — (MI-3) The ack door's guard is one named SQL fragment. `inboxFor` selects with it AND `OUTSTANDING_OR_ABANDONED_SQL` (joining `runs rr` as `outstandingMailFor` does), so the inbox prints only rows an ack can change and the mailbox still shows. A replay-ceiling park of a closed run is neither printed nor counted: the ack guard alone would print it as live mail (ruling I2(a)). `abandonedCount` is `outstandingMailFor`'s rows minus the inbox set.
- **D-TBD-fetched-at** — (MI-4) `mail_deliveries.fetchedAt` and `fetchedUuid` (migration 30), first stamp per uuid wins, through `writeDelivery`'s `'non-terminal'` guard. `sweepMail` skips the replay of a stamped row only while `fetchedUuid` is the registry's current uuid for `toId` (`uuidByToId`); on a mismatch (a `/clear`, a fork, a reused name, an absent recipient) it clears the stamp through `clearFetched` and the row replays as today. Compaction keeps the uuid and is the residual spec Q2 rules on. A stamped `delivered` row whose uuid still matches parks, with no nudge and no sender told, through the replay ceiling's own `rejectDelivery(…, MAIL_REPLAY_CEILING_ERROR)` once `MAX(ingestedAt, deliveredAt) + (MAIL_REPLAY_MAX_ATTEMPTS − replayCount) × MAIL_REPLAY_MS` has passed, so every `OUTSTANDING_STATES_SQL` holder (the peer quota and duplicate probes, `queueSystemMail`'s dedupe, the digest correction, `runHealth`) frees it when it frees today. `repointCoordinatorMail` clears the stamp. A printed delivery whose ack failed is not stamped, so it replays.
- **D-TBD-attributed-fetch** — (MI-5) `GET /api/mail/:id` stamps only when the query's pair passes `attributionVerdict` and names the recipient, and the stamp carries that verified uuid. The envelope is served in every case, and the answer carries the positive `fetch` marker.
- **D-TBD-inbox-route** — (MI-6) `GET /api/mail/inbox`: box token, attribution, the caller's inbox set (D-TBD-ackable-guard) oldest first, rendered from the stored envelope (with a `to:` line for the transcript card) and no `ack:` lines, in a `fenceFor` fence with the `ccrc-inbox` info string, masked, cut at `MAIL_INBOX_PAGE_MAX_BYTES` (20 KiB, at least one entry). The read writes nothing. Rejected: an ack on read in the server, and a client loop over list and fetch (spec §3.2, §7).
- **D-TBD-inbox-verb** — (MI-7) `ccrc-api mail inbox` derives identity from the pane and takes no argument. It prints each entry, and acks it only after the write succeeded, through the existing ack route: nothing is acked whose write failed. When fd 1 is a pipe or `/dev/null` it is show-only (prints, acks nothing, says to run it bare, first and last). The footer names every acked delivery. A redirect to a file still acks, a residual pinned by a test (spec §4). It reports each outcome on stdout, exits 0 when the read answered, and needs `jq` for this verb alone.
- **D-TBD-fetch-identity** — (MI-8) `mail fetch` inside a pane sends the pane's `fromId` and `fromUuid` through `try_derive_identity`, a derive that never refuses, so a recipient's fetch stamps. When the pane's identity cannot be derived it fetches unattributed, exactly as today, with one note on stderr. With no pane it fetches unattributed and silent. `derive_identity` is `try_derive_identity` plus today's refusal, so its callers do not change.
- **D-TBD-skills-inbox** — (MI-9) The worker, coordinator and reviewer skills, both references and the README teach `mail inbox` first, run bare (no pipe, no redirect, no `head` or `tail`), and keep list, fetch and ack as the fallback. The envelope's `ack:` lines and the hold card's `mail list` pointer are unchanged.
- **D-TBD-nudge-inbox** — (MI-10) The nudge names `mail inbox`, and says to run it bare, only when `fleetCarriesMailInbox` is true (`MAIL_INBOX_SINCE`, in `fleetCarriesRunsAttribution`'s shape), and lands only once the server serves MI-11's cards. The 24-character head is unchanged, and the park's own-nudge check accepts either form.
- **D-TBD-inbox-cards** — (MI-11) The PWA keeps its transcript mail cards for mail read through `mail inbox`: `parseInboxPrint` (L0, pure, a typed union) and a second `tool_result` arm in `buildChatItems`, under the fetch arm's two guards, one `mail` item per well-formed entry. A forged fence inside a body, a cut print, a stray line outside the entries and a malformed entry give no card. `MailCard` takes `MailCardFields` (no mail id, D-41). The card asserts nothing about authenticity, as today.

### Decisions recorded while planning

- **An environment variable, not a flag, for the status line,** because an older client refuses an unknown flag and ignores an unknown variable.
- **The renderer reads the stored envelope,** not the mail row's columns, so the inbox shows what was queued.
- **The inbox route is a GET,** like `approvals show`: identity rides the query the client derives, and the read changes nothing.
- **`jq` is required by one verb only,** because every fleet box has it and byte-framed text in bash is fragile.

## Out of scope

- CI and PR polling, and sleep loops (spec §9, Q8).
- "Read, not acked" in `MailStrip` (spec §9).
- Retiring `mail list`, `fetch` and `ack`, or the envelope's `ack:` lines.

## Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`.

**rev 2 (2026-10-24), review round 2.** Review focus 1 now states the invariant the client can keep, "nothing is acked whose write failed", plus the measured pipe and `/dev/null` guard. MI-7 Step 0 measures fd 1 under the tool, the build adds show-only runs and the acked-delivery footer, and the non-deterministic "reader exits after one line" case is replaced by `>&-`, `/dev/full`, a FIFO whose reader has gone, a live FIFO, `/dev/null`, and a case that pins the redirect-to-file residual. MI-4 and MI-5 store `fetchedUuid` with the stamp, and the replay skip and the bound park hold only while it matches the registry, with red cases for a uuid rotation, a reused name and an absent recipient. MI-9 and MI-10 say to run the verb bare. MI-11 is new: the PWA renders inbox prints as mail cards, and MI-10 waits for it. Eleven decisions now, not ten.

**rev 1 (2026-10-24), review round 1.** The ten decisions are to be issued as one contiguous ledger block and defined above in the same commit that substitutes them; until then they read `D-TBD-<slug>` and `dtbd.test.ts` is red (§Gates). MI-3's inbox set is the ack guard AND the mailbox's read predicate, with a red case for a closed run's replay-ceiling park. MI-4 keeps the replay ceiling's lifetime for a stamped row (a no-nudge park), clears the stamp on a repoint, and gains red cases for the peer quota, the duplicate probe, `queueSystemMail`'s dedupe and the digest correction. MI-8 uses a non-refusing derive, so `mail fetch` never loses today's read, and its band moves from 1 to 2 because it now refactors the identity derivation.
