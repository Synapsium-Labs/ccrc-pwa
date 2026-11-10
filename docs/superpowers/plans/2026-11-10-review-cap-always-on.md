# The coordinator's review-cap lift is always on

## Goal

A run's coordinator can extend a reached review-round cap (`POST /api/runs/:id/review-rounds`, `ccrc-api runs review-rounds`) on every box, with no setting to turn the door off. The server no longer reads `CCRC_REVIEW_CAP_COORD_LIFT`, the box settings table, the console's settings card, the README and the coordinator skill no longer name it, and a box whose `ccrc.env` still sets the key keeps working.

## What was read first

- D-8125's plan (`docs/superpowers/plans/2026-11-09-coordinator-lifts-review-cap.md`) added the switch: `reviewCapCoordLiftOf` in `server/src/config.ts`, `cfg.reviewCapCoordLift`, the `setting` input of `coordLiftVerdict`, of `liftReviewCapByCoordinator` and of the route's deps, and the refusal word `coord-lift-off` (409) with its row in `REVIEW_ROUNDS_REFUSALS` and `REFUSAL_STATUS`.
- The same commit added the setting to ccrc's own list: `CCRC_SETTINGS`, `BOX_SETTINGS_TABLE` (family `coordination`, the only member of that family), `BOX_SETTING_VALUE_WORDS`, `_set_reads`, the `_rc_ok` and `_rc_says` checks and the family arms of `_set_says` and `_set_check`, mirrored in `shared/api.ts` (`BoxSettingFamily`, `BOX_SETTING_TABLE`, `BOX_SETTING_VALUE_WORDS`) and in the console's family words. `_rc_says` printed `on or off`, a refusal word `_browser_mcp_default_says` also prints, so the refusal-word set does not change.
- No fleet sweep reads the key, so the generated `ccd/lib/ccrc-settings.sh` carried only its name in `CCRC_SETTINGS`.
- ccrc has no retired-settings list for `ccrc.env`: `_ccrc_knob` reads no name outside `CCRC_SETTINGS`, and the server reads the key only from its environment. A key that nothing reads is simply ignored (the file's lines are not scanned for unknown names), so the old key left in an operator's `ccrc.env` needs no handling and gets no warning.
- Kept unchanged: the guard (the caller is the run's coordinator through `coordinatorOfRun`, or holds an open claim on its programme, attributed by the registry), three more rounds a lift, the required reason, the lift record, the run event and the feed notice, the operator's own lift, and the words "cap lifted by its coordinator".

## Deviations found

- **D-8165 (2026-11-10)** — the operator ruled the coordinator review-cap lift always on and not configurable ("I want it to be the default and not changeable"); CCRC_REVIEW_CAP_COORD_LIFT retires; this overrides D-8125's off-by-default switch only.

## Design

- The verdict decides on rows alone: `coordLiftVerdict` takes no setting, `CoordLiftRefusal` loses `coord-lift-off`, and the route and the store lose the `setting` field. The refusal word and its status row go; `cap-not-reached` stays.
- The setting leaves ccrc's list and mirror: 99 settings become 98, 71 shown become 70, the value class goes 58 to 57, the `coordination` family goes (13 families become 12 on the card), the `ccrc settings` human form prints 70 lines before the deadline line, and the refused-word count on a Linux box goes 68 to 67.
- The README loses the settings paragraph sentence and the settings table row, its "71 settings" becomes 70, and the review-cap paragraph says the door has no setting. `deploy/ccrc.env.example` loses the entry. The coordinator skill and `wave-lifecycle.md` lose the `coord-lift-off` refusal and the sentence about a box that leaves the lift to the operator.
- History is kept: D-8125's plan and the two 2026-11-09 specs get a one-line note where they state the switch as current.

## Tasks

- [x] T1. Tests first, red: a coordinator lift succeeds with no setting; the config has no field for it and loads the same with the retired key set to any value; the settings table, census, verb and card counts; the skill never names the switch; the fixtures lose the row.
- [x] T2. Build: remove the read, the `setting` plumbing and the refusal word; remove the table, value-word, check and family entries; regenerate `ccd/lib/ccrc-settings.sh`; edit the README, the env example and the skill text.
- [x] T3. Notes on the historic plan and specs; full run of the named test files, the typechecks and the browser leg.
