# Overlord W1 ccd arms, PR C2: notes for the ledger

PR C2 builds Task 7 of [`w1-ccd-arms.md`](../w1-ccd-arms.md): step 3 and `stay` in the fresh pick, `_fresh_pick_settle`,
and the pick wired into `ccd hibernate --roll --fresh`. It also carries the account organization plan's K1, review 2336's
F1, F3 and F4, and designation review 2349's F10 (the capability word). These notes are what the programme ledger should
learn from it. Each departure carries a plain-words slug (cross-plan ruling X9); none has a D-number.

## In short

- The fresh start asks the pick last in its re-measure, after the attached check. A row with no `acctorder` keeps its
  account, so no fresh start changes until the designation writes the list. A pick that finds nothing refuses exit 3
  `ccd: session-busy: unplaced — <cause>; nothing was touched`, which the renewal act's adapter already maps to `refused`.
- A move writes `wrapper` before `.fresh` and the uuid in one chain. Exits 4 and 7 put the old `wrapper` back, then the old
  uuid (exit 7 only while `wrapper` still reads the pick); exit 5 lets the account follow the uuid. Each put-back is logged. Only the proven tail records the move: one `swap` row (`dec.reason
  fresh-pick`) and `cmd_swap`'s side effects for an automatic move, never `home`, `lastswap` or a pin. W1a's receipt shape
  (`used <uuid>`) is unchanged.
- K1: a step 3 tie goes first to another account in the current account's organization, then to the earlier listed. The
  rule is `_swap_target`'s own `_org_tie`, called from the pick, and the current account is never `same` to itself, so an
  unlabelled current account gives no preference (review 2360 F1 and F5, §6).
- `ccd caps` says `fresh-pick-v1` (designation review 2349 F10), so a fleet box below C2 makes the designation refuse
  `capability-missing`.
- Account switching and the auto-swap are untouched for every session: nothing here runs outside `--roll --fresh`, and
  inside it nothing changes without `acctorder`.

## 1. Growth, measured

Measured with `growthCheck.ts`'s own counting (`codeLines`) against the merge base `88ac9cc64`, and with
`GROWTH_CHECK=1` `growth-check.test.ts` (green).

| File | Net code lines | Brief's estimate |
|---|---|---|
| `ccd/lib/long-lived.sh` | +16 (+17 before fix round 1) | +19 to +24, plus K1's +3, less F3's savings |
| `ccd/ccd` | +4 | +4 to +6 |
| `ccd (program)` | +20 (+21 before fix round 1) | within 40 |

*Table 1. Every row is at 40 or under, with no waiver. F3's move saved 5 lines of the library; fix round 1 saved one more
(the tie's inline organization reads became one call of `_org_tie`).*

## 2. Step 1: can `_wake_ceiling_move` fire on a fresh start's wake?

**Yes, measured.** A characterization case (green on `main` before any C2 code) runs the REAL `_wake_ceiling_move`, not the
W1a R2 row's stub: the session's account reads 99% and another account has measured room. The wake dispatches the move
(`wake-rescue <id>: claude (ceiling five=99 seven=99) -> claude-a`), spawns nothing and writes no receipt, so the verb
answers exit 7 with the old uuid back, and (after C2) the old `wrapper` back. The pick's `_avail` keeps an at-ceiling account
out, so on a picked account this can happen only when its load rose in the seconds between the re-measure and the wake. The
dispatched swap is the hard-limit rescue C57 keeps. It runs detached, so its order against the exit 7 put-back is not
serialised, as W1a's exit-7 comment already says of a concurrent wake.

## 3. Departures, by slug

| Slug | What and why |
|---|---|
| `field-reads-refuse-an-unsearchable-registry` | F3's shared reader (`_fresh_pick_field_to`) answers rc 2 for a registry it cannot search (review 2336 F2). Moving `_keep_awake_ours` and `_role_long_lived` onto it changes one answer each, made in its own commit before the move: `_keep_awake_ours` reads such an entry `unreadable` (so `keep-awake off` keeps and exits 1, where it answered `released` over markers it could not see) and `_role_long_lived` reads it undecidable (long-lived, fail-safe), where both read it absent. The move commit changes no test. |
| `field-reader-locals-are-underscored` | `_fresh_pick_field_to`'s own locals are `__ff` and `__fv`, so a caller's out-var named `f` or `v` is not shadowed (the first move attempt shadowed `_keep_awake_ours`'s `v` and reddened 25 keep-awake cases). |
| `fresh-pick-step-3-in-the-one-pass` | Step 3 is gathered in C1's one pass: each account with a measured load is asked the class gate (unless the hold holds), else the fallback's, and kept by `_fresh_pick_least_to` in one of two tiers. Step 1 still returns at once, and step 2's first account still wins over every step 3 account. C1 asked the fallback's gate only until step 2's first account; C2 asks it of every later account too, for step 3. |
| `fresh-pick-load-clause-means-unmeasured` | After C2 the clause word `load` means "no measured load figure". An account over the soft line that serves neither class reads `class`. |
| `fresh-pick-stay-asks-the-gate-with-no-class` | The plan says that with no class `stay`'s gate is skipped. `stay` asks `_class_gate <cur> "" <id>` instead, as C1's step 1 does (slug `fresh-pick-no-class-gate-asks-with-the-id`): it answers servable except for a set side whose account has no continuity record (serviceability A's F8). |
| `fresh-pick-stay-ignores-the-hold` | `stay` reads no hold-down, as the plan's `stay` text says: staying keeps the current account, and the settle's own hold-down still composes the class at the spawn. |
| `fresh-pick-empty-current-refuses` | With a list standing, an empty current account (`wrapper` absent or unreadable) refuses `unplaced` with its own sentence (`the session's account on <path> cannot be read`), inside the decider, so a row with no list keeps today's behaviour and the put-backs never write an empty `wrapper`. |
| `fresh-pick-wrapper-read-is-the-verbs-reader` | `cmd_hibernate` reads `wrapper` with `_reg_get_to`, the reader it already uses for `uuid` and `lastswap` (a regular file that is not a link; not time-bounded). The decider's own reads stay bounded. |
| `fresh-pick-log-line-names-the-move-only-when-it-moves` | The fresh start's first log line keeps W1a's exact bytes when no list stands or a step picks the current account (W1a's suite pins them with the newline). It gains `, account <cur> -> <pick>` on a move and `, stay on <cur>` on a `stay` (question 6's "logged `stay`", review 2360 F6). |
| `fresh-pick-swap-row-carries-org` | The settle's `swap` row carries `meas.org`, the relation of the two accounts (`_org_rel`), as `cmd_swap`'s rows do, so a reader of swap rows sees one shape. |
| `fresh-pick-pin-cleared-unconditionally` | The settle removes `swappin`, `swappinnote` and `swappinexp` with one `rm -f`, which is the automatic path's rule without its `-e` guard (same effect). |
| `fresh-pick-settle-log-line` | The settle writes one `swap.log` line, `fresh-pick <id>: <cur> -> <pick> step=<n>`. |
| `fresh-pick-put-back-account-first` | Exits 7 and 4 write the old `wrapper` back before the old uuid, so the registry never names the old conversation under the new account, even for the moment between the two writes. Both cases pin the order through the write hook (review 2360 F3). |
| `fresh-pick-exit-7-keeps-a-wrapper-written-since` | Exit 7 writes the old `wrapper` back only while `wrapper` still reads the pick, as exit 5 does for the uuid, so a detached `_wake_ceiling_move` swap that wrote it first stands (review 2360 F8). |
| `fresh-pick-put-back-is-logged` | Exits 4, 5 and 7 add `, account back to <cur>` to their `swap.log` line when they write the old `wrapper` back; exit 7 says `, account kept at <wrapper>` when it leaves it, and exit 4 `, account <pick> not put back` when its write fails (review 2360 F6). |
| `org-tie-skips-the-current-account` | `_org_tie` (ccd/ccd) never lets the current account win a tie by organization and never counts it as `same` when it holds the best place (review 2360 F1). `_swap_target` never offers the current account as a candidate, so its picks are unchanged; the fresh pick's list may hold it. `_fresh_pick_least_to` calls `_org_tie`, the one writer of the tie rule, over its own `cur` and label table (review 2360 F5), so no departure `fresh-pick-tie-is-not-org-tie` is needed. |
| `fresh-pick-exit-5-follows-a-readable-uuid` | Exit 5 writes the old `wrapper` back only when the uuid reads the old one. A uuid that cannot be read keeps the new account, as the plan's "the account follows the uuid" reads for a uuid that does not read the old one. |
| `fresh-pick-concurrent-wake-residual` | A concurrent wake that lands between the `wrapper` write and `.fresh` spawns the picked account's launcher resuming the OLD uuid; the verb answers exit 7 and puts the old `wrapper` and uuid back, as the plan rules. The old uuid has no transcript under the picked account's config directory, so `_spawn_start`'s one-time retry ("left no session; retrying once with --session-id") starts an EMPTY conversation under the old uuid on the picked account (review 2360 F2). Until that pane's next restart or swap, the registry names the old account while the pane runs that empty conversation on the picked one. On `main` the same race resumed the real conversation. The window is milliseconds and the plan accepts it (Review Focus 3); `swap.log`'s pre-write line (`fresh start, uuid <u1> -> <u2>, account <cur> -> <pick>`) is the recovery: it names the old uuid and both accounts. |
| `fresh-pick-kill-between-the-writes-residual` | A kill (an agent timeout, SIGKILL) between the `wrapper` write and the uuid write leaves the registry naming the picked account with the old uuid, with no put-back and no swap row; the next wake then takes the retry path above (review 2360 F4). `swap.log`'s pre-write line is the recovery. |
| `fresh-pick-exit-5-failed-put-back-residual` | Exit 5's put-back of `wrapper` is one attempt (`_reg_set`, its failure ignored); when it fails, the registry is left as the kill above leaves it (review 2360 F4). `swap.log`'s pre-write line is the recovery. |
| `fresh-pick-exit-4-gap-residual` | Exit 4's put-back runs after `.hibernated` is written again, the unit stopped and the pane killed, so a wake in that gap starts the new uuid fresh on the picked account. `main` has the same window for the uuid; C2 adds the account (review 2360 F4). `swap.log`'s pre-write line is the recovery. |
| `fresh-pick-v1-in-the-wiring-commit` | `echo fresh-pick-v1` joins `cmd_caps` and `CCD_CAPABILITY_TOKENS` in the commit that wires the pick into `cmd_hibernate`, never before. No server constant is added: designation A owns the read. |

*Table 2. Departures from the plan's text, each the builder's own call within the rulings.*

## 4. Carried from the reviews

- **F1 (review 2336):** C2's "a refusal leaves everything untouched" case seeds an EXPIRED auth-dead marker on a listed
  account and asserts that the registry is byte- and time-identical except for that one marker (`_authdead`'s D-3524 expiry,
  ruled accepted in C1): no journal row, no `.hibernated`, no kill, unit or spawn call, the uuid, `wrapper` and the degraded
  stamp's mtime unchanged, and no new swap.log line.
- **F3 (review 2336):** `_keep_awake_ours` and `_role_long_lived` read through `_fresh_pick_field_to`, one owner for the
  bounded field read. Characterized first (green on `main`), then the one behaviour change in its own commit, then the move
  with no test change. Two edges join `contexts-edges.tsv`: `_keep_awake_ours -> _fresh_pick_field_to` (C4 to C1) and
  `_role_long_lived -> _fresh_pick_field_to` (C3 to C1).
- **F4 (review 2336), not fixed here:** two reads the pick reaches are NOT time-bounded on `main`: `_share_pct`'s read of
  the usage sweep file (through `_class_gate` and `_serviceable`) and `_session_pool_side`'s read of the set (`poolset`).
  A FIFO swapped in for either after its type test could block the fresh start's re-measure. The pick's own reads (the
  list and the class) are bounded.

## 5. Verification

(As built, before fix round 1; §6 has the fix round's measurements.)

- `ccd-fresh-pick.test.ts`: 65 cases. Of C1's 43, ten changed: two count `stay`'s extra gate ask, one soft-line case is
  now a step 3 pick, and seven refusals ask from an account outside the set (`claude`), so `stay` cannot answer and they
  keep the refusal sentence they pin; each says C2. New: step 3 (six), K1 (five), `stay` (ten, with its locale case), and
  the hold-down's stay.
- `ccd-hibernate-roll.test.ts`: 91 cases, W1a's fresh-start rows unchanged. New: the Step 1 ceiling characterization and
  fifteen wiring cases (the move and its side effects, which the Step 1 ordered-list characterization became; a stay; the
  moved note both ways; the concurrent wake; a failed `wrapper` write; exits 4, 5 (both ways) and 7; busy before
  unplaced; the untouched refusal; an unmeasured `wrapper`; locale; and `fresh-pick-v1` in caps).
- `ccd-long-lived.test.ts`: three F3 characterization cases.
- Mutation, one mutant at a time in place, restored from a saved copy: the plan's eight (the class gate dropped from `stay`;
  an empty load read as 0; `wrapper` written after `.fresh` and the uuid; the exit 7 put-back dropped; the exit 4 put-back
  dropped; the settle before the receipt; the pick before the turn-marker check; `home` written in the settle), K1's
  (organization never deciding a tie, the earlier listed first), and eleven more (the exit 5 put-back dropped; `stay`
  reading rc 2 as unservable, on the class and on the fallback, each alone; the empty-current refusal dropped; the caps
  word dropped; step 3 ignoring the hold; the typed note dropped; a same-organization best replaced by a later one; step 3
  off; the swap row dropped; the pin left standing). All 20 turn a case red. The first run found `stay`'s rc 2 mutant
  surviving (the case let the fallback answer too), so that case now pins each class's rc 2 on its own.
- Green, one file at a time through `ccrc test`: `ccd-route*` (9), `ccd-pool*` (6), `ccd-serviceable`,
  `ccd-swap-target-org`, `ccd-keep-awake`, `ccd-long-lived`, `ccd-tick-budget`, `ccd-limit-no-keys`, `ccd-lib-load`,
  `ccd-split-pin`, `ccd-contexts`, the `ccd-tick-diet*` family (16), `ccd-hibernate`, `ccd-operator-choice`,
  `ccd-auto-swap-hold`, `ccd-bounded-reads`, `ccd-archive`, `ccd-can`, `ccd-can-sites`, `ccd-verb-sets`, `capsupported`,
  `verb-gate`, `continuity-renewal-acts`, `session-hook`, `single-definition/*`, `rings/*`, `anchors`, `citations`,
  `readme-*`, `pools-prose`, `oss-metadata`, `deviation-refs` (after `git fetch origin main`), `growth-check` armed, the
  server typecheck and the tests typecheck (its only errors are in `agent/src`, from this checkout having no
  `agent/node_modules`).
- The brief names `ccd-class-gate*` suites; none exists on `main` (C1's `no-class-gate-suite`). `ccd-serviceable` and
  `ccd-swap-target-org` cover `_class_gate`.
- Locally unmeasured, left to CI: the shellcheck ratchet's program lint, killed by the local test slice's 6 GB memory cap
  (as for PRs A to C1). `shellcheck -S warning` reports nothing on `ccd/lib/long-lived.sh`, and `cmd_hibernate` alone lints
  with exactly the findings it has on `main`.
- README: one hunk in the automatic roll's paragraph, the fresh-start sentence, agreed byte for byte with `README.md`'s
  claim holder.

## 6. Fix round 1 (review 2360)

Review 2360 found no reason not to land. The coordinator's rulings, and what changed:

- **F1 (ruled):** the current account wins no tie by organization. It is never `same` to itself for the tie, and on a tie it
  sits at its list position like an account with no relation; an unlabelled current account gives no preference, so the
  answer is the earlier listed, as `_swap_target`'s. Three cases with the current account on the list: unlabelled and
  listed second (the earlier wins); labelled and listed first, with a same-organization peer at equal load (the peer
  wins); labelled and listed second, with an earlier account in another organization (the earlier wins). The first two
  were measured red on the code at `919dfeba5`.
- **F5:** `_fresh_pick_least_to` (renamed from `_fresh_pick_least`, with `__`-named locals, and listed in the out-var
  census's planned and landed forms) calls `_org_tie`. `_fresh_pick_to` declares the four names `_org_tie` reads by dynamic
  scope (`cur`, `corg`, `corgr`, `corgs`), as `_swap_target` does; none of its callees reads or writes them. The labels are
  now read once per pick, on the first tie, where `_org_rel` forked twice per tie.
- **F3, F8, F6:** see the slugs `fresh-pick-put-back-account-first`, `fresh-pick-exit-7-keeps-a-wrapper-written-since`,
  `fresh-pick-put-back-is-logged` and `fresh-pick-log-line-names-the-move-only-when-it-moves`. The settle's missing
  `LC_ALL` line needs nothing: it parses nothing.
- **F7:** `unplaced` joins the closed set in the header above `_hib_refuse`. For designation and readiness: the server keeps
  only the word `unplaced` (the renewal adapter's `SESSION_BUSY` match in `continuity/ccdSessionHost.ts`) and drops the
  cause sentence (`FRESH_PICK_WHY`), which lives in ccd's stderr only.
- **F2 and F4:** notes only, as the four residual slugs in §3.
- **F9:** no change; plan-conformant.

Measured:

- `ccd-fresh-pick.test.ts` 68 cases (65 + three F1). `ccd-hibernate-roll.test.ts` 92 cases (91 + the F8 case; the exit 4
  and exit 7 cases now pin the put-back order and its log line, and the stay case its `stay` line).
- Mutation, one at a time, restored from a saved copy, each turning a case red: `_org_tie` with the current account
  counting as `same` (the old rule); `_org_tie` with the best place's current account counted by its relation;
  `_org_tie` letting a candidate that is the current account win; the exit 7 put-back writing the uuid before `wrapper`
  (review 2360's M4, which survived at `919dfeba5`); the same on exit 4; the exit 7 put-back without its guard; the stay's
  log clause dropped; the exit 7 log line without the account. All 8 killed.
- Green, one file at a time through `ccrc test`: `ccd-fresh-pick`, `ccd-hibernate-roll`, `ccd-hibernate`,
  `ccd-swap-target-org` (`_swap_target`'s picks unchanged), `ccd-long-lived`, `ccd-keep-awake`, `ccd-limit-no-keys`,
  `ccd-lib-load`, `ccd-split-pin`, `ccd-contexts`, the `ccd-tick-diet*` family (16), `growth-check` armed,
  `single-definition/*`, `rings/*` and `deviation-refs` (after `git fetch origin main`).
