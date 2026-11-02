# Accounts connect A14: Check, and the kill switch with its readiness reason

**Goal:** plan Task A14 of `2026-10-18-accounts-connect.md` (spec §10, §13.1; D-5511, D-5518). The Accounts screen gets the first account routes on the HTTP surface: **Check · one test reply**, and the lane's on/off knob, which moves only on the server's ack and, while the lane is off and not ready, is disabled with its reason beneath it. The decisions this task makes are numbered D-7732 below.

**The OA1 record** (`2026-11-01-accounts-oa1-record.md`), read where this task touches it: D-5518's sign-in row is measured, and A14 builds on A13's reading of it (a sign-in lane's credential is the identity a check read off the provider, the box's `no-credential` reason). G23, §9, §3.3, the Codex device code and the setup-token code shape are not measured; no route, word or sentence in this task depends on any of them, so none of them is claimed here.

**Before this change:** `GET /api/accounts` carried `lanes` and `connect` (A12), and the box's `enable` refused `not-ready` (A13), but no route ran an account verb and the screen offered only the fleet-host commands.

**Change:**
- `server/src/accounts/routes.ts` (new): `POST /api/accounts/:id/check`, `/enable` and `/disable`. Each takes the account gate first on the `account-v2` cap, with no step-up. It checks the id against the roster's grammar and the roster, runs the one reconciling `AccountOps` arm, writes one `account_events` row, and answers the lane as re-read: `{ok, lane}` for check, and `{ok, roster, lane}` for a switch. `routeOutcomeOf` (pure) maps each run to its answer.
- `server/src/server.ts`: the routes are registered beside the Linear routes, over the same account gate. `GET /api/accounts`'s roster rows are built by `rosterWireOf`, which the switch answer reuses, so the two can't drift. A server with no `AccountOps` answers `unavailable` once the gate passes.
- `shared/api.ts` (at the foot): `ACCOUNT_ROUTE_REFUSALS`, `AccountCheckAnswer` and `AccountSwitchAnswer`. `LANE_NOT_READY_REASONS` gains the box's `check-failed` and `no-credential`. The line is edited in place, so nothing below it moves. `shared/refusal.ts` gives each new word its status.
- `shared/accounts.ts`: `laneNotReadyReason` tells "no check" (`not-checked`) apart from "a check that failed" (`check-failed`), in the box's order.
- PWA: `lib/api.ts` gains `accountCheck`, `accountEnable` and `accountDisable`. `fleet/AccountKnob.tsx` (new) holds the row and `useLaneActs`. `fleet/accountWords.ts` gains the row's sentence, the not-ready words, `connectBlock` and `laneActRefusal`. `TroubleCopy` gains `checkAgain`. `TroubleCard` offers **Check again · one test reply**, and `AccountsScreen` draws the row on every card whose answer carries `connect`. The CSS lives in `fleet/fleet.css`.

**Tests:**
- New: `server/test/account-routes-check.test.ts` (the real server, gate, reconcile wrapper and local arm, over a stub launcher that records its argv), `pwa/test/account-knob.test.tsx` and `pwa/browser/account-knob.browser.test.ts`.
- Extended: `server/test/auth-gate.test.ts` (`ROUTES` reads `accounts/routes.ts`, with its own count pin of 3; the totals, the property loop's claim and `auth/gate.ts`'s docstring move from 125 to 128 HTTP routes and from 128 to 131 scanned), `server/test/box-token-census.test.ts` (the accounts surface), `server/test/rings/fastify-l4.data.ts` (the new L4 importer) and `pwa/test/role-census.test.ts` (the row's two type roles).

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| the knob flips optimistically (the ack's switch set before the call) | account-knob | "the knob does not move until the ack" |
| enable passes `--force` when not ready (a `force` field added to the argv builder, and the route retrying with it) | account-routes-check | "no route sends `--force`…", and the not-ready case |
| `accounts/routes.ts` dropped from `ROUTES` | auth-gate | the `printRoutes` COMPLETE case ("routes the server serves that the sweep never sees"), and the table parser's count |
| a refusal renders the response's text | account-knob | "a refusal is worded from its code, never from the response text", "every word the routes answer has its sentence…", and "a refused switch never moves…" |

**Per width × skin × mode (Step 4):** `pwa/browser/account-knob.browser.test.ts` measures this in a real Chrome over the production build, on a fixture of three lanes (lane-a on; lane-d off, not ready, with two sessions still running on it; lane-l off and never checked). Each cell is its own case.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |

Each ✓ checks these things:
- The skin and theme drawn are the ones the cell names.
- The reason sits on its own line under the knob, never beside it, starting at the row's left edge.
- Nothing scrolls sideways, and nothing overflows a card.
- Check reads "Check · one test reply" whole.
- The disabled knob draws in `--ink-disabled`, and the on knob in `--accent`.
- At 360 and 390 the knob and Check take a 44px tap.
- At 1280 and 1920 the row stays inside the column: Refined's 760, and Instrument's reading column until A4 gives it the detail pane.

Contrast is the gate's job: `node design/contrast-check.mjs` passes every pair. The row uses only existing inks, on the card's ground.

## Decisions

- **D-7732 (2026-11-01)** — `check-and-kill-switch-routes-as-built` (accounts plan Task A14; spec §10, §13.1): the as-built decisions of A14, and where it departs from the plan's wording.
  1. **Gate, cap and step-up.** Each route takes the account gate before it reads the id or asks the fleet, on `account-v2` (spec §13: every account route is gated on `capSupported('account-v2')`). No route asks for a step-up. A fleet that does not advertise `account-v2` yet (until A16) answers `501 unsupported`, and the screen says so beneath a disabled knob (spec §12.6's `connect.accountOps`).
  2. **The answer is re-read.** After an act that ran, the lane is read back through `lanesWire`, the GET's own reader, over a fresh telemetry, lane-state and marker read. The switch answer's `roster` is built by the same `rosterWireOf` as the GET's. The knob takes the switch the answer read. It holds that switch until the store's refreshed `/api/accounts` answer has landed, and then follows the store again.
  3. **Refusals are words, never sentences.** Only the verb's code crosses: `not-ready` with its `reason` (when it is one of `LANE_NOT_READY_REASONS`), `lane-busy`, `last-enabled-home`, `not-found` (for the verb's `unknown-id`), and otherwise `lane-act-refused` with `verbCode` when the code is a kebab word. The verb's `detail` never crosses: it names paths and commands. The screen words every refusal from these codes (`laneActRefusal`), never from a response body's text. A request that never completed reads "unknown", and the screen re-reads.
  4. **New words and statuses.** `lane-busy`, `last-enabled-home` and `lane-act-refused` are 409: the request was well formed, and the box's state refused it. `outcome-unknown` is 502, the status `fleetFailed` answers for a fleet that did not answer: the box may have acted, and the cure is the re-read. `not-ready` keeps the table's measured 503, because one word cannot carry two statuses. The screen reads the word, not the status.
  5. **An unknown outcome.** A timeout, a lost answer or an output past its cap answers `outcome-unknown`. The `ops` port is `index.ts`'s reconciling wrapper, which has already run one `roster` sub and written its `reconcile` row. The route never retries.
  6. **The audit.** Each act writes one row: `act` is the sub, the provider comes from the roster, and the outcome is `ok`, `refused`, `failed` (nothing ran, or an exit with no envelope) or `unknown`. A refusal's `code` is the route's word. A refused or failed op is preceded by the wrapper's `reconcile` row.
  7. **Readiness never holds the kill switch.** The knob is disabled with its reason only while the lane is **off** and not ready, because the move it would make is enable. An on lane can always be switched off, a legacy lane included. Once it is off, its row reads "Check it once to turn it on" with Check beside it (spec §10's backfill paragraph).
  8. **The reasons, worded.** A lane with no lane state, or no check, reads "Check it once to turn it on". `check-failed` reads "Not ready: the last check didn't pass. Check it first." (spec §10). `no-credential` and `seed-unverified` each have their own sentence. The display's `laneNotReadyReason` now tells `not-checked` from `check-failed`. It still never answers `no-credential`: the box alone can measure a credential, and it answers that reason on `enable`, where the toast words it.
  9. **When the screen cannot act.** With no `connect` (a dark gate's answer, or an older server), the row isn't drawn and the trouble card keeps only its commands. With a `connect` that says the fleet can't run the acts, or an insecure origin, the row is drawn with the knob disabled and the server's reason beneath it, and no Check is offered.
  10. **Move sessions off is not offered yet.** Its sheet is Task A3's, which has not landed. The off row says how many sessions keep running ("Off: no new sessions; the 2 running here keep running."), and A3 adds **Move 2 sessions off** beside it.
  11. **Where the code lives.** The plan names `AccountsScreen.tsx`, `TroubleCard.tsx` and `accountWords.ts`. The row and its act state are one new file, `fleet/AccountKnob.tsx`, so the screen's row loop gains only its props. The plan's `pwa/src/lib/api.ts`, `server/src/server.ts` and both census tests are as named.
  12. **The census.** The three doors are session-only fleet acts, not coordination writes. Like the docs doors, they join neither `SESSION_ONLY_ALL` nor the box-token lanes, so CLAUDE.md's box-token bullet owes them no sentence. `box-token-census.test.ts` holds their own describe instead: every file under `server/src/accounts/` is read for a box-token call, none of the doors is EXEMPT, the door set equals the registrations in both directions, and a planted call is seen.
  13. **The gate sweep.** The three are not `FLAG_AWARE`. Dark, they answer the account gate's `501 auth-off`. Armed with a session on the sweep's unmeasured fleet, they answer `501 unsupported`. The property loop compares statuses, so it covers them like every other gated route.
