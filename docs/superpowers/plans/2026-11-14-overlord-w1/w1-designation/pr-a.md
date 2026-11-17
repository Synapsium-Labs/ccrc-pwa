# Designation A: the builder's departures

Departures from `w1-designation.md` found while building PR A (Tasks 1 to 5), by slug. No D-number is minted for them
(X9); the coordinator folds them into the plan's ledger.

## Task 2

- **`door-builds-the-lane-facts`**: `AccountFacts` carries `lanes` (each account's `LaneFacts`, built by the door with
  `limits.ts#laneFactsOf`, now exported) in place of the plan's `shares`, so the decider never rebuilds lane facts.
- **`designate-verdict-has-an-unmeasured-arm`**: an unmeasured designation read is its own verdict arm, first in the
  order, which the door answers 503 `unavailable`.
- **`overlord-accounts-gains-unmeasured`**: `overlordAccounts` answers a third list, `unmeasured`: candidates whose
  serviceability is not measured, or whose lane facts are missing. They are listed, never counted. When fewer than two
  count and some are unmeasured, the refusal's detail says the count is unmeasured (the readiness ruling F11).
- **`designate-home-may-be-null`**: `DesignateFacts.home` is `ProjectedHome | null`; no placeable lane falls back to the
  first counted account.
- **`undeclared-provider-left-out`**: an `external` lane with no declared provider is not known to be Anthropic, so it
  is left out of the list, as a pay-per-use lane is.
- **`provider-read-beside-roster-kind`**: the decider reads `exec.provider` (`upstream` is Anthropic) rather than
  calling `shared/roster.ts#rosterKindOf`, which a census pin keeps to one caller.
- **`set-placement-carries-no-class`**: `SetPlacement` has no class field; a set the class empties reads `none`
  carrying the set.
- **`designate-ccd-words-fold-the-create-words`**: `DESIGNATE_CCD_WORDS` holds the eight ccd words, the create's
  `ws-title-v1` and `ws-wrapper-v1` among them. The keep-awake word is ccd arms A's token `keep-awake-v1`, and the last is
  ccd arms C2's `fresh-pick-v1` (review 2349 F10, ruled), so a fleet box below arms C2 refuses `capability-missing`.
- **`overlord-accounts-home-able-only`**: `overlordAccounts` skips an account that is not `homeAble`, because ccd's
  `--wrapper` refuses one; it is neither counted toward the two nor picked (review 2349 F5).

## Task 1

- **`first-designate-journals-from-the-narrowest`**: with no row, the designate door's account-set record states `from`
  as the empty set and its model-class record states `from` as `opus`, the narrowest values. Over a retired row, `from`
  is the row's own value, read in the same transaction (authority A review 2219 F2).
- **`go-live-op-key-is-the-term`**: `goLive` is not a door and mints no key: its record's `opKey` is
  `go-live-term-<n>`, the raised term. The designate door's two records take the door's key plus `-set` and `-model`.
- **`bind-generation-once-never-overwrites`**: `bindPendingGeneration` with a different generation over a recorded one
  refuses `generation-set`; the same one answers `changed: false`.
- **`golive-leaves-rebind-to-pr-b`**: `goLive` on a pending `rebind` attempt answers `changed: false` until PR B adds its
  arm.
- **`fail-pending-refuses-unknown-outcome`**: an outcome outside `ATTEMPT_OUTCOME_MAP` refuses `bad-outcome`.
- **`writers-refuse-an-unreadable-row`**: every writer reads the row through the reader's one narrowing, and a row it
  cannot narrow answers `unmeasured` and writes nothing.
- **`retire-records-its-actor`**: a retire writes the retiring actor to the row's `actor`.
- **`restamp-never-throws-on-the-live-identity-index`**: `restampOverlordGeneration` skips, `changed: false`, when
  another session already holds the live identity `overlord`, and opens no transaction of its own (`tx` does not nest).
- **`authority-fixtures-build-the-designation-table`**: the authority journal and guard suites' fixtures apply the
  designation migration too, since the journal's boot read now names `overlord_designation`.

## Task 3 (the reads: `identityOf`, the role and the mail pace)

- **`notes-keyed-by-session-id`**: notes (`liveNotes`, `appendNote`) stay keyed by the session id. The plan names only
  the generation lookups, so only those go through `identityOf`. Every notes reader therefore reads by the generation
  row's `sessionId`: the card facts (`cardFacts.ts`), the renewal seal (`renewalActs.ts#seal`) and the probe facts
  (`generationsLane.ts#probeFactsOf`), so a restarted Overlord's notes reach its seal (review 2349 F2).
- **`unmeasured-designation-reads-undecided-for-renewal-permit`**: in the generations lane an unmeasured designation
  fails the mint step (`unread: 'designation'`), and the role read for the renewal permit reads undecided between
  coordinator and plain, so a coordinator's renewal holds as a role change.
- **`profile-lane-unmeasured-designation-counts-every-row`**: on an unmeasured designation the profile lane writes no
  row and counts every row in `roleUnread`, not only the coordinator-or-plain ones.
- **`anchor-reads-tested-in-the-card-route`**: the plan's `continuity-anchor` target is covered in
  `continuity-card-route.test.ts`, because `anchorReads` is a closure in `continuity/routes.ts` and
  `continuity-anchor.test.ts` tests the pure renderer.
- **`mail-sweep-episode-in-its-own-module`**: the mail sweep's once-per-episode log and operator push for an unmeasured
  designation live in `continuity/designationEpisode.ts`, so `watch.ts` grows by seven lines.
- **`designation-kebabs-admitted-by-guard`**: the mail-routes kebab census admits the designate door's refusals through
  `OVERLORD_REFUSALS`' guard and the decider's and store's other words through `overlordDesignation.ts#isDesignationKebab`.
- **`overlord-identity-never-a-registry-id`**: `identityOf` answers the reserved identity `overlord` (X5) beside
  session ids in one namespace. No registry row can carry the bare id `overlord`: ccd composes every id as
  `<wrapper>-<project>` (`cmd_start`) or `<project>-<slug>` (`shared/slug.ts#workspaceId`), each with a dash, so a
  session's own id never meets the Overlord's generation rows.

## Task 5 (the doors)

- **`keep-awake-failure-fails-the-create`**: a failed `keepAwake('on')` at the create (ccd's rc 1 on an unreadable
  marker, or a lost answer) is a failed create step: `failPending(…, 'create-failed')`, the stop owed and drained, 502.
  This replaces the plan's `awake: false`, so a 200 always says `awake: true`. A foreign marker (`kept-foreign`, rc 0)
  succeeds and raises one operator item naming each foreign marker (`no-hibernate`, `no-roll` or both; review 2349 F8), on
  the `overlord` programme's ledger, as the renewal act raises its items (`raisedBy` `ccrc`).
- **`drain-markers-off-first`**: the drain turns the markers off first, clears `poolset` and `acctorder` only when that
  succeeded, then always stops (review 2349 F6, ruled; review 2366 N1, ruled). While `off` fails the id stays owed with its
  `poolset` and `acctorder` in place, so the capability floor's fact stands as long as the markers do (arms notes A §3) and a
  later drain retries `off`; the body is stopped all the same, and `stopDone` runs only after an `off` that succeeded. This
  replaces the plan's clear-first order; the coordinator folds it.
- **`fail-drains-when-failPending-throws`**: a failed step's `failPending` that throws still drains the id, and a stop
  that then fails retries the write once so the id lands on `stopsOwed` (review 2349 F7). A `failPending` that ANSWERS
  `unmeasured` recorded nothing: that is a residual (review 2366 N4, ruled). The pending row still names the id and the next
  retire stops it through its pending arm, so a stop that fails there is logged as that residual, never as owed. An
  `unknown` create answer is never drained here (`unknown-create-stays-owed`).
- **`unknown-create-stays-owed`**: when the create answers `created: 'unknown'` (a lost `ws-add` answer re-measured absent),
  the fail path records the id on `stopsOwed` and runs no drain of that id in the same request, and a `failPending` that
  throws is retried once (review 2366 N2, ruled under the Global Constraint): ccd may still be making the session, so a stop
  answering `absent` now would clear a debt that is still real. The id stays owed until a later drain, from a DELETE, the
  next designate or designation B's deadline sweep, finds it absent and clears it. Designation B's deadline sweep re-drains
  `stopsOwed` itself, not only pending rows (carried into PR B by the coordinator).
- **`pending-retire-ends-the-generation`**: a pending body that started has a live `overlord` generation (`identityOf` gives
  the pending id `overlord`), so both of retire's pending arms (pending-only, and the pending id in a live-plus-pending
  retire) and `failPending` end it with outcome `retired` in the same transaction (review 2366 N3, ruled). The mutant sets
  `overlordDesignationStore.ts#retire` (E1 to E3) and `#failPending` (E4) pin each call.
- **`designate-refuses-an-incoherent-journal`**: designate refuses `authority-rolled-back` (or `journal-unreadable` for an
  unmeasured guard) before any row write or ccd call while the authority journal is not coherent (review 2349 F9, ruled).
- **`retire-ends-the-generation-retired`**: retire of a live designation ends the retired body's live `overlord`
  generation in its own transaction, with a new outcome word `retired` in `GENERATION_OUTCOME_MAP`, and the `ended`
  state reads "a later generation replaced it, or the operator ended the binding" (review 2349 F4, ruled; PR B's rebind
  uses the same word for the old body). An older build's readers skip an ended row, and only `checkpointBefore` reads its
  outcome (review 2366 N5), so an older build meets the word only there.
- **`retire-none-still-drains-owed-stops`**: a retire on a row that binds nothing writes nothing, but drains any stop an
  earlier attempt still owes, so a failed stop is not stranded until the next live or pending retire.
- **`create-failed-answers-fleetFailed-502`**: a failed create step answers the existing `fleetFailed` 502 with `detail`
  and `sessionId`; no new refusal word.
- **`slug-from-uuid-prefix`**: the workspace slug is the first eight characters of `entropy.uuid()`. The authority
  records' operation keys are the door's `entropy.hex(16)`, prefixed `designate-` or `retire-`.
- **`failed-attempt-drains-the-id-regardless`**: a failed step drains its own id even when `failPending` finds the
  attempt already gone (a retire between the steps, off the serialiser), so nothing runs with no row.
- **`profile-digest-from-launchDigestOf`**: the create's route carries `profiledigest` from `launchDigestOf('overlord')`.
  The decider refuses a create unless builds read `agreed`, so a skewed build never reaches a create.
- **`read-door-asks-the-gate-without-step-up`**: the GET asks the gate `{ cap: null }` with no step-up, and answers
  `auth-off` while sign-in is dark, as `FLAG_AWARE` lists it.
- **`first-prompt-send-per-row`**: the renewal wiring's send closure takes the row's key and keeps one `sendPrompt` per
  row, each naming `INJECTED_PROMPTS['<row>'].text` literally, because the injected-prompts census accepts only that form.
- **`registration-waits-for-the-body`**: `server.ts` registers the doors in Task 4's commit, with the body adapter, so
  `auth-gate`'s registration cases are red between the two commits.

## Task 4 (the body adapter)

- **`claudecode-strip-by-env-window`**: `RunCcd` takes only an argv, so `withoutClaudeCode` removes `CLAUDECODE` from the
  environment for the synchronous start of the child and restores it in a `finally`. `ccd()` calls the runner before its
  first await, and `execFile` copies the environment as it spawns. A server unit never carries the variable, and a
  remote-mode call runs on the agent, so the window only matters on a local-mode server started from a session's shell.
- **`doors-register-without-a-store`**: the doors always register. With no coordination store or authority journal
  (`NO_OVERLORD_STORE`) every door answers `unavailable` after the gate, and the server logs one line at boot.
- **`stop-unmeasurable-is-not-absent`**: `stopCreated` answers `absent: true` only for a proven absent registry row. An
  unmeasurable or unlistable registry is `ok: false`, where the stop route answers `unknown-session` for both.
- **`stop-has-no-census-row`**: `stopCreatedOf` takes the stop route's `measuredIdentity`, `stopPairRefused` and
  `stopArgvFor` as values and names no `CCD_ARGV` builder, so `id-argv-census` has no row for it and `stopArgvFor`'s
  caller pin is untouched. `overlord-body.test.ts` pins the stop's argv and its answers instead.
- **`keep-awake-needs-its-line`**: an rc 0 `keep-awake` without its `awake <id>` or `released <id>` line is `ok: false`.
- **`ensureProject-exists-is-ok`**: `project-add`'s `project exists` answer is `ok`.
- **`create-leftbehind-is-yes`**: only ccd's refusals made before the row exists answer `created: 'no'` (`slug-taken`,
  `bad-slug`, `account-refused` with nothing left behind). A refusal that left a worktree behind, and ccd's own
  `ws-add spawn failed` at rc 3 to 6 (the session exists, is claimed and is supervised), answer `yes`; every other answered
  failure is re-measured through the registry (review 2349 F1). A call cut short or lost owes the stop even when the
  re-measure reads absent (`unknown`), because ccd may yet make the session: the Global Constraint ("when ccd may have
  made the session") governs, and Task 4's sentence that a measured absence answers `no` (review M8) yields to it
  (review 2349 F3, ruled). An owed stop of an absent id is a no-op that `stopDone` clears.
- **`one-session-host-builder`**: `renewalWiring.ts#renewalHostOf` builds the `SessionHost` for both the renewal acts and
  the designate door's first prompt, so its construction is not copied into `server.ts`.

## Task 3 (the roll and sleep holds)

- **`roll-input-two-words`**: `AutoRollInput.overlord` is `boolean | 'unmeasured'`, so the bound-or-pending skip
  (`overlord`) and the unread skip (`designation-unreadable`) are two values, read right after the setting and role
  checks.
- **`no-coord-reads-none`**: the sleep lanes' `designationOfCoord(undefined)` answers `none`, not unmeasured: with no
  coordination store every row already holds `runs-unreadable`, and no Overlord can be bound without one.
- **`renewal-drain-false`**: the renewal drain's hibernate input passes `overlord: false`, because the renewal is what
  moves the Overlord's own body, and the sleep hold must not block it.
- **`act-time-reread`**: the sleep lanes read the designation once a pass and again at the act, so a body designated
  between the two is never stopped.
