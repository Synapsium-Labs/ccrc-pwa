# Anthropic lanes with no 5-hour window

Some Anthropic plans have no 5-hour window. Their statusline payloads carry `seven_day` and nothing for `five_hour`,
render after render. The limits row then reads `five: null` with a `fiveResetAt` days in the past and a fresh weekly
figure. Every scorer took that row as half-measured, so the lane could never rank. `_swap_target` put it last at 100,
`_ws_least_loaded` skipped it, and the Accounts screen drew an empty `—` 5h meter. #2323 already publishes the weekly
figure when a payload has no 5h one. This change says what the missing figure means.

## Deviations found

- **D-8120 (2026-11-08)** — Anthropic lanes with no 5-hour window: the statusline writer states it once, every scorer ranks the lane on its week, and the Accounts screen says "No 5-hour limit"

## The rule, and its one owner

One `five: null` cannot tell "this account has no 5h window" apart from "this payload did not report it". One account
went five-less less than 2 hours after hitting its 5h limit. So the fact is an observation over time, and
`ccd/statusline-command.sh` owns it. It is the one writer that sees every reading land. It is a single jq `def`
(`fiveAbsentSince`) on the row write. On a payload with no 5h figure and no 5h `resets_at`:

- `fiveAbsentSince` is when the row's run of five-less readings began. It is kept from the row while the row is
  already five-less. A row written before the key existed is seeded from its kept `fiveResetAt`, the end of the last
  5h window anyone reported. A reading that starts the run gets `now`, and so do a row that still held a 5h figure,
  a fresh account and an unparseable row.
- `fiveWindowMinutes: 0` is written once `now - fiveAbsentSince >= 18000`, a whole 5h window.

A payload that names a 5h window at all, by a figure or a `resets_at` on its own, writes neither key. The row then
goes back to today's shape and today's pair rule. Accounts outside `CCRC_MEASURED` (gpt) still get no row from this
writer, and `ccgpt-usage.py`'s Codex rows are unchanged.

**Why the 2-hour case is safe.** While the 5h reset is still ahead, the existing verdict (`fiveLive`) drops every
five-less payload, so nothing is published. The first five-less publish after the reset finds a row that still holds
a figure, so it starts a new run at `now`. The earliest mark is the reset plus a whole window.

**Why the writer and not a reader rule.** The writer measures the run from observed writes. A reader would measure
it from its own later clock, so an idle row could turn five-less just because time passed. The writer's rule also
covers a fresh Anthropic row whose `fiveResetAt` is null, which gets 5h of observation instead of trust. And it
needs no new twin. `fiveWindowMinutes: 0` is the marker all three scorers already read as "no 5h window, the weekly
figure is the whole score": `measured()` in `server/src/limits.ts`, `_limit_score` in `ccd/ccd` (and its frozen twin
`_legacy_limit_score`, whose branch is the same), and the PWA's `accountPicker` `load`. `readLimits` and
`/api/accounts` already carry the key. No reader re-derives the fact.

## What changed

- `ccd/statusline-command.sh`: the `fiveAbsentSince` def, and the two optional keys on the row it prints.
- `ccd/ccd`: `_limit_score`'s comment names the Anthropic marker. There is no logic change. Every 5h-reset reader
  was checked: `_avail`, `_swap_pin_expiry_to` (#1114), the classwindow rung, the rescue waits and
  `_codex_lane_status`. None of them waits on or freezes at a 5h reset when `five` is null. The pin's expiry on such
  a home is the weekly reset or the TTL.
- `server/src/limits.ts`, `shared/api.ts`: field docs only.
- `pwa/src/fleet/accountWords.ts`: `NO_FIVE_HOUR` ("No 5-hour limit") and `fiveHourWords(kind, usage)`, the one
  decider of what a lane's 5h row says. Codex keeps "weekly window only". Any other lane says "No 5-hour limit" only
  when its row carries the marker. Otherwise the meter is unchanged.
- `pwa/src/screens/AccountsScreen.tsx`: the 5h row reads `fiveHourWords` and marks itself `data-five`. It reuses
  `.acct-weekly-only`, so the layout is the Codex row's at every width.

## Tests

- Writer: `server/test/statusline-script.test.ts`. A first reading starts the run. A young run stays unmarked. A
  run a window old is marked. A live-shape row is seeded from `fiveResetAt`. A bad start falls back. Under 2h after
  a 100% hit, nothing is published. Just after the reset, a new run starts. A 5h figure or a 5h `resets_at` clears
  both keys. An unparseable row starts a run. gpt gets no row.
- Shared rank fixture: `server/test/fixtures/rollover.ts` has three Anthropic rows (marked, young run, marked with
  a rolled week). `limits.test.ts` and `ccd-limits.test.ts` assert `measured()` and `_limit_score` on the same bytes.
- Placement parity: `server/test/fixtures/leastLoaded.ts` (`projected-home.test.ts`). A marked lane wins on its
  week, and a young run stays unmeasured.
- Swap: `server/test/ccd-swap-target-class.test.ts`. A marked lane is the target on a quiet week, an unmarked one
  ranks last, a marked one is refused at the weekly ceiling, and a marked home stays until its week is under
  pressure. `server/test/ccd-swap-pin.test.ts`: a pin on such a home expires at the weekly reset or the TTL.
- Wire: `server/test/accounts-route.test.ts`.
- PWA: `pwa/test/accounts-trouble.test.tsx` (the card and the `fiveHourWords` table), `pwa/test/swap-sheet.test.tsx`
  (the picker), and `pwa/browser/accounts-cards.browser.test.ts`. The browser test covers 360, 390, 1280 and 1920,
  both skins and both themes. Its lane-b has no 5h window: the words are shown whole and in place of its 5h meter.

## Known limits

- A row gets the marker only on its next render. A five-less lane with no session rendering stays unmarked until
  one does.
- A brand-new five-less account, or one whose row last held a 5h figure, stays unranked for its first 5h of
  readings. That is the cost of not trusting a single null.
- A stale session's snapshot that still carries a 5h figure for a window newer than the row's kept `fiveResetAt`
  publishes, and restarts the run. Older ones are dropped by the existing verdict.
- The history-replay gate (`deploy/history-replay.mjs` `decideLimits`) still refuses a five-less row as `five-null`,
  so replay cannot run on these lanes. That reader is outside this change.
