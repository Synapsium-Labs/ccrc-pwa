# ccrc plugins — wave 1 (the registry and commands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ccrc <plugin> …` runs an enabled plugin's executable with a clean environment; `ccrc plugin list|enable|disable` manage the box's enabled set; `$REG/plugin-off` stops plugins by hand; sessions cannot enable plugins.

**Architecture:** Manifest rules and the enabled-set decision are L1 (`core/internal/domain/plugin`), plugin directories and the enabled file are L3 (`core/internal/adapter/pluginfs`), the `plugin` entry is L4 (`core/internal/app/plugin`), wired in `cmd/ccrc-core`. `ccd/ccrc` forwards `plugin …` and an unknown verb that names a plugin to the core.

**Tech Stack:** Go 1.27.4 (standard library only), bash (`ccd/ccrc`), Python (the installer), vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-ccrc-plugins-design.md` (§2, §3 "Commands", §7, §8 wave 1).

## Global Constraints

- Everything in the Go core's wave 1 Global Constraints holds (module, toolchain, standard library only, rings, SAFETY, public repo, D-TBD, the commit trailer, foreground tests, the Linux bench as the authority).
- Plugin names: `[a-z][a-z0-9-]{0,40}`, and never a built-in `ccrc` verb (the verbs of `ccd/ccrc`'s top-level `case "$VERB"`, read by a guard test, never a hand list).
- A manifest's `events` are `NotifyEvent` kinds (`NOTIFY_KINDS`, `shared/api.ts`, exported for the generator), never a second list.
- The plugin's environment is built from an empty one: `PATH`, `HOME`, `LANG`, `CCRC_PLUGIN_NAME`, `CCRC_PLUGIN_STATE` (`~/.ccrc/plugin-state/<name>/`, created 0700). No ccrc secret, no session identity, no other variable reaches it.
- `$REG/plugin-off` has no writer in the tree: present and empty, or naming the plugin on a line, means off.
- `ccrc plugin enable|disable` are the operator's: they join the classifier's forbidden rows, the session hook's account arm (bash now; the Go hook inherits it through the vocabulary) and the child deny rules, as the account verbs do.

## Deviations found

- D-TBD-plugin-enabled-file: spec §2 keeps the enabled state in `coord.db`. Commands run on the fleet box, which may have no server, so the box's enabled set is a file, `~/.ccrc/plugins-enabled.json`, whose one writer is `ccrc plugin enable|disable` (the roster's pattern); wave 2's Settings door drives the same verb through the agent, so the writer stays one. Spec §2 is amended in Task 1. Cost if wrong: wave 2 moves the file's authority to the server.

---

### Task 1: The manifest rules (L1) and the vocabulary

**Files:** Create `core/internal/domain/plugin/manifest.go` (+ `_test.go`). Modify `shared/api.ts` (export `NOTIFY_KINDS` beside its type), `core/gen/vocab.mjs` (add it), `core/internal/kernel/vocab/vocab_gen.go` (regenerated), `docs/superpowers/specs/2026-11-24-ccrc-plugins-design.md` (§2: the enabled file; the manifest example's events become `["done", "merged", "mail"]`).

**Interfaces — produces:** `plugin.Manifest{Name, Version, Exec string; Commands, Events, Grants []string; Panel *Panel}`; `plugin.ParseManifest(data []byte, reserved []string) (Manifest, error)` refusing: bad JSON, missing name/version/exec, a name outside the grammar or in `reserved`, an absolute or `..` `exec`, an event outside `vocab.NotifyKinds` (and `unknown`, the client-side member), duplicate entries.

- [ ] Tests first: one table test per refusal and the happy path; run, see them fail; implement; pass on both platforms; regenerate the vocabulary and run `vocab-gen.test.ts`.
- [ ] Commit: `feat(core): plugin manifests and their rules (plugins wave 1)`.

### Task 2: Discovery, the enabled file and the off switch (L3 + L1)

**Files:** Create `core/internal/adapter/pluginfs/pluginfs.go` (+ test), `core/internal/domain/plugin/registry.go` (+ test).

**Interfaces — produces:** `pluginfs.Discover(treeDir, homeDir string) ([]Found, error)` (`Found{Dir, Source: "release"|"operator", Manifest []byte, ReadErr error}` for each `<treeDir>/plugins/*/plugin.json` and `~/.ccrc/plugins/*/plugin.json`, never following a link out of its root); `pluginfs.ReadEnabled(home) ([]string, error)` / `WriteEnabled(home, names) error` (atomic temp + rename, 0600; absent = none enabled); `pluginfs.ReadOff(reg) (all bool, names []string, err error)` (unreadable = all off). `plugin.Resolve(found, enabled, off, reserved) []Entry` with `Entry{Name, Dir, Source, State: "on"|"off"|"disabled"|"broken", Why string, Manifest}`: two plugins with one name are both `broken` ("name collision"), a manifest that fails `ParseManifest` is `broken` with its error.

- [ ] Tests first (fixture dirs in `t.TempDir()`), both platforms; commit `feat(core): plugin discovery, the enabled set and the off switch (plugins wave 1)`.

### Task 3: The `plugin` entry: list, enable, disable, run

**Files:** Create `core/internal/app/plugin/plugin.go` (+ test). Modify `core/cmd/ccrc-core/main.go` (the `plugin` entry; the release tree is `filepath.Join(exeDir, "..", "..", "..", "..", "ccrc")`'s equivalent read from the installed layout — read how the installer places the tree and resolve `<tree>/plugins` from it; if the tree cannot be located, release plugins are absent, never an error), `core/entries.json` (a `plugin` row, `owns: []`, mode none — it has no bash twin).

Behaviour: `ccrc-core plugin list [--json]` prints each entry's name, source, state and reason; `enable <name>` refuses a broken or unknown plugin and inside a Claude Code session (`CLAUDECODE` set — an accident guard, as `--below-cap` does), else adds it to the enabled file; `disable <name>` removes it; `run <name> [args…]` refuses a plugin that is not `on` (exit 3 with the reason), else execs the manifest's `exec` (resolved inside the plugin directory, a regular executable file, never through a link out of it) with the args, the plugin directory as working directory, the environment of the Global Constraints, stdin/stdout/stderr passed through, and exits with the plugin's status. Tests: an env-dump fixture plugin proves the exact environment (no `CCRC_MAIL_TOKEN`, no `CLAUDE_*`, no `HOME`-derived secrets); exit status passthrough; off-switch and broken refusals; enable refused under `CLAUDECODE`.

- [ ] Commit `feat(core): ccrc-core plugin list, enable, disable and run (plugins wave 1)`.

### Task 4: `ccrc` forwards to the core; sessions cannot enable plugins

**Files:** Modify `ccd/ccrc` (the top-level `case "$VERB"`: `plugin) …` forwards to the installed core; the `*)` arm asks the core whether the verb names an `on` plugin and runs it, else keeps today's unknown-verb error), `server/src/coord/approvalguard.ts` (`FORBIDDEN_*` rows for `ccrc plugin enable|disable`), `shared/api.ts` (the child deny and account deny rule tables for the same), `ccd/session-hook.sh` (its account arm, following how it already refuses the account verbs), the doctor checks (`ccrc doctor` prints one `plugins` line: how many on, off, broken, and why for each broken), and the tests that pin each of those tables (`account-deny`, `session-hook-account-deny`, the must-allow fixture keeps `ccrc plugin list` open), plus `server/test/ccrc-plugin.test.ts` (forwarding, the unknown-verb error unchanged for a non-plugin, a reserved-name guard reading `ccd/ccrc`'s case arms).

- [ ] Tests first; run the touched files on the Linux bench; commit `feat(ccrc): ccrc plugin and ccrc <plugin> forward to the core; sessions cannot enable plugins (plugins wave 1)`.

### Task 5: Install and release carry the core and `plugins/`

**Files:** Modify `ccd/ccd-entry-install.py` (publish the core binary whenever the tree carries one for this platform, not only when an entry runs in go mode; refuse only as today when a go-mode entry needs it), `deploy/build-release.sh` (ship `plugins/` — empty but present, with a `plugins/README.md` naming the manifest format and the spec), `ccd/ccrc#_inst_tree` (carry `plugins/`), their tests (`ccd-entry-install`, `build-release`, `ccrc-install-tree`), and `README.md` (a short "Plugins" section: where they live, `ccrc plugin …`, the off switch, that they run as the fleet's user).

- [ ] Commit `feat(install): every box carries the Go core and the plugins directory (plugins wave 1)`.

## Results

(filled at the end of the wave)
