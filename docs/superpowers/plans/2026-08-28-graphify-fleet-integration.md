# Graphify Fleet Integration Implementation Plan

**All tasks shipped (PRs #41, #42, #44, #45, #46); boxes ticked retroactively 2026-09-04.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every project ccrc places a session in gets a pinned graphify engine, the skill converged
into every rostered wrapper HOME, and a per-tree AST graph kept fresh by a serialized, idle-gated
systemd sweep — graphs local to the fleet box, nothing committed into any project repo.

**Architecture:** Five components on existing rails: a venv-pinned engine (`~/.ccrc/graphify-venv`),
an assembled-SRC skill installer cloned from `install-worker-skill.sh`, an exclude writer into each
repo's common-dir `.git/info/exclude`, the `ccd-graph-sweep` oneshot+timer (two-dimensional staleness,
pre-build corpus guard, census), and a multi-condition doctor check. No server code, no PWA code, no
new ccd verb.

**Tech Stack:** bash (ccd/), systemd --user units, python3 venv, vitest bash-fixture suites
(`server/test`), one L0 TypeScript manifest (`shared/lifecycle.ts`).

**Spec:** `docs/superpowers/specs/2026-08-27-graphify-fleet-integration-design.md` (rev 3). The plan
argues from the spec; executors read both.

## Global Constraints

- **Pin:** `graphifyy==0.9.9` — spelled in exactly ONE bash file (`ccd/ccrc`, `GRAPHIFY_PIN=0.9.9`);
  everything else reads the stamp `~/.ccrc/graphify.pin`. Pinned by a new `single-definition.test.ts`
  describe (Task 1).
- **No new ccd verbs.** `EXEC_COMMANDS = ['tmux','ccd']` stays closed. Nothing here is PWA-reachable.
- **AGENT-FIRST deploy:** every file below is `ccd/` or `deploy/` — ships to the fleet box first.
- **Tests: FIXTURE HOMEs only** (`mkTmp`/`makeCcdHarness`/`seedAccountsSh`), never the live `$HOME`.
  Run suites foreground, timeout ≥600000ms, `./node_modules/.bin/vitest run` from inside `server/`.
- **Nothing lands in any project repo:** `graphify-out/` and `.graphifyignore` are excluded via the
  repo's COMMON-DIR `.git/info/exclude` (never committed by construction). The gate everywhere is
  `git -C <tree> check-ignore -q graphify-out` — mechanism-agnostic.
- **R2 (operator, 2026-08-27):** the sweep READS `$REG/*.workdir`, `*.hookstate.json` and the live
  status file; it never writes/creates/deletes/locks anything under `$REG`, never touches tmux or
  `claude-session@*`.
- **No `!` line may ever appear in a generated `.graphifyignore`** (re-includes gitignored secrets —
  spec §3.6).
- **Build env, always:** `GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 GRAPHIFY_MAX_WORKERS=<n> nice -n 15
  timeout "${CCRC_GRAPH_BUILD_TIMEOUT:-600}"` with the engine at the `$HOME`-resolved venv path.
- **Sweep census:** `~/.ccrc/graph-sweep.json`, atomic write, pass status ∈
  `ok · probed-zero · no-trees-configured · pass-locked · paused`; per-tree outcomes ∈
  `fresh · stale-rebuilt · skipped-busy · skipped-locked · skipped-budget · skipped-audit ·
  refused-no-exclude · refused-by-guard · refused-shrink · never-built · timed-out · failed`
  (`skipped-budget`/`skipped-audit`/`paused` extend spec §C.3 — recorded as **D-998**).
- **Role matrix (spec §4.1):** engine, skills, excludes, sweep units install on `fleet`/`both` only;
  on `server` the doctor check answers `_dr_skip` (rc 3).

## Operator rulings adopted (2026-08-28, one round — spec §11)

| # | Ruling |
|---|---|
| O1 | Pin **0.9.9** now; bump to 0.9.50 later as its own reviewed change (guard + Task 6 row 13 as acceptance). |
| O2 | Sweep **all trees**; serialized; per-pass rebuild budget **8** (`CCRC_GRAPH_BUDGET`). First pass ≈ 19 cold + 41 stampless rebuilds drains over ~8 passes (~2 h at 15 min). |
| O3 | Timer **15 min**; skip busy trees; **escape hatch** rebuilds anyway at ≥20 commits or ≥6 h behind (`CCRC_GRAPH_STALE_ESCAPE_COMMITS=20`, `CCRC_GRAPH_STALE_ESCAPE_SECS=21600`). |
| O4 | Pause is a FILE: `~/.ccrc/graph-sweep-paused` (touch/rm by hand). No PWA door. |
| O5 | The sweep **respects an outstanding ws-audit consent token** — such trees are `skipped-audit`. |
| O6 | **(b)** — the 9 existing graphify git hooks are UNINSTALLED (Task 10); the sweep is the only graph writer. |
| O7 | `project-graph-store` ruling, verbatim in `shared/lifecycle.ts`: "~11 MB per repo, AST-only, backups disabled, regenerable at any time; persists for the repo's lifetime; reclaim manually (rm -rf <repo>/graphify-out) if ever needed." |

## Deviation block

_(allocated from `POST /api/ledger/deviations` via `ccrc-api ledger allocate`, 2026-08-28 —
**D-995..D-998**, floor 999)_

- **D-995** (spec G-1) — doctor's `_check_disk` measures `$HOME`'s device; graph data lands on the
  worktrees device. Closed by Task 11's `WORKTREES_ROOT` df arm.
- **D-996** (spec G-2) — `ccrc-pwa` has no `graphify-out` ignore rule; 5 live worktrees. Closed by
  Task 4's exclude writer.
- **D-997** (spec G-3) — graphify skill drift invisible (absent `.claude-dev0`/`.claude-glm`, no
  doctor check). Closed by Tasks 3 + 11.
- **D-998** — census vocabulary extended beyond spec §C.3: `skipped-budget` (O2), `skipped-audit`
  (O5), pass status `paused` (O4). The spec's list predates the O-rulings.

## File map

| File | Role |
|---|---|
| Create `ccd/ccd-graph-sweep` | the sweep (Tasks 6–9) |
| Create `deploy/systemd/ccd-graph-sweep.service` / `.timer` | oneshot + 15-min timer (Task 10) |
| Create `ccd/install-graphify-skill.sh` | assembled-SRC skill installer (Task 3) |
| Create `shared/lifecycle.ts` | L0 artifact-lifecycle manifest (Task 5) |
| Modify `ccd/ccrc` | `GRAPHIFY_PIN`, `_inst_graphify_engine`, `_inst_graphify_skill`, `_inst_graph_excludes`, `_inst_graph_hooks_off`, unit lists, uninstall arms (Tasks 1–4, 10) |
| Modify `ccd/ccd` | ws-add exclude lines (Task 4) |
| Modify `ccd/ccrc-doctor-checks` | `graphify` check (Task 11) |
| Modify `deploy/deploy.sh` | agent-lane shipping (Task 10) |
| Modify `server/test/single-definition.test.ts` | pin describe (Task 1) |
| Create `server/test/install-graphify-skill.test.ts`, `server/test/graph-sweep.test.ts`, `server/test/ccrc-install-graphify.test.ts`, `server/test/ccrc-doctor-graphify.test.ts`, `server/test/lifecycle.test.ts` | suites |
| Modify `server/test/ccrc-uninstall.test.ts`, ws-add suite | list/exclude additions |

---

### Task 0: Resolver + hook-inventory measurement gate (live box, no code)

**Files:** none (findings are appended to THIS plan under "## Task 0 findings" and committed).

**Interfaces:**
- Produces: the measured resolver fact Task 9 builds on, and the hook-file inventory Task 10's
  uninstaller is written against.

- [x] **Step 1: Measure the tmux-free status-file resolver.** Read-only. For every fresh
  `~/.cc-sessions/<id>.hookstate.json` (mtime < 30 min), resolve:

```bash
for h in ~/.cc-sessions/*.hookstate.json; do
  id=$(basename "$h" .hookstate.json)
  pid=$(jq -r '.pid // empty' "$h"); [ -n "$pid" ] || continue
  wd=$(cat ~/.cc-sessions/"$id".workdir 2>/dev/null)
  wrapper=$(cat ~/.cc-sessions/"$id".wrapper 2>/dev/null)
  # find the wrapper's config dir the way ccd does (accounts.sh: _ccrc_cfg_dir)
  source ~/.ccrc/accounts.sh; cfg=$(_ccrc_cfg_dir "$wrapper")
  sf="$cfg/sessions/$pid.json"
  printf '%-28s pid=%-8s workdir=%-40s status-file=%s exists=%s\n' \
    "$id" "$pid" "$wd" "$sf" "$([ -f "$sf" ] && echo yes || echo NO)"
done
```

- [x] **Step 2: Cross-check ONE session against the pane-pid path** (read-only `tmux list-panes`,
  one invocation, sanctioned by this plan's approval): confirm the `$sf` above is byte-identical to
  the file ccd's `ccd/ccd:10492-10493` derivation reaches for the same session.
- [x] **Step 3: Verdict.** If ≥1 live session resolves and the cross-check matches → resolver
  CONFIRMED; record the sample size. If `hookstate.pid` ≠ pane pid, or `<id>.wrapper` is not a
  registry field (check `ls ~/.cc-sessions/ | sed 's/^[^.]*\.//' | sort -u`), record the ACTUAL
  field/derivation that works — Task 9 uses whatever is recorded here, and if it needs a registry
  file outside R2's set, STOP and ask the operator to extend R2 before Task 9.
- [x] **Step 4: Inventory the 9 graphify git hooks.** For each repo under `~/projects` whose
  `.git/hooks/post-commit` mentions graphify: record which hook FILES exist (post-commit,
  post-checkout), whether each file is WHOLLY graphify-generated (starts with graphify's own marker —
  read one) or chains other content, and the `_PINNED` interpreter each names.
- [x] **Step 5: Locate the ws-audit consent artifact** for Task 9/O5: `grep -n '_ws_audit\|consent\|audit' ccd/ccd | head -30`;
  record the exact registry filename(s) an outstanding audit leaves behind.
- [x] **Step 6: Append findings + commit.** Add "## Task 0 findings" at the end of this plan with the
  measured facts; `git add docs/superpowers/plans/2026-08-28-graphify-fleet-integration.md && git commit -m "docs(graphify): task 0 measurement findings"`.

---

### Task 1: The version pin, spelled once

**Files:**
- Modify: `ccd/ccrc` (top constants region, near `INST_ROLE=both` at ~:278)
- Modify: `server/test/single-definition.test.ts` (new describe at the end of the bash-side section)

**Interfaces:**
- Produces: `GRAPHIFY_PIN` (bash constant in `ccd/ccrc`), the literal `graphifyy==` appearing in
  exactly one bash file. Tasks 2/3 read `$GRAPHIFY_PIN` (in-process) or `~/.ccrc/graphify.pin`
  (cross-process stamp, written by Task 2).

- [x] **Step 1: Write the failing test.** Append to `server/test/single-definition.test.ts`, after
  the last bash-side describe (the file already defines `holdersOf`, `BASH`, `rel`):

```ts
describe('graphify — one pin, one census path', () => {
  it("the pip pin literal 'graphifyy==' lives in exactly one bash file, ccd/ccrc", () => {
    expect(holdersOf('graphifyy==')).toEqual(['ccd/ccrc']);
  });
  it('GRAPHIFY_PIN is assigned in exactly one bash file, ccd/ccrc', () => {
    const holders = BASH.filter((f) =>
      codeLines(f).some((l) => /^\s*GRAPHIFY_PIN=/.test(l))).map(rel).sort();
    expect(holders).toEqual(['ccd/ccrc']);
  });
  it("the census path '.ccrc/graph-sweep.json' is spelled by writers/readers, not duplicated as a second constant", () => {
    // the sweep WRITES it, doctor READS it — both may spell it; nothing else may.
    const holders = holdersOf('graph-sweep.json');
    expect(holders).toEqual(['ccd/ccd-graph-sweep', 'ccd/ccrc-doctor-checks']);
  });
});
```

- [x] **Step 2: Run it — expect FAIL** (`holdersOf('graphifyy==')` is `[]`):
  `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t graphify`
- [x] **Step 3: Add the pin to `ccd/ccrc`**, directly below the `INST_ROLE=both` block:

```bash
# The ONE spelling of the graphify engine version ccrc installs (spec §A, O1).
# Bumping it is a reviewed commit; the corpus guard and graph-sweep row 13 are
# the acceptance tests. Everything outside this file reads the STAMP
# (~/.ccrc/graphify.pin) that _inst_graphify_engine writes — never a second copy.
GRAPHIFY_PIN=0.9.9
```

  Note: the census-path row stays red until Tasks 6 and 11 create their files — mark it `.todo`
  until Task 11, then flip it on: write it now as `it.todo(...)` with the body in a comment, and
  Task 11 step 6 activates it.
- [x] **Step 4: Run — expect the two active rows PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat(graphify): single-definition pin GRAPHIFY_PIN=0.9.9"`

---

### Task 2: Engine provisioning — `_inst_graphify_engine`

**Files:**
- Modify: `ccd/ccrc` (new `_inst_*` function + one line in `cmd_install`'s spine after `_inst_dirs`,
  and the matching seam in `cmd_update` — find it with `grep -n '_upd_\|cmd_update()' ccd/ccrc`,
  insert after the step that refreshes `$BOX_TREE_DIR`, in the same relative position as install's)
- Test: `server/test/ccrc-install-graphify.test.ts` (new)

**Interfaces:**
- Consumes: `GRAPHIFY_PIN` (Task 1), `INST_ROLE`, `_ccrc_die`, `_inst_banner` conventions.
- Produces: `~/.ccrc/graphify-venv/bin/{python,graphify,pip}` and the stamp `~/.ccrc/graphify.pin`
  (content: the pin, one trailing newline). Tasks 3/6/11 resolve the engine ONLY via
  `$HOME/.ccrc/graphify-venv/bin/…` — never `command -v` (spec §3.7: a root-owned
  `/usr/local/bin/graphify` symlink shadows PATH).

- [x] **Step 1: Write the failing test** (`server/test/ccrc-install-graphify.test.ts`). Reuse
  `ccrc-install.test.ts`'s fixture idiom (`freshBox`/`runInstall` equivalents — import or copy its
  `installCcrc`/env builders; grep that file for `freshBox(` and mirror its setup). The venv seam:
  a PRE-EXISTING `~/.ccrc/graphify-venv/bin/python` makes the step skip `python3 -m venv` and use
  the fixture's fake — that skip IS the idempotence contract.

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
// mirror ccrc-install.test.ts's home builder + runInstall(home, ['install']) helpers.

function plantFakeVenv(home: string, version = '0.9.9'): string {
  const bin = path.join(home, '.ccrc', 'graphify-venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'python'),
    `#!/bin/sh\necho "$@" >> "$HOME/venv-python-calls"\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'graphify'),
    `#!/bin/sh\n[ "$1" = --version ] && { echo "graphify ${version}"; exit 0; }\nexit 0\n`,
    { mode: 0o755 });
  return bin;
}

describe('ccrc install: graphify engine step', () => {
  it('installs the pin into the venv and writes the stamp', () => {
    const home = freshBox('ccrc-inst-gfx-');
    plantFakeVenv(home);
    runInstall(home, ['install']);
    const calls = fs.readFileSync(path.join(home, 'venv-python-calls'), 'utf8');
    expect(calls).toContain('-m pip install');
    expect(calls).toContain('graphifyy==0.9.9');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'graphify.pin'), 'utf8')).toBe('0.9.9\n');
  });
  it('dies loudly when the installed version disagrees with the pin', () => {
    const home = freshBox('ccrc-inst-gfx-bad-');
    plantFakeVenv(home, '0.9.50');
    const r = runInstall(home, ['install']);          // capture status/stderr like siblings do
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('did not converge');
  });
  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-server-');
    plantFakeVenv(home);
    runInstall(home, ['install', '--role', 'server']);
    expect(fs.existsSync(path.join(home, '.ccrc', 'graphify.pin'))).toBe(false);
  });
});
```

- [x] **Step 2: Run — expect FAIL** (no engine step exists; no stamp written).
- [x] **Step 3: Implement** in `ccd/ccrc` (beside the other `_inst_*` functions):

```bash
# Engine into a ccrc-owned venv (spec §A): PEP-668-immune, one rm -rf to remove,
# resolved by ABSOLUTE PATH everywhere — /usr/local/bin/graphify on the reference
# fleet is a root-owned symlink an unprivileged install can neither update nor
# remove, so `command -v` is actively wrong here.
_inst_graphify_engine() {
  [ "$INST_ROLE" = server ] && return 0
  local venv="$HOME/.ccrc/graphify-venv"
  if [ ! -x "$venv/bin/python" ]; then
    python3 -m venv "$venv" \
      || _ccrc_die "python3 -m venv failed for $venv — install python3-venv (apt: python3.12-venv) and re-run; nothing else was changed"
  fi
  "$venv/bin/python" -m pip install --quiet "graphifyy==$GRAPHIFY_PIN" \
    || _ccrc_die "pip install graphifyy==$GRAPHIFY_PIN failed in $venv — network/index unreachable; nothing else was changed"
  local got
  got="$("$venv/bin/graphify" --version 2>/dev/null | awk '{print $2}')"
  [ "$got" = "$GRAPHIFY_PIN" ] \
    || _ccrc_die "graphify --version reports '${got:-nothing}' but the pin is $GRAPHIFY_PIN — the venv at $venv did not converge"
  printf '%s\n' "$GRAPHIFY_PIN" > "$HOME/.ccrc/graphify.pin"
  echo "install: graphify: engine graphifyy==$GRAPHIFY_PIN in \$HOME/.ccrc/graphify-venv (pin stamped)"
}
```

  Spine: insert `_inst_graphify_engine` between `_inst_dirs` and `_inst_hooks` in `cmd_install`
  (excerpted spine at `ccd/ccrc:2908-2926`), and the analogous position in `cmd_update`.
- [x] **Step 4: Run — expect PASS.** Also re-run `test/ccrc-install.test.ts` whole — the new spine
  step must not break its step-count/output pins; if a pin lists the spine's echo lines, add the new
  line to the expected set.
- [x] **Step 5: Commit** — `git commit -m "feat(graphify): venv engine provisioning, pinned + stamped"`

---

### Task 3: The skill installer — assembled SRC

**Files:**
- Create: `ccd/install-graphify-skill.sh`
- Modify: `ccd/ccrc` (`_inst_graphify_skill` — a SEPARATE function called from the spine right after
  `_inst_skills`, NOT a third name inside `_inst_skills`' loop: that loop forces
  `CCRC_SKILL_SRC="$HOME/.cc-sessions/$name"`, which is vendoring — spec §B)
- Modify: `ccd/ccrc` uninstall — new `_uninst_graphify_skills` beside `_uninst_cc_sessions`
- Test: `server/test/install-graphify-skill.test.ts` (new)

**Interfaces:**
- Consumes: `~/.ccrc/graphify-venv/bin/python` (Task 2), `~/.ccrc/graphify.pin`,
  `~/.ccrc/accounts.sh` (`CCRC_ACCOUNTS`, `_ccrc_cfg_dir`).
- Produces: `<home>/skills/graphify/{SKILL.md, references/*, .graphify_version}` in every rostered
  home, realpath-de-duplicated. Env seams for tests: `--homes <dirs…>` (like the worker installer),
  `CCRC_GRAPHIFY_PKG` (skip the python resolution, use this package dir),
  `CCRC_GRAPHIFY_PIN` (skip the stamp read).

- [x] **Step 1: Write the failing test** (`server/test/install-graphify-skill.test.ts`), modelled on
  `install-worker-skill.test.ts:1-46` (same `mkTmp` + HOMES + `--homes` runner):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-graphify-skill.sh');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];
let home: string; let pkg: string;
const skill = (d: string, ...rest: string[]) => path.join(home, d, 'skills', 'graphify', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-gfxskill-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
  // a fake installed package: skill body at <pkg>/skill.md, refs sidecar under skills/claude/
  pkg = path.join(home, 'fake-pkg');
  fs.mkdirSync(path.join(pkg, 'skills', 'claude', 'references'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'skill.md'), '# graphify skill body\n');
  fs.writeFileSync(path.join(pkg, 'skills', 'claude', 'references', 'update.md'), 'ref\n');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const run = (...homes: string[]) =>
  execFileSync('bash', [INSTALLER, '--homes',
    ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_GRAPHIFY_PKG: pkg, CCRC_GRAPHIFY_PIN: '0.9.9' } });

describe('install-graphify-skill', () => {
  it('assembles SKILL.md + references/ + .graphify_version into every home', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8')).toBe('# graphify skill body\n');
      expect(fs.readFileSync(skill(d, 'references', 'update.md'), 'utf8')).toBe('ref\n');
      expect(fs.readFileSync(skill(d, '.graphify_version'), 'utf8')).toBe('0.9.9');
    }
  });
  it('is idempotent: a second run leaves inode and mtime alone', () => {
    run();
    const p = skill('.claude', 'SKILL.md');
    const before = fs.statSync(p);
    run();
    const after = fs.statSync(p);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
  it('writes a symlinked skills dir exactly once (realpath de-dup)', () => {
    // .claude-gpt/skills -> .claude/skills, the live fleet's real shape (spec §B)
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(home, '.claude', 'skills'), path.join(home, '.claude-gpt', 'skills'));
    run(path.join(home, '.claude'), path.join(home, '.claude-gpt'));
    // the backup dir would carry TWO entries if the second write re-swapped through the symlink
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    const backups = path.join(home, 'ccrc-backups');
    expect(fs.existsSync(backups)).toBe(false);   // fresh install: no backup, and no double-swap
  });
  it('refuses loudly when the package carries no skill body', () => {
    fs.rmSync(path.join(pkg, 'skill.md'));
    expect(() => run()).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
  });
});
```

- [x] **Step 2: Run — expect FAIL** (installer does not exist).
- [x] **Step 3: Write `ccd/install-graphify-skill.sh`** — the worker installer's swap loop
  (`ccd/install-worker-skill.sh:57-88`, copy it faithfully: diff-continue, staged tmp, backup,
  mv+rollback, per-home `rc=1; continue`) with a NEW head:

```bash
#!/usr/bin/env bash
# install-graphify-skill.sh — converge the graphify skill into every rostered
# wrapper home. Same swap loop as install-worker-skill.sh (diff -r -q
# convergence, backup + staged mv + rollback, per-home isolation) with one
# structural difference stated by the spec (§B): SRC is ASSEMBLED from the
# INSTALLED PACKAGE, never vendored — <pkg>/skill.md is the body,
# <pkg>/skills/claude/references/ the sidecar, and .graphify_version is written
# from the pin — so the staged tree is byte-identical to $dest and the diff can
# converge. Two writers to <home>/skills/graphify would drift: ccrc's installer
# is the ONLY sanctioned one (graphify's own `claude install` writes the same
# path — never run it on a rostered home).
set -euo pipefail

VENV="${CCRC_GRAPHIFY_VENV:-$HOME/.ccrc/graphify-venv}"
NAME=graphify
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

PIN="${CCRC_GRAPHIFY_PIN:-}"
[ -n "$PIN" ] || PIN="$(cat "$HOME/.ccrc/graphify.pin" 2>/dev/null || true)"
[ -n "$PIN" ] \
  || { echo "install-graphify-skill: no pin — run the engine step first (~/.ccrc/graphify.pin missing)" >&2; exit 1; }

PKG="${CCRC_GRAPHIFY_PKG:-}"
if [ -z "$PKG" ]; then
  PKG="$("$VENV/bin/python" -c 'import graphify, pathlib; print(pathlib.Path(graphify.__file__).parent)')" \
    || { echo "install-graphify-skill: cannot resolve the graphify package from $VENV — refusing" >&2; exit 1; }
fi
[ -f "$PKG/skill.md" ] \
  || { echo "install-graphify-skill: no skill.md under $PKG — refusing (the skill body is <pkg>/skill.md, spec §B)" >&2; exit 1; }
[ -d "$PKG/skills/claude/references" ] \
  || { echo "install-graphify-skill: no skills/claude/references under $PKG — refusing" >&2; exit 1; }
command -v diff >/dev/null 2>&1 \
  || { echo "install-graphify-skill: diff unavailable — refusing rather than rewriting blind" >&2; exit 1; }

# The assembled SRC — what every home must converge to, byte for byte.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/graphify-skill-src.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT INT TERM
mkdir -p "$STAGE/references"
cp -a "$PKG/skill.md" "$STAGE/SKILL.md"
cp -a "$PKG/skills/claude/references/." "$STAGE/references/"
printf '%s' "$PIN" > "$STAGE/.graphify_version"   # graphify's own installer writes no newline
SRC="$STAGE"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else
  # shellcheck source=/dev/null
  source "$HOME/.ccrc/accounts.sh" \
    || { echo "install-graphify-skill: no roster at \$HOME/.ccrc/accounts.sh" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

rc=0
declare -A seen_skills=()
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue
  mkdir -p "$dir/skills" 2>/dev/null || { rc=1; continue; }
  skills_real="$(realpath "$dir/skills" 2>/dev/null)" || { rc=1; continue; }
  # Two rostered homes symlink skills/ into one directory (.claude-gpt/.claude-kimi
  # -> ~/.claude/skills on the reference fleet): write each REAL directory once.
  [[ -n "${seen_skills[$skills_real]:-}" ]] && continue
  seen_skills[$skills_real]=1
  dest="$skills_real/$NAME"
  # …the worker installer's swap loop verbatim from here (diff-continue, tmp,
  # backup, mv + rollback, rc=1 per-home isolation)…
done
exit "$rc"
```

- [x] **Step 4: Run — expect PASS.**
- [x] **Step 5: Wire into ccrc.** In `ccd/ccrc`, after `_inst_skills` in the spine:

```bash
# The graphify skill is NOT one of _inst_skills' names on purpose (spec §B):
# that loop pins CCRC_SKILL_SRC to a vendored ~/.cc-sessions tree, and this
# skill's source of truth is the installed package.
_inst_graphify_skill() {
  [ "$INST_ROLE" = server ] && return 0
  _inst_atomic "$BOX_TREE_DIR/ccd/install-graphify-skill.sh" "$HOME/.cc-sessions/install-graphify-skill.sh" 755
  bash "$HOME/.cc-sessions/install-graphify-skill.sh" \
    || _ccrc_die "install-graphify-skill.sh refused — read its lines above"
  echo "install: graphify: skill assembled from the venv package into each account's skills directory"
}
```

  Uninstall arm (beside `_uninst_cc_sessions`, `ccd/ccrc:4568`) — roster homes, realpath-de-duped,
  `rm -rf "<skills>/graphify"`; add `"$reg/install-graphify-skill.sh"` to `_uninst_cc_sessions`' `rm -f` list.
  Extend `server/test/ccrc-uninstall.test.ts`'s file-list expectations accordingly.
- [x] **Step 6: Run the install/uninstall suites; commit** —
  `git commit -m "feat(graphify): assembled-SRC skill installer, roster-wide, de-duped"`

---

### Task 4: The exclude writer (D') — `ws-add` + `_inst_graph_excludes`

**Files:**
- Modify: `ccd/ccd:2993` (the `.ccrc/` append block in ws-add)
- Modify: `ccd/ccrc` (new `_inst_graph_excludes`, in the spine after `_inst_graphify_skill`)
- Test: extend the ws-add suite (find it: `grep -ln 'ws.add\|cmd_ws_add' server/test/*.test.ts`) +
  `server/test/ccrc-install-graphify.test.ts`

**Interfaces:**
- Consumes: harness `makeCcdHarness` (`server/test/ccdWsHelpers.ts`), `PROJECTS_ROOT`/`WORKTREES_ROOT`
  (derived from HOME, no override — the fixture IS the isolation).
- Produces: `graphify-out/` and `.graphifyignore` lines in each repo's COMMON-DIR
  `.git/info/exclude`; the sweep's gate `git -C <tree> check-ignore -q graphify-out` passes.

- [x] **Step 1: Failing test, ws-add half.** In the existing ws-add suite (copy its invocation idiom
  exactly — it already builds a repo and calls ws-add through `h.sh(...)`):

```ts
it('ws-add excludes graphify-out/ and .graphifyignore beside .ccrc/', () => {
  // …existing ws-add setup for a fixture repo `proj` and workspace `wsx`…
  const excl = fs.readFileSync(path.join(h.home, 'projects', 'proj', '.git', 'info', 'exclude'), 'utf8');
  for (const line of ['.ccrc/', 'graphify-out/', '.graphifyignore']) expect(excl).toContain(line);
  // the gate the sweep uses, asked in the WORKTREE (common-dir sharing is the point):
  expect(() => h.git(path.join(h.home, 'worktrees', 'proj', 'wsx'),
    'check-ignore', '-q', 'graphify-out')).not.toThrow();
});
```

- [x] **Step 2: Run — expect FAIL** (only `.ccrc/` is appended today).
- [x] **Step 3: Implement, ws-add half.** At `ccd/ccd:2993`, extend the existing idempotent append:

```bash
  grep -qxF '.ccrc/' "$common/info/exclude" 2>/dev/null || echo '.ccrc/' >> "$common/info/exclude"
  # Graph store + the sweep's ephemeral corpus filter (spec §D'/§E): excluded so
  # `git worktree remove` collects the store WITH the tree (un-ignored, it wedges
  # ws-rm/ws-reap/ws-gc — none pass --force), and so a SIGKILL-orphaned
  # .graphifyignore can never make a workspace unremovable.
  grep -qxF 'graphify-out/' "$common/info/exclude" 2>/dev/null || echo 'graphify-out/' >> "$common/info/exclude"
  grep -qxF '.graphifyignore' "$common/info/exclude" 2>/dev/null || echo '.graphifyignore' >> "$common/info/exclude"
```

- [x] **Step 4: Failing test, install half** (in `ccrc-install-graphify.test.ts`). Define the
  shared helper both this task and Task 10 use:

```ts
export function makeFixtureRepo(home: string, rel: string): string {
  const d = path.join(home, rel);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  fs.writeFileSync(path.join(d, 'a.py'), 'x = 1\n');
  execFileSync('git', ['-C', d, 'add', '.'], { env });
  execFileSync('git', ['-C', d, 'commit', '-qm', 'init'], { env });
  return d;
}
```

  Then: build `makeFixtureRepo(home, 'projects/repoA')` plus a worktree
  (`git -C <repoA> worktree add ../../worktrees/repoA/ws1 -b ws1`); run install; assert
  `git -C ~/worktrees/repoA/ws1 check-ignore -q graphify-out` exits 0 and that a second run appends
  nothing (exclude file content identical).
- [x] **Step 5: Implement `_inst_graph_excludes`** in `ccd/ccrc`:

```bash
# D' (spec §4): the exclude precondition needs a WRITER, or the sweep refuses
# every un-excluded repo forever (ccrc-pwa fails the gate today — D-996).
_inst_graph_excludes() {
  [ "$INST_ROLE" = server ] && return 0
  local roots=("$HOME/projects" "$HOME/worktrees") root d common n=0
  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    for d in "$root"/*/ "$root"/*/*/; do
      [ -d "$d" ] || continue
      git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
      common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir) || continue
      mkdir -p "$common/info"
      grep -qxF 'graphify-out/' "$common/info/exclude" 2>/dev/null \
        || { echo 'graphify-out/' >> "$common/info/exclude"; n=$((n+1)); }
      grep -qxF '.graphifyignore' "$common/info/exclude" 2>/dev/null \
        || echo '.graphifyignore' >> "$common/info/exclude"
    done
  done
  echo "install: graphify: exclude lines converged (graphify-out/, .graphifyignore; $n new)"
}
```

- [x] **Step 6: Run both suites — PASS; commit** —
  `git commit -m "feat(graphify): exclude writer — ws-add + install converge common-dir excludes (D-996)"`

---

### Task 5: `shared/lifecycle.ts` — the artifact-lifecycle manifest

**Files:**
- Create: `shared/lifecycle.ts`
- Test: `server/test/lifecycle.test.ts` (new)

**Interfaces:**
- Produces: `LifecycleClass` type + `LIFECYCLE` const. L0: the file imports NOTHING (not even
  `node:*`) — the PWA may bundle `shared/*.ts` (project CLAUDE.md ring rules).

- [x] **Step 1: Failing test:**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';
import { LIFECYCLE } from '../../shared/lifecycle.js';

describe('shared/lifecycle.ts — the policy §4(a) manifest', () => {
  it('is L0: imports nothing at all', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../shared/lifecycle.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import /m);
  });
  it('declares the five graphify classes', () => {
    const names = LIFECYCLE.map((c) => c.name).sort();
    for (const n of ['workspace-graph-store', 'project-graph-store', 'graph-corpus-filter',
      'graph-build-lock', 'graph-sweep-census']) expect(names).toContain(n);
  });
  it('every collector-less class carries a non-empty operator ruling', () => {
    for (const c of LIFECYCLE.filter((c) => c.collector === null)) {
      expect(c.ruling, `${c.name} needs a ruling`).toBeTruthy();
    }
  });
});
```

- [x] **Step 2: Run — FAIL** (module absent).
- [x] **Step 3: Implement `shared/lifecycle.ts`** (no imports; plain literals):

```ts
// L0. The artifact-lifecycle policy's §4(a) machine-readable manifest
// (docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md) — first
// created for the graphify classes (spec §7); other artifact classes join as
// they are declared. Imports NOTHING: the PWA bundles shared/*.ts.
export interface LifecycleClass {
  readonly name: string;
  readonly root: string;          // path pattern, $HOME-relative or per-tree
  readonly pattern: 'W' | 'S' | 'P' | 'R' | 'X' | 'E' | 'O';
  readonly creators: readonly string[];
  readonly collector: string | null;   // null REQUIRES `ruling`
  readonly bound: string;
  readonly tier: string;               // affordability note, measured
  readonly ruling: string | null;      // operator sentence when collector is null
}

export const LIFECYCLE: readonly LifecycleClass[] = [
  { name: 'workspace-graph-store', root: '<workdir>/graphify-out/', pattern: 'W',
    creators: ['ccd-graph-sweep'],
    collector: 'git worktree remove via cmd_ws_rm / reap tail / ws-gc orphan arm (ccd:3444-3451, :9298, :9989)',
    bound: 'workspace lifetime', tier: '~11 MB/tree measured (ccrc, 763 files)', ruling: null },
  { name: 'project-graph-store', root: '<projects-root>/<repo>/graphify-out/', pattern: 'O',
    creators: ['ccd-graph-sweep'], collector: null, bound: 'repo lifetime',
    tier: '~11 MB/repo, AST-only, backups disabled',
    ruling: '~11 MB per repo, AST-only, backups disabled, regenerable at any time; persists for the repo\'s lifetime; reclaim manually (rm -rf <repo>/graphify-out) if ever needed.' },
  { name: 'graph-corpus-filter', root: '<tree>/.graphifyignore', pattern: 'E',
    creators: ['ccd-graph-sweep'], collector: 'ccd-graph-sweep (trap EXIT INT TERM + stray sweep)',
    bound: 'one build', tier: '<1 KB', ruling: null },
  { name: 'graph-build-lock', root: '<tree>/graphify-out/.rebuild.lock', pattern: 'E',
    creators: ['graphify'], collector: 'graphify', bound: 'one build', tier: 'negligible', ruling: null },
  { name: 'graph-sweep-census', root: '~/.ccrc/graph-sweep.json', pattern: 'R',
    creators: ['ccd-graph-sweep'], collector: 'ccd-graph-sweep (last 10 passes kept)',
    bound: 'rolling', tier: 'bounded by pass count', ruling: null },
];
```

- [x] **Step 4: Run — PASS.** Also run the full server suite's ring/import checks if present
  (`grep -ln 'shared' server/test/*ring* server/test/*import* 2>/dev/null` — if a ring suite scans
  `shared/`, confirm it passes with the new file).
- [x] **Step 5: Commit** — `git commit -m "feat(lifecycle): shared/lifecycle.ts manifest with graphify classes (spec §7, O7)"`

---

### Task 6: Sweep skeleton — enumeration, probe, census

**Files:**
- Create: `ccd/ccd-graph-sweep`
- Test: `server/test/graph-sweep.test.ts` (new)

**Interfaces:**
- Consumes: `~/.ccrc/graphify.pin`, `jq` (a doctor-checked prerequisite), fixture trees under
  `$HOME/projects` + `$HOME/worktrees`.
- Produces: the sweep binary with stub hooks `_gs_busy()` (Task 9), `_gs_build()` (Task 7),
  `_gs_guard()` (Task 8) — later tasks REPLACE the named stubs; `~/.ccrc/graph-sweep.json` schema
  `{passes:[{started,finished,pin,status,trees:[{path,outcome,reason,duration_ms}]}]}` (last 10).

- [x] **Step 1: Failing tests** (`server/test/graph-sweep.test.ts`). The harness plants a FAKE
  engine in the fixture venv — every graph-sweep test drives the sweep through `HOME=fixture`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const SWEEP = path.resolve(__dirname, '../../ccd/ccd-graph-sweep');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
           GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}
function makeRepo(name: string): string {
  const d = j('projects', name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  fs.writeFileSync(path.join(d, 'a.py'), 'x = 1\n');
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'init');
  // the exclude precondition, as D' leaves it:
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), 'graphify-out/\n.graphifyignore\n');
  return d;
}
function plantEngine(behavior = ''): void {
  const bin = j('.ccrc', 'graphify-venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'graphify'), `#!/bin/bash
echo "cwd=$PWD argv=$* NO_BACKUP=\${GRAPHIFY_NO_BACKUP:-} SEED=\${PYTHONHASHSEED:-} WORKERS=\${GRAPHIFY_MAX_WORKERS:-}" >> "$HOME/engine-calls"
${behavior}
mkdir -p graphify-out
printf '{"nodes":[],"links":[],"built_at_commit":"%s"}' "$(git rev-parse HEAD)" > graphify-out/graph.json
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
}
function runSweep(env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [SWEEP], { encoding: 'utf8',
    env: { ...process.env, HOME: home, CCRC_GRAPH_BUILD_TIMEOUT: '5', ...env } });
}
const census = () => JSON.parse(fs.readFileSync(j('.ccrc', 'graph-sweep.json'), 'utf8'));
const lastPass = () => census().passes.at(-1);
const outcomeOf = (tree: string) =>
  lastPass().trees.find((t: { path: string }) => t.path === tree)?.outcome;

beforeEach(() => { home = mkTmp('ccrc-gfxsweep-'); fs.mkdirSync(j('.ccrc'), { recursive: true }); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('graph-sweep: probe + census (Task 6)', () => {
  it('cold-builds a never-built tree, stamps the engine, and a second pass is fresh', () => {
    const repo = makeRepo('alpha'); plantEngine();
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('never-built');
    expect(fs.readFileSync(path.join(repo, 'graphify-out', '.graphify_engine'), 'utf8')).toBe('0.9.9\n');
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('fresh');
  });
  it('row 13 — a pin bump alone re-marks a fresh tree stale (engine dimension)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep(); runSweep();
    expect(outcomeOf(repo)).toBe('fresh');
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.50\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('row 1 — a tree without the exclude line is refused, not built', () => {
    const repo = makeRepo('alpha');
    fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '');   // strip D'
    plantEngine();
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-no-exclude');
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
  });
  it('row 8 — zero trees probed on a box that HAS tree roots is an error', () => {
    fs.mkdirSync(j('projects'), { recursive: true });   // root exists, no git tree in it
    plantEngine();
    const r = runSweep();
    expect(r.status).not.toBe(0);
    expect(lastPass().status).toBe('probed-zero');
  });
  it('no tree roots at all is a distinct, non-error status', () => {
    plantEngine();
    const r = runSweep();
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('no-trees-configured');
  });
  it('row 6 — a second entrant exits pass-locked while a pass holds the flock', async () => {
    makeRepo('alpha'); plantEngine();
    const lock = j('.ccrc', 'graph-sweep.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));          // let flock take it
    try {
      expect(runSweep().status).toBe(0);
      expect(lastPass().status).toBe('pass-locked');
      expect(fs.existsSync(j('engine-calls'))).toBe(false);
    } finally { holder.kill(); }
  });
  it('O4 — the pause file short-circuits the pass', () => {
    makeRepo('alpha'); plantEngine();
    fs.writeFileSync(j('.ccrc', 'graph-sweep-paused'), '');
    expect(runSweep().status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(fs.existsSync(j('engine-calls'))).toBe(false);
  });
});
```

  Import note: the pass-locked and skipped-locked cases use `spawn` — add
  `import { spawn } from 'node:child_process';` to the suite's imports.
- [x] **Step 2: Run — FAIL** (sweep absent).
- [x] **Step 3: Implement `ccd/ccd-graph-sweep`** (skeleton; stubs replaced by Tasks 7–9):

```bash
#!/usr/bin/env bash
# ccd-graph-sweep — keep one AST graph fresh per git tree (spec §C). Serialized
# oneshot driven by ccd-graph-sweep.timer; every knob env-overridable for the
# test harness (CCRC_DOCTOR_GH_TIMEOUT precedent). HOME-derived roots, no
# override — HOME is the harness's isolation boundary, exactly as in ccd.
set -uo pipefail

REG="$HOME/.cc-sessions"
PROJECTS_ROOT="$HOME/projects"
WORKTREES_ROOT="$HOME/worktrees"
VENV="$HOME/.ccrc/graphify-venv"
ENGINE="$VENV/bin/graphify"
PIN_FILE="$HOME/.ccrc/graphify.pin"
CENSUS="$HOME/.ccrc/graph-sweep.json"
PAUSE="$HOME/.ccrc/graph-sweep-paused"
LOCK="$HOME/.ccrc/graph-sweep.lock"
: "${CCRC_GRAPH_BUILD_TIMEOUT:=600}"
: "${CCRC_GRAPH_BUDGET:=8}"
: "${CCRC_GRAPH_MAX_WORKERS:=4}"
: "${CCRC_GRAPH_STALE_ESCAPE_COMMITS:=20}"
: "${CCRC_GRAPH_STALE_ESCAPE_SECS:=21600}"

PIN="$(cat "$PIN_FILE" 2>/dev/null || true)"
STARTED="$(date -u +%FT%TZ)"
ROWS=()          # jq-ready per-tree objects
BUILT=0          # rebuilds this pass, against CCRC_GRAPH_BUDGET

_gs_row() {      # path outcome reason duration_ms
  ROWS+=("$(jq -cn --arg p "$1" --arg o "$2" --arg r "$3" --argjson d "${4:-0}" \
    '{path:$p, outcome:$o, reason:$r, duration_ms:$d}')")
}

_gs_finish() {   # pass-status ; exit-code
  local status="$1" rc="$2" tmp
  tmp="$(mktemp "$CENSUS.XXXXXX")"
  # NB: printf of an EMPTY array must emit nothing — a lone newline breaks
  # `jq -cs` (slurp of empty input is [], of "\n" is a parse error).
  { [ "${#ROWS[@]}" -gt 0 ] && printf '%s\n' "${ROWS[@]}"; true; } | jq -cs \
    --arg started "$STARTED" --arg finished "$(date -u +%FT%TZ)" \
    --arg pin "$PIN" --arg status "$status" \
    '{started:$started, finished:$finished, pin:$pin, status:$status, trees:.}' > "$tmp" \
    || { rm -f "$tmp"; echo "graph-sweep: census assembly failed" >&2; exit 1; }
  # append, keep last 10 passes, atomic
  jq -c --slurpfile p "$tmp" '.passes = ((.passes // []) + $p | .[-10:])' \
    "$CENSUS" 2>/dev/null > "$tmp.2" \
    || jq -cn --slurpfile p "$tmp" '{passes: $p}' > "$tmp.2"
  mv "$tmp.2" "$CENSUS"; rm -f "$tmp"
  exit "$rc"
}

_gs_trees() {    # every git working tree under the two roots
  local d
  for d in "$PROJECTS_ROOT"/*/ "$WORKTREES_ROOT"/*/*/; do
    [ -d "$d" ] || continue
    git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 && printf '%s\n' "${d%/}"
  done
}

_gs_stale() {    # tree -> 0 stale / 1 fresh ; REASON set
  local tree="$1" head built stamp
  head="$(git -C "$tree" rev-parse HEAD 2>/dev/null)" || { REASON=unreadable-head; return 0; }
  [ -f "$tree/graphify-out/graph.json" ] || { REASON=never-built; return 0; }
  built="$(jq -r '.built_at_commit // empty' "$tree/graphify-out/graph.json" 2>/dev/null)"
  stamp="$(cat "$tree/graphify-out/.graphify_engine" 2>/dev/null || true)"
  [ "$stamp" = "$PIN" ] || { REASON=engine; return 0; }
  [ "$built" = "$head" ] || { REASON=head; return 0; }
  return 1
}

# ── stubs replaced by later tasks ─────────────────────────────────────────
_gs_busy()  { return 1; }   # Task 9: idle gate + audit token + escape hatch
_gs_guard() { return 0; }   # Task 8: pre-build corpus guard + .graphifyignore
_gs_build() {               # Task 7: contained build + discriminators + stamp
  local tree="$1"
  ( cd "$tree" && GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 \
      GRAPHIFY_MAX_WORKERS="$CCRC_GRAPH_MAX_WORKERS" \
      nice -n 15 timeout "$CCRC_GRAPH_BUILD_TIMEOUT" "$ENGINE" update . ) \
    >>"$HOME/.ccrc/graph-sweep.log" 2>&1
  local rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$PIN" > "$tree/graphify-out/.graphify_engine"
  return "$rc"
}

# ── the pass ──────────────────────────────────────────────────────────────
exec 9>"$LOCK"
flock -n 9 || { ROWS=(); _gs_finish pass-locked 0; }
[ -e "$PAUSE" ] && _gs_finish paused 0
[ -n "$PIN" ] || { echo "graph-sweep: no pin at $PIN_FILE — run ccrc install first" >&2; _gs_finish failed 1; }

if [ ! -d "$PROJECTS_ROOT" ] && [ ! -d "$WORKTREES_ROOT" ]; then
  _gs_finish no-trees-configured 0
fi

PROBED=0
while IFS= read -r tree; do
  PROBED=$((PROBED+1))
  if ! git -C "$tree" check-ignore -q graphify-out; then
    _gs_row "$tree" refused-no-exclude "git check-ignore graphify-out failed — run: ccrc install (the exclude writer)" 0
    continue
  fi
  if ! _gs_stale "$tree"; then _gs_row "$tree" fresh "" 0; continue; fi
  stale_reason="$REASON"
  if _gs_busy "$tree"; then _gs_row "$tree" "$BUSY_OUTCOME" "$BUSY_REASON" 0; continue; fi
  if [ "$BUILT" -ge "$CCRC_GRAPH_BUDGET" ]; then
    _gs_row "$tree" skipped-budget "pass budget $CCRC_GRAPH_BUDGET reached" 0; continue
  fi
  if ! _gs_guard "$tree"; then _gs_row "$tree" refused-by-guard "$GUARD_REASON" 0; continue; fi
  t0=$(date +%s%3N)
  _gs_build "$tree"; rc=$?
  dur=$(( $(date +%s%3N) - t0 )); BUILT=$((BUILT+1))
  case "$rc" in
    0)   if [ "$stale_reason" = never-built ]; then _gs_row "$tree" never-built "cold build" "$dur"
         else _gs_row "$tree" stale-rebuilt "$stale_reason" "$dur"; fi ;;
    *)   _gs_row "$tree" "$BUILD_OUTCOME" "$BUILD_REASON" "$dur" ;;   # Task 7 sets these
  esac
done < <(_gs_trees)

if [ "$PROBED" -eq 0 ]; then
  echo "graph-sweep: tree roots exist but zero trees probed — the ccd-cap-scopes failure shape; investigate" >&2
  _gs_finish probed-zero 1
fi
_gs_finish ok 0
```

  Task-6 note: until Task 7 lands, set `BUILD_OUTCOME=failed BUILD_REASON="exit $rc"` just before
  the case (two lines, replaced in Task 7); `BUSY_OUTCOME`/`BUSY_REASON` are set by Task 9's real
  `_gs_busy` (the stub returns 1 = never busy, so they are unread).
- [x] **Step 4: Run — the Task-6 rows PASS** (rows 13, 1, 8, pause, pass-locked, cold-build).
- [x] **Step 5: Commit** — `git commit -m "feat(graphify): ccd-graph-sweep skeleton — probe, census, budget, pause (D-998 vocabulary)"`

---

### Task 7: Build discriminators, timeout knob, containment argv

**Files:**
- Modify: `ccd/ccd-graph-sweep` (replace `_gs_build` and the two placeholder lines)
- Test: `server/test/graph-sweep.test.ts` (extend)

**Interfaces:**
- Consumes: Task 6's skeleton (`_gs_row`, `$ENGINE`, `$PIN`, census).
- Produces: `BUILD_OUTCOME` ∈ `timed-out | refused-shrink | failed`, `BUILD_REASON` (first stderr
  line). Discriminators (spec §C.3): exit 124 ⇒ `timed-out`; exit≠0 ∧ `graph.json` size+mtime
  unchanged ∧ shrink message on stderr ⇒ `refused-shrink`; every other exit≠0 ⇒ `failed`.

- [x] **Step 1: Failing tests** (append to `graph-sweep.test.ts`; `plantEngine(behavior)` injects
  the failure mode):

```ts
describe('graph-sweep: build discriminators (Task 7)', () => {
  it('row 7 — a wedged engine is timed-out by the knob, not a hung pass', () => {
    const repo = makeRepo('alpha');
    plantEngine('sleep 60');                                   // wedges past the 5s test knob
    const t0 = Date.now();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '2' });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(outcomeOf(repo)).toBe('timed-out');
  });
  it('row 17 — a shrink refusal is refused-shrink, never failed', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                // seed a graph + stamp
    git(repo, 'commit', '-qm', 'move', '--allow-empty');       // make it stale again
    plantEngine('echo "refusing to write: node count shrank" >&2; exit 1\n# no graph write:');
    // the fake above must NOT rewrite graph.json — remove the trailing writer lines for this plant:
    const enginePath = j('.ccrc', 'graphify-venv', 'bin', 'graphify');
    fs.writeFileSync(enginePath, `#!/bin/bash
echo "refusing to write: node count shrank (shrink guard)" >&2
exit 1
`, { mode: 0o755 });
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-shrink');
  });
  it('other exit-1 conditions collapse to failed, carrying the first stderr line', () => {
    const repo = makeRepo('alpha');
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'graphify'), `#!/bin/bash
echo "extractor exploded: boom" >&2
exit 1
`, { mode: 0o755 });
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('failed');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repo).reason)
      .toContain('extractor exploded');
  });
  it('rows 4+18+5a — the build runs IN the tree with the pinned env (argv pin)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();
    const call = fs.readFileSync(j('engine-calls'), 'utf8');
    expect(call).toContain(`cwd=${fs.realpathSync(repo)}`);    // row 4: chdir (export.py:475 has no cwd=)
    expect(call).toContain('NO_BACKUP=1');                     // row 5a
    expect(call).toContain('SEED=0');                          // PYTHONHASHSEED
    expect(call).toContain('WORKERS=');                        // row 18: cap present
  });
  it('skipped-locked — a held .rebuild.lock defers the tree without waiting', async () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                            // seed + stamp
    git(repo, 'commit', '-qm', 'move', '--allow-empty');   // stale again
    const lock = path.join(repo, 'graphify-out', '.rebuild.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));
    try {
      const t0 = Date.now();
      runSweep();
      expect(Date.now() - t0).toBeLessThan(10_000);        // deferred, never waited
      expect(outcomeOf(repo)).toBe('skipped-locked');
    } finally { holder.kill(); }
  });
});
```

  child holding it, run the sweep, assert `skipped-locked`, then `child.kill()`.)
- [x] **Step 2: Run — FAIL** (skeleton reports everything non-zero as `failed`; no lock probe;
  fake-engine `cwd=` assert fails only if skeleton got it wrong — keep it as a pin either way).
- [x] **Step 3: Replace `_gs_build`** and delete the Task-6 placeholder lines:

```bash
_gs_build() {
  local tree="$1" out="$tree/graphify-out"
  # Non-blocking lock probe (spec §C.3): graphify's own updates block on this
  # flock by design; a held lock means a writer is live, so defer — timeout
  # then again means only "wedged".
  if [ -e "$out/.rebuild.lock" ] && ! flock -n -E 99 "$out/.rebuild.lock" true 2>/dev/null; then
    BUILD_OUTCOME=skipped-locked; BUILD_REASON="rebuild lock held"; return 2
  fi
  local before_sz=0 before_mt=0 errf
  if [ -f "$out/graph.json" ]; then
    before_sz=$(stat -c %s "$out/graph.json"); before_mt=$(stat -c %Y "$out/graph.json")
  fi
  errf="$(mktemp "${TMPDIR:-/tmp}/gfx-stderr.XXXXXX")"
  ( cd "$tree" && GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 \
      GRAPHIFY_MAX_WORKERS="$CCRC_GRAPH_MAX_WORKERS" \
      nice -n 15 timeout "$CCRC_GRAPH_BUILD_TIMEOUT" "$ENGINE" update . ) \
      >>"$HOME/.ccrc/graph-sweep.log" 2>"$errf"
  local rc=$? first
  first="$(head -n1 "$errf" 2>/dev/null || true)"
  cat "$errf" >> "$HOME/.ccrc/graph-sweep.log"; rm -f "$errf"
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$PIN" > "$tree/graphify-out/.graphify_engine"
    BUILD_OUTCOME=""; BUILD_REASON=""; return 0
  fi
  if [ "$rc" -eq 124 ]; then
    BUILD_OUTCOME=timed-out; BUILD_REASON="exceeded ${CCRC_GRAPH_BUILD_TIMEOUT}s"; return 1
  fi
  local after_sz=0 after_mt=0
  if [ -f "$out/graph.json" ]; then
    after_sz=$(stat -c %s "$out/graph.json"); after_mt=$(stat -c %Y "$out/graph.json")
  fi
  # refused-shrink: exit 1 AND graph.json untouched AND the shrink message —
  # text pinned against the PINNED engine (0.9.9 export.to_json), row 17 reds
  # if a shrink lands as failed.
  if [ "$after_sz" = "$before_sz" ] && [ "$after_mt" = "$before_mt" ] \
     && grep -qi 'shrank\|shrink' <<<"$first"; then
    BUILD_OUTCOME=refused-shrink; BUILD_REASON="$first"; return 1
  fi
  BUILD_OUTCOME=failed; BUILD_REASON="${first:-exit $rc}"; return 1
}
```

  In the pass loop, the `case "$rc"` becomes: `0` → the fresh/stale rows as before; `2` →
  `_gs_row "$tree" skipped-locked "$BUILD_REASON" 0` (and do NOT count it against the budget —
  move `BUILT=$((BUILT+1))` under the non-2 arms); anything else →
  `_gs_row "$tree" "$BUILD_OUTCOME" "$BUILD_REASON" "$dur"`.
  **Pin the exact 0.9.9 shrink message once during this task:** run
  `grep -n 'shrank\|shrink' ~/.local/lib/python3.12/site-packages/graphify/export.py | head -3`
  on the fleet box, copy the literal into the grep above (replace the loose `shrank\|shrink`), and
  note it in the script comment. A pin bump revisits this literal (O1's acceptance).
- [x] **Step 4: Run — PASS. Commit** —
  `git commit -m "feat(graphify): sweep build — timeout/shrink/failed discriminators, contained argv"`

---

### Task 8: Pre-build corpus guard + ephemeral `.graphifyignore`

**Files:**
- Modify: `ccd/ccd-graph-sweep` (replace `_gs_guard`)
- Test: `server/test/graph-sweep.test.ts` (extend)

**Interfaces:**
- Consumes: `$VENV/bin/python` (graphify importable — in tests, a fake `python` in the venv bin),
  optional per-repo noise list `~/.ccrc/graph-noise/<repo-basename>.list` (operator-owned runtime
  DATA, like `accounts.json` — no repo-specific path ships in source).
- Produces: guard verdict + `GUARD_REASON`; `.graphifyignore` written before / removed after each
  build (trap'd); stray-file cleanup.

- [x] **Step 1: Failing tests:**

```ts
describe('graph-sweep: corpus guard (Task 8)', () => {
  // the fake venv python implements the guard protocol: it prints the corpus,
  // one path per line, reading fixture file corpus-paths if present.
  function plantGuardPython(): void {
    const bin = j('.ccrc', 'graphify-venv', 'bin');
    fs.writeFileSync(path.join(bin, 'python'), `#!/bin/bash
# fake detect(): echo the fixture corpus (paths relative to cwd)
cat "$HOME/fixture-corpus" 2>/dev/null || true
`, { mode: 0o755 });
  }
  it('row 2 — an untracked corpus path refuses the BUILD (previous graph untouched)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    runSweep();                                                     // seed a good graph
    const seeded = fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs;
    git(repo, 'commit', '-qm', 'move', '--allow-empty');
    fs.writeFileSync(path.join(repo, 'poison.py'), 'x');            // untracked, would enter corpus
    fs.writeFileSync(j('fixture-corpus'), 'a.py\npoison.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs).toBe(seeded);
  });
  it('row 19 — graphify-out/memory/ is exempt (a tree that answered queries still builds)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(path.join(repo, 'graphify-out', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'graphify-out', 'memory', 'q1.md'), 'q');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\ngraphify-out/memory/q1.md\n');
    runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
  });
  it('row 3 — a "!" line in the noise list refuses the build', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n!secrets.md\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repo).reason).toContain('!');
  });
  it('rows 11a+11b — .graphifyignore is written for the build, removed after, and harmless if orphaned', () => {
    const repo = makeRepo('alpha'); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    // the engine snapshots the file's presence mid-build:
    plantEngine('cp .graphifyignore "$HOME/gfxignore-during" 2>/dev/null || true');
    runSweep();
    expect(fs.readFileSync(j('gfxignore-during'), 'utf8')).toContain('fixtures/');
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);   // removed after
    // 11b: an orphan does not dirty the tree (excluded by D')
    fs.writeFileSync(path.join(repo, '.graphifyignore'), 'stray');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // and the next pass sweeps the stray even when the tree is fresh:
    runSweep();
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);
  });
});
```

- [x] **Step 2: Run — FAIL.**
- [x] **Step 3: Replace `_gs_guard`:**

```bash
# Pre-build corpus guard (spec §E): there is NO publish seam — to_json writes
# graph.json in place — so the only refusal that protects the previous graph
# is refusing to RUN the build. Corpus definition: every detect() path must be
# git-tracked; graphify-out/memory/ is exempt (detect.py:1101 re-adds it by
# design and it is untracked by design).
GUARD_REASON=""
_gs_guard() {
  local tree="$1" repo noise="" line
  repo="$(basename "$(git -C "$tree" rev-parse --path-format=absolute --git-common-dir | xargs dirname)")"
  # stray filter from a crashed pass: remove it BEFORE measuring anything
  rm -f "$tree/.graphifyignore"
  if [ -f "$HOME/.ccrc/graph-noise/$repo.list" ]; then
    noise="$HOME/.ccrc/graph-noise/$repo.list"
    if grep -q '^!' "$noise"; then
      GUARD_REASON="noise list $noise carries a '!' line — a negation re-includes gitignored files (spec §3.6); refusing"
      return 1
    fi
    { echo "# generated by ccd-graph-sweep for one build — never committed, never edited"
      grep -v '^\s*$' "$noise"; } > "$tree/.graphifyignore"
    trap 'rm -f "$tree/.graphifyignore"' EXIT INT TERM
  fi
  local corpus tracked breach
  corpus="$(cd "$tree" && "$VENV/bin/python" - <<'PY' 2>/dev/null
import os
from pathlib import Path
from graphify.detect import detect
r = detect(Path('.')); root = os.path.abspath('.')
for k in ('code','document','paper','image','video'):
    for f in r['files'].get(k, []):
        print(os.path.relpath(f, root))
PY
)" || { GUARD_REASON="detect() failed in $tree"; return 1; }
  tracked="$(git -C "$tree" ls-files)"
  breach="$(comm -23 <(sort -u <<<"$corpus") <(sort -u <<<"$tracked") \
            | grep -v '^graphify-out/memory/' | head -5 || true)"
  if [ -n "$breach" ]; then
    GUARD_REASON="untracked paths entered the corpus: $(tr '\n' ' ' <<<"$breach")"
    rm -f "$tree/.graphifyignore"
    return 1
  fi
  return 0
}
```

  Cleanup after the build: in the pass loop, after `_gs_build` returns, `rm -f "$tree/.graphifyignore"`
  and `trap - EXIT INT TERM` (the trap covers the crash window only). Note the fake venv `python`
  ignores stdin and echoes the fixture corpus — the real one runs the heredoc; both satisfy the
  same contract.
- [x] **Step 4: Run — PASS. Commit** —
  `git commit -m "feat(graphify): pre-build corpus guard, noise lists, no-! rule, ephemeral filter"`

---

### Task 9: Idle gate — tmux-free resolver, audit token, escape hatch

**Files:**
- Modify: `ccd/ccd-graph-sweep` (replace `_gs_busy`)
- Test: `server/test/graph-sweep.test.ts` (extend)

**Interfaces:**
- Consumes: **Task 0's recorded resolver** (default below assumes it confirmed:
  `<tree>` → `$REG/<id>.workdir` → `$REG/<id>.hookstate.json .pid` → `<cfg>/sessions/<pid>.json`);
  `~/.ccrc/accounts.sh` for `_ccrc_cfg_dir`; Task 0's audit-token filename for O5.
- Produces: `BUSY_OUTCOME` ∈ `skipped-busy | skipped-audit`, `BUSY_REASON`. R2 discipline: reads
  only — any write under `$REG` from this function is a defect.

- [x] **Step 1: Failing tests:**

```ts
describe('graph-sweep: idle gate (Task 9)', () => {
  function plantSession(tree: string, state: string, opts: { fresh?: boolean } = {}): void {
    const reg = j('.cc-sessions'); fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'alpha-ws1.workdir'), tree + '\n');
    fs.writeFileSync(path.join(reg, 'alpha-ws1.wrapper'), 'claude\n');
    fs.writeFileSync(path.join(reg, 'alpha-ws1.hookstate.json'),
      JSON.stringify({ pid: 4242, state: { state } }));
    // live status file at the resolver's destination (Task 0-confirmed shape):
    const cfg = j('.claude'); fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'sessions', '4242.json'),
      JSON.stringify({ state: state === 'working' ? 'working' : 'idle' }));
    if (opts.fresh === false) {
      const old = Date.now() / 1000 - 3600;
      fs.utimesSync(path.join(reg, 'alpha-ws1.hookstate.json'), old, old);
    }
    // seedAccountsSh(home) provides _ccrc_cfg_dir (call it in this describe's beforeEach).
    // 'claude' + '.claude' here MUST be an id/configDirSuffix pair that exists in
    // DEFAULT_TEST_ROSTER — check server/test/helpers.ts and substitute the real
    // first account's id and suffix if they differ.
  }
  it('a working session defers its tree as skipped-busy', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantSession(repo, 'working');
    runSweep();
    expect(outcomeOf(repo)).toBe('skipped-busy');
  });
  it('an idle session builds; a STALE hookstate (>30 min) is treated as idle', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantSession(repo, 'working', { fresh: false });
    runSweep();
    expect(outcomeOf(repo)).toBe('never-built');
  });
  it('O3 — the escape hatch overrides busy at >=20 commits behind', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                    // seed
    for (let i = 0; i < 20; i++) git(repo, 'commit', '-qm', `c${i}`, '--allow-empty');
    plantSession(repo, 'working');
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('O5 — an outstanding audit token defers the tree as skipped-audit', () => {
    const repo = makeRepo('alpha'); plantEngine();
    plantSession(repo, 'idle');
    // Task 0 step 5 recorded the audit artifact name; the fixture writes THAT file:
    fs.writeFileSync(j('.cc-sessions', 'alpha-ws1.audit'), 'digest\n');   // ADJUST per Task 0
    runSweep();
    expect(outcomeOf(repo)).toBe('skipped-audit');
  });
});
```

- [x] **Step 2: Run — FAIL** (stub never reports busy).
- [x] **Step 3: Replace `_gs_busy`** (adjust the two ADJUST lines to Task 0's findings):

```bash
# Idle gate (spec §C.5 + R2). READ-ONLY against $REG. Authority is the live
# status file; hookstate is the pointer to it plus a freshness guard — gating
# on hookstate.state alone is bug F6b, already fixed once (watch.ts:2029-2041).
: "${CCRC_GRAPH_HOOKSTATE_FRESH_SECS:=1800}"
BUSY_OUTCOME=""; BUSY_REASON=""
_gs_busy() {
  local tree="$1" id="" wd hs pid wrapper cfg sf now age
  for wd in "$REG"/*.workdir; do
    [ -f "$wd" ] || return 1
    if [ "$(cat "$wd")" = "$tree" ]; then id="$(basename "$wd" .workdir)"; break; fi
  done
  [ -n "$id" ] || return 1                       # no session on this tree -> idle
  # O5: an outstanding ws-audit consent token defers the tree (ADJUST filename per Task 0):
  if ls "$REG/$id".audit* >/dev/null 2>&1; then
    BUSY_OUTCOME=skipped-audit; BUSY_REASON="outstanding ws-audit token"; return 0
  fi
  hs="$REG/$id.hookstate.json"
  [ -f "$hs" ] || return 1
  now=$(date +%s); age=$(( now - $(stat -c %Y "$hs") ))
  [ "$age" -le "$CCRC_GRAPH_HOOKSTATE_FRESH_SECS" ] || return 1   # stale pointer -> idle
  pid="$(jq -r '.pid // empty' "$hs" 2>/dev/null)"; [ -n "$pid" ] || return 1
  wrapper="$(cat "$REG/$id.wrapper" 2>/dev/null)"; [ -n "$wrapper" ] || return 1
  # shellcheck source=/dev/null
  source "$HOME/.ccrc/accounts.sh" 2>/dev/null || return 1
  cfg="$(_ccrc_cfg_dir "$wrapper" 2>/dev/null)" || return 1
  sf="$cfg/sessions/$pid.json"
  [ -f "$sf" ] || return 1
  [ "$(jq -r '.state // empty' "$sf" 2>/dev/null)" = working ] || return 1
  # O3 escape hatch: bounded staleness beats politeness past the thresholds.
  local built commits stamp_age
  built="$(jq -r '.built_at_commit // empty' "$tree/graphify-out/graph.json" 2>/dev/null)"
  if [ -n "$built" ]; then
    commits="$(git -C "$tree" rev-list --count "$built..HEAD" 2>/dev/null || echo 0)"
    stamp_age=$(( now - $(stat -c %Y "$tree/graphify-out/.graphify_engine" 2>/dev/null || echo "$now") ))
    if [ "$commits" -ge "$CCRC_GRAPH_STALE_ESCAPE_COMMITS" ] \
       || [ "$stamp_age" -ge "$CCRC_GRAPH_STALE_ESCAPE_SECS" ]; then
      return 1                                   # build anyway
    fi
  fi
  BUSY_OUTCOME=skipped-busy; BUSY_REASON="session $id working"
  return 0
}
```

  Test setup note: this describe's `beforeEach` must also call `seedAccountsSh(home)`
  (import from `./ccdWsHelpers.js`) so `_ccrc_cfg_dir` resolves the fixture wrapper.
- [x] **Step 4: Run — PASS. Commit** —
  `git commit -m "feat(graphify): idle gate — tmux-free resolver, audit token (O5), escape hatch (O3)"`

---

### Task 10: Units, install/uninstall/deploy wiring, hook removal (O6b)

**Files:**
- Create: `deploy/systemd/ccd-graph-sweep.service`, `deploy/systemd/ccd-graph-sweep.timer`
- Modify: `ccd/ccrc` (`_inst_bins` graphify-sweep arm if bins are listed there — check
  `grep -n '_inst_bins' ccd/ccrc`; `_inst_units`; `_inst_enable`; `_uninst_units`; new
  `_inst_graph_hooks_off`)
- Modify: `deploy/deploy.sh` (agent lane)
- Test: extend `server/test/ccrc-install.test.ts` (UNIT_FILES table), `server/test/ccrc-uninstall.test.ts`,
  `server/test/ccrc-install-graphify.test.ts` (hook removal), `agent/test/deploy-verify.test.ts` if it
  pins the agent-lane order.

**Interfaces:**
- Consumes: Task 0 step 4's hook-file inventory; Tasks 6–9's sweep.
- Produces: the timer live on fleet/both boxes; the 9 legacy graphify git hooks removed.

- [x] **Step 1: Unit files** (mirror `deploy/systemd/ccd-cap-scopes.*`):

```ini
# deploy/systemd/ccd-graph-sweep.service
[Unit]
Description=Per-tree AST graph refresh sweep (graphify, spec 2026-08-27)
[Service]
Type=oneshot
ExecStart=%h/.local/bin/ccd-graph-sweep
# budget 8 x 600s builds + probe overhead; a pass past this is wedged, not slow
TimeoutStartSec=5400
MemoryMax=4G
```

```ini
# deploy/systemd/ccd-graph-sweep.timer
[Unit]
Description=Run the graph sweep every 15 minutes (O3)
[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
AccuracySec=1min
[Install]
WantedBy=timers.target
```

- [x] **Step 2: Failing tests.** (a) `ccrc-install.test.ts`: add
  `['ccd-graph-sweep.service', 'deploy/systemd/ccd-graph-sweep.service']` and the `.timer` row to
  `UNIT_FILES` — but ROLE-GATED: on a `--role server` box these two must NOT land (add one
  assertion in the units describe: install with `--role server` leaves both absent; the four
  existing units still land). (b) `ccrc-uninstall.test.ts`: extend the disable/rm expectations with
  both sweep units. (c) hook removal test in `ccrc-install-graphify.test.ts`:

```ts
it('O6(b): removes a wholly-graphify post-commit hook, refuses a chained one', () => {
  const home = freshBox('ccrc-inst-gfx-hooks-');
  plantFakeVenv(home);
  const repo = makeFixtureRepo(home, 'projects/hooked');       // helper as in Task 4's test
  const hooks = path.join(repo, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  // Task 0 step 4 records the real marker line; use it verbatim here:
  fs.writeFileSync(path.join(hooks, 'post-commit'),
    '#!/bin/sh\n# generated by graphify hook install\nexec python3 -m graphify.hooks\n', { mode: 0o755 });
  fs.writeFileSync(path.join(hooks, 'post-checkout'),
    '#!/bin/sh\necho mine\n# graphify appended below\npython3 -m graphify.hooks\n', { mode: 0o755 });
  const r = runInstall(home, ['install']);
  expect(fs.existsSync(path.join(hooks, 'post-commit'))).toBe(false);        // wholly ours: removed
  expect(fs.existsSync(path.join(hooks, 'post-checkout'))).toBe(true);       // chained: kept
  expect(r.stdout + r.stderr).toContain('post-checkout');                    // ...and reported
  // idempotent + backed up:
  const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
  expect(backups.length).toBe(1);
});
```

- [x] **Step 3: Implement.**
  `_inst_units` — append, gated:

```bash
  if [ "$INST_ROLE" != server ]; then
    _inst_atomic "$tree/deploy/systemd/ccd-graph-sweep.service" "$dir/ccd-graph-sweep.service" 644
    _inst_atomic "$tree/deploy/systemd/ccd-graph-sweep.timer" "$dir/ccd-graph-sweep.timer" 644
  fi
```

  `_inst_enable` — beside the cap-scopes enable (find it: `grep -n 'cap-scopes' ccd/ccrc`), gated
  the same way: `[ "$INST_ROLE" = server ] || systemctl --user enable --now ccd-graph-sweep.timer || …`
  (degrade like siblings, not die — copy the adjacent line's error idiom).
  `_uninst_units` — add `ccd-graph-sweep.timer ccd-graph-sweep.service` to the disable loop and both
  names to the `rm -f` list.
  `_inst_bins` — ship `ccd/ccd-graph-sweep` to `~/.local/bin/ccd-graph-sweep` 755 (mirror the
  `ccd-cap-scopes` line found by `grep -n 'ccd-cap-scopes' ccd/ccrc`).
  `_inst_graph_hooks_off` (new, spine after `_inst_graph_excludes`):

```bash
# O6(b): the legacy graphify git hooks are UNCONTAINED (detached Popen, no
# nice/MemoryMax/slice, 16-way fan-out mid-wave) and their interpreter is
# pinned at install time to a path the venv replaces. Remove hooks that are
# WHOLLY graphify-generated; refuse (and report) any that chain other content.
_inst_graph_hooks_off() {
  [ "$INST_ROLE" = server ] && return 0
  local roots=("$HOME/projects" "$HOME/worktrees") root d hooks h n=0 kept=0
  local ts backups
  ts=$(date +%Y%m%d-%H%M%S); backups="$HOME/ccrc-backups/$ts"
  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    for d in "$root"/*/ "$root"/*/*/; do
      [ -d "$d" ] || continue
      git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
      hooks="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir)/hooks"
      for h in "$hooks"/post-commit "$hooks"/post-checkout; do
        [ -f "$h" ] || continue
        grep -qi graphify "$h" || continue
        # wholly graphify-generated: every non-shebang, non-empty line is
        # graphify's (ADJUST the marker to Task 0 step 4's recorded shape)
        if grep -vE '^#!|^\s*$' "$h" | grep -qv graphify; then
          echo "install: graphify: $h chains non-graphify content — left in place; remove by hand" >&2
          kept=$((kept+1)); continue
        fi
        mkdir -p "$backups"
        cp -a "$h" "$backups/$(echo "$h" | tr / _)" && rm -f "$h" && n=$((n+1))
      done
    done
  done
  echo "install: graphify: legacy git hooks — $n removed (backed up), $kept chained ones reported"
}
```

  `deploy/deploy.sh` agent lane — beside the cap-scopes lines (`:635`, `:652-667`, `:731-736`):
  `install_atomic ccd/ccd-graph-sweep .local/bin/ccd-graph-sweep 755`; add both unit `cp`s to
  `AGENT_BUILD_CMD`; add `systemctl --user enable --now ccd-graph-sweep.timer` to `AGENT_CMD`;
  `install_atomic ccd/install-graphify-skill.sh .cc-sessions/install-graphify-skill.sh 755` + a
  remote `bash ~/.cc-sessions/install-graphify-skill.sh` AFTER the worker-skill arm (`:695-715`).
- [x] **Step 4: Run all four touched suites — PASS. Commit** —
  `git commit -m "feat(graphify): sweep units + deploy wiring + legacy hook removal (O6b)"`

---

### Task 11: Doctor — `_check_graphify`

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (table entry + function)
- Test: `server/test/ccrc-doctor-graphify.test.ts` (new; reuse `ccrc-doctor.test.ts`'s `healthy()` /
  `stub()` / `lineFor()` idiom — import or mirror per that file's own convention)

**Interfaces:**
- Consumes: `~/.ccrc/graphify-venv`, `~/.ccrc/graphify.pin`, `~/.ccrc/graph-sweep.json`, roster
  homes' `.graphify_version`, `_dr_join`/`_dr_skip`/`_dr_pass`/`_dr_warn`/`_dr_fail`,
  `_box_env_value` for `CCRC_ROLE`.
- Produces: verdict line `(PASS|WARN|FAIL|SKIP) graphify: …`; closes **D-995** (WORKTREES_ROOT df
  arm) and **D-997** (skill drift visible).

- [x] **Step 1: Failing tests** (each starts from `healthy()` + a planted-healthy graphify fixture,
  breaks ONE thing):

```ts
function graphifyHealthy(home: string): void {
  const venvBin = join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(venvBin, { recursive: true });
  writeFileSync(join(venvBin, 'graphify'),
    '#!/bin/sh\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  for (const d of ['.claude', '.claude-personal']) {
    const s = join(home, d, 'skills', 'graphify');
    mkdirSync(s, { recursive: true });
    writeFileSync(join(s, '.graphify_version'), '0.9.9');
  }
  writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
    started: new Date().toISOString(), finished: new Date().toISOString(),
    pin: '0.9.9', status: 'ok', trees: [] }] }));
}

describe('ccrc doctor: graphify', () => {
  it('passes on the healthy fixture', () => {
    const home = healthy('ccrc-doctor-gfx-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^PASS graphify:/);
  });
  it('SKIPs (rc 3 semantics) on a server-role box', () => {
    const home = healthy('ccrc-doctor-gfx-srv-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');   // mirror how healthy() writes it
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^SKIP graphify:/);
  });
  it('FAILs naming the home when a rostered skill stamp is missing (D-997)', () => {
    const home = healthy('ccrc-doctor-gfx-drift-'); graphifyHealthy(home);
    rmSync(join(home, '.claude-personal', 'skills', 'graphify'), { recursive: true });
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^FAIL graphify:/);
    expect(line).toContain('.claude-personal');
  });
  it('WARNs on version drift between engine and pin', () => {
    const home = healthy('ccrc-doctor-gfx-ver-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.50\n');
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });
  it('reds on a probed-zero last pass (the cap-scopes 13-day failure, made visible)', () => {
    const home = healthy('ccrc-doctor-gfx-zero-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({ passes: [{
      started: 's', finished: 'f', pin: '0.9.9', status: 'probed-zero', trees: [] }] }));
    expect(lineFor(runDoctor(home).stdout, 'graphify')).toMatch(/^FAIL graphify:/);
  });
  it('D-995: WARNs when the worktrees device is tight even though $HOME is roomy', () => {
    const home = healthy('ccrc-doctor-gfx-disk-'); graphifyHealthy(home);
    // extend stubDf: a second fixture file fixture-df-avail-worktrees answers df on ~/worktrees
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'fixture-df-avail-worktrees'), String(3 * 1024 * 1024)); // 3 GiB
    const line = lineFor(runDoctor(home).stdout, 'graphify');
    expect(line).toMatch(/^WARN graphify:/);
    expect(line).toContain('worktrees');
  });
});
```

  (Extend `stubDf` in the shared doctor-test helpers so a `df -Pk <path under ~/worktrees>` answers
  from `fixture-df-avail-worktrees` — same fixture-file convention the existing stub uses.)
- [x] **Step 2: Run — FAIL** (`graphify` not in the table; the table-vs-functions meta-test in
  `ccrc-doctor.test.ts` will ALSO fail once the entry exists without the function — that pair is
  the mutation coverage for the registration itself).
- [x] **Step 3: Implement.** Add `graphify` to `CCRC_DOCTOR_CHECKS` (after `wrappers`); write
  `_check_graphify` on the `_check_wrappers` shape — findings arrays, `_dr_join`, worst-class
  return. Conditions, each ONE finding string: (1) `CCRC_ROLE=server` → `_dr_skip` and return 3;
  (2) engine: `$HOME/.ccrc/graphify-venv/bin/graphify --version` vs the pin stamp — missing venv or
  mismatch is FAIL, remedy `run: ccrc install`; (3) PATH shadow: `command -v graphify` non-empty
  and ≠ the venv path → WARN naming both paths (only the operator can clear a root-owned link);
  (4) skills: for each roster home (realpath-de-duped), compare `skills/graphify/.graphify_version`
  to the pin — missing/mismatched homes FAIL, named; (5) excludes: count trees failing
  `git check-ignore -q graphify-out` → WARN with the count and `ccrc install` as remedy;
  (6) census: absent file → WARN "sweep has never run"; last pass `status` ∈
  {`probed-zero`} → FAIL; `finished` older than 3× the 15-min interval → WARN "timer not firing";
  (7) D-995: `df -Pk "$HOME/worktrees"` (or PROJECTS root if worktrees absent) with `_check_disk`'s
  exact parse-and-floor idiom (2 GiB FAIL / 10 GiB WARN), finding text naming the device.
- [x] **Step 4: Activate Task 1's `.todo` census-path row** in `single-definition.test.ts` (the
  sweep + doctor now both exist as the only two spellers).
- [x] **Step 5: Run doctor suites + single-definition — PASS. Commit** —
  `git commit -m "feat(graphify): doctor check — engine/skills/excludes/census/worktrees-disk (D-995, D-997)"`

---

### Task 12: Integration gate, README, first-pass rollout

**Files:**
- Modify: `server/test/graph-sweep.test.ts` (venv-gated integration describe)
- Modify: `README.md` (one subsection)
- No deploy in this task — deploy is the operator-gated step at the end.

**Interfaces:**
- Consumes: everything above, green.

- [x] **Step 1: Venv-gated integration tests** (rows 5b + 18 behavioural). Gate on the REAL engine:

```ts
const realVenv = process.env.CCRC_GRAPHIFY_TEST_VENV;   // set on the fleet box only
const itVenv = realVenv && fs.existsSync(path.join(realVenv, 'bin', 'graphify')) ? it : it.skip;

describe('graph-sweep: real-engine integration (venv-gated; quiet-box CI is the arbiter)', () => {
  // A copied venv still runs: bin/graphify's shebang names the SOURCE venv's
  // python by absolute path, so the copy delegates to the real interpreter and
  // site-packages. The fixture only needs the entrypoint at its own $HOME path.
  const useRealEngine = () => {
    fs.cpSync(realVenv!, j('.ccrc', 'graphify-venv'), { recursive: true });
    const v = execFileSync(path.join(realVenv!, 'bin', 'graphify'), ['--version'],
      { encoding: 'utf8' }).trim().split(' ')[1];
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), v + '\n');
  };
  itVenv('row 5b — NO_BACKUP suppresses the dated dir on an armed (semantic-marked) store', () => {
    const repo = makeRepo('semantic');
    fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'graphify-out', '.graphify_semantic_marker'), '');
    useRealEngine();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '300' });
    const dated = fs.readdirSync(path.join(repo, 'graphify-out'))
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
    expect(dated).toEqual([]);                    // export.py:45 honoured end-to-end
  });
  itVenv('row 18 behavioural — GRAPHIFY_MAX_WORKERS bounds the extraction pool', () => {
    const repo = makeRepo('busy50');
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(repo, `m${i}.py`), `x${i} = ${i}\n`);
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'files');
    useRealEngine();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '300', CCRC_GRAPH_MAX_WORKERS: '1' });
    const log = fs.readFileSync(j('.ccrc', 'graph-sweep.log'), 'utf8');
    expect(log).toMatch(/\[1 workers?\]/);       // graphify logs "[N workers]"
  });
});
```
- [x] **Step 2: Full suite gate.** `cd server && npm run test` (foreground, ≥600000ms), then
  `cd agent && npm run test`, `cd pwa && npm run test`. Known load-flakes re-run in isolation
  before calling anything broken (project CLAUDE.md list).
- [x] **Step 3: README.** Add a "Graph layer (graphify)" subsection under the fleet-box tooling
  docs: what installs where (venv, skills, excludes, sweep timer), the pause file, the census path,
  the O7 reclaim line, and the pin-bump procedure (edit `GRAPHIFY_PIN`, run install, expect a
  full-fleet rebuild pass — O2 budget applies).
- [x] **Step 4: Deviations sweep.** Any deviation found during Tasks 1–11 that is not D-995..D-998:
  allocate via `ccd/ccrc-api ledger allocate` (count as needed, title naming this plan) and record
  in "## Deviations found" below — never invent a number, never write `D-TBD` into a diff.
- [x] **Step 5: Commit; hand to the operator for deploy.** Deploy is AGENT-FIRST
  (`bash deploy/deploy.sh agent <fleet-host>` then the server lane), from the workstation with the
  documented per-box overrides. First live pass: watch `~/.ccrc/graph-sweep.json` — expect
  `status: ok`, 8 builds per pass, ~60 trees converging over ~8 passes; `touch
  ~/.ccrc/graph-sweep-paused` is the brake. `ccrc doctor` exits 0 with the new check green.

---

## Deviations found

_(D-995..D-998 pre-allocated at plan time — see "Deviation block" above. Execution-time deviations
are appended here with ledger-allocated numbers.)_

- **D-1061** (Task 11) — the brief's plain-English doctor condition 6 ("census absent → WARN 'sweep
  has never run'") would desensitize a fresh install permanently: `OnBootSec=5min` guarantees no box
  has a census for at least five minutes, so the WARN could never be cleared by fixing anything —
  the exact failure mode D-139 exists to prevent. Implemented instead as a silent absent-census arm:
  `ccd/ccrc-doctor-checks:2565` (and the reused arm at `:2619`), tests at
  `server/test/ccrc-doctor-graphify.test.ts:291,297`. Already committed in source (Task 11).
- **D-1062** (Task 7) — the shrink-refusal literal the build discriminator greps for is pinned on
  `watch.py`'s `_check_shrink` ("Refusing to overwrite"), NOT `export.py` as the plan anchored:
  `export.py`'s own `to_json` shrink guard exists but is unreachable from the code path `graphify
  update .` actually runs (0.9.9). Fixed the `# D-N (Task 7)` placeholder to `# D-1062` at
  `ccd/ccd-graph-sweep:193`.
- **D-1063** (R-1) — `skipped-audit` is dropped from the census outcome vocabulary, amending D-998:
  `ws-audit` persists no on-disk artifact (Task 0's measurement), so there is nothing for the sweep
  to read to detect an "outstanding audit token" state; `ws-reap`'s own state-changed refusal is the
  fail-safe instead. `ccd/ccd-graph-sweep:73-74` (comment) — no `skipped-audit` outcome exists
  anywhere in the shipped sweep.
- **D-1064** (R-3) — the exclude gate is `git check-ignore -q graphify-out/` with a **trailing
  slash**; without it, every never-built tree refuses on pass 1 (the bare form matches a
  differently-shaped ignore rule than the one the exclude writer actually converges).
  `ccd/ccd-graph-sweep:230`; mirrored by the doctor check at `ccd/ccrc-doctor-checks:2539-2551`.
- **D-1065** (R-8) — the deploy skill arm is pin-gated: an ungated
  `bash ~/.cc-sessions/install-graphify-skill.sh` under `deploy.sh`'s `set -euo pipefail` aborted the
  entire agent lane on a box that had only ever run `deploy.sh agent` (no `~/.ccrc/graphify.pin`,
  since engine provisioning is `ccrc install`-only). A pinless box now defers loudly instead
  (`deploy/deploy.sh:728-737`); `deploy.sh` never provisions the engine itself — confirmed zero
  `_inst_graphify_engine`/venv references in that file (single-definition: the engine's one
  provisioning site stays `ccd/ccrc`).

## Task 0 findings

Measured 2026-08-28 on `openclaw` (live fleet box), read-only. Full commands + raw output:
`.superpowers/sdd/2026-08-28-graphify-fleet-integration/task-0-report.md`.

**Resolver verdict: CONFIRMED.** Chain `<id>.hookstate.json` (pid) → `<id>.wrapper` →
`_ccrc_cfg_dir` (`~/.ccrc/accounts.sh`) → `<cfg>/sessions/<pid>.json` resolved for 6/6 fresh
(mtime < 30 min) registry entries — the sessions actually live at measurement time, out of 23
total registry entries (17 stale, 3 of which show `exists=NO`, expected for dead sessions). Cross-
checked 1 of the 6 (`claude-rp-llm`) against ccd's own tmux pane-pid derivation
(`ccd/ccd:10492-10493`, one `tmux list-panes` call): pid and resulting status-file path matched
byte-for-byte. `<id>.wrapper` is confirmed a genuine registry field (present in the field-suffix
enumeration `ls ~/.cc-sessions/ | sed 's/^[^.]*\.//' | sort -u`); no substitute derivation was
needed. **R2 gap: none.** The resolver touches only `<id>.hookstate.json`, `<id>.wrapper` (plus
`<id>.workdir`, informational-only), and the live status file under the wrapper home's `sessions/`
— entirely inside R2's set. Task 9 needs no R2 extension.

**Hook inventory (all 9 repos: `claude-skills`, `custom-tools`, `data-internal`,
`expoAI-assistant`, `orchard-api-new-ts`, `intake-platform`, `OpenClawHetzner`, `rp-llm`,
`synapsium-platform`):**

| Repo | post-commit | post-checkout | Wholly graphify-gen? | `_PINNED` interpreter |
|---|---|---|---|---|
| all 9 (identical) | present, 9134 B, md5 `a91bed8b…914a` | present, 8541 B, md5 `92c4cde1…4873` | yes — shebang then `# graphify-hook-start`/`# graphify-checkout-hook-start` on line 2, closes at a matching `…-hook-end` marker, nothing chained before/after | `/usr/bin/python3` |

Both files are byte-identical across all 9 repos (md5sum). No other `.git/hooks/` file is present
or graphify-related in any of the 9. Both hooks skip during rebase/merge/cherry-pick; `post-commit`
also honors `GRAPHIFY_SKIP_HOOK=1`; `post-checkout` only fires on an actual branch switch and only
if `graphify-out/` already exists. Both launch the rebuild detached (`start_new_session=True`),
logging to `${HOME}/.cache/graphify-rebuild.log`.

**Audit-token artifact: none exists.** `cmd_ws_audit` (`ccd/ccd:7344`) is documented in its own
header as creating "no worktree, no branch, no registry field, no tombstone." Traced the token:
`REAP_TOKEN` (`ccd/ccd:7337`) comes from `_ws_fingerprint` (`ccd/ccd:6380`), a pure
`printf … | sha256sum` over 14 live-measured facts — no file read or write. `ws-audit` prints it to
stdout; `ws-reap --expect <token>` (`ccd/ccd:8296`) independently **recomputes** the same
fingerprint from current state and compares (`ccd/ccd:8792`) rather than reading anything the audit
wrote. Registry field-suffix enumeration confirms no `.audit`/`.token`/`.reap`/`.consent` field
exists in `~/.cc-sessions/`. Task 9's sweep and Task 10's uninstaller have no on-disk audit artifact
to discover or avoid — consent is carried only in the caller's copy-pasted token string, never
persisted.

**Task 12 rollout checklist (deploy is the operator's own step, AGENT-FIRST — this build ships no
verb that performs it):** `bash deploy/deploy.sh agent <fleet-host>` before the server lane; on the
fleet box, `ccrc install` (or `ccrc update`) provisions the engine, the skill, the excludes and turns
the legacy hooks off; `ccrc doctor` should exit 0 including the new `graphify` line; watch the first
sweep pass's census (`~/.ccrc/graph-sweep.json`) for `status: ok`; and, immediately before that
deploy, re-grep the fleet box's installed package for the shrink-refusal literal
(`ccd/ccd-graph-sweep`'s own comment at its shrink-discriminator check names the exact grep) in case
the pinned version's message has moved again.
