# ccrc's Go core — wave 1 (the skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Go module `core/` builds one binary `ccrc-core`; the installed launcher starts it for the entries `core/entries.json` puts in `go` mode on the box's platform; `ccd caps` in Go replaces the Node twin's, which is removed; tests run ccd in both implementations; CI builds and tests the core.

**Architecture:** The Node twin's hand-off (launcher table, digest check, off switch, installer publishing, doctor check, uninstall and backup, parity harness) is kept and pointed at one Go binary instead of `ccd/node/`. Inside `core/`, rings are packages: `kernel` (L0), `domain/<context>` (L1+L2), `adapter/<name>` (L3), `app/<entry>` (L4), `cmd/ccrc-core` (L5), and a Go test holds the import direction.

**Tech Stack:** Go 1.27 (standard library only), Python 3 launcher/installer (existing), bash (existing), vitest (existing), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-24-ccrc-go-core-design.md` (it supersedes `2026-11-22-ccd-windows-node-twin-design.md` for everything ahead).

## Global Constraints

- Go module path `ccrc/core`, `go 1.27` in `core/go.mod`, **standard library only** (no `require` lines).
- The binary is `ccrc-core` (`ccrc-core.exe` on Windows); its first argument names the entry point (`ccrc-core ccd caps`).
- Platform keys are Go's `GOOS` names: `linux`, `darwin`, `windows`. Modes are `bash` or `go`; an absent entry or platform is `bash`.
- `caps` is `go` on `windows` only in this wave (it replaces the Node twin there); Linux and macOS stay `bash`.
- Same files, same bytes: Go output, exit codes and file effects match the bash byte for byte.
- The off switch is `~/.cc-sessions/ccd-go-off` (renamed from `ccd-node-off`); like every kill switch, nothing in the tree writes it.
- A protected verb (the launcher's `is_protected`) is never started on the core in this wave.
- Rings: `kernel` imports nothing under `ccrc/core/internal/` but `kernel/...`, and no `os/exec`; `domain/*` imports only `kernel` from `internal/` and none of `os`, `os/exec`, `net`, `net/http`; `adapter/*` imports only `kernel` from `internal/`; `app/*` imports `kernel` and `domain`, never `adapter`; only `cmd/ccrc-core` wires adapters.
- SAFETY (CLAUDE.md): fixture HOMEs only in tests, never `ccd`/`ccrc` against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*`; never print a secret file; never push.
- Tests in the FOREGROUND, `timeout ≥ 600000` ms, one vitest file at a time: `cd server && ./node_modules/.bin/vitest run test/<file>` (never bare `npx vitest`). `node_modules` are junctions to another worktree: never `npm ci`/`npm install`.
- Go on the Windows box: put `<go-toolchain>/bin` on `PATH` and set `GOCACHE` before any `go` command. The Linux
  bench (a WSL checkout synced from this worktree) is driven only through its script, `<bench-script> go test ./...`
  (Go tests in `core/`) or `<bench-script> run test/<file>` (one server vitest file); it syncs this worktree first.
  Never run a file from the Windows checkout inside WSL any other way (the operator's rule: it is slow).
- The repository is public: no private names, hosts or paths in code, tests, docs or commit messages.
- Deviation numbers are not minted in this wave: a deviation is written `D-TBD-<slug>` in this plan's `## Deviations found`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| Path | Responsibility |
|---|---|
| `core/go.mod` | module `ccrc/core`, go 1.27 |
| `core/entries.json` | the entry table (moved from `ccd/node/verbs.json`, `module` dropped, `mode` added) |
| `core/entries.go` | package `core`: embeds `entries.json` for the binary |
| `core/cmd/ccrc-core/main.go` | L5: multi-call dispatch, wires adapters into `app/ccd` |
| `core/internal/kernel/entries.go` | L0: `GoVerbs(table []byte, goos string) ([]string, error)` |
| `core/internal/domain/mutation/caps.go` | L1: `CapsLines(body string, poolSyncInstalled bool) ([]string, error)` (cmd_caps is C2 in `ccd/contexts.tsv`) |
| `core/internal/adapter/units/poolsync.go` | L3: `PoolSyncInstalled(home string) bool` |
| `core/internal/adapter/lock/lock_unix.go`, `lock_windows.go` | L3: `With(file string, fn func() error) error` |
| `core/internal/app/ccd/ccd.go`, `caps.go` | L4: `Main(args []string, x IO) int`, the verb table, `caps` |
| `core/internal/rings_test.go`, `rings.go` | the rings guard |
| `server/test/coreBuild.ts` | builds the binary once per test process: `coreBinary(): string` |
| `server/test/ccdTwin.ts` | `Impl = 'bash' \| 'go'`, `runImpl` |
| `ccd/ccd-entry.py`, `ccd/ccd-entry-install.py` | the hand-off pointed at the core |
| `ccd/ccrc`, `ccd/ccrc-doctor-checks` | uninstall, update backup, doctor check pointed at the core |
| `deploy/build-release.sh`, `deploy/deploy.sh` | build and carry the binaries |
| `.github/workflows/*.yml`, `.github/ci/*.mjs` | setup-go, the `test (core)` job, selection |

---

### Task 1: The Go module, multi-call entry and the rings guard

**Files:**
- Create: `core/go.mod`, `core/entries.json`, `core/entries.go`, `core/cmd/ccrc-core/main.go`, `core/internal/kernel/entries.go`, `core/internal/kernel/entries_test.go`, `core/internal/app/ccd/ccd.go`, `core/internal/app/ccd/ccd_test.go`, `core/internal/rings.go`, `core/internal/rings_test.go`

**Interfaces:**
- Produces: `kernel.GoVerbs(table []byte, goos string) ([]string, error)` (sorted names whose `mode[goos] == "go"`); `ccd.IO` struct and `ccd.Main(args []string, x ccd.IO) int`; the verb table `var verbs = map[string]func([]string, IO) int{...}` in `app/ccd/ccd.go` (Task 2 adds `"caps": caps`); `core.EntriesJSON []byte`.

- [ ] **Step 1: Write the module files and the failing tests**

`core/go.mod`:
```
module ccrc/core

go 1.27
```

`core/entries.json` (the Node twin's `ccd/node/verbs.json` entry, `module` dropped, `mode` added; copy `ownsSha256` from `ccd/node/verbs.json` verbatim; the tests path is the file Task 4 creates):
```json
{
  "entries": {
    "caps": {
      "owns": ["cmd_caps", "_pool_sync_installed"],
      "ownsDigest": "shape",
      "ownsSha256": "<the value in ccd/node/verbs.json>",
      "tests": ["server/test/ccd-core-caps.test.ts"],
      "mode": { "windows": "go" }
    }
  }
}
```

`core/entries.go`:
```go
// Package core holds the entry table the binary and the installer read (spec 2026-11-24 §4).
package core

import _ "embed"

//go:embed entries.json
var EntriesJSON []byte
```

`core/internal/kernel/entries_test.go`:
```go
package kernel

import (
	"reflect"
	"testing"
)

func TestGoVerbs(t *testing.T) {
	table := []byte(`{"entries":{"b":{"mode":{"windows":"go"}},"a":{"mode":{"windows":"go","linux":"bash"}},"c":{}}}`)
	got, err := GoVerbs(table, "windows")
	if err != nil || !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("windows: got %v, %v", got, err)
	}
	got, err = GoVerbs(table, "linux")
	if err != nil || len(got) != 0 {
		t.Fatalf("linux: got %v, %v", got, err)
	}
	if _, err := GoVerbs(table, "plan9"); err == nil {
		t.Fatal("an unknown platform must be refused")
	}
	if _, err := GoVerbs([]byte(`{"entries":{"a":{"mode":{"windows":"node"}}}}`), "windows"); err == nil {
		t.Fatal("a mode other than bash or go must be refused")
	}
	if _, err := GoVerbs([]byte(`not json`), "windows"); err == nil {
		t.Fatal("an unreadable table must be refused")
	}
}
```

`core/internal/app/ccd/ccd_test.go`:
```go
package ccd

import (
	"bytes"
	"testing"
)

func TestMainRefusesAnUnknownVerb(t *testing.T) {
	var out, errb bytes.Buffer
	rc := Main([]string{"nope"}, IO{Stdout: &out, Stderr: &errb})
	if rc != 125 || out.Len() != 0 || errb.String() != "ccd: the go core has no verb nope\n" {
		t.Fatalf("rc=%d out=%q err=%q", rc, out.String(), errb.String())
	}
	errb.Reset()
	if rc := Main(nil, IO{Stdout: &out, Stderr: &errb}); rc != 125 || errb.String() != "ccd: the go core has no verb (none)\n" {
		t.Fatalf("no verb: rc=%d err=%q", rc, errb.String())
	}
}
```

`core/internal/rings_test.go`:
```go
package internal

import (
	"os/exec"
	"strings"
	"testing"
)

func TestRingViolationsDetectsOutwardImports(t *testing.T) {
	bad := map[string][]string{
		"ccrc/core/internal/kernel":            {"os/exec"},
		"ccrc/core/internal/domain/mutation":   {"os", "ccrc/core/internal/adapter/units"},
		"ccrc/core/internal/adapter/units":     {"ccrc/core/internal/app/ccd"},
		"ccrc/core/internal/app/ccd":           {"ccrc/core/internal/adapter/lock"},
	}
	for pkg, imps := range bad {
		if len(RingViolations(pkg, imps)) == 0 {
			t.Errorf("%s importing %v must be a violation", pkg, imps)
		}
	}
	good := map[string][]string{
		"ccrc/core/internal/kernel":          {"encoding/json", "sort"},
		"ccrc/core/internal/domain/mutation": {"errors", "regexp", "ccrc/core/internal/kernel"},
		"ccrc/core/internal/adapter/units":   {"os", "path/filepath", "ccrc/core/internal/kernel"},
		"ccrc/core/internal/app/ccd":         {"fmt", "io", "ccrc/core/internal/domain/mutation"},
		"ccrc/core/cmd/ccrc-core":            {"os", "ccrc/core/internal/adapter/units", "ccrc/core/internal/app/ccd"},
	}
	for pkg, imps := range good {
		if v := RingViolations(pkg, imps); len(v) != 0 {
			t.Errorf("%s: unexpected violations %v", pkg, v)
		}
	}
}

// The real module: every package's imports, as `go list` reports them, keep the rings.
func TestModuleKeepsTheRings(t *testing.T) {
	out, err := exec.Command("go", "list", "-f", "{{.ImportPath}}{{range .Imports}} {{.}}{{end}}", "ccrc/core/...").Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(line)
		for _, v := range RingViolations(f[0], f[1:]) {
			t.Error(v)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd core && go vet ./... ; go test ./...`
Expected: FAIL to compile — `GoVerbs`, `Main`, `IO`, `RingViolations` undefined.

- [ ] **Step 3: Write the implementation**

`core/internal/kernel/entries.go`:
```go
// Package kernel is ring L0 of the Go core: vocabulary and primitives, importing nothing else from internal/.
package kernel

import (
	"encoding/json"
	"fmt"
	"sort"
)

var platforms = map[string]bool{"linux": true, "darwin": true, "windows": true}

// GoVerbs answers which entries core/entries.json puts in go mode on goos, sorted. An absent entry or platform is bash.
func GoVerbs(table []byte, goos string) ([]string, error) {
	if !platforms[goos] {
		return nil, fmt.Errorf("entries: no platform %q (linux, darwin or windows)", goos)
	}
	var t struct {
		Entries map[string]struct {
			Mode map[string]string `json:"mode"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(table, &t); err != nil {
		return nil, fmt.Errorf("entries: unreadable table: %w", err)
	}
	var out []string
	for name, e := range t.Entries {
		for p, m := range e.Mode {
			if !platforms[p] || (m != "bash" && m != "go") {
				return nil, fmt.Errorf("entries: %s has mode %q on %q", name, m, p)
			}
		}
		if e.Mode[goos] == "go" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}
```

`core/internal/app/ccd/ccd.go`:
```go
// Package ccd is ring L4 for the `ccd` entry point: argv in, a domain decision, acts through the adapters it is
// handed, output and exit code out. It decides nothing itself and never imports an adapter (spec 2026-11-24 §3).
package ccd

import (
	"fmt"
	"io"
)

// IO is what the composition root hands the entry point.
type IO struct {
	Stdout, Stderr    io.Writer
	Home              string                       // $HOME
	BodyPath          string                       // the installed bash body, read where a verb reads it
	GoVerbs           []string                     // entries in go mode on this platform, sorted
	ReadFile          func(string) ([]byte, error) // os.ReadFile
	PoolSyncInstalled func(home string) bool       // bash's _pool_sync_installed
}

var verbs = map[string]func([]string, IO) int{}

// Main runs one ccd verb. 125 is the launcher's "this implementation has no such verb" (the Node twin's code).
func Main(args []string, x IO) int {
	if len(args) == 0 {
		fmt.Fprint(x.Stderr, "ccd: the go core has no verb (none)\n")
		return 125
	}
	v, ok := verbs[args[0]]
	if !ok {
		fmt.Fprintf(x.Stderr, "ccd: the go core has no verb %s\n", args[0])
		return 125
	}
	return v(args[1:], x)
}
```

`core/internal/rings.go`:
```go
// Package internal holds the rings guard of the Go core (spec 2026-11-24 §3); its test reads the real module.
package internal

import (
	"fmt"
	"strings"
)

const base = "ccrc/core/internal/"

func ringOf(pkg string) string {
	if !strings.HasPrefix(pkg, base) {
		return ""
	}
	return strings.SplitN(strings.TrimPrefix(pkg, base), "/", 2)[0]
}

// RingViolations names every import of pkg that points outward.
func RingViolations(pkg string, imports []string) []string {
	ring := ringOf(pkg)
	allowed := map[string][]string{
		"kernel":  {"kernel"},
		"domain":  {"kernel", "domain"},
		"adapter": {"kernel", "adapter"},
		"app":     {"kernel", "domain", "app"},
	}[ring]
	banned := map[string][]string{
		"kernel": {"os/exec"},
		"domain": {"os", "os/exec", "net", "net/http"},
	}[ring]
	var out []string
	if ring == "" {
		return nil // cmd/ccrc-core (L5) and the guard itself wire everything
	}
	for _, imp := range imports {
		if r := ringOf(imp); r != "" && !contains(allowed, r) {
			out = append(out, fmt.Sprintf("%s (%s) imports %s (%s)", pkg, ring, imp, r))
		}
		if contains(banned, imp) {
			out = append(out, fmt.Sprintf("%s (%s) imports %s", pkg, ring, imp))
		}
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
```

`core/cmd/ccrc-core/main.go`:
```go
// ccrc-core is ccrc's Go core (spec 2026-11-24): one binary, its first argument (or the name it runs under) the entry point.
// This file is ring L5, the only place adapters meet the entry points.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	core "ccrc/core"
	"ccrc/core/internal/adapter/units"
	"ccrc/core/internal/app/ccd"
	"ccrc/core/internal/kernel"
)

func main() {
	args := os.Args[1:]
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	if name == "ccrc-core" {
		if len(args) == 0 {
			fmt.Fprint(os.Stderr, "usage: ccrc-core <entry> [args...]\n")
			os.Exit(2)
		}
		name, args = args[0], args[1:]
	}
	switch name {
	case "ccd":
		os.Exit(ccd.Main(args, ccdIO()))
	default:
		fmt.Fprintf(os.Stderr, "ccrc-core: no entry point %s\n", name)
		os.Exit(2)
	}
}

func ccdIO() ccd.IO {
	home := os.Getenv("HOME")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	body := ""
	if exe, err := os.Executable(); err == nil {
		body = filepath.Join(filepath.Dir(exe), "..", "ccd") // installed: ~/.local/libexec/ccrc/core/ccrc-core -> ../ccd
	}
	goVerbs, err := kernel.GoVerbs(core.EntriesJSON, runtime.GOOS)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ccrc-core: %v\n", err)
		os.Exit(2)
	}
	return ccd.IO{Stdout: os.Stdout, Stderr: os.Stderr, Home: home, BodyPath: body, GoVerbs: goVerbs,
		ReadFile: os.ReadFile, PoolSyncInstalled: units.PoolSyncInstalled}
}
```

Task 1 also creates the adapter `main.go` imports, so the module builds (Task 2 tests it):

`core/internal/adapter/units/poolsync.go`:
```go
// Package units is ring L3: the service manager's files (systemd's user units, which the Windows manager emulates).
package units

import (
	"os"
	"path/filepath"
)

// PoolSyncInstalled is bash's _pool_sync_installed on a systemd box: `[ -f ]` of the pool-sync timer, so a regular
// file through a link; a directory, anything else, or a path that cannot be examined is not a timer.
func PoolSyncInstalled(home string) bool {
	st, err := os.Stat(filepath.Join(home, ".config", "systemd", "user", "ccd-pool-sync.timer"))
	return err == nil && st.Mode().IsRegular()
}
```
Before writing it, read `_pool_sync_installed` in `ccd/ccd`: if it does more than `[ -f <that path> ]` on Linux and Windows, mirror exactly that and say so in the report. macOS is out of this wave (caps is `bash` there).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd core && gofmt -l . && go vet ./... && go test ./... && go build -o /tmp/ccrc-core-check ./cmd/ccrc-core && /tmp/ccrc-core-check ccd nope; echo rc=$?`
Expected: `gofmt -l` prints nothing; tests PASS; the last line prints `ccd: the go core has no verb nope` and `rc=125`.

- [ ] **Step 5: Show the guard goes red**

Temporarily add `import _ "os/exec"` to `core/internal/kernel/entries.go`, run `go test ./internal/`, see `TestModuleKeepsTheRings` FAIL naming `kernel ... imports os/exec`, then remove the import. Record the red line in the report.

- [ ] **Step 6: Commit**

```bash
git add core
git commit -m "feat(core): the Go module, its multi-call entry and the rings guard (Go core wave 1)"
```

---

### Task 2: `ccd caps` in Go

**Files:**
- Create: `core/internal/domain/mutation/caps.go`, `core/internal/domain/mutation/caps_test.go`, `core/internal/app/ccd/caps.go`, `core/internal/app/ccd/caps_test.go`, `core/internal/adapter/units/poolsync_test.go`
- Modify: `core/internal/app/ccd/ccd.go` (add `"caps": caps` to `verbs`)

**Interfaces:**
- Consumes: `ccd.IO`, `ccd.Main` (Task 1), `units.PoolSyncInstalled` (Task 1).
- Produces: `mutation.CapsLines(body string, poolSyncInstalled bool) ([]string, error)`; `ccd caps` printing the body's caps list, then one `go:<verb>` line per `IO.GoVerbs` entry.

- [ ] **Step 1: Write the failing tests**

`core/internal/domain/mutation/caps_test.go`:
```go
package mutation

import (
	"reflect"
	"strings"
	"testing"
)

const body = "x\ncmd_caps() {\n" +
	"  [[ $# -eq 0 ]] || die \"usage: ccd caps\"\n" +
	"  cat <<'EOF'\nalpha\nbeta\nEOF\n" +
	"  # a comment\n" +
	"  echo gamma ; echo delta   # trailing comment\n" +
	"  if _pool_sync_installed; then\n    echo pool-sync-installed\n  else\n    echo pool-sync-absent\n  fi\n" +
	"}\nafter() {\n}\n"

func TestCapsLines(t *testing.T) {
	got, err := CapsLines(body, false)
	want := []string{"alpha", "beta", "gamma", "delta", "pool-sync-absent"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("absent: %v %v", got, err)
	}
	got, _ = CapsLines(body, true)
	if got[len(got)-1] != "pool-sync-installed" {
		t.Fatalf("installed: %v", got)
	}
}

func TestCapsLinesRefusesWhatItCannotRead(t *testing.T) {
	b := "x\ncmd_caps() {\n  for v in a b; do echo $v; done\n}\n"
	if _, err := CapsLines(b, false); err == nil || !strings.Contains(err.Error(), "cannot read: for v in a b") {
		t.Fatalf("err = %v", err)
	}
	if _, err := CapsLines("no function here\n", false); err == nil {
		t.Fatal("a body without cmd_caps must be refused")
	}
}
```

`core/internal/app/ccd/caps_test.go`:
```go
package ccd

import (
	"bytes"
	"errors"
	"testing"
)

func capsIO(out, errb *bytes.Buffer, body string, readErr error, verbs []string) IO {
	return IO{Stdout: out, Stderr: errb, Home: "/h", BodyPath: "/b", GoVerbs: verbs,
		ReadFile:          func(string) ([]byte, error) { return []byte(body), readErr },
		PoolSyncInstalled: func(string) bool { return false }}
}

func TestCapsPrintsTheListThenItsGoVerbs(t *testing.T) {
	var out, errb bytes.Buffer
	body := "x\ncmd_caps() {\n  echo a\n}\n"
	if rc := Main([]string{"caps"}, capsIO(&out, &errb, body, nil, []string{"caps"})); rc != 0 {
		t.Fatalf("rc=%d err=%q", rc, errb.String())
	}
	if out.String() != "a\ngo:caps\n" {
		t.Fatalf("out=%q", out.String())
	}
}

func TestCapsRefusesAnArgumentAsBashDoes(t *testing.T) {
	var out, errb bytes.Buffer
	if rc := Main([]string{"caps", "--json"}, capsIO(&out, &errb, "", nil, nil)); rc != 1 || errb.String() != "ccd: usage: ccd caps\n" || out.Len() != 0 {
		t.Fatalf("rc=%d out=%q err=%q", rc, out.String(), errb.String())
	}
}

func TestCapsReportsAnUnreadableBody(t *testing.T) {
	var out, errb bytes.Buffer
	if rc := Main([]string{"caps"}, capsIO(&out, &errb, "", errors.New("gone"), nil)); rc != 1 || out.Len() != 0 {
		t.Fatalf("rc=%d out=%q", rc, out.String())
	}
}
```

`core/internal/adapter/units/poolsync_test.go`:
```go
package units

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPoolSyncInstalledReadsAsBashTestF(t *testing.T) {
	home := t.TempDir()
	p := filepath.Join(home, ".config", "systemd", "user", "ccd-pool-sync.timer")
	if PoolSyncInstalled(home) {
		t.Fatal("absent must be false")
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	if PoolSyncInstalled(home) {
		t.Fatal("a directory is not a timer")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if !PoolSyncInstalled(home) {
		t.Fatal("a regular file is a timer")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd core && go test ./...`
Expected: FAIL — `CapsLines` undefined; `Main([]string{"caps"}...)` returns 125.

- [ ] **Step 3: Implement**

`core/internal/domain/mutation/caps.go` (a port of `ccd/node/verbs/caps.mjs`'s `capsLines`, same rules, same refusal):
```go
// Package mutation is ring L1 for C2 Fleet Mutation (ccd/contexts.tsv): pure deciders, no IO.
package mutation

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const usageGuard = `[[ $# -eq 0 ]] || die "usage: ccd caps"`

var (
	echoes          = regexp.MustCompile(`^echo [a-z0-9:._-]+(\s*;\s*echo [a-z0-9:._-]+)*$`)
	trailingComment = regexp.MustCompile(`\s+#.*$`)
	semi            = regexp.MustCompile(`\s*;\s*`)
)

// CapsLines reads the body's own cmd_caps and answers what bash would print: the heredoc lines, every `echo <word>`
// word (lines split on `;`), and the taken arm of the one `if _pool_sync_installed` branch. Any other line is an
// error, so a new shape in cmd_caps turns the parity test red instead of drifting.
func CapsLines(text string, poolSyncInstalled bool) ([]string, error) {
	at := strings.Index(text, "\ncmd_caps() {")
	if at < 0 {
		return nil, errors.New("cmd_caps not found in the ccd body")
	}
	rest := text[at+1:]
	end := strings.Index(rest, "\n}\n")
	if end < 0 {
		return nil, errors.New("cmd_caps has no closing line in the ccd body")
	}
	var out []string
	heredoc := false
	branch := "" // "" outside the if, "take" or "skip" inside it
	for _, raw := range strings.Split(rest[:end], "\n")[1:] {
		if heredoc {
			if raw == "EOF" {
				heredoc = false
			} else {
				out = append(out, raw)
			}
			continue
		}
		t := strings.TrimSpace(trailingComment.ReplaceAllString(raw, ""))
		switch {
		case t == "" || strings.HasPrefix(t, "#") || t == usageGuard:
		case t == "cat <<'EOF'":
			heredoc = true
		case t == "if _pool_sync_installed; then":
			branch = map[bool]string{true: "take", false: "skip"}[poolSyncInstalled]
		case t == "else" && branch != "":
			branch = map[string]string{"take": "skip", "skip": "take"}[branch]
		case t == "fi" && branch != "":
			branch = ""
		case echoes.MatchString(t):
			if branch != "skip" {
				for _, w := range semi.Split(t, -1) {
					out = append(out, w[len("echo "):])
				}
			}
		default:
			return nil, fmt.Errorf("cmd_caps holds a line the go core cannot read: %s", t)
		}
	}
	return out, nil
}
```

`core/internal/app/ccd/caps.go`:
```go
package ccd

import (
	"fmt"
	"strings"

	"ccrc/core/internal/domain/mutation"
)

// caps prints the body's own caps list (bash's cmd_caps), then one go:<verb> line per entry this platform runs in Go.
func caps(args []string, x IO) int {
	if len(args) != 0 {
		fmt.Fprint(x.Stderr, "ccd: usage: ccd caps\n")
		return 1
	}
	body, err := x.ReadFile(x.BodyPath)
	if err != nil {
		fmt.Fprintf(x.Stderr, "ccd: the ccd body could not be read: %v\n", err)
		return 1
	}
	lines, err := mutation.CapsLines(string(body), x.PoolSyncInstalled(x.Home))
	if err != nil {
		fmt.Fprintf(x.Stderr, "ccd: %v\n", err)
		return 1
	}
	for _, v := range x.GoVerbs {
		lines = append(lines, "go:"+v)
	}
	fmt.Fprint(x.Stdout, strings.Join(lines, "\n")+"\n")
	return 0
}
```
Add `"caps": caps,` to `verbs` in `ccd.go`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd core && gofmt -l . && go vet ./... && go test ./...`
Expected: no gofmt output; PASS.

- [ ] **Step 5: Commit**

```bash
git add core
git commit -m "feat(core): ccd caps in Go, read from the body's own cmd_caps (Go core wave 1)"
```

---

### Task 3: The lock bash and Go both honour

**Files:**
- Create: `core/internal/adapter/lock/lock_unix.go`, `core/internal/adapter/lock/lock_windows.go`, `core/internal/adapter/lock/lock_test.go`

**Interfaces:**
- Produces: `lock.With(file string, fn func() error) error` — holds an exclusive lock on `file` that bash's `flock -x` respects, for `fn`'s length.

- [ ] **Step 1: Write the failing test**

`core/internal/adapter/lock/lock_test.go`:
```go
package lock

import (
	"bufio"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Spec 2026-11-24 §6: bash's flock(1) and Go exclude each other on one file, both ways.
func TestBashAndGoExcludeEachOther(t *testing.T) {
	if _, err := exec.LookPath("flock"); err != nil {
		t.Skip("no flock(1) on PATH")
	}
	f := filepath.Join(t.TempDir(), "l")
	holder := exec.Command("flock", "-x", f, "sh", "-c", "echo held; sleep 1")
	out, err := holder.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := holder.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := bufio.NewReader(out).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	if err := With(f, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(t0); d < 500*time.Millisecond {
		t.Fatalf("Go entered after %v while flock(1) held the lock", d)
	}
	if err := holder.Wait(); err != nil {
		t.Fatal(err)
	}
	err = With(f, func() error {
		if exec.Command("flock", "-n", f, "true").Run() == nil {
			t.Error("flock(1) entered while Go held the lock")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd core && go test ./internal/adapter/lock/`
Expected: FAIL to compile — `With` undefined.

- [ ] **Step 3: Implement**

`core/internal/adapter/lock/lock_unix.go`:
```go
//go:build !windows

// Package lock is ring L3: the exclusive lock ccd's bash takes with flock(1).
package lock

import (
	"os"
	"syscall"
)

// With holds flock(2) LOCK_EX on file for fn's length: the lock flock(1) takes, so bash and Go exclude each other.
// The file is created as flock(1) creates it (0666 less the umask); closing it releases the lock.
func With(file string, fn func() error) error {
	f, err := os.OpenFile(file, os.O_RDONLY|os.O_CREATE, 0o666)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	return fn()
}
```

`core/internal/adapter/lock/lock_windows.go`:
```go
//go:build windows

// Package lock is ring L3: the exclusive lock ccd's bash takes with flock(1).
package lock

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// With takes the lock through MSYS2's own flock binary, held as a child for fn's length: MSYS2's flock is Cygwin's
// emulation, which a native process cannot reach (the Node twin's lock, spec 2026-11-22 §4). One process per lock.
func With(file string, fn func() error) error {
	cmd := exec.Command("flock", "-x", file, "cat")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { stdin.Close(); cmd.Wait() }()
	if _, err := stdin.Write([]byte("L\n")); err != nil {
		return err
	}
	if _, err := io.ReadFull(stdout, make([]byte, 2)); err != nil {
		return fmt.Errorf("flock exited before the lock was held: %w", err)
	}
	return fn()
}
```

- [ ] **Step 4: Run to verify it passes, on Linux and on Windows**

Run (Windows, MSYS2 tools on PATH): `cd core && go test ./internal/adapter/lock/ -v`
Run (Linux bench): `<bench-script> go test ./internal/adapter/lock/ -v`
Expected: PASS on both, not SKIP.

- [ ] **Step 5: Show it goes red**

Replace `With`'s body (unix) with `return fn()`, run on Linux, see the test FAIL with `Go entered after …`; restore. Record it.

- [ ] **Step 6: Commit**

```bash
git add core/internal/adapter/lock
git commit -m "feat(core): the lock bash's flock(1) and Go both honour, raced in a test (Go core wave 1)"
```

---

### Task 4: Tests run ccd in both implementations; the Node twin goes

**Files:**
- Create: `server/test/coreBuild.ts`, `server/test/ccd-core-caps.test.ts`, `server/test/ccd-core-table.test.ts`
- Modify: `server/test/ccdTwin.ts`
- Delete: `ccd/node/` (all of it), `server/test/ccd-twin-caps.test.ts`, `server/test/ccd-twin-table.test.ts`, `server/test/ccd-twin-lock.test.ts`

**Interfaces:**
- Consumes: the binary built from `core/cmd/ccrc-core`.
- Produces: `coreBinary(): string` (absolute path of a built `ccrc-core`, with the repo's `ccd/ccd` copied to `../ccd` beside its directory so `caps` reads it as installed); `type Impl = 'bash' | 'go'`; `IMPLS`; `runImpl(h, impl, argv, extra?)`.

- [ ] **Step 1: Write `coreBuild.ts`**

```ts
// Builds ccrc-core once per test process (spec 2026-11-24 §6) and lays it out as installed: <dir>/core/ccrc-core with
// the repo's ccd body at <dir>/ccd, so a verb that reads ../ccd reads the body bash runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';

const CORE = path.resolve(__dirname, '../../core');
let built: string | undefined;

export function coreBinary(): string {
  if (built) return built;
  // Not mkTmp: that removes its directories after each FILE, and this build is cached for the whole process.
  // os.tmpdir() is the run's own ccrc-testrun-* parent (run-tmp.globalsetup.mjs), removed with the run.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-core-')));
  const exe = path.join(dir, 'core', process.platform === 'win32' ? 'ccrc-core.exe' : 'ccrc-core');
  try {
    execFileSync('go', ['build', '-o', exe, './cmd/ccrc-core'], { cwd: CORE, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CGO_ENABLED: '0' } });
  } catch (e) {
    throw new Error(`ccrc-core could not be built (is Go 1.27 on PATH?): ${String((e as { stderr?: Buffer }).stderr ?? e)}`);
  }
  fs.copyFileSync(CCD, path.join(dir, 'ccd'));
  return (built = exe);
}
```
Check in `server/test/run-tmp.globalsetup.mjs` that `os.tmpdir()` is the run's own parent in the test workers; if it is not, say so in the report and use that parent instead.

- [ ] **Step 2: Point `ccdTwin.ts` at the core**

```ts
import { spawnSync } from 'node:child_process';
import { CCD, HARNESS_BASH, type CcdHarness } from './ccdWsHelpers.js';
import { coreBinary } from './coreBuild.js';

export type Impl = 'bash' | 'go';
export const IMPLS: readonly Impl[] = ['bash', 'go'];

/** Run ccd's bash body or the Go core, the same way, on one fixture: what a parity test compares. */
export function runImpl(h: CcdHarness, impl: Impl, argv: string[], extra: NodeJS.ProcessEnv = {}) {
  const [cmd, pre] = impl === 'bash' ? [HARNESS_BASH, [CCD]] : [coreBinary(), ['ccd']];
  const r = spawnSync(cmd, [...pre, ...argv], { cwd: h.home, env: h.env(extra), encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
```

- [ ] **Step 3: Write `ccd-core-caps.test.ts`**

Copy `server/test/ccd-twin-caps.test.ts` and change it so: `runImpl(h, 'go', …)` replaces `'node'`; the expected extra lines are `go:<verb>` for the verbs `core/entries.json` puts in `go` mode on this platform (`process.platform` → `win32`→`windows`, `linux`, `darwin`), so on Linux the output is byte-identical to bash; the `describe.skipIf(process.platform === 'darwin')` stays; the two describes that imported `caps.mjs` (`run` and `capsLines`) are dropped, because Task 2's Go unit tests now cover them.

- [ ] **Step 4: Write `ccd-core-table.test.ts`**

Copy `server/test/ccd-twin-table.test.ts` and change it so the table is `core/entries.json`; the first case checks that the table's entry names equal the keys of `var verbs = map[string]func([]string, IO) int{ … }` in `core/internal/app/ccd/ccd.go` (read as text: every `"<name>": ` key inside that literal); the parity case requires `runImpl(… 'go'` and `runImpl(… 'bash'`; the owned-bash digest case is unchanged (same `shapeOf`, same error text, naming `core/entries.json`); a new case requires every `mode` to be `bash` or `go` on `linux`, `darwin` or `windows`; the import-fence case is dropped (Task 1's rings test holds `core/`).

- [ ] **Step 5: Delete the Node twin**

`git rm -r ccd/node server/test/ccd-twin-caps.test.ts server/test/ccd-twin-table.test.ts server/test/ccd-twin-lock.test.ts`. Then `git grep -n "ccd/node\|verbs.json\|caps.mjs\|lock.mjs" -- server agent ccd deploy .github` and list every hit in the report: Task 5 changes the launcher, installer, uninstall, update backup, doctor and fixtures, so leave those hits for it, but fix any other test that imported a deleted file.

- [ ] **Step 6: Run**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-core-caps.test.ts` then the same for `test/ccd-core-table.test.ts`.
Expected: PASS. Then make it red once: change `"caps"` to `"capz"` in the Go verb table, see the table test FAIL, restore.

- [ ] **Step 7: Commit**

```bash
git add -A server/test core ccd/node
git commit -m "test(core): ccd's tests run bash and the Go core; the Node twin's modules and tests go (Go core wave 1)"
```

---

### Task 5: The launcher, installer, doctor, uninstall and backup start and carry the core

**Files:**
- Modify: `ccd/ccd-entry.py`, `ccd/ccd-entry-install.py`, `ccd/ccrc` (update backup `_upd_backup_copy … ccd-node`, uninstall's twin directory), `ccd/ccrc-doctor-checks` (`_check_ccd-node-twin`), `shared/switches.ts` (`CCD_NODE_OFF_MARKER`), `server/test/entryFixture.ts`, `server/test/ccd-twin-entry.test.ts` (rename to `ccd-core-entry.test.ts`), `server/test/ccd-entry-install.test.ts`, `server/test/ccrc-doctor-fleet-box.test.ts`, `server/test/ccrc-doctorFixture.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/install-census.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-installFixture.ts`, `server/test/ccrc-updateFixture.ts`, `server/test/switches.test.ts`, `agent/test/deploy-verify.test.ts`, and any other file Task 4's grep listed.

**Interfaces:**
- Consumes: `coreBinary()` (Task 4); `core/entries.json` (Task 1).
- Produces: an installed tree `~/.local/libexec/ccrc/core/ccrc-core[.exe]`; a launcher whose rendered table is `{"verbs": [<go-mode verbs on this platform>], "files": {"ccrc-core[.exe]": "<sha256>"}}`.

Required behaviour (the twin's, re-pointed; read each function before changing it):

1. **Launcher (`ccd-entry.py`).** `TWIN_JSON`/`@CCRC_TWIN_JSON@` become `CORE_JSON`/`@CCRC_CORE_JSON@`; `TWIN_SUFFIX` becomes `/.local/libexec/ccrc/core`; `TWIN_OFF` becomes `/.cc-sessions/ccd-go-off`. A verb listed in the rendered table, not protected, with `ccd-go-off` not sending it back, starts `<core>/ccrc-core[.exe] ccd <argv>` through the existing `start()` after `check_twin` (renamed `check_core`) has verified every listed file. The platform test goes: the installer renders only this platform's go verbs, so the launcher no longer asks which platform it is on; remove `twin_platform`, `select_node`, `NODE_CODE_VARS` and the node env scrub; the Go binary loads no code from its environment, so it starts with the caller's environment unchanged (say so in the header comment). Update the header comment block ("THE NODE TWIN ON WINDOWS") to describe the core.
2. **Installer (`ccd-entry-install.py`).** `read_twin` becomes `read_core(tree, template)`: the platform is Go's names from `sys.platform` (`linux`→`linux`, `darwin`→`darwin`, `msys`/`cygwin`/`win32`→`windows`) and `platform.machine()` (`x86_64`/`AMD64`→`amd64`, `aarch64`/`arm64`→`arm64`); verbs are the entries of `core/entries.json` in `go` mode there (same rules as `kernel.GoVerbs`); the binary is `core/bin/<goos>-<goarch>/ccrc-core[.exe]` in the tree. Verbs and no binary for this platform is a refusal naming the path; no verbs means nothing is published under `core/` and the table is `{"verbs":[],"files":{}}`. A protected verb in go mode is a refusal (the twin's `is_protected` check, kept). The binary publishes to `.local/libexec/ccrc/core/` mode 0755 in the twin's staged `.t<i>` slot. A test seam lets Linux CI install as another platform: `CCRC_CORE_PLATFORM=<goos>` honoured only when the tree holds `.ccrc-test-fixture` (the twin's seam, moved from the launcher to the installer). The stale sweep runs on `core/` as the twin's did on `node/`, and the whole old `.local/libexec/ccrc/node/` is removed once the new launcher lands (a box that ran the twin).
3. **`ccd/ccrc`.** The update backup copies `~/.local/libexec/ccrc/core` instead of `…/node`; uninstall removes `core/` the way it removed `node/` (non-recursive over the known file, then `rmdir`), and still removes a leftover `node/`.
4. **Doctor.** `_check_ccd-node-twin` becomes `_check_ccd-core`, check name `ccd-core`: the launcher's self-test, then the installed binary's sha256 against the shipped tree's `core/bin/<goos>-<goarch>/` binary; a box whose table lists no go verb passes with a line saying the core is not in use here.
5. **`shared/switches.ts`.** `CCD_NODE_OFF_MARKER = 'ccd-node-off'` becomes `CCD_GO_OFF_MARKER = 'ccd-go-off'`, its row's default text saying listed verbs start the Go core; fix every reader.
6. **Fixtures.** `entryFixture.ts` and the install-tree fixtures plant `core/entries.json` and the built binary at `core/bin/<this platform>/` (from `coreBinary()`), in place of `ccd/node`; the Windows-branch tests that used `CCRC_ENTRY_TWIN_PLATFORM=1` use `CCRC_CORE_PLATFORM=windows` on the installer, with a plain executable stub for the Windows binary path where a Linux run cannot execute a Windows binary (a `#!/bin/sh` script printing a marker line is enough to prove the hand-off).

- [ ] **Step 1:** Change each renamed test first so it states the behaviour above, run it, see it FAIL.
- [ ] **Step 2:** Change the launcher and installer; run `test/ccd-core-entry.test.ts` and `test/ccd-entry-install.test.ts` until PASS.
- [ ] **Step 3:** Change `ccd/ccrc`, doctor, `shared/switches.ts` and the fixtures; run `test/ccrc-uninstall.test.ts`, `test/ccrc-doctor-fleet-box.test.ts`, `test/install-census.test.ts`, `test/switches.test.ts`, `test/ccd-entry-timing.test.ts`, `test/ccrc-install-tree.test.ts`, `test/build-release.test.ts` one at a time until PASS; in `agent/`, `./node_modules/.bin/vitest run test/deploy-verify.test.ts`.
- [ ] **Step 4:** `git grep -n "ccd/node\|ccd-node-off\|CCD_NODE_OFF\|libexec/ccrc/node\|node twin\|Node twin" -- . ':!docs'` prints only the deliberate leftover-removal lines (each named in the report).
- [ ] **Step 5:** `cd server && timeout 900 ./node_modules/.bin/tsc --noEmit -p .` and the same in `agent/` are clean.
- [ ] **Step 6: Commit**

```bash
git add -A ccd shared server agent
git commit -m "feat(ccd): the launcher starts the Go core for its go-mode verbs; installer, doctor, uninstall and backup carry it (Go core wave 1)"
```

---

### Task 6: Build and ship the binaries; CI builds and tests the core

**Files:**
- Modify: `deploy/build-release.sh`, `deploy/deploy.sh`, `.github/workflows/ci.yml`, `.github/workflows/release-main.yml`, `.github/workflows/release.yml`, `.github/ci/select-tests.mjs`, `.github/ci/reach.mjs` or `.github/ci/fast-plan.mjs` (whichever owns the path rules), and their tests under `server/test/` (`build-release.test.ts`, the CI selection tests)
- Not in the repo: the Linux bench's script, `<bench-script>` (already provided).

**Interfaces:**
- Consumes: `core/` (Tasks 1–3).
- Produces: release tarballs carrying `core/entries.json` and `core/bin/{linux-amd64,linux-arm64,darwin-amd64,darwin-arm64,windows-amd64}/ccrc-core[.exe]`; a `test (core)` CI job; `actions/setup-go` wherever a job runs Go or the server tests that build it.

Required behaviour:
1. `build-release.sh` runs, for each of the five targets, `CGO_ENABLED=0 GOOS=<os> GOARCH=<arch> go build -trimpath -ldflags "-s -w" -o <stage>/core/bin/<os>-<arch>/ccrc-core[.exe] ./cmd/ccrc-core` from `core/`, after `go vet ./...`, and refuses (exit non-zero, naming Go) when `go` is missing; the tarball's MANIFEST lists the binaries like every other file. `build-release.test.ts` asserts the five paths are in the built tree (skip only with a named reason when `go` is absent on the runner, never silently).
2. `deploy.sh` builds the target box's binary (GOOS/GOARCH from the target's `uname -s`/`uname -m`) into the pushed tree, and refuses with a named message when `go` is missing locally.
3. `ci.yml`: `actions/setup-go` (pinned by full commit SHA, as the repo pins its other actions; `go-version-file: core/go.mod`, cache on) in every job that runs server tests, plus a new job `test (core)` that runs `cd core && gofmt -l . | (! grep .) && go vet ./... && go test ./...` and the five cross-builds; it runs on every pull request that changes `core/**` and in the merge queue and daily runs. Do not add it to the required checks (the operator owns the ruleset).
4. Selection: a change under `core/**` selects `ccd-core-caps.test.ts`, `ccd-core-table.test.ts`, `ccd-core-entry.test.ts` and `ccd-entry-install.test.ts` on the fast pull-request run (add `core/` wherever `.github/ci` maps untraced paths to tests, the way `ccd/` scripts are mapped), and `reach.mjs` treats `core/` as reaching the server and agent packages. Read the CI design spec (`docs/superpowers/specs/2026-09-23-ci-test-selection-design.md`) and the scripts' own tests before changing them; run those tests.
5. `release-main.yml` and `release.yml`: `actions/setup-go` in the `build` job only (the `publish` job installs nothing — `release-job-boundary.test.ts` holds that).

- [ ] **Step 1:** Write or change the tests for items 1, 4 and 5 first; run; see them FAIL.
- [ ] **Step 2:** Implement items 1–5; run each changed test file alone until PASS (`build-release.test.ts`, `release-job-boundary.test.ts`, the selection tests).
- [ ] **Step 3:** Run `bash deploy/build-release.sh` the way `build-release.test.ts` does (read it) in a temp dir and list `core/bin/*/` in the result.
- [ ] **Step 4: Commit**

```bash
git add -A deploy .github server
git commit -m "build(core): releases carry ccrc-core for five platforms; CI sets up Go and tests the core (Go core wave 1)"
```

---

### Task 7: Docs, the architecture ruling, and the live box

**Files:**
- Create: `docs/superpowers/specs/2026-11-24-ccrc-go-core-design.md` (already written; committed by the controller before Task 1)
- Modify: `README.md` (the twin's hand-switch paragraph → the core's), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the ruling line "Allowed: ccd's Windows twin in Node" → the Go core's temporary exception, spec 2026-11-24 §2), `docs/superpowers/specs/2026-11-22-ccd-windows-node-twin-design.md` (its Status line: superseded by 2026-11-24 for everything ahead), `ccd/contexts.tsv` only if a test requires it, this plan's Results.

- [ ] **Step 1:** Make the four doc edits; run `cd server && ./node_modules/.bin/vitest run test/anchors.test.ts` and `test/deviation-refs.test.ts` and `test/dtbd.test.ts` (or the files those names map to under `server/test/`), PASS (a D-TBD line in this plan may be red under dtbd: record it in Deviations for the operator to mint, do not invent a number).
- [ ] **Step 2: Commit** `docs: the Go core replaces the Node twin (spec 2026-11-24, wave 1)`.
- [ ] **Step 3 (operator, then controller):** the operator runs the install on the live Windows box; the controller then runs a scratch measuring script (not in the tree) and `ccrc doctor` (read-only) and records in Results: `ccd caps` time through the core, the `go:caps` line, doctor's `ccd-core` line, and that `~/.local/libexec/ccrc/node` is gone.

## Deviations found

- D-TBD-go-vocab-later: the spec's §8 puts the vocabulary generator in wave 1, but no wave-1 Go code reads a
  `shared/` value (`caps` reads the body; the lock and the table read no vocabulary). A generator with no consumer is
  untested code, so it moves to wave 2, where the hook's deny rules are its first consumer. Cost if wrong: one task
  moves back.
- D-TBD-go-node-delete-t5: the Node twin's three tests go in Task 4 and `ccd/node/` itself in Task 5 with the launcher
  and installer change, so every commit stays green. Cost if wrong: nothing.
- D-TBD-go-binary-by-need: the installer places the core binary only where a verb runs in go mode (Windows today), and
  fixtures plant it only there, so Linux suites need no Go toolchain; Task 5 left build-release's tree list at
  `core/entries.json` and Task 6 added the binaries. Cost if wrong: one list adjusts; CI's Go setup covers it anyway.
- D-TBD-go-doctor-diff: doctor's `ccd-core` check compares the installed binary with the shipped one by `diff -q` and
  reads the shipped `core/entries.json`, equivalent to a digest for "is it the shipped file". Cost if wrong: a reword.
- D-TBD-go-scrub-later: the core starts with the caller's environment unchanged, though spec section 4 says Go's
  variables join the protected-verb scrub. No protected verb reaches the core in this wave (the installer refuses
  one), so the scrub lands with the first protected verb's wave. Cost: nothing until then.
- D-TBD-go-tree-core: `_inst_tree` carries `core/`, outside the brief: without it every install or update refused.
- D-TBD-go-setup-tag: `actions/setup-go` is pinned by major tag (`@v7`), the repo's convention for every action, not by
  commit SHA. Cost if wrong: a one-line change.
- D-TBD-go-buildvcs: builds use `-buildvcs=false` through one shared `core/build.sh` (three callers), so a merge never
  stamps a new commit into the binaries and cuts a release. Accepted.
- D-TBD-go-ci-setup-narrow: Go is set up only in the server shards, the trace shards and `test-macos`, the jobs that can
  be handed a ccd-core test. It must widen when an entry goes go-mode on Linux.
- D-TBD-go-owned-file-trigger: spec section 7's "a file an entry owns changes" trigger is carried by the existing
  selection, not by `test (core)`: no Go test reads outside `core/`, and an owned bash file reaches the parity tests
  through the traced map. Cost if wrong: a `ccd/ccd` change misses them on a fast PR; the queue still runs them.
- D-TBD-go-toolchain-pin: the Go toolchain is pinned by a `toolchain go1.27.4` line in `core/go.mod`, read by
  setup-go through `go-version-file`: one owner for the version, and not a dependency. Cost: a line edit per Go patch.

## Results

Wave 1 shipped the skeleton, in nine commits since the spec and plan:

- `core/`: the Go module and its multi-call `ccrc-core` entry, with a Go test that holds the ring direction
  (`kernel`, `domain`, `adapter`, `app`, `cmd`).
- `ccd caps` in Go, read from the body's own `cmd_caps`; the lock bash's `flock(1)` and Go both honour, raced in a test.
- Parity: ccd's tests run bash and the Go core through `runImpl`; the Node twin's three tests and `ccd/node/` are gone.
- The launcher starts the core for `core/entries.json`'s go-mode verbs (`caps` on Windows only), with the off switch
  `~/.cc-sessions/ccd-go-off`; the installer, doctor (`ccd-core`), uninstall and backup carry the binary.
- `core/build.sh` builds five platforms for releases and `deploy.sh`; a `test (core)` CI job runs gofmt, vet, tests and
  the cross-builds, and `actions/setup-go@v7` sets up the jobs that can run a ccd-core test.
- Not done here: the live Windows box install and its measurements (operator, then controller).
