# Stage 2b — The Box Answers For Itself: the `ccrc` CLI and `ccrc doctor` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `ccrc` lifecycle CLI's first two verbs — `doctor` and `status` — so that a box can state what it is, what it is missing, and whether it agrees with the other box, without a human reading five files by hand. This is the diagnostic instrument every later stage is verified WITH, so it is built before the installer that would be verified BY it.

**Architecture:** `ccd/ccrc` is a new bash executable, sibling to `ccd` and modelled on it (same `set -uo pipefail`, `die`, `cmd_<verb>` + terminal `case` dispatch). It is a THIN lifecycle tool: it measures and reports, it does not manage sessions — that stays `ccd`'s job, and the split exists because the updater must live outside the thing it replaces. The existing `ccd/ccrc-adopt` becomes `ccrc adopt`, its only behavioural change being where it is dispatched from. `ccrc doctor` runs a list of independent CHECKS, each of which returns a verdict plus a named remedy; the check list is data, so a new check is one table entry and one test. Version skew across boxes needs a fact that is not on the wire today: `AgentReady` gains an optional `build` field, additive and absence-permitting, using the identical single-reader discipline `rosterFp` established in PR #46.

**Tech Stack:** bash 5, TypeScript (Node `>=22.13.0`, ESM), vitest, Fastify, systemd --user.

## Global Constraints

- **Wire discipline — additive only.** `FLEET_PROTO` stays 1. `AgentReady.build` is optional; a newer server MUST tolerate an older agent omitting it, through a SINGLE reader. Model it on `rosterFp` (`shared/agent-protocol.ts:36`, `agent/src/server.ts` `readRosterFp`, `server/src/remote/client.ts` `onReady`).
- **No overloaded null at a seam.** "No build reported" (older agent, unstamped box) and "builds disagree" are conditions the operator acts on differently. Three states, never two — the precedent is `RosterAgreement` (`server/src/fleetstate.ts`).
- **Single source of truth.** The node floor is declared once and READ, never re-typed: doctor reads `engines.node` from the shipped `package.json`. `server/test/single-definition.test.ts` text-scans four source roots and fails the build on a second copy.
- **Mutation-table discipline.** Every check ships with a test that goes RED when the check is deleted or inverted, measured before and after — not asserted in a comment. "A comment is a request; a red suite is a mechanism."
- **Fixture HOMEs only.** `HOME` is the single isolation boundary the whole ccd suite relies on. Use `makeCcdHarness` (`server/test/ccdWsHelpers.ts`); never run `ccrc` against the live `$HOME` in a test. `ghContainedEnv()` plants a poisoned `gh` on PATH — doctor calls `gh auth status`, so its tests MUST use it.
- **`ccrc` never mutates in this stage.** `doctor` and `status` are read-only verbs. `install`, `update`, `passwd` and `uninstall` are later stages; a read-only tool is what makes it safe to ship to a live two-box fleet mid-programme.
- **`~/.ccrc/accounts.json` is user-owned.** ccrc creates it once and never overwrites it. Doctor REPORTS drift; it does not repair it.
- **Ring discipline.** `shared/` imports nothing. Adapters may not narrow a distinction they received. Delivery (`server/src/server.ts`, routes) owns transport but never DECIDES — the agreement decision is a pure function, like `rosterAgreement`.
- **Deviation ledger:** the global `D-N` counter stands at **D-68**. New deviations in this plan start at **D-69** and are recorded in `## Deviations found`.
- **Agent-first deploy.** This plan touches `ccd/`. Anything shipped here goes to the fleet host before the server.

## File Structure

| File | Responsibility |
|---|---|
| `ccd/ccrc` (create) | The lifecycle CLI. Dispatch, `version`, `help`, `doctor`, `status`, `adopt`. Bash, mode 755. |
| `ccd/ccrc-doctor-checks` (create) | The check table + each check's implementation, sourced by `ccrc`. Split from dispatch so a check is testable without the CLI's argument surface. |
| `ccd/ccrc-adopt` (modify) | Unchanged behaviour; gains a guard that it is invoked through `ccrc adopt`. |
| `shared/agent-protocol.ts` (modify) | `AgentReady` gains optional `build`. |
| `shared/api.ts` (modify) | `FleetHealth` gains optional `build` skew answer. |
| `agent/src/server.ts` (modify) | Reads its own `~/.ccrc/build.json` and reports it on the authenticated `ready` path. |
| `server/src/fleetstate.ts` (modify) | `FleetState.build` (required field, so every construction site answers) + `buildAgreement()` pure decision. |
| `server/src/remote/client.ts` (modify) | The single reader of `frame.build`. |
| `server/src/server.ts` (modify) | `/api/fleet/health` reports the skew answer. |
| `deploy/deploy.sh` (modify) | Installs `ccrc` + its check library on BOTH lanes. |
| `server/test/ccrc-cli.test.ts` (create) | Dispatch, usage, exit codes, `version`. |
| `server/test/ccrc-doctor.test.ts` (create) | Every check, each with its deletion-mutation proof. |
| `server/test/fleet-build-skew.test.ts` (create) | The three-state agreement decision + wire absence-permits. |

---

## Deviations found

*(D-69 onward; append as implementation discovers them.)*

- **D-69 — the roster does not describe the box it came from.** `~/.ccrc/accounts.json` on the fleet host declares `claude-corp` as `{"kind":"generated"}` with no `secretsFile`, while the live `~/.local/bin/claude-corp` sources `.cc-secrets/claude-corp-oauth.env` (present, 461 bytes, mtime 2026-08-15 15:33 — actively rotating). `deploy/accounts.migration.json` carries the same omission. `exec.secretsFile` has no runtime consumer today, so nothing has ever noticed. The first generator to write wrappers from this roster silently drops that account's auth line. Doctor's roster/wrapper coherence check (Task 5) is what finds it; the data fix is Task 6. **The live box's `accounts.json` is user-owned — a human edits it, not a deploy.**

---

## Task 1: `ccd/ccrc` — dispatch skeleton, `version`, and usage

**Files:**
- Create: `ccd/ccrc`, `server/test/ccrc-cli.test.ts`

**Interfaces:**
- Produces: the `cmd_<verb>` + terminal `case` dispatch every later verb hangs off; `_ccrc_die`, `_ccrc_say` helpers.

- [ ] **Step 1: Write the failing test**

Use `makeCcdHarness` for the fixture HOME. Assert, against the real script:

Harness: `mkTmp` + the `runCcrcRaw`/`runCcrc` pair, copied from `server/test/adopt.test.ts:33-44` — NOT `makeCcdHarness`, for the same reason adopt does not use it: these tests hand-build `~/.local/bin`, which is the thing under test. Use `makeCcdHarness` only where a populated fleet HOME (registry, roster, gh poison) is needed.

```ts
it('prints usage on stderr and exits 2 on an unknown verb', () => {
  // Exit 2 is the house code for a USAGE error, distinct from 1 = the tool ran
  // and the answer was bad. Both ccrc-adopt (:68-91) and verify-service.sh
  // (:50-54) use it; doctor needs 1 free to mean "checks failed".
  const r = runCcrcRaw(home, ['wat']);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/^ccrc: unknown argument: wat/m);
  expect(r.stderr).toMatch(/usage: ccrc/);
});

it('-h prints usage on STDOUT and exits 0 — asking for help is not an error', () => {
  const r = runCcrcRaw(home, ['-h']);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/usage: ccrc/);
});

it('version reports the build stamp, and says "unstamped" at exit 0 when there is none', () => {
  expect(runCcrc(home, ['version']).stdout).toMatch(/unstamped/);
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
  expect(runCcrc(home, ['version']).stdout).toContain('abc123');
});

it('refuses a stamp that exists but does not parse, rather than printing a version nobody measured', () => {
  writeFileSync(join(home, '.ccrc', 'build.json'), 'not json');
  const r = runCcrcRaw(home, ['version']);
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^ccrc: build stamp unreadable/m);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts`
Expected: FAIL — `ccd/ccrc` does not exist.

- [ ] **Step 3: Implement**

Follow **`ccd/ccrc-adopt`'s** argument idiom, not `ccd`'s — adopt is the newer and better model, and it is the only one in the repo with a real `usage()` and `-h/--help`:

- `#!/usr/bin/env bash` exactly (never `#!/bin/bash`), then the long caps-sectioned header, then the `set` line — house order, per `deploy/verify-service.sh:1-46` and `ccd/ccrc-adopt:1-49`.
- `set -uo pipefail`, **not** `-euo`. `ccrc-adopt` uses `-e`, but doctor's checks signal by RETURNING non-zero, and `-e` would abort the run on the first failing check — which is precisely the run the operator needs to see whole. State this in the header so nobody "fixes" it later.
- `PROG=ccrc`; every diagnostic on stderr prefixed `$PROG: `, with adopt's three registers (`note:`, bare refusal, and here also `remedy:`). The RESULT goes to stdout.
- Flag parsing supports both `--flag value` and `--flag=value`; `-h|--help` → usage on stdout, exit 0; unknown → message + usage on stderr, exit 2.
- A terminal `case` for verbs, guarded by `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` so tests can `source` the script without executing it (`ccd/ccd:8578`).

Reuse `cmd_version`'s three-way discipline from `ccd/ccd:1946-1969` — absent stamp → "unstamped" at exit 0; parses → the facts; present-but-garbage → die — but do NOT copy the body. Task 8 extends `single-definition.test.ts` to pin one bash reader of the stamp.

Do NOT copy `ccd/ccd:2`'s `# ccrc:generated 1 sha256=…` line into this file by imitation. That marker is `shared/mark.mjs`'s format for GENERATED files; `ccd` carries it spuriously and `ccrc` is hand-written.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ccd/ccrc server/test/ccrc-cli.test.ts
git commit -m "feat(ccrc): the lifecycle CLI gets a dispatch, a usage line and a version"
```

---

## Task 2: `AgentReady.build` — the fleet host's build stamp reaches the server

**Files:**
- Modify: `shared/agent-protocol.ts`, `agent/src/server.ts`
- Test: `agent/test/build-fp.test.ts` (create)

**Interfaces:**
- Consumes: `~/.ccrc/build.json` on the agent's box, via the existing `BuildInfo` shape (`server/src/buildinfo.ts`).
- Produces: `AgentReady.build?: { sha: string; ref: string; builtAt: string; dirty: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
it('reports its own build stamp on the authenticated ready frame', async () => {
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha: 'deadbeef', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
  const frame = await connectAndReadReady(home);
  expect(frame.build?.sha).toBe('deadbeef');
});

it('omits the field entirely when the box carries no stamp — absence is not a lie', async () => {
  const frame = await connectAndReadReady(homeWithNoStamp);
  expect('build' in frame).toBe(false);
});

it('omits the field when the stamp is unparseable, rather than forwarding garbage', async () => {
  writeFileSync(join(home, '.ccrc', 'build.json'), '{');
  const frame = await connectAndReadReady(home);
  expect('build' in frame).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/build-fp.test.ts`
Expected: FAIL — no `build` on the frame.

- [ ] **Step 3: Implement**

Mirror `readRosterFp` exactly: a `readBuildInfo(home)` that returns the parsed stamp or `undefined`, read fresh per connection, and a `send` that omits the key when `undefined` rather than sending `build: undefined`. Widen the agent's `OutMsg` ready member. Do NOT bump `FLEET_PROTO`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent && ./node_modules/.bin/vitest run test/build-fp.test.ts && ./node_modules/.bin/vitest run`
Expected: PASS, whole agent suite green.

- [ ] **Step 5: Commit**

```bash
git add shared/agent-protocol.ts agent/src/server.ts agent/test/build-fp.test.ts
git commit -m "feat(agent): the ready frame carries the box's own build stamp"
```

---

## Task 3: `buildAgreement` — the three-state skew decision, and `/api/fleet/health` reports it

**Files:**
- Modify: `server/src/fleetstate.ts`, `server/src/remote/client.ts`, `server/src/server.ts`, `shared/api.ts`
- Test: `server/test/fleet-build-skew.test.ts` (create)

**Interfaces:**
- Consumes: `AgentReady.build` (Task 2).
- Produces: `export type BuildAgreement = 'agreed' | 'skewed' | 'unknown'` and `buildAgreement(fleet, own)`, alongside the existing `rosterAgreement`.

- [ ] **Step 1: Write the failing test**

```ts
it('is unknown when the agent reported nothing — an older agent is not a skewed one', () => {
  expect(buildAgreement(null, OWN)).toBe('unknown');
  expect(buildAgreement(undefined, OWN)).toBe('unknown');
});

it('compares the sha, and a dirty build never agrees even at the same sha', () => {
  expect(buildAgreement({ ...OWN }, OWN)).toBe('agreed');
  expect(buildAgreement({ ...OWN, sha: 'other' }, OWN)).toBe('skewed');
  expect(buildAgreement({ ...OWN, dirty: true }, OWN)).toBe('skewed');
});
```

Plus a route test asserting `/api/fleet/health` reports `build: 'agreed'` in remote mode with a matching agent, and that `FleetState.build` being REQUIRED forces every construction site to answer (the compile is the enumeration — same technique that surfaced 50 sites when `rosterFp` landed).

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet-build-skew.test.ts`
Expected: FAIL — `buildAgreement` is not exported.

- [ ] **Step 3: Implement**

`FleetState.build: BuildInfo | null` (required field, `null` = no evidence). `client.ts` is the SINGLE reader of `frame.build`. `server.ts` compares against its own `~/.ccrc/build.json` via the existing `buildinfo.ts` loader. `FleetHealth.build?: BuildAgreement` — optional on the wire so an older server's response still parses. Document in the docstring, as `rosterAgreement` does, that `'skewed'` includes the dirty case and that the remedy is "deploy the lagging box", agent-first.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run` (full suite — the required field touches many construction sites)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src shared/api.ts server/test/fleet-build-skew.test.ts
git commit -m "feat(server): the two boxes' builds are compared, and disagreement has a name"
```

---

## Task 4: `ccrc doctor` — the prerequisite checks

**Files:**
- Create: `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`
- Modify: `ccd/ccrc`

**Interfaces:**
- Produces: `_check_<name>` functions returning 0 = pass, 1 = fail, 2 = warn; each prints one line `<status> <name>: <detail>` and, on non-pass, a `  remedy: <what to do>` line.

- [ ] **Step 1: Write the failing test**

One test per check, each proving the check goes RED when its subject is removed from the fixture HOME. Checks in this task: node satisfies `engines.node` READ FROM the shipped `package.json`; `tmux`, `git`, `gh`, `jq`, `python3`, `flock` on PATH; `gh auth status` succeeds with repo scope; `git config user.email` set; `loginctl` linger enabled.

Three constraints the recon turned up, each of which changes how a check is written:

- **Which `package.json` is canonical depends on the box.** `deploy.sh:276` rsyncs `agent shared deploy ccd` to the fleet host and `:525` rsyncs `server shared deploy` to the server, so the shipped copy is `~/ccrc/agent/package.json` on a fleet box and `~/ccrc/server/package.json` on a server box; `pwa/package.json` never ships at all. Resolve it relative to the script the way `ccd/ccrc-adopt:103-104` does (`HERE="$(cd "$(dirname "$0")" && pwd)"`), try both, and cite `server/test/node-floor.test.ts:46-51` — which asserts all three declarations are byte-identical — as the reason either answer is the same answer. Parse with `node-floor.test.ts:35-42`'s exact rule: accept only `/^>=(\d+)\.(\d+)\.(\d+)$/` and **fail loudly on any other range form** rather than accept a floor the parser did not understand.
- **`gh auth status` is deliberately never called anywhere in ccd** (`ccd/ccd:707-715`: it classifies gh's *stderr* instead, because "`gh auth status` is NOT probed first: it is another network call on the unhappy path"). Doctor may call it — doctor IS the cold path, and the spec asks for it — but the check must say so in a comment, so the next reader does not "harmonise" the two and put a network call back on ccd's hot path.
- **`loginctl` linger has no implementation anywhere in the repo today** — it is prose in three planning documents and nothing else. This check is net-new, not a relocation.

```ts
it('reads the node floor from package.json rather than carrying its own copy', () => {
  // The floor moves in ONE place. Mutate the shipped package.json's engines
  // pin in the fixture and the check must move with it.
  writePkg(home, { engines: { node: '>=99.0.0' } });
  expect(runCcrcRaw(home, ['doctor']).stdout).toMatch(/FAIL node: .*99\.0\.0/);
});

it('refuses a range form it does not understand instead of guessing a floor', () => {
  writePkg(home, { engines: { node: '^22 || >=24' } });
  const r = runCcrcRaw(home, ['doctor']);
  expect(r.stdout).toMatch(/FAIL node: unrecognised engines range/);
});

it('names a remedy for EVERY failing check — a check with no remedy is a complaint', () => {
  // Asserted per FAIL line, not once over the whole output: a single stray
  // "remedy:" anywhere would satisfy the weaker form while nine checks
  // shipped without one.
  const lines = runCcrcRaw(brokenHome, ['doctor']).stdout.split('\n');
  const fails = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('FAIL'));
  expect(fails.length, 'the broken fixture must actually fail something').toBeGreaterThan(0);
  for (const [line, i] of fails)
    expect(lines[i + 1], `no remedy after: ${line}`).toMatch(/^ {2}remedy: \S/);
});

it('exits 1 when any check fails and 0 when every check passes or warns', () => {
  expect(runCcrcRaw(brokenHome, ['doctor']).code).toBe(1);
  expect(runCcrcRaw(healthyHome, ['doctor']).code).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts`
Expected: FAIL — no `doctor` verb.

- [ ] **Step 3: Implement**

The check table is data: a bash array of check names, iterated. `doctor` exits 0 when every check passes or warns, 1 when any fails. Print a summary count last.

- [ ] **Step 4: Run to verify it passes, then run against this box**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
bash ccd/ccrc doctor            # the real box — read-only, safe
```

- [ ] **Step 5: Commit**

```bash
git add ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "feat(ccrc): doctor checks the prerequisites, each with a named remedy"
```

---

## Task 5: `ccrc doctor` — roster and wrapper coherence

**Files:**
- Modify: `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Consumes: `~/.ccrc/accounts.sh` (the generated projection) and `~/.local/bin/<id>`.

This is the check that finds **D-69**. It is deliberately stronger than the spec's "wrappers present and executable": presence was never the failure mode.

- [ ] **Step 1: Write the failing test**

```ts
it('fails when a generated account declares no secretsFile but its wrapper sources one', () => {
  // D-69, reproduced as a fixture: the exact live shape on the fleet host.
  writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
  writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);   // no secretsFile
  const r = runCcrcRaw(home, ['doctor']);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
  expect(r.stdout).toMatch(/sources \.cc-secrets\/acct-a\.env.*roster declares none/);
});

it('fails the other direction too — the roster declares a secretsFile the wrapper does not source', () => {
  writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });                       // no secrets line
  writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' } }]);
  expect(runCcrcRaw(home, ['doctor']).stdout).toMatch(/FAIL wrappers: acct-a/);
});

it('fails when a roster account has no wrapper at all', () => {
  writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
  const r = runCcrcRaw(home, ['doctor']);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/FAIL wrappers: ghost .*no executable at \$HOME\/\.local\/bin\/ghost/);
});

it('fails when the wrapper points at a config dir the roster does not declare', () => {
  writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
  writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
  expect(runCcrcRaw(home, ['doctor']).stdout).toMatch(/FAIL wrappers: acct-a/);
});

it('leaves an external account alone — ccrc records it and never touches it', () => {
  // `gpt` on the reference box is a symlink to a bespoke script. It has no
  // generated shape and must not be reported as broken for lacking one.
  writeSymlinkWrapper(home, 'ext-a', 'bespoke-tool');
  writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
  expect(runCcrcRaw(home, ['doctor']).stdout).not.toMatch(/ext-a/);
});

it('passes when the upstream account is a non-script binary, which is its normal shape', () => {
  writeBinary(home, 'up');                       // real claude is a 300MB ELF
  writeRoster(home, [{ id: 'up', exec: { kind: 'upstream' } }]);
  expect(runCcrcRaw(home, ['doctor']).stdout).not.toMatch(/FAIL wrappers/);
});
it('does not read, print, or hash the contents of any secrets file', () => {
  // The check compares PATHS. Reading the token would put it in a log.
  expect(readFileSync('ccd/ccrc-doctor-checks', 'utf8')).not.toMatch(/cat .*cc-secrets|\$\(<.*cc-secrets/);
});
```

- [ ] **Step 2: Run to verify it fails** — same command as Task 4.

- [ ] **Step 3: Implement**

Reuse two things from `ccd/ccrc-adopt` rather than writing them again:

- **`parse_shape()`** (`:185-285`) — the wrapper-shape contract. Note its technique, which the check must preserve: each line is validated by stripping the known literal prefix/suffix, RECONSTRUCTING the expected line and comparing whole strings — chosen over regex capture (`:209-217`) because a regex with two occurrences of the same path silently accepts a mismatched pair. That is exactly the class of bug this check exists to catch.
- **`cross_check()`** (`:439-453`) — a generic both-directions set-difference reporter. Roster-vs-disk is precisely that shape, and adopt's rule applies unchanged: report the disagreement, never resolve it.

Extraction, not duplication: lift both into a file both scripts source. `single-definition.test.ts` (Task 8) pins that `parse_shape` has one definition — a second copy of the wrapper contract is how the generator and the checker would drift, which would make the check worse than useless.

Compare PATHS only; never open a secrets file. Follow adopt's bias rule (`:32-39`): anything ambiguous is reported, not silently passed.

- [ ] **Step 4: Run to verify it passes, then run against this box**

```bash
bash ccd/ccrc doctor
# EXPECTED on the fleet host TODAY: FAIL wrappers: claude-corp — this is D-69,
# a real finding, and Task 6 is its fix. Do not "fix" it by weakening the check.
```

- [ ] **Step 5: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "feat(ccrc): doctor notices a wrapper the roster does not describe (D-69)"
```

---

## Task 6: Fix D-69 — the shipped roster describes claude-corp's secrets file

**Files:**
- Modify: `deploy/accounts.migration.json`
- Test: `server/test/gen-accounts.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('every generated account in the shipped migration roster declares the secretsFile its box uses', () => {
  const roster = JSON.parse(readFileSync('deploy/accounts.migration.json', 'utf8'));
  const corp = roster.accounts.find((a: any) => a.id === 'claude-corp');
  expect(corp.exec.secretsFile).toBe('.cc-secrets/claude-corp-oauth.env');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`
Expected: FAIL — `secretsFile` is undefined.

- [ ] **Step 3: Implement**

Add `"secretsFile": ".cc-secrets/claude-corp-oauth.env"` to `claude-corp`'s `exec` block. Verify the generated projection's fingerprint changes as expected and that `roster.test.ts` still passes.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run`

**The live box's `~/.ccrc/accounts.json` is USER-OWNED and is NOT changed by this task or by any deploy.** Report to the operator that it needs the same one-line edit by hand; `ccrc doctor` will keep reporting FAIL on that box until they make it. Do not edit it from an agent session.

- [ ] **Step 5: Commit**

```bash
git add deploy/accounts.migration.json server/test/gen-accounts.test.ts
git commit -m "fix(roster): claude-corp declares the secrets file its wrapper has always sourced (D-69)"
```

---

## Task 7: `ccrc status` and the cross-box matched-set check

**Files:**
- Modify: `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`

- [ ] **Step 1: Write the failing test**

`ccrc status` prints: this box's role, its build stamp, service states, session count, and — when a server is reachable — the `build` and `roster` answers from `/api/fleet/health`. The doctor check consumes the same route and FAILS on `'skewed'`, WARNS on `'unknown'`, passes on `'agreed'`.

`stubHealth` writes a canned JSON body and points the check at it through a stub `curl` on PATH — the same containment technique `ghContainedEnv` uses, and for the same reason: a doctor test must never reach the live server.

```ts
it('fails the matched-set check when the server reports a skewed build', () => {
  stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
  const r = runCcrcRaw(home, ['doctor']);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/FAIL fleet: the two boxes are running different builds/);
  expect(r.stdout).toMatch(/remedy: .*deploy the lagging box.*agent first/i);
});

it('only warns on unknown — an older agent is not a broken fleet', () => {
  stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'unknown' });
  const r = runCcrcRaw(home, ['doctor']);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/WARN fleet:/);
});

it('skips the check entirely in local mode — one box cannot disagree with itself', () => {
  stubHealth(home, { mode: 'local', connected: true });
  expect(runCcrcRaw(home, ['doctor']).stdout).not.toMatch(/fleet:/);
});

it('warns rather than fails when the server is unreachable — that is a different problem', () => {
  stubHealthUnreachable(home);
  expect(runCcrcRaw(home, ['doctor']).code).toBe(0);
});

it('status prints both boxes and their shas', () => {
  stubHealth(home, { mode: 'remote', connected: true, build: 'agreed', roster: 'agreed' });
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
  const out = runCcrc(home, ['status']).stdout;
  expect(out).toMatch(/build: +abc123 \(main\)/);
  expect(out).toMatch(/fleet: +agreed/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts`
Expected: FAIL — no `status` verb, no fleet check.

- [ ] **Step 3: Implement**

`status` is read-only and prints facts, one per line. The fleet check reads `/api/fleet/health` from `CCRC_ADDR`'s configured value; when there is no server to ask (local mode) it is SKIPPED, not passed — a check that silently passes when it did not run is the overloaded-null failure this codebase bans.

- [ ] **Step 4: Run to verify it passes, then run against this box**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
bash ccd/ccrc status
# Expected today: both boxes at the same sha, fleet: agreed.
```

- [ ] **Step 5: Commit**

```bash
git add ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "feat(ccrc): status answers for both boxes, and doctor fails on a skewed fleet"
```

---

## Task 8: Deploy ships `ccrc`, and `ccrc adopt` replaces the loose script

**Files:**
- Modify: `deploy/deploy.sh`, `ccd/ccrc`, `ccd/ccrc-adopt`
- Test: `agent/test/deploy-verify.test.ts` (extend), `server/test/single-definition.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

`deploy-verify` asserts BOTH lanes `install_atomic` `ccd/ccrc` → `.local/bin/ccrc` 755 and the check library beside it, and that they land in the same ordering class as `ccd` (after the roster, before the restart). `single-definition` asserts the build stamp has exactly one bash reader.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add the `install_atomic` calls to each lane (`ccd/ccrc` → `.local/bin/ccrc` 755, plus the check library and the extracted shape/cross-check library). Place them in the same ordering class as `ccd`: after the roster lands, before the restart.

**`ccrc adopt` cannot simply exec `ccrc-adopt` on an installed box, and this is the task's one real design decision.** `ccrc-adopt` self-validates by piping its output through `node "$HERE/../deploy/gen-accounts.mjs"` (`:496-514`), so it needs a full checkout; today it is never installed to `.local/bin` and only reaches the fleet host incidentally, at `~/ccrc/ccd/ccrc-adopt`, off PATH and unmanaged. Two honest options — pick ONE and record it as a deviation:

  (a) Ship `ccrc-adopt` through `install_atomic` too AND resolve `gen-accounts.mjs` at `~/ccrc/deploy/gen-accounts.mjs` (which the fleet-host rsync already places) with the checkout-relative path as fallback.
  (b) Keep `adopt` checkout-only, and have `ccrc adopt` on a box without one fail with a remedy naming the checkout — never a silent skip.

(a) is preferred: adopt is how a hand-built box gets a roster at all, which is the situation an installed box is most likely to be in. Whichever is chosen, `ccrc doctor` must not depend on a checkout — doctor has to work on a bare installed box, which is the entire point of it.

- [ ] **Step 4: Run to verify it passes.** Full three-suite run.

- [ ] **Step 5: Commit.**

---

## Proof gates

Run in order once all tasks are green:

1. `cd server && ./node_modules/.bin/vitest run` — full suite green.
2. `cd agent && ./node_modules/.bin/vitest run` — full suite green.
3. `cd pwa && ./node_modules/.bin/vitest run` — full suite green.
4. `bash ccd/ccrc doctor` on the fleet host — every check green EXCEPT the D-69 wrapper check, which stays red until the operator edits that box's user-owned `accounts.json`.
5. Mutation proof: delete each check's body in turn and confirm its test goes red. A check whose test stays green is not a check.
6. Old-agent tolerance: run the new server against an agent build that sends no `build` field; `/api/fleet/health` must report `build: 'unknown'` and doctor must WARN, not fail.

## Notes carried out of recon

- `ccd`'s `PROJECTS_ROOT` is hardcoded **by design** (`ccd/ccd:9-13`): "Derived from HOME with no env override, exactly as REG and WRAPPER_DIR are — a stray `Environment=` or exported `PROJECTS_ROOT` would point a unit test at real repos." De-hardcoding it means first solving that test-isolation problem. **Out of scope here**; it belongs with the config work.
- `server/src/config.ts:151` uses `??` for `CCRC_PROJECTS_ROOT`, so a bare `CCRC_PROJECTS_ROOT=` line resolves to `''`. Verified NOT live today (`/api/projects` reports `/data/projects`), but `deploy/ccrc.env.example:30` ships exactly that bare line — so the installer that writes an env file from that template walks straight into it. Fix belongs with the config work, and doctor's config-completeness check should catch it.
- First-run spawn defect (a) — `_accept_first_run_prompts`'s missing terminal return — was **fixed** by `1a6e0b9` (2026-08-12). The spec's §4 text is stale on this.
- First-run spawn defect (b) — the started-after-spawn registry race — is **still live** at all six `_spawn` call sites; `started 1` is written after `_spawn` returns, and nothing is written between `tmux new-session` (which consumes the uuid) and the up-to-900 s block. Documented in `server/src/remote/runner.ts:50-68` and `docs/superpowers/programs/build4.md:145-176`. Belongs in its own plan — it touches the most dangerous path in ccd.
- `_accept_first_run_prompts` still does not recognise a rate-limit screen, so a limited account polls the full window and exceeds the agent's 300 s exec ceiling. Same future plan as (b).
- **`jq` is used unguarded** in `deploy/notify.sh:38` and `ccd/ccrc-adopt:408,416,422`, while `ccd/session-hook.sh:21` and `ccd/statusline-command.sh:25-28` both check for it and degrade at exit 0. Doctor's `jq` check covers the gap from outside; closing it inside those two scripts is separate work.
- **`verify-service.sh` is reusable as-is** and needs no changes here: it takes a unit name, is read-only, exits 2 on usage error, and its three `CCRC_VERIFY_*` env knobs exist so tests need not wait 8 s per case. `ccrc doctor`'s services check should CALL it rather than re-implement the two-sample MainPID discipline (`:88-107`), whose rationale — a crash-looping unit spends most but not all of a cycle in `activating (auto-restart)`, so one sample can land in the up window — is not obvious enough to survive a re-write.
- **The canonical ccd verb list** is `cmd_caps`'s heredoc (`ccd/ccd:1898-1944`), pinned against the dispatcher by `server/test/ccd-archive.test.ts:142-160`, which parses the `case` block with `/^ {2}([a-z][a-z|-]*)\)/gm`. If `ccrc` ever grows a `caps`, copy that pinning; do not let a second hand-maintained verb list exist.
- **`ccd/ccd`'s `PROJECTS_ROOT` and `ccrc`'s config both derive from `$HOME` with no env override** by policy (`ccd/ccd:7-16`). The two documented exceptions in the whole tree are `CCD_DISK_FLOOR_GB` and `verify-service.sh`'s `CCRC_VERIFY_*`. A new env override in `ccrc` needs the same kind of written justification or it will be removed in review — as one was in PR #46.
