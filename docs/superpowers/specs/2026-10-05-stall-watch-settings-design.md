# Stall watch settings: one arming ladder and one quiet time on the Settings page (design)

**Status:** draft rev 3.2, 2026-10-05; rev 3.2 applies the final narrow re-check (7 important findings, workflow
wf_be296fb4-28c); rev 3.1 folds the verification of rev 3 (28 findings, workflow wf_6b6351ad-f06); rev 3 folds the
adversarial review (44 findings, workflow wf_02c96a48-da4); awaiting the operator's review. Rev 2 folded three review
lenses (codebase fit, operator intent, safety). The shape was approved in dialogue (§2): one ladder, one
timing, a small read-only part, and approach 1 (server-side storage). Nothing in this spec is planned yet. No D-number
has been allocated. Each departure from the approved text is named by its slug (§16) and gets a number when the plan is
written. The defaults the operator may still change are listed in §19.
- **Citations.** Mapped read-only at origin/main be93d159e, which carries stall-watch waves 1–7. Rev 3.1's new and
  changed citations are measured at origin/main beafb3fd8. Between the two only README, two `ccd` scripts,
  `coord/token.ts`, two doctor and install tests, and docs changed, so the older hints still land. Line numbers are
  hints and are written `≈`. Every citation also names its function or constant, so the text can still be found
  after `main` moves. Ledger entry R38 is quoted from the coordinator's ledger branch (`d956bfd1d`, stall-watch.md
  ≈:643–676); R18 (≈:262–268), R28 (≈:434–450) and the arming track (≈:30–38) are on `main`. Rev 3.2 re-reads
  `stallMailDisabledHold` (`stall.ts` ≈:813) and `mailTurnModeOf` (`turnidle.ts` ≈:78) at origin/main 77f8d63a5, where
  both hints still land.
- **Inputs.** Three read-only surveys from 2026-10-04 (stall constants, configuration precedents, the Settings
  screen), re-checked against `origin/main` after waves 6 and 7 merged; the stall-watch design spec; the stall-watch
  programme ledger's arming track (R18, R19, R26, R28, R38); the adversarial review of rev 2 and the verification of
  rev 3, each with the coordinator's rulings on it.

**Date:** 2026-10-05 · **Branch:** chosen by the coordinator (from `origin/main`, measured at execution)
**Related:**
- `2026-09-29-worker-stall-watch-design.md`. This spec amends three passages in it:
  - §10's "the PWA renders none" (≈:839). Settings now renders the effective quiet time.
  - §4.2's "every marker is touched and removed by hand" (≈:474). That stays true, because no marker gains a
    writer. A level chosen in Settings can now override the arming markers.
  - §10's kill rules (≈:874–876, "`rm stall-watch-live`", "`rm stall-watch-escalate`"). Each acts only while Settings
    follows the fleet box's files, and W1 qualifies it to say so (§18).

  The W1 PR adds one line to that spec's status block pointing here.
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
- **2026-10-05.** No device distinction: "same functionality identical across anywhere the PWA is installed". No
  string in the new section or its controls names a device. It is Settings, in the PWA.
- **2026-10-05, approved in the brainstorm:**
  1. **One arming ladder**, default "Follow the box files", which is today's behaviour. There are six levels, and
     each includes the ones below it (§5). Precedence: a kill file on the fleet box beats everything;
     `mail-gate-strict` keeps its precedence for the mail gate; otherwise a chosen level decides; otherwise the box
     files decide, as today. A box-file combination that matches no step reads "custom (box files)". An unreadable
     registry reads "unknown", never "off".
     - *Restatement note:* under departure `files-level-match-ignores-the-busy-gate` (§6.4, Q1), a box with no files
       at all reads "Log only", with the busy gate off, rather than "custom". That narrows the approved "matches no
       step reads custom" for that one case.
     - *Restatement note:* the user-facing strings use one term for the box files, "the fleet box's files", so the
       default reads "Follow the fleet box's files" and a no-match reads "Custom" beside that source (§5, §12).
  2. **Guide, don't block.** Any level may be chosen. The section shows what the current level does, the next step,
     and that step's gate. Raising the level asks for a confirm that shows the gate text. The server does not
     track whether a gate is met; it cannot know.
     - *Restatement note:* under departures `confirm-on-stage-diff` and `server-decides-the-confirm` (§10, §13),
       "raising" is measured by what a write turns on, not by rank, and the server measures it at the write. Each gate
       belongs to the stage it guards (§5.1).
  3. **One timing:** the quiet time before a worker check, adjustable from 30 min to 12 h, defaulting to the
     built-in value. All other timings stay fixed in code. There is no install-time configuration.
  4. **A small read-only part:**
     - the current level, what it does, and where it comes from;
     - the next step and its gate;
     - the quiet time, with its range and where it comes from;
     - 48 h notice counts per rung, sent versus shadow, from run-bound observation rows. Run-less notices are not
       counted, and the section says so.
     - *Restatement note:* under departure `counts-by-role` (§11), the counts are four rows by role, because the
       observation row does not record who a notice actually reached.
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
2. The operator can choose a ladder level, or "Follow the fleet box's files", and a quiet time, in Settings. The
   choice lives on the server, in one row of its coordination database (§8), and applies to the whole fleet. The
   browser keeps no copy: wherever the PWA is open, it reads that one row, and after a change the control shows what
   the server stored, not what was tapped.
3. A stall sweep and a mail sweep given the same registry listing and the same stored row resolve the same arming,
   because both call one never-throwing helper over one pure function. When the mail gate moves into busy delivery
   while the server runs, whether by a chosen level, by Follow or by a file touched by hand, the stall sweep's
   stuck-mail clock starts no earlier than the moment the mail gate first applied it (§9).
4. W1 changes nothing until a level or a quiet time is written (the migration's seed is today's behaviour), or until
   the mail gate moves into busy delivery while the server runs. That last case gets the busy clock's grace (§9),
   which fixes today's false stuck-mail window on a raise made by hand. At boot, with the fleet box's files on busy
   delivery, the verdicts receive today's exact arming (M4). So W1 can deploy first.

## 4. Non-goals

- **Per-stage controls.** There is one ladder and no toggle per marker or per stage. A combination the ladder does
  not name stays reachable by hand with the fleet box's files, and reads "Custom".
- **Any other timing.** `STALL_ESCALATE_MS`, `STALL_OPERATOR_MS`, `STALL_BOUND_MS` (r1 + 3 h), the limit cap
  (`LIMIT_HOLD_CAP_MS`, `stall.ts` ≈:308), the coordinator-ball cap (`COORD_BALL_CAP_MS`, ≈:312) and every wave-2
  constant stay `export const` literals. The dialog cap is not one of them: it reuses the quiet time (§7).
  `stall-verdict.test.ts`'s "the wave-1 constants carry the spec values" (≈:96–103) and `stall-vocabulary.test.ts`'s
  wave-2 row stay as they are. So do the mail gate's own floors, `MAIL_QUIET_MS` (60 s) and `COORD_QUIET_MS` (15 s),
  which are not the stall quiet time.
- **Install-time configuration.** No `CCRC_STALL_*` key, and nothing in `deploy/ccrc.env.example` or `loadConfig`.
- **Writing marker files.** The server never creates or removes a registry file. The no-writer pins stay unedited
  and stay green. `agent/src/whitelist.ts` keeps its write scope (`~/.cc-clips` only).
- **A new ccd verb, or any agent change.** `EXEC_COMMANDS` stays `['tmux','ccd']`.
- **Enforcing gates, or tracking whether a gate is met.** Any level can be chosen at any time. Gate texts are
  static, timeless guidance: each is a condition of evidence, with no date, no wave number, no "now" and no fleet
  history. Dated evidence stays in the programme ledger, so a gate closing needs no L0 edit and no release.
- **Counting run-less notices.** Sent or shadow, they leave no observation row (§11). This spec adds no durable
  record for them, and the section cannot measure R19's run-less push count.
- **A WebSocket frame.** The section polls. `CoordStatus` and `FLEET_PROTO` are unchanged.
- **Device-specific behaviour.** There is no viewport, pointer or user-agent branch, and no device word in the new
  section or its controls. One label outside the section follows the same directive: W2 renames the Notifications
  section's push row to "Push notifications for this browser" (§13, departure `notifications-label-says-push`, Q10).
  The rest of that section is untouched.
- **Not offered:** applying a new quiet time only to episodes opened after the change; a daily split of the counts;
  refusing a write while the registry cannot be listed (the choice is stored, and applies once the registry reads).

## 5. The ladder

Six levels plus the default choice "Follow the fleet box's files" (id `follow`). Each level includes the ones below
it in what it sends. It is not cumulative in timing: leaving Everything brings back the plain quiet clock, so some
notices fall due sooner (§5.1's `wave2` row, §15). Level ids are single lowercase words, so the `server/src/coord`
kebab-code scan in `mail-routes.test.ts` (≈:734) never sees them (§14 item 13).

The arming flags are `StallArming`'s fields (`stall.ts` ≈:126). The mail gate mode is `turnidle.ts`'s
`MailTurnMode` (≈:61); "box" means the mode the fleet box's files give. "What it does" is the level's L0 `does`
text, quoted as shipped. "Stage it turns on" names the §5.1 stage the step adds, and that stage's gate is what the
step waits on.

| # | id | Label | `disabled` | `live` | `escalate` | `w2Live` | mail gate mode | What it does (`does`) | Stage it turns on |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `off` | Off | true | — | — | — | box | "The stall watch does not run: nothing is checked, recorded or sent. The mail gate stays as the fleet box's files set it. For a stop that survives a rollback or a lost setting, use the fleet box's kill switch (README: Fleet coordination, The stall watch)." | none (the bottom step) |
| 1 | `log` | Log only | false | false | false | false | `busy-shadow` | "Every notice the watch would send is recorded, and nothing is sent." | the busy gate, where the fleet box's files leave it off |
| 2 | `check` | Check silent workers | false | true | false | false | `busy-shadow` | "Adds a check mail to a worker that has been quiet past the quiet time. No one else is told." | checks |
| 3 | `alert` | Alert coordinator and you | false | true | true | false | `busy-shadow` | "Adds a report to the worker's coordinator after an unanswered check, then a push to you, and pushes to you about a long usage limit, a dialog left open, and a coordinator that has held a run too long. Pushes arrive wherever push notifications are switched on in Settings." | alerts |
| 4 | `deliver` | Deliver mail to busy sessions | false | true | true | false | `busy` | "Adds delivery to a busy session whose main turn has ended, so mail stops waiting for that session's background work." | busy delivery (the busy gate stays on: §5.1) |
| 5 | `all` | Everything | false | true | true | true | `busy` | "Adds the further checks: a worker that died, froze or failed, lost background work, a coordinator not reading its mail, mail stuck in the queue, and a turn record that cannot be read. A worker's quiet time then follows its turn record, backs off for a worker that keeps answering 'working', and holds while its subagents run." | the further checks |

No `does` text carries a duration, a rung code, a wave number or a date. The durations it would name
(`STALL_ESCALATE_MS`, `STALL_OPERATOR_MS`, ≈:304 and ≈:306) stay in code alone, so a later change to them leaves no
stale sentence. The busy gate's clause is not in any `does` text: the Now block renders it from `stages.busyGate`
(§5.1, §13).

### 5.1 Stages and their gates

A stage is one thing the watch or the mail gate does that the operator is told about before it starts. Each is a
boolean the server derives from a resolved arming (`stallStages`, L1, §12), so the section never reads a flag or a
mail mode. A gate belongs to the stage it guards, not to a level. The Next step line and the confirm (§13) show the
gates of the stages a write turns on, and the server works out which those are (§10). All three text columns are L0
(`STALL_STAGE_TEXT`).

| stage (wire key) | on when (`stallStages`) | name | stops | gate |
|---|---|---|---|---|
| `checks` | runs and `live` | "Checks on quiet workers" | "Checks on quiet workers stop." | "A review of the notices recorded in shadow finds the would-be checks true or harmless." |
| `alerts` | runs, `live` and `escalate` | "Reports to coordinators and pushes to you" | "Reports to coordinators and pushes to you stop." | "Checks have run live for a while, and the reports and pushes recorded in shadow look right. A known limit: a dialog left open can be pushed to you again, at most once each quiet time." |
| `busyDelivery` | mode `busy`, and mail not switched off | "Busy delivery" | "Busy delivery stops." | "The busy-gate log has been reviewed (it is in the server log, not on this page), and a pane still showing a running turn has been seen to refuse the delivery." |
| `busyGate` | the gate reads the turn marker: mode `busy` or `busy-shadow` (`mailTurnReadsMark`, `turnidle.ts` ≈:89), and mail not switched off | "The busy gate" | "The busy gate stops." | none (`null`): it adds no delivery, so nothing waits on it |
| `wave2` | runs and `w2Live` | "The further checks" | "The further checks stop, and a worker's quiet time goes back to the plain clock: no back-off, and no hold while its subagents run or just after a restart. Some checks, and while reports to coordinators are on some reports, can fall due at the next sweep." | "Busy delivery is on and its log has been reviewed (in the server log, not on this page); the stuck-mail and coordinator-not-reading checks have been re-measured in shadow; and repeated pushes about sessions on no run have been counted while alerts were on. This step also moves each worker's quiet time onto its turn record, which shadow never measured." |

- **`runs`** (`!disabled`) is on the wire too, for the Now block. It is not a confirm stage: starting the watch in
  shadow sends nothing.
- **Mail switched off.** While `mail-disabled` stands, `sweepMail` returns before it reads any mode (`watch.ts`
  ≈:4541), so neither mail-gate stage is in force and both read false in the Now block. A confirm, the Next step and
  the files-exceed line read the stages with mail switched off read as on, because a stored choice arms them for the
  moment mail returns (§10). A confirm also reads them with the fleet box's kill switch and strict gate removed, for
  the same reason (§10's unheld reading).
- **Which stages send.** `checks`, `alerts`, `busyDelivery` and `wave2` send something or deliver mail. `busyGate`
  sends nothing; it only holds mail longer. So the files-exceed line compares the four sending stages only (§10).
  A confirm still opens when the busy gate turns on, because it changes what the mail gate delivers.
- **The busy gate, as measured.** It is the turn-marker read that `busy` and `busy-shadow` share: both refuse a
  `shell` session whose current turn marker reads `working` (`mailTurnIdle`, `turnidle.ts` ≈:121), which the
  default `shell` mode delivers, and both add one marker read per due row (`watch.ts` ≈:4970). So busy delivery
  includes the busy gate, and moving between Deliver and a lower level turns no busy gate on or off. Its Now
  sentence is two L0 texts, `STALL_BUSY_GATE_TEXT`: `holds`, "The mail gate also holds mail for a session whose
  main turn is running.", always; and `logs`, "It also logs what busy delivery would do.", only under `busy-shadow`,
  which the section reads as `busyGate` on and `busyDelivery` off. That mode logs only the busy rows it would deliver
  (`turnidle.ts` ≈:134, `watch.ts` ≈:4999), never a held `shell` row. Log only, Check and Alert keep `busy-shadow`,
  as the approved table has it. On a box whose files leave the gate off, choosing one of them turns a stage on and
  so opens the confirm (§13). Operator default, §19 Q6.
- **The leave-Everything line.** `wave2`'s `stops` text is the line the confirm shows on leaving Everything. Without
  `w2Live`, the restart-grace hold (`stall.ts` ≈:1044) and the delegates hold (≈:1057) lapse, and the worker's ball
  falls back to wave 1's ladder (≈:1071): r1 at the plain quiet time (`stallWaveOneLadder`, ≈:918) rather than the
  backed-off one (≈:1076), and r2 an hour after r1 (≈:922) rather than on proof or the bound (`stallProofDue`,
  ≈:930). Both ladders share the episode key, so rows already recorded carry across.

**The order.** The ladder puts Alert below Deliver. That reverses R18's steps 4 and 5: R18 arms `mail-gate-busy` at
its step 4, then `stall-watch-escalate` and `stall-watch-w2-live` at its step 5 (stall-watch.md ≈:262–268). The
ladder follows R38, which supersedes R18's order. R38's arming, quoted exactly (≈:655–659):

> `stall-watch-escalate` waits on waves 6 and 7 being deployed and seen live in shadow. `stall-watch-w2-live` waits
> on the busy-shadow log review, a shadow re-measure of coord-deaf's new clocks and of mail-stuck's busy hold, and
> R19's run-less push count. `mail-gate-busy` waits on the busy-shadow evidence.

Escalation's gate is evidence about the stall lane alone, and the arming track lets escalation run while busy
delivery is off ("only while w2-live is off or `mail-gate-busy` is armed", ≈:35). Busy delivery waits on a log
review, and the wave-2 step waits on both. So escalation comes first and the wave-2 step last. The arming track's
rule holds on every ladder row in either order, so it is not the reason for this one. The one resolved arming that
could break it, a chosen `all` under `mail-gate-strict`, is held by `strict-holds-the-wave-2-step` (§6.2).

The cost, stated plainly: busy delivery without escalation is reachable only through the fleet box's files, and
reads "Custom". A box armed by hand in R18's order (busy delivery on, escalation off) that then has a level below
Deliver chosen loses busy delivery, and the confirm says "Busy delivery stops." (§13). No operator decision is
needed: R38 is the operator's current plan.

**Where the text lives.**
- The labels and `does` texts are defined **once**, in L0 `shared/api.ts`, as one total
  `Record<StallLevel, {label, does}>` (`STALL_LEVEL_TEXT`). `STALL_LEVELS` is derived from it with `Object.keys`, in
  ladder order, and a test pins that order. The stage names, `stops` texts and gates are one total
  `Record<StallStage, {name: string; stops: string; gate: string | null}>` (`STALL_STAGE_TEXT`). `gate` is `null`
  for the busy gate alone, which nothing waits on, and that `null` has that one meaning. Every other section string
  is an L0 constant too, each named in §12, and the whole block is appended at the end of `shared/api.ts` (§12).
- The flag and mode columns are defined once, in L1 `server/src/coord/stallsettings.ts` (new), as
  `STALL_LADDER: Record<StallLevel, StallLadderRow>`, where `StallLadderRow` is a discriminated union:
  `{ disabled: true } | { disabled: false; live: boolean; escalate: boolean; w2Live: boolean; mailMode: 'busy-shadow' | 'busy' }`.
  The `off` row is `{ disabled: true }` and carries no flags and no mode; the resolver reads it as "stop the lane,
  leave the box's mode" (§6.2). Step matching in `stallLevelOf` runs over the levels other than `off` (§6.4).
  Narrowing the key does not narrow the value, so every reader narrows the row on `row.disabled` before it reads a
  flag or the mode (§6.2's `run`).
- A level added to one record and not the other is a compile error.
- **No text spells a marker name.** Every string in `shared/api.ts`, `pwa/src` and the new server file is a code
  line, and the no-writer pin's TS half allows exactly one code-line spelling per marker, in its definer
  (`single-definition.test.ts` ≈:4081, ≈:4211). The texts say "the further checks", "busy delivery", "the busy gate"
  and "the fleet box's kill switch", never the file names. They use no rung code (r1, r2, r3), no wave number and
  no internal arm name, and one term for the box files: "the fleet box's files".

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
2. **The parsed settings:** `parseStallSettings(read)` over the store's read (§8). Each field is parsed on its own,
   so the wire can report each field's own state:
   - level: `{kind:'follow'} | {kind:'chosen', level} | {kind:'unreadable', token}`;
   - quiet time: `{kind:'default'} | {kind:'set', ms} | {kind:'unreadable', value}`;
   - `updatedAt`: a number, or `null` when the stored value is not a safe integer;
   - row: `stored: 'row' | 'absent' | 'unreadable'`. When `stored` is not `'row'`, level and quiet time both parse
     `unreadable` and `updatedAt` parses `null`; `stored` tells the two cases apart (§12).

   "Absent" and "unreadable" stay apart all the way to the wire. Neither folds into `follow` or `default`. The
   resolver applies the row whole (§6.2): if the row is absent or unreadable, or either field is unreadable, neither
   stored choice applies.

**One validity predicate.** `isStallQuietMs(v)` in `stallsettings.ts`: `typeof v === 'number'`,
`Number.isSafeInteger(v)`, `v % STALL_QUIET_STEP_MS === 0`, and `STALL_QUIET_MIN_MS <= v <= STALL_QUIET_MAX_MS`.
Both `decideStallSettings` (the write) and `parseStallSettings` (the read) call it, so the read never accepts a value
the write would refuse (a hand-edited `1800000.5`, a TEXT value in the untyped column, a value from a build with
other bounds).
- **Integers from the store.** The read runs with `setReadBigInts(true)` (§8), so an INTEGER column arrives as a
  `bigint`. The parse converts a `bigint` inside the safe-integer range with `Number` before it calls the predicate,
  and reads any other `bigint` as unreadable. `updatedAt` goes through the same conversion, and anything that is not
  then a safe integer parses `null`. A REAL value such as `1800000.5` arrives as a `number` and fails the predicate.

**One level guard.** `isStallLevelChoice(v)` (L0, §12) has a pinned body:
`typeof v === 'string' && (v === 'follow' || (STALL_LEVELS as readonly string[]).includes(v))`. It never uses `in`
or `MAP[v]`, because `'toString' in` any object literal is true; `shared/api.ts`'s `isReclaimRefuseCode` (≈:5657)
records the same trap. Both `decideStallSettings` and `parseStallSettings` call it, and `STALL_LADDER` is indexed
only after it has answered true, so `constructor`, `toString`, `__proto__` and `hasOwnProperty` are refused on the
write and read `unreadable` on the read (M11b).

### 6.2 The resolver

`resolveStallWatch(box: StallArming, settings): StallResolved`, in `stallsettings.ts`. It is L1: pure, no clock, no
I/O, no `node:` import, no `db.js`. It works on flags only.

```
applies     = settings.stored === 'row' && settings.level.kind !== 'unreadable' && settings.quiet.kind !== 'unreadable'
quietMs     = applies && settings.quiet.kind === 'set' ? settings.quiet.ms : STALL_QUIET_MS
quietSource = applies && settings.quiet.kind === 'set' ? 'chosen' : 'default'
chosen      = applies && settings.level.kind === 'chosen' ? settings.level.level : null
strict      = box.mailMode === 'strict'
row         = chosen === null ? null : STALL_LADDER[chosen]   // indexed only after isStallLevelChoice answered true
run         = row !== null && row.disabled === false ? row : null   // narrows the union: a running level's row
if chosen === null:                                    // follow, or a row that does not apply whole
  arming = box                                         // the SAME object: today's behaviour exactly
else if box.disabled:                                  // the lane's kill file restores today's behaviour wholesale
  arming = box                                         // mail mode included
else if run === null:                                  // a chosen 'off'
  arming = { ...box, disabled: true }                  // the lane stops; the mail gate keeps the box's mode
else:
  arming = { disabled: false,
             live: run.live, escalate: run.escalate,
             w2Live: run.w2Live && !strict,            // strict switched busy delivery off; the wave-2 step needs it
             mailDisabled: box.mailDisabled,           // the mail kill file is never overridden
             mailMode: strict ? 'strict' : run.mailMode }   // strict keeps its precedence
free        = run === null ? null                      // what a running choice does with no held flag on the box
            : { disabled: false, live: run.live, escalate: run.escalate, w2Live: run.w2Live, mailMode: run.mailMode }
effective   = stallLevelOf(arming)                     // what the watch is actually doing
files       = stallLevelOf(box)                        // what the fleet box's files alone say
heldBack    = free !== null && !sameStages(armedStages(arming), armedStages(free))   // a held flag changed it
levelSource = chosen === null ? 'files' : heldBack ? 'held' : 'chosen'
held        = { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: strict,
                wave2HeldByStrict: run !== null && run.w2Live && strict }
```

`armedStages(a)` is `stallStages({ ...a, mailDisabled: false })`: the stages with mail switched off read as on (§5.1).
`sameStages` compares the five confirm stages and `runs`.

`StallResolved` is `{ arming, quietMs, quietSource, chosen, levelSource, effective, files, held }`, and its `arming`
always carries a `mailMode` (`stallBoxArmingOf` sets one, and every branch keeps or sets it). The `held` words are
camelCase booleans, never file names.

- **Whole-row fallback.** `applies` is false when the row is absent or unreadable, or when either field is
  unreadable. Then neither stored choice applies: the fleet box's files and the built-in quiet time, as today. A
  readable level never runs beside an unreadable quiet time, and a readable quiet time never runs beside an
  unreadable level. The wire still reports each field's own state (§12). Operator default, §19 Q11.
- **`levelSource`** has three values:
  - `files`: nothing applies from the row;
  - `chosen`: the chosen level decides;
  - `held`: a level is chosen, and the lane's kill file or the strict mail gate on the fleet box actually changed
    what it does. The test is causal: the chosen row's stages with no held flag (`free`) are compared with the
    resolved stages, both with mail switched off read as on, and `held` is set only when they differ. A flag that
    merely stands beside the choice sets nothing.
  - A chosen `off` is never `held`. Off leaves the mail gate as the fleet box's files set it, strict included, and
    the kill file only does what Off does. So a chosen `off` under the kill file reads `off` and stays `chosen`, and
    a chosen `off` over a box busy file reads `custom` and stays `chosen`, with or without the kill file (§13 shows
    its stages).
  - Any other chosen level under strict reads `held`, because strict at least holds the busy gate off that the
    level's own row turns on. A chosen `check` under strict keeps the reading `check`, with the source `held`.

### 6.3 Precedence, stated once

1. **`stall-watch-disabled` on the box beats everything.** The resolver returns the box arming unchanged, mail mode
   included, whatever level is chosen, and `levelSource` reads `held` when that changes what the chosen level does.
   The lane returns (`if (arming.disabled) return`, `watch.ts` ≈:3789), and the mail gate runs exactly as the box
   files set it, as today.
2. **`mail-disabled` on the box beats everything.**
   - `sweepMail` returns before any mode is read (≈:4541, unchanged).
   - The lane holds every rung that would send mail (`stallMailDisabledHold`, `stall.ts` ≈:813). Operator pushes
     still pass through it, so the held line says so (§13).
   - Neither mail-gate stage reads true while it stands (§5.1).
3. **`mail-gate-strict` on the box keeps its mail-gate precedence:** strict > busy > busy-shadow > shell. With a
   level chosen, strict still wins the mail gate, and it also holds the wave-2 step off, because that step needs
   busy delivery (`strict-holds-the-wave-2-step`). The chosen level still decides `live` and `escalate`. Any chosen
   level other than Off then reads `held` (§6.2), and a chosen `deliver` or `all` also reads as Alert.
4. **Otherwise a chosen level decides every other flag and the mail mode.** That includes turning off a busy mode the
   files set: a chosen `check` with `mail-gate-busy` on the box gives `busy-shadow`. A chosen `off` stops the lane
   and leaves the mail gate on the box's mode.
5. **Otherwise the box files decide, as today.** That covers `follow`, and a stored row that does not apply whole
   (§6.2).

`coordinator-paused` and `reclaim-paused` are not arming switches, and the resolver never reads them.

### 6.4 Reading a level back: `stallLevelOf(arming)`

- `disabled` and a mail mode other than `busy` gives `off`. `disabled` with mail mode `busy` gives `custom`, because
  the watch is off while busy delivery is on, and `off` must not stand for both.
- Otherwise it returns the one step, among the levels other than `off`, whose `live`, `escalate` and
  `w2Live === true` equal the arming's, and whose "delivers on busy" (mode `busy`) equals the arming's. The `off` row
  carries no flags (§5), so it can never match a running arming.
- Otherwise it returns `custom`.

Modes `shell`, `busy-shadow` and `strict` all count as "does not deliver on busy" for this match, so the busy gate
alone never splits a level. Departure `files-level-match-ignores-the-busy-gate`, §19 Q1. The reply carries the busy
gate separately (`stages.busyGate`, §12), and the Now block says when a level read from the fleet box's files runs
without it, for example a fresh install with no files at all (§13).

The consequences, stated once:
- A box with no files reads `log` from files, with the busy gate off.
- The operator's fleet today (`stall-watch-live` plus `mail-gate-busy-shadow`) reads `check` exactly.
- `escalate` without `live`, or `w2-live` without `escalate`, reads `custom`.
- A chosen level under `mail-gate-strict` reads as the level that gate leaves standing, with `levelSource` `held`.
  A chosen `deliver` or `all` under strict reads `alert`, with `held.gateStrict`, and `held.wave2HeldByStrict` for
  `all`.
- A chosen `off`, or the lane's kill file, with `mail-gate-busy` on the box reads `custom`.

**The hazard line.** Whatever the source, when the effective stages read `alerts` on, `wave2` on and `busyDelivery`
off (reachable only through the fleet box's files set by hand), the Now block shows one warning line, L0
`STALL_HAZARD_TEXT`: "Alerts and the further checks are on while busy delivery is off: the stuck-mail and
coordinator-not-reading pushes will mistake a busy session for a deaf one." It is not shown while `held.mailOff`
stands: no mail is delivered then, so busy delivery reads off for that reason and the mechanism it warns of is not
running. Guide, don't block.

### 6.5 "Unknown"

An unlistable registry (`io.readdir` answers `null`) is never resolved and never reads `off`:
- **The sweeps** already fail shut before they would resolve anything. `tick()` returns on `!registryRead.listed`
  before `sweepStalls` (`watch.ts` ≈:1616–1625, the fail-shut return on `RegistryRead`), and `sweepMail` returns on
  `listing === null` (≈:4541).
- **The GET route** answers `effective: { measured: false }`, which the PWA renders "Unknown — the fleet registry
  could not be read". It carries no Next step and no files-exceed reading.
- **The POST** cannot work out what a write turns on, so it answers the unmeasured effect, `{ measured: false }`,
  and every write needs the confirm (§10). Its sheet holds one line, "The fleet box's files could not be read, so
  what this choice turns on cannot be shown." (§13). The Follow option reads "Follow the fleet box's files (they
  say: unknown)".

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
  - `watch.ts` always passes the resolved value when it builds the input (`judgeStall`'s `let input: StallInput`
    literal, ≈:3877). That literal is the only production `StallInput`. Because the field is optional, a literal that
    left it out would still type-check and would silently read 2 h, while the section showed the chosen value. So a
    stall-sweep row pins the threading end to end (M9c, §17).
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
  - A stored value that fails `isStallQuietMs` reads `unreadable`, never clamped. The row then does not apply
    whole: neither stored choice applies (§6.2).
  - The floor stays the approved 30 min. A write that brings in a value below the current one, or below the
    built-in, opens the confirm (§10, §13). Operator default, §19 Q7.
- **What a change does,** from the next stall sweep (`STALL_SWEEP_MS`, 60 s):
  - **Lowering** makes every worker already quiet past the new value due at once, so the next sweep can send a
    burst of r1 checks. At `alert` and above it also makes a dialog-cap push to you due for every standing dialog
    older than the new value (≈:1038). Both are accepted, disclosed in the confirm, and documented (§13, §15).
  - **The steady state below Everything.** Without `w2Live` the worker's ball runs on wave 1's ladder
    (`stall.ts` ≈:1071), which has no backoff (`stallBackoff` is reached only from the marker ladder at ≈:1076) and
    no delegates hold (≈:1057). Each `re stall-check: working` reply is worker mail and opens a new episode
    (`stallFacts` ≈:657–675). So a worker in a long legitimate wait is checked once per quiet time: at 30 min, about
    48 checks a day for one worker, against 12 at the built-in 2 h, each costing a worker turn and a coordinator
    turn. The confirm says so (§13), and the remedy is to set the quiet time back to the built-in (§15).
  - **Raising** defers every r1 that has not been sent, and the dialog cap moves with it. Under w2-live the
    working-reply backoff runs quiet time, twice it, four times it, never past the 16 h ceiling.
  - **What stays fixed.** r2, r3, `STALL_BOUND_MS` (r1 + 3 h), the limit cap (`LIMIT_HOLD_CAP_MS`, 12.5 h, ≈:308)
    and the coordinator-ball cap (`COORD_BALL_CAP_MS`, 30 h, ≈:312) keep their fixed values. Raising the quiet time
    cannot invert r1 and the bound, because the bound is measured from r1's own time (`stallProofDue` ≈:932).
  - **What moves with it besides r1: the dialog cap and its repeat pushes.** The dialog cap fires on
    `capQuiet >= STALL_QUIET_MS` (≈:1038). Its clock starts from the live stamp (`capQuietSince`, ≈:716), and
    `stallDialogCapDone` counts only rows written since that stamp (≈:772). So a plumbing restamp of a standing
    dialog re-arms the cap, and it pushes again one quiet time later. R28 accepted this residue at "at most once per
    restamp, 2 h apart" (stall-watch.md ≈:445–446). The 2 h is the quiet time, so a chosen 30 min spaces repeat pushes
    30 min apart. The note and the alerts gate disclose it. Operator default, §19 Q8.
- **The note under the control.** One static line, L0 `STALL_QUIET_NOTE`, with no number and no level label in it:
  "This also sets when a dialog left open is pushed to you, how far apart repeat pushes about one open dialog can be,
  and, while the further checks are on, the base of the back-off for a worker that keeps answering 'working'. While
  they are off there is no back-off and no hold while subagents run, so a worker that keeps waiting is checked once
  every quiet time."

## 8. Storage and migration

**Table** (one migration, which also adds one index):

```sql
CREATE TABLE stall_settings (
  -- writer = setStallSettings, called only by the settings POST (pinned, §14 item 18); reader = stallSettings
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  level     TEXT NOT NULL,      -- 'follow' or a StallLevel id; read through isStallLevelChoice, never cast
  quietMs   INTEGER,            -- NULL = the built-in STALL_QUIET_MS; read through isStallQuietMs, never cast
  updatedAt INTEGER NOT NULL
);
INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (1, 'follow', NULL, 0);
CREATE INDEX IF NOT EXISTS run_events_by_at ON run_events(at);
```

- **The seed is today's behaviour.** `follow` plus the built-in default, so W1 changes nothing on deploy.
- **The index serves the notice-count read (§11), unconditionally.** `run_events` has only
  `run_events_by_run(runId, at)` (`schema.ts` ≈:108), whose leading column is `runId`, so a window read on `at`
  alone would scan the table. Measured in `node:sqlite` with `main`'s `run_events` columns (`schema.ts` ≈:99–107),
  both indexes and no `ANALYZE`, `EXPLAIN QUERY PLAN SELECT at, detail FROM run_events WHERE at >= ?` answers
  `SEARCH run_events USING INDEX run_events_by_at (at>?)`. With no statistics the planner's choice for a one-sided
  range is fixed, so the index is part of the migration's fixed contents. A pinned `EXPLAIN QUERY PLAN` row in
  `stall-settings-store.test.ts`, in `stall-store.test.ts`'s idiom for the mail indexes, keeps it used. Departure
  `run-events-at-index`.
- **The slot is the next free one, measured, never assumed.** At origin/main be93d159e, `MIGRATIONS` has 16
  entries (the last is `user_version 15 -> 16` at `schema.ts` ≈:1163, child reclamation's `sessionBornAt`), so this
  entry would be `16 -> 17`. Migration slots are a cross-branch namespace; entries 12, 15 and 16 each record a
  branch that moved.
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
    `unreadable`, following the store's all-or-failure idiom (`STALL_READ_FAILURES`' note, `stall.ts` ≈:111). The row
    shape, `StallSettingsRow { level: unknown; quietMs: unknown; updatedAt: unknown }`, is an L2 port declared by the
    consumer in `stallsettings.ts`, as `stall.ts` declares `StallRunRow`; the parse decides what every value means,
    `updatedAt` included (§6.1).
    - **It reads with `setReadBigInts(true)`.** Measured on node v24.14.1 against this DDL: without it, a `quietMs`
      of `9223372036854775807` makes `.get()` throw `ERR_OUT_OF_RANGE` ("Value is too large to be represented as a
      JavaScript number"), so one bad field would cost the whole read and every field's own state. With it, that
      value reads as a `bigint` and only that field parses `unreadable`; a TEXT `updatedAt` of `'abc'` comes back as
      a string and parses `null`. The method itself is available at the repo's floor: `store.ts` calls
      `setReadBigInts(true)` on `insertRun` (≈:1594) and `insertAsk` (≈:6372) under the same `engines` (`>=22.13.0`,
      `server/package.json` ≈:7), which `node-floor.test.ts` pins. That precedent covers availability only: both
      sites read `.run()`'s `lastInsertRowid`, and neither reads a row through `.get()`. The `.get()` behaviour above
      was measured on v24 alone. So W1's store row (M11c) pins it on CI's Node, `ci.yml`'s `node-version: '22'`
      (≈:150), which is at or above the 22.13 floor, and the plan's first step re-measures it on the floor version
      itself if one is available. The per-statement switch converts every INTEGER column of this one three-column
      SELECT, which is what the parse wants here. That is the opposite of the run-row case, where `store.ts` chose
      `CAST(... AS TEXT)` (≈:821) to spare a dozen unrelated columns.
  - `setStallSettings(patch, at, expected): { kind: 'written'; before: StallSettingsRead; after: StallSettingsRead } |
    { kind: 'conflict'; before: StallSettingsRead }`. The patch is
    `{ level?: StallLevelChoice; quiet?: {kind:'default'} | {kind:'set', ms} }`. `expected` is the read the route
    measured its effect on (§10). It runs in one `tx()`: read, compare, then write, then read again.
    - **It writes only over the row the route measured.** When the read inside the transaction differs from
      `expected` (another kind, or, for a row, any of its three stored values, `updatedAt` included, since a hand
      edit need not move `updatedAt`), it writes nothing and answers `conflict` with the read it found. The values
      are compared as read, before any parse, so a `bigint` meets a `bigint`. Inside the server nothing can come
      between the two reads, because the route has no `await` from its read to the write (§10). The check covers a
      writer outside the server, such as a hand edit of `coord.db`, and a read that failed once and then succeeded.
    - **A no-op skips the write.** When a row exists and every named field already equals its stored value (the
      level token, and `quietMs` with SQL `NULL` for `'default'`), no `UPDATE` runs, so `updatedAt` does not move
      and `before` equals `after`. Departure `no-op-write-records-no-feed-event`, Q4.
      - The comparison runs after the same `bigint`-to-`number` conversion the parse uses (§6.1), or in SQL. The
        read returns a stored `quietMs` as a `bigint`, and a plain `===` against the patch's `number` never matches,
        so every same-value quiet write would run the `UPDATE` and move `updatedAt`.
    - **The insert arm** (a lost row) takes its values from the migration's seed (`level 'follow'`, `quietMs NULL`),
      overridden only by the named fields, with `updatedAt = at`.
    - **The update arm** sets only the named fields and `updatedAt`, so a quiet-only write keeps a stored level as it
      is, an unreadable token included. The row then still does not apply whole until a level is written (§6.2).
    - **A read that is itself unreadable takes neither arm.** The store cannot tell an insert from an update then,
      so it throws inside the `tx()`, which rolls back. The route answers Fastify's 500 (§10 step 8), and nothing is
      written. The route also refuses on its own `unreadable` read before it calls the store (§10 step 4), so this
      throw is the second guard, not the only one.
    - It validates nothing; the route has already decided (the `setCaps` division of labour).
    - **The same arms, as a projection.** The route must know what a write will do before it writes (§10), so L1
      `stallSettingsAfter(before, patch)` returns the read the store would leave: for an absent row, the insert arm's
      seed overridden by the named fields; for a row, the named fields over the stored ones, the other field kept as
      it is (an unreadable value stays unreadable); for an unreadable read, the read unchanged, since nothing is
      written. A store row pins that a `written` answer's `after` parses the same as the projection, for each kind
      of `before` (M12d).
  - `stallObservationsSince(since): {ok: true, rows: {at, detail}[]} | {ok: false, detail}` (§11).
- **Fallback when unreadable or absent: the whole row.** If the row is absent or unreadable, or either field is
  unreadable, each sweep acts on today's behaviour whole: the fleet box's files and the built-in quiet time (§6.2,
  Q11). No chosen value applies beside an unreadable one.
  - **A warn latch per read state** (absent, unreadable, level unreadable, quiet time unreadable). It prints
    `console.warn('ccrc-server: stall-watch settings not applied (…) — following the box files and the built-in
    quiet time')` once per latch, and re-arms once a read applies again. So a stuck row does not log every 10 s
    through the mail sweep. The helper's own fallback never goes through the latch: its catch warns on its own (§9).
    The server never uses `req.log` (`Fastify({ logger: false })`).
  - **The reply says so.** It reports `stored: 'absent'` or `'unreadable'`, and each field's own `unreadable`, so
    the section never shows a choice it is not applying (§13's stored-choice lines).
- **A boot trace.** The first successful read after the server starts prints one line when anything is chosen:
  `console.warn('ccrc-server: stall-watch level <label> / quiet time <value> chosen in Settings overrides the box
  files')`. A roll-forward that brings an old choice back, or a restored `coord.db`, then leaves a trace.
- **No journal.** Caps have none either. A lost `coord.db` loses the choice, and the watch falls back to the files.
  `ccrc update` and `ccrc backup` snapshot `coord.db` into `~/ccrc-backups/<ts>/`, which is the recovery (§15).

## 9. Wiring: the stall sweep and the mail gate

Both sweeps call one never-throwing helper, which reads the store once and calls the one resolver over the sweep's
own listing.

**`stallResolveNow(store, names, mailDisabled)`** is one private method on `FleetWatcher`. It computes the whole
resolution: `stallBoxArmingOf(names, mailDisabled)`, then `store.stallSettings()`, `parseStallSettings` and
`resolveStallWatch`, plus the warn latch and boot trace from §8. It returns `{ arming, quietMs, levelSource }`, and
`arming` always carries a `mailMode`.
- **It never throws.** Its whole body is wrapped in a `try/catch`. On any throw (a store bug, a parse bug, a resolver
  bug, a bad driver value, or a fault in the warn latch or the boot trace) it answers today's expression over the
  same listing: `{ ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) }`, with the built-in
  quiet time and `levelSource: 'files'`. That expression is exactly what runs unwrapped today (`watch.ts` ≈:3788,
  ≈:4546), so the fallback adds nothing that could throw where today's code does not.
- **The catch calls nothing that can throw.** It never calls the latch, which may be the fault itself.
  - It composes `reason` inside its own inner `try`, as the thrown message cut to 200 characters, and keeps a fixed
    word when even reading the error throws.
  - It warns with a bare `console.warn('ccrc-server: stall-watch settings not applied (<reason>) — following the box
    files and the built-in quiet time')`, inside its own inner `try`, and only when `lastFallback` was `null`. So a
    standing fault logs once, not every 10 s.
- **It records the fallback.** On a throw it sets `this.lastFallback = { at, reason }`. A resolution that succeeds
  sets it back to `null`.
- **Why it matters.** `sweepMail` runs under `void this.sweepMail().catch(() => {})` (`watch.ts` ≈:1725), which drops
  an error without a log line. A throw on this path would otherwise stop all mail delivery fleet-wide, silently.
- **One reader of the row.** It is the only place either sweep reads the row, so the two cannot read it differently.

**`stallFallback(): { at: number; reason: string } | null`** is a public read of `lastFallback`, and it is the view's
seam. The watcher reaches the coordination routes as `registerCoordRoutes`' optional `watcher?: FleetWatcher`
parameter (`coord/routes.ts` ≈:504, passed from `server.ts` ≈:1648), the same way `POST /api/asks/:id/release` calls
the public `FleetWatcher.releaseHeldAsk` (`routes.ts` ≈:3667, `watch.ts` ≈:6217). `Deps` does not carry the
watcher, and this adds no field to it. With no watcher (a test, or a coord-only server), the view reports only its
own builder's fallback, or `null` (§10). When a fallback is reported, the section says "Your choice is not being
applied (<reason>); the watch is following the fleet box's files and the built-in quiet time." (§13).

**The busy clock** (departure `busy-clock-starts-when-busy-delivery-starts`). Two fields on `FleetWatcher`, one L1
function, one optional arming field, and a bounded change to `stallIdleStart`, which stays pure and spells no marker.
The rule is the same under `follow` and under a chosen level.
- **Two fields, written only by the mail sweep:** `lastApplied: MailTurnMode | null` and `busySince: number | null`,
  both `null` at server start.
  - When the mail sweep applies a mode, it sets `busySince = now` if the mode is `busy` and `lastApplied` is a known
    non-busy mode (neither `null` nor `busy`), and `busySince = null` if the mode is not `busy`. Then it sets
    `lastApplied = mode`. So `busy` over `busy` keeps `busySince`, and the first `busy` after a start leaves it `null`.
  - The null-listing return and the `mail-disabled` return leave both fields unchanged, because neither says
    anything about the mode. In remote mode `readdir` answers `null` on any request error or timeout (`remote/io.ts`
    ≈:104–112), so a passing failure never restarts the clock.
- **One L1 function decides the judged mode and the mail-stuck start:**
  `stallBusyClock(resolvedMode, lastApplied, busySince): { mailMode: MailTurnMode; busySince?: number }`, in
  `stallsettings.ts`.
  - If the resolved mode is `busy` and `lastApplied` is a known non-busy mode, busy delivery has not happened yet.
    It answers `{ mailMode: 'busy-shadow' }`, so busy is judged as the busy gate is.
  - Else, if the resolved mode is `busy` and `busySince` is a number, it answers `{ mailMode: 'busy', busySince }`,
    so the busy idle start is `max(stop, busySince)`.
  - Else it answers `{ mailMode: resolvedMode }`: today's expression.
- **At boot** `lastApplied` is `null`, so the stall sweep judges exactly as today until busy delivery begins again
  while the server runs. A restart neither delays a stuck-mail notice nor grants a grace.
- **The field.** `StallArming` (`stall.ts` ≈:126) gains `readonly busySince?: number`, the companion of `mailMode`,
  which the same clock already reads. Absent means today's clock: the `w2-arming-optional` precedent. It has no
  `null`: a gate that has not delivered on busy yet is judged through its `mailMode` instead.
- **Why the arming carries it, not `StallInput`.** The clock is `stallIdleStart` (`stall.ts` ≈:1730), which reads
  `StallSessionInput` (≈:1483), not `StallInput` (≈:509). `watch.ts` builds that input at three sites (`judgeStall`
  ≈:3895, `judgeStallCoordinator` ≈:3927, `judgeStallOrphan` ≈:3966), and each takes `arming` from `sweepStalls`.
  Both inputs carry `StallArming`, so the field is set once and reaches every site. `mailMode` is read nowhere else in
  `stall.ts`, so judging it as `busy-shadow` changes this one clock and nothing else.
- **The change.** `stallIdleStart`'s busy line (≈:1735) becomes:

  ```ts
  if (live !== null && live.word === 'busy') {
    if ((input.arming.mailMode ?? 'shell') !== 'busy') return m.stopAt + DELEGATE_CAP_MS;
    if (input.arming.busySince !== undefined) return Math.max(m.stopAt, input.arming.busySince);
  }
  return m.stopAt;
  ```

  With `busySince` absent this is today's line exactly. Under `busy`, held mail gets the full `MAIL_STUCK_MS` from
  the moment busy delivery began, never from a turn stop that happened under the busy gate.

**`sweepMail`** (≈:4531):
1. The `listing === null || listing.includes(MAIL_DISABLED_MARKER)` return (≈:4541) stays first and is unchanged. It
   writes neither clock field.
2. The mode line at ≈:4546 becomes `const mode = this.stallResolveNow(store, listing, false).arming.mailMode;`,
   followed by the two clock writes above. `false` is correct here because the return above has already proven
   `mail-disabled` absent from this listing.
3. Everything downstream is unchanged and keeps reading `mode`: `mailTurnReadsMark(mode)`, the
   `mailTurnIdle(…, mode)` call at ≈:4972, and the busy-shadow "would deliver" log at ≈:4999.

**`sweepStalls`** (`watch.ts` ≈:3775). The inline line at ≈:3788 becomes:

```ts
const r = this.stallResolveNow(store, names, names.includes(MAIL_DISABLED_MARKER));
const arming: StallArming = { ...r.arming, ...stallBusyClock(r.arming.mailMode, this.lastApplied, this.busySince) };
if (arming.disabled) return;
```

`stallBusyClock` answers today's expression unless the resolved mode is `busy` and the mail sweep has applied a
non-busy mode earlier in this server's life. So at boot, under `follow` or a chosen level, with or without
`mail-disabled`, the arming is today's expression byte for byte, with no `busySince` key (M4). A raise into busy
delivery while the server runs gets the grace, whether it comes from a chosen level, from Follow or from
`mail-gate-busy` touched by hand. The last two change today's behaviour: today such a raise can fire a false
stuck-mail push during the first busy pass, and the grace removes that window.

**Why a busy clock, and not a flag.** Each sweep reads the row at its own time: the mail sweep every 10 s
(`MAIL_SWEEP_MS`, ≈:377), the stall sweep at most once per 60 s (`STALL_SWEEP_MS`, ≈:194). So a write can split them
for up to 60 s. One direction is harmful: raising straight to `all` with mail held for `MAIL_STUCK_MS` (72 min) or
more. Under `busy`, `stallIdleStart` times mail-stuck from the turn's stop rather than stop + `DELEGATE_CAP_MS`, so
every such mail would read stuck at once, with the further checks live.
- Rev 2 closed this with a flag the mail sweep set at its mode line. That line runs before any delivery. The sweep
  then delivers serially, one message per session per sweep (the `seen` set, ≈:4661), each `sendPrompt` taking
  seconds (≈:5060), with `markDelivered` only after it (≈:5065), and a second mail to one session waits out
  `MAIL_COOLDOWN_MS` (120 s, ≈:399). Both sweeps are void-dispatched on their own clocks (≈:1725, ≈:1878), so a stall
  sweep could land inside that pass and judge a still-queued mail stuck.
- The clock closes it for every row, the ones the first pass gates included: until the mail sweep has applied `busy`
  once, busy is judged as the busy gate; after that a held mail is judged against `max(stop, busySince)`. So nothing
  can read stuck until `MAIL_STUCK_MS` after busy delivery began.
- Rev 3 granted the grace to a chosen level alone, and cleared the clock on every failed listing and every restart,
  which could hold a stuck-mail notice off for as long as the failures kept coming. Keying the grace on a mode change
  the mail sweep saw closes both.
- Lowering is the harmless direction, and needs nothing.

`r.quietMs` is threaded to `judgeStall` and set on the `StallInput` built at ≈:3877. `judgeStallCoordinator` and
`judgeStallOrphan` take the same `arming`, `busySince` included. They do not read the quiet time, because their arms
use fixed constants.

**Agreement.** Given the same listing and the same row, the two sweeps resolve the same arming, because both call
`stallResolveNow`. A test drives both sweeps from one fixture listing without `mail-disabled` (the mail sweep passes
`false` only after its own return proved the file absent) and one stored row, for every level and for `follow`. It
asserts three things: the two `stallResolveNow` answers are equal; the mode the mail sweep applies equals that
answer's `arming.mailMode`; and the arming the verdicts receive differs from that answer only in `mailMode` and
`busySince`, as `stallBusyClock` decides (§17, M8a). An interleaving test pins the clock (M8).

**With nothing chosen,** the resolver returns the very object `stallBoxArmingOf` built, which is today's expression.
A property test over every combination of the seven arming files plus `mail-disabled` asserts it. One stall-sweep row
asserts the arming the verdicts actually receive at boot, with the fleet box's files on busy delivery, and with
`mail-disabled` present: today's expression exactly, with no `busySince` key (§17, M4).

## 10. The two routes

One path, registered in `server/src/coord/routes.ts` beside `/api/coord/caps`: **`GET` and `POST
/api/coord/stall-watch`.** One path serves both verbs, as caps does, so one `SESSION_ONLY` entry covers the door.

- **`GET /api/coord/stall-watch`.**
  - No `deps.coord`: 501 `{ok: false, error: 'not-configured'}`, the existing `notConfigured` helper (≈:506).
  - Otherwise 200 `{ ok: true, ...StallWatchView }`, from one view builder,
    `stallWatchView(store, names | null, now, watcherFallback)`. The builder is defined once and shared by both
    halves (the `capsView` precedent, ≈:2404). `names` comes from `await deps.io.readdir(deps.cfg.registryDir)`, which
    the route file already does at ≈:587 and four other sites. `watcherFallback` is `watcher?.stallFallback() ?? null`
    (§9).
  - The builder composes, and decides nothing itself. Over the listing's box arming it calls the resolver, then three
    L1 readers: `stallStages` (the stages now), `stallNextStep` (the next step and the gates it waits on) and
    `stallFilesExceed` (whether the fleet box's files arm more than the choice). It previews no other choice: what a
    write would do is the POST's question, answered at the write.
  - **It never throws, like the sweeps' helper, and it claims a fallback only when the resolution failed.** It runs
    in two `try`s.
    - **The resolution:** `parseStallSettings` and `resolveStallWatch`, as `stallResolveNow` runs them (§9). This
      `try` alone sets `fallback`. On a throw it answers 200 with `fallback` set to `{ at: now, reason }` from its own
      catch, with `reason` composed and guarded as §9's catch composes its own. When `watcherFallback` is set, that
      is the `fallback` reported, even when the builder's own resolution succeeded.
    - **Whenever `fallback` is non-null,** the reply shows what the sweeps' catch runs: `effective` is the files-only
      reading, with the source `files`, and `quiet` is the built-in, `effectiveMs` equal to `builtInMs` with `source`
      `'default'`. The fallback line names both (`STALL_FALLBACK_TEXT`, §12). The files-only reading is
      `stallLevelOf`, `stallStages` and `stallNextStep` over the box arming alone, with `filesExceed` false. It calls
      neither `parseStallSettings` nor `resolveStallWatch`, so a parse or resolver fault cannot reach it.
    - **`chosen`** comes from the builder's own parse whenever that parse returned, a reported fallback included.
      When the parse itself threw, `chosen` is `stored: 'unreadable'`, with `level` and `quietMs` both
      `'unreadable'` and `updatedAt` `null`.
    - **The view-only readers** run in a second `try`: `stallLevelOf`, `stallStages`, `stallNextStep` and
      `stallFilesExceed`, over the resolved arming or, for the files-only reading, the box arming. The sweeps never
      call `stallNextStep` or `stallFilesExceed`, so a throw here says nothing about what the sweeps apply. It
      claims no fallback and never answers 500: `next` and `filesExceed` are left out, which the PWA reads as not
      stated (§12). What `effective` carries when `stallLevelOf` or `stallStages` itself throws here is left to the
      plan (§20).
  - It answers 200 even when the listing failed (`effective.measured: false`), when the row is absent or unreadable
    (`stored`), and when the notice read failed (`notices.ok: false`). Each is a fact the section renders, not a
    refusal.
  - **Counting never fails the reply.** The builder wraps the count in a `try`, so a throw from L1 counting becomes
    `notices: { ok: false }` and never a 500 (§11, M17b).
- **`POST /api/coord/stall-watch`** (departure `server-decides-the-confirm`). The body is `StallWatchRequest {
  level?: StallLevelChoice; quietMs?: number | 'default'; confirm?: string }`, a partial in which an omitted field
  keeps its stored value. `'default'` returns to the built-in. No `null` crosses the wire.
  1. No `deps.coord`: 501 `not-configured`.
  2. `decideStallSettings(req.body)`, which is L1 and pure, refuses with 400
     `{ok: false, error: 'bad-request', detail}`:
     - a non-object body;
     - a body naming neither `level` nor `quietMs`;
     - **an unknown key, named in the detail.** This follows the update-intent precedent over the caps one: a newer
       PWA sending a knob this server lacks must hear that it was not applied. Departure `unknown-keys-refused`.
     - a level that is not a `StallLevelChoice`;
     - a `quietMs` that is not `'default'` and fails `isStallQuietMs`;
     - a `confirm` that is not a string.

     Refusals never clamp. It answers `{ patch, confirm }`, with `confirm` `null` when the body carries none.
  3. Take the listing, `await deps.io.readdir(deps.cfg.registryDir)`. From here to the write in step 5 there is no
     `await`, so no other request can move the row between the effect and the write. The store still checks that
     the row it writes over is the one measured here (§8), for a writer outside the server.
  4. **The effect.** `stored = coord.stallSettings()`.
     - **An unreadable read is refused here.** If `stored` is `unreadable`, the route refuses with Fastify's 500, as
       a thrown store write does (step 8), and writes nothing: an effect measured on a row it could not read would
       be measured on the wrong row. It does not rely on the store's own re-read.
     - Otherwise `projected = stallSettingsAfter(stored, patch)` (§8); then `effect` is `{ measured: false }` when
       the listing is `null`, and otherwise
       `stallWriteEffect(stallBoxArmingOf(names, mailDisabled), stallUnheldBoxOf(names), stored, projected)`. `key`
       is `stallEffectKey(effect, updatedAt)`, where `updatedAt` is `stored`'s parsed `updatedAt`.
     - If `stallNeedsConfirm(effect)` is true and `confirm !== key`, the POST answers 409
       `{ ok: false, error: 'confirm-required', effect, effectKey: key }` and writes nothing. A body with no
       `confirm` meets this the first time. A body whose key no longer matches meets it again, with the fresh effect:
       another page wrote, or the fleet box's files moved, after its sheet opened.
     - Otherwise the write goes straight on: it needs no confirm, or its key matches.
  5. `const w = coord.setStallSettings(patch, Date.now(), stored)`. This is one synchronous transaction with no
     `await` inside, so two concurrent writes cannot interleave a read-merge-write.
     - **On `conflict`** the row changed outside the server after step 4's read, and nothing was written. The route
       runs step 4 again, once, on `w.before`: 409 `confirm-required` with the fresh effect and key when that
       effect needs a confirm the body's key does not match, and otherwise the write again, with `w.before` as
       `expected`. A second `conflict` is refused like an unreadable read: 500, and nothing written.
     - On `written`, `before` and `after` are `w.before` and `w.after`.
     - **No `coordMutex`.** Caps needed the mutex because its merge base was read across an `await`, and because
       dispatch decisions read caps under that mutex. Neither is true here: nothing decides a dispatch on these
       values, and the sweeps' reads are synchronous too.
     - Departure `no-coord-mutex-for-stall-settings`. If review prefers the caps shape anyway, wrapping the one call
       costs nothing.
  6. **The feed event,** only when `stallSettingsChange(before, after)` (L1, `stallsettings.ts`) answers a body
     rather than `null`. It compares `level` and `quietMs` only, never `updatedAt`. A no-op write skipped its
     `UPDATE` (§8), so `before` equals `after` and nothing is recorded; departure
     `no-op-write-records-no-feed-event`.
     - `deps.notifyLog.record({ kind: 'coord', sessionId: '', runId: null, title: 'stall watch changed', body })`,
       then `coord.recordFeedEvent(log.epoch, ev)`, in a `try`, with `void log.flush()` in `finally`. This is
       exactly caps' shape, and caps' reason for it (`routes.ts` ≈:2462–2497).
     - **The body** names only what changed, with L0 labels, for example
       `level: Follow the fleet box's files → Check silent workers; quiet time: 2 h (built-in) → 3 h`.
       `stallSettingsChange` composes it, and names a `before` that was not a readable row explicitly
       (`level: no stored choice → …`, `level: unreadable stored level → …`), so a write that restores a lost row is
       recorded and never prints `undefined`.
     - **The actor.** The route appends `; by <actor>`. When `deps.cfg.authEnabled`, `<actor>` is
       `deviceActor(sessionAuth(req).device)` (`ccdargv.ts` ≈:195): the same call, spelled the same way, that
       `server.ts`'s `pwaDec` makes for workspace verbs (≈:603–606). When the gate is unarmed it is `flag-off`,
       because `sessionVerdict` (`auth/gate.ts` ≈:552) does not read `enabled` and would otherwise record a session
       nobody presented; the word is the gate's own (`GateAllowReason`, `auth/gate.ts` ≈:449). `sessionAuth` already
       reaches this file as `registerCoordRoutes`' fourth parameter (`routes.ts` ≈:476), and `deviceActor` joins the
       file's existing `ccdargv.js` import (≈:14).
     - **It never branches on the device label.** `auth-gate.test.ts`'s structural scan (≈:1526–1544) slices `pwaDec`
       out of `server.ts` alone, strips that one call, and asserts that no `device` token is left. It does not read
       `coord/routes.ts`, and that scan is not edited. Instead `stall-settings-route.test.ts` applies the same strip and
       assert to the stall-watch POST handler's slice of `coord/routes.ts` (M29). The existing row's title, "the one
       ROUTE-LEVEL site", stays true of the file it scans; the new row covers the second site.
     - A failed archive write degrades the record, never the write.
  7. 200 `{ ok: true, ...stallWatchView(store, names, now, watcherFallback) }`, over the same listing. The builder
     **re-reads** the row from the store, never echoing the body or `after`, so the reply is what is now stored.
  8. A thrown store write becomes Fastify's 500, which is the caps precedent. The 409's `confirm-required` is the one
     new code word.

**What a write does: `stallWriteEffect(box, unheld, beforeRead, afterRead)`** (L1, `stallsettings.ts`).
- It parses each read and resolves it through `resolveStallWatch` against the same box arming, so each side gets
  the whole-row fallback (§6.2). The after read is the projection the store's write will leave (§8): the insert
  arm's seed for an absent row, and the other stored field kept as it is, an unreadable value included.
- It compares the two resolutions' stages with mail switched off read as on (`armedStages`, §6.2). The Now block
  still shows `held.mailOff`; the comparison does not, because a stored choice arms its stages for the moment mail
  returns.
- **It also compares each side's unheld stages,** for the same reason: a stored choice also arms its stages for the
  moment the fleet box's kill switch or strict gate is removed. The unheld reading resolves each side, through
  `armedStages`, against `unheld`: what the stored choice arms with no kill file, no strict gate and mail on.
  - `unheld` is `stallUnheldBoxOf(names)` (L1, `stallsettings.ts`):
    `{ ...stallBoxArmingOf(names.filter((n) => mailTurnModeOf([n]) !== 'strict'), false), disabled: false }`. It
    spells no marker: it finds the strict file by asking `mailTurnModeOf` about each name alone, and clears the kill
    file and the mail kill file as flags.
  - For a running level this reading is §6.2's `free`. For Follow it is the fleet box's files with those three
    cleared, so the mail mode is the one the files give below strict. For a chosen `off` it is Off over those files.
- It answers `StallWriteEffect` (§12):
  - `turnsOn`: the stage ids off before and on after in either reading, the resolved or the unheld, in §5.1's
    order;
  - `turnsOff`: the stage ids on before and off after in the resolved reading, which is what stops now;
  - `leavesWave2`: `wave2` on before and off after, in either reading;
  - `heldByBox`: a stage in `turnsOn`, or `leavesWave2`, comes from the unheld reading alone. The fleet box holds it
    until its kill switch or strict gate is removed by hand, and it then applies at the next sweep with no second
    confirm;
  - `quietLowered`: the effective quiet time after differs from the one before, and is below it or below the
    built-in;
  - `filesExceed`: `stallFilesExceed` over the after resolution;
  - and, for the sheet's wording (§13), `before` and `after` (the resolved reading's two sets of stages), `quietMs`
    (`{ before, after }`, the two effective quiet times) and `mailOff` (the box's `mailDisabled`). The unheld stages
    are not sent: `turnsOn`, `leavesWave2` and `heldByBox` carry what the sheet needs from them.
- **`stallNeedsConfirm(effect)`** is true for `{ measured: false }`, and otherwise exactly when `turnsOn` is not
  empty, or `leavesWave2`, or `quietLowered`. Each of the five stages sends something or changes what the mail gate
  delivers, so every stage turning on counts, in either reading. A pure lowering needs none.
- **The quiet write takes the same path.** So a quiet-time write that makes a stored level apply is confirmed by the
  stages it turns on, and a level write that makes a stored quiet time apply is confirmed by `quietLowered`.
- **`stallEffectKey(effect, updatedAt)`** is a short deterministic digest: eight hex characters of a 32-bit FNV-1a
  hash over `JSON.stringify(effect)` and the before-row's `updatedAt` (a fixed word when it is `null`). It is pure
  JavaScript with no `node:` import, so it stays L1 (§14 item 5). The builders return literals, so the key order is
  fixed. It is a staleness check, not a credential: the session gate guards the door. Because `updatedAt` is in it, a
  write that changed the row between the 409 and the re-POST fails the match even when the effect reads the same.

**Two more readers for the view.**
- **`stallNextStep(arming, chosen): StallNextStep`.** `{ kind: 'none' }` when `stallLevelOf(arming)` is `custom`, or
  when a level is chosen and the reading differs from it (a held level that reads lower, a chosen `off` over a busy
  file). `{ kind: 'top' }` at `all`. Otherwise `{ kind: 'step', level, waitsOn }`: `level` is the next in
  `STALL_LEVELS`, and `waitsOn` lists the stages that level's own row turns on and the current arming has off, both
  through `armedStages`, in §5.1's order, leaving out a stage whose `gate` is `null` (the busy gate).
- **`stallFilesExceed(box, resolved): boolean`.** False when `levelSource` is `files`. Otherwise true when a sending
  stage (`checks`, `alerts`, `busyDelivery` or `wave2`) is on in the box's own stages and off in the resolved ones,
  both through `armedStages`. The busy gate sends nothing and is never compared (§5.1). So on today's fleet
  (`stall-watch-live` plus `mail-gate-busy-shadow`), a chosen Deliver or Everything does not exceed: the files' one
  sending stage is `checks`, and the choice has it too.
- **Gating.** Session-gated when `CCRC_AUTH` is armed, open dark otherwise.
  - No box token and no `UNGATED` membership. The route's docstring argues both, as caps' does (`routes.ts`
    ≈:2361–2373): an operator control is not a machine lane, and a ladder raise releases no wedge.
  - **The unarmed-box insider case**, argued in the same docstring the way the caps door's "open dark, like every
    other write the console makes" does: on an unarmed box any process that reaches the server, a fleet session
    included, can change the level or the quiet time, as it can the caps. What stands against that is the
    forbid-mention pins in all three skills, the feed row with its `flag-off` actor, and arming the gate. Nothing is
    added to `CLAUDE.md`'s SAFETY list, which does not list the caps door either.
  - `auth/gate.ts` gains no `EXEMPT` row.
  - **The prose names no device.** The route's docstring, the `SESSION_ONLY` paragraph and every new server comment
    call the control "the Settings page" or "the PWA". The two passages they are modelled on each use a device word
    (the caps docstring, `routes.ts` ≈:2365–2366; the reclaim-pause paragraph, `coord-pause-route.test.ts` ≈:208), and
    neither wording is copied. M29's scan holds it for the new handler and `stallsettings.ts`.
- **Census changes (all in W1):**
  - **`server/test/coord-pause-route.test.ts`:** `SESSION_ONLY` (≈:221) gains `'/api/coord/stall-watch'`. Its
    scan reads `app.post` handlers only, and the shared path is how caps' GET half rides the same entry. Its
    docstring gains a `/api/coord/stall-watch` paragraph in the caps and reclaim-pause paragraphs' shape (an operator
    dial; raising it releases no wedge; caps' machine-lane argument). The blind-spot sentence (≈:212–215,
    "SESSION_ONLY already holds two (`/api/coord/caps`, `/api/coord/reclaim-pause`), so kickoff would be its third")
    becomes "holds three (…, `/api/coord/stall-watch`), so kickoff would be its fourth", in lower case, so `CARD_RE`
    is unaffected.
  - **`server/test/auth-gate.test.ts`, the two pins:** `expect(scanRoutes('coord/routes.ts').length).toBe(31)`
    (≈:242) moves to 33, and `expect(ROUTES.length).toBe(89)` (≈:313) moves to 91, each with its comment-ladder line
    in the file's idiom ("33 since `GET`/`POST /api/coord/stall-watch` (stall-watch settings W1): SESSION_ONLY like
    the caps dial, NOT EXEMPT, no box token"). `'GET /api/coord/stall-watch'` and `'POST /api/coord/stall-watch'`
    join the file's list of specific registrations it found.
  - **`auth-gate.test.ts`, the stated counts.** The route-count prose block, "the gate sweep states the route counts
    it derives" (≈:1546–1627), reads every numeral on five needle lines and compares it with a derived count:
    `httpCount` (86 today: `ROUTES` less the three websockets), `exemptHttp` (32) and `ROUTES.length` (89). The rule:
    **every numeral on a needle line that block reads moves with the route count.** So W1 also edits:
    - `server/src/auth/gate.ts` ≈:8, "stands in front of all 86 routes" → 88. That is a shipped source file, edited
      in its docstring only;
    - `auth-gate.test.ts` ≈:901, "in one loop over all 86 HTTP routes" → 88;
    - `auth-gate.test.ts` ≈:965, "covers all 86 HTTP routes, not the 32 exempt" → 88 (the 32 stays: no `EXEMPT`
      row is added);
    - `auth-gate.test.ts` ≈:451, "89 scanned + the static wildcard" → 91.

    The websocket line stays at three. Each is re-measured at the first step, because another branch's route moves
    the same numerals.
  - **`server/test/coordinator-skill.test.ts`:** every route registered in `coord/routes.ts` must be named in the
    coordinator skill corpus or listed in its route-corpus `EXEMPT` set (≈:485–537). The skill's clauses are pinned
    verbatim, so the route is never named there. Instead `'GET /api/coord/stall-watch'` and
    `'POST /api/coord/stall-watch'` join `EXEMPT` with an operator-dial comment, beside caps (≈:525–526) and
    reclaim-pause (≈:533). And a forbid-mention case joins the caps dial's (≈:1569–1573): "never names the
    stall-watch settings door — a door that would tell a coordinator how to lower the watch on its own workers or
    stretch their quiet time", `expect(allSkillText).not.toContain('/api/coord/stall-watch')`.
  - **`server/test/worker-skill.test.ts` and `server/test/reviewer-skill.test.ts`:** a forbid-mention case each,
    beside the reclaim-pause ones (≈:674–681 and ≈:206–213): "never names the stall-watch settings door — the worker a
    check is about is the session most motivated to lower the watch",
    `expect(skill).not.toContain('/api/coord/stall-watch')`. The skill texts themselves are unchanged, so their
    verbatim pins stay green.
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
  - **`CLAUDE.md`, the mail-gate bullet** (≈:302), gains one sentence, worded as the operator's control: the
    operator's Settings control (`POST /api/coord/stall-watch`, design 2026-10-05) chooses a level that overrides the
    arming files, never `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`, and writes no file.
  - **`CLAUDE.md`, the `coord.db` bullet** (≈:255): its list of what a lost `coord.db` loses ("mail, claims, asks,
    central pool edges, update intents") gains "the stall-watch settings choice".
- **Kebab scan.** `mail-routes.test.ts`'s scan runs `/'([a-z]+(?:-[a-z]+)+)'/g` over every `.ts` file in
  `server/src/coord` (≈:523–525, ≈:734), so both the new file and the new handler in `coord/routes.ts` reach it.
  Three quoted kebab tokens are new:
  - `'busy-shadow'`, a `MailTurnMode` value in `StallLadderRow`'s type and rows and in `stallBusyClock`;
  - `'confirm-required'`, the POST's refusal code (§10);
  - `'flag-off'`, the feed actor when the gate is unarmed. Today it is spelled only in `auth/gate.ts`, which the scan
    does not read.

  All three are declared through one guard `stallsettings.ts` exports, `isStallSettingsKebab`, derived from one tuple
  there and added as one more union beside `isStallKebab` (≈:831), with the scan's failure message naming it. Every
  other word is a single word or camelCase by choice: level ids, `follow`, `default`, `chosen`, `files`, `held`,
  `custom`, `unknown`, `none`, `top`, `step`, `written`, `conflict`, the stage keys and the count-row keys.

## 11. The notice-count read

- **Store:** `stallObservationsSince(since)` returns `SELECT at, detail FROM run_events WHERE at >= ?`. There is no
  `ORDER BY`: the counts are order-free, and an `ORDER BY id` would invite a rowid scan on a database that never sees
  `ANALYZE` (`schema.ts`'s own note). An `EXPLAIN QUERY PLAN` row pins the plan to `run_events_by_at`.
  - The store spells no detail head. The heads (`stall`, `stall-shadow`) are spelled once, in `stall.ts` (≈:43–44),
    and `single-definition.test.ts` reds on a second copy. Classification therefore happens in L1, the same
    discipline as `mail-stuck-decided-in-l1`'s "judged in L1, never filtered by the store" (`stall.ts` ≈:1740).
  - A thrown statement becomes `{ok: false, detail}`.
  - **The window boundary lives here,** so its test does too: `stall-settings-store.test.ts` plants a row at `since`
    and one at `since - 1`, and only the first comes back (M17c).
- **L1:** `stallNoticeCounts(rows)` in `stallsettings.ts`. It takes rows only, and applies no window.
  - It parses each `detail` with `parseStallDetail` (`stall.ts` ≈:165). Every row that is not exactly a stall
    detail of this build reads `null` and is skipped: transitions, routing details, and an arm this build cannot
    name.
  - **A rung the arm does not have is skipped too.** `parseStallDetail` checks the head, the arm and a rung of 1 to 3
    (≈:170–176), but not that the arm has that rung, so `stall:dialog-cap:2:5` parses. `rungRecipient` (≈:744)
    throws a `RangeError` on such a pair; its existing callers (`rungDoneAt` ≈:759, `stallDialogCapDone` ≈:773) only
    pass pairs a verdict produced. So `stall.ts` gains one total, non-throwing lookup beside it,
    `stallArmHasRung(arm, rung): boolean` over the same `STALL_RUNG_RECIPIENTS` (≈:734), and `stallNoticeCounts`
    calls `rungRecipient` only after it answers true. Such a row comes from a newer build followed by a rollback
    inside 48 h, or from a hand edit.
  - **It tallies by role, into four rows** (departure `counts-by-role`). The observation detail is
    `<head>:<arm>:<rung>:<key>` (`stallDetail` ≈:156) and records no recipient, while the verdicts send some rungs
    somewhere other than the table says: frozen and dead go to the operator when the run has no claimant or
    coordination is paused (`stallW2Notify` ≈:828–831), and failed rung 2 likewise (`stallFailedInner` ≈:1713–1716).
    So no row may claim a recipient the verdict can override. The rows, derived from `rungRecipient` with one arm
    named:

    | row (key) | L0 label | what it counts |
    |---|---|---|
    | `checks` | "Stall checks to quiet workers" | `quiet` rung 1 only. This is the figure the parent spec's kill rule reads. |
    | `wakes` | "Notices to a session about its own failed turn or lost background work" | every other rung whose table recipient is `worker`: orphan D and E rung 1, failed rung 1 (the self-wake class, `STALL_MAIL_CLASS_MAP` ≈:232) |
    | `reports` | "Reports to a coordinator, or pushes to you when the run has no coordinator or coordination is paused" | every rung whose table recipient is `coordinator`: quiet rung 2, failed rung 2, frozen and dead rung 1 |
    | `pushes` | "Pushes to you" | every rung whose table recipient is `operator` alone: quiet rung 3, orphan D rung 2, the limit, dialog and coordinator-ball caps, coordinator-deaf, mail-stuck and marker-unreadable |

    Each row has `sent` (mode `live`) and `shadow` (mode `shadow`), summed across arms, kept separate. The four
    labels are defined once in L0 (`STALL_NOTICE_TEXT`).
- **Window:** `STALL_NOTICE_WINDOW_MS = 48 h`, defined once in `stallsettings.ts`. `since = now - window`. The reply
  carries `windowMs` and `since`. The PWA composes the counts heading from `windowMs`, formatted as it formats the
  quiet values, through `STALL_SECTION_TEXT.counts` ('Last {window}'), so no text copies the 48 h.
- **What a row means.**
  - One row is one rung's observation on one run, recorded before it is sent. `insertStallObservation` dedupes on
    `(runId, detail)`, so a restart never double-counts.
  - A `live` row means the notice was queued or pushed. Mail delivery may still lag, so the column is labelled
    "sent".
  - A rung recorded in shadow and later live, after an arming change, is two rows and counts once in each column.
- **What is not counted, and the section says so.** Run-less notices, **sent or shadow**, leave no observation row:
  a coordinator's own notices (`coordinator-notices-are-run-less`, deduped by subject) and notices about a session on
  no run (orphan D pushes, latched in memory: `run-less-push-latches-are-in-memory`, `watch.ts` ≈:840). Run-less
  shadow notices appear only as the `ccrc-server: stall-watch shadow … (run-less)` log line. So the `pushes` row
  under-counts at `alert` and above, and the counts cannot show R19's run-less push count. The footnote
  (`STALL_RUNLESS_FOOTNOTE`, §12) says so on every render.
- **The busy gate's evidence is not counted either.** Its would-deliver line (`watch.ts` ≈:4999) is a journal line
  with no durable row, so the busy-delivery and further-checks gates say that it is read in the server log (§5.1).
  Operator default, §19 Q9.
- **Cost.** The read is bounded by 48 h of `run_events` on the `run_events_by_at` index, and runs once per GET (60 s
  per open Settings page).

## 12. Wire types (L0, `shared/api.ts`, additive, imports nothing)

**Placement.** The whole block is appended at the **end** of `shared/api.ts`, below `MAIL_REPLAY_MS` (≈:9096, the
file's last line at origin/main be93d159e). That constant's own docstring (≈:9094–9095) gives the reason: README and
the compaction card cite this file by line, and an insertion above moves every anchor under it. README ≈:4586 cites
`shared/api.ts:7684-7686`, `:7726`, `:7734` and `:7747`, and `session-hook.test.ts`'s "README HAS ITS OWN CENSUS
ENTRY, and it is EMPTY" (≈:8674) reds if any of them moves. The natural homes beside `CoordStatus` (≈:3813) or
`CoordCapsView` (≈:6471) are both above those anchors, so they are not used. The plan's verification step re-runs
the README citation instrument and `session-hook.test.ts`'s per-file census (§17).

**Types and the guard.**

```ts
export const STALL_LEVEL_TEXT = { off: {label, does}, log: {…}, check: {…}, alert: {…}, deliver: {…}, all: {…} } as const;
export type StallLevel = keyof typeof STALL_LEVEL_TEXT;
export const STALL_LEVELS = Object.keys(STALL_LEVEL_TEXT) as StallLevel[];   // ladder order, pinned
export type StallLevelChoice = StallLevel | 'follow';
export function isStallLevelChoice(v: unknown): v is StallLevelChoice {
  return typeof v === 'string' && (v === 'follow' || (STALL_LEVELS as readonly string[]).includes(v));
}
export const STALL_STAGE_TEXT = { checks: {name, stops, gate}, alerts: {…}, busyDelivery: {…},
  busyGate: {name, stops, gate: null}, wave2: {…} } as const;                // gate null: nothing waits on it
export type StallStage = keyof typeof STALL_STAGE_TEXT;                      // the five confirm stages (§5.1)

export interface StallWatchStages { runs: boolean; checks: boolean; alerts: boolean;
  busyDelivery: boolean; busyGate: boolean; wave2: boolean }
export interface StallHeld { watchOff: boolean; mailOff: boolean; gateStrict: boolean; wave2HeldByStrict: boolean }
export type StallNextStep =
  | { kind: 'none' }                                                 // custom, or the reading differs from the choice
  | { kind: 'top' }                                                  // at Everything
  | { kind: 'step'; level: StallLevel; waitsOn: StallStage[] };      // §5.1 order, gated stages only
export type StallWatchEffective =
  | { measured: false }                                              // unlistable registry → "unknown"
  | { measured: true; level: StallLevel | 'custom'; files: StallLevel | 'custom';
      source: 'chosen' | 'files' | 'held'; stages: StallWatchStages; held: StallHeld;
      next?: StallNextStep; filesExceed?: boolean };                 // left out only if the second try caught
export type StallWriteEffect =
  | { measured: false }                                              // unlistable registry: cannot be shown
  | { measured: true; turnsOn: StallStage[]; turnsOff: StallStage[]; leavesWave2: boolean;
      heldByBox: boolean;                                            // a turn-on held by the kill switch or strict gate
      quietLowered: boolean; filesExceed: boolean;                   // filesExceed: for the state after the write
      before: StallWatchStages; after: StallWatchStages;             // the resolved reading, mail off read as on
      quietMs: { before: number; after: number }; mailOff: boolean };
export interface StallConfirmRequired {                              // the POST's 409 body (§10)
  ok: false; error: 'confirm-required'; effect: StallWriteEffect; effectKey: string }
export interface StallNoticeCount { row: keyof typeof STALL_NOTICE_TEXT; sent: number; shadow: number }
export interface StallWatchView {
  chosen: { level: StallLevelChoice | 'unreadable'; quietMs: number | 'default' | 'unreadable';
            updatedAt: number | null; stored: 'row' | 'absent' | 'unreadable' };
  effective: StallWatchEffective;
  quiet: { effectiveMs: number; builtInMs: number; minMs: number; maxMs: number; stepMs: number;
           source: 'chosen' | 'default' };
  notices: { ok: true; since: number; windowMs: number; counts: StallNoticeCount[] } | { ok: false };
  fallback: { at: number; reason: string } | null;                   // the builder's own catch, or stallFallback()
}
export interface StallWatchRequest { level?: StallLevelChoice; quietMs?: number | 'default'; confirm?: string }
```

**Every other string, by name.** Each user-facing string of the section is one of these L0 constants, and no other
file spells one. A `{name}` slot is filled by the PWA's one helper, `fillStallText(text, slots)`; that is the simplest
form that keeps every word in L0.

| constant | holds |
|---|---|
| `STALL_LEVEL_TEXT` | the six labels and `does` texts (§5) |
| `STALL_STAGE_TEXT` | the five stage names, `stops` texts and gates, the busy gate's gate `null` (§5.1) |
| `STALL_FOLLOW_LABEL` | "Follow the fleet box's files" |
| `STALL_SOURCE_TEXT` | `{ files: "Following the fleet box's files", chosen: 'Chosen here', held: 'Chosen: {label}, held back by the fleet box ({reason})' }` |
| `STALL_HELD_REASON` | `{ watchOff: 'its kill switch is on', gateStrict: 'its mail gate is set to strict' }` |
| `STALL_HELD_TEXT` | the four held lines, one per `StallHeld` key (§13) |
| `STALL_BUSY_GATE_TEXT` | `{ holds, logs }`, the busy gate's Now sentence in its two parts (§5.1) |
| `STALL_BUSY_GATE_OFF_TEXT` | "The busy gate is off: the fleet box's files do not turn it on." |
| `STALL_HAZARD_TEXT` | the hazard line (§6.4) |
| `STALL_FILES_EXCEED_TEXT` | "The fleet box's files arm more than this choice. If the choice stops applying (a rollback, a lost setting), they apply again, and notices recorded in shadow meanwhile go out." |
| `STALL_STORED_TEXT` | `{ absent, unreadable, level, quiet, both }`, the five stored-choice lines (§13) |
| `STALL_FALLBACK_TEXT` | "Your choice is not being applied ({reason}); the watch is following the fleet box's files and the built-in quiet time." |
| `STALL_NOT_AVAILABLE_TEXT` | "Stall-watch settings are not available on this server. Any choice shown before is no longer applied; the watch follows the fleet box's files." |
| `STALL_NEXT_TEXT` | `{ lead: 'Next step:', waitsOn: 'Waits on:', top: 'Top of the ladder.' }` |
| `STALL_QUIET_NOTE` | §7's note, with no number and no level label |
| `STALL_CONFIRM_TEXT` | the sheet's lines (§13): `title`, `followTitle`, `quietTitle`, `confirm`, `turnsOn`, `turnsOnFree`, `backOn`, `heldByBox`, `due`, `dueFromOff`, `dueMail`, `dueMailOff`, `dueMailOffHeld`, `dueMailBack`, `quietDue`, `quietDueAll`, `quietDueMailOff`, `quietDueAllMailOff`, `quietRecorded`, `quietOff`, `quietRepeat`, `quietRepeatMailOff`, `quietDialogs`, `unknown`, and the refusal toast `refused` |
| `STALL_NOTICE_TEXT` | `{ checks, wakes, reports, pushes }`, the four count labels (§11) |
| `STALL_RUNLESS_FOOTNOTE` | "Counts notices on runs only. Notices about a session on no run, or about a coordinator itself, sent or shadow, are not counted here; shadow ones appear only in the server log." |
| `STALL_SECTION_TEXT` | the headings and small words: `title` ('Stall watch'), `level`, `quiet` ('Quiet time before a worker check'), `builtIn`, `chosenHere`, `range` ('{min} to {max}'), `counts` ('Last {window}', filled from `windowMs`), `sent`, `shadow`, `countsFailed`, `custom`, `unknown`, `theySay` ('they say: {level}'), `stale`, `unread` |

No text copies a level label in short form. A line that needs a level's name takes it through a `{label}` slot from
`STALL_LEVEL_TEXT`, and the texts that once said "at Everything" or "at Alert or Deliver" now name the stage instead
("while the further checks are on", "while reports to coordinators are on").

- **`stages` is derived server-side** by `stallStages(arming)` (L1, `stallsettings.ts`) from a resolved `StallArming`:
  - `runs = !disabled`;
  - `checks = runs && live`;
  - `alerts = runs && live && escalate`;
  - `wave2 = runs && w2Live === true`;
  - `busyDelivery = mailMode === 'busy' && mailDisabled !== true`;
  - `busyGate = mailTurnReadsMark(mailMode) && mailDisabled !== true`, so `busy` and `busy-shadow` alike
    (`turnidle.ts` ≈:89).

  The last two read false while mail is switched off, because the mail gate does not run then (§5.1). So no mail-mode
  word crosses the wire, and `MailTurnMode` gains no second definition in L0. Departure
  `stages-on-the-wire-not-modes`.
- **`next` and `filesExceed`** are the view's two server-side readings for the Now and Next blocks: `stallNextStep`
  and `stallFilesExceed` (§10). With them the PWA keeps no list of level ids, no copy of a ladder column, and no
  preview of any choice. What a write would do is answered by the POST, at the write, as `StallWriteEffect` (§10).
- **`chosen` for a row that is not there.** When `stored` is not `'row'`, `chosen.level` and `chosen.quietMs` are
  both `'unreadable'` and `updatedAt` is `null`; `stored` tells absent from unreadable. No absent row is ever sent as
  `follow` or `'default'`. When the view builder's own parse threw, `chosen` is `stored: 'unreadable'` in the same
  shape (§10).
- **`quiet` under a fallback.** Whenever `fallback` is non-null, `quiet.effectiveMs` is `builtInMs` and
  `quiet.source` is `'default'`, which is what the sweeps' catch runs (§9, §10).
- **`counts` always carries the four rows**, zeros included, in L0 key order.
- **The reply builders return literals,** so a field added later is a compile error until every path computes it.
  `next` and `filesExceed` are optional for one path only: the view builder leaves them out when its second `try`
  caught (§10). Every other path sets both.
- **Absence-permits.** A newer PWA reading an older reply treats a missing optional field as "not stated", never as
  `false` (§13's wire guard). A missing `next` reads as no Next step block; a missing `filesExceed` reads as no
  files-exceed line; a missing `fallback` reads as no fallback stated.

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
- It returns `{ view, failure, reload, settle }`. It has no `refresh()`: rev 3 needed a fresh read to decide a confirm
  on, and the server now decides the confirm at the write (§10).
  - `view` is the **last good** answer;
  - `failure` is `'not-configured' | 'failed' | null`. Only 501 with `error: 'not-configured'`, and 404 with
    `error: 'not-found'` (an older server that lacks the route: the server's `/api/*` not-found answer, `server.ts`
    ≈:3468–3473), map to `not-configured`; both status and code must match, as `useUpdatesView`'s `failureOf`
    requires (≈:217–222). Anything else is `failed`. Departure `older-server-404-reads-not-configured`.
  - `reload()` is fire-and-forget, as `useUpdatesView`'s is (≈:271: it returns `void`, and in injected mode it is a
    no-op).
  - `settle(view)` installs a write's reply and bumps the request generation, so a poll issued before the write that
    lands after it cannot overwrite the reply.
- **Wire guard.** `asStallWatchView(raw)` accepts only a structurally readable answer, and anything else counts as a
  failed read. It drops malformed `counts` elements with one `console.warn`, as `asUpdatesView` does. It reads a
  missing `next`, `filesExceed` or `fallback` as "not stated" (§12). A second guard, `asStallConfirm(raw)`, reads a
  409 body: it accepts only `error: 'confirm-required'` with a structurally readable `effect` and a string
  `effectKey`, and anything else is an ordinary refusal.

**API.** In `pwa/src/lib/api.ts`:
- `stallWatch: () => getJson<StallWatchView>('/api/coord/stall-watch')`.
- `setStallWatch: (body: StallWatchRequest) => postJsonOr<StallWatchView | 'unreadable'>('/api/coord/stall-watch',
  'unreadable', body)`. It uses `postJsonOr` for `setCoordCaps`' reason (`pwa/src/lib/api.ts` ≈:660): after a write,
  "the answer could not be read" is not "the request never happened".
- A non-2xx answer still rejects with `ApiError { status, body }` (`pwa/src/lib/api.ts` ≈:9–23). So the section reads
  a 409's body off the error, as the composer reads the 409 `draft-present` body and opens its sheet (that file's
  header note, ≈:1–4; `pwa/src/session/Composer.tsx` ≈:97).

**States.** These follow the Updates section's discipline (`SettingsScreen.tsx` ≈:699–716), with one deliberate
difference. "Don't know yet" never borrows the rendering of "nothing there".
- **`failure === 'not-configured'` wins over a landed view.** The Updates section renders a landed view before it
  looks at the failure kind (≈:705), so a copy of it would keep showing an old choice, "Off, Chosen here" with its
  radio checked, after a rollback to a build without the route. Here the section's whole body becomes
  `STALL_NOT_AVAILABLE_TEXT` instead, whether or not a view landed: no Now block, no control, no checked radio, so
  nothing can be used. An open tab shows that text within one poll (60 s) of the rollback, until the service worker's
  check loads the older bundle (`UPDATE_CHECK_MS`, 15 min, or on return to the foreground, `pwa/src/main.tsx`
  ≈:31–38), and the section is gone.
- A view landed, and the latest failure is `failed` or `null`: render it. After a `failed` poll, add the amber
  `STALL_SECTION_TEXT.stale` line ("The latest read failed — this is the last answer that landed.").
- `failed`, with no view yet: `STALL_SECTION_TEXT.unread` ("The stall watch settings could not be read — the screen
  tries again every minute.").
- Otherwise: `<Skeleton lines={3}/>`.

**Layout.** Top to bottom:
1. **Now.**
   - **The level.** The effective level's label and its `does` text. Or "Custom", followed by one line listing the
     names of the stages that are on (`STALL_STAGE_TEXT`). Or "Unknown — the fleet registry could not be read",
     never "Off".
   - **The busy gate.** When `stages.busyGate` is true, `STALL_BUSY_GATE_TEXT.holds`, followed by `logs` when
     `stages.busyDelivery` is false (the `busy-shadow` mode). Otherwise, when the source is `files`, `stages.runs` is
     true, the level is not `custom` and `held.mailOff` is false, the note `STALL_BUSY_GATE_OFF_TEXT`: a level read
     from the fleet box's files that runs without the gate its own row has. While mail is switched off the gate reads
     off whatever the files say (§12), so the note would name the wrong cause, and the `mailOff` held line gives the
     right one. Under a chosen level the ladder sets the gate, and the held lines say when strict or mail switched
     off holds it. All of it comes from wire facts, so the section spells no level id.
   - **The source line**, from `effective.source`:
     - `files`: "Following the fleet box's files";
     - `chosen`: "Chosen here";
     - `held`: "Chosen: <chosen level's label>, held back by the fleet box (<reason>)", where the reason is
       `STALL_HELD_REASON.watchOff` when `held.watchOff`, else `STALL_HELD_REASON.gateStrict`.
   - **One line per `held` flag** (`STALL_HELD_TEXT`), worded without file names:
     - `watchOff`: "A kill switch on the fleet box has the watch off, whatever is chosen here."
     - `mailOff`: "Mail is switched off on the fleet box: no mail is delivered, and checks and reports are held.
       Pushes to you still go."
     - `gateStrict`: "The mail gate is set to strict on the fleet box: busy delivery and the busy gate are off."
     - `wave2HeldByStrict`: "The strict mail gate also holds the further checks off, because they need busy
       delivery."
   - **The hazard line** (§6.4), when the stages call for it and `held.mailOff` is false.
   - **The files-exceed line** (`STALL_FILES_EXCEED_TEXT`), whenever `effective.filesExceed` is true. The server
     sets it when the source is not `files` and a sending stage is on in the fleet box's own stages but off in the
     resolved ones (§10). The fleet box's files then arm more than the choice, and any fallback (a rollback, the
     watchdog's included; a lost, absent or unreadable row; a resolver fallback) sends what the choice recorded in
     shadow (§15).
   - **The stored-choice lines** (`STALL_STORED_TEXT`). Whenever the stored row does not apply whole, exactly one:
     - `stored` absent: "No stored choice was found: following the fleet box's files and the built-in quiet time."
     - `stored` unreadable: "The stored choice could not be read: following the fleet box's files and the built-in
       quiet time."
     - `chosen.level` and `chosen.quietMs` both unreadable in a row that reads: "The stored level and quiet time
       could not be read, so neither applies: following the fleet box's files and the built-in quiet time."
     - only `chosen.level` unreadable: "The stored level could not be read, so neither stored choice applies:
       following the fleet box's files and the built-in quiet time."
     - only `chosen.quietMs` unreadable: "The stored quiet time could not be read, so neither stored choice
       applies: following the fleet box's files and the built-in quiet time."
   - **The fallback line** (`STALL_FALLBACK_TEXT`), whenever `fallback` is not `null`: "Your choice is not being
     applied (<reason>); the watch is following the fleet box's files and the built-in quiet time." The server then
     sends the files-only reading as `effective` and the built-in as `quiet`, so the rest of the section already
     shows what the sweeps are doing (§10).
2. **Next step**, from `effective.next` (§10).
   - `step`: "Next step: <level's label>.", then "Waits on:" and the gate of each stage in `waitsOn`. The "Waits
     on:" part is left out when `waitsOn` is empty.
   - `top`: "Top of the ladder."
   - `none`: nothing. The server answers `none` for `custom`, and whenever the effective level differs from the
     chosen one (a level held lower, or a chosen `off` over a busy file). It never lists the busy gate, which has no
     gate. With `effective.measured` false there is no Next step.
3. **Level.** A radio `fieldset` of labels only. The first option is "Follow the fleet box's files (they say:
   <files level label>)", or "(they say: unknown)" while the registry cannot be read; the six level labels follow.
   The selected option's `does` and gates are not repeated here; they are in the Now and Next blocks.
   - The checked option is `chosen.level` **from the server's answer, never from the tap.** If the level is
     `unreadable`, no radio is checked.
   - The fieldset is disabled while a write is in flight or its sheet is open.
4. **Quiet time before a worker check.** The effective value and its source ("2 h (built-in)" or "3 h (chosen
   here)"), its range ("30 min to 12 h", composed from `minMs`/`maxMs`), a `<select>`, and the note (§7). Under a
   reported fallback the server sends the built-in, so it reads "2 h (built-in)" (§10).
   - The select offers "Built-in (<builtInMs>)", then every `stepMs` step from `minMs` to `maxMs` except the one
     equal to `builtInMs`, so the built-in value appears once.
   - Its checked value also comes from the server's answer.
5. **The counts**, headed `STALL_SECTION_TEXT.counts` filled from `windowMs` ("Last 48 h" at the shipped window).
   Four rows, by the L0 labels: `<label> — <sent> sent · <shadow> shadow`. With `notices.ok` false: "The notice
   counts could not be read." The footnote, `STALL_RUNLESS_FOOTNOTE`, is always shown.

**Writes: the server decides the confirm; settle on the reply; never optimistic** (departure
`server-decides-the-confirm`).
1. On a level, Follow or quiet-time choice, the section calls `api.setStallWatch` with only the field moved, and no
   `confirm`.
2. A 2xx whose body passes `asStallWatchView` is installed with `settle(view)`, and the controls re-render from it.
3. A 2xx whose body is unreadable gives `toast(UNCONFIRMED_TEXT)`, the existing constant (`SettingsScreen.tsx`
   ≈:72), then `reload()`.
4. A 409 whose body passes `asStallConfirm` opens the sheet, built from its `effect` (below).
   - Cancel writes nothing, because nothing was written.
   - Set sends the same body again with `confirm: effectKey`, and its answer goes through steps 2 to 5 again. So a
     key the server no longer matches opens a fresh sheet from the fresh effect: another page wrote, or the fleet
     box's files moved, while the sheet was open. Nothing is written until the operator has confirmed what the
     server will actually do.
5. Any other refusal gives `toast(STALL_CONFIRM_TEXT.refused, 'error')`, "Nothing was changed: <detail>", with the
   server's detail in the slot, then `reload()`. Because the controls render from the server's answer, they show the
   stored value again.

The section never decides whether a write needs a confirm, never previews a choice, and holds no ladder.

**The sheet, built from the effect** (`QuickConfirm`, `pwa/src/components/QuickConfirm.tsx`; departure
`confirm-on-stage-diff`). One pure helper, `stallConfirmLines(effect, request, builtInMs)`, maps the effect's facts to
L0 lines keyed by stage id. No rank is involved, so `custom` needs no rank and no label of its own. `builtInMs` is the
view's `quiet.builtInMs`, a build constant.
- **Title.** "Set the stall watch to <label>?" (`title`) for a level; `followTitle`, "<label>?" filled with
  `STALL_FOLLOW_LABEL`, for Follow; "Set the quiet time to <value>?" (`quietTitle`) for a quiet time. Confirm label
  "Set" (`confirm`).
- **The unmeasured effect** (`measured: false`) gives one line, `unknown`: "The fleet box's files could not be read,
  so what this choice turns on cannot be shown."
- **Otherwise one paragraph per line, in this order:**
  - for a level write, the target's `does` (none for Follow);
  - **for each stage in `turnsOn`:**
    - when the stage turns on in the resolved reading (`before` off, `after` on) and `after.runs` is false,
      `backOn`: "<name> turns back on: the fleet box's files arm it." With the watch off after the write, only a
      mail-gate stage can turn on in that reading, and only because the fleet box's files arm it. This is the line
      Off shows when it hands busy delivery back to a box busy file, which keeps Q2's Off;
    - otherwise `turnsOn`, "<name> turns on. Waits on: <gate>", or, for the busy gate, which has no gate,
      `turnsOnFree`, "<name> turns on." A stage that turns on only in the unheld reading always takes one of these
      two, never `backOn`;
  - **for each stage in `turnsOff`:** its `stops` text, for example "Busy delivery stops." Leaving the further checks
    gives `wave2`'s `stops`, the line that says checks fall back to the plain quiet time. It shows whenever
    `leavesWave2` is set, from either reading;
  - **the held line**, `heldByBox`, when the effect's `heldByBox` is set: "Held by the fleet box until its kill switch
    or strict gate is removed; it applies then without asking again." It follows the stage lines it qualifies;
  - **what falls due**, chosen per stage that turns on in the resolved reading. A stage that turns on only in the
    unheld reading makes nothing due until the hold lifts, and the held line covers it. While `mailOff`, each line
    takes its mail-off variant: pushes to you still go (`stallMailDisabledHold`, `stall.ts` ≈:813, passes them),
    while checks, reports and mail wait.
    - `due`, when `checks`, `alerts` or `wave2` turns on and `before.runs`: "At the next sweep every notice now due
      is sent, including ones recorded in shadow; later rungs follow on their own clocks.";
    - `dueFromOff`, when `checks` turns on and `before.runs` is false: "Off recorded nothing. At the next sweep every
      worker already quiet past the quiet time is checked, and a worker whose check went out before Off gets the
      next notice now due.";
    - under `mailOff`, either of those two becomes `dueMailOff` when `after.alerts`: "Pushes to you now due go out at
      the next sweep, including ones recorded in shadow; checks and reports wait until mail is back."; and
      otherwise `dueMailOffHeld`: "Checks and reports now due wait until mail is back.";
    - `dueMail`, when `busyDelivery` turns on: "Mail held for a busy session whose main turn has ended is delivered
      at the next mail sweep." Busy delivery alone makes no recorded notice due, because `stallNotifyDelivery`
      (`stall.ts` ≈:146) reads `live`, `escalate` and `w2Live`, never the mail mode. Under `mailOff` it becomes
      `dueMailBack`: "Mail held for a busy session whose main turn has ended is delivered once mail is back.";
  - **the quiet time**, when `quietLowered`, with `<value>` the effective quiet time after the write:
    - when it is below the one before, one line on what falls due, chosen by the stages after the write:
      `quietOff` when `after.runs` is false, "The watch is off, so nothing falls due until it runs."; `quietRecorded`
      when `after.checks` is false, "Every worker already quiet past <value> has a check recorded in shadow at the
      next sweep; nothing is sent."; `quietDueAll` when `after.wave2`, "At the next sweep every worker whose turn
      record has been quiet past <value> is checked, unless it is backed off for answering 'working' or its
      subagents are running."; otherwise `quietDue`, "Every worker already quiet past <value> is checked at the next
      sweep.";
    - under `mailOff`, `quietDueAll` becomes `quietDueAllMailOff`, "Every worker whose turn record has been quiet
      past <value> falls due for a check, unless it is backed off for answering 'working' or its subagents are
      running, and is held until mail is back."; and `quietDue` becomes `quietDueMailOff`, "Every worker already
      quiet past <value> falls due for a check at the next sweep, and is held until mail is back."
      `quietRecorded` and `quietOff` stay as they are: shadow rows are still recorded, and an Off watch sends
      nothing either way;
    - `quietRepeat`, when `after.checks`, not `after.wave2`, and the value is below the built-in: "While the further
      checks are off, a worker that keeps waiting is checked every <value>, because no back-off applies." Under
      `mailOff` it becomes `quietRepeatMailOff`: "While the further checks are off, a worker that keeps waiting
      falls due for a check every <value>, because no back-off applies, and is held until mail is back.";
    - `quietDialogs`, when `after.alerts`: "A dialog left open longer than <value> is pushed to you from the next
      sweep, and repeat pushes about one open dialog can come <value> apart." It has no mail-off variant, because
      pushes to you still go while mail is off;
  - **the files-exceed line**, `STALL_FILES_EXCEED_TEXT`, when `filesExceed`: after the write, the fleet box's files
    arm more than the choice.
- **Every line can join any sheet.** A level write that brings a stored quiet time into force shows the quiet lines
  under its level lines. A quiet write that brings a stored level into force shows that level's stage lines under
  the quiet title.
- **`QuickConfirm` takes several lines.** Its props are `title: string`, `consequence: string`,
  `confirmLabel: string`, `onConfirm`, `open` and `onClose` (≈:9–16), and it renders `consequence` as one
  `<p className="qc-consequence">` (≈:28). W2 widens `consequence` to `string | string[]`, rendering one `<p>` per
  line with the same class. Every existing caller passes a string and is unchanged. A row in
  `pwa/test/primitives.test.tsx`'s `QuickConfirm` describe (≈:267) pins it (P8).

**Same everywhere.** There is no viewport, pointer or user-agent branch in the section's behaviour. Its CSS uses the
existing `.settings-*` classes in `fleet.css`. No string in the section or its controls names a device.

**The Notifications row label** (departure `notifications-label-says-push`, Q10). W2 renames the existing row from
"Phone notifications for this browser" to "Push notifications for this browser" (`SettingsScreen.tsx` ≈:650),
following the operator's directive (§2). Measured at origin/main, one test pins the old label:
`pwa/test/settings-screen.test.tsx` ≈:1771 (`getByText('Phone notifications for this browser')`), which moves with
it. Nothing in `server/test`, README or `CLAUDE.md` spells it. P6's scan covers the new label too. Alert's `does`
text says pushes arrive wherever push notifications are switched on in Settings, which points at that row.

**Test hooks.**
- The hook's injected mode.
- `vi.spyOn(api, 'stallWatch' | 'setStallWatch')`, with an `ApiError(409, …)` rejection carrying a fixture effect
  and key for the confirm path.
- Exported pure helpers, each unit-tested: `stallConfirmLines(effect, request, builtInMs)`, `stallNowLines(view)`,
  `quietChoices(view)`, `fillStallText(text, slots)`, and the two guards, `asStallWatchView` and `asStallConfirm`.
- A new `describe` in `pwa/test/settings-screen.test.tsx` per task, using that file's idiom (≈:46–51 `afterEach`,
  module-level fixtures, `ApiError(501)`/`(404)` rejections, a never-resolving promise for loading).
- `pwa/test/use-stall-watch-view.test.tsx` beside `use-updates-view.test.tsx`.

## 14. Invariants kept, and how each stays true

1. **No marker has a writer in the tree.**
   - The server creates and removes no file.
   - The no-writer pins (`single-definition.test.ts` ≈:4081, ≈:4211) are not edited and must stay green. Their
     `ROOTS` (≈:37) walk `shared`, `server/src`, `pwa/src` and `agent/src` recursively, so the new files are inside
     them. `ROOTS` is module-local, so the control row that proves it lives in `stall-settings.test.ts` and re-walks
     the same four roots (M19); `single-definition.test.ts` stays unedited.
   - No new file spells a marker name on a code line, and none assembles one from pieces.
   - The agent's write scope is unchanged (`whitelist.ts`, `~/.cc-clips` only).
2. **Zero new ccd verbs, and no agent change.** The routes touch `coord.db` and one `readdir` only.
   `EXEC_COMMANDS = ['tmux','ccd']` is unchanged.
3. **`gate-markers-spelled-in-turnidle-only` (`turnidle.ts` ≈:24): the mail-gate marker names stay in `turnidle.ts`
   alone.** The new file calls `mailTurnModeOf` and `mailTurnReadsMark` and never spells a name;
   `stallUnheldBoxOf` finds the strict file by asking `mailTurnModeOf` about each name alone (§10). `stall.ts` gains
   only: the `quietMs` field and its reader; the backoff ceiling; `StallArming.busySince` and the bounded change to
   `stallIdleStart`; and `stallArmHasRung`. None spells a marker. Its single value import stays L0, which
   `stall-vocabulary.test.ts` pins.
4. **L0 imports nothing.** The new `shared/api.ts` members are literals, types and one guard, appended at the end
   of the file (§12).
5. **L1 purity, enforced by its own rows.** No existing scan covers a new L1 file, so
   `server/test/stall-settings.test.ts` carries purity rows in `stall-vocabulary.test.ts`'s idiom (its
   `NODE_BUILTIN`, `SIDE_EFFECT_IMPORT` and `valueImportSpecifiers` shapes): no `node:` import, no `require` or
   dynamic import, no `Date.now` or `new Date`, and value imports only from `../../../shared/api.js`, `./stall.js` and
   `../turnidle.js`, with a CONTROL row proving the scan reads the file. `turnidle.ts` still imports nothing.
   `stallEffectKey`'s hash is plain JavaScript, so the key needs no `node:crypto`.
6. **The mail gate's precedence (strict > busy > busy-shadow > shell)** holds whenever the files decide; a strict
   file still wins under any chosen level, and also holds the wave-2 step off (§6.3).
7. **Kill switches fail shut.** An unlistable registry still stops both sweeps before any resolve.
   `sweepMail`'s `mail-disabled` return is still its first check. `stall-watch-disabled` restores the box arming
   wholesale under every level.
8. **`coord.db` stays synchronous.** The migration refuses to start rather than open empty, columns are additive, and
   the slot is measured.
9. **The box-token and route censuses.**
   - One `SESSION_ONLY` member, with its docstring paragraph and the corrected blind-spot count.
   - `auth-gate.test.ts`'s two pins moved (31 → 33, 89 → 91), and every numeral on a needle line its route-count
     prose block reads moved with the route count: `auth/gate.ts` ≈:8 and `auth-gate.test.ts` ≈:901 and ≈:965
     (86 → 88, the 32 exempt unchanged), and `auth-gate.test.ts` ≈:451 (89 → 91).
   - `coordinator-skill.test.ts`'s `EXEMPT` entries and its forbid-mention case, and a forbid-mention case each in
     `worker-skill.test.ts` and `reviewer-skill.test.ts`.
   - The `CLAUDE.md` sentences updated.

   `UNGATED` is unchanged, and so is every count site's `FOUR`.
10. **Wire discipline.** Additive types. `FLEET_PROTO` is untouched and no frame changes. Each new field has one
    reader: the PWA's `asStallWatchView` for the view, its `asStallConfirm` for the 409 body, and the server's
    `parseStallSettings` for the row.
11. **No overloaded null at a seam.**
    - Absent and unreadable are separate words from the store to the wire, per field, and `stored` tells an absent
      row from an unreadable one.
    - `'default'`, never `null`, means the built-in on the wire.
    - `{measured: false}` is not `off`, and `off` is never read back while busy delivery is on.
    - The SQL column's `NULL` has exactly one meaning and is converted at the store's read.
    - `StallArming.busySince` is absent (today's clock) or a number (when busy delivery began). Absence is the
      `w2-arming-optional` precedent. On the watcher, `lastApplied` is `null` only before the mail sweep's first
      applied mode, and `busySince` is `null` whenever no move into busy delivery has been seen since the server
      started. A failed listing writes neither.
    - The busy gate's `gate` is `null` for one reason only: nothing waits on it.
    - `next.kind` says `none`, `top` or `step`, so "no Next step" and "the top" are two words, not one `null`.
12. **Single definition.**
    - The level texts, the stage texts and every section string are defined once, in L0, with no copy of a stall
      constant's value and no short form of a level label: no `does` text or gate carries a duration (§5), and the
      counts heading takes the window from the wire (§11).
    - The ladder flags are defined once, in L1, and the PWA keeps no ladder knowledge: the server answers the Next
      step, the files-exceed reading and every write's effect (§10, §12).
    - The store's two write arms and their L1 projection, `stallSettingsAfter`, agree, which a store row pins (M12d).
    - The quiet bounds, step and the notice window are defined once, in L1, and shipped on the reply.
    - One predicate, `isStallQuietMs`, serves the write and the read, and one guard, `isStallLevelChoice`, likewise.
    - `STALL_QUIET_MS` stays the one built-in default, and its constants pin is unchanged. The backoff ceiling is
      derived from the constants it guards.
    - The detail heads stay spelled only in `stall.ts`, and the rung table only in `STALL_RUNG_RECIPIENTS`.
13. **The kebab scan.** `'busy-shadow'`, `'confirm-required'` and `'flag-off'` are declared through
    `isStallSettingsKebab`. Every other word is a single word or camelCase.
14. **"Follow" is today's behaviour, with one named exception.** The resolver returns the box arming object itself,
    which a property test pins. At boot the verdicts receive today's exact arming, which a row pins (M4). The one
    change is the busy clock's grace once the mail gate moves into busy delivery while the server runs, under
    `follow` as under a chosen level (§9, `busy-clock-starts-when-busy-delivery-starts`). The backoff ceiling sits
    above the default's 8 h peak, so the default is unchanged there too.
15. **The watch never closes, reclaims or re-dispatches.** That is unchanged. Settings only changes which rungs send,
    when r1 falls due, and when a held mail can read stuck under busy delivery.
16. **Server logs** go through `console.warn('ccrc-server: …')`.
17. **Mutation-table discipline.** Every guard named in §17 ships with a row measured red when it is deleted or
    mutated.
18. **The arming row has one writer, the session-only door.** `setStallSettings(` appears on a code line only at
    its definition in `store.ts` and inside the `POST /api/coord/stall-watch` handler in `coord/routes.ts`. SQL that
    INSERTs into or UPDATEs `stall_settings` appears only in `schema.ts` (the seed) and `store.ts`. A pin in
    `stall-settings.test.ts`, in the caps idiom ("the caps door is the ONE caller of setCaps",
    `coord-caps-route.test.ts` ≈:556–578) but scoped to the handler, holds both (M16b).
19. **A row applies whole or not at all.** No chosen level runs beside an unreadable quiet time, and no chosen quiet
    time beside an unreadable level (§6.2, M25).
20. **Neither sweep can be stopped by the settings path, and the view still answers.** `stallResolveNow` never
    throws, its fallback is today's expression, and its catch calls nothing that can throw. The view builder falls
    back to the files-only reading and the built-in quiet time on a parse or resolver fault, and says so. A fault in
    a view-only reader leaves `next` and `filesExceed` unstated and claims no fallback (§9, §10, M20).
21. **The confirm is the server's.** Whether a write needs a confirm is decided by the POST, at the write, from the
    row as it stands and the row the write will leave, against the listing it just took. Each side is read as it
    resolves now and as it would with the fleet box's kill switch and strict gate removed, so a stage the box holds
    is confirmed when the write arms it, not when the hold lifts. The key ties the confirmation to that effect and
    that row; the store writes only over the row the route measured; and the PWA holds no ladder (§8, §10, §13).

## 15. Failure modes

| Condition | What happens | What the operator sees |
|---|---|---|
| The registry cannot be listed | Both sweeps return before resolving, as today. The GET answers `effective.measured: false`, with no Next step and no files-exceed reading. A POST answers the unmeasured effect, so every write needs the confirm. | "Unknown — the fleet registry could not be read". The chosen values are still shown. Follow reads "(they say: unknown)", and any write opens the confirm with the unknown line. |
| The settings row is absent, or its read throws | Both sweeps follow the fleet box's files and the built-in quiet time, whole. One warn per latch. If the lost choice armed less than the files, every notice it recorded in shadow becomes due and goes out at the next sweep, unconfirmed (`rungDoneAt` ≈:756–764), and r1 re-bases on the 2 h built-in. A write that brings a lost row back is measured against the files, so whatever it turns on is confirmed (§10). A write while the read throws is refused with a 500 by the route's own read, and nothing is written (§8, §10). | The absent or unreadable stored-choice line. The files-exceed line had warned of this while the choice applied. |
| Any throw inside `stallResolveNow` (a store, parse or resolver bug, or one in its latch or boot trace) | Caught. Each sweep runs today's expression over its own listing, with the built-in quiet time, so mail delivery continues at the listing's mode and the lane at the files' arming. The catch warns once, bare, never through the latch, and `lastFallback` records it. The same shadow burst as the row above, when the choice armed less than the files. | The fallback line, "Your choice is not being applied (<reason>); the watch is following the fleet box's files and the built-in quiet time.", from `watcher.stallFallback()` or the view builder's own catch, over a Now block that shows the fleet box's files and a quiet time that reads the built-in (§10). |
| A view-only reader throws in the view builder (`stallNextStep` or `stallFilesExceed`, which the sweeps never call) | The sweeps are unaffected and apply what they resolved. The GET answers 200 with no `fallback`, and with `next` and `filesExceed` left out (§10). | No Next step and no files-exceed line; no fallback line. |
| The level token is out of vocabulary (a newer build wrote it, then a rollback), or a prototype name such as `constructor` | `unreadable`, so the row does not apply: the files and the built-in quiet time, even when the stored quiet time reads. The same shadow burst when the files arm more. | The stored-level line. No radio is checked. |
| The stored quiet time fails `isStallQuietMs`, or is an integer too large for a JS number | `unreadable` (the read itself survives an oversize integer, through `setReadBigInts`), so the row does not apply: the files and the built-in, even when the stored level reads. It is never clamped. If the stored level armed less than the files, every notice the files' arming recorded in shadow becomes due and goes out at the next sweep, as in the absent-row row. | The stored-quiet-time line. The files-exceed line had warned of this while the row applied. |
| Both stored fields read unreadable in a row that reads | The row does not apply: the files and the built-in quiet time, with the same shadow burst when the files arm more. | The stored line for both fields. No radio is checked. |
| A hand-edited `updatedAt` that is not a safe integer | It parses `null`; nothing else changes. | The section renders as usual. |
| Rollback to a build without the table (a hand rollback, or the unattended `ccrc rollback --from watchdog` on a `server`/`both` box) | The older build reads `coord.db` at the higher version as-is and migrates nothing (`openCoordDb`, `db.ts` ≈:171–179), and ignores the table. The choice, `off` included, stops applying, and the watch re-arms from the fleet box's files with the built-in quiet time. Every notice a lower choice recorded in shadow then goes out at the first sweep: checks to quiet workers and cap pushes at once, coordinator reports an hour later. In the watchdog's case no one is present. | An open tab's next poll (within 60 s) answers 404 `not-found`, and the section's body becomes the not-available text, with no control and no checked radio (§13). The service worker loads the older bundle within 15 min, or on return to the foreground, and the section is gone. The files-exceed line had warned beforehand. After a roll-forward the stored choice applies again, and the boot trace logs it. |
| `coord.db` is lost or restored from an older snapshot | The choice is lost or reverts; the watch follows the files or the older choice. A loss of a choice that armed less than the files sends the shadow backlog, as above. | The section shows what is stored now, and the boot trace logs a restored choice. For a stop that survives this, the fleet box's kill switch (Off's own text says so). |
| A roll-forward brings back an old choice over box files touched while the section was gone | The old choice overrides those files (kill files and strict excepted). Where it arms more than the files did meanwhile, every rung the files recorded in shadow becomes due at the next sweep. | The boot trace line; "Chosen here" and "they say: …"; the files-exceed line when the files arm more. |
| A migration slot collides with another branch | Two entries at one version: the second never runs on a database already past it. | Prevented by measuring the slot at the first step, before the PR and before merge (§8). |
| `CCRC_AUTH` is unarmed on a publicly reachable box | Anyone who reaches the server, a fleet session included, can set the level or the quiet time. This is the same exposure as caps and every PWA write. | The existing red unarmed-exposure banner on Settings, and the feed row's `by flag-off`. Arming auth is the remedy; no skill names the door (§10). |
| A level is chosen and the operator also hand-touches files | The files are ignored, except the kill files and strict. A README runbook's "`rm` … goes back" step is then inert, which W1's qualified runbook text says (§18). | `effective.source: 'chosen'` and the "they say: …" files reading show the difference, and the files-exceed line when the files arm more. |
| Busy delivery armed by file (R18's order), then a level below Deliver chosen in Settings | Busy delivery turns off: the chosen level decides the mail mode. | The confirm listed "Busy delivery stops." first. The source line shows "Chosen here"; "they say:" shows the files' level. |
| After that, Off is chosen | Off leaves the mail gate as the files set it (Q2), so busy delivery turns back on. | The confirm said "Busy delivery turns back on: the fleet box's files arm it." Now reads Custom, with busy delivery among the stages on, and no Next step. |
| A level is chosen before its gate is met | The stage's known false classes go live: for example the stuck-mail and coordinator-not-reading pushes under `all`, which R18 measured at 0/4 and 0/1. | The confirm showed the gate of every stage turning on. Lowering takes effect at the next sweep. |
| A chosen level other than Off under `mail-gate-strict` | Strict wins the mail gate, so the busy gate is off; for `all` the wave-2 step is held off too (strict switched busy delivery off). | "Chosen: <label>, held back by the fleet box (its mail gate is set to strict)" and the strict held lines. A chosen `deliver` or `all` reads Alert and shows no Next step; a lower level keeps its reading and its Next step. |
| A chosen level other than Off under the lane's kill file | The lane does not run, and the mail gate runs as the files set it. | Reads Off (or Custom), with "Chosen: <label>, held back by the fleet box (its kill switch is on)", the kill-switch held line, and no Next step. |
| A chosen Off under the lane's kill file, with or without a box busy file | Off and the kill file do the same thing; the mail gate runs as the files set it. | "Chosen here", because no held flag changed what Off does. Reads Off, or Custom over a busy file. |
| A level raised while the lane's kill file or `mail-gate-strict` holds it (for example Check to Everything under the kill file, or Alert to Deliver under strict) | The write is measured on the unheld reading too, so it needs the confirm (§10). The stages stay held. Once the file is removed by hand they apply at the next sweep, with no second confirm. | The confirm lists the held stages with their gates, then "Held by the fleet box until its kill switch or strict gate is removed; it applies then without asking again." |
| Mail is switched off, and a write turns on checks or alerts, or lowers the quiet time | Pushes to you now due go out at the next sweep, ones recorded in shadow included, because `stallMailDisabledHold` (`stall.ts` ≈:813) passes them. Checks and reports to workers and coordinators are held until mail is back. | The confirm's mail-off due and quiet lines (§13). The `mailOff` held line. |
| Box files set by hand to escalation + wave-2 without busy delivery | Today's behaviour (the files decide). | The hazard line (§6.4). |
| The level is raised mid-episode | At the next sweep every notice now due is sent, including ones recorded in shadow (`rungDoneAt` ≈:756–764 counts a shadow row as done only while that rung's delivery is still shadow). Later rungs follow on their own clocks: a check re-sent live times the next report an hour from itself (`stallWaveOneLadder` ≈:922), so from Log the report and the push come an hour apart, not at once. Each run gets one verdict per sweep. Nothing already sent live is sent again. | The confirm's `due` line said so. |
| The level is raised from Off | Off recorded nothing: the lane returns before it records (`watch.ts` ≈:3789). At the next sweep every worker already quiet past the quiet time is checked, and at Alert and above a run whose check went out before Off gets its coordinator report at once. | The confirm's `dueFromOff` line. |
| The level is lowered out of Everything | The further checks stop, and the worker's ball returns to wave 1's ladder, with no back-off and no delegates or restart-grace hold (§5.1). A worker already quiet past the plain quiet time gets a check at the next sweep; at Alert or Deliver, a worker whose check is over an hour old gets its coordinator report. | The confirm listed the further checks' `stops` line. |
| Busy delivery begins while the server runs: a chosen level, Follow over a box busy file, or `mail-gate-busy` touched by hand | Until the mail sweep has applied busy once after a non-busy mode, busy is judged as the busy gate is; after that the stuck-mail clock under busy starts at `max(stop, busySince)` (§9). A held mail gets the full `MAIL_STUCK_MS` from the moment busy delivery began. For Follow and a hand-touched file this changes today's behaviour, which could push a false stuck mail during the first busy pass. | Nothing extra: no false stuck-mail push during the first busy pass. |
| The registry listing fails between two busy mail sweeps | Neither clock field moves, so `busySince` keeps its first value and mail-stuck is not deferred again. | Nothing. |
| The server restarts with busy delivery on | `lastApplied` starts `null`, so the stall sweep judges exactly as today: no grace, and no delay. | Today's behaviour: a mail held past `MAIL_STUCK_MS` before the restart can read stuck at the first stall sweep after it. |
| The quiet time is lowered (for example 2 h to 30 min) | The next sweep makes every worker quiet past 30 min due at once; at `alert` and above, every dialog open longer than 30 min also falls due for a push to you. Below Everything a worker in a long legitimate wait is then checked once per quiet time: about 48 checks a day at 30 min against 12 at 2 h, each a worker turn and a coordinator turn. A restamped dialog can be re-pushed every 30 min (§7). | The confirm said so first, with the dialog-push line when alerts are on. The remedy is to set the quiet time back to the built-in, not to lower the level. The parent spec's kill rule (more than 10 armed r1 a day for two days) reads the "Stall checks to quiet workers" row. |
| A write that makes a stored choice apply: a level written over a stored quiet time that did not apply, or a quiet time written over a stored level that did not | The effect is measured on the row the write will leave, so the stored half that comes into force is part of it (§10). | The confirm, with the stage lines or the quiet lines the other half brings. |
| Two Settings pages write at once | Each write is one transaction, and the last one wins. Each reply re-reads, and the feed records both, each with its actor. A confirm is decided by the server at the write, and its key carries the row's `updatedAt`, so a write that lands between one page's sheet and its re-POST makes that page's key stale. | The second page gets a fresh sheet for what its write now does. The next poll shows the final value on both pages. |
| The confirm's key no longer matches (another page wrote, or the fleet box's files moved, while the sheet was open) | Nothing is written. The POST answers 409 again with the fresh effect and key. | A fresh sheet. |
| The row changes outside the server between the POST's read and its transaction (a hand edit of `coord.db`) | The store finds a different row and answers `conflict` without writing (§8). The route measures once more on the row it found: 409 with the fresh effect when that needs a confirm, otherwise the write. A second conflict is refused with a 500, and nothing is written. | A fresh sheet, a settled write, or the refusal toast. |
| The feed archive write fails | The setting is written and the record degrades, with a warn, and the flush still runs. | No feed row for that change. |
| A write's reply cannot be read | It may have landed. | "Saved — the server's answer could not be read; the screen will re-check." Then a reload. |
| A newer PWA meets an older server | The GET answers 404 `not-found`. | The not-available text, whether or not a view had landed (§13). |
| The notice-count read throws, or L1 counting throws | `notices.ok: false`. The rest of the view stands, with 200. | "The notice counts could not be read." |
| A stored observation row whose arm lacks that rung (a newer build's rung, then a rollback; or a hand edit) | `stallArmHasRung` answers false and the row is skipped. | The counts, without that row. |
| The busy gate under `log`, `check` or `alert` | The mail sweep reads the turn marker for each due row (one agent read each), holds a `shell` session whose current marker reads `working`, which the default mode delivers, and logs one line per busy row it would deliver. It never logs a held `shell` row. On a box whose files leave the gate off, choosing one of these levels turns it on. | The busy gate's Now sentence; the confirm when it turns on; log volume as today's armed `mail-gate-busy-shadow`. |

## 16. Departures from the approved text (slugs; numbered at plan time)

- `files-level-match-ignores-the-busy-gate` (renamed from rev 3's `files-level-match-ignores-the-busy-log`): reading a
  level back treats `shell`, `busy-shadow` and `strict` alike, so the busy gate never splits a level; a fresh install
  reads "Log only", with the busy gate off. `stages.busyGate` reports it separately, and the Now block says when a
  level read from the files runs without it (§6.4, Q1).
- `strict-holds-the-wave-2-step`: under `mail-gate-strict`, a chosen level's wave-2 step is held off, because strict
  switched busy delivery off (§6.2).
- `busy-clock-starts-when-busy-delivery-starts` (renamed from rev 2's `stall-sweep-reads-the-applied-mail-mode`,
  which is dropped; reworded in rev 3.1): when the mail gate moves into busy delivery while the server runs, from a
  mode the mail sweep applied, the stall sweep judges busy as the busy gate until busy delivery has been applied once,
  and then bounds mail-stuck's idle clock to `max(stop, busySince)`. The rule is the same under `follow` and under a
  chosen level, so a raise by Follow or by a file touched by hand gets the grace too, which changes today's
  behaviour there. At boot the clock is today's; a failed listing or the `mail-disabled` return moves neither field,
  so the grace already granted is kept and is not restarted (§9, goal 4).
- `backoff-ceiling-from-the-horizon`: the computed working-reply backoff is capped at 16 h, derived from the mail
  read's horizon, so the approved 12 h maximum cannot push the ladder out of its own read (§7).
- `quiet-half-hour-steps`: the server accepts only 30-minute steps in range, one rule with the PWA's list (§7).
- `counts-by-role` (renamed from rev 2's `counts-per-rung-by-recipient`): the approved "per rung" counts become four
  rows by role (checks to quiet workers, notices a session gets about its own work, reports that may reach you
  instead, pushes to you), because the observation row records no recipient and the verdict can override the rung
  table (§11).
- `run-events-at-index`: the migration adds `run_events_by_at`, unconditionally; the measured plan uses it, and a
  pinned `EXPLAIN QUERY PLAN` row keeps it used (§8).
- `unknown-keys-refused`: the POST refuses an unknown key, following update intent rather than caps (§10).
- `no-coord-mutex-for-stall-settings`: one synchronous transaction instead of caps' mutex (§10).
- `no-op-write-records-no-feed-event`: a write that changes no named field skips its `UPDATE`, so `updatedAt` does
  not move, and records no feed event (§8, §10, Q4).
- `stages-on-the-wire-not-modes`: the reply carries derived booleans, never `MailTurnMode` words (§12).
- `older-server-404-reads-not-configured`: the PWA reads a 404 `not-found` as "not available on this server", and
  that answer replaces a landed view rather than sitting under it (§13).
- `confirm-on-stage-diff`: the approved "raising the level asks for a confirm that shows the gate text" becomes a
  confirm on what a write turns on, now or once the fleet box's kill switch or strict gate is removed, on leaving the
  further checks, and on a quiet time brought below the current one or the built-in; each gate belongs to the stage
  it guards, and the sheet also lists what stops (§5.1, §13).
- `server-decides-the-confirm`: the POST works out what a write does, from the row as it stands and the row the write
  will leave, against the listing it just took, and refuses a write that needs a confirm with 409
  `confirm-required` until the body carries the matching key. The store writes only over the row the route measured,
  and answers `conflict` otherwise. The PWA holds no ladder and previews no choice; it renders the sheet from the
  server's effect and sends the key back (§8, §10, §13).
- `notifications-label-says-push`: W2 renames the existing Notifications row to "Push notifications for this
  browser", which rev 2 had left out of scope (§4, §13, Q10).

## 17. Testing and the mutation table

**Suites.**
- **New:**
  - `server/test/stall-settings.test.ts`, the L1 suite: the ladder and its type, the resolver (the whole-row mixed
    cases and `levelSource` included), decide, parse (prototype names, `bigint`, `updatedAt`), `isStallQuietMs`,
    `isStallLevelChoice`, `stallStages`, `stallNextStep`, `stallFilesExceed`, `stallSettingsAfter`,
    `stallUnheldBoxOf`, `stallWriteEffect` with `stallNeedsConfirm` and `stallEffectKey`, `stallBusyClock`,
    `stallSettingsChange`, the
    counts by role and `stallArmHasRung`, and the purity rows. It also holds two source scans: the control row
    proving the new files sit inside `single-definition.test.ts`'s four walked roots, and the single-writer pin (§14
    item 18).
  - `server/test/stall-settings-store.test.ts`: migration, seed, store reads and writes, the insert arm's seed
    defaults, the no-op skip, the expected-state `conflict`, the projection's agreement with the store, the
    `setReadBigInts` reads, the window boundary, and the `EXPLAIN QUERY PLAN` row.
  - `server/test/stall-settings-route.test.ts`: both halves, the 409 and its key, the conflict's second measure and
    the refusal on an unreadable read, the feed with its actor, refusals, the re-read, the reported fallback with its
    built-in quiet time, a really throwing resolver answering 200, a throwing view-only reader answering 200 with no
    fallback, a counting throw answering 200, and the handler's device scan (M29).
- **Extended:**
  - `stall-sweep.test.ts` (M4's row, M8, M8a, M9c), `mail-sweep.test.ts` (the resolved mode, `lastApplied` and
    `busySince`, never throws), `stall-session.test.ts` (the busy clock, beside the `gate-held-mail-is-not-stuck`
    describe ≈:777), `stall-verdict.test.ts`, `stall-backoff.test.ts` (the ceiling and the relation pins);
  - `coord-pause-route.test.ts` (member, docstring), `auth-gate.test.ts` (the two pins and the three needle
    numerals), `coordinator-skill.test.ts` (`EXEMPT`, forbid-mention), `worker-skill.test.ts` and
    `reviewer-skill.test.ts` (forbid-mention), `mail-routes.test.ts` (kebab union);
  - `coord-db.test.ts` (version pins; the two whole-diff tests narrowed to their own entries; the new entry's own diff
    test) and `asks-store.test.ts` (version pin);
  - PWA: `settings-screen.test.tsx` (the new section, and the renamed label at ≈:1771),
    `use-stall-watch-view.test.tsx`, and `primitives.test.tsx` (`QuickConfirm`'s list form).
- **Run green and unedited:** `single-definition.test.ts`, `box-token-census.test.ts` (after the `CLAUDE.md` edit),
  `stall-vocabulary.test.ts`, `turnidle.test.ts`, `pools-prose.test.ts` (the README size claim stays within 100
  lines), and `session-hook.test.ts`: the README citation instrument's seven rows, the README census entry that must
  stay empty (≈:8674), and the per-file census (`'shared/api.ts': 1` ≈:8493, `'server/test/single-definition.test.ts':
  8` ≈:8526).
- **The plan's verification step** re-runs `session-hook.test.ts` after the L0 block is appended and the README is
  edited. The append at the end of `shared/api.ts` (§12) is what keeps it green; a placement above ≈:7684 would move
  README ≈:4586's anchors and red it.
- Server suites run per package in the foreground, `./node_modules/.bin/vitest run test/<file>`, timeout of at least
  600000 ms.
- Every server suite is hermetic: fixture HOMEs only, and no `ccd` against a live `$HOME`.

**Mutation table outline.** Each row is measured red before and after, and a comment does not count.

| # | Guard | Mutation | Red in |
|---|---|---|---|
| M1 | The lane's kill file restores the box wholesale | Drop the `box.disabled` arm | stall-settings (chosen `deliver` plus a disabled box gives the box's mail mode, never `busy`, and `levelSource` `held`) |
| M1b | `off` is never read while busy delivery is on | Return `off` on `disabled` alone | stall-settings (chosen `off` or disabled box with box mode `busy` reads `custom`) |
| M2 | `mail-disabled` passes through | Set `mailDisabled: false` in the chosen arm | stall-settings, stall-sweep (a held rung under a chosen level) |
| M3 | Strict keeps its precedence | Use `row.mailMode` unconditionally | stall-settings, mail-sweep (strict plus chosen `deliver` delivers no `busy`) |
| M3b | Strict holds the wave-2 step | Drop `&& !strict` | stall-settings (chosen `all` under strict gives `w2Live` false and `wave2HeldByStrict`) |
| M4 | "Follow" is today's behaviour at boot | Return a rebuilt object, or alter any field; or let `stallBusyClock` substitute or bound while `lastApplied` is `null` | stall-settings property test over all 2^8 file combinations: the resolved arming equals today's expression; stall-sweep, at boot with the fleet box's files on busy delivery, and again with `mail-disabled` present: the verdicts receive today's exact arming, with no `busySince` key |
| M5 | `custom` | Map no-match to the nearest step, or let `off` take part in step matching | stall-settings (escalate without live gives `custom`; a running arming with no flags reads `log`, never `off`) |
| M6 | Unknown is never off | Map a `null` listing to `off` | stall-settings-route (the GET answers `measured: false`; a POST answers 409 with the effect `{ measured: false }`), PWA (the "Unknown" line, "they say: unknown", and the sheet's one `unknown` line) |
| M7 | `sweepMail` uses the resolved mode | Revert to `mailTurnModeOf(listing)` | mail-sweep (chosen `deliver` with no busy file delivers on `busy`; chosen `off` keeps the box's mode; on a box with no files, chosen `log` holds a live `shell` row over a current `working` marker `not-idle`, which `follow` delivers) |
| M8 | The busy clock | Drop the bound (use `m.stopAt` under `busy` whatever `busySince` says); drop `stallBusyClock`'s busy-gate substitution; or grant the grace to a chosen level only | stall-sweep interleaving, three raises, each while a mail has been held over 72 min: a chosen `alert` → `all`; Follow from a chosen `alert` over files armed for Everything; `mail-gate-busy` touched by hand under `follow`. In each the mail sweep applies `busy` at T; a stall sweep before T and one at T + 1 s send no mail-stuck; at T + `MAIL_STUCK_MS`, the mail still undelivered, mail-stuck is judged. stall-session: `busySince` absent under `busy` gives the stop; a number gives `max(stop, busySince)`; `busy-shadow` gives stop + `DELEGATE_CAP_MS`. stall-settings: `stallBusyClock` over each of its three answers |
| M8a | One resolver for both sweeps | Give one sweep its own mapping | A shared fixture drives both sweeps from one listing without `mail-disabled` and one stored row, for every choice and for `follow`: the two `stallResolveNow` answers are equal; the mode the mail sweep applies equals the answer's `arming.mailMode`; the verdicts' arming differs from the answer only in `mailMode` and `busySince` |
| M8b | The clock fields move only on an applied mode | Clear either field on the null-listing or `mail-disabled` return; restart `busySince` on `busy` over `busy`; or leave it set after a non-busy mode | mail-sweep (busy applied at T1, a null listing, busy again: `busySince` stays T1. Busy at T1, then `busy-shadow`, then busy at T2: `busySince` is T2. A restart: both fields `null`, and the first `busy` leaves `busySince` `null`) |
| M9 | The quiet time reaches all three uses | Revert any one site to `STALL_QUIET_MS` | stall-verdict (r1 and the dialog cap at a chosen 30 min and 12 h), stall-backoff (base times 1, 2, 4) |
| M9b | The backoff ceiling | Drop the cap, or raise the ceiling past its relation | stall-backoff (12 h quiet with streak 2 gives 16 h; the four relation pins in §7) |
| M9c | `watch.ts` threads the chosen quiet time | Delete `quietMs` from `judgeStall`'s input literal | stall-sweep (stored `quietMs` 30 min; a worker quiet 31 min; under `log`, an r1 shadow row is recorded) |
| M10 | Bounds and step are refused, never clamped | Clamp, widen by one step, or accept a non-step | stall-settings (29 min, 45 min and 12 h 30 min refused; 30 min and 12 h accepted); route (the stored value equals the sent value) |
| M11 | One predicate for write and read | Give `parseStallSettings` its own range check | stall-settings (one table of values fed to both; `1800000.5` and a TEXT value read `unreadable`) |
| M11b | One level guard, own keys only | Rewrite `isStallLevelChoice` with `in` or `MAP[v]` | stall-settings (`constructor`, `toString`, `__proto__` and `hasOwnProperty`: decide refuses with 400, parse reads `unreadable`) |
| M11c | Oversize and non-integer values read per field | Drop `setReadBigInts(true)`, or type `updatedAt` as a number and pass it through | stall-settings-store (an oversize `quietMs` reads `quietMs` `unreadable` with the level still read; `updatedAt` `'abc'` reads `null`) |
| M12 | The seed and the insert arm are today's behaviour | Seed any level or quiet time; insert a quiet-only patch with another level | stall-settings-store (`follow`/`NULL`; delete the row, POST `{quietMs}` alone, level reads `follow`), stall-sweep (an unchanged verdict with the migrated database) |
| M12b | A no-op write moves nothing | Always run the `UPDATE`; or compare a stored `bigint` with the patch's number as read | stall-settings-store (the same patch twice leaves `updatedAt` unchanged and `before` equal to `after`, a quiet-time patch included, whose stored value reads as a `bigint`) |
| M12c | The update arm keeps a stored level it was not asked to write | Rewrite the level on a quiet-only write | stall-settings-store (an unreadable stored level stays unreadable after `{quietMs}` alone) |
| M12d | The projection is the store's write | Let `stallSettingsAfter` seed another default, or rewrite the field it was not given; or let the store write over an unreadable read | stall-settings-store (for an absent row, a row, a row with an unreadable level and a row with an unreadable quiet time, and each kind of patch: `setStallSettings`' `after` parses equal to the parsed projection; with the store's read made to answer `unreadable`, the write throws and the row is unchanged) |
| M13 | The reply re-reads | Echo the body | stall-settings-route (a write racing a second write answers the stored value) |
| M14 | Unknown key or empty body refused | Ignore unknown keys | stall-settings-route (400 names the key) |
| M15 | Feed event on a change of level or quiet time only, flush in `finally`, actor named | Compare whole reads (with `updatedAt`); move the flush into the `try`; drop the actor | stall-settings-route (the same body POSTed twice gives one feed row; a throwing `recordFeedEvent` still flushes; the body ends `by flag-off` unarmed and `by device:<label>` armed) |
| M15b | `stallSettingsChange` names a non-row `before` | Compare `before.row?.level` | stall-settings (a lost row restored by a quiet-only write gives `level: no stored choice → …` rather than `undefined`, and a body rather than `null`) |
| M16 | Censuses | Drop the `SESSION_ONLY` member, the `CLAUDE.md` path, the `EXEMPT` entries, or any forbid-mention case; leave the route counts or any needle numeral | coord-pause-route, box-token-census, auth-gate (31/89 pins; gate.ts ≈:8, ≈:901, ≈:965, ≈:451), coordinator-skill, worker-skill, reviewer-skill |
| M16b | The arming row has one writer | Plant a second `setStallSettings(` call, in another file or in another handler in `coord/routes.ts`; or a second `UPDATE stall_settings` | stall-settings (the single-writer pin, with a control row proving the scanner sees the definition in `store.ts`) |
| M17 | Counts: live versus shadow, run-bound only, by role | Swap the modes; count unparsed rows; tally quiet rung 1 under `wakes`, or tally by rung number | stall-settings (a transition row is ignored; quiet rung 1 counts as `checks`; orphan E rung 1 as `wakes`; frozen rung 1 as `reports`; a dialog-cap row as `pushes`) |
| M17b | A rung the arm lacks is skipped, and counting never fails the reply | Call `rungRecipient` without `stallArmHasRung`; remove the builder's `try` | stall-settings (a planted `stall:dialog-cap:2:…` row is skipped), stall-settings-route (the view still answers 200; a throwing count gives `notices.ok: false`) |
| M17c | The window boundary | Use `>` for `>=` | stall-settings-store (rows at `since` and `since - 1`: only the first comes back) |
| M17d | The index serves the count read | Drop `run_events_by_at` from the migration | stall-settings-store (the pinned `EXPLAIN QUERY PLAN` row no longer reads `USING INDEX run_events_by_at`) |
| M18 | Kebab declaration | Remove `isStallSettingsKebab` from the scan, or drop one of its three words | mail-routes (`busy-shadow`, `confirm-required` and `flag-off` each red when undeclared) |
| M19 | No marker name in new code | Spell a marker in a gate text | single-definition (the existing pins, unedited), stall-settings (the control row: the new files sit inside the four walked roots) |
| M19b | L1 purity of `stallsettings.ts` | Add a `node:fs` import, a `Date.now()`, or a `db.js` value import | stall-settings purity rows |
| M20 | `stallResolveNow` never throws, and the view still answers | Remove its try/catch; call the latch from the catch; compose `reason` outside its inner `try`; remove either of the view builder's `try`s, or fold the view-only readers into the first; or report the resolved quiet time under a fallback | mail-sweep (a throwing `store.stallSettings`, a throwing resolver, a throwing latch, and an error whose `message` getter throws: each still lets `sweepMail` deliver at the listing's mode); stall-settings-route (with `resolveStallWatch` replaced, through the module mock, by one that really throws for a chosen row, and no watcher: the GET answers 200 with `fallback` set from the builder's own catch, `effective.source` `files`, and `quiet` the built-in with source `default`; with a stored 30 min that resolves and a watcher whose `stallFallback()` is set: `quiet` the built-in with source `default`; with `stallNextStep` made to throw: 200, `fallback` `null`, and `next` and `filesExceed` left out) |
| M20b | The fallback clears | Never reset `lastFallback` | mail-sweep (a throw, then a resolution that succeeds: `stallFallback()` reads `null`) |
| M21 | The warn latch | Warn on every read; or never re-arm | mail-sweep (an unreadable row warns once across many sweeps; a read that applies, then a second failure, warns again) |
| M22 | `stallStages` | Derive `busyDelivery` or `busyGate` from the mode alone; or read `busyGate` from `busy-shadow` only | stall-settings (`busyGate` true under `busy` and under `busy-shadow`; with `mailDisabled` both mail-gate stages read false; under strict both read false) |
| M23 | The held flags, and `held` only when a flag changed what the choice does | Drop any of `watchOff`, `mailOff`, `gateStrict`; report `chosen` under strict; or set `held` whenever a flag merely stands | stall-settings (each flag alone; chosen `deliver` under strict reads `alert` with `levelSource` `held`; chosen `check` under strict reads `check` with `held`; chosen `off` under the kill file, with and without a box busy file, stays `chosen`) |
| M24 | The hazard line | Drop its condition, or its `mailOff` exception | settings-screen (files arming alerts and the further checks without busy delivery show it; with busy delivery they do not; under `held.mailOff` they do not) |
| M25 | A row applies whole | Resolve field by field | stall-settings (level unreadable with a set quiet time: built-in quiet time and the files; level chosen with an unreadable quiet time: the files, not the level) |
| M26 | The server decides the confirm | Drop any arm of `stallNeedsConfirm`; build the after side from the row as it stands rather than from `stallSettingsAfter`; let `mailDisabled` into the comparison; or compare the resolved readings alone | stall-settings (each needs a confirm: a stage turning on; leaving the further checks; a quiet time brought below the current one, and one brought below the built-in; an absent row with the files at Check and a write of `all`; a stored `all` with an unreadable quiet time and a quiet write of 3 h; an unreadable level with a stored 30 min and a write of Follow; `mail-disabled` with Alert → Deliver; the lane's kill file with Check chosen and a write of `all`, with `heldByBox` set; `mail-gate-strict` with Alert chosen and a write of `deliver`, whose `turnsOn` lists `busyDelivery`, with `heldByBox` set. Neither needs one: a pure lowering; Deliver → Alert over a box busy-shadow file); stall-settings-route (each needing arm answers 409 and writes nothing) |
| M27 | The key ties the confirm to the effect and the row | Accept any `confirm`; or leave `updatedAt` out of the digest | stall-settings-route (a 409, then another page's write, then the first page's re-POST with its old key: 409 again with the fresh effect, and nothing written by it; a matching key writes; a body that needs no confirm writes without one) |
| M27b | The store writes only over the row the route measured | Drop the expected-state compare; compare `updatedAt` alone; or let the route go on past its own `unreadable` read | stall-settings-store (a row whose level a second connection changes, `updatedAt` kept, between the route's read and the transaction: `conflict`, nothing written); stall-settings-route (a store whose first read answers `unreadable` and whose next answers a row: 500 and nothing written; a conflict whose fresh effect needs a confirm: 409 with that effect and its key; one that needs none: written) |
| M28 | Files-exceed compares sending stages only | Compare all five stages, or include `busyGate` | stall-settings (box `stall-watch-live` plus `mail-gate-busy-shadow` with a chosen `deliver`: `filesExceed` false; files at Alert with a chosen `check`: true; the same in the effect's after state) |
| M29 | The handler never branches on the device label, and new server prose names no device | Add a branch on `sessionAuth(req).device`; or write the device word the old Notifications label began with into a new comment | stall-settings-route (the POST handler's slice of `coord/routes.ts`, comments stripped and `deviceActor(sessionAuth(req).device)` removed, holds no `device` token; the handler's slice with its docstring, and `stallsettings.ts`, hold no device word), with a control row proving the slice is not empty |
| M30 | `stallNextStep` | List the busy gate in `waitsOn`; or answer a step when the reading differs from the choice | stall-settings (files with no gate file reading `log`: a step to `check` waiting on checks alone; chosen `deliver` under strict: `none`; `all`: `top`) |
| P1 | Three-state render | Collapse `failed` into the skeleton | settings-screen |
| P1b | Not-configured wins over a landed view | Render the landed view first, as the Updates section does | settings-screen (a landed view, then a 404 `not-found` poll: the not-available text, no radio checked) |
| P2 | Checked from the server | Check from the tap | settings-screen (a refused write leaves the old radio checked) |
| P3 | The confirm comes from the server | Decide a confirm in the section; send anything on Cancel; re-POST without the key | settings-screen (a 409 opens the sheet from its effect; Cancel sends nothing more; Set re-POSTs the same body with `confirm` equal to `effectKey`, and the 2xx settles; a write answered 2xx at once opens no sheet) |
| P3b | Off over a busy file says busy delivery comes back | Use the generic turn-on line | `stallConfirmLines` unit (an effect with `busyDelivery` turning on and `after.runs` false: "Busy delivery turns back on: the fleet box's files arm it.") |
| P3c | A stale key opens a fresh sheet | Treat a second 409 as a refusal, or keep the first effect | settings-screen (Set answered by a second 409 with a new effect: the sheet shows the new lines, and the next Set carries the new key) |
| P3d | The lines say what the write does | Show `due` for busy delivery alone; drop the due group under `mailOff`, or show its mail-on lines there; word the quiet line the same whatever runs after, or the same with mail off; drop the dialog line; drop the held line, or give a held stage `backOn` or a due line | `stallConfirmLines` units (busy delivery alone: `dueMail`, not `due`; checks from a running watch: `due`; from Off: `dueFromOff`; a lowered quiet time with the watch off, at Log, at Check and at Everything after the write: `quietOff`, `quietRecorded`, `quietDue`, `quietDueAll`; with alerts on: `quietDialogs`. Under `mailOff`: a raise from Check to Alert gives `dueMailOff`, not `due`; Log to Check gives `dueMailOffHeld`; busy delivery turning on gives `dueMailBack`; a quiet time lowered at Check gives `quietDueMailOff`, and `quietRepeatMailOff` below the built-in; at Everything, `quietDueAllMailOff`; with alerts on, `quietDialogs` unchanged. An effect with `heldByBox` and stages turning on only in the unheld reading under the kill file: their `turnsOn` lines, then the held line, and no `backOn` and no due line) |
| P4 | Settle wins over a stale poll | Drop the generation bump in `settle` | use-stall-watch-view |
| P5 | The run-less footnote is always shown | Hide it when counts are zero | settings-screen |
| P6 | No device word, no device branch | Add a `matchMedia` branch, or the word the old Notifications label began with | a source scan of `StallWatchSection.tsx`, the L0 `STALL_*` strings and the renamed Notifications row label |
| P7 | Only 501 `not-configured` and 404 `not-found` read not-configured | Map every 404, or every 501 | use-stall-watch-view |
| P8 | `QuickConfirm` renders a list | Join the lines into one string | primitives (`consequence` as an array renders one `<p className="qc-consequence">` per line; a string renders one) |
| P9 | The section spells no level id, and the busy-gate-off note names only its own cause | Hard-code a level list for the busy-gate-off note; or drop its `mailOff` exception | a source scan of `StallWatchSection.tsx` finds no `StallLevel` literal; settings-screen (a files-read `log` without the gate shows the note; a chosen level under strict does not; a files-read `check` over the busy-shadow file with `held.mailOff` does not) |
| P10 | The held source and the Next step render from the wire | Render `held` as "Chosen here"; render a Next step for `next.kind` `none` | settings-screen (a `held` source shows "Chosen: <label>, held back by the fleet box (<reason>)"; `none` shows no Next step; a `step` with an empty `waitsOn` shows no "Waits on:") |
| P11 | The files-exceed line follows `effective.filesExceed` | Drop it, or show it whenever the source is not `files` | settings-screen (true shows it; false under a chosen level does not) |
| P12 | The stored and fallback lines | Drop the `both` line or any other stored line; or drop the fallback line | settings-screen (each of the five stored lines for its case; a non-null `fallback` shows the fallback line) |

## 18. Waves (a new programme, `stall-watch-settings`)

The ledger lives at `docs/superpowers/programs/stall-watch-settings.md`. D-numbers are allocated by the coordinator
from `POST /api/ledger/deviations` when the plan is written.

- **W1: server (deploy class: server).**
  - The migration, at the measured next slot, with the index.
  - Store methods: `stallSettings` (read with `setReadBigInts(true)`), `setStallSettings` (with the no-op skip,
    compared after the `bigint` conversion, and the expected-state check that answers `conflict`),
    `stallObservationsSince`.
  - L1 `server/src/coord/stallsettings.ts`: `StallLadderRow` and `STALL_LADDER`, `stallBoxArmingOf`,
    `stallUnheldBoxOf`, `isStallQuietMs`, `parseStallSettings`, `resolveStallWatch`, `stallLevelOf`, `stallStages`,
    `stallNextStep`, `stallFilesExceed`, `stallSettingsAfter`, `stallWriteEffect`, `stallNeedsConfirm`,
    `stallEffectKey`, `stallBusyClock`, `stallSettingsChange`, `decideStallSettings`, `stallNoticeCounts`, the
    bounds, step and window constants, and `isStallSettingsKebab` with its three words.
  - `stall.ts`: `StallInput.quietMs`, `stallQuietMs`, the three use sites, `STALL_BACKOFF_CEILING_MS` in
    `stallBackoff`, `StallArming.busySince` and the bounded `stallIdleStart` change (§9), `stallArmHasRung` (§11), and
    the comment rewording (§7).
  - `watch.ts`: both sweeps, `lastApplied` and `busySince`, `lastFallback` and its public read `stallFallback()`,
    `stallResolveNow` (never throws, and its catch calls nothing that can throw) with its warn latch and boot trace,
    `quietMs` threaded into `judgeStall`, and the `STALL_SWEEP_MS` comment.
  - The routes in `coord/routes.ts`: the docstring arguing gating and the unarmed-box insider case, worded as the
    Settings page's control with no device word; the view builder that never throws, with its two `try`s, `next`,
    `filesExceed`, `fallback` and the built-in quiet time under a fallback; the POST's refusal on its own unreadable
    read, its effect over both readings, 409 and key, and its one re-measure on `conflict`; and the feed body's actor
    (`deviceActor`, joining the existing `ccdargv.js` import, or `flag-off`).
  - L0 wire types and texts, appended at the end of `shared/api.ts` (§12).
  - **The census edits:**
    - `SESSION_ONLY` and its docstring;
    - `auth-gate.test.ts`'s two pins and its three needle numerals, and `auth/gate.ts` ≈:8's numeral (§10);
    - `coordinator-skill.test.ts`'s `EXEMPT` and forbid-mention case, and the forbid-mention cases in
      `worker-skill.test.ts` and `reviewer-skill.test.ts`;
    - `CLAUDE.md`: the box-token sentence, the mail-gate sentence (as the operator's Settings control), and the
      `coord.db` bullet's loss list (≈:255) gaining "the stall-watch settings choice".
  - The kebab union, its failure message, and M29's device scan in `stall-settings-route.test.ts`.
  - **README** (each line re-measured at the first step):
    - **The stall-watch paragraph** (≈:3999). "for the quiet time (2 h unless Settings sets another, 30 min to 12 h)"
      wherever it says 2 h for r1, the dialog cap or the backoff base (≈:4005, ≈:4023, ≈:4036, ≈:4046); and that
      a level chosen through `/api/coord/stall-watch` overrides the arming markers but never
      `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`.
    - **The backoff sentence** (≈:4049–4050, "doubles it, to 4 h and then 8 h at most") becomes "doubles it, then
      doubles it again, never past 16 h". It names the peak, not the base, so the "2 h" rule above does not reach it.
    - **Two "2 h" sites stay unedited**, because they are fixed constants, not the quiet time: ≈:4134 ("a second
      within 2 h", `FAILED_REPEAT_MS`, `stall.ts` ≈:340) and ≈:4151 ("the check sits undelivered for 2 h",
      `CHECK_UNDELIVERED_MS`, ≈:342).
    - **The mail-gate paragraph** (≈:3742–3770): one sentence on the same override. "only behind two more markers,
      touched and removed by hand" (≈:3752) gains "or a level chosen in Settings".
    - **Every runbook "`rm` … goes back" sentence** whose marker a chosen level overrides is qualified: the busy
      runbook's "`rm mail-gate-busy` goes back" (≈:3770) and the wave-2 runbook's "`rm` it to go back to wave 1's
      ladder" (≈:4186–4187). Each gains, spelled as the README spells markers: "while Settings follows the fleet
      box's files; otherwise lower the level in Settings, or on the fleet box touch `mail-gate-strict` (busy
      delivery) or `stall-watch-disabled` (the whole lane)". The strict runbook's "`rm` it to go back" (≈:3751) is
      left as it is: strict wins under every level, so removing it still goes back.
  - **The parent spec** (`2026-09-29-worker-stall-watch-design.md`): the one-line status pointer, and §10's kill
    rules (≈:874–876, "`rm stall-watch-live`", "`rm stall-watch-escalate`") qualified with the same clause.

  **It deploys first.** It changes nothing until a level or a quiet time is written, because the seed is `follow`
  plus the built-in, or until the mail gate moves into busy delivery while the server runs, which gets the busy
  clock's grace (§9, goal 4). The door is reachable with `curl` behind the session gate before W2 lands: a write
  that needs a confirm answers 409 with its effect and key, and the same body sent again with `confirm` set to that
  key writes.
- **W2: the PWA section (deploy class: server, which serves the PWA).**
  - `useStallWatchView` (with `settle`, and no `refresh`), the API methods, `StallWatchSection.tsx`, the 409 handling
    and the sheet built from the server's effect, the pure helpers and the two guards, and the header and "ONE poll"
    comment amendments in `SettingsScreen.tsx`.
  - `QuickConfirm.tsx`: `consequence: string | string[]`, one paragraph per line, with its row in
    `pwa/test/primitives.test.tsx`.
  - The Notifications row's label, renamed to "Push notifications for this browser" (`SettingsScreen.tsx` ≈:650),
    with its pin in `pwa/test/settings-screen.test.tsx` ≈:1771 moved with it.
  - **README:** the Settings paragraph (≈:936) gains "Settings has a third section, **Stall watch**: …".
  - W2 depends on W1 being merged. It needs no fleet-box deploy.

## 19. Defaults taken for the operator's review

The drafting review left five questions, and the adversarial review of rev 2 left six operator defaults. Each one
carries a default that the coordinator took, so that one review of this document settles all eleven. To change any
of them, say so in the review.

1. **Reading a level from the files when the busy gate does not match.** Default:
   `files-level-match-ignores-the-busy-gate`. A box with no files reads "Log only", with the busy gate off, not
   "custom", so a fresh install shows a ladder step.
2. **What `off` does to the mail gate.** Default: as approved. `off` stops the stall lane and leaves the mail gate as
   the fleet box's files set it. `off-sets-the-shell-gate` is not taken. Where a lower choice had switched busy
   delivery off over a box busy file, Off's confirm now says "Busy delivery turns back on: the fleet box's files arm
   it." (§13).
3. **Choosing "Follow the fleet box's files" when the files arm more than the effective level.** Default: it asks
   for a confirm, as any write that turns a stage on does (§10, §13), since it can arm more.
4. **A write that changes nothing.** Default: no feed event, and no `UPDATE` either: the store compares the named
   fields first, so `updatedAt` does not move (§8). The reply re-reads the stored values.
5. **Who coordinates.** The coordinator of the completed stall-watch programme (`ccrc-pwa-calm-harbor`) coordinates
   this one too. Its ledger is `docs/superpowers/programs/stall-watch-settings.md` (§18), opened at its first
   run.
6. **The busy gate below Deliver.** Default: Log only, Check and Alert set the mail gate to `busy-shadow`, as the
   approved table has it, so they hold mail for a session whose main turn is running and log what busy delivery
   would do. On a box whose files leave the gate off, choosing one of them turns that stage on and opens the confirm
   (§5.1). Alternative: below Deliver, leave the gate as the fleet box's files set it, with a box `busy` demoted to
   `busy-shadow`.
7. **The quiet-time floor.** Default: the approved 30 min. A value brought below the built-in opens the confirm, and
   the note says that while the further checks are off a waiting worker is checked once per quiet time (§7, §13).
   Alternative: a floor of 1 h.
8. **Repeat pushes about one open dialog.** Default: the chosen quiet time also spaces them, as R28's accepted
   residue does at today's 2 h, and the note and the alerts gate disclose it (§7). Alternative: keep the dialog cap
   on the built-in 2 h, so the setting changes worker checks only.
9. **Where the busy-gate evidence is read.** Default: the busy-delivery and further-checks gates say plainly that it
   is in the server log, and the read-only part stays as approved (§5.1, §11). Alternative: one more count row,
   "busy sessions the gate would have delivered to, 48 h", from a new durable record.
10. **The Notifications row's label.** Default: W2 renames "Phone notifications for this browser" to "Push
    notifications for this browser", following the operator's directive, and Alert's text points at it (§13).
    Alternative: leave the existing label untouched, as rev 2 did.
11. **How an unreadable stored field falls back.** Default, changed from rev 2's field-by-field: the whole row. If
    either field is unreadable, or the row is absent or unreadable, neither stored choice applies; the wire still
    reports each field's state (§6.2, §8). Alternative: field by field, so a readable level or quiet time applies
    beside an unreadable other.

**A note to the operator on goal 4 (not a question).** Rev 3 promised that W1 changes nothing until a level or a
quiet time is written. Rev 3.1 keeps that, with one named exception: when the mail gate moves into busy delivery
while the server runs, the stall sweep waits until busy delivery has actually started before it times stuck mail
(`busy-clock-starts-when-busy-delivery-starts`, §9). That now applies to Follow and to `mail-gate-busy` touched by
hand as well as to a chosen level. On those two paths it is a change from today: it removes today's window for a
false stuck-mail push during the first busy pass. At boot the clock is exactly today's; a failed listing or the
`mail-disabled` return moves neither field, so the grace already granted is kept and is not restarted.

## 20. Residue for the plan

The final re-check's minor items, kept here so the plan writer settles each one. None is fixed in the body above.
Each line names its lens.

- *(rulings and consistency)* §15's "Busy delivery armed by file (R18's order)" row says the confirm listed "Busy
  delivery stops." first, but §13 puts the target's `does` first, and an `alerts` stops line sorts ahead of
  `busyDelivery` in §5.1's order.
- *(rulings and consistency)* A quiet-time raise that stays below the built-in (30 min → 1 h) at Log, or at
  Everything with alerts off, sets `quietLowered` and opens a sheet with a title and no body lines.
- *(rulings and consistency)* A 409 whose body fails `asStallConfirm` becomes the `refused` toast, "Nothing was
  changed: <detail>", but a `confirm-required` body carries no `detail` to fill the slot.
- *(rulings and consistency)* The view builder never answers 500 since rev 3.2's second `try`, but what `effective`
  carries when `stallLevelOf` or `stallStages` itself throws there is not stated (§10).
- *(rulings and consistency)* The view builder's own catch: whether it warns, and if so once or per GET, is not
  stated; only how `reason` is composed is.
- *(rulings and consistency)* `stallNextStep` reads "the stages that level's own row turns on" through
  `armedStages`, which needs a `StallLadderRow` turned into an arming; no conversion is named.
- *(rulings and consistency)* An absent row sends `chosen.level` `'unreadable'`, so no radio is checked; §13 says
  "no radio checked" only for an unreadable level, and §15's absent-row row does not say it.
- *(rulings and consistency)* The `held` object and the `source` of the files-only fallback reading are not spelled
  out (both derivable from the box arming).
- *(rulings and consistency)* `stallEffectKey` uses a fixed word for a `null` `updatedAt`, so with a hand-edited
  non-integer `updatedAt`, a write between the sheet and the re-POST changes the key only when the effect changes.
- *(new mechanisms)* A row with both fields unreadable takes two writes to repair, because the PWA sends only the
  field moved. A table missing for good (§15's slot-collision case) makes every Settings write a 500, with no repair
  from Settings. Fastify's 500 body has no `detail`, so the `refused` toast's slot renders empty.
- *(new mechanisms)* A stall sweep that lands between a raise into `busy` and the first mail sweep that applies it
  (≈10 s at most) judges `busy-shadow`. A mail-stuck recorded in shadow then goes live about mail the very next mail
  sweep delivers. The `due` line covers it, but it is the false-push class the busy clock was meant to close.
- *(new mechanisms)* `busySince` restarts on every busy → non-busy → busy move the mail sweep applies, so an
  intermittent `stallResolveNow` fault that flaps the mail sweep between the files' `busy-shadow` and a chosen
  `busy` keeps deferring mail-stuck (a bug path only).
- *(new mechanisms)* `lastFallback` is written by whichever sweep resolved last. A fault that depends on the
  `mailDisabled` argument (the stall sweep passes the real value, the mail sweep `false`) makes `stallFallback()`
  flap, so the view mostly shows `null` while the stall sweep falls back.
- *(new mechanisms)* A remote `readdir` that alternates between `null` and a listing flips the effect between
  `{ measured: false }` and measured, so each re-POST's key mismatches and opens a fresh sheet. It is not permanent,
  but nothing bounds or explains it.
- *(new mechanisms)* `stallNextStep` under Follow with the kill file reads `off` and offers "Log only", which is held
  as soon as it is chosen. With Alert chosen under strict it offers Deliver, which cannot be reached while strict
  stands. Rev 3.2's confirm now shows such a step's held stages and the held line (§10), but the Next step still
  points at it.
- *(coordinator)* §18 leaves the strict runbook's "`rm` it to go back" (README ≈:3751) as it is. With Deliver or
  Everything chosen while strict holds it, removing strict applies the held stages the operator confirmed (the
  `heldByBox` line). The sentence should say that removing strict lets a held choice apply, not that it goes back.
