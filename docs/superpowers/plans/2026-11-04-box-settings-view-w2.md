# Box settings in the console, wave 2: every setting a node reads: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One wave,
> one PR. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Sequencing.**
> - Dispatch only after spec revision 5 is on `main`. It is: the ledger PR #2245 merged it at `745296e45`.
> - One PR, with ordered commits, each task's wave-done green (two gate-sweep reds are recorded in As built, D-7921 and the slice defaults row). The tasks below are numbered in commit order; do them in that
>   order. Task 4 (the server reads version 2) lands before Task 5 (the verb writes version 2).
> - The reader-before-writer constraint is a rollout constraint, not a PR one: the PR ships as one release, and the
>   fleet moves with `ccrc rollout --server-first`. The PR body says so (Task 8).
> - **Shared files.** `ccd/ccrc` and `shared/api.ts` are hot. The delegation broker's wave-5 PR1 also edits them: its
>   installer and uninstall path for a lease library in `ccd/ccrc`, and a carrier-vocabulary block after
>   `DelegationProjectionWire` plus a `CHILD_DENY_CCD_VERBS` entry in `shared/api.ts`. That PR also adds a `ccd caps`
>   word; this wave adds none. This wave's hunks are disjoint from those: the settings code near `CCRC_SETTINGS`,
>   `cmd_settings` and the moved checks, and the box-settings L0 block. The standing terms hold: whichever lands first
>   lands, the second merges `main` once, nobody rebases, and a claim conflict goes to the coordinator.
> - **The first commit** carries this plan, byte for byte, as `docs/superpowers/plans/2026-11-04-box-settings-view-w2.md`,
>   and nothing else.

**Goal:** the Box settings card under Settings › Updates shows, for each node, every setting a fleet or server node
reads (61 of `CCRC_SETTINGS`' 89; the test box's own 28 are left out), each by its display class, grouped by family,
and a refused setting anywhere (verb, wire, server, card, doctor) records its check's words and source, never its value.

**Architecture (short):**
- **The CLI** stays the one reader. One class table in `ccd/ccrc`, beside `CCRC_SETTINGS`, gives each setting its
  class, family, roles and when it applies. Every verdict comes from the setting's own check: the checks that could
  not be called (`_tshape`, the keepalive's, the usage sweep's, carry copies') move into `ccrc` first,
  characterization first, and every check gains value-free words. `ccrc settings` writes version 2 of
  `~/.ccrc/box-settings.json`: 61 rows, a refused row with words from a closed set and no value.
- **L0** (`shared/api.ts`) mirrors the table, the closed refusal words, the cut constants and the value and origin
  envelope, each held equal to bash by a test.
- **The server** (`server/src/update/boxSettings.ts`, L1) reads version 1 beside version 2, drops a version-1 refused
  row's value and why, and checks every version-2 row against its class. The lane, route and watcher are unchanged.
- **The PWA** card reads both versions, groups rows by family in native `details` folds, and shows a server-role
  node's fleet-only families as one line each.
- **Doctor**'s `box-settings` line prints by the same table.

**Tech stack:** bash (`ccd/ccrc`, `ccd/ccrc-test`, the two sweeps, `ccd/ccrc-doctor-checks`), the generator
`deploy/gen-settings-lib.mjs`, TypeScript (shared, server), React (PWA), and vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-box-settings-view-design.md`, revision 5, section 5 and its decisions
D11 to D22 (all Agreed, 2026-11-04). Wave 1's plan as built: `docs/superpowers/plans/2026-10-25-box-settings-view.md`.
Anchors below are `path:line` at `ffa9f0ab2` (the drafts measured there; `main` `745296e45`'s `ccd/`, `shared/`,
`server/src/update` and `pwa/src/fleet` are identical to it). Re-ground each one by its symbol before editing.

## What was measured (2026-11-04)

**Drift.** `git diff --stat 724d7683a ffa9f0ab2 -- ccd pwa/src/fleet pwa/test/box-settings-card.test.tsx shared/api.ts`
is empty, and `ccd/` was last changed at `98ade6885` (#2193). Every spec citation the drafters checked holds at
`ffa9f0ab2`.

**The settings list and the reader.**
- `ccd/ccrc:21725` holds the one `CCRC_SETTINGS=(…)` line, 89 names. The first seven are wave 1's
  (`BOX_SETTINGS_KEYS`, `ccd/ccrc:26115`). The 28 `_tb_box_table` keys sit after `CCRC_TESTBOX_TIMES`, and
  `CCRC_CARRY_COPY_WARN_BYTES` is last.
- `_ccrc_knob` (`ccd/ccrc:21769`): in `file` mode it never reads the environment (`[ "${3:-}" = file ] || KNOB="${!key:-}"`).
  An empty line gives `KNOB=<default>` with `KNOB_FROM=empty` (`:21781`, `:21784`). rc 1 sets `KNOB_WHY`
  `<KEY> cannot be measured: …` with `$HOME` written as `~`. A key outside `CCRC_SETTINGS` is rc 1 before any read.
  For every row read through it, `empty` means the default applies.
- `_keep_ok`/`_keep_why` (`ccd/ccrc:26364-26369`): `"%s='%s' is not a whole number from %s to 9999"`, the value cut at
  32 with `...`, non-printables as `?`. `_keep_knob` appends `, as set in <the environment | the box's ccrc.env>`.
  `_bak_keep` (`:26525`), `_bak_data_keep` (`:26530`, lowest 2) and `_ver_keep` (`:26976`) read through it.
- `_upd_health_s` (`ccd/ccrc:23810`; its sentence at `:23816`): `…is not a number of seconds (digits only, at most 18) — using 90`.
- `_upd_deadline_ms` (`ccd/ccrc:21817`) answers by rc only. `cmd_settings`' deadline sentence is at `ccd/ccrc:26198`
  ("…is not a positive whole number of milliseconds in canonical digits (at most 15, no lead zero), so its plain
  reading is …"). `:26193` is a comment.
- `_models_budget` (`ccd/ccrc:12232-12245`): neither of its sentences (`:12237`, `:12243`) spells a range.
- `CCRC_RELEASE_BASE_URL` is never `refused` in `cmd_settings` (`ccd/ccrc:26201-26207`): only `ok` or `unmeasured`.
- `_upd_url_origin` (`ccd/ccrc:2963-2975`, header `:2937-2962`): the http(s) test runs only on the raw value's leading
  scheme (`:2966`); the redacted value's scheme match (`:2969`) accepts any scheme, so `user:pw@ftp://h/r` prints
  `ftp://h` with rc 0 (review 1403 F1). The false header sentence is `:2955-2956`. It returns rc 1 when a `/`, `\` or
  `=` stands before the last `@`. It prints any authority holding no whitespace, quote, `/`, `?` or `#`
  (for example `h:abc`).
- `ccd/ccd-update-sync:132-136` carries a generated byte copy of `_upd_redact`, and `log-line-redact-corpus.test.ts`
  pins its KNOWN LIMITS rows: the reason F1's fix lives in `_upd_url_origin`.

**The verb as built.**
- `cmd_settings` (`ccd/ccrc:26166-26304`) walks `BOX_SETTINGS_KEYS` and dispatches by a literal `case`. Its refused arm
  records the raw value (`1) st="$s_refused"; val="$KNOB"`, `ccd/ccrc:26215`). Rows are emitted inline as JSON with the
  `s_`/`f_`/`r_` locals. The document literal `{"v":1,…}` is at `:26276`. `--write` is temp + `_tmp_guard`
  (`ccd/ccrc:3039`) + `chmod 600` + `mv`. The human form has three formats (`ccd/ccrc:26228-26234`):
  `'%-30s %s  (%s, %s)'` for an ok row, the same followed by `: <why>` for a refused one, and `'%-30s %s'` followed by
  `: <why>` for an unmeasured one. The longest of the 61 shown keys, `CCRC_GRAPH_INCREMENTAL_MAX_FILES`, is 32
  characters; `ccrc-settings-verb.test.ts:436` pins `CCRC_RELEASE_BASE_URL {10}custom {2}\(` (the 30-column pad).
- The verb's usage paragraph (`ccd/ccrc:2716-2726`) opens "print what this box's seven settings read as
  (CCRC_BACKUP_KEEP, …" and lists the seven. Three suites pin its first line: `ccrc-settings-verb.test.ts:609`,
  `ccrc-cli.test.ts:232` and `install-census.test.ts:2194`. Two more "seven" sentences describe the verb: the
  installer's comment above the settings pair (`ccd/ccrc:18475`) and the verb's header (`:26093`, `:26097`).
- The bash `BOX_SETTINGS_KEYS=(…)` literal is pinned twice: `ccrc-settings-verb.test.ts:110-111` (`own`) and
  `box-settings-read.test.ts:243-254`, whose control (`:251-253`) deletes `CCRC_MODELS_ADVANCE_BUDGET_S` from that
  literal's text and reads it through `verbKeys` (`:212-215`).
- `_set_text` (`ccd/ccrc:26122-26129`, a subshell function: redact, ASCII under `LC_ALL=C`, cut to 477 plus `...` at
  480, both literals in its body) and `_set_json` (`:26130-26135`, escapes `\` and `"`). `_set_keep_why` (`:26164`)
  quotes the redacted value.
- `deploy/systemd/ccrc-settings.service:31` runs `~/.local/bin/ccrc settings --write --from timer`, the launcher that
  execs the tree's `ccrc`, so `CCRC_HERE` is the tree's `ccd/` and `graph-resolve` and `testbox-knobs` sit beside it.

**The checks that move, and their consumers.**
- `_tshape` (`ccd/ccrc-test:148-159`) and `_tshape_says` (`:161-171`) use `[0-9]`/`[1-9]` ranges, and `_tshape_says`
  ends with `echo` (a trailing newline). The CPU and IO weights share the `*` arm, "a whole number from 1 to 10000".
  `TBOXWIDE` (`:147`) and `_tload` (`:172-190`) stay in `ccrc-test`. `ccd/ccrc-test:128` already sources `ccrc`.
  `ccrc-test-wrapper.test.ts:189-209` pins only the prefix `is not ` and the suffix, never the words.
- The keepalive (`ccd/ccd-telemetry-keepalive:282-292`): one loop runs `^[0123456789]+$` over `CCRC_KEEPALIVE_FRESH`
  plus four non-setting knobs (`TURN_TIMEOUT`, `BACKOFF_*`), then a separate representability test with
  `[ -ge 0 ] 2>/dev/null`. Message order: FRESH whole, then the four, then FRESH representable. `KA_FRESH_FROM` is set
  at `:139`, `_ka_say` at `:169`, `set -uo pipefail` (no `-e`) at `:99`. Its loader lines are `:136-137`.
- The usage sweep (`ccd/ccd-usage-sweep:43-48`): regex `^[123456789][0123456789]{0,2}$` at `:44`; the sentence quotes a
  value sanitised to 32 printable bytes; the loader is `:41-42`; `set -uo pipefail` at `:8`.
- Carry copies (`ccd/ccrc-doctor-checks:11224-11232`): the bound is read in file mode (`:11224`); regex
  `^[123456789][0123456789]{0,17}$` at `:11229`; the WARN quotes the value (`got '$thr'`, `:11230`) and its remedy
  follows (`:11231`). That text is pinned at `server/test/ccrc-doctor-carry-copies.test.ts:165` (`toBe`), and `:167`
  pins the prefix `CCRC_CARRY_COPY_WARN_BYTES must be a whole number`. `check()` (`:44-51`) sources `ccd/ccrc` and then
  the checks file.
- The session slice: `_slice_limit_ok` (`ccd/ccrc:17269`) is pure. `_slice_limit` (`:17294-17302`) builds its words
  inline from `floor`/`also` (`:17300-17301`) and WARNs with `'$KNOB'` and the drop-in path.
  `slice-limits-config.test.ts:218-231` matches only the head of the WARN. `_inst_slice_limits` reads both slice keys
  env-first (`:17311-17312`).

**The generated library.**
- `deploy/gen-settings-lib.mjs:18-21` `SETTINGS_LIB_FUNCTIONS` holds 8 names, emitted in array order. `bodyOf`
  (`:39-45`) slices `name() {` at column 0 up to the first line that is exactly `}`, so a one-line function cannot be
  sliced. `HEADER` is `:23-29`.
- `ccrc-settings-lib.test.ts`: W29-L1 (`:52`) pins the header by byte equality with the generated file; W29-L2
  (`:57-77`) holds the slice closed over the `_` names it calls; W29-L3 (`:79-90`) is set-equal to the constant.
- `server/test/ccrc-settings-census.test.ts:614-617` pins both sweep loader lines byte for byte (`LOADER`).
- The install echo `the settings reader the ccd-* sweeps source` (`ccd/ccrc:17637`) is pinned by `install-census`,
  `ccrc-uninstall` and `ccrc-install-tree`.
- Comments that turn false when the library widens: `ccd/testbox-knobs:26` and `ccd/ccd-graph-sweep:17` ("carries
  `_ccrc_knob` and its closure only"), `ccd/ccrc:21723-21724`, `ccd/ccrc:28658-28659`, `ccrc-settings-lib.test.ts:1-8`
  and `:79`.
- No name collides: `git grep` finds none of `_keep_says`, `_usage_days_*`, `_keepalive_fresh_*`,
  `_carry_warn_bytes_*`, `_slice_limit_says`, `_upd_health_says`, `_upd_deadline_says` or `_models_budget_says`, and no
  test names `_tshape`.

**Graph and test box.**
- `ccd/graph-resolve:18-21` is a run-guard only; `_gr_shape` `:28`, `_gr_fits` `:45`, `_gr_says` `:66-80` (10 classes),
  `_gr_knobs` `:83-104` (on a shape failure it keeps the default and writes `GK_WARN` quoting the value at `:98`).
  `ccd/ccrc:17334` already sources it, guarded. `_graph_knobs [file]` (`ccd/ccrc:28687-28714`) is 23 literal calls
  emitting `KEY<US>default<US>value<US>from` lines; `CCRC_GRAPH_STORE`'s default is `"$HOME/.ccrc/graphs"`. The line
  printer `_test_knob_say` (`ccd/ccrc:28663-28664`) prints, on a failed read, an EMPTY 3rd field and `KNOB_WHY` as the
  4th (`printf '%s\037%s\037\037%s\n'`). That US "never" appears in a setting is only a comment (`:28658`): nothing
  enforces it, and `_box_env_unit_whole` admits every byte from 0x01 to 0x7f (`ccd/ccrc:3577`), so a value holding
  0x1f moves its own tail into later fields (review L1). `_test_knobs` (`ccd/ccrc:28667-28676`) reads seven keys in
  file mode and `CCRC_TEST_PRESSURE_MAX` env-first (`:28675`).
- `ccd/testbox-knobs:33-44`: a run-guard (`BASH_SOURCE[0]` against `$0`), then it sources `ccd/ccrc` only when
  `_ccrc_knob` or `_plat_mode` is undefined, so sourcing it from `ccrc` has no nested source. Its one other top-level
  effect is `TB_BOX_ENV_FILE=` (`:47`). `ccd/ccrc` never names `testbox-knobs` today; `ccd/ccrc-test` sources it at
  `:735` and `:792`.
- `ccd/testbox-knobs:112` `_tb_shape`, `:118` its size arm `^[1-9][0-9]*[KMG]$` (unbounded length), `:122-123` the only
  word arms among the 54 (`lostrun` `local|fail`, `fallback` `install|refuse`; `:124` `onoff` belongs to
  `CCRC_TESTBOX_TMPFS`, an omit key), `:138-157` `_tb_shape_says` (no value in the words), `:167-184`
  `_tb_host_table` (16 literal file-mode calls), `:186-215` `_tb_box_table` (28). `_tb_got` (`:218-233`) checks the
  shape only for a non-empty value and keeps a refused value only in `TBK_WARN` (`:226`), so `_tb_load` cannot give a
  verdict. `_tb_load` fills the associative arrays `TBK` (the value), `TBK_FROM` and `TBK_DEF`, keyed by setting name;
  it sets no per-key variable.
- `server/test/testbox-pins.test.ts:246-320`: `git grep -l -E 'CCRC_TESTBOX_|testbox-remote-live'` over everything
  outside `docs/` (itself excluded) must equal `HOLDERS`, the sorted spread of `TB1_HOLDERS` … `TB11_HOLDERS`. `ccd/ccrc`,
  `ccd/ccrc-doctor-checks`, `shared/agent-protocol.ts` and `README.md` are holders already; `shared/api.ts`, every
  box-settings test and fixture, `ccrc-settings-verb.test.ts`, `ccrc-doctor-codex.test.ts` and
  `pwa/test/box-settings-card.test.tsx` are not (review F1).
- The installer-rendered graph directives: `deploy/systemd/ccd-graph-sweep.service:8` (`TimeoutStartSec`) and
  `deploy/systemd/ccd-graph-sweep.timer:8` (`OnUnitInactiveSec`); the spec's `:6-7` and `:2,7` are the comment lines
  naming the settings. Both hold.

**Doctor.**
- `cmd_doctor` (`ccd/ccrc:4247`) sources `$CCRC_HERE/ccrc-doctor-checks` (`ccd/ccrc:4261-4265`), so doctor's checks see
  `ccrc`'s tables and functions with no copy.
- `_check_box-settings` (`ccd/ccrc-doctor-checks:11164-11195`, header `:11145-11163`): the loop is
  `for k in "${CCRC_SETTINGS[@]}"` with `_ccrc_knob "$k" "" file` (`:11169-11171`), which census C4 names exactly
  (`ccrc-settings-census.test.ts:404`, `'_ccrc_knob $k in _check_box-settings'`). `local sweeps=" … "` (`:11166`) is
  pinned by census W29-S9 (`:776-780`). The release-base inline userinfo strip (`:11177-11180`) is the one site
  `inlineUserinfoStrips()` finds (`single-definition/docs-l0.test.ts:450-452`, `census-w5/redactors.test.ts:124-128`,
  both "may only shrink"). A file value prints `$k=$v` whatever its validity (`:11181-11183`).
- `_check_graphify` relays `GK_WARN` (`ccd/ccrc-doctor-checks:4833`): unchanged, under Later.
- `server/test/ccrc-doctorFixture.ts:87` `installCcrc` links `ccrc`, `ccrc-doctor-checks`, `graph-resolve` (`:123`) and
  `ccrc-test`, not `testbox-knobs`.
- Doctor's box-settings rows: `ccrc-doctor-codex.test.ts:6580-6800` (W24-S1 to S14, W29-D1 to D3). W24-S4 (`:6632`),
  S6 (`:6646`) and S13/S14 (`:6751-6760`) pin the release base printed with its path.

**The server, the wire and the lane.**
- `parseBoxSettings` (`server/src/update/boxSettings.ts:97-121`) accepts or refuses a document whole: exactly the
  top-level keys (`:101`), `v === 1` (`:103`), `settings.length === 7` (`:104`), rows rebuilt in `BOX_SETTINGS_KEYS`
  order (`:118`). `rowOf` (`:62-74`) has three row shapes; strings are printable ASCII of at most 512 (`STRING_MAX` `:48`,
  `PRINTABLE_ASCII` `:49`); counts are non-negative safe integers (`:59`). `boxSettingsReadOf` maps a parse `null` to
  `malformed` (`:41-45`); `boxSettingsView` (`:132-139`).
- A version-1 refused row carries the raw value twice: in `value` and quoted in `why`
  (`ok--refused.json`: `CCRC_BACKUP_KEEP='abc' is not…`, `CCRC_UPDATE_HEALTH_S='ninety'…`).
- Version-1 unmeasured whys are `KNOB_WHY` (`ccd/ccrc:21772`, `:21782`) and `BUE_WHY` (`:3661-3667`, `:3714-3721`):
  they name the file as `~/.ccrc/ccrc.env`, a line number and the key, never a value. One is longer than 240
  (`ok--long-sentence.json`: `CCRC_BACKUP_KEEP`'s why is 284 characters), so a version-1 bound of 240 that REFUSED
  would turn an honest wave-1 box `malformed`; the bound is a cut (Task 4). `KNOB_WHY` writes the file's path
  unshortened when `BOX_ENV_FILE` lies outside `$HOME` (`${why/#"$HOME"/\~}`, `ccd/ccrc:21782`), so the server cannot
  prove an unmeasured why holds no path (review L9).
- A version-1 `ok` row is checked today by `isStr` alone (`rowOf`, `boxSettings.ts:62-74`): a file that declares `v: 1`
  passes any printable ASCII of up to 512 bytes as a value (review L4). Every value in the nine `ok--*.json` files fits
  the envelope (`10`, `3`, `90`, `900000`, `250`, `default`, `custom https://releases.example.invalid`).
- L0: `shared/api.ts:9929-9985` is the box-settings block on the `Record<…, true>` idiom: `BOX_SETTINGS_FAILURES`
  (`:9952-9957`), `BOX_SETTINGS_KEYS` (`:9961-9965`) and `BoxSettingKey`, `BoxSettingRow` (`:9968-9971`, `value` on a
  refused row), `BoxSettingsDoc` (`v: 1`, `:9977-9981`), `BoxSettingsRead` (`:9983-9985`). `NodeWire.settings?` is
  optional (`:10016-10018`). `NodeRole` is type-imported at `:9841` (`shared/node-role.ts:9`). `CCD_REFUSAL_TOKENS`
  (`shared/ccd-refusal.ts:37`) is the as-const list precedent for a closed set of sentences.
- `shared/agent-protocol.ts:175-183` states wave 1's refused-value residual.
- `NODE_FILE_CAP_BYTES = 65536` (`server/src/update/inventory.ts:55`), applied by `readNodeFile` (`:115`); the lane test
  pins 70 KiB as `too-large` (`box-settings-read.test.ts:397-399`).
- The lane (`boxSettingsLane.ts:31-40`, `:52-75`) only calls `boxSettingsGate` and `boxSettingsReadOf`; the route joins
  through `boxSettingsView` (`routes.ts:622-628`); the watcher holds the lane (`watch.ts:1080`, `:1766`, `:2142`). None
  needs a change.
- `rings/wire-totality.test.ts:36` requires a `Record<X, true>` map for every exported literal union in `shared/*.ts`
  (`EXEMPT_PINNED = 28`). No ring data file names `boxSettings.ts`: it is L1 by its imports.

**The test corpus.**
- `server/test/fixtures/box-settings/`: 9 `ok--*.json` from the real verb, regenerated by `BOX_SETTINGS_FIXTURES=write`
  (`box-settings-read.test.ts:8-9`), and the regeneration row asserts each file equals the live output
  (`:135-143`); 18 `malformed--*.json` (the corpus row needs at least 15, `:117`). The corpus row pins `doc.v === 1` and
  the seven keys (`:120-131`); the live-verb row is `:145-154`; `base()` `:157`; the forgery table `:156-187`, with
  `'version 2'` at `:163`; the word extractor `:201-215` (`verbKeys` `:212-215`); `:244` pins the bash
  `BOX_SETTINGS_KEYS` line; `:250-251` the vocabulary row's `live!.settings`; route helpers `box()` `:527`, `CAPS_WITH`
  `:545`, `docAt` `:546`.
- `server/test/box-settings-read.test.ts:19` imports `ccrcSettingsNames` from `ccrcSettingsLine.ts`; wave 1's plan's
  "Census C4" As built bullet (`docs/superpowers/plans/2026-10-25-box-settings-view.md:666-669`) names only two
  importers. D-7873 is defined at `:592-610` of that plan (review 1403 F4).
- `ccrc-settings-carveouts.test.ts`: `sourced(home, script, extra = {})` (`:44-51`) runs
  `bash -c '. "$1"; <script>' ccrc-under-test <ccd/ccrc>`, so `$1` is the ccrc path and no positional argument reaches
  the script. A row hands its inputs in as exported environment variables through `extra` (assigned after the
  setting names are deleted), or inlines literal arguments into `script`.
- `ccrc-settings-verb.test.ts`: `:38` the seven names `envOf` deletes; `:104-116` the defaults row; `:140-197` and
  `:258-329` assert a refused row's raw value and sentence; `:200-213` the NUL row; `:398-403` the `_upd_url_origin`
  rc-1 loop; `:415` `FORBIDDEN = ['deploy','s3cr','pw','tok','u:']`; `:416-430` the custom-alone `it.each`; `:613-644`
  the human form; `:831-844` the state, from and reader words as one-time locals.
- `ccrc-settings-census.test.ts:78` `FILES=['ccd/ccrc','ccd/ccrc-doctor-checks']`. C1's regex `^\s*CCRC_SETTINGS\+?=`
  does not match `BOX_SETTINGS_TABLE=`. C2 (`:359`) fails a setting whose literal calls carry more than one distinct
  default. C4 (`:394-405`) expects exactly two variable-key calls (`_keep_knob`'s `$1` and `_check_box-settings`' `$k`).
  W29-A1's `BODIES` (`:790`) holds 7 functions, about 11 `=~` lines in `ccd/ccrc` plus 2 sibling lines
  (`ccd-usage-sweep:44`, `ccd-telemetry-keepalive:285`), against a floor of `seen >= 11`. The census extracts
  `TESTBOX_BOX_KEYS` at `:104-106`. The README paragraph `**ccrc's own settings.**` (`README.md:1307`) must name every
  member (`:308-313`, `:373-378`).

**The card.**
- `readDoc` refuses `v !== 1` (`pwa/src/fleet/boxSettingsWords.ts:95`); `readRow` (`:70-79`) requires a string `value`
  on ok and refused rows (`:75-77`); `boxSettingsOf` (`:114`) maps `null` to `'unrecognised'` (`:120-121`), worded
  "This box's settings came in a form this console does not read." (`:37`). `settingLine` (`:136-141`) renders
  `row.value` for a refused row (`:141`). The hard-coded server case is `:137`
  (`role === 'server' && row.key === MODELS_BUDGET_KEY`), its constants at `:55-57`. The note under the card is
  `BOX_SETTINGS_TEXT.how` (`:64`).
- `BoxSettingsCard.tsx`: one flat `<dl>` per node (`:26-40`); each node block is `role=group` labelled by its `h4`
  (`:51-57`); `Readout` `:19`, `NodeBlock` `:47`, `BoxSettingsCard` `:69`.
- `pwa/tsconfig.json` includes `src`, `test` and `../shared`, so the PWA's `tsc` compiles the card test: its type
  import (`:6`, `BoxSettingRow`, `BoxSettingsDoc`), `okRows(): BoxSettingRow[]` and `doc(): BoxSettingsDoc` (`:32-47`),
  and the refused literal with `value: 'abc'` (`:100`). `settingLine` returns `row.value` for every non-unmeasured row
  (`boxSettingsWords.ts:140`); `readDoc` builds `{ v: 1, …, settings: BoxSettingRow[] }` (`:94-109`). No other PWA file
  names `BoxSettingRow` or `BoxSettingsDoc` (`BoxSettingsCard.tsx` names `BoxSettingsRead` only).
- `pwa/test/box-settings-card.test.tsx`: the seven rows hand-listed at `:32-40` (`okRows`/`doc` `:32-47`); the term
  count `:65` (`within(b).getAllByRole('term')`, the one role query over rows); block order `:84-88` (`getAllByRole('group')`); the note regexes `:92-93`; the raw refused value shown
  `:107-108`; the server budget row `:151-158`; `:198-205` a non-string value; the no-control pin `:235-239`; `:250`
  pins only `/reported by the box/`.
- `@testing-library/dom` 10.4.1 with `aria-query` 5.3.0 (`pwa/package-lock.json:3544-3545`, `:3993-3994`): `details` is
  a related concept of `group`; `summary` is not a `button`. So every `details` is an extra `role=group` in tests.
  jsdom is 30.1.3 (`:6110-6111`).
- The fold idiom `details.settings-release-fold > summary` (`pwa/src/screens/updates.tsx:494`, `:576`, `:613`;
  `pwa/src/fleet/TestBoxSection.tsx:282`); its CSS `pwa/src/fleet/fleet.css:3515-3540` (tap floor, chevron,
  reduced-motion guard), pinned at `pwa/test/settings-screen.test.tsx:3040-3043`. The card's CSS block is
  `fleet.css:4234-4251`. `role-census` pins `.box-settings-key` and `.box-settings-why` as META
  (`pwa/test/role-census.test.ts:253-254`) inside `APP_ROLE_RULES` (`:209`). The danger ink is registered at
  `pwa/design/audit.mjs:1122`.
- `UPDATES_CARDS` (`pwa/src/screens/settings/UpdatesSection.tsx:132`) and the card mount (`:348`) are already right.
  The card's purpose text is `pwa/src/fleet/settingsText.ts:288`. The C7 ring row already lists both card files
  (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md:248`).

**Growth.** `ccd/ccrc` (`server/test/growth-check.test.ts:61`), `server/src/watch.ts` and `pwa/src/lib/api.ts` (`:68`)
are growth-checked at 40 net code lines (`server/test/growthCheck.ts:48`), armed (`growth-check.test.ts:54`);
comments and blank lines do not count (`measureBash`, `growthCheck.ts:149-172`). A waiver is one JSON file in
`server/test/growth-waivers/` with exactly `{file, maxDelta, d, reason, added}` (`growthCheck.ts:335`; precedent
`D-6918-ccd-ccrc.json`, `maxDelta` 203), counted only when added in the PR's own diff. `ccd/ccrc-doctor-checks`,
`ccd/ccrc-test`, `ccd/testbox-knobs`, `ccd/graph-resolve`, the sweeps and `ccd/lib/ccrc-settings.sh` are not listed.
By the per-step figures in Task 2, `ccd/ccrc`'s net growth crosses 40 at Task 2's Step 4 (+24, +5, +7, +6 = 42), so a
waiver created only at the end of Task 2 would leave Steps 4 to 6 red (review F6, E3).

**`single-definition`** is a directory, `server/test/single-definition/` (21 files), beside
`server/test/single-definition-pin.test.ts`; there is no `single-definition.test.ts`. Every gate below runs the
directory whole (`test/single-definition/`) and the pin.

**README** (wave 1's hunks, at `ffa9f0ab2`): the units row `README.md:508`; the verb row `:1230` ("what seven of
ccrc's settings resolve to"); the doctor sentence `:1330-1331`; "Seeing a box's settings" `:1366-1383` (`:1370` reads
"or the scheme is not http or https", true once F1 lands); the node-file sentence `:3769-3772`.
`server/test/citations.test.ts` refuses any numeric line citation in lines a branch adds.

## The decisions

D11 to D22 are the spec's (section 3, approved as proposed 2026-11-04). This plan builds them as written.

| # | Agreed | Spec |
|---|---|---|
| D11 | Show every setting a fleet or server node reads: 54 more, 61 in all; the test box's own 28 are left out | 5.1 |
| D12 | One display class per setting: `value`, `origin`, `presence` or `omit`; the class decides what may leave the box | 5.1 |
| D13 | Every verdict calls the owner's check; checks that cannot be called move into `ccrc` (the keepalive and usage checks also into the generated library), characterization first; checks with no value-free words gain them | 5.2 |
| D14 | A refused row of any class records its source and its check's words, never the value; wave 1's seven included | 5.3 |
| D15 | Version 2, read beside version 1, rolled out `--server-first`; a wave-1 console tab reloads | 5.4 |
| D16 | The class table lives in `ccd/ccrc` beside `CCRC_SETTINGS`, mirrored in L0 | 5.4 |
| D17 | The card groups by family in native `details` folds, open when a row needs attention; no control | 5.5 |
| D18 | Doctor prints by the class table: a passing value, `KEY (refused: <words>)`, a presence as set, an omit not at all | 5.6 |
| D19 | `CCRC_TESTBOX_URL` is `presence` | 5.1 |
| D20 | Every wave-2 setting is read from `ccrc.env` alone; install-time settings are labelled | 5.7 |
| D21 | A server-role node shows one folded line per fleet-only family, "not used on this role" | 5.5 |
| D22 | A refused row's `why` is a member of a closed set of the checks' words, mirrored in L0 and checked by the server | 5.4 |

### Coordinator rulings for this plan

These govern over anything else in this file.

**Review folds (2026-11-04).** The plan review's three lenses (L leak, F facts, E executability), every finding folded
as the coordinator ruled:
- **L1:** a graph or test-runs line is split into all its fields; a read failure is an empty value field, never a 4th
  field; a line of other than four fields, or a value holding 0x1f, is `unmeasured` with a fixed sentence (Tasks 3, 5).
- **L2, E2:** W2-D10 sweeps every non-omit key except the origin; the release base gets a fixed URL whose origin alone
  shows (Task 7).
- **L3:** doctor calls `_set_fits` for value and origin rows: `KEY (wider than this view records)` / `KEY=custom`;
  new W2-D11 and mutant T7-M7 (Task 7, Global constraints).
- **L4:** the server checks version-1 rows against the same L0 table and envelope: out of the envelope becomes
  `unmeasured` with `BOX_SETTINGS_V1_UNFIT_WHY`, an unmeasured why is cut to 240; D-7911 names three rewrites (Task 4).
- **L5, E6:** `_set_check`'s order is fixed: no check (rc 2), then a library that did not load (rc 2), then empty
  (rc 0), then the check; both orders pinned (Task 3).
- **L6:** server forgeries for an empty `value` on a presence and a refused row, and a truthiness mutant (Task 4).
- **L7, F13:** `_set_json <text> [<max>]`; `_set_row_json` passes 240 for a why (Tasks 3, 5).
- **L8:** Task 5's equivalent mutant is replaced by one that makes the refused shape emit a value.
- **L9:** README and agent-protocol say an unmeasured why is bounded, not checked against a closed set (Tasks 4, 8).
- **L10:** the origin shape needs a non-empty host; `custom https://` is outside it (Tasks 3, 5).
- **L11:** every verb row that plants a value also asserts stderr is free of it (Task 5).
- **L12:** `_set_fits` applies to every `ok` value and origin row, wave 1's seven included (Task 5).
- **F1:** a named `BOX_SETTINGS_W2_HOLDERS` list in `testbox-pins.test.ts` grows in every commit that adds a holder;
  `testbox-pins` joins those tasks' claims and gates (Tasks 3 to 7, 8).
- **F2, E1:** the bash `BOX_SETTINGS_KEYS` literal retires in Task 5, not Task 3; Task 3 adds a T9 row holding the
  table's first seven equal to it; D-7910 moves to Task 5.
- **F3, E9:** Task 5 replaces the `verbKeys` control with the emitted key list against `BOX_SETTINGS_SHOWN` and a
  dropped-table-line control.
- **F4:** the human form keeps its three `printf '%-30s …'` formats; a longer key overruns by one space; new
  `CCRC_GRAPH_INCREMENTAL_MAX_FILES` row (Task 5, V8).
- **F5:** the "1 to 16 lowercase letters" rule is gone; `BOX_SETTING_VALUE_WORDS` gains a bash mirror and moves to
  Task 3 with D-7914; `_set_fits` admits a key's own words only; one differential corpus (Tasks 3, 4).
- **F6, E3:** D-7906's waiver is created by the first commit that crosses the armed limit; every commit is gated armed
  (Tasks 1, 2).
- **F7:** `sourced()` takes no positional arguments; rows pass inputs as exported variables through `extra` (Tasks 1, 2).
- **F8, E7:** Task 6 Step 1 measures jsdom on closed `details` and says what `:65` does for each outcome.
- **F9, E5:** Task 5 rewrites the usage paragraph, the installer comment and the header's "seven", and the three pins.
- **E4:** Task 4's PWA follow-through covers every file `pwa` tsc compiles, `pwa/test/` included; `settingLine` handles
  a row with no value; pwa tsc runs in each Task 4 commit's gate.
- **F10, E8:** `single-definition` is run as the directory everywhere.
- **F11, E14:** `TBK[<KEY>]`/`TBK_FROM[<KEY>]`; review focus 5 names Task 2 alone.
- **F12:** `_test_knobs` is `ccd/ccrc:28667-28676`, `_test_knob_say` `:28663-28664`, everywhere.
- **F14:** `familyLine` spells its family-name prefix (Task 6).
- **F15:** one line scope for the card test in Task 4's Files and claims.
- **F16:** the empty rule is stated per consumer; the `updates` arm masks `ccrc.env` for the resolver it calls; pinned
  (Task 3).
- **F17:** a W1 row proves every refusal word survives `_set_text`/`_set_json` byte for byte, and V4 runs over every
  key with words (Tasks 3, 5).
- **E10:** rows already green at their step are written as characterization (Tasks 3, 4, 7).
- **E11:** `deviation-refs` runs after every commit that defines a number (Tasks 2 to 7).
- **E12:** a `## Later` section, copied into the PR body by Task 8.
- **E13:** both wave-1 plan hunks ride one `docs(plan)` commit (Task 1).

**Names (C1, C2).**
- The moved checks and their words: `_keepalive_fresh_ok`/`_keepalive_fresh_says`, `_usage_days_ok`/`_usage_days_says`,
  `_carry_warn_bytes_ok`/`_carry_warn_bytes_says`; `_tshape`/`_tshape_says` keep their names; `_slice_limit_says`;
  wave 1's `_keep_says`, `_upd_health_says`, `_upd_deadline_says`, `_models_budget_says`.
- L0: `BOX_SETTING_TABLE` (an object keyed by name), its widened view `BOX_SETTING_SPECS` (C18),
  `BOX_SETTINGS_SHOWN`, `BOX_SETTING_REFUSAL_WORDS`, `BoxSettingName`, the column `applies: 'run' | 'update'`, the
  family `testbox`. There is no `BOX_SETTINGS_V2_KEYS`: it would be a second copy of `BOX_SETTINGS_SHOWN`.

**Ownership.**
- Every words function is Task 2's, the moved checks' and wave 1's four alike (C6). Task 1 holds the K1, K2 and H1
  characterization pins of `_keep_why`, `_keep_knob` and `_upd_health_s`.
- Task 3 holds every piece of L0 the server and the card need before they are built (C11): the table, the view, the
  shown list, the refusal words, the value words (`BOX_SETTING_VALUE_WORDS` with its bash mirror, D-7914, review F5),
  the cut constants and the value and origin envelope (C4).
- Task 3 exports `_set_check <KEY> <value>`: rc 0 pass, rc 1 refused, rc 2 the check could not run (C3). The verb
  (Task 5) and doctor (Task 7) both call it. rc 2 is never folded into rc 1. It also exports `_set_fits`, which the
  verb and doctor both call on every `ok` value and origin (review L3, L12).
- Task 4 owns the `shared/agent-protocol.ts` paragraph and writes it once for both versions (C10). Task 4 makes the
  PWA compile follow-through for every file the PWA's `tsc` compiles, `pwa/test/` included (review E4): the refused
  arm without `value`, `BOX_SETTINGS_TEXT.refused`, a row with no `value` in `settingLine`, `readDoc`'s row type, the
  card test's fixture types and refused literal, and card test line `:108` inverted. Task 6 owns `boxSettingsWords.ts`
  beyond that, and keeps line `:108` as Task 4 left it (C9).
- Task 5 switches the verb to version 2 and, in the same commit, retires the bash `BOX_SETTINGS_KEYS` literal
  (D-7910), regenerates `ok--*.json`, rewrites the usage text that says "seven" and raises the waiver (C8; review F2,
  E1, F9, E5).
- Every commit that adds the string `CCRC_TESTBOX_` to a tracked file outside `docs/` adds that file to
  `BOX_SETTINGS_W2_HOLDERS` in `server/test/testbox-pins.test.ts` in the same commit, and the task claims that test
  (review F1).
- The README is Task 8's.

**Moves (Tasks 1 and 2).**
- F3's header clause and F4's third importer are corrected in place in the merged wave-1 plan, each marked
  "(review 1403 F3/F4, corrected in wave 2)".
- The keepalive's words are "a whole number of seconds from 0 to 9223372036854775807".
- `_tshape` stays out of W29-A1's `BODIES`; its `[0-9]` ranges go under Later (enumerating them changes behaviour).
- A sweep whose library lacks a moved function fails closed through rc 127, with `LOADER` unchanged, and each sweep's
  suite has a row proving it.
- The install echo (`ccd/ccrc:17637`) stays as written.
- One growth waiver for `ccd/ccrc` in the whole PR, `D-7906`: created in the first commit that takes `ccd/ccrc` past
  the armed limit (Task 2's Step 4 by this plan's figures), with that commit's measured delta, raised in every later
  commit that grows the file, finalized in Task 8. Every commit's armed growth gate is green (review F6, E3).

**The table and the verb (Tasks 3 and 5).**
- `applies` is a column of both the bash table and L0, held equal by the mirror test. It is not a wire field.
- The 28 omitted names carry roles `[]` (bash `none`) and `applies: 'run'`.
- The verb reads every wave-2 setting by its own literal `_ccrc_knob <KEY> <default> file` call (or the owner's own
  literal reader: `_graph_knobs file`, `_test_knobs`), with census C2 holding each default pair equal. No
  `testbox-knobs` change.
- Any `ok` value or origin outside the envelope is written as `unmeasured` with a fixed why naming the limit (D-7909).
  `_set_fits` applies uniformly to every `ok` value and origin row, wave 1's seven included (review L12).
- A read failure is decided by the value field, never by a 4th field: a failed read prints an empty 3rd field
  (`_test_knob_say`'s rc≠0 arm). On a successful read, a `KNOB` holding 0x1f, or a line with other than four fields,
  is `unmeasured` with the fixed `<KEY>'s value holds a control byte this view does not record`, naming the key only.
  This holds for every reader the verb splits on a separator (`_test_knobs` and `_graph_knobs`, both through
  `_set_lines`) (review L1).
- The bash `BOX_SETTINGS_KEYS` literal stays until Task 5's switch commit (D-7910 is Task 5's); until then Task 3's T9
  holds the table's first seven shown names equal to it (review F2, E1).
- The human form keeps its three existing `printf '%-30s …'` formats byte for byte (`ccd/ccrc:26228-26234`); a key
  longer than 30 characters prints with the format's one literal space and no padding (review F4).
- Empty means the default: no per-setting flag. Task 5 adds one row per family with an empty line, proving that each
  consumer whose read the verb copies treats empty as its default. If one does not, Task 5 stops and the worker asks.

**The server (Task 4).**
- The server rewrites three kinds of version-1 row in L1, and forwards none of them as the box wrote it (C13, D-7911,
  widened by review L4): a refused row loses its value and its `why`, which becomes the fixed
  `BOX_SETTINGS_V1_REFUSED_WHY`; an `ok` row whose value or origin is outside the envelope (checked by the same L0
  table and envelope as version 2) becomes `unmeasured` with the fixed `BOX_SETTINGS_V1_UNFIT_WHY`; an `unmeasured`
  row's `why` is bounded at 240 as D-7913 bounds a version-2 one, by a cut (237 bytes and `...`, the writer's own cut
  form), because an honest wave-1 box writes up to 480 (`ok--long-sentence.json`).
- A wave-1 console tab reads a version-1 node holding a refused row as unrecognised, as well as every version-2 node.
  Accepted; the same reload cures it, and the rollout note says so (D-7912).
- An `unmeasured` row's `why` is bounded (printable ASCII, at most 240 bytes), not a closed set (D-7913). Every text
  that describes it says "bounded", never "checked against a closed set" (review L9).
- A setting's fixed value words live in their own L0 constant, `BOX_SETTING_VALUE_WORDS`, with a bash mirror in
  `ccd/ccrc`, both built in Task 3 (D-7914; review F5). The writer and the server accept the same words: a key's own
  words, nothing else.
- Reader first: Task 4 lands before Task 5's switch commit.

**The card (Task 6).**
- `applies` in both tables (C14). A row whose key is not in the L0 table shows in a trailing "Other settings" group
  with its source word and never a value; its comment says this wave's server never sends one (C19, D-7915).
- On a server-role node, a fleet-only family's line counts its refused and unmeasured rows ("Graph: 23 settings, not
  used on this role, 1 refused"), with no rows (C12, D-7916).
- Wave 1's "not used on a server box" becomes "not used on this role", one wording derived from the role column
  (D-7917).

**Doctor (Task 7).**
- The release base goes through `_upd_url_origin`; the inline userinfo strip retires; both census pins become `[]`;
  doctor no longer prints the base's path (D-7918).
- A refused setting stays PASS with rc 0, printed `KEY (refused: <words>)`; doctor's rc does not change.
- A reader refusal of an omit key still WARNs (it names the key and line, never the value).
- rc 2 from `_set_check` prints `KEY cannot be measured: <words>`, never `refused`, and WARNs.
- Doctor calls `_set_fits` for the `value` and `origin` classes. A value that fails it prints
  `KEY (wider than this view records)`; an origin that fails it prints `KEY=custom` (review L3).
- The carry-copies WARN uses its words function and drops `got '<value>'`; Task 1's carry pins are rewritten in the
  same commit (C7, D-7919).

**Numbers.** D-7906 to D-7925 are issued to this programme. Each is defined once, by the task that builds it (table at
the end). D-7920 to D-7925 are spare: a task that needs a departure takes the next spare and says so in its wave-done.

### Reconciliations made in assembly

Four gaps the drafts, the critic, the rulings and the plan review left open, settled here so no step is a question.
The reviewer should probe them.
1. **`_set_check` on wave 1's seven.** Their checks live inside resolvers that read the setting themselves
   (`_keep_knob`, `_upd_health_s`, `_upd_deadline_ms`, `_models_budget`), and no value-taking check exists. To call
   the owner's check without restating it, `_set_check`'s `updates` arm runs the key's own resolver in a subshell
   with the value handed in as that key's environment value and `ccrc.env` masked, in a literal per key
   (`( BOX_ENV_FILE="$BOX_ENV_FILE/." CCRC_BACKUP_KEEP="$2" _bak_keep >/dev/null 2>&1 )`; `"$f/."` is the path that
   cannot exist which `_ccrc_knob` already uses for the exposure file). `_ccrc_knob`'s environment-first read
   (`KNOB="${!key:-}"`) makes the resolver judge exactly that value; because it treats an EMPTY environment value as
   unset and would then read the file, an empty value never reaches the resolver (it answers rc 0 first, below), and the
   mask keeps the file out even so (review F16). Task 3 pins it, with a `ccrc.env` holding a different value. If any
   census row refuses that form, stop and ask the coordinator.
2. **The envelope and the fixed words.** The envelope (C4) is the two shapes plus each key's own fixed words.
   `CCRC_TESTBOX_LOST_RUN` and `CCRC_TESTBOX_FALLBACK_INSTALL` have word values (`local`, `fail`, `install`, `refuse`)
   that no digits-and-unit shape admits. `BOX_SETTING_VALUE_WORDS` (L0) has a bash mirror, `BOX_SETTING_VALUE_WORDS`
   in `ccd/ccrc`, and one test holds L0 equal both ways to the mirror and to `_tb_shape`'s word arms. `_set_fits`
   admits a word value for a key only if that key has words in the mirror and the value is one of them; the server
   admits exactly the same (shape, or the key's own words). There is no letters-only rule (review F5).
3. **The cut.** An `ok` value or origin is never cut: `_set_fits` refuses anything over `BOX_SETTINGS_TEXT_MAX` bytes,
   so a `...` never lands inside a value the server checks. A `why` is still cut at 240.
4. **`_set_check`'s order** (review L5, E6, F16). (1) An `omit` key or a name outside the table: rc 2. (2) A `graph` or
   `testbox` key whose library did not load: rc 2, whether the value is empty or not, so a family whose library did
   not load reads every one of its keys `unmeasured`. (3) An empty value: rc 0, for every key whose consumer treats
   empty as its default (every shown key: Task 5's V10 proves it per family). (4) The owner's check.

## Global constraints

- **No behaviour change to any setting.** No default, range, reader, validator or refusal changes. Every check that
  moves answers exactly as before, pinned first (Task 1), and every existing suite of its consumer stays green with no
  assertion edited (the one exception is D-7919's carry sentence, Task 7). `_ccrc_knob`, `_keep_knob`, `_box_unit_env`
  and `CCRC_SETTINGS` are called, never edited.
- **Literal calls only.** Every read is a literal `_ccrc_knob <KEY> <default> file` (or wave 1's resolvers, or the
  owner's literal reader). Never `_ccrc_knob` with a variable key: census C4's expected list stays exactly two. The
  class table only shapes what is written. Doctor's existing `_ccrc_knob "$k" "" file` loop is the one allowed variable
  site and keeps its form.
- **Never `TBK_WARN` or `GK_WARN`.** The verb and its `_set_*` helpers never name `TBK_WARN`, `GK_WARN`, `_tb_load`,
  `_gr_knobs` or `_slice_limit ` (with a trailing space). Doctor's graph check still relays `GK_WARN` (Later).
- **No value leaves the box** except an `ok` row's value or origin inside the envelope: not in the snapshot, the
  verb's stdout, stderr or human form, the server's held read, the route's body, the card, or doctor's line (doctor
  applies the same envelope through `_set_fits`). A `presence` row never carries a value; a `refused` row carries a
  closed-set `why`; an `unmeasured` row's `why` is bounded text the box wrote (printable ASCII, at most 240 bytes): the
  reader's sentences name the file, a line and the key, and the fixed sentences this wave adds name only the key, but
  the server bounds that text and cannot prove it holds no value or path (D-7913, review L9).
- **Rings.** Ring membership is a file's imports. `shared/*.ts` imports nothing (L0); `server/src/update/boxSettings.ts`
  stays L1 (imports `shared/` only, no `fs`, no clock); `boxSettingsWords.ts` is pure. No module-level mutable state.
- **Wire: additive.** `FLEET_PROTO` is not bumped. `NodeWire.settings` keeps its name and optionality. A newer field is
  read through one reader.
- **No new surface.** No route, agent op, exec-whitelist entry, box-token door, coord.db column or `ccd caps` word is
  added. No act reads `box-settings.json`.
- **Growth.** `ccd/ccrc` grows under the one waiver `D-7906`, re-measured at every commit that touches it. The waiver
  file is created by the first commit whose measured net growth exceeds 40, with that commit's delta, and raised in the
  same commit by every later one that grows the file; growth runs armed after every such commit, green.
  `server/src/watch.ts` is not touched; `pwa/src/lib/api.ts` grows by 0 lines. Run growth armed:
  `ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`.
- **Fixture HOMEs only.** Every bash case runs in a `mkTmp` fixture HOME through `ccrcContainedEnv` (or the suite's
  own harness). Never run `ccrc`, `ccd` or a sweep against the live `$HOME`. Quote fixture paths.
- **Every run through `ccrc test`, with `--maxWorkers=2`, in the foreground**, from the package directory:
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>` (likewise `pwa/`, `agent/`).
  Type checks: `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .` and, in `server/`,
  `ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`. Re-run a known load flake in isolation
  before calling it a break.
- **Mutants** run on a saved copy (sha recorded), restored from that copy and checked with `cmp`. Never
  `git checkout`. Record each mutant's red rows in As built.
- **Citations.** Comments added in code and tests cite symbols, never `file:NNN` (`citations.test.ts`).
- **Public repository.** No host name, home path, account or lane name, tailnet name, Linear link or real name in any
  file, commit, branch, PR text or mail.
- **Deviation refs.** After each commit that defines a number (in Tasks 2, 3, 4, 5, 6 and 7; each such commit step
  names it): `git fetch origin main`, then
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/deviation-refs.test.ts` (it reads tracked files
  only, so commit first).
- **Test-box holders.** `server/test/testbox-pins.test.ts` holds the exact list of tracked files outside `docs/` that
  spell `CCRC_TESTBOX_`. Task 3 adds `const BOX_SETTINGS_W2_HOLDERS = [ … ]`, spread into `HOLDERS`, with a comment
  naming D11 and D12 (the shown test-box settings and their classes); each later task appends the files it makes
  holders, in the same commit, and runs `testbox-pins`. A growth waiver's `reason` names no test-box key.
- **Characterization.** A row that is already green at the step that writes it is written as characterization
  ("green at Step N, stays green"), never as red-first.

## Review focus

1. **A refused value goes nowhere.** For every key with words, the raw text is absent from the verb's stdout, stderr,
   the file and the human form (Task 5, V4); a value holding a unit separator never splits into a `why` (Task 5, the L1
   rows); the server drops a version-1 refused row's value and why (Task 4); the card
   never renders a refused value from either version (Tasks 4 and 6, F6); doctor prints the words only (Task 7, W2-D2).
2. **A presence row never carries a value.** The verb writes none (Task 5, V3), the server refuses one (Task 4), the
   card never renders one even when the wire carries it (Task 6, F7), doctor prints `(set)` (Task 7, W2-D3).
3. **The closed refusal words.** `BOX_SETTING_REFUSAL_WORDS` equals, both ways, the words `_set_says` prints for the 61
   (pinned in Task 3, W1); the server refuses a `why` outside it (pinned in Task 4).
4. **The envelope.** A value that passes its check but is longer than 32 digits (a 40-digit size), or an origin like
   `custom h:abc`, or `custom https://`, is written `unmeasured`, never `ok` (pinned in Tasks 3 and 5); the server
   reads such a version-2 `ok` row as `malformed` and rewrites a version-1 one as `unmeasured` (pinned in Task 4);
   doctor prints neither (Task 7, W2-D11); the envelope strings are byte-equal in bash and L0, and the writer and the
   server give the same answer on one differential corpus (pinned in Tasks 3 and 4).
5. **The moves preserve behaviour.** Every Task 1 pin stays green, unedited, through Task 2; a library missing a moved
   function fails closed through rc 127 (pinned in Task 2).
6. **File mode.** A wave-2 setting set only in the environment reads its default; wave 1's seven keep their mode
   (pinned in Task 5, V2).
7. **`_set_check` keeps three answers apart**, including rc 2 when `graph-resolve` or `testbox-knobs` cannot load
   (before the empty rule, so an empty value of such a family is rc 2 too), and judges the value it is given, not the
   file's (pinned in Task 3; doctor's use in Task 7, W2-D9).
8. **Size.** The largest document the writer can produce and the largest the server accepts both fit under the 64 KiB
   node-file cap (pinned in Tasks 4 and 5).
9. **The card holds no control** with summaries present; families come from the table; a server-role node's fleet-only
   families are one line each, with their refused and unmeasured counts (pinned in Task 6).
10. **A scheme after a userinfo** (`user:pw@ftp://h/r`) reads rc 1 from `_upd_url_origin`, and the release base shows
    `custom` alone (pinned in Task 1).

---

### Task 1: review 1403's carried findings, and characterization pins for every check that moves (review 1403 F1, F3, F4)

Review 1403's F1, F3 and F4 are carried here. Then come the pins: each fixes a consumer's exact answers, is green on
`main` before anything moves, and stays unchanged through Task 2. Every pin goes in the consumer's own suite, beside
the harness that suite already has, so a move commit touches no pin, and the pin reads only what the consumer prints.
This task defines no number; F1 and F3 extend D-7873's existing entry in the wave-1 plan.

**Files:**
- Modify: `ccd/ccrc` (`_upd_url_origin` at `ccd/ccrc:2963` and its header at `ccd/ccrc:2937-2962`).
- Modify: `docs/superpowers/plans/2026-10-25-box-settings-view.md`: D-7873's entry (`:592-610`) gains one clause, and
  the As built "Census C4" bullet (`:666-669`) gains the third importer.
- Test: `server/test/ccrc-settings-verb.test.ts` (F1 rows); `server/test/ccrc-test-wrapper.test.ts`,
  `server/test/telemetry-keepalive.test.ts`, `server/test/usage-sweep-runner.test.ts`,
  `server/test/ccrc-doctor-carry-copies.test.ts`, `server/test/slice-limits-config.test.ts` and
  `server/test/ccrc-settings-carveouts.test.ts` (the pins).

**Claims to take:** `ccd/ccrc`, `docs/superpowers/plans/2026-10-25-box-settings-view.md`, and the seven test files
above.

**Why F4 goes in the wave-1 plan file.** Its As built section is the record of what wave 1 built, and that record is
wrong by omission: `server/test/box-settings-read.test.ts:19` imports `ccrcSettingsNames` from `ccrcSettingsLine.ts`.
A correction in this plan would leave the record false where people read it. F3's clause goes inside D-7873's existing
definition, because that is where D-7873 is defined; it adds no number, and `deviation-refs` still sees one definition.

- [ ] **Step 1: Write the failing F1 rows** (`ccrc-settings-verb.test.ts`):
  - In the `_upd_url_origin` rc row's loop at `:398-403` (which asserts `{ code: 1, out: '' }`), add
    `'user:pw@ftp://h/r'`, `'tok@ftp://h'`, `'user:pw@ftp://mirror.example.invalid/r'` and
    `'tok@ftp://mirror.example.invalid'`. On `main` the first prints `ftp://h` with rc 0, so the rows are red.
  - A positive control in the same `it`:
    `expect(rc('user:pw@https://mirror.example.invalid/r')).toEqual({ code: 0, out: 'https://mirror.example.invalid' })`.
    Run it on `main` first: it must be green there and stay green. If `main` answers anything else, stop and report.
  - Two rows in the "custom alone" `it.each` at `:416-430`: `'user:pw@ftp://mirror.example.invalid/r'` and
    `'tok@ftp://mirror.example.invalid'`. Each must read `{ state: 'ok', value: 'custom', from: 'environment' }`, and
    `FORBIDDEN` (`:415`) must not appear in stdout, the file or the human form. On `main` they record
    `custom ftp://mirror.example.invalid`, so they are red.
- [ ] **Step 2: Run them and see them fail.**
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-settings-verb.test.ts -t "_upd_url_origin|custom"`
- [ ] **Step 3: Fix `_upd_url_origin`.** Spell the http(s) pattern once, as a local next to `sre`
  (`hre='^[Hh][Tt][Tt][Pp][Ss]?://$'`), and use it at both scheme matches:
  - the raw value's match at `:2966` becomes `[[ "${BASH_REMATCH[0]}" =~ $hre ]] || return 1`;
  - the redacted value's match at `:2969` becomes
    `if [[ "$s" =~ $sre ]]; then scheme="${BASH_REMATCH[0]}"; [[ "$scheme" =~ $hre ]] || return 1; s="${s#"$scheme"}"; fi`.

  The net code-line change is 0.
- [ ] **Step 4: F3: reword the header.**
  - The first sentence at `:2937-2938` becomes: "a URL's scheme and host, nothing else (D-6914, D-7873): the RAW value
    is screened first by the rules below, then `_upd_redact` runs (so an ordinary userinfo goes by ITS rules, none
    restated here), then the `<scheme>://` if there is one, then the authority up to the first '/', '?' or '#'."
  - The sentence "Only `http://` and `https://` show as a scheme…" (`:2955-2956`) gains: "tested on the raw value's
    leading scheme and again on the redacted value's, so a scheme after a userinfo (`user:pw@ftp://h/r`, `tok@ftp://h`)
    reads rc 1 too (review 1403 F1)".
  - `README.md:1370` and the verb header (`ccd/ccrc:26100-26102`) are now true as written; neither is edited.
- [ ] **Step 5: Edit the wave-1 plan.**
  - Append to D-7873 (`:592-610`): "Extended by review 1403 (F1, F3; corrected in wave 2): the http(s) test also runs on
    the redacted value's scheme, so a scheme that follows a userinfo reads rc 1. The header's first sentence now says
    that the raw value is screened before `_upd_redact`. The fix lives in `_upd_url_origin`, not `_upd_redact`: the
    redactor is the one shared choke point that every log line, die and report detail passes through;
    `ccd/ccd-update-sync` carries a generated byte copy of it; and `log-line-redact-corpus.test.ts` pins its KNOWN
    LIMITS rows. The stronger promise (no userinfo byte at all) belongs to this one consumer. (review 1403 F3,
    corrected in wave 2)"
  - "Census C4" (`:667-668`) becomes: "…which `ccrc-settings-census`, `ccrc-update-flip-backups` and
    `box-settings-read` import (review 1403 F4, corrected in wave 2)."
- [ ] **Step 6: Run and mutate F1.**
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-settings-verb.test.ts` (green),
    then `test/log-line-redact-corpus.test.ts` and `test/ccd-update-sync.test.ts`, which must not change
    (`_upd_redact` is untouched).
  - **Mutant M-F1:** delete `[[ "$scheme" =~ $hre ]] || return 1` from the second match. The four new helper rows and
    the two new custom-alone rows go red.
- [ ] **Step 7: Growth, then commit.** Run growth armed
  (`ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`): Step 3
  is 0 net code lines and Step 4 is comments only, so `ccd/ccrc`'s net growth is 0 and the row is green with no
  waiver. (Only if it measures over 40 does this commit create D-7906's waiver, as Task 2's preamble describes.) Two
  commits:
  - `fix(ccrc): _upd_url_origin tests the redacted scheme for http(s) too (review 1403 F1, F3; D-7873)`: `ccd/ccrc`
    (Steps 3 and 4) and the F1 rows (Step 1);
  - `docs(plan): wave 1's plan records review 1403's F1/F3 clause and its third importer (review 1403 F1, F3, F4)`:
    both wave-1 plan hunks of Step 5, D-7873's appended clause and the "Census C4" bullet, in this one commit
    (review E13).

**The characterization pins (Steps 8 to 15), all green on `main` with no code change.**

- [ ] **Step 8: `_tshape` / `_tshape_says`** (`ccd/ccrc-test:148-171`), through `ccrc test --classify -- true` in
  `ccrc-test-wrapper.test.ts`. Use `box({}, {KEY: value})` for the seven box-wide keys (read from `ccrc.env` alone,
  `ccd/ccrc-test:147`) and `run(b, args, {KEY: value})` for `CCRC_TEST_PRESSURE_MAX`.
  - The WARN equals exactly
    `ccrc test: WARN: <KEY>=<value> (from the ~/.ccrc/ccrc.env) is not <words>; using its default <default>`, one row
    each:
    - `CCRC_TEST_SLICE_MEMORY_MAX=0G`: "a whole number with a K, M, G or T suffix, or 1% to 100%", default `6G`;
    - `CCRC_TEST_SLICE_SWAP_MAX=0K`: "0, or a whole number with a K, M, G or T suffix", `1G`;
    - `CCRC_TEST_SLICE_CPU_WEIGHT=01`: "a whole number from 1 to 10000", `20`;
    - `CCRC_TEST_SLICE_IO_WEIGHT=10001`: the same words, `20`;
    - `CCRC_TEST_SLICE_CPU_QUOTA=1000000%`: "a whole percentage such as 400%", `400%`;
    - `CCRC_TEST_HEAVY_SLOTS=100`: "a whole number from 1 to 99", `2`;
    - `CCRC_TEST_WIDE_FILES=1000`: "a whole number from 0 to 999", `3`.
  - The environment row: `CCRC_TEST_PRESSURE_MAX=100` →
    `ccrc test: WARN: CCRC_TEST_PRESSURE_MAX=100 (from the environment) is not a whole number from 0 (off) to 99; using its default 0`.
  - Accepted, no WARN naming the key: MEMORY `1K`, `100%`; SWAP `0`; CPU_WEIGHT `10000`; CPU_QUOTA `999999%`; HEAVY
    `99`; WIDE `0` and `999`; PRESSURE `99`.
  - **Mutants:** WIDE_FILES `{1,3}` → `{1,4}` reds the `1000` row; "1 to 99" → "1 to 98" in `_tshape_says` reds the
    HEAVY row.
- [ ] **Step 9: the keepalive's check** (`ccd/ccd-telemetry-keepalive:282-292`), in `telemetry-keepalive.test.ts`,
  with its `run(env)` and `plantWrapper`/`plantLimits`. Each row expects exit 1, no turn, and this stderr line:
  - `CCRC_KEEPALIVE_FRESH=-1` →
    `keepalive: CCRC_KEEPALIVE_FRESH must be a whole number — got '-1', as set in the environment; nothing was measured`;
  - `+5` → the same with `'+5'`;
  - **the order row:** `CCRC_KEEPALIVE_FRESH=99999999999999999999` with `CCRC_KEEPALIVE_TURN_TIMEOUT=1h` → the first
    `must be` line is `keepalive: CCRC_KEEPALIVE_TURN_TIMEOUT must be a whole number — got '1h'; nothing was measured`,
    and no `representable` line appears;
  - `CCRC_KEEPALIVE_FRESH=30m` with `CCRC_KEEPALIVE_TURN_TIMEOUT=1h` → the only `must be` line names
    `CCRC_KEEPALIVE_FRESH`.

  W29-K5, K7 and K8 (`:830-860`) already pin the file arm, unrepresentability and leading zeros; they stay.
  - **Mutants:** move the representability test above the loop → the order row reds; `^[0123456789]+$` →
    `^-?[0123456789]+$` → the `-1` row reds.
- [ ] **Step 10: the usage sweep's check** (`ccd/ccd-usage-sweep:44-48`), in `usage-sweep-runner.test.ts`: `run(h, env)`
  for the environment, `rebootHome()` + `ccrcEnv` + `reboot(h)` for the file.
  - Refusals, each exit 1, no `scanner-argv`, stderr containing exactly:
    - `1000` (env): `usage-sweep: CCRC_USAGE_SWEEP_DAYS must be a whole number from 1 to 999 — got '1000', as set in the environment; nothing was swept`;
    - `07` (file): `… got '07', as set in ~/.ccrc/ccrc.env; nothing was swept`;
    - 40 `9`s (env): `… got '<32 nines>', as set in the environment; nothing was swept` (cut at 32, no mark);
    - `7<TAB>` (env): `… got '7?', …`.
  - Accepted: `999` and `1` from the file reach the scanner as `--days 999` and `--days 1` (`daysHanded`).
  - **Mutant:** `{0,2}` → `{0,3}` reds the `1000` row.
- [ ] **Step 11: doctor's carry-copies check** (`ccd/ccrc-doctor-checks:11228-11232`), in
  `ccrc-doctor-carry-copies.test.ts`, through `check(box)`:
  - `CCRC_CARRY_COPY_WARN_BYTES=0` → `line` equals exactly
    `WARN carry-copies: CCRC_CARRY_COPY_WARN_BYTES must be a whole number of bytes from 1 to 18 digits — got '0' in ~/.ccrc/ccrc.env, so neither figure is judged`,
    and `remedy` contains
    `set CCRC_CARRY_COPY_WARN_BYTES=<bytes> in ~/.ccrc/ccrc.env (default 10737418240, 10 GiB), or remove the line`;
  - `0123` → the same line with `'0123'`;
  - 19 `9`s → the same line with that value;
  - 18 `9`s with `log: [first(DAY, 5)]` → `line` matches
    `/^PASS carry-copies: .*\(warn bound 999999999999999999 bytes\)$/`.
  - **Mutant:** `{0,17}` → `{0,18}` reds the 19-digit row.

  These three WARN rows are rewritten by Task 7 (D-7919); until then they hold.
- [ ] **Step 12: `_slice_limit_ok`** (`ccd/ccrc:17269`), pure, pinned by direct calls in
  `ccrc-settings-carveouts.test.ts` through its `sourced(home, script, extra)` helper. `sourced()` passes no positional
  argument to the script (`$1` is the ccrc path it sourced), so each row hands the directive and the value in as
  exported variables through `extra`:
  `sourced(home, '_slice_limit_ok "$SL_DIR" "$SL_VAL"; echo "rc $?"', { SL_DIR: 'MemoryMax', SL_VAL: '1G' })`, with
  stdout `rc 0` or `rc 1`. An `it.each` over the table below:
  - `MemoryMax` rc 0: `1G`, `1073741824`, `1048576K`, `24G`, `1%`, `100%`, `9999999999999999E`;
  - `MemoryMax` rc 1: `1073741823`, `1023M`, `0`, `0%`, `101%`, `infinity`, `1.5G`, `01G`, `1g`, `99999999999999999`
    (17 digits);
  - `MemorySwapMax` rc 0: `0`, `1M`, `1048576`, `6G`;
  - `MemorySwapMax` rc 1: `1048575`, `1023K`, `50%`;
  - `MemoryHigh 1G` rc 1.

  The WARN words, in `slice-limits-config.test.ts` by `runFunction`: extend the two rows at `:218-231` with `toContain`
  of the whole tail:
  - `WARN: CCRC_SESSION_SLICE_MEMORY_MAX='24GiB' (from the environment) is not a size the session slice takes for MemoryMax (a whole number with an optional K, M, G, T, P or E suffix, at least 1G, or a whole percentage from 1% to 100%) — the session slice keeps MemoryMax=24G (the default)`;
  - `WARN: CCRC_SESSION_SLICE_SWAP_MAX='6GB' (from ~/.ccrc/ccrc.env) is not a size the session slice takes for MemorySwapMax (a whole number with an optional K, M, G, T, P or E suffix, at least 1M, or 0) — the session slice keeps MemorySwapMax=6G (the default)`.
  - **Mutants:** `floor=30` → `31` reds the `1G` row; `floor="1G"` → `"2G"` at `ccd/ccrc:17300` reds the MemoryMax
    tail.
- [ ] **Step 13: K1, K2 and H1, wave 1's keep and health sentences byte for byte**, in `ccrc-settings-carveouts.test.ts`,
  a new `describe('the keep and health sentences, byte for byte, before their words move (W2 characterization)')`.
  Each row runs through `sourced()` as Step 12's do: the key and the bound inline in `script`
  (`_keep_why CCRC_BACKUP_KEEP "$KV"`), the value in `extra` (`{ KV: 'abc' }`, a 40-`x` string, a string holding a
  tab), and for K2 and H1 the setting itself in `extra` (`{ CCRC_BACKUP_KEEP: 'abc' }`) or in the fixture's `ccrc.env`
  (`boxWith(prefix, 'CCRC_BACKUP_KEEP=abc\n')`). For K1 the script is the call alone (its stdout is the sentence); for
  K2 and H1 it ends `; printf '%s|%s' "$?" "$KEEP_WHY"` (or `"$UPD_HEALTH_WHY"`), so the row reads the rc and the
  sentence apart.
  - **K1.** `_keep_why CCRC_BACKUP_KEEP abc` prints exactly
    `CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999`. `_keep_why CCRC_BACKUP_DATA_KEEP 1 2` prints
    `CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999`. A value of 40 `x` prints 32 `x` then `...`. A
    value with a tab prints `?` in its place.
  - **K2.** `_keep_knob CCRC_BACKUP_KEEP 10` with `CCRC_BACKUP_KEEP=abc` in the environment gives rc 1, with `KEEP_WHY`
    equal to K1's sentence plus `, as set in the environment`. From `ccrc.env` the tail is
    `, as set in the box's ccrc.env`.
  - **H1.** `_upd_health_s` with `CCRC_UPDATE_HEALTH_S=ninety` gives rc 1, with `UPD_HEALTH_WHY` exactly
    `CCRC_UPDATE_HEALTH_S='ninety' is not a number of seconds (digits only, at most 18) — using 90` (the dash is
    U+2014, as the source spells it).
  - **Mutants:** `9999` → `999` in `_keep_why` reds K1 and K2; dropping `(digits only, at most 18)` reds H1.
- [ ] **Step 14: Run every pin on `main`, all green.**
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-test-wrapper.test.ts test/telemetry-keepalive.test.ts test/usage-sweep-runner.test.ts test/ccrc-doctor-carry-copies.test.ts test/slice-limits-config.test.ts test/ccrc-settings-carveouts.test.ts`,
  then `test/ccrc-update-kept.test.ts` and `test/ccrc-update-flip-backups.test.ts` (W24-K, W24-H1 to H4) unchanged.
  Run each mutant above on a saved copy, restore and `cmp`, and record what went red in As built.
- [ ] **Step 15: Commit.** `test: characterization pins for the checks wave 2 moves and the sentences it rebuilds (box settings W2)`

### Task 2: the checks move into ccrc, behaviour-preserving, and every check gains value-free words (D-7906, D-7907, D-7908)

One move per commit, and no assertion changes in any existing row or any Task 1 pin. A move commit may add new rows:
each calls the moved or new function directly, and is red before its move. Every consumer sentence that already holds
a check's words is rebuilt from the new words function, so a mutant in the words reds that consumer's Task 1 pin.

**Two shape rules, both measured:**
- A function `deploy/gen-settings-lib.mjs` slices must open with `name() {` at column 0 and close with a line that is
  exactly `}` (`bodyOf`, `:39-45`; `bodiesOf` in `ccrc-settings-lib.test.ts:37-49`), so no one-line function can be
  sliced.
- A sliced function may call no `_`-prefixed name outside `SETTINGS_LIB_FUNCTIONS` (W29-L2,
  `ccrc-settings-lib.test.ts:57-77`).

**Growth, at every commit (D-7906; review F6, E3).** After each commit of this task that touches `ccd/ccrc`, run
growth armed (`ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`)
before going on. The first commit whose measured net growth of `ccd/ccrc` exceeds 40 creates
`server/test/growth-waivers/D-7906-ccd-ccrc.json` in that same commit:
`{"file":"ccd/ccrc","maxDelta":<that commit's measured delta>,"d":"D-7906","reason":"box settings view wave 2: <split by step so far>","added":"<date -u +%F>"}`.
By this plan's figures that is Step 4 (`_tshape` pair +24, slice words +5, keepalive +7, usage +6 = 42); if the
measured figures put it at Step 3 or Step 5, it is that step's commit instead. Every later commit that grows the file
(Steps 5 and 6 here, then Tasks 3, 5 and any fix) raises `maxDelta` and extends `reason` in the same commit. Each
commit's armed run is green. The commit that creates the waiver also runs `deviation-refs` (it defines D-7906).

**Rows that call a function directly** go in `ccrc-settings-carveouts.test.ts` through `sourced(home, script, extra)`:
literal arguments inline in `script` (`_tshape CCRC_TEST_HEAVY_SLOTS 99; echo "rc $?"`), and any value that needs
quoting (a tab, an empty string) as an exported variable in `extra`. The library-alone rows (W29-L8) source
`ccd/lib/ccrc-settings.sh` the same way, through that suite's own harness.

**Where the new code goes:** one block in `ccd/ccrc` right after `_graph_knobs` closes (`ccd/ccrc:28714`) and before
`_usage_test_paragraph` (`:28715`), under a header "the checks `ccrc settings` shares with their consumers (box settings
wave 2)". `_slice_limit_says` sits beside `_slice_limit_ok` (`:17269`); the four wave-1 words functions sit beside
their resolvers.

**Files:**
- Modify: `ccd/ccrc`, `ccd/ccrc-test`, `ccd/ccd-telemetry-keepalive`, `ccd/ccd-usage-sweep`, `ccd/ccrc-doctor-checks`,
  `deploy/gen-settings-lib.mjs`, `ccd/lib/ccrc-settings.sh` (regenerated, never hand-edited), and comments only in
  `ccd/testbox-knobs:26` and `ccd/ccd-graph-sweep:17`.
- Test: `server/test/ccrc-settings-carveouts.test.ts` (direct rows), `server/test/ccrc-settings-lib.test.ts` (header
  comment, the L3 title, a new L8 row), `server/test/ccrc-settings-census.test.ts` (W29-A1's `BODIES`, `:790`),
  `server/test/telemetry-keepalive.test.ts` and `server/test/usage-sweep-runner.test.ts` (one fail-closed row each).
- Create: `server/test/growth-waivers/D-7906-ccd-ccrc.json`, in the first commit that crosses the limit (above).
- No file this task touches gains `CCRC_TESTBOX_` beyond the holders it already is (`ccd/ccrc`, `ccd/testbox-knobs`,
  `ccd/lib/ccrc-settings.sh`), so `testbox-pins` runs unchanged.

**Claims to take:** `ccd/ccrc`, `ccd/ccrc-test`, `ccd/ccd-telemetry-keepalive`, `ccd/ccd-usage-sweep`,
`ccd/ccrc-doctor-checks`, `ccd/lib/ccrc-settings.sh`, `ccd/testbox-knobs`, `ccd/ccd-graph-sweep`,
`deploy/gen-settings-lib.mjs`, the five test files above, `server/test/growth-waivers/D-7906-ccd-ccrc.json`.

- [ ] **Step 1: Move `_tshape` / `_tshape_says`.**
  - **Red first:** `ccrc-settings-carveouts.test.ts` rows that source `ccd/ccrc` alone: `_tshape CCRC_TEST_HEAVY_SLOTS 99`
    rc 0; `_tshape CCRC_TEST_HEAVY_SLOTS 100` rc 1; `_tshape OTHER 1` rc 1; `_tshape_says CCRC_TEST_WIDE_FILES` prints
    `a whole number from 0 to 999\n`; `_tshape_says OTHER` prints `a whole number from 1 to 10000\n`. Red on `main`
    ("command not found").
  - **Move:** cut `ccd/ccrc-test:148-171` verbatim (the `[0-9]` ranges and the `echo` with its newline included) into
    the block in `ccd/ccrc`. `ccd/ccrc-test:128` already sources `ccrc`, so `_tload` (`:172`) calls them unchanged.
    `TBOXWIDE` (`:147`) stays in `ccrc-test`.
  - **Comments:** the header above (`ccd/ccrc-test:143-146`) gains "`_tshape` and `_tshape_says` live in ccd/ccrc, which
    this file sources (box settings wave 2)". `_test_knobs`' comment (`ccd/ccrc:28658-28659`, "for ccd/ccrc-test, which
    owns what each value means") becomes "…for ccd/ccrc-test; `_tshape` below owns what each value means".
  - **Do not** add `_tshape` to W29-A1's `BODIES` (ruling; its ranges are under Later).
  - **Suites:** `ccrc-test-wrapper`, `testbox-wrapper`, `testbox-knobs`, `graph-knobs`, `ccrc-cli`,
    `ccrc-settings-census`, `ccrc-settings-carveouts`.
  - Commit: `refactor(ccrc): _tshape and _tshape_says move into ccd/ccrc, which ccrc test sources`.
- [ ] **Step 2: The session slice's words.**
  - **Red first:** `_slice_limit_says MemoryMax` prints exactly
    `a whole number with an optional K, M, G, T, P or E suffix, at least 1G, or a whole percentage from 1% to 100%`,
    and `_slice_limit_says MemorySwapMax` prints exactly
    `a whole number with an optional K, M, G, T, P or E suffix, at least 1M, or 0` (no newline).
  - **Implement** a multi-line `_slice_limit_says` after `_slice_limit_ok` (a `case` on the directive).
    `_slice_limit`'s last WARN (`:17301`) prints `($(_slice_limit_says "$3"))` in place of `(… at least $floor$also)`;
    the `also`/`floor` line (`:17300`) and those two locals go.
  - **Suites:** `slice-limits-config` (Task 1's tails green, unedited), `ccrc-settings-carveouts`, `ccrc-uninstall`,
    `ccrc-install-units`.
  - **Mutant:** "at least 1G" → "at least 2G" in `_slice_limit_says` reds Task 1's MemoryMax tail.
  - Commit: `refactor(ccrc): the session slice's refusal words, and _slice_limit's WARN is built from them`.
- [ ] **Step 3: Move the keepalive's freshness check, and widen the library.**
  - **Red first:**
    - direct rows on sourced `ccd/ccrc`, and the same table through sourcing `ccd/lib/ccrc-settings.sh` alone (new
      W29-L8 in `ccrc-settings-lib.test.ts`): `_keepalive_fresh_ok` → `0` rc 0, `0800` rc 0, `9223372036854775807`
      rc 0, `30m` rc 1, `-1` rc 1, `''` rc 1, `9223372036854775808` rc 2, `99999999999999999999` rc 2;
      `_keepalive_fresh_says` prints `a whole number of seconds from 0 to 9223372036854775807`;
    - a fail-closed row in `telemetry-keepalive.test.ts`: copy the script into `<home>/bin/` with a
      `<home>/bin/lib/ccrc-settings.sh` that is the generated library minus `_keepalive_fresh_ok`; run with
      `CCRC_KEEPALIVE_FRESH=1800`: exit 1, stderr has `CCRC_KEEPALIVE_FRESH must be a whole number`, no turn.
  - **Implement:**
    - in `ccd/ccrc`, multi-line: `_keepalive_fresh_ok() {` / `[[ "$1" =~ ^[0123456789]+$ ]] || return 1` /
      `[ "$1" -ge 0 ] 2>/dev/null || return 2` / `}`, and `_keepalive_fresh_says() {` /
      `printf '%s' 'a whole number of seconds from 0 to 9223372036854775807'` / `}`;
    - in `deploy/gen-settings-lib.mjs:18-21`, append `'_keepalive_fresh_ok', '_keepalive_fresh_says'` to
      `SETTINGS_LIB_FUNCTIONS`. Reword its file header (`:2-12`), the JSDoc at `:17` and `HEADER` (`:23-29`): the
      library carries ccrc's reader and its closure, plus the checks two sweeps share with `ccrc settings`, each copied
      whole out of ccd/ccrc;
    - regenerate: `node deploy/gen-settings-lib.mjs`;
    - in `ccd/ccd-telemetry-keepalive:282-292`, before the loop: `_keepalive_fresh_ok "$CCRC_KEEPALIVE_FRESH"; KA_FRESH_RC=$?`
      and `[ "$KA_FRESH_RC" -eq 0 ] || [ "$KA_FRESH_RC" -eq 2 ] || { _ka_say "CCRC_KEEPALIVE_FRESH must be a whole number — got '$CCRC_KEEPALIVE_FRESH'$KA_FRESH_FROM; nothing was measured"; exit 1; }`;
      the loop then covers the four non-setting knobs only, its `_ka_say` message unchanged; after the loop,
      `[ "$KA_FRESH_RC" -eq 0 ] || { _ka_say "CCRC_KEEPALIVE_FRESH must be a representable whole number — …"; exit 1; }`
      with the representable sentence byte-identical to today's;
    - any rc other than 0 or 2, including 127 from a library that lacks the function, refuses: fail-closed. The two
      loader lines (`:136-137`) stay byte for byte (`LOADER`).
  - **Comments:** `ccrc-settings-lib.test.ts`'s header (`:1-8`) and W29-L3's title ("defines the eight functions" →
    "defines the library's functions"; its assertion is unchanged); `ccd/ccrc:21723-21724` ("…regenerates after any
    edit to this line, to `_ccrc_knob`, to the `_box_*` model or to a check the library carries");
    `ccd/testbox-knobs:26` and `ccd/ccd-graph-sweep:17` ("carries `_ccrc_knob` and its closure only" → "…its closure
    and two sweeps' checks"). The install echo (`ccd/ccrc:17637`) stays as written.
  - **Census:** W29-A1's `BODIES` (`:790`) gains `'_keepalive_fresh_ok'`.
  - **Suites:** `telemetry-keepalive`, `keepalive-freshness-parity`, `ccrc-settings-lib`, `ccrc-settings-census`,
    `timer-first-run`, `ccrc-install-tree`, `install-census`, `macos-platform`, `graph-repo-sweep`, `testbox-knobs`,
    `ccrc-settings-carveouts`.
  - **Mutants:** `-eq 2` → `-ne 1` in the first gate reds the fail-closed row; swapping the two gates reds Task 1's
    order row.
  - Commit: `refactor(settings-lib): the keepalive's freshness check moves into ccd/ccrc and the generated library, which widens to carry it`.
- [ ] **Step 4: Move the usage sweep's days check.**
  - **Red first:** direct rows on `ccrc` and on the library alone (L8): `_usage_days_ok` → `1` 0, `999` 0, `0` 1, `07`
    1, `1000` 1, `''` 1; `_usage_days_says` prints `a whole number from 1 to 999`. A fail-closed row in
    `usage-sweep-runner.test.ts` (a library lacking `_usage_days_ok`, `CCRC_USAGE_SWEEP_DAYS=7`): exit 1 with the
    `must be` sentence and no `scanner-argv`.
  - **Implement:** multi-line `_usage_days_ok() {` / `[[ "$1" =~ ^[123456789][0123456789]{0,2}$ ]]` / `}` and
    `_usage_days_says() {` / `printf '%s' 'a whole number from 1 to 999'` / `}`; append both to
    `SETTINGS_LIB_FUNCTIONS` and regenerate; `ccd/ccd-usage-sweep:44` becomes `_usage_days_ok "$CCRC_USAGE_SWEEP_DAYS" || {`,
    its sanitiser unchanged, and the echo (`:47`) prints `must be $(_usage_days_says) — got '$v', …`, byte-identical.
  - **Census:** `BODIES` gains `'_usage_days_ok'`. The sibling scan loses `ccd/ccd-usage-sweep:44`; the count stays
    over the `>= 11` floor (13 on `main`, 15 after Steps 3 to 5).
  - **Suites:** `usage-sweep-runner`, `usage-sweep-deploy-ship`, `ccrc-settings-lib`, `ccrc-settings-census`,
    `ccrc-settings-carveouts`.
  - **Mutant:** "1 to 999" → "1 to 998" in `_usage_days_says` reds W29-U5 and Task 1's rows.
  - **Growth:** by the plan's figures this commit takes `ccd/ccrc` past 40, so it creates D-7906's waiver (preamble),
    then runs growth armed (green) and `git fetch origin main` plus `deviation-refs`.
  - Commit: `refactor(settings-lib): the usage sweep's days check moves into ccd/ccrc and the generated library (D-7906)`.
- [ ] **Step 5: Move the carry-copies bound's check.**
  - **Red first:** `_carry_warn_bytes_ok` → `1` 0, 18 nines 0, `0` 1, `0123` 1, 19 nines 1, `10G` 1;
    `_carry_warn_bytes_says` prints `a whole number of bytes from 1 to 18 digits`.
  - **Implement** both, multi-line, in `ccrc`. In `ccd/ccrc-doctor-checks:11229` the test becomes
    `if ! _carry_warn_bytes_ok "$thr"; then`, and the WARN (`:11230`) reads
    `must be $(_carry_warn_bytes_says) — got '$thr' …`, byte-identical (Task 7 drops the value, D-7919). Not added to
    the library: doctor sources `ccrc` itself.
  - **Census:** `BODIES` gains `'_carry_warn_bytes_ok'`.
  - **Suites:** `ccrc-doctor-carry-copies`, `ccrc-doctor-core`, `ccrc-settings-census`, `docs-parity`,
    `ccrc-settings-carveouts`.
  - **Mutant:** "18 digits" → "17 digits" in the words reds the `10G` exact row (`ccrc-doctor-carry-copies.test.ts:165`)
    and Task 1's rows.
  - **Growth:** raise D-7906's `maxDelta` in this commit; run growth armed.
  - Commit: `refactor(doctor): the carry-copies bound's check and words move into ccd/ccrc`.
- [ ] **Step 6: Value-free words for wave 1's resolvers, and their sentences built from them (D-7908).**
  - **Red first:** direct rows printing exactly:
    - `_keep_says 0` → `a whole number from 0 to 9999`; `_keep_says 2` → `a whole number from 2 to 9999`; `_keep_says`
      with no argument → the `0` form;
    - `_upd_health_says` → `a number of seconds (digits only, at most 18)`;
    - `_upd_deadline_says` → `a positive whole number of milliseconds in canonical digits (at most 15, no lead zero)`;
    - `_models_budget_says` → `a whole number of seconds from 0 to 3600`.
  - **Implement** one-line functions (none is sliced). The consumers are rebuilt from them, byte-identically:
    - `_keep_why` (`:26365-26369`) prints `"%s='%s' is not %s"` with `"$(_keep_says "${3:-0}")"`;
    - `_upd_health_s` (`:23816`) uses `is not $(_upd_health_says) — using 90`;
    - `cmd_settings`' deadline sentence (`:26198`) uses `is not $(_upd_deadline_says), so its plain reading is …`;
    - `_models_budget`'s sentences are unchanged: neither says the range, so the words row is its only pin.
  - **`CCRC_RELEASE_BASE_URL` gets no words function (D-7907):** it is never refused (`ccd/ccrc:26201-26207`, only `ok`
    or `unmeasured`; an unparseable base reads `custom` alone).
  - **Suites:** `ccrc-settings-carveouts` (K1, K2, H1 green and unedited), `ccrc-settings-verb` (its pinned sentences at
    `:144-311` unchanged), `ccrc-uninstall` (`:1590`), `ccrc-update-kept`, `ccrc-versions-warn-arms`,
    `ccrc-update-flip-backups`, `ccrc-update-phases`, `ccrc-models-advance`.
  - **Mutants:** "to 9999" → "to 999" in `_keep_says` reds K1, K2, `ccrc-settings-verb:144` and `ccrc-uninstall:1590`;
    changing `_upd_health_says` reds H1 and `ccrc-settings-verb:162`; changing `_upd_deadline_says` reds the verb's
    deadline row.
  - **Growth:** raise D-7906's `maxDelta` in this commit; run growth armed.
  - Commit: `refactor(ccrc): value-free words for wave 1's resolvers, which their sentences are built from (D-7907, D-7908)`,
    then `git fetch origin main` and `deviation-refs` (it defines D-7907 and D-7908).
- [ ] **Step 7: The task gate.** No new commit unless a fix is needed.
  - `ccd/ccrc`'s net growth for Tasks 1 and 2 is expected about +52 (F1 0, `_tshape` pair +24, slice words +5,
    keepalive +7, usage +6, carry +6, wave 1's words +4). D-7906's `maxDelta` already equals the last measured delta
    and its `reason` carries the split by step; confirm both.
  - Run, from `server/`, `ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`
    (green), then `test/single-definition/` (the directory, whole), `test/single-definition-pin.test.ts`,
    `test/citations.test.ts`, `test/docs-parity.test.ts`, `test/ccrc-settings-census.test.ts`, `test/testbox-pins.test.ts`,
    and `ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`.

### Task 3: the class table, its tools, and the L0 mirror (D-7909, D-7914)

The table and every tool the verb, the server, the card and doctor need, before any of them is built. This task changes
no output of the verb: version 1 is still written, from the bash `BOX_SETTINGS_KEYS` literal, until Task 5. It raises
D-7906.

**Files:**
- Modify: `ccd/ccrc`:
  - `BOX_SETTINGS_TABLE` and `_set_spec` directly below the `CCRC_SETTINGS=(…)` line (`ccd/ccrc:21725`), and beside
    them the value-words mirror `BOX_SETTING_VALUE_WORDS` (D-7914);
  - beside `cmd_settings` (`:26166`): `_set_libs`, `_set_says`, `_set_check`, `_set_fits`, the two
    envelope literals `BOX_SETTING_VALUE_SHAPE` and `BOX_SETTING_ORIGIN_SHAPE`; `_set_text` gains an optional max
    (`_set_text <text> [<max>]`, default 480) and `_set_json` passes one through (`_set_json <text> [<max>]`);
  - the bash `BOX_SETTINGS_KEYS=(…)` literal (`:26115`) stays as it is (Task 5 retires it, D-7910).
- Modify: `shared/api.ts`, next to the box-settings vocabularies (`shared/api.ts:9930-9966`), after `BOX_SETTINGS_KEYS`.
- Create: `server/test/box-settings-table.test.ts` and `server/test/boxSettingsEnvelope.ts` (the differential corpus,
  a test helper Task 4 imports too).
- Modify: `server/test/testbox-pins.test.ts`: add `BOX_SETTINGS_W2_HOLDERS = ['server/test/box-settings-table.test.ts',
  'server/test/boxSettingsEnvelope.ts', 'shared/api.ts']`, spread into `HOLDERS` (each spells `CCRC_TESTBOX_` keys:
  the L0 table and value words, T3/T4 and the C-rows, the corpus's word rows).
- Modify: `server/test/growth-waivers/D-7906-ccd-ccrc.json` (raised).
- Run unchanged: `ccrc-settings-verb` (its `:110-111` literal pin holds: the literal is untouched), `box-settings-read`
  (its `:243-254` row holds for the same reason), `ccrc-settings-census`, `ccrc-settings-lib`, `testbox-knobs`,
  `graph-knobs`, `ccrc-test-wrapper`, `ccrc-update-kept`, `ccrc-update-flip-backups`, `ccrc-models-advance`,
  `ccrc-update-phases`, `ccrc-versions-warn-arms`, `ccrc-cli`, the `single-definition/` directory and
  `single-definition-pin`, `docs-parity`, `rings/wire-totality`, `growth-check` (armed).

**Claims to take:** `ccd/ccrc`, `shared/api.ts`, `server/test/box-settings-table.test.ts`,
`server/test/boxSettingsEnvelope.ts`, `server/test/testbox-pins.test.ts`,
`server/test/growth-waivers/D-7906-ccd-ccrc.json`.

#### The shapes this task fixes

**The bash table** (D16) is one array, one element per line, five `:`-joined words, in `CCRC_SETTINGS` order, all 89:

```bash
# key:class:family:roles:applies (spec 5.1, D12, D16). class value|origin|presence|omit; roles a comma list of CCRC_ROLE
# words, or none; applies run|update. Mirrored in shared/api.ts's BOX_SETTING_TABLE, held equal by box-settings-table.test.ts.
BOX_SETTINGS_TABLE=(
  CCRC_BACKUP_KEEP:value:updates:fleet,server,both:run
  …
  CCRC_CARRY_COPY_WARN_BYTES:value:carry-copies:fleet,both:run
)
```

Its content is exactly spec 5.1:
- **Classes.** `origin`: `CCRC_RELEASE_BASE_URL`. `presence`: `CCRC_GRAPH_STORE`, `CCRC_GRAPH_SOURCE_REF`,
  `CCRC_GRAPH_REPOS_EXCLUDE`, `CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`, `CCRC_TESTBOX_URL` (D19),
  `CCRC_TESTBOX_TOKEN_FILE`, `CCRC_TESTBOX_GIT_URL_BASE`, `CCRC_TESTBOX_GIT_KEY`, `CCRC_TESTBOX_DENY_GLOBS`,
  `CCRC_TESTBOX_TIMES`. `omit`: the 28 keys of `_tb_box_table` (`ccd/testbox-knobs:186-215`). `value`: every other
  name. Counts: value 49 (6 of wave 1's and 43 new), origin 1, presence 11, omit 28.
- **Families.** `updates` wave 1's seven; `session-slice` 2; `test-runs` the 8 `CCRC_TEST_*`; `graph` 23; `keepalive`
  3; `usage-sweep` 1; `testbox` the 16 host-table keys and the 28 omitted; `carry-copies` 1.
- **Roles.** `fleet,server,both` for wave 1's first six; `fleet,both` for `CCRC_MODELS_ADVANCE_BUDGET_S` (it replaces
  `MODELS_BUDGET_KEY`, `pwa/src/fleet/boxSettingsWords.ts:137`) and for all 54 new shown rows (D21); `none` for the 28
  omitted.
- **Applies.** `update` for `CCRC_SESSION_SLICE_MEMORY_MAX`, `CCRC_SESSION_SLICE_SWAP_MAX`, `CCRC_GRAPH_REFRESH_SECS`,
  `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_BUILD_TIMEOUT` and `CCRC_GRAPH_SLOT_WAIT_SECS` (the installer renders these: slice
  `ccd/ccrc:17311-17312`, `deploy/systemd/ccd-graph-sweep.service:8`, `deploy/systemd/ccd-graph-sweep.timer:8`); `run`
  for every other name, the 28 omitted included.

**The bash tools:**
- `_set_spec <KEY>` walks the table and sets `SET_CLASS`, `SET_FAMILY`, `SET_ROLES` and `SET_APPLIES`; rc 1 for a name
  the table does not hold.
- `_set_libs` loads `"$CCRC_HERE/graph-resolve"` unless `declare -F _gr_fits` succeeds, and
  `"$CCRC_HERE/testbox-knobs"` unless `declare -F _tb_shape` succeeds, each with `2>/dev/null`. A failure sets
  `SET_GR_WHY` to `the graph settings check (graph-resolve) could not be loaded beside ccrc`, or `SET_TB_WHY` to
  `the test box settings check (testbox-knobs) could not be loaded beside ccrc`; each is empty otherwise. Sourcing
  `testbox-knobs` from `ccrc` does not re-source `ccrc` (its guard, `ccd/testbox-knobs:38-44`); its run-guard (`:33`)
  compares `BASH_SOURCE[0]` with `$0`, which differ here; its `TB_BOX_ENV_FILE=` (`:47`) is never read by the verb.
- `_set_says <KEY>` prints the closed-set words for that setting's check, rc 1 and nothing printed when it has none
  (`CCRC_RELEASE_BASE_URL`, `CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`). It never takes a value. It dispatches by
  family:
  - `updates`: a literal `case` per key: `_keep_says 0` (`CCRC_BACKUP_KEEP`, `CCRC_VERSIONS_KEEP`), `_keep_says 2`
    (`CCRC_BACKUP_DATA_KEEP`), `_upd_health_says`, `_upd_deadline_says`, `_models_budget_says`;
  - `session-slice`: `_slice_limit_says MemoryMax|MemorySwapMax`, by literal key;
  - `test-runs`: `"$(_tshape_says "$1")"` (the command substitution drops its newline);
  - `graph`: `_gr_says "$(_gr_shape "$1")"`;
  - `testbox`: `_tb_shape_says "$1"`;
  - `keepalive`: `_keepalive_fresh_says` for `CCRC_KEEPALIVE_FRESH`, rc 1 for `MODEL` and `PROMPT`;
  - `usage-sweep`: `_usage_days_says`; `carry-copies`: `_carry_warn_bytes_says`.
- `_set_check <KEY> <value>` runs the setting's own check on the value it is given, prints nothing, and answers rc 0
  (passes), rc 1 (refused) or rc 2 (the check could not run, with `SET_CHECK_WHY` set to the fixed sentence). Its order
  is fixed (assembly reconciliation 4; review L5, E6, F16), and the C-rows pin each step:
  1. an `omit` key or a name outside the table: rc 2 with `SET_CHECK_WHY` `<KEY> has no check in this view`; neither
     caller passes one;
  2. a `graph` key while `SET_GR_WHY` is set, or a `testbox` key while `SET_TB_WHY` is set: rc 2 with that sentence as
     `SET_CHECK_WHY`, whether the value is empty or not;
  3. an empty value: rc 0 for every key whose consumer treats empty as its default (every shown key; `_tb_got`'s own
     rule; Task 5's V10 proves each family);
  4. the owner's check, by family:
     - `session-slice`: `_slice_limit_ok MemoryMax|MemorySwapMax "$2"`, by literal key;
     - `test-runs`: `_tshape "$1" "$2"`;
     - `graph`: `_gr_fits "$(_gr_shape "$1")" "$2"`;
     - `testbox`: `_tb_shape "$1" "$2"`;
     - `keepalive`: `_keepalive_fresh_ok "$2"` for `FRESH`, its rc 2 (unrepresentable) mapped to rc 1 (refused: the
       words name the upper bound); `MODEL` and `PROMPT` always rc 0;
     - `usage-sweep`: `_usage_days_ok "$2"`; `carry-copies`: `_carry_warn_bytes_ok "$2"`;
     - `updates` (assembly reconciliation 1): the key's own resolver, in a subshell, with the value handed in as that
       key's environment value and `ccrc.env` masked, one literal line per key:
       `CCRC_BACKUP_KEEP) ( BOX_ENV_FILE="$BOX_ENV_FILE/." CCRC_BACKUP_KEEP="$2" _bak_keep >/dev/null 2>&1 ) ;;` and
       likewise `_bak_data_keep`, `_ver_keep`, `_upd_health_s`, `_upd_deadline_ms`, `_models_budget` (its rc 3, a
       clamp, maps to rc 1, as the verb maps it); any resolver rc other than 0 or 1 maps to rc 2 with `SET_CHECK_WHY`
       `<KEY> could not be checked by its resolver`. `CCRC_RELEASE_BASE_URL` always answers rc 0 (D-7907: it is never
       refused).
- **The value words (D-7914, review F5).** A bash mirror of L0's `BOX_SETTING_VALUE_WORDS`, beside the table:

  ```bash
  # key:word,word (D-7914): the fixed words a setting's check admits beside the value shape. Mirrored in shared/api.ts's
  # BOX_SETTING_VALUE_WORDS and held equal, both ways, to it and to _tb_shape's word arms by box-settings-table.test.ts.
  BOX_SETTING_VALUE_WORDS=(
    CCRC_TESTBOX_LOST_RUN:local,fail
    CCRC_TESTBOX_FALLBACK_INSTALL:install,refuse
  )
  ```
- **The envelope (D-7909).** Two literals in `ccd/ccrc`, byte-equal to L0's strings, written in the subset that bash
  `[[ =~ ]]` (glibc ERE) and JavaScript `RegExp` (no `u` flag) read the same way: no `(?:`, no `\d`, no ranges (digits
  and letters enumerated), brackets escaped `\[` and `\]`:
  - `BOX_SETTING_VALUE_SHAPE='^[0123456789]{1,32}([KMGTPE]|[smhd]|%)?$'`;
  - `BOX_SETTING_ORIGIN_SHAPE`: `default`, `custom`, or `custom ` followed by an optional `http://` or `https://` (any
    case, spelled `[Hh][Tt][Tt][Pp][Ss]?://`), a NON-EMPTY host (quantifier `+`) that is either `\[` hex digits, `:`
    and `.` `\]`, or letters, digits, `.`, `-`, `_` and `~` enumerated, and an optional `:` with 1 to 5 digits;
    anchored at both ends. So `custom https://` and `custom ` (a trailing space) do not fit (review L10).
  - `_set_fits <KEY> <class> <value>` (a subshell function under `LC_ALL=C`, like `_set_text`): rc 0 when the value is
    at most `BOX_SETTINGS_TEXT_MAX` bytes and, for class `value`, matches the value shape or is one of the words the
    mirror lists for that key (a key with no line in the mirror admits no word); for class `origin`, matches the origin
    shape. rc 1 otherwise. It prints nothing. The verb (Task 5) and doctor (Task 7) call it on every `ok` value and
    origin, wave 1's seven included (review L3, L12).
  - The three fixed whys a row is written with when its value cannot be shown (Task 5):
    `<KEY>'s value passes its check but is wider than this view records (at most 32 digits and one unit, or one of its words)`,
    `CCRC_RELEASE_BASE_URL's origin is wider than this view records (an http or https scheme, a plain host name and a port)`,
    and `<KEY>'s value holds a control byte this view does not record` (review L1). Each names the key only.
- `_set_text <text> [<max>]`: the cut is `<max>` (default 480) with `...` in the last three bytes.
  `_set_json <text> [<max>]` passes `<max>` through to `_set_text` (default 480) and then escapes; it is the one call
  that redacts and maps a string on its way into the JSON, so nothing is redacted twice (review L7, F13). Task 5's
  `_set_row_json` passes 240 for a `why`.

**The L0 mirror** (`shared/api.ts`, after `BOX_SETTINGS_KEYS`), on the house idiom (a union with a `Record<…, true>` map;
the list derived from the map):
- `BoxSettingClass = 'value' | 'origin' | 'presence' | 'omit'` → `BOX_SETTING_CLASSES`.
- `BoxSettingFamily = 'updates' | 'session-slice' | 'test-runs' | 'graph' | 'testbox' | 'keepalive' | 'usage-sweep' | 'carry-copies'`
  → `BOX_SETTING_FAMILIES`. The map's insertion order is the card's family order.
- `BoxSettingApplies = 'run' | 'update'` → `BOX_SETTING_APPLIES`.
- `interface BoxSettingSpec { cls: BoxSettingClass; family: BoxSettingFamily; roles: readonly NodeRole[]; applies: BoxSettingApplies }`
  (`NodeRole` is the existing type-only import, `shared/api.ts:9841`; bash `none` is `[]`).
- `export const BOX_SETTING_TABLE = { CCRC_BACKUP_KEEP: { cls: 'value', family: 'updates', roles: ['fleet', 'server', 'both'], applies: 'run' }, … } as const satisfies Record<string, BoxSettingSpec>`,
  all 89 in `CCRC_SETTINGS` order; `export type BoxSettingName = keyof typeof BOX_SETTING_TABLE`.
- `export const BOX_SETTING_SPECS: Readonly<Record<BoxSettingName, BoxSettingSpec>> = BOX_SETTING_TABLE` (C18): the
  widened view every consumer reads, so `BOX_SETTING_SPECS[k].roles.includes('server')` compiles for every key.
- `export const BOX_SETTINGS_SHOWN: readonly BoxSettingName[]`, derived (`Object.keys` of the table, filtered on
  `cls !== 'omit'`): 61 names, version 2's row list and order.
- `BOX_SETTINGS_KEYS` (version 1's seven) stays as written, for the version-1 reader.
- `export const BOX_SETTING_REFUSAL_WORDS = [ … ] as const` and `export type BoxSettingRefusalWord = typeof BOX_SETTING_REFUSAL_WORDS[number]`:
  D22's closed set, a list on the `CCD_REFUSAL_TOKENS` precedent (the members are sentences). Its content is every
  string `_set_says` prints for the 61, de-duplicated ("a whole number from 1 to 99" comes from more than one owner):
  `_tb_shape_says` over the 16 host keys, `_gr_says` over the classes the 23 graph keys use, `_tshape_says` over the 8
  test keys, the slice's two, `_keepalive_fresh_says`, `_usage_days_says`, `_carry_warn_bytes_says`, `_keep_says 0`,
  `_keep_says 2`, `_upd_health_says`, `_upd_deadline_says` and `_models_budget_says`. Write it by running `_set_says`
  over the 61 once and pasting the sorted unique lines; the test below derives the set from bash, never from a copy.
- `export const BOX_SETTING_VALUE_WORDS: Readonly<Partial<Record<BoxSettingName, readonly string[]>>> = { CCRC_TESTBOX_LOST_RUN: ['local', 'fail'], CCRC_TESTBOX_FALLBACK_INSTALL: ['install', 'refuse'] }`
  (D-7914, moved here from Task 4 so the writer's `_set_fits` and the server read one list from the start; review F5).
- `export const BOX_SETTINGS_TEXT_MAX = 480` and `export const BOX_SETTINGS_WHY_MAX = 240`.
- `export const BOX_SETTING_VALUE_SHAPE = '…'` and `export const BOX_SETTING_ORIGIN_SHAPE = '…'`, the same runtime
  strings as bash (the TypeScript source doubles each backslash).

#### Steps

- [ ] **Step 1: Write the failing table tests** in `server/test/box-settings-table.test.ts`. It reads `ccd/ccrc` and
  `ccd/testbox-knobs` as text, imports `ccrcSettingsNames` from `./ccrcSettingsLine.js` and the L0 names from
  `../../shared/api.js`.
  - **T1. Bash names equal `CCRC_SETTINGS`, in order.** Extract the `^BOX_SETTINGS_TABLE=\($` … `^\)$` block; each line
    matches `/^  (CCRC_[A-Z0-9_]+):(value|origin|presence|omit):([a-z-]+):(none|[a-z,]+):(run|update)$/`. The key
    column equals `ccrcSettingsNames(SRC)` (89 names, each once, same order). A line that does not match is a fault
    listed by its text.
  - **T2. Bash equals L0, both ways.** `Object.keys(BOX_SETTING_TABLE)` is in the same order; for every key, class,
    family, roles (`none` ↔ `[]`, else a comma split) and applies are equal.
  - **T3. Counts and named members.** Classes `{value: 49, origin: 1, presence: 11, omit: 28}`;
    `BOX_SETTINGS_SHOWN.length === 61`; the presence set equals the 11 above; `CCRC_TESTBOX_URL` is `presence` (D19);
    `CCRC_RELEASE_BASE_URL` is the only `origin`.
  - **T4. Omit is the box table.** The omit set equals the `_ccrc_knob` keys of `_tb_box_table`, extracted as the census
    extracts `TESTBOX_BOX_KEYS` (`ccrc-settings-census.test.ts:104-106`). No `_tb_host_table` key is omitted. Every
    omit key has roles `[]` and applies `run`.
  - **T5. Applies.** The `update` set equals the six above.
  - **T6. Version 1's seven are the `updates` family.** `BOX_SETTINGS_KEYS` equals, in order, the table's `updates`
    keys, which are the first seven of `CCRC_SETTINGS`, and `BOX_SETTINGS_SHOWN.slice(0, 7)` equals it.
  - **T7. Families.** Every family has at least one shown row, and `BOX_SETTING_FAMILIES` is exactly the families used,
    in the order of their first appearance in the table.
  - **T8. The view.** `BOX_SETTING_SPECS === BOX_SETTING_TABLE` (one object, not a copy).
  - **T9. Until Task 5, the bash literal is the table's first seven** (review F2, E1). The bash
    `^BOX_SETTINGS_KEYS=\(([A-Z0-9_ ]+)\)$` line, split on spaces, equals the first seven shown names of the bash
    table, in order. Task 5's switch commit deletes this row with the literal.
  - **T10. The value words, both ways** (D-7914; moved here from Task 4, review F5). Read `ccd/testbox-knobs`; map each
    key to its class through `_tb_shape_class`'s `KEY) echo <class>` arms (`ccd/testbox-knobs:87-110`); take each
    `_tb_shape` class arm that compares only words,
    `/^\s*(\w+)\) \[ "\$v" = (\w+) \] \|\| \[ "\$v" = (\w+) \] ;;$/m` (`:122-124`); the set of (non-omit key, words)
    pairs equals L0's `BOX_SETTING_VALUE_WORDS`, and equals the bash mirror's lines (`^  (CCRC_[A-Z_]+):([a-z,]+)$`
    inside `^BOX_SETTING_VALUE_WORDS=\($` … `^\)$`), both ways (`onoff` belongs to an omit key and is excluded). Every
    key in it is a `value`-class key. CONTROL: a body with an added `|| [ "$v" = maybe ]` on `lostrun` reads unequal; a
    mirror line `CCRC_TESTBOX_LOST_RUN:local,fail,maybe` reads unequal.
  - **CONTROL** (wave 1's precedent, `box-settings-read.test.ts:222-232`): the same comparison on a planted text fails
    for an extra bash line (`  CCRC_NOT_A_SETTING:value:graph:fleet,both:run`), a dropped line, two lines swapped, and
    `CCRC_TESTBOX_URL:origin:…`.
- [ ] **Step 2: Write the failing tool tests** in the same file. Each bash case runs in a fixture HOME with
  `bash -c '. "$1"; _set_libs; …' box-settings-table <ccd/ccrc>`, the key inline in the script and the value in an
  exported variable (`V`, `W`), so an empty string, a tab or a quote reaches the function as written.
  - **W1. The closed set is the bash words, both ways.** For each of `BOX_SETTINGS_SHOWN`, run `_set_says "$k" && echo`;
    the set of non-empty lines equals `BOX_SETTING_REFUSAL_WORDS` as a set, both ways. `_set_says` gives rc 1 and prints
    nothing for `CCRC_RELEASE_BASE_URL`, `CCRC_KEEPALIVE_MODEL` and `CCRC_KEEPALIVE_PROMPT`, and rc 0 for the other
    58. Every word is printable ASCII, at most `BOX_SETTINGS_WHY_MAX` bytes, and holds no `'`, `=`, `"` or `$`.
    `BOX_SETTING_REFUSAL_WORDS` has no duplicate.
  - **W1b. Every word survives the writer byte for byte** (review F17, L7). For each member `w` of
    `BOX_SETTING_REFUSAL_WORDS`, handed in as an exported variable: `_set_text "$W" 240` prints exactly `w`, and
    `_set_json "$W" 240` prints exactly `JSON.stringify(w)` (so `_upd_redact`, the character maps and the escaping
    change none of them: the URL words, the duration words and `<name>-<8 hex digits>` included).
  - **W2. The cuts.** `_set_text "$(printf 'x%.0s' {1..900})"` is 480 bytes ending `...`;
    `_set_text "$(printf 'x%.0s' {1..900})" 240` is 240 bytes ending `...`; `_set_json` of the same text with 240 is 242
    bytes (the two quotes) and with no max 482. `BOX_SETTINGS_TEXT_MAX` equals the default in `_set_text`'s body.
  - **C-rows, `_set_check`.** Each prints nothing on stdout or stderr. Each runs with a `ccrc.env` that sets the same key
    to a different value, so the row proves the given value is judged, not the file's:
    - `CCRC_GRAPH_BUDGET 4` → 0, `zz` → 1; with `graph-resolve` hidden (the verb run from a copy of `ccd/` without it)
      → 2 and `SET_CHECK_WHY` the graph sentence;
    - `CCRC_TESTBOX_QUEUE_LIMIT 20` → 0, `zz` → 1, `''` → 0; with `testbox-knobs` hidden → 2 and the test-box sentence;
    - **the order** (review L5, E6): with `testbox-knobs` hidden, `CCRC_TESTBOX_URL ''` → 2 (the library step comes
      before the empty step); with `graph-resolve` hidden, `CCRC_GRAPH_REPOS_EXCLUDE ''` → 2; with both loaded, the same
      two → 0; `CCRC_TESTBOX_RUNS ''` → 2 (the omit step comes first);
    - **the empty step on the `updates` arm** (review F16): `CCRC_BACKUP_KEEP ''` with `ccrc.env` holding
      `CCRC_BACKUP_KEEP=abc` → 0 (empty answers before the resolver, which would otherwise read the file's `abc`);
      `CCRC_BACKUP_KEEP 5` with the same file → 0 and `CCRC_BACKUP_KEEP abc` with a file holding `5` → 1;
    - **the mask, a source row:** inside `_set_check`'s body, each of the six `updates` resolver lines carries
      `BOX_ENV_FILE="$BOX_ENV_FILE/."` before the key's assignment (six matches, one per resolver; the mask cannot be
      seen in behaviour, since an empty value never reaches the resolver and a set one wins over the file);
    - `CCRC_TESTBOX_URL relative` → 1; `CCRC_TESTBOX_GIT_KEY relative/key` → 1;
    - `CCRC_TEST_HEAVY_SLOTS 99` → 0, `100` → 1;
    - `CCRC_SESSION_SLICE_MEMORY_MAX 24G` → 0, `90` → 1; `CCRC_SESSION_SLICE_SWAP_MAX 0` → 0;
    - `CCRC_KEEPALIVE_FRESH 1800` → 0, `30m` → 1, `99999999999999999999` → 1; `CCRC_KEEPALIVE_MODEL anything` → 0;
    - `CCRC_USAGE_SWEEP_DAYS 0` → 1; `CCRC_CARRY_COPY_WARN_BYTES 10G` → 1;
    - `CCRC_BACKUP_KEEP 5` → 0, `abc` → 1; `CCRC_BACKUP_DATA_KEEP 1` → 1, `2` → 0; `CCRC_VERSIONS_KEEP 3` → 0;
      `CCRC_UPDATE_HEALTH_S ninety` → 1, `90` → 0; `CCRC_UPDATE_DEADLINE_MS 6e5` → 1, `600000` → 0;
      `CCRC_MODELS_ADVANCE_BUDGET_S 250` → 0, `3601` → 1, `off` → 1; `CCRC_RELEASE_BASE_URL ftp://x` → 0;
    - `CCRC_TESTBOX_RUNS 4` → 2; `CCRC_NOT_A_SETTING 1` → 2.
  - **E-rows, the envelope.** `BOX_SETTING_VALUE_SHAPE` and `BOX_SETTING_ORIGIN_SHAPE` equal the bash literals byte for
    byte (extract `^BOX_SETTING_VALUE_SHAPE='([^']*)'$` and its sibling). Then two kinds of row (review F5):
    - **E1, the regexes alone:** for each string below, bash `[[ "$V" =~ $BOX_SETTING_VALUE_SHAPE ]]` (or the origin
      shape) on the literal and `new RegExp(L0 string).test(v)` give equal answers. Value strings: `24G`, `50%`, `400%`,
      `0`, `3s`, `10m`, `64M`, `86400`, `9999999999999999E`, a 32-digit value (all match); a 33-digit value, `1` + 39
      nines + `M`, `5Q`, `5 G`, `-1`, `1.5`, `/etc/x`, `local` (none matches). Origin strings: `default`, `custom`,
      `custom https://mirror.example.invalid:8443`, `custom HTTPS://mirror.example.invalid`, `custom https://[::1]:8080`,
      `custom mirror.example.invalid` (all match); `custom h:abc`, `custom h^x`, `custom https://u:p@h`,
      `custom https://h/r`, `custom https://h?x`, `custom ftp://h`, `custom https://`, `custom ` (a trailing space),
      `https://h`, `set` (none matches; `custom https://` and `custom ` are review L10's).
    - **E2, one differential corpus** (`ENVELOPE_CORPUS` in `server/test/boxSettingsEnvelope.ts`, a list of
      `{ key, value }`): for each entry, `_set_fits <key> <its class> "$V"` and the server's full check composed from
      L0 (`new RegExp(BOX_SETTING_VALUE_SHAPE).test(v) || (BOX_SETTING_VALUE_WORDS[key] ?? []).includes(v)` for a
      `value` key, the origin RegExp for the origin, both under `BOX_SETTINGS_TEXT_MAX` bytes) give the same answer for
      every string. The corpus holds every E1 string on `CCRC_GRAPH_BUDGET` (value) or `CCRC_RELEASE_BASE_URL`
      (origin), plus the word rows: `local` and `fail` on `CCRC_TESTBOX_LOST_RUN` and `install` and `refuse` on
      `CCRC_TESTBOX_FALLBACK_INSTALL` (fit); `local` on `CCRC_TESTBOX_FALLBACK_INSTALL`, `install` on
      `CCRC_TESTBOX_LOST_RUN`, `zz` on `CCRC_TESTBOX_LOST_RUN` and `local` on `CCRC_GRAPH_BUDGET` (do not fit: a word
      is admitted only on its own key); a 481-byte value of digits on `CCRC_GRAPH_BUDGET`, and `custom https://` plus a
      host that makes 481 bytes on `CCRC_RELEASE_BASE_URL` (do not fit), and the same origin at 480 bytes (fits). Task 4
      runs the same corpus through `parseBoxSettings` itself.
    - every default the table's `value`-class keys carry in their literal calls fits `_set_fits` (read the defaults
      through the census's extractor), and the default `default` of the origin fits.
  - **Mutants**, measured red on a saved copy:
    - flip `CCRC_KEEPALIVE_MODEL` to `value` in bash only: T2 and T3 red;
    - delete an L0 table entry: T2 red (no `tsc` claim: nothing in Task 3 names a table key by type; review E10);
    - move `CCRC_GRAPH_BUDGET` to `run`: T2 and T5 red;
    - change `_gr_says`' `pct` words in `ccd/graph-resolve`: W1 red;
    - change `_set_says`' graph arm to `echo "a graph setting"`: W1 red;
    - pass the keepalive's rc 2 through in `_set_check`: the `99999999999999999999` row red;
    - fold `_set_check`'s rc 2 into rc 1 for the graph arm: the hidden-library row red;
    - move the empty step above the library step: the two order rows (`CCRC_TESTBOX_URL ''`,
      `CCRC_GRAPH_REPOS_EXCLUDE ''` with the library hidden) red;
    - delete the empty step: the `CCRC_BACKUP_KEEP ''` row red only if the mask is gone too, so the mutant deletes
      both and that row reds; deleting the mask alone reds the source row;
    - change `{1,32}` to `{1,33}` in bash only: the byte-equality row and the 33-digit E1 and E2 rows red;
    - let `_set_fits` admit any lowercase word on a `testbox` key (the retired rule): E2's `local` on
      `CCRC_TESTBOX_FALLBACK_INSTALL` and `zz` rows red;
    - change the origin shape's host quantifier to `*`: E1's and E2's `custom https://` rows red;
    - add `maybe` to the bash value-words mirror only: T10 and E2 red;
    - make `_set_json` ignore its max: W2's 242-byte row red.
- [ ] **Step 3: Run them and see them fail** (no table, no tools yet):
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-table.test.ts`.
- [ ] **Step 4: Implement the bash table, the value-words mirror, the tools and the L0 mirror.**
  - The bash `BOX_SETTINGS_KEYS` line and `cmd_settings`' version-1 loop are not touched (Task 5 retires both, D-7910);
    `ccrc-settings-verb` and `box-settings-read` run green with no edit.
  - `server/test/testbox-pins.test.ts`: add `BOX_SETTINGS_W2_HOLDERS` (Files above) with its comment, spread into
    `HOLDERS`; extend the `it` title with "W2: the box settings view's table, value words and tests". Measure first:
    `git grep -l -E 'CCRC_TESTBOX_|testbox-remote-live' -- . ':!docs/'` after the edits lists exactly the old holders
    plus the three files; any other new hit goes in the list in this commit.
  - Census: C1 still sees one `CCRC_SETTINGS=` line; C3 sees no expansion (an assignment prefix is not one; if C3 or any
    census row refuses `_set_check`'s `updates` arm, stop and ask the coordinator); C4 still sees exactly two
    variable-key calls; C8(c) sees no table line beside `awk|sed|grep|cut|BOX_ENV_FILE`.
- [ ] **Step 5: Run green**: `box-settings-table`, `box-settings-read`, `ccrc-settings-verb`, `ccrc-settings-census`,
  `testbox-pins`, the `single-definition/` directory and `single-definition-pin`, `docs-parity`, `rings/wire-totality`
  (record whether `EXEMPT_PINNED` moves: each new union has its map, and `BoxSettingName` is the table's own keys),
  `rings/shared-imports`, and the server and PWA `tsc --noEmit` through `ccrc test --`.
- [ ] **Step 6: Growth.** Re-measure `ccd/ccrc` (the 91-line table, the 4-line value-words mirror and about 45 lines of
  tools); raise D-7906's `maxDelta` and extend its split, in this commit. Run growth armed.
- [ ] **Step 7: Commit.** `feat(ccrc): one display class, family, roles and timing per setting, its check, its words and its envelope, mirrored in L0 (D12, D16, D22; D-7909, D-7914)`,
  then `git fetch origin main` and `deviation-refs` (it defines D-7909 and D-7914).

### Task 4: the server reads version 2 beside version 1, every row checked against its class (D-7911, D-7912, D-7913)

Spec 5.4 (the server's side), D15, D22's server check, and the data D21 needs. The server is this wave's
reader-widening: it reads both versions before any node writes version 2, the order `ccrc rollout --server-first`
keeps. The lane (L4) still only asks and stores. Both versions are checked against the same L0 table and envelope
(review L4); `BOX_SETTING_VALUE_WORDS` is Task 3's (D-7914).

**Files:**
- Modify: `shared/api.ts`, the box-settings block (`shared/api.ts:9929-9985`): add `BoxSettingRowV1`, `BoxSettingRowV2`,
  `BoxSettingsDocV1`, `BoxSettingsDocV2`, `BoxSettingRow = BoxSettingRowV1 | BoxSettingRowV2`,
  `BoxSettingsDoc = BoxSettingsDocV1 | BoxSettingsDocV2`, `BOX_SETTINGS_V1_REFUSED_WHY` and
  `BOX_SETTINGS_V1_UNFIT_WHY`. `BoxSettingsRead` and `NodeWire.settings?` (`:10016-10018`) keep their names and
  optionality.
- Modify: `shared/agent-protocol.ts:175-183` (the one paragraph, for both versions; C10).
- Modify: `server/src/update/boxSettings.ts` (L1).
- Modify (the compile follow-through for every file the PWA's `tsc` compiles, `pwa/test/` included, and nothing else;
  review E4): `pwa/src/fleet/boxSettingsWords.ts` (`readRow`'s refused arm `:70-79` and its return type, `readDoc`'s
  row type `:94-109`, `settingLine` `:136-141` for a refused row and for a row with no `value`,
  `BOX_SETTINGS_TEXT.refused`) and `pwa/test/box-settings-card.test.tsx` (the type import `:6`, the fixtures `:32-47`,
  the refused literal `:100` and `:107-108` only).
- Do not modify: `server/src/update/boxSettingsLane.ts`, `server/src/update/routes.ts`, `server/src/update/inventory.ts`,
  `server/src/watch.ts`, `pwa/src/fleet/BoxSettingsCard.tsx` (it names `BoxSettingsRead` only and compiles unchanged).
- Test, created: `server/test/fixtures/box-settings/ok--v1-<name>.json` (9 frozen copies),
  `ok--v2-synthetic-base.json`, `ok--v2-synthetic-every-word.json`, `ok--v2-synthetic-largest.json`,
  `malformed--v2-presence-with-value.json`, `malformed--v2-refused-with-value.json`,
  `malformed--v2-why-outside-set.json`, `malformed--v2-omit-row.json`, `malformed--v2-origin-outside.json`,
  `malformed--version-3.json`.
- Test, modified: `server/test/box-settings-read.test.ts`; `server/test/testbox-pins.test.ts`: `BOX_SETTINGS_W2_HOLDERS`
  gains `server/test/box-settings-read.test.ts` (its version-2 rows name `CCRC_TESTBOX_RUNS`, `CCRC_TESTBOX_LOST_RUN`
  and the rest) and the nine version-2 fixtures above (each holds the 16 test-box rows of `v2Base()`): the three
  `ok--v2-synthetic-*.json`, the five `malformed--v2-*.json` and `malformed--version-3.json`. The nine `ok--v1-*.json`
  hold only the seven and are not holders. These become holders in Step 10's commit (Steps 1 to 4 add no test-box
  name), so the list grows in that commit; re-measure with `git grep -l` as Task 3 Step 4 does.
- Run unchanged: `server/test/update-routes.test.ts` (`:250-311`) and `server/test/update-projection.test.ts`.

**Claims to take:** `shared/api.ts`, `shared/agent-protocol.ts`, `server/src/update/boxSettings.ts`,
`server/test/box-settings-read.test.ts`, `server/test/testbox-pins.test.ts`, the fixture files above,
`pwa/src/fleet/boxSettingsWords.ts` (the refused arm, `readRow`'s and `readDoc`'s row types, `settingLine` and
`BOX_SETTINGS_TEXT.refused` only), `pwa/test/box-settings-card.test.tsx` (the type import `:6`, the fixtures `:32-47`,
the refused literal `:100` and `:107-108` only).

- [ ] **Step 1: Characterize version 1 as it parses on `main`.**
  - Copy each `ok--<name>.json` to `ok--v1-<name>.json` with `cp` (not `git mv`). These are wave 1's verb output at
    `ffa9f0ab2` and are never regenerated. The regeneration row (`:135-143`) keeps writing `ok--<name>.json` from the
    live verb.
  - Add the row `the frozen version-1 corpus parses to exactly what wave 1 held`: for each `ok--v1-*.json`,
    `JSON.stringify(parseBoxSettings(text))` is pinned to an inline snapshot (`toMatchInlineSnapshot`, written by the
    run): `{key,state:'ok',value,from}`, `{key,state:'refused',value,from,why}` and `{key,state:'unmeasured',why}`,
    `v: 1`, the seven keys in `BOX_SETTINGS_KEYS` order.
  - Point `base()` (`:157`) and `okText()` (used by `docAt`, `:546`) at `ok--v1-refused.json` and
    `ok--v1-defaults.json`. Rename the forgery `'version 2'` (`:163`) to `'version 2 with the seven rows of version 1'`.
  - Run `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-read.test.ts`:
    green, nothing has changed.
  - Commit: `test(server): freeze wave 1's box-settings corpus as version 1 (characterization)`.
- [ ] **Step 2: Write the version-1 rows.** The first two kinds are characterization (green at Step 1, stay green;
  review E10); the rest are red at Step 1's tip.

  | Row | Input | Expected |
  |---|---|---|
  | characterization: `version 1 is still exactly as strict` | the forgery table (`:158-178`), including `'a refused row with no why'`, plus a new `'a version-1 refused row with no value'` | `null`: a version-1 refused row must still carry `value` and `why` in the file; the server drops them after the check (green at Step 1: `rowOf` already requires `value`) |
  | characterization: `the ok and unmeasured rows of version 1 that fit are untouched` | every `ok--v1-*.json` | deep-equal to Step 1's snapshot with `state === 'refused'` rows, and unmeasured rows whose `why` is over 240, filtered out on both sides (green at Step 1, stays green) |
  | `a version-1 refused row parses with no value and the server's own sentence` | `ok--v1-refused.json` | each of the four refused keys reads exactly `{key, state:'refused', from:'environment', why: BOX_SETTINGS_V1_REFUSED_WHY}`; `'value' in row` is false |
  | `no raw text of a version-1 refused row survives the parse` | `ok--v1-refused.json` | `JSON.stringify(parseBoxSettings(text))` contains none of `abc`, `ninety`, `6e5`, `99999` |
  | `a version-1 ok row outside the envelope is rewritten unmeasured` (review L4) | `ok--v1-defaults.json` with `CCRC_BACKUP_KEEP`'s value set to each of `zz-leak secret`, `/etc/x`, `'1'.repeat(33)`; and with the release base's value set to each of `custom https://u:p@h`, `custom https://tok:secret`, `custom https://h/r`, `custom https://` | not `null`; that row reads exactly `{key, state:'unmeasured', why: BOX_SETTINGS_V1_UNFIT_WHY}`; `JSON.stringify(parseBoxSettings(text))` holds none of `zz-leak`, `secret`, `etc`, `u:p`, `tok`; every other row is as in the snapshot |
  | `a version-1 unmeasured why is bounded at 240 by a cut` (review L4) | `ok--v1-long-sentence.json` (its 284-character why) | not `null`; that row's `why` is the box's first 237 bytes followed by `...`, 240 in all |
  | `the lane never holds a version-1 refused or unfit value` | a lane run (`readOf(ccrcWith(...))`, the `:403` shape) over `ok--v1-refused.json`, and over the `zz-leak secret` forgery | `JSON.stringify(lane.held())` contains none of the four raw values, nor `zz-leak` |
  | `GET /api/updates never serves a version-1 refused value` | `box({watcher:true, files:{'ccrc-caps':CAPS_WITH, [NODE_FILES.boxSettings]: <ok--v1-refused at now>}})`, `inventoryNow`, GET | the raw `res.body` contains none of the four values, nor `='` |
  | PWA (`box-settings-card.test.tsx:98-108`) | the existing refused row (`value:'abc'`) | the danger sentence still shows; `:108` `toHaveTextContent('abc')` becomes `.not.toHaveTextContent('abc')` |
- [ ] **Step 3: Run them and see the new rows fail:** `test/box-settings-read.test.ts` from `server/`, then from `pwa/`
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-card.test.tsx`.
- [ ] **Step 4: Implement the three version-1 rewrites (D-7911, D-7912).**
  - `shared/api.ts`:
    - `BoxSettingRowV1 = { key: BoxSettingKey; state: 'ok'; value: string; from: BoxSettingSource } | { key: BoxSettingKey; state: 'refused'; from: BoxSettingSource; why: string } | { key: BoxSettingKey; state: 'unmeasured'; why: string }`;
    - `BoxSettingsDocV1`: today's `BoxSettingsDoc` (`:9977-9981`) with `settings: BoxSettingRowV1[]`; keep the name
      `BoxSettingsDoc` as the union (Step 7), and for this commit alias `BoxSettingsDoc = BoxSettingsDocV1` and
      `BoxSettingRow = BoxSettingRowV1`;
    - `BOX_SETTINGS_V1_REFUSED_WHY = 'refused by its check; this box's build words the refusal with the value, so it is not shown here until the box is updated'`
      (printable ASCII, at most 240, names no value; if the apostrophe trips a census, write "this build of the box");
    - `BOX_SETTINGS_V1_UNFIT_WHY = 'recorded by an older ccrc in a form this view does not show'`.
  - `boxSettings.ts`:
    - `VALUE_RE = new RegExp(BOX_SETTING_VALUE_SHAPE)` and `ORIGIN_RE = new RegExp(BOX_SETTING_ORIGIN_SHAPE)`, compiled
      once (no `g` flag, so no state), and one pure `fitsClass(key, value)`: `value.length <= BOX_SETTINGS_TEXT_MAX`
      (the writer's own bound; the value is already printable ASCII, so length is bytes) and, by
      `BOX_SETTING_SPECS[key].cls`, `value` → `VALUE_RE.test(value) || (BOX_SETTING_VALUE_WORDS[key]?.includes(value) ?? false)`,
      `origin` → `ORIGIN_RE.test(value)`, any other class → `false`. The comment says the two shapes are envelopes that prove no
      value can carry a credential, and restate no setting's check. Version 2 (Step 7) uses the same function.
    - `rowOf` (`:62-74`) becomes `rowOfV1`. It checks exactly as today, then rewrites: a refused row returns
      `{ key, state, from, why: BOX_SETTINGS_V1_REFUSED_WHY }`; an `ok` row for which `fitsClass(key, value)` is false
      returns `{ key, state: 'unmeasured', why: BOX_SETTINGS_V1_UNFIT_WHY }`; an `unmeasured` row whose `why` is over
      `BOX_SETTINGS_WHY_MAX` returns its first 237 bytes and `...`. Nothing the box wrote in those three cases is
      forwarded.
  - PWA follow-through (review E4), every file the PWA's `tsc` compiles:
    - `boxSettingsWords.ts`: `readRow` returns `BoxSettingRowV1 | null`; its refused arm reads `key`, `from` and `why`
      and no longer requires or keeps `value`; `readDoc` types its local as `BoxSettingRowV1[]` and still accepts
      `v === 1` only (`:95`; Task 6 widens it); `settingLine` shows `BOX_SETTINGS_TEXT.refused` (`'refused'`) where a
      refused row's value was;
    - `box-settings-card.test.tsx`: `:100`'s refused literal keeps `value: 'abc'` as a wire forgery, written
      `{ … } as unknown as BoxSettingRow` with a comment that a wave-1 server may still send it; `:107-108` as Step 2.
  - Re-run Step 3's suites green, and `cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit -p .` plus both server
    `tsc` runs.
  - Commit: `fix(server): a version-1 row reaches no console with a refused value or a value outside the envelope (D-7911, D-7912)`,
    then `git fetch origin main` and `deviation-refs` (it defines D-7911 and D-7912; review E11).
- [ ] **Step 5: Write the failing version-2 rows.** The base is `v2Base()`, a test-local builder over
  `BOX_SETTINGS_SHOWN` and `BOX_SETTING_SPECS` (the test's own fixture, not a second definition of any check):
  a `value` key → `{key,state:'ok',value:'1',from:'default'}`; `origin` → `{…,value:'default',from:'default'}`;
  `presence` → `{key,state:'ok',from:'default'}`; the top level is version 1's with `v: 2`. With
  `BOX_SETTINGS_FIXTURES=write` it writes `ok--v2-synthetic-base.json`, `ok--v2-synthetic-every-word.json` (each fixed
  word once) and `ok--v2-synthetic-largest.json` (below). Each forgery row first asserts that the unforged base parses.

  **Rows that parse** (not `null`, `doc.v === 2`, keys out in `BOX_SETTINGS_SHOWN` order whatever order they came in):
  the base shuffled; a presence row in each of `from` `file`, `empty` and `default`; a `value` row at each of `24G`,
  `50%`, `400%`, `0`, `3s`, `10m`, `64M`, `86400` and a 32-digit value; `CCRC_TESTBOX_LOST_RUN` `fail` and
  `CCRC_TESTBOX_FALLBACK_INSTALL` `refuse`; `CCRC_RELEASE_BASE_URL` `custom`,
  `custom https://mirror.example.invalid:8443`, `custom HTTPS://mirror.example.invalid`, `custom https://[::1]:8080` and
  `custom mirror.example.invalid`; a refused row whose `why` is each member of `BOX_SETTING_REFUSAL_WORDS` in turn; an
  unmeasured row with a 240-character why.

  **Rows that are `null`**, each alone on the base:

  | Row | Forgery |
  |---|---|
  | `an is-set row carrying a value` | `CCRC_GRAPH_STORE` ok with `value:'/srv/g'` |
  | `an is-set row carrying an empty value` (review L6) | `CCRC_GRAPH_STORE` ok with `value:''` |
  | `a refused version-2 row carrying a value` | a refused `CCRC_GRAPH_BUDGET` with `value:'x'` and a set why |
  | `a refused version-2 row carrying an empty value` (review L6) | a refused `CCRC_GRAPH_BUDGET`, and a refused `CCRC_GRAPH_STORE`, each with `value:''` and a set why |
  | `an unmeasured row carrying a value or a from` | each, separately |
  | `a value row whose value is a path` | `CCRC_GRAPH_BUDGET` ok `'/etc/x'` |
  | `a value row whose value is a URL with a token` | `'https://h/?token=abc'` |
  | `a value row with a word that is not its own` | `CCRC_GRAPH_BUDGET` ok `'local'` |
  | `a value row with a 33-digit value` | `'1'.repeat(33)` |
  | `a value row with a unit the shape does not take` | `'5Q'`, `'5 G'`, `'-1'`, `'1.5'` |
  | `an origin with a userinfo` | `custom https://u:p@h` |
  | `an origin with a path, query or fragment` | `custom https://h/r`, `custom https://h?x`, `custom https://h#x` |
  | `an origin with a colon that is not a port` | `custom h:abc` (the writer never emits it: Task 5 writes such a base `unmeasured`) |
  | `an origin on another scheme` | `custom ftp://h` |
  | `an origin with no host` (review L10) | `custom https://`, and `custom ` (a trailing space) |
  | `an origin that is not default or custom` | `'https://h'` alone, and `'set'` |
  | `a refused why outside the closed set` | `'CCRC_GRAPH_BUDGET=\'7x\' is not a whole number'` |
  | `a why of 241 characters` | an unmeasured why `'x'.repeat(241)` |
  | `a version-2 document missing one row` | `settings.pop()` (60 rows) |
  | `a version-2 row for an omit setting` | append `{key:'CCRC_TESTBOX_RUNS',state:'ok',value:'2',from:'default'}` (62 rows) |
  | `the same, in place of a real row` | the last row's key replaced with `CCRC_TESTBOX_RUNS` (61 rows) |
  | `a duplicated version-2 key` | row 8's key set to row 7's |
  | `version 3`, `version 0`, `version "2"` | `v` set to each |
  | `a version-2 document with the version-1 key list` | `v:2` with the seven rows of `ok--v1-defaults.json` (also kept as `malformed--version-2.json`) |
  | `a version-1 document with a presence row` | `ok--v1-defaults.json` with its release-base row's `value` deleted |

  Write the file corpus as `malformed--v2-presence-with-value.json`, `malformed--v2-refused-with-value.json`,
  `malformed--v2-why-outside-set.json`, `malformed--v2-omit-row.json`, `malformed--v2-origin-outside.json` (the
  `custom h:abc` row) and `malformed--version-3.json`, so the lane-level corpus row (`:407`) runs them too.

  **The vocabularies:**
  - `BOX_SETTING_VALUE_WORDS` is Task 3's (T10 holds it equal to `_tb_shape`'s word arms and to the bash mirror); this
    task adds no second copy of that row.
  - `every member of BOX_SETTING_REFUSAL_WORDS is printable ASCII of at most 240 characters, and none holds '=' or a quote`
    (the server's half of D22; the bash set-equality is Task 3's W1).
  - `the writer and the server agree on the envelope, entry by entry` (review F5): for each `{ key, value }` of
    `ENVELOPE_CORPUS` (`./boxSettingsEnvelope.js`, Task 3), `parseBoxSettings` of `v2Base()` with that key's row set to
    `{ key, state: 'ok', value, from: 'file' }` is not `null` exactly when bash `_set_fits <key> <class> "$V"` answers
    rc 0, run in the same fixture as Task 3's E2.

  **Size:** `the largest document this parse accepts fits under the node-file cap`. Build it from the parse's own
  bounds: every one of the 61 rows unmeasured with a 240-character why of `\` (each escapes to 2 bytes), except the
  release base, ok with a `custom https://<host>` of `BOX_SETTINGS_TEXT_MAX` (480) characters, the longest `fitsClass`
  admits; `at` and every count `Number.MAX_SAFE_INTEGER`;
  backups and disk unmeasured with 512-character whys of `"`. `parseBoxSettings` is not `null` and
  `Buffer.byteLength(text) < NODE_FILE_CAP_BYTES` (arithmetic, about 36 KB, in a comment); the same file through the
  lane (`readOf(ccrcWith(...))`) reads `ok`, not `too-large`. The writer-side pin is Task 5's V7.

  **The view and the lane, for version 2:** `boxSettingsView ages a version-2 document by the request's clock exactly
  as version 1` (the `:274-290` rows again over `ok--v2-synthetic-base.json`); `the lane holds a version-2 document
  whole, and the route serves it` (`docAt` over the v2 base; `settings.doc.v === 2`, keys equal `BOX_SETTINGS_SHOWN`);
  `a version-2 document's presence rows reach the wire with no value` (the raw body holds no `"value"` inside any
  presence key's object).

  **Make the corpus rows version-agnostic:** `:120-131`, the live-verb row (`:145-154`) and the vocabulary row's
  `live!.settings` check (`:250-251`) assert `doc.v` is 1 or 2, and that the keys equal `BOX_SETTINGS_KEYS` for 1 or
  `BOX_SETTINGS_SHOWN` for 2; `ok--v1-*` files must be `v === 1`. Task 5's switch then needs only the regeneration.
- [ ] **Step 6: Run them and see them fail** (`box-settings-read.test.ts`).
- [ ] **Step 7: Implement version 2 (D-7913).**
  - **`shared/api.ts`:**
    - `BoxSettingRowV2 = { key: BoxSettingName; state: 'ok'; value: string; from: BoxSettingSource } | { key: BoxSettingName; state: 'ok'; from: BoxSettingSource } | { key: BoxSettingName; state: 'refused'; from: BoxSettingSource; why: BoxSettingRefusalWord } | { key: BoxSettingName; state: 'unmeasured'; why: string }`.
      The second arm is a `presence` row, told apart by `'value' in row`; the parse admits an ok row without `value`
      only for a presence-class key, so the absence has one meaning.
    - `BoxSettingsDocV2` (`v: 2`, the same top-level keys); `BoxSettingsDoc = BoxSettingsDocV1 | BoxSettingsDocV2`
      (discriminated by `v`); `BoxSettingRow = BoxSettingRowV1 | BoxSettingRowV2`. The wire carries the box's own
      version; the server does not convert version 1 to version 2.
    - `BOX_SETTING_VALUE_WORDS` is Task 3's; nothing is added here.
    - No new exported literal union: `rings/wire-totality`'s `EXEMPT_PINNED` stays as Task 3 left it.
  - **`boxSettings.ts`:** after the unchanged top-level `hasKeys` check (`:101`):
    - `v === 1` takes the version-1 path as Step 4 left it (length `BOX_SETTINGS_KEYS.length`, `rowOfV1` with its
      three rewrites);
    - `v === 2` takes `rowOfV2`, with length `BOX_SETTINGS_SHOWN.length`, each key in `BOX_SETTINGS_SHOWN` (looked up
      with `Object.hasOwn(BOX_SETTING_SPECS, key)` and `BOX_SETTING_SPECS[key].cls !== 'omit'`; no module-level `Map`),
      no duplicate, and the class from `BOX_SETTING_SPECS[key].cls`:

      | State and class | Exact keys | Value check |
      |---|---|---|
      | unmeasured | `[key,state,why]` | `why` printable ASCII, length at most `BOX_SETTINGS_WHY_MAX` (D-7913) |
      | refused | `[key,state,from,why]` | `why` a member of `BOX_SETTING_REFUSAL_WORDS` |
      | ok, `presence` | `[key,state,from]` | none |
      | ok, `value` | `[key,state,value,from]` | `fitsClass(key, value)` (Step 4: the shape, or that key's own words) |
      | ok, `origin` | `[key,state,value,from]` | `fitsClass(key, value)` (the origin shape) |

      Anything else is `null`: unlike version 1, version 2 is this build's own writer's, so a row outside the envelope
      is a forgery, never rewritten. Every arm tests for the `value` KEY (`hasKeys`), never for a truthy value, so
      `value: ''` on a presence or refused row is as `null` as any other value (review L6).
    - The output is rebuilt in `BOX_SETTINGS_SHOWN` order. `deadline`, `backups` and `disk` use the existing
      `backupsOf`/`diskOf`, unchanged. `boxSettingsReadOf`, `boxSettingsGate` and `boxSettingsView` are unchanged. The
      header comment changes from "the seven keys" to both versions.
  - **`shared/agent-protocol.ts:175-183`:** rewrite the paragraph once, for both versions: version 1 holds the seven
    named settings; the server checks each version-1 `ok` value or origin against the same envelope as version 2,
    drops a version-1 refused row's value and why, rewrites an `ok` row outside the envelope as `unmeasured`, and cuts
    an unmeasured why to 240 before any console sees it; version 2 holds the 61 a fleet or server node reads, by display
    class, where only an `ok` row of class `value` or `origin` carries a value, and the server checks that value or
    origin against the setting's class and a refused row's `why` against the closed set. An `unmeasured` row's `why`
    in either version is bounded text the box wrote (printable ASCII, at most 240), never checked against a closed set
    (review L9). The "One residual" sentence goes: it no longer holds once the server is upgraded.
  - **PWA follow-through for the union** (review E4): `settingLine` narrows with `'value' in row`; a row with no `value`
    (a presence row, which no console reads before Task 6 since `readDoc` still takes `v === 1` only) shows its source
    word, `BOX_SETTING_SOURCE_TEXT[row.from]`, as its value and `from: null`; Task 6 replaces that with the presence
    words. `readRow` and `readDoc` stay typed `BoxSettingRowV1`. In `box-settings-card.test.tsx` the type import
    (`:6`) adds `BoxSettingRowV1` and `BoxSettingsDocV1`, `okRows(): BoxSettingRowV1[]` and
    `doc(over: Partial<BoxSettingsDocV1> = {}, …): BoxSettingsDocV1` (`:32-47`); `ok(d: BoxSettingsDoc = doc(), …)`
    keeps the union.
- [ ] **Step 8: Run green, then the mutants** on a saved copy of `boxSettings.ts`:

  | # | Mutant | Rows that must go red |
  |---|---|---|
  | M1 | the presence arm admits `[key,state,value,from]` | `an is-set row carrying a value`, `malformed--v2-presence-with-value.json` |
  | M2 | the refused why check becomes `isStr` | `a refused why outside the closed set`, `malformed--v2-why-outside-set.json` |
  | M3 | the refused v2 arm admits `value` | `a refused version-2 row carrying a value` |
  | M4 | `rowOfV1` keeps `value` | Step 2's parse, lane and route rows |
  | M5 | `rowOfV1` keeps the box's why | `no raw text of a version-1 refused row survives the parse` |
  | M6 | the `v === 1` branch removed | every `ok--v1-*.json` row |
  | M7 | `VALUE_RE` replaced by `isStr` | `… whose value is a path`, `… a URL with a token` |
  | M8 | `ORIGIN_RE` replaced by `isStr` | `an origin with a userinfo`, `… a path, query or fragment`, `malformed--v2-origin-outside.json` |
  | M9 | the words lookup removed | the `fail` and `refuse` rows, `ok--v2-synthetic-every-word.json` |
  | M10 | the words looked up on any key | `a value row with a word that is not its own` |
  | M11 | the v2 length check removed | `a version-2 document missing one row` |
  | M12 | the key check admits omit keys | `the same, in place of a real row` |
  | M13 | the why bound raised to 512 | `a why of 241 characters` |
  | M14 | the presence and refused arms test `o['value']` for truthiness (`if (o['value']) return null`) in place of the exact key set (review L6) | `an is-set row carrying an empty value`, `a refused version-2 row carrying an empty value` |
  | M15 | `rowOfV1` skips `fitsClass` on an `ok` row (review L4) | `a version-1 ok row outside the envelope is rewritten unmeasured`, the lane row's `zz-leak` case |
  | M16 | `rowOfV1` forwards a long unmeasured why whole (review L4) | `a version-1 unmeasured why is bounded at 240 by a cut` |
  | M17 | `fitsClass` drops its length bound | the 481-byte origin entry of `the writer and the server agree on the envelope` |
- [ ] **Step 9: The named suites.** From `server/`: `box-settings-read`, `box-settings-table`, `update-routes`,
  `update-projection`, `rings/outward-edges`, `rings/totality`, `rings/wire-totality`, `rings/shared-imports`, the
  `single-definition/` directory (whole), `single-definition-pin`, `ccrc-settings-census`, `ccrc-settings-verb`,
  `testbox-pins` (with this commit's holders added), `topology-clean`, `typecheck-tests`, `lane-schedule`; growth
  armed; both `tsc` runs. From `pwa/`: `box-settings-card`,
  `settings-updates`, `role-census`, and `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`. Then
  `git diff --stat ffa9f0ab2 -- server/src/update/boxSettingsLane.ts server/src/update/routes.ts server/src/update/inventory.ts server/src/watch.ts`
  is empty.
- [ ] **Step 10: Commit.** `feat(server): read box settings version 2 beside version 1, every row checked against its class (D-7913)`,
  with `BOX_SETTINGS_W2_HOLDERS` extended (Files), then `git fetch origin main` and `deviation-refs` (it defines
  D-7913; review E11).

**What this proves for the rollout.**
- A version-2 node never reads `malformed` on a version-2 server: every `ok--*.json` the real verb writes parses at
  every commit (the corpus row is version-agnostic), every refusal word and fixed word parses, and the largest accepted
  document fits under the cap.
- A wave-1 server reads a version-2 node as `malformed` (`boxSettings.ts:103-104`, pinned on `main` by the
  `'version 2'` forgery). `--server-first` means no box shows that.
- A console tab on wave 1's build reads a version-2 node as unrecognised (`boxSettingsWords.ts:95`), and, after Step 4,
  a version-1 node with any refused row too, since its `readRow` requires `value` (`:75`). A reload cures both
  (D-7912). A version-1 row the server rewrote as `unmeasured` (out of the envelope, review L4) reads on that tab as
  an ordinary unmeasured row.
- An honest wave-1 box still shows on a version-2 server: every value in its nine documents fits the envelope, and its
  one over-long unmeasured why is cut, not refused.

### Task 5: the verb writes version 2: 61 settings by class, a refused one with no value (D-7910; D-7909 used; D-7906 raised)

Spec 5.1, 5.3, 5.4 (the writer), 5.7, D11, D14, D20, D22. Lands after Task 4. In the same commit as the switch, the
bash `BOX_SETTINGS_KEYS` literal retires (D-7910), the usage text that says "seven" is rewritten, the `ok--*.json`
corpus is regenerated and the waiver raised (C8; review F2, E1, F9, E5).

**Files:**
- Modify: `ccd/ccrc`: `cmd_settings` (`:26166`) and its helpers; add `_set_row_json`, `_set_tb_host` and `_set_lines`;
  retire `_set_keep_why` (`:26164`) and the bash `BOX_SETTINGS_KEYS=(…)` literal (`:26115`, D-7910); rewrite the verb's
  header comment (`ccd/ccrc:26092-26114`), its usage paragraph (`:2716-2726`) and the installer's comment above the
  settings pair (`:18475`).
- Modify: `server/test/ccrc-settings-verb.test.ts` (version 2; its file header `:1` and the usage pin `:609`).
- Modify: `server/test/box-settings-read.test.ts`: the seven-keys row (`:243-254`) and its helper `verbKeys`
  (`:212-215`) only (review F3, E9).
- Modify: `server/test/box-settings-table.test.ts`: delete T9 (the literal it held is gone).
- Modify: `server/test/ccrc-cli.test.ts` (`:232`) and `server/test/install-census.test.ts` (`:2194`): the usage pin's
  new first line (review F9, E5).
- Regenerate and commit: `server/test/fixtures/box-settings/ok--*.json` (`BOX_SETTINGS_FIXTURES=write`).
- Modify: `server/test/testbox-pins.test.ts`: `BOX_SETTINGS_W2_HOLDERS` gains `server/test/ccrc-settings-verb.test.ts`
  (V2, V3, V4, V6, V9, V10 name test-box keys) and the nine regenerated `ok--<name>.json` (each now holds the 16
  test-box rows): `ok--backups-and-disk-unmeasured.json`, `ok--custom-base-url.json`, `ok--defaults.json`,
  `ok--long-sentence.json`, `ok--refused.json`, `ok--sources.json`, `ok--timer-reader.json`,
  `ok--unmeasured-nul.json`, `ok--with-backups.json` (each under `server/test/fixtures/box-settings/`). The new usage
  text names no test-box key, so `ccrc-cli.test.ts` and `install-census.test.ts` do not become holders. Re-measure
  with `git grep -l` as Task 3 Step 4 does.
- Modify: `server/test/growth-waivers/D-7906-ccd-ccrc.json` (raised).
- Run unchanged: `ccrc-settings-census`, `ccrc-settings-lib`, `testbox-knobs`, `graph-knobs`, `ccrc-test-wrapper`,
  `ccrc-update-kept`, `ccrc-update-flip-backups`, `ccrc-models-advance`, `ccrc-update-phases`,
  `ccrc-versions-warn-arms`, the `single-definition/` directory and `single-definition-pin`, `docs-parity`.

**Claims to take:** `ccd/ccrc`, `server/test/ccrc-settings-verb.test.ts`, `server/test/box-settings-read.test.ts`
(`:212-215` and `:243-254` only), `server/test/box-settings-table.test.ts` (T9 only), `server/test/ccrc-cli.test.ts`
(`:232` only), `server/test/install-census.test.ts` (`:2194` only), `server/test/testbox-pins.test.ts`,
`server/test/fixtures/box-settings/ok--*.json` (the nine live files, not `ok--v1-*`),
`server/test/growth-waivers/D-7906-ccd-ccrc.json`.

**The version-2 document.** The same top level as version 1 (`v`, `at`, `reader`, `settings`, `deadline`, `backups`,
`disk`), with `v: 2` and 61 rows in `BOX_SETTINGS_SHOWN` order:

| state | class | row |
|---|---|---|
| `ok` | `value`, `origin` | `{key, state, value, from}`, the value inside the envelope (`_set_fits`) |
| `ok` | `presence` | `{key, state, from}` (`default` unset, `file` set, `empty` set to empty) |
| `refused` | any | `{key, state, from, why}`, `why` = `_set_says "$k"`, a member of `BOX_SETTING_REFUSAL_WORDS`; never a value |
| `unmeasured` | any | `{key, state, why}`, `why` through `_set_json "$why" 240` |

An `ok` value or origin that fails `_set_fits` is written `unmeasured` with Task 3's fixed why (D-7909); it is never
cut. This holds for every `ok` value and origin row, wave 1's seven included (review L12).

- [ ] **Step 1: Write the failing verb tests** (`ccrc-settings-verb.test.ts`). Every case runs in a `mkTmp` fixture HOME
  through `ccrcContainedEnv` (`:59-73`). `envOf` deletes every name of `CCRC_SETTINGS` (read with `ccrcSettingsNames`),
  not just the seven at `:38`. The `describe` names below are new, or replace wave 1's at the lines given. **Every row
  that plants a value asserts that value is absent from stderr as well as from the sinks it names** (the timer's
  stderr goes to the journal; review L11).
  - **V1, replacing `:104-116`.** `ccrc settings --json` in an empty fixture gives `v === 2`, and
    `settings.map(s => s.key)` equals `BOX_SETTINGS_SHOWN`. No omitted key appears (`CCRC_TESTBOX_RUNS` among them).
    The `own` assertion (`:110-111`) inverts: `ccd/ccrc` holds no `^BOX_SETTINGS_KEYS=\(` line (D-7910); the first
    seven of `CCRC_SETTINGS` are still the seven `updates` rows, in order. The describe title (`:104`) and the file
    header (`:1`) say the 61 settings, not "the seven".
    Every row is `ok`, `from: 'default'`. Every `value`-class row's value is its literal default:
    `CCRC_GRAPH_BUDGET` `4`, `CCRC_TESTBOX_QUEUE_WAIT` `10m`, `CCRC_TEST_SLICE_CPU_QUOTA` `400%`,
    `CCRC_SESSION_SLICE_MEMORY_MAX` `24G`, `CCRC_KEEPALIVE_FRESH` `1800`, `CCRC_USAGE_SWEEP_DAYS` `7`,
    `CCRC_CARRY_COPY_WARN_BYTES` `10737418240`, `CCRC_TESTBOX_LOST_RUN` `local`. Every `presence` row is exactly
    `{key, state: 'ok', from: 'default'}`. The fixture HOME's path is nowhere in stdout (`CCRC_GRAPH_STORE`'s default is
    under it).
  - **V2, sources and file mode** (D20, 5.7):
    - `ccrc.env` with `CCRC_GRAPH_BUDGET=6`, `CCRC_TESTBOX_POLL=45s` and `CCRC_KEEPALIVE_FRESH=900` gives those three
      `ok`, `from: 'file'`, the value as written;
    - the same three set only in the environment (`9`, `5s`, `60`) read their defaults, `from: 'default'`;
      `CCRC_TEST_PRESSURE_MAX=50` in the environment reads `0`, `from: 'default'` (`_test_knobs`' own read is
      env-first, `ccd/ccrc:28675`; the verb's is file mode);
    - wave 1's seven keep their mode: `CCRC_BACKUP_KEEP=5` in the environment reads `{…, value: '5', from: 'environment'}`.
  - **V3, presence.** `ccrc.env` with `CCRC_TESTBOX_URL=https://secret-host.invalid:9000/x?token=abc`,
    `CCRC_TESTBOX_GIT_KEY=~/k/push.key`, `CCRC_KEEPALIVE_PROMPT=say hi` and `CCRC_GRAPH_REPOS_EXCLUDE=` (an empty line):
    `{key: 'CCRC_TESTBOX_URL', state: 'ok', from: 'file'}`, `{…GIT_KEY, ok, file}`, `{…PROMPT, ok, file}`,
    `{key: 'CCRC_GRAPH_REPOS_EXCLUDE', state: 'ok', from: 'empty'}`. None of `secret-host`, `token`, `9000`, `push.key`
    or `say hi` appears in stdout, stderr, the `--write` file or the human form.
  - **V4, a refused row carries the words and the source, never the value** (D14, D22), over EVERY key `_set_says`
    has words for (the 58; review F17). One `ccrc.env` sets each of the 58 wave-2 and wave-1 file-read keys to a value
    its own check refuses: by default `zz-refused-<i>`; for a key whose check accepts that (its `_set_check` answers 0),
    a per-key override in the test's `REFUSED_SAMPLE` table (the named cases below among them). Before the verb runs,
    the row asserts `_set_check <KEY> "$V"` answers 1 for every chosen sample in the same fixture, so a sample that a
    check accepts fails loudly; the override table is filled at this step by running `_set_check` over the 58 once.
    Each row is `toEqual` on the whole row (no `value` property), with `why` taken from bash
    (`_set_libs; _set_says <KEY>`, run in the same fixture), and every sample is absent from stdout, stderr, the file
    and the human form. Named cases, each also a row of its own:
    - `CCRC_TESTBOX_GIT_KEY=relative/key` (`from: 'file'`);
    - `CCRC_TESTBOX_UNTRACKED_FILE_MAX=5MB`;
    - `CCRC_GRAPH_MAX_SHRINK_PCT=150`;
    - `CCRC_GRAPH_SOURCE_REF=../x` (a presence row refused);
    - `CCRC_TEST_SLICE_CPU_QUOTA=4`;
    - `CCRC_SESSION_SLICE_MEMORY_MAX=90`;
    - `CCRC_KEEPALIVE_FRESH=30m`, `CCRC_USAGE_SWEEP_DAYS=0` and `CCRC_CARRY_COPY_WARN_BYTES=10G`;
    - wave 1's seven, replacing the rows at `:140-197`: `CCRC_BACKUP_KEEP=abc` in the environment →
      `{key, state: 'refused', from: 'environment', why: 'a whole number from 0 to 9999'}`; `CCRC_BACKUP_DATA_KEEP=1`
      from `ccrc.env` → why `a whole number from 2 to 9999`, `from: 'file'`; `CCRC_UPDATE_HEALTH_S=ninety` → why
      `a number of seconds (digits only, at most 18)`; `CCRC_UPDATE_DEADLINE_MS=6e5` → why `_upd_deadline_says`'s words,
      with `deadline.plainMs` 900000 and `minMs` 0 as before; `CCRC_MODELS_ADVANCE_BUDGET_S=3601` and `=off` → why
      `a whole number of seconds from 0 to 3600`.
    - The wave-1 redaction rows at `:258-329` that read a refused `value` are rewritten: the long-HOME keep row
      (`:267-282`) asserts no `value`, why `a whole number from 0 to 9999`, and no 12-character window of the home path
      anywhere; the `https://u:p@h/` health row (`:297-305`) asserts that neither `u:p` nor `h/` appears; the 480-cut
      row (`:322-329`) moves to V6.
  - **V5, unmeasured.**
    - A NUL byte in `ccrc.env` makes all 61 rows unmeasured: each `why` contains `<key> cannot be measured:` and
      `~/.ccrc/ccrc.env`, at most 240 bytes, no `value` or `from`, rc 0. Replaces `:200-213`.
    - A `ccrc.env` line `export CCRC_GRAPH_BUDGET=6` makes `CCRC_GRAPH_BUDGET` alone unmeasured, with the reader's
      sentence (the graph line's 4th field).
    - With `graph-resolve` hidden (the verb run from a copy of `ccd/` without it), the 23 graph rows are unmeasured with
      `SET_GR_WHY`'s sentence, `CCRC_GRAPH_REPOS_EXCLUDE` (default `''`) included; with `testbox-knobs` hidden, the 16
      test-box rows read `SET_TB_WHY`'s, `CCRC_TESTBOX_URL` and `CCRC_TESTBOX_GIT_URL_BASE` (default `''`) included
      (`_set_check`'s library step comes before its empty step). No other row changes.
  - **V11, a unit separator in a value never becomes a `why`** (review L1). `ccrc.env` holds
    `CCRC_GRAPH_STORE=/x<US>zz-secret` and, in a second case, `CCRC_TEST_SLICE_MEMORY_MAX=6G<US>zz-secret` (`<US>` the
    byte 0x1f, written with `Buffer`). Each reads exactly
    `{key, state: 'unmeasured', why: "<KEY>'s value holds a control byte this view does not record"}`; `zz-secret`
    appears in none of stdout, stderr, the `--write` file and the human form. A third case,
    `CCRC_KEEPALIVE_PROMPT=a<US>zz-secret` (a direct `_ccrc_knob` read, no line split), reads the same sentence for its
    key: the 0x1f rule holds for every reader, split or not.
  - **V6, the envelope and the cuts** (D-7909).
    - `CCRC_TESTBOX_SNAPSHOT_MAX=` `1` + 39 nines + `M` (a 40-digit size `_tb_shape` passes) reads
      `{key, state: 'unmeasured', why: "CCRC_TESTBOX_SNAPSHOT_MAX's value passes its check but is wider than this view records (at most 32 digits and one unit, or one of its words)"}`,
      never a cut or whole value.
    - Measure `_upd_url_origin 'https://h:abc/r'` first; if it prints `https://h:abc` (as read), then
      `CCRC_RELEASE_BASE_URL=https://h:abc/r` reads `{key, state: 'unmeasured', why: <the origin fixed why>}`. If it
      answers otherwise, pin what it answers and record it in As built.
    - `CCRC_RELEASE_BASE_URL=https://` (`_upd_url_origin` prints `https://` with rc 0, `ccd/ccrc:2969-2974`): the row
      reads `unmeasured` with the origin fixed why, never `custom https://` (review L10).
    - Wave 1's value rows go through `_set_fits` too (review L12): `CCRC_BACKUP_KEEP=9999` reads `ok` `9999`, and a
      planted resolver stub (a shell that sources `ccd/ccrc`, defines
      `_bak_keep() { KEEP=/etc/x; KEEP_WHY=; KNOB_FROM=default; }` and then runs `cmd_settings --json`, so the arm
      receives a value no real resolver emits) reads `unmeasured` with the value fixed why, and `/etc/x` appears in
      neither stream.
    - The longest reader sentence (wave 1's `:223-236` case) is cut at 240 when over it, ending `...`.
  - **V7, the largest document** (spec 5.4, the size pin). Source `ccd/ccrc` and build the worst document from the
    writer's own functions: for each of the 61 keys, the larger of `_set_row_json <key> unmeasured '' '' "<300 double quotes>"`
    and `_set_row_json <key> ok environment "<32 nines>E" ''`; the top level with an 11-digit `at`, `reader` `shell`,
    three 15-digit deadline figures, backups and disk at 15-digit counts, or `unmeasured` with a 480-byte why of `"`,
    whichever is larger. Assert `Buffer.byteLength(doc) + 1` is at most `NODE_FILE_CAP_BYTES`
    (`server/src/update/inventory.ts:55`). Record the figure in As built. **Mutant:** raise the why cut to 2000; V7 red.
  - **V8, the human form** (replacing `:613-644`). The three existing formats stay byte for byte
    (`ccd/ccrc:26228-26234`, review F4): `'%-30s %s  (%s, %s)'` for an ok row, the same then `: <why>` for a refused
    one, `'%-30s %s'` then `: <why>` for an unmeasured one. What goes in the value slot: an ok value or origin as
    written; a presence row `set`, `unset` or `set to empty` (`CCRC_TESTBOX_URL               set  (ccrc.env, ok)`); a
    refused row `not shown`, its why the check's words
    (`CCRC_BACKUP_KEEP               not shown  (environment, refused): a whole number from 0 to 9999`). A row whose
    bash `applies` is `update` ends `; takes effect at the next ccrc update`, appended after the format
    (`CCRC_GRAPH_BUDGET` does, `CCRC_GRAPH_KEEP_BUILDS` does not). A key longer than 30 characters prints with the
    format's one literal space and no padding: `^CCRC_GRAPH_INCREMENTAL_MAX_FILES 0  \(default, ok\)$`. Wave 1's rows
    keep their exact spacing, so `:436`'s `CCRC_RELEASE_BASE_URL {10}custom {2}\(` holds unedited.
  - **V9, the literal-call mirror.** `_set_tb_host` holds exactly `_tb_host_table`'s `(key, default)` pairs, in order
    (both extracted as `_ccrc_knob (CCRC_TESTBOX_[A-Z_]+) ('[^']*'|"[^"]*"|\S+) file` from each body); the verb's slice,
    keepalive, usage, carry and pressure literals are in `file` mode; `cmd_settings` and its `_set_*` helpers never name
    `TBK_WARN`, `GK_WARN`, `_tb_load`, `_gr_knobs` or `_slice_limit ` (trailing space). **Mutant:** `_set_tb_host`'s
    `5M` → `6M`: V9 and census C2 (`ccrc-settings-census.test.ts:359`) red.
  - **V10, empty means the default, per family** (the ruling on Q5). One row per family: an empty line `KEY=` in
    `ccrc.env` for `CCRC_SESSION_SLICE_SWAP_MAX`, `CCRC_TEST_WIDE_FILES`, `CCRC_GRAPH_STORE`, `CCRC_TESTBOX_URL`,
    `CCRC_KEEPALIVE_PROMPT`, `CCRC_USAGE_SWEEP_DAYS` and `CCRC_CARRY_COPY_WARN_BYTES`. The verb's row reads
    `from: 'empty'` (with the default value for a `value`-class key). In the same fixture, the consumer whose read the
    verb copies answers its default: `_ccrc_knob <KEY> <default> file` as the slice installer, `_test_knobs`,
    `_graph_knobs file`, `_tb_load` (`TBK[<KEY>]` and `TBK_FROM[<KEY>]`), the keepalive's and usage sweep's library read,
    and doctor's carry read (`check(box)` reads the default bound). If any consumer keeps an empty value meaningful
    (reads it as other than its default), stop: do not write the row or the verb's arm, and ask the coordinator.
  - **The vocabularies row** (`:831-844`) and `box-settings-read`'s word extractor (`:208`) keep working: the `s_`,
    `f_` and `r_` locals stay in `cmd_settings`, and no JSON literal spells a state. Add a `c_` prefix only if the body
    names class words, held to `BOX_SETTING_CLASSES` the same way.
  - **The emitted key list, replacing `box-settings-read.test.ts:243-254`** (review F3, E9). The row becomes "the keys:
    the verb emits `BOX_SETTINGS_SHOWN`, from the bash table, each once in `CCRC_SETTINGS`". A helper `emittedKeys(src)`
    replaces `verbKeys`: it takes the `^BOX_SETTINGS_TABLE=\($` … `^\)$` block of `src` and returns, in order, the key
    of every line whose class column is not `omit`. `emittedKeys(CCRC_SRC)` equals `BOX_SETTINGS_SHOWN`; each name
    appears once in `ccrcSettingsNames(CCRC_SRC)`; the live `ok--defaults.json` lists exactly `BOX_SETTINGS_SHOWN`.
    CONTROL: `emittedKeys` over `CCRC_SRC` with one table line deleted (the `CCRC_GRAPH_BUDGET` line) reads unequal to
    `BOX_SETTINGS_SHOWN`. `ccrc-settings-verb`'s V1 also asserts `ccd/ccrc` holds no `BOX_SETTINGS_KEYS=` line.
  - **The usage paragraph** (review F9, E5). The usage text (`ccd/ccrc:2716-2726`) holds, for the verb, exactly these
    first five lines in place of today's first six (the rest of the paragraph, from "deadline's three readings" on, is
    unchanged):

    ```text
      settings  print what each setting a fleet or server node reads resolves to
                (61 of CCRC_SETTINGS; the test box's own are left out), by display
                class: a value, an origin, or only whether it is set; where it came
                from (the environment, ccrc.env, an empty ccrc.env line or the
                default), and a refused setting's check words, never its value; then the
    ```

    The three pins move to the new first line, in this commit:
    `/^ {2}settings {2}print what each setting a fleet or server node reads resolves to$/m` in
    `ccrc-settings-verb.test.ts:609`, `ccrc-cli.test.ts:232` (which also pins the line's end, `$`) and
    `install-census.test.ts:2194`. Red at Step 2, green at Step 3.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the verb, version 2** (`ccd/ccrc`):
  - Call `_set_libs` once at the start.
  - **Reads**, every one a literal call:
    - wave 1's seven: unchanged, through their resolvers, in their own mode;
    - session slice: `_ccrc_knob CCRC_SESSION_SLICE_MEMORY_MAX 24G file` and `_ccrc_knob CCRC_SESSION_SLICE_SWAP_MAX 6G file`;
    - test runs: `_set_lines` reads `_test_knobs`' lines (`KEY<US>default<US>value<US>from`, `ccd/ccrc:28667-28676`) into
      associative arrays; the `CCRC_TEST_PRESSURE_MAX` line is dropped and replaced by
      `_ccrc_knob CCRC_TEST_PRESSURE_MAX 0 file`;
    - graph: `_set_lines` reads `_graph_knobs file` the same way;
    - **`_set_lines`' split** (review L1): each line is split into ALL its fields
      (`IFS=$'\037' read -r -a f`), never into four named ones, and judged by its value field, never its 4th:
      - a field count other than 4 (a value holding 0x1f): `unmeasured`, why
        `<KEY>'s value holds a control byte this view does not record` (the key from field 1; nothing else of the line
        is kept);
      - an empty value field (field 3) whose field 4 is not one of the four source words: the read failed
        (`_test_knob_say`'s rc≠0 arm, `ccd/ccrc:28663-28664`), `unmeasured` with field 4 as why, which is `KNOB_WHY`
        (it names the file, a line and the key);
      - otherwise a successful read: the value is field 3 and the source field 4 (one of the four words, else
        `unmeasured` with wave 1's "read from a source this verb does not know");
    - test box, host side: `_set_tb_host`, the 16 literal `_ccrc_knob CCRC_TESTBOX_<KEY> <default> file` calls in
      `_tb_host_table`'s order with its defaults;
    - keepalive: `_ccrc_knob CCRC_KEEPALIVE_FRESH 1800 file`, `_ccrc_knob CCRC_KEEPALIVE_MODEL haiku file`,
      `_ccrc_knob CCRC_KEEPALIVE_PROMPT "Reply with the single word: ok" file` (copy each default byte for byte from its
      consumer; C2 holds them);
    - usage sweep: `_ccrc_knob CCRC_USAGE_SWEEP_DAYS 7 file`; carry copies:
      `_ccrc_knob CCRC_CARRY_COPY_WARN_BYTES 10737418240 file`.
  - **The loop** walks `CCRC_SETTINGS` (the bash `BOX_SETTINGS_KEYS` literal is deleted, D-7910), `_set_spec`s each
    key, and skips `omit`. Wave 1's seven are the table's `updates` rows, reached first because they are the first
    seven of `CCRC_SETTINGS`. For a wave-2 row:
    - read failed: `unmeasured`, with `KNOB_WHY` or the line's why (`_set_lines`, above);
    - the value holds 0x1f (a direct `_ccrc_knob` read: `case "$KNOB" in *$'\037'*)`; a split read: the field count):
      `unmeasured` with the control-byte fixed why (review L1);
    - `_set_check "$k" "$value"` rc 2: `unmeasured`, with `SET_CHECK_WHY`;
    - rc 1: `refused`, `from` the reader's source, `why="$(_set_says "$k")"`, no value;
    - rc 0: `ok`; class `presence` writes no value; class `value` writes the value only if `_set_fits` passes, else
      `unmeasured` with the value fixed why.
  - For wave 1's seven, the existing arms stay, with these changes: the refused arm
    `1) st="$s_refused"; val="$KNOB"` (`ccd/ccrc:26215`) becomes `1) st="$s_refused"; val=""; why="$(_set_says "$k")"`;
    and EVERY `ok` value or origin of the seven goes through `_set_fits` (review L12): the six value rows, out of the
    envelope, become `unmeasured` with the value fixed why; the release base's `custom <origin>` (or `default`, or
    `custom`) with the origin fixed why. `_set_keep_why` retires.
  - **`_set_row_json <key> <state> <from> <value> <why>`** writes one of the four row shapes, each string through
    `_set_json` once: `"$(_set_json "$why" 240)"` for a why, `"$(_set_json "$value")"` for a value (which `_set_fits`
    has already held to 480). Nothing is passed through `_set_text` before `_set_json`, so nothing is redacted twice
    (review L7, F13). The document literal changes from `{\"v\":1,` to `{\"v\":2,` and nothing else at the top level.
  - **The human form** keeps its three formats (V8) and reads the bash `applies` column for the next-update mark.
  - `--json`, `--write` (temp under `_tmp_guard`, chmod 600, rename), `--from timer`, rc 0 and the `_ccrc_usage_die`
    usage are unchanged in shape.
  - **The usage paragraph** (`:2716-2726`): its first six lines become Step 1's five; the rest stays.
  - **The header comment** (`ccd/ccrc:26092-26114`), in words: 61 rows by the class table, not the seven (`:26093`,
    `:26097` say "seven"); wave-2 rows in file mode; a refused row records the check's words, never the value; the "ONE
    accepted residual" paragraph is removed; neither `TBK_WARN` nor `GK_WARN` is read; an `ok` value outside the
    envelope, or a value holding 0x1f, is written unmeasured (D-7909); `BOX_SETTINGS_KEYS` is gone (D-7910).
  - **The installer's comment** above the settings pair (`:18475`): "records what the box's settings resolve to, by
    display class" in place of "what the box's seven settings resolve to"; the unit lines are unchanged.
  - Delete Task 3's T9 from `box-settings-table.test.ts` (its literal is gone), and extend `BOX_SETTINGS_W2_HOLDERS`
    (Files).
- [ ] **Step 4: Regenerate the corpus**, in this same commit:
  `cd server && ccrc test -- env BOX_SETTINGS_FIXTURES=write ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-read.test.ts`,
  then run it again without the variable: green. `git diff --stat` shows only the nine `ok--<name>.json` (now
  version 2); the `ok--v1-*` files are unchanged. Run `ccrc-settings-verb`, `box-settings-read`, `box-settings-table`,
  `ccrc-cli`, `install-census`, `testbox-pins` and every suite in the Files list green.
- [ ] **Step 5: Growth.** Re-measure `ccd/ccrc` (about 70 lines for the verb and its helpers, minus the retired
  lines and the one retired usage line); raise D-7906's `maxDelta` and extend its split. Run growth armed.
- [ ] **Step 6: Mutants**, each measured red on a saved copy:
  - make `_set_row_json`'s refused shape emit `value` (`,"value":…` on a refused row; review L8, replacing the
    `val=""` deletion, which changed no output): V4 red (every row's `toEqual`, and the raw sample in the file), and
    `box-settings-read` reads the document `malformed`;
  - give presence rows a value: V3's `toEqual` red;
  - read a graph line with `read -r k d v from` and take `from` as the why (the retired 4th-field rule; review L1):
    V11's graph and test-runs cases red (`zz-secret` reaches the file);
  - drop the `*$'\037'*` test on a direct read: V11's keepalive case red;
  - skip `_set_fits` on wave 1's six value rows (review L12): V6's stub row red;
  - call `_graph_knobs` with no argument (environment-first): V2's environment case red;
  - write an out-of-envelope value whole instead of `unmeasured`: V6 red, and `box-settings-read` reads the
    regenerated document `malformed` if a corpus file carries one;
  - read the test-box host keys through `_tb_load`: V4's `GIT_KEY` row and V9 red;
  - pad keys to the longest key's width: V8's `CCRC_GRAPH_INCREMENTAL_MAX_FILES` row and `:436` red;
  - restore the bash `BOX_SETTINGS_KEYS` literal and walk it: V1 and the emitted-key-list row red;
  - V7's why-cut mutant (Step 1).
- [ ] **Step 7: Commit.** `feat(ccrc): ccrc settings writes version 2: 61 settings by class, and a refused one records no value (D11, D14, D20, D22; D-7909, D-7910)`,
  then `git fetch origin main` and `deviation-refs` (it defines D-7910; review E11).

### Task 6: the card groups by family, folds, and shows a server-role node's fleet settings as one line per family (D-7915, D-7916, D-7917)

Spec 5.5, D17, D21; 5.1's presence words and next-update marks; 5.3 on the console. This task changes only how the card
shows rows. It builds on Task 4's compile follow-through in `boxSettingsWords.ts` and the card test (the V1 fixture
types, the forged refused literal) and keeps Task 4's inverted line `:108`.

**Files:**
- Modify:
  - `pwa/src/fleet/boxSettingsWords.ts` (L1, pure): the reader learns `v: 2` beside `v: 1`; a refused row's value is
    never kept; a row is checked against its L0 class. Add `BOX_SETTING_FAMILY_TEXT`, `BOX_SETTING_PRESENCE_TEXT`,
    `BOX_SETTINGS_NOT_USED_TEXT`, `BOX_SETTINGS_TEXT.nextUpdate`, `familyGroups` and `familyLine`. `settingLine` takes
    the role from `BOX_SETTING_SPECS`. Delete `MODELS_BUDGET_KEY` and `BOX_SETTINGS_SERVER_BUDGET_TEXT` (`:55-57`).
    `BOX_SETTINGS_TEXT.how` (`:64`) gets the 5.5 note.
  - `pwa/src/fleet/BoxSettingsCard.tsx`: `Readout` (`:19`) renders one native `details` per family; a server-role
    node's unused families render as a plain `p`. `NodeBlock` (`:47`) and `BoxSettingsCard` (`:69`) are unchanged.
  - `pwa/src/fleet/fleet.css`: layout-only rules beside `fleet.css:4234-4251`: `.box-settings-family` and
    `.box-settings-family > .box-settings-rows`. No colour, and no rule reading `var(--fs-ui)` or `var(--fs-meta)`, so
    `APP_ROLE_RULES` (`pwa/test/role-census.test.ts:209`) and `pwa/design/audit.mjs:1122` stay unchanged.
  - `pwa/src/fleet/settingsText.ts:288`: `SETTINGS_CARDS.updates.boxSettings.purpose` becomes "Each node's settings as
    reported by the box, grouped by what uses them, with where each value came from."
- Not touched: `pwa/src/lib/api.ts` (0 lines), `pwa/src/screens/settings/UpdatesSection.tsx`. No new file, so the C7
  ring row needs no change.
- Test: `pwa/test/box-settings-card.test.tsx`; run unchanged `settings-updates`, `role-census`, `tap-targets`,
  `settings-screen`, `contrast`.
- Modify: `server/test/testbox-pins.test.ts`: `BOX_SETTINGS_W2_HOLDERS` gains `pwa/test/box-settings-card.test.tsx`
  (F5 and S3 name `CCRC_TESTBOX_POLL`), in Step 6's commit (Step 1's characterization pins name no test-box key).
  `boxSettingsWords.ts` names no setting at all (S2's source pin), so it is not a holder.

**Claims to take:** `pwa/src/fleet/boxSettingsWords.ts`, `pwa/src/fleet/BoxSettingsCard.tsx`, `pwa/src/fleet/fleet.css`,
`pwa/src/fleet/settingsText.ts`, `pwa/test/box-settings-card.test.tsx`, `server/test/testbox-pins.test.ts`.

**Exports:**
- `BOX_SETTING_FAMILY_TEXT: Readonly<Record<BoxSettingFamily | 'other', string>>` = `{ updates: 'Backups and updates',
  'session-slice': 'Session slice', 'test-runs': 'Test runs', graph: 'Graph', testbox: 'Test box', keepalive:
  'Keepalive', 'usage-sweep': 'Usage sweep', 'carry-copies': 'Carry copies', other: 'Other settings' }`.
- `BOX_SETTING_PRESENCE_TEXT: Readonly<Record<BoxSettingSource, string>>` = `{ file: 'set in ccrc.env', empty: 'set to
  empty, from ccrc.env; the default applies', default: 'not set', environment: 'set in the environment' }`.
- `BOX_SETTINGS_NOT_USED_TEXT = 'not used on this role'` (D-7917; replaces `BOX_SETTINGS_SERVER_BUDGET_TEXT` and
  `MODELS_BUDGET_KEY`).
- `BOX_SETTINGS_TEXT.how` = "A setting is changed in the box's ccrc.env, never here. The environment can override the
  file only for backups and updates, and the source says when it does; every other setting is read from ccrc.env
  alone." `BOX_SETTINGS_TEXT.refused = 'refused'` (Task 4's) and `BOX_SETTINGS_TEXT.nextUpdate = 'takes effect at the
  next update'`.
- `familyGroups(rows: readonly BoxSettingRow[], role: NodeRole | null): FamilyGroup[]`, with `FamilyGroup = { family:
  BoxSettingFamily | 'other'; rows: BoxSettingRow[]; refused: number; unmeasured: number; inFile: number; inEnv: number;
  used: boolean }`, in `BOX_SETTING_FAMILIES` order, then `'other'` only when an unknown key is present. A family is
  `used` unless `role === 'server'` and no key of it has `'server'` in `BOX_SETTING_SPECS[k].roles`; `role === null`
  counts as used.
- `familyLine(g: FamilyGroup): string` returns `` `${BOX_SETTING_FAMILY_TEXT[g.family]}: ` `` followed by its parts
  joined with `', '` (review F14): `${n} setting` or `${n} settings`; then, when not `used`, `not used on this role`
  followed by any attention counts (`k refused`, `m not measured`) (D-7916); when used, the attention counts if any,
  else the set counts (`x set in ccrc.env`, `y set in the environment`), else `none set`. So `'Graph: 23 settings, 1
  refused'`. For `'other'` the parts are `${n} setting this console does not know` (or `settings`):
  `Other settings: 1 setting this console does not know`.
- `BoxSettingLine` gains `mark: string | null`; `settingLine(row, role)` keeps its signature.

**Fixture.** In `box-settings-card.test.tsx`, add `v2Rows()`, derived from the L0 table, never hand-listed: for each
`[key, t]` of `Object.entries(BOX_SETTING_SPECS)` with `t.cls !== 'omit'`, in table order, `value` →
`{ key, state: 'ok', value: '1', from: 'default' }`, `origin` → `{ key, state: 'ok', value: 'default', from: 'default' }`,
`presence` → `{ key, state: 'ok', from: 'default' }`. Add `v2doc(over)` (`{ ...doc(), v: 2, settings: v2Rows(), ...over }`)
and `withRow(key, row)`. Keep `okRows()`/`doc()` (`:32-47`) as the version-1 fixture.

- [ ] **Step 1: Characterization pins, green on `main`**, in
  `describe('Box settings card: what the library calls a fold (characterization)')`:
  - **C1.** The bare markup `<details><summary>s</summary><p>p</p></details>`: `queryAllByRole('button')` length 0,
    `getAllByRole('group')` length 1. If a library upgrade maps `summary` to `button`, this pin reds first, and the
    no-control pin (`:235-239`) must be re-argued.
  - **C2.** The same markup: `getByText('p')` finds the text inside a closed `details`, and
    `container.querySelector('details')!.open` is `false`. New rows inside a fold are queried through the DOM, never
    the accessibility tree.
  - **C2b, measure, then pin the outcome** (review F8, E7). Render `<details><summary>s</summary><dl><dt>t</dt></dl></details>`
    (closed) and read `queryAllByRole('term').length`; this is a fact only the build can tell (jsdom 30.1.3 with
    `@testing-library/dom` 10.4.1). Pin what it measures, as an exact count, and record it in As built:
    - **if it is 1** (role queries see closed content): the pin is `toHaveLength(1)`, and the existing term count
      (`:65`, `within(b).getAllByRole('term')` → 7) stays as written;
    - **if it is 0** (they do not): the pin is `toHaveLength(0)` and `getAllByRole('term', { hidden: true })` has length
      1; then, in the code commit (Step 6, which lands Step 3's folds), `:65` becomes `within(b).getAllByRole('term', { hidden: true })` (still 7), and so
      does any other existing role query over rows (`:65` is the only one today). A family under test is not opened to
      make a count pass: `{ hidden: true }` is the one form.
    Either way, a library upgrade that flips the answer reds this pin before it reds `:65`.
  - **C3.** Rewrite the block-order test (`:84-88`) to select node blocks by
    `container.querySelectorAll('.box-settings-node')` instead of `getAllByRole('group')`; the expected output is
    unchanged (`['fleet reported by the box', 'server reported by the box']`). At Step 3 add one `getAllByRole('group')`
    assertion: for two fleet-role nodes with every family folded it holds `2 + 2 × 8`.
  - Run `cd pwa && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-card.test.tsx`: green.
  - Commit: `test(pwa): pin how a details and a summary read to the role queries before the Box settings card folds`.
- [ ] **Step 2: Write the failing tests**, in `describe('Box settings card: families (D17)')`,
  `describe('Box settings card: a server-role node (D21)')` and
  `describe('Box settings card: version 2 on the console (5.3, 5.4)')`:
  - **F1, families from the L0 table, in `BOX_SETTING_FAMILIES` order.** Input `fleet(ok(v2doc()))`: the texts of
    `block('fleet').querySelectorAll('.box-settings-family > summary')` equal `['Backups and updates: 7 settings, none set',
    'Session slice: 2 settings, none set', 'Test runs: 8 settings, none set', 'Graph: 23 settings, none set',
    'Test box: 16 settings, none set', 'Keepalive: 3 settings, none set', 'Usage sweep: 1 setting, none set',
    'Carry copies: 1 setting, none set']`, and the same list derived from `BOX_SETTING_FAMILIES` and the table's counts.
    Every `details` has `open === false`; `.box-settings-row` count is 61 (`v2Rows().length`).
  - **F2, a row sits in its table family.** For every `.box-settings-row`, its `dt` text `k` gives
    `row.closest('.box-settings-family')!.getAttribute('data-family') === BOX_SETTING_SPECS[k].family`; name
    `CCRC_TEST_HEAVY_SLOTS`, `CCRC_TEST_WIDE_FILES`, `CCRC_TEST_PRESSURE_MAX` (`test-runs`),
    `CCRC_MODELS_ADVANCE_BUDGET_S` (`updates`) and `CCRC_CARRY_COPY_WARN_BYTES` (`carry-copies`).
  - **F3, the fold line counts file and environment apart.** `updates` with `CCRC_BACKUP_KEEP` and `CCRC_VERSIONS_KEEP`
    `from: 'file'`, `CCRC_UPDATE_HEALTH_S` `from: 'environment'`, `CCRC_BACKUP_DATA_KEEP` `from: 'empty'` →
    `'Backups and updates: 7 settings, 2 set in ccrc.env, 1 set in the environment'`. Two Graph rows `from: 'file'` →
    `'Graph: 23 settings, 2 set in ccrc.env'`, still closed.
  - **F4, a refused row opens its family and shows no value.** `withRow('CCRC_GRAPH_BUDGET', { key, state: 'refused',
    from: 'file', why: W })`, `W = BOX_SETTING_REFUSAL_WORDS[0]`: the Graph `details` is open; its summary reads
    `'Graph: 23 settings, 1 refused'`; `getByText(W)` has class `box-settings-danger`; the row's `dd.box-settings-value`
    reads `'refused'` and `'from ccrc.env'`; every other family stays closed.
  - **F5, an unmeasured row opens its family.** `withRow('CCRC_TESTBOX_POLL', { key, state: 'unmeasured', why: W })`:
    the `testbox` `details` is open, its summary reads `'Test box: 16 settings, 1 not measured'`, the why has class
    `box-settings-danger`.
  - **F6, a refused row never shows a value, from either version.** A version-1 `okRows()` with
    `rows[0] = { key: 'CCRC_BACKUP_KEEP', state: 'refused', value: 'abc', from: 'environment', why: 'w' }`:
    `boxSettingsOf(...)` is not `'unrecognised'`, and `block('fleet').textContent` holds no `'abc'`. A version-1
    refused row with no `value` (what this wave's server sends): read, not `'unrecognised'`. Line `:108` stays as
    Task 4 inverted it; reword the comment on `:107` if it still says the raw knob is shown.
  - **F7, the presence words.** `CCRC_GRAPH_STORE` `from: 'file'` reads `'set in ccrc.env'`; `'empty'` reads
    `'set to empty, from ccrc.env; the default applies'`; `'default'` reads `'not set'`; `'environment'` reads
    `'set in the environment'`. A presence row carrying `value: '/x/secret-path'` on the wire: `container.textContent`
    holds no `'secret-path'`.
  - **F8, the next-update mark comes from the table.** The rows of `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_REFRESH_SECS` and
    `CCRC_SESSION_SLICE_MEMORY_MAX` contain `'takes effect at the next update'`; `CCRC_GRAPH_FETCH_SECS`'s does not; the
    count of rows containing it equals the number of `BOX_SETTING_SPECS` entries with `applies === 'update'` (six).
  - **S1, D21: one line per fleet-only family.** `server(ok(v2doc()))`: the seven wave-2 families render as
    `p.box-settings-line` lines `'Session slice: 2 settings, not used on this role'` … `'Carry copies: 1 setting, not
    used on this role'`; no `.box-settings-family` for them; none of their keys appears in `block('server')`. The
    `updates` family is still a `details`; its `CCRC_MODELS_ADVANCE_BUDGET_S` row reads `BOX_SETTINGS_NOT_USED_TEXT` and
    does not contain the row's value; its `CCRC_BACKUP_KEEP` row reads `'1'`. Replaces `:151-158`; the import at `:16`
    changes from `BOX_SETTINGS_SERVER_BUDGET_TEXT` to `BOX_SETTINGS_NOT_USED_TEXT`.
  - **S2, the role column decides; a key never does.** For each role in `['fleet', 'both', null]`, all 8 families render
    as `details` and no `'not used on this role'` appears. For every `k` with
    `!BOX_SETTING_SPECS[k].roles.includes('server')`, `k` is in a family of S1's lines or its row reads
    `BOX_SETTINGS_NOT_USED_TEXT`. Source pin: `readFileSync(new URL('../src/fleet/boxSettingsWords.ts', import.meta.url),
    'utf8')` matches no `/CCRC_[A-Z]/`.
  - **S3, D-7916: an unused family's line counts attention.** `server(ok(v2doc()))` with
    `withRow('CCRC_GRAPH_BUDGET', refused)` and `withRow('CCRC_TESTBOX_POLL', unmeasured)`: the Graph line reads
    `'Graph: 23 settings, not used on this role, 1 refused'` and the Test box line
    `'Test box: 16 settings, not used on this role, 1 not measured'`; still no rows and no `details` for either.
  - **N1, the note (5.5).** `getByText(/override the file only for backups and updates/)` and
    `getByText(/read from ccrc\.env alone/)`; replaces `/overrides the file/` at `:93`; keep
    `/changed in the box's ccrc\.env/` at `:92`.
  - **R1, the reader takes v1 and v2 and nothing else.** `boxSettingsOf({ state: 'ok', ageS: 1, stale: false, doc:
    v2doc() })` is not `'unrecognised'`; `v: 3` is; a v2 `ok` row of a `value`-class key with no `value` is; an `ok` row
    whose `value` is an object stays `'unrecognised'` (`:198-205`).
  - **R2, an unknown key (D-7915).** A v2 doc with an extra row `{ key: 'CCRC_ZZ_NEW', state: 'ok', value: '7', from:
    'file' }`: a trailing open `details` with `data-family="other"`, summary `'Other settings: 1 setting this console
    does not know'`; the row shows its source word; that row's text holds no `'7'`; the rest of the node renders.
  - **A1, the card holds no act, with summaries present.** `[fleet(ok(v2doc())), server(ok(v2doc())), server({ state:
    'malformed' })]`: `querySelectorAll('summary').length` at least 9; `querySelectorAll('button, input, select,
    textarea, a[href]')` length 0; `queryAllByRole('button')` length 0; the set of `tagName`s is a subset of
    `['DIV','H4','SPAN','P','DL','DT','DD','DETAILS','SUMMARY']` (naming `summary` as the one interactive element
    allowed); every `summary` is the first element child of a `details` with no element child but `SPAN`. Keep `:235-239`.
  - Run them: every new row red, for its stated reason. Record the red row names in As built.
- [ ] **Step 3: Implement.**
  - `boxSettingsWords.ts`:
    - `readDoc` (`:94`) accepts `v === 1 || v === 2` and keeps `v`;
    - `readRow` (`:70`): `ok` takes an optional string `value`, and an `ok` row of a known `value`/`origin` key with no
      string `value` returns `null`; `refused` reads `key`, `from` and `why` and never keeps `value`, whatever the
      version (Task 4's arm); `unmeasured` unchanged; a present non-string `value` returns `null`;
    - `familyGroups`, `familyLine` as above; a key outside `BOX_SETTING_SPECS` goes to `'other'`, with a comment that
      this wave's server never sends one (it refuses any key outside the 61) and that the group exists so a newer
      server's added setting never blanks an older console's node;
    - `settingLine(row, role)` (`:136`): a row whose `BOX_SETTING_SPECS[key].roles` lacks the role reads
      `BOX_SETTINGS_NOT_USED_TEXT`; a presence-class row's value is `BOX_SETTING_PRESENCE_TEXT[row.from]`, with no
      source word (replacing Task 4's source-word stand-in for a row with no `value`); `readRow` and `readDoc` widen
      from `BoxSettingRowV1` to `BoxSettingRow`; an unknown key's row shows only its source word; a refused row's value is
      `BOX_SETTINGS_TEXT.refused`; `mark` is `BOX_SETTINGS_TEXT.nextUpdate` when `applies === 'update'`, else `null`;
    - no `switch`; every word table is a total `Record` (the header at `:7-8`).
  - `BoxSettingsCard.tsx`, in `Readout`: for each `used` group,
    `<details className="settings-release-fold box-settings-family" data-family={g.family} open={g.refused + g.unmeasured > 0 || g.family === 'other'}>`
    holding `<summary><span>{familyLine(g)}</span></summary>` and the existing `<dl className="box-settings-rows">` of
    that group's rows (`dt`, `dd.box-settings-value` with a `<span className="settings-note">{line.mark}</span>` when
    present, `dd.box-settings-why`); for each group that is not `used`,
    `<p className="box-settings-line settings-note">{familyLine(g)}</p>`; the backups, disk and age lines stay where
    they are (`BoxSettingsCard.tsx:25`, `:41-42`).
  - `fleet.css`: `.box-settings-family { display: grid; gap: var(--sp-1); min-width: 0; }` and
    `.box-settings-family > .box-settings-rows { padding-inline-start: var(--sp-3); }`, with a comment naming D17 and
    pointing at `.settings-release-fold` for the summary's tap floor.
  - Run C3 (with its group count) and every Step 2 row green.
- [ ] **Step 4: Mutants**, each on a saved copy:

  | # | Mutation | Must red |
  |---|---|---|
  | M1 | `open={false}` on every family | F4, F5 |
  | M2 | family from the name (`key.split('_')[1]`) | F2 |
  | M3 | restore `role === 'server' && row.key === 'CCRC_MODELS_ADVANCE_BUDGET_S'`, drop the roles lookup | S1, S2 (source pin) |
  | M4 | render `row.value` for a presence row | F7 |
  | M5 | keep and render a refused row's `value` | F6 |
  | M6 | count `from: 'empty'` or `'environment'` as set in `ccrc.env` | F3 |
  | M7 | a `<button>` inside a `summary` | A1 |
  | M8 | drop `line.mark` | F8 |
  | M9 | render an unused family as a `details` with its rows | S1 |
  | M10 | `readDoc` accepts any `v` | R1 |
  | M11 | an unused family's line drops its attention counts | S3 |
  | M12 | an unknown key's row renders its `value` | R2 |
- [ ] **Step 5: Run green.** From `pwa/`: `box-settings-card`, `settings-updates`, `role-census`, `tap-targets`,
  `settings-screen`, `contrast`, then the whole suite
  (`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2`) and `ccrc test -- npm run build`. From `server/`:
  `rings/pwa-rings`, `rings/totality`, `docs-parity`, `private-names`. Record that `pwa/src/lib/api.ts` grew by 0.
- [ ] **Step 6: Commit.** `feat(pwa): the Box settings card groups by family, folds, and shows a server node's fleet settings as one line each (D17, D21; D-7915, D-7916, D-7917)`,
  with `BOX_SETTINGS_W2_HOLDERS` extended (Files) and `testbox-pins` green from `server/`, then `git fetch origin main`
  and `deviation-refs` (it defines D-7915 to D-7917; review E11).

### Task 7: doctor's box-settings check reads the class table (D-7918, D-7919)

Spec 5.6 and D18. Doctor runs in `ccrc`'s shell (`ccd/ccrc:4261-4265`), so `_check_box-settings` calls `_set_libs`,
`_set_spec`, `_set_check`, `_set_says` and `_set_fits` directly, with no copy, and restates no rule. Doctor's line is a
sink the envelope covers too (review L3).

**Files:**
- Modify: `ccd/ccrc-doctor-checks`: `_check_box-settings` (`:11164-11195`) and its header comment (`:11145-11163`); the
  carry-copies refusal sentence in `_check_carry-copies` (`:11229-11232`).
- Modify: `server/test/ccrc-doctorFixture.ts#installCcrc` (`:87`): add
  `symlinkSync(join(REPO, 'ccd', 'testbox-knobs'), join(ccd, 'testbox-knobs'))` beside `graph-resolve` (`:123`), with
  a comment naming D18 (`_set_libs` loads it).
- Test: `server/test/ccrc-doctor-codex.test.ts` (the `box-settings` describe, `:6582`: new rows; W24-S4 `:6632`, S6
  `:6646` and S13/S14 `:6751` rewritten); `server/test/ccrc-doctor-carry-copies.test.ts` (the bound row `:163-168` and
  Task 1's three carry pins); `server/test/single-definition/docs-l0.test.ts` (`:450-452` and its header `:441-442`);
  `server/test/census-w5/redactors.test.ts` (the REAL row `:124-128` and its header `:6-8`).
- Modify: `server/test/testbox-pins.test.ts`: `BOX_SETTINGS_W2_HOLDERS` gains `server/test/ccrc-doctor-codex.test.ts`
  (W2-D2 to D6, D9 and D11 name test-box keys). `ccrc-doctorFixture.ts` names the file `testbox-knobs`, not a key, and
  `ccrc-doctor-checks` is a holder already (TB11). Re-measure with `git grep -l` as Task 3 Step 4 does.
- `ccd/ccrc` is not edited by this task: doctor calls Task 3's `_set_spec`, `_set_check`, `_set_says` and `_set_fits`
  as they are. If Step 3 finds it must edit `ccd/ccrc` after all, take a claim on it first, raise D-7906 in the same
  commit, and say so in the wave-done.

**Claims to take:** `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor-codex.test.ts`,
`server/test/ccrc-doctor-carry-copies.test.ts`, `server/test/ccrc-doctorFixture.ts`,
`server/test/single-definition/docs-l0.test.ts`, `server/test/census-w5/redactors.test.ts`,
`server/test/testbox-pins.test.ts`.

**What the check prints** (D18). The loop stays `for k in "${CCRC_SETTINGS[@]}"` with `_ccrc_knob "$k" "" file`
(census C4); `local sweeps=" … "` (`:11166`) stays byte for byte (W29-S9); the server-role sweeps note is unchanged.
Every name is still read, and a reader refusal (`KNOB_WHY`, naming the file and line, never the value) still WARNs
exactly as today, omit keys included. What changes is how a name the file sets is printed:

| Class | `KNOB_FROM=file`, `_set_check` rc 0 | rc 1 | rc 2 | `KNOB_FROM=empty` | unset |
|---|---|---|---|---|---|
| `value` | `KEY=value` when `_set_fits "$k" value "$v"` passes, else `KEY (wider than this view records)` (review L3) | `KEY (refused: <_set_says>)` | `KEY cannot be measured: <SET_CHECK_WHY>` joins `why`, so the check WARNs | `KEY= (empty: the default)`, unchanged | in the unset list, unchanged |
| `origin` | `KEY=custom <origin>` when `_upd_url_origin` answers rc 0 and `_set_fits "$k" origin "custom <origin>"` passes; otherwise `KEY=custom` (D-7918; review L3) | n/a | n/a | unchanged | unchanged |
| `presence` | `KEY (set)` | `KEY (refused: <_set_says>)` | as `value` | unchanged | unchanged |
| `omit` | nothing | nothing | nothing | nothing | not in the unset list |

- A refused value keeps the line PASS and rc 0 (ruling): D18 changes only what prints.
- The release-base strip (`:11177-11180`) and the `pre` local are deleted (D-7918).
- The PASS and WARN lines still go through `_upd_redact` as one argument each; `log-line-redact-corpus.test.ts`'s
  argument-count scan (`:335-345`) stays green.
- `_check_graphify` still relays `GK_WARN` (Later).

- [ ] **Step 1: Write the failing rows** in the `box-settings` describe of `ccrc-doctor-codex.test.ts`. Reuse
  `settingsBox`/`roleBox`, `runBs` and `verdict`. Fixture HOMEs only. Take each expected word from bash, never a copy:
  run `. ccd/ccrc; _set_libs; _set_says <KEY>` in the same fixture HOME. Comments cite symbols, never `file:NNN`.
  - **W2-D1, a passing value prints its value.** `CCRC_GRAPH_BUDGET=4` and `CCRC_SESSION_SLICE_MEMORY_MAX=20G` on a
    `fleet` role box: PASS containing `CCRC_GRAPH_BUDGET=4` and `CCRC_SESSION_SLICE_MEMORY_MAX=20G`, rc 0.
  - **W2-D2, a refused value prints the words, never the value.** `it.each` over `CCRC_BACKUP_KEEP`,
    `CCRC_SESSION_SLICE_MEMORY_MAX`, `CCRC_TEST_SLICE_CPU_WEIGHT`, `CCRC_GRAPH_FETCH_SECS`, `CCRC_TESTBOX_QUEUE_LIMIT`,
    `CCRC_KEEPALIVE_FRESH`, `CCRC_USAGE_SWEEP_DAYS` and `CCRC_CARRY_COPY_WARN_BYTES`, each set to `zz-mark-<n>`: the
    line contains `<KEY> (refused: <words from bash>)`, stdout holds no `zz-mark`, and `<KEY>=` is absent.
  - **W2-D3, a presence setting prints as set.** `CCRC_TESTBOX_URL=https://tb.zz-mark.invalid:8443/zz-path`,
    `CCRC_GRAPH_STORE=/srv/zz-mark-store`, `CCRC_KEEPALIVE_PROMPT=zz-mark prompt`: `CCRC_TESTBOX_URL (set)`,
    `CCRC_GRAPH_STORE (set)`, `CCRC_KEEPALIVE_PROMPT (set)`; no `zz-` in stdout; rc 0.
  - **W2-D4, a refused presence setting.** `CCRC_TESTBOX_URL=zz-mark not a url`: `CCRC_TESTBOX_URL (refused: <its
    _tb_shape_says words>)`, no `zz-mark`.
  - **W2-D5, an omit setting is read but not printed.** `CCRC_TESTBOX_RUNS=4` and `CCRC_TESTBOX_LISTEN=zz-mark:1`:
    PASS; the line holds neither `CCRC_TESTBOX_RUNS` nor `zz-mark`. With nothing set (W24-S1's fixture), the unset list
    names none of the 28 omit keys, taken from `BOX_SETTING_SPECS` (never a typed list).
  - **W2-D6, an omit key's reader refusal still WARNs** (characterization: green on `main`, stays green; review E10).
    `export CCRC_TESTBOX_RUNS=4`:
    `^WARN box-settings: CCRC_TESTBOX_RUNS cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take`,
    rc 2, no `=4` in stdout.
  - **W2-D7, the release base shows its origin only** (D-7918; replaces W24-S4, S6, S13 and S14's expected text,
    keeping their ids, `hunter2` checks and own-mask runs): `https://u:hunter2@mirror.example/releases` →
    `CCRC_RELEASE_BASE_URL=custom https://mirror.example`; `u:hunter2@mirror.example/r` →
    `CCRC_RELEASE_BASE_URL=custom mirror.example`; `http:/u:hunter2@mirror.example/r` and
    `https:///u:hunter2@mirror.example/r` → `CCRC_RELEASE_BASE_URL=custom` (a `/` before the last `@`, rc 1);
    `runBsOwnMask` (with `_upd_redact` an identity) prints no `hunter2`. These were derived by reading
    `_upd_url_origin`: measure each once before pinning, and record any difference in As built.
  - **W2-D8, the verdict level of a refused value.** `CCRC_GRAPH_BUDGET=zz`: `^PASS box-settings: `, rc 0, holding
    `CCRC_GRAPH_BUDGET (refused: `.
  - **W2-D9, a check that cannot load is unmeasured, never refused.** A fixture tree whose `testbox-knobs` link is
    removed after `installCcrc`, `CCRC_TESTBOX_QUEUE_LIMIT=5`:
    `^WARN box-settings: CCRC_TESTBOX_QUEUE_LIMIT cannot be measured: <SET_TB_WHY's sentence>`, rc 2, no `(refused:` for
    that key, no `=5`.
  - **W2-D10, the no-leak sweep** (review L2, E2). One `ccrc.env`, on a `fleet` role box, sets every non-omit key
    EXCEPT the `origin` class (from `BOX_SETTINGS_SHOWN` and `BOX_SETTING_SPECS`) to `zz-leak-<i>`, and sets
    `CCRC_RELEASE_BASE_URL=https://mirror.example.invalid/zz-leak-path?zz-leak-q`. For the release base, the line holds
    `CCRC_RELEASE_BASE_URL=custom https://mirror.example.invalid` and nothing else of its value; for every other key,
    stdout and stderr hold no `zz-leak` (so, across the whole output, `zz-leak` appears nowhere). The origin class is
    left out of the bare-marker sweep because a scheme-less word is a host to `_upd_url_origin` and would print, by
    design.
  - **W2-D11, doctor holds the envelope** (review L3). `CCRC_RELEASE_BASE_URL=https://h:zz-abc/r` (`_upd_url_origin`
    prints `https://h:zz-abc`, outside the origin shape) → `CCRC_RELEASE_BASE_URL=custom`; and
    `CCRC_TESTBOX_SNAPSHOT_MAX=` `1` + 39 nines + `M` (its check passes it; 40 digits is wider than the value shape) →
    `CCRC_TESTBOX_SNAPSHOT_MAX (wider than this view records)`. Neither `zz-abc` nor the 39 nines appear in stdout or
    stderr; the line stays PASS, rc 0.
  - **Carry copies (D-7919)**, `ccrc-doctor-carry-copies.test.ts`: `CCRC_CARRY_COPY_WARN_BYTES=10G` (`:163-168`) now
    reads exactly
    `WARN carry-copies: CCRC_CARRY_COPY_WARN_BYTES must be <_carry_warn_bytes_says> — the value in ~/.ccrc/ccrc.env is not, so neither figure is judged`
    (the words read from bash), and the line holds no `10G`. Task 1's three rows (`0`, `0123`, 19 nines) are rewritten
    to the same line in this commit, each asserting its value is absent; their remedy row is unchanged. The `=0`
    sub-row's prefix `^WARN carry-copies: CCRC_CARRY_COPY_WARN_BYTES must be a whole number` still holds.
  - **Census pins.** `docs-l0.test.ts`: `inlineUserinfoStrips()` now `toEqual([])`, retitled
    `inlineUserinfoStrips() is empty: doctor's release-base row goes through _upd_url_origin (D-7918)`;
    `census-w5/redactors.test.ts`: the REAL row becomes `0, may only shrink`, `toEqual([])`; both headers updated; the
    FIXTURE rows unchanged.
- [ ] **Step 2: Run them and see them fail.** The new rows and the four rewritten W24 rows are red; the reader-refusal
  rows stay green (W24-S1, S2, S3, S5, S7 to S12, W29-D1 to D3).
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-doctor-codex.test.ts -t "box-settings"`
  and `test/ccrc-doctor-carry-copies.test.ts`.
- [ ] **Step 3: Implement.**
  - At the top of `_check_box-settings`, `_set_libs`. After a successful read with `KNOB_FROM=file`, `_set_spec "$k"`
    and branch on `$SET_CLASS` as the table says, calling `_set_check "$k" "$v"` and `_set_says "$k"`. Exclude `omit`
    keys from `set` and `unset`.
  - Delete the release-base strip and the `pre` local; the origin row is `custom` plus `_upd_url_origin "$v"` when it
    answers rc 0 and `_set_fits "$k" origin "custom $o"` passes, else `custom` alone. A `value` row prints `$k=$v`
    only when `_set_fits "$k" value "$v"` passes, else `$k (wider than this view records)` (review L3).
  - Rewrite the header comment in words, no line numbers: it reads the class table, never prints a refused or presence
    value, prints the release base as its origin, and its graph check still relays `GK_WARN`.
  - In `_check_carry-copies`, the sentence becomes `must be $(_carry_warn_bytes_says) — the value in ~/.ccrc/ccrc.env is not, so neither figure is judged`;
    `got '$thr'` goes.
  - Add the `testbox-knobs` link to `installCcrc`.
- [ ] **Step 4: Run green, then the mutants** on a saved copy of `ccd/ccrc-doctor-checks`:
  - **T7-M1:** print `$k=$v` whatever the verdict: W2-D2, W2-D4, W2-D10 red.
  - **T7-M2:** print `$k=$v` for `presence`: W2-D3, W2-D10 red.
  - **T7-M3a:** `continue` before `_ccrc_knob` for `omit`: W2-D6 red. **T7-M3b:** print omit keys like `value`: W2-D5 red.
  - **T7-M4:** the origin row prints `_upd_redact "$v"`: W2-D7 red, its own-mask run included.
  - **T7-M5:** treat rc 2 as rc 1: W2-D9 red.
  - **T7-M6:** restore `got '$thr'`: the carry rows red.
  - **T7-M7:** drop the `_set_fits` call (print `$k=$v` and `custom $o` whenever the check passes): W2-D11 red, both
    cases.

  Suites, from `server/`: `ccrc-doctor-codex`, `ccrc-doctor-carry-copies`, `ccrc-doctor-core`, `ccrc-doctor-testbox`,
  `ccrc-doctor-graphify`, `ccrc-doctor-test-slice`, `ccrc-settings-census`, `census-w5/redactors`,
  the `single-definition/` directory (whole, `docs-l0` among it) and `single-definition-pin`, `log-line-redact-corpus`,
  `testbox-pins`, `citations`.
- [ ] **Step 5: Commit.** `feat(doctor): box-settings prints by each setting's display class, never a refused or presence value (D18; D-7918, D-7919)`,
  with `BOX_SETTINGS_W2_HOLDERS` extended (Files), then `git fetch origin main` and `deviation-refs` (it defines
  D-7918 and D-7919).

### Task 8: README, mutation table, the waiver finalized, gates, As built and the PR (D-7906 finalized)

**Files:** `README.md`; `server/test/growth-waivers/D-7906-ccd-ccrc.json`; this plan's file
(`docs/superpowers/plans/2026-11-04-box-settings-view-w2.md`: As built and Deviations found).

**Claims to take:** `README.md`, `server/test/growth-waivers/D-7906-ccd-ccrc.json`,
`docs/superpowers/plans/2026-11-04-box-settings-view-w2.md`.

- [ ] **Step 1: The README.** Wave 1's four hunks are at `README.md:508`, `:1230`, `:1366-1383` and `:3769-3772`
  (`git diff 98ade6885^1 98ade6885 -- README.md`). Task 1 left the README unedited. Change:
  1. **The verb row (`:1230`)**: what each of the 61 settings a fleet or server node reads resolves to (the test box's
     own 28 are left out), shown by display class, with the backups and free disk; read-only.
  2. **"Seeing a box's settings" (`:1366-1383`)**, the first half rewritten for section 5: the 61 rows and the four
     classes with what each may show (5.1); a refused row records its source and its check's words, never the value,
     wave 1's seven included (D14, D22); every wave-2 setting is read from `ccrc.env` alone, and only backups and
     updates keep the environment-first read (5.7, D20); the session slice and the four unit-rendered graph settings
     take effect at the next `ccrc update`, so the card shows the configured value (5.7); a value that passes its
     check but is wider than the view records reads as not measured (D-7909); the record is version 2, the server also
     reads version 1, checks its values and origin against the same envelope (one outside it reads as not measured),
     drops a refused version-1 row's value and why, and bounds its not-measured sentences at 240 (D-7911); a console tab
     open on an older build shows
     a version-2 node, or a version-1 node with a refused row, as a form it does not read until it reloads (5.4, D15,
     D-7912); the card groups rows by family, folds a family whose rows are all `ok`, and keeps one with a refused or
     unmeasured row open (5.5, D17); a server-role node shows one line per fleet family, "not used on this role", with
     its refused and not-measured counts (D21, D-7916). Keep the 480-byte sentence; add that a `why` is cut at 240.
  3. **The doctor sentences** at `:1330-1331` and `:1382-1383` gain D18: doctor prints a value only when its check
     passes and it fits the view's envelope, otherwise `KEY (refused: <words>)` or `KEY (wider than this view
     records)`; a `presence` setting prints as set; the test box's own settings are read and not printed; the release
     base prints as its origin; the carry-copies warning no longer quotes the value.
  4. **The node-file sentence (`:3772`)**: after "redacted and ASCII by its writer", add "; the server's parse checks
     each value and origin against its setting's display class and each refused row's words against the closed set,
     and bounds a not-measured sentence (printable ASCII, at most 240 bytes) without checking its words" (review L9:
     never "checked against a closed set" for an unmeasured why).

  Leave `:508`, the carry-copies paragraph (`:6602-6607`) and the doctor table (`:629`). The `**ccrc's own settings.**`
  paragraph (`:1307`) still names every `CCRC_SETTINGS` member (census C2); this wave adds no setting. Write no
  `file:NNN` citation. Run `docs-parity`, `citations`, `readme-holds`, `ccrc-settings-census`.

  Commit: `docs(readme): box settings wave 2: 61 settings by display class, snapshot v2, doctor by class`.
- [ ] **Step 2: The mutation table.** Every task's mutants were measured in their task; here, re-run the cross-cutting
  set on a scratch copy each (sha recorded, restored, `cmp`), and record what killed each. A mutant no row kills is a
  missing row: add it, red first, before the PR.
  - **W2-M1 (D12, Task 3):** move one `value` key to `presence` in the bash table only → T2/T3.
  - **W2-M2 (D22, Tasks 3 and 4):** add a word to bash only → W1; let `parseBoxSettings` accept a `why` outside the set
    → `a refused why outside the closed set`.
  - **W2-M3 (D14, Task 5):** the verb writes `value` on a refused row → V4; the server reads that document `malformed`.
  - **W2-M4 (5.4, Task 4):** the parse accepts a value on a `presence` row → M1's rows.
  - **W2-M5 (5.4, Task 4):** the server keeps a refused version-1 row's value → Step 2's rows.
  - **W2-M6 (5.2, Task 5):** the verb reads the test-box host keys through `_tb_load` → V4's `GIT_KEY` row, V9.
  - **W2-M7 (D13, Task 1):** change `_tshape`'s CPU weight bound → its Task 1 pin.
  - **W2-M8 (D13, Task 2):** change a library check in `ccrc` without regenerating `ccd/lib/ccrc-settings.sh` →
    `ccrc-settings-lib` (byte-equal).
  - **W2-M9 (5.4 size, Task 5):** skip the 240 why cut → V7.
  - **W2-M10 (D-7909, Tasks 3 and 5):** `_set_fits` always passes → V6 and the E-rows.
  - **W2-M11 (5.5, Task 6):** a family with a refused row folds → F4; a `button` in place of `summary` → A1.
  - **W2-M12 (D21, Task 6):** a server-role node renders the 54 fleet rows → S1.
  - **W2-M13 (Task 1, F1):** drop the http(s) test on the redacted scheme → the `user:pw@ftp://h` rows.
  - **W2-M14 (C3, Task 3):** `_set_check` folds rc 2 into 1 → the hidden-library C-row and doctor's W2-D9.
  - **W2-M15 (review L1, Task 5):** `_set_lines` takes the 4th field as a why → V11.
  - **W2-M16 (review L4, Task 4):** `rowOfV1` forwards an `ok` value outside the envelope → the version-1 unfit rows.
  - **W2-M17 (review L3, Task 7):** doctor skips `_set_fits` → W2-D11.
  - **W2-M18 (review F5, Tasks 3 and 4):** `_set_fits` admits any lowercase word on a `testbox` key → E2 and Task 4's
    differential row.
- [ ] **Step 3: Finalize the waiver (D-7906).** After the last commit that touches `ccd/ccrc`, run the check armed;
  set `maxDelta` to the final measured delta, and `reason` to wave 2's additions with the delta's split by task
  (Tasks 1-2, 3, 5, any fix round), each measured at its task's commit with the same counter (`netGrowth`, against the
  merge-base). Re-run armed until green. `server/src/watch.ts` and `pwa/src/lib/api.ts` must show no growth; if either
  needs a waiver, it takes the next spare number and the wave-done says so.

  Commit: `test(growth): ccd/ccrc's measured wave-2 growth, finalized (D-7906)`.
- [ ] **Step 4: Gates.** Every command from its package, one file at a time, in the foreground, through
  `ccrc test --` with `--maxWorkers=2`.
  - **server/** (`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>`):
    - the verb and the moves: `ccrc-settings-verb`, `ccrc-settings-carveouts`, `ccrc-settings-census`,
      `ccrc-settings-lib`, `box-settings-table`, `ccrc-cli`, `install-census`, `graph-knobs`, `testbox-knobs`,
      `ccrc-test-wrapper`, `testbox-wrapper`, `telemetry-keepalive`, `keepalive-freshness-parity`, `usage-sweep-runner`,
      `usage-sweep-deploy-ship`, `slice-limits-config`, `timer-first-run`, `ccrc-install-tree`, `macos-platform`,
      `graph-repo-sweep`;
    - wave 1's acts, unchanged: `ccrc-update-flip-backups`, `ccrc-update-fetch`, `ccrc-update-phases`,
      `ccrc-models-advance`, `ccrc-update-kept`, `ccrc-versions-warn-arms`, `update-watchdog-revert`;
    - install: `ccrc-install-units`, `ccrc-install-role`, `ccrc-uninstall`;
    - doctor: `ccrc-doctor-codex`, `ccrc-doctor-carry-copies`, `ccrc-doctor-core`, `ccrc-doctor-testbox`,
      `ccrc-doctor-graphify`, `ccrc-doctor-test-slice`;
    - the server read: `box-settings-read`, `update-inventory`, `update-routes`, `update-projection`, `token-shared`,
      `lane-schedule`;
    - censuses: `census-w5/redactors`, `log-line-redact-corpus`, `ccd-update-sync`, `testbox-pins`, every file in the
      `single-definition/` directory (run as `test/single-definition/`; `docs-l0`, `advance-switches`, `update-stall`
      and `vocabularies` among them), `single-definition-pin`;
    - rings: `rings/outward-edges`, `rings/totality`, `rings/wire-totality`, `rings/shared-imports`, `rings/pwa-rings`,
      `rings/pwa-one-owner`;
    - docs and hygiene: `docs-parity`, `citations`, `readme-holds`, `topology-clean`, `private-names`, `dtbd`,
      `typecheck-tests`;
    - growth, armed: `ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`;
    - both type checks: `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .` and
      `ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json` (needs `agent/`'s dependencies
      installed in the worktree);
    - `deviation-refs`, last, after a local commit: `git fetch origin main`, then
      `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/deviation-refs.test.ts`.
  - **agent/:** `test/whitelist.test.ts`, then the whole suite.
  - **pwa/:** `box-settings-card`, `settings-updates`, `role-census` by name; the whole suite;
    `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`; `ccrc test -- npm run build`; the browser suite once
    (`ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2`): the folded
    families change the card's height, and a PR's fast run may skip the browser leg.
- [ ] **Step 5: As built and Deviations found**, filled at the end of this file. Record: each deviation's use, defined
  once (unused ones "Spare, unused."); D-7906's final `maxDelta` and split; the mutation table with each mutant's killing
  rows by name; every interface as built (any rename against this plan); each moved check's suites, run unchanged and
  green; the measured growth of every growth-checked file the PR touches; V7's measured largest document; the W2-D7 and
  V6 origin outputs as measured; C2b's jsdom finding and which arm of it `:65` took; V4's `REFUSED_SAMPLE` overrides;
  the commit that created D-7906's waiver and its delta; whether `wire-totality`'s `EXEMPT_PINNED` moved; review
  1403's F1, F3 and F4 closed by Task 1; D19, D21 and D22's states; and the `## Later` list below, unchanged or with
  any item the build added.

  Commit: `docs(plan): box settings wave 2, as built and deviations found`.
- [ ] **Step 6: The PR**, from the workspace branch, never a feature branch.
  - **First commit:** this plan, byte for byte (Sequencing).
  - **Title:** `Box settings wave 2: every setting a node reads, by display class`.
  - **Body:** names #2193 (wave 1) and #2245 (spec revision 5); links the spec and this plan by GitHub blob URL on
    `main` (plus the PR's `/files` view while the plan is unmerged); lists D11 to D22 and the D-7906 to D-7925 numbers
    used; names no host, home path, lane, account or session. **Rollout note:** "Roll out `--server-first`:
    `ccrc rollout --to vX.Y.Z --server-first`. This wave widens the reader: a wave-1 server reads a version-2 snapshot
    as `malformed`. A console tab still open on the older build shows version-2 nodes, and version-1 nodes holding a
    refused setting, as a form it does not read until it reloads (spec 5.4, D15, D-7912)." The worker runs no rollout.
    **Later:** the body copies this plan's `## Later` list as built (review E12).
  - Scan the title, the body and every changed file for private names before posting: `private-names` green, zero hits.
  - **CI:** wait for the PR's fast run on the exact tip and read its `select tests` summary; then start a full-mode run,
    `gh workflow run ci.yml --ref <branch> -f mode=full`, and read its `test (server)`. A doctor, settings or census
    file the summary does not list is cleared only by that full run. The macOS legs are advisory, but a red
    `ccrc-settings-verb`, `ccrc-doctor-codex` or `ccrc-doctor-carry-copies` there is this PR's own (bash constructs in
    moved code): fix it, never dismiss it as a flake.
  - **Wave-done:** list mail before every push and before the wave-done; send it only after the fast run on the final
    tip is green and the full run has passed; then push nothing more.
- [ ] **Step 7: The programme's Next-wave brief** (`docs/superpowers/programs/box-settings-view.md:184-207`, the
  coordinator's file; the worker does not edit it). Check each point closed at the tip, and name each in the PR body:

  | Point | Closed by |
  |---|---|
  | One display class per name | Task 3 (5.1, D12) |
  | Refused values record only verdict and source | Tasks 4 and 5 (D14, D22); doctor in Task 7 |
  | Validated values only, by calling each owner's check | Tasks 2 and 3 (`_set_check`). The brief's `_gr_knobs` and `_tb_load` are superseded by spec 5.2: literal reads with `_gr_fits` and `_tb_shape`, never `_tb_load`, `TBK_WARN` or `GK_WARN` |
  | File mode | Task 5 (5.7, D20) |
  | Test box: host table on the card, box table omitted | Task 3 (28 `omit`) and Task 6 |
  | The test-box URL is `presence` | Task 3 (D19) |
  | Settings applied at install | the `applies` column and the next-update words (Tasks 3, 5, 6; 5.7) |
  | Doctor shares the table | Task 7 |
  | Review 1403's F1, F3 and F4 | Task 1 |
  | `--server-first` | Task 8's PR body |
  | The programme closes when both boxes' snapshots show on the card | the coordinator, after the rollout; not this PR |

## Later

Deferred by the spec (revision 5, "Where things stand") or by the rulings and the plan review; none is built in this
wave. Task 8 records this list in As built and copies it into the PR body (review E12).
- `_tshape`'s `[0-9]`/`[1-9]` ranges: enumerating them changes behaviour under a locale, so they move verbatim
  (ruling; Task 2 Step 1).
- Closing an `unmeasured` row's `why` as line-number templates, so the server can check it rather than only bound it
  (D-7913; review L9).
- Doctor's graph check relays `GK_WARN`, which quotes a refused value (spec 5.6).
- Whether a private release mirror should show its host (D19).
- Reading the installed slice and graph-unit values rather than the configured ones (spec 5.7).
- The test box's own 28 settings, shown from the test box itself, if it ever reports to the console.
- From the spec's earlier list, still deferred: editing a setting from the console; a macOS snapshot; a push when a
  setting turns `refused`; a `reason` token vocabulary held set-equal to the bash literals; doctor reading the timer's
  cadence from its unit file (ARCH-69).

## Deviations found

The worker writes each entry as built, in the task that builds it. These numbers are issued to this programme
(D-7906 to D-7925); none may be redefined, and an unused one reads "Spare, unused." A departure found while executing
takes the next spare and is named in the wave-done.

- **D-7906.** The wave's one growth waiver for `ccd/ccrc` (`server/test/growth-waivers/D-7906-ccd-ccrc.json`), created by Task 2's
  Step 4 commit, the first to measure `ccd/ccrc` over 40 net code lines (+42), and raised by each later commit that grows the file.

- **D-7907.** `CCRC_RELEASE_BASE_URL` gains no refusal words: it is never refused (an unparseable base reads `custom` alone).
- **D-7908.** Wave 1's act sentences (`_keep_why`, `_upd_health_s`, `cmd_settings`' deadline sentence) are built from the value-free
  words functions `_keep_says`, `_upd_health_says` and `_upd_deadline_says`, byte-identical to `main`.
- **D-7909.** The value and origin envelope is spelled once in L0 (`BOX_SETTING_VALUE_SHAPE`, `BOX_SETTING_ORIGIN_SHAPE`, `BOX_SETTINGS_TEXT_MAX`) with
  a byte-equal bash mirror held equal by a test; an `ok` value or origin outside it (wave 1's seven included) is written as `unmeasured`
  with a fixed why naming the limit, and doctor prints it as wider than the view records (widens the 480-byte rule; C4; review L3, L12).
  Task 3 builds the literals and `_set_fits`; Tasks 5 and 7 use them.
- **D-7914.** A setting's fixed value words live in their own L0 constant, `BOX_SETTING_VALUE_WORDS`, with a bash mirror in `ccd/ccrc`, held equal
  both ways to each other and to `_tb_shape`'s word arms, not as a table column; the writer's `_set_fits` and the server admit exactly a key's
  own words (moved from Task 4; review F5).
- **D-7910.** The class table replaces wave 1's seven-name literal `BOX_SETTINGS_KEYS`, superseding D-7861's ordered literal: `cmd_settings` walks `CCRC_SETTINGS`, reads the class of each key from `BOX_SETTINGS_TABLE` and skips `omit`, so the seven are the table's first seven rows and the verb names no key list of its own. Retired in the commit that switches the verb to version 2 (61 rows, a refused one with no value), which also rewrites the usage text, the header comment and the installer's comment that said "seven" (review F2, E1, F9, E5).
- **D-7911.** The server rewrites three kinds of version-1 row and forwards none as the box wrote it: a refused row loses its value and its `why`
  (the fixed `BOX_SETTINGS_V1_REFUSED_WHY`); an `ok` row whose value or origin is outside the envelope becomes `unmeasured` (the fixed
  `BOX_SETTINGS_V1_UNFIT_WHY`); an `unmeasured` `why` over 240 is cut to 237 bytes and `...` (C13; the only way 5.4's "residual retires" holds;
  widened by review L4). The frozen version-1 snapshot changes for exactly the refused and long-sentence documents, in the same commit.
- **D-7912.** A console tab on wave 1's build reads a version-1 node holding a refused row as unrecognised, as well as every version-2 node;
  accepted, the same reload cures it, and the rollout note says so.
- **D-7913.** An `unmeasured` row's `why` is bounded (printable ASCII, at most 240 bytes), not a closed set: the reader's sentences name the file, a
  line number and the key, never a value. The server reads version 2 beside version 1, each row checked against its display class and an `ok`
  value or origin against the shared envelope; a row outside its class is a forgery and is never rewritten. Closing the unmeasured sentences as
  line-number templates is Later.
- **D-7915.** A row whose key is not in the L0 table shows in a trailing "Other settings" group with its source word and never a value
  (defensive; this wave's server never sends one; C19).
- **D-7916.** On a server-role node, a fleet-only family's line counts its refused and unmeasured rows ("Graph: 23 settings, not used on
  this role, 1 refused"), with no rows (C12; keeps 5.5 true).
- **D-7917.** Wave 1's "not used on a server box" becomes "not used on this role", one wording derived from the role column.
- **D-7918.** Doctor's release-base row goes through `_upd_url_origin` (class `origin`): `KEY=custom <origin>` when it answers rc 0 and `_set_fits` passes, else `KEY=custom`. Doctor's inline userinfo strip retires, so both census pins become `[]`, and doctor no longer prints the base's path. Measured: with `_upd_redact` made an identity, the origin answers rc 1 for a userinfo base, so that run prints `custom` alone.
- **D-7919.** Doctor's carry-copies WARN uses its words function and drops `got '<value>'`; Task 1's carry pins are rewritten in the same commit (C7).
- **D-7920.** The plan's six one-line `( BOX_ENV_FILE="$BOX_ENV_FILE/." KEY="$v" _resolver … )` forms tripped census C8(c), which allows no setting
  name beside BOX_ENV_FILE outside `_ccrc_knob`; the mask moved to its own line as the first statement of one subshell holding all six resolver
  calls, with the same behaviour; ruled by the coordinator (option A). Each of the six resolvers reads only its own setting, measured.
- **D-7921.** The D12 class `presence` is spelled `is-set` in code, because C7o (OA-C18 (a), #1371) reserves `presence` in TS for session presence. The census-w7 `persistedPresenceWords` red began at Task 3's `2606db945` (32 against 20), not only at the 33 the sweep last read.
- **D-7922.** `c6d9c83a4` rewrote an existing consumer assertion, `slice-limits-config.test.ts`'s row "the defaults it reads with are the template's own values", from `toEqual(['24G'])` and `toEqual(['6G'])` to set equality over every literal `_ccrc_knob CCRC_SESSION_SLICE_*` read plus a non-empty check, with a CONTROL row beside it. That departs from the plan's global constraint that no existing consumer assertion is edited (the one exception was D-7919's carry sentence), so it is ledgered here (review 1487 F3). Measured red-first: see As built, "Task 5, the slice defaults row".
- **D-7923.** By operator item 41 (answering review 1487), a release base whose RAW text does not begin with `http://` or `https://`, any case, shows `custom` alone in the verb (JSON, snapshot and human form) and in doctor's `box-settings` line, and never reaches `_upd_url_origin`; the envelope's `custom <host>` arm now requires an http or https scheme, in `BOX_SETTING_ORIGIN_SHAPE` in bash and L0 (part B, built), so a scheme-less word is outside the envelope: a version-2 row of it is malformed and a version-1 `ok` row of it is rewritten `unmeasured` (`BOX_SETTINGS_V1_UNFIT_WHY`). This supersedes D-6914 and D-7873's scheme-less sentence (`user:secret@mirror.example.invalid/r` read `mirror.example.invalid`) for the settings view. `_upd_url_origin` is unchanged, so its own direct rows stand. Existing assertions changed to the new truth: `ccrc-settings-verb.test.ts`, the `it.each` rows `user:secret@mirror.example.invalid/r?token=x` (was `custom mirror.example.invalid`) and `tok@mirror.example.invalid:8080/r` (was `custom mirror.example.invalid:8080`) of the release-base describe; `ccrc-doctor-codex.test.ts`, the rows `W24-S6` (was `custom mirror.example`) and `W2-D7` (its scheme-less case `u:hunter2@mirror.example/r`, was `custom mirror.example`). New rows: the verb describe `a release base with no http(s) scheme shows custom alone` (three plants and a scheme-ful control) and doctor's `W2-D7923` rows (the same three plants). Part B rows changed: `boxSettingsEnvelope.ts`'s `ORIGIN_SHAPE_FITS` no longer holds `custom mirror.example.invalid` (it moves to `ORIGIN_SHAPE_MISSES`, with `custom mirror.example` and `custom zz-leak`, so E1 and E2 in `box-settings-table.test.ts` read them as not fitting, in bash and in JS); `box-settings-read.test.ts`'s `it.each` row `the release base at custom mirror.example.invalid parses` is removed, and rows are added for a version-1 `ok` row and a version-2 row of `custom zz-leak` and of a bare host. The README sentence on what an update installs from its shell came from review 1487 F2. Part B mutant: restoring the optional scheme in L0 and in bash reds the server and table rows (named in As built). Part A mutants: removing the verb's caller gate reds the three verb plants and the two changed verb rows; removing doctor's gate reds the three doctor plants, `W24-S6` and `W2-D7`.

| Number | Task | What it records |
|---|---|---|
| D-7906 | 2 (created by the first commit past the armed limit, Step 4 by this plan's figures), raised by Tasks 3 and 5 (Task 7 did not touch `ccd/ccrc`), finalized in 8 | The wave's one growth waiver for `ccd/ccrc` (`server/test/growth-waivers/D-7906-ccd-ccrc.json`); `maxDelta` is the final measured delta, with its split by task; every commit's armed gate green |
| D-7907 | 2 | `CCRC_RELEASE_BASE_URL` gains no refusal words: it is never refused (an unparseable base reads `custom` alone), a departure from 5.2's "wave 1's seven each gain fixed refusal words" |
| D-7908 | 2 | Wave 1's act sentences (`_keep_why`, `_upd_health_s`) are now built from the new words functions, byte-identical to `main`, pinned by Task 1's K1, K2 and H1 |
| D-7909 | 3, used by 5 and 7 | The value and origin envelope, spelled once in L0 with a bash mirror held equal by a test; an `ok` value or origin outside it (wave 1's seven included) is written as `unmeasured` with a fixed why naming the limit, and doctor prints it as wider than the view records (widens the 480-byte rule; C4; review L3, L12) |
| D-7910 | 5 | The class table replaces wave 1's seven-name literal `BOX_SETTINGS_KEYS` (`ccd/ccrc:26115`), superseding D-7861's ordered literal; retired in the switch commit, held equal to the table's first seven by T9 until then (review F2, E1) |
| D-7911 | 4 | The server rewrites three kinds of version-1 row and forwards none as the box wrote it: a refused row loses its value and its `why` (the fixed `BOX_SETTINGS_V1_REFUSED_WHY`); an `ok` row whose value or origin is outside the envelope becomes `unmeasured` (the fixed `BOX_SETTINGS_V1_UNFIT_WHY`); an `unmeasured` `why` over 240 is cut to 237 bytes and `...` (C13; the only way 5.4's "residual retires" holds; widened by review L4) |
| D-7912 | 4 | A console tab on wave 1's build reads a version-1 node holding a refused row as unrecognised, as well as every version-2 node; accepted, the same reload cures it, and the rollout note says so |
| D-7913 | 4 | An `unmeasured` row's `why` is bounded (printable ASCII, at most 240 bytes), not a closed set: the reader's sentences name the file, a line number and the key, never a value (measured: the `KNOB_WHY` and `BUE_WHY` assignments at `ccd/ccrc:21772`, `:21782`, `:3661-3667`, `:3714-3721`). Closing them as line-number templates is Later |
| D-7914 | 3 | A setting's fixed value words live in their own L0 constant, `BOX_SETTING_VALUE_WORDS`, with a bash mirror in `ccd/ccrc`, held equal both ways to each other and to `_tb_shape`'s word arms (`ccd/testbox-knobs:122-123`), not as a table column; the writer's `_set_fits` and the server admit exactly a key's own words (moved from Task 4; review F5) |
| D-7915 | 6 | A row whose key is not in the L0 table shows in a trailing "Other settings" group with its source word and never a value (defensive; this wave's server never sends one; C19) |
| D-7916 | 6 | On a server-role node, a fleet-only family's line counts its refused and unmeasured rows ("Graph: 23 settings, not used on this role, 1 refused"), with no rows (C12; keeps 5.5 true) |
| D-7917 | 6 | Wave 1's "not used on a server box" becomes "not used on this role", one wording derived from the role column |
| D-7918 | 7 | Doctor's release-base row goes through `_upd_url_origin` (class `origin`); doctor's inline userinfo strip retires, so both census pins become `[]`, and doctor no longer prints the base's path |
| D-7919 | 7 | Doctor's carry-copies WARN uses its words function and drops `got '<value>'`; Task 1's carry pins are rewritten in the same commit (C7) |
| D-7920 | 3 | `_set_check`'s `updates` arm masks `ccrc.env` once, as the first statement of one subshell holding all six resolver calls, not six one-line `( BOX_ENV_FILE="$BOX_ENV_FILE/." KEY="$v" _resolver )` forms, which census C8(c) refuses; same behaviour (coordinator ruling, option A) |
| D-7921 | gate sweep | The D12 class `presence` is spelled `is-set` in code, because C7o (OA-C18 (a), #1371) reserves `presence` in TS for session presence |
| D-7922 | gate sweep (`c6d9c83a4`) | The slice-limits row "the defaults it reads with are the template's own values" is rewritten from `toEqual(['24G'])`/`toEqual(['6G'])` to set equality over every literal read plus a non-empty check, with a CONTROL row; a departure from the global constraint that no existing consumer assertion is edited |
| D-7923 | operator item 41 (fix round 1) | A scheme-less release base shows `custom` alone in the verb and doctor (part A); the envelope's shape follows (part B). Supersedes D-6914/D-7873's scheme-less sentence for the settings view. | built (part A); mutants measured |
| D-7924 | | Spare, unused. |
| D-7925 | | Spare, unused. |

## As built

Built on the branch `ws/box-settings-w2`, Tasks 1 to 8, nothing pushed before the PR. Every figure below was measured in
the task that built it, or re-measured in Task 8. Commit SHAs are those after the local autosquash that folded the
`log-line-redact-corpus` pin into Task 5's commit (see the rulings).

| Task | Commits |
|---|---|
| 1 | `9f1c23c5d`, `8524c5e1f`, `6b0bb16e5` (on the plan's own commit `8a92ba2cc`) |
| 2 | `d544daf31`, `1ea5a2ca8`, `37f62e39f`, `2d748ba78`, `0f5cb00e8`, `ff61b617e` |
| 3 | `2606db945` |
| 4 | `042a8df1d`, `f851e519e`, `0cfc0c209` |
| 5 | `8e19e43e9` |
| 6 | `bf75dc730`, `d7d5aa331`, `048c9dd0c` |
| 7 | `e0a2e2b98` |
| 8 | the README commit, the waiver commit and this one |

### Deviations: each one's use

D-7906 to D-7923 are defined once, in the bullets of "Deviations found" above; the table there carries each one's task.

| Number | Built in | Used by | State |
|---|---|---|---|
| D-7906 | Task 2 (`2d748ba78`, +42, the first commit past 40), raised in Tasks 3 and 5, finalized in Task 8 | the one waiver of `ccd/ccrc`, `maxDelta` 345 | final |
| D-7907 | Task 2 (`ff61b617e`) | `CCRC_RELEASE_BASE_URL` is never refused, so it has no refusal words; an unparseable base reads `custom` alone | built |
| D-7908 | Task 2 (`ff61b617e`) | `_keep_says`, `_upd_health_says`, `_upd_deadline_says` (and `_models_budget_says`) build wave 1's act sentences, byte-identical to `main`, pinned by Task 1's K1, K2 and H1 | built |
| D-7909 | Task 3 (`2606db945`) | the envelope in L0 and its bash mirror; `_set_fits` in the verb (Task 5) and doctor (Task 7) | built |
| D-7910 | Task 5 (`8e19e43e9`) | the class table replaces `BOX_SETTINGS_KEYS`; T9 (the equality of the literal to the table's first seven) was deleted with the literal in the same commit | built |
| D-7911 | Task 4 (`f851e519e`) | the version-1 rewrite: refused loses value and why, an unfit `ok` becomes `unmeasured`, a long why is cut to 237 plus `...` | built |
| D-7912 | Task 4 (`f851e519e`) | accepted: a console tab on wave 1's build reads a v2 node, or a v1 node with a refused row, as unrecognised until it reloads; the PR's rollout note says so | built |
| D-7913 | Task 4 (`0cfc0c209`) | version 2 read beside version 1; an `unmeasured` why bounded (printable ASCII, 240), not a closed set | built |
| D-7914 | Task 3 (`2606db945`) | `BOX_SETTING_VALUE_WORDS` in L0 with its bash mirror, held equal both ways to each other and to `_tb_shape`'s word arms (T10, E2) | built |
| D-7915 | Task 6 (`d7d5aa331`) | an unknown key's row shows in a trailing "Other settings" group, source word only (R2) | built |
| D-7916 | Task 6 (`d7d5aa331`, `048c9dd0c`) | a server node's fleet-only family is one line with refused and not-measured counts (S1, S3, S4) | built |
| D-7917 | Task 6 (`d7d5aa331`) | "not used on this role", one wording from the role column | built |
| D-7918 | Task 7 (`e0a2e2b98`) | doctor's release-base row goes through `_upd_url_origin` and `_set_fits` | built |
| D-7919 | Task 7 (`e0a2e2b98`) | the carry-copies WARN built from its words function; Task 1's carry pins rewritten in the same commit | built |
| D-7920 | Task 3 (`2606db945`, fix round 1) | `_set_check`'s `updates` arm, one masked subshell; C8(c) unedited | built |
| D-7921 | gate sweep (the rename commit) | the class token `is-set` in the bash table, L0, the server parse, the card and the tests; the spec's name `presence` stays in prose | built |
| D-7922 | gate sweep (the slice defaults commit) | the slice-limits default row as set equality over every literal read, plus a CONTROL row | built; both mutants measured below |
| D-7923 | operator item 41 | the verb's and doctor's scheme-less release base shown as `custom` alone (see Deviations found) | built; both mutants measured (part B, the envelope, built; its mutant is in As built) |
| D-7924 to D-7925 | none | none | Spare, unused. |

D19 (`CCRC_TESTBOX_URL` is `presence`) was built by Task 3, D21 (a server node's fleet-only families as one line each) by
Task 6, and D22 (a refused row's `why` is a member of a closed set) by Tasks 3 (the 33 words, `BOX_SETTING_REFUSAL_WORDS`
in L0, held equal to the bash words by W1), 4 (the server's check) and 5 (the writer); doctor prints those words too.
All three stand as the spec agreed them.

### Controller rulings made while building

- Tasks 3 to 8's step-level text was scanned at each task's dispatch, not all up front: the plan's ownership section already settled the cross-task interfaces.
- The SDD workspace stays in the worktree's git-ignored `.superpowers/sdd`; tests and subagent temp use the session temp root.
- The implementer's `- **D-7906/7907/7908.**` bullets in the plan's "Deviations found" stand: the growth test counts only bullet and heading definitions.
- The reviewer's out-of-task note on the origin shape (see Corrections and Later) is parked for the wave-done and the final review, not fixed here.
- Task 6's F1 expected family order follows L0's first-appearance order, not the plan's literal list.
- A not-used row keeps "not used on this role" in its value slot but shows its refused or not-measured why (closed words or bounded text, never a value).
- The `log-line-redact-corpus` pin (`CALLS` for `ccd/ccrc` 21 to 20, `_set_keep_why` retired) was folded into Task 5's commit by a local autosquash, so that pin never reddened a task's commit; SHAs changed locally only. Green at each task's wave-done is what held, not at every commit: two gate-sweep reds stood between wave-dones (census-w7 `persistedPresenceWords`, red from Task 3's `2606db945` at 32 against 20 until `bde598a65`, D-7921; slice-limits-config, red from Task 5's `8e19e43e9` until `c6d9c83a4`) (review 1487 F1).
- The coordinator ruled option A for census C8(c) (D-7920): one subshell, the mask as its first statement, census unedited.
- README leave: edit only the box-settings hunks (claim 3395 held by another programme); the session gate's opening paragraph is excluded; the leave on `ccd/ccrc-doctor-checks` was extended under claim 3417 for Task 7's doctor hunks.

### Interfaces as built

No task renamed an interface of the plan, except the one D-7921 records (the class token `presence` became `is-set`). As built: L0 (`shared/api.ts`) holds `BOX_SETTINGS_TABLE`-derived `BOX_SETTING_SPECS`
and `BOX_SETTINGS_SHOWN` (61), `BOX_SETTING_FAMILIES` (first-appearance order), `BOX_SETTING_VALUE_SHAPE`,
`BOX_SETTING_ORIGIN_SHAPE`, `BOX_SETTINGS_TEXT_MAX`, `BOX_SETTING_VALUE_WORDS`, `BOX_SETTING_REFUSAL_WORDS`,
`BOX_SETTINGS_V1_REFUSED_WHY` and `BOX_SETTINGS_V1_UNFIT_WHY`. `ccd/ccrc` holds `BOX_SETTINGS_TABLE` (bash), `_set_spec`,
`_set_libs`, `_set_says`, `_set_check`, `_set_fits`, `_set_row_json`, `_set_got`, `_set_lines`, `_set_tb_host`, `_set_reads`,
and the moved checks and words `_tshape`/`_tshape_says`, `_slice_limit_says`, `_keepalive_fresh_ok`/`_says`,
`_usage_days_ok`/`_says`, `_carry_warn_bytes_ok`/`_says`, `_keep_says`, `_upd_health_says`, `_upd_deadline_says`,
`_models_budget_says`. The server's `parseBoxSettings` reads version 1 (`rowOfV1`) and version 2 (`rowOfV2`); the card's
`familyGroups` and `settingLine` and `BOX_SETTINGS_NOT_USED_TEXT` are in `boxSettingsWords.ts`. `ccd/lib/ccrc-settings.sh` is
regenerated and byte-equal (W29-L1).

### Moved checks: their suites, run unchanged and green

Each move's own suites ran green after the move with no pin edited: Task 2 step 1 carveouts, testbox-knobs, graph-knobs,
ccrc-cli, census; step 2 slice-limits-config, carveouts, ccrc-uninstall, install-units; step 3 settings-lib, carveouts,
telemetry-keepalive, keepalive-freshness-parity, census, timer-first-run, ccrc-install-tree, install-census, macos-platform,
graph-repo-sweep, testbox-knobs; step 4 settings-lib, carveouts, usage-sweep-runner, usage-sweep-deploy-ship, census; step 5
ccrc-doctor-carry-copies, ccrc-doctor-core, census, docs-parity, carveouts, settings-lib; step 6 ten suites (1247 tests). The
wave-1 acts (`ccrc-update-kept`, `ccrc-update-flip-backups`, `ccrc-models-advance`, `ccrc-update-phases`,
`ccrc-versions-warn-arms`) were green at Tasks 3 and 5. `ccrc-test-wrapper` (16 rows) and `testbox-wrapper` (38 rows) fail in the
worker's own test slice on unmodified code (the stub `systemd-run` sees no call when run inside the slice, reproduced on
`6b0bb16e5`'s parent); CI is the arbiter.

### Growth, measured with the counter against the merge-base

| File | Net code lines |
|---|---|
| `ccd/ccrc` | +345 (waiver D-7906, `maxDelta` 345) |
| `ccd/ccrc-doctor-checks` | +12 |
| `server/src/watch.ts` | 0 |
| `pwa/src/lib/api.ts` | 0 |
| `shared/api.ts` | +163 |
| `server/src/update/boxSettings.ts` | +42 |
| `pwa/src/fleet/boxSettingsWords.ts` | +72 |
| `pwa/src/fleet/BoxSettingsCard.tsx` | +8 |

D-7906's split, each measured at its task's commit: Tasks 1 and 2 +52 (24, 29, 36, 42, 48, 52 after each of Task 2's six
commits; Task 1 nets 0), Task 3 +209 (+200 in its commit, +9 in its fix round), Task 5 +84; Tasks 4, 6 and 7 do not touch the
file. The waiver was created by `2d748ba78` (+42, the first commit past 40) and finalized by Task 8's waiver commit; the
armed run is green. `wire-totality`'s `EXEMPT_PINNED` did not move (the file is unchanged on the branch).

### Measurements the plan asked to record

- **V7, the largest document.** The writer's worst row of each key and worst top level, built from its own functions: 35177
  bytes of 65536. The server's synthetic largest version-2 document (`ok--v2-synthetic-largest.json`): 35510 bytes (35503 at
  Task 4, 7 more after Task 5's `from:'environment'`).
- **W2-D7 and V6 origin outputs.** `https://u:hunter2@mirror.example/releases` prints `custom https://mirror.example`;
  `u:hunter2@mirror.example/r` prints `custom mirror.example`; `http:/u:hunter2@mirror.example/r` and
  `https:///u:hunter2@mirror.example/r` print `custom`. With `_upd_redact` made an identity the first prints `custom` alone
  (the origin's own `@` test answers rc 1), recorded in D-7918. V6: `_upd_url_origin 'https://h:abc/r'` prints `https://h:abc`,
  rc 0, so the base reads `unmeasured` with the origin's fixed why; `_upd_url_origin 'https://'` prints `https://`, rc 0, also `unmeasured`.
- **C2b, jsdom.** `queryAllByRole('term')` inside a closed `details` returns 1 (jsdom 30.1.3, testing-library dom 10.4.1): role
  queries see closed content. The arm taken is "1": the pin is `toHaveLength(1)`, the existing term count (7, from
  `within(b).getAllByRole('term')`) at the old `:65` stays as written, and no `{ hidden: true }` was added anywhere.
- **V4's `REFUSED_SAMPLE` overrides** (a value each check refuses where the default `zz-refused-<i>` would pass):
  `CCRC_TESTBOX_GIT_KEY=relative/key`, `CCRC_TESTBOX_UNTRACKED_FILE_MAX=5MB`, `CCRC_GRAPH_MAX_SHRINK_PCT=150`,
  `CCRC_GRAPH_SOURCE_REF=../x`, `CCRC_TEST_SLICE_CPU_QUOTA=4`, `CCRC_SESSION_SLICE_MEMORY_MAX=90`, `CCRC_KEEPALIVE_FRESH=30m`,
  `CCRC_USAGE_SWEEP_DAYS=0`, `CCRC_CARRY_COPY_WARN_BYTES=10G` and `CCRC_TESTBOX_DENY_GLOBS` set to a tab and `zz-denied`.
- **Review 1403's F1, F3 and F4** were closed by Task 1: F1 and F3 by `9f1c23c5d` (`_upd_url_origin` tests the redacted scheme for
  http(s) too, with the `user:pw@ftp://h` rows), F4 by `8524c5e1f` (the third importer recorded in wave 1's plan).

### The mutation table (Task 8, re-run on saved copies, sequentially, each restored and checked with `cmp`)

Each mutant ran on a saved copy of the file (its sha256 recorded), only the suites it names, bounded by `timeout -k 10 900`.
Every mutant was killed; none survived.

| Mutant | What it changes | Killing rows |
|---|---|---|
| W2-M1 | one `value` key to `presence` in the bash table only | `box-settings-table` T2, T3, CONTROL; `ccrc-settings-verb` V1 |
| W2-M2 | a word added to bash only (`_tshape_says`) | `box-settings-table` W1 |
| W2-M2b | the server accepts a `why` outside the set | `box-settings-read` "a refused why outside the closed set", and the corpus and lane rows for `malformed--v2-why-outside-set.json` |
| W2-M3 | the verb writes `value` on a refused row | `ccrc-settings-verb` V4 (whole, nine named, wave 1), the `$HOME` row; `box-settings-read` "the corpus regenerates from the real verb" (the document parses `malformed`) |
| W2-M4 | the parse accepts a value on a `presence` row | `box-settings-read` "an is-set row carrying a value" and "an is-set row carrying an empty value", and `malformed--v2-presence-with-value.json` (file and lane) |
| W2-M5 | the server keeps a refused version-1 row's value | `box-settings-read` the frozen v1 corpus, "parses with no value and the server's own sentence", "no raw text survives", the lane row, the `GET /api/updates` row |
| W2-M6 | the verb reads a test-box host key through `_tb_load` | `ccrc-settings-verb` V4 (whole and the `CCRC_TESTBOX_GIT_KEY` row), V5 (NUL, mode 000, hidden libraries), V9 (both rows) |
| W2-M7 | `_tshape`'s CPU and I/O weight bound 10000 to 10001 | `ccrc-test-wrapper` "CCRC_TEST_SLICE_CPU_WEIGHT=10001 is not its shape" and "IO_WEIGHT=10001 warns with exactly its words" (the two rows red beyond the 16 environmental ones); `ccrc-settings-carveouts` stays green (no row pins that bound) |
| W2-M8 | a library check changed in `ccd/ccrc`, not regenerated | `ccrc-settings-lib` W29-L1 and W29-L5 |
| W2-M9 | the 240 why cut skipped (cut at 2000) | `ccrc-settings-verb` V7 and V6 "a reader sentence over 240 bytes" |
| W2-M10 | `_set_fits` always passes | `ccrc-settings-verb` V6 (four rows); `box-settings-table` E2 |
| W2-M11 | a family with a refused row folds | `box-settings-card` F4, F5, S4 |
| W2-M11b | a `button` in place of `summary` | `box-settings-card` A1, F1, F3, F4, F5, R2, S4 and "renders no button and no input" |
| W2-M12 | a server-role node renders the 54 fleet rows | `box-settings-card` S1, S3 |
| W2-M13 | the redacted scheme's http(s) test dropped | `ccrc-settings-verb` the `_upd_url_origin` rc-1 row and the `user:pw@ftp://...` and `tok@ftp://...` rows |
| W2-M14 | `_set_check` folds rc 2 into 1 | `box-settings-table` C (four hidden-library rows), `ccrc-settings-verb` V5 (hidden libraries), `ccrc-doctor-codex` W2-D9 |
| W2-M15 | `_set_lines` takes the fourth field as a why | `ccrc-settings-verb` V11 (the graph store and the test-runs rows) |
| W2-M16 | `rowOfV1` forwards an `ok` value outside the envelope | `box-settings-read` the seven version-1 unfit rows, the lane row |
| W2-M17 | doctor skips `_set_fits` | `ccrc-doctor-codex` W2-D11 |
| W2-M18 | `_set_fits` admits any lowercase word on a `testbox` key | `box-settings-table` E2; `box-settings-read` "the writer and the server agree on the envelope, entry by entry" |

A first try of W2-M15 broke the file's syntax (96 rows red for that reason), so it was redone as a clean mutation. The
wrapper baseline for W2-M7 was measured on the unmutated file: 16 red rows, all environmental.

### Corrections of plan claims the build measured differently

- **M10's attribution.** The plan said the emitted-key row catches the restored `BOX_SETTINGS_KEYS` literal. It cannot (that row reads the table, not the loop); V1's no-literal assertion and the corpus row catch it.
- **F1's family order.** The card's order is L0's first-appearance order: Updates, Session slice, Test runs, Graph, Keepalive, Usage sweep, Test box, Carry copies; the plan's list put Test box before Keepalive.
- **W2-D7's own-mask case.** With the redactor made an identity, the userinfo base prints `custom` alone, not `custom https://mirror.example`; the origin's own `@` test refuses it.
- **Task 3's growth estimate.** The plan expected about +140; Task 3 measured +209 (+200 at first, +9 in the fix round).
- **Task 4's extra M12 rows.** The plan's rows did not kill the omit-class mutant (an `ok` omit row is refused by the class check anyway); two forgery rows were added (an unmeasured and a refused row of an omit key in a real row's place), both red.
- **V7's quote premise.** Task 5 first measured 27438 bytes on a `a\` input and wrote that a run of quotes is dropped; that was a shell quoting accident. The worst why is 3000 `"` characters, and the largest document is 35177 bytes, under the cap.
- Smaller: the plan's `9000` needle in V3 sits inside `900000` (the row uses `invalid:9000`); the bash-only table mutants are red in T2 and CONTROL, where T3 and T5 read L0 only until Task 3's fix round widened them to the bash rows too.

- **Gate sweep, the class token (D-7921).** The D12 class `presence` is spelled `is-set` in code (the `is-set` class, the spec's `presence`, D12), because C7o (OA-C18 (a), #1371) reserves `presence` in TypeScript for session presence and `census-w7/pwa.test.ts#persistedPresenceWords` went red at 33 against its 20. Only the class TOKEN moved: the bash table rows and comparisons, `BoxSettingClass` and `BOX_SETTING_TABLE`, the server parse's arm, the card's comparison, and the tests that name it. The words the user reads do not change, `BOX_SETTING_PRESENCE_TEXT` keeps its name (the census names its own list of identifiers and none is this one), and the fixture file `malformed--v2-presence-with-value.json` keeps its name (`testbox-pins` names it).
- **Task 5, the slice defaults row (gate sweep).** `slice-limits-config.test.ts`'s row "the defaults it reads with are the template's own values" was reworded (`c6d9c83a4`) to hold every literal `_ccrc_knob CCRC_SESSION_SLICE_*` read to the template's default (set equality plus a non-empty check), because `cmd_settings` now reads the same two keys in file mode. A CONTROL row beside it plants `_ccrc_knob CCRC_SESSION_SLICE_MEMORY_MAX 25G file` in the ccd/ccrc text in memory and asserts the set is no longer `{'24G'}`, so a second read with another default reds the row above. Measured on a saved copy of `ccd/ccrc` (sha256 `f2ae28406…`, restored and checked with `cmp`) and of the test (sha256 `56a53ba37…`, restored and checked with `cmp`), review 1487 F3 / D-7922: (1) the default of `cmd_settings`' read, `_ccrc_knob CCRC_SESSION_SLICE_MEMORY_MAX 24G file`, changed to `23G`, reds the rewritten row ("the defaults it reads with are the template's own values") and the CONTROL row's last assertion (the real text is the template's set), 2 red of 74; (2) the CONTROL row's planted second read removed from the test, reds the CONTROL row alone, 1 red of 74.

- **The dead updates arm (review 1487 F6-ruling item 6).** `_set_check`'s updates subshell now ends in `*) return 2 ;;`, not `return 0`: a key added to the updates family without a resolver arm reads `unmeasured` (the subshell's rc 2 reaches the existing fixed sentence `<key> could not be checked by its resolver`), never `ok`. No `SET_CHECK_WHY` line was added (the line count of `ccd/ccrc` is unchanged). `box-settings-table` pins it twice: a harness row that replaces `_set_spec` in the fixture shell with one that answers family `updates` for a key the table does not hold, so the table is not edited (rc 2 and the sentence), and a source pin on the arm's text. Measured on a saved copy (sha256 `a0a982308…`, restored and checked with `cmp`): the arm changed back to `return 0` reds both rows, 2 red of 64.
- **The settings library that lacks a words function (review 1487 F5).** `ccd-telemetry-keepalive` and `ccd-usage-sweep` keep their loader lines byte for byte and refuse, ahead of the check, with "the settings library this check needs did not load" when `_keepalive_fresh_ok` (keepalive) or `_usage_days_ok` and `_usage_days_says` (usage sweep) is not defined, naming no value; stderr carries no command-not-found line. The two "W2: a library without ..." rows assert the new sentence and that absence; every Task 1 pin of a real refusal is unchanged.
- **V10, each consumer's own read beside the verb's literal (review 1487, ruled as met).** Each consumer reads its key with the same `_ccrc_knob <KEY> <default>` call as the verb's literal, apart from the `file` mode word. Keepalive: `_ccrc_knob CCRC_KEEPALIVE_FRESH 1800 && CCRC_KEEPALIVE_FRESH="$KNOB"` in `ccd/ccd-telemetry-keepalive`, beside `_ccrc_knob CCRC_KEEPALIVE_FRESH 1800 file` in `cmd_settings`. Usage sweep: `_ccrc_knob CCRC_USAGE_SWEEP_DAYS 7 && CCRC_USAGE_SWEEP_DAYS="$KNOB"` in `ccd/ccd-usage-sweep`, beside `_ccrc_knob CCRC_USAGE_SWEEP_DAYS 7 file` in `cmd_settings`. Carry: `_ccrc_knob CCRC_CARRY_COPY_WARN_BYTES 10737418240 file` in the carry-copies check of `ccd/ccrc-doctor-checks`, beside the same text in `cmd_settings`. The read is the same function with the same default, so a default changed in one place reds `ccrc-settings-census` C2.
- **The SC2054 directives (review 1487 F4).** Measured with shellcheck 0.11.0 (`--norc --shell=bash -S warning -f gcc`) on copies in the scratch directory, never the tracked file: (1) the two directives above the arrays: 0 findings, and a bad row planted in a LATER row of `BOX_SETTINGS_TABLE` is hidden too (0 findings); (2) the directive moved onto the first row INSIDE each array: 2 findings (one SC2054 per array), so shellcheck does not honour it there and it hides nothing; (3) that variant with a bad row planted later: still 2 (one per array, at the first row). So a directive on a row cannot be used, and each stays above its array with its reason reworded to say it covers the whole array. `ccd/ccrc` stays at 178 findings with every code at its pin; `server/test/shellcheck-baseline.json` is untouched.

### Later (the plan's list, unchanged, and what the build added)

Unchanged from the plan:
- `_tshape`'s `[0-9]`/`[1-9]` ranges: enumerating them changes behaviour under a locale, so they move verbatim (ruling; Task 2 Step 1).
- Closing an `unmeasured` row's `why` as line-number templates, so the server can check it rather than only bound it (D-7913; review L9).
- Doctor's graph check relays `GK_WARN`, which quotes a refused value (spec 5.6).
- Whether a private release mirror should show its host (D19).
- Reading the installed slice and graph-unit values rather than the configured ones (spec 5.7).
- The test box's own 28 settings, shown from the test box itself, if it ever reports to the console.
- From the spec's earlier list, still deferred: editing a setting from the console; a macOS snapshot; a push when a setting turns `refused`; a `reason` token vocabulary held set-equal to the bash literals; doctor reading the timer's cadence from its unit file (ARCH-69).

Added by the build:
- The rc 2 WARN from doctor's box-settings check when a library failed to load carries the generic plain-line remedy, not one for the library.
- Part B of D-7923 is built: the envelope (`BOX_SETTING_ORIGIN_SHAPE` in bash and L0, byte-equal) requires the scheme, so a scheme-less `custom <host>` row is outside the envelope. Mutant, measured: restoring the optional scheme in L0 and in bash (saved copies, cmp-restored) reds 5 rows: `box-settings-table.test.ts` E1, and in `box-settings-read.test.ts` the version-1 rows `custom zz-leak` and `custom mirror.example.invalid` and the version-2 rows `an origin with no scheme` and `an origin that is a bare host`. (Not Later any more.)
- The human form of `ccrc settings` cuts an unmeasured why at 480 while the JSON record cuts at 240.
- V10's keepalive, usage and carry rows re-run the verb's own literal read, not each consumer's.
- `rowOfV2` checks a refused why against the whole closed set, not the key's own words (final review).

### Final review

The final whole-branch review found no leak path. It sent two fixes, both landed:
- `docs(server): the envelope comment says what the shapes prove, not more (final review)`: the comment on the value and origin shapes no longer claims they prove no value can carry a credential; no test pinned the old text.
- `fix(pwa): the Box settings card leaves out a family the box reported no row for (final review)`: `familyGroups` drops a family with no rows, so a version-1 document renders the updates fold alone and a server-role node no "not used" line for a family it never reported. Two new card rows (E1, E2) went red first and a restored-empty-families mutant turns both red again.

Two smaller findings were moved to Later: the dead `*) return 0 ;;` arm (built in fix round 1, below) and `rowOfV2`'s whole-set why check.
