# W1a compaction: departures found while carrying out the plan

This note is for the programme's coordinator, to fold into `w1a-compaction.md`'s "Deviations found" and into the index
plan. It names each departure by its plain-words slug, because no number was issued for it on this branch. The plan
file itself is left unedited: the ledger guard refuses an edit to it from a work branch.

## Step 1 of Task 4, measured: the turn marker

- **Who writes `turnAt`.** `ccd/session-hook.sh#_hook_turn_mark` writes `$REG/<id>.turn.json`. Its program sets
  `turnAt` to the hook's stamp only on a `working` write, and carries it unchanged on every other kind (`done`,
  `failed`, `restart`); `clear` sets it to null.
- **When a `working` write happens.** Every main-thread UserPromptSubmit writes one, even over a `working` line
  (D-3675). A main-thread PreToolUse or PostToolUse writes one only when the marker is not already `working` for this
  session. PreCompact, PostCompact and SessionStart(compact) write none.
- **So within one turn `turnAt` holds still.** A later event of the same turn rewrites the marker's `at`, never its
  `turnAt`. The arm reads the existing key, as the coordinator ruled on review 1902 n2, and adds none.
- **Not measured: the order of UserPromptSubmit and an automatic PreCompact at a turn's start.** W0-13 saw the refusal
  asked once at each turn's start, but the rig did not record whether the UserPromptSubmit hook ran first. If PreCompact
  runs first, `turnAt` is still the previous turn's start, a refusal made then counts as this turn's, and the arm lets
  this compaction through. That fails open: at worst the arm refuses every other turn, never twice in one.

## Departures

- **compaction-text-before-the-steer.** The plan appends the role section after the steer text. It prints BEFORE it,
  so the steer's "At the very END of your `<summary>` block" stays the print's last instruction. The history
  programme's coordinator asked for this, because its W3 cohort measures how often the leaf block comes back whole, and
  the overlord's coordinator ruled it.
- **compaction-text-jq-shared-by-parity.** ccd and the hook each check the projection's `compactText` with one jq
  program, `COMPACT_TEXT_JQ`, spelled in both files: the hook is another process and sources nothing, as
  `_hook_epoch_ms` is a local copy of ccd's `_plat_epoch_ms`. A parity case in `session-hook-steer.test.ts` pins the
  two lines byte-equal. The check refuses anything that is not one line of printable ASCII, at most 600 characters, with
  no quote, backslash, dollar sign, backtick or semicolon, so a bad row types a bare `/compact`. The semicolon is review
  2004 F6: tmux's `send-keys -l` drops a trailing `;` (measured on tmux 3.6), so neither spelling admits one, and the
  role table's own text test refuses one too.
- **compaction-text-follows-standing-instructions** (review 2004 F5b). The shipped texts depart from the plan's Task 1
  texts in two places, both toward spec §3.3.9 C51:
  - every role's drop sentence reads "Drop tool output, and follow any standing compaction instructions the operator
    gave." where the plan has "Drop tool output.": C51 names the operator's own standing instructions as followed, and
    the plan's own Spec line says so, but its texts left the clause out. `compactionSets.ts` now pins the sentence;
  - `plain`'s text reads "every instruction the operator gave, in its words" where the plan has "with its words".
- **turn-key-reads-the-existing-turnat** (the coordinator's ruling on review 1902 n2). The plan's Task 4 said the arm
  might write a new `turnAt` key. The marker already has one (above), and `server/src/turnmark.ts` reads it, so the arm
  reads that key and writes nothing. The plan's "one more key, additive, read by nothing else" is void.
- **refusal-ahead-of-the-card** (the coordinator's ruling, option 1). The plan dispatches the refusal arm after the
  compaction card (`_hook_compact_pre`). Measured in a fixture: the card wrote its set (`$REG/<id>.compactset`) before
  the arm refused, and a refused event has no PostCompact to consume it. For twenty minutes the card then read every
  PreCompact as an overlap: scope `ambiguous`, so the next allowed compaction got the card's overlap degrade, and
  history's steer print, which serves only `main`, printed nothing for it. The arm now runs first, and the card returns
  at once on `CS_REFUSED`. R7b still holds: the arm is ahead of `_hook_history_pre`, and no history switch reaches it.
  The test `a refused PreCompact writes no compactset; the next allowed one ... gets the steer print` was measured red
  with the old order and red with the card's gate line deleted.
- **refusal-asks-the-scope-rule.** Since the arm now runs before the card, it asks the scope rule itself
  (`_hook_compact_scope`, called directly: `_hook_history_scope_verdict` is defined further down the file than the arm's
  dispatch). The card's overlap degrade never reaches it.
- **refusal-block-is-the-json-form.** W0-13 measured the block as exit code 2 with a reason on stderr. This hook's
  contract is exit 0 and silent stderr on every path, which every hook suite asserts. So the arm prints the JSON form,
  `{"decision":"block","reason":...}`, which the hooks page documents as equal to it. **The JSON form is not measured.**
  The renewal hand-offs plan's Task 6 now carries it as a precondition, with the two other facts to measure before the
  generations lane writes `precompact=refuse`: Claude Code's precomputed automatic compaction, and the order of
  UserPromptSubmit against an automatic PreCompact (review 2004 F2, the coordinator's ruling). If a build ignores the
  JSON form, four things go wrong at once:
  - the compaction happens with no card set, because the card returned on `CS_REFUSED`;
  - the events line says `refused` for a compaction that happened, and no `pre`;
  - history's steer print is suppressed, so that compaction gets no leaf block;
  - the raw JSON is appended to the compaction instructions.
- **refusal-is-recorded-before-it-is-printed** (review 2004 F1, the coordinator's ruling; it replaces
  refusal-records-only-a-delivered-block). The arm writes its `refused` events line first, under the lock, through the
  events line's one writer (`_hook_compact_pre_line refused`, which now answers 0 only for a line written), and prints
  the block only once that write succeeded. Before, it printed first and left the line to the last arm, so a path that
  wrote no line refused again on every later automatic PreCompact of the turn, and, for a directory or FIFO at
  `.compacteventsprev`, of every turn: the arm failed open on the read side and closed on the write side. Now every
  silent no-write path lets the compaction through: a lock miss, another generation, a bad events file, a directory or
  FIFO at `.compacteventsprev`, a failed rotation or append. A delivered block sets `CS_REFUSED`, which skips the last
  events-line call, so a refused event keeps one line. A print that fails leaves the `refused` line, and the event's own
  `pre` line follows it: the compaction goes through, and that turn asks no second refusal. The new cases (a FIFO and a
  directory at prev, a read-only events file, another generation, a failed print) were each measured red with the old
  order, restored from a saved copy.
- **refusal-trigger-must-say-auto.** The arm reads a missing `trigger` as no trigger, so it does not refuse. The
  events line and the card read a missing trigger as `auto`, and keep doing so.
- **events-line-fixes-from-review-1937.** This piece's edits to `_hook_compact_pre_line`, carried from review 1937:
  - F1: a symlink at `.compacteventsprev`, dangling or not, is removed under the lock behind its own re-check (a new
    ITEM 3 census row), and the line is then written.
  - F2: a rotation that is due and fails appends nothing.
  - F3: `CS_RULE_SCOPE`, `CS_RULE_TRANSCRIPT` and the arm's `CS_REFUSED` are unset with `CS_SCOPE`.
  - The existing cases that pinned "a link at prev writes no line" now pin the removal instead.
- **token-count-one-rule** (review 1937 F4). The sidecar parser's above-zero rule moved to L0 as
  `shared/api.ts#tokenCountOf`, and both readers call it: `parseUsageSidecar` reads the sidecar and `reviveUsage` reads a
  persisted snapshot. A revived 0 or negative is now no reading, as a parsed one is. The rule was not copied into the
  reviver.
- **precompact-lane-only.** `precompact` joins `ROUTE_LANE_ONLY_FIELDS`, which is derived as the tail of
  `ROUTE_WRITABLE_FIELDS` from `profile` on: its one writer is a server lane, so no door may write it. Four door suites'
  length pins move from 3 to 4.
- **spec-amendment-f7** (review 1902 F7, plan-driven consistency). Spec §3.3.4's C39 bullet and C53 used to say the
  refusal is "a decision inside history W3's one print". They now say it is a verdict of its own, ahead of that print;
  one event still has one stdout payload (R7b; review 2004 F3 replaced the earlier "which adds no print", which was
  literally untrue, since the arm prints its block), and C53 says the role section comes before the steer text. The
  plan pull request #2728 had already dropped "inside history W3's one print" from Table 11.1b's hook-arms row without
  naming it; this names that change. Review 2004 F3 also moved Table 3.3.11b's row "A proactive compaction the PreCompact
  arm refused" to its real source, the events file's `refused` line read by `refusedSince`, and corrected §3.3.10's
  stale "The PreCompact hook prints nothing today".
  The plan's own quote of the old wording (its Spec line) is left for the ledger, since the plan file is not edited here.
- **card-spec-acquisition-count** (review 1937 F6). The compaction-card spec's `COMPACT_LOCK_WAIT` row said "the
  hook's four acquisitions". Five of the hook's six acquisitions use it; the sixth, compact SessionStart's, uses
  `COMPACT_LOCK_WAIT_SERVE`.

## Not done here

- `precompactDecision` is read by its parity table and the mutation floors. No simulator scenario reads it yet. The plan
  names the simulator as a reader; wiring it is the simulator's piece.
- Nothing writes `precompact`: the generations lane writes it through the renewal hand-offs piece's Task 6.
