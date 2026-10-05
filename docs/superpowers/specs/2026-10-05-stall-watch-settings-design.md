# Stall watch settings: one arming ladder and one quiet time on the Settings page (design)

**Status:** draft rev 2, written 2026-10-05, awaiting the operator's review. Rev 2 folds three review lenses (codebase fit,
operator intent, safety). The shape was approved in dialogue (§2): one ladder, one timing, a small read-only part, and
approach 1 (server-side storage). Nothing in this spec is planned yet. No D-number has been allocated. Each departure
from the approved text is named by its slug (§16) and gets a number when the plan is written.
- **Citations.** Mapped read-only at `origin/main` `c41bf8c56`, which carries stall-watch waves 1–7. Line numbers
  are hints and are written `≈`. Every citation also names its function or constant, so the text can still be found
  after `main` moves. Ledger entry R38 is cited from the coordinator's ledger branch (`d956bfd1d`); the arming-track
  rows it summarises (stall-watch.md ≈:34–38) are on `main`.
- **Inputs.** Three read-only surveys from 2026-10-04 (stall constants, configuration precedents, the Settings
  screen), re-checked against `origin/main` after waves 6 and 7 merged; the stall-watch design spec; and the
  stall-watch programme ledger's arming track (R18, R19, R26, R28, R38).

**Date:** 2026-10-05 · **Branch:** chosen by the coordinator (from `origin/main`, measured at execution)
**Related:**
- `2026-09-29-worker-stall-watch-design.md`. This spec amends two sentences in it:
  - §10's "the PWA renders none" (≈:839). Settings now renders the effective quiet time.
  - §4.2's "every marker is touched and removed by hand" (≈:474). That stays true, because no marker gains a
    writer. A level chosen in Settings can now override the arming markers. The W1 PR adds one line to that
    spec's status block pointing here.
- `docs/superpowers/programs/stall-watch.md`. That programme is complete (R38). This is a **new** programme, and it
  reads its gate texts from that ledger's arming track.
- `2026-09-20-centralised-update-management-design.md` §13. That design created the Settings screen, which this
  spec extends with a third section.

## 1. The problem

The stall watch is armed by seven empty files in the fleet registry (`~/.cc-sessions`), each touched and removed by
hand on the fleet box:
- `stall-watch-disabled`, `stall-watch-live`, `stall-watch-escalate` and `stall-watch-w2-live`
  (`STALL_MARKER_MAP`, `server/src/coord/stall.ts` ≈:104);
- `mail-gate-strict`, `mail-gate-busy` and `mail-gate-busy-shadow` (`turnidle.ts` ≈:60–74).

Two kill switches stand beside them:
- `mail-disabled`, which has no writer;
- `coordinator-paused`, which `ccd coord-pause` writes.

None of the seven arming files has a writer in the tree, by design. `single-definition.test.ts` pins that for each
of them (≈:4081 and ≈:4211).

Arming the watch therefore means an ssh session to the fleet box, and knowing which files to touch in which order.
The order is real and has evidence gates:
- R18 set the arming order.
- R26 armed `stall-watch-live` and `mail-gate-busy-shadow` at the operator's request, by hand.
- The remaining three steps each wait on named evidence: deployment and shadow observation for escalate, the
  busy-gate log review for busy delivery, and further shadow measures for the wave-2 step (arming track, R38).

The operator cannot see the current arming anywhere in the PWA:
- `CoordStatus` carries `pause`, `mail`, `reclaim` and `childReclaimAttention`, and nothing about the stall
  watch (`shared/api.ts` ≈:3813).
- No route returns a stall observation row.

The one timing an operator might reasonably want to change, the 2 h quiet time before a worker check
(`STALL_QUIET_MS`, `stall.ts` ≈:302), is a compile-time constant.

## 2. The operator's decisions (dated)

- **2026-10-04 (ledger R30).** "Yes to stall watch section", with the question "should we be able to configure any
  parameters?". R26 records the operator's earlier question: should arming default on, or be a Settings-page toggle?
- **2026-10-05 (ledger R38).** The operator chose "D, a mix".
- **2026-10-05 (brainstorm).** "do we need so many settings? ideally minimal number of config for max benefit, making
  adjustable the stuff that really has an impact".
- **2026-10-05.** No phone/desktop distinction: "same functionality identical across anywhere the PWA is installed".
  The control is never called a "phone" control. It is Settings, in the PWA.
- **2026-10-05, approved in the brainstorm:**
  1. **One arming ladder**, default "Follow the box files", which is today's behaviour. There are six levels, and
     each includes the ones below it (§5). Precedence: a kill file on the fleet box beats everything;
     `mail-gate-strict` keeps its precedence for the mail gate; otherwise a chosen level decides; otherwise the box
     files decide, as today. A box-file combination that matches no step reads "custom (box files)". An unreadable
     registry reads "unknown", never "off".
     - *Restatement note:* under departure `files-level-match-ignores-the-busy-log` (§6.4, Q1), a box with no files
       at all reads "Log only (busy-gate log off)" rather than "custom". That narrows the approved "matches no step
       reads custom" for that one case.
  2. **Guide, don't block.** Any level may be chosen. The section shows what the current level does, the next step,
     and that step's gate. Raising the level asks for a confirm that shows the gate text. The server does not
     track whether a gate is met; it cannot know.
  3. **One timing:** the quiet time before a worker check, adjustable from 30 min to 12 h, defaulting to the
     built-in value. All other timings stay fixed in code. There is no install-time configuration.
  4. **A small read-only part:**
     - the current level, what it does, and where it comes from;
     - the next step and its gate;
     - the quiet time, with its range and where it comes from;
     - 48 h notice counts per rung, sent versus shadow, from run-bound observation rows. Run-less notices are not
       counted, and the section says so.
  5. **Approach 1.** Storage in `~/.ccrc/coord.db`, through one migration, behind a caps-style session-gated door
     with no box token. Every change is logged to the activity feed, and the reply re-reads the stored values. No new
     ccd verb, no marker writer, no agent change. A lost or unreadable settings row means today's behaviour.
  6. **One resolver for both consumers.** The busy-delivery step changes the mail gate's mode, which `sweepMail`
     resolves apart from `sweepStalls`. A chosen level is applied to both, from one resolver, so they cannot
     disagree.
  7. **Two waves, in a new programme:** W1 is the server, W2 is the PWA section.

## 3. Goals

1. The operator can read the watch's effective arming and quiet time in the PWA, see where each comes from, and see
   what the next step waits on.
2. The operator can choose a ladder level, or "Follow the box files", and a quiet time, from Settings on any device.
   The control settles on the server's re-read answer.
3. A stall sweep and a mail sweep given the same registry listing and the same stored row resolve the same arming,
   because both call one pure function, and the stall sweep judges mail against the mode the mail gate actually
   applied (§9).
4. While nothing is chosen (the migration's seed), the server behaves byte-for-byte as it does today. W1 can deploy
   first and change nothing.

## 4. Non-goals

- **Per-stage controls.** There is one ladder and no toggle per marker. A combination the ladder does not name stays
  reachable by hand with the box files, and reads "custom (box files)".
- **Any other timing.** `STALL_ESCALATE_MS`, `STALL_OPERATOR_MS`, `STALL_BOUND_MS` (r1 + 3 h), the caps and every
  wave-2 constant stay `export const` literals. `stall-verdict.test.ts`'s "the wave-1 constants carry the spec values"
  (≈:96–103) and `stall-vocabulary.test.ts`'s wave-2 row stay as they are. So do the mail gate's own floors,
  `MAIL_QUIET_MS` (60 s) and `COORD_QUIET_MS` (15 s), which are not the stall quiet time.
- **Install-time configuration.** No `CCRC_STALL_*` key, and nothing in `deploy/ccrc.env.example` or `loadConfig`.
- **Writing marker files.** The server never creates or removes a registry file. The no-writer pins stay unedited
  and stay green. `agent/src/whitelist.ts` keeps its write scope (`~/.cc-clips` only).
- **A new ccd verb, or any agent change.** `EXEC_COMMANDS` stays `['tmux','ccd']`.
- **Enforcing gates, or tracking whether a gate is met.** Any level can be chosen at any time. Gate texts are static
  guidance: a snapshot of the arming track, edited in L0 by the ledger's owner in the same PR as each ruling that
  closes a gate.
- **Counting run-less notices.** Sent or shadow, they leave no observation row (§11). This spec adds no durable
  record for them, and the section cannot measure R19's run-less push count.
- **A WebSocket frame.** The section polls. `CoordStatus` and `FLEET_PROTO` are unchanged.
- **Device-specific behaviour.** There is no viewport or pointer branch, and no "phone" wording in the new section.
  The existing Notifications section's labels are out of scope and untouched.
- **Not offered:** applying a new quiet time only to episodes opened after the change; a daily split of the counts;
  refusing a write while the registry cannot be listed (the choice is stored, and applies once the registry reads).

## 5. The ladder

Six levels, each including the ones below it, plus the default choice "Follow the box files" (id `follow`). Level
ids are single lowercase words, so the `server/src/coord` kebab-code scan in `mail-routes.test.ts` (≈:734) never sees
them (§14 item 13).

The arming flags are `StallArming`'s fields (`stall.ts` ≈:126). The mail gate mode is `turnidle.ts`'s
`MailTurnMode`; "box" means the mode the box files give. "Gate to reach it" is what that step waits on, in plain
words, following the ledger's arming track (rows ≈:34–38) and R38. It is shown when that step is the next one, and
in the confirm when the step is crossed.

| # | id | Label | `disabled` | `live` | `escalate` | `w2Live` | mail gate mode | What it does | Gate to reach it |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `off` | Off | true | — | — | — | box | The stall watch does not run: nothing is checked, recorded or sent. The mail gate stays as the box files set it. For an emergency stop that survives a rollback or a lost database, use the fleet box's kill switch. | none (the bottom step) |
| 1 | `log` | Log only | false | false | false | false | `busy-shadow` | Every rung is detected and recorded as shadow, and nothing is sent. The mail gate logs each busy session it would have delivered to, and delivers nothing extra. | None; it sends nothing. Its busy-gate log is the evidence busy delivery waits on. |
| 2 | `check` | Check silent workers | false | true | false | false | `busy-shadow` | Adds a stall-check mail to a worker that has been silent past the quiet time (r1). No one else is told. | Recommended now: the shadow review found every false check harmless, and a 15 h silence on 2026-10-03 was a true stall a check would have caught. |
| 3 | `alert` | Alert coordinator and you | false | true | true | false | `busy-shadow` | Adds the coordinator report an hour after an unanswered check (r2), a push to you an hour after that (r3), and the limit, dialog and coordinator-ball cap pushes. | Waits on stall-watch waves 6 and 7 being deployed and watched in shadow. |
| 4 | `deliver` | Deliver mail to busy sessions | false | true | true | false | `busy` | Adds delivery to a busy session whose main turn has ended, so mail stops waiting for that session's background work. | Waits on a review of the busy-gate log, and on seeing the spinner row on a busy session whose turn has ended. |
| 5 | `all` | Everything | false | true | true | true | `busy` | Adds the wave-2 checks (dead, frozen, failed, orphaned, coordinator-deaf, mail-stuck, unreadable marker), and the quiet ladder follows each worker's turn marker. | Waits on the busy-gate log review, a shadow re-measure of the coordinator-deaf and mail-stuck clocks, and a count of repeated pushes about sessions on no run, taken between Alert and this step. It also moves the quiet ladder onto the turn-marker clock, never measured in shadow. |

**The order.** The ladder follows the order the operator approved on 2026-10-05. It differs from R18 in one place:
R18 arms `mail-gate-busy` (its step 4) before escalate (its step 5, with w2-live). The ladder puts Alert below
Deliver. With that order every ladder row keeps the arming track's "escalate only while w2-live is off or busy is
armed". The one resolved arming that could still break it, a chosen `all` under `mail-gate-strict`, is closed by
the strict rule in §6.2 (`strict-holds-the-wave-2-step`). Busy delivery without escalation stays reachable with the
box files, and reads "custom (box files)". A box armed by hand in R18's order (busy delivery on, escalate off) that
then has a level below Deliver chosen in Settings loses busy delivery (§6.3 item 4, §15).

**Where the text lives.**
- The labels, the "what it does" sentences and the gate texts are defined **once**, in L0 `shared/api.ts`, as one
  total `Record<StallLevel, {label, does, gate}>` (`STALL_LEVEL_TEXT`). `STALL_LEVELS` is derived from it with
  `Object.keys`, in ladder order, and a test pins that order. The other section strings (the follow label, the
  quiet-time note, the three count labels, the held lines and the hazard line) are L0 constants too.
- The flag and mode columns are defined once, in L1 `server/src/coord/stallsettings.ts` (new), as a total
  `Record<StallLevel, …>` (`STALL_LADDER`). The `off` row carries mail mode `'box'`, which the resolver reads as
  "leave the box's mode".
- A level added to one record and not the other is a compile error.
- **No text spells a marker name.** Every string in `shared/api.ts`, `pwa/src` and the new server file is a code
  line, and the no-writer pin's TS half allows exactly one code-line spelling per marker, in its definer
  (`single-definition.test.ts` ≈:4081, ≈:4211). The texts say "the wave-2 step", "busy delivery", "the busy-gate
  log" and "the fleet box's kill switch", never the file names.

## 6. Precedence and the resolver

### 6.1 Inputs

1. **The box arming,** built from one registry listing by one new function,
   `stallBoxArmingOf(names, mailDisabled)` in `stallsettings.ts`. It returns
   `{ ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) }`, which is exactly what `sweepStalls`
   builds inline today (`watch.ts` ≈:3788).
   - It composes two pure readers that each spell their own names: `stallArmingOf` in `stall.ts` (≈:129) and
     `mailTurnModeOf` in `turnidle.ts` (≈:78). So it spells no marker name itself.
   - It does not spell `mail-disabled` either. That fact comes in as a boolean. `watch.ts` computes it with its
     module-local `MAIL_DISABLED_MARKER` (≈:515); `routes.ts` uses `rundefs.ts`'s export (≈:50). That keeps the split
     `single-definition.test.ts` pins between the two literals.
2. **The parsed settings:** `parseStallSettings(read)` over the store's read (§8). Each field reads independently:
   - level: `{kind:'follow'} | {kind:'chosen', level} | {kind:'unreadable', token}`;
   - quiet time: `{kind:'default'} | {kind:'set', ms} | {kind:'unreadable', value}`;
   - row: `stored: 'row' | 'absent' | 'unreadable'`.

   "Absent" and "unreadable" stay apart all the way to the wire. Neither folds into `follow` or `default` until the
   resolver decides how to act on it.

**One validity predicate.** `isStallQuietMs(v)` in `stallsettings.ts`: `typeof v === 'number'`,
`Number.isSafeInteger(v)`, `v % STALL_QUIET_STEP_MS === 0`, and `STALL_QUIET_MIN_MS <= v <= STALL_QUIET_MAX_MS`.
Both `decideStallSettings` (the write) and `parseStallSettings` (the read) call it, so the read never accepts a value
the write would refuse (a hand-edited `1800000.5`, a TEXT value in the untyped column, a value from a build with
other bounds).

### 6.2 The resolver

`resolveStallWatch(box: StallArming, settings): StallResolved`, in `stallsettings.ts`. It is L1: pure, no clock, no
I/O, no `node:` import, no `db.js`. It works on flags only.

```
quietMs      = settings.quiet.kind === 'set' ? settings.quiet.ms : STALL_QUIET_MS     // unreadable → built-in
quietSource  = settings.quiet.kind === 'set' ? 'chosen' : 'default'
if box.disabled:                                       // the lane's kill file restores today's behaviour wholesale
  arming = box                                         // mail mode included
  levelSource = settings.level.kind === 'chosen' ? 'chosen' : 'files'
else if settings.level.kind !== 'chosen':              // follow, or unreadable → follow
  arming = box                                         // the SAME object: today's behaviour exactly
  levelSource = 'files'
else if settings.level.level === 'off':
  arming = { ...box, disabled: true }                  // the lane stops; the mail gate keeps the box's mode
  levelSource = 'chosen'
else:
  row = STALL_LADDER[settings.level.level]
  strict = box.mailMode === 'strict'
  arming = { disabled: false,
             live: row.live, escalate: row.escalate,
             w2Live: row.w2Live && !strict,                        // strict switched busy delivery off; the wave-2 step needs it
             mailDisabled: box.mailDisabled,                       // the mail kill file is never overridden
             mailMode: strict ? 'strict' : row.mailMode }          // strict keeps its precedence
  levelSource = 'chosen'
effective = stallLevelOf(arming)          // what the watch is actually doing
files     = stallLevelOf(box)             // what the box files alone say (shown beside "Follow the box files")
held      = { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: box.mailMode === 'strict',
              wave2HeldByStrict: chosen level has w2Live && strict }
```

`StallResolved` is `{ arming, quietMs, quietSource, levelSource, effective, files, held }`. The `held` words are
camelCase booleans, never file names.

### 6.3 Precedence, stated once

1. **`stall-watch-disabled` on the box beats everything.** The resolver returns the box arming unchanged, mail mode
   included, whatever level is chosen. The lane returns (`if (arming.disabled) return`, `watch.ts` ≈:3789), and the
   mail gate runs exactly as the box files set it, as today.
2. **`mail-disabled` on the box beats everything.**
   - `sweepMail` returns before any mode is read (≈:4541, unchanged).
   - The lane holds every rung that would send mail (`stallMailDisabledHold`).
3. **`mail-gate-strict` on the box keeps its mail-gate precedence:** strict > busy > busy-shadow > shell. With a
   level chosen, strict still wins the mail gate, and it also holds the wave-2 step off, because that step needs
   busy delivery (`strict-holds-the-wave-2-step`). The chosen level still decides `live` and `escalate`.
4. **Otherwise a chosen level decides every other flag and the mail mode.** That includes turning off a busy mode the
   files set: a chosen `check` with `mail-gate-busy` on the box gives `busy-shadow`. A chosen `off` stops the lane
   and leaves the mail gate on the box's mode.
5. **Otherwise the box files decide, as today.**

`coordinator-paused` and `reclaim-paused` are not arming switches, and the resolver never reads them.

### 6.4 Reading a level back: `stallLevelOf(arming)`

- `disabled` and a mail mode other than `busy` gives `off`. `disabled` with mail mode `busy` gives `custom`, because
  the watch is off while busy delivery is on, and `off` must not stand for both.
- Otherwise it returns the one step whose `live`, `escalate` and `w2Live === true` equal the arming's, and whose
  "delivers on busy" (mode `busy`) equals the arming's.
- Otherwise it returns `custom`.

Modes `shell`, `busy-shadow` and `strict` all count as "does not deliver on busy" for this match, so the busy-shadow
log alone never splits a level. Departure `files-level-match-ignores-the-busy-log`, §19 Q1. The reply carries the
busy-log fact separately (`stages.busyLog`, §12), so the section can say when a step that would turn the log on is
running without it, for example a fresh install with no files at all.

The consequences, stated once:
- A box with no files reads `log` from files, with the busy log off.
- The operator's fleet today (`stall-watch-live` plus `mail-gate-busy-shadow`) reads `check` exactly.
- `escalate` without `live`, or `w2-live` without `escalate`, reads `custom`.
- A chosen level under `mail-gate-strict` reads as the level that gate leaves standing. A chosen `deliver` or `all`
  under strict reads `alert`, with `held.gateStrict` (and `held.wave2HeldByStrict` for `all`).
- A chosen `off`, or the lane's kill file, with `mail-gate-busy` on the box reads `custom`.

**The hazard line.** Whatever the source, when the effective stages read escalation on, the wave-2 step on and busy
delivery off (reachable only through box files set by hand), the Now block shows one warning line, defined once in
L0: "Escalation and the wave-2 step are on while busy delivery is off: mail-stuck and coordinator-deaf reports will
misread busy sessions as deaf." Guide, don't block.

### 6.5 "Unknown"

An unlistable registry (`io.readdir` answers `null`) is never resolved and never reads `off`:
- **The sweeps** already fail shut before they would resolve anything. `tick()` returns on `!registryRead.listed`
  before `sweepStalls` (≈:1616–1625, D-283), and `sweepMail` returns on `listing === null` (≈:4541).
- **The GET route** answers `effective: { measured: false }`, which the PWA renders "unknown — the fleet registry
  could not be read".

The settings row needs no listing to read, so the chosen values are still shown.

## 7. The quiet time

- **What it replaces.** The resolved `quietMs` replaces `STALL_QUIET_MS` at every use in the stall watch. Measured on
  `origin/main`, there are three:
  1. **r1 under wave 1's ladder:** `stallWaveOneLadder`, `now - since >= STALL_QUIET_MS` (`stall.ts` ≈:918).
  2. **The dialog cap:** `stallVerdictInner`, `capQuiet >= STALL_QUIET_MS` (≈:1038). Spec §11 decision 8 reuses the
     r1 threshold there.
  3. **The working-reply backoff base:** `stallBackoff`,
     `quietMs: STALL_QUIET_MS * 2 ** min(streak, STALL_WORKING_BACKOFF_CAP)` (≈:709). It feeds the marker ladder's
     r1 at ≈:1076, live only under w2-live.

  Comments that state the threshold or its value go stale and are reworded: `stall.ts` ≈:499, ≈:679 ("2 h, then 4 h,
  then 8 h" becomes "the quiet time, then twice it, then four times it, under the ceiling"), ≈:687 ("a 2 h check"),
  ≈:696, ≈:1162 ("two hours"), and `watch.ts` ≈:192 (`STALL_SWEEP_MS`'s "a 2 h threshold"). Each becomes "the quiet
  time (2 h built-in)" or the equivalent. No mail body prints the threshold: r1's body prints the measured silence
  (`stallSpan(now - since)`, ≈:1234). So nothing user-visible goes stale. Nothing in `turnidle.ts` or any skill text
  uses `STALL_QUIET_MS`.
- **How it reaches L1.** `StallInput` gains an optional `quietMs?: number`. One reader, `stallQuietMs(input)`
  (`input.quietMs ?? STALL_QUIET_MS`), serves all three sites.
  - Absent means built-in, so every existing test literal stays valid. That is the `w2-arming-optional` precedent.
  - `watch.ts` always passes the resolved value when it builds the input (`judgeStall`, ≈:3877).
  - `STALL_QUIET_MS` stays the one built-in default. The constants pin keeps holding it at 2 h.
- **The backoff ceiling** (departure `backoff-ceiling-from-the-horizon`). The lane reads a worker's mail back only
  `BACKLOG_HORIZON_MS` (24 h, `stall.ts` ≈:345; `watch.ts` ≈:3867). The streak, the episode key and the quiet clock
  all come from that read (`stallFacts` ≈:657–675). Today the backed-off threshold peaks at 8 h, well inside it. At a
  12 h quiet time it would reach 24 h and 48 h: the replies that justified the backoff would fall out of the read
  before r1, and the episode would re-key and re-send r1. So `stallBackoff` caps its **computed** threshold at
  `STALL_BACKOFF_CEILING_MS = BACKLOG_HORIZON_MS - 2 * (STALL_BOUND_MS + STALL_OPERATOR_MS)` (16 h), defined once in
  `stall.ts` beside the constants it derives from. The margin is the marker ladder's own span after r1 (r2 by r1 +
  3 h at the latest, r3 an hour later), twice over, so the whole ladder stays inside the read. A stored value is
  never clamped; only the computed backoff is. Pinned relations, beside the constants pin:
  - `STALL_QUIET_MS * 2 ** STALL_WORKING_BACKOFF_CAP <= STALL_BACKOFF_CEILING_MS` (8 h ≤ 16 h: the default is
    byte-for-byte unchanged);
  - `STALL_QUIET_MAX_MS <= STALL_BACKOFF_CEILING_MS`;
  - `STALL_BACKOFF_CEILING_MS + STALL_BOUND_MS + STALL_OPERATOR_MS < BACKLOG_HORIZON_MS`;
  - and, for wave 1's ladder, `STALL_QUIET_MAX_MS + STALL_ESCALATE_MS + STALL_OPERATOR_MS < BACKLOG_HORIZON_MS`.

  An older reply falling out of the read can still shorten the streak, which only makes r1 fall due sooner within the
  same episode. How a silence longer than the horizon re-keys is today's behaviour and unchanged.
- **The range.** `STALL_QUIET_MIN_MS = 30 min`, `STALL_QUIET_MAX_MS = 12 h` and `STALL_QUIET_STEP_MS = 30 min`,
  defined once in `stallsettings.ts`. The reply carries all three, so the PWA has no copy.
  - A value must be a multiple of 30 min within the range, inclusive (`isStallQuietMs`). Departure
    `quiet-half-hour-steps`: the PWA's list and the server's rule are one rule.
  - A value outside it is **refused** with 400 and a detail naming the field, the range and the step. It is never
    clamped: a stored value is always the value sent.
  - A stored value that fails `isStallQuietMs` reads `unreadable` and resolves to the built-in, never clamped.
- **What a change does,** from the next stall sweep (`STALL_SWEEP_MS`, 60 s):
  - **Lowering** makes every worker already quiet past the new value due at once, so the next sweep can send a
    burst of r1 checks. At `alert` and above it also makes a dialog-cap push to you due for every standing dialog
    older than the new value (≈:1038). Both are accepted and documented (§15).
  - **Raising** defers every r1 that has not been sent, and the dialog cap moves with it. Under w2-live the
    working-reply backoff runs quiet time, twice it, four times it, never past the 16 h ceiling.
  - r2, r3, `STALL_BOUND_MS` (r1 + 3 h) and every cap keep their fixed values. Raising the quiet time cannot invert
    r1 and the bound, because the bound is measured from r1's own time (`stallProofDue` ≈:932).
- **The note under the control.** One static line, defined once in L0, with no number in it: "This also sets when a
  stuck dialog is pushed to you, and the base of the back-off for a worker that keeps answering 'working'."

## 8. Storage and migration

**Table** (one migration, which also adds one index):

```sql
CREATE TABLE stall_settings (
  -- writer = setStallSettings (the settings route); reader = stallSettings (both sweeps, both route halves)
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  level     TEXT NOT NULL,      -- 'follow' or a StallLevel id; read through isStallLevelChoice, never cast
  quietMs   INTEGER,            -- NULL = the built-in STALL_QUIET_MS; read through isStallQuietMs, never cast
  updatedAt INTEGER NOT NULL
);
INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (1, 'follow', NULL, 0);
CREATE INDEX IF NOT EXISTS run_events_by_at ON run_events(at);
```

- **The seed is today's behaviour.** `follow` plus the built-in default, so W1 changes nothing on deploy.
- **The index serves the notice-count read (§11).** `run_events` has only `run_events_by_run(runId, at)`
  (`schema.ts` ≈:108), so a window read on `at` alone would scan the table. The executor measures with
  `EXPLAIN QUERY PLAN` and keeps the index only if the plan uses it; a pinned `EXPLAIN QUERY PLAN` row, as
  `stall-store.test.ts` does for the mail indexes, keeps it used. Departure `run-events-at-index`.
- **The slot is the next free one, measured, never assumed.** On `origin/main` at `c41bf8c56`, `MIGRATIONS` has 16
  entries (the last is `user_version 15 -> 16`, child reclamation's `sessionBornAt`), so this entry would be
  `16 -> 17`. Migration slots are a cross-branch namespace; entries 12, 15 and 16 each record a branch that moved.
  - The executor re-measures at the first step, before the PR, and before merge:
    `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`.
  - Whichever branch merges second moves up a slot.
  - The tests that pin the version move with it: `coord-db.test.ts` (≈:673, ≈:732) and `asks-store.test.ts`
    (≈:29) pin `16` today.
  - **Two DDL-diff tests in `coord-db.test.ts` migrate a planted database to the CURRENT version and compare the
    whole difference by equality, and both would red:** the table diff that must equal `UPDATE_TABLES` (≈:1013–1020,
    migrating from 13; `stall_settings` would join it) and the index diff from `SLOT - 1` that must equal
    `['mail_by_at','mail_by_run','mail_deliveries_by_mail']` (≈:1222–1230; `run_events_by_at` would join it). Each is
    narrowed to its own entry's names, as ≈:1118 already filters by `UPDATE_TABLES`, so a later entry never edits
    them again.
  - **The new entry's own diff test** finds its slot by DDL (`MIGRATIONS.findIndex(m => m.includes('stall_settings'))
    + 1`, as the stall-index test finds its `SLOT` at ≈:1195), so a slot move edits no line: from `SLOT - 1` it adds
    exactly `stall_settings` and `run_events_by_at`, seeds one `follow`/`NULL` row, and keeps existing rows.
- **Refuse-to-start rules are unchanged.** `openCoordDb` (`db.ts` ≈:171–218) migrates forward or throws
  `CoordDbUnmigratable` (it never opens empty). It reads a higher `user_version` as-is and migrates nothing, which is
  the rollback arm. `COORD_SCHEMA_VERSION` stays `MIGRATIONS.length`. Columns are additive only.
- **Store methods.** Synchronous `node:sqlite`, never wrapped async:
  - `stallSettings(): StallSettingsRead`, which is `{kind:'row', row} | {kind:'absent'} | {kind:'unreadable', detail}`.
    The statement is **prepared and run inside its own `try`**, so a missing table or a driver throw becomes
    `unreadable`, following D-2545's all-or-failure idiom. The row shape,
    `StallSettingsRow { level: unknown; quietMs: unknown; updatedAt: number }`, is an L2 port declared by the
    consumer in `stallsettings.ts`, as `stall.ts` declares `StallRunRow`; the parse decides what the values mean.
  - `setStallSettings(patch, at): { before: StallSettingsRead; after: StallSettingsRead }`. The patch is
    `{ level?: StallLevelChoice; quiet?: {kind:'default'} | {kind:'set', ms} }`. It runs in one `tx()`: read, then
    an upsert, then read again. **The insert arm** (a lost row) takes its values from the migration's seed (`level
    'follow'`, `quietMs NULL`), overridden only by the named fields, with `updatedAt = at`. **The update arm** sets
    only the named fields and `updatedAt`, so a quiet-only write keeps a stored level as it is, an unreadable token
    included. It validates nothing; the route has already decided (the `setCaps` division of labour).
  - `stallObservationsSince(since): {ok: true, rows: {at, detail}[]} | {ok: false, detail}` (§11).
- **Fallback when unreadable or absent.** Each sweep acts on today's behaviour: box files and the built-in default,
  field by field (an unreadable quiet time alone still lets a readable chosen level apply).
  - **A warn latch, per field and per row.** It prints `console.warn('ccrc-server: stall-watch settings unreadable
    (…) — following the box files')` (or `— using the built-in quiet time` for the quiet field alone) once per latch,
    and re-arms once a read succeeds. So a stuck row does not log every 10 s through the mail sweep. The server
    never uses `req.log` (`Fastify({ logger: false })`).
  - **The reply says so.** It reports `stored: 'absent'` or `'unreadable'`, and each field's own `unreadable`, so
    the section never shows a choice it is not applying.
- **A boot trace.** The first successful read after the server starts prints one line when anything is chosen:
  `console.warn('ccrc-server: stall-watch level <label> / quiet time <value> chosen in Settings overrides the box
  files')`. A roll-forward that brings an old choice back, or a restored `coord.db`, then leaves a trace.
- **No journal.** Caps have none either. A lost `coord.db` loses the choice, and the watch falls back to the files.
  `ccrc update` and `ccrc backup` snapshot `coord.db` into `~/ccrc-backups/<ts>/`, which is the recovery (§15).

## 9. Wiring: the stall sweep and the mail gate

Both sweeps call the one resolver, with the store's one read, over their own listing.

**`stallSettingsNow(store)`** is one private method on `FleetWatcher`. It does `store.stallSettings()`, then
`parseStallSettings`, plus the warn latch and boot trace from §8. **It never throws.** Its whole body is wrapped in a
`try/catch`; on any throw (a store bug, a parse bug, a bad driver value) it answers the "absent" parse, which means
today's behaviour, and warns through the latch. This matters because `sweepMail` runs under
`void this.sweepMail().catch(() => {})` (`watch.ts` ≈:1725), which drops an error without a log line: a throw on
this path would otherwise stop all mail delivery fleet-wide, silently. It is the only place either sweep reads the
row, so the two cannot read it differently.

**`sweepMail`** (≈:4531):
1. The `listing === null || listing.includes(MAIL_DISABLED_MARKER)` return (≈:4541) stays first and is unchanged.
   On that return it clears `this.mailModeApplied` (below).
2. The mode line at ≈:4546 becomes
   `const mode = resolveStallWatch(stallBoxArmingOf(listing, false), this.stallSettingsNow(store)).arming.mailMode;`
   followed by `this.mailModeApplied = mode`. `false` is correct here because the return above has already proven
   `mail-disabled` absent from this listing.
3. Everything downstream is unchanged and keeps reading `mode`: `mailTurnReadsMark(mode)`, the
   `mailTurnIdle(…, mode)` call at ≈:4973, and the busy-shadow "would deliver" log at ≈:4999.

**`sweepStalls`** (`watch.ts` ≈:3775). The inline line at ≈:3788 becomes:

```ts
const resolved = resolveStallWatch(stallBoxArmingOf(names, names.includes(MAIL_DISABLED_MARKER)), this.stallSettingsNow(store));
const arming = { ...resolved.arming, mailMode: stallJudgedMailMode(resolved.arming.mailMode, this.mailModeApplied) };
if (arming.disabled) return;
```

`stallJudgedMailMode(resolved, applied)` is L1, in `stallsettings.ts`: it answers `applied` when the mail gate has
applied a mode, and otherwise the resolved mode with `busy` read as `busy-shadow` (no busy delivery has happened
yet). Departure `stall-sweep-reads-the-applied-mail-mode`.

**Why the stall sweep reads the applied mode.** Each sweep reads the row at its own time: the mail sweep every 10 s
(`MAIL_SWEEP_MS`), the stall sweep at most once per 60 s (`STALL_SWEEP_MS`). So a write can split them for up to
60 s, and a box file touched between two listings can split them the same way. One direction is harmful: raising
straight to `deliver` or `all`. If the stall sweep read `busy` before the mail gate had delivered once under it,
`stallIdleStart` (`stall.ts` ≈:1735) would time mail-stuck from the turn's stop rather than stop +
`DELEGATE_CAP_MS`, and every mail the busy-shadow gate had held for `MAIL_STUCK_MS` (72 min) or more would be judged
stuck at once, with the wave-2 step live. Reading the applied mode means the stall sweep judges mail against what
the gate actually did, so that window cannot open. Lowering is the harmless direction and needs nothing.

`resolved.quietMs` is threaded to `judgeStall` and set on the `StallInput` built at ≈:3877.
`judgeStallCoordinator` and `judgeStallOrphan` take the same `arming`. They do not read the quiet time, because
their arms use fixed constants.

**Agreement.** Given the same listing and the same row, the two sweeps resolve the same arming, and the stall sweep's
judged mail mode equals the mode the mail gate last applied. A test drives both sweeps from one fixture listing and
one stored row and asserts that for every level and for `follow` (§17, M8).

**With nothing chosen,** `arming` is the very object `stallBoxArmingOf` built, which is today's expression. So
`follow` is today's behaviour by construction. A property test over every combination of the seven arming files
plus `mail-disabled` asserts it (§17, M4). (The judged mail mode under `follow` is the box's own mode once the mail
gate has run, which is today's value.)

## 10. The two routes

One path, registered in `server/src/coord/routes.ts` beside `/api/coord/caps`: **`GET` and `POST
/api/coord/stall-watch`.** One path serves both verbs, as caps does, so one `SESSION_ONLY` entry covers the door.

- **`GET /api/coord/stall-watch`.**
  - No `deps.coord`: 501 `{ok: false, error: 'not-configured'}`, the existing `notConfigured` helper (≈:506).
  - Otherwise 200 `{ ok: true, ...StallWatchView }`, from one view builder,
    `stallWatchView(store, names | null, now)`. The builder is defined once and shared by both halves (the
    `capsView` precedent, ≈:2404). `names` comes from `await deps.io.readdir(deps.cfg.registryDir)`, which the route
    file already does at ≈:587 and five other sites.
  - It answers 200 even when the listing failed (`effective.measured: false`), when the row is absent or unreadable
    (`stored`), and when the notice read failed (`notices.ok: false`). Each is a fact the section renders, not a
    refusal.
- **`POST /api/coord/stall-watch`.** The body is `StallWatchRequest { level?: StallLevelChoice; quietMs?: number |
  'default' }`, a partial in which an omitted field keeps its stored value. `'default'` returns to the built-in. No
  `null` crosses the wire.
  1. No `deps.coord`: 501 `not-configured`.
  2. `decideStallSettings(req.body)`, which is L1 and pure, refuses with 400
     `{ok: false, error: 'bad-request', detail}`:
     - a non-object body;
     - a body naming neither field;
     - **an unknown key, named in the detail.** This follows the update-intent precedent over the caps one: a newer
       PWA sending a knob this server lacks must hear that it was not applied. Departure `unknown-keys-refused`.
     - a level that is not a `StallLevelChoice`;
     - a `quietMs` that is not `'default'` and fails `isStallQuietMs`.

     Refusals never clamp.
  3. `const { before, after } = coord.setStallSettings(patch, Date.now())`. This is one synchronous transaction
     with no `await` inside, so two concurrent writes cannot interleave a read-merge-write.
     - **No `coordMutex`.** Caps needed the mutex because its merge base was read across an `await`, and because
       dispatch decisions read caps under that mutex. Neither is true here: nothing decides a dispatch on these
       values, and the sweeps' reads are synchronous too.
     - Departure `no-coord-mutex-for-stall-settings`. If review prefers the caps shape anyway, wrapping the one call
       costs nothing.
  4. **The feed event,** only if `before` and `after` differ in `level` or `quietMs` (never `updatedAt`, which every
     write moves). A no-op write records nothing; departure `no-op-write-records-no-feed-event`.
     - `deps.notifyLog.record({ kind: 'coord', sessionId: '', runId: null, title: 'stall watch changed', body })`,
       then `coord.recordFeedEvent(log.epoch, ev)`, in a `try`, with `void log.flush()` in `finally`. This is
       exactly caps' shape and D-1213's reason (routes.ts ≈:2462–2497).
     - The body names only what changed, with L0 labels, for example
       `level: Follow the box files → Check silent workers; quiet time: 2 h (built-in) → 3 h`.
     - A failed archive write degrades the record, never the write.
  5. Take a fresh listing, then 200 `{ ok: true, ...stallWatchView(store, names, now) }`. The builder
     **re-reads** the row from the store, never echoing the body or `after`, so the reply is what is now stored.
  6. A thrown store write becomes Fastify's 500, which is the caps precedent. No new code word is minted.
- **Gating.** Session-gated when `CCRC_AUTH` is armed, open dark otherwise.
  - No box token and no `UNGATED` membership. The route's docstring argues both, as caps' does (D-1240): an operator
    control is not a machine lane, and a ladder raise releases no wedge.
  - `auth/gate.ts` gains no `EXEMPT` row.
- **Census changes (all in W1):**
  - **`server/test/coord-pause-route.test.ts`:** `SESSION_ONLY` (≈:221) gains `'/api/coord/stall-watch'`. Its
    scan reads `app.post` handlers only, and the shared path is how caps' GET half rides the same entry. Its
    docstring gains a `/api/coord/stall-watch` paragraph in the caps and reclaim-pause paragraphs' shape (an operator
    dial; raising it releases no wedge; D-1240's argument). The blind-spot sentence (≈:212–214, "SESSION_ONLY already
    holds two (`/api/coord/caps`, `/api/coord/reclaim-pause`), so kickoff would be its third") becomes "holds three
    (…, `/api/coord/stall-watch`), so kickoff would be its fourth", in lower case, so `CARD_RE` is unaffected.
  - **`server/test/auth-gate.test.ts`:** `expect(scanRoutes('coord/routes.ts').length).toBe(31)` (≈:242) moves to
    33, and `expect(ROUTES.length).toBe(89)` (≈:313) moves to 91, each with its comment-ladder line in the file's
    idiom ("33 since `GET`/`POST /api/coord/stall-watch` (stall-watch settings W1): SESSION_ONLY like the caps dial,
    NOT EXEMPT, no box token"). `'GET /api/coord/stall-watch'` and `'POST /api/coord/stall-watch'` join the file's
    list of specific registrations it found.
  - **`server/test/coordinator-skill.test.ts`:** every route registered in `coord/routes.ts` must be named in the
    coordinator skill corpus or listed in its route-corpus `EXEMPT` set (≈:485–537). The skill's clauses are pinned
    verbatim, so the route is never named there. Instead `'GET /api/coord/stall-watch'` and
    `'POST /api/coord/stall-watch'` join `EXEMPT` with an operator-dial comment, beside caps (≈:525–526) and
    reclaim-pause (≈:533). And a forbid-mention case joins the caps dial's (≈:1569): "never names the stall-watch
    settings door — a door that would tell a coordinator how to lower the watch on its own workers or stretch their
    quiet time", `expect(allSkillText).not.toContain('/api/coord/stall-watch')`.
  - **`server/test/box-token-census.test.ts`:** no code edit. `SESSION_ONLY_DOORS` is harvested (≈:199), so the new
    member flows into `SESSION_ONLY_ALL`. Its "CLAUDE.md's box-token bullet is TRUE" row (≈:658–664) then reds
    until the bullet names the path. That red is what drives the next edit.
  - **`CLAUDE.md`, the box-token bullet** (≈:276–281). The sentence becomes:

    > `POST /api/sessions/:id/kickoff` (wave 4), `POST /api/coord/caps` (wave 6), `POST /api/coord/reclaim-pause`
    > (child-reclamation wave 4) and `POST /api/coord/stall-watch` (stall-watch settings wave 1) are session-gated
    > only … The other three are in that file's `SESSION_ONLY` set …

    "three" is lower case, because `coord-pause-route.test.ts`'s `CARD_RE` scans capitalised counts (`FOUR` stays
    the door count), and this bullet has no lower-case numeral scan. The bullet's opening and closing anchors
    (`- **Box token gates every coordination WRITE**`, `\n- **Mail delivery is idle-gated`) stay unchanged, because
    both scanners slice on them.
  - **`CLAUDE.md`, the mail-gate bullet,** gains one sentence: a level chosen in Settings (`POST
    /api/coord/stall-watch`, design 2026-10-05) overrides the arming files, never `stall-watch-disabled`,
    `mail-disabled` or `mail-gate-strict`, and writes no file.
- **Kebab scan.** The new file spells one kebab token, `'busy-shadow'`, as a `MailTurnMode` value in `STALL_LADDER`
  and `stallJudgedMailMode`. It is declared to `mail-routes.test.ts`'s scan through a guard the file exports,
  `isStallSettingsKebab`, added as one more union beside `isStallKebab` (≈:831). Every other word is a single word
  by choice: level ids, `follow`, `default`, `chosen`, `files`, `custom`, `unknown`, `box`.

## 11. The notice-count read

- **Store:** `stallObservationsSince(since)` returns `SELECT at, detail FROM run_events WHERE at >= ?`. There is no
  `ORDER BY`: the counts are order-free, and an `ORDER BY id` would invite a rowid scan on a database that never sees
  `ANALYZE` (`schema.ts`'s own note). An `EXPLAIN QUERY PLAN` row pins the plan to `run_events_by_at`.
  - The store spells no detail head. The heads (`stall`, `stall-shadow`) are spelled once, in `stall.ts`, and
    `single-definition.test.ts` reds on a second copy. Classification therefore happens in L1, the same discipline
    as D-792's "judged in L1, never filtered by the store".
  - A thrown statement becomes `{ok: false, detail}`.
- **L1:** `stallNoticeCounts(rows)` in `stallsettings.ts`.
  - It parses each `detail` with `parseStallDetail` (`stall.ts` ≈:165). Every row that is not exactly a stall
    detail of this build reads `null` and is skipped: transitions, routing details, and an arm this build cannot
    name.
  - It tallies into **three rows, one per rung recipient**, by `rungRecipient(arm, rung)` (`stall.ts` ≈:744):
    checks to workers, reports to coordinators, pushes to you. Each row has `sent` (mode `live`) and `shadow` (mode
    `shadow`), summed across arms. Departure `counts-per-rung-by-recipient`: the approved "per rung" is read as the
    ladder's three rungs (r1 worker, r2 coordinator, r3 you), because a rung number alone would file a dialog-cap
    push (rung 1, to you) under worker checks. The three labels are defined once in L0.
- **Window:** `STALL_NOTICE_WINDOW_MS = 48 h`, defined once in `stallsettings.ts`. `since = now - window`. The reply
  carries `windowMs` and `since`.
- **What a row means.**
  - One row is one rung's observation on one run, recorded before it is sent. `insertStallObservation` dedupes on
    `(runId, detail)`, so a restart never double-counts.
  - A `live` row means the notice was queued or pushed. Mail delivery may still lag, so the column is labelled
    "sent".
  - A rung recorded in shadow and later live, after an arming change, is two rows and counts once in each column.
- **What is not counted, and the section says so.** Run-less notices, **sent or shadow**, leave no observation row:
  a coordinator's own notices (`coordinator-notices-are-run-less`, deduped by subject) and notices about a session on
  no run (orphan D pushes, latched in memory, D-3751). Run-less shadow notices appear only as the `ccrc-server:
  stall-watch shadow … (run-less)` log line. So the "sent" column under-counts at `alert` and above, and the counts
  cannot show R19's run-less push count.
- **Cost.** The read is bounded by 48 h of `run_events` on the `run_events_by_at` index, and runs once per GET (60 s
  per open Settings page).

## 12. Wire types (L0, `shared/api.ts`, additive, imports nothing)

```ts
export const STALL_LEVEL_TEXT = { off: {label, does, gate}, log: {…}, check: {…}, alert: {…}, deliver: {…}, all: {…} } as const;
export type StallLevel = keyof typeof STALL_LEVEL_TEXT;
export const STALL_LEVELS = Object.keys(STALL_LEVEL_TEXT) as StallLevel[];   // ladder order, pinned
export type StallLevelChoice = StallLevel | 'follow';
export const STALL_FOLLOW_LABEL = 'Follow the box files';
export const STALL_QUIET_NOTE = '…';                                          // §7's note, no number
export const STALL_HAZARD_TEXT = '…';                                         // §6.4's hazard line
export const STALL_NOTICE_TEXT = { worker: '…', coordinator: '…', operator: '…' } as const;  // §11's three rows
export function isStallLevelChoice(v: unknown): v is StallLevelChoice;

export interface StallWatchStages { runs: boolean; workerChecks: boolean; escalation: boolean;
  busyLog: boolean; busyDelivery: boolean; wave2: boolean }
export type StallWatchEffective =
  | { measured: false }                                              // unlistable registry → "unknown"
  | { measured: true; level: StallLevel | 'custom'; files: StallLevel | 'custom';
      source: 'chosen' | 'files'; stages: StallWatchStages;
      held: { watchOff: boolean; mailOff: boolean; gateStrict: boolean; wave2HeldByStrict: boolean } };
export interface StallNoticeCount { to: keyof typeof STALL_NOTICE_TEXT; sent: number; shadow: number }
export interface StallWatchView {
  chosen: { level: StallLevelChoice | 'unreadable'; quietMs: number | 'default' | 'unreadable';
            updatedAt: number | null; stored: 'row' | 'absent' | 'unreadable' };
  effective: StallWatchEffective;
  quiet: { effectiveMs: number; builtInMs: number; minMs: number; maxMs: number; stepMs: number;
           source: 'chosen' | 'default' };
  notices: { ok: true; since: number; windowMs: number; counts: StallNoticeCount[] } | { ok: false };
}
export interface StallWatchRequest { level?: StallLevelChoice; quietMs?: number | 'default' }
```

- **`stages` is derived server-side** from the resolved `StallArming` (the resolver's mode, not the judged one):
  - `runs = !disabled`;
  - `workerChecks = runs && live`;
  - `escalation = runs && live && escalate`;
  - `wave2 = runs && w2Live === true`;
  - `busyLog = mailMode === 'busy-shadow'`;
  - `busyDelivery = mailMode === 'busy'`.

  So no mail-mode word crosses the wire, and `MailTurnMode` gains no second definition in L0. Departure
  `stages-on-the-wire-not-modes`.
- **`counts` always carries the three rows**, zeros included, in L0 key order.
- **The reply builders return literals,** so a field added later is a compile error until every path computes it.
- **Absence-permits.** A newer PWA reading an older reply treats a missing optional field as "not stated", never as
  `false` (§13's wire guard).

## 13. The PWA section

**Placement.** A third section on the Settings screen, after Notifications, titled **Stall watch**. It lives in its
own component file, `pwa/src/screens/StallWatchSection.tsx`, which `SettingsScreen.tsx` renders.
- `SettingsScreen.tsx`'s header comment (≈:1–7, "Two sections and no more") is amended to name three sections.
- The `SettingsScreen` comment "ONE poll and ONE clock for the whole screen" (≈:677) is amended. The Updates and
  Notifications sections still share one `/api/updates` poll. The Stall watch section reads its own endpoint through
  its own hook.

**Hook.** `pwa/src/fleet/useStallWatchView.ts`, modelled on `useUpdatesView` (≈:232):
- `STALL_WATCH_POLL_MS = 60_000`, the stall sweep's cadence; a faster read would fetch the same answer again.
- A re-poll when the page becomes visible again.
- The newest issued request is authoritative. Unlike `useUpdatesView`, whose `issued` counter is local to its effect
  (≈:240), this hook keeps `issued` in a `useRef` shared by `load` and `settle`, because `settle` must bump it.
- `pollMs <= 0` puts the hook in injected mode, for tests.
- It returns `{ view, failure, reload, settle }`:
  - `view` is the **last good** answer;
  - `failure` is `'not-configured' | 'failed' | null`. Only 501 with `error: 'not-configured'`, and 404 with
    `error: 'not-found'` (an older server that lacks the route: the server's `/api/*` not-found answer, `server.ts`
    ≈:3468–3473), map to `not-configured`; both status and code must match, as `useUpdatesView`'s `failureOf`
    requires (≈:214–222). Anything else is `failed`. Departure `older-server-404-reads-not-configured`.
  - `settle(view)` installs a write's reply and bumps the request generation, so a poll issued before the write that
    lands after it cannot overwrite the reply.
- **Wire guard.** `asStallWatchView(raw)` accepts only a structurally readable answer, and anything else counts as a
  failed read. It drops malformed `counts` elements with one `console.warn`, as `asUpdatesView` does.

**API.** In `pwa/src/lib/api.ts`:
- `stallWatch: () => getJson<StallWatchView>('/api/coord/stall-watch')`.
- `setStallWatch: (body: StallWatchRequest) => postJsonOr<StallWatchView | 'unreadable'>('/api/coord/stall-watch',
  'unreadable', body)`. It uses `postJsonOr` for `setCoordCaps`' reason (D-1150): after a write, "the answer could
  not be read" is not "the request never happened".

**States.** These are the Updates section's discipline (≈:699–716). "Don't know yet" never borrows the rendering of
"nothing there".
- A view landed: render it. If a later poll failed, add the amber "The latest read failed — this is the last answer
  that landed."
- `not-configured`: "Stall-watch settings are not available on this server."
- `failed`, with no view yet: "The stall watch settings could not be read — the screen tries again every minute."
- Otherwise: `<Skeleton lines={3}/>`.

**Layout.** Top to bottom:
1. **Now.** The effective level's label and its `does` sentence, or one of:
   - "Custom (box files)" (or "Custom" when chosen), followed by one line listing the `stages` that are on;
   - "Unknown — the fleet registry could not be read", never "Off".

   Then the source line: "Chosen here" or "Following the fleet box's files". If the level is `log`, `check` or
   `alert` and `stages.busyLog` is false, it adds "(busy-gate log off)".

   Then one line per `held` flag, worded without file names:
   - "A kill switch on the fleet box has the watch off, whatever is chosen here."
   - "Mail is switched off on the fleet box: checks and reports are held."
   - "The mail gate is set to strict on the fleet box: busy delivery is off."
   - "Strict mode on the fleet box also holds the wave-2 step off."

   The hazard line (§6.4) when the stages call for it.

   Then the stored-choice lines, per field:
   - `chosen.stored` absent or unreadable: "The stored choice could not be read — following the box files and the
     built-in quiet time."
   - only `chosen.level` unreadable: "The stored level could not be read — following the box files."
   - only `chosen.quietMs` unreadable: "The stored quiet time could not be read — using the built-in."
2. **Next step.** For a ladder level below `all`: the next level's label and "Waits on: " plus its `gate`. At `all`:
   "Top of the ladder." For `custom` or `unknown`, this line is omitted.
3. **Level.** A radio `fieldset` of labels only. The first option is "Follow the box files (they say: <files level
   label>)"; the six level labels follow. The selected option's `does` and gate are not repeated here; they are in
   the Now and Next blocks.
   - The checked option is `chosen.level` **from the server's answer, never from the tap.** If the level is
     `unreadable`, no radio is checked.
   - The fieldset is disabled while a write is in flight.
4. **Quiet time before a worker check.** The effective value and its source ("2 h (built-in)" or "3 h (chosen
   here)"), its range ("30 min to 12 h", composed from `minMs`/`maxMs`), a `<select>`, and the note (§7).
   - The select offers "Built-in (<builtInMs>)", then every `stepMs` step from `minMs` to `maxMs`.
   - Its checked value also comes from the server's answer.
5. **Last 48 h.** Three rows, by the L0 labels: `<label> — <sent> sent · <shadow> shadow`. With `notices.ok` false:
   "The notice counts could not be read." The footnote is always shown: "Counts notices on runs only. Notices about a
   session that is on no run, or about a coordinator itself, sent or shadow, are not counted here; shadow ones
   appear only in the server log."

**Writes: settle on the reply, never optimistic.**
- On choose, call `api.setStallWatch` with only the field moved.
- A 2xx whose body passes `asStallWatchView` is installed with `settle(view)`, and the controls re-render from it.
- A 2xx whose body is unreadable gives `toast(UNCONFIRMED_TEXT)`, the existing constant (≈:72), then `reload()`.
- A refusal gives `toast(<error text naming the server's detail>, 'error')`, then `reload()`. Because the controls
  render from the server's answer, they show the stored value again.

**Confirm on raise.** On a level choice the section first calls `reload()` and decides from the fresh answer, so a
change made from another page in the last minute is seen. Choosing a level whose rank is above the current effective
level's then opens `QuickConfirm` (`pwa/src/components/QuickConfirm.tsx`):
- **Rank of the current level.** From `custom` or `unknown`, the current rank counts as `log`.
- **Choosing "Follow the box files"** confirms when the files' level ranks above the effective one, or reads
  `custom`.
- **The sheet:**
  - title: "Raise the stall watch to <label>?";
  - consequence: the target's `does`; then "Waits on:" and the `gate` of **every step crossed**, in ladder order;
    then one line, defined once in L0: "Notices already recorded in shadow for open episodes go out at the next
    sweep.";
  - confirm label: "Raise".
- Cancel writes nothing. Lowering, and choosing `off`, write without a confirm: guide, don't block.

**Same everywhere.** There is no viewport, pointer or user-agent branch in the section's behaviour. Its CSS uses the
existing `.settings-*` classes in `fleet.css`. No string in the section says "phone".

**Test hooks.**
- The hook's injected mode.
- `vi.spyOn(api, 'stallWatch' | 'setStallWatch')`.
- Exported pure helpers, each unit-tested: `stallLevelRank`, `crossedGates(from, to)`, `stallNowLines(view)`,
  `quietChoices(view)`.
- A new `describe` in `pwa/test/settings-screen.test.tsx` per task, using that file's idiom (≈:46–51 `afterEach`,
  module-level fixtures, `ApiError(501)`/`(404)` rejections, a never-resolving promise for loading).
- `pwa/test/use-stall-watch-view.test.tsx` beside `use-updates-view.test.tsx`.

## 14. Invariants kept, and how each stays true

1. **No marker has a writer in the tree.**
   - The server creates and removes no file.
   - The no-writer pins (`single-definition.test.ts` ≈:4081, ≈:4211) are not edited and must stay green. Their
     `ROOTS` walk `server/src` recursively, so the new file is inside them.
   - No new file spells a marker name on a code line, and none assembles one from pieces.
   - The agent's write scope is unchanged (`whitelist.ts`, `~/.cc-clips` only).
2. **Zero new ccd verbs, and no agent change.** The routes touch `coord.db` and one `readdir` only.
   `EXEC_COMMANDS = ['tmux','ccd']` is unchanged.
3. **D-3607: the mail-gate marker names stay in `turnidle.ts` alone.** The new file calls `mailTurnModeOf` and never
   spells a name. `stall.ts` gains only the `quietMs` field, its reader and the backoff ceiling. Its single value
   import stays L0, which `stall-vocabulary.test.ts` pins.
4. **L0 imports nothing.** The new `shared/api.ts` members are literals, types and one guard.
5. **L1 purity, enforced by its own rows.** No existing scan covers a new L1 file, so
   `server/test/stall-settings.test.ts` carries purity rows in `stall-vocabulary.test.ts`'s idiom (its
   `NODE_BUILTIN`, `SIDE_EFFECT_IMPORT` and `valueImportSpecifiers` shapes): no `node:` import, no `require` or
   dynamic import, no `Date.now` or `new Date`, and value imports only from `../../../shared/api.js`, `./stall.js` and
   `../turnidle.js`, with a CONTROL row proving the scan reads the file. `turnidle.ts` still imports nothing.
6. **The mail gate's precedence (strict > busy > busy-shadow > shell)** holds whenever the files decide; a strict
   file still wins under any chosen level, and also holds the wave-2 step off (§6.3).
7. **Kill switches fail shut.** An unlistable registry still stops both sweeps before any resolve.
   `sweepMail`'s `mail-disabled` return is still its first check. `stall-watch-disabled` restores the box arming
   wholesale under every level.
8. **`coord.db` stays synchronous.** The migration refuses to start rather than open empty, columns are additive, and
   the slot is measured.
9. **The box-token and route censuses.** One `SESSION_ONLY` member with its docstring paragraph and the corrected
   blind-spot count; `auth-gate.test.ts`'s route counts moved (31 → 33, 89 → 91); `coordinator-skill.test.ts`'s
   `EXEMPT` entries and its forbid-mention case; and the `CLAUDE.md` sentence updated. `UNGATED` is unchanged, and so
   is every count site's `FOUR`.
10. **Wire discipline.** Additive types. `FLEET_PROTO` is untouched and no frame changes. Each new field has one
    reader (the PWA's `asStallWatchView`, and the server's `parseStallSettings`).
11. **No overloaded null at a seam.**
    - Absent and unreadable are separate words from the store to the wire, per field.
    - `'default'`, never `null`, means the built-in on the wire.
    - `{measured: false}` is not `off`, and `off` is never read back while busy delivery is on.
    - The SQL column's `NULL` has exactly one meaning and is converted at the store's read.
12. **Single definition.**
    - The level texts and every section string are defined once, in L0, with no copy of a stall constant's value.
    - The ladder flags are defined once, in L1.
    - The quiet bounds, step and the notice window are defined once, in L1, and shipped on the reply.
    - One predicate, `isStallQuietMs`, serves the write and the read.
    - `STALL_QUIET_MS` stays the one built-in default, and its constants pin is unchanged. The backoff ceiling is
      derived from the constants it guards.
    - The detail heads stay spelled only in `stall.ts`.
13. **The kebab scan.** `'busy-shadow'` is declared through `isStallSettingsKebab`. Every other word is a single
    word.
14. **"Follow" is today's behaviour.** The resolver returns the box arming object itself, and a property test pins
    it (M4). The backoff ceiling sits above the default's 8 h peak, so the default is unchanged there too.
15. **The watch never closes, reclaims or re-dispatches.** That is unchanged. Settings only changes which rungs send,
    and when r1 falls due.
16. **Server logs** go through `console.warn('ccrc-server: …')`.
17. **Mutation-table discipline.** Every guard named in §17 ships with a row measured red when it is deleted or
    mutated.

## 15. Failure modes

| Condition | What happens | What the operator sees |
|---|---|---|
| The registry cannot be listed | Both sweeps return before resolving, as today. The GET answers `effective.measured: false`. | "Unknown — the fleet registry could not be read". The chosen values are still shown. |
| The settings row is absent, or its read throws | Both sweeps follow the box files and the built-in default. One warn per latch. | "The stored choice could not be read — following the box files and the built-in quiet time." |
| Any throw inside `stallSettingsNow` (a store, parse or resolve bug) | Caught; today's behaviour; one warn per latch. Mail delivery continues at the listing's mode. | As the row above. |
| The level token is out of vocabulary (a newer build wrote it, then a rollback) | `unreadable`, so the watch follows the files; a readable quiet time still applies. | "The stored level could not be read — following the box files." No radio is checked. |
| The stored quiet time fails `isStallQuietMs` | `unreadable`, so the built-in applies. It is never clamped. A readable level still applies. | "The stored quiet time could not be read — using the built-in." |
| Rollback to a build without the table (a hand rollback, or the unattended `ccrc rollback --from watchdog` on a `server`/`both` box) | The older build reads `coord.db` at the higher version as-is and ignores the table. The choice, `off` included, silently stops applying, and the watch re-arms from the box files. | The section is gone. After a roll-forward the stored choice applies again, the boot trace logs it, and the section shows it. |
| `coord.db` is lost or restored from an older snapshot | The choice is lost or reverts; the watch follows the files or the older choice, with no notice beyond the boot trace. | The section shows what is stored now. For a stop that survives this, use the fleet box's kill switch (Off's own text says so). |
| A roll-forward brings back an old choice over box files touched while the section was gone | The old choice overrides those files (kill files and strict excepted). | The boot trace line; the section's "Chosen here" and "they say: …". |
| A migration slot collides with another branch | Two entries at one version: the second never runs on a database already past it. | Prevented by measuring the slot at the first step, before the PR and before merge (§8). |
| `CCRC_AUTH` is unarmed on a publicly reachable box | Anyone who reaches the server can set the level. This is the same exposure as caps and every PWA write. | The existing red unarmed-exposure banner on Settings. Arming auth is the remedy. |
| A level is chosen and the operator also hand-touches files | The files are ignored, except the kill files and strict. | `effective.source: 'chosen'` and the "they say: …" files reading show the difference. |
| Busy delivery armed by file (R18's order), then a level below Deliver chosen in Settings | Busy delivery turns off: the chosen level decides the mail mode. | The source line shows "Chosen here"; "they say:" shows the files' level. |
| A level is chosen before its gate is met | The step's known false classes go live: for example the mail-stuck and coordinator-deaf pushes under `all`, which R18 measured at 0/4 and 0/1. | The confirm showed every crossed gate first. Lowering takes effect at the next sweep. |
| A chosen `all` under `mail-gate-strict` | The wave-2 step is held off (strict switched busy delivery off). | Reads Alert, with the strict and wave-2 held lines. |
| Box files set by hand to escalation + wave-2 without busy delivery | Today's behaviour (the files decide). | The hazard line (§6.4). |
| The level is raised mid-episode | Every rung recorded in shadow in an open episode becomes due and is sent once at the next sweep (`rungDoneAt` ≈:756–764 counts a shadow row as done only while that rung is still shadow). Nothing already sent live is sent again. | A burst of r2/r3 and cap notices, possibly hours old. The raise confirm says so. |
| A level that turns on busy delivery is chosen straight from a lower one | The stall sweep judges mail against the mode the mail gate last applied, so a mail held under the shadow gate is not judged stuck before the gate has delivered once under busy (§9). | Nothing extra. |
| The quiet time is lowered (for example 2 h to 30 min) | The next sweep makes every worker quiet past 30 min due at once; at `alert` and above, every standing dialog older than 30 min also falls due for a dialog-cap push to you. | A burst of r1 checks, and of dialog pushes at `alert`+. The kill rule in the stall-watch spec §10 still applies: more than 10 armed r1 a day for two days means lower the level. |
| Two Settings pages write at once | Each write is one transaction, and the last one wins. Each reply re-reads, and the feed records both. A raise decision is taken on a fresh read (§13), but between that read and the write another page can still move the level; this is accepted, with the feed as the audit. | The next poll shows the final value on both pages. |
| The feed archive write fails | The setting is written and the record degrades, with a warn, and the flush still runs. | No feed row for that change. |
| A write's reply cannot be read | It may have landed. | "Saved — the server's answer could not be read; the screen will re-check." Then a reload. |
| A newer PWA meets an older server | The GET answers 404 `not-found`. | "Stall-watch settings are not available on this server." |
| The notice-count read throws | `notices.ok: false`. The rest of the view stands. | "The notice counts could not be read." |
| Busy-shadow logging under `log`, `check` or `alert` | The mail sweep reads the turn marker for busy and shell deliveries and logs one line per delivery it would deliver. This is today's live state (R26). | Log volume, the same as today's armed `mail-gate-busy-shadow`. |

## 16. Departures from the approved text (slugs; numbered at plan time)

- `files-level-match-ignores-the-busy-log`: reading a level back treats `shell`, `busy-shadow` and `strict` alike,
  so the busy-gate log never splits a level; a fresh install reads "Log only (busy-gate log off)". `stages.busyLog`
  reports it separately (§6.4, Q1).
- `strict-holds-the-wave-2-step`: under `mail-gate-strict`, a chosen level's wave-2 step is held off, because strict
  switched busy delivery off (§6.2).
- `stall-sweep-reads-the-applied-mail-mode`: the stall sweep judges mail against the mode the mail gate last
  applied, so a raise cannot open a window in which held mail reads stuck (§9).
- `backoff-ceiling-from-the-horizon`: the computed working-reply backoff is capped at 16 h, derived from the mail
  read's horizon, so the approved 12 h maximum cannot push the ladder out of its own read (§7).
- `quiet-half-hour-steps`: the server accepts only 30-minute steps in range, one rule with the PWA's list (§7).
- `counts-per-rung-by-recipient`: the counts tally the three rung recipients across arms (§11).
- `run-events-at-index`: the migration adds `run_events_by_at`, kept only if `EXPLAIN QUERY PLAN` uses it (§8).
- `unknown-keys-refused`: the POST refuses an unknown key, following update intent rather than caps (§10).
- `no-coord-mutex-for-stall-settings`: one synchronous transaction instead of caps' mutex (§10).
- `no-op-write-records-no-feed-event` (§10, Q4).
- `stages-on-the-wire-not-modes`: the reply carries derived booleans, never `MailTurnMode` words (§12).
- `older-server-404-reads-not-configured`: the PWA reads a 404 `not-found` as "not available on this server" (§13).

## 17. Testing and the mutation table

**Suites.**
- New: `server/test/stall-settings.test.ts` (L1: ladder, resolver, decide, parse, `isStallQuietMs`, judged mail
  mode, counts, purity rows), `server/test/stall-settings-store.test.ts` (migration, seed, store reads and writes,
  the insert arm's seed defaults, the `EXPLAIN QUERY PLAN` row) and `server/test/stall-settings-route.test.ts` (both
  halves, feed, refusals, re-read).
- Extended: `stall-sweep.test.ts`, `mail-sweep.test.ts`, `stall-verdict.test.ts`, `stall-backoff.test.ts` (the
  ceiling and the relation pins), `coord-pause-route.test.ts` (member, docstring), `auth-gate.test.ts` (route
  counts), `coordinator-skill.test.ts` (`EXEMPT`, forbid-mention), `mail-routes.test.ts` (kebab union),
  `coord-db.test.ts` (version pins; the two whole-diff tests narrowed to their own entries; the new entry's own diff
  test), `asks-store.test.ts` (version pin), and PWA `settings-screen.test.tsx` and `use-stall-watch-view.test.tsx`.
- Run green and unedited: `single-definition.test.ts`, `box-token-census.test.ts` (after the `CLAUDE.md` edit),
  `stall-vocabulary.test.ts`, `turnidle.test.ts`, `pools-prose.test.ts` (the README size claim stays within 100
  lines), and the README citation instrument (`session-hook.test.ts`'s seven rows).
- Server suites run per package in the foreground, `./node_modules/.bin/vitest run test/<file>`, timeout of at least
  600000 ms.
- Every server suite is hermetic: fixture HOMEs only, and no `ccd` against a live `$HOME`.

**Mutation table outline.** Each row is measured red before and after, and a comment does not count.

| # | Guard | Mutation | Red in |
|---|---|---|---|
| M1 | The lane's kill file restores the box wholesale | Drop the `box.disabled` arm | stall-settings (chosen `deliver` plus a disabled box gives the box's mail mode, never `busy`) |
| M1b | `off` is never read while busy delivery is on | Return `off` on `disabled` alone | stall-settings (chosen `off` or disabled box with box mode `busy` reads `custom`) |
| M2 | `mail-disabled` passes through | Set `mailDisabled: false` in the chosen arm | stall-settings, stall-sweep (a held rung under a chosen level) |
| M3 | Strict keeps its precedence | Use `row.mailMode` unconditionally | stall-settings, mail-sweep (strict plus chosen `deliver` delivers no `busy`) |
| M3b | Strict holds the wave-2 step | Drop `&& !strict` | stall-settings (chosen `all` under strict gives `w2Live` false and `wave2HeldByStrict`) |
| M4 | "Follow" is today's behaviour | Return a rebuilt object, or alter any field | stall-settings property test over all 2^8 file combinations: the resolved arming equals today's expression |
| M5 | `custom` | Map no-match to the nearest step | stall-settings (escalate without live gives `custom`) |
| M6 | Unknown is never off | Map a `null` listing to `off` | stall-settings-route (`measured: false`), PWA (the "Unknown" line) |
| M7 | `sweepMail` uses the resolved mode | Revert to `mailTurnModeOf(listing)` | mail-sweep (chosen `deliver` with no busy file delivers on `busy`; chosen `off` keeps the box's mode) |
| M8 | One resolver; stall sweep judges the applied mode | Give one sweep its own mapping; or feed the stall sweep the resolved mode | A shared fixture drives both sweeps: equal arming for every choice, judged mode equals applied mode; stall-sweep (raise from `alert` straight to `all` with a mail held over 72 min: no mail-stuck send on a stall sweep before the mail sweep has run) |
| M9 | The quiet time reaches all three uses | Revert any one site to `STALL_QUIET_MS` | stall-verdict (r1 and the dialog cap at a chosen 30 min and 12 h), stall-backoff (base times 1, 2, 4) |
| M9b | The backoff ceiling | Drop the cap, or raise the ceiling past its relation | stall-backoff (12 h quiet with streak 2 gives 16 h; the four relation pins in §7) |
| M10 | Bounds and step are refused, never clamped | Clamp, widen by one step, or accept a non-step | stall-settings (29 min, 45 min and 12 h 30 min refused; 30 min and 12 h accepted); route (the stored value equals the sent value) |
| M11 | One predicate for write and read | Give `parseStallSettings` its own range check | stall-settings (one table of values fed to both; `1800000.5` and a TEXT value read `unreadable`) |
| M12 | The seed and the insert arm are today's behaviour | Seed any level or quiet time; insert a quiet-only patch with another level | stall-settings-store (`follow`/`NULL`; delete the row, POST `{quietMs}` alone, level reads `follow`), stall-sweep (an unchanged verdict with the migrated database) |
| M13 | The reply re-reads | Echo the body | stall-settings-route (a write racing a second write answers the stored value) |
| M14 | Unknown key or empty body refused | Ignore unknown keys | stall-settings-route (400 names the key) |
| M15 | Feed event on a change of level or quiet time only, flush in `finally` | Compare whole reads (with `updatedAt`); move the flush into the `try` | stall-settings-route (the same body POSTed twice gives one feed row; a throwing `recordFeedEvent` still flushes) |
| M16 | Censuses | Drop the `SESSION_ONLY` member, the `CLAUDE.md` path, the `EXEMPT` entries, or the forbid-mention case; leave the route counts | coord-pause-route, box-token-census, auth-gate (31/89 pins), coordinator-skill |
| M17 | Counts: live versus shadow, the window, run-bound only, by recipient | Swap the modes; use `>` for `>=`; count unparsed rows; tally by rung number | stall-settings (a boundary row at exactly `since`; a transition row is ignored; a dialog-cap row counts as a push to you) |
| M18 | Kebab declaration | Remove `isStallSettingsKebab` from the scan | mail-routes |
| M19 | No marker name in new code | Spell a marker in a gate text | single-definition (the existing pins; a control row confirms the new files are inside the walked roots) |
| M19b | L1 purity of `stallsettings.ts` | Add a `node:fs` import, a `Date.now()`, or a `db.js` value import | stall-settings purity rows |
| M20 | `stallSettingsNow` never throws | Remove its try/catch | mail-sweep (a stub `store.stallSettings` that throws still lets `sweepMail` deliver at the listing's mode) |
| P1 | Three-state render | Collapse `failed` into the skeleton | settings-screen |
| P2 | Checked from the server | Check from the tap | settings-screen (a refused write leaves the old radio checked) |
| P3 | Confirm on raise, decided on a fresh read, with every crossed gate | Show only the target's gate; confirm on a lowering; decide from the stale view | settings-screen, `crossedGates` unit |
| P4 | Settle wins over a stale poll | Drop the generation bump in `settle` | use-stall-watch-view |
| P5 | The run-less footnote is always shown | Hide it when counts are zero | settings-screen |
| P6 | No "phone" wording, no device branch, in the new section | Add a `matchMedia` branch or the word | a source scan of `StallWatchSection.tsx` and the L0 `STALL_*` strings only (the Notifications section's existing labels are out of scope) |
| P7 | Only 501 `not-configured` and 404 `not-found` read not-configured | Map every 404, or every 501 | use-stall-watch-view |

## 18. Waves (a new programme, `stall-watch-settings`)

The ledger lives at `docs/superpowers/programs/stall-watch-settings.md`. D-numbers are allocated by the coordinator
from `POST /api/ledger/deviations` when the plan is written.

- **W1: server (deploy class: server).**
  - The migration, at the measured next slot, with the index.
  - Store methods: `stallSettings`, `setStallSettings`, `stallObservationsSince`.
  - L1 `server/src/coord/stallsettings.ts`: `STALL_LADDER`, `stallBoxArmingOf`, `isStallQuietMs`,
    `parseStallSettings`, `resolveStallWatch`, `stallLevelOf`, `stallJudgedMailMode`, `decideStallSettings`,
    `stallNoticeCounts`, the bounds, step and window constants, and `isStallSettingsKebab`.
  - `stall.ts`: `StallInput.quietMs`, `stallQuietMs`, the three use sites, `STALL_BACKOFF_CEILING_MS` in
    `stallBackoff`, and the comment rewording (§7).
  - `watch.ts`: both sweeps, `mailModeApplied`, `stallSettingsNow` (never throws) with its warn latch and boot
    trace, `quietMs` threaded into `judgeStall`, and the `STALL_SWEEP_MS` comment.
  - The routes in `coord/routes.ts`, with the docstring arguing gating.
  - L0 wire types and texts.
  - The census edits: `SESSION_ONLY` and its docstring, `auth-gate.test.ts`'s counts, `coordinator-skill.test.ts`'s
    `EXEMPT` and forbid-mention case, and the `CLAUDE.md` box-token and mail-gate sentences.
  - The kebab union.
  - **README:**
    - The stall-watch paragraph: "for the quiet time (2 h unless Settings sets another, 30 min to 12 h)"
      wherever it says 2 h for r1, the dialog cap or the backoff base, and that a level chosen through
      `/api/coord/stall-watch` overrides the arming markers but never `stall-watch-disabled`, `mail-disabled` or
      `mail-gate-strict`.
    - The mail-gate paragraph: one sentence on the same override.
  - The stall-watch spec's one-line status pointer.

  **It deploys first and changes nothing** until a level or a quiet time is written, because the seed is `follow`
  plus the built-in. The door is reachable with `curl` behind the session gate before W2 lands.
- **W2: the PWA section (deploy class: server, which serves the PWA).**
  - `useStallWatchView`, the API methods, `StallWatchSection.tsx`, the confirm, and the header and "ONE poll"
    comment amendments in `SettingsScreen.tsx`.
  - **README:** the Settings paragraph (≈:936) gains "Settings has a third section, **Stall watch**: …".
  - W2 depends on W1 being merged. It needs no fleet-box deploy.

## 19. Defaults taken for the operator's review

The drafting review left five questions. Each one carries a default that the coordinator took, so that one review
of this document settles all five. To change any of them, say so in the review.

1. **Reading a level from the files when the busy-gate log does not match.** Default:
   `files-level-match-ignores-the-busy-log`. A box with no files reads "Log only (busy-gate log off)", not "custom",
   so a fresh install shows a ladder step.
2. **What `off` does to the mail gate.** Default: as approved. `off` stops the stall lane and leaves the mail gate as
   the box files set it. `off-sets-the-shell-gate` is not taken.
3. **Choosing "Follow the box files" when the files rank above the effective level.** Default: it asks for a
   confirm, as raising the level does, since it can arm more.
4. **A write that changes nothing.** Default: no feed event and no change; the reply re-reads the stored values.
5. **Who coordinates.** The coordinator of the completed stall-watch programme (`ccrc-pwa-calm-harbor`) coordinates
   this one too. Its ledger is `docs/superpowers/programs/stall-watch-settings.md` (§18), opened at its first
   run.
