# Session continuity wave 6b-2: nineteen departures and limits, recorded

The plan, `2026-11-12-session-continuity-wave6b-launch-record-and-manifest.md`, defines D-8361 to D-8380. Its second
run, 6b-2 (Tasks 2 to 5), shipped in #2735, merged 2026-11-13 at 21:14:43 UTC as `99dd85142`. The accepted PR head
was `4ab349ce65e36cc92795c0a0d4d4bb0d0f1cde39`: the reviewed `fe42050bb` plus one merge of `main`, resolving
only the three agreed inventory-comment lines. The coordinator allocated D-8566 to D-8584 at acceptance on
2026-11-13 and defines them here: twelve building departures, two parked limits, two fix-round limits, and three
last-round choices or limits. None sanctions a fourth fix round.

Reviews 1903, 1917 and 1929 preceded acceptance. Review 1929 was narrow, over rulings R10 to R14: three Opus/high
lenses ran through Agent, with no lens lost, but **zero refuters**. Its F1 was measured by two lenses; F2's behavioural
half and the nits were single-lens, unrefuted measurements. The reviewer independently re-ran the cut-key mutant
and found it green, and re-ran the named new mutation rows. The coverage limit stays part of the acceptance record;
this note does not turn those observations into a fully refuted panel.

The manifest remains shadow-only. These are as-built descriptions and carried limits, not permission to consume
`.inflight`, change a restart's acts or arm the live stop. 6c is the first planned runtime consumer and must settle
its reader contract before consuming the file. The instrument reads the manifest's swap-log counts, not the file.

- **D-8566 (2026-11-13)** — `release-single-arm` (Task 3): the writer has one explicit slot release after the slot
  arm, which every ordinary way out of that arm passes, instead of one release per branch. IF-RELEASE removes it;
  the test's in-subshell probe then reads `SLOT-HELD` on each exercised arm. This is a test of the explicit release,
  not a claim that a killed shell executes it.
- **D-8567 (2026-11-13)** — `record-write-failure-by-stub` (Task 3): a directory at `.deleg` makes the program return
  rc 4 (`why=error`) before the compacted-record write. The write-failure test therefore stubs `_reg_set` for
  `deleg`, rather than using that directory to force a write failure it cannot reach.
- **D-8568 (2026-11-13)** — `holder-in-snippet` (Task 3 tests): lock holders are descriptors opened inside the test's
  shell snippet, rather than separate `flock` processes killed in `afterEach`. The holders and the release probe
  remain inside the fixture.
- **D-8569 (2026-11-13)** — `inflight-file-lf` (Task 3): a successful measured write ends the header and every item
  line in LF, including a `none` or `unread` result with no item lines. The fallback/header-only write for
  `unmeasured` or `not-applicable` has no final LF, because `_reg_set` uses `printf '%s'`. 6c's reader must accept both;
  absence of a final LF alone does not make a header-only manifest torn.
- **D-8570 (2026-11-13)** — `no-deleg-create` (Task 3): the writer writes the compacted launch record only when
  `.deleg` exists. A session with no launches gets no newly created empty record.
- **D-8571 (2026-11-13)** — `swap-log-from-empty` (Task 3): when swap.log cannot be sized before the carry, the writer
  passes no log (`-`) to the program, rather than inventing an offset. The review found that the absent-log case
  cannot supply a diverged line from an earlier carry: such a carry creates the log. This does not claim that a
  genuinely unreadable log was measured.
- **D-8572 (2026-11-13)** — `limit-banner-literal-pin-follows-lb-ratelimit` (Task 2): the literal pin in
  `server/test/ccd-limit-banner.test.ts`, outside the plan's Files list and claimed for the edit, now reads the shared
  `def lb_ratelimit:` line. The shared definition remains the source of the error literal, not a second copy.
- **D-8573 (2026-11-13)** — `unread-expired-not-retired` (Task 2): expired unread items count once each in
  `unread-expired`; their removed rows are not also added to `retired`. Their removal is not evidence that their work
  finished.
- **D-8574 (2026-11-13)** — `item-line-carries-agent` (Tasks 2 and 3): an item line carries `agent=` between `task=`
  and `script=`, as the interface says. The plan's test example omitted the field; the output did not.
- **D-8575 (2026-11-13)** — `s3-precedence-not-restarted-over-refused` (Task 4): a restart with both a failed dispatch
  and a refusal counts in `not_restarted` only. The precedence is pinned; the two counters are not additive for that
  event.
- **D-8576 (2026-11-13)** — `inflight-gen-under-compaction-lock` (Task 3; the first fast run): `_inflight_write` reads
  the generation under the row's compaction lock, using `_compact_lock_acquire` with wait 0 around the read alone,
  before taking its own manifest slot. A refused acquire leaves `gen=-`; it does not block or nest the locks. An
  absent generation file is checked with builtins first and takes no lock and no fork, preserving the gone exit's
  tick-budget path. IF-GENLOCK and IF-GENABSENT pin both. This adds the ninth ccd acquire site; the consented hook
  comment and compaction-card spec count it, and say it reads the acquire as a boolean and continues silently on
  refusal, unlike the sites that read the reason value.
- **D-8577 (2026-11-13)** — `unread-sidecar-and-unlistable` (Task 2; the worker's whole-branch review): an unread
  sidecar-only run counts in `unread`; an unlistable directory is unread, not empty. Within the program, each
  unlistable `subagents/workflows` base or `projects/` listing contributes one unread. The writer normally detects an
  unlistable `projects/` first and records `unmeasured why=error` without running the program. Deeply nested JSON does
  not cause a traceback: a record line is invalid, a summary is unparseable, and a journal line follows the existing
  parse-failure/head-search fallback. The conservative base count's age limit is the separate D-8578.
- **D-8578 (2026-11-13)** — `unlistable-base-unread-no-age-limit` (parked at acceptance): the conservative unread
  count for an unlistable base has no age limit. The program cannot date the entries it cannot list, so the count
  can persist past the recent or abandon windows. It is not evidence of a recently launched item. 6c must preserve
  that distinction when deciding what to tell a resumed session.
- **D-8579 (2026-11-13)** — `fifo-journal-admits-other-sidecar-journal` (parked at acceptance): a recent FIFO journal
  in one sidecar can admit another sidecar's old journal for the same run. The FIFO is not read; the limitation is
  in admission by recency across copies, not a blocking FIFO open. A listed old journal is not proof that it changed
  inside the recent window.
- **D-8580 (2026-11-13)** — `priced-read-growth-by-harness` (fix round 1, R4): growth between the size used for pricing
  and the read is driven through an extracted-helper harness. This pins the read bound but is not an end-to-end
  timing test of a concurrently growing file. Fix round 2 additionally bounds the record by its price and the tail
  by the smallest of its fresh size, tail bound and price.
- **D-8581 (2026-11-13)** — `agent-id-outside-grammar-unread` (fix round 1, R3): a finished workflow's latest attempt
  whose agent id is outside the Claude-side id grammar is unread. It does not become evidence that the agent
  finished. The separate ccd session-id grammar allows dots after the first character and up to 128 characters;
  widening it did not widen the Claude-side grammar.
- **D-8582 (2026-11-13)** — `record-overflow-from-what-was-read` (fix round 2, R10; review 1929 N1 and N3): the record
  read has both `cap=RECORD_MAX` and `limit=price`, and overflow is judged after reading. A prefix ending exactly at
  LF with bytes left counts one `drop-budget`: unread bytes contain at least one unjudged row even though the last
  kept row is whole. The reviewer found that choice correct. Two harmless limits remain: the earlier
  `record_size > RECORD_MAX` term can count one false `drop-budget` if the file shrank below the cap after `lstat`,
  and `cap=RECORD_MAX` is redundant beside `limit=price`. MP-RECORDMAX removes both bounds; removing the cap alone
  stays green. The plan's mutation-row wording is corrected with this note.
- **D-8583 (2026-11-13)** — `priced-read-scan-five-sites` (review 1929 F1): all five current reads are bounded by
  their price; no current unpriced read was found. The scan is a weaker future guard than its intent: for an
  unlisted first argument and no `limit`, `kw.get('limit')` and `expect.get(first)` are both `None`, so the call
  passes. It does not assert that all five expected sites were seen, and replacement by `open().read()` evades it.
  The pricing proof checks source substrings, not the relevant assignment nodes; deleting either tail's
  `total +=` statement, or leaving a required string in a comment, can pass. The 6c plan must tighten the scan
  before any runtime consumer relies on the manifest's bounded-reader contract.
- **D-8584 (2026-11-13)** — `tail-cut-at-line-boundary` (review 1929 F2 and N2): a tail window whose offset is positive
  discards its first line even when the offset is exactly a line boundary. A whole good line can be lost, reading
  `unread` rather than `stopped-agent`; this is on the conservative side. That behavioural measurement was
  single-lens and unrefuted. The cut-key gap was independently measured by the reviewer: changing `off0 > 0` back to
  `size > tail` leaves all 45 tests green. MP-TAILPRICE's fixture begins on a line boundary despite its comment
  saying partial line. The 6c plan must add a distinguishing `size <= tail, limit < size` case and decide whether
  to peek at `off0 - 1`: that costs one byte beyond the current price and cannot be introduced silently.

## Carried beyond these nineteen entries

- A SendMessage restart of a cut-short agent is retired if its send row joins no agent row. Review 1903 D1 found
  the behaviour real but ruled by the plan, D-8373 and D-8402, not a new defect. 6c must decide the restart's identity
  and delivery treatment; 6b has not measured that identity contract.
- A FIFO at swap.log blocks `measure-continuity.py` (pre-existing, outside D-8353's unreadable-file cases). The
  instrument's next hardening must not describe this as an unreadable-file fix already shipped.
- Before the live stop can be armed, measure the `KillMode=process` revival-manifest overlap and the server's swap
  deadline with the added manifest time. The review left both unverified; no timing safety is implied by passing
  fixture tests or a green fast run. The inherited 6a live-arm prerequisites remain in the programme ledger.
