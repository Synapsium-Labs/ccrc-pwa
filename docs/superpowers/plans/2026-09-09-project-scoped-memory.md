# Project-scoped memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** One memory store per project at `~/.ccrc/memory/<slug>/`, shared by every agent home on the
box, so a session's durable memory survives the account/wrapper swap ccrc exists to make survivable.

**Architecture:** Three mechanisms, deliberately separated by what they are allowed to destroy.
`ccd/session-hook.sh` converges a `(home, project)` pair on SessionStart but **never merges data** — it
acts only where there is nothing to lose. `ccrc memory` is an explicit operator verb that performs the
one-time union, with backups and a no-silent-winner conflict rule. `ccrc doctor` reports any home that
is forked or unreachable, because the whole defect existed while a fork was silent.

**Tech Stack:** bash (`ccd/session-hook.sh`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`), vitest in
`server/`. No TypeScript source changes; no wire changes; no PWA changes.

**Spec:** `docs/superpowers/specs/2026-09-08-project-scoped-memory-design.md`

## Global Constraints

- **AGENT-FIRST.** This touches `ccd/`, so it ships to the fleet host **before** the server:
  `bash deploy/deploy.sh agent <fleet-host>` then `bash deploy/deploy.sh`.
- **`ccd/ccd` is not touched by this plan.** If any task ends up editing it, that file must be
  **re-stamped** or `ownership.test.ts` reds:
  `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`
- **Tests use FIXTURE HOMEs only.** Never run `ccrc`, the hook, or the migration against the live
  `$HOME`. `HOME` is the single isolation boundary the whole suite relies on.
- **Never run destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`,
  `ws-restore`). Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*` units.
- **Run suites in the FOREGROUND, timeout ≥600000ms**, from inside the package:
  `cd server && ./node_modules/.bin/vitest run test/foo.test.ts`. **Never bare `npx vitest`** — it
  resolves a global copy with no jsdom and falsely reports "no tests".
- **Mutation-table discipline:** every guard ships WITH a test measured RED when the guard is deleted
  or inverted. Measure it — break the code, run the suite, record the assertion text, restore.
- **No overloaded null at a seam.** The three convergence outcomes (converged / forked / unreachable)
  are three values, never two.
- **Node floor `>=22.13.0`**, identical across engines. Never lower engines to make a test green.
- **The store path carries no harness name.** `~/.ccrc/memory/<slug>/` — spec §4a. Nothing in this
  plan may read a model or provider name.

---

## The measurements this plan rests on

Re-taken **2026-09-09 09:42 UTC**. The spec requires these be re-taken again before execution; they
moved substantially in a single day.

| | value |
|---|---|
| agent homes (`~/.claude*` with a `projects/` dir, excluding `.claude-docserver`) | **8** |
| real memory directories (excluding `-tmp` slugs) | **40** |
| directories already symlinked | **8** (`.claude-corp` ×2, `.claude-personal` ×6) |
| distinct projects with memory | **13** |
| homes whose `settings.json` does NOT reference the session hook | **2** (`.claude-glm`, `.claude-kimi`) |
| `ccrc-pwa` union across its 5 homes | 66 instances, **57 distinct**, 52 unique, 5 colliding, **3 differing** |

Re-take command (read-only):

```bash
for h in ~/.claude*/; do
  b=$(basename "$h"); case "$b" in .claude-docserver) continue;; esac
  [ -d "$h/projects" ] || continue
  n=$(find "$h/projects" -maxdepth 2 -name memory -type d 2>/dev/null | grep -v '/-tmp' | wc -l)
  l=$(find "$h/projects" -maxdepth 2 -name memory -type l 2>/dev/null | wc -l)
  hk=$([ -f "$h/settings.json" ] && grep -q 'session-hook.sh' "$h/settings.json" 2>/dev/null && echo yes || echo NO)
  printf '%-18s dirs=%-3s links=%-3s hook=%s\n' "$b" "$n" "$l" "$hk"
done
```

---

## File Structure

| File | Responsibility |
|---|---|
| `ccd/session-hook.sh` (modify) | `_hook_memory_converge` — converge one `(home, project)` pair; never merge |
| `ccd/ccrc` (modify) | `cmd_memory` — the census (dry run) and `--apply` (the union), plus the usage line |
| `ccd/ccrc-doctor-checks` (modify) | `_check_memory` — three conditions, enumerated from the filesystem |
| `server/test/session-hook.test.ts` (modify) | every row of the convergence table, including the two do-not-touch rows |
| `server/test/ccrc-memory.test.ts` (create) | the census, the union, the conflict rule, the `MEMORY.md` rebuild |
| `server/test/ccrc-doctor.test.ts` (modify) | `_check_memory` PASS/FAIL in both directions |

---

## Task 1: The hook converges, and never merges

**Files:**
- Modify: `ccd/session-hook.sh` (add `_hook_memory_converge`; call it from the `SessionStart)` arm)
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: the hook's existing `$payload` variable (the raw JSON on stdin) and `$HOME`.
- Produces: `_hook_memory_converge` — takes no arguments, prints nothing, always returns 0.

**Background the implementer needs.**

`<slug>` is a pure function of the project path, and **a second implementation of it disagrees
silently** — the `remember` plugin's own README records this as issue #294: "a slug that misses names
a directory that does not exist, so the pipeline finds no transcript, exits 0, and saves nothing."

This task therefore **never computes a slug**. The SessionStart payload carries `transcript_path`,
which is `<config dir>/projects/<slug>/<uuid>.jsonl`. Its directory IS the pair being converged.
Match, never derive.

The emptiness test is `rmdir` itself: it succeeds only on an empty directory. Using its failure as the
test removes the check-then-act window a separate `ls` would open.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/session-hook.test.ts`. Note `mkTmp` gives a fixture `HOME`; the hook reads
`$HOME/.ccrc/memory`, so the whole test is contained.

```typescript
describe('memory convergence (spec 2026-09-08 §2)', () => {
  const SLUG = '-mnt-projects-demo';
  const projDir = (): string => path.join(home, '.claude-x', 'projects', SLUG);
  const link = (): string => path.join(projDir(), 'memory');
  const store = (): string => path.join(home, '.ccrc', 'memory', SLUG);
  const payload = (): object => ({
    hook_event_name: 'SessionStart',
    source: 'startup',
    cwd: '/mnt/projects/demo',
    transcript_path: path.join(projDir(), 'abc-123.jsonl'),
  });

  beforeEach(() => { fs.mkdirSync(projDir(), { recursive: true }); });

  it('creates the store and the symlink when no memory directory exists', () => {
    run(payload());
    expect(fs.lstatSync(link()).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link())).toBe(store());
    expect(fs.statSync(store()).isDirectory()).toBe(true);
  });

  it('replaces an EMPTY plain directory — there is nothing to lose', () => {
    fs.mkdirSync(link(), { recursive: true });
    run(payload());
    expect(fs.lstatSync(link()).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link())).toBe(store());
  });

  it('LEAVES a non-empty plain directory alone — the hook never merges data', () => {
    fs.mkdirSync(link(), { recursive: true });
    fs.writeFileSync(path.join(link(), 'a.md'), 'keep me');
    run(payload());
    expect(fs.lstatSync(link()).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(link(), 'a.md'), 'utf8')).toBe('keep me');
  });

  it('LEAVES a symlink pointing elsewhere alone — its target holds data', () => {
    const other = path.join(home, 'elsewhere');
    fs.mkdirSync(other, { recursive: true });
    fs.symlinkSync(other, link());
    run(payload());
    expect(fs.readlinkSync(link())).toBe(other);
  });

  it('is a no-op once converged — the steady state costs one test', () => {
    run(payload());
    const before = fs.lstatSync(link()).mtimeMs;
    run(payload());
    expect(fs.readlinkSync(link())).toBe(store());
    expect(fs.lstatSync(link()).mtimeMs).toBe(before);
  });

  it('does nothing at all when the payload carries no transcript_path', () => {
    const p: Record<string, unknown> = { ...payload() };
    delete p['transcript_path'];
    run(p);
    expect(fs.existsSync(link())).toBe(false);
  });

  it('skips a scratch slug — /tmp work accumulates no durable memory', () => {
    const tmpSlug = '-tmp-scratch';
    const d = path.join(home, '.claude-x', 'projects', tmpSlug);
    fs.mkdirSync(d, { recursive: true });
    run({ hook_event_name: 'SessionStart', source: 'startup',
          transcript_path: path.join(d, 'x.jsonl') });
    expect(fs.existsSync(path.join(d, 'memory'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'memory convergence'
```

Expected: FAIL — `ENOENT` on `lstatSync` for the create case, because nothing converges yet.

- [ ] **Step 3: Add the function to `ccd/session-hook.sh`**

Place it beside the other `_hook_*` builders, above the `case` that dispatches on the event. Locate by
content: put it immediately after `_hook_ccrc_card()`'s closing brace.

```bash
# ── memory convergence ────────────────────────────────────────────────────
# One memory store per PROJECT (`~/.ccrc/memory/<slug>`), not one per agent
# home. `$CLAUDE_CONFIG_DIR/projects/<slug>/memory` is per-home, so a session
# that swaps accounts mid-run keeps its transcript, workspace, hold and branch
# and silently changes memory stores — the one continuity ccrc exists to
# provide, missing. Measured 2026-09-08: 40 real memory directories across 8
# homes, and a session that read its own superseded record after a swap.
#
# THE SLUG IS READ, NEVER COMPUTED. `<slug>` is a pure function of the project
# path, and a second implementation of it disagrees SILENTLY: a slug that
# misses names a directory that does not exist, so the caller finds nothing,
# exits 0, and converges nothing (the `remember` plugin's own #294). The
# harness has already told us the answer — `transcript_path` is
# `<config dir>/projects/<slug>/<uuid>.jsonl` — so its DIRECTORY is the pair
# being converged. Match, never derive.
#
# THIS FUNCTION NEVER MERGES. It acts only where there is nothing to lose: an
# absent link, or a plain directory that is EMPTY. A directory with content and
# a symlink pointing somewhere else are both LEFT EXACTLY AS FOUND and reported
# by `ccrc doctor` instead — a hook that fires on every session start, ~20
# times over on this box, must never be the thing that merges data. `ccrc
# memory` owns that, as an explicit operator act.
#
# `rmdir` IS the emptiness test: it succeeds only on an empty directory, so its
# own failure is the answer and there is no check-then-act window between
# asking and acting.
#
# Silent and total: every failure path returns 0. A box where this cannot work
# still gets its cards, its hookstate and its nudges.
_hook_memory_converge() {   # -> converge this (home, project) pair; prints nothing; always 0
  local tp d slug link store
  tp=$(jq -r '.transcript_path // empty' <<<"$payload" 2>/dev/null) || return 0
  [ -n "$tp" ] || return 0
  d=$(dirname -- "$tp") || return 0
  [ -d "$d" ] || return 0
  slug=$(basename -- "$d") || return 0
  # A scratch cwd accumulates no durable memory. The harness mints a slug for
  # every directory a session is started in, including throwaway temp dirs
  # (measured: a dozen `-tmp-*` slugs in one home), and converging those would
  # fill the store with empty directories nobody will ever read.
  case "$slug" in -tmp*) return 0 ;; esac
  link="$d/memory"
  store="$HOME/.ccrc/memory/$slug"
  # Steady state first, and it is the whole cost on a converged box.
  if [ -L "$link" ]; then
    [ "$(readlink -- "$link" 2>/dev/null)" = "$store" ] && return 0
    return 0   # points elsewhere: its target holds data — doctor reports it
  fi
  if [ -e "$link" ]; then
    rmdir -- "$link" 2>/dev/null || return 0   # non-empty: leave it, doctor reports it
  fi
  mkdir -p -- "$store" 2>/dev/null || return 0
  ln -s -- "$store" "$link" 2>/dev/null || return 0
  return 0
}
```

*(This is the Step-3 snapshot as originally planned. **FALSIFIED 2026-09-09 (R32, final whole-branch
review) — see D-2178's rewritten entry below.** "THE SLUG IS READ, NEVER COMPUTED" is this snippet's
own headline rule, and reading `dirname(transcript_path)` as the pair to converge is exactly what
converges the wrong directory inside a git worktree — the modality this fleet runs in. The shipped
`_hook_memory_converge` computes the slug from the project root instead, and the existence check in
this same snapshot (`[ -d "$d" ]`, generalized to `[ -d "$projects/$slug" ]`) is what makes computing
it safe. Do not use this snippet as a reference for the shipped function's slug derivation; every
other row of its behaviour table below is otherwise still what shipped.)*

- [ ] **Step 4: Call it from the SessionStart arm**

In `ccd/session-hook.sh`, locate the `SessionStart)` arm by content — the line
`CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD=""` — and insert the call on the line **above** it:

```bash
    # Convergence is independent of the cards and of the hookstate write, and
    # must happen even for `source == compact` (which returns early below):
    # a compacted session is still a session whose home may be unconverged.
    _hook_memory_converge || true
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD=""
```

**Check the compact early-return.** If `source == compact` returns before this point, move the call
above that return. The comment above claims convergence survives compact; if the placement makes that
false, fix the placement, not the comment.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: PASS, and the file's pre-existing tests still pass.

- [ ] **Step 6: Measure the mutation table**

Perform each mutation, run `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`,
record the failing assertion text, then restore.

| # | Mutation | Must go RED on |
|---|---|---|
| M1 | delete the `rmdir ... \|\| return 0` guard and replace with `rm -rf -- "$link"` | "LEAVES a non-empty plain directory alone" |
| M2 | change the `[ -L "$link" ]` arm to re-point instead of returning | "LEAVES a symlink pointing elsewhere alone" |
| M3 | remove the `case "$slug" in -tmp*)` guard | "skips a scratch slug" |
| M4 | compute the slug from `.cwd` instead of reading `dirname(transcript_path)` | at least one create/replace case |

M4 is the important one: it is the exact defect the plugin's #294 records, and it must be
demonstrated to red rather than argued.

*(**Superseded 2026-09-09 (R32, final whole-branch review) — see D-2178's rewritten entry above.** M4
guarded the ORIGINAL rule, "the slug is read, never computed"; that rule is reversed in the shipped
function, so M4 as worded no longer describes a mutation of the shipped code. The shipped
`_hook_memory_converge` carries its own mutation table instead — reverting the slug derivation to the
old `dirname(transcript_path)` reading, deleting the `[ -d "$projects/$slug" ]` existence check, and
deleting the `*/projects` layout assertion — each measured RED against a real `git worktree add`
fixture in `server/test/session-hook.test.ts`.)*

- [ ] **Step 7: Verify the live-box syntax and commit**

```bash
bash -n ccd/session-hook.sh
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): converge a project's memory store, and never merge (D-2178)"
```

---

## Task 2: `ccrc memory` — the census, read-only

**Files:**
- Modify: `ccd/ccrc` (add `cmd_memory`; extend `usage()`)
- Test: `server/test/ccrc-memory.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; both read the same layout.
- Produces: `cmd_memory` with no arguments — prints one line per `(home, project)` pair and exits 0.
  Task 3 adds `--apply` to the same function.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccrc-memory.test.ts`. Follow `ccrc-doctor.test.ts`'s idiom for driving `ccrc`
inside a fixture HOME — read that file's `runDoctor`/`installCcrc` helpers and reuse the same shape
rather than inventing a second one.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const CCRC = path.resolve(__dirname, '../../ccd/ccrc');
let home: string;
beforeEach(() => { home = mkTmp('ccrc-memory-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (args: string[]): { code: number; out: string } => {
  const r = spawnSync('bash', [CCRC, ...args],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A home with one memory dir for one project. */
function seed(homeSuffix: string, slug: string, files: Record<string, string>): void {
  const d = path.join(home, homeSuffix, 'projects', slug, 'memory');
  fs.mkdirSync(d, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
}

describe('ccrc memory — the census', () => {
  it('names a home that holds a plain memory directory', () => {
    seed('.claude', '-p-demo', { 'a.md': 'x' });
    const r = run(['memory']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('.claude');
    expect(r.out).toContain('-p-demo');
  });

  it('enumerates homes from the FILESYSTEM, not the roster', () => {
    // `.claude-glm` is in no roster entry; it must still be reported.
    seed('.claude-glm', '-p-demo', { 'a.md': 'x' });
    expect(run(['memory']).out).toContain('.claude-glm');
  });

  it('reports a converged pair as converged, not as work to do', () => {
    const store = path.join(home, '.ccrc', 'memory', '-p-demo');
    fs.mkdirSync(store, { recursive: true });
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(store, path.join(d, 'memory'));
    expect(run(['memory']).out).toMatch(/converged/);
  });

  it('changes nothing on disk — the census is read-only', () => {
    seed('.claude', '-p-demo', { 'a.md': 'x' });
    run(['memory']);
    expect(fs.lstatSync(path.join(home, '.claude', 'projects', '-p-demo', 'memory'))
      .isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'memory'))).toBe(false);
  });

  it('ignores scratch slugs', () => {
    seed('.claude', '-tmp-scratch', { 'a.md': 'x' });
    expect(run(['memory']).out).not.toContain('-tmp-scratch');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-memory.test.ts
```

Expected: FAIL — `ccrc: unknown argument: memory` and exit 2.

- [ ] **Step 3: Add `cmd_memory` to `ccd/ccrc`**

Place it beside the other `cmd_*` functions; locate `cmd_wrappers()` by content and put it after that
function's closing brace.

```bash
# ── memory ────────────────────────────────────────────────────────────────
# One memory store per PROJECT, shared by every agent home on the box.
# `ccrc memory` is the CENSUS; `ccrc memory --apply` (Task 3) is the only thing
# that moves a byte. The split is deliberate: the union is irreversible in the
# sense that matters — a memory file is prose a session wrote once — so the
# operator sees exactly what would happen before it happens.
#
# HOMES ARE ENUMERATED FROM THE FILESYSTEM, NOT FROM THE ROSTER. Measured
# 2026-09-09: `.claude-glm` and `.claude-kimi` are on disk, hold memory, and
# are in no roster entry. The roster describes accounts ccrc PLACES WORK ON;
# it was never a census of homes, and using it as one is how the design's own
# first draft came to list five homes when there were eight.
_mem_homes() {   # -> one agent-home path per line
  local d
  for d in "$HOME"/.claude*/; do
    case "$(basename -- "${d%/}")" in .claude-docserver) continue ;; esac
    [ -d "${d}projects" ] || continue
    printf '%s\n' "${d%/}"
  done
}

_mem_state() {   # <home> <slug> -> converged | forked | absent
  local link="$1/projects/$2/memory" store="$HOME/.ccrc/memory/$2"
  if [ -L "$link" ]; then
    [ "$(readlink -- "$link" 2>/dev/null)" = "$store" ] && { printf 'converged'; return 0; }
    printf 'forked'; return 0
  fi
  [ -e "$link" ] && { printf 'forked'; return 0; }
  printf 'absent'
}

cmd_memory() {
  local apply=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --apply) apply=1; shift ;;
      *) _ccrc_usage_die "unknown argument: $1" ;;
    esac
  done
  local h b slug d state n=0 forked=0
  for h in $(_mem_homes); do
    b=$(basename -- "$h")
    for d in "$h"/projects/*/; do
      [ -d "$d" ] || continue
      slug=$(basename -- "${d%/}")
      case "$slug" in -tmp*) continue ;; esac
      [ -e "${d}memory" ] || continue
      state=$(_mem_state "$h" "$slug")
      n=$((n+1))
      [ "$state" = forked ] && forked=$((forked+1))
      printf '%-18s %-50s %s\n' "$b" "$slug" "$state"
    done
  done
  printf '\n%s pairs, %s forked\n' "$n" "$forked"
  [ "$apply" -eq 1 ] && _mem_apply
  return 0
}
```

Add `memory` to the usage line — locate `usage()` by content and extend its verb list:

```
usage: $PROG {doctor|status|adopt|wrappers|memory|install|update|uninstall|backup|logs|passwd|expose|version}
```

Register the verb in the dispatcher: locate the `case` that maps verbs to `cmd_*` (search for
`wrappers)` near `cmd_wrappers`) and add an arm matching the surrounding idiom exactly.

- [ ] **Step 4: Stub `_mem_apply` so the census runs**

```bash
_mem_apply() { echo "ccrc memory: --apply is not implemented yet" >&2; return 1; }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-memory.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 6: Measure the mutation table**

| # | Mutation | Must go RED on |
|---|---|---|
| M1 | `_mem_homes` enumerates a hardcoded roster list instead of globbing | "enumerates homes from the FILESYSTEM, not the roster" |
| M2 | `_mem_state` returns `converged` for any symlink, ignoring the target | "reports a converged pair as converged" (seed a wrong-target link) |
| M3 | remove the `-tmp*` skip | "ignores scratch slugs" |

- [ ] **Step 7: Commit**

```bash
bash -n ccd/ccrc
git add ccd/ccrc server/test/ccrc-memory.test.ts
git commit -m "feat(ccrc): a memory census that enumerates homes from disk (D-2179)"
```

---

## Task 3: `ccrc memory --apply` — the union, with no silent winner

**Files:**
- Modify: `ccd/ccrc` (implement `_mem_apply`)
- Test: `server/test/ccrc-memory.test.ts`

**Interfaces:**
- Consumes: `_mem_homes`, `_mem_state` from Task 2.
- Produces: `_mem_apply` — no arguments; unions every forked pair into its store, backs up each source
  directory, and replaces it with a symlink.

**The conflict rule, stated before the code.** A file unique to one home moves across unchanged. A
same-named file whose content **differs** is not resolved — **both are kept**, the incoming copy
suffixed with the home it came from — because a memory file is prose a session wrote once and
choosing between two of them is a judgement no script has the standing to make. `MEMORY.md` is the one
exemption: it is an *index*, one line per memory file, derived from each file's own `name` and
`description` frontmatter, so it is **rebuilt** from the union rather than merged. (**Corrected
2026-09-09, whole-branch review:** not every memory file carries that frontmatter — measured 6 of 801
fleet-wide — and the shipped rebuild (`ccd/ccrc`'s `_mem_rebuild_index`, R30) counts what it drops and
reports it rather than silently losing the line; see the spec's §3 correction for the full measurement.)

- [ ] **Step 1: Write the failing tests**

```typescript
describe('ccrc memory --apply — the union', () => {
  const storeDir = (): string => path.join(home, '.ccrc', 'memory', '-p-demo');
  const linkOf = (h: string): string =>
    path.join(home, h, 'projects', '-p-demo', 'memory');

  it('moves a file unique to one home into the store, and symlinks the home', () => {
    seed('.claude', '-p-demo', { 'only-here.md': 'body' });
    expect(run(['memory', '--apply']).code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'only-here.md'), 'utf8')).toBe('body');
    expect(fs.lstatSync(linkOf('.claude')).isSymbolicLink()).toBe(true);
  });

  it('unions two homes that hold different files', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    seed('.claude-corp', '-p-demo', { 'b.md': 'B' });
    run(['memory', '--apply']);
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(storeDir(), 'b.md'), 'utf8')).toBe('B');
  });

  it('KEEPS BOTH when the same filename differs — never picks a winner', () => {
    seed('.claude', '-p-demo', { 'same.md': 'first' });
    seed('.claude-corp', '-p-demo', { 'same.md': 'second' });
    run(['memory', '--apply']);
    const names = fs.readdirSync(storeDir()).sort();
    expect(names).toContain('same.md');
    expect(names.some((n) => n.startsWith('same.') && n.includes('claude-corp'))).toBe(true);
    const bodies = names.filter((n) => n.startsWith('same.'))
      .map((n) => fs.readFileSync(path.join(storeDir(), n), 'utf8')).sort();
    expect(bodies).toEqual(['first', 'second']);
  });

  it('deduplicates a byte-identical collision into ONE file', () => {
    seed('.claude', '-p-demo', { 'same.md': 'identical' });
    seed('.claude-corp', '-p-demo', { 'same.md': 'identical' });
    run(['memory', '--apply']);
    expect(fs.readdirSync(storeDir()).filter((n) => n.startsWith('same.')))
      .toEqual(['same.md']);
  });

  it('rebuilds MEMORY.md from frontmatter rather than merging it', () => {
    seed('.claude', '-p-demo', {
      'one.md': '---\nname: one\ndescription: the first\n---\nbody\n',
      'MEMORY.md': '- stale line that mentions nothing real\n',
    });
    seed('.claude-corp', '-p-demo', {
      'two.md': '---\nname: two\ndescription: the second\n---\nbody\n',
      'MEMORY.md': '- a different stale line\n',
    });
    run(['memory', '--apply']);
    const idx = fs.readFileSync(path.join(storeDir(), 'MEMORY.md'), 'utf8');
    expect(idx).toContain('one.md');
    expect(idx).toContain('the first');
    expect(idx).toContain('two.md');
    expect(idx).toContain('the second');
    expect(idx).not.toContain('stale line');
    expect(fs.readdirSync(storeDir()).filter((n) => n.startsWith('MEMORY.')))
      .toEqual(['MEMORY.md']);
  });

  it('backs up each source directory before replacing it', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    expect(fs.readdirSync(parent).some((n) => n.startsWith('memory.pre-ccrc-'))).toBe(true);
  });

  it('re-points a symlink that targets another HOME, not the store', () => {
    const other = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'a.md'), 'A');
    const d = path.join(home, '.claude-corp', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(other, path.join(d, 'memory'));
    run(['memory', '--apply']);
    expect(fs.readlinkSync(path.join(d, 'memory'))).toBe(storeDir());
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
  });

  it('is idempotent — a second run changes nothing and reports zero forked', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const before = fs.readdirSync(storeDir()).sort();
    const r = run(['memory', '--apply']);
    expect(fs.readdirSync(storeDir()).sort()).toEqual(before);
    expect(r.out).toMatch(/0 forked/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-memory.test.ts -t 'the union'
```

Expected: FAIL — `--apply is not implemented yet`, exit 1.

- [ ] **Step 3: Implement `_mem_apply`**

Replace the Task 2 stub in `ccd/ccrc`:

```bash
# THE CONFLICT RULE IS: NO SILENT WINNER. A file unique to one home moves
# across. A same-named file whose content DIFFERS keeps BOTH copies, the
# incoming one suffixed with the home it came from — a memory file is prose a
# session wrote once, and choosing between two of them is a judgement no script
# has the standing to make. A byte-identical collision is one file, not two:
# deduplicating what is provably the same costs the operator nothing to review.
#
# `MEMORY.md` IS EXEMPT BECAUSE IT IS DERIVABLE. It is an index of one line per
# memory file, and every memory file carries `name` and `description` in its
# own frontmatter — so it is REBUILT from the union rather than merged. That is
# also what makes the widened write contention self-healing: a clobbered index
# regenerates instead of silently losing a line, which is the exact failure
# that produced this design.
_mem_index_line() {   # <file> -> "- [name](file) — description", or nothing
  local f="$1" name desc
  name=$(sed -n 's/^name:[[:space:]]*//p' "$f" 2>/dev/null | head -n1)
  desc=$(sed -n 's/^description:[[:space:]]*//p' "$f" 2>/dev/null | head -n1)
  desc=${desc%\"}; desc=${desc#\"}
  [ -n "$name" ] || return 0
  printf -- '- [%s](%s) — %s\n' "$name" "$(basename -- "$f")" "$desc"
}

_mem_rebuild_index() {   # <store>
  local store="$1" f tmp="$1/.MEMORY.md.new"
  { printf '# Memory index\n\n'
    for f in "$store"/*.md; do
      [ -f "$f" ] || continue
      case "$(basename -- "$f")" in MEMORY.md) continue ;; esac
      _mem_index_line "$f"
    done
  } > "$tmp" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  mv -f -- "$tmp" "$store/MEMORY.md"
}

_mem_absorb() {   # <src-dir> <store> <home-basename>
  local src="$1" store="$2" tag="$3" f base dest
  for f in "$src"/*.md; do
    [ -f "$f" ] || continue
    base=$(basename -- "$f")
    case "$base" in MEMORY.md) continue ;; esac   # rebuilt, never merged
    dest="$store/$base"
    if [ ! -e "$dest" ]; then cp -p -- "$f" "$dest"; continue; fi
    cmp -s -- "$f" "$dest" && continue            # byte-identical: one file
    cp -p -- "$f" "$store/${base%.md}.$tag.md"    # differs: keep BOTH
  done
}

_mem_apply() {
  local h b slug d link store stamp bk
  stamp=$(date -u +%Y%m%d-%H%M%S)
  for h in $(_mem_homes); do
    b=$(basename -- "$h")
    for d in "$h"/projects/*/; do
      [ -d "$d" ] || continue
      slug=$(basename -- "${d%/}")
      case "$slug" in -tmp*) continue ;; esac
      link="${d}memory"
      [ -e "$link" ] || continue
      store="$HOME/.ccrc/memory/$slug"
      [ "$(_mem_state "$h" "$slug")" = converged ] && continue
      mkdir -p -- "$store" || { echo "ccrc memory: cannot create $store" >&2; return 1; }
      if [ -L "$link" ]; then
        # A link to another HOME: absorb its target, then re-point. The target
        # itself is some other home's real directory and is left standing —
        # that home converges on its own pass.
        _mem_absorb "$(readlink -- "$link")" "$store" "$b"
        rm -f -- "$link"
      else
        _mem_absorb "$link" "$store" "$b"
        bk="${d}memory.pre-ccrc-$stamp"
        mv -- "$link" "$bk" || { echo "ccrc memory: cannot back up $link" >&2; return 1; }
      fi
      ln -s -- "$store" "$link" || { echo "ccrc memory: cannot link $link" >&2; return 1; }
      _mem_rebuild_index "$store" || true
      echo "ccrc memory: converged $b $slug"
    done
  done
  return 0
}
```

*(This is the Step-3 snapshot as originally planned; the "Deviations found" section below and the
final whole-branch review carry everything that changed in `ccd/ccrc`'s shipped `_mem_apply` and its
helpers since — including, as `_mem_index_line`'s comment above overstates, that not every memory file
carries `name`/`description` frontmatter: see the spec's §3 correction.)*

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-memory.test.ts
```

Expected: PASS, 13/13.

- [ ] **Step 5: Measure the mutation table**

| # | Mutation | Must go RED on |
|---|---|---|
| M1 | in `_mem_absorb`, replace the differing-content arm with `cp -f` (last home wins) | "KEEPS BOTH when the same filename differs" |
| M2 | remove the `cmp -s` dedup arm so identical files also duplicate | "deduplicates a byte-identical collision into ONE file" |
| M3 | absorb `MEMORY.md` like any other file instead of rebuilding | "rebuilds MEMORY.md from frontmatter" |
| M4 | drop the backup `mv` and `rm -rf` the source instead | "backs up each source directory" |
| M5 | skip the `[ -L "$link" ]` arm so a foreign link is left in place | "re-points a symlink that targets another HOME" |

M1 is the one that matters most: it is the silent-winner behaviour the whole rule exists to forbid,
and it must be demonstrated red rather than argued.

- [ ] **Step 6: Commit**

```bash
bash -n ccd/ccrc
git add ccd/ccrc server/test/ccrc-memory.test.ts
git commit -m "feat(ccrc): union the memory stores, keeping both sides of a conflict (D-2180)"
```

---

## Task 4: `ccrc doctor` makes a fork — and an unreachable home — loud

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (add `_check_memory`)
- Modify: `ccd/ccrc` (register the check beside the others)
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Consumes: `_mem_homes` and `_mem_state` from Task 2 if they are reachable from the doctor file;
  if the two files do not share scope, re-derive the home glob locally and say so in a comment rather
  than sourcing across a boundary that does not exist today. **Measure which it is before writing.**
- Produces: `_check_memory` — the standard doctor contract: `_dr_pass` / `_dr_fail` with a remedy.

**Why three conditions and not two.** A home can be perfectly converged today and still be unable to
*stay* converged: `.claude-glm` and `.claude-kimi` carry a `settings.json` that does not reference
`~/.cc-sessions/session-hook.sh`, and `ccd/install-session-hooks.sh`'s DEFAULT (no-argv) home list is
built from `CCRC_ACCOUNTS` — the roster — so a home in no roster entry is never wired *by that default
run* (the installer also takes `--homes <dir>…`, unused by any `ccrc` verb — see D-2179's correction).
Collapsing "forked" and "unreachable" into one bucket would send the operator to the wrong remedy;
since R33 (final whole-branch review) they also carry different severities — forked is a WARN, and
only unreachable stays a FAIL — because a fork is the expected pre-migration state of every multi-home
box and an unreachable home is not.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/ccrc-doctor.test.ts`, using that file's existing `healthy()` fixture and
`runDoctor` helper.

```typescript
describe('_check_memory (spec 2026-09-08 §4)', () => {
  it('PASSes on a box where every pair is converged', () => {
    const home = healthy('ccrc-doctor-mem-ok-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/PASS memory/);
  });

  it('FAILs and names the home when a pair is forked', () => {
    const home = healthy('ccrc-doctor-mem-fork-');
    const d = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'a.md'), 'x');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL memory/);
    expect(r.stdout).toContain('-p-demo');
  });

  it('FAILs differently for a home the session hook can never reach', () => {
    const home = healthy('ccrc-doctor-mem-unreach-');
    const h = path.join(home, '.claude-glm');
    fs.mkdirSync(path.join(h, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(h, 'settings.json'), '{}');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL memory/);
    expect(r.stdout).toContain('.claude-glm');
    expect(r.stdout).toMatch(/hook/i);
  });
});
```

*(This is the Step-1 snapshot as originally planned. **Corrected 2026-09-09 (R33, final whole-branch
review):** "FAILs and names the home when a pair is forked" is no longer accurate — the shipped
`_check_memory` WARNs, not FAILs, on `forked` (see D-2249's correction below); only the "cannot reach"
row stays a FAIL. `server/test/ccrc-doctor.test.ts` carries the updated assertions.)*

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '_check_memory'
```

Expected: FAIL — no `memory` line in doctor's output at all.

- [ ] **Step 3: Add the check**

In `ccd/ccrc-doctor-checks`, beside the other `_check_*` functions:

```bash
# ── memory convergence ────────────────────────────────────────────────────
# THE WHOLE DEFECT EXISTED BECAUSE A FORK IS SILENT. Nothing on this box
# reported that two homes disagreed about a project's memory, so a session read
# its own superseded record after an account swap and acted on it. A
# convergence mechanism without a detector only moves the silence one layer
# down: the next unconverged home forks exactly as `.claude-dev0` did.
#
# HOMES COME FROM THE FILESYSTEM, NOT THE ROSTER. `.claude-glm` and
# `.claude-kimi` are on disk, hold memory, and are in no roster entry — a
# roster-driven check would report PASS while the homes most likely to fork
# went unexamined.
#
# THREE CONDITIONS, NEVER TWO. "Forked" and "unreachable" have different
# remedies: the first is `ccrc memory --apply`, the second is wiring the home
# into `install-session-hooks.sh` (whose list is built from CCRC_ACCOUNTS, which
# is why a non-rostered home can never be hooked). Collapsing them sends the
# operator to the wrong fix.
_check_memory() {
  local h b d slug link store forked="" unreachable=""
  for h in "$HOME"/.claude*/; do
    b=$(basename -- "${h%/}")
    case "$b" in .claude-docserver) continue ;; esac
    [ -d "${h}projects" ] || continue
    if [ -f "${h}settings.json" ] \
       && ! grep -q 'session-hook.sh' "${h}settings.json" 2>/dev/null; then
      unreachable="${unreachable:+$unreachable }$b"
    fi
    for d in "${h}projects"/*/; do
      [ -d "$d" ] || continue
      slug=$(basename -- "${d%/}")
      case "$slug" in -tmp*) continue ;; esac
      link="${d}memory"
      [ -e "$link" ] || continue
      store="$HOME/.ccrc/memory/$slug"
      [ -L "$link" ] && [ "$(readlink -- "$link" 2>/dev/null)" = "$store" ] && continue
      forked="${forked:+$forked }$b:$slug"
    done
  done
  if [ -n "$forked" ]; then
    _dr_fail memory "memory is forked across agent homes: $forked" \
      "one store per project: run \`ccrc memory\` to see the census, then \`ccrc memory --apply\`"
    return 1
  fi
  if [ -n "$unreachable" ]; then
    _dr_fail memory "agent homes the session hook cannot reach, so they will fork on first use: $unreachable" \
      "add the account to the roster so install-session-hooks.sh wires it, or register session-hook.sh in that home's settings.json by hand"
    return 1
  fi
  _dr_pass memory "one memory store per project; every agent home converged"
}
```

*(This is the Step-3 snapshot as originally planned; the "Found during execution" deviations below —
D-2246 through D-2252 — carry most of what changed in the shipped `_check_memory` since, and the
final whole-branch review changed one more thing not yet in that list: `forked` is now a **WARN**, not
a FAIL — see D-2249's correction below and the spec's §4 correction for why.)*

Register it in `ccd/ccrc`'s doctor run. Locate how the existing checks are invoked (search
`cmd_doctor` and the `_check_` call sites), and add `_check_memory` following that exact idiom.

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
```

Expected: PASS, including the file's pre-existing tests.

- [ ] **Step 5: Measure the mutation table**

| # | Mutation | Must go RED on |
|---|---|---|
| M1 | enumerate homes from `CCRC_ACCOUNTS` instead of the glob | "FAILs differently for a home the session hook can never reach" |
| M2 | fold the `unreachable` branch into the `forked` branch | the same test (its `/hook/i` assertion) |
| M3 | treat any symlink as converged, ignoring the target | "FAILs and names the home when a pair is forked" (seed a wrong-target link) |

- [ ] **Step 6: Commit**

```bash
bash -n ccd/ccrc-doctor-checks && bash -n ccd/ccrc
git add ccd/ccrc-doctor-checks ccd/ccrc server/test/ccrc-doctor.test.ts
git commit -m "feat(doctor): a forked or unreachable memory home is loud (D-2181)"
```

---

## Task 5: Whole-tree gates, README, and the deploy

**Files:**
- Modify: `README.md` (document `ccrc memory` beside the other verbs)
- No source changes expected; this task is the gate.

- [ ] **Step 1: Run the standing global scanners**

These are the suites that catch what a diff-scoped review cannot. Two regressions escaped an earlier
branch precisely by not running them.

```bash
cd server && ./node_modules/.bin/vitest run \
  test/single-definition.test.ts test/ownership.test.ts test/typecheck-tests.test.ts \
  test/ccrc-install.test.ts test/ccrc-uninstall.test.ts test/ccrc-doctor.test.ts \
  test/install-session-hooks.test.ts test/session-hook.test.ts test/ccrc-memory.test.ts \
  test/dtbd.test.ts test/deviation-refs.test.ts
```

Expected: all PASS. Run `git fetch origin main` first so `deviation-refs` compares against a current
`main`.

- [ ] **Step 2: Document the verb in `README.md`**

Add `ccrc memory` to the verb list in the README's ccrc section, matching the surrounding entries'
shape. One sentence for the census, one for `--apply`, and the sentence that matters: **homes are
enumerated from the filesystem, not the roster.**

- [ ] **Step 3: Run all three suites in full**

```bash
cd server && ./node_modules/.bin/vitest run
cd agent  && ./node_modules/.bin/vitest run
cd pwa    && ./node_modules/.bin/vitest run && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): ccrc memory — one store per project"
```

- [ ] **Step 5: Deploy AGENT-FIRST, then take the census on the real box**

```bash
bash deploy/deploy.sh agent <fleet-host>
bash deploy/deploy.sh
```

Then, on the fleet host, **read the artifact rather than the exit code**:

```bash
ccrc memory            # the census, before anything moves
ccrc doctor            # expect WARN memory, naming the forked pairs (R33, final whole-branch
                        # review: forked is a WARN, not a FAIL — a fork is the expected
                        # pre-migration state of every multi-home box, and FAILing it would
                        # hard-die `ccrc update` before its supervisor sweep ever runs)
```

Only after reading that census, and with the operator's go, run `ccrc memory --apply` and re-read
both. Expect the two known content conflicts to appear as kept-both pairs needing a human:
`account-pools-program.md` and `graph-sweep-exit-code-is-a-claim.md`.

**Do not run `--apply` unattended.** It is the one irreversible-in-practice step in this plan.

---

## Deviations found

Numbers are allocated by `ccrc-api ledger allocate` and defined here in the same act. Do not look a
number up; do not invent one.

- **D-2178** — **FALSIFIED 2026-09-09 (R32, final whole-branch review) — reversed, not merely
  superseded.** This entry originally read: the spec's §2 says the hook "resolves
  `(CLAUDE_CONFIG_DIR, project dir) → slug`"; the plan does **not** resolve a slug at all, it reads
  `dirname(transcript_path)` from the hook payload, on the premise that this path already IS
  `<config dir>/projects/<slug>/`; and reading the harness's own answer removes the `remember`
  plugin's #294 failure mode (a computed slug that misses names a directory that does not exist)
  entirely rather than guarding against it. **THE SLUG IS READ, NEVER COMPUTED** was this entry's own
  headline rule.

  That premise is false inside a git worktree, which is the modality this fleet runs in. Claude Code
  files the **transcript** under the session's **cwd** slug and the **memory** directory under the
  **repository's main-checkout** slug — two different directories once a worktree is in play, and
  `dirname(transcript_path)` names the wrong one. Measured read-only on the fleet: 248
  worktree-shaped slugs across 8 homes, not one carrying a `memory/` entry, sitting beside project
  directories that hold memory files and zero transcripts. The hook was minting an empty, permanent
  store per workspace ever created (`~/.ccrc/memory/<worktree-slug>`, unbounded, nothing prunes it),
  leaving the real (home, project) pair forked forever, and making the census print `converged` for
  the pair that does not exist beside `forked` for the one that does — for every worktree session on
  this fleet, which is most of them.

  **What replaced it:** the slug is now COMPUTED from the project root — the parent of `git
  rev-parse --git-common-dir` (the main checkout's `.git` from anywhere inside the repository,
  worktree or subdirectory alike; `--show-toplevel` would answer the worktree instead), resolved via
  `cd`+`pwd -P` because the harness slugifies the physical path, and the cwd itself for a tree that is
  no git repository at all. **Why computing it is safe now, when D-2178 rejected computing it in the
  first place:** the existence check already in the hook's contract — `<config dir>/projects/<slug>`
  must already exist before the function acts — makes a miss a silent no-op rather than a junk-store
  factory: a wrong answer names a directory the harness never made, and the pair is simply skipped.
  That is the same #294 failure mode this entry originally invoked to justify reading rather than
  computing, now closed by the existence check instead of by avoiding computation. Task 1 (original);
  the reversal ships in `ccd/session-hook.sh`'s `_hook_memory_converge`, with its own mutation table
  (slug-derivation revert, existence-check deletion, layout-assertion deletion — all measured RED) and
  a worktree fixture (`mkWorktree()`, a real `git worktree add`) in `server/test/session-hook.test.ts`.

- **D-2179** — the spec's §4 requires doctor to report homes the hook cannot reach, but did not name
  the cause. Measured: `ccd/install-session-hooks.sh`'s DEFAULT home list (no argv) builds from
  `CCRC_ACCOUNTS` (`for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done`), so a
  home in no roster entry is never wired **by that default run**. This plan does **not** auto-add
  `.claude-glm`/`.claude-kimi` to the roster: rostering an account changes where ccrc PLACES WORK, which
  is an operator decision with consequences well beyond memory. Doctor reports it and names both
  remedies. Task 4.
  **Corrected 2026-09-09 (whole-branch review, Minor):** "a home in no roster entry can never be
  wired, however correct the hook is" overstated what the installer can do — `install-session-hooks.sh`
  itself takes `--homes <dir>…`, and its own header calls the roster list "the DEFAULT home list", not
  the only one. An arbitrary home can be wired with one idempotent, jq-validating, backing-up
  invocation of the installer without touching the roster at all. Doctor's own remedy text does not
  offer this path — it still reads "add the account to the roster … or register `session-hook.sh` in
  that home's `settings.json` by hand", sending the operator to the paranoid, backed-up script's own
  header-declared danger zone (hand-editing the file the installer exists to protect) instead of the
  installer's own `--homes` argv. A second inaccuracy in the same remedy: the `unreachable` bucket
  also fires for an ALREADY-rostered home whose `settings.json` exists but no longer references the
  hook, for which "add the account to the roster" is a no-op. Both are remedy-text inaccuracies that
  live in `ccd/ccrc-doctor-checks`, outside this plan's file scope for this correction; recorded here
  because the false "can never be wired" claim originates in this document.

- **D-2180** — the spec describes the empty-directory case as a test followed by a replacement. The
  implementation uses `rmdir`'s own failure as the test, because `rmdir` succeeds only on an empty
  directory. This removes the check-then-act window a separate emptiness test would open, in a hook
  that runs concurrently across ~20 sessions. Task 1.

- **D-2181** — neither the spec nor the design mentions scratch slugs. Measured: the harness mints a
  slug for every directory a session starts in, including throwaway temp dirs (a dozen `-tmp-*` slugs
  in `.claude` alone). Converging those would fill the shared store with empty directories nobody will
  read. All three mechanisms skip a slug beginning `-tmp`, and the census filter, the hook guard and
  the doctor guard use the same rule. Tasks 1, 2 and 4.

- **D-2182** — the spec's §3 says the pre-existing symlinks are "re-pointed" to the neutral store,
  but a symlink pointing at another HOME has that home's real directory behind it and its contents
  must not be lost. `_mem_absorb` therefore unions the LINK TARGET into the store before re-pointing,
  and leaves the target directory itself standing — the home that owns it converges on its own pass.
  Task 3, mutation M5.
  **Corrected 2026-09-09 (whole-branch review, Critical, fixed):** "the home that owns it" overstated
  what the code can know — the target directory need not belong to any agent home's own pair at all
  (the R18a/R18b tests deliberately point the link at a bare foreign directory that owns no pair), so
  nothing guarantees it is ever converged on "its own pass". The run now names what was left behind:
  `_mem_apply` prints the resolved target's own location in its `NOTE:` line whenever the symlink arm
  leaves entries uncounted, rather than discarding that path once the link is dropped.

### Found during execution, 2026-09-09

The five above were found while writing the plan. These fifteen were found while executing it, each by
a review that measured the defect rather than argued it. They are recorded here because the shipped
source carries their `D-N` comments, and because several of them supersede what this plan's own code
blocks say.

- **D-2238** — **CONVERGED IS REDEFINED, IN ALL FOUR SITES.** This plan compares `readlink`'s TEXT to
  the store's absolute spelling. Measured: that makes `ccrc doctor` and `ccrc memory` answer
  DIFFERENTLY about the same pair — a relative link resolving to the canonical store reads `converged`
  to a `-ef` test and `forked` to a text test, and a "store" that exists as a regular FILE passes a bare
  existence check while being exactly as unusable as a dangling link. Two mechanisms disagreeing
  silently about one pair is this branch's own subject, so the definition is now single: **the link
  RESOLVES to the store (`[ "$link" -ef "$store" ]`) AND the store is a DIRECTORY (`[ -d "$store" ]`)**,
  spelled identically in `_mem_state`, `_check_memory` and `_hook_memory_converge`, with `_mem_apply`
  inheriting it. `-ef` is necessary and `-d` is necessary: deleting either is an independently
  measurable defect. **What it costs, corrected:** the first ruling accepted that `--apply` would leave
  a relative-but-correct link as written, since it skips whatever `_mem_state` calls converged. That was
  wrong, and the same rule strands a worse shape — a link CHAIN (`.claude-corp` -> `.claude`'s link ->
  store) also resolves, so `--apply` skipped it permanently and doctor printed PASS, leaving one
  account's HOME load-bearing for every other. That is the second defect of the existing prior art this
  design exists to remove, and under this box's actual `en_US.UTF-8` locale `.claude` sorts before
  `.claude-corp`, so it is an ordering a real box plausibly produces, not a contrived one.
  **Corrected 2026-09-09 (whole-branch review, critic item D):** "`.claude` sorts first" is not a
  general rule, and an earlier version of this entry stated it as one. Bash sorts the expanded glob
  strings INCLUDING the trailing `/`, so under `LC_ALL=C` — what a stripped systemd environment
  typically sets, and what this suite's own `doctorEnv` sets for `ccrc-doctor.test.ts` — `-` (0x2D)
  beats `/` (0x2F) and `.claude-corp/` sorts BEFORE `.claude/`, the opposite order, which would
  mis-attribute a conflict copy to the wrong home rather than manufacture the chain this arm repairs.
  The chain shape itself is real prior art on this box regardless of which order manufactures it
  mid-run; only the false universal ordering claim is retracted here.
  `_mem_apply` therefore NORMALISES a converged pair whose link text is not the store, with a bare
  `ln -sfn` and no `_mem_absorb` call, turning a chain into a star. `-n` is load-bearing: `ln -sf`
  without it writes the new link INSIDE the store. **The reason there is no absorb is not the obvious
  one** — absorbing a source that resolves to the store does NOT duplicate it into tagged slots, because
  `cmp -s` dedupes a self-absorb; measured, and the mutation that adds the call leaves the suite green.
  The real reason is that `_mem_absorb`'s leftover counter would count the STORE's own entries as
  "not migrated", which is a false count. Tasks 2, 3 and 4.

- **D-2239** — **`[ -e ]` DEREFERENCES, AND EVERY ENUMERATING SITE HAD IT.** This plan writes
  `[ -e "$link" ] || continue` in `cmd_memory`, `_mem_apply` and `_check_memory`. For a symlink whose
  target does not exist `[ -e ]` is FALSE while `[ -L ]` is TRUE, so a dangling `memory` link — one
  written before its store, or orphaned when its store was deleted — was skipped by all three: absent
  from the census, un-repaired by `--apply`, and reported PASS by doctor. All now read
  `[ -e "$link" ] || [ -L "$link" ] || continue`. The same dereference appeared a fourth time in
  `_mem_absorb`'s leftover counter, where it silently under-counted entries it had not migrated.
  Tasks 2, 3 and 4.

- **D-2240** — this plan's `cmd_memory` calls `_mem_apply` and then returns a flat 0, discarding its
  status. `_mem_apply` has failure paths that print to stderr and return 1, so an operator could read
  exit 0 over a migration that stopped halfway. The status is now propagated. Task 3.

- **D-2241** — **`converged` IS A CLAIM, AND A CLAIM MUST BE MEASURED.** This plan's `_mem_absorb`
  checks no `cp` status and its return is discarded at both call sites, so `_mem_apply` would back up
  the source, lay the symlink and print `converged` over a union that never landed. Measured with the
  store at mode 0500: `cp: Permission denied`, then `converged`, rc 0, an empty store. `_mem_absorb`
  now counts failures and returns non-zero, both call sites diagnose and refuse, and **the source is
  not moved away when the absorb failed.** A partially written destination is removed rather than left
  to become canonical on the re-run. Task 3.

- **D-2242** — the conflict-suffix copy in this plan writes unconditionally, so a home already holding
  `same.claude-corp.md` loses it when another home's differing `same.md` arrives — the silent winner
  the whole rule forbids, one filename away, and measured. The suffixed destination now takes the same
  three-way test as the primary: identical is skipped, differing walks to the next free numbered slot,
  and nothing is ever copied onto an existing path. Task 3.

- **D-2243** — this plan's absorb loop takes only top-level `*.md`, so a `README`, a `scratch.txt` or a
  `notes/deep.md` was left behind while the run still printed `converged` and never named the backup
  it had just made. Entries the union did not take are now counted and reported, and the backup path is
  printed on the success line regardless. Task 3.

- **D-2244** — `readlink` returns raw target text, so this plan's `_mem_absorb "$(readlink -- "$link")"`
  resolves a RELATIVE target against the process CWD. Measured: a `memory -> ../../../shared-memory`
  link holding `shared.md` absorbed nothing, was re-pointed at the empty store, and printed
  `converged` — leaving `shared.md` referenced by nothing. Now `readlink -f`. Task 3.

- **D-2245** — an unreadable source directory is not an empty one. With the source at mode 0300 the
  absorb glob cannot expand, so the loop body never runs and the function reported success: measured
  `converged`, rc 0, an empty store, and the home symlinked to it. `_mem_absorb` now probes `[ -r ]`
  and refuses the pair the way a failed copy does. Task 3.

- **D-2246** — this plan's Task 4 says to register the check in `ccd/ccrc`. Measured: `cmd_doctor`
  sources `ccd/ccrc-doctor-checks` and iterates the **`CCRC_DOCTOR_CHECKS` array declared in that
  file**, so registration belongs there and `ccd/ccrc` needs no edit at all.
  `ccrc-doctor.test.ts` already reds in both directions on a table/function mismatch. Task 4.

- **D-2247** — this plan asks whether the doctor file can reuse `ccd/ccrc`'s `_mem_homes`/`_mem_state`.
  Measured: it can at doctor time, and it must not. `ccrc-doctor-checks` is also sourced under `set -u`
  by callers that are not `ccrc`, and **D-92** is this repo's standing ruling that the check table
  stands alone, holding its deliberate second spelling with a mechanism instead of a promise.
  `_check_memory` therefore re-derives the home glob locally and says so. Task 4.

- **D-2248** — `_check_memory` is written in bash builtins (`${x##*/}`, `-ef`) rather than this plan's
  `basename`/`readlink`/`grep`. Measured: the doctor suite's own harness contains PATH to
  `<home>/.local/bin:<home>/stub-bin`, where none of those three binaries resolve — so the literal
  code silently mis-measures under test, producing empty pair names rather than a clean
  tool-not-found error. The file's real doctrine is narrower than "no external binaries": an external
  tool is allowed, but its absence must become a SKIP, never a narrowed verdict. Task 4.

- **D-2249** — **TWO VERDICT LINES, NOT ONE** *(retitled 2026-09-09; originally "TWO FAIL LINES, NOT
  ONE" — see the correction below).* This plan returns 1 after the forked branch, so a box that is
  both forked and unreachable reports only the fork and silently discards a measured finding.
  `ccrc-doctor-checks`'s own header rules the opposite: two hard findings with two different operator
  actions get two separate lines, each with its own remedy, rather than one bucket whose remedy is
  right for only one of the two sentences it joined. `cmd_doctor` counts verdict LINES, not arity, so
  this costs nothing. Task 4.
  **Corrected 2026-09-09 (R33, final whole-branch review):** the two lines are no longer both FAIL. A
  FAIL here hard-dies `cmd_update` (`cmd_install` ends every role arm with `cmd_doctor`, which returns
  non-zero the moment any check FAILs) *before* the supervisor sweep runs — and this check FAILed on
  `forked` by construction on every box that has ever run more than one agent home, coercing an
  unrelated verb into demanding the one irreversible `ccrc memory --apply`. `forked` is now a **WARN**;
  `unreachable` stays a **FAIL**, because a fork is the expected pre-migration state of a multi-home box
  and an unreachable home is not. Both still print, independently, exactly as this deviation
  established — only their severities changed, not the "never collapse to one line" rule itself.

- **D-2250** — this plan tests `[ -f "${h}settings.json" ]` before asking whether a home references the
  hook, so a home carrying `projects/` and NO `settings.json` at all was never reported. That is the
  maximal case of the condition, not an exemption from it: `install-session-hooks.sh` CREATES a
  `settings.json` for any rostered home lacking one, so its absence proves the installer has never
  touched that home. Task 4.

- **D-2251** — an UNREADABLE `settings.json` was reported as "the session hook cannot reach this home",
  collapsing *I could not measure this* into *I measured it and it is unwired* — the shape **D-1350**
  rules against. It is now a WARN naming the home and its own remedy, and the check returns 2. The
  `2>/dev/null` that was meant to hide the read failure never could: redirections apply left to right,
  so a chmod-000 file leaked a raw shell error to a stderr `cmd_doctor` deliberately does not capture.
  Task 4.

- **D-2252** — `_mem_absorb`'s conflict tag is a home basename, which begins with a dot, so this plan's
  `${base%.md}.$tag.md` produces `same..claude-corp.md`. The leading dot is stripped:
  `same.claude-corp.md`. Cosmetic, and it lands in a file an operator has to read and judge. Task 3.

---

## Self-review

**Spec coverage.**

| Spec section | Where implemented |
|---|---|
| §1 layout, store at `~/.ccrc/memory/<slug>/`, transcripts untouched | Tasks 1–4; nothing in this plan reads or moves a `.jsonl` |
| §2 hook converges, never merges; the five-row table | Task 1, all five rows tested including both do-not-touch rows |
| §3 migration is an explicit operator act; no silent winner; `MEMORY.md` rebuilt | Tasks 2 and 3 |
| §4 doctor enumerates the filesystem; three conditions | Task 4 |
| §4a more `CLAUDE_CONFIG_DIR`s handled; other harnesses out of scope | Task 2's `_mem_homes` globs `~/.claude*`; no code reads a provider name |
| §5 does not touch transcripts, the `remember` store, or any `CLAUDE.md` | No task touches any of the three |
| §6 widened write contention; `MEMORY.md` derivability as mitigation | Task 3's `_mem_rebuild_index` |

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step
carries its literal content. Two steps deliberately say *measure before writing* rather than
prescribing — Task 1 Step 4 (whether the compact early-return precedes the call site) and Task 4's
Interfaces block (whether the doctor file shares scope with `ccd/ccrc`) — because both are properties
of a file that has moved since this plan was written, and a prescription there would be a guess
wearing the clothes of an instruction.

**Type consistency.** `_mem_homes`, `_mem_state`, `_mem_absorb`, `_mem_rebuild_index`,
`_mem_index_line`, `_mem_apply`, `cmd_memory`, `_hook_memory_converge`, `_check_memory` — each is
defined once and called under exactly that name. `_mem_state` returns three tokens,
`converged|forked|absent`. **Corrected 2026-09-09 (whole-branch review, Minor):** "every caller tests
those spellings" overstated it — both shipped call sites (`cmd_memory`, `_mem_apply`) gate on
`[ -e "$link" ] || [ -L "$link" ] || continue` *before* calling `_mem_state`, so `absent` is
unreachable from either. `usage()`'s own advertised census states were fixed to say "converged or
forked" to match, in the same review.

**Scope.** One subsystem, five tasks, each independently testable and independently rejectable.
