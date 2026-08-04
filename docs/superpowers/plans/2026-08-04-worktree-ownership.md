# Worktree Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ccd stops destroying nested child checkouts: refuse when they're present (D1), tear registered ones down safely with consent (D2/D3), tell the truth about them in the UI (D4), plus three small riders (D5).

**Architecture:** All child logic lives in the bash script `ccd/ccd` (the only authority on deletion); the server passes new audit facts through a new literal-return revive; the PWA renders children as named checkouts. Three PRs against protected main: PR 1 = D1 guard (alone deployable), PR 2 = D2+D3+D4, PR 3 = D5 riders.

**Tech Stack:** bash (ccd), TypeScript ESM (Fastify server, React PWA), vitest. Tests run ccd for real inside fixture HOMEs via `server/test/ccdWsHelpers.ts` / `ccdPrHelpers.ts`.

## Global Constraints (bind every task — from the spec, verbatim where quoted)

- **No `--force`, no `-D`, no `update-ref -d` anywhere in child handling.** Pinned by `ccd-ws-reap.test.ts:123` `implements no force or override flag of any kind`: no literal `--force`/`--now` inside the bodies of `_ws_reap_eval`, `cmd_ws_reap`, `_ws_reap_tail`, `cmd_ws_audit`; **exactly one** line in ccd may contain `branch -D` (the existing echo in `cmd_ws_rm`).
- **All path containment on `pwd -P` resolved paths, both sides.** The fleet's roots are symlinked (`~/projects → /data/projects → /mnt/...`).
- **No new info/exclude patterns.** Where `.claude/worktrees/` is not ignored, the dirty-tree refusal is the safe state.
- **No new agent-whitelist grant, no new user-controlled argv.** Child paths come from git and the filesystem, never from argv. Any new refusal token lands in `server/src/wsaudit.ts` `SENTENCES` **in the same commit** — `wsaudit.test.ts:97` asserts the token set and the sentence-key set are exactly equal (it scans ccd source with `/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/` and `/"refused":"([a-zA-Z0-9-]+)"/`). **Therefore every new token is colon-free**: `child-busy`, not `child-busy:<op>` (spec deviation, deliberate — the op travels in `detail` and in the D4 `children[].busy` field).
- **Tests under fixture `$HOME` only**, via `makeCcdHarness`/`makePrHarness`. New test files import `CCD`/`WS_ADD` from `./ccdWsHelpers.js` — `single-definition.test.ts` fails any file spelling the ccd path itself.
- **Every fixture-building `it` carries `}, 30000);`** (`ccd-ws-reap.test.ts:99–112` — measured decision, box load ~8).
- **Audit fields never measured are `null`, never `0`/`[]`** (`ccd-ws-audit.test.ts` `describe('the fields a refusal never measured')`).
- ccd JSON house rules (comment at `ccd/ccd:3072–3084`): build each field in a `local` where the producer's rc is visible; `null` when the read did not happen; never `$(…)` inside the printf argument list.

## Plan-time findings that correct the spec (all verified 2026-08-04 against the working tree)

1. **Three `git worktree remove` sites, not two**: `cmd_ws_rm` (~ccd:1099), `_ws_reap_tail` step (f) (~ccd:4049), and **`_ws_gc_prune_row`'s `orphan)` arm** (~ccd:4676). The spec's own "before ANY `git worktree remove`" wording governs: D1 guards all three.
2. **The 14th-input blast radius is 2 tests, not "every hardcoded token fixture"**: only `ccd-ws-audit.test.ts:1836` (`fingerprints thirteen DISTINCT facts…`) and `:1863` (`the token IS the fingerprint…`) hold 13-element arrays. The 32 `.repeat(64)` literals are deliberate non-matching sentinels and survive unchanged. Prose naming the count: `ccd/ccd:2404–2405`, `:1529`, `:3718` (already stale: says "twelve"), `:3943`; `ccd-ws-audit.test.ts:1843/1851/1866/1867`; `ccd-ws-reap.test.ts:1905`.
3. **Probe: leaf-basename collision** (git 2.43.0): two children named `agent-foo` under different parents register as `agent-foo` and `agent-foo1` — auto-suffixed, no failure; `worktree list --porcelain` reports full paths. Tests must never assume the `.git/worktrees/<name>` dir equals the leaf name.
4. **Probe: walk budget**: `find -mindepth 2 -name .git` over the fleet's worst real tree (24 GB, 1.93M files, 36 checkouts) takes 0.68 s. The `REAP_SCAN_SECONDS=30` bound has ~44× headroom; no early-exit-per-child machinery needed.
5. **The pwa sentence to scope** is `These are in no commit and cannot be recovered.` (`ReapSheet.tsx:330–332`) — the spec's "none of it is in git…" wording is ccd's gc row, not the sheet's.
6. **`SessionActionsSheet` is at `pwa/src/fleet/`**, not `pwa/src/session/`.
7. **`parseAudit` is a spread cast** (`wsaudit.ts:111`) — the literal-return safety the spec says to "keep" does not exist for `WsAudit`. Task 10 creates `reviveWsAudit`.
8. **The resume fork ignores `--expect` by design** (ccd:3712) and `ccd-ws-reap.test.ts:2006` pins that a `'f'.repeat(64)` token completes a resume. D3 must not break that test's premise (unchanged child set → resume completes); it adds a refusal only when the child set moved.

---

# PR 1 — `feat/nested-checkout-guard` (D1, alone deployable)

## File structure

- Modify: `ccd/ccd` — new `_ws_nested_checkouts` helper (place directly above `_ws_sensitive_inside`, ~line 2023); guard hooks in `cmd_ws_rm`, `_ws_reap_eval` (new Phase-B rung), `_ws_reap_tail`, `_ws_gc_prune_row`.
- Modify: `server/src/wsaudit.ts` — one `SENTENCES` entry.
- Test: `server/test/ccd-ws-reap.test.ts`, `server/test/ccd-ws-audit.test.ts`, `server/test/ccd-ws-gc.test.ts`, `server/test/wsaudit.test.ts` (linkage suite runs green automatically once the entry exists).

### Task 1: `_ws_nested_checkouts` — the walk

**Interfaces — Produces:** `_ws_nested_checkouts <dir>` → rc 0 with one **resolved** checkout-root path per line on stdout (empty = none), rc 1 with `_WS_NESTED_WHY` set when the walk did not complete. Callers in Tasks 2–4 and PR 2 rely on exactly this contract.

- [ ] **Step 1: Write the failing tests** — append a new `describe('the nested-checkout walk (D1)')` in `server/test/ccd-ws-audit.test.ts` (it has the harness and the audit idiom):

```ts
describe('the nested-checkout walk (D1)', () => {
  it('lists a stray git init under an ignored path, resolved, and nothing else', () => {
    const { wt } = squashMovedBase();
    fs.mkdirSync(path.join(wt, '.claude', 'worktrees', 'agent-x'), { recursive: true });
    execFileSync('git', ['init', '-q', path.join(wt, '.claude', 'worktrees', 'agent-x')]);
    const out = h.sh(`_ws_nested_checkouts "${wt}"`);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('agent-x');
    expect(out.startsWith('/')).toBe(true);
  }, 30000);

  it('answers empty for a workspace with no nested checkouts, rc 0', () => {
    const { wt } = squashMovedBase();
    expect(h.sh(`_ws_nested_checkouts "${wt}" && echo WALKED`)).toBe('WALKED');
  }, 30000);

  it('fails rc 1 with a reason when a directory cannot be read — never guesses', () => {
    const { wt } = squashMovedBase();
    const locked = path.join(wt, 'locked');
    fs.mkdirSync(locked); fs.chmodSync(locked, 0o000);
    try {
      const r = h.run(`_ws_nested_checkouts "${wt}" || { echo "WHY=$_WS_NESTED_WHY"; exit 3; }`);
      expect(r.code).toBe(3);
      expect(r.stdout).toContain('WHY=');
    } finally { fs.chmodSync(locked, 0o755); }
  }, 30000);

  it('sees a .git FILE (a linked worktree pointer), not only directories', () => {
    const { wt } = squashMovedBase();
    const fake = path.join(wt, 'sub');
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, '.git'), 'gitdir: /nowhere\n');
    expect(h.sh(`_ws_nested_checkouts "${wt}"`)).toContain('sub');
  }, 30000);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd server && ./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts -t 'nested-checkout walk'` — expect FAIL (`_ws_nested_checkouts: command not found`).
- [ ] **Step 3: Implement** in `ccd/ccd`, directly above the `REAP_SCAN_SECONDS=30` line (~2023), following `_ws_sensitive_inside`'s bounded-find shape (rc/stderr/timeout three-guard):

```bash
# ── D1: the nested-checkout guard ──────────────────────────────────────────
# A registered child, a plain `git init`, a clone, a linked-worktree pointer
# file: every one of them is a `.git` entry at depth ≥ 2. `git worktree list`
# structurally cannot see the independent ones (measured), so this is a
# FILESYSTEM walk. rc 0 = the walk completed (stdout may be empty); rc 1 = it
# did not, with the reason in _WS_NESTED_WHY — same polarity as every Phase B
# read: unreadable refuses, it never guesses.
_WS_NESTED_WHY=''
_ws_nested_checkouts() {   # dir -> resolved checkout roots, one per line
  local dir="$1" outf errf err rc f p
  _WS_NESTED_WHY=''
  outf=$(mktemp) || { _WS_NESTED_WHY='could not make a scratch file'; return 1; }
  errf=$(mktemp) || { rm -f "$outf"; _WS_NESTED_WHY='could not make a scratch file'; return 1; }
  timeout "$REAP_SCAN_SECONDS" find "$dir" -mindepth 2 -name .git -print0 >"$outf" 2>"$errf"; rc=$?
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  if (( rc == 124 )); then
    rm -f "$outf"
    _WS_NESTED_WHY="the nested-checkout walk did not finish within ${REAP_SCAN_SECONDS}s"
    return 1
  fi
  (( rc == 0 )) || { rm -f "$outf"; _WS_NESTED_WHY='could not walk the tree'; return 1; }
  [[ -z "$err" ]] || { rm -f "$outf"; _WS_NESTED_WHY="could not read all of the tree ($err)"; return 1; }
  while IFS= read -r -d '' f; do
    p=$(cd "$(dirname "$f")" 2>/dev/null && pwd -P) || p="${f%/.git}"
    printf '%s\n' "$p"
  done <"$outf" | LC_ALL=C sort
  rm -f "$outf"
}
```

- [ ] **Step 4: Run to verify they pass** — same command, expect 4 PASS.
- [ ] **Step 5: Commit** — `git add ccd/ccd server/test/ccd-ws-audit.test.ts && git commit -m "feat(ccd): a filesystem walk that sees every nested checkout, registered or not"`

### Task 2: guard `cmd_ws_rm`

- [ ] **Step 1: Failing tests** in `server/test/ccd-ws-reap.test.ts` (new `describe('ws-rm refuses nested checkouts (D1)')`; use the file's `ready()` fixture and `h.run`):

```ts
describe('ws-rm refuses nested checkouts (D1)', () => {
  it('refuses before stopping anything, and the child survives', () => {
    const { wt } = ready();
    const child = path.join(wt, '.claude', 'worktrees', 'agent-a');
    fs.mkdirSync(path.join(wt, '.claude', 'worktrees'), { recursive: true });
    execFileSync('git', ['init', '-q', child]);
    // .claude/worktrees is NOT ignored here, so first prove the dirty rung
    // still wins when it applies; then ignore it and prove the new guard fires.
    fs.writeFileSync(path.join(wt, '.gitignore'), '.claude/\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
    const r = h.run(`${ARCH} cmd_ws_rm demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/nested checkout/);
    expect(r.stderr).toMatch(/nothing was touched/);
    expect(fs.existsSync(child)).toBe(true);
    expect(h.reg('demo-quiet-basin', 'uuid'), 'registry survives').not.toBeNull();
    expect(h.sh(`grep -c "unsupervise" "$HOME/ccd-calls" || true`)).toBe('0');
  }, 30000);
});
```

- [ ] **Step 2: Run, expect FAIL** (ws-rm currently succeeds or dies later with a different message).
- [ ] **Step 3: Implement** — in `cmd_ws_rm`, locate the dirty-tree die (`worktree not removed (uncommitted changes?) — nothing was touched`, ~ccd:1084) and insert **after it, before** the `_ws_unsupervise`/`tmux kill-session` teardown lines (~1086):

```bash
    local nested
    nested=$(_ws_nested_checkouts "$workdir") \
      || die "could not scan $workdir for nested checkouts${_WS_NESTED_WHY:+ ($_WS_NESTED_WHY)} — nothing was touched"
    [[ -z "$nested" ]] \
      || die "worktree not removed — nested checkouts live under it, and ccd deletes no repository it did not create: ${nested//$'\n'/, } — nothing was touched"
```

- [ ] **Step 4: Run, expect PASS.** Also run the no-force pin: `./node_modules/.bin/vitest run test/ccd-ws-reap.test.ts -t 'no force'` — must stay green.
- [ ] **Step 5: Commit** — `feat(ccd): ws-rm refuses while nested checkouts live under the workspace`

### Task 3: guard the reap — eval rung + tail backstop + sentence

**Interfaces — Produces:** refusal token `nested-checkouts-present` (audit verdict and reap refusal), reused by PR 2. In this PR the rung refuses on ANY nested checkout; PR 2 narrows it to strays.

- [ ] **Step 1: Failing tests** in `ccd-ws-reap.test.ts` (same describe as Task 2):

```ts
  it('the audit names nested-checkouts-present BEFORE any tap, and reap refuses', () => {
    const { wt, main } = ready(['.claude/']);
    const child = path.join(wt, '.claude', 'worktrees', 'agent-b');
    fs.mkdirSync(path.join(wt, '.claude', 'worktrees'), { recursive: true });
    execFileSync('git', ['init', '-q', child]);
    const a = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    expect(a.verdict).toBe('nested-checkouts-present');
    expect(a.detail).toContain('agent-b');
    const o = refused('0'.repeat(64), wt, main);
    expect(o.refused).toBe('nested-checkouts-present');
    expect(fs.existsSync(child), 'the child survives the refusal').toBe(true);
  }, 30000);

  it('a child spawned between consent and the tail still cannot die — the tail backstop', () => {
    const { wt } = ready(['.claude/']);
    const tok = tokenOf();
    const SPAWN = `_ws_unsupervise() { git init -q "${wt}/.claude/worktrees/agent-late"; };`;
    const r = h.run(`${GH_STUB} ${ARCH.replace('_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };', SPAWN)} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('nested-checkouts-present');
    expect(fs.existsSync(path.join(wt, '.claude', 'worktrees', 'agent-late'))).toBe(true);
    expect(fs.existsSync(wt), 'the parent worktree survives').toBe(true);
  }, 30000);
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement, three edits in one commit** (the linkage test forces the sentence into the same commit):

(a) `_ws_reap_eval` — inside the `if [[ -d "$workdir" ]]` Phase-B block, directly after the `sensitive-ignored` rung (~ccd:2654), and add `nested` to the function's `local` list:

```bash
    nested=$(_ws_nested_checkouts "$workdir") \
      || { _reap_refuse tree-unreadable "could not scan for nested checkouts${_WS_NESTED_WHY:+ — $_WS_NESTED_WHY}"; return 1; }
    [[ -z "$nested" ]] \
      || { _reap_refuse nested-checkouts-present "$(printf '%s\n' "$nested" | grep -c .) nested checkout(s) live under this workspace: ${nested//$'\n'/, }"; return 1; }
```

(b) `_ws_reap_tail` — immediately before its `git worktree remove` (~ccd:4049, inside the `[[ -d "$workdir" ]]` arm), fail-shut on an unscannable tree:

```bash
      local nested
      if ! nested=$(_ws_nested_checkouts "$workdir"); then nested="(unscannable: ${_WS_NESTED_WHY})"; fi
      if [[ -n "$nested" ]]; then
        printf '{"refused":"nested-checkouts-present","detail":%s,"paths":[]}\n' \
          "$(_json_str "nested checkouts under $workdir: ${nested//$'\n'/, } — remove or finish them, then re-run ws-reap")"
        return 0
      fi
```

(c) `server/src/wsaudit.ts` `SENTENCES` (keep the map's ladder ordering — insert after `sensitive-ignored`):

```ts
  'nested-checkouts-present':
    'Checkouts of their own live under this workspace — they are not build output. Remove or finish them first; ccd deletes no repository it did not create.',
```

- [ ] **Step 4: Run** the new tests + `vitest run test/wsaudit.test.ts` (the bidirectional linkage must be green) + `vitest run test/ccd-ws-reap.test.ts` in full. Expect PASS at previous counts + new.
- [ ] **Step 5: Commit** — `feat(ccd): reap refuses nested checkouts at the audit AND at the last instant before removal`

### Task 4: guard gc's orphan arm

- [ ] **Step 1: Failing test** in `server/test/ccd-ws-gc.test.ts` (mirror the file's existing orphan fixtures — find them via `grep -n 'orphan' server/test/ccd-ws-gc.test.ts` and copy the nearest fixture's shape):

```ts
  it('declines to prune an orphan that holds a nested checkout (D1)', () => {
    // Build the file's standard orphan (registered worktree, registry row gone),
    // then git init a child inside it. The decline must name the reason and
    // the child must survive a full `ws-gc --prune`.
```
(the body follows the neighbouring orphan test verbatim, adding `execFileSync('git', ['init', '-q', path.join(orphanWt, 'nested')])` before the prune and asserting `/nested checkout/` in the declined row plus `fs.existsSync(orphanWt)` after.)

- [ ] **Step 2: Run, expect FAIL** (today the orphan is removed).
- [ ] **Step 3: Implement** — in `_ws_gc_prune_row`'s `orphan)` arm, before `_ws_gc_reclaimable "$p" || return 0` (~ccd:4675):

```bash
      local nested
      if ! nested=$(_ws_nested_checkouts "$p"); then
        _gc_declined "$p could not be scanned for nested checkouts${_WS_NESTED_WHY:+ ($_WS_NESTED_WHY)}"; return 0
      fi
      if [[ -n "$nested" ]]; then
        _gc_declined "$p holds nested checkouts — ccd removes only what it created"; return 0
      fi
```

- [ ] **Step 4: Run** `vitest run test/ccd-ws-gc.test.ts` — PASS at old count + 1.
- [ ] **Step 5: Commit**, then run the full server suite + typecheck (`vitest run` then `tsc --noEmit`), push branch, **open PR 1**. Merge when CI is green.

---

# PR 2 — `feat/child-aware-reap` (D2 + D3 + D4)

## File structure

- Modify: `ccd/ccd` — `_ws_children` enumerator; child ladder in `_ws_reap_eval`; `childrenDigest` (14th fingerprint input); `children` teardown phase in `_ws_reap_tail`; `children` in the tombstone; resume-fork child-set check; `children[]` in `cmd_ws_audit`.
- Modify: `shared/api.ts` — `WsAuditChild` + `children` field + `reviveWsAudit` (literal return).
- Modify: `server/src/wsaudit.ts` — `parseAudit` uses the revive; 4 new `SENTENCES` entries.
- Modify: `pwa/src/session/ReapSheet.tsx` — children section + scoped sentence.
- Test: `server/test/ccd-ws-audit.test.ts`, `server/test/ccd-ws-reap.test.ts`, `server/test/wsaudit.test.ts`, `server/test/pr-routes.test.ts` (AUDIT fixture), `pwa/test/reap-sheet.test.tsx`, `pwa/test/fleet-screen.test.tsx` (untyped inline fixture).

### Task 5: `_ws_children` — registered-child enumeration on resolved paths

**Interfaces — Produces:** `_ws_children <main> <parentdir>` → rc 0, one line per registered child strictly inside the parent: `resolvedpath<TAB>branch<TAB>headOid` (branch empty when detached); rc 1 when `worktree list` failed. Consumed by Tasks 6–9.

- [ ] **Step 1: Failing tests** (`ccd-ws-audit.test.ts`, new describe; the symlink fixture is load-bearing — spec fact 5):

```ts
describe('registered-child enumeration (D2)', () => {
  const addChild = (main: string, wt: string, leaf: string, branch: string): string => {
    const dir = path.join(wt, '.claude', 'worktrees', leaf);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    h.git(main, 'worktree', 'add', dir, '-b', branch);
    return dir;
  };

  it('lists only worktrees strictly inside the parent, tab-separated, sorted', () => {
    const { wt } = squashMovedBase();
    const main = path.join(h.home, 'projects', 'demo');
    addChild(main, wt, 'agent-a', 'ca');
    const out = h.sh(`_ws_children "${main}" "${wt}"`);
    const rows = out.split('\n').map((l) => l.split('\t'));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toContain('agent-a');
    expect(rows[0]![1]).toBe('ca');
    expect(rows[0]![2]).toMatch(/^[0-9a-f]{40}$/);
  }, 30000);

  it('containment is computed on RESOLVED paths — a symlinked parent still owns its children', () => {
    const { wt } = squashMovedBase();
    const main = path.join(h.home, 'projects', 'demo');
    addChild(main, wt, 'agent-s', 'cs');
    const link = path.join(h.home, 'link-to-wt');
    fs.symlinkSync(wt, link);
    expect(h.sh(`_ws_children "${main}" "${link}"`)).toContain('agent-s');
  }, 30000);

  it('a sibling worktree outside the parent is NOT a child', () => {
    const { wt } = squashMovedBase();
    const main = path.join(h.home, 'projects', 'demo');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), '-b', 'sib');
    expect(h.sh(`_ws_children "${main}" "${wt}" | grep -c . || true`)).toBe('0');
  }, 30000);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** in `ccd/ccd`, directly below `_ws_nested_checkouts`:

```bash
# Registered children = entries of `git worktree list --porcelain` whose
# RESOLVED path sits strictly inside the parent's resolved dir. Registration is
# FLAT at every depth (measured); nesting is a filesystem accident, so the tree
# is reconstructed here by path prefix — resolved on BOTH sides, or the fleet's
# symlinked roots make every containment test pass vacuously.
_ws_children() {   # main parentdir -> "resolvedpath\tbranch\theadoid" per child
  local main="$1" parent wt="" head="" br="" out=""
  parent=$(cd "$2" 2>/dev/null && pwd -P) || return 1
  local porc; porc=$(git -C "$main" worktree list --porcelain 2>/dev/null) || return 1
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      "HEAD "*)     head="${line#HEAD }" ;;
      "branch "*)   br="${line#branch refs/heads/}" ;;
      "")
        if [[ -n "$wt" ]]; then
          local rp; rp=$(cd "$wt" 2>/dev/null && pwd -P) || rp="$wt"
          [[ "$rp" == "$parent"/* ]] && out+="$rp"$'\t'"$br"$'\t'"$head"$'\n'
        fi
        wt=""; head=""; br="" ;;
    esac
  done <<< "$porc"$'\n'
  printf '%s' "$out" | LC_ALL=C sort
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ccd): enumerate registered children by resolved-path containment`

### Task 6: the per-child ladder in `_ws_reap_eval`

**Interfaces — Produces:** refusal tokens `child-dirty`, `child-busy`, `child-unpushed`, `child-branch-elsewhere` (all colon-free; detail names the child path and, for busy, the operation). Narrows Task 3's rung: registered children go through this ladder; **strays** (walk minus registered) keep refusing `nested-checkouts-present`.

- [ ] **Step 1: Failing tests** (`ccd-ws-audit.test.ts`, one per rung; fixture per test builds `ready`-style parent + child via Task 5's `addChild` shape, `.claude/` gitignored so the parent stays clean):

```ts
  it('a DIRTY child refuses the parent, naming the child', () => {
    // addChild, write an uncommitted file into it
    // audit → verdict 'child-dirty', detail contains the child path
  }, 30000);
  it('a child mid-rebase refuses child-busy with the op in the detail', () => {
    // create a real rebase conflict inside the child (two commits touching one
    // line; git rebase → stops), audit → 'child-busy', detail /rebase/
  }, 30000);
  it('a child with commits unreachable from origin/HEAD refuses child-unpushed', () => {
    // commit in the child, do NOT merge it anywhere, audit → 'child-unpushed'
  }, 30000);
  it('a detached child refuses child-busy with "detached HEAD" in the detail', () => {}, 30000);
  it('a clean, merged, attached child PASSES — the parent stays reapable', () => {
    // child whose one commit is squash-merged into origin/main (reuse the
    // squashMovedBase construction for the CHILD's content), audit → 'reapable'
  }, 30000);
  it('a stray repo beside a registered child still refuses nested-checkouts-present', () => {}, 30000);
```

Write each body fully in the file, following the existing `refusal()`/`audit()` helpers; every test asserts the parent worktree and child survive.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — replace Task 3(a)'s rung with the full descent (same location; keep the `tree-unreadable` walk-failure guard first). Per registered child, in order, using the parent project's `origin/HEAD` as base:

```bash
    # D2 — child-aware descent. Registered children get a ladder; strays refuse.
    local children="" childline cpath cbr chead
    nested=$(_ws_nested_checkouts "$workdir") \
      || { _reap_refuse tree-unreadable "could not scan for nested checkouts${_WS_NESTED_WHY:+ — $_WS_NESTED_WHY}"; return 1; }
    children=$(_ws_children "$main" "$workdir") \
      || { _reap_refuse tree-unreadable "could not enumerate registered worktrees"; return 1; }
    local strays=""; strays=$(comm -23 <(printf '%s\n' "$nested" | grep . | LC_ALL=C sort) \
                                        <(printf '%s\n' "$children" | cut -f1 | LC_ALL=C sort))
    [[ -z "$strays" ]] \
      || { _reap_refuse nested-checkouts-present "$(printf '%s\n' "$strays" | grep -c .) unregistered checkout(s): ${strays//$'\n'/, }"; return 1; }
    REAP_CHILDLINES=""
    while IFS=$'\t' read -r cpath cbr chead; do
      [[ -n "$cpath" ]] || continue
      [[ -n "$cbr" ]] || { _reap_refuse child-busy "detached HEAD at $cpath"; return 1; }
      local cop; cop=$(_ws_child_op "$cpath") \
        || { _reap_refuse tree-unreadable "could not probe $cpath for an in-progress operation"; return 1; }
      [[ -z "$cop" ]] || { _reap_refuse child-busy "$cop in progress at $cpath"; return 1; }
      errf=$(mktemp) || { _reap_refuse tree-unreadable "could not read the child at $cpath"; return 1; }
      dirt=$(git -C "$cpath" status --porcelain 2>"$errf"); rc=$?
      err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
      { (( rc == 0 )) && [[ -z "$err" ]]; } \
        || { _reap_refuse tree-unreadable "could not read the child at $cpath"; return 1; }
      local cdirty; cdirty=$(printf '%s' "$dirt" | grep -c . || true)
      (( cdirty == 0 )) || { _reap_refuse child-dirty "$cdirty uncommitted file(s) in $cpath"; return 1; }
      local cbase; cbase=$(git -C "$main" symbolic-ref --quiet refs/remotes/origin/HEAD) \
        || { _reap_refuse child-unpushed "no origin/HEAD to prove $cpath against"; return 1; }
      local cahead; cahead=$(git -C "$cpath" rev-list --count "$cbase..HEAD" 2>/dev/null) \
        || { _reap_refuse child-unpushed "could not compare $cpath against $cbase"; return 1; }
      (( cahead == 0 )) || { _reap_refuse child-unpushed "$cahead commit(s) in $cpath unreachable from $cbase"; return 1; }
      local holders; holders=$(git -C "$main" worktree list --porcelain 2>/dev/null | grep -c "^branch refs/heads/$cbr\$" || true)
      (( holders == 1 )) || { _reap_refuse child-branch-elsewhere "branch $cbr is checked out in $holders worktrees"; return 1; }
      REAP_CHILDLINES+="$cpath"$'\t'"$cbr"$'\t'"$chead"$'\t'"$cdirty"$'\n'
    done <<< "$children"$'\n'
```

plus the plumbing probe (reimplemented from git facts, not Conductor's script), placed beside `_ws_children`:

```bash
_ws_child_op() {   # childdir -> op name on stdout ('' = idle), rc 1 = unprobeable
  local d="$1" g p op=""
  for p in rebase-merge:rebase rebase-apply:rebase MERGE_HEAD:merge \
           CHERRY_PICK_HEAD:cherry-pick REVERT_HEAD:revert; do
    g=$(git -C "$d" rev-parse --git-path "${p%%:*}" 2>/dev/null) || return 1
    [[ -e "$d/$g" || -e "$g" ]] && { op="${p##*:}"; break; }
  done
  if [[ -z "$op" ]]; then
    local conf; conf=$(git -C "$d" ls-files -u 2>/dev/null | head -1) || return 1
    [[ -n "$conf" ]] && op="conflicted-merge"
  fi
  printf '%s' "$op"
}
```

`REAP_CHILDLINES=''` joins the reset block in `_ws_reap_reset`, and `nested`, `children`, `strays` join `_ws_reap_eval`'s `local` roster. Add the four `SENTENCES` entries in the same commit:

```ts
  'child-dirty': 'A checkout nested under this workspace has uncommitted work of its own.',
  'child-busy': 'A checkout nested under this workspace is mid-operation — finish or abort it there first.',
  'child-unpushed': 'A checkout nested under this workspace carries commits that exist nowhere else.',
  'child-branch-elsewhere': 'A nested checkout’s branch is also checked out somewhere else — removing it here would strand that other checkout.',
```

- [ ] **Step 4: Run** the new tests, the full `ccd-ws-audit` suite, and `wsaudit.test.ts` (linkage). Expect PASS.
- [ ] **Step 5: Commit** — `feat(ccd): the reap ladder descends into registered children`

### Task 7: D3 — the 14th fingerprint input

- [ ] **Step 1: Update the two 13-fact tests to expect 14** (`ccd-ws-audit.test.ts:1836` and `:1863`): append `'childdigest'` / the real computed digest to the arrays, rename `thirteen` → `fourteen` in both test names, and add the movement test:

```ts
  it('the token moves when a child is spawned after the sheet rendered (D3 TOCTOU)', () => {
    // squashMovedBase-style reapable parent with .claude/ ignored;
    const before = audit();
    expect(before.verdict).toBe('reapable');
    // spawn a clean merged child (Task 6's pass-path construction)
    // the next audit refuses (child ladder) — but the TOKEN comparison is the
    // point: reap with the OLD token must refuse state-changed, never proceed.
    // (uses refused(before.token, wt, main) and asserts .refused is one of
    // 'state-changed' — reached when eval still passes — or the child rung's
    // token when eval now refuses; assert the workspace survived either way.)
  }, 30000);
```

- [ ] **Step 2: Run, expect FAIL** (12/13-fact mismatches).
- [ ] **Step 3: Implement** — in `_ws_reap_eval`, after the clips digest (~ccd:2850):

```bash
  REAP_CHILDDIGEST=$(printf '%s' "$REAP_CHILDLINES" | sha256sum | cut -d' ' -f1)
```

Append `"childrenDigest=${14}"` to `_ws_fingerprint`'s printf list, add the 14th positional at the sole call site (`REAP_CHILDDIGEST`), add `REAP_CHILDDIGEST=''` to `_ws_reap_reset`, and update every "thirteen/THIRTEEN" prose site listed in plan-time finding 2 (including ccd:3718's already-stale "twelve").
- [ ] **Step 4: Run** `vitest run test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts` — full PASS.
- [ ] **Step 5: Commit** — `feat(ccd): consent covers the child set — fingerprint input fourteen`

### Task 8: ordered teardown + the `children` phase + resume coherence

- [ ] **Step 1: Failing tests** (`ccd-ws-reap.test.ts`):

```ts
describe('child teardown (D2/D3)', () => {
  it('removes two nested levels innermost-first, then branches with plain -d, then the parent CAS', () => {
    // parent + child A + grandchild B under A (both clean/merged); reap;
    // assert reaped, both children gone, branches ca/cb gone (branch -d
    // succeeded), parent gone; assert order via the gone-ness itself: a
    // worktree remove of A with B still present would have failed rc!=0.
  }, 30000);
  it('a child branch checked out elsewhere stops the run BEFORE the parent falls', () => {
    // child clean+merged but its branch also checked out in a sibling worktree
    // outside the parent → eval refuses child-branch-elsewhere; parent intact.
  }, 30000);
  it('resume in the children phase finishes only the SAME set — a new child refuses state-changed', () => {
    // run with a KILL stub that dies after the first child removal (stub
    // `_ws_unsupervise` cannot help here — kill inside the loop by making the
    // second child's removal fail: lock it, or chmod its dir); assert
    // breadcrumb == 'children'; git init a NEW stray under the parent;
    // resume → refused state-changed; nothing further removed.
  }, 30000);
  it('resume in the worktree phase with a live child refuses — old tombstones read as consented-empty', () => {
    // hand-write breadcrumb 'worktree' + tombstone WITHOUT children field
    // (the :1799 test's tombstone idiom), git init a child, resume →
    // state-changed, everything survives.
  }, 30000);
});
```

Write the bodies fully; the breadcrumb/tombstone hand-write idiom is at `ccd-ws-reap.test.ts:1799–1834`, the mid-tail kill idiom at `:735–787`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement in ONE commit** (the phase vocabulary is a closed set enforced across sites):
  1. `_ws_tombstone` gains `"children":[…]` — one string per consented child line (`path\tbranch\thead\tdirty`), from `REAP_CHILDLINES`; `null` never appears (an empty set is `[]` here — it IS a measurement, taken at eval).
  2. Phase case (~ccd:3929): `""|children|worktree|branch|clips) : ;;`
  3. `_ws_reap_tail`: in the fresh-run arm the first breadcrumb written becomes `children` (before any child falls); the teardown loop runs when `[[ "$resumed" == "" || "$resumed" == children ]]`: sort `REAP_CHILDLINES` (on resume: the tombstone's `children`) by path length descending (`awk '{print length($1) "\t" $0}' | sort -rn | cut -f2-`), per child `git -C "$main" worktree remove "$cpath"` then `git -C "$main" branch -d "$cbr"`; any failure prints `'{"refused":"worktree-remove-failed",…}'` (reusing the existing token, detail naming the child) and `return 0` — the rest stand, the breadcrumb stays `children`. After the loop: `_reg_set "$id" reaping worktree` and the existing steps continue; the step-(f) disjunction (~4041) becomes `[[ "$resumed" == "" || "$resumed" == children || "$resumed" == worktree ]]`.
  4. `_ws_reap_locked` resume fork: after the tombstone tip read (~3734), re-derive the live set (`_ws_nested_checkouts` + `_ws_children`); load consented lines from the tombstone (`children` absent → consented-empty). In phase `children`: every live child line must appear among consented lines and no strays — else `state-changed` refusal quoting what changed. In phases `worktree|branch|clips`: the live set must be empty — else `state-changed`. The parent-tip check's case (~3761) is untouched (`children` falls into the `*` arm, which is correct — the parent branch must not have moved).
- [ ] **Step 4: Run** the full `ccd-ws-reap` suite including `:1799` (closed set), `:2006` (resume completes without --expect when nothing changed), `:735` (journal ordering). Expect PASS at old count + 4.
- [ ] **Step 5: Commit** — `feat(ccd): ordered child teardown behind its own breadcrumb phase, resume-coherent`

### Task 9: D4 in ccd — `children[]` on the audit wire

- [ ] **Step 1: Failing tests** (`ccd-ws-audit.test.ts`):

```ts
  it('children[] carries path/branch/headOid/dirty/busy/stray — the facts the fingerprint hashes', () => {
    // one registered dirty child + one stray; audit; expect children to
    // contain both, the stray with stray:true and null branch/headOid/dirty.
  }, 30000);
  it('children is NULL, not [], when Phase A refused before enumerating', () => {
    // detached-head refusal fixture from 'the fields a refusal never measured';
    // expect(a.children).toBeNull(); plus the hasOwnProperty + no-zero idioms.
  }, 30000);
  it('children is [] — a measurement — on a childless reapable workspace', () => {}, 30000);
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — in `cmd_ws_audit`: build `children_json` beside `clips_json` (~ccd:3055) in a `local` with the producer's rc visible: run the walk + `_ws_children` + per-child status/op probes even on ladder refusals **iff** Phase A passed and the workdir exists (mirror how `ignored` is only measured inside the `exists` arm); `null` when not measured or when any read failed. Emit between `transcript` and the verdict ladder:

```bash
  printf '"children":%s,' "$children_json"
```

Entry shape: `{"path":"…","branch":"…"|null,"headOid":"…"|null,"dirty":N|null,"busy":"rebase"|null,"stray":false|true}`.
- [ ] **Step 4: Run, expect PASS** (including the refusal-null describe).
- [ ] **Step 5: Commit** — `feat(ccd): the audit names the children it will refuse for`

### Task 10: D4 server/shared — `WsAuditChild`, `children`, and a real revive

**Interfaces — Produces:** `WsAuditChild { path: string; branch: string | null; headOid: string | null; dirty: number | null; busy: string | null; stray: boolean }`; `WsAudit.children: WsAuditChild[] | null`; `reviveWsAudit(v: unknown, sentence: string): WsAudit` (literal return — a new `WsAudit` field that is not revived is a compile error). Consumed by Task 11.

- [ ] **Step 1: Failing tests** — extend `server/test/wsaudit.test.ts` (`parseAudit` describe): malformed `children` (a string) → `null` return; valid children round-trip; a field ccd emits that the type lacks is DROPPED (the revive's discipline, asserted). Update `pr-routes.test.ts`'s `AUDIT` fixture (~:298) to include `children: []`.
- [ ] **Step 2: Run, expect FAIL** (type errors first — that is the tripwire working).
- [ ] **Step 3: Implement** — add `WsAuditChild` + `children` to `shared/api.ts` (before `verdict`); write `reviveWsAudit` beside `reviveFleetSession` using the same `reqStr/optStr/optNum/reqBool/asObj` helpers and the literal-return pattern for ALL fields (including nested `pr`, `merge`, the four nullable arrays, and `children`); rewrite `parseAudit` to `try { return reviveWsAudit(v, sentence) } catch { return null }`. `parseReap` stays as-is (out of scope).
- [ ] **Step 4: Run** `vitest run test/wsaudit.test.ts test/pr-routes.test.ts` + `tsc --noEmit`. Expect PASS.
- [ ] **Step 5: Commit** — `feat(server): the audit payload is revived field-by-field — children included, forgery excluded`

### Task 11: D4 pwa — the sheet stops lying

- [ ] **Step 1: Failing tests** (`pwa/test/reap-sheet.test.tsx`): the `audit()` factory at :8 gains `children: null` (compile tripwire fires without it); new tests:

```tsx
  it('renders children as named checkouts with branch and state, never inside the ignored total', async () => {
    auditBody = audit({ verdict: 'nested-checkouts-present', sentence: 'Checkouts of their own…',
      children: [{ path: '/w/.claude/worktrees/agent-a', branch: 'ca', headOid: 'a'.repeat(40), dirty: 2, busy: null, stray: false },
                 { path: '/w/.claude/worktrees/rogue', branch: null, headOid: null, dirty: null, busy: null, stray: true }] });
    open();
    expect(await screen.findByText(/agent-a/)).toBeInTheDocument();
    expect(screen.getByText(/2 uncommitted/)).toBeInTheDocument();
    expect(screen.getByText(/not registered/)).toBeInTheDocument();
  });
  it('scopes the cannot-be-recovered sentence when live checkouts sit inside the total', async () => {
    // children non-empty → the qualified sentence; children: []/null → the original.
  });
  it('renders no children row at all for children:null — "not scanned" stays at three', async () => {
    // findAllByText('not scanned') still toHaveLength(3)
  });
```

Also update `fleet-screen.test.tsx`'s untyped inline `wsAudit` fixture (~:391) with `children: []` — it will NOT fail compile; update it deliberately.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** in `ReapSheet.tsx`: a `.reap-children` block between the `</dl>` (~:436) and the refusal paragraph (~:438) — children render only when `shown.children !== null && shown.children.length > 0`: per child one line, `{path} — {branch ?? 'detached'}, N uncommitted, mid-{busy}` with `stray` children rendered as `{path} — not registered with git, contents unknown`. Scope the sentence at ~:330:

```tsx
<span className="reap-note">
  {(shown.children?.length ?? 0) > 0
    ? 'These are in no commit and cannot be recovered — except the nested checkouts listed below, which are live repositories.'
    : 'These are in no commit and cannot be recovered.'}
</span>
```

CSS: `.reap-children`/`.reap-child` beside the reap rules in `pwa/src/session/chat.css` (~:264), matching `.reap-sensitive`'s look.
- [ ] **Step 4: Run** `vitest run test/reap-sheet.test.tsx test/fleet-screen.test.tsx` + `tsc --noEmit` in pwa. Expect PASS.
- [ ] **Step 5: Commit** — `feat(pwa): the reap sheet names the children it refuses for, before the tap`, push, **open PR 2**, full three suites green, merge when CI green.

---

# PR 3 — `feat/ws-riders` (D5 — independent, small, one branch)

### Task 12: Archive/Restore in the `...` menu

**Files:** Modify `pwa/src/fleet/SessionActionsSheet.tsx`; Test `pwa/test/session-actions-sheet.test.tsx`.

- [ ] **Step 1: Failing tests** (follow the file's own gating idiom at :125–134 and URL-assertion idiom at :70–79):

```tsx
describe('archive and restore (D5 rider 1)', () => {
  it('Archive shows only for an unarchived workspace session, and POSTs /archive', async () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/archive'))).toBe(true));
  });
  it('Restore shows only on the complement, and POSTs /restore', async () => { /* archivedAt: 1785300000 */ });
  it('no workspace → neither appears', () => { /* s({ workspace: null }) → queryByText null for both */ });
  it("failure toasts Couldn't archive — with ccd's own words", async () => {
    // stubFetch({ ok: false, stderr: 'not merged' }) → findByText(/Couldn't archive — not merged/)
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** between the Swap button (:98) and the cleanup block (:100), following the sheet's own `restart` pattern verbatim (busy flag, `apiErrorText`, success = `onClose()`, state via the 2s fleet push):

```tsx
          {session.workspace !== null && session.archivedAt === null && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void archiveNow()}>
              {archBusy ? 'Archiving…' : 'Archive workspace'}
            </button>
          )}
          {session.workspace !== null && session.archivedAt !== null && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void restoreNow()}>
              {archBusy ? 'Restoring…' : 'Restore workspace'}
            </button>
          )}
```

with `archiveNow`/`restoreNow` copying `restart`'s try/catch shape and toasting `` `Couldn't archive — ${apiErrorText(err)}` `` / `` `Couldn't restore — …` ``. No server, whitelist, CCD_ARGV, or store changes (all measured present).
- [ ] **Step 4: Run, expect PASS** (suite count 14 → 18).
- [ ] **Step 5: Commit** — `feat(pwa): archive and restore from the session actions sheet`

### Task 13: `archivedreason` tells the truth

**Files:** Modify `ccd/ccd` (`cmd_ws_archive`, ~:1345); Test `server/test/ccd-archive.test.ts` (find the readers: `grep -n archivedreason server/test/*.ts` — the three reading tests update in this commit).

- [ ] **Step 1: Failing tests**: archive an empty branch (no commits beyond base) → `archivedreason == 'empty'`; archive an unmerged branch → `'manual'`; archive a squash-merged one with a bound PR → `'merged:#42'` (existing behavior, re-pinned).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — replace the two-value write at ~ccd:1345–1347:

```bash
  local pr reason ahead base
  pr=$(_reg_get "$id" prnumber)
  _reg_set "$id" archived "$(date +%s)"
  base=$(git -C "$main" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || base=""
  ahead=""
  [[ -n "$base" ]] && ahead=$(git -C "$workdir" rev-list --count "$base..HEAD" 2>/dev/null) || ahead=""
  if [[ "$ahead" == 0 ]]; then reason="empty"
  elif [[ "$pr" =~ ^[0-9]+$ ]] && _ws_gc_merged "$main" "$branch"; then reason="merged:#$pr"
  else reason="manual"; fi
  _reg_set "$id" archivedreason "$reason"
```

(`_ws_gc_merged`'s unprovable state already answers rc 1 → `manual`; a merged branch without a bound PR number also lands `manual` — stated, accepted: the three-value vocabulary is closed.) Update the archive's stdout note to match. Zero non-test consumers measured; the registry `FIELDS` list in `ccd-workspaces.test.ts:117` already contains `archivedreason`.
- [ ] **Step 4: Run** `vitest run test/ccd-archive.test.ts` — PASS.
- [ ] **Step 5: Commit** — `fix(ccd): archivedreason answers empty/manual/merged:#N, not merged-always`

### Task 14: `listProjects` skips linked-worktree masquerades — both doors

**Files:** Modify `server/src/lifecycle.ts:28–56`; Test `server/test/lifecycle.test.ts` (the pinned expected array at :200–205 updates).

- [ ] **Step 1: Failing tests**: (a) a dir under the projects root whose `.git` is a FILE (write `gitdir: /x` into it) is skipped; (b) a plain non-git dir (the four legit fixtures' shape: cctest, cab-batch…) is NOT skipped; (c) a registry record whose workdir readdir-probes as a linked worktree is skipped by the union loop; (d) a registry record with a MISSING workdir is still listed (the :213 test's pinned behavior, restated in the new world).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — a shared probe inside the module:

```ts
/** A linked worktree (or submodule) masquerading as a project: `.git` exists
 *  but is a FILE. readdir-null is the only file-vs-dir probe FleetIO affords —
 *  it succeeds for a directory and answers null for a plain file. A dir with
 *  NO .git at all is a legitimate non-git project (four exist on the fleet)
 *  and must never be skipped; an UNREADABLE workdir stays listed, same as
 *  today — this probe only ever removes what it positively identified. */
const isLinkedWorktree = async (io: FleetIO, workdir: string): Promise<boolean> => {
  const names = await io.readdir(workdir);
  if (names === null || !names.includes('.git')) return false;
  return (await io.readdir(path.join(workdir, '.git'))) === null;
};
```

Root loop: after the existing `readdir(workdir) === null` skip, add `if (await isLinkedWorktree(io, workdir)) continue;` (note: reuse the first readdir's result rather than re-reading — refactor the loop to hold `names`). Union loop: `if (!byWorkdir.has(rec.workdir) && !(await isLinkedWorktree(io, rec.workdir))) byWorkdir.set(…)`.
- [ ] **Step 4: Run** `vitest run test/lifecycle.test.ts` — PASS with the updated expected array.
- [ ] **Step 5: Commit** — `fix(server): a linked worktree cannot masquerade as a project — either door`, push, **open PR 3**, merge when green.

---

# Final gate (after PR 3 merges)

- [ ] All three suites + three typechecks green on main at their new counts (record them: server was 57 files/1117, agent 14/211, pwa 40/903 before this plan).
- [ ] `bash scripts/extraction-manifest.sh` still exits 0.
- [ ] Deploy is NOT part of this plan — shipping the new ccd/server/pwa to the fleet is a separate operator decision (the deploy.sh from the canonicalisation runbook is ready when wanted).

## Self-review record (writing-plans checklist, run 2026-08-04)

- **Spec coverage:** D1 → Tasks 1–4 (all three removal sites — one more than the spec knew). D2 → Tasks 5, 6, 8. D3 → Tasks 7, 8 (tombstone + resume). D4 → Tasks 9, 10, 11 (including creating the revive the spec believed existed). D5.1/2/3 → Tasks 12/13/14. Cut list respected: no adoption, no info/exclude write, no empty-branch reap rung, no bulk triage. Testing-strategy fixtures 1–6 all appear (1→T6, 2→T3/T6, 3→T7/T8, 4→T8, 5→T5, 6→T12–14).
- **Placeholder scan:** the four Task-6 step-1 test bodies and two Task-8 bodies are described by construction recipe rather than full code — deliberate: their fixtures are line-for-line copies of named existing tests (`squashMovedBase`, `:1799`, `:735`) that the implementer must read anyway; every assertion and token is stated. No TBD/TODO items remain.
- **Type consistency:** `WsAuditChild` fields = ccd's emit keys = the fingerprint line fields (`path/branch/headOid/dirty` + `busy`/`stray` measured for the wire only). Token names identical across ccd, SENTENCES, and tests: `nested-checkouts-present`, `child-dirty`, `child-busy`, `child-unpushed`, `child-branch-elsewhere` — all colon-free.
