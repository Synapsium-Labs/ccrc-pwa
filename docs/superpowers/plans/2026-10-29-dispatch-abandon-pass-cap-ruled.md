# The dead-dispatch pass handles at most twenty candidates, ruled

- **D-7502 (2026-10-29)** — the dead-dispatch pass handles at most 20 candidates, oldest first, the rest on the next pass.

**D-7502.** `abandonDeadDispatches` (`server/src/coord/abandonDeadDispatch.ts`, D-7319) holds the coordination serialiser for its whole loop, and every dispatch waits on that serialiser from before its `ws-add` to after its bind. Before this change the loop had no bound: a pass with many candidates held every dispatch for as long as it took. The coordinator's scope ruling was to cap the candidates one pass handles at a fixed constant, oldest first, and leave the rest for the next pass.

| Requirement | How it is met |
|---|---|
| A fixed cap on the candidates one pass handles | `DISPATCH_ABANDON_PER_PASS = 20`, exported beside the executor. Only the first twenty candidates get a verdict, a re-measure and an arm call. The rest are reported as kept (`pass-cap: next pass`) without being read. |
| The order is deterministic, oldest first | The candidates come from `CoordStore.stalledDispatchRunIds`, which orders by `dispatchStartedAt`, then `id`. The cap takes the head of that list. |
| The rest are handled on later passes | Each pass reads the candidates again. A run that was abandoned is terminal and is no longer a candidate, so the next twenty move to the head. |
| The switch-off path is unchanged | An off switch still reads nothing and never enters the serialiser, so the cap does not apply to it. |

**Why twenty.** Each candidate costs up to two measured registry reads inside the serialiser (the verdict and the arm's re-measure) plus one close transaction, so twenty caps one hold at forty registry reads. The lane runs once a minute, so twenty a pass still drains 1 200 runs an hour. That is far more than a failing dispatch path can leave behind, since each dispatch that never came back leaves one stalled run. The other lanes cap at two to eight a pass. This cap is wider because a candidate that is kept (a child marker names it, or the box minted without the marker) stays a candidate and takes a slot on every pass, oldest first. A newer dead run is only starved when twenty such kept runs are older than it.

**Residual.** The starvation above is not removed, only made unlikely. Twenty runs that are kept forever, all older than a dead one, would hold that dead one back until an operator abandons some of them. The operator's Abandon button still works on any of them.

**Tests.** `server/test/dead-dispatch-lane.test.ts`, block "the dead-dispatch pass cap (D-7502)". With 25 candidates, one pass hands exactly twenty to the arm, and they are the twenty oldest stamps. The runs are opened in reverse stamp order, so id order would pick different runs. With 41 candidates, the passes hand 20, 20, 1 and then 0 to the arm, and every run ends `failed` with one reason journaled and one mail sent. A third row pins the value at 20.

**Not in this change.** Settings' switchboard row for the act (`shared/switches.ts`, `server/test/switches.test.ts`) is a follow-up after the open change that edits those lines lands.
