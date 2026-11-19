# Overlord wave 169, mid-turn mail plan: notes for the ledger

This note records what wave 169 wrote and measured, and how fix round 1 changed it. The coordinator folds it into the
programme ledger and mints any numbers. No D-number is defined here.

## In short

- **Written:** `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, docs only, from the spec merged as #3054. It
  splits the build into seven pull requests: PR 1 serves the three mail times (the baseline), PR 0 is the rig check
  that a `PreToolUse` `additionalContext` line reaches the model, PR 2 marks mail urgent at the ingress, PR 3 adds the
  `mailhold` route field to `ccd` with one grammar owner in `shared/`, PR 4 is the projection lane with the ack's kick,
  PR 5 is the hook's marker read with E and A and the jq module, and PR 6 is the subagent ack refusal.
- **No growth waiver.** Measured with the growth check's own counter at `67ee91d71`: `shared/api.ts` has 27 free code
  lines under its cap; PR 1 uses 3 and PR 2 another 3 (less what #3056 takes if it lands first). Every listed file
  stays under 40 net code lines per pull request (plan Table 5).
- **The plan's own calls** (plan §4, P1 to P14): among them, the urgent column stores the sender's role; an unreadable
  fact in the sender rule answers `urgent-unmeasured`, never `urgent-not-allowed`; the hook's arms sit in one block
  after the last deny arm, keeping every ordering rule of spec §3.5; two arming markers, E's first and alone; the
  shadow log keeps one line per hold and rotates, and logs `stop` lines so the B trigger reads one log; the marker's
  numbers have bounded digit widths; the projection does not join the Shadow lanes card.
- **Fix round 1 (review 2727, the coordinator's rulings of 2026-11-19):** the three refusal words join
  `MAIL_REJECT_CODES` beside `key-conflict` (#3056), named once in the coordinator skill's references;
  `MERGE_STRIP_JQ` stays byte-identical and the jq module computes the over-cap kinds; the ack refusal ships in its own
  pull request (PR 6); every other finding is fixed as the report directs (plan Table 8b).
- **Roll order:** server first for the wave that ships the writer and the arms (the coordinator's ruling).

## 1. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `precompact-resets-route-tries` | `cmd_route` clears the retry budget on every write, so each `precompact` write resets a pending route's retry count. The plan skips the clear for `mailhold` only, as the spec rules. | `ccd/ccd#cmd_route`, `#_route_tries_clear` |
| `precompact-empty-clear` | An observation, possibly no deviation: `precompact` has no empty-value clear (an empty value fails validation), and the spec places `mailhold`'s clear "beside `precompact`'s siblings", which is where the plan puts it. | `ccd/ccd#cmd_route` |
| `review-report-reclaimed` | The round-3 review report the brief named was reclaimed with its reviewer's clips while this wave read it. The coordinator sent what it kept (mail of 2026-11-19), and plan Table 8 maps each finding to a task. | the brief |
| `last-deny-arm` | The spec's E ordering ("before the landing advisory") and A's ("after the deny arms") are met by one block after the last deny arm, which is the fan-out routing deny today. | `ccd/session-hook.sh` |
| `ack-substitution-stricter` | The subagent ack refusal refuses `mail inbox` inside `$( )`, though its standard output is a pipe there and `cmd_inbox` only shows: the matcher does not decide a substitution, so it fails closed. | `ccd/ccrc-api` (`cmd_inbox`), plan Task 6.1 |

## 2. Departures from the brief and the spec

- The brief's list is covered in full. The spec places E before the landing advisory; the plan places it after every
  deny arm instead (P5), which keeps each of the spec's ordering rules and costs one `jq` fork only when a sync and a
  live marker meet.
- The spec rules the lane row's cadence (`derivedFrom: MAIL_SWEEP_MS`) and that it carries a `staleAfterMs`; only the
  60 s value, under the 120 s renewal margin, is the plan's.
- The subagent ack refusal is stricter than spec §3.5 for `$( )` (`ack-substitution-stricter`, above).

## 3. Proposed follow-ups (for the coordinator to file)

1. The plan's seven pull requests, in the order of plan Figure 1.
2. The arming of E, after PR 0's rig answer and with PR 4 and PR 5 deployed; A's after PR 6 and a week of shadow.
3. The B-trigger read after two weeks of E armed (plan §7), recorded in
   `docs/superpowers/programs/overlord/mid-turn-mail-e-measurement.md`.
4. A Shadow lanes card row for the two arming markers (plan P10, Later).
