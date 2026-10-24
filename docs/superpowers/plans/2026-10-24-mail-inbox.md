# Mail inbox and clean client output — Implementation Plan

> **For agentic workers:** ten PRs, Tasks MI-1 to MI-10, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (**Routing** line). Band 1 is mechanical and may go to `handoff-run`. Band 2 is spec-able and may go to `handoff-run` when the weekly pace says so, with the orchestrator reviewing the diff. Band 3 is written and reviewed natively and never handed off. Workers do not edit §Deviations found.

**Spec:** `docs/superpowers/specs/2026-10-24-mail-inbox-design.md` (rev 0).

**Deviation:** D-6772, issued by the ledger for this work. Every further decision is written `D-TBD-<slug>` below, for the orchestrator to allocate before this plan's first task lands.

**Base:** `origin/main` `10813b401`. Anchors are `≈:` hints into that commit, and each names its function. Re-ground every anchor in Step 0.

**Deploy class.** MI-1, MI-2, MI-7, MI-8 and MI-9 are FLEET (`ccd/` files and skills, installed by `ccrc update`'s spine, agent lane first). MI-3 to MI-6 and MI-10 are SERVER. No task restarts a session, and each takes effect at the next ordinary release.

## Gates

- **The allocator.** Every `D-TBD-<slug>` in §Deviations found is replaced by an issued number before the first task's PR merges. `server/test/dtbd.test.ts` is red on this plan until then, by design.
- **Wave 3 waits for wave 2 on the server.** MI-7 and MI-9 teach a route the server must already serve. Release them only once the server box runs MI-6's release (`ccrc update --check` on the server, or `GET /api/updates`).
- **Wave 4 waits for wave 3 on the fleet.** MI-10 sets `MAIL_INBOX_SINCE` to the release tag MI-7 merged into. That tag is known only after MI-7's merge cuts its prerelease.
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

1. **Nothing is acked that was not printed.** The ack follows a print that succeeded, delivery by delivery. A failed print stops the loop.
2. **Nothing printed is hidden from replay unless it was acked.** Only an attributed recipient fetch stamps `fetchedAt`. The inbox read stamps nothing.
3. **The printed set is the ackable set.** One SQL fragment decides both, so no row can be printed forever and refused forever.
4. **Identity is the pane's.** No flag or body field selects another session. The server re-measures the pair with `attributionVerdict`.
5. **No skew wedges a reader.** The opt-in works with old and new clients. The nudge names `mail inbox` only when the fleet's client carries it.

## Tasks

Waves: **1** MI-1 and MI-2 (clean output, fleet), **2** MI-3 to MI-6 (the server half), **3** MI-7 to MI-9 (the client verb and the skills, fleet), **4** MI-10 (the nudge switch, server).

| Task | Band | Lane | Depends on |
|---|---|---|---|
| MI-1 status parsers opt in | 1 | FLEET | none |
| MI-2 clean stdout by default; skill prose | 2 | FLEET | MI-1 merged |
| MI-3 one ackable guard; `inboxFor` | 2 | SERVER | none |
| MI-4 `fetchedAt` and the replay predicate | 3 | SERVER | none |
| MI-5 attributed fetch stamps | 2 | SERVER | MI-4 |
| MI-6 inbox renderer, page and route | 3 | SERVER | MI-3 |
| MI-7 `ccrc-api mail inbox` | 3 | FLEET | MI-6 on the server box |
| MI-8 `mail fetch` sends identity | 1 | FLEET | MI-5 |
| MI-9 skills, references, README | 3 | FLEET (skills) | MI-7 |
| MI-10 the nudge switch | 3 | SERVER | MI-7's release tag |

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
- Modify `server/src/coord/store.ts`: hoist `writeDelivery`'s `'ack'` arm (≈:5373-5376, the negative form plus the replay-ceiling exception and its `MAIL_REPLAY_CEILING_ERROR` argument) into one named fragment, `ACKABLE_DELIVERY_SQL` with its argument list, next to `OUTSTANDING_STATES_SQL`. `writeDelivery` uses it unchanged.
- Add `CoordStore.inboxFor(toId)`: `SELECT id AS deliveryId, envelope FROM mail_deliveries WHERE toId = ? AND <ACKABLE_DELIVERY_SQL> ORDER BY id ASC`, plus `abandonedCount(toId)`: the rows `outstandingMailFor`'s predicate admits that `ACKABLE_DELIVERY_SQL` does not.
- Create `server/test/mail-inbox-store.test.ts`.
- Modify `server/test/single-definition.test.ts`: the fragment's SQL text appears once in `server/src`.

- [ ] **Step 0: Re-ground.** Read `markAcked` (≈:5678-5690) and its I2(b) docstring, and `OUTSTANDING_OR_ABANDONED_SQL`.
- [ ] **Step 1: Characterize (green on the old code, its own commit).** `mail-deliveries-writer.test.ts` already pins the ack guard's answers. Add any case it lacks for a `queued` row, a parked `queued` row, the replay-ceiling `rejected` row, a `run closed` park and an `acked` row, and run it green on `main` before hoisting.
- [ ] **Step 2: Red.**
  - "`inboxFor` returns a `queued`, a parked, a `delivered` and a replay-ceiling row, and not an `acked`, a `run closed` park or a park-ceiling rejection";
  - "it returns only the caller's rows (`toId`)";
  - "it returns them oldest first";
  - "for every fixture row, `inboxFor` includes it if and only if `markAcked` changes it" (the property that ties the two);
  - "`abandonedCount` counts the park-ceiling rejection and nothing `inboxFor` returns".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `inboxFor` uses `OUTSTANDING_OR_ABANDONED_SQL` | "if and only if `markAcked` changes it" |
  | the I2(b) exception dropped from the fragment | "a replay-ceiling row" and the characterization |
  | `ORDER BY id DESC` | "oldest first" |
  | the `toId` filter dropped | "only the caller's rows" |
  | a second copy of the fragment's text | `single-definition.test.ts` |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/mail-inbox-store.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-deliveries-writer.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task MI-4: `fetchedAt`, and the replay skips a fetched row (spec §3.6)

**Routing:** band 3. **Lane:** SERVER (L3, migration).

**Files:**
- Modify `server/src/coord/schema.ts`: migration 30, `ALTER TABLE mail_deliveries ADD COLUMN fetchedAt INTEGER` (≈:1765 is 29, the last today). Take the next free number if another migration lands first.
- Modify `server/src/coord/store.ts`: `markFetched(id, at): DeliveryWrite`, through `writeDelivery` with `'non-terminal'` and `fetchedAt = COALESCE(fetchedAt, ?)`. `dueDeliveries`' `delivered` arm (≈:5488-5510) gains `AND fetchedAt IS NULL`; the `queued` arm is unchanged.
- Modify `server/test/mail-hardening.test.ts` (the writer census names `markFetched`), `server/test/coord-db.test.ts` (the migration), and `server/test/mail-sweep.test.ts` (the replay cases near ≈:1027-1111).
- Modify `server/src/watch.ts`'s `MAIL_REPLAY_MS` docstring (≈:606-610) and `MAIL_REPLAY_MAX_ATTEMPTS`' (≈:668-677): a fetched row neither replays nor counts toward the ceiling.

- [ ] **Step 0: Re-ground.** Read `db.ts`'s migration loop and its rule for a higher `user_version`, `bumpReplayCount`, and `stallDeafMail` (`stall.ts` ≈:929-958).
- [ ] **Step 1: Red.**
  - "a `delivered`, unacked, stamped row is not due at `deliveredAt + MAIL_REPLAY_MS + 1`";
  - "the same row unstamped is due" (today's behaviour);
  - "a stamped `queued` row is still due for its first delivery";
  - "`markFetched` keeps the first stamp" (two calls, the first time stands);
  - "`markFetched` on an `acked` or `rejected` row changes nothing and answers `changed: false`";
  - "a stamped row's `replayCount` stops growing across ten replay intervals, and the row stays `delivered`";
  - "`stallDeafMail` still answers deaf at `COORD_DEAF_MS` for a stamped, unacked `wave-done`" (`stall-verdict.test.ts`);
  - "a database at 29 migrates to 30 with the column, and a server that knows 29 still reads a database at 30" (`coord-db.test.ts`'s existing rollback shape).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `AND fetchedAt IS NULL` dropped | "not due at `deliveredAt + MAIL_REPLAY_MS + 1`" |
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

### Task MI-5: an attributed fetch by the recipient stamps the row (spec §3.6)

**Routing:** band 2. **Lane:** SERVER (L4).

**Files:**
- Modify `server/src/coord/routes.ts`'s `GET /api/mail/:id` (≈:1250-1264): read optional `fromId` and `fromUuid` from the query. With both present, run `attributionVerdict(fromId, fromUuid, 'fromUuid')` (≈:643-672). Stamp with `markFetched` only when the verdict is `ok` and `row.toId === fromId`. Serve the envelope in every case, as today.
- Add the answer's `fetch` field: `'stamped'`, `'unattributed'` (no pair), `'not-yours'` (verdict ok, `toId` differs), or `'unmeasured'` (verdict `registry-unmeasurable`). A `stale-uuid` or `unknown-sender` verdict answers `'not-yours'` with its code in `fetchRefused`. In `shared/api.ts`: `MAIL_FETCH_MARKS` and its reader, `readMailFetchMark`, which reads an absent field as `'unattributed'`.
- Modify `server/test/mail-routes.test.ts`.

- [ ] **Step 0: Re-ground.** Read the ack route's ladder (≈:1059-1131), so the fetch uses the same verdict and not a copy of it.
- [ ] **Step 1: Red.**
  - "a fetch with the recipient's current pair stamps the row and answers `fetch: 'stamped'`";
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
- Modify `server/src/coord/envelope.ts`: `renderInboxEntry(deliveryId, storedEnvelope)`, pure. Parse with `parseMailEnvelope`. On `ok`, render `delivery:`, `from:`, `kind:`, `subject:`, `run:` (when set, in `renderEnvelope`'s `run:` shape), `artifacts:` (when any), `--` and the body, inside a fence from `fenceFor` with the info string. On `malformed` or `not-mail`, the stored text verbatim. Also `pageInbox(entries, budget)`, pure: it takes entries in order while the running byte total fits, always at least one, and answers `{page, remaining}`.
- Modify `server/src/coord/routes.ts`: `GET /api/mail/inbox`, registered with the mail routes: `requireMailToken`, `fromId`/`fromUuid` from the query (both strings, else 400 `bad-kind`), `requireAttribution(reply, fromId, fromUuid, 'fromUuid')`, then `inboxFor`, then render, mask (`maskDeep`, D-5513), page, `abandonedCount`, and the answer.
- Modify `server/src/auth/gate.ts`'s `EXEMPT` (≈:210-225): `GET /api/mail/inbox`, "a session reading and then acking its own mail: box-token gated and attribution-checked".
- Modify `server/test/box-token-census.test.ts` and `server/test/auth-gate.test.ts` for the new door.
- Create `server/test/mail-inbox-render.test.ts` and `server/test/mail-inbox-route.test.ts`.

- [ ] **Step 0: Re-ground.** Read `renderEnvelope`, `fenceFor`, `parseMailEnvelope`, `requireAttribution`, and the fetch route's masking.
- [ ] **Step 1: Red (renderer and page).**
  - "an entry shows `delivery`, `from`, `kind`, `subject`, `run` with program and wave, the artifacts and the body, and no `ack:` line";
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
  - `mail inbox`: refuse any argument (`unexpected-id`, `bad-args`); refuse `no-jq` without `jq`; `derive_identity`; read with the derived pair as the query; on a non-200, print the body and the "did not serve the inbox" line (spec §3.5 step 5) and exit 0; on a 200, check the shape with `jq` (a bad shape prints the body and acks nothing); then for each entry in order: `printf '%s\n'` the text, stop on a failed write, ack through the shared request function with the synthesized body, and print the outcome line; then the footer;
  - `usage`: the verb, and that its stdout is plain text.
- Modify `server/test/ccrc-api-closed.test.ts`: the body-fill census (≈:316) names the synthesized ack body; the row census and count word.
- Modify `server/test/ccrc-api.test.ts`, or create `server/test/ccrc-api-inbox.test.ts`, with its fake server (the existing `reply` harness, extended to answer per path).

- [ ] **Step 0: Re-ground.** Read `derive_identity`, the `approvals show` and `asks list` identity blocks (≈:528-543), `splice_body_field`, and the D-2724 comments.
- [ ] **Step 1: Red.**
  - "two entries are printed in order, each followed by `inbox: acked delivery <n>`, and the fake server saw two acks with the pane's `fromId` and `fromUuid`";
  - "each ack names the `deliveryId` from the answer";
  - "the ack for entry two is sent only after entry two's text was written" (the fake server records the order of reads and acks, and the client's stdout is a pipe the test reads as it goes);
  - "stdout closed before the first entry: no ack is sent" (run with `>&-`, and with a reader that exits after one line);
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
  | the write's status ignored | "stdout closed … no ack is sent" |
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

**Routing:** band 1. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccrc-api`: on `mail.fetch`, when `TMUX_PANE` is set, `derive_identity` and add `fromId` and `fromUuid` to the query. Without a pane, fetch unattributed, as today. A pane whose identity cannot be derived refuses, as `whoami` does: a caller inside a pane expects its fetch to count.
- Modify `server/test/ccrc-api.test.ts`.

- [ ] **Step 1: Red.** "inside a pane, `mail fetch 7` sends `fromId` and `fromUuid` from the pane"; "with no pane, it sends neither and still fetches"; "a bad `TMUX_PANE` refuses `bad-pane`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | identity never sent | "sends `fromId` and `fromUuid`" |
  | a missing pane refuses | "with no pane … still fetches" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts --maxWorkers=2

### Task MI-9: the skills, references and README teach `mail inbox` (spec §3.7)

**Routing:** band 3. **Lane:** FLEET (skills ship with the fleet install). Lands with or after MI-7.

**Files:**
- Modify `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:218-222) becomes one call, with the three calls kept as the fallback for an inbox the server does not serve. The pinned ack clause (`worker-skill.test.ts` ≈:60) says `mail inbox` acks what it printed, and that the 20 replays apply to a delivery nobody fetched.
- Modify `ccd/coordinator-skill/SKILL.md` clause 3 (≈:291-299) and its pin in `coordinator-skill.test.ts`.
- Modify `ccd/reviewer-skill/SKILL.md`'s ack clause and its pin (`reviewer-skill.test.ts` ≈:22).
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` §3 (≈:425-480) and `references/mail-envelope.md`: the inbox first, the old nudge quoted as the older form, and the fetch reader's ack unchanged.
- Modify `README.md`: the verb list (≈:3616) and its mail paragraphs.
- The executable-corpus parity in `ccrc-api-closed.test.ts` (≈:116) covers the new call.

- [ ] **Step 0: Re-ground.** Read every pinned clause the edit touches, and `install-coordinator-skill.test.ts`, which pins the shipped tree.
- [ ] **Step 1: Red.** Each changed clause's new text is pinned before the prose changes; "every skill that reads mail names `mail inbox`"; "no skill teaches the three calls as the first way"; "the corpora's `ccrc-api` calls all map to `ROUTES`" (the existing parity, which reds until MI-7's row exists).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | a clause left at its old text | its verbatim pin |
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
  - "the `'inbox'` form starts with the same 24 characters, names `~/.local/bin/ccrc-api mail inbox`, and names no route, no `curl -`, no `deliveryId` and no toId";
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
  | `isOwnNudge` accepts only the current form | "resumed by a park retry … (and the reverse)" |
  | the list form edited | "byte-identical to today's nudge" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/coord-envelope.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-mail-inbox.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/runs-attribution-switch.test.ts --maxWorkers=2

## Operator acts

None is needed to build or land a task. Each of these is the operator's:

- **Rule the spec's §8 questions** before MI-2 (Q1, Q4), MI-4 (Q2), MI-6 (Q5) and MI-9 (Q3).
- **Deploy wave 2 to the server box before releasing wave 3** (§Gates).
- **Re-run the transcript audit** seven days after MI-10 deploys, against the bar Q6 sets.

## Rollback

- **MI-1, MI-2, MI-7, MI-8, MI-9:** `ccrc rollback`, fleet lane. An older client ignores `CCRC_API_STATUS` and prints the status line, so the opted-in parsers keep working. A rolled-back client lacks `mail inbox`. MI-10's floor then reads the fleet as below it, and the nudge goes back to the list form at the next send.
- **MI-3 to MI-6:** a revert, or `ccrc rollback`. An older server ignores `fetchedAt`, so fetched rows replay again (the safe direction), and answers `GET /api/mail/inbox` with the `:id` route's 400, which the client reports as "did not serve the inbox".
- **MI-10:** a revert. The nudge returns to today's text.

## Deviations found

- **D-6772** — Mail inbox and clean client output (this plan, spec 2026-10-24). One finding against the brief: it says the client prints `http NNN` on stdout. It does not. `ccd/ccrc-api` has printed it on stderr since its first commit (`main`'s tail, ≈:585). The defect is that the body ends with no newline and a session's shell tool shows both streams together, so the reader sees `}http 200` on one line. The design (spec §3.1) is written for what the code does.
- **D-TBD-api-status-optin** — (MI-1) The two in-tree status parsers, `_apr_call` and `_inst_approval_key`, run the client with `CCRC_API_STATUS=line`. They land one release before the default changes.
- **D-TBD-api-clean-stdout** — (MI-2) stdout is the body plus exactly one newline. stderr is silent on a 2xx, says `ccrc-api: the server answered <code>` otherwise, and carries the bare `http <code>` line only under `CCRC_API_STATUS=line`. Exit codes are unchanged.
- **D-TBD-ackable-guard** — (MI-3) The ack door's guard is one named SQL fragment, and `inboxFor` selects with it, so the inbox prints exactly the rows an ack can change. Abandoned rows the ack refuses are counted, not shown.
- **D-TBD-fetched-at** — (MI-4) `mail_deliveries.fetchedAt` (migration 30), first stamp wins, through `writeDelivery`'s `'non-terminal'` guard. The replay arm skips a stamped row, and a stamped row no longer counts toward `MAIL_REPLAY_MAX_ATTEMPTS`. A printed delivery whose ack failed is not stamped, so it replays.
- **D-TBD-attributed-fetch** — (MI-5) `GET /api/mail/:id` stamps only when the query's pair passes `attributionVerdict` and names the recipient. The envelope is served in every case, and the answer carries the positive `fetch` marker.
- **D-TBD-inbox-route** — (MI-6) `GET /api/mail/inbox`: box token, attribution, the caller's ackable rows oldest first, rendered from the stored envelope with no `ack:` lines, in a `fenceFor` fence with the `ccrc-inbox` info string, masked, cut at `MAIL_INBOX_PAGE_MAX_BYTES` (20 KiB, at least one entry). The read writes nothing. Rejected: an ack on read in the server, and a client loop over list and fetch (spec §3.2, §7).
- **D-TBD-inbox-verb** — (MI-7) `ccrc-api mail inbox` derives identity from the pane and takes no argument. It prints each entry, and acks it only after the write succeeded, through the existing ack route. It reports each outcome on stdout, exits 0 when the read answered, and needs `jq` for this verb alone.
- **D-TBD-fetch-identity** — (MI-8) `mail fetch` inside a pane sends the pane's `fromId` and `fromUuid`, so a recipient's fetch stamps. Without a pane it fetches unattributed, as before.
- **D-TBD-skills-inbox** — (MI-9) The worker, coordinator and reviewer skills, both references and the README teach `mail inbox` first, and keep list, fetch and ack as the fallback. The envelope's `ack:` lines and the hold card's `mail list` pointer are unchanged.
- **D-TBD-nudge-inbox** — (MI-10) The nudge names `mail inbox` only when `fleetCarriesMailInbox` is true (`MAIL_INBOX_SINCE`, in `fleetCarriesRunsAttribution`'s shape). The 24-character head is unchanged, and the park's own-nudge check accepts either form.

### Decisions recorded while planning

- **An environment variable, not a flag, for the status line,** because an older client refuses an unknown flag and ignores an unknown variable.
- **The renderer reads the stored envelope,** not the mail row's columns, so the inbox shows what was queued.
- **The inbox route is a GET,** like `approvals show`: identity rides the query the client derives, and the read changes nothing.
- **`jq` is required by one verb only,** because every fleet box has it and byte-framed text in bash is fragile.

## Out of scope

- CI and PR polling, and sleep loops (spec §9, Q7).
- "Read, not acked" in `MailStrip` (spec §9).
- Retiring `mail list`, `fetch` and `ack`, or the envelope's `ack:` lines.

## Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`.
