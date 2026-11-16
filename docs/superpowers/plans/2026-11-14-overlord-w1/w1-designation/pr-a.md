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
- **`designate-ccd-words-fold-the-create-words`**: `DESIGNATE_CCD_WORDS` holds the seven ccd words, the create's
  `ws-title-v1` and `ws-wrapper-v1` among them, and the keep-awake word is ccd arms A's token `keep-awake-v1`.

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
  the generation lookups, so only those go through `identityOf`.
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
