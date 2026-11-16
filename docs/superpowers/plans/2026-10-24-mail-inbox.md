# Mail inbox and clean client output — Implementation Plan

> **For agentic workers:** eight PRs, Tasks MI-1 to MI-8, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (**Routing** line). Band 1 is mechanical and may go to `handoff-run`. Band 2 is spec-able and may go to `handoff-run` when the weekly pace says so, with the orchestrator reviewing the diff. Band 3 is written and reviewed natively and never handed off. Workers do not edit §Deviations found.

**Spec:** `docs/superpowers/specs/2026-10-24-mail-inbox-design.md` (rev 3, re-scoped to the minimum).

**Deviation:** D-6772, issued by the ledger for this work. Every further decision carries a number the ledger issued for this plan, named on its task's **Deviation** line and defined in §Deviations found. Numbers the re-scope no longer needs are recorded there as unused.

**Base:** `origin/main` `7a3104abd`. Anchors are `≈:` hints into that commit, and each names its function. Re-ground every anchor in Step 0.

**Deploy class.** MI-1, MI-2, MI-3, MI-6 and MI-7 are FLEET (`ccd/` files and skills, installed by `ccrc update`'s spine, agent lane first). MI-4, MI-5 and MI-8 are SERVER. No task restarts a session, and each takes effect at the next ordinary release.

**Not in this plan** (spec §9): the fetched-at stamp, replay suppression and its bound park, `stampHolds`, the hibernated-wake skip, the attributed fetch and the PWA's inbox cards. No task here changes replay timing.

## Gates

Every gate is on a release being **installed**, never on a PR being merged (spec §3.1). "Installed" is read from the box's node row in `GET /api/updates` (the PWA's Updates screen) or from `ccrc update --check` on that box, and the PR's body records the release tag it read.

- **MI-2 waits for MI-1 installed on every box that hosts sessions** (the fleet box; on a `both` box, that box). The opt-in is harmless on an older client, so this gate keeps the rule one-directional rather than guarding a break.
- **MI-3 waits for MI-2 installed on every box that hosts sessions.** This is the gate that matters: the install writes the client before the hook (`ccd/ccrc#_inst_files` ≈:15739, after `_inst_bins`), and a box may skip a release, so only an installed opt-in keeps the quiet client away from a hook that never opted in.
- **MI-6 and MI-7 wait for MI-5 installed on the server box.** They teach a route the server must already serve.
- **MI-8 waits for MI-6's release tag to exist.** It sets `MAIL_INBOX_SINCE` to that tag, which is known only once MI-6's merge cuts its prerelease.
- **Open PRs.** Measure them in Step 0 of each task (`gh pr list --state open --json number,files`). The files this plan edits that other work also edits often are `ccd/session-hook.sh`, `ccd/ccrc`, `ccd/ccrc-api`, `server/src/watch.ts`, `server/src/coord/routes.ts`, `server/src/coord/store.ts` and `shared/api.ts`. Rebase past any open PR that holds them.

## Global constraints

- **Public repo.** Fixtures use neutral names (`project-a`, `lane-a`, `demo-ws`). Never write a host, an account or lane name, another project's name, an absolute home path or a private tracker id.
- **SAFETY.** FIXTURE HOMEs only (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). No test runs the client or a hook against a live `$HOME` or a live server. Nobody touches tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` out of band. No test prints the box token.
- **The closed client stays closed.** No URL, host, path or raw argument (`ccrc-api-closed.test.ts`). Every new request goes through `ROUTES` and the one request function.
- **Exit codes do not change** (spec §3.1, Q1). 0 = an answer, 2 = local refusal, 3 = no response.
- **One writer.** `mail_deliveries` is written only through `writeDeliveries` (D-5997). No task adds a writer.
- **Replay is untouched.** No task reads or writes the replay clock, `replayCount`, the replay ceiling or `wakeAdmit` (spec §3.6).
- **Wire: additive only.** No `FLEET_PROTO` bump, no migration.
- **Skill clauses are mechanisms.** A pinned clause and its test change in the same commit.
- **Tests:** `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time, in the foreground, from the package directory. Re-run a known load flake alone before calling it a break.
- **Commits:** a characterization commit (green on the old code) before any commit that moves existing behaviour (MI-4, MI-6).

## Review focus

1. **No skew strands a status-line caller.** The client keeps `http <code>` on by default until the callers' opt-in is installed. Check each PR against its installed-release gate, and that MI-3's default is the only step that removes the line.
2. **Nothing is acked whose write failed, and nothing is acked when fd 1 is a pipe or `/dev/null`.** The ack follows a write that succeeded, delivery by delivery, and a failed write stops the loop. Check that the show-only test runs before the read, that a bare run under the measured tool capture still acks, that the footer names every acked delivery, and that the redirect-to-file residual is pinned by a test named as the residual.
3. **One run, many requests.** Every ack carries the token, every temp file is removed, and a transport failure on one ack is reported and passed while a one-request row still exits 3.
4. **The printed set is the ackable set the mailbox still shows.** The inbox selects with the hoisted ack guard AND `OUTSTANDING_OR_ABANDONED_SQL`, so no row is printed forever and refused forever, and no closed run's replay-ceiling park is printed as live.
5. **Identity is the pane's.** No flag or body field selects another session. The server re-measures the pair on the read and on each ack.
6. **The read writes nothing.** No row changes and no `mail_rejections` row is written by the inbox route, on any answer.
7. **The nudge names `mail inbox` only when the fleet's client carries it.**

## Tasks

Waves: **1** MI-1, then MI-2, then MI-3 (clean output, fleet, each behind an installed-release gate). **2** MI-4 and MI-5 (the server half), independent of wave 1. **3** MI-6 and MI-7 (the client verb and the skills, fleet). **4** MI-8 (the nudge switch, server).

| Task | Band | Lane | Depends on |
|---|---|---|---|
| MI-1 the client's newline and `CCRC_API_STATUS` | 2 | FLEET | none |
| MI-2 the two status callers opt in | 1 | FLEET | MI-1 installed |
| MI-3 the quiet default; skill prose | 2 | FLEET | MI-2 installed |
| MI-4 one ackable guard; `inboxFor` | 2 | SERVER | none |
| MI-5 inbox renderer, page and route | 3 | SERVER | MI-4 |
| MI-6 `send_request` and `ccrc-api mail inbox` | 3 | FLEET | MI-5 installed on the server box |
| MI-7 skills, references, README | 3 | FLEET (skills) | MI-6 |
| MI-8 the nudge switch | 3 | SERVER | MI-6's release tag |

### Task MI-1: the client's newline and `CCRC_API_STATUS` (spec §3.1 step 1)

**Routing:** band 2. **Lane:** FLEET. **Deviation:** D-6774.

**Files:**
- Modify `ccd/ccrc-api#main`'s tail (≈:584-589): after `cat "$out"`, print `\n` unless the body is empty or already ends in one (`tail -c 1` into a test, no `$( )` around `refuse`). Then `printf 'http %s\n' "$code" >&2` exactly as today, whatever `CCRC_API_STATUS` says. Exit 0, as today.
- Modify `ccd/ccrc-api`'s header comment and `usage`: stdout is the body and one newline; `CCRC_API_STATUS=line` is the way to keep the status line, which a later release stops writing by default.
- Modify `server/test/ccrc-api.test.ts`: the cases that compare stdout with the body byte for byte take the newline.

- [ ] **Step 0: Re-ground.** Read `main`'s tail and the D-2724 comments around `server_url` and `read_token`: nothing may move a `refuse` into a `$( )`. Grep the tests for exact-stdout assertions.
- [ ] **Step 1: Red.**
  - "a 2xx body with no trailing newline is printed with exactly one";
  - "a body that already ends in a newline gets no second one";
  - "an empty body prints nothing on stdout";
  - "stdout parses as JSON with no cleanup, for a 200 and for a 409";
  - "stderr's last line is `http 200` on a 200 and `http 409` on a 409, with and without `CCRC_API_STATUS=line`" (the default is unchanged);
  - "a stub hook's `${out##*http }` and `${out%http *}` parse still yields the code and a body `jq` reads" (`_apr_call`'s exact parse, run against the new client's merged output);
  - "the transport failure is unchanged: exit 3 and the transport envelope";
  - "the token appears on neither stream, on any path" (the existing case).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the newline never added | "printed with exactly one" |
  | the newline added unconditionally | "gets no second one" |
  | the status line dropped without the variable | "with and without `CCRC_API_STATUS=line`" |
  | the newline written after the status line, on stderr | "stdout parses as JSON" |
  | `exit 1` on a non-2xx | "for a 409" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-approval-key.test.ts --maxWorkers=2
      bash -n ccd/ccrc-api

### Task MI-2: the two status callers opt in (spec §3.1 step 2, §1.3)

**Routing:** band 1. **Lane:** FLEET. **Deviation:** D-6775. **Gate:** MI-1's release installed on every box that hosts sessions (§Gates).

**Files:**
- Modify `ccd/session-hook.sh#_apr_call` (≈:5062-5070): run the client as `CCRC_API_STATUS=line "$apr_api" "$@" 2>&1`. The parse is unchanged. The function's comment names the variable and why.
- Modify `ccd/ccrc#_inst_approval_key` (≈:15765-15775): the same prefix on `"$api" approvals key`.
- Modify `server/test/session-hook-approval-wait.test.ts` and `server/test/ccrc-approval-key.test.ts`: the stub client records its environment.

- [ ] **Step 0: Re-ground and check the gate.** Read the installed release on the fleet node and record its tag in the PR body. Find both call sites by symbol. Confirm with `grep -rn 'http \*\|##\*http' ccd/ deploy/` that no third parser exists. If one does, it joins this task.
- [ ] **Step 1: Red.** "the approval hook runs the client with `CCRC_API_STATUS=line`"; "the install's key pin runs it with `CCRC_API_STATUS=line`"; "a stub that prints `http 201` only when the variable is set still yields `APR_CODE` 201" (the variable reaches the client through the substitution); "a stub that prints `http 201` whatever the variable says yields 201 too" (an older client).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the prefix dropped from `_apr_call` | "the approval hook runs the client with `CCRC_API_STATUS=line`" and the variable-only 201 case |
  | the prefix dropped from `_inst_approval_key` | "the install's key pin runs it …" |
  | the variable misspelled (`CCRC_API_STATUSES`) | the variable-only 201 case |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-approval-key.test.ts --maxWorkers=2
      bash -n ccd/session-hook.sh && bash -n ccd/ccrc

### Task MI-3: the quiet default (spec §3.1 step 3)

**Routing:** band 2. **Lane:** FLEET. **Deviation:** D-6776. **Gate:** MI-2's release installed on every box that hosts sessions (§Gates).

**Files:**
- Modify `ccd/ccrc-api#main`'s tail: with `CCRC_API_STATUS=line`, `printf 'http %s\n' "$code" >&2` exactly as today; otherwise nothing on stderr for a 2xx, and `ccrc-api: the server answered <code>` for any other code (spec Q2). Exit 0 in every case.
- Modify `ccd/ccrc-api`'s header comment and `usage`.
- Modify `server/test/ccrc-api.test.ts`: the five `^http NNN$` cases (≈:349, ≈:360, ≈:372, ≈:384, ≈:954) run with the variable set; new cases pin the default.
- Modify `ccd/coordinator-skill/SKILL.md` (≈:142-156), `ccd/worker-skill/SKILL.md` (≈:198-212) and `ccd/reviewer-skill/SKILL.md` (≈:143): stdout is the body and only the body; the status is not printed on success; the exit-code contract is unchanged. Update the tests that pin these paragraphs (`coordinator-skill.test.ts` ≈:1565-1572 and its neighbours).
- Modify `README.md`'s `ccrc-api` section (≈:3610-3625).

- [ ] **Step 0: Re-ground and check the gate.** Read the installed release on the fleet node and record its tag in the PR body. Re-run MI-2's grep: a caller that parses the line and has not opted in blocks this task.
- [ ] **Step 1: Red.**
  - "a 2xx answer writes nothing to stderr";
  - "a 409 answer writes `ccrc-api: the server answered 409` to stderr and exits 0, with the body on stdout";
  - "with `CCRC_API_STATUS=line`, stderr's last line is `http 200` on a 200 and `http 409` on a 409, and nothing else is on stderr";
  - "the opted-in hook still reads 201 from this client" (MI-2's stub test, run against the real client);
  - "the transport failure is unchanged" and "the token appears on neither stream" (the existing cases, re-run under both modes).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `http <code>` printed in the default mode | "a 2xx answer writes nothing to stderr" |
  | the opt-in ignored | "with `CCRC_API_STATUS=line` …" and "the opted-in hook still reads 201" |
  | the human line printed in `line` mode as well | "and nothing else is on stderr" |
  | `exit 1` on a non-2xx | "exits 0, with the body on stdout" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-approval-key.test.ts --maxWorkers=2

### Task MI-4: one ackable guard, and `inboxFor` (spec §3.3 step 3, §1.5)

**Routing:** band 2. **Lane:** SERVER (L3). **Deviation:** D-6777.

**Files:**
- Modify `server/src/coord/store.ts`: hoist `writeDeliveries`' `'ack'` arm (≈:5373-5376, the negative form plus the replay-ceiling exception and its `MAIL_REPLAY_CEILING_ERROR` argument) into one named fragment next to `OUTSTANDING_STATES_SQL`. The write has no table alias and the read has `d`, so the fragment is one builder, `ackableDeliverySql(prefix)` (`''` for the write, `'d.'` for the read), with its argument list, and there is still one spelling. `writeDeliveries` uses it unchanged.
- Add `CoordStore.inboxFor(toId)`: `SELECT d.id AS deliveryId, d.envelope FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs rr ON rr.id = m.runId WHERE d.toId = ? AND <ackable guard> AND ${OUTSTANDING_OR_ABANDONED_SQL} ORDER BY d.id ASC`. The join is `outstandingMailFor`'s (≈:5152-5160), so `ABANDONED_PARK_SQL`'s `COALESCE(rr.state, '')` reads the same run.
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
  - "for every fixture row, `inboxFor` includes it only if `markAcked` changes it AND `outstandingMailFor` lists it", and "every row in that intersection is in `inboxFor`" (equality, so nothing ackable and shown is left behind);
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

### Task MI-5: the inbox renderer, its page and its route (spec §3.3, §3.4)

**Routing:** band 3. **Lane:** SERVER (L0, L1, L4). **Deviation:** D-6778 (the route), and D-6779 (its refusals are not recorded).

**Files:**
- Modify `shared/api.ts`: `MAIL_INBOX_PAGE_MAX_BYTES = 20 * 1024`, `MAIL_INBOX_FENCE_INFO = 'ccrc-inbox'`, the wire types `MailInboxEntry {deliveryId: number; text: string}` and `MailInboxAnswer {ok: true; deliveries: MailInboxEntry[]; remaining: number; abandoned: number}`, and `readMailInboxAnswer(x: unknown): MailInboxAnswer | null`.
- Modify `server/src/coord/envelope.ts`: `renderInboxEntry(deliveryId, storedEnvelope)`, pure. Parse with `parseMailEnvelope`. On `ok`, render `delivery:`, `from:`, `to:`, `kind:`, `subject:`, `run:` (when set, in `renderEnvelope`'s `run:` shape), `artifacts:` (when any), `--` and the body, inside a fence from `fenceFor` with the info string. On `malformed` or `not-mail`, the stored text verbatim. Also `pageInbox(entries, budget)`, pure: it takes entries in order while the running byte total fits, always at least one, and answers `{page, remaining}`.
- Modify `server/src/coord/routes.ts`: `GET /api/mail/inbox`, registered with the mail routes: `requireMailToken`, `fromId`/`fromUuid` from the query (both strings, else 400 `bad-kind` through `refuseRoute`), `requireAttribution(reply, fromId, fromUuid, 'fromUuid')`, then `inboxFor`, then render, mask (`maskDeep`, D-5513), page, `abandonedCount`, and the answer. Every refusal goes through `requireMailToken`, `requireAttribution` or `refuseRoute`, never the ingress's recording `refuse` (D-6779). The docstring says why (spec §3.3 step 2).
- Modify `server/src/auth/gate.ts`'s `EXEMPT` (≈:210-225): `GET /api/mail/inbox`, "a session reading its own mail before it acks it: box-token gated and attribution-checked".
- Modify `server/test/box-token-census.test.ts` and `server/test/auth-gate.test.ts` for the new door.
- Create `server/test/mail-inbox-render.test.ts` and `server/test/mail-inbox-route.test.ts`.

- [ ] **Step 0: Re-ground.** Read `renderEnvelope`, `fenceFor`, `parseMailEnvelope`, `requireAttribution`, `refuseRoute`, the ingress's recording `refuse`, and the fetch route's masking.
- [ ] **Step 1: Red (renderer and page).**
  - "an entry shows `delivery`, `from`, `to`, `kind`, `subject`, `run` with program and wave, the artifacts and the body, in that order, and no `ack:` line";
  - "an entry never shows the mail row's own id" (a fixture whose mail id differs from its delivery id);
  - "a body holding a run of six backticks gets a seven-backtick fence";
  - "a body holding a fake `delivery: 9` line stays inside the fence";
  - "a malformed stored envelope is printed verbatim";
  - "the info string is not `MAIL_ENVELOPE_FENCE`, and `parseFetchedMailEnvelope` answers `not-mail` on a rendered entry";
  - "`pageInbox` stops before the entry that would cross the budget and counts it in `remaining`";
  - "`pageInbox` always takes the first entry, even one over the budget".
- [ ] **Step 2: Red (route).**
  - "without the box token: 401 `unauthenticated`";
  - "with a stale uuid: 403 `stale-uuid`";
  - "with an unlistable registry: `registry-unmeasurable`";
  - "no refusal of the read writes a `mail_rejections` row" (the 401, a bad pair, `unknown-sender`, `stale-uuid` and `registry-unmeasurable`, with the table's row count before and after);
  - "the caller's two ackable deliveries come back oldest first, each with its `deliveryId`";
  - "another session's mail is never in the answer";
  - "a park-ceiling rejection is counted in `abandoned` and not returned";
  - "a replay-ceiling park whose run is closed is neither returned nor counted in `abandoned`";
  - "the text is masked" (a fixture secret shape in a body);
  - "the read changes no row" (every `mail_deliveries` column before and after);
  - "`GET /api/mail/inbox` is not answered by the `:id` route" (a 200 with the inbox shape, never a 400 `bad-request`).
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | the `ack:` lines kept | "no `ack:` line" |
  | `fenceFor` replaced by a fixed three-backtick fence | "a seven-backtick fence" |
  | the info string set to `MAIL_ENVELOPE_FENCE` | "`parseFetchedMailEnvelope` answers `not-mail`" |
  | a malformed envelope dropped | "printed verbatim" |
  | `pageInbox` may return an empty page | "always takes the first entry" |
  | `requireAttribution` skipped | "with a stale uuid: 403" |
  | the stale-uuid refusal sent through the recording `refuse` | "no refusal of the read writes a `mail_rejections` row" |
  | masking skipped | "the text is masked" |
  | the route bumps `attempts` | "the read changes no row" |
  | `EXEMPT` entry dropped | `auth-gate.test.ts` |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-inbox-render.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-inbox-route.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-envelope.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-envelope-parse.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task MI-6: `send_request` and `ccrc-api mail inbox` (spec §3.5)

**Routing:** band 3. **Lane:** FLEET. **Deviation:** D-6780. **Gate:** released only once the server box runs MI-5 (§Gates).

**Files:**
- Modify `ccd/ccrc-api`:
  - **`send_request method url body`**: the request block of `main` (≈:545-589: temp file use, curl with the token on stdin, the transport check) as one function. It sets `REQ_CODE`, leaves the body in the run's one temp file, and returns 0 for an answer and 3 for no response. It never exits, never clears `TOKEN` and never sets a trap.
  - **`main`** creates the one temp file and arms the one EXIT trap before the first request, calls `read_token` once, and clears `TOKEN` once, after the verb's last request. A one-request row turns a 3 into today's transport envelope, stderr line and `exit 3`, byte for byte. No `refuse` moves into a `$( )`.
  - a row `[mail.inbox]='GET|/api/mail/inbox|no|-'`; the header's and `ROUTES`' count word becomes thirty-two;
  - **`mail inbox`**: refuse any argument (`bad-args`); refuse `no-jq` without `jq`; `derive_identity`; decide show-only before the read (`[[ /dev/stdout -ef /dev/null ]] || [[ -p /dev/stdout ]]`, spec §3.5 step 2), and in a show-only run print the "nothing was acked; run it bare" line first and last and send no ack; read with the derived pair as the query; a 3 on the read is the transport envelope and `exit 3`; on a non-200, print the body and the "did not serve the inbox" line and exit 0; on a 200, check the shape with `jq` (a bad shape prints the body and acks nothing); then for each entry in order: `printf '%s\n'` the text, stop on a failed write, ack through `send_request` with the synthesized body, and print the outcome line (a 3 on an ack is `NOT acked (transport)`, and the loop goes on); then the footer, with the line naming every delivery this run acked;
  - `usage`: the verb, and that its stdout is plain text.
- Modify `server/test/ccrc-api-closed.test.ts`: the body-fill census (≈:316) names the synthesized ack body; the row census and count word.
- Create `server/test/ccrc-api-inbox.test.ts`, with its fake server (the existing `reply` harness, extended to answer per path and to record each request's headers).

- [ ] **Step 0: Re-ground and measure.** Read `derive_identity`, the `approvals show` and `asks list` identity blocks (≈:528-543), `splice_body_field`, the trap at ≈:558, the token clear at ≈:574, the transport exit at ≈:575-582, and the D-2724 comments. Then **measure what fd 1 is under the Claude Code Bash tool** in the implementing session, which runs on the fleet's own build: `[[ -p /dev/stdout ]]`, `[[ -f /dev/stdout ]]`, and `stat -L -c %i /dev/fd/1 /dev/fd/2` (`-f %i` on darwin), and record the result and `claude --version` in the PR body. Spec §1.2 measured one regular file shared with fd 2 (2.1.308, darwin). Also measure fd 1 under the test harness's `spawn` (expected: a socket, neither `-p` nor `-f`).
  - If fd 1 under the tool **is not a pipe**, build the show-only guard as written.
  - If it **is a pipe**, stop and report to the orchestrator before writing code: the guard would make every bare run show-only. Spec Q4 is the operator's ruling on this case.
  - If fd 1 under the harness's `spawn` is a pipe, the ack-path cases run with stdout on a temp file's descriptor instead, which is the tool's measured shape.
- [ ] **Step 1: Characterize (green on the old code, its own commit).** For a one-request row: "a transport failure prints the envelope, the stderr line and exits 3"; "the token rides curl's stdin"; "no temp file is left behind" (the harness's `TMPDIR` is empty after the run); "a refusal before the request leaves no temp file and sends nothing". Then extract `send_request` with these green.
- [ ] **Step 2: Red (one run, many requests).**
  - "every request of an inbox run carries the box token": the read and each of three acks (the fake server records the header on each request; the old one-shot block sends an empty token from the second request on);
  - "an inbox run of three acks leaves no temp file" (the old per-file trap would leave all but the last);
  - "a transport failure on ack 1 prints `NOT acked (transport)` for entry 1, still acks entry 2, and exits 0" (the fake server drops the first ack's connection);
  - "a transport failure on the read prints the transport envelope and exits 3, and sends no ack".
- [ ] **Step 3: Red (the verb).**
  - "two entries are printed in order, each followed by `inbox: acked delivery <n>`, and the fake server saw two acks with the pane's `fromId` and `fromUuid`";
  - "each ack names the `deliveryId` from the answer";
  - "the ack for entry two is sent only after entry two's text was written" (the fake server records the order of reads and acks, and the client's stdout is a temp file the test reads when each ack arrives);
  - "stdout closed (`>&-`): the first write fails with `EBADF`, no ack is sent, and the failure is named on stderr" (deterministic: the descriptor is closed before the client starts);
  - "stdout on `/dev/full`: the first write fails with `ENOSPC` and no ack is sent" (Linux only, skipped where `/dev/full` does not exist);
  - "stdout a FIFO whose reader has gone: no ack is sent" (the test makes the FIFO, opens its read end non-blocking, opens the write end for the client, and closes the read end before spawning, so the reader is gone before the first byte);
  - "stdout a FIFO with a live reader (the `| tail` shape): every entry is printed, no ack is sent, and the first and last lines are the `run … bare` line";
  - "stdout on `/dev/null`: no ack is sent";
  - "RESIDUAL (spec §4): stdout redirected to a regular file acks every entry it wrote, and the footer names each acked delivery" (the case's name says it pins the residual; it is the same shape as the tool's own capture);
  - "stdout and stderr on one regular file (the tool's measured shape): every entry is printed and acked, and nothing on that file breaks the entries' fences";
  - "an ack answered `stale-uuid` prints `NOT acked` and the loop goes on to the next entry";
  - "`already: true, parked: false` prints `was already acked`; `parked: true` prints `was closed before this ack` with `lastError`";
  - "`remaining: 3` prints the `run mail inbox again` line; `abandoned: 1` prints the `mail list --to` line";
  - "an empty inbox prints `inbox: no unacked mail` and sends no ack";
  - "a 400 `bad-request` on the read (an older server) prints the hint and sends no ack";
  - "no `TMUX_PANE` refuses `no-pane` and sends nothing";
  - "`mail inbox --to x` refuses `bad-args`";
  - "without `jq` on `PATH`: `no-jq`, and nothing is sent";
  - "the token appears on neither stream".
- [ ] **Step 4: Green.**
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `send_request` clears `TOKEN` | "every request of an inbox run carries the box token" |
  | `send_request` arms its own trap per request | "leaves no temp file" |
  | `send_request` exits 3 itself | "a transport failure on ack 1 … still acks entry 2, and exits 0" |
  | a one-request row ignores the 3 | the characterization's "exits 3" |
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
  | the `jq` check dropped | "`no-jq`, and nothing is sent" |

- [ ] **Step 6: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api-inbox.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts --maxWorkers=2
      bash -n ccd/ccrc-api

### Task MI-7: the skills, references and README teach `mail inbox` (spec §3.7)

**Routing:** band 3. **Lane:** FLEET (skills ship with the fleet install). **Deviation:** D-6781. Lands with or after MI-6.

**Files:**
- Every skill clause that names `mail inbox` says: run it bare, by its full path, with no pipe, no redirect and no `head` or `tail`; a piped run acks nothing; and the footer lists the deliveries it acked, for `mail fetch <delivery>` if their text did not reach you.
- Modify `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:219-223) becomes one call, with the three calls kept as the documented fallback for a server without the route. The pinned ack clause (`worker-skill.test.ts` ≈:60) says `mail inbox` acks what it printed.
- Modify `ccd/coordinator-skill/SKILL.md` clause 3 (≈:292-300) and its pin in `coordinator-skill.test.ts`.
- Modify `ccd/reviewer-skill/SKILL.md`'s ack clause and its pin (`reviewer-skill.test.ts` ≈:22).
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` §3 (≈:425-480) and `references/mail-envelope.md`: the inbox first, the old nudge quoted as the older form, and the fetch reader's ack unchanged.
- Modify `README.md`: the verb list (≈:3616) and its mail paragraphs.
- The executable-corpus parity in `ccrc-api-closed.test.ts` (≈:116) covers the new call.

- [ ] **Step 0: Re-ground.** Read every pinned clause the edit touches, and `install-coordinator-skill.test.ts`, which pins the shipped tree.
- [ ] **Step 1: Red.** Each changed clause's new text is pinned before the prose changes; "every skill that reads mail names `mail inbox`"; "every clause that names `mail inbox` says to run it bare (no pipe, no redirect, no `head` or `tail`)"; "no skill shows `mail inbox` followed by `|` or `>` in an example"; "no skill teaches the three calls as the first way"; "every skill that reads mail still names `mail list`, `fetch` and `ack` as the fallback"; "the corpora's `ccrc-api` calls all map to `ROUTES`" (the existing parity, which reds until MI-6's row exists).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | a clause left at its old text | its verbatim pin |
  | the run-it-bare sentence dropped from one skill | "every clause that names `mail inbox` says to run it bare" |
  | an example `mail inbox \| tail -n 40` added | "no skill shows `mail inbox` followed by `\|` or `>`" |
  | the fallback sentence dropped from one skill | "still names `mail list`, `fetch` and `ack` as the fallback" |
  | a skill calls a verb `ROUTES` lacks (`mail read`) | the corpus parity |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2

### Task MI-8: the nudge names `mail inbox` once the fleet carries it (spec §3.7)

**Routing:** band 3. **Lane:** SERVER. **Deviation:** D-6782. **Gate:** MI-6's release tag exists (§Gates).

**Files:**
- Modify `shared/api.ts`: `MAIL_INBOX_SINCE`, the release tag MI-6 merged into, beside `RUNS_ATTRIBUTION_SINCE` (≈:9501).
- Modify `server/src/fleetstate.ts`: `fleetCarriesMailInbox(role, own, fleet)`, in `fleetCarriesRunsAttribution`'s shape (≈:249-278), pure.
- Modify `server/src/coord/envelope.ts`: `renderMailNudge(toId, form: 'inbox' | 'list')`, with today's text as `'list'`, byte-identical, and the spec's inbox text. Both share the 24-character head. Add `isOwnNudge(box, toId)`, true for either form.
- Modify `server/src/watch.ts`: `sweepMail` chooses the form at send time from `fleetCarriesMailInbox` (≈:8064). The park's own-nudge test (≈:8052) uses `isOwnNudge`. Nothing about when a nudge is sent changes.
- Modify `server/test/coord-envelope.test.ts` (≈:160-200) and `server/test/mail-sweep.test.ts`; create `server/test/fleet-mail-inbox.test.ts` on `runs-attribution-switch.test.ts`'s model.

- [ ] **Step 0: Re-ground.** Read `renderMailNudge`'s docstring (D-738, D-791, the 24-character needle) and `sendPrompt`'s echo needle.
- [ ] **Step 1: Red.**
  - "`fleetCarriesMailInbox` is true on a `both` box, on agreed builds, and at or past the floor; false below it, on a tagless divergent build, and with no fleet stamp";
  - "the `'list'` form is byte-identical to today's nudge";
  - "the `'inbox'` form starts with the same 24 characters, names `~/.local/bin/ccrc-api mail inbox`, says `Run it bare: no pipe, no redirect, no head or tail`, and names no route, no `curl -`, no `deliveryId` and no toId";
  - "the sweep types the `'inbox'` form when the fleet carries it and the `'list'` form when it does not";
  - "a box holding the `'list'` form is resumed by a park retry while the sweep would type the `'inbox'` form" (and the reverse);
  - "a box holding other text is held with nothing pressed" (unchanged);
  - "the replay schedule is the same under both forms" (the existing replay cases, run with the fleet carrying the verb).
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

## Operator acts

None is needed to build or land a task. Each of these is the operator's:

- **Rule the spec's §8 questions** before MI-3 (Q1, Q2), MI-5 (Q3) and MI-6 (Q4).
- **Install MI-1's release on the fleet box before MI-2 merges, and MI-2's before MI-3 merges** (§Gates). An ordinary update does it.
- **Deploy MI-5 to the server box before releasing MI-6** (§Gates).
- **Re-run the transcript audit** seven days after MI-8 deploys.

## Rollback

- **MI-1, MI-2, MI-3, MI-6, MI-7:** `ccrc rollback`, fleet lane. A rollback reinstalls an older client and hook together. An older client writes the status line whatever `CCRC_API_STATUS` says, so an opted-in hook keeps parsing, and a hook from before MI-2 never meets a quiet client (spec §3.1). A rolled-back client lacks `mail inbox`. MI-8's floor then reads the fleet as below it, and the nudge goes back to the list form at the next send.
- **MI-4, MI-5:** a revert, or `ccrc rollback`. An older server answers `GET /api/mail/inbox` with the `:id` route's 400, which the client reports as "did not serve the inbox". No schema to undo.
- **MI-8:** a revert. The nudge returns to today's text.

## Deviations found

- **D-6772** — Mail inbox and clean client output (this plan, spec 2026-10-24, rev 3). One finding against the brief: it says the client prints `http NNN` on stdout. It does not. `ccd/ccrc-api` has printed it on stderr since its first commit (`main`'s tail, ≈:585). The defect is that the body ends with no newline and a session's shell tool shows both streams together, so the reader sees `}http 200` on one line. The design (spec §3.1) is written for what the code does. Re-scoped by orchestrator ruling to the minimum: clean output, `mail inbox`, and the nudge and the skills; everything that changes replay timing, and the inbox cards, is deferred (spec §9).
- **D-6774** — (MI-1) stdout is the body plus exactly one newline. The client recognizes `CCRC_API_STATUS`, and its default is unchanged: `http <code>` on stderr on every answer, so every existing caller keeps parsing. Exit codes are unchanged.
- **D-6775** — (MI-2) The two in-tree status callers, `_apr_call` and `_inst_approval_key`, run the client with `CCRC_API_STATUS=line`. Merged only once a release carrying D-6774 is installed on every box that hosts sessions, not once it is merged, so a caller moves only against a client the fleet already runs.
- **D-6776** — (MI-3) The default goes quiet: nothing on stderr for a 2xx, `ccrc-api: the server answered <code>` otherwise, and the bare `http <code>` line only under `CCRC_API_STATUS=line`. Merged only once a release carrying D-6775 is installed on every box that hosts sessions, because the install writes the client before the hook and a box may skip a release: a merge order would let a quiet client meet a hook that never opted in. Exit codes are unchanged.
- **D-6777** — (MI-4) The ack door's guard is one named SQL fragment. `inboxFor` selects with it AND `OUTSTANDING_OR_ABANDONED_SQL` (joining `runs rr` as `outstandingMailFor` does), so the inbox prints only rows an ack can change and the mailbox still shows. A replay-ceiling park of a closed run is neither printed nor counted: the ack guard alone would print it as live mail (ruling I2(a)). `abandonedCount` is `outstandingMailFor`'s rows minus the inbox set.
- **D-6778** — (MI-5) `GET /api/mail/inbox`: box token, attribution, the caller's inbox set (D-6777) oldest first, rendered from the stored envelope with no `ack:` lines, in a `fenceFor` fence with the `ccrc-inbox` info string, masked, cut at `MAIL_INBOX_PAGE_MAX_BYTES` (20 KiB, at least one entry). The read writes nothing. Rejected: an ack on read in the server, and a client loop over list and fetch (spec §3.2, §7).
- **D-6779** — (MI-5) The inbox read records no refusal in `mail_rejections`. Its gates answer through `requireMailToken`, `requireAttribution` and `refuseRoute`, as the other mail reads do. `mail_rejections` records refused mail, a refused read refuses none, and a stale uuid after every `/clear` would add a row per nudge. Every ack the client sends next is recorded by the ack route as today.
- **D-6780** — (MI-6) `ccrc-api` sends every request through one `send_request`, which never exits, never clears the token and never sets a trap; `main` owns the one temp file, the one EXIT trap and the one token clear, and a one-request row exits 3 on no response exactly as today. `ccrc-api mail inbox` derives identity from the pane and takes no argument. It prints each entry, and acks it only after the write succeeded, through the existing ack route with today's attribution: nothing is acked whose write failed. When fd 1 is a pipe or `/dev/null` it is show-only (prints, acks nothing, says to run it bare, first and last). The footer names every acked delivery. A redirect to a file still acks, a residual pinned by a test (spec §4). A transport failure on one ack is reported and passed. It exits 0 when the read answered and 3 when the read got no response, and needs `jq` for this verb alone.
- **D-6781** — (MI-7) The worker, coordinator and reviewer skills, both references and the README teach `mail inbox` first, run bare (no pipe, no redirect, no `head` or `tail`), and keep `mail list`, `fetch` and `ack` as the documented fallback. The envelope's `ack:` lines and the hold card's `mail list` pointer are unchanged.
- **D-6782** — (MI-8) The nudge names `mail inbox`, and says to run it bare, only when `fleetCarriesMailInbox` is true (`MAIL_INBOX_SINCE`, in `fleetCarriesRunsAttribution`'s shape). The 24-character head is unchanged, the park's own-nudge check accepts either form, and when a nudge is sent does not change.
- **D-6783** — unused (issued for this plan, not needed after the re-scope).

### Decisions recorded while planning

- **An environment variable, not a flag, for the status line,** because an older client refuses an unknown flag and ignores an unknown variable.
- **Every status-line step is gated on an installed release,** because the install writes the client before the hook and a box may skip a release (spec §3.1).
- **The renderer reads the stored envelope,** not the mail row's columns, so the inbox shows what was queued.
- **The inbox route is a GET,** like `approvals show`: identity rides the query the client derives, and the read changes nothing.
- **`jq` is required by one verb only,** because every fleet box has it and byte-framed text in bash is fragile.

## Later (not in this plan)

Spec §9 has the detail. None of these is built here, and each needs its own spec revision, review and issued numbers:

- the fetched-at stamp (`fetchedAt`, `fetchedUuid`, a migration), the attributed `mail fetch` that writes it, and `mail fetch`'s non-refusing identity derive;
- replay suppression for a stamped row, `stampHolds`, the stale-stamp clear, the repoint clear and the no-nudge bound park;
- the hibernated-wake skip;
- the PWA's inbox cards (`parseInboxPrint` and a second `tool_result` arm). Until they land, mail read through `mail inbox` shows in the transcript view as an ordinary tool card;
- "read, not acked" in `MailStrip`.

## Out of scope

- CI and PR polling, and sleep loops (spec §10).
- Retiring `mail list`, `fetch` and `ack`, or the envelope's `ack:` lines.

## Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`.

**rev 3 (2026-10-24), re-scoped to the minimum (orchestrator ruling).** Re-grounded on `origin/main` `7a3104abd`. Eight tasks, not eleven. Removed: the fetched-at stamp and replay predicate (rev 2's MI-4), the attributed fetch (MI-5), `mail fetch`'s identity (MI-8) and the inbox cards (MI-11), all now under §Later. The clean-output work is three tasks in a new order (client first with the line still on, then the callers once that release is installed, then the quiet default once theirs is), which fixes the reverse-order finding: rev 2 gated the quiet default on a merge, while the install writes the client before the hook and a box may skip a release. MI-5 decides that the inbox read records no refusal (D-6779). MI-6 fixes the one-shot request block the review found (the token cleared after one request, the EXIT trap re-armed per file, `exit 3` on the first transport failure) with `send_request`, a characterization commit and red cases for each. The ledger issued D-6774 to D-6783 for this plan; D-6783 is unused.

**rev 2 (2026-10-24), review round 2.** The invariant became "nothing is acked whose write failed", with the pipe and `/dev/null` guard, the acked-delivery footer and the residual pinned. The fetch stamp gained the uuid, and the PWA gained inbox cards (both now under §Later).

**rev 1 (2026-10-24), review round 1.** The inbox set became the ack guard AND the mailbox's read predicate, with a red case for a closed run's replay-ceiling park.
