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
