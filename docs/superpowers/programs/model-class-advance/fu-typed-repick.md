# Follow-up: the automatic roll moves an idle session behind its class's model (typed-repick)

Programme `model-class-advance`, epic `anthropic-arm`, ticket `typed-repick`. Run 3403. Built on `main` with waves 3, 8
and 9 (#3221) and the follow-ups #3216, #3217, #3219, #3222 and #3223 in it. The coordinator's ruling (call 409): do not
type a `/model` re-pick into a running session; make "behind its class's id" one more reason for the existing roll.

## What changed

- **One predicate, two readers.** `aliasModelBehind` (`shared/model-aliases.mjs`) answers whether a running session of
  an Anthropic lane is on a model its class has left, age aside: the session has a routed class, the class has a target,
  the session's model (its long-context suffix removed) is of the class's family, is not the target, and is no other
  class's current or held id. The target is the hold's id while a hold stands (none when the hold names none), else the
  alias's id when the lane's build can launch it. Each class arrives as an `AliasClassView`, so each reader builds it
  from what it has: doctor from the aliases file and the advance entry, the roll from the lane-models read.
- **Doctor is unchanged.** `aliasSessionBehind` now builds the views and asks `aliasModelBehind` with `seen: false`,
  then applies its own two time rules as before (the render after the turn marker; the move at least a day old and the
  turn after it). `deploy/models-anthropic.mjs` did not change. Characterization came first: the doctor predicate's
  outputs were pinned on `main`, then the move landed with that pin green, then the behaviour change in its own commit.
- **The roll's third behind term.** `autoRollVerdict` (`server/src/coord/rollTarget.ts`) takes `model` (a `ModelFact`:
  `none`, `unread`, `unmeasured`, `current` or `behind`) and `rolledModelFor`. `modelBehind` sits beside
  `startedBeforeRelease` and `buildBehind`. The gates, the setting, the off switch, the pacing (one act a pass, the hold
  off) and the act (`ccd hibernate --roll`) are the same. A roll for the model carries `model: {class, from, to}`, and
  the roll's log line names it: `(behind its class's model: <class> ran <from>, its target is <to>)`.
- **The seen rule applies to the roll only.** Under `seen: true`, the alias's id is a target only once a launch has
  been seen on it (`seenId` equals the id; spec §2.5.6's canary). A held id needs no launch. An op too old to carry
  `seenId` reads as no launch seen.
- **The session side** comes from the row the pass already holds (`modelCandidateOf`): an Anthropic lane (the roster's
  `telemetry: anthropic`, the rule `isAnthropicLane` uses), a readable routing class that is one of the four (`default`
  and an unknown word are none), and a usage reading whose model is of that class's family. A row that fails any of
  these is `none` and its lane is never read for it.
- **The lane side** comes from the lane-models read (`readLaneModels`, the `ccrc models <lane> show` op the Models sheet
  reads), whose Anthropic answer #3221 added. A read that is not `read` (unreadable, busy, absent, unsupported, refused,
  not started, or a thrown call) is `unmeasured`. So is a read whose advance file is not `ok` or `absent`, because then
  the holds are unknown. Neither is ever behind.
- **No loop.** `RollSweepMemory.modelFor` keeps the target each session was last rolled for, as `builtFor` does for the
  build. A session whose relaunch kept the old id (a hand pick, or a class the relaunch does not carry) is rolled once per
  target. A newer target rolls it again. The memo is in-process and pruned with ids the pass no longer sees: a server
  restart costs at most one more roll per session and target.
- **Wiring** (`server/src/watch.ts`, three lines, with the consent of the holder of that file's claim): the
  `readLaneModels` import, `modelFor` in the roll's memory, and the two deps `laneModels` and `anthropicLane`. With
  either dep absent, no session is behind on its model.

## What the read costs

The lane's models are read only in the pass's measured step, and only when `autoRollVerdict` answers `read-models`.
That happens for a session that is behind on nothing else, has a model candidate, and passes every other gate (the
setting and role, the Overlord, `.no-roll`, the idle gate with its 90-minute quiet window, hibernation due, and the
compaction window). A session held at any gate is `current`, not a skip, because it may not be behind at all. Each
Anthropic lane is read at most once a pass (`Pass.models`). The act's re-check runs on the coordination serialiser and
reads the pass's answer. It never starts an op there. A read is one `ccrc models <lane> show` on the fleet box, which reads
that lane's aliases and advance files. The roll's cadence is hibernation's beat. In the steady state, one read per pass
per Anthropic lane that has an idle routed session. That includes a session already rolled for the current target,
because its target is known only from the read. A plain read joins a `show` already in flight for the same lane
(`showOnce`). An act's fresh read that meets the roll's read on the agent arm answers `busy`, and the sheet's next read
recovers it.

## Departures and gaps

- **doctor-no-seen-rule.** The brief describes the shared target as the class's launchable id that a launch has been
  seen on. Doctor's check on `main` does not apply a seen rule, and the brief also asks for doctor's output to stay byte
  for byte. So the predicate takes the rule as an option: the roll asks with it, and doctor without it. Doctor still names
  a session behind a day after a move that no fresh launch has confirmed. Adopting the rule there is a decision for
  later, not part of this change.
- **lane-view-hides-unlaunchable-ids.** For the hand-pick rule, doctor reads every other class's id from the aliases
  file, including an id the lane's build cannot launch. The lane-models read nulls such an id on a class that is not
  held. So the roll cannot see it, and a session running another class's unlaunchable id of its own family would read
  as behind. This needs one class's alias to resolve to an id of another class's family, which is also unlaunchable on
  the lane. It is recorded here, not guarded.
- **renewal-row-gap.** The sessions the roll leaves alone (the Overlord's, `.no-roll`, and long-lived sessions the
  renewal lane owns while continuity is live) are not moved by this change. The predicate does not fit the renewal lane
  as one more row. `renewalDue`'s rows are Table 3.3.11b's triggers (`shared/continuity.ts`), and a new trigger is a spec
  table change. The generations lane also has no lane-models read to feed one. The table's existing home for it is
  `evaluation-due` ("the skill, card template or model id is not the one minted with"), which the generations lane passes
  as unwired (W1). Wiring that row's model-id part from `aliasModelBehind`, with the same once-per-lane read, is the
  follow-up.
- **Codex lanes** are out of scope, as ruled: an idle Codex session picks up its settings at its next turn.

## Cases and mutation rows

Cases: a session on the old id after a move is rolled once at idle, with its line naming the class, the old id and the
target. It is not rolled when it is on the new id, at its held id while held, unrouted or `default`, on an unlaunchable
or unseen target, with an unreadable read or unknown holds, on a lane that is not Anthropic, or held at a gate. A
relaunch that keeps the old id is not rolled again for that target, and a newer target rolls it again. The lane is read
once a pass for two sessions on it. Doctor's pinned outputs are unchanged.

Mutation rows, each in its own `git archive` copy of the tip, each red alone (killed): the term removed; the memo
ignored in the verdict; the memo never written (rolls again); an unreadable read read as behind; unknown holds read as
none; the held id ignored, in the lane view and in the predicate; the seen rule dropped.
