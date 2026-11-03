# Box settings in the console: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One wave,
> one PR. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Sequencing.**
> - One PR. Task 1's carve-outs land characterization first inside it. Landing them instead as their own
>   behaviour-identical PR ahead of the feature is the operator's call (spec D10).
> - Dispatch only after the operator rules on D2, D3 and D7.
> - Merge `main` before Task 2 if #1404 has landed, and before Task 3 if #1390 has.
> - Before Task 4's ring-context-map rows, merge `main` over whichever of #1398 and #1390 has landed.

**Goal:** Settings › Updates shows, for each node, what each of ccrc's seven settings resolves to and where it came
from, plus the node's backups and free disk, read-only.

**Architecture:** the `ccrc` CLI stays the one reader.
- **The CLI:** each setting gets one resolver that its act and a new verb, `ccrc settings`, both call. The verb writes
  the answer as `~/.ccrc/box-settings.json`.
- **A timer:** a new timer runs the verb every five minutes under the user manager.
- **The server:** a pure L1 parse and view (`update/boxSettings.ts`), and a lane (`update/boxSettingsLane.ts`) that
  reads the file inside the `inventory` LANE_SCHEDULE row's run, with no clock of its own.
  - FleetWatcher owns the last read per node as lane state.
  - `GET /api/updates` joins it into `NodeWire.settings` through the pure view, with the request's clock.
  - Transport follows the tmp-sweep census and `tokenGeneration`: a node file left out of `MEASURED_FILE_KEYS`.
- **The PWA:** a new card renders it from the section's one poll.

**Tech stack:** bash (`ccd/ccrc`), systemd user units, TypeScript (server, shared, agent), React with `@ccrc/ui` (PWA),
and vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-box-settings-view-design.md`, revision 3 (#1417). Its decisions D1 to D10
are this plan's. Anchors are `≈:` hints into `origin/main` at `ce6f0b60f`, 2026-10-25, most of them from the design
review's and the refactor-alignment review's readings. Re-ground each one by its symbol before editing.

## What was measured (2026-10-25)

- **The reader.** `CCRC_SETTINGS` (`ccd/ccrc` ≈:19571) is the one list. `_ccrc_knob <KEY> <default> [file]` sets
  `KNOB`, `KNOB_FROM` and `KNOB_WHY`. `_keep_knob` validates a keep, and `_bak_data_keep` (≈:24126) applies the data
  keep's lowest bound of 2. `_ccrc_knob`, `_keep_knob`, `_upd_redact` and `_bak_list` only set globals: they never die
  and take no lock. `ccrc-settings-census.test.ts` holds:
  - one distinct default per setting (C2);
  - no direct expansion of a setting (C3);
  - an expected list of variable-key `_ccrc_knob` calls (C4).
- **Four settings have no callable validator:**
  - `CCRC_UPDATE_HEALTH_S` is parsed inline in `_upd_gate` (≈:21664-21670), which also writes `update.json`;
  - `_models_advance_budget_secs` (≈:11246) clamps, with its sentence on stderr;
  - `_upd_deadline_ms` (≈:19656) answers by return code only;
  - `CCRC_RELEASE_BASE_URL` has no validator.

  Each default is a literal at its call sites (≈:24006, :24252, :24126, :24584, :21664, :19667, :20901, :11247).
- **Strings and redaction.**
  - A `BUE_WHY` from `_box_unit_env` (≈:3403-3463) runs 150 to 290 characters, and `_ccrc_knob` adds
    `"<KEY> cannot be measured: "` in front.
  - `_upd_redact` (≈:2696) is the one bash redactor for userinfo and `$HOME`.
  - `_ccrc_knob` tildes only a LEADING `$HOME`, and `_keep_why` echoes a refused value raw.
  - `_ccrc_usage_die` (≈:2828) is the one usage refusal (exit 2).
  - `_exit_add` and `_tmp_guard` (≈:2816, :2824) are the temp-file discipline.
- **Backups.** `_bak_list` (≈:23967) is the prune's own list. Its glob answers empty for a root that is a file or
  cannot be read.
- **The environment.** `_upd_detach` runs `systemd-run --user` (≈:20256, :1141), so a detached console update reads the
  manager's environment. The parent of a console move does not: on the fleet box it is the agent's `process.env`
  (`agent/src/server.ts` ≈:504, with `agent.env`), and on the server box it is `ccrc.service`'s
  (`server/src/update/spawn.ts` ≈:31, with `ccrc.env` and `exposure.env`).
- **The node files.**
  - `NODE_FILES` (`shared/agent-protocol.ts` ≈:176) has ten names, and the agent admits only those
    (`agent/src/whitelist.ts` ≈:109).
  - The inventory's `MEASURED_FILE_KEYS` leaves out `projection`, `tokenGeneration` and `tmpSweep`
    (`server/src/update/inventory.ts` ≈:79, :92).
  - `toNodeWire` maps only the coord.db row (`server/src/update/routes.ts` ≈:123-143).
  - Three tests pin ten names: `token-shared.test.ts` ≈:143, `single-definition.test.ts` ≈:3990 and
    `agent/test/whitelist.test.ts` ≈:172.
  - The read-grant note in `shared/agent-protocol.ts` ≈:146-152 argues each name.
- **Caps.** `CCRC_CAP_WORDS_LINUX`, through `_ccrc_cap_words`, is read every sweep. `capsFrom` folds an unreadable caps
  file into `{ os: 'unknown', caps: [] }` (`inventory.ts` ≈:180-187).
- **Rings and lanes:**
  - `update/inventory.ts` declares itself L3 on line 1, and `readNodeFile` lives there.
  - `ring.ts` makes a file with no non-pure `node:*` import, no I/O package and no timer L1. So an undeclared file that
    imports `readNodeFile` at runtime makes an L1→L3 edge, and `rings/outward-edges` goes red. That suite's exemptions
    may only shrink.
  - The precedent splits the work into `tmpSweep.ts` ("L1: pure, clock-free and fs-free") and `tmpSweepLane.ts` ("L4
    delivery"), with the state from `newTmpSweepLaneState()` owned by FleetWatcher (`watch.ts` ≈:1098).
  - The tmp census's `lastTmpSweepCensus` throttle sits on single-definition's lane-clock list, which only shrinks
    (≈:8604). It is not a scheduling model to copy.
  - The `inventory` row is `laneSchedule.ts` ≈:182 (`UPDATE_INVENTORY_MS`, join-rerun).
  - `registerUpdateRoutes` already takes the watcher (`update/routes.ts` ≈:518-523). `watcher?.currentCollectCounts()
    ?? null` is the getter idiom.
  - The 08-10 spec's ring-context map gives `fleet/**` to C1, and C7 lists only `fleet/Update*.tsx` and
    `fleet/useUpdatesView.ts`.
  - `rings/pwa-one-owner` refuses a wire guard defined outside `pwa/src/lib/wire.ts`.
- **Install, uninstall and doctor:**
  - `_inst_atomic` places units (≈:16387), and `_inst_enable_timer` enables them (≈:16850-16902).
  - `install-census.test.ts` ≈:1629 requires `deploy.sh` to place every `_inst_units` unit unless
    `DEPLOY_SH_WITHHOLDS.units` (≈:1574) lists it.
  - `ccrc-install-role.test.ts` ≈:234 pins each role's enables.
  - `ccrc uninstall` has a disable loop (≈:25188-25199) and an `rm` list (≈:25214-25227).
  - W24-P5 (`ccrc-update-flip-backups.test.ts` ≈:2805) names the units that carry no `CCRC_` environment.
  - Doctor's known-units list is in `ccd/ccrc-doctor-checks` ≈:882.
- **The card registry.** `SETTINGS_CARDS.updates` (`pwa/src/fleet/settingsText.ts` ≈:278) and `UPDATES_CARDS`
  (`pwa/src/screens/settings/UpdatesSection.tsx` ≈:143) are `['fleetVersion', 'nodes', 'policy']`.
- **Growth.** `ccd/ccrc`, `server/src/watch.ts`, `server/src/coord/store.ts` and `pwa/src/lib/api.ts` are
  growth-checked at +40 net code lines. A waiver needs `maxDelta > 40` in `server/test/growth-waivers.json`, added by
  the same PR.

## The decisions

- **D-6914: `ccrc settings [--json | --write] [--from timer]`, and one resolver per setting.**
  - **The resolvers.** Each of the seven settings gets one resolver: `_set_<name>`, or keep the existing name where one
    exists. It sets `SET_VALUE`, `SET_FROM`, `SET_STATE` (`ok`, `refused` or `unmeasured`) and `SET_WHY`, and its act
    calls it as the verb does. Each resolver calls `_ccrc_knob` or `_keep_knob` with its key and default as literals,
    moved byte for byte from its act. That keeps one distinct default per setting (census C2). No resolver expands a
    setting directly (census C3), `CCRC_RELEASE_BASE_URL` included.
  - **The carve-outs** land characterization first (Task 1 Step 3). Each act then refuses, clamps, prints and writes
    exactly as before, and its existing suites stay green unchanged.
  - **The dispatch.** `cmd_settings` walks `CCRC_SETTINGS` for order only, and dispatches through a literal
    `case "$k" in CCRC_BACKUP_KEEP) _set_backup_keep ;; … *) <mark unmeasured> ;; esac`. It never goes through
    `"_set_$k"`, and never through `_ccrc_knob "$k"`. If a variable key turns out to be unavoidable, the same PR adds
    `'_ccrc_knob $k in cmd_settings'` to census C4's expected list with its reason, citing doctor's
    `_check_box-settings` loop as precedent.
  - **Strings.** Every `value` and `why` goes through `_upd_redact` first, then the 480-byte clip (ending `…` when cut),
    then the map of each non-printable byte to `?` under `LC_ALL=C`. The server's parse is a validator and does not
    redact a second time.
  - **The base URL** is shown as `default`, or as `custom` with its scheme and host only, through one named helper,
    `_upd_url_origin`, beside `_upd_redact`. It runs `_upd_redact` and then keeps the scheme, if any, and the authority
    up to the first `/`, `?` or `#`. Nothing re-implements the userinfo strip, and ARCH-67 (K7) folds the helper in with
    `_upd_redact`.
  - **The deadline** also reports `minMs` and `maxMs`.
  - **The reader.** `--from timer` records `reader: "timer"`; anything else records `"shell"`.
  - **The write.** `--write` uses ccrc's idiom: `tmp="$dest.tmp.$$"; _tmp_guard "$tmp"`, a write under `umask 077` in a
    subshell, then `chmod 600` and `mv -f`, and `rm -f` on failure. It sets no `trap` of its own.
  - It never prunes, never takes `update.lock`, and writes nothing else.
  - **Exit codes.** rc 0 whenever it answered. An unknown argument, including a `--from` value other than `timer`, goes
    through `_ccrc_usage_die` (exit 2, `ccrc: unknown argument: …` on stderr). `-h` or `--help` prints usage at exit 0,
    as `backup` does.
- **D-6915: the timer.** `ccrc-settings.service` and `ccrc-settings.timer`.
  - The timer has `OnBootSec=120s`, `OnUnitActiveSec=300s` and `AccuracySec=30s`.
  - The service is `Type=oneshot`, with `ExecStart=/bin/sh -c 'PATH="%h/.local/bin:$$PATH" exec
    %h/.local/bin/ccrc settings --write --from timer'` and an `ExecCondition` that greps `%h/ccrc/ccd/ccrc` for
    `^cmd_settings()`, on the watchdog's idiom.
  - The timer is installed and enabled on every Linux role, and both units are removed by `ccrc uninstall`, in both of
    its lists.
  - The service joins W24-P5's no-`CCRC_`-environment list.
  - Doctor's known-units list gains it, with its own sentence, which names the unit rather than saying "every five
    minutes". The entry stays hand-kept until ARCH-69.
  - `deploy.sh` follows whatever it does for `ccrc-update-watchdog.timer`: it places the pair too, or the pair joins
    `DEPLOY_SH_WITHHOLDS.units` with that reason.
  - A new Linux cap word, `settings`, says the tree writes the file.
  - `BOX_SETTINGS_TIMER_S = 300` is declared once in `shared/api.ts`, with a comment naming
    `deploy/systemd/ccrc-settings.timer`. A Task 2 test pins it equal to the unit's `OnUnitActiveSec`.
- **D-6916: the node file, its reader and the wire.**
  - **The name.** `NODE_FILES.boxSettings = 'box-settings.json'`, with a read-grant sentence on why it holds no secret.
    It is left out of `MEASURED_FILE_KEYS`, and the three ten-name pins become eleven.
  - **`server/src/update/boxSettings.ts` is L1.** It imports `shared/` only, with a header on `tmpSweep.ts`'s idiom
    ("L1: pure, clock-free and fs-free; it imports L0 alone"). It holds:
    - `parseBoxSettings(text: string): BoxSettingsDoc | null`, a validator with no clock;
    - `boxSettingsView(held: BoxSettingsHeld | undefined, nowS: number): BoxSettingsRead`, which works out
      `ageS = nowS - doc.at`, `stale = ageS > BOX_SETTINGS_STALE_S`, and `clock-ahead` when
      `doc.at > nowS + BOX_SETTINGS_CLOCK_AHEAD_S`.
  - **`server/src/update/boxSettingsLane.ts`** declares its ring in its header, in `tmpSweepLane.ts`'s words ("L4
    delivery: …"). It holds `readBoxSettings(conn, io, caps)`, which reads through `readNodeFile`, and
    `newBoxSettingsLaneState()`. If #1390 has merged by dispatch, it is a `BoxSettingsBeat` on `TmpCensusBeat`'s idiom
    instead.
  - **Caps.** A node with measured caps (`os !== 'unknown'`) that lacks `settings` answers `not-supported`, and no read
    is issued. A node with `os === 'unknown'` answers `caps-unmeasured`, and no read is issued either.
  - **Owner and schedule.**
    - FleetWatcher owns the lane state (`private readonly boxSettingsLane = newBoxSettingsLaneState()`).
    - It calls the lane once inside the `inventory` LANE_SCHEDULE row's run (`runInventory` → `sweepThenProject`, after
      `sweepInventory`), using that sweep's caps and node ids.
    - The lane has no clock, flag, `lastX` field or throttle of its own, and there is no module-level mutable state.
    - Each run overwrites the held `{ read, readAtS }` for each node the sweep reached. A node the sweep could not reach
      keeps its last read, and an id no longer in `coord.nodes()` is dropped.
    - `watch.ts` stays within +40, and its call-site growth goes in the As built note.
  - **The route.** `GET /api/updates` reads the held state through a watcher getter, on the
    `watcher?.currentCollectCounts() ?? null` idiom (`registerUpdateRoutes` already takes the watcher). It sets each
    node's `settings` to `boxSettingsView(held, nowS)` with the request's clock. An absent watcher sets no field.
    `toNodeWire` and coord.db do not change.
  - **Vocabularies.**
    - `shared/api.ts` declares four named exported unions: `BoxSettingState`, `BoxSettingSource`, `BoxSettingsReader`,
      and `BoxSettingsFailure` (`not-supported`, `caps-unmeasured`, `absent`, `unreadable`, `too-large`, `malformed`,
      `clock-ahead`).
    - Each union has a sibling `Record<…, true>` map on the `SESSION_ROLE_MAP` idiom, and a list derived by
      `Object.keys`.
    - `BoxSettingsRead` is `{ state: 'ok'; doc: BoxSettingsDoc; ageS: number; stale: boolean } | { state:
      BoxSettingsFailure }`.
    - `parseBoxSettings` checks membership through those derived lists, and nothing spells them a second time.
    - The doc's key list is held set-equal to `ccd/ccrc`'s `CCRC_SETTINGS=(…)` line. If the doc keys are not the
      `CCRC_` names, one table checked for totality maps them.
  - **Constants.** `BOX_SETTINGS_STALE_S = 3 * BOX_SETTINGS_TIMER_S`, a stated derivation, and
    `BOX_SETTINGS_CLOCK_AHEAD_S = 300`, a separate safety bound not tied to the cadence, both in `shared/api.ts`.
  - **Logging.** The lane never logs. The card is its only surface.
  - **The validator** caps strings at 512 characters, requires the seven keys once each and the known vocabularies, and
    returns `null` for any violation of the non-negative-safe-integer rule.
- **D-6917: the Box settings card.** A fourth entry, `boxSettings`, after `nodes`, in `SETTINGS_CARDS.updates` and in
  `UPDATES_CARDS`.
  - `UpdatesSection` renders `BoxSettingsCard({ nodes, now })` from the `view` of the poll it already holds. The card
    never calls `useUpdatesView` or `usePoll`, and it adds no second `/api/updates` poll.
  - The words go in a new `pwa/src/fleet/boxSettingsWords.ts`, with the field's one reader,
    `boxSettingsOf(node: { settings?: unknown }): BoxSettingsRead | 'not-reported' | 'unrecognised'`.
    - It checks the shape with `isRecord` and `isOneOf` from `lib/wire.ts` only.
    - It answers `'not-reported'` when the field is missing, and `'unrecognised'` for a non-object or a `state` word
      this build does not list.
    - It checks every document string is a string before it renders.
  - The text tables are total, never a switch: `BOX_SETTINGS_READ_TEXT: Readonly<Record<BoxSettingsFailure |
    'not-reported' | 'unrecognised', string>>`, and `Readonly<Record<BoxSettingSource, string>>`. The card's 15-minute
    copy derives from `BOX_SETTINGS_STALE_S`.
  - The card is a new `pwa/src/fleet/BoxSettingsCard.tsx`, labelled "reported by the box", with no controls. On a
    server-role node, the models budget reads "not used on a server box".
  - `fleet/BoxSettingsCard.tsx` and `fleet/boxSettingsWords.ts` get file rows under C7 in the 08-10 spec's ring-context
    map. Without them, C1's `fleet/**` row claims them.
- **D-6918: the growth waiver for `ccd/ccrc`,** if the measured delta is over 40. Otherwise "spare, unused".
- **D-6919: spare.** Spend it only on a departure found while executing. If unused, its entry says "spare, unused".

## Global constraints

- No default, range or refusal of any setting changes. The D-6914 carve-outs preserve behaviour, and every existing
  suite of the acts they come from stays green unchanged. `_ccrc_knob`, `_keep_knob`, `_box_unit_env` and
  `CCRC_SETTINGS` are called, never edited. `ccrc-settings-census.test.ts` stays green. The one allowed exception is a
  C4 row for `cmd_settings`, added only if a variable key is unavoidable (D-6914).
- No server or PWA code branches on a setting's `why`. It is rendered as text only.
- Ring membership is a file's imports. Each new server file names its ring in its header, and the parse and view live
  in an L1 file that imports `shared/` only.
- No module-level mutable state, and no lane clock outside `runLane`. The box-settings read rides the `inventory` row.
- No act reads `box-settings.json`.
- No route, agent op, exec-whitelist entry, box-token door or coord.db column is added.
- The snapshot never holds a host path, a home path, userinfo, a query string or a credential.
- Wire discipline: additive. `FLEET_PROTO` is not bumped.
- `server/src/watch.ts`, `server/src/coord/store.ts` and `pwa/src/lib/api.ts` stay within +40 net code lines each.
- Fixture HOMEs only. Never run `ccrc` against the live `$HOME`.

## Review focus

1. **A `ccrc.env` holding a NUL byte** makes every setting `unmeasured`. One with an inner CR makes only the keys the file
   names `unmeasured` (D-6604). Either way the verb answers rc 0 with a valid v1 document. Pinned in Task 1.
2. **A credentialed or tokened `CCRC_RELEASE_BASE_URL`** (userinfo, path, query, scheme-less, repeated `@`) shows only
   its scheme and host, in the verb's output and in the file. Pinned in Task 1.
3. **A real `BUE_WHY` sentence** (one of the long `_box_unit_env` refusals) survives into the snapshot whole, and the
   server's parse keeps the document. Pinned in Tasks 1 and 3.
4. **An older fleet agent,** without the eleventh name, reads `not-supported` through its measured caps, never
   `unreadable`.
   - Caps that were not measured this sweep read `caps-unmeasured`, never `not-supported`.
   - A forged file (junk, an unknown key, 70 KiB, a symlink) reads `malformed`, `too-large` or `unreadable`.
   - An `at` an hour ahead reads `clock-ahead` at serve time.

   Pinned in Task 3.
5. **An older server** (no `settings` field), an older node (no cap), and a newer server's unknown word read as three
   different words on the card. Pinned in Task 4.

---

### Task 1: the resolvers and the verb (D-6914, D-6918)

**Files:**
- Modify: `ccd/ccrc`. Add the four carved-out resolvers, `_upd_url_origin` beside `_upd_redact`, `cmd_settings` beside
  `cmd_backup`, one dispatcher arm and one usage line.
- Test: a new `server/test/ccrc-settings-verb.test.ts`, with a fixture HOME through the ccrc harness the other `ccrc-*`
  tests use. Also the characterization pins (Step 3), `ccrc-cli.test.ts` and `install-census.test.ts` (the verb pins),
  and `growth-waivers.json` if needed.

- [ ] **Step 1: Write the failing tests:**
  - **Sources:** environment, `file`, `empty` and `default`, each read as such.
  - **Refused:** `CCRC_BACKUP_KEEP=abc` reads `refused` with `_keep_knob`'s sentence. `CCRC_BACKUP_DATA_KEEP=1` reads
    `refused` through `_bak_data_keep`'s bound. `CCRC_UPDATE_HEALTH_S=ninety` reads `refused` with the health gate's
    own fallback words.
  - **The NUL byte and the inner CR:** as in review focus 1.
  - **A long refusal:** a `ccrc.env` line that a quote carries across two lines makes the reader's long `BUE_WHY` show
    whole, under 480 bytes.
  - **Redaction:**
    - a keep value of `$HOME/x` reads `~/x`;
    - an unreadable `ccrc.env` sentence names `~/.ccrc/ccrc.env`;
    - a path under the fixture HOME in the middle of a sentence comes out `~/…`, and no fixture-HOME string appears in
      stdout or the file;
    - a value holding `https://u:p@h/` loses `u:p@`.
  - **The URL:**
    - `https://user:secret@mirror.example.invalid/r/x?token=abc` shows as `custom https://mirror.example.invalid`;
    - so do the scheme-less `user:secret@mirror.example.invalid/r?token=x` (as `custom mirror.example.invalid`) and
      `https://u:p@x@mirror.example.invalid/r`;
    - none of `secret`, `token`, `u:p`, `/r` or `user` appears in stdout or the file.
  - **Backups:** two timestamped dirs (one holding `coord.db`) plus a `pre-x` sibling read `kept: 2` and `withData: 1`.
    A `~/ccrc-backups` that is a file reads `unmeasured`.
  - **Usage:** `ccrc settings --bogus` and `--from shell` exit 2 with `ccrc: unknown argument: …` on stderr. `-h` exits
    0 with usage. A `ccrc-cli` row pins it.
  - **The write:**
    - `--write` gives mode 0600 and content equal to `--json`;
    - a write that fails, or is interrupted by a die or by SIGTERM through the EXIT chain, leaves no
      `box-settings.json.tmp.*` and keeps a prior good file intact;
    - nothing else in `~/.ccrc` changes;
    - `reader: "timer"` is recorded only with `--from timer`.
  - **Read-only:** a held `update.lock` does not stop it, and nothing in `~/ccrc-backups` is removed.
  - **The corpus:** a row regenerates the `ok` documents of `server/test/fixtures/box-settings/` from the real verb in a
    fixture HOME. It stubs `date`, `df` and `du` by PATH to fixed outputs, or compares after normalising `at` and the
    disk and backup byte fields. Any stub of a ccrc shell function goes through `stubFn`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Carve out the four resolvers, characterization first.**
  - **The first commit** adds a pin for each of the four acts, green on `main`:
    - the exact refusal or fallback text;
    - the clamp and its stderr sentence (`_models_advance_budget_secs`);
    - the return code (`_upd_deadline_ms`);
    - any `update.json` write (`_upd_gate`).

    Each pin carries a delete or reorder mutant.
  - **Then one move commit per resolver,** changing no assertion, with each act calling its resolver.
  - **The verb follows in its own commit.**

  Run each act's existing suites unchanged:
  - the health gate's (`ccrc-update*` gate rows);
  - the models advance's (`ccrc-models-advance`);
  - the deadline's (`_upd_deadline_ms` rows, and the watchdog's);
  - the release base's (`ccrc-update-fetch`).

  Name each suite in the As built note.
- [ ] **Step 4: Implement the verb.** Run the new tests, then `ccrc-cli`, `install-census`, `ccrc-settings-census`,
  `growth-check` and `docs-parity`.
- [ ] **Step 5: Commit.** `feat(ccrc): one resolver per setting, and ccrc settings prints and records them (D-6914)`

### Task 2: the timer, the cap word, install, uninstall and doctor (D-6915)

Before this task, merge `main` if #1404 has landed: both edit `ccd/ccrc`'s uninstall lists and `_upd_backup_set`.

**Files:**
- Create: `deploy/systemd/ccrc-settings.service` and `deploy/systemd/ccrc-settings.timer`.
- Modify: `ccd/ccrc` (placement, enabling on every Linux role, both uninstall lists, the cap word),
  `ccd/ccrc-doctor-checks` (the known units), `shared/api.ts` (`BOX_SETTINGS_TIMER_S`), and `deploy/deploy.sh` if it
  places the watchdog's timer.
- Test: `ccrc-install-units.test.ts`, `ccrc-install-role.test.ts`, `install-census.test.ts`,
  `ccrc-update-flip-backups.test.ts` (W24-P5), doctor's units rows, and the caps-words test.

- [ ] **Step 1: Write the failing tests:**
  - each Linux role places and enables the timer;
  - the unit text is as in D-6915;
  - both uninstall lists remove both units;
  - a macOS install places neither and reports no `settings` cap;
  - doctor names a missing timer with its sentence;
  - W24-P5 holds the new service;
  - the timer's `OnUnitActiveSec` equals `BOX_SETTINGS_TIMER_S`, read from `deploy/systemd/ccrc-settings.timer`, on the
    precedent of the server tests that already read `OnUnitActiveSec` from unit files.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them and see them pass,** then `growth-check` and `docs-parity`.
- [ ] **Step 5: Commit.** `feat(deploy): a timer records each box's settings every five minutes (D-6915)`

### Task 3: the node file, the lane and the wire (D-6916)

Before this task, merge `main` if #1390 has landed, and use its beat idiom.

**Files:**
- Modify: `shared/agent-protocol.ts` (the name and its read-grant sentence), and `shared/api.ts` (`BoxSettingsDoc`,
  `BoxSettingsRead`, the four vocabulary unions with their `Record<…, true>` maps, the `BOX_SETTINGS_*` constants, and
  `NodeWire.settings`).
- Create: `server/src/update/boxSettings.ts` (L1: `parseBoxSettings`, `boxSettingsView`) and
  `server/src/update/boxSettingsLane.ts` (ring declared in its header: `readBoxSettings`, `newBoxSettingsLaneState`).
- Create: `server/test/fixtures/box-settings/`. It holds Task 1's scenario outputs and the forged documents, each with
  its verdict (`ok`, or the failure word).
- Modify: `server/src/update/inventory.ts` (the exclusion only), `server/src/watch.ts` (the lane state, and one call
  inside `runInventory`/`sweepThenProject`), and `server/src/update/routes.ts` (the join at `GET /api/updates`, through
  the watcher getter).
- Test: a new `server/test/box-settings-read.test.ts`; `update-routes.test.ts`; the three ten-name pins; and
  `agent/test/whitelist.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **The parser.**
    - It iterates `fixtures/box-settings/` and checks each row's verdict.
    - It also parses the live verb's `--json` output, run under a fixture HOME (not a frozen copy), its long `why`
      included.
    - Each of these is `null`: a missing, duplicated or unknown key, `v: 2`, an unknown `state`, `from` or `reader`, a
      513-character string, a non-ASCII byte, and a negative or unsafe integer.
  - **The vocabularies equal the writer's, as sets.**
    - The parser's key list equals the members of `ccd/ccrc`'s `CCRC_SETTINGS=(…)` line, in both directions, with a
      CONTROL row.
    - Read that line with the census's `^CCRC_SETTINGS=\(([^)]*)\)$` regex, lifted into a small shared test helper that
      `ccrc-settings-census` and `ccrc-update-flip-backups` also import. Otherwise, record it as a third copy for
      ARCH-06.
    - The `state`, `from` and `reader` literals `cmd_settings` emits each equal their `shared/api.ts` map, in both
      directions, each spelled once, with a CONTROL row that shows the extractor finds them.
  - **The view.** A 10-minute-old `ok` read is `stale: false`, and a 16-minute-old one is `stale: true`. An `ok` read
    held while the clock moves past 15 minutes serves `stale: true`. An `at` 3,600 s ahead is `clock-ahead`.
  - **The lane.**
    - A node whose measured caps lack `settings` reads `not-supported`, and one with `os: 'unknown'` reads
      `caps-unmeasured`. Neither issues a read.
    - With the cap, no file reads `absent`, a symlink `unreadable`, 70 KiB `too-large`, and junk `malformed`.
    - The read happens on an inventory run (`inventoryNow`), never between runs.
    - A node the sweep could not reach keeps its last read and shows it as stale.
    - A rekeyed node's old id is gone after the next sweep.
    - Two servers in one file never see each other's reads.
  - **The route.** `GET /api/updates` carries `settings` on both nodes from the watcher's held state. With no watcher, no
    field is set. The coord.db schema version is unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them and see them pass.** Then run `rings/outward-edges`, `rings/totality`, `rings/wire-totality`,
  `rings/shared-imports`, `single-definition`, `lane-schedule`, `token-shared`, `typecheck-tests`, `topology-clean`,
  `growth-check`, and the agent suite. Add `rings/host-imports` only if a new file imports a host (`watch.ts` or
  `server.ts`).
- [ ] **Step 5: Commit.** `feat(server): the console reads each node's box settings (D-6916)`

### Task 4: the card (D-6917)

Before the ring-context-map rows, merge `main` over whichever of #1398 and #1390 has landed.

**Files:**
- Create: `pwa/src/fleet/boxSettingsWords.ts` and `pwa/src/fleet/BoxSettingsCard.tsx`.
- Modify:
  - `pwa/src/fleet/settingsText.ts` (`SETTINGS_CARDS.updates`);
  - `pwa/src/screens/settings/UpdatesSection.tsx` (`UPDATES_CARDS`, and rendering the card from the poll's `view`);
  - `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (C7 file rows for both new files).
- Test: a new `pwa/test/box-settings-card.test.tsx`; the updates section's existing test.

- [ ] **Step 1: Write the failing tests:**
  - **A full snapshot** shows seven rows with values and source words, "5 backups, 4 with data, 12.1 GB", "18 GB free
    of 150 GB", the age, and the reader.
  - **A refused setting** shows its sentence in the danger tone. **A stale snapshot** shows its age in the warning tone.
  - **A server-role node** shows the models budget as "not used on a server box".
  - **Each failure word** (`not-supported`, `caps-unmeasured`, `absent`, `unreadable`, `too-large`, `malformed`,
    `clock-ahead`) and a missing field each show their own words. `not-reported`, `not-supported` and
    `caps-unmeasured` all differ.
  - **A state word from a newer server** reads `unrecognised`. So does **an object where a string belongs**, and the
    rest of the section still renders.
  - **One poll:** the card issues no `/api/updates` request of its own.
  - **No controls:** the card renders no button and no input.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.** Use the existing card idiom and tokens. Add no new colour.
- [ ] **Step 4: Run them and see them pass,** then `rings/totality`, `docs-parity`, the whole PWA suite in the
  foreground, and `npm run build`.
- [ ] **Step 5: Commit.** `feat(pwa): a Box settings card under Settings › Updates (D-6917)`

### Task 5: README, mutation table, gates and PR

- [ ] **Step 1: The README.** Its "ccrc's own settings" paragraph names `ccrc settings`, the timer and the card beside
  doctor's check. It also says which environment the card reflects (spec §1, the environment row). The verb table and
  the units list gain their entries. Run `docs-parity` and `citations`.
- [ ] **Step 2: The mutation table.** Each mutant runs on a scratch copy, is restored byte-identical (checked by `cmp`),
  and has its ending recorded:
  - M1: the verb skips clipping. The long-refusal row goes red at the server's parse.
  - M2: the URL keeps its path. The URL row goes red.
  - M3: the backups count lists the root with its own glob instead of `_bak_list`. The `pre-x` row goes red.
  - M4: `parseBoxSettings` accepts an unknown key. Its row goes red.
  - M5: `boxSettingsView` uses `ageS > 1800`. The 16-minute row goes red.
  - M6: the lane reads without checking the cap, or folds `os: 'unknown'` into `not-supported`. The `not-supported` or
    `caps-unmeasured` row goes red.
  - M7: `boxSettingsOf` folds a missing field into `absent`. The older-server row goes red.
  - M8: the health-gate carve-out changes its fallback from 90 to 60. A characterization pin goes red.
  - M9: the verb skips `_upd_redact`. The `$HOME/x`, mid-sentence-path and `u:p@` rows go red.
  - M10: a `from` word is added to the bash only. The set-equality describe goes red.
- [ ] **Step 3: Gates.**
  - From `server/`, one file at a time, in the foreground, with `--pool=forks --maxWorkers=2`:
    - `ccrc-settings-verb`, `ccrc-cli`, `install-census`, `ccrc-install-units`, `ccrc-install-role`,
      `ccrc-update-flip-backups` and `ccrc-settings-census`;
    - `box-settings-read`, `update-inventory`, `update-routes`, `token-shared`, `single-definition` and `lane-schedule`;
    - `rings/outward-edges`, `rings/totality`, `rings/wire-totality`, `rings/shared-imports`, `rings/pwa-rings` and
      `rings/pwa-one-owner`;
    - `growth-check`, `docs-parity`, `citations`, `topology-clean`, `private-names`, `dtbd` and `typecheck-tests`;
    - every suite named in Task 1 Step 3;
    - `deviation-refs`, after `git fetch origin main`.
  - From `agent/`: the whole suite.
  - From `pwa/`: the whole suite, then `npm run build`.
  - The PR's `ccd/` and `deploy/` changes trigger CI's full server run. Read it.
- [ ] **Step 4: The plan's As built note,** at the end of this file. Record:
  - each deviation's result, and the mutation table's endings;
  - each act's suites from Task 1 Step 3;
  - the deploy.sh choice;
  - the measured growth of every growth-checked file the PR touches, `watch.ts`'s call site included;
  - the ring each new server file measures at;
  - whether #1390's beat idiom or main's lane-state idiom was used;
  - whether `cmd_settings` needed a census C4 row;
  - that doctor's units entry is hand-kept until ARCH-69;
  - D-6918's and D-6919's states.
- [ ] **Step 5: The PR,** from the workspace branch. Its first commit adds this plan and the spec, byte for byte.
  - Its body names #1417 and #1237, and links the spec and this plan by GitHub blob URL.
  - It names no host, path or session.

## Coordinator corrections at `408d93806` (2026-11-03)

This plan was written against the `main` of 2026-10-25. By the dispatch on 2026-11-03, every anchor in `ccd/ccrc` had
moved by 1,000 to 2,500 lines. Wherever this section differs from the text above, this section wins. Cite code by
symbol. The line numbers below are from `408d93806`: use them to find each place, then re-read it at your base.

1. **Scope (D-7861, coordinator ruling).** `CCRC_SETTINGS` (`ccd/ccrc:21616`) now lists 87 names, added by update
   management's wave 29, the slice limits, the graph settings and the test box settings. This wave still covers
   exactly the spec's seven named settings (spec, "The seven settings are …"). The snapshot's key list is its own
   literal of those seven, in `CCRC_SETTINGS` order. The pin that held "the seven keys set-equal to the
   `CCRC_SETTINGS=(…)` line" becomes two checks: each of the seven appears once in `CCRC_SETTINGS`, and the snapshot
   lists exactly the seven. The other 80 names are out of scope, and several of them are key files, tokens, paths or
   URLs, which the carried constraints keep out of the snapshot. A later wave decides them, each with a display class.
2. **The rebase triggers have all merged** (#1404, #1390, #1398). Branch from the current `main`. The "merge `main`
   before Task N" steps no longer apply.
3. **Task 1.**
   - `CCRC_RELEASE_BASE_URL` already has a resolver, `_upd_release_base` (`:22945`, D-6594). Reuse or wrap it to meet
     D8. Do not add a second `_ccrc_knob CCRC_RELEASE_BASE_URL` call.
   - `_upd_deadline_ms` (`:21708`) already prints a value and returns an rc. Only two settings are still parsed inline
     and need a carve-out: the health seconds inside `_upd_gate` (`:23708-23715`) and `_models_advance_budget_secs`
     (`:12145-12151`). Carve them out characterization first (D10).
   - Anchors: `_ccrc_knob` `:21660`, `_keep_knob` `:21684`, `_bak_data_keep` `:26195`, `cmd_backup` `:25947` (its
     dispatcher arm is at `:28438`), `_upd_redact` `:2779`, `_ccrc_usage_die` `:2968`, `_exit_add`/`_tmp_guard`
     `:2956`/`:2964`, `_bak_list` `:26045`, `_upd_detach` `:22251`, `_box_unit_env` `:3543`. `_upd_url_origin` does not
     exist yet; it is new in this wave.
   - `ccd/lib/ccrc-settings.sh` is generated from `ccd/ccrc` by `node deploy/gen-settings-lib.mjs` and pinned by
     `server/test/ccrc-settings-lib.test.ts`. This plan does not touch `CCRC_SETTINGS` or `_ccrc_knob`. If you change
     either, regenerate the file and add that suite to the gate.
   - The C4 census (`server/test/ccrc-settings-census.test.ts:396-406`) allows exactly two variable-key `_ccrc_knob`
     calls. The verb's call is the third row this plan expects. C2 and C4 now also read `SIBLING_FILES` and
     `ccd/testbox-knobs`.
   - Growth: `ccd/ccrc` is listed in `GROWTH_FILES` (`server/test/growth-check.test.ts:57-67`), with a limit of 40 and
     the check armed. D-6918's waiver goes in its own new file, `server/test/growth-waivers/D-6918-ccd-ccrc.json`,
     with the keys `{file, maxDelta, d, reason, added}` (`server/test/growthCheck.ts:30-35`). The single
     `growth-waivers.json` file no longer exists. Run the growth check armed in the gate.
4. **Task 2.**
   - Every existing `_inst_enable_timer` call is role-gated (`:18769-18826`). This timer is the first that runs on
     every Linux role. Place it in `_inst_units` (`:18245`) outside the fleet and server gates. The Darwin arm returns
     early (`:18368-18370`).
   - The watchdog's unit pair is withheld from `deploy.sh` (`server/test/install-census.test.ts:1606-1609`), and that
     list's comment gives only update-sync's reason. Following the watchdog means the settings pair joins
     `DEPLOY_SH_WITHHOLDS.units`, with its own reason written beside it.
   - Uninstall: `cmd_uninstall` `:26947`, the disable loop `:27278-27293`, the removal list `:27305-27322`. Add
     `server/test/ccrc-uninstall.test.ts` (it pins both lists, at `:299` and `:621`) to the files and the gate.
   - Doctor: the known units are in `_check_services`, at `ccd/ccrc-doctor-checks:951`, with the per-unit sentences
     near `:1043`. The doctor's unit rows now live in the split `ccrc-doctor-*.test.ts` files. The cap words are
     pinned in the `ccrc-install-*.test.ts` files (comment at `ccd/ccrc:1823-1824`); `CCRC_CAP_WORDS_LINUX` is at
     `:1830`.
   - The role enable rows are at `server/test/ccrc-install-role.test.ts:297`, `:384` and `:121`. W24-P5's unit list is
     still hand-kept, at `server/test/ccrc-update-flip-backups.test.ts:2817`.
5. **Task 3.**
   - `NODE_FILES` still has ten names (`shared/agent-protocol.ts:176-181`, with the read-grant note at `:141-174`), so
     `box-settings.json` is the eleventh. The ten-name pin has moved to
     `server/test/single-definition/update-stall.test.ts:428` (with a planted CONTROL at `:437`), because
     `single-definition.test.ts` was split into `server/test/single-definition/`. Also update
     `server/test/token-shared.test.ts:141-143`, `agent/test/whitelist.test.ts:175` and `:190`, and
     `agent/src/whitelist.ts:109`.
   - Inventory: `MEASURED_FILE_KEYS` is at `server/src/update/inventory.ts:84-93`, and `readNodeFile` is at `:114`
     with a 64 KiB cap (`:55`). Seven keys keep the snapshot far below that cap.
   - Routes: `toNodeWire` is at `update/routes.ts:126`, `registerUpdateRoutes` at `:555-560`, and `GET /api/updates`
     at `:618-634`. Join the view the way the `tokenDriver` spread does at `:628`. The `currentCollectCounts` idiom is
     in `coord/routes.ts`, not this file.
   - The lane: the `inventory` row is at `server/src/laneSchedule.ts:195`. `FleetWatcher` now takes `WatcherDeps`
     (#2153; `watch.ts:1400`, `deps.ts:210`). Its `coord` is narrowed to `WatcherCoordPort`, which includes `nodes`
     (`coord/ports.ts:94`). The tmp-sweep lane is now the `TmpCensusBeat` class (`server/src/tmpSweepLane.ts:131`,
     field at `watch.ts:1062`), and it has a clock of its own, so it is not the precedent for a lane without one.
     Build this lane as a small class held by `FleetWatcher` and constructed with `() => this.deps`. Type it against
     the `WatcherDeps` subset it needs. Call it only from `sweepThenProject` (`watch.ts:1712-1713`), after
     `sweepInventory`. Give it no clock of its own (spec D4).
   - Add `server/test/rings/watcher-store-port.test.ts` and `server/test/consolidation-census.test.ts` to the gate.
     The first pins which store members the watcher and its lane files reach. The second holds the lane-clock census.
   - Build any source-text guard over a new `server/src` file on `server/test/scan` (`parse.ts`, `symbols.ts`), never
     on `readFileSync` plus a regex. The ARCH-06 ratchet in `single-definition/advance-switches.test.ts` goes red on
     the second kind, because a new file's ceiling is 0. Put `advance-switches` in the task's gate.
6. **Task 4.**
   - The Updates cards are at `pwa/src/screens/settings/UpdatesSection.tsx:130` (three today) and
     `pwa/src/fleet/settingsText.ts:278-288`. The section already receives the one poll (`SettingsFrame.tsx:46`), so
     the card reads `view.nodes` with no second poll. The Test box card under Settings › Automation (#1986) is a
     separate surface; this card does not touch it.
   - The C7 row of the ring-context map is a single table cell
     (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md:248`). Add the two new files to it. The open
     PRs #2144 and #2146 also edit that map.
7. **Work in flight on the same files.** #2144 (`watch.ts`, `shared/api.ts` and the ring map), #2146 (the ring map),
   #1611 (stale; install code in `ccd/ccrc`) and #1619 (held; `ccd/ccrc-doctor-checks`). If one of them lands before
   you, merge `main`; never rebase.

## Deviations found

- **D-6914.** One resolver per setting, called by its act and by `ccrc settings [--json | --write] [--from timer]`.
  - Four are carved out of inline code, characterization first and behaviour-preserving.
  - The verb redacts every string through `_upd_redact` and then clips it. It shows the base URL as scheme and host only,
    through `_upd_url_origin`.
  - It refuses usage through `_ccrc_usage_die` and writes through `_tmp_guard`.
  - Wave 24 declined a verb; this one writes the snapshot.
- **D-6915.** `ccrc-settings.service` and `.timer`, every five minutes under the user manager on every Linux role. Also
  the `settings` cap word, `BOX_SETTINGS_TIMER_S`, both uninstall lists, doctor's known units and W24-P5's list.
- **D-6916.** `NODE_FILES.boxSettings`, left out of the sweep's measured files.
  - An L1 parse and view live in `update/boxSettings.ts`. A lane in `update/boxSettingsLane.ts` rides the `inventory`
    row with no clock of its own.
  - FleetWatcher owns the last read per node. `GET /api/updates` joins the view into `NodeWire.settings` with the
    request's clock.
  - The vocabularies are `Record<…, true>` maps held set-equal to the bash writer.
  - No coord.db column. Additive.
- **D-6917.** The Box settings card under Settings › Updates, read-only, rendered from the section's one poll, with one
  guarded reader (`boxSettingsOf`), total text tables, and C7 rows in the ring-context map.
- **D-6918.** The growth waiver for `ccd/ccrc`: `server/test/growth-waivers/D-6918-ccd-ccrc.json`, `maxDelta` 215. The PR
  measures +193 net code lines (+185 for the verb and the resolvers, +8 for the timer's install and uninstall rows).
- **D-6919.** The clip's ellipsis is ASCII `...`, and the order is: `_upd_redact`, then the ASCII spelling of `—`, `…` and
  `→`, then every other byte outside printable ASCII to `?`, then the cut to 477 bytes plus `...` (480 at most), then the
  JSON escape. The spec asked for both a `…` ending and a printable-ASCII validator, which cannot both hold;
  `_upd_json_str`'s precedent spells it `...`.
- **D-7861.** The coordinator's scope ruling of 2026-11-03 (corrections, item 1). The snapshot carries the spec's seven
  named settings as its own ordered literal (`BOX_SETTINGS_KEYS` in `ccd/ccrc` and in `shared/api.ts`). Each of the seven
  appears once in `CCRC_SETTINGS`, and the snapshot lists exactly the seven. The rest of the 87-name `CCRC_SETTINGS` list is
  out of scope.
- **D-7862.** The verb's `withData` counts the backups that hold a regular, non-symlink `coord.db` (spec §2.3), not
  `_bak_snap_class`'s answer: that classifier starts node and fully verifies each dir that holds one, and the verb runs every
  five minutes. The count is display-only; no keep, thin or prune decision reads it. A sidecar-only snapshot and a symlinked
  `coord.db` are not counted. Recorded as legitimately different at the line, and `ccrc-update-flip-backups`' coord.db pin
  names the one site.
- **D-7863.** `boxSettingsView` answers `unreadable` for a node the server has not read since it started. The spec's failure
  list is closed and has no "not read yet" word, and the server could not read it.

## As built (2026-11-03)

- **Deviations.** D-6914 to D-6917 as planned. D-6918 used (above). D-6919, D-7862 and D-7863 used for the three departures
  above. D-7861 as written.
- **Task 1's acts and their suites, unchanged and green:** the health gate, `ccrc-update-flip-backups` (W24-H1 to H4) and
  `ccrc-update-phases`; the models advance, `ccrc-models-advance`; the deadline, `ccrc-update-flip-backups` (W24-D) and
  `update-watchdog-revert`; the release base, `ccrc-update-fetch` and `ccrc-update-flip-backups` (W24-U); the keeps,
  `ccrc-update-kept`, `ccrc-update-flip-backups` and `ccrc-versions-warn-arms`. The characterization pins are in
  `server/test/ccrc-settings-carveouts.test.ts`, each with a delete or reorder mutant.
- **Resolvers.** Two carve-outs, as corrections item 3 says: `_upd_health_s` out of `_upd_gate`, and `_models_budget` out of
  `_models_advance_budget_secs`. The deadline reuses `_upd_deadline_ms`, and the base URL `_upd_release_base`. The keeps got
  `_bak_keep` and `_ver_keep`, one-line resolvers their acts now call, so each default is spelled once; `_bak_data_keep` is
  reused. A budget over 3600 reads `refused` with a sentence saying the step uses 3600; the act's clamp stays silent.
- **Strings.** `_upd_json_str` is not extended: its body is SHA-pinned by `ccrc-sweep-deliberate-stop`. The 480-byte helper
  is a new `_set_text`/`_set_json` pair beside the verb, which ARCH-67 can fold in with it. A refused keep's sentence is
  built by `_keep_why` from the value `_upd_redact` returns, because `_keep_why` cuts at 32 characters, and a cut made
  before redaction could keep part of a long home path.
- **The URL.** `_upd_url_origin` runs `_upd_redact`, keeps the scheme, cuts the authority at the first `/`, `?` or `#`, and
  drops everything up to its last `@`, since a host holds none (a security review of an interim commit: `_upd_redact`
  keeps some token-only userinfo whole).
- **The write.** A failed `--write` exits 1, so the timer unit reads failed and doctor can name it; a run that answered
  exits 0. SIGTERM runs the EXIT chain, which removes the temp file; pinned.
- **macOS.** The backups size goes through `_plat_bytes` (the platform shim), so macOS measures apparent bytes too; the timer is Linux only (spec D6).
- **deploy.sh.** It does not place the watchdog's pair, so the settings pair joins `DEPLOY_SH_WITHHOLDS.units` with its own
  reason. `TimeoutStartSec=120` on the service: the verb's `du` and `df` are bounded at 20 s and 10 s.
- **Census C4.** No row was needed: `cmd_settings` dispatches by a literal `case`, and the variable-key list is still its two
  rows. The census regex is lifted into `server/test/ccrcSettingsLine.ts`, which `ccrc-settings-census` and
  `ccrc-update-flip-backups` import. `ccrc-settings-verb`, `graph-knobs` and `testbox-knobs` still carry their own copy, for
  ARCH-06.
- **Growth.** `ccd/ccrc` +193 (waiver D-6918); `server/src/watch.ts` +7 (the lane field, one call at the end of
  `sweepThenProject`, the getter beside `currentCollectCounts`); `server/src/update/routes.ts` +3;
  `server/src/update/inventory.ts` 0; `server/src/coord/store.ts` and `pwa/src/lib/api.ts` untouched.
- **Rings.** `server/src/update/boxSettings.ts` measures L1 (imports `shared/` only), and `server/src/update/boxSettingsLane.ts`
  measures L4. `pwa/src/fleet/boxSettingsWords.ts` is L1 and `pwa/src/fleet/BoxSettingsCard.tsx` L4, both in the C7 cell of
  the 08-10 ring-context map.
- **The lane.** Built as a small class held by FleetWatcher, not on #1390's beat idiom (its `TmpCensusBeat` has a clock of
  its own). It takes the inventory run's own io, store and outcomes at the call, with no clock, flag or throttle. It runs at
  the end of `sweepThenProject`, after the resolve, push and dispatch, so a stalled read (bounded at 10 s) never delays the
  control plane. `update-projection`'s planted-throw case now counts only the resolve warning, since the dispatch run's
  own warning lands inside the run.
- **The parser** is strict on purpose: an unknown key at any level is `malformed`, so a writer that adds a field bumps `v`.
- **The card** reads the poll the section already holds. The disk line uses the fleet's `humanBytes` (decimal units), and
  the age text uses `elapsedWords` with the device's clock, while `stale` is the server's.
- **Doctor.** `_check_services`' known units gain `ccrc-settings.timer` with its own sentence, hand-kept until ARCH-69.
- **The mutation table** (each run on the working tree from a saved copy, restored and checked by `cmp`, the tree clean
  after): M1 to M10 all killed. M6 was run as two mutants, M6a (no cap check) and M6b (`unknown` folded into
  `not-supported`). M8 changed every `90` in `_upd_health_s`, the sentences included.
