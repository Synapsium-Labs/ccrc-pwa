# Mail and run truth: a draft never blocks, a parked mail comes back, a worker has a heartbeat (design)

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 0 (2026-10-20).

**Issues:** #600 (unsent text in a session's input box must never block mail delivery, wake-up or any other lane action), #125 (a rejected mail from a since-restarted session shows as `unreadMail` forever), #119 (a worker has no heartbeat, and run-row counters lag).

**Plan:** `docs/superpowers/plans/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md`. D-numbers are defined there, never here.

**Citations** are to `origin/main` `397be1ec5`, written `≈:` beside a function or constant name. **[B]** marks a read-only reading of an installed Claude Code 2.1.303 binary on a development machine (byte search, nothing executed). **[C]** marks a reading of this tree's code. No fleet box was touched: the incidents below are as the issues report them.

**Builds on, and must fit:**
- `2026-10-19-ccrc-consolidation-wave-design.md` (draft rev 1, on `docs/consolidation-wave-spec`): contexts C3 (Session Conversation) and C5 (Coordination), clusters K3, K4, K6, K8 and K10, waves W1a, W2, W6 and W7. §6 below maps every change onto them.
- `2026-08-10-architecture-ddd-clean-solid.md`: the rings, and "an adapter may not narrow a distinction it received".
- `2026-09-29-worker-stall-watch-design.md`: the turn marker, `sweepStalls` and its `mail-stuck` arm.
- **D1, in flight:** "mail is never parked while the recipient lives". It changes the same lane (`sweepMail`'s attempt-budget park). This design sits on top of it and assumes it has landed; §7 says what changes if it has not.

---

## In short

- **#600: the lane stops refusing a draft. It stashes it, delivers, and Claude Code puts it back.** Claude Code's own prompt stash (`chat:stash`, `ctrl+s` by default [B]) saves the box's text, cursor offset, input mode and pasted contents, and restores them by itself after the next submit [B]. The lane's typing helper, `sendPrompt`, gains one draft policy, `stash`, that every lane caller uses. The human send from the PWA keeps its own refuse-or-replace choice.
- **#600: the placeholder hint and a stranded `/clear` stop blocking.** The placeholder is a rendering, so the box reader classifies it as empty, held by a captured-pane corpus. A `/clear` the system stranded is cleared on proof, as today. Any other `/clear` is someone's draft and is stashed like any other.
- **#600: a long wait is noticed by the owner that already exists.** That owner is the stall watch's `mail-stuck` arm: one notice per delivery, to the operator, recorded once. No new notifier is added.
- **#125: a mail parked because its recipient was gone comes back when the recipient does.** The store queues an heir delivery (the shape `requeueAbandonedMail` already uses), and `unreadMail` stops counting a park that has an heir. A park on a closed run already stops counting.
- **#125: `items.done` measures work-item acks, which the coordinator settles after a verified wave-done.** It is not branch progress, and this design does not make it so. Branch progress is a separate fact, left for its own issue.
- **#119: `RunSummary.workerLastSeen` and `workerTurn` come from the worker's turn marker.** The stall sweep already reads that marker. The read moves ahead of the `stall-watch-disabled` gate, so the heartbeat never depends on the stall lane's arming.
- **#119: a run leaves `dispatched` on its own once the worker has acked mail on it.** Both facts are on the server's clock. A coordinator's later `{"to":"working"}` answers `ok` with nothing changed, instead of `bad-transition`.

## 1. The problem, measured

### 1.1 A draft parks mail (#600)

- **The refusal.** `sendPrompt` (`server/src/inject/send.ts` ≈:835) reads the box with `draftOfMeasured` (≈:183). Any text, or any content below the marker row (`hasContentBelowMarker` ≈:1327), takes the draft arm. Unless the caller holds one of three proofs (`resumeIfOwn`, `clearMailResidue`, `ownStrandedClear`) or asked for `replaceDraft`, it returns `{ok:false, error:'draft-present'}` (≈:988) [C].
- **The lane's answer.** `sweepMail` (`server/src/watch.ts` ≈:7071) calls `sendPrompt` at ≈:7630 with no `replaceDraft`. On `draft-present` it tells the sender once (`tellSender`, "the recipient's input box has unsent text in it", ≈:7777) and backs off. At `MAIL_MAX_ATTEMPTS` (6, `shared/api.ts` ≈:4976) it parks the delivery `rejected`/`undeliverable` (≈:7765–7772) [C]. D1 removes that park while the recipient lives. The refusal itself remains, so the mail would still never land.
- **The cost, as #600 reports it.** A worker's `wave-done` to its coordinator hit `draft-present` on every attempt and was parked. The coordinator was never woken, and the programme sat idle for about 13 hours until the operator asked for a status. The same coordinator had lost an earlier mail the same way, and a fresh session's dim "Try …" placeholder had once parked every mail to a worker.
- **Every pane-typing site in the server** [C]:

  | Site | Call | Draft handling today |
  |---|---|---|
  | mail lane (briefs, nudges, stall notices, coordinator mail) | `sweepMail` ≈:7630 | refuses `draft-present` |
  | the `/clear` before a resumed wave | `dispatchRun` (`coord/dispatch.ts` ≈:1137) | refuses `draft-present` |
  | idle compact nudge | `watch.ts` ≈:6714 | refuses `draft-present` |
  | the operator's own send from the PWA | `server.ts` ≈:2103 | refuses, or replaces when asked (`replaceDraft`) |
  | `submitEnter` (the PWA's rescue) | `server.ts` ≈:2610 | presses Enter on text the PWA proved is the box's |
  | dialog answers | `inject/ask.ts` ≈:175 and `answerDialog*` | keys into a menu, not the box |

  Stall nudges (`stall-check:`, `stall:`) are mail, so they ride the first row. The `ccd` typing sites (`/effort`, `/model`, the resume prompt, `_compact`) act on a session ccd is starting or driving through its own menus. They are box-side, outside the server, and out of scope (§9).
- **The placeholder.** `draftOfMeasured` strips `\e[2m…\e[0m` spans (`DIM_SPAN` ≈:152), which covers the placeholder in every capture this tree pins [C]. #600 reports a placeholder read as a draft anyway, so at least one rendering escapes `DIM_SPAN`. No capture of it is in the tree.

### 1.2 What Claude Code's stash does [B]

Read from Claude Code 2.1.303:

- **The binding.** The `Chat` context binds `"ctrl+s":"chat:stash"`. It is listed in the help as "stash prompt", and a user's keybindings can rebind it.
- **The toggle.** If the box is non-empty, it calls `stash()` and shows "stashed · ctrl+s to restore". If the box is empty and a stash is held, it calls `popStash("input")`.
- **What `stash()` saves.** It saves `{text: value, cursorOffset, mode, pastedContents, cameBack}` (plus a launch warning) into the input store's `stash` field, which **replaces** any stash already held.
- **The automatic restore.** On submit, `if (stashedPrompt !== undefined && …) popStash("outside")`, with the notice "Draft restored". A second path does the same after a command finishes, when the box is empty. That second path is what makes a slash command such as `/clear` restore the stash too. The probe in plan Task P1b Step 0 confirms it live.

So the stash holds what tmux cannot read back: the contents behind a paste chip, attached images, the input mode and the cursor. It also restores the draft *inside* Claude Code at submit time, so no keystroke of ours races the new turn.

### 1.3 Parked mail outlives its cause (#125)

- **The park.** When the recipient's registry row reads a dead-shaped lifecycle (`orphan` among them), a never-delivered row is parked `rejected`/`undeliverable` with `lastError: "recipient session is <lc>"` once attempts reach the ceiling (`watch.ts` ≈:7487) [C].
- **Nothing reopens it.** A `rejected` row is terminal (`TERMINAL_DELIVERY_STATES`, `shared/api.ts` ≈:4962). `dueDeliveries` never selects it, and no sweep looks at it again.
- **It keeps counting.** `unreadMailCount` (`coord/store.ts` ≈:4183) counts `OUTSTANDING_OR_ABANDONED_SQL` (≈:1391). That includes every `rejected` row whose `lastError` is not a deliberate cancel and whose run is not terminal (`ABANDONED_PARK_SQL` ≈:1292). So a lifecycle park on an open run counts toward `unreadMail` forever [C], which is what #125 observed: a run reading `unreadMail: 1` eleven days after its worker came back.
- **`items.done` is an ack count.** `itemTally` (≈:4703) counts `work_items` in state `done`. The coordinator sets them only after a verified advance (`ccd/coordinator-skill/SKILL.md` "Re-measure a claimed `wave-done`" step: "Once — and only once — that advance answers `ok`, settle the wave's work items"). A wave in progress reads `0/N` by design.

### 1.4 No heartbeat (#119)

- **The hold is no heartbeat.** It is written once, at dispatch. #119 measured its mtime equal to `run.dispatchedAt` to the second on every held worker.
- **The marker is.** The worker's turn marker (`$REG/<id>.turn.json`, written by `ccd/session-hook.sh` on every main event, read by `readTurnMarkMeasured`, `server/src/turnmark.ts` ≈:74) changes on every turn and refuses a foreign or stale line [C]. `sweepStalls` already reads it for each run worker (`judgeStall`, `watch.ts` ≈:6222, through `stallMarkRead`). But `sweepStalls` returns before reading anything while `stall-watch-disabled` stands (≈:6084), and it ships nothing on the run.
- **No server path leaves `dispatched`.** `RUN_TRANSITIONS` (`shared/api.ts` ≈:4811) gives `dispatched` the edges `working`, `closing` and `failed`. The only writer of `→ working` is `POST /api/runs/:id/advance` (`coord/routes.ts` ≈:1765), which the coordinator calls "once the worker is genuinely underway" (`references/wave-lifecycle.md` §4). A coordinator that never sends it leaves the run in `dispatched`, and `dispatched` has **no** `awaiting-review` edge, so even a verified wave-done is then refused `bad-transition`.

## 2. #600: delivery never depends on an empty box

### 2.1 Which delivery mechanism

| Option | What it does | Verdict |
|---|---|---|
| A. A turn-boundary queue | wait for the recipient's next turn | **Rejected.** An idle recipient takes no turn, so the mail never lands; this fails acceptance 1, as the triage noted. |
| B. Save with tmux, clear, deliver, retype | read the draft from the capture, clear it with `C-u`, send, type the draft back | **Rejected.** The capture holds no paste contents (a chip reads `[Pasted text #1 +40 lines]`), no images, no input mode and no cursor, so the restore cannot be byte for byte. Retyping while the new turn runs races any menu the turn raises: a typed digit or Enter answers a permission prompt. Restoring later, at the next idle, needs the draft held durably on the server, and still appends onto anything typed in between. |
| C. An out-of-box channel | a path into an idle session that is not its input box | **Rejected for now.** No such channel is reachable through this tree's exec surface (`EXEC_COMMANDS = ['tmux','ccd']`). Claude Code's channel feature needs every session launched with a flag and a server of its own. That is a launch-path change across the fleet with its own design, recorded in §9. |
| **D. Claude Code's own stash** | `ctrl+s` saves the draft inside Claude Code; send; Claude Code restores it on submit | **Chosen.** It is byte for byte (text, paste contents, mode and cursor are all in `stash()` [B]), the restore is Claude Code's own at submit time so no keystroke of ours races the turn, and it needs one key the tmux port already sends (`sendKey`). |

**The stash carrier, step by step,** inside `sendPrompt`, inside the per-session `KeyedQueue` as every send already is:

1. **The existing rungs run first, unchanged.** `resumeIfOwn` (our own unsubmitted text: press Enter), then `clearMailResidue` or `ownStrandedClear` (our own machine text: clear it), then the new policy.
2. **Guard on a held stash.** If the pane shows Claude Code's held-stash indicator, the carrier refuses `stash-occupied` and nothing is pressed. `stash()` replaces a held stash [B], so stashing over one would destroy the operator's earlier text. Plan Task P1b Step 0 measures whether such an indicator renders. If none does, see §8 O1.
3. **Stash.** Send `C-s` once.
4. **Verify the stash.** Re-capture within a budget. The box must read present and empty, with no content below the marker. If it does not (the key is rebound, a Claude Code version without the stash, a menu opened), the carrier presses nothing more and refuses `stash-failed`. The draft is untouched, because `stash()` either ran whole or did not run.
5. **Type and submit** exactly as the proven-empty path does today: the echo check, then `pressEnterAndConfirm`.
6. **Verify the restore.** After the submit is confirmed, re-capture within a budget. The box must read back the draft read in step 2 (`boxText`, so a chip compares as the chip row it rendered as).
   - **Restored:** the result is `{ok:true, draft:'restored'}`.
   - **Not restored within the budget:** if the box is empty, send one `C-s`, which pops the stash [B], and verify again. If it still does not match, the result is `{ok:true, draft:'restore-unverified'}` and a `console.warn('ccrc-server: …')` line is logged. The message *was* delivered, and the draft is still in Claude Code's stash, where `ctrl+s` brings it back.

**Not chosen within D:** pressing `C-s` blind with no verification, and treating "the box looks unchanged after `C-s`" as proof the text was a placeholder. That inference is false whenever `ctrl+s` is rebound, and acting on it would type onto a human's draft.

### 2.2 The placeholder hint and a stranded `/clear`

- **The placeholder** is recognised by the box reader, not by the lane. `draftOfMeasured` keeps one rule: text rendered dim is not input. Plan Task P1a widens `DIM_SPAN` to every dim encoding Claude Code emits (the combined `\e[2;…m` forms and a dim-off `\e[22m` terminator, besides the bare pair). It pins a captured-pane corpus: placeholder variants, a multi-line draft, a paste chip, an image chip, a stranded `/clear` and a box taller than the capture.
  - The corpus is built so that consolidation K8 adopts it whole: it is ARCH-24's fixture set for the box.
  - A placeholder that escapes the reader is no longer a park, but it is still a wait. Claude Code does not count a placeholder as input, and `stash()` runs only when `value.trim() !== ""` [B]. So the carrier's `C-s` saves nothing (or, with a stash held, pops it, which step 2's guard refuses before any key is sent), and the box still reads the escaped text. Step 4 then fails `stash-failed`, the lane backs off, and `mail-stuck` reports it with that word. The carrier never types onto a box it could not prove empty. **The corpus is what keeps that path empty.**
- **A stranded `/clear`:**
  - **Typed by this system and proven** (`ownStrandedClear`, the durable `clear-refused:enter-ignored` run event): cleared and not restored, exactly as today. It is our text.
  - **Not proven:** it is somebody's draft. It is stashed, the delivery lands, and Claude Code restores the `/clear` to the box, unsent, as it found it.

  Neither case blocks.

### 2.3 One helper for every pane-typing site

The owner stays `sendPrompt`. No parallel typing path is added (CLAUDE.md, "one owner per job").

- **The option.** Its `replaceDraft?: boolean` becomes `onDraft: 'refuse' | 'replace' | 'stash'`, with one reader. `refuse` is the default, so a caller that names nothing keeps today's safe behaviour.
- **The callers:**

  | Caller | `onDraft` |
  |---|---|
  | `sweepMail` (every mail: briefs, nudges, stall notices) | `stash` |
  | `dispatchRun`'s `/clear` | `stash`. Claude Code's post-command restore puts the draft back after `/clear`, confirmed by Task P1b's probe. |
  | the idle compact nudge | `stash` |
  | the PWA's human send (`server.ts` ≈:2103) | `replace` when the body asks for it, `refuse` otherwise. The operator is the one typing, and the PWA already shows their draft in its own sheet when the send is refused (`Composer.tsx`). The operator's ruling binds the lanes, not this choice. |

- **The word `draft-present` stays only on the human send's path.** No lane can receive it: a pin asserts that every lane call site passes `stash`. The mail sweep's `draft-present` arm, including `tellSender("…unsent text…")` and the back-off keyed on it, is deleted. That deletion is acceptance 2.
- **New refusal words** (additive on `SendResult`): `stash-occupied` and `stash-failed`. Under D1, both are back-offs that never park while the recipient lives, like `dialog-open` and `box-unreadable` today.

### 2.4 A long wait is noticed once

There is a real choice here: K6's `notify()` funnel does not exist on `main` yet (it is W1a), and a hand-written `log.record` plus `recordFeedEvent` pair is exactly what K6 deletes. Neither is used.

**Chosen: the stall watch's existing `mail-stuck` arm** (`stallMailStuckVerdicts`, `coord/stall.ts`). It is one verdict per queued delivery addressed to the session, keyed on the delivery id, sent to the operator, and recorded once as an observation row, so a restart never re-sends it. It already reports past every gate a wait can show (`stallMailStuckInner`: "a dialog is one of the gates mail-stuck reports past"). Its window is `MAIL_STUCK_MS`, 72 minutes. When W1a lands, the stall lane's push moves into `notify()` as one more writer with its mode pinned, which needs no change here.

- **The notice text.** The notice gains the delivery's `lastError` word: `stash-failed`, `stash-occupied`, `dialog-open`, `box-unreadable`, `auto-continue-armed` or `turn-running`. That is acceptance 6's "with the recipient and the reason".
- **Arming is the operator's existing control.** `mail-stuck` is a wave-2 arm, so it records in shadow until the stall-watch level in Settings includes wave 2. That is an operator act, not a decision this design takes (§8, acts).

### 2.5 The protocol text

The skills describe refusal as deliberate. They are rewritten to the new contract:
- the coordinator's `references/mail-envelope.md` section "`lastError: "draft-present"` — the recipient's input box is occupied" (≈:93, and its ≈:148 back-off note);
- the worker skill's clause 4 ("Keep your input box empty …") and its ≈:281 note;
- the reviewer skill's clause 9 sentence ("Keep your input box empty: a half-typed draft makes the delivery lane refuse `draft-present`").

The new text says: a draft in your box never stops mail; the lane stashes it and Claude Code restores it after the delivery; if you see "Draft restored", that is why. Each skill's clause count is unchanged. The pinned tests (`worker-skill.test.ts`, `reviewer-skill.test.ts`, `coordinator-skill.test.ts`) take the new text verbatim.

## 3. #125: parked mail comes back with its recipient

### 3.1 Requeue or mark dead

| Option | Verdict |
|---|---|
| Mark the parked row terminally dead once the recipient is live | **Rejected.** It throws away the message, and the parked rows are exactly the ones nobody read: #600's `wave-done` is one. A dead mark would also need a write to a terminal row, which every guard in the store refuses (`TERMINAL_DELIVERY_SQL`). |
| Reopen the parked row in place | **Rejected.** That is a terminal row going back to `queued`, which breaks the invariant `mail-hardening.test.ts`'s writer scan pins. |
| **Queue an heir delivery for the same mail, and derive the parent's retirement in the read** | **Chosen.** `requeueAbandonedMail` (≈:2360) already queues an heir (`queueDelivery` plus `setDeliveryEnvelope`, "queues the heir a NEW delivery") with a `NOT EXISTS` dedupe. Orchestrator ruling I2(a) ("run close clears by derivation, not mutation") is the precedent for the read side. |

**What is revived.** A delivery qualifies when all of these hold:
- it is `rejected` with `rejectCode = 'undeliverable'`;
- its `lastError` is one of the **lifecycle parks**, `recipient session is <lc>` for a lifecycle the park arm treats as dead-shaped, or a legacy `draft-present` park from before this design;
- its run is open (`COALESCE(rr.state,'') NOT IN TERMINAL_RUN_STATES_SQL`, the same clause `ABANDONED_PARK_SQL` already uses);
- it has no outstanding heir;
- its recipient now reads live.

**What is not revived:**
- a deliberate cancel (`DELIBERATE_CANCEL_ERRORS_SQL`);
- the replay-ceiling park, which has its own ack door (`markAcked`'s I2(b) exception);
- an `enter-ignored` park;
- a registry-absent park (`recipient not in registry`): an absent id is not a session that came back.

**"Reads live"** is decided once. The park arm's lifecycle test (≈:7487) is extracted into one pure L1 predicate, which the park and the revive both call. They cannot drift apart. It is the predicate K3's `readSession` absorbs in W2.

- **Where it runs.** `sweepMail`'s first act, over the tick's fleet listing (the live ids), calls one store method, `reviveParkedDeliveries(liveIds, now)`. It returns a typed result `{revived: number[]}` and never `void`: CLAUDE.md's open list names nine `void` delivery writers, and this design adds no tenth.
- **The heir.** The heir carries the ordinary envelope, rendered as `requeueAbandonedMail` renders it, and the sender is told once (`tellSender`, keyed `mail-revived-<deliveryId>`).

### 3.2 `unreadMail` once the recipient is live

**Chosen: `ABANDONED_PARK_SQL` gains one derived clause.** A parked row with a later delivery of the same mail to the same recipient (`h.mailId = d.mailId AND h.toId = d.toId AND h.id > d.id`) is not abandoned: its heir carries the attention now. The heir counts while it is outstanding, as any queued mail does. So `unreadMail` counts the message once, then zero once the heir is acked.

- **Readers this touches,** each re-checked by the plan:
  - `unreadMailCount`;
  - `mailForRecipient` and `outstandingMailFor` (the MailStrip);
  - `requeueAbandonedMail`'s coordinator arm. Its source is `ABANDONED_PARK_SQL`, so a revived parent leaves that source, and the heir must be visible to that arm in its place. Plan Task P1e pins "a revived heir to a later-displaced coordinator is requeued to the new coordinator".

### 3.3 What `items.done` measures

**Decided: work-item acks, as today.** The coordinator settles them after a verified advance (§1.3). Making the count follow the branch would give one field two meanings, which is the overloaded-value defect the 08-10 spec names.

The reader's real question, whether the worker is alive and making progress, is answered by #119's heartbeat (§4) and by the branch fingerprint the coordinator already re-measures. A branch-progress fact (commits ahead, tip time) is wider than mail: it belongs to C4's workspace reading, so it is split off (§9). The `RunSummary.items` docstring says what the tally counts, so a reader stops assuming.

## 4. #119: a heartbeat, and a run that leaves `dispatched`

### 4.1 `workerLastSeen`

| Option | Verdict |
|---|---|
| The transcript's mtime (#119's suggestion) | **Rejected.** It is one more fleet read per run per sweep, with no identity check: a transcript can belong to a previous Claude Code session of the same id. The marker carries the session's own uuid and is refused `foreign` or `stale` when it does not match. |
| A new hook write | **Rejected.** The marker already exists, and adding one would put a second writer on the job. |
| **The turn marker the stall sweep already reads** | **Chosen.** It costs no new read. |

- **The wire.** `RunSummary` gains `workerLastSeen: number | null` (the marker's `at`, fleet clock, epoch ms) and `workerTurn: 'working' | 'done' | 'failed' | null`. Both are additive and absence-permits. An older server omits them, and a reader treats absence as unknown.
- **Why `workerTurn` too.** A marker changes only on main events, so a long turn shows an old `at` while `workerTurn` reads `working`. Without it, a long-thinking worker would look dead, which is #119's very complaint.
- **Storage.** Two columns on `runs`, `workerSeenAt` and `workerTurn`, in migration 27 (additive: `COORD_SCHEMA_VERSION` is `MIGRATIONS.length`, 26 today). One store writer, `noteWorkerSeen(runId, at, turn)`, which updates only when `at` advances, so it is monotonic and idempotent and costs one write per worker turn, not one per sweep. It returns a typed result.
- **One read, ahead of the gate.** `sweepStalls` gains a first pass over the open runs' workers. It reads each marker once into a per-sweep map, records `noteWorkerSeen`, and only then reaches `if (arming.disabled) return`. `judgeStall` takes its marker from that map instead of reading again. The heartbeat therefore lives whatever the stall lane's arming. This adds no read when the lane is enabled, and while it is disabled it costs one agent read per active run, which the dispatch cap bounds. That fits the tick-diet budget's per-sweep (not per-tick) cadence.
- **Which marker is the worker's.** The run's `sessionId`, with the registry uuid as the reader's identity check, as `judgeStall` does today. K10's `RunBinding` replaces that with `bindingOf(incarnation)` in W6. This pass is one of the sites W0's census counts.

### 4.2 `dispatched → working`

| Option | Verdict |
|---|---|
| On the first turn mark after `dispatchedAt` | **Rejected as the trigger.** `dispatchedAt` is the server's clock and the marker's `turnAt` is the fleet box's. Two boxes' clocks skew, and a skew of seconds makes a turn that ended the previous wave read as "after dispatch". |
| On the coordinator's `advance` only (today) | **Rejected.** It leaves runs in `dispatched` (#119), and `dispatched` has no `awaiting-review` edge, so a forgotten step blocks the wave-done. |
| **On the worker's first ack of mail on this run** | **Chosen.** The worker skill acks before acting, so an ack proves the brief was read, and `ackedAt` and `dispatchedAt` are both server-clock columns in one database. |

- **The decider** is pure L1 in `coord/`, `workerUnderway(run, firstAckAt)`. It answers true when `run.state === 'dispatched'`, the run's kind has the `dispatched → working` edge (`transitionsFor(kind)`), and a delivery to `run.sessionId` on this run was acked at or after `run.dispatchedAt`.
- **The executor** is the same first pass of `sweepStalls`, through `store.advance(runId, 'working', 'worker-underway')`. Both states are in `ACTIVE_RUN_STATES`, so no dispatch-cap slot changes and the move needs no cap check.
- **This is run truth, not a stall verdict.** The stall lane still "never closes, reclaims or re-dispatches". The pass shares the sweep only to share its read and its cadence.
- **The coordinator's `{"to":"working"}` on a run already `working`** answers `{ok:true, from:'working', to:'working', unchanged:true}`, writes no row and no event, and checks nothing further. The field is additive. Every other `→ working` edge (`awaiting-review` send-back, a lost merge race from `merging`) is unchanged.
- **The coordinator's text changes too.** `references/wave-lifecycle.md` §4 says the server now moves a run to `working` when the worker first acks mail on it, and that sending `{"to":"working"}` remains harmless.

## 5. What must not break

- **The auto-swap and account switching are never blocked.** Nothing here touches `ccd`'s swap path, `_swap_idle_gate`, or any swap route.
- **No herd restarts.** The changes are server and skills only. The skills reach homes through `ccrc update`'s install spine, and no session is restarted to apply them.
- **The mail gate's idle.** `mailTurnIdle`'s rules are unchanged: the stash carrier runs only after the gate has delivered.
- **The precedence of `sendPrompt`'s rungs.** `resumeIfOwn` comes before the residue and stranded-clear proofs, which come before `onDraft`. The proof-gated clears still never touch human text.
- **The auto-continue hold and `refuseIfTurnRunning`** keep their order before any key is sent. `C-s` is never pressed on an armed pane or a running turn.
- **The human send.** The PWA's `draft-present` sheet and `submitEnter` are unchanged, and no `pwa/` file is edited (consolidation rule 8).
- **Delivery terminality.** No terminal row is written. The heir is a new row, and the parent's retirement is derived in the read.
- **Coordinator-first routing.** Questions are untouched.
- **The ccrc SAFETY rules.** No `ws-*` verb, unit or tmux on a fleet box is touched by any test. Every pane test runs against a fake `Tmux` over captured fixtures, and the stash probe runs on a disposable local session on a development machine.
- **Hibernation's contract.** A hibernated session is not dead-shaped to the revive predicate, exactly as `measureClaimant` reads it. Mail to it waits as it does today.
- **Wire discipline.** Every new field is additive (`FLEET_PROTO` unchanged), with a single reader each.
- **The public repo.** Fixtures use neutral ids (`project-a`, `lane-a`).

## 6. Fit with the consolidation contexts and waves

| Change | Context | Cluster | When it lands, relative to the consolidation |
|---|---|---|---|
| Box reader corpus, placeholder | C3 | K8 (pane grammar; this is ARCH-24's box corpus) | Before W2. K8 later moves `draftOfMeasured` into `server/src/pane/` with the corpus unchanged. |
| `onDraft: 'stash'` in `sendPrompt` | C3 | none: it is the one typing owner | Now. The consolidation spec sequences #600 first, ahead of ARCH-19/K5 and K8. |
| Lane callers on `stash` | C3 and C5 | K4's `keystroke` policy is unchanged | Now. It edits `sweepMail` before ARCH-19 moves its policy into `coord/`. ARCH-19 moves a policy with no draft arm. |
| `mail-stuck` names the reason | C6 via the stall lane | K6 | Now. W1a moves the push into `notify()` as one writer. |
| Revive and derived `unreadMail` | C5 | STORE (ARCH-15's guarded delivery writer); K3 later supplies "reads live" | Now, with the extracted lifecycle predicate. W2 re-homes it onto `readSession`. |
| `workerLastSeen`, `workerTurn` | C5 (Run) fed by C1's marker reading | K4 (`TurnReading`) and K3 | Now, in `sweepStalls`' existing read. W2 moves the read under `SessionReading`. |
| `dispatched → working` on first ack | C5 (Run) | K10 (`RunBinding`) | Now. W6 replaces `run.sessionId` equality with `bindingOf`. The pass is a census site. |
| PWA showing `workerLastSeen` | C3/C5 PWA half | K14 | **W7 only.** Nothing here edits `pwa/`. |

Rule 6 of the consolidation (one `watch.ts` series at a time) is honoured. The plan's tasks that edit `watch.ts` are serial. The consolidation's W1a, when it starts, rebases onto whatever of this has merged.

## 7. If D1 has not landed

D1 is "mail is never parked while the recipient lives". Without it, `stash-failed` and `stash-occupied` would still park at `MAIL_MAX_ATTEMPTS`, as `dialog-open` does today. The plan therefore gates the lane task (P1c) and the revive task (P1e) on D1. The box reader (P1a) and the stash carrier (P1b) do not depend on it.

## 8. Operator questions and acts

**O1, open only if the probe finds no held-stash indicator.**
- **The risk.** `stash()` replaces a held stash [B]. If Claude Code shows nothing in the pane while a stash is held, the lane cannot tell a box whose operator has already stashed something from one whose operator has not. Stashing over a held stash would destroy the earlier text.
- **The default this design ships:** the carrier is **disarmed**. `onDraft:'stash'` answers `stash-occupied` without pressing anything, so a draft waits, never parks (D1), and `mail-stuck` names it.
- **The question:** "May the lane stash a draft when it cannot see whether an earlier stash is held, accepting that a second stash replaces the first?"

If the indicator exists, O1 does not arise.

**Operator acts (no decision):**
- For acceptance 6 to push rather than record, the stall-watch level in Settings must include wave 2. If it already does, nothing is needed.
- The skill text reaches each home at the next `ccrc update`.

## 9. Out of scope

- **Branch progress on the run row** (commits ahead, tip time). It is a C4 workspace fact and gets its own issue.
- **Showing `workerLastSeen` in the PWA.** That is W7.
- **`ccd`'s own pane typing at session start** (`/effort`, `/model`, the resume prompt, `/compact`). It is box-side and drives a session ccd itself is starting.
- **An out-of-box channel into Claude Code** (§2.1 C). It needs its own design.
- **The delivery-row writers that still return `void`.** They are on CLAUDE.md's open list and are not widened here, except that the new writers are typed.
- **Inverting the feed's authority.** That is consolidation §6 O11.

## 10. Tests

Each task's red-first rows and mutation table are in the plan. The acceptance tests per issue:

**#600:**
- **Acceptance 1 and 5:** a fake `Tmux` over a captured idle pane with a draft. The delivery lands, `C-s` precedes the typed text, the box reads the draft back after submit, and the old refusal returning turns the case red.
- **Acceptance 2:** a source scan proves no lane call site passes anything but `onDraft:'stash'`. A sweep over a draft pane never writes `lastError:'draft-present'`.
- **Acceptance 3:** each of the three lane sites drives a draft pane and asserts the draft survives.
- **Acceptance 4:** the placeholder corpus reads empty, and an unproven `/clear` is stashed and restored.
- **Acceptance 6:** `stallMailStuckVerdicts` fires once for a delivery waiting past `MAIL_STUCK_MS` on `stash-failed`, and its body names the word.

**#125:**
- A lifecycle-parked delivery on an open run is revived once when its recipient reads live, and not while it reads dead.
- `unreadMail` reads 1 and then 0 after the heir's ack.
- A closed run's park is never revived.
- A replay-ceiling park is never revived.
- The coordinator requeue arm sees the heir.

**#119:**
- `workerLastSeen` advances monotonically.
- A `stall-watch-disabled` box still records it.
- A foreign or stale marker records nothing.
- A run moves `dispatched → working` on the worker's first ack after dispatch, and not on an ack before it.
- The coordinator's `{"to":"working"}` on a `working` run answers `ok` and `unchanged`, with no event row.
- `run-states.test.ts` stays green.
