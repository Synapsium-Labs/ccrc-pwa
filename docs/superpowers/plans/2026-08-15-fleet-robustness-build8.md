# Fleet robustness (Build 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for a fleet mutation to be interrupted partway and leave durable state that no read-only verb can name — and make every state it *can* still leave nameable, so the next bug of this class becomes a row in a table instead of a two-day-old live pane nobody could see.

**Architecture:** Four waves in blast-radius order, each agent-first. Wave 1 makes spawning atomic (the claim is written before anything blocks, across every `_spawn` caller) and teaches the **shipped `SessionLifecycle` ladder** to read `started` on its alive branch — the one-rung change that makes the F8 shape visible at all. Wave 2 makes a claim know whose it is, server-side, because the fleet host has no coordination database. Wave 3 stops background sweeps mutating a claimed workspace. Wave 4 makes a failed write to an input box visible instead of silent. No new ccd verbs, no new exec-whitelist entries, no `FLEET_PROTO` bump.

**Tech Stack:** TypeScript ESM (Node ≥22.13, Fastify), `node:sqlite`, vitest, React 19, bash (ccd). **No new dependencies in any `package.json`.**

**Spec:** `docs/superpowers/specs/2026-08-14-fleet-robustness-design.md` — Part I is the design, Part II the grounding. **Read "What PR #50 already shipped" before starting any wave**; it is the difference between the tree the spec was measured on and the tree you are implementing on. Read Part II's "Still ungrounded" too; several of its entries are step 1 of a task below.

**Base: `d7137c2` — FROZEN.** Not `origin/main`, which moved three times under this spec (`21fef2a` → `5f1e666` → `d7137c2`, `ccd/ccd` 7523 → 7544 → **8612** lines). Every anchor in this plan was derived **by content** against `d7137c2` — `git grep -n <identifier> d7137c2 -- <path>` — never copied from the spec and never taken from `origin/main`. A `file:line` in the spec is a historical note recording where a thing was found, **not an address to open**. If `origin/main` has moved again when you execute, re-derive by identifier; do not apply an offset.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node floor `>=22.13.0`, identical across all three `engines`** — pinned by `server/test/node-floor.test.ts`. If its absolute assertion is red while the others are green, **RAISE engines, never lower them**.
- **No new dependency in any `package.json`.**
- **`FLEET_PROTO` stays 1.** Every wire change is ADDITIVE and absence-permitting, read through a SINGLE reader per field. `reviveFleetSession` returns a literal, so a new `FleetSession` field is a compile error until every path computes it — that is the mechanism, not an obstacle to route around.
- **`EXEC_COMMANDS` stays `['tmux','ccd']`, and no wave adds an exec-whitelist entry.** The `prefer` grant is deliberately deferred (spec §3.4). `gh` has no entry and never gets one. The whitelist lives in **`agent/src/whitelist.ts`** — there is no `server/src/whitelist.ts`.
- **Zero new ccd verbs.** Coordination mutations ride already-granted `CcdArgv`, built at the call site.
- **Extend the SHIPPED vocabularies; do not mint parallel ones.** PR #50 shipped `SessionLifecycle` (L0, derived enum + narrower + pure ladder + bash twin `_session_state` + shared fixture) and the `spawn` registry field (`<epoch-seconds> <rc>`). **No `spawnstate` field. No parallel census kind that duplicates or renames a `SessionLifecycle` member.** A second name for one fact is the exact defect this build exists to prevent.
- **`started` has exactly ONE writer** after Wave 1. The plan states which, once; a test pins the count. Six writers across two processes is a fact nobody owns.
- **Every commit that touches `ccd/ccd` re-stamps the provenance marker in THAT commit.** One byte reds `server/test/ownership.test.ts`; a marker fixed in a later cleanup commit leaves every intermediate commit on the branch red.
- **Tests use FIXTURE HOMEs only** (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). Never run `ccd` against the live `$HOME`. `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore` are human-only by contract and must not appear in an automated step.
- **The ccd stub set is `_spawn` + `_ws_supervise` + `_supervised_start`, together.** ccd's own comment states why: sourcing ccd and calling `cmd_ws_add` under a test would enable a REAL `claude-session@<id>` unit on the host, and the call swallows its own error so the test passes green while doing it. **Stubbing the systemd probe alone is INSUFFICIENT** — reporting "no systemd" sends `_supervised_start` down its fallback into a real `_spawn`. `_ws_supervise` must be a **RECORDING** stub so ordering is asserted, not assumed.
- **Suites run in the FOREGROUND, timeout ≥600000 ms**, as `./node_modules/.bin/vitest run test/<file>` from inside the package. **Never bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **`pwa/test` is typechecked by `cd pwa && npm run build`, NOT by `npm run test`.** Any task touching an exported interface in `shared/api.ts` must run the build, or a break stays invisible while the suite is green.
- **Known load flakes** (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`) — re-run in isolation before calling a real break. CI on the quiet box is the arbiter.
- **Mutation-table discipline.** Every guard ships with a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. For a guard whose only failure mode is *firing wrongly*, the mutant makes it fire.
- **Ring discipline** (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`): ring membership is a property of a file's IMPORTS, not its path. L0 `shared/` imports nothing; L1 policy is pure; L3 adapters **may not narrow a distinction they received**; L4 owns fastify/sockets/timers but does not DECIDE. **No overloaded null at a seam** — two conditions a caller handles differently must not collapse to one value.
- **AGENT-FIRST.** Any task touching `ccd/`, `session-hook.sh`, or `ccd/coordinator-skill/` ships to the fleet host before the server.
- **No new argv positional on any verb the agent whitelists, and no arithmetic on a value that arrived from outside.** `agent/src/whitelist.ts` matches a PREFIX — its own docstring: *"tokens after the prefix are unconstrained"* — so every extra token a granted verb (`start`, `enable`, `ensure`, `stop`, `swap`, `ws-add`, `forget`, …) accepts is attacker-supplied by construction, whether or not a call site emits one today. Bash evaluates a variable's *contents* as an arithmetic expression, and a command substitution inside an array subscript **executes**: `bound='REG[$(cmd)]'` in `(( … >= bound ))` runs `cmd` as the fleet user before the arithmetic errors. **This shipped once, in Task 5 — see D-299 (was D-B8-3) and `73bc0fe`.** Therefore: (1) per-caller tuning travels in a dynamically-scoped `local`, never argv — the `CCD_IN_UNIT` / `CCD_SETTLE_BOUND` idiom; a `local` is neither exported nor an argv token, so it is not addressable from the wire. (2) **One reader** per such variable, validated at the read (`[[ "$x" =~ ^[0-9]{1,5}$ ]] || x=$DEFAULT`), degrading to the production default — never to zero, never to "no bound". (3) Arithmetic contexts include **`[[ x -eq|-ne|-lt|-le|-gt|-ge y ]]` and array subscripts**, not just `(( ))`/`$(( ))`; a `-n` test is NOT a guard, only a `=~ ^[0-9]+$` placed first *inside the same `[[ ]]`* is. (4) Any new positional on a whitelisted verb ships with a fixture-HOME test passing a `REG[$(touch "$HOME/PWNED")]`-shaped payload and asserting the file does not appear, plus a structural assertion that the function consumes no such positional.
- **No `git push` and no `gh` in any task step.** Branch, commit, and stop.

---
## Wave 1 — ccd (bash) half

**Deploy lane: AGENT-FIRST.** Every task below touches `ccd/ccd` or a ccd fixture; the fleet host
gets it before the server. **Every commit that touches `ccd/ccd` re-stamps the provenance marker in
that same commit** — the command is in the Step 5 of each such task, copied from the comment above
`describe('the committed ccd carries a marker that matches its own bytes')` in
`server/test/ownership.test.ts`.

**Measured at `d7137c2`, not taken from the spec:**

- `ccd/ccd` is **8612** lines.
- `git grep -n '_spawn "' d7137c2 -- ccd/ccd` returns **SIX** call sites, exactly as the contract
  says: `cmd_ws_add` (`local rc; _spawn "$id" new; rc=$?`), `cmd_ws_restore`
  (`local rc; _spawn "$id" resume; rc=$?`), **two fallbacks inside `_supervised_start`**
  (`_spawn "$id" "$mode"; rc=$?`, once in the no-`systemctl` arm and once in the
  `enable --now`-failed arm), `cmd_start`'s in-unit branch and `cmd_ensure`'s in-unit branch
  (`local rc; _spawn "$id" "$mode"; rc=$?`).
- `git grep -n 'started 1' d7137c2 -- ccd/ccd` returns **EIGHT** `_reg_set "$id" started 1` lines —
  the six spawn paths above plus the two supervised branches (`cmd_start` and `cmd_ensure`, each
  immediately after `_supervised_start "$id"; rc=$?`).
- `git grep -n '_spawn()' d7137c2 -- server/test` returns **TEN** shell-function stubs across **NINE
  files**, not the eight the contract enumerates. The two the contract omits are
  `server/test/ccd-swap-refuse.test.ts` (`_spawn() { echo "_spawn $*" >> "$HOME/ccd-calls"; return 0; };`
  inside `REAL_ENSURE_STUBS`) and `server/test/ccd-workspaces.test.ts`
  (`WS_ADD_SPAWN_FAIL`, `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return ${rc}; }; …`).
  Both are RECORDING stubs, so the contract's "`ccd-archive` (the one RECORDING stub)" is also
  wrong — there are **four** recording `_spawn` stubs (`ccd-archive` ×2, `ccd-swap-refuse`,
  `ccd-workspaces`). Task 3 converts all ten.
- `cmd_enable` at `d7137c2` contains **no `systemctl` call at all** — it is an arity check, `_id`,
  `cmd_start "$@"`, and an echo. The contract's "NO CODE CHANGE" ruling stands; nothing in this
  section touches it.
- `_ws_unit_state`, `_tmux_server_ensure`, `_reg_claim`, `_spawn_start`, `_spawn_settle`,
  `SPAWN_SETTLE_S` are **absent everywhere** in `ccd/`, `server/`, `shared/`, `agent/` at
  `d7137c2` (grepped, zero hits) — all six are new.

**`_session_state`'s `unclaimed` rung is NOT in this section.** It ships in **w1-srv Task 102**,
in one atomic commit with the `SessionLifecycle` member, because
`server/test/ccd-session-lifecycle.test.ts`'s set-equality tail computes `want` from
`SESSION_LIFECYCLES` — whichever half landed alone would be red for a commit. Task 102 is
AGENT-FIRST for exactly that reason and carries its own provenance re-stamp. **Nothing in this
section edits `_session_state`.** The one ccd task that *reads* the new word is Task 11
(`_resupervise_live`), which must land **after** Task 102.

**Two named-interface deviations from the spec, recorded once here so nobody searches the box for
the spec's identifiers:**

- The settle bound is `SPAWN_SETTLE_S` / `SPAWN_SETTLE_SUPERVISE_S`, **not** the spec §1.2 name
  `CCD_SPAWN_SETTLE_S`, and neither is env-overridable. Its neighbour `SPAWN_GATE_TRIES` states the
  discipline verbatim — *"A plain shell variable with the production default, deliberately NOT an
  env override — HOME is ccd's only isolation boundary and nothing on the wire can set a shell
  variable."* A test that sources ccd assigns them afterwards.
- **`--remote-control` stays in the spawn argv.** Tasks 3 and 9 reproduce `--remote-control '$id'`
  verbatim. The standing ruling of 2026-08-13 (dispatched workers spawn *without* it) is
  **unimplemented on this path**, and Wave 1 deliberately preserves today's argv — the rewrite is a
  refactor of *where* the argv is built, not an endorsement of *what* it contains. The ruling is
  open orchestrator task #37; do not fold it in here.

---

### Task 1: Harness — the systemd boundary becomes structural

`ccd/ccd` itself is untouched by this task, so no provenance re-stamp is due. This is the change
the rest of the wave rests on: `makeCcdHarness` spreads `...process.env`, so the **real** user
manager is reachable from every ccd test today, `claude-session@.service` **is** installed on this
box, and `_ws_supervise`'s `systemctl --user enable --now` swallows its own error — a test that
enabled a real unit against a vitest tmpdir would pass green while doing it.

**Files:**
- Modify: `server/test/ccdWsHelpers.ts` — the `WS_ADD` export
  (`export const WS_ADD = \`_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };\`;`), the
  `ghContainedEnv` function, the `CcdHarness` interface, and `makeCcdHarness`'s body at the line
  `// Beside HOME, and for the same reason — see \`ghContainedEnv\` above.` / `ghContainedEnv(home);`
- Modify: `server/test/ccd-supervised-start.test.ts` — `runCcd`'s `const stub = path.join(h.home, 'stubbin');`
- Modify: `server/test/ccd-archive.test.ts` — `runCcd`'s `const stub = path.join(h.home, 'stubbin');`
- Create: `server/test/ccd-harness-containment.test.ts`

**Interfaces:**
- Consumes: `makeCcdHarness(prefix: string): CcdHarness`, `ghContainedEnv(home: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv` (both existing).
- Produces: `export function harnessBin(home: string): string` — the single PATH-stub directory
  (`<home>/.local/bin`), the one `ghContainedEnv` prepends; `CcdHarness.systemctlCalls(): string[]`;
  `CcdHarness.systemdRunCalls(): string[]` (consumed by Task 4);
  `WS_ADD` widened to `_spawn() { :; }; _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { :; };`.

**THE ONE NON-OBVIOUS MECHANIC, and getting it wrong breaks two shipped suites.**
`ghContainedEnv` is **not** called once per harness — `makeCcdHarness`'s `sh:` is
`execFileSync('bash', …, { env: ghContainedEnv(home, { ...process.env, HOME: home, ...env }) })`,
so it re-runs on **every** `h.sh(...)`. A poison written with an unconditional `writeFileSync`
would therefore be re-planted after any test replaced it. `gh`'s poison is deliberately
unconditional (the host token has repo WRITE scope; nothing may displace it). The systemd poison
must be **create-if-absent**, because two shipped suites — `ccd-supervised-start.test.ts` and
`ccd-archive.test.ts` — *model the unit* through a functional `systemctl` (`runCcd`'s stub does
`case "$*" in "--user enable --now "*) : > "$HOME/pane-up" ;; esac`), and `runCcd` writes its stubs
**before** evaluating `ghContainedEnv` in its `opts` literal. Step 3 spells the asymmetry out.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-harness-containment.test.ts
//
// THE SYSTEMD BOUNDARY, made a property of the harness rather than a rule each
// ccd test file remembers. `makeCcdHarness` spreads `...process.env`, so the
// real user manager is reachable; `claude-session@.service` IS installed on
// this box; `[Install] WantedBy=default.target` writes a PERSISTENT symlink
// into the live `~/.config/systemd/user/default.target.wants/`; `ExecStart` +
// `Restart=always` would then run a supervise loop against a vitest tmpdir —
// and `_ws_supervise` SWALLOWS the error, so the test would pass green.
//
// Same shape and the same argument as the poisoned `gh` beside it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, harnessBin, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-contain-'); });
afterEach(() => { h.cleanup(); });

describe('the harness contains systemctl structurally', () => {
  it('answers `command -v systemctl` — the box HAS one, it just refuses to act', () => {
    // _have_systemctl must stay TRUE, or every test silently takes
    // _supervised_start's no-systemctl fallback instead of the real path.
    expect(h.sh('_have_systemctl && echo yes || echo no')).toBe('yes');
  });

  it('records every argv and refuses, so no real unit can be enabled', () => {
    h.sh('systemctl --user enable --now claude-session@demo-quiet-basin 2>/dev/null; :');
    expect(h.systemctlCalls()).toEqual(['--user enable --now claude-session@demo-quiet-basin']);
  });

  it('exits non-zero, so a caller that checks cannot mistake it for a real enable', () => {
    expect(h.sh('systemctl --user enable --now x >/dev/null 2>&1; echo rc=$?')).toBe('rc=97');
  });

  it('is reachable from a ccd path that does NOT stub systemctl (the whole point)', () => {
    h.sh('_ws_supervise demo-quiet-basin 2>/dev/null; :');
    expect(h.systemctlCalls()).toEqual(['--user enable --now claude-session@demo-quiet-basin']);
  });

  it('lets a test that needs a FUNCTIONAL systemctl win, and KEEPS letting it', () => {
    // The rule the two `runCcd` idioms now follow: a PATH stub goes in
    // harnessBin(), where it replaces the poison. Ordering cannot decide it —
    // ghContainedEnv PREPENDS its own dir, deliberately, so that the gh poison
    // cannot be displaced, and a second stub dir would always lose.
    //
    // THE SECOND `h.sh` IS THE ASSERTION. ghContainedEnv runs on EVERY sh(),
    // so an unconditionally-written poison would re-plant itself between these
    // two lines and silently break ccd-supervised-start.test.ts, whose whole
    // UNIT fixture is a functional `systemctl --user enable --now` touching
    // $HOME/pane-up.
    fs.writeFileSync(path.join(harnessBin(h.home), 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\nexit 0\n', { mode: 0o755 });
    expect(h.sh('systemctl --user is-active x >/dev/null 2>&1; echo rc=$?')).toBe('rc=0');
    expect(h.sh('systemctl --user is-active x >/dev/null 2>&1; echo rc=$?')).toBe('rc=0');
  });

  it('but the gh poison is NOT displaceable — the asymmetry is deliberate', () => {
    // The host gh carries a gho_ token with repo WRITE scope. That containment
    // is absolute and re-plants on every sh(); the systemd one is
    // create-if-absent so a test can model a unit.
    fs.writeFileSync(path.join(harnessBin(h.home), 'gh'),
      '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(h.sh('gh pr list >/dev/null 2>&1; echo rc=$?')).toBe('rc=97');
  });

  it('WS_ADD shadows all three: _spawn, _ws_supervise and _supervised_start', () => {
    // The stub set is the three TOGETHER. Reporting "no systemd" is not enough:
    // it sends _supervised_start down its FALLBACK into a real _spawn.
    expect(WS_ADD).toContain('_spawn()');
    expect(WS_ADD).toContain('_ws_supervise()');
    expect(WS_ADD).toContain('_supervised_start()');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-harness-containment.test.ts
```
Expected: the import fails — `harnessBin` is not exported from `./ccdWsHelpers.js`, and
`h.systemctlCalls is not a function`. The `WS_ADD` case fails on
`expected '_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };' to contain '_supervised_start()'`.
The `command -v systemctl` case is the one that may pass vacuously on a box that has a real one —
that is fine; it is a REGRESSION pin for Step 3, not a red-first assertion.

- [ ] **Step 3: Write minimal implementation**

In `server/test/ccdWsHelpers.ts`, replace the `WS_ADD` export and its docstring:

```ts
/** ws-add spawns a session; tmux is not available under test, so stub the spawn
 *  and the systemd calls. Everything else runs for real. `tmux` is shadowed
 *  too, unconditionally: nothing in ws-add reaches it today, and this is what
 *  keeps that true if something ever does.
 *
 *  THE SET IS THE THREE TOGETHER. `_supervised_start` is here even though
 *  `cmd_ws_add` does not call it, because stubbing the systemd PROBE alone is
 *  insufficient: reporting "no systemd" sends `_supervised_start` down its
 *  fallback into a REAL `_spawn`. */
export const WS_ADD =
  `_spawn() { :; }; _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { :; };`;

/** THE ONE PATH-STUB DIRECTORY. `ghContainedEnv` PREPENDS this dir, so a test
 *  that plants its own binary anywhere else loses to the poison on ordering
 *  alone. A test that needs a FUNCTIONAL `tmux`/`systemctl` on PATH (the two
 *  `runCcd` idioms, which must survive `exec`) writes it HERE, where it
 *  REPLACES the poison file instead of racing it. */
export function harnessBin(home: string): string {
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  return bin;
}
```

In `ghContainedEnv`, replace `const bin = path.join(home, '.local', 'bin'); fs.mkdirSync(bin, { recursive: true });`
with `const bin = harnessBin(home);` and add the systemctl poison beside the gh one, immediately
after the `gh` `writeFileSync`:

```ts
  // THE SECOND STRUCTURAL BOUNDARY, and the reason it is a poison rather than an
  // absence: `_have_systemctl` is `command -v systemctl`, so REMOVING systemctl
  // would send every ccd test down `_supervised_start`'s no-systemd fallback —
  // a different code path, silently. This one exists, records, and refuses.
  //
  // CREATE-IF-ABSENT, unlike the `gh` poison above, AND THE ASYMMETRY IS THE
  // POINT. This function runs on EVERY `sh()` (see `makeCcdHarness`'s `sh:`),
  // so an unconditional write re-plants itself between two calls. `gh` WANTS
  // that — the host token has repo WRITE scope and nothing may displace it.
  // systemd must be displaceable: `ccd-supervised-start.test.ts` and
  // `ccd-archive.test.ts` MODEL the unit through a functional
  // `systemctl --user enable --now` that touches `$HOME/pane-up`, and their
  // `runCcd` writes that stub BEFORE this function is evaluated in its `opts`
  // literal. Re-planting would break both suites and read as a mystery.
  for (const [name, log] of [['systemctl', 'systemctl-calls'], ['systemd-run', 'systemd-run-calls']] as const) {
    const p = path.join(bin, name);
    if (fs.existsSync(p)) continue;
    fs.writeFileSync(p,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${log}"\n`
      + 'echo "ccd tests must never reach the real user manager" >&2\nexit 97\n', { mode: 0o755 });
  }
```

`ccd-limits` and `ccd-clip` build their own HOME and call `ghContainedEnv` directly (its own
docstring says so), so they get the systemd containment too — it lives in the same function. That
is deliberate: neither file reaches systemd today, and if one ever does it must hit the poison
rather than the box.

Add to the `CcdHarness` interface, beside `ghPoison()`:

```ts
  /** Every argv the contained `systemctl` saw — i.e. every systemd call that
   *  was not shadowed by a stub shell function. */
  systemctlCalls(): string[];
  /** Every argv the contained `systemd-run` saw (`_tmux_server_ensure`). */
  systemdRunCalls(): string[];
```

and to `makeCcdHarness`'s returned object, beside `ghPoison: () => ghPoisonAt(home),`:

```ts
    systemctlCalls: () => readLines(path.join(home, 'systemctl-calls')),
    systemdRunCalls: () => readLines(path.join(home, 'systemd-run-calls')),
```

with one module-level helper beside `ghPoisonAt`:

```ts
const readLines = (p: string): string[] =>
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
```

In `server/test/ccd-supervised-start.test.ts` and `server/test/ccd-archive.test.ts`, change
`runCcd`'s stub directory from its own to the harness's — the import gains `harnessBin`, and

```ts
  const stub = path.join(h.home, 'stubbin');
  fs.mkdirSync(stub, { recursive: true });
```

becomes

```ts
  // harnessBin(), not a private dir: ghContainedEnv PREPENDS the harness bin,
  // so a stub anywhere else can never win. Writing here REPLACES the contained
  // systemctl/tmux for this test, which is what these two files need — and the
  // replacement STICKS, because the systemd poison is create-if-absent while
  // this write is unconditional.
  const stub = harnessBin(h.home);
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-harness-containment.test.ts
```

Then the whole ccd surface, in the foreground, because the poison changes behaviour in every file
that never stubbed `systemctl` (a previously-silent real success now warns on stderr):

```
cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/ccd-hold.test.ts test/ccd-ws-reap.test.ts test/ccd-ws-gc.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-rename.test.ts test/ccd-workspaces.test.ts test/ccd-prhistory.test.ts test/ccd-supervised-start.test.ts test/ccd-start-id.test.ts test/ccd-session-state.test.ts test/ccd-session-lifecycle.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-swap-carry.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-forget.test.ts test/ccd-pr-open.test.ts test/ccd-pr-state.test.ts test/ccd-account-ok.test.ts test/ccd-coord-pause.test.ts
```
(`ccd-ws-gc` is a known load flake — re-run it alone before calling a real break.)

- [ ] **Step 5: Commit**

```
git add server/test/ccdWsHelpers.ts server/test/ccd-harness-containment.test.ts server/test/ccd-supervised-start.test.ts server/test/ccd-archive.test.ts
git commit -m "test(ccd): the systemd boundary is structural, not per-file convention

makeCcdHarness spreads process.env and claude-session@.service is installed
here, so every ccd test could reach the real user manager; _ws_supervise
swallows its own error, so a test that enabled a unit against a vitest tmpdir
passed green. A recording, refusing systemctl/systemd-run now sits in the one
prepended harness bin, beside the gh poison, and WS_ADD shadows the third
member of the stub set (_supervised_start) so no fallback reaches a real
_spawn."
```

---

### Task 2: `_reg_claim` — `started` gets exactly one writer

The field gets one writer; the **callers stay authoritative about WHEN**. This task does the
substitution only — no line moves. Task 7 and Task 8 move the six on spawn paths.

**Files:**
- Modify: `ccd/ccd` — add `_reg_claim` beside `_reg_set`/`_reg_get`
  (`_reg_set() { printf '%s' "$3" > "$REG/$1.$2"; }`), and replace all **eight**
  `_reg_set "$id" started 1` lines with `_reg_claim "$id"`
- Test: `server/test/ccd-reg-claim.test.ts` (create)

**Interfaces:**
- Produces: `_reg_claim <id>` — bash, writes `$REG/<id>.started` = `1`. The sole writer of the field.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-reg-claim.test.ts
//
// `started` is what §4.3's ladder reads to tell `orphan` from `never-started`,
// and after Wave 1 it is also what tells `unclaimed` from `running`. Eight
// writers across two processes is a fact nobody owns. The FIELD gets one
// writer; the CALLERS stay authoritative about when — which is why this is a
// substitution, not a relocation of the decision into _spawn_start.
//
// A TEXT SCAN over the shipped script, the idiom ownership.test.ts and
// wsaudit.test.ts already use: the mutant is a second `_reg_set … started`
// line anywhere in the file, and it must go red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const ccd = readFileSync(CCD, 'utf8');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-claim-'); });
afterEach(() => { h.cleanup(); });

describe('_reg_claim is the ONE writer of the started field', () => {
  it('has exactly one `_reg_set … started` line in the whole script', () => {
    const hits = ccd.split('\n').filter((l) => /_reg_set\s+"\$\w+"\s+started\b/.test(l));
    expect(hits, 'a second writer of `started` — route it through _reg_claim').toHaveLength(1);
  });

  it('and that line is inside _reg_claim', () => {
    expect(ccd).toMatch(/_reg_claim\(\)\s*\{[^}]*_reg_set\s+"\$1"\s+started\s+1;?\s*\}/);
  });

  it('every former write site now calls _reg_claim — eight of them', () => {
    const calls = ccd.split('\n').filter((l) => /^\s*_reg_claim\s+"\$id"/.test(l));
    expect(calls).toHaveLength(8);
  });

  it('actually writes the field', () => {
    h.sh('_reg_claim demo-quiet-basin');
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
  });

  it('is monotone WITHIN A ROW — the only eraser is _reg_purge, which drops the whole identity', () => {
    // The reason _spawn_start owes a --resume -> --session-id fallback
    // (Task 9): `started` is written at session-creation time and nothing
    // removes it INDEPENDENTLY, so a spawn that never came up resumes a uuid
    // with no transcript behind it forever.
    //
    // The one exception, named rather than silently asserted away: `_reg_purge`
    // (`# id -> rm -f every "$REG/$id.<field>" registry file for id`) unlinks
    // every field at once, from `forget` / reap / dead-reg. That is not
    // "clearing started" — it is destroying the row. Pinning its existence
    // keeps the exception documented instead of letting a future reader find
    // the comment above false.
    expect(ccd).not.toMatch(/_reg_(del|unset)\b/);
    expect(ccd).not.toMatch(/rm -f "\$REG\/\$?\{?id\}?\.started"/);
    expect(ccd).toMatch(/^_reg_purge\(\)/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-reg-claim.test.ts
```
Expected: `a second writer of 'started' — route it through _reg_claim: expected [ 8 items ] to have a length of 1`,
plus `expected '#!/usr/bin/env bash…' to match /_reg_claim\(\)…/` and `expected [] to have a length of 8`.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, immediately after `_reg_get() { cat "$REG/$1.$2" 2>/dev/null; }              # id field`:

```bash
# THE ONE WRITER OF `started`, and the reason it is a function rather than eight
# `_reg_set` lines: the field is what `_session_state` and shared/'s
# `sessionLifecycle` read to tell `orphan` from `never-started`, and (Wave 1)
# `unclaimed` from `running`. Eight writers across two processes is a fact
# nobody owns. The FIELD gets one writer; the CALLERS stay authoritative about
# WHEN — which is why this is not folded into `_spawn_start`: the two
# supervised-branch writes in cmd_start/cmd_ensure are load-bearing exactly
# when the unit never comes up and `_spawn` never runs in this process, and a
# failed revival must classify `orphan`, not `never-started`.
#
# MONOTONE WITHIN A ROW: nothing in this file clears `started` on its own. The
# one eraser is `_reg_purge`, which unlinks EVERY field for an id (forget, reap,
# dead-reg) — that destroys the identity, it does not un-claim it. Deliberate,
# and what `_spawn_start`'s --resume -> --session-id fallback exists to pay for.
_reg_claim() { _reg_set "$1" started 1; }                   # id
```

Then replace each of the eight `_reg_set "$id" started 1` lines with `_reg_claim "$id"`, leaving
every surrounding comment and every line's position untouched. Find them by:

```
git grep -n 'started 1' -- ccd/ccd
```
— `cmd_ws_add` (after `local rc; _spawn "$id" new; rc=$?`), `cmd_ws_restore` (after
`local rc; _spawn "$id" resume; rc=$?`), the two `_supervised_start` fallbacks (each after
`_spawn "$id" "$mode"; rc=$?`), `cmd_start`'s supervised branch (after `local rc; _supervised_start "$id"; rc=$?`),
`cmd_start`'s in-unit branch, `cmd_ensure`'s supervised branch, `cmd_ensure`'s in-unit branch.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-reg-claim.test.ts test/ownership.test.ts test/ccd-start-id.test.ts test/ccd-supervised-start.test.ts test/ccd-workspaces.test.ts test/ccd-session-lifecycle.test.ts
```

- [ ] **Step 5: Commit** (re-stamp rides in this commit)

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-reg-claim.test.ts
git commit -m "feat(ccd): _reg_claim — one writer for the started field

Eight _reg_set \"\$id\" started 1 lines across two processes become one
function. The field gets one writer; the callers stay authoritative about
when, because the two supervised-branch writes are load-bearing exactly when
the unit never comes up. A text scan pins the count at one."
```

---

### Task 3: Split `_spawn` into `_spawn_start` + `_spawn_settle`

Behaviour-preserving. `_spawn` remains, as the composition, so all six call sites and every
existing stub keep working — but **every stub must be renamed in this same commit**, or the stale
`_spawn() { :; }` shadows nothing, the real `_spawn_settle` runs `_accept_first_run_prompts`, and
`WS_ADD` stubs `tmux` but **not** `sleep`: 450 iterations of `sleep 2` against an empty pane. The
failure mode is a **~900 s hang, not an assertion**.

**Files:**
- Modify: `ccd/ccd` — `_spawn() {   # id mode(new|resume) — (re)create the tmux session under the right account`
- Modify: `server/test/ccdWsHelpers.ts` — `WS_ADD`, plus a new `WS_ADD_REAL_SPAWN` export
- Modify (stub rename, all ten): `server/test/ccd-archive.test.ts` (`ARCH` at
  `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; };` **and** the second one reading
  `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return ${rc}; };`),
  `server/test/ccd-hold.test.ts` (`_ws_supervise() { :; }; _spawn() { :; };`),
  `server/test/ccd-prhistory.test.ts` (`ARCH_STUBS`),
  `server/test/ccd-swap-refuse.test.ts` (`REAL_ENSURE_STUBS`),
  `server/test/ccd-workspaces.test.ts` (`WS_ADD_SPAWN_FAIL`), `server/test/ccd-ws-audit.test.ts` (`ARCH`),
  `server/test/ccd-ws-gc.test.ts` (**TWO** separate `ARCH` consts), `server/test/ccd-ws-reap.test.ts`
- Test: `server/test/ccd-spawn-split.test.ts` (create)

**Interfaces:**
- Produces:
  - `_spawn_start <id> <mode:new|resume>` — resolves the registry, builds the wrapper argv,
    `tmux new-session -d`. **Echoes `$fromswap` (`0`/`1`) on stdout.** Writes nothing to `started`.
    Returns in milliseconds.
  - `_spawn_settle <id> <fromswap> [bound_s]` — the blocking gate loop, the `spawn` fact-write, the
    operator warnings, and `_inject_spawn_effort`. Returns `$prompt_rc`. Never writes `started`.
  - `_spawn <id> <mode> [bound_s]` — unchanged contract, now the composition of the two halves.
  - `WS_ADD_REAL_SPAWN: string` — the harness variant that leaves `_spawn_start`/`_spawn_settle` REAL.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-spawn-split.test.ts
//
// THE WAVE'S CENTRAL PINS. F8's shape is a `ws-add` whose blocking wait was
// killed at the agent's 300 s ceiling AFTER the pane existed but BEFORE the
// claim and the supervision were written — a live pane no registry row claimed
// and no unit was watching. The split is what makes those two writes precede
// anything that can block.
//
// FIXTURE HOMES ONLY. ws-rm / ws-reap / ws-gc --prune / ws-archive / ws-restore
// are human-only by contract and appear in no step here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-split-'); });
afterEach(() => { h.cleanup(); });

/** The tmux substrate modelled by ONE file, $HOME/pane-up — the
 *  ccd-spawn-verdict.test.ts idiom. `sleep` is a no-op so the gate loop costs
 *  no wall time; `date` is NOT stubbed here (Task 5 needs that and settles it
 *  there). */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;

const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

describe('_spawn_start / _spawn_settle', () => {
  it('_spawn_start creates the pane and echoes fromswap, writing NOTHING to started', () => {
    seed('myid');
    const out = h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(out).toBe('0');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    // THE INVARIANT: the start half is not the claiming half. The caller is.
    expect(h.reg('myid', 'started')).toBeNull();
  });

  it('_spawn_start echoes 1 when the spawn lands within 300s of a swap', () => {
    seed('myid');
    const out = h.sh(
      `${TMUX} date() { if [[ "\${1:-}" == "+%s" ]]; then echo 1000; else command date "$@"; fi; }
       printf '%s' 990 > "$REG/myid.lastswap"
       _spawn_start myid resume`);
    expect(out).toBe('1');
  });

  it('_spawn_start returns without blocking — it never polls the pane', () => {
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(h.calls().some((c) => c.includes('capture-pane'))).toBe(false);
  });

  it('_spawn_settle is the blocking half — it polls, stamps `spawn`, and returns the rc', () => {
    seed('myid');
    h.sh(`${TMUX} _spawn_settle myid 0`, { PANE_TEXT: '? for shortcuts' });
    expect(h.calls().some((c) => c.includes('capture-pane'))).toBe(true);
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 0$/);
    expect(h.reg('myid', 'started')).toBeNull();
  });

  it('_spawn is still the composition — one call, same behaviour as before the split', () => {
    seed('myid');
    h.sh(`${TMUX} _spawn myid new; :`, { PANE_TEXT: '? for shortcuts' });
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 0$/);
  });

  it('_spawn threads the settle bound through as its third positional', () => {
    expect(h.sh('type _spawn')).toContain('_spawn_settle');
    expect(h.sh('type _spawn')).toContain('_spawn_start');
  });

  it('_spawn_start still dies on an incomplete registry — the guard did not move', () => {
    const out = h.sh(`${TMUX} (_spawn_start nosuchid new) 2>&1; :`);
    expect(out).toContain("incomplete registry for 'nosuchid'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts
```
Expected: `bash: _spawn_start: command not found` on every case (surfacing as an `execFileSync`
throw out of `h.sh`), and `expected '' to be '0'`.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, replace the whole `_spawn()` function with three:

```bash
_spawn_start() {   # id mode(new|resume) -> creates the tmux session, echoes fromswap. NEVER BLOCKS.
  # THE NON-BLOCKING HALF. Split out so that every caller can write the claim
  # (`_reg_claim`) and, where it has one, wire the supervision BEFORE anything
  # that can block — which is F8's whole shape: a `ws-add` killed at the
  # agent's 300 s ceiling after the pane existed and before either write,
  # leaving a live pane no registry row claimed and no unit was watching.
  #
  # Echoes `$fromswap` so `_spawn_settle` need not recompute it: the window is
  # 300 seconds wide and recomputing it after a settle would race it.
  # WRITES NOTHING TO `started` — that is `_reg_claim`'s single job, and the
  # callers decide when.
  local id="$1" mode="$2" wrapper workdir uuid tname sidflag
  wrapper=$(_reg_get "$id" wrapper); workdir=$(_reg_get "$id" workdir); uuid=$(_reg_get "$id" uuid)
  [[ -n "$wrapper" && -n "$workdir" && -n "$uuid" ]] || die "incomplete registry for '$id'"
  tname=$(_tmux "$id")
  # A spawn within 5 min of a swap is the swap LANDING on the new account — resume from
  # summary there (cheap) instead of full-as-is (700k re-read on the fresh limit pool).
  local fromswap=0 lastswap
  lastswap=$(_reg_get "$id" lastswap)
  [[ -n "$lastswap" && $(( $(date +%s) - lastswap )) -lt 300 ]] && fromswap=1
  if [[ "$mode" == "resume" ]]; then sidflag="--resume '$uuid'"; else sidflag="--session-id '$uuid'"; fi
  # COLORTERM=truecolor so Claude Code emits 24-bit colour (it otherwise quantises
  # to 256, collapsing its palette). tmux passes it through to the terminal-drawer
  # xterm once the server has the RGB terminal-feature (see hardening/tmux.conf).
  tmux new-session -d -s "$tname" -x 220 -y 50 \
    "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' --remote-control '$id' $sidflag --dangerously-skip-permissions"
  # Make this window's terminal title = the tmux session name ("cc-<id>"), so a frontmost-window-
  # aware hotkey (ccclip) can target exactly the session you're looking at, even with many open.
  tmux set-option -t "$tname" set-titles on 2>/dev/null
  tmux set-option -t "$tname" set-titles-string '#S' 2>/dev/null
  # Follow the most-recent client's size (defensive; with attach -d there's only ever one client,
  # so the window always fits the device you're on — no smaller-client "dotted filler" clash).
  tmux set-option -t "$tname" window-size latest 2>/dev/null
  echo "$fromswap"
}

_spawn_settle() {   # id fromswap [bound_s] — the BLOCKING half: gate loop, fact, warnings, /effort
  local id="$1" fromswap="$2" wrapper tname prompt_rc
  wrapper=$(_reg_get "$id" wrapper)
  tname=$(_tmux "$id")
  _accept_first_run_prompts "$tname" "$fromswap"; prompt_rc=$?
  # The verdict becomes a FACT before it becomes a return code (§3.1). This costs nothing — this
  # already runs inside the supervisor — and it is the ONLY channel from a spawn that happened
  # inside the unit to a `ccd start` running in another process, which is what _supervised_start
  # polls. KEEP THE FIELD AND ITS `<epoch-seconds> <rc>` ENCODING: the timestamp is load-bearing,
  # because _supervised_start compares `at >= since` to tell THIS attempt's failure from the
  # previous one's, and a bare word field would destroy that.
  _reg_set "$id" spawn "$(date +%s) $prompt_rc"
  case "$prompt_rc" in
    # A revival supersedes an earlier deliberate stop (§4.1). `rm -f` on an absent file is a no-op,
    # so this is correct whether or not the .stopped stamp itself has landed yet.
    0) rm -f "$REG/$id.stopped" ;;
    # $id and $wrapper are only in scope HERE, not inside _accept_first_run_prompts (which knows
    # only the tmux name), so the operator-facing warnings — naming both, spec §5 — live on this
    # side of the return.
    2) echo "warn: $id is waiting for login on $wrapper — attach and run /login" >&2 ;;
    3) echo "ccd: $id: the tmux session vanished during startup — nothing is running. A retry will --resume this uuid; if the session never came up, clear $REG/$id.started first." >&2 ;;
    4) echo "ccd: $id: startup window expired with no live TUI marker. A retry will --resume this uuid; if the session never came up, clear $REG/$id.started first." >&2 ;;
  esac
  # /effort ultracode is a Claude-model effort tier; skip it on any lane that is not home-able
  # (those are the opt-in external backends — gpt/Codex today — which don't take it, so the
  # injection would just error into the prompt box).
  #
  # The RC half of the guard is STRICTER than the `!= 2` it replaced: `== 0` means inject only
  # into a TUI we watched come up.
  _is_home_able "$wrapper" && [[ "$prompt_rc" == 0 ]] && _inject_spawn_effort "$tname"
  return "$prompt_rc"
}

_spawn() {   # id mode(new|resume) [bound_s] — the composition, so cmd_swap and friends are unchanged
  # NOTE: v2.1.177 does not print the claude.ai URL to the pane or debug log, so there is no
  # URL to capture. The session is discovered on claude.ai by its name, which == the id
  # (we pass `--remote-control '$id'`).
  #
  # A CALLER THAT WANTS THE F8-SAFE ORDERING DOES NOT USE THIS: it calls the two halves and puts
  # `_reg_claim` (and its `_ws_supervise`, where it has one) between them.
  local fs
  fs=$(_spawn_start "$1" "$2") || return $?
  # LAST LINE ONLY, then validated to the two legal words. `_spawn_start`'s own tmux calls are
  # silent on success, but a stub or a hostile `tmux` on PATH is not, and the FAILURE DIRECTION
  # matters: fromswap=1 picks the cheap auto-compact landing, fromswap=0 keeps full fidelity, so
  # anything unrecognised degrades to 0.
  fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
  _spawn_settle "$1" "$fs"
}
```

Now rename **every** stub. In `server/test/ccdWsHelpers.ts` add, beside `WS_ADD`:

```ts
/** THE VARIANT THE ORDERING PINS NEED: `_spawn_start` and `_spawn_settle` stay
 *  REAL, so §1.1's "the claim and the supervision precede anything that can
 *  block" is an assertion rather than an assumption. Three things are stubbed:
 *
 *   - `tmux`            — no tmux under test.
 *   - `_accept_first_run_prompts` — the settle's 450-poll gate loop; RC is the
 *     fixture's input via $ACCEPT_RC.
 *   - `_ws_supervise`   — a RECORDING stub, readable through `h.calls()`, and
 *     this one is a SAFETY RULE, not convenience: left real it would
 *     `systemctl --user enable --now claude-session@<id>` against the live user
 *     manager, write a PERSISTENT default.target.wants symlink, and start a
 *     Restart=always supervise loop against a vitest tmpdir — while swallowing
 *     its own error, so the test would pass green. (The harness's contained
 *     systemctl is the structural backstop; this is what makes ORDERING
 *     assertable, because a real systemctl writes nothing into the fixture.)
 *   - `_supervised_start` — the third member of the set: reporting "no systemd"
 *     sends it down its fallback into a REAL spawn. */
export const WS_ADD_REAL_SPAWN = `
  _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; };
  _supervised_start() { echo "supervised_start $1" >> "$HOME/ccd-calls"; return 0; };
  _accept_first_run_prompts() { echo "accept $*" >> "$HOME/ccd-calls"; return \${ACCEPT_RC:-0}; };
  sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "\$1" in
      new-session)  : > "\$HOME/pane-up" ;;
      kill-session) rm -f "\$HOME/pane-up" ;;
      has-session)  [[ -e "\$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;
```

and widen `WS_ADD` itself so no path can reach the real halves:

```ts
export const WS_ADD =
  `_spawn() { :; }; _spawn_start() { echo 0; }; _spawn_settle() { :; };`
  + ` _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { :; };`;
```

Then, in each of the nine test files listed under **Files**, add the two new names beside the
existing `_spawn` stub, preserving whatever that stub did:

- `ccd-archive.test.ts` `ARCH` — `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; };` becomes
  `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; }; _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; echo 0; }; _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; };`
  and its `expect(h.calls()).toContain('spawn demo-quiet-basin resume')` becomes
  `toContain('spawn_start demo-quiet-basin resume')` once Task 7 converts `cmd_ws_restore`
  (**for this task the old name still fires** — `_spawn` is still the composition and
  `cmd_ws_restore` still calls it, so leave the assertion alone here and change it in Task 7).
- the second `ccd-archive` stub, `ccd-workspaces`'s `WS_ADD_SPAWN_FAIL` and `ccd-swap-refuse`'s
  `REAL_ENSURE_STUBS` all return an rc: give `_spawn_settle` the `return ${rc}` / `return 0` and
  `_spawn_start` `echo 0`.
- `ccd-hold`, `ccd-prhistory`, `ccd-ws-audit`, `ccd-ws-reap`, and **both** `ccd-ws-gc` `ARCH`
  consts get `_spawn_start() { echo 0; }; _spawn_settle() { :; };` beside their `_spawn() { :; };`.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-archive.test.ts test/ccd-hold.test.ts test/ccd-prhistory.test.ts test/ccd-swap-refuse.test.ts test/ccd-workspaces.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-gc.test.ts test/ccd-ws-reap.test.ts test/ownership.test.ts
```
If any file in that list takes longer than ~30 s, **kill it and look for a missed stub** — that is
the ~900 s hang, not a slow box.

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccdWsHelpers.ts server/test/ccd-spawn-split.test.ts server/test/ccd-archive.test.ts server/test/ccd-hold.test.ts server/test/ccd-prhistory.test.ts server/test/ccd-swap-refuse.test.ts server/test/ccd-workspaces.test.ts server/test/ccd-ws-audit.test.ts server/test/ccd-ws-gc.test.ts server/test/ccd-ws-reap.test.ts
git commit -m "refactor(ccd): split _spawn into _spawn_start and _spawn_settle

Behaviour-preserving: _spawn remains as the composition, so cmd_swap and all
six call sites are unchanged. The point is that a caller can now put the claim
and the supervision BETWEEN the halves. Ten stubs across nine test files are
renamed in this commit — a stale _spawn stub shadows nothing and sends the
real settle into 450 sleep-2 polls."
```

---

### Task 4: `_tmux_server_ensure` — put the tmux server in a known cgroup

**Files:**
- Modify: `ccd/ccd` — `_spawn_start`, immediately ahead of its `tmux new-session -d -s "$tname"`
- Test: `server/test/ccd-tmux-server.test.ts` (create)

**Interfaces:**
- Consumes: `_spawn_start <id> <mode>` (Task 3); `CcdHarness.systemdRunCalls(): string[]` and
  `CcdHarness.systemctlCalls(): string[]` (Task 1). The contained `systemd-run` **records then
  exits 97**, so every case below exercises the `||` fallback and still gets its argv recorded —
  that is what makes the scope assertion checkable without a real user manager.
- Produces: `_tmux_server_ensure` — idempotent, no arguments.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-tmux-server.test.ts
//
// All 21 live sessions are children of ONE tmux server, and that server
// currently sits inside `claude-session@claude-ccrc-pwa.service`'s cgroup —
// whichever unit happened to create it. The unit file carries KillMode=process
// for exactly that reason, and one deleted line would turn the deploy's
// `try-restart claude-session@*` sweep into a fleet kill.
//
// This puts the SERVER in a scope of its own the next time one is created. It
// cannot move a live server: cgroup membership of a running process needs a
// D-Bus StartTransientUnit adoption, and that is not something to attempt
// against a process holding 21 sessions. So it takes effect at the next
// reboot, and it self-heals from then on.
//
// FIXTURE HOME ONLY — never the live box. The recording systemctl/systemd-run
// from ccdWsHelpers.ts is what makes the second half assertable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-tmuxsrv-'); });
afterEach(() => { h.cleanup(); });

describe('_tmux_server_ensure', () => {
  it('is a NO-OP when a server is already running', () => {
    h.sh('tmux() { case "$1" in list-sessions) return 0 ;; esac; }; _tmux_server_ensure');
    expect(h.systemdRunCalls()).toEqual([]);
  });

  it('places a NEW server in ccrc-tmux-server.scope, outside any claude-session@ cgroup', () => {
    h.sh('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; };'
       + ' _tmux_server_ensure; :');
    const [argv] = h.systemdRunCalls();
    expect(argv).toContain('--user --scope');
    expect(argv).toContain('--unit=ccrc-tmux-server');
    expect(argv).toContain('tmux start-server');
    expect(argv).not.toContain('claude-session@');
  });

  it('falls back to a bare `tmux start-server` when systemd-run refuses', () => {
    // The single-box OSS story: ccd must keep working with no systemd at all.
    // The harness poison ALREADY exits 97, so no override is needed — and a
    // `systemd-run() { … }` shell function would be a bash-only name and would
    // shadow the very boundary this suite is here to exercise.
    h.sh('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; };'
       + ' _tmux_server_ensure; :');
    expect(h.calls()).toContain('tmux start-server');
  });

  it('_spawn_start calls it BEFORE new-session — a server created by the spawn is already scoped', () => {
    h.sh(`_reg_set myid wrapper claude
          _reg_set myid workdir '${h.home}'
          _reg_set myid uuid deadbeef
          tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; }
          _spawn_start myid new`);
    const calls = h.calls();
    const start = calls.findIndex((c) => c === 'tmux start-server');
    const news  = calls.findIndex((c) => c.startsWith('tmux new-session'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(news).toBeGreaterThan(start);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-tmux-server.test.ts
```
Expected: `bash: _tmux_server_ensure: command not found`, surfacing as an `execFileSync` throw.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, immediately above `_spawn_start()`:

```bash
_tmux_server_ensure() {   # place the SERVER in a known scope, not the caller's cgroup
  # Every session on this box is a child of ONE tmux server, and that server
  # currently lives in whichever `claude-session@<id>.service` cgroup happened
  # to create it — so the unit file's KillMode=process is the only thing
  # standing between the deploy's `try-restart claude-session@*` sweep and a
  # fleet kill (systemd's default KillMode is control-group).
  #
  # NO NEW UNIT FILE: nothing extra to deploy or keep in sync, and it self-heals
  # — whenever the server is next created it lands in ccrc-tmux-server.scope.
  # The `||` fallback keeps ccd working where systemd-run is absent, which the
  # single-box story requires; it is the same pattern tmux already uses for its
  # own per-pane `tmux-spawn-<uuid>.scope`.
  #
  # IT ONLY TAKES EFFECT WHEN THE SERVER IS NEXT CREATED, i.e. at a reboot:
  # cgroup membership cannot be changed for a live process without a D-Bus
  # StartTransientUnit adoption, and that is not something to attempt against a
  # process holding 21 live sessions.
  tmux list-sessions >/dev/null 2>&1 && return 0
  systemd-run --user --scope --quiet --collect --unit=ccrc-tmux-server tmux start-server 2>/dev/null \
    || tmux start-server
}
```

and add the call as the first line after `tname=$(_tmux "$id")` inside `_spawn_start`… no — put it
immediately **before** the `tmux new-session` call, after the `sidflag` assignment, so nothing that
can `die` runs after it:

```bash
  if [[ "$mode" == "resume" ]]; then sidflag="--resume '$uuid'"; else sidflag="--session-id '$uuid'"; fi
  # Ahead of the only line that can create the tmux server.
  _tmux_server_ensure
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-tmux-server.test.ts test/ccd-spawn-split.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-tmux-server.test.ts
git commit -m "feat(ccd): _tmux_server_ensure — the tmux server gets its own scope

21 sessions hang off one tmux server that currently sits inside a
claude-session@ cgroup, so KillMode=process in the unit file is the only thing
between the deploy sweep and a fleet kill. No new unit file; the fallback keeps
ccd working without systemd. Takes effect at the next reboot."
```

---

### Task 5: The wall-clock settle bound, threaded per caller

Today the gate window is **purely iterative** — there is no epoch read anywhere inside
`_accept_first_run_prompts`. `SPAWN_GATE_TRIES=450` at a 2 s tick is ~900 s plain and ~1350 s once
gate branches fire, i.e. **3–4.5× the agent's hard 300 s ceiling**: a session slower than 300 s
cannot be spawned through the dispatch path at all, only killed.

**The bound must NOT be keyed off `fromswap`** — the discriminator runs backwards from the obvious
reading: `cmd_swap` writes `lastswap` two lines before the restart, so a **swap** is `fromswap=1`
(the fast branch) and a fresh `ws-add` is `fromswap=0`. Keyed off `fromswap`, `ws-add` would get
the long window and the bound would evaporate.

**Files:**
- Modify: `ccd/ccd` — the constants block (after `SUPERVISED_START_WAIT=30 …`), `_accept_first_run_prompts`
  (`local t="$1" fromswap="${2:-0}" i pane`), `_spawn_settle`, `_spawn`,
  `cmd_ensure() {   # idempotent; used by systemd. arg is the id directly.`, and `cmd_supervise`'s
  `cmd_ensure "$id"`
- Test: `server/test/ccd-spawn-split.test.ts` (extend)

**Interfaces:**
- Produces: `SPAWN_SETTLE_S=240`, `SPAWN_SETTLE_SUPERVISE_S=1350` (plain shell variables, no env
  override); `_accept_first_run_prompts <tmuxname> [fromswap] [bound_s]`;
  `_spawn_settle <id> <fromswap> [bound_s]`; `_spawn <id> <mode> [bound_s]`;
  `cmd_ensure <id> [bound_s]`.

- [ ] **Step 1: Write the failing test**

The stated ungrounded item, settled here: `SPAWN_STUB` in `ccd-login-screen.test.ts` defines
`sleep() { :; }`, so a bound read from `date +%s` can never fire — the 450 iterations run in
milliseconds and no wall time passes. **`SECONDS` does not fix it either**, for the same reason.
The mechanism is a *fake clock the stub drives*: stub `sleep` to advance a counter and `date +%s`
to read it. Bash resolves functions before binaries, so the sourced ccd sees both. Append to
`server/test/ccd-spawn-split.test.ts`:

```ts
/** A FAKE CLOCK the gate loop's own `sleep` drives. Without this the bound is
 *  untestable: every existing spawn fixture stubs `sleep` to a no-op, so 450
 *  iterations run in milliseconds and no wall-clock bound could ever fire —
 *  neither `date +%s` nor `SECONDS`. `_faketime` is a TOP-LEVEL variable and
 *  `date` echoes it by name deliberately: unlike `_session_state`'s `now`,
 *  nothing declares `local _faketime`, so no callee can shadow it. */
const FAKE_CLOCK = `_faketime=0
  sleep() { _faketime=$((_faketime + \${1:-1})); }
  date() { if [[ "\${1:-}" == "+%s" ]]; then echo "$_faketime"; else command date "$@"; fi; }`;

describe('the settle bound is wall-clock, and it is per caller', () => {
  it('SPAWN_SETTLE_S is 240 and SPAWN_SETTLE_SUPERVISE_S is 1350', () => {
    expect(h.sh('echo "$SPAWN_SETTLE_S $SPAWN_SETTLE_SUPERVISE_S"')).toBe('240 1350');
  });

  it('neither is an env override — HOME is ccd\'s only isolation boundary', () => {
    expect(h.sh('echo "$SPAWN_SETTLE_S"', { SPAWN_SETTLE_S: '7' })).toBe('240');
  });

  it('_accept_first_run_prompts returns 4 once the WALL CLOCK passes the bound', () => {
    const out = h.sh(
      `${FAKE_CLOCK}
       tmux() { case "$1" in has-session) return 0 ;; capture-pane) printf '' ;; esac; }
       _accept_first_run_prompts cc-test 0 10; echo "rc=$? t=$_faketime"`);
    expect(out).toMatch(/rc=4/);
    // ~5 iterations of `sleep 2`, not 450: the bound fired, not the counter.
    expect(Number(/t=(\d+)/.exec(out)![1])).toBeLessThan(20);
  });

  it('keeps the iteration cap as the second bound — the supervise bound never reaches it', () => {
    // 450 polls x 2s = 900s < SPAWN_SETTLE_SUPERVISE_S, so cmd_supervise's
    // window is exactly today's. Only the agent-reachable path is shortened.
    expect(h.sh('echo $((SPAWN_GATE_TRIES * 2 < SPAWN_SETTLE_SUPERVISE_S))')).toBe('1');
  });

  it('the bound is NOT keyed off fromswap — a swap is the FAST branch, ws-add is not', () => {
    // The discriminator runs backwards from the obvious reading: cmd_swap
    // writes lastswap two lines before the restart, so fromswap=1 IS the swap.
    // Keyed off fromswap, a fresh ws-add would get the long window.
    expect(h.sh('type _accept_first_run_prompts')).not.toMatch(/bound.*fromswap|fromswap.*bound=/);
  });

  it('_spawn_settle takes the bound as its third positional and defaults to SPAWN_SETTLE_S', () => {
    expect(h.sh('type _spawn_settle')).toContain('${3:-$SPAWN_SETTLE_S}');
  });

  it('cmd_ensure takes it as a second positional, and cmd_supervise RAISES it', () => {
    expect(h.sh('type cmd_ensure')).toContain('${2:-$SPAWN_SETTLE_S}');
    expect(h.sh('type cmd_supervise')).toContain('cmd_ensure "$id" "$SPAWN_SETTLE_SUPERVISE_S"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts
```
Expected: `expected ' ' to be '240 1350'`; the `rc=4` case instead runs the full 450 iterations and
reports `t=900`; `expected 'cmd_ensure () { … }' to contain '${2:-$SPAWN_SETTLE_S}'`.

- [ ] **Step 3: Write minimal implementation**

Constants, immediately after `SUPERVISED_START_WAIT=30 …`'s comment block in `ccd/ccd`:

```bash
SPAWN_SETTLE_S=240              # WALL-CLOCK bound on the startup-gate wait, on the AGENT-REACHABLE
                                # path. The gate window used to be purely iterative
                                # (SPAWN_GATE_TRIES x ~2s = ~900s, ~1350s once gate branches fire),
                                # i.e. 3-4.5x the agent's hard 300s ceiling — so a session slower
                                # than 300s could not be spawned through the dispatch path at all,
                                # only killed. 240 leaves room for the rest of `ws-add` under that
                                # ceiling, and it is safe ONLY because the claim and the
                                # supervision now precede the wait: exceeding it is a REPORT, not
                                # an orphan.
                                # A plain shell variable with the production default, deliberately
                                # NOT an env override — same discipline, and the same reason, as
                                # SPAWN_GATE_TRIES above. A test that sources ccd assigns it after.
SPAWN_SETTLE_SUPERVISE_S=1350   # what `cmd_supervise` (systemd ExecStart, no ceiling) RAISES it to.
                                # A global 240 would make every systemd restart of a large session
                                # settle unconfirmed — the "700k+-token resumes take minutes between
                                # gates" case — which suppresses _inject_spawn_effort and lights a
                                # warning on a healthy row. Above SPAWN_GATE_TRIES x 2s, so on this
                                # path the ITERATION cap still fires first and the window is exactly
                                # today's.
```

`_accept_first_run_prompts` — update the header comment's rc table sentence and the locals line:

```bash
_accept_first_run_prompts() {   # tmuxname [fromswap] [bound_s] — clear startup gates, then CONFIRM the TUI is up.
```
```bash
  local t="$1" fromswap="${2:-0}" bound="${3:-$SPAWN_SETTLE_S}" i pane t0
  # A WALL-CLOCK bound as well as the iteration cap. The cap alone is not a
  # bound anyone can reason about: gate branches sleep 2 EXTRA seconds each, so
  # the same 450 iterations are ~900s plain and ~1350s when gates fire. The
  # bound is NOT keyed off `fromswap` — measured, the discriminator runs
  # backwards from the obvious reading: `cmd_swap` writes `lastswap` two lines
  # before the restart, so a SWAP is fromswap=1 (the fast branch) and a fresh
  # `ws-add` is fromswap=0. Keyed off it, ws-add would get the LONG window.
  t0=$(date +%s)
  for i in $(seq 1 "$SPAWN_GATE_TRIES"); do
    (( $(date +%s) - t0 >= bound )) && return 4
```

`_spawn_settle` — thread it:

```bash
_spawn_settle() {   # id fromswap [bound_s] — the BLOCKING half: gate loop, fact, warnings, /effort
  local id="$1" fromswap="$2" bound="${3:-$SPAWN_SETTLE_S}" wrapper tname prompt_rc
  …
  _accept_first_run_prompts "$tname" "$fromswap" "$bound"; prompt_rc=$?
```

`_spawn` — third positional:

```bash
  _spawn_settle "$1" "$fs" "${3:-$SPAWN_SETTLE_S}"
```

`cmd_ensure` — second positional. Its first two lines become:

```bash
cmd_ensure() {   # id [bound_s] — idempotent; used by systemd. arg is the id directly.
  local id="${1:?usage: ccd ensure <id>}" bound="${2:-$SPAWN_SETTLE_S}"
```
and its in-unit spawn becomes `_spawn "$id" "$mode" "$bound"` (Task 8 splits it further).

`cmd_supervise` — the one caller that raises it:

```bash
  # THE NO-CEILING CALLER, and the only one that raises the settle bound: this
  # runs as the unit's ExecStart with nothing timing it out, and a 700k-token
  # resume legitimately takes minutes between gates. A global SPAWN_SETTLE_S
  # here would make every systemd restart of a large session settle
  # unconfirmed — suppressing _inject_spawn_effort and lighting a warning on a
  # healthy row.
  cmd_ensure "$id" "$SPAWN_SETTLE_SUPERVISE_S"
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-supervised-start.test.ts test/ccd-start-id.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-spawn-split.test.ts
git commit -m "feat(ccd): a wall-clock settle bound, threaded per caller

The startup-gate window was purely iterative — ~900s plain, ~1350s once gate
branches fire, against the agent's hard 300s ceiling, so a slow session could
only ever be killed. SPAWN_SETTLE_S=240 bounds the agent-reachable path;
cmd_supervise raises it to 1350 through cmd_ensure's new second positional, so
a large systemd resume still settles confirmed. Not keyed off fromswap: a swap
is the FAST branch and a fresh ws-add is not."
```

---

### Task 6: rc 5 — the hard-block settle verdict

Shipped codes are `0` ready, `2` auth screen, `3` tmux session vanished mid-poll, `4` window
expired. **5 is the first free one, and 3/4 must not be renumbered**: four call sites plus
`_supervised_start` branch on `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`.

**THE ORDERING CONSTRAINT, settled by reading the full if/elif chain at `d7137c2`:**
`_pane_hard_blocked`'s shipped regex matches `Invalid API key` and `Please run /login`, which
`_pane_login_screen` also matches. `ccd-login-screen.test.ts` pins `acceptRc('Please run /login') === 2`.
So the new branch goes **immediately after** `_pane_login_screen`, dead last in the chain — not
merely "beside" it. Ahead of it, a bare login banner would return 5, and the Bypass-Permissions
fixture (whose pane quotes `Please run /login` in restored scrollback) would return 5 with no keys
sent, parking the session one stray Enter from `1. No, exit`.

**Files:**
- Modify: `ccd/ccd` — `_accept_first_run_prompts`'s `if _pane_login_screen "$pane"; then` block and
  its header rc table; `_spawn_settle`'s `case "$prompt_rc" in`; the four
  `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]` reports in `cmd_ws_add`, `cmd_ws_restore`, `cmd_start`, `cmd_ensure`
- Test: `server/test/ccd-login-screen.test.ts` (extend), `server/test/ccd-spawn-verdict.test.ts` (extend)

**Interfaces:**
- Produces: `_accept_first_run_prompts` rc `5` = hard block (limit/spend banner, or lost auth).
  `_spawn_settle` propagates it; `$REG/<id>.spawn` records `<epoch-seconds> 5`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-login-screen.test.ts`:

```ts
describe('_accept_first_run_prompts: rc 5, the hard block', () => {
  it('returns 5 on a genuine limit banner, and sends no keystrokes', () => {
    expect(acceptRc('5-hour limit reached · resets 3pm')).toBe(5);
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });

  it('returns 5 on a 429, not 4 — "we know exactly what is wrong" is not "we do not know"', () => {
    expect(acceptRc('API Error: 429 Too Many Requests')).toBe(5);
  });

  // THE ORDERING REGRESSION. _pane_hard_blocked's shipped regex matches
  // "Invalid API key" and "Please run /login" too, and _pane_login_screen is
  // CALLED LAST. Put the hard-block branch anywhere ahead of the gate branches
  // and this file's own Bypass-Permissions fixture — a live gate whose pane
  // ALSO quotes "Please run /login" in restored scrollback — returns 5, sends
  // no keys, and parks the session one stray Enter from "1. No, exit".
  it('still returns 2, not 5, on a bare login screen (hard-block is checked AFTER)', () => {
    expect(acceptRc('Please run /login')).toBe(2);
  });

  it('still returns 0 on a healthy pane that quotes a limit banner in scrollback', () => {
    const pane = '● Read swap.log\n  "5-hour limit reached"\n? for shortcuts';
    expect(acceptRc(pane)).toBe(0);
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });

  it('does not inject /effort after a hard block', () => {
    h.sh(
      `${SPAWN_STUB}
       _reg_set myid wrapper claude
       _reg_set myid workdir '${h.home}'
       _reg_set myid uuid deadbeef
       _spawn myid new; :`,
      { PANE_TEXT: 'monthly spend limit reached' },
    );
    expect(h.calls().some((c) => c.includes('/effort'))).toBe(false);
  });
});
```

Append to `server/test/ccd-spawn-verdict.test.ts`:

```ts
describe('the spawn fact records rc 5, and the encoding is unchanged', () => {
  it('writes `<epoch-seconds> 5` — the timestamp is load-bearing', () => {
    seed('myid');
    h.sh(`${TMUX} _spawn myid new; :`, { PANE_TEXT: 'You have reached your usage limit' });
    // _supervised_start compares `at >= since` to tell THIS attempt's failure
    // from the previous one's; a bare word field would destroy that.
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 5$/);
  });

  it('3 and 4 keep their numbers — four call sites plus _supervised_start branch on them', () => {
    expect(rcOf('_accept_first_run_prompts cc-test 0')).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-login-screen.test.ts test/ccd-spawn-verdict.test.ts
```
Expected: `expected 4 to be 5` on the limit-banner cases (the window expires instead), and
`expected '1755… 4' to match /^\d+ 5$/`.

- [ ] **Step 3: Write minimal implementation**

In `_accept_first_run_prompts`, immediately after the closing `fi` of the
`if _pane_login_screen "$pane"; then … return 2 … fi` block and before the trailing `sleep 2`:

```bash
    # A HARD BLOCK: a real limit/spend banner, or lost auth. This earns its own
    # code rather than joining 4, because the two say opposite things — an
    # expired window means *we do not know*, a hard block means *we know
    # exactly what is wrong and waiting longer cannot fix it*. Collapsing them
    # would be an adapter narrowing a distinction it received.
    #
    # CHECKED AFTER `_pane_login_screen`, AND THAT ORDER IS THE CONTRACT, not a
    # preference: `_pane_hard_blocked`'s regex also matches "Invalid API key"
    # and "Please run /login", and the whole reason the login check sits LAST
    # is that its banners appear in restored scrollback beside live gates.
    # Ahead of the gate branches this returns 5 on a pane holding an unanswered
    # Bypass-Permissions prompt, sends no keys, and parks the session one stray
    # Enter from "1. No, exit". 5, NOT 4: renumbering 3 or 4 would silently
    # retarget four call sites plus _supervised_start.
    if _pane_hard_blocked "$pane"; then
      return 5
    fi
```

Update the header's rc table sentence, currently
`# rc 0 = a live marker appeared (the TUI is up); 2 = an auth screen (below); 3 = the tmux session`
`# vanished mid-poll; 4 = the window expired with no marker. …` — append
`5 = a hard block (limit/spend banner, or lost auth): waiting longer cannot fix it.`

In `_spawn_settle`'s `case "$prompt_rc" in`, add after the `4)` arm:

```bash
    5) echo "ccd: $id: hard-blocked at startup (limit/spend banner, or lost auth) on $wrapper — waiting will not fix it; swap the account or attach and run /login." >&2 ;;
```

Extend the four rc reports. In `cmd_ws_add`, `cmd_ws_restore`, `cmd_start`'s in-unit branch and
`cmd_ensure`'s in-unit branch, each `if [[ "$rc" -eq 3 || "$rc" -eq 4 ]]; then` becomes:

```bash
  if [[ "$rc" -eq 3 || "$rc" -eq 4 || "$rc" -eq 5 ]]; then
```

The `_is_home_able "$wrapper" && [[ "$prompt_rc" == 0 ]] && _inject_spawn_effort "$tname"` gate is
**already correct and must not be touched** — `== 0` excludes rc 5 for free.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-login-screen.test.ts test/ccd-spawn-verdict.test.ts test/ccd-spawn-split.test.ts test/ccd-supervised-start.test.ts test/ccd-workspaces.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-login-screen.test.ts server/test/ccd-spawn-verdict.test.ts
git commit -m "feat(ccd): rc 5 — a hard block is not an expired window

An expired window means we do not know; a limit/spend banner means we know
exactly what is wrong and waiting cannot fix it. 5, not 4: three and four are
branched on by four call sites plus _supervised_start. The branch sits AFTER
_pane_login_screen — its regex matches the same auth banners, and the login
check is last precisely because those banners live in restored scrollback."
```

---

### Calling `_spawn_start` — READ THIS BEFORE TASKS 7 AND 8 (D-297 (was D-B8-1))

**`_spawn_start` returns `fromswap` in the global `SPAWN_FROMSWAP`, never on stdout. Every call site
has exactly this shape:**

```bash
_spawn_start "$id" "$mode" || return $?     # or `|| exit $?` at a cmd_* top level
# … _reg_claim, _ws_supervise, whatever must precede the blocking half …
_spawn_settle "$id" "$SPAWN_FROMSWAP"
```

**Never `fs=$(_spawn_start …)`, and never any other `$( )` or `( )` around it.** `_spawn_start`'s
registry validation ends in `die` (`echo …; exit 1`), and `exit` inside a command substitution kills
only the subshell — so the fatal error degrades to rc 1. **rc 1 is in no caller's failure set**:
`cmd_ws_add`, `cmd_start` and `cmd_ensure` all test `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`. The result is
a SUCCESS line and rc 0 over a spawn that never happened.

This is not hypothetical. It shipped at `ad6396d` and was fixed in `9ca06ae`. Measured through the
real harness: at `d7137c2` the shell exits 1 with `ccd: incomplete registry for 'nosuchid'` and dies;
at `ad6396d` it exits **0**, printing `SPAWN_RC=1` and then continuing. That is a fatal condition
narrowed at a seam into a value nobody checks — the exact defect class this build exists to close,
reproduced by the build at the seam it had just created.

`SPAWN_FROMSWAP` is `0` or `1`, validated **inside** `_spawn_start` — do not re-validate at the call
site, and do not add a `${fs##*$'\n'}`-style last-line filter; there is no stdout channel left to
filter. `_spawn_start` sets it to `0` on entry, so a caller never reads a previous spawn's value, and
it is initialised at file scope so `set -u` cannot kill a reader whose `_spawn_start` never ran.

**Test stubs must model this:** `_spawn_start() { SPAWN_FROMSWAP=0; }`, **not**
`_spawn_start() { echo 0; }` — an echoing stub leaks `0` onto the caller's stdout under the real call
shape.

Pinned by `server/test/ccd-spawn-split.test.ts`: `_spawn is fatal on an incomplete registry too`
(status of the whole shell, unwrapped — a `( )` wrapper cannot observe this) and `_spawn reads
fromswap out of the GLOBAL` (`type _spawn` must not match `/\$\(\s*_spawn_start/`).

**Tasks 7 and 8 MUST extend that second assertion to `type` each new caller they add.** As written it
inspects `_spawn` alone, so a new call site could reintroduce `$( )` and stay green. That gap is the
single most likely way this regression returns.

**If you need to measure a fatal `die` in another test file, move `shStatus` from
`ccd-spawn-split.test.ts` into `server/test/ccdWsHelpers.ts` rather than copying it** —
`single-definition.test.ts` will eventually notice a second copy, and a helper that measures process
death is exactly the kind of thing that must have one definition.

**Task 5, note:** `_spawn`'s header documents a third positional `[bound_s]` and
`ccd-spawn-split.test.ts` has a test *named* "threads the settle bound through as its third
positional" — but the body has never passed `$3` to `_spawn_settle`, before or after Task 3, and that
test only greps for the two function names. **The test's name is currently a lie.** Task 5 either
threads the bound for real and makes the assertion measure it, or renames the test. Do not leave a
test whose name claims more than its body checks.

### Task 7: §1.1 ordering — `cmd_ws_add` and `cmd_ws_restore`

This is the fix F8 names. Once the claim and the supervision precede the blocking wait, **a
non-zero `ws-add` no longer means "an orphan was created"** — it means "the session exists, is
claimed, is supervised, and did not confirm its TUI". That is what makes #50's loud non-zero exit
on rc 3/4/5 **safe**; it was not safe before.

`cmd_ws_restore`'s agent budget is `CCD_VERB_TIMEOUT_MS['ws-restore'] = 60_000` — **five times
tighter** than the `ws-add` budget whose expiry caused F8. Stated here rather than discovered.

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_add`'s
  `local rc; _spawn "$id" new; rc=$?` / `_reg_claim "$id"` / `_ws_supervise "$id"` block, and
  `cmd_ws_restore`'s `local rc; _spawn "$id" resume; rc=$?` / `_reg_claim "$id"` / `_ws_supervise "$id"` block
- Modify: `server/test/ccd-archive.test.ts` — the assertion
  `expect(h.calls()).toContain('spawn demo-quiet-basin resume')`
- Test: `server/test/ccd-spawn-split.test.ts` (extend)

**Interfaces:**
- Consumes: `_spawn_start`, `_spawn_settle` (Task 3), `_reg_claim` (Task 2), `SPAWN_SETTLE_S` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-spawn-split.test.ts`:

```ts
import { WS_ADD_REAL_SPAWN } from './ccdWsHelpers.js';

describe('ws-add writes the claim and the supervision BEFORE anything blocks', () => {
  const addOne = (env: NodeJS.ProcessEnv = {}): void => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo; :`, env);
  };

  it('claims and supervises before the settle — asserted by ORDER, not assumed', () => {
    addOne();
    const calls = h.calls();
    const news    = calls.findIndex((c) => c.startsWith('tmux new-session'));
    const superv  = calls.findIndex((c) => c === 'supervise demo-quiet-mesa');
    const accept  = calls.findIndex((c) => c.startsWith('accept '));
    expect(news).toBeGreaterThanOrEqual(0);
    expect(superv).toBeGreaterThan(news);
    expect(accept).toBeGreaterThan(superv);
    expect(h.reg('demo-quiet-mesa', 'started')).toBe('1');
  });

  // H6 / F8, directly: the workspace a KILLED ws-add leaves behind is an
  // ordinary restartable session, not a live pane no row claims and no unit
  // watches. This is also what makes the deploy's supervisor sweep safe at any
  // moment.
  it('a settle that never returns still leaves a CLAIMED, SUPERVISED workspace', () => {
    h.makeRepo('demo');
    // The settle is the only half that can be killed; model it as a refusal
    // that arrives after the claim, and prove both writes already landed.
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo; :`, { ACCEPT_RC: '4' });
    expect(h.reg('demo-quiet-mesa', 'started')).toBe('1');
    expect(h.calls()).toContain('supervise demo-quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('still returns the rc and withholds the success line on rc 4', () => {
    h.makeRepo('demo');
    let code = 0;
    try { h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`, { ACCEPT_RC: '4' }); }
    catch (e) { code = (e as { status?: number }).status ?? 1; }
    expect(code).toBe(4);
  });

  it('ws-restore takes the same shape, and gives the reap lock back before the settle', () => {
    // The settle can block for SPAWN_SETTLE_S; holding a reap lock across it
    // would refuse every ws-reap on this id for four minutes.
    //
    // NOT `indexOf('exec {lfd}>&-')` — that finds the FIRST occurrence, and
    // `cmd_ws_restore` already closes the fd inside its flock-REFUSAL block
    // (`flock -n "$lfd" || { exec {lfd}>&-; die "another ccd process is
    // reaping $id …" }`), which precedes everything. The mutant this test
    // exists to kill would survive it. Anchor on the release site's own
    // comment instead, and pin the count so a third close cannot appear
    // unnoticed.
    const t = h.sh('type cmd_ws_restore');
    expect(t.split('exec {lfd}>&-').length - 1).toBe(2);
    expect(t.indexOf('GIVEN BACK BEFORE THE SETTLE')).toBeGreaterThan(-1);
    expect(t.indexOf('GIVEN BACK BEFORE THE SETTLE')).toBeLessThan(t.indexOf('_spawn_settle'));
    expect(t.indexOf('_reg_claim')).toBeLessThan(t.indexOf('_spawn_settle'));
    expect(t.indexOf('_ws_supervise')).toBeLessThan(t.indexOf('_spawn_settle'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts
```
Expected: `expected -1 to be greater than 3` — `accept` currently precedes `supervise demo-quiet-mesa`
because `_spawn` still blocks first; and the `cmd_ws_restore` case fails with
`expected … to be less than -1` (no `_spawn_settle` in its body).

- [ ] **Step 3: Write minimal implementation**

In `cmd_ws_add`, replace the block that currently reads

```bash
  local rc; _spawn "$id" new; rc=$?
  _reg_claim "$id"
  _ws_supervise "$id"
  if [[ "$rc" -eq 3 || "$rc" -eq 4 || "$rc" -eq 5 ]]; then
```

with

```bash
  # THE ORDERING IS THE FIX (F8). The pane is created, THEN the claim, THEN the
  # supervision, and only THEN the blocking wait. Killed anywhere after the
  # first line — the agent's 300s ws-add ceiling, a deploy sweep, a SIGTERM —
  # what is left is an ordinary session: claimed, supervised, restartable. What
  # F8 left was a live pane no registry row claimed and no unit was watching,
  # invisible to `ccd ls`, to the PWA and to ws-gc alike.
  #
  # This is also what makes #50's LOUD non-zero exit on rc 3/4/5 safe. It was
  # not safe before: a non-zero ws-add used to mean "an orphan was created". It
  # now means "the session exists, is claimed, is supervised, and did not
  # confirm its TUI".
  local fs rc
  fs=$(_spawn_start "$id" new)
  fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
  _reg_claim "$id"
  _ws_supervise "$id"
  _spawn_settle "$id" "$fs"; rc=$?
  if [[ "$rc" -eq 3 || "$rc" -eq 4 || "$rc" -eq 5 ]]; then
```

In `cmd_ws_restore`, the block currently reading

```bash
  local rc; _spawn "$id" resume; rc=$?
  _reg_claim "$id"
  _ws_supervise "$id"
```
followed by the `exec {lfd}>&-` comment block and `exec {lfd}>&-`, becomes:

```bash
  # THE SAME F8 SHAPE, converted the same way — and this verb's agent budget is
  # CCD_VERB_TIMEOUT_MS['ws-restore'] = 60s, FIVE TIMES TIGHTER than the ws-add
  # budget whose expiry caused F8. The kill is likelier here, not less.
  local fs rc
  fs=$(_spawn_start "$id" resume)
  fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
  _reg_claim "$id"
  _ws_supervise "$id"
  # GIVEN BACK BEFORE THE SETTLE, not after it — the reason `cmd_ws_reap` gives
  # at its own close applies unchanged (`flock` treats two `open()`s of one path
  # in one process as two strangers, and ccd is SOURCED), and the settle can now
  # block for SPAWN_SETTLE_S: holding the reap lock across it would answer
  # `in-progress` to every ws-reap on this id for four minutes. The undo (archive
  # stamps gone) is real either way, which is what made the old placement
  # unconditional too.
  exec {lfd}>&-
  _spawn_settle "$id" "$fs"; rc=$?
```

In `server/test/ccd-archive.test.ts`, the `ARCH` stub now shadows `_spawn_start`, so the assertion
`expect(h.calls()).toContain('spawn demo-quiet-basin resume')` becomes
`expect(h.calls()).toContain('spawn_start demo-quiet-basin resume')`.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-archive.test.ts test/ccd-workspaces.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts test/ccd-hold.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-spawn-split.test.ts server/test/ccd-archive.test.ts
git commit -m "fix(ccd): ws-add and ws-restore claim and supervise before they block (F8)

The pane, then the claim, then the supervision, then the wait. Killed at the
agent's ceiling, what is left is an ordinary restartable session instead of a
live pane no row claimed and no unit watched. ws-restore also gives the reap
lock back before the settle, which can now block for SPAWN_SETTLE_S."
```

---

### Task 8: §1.1 ordering — `_supervised_start`'s two fallbacks, `cmd_start`, `cmd_ensure`

New scope the spec did not originally cover: **a fallback that still spawns-first re-opens the hole
on exactly the boxes least able to recover** (no systemd, or a unit that will not enable).

Two things this task does **not** do, and both are deliberate:

- **`cmd_start`'s out-of-unit path is already fixed and this task does not claim it.** Since #50 it
  calls `_supervised_start`, which runs `systemctl --user reset-failed` and `enable --now` **before**
  any spawn and polls a bounded `SUPERVISED_START_WAIT` (30 s). The spec's claim that `cmd_start`
  carries the identical F8 ordering is **struck**.
- **`cmd_ensure`'s in-unit branch must not supervise.** `cmd_supervise` **is** the unit's `ExecStart`
  and reaches `cmd_ensure` with `CCD_IN_UNIT=1`; supervising there would have the unit
  `enable --now` itself on every restart. ccd records that as an explicit decision.

**Files:**
- Modify: `ccd/ccd` — `_supervised_start`'s two fallback blocks, `cmd_start`'s in-unit branch,
  `cmd_ensure`'s in-unit branch
- Test: `server/test/ccd-supervised-start.test.ts` (extend), `server/test/ccd-start-id.test.ts` (extend)

**Interfaces:**
- Consumes: `_spawn_start`, `_spawn_settle`, `_reg_claim`, `SPAWN_SETTLE_S`, `cmd_ensure <id> [bound_s]`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-supervised-start.test.ts`:

```ts
describe('_supervised_start\'s fallbacks take the split form', () => {
  it('the no-systemctl fallback claims BETWEEN the halves', () => {
    seed('claude-demo');
    h.sh(`_have_systemctl() { return 1; }
          _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; echo 0; }
          _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; return 0; }
          _supervised_start claude-demo; :`);
    const calls = h.calls();
    expect(calls).toEqual([
      'spawn_start claude-demo new',
      'spawn_settle claude-demo',
    ]);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('the enable-failed fallback does the same — the boxes least able to recover', () => {
    seed('claude-demo');
    h.sh(`systemctl() { case "$*" in *"enable --now"*) return 1 ;; esac; return 0; }
          _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; echo 0; }
          _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; return 0; }
          _supervised_start claude-demo 2>/dev/null; :`);
    expect(h.calls()).toEqual(['spawn_start claude-demo new', 'spawn_settle claude-demo']);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('picks resume when the row is already claimed', () => {
    seed('claude-demo');
    h.sh(`_reg_claim claude-demo
          _have_systemctl() { return 1; }
          _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; echo 0; }
          _spawn_settle() { :; }
          _supervised_start claude-demo; :`);
    expect(h.calls()).toContain('spawn_start claude-demo resume');
  });
});
```

Append to `server/test/ccd-start-id.test.ts`:

```ts
describe('cmd_start / cmd_ensure: the in-unit branch takes the split form', () => {
  const HALVES = `_spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; echo 0; };
    _spawn_settle() { echo "spawn_settle $1 $3" >> "$HOME/ccd-calls"; return 0; };
    _alive() { return 1; }; _resupervise_live() { return 1; };
    tmux() { :; }; systemctl() { :; }; sleep() { :; };`;

  it('cmd_start claims BETWEEN the halves in-unit', () => {
    h.sh(`_reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir '${h.home}'
          _reg_set claude-demo uuid deadbeef
          CCD_IN_UNIT=1; ${HALVES} cmd_start claude-demo; :`);
    const calls = h.calls();
    expect(calls[0]).toBe('spawn_start claude-demo new');
    expect(calls[1]).toMatch(/^spawn_settle claude-demo/);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('cmd_start\'s SUPERVISED branch keeps its claim exactly where it was', () => {
    // Load-bearing when the unit never comes up: a failed revival must
    // classify `orphan`, not `never-started`.
    const t = h.sh('type cmd_start');
    expect(t).toMatch(/_supervised_start "\$id"; rc=\$\?[\s\S]{0,2000}?_reg_claim "\$id"/);
  });

  it('cmd_ensure threads its bound into the settle, and does NOT supervise in-unit', () => {
    h.sh(`_reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir '${h.home}'
          _reg_set claude-demo uuid deadbeef
          _reg_claim claude-demo
          CCD_IN_UNIT=1; ${HALVES} cmd_ensure claude-demo 999; :`);
    expect(h.calls()).toContain('spawn_settle claude-demo 999');
    // cmd_supervise IS the unit's ExecStart and reaches here with
    // CCD_IN_UNIT=1; supervising would have the unit enable --now itself on
    // every restart.
    expect(h.sh('type cmd_ensure')).not.toContain('_ws_supervise');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts test/ccd-start-id.test.ts
```
Expected: `expected [] to deeply equal [ 'spawn_start claude-demo new', 'spawn_settle claude-demo' ]`
(the fallbacks still call `_spawn`, which the snippet does not stub, so nothing is recorded), and
`expected [ 'spawn_settle claude-demo ' ] to contain 'spawn_settle claude-demo 999'`.

- [ ] **Step 3: Write minimal implementation**

In `_supervised_start`, **both** fallback blocks — currently

```bash
    local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
    _spawn "$id" "$mode"; rc=$?
    _reg_claim "$id"
    return "$rc"
```

become

```bash
    # THE SPLIT FORM HERE TOO. A fallback that still spawns-first re-opens F8's
    # hole on exactly the boxes least able to recover: no systemd at all, or a
    # unit that will not enable. There is no `_ws_supervise` on this path by
    # construction — that is what "UNSUPERVISED" in the warning above means.
    local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
    local fs; fs=$(_spawn_start "$id" "$mode")
    fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
    _reg_claim "$id"
    _spawn_settle "$id" "$fs"; rc=$?
    return "$rc"
```

In `cmd_start`'s in-unit branch, currently

```bash
  local rc; _spawn "$id" "$mode"; rc=$?
  # `started` stays unconditional: it records that this row has HAD a session, which is what §4.3's
  # never-started rung reads. A spawn that failed is still a row that was started — it classifies
  # `orphan`, which is the honest answer, not `never-started`.
  _reg_claim "$id"
```

becomes

```bash
  # SPLIT, so the claim precedes the blocking wait. IT MUST NOT SUPERVISE, and
  # that must stay: `cmd_supervise` IS the unit's ExecStart and reaches
  # `cmd_ensure` with CCD_IN_UNIT=1, so supervising here would have the unit
  # `enable --now` itself on every restart — ccd records that as an explicit
  # decision ("ccd ensure does NOT re-supervise … boot persistence would be
  # silently lost") and this build does not overturn it.
  local fs rc
  fs=$(_spawn_start "$id" "$mode")
  fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
  # `started` records that this row has HAD a session, which is what §4.3's
  # never-started rung reads. A spawn that failed is still a row that was
  # started — it classifies `orphan`, the honest answer.
  _reg_claim "$id"
  _spawn_settle "$id" "$fs"; rc=$?
```

In `cmd_ensure`'s in-unit branch, currently

```bash
  local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
  local rc; _spawn "$id" "$mode"; rc=$?
  _reg_claim "$id"
```

becomes

```bash
  # WRONG-MODE RESURRECTION IS FIXED BY THE MOVE, not by a new check: `ensure`
  # picks mode=new when `started` is empty, handing `--session-id '<uuid>'` to a
  # wrapper for a uuid whose session-env directory already exists (measured on
  # the live orphan). With `started` written at session-creation time it picks
  # `resume`.
  local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
  local fs rc
  fs=$(_spawn_start "$id" "$mode")
  fs="${fs##*$'\n'}"; [[ "$fs" == 1 ]] || fs=0
  _reg_claim "$id"
  _spawn_settle "$id" "$fs" "$bound"; rc=$?
```

(`$bound` is `cmd_ensure`'s second positional from Task 5; the `_spawn "$id" "$mode" "$bound"` that
task left behind is replaced here.)

**RESIDUAL RISK, stated not buried — and NARROWED by Task 11.** `cmd_start` and `cmd_ensure`
**both return early on `_alive`**, and F8's residue HAS a live pane, so **no ccd verb ever reaches
`_spawn_start` for an existing orphan** and nothing in this section changes that.

What Task 11 changes is that the alive path is no longer inert: `_resupervise_live` now adopts an
`unclaimed` row — it writes `_reg_claim` and runs `enable --now` — so `ccd ensure <id>` (and the
PWA's *Restart session*, which posts `/ensure`) **does** repair `swift-harbor`-class residue,
without a second spawn. That is exactly ruling 1's *"detect on the next verb, write `started`,
enable the unit"*, and it is what makes w1-srv Task 105's sheet copy true.

The class that stays unrepaired is the OTHER one, and it is the opposite shape: a row with
`started=1`, a **dead** pane and no unit — three of those exist live. `orphan` already names it and
its repair is a PROCESS, not a claim. Explicitly accepted by the operator on 2026-08-15.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts test/ccd-start-id.test.ts test/ccd-session-state.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-swap-carry.test.ts test/ccd-spawn-split.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-supervised-start.test.ts server/test/ccd-start-id.test.ts
git commit -m "fix(ccd): the remaining four spawn paths claim before they block

_supervised_start's two fallbacks are new scope: a fallback that still
spawns-first re-opens the hole on exactly the boxes least able to recover.
cmd_start and cmd_ensure convert their in-unit branches; the supervised-branch
claims stay where they are, load-bearing when the unit never comes up.
cmd_start's out-of-unit path was already fixed by #50 and is untouched."
```

---

### Task 9: `_spawn_start` retries `--resume` once as `--session-id`

`started` is monotone — written at session-creation time and never cleared (Task 2 pins that there
is no `_reg_del`/`_reg_unset` anywhere in ccd). So a row whose session never really came up resumes
a uuid with no transcript behind it **forever**, on every retry and every `Restart=always` cycle.
`_spawn`'s own shipped rc-3/rc-4 warnings name the same trap from the other side ("if the session
never came up, clear `$REG/$id.started` first") — corroboration that the hazard is real, and an
argument for the automatic fallback over a manual one.

**Files:**
- Modify: `ccd/ccd` — `_spawn_start`, after its `tmux new-session -d -s "$tname" …` call
- Test: `server/test/ccd-spawn-split.test.ts` (extend)

**Interfaces:**
- Consumes / Produces: `_spawn_start <id> <mode>` — unchanged signature and unchanged stdout contract.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-spawn-split.test.ts`:

```ts
describe('_spawn_start: the --resume fallback started is monotone owes', () => {
  /** A tmux whose `--resume` new-session leaves no pane (the wrapper exits on a
   *  uuid with no transcript) but whose `--session-id` one does. */
  const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

  it('retries ONCE with --session-id when the resume produced no session', () => {
    seed('myid');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    const news = h.calls().filter((c) => c.startsWith('tmux new-session'));
    expect(news).toHaveLength(2);
    expect(news[0]).toContain('--resume');
    expect(news[1]).toContain('--session-id');
  });

  it('does NOT retry when the resume worked', () => {
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(1);
  });

  it('does NOT retry a `new` spawn — there is nothing to fall back to', () => {
    seed('myid');
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
          _spawn_start myid new`);
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(1);
  });

  it('retries at most once — never a loop', () => {
    seed('myid');
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
          _spawn_start myid resume`);
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts
```
Expected: `expected [ 'tmux new-session -d -s cc-myid …' ] to have a length of 2 but got 1`.

- [ ] **Step 3: Write minimal implementation**

In `_spawn_start`, immediately after the `tmux new-session -d -s "$tname" …` invocation and before
the three `tmux set-option` lines:

```bash
  # THE PRICE OF A MONOTONE `started`, paid automatically instead of by hand.
  # Nothing in ccd ever clears the field (no _reg_del, no _reg_unset — grepped,
  # zero hits), so once a row is claimed every later revival picks
  # mode=resume. If the session never really came up, `--resume '<uuid>'` names
  # a uuid with no transcript behind it and the wrapper exits immediately —
  # forever, on every retry AND every Restart=always cycle. `_spawn_settle`'s
  # own rc 3/4 warnings name this trap from the other side ("if the session
  # never came up, clear $REG/$id.started first"); this is that escape hatch,
  # taken once, automatically.
  #
  # ONCE, never a loop, and only on `resume`: a `new` spawn has nothing to fall
  # back to. The short settle is what makes `has-session` mean anything — the
  # wrapper's exit is not instantaneous, and `tmux new-session -d` returns 0
  # whether or not the command it launched survives.
  if [[ "$mode" == "resume" ]]; then
    sleep 2
    if ! tmux has-session -t "$tname" 2>/dev/null; then
      echo "ccd: $id: --resume '$uuid' left no session; retrying once with --session-id" >&2
      tmux new-session -d -s "$tname" -x 220 -y 50 \
        "cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' --remote-control '$id' --session-id '$uuid' --dangerously-skip-permissions"
    fi
  fi
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-spawn-verdict.test.ts test/ccd-archive.test.ts test/ccd-supervised-start.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-spawn-split.test.ts
git commit -m "fix(ccd): _spawn_start falls back from --resume to --session-id, once

started is monotone and nothing in ccd clears it, so a row whose session never
came up resumes a transcript-less uuid forever, on every retry and every
Restart=always cycle. ccd's own rc 3/4 warnings already name the trap and tell
a human to clear the field; this takes the escape hatch automatically, once,
and only on a resume."
```

---

### Task 10: A per-project `flock` on `ws-add`

**The PWA documents the double-tap hazard as a known unfixed property in THREE places, not one, and
none of them is where the spec's prose says.** Verified at `d7137c2`:
`pwa/src/screens/FleetScreen.tsx` — **not** `pwa/src/fleet/FleetScreen.tsx`, which does not exist —
carries the canonical six-line block at line 120; `pwa/src/fleet/ProjectCard.tsx` carries a
condensed copy on the `adding?: boolean` prop; `pwa/test/project-card.test.tsx` restates it in a
test comment. This task owns the canonical sentence (FleetScreen) and fixes ProjectCard with it;
the test-side copy in `pwa/test/fleet-screen.test.tsx` belongs to **w1-srv Task 108** and the one
in `pwa/test/project-card.test.tsx` is fixed here.

This closes the concurrent case; it does **not** close retry-after-502, because the lock releases
before the settle. §1.5's dispatch adoption (TypeScript half) closes that one.

`ccd` already uses `flock -n` twice (`cmd_ws_restore`, `cmd_ws_reap`), so both the idiom and the
non-blocking polarity are established — including the `exec {lfd}>&-` fd hygiene, which is
load-bearing because **ccd is sourced by its own tests and `flock` treats two `open()`s of one path
in one process as strangers**.

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_add`, from just above `[[ -n "$slug" ]] && { _ws_slug_valid "$slug" …`
  through just after `_ws_seed_home "$id" "$hw"`
- Modify: `pwa/src/screens/FleetScreen.tsx` — the six-line comment block identified by its first
  line, verbatim: `  // In-flight per PROJECT, because ccd does not dedupe: ws-add draws a fresh`
- Modify: `pwa/src/fleet/ProjectCard.tsx` — the `adding?: boolean` prop's docstring, identified by
  its first line, verbatim: `  /** This project's own ws-add is in flight. ccd does not dedupe concurrent`
- Test: `server/test/ccd-spawn-split.test.ts` (extend)
- Test: `pwa/test/project-card.test.tsx` — the comment restating the same claim

**Interfaces:**
- Produces: refusal `busy: another ws-add for <project> is in flight` on stderr at exit 1
  (via `die`, so the emitted line is `ccd: busy: another ws-add for <project> is in flight`).
  Lock file: `$REG/.ws-add-<project>.lock`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-spawn-split.test.ts`:

```ts
describe('ws-add serialises per project', () => {
  it('refuses a second ws-add for the same project while one is in flight', () => {
    h.makeRepo('demo');
    // A REAL concurrent flock holder, the ccd-ws-reap.test.ts idiom: a
    // background shell takes the lock and sits on it while ws-add tries.
    let out = '';
    try {
      out = h.sh(
        `${WS_ADD_REAL_SPAWN}
         exec {hold}>>"$REG/.ws-add-demo.lock"; flock -n "$hold" || exit 90
         CCD_WS_SLUG=quiet-mesa cmd_ws_add demo 2>&1`);
    } catch (e) { out = String((e as { stdout?: string; stderr?: string }).stderr ?? ''); }
    expect(out).toContain('busy: another ws-add for demo is in flight');
    // AND NOTHING WAS CREATED — the refusal leaves the box as it found it.
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('does NOT serialise across projects — the lock is per project', () => {
    h.makeRepo('demo'); h.makeRepo('other');
    const out = h.sh(
      `${WS_ADD_REAL_SPAWN}
       exec {hold}>>"$REG/.ws-add-demo.lock"; flock -n "$hold" || exit 90
       CCD_WS_SLUG=quiet-mesa cmd_ws_add other 2>&1`);
    expect(out).not.toContain('busy:');
    expect(h.reg('other-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('gives the descriptor back — a second ws-add in the SAME process is not refused', () => {
    // ccd is SOURCED by its own tests, and flock treats two open()s of one path
    // in one process as strangers. Without `exec {lfd}>&-` the second add here
    // would refuse itself.
    h.makeRepo('demo');
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo
          ${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-lake cmd_ws_add demo; :`);
    expect(h.reg('demo-quiet-lake', 'uuid')).not.toBeNull();
  });

  it('releases BEFORE the settle — the lock does not span the blocking wait', () => {
    // NOT `indexOf('exec {lfd}>&-')`: this task ADDS an earlier occurrence
    // inside the flock-refusal block, exactly as `cmd_ws_restore` already has
    // one, so a first-match anchor resolves to the refusal path and passes no
    // matter where the real release lands. Anchor on the release site's own
    // comment and pin the count.
    const t = h.sh('type cmd_ws_add');
    expect(t.split('exec {lfd}>&-').length - 1).toBe(2);
    expect(t.indexOf('GIVEN BACK HERE')).toBeGreaterThan(-1);
    expect(t.indexOf('GIVEN BACK HERE')).toBeLessThan(t.indexOf('_spawn_settle'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts
```
Expected: the first case creates the workspace instead of refusing —
`expected 'workspace demo-quiet-mesa on claude — …' to contain 'busy: another ws-add for demo is in flight'`.

- [ ] **Step 3: Write minimal implementation**

In `cmd_ws_add`, immediately above the `# The refusal NAMES WHAT IT FOUND.` comment block that
precedes `[[ -n "$slug" ]] && { _ws_slug_valid "$slug" …`:

```bash
  # PER PROJECT, and it spans slug selection through the last registry write —
  # `_reg_set "$id" branch "$branch"` and `_ws_seed_home "$id" "$hw"`, the two
  # fields a racing second ws-add would most visibly corrupt. Two concurrent
  # adds are not hypothetical: an operator double-tap, a second tab, a second
  # device and the coordinator's own HTTP call all reach here, and the PWA's
  # only guard is React state that does not survive a reload.
  #
  # `-n`, matching ccd's two existing flock sites: a loser REFUSES rather than
  # queueing behind a worktree checkout. It deliberately does NOT cover
  # `$main/.ccrc/workspace.sh` (an arbitrary user script with no bound) nor the
  # settle — so it does NOT close retry-after-502; §1.5's dispatch adoption does.
  command -v flock >/dev/null 2>&1 \
    || die "flock (util-linux) is unavailable — refusing to create a workspace unserialised"
  local addlock="$REG/.ws-add-$project.lock" lfd
  exec {lfd}>>"$addlock" || die "cannot open the ws-add lock at $addlock"
  flock -n "$lfd" || {
    exec {lfd}>&-
    die "busy: another ws-add for $project is in flight"
  }
```

and immediately after `_ws_seed_home "$id" "$hw"`:

```bash
  # GIVEN BACK HERE, before the setup hook and long before the settle, for the
  # reason cmd_ws_reap states at its own close: `flock` treats two `open()`s of
  # one path in one process as two strangers, and ccd is SOURCED — by `ccd`
  # itself and by its tests — so a descriptor left open would refuse the next
  # ws-add for this project in the same shell for ever. The `die`s above need no
  # close of their own: `die` exits, and the kernel closes what exits.
  exec {lfd}>&-
```

In `pwa/src/screens/FleetScreen.tsx`, the six-line block that reads, verbatim:

```tsx
  // In-flight per PROJECT, because ccd does not dedupe: ws-add draws a fresh
  // random slug on every call and only checks it against the registry, so two
  // concurrent calls both succeed — two worktrees, two branches, two systemd
  // units, two of three account lanes consumed. And the window is not a
  // moment: _spawn runs synchronously and _accept_first_run_prompts waits up to
  // ~15 minutes for a big resume, with nothing on screen to say so.
```

becomes:

```tsx
  // In-flight per PROJECT — a COURTESY now, no longer the gate. ccd's own
  // `cmd_ws_add` takes a per-project `flock -n` spanning slug selection through
  // the last registry write and refuses a second concurrent add with
  // `busy: another ws-add for <project> is in flight`, so the two-worktrees
  // outcome this comment used to describe as unfixed is closed on the box —
  // which matters, because React state does not survive a reload and never
  // covered a second tab, a second device, or the coordinator's own HTTP call.
  // This state is kept because it spares the operator a round trip and a
  // refusal toast, not because it prevents anything.
  //
  // The window is bounded too: the settle is capped at SPAWN_SETTLE_S (240s) on
  // this path, not the ~15 minutes an unbounded `_accept_first_run_prompts`
  // used to allow — and a settle that runs out is now a REPORT against a
  // workspace that exists, is claimed and is supervised, not an orphan.
```

In `pwa/src/fleet/ProjectCard.tsx`, the `adding?: boolean` docstring, verbatim:

```tsx
  /** This project's own ws-add is in flight. ccd does not dedupe concurrent
   *  ws-adds, and the spawn window runs to minutes. */
```

becomes:

```tsx
  /** This project's own ws-add is in flight. ccd DOES serialise concurrent
   *  ws-adds per project now (a `flock -n` in `cmd_ws_add`, refusing with
   *  `busy: …`), so this is a courtesy that saves a round trip — see
   *  `FleetScreen`'s own note for the full argument. The spawn window is
   *  bounded at SPAWN_SETTLE_S. */
```

In `pwa/test/project-card.test.tsx`, the test comment restating "ccd does not dedupe" gains the
same correction in one line: ccd refuses the second add; the prop is a courtesy.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-workspaces.test.ts test/ccd-ws-reap.test.ts test/ownership.test.ts
cd pwa && npm run build && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx test/project-card.test.tsx
```

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-spawn-split.test.ts pwa/src/screens/FleetScreen.tsx pwa/src/fleet/ProjectCard.tsx pwa/test/project-card.test.tsx
git commit -m "fix(ccd): ws-add takes a per-project flock

The double-tap hazard FleetScreen documents as a known unfixed property, closed
where it can be closed: the lock spans slug selection through the last registry
write, refuses (never queues), and is released before the setup hook and long
before the settle — so it does not close retry-after-502. FleetScreen's comment
is corrected in the same commit."
```

---

### Task 11: `ccd ensure` repairs an `unclaimed` pane — `_resupervise_live` widens

**PREREQUISITE: w1-srv Task 102 must be in.** That task adds `unclaimed` to `SessionLifecycle` AND
adds the rung to `_session_state` in one atomic commit. This task edits the ONE shipped consumer of
`_session_state`'s answer, and it is a **regression fix for a break Task 102 creates**.

**The break, verified at `d7137c2`.** `_resupervise_live` (added by PR #50) gates on one exact line:

```bash
  [[ "$(_session_state "$id")" == unsupervised ]] || return 1
```

F8's residue — a live pane, a fresh heartbeat, **no `started`** — answers `unsupervised` today, so
`ccd ensure` reaches `enable --now` and adopts it. The moment `unclaimed` becomes the first rung
inside the `_alive` branch, that same row answers `unclaimed`, this gate returns 1, and **PR #50's
repair path stops firing on exactly the population it was written for.** Nothing else in the plan
touches that line.

**And the repair is a CLAIM as well as a process.** `cmd_ensure`'s alive branch is, verbatim:

```bash
  if _alive "$id"; then
    _resupervise_live "$id"
    echo "alive: $id"; return 0
  fi
```

It never reaches `_spawn_start`, so it never reaches Task 7/8's `_reg_claim`. Without this task the
contract's ruling 1 (*"Detect on the next verb, write `started`, enable the unit; the workspace
becomes ordinary"*) is implemented by **no task at all**, and w1-srv Task 105's sheet copy — *"the
same thing `ccd ensure <id>` does at a terminal"* — is **false**. This task is what makes it true.

`_reg_claim` goes inside `_resupervise_live`, not in `cmd_ensure`, because `_resupervise_live` is
the one place that discriminates the row shapes; putting it in `cmd_ensure` would claim a `running`
row too, and `running` must stay the cheap no-op PR #50's own comment insists on.

**Files:**
- Modify: `ccd/ccd` — `_resupervise_live`, identified by its header
  `_resupervise_live() {   # id -> rc 0 it adopted (or tried), rc 1 there was nothing to adopt.`
  and by the gate line `  [[ "$(_session_state "$id")" == unsupervised ]] || return 1`
- Test: `server/test/ccd-start-id.test.ts` (extend)

**Interfaces:**
- Consumes: `_session_state` answering `unclaimed` (w1-srv Task 102); `_reg_claim <id>` (Task 2).
- Produces: `_resupervise_live` returns 0 for `unsupervised` **and** `unclaimed`, and writes the
  claim on the `unclaimed` branch. `cmd_ensure`/`cmd_start`/`cmd_enable` inherit it unchanged.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-start-id.test.ts`:

```ts
describe('an UNCLAIMED live pane is adopted, not ignored', () => {
  /** F8's residue exactly: a live pane, a fresh `supervised` stamp, and NO
   *  `started` file. The row a killed `ws-add` left behind. */
  const seedUnclaimed = (id: string, project: string): void => {
    fs.mkdirSync(path.join(h.home, 'projects', project), { recursive: true });
    h.sh(`_reg_set ${id} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
      _reg_set ${id} project ${project}
      _reg_set ${id} workdir "$HOME/projects/${project}"
      _reg_set ${id} wrapper claude2
      printf '%s' "$(( $(date +%s) - 5 ))" > "$REG/${id}.supervised"`);
  };

  const ALIVE = `_alive() { return 0; }; `
    + `_have_systemctl() { return 0; }; `
    + `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };`;

  it('writes the claim — the repair `unclaimed` names is a CLAIM, not a process', () => {
    seedUnclaimed('demo-quiet-basin', 'demo');
    expect(h.reg('demo-quiet-basin', 'started')).toBeNull();
    h.sh(`${ALIVE} _resupervise_live demo-quiet-basin >/dev/null; :`);
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
  });

  it('and enables the unit, so `ccd ensure` on the row is a real repair', () => {
    seedUnclaimed('demo-quiet-basin', 'demo');
    const r = run(`${ALIVE} cmd_ensure demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(h.calls()).toContain('systemctl --user enable --now claude-session@demo-quiet-basin');
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
    // NO SPAWN. The pane is alive; adopting it must not mint a second one.
    expect(h.calls().filter((c) => c.startsWith('spawn'))).toEqual([]);
  });

  it('a `running` row stays the cheap no-op PR #50 deliberately made it', () => {
    // The gate widens by exactly one word. A claimed, freshly-supervised row is
    // `running`, and an `enable --now` per PWA Restart tap on a healthy fleet
    // is the round trip nobody asked for.
    seedUnclaimed('demo-quiet-lake', 'demo');
    h.sh(`printf 1 > "$REG/demo-quiet-lake.started"`);
    h.sh(`${ALIVE} _resupervise_live demo-quiet-lake >/dev/null; :`);
    expect(h.calls()).toEqual([]);
  });

  it('an `unsupervised` row still adopts — PR #50’s own population is untouched', () => {
    seedUnclaimed('demo-warm-mesa', 'demo');
    h.sh(`printf 1 > "$REG/demo-warm-mesa.started"; rm -f "$REG/demo-warm-mesa.supervised"`);
    h.sh(`${ALIVE} _resupervise_live demo-warm-mesa >/dev/null; :`);
    expect(h.calls()).toContain('systemctl --user enable --now claude-session@demo-warm-mesa');
  });

  it('the gate names both words, and the claim is on the unclaimed branch only', () => {
    // MUTATION: narrow the gate back to `== unsupervised` and the first two
    // cases red; move `_reg_claim` above the gate and the `running` case reds.
    const t = h.sh('type _resupervise_live');
    expect(t).toMatch(/unsupervised\|unclaimed/);
    expect(t).toContain('_reg_claim');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-start-id.test.ts
```
Expected, with Task 102 already in: `expected null to be '1'` on the first case (the gate answers
`unclaimed`, `_resupervise_live` returns 1, nothing is written), `expected [] to contain
'systemctl --user enable --now claude-session@demo-quiet-basin'` on the second, and
`expected '…' to match /unsupervised\|unclaimed/` on the last.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, inside `_resupervise_live`, the line

```bash
  [[ "$(_session_state "$id")" == unsupervised ]] || return 1
```

becomes

```bash
  # TWO SHAPES, ONE ADOPTION — and `unclaimed` is why this line is not a
  # single-word comparison any more. Wave 1 made `unclaimed` the FIRST rung
  # inside `_session_state`'s alive branch, so F8's residue (a live pane with a
  # fresh heartbeat and no claim) stopped answering `unsupervised` — which is
  # the population this function was written for in the first place. Narrowing
  # it back would silently delete PR #50's repair path for the exact rows this
  # build exists to name.
  local state; state=$(_session_state "$id")
  case "$state" in unsupervised|unclaimed) : ;; *) return 1 ;; esac
  # THE CLAIM IS HALF THE REPAIR, and only on this branch. `unclaimed`'s repair
  # is a CLAIM (a process is running that no row claims); `orphan`'s is a
  # PROCESS. Both `cmd_ensure` and `cmd_start` early-return on `_alive` and so
  # never reach `_spawn_start`'s `_reg_claim` — without this write, `ccd ensure`
  # on a live unclaimed pane would enable a unit and leave the row unclaimed for
  # ever, and the PWA's "Restart session" would keep promising a repair it does
  # not perform. A `running` row must NOT be claimed here: it already is.
  [[ "$state" == unclaimed ]] && _reg_claim "$id"
```

Update the function's own docstring, which currently says `Scoped to the row that needs it,
deliberately. \`running\` (a fresh heartbeat) must stay the cheap no-op \`ensure\` has always been`:
keep that sentence — it is still exactly true — and add one line naming the second row shape and
the claim.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-start-id.test.ts test/ccd-supervised-start.test.ts test/ccd-session-lifecycle.test.ts test/ccd-swap-refuse.test.ts test/ownership.test.ts
```
Then the two mutations by hand: narrow the `case` back to `unsupervised)` alone (the first two cases
must red), and move `_reg_claim` above the `case` (the `running` case must red).

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd server/test/ccd-start-id.test.ts
git commit -m "fix(ccd): _resupervise_live adopts an unclaimed pane, and writes the claim

Regression guard AND the missing half of ruling 1. Making `unclaimed` the first
rung inside _session_state's alive branch moved F8's residue out of the one
gate PR #50 wrote for it, so `ccd ensure` would have stopped repairing exactly
the rows this build names. The gate now matches both words, and on the
unclaimed branch it writes _reg_claim — because cmd_ensure and cmd_start both
early-return on _alive and never reach _spawn_start's claim, so without this
the PWA's Restart button promised a repair it did not perform."
```

---

### Task 12: `ws-audit` reports `alive`, `started` and `unit`

**They must be computed BEFORE `_ws_reap_eval`'s early refusal.** That refusal returns
`not-archived` and leaves every downstream field null — exactly the shape that made F8's orphan
invisible to the one artifact whose job is answering "what is the state of this workspace". `_alive`
appears **nowhere** in `cmd_ws_audit` today.

The verb stays read-only and `['ws-audit','--session']` is already whitelisted, so this adds **no
exec surface**.

**THE PROBE MUST BE `list-units`, NOT `systemctl show`:** `show` on an uninstantiated template
reports `LoadState=loaded`, which is why a naive check misreads this — measured live, where
`list-units` returned exactly 18 rows and the six ids absent from it had no unit loaded at all.

**THE SHARED HALF SHIPS IN THIS COMMIT, not in the server section**, and that placement is
load-bearing. `reviveWsAudit` reads `exists`/`headMatchesRegistry` with `reqBool`, which **throws**
on an absent key, so the type widening cannot be green without its ccd emitter — and, more
importantly, the **absent-key degrade has to be decided beside the writer**. An older `ccd` on the
fleet host omits all three fields (the AGENT-FIRST lane closes that window, but a rolled-back ccd
or a second fleet host reopens it), so `reqBool` here would make the first `ws-audit` against a
stale box **throw** and the sheet render nothing at all. `WsAudit.alive`/`.started` are therefore
revived with `optBool(o, 'alive', false)` — the field is *"we could not see a session"*, which is
the same thing a build that could not answer means — and `.unit` with plain `optStr` + a
`isWsAuditUnit` guard, where `null` already means *"no systemctl on this box"* and absorbs *"this
ccd does not report it"* without inventing a fourth state.

**Files:**
- Modify: `ccd/ccd` — add `_ws_unit_state` beside `_have_systemctl`
  (`_have_systemctl() { command -v systemctl >/dev/null 2>&1; }`); `cmd_ws_audit`'s
  `_ws_reap_eval "$id" || true      # a refusal is an ANSWER, not an error` line and its
  `printf '"exists":%s,"headMatchesRegistry":%s,"reaping":%s,' \` block
- Modify: `shared/api.ts` — `WsAuditUnit` (new, beside `WsAudit`); the `WsAudit` interface,
  identified by its line `  exists: boolean; headMatchesRegistry: boolean; reaping: string | null;`;
  `reviveWsAudit`'s returned literal, identified by its line `    reaping: optStr(o, 'reaping'),`
- Test: `server/test/ccd-ws-audit.test.ts` (extend)
- Test: `server/test/wsaudit.test.ts` (extend — the revive degrade)

**Interfaces:**
- Produces: `_ws_unit_state <id>` → `enabled` | `loaded` | `absent`, or **nothing** when this box has
  no `systemctl` (the JSON writer renders that as `null`). `cmd_ws_audit` emits
  `"alive":<bool>,"started":<bool>,"unit":<string|null>` between `"reaping"` and `"dirty"`.
- Produces: `export type WsAuditUnit = 'enabled' | 'loaded' | 'absent';` and
  `export function isWsAuditUnit(v: unknown): v is WsAuditUnit`; `WsAudit` gains
  `alive: boolean; started: boolean; unit: WsAuditUnit | null;`.
- **This task is the ONLY owner of the `WsAudit` widening.** w1-srv's preamble points here by
  number; nothing in the server section touches `reviveWsAudit`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-ws-audit.test.ts`:

```ts
describe('ws-audit reports the session\'s own state, on EVERY verdict', () => {
  it('reports alive/started/unit even when _ws_reap_eval refuses not-archived', () => {
    // THE MUTATION: move the three fields back after the refusal and this reds.
    // A `not-archived` refusal nulls every downstream field, and that is
    // exactly the shape that made F8's orphan invisible to the one artifact
    // whose job is answering "what is the state of this workspace".
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const doc = JSON.parse(h.sh(`${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    expect(doc.verdict).toBe('not-archived');
    expect(doc.alive).toBe(false);          // ARCH stubs `_alive() { return 1; }`
    expect(doc.started).toBe(true);         // cmd_ws_add claimed it
    expect(doc.unit).toBe('absent');        // the contained systemctl lists nothing
  });

  it('says started:false for a row nobody claimed — the F8 shape, nameable at last', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`rm -f "$REG/demo-quiet-basin.started"`);
    const doc = JSON.parse(h.sh(`${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    expect(doc.started).toBe(false);
  });

  it('unit is null — never a fourth state — where the box has no systemctl at all', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const doc = JSON.parse(h.sh(
      `${ARCH} _have_systemctl() { return 1; }; cmd_ws_audit --session demo-quiet-basin`));
    expect(doc.unit).toBeNull();
  });
});

describe('_ws_unit_state', () => {
  it('is `enabled` when a default.target.wants symlink exists', () => {
    h.sh(`mkdir -p "$HOME/.config/systemd/user/default.target.wants"
          ln -sf /dev/null "$HOME/.config/systemd/user/default.target.wants/claude-session@x.service"`);
    expect(h.sh('_ws_unit_state x')).toBe('enabled');
  });

  it('is `loaded` when the manager knows the unit but it is not boot-persistent', () => {
    expect(h.sh(
      `systemctl() { echo "claude-session@x.service loaded active running x"; return 0; }
       _ws_unit_state x`)).toBe('loaded');
  });

  it('is `absent` when list-units does not name it', () => {
    expect(h.sh('systemctl() { return 0; }; _ws_unit_state x')).toBe('absent');
  });

  it('probes with list-units, NOT `systemctl show`', () => {
    // `show` on an uninstantiated template reports LoadState=loaded, which is
    // why a naive check misreads this. Measured live: list-units returned 18
    // rows and the six ids absent from it had no unit loaded at all.
    const t = h.sh('type _ws_unit_state');
    expect(t).toContain('list-units');
    expect(t).not.toContain('systemctl show');
  });

  it('prints NOTHING where there is no systemctl — the JSON writer renders null', () => {
    expect(h.sh('_have_systemctl() { return 1; }; _ws_unit_state x')).toBe('');
  });
});
```

No new imports are needed in `ccd-ws-audit.test.ts`: `ARCH`, `WS_ADD`, `makeCcdHarness`, `describe`,
`it` and `expect` are all imported at the top of the file already, and every case above uses only
those plus `JSON.parse`.

And in `server/test/wsaudit.test.ts`, the shared half — **the degrade is the point of these two**:

```ts
describe('the session fields an older ccd does not send', () => {
  const doc = (extra: Record<string, unknown>): unknown => ({
    id: 'demo-quiet-basin', branch: 'ws/quiet-basin', base: 'main',
    workdir: '/w', project: 'demo', repo: '/r',
    exists: true, headMatchesRegistry: true,
    transcript: 't', verdict: 'not-archived', detail: 'd', ...extra,
  });

  it('revives alive/started/unit when ccd sends them', () => {
    const a = reviveWsAudit(doc({ alive: true, started: true, unit: 'enabled' }), 's');
    expect([a.alive, a.started, a.unit]).toEqual([true, true, 'enabled']);
  });

  it('DEGRADES rather than throwing when an older ccd omits all three', () => {
    // reqBool would throw here, and the whole sheet would render nothing —
    // against a rolled-back ccd, or a second fleet host, or a bad deploy
    // order. `false`/`null` say "we could not see one", which is what a build
    // that cannot answer means. This is why the widening ships beside the
    // WRITER and not in the server section.
    const a = reviveWsAudit(doc({}), 's');
    expect([a.alive, a.started, a.unit]).toEqual([false, false, null]);
  });

  it('rejects a `unit` word this build does not know, rather than laundering it', () => {
    expect(() => reviveWsAudit(doc({ unit: 'masked' }), 's')).toThrow();
  });
});
```

(If `reviveWsAudit` is not already imported in this file, add it to the existing
`from '../../shared/api.js'` import.)

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts
```
Expected: `expected undefined to be false` on `doc.alive`, and
`bash: _ws_unit_state: command not found` on the second describe.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, immediately after `_have_systemctl() { command -v systemctl >/dev/null 2>&1; }`:

```bash
_ws_unit_state() {   # id -> enabled|loaded|absent, or EMPTY where there is no systemctl
  # Three states, and the empty fourth answer is deliberately not one of them:
  # "this box has no systemd" is not "this unit is absent", and the JSON writer
  # renders the empty string as `null` rather than inventing a word.
  #
  #   enabled — a default.target.wants symlink exists: it will come back at boot.
  #   loaded  — the manager knows the unit, but nothing promises a next boot.
  #   absent  — list-units does not name it at all.
  #
  # THE PROBE IS `list-units`, NEVER `systemctl show`: `show` on an
  # UNINSTANTIATED TEMPLATE reports LoadState=loaded, so a naive check calls
  # every id in the roster "loaded". Measured live — list-units returned
  # exactly 18 rows, and the six ids absent from it had no unit loaded at all.
  _have_systemctl || return 0
  local id="$1" unit="claude-session@$id.service" link
  link="$HOME/.config/systemd/user/default.target.wants/$unit"
  # -L as well as -e: a wants symlink whose target is gone is still an enable.
  [[ -L "$link" || -e "$link" ]] && { echo enabled; return 0; }
  if systemctl --user list-units 'claude-session@*' --all --plain --no-legend 2>/dev/null \
       | grep -qF "$unit"; then
    echo loaded; return 0
  fi
  echo absent
}
```

In `cmd_ws_audit`, **above** the line `_ws_reap_eval "$id" || true      # a refusal is an ANSWER, not an error`:

```bash
  # BEFORE `_ws_reap_eval`, AND THAT IS THE WHOLE POINT. Its Phase-A refusals —
  # `not-archived` first among them — return with every downstream field null,
  # which is exactly the shape that made F8's orphan invisible to the one
  # artifact whose job is answering "what is the state of this workspace".
  # These three are answerable on EVERY verdict, so they are answered on every
  # verdict. (`_alive` appeared nowhere in this verb before.)
  local aliveflag=false startedflag=false unitstate
  _alive "$id" && aliveflag=true
  [[ "$(_reg_get "$id" started)" == "1" ]] && startedflag=true
  unitstate=$(_ws_unit_state "$id")
```

and immediately after the existing

```bash
  printf '"exists":%s,"headMatchesRegistry":%s,"reaping":%s,' \
    "$exists" "$headmatch" "$( [[ -n "$reaping" ]] && _json_str "$reaping" || echo null)"
```

add:

```bash
  # The session behind the workspace, not just the tree. `unit` is null — never
  # a fourth word — when this box has no systemctl at all.
  printf '"alive":%s,"started":%s,"unit":%s,' \
    "$aliveflag" "$startedflag" "$( [[ -n "$unitstate" ]] && _json_str "$unitstate" || echo null)"
```

In `shared/api.ts`, immediately above `export interface WsAudit {`:

```ts
/** `enabled` = a `default.target.wants` symlink exists; `loaded` = the manager
 *  knows the unit but it is not boot-persistent; `absent` = `list-units` does
 *  not name it. NB `systemctl show` on an uninstantiated template reports
 *  `LoadState=loaded`, which is why ccd's probe must be `list-units`. */
export type WsAuditUnit = 'enabled' | 'loaded' | 'absent';
const WS_AUDIT_UNIT_MAP: Record<WsAuditUnit, true> = { enabled: true, loaded: true, absent: true };
export const WS_AUDIT_UNITS: readonly WsAuditUnit[] =
  Object.keys(WS_AUDIT_UNIT_MAP) as WsAuditUnit[];
export function isWsAuditUnit(v: unknown): v is WsAuditUnit {
  return typeof v === 'string' && (WS_AUDIT_UNITS as readonly string[]).includes(v);
}
```

In the `WsAudit` interface, the line
`  exists: boolean; headMatchesRegistry: boolean; reaping: string | null;` gains three fields
immediately after it:

```ts
  /* ── THE SESSION BEHIND THE WORKSPACE ──────────────────────────────────────
   * Computed by ccd BEFORE `_ws_reap_eval`'s early refusal, unlike everything
   * in the `null MEANS NOBODY LOOKED` block below — a `not-archived` verdict
   * nulls those and that is exactly the shape that made F8's orphan invisible
   * to the one artifact whose job is answering "what is the state of this
   * workspace". These three are answerable on every verdict, so they are
   * answered on every verdict. */
  alive: boolean;
  started: boolean;
  /** `null` when the fleet host has no `systemctl` at all — and, by the same
   *  degrade, when the ccd that answered predates these fields. Never a fourth
   *  state; "we could not see a unit" is one fact, not two. */
  unit: WsAuditUnit | null;
```

In `reviveWsAudit`, immediately after `    reaping: optStr(o, 'reaping'),`:

```ts
    // optBool/optStr, NOT reqBool — DELIBERATE, and decided beside the writer.
    // An older ccd on the fleet host omits all three; reqBool would throw and
    // the whole sheet would render nothing, against a rolled-back ccd or a
    // second fleet host. `false`/`null` say "we could not see a session",
    // which is what a build that cannot answer means.
    alive: optBool(o, 'alive', false),
    started: optBool(o, 'started', false),
    unit: unitRaw,
```

with `unitRaw` validated above the literal, in the same idiom as the existing `const token = optStr(o, 'token');`:

```ts
  const unitRaw = optStr(o, 'unit');
  if (unitRaw !== null && !isWsAuditUnit(unitRaw)) throw new MalformedSnapshot('unit');
```

(`optBool` is the module-private helper w1-srv Task 103 adds beside `optStr`/`optNum`/`reqBool`. If
this task lands first, add it here and delete the duplicate from that task — one definition,
either way; `server/test/single-definition.test.ts` is the arbiter.)

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts test/wsaudit.test.ts test/ccd-ws-reap.test.ts test/single-definition.test.ts test/ownership.test.ts
cd pwa && npm run build
```
Then run the mutation by hand: move the three-line computation block to **below** the
`_ws_reap_eval` line, re-run `test/ccd-ws-audit.test.ts`, confirm the `not-archived` case reds, and
move it back.

- [ ] **Step 5: Commit**

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git add ccd/ccd shared/api.ts server/test/ccd-ws-audit.test.ts server/test/wsaudit.test.ts
git commit -m "feat(ccd): ws-audit reports alive, started and unit — on every verdict

Computed BEFORE _ws_reap_eval, whose not-archived refusal nulls every
downstream field: that is the shape that made F8's orphan invisible to the one
artifact whose job is answering what the state of a workspace is. _ws_unit_state
probes with list-units, never `systemctl show`, which reports LoadState=loaded
for an uninstantiated template. Read-only; no new exec surface.

The shared half rides here, not in the server section: reviveWsAudit's absent-
key degrade has to be decided beside the writer, and reqBool would throw the
whole sheet away against a ccd that predates the fields."
```

---

### Task 13: §1.7's other two layers — the `KillMode` pin and the deploy pre-flight

**Task 4 is INERT WITHOUT THIS TASK AND THE REBOOT.** `_tmux_server_ensure` only takes effect when
the tmux server is next created; until then all 21 sessions stay children of one server sitting
inside `claude-session@claude-ccrc-pwa.service`'s cgroup, and the only thing standing between the
deploy's `try-restart "claude-session@*"` sweep and a fleet kill is one line in one unit file —
`KillMode=process`, systemd's default being `control-group`.

**Measured at `d7137c2`: `git grep -rn KillMode` over the repo returns the unit file (line 29), two
prose comments in `deploy/deploy.sh` and `server/src/localcaps.ts`, one line of README, and two
plan documents. By this repo's own doctrine that is a request, not a mechanism.** Worse,
`agent/test/deploy-verify.test.ts`'s sweep test already states the dependency **verbatim** in a
comment — *"The unit is BUILT for this sweep: KillMode=process, with a comment that the tmux
substrate must survive a supervisor restart"* — while asserting everything **except** that.

The second layer matters more, because the sweep is the trigger: `deploy.sh` copies the unit file
and `daemon-reload`s in the **same run** that sweeps, so a bad edit goes live and is exercised
against 18 units with no window to notice.

**Files:**
- Modify: `deploy/deploy.sh` — `SWEEP_CMD`, identified by its first line, verbatim:
  `  SWEEP_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \` and its next line
  `    && systemctl --user try-restart "claude-session@*" \`
- Test: `agent/test/deploy-verify.test.ts` — the test named
  `it('after a new ccd lands, every claude-session@ supervisor is restarted onto it — and re-verified')`

**Interfaces:**
- Consumes: nothing.
- Produces: `SWEEP_CMD` refuses before `try-restart` when the unit about to be active lacks
  `KillMode=process`, and prints which unit currently hosts the tmux server. `deploy.sh` runs under
  `set -e`, so the refusal aborts the deploy.

- [ ] **Step 1: Write the failing test**

In `agent/test/deploy-verify.test.ts`, add to the same `describe` as the sweep test:

```ts
  it('the unit carries KillMode=process, in [Service] — without it the sweep is a fleet kill', () => {
    // THE CONSEQUENCE, named in the message because that is the whole value of
    // this assertion: the deploy sweeps `try-restart "claude-session@*"` across
    // every live supervisor, and systemd's DEFAULT KillMode is control-group.
    // All 21 live sessions are children of ONE tmux server that sits inside a
    // claude-session@ cgroup, so deleting this one line turns a routine deploy
    // into a fleet kill. Until now `grep -rn KillMode` over this repo returned
    // the unit file and two COMMENTS — a request, not a mechanism.
    const unit = readFileSync(path.join(deployDir, '..', 'ccd', 'claude-session@.service'), 'utf8');
    const service = unit.slice(unit.indexOf('[Service]'), unit.indexOf('[Install]'));
    expect(service,
      'claude-session@.service lost KillMode=process — the deploy sweep would kill the tmux '
      + 'server and every session under it')
      .toMatch(/^KillMode=process$/m);
  });

  it('and the two start-limit keys are in [Unit], where systemd actually reads them', () => {
    // Same failure story, which is why they share a test file and land here:
    // measured on systemd 255 with `systemd-analyze verify`,
    // StartLimitIntervalSec= in [Service] is "Unknown key name … ignoring",
    // while StartLimitBurst= there is still accepted for legacy compatibility
    // — so splitting them honours the burst against systemd's DEFAULT 10s
    // interval, a limit nobody chose, and a crash-looping session loops
    // invisibly instead of reaching `failed`.
    const unit = readFileSync(path.join(deployDir, '..', 'ccd', 'claude-session@.service'), 'utf8');
    const unitSection = unit.slice(unit.indexOf('[Unit]'), unit.indexOf('[Service]'));
    expect(unitSection).toMatch(/^StartLimitIntervalSec=120$/m);
    expect(unitSection).toMatch(/^StartLimitBurst=5$/m);
  });

  it('the sweep REFUSES before try-restart when the unit about to be active lacks KillMode=process', () => {
    // The layer that matters more, because the sweep is the trigger: deploy.sh
    // copies the unit file and daemon-reloads in the SAME run that sweeps, so a
    // bad edit goes live and is exercised against 18 units with no window to
    // notice. Same ordering principle the sweep's own placement already
    // encodes ("after the agent chain, so a broken agent fails the deploy
    // before any supervisor is touched") — one step earlier.
    const sweep = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh);
    expect(sweep, 'SWEEP_CMD is no longer a single-quoted assignment').not.toBeNull();
    const body = sweep![1];
    const guardAt = body.indexOf('KillMode=process');
    const restartAt = body.indexOf('try-restart "claude-session@*"');
    expect(guardAt, 'the sweep does not check KillMode at all').toBeGreaterThan(-1);
    expect(guardAt, 'the KillMode guard must precede try-restart, not follow it')
      .toBeLessThan(restartAt);
    // And it must ABORT, not warn: deploy.sh runs under `set -e`, so a
    // non-zero here stops the run before any supervisor is touched.
    expect(body.slice(guardAt - 200, restartAt)).toMatch(/exit 1/);
    // It also names WHICH unit currently hosts the tmux server, so the operator
    // reading the abort can see the blast radius rather than infer it.
    expect(body).toContain("/proc/$(pgrep -x -f 'tmux: server')/cgroup");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```
Expected: the first two pass immediately — they are **regression pins** on text that is already
correct, and their value is the mutation in Step 4, not a red here. The third fails with
`the sweep does not check KillMode at all: expected -1 to be greater than -1`.

- [ ] **Step 3: Write minimal implementation**

In `deploy/deploy.sh`, `SWEEP_CMD`'s body gains a pre-flight as its first act, before
`try-restart`:

```sh
  # PRE-FLIGHT, AND IT IS THE POINT OF THE WHOLE BLOCK. This script copied the
  # unit file and daemon-reloaded a few lines up, in THIS run — so a bad edit is
  # already live and the next line would exercise it against every supervisor on
  # the box. systemd's DEFAULT KillMode is control-group, all 21 sessions are
  # children of ONE tmux server, and that server sits inside whichever
  # claude-session@ unit happened to create it: without KillMode=process the
  # sweep below is a fleet kill, not a restart.
  #
  # Same ordering principle the sweep's own placement already encodes ("after
  # the agent chain, so a broken agent fails the deploy before any supervisor is
  # touched") — one step earlier. `set -e` at the top of this file turns the
  # non-zero exit into an aborted deploy.
  SWEEP_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && { grep -qE "^KillMode=process$" ~/.config/systemd/user/claude-session@.service \
         || { echo "deploy: FAILED — the claude-session@ unit about to be swept lacks KillMode=process. systemds default is control-group, so try-restart would kill the tmux server and every session under it. REFUSING to sweep." >&2; exit 1; }; } \
    && echo "deploy: the tmux server currently lives in: $(cat /proc/$(pgrep -x -f "tmux: server")/cgroup 2>/dev/null | tr "\n" " ")" >&2 \
    && systemctl --user try-restart "claude-session@*" \
    && for u in $(systemctl --user list-units "claude-session@*" --state=failed --plain --no-legend | awk "{print \$1}"); do \
         echo "deploy: warning: $u is FAILED — try-restart skipped it and this sweep did not verify it. On the box: systemctl --user reset-failed $u, then ccd start the session" >&2; done \
    && for u in $(systemctl --user list-units "claude-session@*" --state=active --plain --no-legend | awk "{print \$1}"); do \
         bash ~/ccrc/deploy/verify-service.sh "$u" || exit 1; done'
```

The `cgroup` print is deliberately **informational and non-fatal** (`2>/dev/null`, and the whole
`echo` succeeds even when `pgrep` finds nothing): a box with no tmux server yet is an ordinary
fresh box, and refusing there would break the first deploy to a new fleet host. What it buys is
that the operator reading an abort — or reading a successful sweep — can see the blast radius
instead of inferring it.

- [ ] **Step 4: Run test to verify it passes**

```
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```
Then the mutation, by hand, because these are the assertions whose whole value is that they can
fail: delete the `KillMode=process` line from `ccd/claude-session@.service`, re-run, confirm the
named test reds with the fleet-kill message, and restore it. Then move `StartLimitBurst=5` into
`[Service]`, re-run, confirm, restore.

- [ ] **Step 5: Commit**

```
git add deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "fix(deploy): the supervisor sweep refuses to run into a unit without KillMode=process

Three prose comments across the repo said the sweep depends on it and nothing
asserted it — a request, not a mechanism, on the least-defended line on the box.
deploy.sh copies the unit and daemon-reloads in the SAME run that sweeps, so a
bad edit is live before the sweep touches 18 units, and systemd's default
KillMode is control-group with all 21 sessions under one tmux server. The
pre-flight aborts before try-restart and prints which unit currently hosts that
server; deploy-verify pins KillMode=process and the two [Unit] start-limit keys."
```

---

### Task 14: the coordinator skill learns that an `ok` dispatch is not a ready pane (AGENT-FIRST)

**Scheduled here because w2 Task 216 defers to it by name.** w1-srv Task 109 ships
`DispatchOutcome.adopted` and `spawnState` so the coordinator knows the pane may not be ready — and
without this task no corpus text tells it what either field means. `ccd/coordinator-skill/` ships on
the **agent-first** lane with the rest of this section.

**ADDITIVE TEXT ONLY, and three assertions in `server/test/coordinator-skill.test.ts` bind:**
- The **nine pinned clauses** in `SKILL.md` are unchanged — this is a `references/` edit.
- The **destructive-verb census**: `ws-reap` / `ws-rm` / `ws-gc` may appear across `SKILL.md` plus
  BOTH references only as many times as clause 3 names them. **The new text must not mention any of
  the three, not even to forbid them again.**
- The **route-completeness scan** is scoped to `server/src/coord/routes.ts` and is untouched.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §2's dispatch table and response
  shape, which today presents `ambiguous-dispatch` as the only outcome of a spawn that did not
  cleanly succeed
- Test: `server/test/coordinator-skill.test.ts` (extend)

**Interfaces:**
- Consumes: `DispatchOutcome`'s ok arm gaining `adopted: boolean` and `spawnState: SpawnVerdict | null`
  (w1-srv Task 109).
- Produces: no code. One documented response shape.

- [ ] **Step 1: Write the failing test**

Append to `server/test/coordinator-skill.test.ts`:

```ts
describe('the dispatch response documents that ok is not proof of a ready pane', () => {
  it('names adopted and spawnState, and says what adopted:true costs the coordinator', () => {
    const ref = readFileSync(
      path.join(SKILL_DIR, 'references', 'wave-lifecycle.md'), 'utf8');
    expect(ref).toContain('adopted');
    expect(ref).toContain('spawnState');
    // The sentence that makes the fields actionable rather than decorative.
    expect(ref).toMatch(/ok.*(is not|no longer).*proof/i);
  });

  it('and says nothing new about the destructive verbs — the census is exact', () => {
    // Not a second copy of the shipped census assertion (which pins
    // hits === CONTRACT[2]'s own count and is stronger); this only pins that
    // THIS task's new text introduced none, by re-running the file's own
    // existing check after the edit. Kept as a comment rather than a weaker
    // duplicate assertion:
    //   see `describe('clause 3 names the destructive verbs exactly once each')`
    //   above — it is the mechanism, and it must stay green.
    expect(true).toBe(true);
  });
});
```

Delete the second `it` if the file's existing census `describe` is already named differently — the
point is the comment pointing at the real guard, not a second assertion. (A duplicate would be
weaker than the shipped one and would pass with an extra mention.)

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```
Expected: `expected '…' to contain 'adopted'`.

- [ ] **Step 3: Write minimal implementation**

In `ccd/coordinator-skill/references/wave-lifecycle.md`, §2's dispatch section, immediately after
the existing response shape, add:

```md
#### A `200` is no longer proof that the pane is ready

`POST /api/runs/:id/dispatch` answers with two fields beyond the ones above:

| field | meaning |
|---|---|
| `adopted` | `true` when the workspace was **adopted from a killed `ws-add`**, not created by a clean one. The HTTP call that made it timed out and the server killed `ccd`; the workspace, the claim and the supervisor all exist, but nothing confirmed the session's TUI came up. |
| `spawnState` | how the last spawn attempt ended: `ready`, `login`, `vanished`, `expired`, `blocked`, `unrecognised`, or `null` for *not recorded*. `null` is not `ready` and is not a warning — it means no spawn fact was written. |

**What to do with them.** On `adopted: true`, or on any `spawnState` other than `ready` or `null`,
**do not treat the brief as delivered**. Wait for the worker's first mail as usual, but if none
arrives within the wave's ordinary window, read the session's own screen before re-dispatching:

- `spawnState: 'expired'` — the settle ran out. Large resumes legitimately settle unconfirmed; the
  session is very often fine. Give it the ordinary window before acting.
- `spawnState: 'login'` or `'blocked'` — the account behind that lane needs a human. Waiting longer
  cannot fix it. Say so to the operator; do not re-dispatch onto the same lane.
- `spawnState: 'vanished'` — the tmux session went away mid-poll. The row will classify itself on
  the next sweep.

`adopted: true` is also written to the run's event trail as `spawn-adopted:<spawnState>`, so the
provenance of the workspace survives the conversation.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

- [ ] **Step 5: Commit**

```
git add ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "docs(skill): an ok dispatch is no longer proof the pane is ready

Wave 1 lets dispatch ADOPT the workspace a killed ws-add left behind, and
returns adopted + spawnState so the coordinator can tell that case from a clean
spawn. Without this the two fields ship with no corpus text explaining them.
Additive reference text only: SKILL.md's nine pinned clauses are untouched and
the new passage names none of the destructive verbs, so the census assertion
stays exact."
```

---

### Task 15: the build4 ledger records what it believed, and why it was wrong

**NOT a test — a documentation obligation, listed so it is scheduled rather than remembered.**
The ledger at `docs/superpowers/programs/build4.md` (412 lines at `d7137c2`) carries four claims
this wave falsifies. `D-N` entries are authoritative history, so this is a correction **APPENDED**
to the ledger, never a rewrite — deleting the original would destroy the more useful record, which
is that a careful reviewer believed a liveness signal that cannot see a pane.

**Files:**
- Modify: `docs/superpowers/programs/build4.md` — append one section at the end of the file, after
  the closing `## Next-wave brief — SUPERSEDED, the program is closed` section
- Test: none. Nothing scans this file.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Documentation only.

- [ ] **Step 1: Write the failing test**

There is no test, and inventing one would be worse than none: nothing in the tree scans this file,
and a scanner written only to make this task have a red step would be a mechanism with no consumer.
**The verification is Step 4's read-back**, stated as an explicit check rather than skipped.

- [ ] **Step 2: Run test to verify it fails**

```
git grep -n "correction" -- docs/superpowers/programs/build4.md
```
Expected: no hit for the appended section — it does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Append to `docs/superpowers/programs/build4.md`:

```md
## Correction, appended 2026-08-15 (robustness build, Wave 1)

Four claims above are wrong. They are left standing, because a ledger that quietly repairs itself
stops being evidence. What follows is what was actually true and how the error was made.

**1. "the workspace was created and supervised" (F8's entry).** It was created. It was NOT
supervised. `cmd_ws_add` ran `_spawn` BEFORE `_ws_supervise`, and the agent's 300 s `ws-add`
budget expired inside `_spawn` — so the process was killed before `_ws_supervise` ever ran, no
`claude-session@` unit was ever enabled, and `$REG/<id>.started` was never written.

**2. "two liveness signals agreed".** They disagreed, and this ledger believed the one that
cannot see a pane. The heartbeat said the row was fine; `systemctl --user list-units` did not name
the unit at all. The reading that produced "agreed" was `systemctl show`, which reports
`LoadState=loaded` for an UNINSTANTIATED TEMPLATE — so it answers "loaded" for an id that has no
unit. `ccd ws-audit` could not have corrected it either: `_ws_reap_eval` refuses `not-archived`
first and nulls every downstream field, and `_alive` appeared nowhere in that verb.

**3. C11 — the claim that a failed spawn leaves no trace.** `$REG/<id>.spawn` is written by the
settle as `<epoch-seconds> <rc>` and was on disk the whole time. Nothing on the wire carried it, so
no surface could show it; that is a plumbing gap, not an absence of evidence.

**4. C12 — the claim that the lifecycle ladder already covered this shape.** It could not: no
fixture row combined `alive: true` with `started: false`, so the 24-combination cross-language
sweep yielded only six tokens and the shape classified as `running` for two days.

**What the robustness build changes.** `started` is written between `_spawn_start` and
`_spawn_settle`, before anything blocks, and `_ws_supervise` runs there too — so a kill at any
moment leaves an ordinary, restartable session. `_session_state` and `sessionLifecycle` gain
`unclaimed`, first inside the alive branch. `ws-audit` answers `alive`/`started`/`unit` on every
verdict, probing with `list-units`. `_resupervise_live` adopts an `unclaimed` pane and writes the
claim, so `ccd ensure` repairs the shape rather than reporting success and changing nothing.
```

- [ ] **Step 4: Run test to verify it passes**

```
git grep -c "Correction, appended 2026-08-15" -- docs/superpowers/programs/build4.md
```
Expected `1`. Then read the appended section against the four numbered claims it corrects and
confirm each one names the original claim before contradicting it — a correction that does not
quote what it corrects is not a record.

- [ ] **Step 5: Commit**

```
git add docs/superpowers/programs/build4.md
git commit -m "docs(ledger): build4 believed a liveness signal that cannot see a pane

Appended, never rewritten — D-N entries are authoritative history and deleting
the original would destroy the more useful record. Four claims corrected: the
workspace was created but never supervised; the two liveness signals disagreed
and the ledger believed systemctl show, which reports LoadState=loaded for an
uninstantiated template; the spawn rc WAS on disk the whole time; and no
lifecycle fixture combined alive:true with started:false, which is why the
shape read `running` for two days."
```

---

**Wave 1 (ccd half) definition of done.** All fifteen tasks committed; `server/test/ownership.test.ts`
green on **every** commit (the re-stamp rides in the same commit, never a cleanup task); no test
file takes longer than ~60 s (a longer run means a missed `_spawn` stub, not a slow box); the full
ccd suite list from Task 1 Step 4 green in the foreground, with `ccd-ws-gc` re-run in isolation if
it flakes; `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` green.

**Then the deploy, which is a THREE-lane deploy described elsewhere as two, ending in a planned
reboot. Every step below is HUMAN-RUN at a terminal — none of it belongs in an automated task.**

1. Confirm the merge gate is still satisfied: `git show <ref>:ccd/ccd | grep -c SWAP_JITTER` must be
   non-zero (it is at `d7137c2`; the check is cheap and it is what would catch a bad rebase).
2. **`bash deploy/deploy.sh agent <fleet-host>`** — ccd, the unit file and the hooks, then the agent
   chain, then the supervisor sweep. **The host argument is not optional:** `deploy.sh` defaults
   `$BOX` to the SERVER box, so a bare `deploy.sh agent` ships fleet artifacts to the wrong machine.
   Task 13's pre-flight now aborts this step rather than sweeping into a unit without
   `KillMode=process`; read its cgroup line when it prints.
3. **The sweep is MANDATORY, not optional.** Measured: 15 of 18 `ccd supervise` processes hold a
   DELETED inode with `pos == size`, so bash has zero bytes left to read; natural turnover is ~3
   supervisors per 12 hours. Skip it and Wave 1's spawn invariant is false on most of the fleet for
   days, because `cmd_ensure` inside a live supervisor **is** an unattended spawn path.
4. **`bash deploy/deploy.sh agent <fleet-host>` restarts `ccrc-agent`, which drops the single
   authenticated WebSocket the whole PWA runs over.** Expect a link outage in the middle of the
   deploy. Order is ccd → agent → server; `shared/` compiles into both lanes.
5. `bash deploy/deploy.sh` — the server lane. Its final gate is `/health` reporting the shipped sha.
6. **The six-session reboot pre-flight, and it is a DECISION per session, not a command.** Three
   units are active-but-not-enabled and three sessions have no unit at all, so `try-restart` and the
   post-reboot `default.target` both miss them — only the 15 enabled units come back. For each of
   `calm-mesa`, `plain-harbor`, `still-prairie`, `swift-harbor`, `brisk-ridge`, `warm-mesa`: either
   `ccd ensure <id>` (which, after Task 11, claims and enables a live unclaimed pane) or accept
   out loud that its pane is gone after the reboot. Record which you chose.
   Two live facts settle themselves here rather than being assumed: whether `try-restart` really
   leaves the tmux sessions alive (inferred from `KillMode=process`, never observed — watch it), and
   why those three units are active-but-not-enabled.
7. **Reboot the fleet host — AFTER the ccd install and its sweep.** Rebooting first recreates the
   flaw: `_tmux_server_ensure` cannot move a live tmux server (cgroup membership of a running
   process needs a D-Bus `StartTransientUnit` adoption, not something to attempt against a process
   holding 21 sessions), so it only takes effect when the server is next created.
8. **The exit gate, and the whole point of the exercise:**
   `cat /proc/$(pgrep -x -f 'tmux: server')/cgroup` must **no longer name a `claude-session@*`
   unit** — it should read `ccrc-tmux-server.scope`. If it still names a session unit, Task 4 did
   not take and step 7 was ordered wrong.
9. Spot-check the fleet screen: every session that had a unit is back, and the spawn chip is silent
   on the healthy rows (a chip on all 18 means `started` was misread, not that the fleet is sick).
## Wave 1 — server / shared / PWA half

Spec §1.4, §1.5, the TypeScript half of §1.6, and §1.6b. Every anchor below was derived by
`git show d7137c2:<path>` / `git grep -n <identifier> d7137c2`, never from the spec's `file:line`
notes.

**Lane order inside this section.** Task 106 lives in `agent/` and ships on its own
`deploy.sh agent <host>` invocation, which drops the single authenticated WebSocket — land and deploy
it BEFORE 107/109, which read what it writes. Task 102 touches `ccd/ccd` (one line) and is therefore
AGENT-FIRST and hits the provenance gate. Everything else is server/PWA lane.

**Dependency edges:** 101 → 103 → 104 → 105; 106 → 107 → 109; 110 → 111; 101 + 110 → 112.

**Two things this section deliberately does NOT do**, so nobody goes looking for them:

- **`lifecycle` stays a CHIP.** `server/src/fleet.ts` carries a deliberate deferral of the
  asymmetric-skew fix, justified verbatim on the grounds that lifecycle is *"a display-only qualifier
  that nothing server-side reads yet"*, and it names its own expiry. Nothing in Wave 1 lets lifecycle
  or any heartbeat-derived divergence drive an adopt/respawn DECISION — the census is published, read
  by nothing that mutates — so the deferral stays valid. Do not add a server-side consumer.
- **`WsAudit.alive/started/unit` is NOT here — it is w1-ccd Task 12, which owns BOTH halves.**
  `reviveWsAudit` (`shared/api.ts`) reads `exists` and `headMatchesRegistry` with `reqBool`, which
  THROWS on an absent key, so the shared half cannot be green without its ccd emitter
  (`cmd_ws_audit`, `_ws_unit_state`), and the absent-key degrade has to be decided beside the
  writer. Task 12 ships `WsAuditUnit`, `isWsAuditUnit`, the three `WsAudit` fields and
  `reviveWsAudit`'s `optBool`/`optStr` degrade in the same commit as the emitter. **Nothing in this
  section touches `reviveWsAudit`.**
- **The `unclaimed` rung in `_session_state` IS here** — Task 102, in one atomic commit with the
  `SessionLifecycle` member, because `ccd-session-lifecycle.test.ts`'s tail derives `want` from
  `SESSION_LIFECYCLES`. The ccd section carries no `_session_state` edit; its Task 11
  (`_resupervise_live`) *reads* the new word and must land after Task 102.
- **`optBool` has ONE definition.** Task 103 adds it beside `optStr`/`optNum`/`reqBool` in
  `shared/api.ts`; w1-ccd Task 12 consumes it. Whichever lands first defines it; the second deletes
  its own copy. `server/test/single-definition.test.ts` is the arbiter.

**The census has no PWA reader in Wave 1, and that is deliberate — RULED OK by the operator on
2026-08-16.** Task 111 publishes the
`divergence` frame and Task 112 pins its single producer; nothing in `pwa/src` subscribes. The
measured population is ONE, the frame is additive and absence-permitting, and a surface designed in
the same wave as its first producer is a surface designed without data. **Its reader lands with the
first census that is not empty** — the natural home is a count beside the fleet header, reusing the
`runsFrameSeen`-style degrade so a server that never sends the frame renders nothing. Stated here so
nobody ships it by accident and nobody assumes it was forgotten.

---

### Task 101: `SpawnVerdict` — ccd's rc table, derived once in L0

**Files:**
- Modify: `shared/api.ts` (insert immediately AFTER the `isSessionLifecycle` function — identified by
  its body line `return typeof v === 'string' && (SESSION_LIFECYCLES as readonly string[]).includes(v);`
  — and BEFORE `export type StopSurface`)
- Test: `server/test/spawn-verdict.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `export type SpawnVerdict = 'ready' | 'login' | 'vanished' | 'expired' | 'blocked' | 'unrecognised'`;
  `export const SPAWN_VERDICTS: readonly SpawnVerdict[]`;
  `export function isSpawnVerdict(v: unknown): v is SpawnVerdict`;
  `export function spawnVerdict(rc: number | null): SpawnVerdict | null`.

- [ ] **Step 1: Write the failing test**

Create `server/test/spawn-verdict.test.ts`:

```ts
// §1.6b. `_spawn_settle` already writes `$REG/<id>.spawn` as `<epoch-seconds> <rc>`, and
// `registry.ts` already parses it into `SessionRecord.spawn: { at, rc } | null`. This is the ONE
// derivation of that rc table into a word, in L0, so the wire and the PWA cannot mint a second.
import { describe, it, expect } from 'vitest';
import { SPAWN_VERDICTS, isSpawnVerdict, spawnVerdict } from '../../shared/api.js';

describe('spawnVerdict — ccd\'s shipped rc table, and nothing else', () => {
  it('maps every rc ccd actually writes', () => {
    expect(spawnVerdict(0)).toBe('ready');
    expect(spawnVerdict(2)).toBe('login');
    expect(spawnVerdict(3)).toBe('vanished');
    expect(spawnVerdict(4)).toBe('expired');
    expect(spawnVerdict(5)).toBe('blocked');
  });

  it('answers null for NOT RECORDED — never `ready`, never a warning', () => {
    // `swift-harbor` has no `$REG/<id>.spawn` at all. A null that laundered into
    // `ready` would assert a measurement nobody made; a null that laundered into a
    // warning would light every row that has not spawned since PR #50.
    expect(spawnVerdict(null)).toBeNull();
  });

  it('lands an rc this build never heard of on the designated-ignorance member, never a throw', () => {
    // rc 1 is a ccd `die` and belongs here deliberately: `die` is a whole family of
    // refusals, not one verdict, so giving it a word would be inventing a distinction
    // ccd does not make.
    expect(spawnVerdict(1)).toBe('unrecognised');
    expect(spawnVerdict(99)).toBe('unrecognised');
    expect(spawnVerdict(-1)).toBe('unrecognised');
  });

  it('derives SPAWN_VERDICTS from the map, and the list is the whole union', () => {
    expect([...SPAWN_VERDICTS].sort()).toEqual(
      ['blocked', 'expired', 'login', 'ready', 'unrecognised', 'vanished'],
    );
  });

  it('isSpawnVerdict accepts every member and rejects a stray token or a non-string', () => {
    for (const v of SPAWN_VERDICTS) expect(isSpawnVerdict(v)).toBe(true);
    expect(isSpawnVerdict('spawnstate')).toBe(false);
    expect(isSpawnVerdict('')).toBe(false);
    expect(isSpawnVerdict(0)).toBe(false);
    expect(isSpawnVerdict(null)).toBe(false);
    expect(isSpawnVerdict(undefined)).toBe(false);
  });

  it('does NOT renumber 3 or 4 — four ccd call sites plus _supervised_start branch on them', () => {
    expect(spawnVerdict(3)).toBe('vanished');
    expect(spawnVerdict(4)).toBe('expired');
    expect(spawnVerdict(5)).not.toBe(spawnVerdict(4));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/spawn-verdict.test.ts
```

Expected: the suite fails to collect — `SyntaxError: The requested module '../../shared/api.js' does
not provide an export named 'SPAWN_VERDICTS'` (and the same for `isSpawnVerdict`/`spawnVerdict`).

- [ ] **Step 3: Write minimal implementation**

In `shared/api.ts`, immediately after `isSessionLifecycle`'s closing brace:

```ts
/** ccd's `_spawn` verdict as a word — a projection of the rc table ALREADY
 *  written to `$REG/<id>.spawn` (`<epoch-seconds> <rc>`) and already parsed into
 *  `SessionRecord.spawn: { at, rc } | null`. Derived ONCE, here, in L0.
 *
 *  There is no `spawnstate` registry field and there must never be one: the
 *  timestamp in `spawn` is load-bearing (`_supervised_start` compares
 *  `at >= since` to tell THIS attempt's failure from the previous one's), and a
 *  word-only field would destroy it.
 *
 *  `unrecognised` is the designated-ignorance member: an rc this build never
 *  heard of — rc 1, a ccd `die`, included — revives as that, never a throw and
 *  never `ready`. Orthogonal to `SessionLifecycle`: this says how the LAST
 *  SPAWN ATTEMPT ended, not what the row IS. A row can be `running` today after
 *  a failed spawn yesterday, and collapsing one into the other would be an
 *  adapter narrowing a distinction it received. */
export type SpawnVerdict =
  | 'ready' | 'login' | 'vanished' | 'expired' | 'blocked' | 'unrecognised';

/** Same derived-enumeration discipline as `SESSION_LIFECYCLE_MAP` above:
 *  `Record<SpawnVerdict, true>` fails LOUDLY (TS2739) on a member added to the
 *  union with no key here, and the other way (TS2353) on a key the union does
 *  not have. */
const SPAWN_VERDICT_MAP: Record<SpawnVerdict, true> = {
  ready: true, login: true, vanished: true, expired: true,
  blocked: true, unrecognised: true,
};
export const SPAWN_VERDICTS: readonly SpawnVerdict[] =
  Object.keys(SPAWN_VERDICT_MAP) as SpawnVerdict[];

/** The only way to narrow an untrusted string to a `SpawnVerdict`. `unknown`
 *  parameter, and the CONSTANT is cast rather than the input — `isPrPhase`'s
 *  own rule, for its own reason. */
export function isSpawnVerdict(v: unknown): v is SpawnVerdict {
  return typeof v === 'string' && (SPAWN_VERDICTS as readonly string[]).includes(v);
}

/** ccd's rc table, in one place. `null` in -> `null` out, and `null` means NOT
 *  RECORDED (`$REG/<id>.spawn` absent, or its rc unparseable — `registry.ts`
 *  collapses both to `spawn: null` deliberately). rc 5 is the hard-block verdict
 *  Wave 1 adds to `_accept_first_run_prompts`; 3 and 4 are NOT renumbered,
 *  because four ccd call sites plus `_supervised_start` branch on
 *  `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`. */
export function spawnVerdict(rc: number | null): SpawnVerdict | null {
  if (rc === null) return null;
  switch (rc) {
    case 0: return 'ready';
    case 2: return 'login';
    case 3: return 'vanished';
    case 4: return 'expired';
    case 5: return 'blocked';
    default: return 'unrecognised';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/spawn-verdict.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add shared/api.ts server/test/spawn-verdict.test.ts && git commit -m "feat(shared): ccd's spawn rc table becomes a word, once, in L0 (§1.6b)"
```

---

### Task 102: `unclaimed` — one member, one rung, in both implementations

**AGENT-FIRST.** This task edits `ccd/ccd` (one line plus a comment) and therefore re-stamps the
provenance marker IN THIS COMMIT. Ship ccd to the fleet host before the server lane.

**Why the bash rung rides in this commit and not in the ccd section.**
`server/test/ccd-session-lifecycle.test.ts` ends with a set-equality assertion DERIVED from the
shared enum:

```
const got = [...new Set(answers)].sort();
const want = SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable').slice().sort();
expect(got).toEqual(want);
```

Whichever side lands alone, that assertion is RED for one commit — the member without the rung makes
`want` longer, the rung without the member makes `got` longer. The two halves are one atomic change.
**The ccd section must not also edit `_session_state`, and does not.**

**THIS TASK CREATES A REGRESSION THAT w1-ccd TASK 11 MUST CLOSE, IN THE SAME BRANCH.**
`_resupervise_live` (shipped by PR #50) gates on exactly `[[ "$(_session_state "$id")" == unsupervised ]] || return 1`.
F8's residue answers `unsupervised` today and `unclaimed` after this commit — so `ccd ensure` stops
re-supervising the very population PR #50 taught it to adopt. **w1-ccd Task 11 widens that gate and
adds the claim; schedule it immediately after this task.** Do not merge the branch with this task in
and Task 11 out.

**Files:**
- Modify: `shared/api.ts` (`SessionLifecycle` union; `SESSION_LIFECYCLE_MAP`; `sessionLifecycle`'s
  alive branch, identified by its exact current line
  `if (input.alive) return supervised ? 'running' : 'unsupervised';`)
- Modify: `ccd/ccd` (`_session_state`, identified by its header line
  `_session_state() {   # id -> running|unsupervised|stopped|restarting|orphan|never-started`
  and its alive branch `if _alive "$id"; then`)
- Modify: `pwa/src/fleet/lifecycleWords.ts` (`QUALIFIER`, identified by
  `const QUALIFIER: Record<Exclude<SessionLifecycle, 'stopped'>, string | null> = {`)
- Test: `server/test/sessionLifecycleFixture.ts` (two new rows)
- Test: `server/test/session-lifecycle.test.ts` (the ordering contract)
- Test: `server/test/ccd-session-lifecycle.test.ts` — its derived set-equality tail moves 6 → 7 on
  its own, but the rung's POSITION is not derived and gets its own describe (Step 1)
- Test: `pwa/test/session-lifecycle.test.tsx` (the DOM half)

**Interfaces:**
- Consumes: nothing from Task 101.
- Produces: `SessionLifecycle` gains the member `'unclaimed'`, declared after `'unsupervised'`.
  `sessionLifecycle`'s SIGNATURE is unchanged. `LifecycleInput` is unchanged — it already carries
  `alive` and `started`.

- [ ] **Step 1: Write the failing test**

In `server/test/sessionLifecycleFixture.ts`, insert both rows into `LIFECYCLE_FIXTURE` immediately
after the row named `'alive with no heartbeat at all is unsupervised'`:

```ts
  // §1.6, and the reason the shipped 24-combination sweep yields only SIX tokens:
  // NO existing row combines `alive: true` with `started: false`. That omission is
  // exactly why F8's shape — a live pane, a fresh heartbeat, no claim — classified
  // as `running` for two days on the live fleet.
  //
  // SUPERVISED, deliberately. `swift-harbor` was alive AND supervised AND
  // unclaimed, so this row is what proves `unclaimed` wins over `running`; an
  // `unclaimed` rung checked after the supervised split could never fire on the
  // specimen that motivated it.
  { name: 'a live pane nobody wrote a claim for is unclaimed, even freshly supervised',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'unclaimed', serverOnly: null },

  // The other half of the same rung: it wins over `unsupervised` too. Without
  // this row a mutant that puts `unclaimed` between the two halves of the
  // supervised split still passes.
  { name: 'a live, unsupervised pane with no claim is unclaimed, not unsupervised',
    alive: true, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'unclaimed', serverOnly: null },
```

In `server/test/session-lifecycle.test.ts`, append a new describe at the end of the file:

```ts
describe('§1.6 — the unclaimed rung, and where it sits', () => {
  const base = {
    supervisedAt: null as number | null, stoppedAt: null as number | null,
    stopSurface: null, unmeasured: [] as readonly string[], nowMs: FIXTURE_NOW_MS,
  };

  it('THE ORDERING CONTRACT: alive + FRESH heartbeat + no claim is unclaimed, never running', () => {
    // The mutation this exists for: move the rung below the supervised split and
    // this row answers `running` — which is precisely what the live fleet reported
    // about swift-harbor while it was orphaned.
    expect(sessionLifecycle({
      ...base, alive: true, started: false, supervisedAt: FIXTURE_NOW_MS - 5_000,
    })).toBe('unclaimed');
  });

  it('an unreadable `started` is still unmeasurable, never unclaimed', () => {
    // `started` is a LIFECYCLE_FIELD, so the unmeasurable rung still precedes
    // everything. "We could not look" must never be reported as "nobody claimed it".
    expect(sessionLifecycle({
      ...base, alive: true, started: false, supervisedAt: FIXTURE_NOW_MS - 5_000,
      unmeasured: ['started'],
    })).toBe('unmeasurable');
  });

  it('a claimed live pane is untouched — the rung adds a state, it does not steal one', () => {
    expect(sessionLifecycle({
      ...base, alive: true, started: true, supervisedAt: FIXTURE_NOW_MS - 5_000,
    })).toBe('running');
    expect(sessionLifecycle({ ...base, alive: true, started: true })).toBe('unsupervised');
  });

  it('a DEAD pane with no claim is still never-started — unclaimed is an ALIVE-branch word', () => {
    expect(sessionLifecycle({ ...base, alive: false, started: false })).toBe('never-started');
  });
});
```

(`FIXTURE_NOW_MS` and `sessionLifecycle` are already imported by this file — it drives the fixture
through `lifecycleInputOf`; add `sessionLifecycle` to the existing `shared/api.js` import if the
`describe` at line ~73 does not already bring it in.)

In `pwa/test/session-lifecycle.test.tsx`, append to the describe that already holds
`'an orphan row says nothing is watching it'`:

```tsx
  it('an unclaimed row names the OPPOSITE repair from an orphan', () => {
    // orphan: nothing is bringing this back — the repair is a PROCESS.
    // unclaimed: a process is running that no registry row claims — the repair is
    // a CLAIM. A single sentence for both would send the operator to the wrong verb.
    render(<SessionLine session={s({ lifecycle: 'unclaimed' })} onOpen={() => {}} onActions={() => {}} />);
    const cell = document.querySelector('.sess-lifecycle');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-lifecycle')).toBe('unclaimed');
    expect(cell?.textContent).toBe('unclaimed — a live pane with no claim');
    expect(cell?.textContent).not.toContain('nothing is watching');
  });

  it('does NOT inherit running\'s deliberate null — the chip renders for unclaimed', () => {
    expect(lifecycleQualifier({ lifecycle: 'unclaimed' })).not.toBeNull();
    expect(lifecycleQualifier({ lifecycle: 'running' })).toBeNull();
  });
```

And in `server/test/ccd-session-lifecycle.test.ts`, append the bash-side half — **the derived
set-equality tail moves 6 → 7 on its own, but the POSITION of the rung is not derived and needs
its own assertions**:

```ts
describe('the unclaimed rung in bash, and its POSITION', () => {
  const ask = (lines: string[]): string => h.sh([
    CLOCK, `rm -f "$REG/${ID}".*`, '_alive() { return 0; }', ...lines, `_session_state ${ID}`,
  ].join('\n'));

  it('a live pane with a FRESH heartbeat and no claim reads unclaimed, never running', () => {
    // THE ORDERING CONTRACT, in the implementation that ships on the fleet box.
    // The specimen was alive AND supervised AND unclaimed; an `unclaimed`
    // checked after `running` could never fire on it.
    expect(ask([`printf '%s' "$((now - 5))" > "$REG/${ID}.supervised"`])).toBe('unclaimed');
  });

  it('and it wins over unsupervised too', () => {
    expect(ask([])).toBe('unclaimed');
  });

  it('a claimed live pane is unaffected — running and unsupervised still answer', () => {
    expect(ask([`printf '%s' "$((now - 5))" > "$REG/${ID}.supervised"`, `printf 1 > "$REG/${ID}.started"`]))
      .toBe('running');
    expect(ask([`printf 1 > "$REG/${ID}.started"`])).toBe('unsupervised');
  });

  it('a DEAD pane with no claim is still never-started, not unclaimed', () => {
    // The rung is inside the alive branch. `unclaimed` says a process is
    // running that no registry row claims — the repair is a CLAIM. `orphan`
    // says nothing is bringing this back — the repair is a PROCESS.
    const out = h.sh([CLOCK, `rm -f "$REG/${ID}".*`, '_alive() { return 1; }', `_session_state ${ID}`].join('\n'));
    expect(out).toBe('never-started');
  });

  it('the function\'s own comment enumerates the new word', () => {
    expect(h.sh('type _session_state')).toContain('unclaimed');
  });
});
```

All four names exist verbatim in `server/test/ccd-session-lifecycle.test.ts` at `d7137c2`:
`let h: CcdHarness;`, `const ID = 'demo-quiet-basin';`, `const CLOCK = […]` (the `date` stub) and the
top-level `now=…` the stub echoes. Read `CLOCK`'s own long docstring before touching it — it explains
why `now` must stay a top-level assignment (bash's dynamic scoping makes `_session_state`'s
as-yet-unassigned `local now` shadow it inside the callee).

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/session-lifecycle.test.ts
```

Expected: TypeScript rejects `expect: 'unclaimed'` in the fixture —
`Type '"unclaimed"' is not assignable to type 'SessionLifecycle'` — and the two new `it`s report
`expected 'running' to be 'unclaimed'` once the type is widened.

- [ ] **Step 3: Write minimal implementation**

(a) `shared/api.ts` — the union and the map:

```ts
export type SessionLifecycle =
  | 'running' | 'unsupervised' | 'unclaimed' | 'stopped' | 'restarting'
  | 'orphan' | 'never-started' | 'unmeasurable';
```

```ts
const SESSION_LIFECYCLE_MAP: Record<SessionLifecycle, true> = {
  running: true, unsupervised: true, unclaimed: true, stopped: true, restarting: true,
  orphan: true, 'never-started': true, unmeasurable: true,
};
```

(b) `shared/api.ts` — the ladder. Replace the single line
`  if (input.alive) return supervised ? 'running' : 'unsupervised';` with:

```ts
  // §1.6. THE ORDERING IS THE CONTRACT, and both implementations must agree on
  // it: `unclaimed` goes BEFORE the supervised split, because F8's specimen was
  // alive AND supervised AND unclaimed — an `unclaimed` checked after `running`
  // could never have fired on the row that motivated it. `unmeasurable` still
  // precedes everything above, so an UNREADABLE `started` (a LIFECYCLE_FIELD)
  // cannot be mistaken for an absent one.
  //
  // AND THE REPAIR IS THE OPPOSITE OF `orphan`'s: `orphan` says nothing is
  // bringing this back (the repair is a PROCESS); `unclaimed` says a process is
  // running that no registry row claims (the repair is a CLAIM — `ccd ensure`).
  if (input.alive) {
    if (!input.started) return 'unclaimed';
    return supervised ? 'running' : 'unsupervised';
  }
```

(c) `ccd/ccd` — the bash twin. Update the header comment line to
`_session_state() {   # id -> running|unsupervised|unclaimed|stopped|restarting|orphan|never-started`
and replace the alive branch, whose current body is

```
  if _alive "$id"; then
    (( fresh )) && { echo running; return 0; }
    # A pane with no supervisor: no auto-swap, no auto-compact, no uuid-sync,
    # and nothing to record its death. What a pre-fix `ccd start` minted.
    echo unsupervised; return 0
  fi
```

with

```
  if _alive "$id"; then
    # §1.6, and the FIRST rung inside this branch on purpose — the same position
    # the TS ladder puts it in, because both are driven from one fixture. A live
    # pane with no `started` stamp is a session nobody wrote a claim for: the
    # repair is a CLAIM (`ccd ensure`), not a process, which is the exact
    # opposite of `orphan`'s. Checked before the freshness split because the
    # specimen that motivated it was alive AND supervised AND unclaimed.
    [[ "$(_reg_get "$id" started)" == "1" ]] || { echo unclaimed; return 0; }
    (( fresh )) && { echo running; return 0; }
    # A pane with no supervisor: no auto-swap, no auto-compact, no uuid-sync,
    # and nothing to record its death. What a pre-fix `ccd start` minted.
    echo unsupervised; return 0
  fi
```

The `>= 0` future-stamp guard and the 120-second window above are UNTOUCHED — both implementations
are driven from one fixture and that boundary is the contract.

(d) `pwa/src/fleet/lifecycleWords.ts` — `QUALIFIER` is
`Record<Exclude<SessionLifecycle, 'stopped'>, string | null>` and will not compile (TS2739) until the
member gets a sentence. That compile error is the mechanism working. Add, after the `unsupervised`
entry:

```ts
  /** The OPPOSITE repair from `orphan` below, and the sentence has to say so:
   *  `orphan` means nothing is bringing this back (fix: a process); `unclaimed`
   *  means a process IS running and no registry row claims it (fix: a claim —
   *  `ccd ensure`, which is what "Restart session" posts). */
  unclaimed: 'unclaimed — a live pane with no claim',
```

(e) Re-stamp `ccd/ccd`'s provenance marker in this same commit — the command is in
`server/test/ownership.test.ts`'s own failure message
(`ccd/ccd was edited without re-stamping its provenance marker`).

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/session-lifecycle.test.ts test/ccd-session-lifecycle.test.ts test/ownership.test.ts
```

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx && npm run build
```

`npm run build` is not optional here: `lifecycleWords.ts`'s TS2739 is INVISIBLE to `npm run test`.

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add shared/api.ts ccd/ccd pwa/src/fleet/lifecycleWords.ts server/test/sessionLifecycleFixture.ts server/test/session-lifecycle.test.ts server/test/ccd-session-lifecycle.test.ts pwa/test/session-lifecycle.test.tsx && git commit -m "feat: a live pane with no claim is unclaimed — one member, one rung, both implementations (§1.6)"
```

---

### Task 103: `started` and `spawnState` reach the wire

**Files:**
- Modify: `shared/api.ts` (`FleetSession` — append after its last field, identified by
  `readonly swapBlocked: { readonly at: number; readonly reason: string } | null;`; a module-private
  `optBool` beside the existing `reqBool`; `reviveFleetSession`'s `const revived = {` literal,
  identified by its entry `stoppedBy: reviveStoppedBy(o, 'stoppedBy'),`)
- Modify: `server/src/fleet.ts` (`assembleFleet`'s `const session: FleetSession = {` literal,
  identified by its entry `lifecycle: sessionLifecycle(lifecycleInput),`; and the import line
  `import { sessionBucket, sessionLifecycle } from '../../shared/api.js';`)
- Test: `server/test/fleet-lifecycle.test.ts`, `server/test/fleetstate.test.ts`
- Test (COMPILE ONLY, no new assertions): `server/test/fleet.test.ts`,
  `server/test/dialog.test.ts`, `server/test/fleet-health.test.ts`, and **every** `FleetSession`
  factory under `pwa/test/` — measured at d7137c2 there are **21** such files, not the eight an
  earlier draft listed. Derive the list, do not retype it:
  `git grep -ln "swapBlocked" -- pwa/test/`

**Interfaces:**
- Consumes: `SpawnVerdict`, `isSpawnVerdict`, `spawnVerdict` (Task 101).
- Produces: `FleetSession.started: boolean`; `FleetSession.spawnState: SpawnVerdict | null`. Both
  REQUIRED on the interface — `reviveFleetSession` returns a literal, so both are a compile error
  until every path computes them. That is the mechanism.

- [ ] **Step 1: Write the failing test**

In `server/test/fleet-lifecycle.test.ts`, append:

```ts
describe('§1.6b — the spawn verdict reaches the wire off the SHIPPED `spawn` field', () => {
  it('projects the rc, keeping the `<epoch-seconds> <rc>` encoding untouched', async () => {
    const s = await one(
      { supervised: String(NOW_SEC - 5), started: '1', spawn: `${NOW_SEC - 30} 5` }, true);
    expect(s.spawnState).toBe('blocked');
    expect(s.started).toBe(true);
  });

  it('a row with NO $REG/<id>.spawn file is null — not `ready`, not a warning', async () => {
    // THIS IS swift-harbor's EXACT SHAPE, and the reason F8's detection keys on
    // `unclaimed` rather than on the spawn verdict: the class is the ABSENT CLAIM,
    // not the failed attempt. A `null` laundered into `ready` would assert a
    // measurement nobody made; laundered into a warning it would light every one of
    // the 18 live sessions that has not spawned since PR #50.
    const s = await one({ supervised: String(NOW_SEC - 5), started: '1' }, true);
    expect(s.spawnState).toBeNull();
  });

  it('an unparseable rc is `spawn: null` at the record and null on the wire', async () => {
    const s = await one({ started: '1', spawn: `${NOW_SEC - 30} banana` }, true);
    expect(s.spawnState).toBeNull();
  });

  it('carries `started: false` onto the wire — the only signal swift-harbor emits', async () => {
    const s = await one({ supervised: String(NOW_SEC - 5) }, true);
    expect(s.started).toBe(false);
    expect(s.spawnState).toBeNull();
    expect(s.lifecycle).toBe('unclaimed');
  });
});
```

In `server/test/fleetstate.test.ts`, append (next to the existing
`'revives `held` — absent degrades to null, a non-string rejects the whole session'`):

```ts
  it('revives `started` — ABSENT DEGRADES TO TRUE, which is the documented direction', async () => {
    // Every session a pre-Wave-1 build persisted HAD a claim; `false` would light
    // `unstarted` on every restored row, and a surface that cries wolf on restore
    // is a surface the operator learns to ignore.
    const revived = reviveFleetSession({ ...v1Session, started: undefined });
    expect(revived?.started).toBe(true);
    expect(reviveFleetSession({ ...v1Session, started: false })?.started).toBe(false);
    expect(reviveFleetSession({ ...v1Session, started: 'yes' })).toBeNull();
  });

  it('revives `spawnState` — absent is null, and an unknown token rejects rather than launders', async () => {
    expect(reviveFleetSession({ ...v1Session, spawnState: undefined })?.spawnState).toBeNull();
    expect(reviveFleetSession({ ...v1Session, spawnState: 'blocked' })?.spawnState).toBe('blocked');
    // Unlike an unrecognised RC (which becomes `unrecognised` in L0), an
    // unrecognised STRING off a cache an older-or-newer build wrote rejects the
    // whole session — the same rule `lifecycle`/`bucket`/`hookState` already follow.
    expect(reviveFleetSession({ ...v1Session, spawnState: 'spawnstate' })).toBeNull();
    expect(reviveFleetSession({ ...v1Session, spawnState: 3 })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/fleet-lifecycle.test.ts test/fleetstate.test.ts
```

Expected: `Property 'spawnState' does not exist on type 'FleetSession'` at collect time; once the
interface lands, `expected undefined to be 'blocked'`.

- [ ] **Step 3: Write minimal implementation**

(a) `shared/api.ts` — append to `FleetSession`, after `swapBlocked`:

```ts
  /** `$REG/<id>.started` reads `1`. MEASURED every snapshot as
   *  `SessionRecord.started` and, before Wave 1, discarded one branch later
   *  inside `sessionLifecycle`. It reaches the wire because the spawn chip needs
   *  it: `swift-harbor` has NO `spawn` stamp, so `started === false` is the only
   *  signal that shape ever emits. */
  readonly started: boolean;
  /** How the LAST spawn attempt ended (§1.6b). `null` = NOT RECORDED — never
   *  `ready`, never a warning. ORTHOGONAL to `lifecycle`: a row can be `running`
   *  today after a failed spawn yesterday, and showing one as the other would be
   *  an adapter narrowing a distinction it received. */
  readonly spawnState: SpawnVerdict | null;
```

(b) `shared/api.ts` — a module-private `optBool`, immediately after the existing `reqBool`:

```ts
/** Absent or explicitly null -> the caller's FALLBACK; present -> must be a
 *  boolean. `reviveFleetSession` had no `optBool` before Wave 1, and `reqBool`
 *  on an absent `started` would have rejected the WHOLE snapshot rather than
 *  degrading one field. The fallback is a parameter and not a constant because
 *  the honest degrade is per-field, not per-type. */
const optBool = (o: RawObj, k: string, fallback: boolean): boolean => {
  const v = o[k];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new MalformedSnapshot(k);
  return v;
};
```

(c) `shared/api.ts` — in `reviveFleetSession`, add the validation ABOVE the literal, in the
`lifecycleRaw` idiom (place it directly after the `lifecycleRaw` guard):

```ts
    // Absent -> null ("not recorded"). An unrecognised STRING rejects the whole
    // session rather than being laundered — the same rule `lifecycle` above
    // follows. Note the asymmetry with L0: an unrecognised RC becomes
    // `'unrecognised'` inside `spawnVerdict`, because an rc is ccd's own output
    // and a word off a cache is not.
    const spawnRaw = optStr(o, 'spawnState');
    if (spawnRaw !== null && !isSpawnVerdict(spawnRaw)) {
      throw new MalformedSnapshot('spawnState');
    }
```

…and two entries on the `const revived = {` literal, beside `stoppedBy`:

```ts
      // THE DEGRADE, DOCUMENTED: absent reads TRUE, not false. Every session a
      // pre-Wave-1 build persisted had a claim, and `false` would light
      // `unstarted` on every restored row — the false-positive direction that
      // makes a surface ignorable.
      started: optBool(o, 'started', true),
      spawnState: spawnRaw,
```

(d) `server/src/fleet.ts` — extend the import and add two entries to the `session` literal beside
`lifecycle`:

```ts
import { sessionBucket, sessionLifecycle, spawnVerdict } from '../../shared/api.js';
```

```ts
      // Carried straight off the record. `SessionRecord.spawn: { at; rc } | null`
      // ALREADY EXISTS and is already parsed from `$REG/<id>.spawn` — nothing new
      // is read off disk here, and the `<epoch-seconds> <rc>` encoding is
      // untouched (its timestamp is what `_supervised_start` compares `at >= since`
      // against). This is a PROJECTION onto the wire, not a second field.
      started: r.started,
      spawnState: spawnVerdict(r.spawn === null ? null : r.spawn.rc),
```

(e) Add `started: true, spawnState: null,` to every `FleetSession` factory the compiler names. The
server-side list is `server/test/fleet.test.ts`, `server/test/dialog.test.ts`,
`server/test/fleet-health.test.ts`; the PWA list comes from
`git grep -ln "swapBlocked" -- pwa/test/` (21 files at `d7137c2`). **`pwa/test/seen.test.ts` will
NOT announce itself** — it builds its rows through an `as FleetSession` cast and is immune to the
compiler. Update it deliberately.

**Run this first, before writing any of (e) — it is the one break `npm run build` cannot catch:**

```
grep -rn "Object.keys\|toStrictEqual" pwa/test/*.ts pwa/test/*.tsx server/test/*.ts | grep -i sess
```

An `Object.keys(session)` length assertion or a `toStrictEqual` over a whole `FleetSession` fails at
RUNTIME with two new keys and compiles clean. Add every file the grep names to the Files list and to
Step 5's `git add`; if it names none, record that in the commit body so the next widening does not
re-run the search.

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/fleet-lifecycle.test.ts test/fleetstate.test.ts test/fleet.test.ts test/dialog.test.ts test/fleet-health.test.ts
```

```
cd /srv/projects/ccrc-pwa/pwa && npm run build && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa
# ENUMERATED, never `git add server/test pwa/test`: Task 112's Step 2 has the
# implementer pasting mutations into pwa/src and server/src and reverting them,
# and a bare directory sweeps whatever is mid-edit into the wrong commit. The
# branch's discipline is that every commit is independently green.
git add shared/api.ts server/src/fleet.ts \
  server/test/fleet.test.ts server/test/dialog.test.ts server/test/fleet-health.test.ts \
  server/test/fleet-lifecycle.test.ts server/test/fleetstate.test.ts \
  $(git grep -l "swapBlocked" -- pwa/test/) pwa/test/seen.test.ts
git commit -m "feat(wire): FleetSession carries started and spawnState — additive, no FLEET_PROTO bump (§1.6b)"
```

---

### Task 104: the spawn chip

**Files:**
- Modify: `pwa/src/fleet/SessionLine.tsx` (a module-private `SPAWN_WORD` beside the existing
  `const WORD: Record<SessionBucket, string>`; a local `spawnChip` beside
  `const qualifier = lifecycleQualifier(session);`; a new cell in the `.sess-meta` span, identified
  by its first child `<span className={\`sess-state sess-state--${state}\`}>{state}</span>`)
- Modify: `pwa/src/fleet/fleet.css` (a `.sess-spawn` rule; and the achromatic group whose last
  selector is `.sess-line--active .sess-meta > *:not(:first-child)::before`)
- Modify: `pwa/design/audit.mjs` (`INHERITED_GROUNDS`)
- Test: `pwa/test/session-line.test.tsx`, `pwa/test/fleet-css.test.ts`, `pwa/test/contrast.test.ts`

**Interfaces:**
- Consumes: `FleetSession.spawnState`, `FleetSession.started` (Task 103); `SpawnVerdict` (Task 101).
- Produces: DOM contract `.sess-spawn[data-spawn="<SpawnVerdict|unstarted>"]`, position 2 in
  `.sess-meta`. `SPAWN_WORD` stays PRIVATE to `SessionLine.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/session-line.test.tsx`:

```tsx
describe('the spawn chip (§1.6b)', () => {
  const chip = () => document.querySelector('.sess-spawn');

  it('renders NOTHING for the overwhelmingly common shape: no stamp, claimed', () => {
    // THE FALSE-POSITIVE DIRECTION, and the reason the rule is not "chip on
    // anything not ready": `null` satisfies "not ready", and all 18 live sessions
    // carry `null` because they have not spawned since PR #50 shipped the field.
    render(<SessionLine session={s({ spawnState: null, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it('renders `unstarted` for swift-harbor\'s exact shape — no stamp, no claim', () => {
    render(<SessionLine session={s({ spawnState: null, started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent).toBe('unstarted');
    expect(chip()?.getAttribute('data-spawn')).toBe('unstarted');
  });

  it('says nothing for a clean spawn', () => {
    render(<SessionLine session={s({ spawnState: 'ready', started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it.each([
    ['blocked', 'blocked'], ['login', 'login'], ['vanished', 'vanished'],
    ['expired', 'unconfirmed'], ['unrecognised', 'unknown'],
  ] as const)('renders %s as %s', (state, word) => {
    render(<SessionLine session={s({ spawnState: state, started: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()?.textContent).toBe(word);
    expect(chip()?.getAttribute('data-spawn')).toBe(state);
  });

  it('never renders a chip on a dead row — the exemption critical/subagentList already take', () => {
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead', spawnState: 'blocked', started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(chip()).toBeNull();
  });

  it('renders ONE chip, never two — a failed spawn and an absent claim are one cell', () => {
    render(<SessionLine session={s({ spawnState: 'expired', started: false })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelectorAll('.sess-spawn')).toHaveLength(1);
    expect(chip()?.textContent).toBe('unconfirmed');
  });

  it('sits at position 2, immediately after .sess-state', () => {
    // `.sess-meta` has NO flex-wrap and NO `order`: DOM order IS visual order.
    render(<SessionLine session={s({ spawnState: 'blocked', started: true, held: 'program:x wave:2/4' })}
                        onOpen={() => {}} onActions={() => {}} />);
    const cells = [...(document.querySelector('.sess-meta')?.children ?? [])];
    expect(cells[0]?.className).toContain('sess-state');
    expect(cells[1]?.className).toContain('sess-spawn');
  });

  it('does not clip the hold reason away — .sess-held is the one shrinkable cell', () => {
    // §2.4 LENGTHENS the hold reason (` run:<id>`) in the same build, and
    // `.sess-held` is the only cell with `overflow: hidden`/`text-overflow:
    // ellipsis` and no `flex: none`. The two changes compound: a new cell that
    // is not `flex: none` steals room from it first.
    render(<SessionLine session={s({ spawnState: 'blocked', started: true, held: 'program:build8 wave:2/4 run:17' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-held')?.textContent).toBe('program:build8 wave:2/4 run:17');
  });

  it('reads both fields DEFENSIVELY — a live `fleet` frame is CAST, never revived', () => {
    // `stores/fleet.ts`'s `asFleetMsg` validates frames, not MEMBERS, so a row
    // from a server that predates these fields lacks the keys at RUNTIME even
    // though `FleetSession` types them as present. Same reason `unmeasuredFields`
    // exists — the last time this was skipped a TypeError took the renderer down.
    const legacy = { ...s() } as Record<string, unknown>;
    delete legacy['spawnState'];
    delete legacy['started'];
    expect(() =>
      render(<SessionLine session={legacy as unknown as FleetSession}
                          onOpen={() => {}} onActions={() => {}} />)).not.toThrow();
    expect(chip()).toBeNull();
  });
});
```

Append to `pwa/test/fleet-css.test.ts`, inside the `'strips every status and account hue from the
slab'` test's cell list, `'.sess-spawn'` (the group is a subset check over `selectorsOf`, so the
entry is the assertion), and add:

```ts
  it('gives the spawn chip a flex: none cell so it cannot steal the hold reason\'s room', () => {
    // `.sess-held` is the ONE shrinkable cell in `.sess-meta` (overflow:hidden +
    // text-overflow:ellipsis, no `flex: none`), and §2.4 lengthens what it holds
    // in the same build. A chip without `flex: none` truncates it first.
    expect(ruleFor('.sess-spawn')).toContain('flex: none');
  });
```

Append to `pwa/test/contrast.test.ts`:

```ts
  it('measures the spawn chip rather than leaving it in the uncovered census', () => {
    // `.sess-held`/`.sess-lifecycle`/`.sess-swapblocked` all sit in the auditor's
    // UNCOVERED census — their ground is DOM knowledge a parser cannot recover —
    // so a new coloured cell beside them would silently join them there. The
    // INHERITED_GROUNDS entry is what makes it MEASURED.
    expect(INHERITED_GROUNDS['fleet.css .sess-spawn']?.under).toEqual(['var(--bg-surface)']);
  });

  it('and closes the PRE-EXISTING gap next door: .sess-held on a SELECTED row', () => {
    // Found while writing the entry above, and it is a live defect rather than a
    // tidy-up: `fleet-css.test.ts`'s achromatic group lists `.sess-meta`,
    // `.sess-state`, `.sess-tally`, `.sess-subagents`, `.sess-warn`, `.sess-acct`,
    // `.sess-acct-away`, `.sess-ask` and `.sess-subagent-row` — and NOT
    // `.sess-held` or `.sess-unmeasured`, both of which set `--ink-tertiary`. On
    // the desktop SELECTED row that is tertiary ink on `--ink-primary`
    // (~2.7:1 dark / ~2.9:1 light against a 4.5 floor), reachable exactly during
    // a program — i.e. exactly when the hold reason is the thing you are reading.
    // The gate cannot see it because both rules sit in the UNCOVERED census.
    // One INHERITED_GROUNDS entry makes the figure MEASURED instead of argued.
    expect(INHERITED_GROUNDS['fleet.css .sess-line--active .sess-held']?.under)
      .toEqual(['var(--ink-primary)']);
  });
```

The second entry to add in `pwa/design/audit.mjs`, beside the `.sess-spawn` one:

```js
  'fleet.css .sess-line--active .sess-held': {
    under: ['var(--ink-primary)'],
    why: 'the SELECTED desktop row inverts: its ground is --ink-primary. .sess-held sets --ink-tertiary and is NOT in fleet-css.test.ts\'s achromatic override group, so on a selected row it is tertiary ink on primary ground — measured ~2.7:1 dark / ~2.9:1 light against a 4.5 floor, and reachable exactly during a program, when the hold reason is what you are trying to read. Grounding it here makes the gate measure it; if it fails, the fix is to add .sess-held (and .sess-unmeasured) to the achromatic override group, not to raise the token',
  },
```

**Settle the figure before writing the entry** — run
`cd pwa && node design/contrast-check.mjs --uncovered | grep -E 'sess-spawn|sess-held'` and read what
the auditor currently says about both. If `.sess-held` measures at or above 4.5 on the selected row,
KEEP the entry (it is then a regression pin) and delete the sentence claiming it fails today.

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts
```

Expected: `expected null not to be null` on the chip queries; `Cannot read properties of undefined
(reading 'under')` in the contrast test; the fleet-css group assertion reports the missing
`.sess-line--active .sess-spawn` member.

- [ ] **Step 3: Write minimal implementation**

(a) `pwa/src/fleet/SessionLine.tsx`, after the `WORD` table:

```tsx
/** The spawn verdict's DISPLAYED word — a third presentational table over one
 *  field, which is this file's existing convention (`WORD`, `StatusDot`'s own
 *  glyph/label pair). PRIVATE on purpose: an exported table invites a caller to
 *  retitle a surface it does not feed, and the L0 vocabulary
 *  (`SPAWN_VERDICTS`) is not this list.
 *
 *  `expired -> 'unconfirmed'` and its quiet ink are deliberate: a systemd
 *  restart of a large session legitimately settles unconfirmed, and painting a
 *  healthy row dead-red trains the operator to ignore the chip. `ready -> null`
 *  because a healthy row has nothing to qualify. */
const SPAWN_WORD: Record<SpawnVerdict, string | null> = {
  ready: null,
  login: 'login',
  vanished: 'vanished',
  expired: 'unconfirmed',
  blocked: 'blocked',
  unrecognised: 'unknown',
};
```

…with `SpawnVerdict` added to the existing type-only import from `'../../../shared/api'`.

Beside `const qualifier = lifecycleQualifier(session);`:

```tsx
  // §1.6b. ONE chip, never two, and never on a dead row (the exemption
  // `critical`/`subagentList` already take — nothing is running, so how the last
  // spawn ended describes work that no longer exists).
  //
  // THE RULE IS NOT "chip on anything not ready": `null` satisfies "not ready",
  // and `null` is what all 18 live sessions carry, so that rule would light a
  // warning on every healthy row. `swift-harbor` has NO spawn stamp at all — its
  // `spawnState` is correctly `null` and `started === false` is the ONLY signal
  // that shape emits, which is why the second arm is not optional.
  //
  // Both fields read DEFENSIVELY (`?? null`, `!== false`): the live `fleet` frame
  // is CAST, not revived (`stores/fleet.ts`'s `asFleetMsg` validates frames, not
  // members), so an older server's row lacks the keys at runtime.
  const spawnState = session.spawnState ?? null;
  const spawnChip: string | null =
    dead ? null
    : spawnState !== null && spawnState !== 'ready' ? SPAWN_WORD[spawnState]
    : session.started === false ? 'unstarted'
    : null;
  const spawnData = spawnChip === null ? undefined : (spawnState ?? 'unstarted');
```

…and the cell, immediately after the `.sess-state` span and before the `.sess-unmeasured` block:

```tsx
          {/* Position 2, immediately after `.sess-state`. `.sess-meta` has no
              flex-wrap and no `order`, so DOM order IS visual order, and only
              `.sess-held`/`.sess-acct` shrink — which is why this cell is
              `flex: none` in fleet.css: §2.4 lengthens the hold reason in the
              same build and the two changes compound. */}
          {spawnChip !== null && (
            <span className="sess-spawn" data-spawn={spawnData} title={`last spawn: ${spawnData}`}>
              {spawnChip}
            </span>
          )}
```

(b) `pwa/src/fleet/fleet.css` — add `.sess-line--active .sess-spawn,` to the achromatic group,
immediately before `.sess-line--active .sess-meta > *:not(:first-child)::before {`, and add the rule
beside `.sess-warn`:

```css
/* The spawn chip (§1.6b) — how the LAST spawn attempt ended, beside the state
   word rather than folded into it. Two inks, both already minted, so no new
   contrast pair: --status-dead-text for the three verdicts that mean "this will
   not fix itself" (blocked / login / vanished / unstarted) and --ink-tertiary
   for the two that mean "we do not know" (unconfirmed / unknown). `flex: none`
   is load-bearing: .sess-held is the only shrinkable cell in .sess-meta and
   §2.4 lengthens what it holds. */
.sess-spawn {
  font-family: var(--font-mono);
  flex: none;
  color: var(--status-dead-text);
}
.sess-spawn[data-spawn='expired'],
.sess-spawn[data-spawn='unrecognised'] {
  color: var(--ink-tertiary);
}
```

(c) `pwa/design/audit.mjs` — add to `INHERITED_GROUNDS`:

```js
  'fleet.css .sess-spawn': {
    under: ['var(--bg-surface)'],
    why: 'the spawn chip is a .sess-meta cell on an unselected .sess-line, whose ground is the project card. Its selector names no ancestor, so no route could ground it — without this entry it joins .sess-held/.sess-lifecycle in the uncovered census, which is exactly where the last unmeasured meta cell was shipping below AA. The SELECTED row is answered by the achromatic group (--edge-strong), pinned separately in fleet-css.test.ts',
  },
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts && npm run build
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add pwa/src/fleet/SessionLine.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/session-line.test.tsx pwa/test/fleet-css.test.ts pwa/test/contrast.test.ts && git commit -m "feat(pwa): the fleet row says how the last spawn ended, once, quietly (§1.6b)"
```

---

### Task 105: the actions sheet names the repair for each spawn state

**Files:**
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx` (a note beside the two shipped ones, identified by
  `{session.lifecycle === 'unsupervised' && (` and its `<p className="sess-sheet-note">`)
- Test: `pwa/test/session-actions-sheet.test.tsx`

**Interfaces:**
- Consumes: `FleetSession.spawnState` (Task 103); **`FleetSession.lifecycle === 'unclaimed'`
  (Task 102); and w1-ccd Task 11, which is what makes the `unclaimed` paragraph TRUE.**
- Produces: no new exported name. **No new control**: `Restart session` (`api.ensure`) IS the
  adoption path.

**HARD DEPENDENCY, because the copy below is a promise.** `cmd_ensure`'s alive branch is verbatim
`if _alive "$id"; then _resupervise_live "$id"; echo "alive: $id"; return 0; fi` — it never reaches
`_spawn_start`, so it never reaches the claim `_spawn_start`/`_spawn_settle` sandwich. An
`unclaimed` row is alive **by definition** (the rung sits inside the `_alive` branch). So until
w1-ccd Task 11 puts `_reg_claim` on `_resupervise_live`'s `unclaimed` branch, *"Restart session
writes the claim and adopts the pane"* is **false**, and this task must not ship ahead of it. With
Task 11 in, it is exactly true — `_resupervise_live` writes the claim and runs `enable --now`, with
no second spawn. Ship them in that order and the sentence is a measurement.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/session-actions-sheet.test.tsx`:

```tsx
describe('the spawn-state note (§1.6b)', () => {
  // THIS FILE HAS NO RENDER HELPER — verified at d7137c2: every one of its ~20
  // mount sites spells the render inline, and `open`, `onClose` and `onReap`
  // are all required props. So the helper is DEFINED HERE, modelled on the
  // `line()` helper in pwa/test/session-lifecycle.test.tsx.
  const renderSheet = (session: FleetSession): void => {
    render(<SessionActionsSheet session={session} open onClose={() => {}} onReap={() => {}} />);
  };
  const notes = () => [...document.querySelectorAll('.sess-sheet-note')].map((n) => n.textContent ?? '');

  it('points a blocked spawn at Swap account and the terminal, not at Restart', () => {
    // A hard block is the one verdict where waiting cannot help and restarting
    // reproduces it: the account is rate-limited or logged out.
    renderSheet(s({ spawnState: 'blocked' }));
    expect(notes().join(' ')).toContain('Swap account');
    expect(notes().join(' ')).not.toContain('Restart session revives it');
  });

  it('points a login spawn at Swap account too', () => {
    renderSheet(s({ spawnState: 'login' }));
    expect(notes().join(' ')).toContain('Swap account');
  });

  it('says an unconfirmed settle is not a fault', () => {
    // A systemd restart of a large session legitimately settles unconfirmed
    // ("700k+-token resumes take minutes between gates"). A sheet that calls that
    // broken teaches the operator to ignore the sheet.
    renderSheet(s({ spawnState: 'expired' }));
    expect(notes().join(' ')).toContain('not a fault');
  });

  it('says NOTHING for a CLEAN spawn', () => {
    renderSheet(s({ spawnState: 'ready' }));
    expect(notes().join(' ')).not.toContain('last spawn');
  });

  it('and says NOTHING for an UNRECORDED one — the case every pre-#50 row carries', () => {
    // A SEPARATE `it`, deliberately. `notes()` reads the whole document and the
    // file's cleanup runs BETWEEN TESTS, not between renders — two renders in
    // one case leave the second assertion unable to fail, which would pin
    // nothing at all about `spawnState: null`. This is the false-positive
    // direction that would otherwise light a note on all 18 live sessions.
    renderSheet(s({ spawnState: null }));
    expect(notes().join(' ')).not.toContain('last spawn');
  });

  it('names a CLAIM as the repair for unclaimed, never a process', () => {
    renderSheet(s({ lifecycle: 'unclaimed' }));
    const t = notes().join(' ');
    expect(t).toContain('Restart session');
    expect(t).not.toContain('Nothing is watching');
  });
});
```

`s(...)` IS this file's existing session-literal factory (it also aliases it as `f` inside the
`hold and release` describe) — reuse it. `render`, `FleetSession` and `SessionActionsSheet` are
already imported at the top of the file; add nothing.

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx
```

Expected: `expected '…' to contain 'Swap account'` on the first three cases (the words appear only on
the BUTTON, not in a `.sess-sheet-note`), and `expected '…' to contain 'Restart session'` on the last.

- [ ] **Step 3: Write minimal implementation**

In `pwa/src/fleet/SessionActionsSheet.tsx`, directly after the `session.lifecycle === 'unsupervised'`
note block:

```tsx
          {/* §1.6b. A SECOND, orthogonal qualifier: the two notes above say what
              the row IS; this says how its LAST SPAWN ATTEMPT ended. A row can be
              `running` today after a failed spawn yesterday, so these are
              deliberately separate paragraphs and not a widened gate.

              `ready` and `null` say nothing at all — `null` is NOT RECORDED, which
              is what every session that has not spawned since PR #50 carries. */}
          {(session.spawnState === 'blocked' || session.spawnState === 'login') && (
            <p className="sess-sheet-note">
              {`The last spawn stopped at ${session.spawnState === 'login' ? 'a login screen' : 'a limit or spend banner'} — Restart session will hit it again. Swap account moves this session to a usable lane; the terminal is where you fix the lane itself.`}
            </p>
          )}
          {session.spawnState === 'expired' && (
            <p className="sess-sheet-note">
              The last spawn never confirmed its TUI inside the settle window. That
              is not a fault on its own — a large resume legitimately takes minutes
              between gates — but if the pane is empty, Restart session re-runs it.
            </p>
          )}
          {session.spawnState === 'vanished' && (
            <p className="sess-sheet-note">
              The tmux session disappeared while the last spawn was still waiting on
              it. Restart session builds a new pane; the conversation is resumed
              from the transcript, not from that pane.
            </p>
          )}

          {/* `unclaimed` and `orphan` have OPPOSITE repairs and must not share a
              sentence: `orphan` means nothing is bringing this back (fix: a
              process); this means a process IS running that no registry row claims
              (fix: a CLAIM). `Restart session` posts `/ensure`, and `cmd_ensure`
              writes `started` between the two halves of the spawn — which is
              exactly the claim this row is missing. No new control is needed. */}
          {session.lifecycle === 'unclaimed' && (
            <p className="sess-sheet-note">
              {`This pane is running, but no registry row claims it — so nothing will resume it, swap it or record its death. Restart session writes the claim and adopts the pane: the same thing ccd ensure ${session.id} does at a terminal. Nothing is restarted and nothing in the conversation is lost.`}
            </p>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx && npm run build
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add pwa/src/fleet/SessionActionsSheet.tsx pwa/test/session-actions-sheet.test.tsx && git commit -m "feat(pwa): the actions sheet names the repair for a failed spawn and for an unclaimed pane"
```

---

### Task 106: the agent stops erasing the kill (§1.4)

**AGENT LANE.** Deploy with `bash deploy/deploy.sh agent <host>` — **the host argument is not
optional**, `deploy.sh` defaults `$BOX` to the SERVER box. Restarting the agent drops the single
authenticated WebSocket the whole PWA runs over; expect a link outage.

**Files:**
- Modify: `agent/src/server.ts` (`runExec`, identified by its declaration
  `function runExec(` and its current return type
  `): Promise<{ code: number; stdout: string; stderr: string }> {`)
- Test: `agent/test/exec.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `exec` response frame gains `killed: boolean` and `signal: string | null`.
  ADDITIVE — an older server ignores both; **no `FLEET_PROTO` bump**.

- [ ] **Step 1: Write the failing test**

Append to `agent/test/exec.test.ts` (inside the existing `describe('ccrc-agent exec whitelist', …)`,
so the `afterEach` teardown and the `contain-path.setup.ts` PATH containment both apply):

```ts
  it('tells a SIGTERM at the deadline apart from a plain non-zero exit (§1.4)', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // Two children that both answer `code: 1` today and are byte-identical on the
    // wire: one that REFUSED, one we KILLED. That collapse is why the dispatch
    // layer cannot tell a real failure from a timeout, and §1.5's adoption gate
    // rests entirely on telling them apart.
    const bin = makeStubBinary('tmux', 'if [ "$1" = hang ]; then sleep 30; fi; exit 1');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const refused = await client.req<ExecRes>(1, { op: 'exec', cmd: 'tmux', args: ['has-session'] });
      expect(refused).toMatchObject({ ok: true, code: 1, killed: false, signal: null });

      const killed = await client.req<ExecRes>(2, {
        op: 'exec', cmd: 'tmux', args: ['hang'], timeoutMs: 200,
      });
      expect(killed).toMatchObject({ ok: true, code: 1, killed: true });
      expect((killed as { signal?: unknown }).signal).toBe('SIGTERM');
    } finally {
      process.env.PATH = origPath;
    }
  }, 20_000);

  it('leaves stderr empty on a kill, and the reason is NOT "a killed child writes nothing"', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    // C2's correction, worth pinning because the false version is written down in
    // this repo: `execFile` DELIVERS whatever the child had already buffered. The
    // stderr is empty because NO STDERR-WRITING STATEMENT WAS REACHED — the child
    // was still asleep. This stub proves it by writing to stderr BEFORE it sleeps.
    const bin = makeStubBinary('tmux', 'echo "partial" 1>&2; sleep 30');
    const origPath = process.env.PATH;
    process.env.PATH = `${path.dirname(bin)}${path.delimiter}${origPath ?? ''}`;
    try {
      const res = await client.req<ExecRes>(1, {
        op: 'exec', cmd: 'tmux', args: ['hang'], timeoutMs: 300,
      });
      expect(res).toMatchObject({ ok: true, killed: true });
      expect((res as { stderr?: string }).stderr).toContain('partial');
    } finally {
      process.env.PATH = origPath;
    }
  }, 20_000);
```

Widen the file's own local test type (`interface ExecRes { ok: boolean; code?: number; stdout?:
string; stderr?: string; err?: string }`) with `killed?: boolean; signal?: string | null;`.

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/agent && ./node_modules/.bin/vitest run test/exec.test.ts
```

Expected: `expected { ok: true, code: 1, stdout: '', stderr: '' } to match object { …, killed: false,
signal: null }` — the keys are absent because `runExec` discards them.

- [ ] **Step 3: Write minimal implementation**

Replace `runExec` in `agent/src/server.ts`:

```ts
/**
 * §1.4. `error.code ?? 1` used to be the WHOLE answer, which made `{code:1}` from
 * "ccd exited 1" byte-identical to `{code:1}` from "we SIGTERM'd ccd at the
 * deadline" — an overloaded value at a seam, and the reason the dispatch layer
 * could not tell a real refusal from a timeout (§1.5's adoption gate rests on
 * exactly this distinction).
 *
 * `killed` and `signal` are ADDITIVE and absence-permits: an older server ignores
 * both, and a newer server reads their absence as `killed: false`, which is the
 * safe direction (it never adopts). NO `FLEET_PROTO` bump.
 *
 * WHY STDERR IS EMPTY ON A KILL, correctly stated: not because "a killed child
 * writes nothing" — `execFile` delivers whatever was already buffered — but
 * because NO STDERR-WRITING STATEMENT WAS REACHED. The child was still blocked.
 */
function runExec(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; killed: boolean; signal: string | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }, (error, stdout, stderr) => {
      const code = error
        ? (((error as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1)
        : 0;
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout: String(stdout),
        stderr: String(stderr),
        killed: (error as (NodeJS.ErrnoException & { killed?: boolean }) | null)?.killed === true,
        signal: (error as (NodeJS.ErrnoException & { signal?: string }) | null)?.signal ?? null,
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/agent && ./node_modules/.bin/vitest run test/exec.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add agent/src/server.ts agent/test/exec.test.ts && git commit -m "fix(agent): a SIGTERM at the deadline stops looking like exit 1 (§1.4)"
```

---

### Task 107: `killed` survives all three hops

**Files:**
- Modify: `server/src/exec.ts` (`export interface ExecResult { code: number; stdout: string; stderr: string }`)
- Modify: `server/src/remote/runner.ts` (`asExecResult`; the `createRunner` catch arm, identified by
  `return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };`; and the
  false sentence `(a killed child writes nothing)` inside the `CCD_VERB_TIMEOUT_MS` comment)
- Modify: `server/src/lifecycle.ts` (`export interface CcdResult { ok: boolean; stdout: string; stderr: string }`
  and `ccd`'s body line `return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };`)
- Test: `server/test/exec.test.ts`, `server/test/remote-runner.test.ts`, `server/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: the agent frame from Task 106.
- Produces: `ExecResult.killed?: boolean` (OPTIONAL); `CcdResult.killed: boolean` (REQUIRED);
  `ccd()` threads it.

**Why the optionality differs, and it is not style.** 249 bare `{code, stdout, stderr}` literals
across 32 test files make a REQUIRED `ExecResult.killed` a suite-wide break; absence reads as `false`,
which is what an older agent sends and the safe direction. `CcdResult` is the opposite: **no test
anywhere builds a `CcdResult` literal**, and only two whole-object `toEqual`s in
`server/test/lifecycle.test.ts` observe it — so REQUIRED is free there and forces every producer to
answer.

- [ ] **Step 1: Write the failing test**

Append to `server/test/remote-runner.test.ts`:

```ts
describe('§1.4 — asExecResult stops narrowing a distinction it received', () => {
  const clientAnswering = (res: unknown) =>
    ({ request: async () => res }) as unknown as FleetClient;

  it('carries `killed` through the adapter', async () => {
    // THE L3 RULE ("an adapter may not narrow a distinction it received") failing
    // in exactly the place §1.5 depends on: `asExecResult` rebuilds the object
    // field by field, so anything the agent sends beyond code/stdout/stderr is
    // DISCARDED. The three hops are `ExecResult` (server/src/exec.ts), this
    // function, and `ccd()` (server/src/lifecycle.ts). There is no type called
    // `ExecRes` in either `src` tree.
    const r = await createRunner(clientAnswering(
      { code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' },
    ))('/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBe(true);
  });

  it('reads an older agent\'s omission as absent, never as true', async () => {
    const r = await createRunner(clientAnswering({ code: 1, stdout: '', stderr: 'boom' }))(
      '/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBeUndefined();
  });

  it('refuses a non-boolean `killed` rather than coercing it', async () => {
    const r = await createRunner(clientAnswering({ code: 1, stdout: '', stderr: '', killed: 'yes' }))(
      '/home/u/.local/bin/ccd', ['ws-add', 'demo']);
    expect(r.killed).toBeUndefined();
  });

  it('THE CATCH PATH NEVER CLAIMS A KILL — three facts sit on code 1, not two', () => {
    // ccd refused, we killed ccd, and WE DO NOT KNOW BECAUSE THE LINK FAILED.
    // `createRunner`'s catch returns `{code:1, stderr: e.message}` for any
    // transport failure — a dropped socket, a client-side wait expiry — and §1.5
    // must not adopt on it. Pinned as SOURCE because the arm is unreachable
    // through a client stub that resolves.
    const src = readFileSync(
      path.join(ccrcRoot, 'server/src/remote/runner.ts'), 'utf8');
    expect(src).toContain(
      "return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };");
    expect(src).not.toMatch(/catch[\s\S]{0,200}killed:\s*true/);
  });
});
```

(The last test needs `readFileSync`/`path` and a `ccrcRoot` resolved from `import.meta.url`; the file
already imports `FleetClient` and `createRunner`.)

Append to `server/test/exec.test.ts`:

```ts
describe('§1.4 — ExecResult.killed is OPTIONAL, and structurally false in local mode', () => {
  it('accepts a bare {code,stdout,stderr} literal — 249 of them exist across 32 files', () => {
    const r: ExecResult = { code: 0, stdout: '', stderr: '' };
    expect(r.killed).toBeUndefined();
  });

  it('realRunner can never report a kill — it passes NO timeout', async () => {
    // Which is why every §1.5 test MUST inject a runner: the adoption path is
    // structurally unreachable in `local` mode, and a test that exercised it
    // through `realRunner` would be asserting nothing.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/exec.ts'), 'utf8');
    const real = /export const realRunner[\s\S]*?\n  \}\);/.exec(src)?.[0] ?? '';
    expect(real).not.toContain('timeout');
    const r = await realRunner('/bin/sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
    expect(r.killed).toBeUndefined();
  });
});
```

Append to `server/test/lifecycle.test.ts`:

```ts
describe('§1.4 — CcdResult stops dropping the kill one hop later', () => {
  it('threads `killed` off the runner', async () => {
    const cfg = { ccdBin: '/home/u/.local/bin/ccd' } as unknown as CcrcConfig;
    const killedRun: Runner = async () => ({ code: 1, stdout: '', stderr: '', killed: true });
    expect(await ccd(killedRun, cfg, CCD_ARGV.wsAdd('demo'))).toEqual({
      ok: false, stdout: '', stderr: '', killed: true,
    });
  });

  it('reads an absent `killed` as false — REQUIRED here is safe because nothing builds this literal', async () => {
    const cfg = { ccdBin: '/home/u/.local/bin/ccd' } as unknown as CcrcConfig;
    const plainRun: Runner = async () => ({ code: 1, stdout: '', stderr: 'refused' });
    expect(await ccd(plainRun, cfg, CCD_ARGV.wsAdd('demo'))).toEqual({
      ok: false, stdout: '', stderr: 'refused', killed: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/remote-runner.test.ts test/exec.test.ts test/lifecycle.test.ts
```

Expected: `Object literal may only specify known properties, and 'killed' does not exist in type
'ExecResult'` at collect time; then `expected undefined to be true`.

- [ ] **Step 3: Write minimal implementation**

(a) `server/src/exec.ts`:

```ts
/** `killed` is OPTIONAL and that is not a style choice: 249 bare
 *  `{code, stdout, stderr}` literals across 32 test files make a required field
 *  a suite-wide break. Absence reads as `false` — what an older agent sends, and
 *  the safe direction (§1.5 never adopts on it). NOTE `realRunner` below passes
 *  NO `timeout`, so `killed` is structurally false in `local` mode and every
 *  §1.5 test must inject a runner. */
export interface ExecResult { code: number; stdout: string; stderr: string; killed?: boolean }
```

(b) `server/src/remote/runner.ts` — `asExecResult` gains one line in the shape of its siblings:

```ts
/** THE L3 RULE, applied here rather than described: this function rebuilds the
 *  object field by field, so anything it does not name is DISCARDED — which is
 *  exactly how the agent's `killed` was being narrowed away one hop before §1.5
 *  needed it. Spread-conditional, not `killed: Boolean(...)`: a non-boolean from
 *  a peer this build cannot trust must read as ABSENT, not as `false`. */
function asExecResult(res: unknown): ExecResult {
  const r = res as { code?: unknown; stdout?: unknown; stderr?: unknown };
  return {
    code: typeof r.code === 'number' ? r.code : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    ...(typeof (res as { killed?: unknown }).killed === 'boolean'
      ? { killed: (res as { killed: boolean }).killed }
      : {}),
  };
}
```

`createRunner`'s catch arm is UNCHANGED, and add above it:

```ts
    } catch (e) {
      // NO `killed` HERE, DELIBERATELY, and a test pins the absence. Three facts
      // sit on `code: 1`, not two: ccd refused, we killed ccd, and we do not know
      // because the LINK failed (a dropped socket, a client-side wait expiry).
      // Not-adopting is the safe outcome for all three, and adding `killed: false`
      // would be as wrong as `killed: true` — absence is the honest answer.
      return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
    }
```

In the same file, correct the false sentence inside `CCD_VERB_TIMEOUT_MS`'s comment. Replace
`with an EMPTY stderr (a killed child writes nothing)` with:

```
  // with an EMPTY stderr — not because a killed child writes nothing (execFile
  // delivers whatever was already buffered) but because NO STDERR-WRITING
  // STATEMENT WAS REACHED: ccd was still blocked inside the settle. Corrected
  // here rather than left standing; §1.4 now carries the distinction on the wire.
```

(c) `server/src/lifecycle.ts`:

```ts
/** `killed` is REQUIRED here, unlike `ExecResult.killed`: no test anywhere builds
 *  a `CcdResult` literal, and only two whole-object `toEqual`s in
 *  `lifecycle.test.ts` observe it — so requiring it costs nothing and forces
 *  every producer to answer. */
export interface CcdResult { ok: boolean; stdout: string; stderr: string; killed: boolean }
```

```ts
export async function ccd(run: Runner, cfg: CcrcConfig, args: CcdArgv): Promise<CcdResult> {
  const r = await run(cfg.ccdBin, [...args]);
  // `=== true`, not `Boolean(...)`: an ABSENT `killed` (an older agent, the
  // transport catch path, `local` mode) must read as false, and this is the one
  // hop that collapses the optional into the required.
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, killed: r.killed === true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/remote-runner.test.ts test/exec.test.ts test/lifecycle.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add server/src/exec.ts server/src/remote/runner.ts server/src/lifecycle.ts server/test && git commit -m "fix(server): the kill survives all three hops — ExecResult, asExecResult, CcdResult (§1.4)"
```

---

### Task 108: `start` and `enable` get budgets, and the sheet stops lying about the wait

**SCOPE NOTE, for the operator.** §1.1 asks only for the two `CCD_VERB_TIMEOUT_MS` rows. The PWA
half — the `Still starting` label and the close-reset — is an addition this plan makes because the
same change raises the worst-case wait from ninety seconds to five minutes behind a button with no
progress and no cancel. **It is DROPPABLE if Wave 1 needs to shrink**; the table rows are not.

**Files:**
- Modify: `server/src/remote/runner.ts` (`CCD_VERB_TIMEOUT_MS`, identified by its last two entries
  `'ws-add': 300_000,` / `  ensure: 300_000,`)
- Modify: `pwa/src/fleet/NewSessionSheet.tsx` (the confirm button's label, identified by
  `{starting` / `? 'Starting…'`; and the close-reset effect, identified by
  `if (open) return;` … `setStarting(false);`)
- Test: `server/test/remote-runner.test.ts`, `pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `CCD_VERB_TIMEOUT_MS` gains `start: 300_000` and `enable: 300_000`.

**`cmd_enable` gets NO code change** — it contains no `systemctl` call at all (an arity check, `_id`,
`cmd_start "$@"`, an echo), so an earlier instruction to move an `enable --now` inside it would have
minted a SECOND one racing `_supervised_start`'s, without the `reset-failed` that one is paired with.
Its only Wave 1 change is this table row.

- [ ] **Step 1: Write the failing test**

In `server/test/remote-runner.test.ts`, add two rows to the `it.each` table (after `['ensure', 'x']`):

```ts
    // The table is a SUBSET check, so a new row reds nothing on its own — which is
    // the discipline this table already states about `ws-rename` ("Without this
    // row, deleting or changing the entry cannot fail a single test"). These two
    // inherited the flat 90 s. They no longer end in a ~900 s `_spawn`
    // (`_supervised_start` bounds itself at SUPERVISED_START_WAIT), so this is a
    // correctness fix rather than a latent F8 — but a verb whose worst case
    // exceeds its budget should say so in the table.
    [['start', 'demo-quiet-basin'], 300_000],
    [['enable', 'demo-quiet-basin'], 300_000],
```

In `pwa/test/fleet-screen.test.tsx`, append:

```tsx
describe('NewSessionSheet — a five-minute wait says so', () => {
  it('after ~20s the button stops claiming a quick start', async () => {
    // §1.4's budgets raise `start`/`enable` from a flat 90 s to 300 s, so this
    // sheet can now sit for FIVE MINUTES where it used to fail at ninety seconds.
    // `api.createSession` is awaited behind a disabled button with no progress and
    // no cancel; the MINIMUM is that the label says what is happening.
    vi.useFakeTimers();
    try {
      const { start } = renderNewSessionSheetMidStart();   // never-resolving createSession
      await start();
      expect(screen.getByRole('button', { name: /Starting…/ })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(screen.getByRole('button', { name: /Still starting/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets the slow label when the sheet closes', () => {
    // Same rule the sheet already applies to `starting` itself: a closed sheet
    // forgets its choices, and a reopened one must not open mid-sentence.
    const { rerender } = renderNewSessionSheetMidStart();
    rerender(false);
    expect(screen.queryByText(/Still starting/)).toBeNull();
  });
});
```

`renderNewSessionSheetMidStart` is a NEW local helper this task adds, at the top of the new
describe. The two non-obvious parts are the never-resolving stub and `rerender`'s boolean
signature, so both are written out rather than described:

```tsx
/** The sheet, open, with `api.createSession` HANGING — the state the operator is
 *  in for up to five minutes after Task 108 raises the `start`/`enable` budgets.
 *  The promise never settles ON PURPOSE: a resolved stub would unmount the
 *  waiting state before the timer under test could reach it. */
const renderNewSessionSheetMidStart = (): {
  start: () => Promise<void>;
  rerender: (open: boolean) => void;
} => {
  vi.spyOn(api, 'createSession').mockImplementation(() => new Promise<never>(() => {}));
  const view = render(<NewSessionSheet open onClose={() => {}} roster={TEST_ROSTER} projects={['demo']} />);
  return {
    start: async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /demo/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
      });
    },
    // `open` is the ONE prop the close-reset effect keys on
    // (`if (open) return; … setStarting(false);`), so the helper takes exactly
    // that and nothing else.
    rerender: (open: boolean) =>
      view.rerender(<NewSessionSheet open={open} onClose={() => {}} roster={TEST_ROSTER} projects={['demo']} />),
  };
};
```

(If `NewSessionSheet`'s prop names differ from the four above, use the file's own — the two
load-bearing parts are the hanging mock and re-rendering with `open={false}` rather than
unmounting, since an unmount cannot prove the effect reset anything.)

**Cross-reference, so neither implementer stalls on finding the work already done:** the
`ws-add`-double-tap comment lives in THREE files. The canonical SOURCE sentence
(`pwa/src/screens/FleetScreen.tsx`, line beginning
`  // In-flight per PROJECT, because ccd does not dedupe: ws-add draws a fresh`) and
`pwa/src/fleet/ProjectCard.tsx`'s copy belong to **w1-ccd Task 10**, which lands the `flock` that
makes them false. `pwa/test/fleet-screen.test.tsx`'s own restatement is fixed **here**, in one line,
pointing at FleetScreen's corrected note. Do not rewrite the source comment in this task.

Also correct, in **`pwa/test/fleet-screen.test.tsx`** (this test file, not the source file), the test
comment that restates the `ws-add` double-tap as a known unfixed property. §1.3's per-project
`flock` closes it in w1-ccd Task 10, which owns the SOURCE sentences in
`pwa/src/screens/FleetScreen.tsx` and `pwa/src/fleet/ProjectCard.tsx`. One line here is enough:

```tsx
  // ccd now REFUSES a second concurrent ws-add per project
  // (`busy: another ws-add for <project> is in flight`), so this in-flight state
  // is a courtesy that saves a round trip — see FleetScreen's own note. It is no
  // longer the only thing standing between a double-tap and two worktrees.
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/remote-runner.test.ts
```

Expected: `sends ["start","demo-quiet-basin"] with a 300000 ms budget — expected 90000 to be 300000`.

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
```

Expected: `Unable to find an accessible element with the role "button" and name /Still starting/`.

- [ ] **Step 3: Write minimal implementation**

(a) `server/src/remote/runner.ts`, after `ensure: 300_000,`:

```ts
  // The two SUPERVISION verbs. Since PR #50 `cmd_start` goes through
  // `_supervised_start`, which runs `reset-failed` + `enable --now` and polls a
  // BOUNDED `SUPERVISED_START_WAIT` before returning — so neither of these ends in
  // an unbounded `_spawn` any more and this is a correctness fix, not a latent F8.
  // `cmd_enable` is an arity check plus `cmd_start`, so it inherits the same worst
  // case exactly. Both used to inherit the flat 90 s silently.
  start: 300_000,
  enable: 300_000,
```

(b) `pwa/src/fleet/NewSessionSheet.tsx` — add the state and the timer:

```tsx
  const [starting, setStarting] = useState(false);
  /** `starting` has been true for long enough that "Starting…" is no longer an
   *  honest description of the wait. The server's `start`/`enable` budget is
   *  300 s (a COLD Claude Code boot against a freshly seeded workspace HOME), so
   *  the old ninety-second failure is gone and the sheet can legitimately sit for
   *  five minutes. There is still no cancel — this is the minimum: say what is
   *  happening rather than imply it is nearly done. */
  const [slow, setSlow] = useState(false);
```

```tsx
  useEffect(() => {
    if (!starting) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, [starting]);
```

…add `setSlow(false);` to the existing close-reset effect beside `setStarting(false);`, and change
the label:

```tsx
            {starting
              ? (slow ? 'Still starting — a cold session can take minutes' : 'Starting…')
              : project === null
                ? 'Choose a project'
                : `Start ${project.name} on ${accountLabel(roster, wrapper)}`}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/remote-runner.test.ts
```

```
cd /srv/projects/ccrc-pwa/pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx && npm run build
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add server/src/remote/runner.ts server/test/remote-runner.test.ts pwa/src/fleet/NewSessionSheet.tsx pwa/test/fleet-screen.test.tsx && git commit -m "fix: start/enable get the spawning budget, and the sheet stops implying ninety seconds"
```

---

### Task 109: dispatch adopts what a KILLED `ws-add` left behind (§1.5)

**Files:**
- Modify: `server/src/coord/dispatch.ts` (`DispatchOutcome`'s ok arm, identified verbatim by
  `| { ok: true; id: number; sessionId: string; resumed: boolean; clearedAt: number | null;`;
  the fresh-spawn early return; and the BEFORE/AFTER asymmetry comment, identified by
  its sentence `This is the asymmetry to preserve on any future "simplification" of this`)

**THE EARLY-RETURN ANCHOR IS NOT UNIQUE — READ THIS BEFORE TEXT-MATCHING.** The line
`if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };` appears **TWICE** in
`server/src/coord/dispatch.ts`, byte-identical, each immediately after its own
`const res = await deps.runCcd(argv);`. Disambiguate by the surrounding branch, not by the line:

- **THE TARGET** is the FRESH-SPAWN arm — the one whose `argv` is `CCD_ARGV.wsAdd(run.project)` and
  which is followed by `const afterRead = await readRegistryMeasured(deps.io, deps.cfg);` and
  `const candidates = after.filter(...)`.
- **LEAVE THE SECOND ONE ALONE.** It is in the `} else {` wave-N≥2 resume arm, whose `argv` is
  `CCD_ARGV.ensure(sessionId)` and which is followed by `resumed = true;`. There is no registry
  diff there and nothing to adopt; letting a refused `ccd ensure` fall through into the adoption
  gate would bind a run to whatever row happened to look new.
- Test: `server/test/dispatch-adopt.test.ts` (create)

**Interfaces:**
- Consumes: `CcdResult.killed` (Task 107); `SpawnVerdict`, `spawnVerdict` (Task 101).
- Produces: `DispatchOutcome`'s ok arm gains `adopted: boolean` and `spawnState: SpawnVerdict | null`.
  Every `ok:false` arm is byte-identical to today. The `run_events` row carries
  `detail: 'spawn-adopted:<verdict>'`.

**NAME COLLISION WARNING:** `server/test/adopt.test.ts` already exists and tests `ccd/ccrc-adopt`, the
ROSTER BOOTSTRAPPER. Do not schedule work against it.

**No two-dispatch race exists** — `routes.ts` runs `dispatchRun` inside `coordMutex.run(...)`, which
serialises open/dispatch/close/advance/settle server-wide. Do not over-build.

- [ ] **Step 1: Write the failing test**

Create `server/test/dispatch-adopt.test.ts`:

```ts
// §1.5. `dispatch.ts` used to return `fleetFailed` the instant `res.ok` was false
// — BEFORE the registry diff that would have discovered the workspace the killed
// `ws-add` had already created, before `coord.setSession`, before the hold. That
// single early return is what turned a slow spawn into an unclaimed workspace and
// a run stuck in `planned` with no `run_events` row at all.
//
// EVERY ARM OF THE GATE IS PINNED HERE OR THE GATE IS NOT PINNED. Adoption
// requires POSITIVE EVIDENCE that the candidate is the one THIS call created, and
// the two gates are what supply it: `killed` separates "we SIGTERM'd a spawn in
// flight" from "ccd refused" (a `die` is exit 1, byte-identical without it), and
// `held` is fail-shut by construction (`registry.ts`: a listed-but-unreadable
// `.hold` reads as HELD) — a workspace a killed `ws-add` just created never
// carries one, while a live coordinated worker always does.
//
// THE RUNNER MUST BE INJECTED. `realRunner` passes no `timeout`, so `killed` is
// structurally false in `local` mode and this whole path is unreachable there.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { CcdArgv } from '../src/coord/argv.js';
import { localIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';

/** One registry row on disk. Lifted verbatim from `coord-abandon.test.ts`'s
 *  `seed`, plus the two fields this suite varies: `.hold` (present = held) and
 *  `.spawn` (`<epoch-seconds> <rc>`, ccd's own encoding — the FACT the verdict
 *  is derived from, never a word). */
const seedRow = (
  home: string, id: string, opts: { held?: string | null; spawnRc?: number | null } = {},
): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  if (opts.held != null) writeFileSync(path.join(reg, `${id}.hold`), opts.held);
  if (opts.spawnRc != null) {
    writeFileSync(path.join(reg, `${id}.spawn`), `${Math.floor(Date.now() / 1000)} ${opts.spawnRc}`);
  }
};

interface HarnessCfg {
  /** What the `ws-add` call answers. `killed` is the WHOLE POINT — `realRunner`
   *  passes no `timeout`, so it is structurally false in `local` mode and this
   *  path is unreachable without an injected runner. */
  ccd: Pick<CcdResult, 'ok' | 'stderr'> & { killed: boolean };
  /** Rows that appear in the registry AFTER the `ws-add` call — i.e. what the
   *  killed spawn left behind. Seeded lazily by the `runCcd` double, so the
   *  BEFORE read genuinely does not see them. */
  after?: readonly { id: string; held?: string | null; spawnRc?: number | null }[];
  /** Rows that exist BEFORE the dispatch (a pre-existing worker for the same
   *  project). Seeded eagerly. */
  before?: readonly { id: string; held?: string | null }[];
  /** `false` makes the AFTER read report the registry directory unlistable, so
   *  `readRegistryMeasured` answers `listed: false`. This is the ONE knob that
   *  needs an `io` override rather than a file on disk. */
  afterListed?: boolean;
}

const harness = async (cfg: HarnessCfg) => {
  const home = mkTmp('ccrc-dispatch-adopt-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const r of cfg.before ?? []) seedRow(home, r.id, { held: r.held ?? null });

  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({
    program: 'build4', title: 'Fleet controls', project: PROJECT,
    wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);

  const calls: string[][] = [];
  const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
    calls.push([...argv]);
    if (argv[0] === 'ws-add') {
      sawWsAdd = true;
      // The workspace appears NOW, after BEFORE was read — which is exactly
      // what a killed `ws-add` leaves: the pane and the row exist, the caller
      // never saw a success.
      for (const r of cfg.after ?? []) {
        seedRow(home, r.id, { held: r.held ?? null, spawnRc: r.spawnRc ?? null });
      }
      return { ok: cfg.ccd.ok, stdout: '', stderr: cfg.ccd.stderr, killed: cfg.ccd.killed };
    }
    return { ok: true, stdout: '', stderr: '', killed: false };
  };

  const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
  // `listed: false` on the AFTER read only — BEFORE must succeed, or the test
  // proves nothing about the asymmetry. `sawWsAdd` flips when the double runs.
  let sawWsAdd = false;
  const io = cfg.afterListed === false
    ? { ...localIO, readdir: async (p: string) => (sawWsAdd ? null : localIO.readdir(p)) }
    : localIO;
  const deps: DispatchRunDeps = { ...base, io, coord, runCcd } as DispatchRunDeps;

  return {
    coord,
    homeDir: home,
    runId: opened.id,
    ccdCalls: () => calls,
    dispatch: () => dispatchRun(deps, opened.id, { text: 'go' }, undefined),
    cleanup: () => { rmSync(home, { recursive: true, force: true }); },
  };
};

describe('§1.5 — adoption, and everything that must NOT adopt', () => {
  it('ADOPTS a killed ws-add that created exactly ONE UNHELD workspace', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true, adopted: true, sessionId: 'demo-quiet-basin' });
    // The run is BOUND, the hold is PLACED, and the event says where this
    // workspace came from — its presence IS the record that it was adopted.
    expect(h.coord.run(h.runId)?.sessionId).toBe('demo-quiet-basin');
    expect(h.ccdCalls()).toContainEqual(
      expect.arrayContaining(['ws-hold', '--session', 'demo-quiet-basin']));
    expect(h.coord.runEvents(h.runId).map((e) => e.detail)).toContain('spawn-adopted:expired');
  });

  it('returns the spawn verdict so the coordinator knows the pane may not be ready', async () => {
    // `ok` is no longer proof the pane is ready, and that is the whole reason the
    // field exists rather than being inferred at the far end.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 5 }] });
    expect(await h.dispatch()).toMatchObject({ adopted: true, spawnState: 'blocked' });
  });

  it('a CLEAN non-zero exit NEVER adopts, whatever the candidate count', async () => {
    // ccd REFUSED. There is nothing here this call created.
    const h = await harness({ ccd: { ok: false, killed: false, stderr: 'disk floor' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'disk floor' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('a killed:false from the TRANSPORT catch path never adopts', async () => {
    // `createRunner`'s catch returns `{code:1, stderr: e.message}` with NO
    // `killed` for a dropped socket or a client-side wait expiry. Three facts sit
    // on code 1, not two, and not-adopting is the safe outcome for all three.
    const h = await harness({ ccd: { ok: false, killed: false, stderr: 'socket closed' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'socket closed' });
  });

  it('ZERO candidates still fails — a kill proves nothing was left behind', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' }, after: [] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: '' });
  });

  it('TWO candidates is still ambiguous-dispatch — nothing claimed on a guess', async () => {
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null },
                                      { id: 'demo-still-cove', held: null }] });
    expect(await h.dispatch()).toEqual(
      { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: 2 });
  });

  it('ONE candidate that ALREADY CARRIES A HOLD refuses — that is a live worker', async () => {
    // Fail-shut by construction: a listed-but-unreadable `.hold` reads as HELD, so
    // "we could not read the hold" lands here too.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: 'program:x wave:1/3' }] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'fleetFailed', stderr: '' });
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('the CLEAN success path is untouched and reports adopted: false', async () => {
    const h = await harness({ ccd: { ok: true, killed: false, stderr: '' },
                              after: [{ id: 'demo-quiet-basin', held: null }] });
    expect(await h.dispatch()).toMatchObject({ ok: true, adopted: false });
  });

  it('a degraded AFTER read still refuses registry-unmeasurable on the adoption path', async () => {
    // The AFTER diff answers "is this NEW", and that question must never guess —
    // on the adoption path least of all, because a false-new makes the count 1 and
    // WOULD BE ADOPTED.
    const h = await harness({ ccd: { ok: false, killed: true, stderr: '' }, afterListed: false });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
  });
});

describe('§1.2 — the OTHER polarity: a ws-add that FAILED CLEANLY inside its budget', () => {
  // THE CASE THE SPEC ORDERS VERIFIED END TO END, and it is not the adoption
  // case. Task 6 gives the settle rc 3/4/5, Task 7 keeps #50's non-zero
  // `ws-add` exit on all three — so a settle that expires INSIDE the agent's
  // 300 s ceiling produces `res.ok === false` with `killed === false`, and the
  // gate above refuses. That refusal is CORRECT and stays: a clean non-zero is
  // ccd telling us something, and adopting on it would bind a run to a
  // workspace no evidence ties to this call.
  //
  // THE RULING, so nobody "fixes" this later: DO NOT widen the gate to read
  // `$REG/<id>.spawn` as positive evidence. The spawn fact is written by the
  // settle for ANY spawn on that id, including one from a previous attempt or
  // another process — it says how a spawn ended, never which caller owns it.
  // `killed` is the only fact that means "this call's child was cut short".
  //
  // What the refusal must NOT be is INVISIBLE, and these tests pin that it is
  // not: the workspace ccd created is claimed, supervised, and carries a spawn
  // fact — so it renders on the fleet screen as an ordinary session with the
  // §1.6b spawn chip lit, and the run's own event trail names it.

  it('refuses, and the workspace it leaves behind is an ORDINARY session, not residue', async () => {
    const h = await harness({ ccd: { ok: false, killed: false, stderr: 'ccd: start failed for demo-quiet-basin (spawn rc 4)' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: false, kind: 'fleetFailed' });
    // The run stays PLANNED and is bound to nothing — the operator resolves it.
    expect(h.coord.run(h.runId)?.state).toBe('planned');
    expect(h.coord.run(h.runId)?.sessionId).toBeNull();
    // And NO hold was placed on a workspace this run does not own.
    expect(h.ccdCalls().some((a) => a[0] === 'ws-hold')).toBe(false);
  });

  it('records the leftover on the run so it is nameable — this is what stops it being invisible', async () => {
    // Without this row, the operator sees a run stuck in `planned` and a
    // workspace on the fleet screen with no stated relationship between them.
    // The event does not CLAIM the workspace (that would be adoption by
    // another name) — it records what ccd reported and which ids appeared.
    const h = await harness({ ccd: { ok: false, killed: false, stderr: 'spawn rc 4' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    await h.dispatch();
    const details = h.coord.runEvents(h.runId).map((e) => e.detail);
    expect(details.some((d) => d?.startsWith('dispatch-refused:'))).toBe(true);
    expect(details.join(' ')).toContain('demo-quiet-basin');
  });

  it('and the leftover is VISIBLE: started, unheld, with a spawn fact the chip reads', async () => {
    // `assembleFleet` (Task 103) puts `started` and `spawnState` on the wire and
    // SessionLine (Task 104) renders `unconfirmed` for rc 4 — so this row is a
    // normal session carrying a quiet warning, not a shape no verb can name.
    // Asserted here on the REGISTRY, because that is what this suite can see;
    // the wire half is pinned in fleet-lifecycle.test.ts and session-line.test.tsx.
    const h = await harness({ ccd: { ok: false, killed: false, stderr: 'spawn rc 4' },
                              after: [{ id: 'demo-quiet-basin', held: null, spawnRc: 4 }] });
    await h.dispatch();
    const rows = await readRegistry(localIO, { ccrcHome: h.homeDir } as never);
    const row = rows.find((r) => r.id === 'demo-quiet-basin');
    expect(row?.started).toBe(true);
    expect(row?.held).toBeNull();
    expect(row?.spawn?.rc).toBe(4);
  });
});
```

(The last case needs `readRegistry` from `../src/registry.js` and the harness to expose its home —
add `homeDir: home` to the object `harness` returns.)

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/dispatch-adopt.test.ts
```

Expected: `expected { ok: false, kind: 'fleetFailed', stderr: '' } to match object { ok: true,
adopted: true, … }` on the first test — the early return fires before the diff.

- [ ] **Step 3: Write minimal implementation**

(a) `DispatchOutcome`'s ok arm:

```ts
export type DispatchOutcome =
  | { ok: true; id: number; sessionId: string; resumed: boolean; clearedAt: number | null;
      briefQueued: boolean; clearError: string | null;
      /** Adopted from a KILLED `ws-add`, not created by a clean one — so `ok` is
       *  NO LONGER PROOF THE PANE IS READY. */
      adopted: boolean;
      /** How that spawn ended, when it recorded anything. `null` = not recorded. */
      spawnState: SpawnVerdict | null }
```

(b) The fresh-spawn branch. Hoist `adopted`/`adoptedSpawn` beside the existing
`let sessionId: string; …` declarations, then replace the early return
`if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };` with nothing (delete it)
and, after the existing `const candidates = …` / `if (candidates.length !== 1)` /
`const winner = candidates[0]!;` lines, insert the gate:

```ts
    // §1.5. `!res.ok` NO LONGER SHORT-CIRCUITS BEFORE THE DIFF — that early return
    // is what turned a slow spawn into an unclaimed workspace: `cmd_ws_add` writes
    // the worktree and every registry row FIRST and blocked LAST, so a kill at the
    // budget landed after the workspace existed and before anything claimed it.
    //
    // ADOPTION NEEDS POSITIVE EVIDENCE THAT THIS CANDIDATE IS THE ONE THIS CALL
    // CREATED, and two gates supply it. `killed` (§1.4) separates "we SIGTERM'd a
    // spawn in flight" from "ccd refused" — a ccd `die` is exit 1, byte-identical
    // without it, and the transport catch path carries no `killed` at all, so a
    // dropped socket lands here too and does not adopt. `held` is fail-shut by
    // construction (`registry.ts`: a listed-but-unreadable `.hold` reads as HELD):
    // a workspace a killed `ws-add` just created never carries one, while a live
    // coordinated worker always does.
    if (!res.ok) {
      if (!(res.killed === true && winner.held === null)) {
        // §1.2's OTHER polarity, and the reason the refusal is no longer silent.
        // Task 6/7 make a settle that expires INSIDE the agent's 300 s ceiling a
        // clean non-zero exit — so ccd created, claimed and supervised a
        // workspace, and we correctly decline to bind it (nothing ties it to
        // THIS call; the `.spawn` fact says how A spawn ended, never whose).
        // But a run stuck in `planned` beside an unexplained new workspace is a
        // state no verb names, which is the class this build is judged on. Say
        // what happened and which ids appeared, WITHOUT claiming any of them.
        coord.recordRunEvent(id, 'dispatch-refused',
          `dispatch-refused:fleetFailed candidates=${candidates.map((c) => c.id).join(',')}`);
        return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
      }
      adopted = true;
      adoptedSpawn = spawnVerdict(winner.spawn === null ? null : winner.spawn.rc);
    }
```

(If `CoordStore` has no `recordRunEvent` under that exact name, use whatever the store already
exposes for writing a `run_events` row outside a state transition — `advanceInner` is NOT it, and a
refusal is not a transition. If no such writer exists, add one in this task: a bare
`INSERT INTO run_events` beside the existing writers, synchronous like the rest of `CoordStore`.)

The `candidates.length !== 1` arm returns **before** `winner` exists, so it needs its own handling —
and **`fleetFailed` is the honest answer when ccd itself reported failure and left NOTHING**;
`ambiguous-dispatch` means "the ws-add worked and we cannot read the diff", which is a different
sentence. The shipped line

```ts
    if (candidates.length !== 1) {
      return { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: candidates.length };
    }
```

becomes

```ts
    if (candidates.length !== 1) {
      if (!res.ok) {
        coord.recordRunEvent(id, 'dispatch-refused',
          `dispatch-refused:${candidates.length === 0 ? 'fleetFailed' : 'ambiguous-dispatch'}`
          + ` candidates=${candidates.map((c) => c.id).join(',')}`);
        // ccd failed AND left nothing new: there is no ambiguity to report, only
        // a failure. Zero candidates after a failed `ws-add` is the ordinary
        // shape of "it refused before it created anything".
        if (candidates.length === 0) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
      }
      return { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: candidates.length };
    }
```

…and thread the two values into the final return and the `run_events` detail:

```ts
  const adv = coord.dispatchRun({ runId: id, sessionId, workspace, branch, resumed, clearedAt,
    items: itemTitles,
    // The SUFFIX is a `SpawnVerdict`, never a raw rc — and never the word
    // `spawnstate`, which is not a field and must never become one. Recorded only
    // on the adoption path, so its PRESENCE is the record that this workspace came
    // from a killed `ws-add` rather than a clean one.
    detail: adopted ? `spawn-adopted:${adoptedSpawn ?? 'unrecognised'}`
      : clearError !== null ? `clear-refused:${clearError}` : undefined });
```

```ts
  return { ok: true, id, sessionId, resumed, clearedAt, briefQueued, clearError,
    adopted, spawnState: adoptedSpawn };
```

(c) **Extend the asymmetry comment in the same edit** — this is not optional, the change alters that
comment's precondition. Append to the block that currently ends *"BEFORE answers 'does this still
exist' (tolerant); AFTER answers 'is this new' (never tolerant)"*:

```ts
    // AND §1.5 CHANGED WHAT MAKES BEFORE'S TOLERANCE SAFE. It was safe because the
    // SUCCESS path always contributes exactly one genuinely-new row, so a
    // false-new made the count 2 and `candidates.length !== 1` refused. ON THE
    // ADOPTION PATH THAT GUARANTEE IS GONE: a false-new makes the count 1, AND
    // WOULD BE ADOPTED. Two triggers were measured — a whole-fleet listing failure
    // (`readRegistry` collapses an unlistable directory to `[]`, emptying
    // `beforeIds`) and an operator `ws-add` from the PWA racing a refused dispatch
    // (`server.ts`'s own route, outside `coordMutex`, with no diff of its own).
    // `killed` + `held` are what REPLACE the lost precondition: the first says a
    // spawn really was interrupted here and now, the second is fail-shut and says
    // nothing else has claimed the row.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/dispatch-adopt.test.ts test/coord-dispatch.test.ts test/run-routes.test.ts test/dispatch-mutex-gate.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add server/src/coord/dispatch.ts server/test/dispatch-adopt.test.ts && git commit -m "feat(coord): dispatch adopts what a killed ws-add left behind, on two gates and nothing else (§1.5)"
```

---

### Task 110: the census — three kinds, one pure classifier

**Files:**
- Create: `server/src/divergence.ts`
- Modify: `shared/api.ts` (`DivergenceKind`/`DIVERGENCE_KIND_MAP`/`DIVERGENCE_KINDS`/
  `isDivergenceKind`/`Divergence`, placed after the `SpawnVerdict` block from Task 101)
- Test: `server/test/divergence.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `export type DivergenceKind = 'unregistered-worktree' | 'branch-drift' | 'claim-divergence'`;
  `export const DIVERGENCE_KINDS: readonly DivergenceKind[]`;
  `export function isDivergenceKind(v: unknown): v is DivergenceKind`;
  `export interface Divergence { readonly kind; readonly id: string | null; readonly path: string | null; readonly detail: string }`;
  `export interface DivergenceInput` and `export function divergences(input: DivergenceInput): Divergence[]`
  in `server/src/divergence.ts`.

**Four proposed kinds die here, and the plan says why so nobody re-adds them.** `dead-row` IS
`lifecycle === 'orphan'` and is strictly BROADER (the shipped ladder splits that population three
ways — a stop stamp makes it `stopped`, a fresh heartbeat `restarting`). `unclaimed-session` was
PROMOTED to a `SessionLifecycle` member in Task 102.

`unsupervised` and `not-boot-persistent` die on **COST, not capability**, and it matters that the
plan says so accurately: w1-ccd Task 12 gives `ccd ws-audit --session <id>` a `unit` field read from
`systemctl --user list-units`, and `['ws-audit','--session']` is **already whitelisted** — so the
server both can and now does see systemd unit state. What it cannot do is see it **per row, per
tick**: the census is a whole-fleet sweep and these two kinds would cost one `ws-audit` exec per
session per sweep, against ~11 live sessions on a 60 s lane. `ws-audit` is an on-demand
single-row read the operator asks for; a sweep is not. The shipped `unsupervised` token is
separately a HEARTBEAT verdict, chosen deliberately over unit introspection, and reusing the word
for a unit fact would be a second name for a different thing.

`EXEC_COMMANDS` stays `['tmux','ccd']` regardless — no wave adds an entry.

**`unregistered-worktree` keeps its name even though ccd's `_ws_gc_row` calls the same thing
`orphan`.** That overload already exists, in its worst form — `orphan` means *a registry row with no
pane* in one half of the repo and *a worktree with no registry row* in the other. Naming this kind
explicitly defuses it.

- [ ] **Step 1: Write the failing test**

Create `server/test/divergence.test.ts`:

```ts
// §1.6's census. THE ENFORCEMENT CLAUSE IS ONLY REAL IF THE CLASSES ARE
// INDIVIDUALLY PINNED: one test per kind, each red when its kind is deleted.
import { describe, it, expect } from 'vitest';
import { DIVERGENCE_KINDS, SESSION_LIFECYCLES, isDivergenceKind } from '../../shared/api.js';
import { divergences, type DivergenceInput } from '../src/divergence.js';

const rec = (over: Partial<DivergenceInput['records'][number]> = {}) => ({
  id: 'demo-quiet-basin', project: 'demo', workspace: 'quiet-basin',
  workdir: '/home/u/worktrees/demo/quiet-basin', branch: 'ws/quiet-basin',
  held: null as string | null, archivedAt: null as number | null, ...over,
});

const input = (over: Partial<DivergenceInput> = {}): DivergenceInput => ({
  records: [rec()],
  worktrees: [{ project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' }],
  headBranch: new Map([['demo/quiet-basin', 'ws/quiet-basin']]),
  openRunSessionIds: new Set<string>(),
  ...over,
});

describe('divergences — the three kinds, individually', () => {
  it('A HEALTHY FLEET PRODUCES AN EMPTY CENSUS', () => {
    // The direction that decides whether the surface is ignorable. A census that
    // is never empty is a census nobody reads.
    expect(divergences(input())).toEqual([]);
  });

  it('unregistered-worktree: git records a worktree no registry row claims', () => {
    const out = divergences(input({
      worktrees: [
        { project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' },
        { project: 'demo', name: 'alertwire', path: '/home/u/worktrees/alertwire' },
      ],
    }));
    expect(out).toEqual([{ kind: 'unregistered-worktree', id: null,
      path: '/home/u/worktrees/alertwire', detail: expect.any(String) }]);
  });

  it('finds a FLAT worktree, not only a nested one', () => {
    // Measured live: `custom-tools-alertwire` sits directly under `~/worktrees/`.
    // A detector globbing `~/worktrees/*/*/` misses it — which is why this reads
    // git's OWN admin records rather than the directory layout.
    const out = divergences(input({
      records: [],
      worktrees: [{ project: 'custom-tools', name: 'alertwire',
                    path: '/home/u/worktrees/custom-tools-alertwire' }],
    }));
    expect(out.map((d) => d.kind)).toEqual(['unregistered-worktree']);
  });

  it('branch-drift: the registry and the worktree HEAD name different branches', () => {
    const out = divergences(input({ headBranch: new Map([['demo/quiet-basin', 'feat/renamed']]) }));
    expect(out).toEqual([{ kind: 'branch-drift', id: 'demo-quiet-basin',
      path: '/home/u/worktrees/demo/quiet-basin', detail: expect.stringContaining('feat/renamed') }]);
  });

  it('a HEAD that could not be read yields NO drift — not knowing is not a disagreement', () => {
    expect(divergences(input({ headBranch: new Map([['demo/quiet-basin', null]]) }))).toEqual([]);
    expect(divergences(input({ headBranch: new Map() }))).toEqual([]);
  });

  it('a registry row with no branch of its own yields no drift either', () => {
    expect(divergences(input({ records: [rec({ branch: null })] }))).toEqual([]);
  });

  it('an ARCHIVED row never drifts — its worktree is gone by construction', () => {
    expect(divergences(input({
      records: [rec({ archivedAt: 1_785_300_000 })],
      headBranch: new Map([['demo/quiet-basin', 'feat/renamed']]),
    }))).toEqual([]);
  });

  it('claim-divergence: a hold with no open run', () => {
    const out = divergences(input({ records: [rec({ held: 'program:build8 wave:2/4' })] }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-quiet-basin', path: null,
      detail: expect.any(String) }]);
  });

  it('claim-divergence: an open run whose session has no hold', () => {
    const out = divergences(input({ openRunSessionIds: new Set(['demo-quiet-basin']) }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-quiet-basin', path: null,
      detail: expect.any(String) }]);
  });

  it('a hold WITH its open run is not a divergence', () => {
    expect(divergences(input({
      records: [rec({ held: 'program:build8 wave:2/4' })],
      openRunSessionIds: new Set(['demo-quiet-basin']),
    }))).toEqual([]);
  });

  it('an open run naming a session with no registry row at all is a claim-divergence', () => {
    const out = divergences(input({ records: [], worktrees: [],
      openRunSessionIds: new Set(['demo-gone']) }));
    expect(out).toEqual([{ kind: 'claim-divergence', id: 'demo-gone', path: null,
      detail: expect.any(String) }]);
  });

  it('a fixture with one row in EACH class produces exactly that census and no more', () => {
    const out = divergences({
      records: [
        rec(),
        rec({ id: 'demo-still-cove', workspace: 'still-cove',
              workdir: '/home/u/worktrees/demo/still-cove', branch: 'ws/still-cove' }),
        rec({ id: 'demo-warm-ridge', workspace: 'warm-ridge',
              workdir: '/home/u/worktrees/demo/warm-ridge', branch: 'ws/warm-ridge',
              held: 'program:x wave:1/2' }),
      ],
      worktrees: [
        { project: 'demo', name: 'quiet-basin', path: '/home/u/worktrees/demo/quiet-basin' },
        { project: 'demo', name: 'still-cove', path: '/home/u/worktrees/demo/still-cove' },
        { project: 'demo', name: 'warm-ridge', path: '/home/u/worktrees/demo/warm-ridge' },
        { project: 'demo', name: 'nobody', path: '/home/u/worktrees/demo/nobody' },
      ],
      headBranch: new Map([
        ['demo/quiet-basin', 'ws/quiet-basin'],
        ['demo/still-cove', 'feat/renamed'],
        ['demo/warm-ridge', 'ws/warm-ridge'],
      ]),
      openRunSessionIds: new Set<string>(),
    });
    expect(out.map((d) => d.kind).sort()).toEqual(
      ['branch-drift', 'claim-divergence', 'unregistered-worktree']);
  });
});

describe('the vocabulary', () => {
  it('is exactly three kinds — dead-row/unsupervised/not-boot-persistent are DELETED', () => {
    expect([...DIVERGENCE_KINDS].sort()).toEqual(
      ['branch-drift', 'claim-divergence', 'unregistered-worktree']);
    // `dead-row` IS `lifecycle === 'orphan'` and strictly broader; the other two
    // would cost one `ws-audit` exec per session per sweep (see the type's own
    // docstring — the objection is COST, not capability: ws-audit is already
    // whitelisted and now reports `unit`).
    for (const dead of ['dead-row', 'unsupervised', 'not-boot-persistent', 'unclaimed-session']) {
      expect(isDivergenceKind(dead)).toBe(false);
    }
  });

  it('shares NO token with SessionLifecycle — a second name for one fact is the defect', () => {
    for (const k of DIVERGENCE_KINDS) {
      expect((SESSION_LIFECYCLES as readonly string[]).includes(k)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/divergence.test.ts
```

Expected: `Failed to resolve import "../src/divergence.js"`.

- [ ] **Step 3: Write minimal implementation**

(a) `shared/api.ts`, after the `SpawnVerdict` block:

```ts
/**
 * A disagreement BETWEEN SOURCES — which is precisely what a per-row ladder
 * structurally cannot express, and the only reason this vocabulary exists beside
 * `SessionLifecycle` rather than inside it.
 *
 * THREE KINDS, and the four that were proposed and rejected are named here so
 * nobody re-adds them: `dead-row` IS `lifecycle === 'orphan'` and strictly
 * broader (the shipped ladder splits that population three ways);
 * `unclaimed-session` was promoted to a `SessionLifecycle` member.
 *
 * `unsupervised` and `not-boot-persistent` die on COST, and the distinction is
 * worth stating precisely: `ccd ws-audit --session <id>` DOES report a `unit`
 * state (read from `systemctl --user list-units`) and IS already whitelisted, so
 * the server can see systemd for one row on demand. What it will not do is pay
 * one exec per session per sweep on a whole-fleet lane. Separately, the shipped
 * `unsupervised` token is a HEARTBEAT verdict, chosen deliberately over unit
 * introspection — reusing the word for a unit fact would be a second name for a
 * different thing. `EXEC_COMMANDS` stays the closed set `['tmux','ccd']`.
 *
 * `unregistered-worktree` KEEPS ITS NAME even though ccd's `_ws_gc_row` calls the
 * same thing `orphan`. That overload already exists and in the worst possible
 * form — `orphan` means "a registry row with no pane" in one half of this repo
 * and "a worktree with no registry row", the exact opposite, in the other.
 * Naming this kind explicitly defuses it.
 */
export type DivergenceKind =
  | 'unregistered-worktree'   // git records a worktree no registry row claims
  | 'branch-drift'            // registry `.branch` != the worktree's own HEAD
  | 'claim-divergence';       // a hold with no open run, or an open run with no hold
const DIVERGENCE_KIND_MAP: Record<DivergenceKind, true> = {
  'unregistered-worktree': true, 'branch-drift': true, 'claim-divergence': true,
};
export const DIVERGENCE_KINDS: readonly DivergenceKind[] =
  Object.keys(DIVERGENCE_KIND_MAP) as DivergenceKind[];

export function isDivergenceKind(v: unknown): v is DivergenceKind {
  return typeof v === 'string' && (DIVERGENCE_KINDS as readonly string[]).includes(v);
}

export interface Divergence {
  readonly kind: DivergenceKind;
  /** Registry id when the kind is about a row; null for `unregistered-worktree`. */
  readonly id: string | null;
  /** Absolute worktree path when the kind is about a directory; null otherwise. */
  readonly path: string | null;
  /** One actionable line. DISPLAY-ONLY — nothing parses it back. */
  readonly detail: string;
}
```

(b) Create `server/src/divergence.ts`:

```ts
import type { Divergence } from '../../shared/api.js';

/**
 * L1: pure, clock-free, `fs`-free, fastify-free — it imports TYPES from
 * `shared/api.js` and nothing else. Gathering is L4's job
 * (`FleetWatcher.sweepDivergences`), THE CENSUS'S SINGLE PRODUCER.
 *
 * Deliberately NOT under `server/src/coord/`: it holds no DB handle and has no
 * business near the coord-ring scanner in `single-definition.test.ts`.
 */
export interface DivergenceInput {
  readonly records: readonly {
    readonly id: string;
    readonly project: string;
    readonly workspace: string | null;
    readonly workdir: string;
    readonly branch: string | null;
    readonly held: string | null;
    readonly archivedAt: number | null;
  }[];
  /**
   * Every linked worktree GIT ITSELF records, per project, read out of
   * `<projectsRoot>/<project>/.git/worktrees/`.
   *
   * KEYED BY GIT'S OWN ADMIN NAME, NEVER BY ABSOLUTE PATH, and that is not a
   * style choice: `~/worktrees` is a symlink to `/data/worktrees` on the fleet
   * box, ccd writes the registry's `workdir` UNRESOLVED (`$WORKTREES_ROOT/...`)
   * while git's own record resolves it, and `FleetIO.realpath` answers null
   * unconditionally in remote mode. Comparing absolute paths would report every
   * worktree on the fleet as unregistered.
   */
  readonly worktrees: readonly {
    readonly project: string;
    readonly name: string;
    readonly path: string;
  }[];
  /** `<project>/<name>` -> the branch that worktree's own HEAD names, or null
   *  where HEAD could not be read or is detached. A null NEVER yields
   *  `branch-drift`: not knowing is not a disagreement. */
  readonly headBranch: ReadonlyMap<string, string | null>;
  readonly openRunSessionIds: ReadonlySet<string>;
}

const key = (project: string, name: string): string => `${project}/${name}`;

export function divergences(input: DivergenceInput): Divergence[] {
  const out: Divergence[] = [];

  // 1 — a worktree git records that no registry row claims. ccd's `ws-gc` owns
  // the repair and it is HUMAN-ONLY; this only names it.
  const claimed = new Set(
    input.records
      .filter((r) => r.workspace !== null)
      .map((r) => key(r.project, r.workspace as string)),
  );
  for (const w of input.worktrees) {
    if (claimed.has(key(w.project, w.name))) continue;
    out.push({
      kind: 'unregistered-worktree', id: null, path: w.path,
      detail: `git records a worktree at ${w.path} that no registry row claims`,
    });
  }

  // 2 — the registry's `.branch` and the worktree's own HEAD disagree. Reconcile
  // before a done-fingerprint trusts either. An ARCHIVED row is skipped: its
  // worktree is gone by construction, so there is nothing left to disagree with.
  for (const r of input.records) {
    if (r.archivedAt !== null || r.workspace === null || r.branch === null) continue;
    const head = input.headBranch.get(key(r.project, r.workspace)) ?? null;
    if (head === null || head === r.branch) continue;
    out.push({
      kind: 'branch-drift', id: r.id, path: r.workdir,
      detail: `the registry says ${r.branch}, the worktree's own HEAD says ${head}`,
    });
  }

  // 3 — a claim and a run that do not agree about each other, in BOTH directions.
  // Wave 2 supplies the second half's input (`openRunsForSession`); here it is
  // just a set, so this stays pure.
  const live = input.records.filter((r) => r.archivedAt === null);
  for (const r of live) {
    if (r.held !== null && !input.openRunSessionIds.has(r.id)) {
      out.push({
        kind: 'claim-divergence', id: r.id, path: null,
        detail: `held (${r.held}) with no open run naming this session`,
      });
    }
  }
  const heldIds = new Set(live.filter((r) => r.held !== null).map((r) => r.id));
  for (const id of input.openRunSessionIds) {
    if (heldIds.has(id)) continue;
    out.push({
      kind: 'claim-divergence', id, path: null,
      detail: 'an open run names this session, which carries no hold',
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/divergence.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add shared/api.ts server/src/divergence.ts server/test/divergence.test.ts && git commit -m "feat: the census names the three disagreements a per-row ladder cannot (§1.6)"
```

---

### Task 111: `FleetWatcher.sweepDivergences` — the census's SINGLE producer

**Files:**
- Modify: `server/src/coord/gitref.ts` (append beside `readBranchTip`, identified by its declaration
  `export async function readBranchTip(`)
- Modify: `server/src/watch.ts` (a new public method on `FleetWatcher`, identified by its class
  declaration `export class FleetWatcher {`; a new lane clock beside `private lastNameSweep = 0;`;
  and the tick's sweep fan-out, identified by
  `void this.sweepNames().catch(() => { /* one bad sweep must not kill the poll */ });`)
- Modify: `server/src/bus.ts` (the three overload blocks, identified by
  `override emit(event: 'coord', coord: CoordStatus): boolean;` and its `on`/`off` twins)
- Modify: `shared/api.ts` (`FleetMsg`, identified by its last arm
  `| { type: 'coord'; coord: CoordStatus };`)
- Modify: `server/src/server.ts` (`/ws/fleet`, identified by
  `const onCoord = (coord: CoordStatus) =>` and the `bus.on('coord', onCoord);` /
  `bus.off('coord', onCoord);` pair)
- Test: `server/test/divergence-sweep.test.ts` (create)

**Interfaces:**
- Consumes: `divergences(input)`, `DivergenceInput`, `Divergence` (Task 110).
- Produces: `async sweepDivergences(records: SessionRecord[]): Promise<void>` on `FleetWatcher`;
  `readWorktreeRecords(io, projectsRoot, project): Promise<WorktreeRecord[] | null>` and
  `export interface WorktreeRecord { readonly name: string; readonly path: string; readonly headBranch: string | null }`
  in `server/src/coord/gitref.ts`; the `{ type: 'divergence'; divergences: Divergence[] }` frame.

**THE CENSUS HAS EXACTLY ONE PRODUCER, named here so nobody adds a second.**
`reviveFleetSession` must never become one — the existing `fleet.ts` precedent exists to prevent that
shape, and it is the only thing that makes splitting `DIVERGENCE_KINDS` (L0) from `divergences()`
(L1) defensible. This method DECIDES nothing.

**Where the reads come from, and why not from `~/worktrees`.** `agent/src/whitelist.ts`'s read set is
`.cc-sessions`, `.cc-limits`, `.cc-clips`, `$HOME/.claude*`, and `projectsRoot` — **`~/worktrees` is
NOT in it**, and ccd's own comment says so verbatim (*"the server cannot read `~/worktrees/*`
(checkPath, whitelist.ts)"*). No wave widens that. Everything this sweep needs is under
`projectsRoot` instead: a linked worktree's admin directory is
`<projectsRoot>/<project>/.git/worktrees/<name>/`, holding a `gitdir` file that names the worktree's
path and a `HEAD` that names its branch. That is git's own record, it catches the flat
`~/worktrees/<project>-<slug>` layout for free, and it needs no new `CcrcConfig` field.

**`this.deps.coord` MUST be `?.`-chained.** `server/test/hold-gate.test.ts` builds every watcher from
`testDeps`, which supplies no `coord`; a non-optional call TypeErrors fourteen tests there plus
`pr-sweep`'s archive tests.

- [ ] **Step 1: Write the failing test**

Create `server/test/divergence-sweep.test.ts`:

```ts
// §1.6's census, wired: git's own worktree records -> `divergences()` -> ONE
// `{type:'divergence'}` frame. The classifier is pinned in divergence.test.ts;
// what is only provable here is that the watcher gathers the right evidence, from
// paths the agent will actually serve, and DECIDES nothing with it.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** The repo root, for the one source-text assertion below. */
const ccrcRoot = path.resolve(__dirname, '../..');

interface FixtureCfg {
  /** Omit the key entirely to get a real store; pass `undefined` EXPLICITLY to
   *  build the watcher with no `coord` at all — the `testDeps` shape fourteen
   *  hold-gate tests use, and the reason every new read must be `?.`-chained. */
  coord?: CoordStore | undefined;
  /** Make `<projectsRoot>/<project>/.git/worktrees` unlistable, through an `io`
   *  override — there is no portable chmod that works as root. */
  unreadableProject?: string;
}

/** A watcher over a tmp `projectsRoot`, plus the two things this suite plants:
 *  registry rows and git's own linked-worktree admin records. Modelled on
 *  `hold-gate.test.ts`'s `seed` + `new FleetWatcher(testDeps(home, run), new Bus(), 10_000)`. */
const watcherFixture = async (cfg: FixtureCfg = {}) => {
  const home = mkTmp('ccrc-divergence-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfgObj = loadConfig({ CCRC_HOME: home } as never);
  const projectsRoot = cfgObj.projectsRoot;

  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args); return { code: 0, stdout: '', stderr: '' };
  };

  const io: FleetIO = cfg.unreadableProject === undefined ? localIO : {
    ...localIO,
    readdir: async (p: string) =>
      p.includes(path.join(cfg.unreadableProject!, '.git', 'worktrees')) ? null : localIO.readdir(p),
  };

  const coord = 'coord' in cfg
    ? cfg.coord
    : new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const deps = { ...testDeps(home, run), io, ...(coord === undefined ? {} : { coord }) };
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  return {
    home, bus, watcher, coord, projectsRoot,
    ccdCalls: () => calls,
    /** A registry row, in `hold-gate.test.ts`'s exact idiom. */
    plantRecord: (id: string, extra: Record<string, string> = {}): void => {
      const reg = path.join(home, '.cc-sessions');
      const fields: Record<string, string> = {
        uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
        workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main',
        started: '1', ...extra,
      };
      for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    },
    /** GIT'S OWN RECORD of a linked worktree — the thing this sweep reads,
     *  because `~/worktrees` is not on the agent's read whitelist and
     *  `<projectsRoot>/<project>/.git/worktrees/<name>/` is. */
    plantWorktreeRecord: (project: string, name: string, at: string, branch: string): void => {
      const admin = path.join(projectsRoot, project, '.git', 'worktrees', name);
      mkdirSync(admin, { recursive: true });
      writeFileSync(path.join(admin, 'gitdir'), `${at}/.git\n`);
      writeFileSync(path.join(admin, 'HEAD'), `ref: refs/heads/${branch}\n`);
    },
    records: () => readRegistry(io, cfgObj),
  };
};

describe('sweepDivergences', () => {
  it('reads git\'s OWN worktree records under projectsRoot, never ~/worktrees', () => {
    // The agent's read whitelist is `.cc-sessions`/`.cc-limits`/`.cc-clips`/
    // `$HOME/.claude*`/projectsRoot — `~/worktrees` is NOT in it, and ccd's own
    // comment says so. A sweep that globbed the worktrees root would return
    // nothing in remote mode and a full census locally: the worst possible split.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/watch.ts'), 'utf8');
    const body = /async sweepDivergences[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
    expect(body).not.toMatch(/worktrees['"`]\s*\)|WORKTREES_ROOT|home,\s*'worktrees'/);
  });

  it('emits ONE divergence frame naming the unregistered worktree', async () => {
    const h = await watcherFixture();
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([
      { kind: 'unregistered-worktree', id: null, path: '/data/worktrees/demo/nobody',
        detail: expect.any(String) },
    ]);
  });

  it('does not re-emit an unchanged census — byte-equality guarded like emitRuns', async () => {
    const h = await watcherFixture();
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(1);
  });

  it('runs with NO coord at all — testDeps supplies none, and fourteen hold-gate tests depend on that', async () => {
    // The rung MUST be `this.deps.coord?.runs()`. A non-optional call TypeErrors
    // every watcher built from `testDeps`.
    const h = await watcherFixture({ coord: undefined });
    await expect(h.watcher.sweepDivergences(await h.records())).resolves.toBeUndefined();
  });

  it('a project whose .git/worktrees cannot be listed contributes NOTHING, never a false census', async () => {
    // The single consumer behaviour for an unlistable directory: contribute no
    // worktrees. It can only suppress a finding, never manufacture one — which is
    // why one null here is not an overloaded null at a decision seam.
    const h = await watcherFixture({ unreadableProject: 'demo' });
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames[0] ?? []).toEqual([]);
  });

  it('DECIDES nothing — no ccd verb is run by this sweep', async () => {
    const h = await watcherFixture();
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await h.watcher.sweepDivergences(await h.records());
    expect(h.ccdCalls()).toEqual([]);
  });

  it('the frame reaches /ws/fleet, and an older PWA drops it silently', async () => {
    // Additive on the shipped `runs`/`coord` terms — NO FLEET_PROTO bump. Pinned
    // as the wire order this socket already guarantees: hello, fleet, runs, coord.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/server.ts'), 'utf8');
    expect(src).toContain("bus.on('divergence', onDivergence);");
    expect(src).toContain("bus.off('divergence', onDivergence);");
  });
});

describe('readWorktreeRecords', () => {
  it('parses gitdir and HEAD out of git\'s admin directory', async () => {
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees', 'quiet-basin');
    mkdirSync(admin, { recursive: true });
    writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/demo/quiet-basin/.git\n');
    writeFileSync(path.join(admin, 'HEAD'), 'ref: refs/heads/ws/quiet-basin\n');
    expect(await readWorktreeRecords(localIO, root, 'demo')).toEqual([
      { name: 'quiet-basin', path: '/data/worktrees/demo/quiet-basin', headBranch: 'ws/quiet-basin' },
    ]);
  });

  it('a DETACHED HEAD is a null branch, never a fabricated one', async () => {
    const root = mkTmp('ccrc-gitref-');
    const admin = path.join(root, 'demo', '.git', 'worktrees', 'quiet-basin');
    mkdirSync(admin, { recursive: true });
    writeFileSync(path.join(admin, 'gitdir'), '/data/worktrees/demo/quiet-basin/.git\n');
    writeFileSync(path.join(admin, 'HEAD'), `${'a'.repeat(40)}\n`);
    expect((await readWorktreeRecords(localIO, root, 'demo'))?.[0]?.headBranch).toBeNull();
  });

  it('answers null for a project with no linked worktrees or an unlistable admin dir', async () => {
    const root = mkTmp('ccrc-gitref-');
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    expect(await readWorktreeRecords(localIO, root, 'demo')).toBeNull();
  });

  it('refuses a project name that could escape projectsRoot', async () => {
    const root = mkTmp('ccrc-gitref-');
    expect(await readWorktreeRecords(localIO, root, '..')).toBeNull();
    expect(await readWorktreeRecords(localIO, root, '../etc')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/divergence-sweep.test.ts
```

Expected: `TypeError: h.watcher.sweepDivergences is not a function`, and
`readWorktreeRecords is not exported by '../src/coord/gitref.js'`.

- [ ] **Step 3: Write minimal implementation**

(a) `server/src/coord/gitref.ts`, appended (reusing the file's existing `BRANCH_OK` and its
single-segment `project` reasoning):

```ts
/** One linked worktree, as GIT records it. */
export interface WorktreeRecord {
  readonly name: string;
  readonly path: string;
  readonly headBranch: string | null;
}

/**
 * Every linked worktree of `<projectsRoot>/<project>`, read out of git's own
 * admin directory `<project>/.git/worktrees/<name>/` — `gitdir` names the
 * worktree's path, `HEAD` names its branch.
 *
 * READ FROM THE MAIN REPO, NOT FROM `~/worktrees`, and that is structural rather
 * than stylistic. `agent/src/whitelist.ts`'s read set is `.cc-sessions`,
 * `.cc-limits`, `.cc-clips`, `$HOME/.claude*` and `projectsRoot`; `~/worktrees`
 * is NOT in it, and ccd's own `pr-open` comment says so in as many words. Reading
 * git's record instead needs no widening, catches the FLAT
 * `~/worktrees/<project>-<slug>` layout a directory glob would miss, and is
 * immune to the `~/worktrees -> /data/worktrees` symlink (ccd writes the
 * registry's `workdir` unresolved, git resolves it, and `FleetIO.realpath`
 * answers null unconditionally in remote mode — so absolute-path comparison
 * would report the whole fleet as unregistered).
 *
 * `null` = there is no readable admin directory here: no linked worktrees, or a
 * listing that failed. It has exactly ONE consumer behaviour — contribute no
 * worktrees for this project — so it can only ever suppress a finding, never
 * manufacture one, which is why it is not an overloaded null at a decision seam.
 *
 * A DETACHED HEAD gives `headBranch: null`, never a fabricated name.
 */
export async function readWorktreeRecords(
  io: FleetIO, projectsRoot: string, project: string,
): Promise<WorktreeRecord[] | null> {
  // Same single-segment guard `readBranchTip` applies to `project`: the only two
  // values that mean anything but a literal directory name are `.` and `..`.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || project.includes('..')) return null;
  const adminRoot = path.join(projectsRoot, project, '.git', 'worktrees');
  const names = await io.readdir(adminRoot);
  if (names === null) return null;
  const out: WorktreeRecord[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;
    const gitdir = await io.readFile(path.join(adminRoot, name, 'gitdir'));
    if (gitdir === null) continue;
    // `gitdir` names the worktree's `.git` FILE; the worktree is its parent.
    const wt = path.dirname(gitdir.trim());
    if (wt === '' || wt === '.') continue;
    const head = await io.readFile(path.join(adminRoot, name, 'HEAD'));
    const m = head === null ? null : /^ref:\s*refs\/heads\/(\S+)\s*$/.exec(head.trim());
    const branch = m?.[1] ?? null;
    out.push({ name, path: wt, headBranch: branch !== null && BRANCH_OK.test(branch) ? branch : null });
  }
  return out;
}
```

(b) `shared/api.ts` — one additive `FleetMsg` arm after the `coord` arm:

```ts
  /** §1.6's census. Additive on the same terms as `runs`/`coord` above — an
   *  already-deployed PWA drops an unknown frame type silently, so NO
   *  `FLEET_PROTO` bump. FLEET-LEVEL, not row-level: a divergence names a
   *  disagreement BETWEEN sources, so it cannot ride on a `FleetSession` — and
   *  keeping it off `FleetSession` is what keeps `reviveFleetSession` from
   *  becoming a second producer. */
  | { type: 'divergence'; divergences: Divergence[] };
```

(c) `server/src/bus.ts` — one overload per block, beside the `coord` ones, and add `Divergence` to
the type-only import:

```ts
  override emit(event: 'divergence', divergences: Divergence[]): boolean;
```
```ts
  override on(event: 'divergence', listener: (divergences: Divergence[]) => void): this;
```
```ts
  override off(event: 'divergence', listener: (divergences: Divergence[]) => void): this;
```

(d) `server/src/watch.ts` — a lane clock beside `private lastNameSweep = 0;`:

```ts
  /** The census lane's clock, and its byte-equality guard. A git-ref read per
   *  project is far too expensive for the 2 s poll, and a census changes on
   *  human timescales; `null` (not `'[]'`) so the first sweep always emits, even
   *  an empty one — mirroring `lastRunsJson`'s own initial value, and the reason
   *  a HEALTHY fleet is a frame rather than a silence. */
  private lastDivergenceSweep = 0;
  private lastDivergenceJson: string | null = null;
```

…the fan-out, beside the `sweepNames` line inside `tick()`:

```ts
      // NEVER awaited, same reasoning as `sweepNames` above. Own clock: this reads
      // git's admin directory per project, which is not a per-tick cost.
      void this.sweepDivergences(records).catch(() => { /* one bad sweep must not kill the poll */ });
```

…and the method itself:

```ts
  /**
   * §1.6's census, and THE ONLY PRODUCER OF IT. Named once, deliberately, so
   * nobody adds a second — `reviveFleetSession` in particular must never become
   * one (the `fleet.ts` precedent exists to prevent exactly that shape, and it is
   * what makes splitting `DIVERGENCE_KINDS` in L0 from `divergences()` in L1
   * defensible).
   *
   * L4: it GATHERS (git's worktree records through `FleetIO`, open-run session
   * ids through `coord`) and it PUBLISHES. It DECIDES nothing — no ccd verb runs
   * here and nothing mutates. That is also what keeps `fleet.ts`'s
   * asymmetric-skew deferral valid: lifecycle stays a display-only qualifier, and
   * the deferral's own stated expiry ("if the census makes lifecycle drive an
   * adopt/respawn DECISION") has not been reached.
   *
   * `this.deps.coord` is `?.`-chained because `testDeps` supplies none — a
   * non-optional call TypeErrors fourteen `hold-gate` tests plus `pr-sweep`'s.
   */
  async sweepDivergences(records: SessionRecord[]): Promise<void> {
    const projects = [...new Set(records.map((r) => r.project))];
    const worktrees: DivergenceInput['worktrees'][number][] = [];
    const headBranch = new Map<string, string | null>();
    for (const project of projects) {
      const found = await readWorktreeRecords(this.deps.io, this.deps.cfg.projectsRoot, project);
      // `null` contributes nothing for this project — it can only suppress a
      // finding, never manufacture one.
      if (found === null) continue;
      for (const w of found) {
        worktrees.push({ project, name: w.name, path: w.path });
        headBranch.set(`${project}/${w.name}`, w.headBranch);
      }
    }
    let openRunSessionIds = new Set<string>();
    try {
      openRunSessionIds = new Set(
        (this.deps.coord?.runs() ?? [])
          .map((r) => r.sessionId)
          .filter((id): id is string => id !== null),
      );
    } catch (err) {
      // `coord.runs()` walks straight into synchronous `node:sqlite` — the same
      // fault every neighbouring lane already guards. A failed read skips the
      // census this pass rather than killing the poll.
      console.warn(`ccrc-server: sweepDivergences runs() failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    const found = divergences({
      records: records.map((r) => ({
        id: r.id, project: r.project, workspace: r.workspace, workdir: r.workdir,
        branch: r.branch, held: r.held, archivedAt: r.archivedAt,
      })),
      worktrees, headBranch, openRunSessionIds,
    });
    const json = JSON.stringify(found);
    if (json === this.lastDivergenceJson) return;
    this.lastDivergenceJson = json;
    this.bus.emit('divergence', found);
  }
```

**The clock gate itself, as code — not as an instruction.** Without it `lastDivergenceSweep` is a
dead field and the sweep does a git-admin-directory read per project on every 2 s poll, which is
exactly the cost its own docstring calls prohibitive. Declare the interval beside the file's
existing `const NAME_SWEEP_MS = 10_000;`:

```ts
/** The census lane. A disagreement between sources is a HUMAN-timescale event —
 *  a rename, a hand-made worktree, a run left open — and each sweep reads
 *  `<projectsRoot>/<project>/.git/worktrees/` per project. Six times slower than
 *  the name sweep, deliberately: this one touches the filesystem per PROJECT,
 *  not per pane. */
const DIVERGENCE_SWEEP_MS = 60_000;
```

…and open `sweepDivergences`'s body with the same two lines `sweepNames` uses (which read, verbatim,
`if (this.lastNameSweep !== 0 && now - this.lastNameSweep < NAME_SWEEP_MS) return;` /
`this.lastNameSweep = now;`):

```ts
  async sweepDivergences(records: SessionRecord[]): Promise<void> {
    const now = this.clock();
    if (this.lastDivergenceSweep !== 0 && now - this.lastDivergenceSweep < DIVERGENCE_SWEEP_MS) return;
    this.lastDivergenceSweep = now;
```

(`!== 0` is not a style tic — it is what makes the FIRST sweep run immediately after a restart
instead of waiting a minute, and it is the shape `sweepNames` already ships.)

Add the matching test to `server/test/divergence-sweep.test.ts`, because the existing
`does not re-emit an unchanged census` case calls `sweepDivergences` directly and so proves the
byte-equality guard, **not the clock**:

```ts
  it('does not re-READ inside the interval — the clock gate, not just the byte guard', async () => {
    const h = await watcherFixture();
    h.plantWorktreeRecord('demo', 'nobody', '/data/worktrees/demo/nobody', 'ws/nobody');
    await h.watcher.sweepDivergences(await h.records());
    // Delete the record: a second sweep INSIDE the interval must not notice,
    // because it must not have looked. A byte-equality guard alone would still
    // have read the directory and would report the census as CHANGED.
    rmSync(path.join(h.projectsRoot, 'demo', '.git', 'worktrees', 'nobody'),
      { recursive: true, force: true });
    const frames: unknown[] = [];
    h.bus.on('divergence', (d) => frames.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(frames).toHaveLength(0);
  });
```

(add `rmSync` to the `node:fs` import).

**One thing this task must UNDO, and it is a real decision rather than plumbing.**
`assembleFleet` sets `branch: sl?.branch ?? r.branch ?? null` — **the statusline's branch silently
overrides the registry's**. The census must compare git's HEAD against the REGISTRY's `.branch`
(`SessionRecord.branch`), because that is the field a done-fingerprint trusts and the field a rename
moves. `sweepDivergences` therefore reads `records`, not `sessions` — the `records: SessionRecord[]`
parameter exists for exactly that reason, and `assembleFleet`'s own display override is left alone.

(e) `server/src/server.ts` — in `/ws/fleet`, beside `onCoord`:

```ts
    const onDivergence = (divergences: Divergence[]) =>
      socket.send(JSON.stringify({ type: 'divergence', divergences } satisfies FleetMsg));
```

…plus `bus.on('divergence', onDivergence);` and `bus.off('divergence', onDivergence);` beside their
`coord` twins. **No cold-start emission**: the sweep's own byte-equality guard re-emits to every
connected client on the next change, and there is no `currentDivergences()` to serve — a fabricated
empty census on connect would claim a measurement this process may not have taken yet, which is the
rule `emitCoord`'s `null` already follows.

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/divergence-sweep.test.ts test/hold-gate.test.ts test/fleetws.test.ts test/watch.test.ts
```

```
cd /srv/projects/ccrc-pwa/pwa && npm run build
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add server/src/coord/gitref.ts server/src/watch.ts server/src/bus.ts server/src/server.ts shared/api.ts server/test/divergence-sweep.test.ts && git commit -m "feat(server): one producer publishes the census, off git's own worktree records (§1.6)"
```

---

### Task 112: single-definition describes for both new vocabularies — and for the one that shipped without

**Files:**
- Modify: `server/test/single-definition.test.ts` (three new describes, in the `Build 7 nouns` idiom
  — identified by its existing `it('defines RunState exactly once, in shared/', …)` and its
  `const hits = ALL.filter((f) => /^\s*export type RunState\b/m.test(readFileSync(f, 'utf8')));`)

**Interfaces:**
- Consumes: `SPAWN_VERDICTS`/`SpawnVerdict` (Task 101); `DIVERGENCE_KINDS`/`DivergenceKind`
  (Task 110).
- Produces: no runtime name.

**This file has NO generic scanner** — it is hand-written per concept, each with its own literal
regex and its own `it`, over `ROOTS = [shared, server/src, pwa/src, agent/src]`. Wave 1 adds one
describe per vocabulary, **and one for the EXISTING `SESSION_LIFECYCLES`, which shipped without one**
— a gap worth closing in the same pass, by the rule this build is establishing.

- [ ] **Step 1: Write the failing test**

Append to `server/test/single-definition.test.ts`:

```ts
// §1.6b. Neither new vocabulary gets this protection for free, and neither did
// the one PR #50 shipped. "A new fleet mutation is not done until its interrupted
// state is either impossible or named" is only a doctrine if a SECOND copy of the
// naming is a red suite.
describe('Build 8 vocabularies — one definition each, all derived from their map', () => {
  const oneDefinition = (decl: RegExp, name: string) => {
    const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel), name).toEqual(['shared/api.ts']);
  };

  it('defines SpawnVerdict and SPAWN_VERDICTS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type SpawnVerdict\b/m, 'SpawnVerdict');
    oneDefinition(/^\s*export const SPAWN_VERDICTS\b/m, 'SPAWN_VERDICTS');
  });

  it('DERIVES SPAWN_VERDICTS from its map — never a hand-written array beside the type', () => {
    // The technique `PR_REASONS` and `SESSION_LIFECYCLES` already use: a member
    // added to the union with no key in the map is TS2739 here, and a key the
    // union does not have is TS2353. A literal array is a list that nothing forces
    // to agree with the type it claims to enumerate.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SPAWN_VERDICTS: readonly SpawnVerdict\[\] =\s*\n?\s*Object\.keys\(SPAWN_VERDICT_MAP\)/);
    expect(api).not.toMatch(/SPAWN_VERDICTS[^=]*=\s*\[/);
  });

  it('spells the spawn members nowhere else — no second table of the same six words', () => {
    // `SessionLine.tsx`'s `SPAWN_WORD` is a PRESENTATIONAL map keyed BY the type
    // (`Record<SpawnVerdict, string | null>`, which the compiler keeps total), not
    // a second enumeration — so it holds the member names as KEYS and is exempt by
    // being typed. What this forbids is a free-standing list.
    const LIST = /\[\s*'ready',\s*'login',\s*'vanished',\s*'expired',\s*'blocked',\s*'unrecognised'\s*\]/;
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('defines DivergenceKind and DIVERGENCE_KINDS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type DivergenceKind\b/m, 'DivergenceKind');
    oneDefinition(/^\s*export const DIVERGENCE_KINDS\b/m, 'DIVERGENCE_KINDS');
  });

  it('DERIVES DIVERGENCE_KINDS from its map', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const DIVERGENCE_KINDS: readonly DivergenceKind\[\] =\s*\n?\s*Object\.keys\(DIVERGENCE_KIND_MAP\)/);
    expect(api).not.toMatch(/DIVERGENCE_KINDS[^=]*=\s*\[/);
  });

  it('has exactly ONE census producer — the frame is emitted from one file', () => {
    // Splitting `DIVERGENCE_KINDS` (L0) from `divergences()` (L1) is defensible
    // ONLY if the census has one producer. `reviveFleetSession` must never become
    // a second, which is why the census rides a FRAME and not a `FleetSession`
    // field.
    const emitters = ALL.filter((f) => /bus\.emit\(\s*'divergence'/.test(readFileSync(f, 'utf8')));
    expect(emitters.map(rel)).toEqual(['server/src/watch.ts']);
    const callers = ALL.filter((f) => /\bdivergences\s*\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map(rel).sort()).toEqual(['server/src/divergence.ts', 'server/src/watch.ts']);
  });

  it('defines SESSION_LIFECYCLES exactly once — THE GAP PR #50 SHIPPED WITH', () => {
    // Not a new rule: the same rule, applied to the vocabulary this build is
    // extending. It had no describe at all, which is how a second copy would have
    // arrived unnoticed in exactly the wave that adds a member to it.
    oneDefinition(/^\s*export type SessionLifecycle\b/m, 'SessionLifecycle');
    oneDefinition(/^\s*export const SESSION_LIFECYCLES\b/m, 'SESSION_LIFECYCLES');
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SESSION_LIFECYCLES: readonly SessionLifecycle\[\] =\s*\n?\s*Object\.keys\(SESSION_LIFECYCLE_MAP\)/);
    expect(api).not.toMatch(/SESSION_LIFECYCLES[^=]*=\s*\[/);
  });

  it('mints NO `spawnstate` FIELD anywhere — the shipped registry field is `spawn`', () => {
    // Every occurrence of the word in the spec is a stale draft artifact. A
    // word-only field would destroy the timestamp `_supervised_start` compares
    // `at >= since` against.
    //
    // THE REGEX MATCHES A FIELD, NOT THE WORD, AND THAT IS NOT A WEAKENING — it
    // is the difference between this scan and a spell-checker. Task 101's
    // `SpawnVerdict` docstring and Task 109's `run_events` comment both FORBID
    // the field in prose, inside `shared/api.ts` and `server/src/coord/dispatch.ts`
    // — two files inside ROOTS. A bare `\bspawnstate\b` would red on the very
    // sentences that exist to prevent it, which is a guard eating its own
    // documentation. So: a property access, a quoted key, or a
    // declaration/assignment — every shape an actual field can take.
    const FIELD = /\.spawnstate\b|['"`]spawnstate['"`]|\bspawnstate\s*[:=]/;
    for (const f of ALL) {
      expect(FIELD.test(readFileSync(f, 'utf8')),
        `${rel(f)} names a spawnstate field`).toBe(false);
    }
  });

  it('and the two prose FORBIDDINGS still pass — the guard does not eat its own docs', () => {
    // The positive case, so nobody "fixes" the regex above back into \b…\b and
    // discovers the breakage only when Task 101 lands.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    const dispatch = readFileSync(path.join(ccrcRoot, 'server/src/coord/dispatch.ts'), 'utf8');
    expect(api).toContain('spawnstate');       // in the SpawnVerdict docstring
    expect(dispatch).toContain('spawnstate');  // in the run_events detail comment
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Prove each describe by MUTATION before accepting it — this file's whole value is that a second copy
reds it, and a scan that matches nothing passes vacuously.

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Then, one at a time and reverting each: paste `export const SPAWN_VERDICTS = ['ready'];` into
`pwa/src/fleet/SessionLine.tsx` (expect the first `it` to red with
`['shared/api.ts', 'pwa/src/fleet/SessionLine.tsx']`); replace `SPAWN_VERDICTS`' body with a literal
array (expect the derivation `it` to red); add a `bus.emit('divergence', [])` to
`server/src/server.ts` (expect the single-producer `it` to red).

The `spawnstate` scan gets **both** directions, because it is the one whose regex was narrowed:

```
# RED — a real field. Revert after checking.
sed -i "s/spawnState: spawnRaw,/spawnstate: spawnRaw,/" shared/api.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts   # expect: shared/api.ts names a spawnstate field
cd .. && git checkout shared/api.ts

# GREEN — prose that FORBIDS the field must keep passing. This is the case a
# bare \bspawnstate\b would have broken, on text this plan requires.
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "does not eat its own docs"
```

- [ ] **Step 3: Write minimal implementation**

None — Tasks 101, 110 and 111 already satisfy every assertion. This step exists to record that: if
any describe is GREEN before its mutation and RED after, the scanner is real; if a describe cannot be
made to red, delete it rather than ship a scan that asserts nothing.

- [ ] **Step 4: Run test to verify it passes**

```
cd /srv/projects/ccrc-pwa/server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

- [ ] **Step 5: Commit**

```
cd /srv/projects/ccrc-pwa && git add server/test/single-definition.test.ts && git commit -m "test: a second copy of either new vocabulary — or of SESSION_LIFECYCLES — is a red suite (§1.6b)"
```

---

### Wave 1 (server/shared/PWA half) — definition of done

- `cd server && npm run test`, `cd agent && npm run test`, `cd pwa && npm run test` all green in the
  FOREGROUND, timeout ≥600000 ms. `ccd-ws-gc`, `pr-sweep`, `session-hook` and `typecheck-tests` are
  known load flakes — re-run in isolation before calling a real break.
- **`cd pwa && npm run build` green.** `pwa/test` is typechecked by the BUILD, not by `npm run test`:
  Task 102's `lifecycleWords.ts` TS2739 and Task 103's 21 broken factories are invisible to the suite.
- `server/test/ownership.test.ts` green on **every** commit, not just the last — Task 102 touches
  `ccd/ccd` and re-stamps the provenance marker in that same commit.
- Deploy order, three lanes described as two: **ccd → agent → server**, with a link outage in the
  middle. `bash deploy/deploy.sh agent <host>` — the host argument is not optional.
- **The full ordered deploy, the six-session reboot pre-flight and the post-reboot cgroup exit gate
  live in w1-ccd's definition of done.** Wave 1 is ONE deploy across both sections; do not run a
  second, partial one from here. In particular Task 4 (`_tmux_server_ensure`) is inert until the
  planned reboot, and that reboot must come AFTER the ccd install and its supervisor sweep.
- Ordering constraints inside this section that are NOT captured by the dependency edges:
  **w1-ccd Task 11 must land immediately after Task 102** (it closes the `_resupervise_live`
  regression Task 102 creates), and **Task 105 must not ship ahead of w1-ccd Task 11** (its sheet
  copy promises the adoption that task implements).
## Wave 2 — a claim knows whose it is

**Bounded context:** Coordination. **AGENT-FIRST**, not server-only — Task 209 edits
`ccd/ccd` (`cmd_ws_release`'s comment becomes false) and Task 216 edits
`ccd/coordinator-skill/`, so this wave ships to the fleet host before the server and hits the
provenance-marker gate (`server/test/ownership.test.ts`) exactly like Waves 1, 3 and 4. The spec's
Wave 2 header, its Deployment section and §2.3 disagree about this; §2.3 is right and the other two
are stale. **No new ccd verb, no new exec-whitelist entry, no `FLEET_PROTO` bump, no new
dependency.**

**Closes:** F9 proper, the by-hand archive variant, release-then-crash, the wrong-wave hold
overwrite, the fourth ungated fleet act, and most of the sweep-blindness window.

**Why the fix is server-side.** The hold is one file keyed on the session id whose reason string is
display-only and parsed back nowhere in this tree (`rundefs.ts`'s `holdReason` docstring says so in
those words). It cannot answer *whose claim is this?*. The coordinator protocol **deliberately**
creates two open runs naming one session — `SKILL.md` step 5 mandates opening wave N+1 **before**
closing wave N — so that state is correct protocol, not a mistake. `coord.db` lives on the server
and the fleet host's copy is 0 bytes, so run-awareness cannot be a rung inside ccd; it must be a
server-side decision expressed as an **argv choice**. Exactly three places hold both halves in one
process: `closeRun`, `FleetWatcher.archiveMerged`, and `POST /api/sessions/:id/archive`.

**Nothing at the store layer prevents two open runs naming one session** — `setSession` and
`markDispatched` are bare single-column `UPDATE`s with no uniqueness constraint — and that is
CORRECT. No task in this wave may read as though a constraint existed.

**Box-token gate, checked not assumed.** `POST /api/runs` and `POST /api/runs/:id/close` both call
`requireMailToken(req, reply, …)` at the top of the handler (`server/src/coord/routes.ts`).
`POST /api/runs/:id/abandon` is **deliberately ungated** — its shipped docstring says so: "the box
token authenticates the fleet host and the coordinator holds it, so gating the release valve for a
run wedged BY a stuck coordinator behind that same coordinator's key would leave the wedge with no
door at all." `POST /api/sessions/:id/archive` lives in `server/src/server.ts`, outside
`registerCoordRoutes` entirely, and carries **no** token gate today. Task 208 does not add one:
adding a coordination *refusal* to a route is not the same as making it a coordination *write*, and
the route's existing reachability (the PWA, no token) is the thing the README blesses.

**Deploy order for this wave:** `bash deploy/deploy.sh agent <fleet-host>` (Tasks 209 + 216 ship
`ccd/ccd` and the skill), then `bash deploy/deploy.sh` (server + PWA). The host argument is not
optional — `deploy.sh` defaults `$BOX` to the SERVER box.

**Wave 2's definition of done includes the provenance re-stamp riding in the same commit as every
`ccd/ccd` edit** (Task 209). Not a cleanup task at the end: an unstamped intermediate commit leaves
`ownership.test.ts` red for every commit after it on the branch.

---

### Task 201: `runs_by_session` — a real migration, because migration 0 no longer runs

**Files:**
- Modify: `server/src/coord/schema.ts` (append a SECOND entry to `export const MIGRATIONS: readonly string[] = [`; correct the two comments that justify amendment-in-place, identified by their shared phrase `coord.db has shipped to no box yet` / `coord.db exists on no box yet`)
- Test: `server/test/coord-db.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MIGRATIONS[1]` — the string `CREATE INDEX runs_by_session ON runs(sessionId);`; `COORD_SCHEMA_VERSION === 2` **by derivation** (`MIGRATIONS.length`, unchanged expression).

**Why it cannot be an amendment to `MIGRATIONS[0]`.** `server/src/coord/db.ts` migrates with
`for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, so an edit to migration 0 **never executes**
against a database already at `user_version 1` — and the server's copy IS live, having driven five
runs through build4. The two `schema.ts` comments that say "Landed in v1 rather than a migration 2
… coord.db has shipped to no box yet, so amending v1 before it has ever been observed costs
nothing" state a premise that **has expired**; they are corrected in this task so the next person
does not follow them.

`runs` carries exactly two indexes today (`runs_by_state ON runs(state)`,
`runs_by_program ON runs(program, wave)`), neither usable here: `sessionId` is unindexed and
`state NOT IN (…)` is negated set membership, not seekable.

- [ ] **Step 1: Write the failing test**

Add to `server/test/coord-db.test.ts`. It already imports `MIGRATIONS`, `tx`, `openCoordDb`,
`COORD_SCHEMA_VERSION` and has a `dbPathIn` helper; add `import { DatabaseSync } from 'node:sqlite';`
at the top if it is not already there.

```ts
describe('coord.db: migration 1 — runs_by_session', () => {
  it('reaches a database ALREADY at user_version 1 — it cannot be an amendment to MIGRATIONS[0]', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    // Build the file exactly as the SHIPPED v1 server left it: migration 0
    // only, user_version 1. `db.ts`'s loop starts at `current`, so anything
    // amended INTO MIGRATIONS[0] can never run against this file again.
    const raw = new DatabaseSync(p);
    tx(raw, () => { raw.exec(MIGRATIONS[0]!); raw.exec('PRAGMA user_version = 1'); });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    expect(COORD_SCHEMA_VERSION).toBe(2);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as
      { name: string }[]).map((r) => r.name);
    expect(names).toContain('runs_by_session');
    db.close();
  });

  it('turns the sibling query from SCAN into SEARCH — the reason the index exists', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const plan = (db.prepare(
      'EXPLAIN QUERY PLAN SELECT id, program, wave, waveOf FROM runs ' +
      "WHERE sessionId = ? AND state NOT IN ('done','failed') AND id != ?",
    ).all('demo-alpha', -1) as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('runs_by_session');
    expect(plan).not.toContain('SCAN runs');
    db.close();
  });

  it('does not justify amending v1 in place any more — that premise expired when coord.db shipped', () => {
    const src = readFileSync(path.join(root, 'server', 'src', 'coord', 'schema.ts'), 'utf8');
    // LINE-WRAP TOLERANT, and this is not fussiness — it is the difference
    // between a red step and a vacuous pass. BOTH phrases are split across SQL
    // comment lines in the shipped file: `-- 10's feed_events both give: coord.db has shipped`
    // / `-- to no box yet, so amending v1 before it has ever`, and
    // `-- same reason D-1's runs.clearedAt amendment gives: coord.db exists on no`
    // / `-- box yet, so amending v1 before it has ever been observed costs nothing.`
    // A single-line regex matches NEITHER and the assertion passes before the fix.
    const flat = src.replace(/\s*--\s*/g, ' ').replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/coord\.db has shipped to no box yet/);
    expect(flat).not.toMatch(/coord\.db exists on no box yet/);
    // And the replacement says what is true now, so a future author is not
    // left to rediscover it.
    expect(src).toMatch(/already at `user_version 1`|already at user_version 1/);
  });
});
```

The third `it` needs `readFileSync`, `path` and a `root`; if `coord-db.test.ts` has none, add:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts
```

Expected: first `it` fails on `expect(user_version).toBe(2)` — *"expected 1 to be 2"*; second fails
with the plan string containing `SCAN runs`; third fails on
`expected ' … coord.db has shipped to no box yet, so amending v1 … ' not to match /coord\.db has shipped to no box yet/`.
**If the third passes here, your regex is not line-wrap tolerant — fix the test, not the source.**

- [ ] **Step 3: Write minimal implementation**

In `server/src/coord/schema.ts`, append a second array entry after the existing v1 template literal
(the one that ends with the `feed_events` table and a closing backtick + comma):

```ts
  // ── 2: user_version 1 -> 2 ────────────────────────────────────────────────
  // `CoordStore.openRunsForSession` — "which OPEN runs name this session?" —
  // is asked at three destructive decision points (close's fleet act,
  // `archiveMerged`, the by-hand archive route). `runs` had no index on
  // `sessionId`, and `state NOT IN (…)` is negated set membership, not
  // seekable, so the query planned as `SCAN runs`. Measured against the v1
  // DDL in an in-memory `node:sqlite`: `SCAN runs` before,
  // `SEARCH runs USING INDEX runs_by_session (sessionId=?)` after.
  //
  // A SEPARATE MIGRATION, not an amendment to migration 1, and that is
  // load-bearing: `db.ts` runs `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`,
  // so an edit to `MIGRATIONS[0]` never executes against a database already
  // at `user_version 1` — and the server's copy IS one, having driven five
  // runs through build4.
  `
  CREATE INDEX runs_by_session ON runs(sessionId);
  `,
```

Then correct the two stale justifications. **Both are WRAPPED across SQL comment lines** — quoted
here as they actually appear at `d7137c2`, so they can be string-matched. In
`mail_deliveries.replayCount`'s column comment, replace these four lines:

```
                                                -- in v1 rather than a migration 2 for the same
                                                -- reason D-1's runs.clearedAt amendment and Task
                                                -- 10's feed_events both give: coord.db has shipped
                                                -- to no box yet, so amending v1 before it has ever
                                                -- been observed costs nothing.
```

with:

```
                                                -- Landed in v1 rather than a migration 2 because,
                                                -- at the time, coord.db existed on no box. THAT
                                                -- PREMISE HAS EXPIRED: the server's copy is live
                                                -- and already at `user_version 1`, so v1 is now
                                                -- FROZEN — a change to MIGRATIONS[0] would never
                                                -- run against it. Every later column or index is
                                                -- its own migration (runs_by_session is the first).
```

And in the `feed_events` comment, replace these three lines (again, as wrapped in the file):

```
  -- which resets to 0 on one). Landed in v1 rather than a migration 2 for the
  -- same reason D-1's runs.clearedAt amendment gives: coord.db exists on no
  -- box yet, so amending v1 before it has ever been observed costs nothing.
```

with (keeping the `which resets to 0 on one).` sentence, which is unrelated and still true):

```
  -- Landed in v1 while coord.db still existed on no box. That premise has
  -- expired — the live database is already at `user_version 1`, so v1 is
  -- frozen and every later change is its own migration.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts
```

Also run the neighbouring suite, because `COORD_SCHEMA_VERSION` moved:

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/schema.ts server/test/coord-db.test.ts
git commit -m "feat(coord): runs_by_session lands as MIGRATIONS[1] — v1 is frozen, the amend-in-place premise expired"
```

---

### Task 202: `CoordStore.openRunsForSession` — one query, synchronous

**Files:**
- Modify: `server/src/coord/store.ts` (add `export interface OpenSibling` beside `export interface RunRow extends RunSummary { prLineage: PrLineageEntry[] }`; add the method beside `runs(opts: …)`)
- Test: `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: `runs_by_session` (Task 201).
- Produces:
  - `export interface OpenSibling { id: number; program: string; wave: number; waveOf: number | null }`
  - `openRunsForSession(sessionId: string, excludeRunId?: number): OpenSibling[]` — **synchronous**.

**SYNCHRONOUS. Do not wrap it async.** `coord.db`'s synchrony is a stated concurrency invariant
(`CLAUDE.md`: "do not wrap it async — a repository/async interface over `CoordStore` is explicitly
rejected"). This is a single read OUTSIDE any transaction: it neither lengthens one nor introduces
an `await` inside one, so it is the one shape that cannot threaten the invariant — and wrapping it
would.

**Do NOT add `AND dispatchedAt IS NOT NULL`.** It resembles D-13's shape but D-13 guards
`capsUsage`, a global session-less count whose problem class is `planned` rows with no session —
already excluded here by `WHERE sessionId = ?`. Importing it would **reintroduce F9**: the open
route places the wave-N+1 hold at OPEN time, before any dispatch, so a live claim legitimately
belongs to a run with `dispatchedAt IS NULL`. This paragraph exists so a later reviewer does not
"fix" it.

- [ ] **Step 1: Write the failing test**

Append to `server/test/coord-store.test.ts` (it already has `store()` and `openRun()` helpers):

```ts
describe('CoordStore.openRunsForSession', () => {
  it('names every OPEN run on a session, in id order, and is SYNCHRONOUS', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    const b = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    s.setSession(b.id, 'demo-alpha');
    const got = s.openRunsForSession('demo-alpha');
    // Not a promise: the whole point. `await`ing this would be the one move
    // that threatens coord.db's stated synchrony invariant.
    expect(got).toBeInstanceOf(Array);
    expect(got).toEqual([
      { id: a.id, program: 'build4', wave: 1, waveOf: 5 },
      { id: b.id, program: 'build4', wave: 2, waveOf: 5 },
    ]);
  });

  it('honours excludeRunId — the closing run is never its own sibling', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    const b = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    s.setSession(b.id, 'demo-alpha');
    expect(s.openRunsForSession('demo-alpha', a.id).map((r) => r.id)).toEqual([b.id]);
    expect(s.openRunsForSession('demo-alpha', b.id).map((r) => r.id)).toEqual([a.id]);
  });

  it('excludes done and failed, and answers [] for a session no run names', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    expect(s.advance(a.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(a.id, 'closing', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(a.id, 'done', 'coordinator')).toMatchObject({ ok: true });
    expect(s.openRunsForSession('demo-alpha')).toEqual([]);
    expect(s.openRunsForSession('demo-nobody')).toEqual([]);
  });

  it('does NOT filter on dispatchedAt — the open-time hold belongs to an undispatched run (F9)', () => {
    // `POST /api/runs` places the wave-N+1 hold at OPEN time, before any
    // dispatch. A `dispatchedAt IS NOT NULL` predicate here — D-13's shape,
    // which guards a DIFFERENT problem class (a global, session-less count) —
    // would make that live claim invisible and reintroduce F9.
    const s = store();
    const a = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    expect(s.run(a.id)!.dispatchedAt).toBeNull();
    expect(s.openRunsForSession('demo-alpha').map((r) => r.id)).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
```

Expected: `TypeError: s.openRunsForSession is not a function` on all four.

- [ ] **Step 3: Write minimal implementation**

In `server/src/coord/store.ts`, beside `export interface RunRow extends RunSummary { … }`:

```ts
/** One open run naming a session. NOT a `RunRow`: these four columns are all
 *  the three consumers (`closeRun`, `FleetWatcher.archiveMerged`, the by-hand
 *  archive route) need, and hydrating a whole run to answer "is this
 *  workspace still claimed?" would drag `prLineage` JSON and a `programs`
 *  join through a decision that turns on four integers and a slug. */
export interface OpenSibling {
  id: number; program: string; wave: number; waveOf: number | null;
}
```

And, beside `runs(opts …)`:

```ts
  /**
   * "Which OPEN runs name this session?" — the question the hold file
   * structurally cannot answer, asked at three destructive decision points.
   *
   * SYNCHRONOUS, like the rest of `CoordStore`. DO NOT WRAP IT ASYNC: the
   * store's synchrony is a stated concurrency invariant, and this read sits
   * OUTSIDE any transaction, so it neither lengthens one nor introduces an
   * `await` inside one — wrapping it is the only move that would threaten
   * the invariant.
   *
   * NO `AND dispatchedAt IS NOT NULL`. It looks like D-13's predicate on
   * `capsUsage`, but D-13 guards a GLOBAL, SESSION-LESS count whose problem
   * class is `planned` rows with no session — already excluded here by
   * `WHERE sessionId = ?`. Importing it would REINTRODUCE F9, because
   * `POST /api/runs` places the wave-N+1 hold at OPEN time, before any
   * dispatch, so a live claim legitimately belongs to a run with
   * `dispatchedAt IS NULL`. This sentence exists so a later reviewer does
   * not "fix" it.
   *
   * Nothing at this layer prevents two open runs naming one session
   * (`setSession`/`markDispatched` are bare UPDATEs with no uniqueness
   * constraint) and that is CORRECT — the coordinator protocol deliberately
   * creates that state by opening wave N+1 before closing wave N.
   *
   * `excludeRunId` defaults to `-1`, an id AUTOINCREMENT never mints, so the
   * "no exclusion" call and the excluding call are ONE query, not two.
   */
  openRunsForSession(sessionId: string, excludeRunId?: number): OpenSibling[] {
    return this.db.prepare(
      'SELECT id, program, wave, waveOf FROM runs ' +
      "WHERE sessionId = ? AND state NOT IN ('done','failed') AND id != ? ORDER BY id",
    ).all(sessionId, excludeRunId ?? -1) as unknown as OpenSibling[];
  }
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/store.ts server/test/coord-store.test.ts
git commit -m "feat(coord): CoordStore.openRunsForSession — the question a hold file cannot answer"
```

---

### Task 203: `releaseIsSafe` — the decision gets one home and one test

**Files:**
- Modify: `server/src/coord/rundefs.ts` (add directly beneath `export const holdReason = (program: string, wave: number, waveOf: number | null): string =>`)
- Test: `server/test/coord-store.test.ts` — chosen because it is the one server test file that already exercises coordination policy without booting Fastify, and `releaseIsSafe` is a pure function with no route to reach it through.

**Interfaces:**
- Consumes: `OpenSibling` (Task 202).
- Produces: `export const releaseIsSafe = (openSiblings: readonly OpenSibling[]): boolean`.

**Why `rundefs.ts` and not a new file.** `rundefs.ts` is `holdReason`'s home — the sibling pure
decision — and it is already a member of `single-definition.test.ts`'s `HANDLE_HOLDERS`
(`new Set(['store.ts', 'rundefs.ts', 'routes.ts', 'db.ts', 'schema.ts'])`), so the coord-ring
handle scanner has nothing new to reason about. A new `server/src/coord/` file would add one.

It is trivial today. It exists so the decision has ONE home and ONE test, and so the four call sites
in Tasks 205/206 cannot drift onto four spellings of "is anyone else still holding this?".

- [ ] **Step 1: Write the failing test**

Append to `server/test/coord-store.test.ts`, adding
`import { releaseIsSafe } from '../src/coord/rundefs.js';`:

```ts
describe('releaseIsSafe', () => {
  it('is true only when NOTHING else names the session', () => {
    expect(releaseIsSafe([])).toBe(true);
  });

  it('is false for one sibling and for many — a claim is not a majority vote', () => {
    expect(releaseIsSafe([{ id: 7, program: 'build4', wave: 2, waveOf: 3 }])).toBe(false);
    expect(releaseIsSafe([
      { id: 7, program: 'build4', wave: 2, waveOf: 3 },
      { id: 8, program: 'build4', wave: 3, waveOf: null },
    ])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
```

Expected: `SyntaxError`/`does not provide an export named 'releaseIsSafe'` from `rundefs.js`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/coord/rundefs.ts`, directly under `holdReason`:

```ts
/** May this close END the claim on the workspace, or must it hand the claim
 *  to whoever else still owns it?
 *
 *  L1, pure: no `fs`, no `reply`, no clock, no database handle. Trivial today
 *  — `length === 0` — and that is the point: `closeRun` asks this question at
 *  FOUR distinct fleet acts (abandon, final, non-final, failed-with-archive),
 *  and before this constant existed each of them would have spelled it
 *  itself. One home, one test, one mutant. */
export const releaseIsSafe = (openSiblings: readonly OpenSibling[]): boolean =>
  openSiblings.length === 0;
```

and extend the file's existing import of store types to carry the type:

```ts
import type { CoordStore, OpenSibling, RunRow } from './store.js';
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/single-definition.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/rundefs.ts server/test/coord-store.test.ts
git commit -m "feat(coord): releaseIsSafe — one home for 'may this close end the claim?'"
```

---

### Task 204: the hold reason names its run

**Files:**
- Modify: `server/src/coord/rundefs.ts` (`export const holdReason = (program: string, wave: number, waveOf: number | null): string =>`)
- Modify: `server/src/coord/dispatch.ts` (`const holdArgv = CCD_ARGV.wsHold(sessionId, holdReason(run.program, run.wave, run.waveOf));`)
- Modify: `server/src/coord/routes.ts` (`const argv = CCD_ARGV.wsHold(sessionId, holdReason(program, wave, waveOfVal));`)
- Modify: `server/src/coord/close.ts` (`const nextReason = holdReason(run.program, run.wave + 1, run.waveOf);`)
- Test: `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `holdReason(program: string, wave: number, waveOf: number | null, runId: number | null): string` → `program:<P> wave:<N>/<M> run:<R>`, with **no** ` run:` suffix when `runId === null`.

**The ruling on the open ambiguity.** A **hand** hold has no run, passes `null`, and gets no
`run:` suffix — so `SessionActionsSheet`'s composer placeholder `program:name wave:2/4` stays a
truthful example and **is not edited**. `close.ts`'s non-final arm also passes `null`: the reason it
writes is for wave **N+1**, whose run has not been opened yet, and stamping the CLOSING run's id
onto the successor's claim would be a lie. (When a sibling IS open, Task 205 replaces that call
entirely with the survivor's own reason, which does carry an id.)

It stays **DISPLAY-ONLY**. Run-awareness comes from `coord.db` via `openRunsForSession`, never from
parsing this string. A test pins that nothing parses it.

**End to end unmodified:** the agent grants `['ws-hold','--session']` as a PREFIX and ccd only
checks non-whitespace-emptiness plus arity, so the longer format needs no whitelist or ccd change.

- [ ] **Step 1: Write the failing test**

Three edits to existing assertions in `server/test/run-routes.test.ts`, plus one new test.

In `it('places the hold immediately when sessionId names an existing workspace, and persists it onto the row', …)`, replace

```ts
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-existing', '--reason', 'program:build4 wave:2/3']);
```

with

```ts
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-existing', '--reason', `program:build4 wave:2/3 run:${id}`]);
```

In `it('places the hold with the convention reason, and never parses one back', …)`, replace

```ts
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-fresh2', '--reason', 'program:build4 wave:1/3']);
```

with

```ts
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-fresh2', '--reason', `program:build4 wave:1/3 run:${opened.id}`]);
```

The third assertion — `it('updates the hold reason to the next wave otherwise', …)`, currently
`'program:build4 wave:2/3'` — **does not change**, and that is deliberate: wave 2's run does not
exist yet, so its claim names no id. Add a comment above it saying so.

New test, in the same file:

```ts
  it('the reason names its run, and NOTHING in the tree parses one back', () => {
    // DISPLAY-ONLY. `run:` exists so a human reading ~/.cc-sessions can answer
    // "whose claim is this?" from the box alone — which they could not during
    // the F9 incident. Run-awareness itself comes from coord.db
    // (`openRunsForSession`), never from this string.
    expect(holdReason('build4', 2, 3, 17)).toBe('program:build4 wave:2/3 run:17');
    expect(holdReason('build4', 2, null, 17)).toBe('program:build4 wave:2 run:17');
    // A HAND hold has no run: no suffix, so the PWA composer's placeholder
    // `program:name wave:2/4` is still a truthful example.
    expect(holdReason('build4', 2, 3, null)).toBe('program:build4 wave:2/3');

    // The negative half, scanned over the two rings that could plausibly
    // acquire a parser. A `.split('run:')`, a `/run:(\d+)/`, a
    // `startsWith('program:')` — any of them turns a display string into a
    // protocol.
    for (const dir of [path.join(root, 'server', 'src'), path.join(root, 'pwa', 'src')]) {
      for (const f of sourcesUnder(dir)) {
        const src = readFileSync(f, 'utf8');
        expect(/['"`]run:['"`]|\/.*run:\\?\(/.test(src.replace(/^\s*\/\/.*$/gm, '')),
          `${f} looks like it parses a hold reason`).toBe(false);
      }
    }
  });
```

`sourcesUnder` is a local `readdirSync`-recursive helper returning `.ts`/`.tsx` paths; write it at
the top of the file if the file has none. `holdReason` must be imported:
`import { holdReason } from '../src/coord/rundefs.js';`.

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
```

Expected: the two edited `toContainEqual` assertions fail (`program:build4 wave:2/3` received,
`program:build4 wave:2/3 run:<n>` expected), and the new test fails at
`holdReason('build4', 2, 3, 17)` with `Expected 4 arguments, but got 3` at typecheck or
`'program:build4 wave:2/3'` at runtime.

- [ ] **Step 3: Write minimal implementation**

`server/src/coord/rundefs.ts` — replace the export and extend its docstring's last sentence:

```ts
export const holdReason = (program: string, wave: number, waveOf: number | null,
                           runId: number | null): string =>
  `program:${program} wave:${wave}${waveOf === null ? '' : `/${waveOf}`}` +
  `${runId === null ? '' : ` run:${runId}`}`;
```

Add to its docstring:

```
 *  `run:<id>` (Wave 2) is what lets a human reading `~/.cc-sessions` answer
 *  "whose claim is this?" from the box alone — the question that had no
 *  answer during the F9 incident. STILL DISPLAY-ONLY: run-awareness comes
 *  from `coord.db` (`CoordStore.openRunsForSession`), never from parsing
 *  this string, and `run-routes.test.ts` pins that nothing does. A HAND hold
 *  has no run and passes `null`, so it gets no suffix.
```

`server/src/coord/dispatch.ts`:

```ts
  const holdArgv = CCD_ARGV.wsHold(sessionId, holdReason(run.program, run.wave, run.waveOf, run.id));
```

`server/src/coord/routes.ts` (open route — the run row is INSERTED by `coord.openRun` above this
line, so `opened.id` exists):

```ts
      const argv = CCD_ARGV.wsHold(sessionId, holdReason(program, wave, waveOfVal, opened.id));
```

`server/src/coord/close.ts` (non-final arm) — explicit `null`, with the reason written down:

```ts
    // `null`, explicitly: this reason claims the workspace for wave N+1,
    // whose run has not been opened yet. Stamping the CLOSING run's id onto
    // the successor's claim would name the wrong run.
    const nextReason = holdReason(run.program, run.wave + 1, run.waveOf, null);
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coord-abandon.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/rundefs.ts server/src/coord/dispatch.ts server/src/coord/routes.ts server/src/coord/close.ts server/test/run-routes.test.ts
git commit -m "feat(coord): the hold reason names its run — program:<P> wave:<N>/<M> run:<R>, still parsed by nothing"
```

---

### Task 205: `closeRun` stops releasing a live claim — abandon, final, non-final

**Files:**
- Modify: `server/src/coord/close.ts` (`export type CloseOutcome`'s ok arm `| { ok: true; id: number; state: 'done' | 'failed' }`; the abandon arm's `if (run.sessionId !== null) {` block whose act is `const argv = CCD_ARGV.wsRelease(run.sessionId);`; the `} else if (final) {` arm; the `} else {` non-final arm)
- Modify: `server/src/coord/routes.ts` (`function sendCloseOutcome(reply: FastifyReply, r: CloseOutcome) {`, line `if (r.ok) return reply.code(200).send({ ok: true, id: r.id, state: r.state });`)
- Test: `server/test/coord-abandon.test.ts`, `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: `openRunsForSession` (202), `releaseIsSafe` (203), `holdReason(…, runId)` (204).
- Produces: `CloseOutcome`'s ok arm becomes `{ ok: true; id: number; state: 'done' | 'failed'; released: boolean }`, and the close/abandon route's 200 body gains `released`.

**What `released` answers, exactly ONE question:** *is the workspace's claim gone as a result of
this close?* It is `true` only after a `ws-release` that actually succeeded. On every re-holding
arm it is `false`. A non-final close never asks for a release, so its `false` is ordinary and not a
signal; the abandon route and a `final:true` close DO ask, so their `false` means **a sibling open
run still names this session and the claim was re-held with the surviving run's reason.**

**Which sibling's reason?** `openRunsForSession` returns `ORDER BY id`; the survivor is the
**last** element — the most recently opened run. The coordinator protocol opens the successor
before closing the predecessor, so the newest open run is the claim that is live going forward.
With the ordinary one-sibling case this is a distinction without a difference; it is written down
because two siblings must produce a deterministic reason or the test is a coin toss.

**D-48's ordering is preserved EXACTLY**: the fleet act stays AHEAD of the transition commit, so a
failed re-hold leaves the run retryable rather than wedged terminal.

- [ ] **Step 1: Write the failing test**

In `server/test/coord-abandon.test.ts`, add a fixture helper beside `wedged` and three tests. The
two-open-run case is **unreachable from live state** (measured: zero holds fleet-wide, all seven
merged workspaces already archived), so it needs a constructed fixture — budget it here, nobody
will trip over it by accident.

```ts
/** A SECOND open run naming the same session — the state the coordinator
 *  protocol deliberately creates (open wave N+1 BEFORE closing wave N) and
 *  which no fixture in this tree had before Wave 2. */
const sibling = (coord: CoordStore, sessionId: string, wave: number, program = 'build4'): number => {
  const opened = coord.openRun({
    program, title: 'Fleet controls', project: PROJECT, wave, waveOf: 3, claimedBy: CLAIMED_BY,
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  coord.setSession(opened.id, sessionId);
  return opened.id;
};
```

```ts
  it('abandoning ONE of two open runs re-holds with the SIBLING reason — it does not release', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-two`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const other = sibling(w.coord, sessionId, 2);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    // The abandoned run still transitions — the workspace just stays claimed.
    expect(res.json()).toMatchObject({ ok: true, state: 'failed', released: false });
    expect(w.coord.run(id)!.state).toBe('failed');
    expect(calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${other}`]);
  });

  it('with no sibling it still releases, and says so', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-lone`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const res = await postAbandon(app, id);
    expect(res.json()).toMatchObject({ ok: true, released: true });
    expect(calls).toContainEqual(['ws-release', '--session', sessionId]);
  });

  it('a CLOSED sibling is not a sibling — a done run cannot keep a workspace claimed forever', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-closedsib`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const other = sibling(w.coord, sessionId, 2);
    w.coord.advance(other, 'dispatched', 'coordinator');
    w.coord.advance(other, 'closing', 'coordinator');
    w.coord.advance(other, 'done', 'coordinator');
    const res = await postAbandon(app, id);
    expect(res.json()).toMatchObject({ ok: true, released: true });
    expect(calls).toContainEqual(['ws-release', '--session', sessionId]);
  });

  it('a FAILED re-hold leaves the run RETRYABLE — the fleet act stays ahead of the commit (D-48)', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner({ fail: new Set(['ws-hold']) });
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-rehold-fail`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    sibling(w.coord, sessionId, 2);
    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(502);
    expect(w.coord.run(id)!.state).toBe('dispatched');   // UNCHANGED
  });
```

`CoordStore` is already imported in this file. Add to `server/test/run-routes.test.ts`, beside the
two close tests already there:

```ts
  it('final:true with a sibling open re-holds with the SIBLING reason and answers released:false', async () => {
    const sessionId = `${PROJECT}-close-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'MERGED')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 2, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'done', released: false });
    expect(coord.run(id)!.state).toBe('done');
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${next.id}`]);
  });

  it('the non-final arm re-holds with the SURVIVING run, never with its own next wave', async () => {
    // Today it re-holds `holdReason(program, wave+1, waveOf)` from its OWN
    // row, silently rewriting the live run's claim whenever the two rows
    // disagree. With a sibling open, the surviving run's reason wins.
    const sessionId = `${PROJECT}-close-nonfinal-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 4, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, released: false });
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:4/3 run:${next.id}`]);
    expect(calls).not.toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', 'program:build4 wave:2/3']);
  });
```

Also update the two shipped close tests to assert the new field:
`it('releases the hold on the final wave and archives NOTHING itself', …)` gains
`expect(res.json()).toMatchObject({ released: true });`, and
`it('updates the hold reason to the next wave otherwise', …)` gains
`expect(res.json()).toMatchObject({ released: false });`.

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts test/run-routes.test.ts
```

Expected: every new `released` assertion fails with *"expected { ok: true, id: N, state: 'failed' }
to match object { released: false }"*, and the sibling tests fail on `ws-release` having been
called.

- [ ] **Step 3: Write minimal implementation**

`server/src/coord/close.ts` — the ok arm of `CloseOutcome`:

```ts
export type CloseOutcome =
  | { ok: true; id: number; state: 'done' | 'failed';
      /** Is the workspace's claim GONE as a result of this close? `true` only
       *  after a `ws-release` that actually succeeded. `false` on every arm
       *  that re-held — which, for an ABANDON or a `final:true` close, means
       *  a SIBLING open run still names this session and the claim was
       *  re-held with the surviving run's reason. A non-final close never
       *  asks for a release, so its `false` is ordinary. */
      released: boolean }
```

Add the imports and one shared helper near the top of `closeRun`'s body, above the abandon arm:

```ts
import { HANDOFF_SHA, holdReason, queueSystemMail, releaseIsSafe } from './rundefs.js';
import { type AdvanceResult, type CoordStore, type OpenSibling } from './store.js';
```

```ts
  /** The OTHER open runs on this workspace. Read fresh at the decision point,
   *  never cached: a snapshot consulted at a destructive decision point is
   *  the shape `watch.ts` already had to fix once. The closing run excludes
   *  itself — it has not transitioned yet (D-48 puts the fleet act first). */
  const siblingsOf = (sessionId: string): OpenSibling[] => coord.openRunsForSession(sessionId, id);
  /** The claim that survives this close: the MOST RECENTLY opened run, because
   *  the coordinator protocol opens wave N+1 before closing wave N. */
  const survivorOf = (s: readonly OpenSibling[]): OpenSibling | null => s[s.length - 1] ?? null;
```

Abandon arm — replace the `if (run.sessionId !== null) { … }` block and the arm's return:

```ts
    // The fleet act, AHEAD of the commit (D-48), and only when there is
    // something to act on: a `planned` run that never dispatched holds no
    // workspace. RELEASE ONLY WHEN NOTHING ELSE CLAIMS IT — otherwise HAND
    // THE CLAIM OVER by re-holding with the surviving run's own reason. The
    // abandoned run still transitions either way; the workspace stays
    // claimed. Never `wsArchive` on this arm (D-280 (was D-B4-7)).
    let released = false;
    if (run.sessionId !== null) {
      const siblings = siblingsOf(run.sessionId);
      const survivor = survivorOf(siblings);
      const argv = releaseIsSafe(siblings) || survivor === null
        ? CCD_ARGV.wsRelease(run.sessionId)
        : CCD_ARGV.wsHold(run.sessionId,
            holdReason(survivor.program, survivor.wave, survivor.waveOf, survivor.id));
      if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
      const res = await deps.runCcd(argv);
      if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
      released = releaseIsSafe(siblings);
    }
    const closed = coord.closeRun({
      runId: id, finalState: 'failed', causedBy, handoffCommit: null,
      program: run.program, viaClosing: target === 'closing',
    });
    if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
    return { ok: true, id, state: 'failed', released };
```

Step 3's fleet-act block — replace the `} else if (final) {` and `} else {` arms (the
`state === 'failed' && archive` arm is Task 206's; leave it exactly as shipped in this commit) and
declare `released` above the `if`:

```ts
  const siblings = siblingsOf(run.sessionId);
  const survivor = survivorOf(siblings);
  const safe = releaseIsSafe(siblings);
  let released = false;
  if (state === 'failed' && archive) {
    const argv = CCD_ARGV.wsArchive(run.sessionId);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  } else if (final && safe) {
    const argv = CCD_ARGV.wsRelease(run.sessionId);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    released = true;
  } else {
    // TWO cases land here, and the reason they share an arm is that they need
    // the same act with a different reason string:
    //   - the ordinary NON-FINAL close, no sibling: claim the workspace for
    //     wave N+1, whose run does not exist yet — hence `null` for the run
    //     id, and the string is byte-identical to what shipped;
    //   - ANY close, final or not, with a SIBLING still open: the surviving
    //     run's own reason wins. Today the non-final arm writes its OWN row's
    //     `wave + 1` unconditionally, silently rewriting the live run's claim
    //     whenever the two rows disagree.
    const nextReason = survivor === null
      ? holdReason(run.program, run.wave + 1, run.waveOf, null)
      : holdReason(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    const argv = CCD_ARGV.wsHold(run.sessionId, nextReason);
    if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
    const res = await deps.runCcd(argv);
    if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
  }
```

and the function's final return:

```ts
  return { ok: true, id, state, released };
```

`server/src/coord/routes.ts` — `sendCloseOutcome`'s ok line:

```ts
  if (r.ok) return reply.code(200).send({ ok: true, id: r.id, state: r.state, released: r.released });
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts test/run-routes.test.ts test/coord-decide.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/close.ts server/src/coord/routes.ts server/test/coord-abandon.test.ts server/test/run-routes.test.ts
git commit -m "fix(coord): closeRun hands a claim over instead of releasing a live one, and says which it did (released)"
```

---

### Task 206: the fourth fleet act — `state === 'failed' && archive`

**Files:**
- Modify: `server/src/coord/close.ts` (`if (state === 'failed' && archive) {`, whose own comment calls it "the ONE explicit `wsArchive` call in the whole coordination lane")
- Test: `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: `siblingsOf`/`survivorOf`/`releaseIsSafe` as introduced in Task 205.
- Produces: no new type. The arm becomes gated; `released` stays `false` on it.

**Why this is its own task and not folded into 205.** Tasks 205's three arms all answer "release or
hand over?". This one answers a *different* question — "may this close DESTROY-ish the workspace at
all?" — and its ruling is new: **when a sibling is open, do not archive; re-hold with the
survivor's reason and let the run still transition to `failed`.** A reviewer could accept 205 and
reject this shape (preferring, say, a new refusal code). Splitting is what lets them.

**The harm it closes.** `ws-archive` has no hold rung in ccd — deliberately, so a by-hand archive
of a held workspace still works. So closing run A as failed-with-archive while sibling run B is
open **archives B's workspace and leaves B's `.hold` standing over it**: F9's harm through a
different door, in the exact function Task 205 rewrites. Gating three arms and leaving this one is
closing three doors in a four-door room.

**The cost, stated:** the operator asked for an archive and did not get one. The signal is
`released: false` plus the run's own `failed` state; the corrective act is the same one every other
arm implies — close the sibling first. It is not silent, and it is recoverable
(`POST /api/sessions/:id/archive` with `{force:true}`, Task 208).

- [ ] **Step 1: Write the failing test**

In `server/test/run-routes.test.ts`, beside
`it('archives on explicit abandon (state:failed, archive:true) — the only wsArchive call in the lane', …)`:

```ts
  it('failed+archive with a SIBLING open archives NOTHING and re-holds — the fourth fleet act, gated', async () => {
    // `ws-archive` has no hold rung in ccd (by design: a by-hand archive of a
    // held workspace must still work), so an ungated arm here archives the
    // SIBLING's workspace and leaves the sibling's `.hold` standing over it —
    // F9's harm through a different door, in the function Wave 2 rewrites.
    const sessionId = `${PROJECT}-close-arch-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 2, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id,
      { fingerprint: GOOD_CLAIM, final: true, state: 'failed', archive: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'failed', released: false });
    // The run still transitions — the WORKSPACE is what is protected.
    expect(coord.run(id)!.state).toBe('failed');
    expect(calls.some((c) => c[0] === 'ws-archive')).toBe(false);
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${next.id}`]);
  });

  it('failed+archive with NO sibling still archives — the arm is gated, not deleted', async () => {
    const sessionId = `${PROJECT}-close-arch-lone`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const res = await postClose(app!, id,
      { fingerprint: GOOD_CLAIM, final: true, state: 'failed', archive: true });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', sessionId]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
```

Expected: the first test fails on `expect(calls.some((c) => c[0] === 'ws-archive')).toBe(false)` —
*"expected true to be false"*. The second already passes (it is the mutation guard: it goes red if
the gate is written as an unconditional refusal instead of a sibling check).

- [ ] **Step 3: Write minimal implementation**

In `server/src/coord/close.ts`, replace the `if (state === 'failed' && archive) {` arm's condition
and add the fall-through, so the archive is gated on the SAME question as the release:

```ts
  // 3: the fleet act — AHEAD of the transition commit (deviation D-48). It
  // is a RELEASE (D-5), never an autonomous archive. `state:'failed'` with
  // `archive:true` is the ONE explicit `wsArchive` call in the whole
  // coordination lane — and, Wave 2, IT IS GATED ON THE SAME SIBLING CHECK
  // as the release. `ws-archive` has no hold rung in ccd (deliberately: a
  // by-hand archive of a held workspace must still work), so an ungated arm
  // here archives a SIBLING run's workspace and leaves that sibling's
  // `.hold` standing over it — F9's harm through a different door. When a
  // sibling is open the archive does not happen, the claim is handed to the
  // survivor, the run still transitions to `failed`, and `released:false` is
  // the signal. The operator's own hands can still force it:
  // `POST /api/sessions/:id/archive` with `{force:true}`.
  if (state === 'failed' && archive && safe) {
```

The `} else if (final && safe) {` and `} else {` arms are unchanged from Task 205 — a
failed-with-archive close **with** a sibling now falls through to the re-hold arm, which is exactly
the behaviour the test pins (`final` is `true` there, but `safe` is false, so the `else` runs).

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coord-abandon.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/coord/close.ts server/test/run-routes.test.ts
git commit -m "fix(coord): gate the fourth fleet act — failed+archive no longer archives out from under an open sibling"
```

---

### Task 207: `archiveMerged` stops archiving under an open run

**Files:**
- Modify: `server/src/watch.ts` (`private async archiveMerged(records: SessionRecord[]): Promise<void> {` — the rung goes after `const safety = await this.archiveSafety(r.id);` and its `if (safety.held !== null) { … }` block, before `if (safety.verdict !== 'ok') continue;`)
- Test: `server/test/hold-gate.test.ts`, `server/test/pr-sweep.test.ts`

**Interfaces:**
- Consumes: `openRunsForSession` (Task 202).
- Produces: no new type. `FleetWatcher.archiveMerged` gains a third rung.

**THIS RUNG IS WHAT MAKES THE SURFACE SAFE RATHER THAN MERELY SAFER.** An ABSENT hold is no longer
sufficient to archive, so release-then-crash (the hold gone, the run still open, D-48 protecting the
run but not the workspace) and the archive-vs-hold race both **stop mattering** — the sweep now asks
the authoritative question instead of reading a file that cannot answer it.

**`this.deps.coord?.` — the `?.` is load-bearing, not style.** `server/test/helpers.ts`'s `testDeps`
returns `{ cfg, runCcd, tmux, io, queue }` and supplies **no** `coord`; `hold-gate.test.ts` builds
every watcher from it. A non-optional call TypeErrors all fourteen tests there plus `pr-sweep`'s
archive tests. Pin the optional path with its OWN named test so a future non-optional call reds one
named test instead of fourteen unrelated ones.

**NO CACHE.** Measured N here is **0** rows reaching the query per sweep on the live fleet. A
per-tick cache is also slower than the index (benchmarked at 10k rows: indexed 0.27 ms vs cached
1.16 ms) and, decisively, a snapshot consulted at a destructive decision point is the exact shape
the comment two rungs up already fixed once ("The FRESH answer, at the decision point").

- [ ] **Step 1: Write the failing test**

In `server/test/hold-gate.test.ts`, add a `CoordStore` import and three tests:

```ts
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

/** A coord store with one OPEN run naming `id`, and NO hold on disk — the
 *  release-then-crash shape, and the hand-created-workspace-adopted-into-a-run
 *  shape, in one fixture. */
const coordWithOpenRun = (home: string, id: string): CoordStore => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 2, waveOf: 3,
    claimedBy: 'ccrc-pwa-coordinator' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, id);
  return coord;
};

describe('archiveMerged — and an OPEN RUN, even with no hold', () => {
  it('does not archive a merged workspace an open run names, though the hold is ABSENT', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    // NO `hold(...)` call: this is release-then-crash, and the whole point of
    // the rung is that an absent hold is no longer sufficient.
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = {
      ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify } as never,
      coord: coordWithOpenRun(home, 'demo-quiet-basin'),
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    for (let i = 0; i < 3; i++) { forceDue(w); await w.tick(); await sweepSettled(w); }
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // Same shape of notification `notifyHeldMerged` already sends, and it
    // NAMES the run — a silent skip would be the defect one door over.
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0]![0].body).toContain('nothing archived');
    expect(notify.mock.calls[0]![0].body).toMatch(/run \d+/);
    w.stop();
  });

  it('archives again once that run closes — the level re-arms on the RUN now, not on the hold', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const coord = coordWithOpenRun(home, 'demo-quiet-basin');
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), coord };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick(); await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);

    const openId = coord.runs()[0]!.id;
    coord.advance(openId, 'dispatched', 'coordinator');
    coord.advance(openId, 'closing', 'coordinator');
    coord.advance(openId, 'done', 'coordinator');
    forceDue(w); await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    w.stop();
  });

  it('a watcher with NO coord still archives — `deps.coord` is optional and that is load-bearing', async () => {
    // `testDeps` supplies no `coord`; fourteen tests in this file and every
    // archive test in `pr-sweep.test.ts` build their watchers from it. This
    // test exists so a future NON-optional `this.deps.coord.openRunsForSession`
    // reds ONE named test instead of fourteen unrelated ones.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    w.stop();
  });
});
```

And in `server/test/pr-sweep.test.ts`, one test in its archive describe — the same property from a
DIFFERENT harness, because `pr-sweep.test.ts` is the file whose archive path this rung actually
changes in production:

```ts
  it('does not archive a merged workspace an OPEN RUN names, even with no hold at all', () => {
    // THE WHOLE POINT OF THE RUNG, and the reason an absent hold stopped being
    // sufficient: release-then-crash and the archive-vs-hold race both leave a
    // live wave's workspace unheld for a window, and this sweep is destructive.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    // NO hold is planted, deliberately.
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build4', title: 't', project: 'demo',
      wave: 2, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, 'demo-quiet-basin');

    const calls: string[][] = [];
    const w = new FleetWatcher(
      { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), coord } as never,
      new Bus(), 10_000);
    return (async () => {
      await w.tick();
      await sweepSettled(w);
      expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
      w.stop();
    })();
  });
```

(`seed`, `liveIdle`, `runnerFor`, `mergedLine` and `sweepSettled` are `pr-sweep.test.ts`'s own
helpers — it shares the harness `hold-gate.test.ts` was copied from, per that file's header comment.
Add `CoordStore`, `openCoordDb` and `path` to its imports.)

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
```

Expected: the first test fails with `expect(calls.filter(…)).toEqual([])` receiving
`[['ws-archive','--session','demo-quiet-basin']]`; the second fails on the first assertion for the
same reason. The third already passes (mutation guard).

- [ ] **Step 3: Write minimal implementation**

In `server/src/watch.ts`, inside `archiveMerged`, immediately after the `safety.held` block and
before `if (safety.verdict !== 'ok') continue;`:

```ts
      // THE THIRD RUNG (Wave 2), and it is what makes this surface SAFE
      // rather than merely safer: an ABSENT hold is no longer sufficient to
      // archive. `coord.db` is the authority on "whose claim is this?" — the
      // hold file is one path keyed on a session id whose reason string is
      // display-only and parsed back nowhere. Release-then-crash (hold gone,
      // run still open) and the archive-vs-hold race both stop mattering
      // here, because the sweep now asks the authoritative question.
      //
      // `?.` IS LOAD-BEARING: `test/helpers.ts`'s `testDeps` supplies no
      // `coord`, and every archive test in `hold-gate.test.ts` and
      // `pr-sweep.test.ts` builds its watcher from it. A non-optional call
      // TypeErrors fourteen tests that have nothing to do with runs.
      //
      // NO CACHE, for the reason the rung two above already states in its own
      // words: a snapshot consulted at a destructive decision point is the
      // shape this function had to fix once. Measured N reaching this query
      // on the live fleet: 0 rows per sweep.
      const openRuns = this.deps.coord?.openRunsForSession(r.id) ?? [];
      if (openRuns.length > 0) {
        const s = openRuns[openRuns.length - 1]!;
        this.notifyHeldMerged(r, pr.number,
          `run ${s.id} is still open — ${s.program} wave ${s.wave}${s.waveOf === null ? '' : `/${s.waveOf}`}`);
        continue;
      }
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/pr-sweep.test.ts
```

`pr-sweep` is a KNOWN LOAD FLAKE — re-run it in isolation before calling a red a real break.

- [ ] **Step 5: Commit**

```
git add server/src/watch.ts server/test/hold-gate.test.ts server/test/pr-sweep.test.ts
git commit -m "fix(watch): archiveMerged asks coord.db, not the hold file — an absent hold no longer licenses an archive"
```

---

### Task 208: `POST /api/sessions/:id/archive` refuses `409 run-open`, and takes `{force:true}`

**Files:**
- Modify: `server/src/server.ts` (`app.post('/api/sessions/:id/archive', async (req, reply) => {` — today it reads no body, holds no `deps.coord` reference, and runs outside `coordMutex`)
- Test: `server/test/routes.test.ts`

**Interfaces:**
- Consumes: `openRunsForSession` (Task 202).
- Produces: `409 { ok: false, error: 'run-open', runs: [{ id, program, wave, waveOf }] }`; the route accepts `{ force: true }` to proceed.

**Not a hard refusal — that would be a policy reversal.** `README.md`'s holds section explicitly
blesses archiving a held workspace by hand ("manual archive/restore — a merged-but-held workspace
can still be archived by hand from the PR sheet, which is why that sheet names the hold instead of
promising a sweep that will never come") and the PWA advertises it. The operator's own hands stay
able to do it; they just have to mean it.

**THE `coordMutex` DECISION, made explicitly here as the task requires: NO.** `coordMutex` is
instantiated INSIDE `registerCoordRoutes` (`const coordMutex = new CoordMutex();`), deliberately one
instance per server rather than a module-level singleton, and `server.ts` has no handle on it.
Reaching one out would widen the coordination chokepoint's surface to a route that is not a
coordination write. What the two paths actually need:

- The **unforced** path is a synchronous read followed by a refusal in the same tick of a
  single-threaded event loop, so no lock can make it more current than it already is.
- The **forced** path can race an in-flight dispatch or close, and this task does not close that
  race. That is stated in the route's own comment, not buried: a forced archive is the operator
  overriding a refusal they have just read, which is exactly the ceremony that makes the race
  acceptable. If a future build wants it serialised, the change is to have `registerCoordRoutes`
  RETURN its mutex — write that down rather than re-deriving it.

**No box token.** This route carries none today and gains none: adding a coordination *refusal* is
not the same as making it a coordination *write*, and its existing tokenless reachability from the
PWA is precisely what README blesses. `requireMailToken` is not in scope in `server.ts` for this
route and must not be introduced here.

**Route-completeness scan:** `coordinator-skill.test.ts`'s scan is scoped to
`server/src/coord/routes.ts`; this route is outside it. Confirm that when it lands (Step 4 runs the
suite).

- [ ] **Step 1: Write the failing test**

In `server/test/routes.test.ts` (which already builds a server from `testDeps`), add:

```ts
describe('POST /api/sessions/:id/archive — and an open run', () => {
  const withCoord = async (home: string, run: Runner, sessionId: string) => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 2, waveOf: 3,
      claimedBy: 'ccrc-pwa-coordinator' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, sessionId);
    const app = await buildServer({ ...testDeps(home, run), coord });
    return { app, coord, runId: opened.id };
  };

  /** `seedSession` in this file takes (home, id, wrapper) and returns NOTHING —
   *  it seeds into a home the caller already made. And there is no `recording`
   *  helper: the file's runner doubles are built inline. Both are written out
   *  here rather than assumed. */
  const seededHome = (id: string): string => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, id, 'claude2');
    return home;
  };
  const recording = (calls: string[][]): Runner => async (_cmd, args) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };

  it('refuses 409 run-open, NAMING the run ids — never a bare slug', async () => {
    const home = seededHome('demo-claimed');
    const calls: string[][] = [];
    const { app, runId } = await withCoord(home, recording(calls), 'demo-claimed');
    const res = await app.inject({ method: 'POST', url: '/api/sessions/demo-claimed/archive' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'run-open',
      runs: [{ id: runId, program: 'build4', wave: 2, waveOf: 3 }],
    });
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    await app.close();
  });

  it('proceeds on {force:true} — the operator\'s own hands stay able to do it', async () => {
    const home = seededHome('demo-claimed');
    const calls: string[][] = [];
    const { app } = await withCoord(home, recording(calls), 'demo-claimed');
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/demo-claimed/archive', payload: { force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-claimed']);
    await app.close();
  });

  it('is unchanged when no run names the session, and when the server has no coord at all', async () => {
    // The `?.` path: `testDeps` supplies no `coord`, which is every other
    // test in this file. An archive must not become impossible on a server
    // with coordination switched off.
    const home = seededHome('demo-free');
    const calls: string[][] = [];
    const app = await buildServer(testDeps(home, recording(calls)));
    const res = await app.inject({ method: 'POST', url: '/api/sessions/demo-free/archive' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-free']);
    await app.close();
  });
});
```

`seedSession`, `seedRoster`, `mkTmp`, `testDeps` and `buildServer` are already imported by this
file; `Runner` may not be — add it from `../src/exec.js` along with `CoordStore`
(`../src/coord/store.js`) and `openCoordDb` (`../src/coord/db.js`).

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/routes.test.ts
```

Expected: the first test fails with `expected 200 to be 409`; the second and third already pass
(they are the mutation guards — a gate written as "refuse whenever coord exists" reds the third, and
one that ignores `force` reds the second).

- [ ] **Step 3: Write minimal implementation**

Replace the body of the archive route in `server/src/server.ts`:

```ts
  /**
   * The by-hand archive — one tap in the PWA's PR sheet and one in the
   * session actions sheet.
   *
   * WAVE 2: it now knows about coordination, because `ws-archive` has no hold
   * rung in ccd (deliberately: this route is the reason) and `archiveMerged`'s
   * own gate cannot help a request that never goes through it. An open run
   * naming this session is refused `409 run-open`, NAMING the runs so the
   * client can render a sentence rather than a slug.
   *
   * NOT a hard refusal — that would reverse a stated policy: README's holds
   * section blesses archiving a held workspace by hand, and this sheet is
   * where it says to do it. `{force:true}` proceeds. The operator's own hands
   * stay able to do it; they just have to mean it.
   *
   * NO `coordMutex`, decided rather than defaulted: the mutex is instantiated
   * INSIDE `registerCoordRoutes` (one per server, deliberately not a module
   * singleton) and this file holds no handle on it. The refusal path is a
   * SYNCHRONOUS read and a reply in the same tick, so no lock could make it
   * more current. The FORCED path CAN race an in-flight dispatch or close,
   * and this build does not close that race — a forced archive is an operator
   * overriding a refusal they have just read. If that is ever judged too
   * loose, the change is to have `registerCoordRoutes` return its mutex.
   *
   * NO box token, also decided: this route carries none today, and adding a
   * coordination REFUSAL is not the same as making it a coordination WRITE.
   * Its tokenless reachability from the phone is exactly what README blesses.
   */
  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { force?: unknown };
    if (body.force !== true) {
      // `?.` — a server with coordination switched off archives exactly as it
      // did before this wave.
      const runs = deps.coord?.openRunsForSession(id) ?? [];
      if (runs.length > 0) return reply.code(409).send({ ok: false, error: 'run-open', runs });
    }
    const argv = CCD_ARGV.wsArchive(id);
    // `ws-archive` is the SAME verb generation as `ws-audit` and `ws-reap` —
    // all four were added by this branch and all four sit consecutively in
    // `ccd caps` — so a fleet host on an older ccd dies in the verb's own
    // usage check, and `runCcdOr502` renders that as a bare 502 "the archive
    // failed". Same 501 body as every sibling, so the client can tell
    // "this host cannot" from "it tried and could not".
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });
```

The `run-open` refusal is placed BEFORE the `verbSupported` check on purpose: a claimed workspace
should be refused as claimed even on a host whose ccd predates the verb — the claim is the more
specific fact.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/routes.test.ts test/coordinator-skill.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/server.ts server/test/routes.test.ts
git commit -m "feat(api): the by-hand archive refuses 409 run-open by name, and {force:true} still means yes"
```

---

### Task 209: ccd — `cmd_ws_release`'s comment is now false (AGENT-FIRST)

**Files:**
- Modify: `ccd/ccd` (`cmd_ws_release() {   # ccd ws-release --session <id> — end the program's claim.` and its next two comment lines, currently `# After this, the very next archiveMerged sweep may archive a merged` / `# workspace — the level re-arms itself, no edge to miss. Idempotent.`)
- Test: `server/test/ccd-hold.test.ts`, `server/test/ownership.test.ts`

**Interfaces:**
- Consumes: Task 207's rung (the fact the comment must now describe).
- Produces: no code change of any kind — the verb's behaviour is byte-identical.

**This one line is why Wave 2 is agent-first.** After Task 207's rung an absent hold is no longer
sufficient to archive, so a by-hand `ws-release` does **not** re-arm the sweep while a run is open.
Do not knowingly leave a false comment on the box.

**GATE 1 — the provenance re-stamp rides in THIS commit.** One byte changed in `ccd/ccd` reds
`server/test/ownership.test.ts`, comment edits included. The command (from that file's own note):

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

`markGenerated` is idempotent, so it is safe whether or not the file is already stamped.

- [ ] **Step 1: Write the failing test**

In `server/test/ccd-hold.test.ts`, add a text pin (this file already reads `ccd/ccd` through the
`CCD` constant from `ccdWsHelpers.js`; if it does not, import it):

```ts
describe('cmd_ws_release: what the comment promises', () => {
  const src = readFileSync(CCD, 'utf8');
  const fn = src.slice(src.indexOf('cmd_ws_release() {'),
                       src.indexOf('cmd_ws_release() {') + 1200);

  it('no longer promises the sweep re-arms itself with no edge to miss', () => {
    // TRUE until Wave 2's `archiveMerged` rung: an ABSENT hold is no longer
    // sufficient to archive, so a by-hand release does NOT re-arm the sweep
    // while a run is open. A false comment on the box is worse than none.
    expect(fn).not.toMatch(/the level re-arms itself, no edge to miss/);
  });

  it('names the OTHER gate a release does not clear', () => {
    expect(fn).toMatch(/open run/i);
  });

  it('changes nothing about the verb: still idempotent, still fail-shut on rm', () => {
    expect(fn).toMatch(/Idempotent/);
    expect(fn).toMatch(/it is STILL held/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-hold.test.ts
```

Expected: the first two fail — `expected '…the level re-arms itself, no edge to miss…' not to
match` and `expected … to match /open run/i`.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, replace the two comment lines under `cmd_ws_release() {`:

```bash
cmd_ws_release() {   # ccd ws-release --session <id> — end the program's claim.
  # A release ends THIS file's claim and nothing else. It does NOT necessarily
  # re-arm the auto-archive sweep: since Build 8 Wave 2, `archiveMerged` also
  # asks the server's coord.db whether an OPEN RUN still names this session,
  # and skips if one does — an absent hold is no longer sufficient. Idempotent.
```

Then re-stamp in the same edit, before committing:

```
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-hold.test.ts test/ownership.test.ts
```

`ownership.test.ts` must be GREEN in this same commit — if it reds with *"ccd/ccd was edited without
re-stamping its provenance marker"*, run the re-stamp above and amend before committing.

- [ ] **Step 5: Commit**

```
git add ccd/ccd server/test/ccd-hold.test.ts
git commit -m "docs(ccd): a release no longer re-arms the sweep on its own — the run is the other gate (re-stamped)"
```

---

### Task 210: the README's holds section says what the gate now is

**Files:**
- Modify: `README.md` (the `### Workspace holds & programs` section — from its own `###` heading to the next `## `)
- Test: `server/test/readme-holds.test.ts`

**Interfaces:**
- Consumes: Tasks 207 and 208 (the two things the section must now describe).
- Produces: prose only.

**The rewrite MUST keep the tokens `readme-holds.test.ts` requires**, or the failure message points
at the README and not at your diff: `ws-rm`, `ws-reap`, `` `held === null` ``,
`merged **and unheld**`, `bad-request`, `whitespace-only`; and it must NOT contain
`one thing a hold changes` or `` gains `held !== null` `` or
`on both the client and ccd itself, with the identical sentence`.

**Correct C5 in the same pass.** The section says *"A hold has exactly two consumers"* and then
names three in the next paragraph. The code has **four** ccd rungs — `cmd_ws_rm` (`ccd:1496`),
`cmd_ws_release` (`:2023`), `cmd_ws_reap` (`:5230`), `cmd_forget` (`:8473`), all four spelled
`[[ -e "$REG/$id.hold" ]]` — plus `archiveMerged`, plus every PWA display. `forget` appears nowhere
in the README today.

- [ ] **Step 1: Write the failing test**

Add to `server/test/readme-holds.test.ts`, inside `describe('README: workspace holds', …)`:

```ts
  it('does not undercount the consumers — ccd alone has four rungs', () => {
    const section = holdsSection();
    expect(section).not.toMatch(/exactly two consumers/);
    // All four ccd rungs are real, right now, and each is `-e` (an unreadable
    // hold refuses too).
    expect((ccd.match(/\[\[ -e "\$REG\/\$id\.hold" \]\]/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(section).toMatch(/forget/);
  });

  it('states the archive gate as it now is: an absent hold is NOT sufficient', () => {
    const section = holdsSection();
    // Wave 2 — `archiveMerged` also asks coord.db, and the by-hand route
    // refuses `run-open`. A section that still says a release re-arms the
    // sweep is describing a build that no longer exists.
    expect(section).toMatch(/open run/i);
    expect(section).toMatch(/run-open/);
    expect(section).toMatch(/force/i);
    // Grounded in the code, not merely asserted in prose.
    const watchTs = readFileSync(path.join(root, 'server', 'src', 'watch.ts'), 'utf8');
    expect(watchTs).toMatch(/openRunsForSession/);
    const serverTs = readFileSync(path.join(root, 'server', 'src', 'server.ts'), 'utf8');
    expect(serverTs).toMatch(/'run-open'/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
```

Expected: `expected '…A hold has exactly two consumers…' not to match /exactly two consumers/`, and
the second test failing on `/open run/i`.

- [ ] **Step 3: Write minimal implementation**

Replace the section's second paragraph in `README.md` (keeping the first paragraph, which is still
true, and keeping every required token):

```markdown
A hold has more consumers than any one paragraph used to admit: **four rungs in
ccd** — `ws-rm` and `ws-reap` refuse, `ws-release` removes, and `forget` refuses
— plus the archive sweep, plus every place the PWA renders the reason. All four
ccd rungs test `-e`, so an *unreadable* hold refuses too.

`archiveMerged`'s auto-archive gate is *merged **and unheld*** — `held === null`
is the conjunct — so a workspace idle between two waves of the same program
reads as claimed, not finished, and survives a sweep even after its PR merges.
The hold is re-read from the registry at the archive decision point, not taken
from the snapshot the sweep opened with, so a hold placed *during* a sweep still
lands. **Since Build 8, an absent hold is no longer sufficient**: the sweep also
asks the server's `coord.db` whether an OPEN RUN still names the session, and
skips if one does. That is what makes release-then-crash and the
archive-vs-hold race stop mattering — the sweep asks the authoritative
question, not a file that cannot answer it. The reason string is still
display-only and parsed back nowhere; it merely gained a `run:<id>` so a human
reading `~/.cc-sessions` can tell whose claim it is.

Destroying a workspace a program declared mid-flight takes two deliberate acts,
never one — `ws-rm` dies with `held: <reason> — release first`, `ws-reap`
answers `{"refused":"held"}`, and the cleanup sheet renders that as "A program
has this workspace held — it is mid-flight, so nothing was removed." Release
first, then clean up. An empty *or whitespace-only* reason refuses in all three
layers — the composer and `ccd ws-hold` share one sentence (`empty reason — say
which program holds this`), while the route answers a bare 400 `bad-request`,
which is what a non-PWA client sees.

Unchanged: the bucket ladder and `ws-archive` itself. **Manual archive still
works, and still means yes** — a merged-but-held workspace can be archived by
hand from the PR sheet, which is why that sheet names the hold instead of
promising a sweep that will never come. What changed is that the route now
answers `409 run-open`, naming the runs, when a run still claims the workspace;
the sheet renders that and offers **Archive anyway**, which sends `force`. The
operator's own hands stay able to do it; they just have to mean it. See
[`docs/superpowers/programs/TEMPLATE.md`](docs/superpowers/programs/TEMPLATE.md)
for the wave-handoff ledger a program keeps beside its hold.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
```

- [ ] **Step 5: Commit**

```
git add README.md server/test/readme-holds.test.ts
git commit -m "docs(readme): the archive gate is the RUN now, and a hold never had only two consumers"
```

---

### Task 211: `api.archive` learns to mean it

**Files:**
- Modify: `pwa/src/lib/api.ts` (`archive: (id: string) => post(`${sid(id)}/archive`),`)
- Test: `pwa/test/api.test.ts`

**Interfaces:**
- Consumes: Task 208's route.
- Produces: `archive: (id: string, opts?: { force?: boolean }) => Promise<void>`.

The unforced call must stay **byte-identical on the wire** — `post` sends no `content-type` and no
body when `body === undefined`, and every existing caller passes one argument.

- [ ] **Step 1: Write the failing test**

In `pwa/test/api.test.ts`:

```ts
  it('archive(id) posts NO body — byte-identical to what shipped', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x');
    expect(calls[0]![0]).toBe('/api/sessions/demo-x/archive');
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });

  it('archive(id, {force:true}) posts {force:true} as JSON', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', { force: true });
    expect(calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
  });

  it('archive(id, {force:false}) is the UNFORCED call — never a body that says no', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', { force: false });
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
```

Expected: the second test fails — `expected { method: 'POST' } to match object { headers: … }`.

- [ ] **Step 3: Write minimal implementation**

```ts
    /** `{force:true}` ONLY when it is true — `opts?.force === false` and an
     *  absent `opts` both send the byte-identical unforced request the route
     *  has always taken (no `content-type`, no body). The force flag is not a
     *  checkbox anywhere in the UI: it is a SECOND tap, made after the
     *  operator has read the `409 run-open` refusal, because the refusal is
     *  the whole information. See `ArchiveConflictSheet`. */
    archive: (id: string, opts?: { force?: boolean }) =>
      post(`${sid(id)}/archive`, opts?.force === true ? { force: true } : undefined),
```

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
cd pwa && npm run build
```

The build is not optional here — `pwa/test` is typechecked by `npm run build`, not by `npm run test`.

- [ ] **Step 5: Commit**

```
git add pwa/src/lib/api.ts pwa/test/api.test.ts
git commit -m "feat(pwa): api.archive takes {force:true}, and the unforced call stays byte-identical"
```

---

### Task 212: `ArchiveConflictSheet` — the refusal is the information

**Files:**
- Create: `pwa/src/fleet/ArchiveConflictSheet.tsx`
- Test: `pwa/test/archive-conflict-sheet.test.tsx`

**Interfaces:**
- Consumes: `api.archive(id, {force:true})` (Task 211); the `409 { error:'run-open', runs }` body (Task 208).
- Produces:
  - `export interface ArchiveConflictRun { id: number; program: string; wave: number; waveOf: number | null }`
  - `export interface ArchiveConflictSheetProps { sessionId: string | null; runs: readonly ArchiveConflictRun[] | null; onClose: () => void; onDone?: () => void; onOpenRun?: (runId: number) => void }`
  - `export function ArchiveConflictSheet(props: ArchiveConflictSheetProps & { archive?: typeof api.archive }): ReactNode`
  - `export function runOpenRuns(err: unknown): readonly ArchiveConflictRun[] | null` — **THE ONE
    READER of the `409 run-open` body in the whole client.** It lives here rather than in either
    door because Task 213 wires TWO doors (`PrSheet`, `SessionActionsSheet`) and a reader per door
    is how the two sentences drift. `null` = "not a run-open refusal, toast it as before"; `[]` =
    "a run-open refusal whose `runs` we could not read", which the sheet renders as *A run is still
    open on this workspace* and names no id. Those are two different facts and must not collapse.

**If nothing is designed, the operator sees the toast "Archiving failed — run-open".** Verified
end to end: `api.archive(id)` posts no body; `apiErrorText` is stderr-first, then `API_ERROR_TEXT`
(exactly one key, `unsupported`), then `err.message`, which `ApiError`'s constructor sets from
`body.error`. A 409 has no `stderr`. A bare slug in a toast is the precise defect
`API_ERROR_TEXT`'s own docstring was written to close.

**Modelled line-for-line on `AbandonSheet`** — the one 409 idiom in this codebase that KEEPS THE
SHEET OPEN on refusal, dispatches on status, and reads a SECOND body field so the sentence is a
measurement rather than a guess. Where `{force:true}` deliberately does NOT live, each with its
reason: **not a checkbox** (a pre-commitment made before the operator has seen the refusal, and the
refusal is the whole information); **not a long-press** (both `SessionActionsSheet` and
`SessionLine` record removing exactly that gesture — "a hidden gesture is the wrong home for
recovery"); **not `QuickConfirm`** (its confirm runs `onConfirm(); onClose();` unconditionally, so
it closes on every tap, win or lose).

**Degrade, never invent:** if `runs` is absent or empty the sheet says *"A run is still open on this
workspace"* and names no id.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/archive-conflict-sheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchiveConflictSheet, runOpenRuns } from '../src/fleet/ArchiveConflictSheet';
import { ApiError } from '../src/lib/api';

const RUNS = [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }];

describe('runOpenRuns — the ONE reader of the run-open body', () => {
  // It lives beside the sheet, not in either door, because Task 213 wires TWO
  // doors and a reader per door is how the two sentences drift. Its three
  // answers are three different facts and must not collapse into two.
  it('returns the runs for a 409 run-open', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open', runs: RUNS });
    expect(runOpenRuns(err)).toEqual(RUNS);
  });

  it('returns [] — NOT null — for a run-open whose `runs` is missing or malformed', () => {
    // "a run-open refusal we could not read the runs of" is the DEGRADE case;
    // the sheet renders it as the unnamed sentence. `null` would send it to a
    // toast instead, which is the defect this whole task exists to close.
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'run-open' }))).toEqual([]);
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'run-open', runs: 'x' }))).toEqual([]);
  });

  it('returns null for anything else — a 502, a 409 with another code, a non-ApiError', () => {
    expect(runOpenRuns(new ApiError(502, { ok: false, stderr: 'busy' }))).toBeNull();
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'not-merged' }))).toBeNull();
    expect(runOpenRuns(new Error('boom'))).toBeNull();
    expect(runOpenRuns(undefined)).toBeNull();
  });

  it('drops a malformed member rather than passing it to the renderer', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }, { id: 'nope' }] });
    expect(runOpenRuns(err)).toEqual(RUNS);
  });
});

describe('ArchiveConflictSheet', () => {
  it('names the run from the body — a measurement, not a guess', () => {
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={vi.fn()} />);
    expect(screen.getByText(/This workspace is claimed/)).toBeTruthy();
    expect(screen.getByText(/run 17/)).toBeTruthy();
    expect(screen.getByText(/build4/)).toBeTruthy();
    expect(screen.getByText(/wave 2\/3/)).toBeTruthy();
  });

  it('degrades without inventing an id when `runs` is absent', () => {
    render(<ArchiveConflictSheet sessionId="demo-x" runs={null} onClose={() => {}} archive={vi.fn()} />);
    expect(screen.getByText('A run is still open on this workspace')).toBeTruthy();
    expect(screen.queryByText(/run \d+/)).toBeNull();
  });

  it('Archive anyway posts {force:true}', async () => {
    const archive = vi.fn(async () => {});
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} onDone={onDone}
                                 archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-x', { force: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalled();
  });

  it('SURVIVES a further refusal — the property QuickConfirm structurally cannot provide', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    const onClose = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(screen.getByText('ws-archive: busy')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();     // still open, refusal rendered INSIDE
  });

  it('renders a 501 as the host-skew sentence, not a slug', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() =>
      expect(screen.getByText(/does not have this verb yet/)).toBeTruthy());
  });

  it('Open the run hands the id up; Cancel closes without archiving', () => {
    const onOpenRun = vi.fn();
    const onClose = vi.fn();
    const archive = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} onOpenRun={onOpenRun}
                                 archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the run' }));
    expect(onOpenRun).toHaveBeenCalledWith(17);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('renders nothing when sessionId is null', () => {
    const { container } = render(
      <ArchiveConflictSheet sessionId={null} runs={RUNS} onClose={() => {}} archive={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/archive-conflict-sheet.test.tsx
```

Expected: `Failed to resolve import "../src/fleet/ArchiveConflictSheet"`.

- [ ] **Step 3: Write minimal implementation**

Create `pwa/src/fleet/ArchiveConflictSheet.tsx`:

```tsx
// The archive-conflict sheet — what `409 run-open` looks like to a human.
//
// WITHOUT THIS FILE the operator sees the toast "Archiving failed —
// run-open": `apiErrorText` is stderr-first, then `API_ERROR_TEXT` (one key,
// `unsupported`), then `err.message`, which `ApiError`'s constructor sets
// from `body.error` — and a 409 has no stderr. A bare slug in a toast is the
// precise defect `API_ERROR_TEXT`'s own docstring was written to close.
//
// On `Sheet`, modelled line-for-line on `AbandonSheet` — the one 409 idiom in
// this codebase that dispatches on status, reads a SECOND body field so the
// sentence is a measurement rather than a guess, and KEEPS THE SHEET OPEN on
// refusal. `QuickConfirm` cannot host this: its confirm runs
// `onConfirm(); onClose();` unconditionally, so it closes on every tap, win
// or lose, and "Archive anyway" can itself be refused.
//
// WHERE `{force:true}` DELIBERATELY DOES NOT LIVE:
//   - not a checkbox: that is a pre-commitment made BEFORE the operator has
//     seen the refusal, and the refusal is the whole information;
//   - not a long-press: `SessionActionsSheet` and `SessionLine` both record
//     REMOVING exactly that gesture — "a hidden gesture is the wrong home for
//     recovery";
//   - not `QuickConfirm`, above.
// A second tap in a sheet that survived the refusal is the only shape that
// satisfies "the operator's own hands stay able to do it; they just have to
// mean it".
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { ApiError, UNSUPPORTED_VERB_TEXT, api } from '../lib/api';
import './fleet.css';

/** One run named by a `409 run-open` body. DEGRADE, NEVER INVENT: if `runs`
 *  is absent the sheet says "A run is still open on this workspace" and names
 *  no id. */
export interface ArchiveConflictRun {
  id: number; program: string; wave: number; waveOf: number | null;
}

export interface ArchiveConflictSheetProps {
  sessionId: string | null;
  runs: readonly ArchiveConflictRun[] | null;
  onClose: () => void;
  onDone?: () => void;
  onOpenRun?: (runId: number) => void;
}

/** `err` -> the sentence rendered INSIDE the sheet. Status-first dispatch,
 *  `AbandonSheet.abandonErrorText`'s own shape: every branch returns a string,
 *  because a failed forced archive has nowhere else to be said. */
function archiveErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'the archive was refused, for a reason this build does not recognise';
  if (err.status === 404) return 'that session is gone — the fleet will catch up';
  if (err.status === 501) return UNSUPPORTED_VERB_TEXT;
  if (err.status === 502) {
    const stderr = typeof err.body === 'object' && err.body !== null
      ? (err.body as { stderr?: unknown }).stderr : undefined;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : 'the archive failed on the box';
  }
  return 'the archive was refused, for a reason this build does not recognise';
}

const runPhrase = (r: ArchiveConflictRun): string =>
  `run ${r.id} — ${r.program} wave ${r.wave}${r.waveOf === null ? '' : `/${r.waveOf}`}`;

export function ArchiveConflictSheet({
  sessionId, runs, onClose, onDone, onOpenRun,
  archive = api.archive,
}: ArchiveConflictSheetProps & {
  /** Injectable for tests, `AbandonSheet`'s own idiom — the real
   *  `api.archive`'s URL and body are pinned separately in `api.test.ts`, so
   *  this injection is never the ONLY coverage of the write path. */
  archive?: typeof api.archive;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `gen`, `AbandonSheet`/`ReapSheet`'s idiom: this sheet is mounted at screen
  // level and `sessionId === null` merely renders nothing, so `busy`/`error`
  // would otherwise survive every close and every switch of target.
  const gen = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { gen.current += 1; };
  }, [sessionId]);

  if (sessionId === null) return null;
  const named = runs !== null && runs.length > 0 ? runs : null;

  const force = (): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void archive(sessionId, { force: true }).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        setError(archiveErrorText(err));
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title="This workspace is claimed">
      <div className="archive-conflict-sheet">
        <p className="qc-consequence">
          {named === null
            ? 'A run is still open on this workspace'
            : named.length === 1
              ? `${runPhrase(named[0]!)} is still open on this workspace.`
              : `${named.map(runPhrase).join('; ')} are still open on this workspace.`}
        </p>
        <p className="qc-consequence">
          Archiving stops the session and puts the worktree away. Nothing is deleted, but the
          run loses the workspace it is working in.
        </p>
        <div className="qc-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={force}>
            {busy ? 'Archiving…' : 'Archive anyway'}
          </button>
          {named !== null && onOpenRun !== undefined && (
            <button type="button" className="btn-ghost" disabled={busy}
                    onClick={() => onOpenRun(named[0]!.id)}>
              Open the run
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/archive-conflict-sheet.test.tsx
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add pwa/src/fleet/ArchiveConflictSheet.tsx pwa/test/archive-conflict-sheet.test.tsx
git commit -m "feat(pwa): ArchiveConflictSheet — a 409 run-open becomes a sentence that survives its own refusal"
```

---

### Task 213: both archive doors route into the sheet, and `RELEASE_CONSEQUENCE` stops overpromising

**Files:**
- Modify: `pwa/src/session/PrSheet.tsx` (the `onClick={() => void act('Archiving', () => api.archive(session.id))}` on the `Archive now` button)
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx` (`const archiveNow = async (): Promise<void> => { … }` and its `toast(\`Couldn't archive — ${apiErrorText(err)}\`, 'error')`; and `const RELEASE_CONSEQUENCE =`)
- Test: `pwa/test/pr-sheet.test.tsx`, `pwa/test/session-actions-sheet.test.tsx`

**Interfaces:**
- Consumes: `ArchiveConflictSheet`, `ArchiveConflictRun` (Task 212).
- Produces: no new exported type. Both doors stop toasting a slug.

**`RELEASE_CONSEQUENCE` is now false in the same way `cmd_ws_release`'s comment was.** It reads
*"released — the next sweep may archive it once its PR merges (a busy or attached session
defers)"*. After Task 207's rung, a release does not re-arm the sweep while a run is open. It is the
PWA half of Task 209, and it must be corrected here or the phone tells the operator the opposite of
what the box will do.

**§2.4's longer hold reason lands here too** — `SessionActionsSheet`'s hold line and PrSheet's two
long sentences interpolate `session.held` verbatim, so they need no code change; the composer
placeholder `program:name wave:2/4` stays truthful (a hand hold gets no `run:` suffix, Task 204).

- [ ] **Step 1: Write the failing test**

`pwa/test/pr-sheet.test.tsx`:

```tsx
  it('Archive now routes a 409 run-open into the sheet, never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderPrSheet({ session: mergedUnarchived(), archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive now' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
    expect(screen.getByText(/run 17/)).toBeTruthy();
    // The defect this replaces: a bare slug in a toast.
    expect(screen.queryByText(/Archiving failed — run-open/)).toBeNull();
  });

  it('any OTHER archive failure still toasts — the sheet is for run-open, not for everything', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    renderPrSheet({ session: mergedUnarchived(), archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive now' }));
    await waitFor(() => expect(screen.getByText(/ws-archive: busy/)).toBeTruthy());
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
  });
```

`pwa/test/session-actions-sheet.test.tsx`:

```tsx
  it('Archive workspace routes a 409 run-open into the sheet, never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderSheet({ session: workspaceSession(), archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
  });

  it('the release consequence no longer promises a sweep the run can veto', () => {
    renderSheet({ session: heldSession() });
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    const text = screen.getByText(/released —/).textContent ?? '';
    // Wave 2: an absent hold is no longer sufficient for `archiveMerged`.
    expect(text).toMatch(/open run/i);
    expect(text).toMatch(/may/);              // still a MAY, never a WILL
  });
```

**NEITHER `renderPrSheet` NOR `renderSheet` EXISTS — verified at `d7137c2`, and neither does
`mergedUnarchived`, `workspaceSession`, `heldSession` or `runFor`.** `pr-sheet.test.tsx`'s render
helper is `open(s = sess(), onReap = () => {})`; `session-actions-sheet.test.tsx` has no helper at
all (every mount is spelled inline, with `open`, `onClose` and `onReap` all required, and its
`hold and release` describe builds props through a local `sheetProps` object). So both helpers are
DEFINED by this task, in the file that uses them:

In `pwa/test/pr-sheet.test.tsx`, widen the existing `open` rather than adding a rival:

```tsx
// `archive` is injectable so the tests do not mock the module — the AbandonSheet
// idiom, and the reason PrSheet gains an `archive` prop in Step 3.
const open = (s: FleetSession = sess(), onReap = (): void => {},
              over: { archive?: typeof api.archive } = {}) =>
  render(<><ToastHost /><PrSheet session={s} open onClose={() => {}} onReap={onReap} {...over} /></>);

/** A session whose PR is MERGED and whose workspace is NOT archived — the one
 *  shape that renders `Archive now`. */
const mergedUnarchived = (): FleetSession =>
  sess({ pr: pr({ phase: 'merged', number: 42 }), archivedAt: null });
```

…and call it `open(mergedUnarchived(), () => {}, { archive })` in the two new cases.

In `pwa/test/session-actions-sheet.test.tsx`, add the helper this file has never had:

```tsx
const renderSheet = (
  session: FleetSession, over: { archive?: typeof api.archive } = {},
): void => {
  render(<><SessionActionsSheet session={session} open onClose={() => {}} onReap={() => {}} {...over} /><ToastHost /></>);
};
/** `s()` is this file's existing session factory (aliased `f` inside the hold
 *  describe). These two just name the two shapes the archive door needs. */
const workspaceSession = (): FleetSession => s({ workspace: 'quiet-basin', archivedAt: null });
const heldSession = (): FleetSession => s({ held: 'program:build4 wave:2/4 run:17' });
```

…and call it `renderSheet(workspaceSession(), { archive })`.

**Step 3 must also add the prop that makes `{ archive }` exist.** Neither component takes one today:

```tsx
// PrSheet.tsx
export function PrSheet(props: PrSheetProps & { archive?: typeof api.archive }): ReactNode {
  const archive = props.archive ?? api.archive;
```

```tsx
// SessionActionsSheet.tsx
export function SessionActionsSheet(
  props: SessionActionsSheetProps & { archive?: typeof api.archive },
): ReactNode {
  const archive = props.archive ?? api.archive;
```

That default-to-`api.archive` shape is exactly what `ArchiveConflictSheet` itself uses
(`props: ArchiveConflictSheetProps & { archive?: typeof api.archive }`, Task 212), so the three
components share one idiom.

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/pr-sheet.test.tsx test/session-actions-sheet.test.tsx
```

Expected: `Unable to find an element with the text: /This workspace is claimed/` in both new archive
tests; `expected 'released — the next sweep may archive it once its PR merges (a busy or attached
session defers).' to match /open run/i` in the last.

- [ ] **Step 3: Write minimal implementation**

`pwa/src/fleet/SessionActionsSheet.tsx`:

```ts
/** Corrected in Build 8 Wave 2. It used to end at "(a busy or attached session
 *  defers)", which is now a promise the sweep can no longer keep: since
 *  `archiveMerged` also asks coord.db whether an OPEN RUN names the session,
 *  releasing the hold is not sufficient on its own. Still a MAY, never a WILL
 *  — the original correction that produced this constant. */
const RELEASE_CONSEQUENCE =
  'released — the next sweep may archive it once its PR merges (a busy or attached session defers, '
  + 'and an open run on this workspace defers it too).';
```

and the archive door:

```ts
  const [conflict, setConflict] = useState<readonly ArchiveConflictRun[] | null | undefined>(undefined);

  const archiveNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await archive(session.id);
      onClose();
    } catch (err) {
      // `409 run-open` is not a failure the operator can act on from a toast:
      // the refusal names WHICH run, and naming it is the whole information.
      // Everything else keeps the toast it always had.
      const runs = runOpenRuns(err);
      if (runs !== null) setConflict(runs);
      else toast(`Couldn't archive — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };
```

with the SINGLE reader of the `run-open` body — **it lives in `ArchiveConflictSheet.tsx` and is
imported here**, so the two doors cannot drift onto two readers. It is declared and tested in
Task 212; reproduced here so this task's diff is readable:

```ts
/** `409 { error:'run-open', runs }` -> the runs, or `null` for any other
 *  error. `undefined` runs degrade to `[]`-shaped `null` INSIDE the sheet,
 *  which says "A run is still open on this workspace" and names no id — never
 *  invent one. */
export function runOpenRuns(err: unknown): readonly ArchiveConflictRun[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (typeof body !== 'object' || body === null) return null;
  if ((body as { error?: unknown }).error !== 'run-open') return null;
  const raw = (body as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is ArchiveConflictRun =>
    typeof r === 'object' && r !== null
    && typeof (r as ArchiveConflictRun).id === 'number'
    && typeof (r as ArchiveConflictRun).program === 'string'
    && typeof (r as ArchiveConflictRun).wave === 'number');
}
```

and render the sheet beside the existing ones:

```tsx
      <ArchiveConflictSheet
        sessionId={conflict === undefined ? null : session.id}
        runs={conflict === undefined ? null : (conflict?.length ? conflict : null)}
        onClose={() => setConflict(undefined)}
        onDone={() => { setConflict(undefined); onClose(); }}
      />
```

`pwa/src/session/PrSheet.tsx` — the same `runOpenRuns` reader (import it from
`../fleet/ArchiveConflictSheet`, exported there so the two doors cannot drift onto two readers), the
same `conflict` state, and:

```tsx
                  <button type="button" className="btn-ghost" disabled={busy}
                          onClick={() => void archiveNow()}>
                    Archive now
                  </button>
```

with

```ts
  const archiveNow = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await archive(session.id); load(); }
    catch (err) {
      const runs = runOpenRuns(err);
      if (runs !== null) setConflict(runs);
      else toast(`Archiving failed — ${apiErrorText(err)}`, 'error');
    }
    finally { setBusy(false); }
  };
```

Both doors `import { ArchiveConflictSheet, runOpenRuns } from '../fleet/ArchiveConflictSheet.js'`
(PrSheet) / `'./ArchiveConflictSheet.js'` (SessionActionsSheet). **`runOpenRuns` ships in Task 212,
not here** — it is in that task's Files, Interfaces and test file.

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/pr-sheet.test.tsx test/session-actions-sheet.test.tsx test/archive-conflict-sheet.test.tsx
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add pwa/src/session/PrSheet.tsx pwa/src/fleet/SessionActionsSheet.tsx pwa/src/fleet/ArchiveConflictSheet.tsx pwa/test/pr-sheet.test.tsx pwa/test/session-actions-sheet.test.tsx
git commit -m "feat(pwa): both archive doors render the claim instead of toasting a slug; RELEASE_CONSEQUENCE stops overpromising"
```

---

### Task 214: `released` gets a reader

**Files:**
- Modify: `pwa/src/lib/api.ts` (`abandonRun: (id: number) => post(`/api/runs/${id}/abandon`),`)
- Modify: `pwa/src/fleet/AbandonSheet.tsx` (the `abandonRun?: (id: number) => Promise<void>;` prop and `confirm()`'s success arm)
- Test: `pwa/test/api.test.ts`, `pwa/test/abandon-sheet.test.tsx`

**Interfaces:**
- Consumes: Task 205's `released: boolean` on the 200 body.
- Produces: `abandonRun: (id: number) => Promise<{ released: boolean }>`; `AbandonSheet`'s injectable prop widens to match.

**Why it needs a reader at all.** `AbandonSheet` currently DISCARDS the resolution: an abandon that
does not release, because a sibling wave is still open, closes saying nothing. That is exactly the
silence Wave 2 exists to remove.

**The degrade:** an older server sends no `released`, and absence reads as `true` — i.e. today's
behaviour, no toast. Absence-permits, safe direction.

- [ ] **Step 1: Write the failing test**

`pwa/test/api.test.ts`:

```ts
  it('abandonRun reads `released` off the 200 body, and absence degrades to true', async () => {
    const a = createApi(async () =>
      new Response(JSON.stringify({ ok: true, id: 3, state: 'failed', released: false }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await a.abandonRun(3)).toEqual({ released: false });

    const older = createApi(async () =>
      new Response(JSON.stringify({ ok: true, id: 3, state: 'failed' }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    // An older server never sends the field: absence reads TRUE — today's
    // behaviour, no toast, the safe direction.
    expect(await older.abandonRun(3)).toEqual({ released: true });
  });
```

`pwa/test/abandon-sheet.test.tsx` — first update the harness's prop type from
`abandonRun: (id: number) => Promise<void>` to `abandonRun: (id: number) => Promise<{ released: boolean }>`
and every `mockResolvedValue()` to `mockResolvedValue({ released: true })`, then add:

```tsx
  it('says so when the abandon did NOT release — a sibling wave still owns the workspace', async () => {
    const abandonRun = vi.fn(async () => ({ released: false }));
    const onClose = vi.fn();
    render(<AbandonSheet run={run()} onClose={onClose} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The sheet closes (the abandon SUCCEEDED); the toast carries the part
    // that would otherwise be silent.
    await waitFor(() => expect(screen.getByText(/still claimed/i)).toBeTruthy());
  });

  it('says nothing extra when it DID release', async () => {
    const abandonRun = vi.fn(async () => ({ released: true }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon' }));
    await waitFor(() => expect(abandonRun).toHaveBeenCalled());
    expect(screen.queryByText(/still claimed/i)).toBeNull();
  });
```

The toast test needs `ToastHost` rendered alongside; use whatever the file's neighbours do, or
render `<><ToastHost /><AbandonSheet …/></>`.

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/abandon-sheet.test.tsx
```

Expected: `expected undefined to equal { released: false }` from the api test, and
`Unable to find an element with the text: /still claimed/i` from the sheet.

- [ ] **Step 3: Write minimal implementation**

`pwa/src/lib/api.ts` — replace the `abandonRun` entry:

```ts
    /** Deliberately UNGATED, same reasoning as `coordPause` just above: no box
     *  token on this call.
     *
     *  It now RETURNS the resolution. `released:false` means the run closed
     *  but the WORKSPACE stayed claimed, because a sibling open run still
     *  names the session — the state the coordinator protocol deliberately
     *  creates by opening wave N+1 before closing wave N. An older server
     *  sends no such field, and absence reads TRUE: today's behaviour, no
     *  toast, the safe direction. */
    abandonRun: async (id: number): Promise<{ released: boolean }> => {
      const res = await request(`/api/runs/${id}/abandon`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { released?: unknown };
      return { released: body.released !== false };
    },
```

`pwa/src/fleet/AbandonSheet.tsx` — widen the prop and read the resolution:

```ts
  abandonRun?: (id: number) => Promise<{ released: boolean }>;
```

```ts
    void abandonRun(run.id).then(
      (res) => {
        if (gen.current !== mine) return; // superseded — a different run's sheet is open now
        setBusy(false);
        // NOT silent: a close that could not release is the case Wave 2's
        // whole sibling check exists for, and before this line the sheet
        // discarded it entirely.
        if (!res.released) {
          toast(`Run ${run.id} abandoned — ${ws} is still claimed by another open run.`, 'info');
        }
        onDone?.();
        onClose();
      },
      …
```

with `import { toast } from '../components/Toast';` added.

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/abandon-sheet.test.tsx
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add pwa/src/lib/api.ts pwa/src/fleet/AbandonSheet.tsx pwa/test/api.test.ts pwa/test/abandon-sheet.test.tsx
git commit -m "feat(pwa): an abandon that could not release stops saying nothing"
```

---

### Task 215: PrSheet's post-merge note has three reasons, not two

**Files:**
- Modify: `pwa/src/session/PrSheet.tsx` (the `<p className="pr-note">` inside the `pr?.phase === 'merged'` / not-archived branch, currently `session.held !== null ? \`Not archived — held: ${session.held}. …\` : 'Not archived yet (session busy)'`)
- Test: `pwa/test/pr-sheet.test.tsx`

**Interfaces:**
- Consumes: the fleet store's existing `runs` and `runsFrameSeen`; `isRunClosed` from `../fleet/runWords`.
- Produces: nothing new. **Zero wire change** — the store already carries the active run list.

**Gated on `runsFrameSeen`, degrading to today's two-reason sentence rather than asserting.** The
store's own idiom: an empty `runs` array before the first `runs` frame is not evidence of no runs.

**SCOPE NOTE, for the operator.** §2.x asks for none of this — the spec's Wave 2 stops at the
`archiveMerged` rung. This task exists because that rung creates a third reason a merged workspace
sits unarchived, and PrSheet's note enumerates two. **It is DROPPABLE if Wave 2 needs to shrink.**

- [ ] **Step 1: Write the failing test**

**Three helpers this file does NOT have** — `pr-sheet.test.tsx`'s only render helper is
`open(s, onReap)` (line 43 at `d7137c2`), and there is no `renderPrSheet`, no `mergedUnarchived`
and no `RunSummary` factory anywhere in `pwa/test`. Task 213 already widens `open` and adds
`mergedUnarchived`; this task adds the store override and the run factory:

```tsx
// Task 213 widened `open` to forward overrides; this widens it once more, for
// the ONE store slice this note reads. If Task 213 has not landed yet, add both
// at once — they are the same signature.
const open = (s: FleetSession = sess(), onReap = (): void => {},
              over: { archive?: typeof api.archive; store?: Partial<FleetStore> } = {}) => {
  if (over.store) useFleet.setState(over.store as FleetStore);
  return render(<><ToastHost /><PrSheet session={s} open onClose={() => {}} onReap={onReap}
                    {...(over.archive ? { archive: over.archive } : {})} /></>);
};
const renderPrSheet = (o: { session: FleetSession; store?: Partial<FleetStore>;
                            archive?: typeof api.archive }): void => {
  open(o.session, () => {}, { ...(o.archive ? { archive: o.archive } : {}),
                              ...(o.store ? { store: o.store } : {}) });
};

/** A `RunSummary`. Nothing in the tree supplies one, so it is spelled in full —
 *  every field is required on the interface and the compiler will name any
 *  omission. */
const runFor = (sessionId: string, id: number, program: string,
                wave: number, waveOf: number | null): RunSummary => ({
  id, program, programTitle: 'Fleet controls', wave, waveOf, project: 'demo',
  sessionId, workspace: sessionId, branch: `ws/${sessionId}`,
  state: 'working', resumed: false, clearedAt: null,
  openedAt: 1785300000000, dispatchedAt: 1785300000000, closedAt: null,
  handoffCommit: null, items: { total: 0, done: 0, failed: 0 }, unreadMail: 0,
});
```

(`items`' exact shape is `RunItemTally` — if its field names differ from
`{ total, done, failed }`, take them from `shared/api.ts`; the compiler will say so. Add
`useFleet`/`FleetStore` and `RunSummary` to the file's imports.)

```tsx
  it('names an OPEN RUN as the third reason a merged workspace is unarchived', () => {
    renderPrSheet({
      session: mergedUnarchived(),                       // held === null
      store: { runsFrameSeen: true, runs: [runFor('demo-x', 17, 'build4', 2, 3)] },
    });
    const note = screen.getByText(/Not archived/).textContent ?? '';
    expect(note).toMatch(/run 17/);
    expect(note).toMatch(/build4/);
    expect(note).not.toMatch(/session busy/);
  });

  it('degrades to the shipped two-reason sentence before the first runs frame', () => {
    renderPrSheet({
      session: mergedUnarchived(),
      store: { runsFrameSeen: false, runs: [] },
    });
    expect(screen.getByText('Not archived yet (session busy)')).toBeTruthy();
  });

  it('a CLOSED run is not a reason', () => {
    renderPrSheet({
      session: mergedUnarchived(),
      store: { runsFrameSeen: true, runs: [{ ...runFor('demo-x', 17, 'build4', 2, 3), state: 'done' }] },
    });
    expect(screen.getByText('Not archived yet (session busy)')).toBeTruthy();
  });

  it('the HOLD still wins when both are present — one sentence, never two', () => {
    renderPrSheet({
      session: { ...mergedUnarchived(), held: 'program:build4 wave:2/3 run:17' },
      store: { runsFrameSeen: true, runs: [runFor('demo-x', 17, 'build4', 2, 3)] },
    });
    const note = screen.getByText(/Not archived/).textContent ?? '';
    expect(note).toMatch(/held: program:build4 wave:2\/3 run:17/);
    expect(screen.queryAllByText(/Not archived/)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/pr-sheet.test.tsx
```

Expected: the first test fails — the note reads `Not archived yet (session busy)` and does not match
`/run 17/`.

- [ ] **Step 3: Write minimal implementation**

In `pwa/src/session/PrSheet.tsx`, above the JSX:

```ts
  // THE THIRD REASON, and it needs ZERO wire change: the fleet store already
  // carries the active run list. Gated on `runsFrameSeen` — an empty `runs`
  // before the first frame is not evidence of no runs — and degrading to the
  // shipped two-reason sentence rather than asserting.
  const runsFrameSeen = fleet((s) => s.runsFrameSeen);
  const openRun = fleet((s) => s.runs).find(
    (r) => r.sessionId === session.id && !isRunClosed(r)) ?? null;
  const claimingRun = runsFrameSeen ? openRun : null;
```

and the note:

```tsx
                  <p className="pr-note">
                    {session.held !== null
                      ? `Not archived — held: ${session.held}. A held workspace is skipped by every sweep; release it (Release, in the session’s actions sheet) or archive it by hand below.`
                      : claimingRun !== null
                        ? `Not archived — run ${claimingRun.id} (${claimingRun.program} wave ${claimingRun.wave}${claimingRun.waveOf === null ? '' : `/${claimingRun.waveOf}`}) is still open on this workspace. Since Build 8 the sweep asks coord.db, not only the hold file, so releasing the hold will not archive it while that run is open. Close the run, or archive it by hand below.`
                        : 'Not archived yet (session busy)'}
                  </p>
```

Add `import { isRunClosed } from '../fleet/runWords';` and the store hook the file's neighbours use
(`SessionHeader.tsx` already imports across this boundary, so the direction is established).

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/pr-sheet.test.tsx
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add pwa/src/session/PrSheet.tsx pwa/test/pr-sheet.test.tsx
git commit -m "feat(pwa): the post-merge note names an open run — the third reason, and it needed no wire change"
```

---

### Task 216: the coordinator skill stops saying `final:true` always releases (AGENT-FIRST)

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (step 6, currently `6. **Final merge:** \`POST /api/runs/:id/close\` with \`final:true\` releases the` / `hold and lets the ordinary sweep archive the workspace. Do not archive it` / `yourself unless the operator asks.`)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (the close paragraph beginning `POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last`, whose next lines read `wave's run — re-measures, closes this run \`done\`, and **releases** the hold` / `(\`ws-release\`) instead of re-holding for a next wave.`)
- Test: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: Task 205's `released: boolean`.
- Produces: skill prose only.

**Both sentences are now CONDITIONALLY FALSE** and neither string is asserted verbatim by any suite
— which is exactly why they will rot silently if this task is skipped. Neither is one of the NINE
pinned contract clauses (`CONTRACT` in `coordinator-skill.test.ts`), so this is **additive text**, not
an edit to a pinned clause. No wave in this build requires editing a pinned clause.

**TWO OTHER ASSERTIONS IN THAT FILE BIND AND ARE EASY TO TRIP:**

1. **The destructive-verb census.** `ws-reap`, `ws-rm` and `ws-gc` may appear across SKILL.md *and
   both references* exactly as many times as clause 3 names them — **so no new sentence may mention
   any of the three, not even to forbid them again.** `ws-release`, `ws-archive` and `ws-hold` are
   not in the census and are safe.
2. **The route-completeness scan**, scoped to `server/src/coord/routes.ts`. Task 208's route is in
   `server/src/server.ts` and is outside it.

**Wave 1's addition also belongs in this file** (an `ok` dispatch is no longer proof the pane is
ready). It is **w1-ccd Task 14**, on Wave 1's agent-first lane — scheduled, not implied. Do not
write it here.

- [ ] **Step 1: Write the failing test**

Add to `server/test/coordinator-skill.test.ts`:

```ts
describe('the skill on `final:true` — a release is now conditional', () => {
  it('does not promise `final:true` releases the hold, full stop', () => {
    expect(skill).not.toMatch(/`final:true` releases the\s+hold/);
    expect(lifecycle).not.toMatch(/and \*\*releases\*\* the hold\s*\n\(`ws-release`\) instead of re-holding/);
  });

  it('names `released` and says what `released:false` means', () => {
    for (const text of [skill, lifecycle]) {
      expect(text).toMatch(/released/);
    }
    expect(lifecycle).toMatch(/released.*false|`released: false`/);
    // The consequence, in the coordinator's own terms: the program is NOT
    // done, and another run still owns the workspace.
    expect(lifecycle).toMatch(/another run still (owns|claims)/i);
  });

  // NO SECOND CENSUS ASSERTION HERE. `server/test/coordinator-skill.test.ts`
  // already pins it EXACTLY — `hits === CONTRACT[2].split(verb).length - 1`,
  // over SKILL.md plus both references — and a copy in this describe would be
  // a weaker duplicate of a guard that already exists, which is precisely the
  // mutation-table discipline this branch is enforcing everywhere else. The
  // constraint is real and binding on Step 3's prose; the MECHANISM that
  // enforces it is the shipped test, and Step 4 runs the whole file.
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected: the first two fail — the SKILL.md regex matches, and neither file contains `released`.

- [ ] **Step 3: Write minimal implementation**

`ccd/coordinator-skill/SKILL.md`, step 6:

```markdown
6. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
   and, *if no other open run names this workspace*, releases the hold so the
   ordinary sweep can archive it. Read `released` in the response: `false`
   means the run closed but the workspace is **still claimed** — another open
   run owns it, which is exactly the state step 5's open-before-close creates.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.
```

`ccd/coordinator-skill/references/wave-lifecycle.md`, the `final:true` paragraph:

```markdown
`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and releases the hold
(`ws-release`) **only when no other open run names this session**. The response
carries `released`. `released: true` means the claim is gone and the ordinary
sweep will archive the workspace once its PR merges. `released: false` means the
claim was **handed over**, not dropped: another run still owns this workspace,
so the hold was rewritten with that run's own reason and nothing was archived.
That is not an error — it is the ordinary consequence of opening wave N+1
before closing wave N — but the program is not finished until that run closes
too. The same field rides the abandon response.

Since Build 8 the archive sweep asks the same question the close does: a
workspace whose hold is absent but whose run is still open is **not** archived.
Releasing a hold by hand no longer re-arms the sweep on its own.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

- [ ] **Step 5: Commit**

```
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "docs(skill): final:true releases CONDITIONALLY — read `released`, and a handed-over claim is not an error"
```

---

### Wave 2 — definition of done

- [ ] `cd server && ./node_modules/.bin/vitest run` — green. `pr-sweep` is a known load flake; re-run it in isolation before calling a red a real break.
- [ ] `cd pwa && ./node_modules/.bin/vitest run` — green.
- [ ] `cd pwa && npm run build` — green. **This is the only thing that typechecks `pwa/test`**, and Tasks 211/214 change two exported client signatures.
- [ ] `cd agent && ./node_modules/.bin/vitest run` — green (nothing in this wave touches `agent/`, so a red here is a rebase artefact).
- [ ] `server/test/ownership.test.ts` green **on every commit of the branch**, not merely at the tip — Task 209 re-stamped `ccd/ccd` in its own commit.
- [ ] `git show <branch>:ccd/ccd | grep -c SWAP_JITTER` is non-zero — the `fix/ccd-swap-jitter` content is present at `d7137c2` and this check is what would catch a bad rebase having dropped it.
- [ ] Deploy: `bash deploy/deploy.sh agent <fleet-host>` **first** (Tasks 209 + 216), then `bash deploy/deploy.sh`. The host argument is not optional — `deploy.sh` defaults `$BOX` to the SERVER box.
- [ ] After the server lane: `/health` reports the shipped sha, and the server boots — Task 201 adds a migration, so a boot failure here is `CoordDbUnmigratable` and is loud by design (`verify-service.sh` turns it into a failed deploy with the journal tail attached). There is **no `coord.db` backup**; `deploy.sh` backs up `dist-pwa`/`agent-dist`/`ccd`/`notify.sh`/`session-hook.sh` under `~/ccrc-backups/` and never `coord.db`.
- [ ] `sqlite3 ~/.ccrc/coord.db 'PRAGMA user_version'` reads `2` on the server box, and `.indexes runs` names `runs_by_session`.
- [ ] No `git push`, no `gh`. Branch, commit, stop.
## Wave 3 — naming and relocation respect a claim

**Bounded context:** Fleet Mutation + the naming sweep. **AGENT-FIRST deploy** (`ccd/ccd` and
`ccd/coordinator-skill/` both change): ccd and the skill ship to the fleet host, then the server,
then the PWA build.

**Depends on Wave 2.** Tasks 301 and 305 both consume `CoordStore.openRunsForSession`, introduced in
Wave 2 §2.1. Do not start Wave 3 before Wave 2's store task is green, and do not reorder the waves
"because Wave 3 is just ccd" — two of its seven tasks are server-side and one of them cannot compile
without Wave 2.

**Merge gate, already satisfied at `d7137c2` — keep the check anyway.** `SWAP_JITTER=120` is present
in `ccd/ccd` at this baseline (verified: `git show d7137c2:ccd/ccd | grep -n '^SWAP_JITTER'` →
`54:SWAP_JITTER=120`), so the `fix/ccd-swap-jitter` gate the spec's Open decision 8 raises is
discharged. Task 303 edits `_auto_swap_check`, the caller of the machinery that branch changed,
running on a 5-second tick across 18 supervisors — so before shipping ccd for this wave, re-run
`git show <the ref you are about to install>:ccd/ccd | grep -c SWAP_JITTER` and require non-zero. It
is one command and it is what catches a bad rebase.

**GATE 1 applies to Tasks 302, 303, 305 and 306** — every commit that touches `ccd/ccd` re-stamps the
provenance marker IN THAT COMMIT, or `server/test/ownership.test.ts` is red on that commit and every
later one on the branch. The command lives in that file's own comment and is repeated in each task's
commit step. It is idempotent.

**What Wave 3 does NOT do.** §3.4's `prefer` exec grant is DEFERRED by operator decision: no entry is
added to `agent/src/whitelist.ts`, `EXEC_COMMANDS` stays `['tmux','ccd']`, and `ccd prefer` stays
unreachable from the server. What survives is Task 307's honest label — the zero-cost half. Nothing in
this wave makes a lane choice durable, and Task 307's copy is written to say so out loud rather than
to imply otherwise.

---

### Task 301: The naming sweep skips a claimed workspace

The twelfth condition in `FleetWatcher.sweepNames`. **Both halves are needed:** `r.held` covers the
ordinary dispatch (the hold is placed by `dispatchRun` after `ws-add` and before the brief is mailed,
and the sweep needs an `ai-title` that only exists once the worker answers the brief — so on the
ordinary path the claim is already in place), and `openRunsForSession` covers a hand-created workspace
adopted into a run via `POST /api/runs` with a `sessionId`, which never gets a hold at open time on
that path. `held` is a free in-memory field on a row the loop already has, so putting it first
short-circuits the query away for every claimed row.

**Files:**
- Modify: `server/src/watch.ts` — the `sweepNames` loop, at the born-name rung. Identify it by these
  two consecutive lines (verified verbatim at `d7137c2`), never by a line number:
  ```ts
        const born = `ws/${r.workspace}`;
        if (r.branch !== born) continue;
  ```
  The new condition goes IMMEDIATELY AFTER the second of those. Do NOT place it earlier: three rungs
  above sits `if (identity === null) continue;`, the degraded-row skip, and an earlier draft of this
  spec named the insertion point by number and landed on that one.
- Modify: `server/src/watch.ts` — the `PERMANENT_REFUSALS` set, identified by its literal
  `const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([`. **No code change**: `held` must NOT
  join it. A hold is released; a pushed branch is not un-pushed. The task adds a comment saying so and
  a test that goes red if someone adds it.
- Test: `server/test/name-sweep.test.ts`

**Interfaces:**
- Consumes: `CoordStore.openRunsForSession(sessionId: string, excludeRunId?: number): OpenSibling[]`
  (Wave 2 §2.1, `server/src/coord/store.ts`) — SYNCHRONOUS; `SessionRecord.held: string | null`
  (`server/src/registry.ts`); `Deps['coord']?: CoordStore` (`server/src/server.ts:138` declares it
  `coord?: CoordStore`).
- Produces: no new exported name. Behavioural contract: `sweepNames` emits zero `ws-rename` argv for a
  session that is held OR named by an open run.

- [ ] **Step 1: Write the failing tests — the policy reversal and the two new skips**

  In `server/test/name-sweep.test.ts`, REPLACE the existing test in full. Its current text (verified
  at `d7137c2`) is:

  ```ts
  // Build 2.5 interaction, asserted rather than assumed (rider delta 7). The
  // ccd side is pinned in ccd-ws-rename.test.ts; this is the server side: the
  // sweep itself neither reads nor writes hold or prhistory state, so a held
  // workspace is renamed exactly like an unheld one and nothing in the registry
  // moves except `branch` (which ccd writes, not the sweep).
  it('is indifferent to a hold, and touches no PR lineage', async () => {
    const h = harness();
    seed(h.home, { hold: 'program:agent-evals wave:1/4' });
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
    expect(readFileSync(path.join(h.home, '.cc-sessions', `${ID}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
    expect(h.calls.every((a) => a[0] === 'ws-rename'),
      'the naming lane emits exactly one verb and it is not pr-state').toBe(true);
  });
  ```

  **Rewriting that test is a DECISION, not a pin update.** The comment above it records the OLD
  ruling as deliberate ("the sweep itself neither reads nor writes hold … a held workspace is renamed
  exactly like an unheld one"). Wave 3 reverses it, and the replacement comment must say that
  explicitly so the next reader does not think a bug was fixed. Replace with:

  ```ts
  // ── the claim (Wave 3 §3.1) ──
  // POLICY REVERSAL, recorded rather than silently swapped. Build 2.5's ruling
  // was that the sweep is indifferent to a hold: a rename is not destructive,
  // so a held workspace was renamed exactly like an unheld one. Measured on the
  // live fleet 2026-08-14: three ccrc-pwa workspaces renamed 82 s, 31 s and 28 s
  // after creation, i.e. inside their own wave, changing what the whole fleet
  // calls a claimed worker (`sessionLabel` reads `branch` before `workspace`)
  // while a coordinator held a ledger naming the old one. The claim now wins.
  it('will not rename a HELD workspace — the claim outranks the title', async () => {
    const h = harness();
    seed(h.home, { hold: 'program:agent-evals wave:1/4' });
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls), 'a claimed workspace is not renamed').toEqual([]);
    expect(readFileSync(path.join(h.home, '.cc-sessions', `${ID}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
    expect(h.calls, 'a skipped row emits no verb at all — not even a probe').toEqual([]);
  });

  // `-e`-equivalent polarity on the server side: `readRegistry` maps an empty
  // `.hold` to HOLD_NO_REASON and a listed-but-unreadable one to
  // HOLD_UNREADABLE, both NON-null, so doubt reads as HELD here exactly as it
  // does in ccd's four hold readers. A guard written `r.held !== null &&
  // r.held !== ''` would rename under a truncated hold file.
  it('skips on an EMPTY hold file too — doubt reads as held', async () => {
    const h = harness();
    seed(h.home, { hold: '' });
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual([]);
  });

  // The half `held` alone does NOT cover: a workspace created by hand and
  // adopted into a run through `POST /api/runs` with a `sessionId`. The open
  // route places its hold at open time on the ordinary path, but an adopted
  // row can reach `dispatched` with no `.hold` on disk at all, and the run row
  // is then the only evidence the workspace is spoken for.
  it('skips a row an OPEN RUN names, with no hold on disk at all', async () => {
    const h = harness();
    seed(h.home);                                   // deliberately no `hold` field
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({
      program: 'build8', title: 'Fleet robustness', project: 'demo',
      wave: 1, waveOf: 4, claimedBy: 'demo-coordinator',
    }) as { id: number };
    coord.setSession(opened.id, ID);
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), coord }, new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual([]);
  });

  // The direction that decides whether the rung is a skip or an outage: a run
  // that has CLOSED releases the name again, and an unclaimed row is renamed
  // exactly as it was before this wave.
  it('still renames an unclaimed row, and one whose only run is closed', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({
      program: 'build8', title: 'Fleet robustness', project: 'demo',
      wave: 1, waveOf: 4, claimedBy: 'demo-coordinator',
    }) as { id: number };
    coord.setSession(opened.id, ID);
    coord.advance(opened.id, 'failed', 'coordinator');   // terminal: no longer an open sibling
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), coord }, new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
  });

  // `deps.coord` IS OPTIONAL and that is load-bearing: `testDeps` supplies no
  // store, and every other test in this file builds its watcher from it. A
  // non-optional `this.deps.coord.openRunsForSession(...)` TypeErrors all of
  // them plus fourteen in `hold-gate.test.ts`. Named on its own so that
  // regression reds ONE test with a sentence, not fifteen with a stack trace.
  it('renames normally with NO coord store wired at all (deps.coord is optional)', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const deps = testDeps(h.home, h.run);
    expect(deps.coord, 'testDeps must keep supplying no store, or this test proves nothing')
      .toBeUndefined();
    const w = new FleetWatcher(deps, new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
  });

  // A `held` refusal coming BACK from ccd (Task 302's rung, reachable when a
  // hold lands between this loop's registry read and the queued call) is
  // TRANSIENT: the hold will be released. Retiring the incarnation on it would
  // stop naming that workspace for the life of the server process, with no log
  // line saying why.
  it('does not retire an incarnation on a `held` refusal — a hold is not permanent', async () => {
    const h = harness('{"refused":"held","detail":"program:agent-evals wave:1/4","paths":[]}');
    seed(h.home);                                   // unheld at read time; ccd refuses at call time
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);

    // A NEW title (a new retry key) must still be attempted — which it is only
    // if the incarnation was not retired.
    transcript(h.home, [TITLE('Fix the PR sheet properly')]);
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet', 'ws/fix-the-pr-sheet-properly']);
  });
  ```

  Add the two imports this needs at the top of the file, beside the existing
  `import { FleetWatcher } from '../src/watch.js';`:

  ```ts
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```
  cd server && ./node_modules/.bin/vitest run test/name-sweep.test.ts
  ```
  Expected, with no implementation yet: `will not rename a HELD workspace` fails with
  `expected [ 'ws/fix-the-pr-sheet' ] to deeply equal []`; `skips on an EMPTY hold file too` and
  `skips a row an OPEN RUN names` fail the same way. The three positive tests
  (`still renames an unclaimed row…`, `renames normally with NO coord store…`,
  `does not retire an incarnation…`) PASS already — they are the guard rails, and their passing now
  is what makes their passing later meaningful.

- [ ] **Step 3: Write the rung**

  In `server/src/watch.ts`, immediately after the line `if (r.branch !== born) continue;`:

  ```ts
      // TWELFTH CONDITION (Wave 3 §3.1). A claimed workspace is not renamed —
      // `sessionLabel` reads `branch` before `workspace`, so a rename mid-wave
      // changes what every surface calls a worker the coordinator's ledger
      // already names. BOTH halves are needed and they are in cost order:
      // `held` is a field on the row this loop already read, and it covers the
      // ordinary dispatch (the hold lands before the brief, and the sweep needs
      // an ai-title that only exists once the worker answers the brief);
      // `openRunsForSession` is a query, short-circuited away for every claimed
      // row, and it covers the workspace created by hand and adopted into a run
      // via `POST /api/runs` with a `sessionId`, which reaches `dispatched`
      // with no `.hold` on disk.
      //
      // `?.`-CHAINED, and not by taste: `testDeps` supplies no `coord` and this
      // class already treats the store as optional on eight other lines. A
      // non-optional call here TypeErrors every watcher test in the tree that
      // does not wire a store.
      //
      // Doubt reads as HELD, matching ccd's four `-e` hold readers:
      // `readRegistry` maps an unreadable-but-listed `.hold` to HOLD_UNREADABLE
      // and an empty one to HOLD_NO_REASON, both NON-null, so `!== null` is the
      // whole test and must not grow an emptiness clause.
      if (r.held !== null || (this.deps.coord?.openRunsForSession(r.id).length ?? 0) > 0) continue;
  ```

  And, on `PERMANENT_REFUSALS`, extend its docstring with:

  ```ts
  /** … existing docstring …
   *
   *  `held` (Task 302's ws-rename rung) is DELIBERATELY ABSENT and must stay
   *  absent. Every member here is permanent BY CONSTRUCTION — nothing about a
   *  later title makes a pushed branch un-pushed. A hold is the opposite: it
   *  exists to be released, and it is the ONE refusal this lane can meet that a
   *  later sweep should retry. Adding it would stop naming that workspace for
   *  the life of the process with no log line saying why. */
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```
  cd server && ./node_modules/.bin/vitest run test/name-sweep.test.ts
  cd server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
  ```
  Both green. `hold-gate` is run here because it is the file that would announce a non-optional
  `deps.coord` read, and it is cheap.

- [ ] **Step 5: Commit**

  ```
  git add server/src/watch.ts server/test/name-sweep.test.ts
  git commit -m "fix(watch): the naming sweep leaves a claimed workspace's name alone (W3 §3.1)

A rename mid-wave changes what every surface calls a worker whose ledger
already names it. Skip on held !== null OR an open run naming the session —
both halves, because an adopted workspace reaches dispatched with no hold on
disk. Reverses Build 2.5's deliberate indifference; the replaced test's
comment recorded that ruling and the new one records this one.

held stays out of PERMANENT_REFUSALS: a hold is released, a push is not undone."
  ```

---

### Task 302: `ccd ws-rename` refuses a held workspace

Defence in depth — the sweep is not the only caller, and Task 301's read-then-call has a window a
hold can land in. **AGENT-FIRST**, and it hits GATE 1.

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_rename`, identified by its header line
  `cmd_ws_rename() {   # ccd ws-rename --session <id> --branch <name> — rename a`. The rung goes
  immediately after the no-such-session guard, whose two lines read verbatim at `d7137c2`:
  ```bash
    if [[ ! -f "$REG/$id.uuid" ]]; then
      printf '{"refused":"no-such-session","detail":%s,"paths":[]}\n' \
        "$(_json_str "ccrc has no registry entry for $id")"
      return 0
    fi
  ```
- Test: `server/test/ccd-ws-rename.test.ts`

**Interfaces:**
- Consumes: `_json_str` (already probed at the top of this function); `$REG/<id>.hold`.
- Produces: the refusal token `held` on `ccd ws-rename`, emitted as
  `{"refused":"held","detail":<json>,"paths":[]}` at **exit 0**, the shape every other refusal in this
  verb uses.

**Two facts about `wsaudit.ts` that decide how this is written, both verified at `d7137c2`:**

1. `server/test/wsaudit.test.ts` scans `ccd/ccd` with `/"refused":"([a-zA-Z0-9-]+)"/` and asserts set
   equality **in both directions** against `wsaudit.ts`'s `SENTENCES`. **The tokens must therefore be
   an INLINE literal** — a helper whose format string reads `"refused":"%s"` contributes nothing to
   the scan and fails the reverse direction. `cmd_ws_rename`'s own header comment already states this
   rule for its nine existing refusals; this is the tenth.
2. **`SENTENCES` already has a `held` entry** (`'held': 'A program has this workspace held — it is
   mid-flight, so nothing was removed. Release it first…'`, emitted today by `cmd_ws_reap`). So this
   task adds **no** `wsaudit.ts` entry and the set-equality test stays green in both directions
   without being touched. Do not add a second one; do not rename the token to `rename-held` — that
   WOULD need a sentence, and it would split one fact across two words for no gain.

- [ ] **Step 1: Write the failing test — the policy reversal**

  In `server/test/ccd-ws-rename.test.ts`, REPLACE the existing test in full. Its current text
  (verified at `d7137c2`), comment included, is:

  ```ts
  // ── Build 2.5 interaction, ASSERTED rather than assumed (rider delta 7) ──
  // A rename is not a destructive act and has no hold rung: `cmd_ws_rm` and
  // `cmd_ws_reap` refuse a held workspace because they DELETE, and this moves a
  // ref on a branch that by definition has never been pushed. A hold rung here
  // would refuse the only moment automatic naming ever fires — a workspace an
  // orchestrator claimed for wave 1 is exactly the one whose first turn is
  // landing. And prhistory is appended at exactly one chokepoint, the
  // `prnumber` replacement inside `_pr_py` (ccd:759, :852); a rename precedes
  // any PR, so it must leave that file absent.
  it('renames a HELD workspace, and leaves the hold and the prhistory alone', () => {
    addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    expect(rename('demo-quiet-mesa', 'feat/real-name').new).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'hold')).toBe('program:agent-evals wave:1/4');
    expect(h.reg('demo-quiet-mesa', 'prhistory')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'prnumber')).toBeNull();
  });
  ```

  Replace with:

  ```ts
  // ── Wave 3 §3.1: POLICY REVERSAL, recorded rather than quietly swapped ──
  // Build 2.5's ruling was that a rename is not destructive and therefore needs
  // no hold rung, and that a rung here "would refuse the only moment automatic
  // naming ever fires". That second half is now the POINT: the moment automatic
  // naming fires on a claimed workspace is the moment a coordinator's ledger,
  // its brief and every fleet surface stop agreeing on what the worker is
  // called. `FleetWatcher.sweepNames` skips a claimed row before it ever calls
  // this verb; this rung is defence in depth, because the sweep is not the only
  // caller and a hold can land inside the sweep's read-then-call window.
  // prhistory is unchanged by either outcome and is still asserted here.
  it('refuses a HELD workspace, renames nothing, and leaves hold and prhistory alone', () => {
    const wt = addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('held');
    // The refusal is an ANSWER, not a fault: exit 0 (h.sh would throw otherwise,
    // which `refusal()` going through `rename()` already proves) and nothing moved.
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'hold')).toBe('program:agent-evals wave:1/4');
    expect(h.reg('demo-quiet-mesa', 'prhistory')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'prnumber')).toBeNull();
  });

  // `-e` not `-f`, matching the four existing hold readers (`cmd_ws_rm`,
  // `cmd_ws_reap`, `cmd_forget`, and `ws-release`'s own): doubt reads as HELD.
  // A directory at `$REG/<id>.hold` is the cheapest present-but-unreadable
  // shape a test can build, and `-f` would sail straight past it.
  it('refuses on a present-but-unreadable hold — doubt reads as held', () => {
    addOne();
    h.sh(`mkdir "$HOME/.cc-sessions/demo-quiet-mesa.hold"`);
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('held');
  });

  // The other direction, so the rung is a refusal rather than an outage.
  it('renames an UNHELD workspace exactly as before, and after a release', () => {
    const wt = addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    h.sh(`cmd_ws_release --session demo-quiet-mesa`);
    expect(rename('demo-quiet-mesa', 'feat/real-name').new).toBe('feat/real-name');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  // PLACEMENT, pinned: before any git work. Learning a workspace is off-limits
  // must not cost an `ls-remote` to origin — the same rule `cmd_ws_reap`'s copy
  // of this rung states for itself ("before, because learning a workspace is
  // off-limits must not cost a gh call, a fetch, or a lock left behind"). The
  // poisoned `gh` and a refused rename share one property: neither should have
  // run at all.
  it('refuses before it touches git or the network', () => {
    addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    // A `git` that records every call and then refuses: if the rung is placed
    // after the worktree/upstream probes, one of them fires and this reds.
    const NOGIT = `git() { echo "git $*" >> "$HOME/ccd-calls"; return 1; };`;
    const o = JSON.parse(
      h.sh(`${NOGIT} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`),
    ) as { refused?: string };
    expect(o.refused).toBe('held');
    expect(h.calls().filter((c) => c.startsWith('git ')), 'a refused rename runs no git')
      .toEqual([]);
    expect(h.ghPoison(), 'a refused rename reaches no gh').toEqual([]);
  });
  ```

  Then add, at the bottom of the same `describe('ws-rename', …)` block, the mutation-table pin for the
  scan the token has to survive:

  ```ts
  // The token must be an INLINE literal in ccd, not a helper argument:
  // `server/test/wsaudit.test.ts` harvests `/"refused":"([a-zA-Z0-9-]+)"/` out
  // of this file's source and asserts set equality in BOTH directions against
  // `wsaudit.ts`'s SENTENCES. `held` already HAS a sentence (cmd_ws_reap emits
  // it), so nothing new is owed there — but a helper-ised emission would
  // contribute no token at all and the reverse direction would go red for a
  // reason whose author would never guess it.
  it('emits the held token as an inline literal inside cmd_ws_rename', () => {
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('cmd_ws_rename() {');
    const to = src.indexOf('\ncmd_', from + 1);
    const body = src.slice(from, to === -1 ? undefined : to);
    expect(body).toContain('"refused":"held"');
  });
  ```

  and add `readFileSync` to the file's `node:fs` import (it currently imports `fs` as a namespace —
  use `fs.readFileSync(CCD, 'utf8')` instead if that is tidier; `CCD` is already imported).

- [ ] **Step 2: Run the test to verify it fails**

  ```
  cd server && ./node_modules/.bin/vitest run test/ccd-ws-rename.test.ts
  ```
  Expected: `refuses a HELD workspace…` fails with
  `expected a refusal, got {"renamed":"demo-quiet-mesa","old":"ws/quiet-mesa","new":"feat/real-name"}`
  (from `refusal()`'s own message); `refuses on a present-but-unreadable hold` and
  `refuses before it touches git or the network` fail the same way; the inline-literal pin fails with
  `expected '…' to contain '"refused":"held"'`.

- [ ] **Step 3: Write the rung**

  In `ccd/ccd`, inside `cmd_ws_rename`, immediately after the `no-such-session` block quoted above:

  ```bash
    # A hold is a program's declaration that this workspace is mid-flight. WAVE 3
    # §3.1 REVERSES this verb's Build 2.5 policy, and the reversal is the point
    # rather than a side effect: `ws-rm`/`ws-reap`/`forget` refuse a held
    # workspace because they DELETE, and this verb only moves a ref — but the ref
    # it moves is the one every ccrc surface reads as the session's NAME
    # (`sessionLabel` is `name ?? branch ?? workspace ?? id`), so renaming
    # mid-wave leaves a coordinator's ledger, its brief and the fleet screen
    # disagreeing about which worker is which. `FleetWatcher.sweepNames` skips a
    # claimed row before it ever calls this; this rung is defence in depth,
    # because the sweep is not the only caller and a hold can land inside its
    # read-then-call window.
    #
    # PLACED HERE: after the argv/id guards (a caller whose argv this function
    # would not accept must not receive a well-formed ANSWER) and before every
    # git and network probe (learning a workspace is off-limits must not cost an
    # `ls-remote`) — the same placement rule `cmd_ws_reap`'s copy of this rung
    # states for itself.
    #
    # `-e` not `-f`, matching the four existing hold readers: an unreadable-but-
    # present hold still refuses, because doubt reads as HELD.
    #
    # THE TOKENS ARE INLINE, per this function's own header: `wsaudit.test.ts`
    # harvests them out of this file's bytes. `held` already has a SENTENCES
    # entry (cmd_ws_reap emits it), so nothing is owed on the server side.
    #
    # The verb's deliberate absence of a BUSY guard is UNCHANGED and stays
    # deliberate: the naming moment is by definition a busy moment.
    if [[ -e "$REG/$id.hold" ]]; then
      printf '{"refused":"held","detail":%s,"paths":[]}\n' \
        "$(_json_str "$(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>') — release first: ccd ws-release --session $id")"
      return 0
    fi
  ```

- [ ] **Step 4: Run the tests to verify they pass, plus the two scans this token lives under**

  ```
  cd server && ./node_modules/.bin/vitest run test/ccd-ws-rename.test.ts
  cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts
  cd server && ./node_modules/.bin/vitest run test/name-sweep.test.ts
  ```
  All three green. `wsaudit` is the set-equality scan in both directions; `name-sweep` is run because
  Task 301's `held`-refusal test now describes a token ccd can really emit.

- [ ] **Step 5: Re-stamp the provenance marker and commit — IN THE SAME COMMIT**

  ```
  node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
    const { markGenerated } = await import('./shared/mark.mjs'); \
    writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
  cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
  ```
  Then, from the repo root:
  ```
  git add ccd/ccd server/test/ccd-ws-rename.test.ts
  git commit -m "feat(ccd): ws-rename refuses a held workspace (W3 §3.1)

Reverses Build 2.5's 'a rename is not destructive, so no hold rung'. The ref
this verb moves is the one every surface reads as the session's name, so a
rename mid-wave desynchronises a coordinator's ledger from the fleet. Rung is
-e not -f (doubt reads as held), placed before any git or network probe, and
its tokens are inline so wsaudit.test.ts's both-directions scan sees them.
'held' already has a SENTENCES entry; none is added.

Provenance marker re-stamped in this commit."
  ```

---

### Task 303: `_auto_swap_check`'s affinity path defers while a hold exists

**The rescue path is untouched.** The two arms are already distinct in shipped code and the rung goes
in the second one only. Put it ahead of the rescue branch and a wedged mid-wave worker is stranded on
a dead account for the life of its hold — which converts the hold from a protection into a way to
lose a wave. This is the honest reading of Q12: **cosmetic relocation yes, rescue no.**

**AGENT-FIRST**, GATE 1 applies.

**Files:**
- Modify: `ccd/ccd` — `_auto_swap_check`, identified by its header line
  `_auto_swap_check() {   # id — called each supervise tick. HOME-account affinity:`. The rung is the
  FIRST line of the affinity block, i.e. immediately after the `fi` that closes
  `if [[ -n "$hard_blocked" ]]; then … fi` and immediately before this comment/line pair (verified
  verbatim at `d7137c2`):
  ```bash
    # Otherwise (returning home, or leaving at the rate ceiling): relocate only at a clean turn
    # boundary — never mid-turn or mid-subagent. The idle gate reads the live process status file;
    # pane heuristics alone miss running subagents (learned 2026-07-03).
    echo "$pane" | grep -q "esc to interrupt" && return 0    # mid-turn: wait for the gap
  ```
- Create: `server/test/ccd-auto-swap-hold.test.ts`

**Interfaces:**
- Consumes: `$REG/<id>.hold`.
- Produces: no new name. Behavioural contract: `_auto_swap_check` runs `_dispatch_swap` for a held,
  hard-blocked session and does not for a held, idle-and-at-a-prompt one.

**This is a VACUUM to build, not a red to fix.** The only suite driving `_auto_swap_check` today
(`server/test/ccd-swap-refuse.test.ts`) exercises the RESCUE arm — its `AUTO_TICK_STUBS` returns
`"API Error: 429 Too Many Requests"` from `capture-pane`, which the real `_pane_hard_blocked` matches.
So the affinity-only defer reds nothing in the existing tree and would ship untested. Both directions
have to be built here, including the affinity fixture, which does not exist anywhere.

- [ ] **Step 1: Write the failing test file**

  Create `server/test/ccd-auto-swap-hold.test.ts`:

  ```ts
  // Wave 3 §3.3. `_auto_swap_check` runs on the 5-second supervise tick and
  // relocates a session between accounts. Two arms, already distinct in shipped
  // code, and this file is the whole reason the distinction is safe to rely on:
  //
  //   RESCUE  — `_pane_hard_blocked` matched (limit/spend banner, or auth lost).
  //             Swaps IMMEDIATELY, deliberately bypassing the idle gate, because
  //             the session is stuck anyway. UNTOUCHED by this wave.
  //   AFFINITY— returning home, or leaving because home hit SWAP_CEILING. Gated
  //             on a clean turn boundary, otherwise unconditional. This one now
  //             DEFERS while `$REG/<id>.hold` exists.
  //
  // A mid-wave worker must not have its session restarted and its transcript
  // copied to another account because telemetry drifted. A BLOCKED mid-wave
  // worker must still be rescued, or the hold becomes a way to strand a wedged
  // wave. The existing `_auto_swap_check` suite (ccd-swap-refuse.test.ts) drives
  // ONLY the rescue arm, so without this file the affinity defer would ship with
  // no test at all in either direction.
  //
  // FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
  // boundary and nothing here may reach the live registry, tmux, or systemd.
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-auto-swap-hold-'); });
  afterEach(() => { h.cleanup(); });

  const ID = 'claude-demo';
  const PANE_PID = '4242';

  /** A live-looking session on `claude`, written with `_reg_set` — the same
   *  writer ccd uses. `lastswap`/`swapblocked` are deliberately absent so both
   *  cooldown gates are open and the test is about the hold rung alone. */
  const seed = (): void => {
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
      _reg_set ${ID} project demo
      _reg_set ${ID} workdir "$HOME/projects/demo"
      _reg_set ${ID} wrapper claude
      _reg_set ${ID} started 1`);
  };

  /** The AFFINITY arm's fixture, which nothing in the tree had: a pane at a
   *  clean prompt (no `esc to interrupt`, a `❯`), a pane pid, and a status file
   *  that says idle with a `statusUpdatedAt` far older than SWAP_CEIL_QUIET
   *  (30 s) — every gate open except the one under test. `_swap_target` and
   *  `_avail` are stubbed so the decision is not a function of the fixture
   *  roster's live telemetry. */
  const AFFINITY_STUBS = `
    tmux() { case "\${1:-}" in
               capture-pane) printf '%s\\n' "❯ " ;;
               list-panes)   echo ${PANE_PID} ;;
             esac; return 0; };
    _swap_target() { echo claude2; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
  `;

  /** The RESCUE arm's fixture: a real limit banner, matched by the REAL
   *  `_pane_hard_blocked` (deliberately not stubbed — the classifier IS the
   *  discriminator this test is about). */
  const RESCUE_STUBS = `
    tmux() { case "\${1:-}" in
               capture-pane) echo "API Error: 429 Too Many Requests" ;;
             esac; return 0; };
    _swap_target() { echo claude2; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
  `;

  const idleStatus = (): void => {
    const dir = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
      JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
  };

  const hold = (reason = 'program:build8 wave:2/4 run:17'): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.hold`), reason);
  };

  describe('_auto_swap_check and a held workspace', () => {
    it('relocates an UNHELD session on the affinity path (the fixture really is open)', () => {
      // Written first and asserted first: without it, every negative below is
      // vacuous — a fixture that never dispatches proves nothing about a rung.
      seed(); idleStatus();
      h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
    });

    it('does NOT relocate a HELD session on the affinity path', () => {
      seed(); idleStatus(); hold();
      h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).not.toContain('dispatch');
      expect(h.reg(ID, 'lastswap'), 'a deferred tick stamps nothing').toBeNull();
    });

    it('STILL RESCUES a held session that is hard-blocked — a hold must not strand a wedged wave', () => {
      // The mutant this kills is placing the rung ahead of the rescue branch,
      // which reads as "a hold forbids relocation" and is the reading that
      // loses a wave: a worker on a rate-limited account with a hold standing
      // would never be evacuated, and the hold is exactly what stops a human
      // noticing quickly.
      seed(); hold();
      h.sh(`${RESCUE_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
    });

    it('defers on a present-but-unreadable hold — `-e` not `-f`', () => {
      // Matching the four existing hold readers: doubt reads as HELD. `-f`
      // sails straight past a directory at that path.
      seed(); idleStatus();
      fs.mkdirSync(path.join(h.home, '.cc-sessions', `${ID}.hold`));
      h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).not.toContain('dispatch');
    });

    it('relocates again once the hold is released', () => {
      seed(); idleStatus(); hold();
      h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).not.toContain('dispatch');
      fs.rmSync(path.join(h.home, '.cc-sessions', `${ID}.hold`));
      h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
      expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```
  cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts
  ```
  Expected: `relocates an UNHELD session…` and `STILL RESCUES…` PASS (they describe shipped
  behaviour, and their passing now is what makes the fixture trustworthy);
  `does NOT relocate a HELD session…`, `defers on a present-but-unreadable hold` and
  `relocates again once the hold is released` FAIL with
  `expected '…dispatch claude-demo -> claude2…' not to contain 'dispatch'`.

- [ ] **Step 3: Write the rung**

  In `ccd/ccd`, inside `_auto_swap_check`, as the FIRST line of the affinity block — after the `fi`
  closing the `hard_blocked` branch, before the `# Otherwise (returning home, …` comment:

  ```bash
    # WAVE 3 §3.3, AND THE PLACEMENT IS THE WHOLE RULING. Everything from here
    # down is the AFFINITY path: returning home, or leaving because home hit
    # SWAP_CEILING. It relocates a session for reasons that are, from a running
    # wave's point of view, cosmetic — and a relocation restarts the session and
    # copies its transcript to another account. A mid-wave worker must not have
    # that happen to it because telemetry drifted.
    #
    # AHEAD OF THE RESCUE BRANCH THIS WOULD STRAND A WEDGED WAVE: a held worker
    # sitting on a rate-limited account would never be evacuated, and a hold is
    # exactly what stops a human noticing quickly. Cosmetic relocation yes,
    # rescue no. The rescue arm above is untouched and must stay untouched.
    #
    # `-e` not `-f`, matching the four existing hold readers: an unreadable hold
    # defers too, because doubt reads as HELD.
    [[ -e "$REG/$id.hold" ]] && return 0
  ```

- [ ] **Step 4: Run the tests to verify they pass, plus the neighbouring swap suites**

  ```
  cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-swap-refuse.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts
  ```
  All green. The three existing swap suites are run because they seed no hold, so the rung must be
  invisible to every one of them; if one goes red, the rung is in the wrong arm.

- [ ] **Step 5: Re-stamp the provenance marker and commit — IN THE SAME COMMIT**

  ```
  node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
    const { markGenerated } = await import('./shared/mark.mjs'); \
    writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
  cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
  ```
  ```
  git add ccd/ccd server/test/ccd-auto-swap-hold.test.ts
  git commit -m "feat(ccd): the affinity swap defers while a hold stands; rescue does not (W3 §3.3)

_auto_swap_check relocates on a 5s tick with no reference to the claim. The
affinity arm (return-home / ceiling) now returns early on -e \$REG/<id>.hold;
the hard-blocked rescue arm is untouched, because a hold that forbade rescue
would be a way to strand a wedged wave on a dead account.

New suite: the only existing _auto_swap_check tests drive the rescue arm, so
the affinity fixture (clean prompt + idle status file) did not exist and the
defer would have shipped untested in both directions.

Provenance marker re-stamped in this commit."
  ```

---

### Task 304: the registry can tell an absent branch from an unreadable one

Prerequisite for Task 305, and the reason it is its own task: `verifyDone`'s new
`branch-unmeasurable` refusal is a claim about a **measurement failure**, and today
`SessionRecord.branch` cannot support that claim. `branch` is read by plain `field(...)`, which is
verbatim at `d7137c2`:

```ts
async function field(io: FleetIO, dir: string, id: string, name: string): Promise<string | null> {
  const content = await io.readFile(path.join(dir, `${id}.${name}`));
  return content !== null ? content.trim() : null;
}
```

`io.readFile` maps a missing file and a failed remote read to the same `null`, so `branch: null`
means "absent" and "listed but its bytes did not come back" indistinguishably. Naming a refusal
`unmeasurable` over that is an overclaim. The identity triple and `held` already solve this with
`names.includes(...)` against the listing `buildRecord` opened with; `branch` gets the same evidence.

**Files:**
- Modify: `server/src/registry.ts` — `SessionRecord`, at the field declared verbatim as
  `workspace: string | null; branch: string | null;`
- Modify: `server/src/registry.ts` — `buildRecord`, identified by
  `async function buildRecord(` and by the loop that ends
  `if (raw === null && names.includes(`${id}.${f}`)) lifecycleUnmeasured.push(f);`
- Modify: `server/test/hold-gate.test.ts` — the one `SessionRecord` literal in the tree, identified by
  `const degraded: SessionRecord = {`
- Test: `server/test/registry.test.ts`

**Interfaces:**
- Produces: `SessionRecord.branchUnmeasured: boolean` — `true` iff `.branch` was LISTED in the
  registry directory and its bytes did not come back. Server-side only; it does **not** reach the wire
  and no `FleetSession` field carries it, so `FLEET_PROTO` is untouched and `reviveFleetSession` is
  not involved.

**Two decisions, stated so nobody reverses them by "tidying":**

1. **NOT a `LifecycleField`.** That union is `'started' | 'stopped' | 'supervised'` and feeds
   `sessionLifecycle`'s `unmeasurable` rung. A branch nobody could read says nothing about whether a
   session is running; routing it there would make an unreadable `.branch` blank out the lifecycle
   chip on a healthy row.
2. **NOT added to `unmeasured`.** That array is `IdentityField[]`, is carried onto the wire verbatim,
   and is validated against the identity triple by `reviveFleetSession` — widening it rejects every
   persisted snapshot.

- [ ] **Step 1: Write the failing test**

  In `server/test/registry.test.ts`, add to the `describe('readRegistry', …)` block (the file already
  has the `unreadableField(id, field)` helper and the `seed(...)` helper this needs):

  ```ts
  // Wave 3 §3.2's prerequisite. `field()` collapses "the file is not there" and
  // "the file is there and its bytes did not come back" into the same null, and
  // `verifyDone`'s `branch-unmeasurable` refusal is a claim about the SECOND
  // one specifically. `names` is the listing `buildRecord` opened with, so it
  // proves PRESENCE independently of whether the read succeeded — the same
  // evidence the identity triple and `held` already use.
  it('marks a LISTED but unreadable .branch as unmeasured — never as absent', async () => {
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin',
    });
    const rec = (await readRegistry(unreadableField('demo-quiet-basin', 'branch'), cfg))[0]!;
    expect(rec.branch, 'an unreadable field still reads null on its own value').toBeNull();
    expect(rec.branchUnmeasured).toBe(true);
  });

  it('a genuinely absent .branch is absent, not unmeasured', async () => {
    // A project's MAIN checkout has no branch field at all. Calling that
    // "unmeasurable" would be the overclaim this distinction exists to stop.
    seed(reg, 'claude-demo', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const rec = (await readRegistry(localIO, cfg)).find((r) => r.id === 'claude-demo')!;
    expect(rec.branch).toBeNull();
    expect(rec.branchUnmeasured).toBe(false);
  });

  it('a readable branch is measured and its flag is false', async () => {
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin',
    });
    const rec = (await readRegistry(localIO, cfg))[0]!;
    expect(rec.branch).toBe('ws/quiet-basin');
    expect(rec.branchUnmeasured).toBe(false);
  });

  // The two shapes it must NOT be conflated with, pinned so a later "tidy-up"
  // cannot fold it into either array.
  it('an unreadable branch degrades neither the identity triple nor the lifecycle read', async () => {
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin', started: '1',
    });
    const rec = (await readRegistry(unreadableField('demo-quiet-basin', 'branch'), cfg))[0]!;
    expect(rec.unmeasured, '`unmeasured` is IdentityField[] and rides the wire — do not widen it')
      .toEqual([]);
    expect(rec.lifecycleUnmeasured,
      'a branch nobody could read says nothing about whether the session is running').toEqual([]);
  });
  ```

  (If `seed`/`unreadableField`/`localIO`/`cfg`/`reg` are named differently in the surrounding
  `describe` at execution time, re-derive them by reading the file's own top — they exist at
  `d7137c2` under exactly these names.)

- [ ] **Step 2: Run the test to verify it fails**

  ```
  cd server && ./node_modules/.bin/vitest run test/registry.test.ts
  ```
  Expected: a TypeScript error at build/transform time —
  `Property 'branchUnmeasured' does not exist on type 'SessionRecord'` — on every one of the four new
  tests.

- [ ] **Step 3: Write the field and its computation**

  In `server/src/registry.ts`, change the `SessionRecord` line

  ```ts
    workspace: string | null; branch: string | null;
  ```

  to

  ```ts
    workspace: string | null; branch: string | null;
    /** `.branch` was LISTED in the registry directory this read opened with,
     *  and its bytes did not come back — i.e. `branch` above is null because a
     *  READ FAILED, not because the field is absent. `field()` cannot tell the
     *  two apart (`io.readFile` maps both to null), and `verifyDone`'s
     *  `branch-unmeasurable` refusal (Wave 3 §3.2) is a claim about this one
     *  specifically, so the record has to be able to make the distinction the
     *  code asserts. Same evidence rule as the identity triple and `held`.
     *
     *  Deliberately NOT a `LifecycleField` and deliberately NOT a member of
     *  `unmeasured`. `LifecycleField` feeds `sessionLifecycle`'s `unmeasurable`
     *  rung, and a branch nobody could read says nothing about whether a
     *  session is running; `unmeasured` is `IdentityField[]`, rides the wire
     *  verbatim, and is validated against the identity triple by
     *  `reviveFleetSession` — widening it would reject every persisted
     *  snapshot. This flag is server-side only and reaches no wire field. */
    branchUnmeasured: boolean;
  ```

  In `buildRecord`, immediately after the `lifecycleUnmeasured` block (i.e. after the
  `if (stopStamp === null && (stoppedRaw !== null || names.includes(`${id}.stopped`))) { … }` block
  and before the `return {`):

  ```ts
    // `names` is the listing this function opened with — PRESENCE, independently
    // of whether the bytes came back. See `SessionRecord.branchUnmeasured` for
    // why this is its own flag rather than a member of either existing array.
    const branchUnmeasured = branch === null && names.includes(`${id}.branch`);
  ```

  and add `branchUnmeasured,` to the returned literal, immediately after the existing
  `workspace, branch,` line.

  In `server/test/hold-gate.test.ts`, the `const degraded: SessionRecord = {` literal gains
  `branchUnmeasured: false,` — put it on the line that already reads
  `workspace: 'quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main',`.

- [ ] **Step 4: Run the tests to verify they pass**

  ```
  cd server && ./node_modules/.bin/vitest run test/registry.test.ts
  cd server && ./node_modules/.bin/vitest run test/hold-gate.test.ts
  cd server && ./node_modules/.bin/vitest run test/fleet.test.ts
  ```
  All green. `fleet.test.ts` is run because `assembleFleet` consumes `SessionRecord`; it builds its
  records through `readRegistry` rather than as literals, so it should be unaffected — running it is
  how you find out cheaply rather than at the end of the wave.

- [ ] **Step 5: Commit**

  ```
  git add server/src/registry.ts server/test/registry.test.ts server/test/hold-gate.test.ts
  git commit -m "feat(registry): branch gets the listed-but-unreadable evidence rule (W3 §3.2 prereq)

field() collapses 'absent' and 'listed but the read failed' into one null, and
Wave 3's branch-unmeasurable refusal is a claim about the second. Give branch
the names.includes treatment the identity triple and held already use, as its
own boolean: not a LifecycleField (it says nothing about liveness) and not a
member of unmeasured (that array is IdentityField[] and rides the wire)."
  ```

---

### Task 305: the done-fingerprint stops guessing at a renamed branch

`verifyDone`'s branch resolution is one line at `d7137c2` — `const branch = record?.branch ?? run.branch;`
— and it collapses two states the caller and the coordinator handle differently. `runs.branch` is
written once by `markDispatched` and never updated, so after a rename it names a ref `git branch -m`
deleted, and a transient registry read failure becomes a permanent `tip-unmeasurable` on a branch that
will never exist. Task 301 makes the rename-mid-run case unreachable on the ordinary path; this is the
belt to that braces.

**A new refusal code is not a free string, and the whole cost lands in ONE task on purpose.**
`server/test/mail-routes.test.ts` requires every declared `MailRejectCode` to appear as a quoted
literal somewhere under `server/src/coord`, and `server/test/coordinator-skill.test.ts` iterates
`MAIL_REJECT_CODES` and requires each to be named in the skill corpus. Both go red on any commit that
adds the member without its emitter and its skill row. **Sequence them together or the branch has red
intermediate commits.**

**Keep the PREFIXED name.** A bare `unmeasurable` would collide with the `SessionLifecycle` member PR
#50 put in the same file — one word, two vocabularies, in `shared/api.ts`. `branch-unmeasurable` sits
beside `tip-unmeasurable` and `pr-unmeasurable`, which is exactly the family it belongs to.

**Files:**
- Modify: `shared/api.ts` — `MAIL_REJECT_CODES`, identified by its literal
  `export const MAIL_REJECT_CODES = [` and its `// done-authority` comment line
- Modify: `server/src/coord/fingerprint.ts` — `DoneVerdict`'s `Extract`, identified by the line
  `      'stale-tip' | 'tip-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' | 'no-handoff-commit'>;`
- Modify: `server/src/coord/fingerprint.ts` — `verifyDone`, at the line
  `  const branch = record?.branch ?? run.branch;`
- Modify: `server/src/coord/fingerprint.ts` — the `DoneRun.branch` docstring, identified by its
  sentence "`branch` here is a FALLBACK, not the measurement"
- Modify: `server/src/coord/close.ts` — the `doneVerdict` arm's `Extract`, identified by
  `      code: Extract<MailRejectCode, 'stale-tip' | 'tip-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' |`
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — the `§4` reject-code table, identified
  by its header row `| reject.code | meaning |` and its `tip-unmeasurable` row
- Test: `server/test/coord-fingerprint.test.ts`

**Interfaces:**
- Consumes: `SessionRecord.branchUnmeasured: boolean` (Task 304).
- Produces: `MailRejectCode` gains `'branch-unmeasurable'`; `DoneVerdict`'s refusal `code` union and
  `CloseOutcome`'s `doneVerdict` arm both widen to include it. `verifyDone`'s signature is UNCHANGED.

**No PWA copy is needed, and that is stated positively so nobody adds any:** nothing on the client
reads `MailRejectCode` — `MailSummary` carries no `rejectCode`, `MailStrip` branches only on
`state === 'rejected'`, and `ABANDON_COPY` is keyed on run-refusal codes, deliberately not on the mail
set.

**AGENT-FIRST**, because it edits `ccd/coordinator-skill/`. It does **not** touch `ccd/ccd`, so GATE 1
does not apply to this task.

- [ ] **Step 1: Write the failing tests**

  In `server/test/coord-fingerprint.test.ts`, inside
  `describe('verifyDone — the branch to re-measure comes from the live registry (finding 1)', …)`,
  which already carries the `seedRegistry(home, branch)` helper this needs:

  ```ts
  // ── Wave 3 §3.2 ──
  // `record?.branch ?? run.branch` collapsed two states a caller handles
  // differently. NO OVERLOADED NULL AT A SEAM: "the registry has no row for this
  // session" and "the row is right here and its own .branch is null" are
  // different facts with different remedies, and only the first justifies
  // falling back on a column `markDispatched` froze at dispatch time and
  // nothing ever updates.
  //
  // NOTE this is a VACUUM, not a red: no existing test in this tree asserted
  // `{ok:true}` for the record-present/branch-null case — `seedRegistry` is
  // called exactly once at d7137c2, with a real branch. The case simply had no
  // coverage in either direction, which is why the wrong behaviour survived.
  it('refuses branch-unmeasurable when the row is PRESENT and its own .branch could not be read', async () => {
    const home = mkTmp('ccrc-fp-');
    seedRegistry(home, null);                 // row present (uuid/wrapper/workdir written), no branch
    const root = project(TIP, null);          // the ref DOES exist at RUN.branch — the guess would work
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: false, code: 'branch-unmeasurable' });
    // The fixture is built so the OLD behaviour would have answered ok:true —
    // that is what makes this a behaviour pin rather than a coincidence.
  });

  it('still falls back to the run row when the registry has NO row for this session — and says so', async () => {
    const home = mkTmp('ccrc-fp-');           // no row seeded at all
    const root = project(null, null);         // and no readable ref, so we can read the detail
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: false, code: 'tip-unmeasurable' });
    expect((res as { detail: string }).detail)
      .toContain('from the run row, which predates any rename');
  });

  it('does NOT add the run-row clause when the branch came from the live registry', async () => {
    // The mutant this kills: appending the provenance sentence unconditionally,
    // which would tell a coordinator its measurement was stale every time.
    const home = mkTmp('ccrc-fp-');
    seedRegistry(home, 'ws/fix-the-parser');
    const root = project(null, null);         // no ref at the registry's name either
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: false, code: 'tip-unmeasurable' });
    expect((res as { detail: string }).detail).not.toContain('predates any rename');
  });

  it('names WHICH kind of unmeasurable in the detail — a failed read, not a missing field', async () => {
    // Task 304's flag is what lets the refusal say something true. Without it
    // both shapes would have to share one sentence, and one of the two would be
    // a lie.
    const home = mkTmp('ccrc-fp-');
    seedRegistry(home, 'ws/fix-the-parser');
    const root = project(TIP, null);
    const io: FleetIO = {
      ...localIO,
      readFile: async (p) => (p.endsWith(`${SESSION}.branch`) ? null : localIO.readFile(p)),
    };
    const deps = { ...fingerprintDeps(runnerFor('open'), root, home), io };
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: false, code: 'branch-unmeasurable' });
    expect((res as { detail: string }).detail).toContain('bytes did not come back');
  });
  ```

  Add `import { localIO } from '../src/io.js';` and `import type { FleetIO } from '../src/io.js';` if
  the file does not already carry them.

- [ ] **Step 2: Run the test to verify it fails**

  ```
  cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts
  ```
  Expected: `refuses branch-unmeasurable when the row is PRESENT…` fails with
  `expected { ok: true, measured: {…} } to match object { ok: false, code: 'branch-unmeasurable' }`;
  `still falls back to the run row…` fails on the missing detail clause; the fourth fails the same way
  as the first. TypeScript also rejects `'branch-unmeasurable'` as a `MailRejectCode` — that is the
  same failure, one layer up.

- [ ] **Step 3: Write the member, the two `Extract`s, the split, and the skill row**

  **(a)** `shared/api.ts`, `MAIL_REJECT_CODES` — the `// done-authority` group gains one member, placed
  beside its family:

  ```ts
    // done-authority
    'stale-tip', 'tip-unmeasurable', 'branch-unmeasurable', 'pr-regressed', 'pr-unmeasurable',
    'no-handoff-commit',
  ```

  The docstring's `tip-unmeasurable`/`pr-unmeasurable` paragraph gains one sentence:

  ```
   * `branch-unmeasurable` is the third member of that family and it answers a
   * question one rung earlier: not "what is this branch's tip" but "which
   * branch". A registry row that is present and whose own `.branch` reads null
   * has DECLINED to name one, and the run row's frozen `branch` column is not
   * an answer — `markDispatched` writes it once and nothing updates it, so
   * after a rename it names a ref `git branch -m` deleted.
  ```

  **(b)** `server/src/coord/fingerprint.ts`, `DoneVerdict`:

  ```ts
  export type DoneVerdict =
    | { ok: true; measured: { branchTip: string; prNumber: number | null; prPhase: PrPhase } }
    | { ok: false; code: Extract<MailRejectCode,
        'stale-tip' | 'tip-unmeasurable' | 'branch-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' |
        'no-handoff-commit'>;
        detail: string };
  ```

  **(c)** `server/src/coord/close.ts`, the `doneVerdict` arm:

  ```ts
    | { ok: false; kind: 'doneVerdict';
        code: Extract<MailRejectCode, 'stale-tip' | 'tip-unmeasurable' | 'branch-unmeasurable' |
          'pr-regressed' | 'pr-unmeasurable' | 'no-handoff-commit'>;
        detail: string }
  ```

  **(d)** `server/src/coord/fingerprint.ts`, `verifyDone`. Replace the single line
  `  const branch = record?.branch ?? run.branch;` with:

  ```ts
    // WAVE 3 §3.2. The `??` this replaces collapsed two states the caller and
    // the coordinator handle differently — no overloaded null at a seam:
    //
    //  1. NO RECORD AT ALL (retired, purged, or a narrowed drop). `run.branch`
    //     is the only name left and it is worth using — but it is a column
    //     `markDispatched` wrote once at dispatch time and NOTHING ever
    //     updates, so any refusal it produces must say where it came from.
    //     Otherwise a coordinator reads "no readable ref for ws/quiet-mesa" and
    //     goes looking for a branch that was renamed hours ago.
    //  2. RECORD PRESENT, its own `.branch` null. The record DECLINED to name a
    //     branch; guessing with the frozen column is exactly the move that
    //     turns a transient registry read failure into a permanent
    //     `tip-unmeasurable` on a ref that will never exist. Refuse instead,
    //     and let the ordinary replay re-measure (spec:174-177, D-10).
    //
    // `branchUnmeasured` (registry.ts) is what lets case 2's detail be TRUE
    // rather than merely typed: a listed-but-unreadable `.branch` is transient
    // and a genuinely absent one is not, and one sentence covering both would
    // be a lie about one of them.
    let branch: string;
    let branchFromRunRow = false;
    if (record === undefined) {
      branch = run.branch;
      branchFromRunRow = true;
    } else if (record.branch === null) {
      return { ok: false, code: 'branch-unmeasurable',
        detail: record.branchUnmeasured
          ? `the registry lists ${run.sessionId}.branch but its bytes did not come back — ` +
            'transient, not a fact about this run'
          : `the registry row for ${run.sessionId} names no branch at all — there is nothing to ` +
            're-measure, and the run row\'s own branch column was frozen at dispatch time' };
    } else {
      branch = record.branch;
    }
    /** Appended to every refusal below that NAMES `branch`, and only when the
     *  name came from the frozen run row. Empty on the ordinary path, so the
     *  coordinator is never told its measurement is stale when it is not. */
    const provenance = branchFromRunRow ? ' — from the run row, which predates any rename' : '';
  ```

  Then append `${provenance}` to the two refusal details that name `branch`. The
  `tip-unmeasurable` one becomes:

  ```ts
    if (tip === null) {
      return { ok: false, code: 'tip-unmeasurable',
        detail: `no readable ref for ${branch} under ${run.project}${provenance}` };
    }
  ```

  and the `stale-tip` one's first clause becomes:

  ```ts
      return { ok: false, code: 'stale-tip',
        detail: `${branch}${provenance} is at ${tip}, the claim says ${claim.branchTip} — if the ` +
          'worker committed on a DIFFERENT branch than this workspace\'s own, that is the ' +
          'almost-certain cause: the brief must instruct the worker to commit on its workspace ' +
          'branch, never a separate feature branch' };
  ```

  **(e)** `server/src/coord/fingerprint.ts`, the `DoneRun.branch` docstring. It currently enumerates
  four reachable triggers for the fallback, two of which no longer reach it. Correct it:

  ```
   *  `branch` here is a FALLBACK, not the measurement, and after Wave 3 §3.2 it
   *  is reached by EXACTLY ONE state: the live registry has no row for this
   *  session at all (retired, purged, or a narrowed drop `readRegistry` itself
   *  logs). The other three states this comment used to list are now refused
   *  above it rather than silently falling through — a failed directory listing
   *  and an unmeasurable identity were already refused `tip-unmeasurable`, and a
   *  found row whose own `.branch` is null is refused `branch-unmeasurable`.
   *  Do not read this type as "the run's branch"; it is "the run's branch, if
   *  the live registry has nothing to say about this session at all" — and
   *  because `markDispatched` writes the column once and nothing updates it,
   *  every refusal produced from it says so in its own detail.
  ```

  **(f)** `ccd/coordinator-skill/references/wave-lifecycle.md`, the `§4` reject-code table. Insert ONE
  row immediately after the `tip-unmeasurable` row:

  ```
  | `branch-unmeasurable` | the workspace's branch could not be resolved: the live registry has a row for this session and the row's own branch field is null — either listed with bytes that did not come back (transient) or absent (not). Not evidence either way; the run is unchanged | re-submit once the registry reads clean. If it keeps answering this, the session's registry row needs a human — the run row's frozen branch column is deliberately not used as a guess |
  ```

  **This row must NOT mention `ws-reap`, `ws-rm` or `ws-gc`** — `coordinator-skill.test.ts` counts
  every occurrence of those three across SKILL.md and BOTH references and requires the count to equal
  what contract clause 3 alone contains. No new sentence in any skill file may name any of them, **not
  even to forbid them again.** SKILL.md is not touched by this task and its nine pinned clauses stay
  byte-identical.

- [ ] **Step 4: Run the tests to verify they pass — all four suites this member touches**

  ```
  cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts
  cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts
  cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
  cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
  cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts
  ```
  All green. `mail-routes` is the "every declared code is emitted under `server/src/coord`" scan;
  `coordinator-skill` is the "every declared code is named in the corpus" scan; the last two exercise
  `/advance` and `/close` end to end and their fixtures seed a real `branch` (`run-routes.test.ts`'s
  own `seed()` writes `branch: ws/${id}`), so both must stay green — if either reds, a fixture is
  reaching case 2 and the fixture, not the guard, is what to look at.

- [ ] **Step 5: Commit**

  ```
  git add shared/api.ts server/src/coord/fingerprint.ts server/src/coord/close.ts \
          ccd/coordinator-skill/references/wave-lifecycle.md server/test/coord-fingerprint.test.ts
  git commit -m "fix(fingerprint): a present row with no branch refuses, it does not guess (W3 §3.2)

record?.branch ?? run.branch collapsed 'no row at all' and 'the row declined to
name a branch'. runs.branch is written once by markDispatched and never
updated, so guessing with it turns a transient read failure into a permanent
tip-unmeasurable on a ref git branch -m deleted.

Record absent -> fall back AND say so in the detail. Record present with a null
branch -> branch-unmeasurable, whose detail distinguishes a failed read from an
absent field using registry.branchUnmeasured.

The code joins MAIL_REJECT_CODES, both Extracts, and wave-lifecycle.md's
refusal table in this one commit: mail-routes and coordinator-skill both scan
that list and would be red on any commit that split them. SKILL.md untouched."
  ```

---

### Task 306: the workspace name is frozen for the life of the claim, and the corpus says so

Tasks 301 and 302 together make a new fact true; **they repair no falsehood, and the plan must say it
that way or a reviewer goes looking for a lie that is not there.** `wave-lifecycle.md` is correct
today: it says `ws-add` creates the workspace on `ws/<slug>` (true) and that the done-fingerprint
re-measures `record.branch`, "the live registry's own field" (also true — that field follows a
rename). Measured live, 8 of 14 workspaces sit off their born name and the instruction "commit on this
workspace's own branch" holds under all of them. The freeze **adds a fact the file has never stated**.

The same change makes `sessionLabel`'s docstring half-false, which the spec does not mention and which
is the widest-reaching visual consequence of this wave: a claimed worker row now reads `ws/<slug>` for
a whole wave instead of an ai-title.

**RULING: `sessionLabel` is NOT changed in this build. Its docstring IS corrected.** Whether a claimed
row should instead fall back to its run's `program`/`wave` is an OPEN QUESTION FOR THE OPERATOR —
`RunSummary` carries both and the fleet store already holds the runs, so it is cheap — but it is a
product decision, and this task raises it in a comment rather than deciding it in code.

**AGENT-FIRST** (skill artifact). Does not touch `ccd/ccd`; GATE 1 does not apply.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — `§2`, immediately after the paragraph
  identified by its verbatim sentence `**The brief must say: commit on the WORKSPACE branch — never a
  separate feature branch (F5, build4 dogfood wave 1).**` and its closing sentence `it is the one
  sentence that keeps the wave closeable at all.`
- Modify: `pwa/src/fleet/sessionLabel.ts` — the docstring above
  `export function sessionLabel(session: FleetSession): string {`
- Test: `server/test/coordinator-skill.test.ts`, `pwa/test/typed-label.test.tsx`

**Interfaces:**
- Consumes: Task 301 (`sweepNames`'s rung) and Task 302 (`ws-rename`'s `held` refusal) — the two
  mechanisms the sentence describes. **Do not land this before both**; a skill sentence promising a
  freeze that is not implemented is worse than no sentence.
- Produces: no new name.

- [ ] **Step 1: Write the failing tests**

  In `server/test/coordinator-skill.test.ts`, add to the `describe('the coordinator skill: its
  contract', …)` block (or the nearest reference-file describe):

  ```ts
  // Wave 3 §3.1. A coordinator writes a ledger and a brief that name the
  // worker's branch; before this wave the naming sweep could rename it 30
  // seconds later and every one of those references silently stopped resolving.
  // The mechanism is two rungs (FleetWatcher.sweepNames, ccd ws-rename); this
  // asserts the corpus a coordinator actually reads has been told about it,
  // because a guarantee nobody documented is a guarantee nobody relies on.
  it('tells the coordinator that a claimed workspace keeps its name for the life of the claim', () => {
    const wl = refs('wave-lifecycle.md');
    expect(wl).toContain('frozen for the life of the claim');
    // The two mechanisms, named — so a reader can check the promise rather than
    // trust it, and so deleting either rung leaves a documented claim visibly
    // unbacked.
    expect(wl).toContain('ws-rename');
    expect(wl.toLowerCase()).toContain('naming sweep');
  });
  ```

  In `pwa/test/typed-label.test.tsx`, add:

  ```ts
  // Wave 3 §3.1's visual consequence, pinned rather than left in a docstring.
  // `sessionLabel` is `name ?? branch ?? workspace ?? id`, and the naming sweep
  // no longer renames a claimed workspace — so for the whole life of a claim a
  // worker row reads `ws/<slug>`, not the ai-title it would have grown before
  // this wave. This is the widest-reaching visual change in the build and it is
  // the intended trade: a stable name a ledger can cite beats a prettier one
  // that moves under it.
  describe('a claimed worker keeps its born name (W3 §3.1)', () => {
    it('labels a held workspace by its born branch, not by any title', () => {
      const held = s({
        name: null, branch: 'ws/quiet-mesa', workspace: 'quiet-mesa',
        held: 'program:build8 wave:2/4 run:17',
      });
      render(<SessionLine session={held} onOpen={() => {}} />);
      expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
    });
  });
  ```

  (If `SessionLine`'s props at execution time are not `{ session, onOpen }`, copy the invocation from
  the nearest existing `render(<SessionLine …>)` in this same file rather than guessing.)

- [ ] **Step 2: Run the tests to verify they fail**

  ```
  cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
  cd pwa    && ./node_modules/.bin/vitest run test/typed-label.test.tsx
  ```
  Expected: the skill test fails with `expected '…' to contain 'frozen for the life of the claim'`.
  The PWA test may PASS immediately — `sessionLabel` already prefers `branch` — and that is fine and
  intended: it is a REGRESSION pin on a fact this wave makes load-bearing, not a red-first driver.
  Note it as such in the commit rather than manufacturing a fake failure for it.

- [ ] **Step 3: Write the sentence and correct the docstring**

  **(a)** `ccd/coordinator-skill/references/wave-lifecycle.md`, `§2`, as a new paragraph immediately
  after `it is the one sentence that keeps the wave closeable at all.`:

  ```
  **The workspace's name is frozen for the life of the claim.** This is a fact
  the fleet did not previously guarantee, not a correction to anything above:
  the automatic naming sweep used to rename a workspace to a slug of the
  worker's first ai-title, typically within a minute of dispatch, whether or not
  a program had claimed it. It no longer does — the sweep skips any row that is
  held or that an open run names, and `ccd ws-rename` refuses a held workspace
  outright. So the branch this run is dispatched on is the branch it still has
  when you re-measure it, and a brief, a ledger entry or a review note may cite
  the branch name and expect it to resolve. Releasing the hold (or closing every
  run naming the session) un-freezes it, and the next sweep may rename it then.
  ```

  **(b)** `pwa/src/fleet/sessionLabel.ts` — replace the docstring's third sentence. The current text
  is verbatim:

  ```ts
   * `name` is only ever present when it is worth showing: the server drops
   * Claude Code's derived session handles (`openclawhetzner-42` — cwd basename
   * plus a counter) before they reach the wire, so a non-null name is one a
   * human chose. Branch outranks the slug because a workspace's branch gets
   * renamed to something descriptive while `workspace` keeps the slug it was
   * born with; the `id` tail keeps the rule total for legacy rows, which have
   * no workspace.
  ```

  Replace with:

  ```ts
   * `name` is only ever present when it is worth showing: the server drops
   * Claude Code's derived session handles (`openclawhetzner-42` — cwd basename
   * plus a counter) before they reach the wire, so a non-null name is one a
   * human chose. Branch outranks the slug because a workspace's branch gets
   * renamed to something descriptive while `workspace` keeps the slug it was
   * born with; the `id` tail keeps the rule total for legacy rows, which have
   * no workspace.
   *
   * THAT SECOND CLAUSE IS NOW HALF TRUE, and the half it loses is the common
   * one. Wave 3 §3.1 freezes a workspace's name for the life of a claim — the
   * naming sweep skips a held row or one an open run names, and `ccd ws-rename`
   * refuses a held workspace — so for the whole of a wave this function returns
   * `ws/<slug>`, the born name, and the descriptive rename lands only after the
   * claim is released. A claimed worker row therefore reads exactly like an
   * unclaimed brand-new one. That is the deliberate trade: a name a ledger can
   * cite beats a prettier one that moves under it mid-wave.
   *
   * OPEN QUESTION FOR THE OPERATOR, deliberately NOT decided in code: should a
   * claimed row fall back to its run's `program`/`wave` instead of the slug?
   * `RunSummary` carries both and the fleet store already holds the run list,
   * so it is cheap — but it changes what every worker row is called for the
   * length of a program, which is a product decision, not a refactor.
   */
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```
  cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
  cd pwa    && ./node_modules/.bin/vitest run test/typed-label.test.tsx
  cd pwa    && npm run build
  ```
  All green. `npm run build` is not optional: `pwa/test` is typechecked by the BUILD, not by
  `npm run test`, so a docstring edit that accidentally broke a JSDoc block would be invisible
  otherwise.

- [ ] **Step 5: Commit**

  ```
  git add ccd/coordinator-skill/references/wave-lifecycle.md pwa/src/fleet/sessionLabel.ts \
          server/test/coordinator-skill.test.ts pwa/test/typed-label.test.tsx
  git commit -m "docs(skill,pwa): the workspace name is frozen for the life of a claim (W3 §3.1)

One paragraph in wave-lifecycle.md §2, stated as a fact the fleet did not
previously guarantee rather than as a correction: nothing in that file was
wrong. SKILL.md and its nine pinned clauses are untouched, and the new text
names none of the three destructive verbs.

sessionLabel's docstring justified branch-over-slug on a rename that no longer
happens during a claim; corrected, with the consequence (a claimed row reads
ws/<slug> for a whole wave) stated and pinned in typed-label. Whether a claimed
row should read program/wave instead is raised for the operator, not decided."
  ```

---

### Task 307: the swap sheet stops lying about what a swap does

§3.4's `prefer` exec grant is **deferred by operator decision** and this task is the entire remaining
content of that section. Measured at `d7137c2`: `ccd swap` writes `.wrapper` and never `.home`, and
`_auto_swap_check` returns the session to its home account the moment home is usable — so a deliberate
lane change made from the PWA is silently reverted within ~15 minutes, in both directions, measured
live in `swap.log`. The control the PWA ships today is cosmetic. **Labelling it honestly makes a
working control out of a lying one without touching the exec boundary at all** — which is the whole
argument for deferring the grant.

Task 303 does not change this: a HELD session's affinity swap now defers, but the sheet is used on
every session, most of which are unheld, and a hold is released at the end of the wave.

**Files:**
- Modify: `pwa/src/fleet/SwapSheet.tsx` — `SwapSheetProps`, verbatim at `d7137c2`:
  ```tsx
  export interface SwapSheetProps {
    session: Pick<FleetSession, 'id' | 'wrapper' | 'project'>;
  ```
- Modify: `pwa/src/fleet/SwapSheet.tsx` — the `<p className="sheet-copy">` body and the
  `<QuickConfirm … consequence={…}>` prop inside `SwapSheet`
- Modify: `pwa/test/lifecycle-ui.test.tsx` — the TWO inline session literals, both spelled
  `session={{ id: 'demo', wrapper: 'claude', project: 'demo' }}`
- Create: `pwa/test/swap-sheet.test.tsx`

**Interfaces:**
- Consumes: `FleetSession.home: string` (already on the wire — `id: string; wrapper: string; home:
  string; project: string; …`), `accountLabel(roster, wrapper)` (already imported in this file).
- Produces: `SwapSheetProps.session: Pick<FleetSession, 'id' | 'wrapper' | 'project' | 'home'>`.

**The widening is free and easy to miss.** Both real callers (`SessionActionsSheet`,
`SessionScreen`) already pass a whole `FleetSession`, so nothing in `pwa/src` breaks. The two breaks
are inline object literals in `pwa/test/lifecycle-ui.test.tsx`, and **they are invisible to
`npm run test`** — `pwa/test` is typechecked by `npm run build`. Run the build.

- [ ] **Step 1: Write the failing test**

  Create `pwa/test/swap-sheet.test.tsx`:

  ```tsx
  // Wave 3 §3.4, the half that ships. The `prefer` exec grant is DEFERRED —
  // `EXEC_COMMANDS` stays `['tmux','ccd']` and `ccd prefer` stays unreachable
  // from the server — so a swap made here is genuinely temporary: `ccd swap`
  // writes `.wrapper` and never `.home`, and `_auto_swap_check` returns the
  // session home the moment home has room (measured live in swap.log, both
  // directions, ~15 minutes). This suite pins the sheet SAYING SO. A control
  // that quietly undoes itself is worse than one that admits it will.
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { act, cleanup, render, screen } from '@testing-library/react';
  import type { FleetSession } from '../../shared/api';
  import { SwapSheet } from '../src/fleet/SwapSheet';
  import { createFleetStore, type FleetStore } from '../src/stores/fleet';
  import { TEST_ROSTER } from './rosterFixture';

  afterEach(() => { cleanup(); });

  // `fleetSession` and `storeWith` are MODULE-PRIVATE in
  // `pwa/test/lifecycle-ui.test.tsx` — not exported, so they cannot be
  // imported. Reproduced here in the same shape (the roster is what makes the
  // assertions readable: TEST_ROSTER resolves `claude` -> "team·alt" and
  // `claude2` -> "team·b"). Wave 1 adds `started`/`spawnState` to
  // `FleetSession`; if this task lands after that wave, the compiler will name
  // them and they go in the literal below.
  const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

  const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
    id: 'claude:OpenClawHetzner', wrapper: 'claude', home: '/home/rc',
    project: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner',
    workspace: null, name: null, status: 'idle', statusUpdatedAt: Date.now() - 120_000,
    limits: { five: 62, seven: 71 },
    dialogPending: false, model: null, effort: null, ultracode: false, branch: null,
    tasks: null, pr: null, archivedAt: null, archivedBytes: null,
    hookState: null, askSummary: null, subagents: null, held: null,
    bucket: 'idle', bucketSince: null, unmeasured: [],
    lifecycle: null, stoppedBy: null, swapBlocked: null, version: null,
    ...patch,
  });

  const storeWith = (sessions: FleetSession[]): FleetStore => {
    const store = createFleetStore({ makeSocket: fakeSocket });
    act(() => { store.setState({ conn: 'open', sessions, roster: TEST_ROSTER }); });
    return store;
  };

  describe('SwapSheet says the move is temporary and names the home account', () => {
    it('names the home account the session will return to', () => {
      const s = fleetSession({ wrapper: 'claude2', home: 'claude' });
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
      // The account it is on NOW and the account it goes BACK to are different
      // facts and the sheet must show both — before this task it showed only
      // the first, and the reader had no way to know the second existed.
      expect(screen.getByText(/team·alt/)).toBeInTheDocument();      // home
      expect(screen.getByText(/temporary|returns/i)).toBeInTheDocument();
    });

    it('says it in the CONSEQUENCE too, where the tap actually happens', async () => {
      // The sheet copy is read once; the QuickConfirm consequence is read at the
      // moment of commitment. `QuickConfirm` runs `onConfirm(); onClose();`
      // unconditionally, so this sentence is the last thing shown before an
      // irreversible-looking action that is in fact reversed for you.
      const s = fleetSession({ wrapper: 'claude', home: 'claude' });
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
      (await screen.findByRole('button', { name: /team·b/ })).click();
      expect(await screen.findByText(/back to team·alt/i)).toBeInTheDocument();
    });

    it('does not claim a return when the session is already on its home account and stays there', () => {
      // The mutant this kills: an unconditional "returns to X" sentence that
      // reads as nonsense when X is the account being moved AWAY from. Moving
      // OFF home is exactly the case where the return sentence matters most, so
      // it must name the account correctly rather than the current one.
      const s = fleetSession({ wrapper: 'claude', home: 'claude' });
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
      expect(screen.getByText(/home account is team·alt/i)).toBeInTheDocument();
    });

    it('still lists every pickable target — honesty is not a restriction', () => {
      const s = fleetSession({ wrapper: 'claude', home: 'claude' });
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
      for (const label of ['team·b', 'gpt']) {
        expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
      }
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```
  cd pwa && ./node_modules/.bin/vitest run test/swap-sheet.test.tsx
  ```
  Expected: `names the home account…` fails with
  `Unable to find an element with the text: /temporary|returns/i`; the second and third fail the same
  way on their own strings.

- [ ] **Step 3: Widen the Pick and write the copy**

  In `pwa/src/fleet/SwapSheet.tsx`:

  ```tsx
  export interface SwapSheetProps {
    /** `home` is in the Pick because §3.4's honest label cannot be written
     *  without it: a swap made from this sheet is TEMPORARY — `ccd swap` writes
     *  `.wrapper` and never `.home`, and `_auto_swap_check` returns the session
     *  to `home` the moment home has room (measured live, both directions,
     *  ~15 minutes) — so the sheet has to be able to NAME the account it goes
     *  back to. Both callers already pass a whole `FleetSession`, so widening
     *  costs nothing at any call site in `pwa/src`. */
    session: Pick<FleetSession, 'id' | 'wrapper' | 'project' | 'home'>;
    open: boolean;
    onClose: () => void;
    /** Injectable for tests; defaults to the app-wide fleet store. */
    fleet?: FleetStore;
  }
  ```

  Inside the component, beside the existing `const targetLabel = …`:

  ```tsx
    const homeLabel = accountLabel(roster, session.home);
  ```

  Replace the `<p className="sheet-copy">` body with:

  ```tsx
          <p className="sheet-copy">
            {session.project} runs on {accountLabel(roster, session.wrapper)} now. Its home account
            is {homeLabel} — a move from here is temporary: ccrc returns the session to {homeLabel}
            as soon as {homeLabel} has room again. Pick where it should live meanwhile.
          </p>
  ```

  and the `QuickConfirm`'s `consequence`:

  ```tsx
          consequence={`The session restarts under ${targetLabel}. Anyone attached is briefly ` +
            `disconnected. This is temporary — ccrc moves it back to ${homeLabel} once ` +
            `${homeLabel} has room.`}
  ```

  In `pwa/test/lifecycle-ui.test.tsx`, both inline literals become:

  ```tsx
  session={{ id: 'demo', wrapper: 'claude', project: 'demo', home: 'claude' }}
  ```

- [ ] **Step 4: Run the tests to verify they pass — and the BUILD, which is where the Pick widening bites**

  ```
  cd pwa && ./node_modules/.bin/vitest run test/swap-sheet.test.tsx
  cd pwa && ./node_modules/.bin/vitest run test/lifecycle-ui.test.tsx
  cd pwa && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx
  cd pwa && npm run build
  ```
  All green. **The build is the point of this step**: the two inline literals in `lifecycle-ui` fail
  typechecking and NOTHING in `npm run test` says so.

- [ ] **Step 5: Commit**

  ```
  git add pwa/src/fleet/SwapSheet.tsx pwa/test/swap-sheet.test.tsx pwa/test/lifecycle-ui.test.tsx
  git commit -m "fix(pwa): the swap sheet admits the move is temporary (W3 §3.4, label only)

ccd swap writes .wrapper and never .home, and _auto_swap_check returns the
session home the moment home has room — so a deliberate lane change from this
sheet is reverted within ~15 minutes, measured live in swap.log in both
directions. The control was cosmetic and the copy implied otherwise.

The prefer exec grant stays DEFERRED per operator decision: EXEC_COMMANDS is
still ['tmux','ccd'] and nothing here widens the boundary. SwapSheetProps'
Pick gains 'home' so the sheet can name the account it returns to; both real
callers already pass a whole FleetSession, and the only breaks were two inline
test literals that npm run test cannot see."
  ```

---

### Wave 3 — definition of done

- [ ] **All seven task commits are on the branch, and every commit that touched `ccd/ccd` (302, 303)
      re-stamped the provenance marker IN THAT COMMIT.** Verify once at the end that no intermediate
      commit is red: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`.
- [ ] **Full server suite green in the FOREGROUND**, timeout ≥ 600000 ms:
      `cd server && npm run test`. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook` and `typecheck-tests`
      IN ISOLATION before calling any of those four a real break — they are known load flakes and CI on
      the quiet box is the arbiter.
- [ ] **Full PWA suite AND build green:** `cd pwa && npm run test` then `cd pwa && npm run build`.
      The build is not optional; it is the only typechecker `pwa/test` has.
- [ ] `cd agent && npm run test` green. Wave 3 touches no `agent/` source, so this is a
      confirmation, not a lane.
- [ ] **No `git push`, no `gh`, no `ccd`, no `tmux`, no `systemctl`, no ssh anywhere in this wave's
      execution.** Branch, commit, stop. `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive` and
      `ws-restore` appear in no step of any task above, and must not be added to one — they are
      human-only by contract.
- [ ] **Deploy order when the branch merges (AGENT-FIRST, three artifacts):** `ccd/ccd` and
      `ccd/coordinator-skill/` to the FLEET HOST first (`bash deploy/deploy.sh agent <host>` — the host
      argument is not optional; `deploy.sh` defaults `$BOX` to the SERVER box), then the server
      (`bash deploy/deploy.sh`), whose `/health` sha is the final gate. The server reads what the skill
      and ccd write; shipping it first means one deploy window where `sweepNames` skips a claimed row
      while `ws-rename` would still have renamed it by hand, and where a coordinator is told about a
      freeze the fleet does not yet enforce.
- [ ] **Before installing ccd, re-run the jitter check** on the exact ref being installed:
      `git show <ref>:ccd/ccd | grep -c SWAP_JITTER` must be non-zero. Task 303 edits
      `_auto_swap_check`, the caller of the machinery `fix/ccd-swap-jitter` changed, on a 5-second tick
      across 18 supervisors.
## Wave 4 — the input box tells the truth

**Bounded context:** Session Injection (server + PWA), plus ccd's two out-of-process injectors and the
mail delivery lane. **Closes:** F13, F14, the vacuous submit, the invisible blank-marker wedge, and the
false-echo pass.

**Deploy lane: AGENT-FIRST.** Tasks 401 and 413 touch `ccd/` (`ccd/ccd`, `ccd/coordinator-skill/`) and
ship to the fleet host before the server lane. Task 401 re-stamps `ccd/ccd`'s provenance marker in its
own commit (Gate 1); so does any later task that touches one byte of that file.

**Depends on nothing in Waves 1–3.** Wave 4 shares no identifier with them. It may be executed
independently, in this order.

**The operator's rulings this wave implements, verbatim, so nobody re-litigates them mid-task:**

- A failed send **hands the text back**. The ordinary `verify-failed` path stops clearing the box.
- The blank-marker wedge is **REFUSE-ONLY**. Nothing in this wave auto-clears operator text. Open
  decision 6 stays closed in the refusing direction — §4.1 hands the text back and the PWA rescue makes
  recovery one tap, so no clearing mechanism is built.

**AND ONE ADDITION THAT IS NOT AN OPERATOR RULING — Task 407 needs sign-off before Wave 4 runs.**
Extending `isMailResidue` to recognise a stranded `/clear` appears **nowhere in the spec** — not in
§4.x, not in the rulings list, not in the Assumptions table, not in Open decisions. This plan proposes
it because `dispatch.ts` documents, verbatim, the wedge it creates and the silent park that follows.
But it cuts against the refuse-only ruling directly above: `isMailResidue` gates `replaceDraft`, so
Task 407 makes the mail lane **auto-clear a box** in a case where it does not today.

The proposal is deliberately the narrowest possible one — an **exact-match** on the literal `/clear`
this system itself typed, and nothing else — and it is confined to the MACHINE's own residue, never
to text a human wrote. **Route it to the operator for an explicit yes/no before executing Wave 4.**
If the answer is no, drop Task 407 entirely; nothing else in the wave depends on it (Task 409 makes
the park visible either way, which was always the larger half of the fix).

**The one thing that must not be widened:** `SendResult.draft` already carries **three** meanings —
the OTHER text on `draft-present`, OUR OWN proven text on `enter-ignored`, and a failed clear's RESIDUE
FRAGMENT on the attachment path's `verify-failed`. The PWA's `Send it` rescue must fire on the second
and never the third. Widening `ChatList`'s gate on `code` alone would put two conditions a caller
handles oppositely onto one field and would ship a button that submits truncated prompts. That is why
`submittable?: boolean` exists. Do not "simplify" it away.

---

### Task 401: `_pane_box_draft` — one bash reader for the input box's own row

ccd's two injectors each guard with their own inline `grep -m1 "^❯ "` — the **first** `❯` line with a
**plain space**. `draftOf`'s rule (`server/src/inject/send.ts`) is the **last** `❯` line, accepting
either separator. Two ad-hoc copies of one fact, both wrong in the same two ways, will drift; this
replaces them with one named function.

**The NBSP question is settled in-tree, read-only.** `server/test/send.test.ts`'s `LIVE_CU_FRAMES` is a
verbatim `capture-pane -e` of a real **typed** three-line draft; its box row is
`'\x1b[39m❯\xa0AAA first line'` — U+00A0 directly against the text. The empty box measures `❯` + U+00A0
too. So `grep -m1 "^❯ "` can never match a real typed draft's box row on any pane; it can only match a
scrollback turn. Both measured failures follow: on one pane it returned `❯ /compact` from scrollback
while the real box was empty (failing shut, skipping a legitimate compact), on another it returned
nothing while the box row held text (failing OPEN, typing over a draft).

**Files:**
- Modify: `ccd/ccd` — add `_pane_box_draft` immediately above `_pane_login_screen` (find that anchor by
  its body line `grep -Eq 'Select login method|Invalid API key|Please run /login' <<<"$1"`); change
  `_auto_compact_check`'s guard line, exactly
  `cur=$(tmux capture-pane -t "$t" -p 2>/dev/null | grep -m1 "^❯ " | sed "s/^❯ //; s/[[:space:]]*$//")`;
  change `_inject_spawn_effort`'s guard line, which is byte-identical to it.
- Test: `server/test/ccd-pane-box-draft.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `_pane_box_draft <pane-text>` — echoes the input box's own row with the marker and its
  separator stripped and trailing ASCII whitespace trimmed, or nothing when the box is empty. Takes
  **pane text**, not a tmux target: the callers already hold a capture, and a function that captures
  for itself cannot be tested without a tmux.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-pane-box-draft.test.ts`:

```ts
/**
 * ONE reader for the input box's own row, so ccd's two injectors cannot drift
 * from each other or from `draftOf` (server/src/inject/send.ts).
 *
 * Both guards read the FIRST `❯` line with a PLAIN space today. Measured on
 * this box, that is wrong in both directions: it returns a scrollback turn
 * (`❯ /compact`) while the real box is empty — failing shut, skipping a
 * legitimate compact — and it returns NOTHING while the box row is `❯` +
 * U+00A0 + text, which is failing OPEN, i.e. typing a slash command on top of
 * somebody's draft.
 *
 * The NBSP is not a guess: `send.test.ts`'s LIVE_CU_FRAMES is a verbatim
 * `capture-pane -e` of a real TYPED draft and its box row is
 * `'\x1b[39m❯\xa0AAA first line'`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
// `server/package.json` is `"type":"module"`, so `require` is NOT defined in
// this scope — a CommonJS read here throws ReferenceError and the mutation
// guard at the bottom of this file asserts nothing at all.
import { readFileSync } from 'node:fs';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-box-draft-'); });
afterEach(() => { h.cleanup(); });

const NBSP = ' ';

/** Runs `_pane_box_draft` over a pane and returns exactly what it echoed. */
const draft = (pane: string): string => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; _pane_box_draft "$1"`, 'bash', pane], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
  });
  expect(r.status, r.stderr ?? '').toBe(0);
  return (r.stdout ?? '').replace(/\n$/, '');
};

const pane = (boxRows: string[]): string =>
  ['earlier turn', `❯ an older submitted turn`, '● a reply', '─'.repeat(24),
    ...boxRows, '─'.repeat(24), '  👤 team·max'].join('\n') + '\n';

describe('_pane_box_draft', () => {
  it('reads the LAST marker line, not the first — a scrollback turn is not the box', () => {
    // The measured failure: `grep -m1` returned `/compact` from the scrollback
    // while the box was empty, so auto-compact skipped a session forever.
    expect(draft(pane([`❯${NBSP}`]))).toBe('');
  });

  it('accepts U+00A0 as the separator — the byte a real typed draft actually carries', () => {
    expect(draft(pane([`❯${NBSP}fix the flaky test`]))).toBe('fix the flaky test');
  });

  it('still accepts a plain space', () => {
    expect(draft(pane(['❯ fix the flaky test']))).toBe('fix the flaky test');
  });

  it('trims trailing whitespace, as the guards it replaces did', () => {
    expect(draft(pane([`❯${NBSP}half a thought   `]))).toBe('half a thought');
  });

  it('reads nothing from a pane with no box at all', () => {
    expect(draft('just some output\nno marker here\n')).toBe('');
  });

  // The mutation table: reinstating either half of the old rule reds a test
  // above. `grep -m1` reds test 1; a plain-space-only separator reds test 2.
  it('is the ONLY box-row reader left in ccd — no inline grep survives', () => {
    const src = readFileSync(CCD, 'utf8');
    expect(src.match(/grep -m1 "\^❯ "/g), 'an inline box-row grep is back').toBeNull();
    expect((src.match(/_pane_box_draft\(\)/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/ccd-pane-box-draft.test.ts
```

Expected: every case fails with `bash: _pane_box_draft: command not found` (status 127), and the
last case fails on `expected [ 'grep -m1 "^❯ "', 'grep -m1 "^❯ "' ] to be null`.

- [ ] **Step 3: Write minimal implementation**

In `ccd/ccd`, immediately above `_pane_login_screen()`:

```bash
# The input box's own row, from a pane capture — `draftOf`'s rule
# (server/src/inject/send.ts), in one place, so ccd's two injectors cannot
# drift from each other or from the server's reader.
#
# TWO corrections to the inline `grep -m1 "^❯ "` this replaces, both measured
# live on 2026-08-14:
#   • the LAST marker line, not the first. Past user turns render with the same
#     `❯` prefix in the scrollback ABOVE the box, so `-m1` returned a stale turn
#     (`❯ /compact`) while the real box was empty — failing shut.
#   • either separator. A real TYPED draft's box row is `❯` + U+00A0, not a
#     plain space (verbatim `capture-pane -e` bytes, LIVE_CU_FRAMES in
#     server/test/send.test.ts), so the plain-space pattern matched nothing on
#     a genuinely occupied box — failing OPEN, i.e. typing over a human draft.
#
# LC_ALL=C on both filters, deliberately: the marker and the separator are
# matched as BYTES (`❯` = e2 9d af, NBSP = c2 a0). A multibyte locale makes a
# bracket expression over raw bytes implementation-defined, and this guard is
# the only thing standing between an injector and somebody's unsent message.
# The trailing trim stays `[[:space:]]` under the same C locale — byte-for-byte
# what the two guards did before, so a pane that behaved yesterday behaves today.
_pane_box_draft() {   # pane-text -> the box's own row, or empty
  printf '%s\n' "$1" \
    | LC_ALL=C grep $'^\xe2\x9d\xaf' \
    | tail -1 \
    | LC_ALL=C sed $'s/^\xe2\x9d\xaf[ \xc2\xa0]*//; s/[[:space:]]*$//'
}
```

In `_auto_compact_check`, replace:

```bash
  cur=$(tmux capture-pane -t "$t" -p 2>/dev/null | grep -m1 "^❯ " | sed "s/^❯ //; s/[[:space:]]*$//")
```

with:

```bash
  cur=$(_pane_box_draft "$(tmux capture-pane -t "$t" -p 2>/dev/null)")
```

In `_inject_spawn_effort`, replace the byte-identical line with the same call. Leave
`_inject_spawn_effort`'s rc gate exactly as it is — `_is_home_able "$wrapper" && [[ "$prompt_rc" == 0 ]]`
is already strictly correct and is not this task's business.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/ccd-pane-box-draft.test.ts
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
```

`ownership.test.ts` is RED until step 5's re-stamp — that is Gate 1 working, not a break.

- [ ] **Step 5: Commit**

Re-stamp in this commit, or every later commit on the branch carries a red suite:

```
cd /srv/projects/ccrc-pwa && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
git add ccd/ccd server/test/ccd-pane-box-draft.test.ts
git commit -m "fix(ccd): one reader for the input box's own row — the last marker line, either separator (W4 §4.6)"
```

---

### Task 402: `composePrompt` stops manufacturing a blank marker row

A prompt whose text starts with `\n` types an empty literal, then `M-Enter`, then the real text —
leaving the marker row blank. `submitted()` proves the send with `!draftOf(pane).startsWith(needle)`
where `needle` is the first **non-blank** line, so on a blank marker row it returns true on its first
poll **whether or not Enter did anything**: the route answers 200, and the PWA's optimistic bubble is
deleted with no message after 5 s. The operator watches the message vanish as if delivered.

Unreachable from the app's own Composer (which trims). Reachable from any script, any curl caller, and
the coordinator.

**Files:**
- Modify: `shared/api.ts` — `composePrompt`, current body verbatim
  `return [...attachments, text].filter((part) => part !== '').join('\n');`
- Test: `pwa/test/compose.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `composePrompt(text: string, attachments: readonly string[]): string` — **signature
  unchanged**; leading blank lines in `text` are stripped before composing.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/compose.test.ts`:

```ts
describe('a leading blank line never reaches the box', () => {
  // VACUUM, not a red: nothing composes text with a leading newline today.
  //
  // The box cannot hold a leading blank line usefully and typing one destroys
  // the send proof: `sendPrompt` writes it with M-Enter, the marker row ends up
  // blank, and `submitted()`'s needle is the first NON-blank line — so it
  // returns true on its first poll whether or not Enter did anything. Measured:
  // a pane byte-identical before and after Enter returns {ok:true}, the route
  // answers 200, and the PWA deletes the optimistic bubble after 5 s with no
  // message anywhere.
  it('strips leading blank lines from the text', () => {
    expect(composePrompt('\n\nrun the tests', [])).toBe('run the tests');
  });

  it('strips a leading blank line that is only whitespace', () => {
    expect(composePrompt('   \n\t\nrun the tests', [])).toBe('run the tests');
  });

  it('leaves INTERIOR blank lines alone — they are the message', () => {
    expect(composePrompt('first\n\nsecond', [])).toBe('first\n\nsecond');
  });

  it('leaves TRAILING blank lines alone — only the marker row is at stake', () => {
    expect(composePrompt('first\n\n', [])).toBe('first\n\n');
  });

  it('strips before the attachment join, so the paths still lead', () => {
    expect(composePrompt('\ncaption', ['/c/clip-1.png'])).toBe('/c/clip-1.png\ncaption');
  });

  it('a text that is nothing but blank lines composes to nothing', () => {
    expect(composePrompt('\n\n  \n', [])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/compose.test.ts
```

Expected: `expected '\n\nrun the tests' to be 'run the tests'` on the first case, and
`expected '\ncaption' …` — actually `'/c/clip-1.png\n\ncaption'` — on the fifth.

- [ ] **Step 3: Write minimal implementation**

In `shared/api.ts`, replace `composePrompt`'s comment and body:

```ts
/**
 * Attachment paths first, each on its own line, then the user's text. Paths
 * lead so the transcript reads image-above-caption.
 *
 * LEADING BLANK LINES ARE STRIPPED FROM `text`. This filter used to drop empty
 * ARRAY MEMBERS only, so a prompt beginning with a newline typed an empty
 * literal, then M-Enter, then the real text — leaving the input box's MARKER
 * ROW blank. That is not cosmetic: `submitted()` proves a send with
 * `!draftOf(pane).startsWith(needle)` and `needle` is the first NON-blank
 * line, so on a blank marker row the proof is vacuous — measured, a pane
 * byte-identical before and after Enter returns ok:true and the message is
 * silently lost. The box cannot hold a leading blank line; typing one only
 * breaks the proof.
 *
 * INTERIOR and TRAILING blank lines are untouched: only the marker row is at
 * stake, and an interior blank line is the message.
 *
 * PRICE, stated rather than discovered: stripping on this side makes the
 * `splitClipPaths` round-trip LOSSY. `splitClipPaths(composePrompt(t, a))`
 * cannot return a `rest` that begins with the blank lines `t` began with. That
 * is accepted — `splitClipPaths` already trims leading blank lines off its own
 * result, so the round trip was never byte-exact at that edge anyway.
 */
export function composePrompt(text: string, attachments: readonly string[]): string {
  const body = text.replace(/^(?:[^\S\n]*\n)+/, '');
  return [...attachments, body].filter((part) => part !== '').join('\n');
}
```

The regex is `[^\S\n]` (horizontal whitespace) rather than `\s`, so a run of blank-ish lines is eaten
one whole line at a time and an indented FIRST content line keeps its indentation.

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/compose.test.ts
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add shared/api.ts pwa/test/compose.test.ts
git commit -m "fix(inject): strip leading blank lines before composing — a blank marker row makes the send proof vacuous (W4 §4.3)"
```

---

### Task 403: a failed verify hands the text back — `submittable`

At `d7137c2` the ordinary path's refusal is exactly:

```ts
        if (i === ECHO_TRIES - 1) {
          return { ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL) };
        }
```

— no `clearBox`, no C-u, **and no `draft`**, so the text is left in the box and nothing tells the
operator that. The attachment path clears and returns a `draft` which is **a fragment of a failed
clear**, not the message. Two opposite meanings on one field: this task adds the field that tells them
apart, and it does so on the FAILURE arm only.

**Files:**
- Modify: `server/src/inject/send.ts` — `SendResult` (current verbatim:
  `| { ok: false; error: 'not-alive' | 'dialog-open' | 'draft-present' | 'draft-clear-failed' | 'verify-failed' | 'enter-ignored'; draft?: string; pane?: string };`);
  `pressEnterAndConfirm`'s return, found by
  `return { ok: false, error: 'enter-ignored', draft: draftOf(await d.tmux.captureAnsi(id) ?? ''), pane: (stuck ?? '').slice(-PANE_TAIL) };`;
  the ordinary-path refusal above.
- Test: `server/test/send.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SendResult`'s failure arm gains `submittable?: boolean`. Set by the ordinary-path
  `verify-failed` arm and by `enter-ignored`. **Never** set by the attachment path. Absence means
  "no rescue" — today's behaviour, the safe direction, and what an older server sends.
  `POST /api/sessions/:id/prompt` needs **no change**: `server.ts` sends the whole `res`
  (`return res.ok ? res : reply.code(409).send(res);`).

- [ ] **Step 1: Write the failing test**

Add to `server/test/send.test.ts`, inside `describe('sendPrompt')`:

```ts
  // §4.1, the operator's ruling. `verify-failed` on the ORDINARY path already
  // left the text in the box (no clearBox, no C-u) — it simply never said so,
  // so the PWA had a sentence and no button. It now returns the box row AND
  // the flag that says the box row is the WHOLE message and Enter would send
  // exactly it.
  it('verify-failed hands the text back: draft + submittable, and no C-u', async () => {
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ text the pane never rendered\n']);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'a different message',
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', submittable: true });
    expect((res as { draft?: string }).draft).toBe('text the pane never rendered');
    expect(cuPresses(calls)).toBe(0);   // REFUSE-ONLY: nothing clears operator text
  });

  it('enter-ignored carries submittable too — the case the rescue was built for', async () => {
    const { tmux } = fakeTmux(['❯ \n', '❯ stuck text\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'stuck text');
    expect(res).toMatchObject({
      ok: false, error: 'enter-ignored', draft: 'stuck text', submittable: true,
    });
  });

  // THE DEFECT `submittable` EXISTS TO PREVENT. The attachment path's
  // `verify-failed` draft is what a FAILED clearBox left behind — a fragment of
  // the message. `submitEnter`'s correspondence gate cannot catch it (the
  // residue IS what the box reads, so it matches, and Enter submits the
  // fragment). Widening the PWA gate on `code` alone would ship exactly that.
  it('the ATTACHMENT path keeps its residue draft for DISPLAY and never sets the flag', async () => {
    const NONMATCH = '❯ \n';
    const panes = [...Array(14).fill(NONMATCH), '❯ stubborn leftover\n'];
    const { tmux } = fakeTmux(panes);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '', { attachments: ['/c/clip-1.png'] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: 'stubborn leftover' });
    expect((res as { submittable?: boolean }).submittable).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
```

Expected: the first two fail on `submittable` being `undefined`
(`expected { ok: false, error: 'verify-failed', pane: … } to match object { …, submittable: true }`),
and the first also on `expected undefined to be 'text the pane never rendered'`. The third passes
already — it is the guard that must STAY green.

- [ ] **Step 3: Write minimal implementation**

In `server/src/inject/send.ts`:

```ts
export type SendResult =
  | { ok: true }
  | { ok: false;
      error: 'not-alive' | 'dialog-open' | 'draft-present' | 'draft-clear-failed' | 'verify-failed' | 'enter-ignored';
      draft?: string;
      pane?: string;
      /**
       * The server proved `draft` is the WHOLE message currently in the box and
       * that pressing Enter would send exactly it. ADDITIVE and absence-permits:
       * an older server never sends it, so a client that gates on `=== true`
       * degrades to no rescue — today's behaviour, the safe direction.
       *
       * IT IS NOT A SYNONYM FOR A `code`. `draft` carries THREE meanings across
       * the failure arms: the OTHER text (`draft-present`), OUR OWN proven text
       * (`enter-ignored`, and now the ordinary `verify-failed`), and a FAILED
       * CLEAR'S RESIDUE — a fragment of the message — on the attachment path's
       * `verify-failed`. `submitEnter`'s correspondence gate cannot tell the
       * third apart from the second: the residue IS what the box reads, so it
       * matches, Enter is pressed, and a truncated prompt is submitted. This
       * flag is the discriminator, and the attachment path must never set it.
       */
      submittable?: boolean };
```

`pressEnterAndConfirm`'s return becomes:

```ts
  return {
    ok: false, error: 'enter-ignored',
    draft: draftOf(await d.tmux.captureAnsi(id) ?? ''),
    pane: (stuck ?? '').slice(-PANE_TAIL),
    submittable: true,
  };
```

The ordinary-path refusal becomes:

```ts
        if (i === ECHO_TRIES - 1) {
          // THE TEXT STAYS IN THE BOX — no clearBox, no C-u (operator ruling:
          // refuse, never destroy). That was already true; what was missing was
          // saying so. Hand back the box row so the PWA's rescue has something
          // to correspond against, and the flag that says the box row is the
          // WHOLE message rather than a failed clear's fragment.
          const box = draftOf(await d.tmux.captureAnsi(id) ?? '');
          return {
            ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL),
            draft: box, submittable: true,
          };
        }
```

Nothing else changes. In particular the attachment path's

```ts
          ...(cleared.state === 'residue' ? { draft: cleared.draft } : {}),
```

is left exactly as it is, and gains no flag.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
```

`mail-sweep` is listed because the ordinary refusal path is the one `sweepMail` takes; its scripted
pane arrays now absorb one extra `capture-pane` on the failure path. Re-derive any index the run
reports rather than guessing.

- [ ] **Step 5: Commit**

```
git add server/src/inject/send.ts server/test/send.test.ts
git commit -m "feat(inject): a failed verify hands the text back — draft + submittable on the ordinary path (W4 §4.1)"
```

---

### Task 404: the echo check stops passing off scrollback

The ordinary path tests `after.includes(needle)` — the **whole pane**. A pane whose scrollback contains
the identical text passes the echo check with an empty box, presses Enter, and returns `{ok:true}`
having proven nothing. The attachment path already reads the box and its own comment says why. This is
safe only because Task 403 landed: it converts silent false-successes into a refusal that is now
recoverable in one tap.

**Files:**
- Modify: `server/src/inject/send.ts` — the ordinary echo branch, the `} else {` arm whose body is
  `for (let i = 0; i < ECHO_TRIES; i++) { await sleep(ECHO_POLL_MS); after = await d.tmux.capture(id); … }`
- Test: `server/test/send.test.ts`

**Interfaces:**
- Consumes: `SendResult.submittable` (Task 403).
- Produces: no new names. The ordinary echo poll reads `captureAnsi` + `draftOf` instead of `capture` +
  `includes`. **Capture budget is unchanged on the success path** (one `capture-pane` per poll, as
  before) and unchanged on the failure path (the extra `captureAnsi` Task 403 added at the refusal is
  folded back into the poll, and one plain `capture` is taken for `pane`).

- [ ] **Step 1: Write the failing test**

Add to `server/test/send.test.ts`:

```ts
  // The false-echo pass. `after.includes(needle)` matched the WHOLE PANE, so a
  // session whose scrollback already held our exact words passed the echo
  // check with an EMPTY box, pressed Enter into nothing, and returned ok:true.
  // Nothing downstream could tell that from a real send.
  it('an echo that exists ONLY in the scrollback does not pass', async () => {
    const scrollbackOnly = 'earlier turn\n❯ run the tests\n● a reply\n────\n❯ \n────\n status\n';
    const { tmux, calls } = fakeTmux([scrollbackOnly]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'run the tests',
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', submittable: true });
    expect(sendKeysCalls(calls).some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });

  it('an echo IN THE BOX still passes, on the very poll it renders', async () => {
    const { tmux, calls } = fakeTmux([
      'scrollback\n❯ \n',
      'scrollback\n❯ run the tests\n',   // the box itself now holds it
      'scrollback\n❯ \n',                 // after Enter — emptied
    ]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'run the tests',
    );
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
```

Expected: the first fails with `expected { ok: true } to match object { ok: false, error: 'verify-failed', … }`
— the pane's scrollback satisfies `includes(needle)` today.

- [ ] **Step 3: Write minimal implementation**

Replace the `} else {` arm's body:

```ts
    } else {
      // BOX-SCOPED, not whole-pane. `after.includes(needle)` proved only that
      // the characters appear SOMEWHERE on screen — and a session's scrollback
      // routinely holds the operator's own earlier phrasing of the same
      // request, so a send into a box that never rendered passed the check,
      // pressed Enter into nothing, and returned ok:true. The attachment path
      // above has read the box for exactly this reason since it shipped; the
      // difference was never a real distinction between the two payload shapes.
      //
      // This converts some silent false-successes into `verify-failed`
      // refusals. That is the point, and it is safe only because such a refusal
      // now leaves the text in the box and hands it back (`submittable`), so
      // the operator's remedy is one tap rather than a terminal.
      let echoed = needle === '';
      let lastAnsi = '';
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const ansi = await d.tmux.captureAnsi(id);
        if (ansi === null) continue;
        lastAnsi = ansi;
        if (draftOf(ansi).startsWith(needle)) echoed = true;
      }
      if (!echoed) {
        // The pane tail is a PLAIN capture, taken once, here — it is display
        // for a human, and the escape codes would only make it unreadable.
        after = await d.tmux.capture(id);
        return {
          ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL),
          draft: draftOf(lastAnsi), submittable: true,
        };
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
```

**Index-sensitive fixtures to RE-DERIVE, not to guess at:** the ordinary-path pane arrays and their
poll-count comments in `send.test.ts` (e.g. the `'❯ /model opus\n'` sequence and its comment
`// verify (plain read, taken unconditionally alongside the ansi one)`, which is already mislabelled at
`d7137c2` and must be corrected to what the run actually does). The attachment path's
`Array(14).fill(NONMATCH)` budget is **untouched** — §4.4 does not change that branch. A wrong count
here looks like a flake; run the suite and read the counts off it.

- [ ] **Step 5: Commit**

```
git add server/src/inject/send.ts server/test/send.test.ts
git commit -m "fix(inject): prove the echo against the BOX, not the whole pane — scrollback is not a send (W4 §4.4)"
```

---

### Task 405: the box is read whole — the clobber guard and `clearBox`'s terminator, together

`clearBox`'s look-round terminator at `d7137c2` is:

```ts
    const left = draftOf(ansi);
    if (left === '') return { state: 'cleared' };
```

and its soundness argument (in the function's own docstring) is *"kills run bottom-up while `draftOf`
reads the box's FIRST row … so that row is the LAST to empty"*. **That argument is false when the
marker row started blank.** The clobber guard widened in this same task, which makes both clear arms
(`clearMailResidue`, `replaceDraft`) reachable with a blank marker row: one blind C-u mangles the last
row, the first look round reads `''`, and `clearBox` reports `cleared` having cleared almost nothing —
after which the type loop concatenates onto the wreckage. `replaceDraft` is operator-reachable from the
PWA, so that destroys a human's rows 2..N under a button labelled as though it replaced them.

**THE GUARD AND THE TERMINATOR ARE ONE COMMIT, and splitting them was the defect an earlier draft of
this plan carried.** They are two halves of one behaviour change — "read the whole box, not the marker
row" — and neither is green alone: widening the guard without the terminator ships a clear path that
reports success on a box it barely touched, and fixing the terminator without the guard leaves its
own new test red, on a branch whose stated discipline is that **every commit is independently green**
(w1-ccd's and w2's definitions of done both say so in as many words). A red intermediate commit also
breaks `git bisect` and the per-PR review lens.

So this task carries **both** edits. (An earlier draft numbered the guard half `Task 406`; there is
no Task 406 — the numbering skips from 405 to 407, deliberately, so cross-references written against
the old split resolve to nothing rather than to the wrong task.)

**Files:**
- Modify: `server/src/inject/send.ts` — `clearBox`'s terminator (the two lines above) and the
  "last to empty" paragraph of its docstring; `sendPrompt`'s clobber guard, identified verbatim by
  `const draft = draftOf(pane);` and its fork `if (draft) {`; the `draft-present` refusal, exactly
  `return { ok: false, error: 'draft-present', draft };`; a new module-private `boxText`.
- Test: `server/test/send.test.ts`

**Interfaces:**
- Consumes: `hasContentBelowMarker(ansiPane: string): boolean` and
  `continuationRows(ansiPane: string): string[]` — both already in this file;
  `hasContentBelowMarker` is used only by `submitEnter` today.
- Produces: `const boxText = (ansiPane: string): string` — module-private. Every non-blank box row,
  marker row first, joined with `\n`. **`draft-present`'s `draft` becomes multi-row.**
  `enter-ignored`'s stays the MARKER ROW ONLY and must not change: `submitEnter`'s correspondence
  gate compares `draftOf`'s single-row reading against `expect`, and a multi-row `expect` would
  refuse `box-mismatch` on every rescue. `clearBox`'s `{ state: 'cleared' }` now means the WHOLE box
  is empty.

- [ ] **Step 1: Write the failing test**

Add to `server/test/send.test.ts`:

```ts
describe('clearBox reports on the whole box, not on one row', () => {
  // VACUUM: no fixture in this file starts with a blank first row, so the
  // terminator's blank-marker case has never been exercised at all.
  //
  // The docstring's soundness argument ("kills run bottom-up, so the marker row
  // is the LAST to empty") holds only when the marker row started NON-blank. On
  // a box whose first line is itself blank, the very first look round reads ''
  // and reports `cleared` with rows 2..N untouched — after which the caller's
  // type loop concatenates its message onto somebody else's text.
  it('does not report cleared while rows below the marker still hold text', async () => {
    const blankMarkerWithContent = [
      'earlier turn', '─'.repeat(24),
      '❯ ',                     // blank marker row
      '  the human’s real second line',
      '  and a third',
      '─'.repeat(24), '  👤 team·max',
    ].join('\n') + '\n';
    const { tmux } = fakeTmux([blankMarkerWithContent]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'mine', { replaceDraft: true },
    );
    // It must NOT sail through to the type loop. Whatever it reports, it does
    // not report success on a box it never emptied.
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).not.toBe('verify-failed');
  });

  it('still reports cleared on a genuinely empty box', async () => {
    const empty = ['earlier turn', '─'.repeat(24), '❯ ', '─'.repeat(24), '  👤 team·max']
      .join('\n') + '\n';
    const { tmux } = fakeTmux([
      '❯ a real draft\n',   // the guard fires
      empty,                 // the first look round: genuinely empty
      empty,                 // echo poll
      empty,                 // after Enter
    ]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'mine', { replaceDraft: true },
    );
    // The clear succeeded, so the send proceeded past it — whatever the echo
    // then did, `draft-clear-failed` is what must NOT appear.
    expect((res as { error?: string }).error).not.toBe('draft-clear-failed');
  });
});
```

And the guard's own half, in the same file and the same commit:

```ts
describe('the clobber guard sees the whole box', () => {
  const blankMarkerWithContent = [
    'earlier turn', '─'.repeat(24),
    '❯ ',
    '  the human’s real second line',
    '  and a third',
    '─'.repeat(24), '  👤 team·max',
  ].join('\n') + '\n';

  // VACUUM: every fakeTmux fixture in this file puts the marker LAST with
  // nothing after it, so `continuationRows` returns [] and the widened guard
  // changes no existing outcome. This shape had no fixture at all.
  it('refuses draft-present on a BLANK marker row with content below it', async () => {
    const { tmux, calls } = fakeTmux([blankMarkerWithContent]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'mine');
    expect(res).toMatchObject({ ok: false, error: 'draft-present' });
    // REFUSE-ONLY (operator ruling): not one keystroke goes near it.
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  // The refusal must never carry '': the Composer's draft-conflict sheet renders
  // `draft` in a well and builds "Append anyway" out of it, so '' would render
  // an empty well and silently drop the rows it claims to be appending to.
  it('the refusal carries rows 2..N, never an empty string', async () => {
    const { tmux } = fakeTmux([blankMarkerWithContent]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'mine');
    expect((res as { draft?: string }).draft)
      .toBe('the human’s real second line\nand a third');
  });

  it('an ORDINARY multi-row draft is reported in full, not just its first row', async () => {
    const multi = [
      'earlier turn', '─'.repeat(24),
      '❯ a human mid-sentence',
      '  with a second line',
      '─'.repeat(24), '  👤 team·max',
    ].join('\n') + '\n';
    const { tmux } = fakeTmux([multi]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'mine');
    expect(res).toMatchObject({
      ok: false, error: 'draft-present', draft: 'a human mid-sentence\nwith a second line',
    });
  });

  // `enter-ignored`'s draft is a CORRESPONDENCE CLAIM handed back to
  // `submitEnter`, whose gate compares `draftOf`'s single-row reading. Widening
  // it would make every rescue refuse `box-mismatch`.
  it('enter-ignored still reports the MARKER ROW only', async () => {
    const stuck = [
      'earlier turn', '─'.repeat(24),
      '❯ stuck text', '  and its second line',
      '─'.repeat(24), '  👤 team·max',
    ].join('\n') + '\n';
    const { tmux } = fakeTmux(['❯ \n', stuck]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'stuck text\nand its second line',
    );
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: 'stuck text' });
  });
});
```


- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts -t 'clearBox reports on the whole box'
cd server && ./node_modules/.bin/vitest run test/send.test.ts -t 'the clobber guard sees the whole box'
```

Expected, at `d7137c2`:
- `does not report cleared while rows below the marker still hold text` — fails. The blank marker row
  never even reaches `clearBox` (the guard is `if (draft)`), so `sendPrompt` types straight onto the
  existing rows and returns `verify-failed`.
- `refuses draft-present on a BLANK marker row with content below it` — fails: it returns
  `verify-failed`, having typed into somebody's box.
- `the refusal carries rows 2..N, never an empty string` — fails for the same reason.
- `an ORDINARY multi-row draft is reported in full` — fails with
  `expected 'a human mid-sentence' to be 'a human mid-sentence\nwith a second line'`.
- `enter-ignored still reports the MARKER ROW only` — **passes, and must keep passing.** It is the
  regression guard on the one refusal whose `draft` must NOT widen.
- `still reports cleared on a genuinely empty box` — passes; regression guard on the terminator.

- [ ] **Step 3: Write minimal implementation**

In `clearBox`, replace the terminator:

```ts
    // THE WHOLE BOX, not the marker row. `draftOf` reads row one only, and this
    // used to terminate on that alone.
    if (draftOf(ansi) === '' && !hasContentBelowMarker(ansi)) return { state: 'cleared' };
    const left = draftOf(ansi);
```

and keep the two lines that follow it unchanged:

```ts
    if (i >= opts.look || now() >= deadline) return { state: 'residue', draft: left };
    await d.tmux.sendKey(id, 'C-u');
```

Note that `residue.draft` still reports the marker row — that field is display, and on a blank marker
row it correctly reports `''` meaning "row one is empty"; the caller's own refusal is what carries the
full text — the widened `draft-present` refusal below.

Correct the docstring paragraph. Replace:

```
 * Terminating a look round on `draftOf() === ''` is sound because kills run
 * bottom-up while `draftOf` reads the box's FIRST row (the `❯` marker sits
 * there; continuation rows are indented two spaces and carry no marker — both
 * confirmed against real `capture-pane -e` bytes, see LIVE_CU_FRAMES in the
 * tests), so that row is the LAST to empty.
```

with:

```
 * Terminating a look round on the box's FIRST row alone was sound only while
 * that row had started NON-blank: kills run bottom-up and `draftOf` reads row
 * one (the `❯` marker sits there; continuation rows are indented two spaces
 * and carry no marker — both confirmed against real `capture-pane -e` bytes,
 * see LIVE_CU_FRAMES in the tests), so row one is the LAST to empty. On a box
 * whose marker row was ALREADY blank the argument inverts: the first look
 * round reads '' with every row below it untouched, and reporting `cleared`
 * there hands the caller a box it is about to concatenate onto. Since the
 * clobber guard sees the whole box (`hasContentBelowMarker`), that shape is
 * reachable on both clear arms — and `replaceDraft` is operator-reachable from
 * the PWA — so the terminator asks the same question the guard does.
```

**And the guard's half — same file, same commit, because neither is green without the other:**

Add beside `hasContentBelowMarker` in `server/src/inject/send.ts`:

```ts
/**
 * Everything the box holds, marker row first, blank rows dropped — the text a
 * clobber refusal is REFUSING TO DESTROY, and therefore the text the operator
 * has to be shown before deciding to replace or append to it.
 *
 * `draftOf` alone is the marker row, which is the wrong unit for that question
 * twice over: a wedge whose marker row is blank reads as an empty box, and an
 * ordinary two-line human draft reads as its first line, so the PWA's conflict
 * sheet showed one row and "Append anyway" retyped that row plus the new text —
 * silently destroying rows 2..N.
 *
 * NOT used for `enter-ignored`. That refusal's `draft` is a CORRESPONDENCE
 * CLAIM handed back to `submitEnter`, whose gate compares `draftOf`'s
 * single-row reading against it; a multi-row claim would refuse `box-mismatch`
 * on every rescue. Two questions, two readings, deliberately.
 */
const boxText = (ansiPane: string): string =>
  [draftOf(ansiPane), ...continuationRows(ansiPane)].filter((r) => r !== '').join('\n');
```

`boxText` must be declared **after** `continuationRows` in source order, or hoisting rules bite:
`continuationRows` is a `function` declaration (hoisted) but `draftOf` is a `const` — put `boxText`
next to `hasContentBelowMarker`, which is already below both.

Replace the guard:

```ts
    const draft = draftOf(pane);
    if (draft) {
```

with:

```ts
    const draft = draftOf(pane);
    // THE BOX HOLDS ANYTHING — not "the marker row is non-blank". A wedge whose
    // FIRST row is blank was invisible here: measured, a send into such a box
    // issued zero C-u and typed onto the end of the existing content, so the
    // session received the concatenation as ONE turn — including dispatch's
    // `/clear`, which would submit `…brief text/clear` on a single line.
    // `hasContentBelowMarker` already existed for `submitEnter`, which named
    // this exact pane `blank-first-row`; the guard simply never asked.
    //
    // WHERE THE SHAPE STILL COMES FROM, after Task 402. That task makes
    // `composePrompt` strip leading blank lines, so neither the app's Composer
    // nor the coordinator nor a curl caller can MANUFACTURE a blank marker row
    // any more. The two producers that remain are a HUMAN typing Enter first
    // into the box, and any pre-402 client still on the wire. Both are enough:
    // this guard is what stands between them and a silent concatenation.
    if (draft || hasContentBelowMarker(pane)) {
```

Replace the `draft-present` refusal:

```ts
      } else if (!opts.replaceDraft) {
        // `boxText`, not `draft`: the operator is being shown what this refusal
        // is protecting, and every row of it is at stake — the conflict sheet
        // renders this and builds "Append anyway" out of it. On a blank marker
        // row `draft` is '' and this is rows 2..N, which is exactly the case
        // that must never send '' (an empty well, and an append that drops what
        // it claims to be appending to).
        return { ok: false, error: 'draft-present', draft: boxText(pane) };
      } else {
```

Everything inside the `resumeIfOwn` and `clearMailResidue` branches keeps reading `draft` (the marker
row): both are identity checks against `needle`/`isMailResidue`, which are marker-row questions.


- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/routes.test.ts
```

Expected: **everything green.** Both halves are in; there is no red intermediate commit on this
branch. Any existing `draft-present` assertion whose fixture has continuation rows now reports more
text — read the failure and update the expectation; **do not narrow `boxText`.**

**Then the two mutations, because this is the task the whole section's safety rests on.** Revert the
guard to `if (draft) {` alone: `refuses draft-present on a BLANK marker row` and the two beside it
must red. Revert the terminator to `if (left === '') return { state: 'cleared' };`:
`does not report cleared while rows below the marker still hold text` must red. Restore both.

- [ ] **Step 5: Commit**

```
git add server/src/inject/send.ts server/test/send.test.ts
git commit -m "fix(inject): the box is read whole — clobber guard and clearBox terminator (W4 §4.2)

Two halves of one behaviour change, in one commit because neither is green
alone. The guard tested the MARKER ROW, so a wedge whose first row is blank was
invisible: measured, a send into such a box issued zero C-u and typed onto the
end of the existing content, delivering the concatenation as one turn —
including dispatch's /clear, as `…brief text/clear`. And clearBox's
last-to-empty argument inverts on exactly that shape, so it reported `cleared`
having cleared almost nothing, after which the type loop concatenated onto the
wreckage — under a button (replaceDraft) an operator can press from the PWA.
The draft-present refusal now carries every row it is refusing to destroy;
enter-ignored's stays the marker row, because submitEnter's correspondence gate
compares a single-row reading."
```

---

### Task 407: `isMailResidue` recognises a stranded `/clear`, through the shared fence

**RULED IN by the operator on 2026-08-16 — but PROVENANCE-GATED, and that changes the task's shape.**
This task was flagged because it moves opposite to the refuse-only ruling: `isMailResidue` gates
`replaceDraft`, so extending it makes the mail lane auto-clear a box where it does not today. The
objection was right, and the resolution is not "match more narrowly" — it is **match on provenance,
not on text.**

**Exact-match on `/clear` does NOT establish provenance.** `/clear` is a plausible thing for an
operator to type and leave sitting; a text predicate cannot tell that box from one this system
stranded, and refuse-only exists to protect exactly the operator's copy.

**So the requirement is: clear it only when this delivery can PROVE it typed that `/clear` itself** —
i.e. when this delivery's own previous attempt is recorded as having sent `/clear` and ended
`enter-ignored`. The lane has that fact: `dispatch.ts` is what strands the text, and the delivery row
carries `attempts`/`lastError` (surfaced by Task 411). If provenance cannot be established for a given
box, **refuse** — that is the unchanged default, not a fallback.

**This likely means `isMailResidue` is the wrong home.** It is a pure text predicate, and giving it a
provenance argument would have it decide something its inputs cannot see. Prefer moving the decision to
the caller that holds the provenance and passing `replaceDraft` explicitly — an adapter may not narrow
a distinction it received, and "machine debris" vs "operator text" is exactly such a distinction.
**Settle the shape in step 1** by reading `dispatch.ts`'s delivery path and `isMailResidue`'s call
sites; implement whichever placement keeps the text predicate honest. The test below pins the
BEHAVIOUR (a stranded `/clear` gets replaced, an operator's identical `/clear` does not) and must
survive either placement — if it cannot distinguish those two cases, the implementation is wrong.

Everything else in Wave 4 stands without this task.

`dispatch.ts` documents the wedge it creates, verbatim: *"on `enter-ignored` the literal text `/clear`
is left sitting in the worker's own input box … the delivery lane's very next sweep calls `sendPrompt`
with no `replaceDraft`, so it would hit `draft-present` immediately and keep hitting it — parking the
brief `rejected('undeliverable')` after `MAIL_MAX_ATTEMPTS`, with nothing surfacing WHY."* One dirty box
silences a wave. `isMailResidue` is the existing, gated door for machine debris this system itself left
behind; this task proposes extending it to that one shape.

`single-definition.test.ts`'s `Build 4 — one ccrc-mail fence` describe **invites the other half of this
task by name**: its holder list is `['server/src/inject/send.ts', 'shared/api.ts']` and its comment says
whoever next edits `inject/send.ts` should import `MAIL_ENVELOPE_FENCE` and shorten the array to
`shared/api.ts` alone. Wave 4 edits that file five times; taking the invitation without shortening the
array reds the suite as a mystery failure.

**Files:**
- Modify: `server/src/inject/send.ts` — `isMailResidue`, current body verbatim
  `if (draft === '') return false; if (MAIL_RESIDUE_CHIP.test(draft)) return true; if (draft.startsWith('```') && draft.includes('ccrc-mail')) return true; return false;`
  and the import line `import { composePrompt } from '../../../shared/api.js';`
- Modify: `server/test/single-definition.test.ts` — the `it('the fence spelling survives in ONE other file, named here BY NAME', …)` case
- Test: `server/test/send.test.ts`

**Interfaces:**
- Consumes: `MAIL_ENVELOPE_FENCE` (`shared/api.ts`, value `'ccrc-mail'`).
- Produces: `isMailResidue(draft: string): boolean` — **signature unchanged**; one new recognised shape,
  an exact-match `/clear`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/send.test.ts` (there is an existing `isMailResidue` group — put these beside it):

```ts
describe('isMailResidue recognises the /clear this system strands', () => {
  // dispatch.ts documents creating this wedge itself: on `enter-ignored` the
  // literal `/clear` is left in the worker's box, the delivery lane's next
  // sweep refuses `draft-present`, and the wave brief parks undeliverable with
  // nothing surfacing why. One dirty box silences a wave.
  it('matches a bare /clear', () => {
    expect(isMailResidue('/clear')).toBe(true);
  });

  // EXACT MATCH ONLY, and this is the whole safety argument. `isMailResidue`'s
  // contract is that it structurally cannot match a human mid-sentence (F2);
  // `/clear` is four characters a human COULD type, so the narrowing is
  // deliberate — clearing a bare slash command costs its author a retype, while
  // a PREFIX rule would eat a sentence that merely begins with it.
  it('does NOT match anything that merely starts with /clear', () => {
    expect(isMailResidue('/clear the cache before you start')).toBe(false);
    expect(isMailResidue('/clearance check')).toBe(false);
  });

  it('still refuses an ordinary human draft', () => {
    expect(isMailResidue('can you also check the staging deploy')).toBe(false);
    expect(isMailResidue('')).toBe(false);
  });

  it('still matches the two shapes it already did', () => {
    expect(isMailResidue('[Pasted text #1 +54 lines]')).toBe(true);
    expect(isMailResidue('```ccrc-mail')).toBe(true);
  });
});
```

And in `server/test/single-definition.test.ts`, change the holder expectation:

```ts
    // `inject/send.ts` reached the fence through a hand-spelled literal, and
    // this list recorded that as a named gap with an instruction: whoever next
    // has a reason to edit that file should import MAIL_ENVELOPE_FENCE and
    // shorten this array. Wave 4 had five reasons; it took the invitation.
    expect(holders).toEqual([
      'shared/api.ts',               // MAIL_ENVELOPE_FENCE (the definition)
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts -t 'isMailResidue recognises'
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the fence spelling survives'
```

Expected: `expected false to be true` on `/clear`, and
`expected [ 'server/src/inject/send.ts', 'shared/api.ts' ] to deeply equal [ 'shared/api.ts' ]`.

- [ ] **Step 3: Write minimal implementation**

Change the import line in `server/src/inject/send.ts`:

```ts
import { composePrompt, MAIL_ENVELOPE_FENCE } from '../../../shared/api.js';
```

Replace `isMailResidue` and extend its docstring:

```ts
/**
 * Draft shapes only a MACHINE in this system could have left in the box:
 *
 *  - a Claude Code paste-chip collapse of a multi-line envelope the OLD typed
 *    lane typed (`[Pasted text #N …]`);
 *  - a stranded ```ccrc-mail fence opener — `renderEnvelope`'s own first
 *    rendered line — left un-submitted by a lost Enter;
 *  - a bare, EXACT `/clear`, added Wave 4 on the operator's ruling. That one is
 *    not historical: `dispatch.ts` documents creating it on every wave whose
 *    `/clear` comes back `enter-ignored`, and its own comment traces the
 *    consequence — the delivery lane's next sweep refuses `draft-present`,
 *    keeps refusing, and parks the wave brief `undeliverable`. One dirty box
 *    silences a wave.
 *
 * The `/clear` rung is EXACT-MATCH, and that is the whole safety argument.
 * Every other shape here is one no human writes, so this function could
 * promise it can never match a human's own text (F2). `/clear` is four
 * characters a human plausibly types — so the promise narrows honestly:
 * clearing a bare slash command costs its author a retype of four characters
 * and nothing else, while a PREFIX rule would eat a sentence that merely
 * begins with it. Do not relax it to `startsWith`.
 *
 * This is a permission the CALLER grants (`clearMailResidue`), and `sweepMail`
 * grants it only for a delivery with a prior attempt on record — belt AND
 * suspenders, not either alone.
 */
const MAIL_RESIDUE_CHIP = /^\[Pasted text #\d+/;
export function isMailResidue(draft: string): boolean {
  if (draft === '') return false;
  if (MAIL_RESIDUE_CHIP.test(draft)) return true;
  if (draft.startsWith('```') && draft.includes(MAIL_ENVELOPE_FENCE)) return true;
  if (draft.trim() === '/clear') return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/inject/send.ts server/test/send.test.ts server/test/single-definition.test.ts
git commit -m "fix(mail): the delivery lane clears the /clear it stranded, and reaches the fence through the shared constant (W4)"
```

---

### Task 408: `MailSummary` carries `attempts` and `lastError`

`draft-present` lands in `mail_deliveries.lastError`, a SQLite column with **no wire type, no route and
no PWA reader** — grepped at `d7137c2`, `lastError` has zero hits anywhere in `pwa/src`. `MailSummary`
carries only `state`, so a delivery blocked for fifteen minutes is byte-identical to one merely waiting.

**`lastError` is free text.** It is written by `store.backOff(id, lastError, …)` and
`rejectDelivery(id, code, lastError)` from four call sites carrying, variously, a typed `sendPrompt`
error code, `'recipient not in registry'`, `'run closed'`, and `MAIL_REPLAY_CEILING_ERROR` — a whole
English sentence. Putting it on the wire makes the PWA a consumer of free text. **How that is handled,
and it is not negotiable:** type it `string | null` and branch on `=== 'draft-present'` only. Never a
total `Record<string, …>` lookup, which is a fresh way for a new server value to break an old client;
never a display of the raw string. The one value the client is allowed to recognise is the one the
server writes as a literal token.

**Files:**
- Modify: `shared/api.ts` — `MailSummary` (ends `state: MailDeliveryState;`); add exported
  `MAIL_MAX_ATTEMPTS`
- Modify: `server/src/watch.ts` — delete `const MAIL_MAX_ATTEMPTS = 6;`, import it instead
- Modify: `server/src/coord/store.ts` — `MAIL_ROW_COLUMNS` (ends
  `'m.kind AS kind, m.subject AS subject, m.artifacts AS artifacts, d.state AS state'`), `MailRowDb`,
  `hydrateMail`
- Modify: `pwa/test/stores.test.ts` (`const mailFixture: MailSummary = {`),
  `pwa/test/tap-targets.test.tsx` (`const mailItem = (over: Partial<MailSummary> = {}): MailSummary => ({`),
  `pwa/test/mail-strip.test.tsx` (`const m = (over: Partial<MailSummary> = {}): MailSummary => ({`)
- Test: `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MailSummary.attempts: number` — send attempts this DELIVERY has made. On the wire so a back-off is
    visible BEFORE the park.
  - `MailSummary.lastError: string | null` — RAW. Branch on `=== 'draft-present'`; never a total map.
  - `MAIL_MAX_ATTEMPTS = 6` exported from `shared/api.ts` — so the PWA can render the CEILING without a
    second copy of a policy number.
  - **No migration.** Both columns already exist on `mail_deliveries` (`schema.ts`:
    `attempts INTEGER NOT NULL DEFAULT 0`, `lastError TEXT`).
  - `outstandingMailFor` needs no predicate change: a `draft-present` back-off leaves the delivery
    `queued`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/coord-store.test.ts`:

```ts
describe('a blocked delivery is visible on the wire before it is lost', () => {
  it('hydrateMail carries attempts and lastError straight off mail_deliveries', () => {
    const coord = store();               // this file's existing fixture helper (line 14)
    const mail = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
      toId: 'w1', runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = coord.queueDelivery(mail.id, 'w1', 'env');
    coord.backOff(d.id, 'draft-present', Date.now() + 30_000);
    coord.backOff(d.id, 'draft-present', Date.now() + 60_000);

    const [row] = coord.outstandingMailFor('w1');
    expect(row!.attempts).toBe(2);
    expect(row!.lastError).toBe('draft-present');
    // The back-off leaves the row QUEUED — which is why the predicate needs no
    // change and why the strip can render a live count rather than a park.
    expect(row!.state).toBe('queued');
  });

  it('a delivery that has never failed reports 0 and null, not a guess', () => {
    const coord = store();
    const mail = coord.insertMail({ fromId: 'w1', fromUuid: 'u1', toId: 'coordinator',
      runId: null, kind: 'status', subject: 'done', body: 'ok', artifacts: [] });
    coord.queueDelivery(mail.id, 'coordinator', 'env');
    const [row] = coord.outstandingMailFor('coordinator');
    expect(row!.attempts).toBe(0);
    expect(row!.lastError).toBeNull();
  });

  it('mailForRecipient reads the same two columns — one hydrator, not two', () => {
    const coord = store();
    const mail = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
      toId: 'w1', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(mail.id, 'w1', 'env');
    coord.backOff(d.id, 'dialog-open', Date.now() + 1000);
    expect(coord.mailForRecipient('w1')[0]!.lastError).toBe('dialog-open');
  });
});
```

`store()` IS this file's helper, verbatim at `d7137c2`:
`const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));`
— and `openRun(s, over)` beside it is the run factory. Read the top
of `server/test/coord-store.test.ts` and reuse it verbatim rather than adding a second fixture.

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t 'a blocked delivery is visible'
```

Expected: TypeScript refuses `row!.attempts` (`Property 'attempts' does not exist on type
'MailSummary'`) and the suite fails at compile.

- [ ] **Step 3: Write minimal implementation**

`shared/api.ts` — extend `MailSummary` after `state: MailDeliveryState;`:

```ts
  /** Send attempts this DELIVERY has made (`mail_deliveries.attempts`). On the
   *  wire so a back-off is visible BEFORE the park: without it a delivery
   *  blocked for fifteen minutes is byte-identical to one merely waiting. */
  attempts: number;
  /**
   * The delivery lane's last failure, RAW (`mail_deliveries.lastError`).
   *
   * FREE TEXT, and treated as such. Four writers put four different kinds of
   * thing here: a typed `sendPrompt` error code, `'recipient not in registry'`,
   * `'run closed'`, and a whole English sentence
   * (`MAIL_REPLAY_CEILING_ERROR`). A client may therefore branch on the ONE
   * literal token it has a surface for — `=== 'draft-present'` — and must never
   * key a total `Record` off it (a new server value would break an old client
   * at render time) nor display it raw.
   */
  lastError: string | null;
```

and, beside the other L0 policy constants:

```ts
/** The PRE-DELIVERY attempt budget for one mail delivery — the `6` in
 *  "attempt 3 of 6". L0 because BOTH sides name it now: `watch.ts`'s
 *  `sweepMail` enforces it, and the session mail strip renders the ceiling so
 *  the operator can see how much room is left before a park. Typing `6` again
 *  in the PWA would be a second copy of a policy number; the full reasoning for
 *  the VALUE lives beside its enforcement, on `watch.ts`'s import of this. */
export const MAIL_MAX_ATTEMPTS = 6;
```

`server/src/watch.ts` — delete the line `const MAIL_MAX_ATTEMPTS = 6;`, leave its long docstring where
it is (retitled as a note about the imported constant), and add `MAIL_MAX_ATTEMPTS` to the existing
`shared/api.js` import list. Nothing else in that file changes.

`server/src/coord/store.ts`:

```ts
const MAIL_ROW_COLUMNS =
  'm.id AS id, d.id AS deliveryId, m.at AS at, m.fromId AS fromId, d.toId AS toId, m.runId AS runId, ' +
  'm.kind AS kind, m.subject AS subject, m.artifacts AS artifacts, d.state AS state, ' +
  'd.attempts AS attempts, d.lastError AS lastError';

interface MailRowDb {
  id: number; deliveryId: number; at: number; fromId: string; toId: string; runId: number | null;
  kind: string; subject: string; artifacts: string; state: string;
  attempts: number; lastError: string | null;
}
```

and in `hydrateMail`'s mapped literal, after the `state:` entry:

```ts
      attempts: r.attempts, lastError: r.lastError,
```

Then add the two fields to the three PWA fixtures so `cd pwa && npm run build` type-checks:
`pwa/test/stores.test.ts`'s `mailFixture`, `pwa/test/tap-targets.test.tsx`'s `mailItem`, and
`pwa/test/mail-strip.test.tsx`'s `m` all gain `attempts: 0, lastError: null,`.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
cd pwa && npm run build
```

`cd pwa && npm run build` is not optional here and not a formality: `pwa/test` is type-checked by
**nothing** in `cd pwa && npm run test`, so a missed fixture leaves the PWA suite green and breaks the
build.

- [ ] **Step 5: Commit**

```
git add shared/api.ts server/src/watch.ts server/src/coord/store.ts server/test/coord-store.test.ts pwa/test/stores.test.ts pwa/test/tap-targets.test.tsx pwa/test/mail-strip.test.tsx
git commit -m "feat(mail): attempts + lastError on the wire — a blocked delivery stops looking like a waiting one (W4 §4.5)"
```

---

### Task 409: the first back-off tells the sender, and the park is recorded

Today a `draft-present` back-off is silent and the park's only operator-visible signal arrives **on the
recipient's screen, after the fact**. Every existing passage in the coordinator skill's reference corpus
is recipient-side (`undeliverable` ×3, `rejected` ×4, `blocked` ×0 — and `MailStrip` already renders
*"undeliverable — act on it directly"*). **The sender is who is told nothing**, and coordinator↔worker
mail is the only channel Build 7 has.

**Files:**
- Modify: `server/src/watch.ts` — `sweepMail`, at the failure tail, found by
  `const attempts = d.attempts + 1;` and the two `store.rejectDelivery(d.id, 'undeliverable', …)` calls
  plus the final `store.backOff(d.id, res.error, now + step);`
- Modify: `server/src/coord/store.ts` — add `mailOrigin`
- Test: `server/test/mail-sweep.test.ts`

**Interfaces:**
- Consumes: `FleetWatcher.pushOne` (private, already in this class); `CoordStore.resolveCoordinator(runId: number | null): string | null`.
- Produces: `CoordStore.mailOrigin(mailId: number): { fromId: string; runId: number | null; subject: string } | null`
  — SYNCHRONOUS like the rest of `CoordStore`. A dedicated one-row read rather than widening
  `dueDeliveries` with a JOIN: `dueDeliveries` runs on every sweep over every due row, this runs only
  when a notification is actually about to be raised.
- Produces: `sweepMail` raises **one** `NotifyEvent` of the **existing** kind `'mail'` on (a) the FIRST
  `draft-present` back-off for a delivery, and (b) the park. No new `NotifyEvent['kind']`:
  `KIND_WORD`/`KIND_GLYPH` are total maps, so a new kind means touching both plus `NOTIFY_KINDS`.

**DEVIATION FROM THE SPEC, and it is the tree winning. ACCEPTED by the operator on 2026-08-16.**
§4.5 says the park writes a `run_events` row.
It cannot, and must not be made to. `run_events` is written in exactly one place — `advanceInner`, whose
own docstring calls itself *"the ONLY way a run's state changes, and the only place `run_events` is
written"* — and every insert there is paired with a state transition validated against
`RUN_TRANSITIONS`, which has **no self-transition for any state**. A park is not a run transition, and
writing one would either invent a second `run_events` writer or lie about the run's state. The durable
record the spec is actually asking for already exists and is written at exactly the right point:
`pushOne` records into `NotifyLog` **and** mirrors it into `CoordStore.recordFeedEvent`, the durable
archive behind the feed. The spec's own PWA section agrees — *"the sender-side and park signals land in
the feed (`MailScreen`), not the strip"*. So: feed row + push, no `run_events`.

**This is a plan overriding a spec requirement, so it needs the operator's yes before Wave 4 runs** —
one line, alongside Task 407's. The substitution is *durable feed row + push* in place of
*`run_events` row + push*; the durability the spec asked for is preserved, the writer-count invariant
`advanceInner` states about itself is preserved, and nothing else in the wave depends on which table
it lands in. If the operator prefers the literal `run_events` row, the honest cost is a second
`run_events` writer that inserts without a transition — say so and let them choose.

- [ ] **Step 1: Write the failing test**

Add to `server/test/mail-sweep.test.ts`:

```ts
describe('a blocked delivery reaches its SENDER', () => {
  // Settled by reading the file rather than assuming: this suite builds every
  // watcher from `testDeps`, which supplies NO `push` and NO `notifyLog`, and
  // asserts nothing about either. The notification is therefore purely
  // additive here — it reds no existing absence assertion — and a test that
  // wants to observe it must wire a push of its own, the way
  // push-copy.test.ts does.
  const pushSpy = () => {
    const sent: { title: string; body: string; sessionId: string; tag?: string }[] = [];
    return { sent, push: { notify: async (p: never) => { sent.push(p as never); } } };
  };

  it('emits ONE notification to the sender on the FIRST draft-present back-off', async () => {
    const h = harness({ panes: ['❯ half-typed human draft\n'] });   // draft-present every read
    const coord = store(h.home);                                     // this file's helper, line 102
    const { sent, push } = pushSpy();
    const { w } = await primedWatcher(h, coord, { push: push as never });
    seedRecipient(h, 'w1');
    const mail = coord.insertMail({ fromId: 'boss', fromUuid: 'u-boss', toId: 'w1',
      runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    coord.queueDelivery(mail.id, 'w1', 'env');

    await w.sweepMail();
    expect(sent.filter((p) => p.sessionId === 'boss')).toHaveLength(1);
    expect(sent[0]!.body).toContain('input box');

    // SECOND back-off: the row is already known-blocked, so it does NOT
    // re-notify. `checkMail`'s dedupe already makes the STRIP live on every
    // tick; the tray is not a ticker.
    advance(MAIL_SWEEP_MS + 60_000);
    await w.sweepMail();
    expect(sent.filter((p) => p.sessionId === 'boss')).toHaveLength(1);
  });

  it('records and pushes the PARK — the wave brief that can never land', async () => {
    const h = harness({ panes: ['❯ half-typed human draft\n'] });
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const { w } = await primedWatcher(h, coord, { push: push as never });
    seedRecipient(h, 'w1');
    const mail = coord.insertMail({ fromId: 'boss', fromUuid: 'u-boss', toId: 'w1',
      runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = coord.queueDelivery(mail.id, 'w1', 'env');

    for (let i = 0; i < MAIL_MAX_ATTEMPTS; i++) {
      await w.sweepMail();
      advance(MAIL_SWEEP_MS + 16 * 60_000);   // past the largest back-off step
    }
    expect(deliveryRow(coord, d.id).state).toBe('rejected');
    // Parking is KEPT — a message that can never land should not retry forever.
    // What was wrong was parking SILENTLY.
    const parks = sent.filter((p) => p.sessionId === 'boss' && /gave up|undeliverable/.test(p.body));
    expect(parks).toHaveLength(1);
  });

  it("resolves the 'coordinator' role rather than pushing to a session that does not exist", async () => {
    // System mail (`queueSystemMail`) writes the literal fromId 'coordinator',
    // which is a ROLE, not a session. Pushing to it would tag and
    // presence-gate against an id no registry row carries.
    const h = harness({ panes: ['❯ half-typed human draft\n'] });
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const { w } = await primedWatcher(h, coord, { push: push as never });
    seedRecipient(h, 'w1');
    const runId = openRunClaimedBy(coord, 'the-coordinator');
    const mail = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'w1',
      runId, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    coord.queueDelivery(mail.id, 'w1', 'env');

    await w.sweepMail();
    expect(sent.map((p) => p.sessionId)).not.toContain('coordinator');
    expect(sent.map((p) => p.sessionId)).toContain('the-coordinator');
  });
});
```

**Five of these helpers exist and two do not** — checked at `d7137c2` rather than assumed:

| name | status |
|---|---|
| `harness({panes})` | exists (line 180) |
| `primedWatcher(h, coord, over)` | exists (line 224) |
| `advance(ms)` | exists (line 238) |
| `deliveryRow(coord, id)` | exists (line 168) — and already selects `attempts` and `lastError` |
| `store(home)` | exists (line 102). **There is no `openCoord`.** |
| `MAIL_SWEEP_MS` | exists (line 38) |
| `seedRecipient` | **does not exist** — the file's registry seeder is `seedRegistry(home, id, uuid?)` |
| `openRunClaimedBy` | **does not exist** |

So the two missing ones are written here, at the top of the new describe:

```ts
/** A recipient the sweep's gate will accept: a registry row, a hookstate and a
 *  livestate that reads idle and quiet. Composed from this file's three seeders
 *  rather than reinventing them — `harness()` already created `.cc-sessions`,
 *  and all three must run AFTER `primedWatcher`, per its own docstring. */
const seedRecipient = (h: Harness, id: string): void => {
  seedRegistry(h.home, id);
  seedHookState(h.home, id);
  seedLiveState(h.home);
};

/** An open run whose claim names `claimedBy` — the session the 'coordinator'
 *  ROLE resolves to. `openRun` returns a union with a refusal arm, so narrow
 *  before reading `id` (the pattern every coord-* test uses). */
const openRunClaimedBy = (coord: CoordStore, claimedBy: string): number => {
  const opened = coord.openRun({ program: 'build4', title: 'T', project: 'demo',
    wave: 1, waveOf: 3, claimedBy });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  return opened.id;
};
```

(`MAIL_MAX_ATTEMPTS` comes from `shared/api.js`; add it to the file's imports if it is not there.)

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts -t 'a blocked delivery reaches its SENDER'
```

Expected: `expected [] to have a length of 1 but got 0` on all three — nothing notifies the sender
today.

- [ ] **Step 3: Write minimal implementation**

`server/src/coord/store.ts`, beside the other mail reads:

```ts
  /** Who sent a mail, and under which run — the two fields a SENDER-SIDE
   *  notification needs and `dueDeliveries` deliberately does not select.
   *  A dedicated one-row read rather than a JOIN on `dueDeliveries`: that query
   *  runs over every due row on every sweep, this runs only when a
   *  notification is about to be raised. SYNCHRONOUS, like everything here. */
  mailOrigin(mailId: number): { fromId: string; runId: number | null; subject: string } | null {
    const row = this.db.prepare('SELECT fromId, runId, subject FROM mail WHERE id = ?')
      .get(mailId) as { fromId: string; runId: number | null; subject: string } | undefined;
    return row ?? null;
  }
```

`server/src/watch.ts`, inside `sweepMail`, replace the failure tail. Current text, verbatim:

```ts
        const attempts = d.attempts + 1;
```
…through…
```ts
        const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
        store.backOff(d.id, res.error, now + step);
```

New:

```ts
        const attempts = d.attempts + 1;
        /**
         * Tell the SENDER, once. Every operator-visible signal this lane had
         * was recipient-side and arrived only AFTER the park — and
         * coordinator↔worker mail is the only channel Build 7 has, so one dirty
         * input box silences a whole wave with nothing anywhere saying why.
         *
         * `recordAlways: true` for the same reason `pushNewMail` sets it: an
         * undeliverable message is a fact that happened whether or not the
         * operator is looking at the sender's pane. The PUSH stays
         * presence-gated, exactly as it is for every kind.
         *
         * The existing `'mail'` kind, deliberately: `KIND_WORD`/`KIND_GLYPH` in
         * `MailScreen` are TOTAL maps, so a seventh kind means editing both plus
         * `NOTIFY_KINDS` and every older client renders `undefined`.
         */
        const tellSender = (why: string, tag: string): void => {
          const origin = store.mailOrigin(d.mailId);
          if (!origin) return;
          const senderId = origin.fromId === 'coordinator'
            ? store.resolveCoordinator(origin.runId)
            : origin.fromId;
          // Degrade, never guess: an unresolvable 'coordinator' role has no
          // session to notify, and inventing one would tag and presence-gate
          // against an id no registry row carries.
          if (senderId === null) return;
          this.pushOne({
            kind: 'mail', sessionId: senderId,
            project: sessionProjects.get(senderId) ?? '',
            title: `✉ blocked › ${d.toId}`,
            body: `${origin.subject}: ${why}`,
            tag,
            recordAlways: true,
          }, projects);
        };

        if (d.deliveredAt === null) {
          if (res.error === 'enter-ignored') {
            tellSender('the recipient never took the message — it is sitting in their input box',
              `mail-parked-${d.id}`);
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
          if (attempts >= MAIL_MAX_ATTEMPTS) {
            // PARKING IS KEPT (Q19): a message that can never land should not
            // retry forever. What was wrong was parking SILENTLY.
            tellSender(`the lane gave up after ${attempts} attempts (${res.error})`,
              `mail-parked-${d.id}`);
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
        }
        // The FIRST failure of this kind, and only the first: `d.lastError`
        // is what the row already carried coming in, so a repeat of the same
        // refusal does not re-raise. The STRIP is what stays live across every
        // back-off tick (`attempts` on the wire makes `checkMail`'s
        // JSON.stringify dedupe re-emit); the tray is not a ticker.
        if (res.error === 'draft-present' && d.lastError !== 'draft-present') {
          tellSender("the recipient's input box has unsent text in it", `mail-blocked-${d.id}`);
        }
        const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
        store.backOff(d.id, res.error, now + step);
```

Two supporting edits in the same function, both mechanical:

1. `dueDeliveries`' row shape gains nothing, but the loop needs the row's incoming `lastError`. Add
   `lastError` to `CoordStore.dueDeliveries`' select list and its return type
   (`'SELECT id, mailId, toId, attempts, lastError, envelope, deliveredAt, ingestedAt FROM mail_deliveries '`),
   with `lastError: string | null` on both type annotations. That is the row the sweep is about to act
   on; reading it a second time would be a race with its own write.
2. `projects` and `sessionProjects` — build them from `records`, which `sweepMail` already has:

```ts
    const projects = new Set(records.map((r) => r.project));
    const sessionProjects = new Map(records.map((r) => [r.id, r.project] as const));
```

placed immediately after `const records = registryRead.records;`. `pushOne` decorates on project COUNT
alone and degrades an empty project to no decoration, so a sender the registry does not list is
undecorated rather than dangling.

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd server && ./node_modules/.bin/vitest run test/push-copy.test.ts
```

- [ ] **Step 5: Commit**

```
git add server/src/watch.ts server/src/coord/store.ts server/test/mail-sweep.test.ts
git commit -m "feat(mail): the first block and the park tell the SENDER — a wedged box no longer silences a wave in silence (W4 §4.5)"
```

---

### Task 410: the rescue gate widens on `submittable`, and `verify-failed` gets a true sentence

`ChatList.tsx`'s gate at `d7137c2` is verbatim:

```tsx
        {send.code === 'enter-ignored' && send.draft !== undefined && send.draft.trim() !== '' && (
```

and the comment directly above it argues **against** exactly this widening: *"a button that submits an
unproven box is the hazard this whole route is gated against — so the operator gets the sentence and the
terminal, not a tap that might send someone else's text."* That argument is correct and must be
**engaged**, not stepped around: `submittable` is the discriminator that answers it, and the comment is
rewritten to say so.

`SEND_ERROR_TEXT['verify-failed']` is, verbatim at `d7137c2`,
*"The session never showed the text — open the terminal to check."* It is false twice after this build:
the text IS in the box, and §4.4 makes the refusal fire more often. Wave 4 **mints a new sentence** for
it — *"Typed it, but the session never echoed it back."* — which **does not exist anywhere in the
tree**. Do not grep for it; do not go looking for a register to copy. Its neighbour is, verbatim,
`'enter-ignored': "Typed it, but the session didn't take it.",` and it is **left exactly as it is**; the
two become adjacent sentences in one register, which is the point, not the same string reused.

**Files:**
- Modify: `pwa/src/lib/api.ts` — `SEND_ERROR_TEXT`'s `'verify-failed'` entry
- Modify: `pwa/src/stores/session.ts` — `PendingSend` (after `draft?: string;`), `failureOf`
  (current signature `const failureOf = (e: unknown): { error: string; code?: string; draft?: string } => {`),
  `retry` and `resolve` (both spell `error: undefined, code: undefined, draft: undefined`)
- Modify: `pwa/src/session/ChatList.tsx` — the gate above and its comment
- Test: `pwa/test/send-it.test.tsx`, `pwa/test/chat.test.tsx`, `pwa/test/api.test.ts`

**Interfaces:**
- Consumes: `SendResult.submittable` (Task 403).
- Produces: `PendingSend.submittable?: boolean`;
  `failureOf(e: unknown): { error: string; code?: string; draft?: string; submittable?: boolean }`.

- [ ] **Step 1: Write the failing test**

In `pwa/test/send-it.test.tsx`, the `failed()` factory gains the flag, and the tripwire is rewritten to
the new contract:

```tsx
const failed = (patch: Partial<PendingSend> = {}): PendingSend => ({
  key: 'p1', text: 'run the tests', state: 'failed',
  error: "Typed it, but the session didn't take it.", code: 'enter-ignored',
  draft: 'run the tests', submittable: true,
  ...patch,
});
```

```tsx
  // AN INTENTIONAL TRIPWIRE FIRING AS DESIGNED. This case used to iterate
  // `verify-failed` among the button-less codes, and its comment said those
  // cases "are kept because they are what fails if the `code` branch is ever
  // widened". The branch was widened — but NOT on `code`, which is the whole
  // design: `verify-failed` earns the button only when the server also proves
  // the box holds the WHOLE message.
  it('is absent for every failure with nothing to submit', () => {
    for (const code of ['dialog-open', 'not-alive', 'draft-clear-failed']) {
      cleanup();
      render(<ChatListInner id="s" events={[]} pending={[failed({ code, error: 'nope' })]} />);
      expect(screen.queryByRole('button', { name: 'Send it' }), code).toBeNull();
    }
  });

  it('appears for a verify-failed the server marked submittable', () => {
    render(<ChatListInner id="s" events={[]} pending={[
      failed({ code: 'verify-failed', error: 'Typed it, but the session never echoed it back.' }),
    ]} />);
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
  });

  // THE DEFECT THE FLAG EXISTS TO PREVENT. The attachment path's
  // `verify-failed` carries a `draft` that is a FAILED CLEAR'S RESIDUE — a
  // fragment of the message — and `submitEnter`'s correspondence gate matches
  // it, presses Enter, and submits the fragment. No flag, no button.
  it('is absent for a verify-failed WITHOUT the flag — the attachment residue, and any older server', () => {
    for (const p of [{ submittable: undefined }, { submittable: false }]) {
      cleanup();
      render(<ChatListInner id="s" events={[]} pending={[
        failed({ code: 'verify-failed', draft: 'a truncated frag', ...p }),
      ]} />);
      expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull();
    }
  });

  it('is absent for an enter-ignored an older server sent without the flag', () => {
    render(<ChatListInner id="s" events={[]} pending={[failed({ submittable: undefined })]} />);
    expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull();
  });
```

In `pwa/test/chat.test.tsx`, the end-to-end path from a 409 body through `failureOf`:

```tsx
  it('a 409 verify-failed with submittable becomes a bubble with a Send it button', async () => {
    const store = createSessionStore('s', { api: {
      prompt: async () => { throw new ApiError(409, 'verify-failed', {
        ok: false, error: 'verify-failed', draft: 'run the tests', submittable: true,
      }); },
    } as never });
    await store.getState().send('run the tests', { replaceDraft: false });
    const p = store.getState().pending[0]!;
    expect(p.code).toBe('verify-failed');
    expect(p.submittable).toBe(true);
    expect(p.draft).toBe('run the tests');
    // retry clears it alongside code/draft — a stale flag would offer a button
    // for a box the server has not re-measured.
    store.getState().retry(p.key);
    expect(store.getState().pending[0]!.submittable).toBeUndefined();
  });
```

In `pwa/test/api.test.ts`:

```ts
  it("verify-failed's sentence stops sending the operator to a terminal", () => {
    // False twice after this build: the text IS in the box, and the box-scoped
    // echo check makes this refusal fire more often. A NEW sentence, minted
    // here — its neighbour `enter-ignored` is unchanged, so the two read as
    // adjacent sentences in one register.
    expect(sendErrorText('verify-failed')).toBe('Typed it, but the session never echoed it back.');
    expect(sendErrorText('enter-ignored')).toBe("Typed it, but the session didn't take it.");
    expect(sendErrorText('verify-failed')).not.toMatch(/terminal/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/send-it.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts -t "verify-failed's sentence"
cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx -t 'a 409 verify-failed'
```

Expected: `Property 'submittable' does not exist on type 'PendingSend'` at compile in the two `.tsx`
files, and `expected 'The session never showed the text — open the terminal to check.' to be 'Typed it,
but the session never echoed it back.'` in `api.test.ts`.

- [ ] **Step 3: Write minimal implementation**

`pwa/src/lib/api.ts`:

```ts
  // Replaced, not reworded. The old sentence ("The session never showed the
  // text — open the terminal to check.") is false twice after Build 8: the text
  // IS in the box — the server stopped clearing it and now hands it back — and
  // the box-scoped echo check makes this refusal fire more often. A message
  // that tells the operator to go somewhere else and do something the UI can do
  // is the dead end `enter-ignored`'s own copy was rewritten to close; this is
  // its neighbour, in the same register, and the button's presence carries the
  // rest.
  'verify-failed': 'Typed it, but the session never echoed it back.',
```

`pwa/src/stores/session.ts` — `PendingSend`, immediately after `draft?: string;`:

```ts
  /** The server proved `draft` is the WHOLE message currently in the box and
   *  that Enter would send exactly it. Read off the 409 body by `failureOf`;
   *  cleared by `retry`/`resolve` alongside `code`/`draft`, because a stale
   *  flag would offer a button for a box the server has not re-measured.
   *  ABSENT = no `Send it` button — which is what an older server sends, and
   *  what the attachment path's residue draft sends deliberately. */
  submittable?: boolean;
```

`failureOf`:

```ts
const failureOf = (e: unknown): { error: string; code?: string; draft?: string; submittable?: boolean } => {
  if (e instanceof ApiError) {
    const body = e.body;
    const b = typeof body === 'object' && body !== null
      ? (body as { error?: unknown; draft?: unknown; submittable?: unknown })
      : {};
    if (b.error === 'draft-present') {
      return { error: 'draft-present', code: 'draft-present', draft: typeof b.draft === 'string' ? b.draft : '' };
    }
    // …existing comment about error/code/draft stays…
    //
    // `submittable` rides alongside `draft` with the SAME `typeof` discipline,
    // and it is not a synonym for the code: `draft` carries three meanings
    // across the failure arms and this is the only thing that tells the one the
    // rescue may act on from the one it must not.
    return {
      error: sendErrorText(e.message), code: e.message,
      ...(typeof b.draft === 'string' ? { draft: b.draft } : {}),
      ...(typeof b.submittable === 'boolean' ? { submittable: b.submittable } : {}),
    };
  }
  return { error: e instanceof Error ? e.message : 'send failed' };
};
```

`dispatch`'s catch must carry it through:

```ts
        const { error, code, draft, submittable } = failureOf(e);
        set((s) => ({
          pending: s.pending.map((p) =>
            p.key === key ? { ...p, state: 'failed' as const, error, code, draft, submittable } : p,
          ),
        }));
```

`retry` and `resolve` each add `submittable: undefined` beside their existing
`error: undefined, code: undefined, draft: undefined`.

`pwa/src/session/ChatList.tsx` — replace the comment and the gate:

```tsx
        {/* For `enter-ignored` AND, since Build 8, `verify-failed` — but never
            on the code alone, and the distinction is the whole design.

            The rule this comment used to state was "only enter-ignored, because
            it is the one refusal where the server has PROVEN the text is in the
            box"; and it warned that a button submitting an unproven box is the
            hazard this route is gated against. That warning is still exactly
            right, and it is why the gate is NOT widened on `code`: the
            attachment path's `verify-failed` also carries a `draft`, but that
            draft is what a FAILED clear left behind — a FRAGMENT of the
            message. `POST /submit`'s correspondence gate cannot catch it (the
            fragment IS what the box reads, so it matches and Enter submits the
            fragment).

            `submittable` is the server's answer to that objection: it is set
            only where the server has proven the box holds the WHOLE message and
            Enter would send exactly it, and never by the attachment path. An
            older server never sends it, so no button — today's behaviour, the
            safe direction. The `draft` is still required and still non-blank:
            it is the correspondence claim, and the row is blank exactly when
            the message's own first line was blank (`blank-first-row`).
            After Task 402 that no longer comes from `composePrompt` — a human
            typing Enter first, or a pre-402 client, is what produces it now. */}
        {(send.code === 'enter-ignored' || send.code === 'verify-failed')
          && send.submittable === true
          && send.draft !== undefined && send.draft.trim() !== '' && (
          <SendItButton id={id} sendKey={send.key} expect={send.draft} onSent={onDiscard} />
        )}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/send-it.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
cd pwa && npm run build
```

Worth stating rather than discovering: §4.4 raises the rate of red bubbles, and `ChatList` has **no
grouping and no cap** — each failed send is a permanent bubble until dismissed. That is accepted for
this build; it is not a defect introduced here, and it is the honest cost of converting silent
false-successes into visible refusals.

- [ ] **Step 5: Commit**

```
git add pwa/src/lib/api.ts pwa/src/stores/session.ts pwa/src/session/ChatList.tsx pwa/test/send-it.test.tsx pwa/test/chat.test.tsx pwa/test/api.test.ts
git commit -m "feat(pwa): the rescue fires on a PROVEN box, not on a code — and verify-failed stops lying (W4 §4.1)"
```

---

### Task 411: the draft-conflict sheet stops destroying work

The sheet shows `draftOf`'s **single marker row** as though it were the whole draft, and "Append anyway"
builds `` `${conflict.draft}\n${conflict.text}` `` and re-sends with `replaceDraft: true` — which C-u's
the box and retypes only that one row plus the new text, **silently destroying rows 2..N**. Task 405
made the server send every row it will replace; this makes the sheet render them and say how many.

**Files:**
- Modify: `pwa/src/session/Composer.tsx` — the well (`<pre className="well draft-well">{conflict.draft}</pre>`),
  the copy (`<p className="draft-copy">…`), the binding (`setConflict({ key: c.key, text: c.text, draft: c.draft ?? '' });`)
- Modify: `pwa/src/session/chat.css` — `.draft-well`
- Test: `pwa/test/draft-conflict.test.tsx` (create)

**Interfaces:**
- Consumes: the 409 body's `draft`, now every non-blank box row joined by `\n` (Task 405's `boxText`).
- Produces: no new exports. `DraftConflict.draft` is unchanged in type; only its arity of meaning grows,
  and the sheet is what makes that visible.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/draft-conflict.test.tsx`:

```tsx
// VACUUM: nothing in `pwa/test` renders the draft-conflict sheet at all.
//
// The sheet showed ONE row — `draftOf`'s marker row — as though it were the
// whole draft, and "Append anyway" retyped that row plus the new text over a
// cleared box. Every row below the first was destroyed, under a button whose
// label says it is appending to them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../src/session/Composer';
import type { PendingSend } from '../src/stores/session';

afterEach(cleanup);

const TWO_ROWS = 'the human’s real first line\nand a second line';

const conflicted = (draft: string): PendingSend[] => ([{
  key: 'p1', text: 'my message', state: 'failed',
  error: 'draft-present', code: 'draft-present', draft,
}]);

describe('the draft-conflict sheet', () => {
  it('renders EVERY row the box holds, not just the first', async () => {
    render(<Composer id="s" pending={conflicted(TWO_ROWS)} onResolve={vi.fn()} />);
    const well = await screen.findByTestId('draft-well');
    expect(well.textContent).toBe(TWO_ROWS);
  });

  it('says how many rows it is about to replace', async () => {
    render(<Composer id="s" pending={conflicted(TWO_ROWS)} onResolve={vi.fn()} />);
    expect(await screen.findByText(/2 lines/)).toBeInTheDocument();
  });

  it('says "1 line" for a single-row draft — never "1 lines"', async () => {
    render(<Composer id="s" pending={conflicted('just the one')} onResolve={vi.fn()} />);
    expect(await screen.findByText(/1 line\b/)).toBeInTheDocument();
  });

  it('Append anyway carries EVERY row, not the first plus the new text', async () => {
    const onResolve = vi.fn();
    render(<Composer id="s" pending={conflicted(TWO_ROWS)} onResolve={onResolve} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Append anyway' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(
      'p1', `${TWO_ROWS}\nmy message`, { replaceDraft: true },
    ));
  });

  it('Replace draft still sends only the new text', async () => {
    const onResolve = vi.fn();
    render(<Composer id="s" pending={conflicted(TWO_ROWS)} onResolve={onResolve} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Replace draft' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(
      'p1', 'my message', { replaceDraft: true },
    ));
  });
});
```

Adjust the `<Composer …>` props to the component's real signature at the head of `Composer.tsx` — read
it in step 1 and pass exactly what it takes; do not add props to make the test compile.

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/draft-conflict.test.tsx
```

Expected: `Unable to find an element by: [data-testid="draft-well"]` (the well has no test id) and
`Unable to find an element with text: /2 lines/` (nothing counts them).

- [ ] **Step 3: Write minimal implementation**

In `pwa/src/session/Composer.tsx`, inside the sheet:

```tsx
        {conflict && (() => {
          // Every row the server said it is holding — Build 8 made the 409's
          // `draft` the WHOLE box rather than its marker row. The count is not
          // decoration: "Append anyway" and "Replace draft" both act on all of
          // them, and the previous sheet showed one row while destroying N.
          const rows = conflict.draft === '' ? [] : conflict.draft.split('\n');
          return (
            <>
              <p className="draft-copy">
                Someone left {rows.length} {rows.length === 1 ? 'line' : 'lines'} of unsent text in
                the session's input box. Send both together, or replace it with your message.
              </p>
              <pre className="well draft-well" data-testid="draft-well">{conflict.draft}</pre>
              <div className="draft-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => resolveConflict(conflict.text)}
                >
                  Replace draft
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => resolveConflict(`${conflict.draft}\n${conflict.text}`)}
                >
                  Append anyway
                </button>
                <button type="button" className="draft-cancel" onClick={closeConflict}>
                  Cancel
                </button>
              </div>
            </>
          );
        })()}
```

"Append anyway"'s expression is byte-identical to what it was — it is correct **now** only because
`conflict.draft` is the whole box.

In `pwa/src/session/chat.css`, `.draft-well` gains a bound, since it can now hold an arbitrary number of
rows:

```css
/* Build 8: this used to hold ONE row (`draftOf`'s marker row); the 409 now
   carries every row the box holds, and a pasted stack trace is a realistic
   draft. Bounded and scrollable rather than pushing the sheet's own actions
   off the bottom of a phone. */
.draft-well {
  margin-bottom: var(--sp-4);
  max-height: 40vh;
  overflow-y: auto;
}
```

No new colour token, so the contrast gate needs no new measurement.

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/draft-conflict.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts
cd pwa && npm run build
```

- [ ] **Step 5: Commit**

```
git add pwa/src/session/Composer.tsx pwa/src/session/chat.css pwa/test/draft-conflict.test.tsx
git commit -m "fix(pwa): the draft-conflict sheet shows every row it will replace, and says how many (W4 §4.1)"
```

---

### Task 412: the session mail strip names a blocked delivery

Today `MailStrip` renders exactly **one** distinct status row — `.mail-strip-abandoned`, keyed on
`item.state === 'rejected'`, text *"undeliverable — act on it directly"* — and **nothing in `pwa/src`
reads `lastError` at all** (grepped at `d7137c2`: zero hits). This is an extension of a shipped shape,
not a new variant: `.mail-strip-abandoned` and `.mail-strip-artifacts` are both `flex-basis: 100%` spans
inside the same `<li>`, and this is a third of the same kind — one class, one existing token
(`--status-attention-text`, already measured by the contrast gate), **not** a new `<li>`.

**The copy is written for the reader who is actually looking at it.** The spec's *"blocked — the
recipient's input box has unsent text"* is written from the sender's viewpoint, but this strip renders
mail addressed **to** the session whose screen you are on. The recipient *is* this session, and its
Composer is twenty pixels below.

**Files:**
- Modify: `pwa/src/session/MailStrip.tsx` — the `<li>`'s children, between `.mail-strip-subject` and
  the `item.state === 'rejected'` arm; and the collapsed head
- Modify: `pwa/src/session/chat.css` — after `.mail-strip .mail-strip-abandoned`
- Test: `pwa/test/mail-strip.test.tsx`, `pwa/test/mail-screen.test.tsx`

**Interfaces:**
- Consumes: `MailSummary.attempts`, `MailSummary.lastError`, `MAIL_MAX_ATTEMPTS` (Task 408).
- Produces: CSS class `.mail-strip-blocked`.

- [ ] **Step 1: Write the failing test**

Add to `pwa/test/mail-strip.test.tsx`:

```tsx
describe('a blocked delivery is named before it is lost', () => {
  const blocked = (over: Partial<MailSummary> = {}) =>
    m({ state: 'queued', attempts: 3, lastError: 'draft-present', ...over });

  it('names the block, the attempt and the CEILING', () => {
    render(<MailStrip mail={[blocked()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(
      "blocked · attempt 3 of 6 — this session's input box has unsent text",
    )).toBeInTheDocument();
  });

  it('is a span inside the EXISTING row, not a second row', () => {
    const { container } = render(<MailStrip mail={[blocked()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelectorAll('li.mail-strip-row')).toHaveLength(1);
    expect(container.querySelector('li.mail-strip-row .mail-strip-blocked')).not.toBeNull();
  });

  it('never renders alongside the abandoned line — one status line per row', () => {
    const { container } = render(<MailStrip mail={[blocked({ state: 'rejected' })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-abandoned')).not.toBeNull();
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  it('renders nothing for a queued delivery that is merely waiting', () => {
    const { container } = render(<MailStrip mail={[m({ state: 'queued', attempts: 0, lastError: null })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  it('reads lastError as a RAW string — an unrecognised value renders nothing, never a crash', () => {
    const { container } = render(<MailStrip mail={[blocked({ lastError: 'some-future-server-word' })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  // THE STRIP OPENS CLOSED. Without this the whole feature is invisible in its
  // default state, which is the state it is in whenever the operator has not
  // already gone looking.
  it('the COLLAPSED head carries the flag', () => {
    const { container } = render(<MailStrip mail={[blocked()]} />);
    expect(container.querySelector('.mail-strip-head .mail-strip-blocked-mark')).not.toBeNull();
  });
});
```

Add to `pwa/test/mail-screen.test.tsx`:

```tsx
  // The SENDER-side and park signals land in the FEED, not the strip, because
  // the strip is recipient-side. They reuse the existing `mail` kind on
  // purpose: KIND_WORD and KIND_GLYPH are TOTAL maps, so a seventh kind means
  // touching both plus NOTIFY_KINDS and every older client renders `undefined`.
  it('renders a blocked-mail record with the ordinary mail glyph and word', () => {
    renderFeed([{ kind: 'mail', sessionId: 'boss', title: '✉ blocked › w1',
      body: 'wave-brief: the recipient’s input box has unsent text in it',
      epoch: 'e', seq: 1, at: Date.now() }]);   // this file's existing fixture shape
    expect(screen.getByText(/blocked › w1/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
cd pwa && ./node_modules/.bin/vitest run test/mail-strip.test.tsx
```

Expected: `Unable to find an element with the text: blocked · attempt 3 of 6 — this session's input box
has unsent text`.

- [ ] **Step 3: Write minimal implementation**

`pwa/src/session/MailStrip.tsx`:

```tsx
import { MAIL_MAX_ATTEMPTS } from '../../../shared/api';
```

```tsx
/**
 * A delivery the lane is actively failing to hand over because the box already
 * holds something. RAW `lastError`, branched on the ONE literal token the
 * server writes for this case — never a total `Record` lookup, which is a
 * fresh way for a new server value to break an old client, and never a display
 * of the raw string, which is free text (four writers, one of them an English
 * sentence).
 */
const isBlocked = (item: MailSummary): boolean =>
  item.state === 'queued' && item.lastError === 'draft-present';

/** "attempt 3 of 6" — the ceiling comes from L0, not from a `6` typed here.
 *  Naming the ceiling is what makes "visible BEFORE it is lost" true: without
 *  it the operator cannot tell a first hiccup from the last attempt. */
const blockedLine = (item: MailSummary): string =>
  `blocked · attempt ${item.attempts} of ${MAIL_MAX_ATTEMPTS} — this session's input box has unsent text`;
```

In the head, after `.mail-strip-count`:

```tsx
        {mail.some(isBlocked) && (
          <span className="mail-strip-blocked-mark" title="A message can't be delivered — the input box below has unsent text.">
            blocked
          </span>
        )}
```

In the `<li>`, replacing the existing `item.state === 'rejected' && (…)` block with an explicit ternary
so two status lines can never render on one row:

```tsx
              {/* ONE status line per row, written as a ternary rather than two
                  independent guards: a rejected delivery is terminal and says
                  so, a queued-but-blocked one is still being retried and says
                  how much room is left. Rendering both would state two
                  different fates for one message. */}
              {item.state === 'rejected' ? (
                <span className="mail-strip-abandoned" title="The delivery lane gave up retrying this before it was acked.">
                  undeliverable — act on it directly
                </span>
              ) : isBlocked(item) ? (
                <span className="mail-strip-blocked" title="The lane is still retrying. Clear the input box below and it will land.">
                  {blockedLine(item)}
                </span>
              ) : null}
```

`pwa/src/session/chat.css`, after `.mail-strip .mail-strip-abandoned`:

```css
/* Build 8 §4.5: a delivery the lane is still retrying but cannot hand over,
   because THIS session's own input box holds unsent text. Same shape as
   `.mail-strip-abandoned` above — a `flex-basis: 100%` span inside the same
   `<li>`, never a second row — and the same already-measured token, so the
   contrast gate needs nothing new. Scoped `.mail-strip .foo` like every other
   descendant here, so `design/audit.mjs` measures it through route 2b rather
   than stranding it in the uncovered census. */
.mail-strip .mail-strip-blocked {
  flex-basis: 100%;
  font: var(--weight-medium) var(--text-2xs) / 1 var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--status-attention-text);
}
.mail-strip .mail-strip-blocked-mark {
  flex: none;
  font: var(--weight-medium) var(--text-2xs) / 1 var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--status-attention-text);
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd pwa && ./node_modules/.bin/vitest run test/mail-strip.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts
cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx
cd pwa && npm run build
```

Worth writing down rather than discovering: `MailBadge` counts unseen feed events, so a blocked-mail
record now bumps the fleet screen's badge. That is correct — a wave brief that cannot land is exactly
what the badge is for.

- [ ] **Step 5: Commit**

```
git add pwa/src/session/MailStrip.tsx pwa/src/session/chat.css pwa/test/mail-strip.test.tsx pwa/test/mail-screen.test.tsx
git commit -m "feat(pwa): the mail strip names a blocked delivery, with its attempt and its ceiling (W4 §4.5)"
```

---

### Task 413: the coordinator skill gains a SENDER-side mail procedure

**AGENT-FIRST** — this ships to the fleet host before the server lane.

`server/test/coordinator-skill.test.ts` iterates `MAIL_REJECT_CODES` and requires each to appear in
`allSkillText`; W4 adds no code, so nothing goes red here on its own. The gap is different and narrower
than an earlier draft claimed: the reference corpus is **not** silent about blocked mail — measured,
`undeliverable` ×3 and `rejected` ×4 across `mail-envelope.md` and `wave-lifecycle.md` — but **every one
of those passages is recipient-side**: what becomes of mail addressed to *you*. There is no sender-side
procedure anywhere, and the sender is who Wave 4 makes whole. Write to that, not to the false premise
that nothing exists.

**Three assertions in that suite bind and are easy to trip:**
- The **destructive-verb census**: `ws-reap`/`ws-rm`/`ws-gc` may appear only as many times as clause 3
  names them, across SKILL.md **and both references**. No new sentence may mention any of the three —
  **not even to forbid them again.**
- The **route-completeness scan**, scoped to `server/src/coord/routes.ts`. This task registers no route.
- The nine **pinned clauses** in SKILL.md. Every change here is **additive text in a reference page**;
  no pinned clause is edited.

**Files:**
- Modify: `ccd/coordinator-skill/references/mail-envelope.md` — a new section at the end
- Test: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: `MailSummary.attempts`, `MailSummary.lastError` (Task 408); the notification lane (Task 409).
- Produces: no code. A documented procedure for a sender whose message is blocked or parked.

- [ ] **Step 1: Write the failing test**

Add to `server/test/coordinator-skill.test.ts`:

```ts
describe('the skill tells a SENDER what a blocked delivery obliges them to do', () => {
  // Measured at the frozen ref: the corpus already carries six passages about
  // undeliverable/rejected mail — and every one of them is RECIPIENT-side
  // ("what to do about mail addressed to you"). The sender, whose wave brief
  // is the thing that cannot land, is told nothing. Build 8 makes the block
  // visible on the wire and in the tray; this is the procedure that goes with
  // it.
  it('names what lastError === draft-present means for the sender', () => {
    expect(allSkillText).toContain('draft-present');
    expect(allSkillText).toMatch(/input box/i);
  });

  it('names the attempt ceiling, so a first block reads differently from the last', () => {
    expect(allSkillText).toMatch(/attempts?[^.]*\b6\b|\b6\b[^.]*attempts?/);
  });

  it('says a briefQueued dispatch is NOT a delivered brief', () => {
    expect(allSkillText).toContain('briefQueued');
    expect(allSkillText).toContain('clearError');
  });

  // NO CENSUS ASSERTION HERE, and the reason is worth recording so it is not
  // re-added: this file ALREADY pins it exactly —
  //   `expect(hits).toBe(CONTRACT[2].split(verb).length - 1)`
  // — and `CONTRACT[2]` names each of ws-reap/ws-rm/ws-gc exactly ONCE. A
  // `toBeLessThanOrEqual(2)` beside it would PASS with an extra mention, i.e. a
  // guard that cannot red for the thing it claims to guard, which is the
  // mutation-table discipline this branch enforces everywhere else. The
  // constraint binds Step 3's prose; the MECHANISM is the shipped test, and
  // Step 4 runs the whole file.
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'the skill tells a SENDER'
```

Expected: `expected '…' to contain 'draft-present'` and `expected '…' to contain 'briefQueued'`.

- [ ] **Step 3: Write minimal implementation**

Append to `ccd/coordinator-skill/references/mail-envelope.md`:

```markdown
## When YOUR message is the one that cannot land

Everything above is about mail addressed to you. This section is the other
direction: you sent something and the lane cannot hand it over.

`GET /api/mail` rows now carry two fields that used to exist only in the
database:

- `attempts` — how many send attempts this **delivery** has made.
- `lastError` — how the last attempt failed. **Raw text.** Match the one value
  below; do not build a table off it.

### `lastError: "draft-present"` — the recipient's input box is occupied

The worker has unsent text sitting in its Claude Code input box, so the lane
refuses to type over it. It backs off and retries; it does **not** give up
immediately. You will see `attempts` climb on every tick.

The budget is **6 attempts** for a delivery that has never been delivered. At
the sixth the lane parks the delivery `state: "rejected"` and stops. That is
deliberate — a message that can never land should not retry for the life of the
box — but a park means your brief was never read.

What to do, in order:

1. **Look at the worker's own screen** in the PWA. Its mail strip names the
   block, with the attempt and the ceiling, and its composer is right below the
   strip. The box is what has to change; nothing you can do to the mail row
   fixes it.
2. **If the text in the box is the worker's own half-typed message**, it is
   theirs. Ask them to send or discard it. Do not replace it.
3. **If the box holds a stranded `/clear`** the lane will now clear it itself on
   the next attempt — that shape is machine debris this system left behind, and
   it is recognised.
4. **If the delivery has already parked**, requeue the message with
   `POST /api/mail` once the box is clear. The park is terminal for that
   delivery; the mail row itself is untouched, and the content of what you said
   is not lost.

You do not have to poll for any of this. The first block and the park each
raise one notification addressed to **you**, the sender.

### A queued brief is not a delivered brief

`POST /api/runs/:id/dispatch` answers with `briefQueued` and `clearError`.

- `briefQueued: false` means **no brief was queued at all.** It is computed as
  `!resumed || clearedAt !== null`, so on a **resumed** wave whose `/clear` was
  refused, the brief is never queued — by design, because a brief landing in an
  un-cleared context is worse than no brief. `clearError` names the refusal.
- `briefQueued: true` means the brief is **in the delivery lane**, not that the
  worker has it. It still has to survive the recipient's input box. Treat a
  wave as briefed only when the worker acks the mail.

A wave that has gone quiet after a dispatch that answered `ok` is very often
this: the brief is queued, the box is occupied, and the worker has been sitting
with nothing to do. Read `attempts`/`lastError` on the delivery before assuming
the worker is stuck on the work.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
cd server && ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts
```

- [ ] **Step 5: Commit**

`ccd/ccd` is not touched here, so no provenance re-stamp is due:

```
git add ccd/coordinator-skill/references/mail-envelope.md server/test/coordinator-skill.test.ts
git commit -m "docs(skill): a sender-side procedure for a blocked or parked delivery, and what briefQueued does not mean (W4 §4.5)"
```

---

### Wave 4 — definition of done

Run each of these in the FOREGROUND, from inside its package, with a timeout of at least 600000 ms:

```
cd server && ./node_modules/.bin/vitest run test/send.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-pane-box-draft.test.ts
cd server && npm run test
cd agent  && npm run test
cd pwa    && npm run test
cd pwa    && npm run build
```

- **`cd pwa && npm run build` is a gate, not a formality.** `pwa/test` is type-checked by nothing in
  `cd pwa && npm run test`, so Task 408's `MailSummary` widening leaves the PWA suite green and breaks
  the build.
- **Gate 1:** `ownership.test.ts` green means `ccd/ccd`'s provenance marker was re-stamped in the same
  commit that edited it (Task 401).
- **Gate 2 does not apply to this wave.** No task here stubs or renames `_spawn`.
- **Known load flakes** (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`) — re-run in
  isolation before calling a real break.
- **No `git push`, no `gh`.** Branch, commit, stop.

**Deploy lane, when the branch merges:** `ccd` first (Tasks 401, 413 — `bash deploy/deploy.sh agent <host>`,
**the host argument is not optional**, `deploy.sh` defaults `$BOX` to the SERVER box), then the server
(`bash deploy/deploy.sh`). `shared/api.ts` compiles into both lanes. No agent restart is required for
Wave 4: nothing here touches `agent/`.

### What Wave 4 deliberately does NOT do

- **No auto-clear of a blank-marker wedge.** The operator's ruling is refuse-only. §4.1 hands the text
  back and the PWA rescue makes recovery one tap; a system that clears an operator's rows under a
  button labelled something else is the defect Task 411 exists to close, and building a second one here
  would be perverse.
- **No unified box-writer serialiser (Q21).** The server's `KeyedQueue` is an in-process map and ccd's
  injectors run on a 5 s supervise tick on the other box, across a boundary the server deliberately
  never crosses at runtime. A correct guard on an idle-and-quiet pane closes the realistic window; a
  cross-box lock is a much larger design and nothing measured justifies it.
- **F7 is left open, and §4.4 makes it worse.** Echo-verify is documented as flaky on a large multi-line
  paste; the box-scoped check will refuse MORE OFTEN on exactly that payload shape, leaving a mangled
  partial in the box, which `sweepMail` then bounces off as `draft-present`. Task 412 makes that
  **visible**; nothing in this build reduces it.
- **No new `NotifyEvent['kind']`.** `KIND_WORD`/`KIND_GLYPH` are total maps and an older client would
  render `undefined`.
- **`FLEET_PROTO` stays 1.** Every wire change here is additive and absence-permitting.

### Task 16: the `die`-inside-`$( )` class gets a sweep and a mechanical guard (D-298 (was D-B8-2))

**This task exists because of D-297, and it is the difference between fixing an instance and closing a
class.** `die` is `echo …; exit 1`. Inside a command substitution, `exit` kills only the subshell — so
**every** `x=$(_helper …)` where `_helper` can reach `die` silently demotes a fatal error to a value the
caller probably does not check. D-297 was one instance, found by review. Nothing prevents the next one.

The shape is mechanically greppable, which is what makes a guard possible rather than a request.

**Files:**
- Create: `server/test/ccd-die-containment.test.ts`
- Modify: `ccd/ccd` — only where the sweep finds a real demotion
- Modify: `server/test/ccdWsHelpers.ts` — move `shStatus` here from `ccd-spawn-split.test.ts` if a
  second file needs it (do NOT copy it; `single-definition.test.ts` will notice the second copy)

**Interfaces:**
- Consumes: `shStatus` (measures the exit status of a whole `bash -c`, unwrapped), `makeCcdHarness`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Enumerate the population, and write it down**

Run, at the branch tip:

```bash
cd <worktree>
# every command substitution that calls an underscore-prefixed ccd helper
grep -nE '\$\(\s*_[a-z_]+' ccd/ccd | tee /tmp/cs-sites.txt | wc -l
# every function that can reach `die` directly
grep -nE '^\s*(die|_die)\b' ccd/ccd | wc -l
```

For each site, determine whether the called helper can reach `die` on any path. **Record the full
list in the task's commit message** — including the sites you cleared and why, because a sweep whose
negative results are unrecorded gets re-run from scratch next time.

- [ ] **Step 2: Write the failing guard**

The guard is a text scan, in the idiom `single-definition.test.ts` already uses. It asserts that the
set of `$(_helper …)` sites where `_helper` can `die` is **exactly the allow-list** — empty if the
sweep fixed them all. A new demotion added later is a new set member, and the suite goes red naming it.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

/** Helpers that can reach `die` on some path — derived in Step 1, listed once here.
 *  A command substitution around ANY of these demotes a process-fatal error to a
 *  return code the caller almost certainly does not check (D-297). */
const CAN_DIE = [
  // filled from Step 1's sweep, e.g. '_spawn_start', '_id', …
];

describe('die is never demoted by a command substitution', () => {
  it('no $( ) wraps a helper that can die', () => {
    const src = readFileSync(CCD, 'utf8').split('\n');
    const offenders: string[] = [];
    src.forEach((line, i) => {
      for (const fn of CAN_DIE) {
        // `$(fn` with optional whitespace — the shape that swallows `exit`
        if (new RegExp(`\\$\\(\\s*${fn}\\b`).test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
      }
    });
    expect(offenders,
      'a `die` inside $( ) kills only the subshell, so a fatal error becomes a return code — ' +
      'and rc 1 is in no ccd caller\'s failure set. See D-297.')
      .toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
cd <worktree>/server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts
```

Expected: FAIL, listing each demoting site the sweep found. **If it passes on the first run, the
`CAN_DIE` list is wrong — go back to Step 1**, because D-297 proves at least one such shape existed.
(If Task 3's fix genuinely removed the only one, prove that by reverting `9ca06ae` in the working
tree, watching this test go red, and restoring — then say so in the commit message.)

- [ ] **Step 4: Fix each site the same way D-297 was fixed**

Prefer the structural fix: **return the value through a documented global and drop the substitution**,
so the hazard is unrepresentable. Patching each call site with `|| exit $?` is a rule every future
caller must remember, which is what this task exists to eliminate. Where a substitution genuinely must
stay, hoist the `die`-able validation out of the helper and above the substitution.

- [ ] **Step 5: Run the guard and the full ccd surface**

```bash
cd <worktree>/server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts
cd <worktree>/server && ./node_modules/.bin/vitest run test/ccd-spawn-split.test.ts test/ccd-workspaces.test.ts test/ccd-archive.test.ts test/ccd-supervised-start.test.ts test/ccd-start-id.test.ts test/ccd-swap.test.ts test/ownership.test.ts
```

Expected: all green.

- [ ] **Step 6: Mutation-prove the guard**

Reintroduce one demotion (e.g. wrap a cleared call in `$( )`), run the guard, confirm RED naming that
line, then restore. Verify `git status` is clean. Record before/after counts.

- [ ] **Step 7: Re-stamp and commit**

```bash
cd <worktree> && node <scratchpad>/restamp.mjs   # must print -> ccrc-unmodified
git add ccd/ccd server/test/ccd-die-containment.test.ts server/test/ccdWsHelpers.ts
git -c user.name="Mykyta Fastovets" -c user.email="you@example.com" commit
```

---

## Deviations found

Numbered `D-B8-N`, global and monotonic across project history (Build 4 ended at `D-296 (was D-B4-23)`). Source
files carry `D-B8-N` refs in comments; **read them as authoritative history and do not delete them.**

**D-297 — the `_spawn` split demoted a process-fatal error to a success line.** Task 3 gave
`_spawn_start` an stdout channel for `fromswap`, so the composition called it as
`fs=$(_spawn_start "$1" "$2")`. `_spawn_start` retains `die "incomplete registry for '$id'"`, and
`exit 1` inside `$( )` kills only the subshell — so the fatal became `return 1`, which is in no
caller's failure set (`cmd_ws_add`, `cmd_start`, `cmd_ensure` all test
`[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`). Measured through the real harness: at `d7137c2` the shell exits
1 and dies; at `ad6396d` it exits **0**, prints `SPAWN_RC=1`, and continues to the success line.
Reachable with a `.uuid` present but `.wrapper`/`.workdir` missing — the torn-registry family Wave 1
exists to close.

*Fixed in `9ca06ae`* by removing the stdout channel entirely: `_spawn_start` sets the global
`SPAWN_FROMSWAP` (file-scope initialised, so `set -u` cannot kill a reader whose `_spawn_start` never
ran; reset to `0` on entry, so no caller reads a previous spawn's answer). The call-site patch
(`|| exit $?`) was **rejected** — Tasks 7 and 8 add ~6 more call sites, and a rule every caller must
remember is the shape this build removes. With no substitution, `die` is fatal by construction.

Two lessons recorded rather than summarised. First: the one test that claimed to pin this guard ran
`(_spawn_start nosuchid new)` inside an explicit subshell and grepped stdout — it passed whether the
guard was fatal or not, and was structurally incapable of catching the defect. A test that cannot
fail for the reason it names is worse than no test, because it is counted as coverage. Second: the
demotion happens at the **call site**, not in the function — so a test that calls `_spawn_start`
plainly can never see it. The pin has to measure the composition.

**D-298 — the class behind D-297 is unswept.** `die` inside `$( )` is silently non-fatal
*everywhere* in `ccd/ccd`, not only at the one site review happened to catch. Task 16 sweeps the
population and lands a text-scan guard so a new demotion is a red suite rather than a future
incident. Recorded as a deviation because the plan as written closed an instance and left the class
open — which is the exact failure this build's own goal statement names.

### Task 17: the arithmetic-injection class gets swept and guarded (D-299)

**D-297 and D-299 are the same lesson twice: an instance was fixed and the class was left open.** This
task closes the arithmetic one. It is deliberately scoped to *normalise a known population and pin it*,
not to audit the file.

**The class, stated once so nobody re-derives it:** bash evaluates a variable's **contents** as an
arithmetic expression, and a command substitution inside an array subscript **executes**. So
`x='REG[$(cmd)]'` runs `cmd` in every arithmetic context. Verified in a temp dir:

```
[[ -z "$last"         && $((now-last)) -lt 5 ]]   -> no execution   (&& short-circuits)
[[ -n "$last"         && $((now-last)) -lt 5 ]]   -> EXECUTED
[[ "$pct" -ge 5 ]]                                -> EXECUTED
[[ "$bts" =~ ^[0-9]+$ && $((now-bts))  -lt 5 ]]   -> no execution   (the guard works)
```

**Two consequences that are easy to get wrong.** Arithmetic contexts are not only `(( ))` and `$(( ))`
— **`[[ x -eq|-ne|-lt|-le|-gt|-ge y ]]` and array subscripts are too.** And a `-n` test is **not** a
guard; only a `=~ ^[0-9]+$` placed **first inside the same `[[ ]]`** is, because that is what makes
`&&` short-circuit before the arithmetic operand is evaluated.

**Files:**
- Modify: `ccd/ccd` — the five sites listed below, and nothing else
- Create: `server/test/ccd-arith-containment.test.ts`

**Interfaces:**
- Consumes: `makeCcdHarness`. Produces: nothing other tasks consume.

**The population, already swept — do not re-derive it, verify it.** ~150 `(( ))` hits exist; almost all
take loop counters, `$?`, `${#array[@]}` or `$(date +%s)` and are trusted by construction. These are the
ones whose operands come from outside the expression:

| site | operand | source | status |
|---|---|---|---|
| `_auto_swap_check` (`~7181`) | `lastswap` | registry file | **unguarded — hottest loop in the file, runs every 5 s per supervised session** |
| `_auto_compact_check` (`~7262`) | `lastcompact` | registry file | **unguarded** |
| `_auto_compact_check` (`~7264`) | `lastswap` | registry file | **unguarded** |
| `_spawn_start` (`~7499`) | `lastswap` | registry file | **unguarded** |
| `_dispatch_swap` (`~6963`) | `SWAP_JITTER` | environment | **unguarded** (env is agent-set, not wire-set) |

**None of these is wire-reachable** — those fields are written only by ccd's own `_reg_set` from
`$(date +%s)`, and no whitelisted verb puts caller-supplied text into them. Exploiting one already
requires being the fleet UNIX user with write access to `~/.cc-sessions`. **Say that plainly in the
commit message**: this task is defence in depth and torn-file robustness, not a live-vulnerability fix.
The one live wire-reachable instance was `cmd_ensure`'s positional, closed in `73bc0fe`.

**Copy the shape that already exists in this file** — `ccd:7660` (`spawn`) is the best example, with
`ccd:419` (`supervised`) and `ccd:7189` (`swapblocked`) close behind. Do not invent a new idiom.

- [ ] **Step 1: Write the failing test**

For each of the five sites, a case in a fixture HOME that plants a payload in the source the site
reads (registry field, or the env var) and asserts **no side effect occurred**. Example shape:

```ts
it('_auto_swap_check does not evaluate a payload planted in lastswap', () => {
  const h = makeCcdHarness('arith-swap');
  // A torn or hand-edited registry field is the threat model — not a wire caller.
  h.sh(`printf '%s' 'REG[$(touch "$HOME/PWNED")]' > "$HOME/.cc-sessions/myid.lastswap"`);
  h.sh(`${TMUX} _auto_swap_check myid || :`);
  expect(existsSync(path.join(h.home, 'PWNED'))).toBe(false);
  h.cleanup();
});
```

Plus one structural case asserting every site in the table carries a `=~ ^[0-9]` guard **before** its
arithmetic, so a future edit that drops the guard is red even if no payload test covers that path.

- [ ] **Step 2: Run and confirm each fails**

```bash
cd <worktree>/server && ./node_modules/.bin/vitest run test/ccd-arith-containment.test.ts
```

Expected: the payload cases FAIL (the file appears). **Report the exact failures.** If a case passes,
that site was already guarded — remove it from the table rather than "fixing" it, and say so.

- [ ] **Step 3: Normalise all five sites**

Guard first, inside the same `[[ ]]`, degrading to the safe default — never to zero, never to "no
bound". For `SWAP_JITTER`, degrade to `0` (no jitter), which is the documented pre-jitter behaviour.

- [ ] **Step 4: Run the containment suite plus the loops these sites live on**

```bash
cd <worktree>/server && ./node_modules/.bin/vitest run test/ccd-arith-containment.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-swap-carry.test.ts test/ccd-spawn-split.test.ts test/ccd-supervised-start.test.ts test/ownership.test.ts
```

- [ ] **Step 5: Mutation-prove**

Remove one guard, confirm its payload case goes RED, restore. Then remove a *different* guard and
confirm the structural case goes red. Report before/after counts; verify `git status` is clean.

- [ ] **Step 6: Re-stamp and commit**

```bash
cd <worktree> && node <scratchpad>/restamp.mjs   # must print -> ccrc-unmodified
git add ccd/ccd server/test/ccd-arith-containment.test.ts
git -c user.name="Mykyta Fastovets" -c user.email="you@example.com" commit
```

- [ ] **Step 8: pin `_spawn_start`'s failure mode, because the split installed a door (D-300 (was D-B8-4))**

Tasks 7/8 made every caller `_spawn_start "$id" <mode> || return $?`. That early return **skips
`_reg_claim`** — and, at `cmd_ws_add`/`cmd_ws_restore`, `_ws_supervise` too — which the pre-split
straight line always reached.

**This is unobservable today**, and the reason is precise: `_spawn_start` has no `return` of its own.
Every failure inside it is a `die` (process-fatal), and it ends on an assignment, so `|| return $?` is
currently unreachable in production. **The day someone adds a non-zero `return` to `_spawn_start`,
`cmd_ws_add` leaves a live pane that no row claims and no unit watches — F8's exact shape, re-entering
through the door the split installed.**

A comment asking the next editor to remember is not a mechanism. Add a structural test asserting
`_spawn_start`'s only failure mode is `die` — e.g. scan its deparsed body (`type _spawn_start`) for a
bare `return` with a non-zero operand and require none. Its failure message must say what to do:
*"`_spawn_start` grew a `return`; every `|| return $?` caller now skips `_reg_claim` — give those
callers a claim on the failure path before landing this."*

Mutation-prove it: add `return 9` to `_spawn_start`, confirm RED, restore.

- [ ] **Step 7: Record the one site this task does NOT change, and why**

`_auto_compact_check` compares `pct` — derived from **pane text** — with `-ge`. Pane text is genuinely
attacker-influenced (a session can print anything). It is safe **only** because `_pane_ctx_pct` ends in
`grep -oE '[0-9]+'`. That is a single point of failure with no test naming it. Add a test asserting
`_pane_ctx_pct` returns digits-only for a pane containing a payload, with a comment saying the
arithmetic downstream depends on it. **Do not** add a second guard at the arithmetic site — one
authoritative sanitiser is the right shape; an unnamed dependency on it is not.

---

**D-299 — Task 5 turned a whitelisted verb's argv into arbitrary code execution.** Threading the
settle bound as a second positional on `cmd_ensure` put an unvalidated caller string into
`(( $(date +%s) - t0 >= bound ))`. `agent/src/whitelist.ts` grants `['ensure']` and its own docstring
states that *"tokens after the prefix are unconstrained"*, so `ccd ensure <id> 'REG[$(cmd)]'` executed
`cmd` as the fleet user across the agent's exec boundary. Proven in a fixture HOME: the payload's
`touch` ran, then the arithmetic errored — the error is a red herring, the code had already run.

Not exploitable from the PWA at the time (no server call site emitted a second token), so this was a
latent primitive plus a defence-in-depth regression rather than a live incident. But the exec whitelist
is the **single** boundary the PWA→agent path rests on, and its contract is that any granted argv is
safe to hand a shell. This quietly made that false.

*Fixed in `73bc0fe`* by deleting the argv surface rather than validating it: the bound travels in a
dynamically-scoped `local CCD_SETTLE_BOUND`, mirroring `CCD_IN_UNIT`, which `cmd_supervise` already
uses to signal `cmd_ensure`. `cmd_ensure` is back to one positional and carries a comment naming the
whitelist as the reason. One reader, validated at the read, degrading to the production default.

**Three things worth keeping from how this was found.** The implementer *disclosed* the widened argv
surface in its own hand-off notes and asked that a later task decide about it — it judged the risk as
"grants no new capability", which was wrong, but the disclosure is what made a one-pass review
sufficient. Second: rc 5's propagation was simultaneously unpinned, so deleting `|| "$rc" -eq 5` left
the suite green while `cmd_start` printed its success line over a session sitting behind a limit
banner — a guard and its test must land together, which is this repo's own doctrine. Third: the plan's
own regex for "the bound is not keyed off `fromswap`" was **unsatisfiable** against correct code, because
bash's `type` deparse renders the whole `local` list on one line. A test that cannot pass for the right
reason is as bad as one that cannot fail for the wrong one.

**D-300 — the split installed a door that re-opens F8, and it is currently unreachable.** Tasks 7/8
made every caller `_spawn_start "$id" <mode> || return $?`. That early return skips `_reg_claim` (and
`_ws_supervise` where the verb has one) — the very writes Wave 1 exists to move earlier. It is
unobservable only because `_spawn_start` has no `return` of its own: every failure is a `die`, and the
function ends on an assignment. Add one non-zero `return` and `cmd_ws_add` leaves a live pane no row
claims and no unit watches.

Found by the early-return cleanup audit that followed the `cmd_ws_restore` fd leak, and correctly
judged "needs no change now" — but "no change now" plus a comment is how the next incident gets
written. Task 17 Step 8 pins it, so the day the door opens is a red suite naming the callers that need
a claim on their failure path.

*Also fixed in the same pass:* `cmd_ws_restore`'s new early `return` skipped `exec {lfd}>&-`, leaking
the ws-reap flock fd. The block's own comment asserted the opposite invariant — *"`die` exits, and the
kernel closes what exits"* — true of `die`, false of `return`. Because ccd is SOURCED and `flock`
treats two `open()`s of one file in a process as strangers, that is a lock nothing releases. The fix
routes both outcomes through a single close and the comment now states the real rule. The leak is
observable only from the sourcing shell, which is also the production shape — a fresh-bash probe would
have shown it free, so the test asks the same shell.

**D-301 (was D-B8-5) — four guards were decorated, not pinned, and one hid a standing false positive.** Review
mutation-proved each: deleting `readWorktreeRecords`'s path-escape guard left the suite green; the
"`_spawn_start` still dies" test wrapped the call in `( )`, so it passed whether the guard was fatal or
not; the achromatic CSS override was, verbatim, "a comment, not a mechanism"; and `divergence.test.ts`'s
"finds a FLAT worktree" case passed `name: 'alertwire'` — **a fixture choice, not a measurement of git.**

That last one hid a real defect. Measured on the live box, `custom-tools` runs BOTH worktree layouts,
and git's admin name for the flat one is `custom-tools-alertwire`, so `${project}-${name}` derived
`custom-tools-custom-tools-alertwire` — an id no registry row can ever match, reported every sweep,
forever, on the divergence kind whose repair deletes worktrees.

The fix is a measurement, not a heuristic: the ccd id comes from the checkout path read out of the
admin record's `gitdir`, settling the layout on the parent segment first — because
`~/worktrees/demo/demo-fix` and `~/worktrees/demo-fix` are different workspaces git records under the
same admin name, and a `startsWith` test cannot tell them apart.

**The preventive mechanism is the part to keep:** `plantWorktreeRecord` now throws unless
`name === basename(at)` — git's own invariant, asserted on the fixture. The wrong fixture that hid this
defect is no longer writable. That is the shape to copy the next time a test encodes an assumption
instead of measuring one: make the bad fixture impossible rather than adding another case.

**D-302 (was D-B8-6) — the census sweep re-opened the race it had just closed, through ordering.** `registryNames`
was snapshotted at the top of the tick while `readWorktreeRecords` ran three awaited lanes later, so a
workspace whose `_reg_set` landed between the two reads had a worktree record and no registry name —
the mid-`ws-add` false positive fixed two commits earlier, arriving by ordering rather than by
predicate. The 60-second debounce does not cover it: the skew repeats every sweep while the write keeps
landing in the window, so both sightings agree and the finding publishes.

`sweepDivergences` now takes its own listing after the worktree loop, and an unlistable registry fails
shut — a listing read as `[]` would otherwise claim that nothing claims anything, fleet-wide, on the
kind whose repair deletes worktrees.

**Two related notes worth carrying.** ccd's `_ws_gc_row` tests `orphan` FIRST, so residue with no
`.uuid` reads `orphan` there and *claimed* by the census — the census is the narrower of the two, which
is the safe direction. And `.uuid` is the **fourth** field `cmd_ws_add` writes, which is why adopting
ws-gc's `.uuid`-alone test would have re-opened the very false alarm this entry records.

**D-303 (was D-B8-7) — §1.7's substrate placement was a no-op, and the reboot is what proved it.** The design ran
`systemd-run --user --scope --collect --unit=ccrc-tmux-server tmux start-server` as its own step ahead
of `_spawn_start`'s `new-session`. **A tmux server with no sessions exits immediately**, so the server
that scope started died at once, the scope collected, and the very next `tmux new-session` created a
fresh server in the caller's cgroup — the exact flaw the section existed to remove.

Measured on the fleet host 2026-08-18 after the planned reboot: the server (pid 2047, 21:38:58, all 17
sessions) sat in `claude-session@ccrc-pwa-calm-mesa.service`, one session unit over from the
`claude-session@claude-ccrc-pwa.service` it began in, with `ccrc-tmux-server.scope` absent from
`systemctl --user list-units --all`. The journal line `Started ccrc-tmux-server.scope` at 21:38:59 is
genuine, and is the reason this read as a success on first inspection.

Settled by experiment on an isolated socket (`-L probe`), zero contact with the live fleet: a scope
around `start-server` leaves no server; a scope around `new-session -d` leaves the server **in the
scope**. The first session is the server's lifeline, so the scope must wrap the call that creates it —
the scope outlives the short-lived `new-session` process because a scope is released when its cgroup
*empties*, and the forked server stays in it.

*Fixed* by replacing `_tmux_server_ensure` with `_tmux_new_session`, an argv wrapper around
`tmux new-session` that prepends the scope only when no server is running and `systemd-run` exists;
both `_spawn_start` call sites route through it. A failed scoped attempt falls through to a bare call
(a missing session is worse than a misplaced one — the trade the old `||` made); with no scope
attempted the bare call runs exactly **once**, because retrying a `new-session` that failed on its own
merits hits a duplicate name and turns one failure into a confusing two.

**Three things worth keeping.** First, the old suite was green throughout, and deserved to be: its
assertions were true, well-argued and mutation-proof, and it even carried a purpose-built negative
control (`$SYSTEMD_RUN_RC`, added so the `||` could be shown load-bearing). It could not observe that
the real `tmux` exits, because `tmux` was stubbed. **A test can pin the exact SHAPE of a mechanism
whose EFFECT is nil** — this is a distinct failure mode from the "test that cannot fail" class, and the
only thing that caught it was measuring the box. Second, the spec cited tmux's per-pane
`tmux-spawn-<uuid>.scope` as *precedent* for scoping the server; that pattern is applied by an
already-running tmux to its panes and is no precedent at all for placing the server — reasoning from it
is what made the separate `start-server` step look sufficient. Third, the verification command written
into both the deploy pre-flight and the post-reboot check, `pgrep -x -f 'tmux: server'`, **returns
empty**: `-f` matches the full command line (`tmux start-server`) while `-x` demands an exact match. The
check that was supposed to prove the exercise worked could not have run. Corrected to
`pgrep -x 'tmux: server'`.

**Still outstanding:** the placement is unverified in production and stays so until the next reboot. The
criterion is also tightened — the cgroup leaf must **be** `ccrc-tmux-server.scope`, not merely "not a
`claude-session@*` unit", because the server moved *between* session units and the weaker test would
have scored that as progress.

**D-304 (was D-B8-8) — the SWAP_JITTER row of Task 17's own table named the wrong source.** The table listed
`_dispatch_swap`'s `SWAP_JITTER` operand as arriving from the **environment**. It does not: `ccd:54` is
a bare `SWAP_JITTER=120`, not `${SWAP_JITTER:-120}`, so sourcing ccd overwrites whatever a caller
exported and the operand is always ccd's own literal. The payload test written per the plan — pass the
hostile value as env — therefore **passed on the first run, before any guard existed**, and would have
been recorded as "already guarded" had the plan's Step 2 instruction been followed literally.

The site is still guarded (the `-gt` is itself an arithmetic context, and the `${SWAP_JITTER:-0}`
spelling advertises an externality that is not real today, which is exactly how a future reader gets
misled). The payload case now assigns the hostile value **after** the source — the way it could
actually arrive — and a second test pins line 54's unconditional form, so the day someone makes the
knob tunable is a red suite pointing at the guard that then starts carrying real weight.

**The general rule this earns:** when a payload test passes before the fix, the answer is not always
"already guarded". It can also be "the test never reached the site", and those two have opposite
consequences — one removes a row from the table, the other means the row was never measured at all.
Distinguish them by probing the site in isolation before believing either.

**D-305 (was D-B8-9) — the substrate fix was necessary and not sufficient: it lost a race at boot.** The reboot
that was to verify `_tmux_new_session` (D-303) instead disproved it a second time. The server came
back in `claude-session@claude-synapsium-platform.service`; `ccrc-tmux-server.scope` was absent.

The journal is unambiguous. At 22:41:46 **fifteen** supervisors logged `Failed to start transient scope
unit: Unit ccrc-tmux-server.scope was already loaded or has a fragment file`, and **one** logged
`Started ccrc-tmux-server.scope - /usr/bin/tmux new-session -d -s cc-claude-corp-data-internal`. The
scope was created and never held anything: the fifteen losers **did not wait**. Each fell through to a
bare `tmux new-session`, one of those created the server in its own cgroup, and the scope winner's
`new-session` then merely CONNECTED to that server, leaving its scope holding a client that exited at
once — which `--collect` reaped.

**The assumption that failed, recorded because it was written down as reasoning:** D-303's fix argued
that a loser's bare fallback "simply attaches to the server the first one already placed". Losing the
unit-name race says nothing about who reaches `new-session` first. **systemd serialises the NAME, not
the WORK.** An ordering was inferred from a mechanism that does not provide one, and no test could
contradict it because no test ran two callers.

*Fixed* by a double-checked lock on `$REG/.tmux-server.lock`: fast path (server up) takes no lock at
all; slow path acquires, **re-asks** whether a server exists, then places or attaches. Blocking with a
bounded wait (`TMUX_SERVER_LOCK_WAIT`, 15s) — and the blocking is the mechanism, so ccd's usual `-n`
idiom is deliberately not used here; `-n` reproduces the bug. Timeout or missing `flock` degrades to
the pre-lock behaviour: a possibly misplaced server, never a missing session.

**The transferable lesson is about test SHAPE, not test rigour.** Every test of this mechanism, across
both failures, drove exactly one caller. The defect only exists when there are seventeen. The race test
now runs eight concurrent callers through a tmux stub with real shared state — `list-sessions` answers
from a file `new-session` creates — and counts creates: **1** with the lock, **8** with the acquire
removed. *A concurrency defect cannot be caught by a suite whose every case is sequential, however
carefully each case is argued.* Both D-303 failures share that root: the suite could not express the
condition under which the mechanism actually runs.

### D-306 (was D-B8-10) — the F1 fix was written, tested, and shipped, but never *wired*; `working` outlived its process

**Found** 2026-08-19, verifying the D-305 reboot. The reboot was a free natural experiment: every
process on the box provably restarted at 08:58:25, so any hookstate written earlier belongs to a
process that no longer exists. Twelve of seventeen live sessions carried hookstate older than the
boot. Two of them read `state: "working"` — `claude2-OpenClawHetzner` (stamped 18 minutes before the
boot) and `claude-corp-custom-tools` (10.3 hours before it). Both were marked as actively working by a
process the reboot had destroyed.

**Root cause, and it is not in the hook.** `session-hook.sh` dispatches on ten events. Its
`SessionStart)` arm — carrying the long F1 comment from the build4 dogfood, and pinned green by
`session-hook.test.ts` — writes `state: "done"`, exactly the re-stamp that clears a stale `working`
and gives a virgin session its first hookstate. `install-session-hooks.sh` wired **nine**: eight in
`EVENTS_JSON` plus `PreToolUse`, special-cased for its `"*"` matcher. `SessionStart` was the one arm
never registered. Confirmed against the live fleet: every wrapper HOME binds `SessionStart` only to
`restore.sh` and the code-usage guard, never to `session-hook.sh`.

So the arm was dead code on the fleet from the day it was written. **F1 was never actually fixed in
production** — a freshly spawned worker still has no hookstate, `sweepMail`'s `hs === null` conjunct
still fails shut, and its first coordination brief still queues indefinitely (measured at ~40min when
F1 was first diagnosed). The stale-`working` defect is the same gap seen from the other end: only
`Stop` clears `working`, and a turn killed by a reboot, swap, OOM, or limit-lock never reaches its
`Stop`.

**The green suite was not wrong, it was aimed one seam short.** `session-hook.test.ts` proved the arm
computes `done`. `install-session-hooks.test.ts` proved the installer writes what its own list says.
Neither asked whether the two lists were the same list — and the installer test actively pinned the
drift shut with `expect(s.hooks.SessionStart).toEqual(EXISTING.hooks.SessionStart)`, an assertion that
read as "foreign entries survive" and also happened to assert "and we add nothing here". This is the
CLAUDE.md single-source rule (`PR_REASONS = Object.keys(PR_REASON_MAP)`) violated in the one place
`single-definition.test.ts` cannot see it: the two copies are in two languages, bash and bash-in-jq.

*Fixed* in two parts. The installer wires `SessionStart`. The arm now reads `source`, because wiring it
exposes a case the unconditional `done` gets wrong: the harness fires `SessionStart` with
`source: "compact"` in the **middle** of a turn, to re-inject context after compaction. Stamping
`done` there would tell the mail gate that an actively-thinking session is idle — the exact
mid-thought injection the gate exists to prevent, and a defect strictly worse than the one being
fixed. `compact` is therefore inert (write nothing; `PreCompact`/`PostCompact` already own that
transition). `startup`, `resume`, `clear`, and an **absent** `source` all write `done` —
absence-permits, since the pre-`source` payload is the F1 startup case.

**The mechanism, not the convention.** `install-session-hooks.test.ts` now parses the `case "$event"`
block out of `session-hook.sh`, runs the installer for real, and asserts the events actually wired are
exactly the events handled. Measured: removing `SessionStart` from `EVENTS_JSON` → **2 red**; deleting
the compact gate → **1 red**; restored → **32 passed**.

**The transferable lesson is about where a seam hides.** D-305's lesson was test *shape* — a
concurrency defect needs concurrent callers. This one is adjacent and distinct: both sides of this
seam were tested, thoroughly, in isolation, and the defect lived in the agreement between them that
neither test could see. *A list enumerated twice is a seam, and a seam with a test on each side is
still untested.* The one artifact that would have caught it is the one now added — a test that derives
one copy from the other.

### D-307 (was D-B8-11) — placing the tmux server moved the whole fleet out of its memory ceiling

**Found by asking whether tmux is the right mechanism at all**, on 2026-08-19, ~6h after D-305 was
verified. The audit was a design question; the answer came from measuring the live box, and what the
measurement actually found was a regression that D-305's own verification could not have seen,
because it asked only "is the server in `ccrc-tmux-server.scope`?" and the answer was yes.

Ubuntu's tmux (3.4, linked against `libsystemd`) mints a transient `tmux-spawn-<uuid>.scope` for every
pane and derives that scope's **slice** from its own placement. `systemd-run --user --scope` with no
`--slice` defaults to `app.slice`. The fleet's aggregate memory ceiling —
`deploy/systemd/app-claude-session.slice.d/limits.conf`, `MemoryHigh=20G` / `MemoryMax=24G`, added
2026-07-28 after one pane peaked at 24G and stalled the fleet ~25 minutes — hangs one level in, on
`app-claude\x2dsession.slice`. So placing the server placed all seventeen panes with it, out of the
ceiling. Measured:

```
app-claude\x2dsession.slice      66 MB   cap 20G/24G   <- the supervise loops, and nothing else
app.slice                      17.6 GB   cap infinity  <- all 17 panes
17/17 tmux-spawn-*.scope       Slice=app.slice
```

Proved causal the same day on an isolated socket (the `-L probe` shape `_tmux_new_session`'s own
comment records, run against a scope created inside the slice): the private server landed in
`app-claude\x2dsession.slice/ccrc-slicetest-1.scope` and **its pane scope landed in that same slice**.
The live fleet was untouched by the probe — default-socket server pid 2056 up, 17 pane scopes intact.

**What survived and what did not.** `ccd-cap-scopes` kept applying its per-scope 12G caps throughout,
because 2026-08-10 had already taught it to address scopes by unit name rather than by cgroup path —
the one piece of the guardrail that did not have to change. Only the aggregate stopped covering
anything. That distinction matters: 12G × 3 sessions overruns a 30G box, which is the precise failure
an aggregate limit exists to stop, and the per-scope caps read green while it was unguarded.

*Fixed* by naming the slice explicitly in the scope argv. Named **absolutely**, never derived from the
caller: `_spawn_start` is reached from `cmd_supervise`'s unit, from an interactive shell, and from a
transient `systemd-run`, and "wherever the creator happened to be" is the defect `_tmux_new_session`
exists to remove. The slice needs no unit file (systemd instantiates one on demand), so a box that
never installed the drop-in is no worse off than today.

**Guard.** `ccd-tmux-server.test.ts` derives the expected slice name from the deploy tree's drop-in
directory, applying systemd's `-` → `\x2d` escape, and asserts the argv names it — so the escape and
the drop-in cannot drift apart, and the readable repo path stays the single source. Mutation-measured:
deleting `--slice` → **1 red**; pointing it at `app.slice` (the bug's live state) → **1 red**; using
the *unescaped* `app-claude-session.slice`, the realistic typo that makes systemd silently never read
the drop-in → **1 red**; restored → **17 passed**.

Two comments were corrected rather than deleted. `deploy.sh`'s sweep refusal asserted "that server
sits in a claude-session@ cgroup", which stopped being true at D-303 — it now says the guard is for
the documented *fallback* placement, and says explicitly not to delete it because a healthy box makes
it look unnecessary. `ccd-cap-scopes`' layout note gains the second relocation, since its own text had
predicted exactly this ("this stays correct if ccd ever moves sessions into a different slice again").

**The transferable lesson is about the shape of a fix's blast radius.** D-305's lesson was test shape;
D-306's was that a list enumerated twice is an untested seam. This one: *a fix that relocates a
process relocates everything the process's children inherit, and cgroup membership is inherited
sideways through a dependency that documents none of it* — `man tmux` has no entry for systemd, scope,
slice or cgroup. The verification criterion was correct and passed. It measured the thing the fix set
out to change, and nothing about what else moved with it. **When a change moves something, ask what
was standing downstream of where it used to be.**

### D-308 (was D-B8-12) — `_alive` answered a question it had not managed to ask, and two destructive verbs believed it

Surfaced by the adversarial pass over the "is tmux the right mechanism" audit (2026-08-19). The audit
itself concluded *keep tmux, keep the shared server*; the operational lens then pointed at a line
neither the audit nor D-307 had looked at.

`_alive() { tmux has-session -t … 2>/dev/null; }` collapsed three conditions into one boolean, and
every failure among them is rc=1. Measured on an isolated socket, same box, same day:

```
session gone           can't find session: cc-demo
no server / no socket  error connecting to <path> (No such file or directory)
socket, but no server  no server running on <path>
tmux absent            rc 127, message from the shell
```

Only the first is evidence a session died. The other two mean *I could not ask* — and two callers were
destructive on that answer:

- **`_ws_status` (`ccd:539`)** returned `idle` when it could not ask, and `idle` is exactly what
  `ws-archive` (`ccd:2258`) and `ws-reap` (`ccd:4488`) gate on. An unreachable tmux server therefore
  presented **every live session as reapable**. The function already had the right channel: its stated
  contract is "NON-ZERO when it cannot be read", which routes to `status-unknown` and refuses. The
  `_alive` branch was the one path that bypassed the function's own contract.
- **`ccd forget` (`ccd:9196`)** proved deadness with `! _alive || die`, so an unreachable substrate let
  it purge the registry row of a **running** session — the outcome the comment three lines above warns
  about ("collapsing the two into one verb turns a cleanup into a kill"), reached by a route that
  comment did not consider. Its neighbouring hold guard is deliberately fail-shut ("present-but-unreadable
  refuses"); this one was not.

*Fixed* with `_session_verdict` → `live|gone|unknown`, and **the polarity is the whole design**: it
recognises the ONE message that means death and calls everything else unknown. It must never be
rewritten as a list of failure messages. An unrecognised future tmux error then lands in `unknown`,
which makes callers refuse; enumerating failures would land it in `gone`, which makes them destroy. A
tmux upgrade that rewords its errors degrades this to "refuses too often", never to "reaps a live one".
`_alive` is now derived from the verdict and keeps its exact old meaning (`live` only) for its eleven
other callers, so this change reaches only the two seams that were destructive.

**Mutation-measured:** collapse restored → **6 red**; `_ws_status` answering `idle` on unknown (the
shipped bug) → **1 red**; `forget`'s unknown arm deleted → **1 red**; polarity inverted to enumerate
failures → **2 red**; restored → **12 passed**.

**The fallout was the finding.** 231 tests across 7 files went red, every one of them a stub that said
`_alive() { return 1; }` — a world with no third answer. They now say `_session_verdict() { echo gone; }`,
and the shared PATH stub in `ccd-archive.test.ts` emits the real `can't find session` message instead of
a bare exit 1. That churn is the honest cost of introducing a distinction, and it is the loud kind:
every affected test failed rather than silently asserting less. `cmd_supervise` and `_session_state`
still call `_alive`, so their stubs were untouched — which is the measure of how contained the change is.

**Not fixed here, and deliberately.** `cmd_supervise`'s `while _alive "$id"` (`ccd:8474`) has the same
collapse and the worst consequence: on a tmux client/server protocol mismatch — which an unattended
`apt upgrade` of an unpinned tmux can produce at any time — all seventeen supervisors read `unknown` as
death within seconds, exit into `Restart=always`/`StartLimitBurst=5`, and the fleet reads *dead* while
seventeen claude processes keep running unattached. That one is not a guard fix: "keep looping" replaces
a false *dead* with a false *alive*, so it needs a distinct `substrate-unreachable` state carried
through `shared/api.ts`, the server and the PWA. Specified separately; the operator has declined the
host-side mitigation (tmux stays unpinned, unattended upgrades stay on), so the code must carry it.

**The transferable lesson.** D-306: a list enumerated twice is an untested seam. D-307: a fix that
moves a process moves what its children inherit. This one: *a predicate that cannot express "I don't
know" will be believed by callers that needed to hear it* — and the tell is already in the codebase,
because `_ws_status` had the three-valued contract and one of its own branches wasn't using it.
**When a helper returns a boolean, ask what it does when it fails to measure.**

### D-309 (was D-B8-13) — the server's `Tmux.hasSession` was D-B8-12's collapse, unfixed, one seam over

**Found:** 2026-08-19, by the adversarial pass over the substrate-unreachable spec's open questions; the
dominant finding was not in the spec at all. **Fixed:** 2026-08-20. **Scope:** `server/src/exec.ts`,
`server/src/watch.ts` (two callers), documented deferrals at `fleet.ts`/`sessionws.ts`.

D-308 gave ccd an honest three-valued `_session_verdict` and stopped two destructive verbs from
believing silence. The server side of the same seam was untouched: `Tmux.hasSession` reduced the whole
`ExecResult` — `stderr`, `killed`, `signal`, everything the runner had carefully carried across the
agent WebSocket — to `code === 0`. An adapter narrowing a distinction it received, in the exact adapter
class the architecture doc's highest-yield rule names. Two of its six callers were live defects:

- **`archiveSafety` (`watch.ts`) failed OPEN on a destructive path.** Its tmux arm answered
  `{verdict: 'ok'}` — the answer its caller archives on — when tmux could not be asked, with the same
  `// no pane: nothing is running` comment as ccd's `_ws_status` before D-308, while the function's
  four other cannot-tell branches all said `unknown`. Now: `gone` alone is 'ok'; `unknown` refuses,
  carrying `held`.
- **The mail sweep's bare `continue`** treated "recipient's pane is gone" and "tmux did not answer" as
  the same non-event, four lines below a registry read that distinguishes the matching pair on its own
  seam. Now `unknown` backs off on the unmeasurable arm's never-ratcheting terms
  (`countsAsAttempt: false`, step pinned at base — a substrate outage must never walk a row toward the
  undeliverable park) with the tmux message verbatim in `lastError`, which is also the herd valve
  against re-probing a wedged server every sweep.

**The mechanism, not just the fix:** `classifyHasSession` mirrors `_session_verdict`'s polarity — the
ONE death message is recognised, everything else refuses — and the message table is now a **shared
fixture** (`server/test/sessionVerdictFixture.ts`) driven by both the bash suite and the TS suite, the
lifecycle-ladder idiom applied to this contract so the twins cannot drift. `unknown` carries a
never-empty `detail` (stderr verbatim, else the signal/kill that cut the client short, else the exit
code): a blank reason is the one shape a maintainer can do nothing with. `hasSession` is derived
(`live` only), exactly as `_alive` is, for the callers whose collapse is deliberate.

**Deferred BY DECISION, marked in place:** `assembleFleet` and `liveStatus` (`fleet.ts`) and the chat
resolve (`sessionws.ts`) still read `unknown` as dead. `liveStatus`'s collapse fails toward *refusing*
an interrupt — the safe direction. The fleet view's false 'dead' (with the ungated Restart button under
it) is a product judgement — a new `SessionStatus` crosses the wire and every render seam — and belongs
to the substrate-unreachable spec, not to a guard.

**The transferable lesson.** A fix to one implementation of a two-implementation contract is half a
fix, and the halves drift unless a fixture binds them. D-308's own ledger entry said "the polarity is
the whole design" — and the polarity existed in one language. **When you fix a collapse on one side of
a seam, grep for its twin on the other side before closing the deviation.**

### D-310 (was D-B8-14) — the supervise loop stops treating silence as death, and the fault gets a face

**Shipped:** 2026-08-20, `feat/substrate-unreachable`, implementing the substrate-unreachable spec v2
(operator-approved same day). Ten plan tasks executed by a serial implementer+reviewer workflow (20
agents, every task review-gated); one blocking and six major defects then found by a four-lens
adversarial branch review (11 agents) and fixed before the PR.

**The mechanism, end to end.** `_session_probe` (deadline-bounded `has-session`, 8 s; the deadline
applies only to a real binary, so the suites' function stubs keep working) feeds a verdict-driven
`cmd_supervise` loop: `gone` is the ONLY exit; `unknown` writes `$REG/<id>.substrate`
(`<epoch-seconds> <text>`, first write WINS, skew comparison riding it), stamps the heartbeat EVERY
tick (beat counts assumed seconds — a naive backoff stamps every 180 s against the 120 s window and
ages all 17 rows into orphan mid-fault), skips the tick helpers, and backs off 5 s → 30 s after
three. A pre-flight probe gates `cmd_ensure`: a supervisor (re)started mid-wedge must not walk into
the deadline-less spawn path. The server reads the marker in `buildRecord` on the `.hold`
listed-vs-readable ladder (22 field reads now); `FleetSession.substrate: { at(ms), text } | null`
rides the wire additively (`FLEET_PROTO` still 1) through `reviveSubstrate` and the ONE tolerant
reader `substrateFault`; the PWA renders the `sess-substrate` chip, gates every destructive door
(Restart, Stop, Swap — both openers — Archive, Restore-adjacent Clean-up, Forget, and PrSheet's own
archive/reap doors) disabled+titled with the chip's own string, and derives ONE banner when every
watched row (`running` OR `restarting`) reports the fault. `ccrc-doctor` gained `tmux_skew`
(client/server version comparison; wedge and no-client get their own SKIP arms).

**What the adversarial review caught that ten green task-reviews did not:**
1. *(blocking)* The banner filtered on `lifecycle === 'running'` — a word the server cannot emit
   during the fault (its own probes read unknown → `alive` false → every faulted row classifies
   `restarting`), so it could never render in exactly the event it was built for, and the fixtures
   had seeded the wire-impossible `running`+fault combination.
2. `_substrate_mark` rewrote the marker every tick: the onset epoch was never more than one tick old
   ("since <epoch>" was a lie) and the skew diagnosis was destroyed one tick after recording — and
   the task's own green test PINNED the rewrite. Tests pin shape, not effect, again.
3. The restart path hung before the loop: `cmd_ensure` before the first probe walks into
   `_tmux_new_session`'s deadline-less `tmux list-sessions`/`new-session` under a wedge — a hang
   wearing an active unit, on the deploy `try-restart` path that hits all 17 at once.
4-5. Two ungated doors to gated verbs: SessionHeader's Move (swap, end-to-end ungated) and PrSheet's
   Archive-now/Clean-up (the verbs its neighbour sheet disables).
6. The install suite's doctor tail probed the HOST's tmux — verdict depended on the box.
7. The `gone`-only-exit test's expected code 1 was also what a spawnSync timeout kill maps to — the
   intent-named test survived deletion of the very arm it names (caught, strengthened with the
   loop's own exit sentence).

**Mutation tables** (all measured red→restored): probe deadline 1; rc-124 synthesized reason 1;
one-classifier derivation 1; skew-on-every-write 1; empty-reason guard 1; first-write-wins 1;
ensure gate 1; every-tick stamp 1; unknown-exits 2; backoff 1; clear-on-live 1; helpers-skipped 1;
registry unreadable-arm fail-open 1; listing-check 1; revive-line compile; substrateFault
empty-text 1; s→ms conversion 2; chip-direct-read 1; achromatic-group 2; eight per-control gate
mutations 1 each; banner some-vs-every 1; skew equal-versions-forced 1.

**The transferable lesson.** A serial task chain with per-task review gates produced ten green,
individually-reviewed tasks — and the cross-cutting defects lived exactly in the seams BETWEEN
tasks: the banner's filter against the lifecycle the server actually emits (task 9 vs task 6's
semantics), the marker's rewrite against the spec's "since" (task 2's test pinned its own bug), the
ensure path nobody's task owned. **Per-task review verifies tasks; only a whole-branch adversarial
pass verifies the design.** Budget for both.
