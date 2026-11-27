# ccrc's Go core — rewriting the bash in Go

Status: design, approved by the operator on 2026-11-24 ("починай міграцію", after reviewing the architecture page of
2026-11-23). It supersedes `2026-11-22-ccd-windows-node-twin-design.md` for everything ahead: the twin's launcher
hand-off, table, lock, off switch and parity harness stay and are extended to Go; its Node modules are replaced.

Operator decisions behind it (2026-11-23 and 2026-11-24):
- rewrite the core in Go, module by module, and compare with the original;
- scope: **every bash file in the tree**; Python stays where it is;
- comparison: along the way (each module's tests run against both implementations) and at the end (the whole suite
  in Go mode, a shadow on the live box, then the switch);
- every artifact the programme publishes is bilingual.

## 1. Problem

ccrc's shell is about 130,000 lines in 84 tracked files outside the tests (measured 2026-11-23): `ccd/ccd` 49,384
lines (57 `cmd_*`, 1,015 functions in `ccd/contexts.tsv`), `ccd/ccrc` 30,647 (25 `cmd_*`), `ccd/ccrc-doctor-checks`
12,352, `ccd/session-hook.sh` 6,726, about 21,000 in sibling scripts and `ccd/lib/*.sh`, and about 5,800 in `deploy/`,
`install.sh` and `win/bin`.

On Windows all of it runs under MSYS2's emulated `fork()`: `ccd caps` took about 27 s on the live box, one hook call
3.7 s at the median against 31 ms on Linux. On every platform bash is a second language beside the server's
TypeScript, and the vocabulary in `shared/` is mirrored into bash strings by hand.

A stack study on 2026-11-23 measured bash, Node, Python, Go and Rust on five of ccd's own workloads with
byte-identical output. Go was the fastest stack that cross-compiles to one static binary per platform with no
runtime: on Linux the hook workload took 2.7 ms in Go against 6.7 ms in bash and 20.8 ms in Node; on a loaded Windows
box its fastest run took 80 ms in Go against at least 1,789 ms in bash.

## 2. Decision

All of ccrc's bash is rewritten in Go, in a module `core/` that builds **one binary, `ccrc-core`, per platform**. Each
bash entry point keeps working until its Go replacement has passed the comparison, then switches; when every entry
point has switched on every platform, the bash is deleted and MSYS2 stops being a Windows prerequisite.

**The ruling.** While an entry point has two implementations, its rules exist twice. That is an exception to
"Rejected: compiling policy across languages" (2026-10-19), bounded by the parity tests (§6), and it ends for each
entry point when its bash is deleted. At the end the rule holds better than today: logic only in Go, the vocabulary
only in TypeScript, derived into Go rather than mirrored. The architecture spec's ruling list records this, replacing
the twin's "permanent Windows twin" line.

## 3. The module

```
core/
  go.mod                  module ccrc/core, go 1.27, standard library only
  entries.json            entry point -> mode per platform, owned bash functions, tests (§4)
  cmd/ccrc-core/main.go   L5: wires the adapters, dispatches the entry point to app/
  internal/
    kernel/               L0: exit codes, atomic writes, errors, text helpers
      vocab/vocab_gen.go  L0: generated from its owners, never edited by hand (§5)
    domain/<context>/     L1 pure deciders + L2 ports, one package per bounded context:
                          registry (C1), mutation (C2), conversation (C3), workspace (C4), coord (C5),
                          attention (C6), update (C7), auth (C8), docs (C9), sessionhost (C10), operator (C11)
    adapter/<name>/       L3: regfs, lock, tmux, git, units (systemctl / the Windows manager's shim),
                          claudefs (Claude Code's on-disk layout), procs (/proc, Windows toolhelp)
    app/<entry>/          L4: one file per entry point: argv -> decision -> acts -> output and exit code
  gen/vocab.mjs           the vocabulary generator
```

- **Multi-call.** The entry point is the first argument (`ccrc-core ccd ws-add …`, `ccrc-core ccrc doctor`,
  `ccrc-core hook`, `ccrc-core sweep scope`) or the basename it was started under. One binary means one checksum for
  the launcher and one build per platform. The hook takes no event argument: the event is stdin's `hook_event_name`,
  as the bash hook reads it, so one registered command serves every event.
- **Contexts.** A bash function's package is the context `ccd/contexts.tsv` already gives it. K functions go to
  `kernel/` or the adapter that names their resource.
- **Rings.** L0 imports nothing from `internal/` and no `os/exec`; L1 imports no `os`, `os/exec`, `net` or `time.Now`
  (time is a parameter); ports are interfaces declared by the consuming domain package with their failure contract
  (absent, unreadable and over-cap stay distinct); adapters are the only code that names tmux, systemd, the registry
  layout or Claude Code's files, and never narrow a distinction they receive; `app/` decides nothing. A Go test reads
  `go list -deps -json ./...` and goes red on an import that points outward.
- **Dependencies.** The standard library only. A third-party module is a decision of its own, with its reason.
- **One process per call**, as now. No daemon.

## 4. The table and the launcher

The twin's table moves to `core/entries.json` and keeps its three readers (the launcher, the parity guard, `ccd
caps`). Each entry names its bash functions (`owns`, with the twin's shape digest), its test files, and a `mode` per
platform, `bash` or `go`; an entry or platform it does not name is `bash`.

The installed launcher `ccd-entry.py` (the twin's hand-off, extended): it checks the binary's digest as it checks the
bash body's, and starts `ccrc-core` for an entry whose mode on this platform is `go`, with the protected-verb
environment scrubbed (the twin's rule, now for Go's variables too); otherwise bash, as today. The twin's rule
"Windows only" becomes "follow the mode". The off switch `$REG/ccd-go-off` (the twin's `ccd-node-off`, renamed) sends
every entry, or the named ones, back to bash, and still has no writer in the tree.

`ccrc` and the sibling scripts gain the same lookup in their installed entries as their waves arrive. **The hook** is
started by Claude Code from each home's `settings.json` (`HOOK_CMD` in `install-session-hooks.sh`), so its mode is
applied by that installer: in `go` it registers `ccrc-core hook` (one command, no event argument), otherwise the bash
hook. Its table row (`hook`) owns the whole file (`ownsDigest: "file"`), since its arms are top-level statements, not
functions.

A failing Go run fails with its own code; nothing retries it in bash.

## 5. One vocabulary

Each value's owner stays its owner, wherever it lives (`shared/*.ts`, `shared/*.mjs`, or a named server module such as
`server/src/coord/approvalguard.ts`), and the generator reads the value there, never from a copy. `core/gen/vocab.mjs`
runs the server's own TypeScript compiler as a process (`tsc`, by path: TypeScript 7 has no in-process transpile, and
the repository allows one importer of a TypeScript parser, `server/test/scan/parse.ts`) to emit the owners into a
temporary directory, imports the named exports, and writes `core/internal/kernel/vocab/vocab_gen.go`. A server test
(`server/test/vocab-gen.test.ts`) regenerates it and fails when the committed file differs (as `themes:check` does for
the palettes). The generator's export list grows wave by wave; a value it does not take (a function, a value with no
single export) is listed in its header with the reason. A Go module never spells an owner's value by hand, and
`single-definition` covers `core/`.

## 6. Data, locks and comparison

- **Same files, same bytes.** Go reads and writes `~/.cc-sessions`, `~/.cc-limits`, `.prhistory`, `.cc-clips` and
  `~/.ccrc/*` in exactly bash's formats and adds none; an atomic write is a temp file and a rename, as in bash.
- **Locks.** On Linux and macOS Go takes `flock(2)`, the lock `flock(1)` takes for bash, so the two exclude each other.
  On Windows, while bash lives, Go takes the lock through MSYS2's `flock` binary held as a child (the twin's lock);
  after bash is removed, `LockFileEx`. Wave 1's first test races bash against Go for one lock.
- **Along the way.** The twin's parity harness, `runImpl(h, 'bash' | 'go', argv)` on one fixture HOME, runs an entry
  in either implementation, with the binary built once per test process; every entry's tests run in both modes in
  Linux CI, and the launcher's own choice is tested apart. Tests that call
  bash functions directly are rewritten, before their entry moves, as characterization tests of the Go module, green on
  bash first. Guard tests that read bash as text (`ccd-limit-no-keys`, `ccd-contexts`, the `single-definition` scans,
  the hook's deny arm) get Go equivalents that go red when deleted, before their entry switches.
- **At the end.** The whole suite in Go mode; on the live box a shadow for reads (the launcher answers from bash, runs
  Go beside it, and logs only hashes and durations to `~/.ccrc/ccd-shadow.log` while `$REG/ccd-shadow` stands, a
  marker with no writer in the tree) and, for writing entries, a week on one box in `go` mode with the off switch armed.
  Then the switch, then the removal.
- **A port reproduces the bash**, defects included. A fix is its own change after the switch, with its own test.

## 7. Build and release

- `build-release.sh` cross-compiles `ccrc-core` with `CGO_ENABLED=0` for linux-amd64, linux-arm64, darwin-amd64,
  darwin-arm64 and windows-amd64 into `core/bin/<goos>-<goarch>/`; the installer places its own platform's binary in
  `~/.local/libexec/ccrc/core/` and renders its digest into the launcher. `deploy.sh` builds the target's binary
  locally, so it needs Go on the deploying machine. No box needs Go to run ccrc.
- CI gains `actions/setup-go` with `go.mod`'s version and a `test (core)` job: `go vet`, `go test ./...`, the rings
  test and the five cross-builds, run on the fast pull-request run whenever `core/**` or a file an entry owns changes.
  It is not a required check until the operator adds it to the ruleset.

## 8. Waves

| # | What | Bash size |
|---|---|---|
| 1 | Skeleton: module, multi-call, rings test, lock, the launcher's mode, the harness's `CCD_IMPL`, the CI job, release build; `ccd caps` in Go replaces the Node twin's caps, and `ccd/node/` is removed | — |
| 2 | The vocabulary generator (§5), with its first consumer: the session hook | 6,726 |
| 3 | Every-minute passes: `limit-watchdog`, `ccd-scope-sweep`, `ccrc watchdog` | ~2,000 |
| 4 | The server tick's reads: `ls`, state | ~3,000 |
| 5 | C3, C6, C9 | ~160 fn |
| 6 | C1: registry, accounts, pools, swap | 268 fn |
| 7 | C5, C7, C8, C11 | ~20 fn |
| 8 | C4: `ws-*`, `pr-*`, reclaim, expire, collect, lease | 458 fn |
| 9 | C10 and C2: start, supervise, attach | 92 fn |
| 10 | `ccrc` and doctor | 43,000 |
| 11 | Sibling sweeps, installers, `deploy/`, the `win/bin` shims | ~26,000 |
| 12 | Final comparison, the switch, removal of bash and MSYS2 | -130,000 |

Each wave has its own plan, closes with its tests green in both modes, and on Windows with the live box's timings
taken again. Targets on a healthy Windows box (the twin's): the hook under 300 ms per call, the server tick under 3 s,
each every-minute timer under 2 s.

## 9. Out of scope

- Python code.
- Changing behaviour while porting it.
- A daemon or resident process.
- WSL as a way to run ccrc on Windows.
