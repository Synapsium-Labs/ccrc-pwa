# ccrc's Go core — wave 2 (the vocabulary generator and the session hook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session hook (`ccd/session-hook.sh`) has a Go implementation, `ccrc-core hook`, that answers byte for byte as the bash does in every test that runs the hook, with the vocabulary generated from its TypeScript owners; on Windows the installer registers the Go hook.

**Architecture:** The hook is a classification of the stdin event followed by a linear pipeline of stages each gated by event (inventory §0–§1), so the Go hook is `app/hook` (L4) running stages over L1 deciders in `domain/attention` and siblings, with L3 adapters (tmux, regfs, the lock, ccrc-api, node helpers) wired in `cmd/ccrc-core`. Every RUN test of the hook moves onto one harness, `runHook(impl, payload, env)`, and runs in both implementations as its arms are ported; the hook stays `bash` everywhere until Task 9 flips `windows` to `go`.

**Tech Stack:** Go 1.27.4 (standard library only), the existing bash hook, vitest, Node (the generator; `compact-card.mjs` and `approval-verify.mjs` stay node processes).

**Spec:** `docs/superpowers/specs/2026-11-24-ccrc-go-core-design.md` (§4 hook registration, §5 vocabulary, §6 comparison, §8 wave 2). **Reference:** the read-only survey `docs/superpowers/programs/go-core/2026-11-24-wave2-hook-inventory.md` ("the inventory") — every task cites its sections.

## Global Constraints

- Everything in wave 1's Global Constraints (`docs/superpowers/plans/2026-11-24-ccrc-go-core-w1.md`) holds: module `ccrc/core`, `go 1.27` + `toolchain go1.27.4`, standard library only, the rings, platform keys, modes, SAFETY, the public-repo rule, D-TBD for deviations, the commit trailer, tests in the foreground one file at a time, the Linux bench as the authority for ccd/hook tests.
- The Go hook's entry is `ccrc-core hook` with **no event argv**: the event comes from stdin's `hook_event_name`, as in bash (inventory §1 "Mismatch with the spec"); Task 1 amends spec §3/§4's example.
- **Exit status is always 0**, on every path, as the bash's header contract says; stdout carries at most the event's own envelope (inventory §2A), including the PreCompact plain-text exception.
- **Byte-identical outputs:** `hookstate.json`, `turn.json`, spool lines, the approval digest (`shared/api.ts#approvalDigestBytes`), every stdout envelope. Go's `encoding/json` is never used to write them directly; the kernel's jq-faithful encoder (Task 1) is.
- **Quirks are kept** (spec §6 "a port reproduces the bash, defects included"): e.g. a failed hookstate write exits before the PreToolUse deny prints (inventory §2A).
- **Regexes are RE2** (operator ruling 2026-11-24): the Oniguruma-only programs `MERGE_STRIP_JQ` and `APPROVAL_FORBIDDEN_JQ` are rewritten as RE2 expressions and small Go parsers in L1 deciders, proven equal by parity tests over every case the suites hold. No jq process on any Go hook path, except the jq modules the inventory marks "keep jq" (`ccd/lib/mail-hold.jq`, `ccd/lib/roster-card.jq`, `ccd/lib/transcript.jq`), which stay external processes until their owners' waves.
- External processes that stay: `node` for `~/.cc-sessions/compact-card.mjs` and `$REG/approval-verify.mjs` (the signing boundary), `~/.local/bin/ccrc-api`, `ccrc test --classify-shell`, `tmux`, `git`. Each is reached through PATH, as bash reaches it, so the suites' PATH stubs bite in both modes.
- **Character units:** record, per cap, whether bash counts locale characters, code points or bytes (inventory §3c), and match it; the production locale is UTF-8.
- SessionEnd runs under Claude Code's 1.5 s budget: the Go SessionEnd path must not exceed the bash's work.
- `core/entries.json` gains a `hook` entry in `bash` mode on every platform until Task 9.

---

### Task 1: Foundation — the vocabulary generator, the hook entry, the encoder, the harness

**Files:** Create `core/gen/vocab.mjs`, `core/internal/kernel/vocab/vocab_gen.go`, `core/internal/kernel/jqjson.go` (+ tests), `core/internal/app/hook/hook.go` (+ test), `server/test/hookTwin.ts`, `server/test/vocab-gen.test.ts`, `server/test/hook-core-spine.test.ts`. Modify `core/cmd/ccrc-core/main.go`, `core/entries.json`, `server/test/ccd-core-table.test.ts`, `.github/ci/fast-plan.mjs` (+ its test), `docs/superpowers/specs/2026-11-24-ccrc-go-core-design.md` (§3, §4, §5).

**Interfaces — produces:** `vocab.*` Go constants and slices named after their TS exports (e.g. `vocab.HookEvents`, `vocab.AccountDenyRules`); `kernel.JQCompact(v any) []byte`, `kernel.JQCompactSorted(v) []byte`, `kernel.JQCompactSortedASCII(v) []byte` (jq `-c`, `-cS`, `-cSa` byte forms) over an ordered value type `kernel.Obj` (keys kept in insertion order); `hook.Main(stdin io.Reader, x hook.IO) int` (always 0); `runHook(h, impl, payload, env?) → {status, stdout, stderr}` in `hookTwin.ts`.

- [ ] Generator: `core/gen/vocab.mjs` transpiles the named owners with the server's own `typescript` package (no build step), imports them, and writes `vocab_gen.go` deterministically (sorted, `gofmt`-clean, a "generated — do not edit" header). Its export list is inventory §3a; for §3b it takes `shared/hook-helpers.mjs#HOOK_CONSTANTS` and `server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS` (their owners stay where they are; the generator reads them), and leaves the rest of §3b (`HOOK_TIMEOUT_S`, `ccd/history/lib.mjs`, `launch-profiles.json`, ccd's writers) as runtime reads or Go constants with a recorded reason. `vocab-gen.test.ts` regenerates into a temp file and fails on any difference with the committed file (red when a TS value changes and the Go file is not regenerated: measure it).
- [ ] Spec: §3's example becomes `ccrc-core hook`; §5 says the generator reads each value's owner wherever it lives (`shared/*.ts`, `shared/*.mjs`, the named server modules), never a copy.
- [ ] Encoder: golden tests against real `jq -c`, `-cS`, `-cSa` output for strings with `<>&`, U+2028/2029, control characters, non-ASCII, nested objects and arrays, integers and floats; plus the `approvalDigestBytes` vectors from its server test. Generate the golden files once with real jq into `core/internal/kernel/testdata/` (script committed beside them).
- [ ] Entry: `ccrc-core hook` dispatches to `app/hook`; `core/entries.json` gets `"hook": {"owns": [...], "ownsDigest": "file", "tests": [...], "mode": {}}`; widen `ccd-core-table.test.ts#functionText` to read `ccd/session-hook.sh`, and add an `ownsDigest: "file"` kind that digests the whole hook file (its arms are top-level statements, inventory §5 "table guard").
- [ ] Harness: `hookTwin.ts#runHook` starts `bash ccd/session-hook.sh` or `coreBinary() hook` with the payload on stdin, a fixture HOME and the env; first parity test: no pane and no job dir → exit 0, empty stdout, no files written, in both modes.
- [ ] CI: a change under `core/internal/app/hook/**`, `core/internal/domain/**` or `core/gen/**` selects every `session-hook*` suite on the fast run (inventory §7 "CI selection"); `ci-fast-plan.test.ts` pins it.
- [ ] Commit per step group; every commit green (the hook is `bash` everywhere).

### Task 2: The spine — identity, parse, classification, state, output

**Files:** `core/internal/app/hook/*.go`, `core/internal/domain/attention/*.go` (classification, hookstate rules), `core/internal/adapter/tmux/`, `core/internal/adapter/regfs/` (+ tests); the RUN test files listed below.

Scope (inventory §1 preamble, classification table, tail stages 2, 4, 5, 10, 14, 15, 18, 19, 20, the SessionStart emitter with empty cards): identity (tmux through PATH with a 2 s bound; the job-dir fallback over `$REG/*.uuid`), the one parse, every classification arm except the network reports (stubbed so they do nothing in Go until Task 6, and those tests stay bash-only until then), hookstate read and write (atomic, the 64 KiB rule in bash's unit, carries, `_hook_fresh_read`, `waitPrev`, `_hook_server_cap`), `_hook_turn_mark` + `TURN_MARK_PROGRAM`, `_hook_join_record` + `tmsub`, the `-hookcap` capture, `_hook_emit_context`, stdout sequencing with the exit quirks.

Tests moved onto `runHook` and run in both modes: `session-hook.test.ts`'s state-mapping and fleet-gate describes, `-turnmark`, `-background`, `-agent-events`, `-subagent-ask`, `-compact-carry`, `ask-instance-guard`, `bucket`, `measure-working-state`, `stall-verdict`, `fleet`, `dispatch-live-gate`; a Go-side guard replacing `ccd-swap-guards`' cut of `TURN_MARK_PROGRAM` (red when the Go program changes shape). Split the commit per sub-area; the bash-mode result of every moved test must be unchanged.

### Task 3: Spools and records

Scope (inventory tail stages 6–8): `DSP_DEFS` `spool`/`lrec`, `_hook_spool_append`/`_listing`/`_prune` with `LC_ALL=C` byte caps and `DSP_LINE_BELOW` (4096 on GNU/Linux, 1008 on macOS and MSYS), `_hook_launch_record_append` (1 MiB budget), `_hook_history_spool_append` (fenced lines, append). Tests in both modes: `delegation-spool` (+ a Go twin of its `CAP_STMT` cut), `-launch-record`, `ccd-inflight`, `inflight-manifest`, `-append-race` (+ a Go twin of its guard cut), `delegation-adoption-corpus`, `delegation-wave3.integration`.

### Task 4: PreToolUse arms on plain regexes

Scope (inventory §2D, tail stage 12 minus the Oniguruma arms): the graph gate and nudge with `_hook_graph_measure`, `_hook_graph_diff`, `_hook_gate_tree` (a git adapter through PATH), the landing advisory, the role-skill deny, Fable, the test route (`ccrc test --classify-shell` process), the reader arms, the fan-out pin (the jq JS scanner becomes an L1 Go decider). POSIX-ERE captures use `regexp.CompilePOSIX`; `GH_API_RE` and `CCD_DOOR_RE` are derived from `GH_MERGE_RE` the way the bash derives them. Tests in both modes: `-graph-pins`, `-graph-repo`, `-sync-advisory`, `-role-skill-deny`, `-fable-agents`, `-fan-out-routing`, `-test-route`, `-reader-arms`, `delegation-rig`'s fan-out describe, `ccd-session-path` (+ a Go twin of its `GRAPH_RUN` cut).

### Task 5: The Oniguruma arms, rewritten in RE2

Scope: the merge deny (`MERGE_STRIP_JQ` and the EREs derived from it), the account / child / quiz / prune / build deny (`APPROVAL_FORBIDDEN_JQ` in its `deny`, `account` and `class` modes, with the `--arg deny` table from `childDenyRules`), and the mail hold (`ccd/lib/mail-hold.jq` stays a jq process — inventory §4 "keep"). The two programs become L1 deciders in Go: each Oniguruma construct (atomic groups, possessive quantifiers, backreferences, conditionals, recursion, lookaround) is replaced by an RE2 expression plus a small scanner where RE2 cannot express it, with a comment naming the jq construct it replaces. **Gate:** a parity test runs every case the suites hold (`-account-deny`, `account-deny`, `-approval-deny`, `-quiz-deny`, `-prune-deny`, `-merge-deny`, `mail-hold-module`, `mailhold-parity`, `ccd-keep-awake`, the must-allow fixture `server/test/fixtures/account-deny/must-allow.json`) through bash and Go and requires identical decisions and reasons; add a corpus of adversarial strings per rule family (path spellings, quoting, `$VAR`, separators) generated from the bash's own documented residuals so a divergence shows up as a failing case, not silence. The prune-deny cost bound applies to Go too.

### Task 6: Network and door

Scope (inventory §2H, tail stages 9, 17, 21, 23): `_hook_net_bound` (one 8 s budget per invocation), `_hook_start_report`/`_send`/`_keep`, `_hook_start_loads` + `_hook_loads_pend` (`transcript.jq` stays a process), `_hook_door_report`, `_hook_door_arms` (witness: sha256 over the kernel encoder's `-cS` bytes), `_hook_model_report`, `_hook_typed_model`, `_hook_door_delta`, `_hook_roster_card` + `_hook_roster_wake` (`roster-card.jq` stays a process), `_hook_anchor_fetch` + `_hook_anchor_owed`. Every network call goes through `~/.local/bin/ccrc-api` as a process (an L3 adapter). Tests in both modes: `-start-report`, `-start-loads`, `-door-reports` (+ a Go twin of its `DOOR_NUDGE_JQ` cut), `-door-delta`, `-model-events`, `-roster-card`, `-anchor`.

### Task 7: PermissionRequest approvals

Scope (inventory §2E, tail stages 16 and 22): `_hook_approval_gate` (Task 5's `class` mode, `APPROVAL_DIGEST_JQ` through the kernel's `-cSa` encoder, native sha256, a nonce from `crypto/rand`, `child-deny.digests`), `_hook_approval_wait` (ticks, deadline, `_apr_scan`, `ccrc-api` calls, `node approval-verify.mjs`, the park), `_hook_approval_route_patch`, `_hook_approvals_drop`. Tests in both modes: `-approval-wait`, `-approval-route`, `-approval-park`, `-approval-envelope`, `approval-paths-characterization`.

### Task 8: SessionStart cards and compaction (8a cards, 8b compaction and locks)

8a (inventory §2F): `_hook_memory_converge`, `_hook_graph_card`, `_hook_hold_card`, `_hook_role_card`, `_hook_ccrc_card`/`_ct_probe`, `_hook_history_card` (the history constants read at run time from their owner, or generated), filling Task 2's emitter. 8b (inventory §2G, tail stages 1, 24, 25): the hook's lock family over wave 1's lock adapter (the `link`/inode re-proofs, `_hook_lock_vanished`'s `/proc` scan, `_hook_generation_ok` — the hook's deliberately different exit-0 lock contract kept), `_hook_compact_pre`/`_post`/`_card*`/`_mark_served`/`_serve_end`, `_hook_compact_scope`, `_hook_family_sweepable`, `_hook_compact_refuse`, `_hook_compact_pre_line`, `_hook_history_scope`/`_pre`/steer; `compact-card.mjs` stays node. Tests in both modes: `session-hook.test.ts`'s compaction and lock describes (Go fault seams replacing `hookGuardSeam` bash copies), `-precompact`, `-precompact-refuse`, `-steer`, `-role-card`, `install-linear-skill`, `history-recall`, `history-agents-ingest` (+ a Go twin of `hookGateLines`), the compact-card suites, and one race test of bash against Go on `compactions.lock`.

### Task 9: Text guards and the switch

Go-side twins of the TEXT guards (inventory §5): the event set equals `vocab.HookEvents` equals the Go dispatch; `single-definition` covers `core/`; `_api_server_cap`'s generator keeps its source (the bash hook) until the bash is removed; `tmux-socket-census` sees Go read `TMUX_SOCKET_FILE` from the vocabulary. The installer: `HOOK_CMD` follows the hook's mode (`"$HOME/.local/libexec/ccrc/core/ccrc-core" hook` in `go`), and every recogniser of the managed hook accepts both commands (`install-session-hooks.sh`'s `JQ_UNMANAGED`, doctor's hooked test and `DR_OWN_HOOK_JQ`, `ccrc` uninstall, `delegation-rig/rig.sh`). Then the whole hook suite runs in both modes in Linux CI, the Windows timings are taken (target: under 300 ms per call on a healthy box), and `core/entries.json` sets `"hook": {"mode": {"windows": "go"}}`. Tests: `install-session-hooks`, `ccrc-doctor-*`, `ccrc-uninstall`, `delegation-rig-w0`, `launch-surface-installer`, and every remaining TEXT suite, each with its Go-side guard measured red when deleted.

## Deviations found

Go core wave 2 (the session hook in Go): each difference or shortcut the implementers recorded, one line, by slug, cited at its code site under `core/` (`server/test/hook-core-text-guards.test.ts` holds every slug below to a site). Slugs are `D-TBD-go-hook-<name>` until the numbers are minted (`POST /api/ledger/deviations`, box-token gated, not reachable from the build session); the ledger of rulings is the task reports and the controller's progress notes.

- `D-TBD-go-hook-apr-one-value`: a hook payload or approval answer holding two whole JSON values is `forbidden` in Go; the bash runs each program per value and would send a two-line canonical form, which Go never sends (stricter).
- `D-TBD-go-hook-apr-tie-glob`: bash's unquoted `for u in $uids` also pathname-expands an id against the hook's cwd; Go does not glob (`approval.go#AprWatch.Look`). Only an id that expands to a valid-shaped cwd filename differs, and it can only end a wait on a different tie.
- `D-TBD-go-hook-apr-trap-at-once`: bash runs `trap 'exit 0'` only after a foreground child exits; Go exits at once (`main.go#hookTrap`). Both exit 0 printing nothing, so only the timing differs (about 29 ms against 145 ms on SIGTERM).
- `D-TBD-go-hook-argjson-stderr`: on an `--argjson` the bash cannot parse (a non-JSON `CLAUDE_PID`, string subagents `"[bad"`), the bash's hookstate jq leaks jq's usage error to stderr (it has no `2>/dev/null`); the Go hook is silent.
- `D-TBD-go-hook-ascii-classes`: `ValidID` and the capture id cleaning are ASCII; bash's ranges under a UTF-8 locale may collate other letters in.
- `D-TBD-go-hook-cd-cdpath`: CDPATH is not consulted (`cards.go#physDir`): bash's `cd` consults it for a relative operand not starting with `/` or `.`, and every caller passes an absolute path or one led by the cwd.
- `D-TBD-go-hook-char-units`: `${#out}` and `${x:0:n}` count code points when LC_ALL/LC_CTYPE/LANG names a UTF-8 locale, else bytes (`utf8Locale`); shortcut: a named locale is taken as installed. jq's `length`/`.[0:n]` are code points.
- `D-TBD-go-hook-classify-group`: `timeout 5` sends TERM to its group and waits forever for a command that ignores it; Go sends TERM to the group and kills what is left 100 ms later.
- `D-TBD-go-hook-closed-stdout`: a stdout CLOSED at start cannot be seen. Go's runtime reopens fd 1 on /dev/null read-write before main, which is also what Node's `stdio: 'ignore'` and Python's DEVNULL hand a child (all O_RDWR, measured), so no test separates. Linux and macOS only: on Windows a native program MSYS2's bash starts with fd 1 closed has no usable stdout, so the core's print fails as the bash's does (measured, Task 9b gate round).
- `D-TBD-go-hook-ctread-classes`: `CtRead` trims ASCII `[:space:]`; bash's class under a UTF-8 locale also holds other blanks. `.uuid` is a ccd-written UUID line.
- `D-TBD-go-hook-ere-ascii-classes`: the shell EREs (`LANDING_SYNC_RE`, `GRAPH_SEARCH_RE`) use ASCII `[[:space:]]`/`[[:blank:]]`; glibc under UTF-8 also holds U+2003-class spaces.
- `D-TBD-go-hook-first-value`: a hook file holding several JSON values is read as its first value (`JQParseFirst`); jq would go on to later inputs after one that errors (the two-value row of the quirks table measures the common case).
- `D-TBD-go-hook-glob-malformed-class`: Go refuses a malformed class word that jq accepts, the deny direction.
- `D-TBD-go-hook-glob-order`: glob order is Go's byte order, bash's the locale's collation (only matters if two rows hold the same uuid).
- `D-TBD-go-hook-history-ts`: the history line always carries `ts` (the Go clock) where a bash with no `EPOCHREALTIME` (below 5.0) writes none.
- `D-TBD-go-hook-join-rotation-flock`: the join rotation needs no `flock` binary on Linux/macOS (flock(2) in-process); on Windows (Task 9b) it rotates under MSYS2's `flock -n` held by a child (`lock.Hold`, wired as `regfs.OS.Flock`), and reads the content through a second open by name where the bash reads the locked descriptor, so a file replaced between the two opens is read but not the one locked.
- `D-TBD-go-hook-json-single-value`: jq reads every JSON value of a stream; Go reads the first (the anchor answer, the runs list's `rosterCard`) or refuses a second (a kept report line, which the bash would send as two lines). The server answers one object and the hook writes one line.
- `D-TBD-go-hook-ln-into-dir`: a directory made at the link between the rmdir and the link fails Go's symlink where bash's `ln -sn` would place the link inside it (`cards.go#memoryConverge`); Go does less (stricter), both leave the pair unconverged and doctor reports it.
- `D-TBD-go-hook-locale-codeset`: an installed locale name with no codeset (`en_US`) is read as not UTF-8 (`locale.go`).
- `D-TBD-go-hook-locale-lookup`: no locale.alias expansion and no language-territory fallback, and the archive is searched as a NUL-delimited name (`adapter/host/locale.go`); a name reachable only by an alias reads missing (bytes). No fleet box sets such a name. On Windows (Task 9b) the answer is MSYS2's setlocale's (`locale_windows.go#cygwinLocale`: a lowercase language, an optional uppercase territory, known to Windows), except a language Windows names with a script only (`sr_RS` with no modifier), which Cygwin loads and Go reads missing.
- `D-TBD-go-hook-lock-same-dev`: the bash's Darwin fallback compares inode numbers alone; Go compares device and inode (stricter).
- `D-TBD-go-hook-lookup-miss`: no difference between the hooks; both changed together (Task 9c). A PreToolUse whose session lookup matches no session (no `cc-<id>` pane, no `.uuid` row holding the session id, or an off-class name) no longer skips every deny arm: the arms run with every session fact read as absent, the envelope is printed, and nothing reads or writes a row (`ccd/session-hook.sh#@hook-miss-end`, `hook.go#missed`, `PreIn.Miss`). Refused on a miss, as in every session: the account, quiz and prune rows, the `--admin` and `gh api` bypass (its allowance unprovable), the role skill, Fable, the fan-out pin, the `wrapped` test route, a reader's write door named by `agent_type`, the pinned model. Left as an unknown session has them, because a legitimate session that is no child does what they refuse: the wave's plain merge (a coordinator lands PRs), the child's verb, surface and build rows (a top-level session may run them after asking; a coordinator rules approvals), the `heavy` test route (a fleet session's), a joined reader's door and the three-reader bound (the join record and the roster are the session's). Not run: the graph gate (its bound is the session's hookstate counter, so on a miss it would deny every search with no bound), the landing advisory (a nudge, never a deny) and the mail hold (its marker and seen files are the session's). Cost: every Claude Code process in a hooked home that ccd did not start now meets the every-session denies.
- `D-TBD-go-hook-lowercase`: `${x,,}` is `strings.ToLower` (Unicode 17 tables vs glibc's), and ASCII only in a non-UTF-8 locale. It is matched only against ASCII extensions and `fable`, which no code point assigned since lowers into.
- `D-TBD-go-hook-meta-age-shortcut`: `fromdateiso8601` is read as `Y-M-DTh:m:sZ` with 1-2 digit fields; glibc's strptime accepts more blanks. The age only reaches the SessionStart card (Task 8), never a gate decision; ccd writes the canonical form.
- `D-TBD-go-hook-meta-single-value`: meta.json/settings.json are read as ONE JSON value (jq streams values): a file with a second value is a jq success and a refusal here. ccd writes one object. (Task 2's D-TBD-go-hook-first-value is the same shortcut.)
- `D-TBD-go-hook-musl-cap`: the cap's libc test is a musl loader under `/lib` (bash tests its own build's machine type, which is the box's libc); a box with a musl bash and no loader there is not a fleet box.
- `D-TBD-go-hook-net-group-kill`: a read that outlives its bound is signalled TERM then KILL 100 ms later (the classify entry's reasoning: GNU `timeout` waits for a child that ignores TERM). Evidence: `TestRun`, "a cut".
- `D-TBD-go-hook-no-jq`: no `command -v jq || exit 0`: the Go hook runs no jq (plan Global Constraints). Tests that remove or stub jq stay bash-only.
- `D-TBD-go-hook-no-wc-rm`: the size is a stat and a prune removes each file itself (the bash forks `wc -c` and one `rm -f`). Same size, same files removed, errors ignored in both. (The Go hook forks nothing on these paths.)
- `D-TBD-go-hook-nonce-source`: the approval nonce is crypto/rand (mandated by the brief; `main.go#hookNonce`); where `od` fails bash answers `nonce-failed` and sends nothing, Go sends the request. A ruling is still signature-verified before anything prints.
- `D-TBD-go-hook-nul-warning-stderr`: when `$( )` drops a NUL byte (a JSON `\u0000` in a skill name or command) bash warns on stderr; Go is silent. Decision, files and stdout equal (measured; the differential compares status and stdout and requires Go's stderr empty).
- `D-TBD-go-hook-off-status`: the one path where the Go hook exits non-zero (Task 9b, N4/N5): with `hook` in `ccd-go-off` it runs the bash hook and answers its status as a shell would, so a missing bash hook is bash's 127 and message (what the bash mode's registered command answers) and a signal is 128+n (`main.go#hookBash`); on Windows the bash mode's command hands Claude Code MSYS2's raw 3840 for TERM, which the core, itself started by MSYS2's bash (8 bits of status), cannot pass, so it answers 143 there.
- `D-TBD-go-hook-onig-class-range`: Go follows jq 1.7 and denies `[[:class:]-x]` ranges that jq 1.8 allows.
- `D-TBD-go-hook-onig-retry-limit`: bash fails open when Oniguruma hits its retry limit, Go decides (RE2 has no limit); Go never allows where bash denies.
- `D-TBD-go-hook-overlap-claim-glob`: the compaction overlap matches a claim by prefix and suffix, so a `.<id>.compactpost.claim` name counts too (`compaction.go#overlap`); stricter, and nothing writes such a name.
- `D-TBD-go-hook-pair-one-write`: the launch record's pair is one `write(2)`; bash's `printf '%s\n%s\n'` is one write when it fits stdout's buffer (a pair is under 2 KiB, buffer 4096 or 1008 on its platforms: a pair can reach about 1.7 KiB, so on the small-buffer platforms bash may write it in two). Same bytes either way; Go's single write is the stronger guarantee.
- `D-TBD-go-hook-proc-glob`: find reads a glob character in $HOME as a pattern; Go answers "named" there (stricter: a first-ever mint refused, never a second canonical). Tested in TestProcNames.
- `D-TBD-go-hook-rand`: `$RANDOM` is `math/rand` over the same 0..32767; the report id is unique either way.
- `D-TBD-go-hook-reads-in-bytes`: `read -N 37` (generation, wrapper 65, `.git` 1024) and `_ct_read` (128) count characters in a UTF-8 locale and drop NUL bytes; Go reads bytes and drops NULs.
- `D-TBD-go-hook-reads-unbounded`: the delta's `head -c 1024` (2 s) and the instruction hash's `cat` (the loads deadline) are plain reads in Go. Both name a regular, unlinked file (a FIFO is refused by `-f` before the read; door-delta's FIFO case); a hung filesystem could hold Go where bash cuts.
- `D-TBD-go-hook-runwith-temp-windows`: on Windows the transcript windows the loads hash hands jq are files in the user's %TEMP% (profile ACL), removed after the run, because a native program cannot hand an MSYS2 one a pipe past fd 2; the bash's `<( … )` writes nothing, and a hook killed mid-run leaves the file (`proc/run.go#RunWith`).
- `D-TBD-go-hook-script-argmax`: REPRODUCED on Linux, not a difference there: a Workflow scriptPath file whose text is over 131071 bytes makes the bash's `jq --arg file` exec fail (MAX_ARG_STRLEN), so the arm allows although the documented bound is 256 KiB.
- `D-TBD-go-hook-searchable-windows`: `Searchable` (`-r -x` on a directory) is a stat on Windows, where the MSYS bash's test answers the same for a directory the user can list; the listing then reads or fails as the bash's glob does.
- `D-TBD-go-hook-sha256-native`: `_apr_sha256` needs `shasum` or `node`; Go hashes natively. On a box with neither, the bash sends no witness key and `x` for each hash. The hook installer requires node, and `shasum` ships with perl or macOS.
- `D-TBD-go-hook-sigpipe-status`: a closed pipe at the SessionStart card's print stops the run, releasing what it holds, and exits 0 where the untrapped bash dies of SIGPIPE (141): the wave's exit-0 contract.
- `D-TBD-go-hook-spool-arith`: the pending field's and loads file's numbers go through `strconv`; bash's `(( ))` reads a leading zero as octal and wraps past int64. Only the hook's own `$(( ))` writes them (decimal, no zero, far from 2^63).
- `D-TBD-go-hook-start-loads-seam`: `session-hook-start-loads` moved from a `timeout` PATH shim to a `jq` shim plus a client that exits 124: a bash characterization change (same cases, same assertions), because Go bounds in-process.
- `D-TBD-go-hook-timeout-windows`: `HasTimeout` finds what the bash's `command -v timeout` finds (MSYS2's lookup); where that is System32's timeout.exe (a sleep), the bash's `timeout N cmd` fails and Go's in-process bound runs the call. A hook's PATH has MSYS2's /usr/bin first (`door.go#HasTimeout`).
- `D-TBD-go-hook-tmux-bound-kill`: a tmux stand-in that outlives the 2 s bound while ignoring TERM is waited for by `timeout` (bash) and killed by the Go adapter at its bound (`ctx` kill, Task 2's adapter). A tmux that answers is the same in both.
- `D-TBD-go-hook-unicode-tables`: `onigAlnum` (FABLE_RE's `[[:alnum:]]`) follows Go's Unicode 17; jq's Oniguruma is older, so a code point assigned since is alnum here and not there.
- `D-TBD-go-hook-windows-argmax`: on Windows a native program's argument travels in its command line, where the bash hook's (MSYS2 to MSYS2) does not, and MSYS2 cuts an argument from a native parent at 8186 characters and refuses a quote-dense one past about 16 KB (CygwinQuoteArg doubles its quotes past 32767): a long command reached the classifier cut, or not at all, and Go skipped a test-route deny the bash gives (final review finding 3, measured with both stub kinds). Every command now goes on stdin to MSYS2's bash, which reads it with the `read` builtin and hands it to `ccrc test --classify-shell` (`proc.go#ClassifyShell`): one path on Windows, no length threshold. The extra bash start is measured at 0.64 s against the argument path's 0.54 s at the median in one probe and 0.68 s against 0.09 s (p95 4.7 s) in another, on a loaded box; so the 5 s bound is MSYS2's `timeout` inside that shell, around ccrc, where the bash hook's `"$hooktmo" 5 ccrc` starts it, and the Go bound outside is a backstop at twice it, counted from the byte the shell prints once it is up (fix round 2), so a slow bash start is never charged to it. Anything but a clean exit is no answer, as the bash's `|| tverdict=""`. Still on argv (final review re-review N3, information only): the `h.Run` jq calls, `start.go`'s `loads_body --argjson o …` with its `--args` hashes and `start_loads --arg s`, and `net.go`'s roster card, so the 8186 cut applies to them on Windows. None gates a deny, and the start-loads report is inert on Windows in both modes, so no parity is lost today; a later arm that rides argv on Windows is not safe by this entry.
- `D-TBD-go-hook-windows-classify-slow`: the test-route classifier (`ccrc test --classify-shell`) answers slowly on Windows in both hooks (about 5 to 18 s over a 9 KB command, measured in the fix wave), past the 5 s a paned session gives it. Cut there it answers nothing and the test route fails open: the command runs as written, outside `ccrc test`'s slice and queue. That routes nothing and is no safety deny (no account, child, merge or build row reads the classifier), so it is a cost, not a gap (`proc.go#classifyOnWindows`).
- `D-TBD-go-hook-windows-jq-arg`: on Windows the mail hold's `jq --arg strip <command>` met the same 8186-character cut (measured: jq.exe read 8186 of 9000, and a 20000-quote value could not start), so `proc.go#JQ` hands every `--arg` value to jq as a `--rawfile` from a file in the user's %TEMP%, removed when the run ends; jq reads it into its variable and `$ARGS.named` alike. The bash's `--arg` puts nothing on disk. When that file cannot be written, jq is never asked and `JQ` says so apart from a jq failure; the mail hold then refuses wherever its module could have refused (the refuse lane armed, a live hold over a gated act's word or a joined subagent's mail ack), never failing open (fix round 2, re-review N2; `mailhold.go#mailHoldUnasked`).
- `D-TBD-go-hook-windows-fifo`: an MSYS2 FIFO (mkfifo) does not exist for a native program (Node's lstat and attrib answer not found, measured), so where the bash sees `-p` the Go hook sees absent and may create a regular file at the name (`regfs/special.go#special`); nothing in ccrc makes a FIFO. The FIFO cases of the hook suites are Linux-only on Windows for this reason (Task 9b gate round).
- `D-TBD-go-hook-windows-home-fold`: the account arm's `pnorm` folds a `~/` path under the core's Windows HOME (`C:\...`), where the bash's `$ENV.HOME` is MSYS2's `/c/...`: unfolded, a `~/.ccrc/./<secret>` read was allowed on Windows where the bash denies it (measured, Task 9b gate round). A drive-letter path in the payload itself, which the bash leaves unfolded, is folded too (stricter) (`forbidden.go#pnorm`).
- `D-TBD-go-hook-windows-lock-split`: considered and ruled out (Task 9b). A native Windows lock (LockFileEx) would not exclude MSYS2's flock, and ccd's bash takes the same row lock (`ws-rm`, `ws-reap`, `ws-gc --prune`, `forget`, `ws-reclaim`, `start`), so the split would be permanent, not a switch-moment window. The Go hook on Windows takes MSYS2's flock through a child on the alias (`row_windows.go#Hold`), measured to exclude bash and Go both ways (`row_cross_test.go`, run on Windows); the lock is taken before the identity proofs, and an acquisition in flight keeps its alias on disk for up to its wait.
- `D-TBD-go-hook-windows-msys-paths`: on Windows the core opens a path a bash on the box wrote into a file (ccd's `.workdir`, ccd-graph's meta.json `store`) in MSYS2's spelling: `/c/...` is drive C and any other `/...` is under MSYS2's root (`regfs/native_windows.go#native`; measured against `cygpath -w`). Before it, the store's settings.json was never read there and the gate kept its defaults where the bash read the operator's settings. shortcut: the default mounts only (no /etc/fstab read).
- `D-TBD-go-hook-windows-signals`: on Windows MSYS2's `kill -TERM`/`-INT`/`-HUP` ends the native Go hook at once (TerminateProcess; its MSYS2 parent reads 143), so the approval wait's `trap 'exit 0'` never runs there; both print nothing and leave a held row pending (`main.go#armTrap`).

## Results

**The switch.** `core/entries.json` puts the hook in `go` mode on Windows only (Task 9b); Linux and macOS stay `bash`.
The off switch (`~/.cc-sessions/ccd-go-off` naming `hook`) hands the very next call to the bash hook, and the installer
registers the core's command only when the launcher answers `go`. The switch commit came before the PATH fence and the
quoting fix in history; the branch is squashed before any push, so no shipped commit carries it without them.

**The gate (Task 9b, then the final fix wave).**
- Logic parity is the Linux bench's both-mode runs. At 0a8fd6eea: spawn-group-pin, prune-deny, approval-wait,
  compact-carry, the spine, the fence test, test-route and mail-hold, 1464 passed, 2 failed (both pre-existing). The fix
  wave's own bench pass at 0aab368c6 (each file alone, load 1.8 to 4.6): hook-path-fence, ccd-core-hook-mode,
  ccd-core-table, ccd-entry-install (158), ccd-harness-integrity, ccrc-containment, hook-core-text-guards, the spine,
  session-hook-test-route, hook-core-net, session-hook-anchor, approval-park, merge-deny, door-reports, launch-record,
  precompact, roster-card, sync-advisory, turnmark and session-hook (941) green, and `go test ./...` green (Windows too).
  Red, and not this wave's: approval-wait's corpus scan residue (red at BASE too), growth-check's waiver ledger row and
  topology-clean's collection (both read git history the bench's old-base checkout does not have; green on Windows), and
  typecheck-tests' pwa half (the bench's package links; the server half is clean).
- Windows ran every hook suite in go mode: 5040 passed, 317 failed, 759 skipped over 56 files, every failure attributed;
  the 317 are class (e), red in both hook modes (the debt list below). Those numbers predate the fix wave's fence, its
  classifier change and its jq change. At the fix wave's tip on Windows: hook-core-net both modes and the test-route
  long-command cases green; session-hook-mail-hold in go mode red only on two timing cases (a hook run inside one
  wall-clock second; a 300-call loop past its 300 s budget); and **the byte-parity spine red in both modes, 9 of 50**: two
  timeouts and seven cases where one hook lost one whole event's output or write, at varying events and in both
  directions (one of them the graphify gate's deny, missing in Go). One instance, instrumented, was a session miss (that
  hook wrote no hookstate: the bash, at a different event than any earlier run); why the session lookup misses so often
  in the spine on Windows is not established. Open before a `stable` promotion of the Windows switch.
- Re-attributed by the final review's finding 6: hook-core-net and session-hook-anchor, run alone on Windows, were red
  where the 9b table listed 0. Their reds were `sameFiles`' fixed 2500 ms clock tolerance (now the longer run's
  duration), hook-core-net's no-`timeout` box (a PATH built from directories that do not exist on Windows; now Linux and
  macOS only) and, for session-hook-anchor's LIVE case, a start-report stamp 15 s apart, read (inferred from the stamps
  and the run times; `api.calls` was not read) as: on Windows the bash hook spends
  its 8 s network budget on MSYS2 process starts (about 7 s a run here), so the start report finds under a second left
  and is kept for 5 s, where the Go hook (about a second a run) sends it, gets no answer inside the bound and keeps it for
  30 s. The same logic at a different speed; the case holds on the bench in both modes.
- On the bench, each file run alone five times in both modes: the reds are one shape, a start-report stamp about 25 s
  apart (one hook kept the report 30 s, the other 5 s) and, with it, a read sent by one hook and not the other, at the
  8 s budget's one-second edge; in some runs the bash sent and Go did not, in others the reverse. The bench's wall clock
  steps back 1.47 to 1.79 s every 32 s (measured against the monotonic clock), and both hooks do their budget arithmetic
  on the wall clock (the bash's `_hook_epoch_ms`, the Go hook's `NowMs`, which mirrors it), so a step inside either run's
  window gives that run about 1.5 s more. A bench clock artifact, not a Go defect; a later full pass of the bench had both
  files green.

**The final review's measurements.**
- Finding 4, the hung read: with `performance.now()` in `hookBoth`, hook-core-net's hung-read case 20 runs alone on the
  bench: Go 4006 to 4392 ms, bash 4046 to 4077 ms, all past the 3.8 s floor. The 3.54 s readings were `Date.now()` across
  a clock step; no Go defect. Closes 9b's concern 3 and 8b's N1.
- Finding 5, one-event misses under load: measured on Windows at the tip, 200 calls per mode interleaved (an
  account-arm deny of a Read under `~/.ccrc`, through MSYS2's `bash -c '<registered command>'` in one fixture HOME, the
  hookstate removed before each call; load average 1.4 at the start and 6.7 at the end, other sessions working on the
  box): bash 0 calls without a deny and 0 without a hookstate (median 4386 ms, p95 14025 ms); Go 0 and 0 (median 685 ms,
  p95 1450 ms). Go's miss rate is not above the bash's, and the cause 9b inferred (a pane lookup past its 2 s bound) did
  not recur in 400 calls. Pre-existing in both modes; the follow-up is in the debt list below.
- Finding 9, timings: `win/bench/hook-time.mjs` at the tip (fccc662ae's core, built with `core/build.sh`'s flags), now
  fenced (a contained PATH of the stand-in bin, MSYS2's /usr/bin and System32, and the fixture's home variables), 50
  calls per event after two warm-up calls, the modes interleaved, each as `C:/msys64/usr/bin/bash.exe -c '<registered
  command>'`. Not an idle box: load average 12.3 at the start and 5.1 at the end, other sessions working on it; no quieter
  window came during the wave.

  | event | bash median / p95 | go median / p95 |
  |---|---|---|
  | SessionStart | 4765 / 6167 ms | 220 / 791 ms |
  | PreToolUse | 2089 / 3093 ms | 199 / 789 ms |
  | Stop | 2207 / 2456 ms | 202 / 745 ms |

  Go's medians are under the 300 ms target; its p95s are not on this box. A Bash call that names `systemd-run` (or, on a
  fleet box, a test program) also starts one more MSYS2 bash on Windows to hand the classifier its command (0.1 to 0.6 s
  at the median, measured), outside the classifier's 5 s bound; this table's PreToolUse (`ls`) does not reach the
  classifier.

**Windows-port debt (chips; red or inert in both hook modes, so the switch changes none of them).**
- Class (e) from the 9b gate: ccd's manifest program (45 cases), the delegation rig and sanitizer (115), the census scans
  (7), the history sweep program (137), two `ccrc doctor` runs past their test budget, the compaction helper's mined set
  (2), the citation audit without the freeze commits (8) and the corpus scan's sanitizer residue (1).
- 9b concern 2: the bash twin's `/`-rooted checks never act on Windows (the start-loads report, the roster wake, the
  approval wait's pane-answered tie, the worktree listing, `lrpath`, memory convergence's MSYS2 slug).
- 9b concern 3: the compaction helper (`compact-card.mjs`) resolves few of a transcript's files on Windows.
- 9b concern 4 / finding 5: a tmux lookup past its 2 s bound leaves a call with no session. Since Task 9c the denies
  that need no session fact still run on such a call, in both modes (`D-TBD-go-hook-lookup-miss`); the rows that need
  one (a wave's merge, a child's rows, the heavy test route) stay silent for it. Follow-up (its own change, in bash and
  Go together): fall back to `$REG/*.uuid` by `CLAUDE_CODE_SESSION_ID` when the lookup times out.
- Finding 13: a Read, Edit or Write `file_path` spelled with backslashes (`C:\Users\u\.ccrc\…`) matches neither mode's
  `/\.ccrc/…` account pattern on Windows. Go may fold `\` to `/` in `pnorm` there (stricter, allowed), with a slug.
- Finding 16: `topology-clean`'s Windows harness reds (its `SELF` check compares a `\` path; a case writes a file named
  `q"x.md`, which Windows refuses; the history row resolves no base).
- The test-route classifier itself takes about 5 to 18 s over a 9 KB command on Windows, past the 5 s bound a paned
  session puts on it, so for such a command both hooks fail open there, by timing (found in the fix wave). That routes
  nothing and is no safety deny (`D-TBD-go-hook-windows-classify-slow`).
- ccd-entry-install on Windows: a POSIX `python3` path node cannot spawn, and Windows-form argv to MSYS2's Python (156
  red behind the fence, none a reach outside the fixture).

**Follow-ups and open questions.**
- The build deny does not name the `ccd` launcher or `~/.local/libexec/ccrc/core/ccrc-core`
  (`D-TBD-go-hook-build-deny-binaries`): an issue to file (text drafted in the fix wave report), its `#n` to be cited here.
- Spec §6 asks for a week on one box in go mode with the off switch armed before the switch. The wave switched from the
  suites and the bench. Ruling needed: §6's week applies at the end of the programme, or the hook switch stays out of a
  `stable` promotion until a Windows box has run it for a week.
- 56 `D-TBD-go-hook-*` slugs (plus `D-TBD-go-hook-windows-jq-arg`) are unminted: minted through the ledger allocator
  before merge (worker clause 11; a box-token call this wave did not make), plan lines and code sites rewritten together.
- 6's N3 (`HashReadable`'s `hasTimeout` term): kept; it is live in `app/hook/start.go#loadsHashes`, where the bash's
  `_hook_timeout … cat` digests as `x` with no timeout binary.
