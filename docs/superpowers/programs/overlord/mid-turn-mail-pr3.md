# Overlord wave 174, mid-turn mail PR 3: notes for the ledger

This note records what PR 3 of the mid-turn mail plan (`docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, Tasks 3.1
to 3.4) built and measured, and the departures found, by slug. The coordinator folds it into the programme ledger and
mints any numbers. No D-number is defined here.

## In short

- **Built:** the `mailhold` route field in `ccd`, behind `route-mailhold-v1`; its grammar's one owner,
  `shared/mailHold.ts` (L0, imports nothing); a corpus, `server/test/fixtures/mailhold-grammar.json`, that holds
  `parseMailHold` and ccd's `_route_valid` to one answer per row; and `mailhold` at the end of `ROUTE_FIELDS` and of
  `ROUTE_WRITABLE_FIELDS`, with every order pin of the two lists updated.
- **No new ccd verb, route or helper.** Every ccd change is a row or a line in an existing table: the `ROUTE_FIELDS`
  member, the `_route_valid` row, the write-site bound, the empty-value clear, the `_route_any` skip, the mint refusal,
  the session-shell refusal, the retry-budget skip and the caps line. So `ccd/contexts.tsv` and
  `ccd/contexts-edges.tsv` are unchanged.
- **Growth,** by the growth check's own counter against the merge base: `ccd/ccd` +6 code lines (the plan estimated
  +14), `shared/api.ts` 0 (5,113, so its 27 free lines stay free), `shared/mailHold.ts` new at 44 (in no growth row).
- **Every guard has a mutant that reds,** each an in-place edit restored from a saved copy whose sha256 was checked
  after the restore (table below).

## 1. Mutations

| # | Guard | Mutant | What went red |
|---|---|---|---|
| M1 | eight-pair edge | the regular expression allows nine pairs | corpus row "nine pairs", the regular expression's own corpus case |
| M2 | lease upper bound | `mailHoldLive` uses `<` for `until <= now + 360` | the both-edges case |
| M3 | `until` digit width | 12 digits allowed | corpus row "a 12-digit until" |
| M4 | no leading zero in `until` | the first digit may be `0` | corpus rows "a zero until", "a leading zero in until" |
| M5 | ccd's write-site bound | the bound never runs | the far-future case |
| M6 | `_route_any` skip | `mailhold` counts as routing | the `_route_any` case |
| M7 | the mint refusal | `_route_argv_check` lets `mailhold` through | the `ws-add` case, the `start` and `enable` case, the argv-only line census |
| M8 | ccd's role words | `worker` added to the bash copy | both parity runs, the copy's text pin |
| M9 | ccd's leading-zero exclusion | `[0123456789]` for the first digit of `until` | both parity runs, the copy's text pin |
| M10 | retry budget (P13) | a `mailhold`-only write clears `.routetries` | the `mailhold`-only case |
| M11 | session-shell refusal | the refusal never fires | the write case and the clear case |
| M12 | empty-value clear | the empty value goes to validation | the clear case |

*Table 1. The mutants. `10#` is a second line no corpus value reaches (plan P14), so it is pinned by text, not
mutated.*

## 2. The rollback read (plan Task 3.4, §9)

Measured with `main`'s `shared/` (at `a6505783c`) and this branch's, on one fixture session:

| Reader | A route without `mailhold` | A route with `mailhold` | Two sessions, one with `mailhold` |
|---|---|---|---|
| `main`'s `reviveFleetSessions` | 1 session | `null` | `null` |
| this branch's | 1 session | 1 session | 2 sessions |

*Table 2. What a reader answers for a state cache whose route carries `mailhold`.*

So a server rolled back past this PR reads such a cache as absent: `reviveRoute` throws on a field outside its
`ROUTE_WRITABLE_FIELDS`, `reviveFleetSessions` answers `null` for the whole list, and `loadSnapshot` folds that to "no
snapshot". The route then assembles live and the writer rewrites the cache on its next tick. The cached records are
re-measured, not lost, but the degraded-mode snapshot is unavailable until that first live assembly; if the fleet box
is unreachable at that moment, the console has no snapshot to fall back on. This is the same stance every earlier
route field took (`precompact`, `poolset`, `acctorder`, `profiledigest`). PR 3 ships no writer of `mailhold`; the
window opens only once PR 4's projection writes markers.

## 3. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `mailhold-mint-refusal-shares-the-pool-set-line` | The plan names "the `_route_argv_check` refusal"; it is built by extending the pool set's existing argv-only refusal line to `mailhold` (same sentence: "written only by ccd route --session"), so `ccd-route-argv.test.ts`'s census of argv-only lines changes that one literal. The mint cases sit beside the pool set's in that file, not in `ccd-route-mailhold.test.ts`. | `ccd/ccd#_route_argv_check`, `server/test/ccd-route-argv.test.ts` |
| `mailhold-reach-constant-in-ccd` | ccd holds the reach as `MAILHOLD_REACH_S=360` beside `ROUTE_FIELDS`, so the write-site bound names no bare 360; the parity test holds it equal to `shared/mailHold.ts#MAILHOLD_REACH_S`. | `ccd/ccd`, `server/test/mailhold-parity.test.ts` |
| `rollback-drops-the-whole-snapshot` | A rollback past PR 3 reads a cache holding `mailhold` as no snapshot at all (section 2), not as one dropped session. It re-measures live, so no fact is lost. Raised for the coordinator's ruling before the merge, as plan §9 asks. | `shared/api.ts#reviveRoute`, `server/src/fleetstate.ts#loadSnapshot` |
| `shellcheck-ratchet-unmeasured-locally` | The shellcheck ratchet could not measure `ccd/ccd` locally: the shared test slice's 6G cap killed `shellcheck` (5 OOM kills in the slice, fleet load). The changed functions, cut out and checked alone, hold no warning on this branch. CI's run is the arbiter. | `server/test/shellcheck-ratchet.test.ts` |
| `plan-growth-estimate-ccd` | `ccd/ccd` grew +6 code lines against the plan's +14 estimate (Table 5), because most rows are in-place edits of existing lines. | plan Table 5 |
