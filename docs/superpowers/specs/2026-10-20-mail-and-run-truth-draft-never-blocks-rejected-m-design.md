# Mail and run truth: a draft never blocks, a parked mail comes back, a worker has a heartbeat (design)

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 1 (2026-10-20): rev 0 with one review applied (the plan's §Review log); D1 is re-grounded on #821.

**Issues:** #600 (unsent text in a session's input box must never block mail delivery, wake-up or any other lane action), #125 (a rejected mail from a since-restarted session shows as `unreadMail` forever), #119 (a worker has no heartbeat, and run-row counters lag).

**Plan:** `docs/superpowers/plans/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md`. D-numbers are defined there, never here.

**Citations** are to `origin/main` `643c76cd4`, and to #821's branch where marked **[D1]**, written `≈:` beside a function or constant name. **[B]** marks a read-only reading of an installed Claude Code 2.1.303 binary on a development machine (byte search, nothing executed). **[C]** marks a reading of this tree's code. No fleet box was touched: the incidents below are as the issues report them.

**Builds on, and must fit:**
- `CLAUDE.md`'s "Architecture direction" section (#818): one owner per job; consolidate into the existing owner, never add a parallel mechanism.
- `2026-10-19-ccrc-consolidation-wave-design.md` (rev 2.1, on `origin/main` through #819): contexts C3 (Session Conversation) and C5 (Coordination), clusters K3, K4, K6, K8 and K10, waves W1a, W2, W6 and W7. §6 below maps every change onto them.
- `2026-08-10-architecture-ddd-clean-solid.md`: the rings, and "an adapter may not narrow a distinction it received".
- `2026-09-29-worker-stall-watch-design.md`: the turn marker, `sweepStalls` and its `mail-stuck` arm.
- **D1 is #821** (open; "park a live recipient's mail instead of rejecting it undeliverable", #754). It changes the same lane. A live recipient's failing row is no longer rejected: it stays `queued` with `parkedAt`, `parkReason`, `parkBox` and `parkEscalatedAt` (its migration 27), wakes when the box changes or every 10 minutes, tells the sender once by system mail, pushes the operator once (tag `mail-parked-<delivery id>`), and after 24 h parked is rejected with `lastError` `parked 24 h, never delivered: <reason>` [D1]. The lifecycle rungs for a dead, stopped or purged recipient still reject, as on `main`. This design sits on top of #821 and is gated on its merge; §7 says what that gate holds.

---

## In short

- **#600: the lane stops refusing a draft. It stashes it, delivers, and Claude Code puts it back.** Claude Code's own prompt stash (`chat:stash`, `ctrl+s` by default [B]) saves the box's text, cursor offset, input mode and pasted contents, and restores them by itself after the next submit [B]. The lane's typing helper, `sendPrompt`, gains one draft policy, `stash`, that every lane caller uses. The human send from the PWA keeps its own refuse-or-replace choice.
- **#600: the placeholder hint and a stranded `/clear` stop blocking.** The placeholder is a rendering, so the box reader classifies it as empty, held by a captured-pane corpus. A `/clear` the system stranded is cleared on proof, as today. Any other `/clear` is someone's draft and is stashed like any other.
- **#600: a long wait is noticed by the owner that already exists.** Under D1 (#821) a delivery the lane cannot land parks, and D1's own `mail-parked` push tells the operator once, naming the recipient and the reason. This design adds no notifier and changes none.
- **#125: a mail parked because its recipient was gone comes back when the recipient does.** The store queues an heir delivery (the shape `requeueAbandonedMail` already uses), and `unreadMail` stops counting a park that has an heir. A park on a closed run already stops counting.
- **#125: `items.done` measures work-item acks, which the coordinator settles after a verified wave-done.** It is not branch progress, and this design does not make it so. Branch progress is a separate fact, left for its own issue.
- **#119: `RunSummary.workerLastSeen` and `workerTurn` come from the worker's turn marker.** The stall sweep already reads that marker. The read-only heartbeat moves ahead of the `stall-watch-disabled` gate, so it never depends on the stall lane's arming. Nothing that writes run state moves ahead of it.
- **#119: a run leaves `dispatched` on its own once the worker has acked mail on it.** Both facts are on the server's clock. A coordinator's later `{"to":"working"}` answers `ok` with nothing changed, instead of `bad-transition`.

## 1. The problem, measured

### 1.1 A draft parks mail (#600)

- **The refusal.** `sendPrompt` (`server/src/inject/send.ts` ≈:835) reads the box with `draftOfMeasured` (≈:183). Any text, or any content below the marker row (`hasContentBelowMarker` ≈:1327), takes the draft arm. Unless the caller holds one of three proofs (`resumeIfOwn`, `clearMailResidue`, `ownStrandedClear`) or asked for `replaceDraft`, it returns `{ok:false, error:'draft-present'}` (≈:988) [C].
- **The lane's answer.** `sweepMail` (`server/src/watch.ts` ≈:7071) calls `sendPrompt` at ≈:7630 with no `replaceDraft`. On `draft-present` it tells the sender once (`tellSender`, "the recipient's input box has unsent text in it", ≈:7777) and backs off. At `MAIL_MAX_ATTEMPTS` (6, `shared/api.ts` ≈:4976) it parks the delivery `rejected`/`undeliverable` (≈:7765–7772) [C]. D1 (#821) turns that reject into a `queued` park that wakes when the box changes [D1]. The refusal itself remains, so while the draft stays the mail still never lands, and after 24 h D1's ceiling rejects it.
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
5. **Type and submit** as the proven-empty path does today (the echo check, then `pressEnterAndConfirm`), with one change to the submit proof. Today's proof is `stillStartsWith(needle)` (≈:252): a marker row still starting with the typed text's first `ECHO_NEEDLE` characters means "not submitted", and a second Enter follows. Claude Code restores the stash at submit time [B], so a stashed draft that itself starts with the needle (a draft `/clear …` stashed around dispatch's `/clear`, or a matching paste chip) would read as our text still in the box, and the retry Enter would submit the human's draft. On the stash path the proof is therefore `stashAwareStill(needle, stashed)`, where `stashed` is step 2's `boxText`:
   - a box equal to `stashed` counts as **submitted and restored**, never as "still ours";
   - a box that starts with the needle and could be the restored draft (it is a prefix of `stashed`, or `stashed` is a prefix of it) gets **no retry Enter**: the send answers `ok` with `draftRestore:'restore-unverified'` when the turn's start is otherwise proven, or `enter-unconfirmed` as today when it is not;
   - only a box that starts with the needle and cannot be the stashed draft is "still ours" and gets the retry Enter, exactly as today.
6. **Verify the restore.** After the submit is confirmed, re-capture within a budget. The box must read back the draft read in step 2 (`boxText`, so a chip compares as the chip row it rendered as).
   - **Restored:** the result is `{ok:true, draftRestore:'restored'}`. The field is `draftRestore`, never `draft`: the refusal arm's `draft` carries the box text, and one field name must not carry two meanings (the overloaded-value defect the 08-10 spec names).
   - **Not restored within the budget:** take one fresh capture immediately before any key. Only if that capture shows no dialog open and the box present and empty (Claude Code's own late restore may have landed since the last read) is one `C-s` sent, which pops the stash [B], and the box verified again. Otherwise nothing is pressed. If the box still does not match, the result is `{ok:true, draftRestore:'restore-unverified'}` and a `console.warn('ccrc-server: …')` line is logged. The message *was* delivered, and the draft is still in Claude Code's stash (or already back in the box), where `ctrl+s` brings it back.

**Not chosen within D:** pressing `C-s` blind with no verification, and treating "the box looks unchanged after `C-s`" as proof the text was a placeholder. That inference is false whenever `ctrl+s` is rebound, and acting on it would type onto a human's draft.

### 2.2 The placeholder hint and a stranded `/clear`

- **The placeholder** is recognised by the box reader, not by the lane. `draftOfMeasured` keeps one rule: text rendered dim is not input. Plan Task P1a widens `DIM_SPAN` to every dim encoding Claude Code emits (the combined `\e[2;…m` forms and a dim-off `\e[22m` terminator, besides the bare pair). It pins captured panes in the corpus that already exists, `server/test/fixtures/panes/` (a `box/` subfolder), in ARCH-24's per-caller verdict-column shape: one column for the TS `draftOfMeasured` and one for ccd's `_pane_box_draft`, which answers only the last marker row, so its column holds that row and nothing else. No second corpus is created (CLAUDE.md, consolidate into the existing owner). The captures: placeholder variants, a multi-line draft, a paste chip, an image chip, a stranded `/clear` and a box taller than the capture.
  - These captures are ARCH-24's box rows, so consolidation K8 adopts them with the rest of the corpus.
  - **ccd is edited too, unconditionally.** ccd's `_pane_box_plain` (`ccd/ccd` ≈:21732) strips dim with the same bare-pair rule as today's `DIM_SPAN`, so widening the TS rule alone would red ccd's column for certain. Its dim rule is widened in the same task. `ccd/ccd` is held by open PRs (#740, #722, #435), so that edit is line-disjoint from them by consolidation rule 6, carries the generated-stamp restamp, and deploys agent-first.
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

- **The word `draft-present` stays only on the human send's path.** No lane can receive it. The mail sweep's `draft-present` arm, including `tellSender("…unsent text…")` and the back-off keyed on it, is deleted. That deletion is acceptance 2.
- **The pin is a table of call sites, not a file exemption.** A test holds every `sendPrompt(` call in `server/src` against an explicit table of site and policy: lanes → `stash`; operator-initiated sends (the PWA's send; any later operator control, such as a workflow control) → `refuse` or `replace`. A new call is red until someone classifies it. #821's `enter-ignored` resume adds no call: it rides the mail lane's existing call with `resumeIfOwn` [D1], and the `resumeIfOwn` rung wins before `onDraft` as today. #821's hold of a parked row whose box holds unchanged human text is the one place a lane deliberately presses nothing; under this design it holds only `enter-ignored` parks, because no lane produces a `draft-present` park any more.
- **New refusal words** (additive on `SendResult`): `stash-occupied` and `stash-failed`. Each is recorded as the delivery's gate (`gated(d, word)`, typed words, as the other gates are). They take D1's model exactly as `dialog-open` and `box-unreadable` do: back off, park `queued` at the attempts ceiling, wake when the box changes, one sender mail, one operator push, and D1's 24 h ceiling [D1]. They are **not** exempt from that ceiling. With the armed carrier, a draft is no longer a reason to wait at all, and the two words mean something abnormal (a rebound key, an escaped placeholder, a held stash) that the operator has been pushed about. With the disarmed carrier (§8 O1), a draft behaves exactly as it does under D1 alone, no worse.

### 2.4 A long wait is noticed once

K6's `notify()` funnel does not exist on `main` yet (it is W1a), and a hand-written `log.record` plus `recordFeedEvent` pair is exactly what K6 deletes. Neither is used, and no notifier is added.

**Chosen: D1's `mail-parked` push owns the long-wait notice.** A delivery the lane cannot land reaches D1's park, and D1 pushes the operator once, latched by `parkEscalatedAt`, naming the recipient and the park reason (here `stash-failed` or `stash-occupied`) [D1]. That is acceptance 6's "once, with the recipient and the reason", and it needs no change in this design.

- **The stall watch's `mail-stuck` arm is left as it is.** It fires only on its own stuck gate past `MAIL_STUCK_MS` (`stallMailStuckInner`, `coord/stall.ts`), and its delivery port deliberately carries no `lastError` (D-792, pinned at the type level in `stall-session.test.ts`). This design reads no `lastError` there and does not touch that pin. Rev 0 proposed adding the reason word to its body; that is withdrawn. Its existing "Its last gate: <lastGate>" sentence already names `stash-failed` or `stash-occupied` whenever it does fire, because the two words are recorded as gates (§2.3).
- **Two notifiers on one row exist from D1's merge, not from this design.** A parked row can draw D1's push and, past 72 minutes, `mail-stuck` (when the stall-watch level includes wave 2). They are different facts (a delivery the lane parked; a session the stall watch judges stuck), and folding them into one owner is K6's job in W1a, where both become `notify()` writers. This design neither adds to nor resolves that overlap, and records it for W1a.

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
- its `lastError` is a **lifecycle park** (`recipient session is <lc>`, which D1 keeps writing for a dead, stopped or purged recipient [D1]) or a **legacy live-recipient park** written before D1: `draft-present` or `enter-ignored` at the attempts ceiling. Legacy `enter-ignored` parks are included: #821 reports they lost five wave briefs, and they are exactly mail nobody read;
- its run is open (`COALESCE(rr.state,'') NOT IN TERMINAL_RUN_STATES_SQL`, the same clause `ABANDONED_PARK_SQL` already uses);
- it is **current**: its mail was sent (`mail.at`) at or after its run's `dispatchedAt` (both server clock), so a brief or a message from an earlier wave is never re-sent as if new;
- it is **not a system nudge**: mail whose subject carries the stall lane's prefixes (`stall-check:`, `stall:`) or that the server itself sent as a notice (a `mail parked:` or `mail rejected:` system mail) is never revived. Each is regenerated by its own owner if it still matters;
- **no later delivery has it as its parent** (`revivedFrom`, §3.2), in any state;
- its recipient now reads live.

**What is not revived:**
- a deliberate cancel (`DELIBERATE_CANCEL_ERRORS_SQL`);
- the replay-ceiling park, which has its own ack door (`markAcked`'s I2(b) exception);
- a registry-absent park (`recipient not in registry`): an absent id is not a session that came back;
- **D1's 24 h ceiling reject** (`parked 24 h, never delivered: <reason>`) [D1]. Its recipient was live throughout, the sender was told `mail rejected` and owns the re-send, and the operator was pushed at the park. Reviving it would deliver a message its sender may already have re-sent. It keeps counting in `unreadMail` until its run closes, as an undelivered message on an open run should; that is a known, visible fact the MailStrip shows as rejected, not #125's defect (a recipient that came back while its mail stayed lost).

**"Reads live"** is decided by the predicate that already exists. The park arm reads `sv.verdict === 'gone'` and then `lifecycleIsDead(lc)` (`shared/api.ts` ≈:2644; `watch.ts` ≈:7442), and the revive reads the same: a recipient **reads live** when it is in this tick's fleet listing, its registry row is present, and `lifecycleIsDead(sessionLifecycle(row))` is false. No second predicate is written beside `lifecycleIsDead` (CLAUDE.md, consolidate into the existing owner), so the park and the revive cannot drift apart. A hibernated session is not dead to `lifecycleIsDead`. Its parked mail is revived once the session is listed again, and it waits until then. K3's `readSession` absorbs this reading in W2.

- **Where it runs.** `sweepMail`'s first act, over the tick's fleet listing (the live ids), calls one store method, `reviveParkedDeliveries(liveIds, now)`. It returns a typed result `{revived: number[]}` and never `void`: CLAUDE.md's open list names nine `void` delivery writers, and this design adds no tenth.
- **The heir.** The heir carries the ordinary envelope, rendered as `requeueAbandonedMail` renders it, and the sender is told once (`tellSender`, keyed `mail-revived-<deliveryId>`).

### 3.2 `unreadMail` once the recipient is live

**Chosen: the heir names its parent, and `ABANDONED_PARK_SQL` gains one derived clause on that name.** The heir row carries `revivedFrom` (the parent delivery's id, a nullable column added by Task P1e's migration). A parked row that some delivery names as its parent (`EXISTS (SELECT 1 FROM mail_deliveries h WHERE h.revivedFrom = d.id)`) is not abandoned: its heir carries the attention now. The heir counts while it is outstanding, as any queued mail does. So `unreadMail` counts the message once, then zero once the heir is acked.

- **Why a parent column, not `mailId` and `toId`.** `repointCoordinatorMail` (`coord/store.ts` ≈:2143) rewrites `toId` on outstanding rows when a coordinator is displaced. A clause keyed on `toId` would lose a repointed heir, and the parent would count again beside it (#125 again). `revivedFrom` survives a repoint.
- **One fragment, two readers.** The revive's "no heir yet" and the read's "has an heir" are the same SQL fragment, `HAS_HEIR_SQL`, used positively by `ABANDONED_PARK_SQL` and negatively by the revive's select, so they cannot drift. A heir that parks again (its recipient died again) is itself revivable once, through its own `revivedFrom`; its parent is never selected a second time.

- **Readers this touches,** each re-checked by the plan:
  - `unreadMailCount`;
  - `mailForRecipient` and `outstandingMailFor` (the MailStrip);
  - `requeueAbandonedMail`'s coordinator arm. Its source is `ABANDONED_PARK_SQL`, so a revived parent leaves that source, and the heir must be visible to that arm in its place. Plan Task P1e pins "a revived heir to a later-displaced coordinator is requeued to the new coordinator" and "a revived heir repointed to a new coordinator: the parent stays retired".

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

- **The wire.** `RunSummary` gains `workerLastSeen: number | null` (the marker's `at`, fleet clock, epoch ms) and `workerTurn: TurnMarkState | null`. `TURN_MARK_STATES` and `TurnMarkState` move from `server/src/coord/stall.ts` (≈:1512) into `shared/api.ts`, because `shared/` is L0, ships in the PWA bundle and never imports from `server/src`. `stall.ts` re-imports them, so there is still one definition. Both are additive and absence-permits. An older server omits them, and a reader treats absence as unknown.
- **Why `workerTurn` too.** A marker changes only on main events, so a long turn shows an old `at` while `workerTurn` reads `working`. Without it, a long-thinking worker would look dead, which is #119's very complaint.
- **Storage.** Two columns on `runs`, `workerSeenAt` and `workerTurn`, in **the next free `MIGRATIONS` slot**, re-measured at the task's Step 0 and again before merge. D1 (#821) takes 27, and the consolidation's W1a (C1f) adds another entry; `COORD_SCHEMA_VERSION` is `MIGRATIONS.length`, so two branches each shipping the same slot would mis-migrate. No test pins a fixed count: the test asserts the two columns. One store writer, `noteWorkerSeen(runId, at, turn)`, which updates only when `at` advances, so it is monotonic and idempotent and costs one write per worker turn, not one per sweep. It returns a typed result.
- **One read, ahead of the gate, and only a read.** `sweepStalls` gains a first pass over the open runs' workers. It reads each marker once into a per-sweep map, records `noteWorkerSeen`, and only then reaches `if (arming.disabled) return`. `judgeStall` takes its marker from that map instead of reading again. The heartbeat therefore lives whatever the stall lane's arming. This adds no read when the lane is enabled, and while it is disabled it costs one agent read per active run, which the dispatch cap bounds. That fits the tick-diet budget's per-sweep (not per-tick) cadence.
  - **The switch's contract.** The operator's `stall-watch-disabled` switch still stops every write the stall lane makes about a session or a run's state. The only thing ahead of it is this observation: one marker read and the monotonic `noteWorkerSeen`, which records a fact and acts on nothing. That narrowing of the switch's coverage is recorded here and in the plan (D-5915); P1g's run transition stays behind the gate (§4.2).
  - **The candidate read moves too.** The pass needs the open runs' workers, so `store.stallCandidates()` is read ahead of the gate. It is read **without** stamping `lastStallJudgedAt`: only a judged sweep stamps it, as today, so D-3750's gap rule (a disabled stretch is a gap, not a judgement) is unchanged.
- **Which marker is the worker's.** The run's `sessionId`, with the registry uuid as the reader's identity check, as `judgeStall` does today. K10's `RunBinding` replaces that with `bindingOf(incarnation)` in W6. This pass is one of the sites W0's census counts.

### 4.2 `dispatched → working`

| Option | Verdict |
|---|---|
| On the first turn mark after `dispatchedAt` | **Rejected as the trigger.** `dispatchedAt` is the server's clock and the marker's `turnAt` is the fleet box's. Two boxes' clocks skew, and a skew of seconds makes a turn that ended the previous wave read as "after dispatch". |
| On the coordinator's `advance` only (today) | **Rejected.** It leaves runs in `dispatched` (#119), and `dispatched` has no `awaiting-review` edge, so a forgotten step blocks the wave-done. |
| **On the worker's first ack of mail on this run** | **Chosen.** The worker skill acks before acting, so an ack proves the brief was read, and `ackedAt` and `dispatchedAt` are both server-clock columns in one database. |

- **The decider** is pure L1 in `coord/`, `workerUnderway(run, firstAckAt)`. It answers true when `run.state === 'dispatched'`, the run's kind has the `dispatched → working` edge (`transitionsFor(kind)`), and a delivery to `run.sessionId` on this run was acked at or after `run.dispatchedAt`.
- **The executor** runs in `sweepStalls` **after** the `arming.disabled` return, so the operator's switch still covers it. It reads the decider's input from P1f's first-pass map and the store.
- **A compare-and-set, never a plain advance.** `store.advance` (≈:2465) checks only the edge from the state current at write time. The sweep decides on a snapshot and then awaits fleet reads, and a coordinator may meanwhile have moved the run `working → awaiting-review` or on to `merging`. A plain `advance('working')` would then succeed on the send-back edge and return a run under review to work, skipping `routes.ts`'s review-in-flight refusal and its `IDLE_RUN_STATES` cap check. So the store gains `advanceFrom(runId, 'dispatched', 'working', 'worker-underway')`, which shares `advanceInner`'s body and refuses `stale-from`, inside the same transaction, when the current state is not `dispatched`. Both `dispatched` and `working` are in `ACTIVE_RUN_STATES`, so no dispatch-cap slot changes and this one edge needs no cap check.
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
| `onDraft: 'stash'` in `sendPrompt` | C3 | none: it is the one typing owner | Now, after D1 (#821) merges, line-disjoint from it in `send.ts` by rule 6. The consolidation spec does not sequence #600; this lands as a lane PR before W2 moves `sendPrompt`'s neighbours. |
| Lane callers on `stash` | C3 and C5 | K4's `keystroke` policy is unchanged | Now. It edits `sweepMail` before ARCH-19 moves its policy into `coord/`. ARCH-19 moves a policy with no draft arm. |
| The long-wait notice | C6 | K6 | No change here: D1's `mail-parked` push owns it. W1a moves both D1's push and the stall lane's `mail-stuck` into `notify()`, where their overlap on one row is resolved. |
| Revive and derived `unreadMail` | C5 | STORE (ARCH-15's guarded delivery writer); K3 later supplies "reads live" | Now, on the existing `lifecycleIsDead`. W2 re-homes it onto `readSession`. |
| `workerLastSeen`, `workerTurn` | C5 (Run) fed by C1's marker reading | K4 (`TurnReading`) and K3 | Now, in `sweepStalls`' existing read. W2 moves the read under `SessionReading`. |
| `dispatched → working` on first ack | C5 (Run) | K10 (`RunBinding`) | Now. W6 replaces `run.sessionId` equality with `bindingOf`. The pass is a census site. |
| PWA showing `workerLastSeen` | C3/C5 PWA half | K14 | **W7 only.** Nothing here edits `pwa/`. |

Rule 6 of the consolidation (§5.1: one `watch.ts` series at a time, and open lane PRs merged or line-disjoint) is honoured. The plan's tasks that edit `watch.ts` are serial. The consolidation's W1a, when it starts, rebases onto whatever of this has merged.

## 7. The D1 gate

D1 is #821. It is open at this design's base, and it edits `send.ts`, `watch.ts`, `store.ts`, `schema.ts` (migration 27), `shared/api.ts` and `mail-envelope.md`, every one of which a task here edits too. So:

- **Every task is gated on #821's merge**, except P1a, which is gated on rule-6 line-disjointness with it in `send.ts` (#821's hunk sits after `hasContentBelowMarker`, ≈:1347; P1a edits `DIM_SPAN`, ≈:152) and with #740, #722 and #435 in `ccd/ccd`.
- **If #821 changes before it merges,** each task's Step 0 re-grounds on its merged form: the park columns, the push's latch, the 24 h ceiling's `lastError` text, and the migration slot. A change to any of those is a §Deviations entry, not a silent adaptation.
- **If #821 is closed unmerged,** this design does not stand on its own: without a park, `stash-failed` and `stash-occupied` would reject at `MAIL_MAX_ATTEMPTS` as `dialog-open` does on `main`, and acceptance 6 would have no owner. The plan then stops at P1b and is revised.

## 8. Operator questions and acts

**O1, open only if the probe finds no held-stash indicator.**
- **The risk.** `stash()` replaces a held stash [B]. If Claude Code shows nothing in the pane while a stash is held, the lane cannot tell a box whose operator has already stashed something from one whose operator has not. Stashing over a held stash would destroy the earlier text.
- **The default this design ships:** the carrier is **disarmed**. `onDraft:'stash'` answers `stash-occupied` without pressing anything. A draft then behaves exactly as under D1 alone: the row parks `queued`, wakes when the box changes, the sender and the operator are each told once, and after 24 h parked D1 rejects it [D1]. That is no worse than D1, and it is not "never blocks": #600 is then only partly met until the operator rules.
- **The question:** "May the lane stash a draft when it cannot see whether an earlier stash is held, accepting that a second stash replaces the first?"

If the indicator exists, O1 does not arise.

**Operator acts (no decision):**
- The skill text reaches each home at the next `ccrc update`.
- Rev 0's act (raise the stall-watch level to wave 2 for acceptance 6) is withdrawn: acceptance 6 is D1's push (§2.4), which does not depend on that level.

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
- **Acceptance 2:** the call-site table pin holds every `sendPrompt(` call to its classified policy (lanes `stash`), and an unclassified call is red. A sweep over a draft pane never writes `lastError:'draft-present'`.
- **Acceptance 3:** each of the three lane sites drives a draft pane and asserts the draft survives.
- **Acceptance 4:** the placeholder corpus reads empty, and an unproven `/clear` is stashed and restored.
- **Acceptance 6:** a delivery refused `stash-failed` to the attempts ceiling parks under D1 with that reason, and D1's push fires once naming the recipient and the word. `stall-session.test.ts`'s D-792 pin stays green.
- **The stash submit proof:** a stashed `/clear` draft is not submitted by the `/clear` send's retry Enter, and a restored draft that starts with the needle gets no second Enter.

**#125:**
- A lifecycle-parked delivery on an open run is revived once when its recipient reads live, and not while it reads dead.
- `unreadMail` reads 1 and then 0 after the heir's ack.
- A closed run's park is never revived.
- A replay-ceiling park, D1's 24 h ceiling reject, a stall nudge and a park from before the run's `dispatchedAt` are never revived.
- The coordinator requeue arm sees the heir; a repointed heir keeps its parent retired; a heir that parks again is revived once, not twice.

**#119:**
- `workerLastSeen` advances monotonically.
- A `stall-watch-disabled` box still records it.
- A foreign or stale marker records nothing.
- A run moves `dispatched → working` on the worker's first ack after dispatch, and not on an ack before it.
- A run that reached `awaiting-review` between the read and the write is not moved.
- `stall-watch-disabled` records the heartbeat and moves no run.
- The coordinator's `{"to":"working"}` on a `working` run answers `ok` and `unchanged`, with no event row.
- `run-states.test.ts` stays green.
