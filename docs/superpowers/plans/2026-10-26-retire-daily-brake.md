# Retire the daily dispatch brake

**Ruling (operator, 2026-10-26), D-TBD-retire-daily-brake:** retire `maxSessionsPerDay`, the daily dispatch brake,
entirely. The concurrency cap `maxConcurrentWorkers` stays, unchanged.

**It supersedes F3 of the fleet-capacity spec** (`docs/superpowers/specs/2026-10-20-fleet-capacity-and-worker-lifecycle-design.md`,
§6 F3, decided 2026-10-20: the brake would count only fresh workspaces, default 64, `CAP_MAX` 256). That decision was
never built, because fleet-capacity was parked when the architecture refactor came first. Its work item W3-5 ("the
daily brake per §6 F3") is void, and W1-2's note that it leaves `dispatchedIn24h` unchanged no longer has a count to
leave alone. The spec file is not edited; this note is the record.

## Why

- **It counted the wrong things.** Every dispatch inside a rolling 24 h counted the same: a fresh workspace, a warm
  resume of a live worker, and a review run. Reviews were most of the count.
- **It blocked silently.** At its ceiling (64, `CAP_MAX`) a coordinator was refused `cap-daily` and told to stop and
  wait to be woken, and nothing ever woke it. Its programme stalled with no sign, and refusals were not logged.
- **It never protected the box.** A daily count measures neither memory nor processes. The concurrency cap and the
  memory-based admission rule of the fleet-capacity spec are what stand against a runaway.

## What changed

| Layer | Change |
|---|---|
| Server, L1 (`dispatchDecide.ts`) | The admit step refuses only on `cap-concurrency`. The `cap-daily` verdict and its `limit`/`used` frame are gone. |
| Server, L1 (`caps.ts`) | `FIELDS` is `maxConcurrentWorkers` only. `RETIRED_CAP_FIELDS` names `maxSessionsPerDay`: a body that carries it beside a live field is decided on the live field and the legacy value is never read or validated; a body that carries only retired fields is its own verdict (`ok: 'retired'`), not a write and not a 400. |
| Server, L4 (`routes.ts`) | `POST /api/coord/caps` answers a retired-only body 200 with the current view, writing nothing and recording no feed row. The feed body is `workers a → b`. The dispatch refusal wire no longer carries `used`. |
| Server, L3 (`store.ts`) | `caps()` and `setCaps` read and write `maxConcurrentWorkers` (and `updatedAt`) only. `capsUsage()` computes `running` only and takes no clock: `dispatchedIn24h` had no other reader. |
| Storage | The `coordinator_state.maxSessionsPerDay` column stays, `NOT NULL`, with whatever it last held. No migration drops it, so a rollback to an older build still reads a row it understands. Nothing reads or writes it. |
| Wire (`shared/api.ts`) | `CoordCaps` is `{ maxConcurrentWorkers }` and `CoordCapsUsage` is `{ running }`. `cap-daily` leaves `RunRefuseCode`. The fields are dropped, not kept deprecated-optional: the only reader of the caps view is the PWA this server serves, and an older cached PWA reading them gets `undefined` for a dial with no use. The write side is the half the wire rule binds, and it accepts the legacy field. |
| PWA (`CapsControl.tsx`) | The `per day` row and its usage line are gone. One field, `workers`, and the save. |
| Coordinator skill | `SKILL.md` and `references/wave-lifecycle.md` drop `cap-daily` and the "daily budget" wording. A coordinator meets only `cap-concurrency`, and the caps paragraph says there is no daily dispatch count. |
| README | The caps dial, the cross-repo crossing-cost paragraph and the caps paragraph say the brake is retired. The crossing-cost paragraph is pinned by `server/test/crossrepo-prose.test.ts`. |

## Not changed

- `maxConcurrentWorkers`, `CAP_MIN`, `CAP_MAX` and the `cap-concurrency` refusal, its frame and its gate order.
- The fleet-capacity spec's other decisions, including the memory-based admission rule. A per-coordinator runaway
  tripwire (pause the one coordinator and notify) was recommended alongside this ruling; it is not part of this change.

## Tests

- `server/test/retire-daily-brake.test.ts`, written red first: a dispatch past what used to be the daily count is
  admitted (decider and `dispatchRun` with `CAP_MAX` closed dispatches in the last hour); the caps route accepts the
  retired field and ignores it; the view no longer reports it.
- `pwa/browser/caps-dial.browser.test.ts`: the one-field dial lays out at 360, 390, 1280 and 1920 px.
- Tests that asserted the daily refusal or the daily count were updated or removed; each is named in the pull request.

## Deviations found

- **D-TBD-retire-daily-brake** — the operator retires the daily dispatch brake (`maxSessionsPerDay`, `cap-daily`,
  `dispatchedIn24h`) on 2026-10-26, superseding fleet-capacity F3 (2026-10-20). The column stays, unread.
