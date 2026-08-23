# Smart Branch Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace born `ws/soft-prairie` renames itself to `ws/brainstorm-helix-and-slide-notes` within ten seconds of Claude Code writing the `ai-title` it already generated — and the new name types itself into the fleet line.

**Architecture:** `ccd ws-rename` moves from the positional generation to `--session/--branch` with a JSON refusal envelope, so a refusal is an answer the server can read rather than a stderr string indistinguishable from a transport failure. The server gains one argv entry, one grant, one timeout, and a fifth `FleetWatcher` lane at 10 s that reads the registry branch, tails 256 KB of transcript behind a stat gate, derives a slug, and calls the verb through the process's one `KeyedQueue` — which has to be hoisted out of `buildServer` first. The PWA wraps the existing single label definition in a typewriter.

**Tech Stack:** bash (ccd), TypeScript ESM (Node ≥22), vitest, React 19 + framer-motion (already a dependency). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-ccrc-smart-branch-naming-design.md`

**Depends on `docs/superpowers/plans/2026-08-03-ccrc-caps-refresh.md`, already implemented on this branch (PR #3).** Its 60 s caps lane is what makes the new `ws-rename` grant visible to a running agent without a restart — without it a fleet whose ccd gains the verb keeps answering `unsupported` until someone restarts the agent, and every existing workspace stays unnamed for the duration.

## Global Constraints

- **The slug budget is 40 characters and it excludes the `ws/` prefix.** `ws/` + at most 40 = at most 43 characters on the wire.
- **The boundary rule is: cut at 40, then drop back to the last `-` at or before the cut, never forward past it.** If the first 40 characters contain no `-` at all, hard-cut at 40. A cut that lands exactly on a `-` (`slug[40] === '-'`) is already a word boundary and drops back no further.
- **The retry key is `<id>:<derived-branch>`** — the derived name, not the born slug. One attempt per (session, derived name), in memory, deliberately not durable.
- **A refusal marks the pair attempted. An `unsupported` verb does NOT** — and the `verbSupported` check therefore runs **before** the stat probe is recorded, or a fleet that upgrades its ccd would skip the re-read of every transcript that had not changed since.
- **A `ws-rename` refusal prints JSON on stdout and exits 0.** Only `ccd:1241` (`git branch -m … || die`) keeps a non-zero exit: it is a fault, not a refusal.
- **`infra/ccrc/` is the live deploy source until spec 3.** Any change here also lands in `ccrc-pwa` (finding 4 of `2026-08-03-ccrc-pwa-findings-for-specs-1-3.md`). `infra/<server-host>-portability/ccd` is not in that repo and is installed to `~/.local/bin/ccd` on the box by hand.
- **Mutation sweep the whole diff** — one literal mutant per added construct, full suite per mutant, sha256-verified restore between. Per `.superpowers/sdd/<plan>/CONSTRAINTS.md`.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `infra/<server-host>-portability/ccd` | `_ws_rename_refuse` + `cmd_ws_rename` (`:1153-1244`) | flags, exact arity, 13 refusal tokens, JSON success |
| `infra/ccrc/server/src/wsaudit.ts` | refusal-token → sentence map | +9 entries; `wsaudit.test.ts` enforces set equality against ccd's source |
| `infra/ccrc/server/test/ccd-ws-rename.test.ts` | the verb's own suite (24 cases today) | rewrite the 19 `ws-rename` cases; +5 new |
| `infra/ccrc/server/test/ccd-workspaces.test.ts` | `ws-rm` after a rename (`:479`) | the one positional caller left in the suite |
| `infra/ccrc/server/src/ccdargv.ts` | the only place a ccd argv is built | add `wsRename` |
| `infra/ccrc/agent/src/whitelist.ts` | the exec grant list + gated-verb table | add `['ws-rename','--session']`, `REQUIRED_VERB_FLAG` entry |
| `infra/ccrc/agent/test/types/ok/legit-whitelist.ts` | compile-level pins on the rule tables | add `RenameNeedsSession` |
| `infra/ccrc/server/src/remote/runner.ts` | per-verb timeouts | add `'ws-rename': 20_000` |
| `infra/ccrc/server/test/whitelist-subset.test.ts` | `SAMPLES`/`EXPECTED` (compile-enforced) | add `wsRename` to both |
| `infra/ccrc/server/src/naming.ts` | new — title → branch | create |
| `infra/ccrc/server/src/transcript/title.ts` | new — the stat-gated `ai-title` tail read | create |
| `infra/ccrc/server/test/naming.test.ts` | new — derivation + title read | create |
| `infra/ccrc/server/src/server.ts` | `Deps`, `buildServer`'s `sendDeps` | `queue` becomes a `Deps` field |
| `infra/ccrc/server/src/index.ts` | composition root | owns the one `KeyedQueue` |
| `infra/ccrc/server/src/watch.ts` | the sweep lanes | add `NAME_SWEEP_MS` lane + the probe map |
| `infra/ccrc/server/test/name-sweep.test.ts` | new — the lane's four conditions | create |
| `infra/ccrc/pwa/src/fleet/TypedLabel.tsx` | new — the typewriter | create |
| `infra/ccrc/pwa/src/fleet/SessionLine.tsx` | fleet line label (`:107`) | wrap in `TypedLabel` |
| `infra/ccrc/pwa/src/session/SessionHeader.tsx` | header crumb (`:170`) | wrap in `TypedLabel` |
| `infra/ccrc/pwa/test/typed-label.test.tsx` | new — streams, silent on mount, reduced motion | create |
| `infra/ccrc/pwa/test/archive-screen.test.tsx` | the born slug survives a rename | extend |
| `infra/ccrc/pwa/test/pr-sheet.test.tsx` | same | extend |
| `infra/ccrc/pwa/test/reap-sheet.test.tsx` | same | extend |

Seven test files gain one `KeyedQueue` import and one field each in Task 5; they are listed there rather than here.

---

### Task 1: `ws-rename` joins ccd's new generation

**Files:**
- Modify: `infra/<server-host>-portability/ccd:1153-1244` (`cmd_ws_rename`; `_ws_branch_valid` at `:1142-1151` is untouched, dispatch at `:5427` is untouched)
- Modify: `infra/ccrc/server/src/wsaudit.ts` (`SENTENCES`, `:17-98`)
- Modify: `infra/ccrc/server/test/ccd-ws-rename.test.ts` (the `describe('ws-rename')` block; the `_ws_branch_valid` block is untouched)
- Modify: `infra/ccrc/server/test/ccd-workspaces.test.ts:479`

**Interfaces:**
- Consumes: `_json_str` (`ccd:192`, the ONLY JSON-escaper in ccd — non-zero means python3 could not be RUN, and a bare `$(_json_str …)` inside a printf argument list swallows that status by construction, which is why the three record-builders probe once up front); `_reg_get`/`_reg_set` (`ccd:198-199`); `_ws_wt_branch`; `_ws_common_dir`; `_ws_branch_valid`.
- Produces: `_ws_rename_refuse <token> <detail>` — `{"refused":"<token>","detail":<json-string>,"paths":[]}` on stdout, exit 0. `cmd_ws_rename --session <id> --branch <name>` — success prints `{"renamed":<id>,"old":<branch>,"new":<branch>}`.

**Why `paths":[]` is carried into a verb that has no paths:** the spec adopts `ws-reap`'s envelope as *the shape* (`ccd:3690`, `:3880`), not as a family of per-verb shapes. Every reader keys on `refused`; an extra empty array costs nothing and one refusal shape across the new generation costs less than two.

**Why `SENTENCES` moves in this task:** `wsaudit.test.ts:52-101` scans ccd's own source for `"refused":"<token>"` and asserts **set equality** in both directions against `wsaudit.ts`'s `SENTENCES` (`expect(Object.keys(SENTENCES).sort()).toEqual(ccdTokens)`). Nine of the thirteen tokens are new, so without the entries this task ends red. Four already exist and are reused verbatim: `no-such-session`, `not-a-workspace`, `incomplete-registry`, `worktree-missing`.

- [ ] **Step 1: Rewrite the ws-rename suite against the new shape**

Replace the whole `describe('ws-rename', …)` block in `infra/ccrc/server/test/ccd-ws-rename.test.ts` (`:52-284`). Keep lines 1-50 exactly as they are — the imports, the `addOne()` helper and the `_ws_branch_valid` describe do not change.

```ts
describe('ws-rename', () => {
  /** Every refusal is an ANSWER now: one JSON object on stdout at exit 0. `h.sh`
   *  throws on a non-zero exit, so reading refusals through it is also the
   *  assertion that only `git branch -m` failing may exit non-zero. */
  const rename = (id: string, branch: string): Record<string, unknown> =>
    JSON.parse(h.sh(`cmd_ws_rename --session '${id}' --branch '${branch}'`)) as Record<string, unknown>;

  const refusal = (id: string, branch: string): string => {
    const o = rename(id, branch);
    expect(o.refused, `expected a refusal, got ${JSON.stringify(o)}`).toBeTruthy();
    return String(o.refused);
  };

  it('renames the branch and records it', () => {
    const wt = addOne();
    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('feat/real-name');
  });

  it('leaves the workspace slug, directory and id alone', () => {
    const wt = addOne();
    rename('demo-quiet-mesa', 'feat/real-name');
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  // ── arity and id validation: the whole point of leaving the positional
  // generation. `${1:?}`/`${2:?}` was a MINIMUM-arity guard whose usage line was
  // bash's, and extra argv was silently ignored.
  it('refuses anything but the exact four-token argv', () => {
    addOne();
    for (const argv of [
      '',
      '--session demo-quiet-mesa',
      '--branch feat/real-name',
      'demo-quiet-mesa feat/real-name',
      '--session demo-quiet-mesa --branch feat/real-name --draft true',
      '--branch feat/real-name --session demo-quiet-mesa',
    ]) {
      const o = JSON.parse(h.sh(`cmd_ws_rename ${argv}`)) as Record<string, unknown>;
      expect(o.refused, `ccd ws-rename ${argv}`).toBe('bad-args');
    }
  });

  it('refuses a session id that is not a session id, before any git command sees it', () => {
    addOne();
    expect(refusal('../../etc/passwd', 'feat/real-name')).toBe('bad-args');
    expect(refusal('demo quiet mesa', 'feat/real-name')).toBe('bad-args');
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'feat/real-name')).toBe('');
  });

  it('refuses once the branch has an upstream — the remote already has the old name', () => {
    const wt = addOne();
    h.git(wt, 'push', '-u', 'origin', 'HEAD:refs/heads/ws/quiet-mesa');
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('has-upstream');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists locally', () => {
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'feat/taken');
    expect(refusal('demo-quiet-mesa', 'feat/taken')).toBe('name-taken-local');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists on the remote', () => {
    const wt = addOne();
    // On origin but not local: exactly the case a local-only check would miss.
    h.git(wt, 'push', 'origin', 'HEAD:refs/heads/feat/taken-upstream');
    expect(refusal('demo-quiet-mesa', 'feat/taken-upstream')).toBe('name-taken-origin');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('renames anyway when origin is unreachable, and says so', () => {
    // Unreachable is not the same as taken. Refusing here would make ws-rename
    // unusable offline for a branch that has never been pushed.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(out).toContain('"renamed"');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(refusal('demo-quiet-mesa', 'feat/../escape')).toBe('bad-branch');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a session that is not a workspace', () => {
    h.sh(`_reg_set claude2-demo wrapper claude2
          _reg_set claude2-demo project demo
          _reg_set claude2-demo workdir ${path.join(h.home, 'projects', 'demo')}
          _reg_set claude2-demo uuid abc`);
    expect(refusal('claude2-demo', 'feat/real-name')).toBe('not-a-workspace');
  });

  it('refuses a registry row with no project or workdir', () => {
    h.sh(`_reg_set half-row uuid abc
          _reg_set half-row workspace quiet-mesa`);
    expect(refusal('half-row', 'feat/real-name')).toBe('incomplete-registry');
  });

  it('refuses an unknown id', () => {
    expect(refusal('nope-nothing', 'feat/real-name')).toBe('no-such-session');
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(refusal('demo-quiet-mesa', 'ws/quiet-mesa')).toBe('unchanged');
  });

  it('is reachable as a subcommand', () => {
    addOne();
    const o = JSON.parse(
      h.sh(`"${CCD}" ws-rename --session demo-quiet-mesa --branch feat/real-name`),
    ) as Record<string, unknown>;
    expect(o.new).toBe('feat/real-name');
  });

  // `git branch -m` failing is THE one path that keeps a non-zero exit: nothing
  // about the request was wrong, so it is a fault and not a refusal. The shim
  // spells its own `command git` passthrough, as every git stub in this suite does.
  it('exits non-zero when the rename itself fails — a fault, not a refusal', () => {
    const wt = addOne();
    const NOMV = `git() { [[ "$*" == *"branch -m"* ]] && { echo "fatal: nope" >&2; return 1; }; command git "$@"; };`;
    expect(() => h.sh(`${NOMV} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`))
      .toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // ── the branch name comes from git's worktree record, not from the directory ──
  // Every read and every write below used to be aimed at $workdir, i.e. at
  // whatever repository owns that DIRECTORY. Hand-delete the worktree and let
  // anything else land at that path and ws-rename read a STRANGER's branch name
  // and then renamed the stranger's branch, after which the registry recorded
  // the stranger's new name as ccrc's own.
  const mainDir = (): string => path.join(h.home, 'projects', 'demo');
  const branches = (glob: string): string => h.git(mainDir(), 'branch', '--list', glob);

  it('refuses a stale record whose directory came back as its own repository, and renames nothing', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`: the record stands
    h.git(h.home, 'init', '-b', 'stranger', wt);
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to rename\n');
    h.git(wt, 'add', 'PRECIOUS');
    h.git(wt, 'commit', '-m', 'someone else lives here');

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-foreign');
    // The stranger keeps its own branch, and never gains ours.
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('stranger');
    expect(h.git(wt, 'branch', '--list', 'feat/real-name')).toBe('');
    // ...and ccrc's own branch and registry row are exactly as they were.
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a stale record whose directory came back as ANOTHER repo’s worktree', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`
    h.makeRepo('other');
    h.git(path.join(h.home, 'projects', 'other'), 'worktree', 'add', '-b', 'ws/borrowed', wt);

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-foreign');
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'ws/borrowed'))
      .not.toBe('');
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'feat/real-name'))
      .toBe('');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 2 of three. Git HAS a registration for the path and it says `detached`:
  // a real state with a real, different remedy from rung 3, so it gets its own
  // words.
  it('refuses a recorded detached HEAD', () => {
    const wt = addOne();
    h.git(wt, 'checkout', '--detach');
    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('detached');
    expect(String(o.detail)).toContain('detached HEAD');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 3 of three: no registration at all. Reachable by hand — a botched
  // manual cleanup that deletes the worktree's admin directory leaves the
  // checkout in place with nothing in $main naming it. Nothing corroborates the
  // registry's branch name any more, so there is no name to rename; that is a
  // different sentence from "recorded, detached".
  it('refuses when git has no worktree record for the path', () => {
    addOne();
    fs.rmSync(path.join(mainDir(), '.git', 'worktrees', 'quiet-mesa'),
      { recursive: true, force: true });
    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('worktree-unregistered');
    expect(String(o.detail)).toContain('no worktree record');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 1, stated against the record rather than against the directory: the
  // rename runs in $main, and git's own registration for the worktree must come
  // out of it naming the new branch — that is what ws-rm later reads.
  it('renames in the project and leaves git’s record naming the new branch', () => {
    const wt = addOne();
    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${wt}"`)).toBe('feat/real-name');
    expect(branches('ws/quiet-mesa')).toBe('');
  });

  // ── the DIRECTORY can disagree with the record while still passing the guard ──
  // The stale-record cases above are caught by the identity guard, so they never
  // reach the rename itself. This fixture is the one that does: our workspace
  // directory has been restored from a copy of a SIBLING workspace of the same
  // project (a restore or an rsync that puts back the wrong one), so its `.git`
  // points at the sibling's admin directory and every in-DIRECTORY question
  // answers `ws/second-slug` — while git's record in $main still says the path is
  // ours on ws/quiet-mesa. Both worktrees belong to $main, so `_ws_common_dir`
  // sees one common directory on both sides and the guard passes, correctly:
  // nothing here is a stranger's. What is left to get right is which branch the
  // remaining reads and the write actually name.
  /** Returns [our workspace's directory, the sibling's]. */
  const restoredFromSibling = (): [string, string] => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=second-slug cmd_ws_add demo`);
    const ours = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'second-slug');
    fs.rmSync(ours, { recursive: true, force: true });
    fs.cpSync(sibling, ours, { recursive: true });
    return [ours, sibling];
  };

  // The rename runs in $main and names BOTH ends, so it can only ever move the
  // branch git's record named. One-arg `git -C "$workdir" branch -m "$new"`
  // renames the current branch of whatever repository owns the DIRECTORY — here
  // the sibling's registration — so it moves the sibling's branch, leaves ours
  // where it was, and still prints our name and records the new one.
  it('renames the recorded branch in the project, not the branch the directory has checked out', () => {
    const [ours, sibling] = restoredFromSibling();
    // The fixture: the two answers disagree, and only one of them is evidence.
    expect(h.git(ours, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/second-slug');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${ours}"`)).toBe('ws/quiet-mesa');

    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    // Ours moved, so the line it printed is true...
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(branches('feat/real-name')).not.toBe('');
    // ...and the sibling workspace still has its own branch and its own record.
    expect(branches('ws/second-slug')).not.toBe('');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${sibling}"`)).toBe('ws/second-slug');
  });

  // The upstream check is asked in $main and about $old BY NAME, which is the
  // only way it can be about the branch this rename is about. In-worktree
  // `@{u}` asks after the DIRECTORY's current branch instead: here that is the
  // sibling's, which has never been pushed, so the one guard that exists to stop
  // a rename after a push answers about the wrong branch and waves ours through.
  it('refuses because OUR branch has an upstream, though the directory’s branch has none', () => {
    const [ours] = restoredFromSibling();
    h.git(mainDir(), 'push', '-u', 'origin', 'ws/quiet-mesa');
    // The fixture: in the directory there is no upstream to find.
    expect(() => h.git(ours, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow();

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('has-upstream');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // The ruling on the missing-directory guard, pinned: ws-rename still REFUSES.
  // See the comment on the guard itself for why.
  it('refuses when the worktree directory is gone, though the record survives', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-missing');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-rename.test.ts`
Expected: FAIL. `cmd_ws_rename --session …` is read positionally, so `$1` is the literal `--session`, `[[ -f "$REG/--session.uuid" ]]` misses and bash's `die` exits 1 — `h.sh` throws and `JSON.parse` is never reached. The five `_ws_branch_valid` cases still pass.

- [ ] **Step 3: Add the refusal helper**

In `ccd`, immediately after `_ws_branch_valid`'s closing `}` (`:1151`) and before `cmd_ws_rename` (`:1153`):

```bash
# A refusal is an ANSWER: one JSON object on stdout, exit 0 — the shape
# `cmd_ws_reap` established (ccd:3690, :3880), and `ws-rename` is the SECOND
# verb to carry it, not the fourth. `pr-open` and `ws-archive` still die on
# stderr at exit 1.
#
# It matters here because the caller is no longer a human at a prompt: it is
# FleetWatcher's naming sweep, on the far side of the agent WS, where a
# non-zero exit with a stderr string is indistinguishable from the agent being
# down — and "this branch is already pushed, never rename it" must not be
# retried the way a transport failure is.
#
# `paths` is carried verbatim rather than trimmed. It names nothing here, and
# that is the point: one refusal shape for the new generation, keyed on
# `refused` by every reader, beats a second shape that differs by one empty
# array.
_ws_rename_refuse() {   # token detail
  printf '{"refused":"%s","detail":%s,"paths":[]}\n' "$1" "$(_json_str "$2")"
}
```

- [ ] **Step 4: Rewrite the verb**

Replace `cmd_ws_rename` in full — `ccd:1153` (`cmd_ws_rename() {   # id new-branch — rename a workspace branch before it is pushed`) through its closing `}` at `:1244`. Every long comment in the body is kept **verbatim**; only the guards' failure arms change. The replacement:

```bash
cmd_ws_rename() {   # ccd ws-rename --session <id> --branch <name>
  # `_json_str`'s status, checked ONCE and up front — the same probe, for the
  # same reason, as `_ws_manifest` (ccd:1388), `cmd_ws_audit` and `cmd_ws_reap`
  # (ccd:3613). This is the FOURTH caller that builds a whole record, and every
  # refusal below quotes its detail inside a printf ARGUMENT LIST, where a
  # failure is a swallowed status and an empty argument — `"detail":,` — i.e. a
  # document the server reports as a parse error rather than as the refusal it
  # actually was. BEFORE the arity check, because `bad-args` is itself one of
  # the refusals that needs quoting. python3 missing is a FAULT, not a refusal:
  # the verb cannot answer at all.
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the rename answer safely"

  # Exact arity, no getopt loop, no "$@" passthrough — the same shape
  # `cmd_pr_open` (ccd:1794) and `cmd_ws_reap` (ccd:3594) use. The positional
  # form this replaces was a MINIMUM-arity guard (`${1:?}`/`${2:?}`) whose usage
  # refusal was bash's rather than ccd's, and it ignored extra argv silently.
  [[ $# -eq 4 && $1 == --session && $3 == --branch ]] \
    || { _ws_rename_refuse bad-args "usage: ccd ws-rename --session <id> --branch <name>"; return 0; }
  local id=$2 new=$4
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] \
    || { _ws_rename_refuse bad-args "bad session id: $id"; return 0; }

  [[ -f "$REG/$id.uuid" ]] \
    || { _ws_rename_refuse no-such-session "ccrc has no registry entry for $id"; return 0; }

  local ws project workdir
  ws=$(_reg_get "$id" workspace); project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  # The absence of a workspace field is what distinguishes a main checkout.
  [[ -n "$ws" ]] \
    || { _ws_rename_refuse not-a-workspace "$id is not a workspace — refusing to rename a main checkout's branch"; return 0; }
  [[ -n "$project" && -n "$workdir" ]] \
    || { _ws_rename_refuse incomplete-registry "incomplete registry for '$id'"; return 0; }
  # KEPT deliberately, now that the branch no longer has to be read out of the
  # directory. The record does survive a hand-deletion, so this rename WOULD
  # work — but ws-rename exists for a workspace still being worked in, and a
  # vanished directory is a broken one. Renaming would print a success line and
  # say nothing about the breakage, hiding exactly what ws-gc exists to surface;
  # refusing names it, and ws-rm already handles a gone directory deliberately.
  [[ -d "$workdir" ]] \
    || { _ws_rename_refuse worktree-missing "worktree is gone: $workdir"; return 0; }
  # NOT re-implemented on the server. This rule has one definition, on the box,
  # and the server learns its verdict from the `bad-branch` token — two
  # implementations of one rule drift, which is what they do.
  _ws_branch_valid "$new" \
    || { _ws_rename_refuse bad-branch "invalid branch name: $new"; return 0; }

  local main="$PROJECTS_ROOT/$project"
  # THE branch source of truth, same as cmd_ws_rm: git's own record for that
  # path, read from $main. Never `rev-parse` inside $workdir — that answers from
  # whatever repository owns the DIRECTORY, and a hand-deletion plus a stray
  # `git init` made that a stranger, whose branch was then read AND renamed.
  # Two statements: with no `set -e`, `local old=$(...)` returns local's status.
  local old registered
  old=$(_ws_wt_branch "$main" "$workdir"); registered=$?
  # Three rungs, because "no record at all" and "recorded detached" are different
  # states with different remedies, and only one of them is about a broken record.
  #   3: no registration at all (a botched hand cleanup that deleted
  #      $main/.git/worktrees/<name>). Nothing corroborates the registry's name
  #      any more, so there is no name to rename — same rule as ws-rm's
  #      uncorroborated case, and the registry field is named, never used.
  #      `git worktree repair` is NOT offered: measured on git 2.43.0 it exits 1
  #      here ("unable to locate repository") — it cannot rebuild a record that
  #      was deleted. Re-adding the worktree can, once the orphaned checkout is
  #      out of the way (measured: rc 0, and no prune needed — no record stands).
  local reg_branch; reg_branch=$(_reg_get "$id" branch)
  (( registered == 0 )) \
    || { _ws_rename_refuse worktree-unregistered "no worktree record for $workdir in $main — nothing renamed; with no registration no branch name is corroborated (the registry says '${reg_branch:-?}', which nothing now ties to that path): move the leftover directory aside, then git -C $main worktree add $workdir ${reg_branch:-<branch>}"; return 0; }
  #   2: registered, and the registration says `detached`. The remedy is to check
  #      a branch out, not to repair anything.
  [[ -n "$old" ]] \
    || { _ws_rename_refuse detached "$id is on a detached HEAD — nothing to rename"; return 0; }
  #   1: registered, with a branch — $old is git's own name for it.
  # ...but a registration outlives its directory, so it can be STALE: delete the
  # directory by hand, put anything else at that path, and git still names it —
  # `registered` is still 0 and $old is still ccrc's branch, so nothing above
  # notices that the workspace this rename is *about* has been taken over. Ask
  # the directory too and require both to say $main, exactly as cmd_ws_rm does.
  # (The stranger is never written to either way, now that both the read and the
  # rename are scoped to $main; what this guard refuses is renaming on behalf of
  # a workspace that no longer exists.) Recovery measured on git 2.43.0: the
  # stale record makes `worktree add` refuse until `prune` clears it, and prune
  # only drops records whose directory is missing — hence both, in that order.
  local wd_common main_common
  wd_common=$(_ws_common_dir "$workdir"); main_common=$(_ws_common_dir "$main")
  [[ -n "$main_common" && "$wd_common" == "$main_common" ]] \
    || { _ws_rename_refuse worktree-foreign "$workdir is not a worktree of $main — nothing renamed; move or delete the directory by hand, then git -C $main worktree prune && git -C $main worktree add $workdir $old"; return 0; }
  [[ "$old" != "$new" ]] \
    || { _ws_rename_refuse unchanged "already named $new"; return 0; }

  # Renaming after a push leaves the old name on the remote and creates a second
  # branch there on the next push. An upstream is the evidence that happened.
  # Asked in $main and about $old by name: branch config is shared across a
  # repo's worktrees, so this is the same answer $workdir would give — from the
  # repo that actually owns the branch. Measured on git 2.43.0: rc 0 printing
  # `origin/<old>` with an upstream, rc 128 without one.
  #
  # THE load-bearing refusal, and the reason automatic naming is safe to run
  # unattended: a branch that has been pushed is never renamed.
  if git -C "$main" rev-parse --abbrev-ref "$old@{u}" >/dev/null 2>&1; then
    _ws_rename_refuse has-upstream "$old has an upstream — it is already on the remote; rename before pushing, not after"
    return 0
  fi

  git -C "$main" show-ref --verify --quiet "refs/heads/$new" \
    && { _ws_rename_refuse name-taken-local "branch already exists locally: $new"; return 0; }

  # --exit-code: 0 = the head exists, 2 = it does not, anything else = we could
  # not ask. Unreachable is not the same as taken.
  local rc; git -C "$main" ls-remote --exit-code --heads origin "$new" >/dev/null 2>&1; rc=$?
  case "$rc" in
    0) _ws_rename_refuse name-taken-origin "branch already exists on origin: $new"; return 0 ;;
    2) : ;;
    *) echo "warn: could not reach origin to check for '$new' — renaming anyway" >&2 ;;
  esac

  # Scoped to the repo that owns the branch, and named on both sides so it can
  # never resolve against whatever HEAD $workdir happens to have. Measured on git
  # 2.43.0: this works on a branch checked out in a linked worktree and retargets
  # that worktree's HEAD and its registration with it (before `branch
  # refs/heads/feat/a`, after `branch refs/heads/feat/b`, rc 0) — which is what
  # lets ws-rm read the new name back out of the record afterwards.
  #
  # THE ONE PATH THAT KEEPS A NON-ZERO EXIT. It is a fault, not a refusal:
  # nothing about the request was wrong, and the caller must not mark the pair
  # attempted-and-answered on the strength of it.
  git -C "$main" branch -m "$old" "$new" || die "rename failed: $old -> $new"
  _reg_set "$id" branch "$new"
  printf '{"renamed":%s,"old":%s,"new":%s}\n' \
    "$(_json_str "$id")" "$(_json_str "$old")" "$(_json_str "$new")"
}
```

The dispatcher arm (`ccd:5427`, `ws-rename) shift; cmd_ws_rename "$@" ;;`), the usage line at `:5437` and `cmd_caps`'s `ws-rename` entry (`:1283`) are all unchanged — the verb's NAME did not move.

- [ ] **Step 5: Move the one positional caller left in the suite**

`infra/ccrc/server/test/ccd-workspaces.test.ts:479` is the only other place in the repo that invokes the verb. Replace:

```ts
    sh(`cmd_ws_rename demo-quiet-mesa feat/renamed`);
```

with:

```ts
    sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/renamed`);
```

- [ ] **Step 6: Give the nine new tokens their copy**

`wsaudit.test.ts` greps ccd's source for `"refused":"<token>"` and demands **exact set equality** with `SENTENCES`, in both directions. In `infra/ccrc/server/src/wsaudit.ts`, append to the `SENTENCES` object, after the `'clips-unreadable'` entry (`:97`):

```ts
  // ── ws-rename (spec 2). Nine tokens whose copy no sheet renders TODAY:
  // automatic naming logs its refusals server-side and surfaces nothing in the
  // PWA, and no manual rename control is built. They are here because
  // `wsaudit.test.ts` enumerates ccd's source and requires the two sets to be
  // EQUAL — the mechanism that caught `branch-drift` -> `registry-branch-drift`
  // — and because if a rename control is ever added the copy is already right
  // rather than a bash identifier on a phone screen. Four more of ws-rename's
  // thirteen tokens (`no-such-session`, `not-a-workspace`, `incomplete-registry`,
  // `worktree-missing`) are shared with ws-reap and are already above.
  'bad-args': 'ccrc built a rename call ccd could not read. This is a ccrc bug, not something about this workspace.',
  'bad-branch': 'The name this would rename the branch to is not a valid git branch name.',
  'worktree-unregistered': 'git has no record of this directory as a worktree of this project, so there is no branch name to rename.',
  'detached': 'git has this worktree on a detached HEAD, so there is no branch to rename.',
  'worktree-foreign': 'This directory belongs to a different repository than the project it is registered under. Nothing was renamed.',
  'unchanged': 'The branch already has this name.',
  'has-upstream': 'This branch has already been pushed. Renaming it now would leave the old name on the remote and open a second branch there on the next push.',
  'name-taken-local': 'A branch with that name already exists in this project.',
  'name-taken-origin': 'A branch with that name already exists on the remote.',
```

- [ ] **Step 7: Run both suites**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-rename.test.ts test/ccd-workspaces.test.ts test/wsaudit.test.ts`
Expected: PASS. `wsaudit.test.ts`'s `'the two sets are exactly equal'` is the one to read: it prints the full token list on failure, so a typo in a token name here shows as a diff of two sorted arrays rather than as a mystery.

- [ ] **Step 8: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/src/wsaudit.ts infra/ccrc/server/test/ccd-ws-rename.test.ts infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): ws-rename answers in JSON instead of dying on stderr

Twelve prose refusals become twelve tokens on stdout at exit 0, plus a
thirteenth for an argv ccd cannot read. Only \`git branch -m\` failing keeps a
non-zero exit — it is a fault, and nothing about the request was wrong.

The flags are not cosmetics: the agent's exec whitelist matches by prefix, so a
positional verb can only be granted as the one-token \['ws-rename'], which
permits any argv at all after it."
```

---

### Task 2: The server may emit it

**Files:**
- Modify: `infra/ccrc/server/src/ccdargv.ts:56-77` (`CCD_ARGV`)
- Modify: `infra/ccrc/agent/src/whitelist.ts:212-218` (`REQUIRED_VERB_FLAG` + its docstring), `:281-296` (`EXEC_WHITELIST.ccd`)
- Modify: `infra/ccrc/agent/test/types/ok/legit-whitelist.ts:69-70`
- Modify: `infra/ccrc/server/src/remote/runner.ts:27-37` (`CCD_VERB_TIMEOUT_MS`)
- Modify: `infra/ccrc/server/test/whitelist-subset.test.ts:13-31` (`SAMPLES`), `:225-242` (`EXPECTED`)

**Interfaces:**
- Consumes: `argv()` — the only mint site for `CcdArgv` (`ccdargv.ts:46`), `Object.freeze`d.
- Produces: `CCD_ARGV.wsRename(id: string, branch: string): CcdArgv` → `['ws-rename','--session',id,'--branch',branch]`. `EXEC_WHITELIST.ccd` gains `['ws-rename','--session']`; `REQUIRED_VERB_FLAG` gains `'ws-rename': '--session'`; `CCD_VERB_TIMEOUT_MS` gains `'ws-rename': 20_000`.

`SAMPLES` and `EXPECTED` are `Record<keyof typeof CCD_ARGV, string[]>`, so a missing key is **TS2741** under `typecheck-tests.test.ts`'s spawned tsc — this task cannot be half-done.

- [ ] **Step 1: Write the failing test**

In `infra/ccrc/server/test/whitelist-subset.test.ts`, add to `SAMPLES` (after the `wsAttic` line, `:30`):

```ts
  wsRename: ['demo-quiet-basin', 'ws/brainstorm-helix-and-slide-notes'],
```

and to `EXPECTED` (after its `wsAttic` line, `:241`):

```ts
  wsRename: ['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/brainstorm-helix-and-slide-notes'],
```

Then append a new assertion inside the `describe('layer 3 — the list never drifts wider than the code')` block, beside the `ws-reap` one:

```ts
  // The second entry in REQUIRED_VERB_FLAG, and the first one that is not
  // there because the verb is destructive. `ws-rename` is the first verb the
  // SERVER calls unattended — FleetWatcher's naming sweep, no human in the
  // loop — so the grant must name the flag rather than the verb: a bare
  // `['ws-rename']` permits `ccd ws-rename <anything> <anything…>`, which is
  // exactly the positional generation this spec left behind.
  it('ws-rename is grantable ONLY with --session', () => {
    const rn = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-rename');
    expect(rn.length, 'exactly one ws-rename grant').toBe(1);
    expect(rn[0]).toEqual(['ws-rename', '--session']);
    expect(isExecAllowed('ccd', ['ws-rename', 'demo-quiet-basin', 'ws/x'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-rename'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x')])).toBe(true);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/whitelist-subset.test.ts test/typecheck-tests.test.ts`
Expected: FAIL — `typecheck-tests.test.ts` reports TS2353 (`wsRename` does not exist in `Record<keyof typeof CCD_ARGV, string[]>`) on both new object entries, and the new `it` fails with `rn.length` 0.

- [ ] **Step 3: Add the argv entry**

In `ccdargv.ts`, after the `wsAttic` line (`:76`):

```ts
  /** The only ccd write with no human in the loop. `--branch` carries a name
   *  `_ws_branch_valid` has NOT seen yet: validation lives on the box, once,
   *  and the server learns its verdict from the `bad-branch` refusal token. */
  wsRename:  (id: string, branch: string) => argv(['ws-rename', '--session', id, '--branch', branch]),
```

- [ ] **Step 4: Grant it, and gate the flag**

In `agent/src/whitelist.ts`, replace the `REQUIRED_VERB_FLAG` docstring and constant (`:212-218`):

```ts
/**
 * Verbs that are only ever grantable WITH a mandatory flag immediately after
 * them. Two entries, for two different reasons.
 *
 * `ws-reap` is the destructive one: it deletes a workspace, its branch and its
 * clips, and `--expect <fingerprint>` is the token ccd re-proves against the
 * world before it does. A grant of bare `['ws-reap']` is not a smaller grant,
 * it is a DIFFERENT one — it permits an UNCONFIRMED reap, i.e. the exact thing
 * §7 says can never cross the wire.
 *
 * `ws-rename` destroys nothing, and is here because it is the first verb the
 * server calls UNATTENDED (FleetWatcher's naming sweep). Prefix matching means
 * a one-token `['ws-rename']` permits `ccd ws-rename <anything> <anything…>` —
 * the whole positional argv surface the verb used to have — for a call no
 * human ever reviews. Naming the flag makes the grant two tokens wide, and
 * makes losing it both a compile error and a boot refusal.
 *
 * Kept as data rather than a hardcoded `if` so the type below and the runtime
 * audit read the SAME source — the P2 failure mode (auditor and lookup asking
 * different questions) is the one to avoid while fixing P1.
 */
export const REQUIRED_VERB_FLAG = { 'ws-reap': '--expect', 'ws-rename': '--session' } as const;
```

and add the grant to `EXEC_WHITELIST.ccd`, after `['ws-attic', '--session'],` (`:295`):

```ts
    ['ws-rename', '--session'],  // unattended caller: the flag is what keeps the grant two tokens wide
```

In `agent/test/types/ok/legit-whitelist.ts`, after `ReapNeedsExpect` (`:69`):

```ts
export type RenameNeedsSession = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-rename'], '--session'>>;
```

- [ ] **Step 5: Give it a budget**

In `server/src/remote/runner.ts`, inside `CCD_VERB_TIMEOUT_MS` (`:27-37`), after the `'pr-state': 20_000,` line:

```ts
  // Same reach as pr-state, and the same number: it shells out to
  // `git ls-remote` against origin before it will rename. Without an entry it
  // silently inherits the flat 90 s, which is three sweeps' worth of lane.
  'ws-rename': 20_000,
```

- [ ] **Step 6: Run the gates this task moves**

Run: `cd infra/ccrc/agent && npx vitest run && cd ../server && npx vitest run test/whitelist-subset.test.ts test/verb-gate.test.ts test/ccdargv-brand.test.ts test/typecheck-tests.test.ts`
Expected: PASS everywhere **except** `verb-gate.test.ts`, which now fails `'has no ungated call site outside UNGATED_BY_DECISION'`? No — it must still PASS: `wsRename` has no call site yet, and the test only polices sites that exist. Record the agent suite's count; `auditExecWhitelist` runs at module load, so a malformed grant fails every agent test at once rather than one.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/server/src/ccdargv.ts infra/ccrc/agent/src/whitelist.ts infra/ccrc/agent/test/types/ok/legit-whitelist.ts infra/ccrc/server/src/remote/runner.ts infra/ccrc/server/test/whitelist-subset.test.ts
git commit -m "feat(ccrc): the server may emit ws-rename, but only with --session

REQUIRED_VERB_FLAG gains its second entry, and the first one that is not about
a destructive verb: ws-rename is the first verb the server calls with no human
in the loop, and a bare one-token grant would permit the entire positional argv
surface the verb just left behind.

20s, the same budget pr-state was given, because it reaches origin through
git ls-remote before it will rename anything."
```

---

### Task 3: The name the model wrote becomes a branch name

**Files:**
- Create: `infra/ccrc/server/src/naming.ts`
- Create: `infra/ccrc/server/test/naming.test.ts`

**Interfaces:**
- Consumes: nothing. A pure function — no io, no config, no clock.
- Produces: `SLUG_MAX = 40`; `deriveBranch(title: string): string | null` — `null` when the title slugifies to the empty string, otherwise `ws/<slug>` with `slug.length <= SLUG_MAX`.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/server/test/naming.test.ts`:

```ts
// The 40 is the SLUG's budget, not the branch's: `ws/` is three more characters
// on the wire and the rule deliberately does not count them.
import { describe, it, expect } from 'vitest';
import { SLUG_MAX, deriveBranch } from '../src/naming.js';

describe('deriveBranch', () => {
  it('lowercases, collapses every non-alphanumeric run to one dash, and prefixes ws/', () => {
    expect(deriveBranch('Fix the PR sheet')).toBe('ws/fix-the-pr-sheet');
    expect(deriveBranch('Debug: WHY does /api/fleet 502?')).toBe('ws/debug-why-does-api-fleet-502');
    expect(deriveBranch('  leading and trailing  ')).toBe('ws/leading-and-trailing');
    expect(deriveBranch('a___b...c')).toBe('ws/a-b-c');
  });

  it('produces a name ccd’s own _ws_branch_valid accepts', () => {
    // Not a second implementation of that rule — a demonstration that the
    // character class this function emits is a subset of the one ccd permits.
    // The verdict itself still comes from the box, as `bad-branch`.
    for (const t of ['Ünïcødé tïtlé', '!!!', 'a/b\\c:d', '.lock', 'trailing-']) {
      const b = deriveBranch(t);
      if (b === null) continue;
      expect(b, t).toMatch(/^ws\/[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('is null for a title with nothing alphanumeric in it', () => {
    expect(deriveBranch('')).toBeNull();
    expect(deriveBranch('   ')).toBeNull();
    expect(deriveBranch('—— ··· ——')).toBeNull();
  });

  // ── the 40-character budget ──
  it('the budget excludes the ws/ prefix', () => {
    const b = deriveBranch('x '.repeat(60));
    expect(b).not.toBeNull();
    expect(b!.slice('ws/'.length).length).toBeLessThanOrEqual(SLUG_MAX);
    expect(SLUG_MAX).toBe(40);
  });

  it('drops back to the last dash at or before the cut — never forward past it', () => {
    // The spec's own example. `brainstorm-helix-and-slide-notes-integration` is
    // 44 characters; a cut at 40 lands mid-`integration`, and dropping BACK
    // gives 32. Rounding forward would give the whole 44 and blow the budget.
    expect(deriveBranch('Brainstorm Helix and slide notes integration'))
      .toBe('ws/brainstorm-helix-and-slide-notes');
  });

  it('does not drop back when the cut already lands on a boundary', () => {
    // slug[40] === '-': the first 40 characters are a whole word run, so there
    // is nothing to drop back over. A blind lastIndexOf would lose `-a…a`'s
    // last word for no reason.
    const slug = 'a'.repeat(SLUG_MAX);
    expect(deriveBranch(`${'a'.repeat(SLUG_MAX)} b`)).toBe(`ws/${slug}`);
  });

  it('hard-cuts a single word with no dash in the first 40 characters', () => {
    // 46 characters, one word: there is no boundary to drop back to, so the
    // rule cuts at 40 rather than emitting nothing.
    expect(deriveBranch('Refactoringtheauthenticationmiddlewarepipeline'))
      .toBe('ws/refactoringtheauthenticationmiddlewarepi');
  });

  it('never emits a trailing dash', () => {
    // The cut can land immediately after a dash; the drop-back is what removes
    // it, and this is the assertion that says so rather than assuming it.
    for (let n = 30; n <= 60; n++) {
      const b = deriveBranch('ab '.repeat(n));
      expect(b, `n=${n}`).not.toBeNull();
      expect(b!, `n=${n}`).not.toMatch(/-$/);
      expect(b!.slice('ws/'.length).length, `n=${n}`).toBeLessThanOrEqual(SLUG_MAX);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/naming.test.ts`
Expected: FAIL — `Cannot find module '../src/naming.js'`.

- [ ] **Step 3: Write the function**

Create `infra/ccrc/server/src/naming.ts`:

```ts
/**
 * The branch name a workspace takes from the `ai-title` Claude Code already
 * wrote. No model call, no API key, no credits: the name exists and was paid
 * for on the first prompt.
 *
 * The `ws/` namespace is KEPT deliberately. `2026-07-28-ccrc-workspace-
 * lifecycle-design.md:62-64` chose it so a machine-created branch is
 * "namespaced, self-describing, sorts together"; a title-derived `feat/` or
 * `docs/` would need a judgement this has no way to make well and would
 * surrender that property for nothing.
 */

/** The slug budget, EXCLUDING the three characters of `ws/`. */
export const SLUG_MAX = 40;

/**
 * `null` when the title has nothing alphanumeric in it — not an empty string,
 * because `ws/` alone is a name `_ws_branch_valid` would take (it is not
 * empty, has no `..`, no leading dash) and a trailing-slash branch is a real
 * git ref hazard. A caller that gets `null` makes no call at all.
 *
 * The character class is a subset of what ccd's `_ws_branch_valid` permits, on
 * purpose — but this is NOT a second copy of that rule. The rule has one
 * definition, on the box; this only avoids sending names that are certain to
 * be refused, and the verdict still comes back as `bad-branch`.
 */
export function deriveBranch(title: string): string | null {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug === '') return null;
  if (slug.length <= SLUG_MAX) return `ws/${slug}`;

  // Cut at SLUG_MAX, then drop back to the last `-` at or before the cut. Two
  // details the naive form gets wrong:
  //   * `slug[SLUG_MAX] === '-'` means the cut ALREADY landed on a word
  //     boundary, so there is nothing to drop back over — a blind
  //     `lastIndexOf` would throw the last whole word away.
  //   * no `-` at all in the first SLUG_MAX characters (one long word) means
  //     there is no boundary to find, and the rule hard-cuts rather than
  //     emitting nothing.
  const cut = slug.slice(0, SLUG_MAX);
  if (slug[SLUG_MAX] === '-') return `ws/${cut}`;
  const at = cut.lastIndexOf('-');
  return `ws/${at === -1 ? cut : cut.slice(0, at)}`;
}
```

There is deliberately no trailing-dash strip at the end: the collapse leaves no `--` run and strips both ends, so `cut` can only end in `-` when `slug[SLUG_MAX - 1] === '-'` — and in that case `lastIndexOf` finds exactly that index and `slice(0, at)` removes it. The last test in Step 1 is what holds that reasoning to account.

- [ ] **Step 4: Run it**

Run: `cd infra/ccrc/server && npx vitest run test/naming.test.ts`
Expected: PASS, 8 cases.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/naming.ts infra/ccrc/server/test/naming.test.ts
git commit -m "feat(ccrc): a title becomes a branch name

The 40 is the slug's budget and excludes ws/. The boundary drops BACK to the
last dash at or before the cut — forward would blow the budget — and a cut that
already lands on a dash drops back no further, which a blind lastIndexOf would
get wrong by one whole word."
```

---

### Task 4: Reading the title without re-reading the world

**Files:**
- Create: `infra/ccrc/server/src/transcript/title.ts`
- Modify: `infra/ccrc/server/test/naming.test.ts` (append a second `describe`)

**Interfaces:**
- Consumes: `FleetIO` (`io.ts:11-24`) — `stat(path): Promise<{mtimeMs, size} | null>` and `readFileFrom(path, offset): Promise<{data: string; size: number} | null>`, both of which cross the agent WS in remote mode (`remote/io.ts:29-38`, `:60-70`) and both of which return `null` rather than throwing.
- Produces: `readAiTitle(io: FleetIO, file: string): Promise<string | null>` — the LAST non-blank `ai-title` in the tail, or `null`.

The signature mirrors `readPendingAsk(io, file)` (`transcript/ask.ts:54`) exactly, including its second `stat`: the caller stats to decide whether to read at all, and this stats again to size the tail. That is one extra ~100-byte RPC per session per sweep against a read of up to 256 KB, and it buys a function that is testable with `localIO` and a real file, exactly as `ask.test.ts` tests its neighbour.

- [ ] **Step 1: Write the failing test**

Append to `infra/ccrc/server/test/naming.test.ts`. The imports at the top of the file grow to:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { SLUG_MAX, deriveBranch } from '../src/naming.js';
import { readAiTitle } from '../src/transcript/title.js';
import { mkTmp } from './tmpHelpers.js';
```

and the new block goes at the end of the file:

```ts
describe('readAiTitle', () => {
  const TITLE = (t: string): string =>
    JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: '5016f833' });
  const USER = (text: string): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

  const fileWith = (lines: string[]): string => {
    const f = path.join(mkTmp('ccrc-title-'), 't.jsonl');
    writeFileSync(f, lines.join('\n') + '\n');
    return f;
  };

  it('reads the ai-title line nothing else in the codebase consumes', async () => {
    expect(await readAiTitle(localIO, fileWith([
      USER('do the thing'),
      TITLE('Brainstorm Helix and slide notes integration'),
      USER('now do the next thing'),
    ]))).toBe('Brainstorm Helix and slide notes integration');
  });

  it('takes the LAST one — Claude Code rewrites the line once per turn', async () => {
    expect(await readAiTitle(localIO, fileWith([
      TITLE('First guess'), USER('x'), TITLE('Second guess'),
    ]))).toBe('Second guess');
  });

  it('is null for a transcript that has none — nine of 609 on this box', async () => {
    expect(await readAiTitle(localIO, fileWith([USER('a'), USER('b')]))).toBeNull();
  });

  it('is null for a file that is not there at all', async () => {
    expect(await readAiTitle(localIO, path.join(mkTmp('ccrc-title-'), 'nope.jsonl'))).toBeNull();
  });

  it('survives the junk a live transcript actually carries', async () => {
    expect(await readAiTitle(localIO, fileWith([
      '', '   ', 'not json at all', 'null', '42', '"a string"',
      JSON.stringify({ type: 'ai-title' }),                   // no aiTitle
      JSON.stringify({ type: 'ai-title', aiTitle: 17 }),      // wrong type
      JSON.stringify({ type: 'ai-title', aiTitle: '   ' }),   // blank
      TITLE('The real one'),
    ]))).toBe('The real one');
  });

  it('reads a 256 KB tail, and finds a title that far back', async () => {
    // Measured across the 600 transcripts on this box that carry one: the last
    // ai-title sits at most 45,996 bytes from EOF (p95 31,177; median 12,687).
    // This fixture puts one at ~200 KB — inside the window — behind 2 MB of
    // noise that must NOT be read.
    const filler = USER('x'.repeat(2000));
    const f = fileWith([
      TITLE('Far too early to see'),
      ...Array.from({ length: 1000 }, () => filler),   // ~2 MB
      TITLE('Inside the window'),
      ...Array.from({ length: 100 }, () => filler),    // ~200 KB
    ]);
    expect(await readAiTitle(localIO, f)).toBe('Inside the window');
  });

  it('never returns half a line that the tail cut through', async () => {
    // The tail almost certainly starts mid-line; the first line of the chunk is
    // dropped. Without that, a truncated `{"type":"ai-ti` reaches JSON.parse.
    const f = fileWith([
      ...Array.from({ length: 200 }, (_, i) => TITLE(`stale ${i} ${'y'.repeat(2000)}`)),
      TITLE('The last one'),
    ]);
    expect(await readAiTitle(localIO, f)).toBe('The last one');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/naming.test.ts`
Expected: FAIL — `Cannot find module '../src/transcript/title.js'`. The `deriveBranch` block still passes.

- [ ] **Step 3: Write the reader**

Create `infra/ccrc/server/src/transcript/title.ts`:

```ts
// The line Claude Code has been writing since before ccrc existed, and which
// nothing has ever consumed: `ask.ts:12` names `ai-title` among the types it
// deliberately skips. It is a name a model generated from the first prompt, and
// it is already paid for.
import type { FleetIO } from '../io.js';

/** Measured across the 600 transcripts on this box that carry an `ai-title`:
 *  the last one sits at most 45,996 bytes from EOF (p95 31,177; median 12,687).
 *  256 KB is 5.5x headroom on the worst case, where 64 KB would be 1.4x and too
 *  tight. Same figure as `ask.ts`'s TAIL_BYTES, arrived at from a different
 *  measurement — and far under `tail.ts`'s 1 MB backlog window, which is what
 *  bounds the agent's RSS. */
const TITLE_TAIL_BYTES = 256 * 1024;

/**
 * The LAST `ai-title` in the transcript's tail, or `null`.
 *
 * `null` covers three states the caller treats identically: no transcript, an
 * unreadable one, and one that carries no title. That last is a PERMANENT
 * state, not a startup window — nine of the 609 transcripts on this box have
 * none at all, including some very large ones — which is why the caller
 * stat-gates this read rather than paying for it every sweep forever.
 *
 * Stats the file itself rather than taking a size, mirroring `readPendingAsk`
 * (`ask.ts:55-58`): the caller's own stat is the GATE, this one sizes the tail.
 * Two stats and one ranged read per session per sweep, and in remote mode all
 * three cross the agent WS.
 */
export async function readAiTitle(io: FleetIO, file: string): Promise<string | null> {
  const stat = await io.stat(file);
  if (stat === null) return null;
  const from = Math.max(0, stat.size - TITLE_TAIL_BYTES);
  const chunk = await io.readFileFrom(file, from);
  if (chunk === null) return null;

  const lines = chunk.data.split('\n');
  if (from > 0) lines.shift();   // the tail almost certainly cut a line in half

  let title: string | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    // `null` and bare primitives are valid JSON, so the catch above never sees them.
    if (parsed === null || typeof parsed !== 'object') continue;
    const o = parsed as { type?: unknown; aiTitle?: unknown };
    if (o.type !== 'ai-title' || typeof o.aiTitle !== 'string') continue;
    // LAST wins, not first: Claude Code rewrites the line once per turn.
    // Measured on a 91 MB transcript — 1,809 `ai-title` lines, one distinct
    // value — so in practice they agree; the rule is stated anyway because
    // "they always agree" is not something this can check.
    if (o.aiTitle.trim() !== '') title = o.aiTitle;
  }
  return title;
}
```

- [ ] **Step 4: Run it**

Run: `cd infra/ccrc/server && npx vitest run test/naming.test.ts`
Expected: PASS, 15 cases.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/transcript/title.ts infra/ccrc/server/test/naming.test.ts
git commit -m "feat(ccrc): read the ai-title ask.ts has been skipping

A 256 KB tail, the same window readPendingAsk uses, sized from a measurement of
the 600 transcripts on this box that carry one: the last sits at most 45,996
bytes from EOF. Last wins rather than first, because Claude Code rewrites the
line once per turn."
```

---

### Task 5: One queue for the process

**Files:**
- Modify: `infra/ccrc/server/src/server.ts:43-62` (`Deps`), `:238` (`sendDeps`)
- Modify: `infra/ccrc/server/src/index.ts:24-44`
- Modify: `infra/ccrc/server/test/helpers.ts:31-38`, and the six test files that build a `Deps` literal by hand

**Interfaces:**
- Consumes: `KeyedQueue` (`inject/queue.ts`) — per-key FIFO; different keys fully independent; a rejected fn rejects its own caller but never blocks the fns behind it.
- Produces: `Deps.queue: KeyedQueue`, **required**. `buildServer` stops constructing one; `FleetWatcher` reads `this.deps.queue`.

**Why required and not optional:** the whole property is that there is exactly ONE queue, so an optional field with a `?? new KeyedQueue()` fallback at each reader is the bug wearing the fix's clothes — two queues serialise nothing, silently, and no test would say so. Required makes a missed site **TS2741** under `typecheck-tests.test.ts`'s spawned tsc. The five existing acquirers (`/prompt`, `/dialog`, `/interrupt`, `POST /pr`, `/workspace/reap` — `inject/send.ts:266,413,447`, `server.ts:464,545`) are unchanged; the rename makes six.

**Why not a constructor parameter on `FleetWatcher`:** `intervalMs` and `cachePath` already occupy positions 3 and 4, so the queue would land at position 5 and `index.ts` would read `new FleetWatcher(deps, bus, undefined, undefined, queue)` — a call whose correctness depends on counting `undefined`s, and whose default is the very fallback this task exists to remove.

- [ ] **Step 1: Add the field**

In `server/src/server.ts`, inside `Deps`, after the `refreshCaps` entry (`:57`):

```ts
  /** The ONE per-session write queue for the process. Built in `index.ts` and
   *  handed to both `buildServer` and `FleetWatcher`, because the naming
   *  sweep's `ws-rename` has to serialise against `POST /workspace/reap` — and
   *  two `KeyedQueue`s serialise nothing at all. Required, not optional: an
   *  absent field with a local fallback is exactly how a second queue gets
   *  built with every suite green. */
  queue: KeyedQueue;
```

`KeyedQueue` is already imported at `server.ts:21`. Replace `:238`:

```ts
  const sendDeps: SendDeps = { tmux: deps.tmux, queue: deps.queue };
```

- [ ] **Step 2: Build it at the composition root**

In `server/src/index.ts`, add the import beside the others (`:11`):

```ts
import { KeyedQueue } from './inject/queue.js';
```

Insert above `let deps: Deps;` (`:24`):

```ts
// ONE queue, above the mode branch, so both modes and both consumers get the
// same object. Serialising the naming sweep's rename against POST
// /workspace/reap is the point; a per-consumer queue would serialise a call
// only against itself.
const queue = new KeyedQueue();
```

and add `queue` to both `deps` literals (`:34-38` and `:40`):

```ts
  deps = {
    cfg, runCcd: ccdRunner(fleet.runner, cfg), tmux: new Tmux(fleet.runner), io: fleet.io,
    spawnPty: fleet.spawnPty, fleetState: fleet.state, push,
    refreshCaps: makeRefreshCaps(fleet.client, fleet.state), queue,
  };
} else {
  deps = { cfg, runCcd: ccdRunner(realRunner, cfg), tmux: new Tmux(realRunner), io: localIO, spawnPty: attachPty, push, queue };
}
```

- [ ] **Step 3: Let tsc name the rest, and fix exactly these**

Run: `cd infra/ccrc/server && npx tsc -p test/tsconfig.tests.json --noEmit`
Expected: TS2741/TS2345 at each site below. This is the complete list measured on this tree; every one takes the same one-token addition, and each file gains `import { KeyedQueue } from '../src/inject/queue.js';` (`'./inject/queue.js'` in `helpers.ts`… no — `helpers.ts` lives in `test/`, so `'../src/inject/queue.js'` there too).

| file:line | add |
|---|---|
| `test/helpers.ts:37` | `return { cfg, runCcd: ccdRunner(guarded, cfg), tmux: new Tmux(guarded), io: localIO, queue: new KeyedQueue() };` |
| `test/dialog.test.ts:201` | `…, io: localIO, queue: new KeyedQueue() };` |
| `test/commands.test.ts:48`, `:63` | `…, io: localIO, queue: new KeyedQueue() }` |
| `test/fleet-health.test.ts:28` | `…, io: localIO, fleetState, stateCachePath, queue: new KeyedQueue() };` |
| `test/lifecycle.test.ts:47`, `:112`, `:139` | `…, io: localIO, queue: new KeyedQueue() }` |
| `test/routes.test.ts:60` | `…, io: localIO, queue: new KeyedQueue() }` |
| `test/sessionws.test.ts:192`, `:366`, `:445` | `…, io, queue: new KeyedQueue() }` / `…, io: localIO, queue: new KeyedQueue() }` |

A fresh `KeyedQueue()` per test factory is right: tests want independent queues, and `testDeps()` is called once per fixture.

- [ ] **Step 4: Pin the property**

Append to `infra/ccrc/server/test/routes.test.ts`, in a new `describe` at the end of the file:

```ts
describe('one queue for the process', () => {
  // The seam the naming sweep needs. `buildServer` used to construct its own
  // KeyedQueue inline (`server.ts:238`), which FleetWatcher — built one line
  // EARLIER in index.ts — had no way to reach. A watcher that built its own
  // would serialise its rename against nothing, and `POST /workspace/reap` is
  // exactly the write it must not race.
  it('Deps carries the queue, so both consumers hold the same object', () => {
    const deps = testDeps();
    const seen: string[] = [];
    const inner = deps.queue.run('demo-quiet-mesa', async () => { seen.push('a'); });
    return Promise.all([inner, deps.queue.run('demo-quiet-mesa', async () => { seen.push('b'); })])
      .then(() => expect(seen).toEqual(['a', 'b']));
  });
});
```

- [ ] **Step 5: Run the whole server suite**

Run: `cd infra/ccrc/server && npx vitest run`
Expected: PASS, count unchanged from baseline plus one. `typecheck-tests.test.ts` is the gate that proves no `Deps` literal was missed.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/src/server.ts infra/ccrc/server/src/index.ts infra/ccrc/server/test
git commit -m "refactor(ccrc): the KeyedQueue moves to the composition root

It was a local const inside buildServer, and FleetWatcher is constructed one
line earlier in index.ts — so the watcher had no way to reach it. Required on
Deps rather than optional: an optional field with a local fallback builds a
SECOND queue that serialises nothing, with every suite green."
```

---

### Task 6: The naming sweep

**Files:**
- Modify: `infra/ccrc/server/src/watch.ts` (imports; `NAME_SWEEP_MS` beside `TASK_SWEEP_MS:21`; two fields; the `tick()` dispatch; `sweepNames` + `claimTitleRead`)
- Create: `infra/ccrc/server/test/name-sweep.test.ts`

**Interfaces:**
- Consumes: `readRegistry(io, cfg)` → `SessionRecord[]` with `workspace: string | null`, `branch: string | null`, `wrapper`, `workdir`, `uuid`; `transcriptPath(configDir, dir, uuid)` (`transcript/resolve.ts:8`); `readAiTitle` (Task 4); `deriveBranch` (Task 3); `CCD_ARGV.wsRename` + `verbSupported` (Task 2); `this.deps.queue` (Task 5).
- Produces: `NAME_SWEEP_MS = 10_000`; `private lastNameSweep = 0`; `private attemptedRenames = new Set<string>()`; `private titleProbe = new Map<string, {file, size, mtimeMs}>()`; `private claimTitleRead(...)`; **`async sweepNames(): Promise<void>` — public**.

**Why `sweepNames` is public and `sweepTasks` is not:** `tick()` dispatches it with `void`, deliberately (it can wait minutes behind a queued reap), so a test that `await`s `tick()` has *not* awaited the sweep — every assertion about it would be a race, and every negative assertion would pass while the sweep was still running. Public, it is awaited directly and the tests are deterministic. One test still goes through `tick()`, to prove the lane is wired in *and* that the tick does not wait for it.

**Condition 2 reads `SessionRecord.branch`, never `FleetSession.branch`.** The assembled value is `sl?.branch ?? r.branch ?? null` (`fleet.ts:100`) and the statusline wins deliberately — but `cmd_ws_rename` writes the registry synchronously while the statusline only moves when Claude Code re-renders, so for some number of ticks after a successful rename the assembled branch still reads the born name. The sweep calls `readRegistry` itself, exactly as `sweepTasks` (`:185`) and `sweepPr` (`:224`) already do.

**Order matters and is load-bearing:** `verbSupported` is asked BEFORE `claimTitleRead` records anything. Recording a probe for a session the fleet cannot rename would make the next sweep skip the read of an unchanged transcript, so a fleet that installed a newer ccd would leave every existing workspace unnamed until its transcript happened to grow — the exact outcome the spec's `verbSupported` row exists to prevent.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/server/test/name-sweep.test.ts`:

```ts
// The fifth lane. Four conditions, and the two that are easy to get wrong are
// which `branch` it reads (the registry's, not the assembled one) and when it
// records the stat probe (after the verb gate, never before it).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import type { FleetIO } from '../src/io.js';
import { localIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-mesa';
const UUID = 'a'.repeat(36);
const WORKDIR = '/w/demo/quiet-mesa';
const MUNGED = '-w-demo-quiet-mesa';      // mungePath: /._ -> -

/** Registry row for a workspace still on its born branch. */
const seed = (home: string, over: Record<string, string | null> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string | null> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa', ...over,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
};

const TITLE = (t: string): string => JSON.stringify({ type: 'ai-title', aiTitle: t });
const USER = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

/** The transcript at exactly the path `transcriptPath(cfgDir, workdir, uuid)`
 *  resolves to for the row `seed` writes: `~/.claude/projects/<munged>/<uuid>.jsonl`. */
const transcript = (home: string, lines: string[]): string => {
  const dir = path.join(home, '.claude', 'projects', MUNGED);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
};

/** A statusline pane in the shape `parseStatusline` parses (statusline.ts:34-45):
 *  the branch is the `⎇` segment, delimited by the box-vertical. */
const pane = (branch: string): string =>
  `  👤 claude │ 🤖 Sonnet 5 │ ⎇ ${branch} │ 🎯 demo`;

interface Harness { home: string; calls: string[][]; run: Runner }

/** A runner that answers tmux for real-enough and records every ccd argv. */
const harness = (stdout = `{"renamed":"${ID}","old":"ws/quiet-mesa","new":"ws/x"}`,
                 statusBranch = 'ws/quiet-mesa'): Harness => {
  const home = mkTmp('ccrc-name-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { code: 0, stdout: pane(statusBranch), stderr: '' };
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    if (args[0] === 'ws-rename') { calls.push([...args]); return { code: 0, stdout, stderr: '' }; }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

const renames = (calls: string[][]): string[] => calls.map((a) => a[4]!);

/** The lane gates on `NAME_SWEEP_MS`, which `Date.now()` reads — so a second
 *  sweep in the same millisecond returns early. Every multi-sweep test below
 *  runs on fake timers and moves the clock past the lane between sweeps. */
const PAST_LANE_MS = 11_000;
const again = async (w: FleetWatcher): Promise<void> => {
  await vi.advanceTimersByTimeAsync(PAST_LANE_MS);
  await w.sweepNames();
};

/** Fake timers are the default here, not the exception: see `again`. Tests
 *  that need real ones say so. */
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the naming sweep', () => {
  it('renames a workspace still on its born branch, from the title the model wrote', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go'), TITLE('Brainstorm Helix and slide notes integration')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls[0]).toEqual(
      ['ws-rename', '--session', ID, '--branch', 'ws/brainstorm-helix-and-slide-notes']);
    expect(h.calls).toHaveLength(1);
  });

  it('does not fire once the branch has been renamed', async () => {
    const h = harness();
    seed(h.home, { branch: 'ws/brainstorm-helix-and-slide-notes' });
    transcript(h.home, [TITLE('Brainstorm Helix and slide notes integration')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    await again(w);
    expect(h.calls).toEqual([]);
  });

  // THE ONE THAT IS EASY TO GET WRONG. `FleetSession.branch` is
  // `sl?.branch ?? r.branch` (fleet.ts:100) — the statusline WINS, deliberately
  // — and the statusline only moves when Claude Code re-renders, so it still
  // reports the born branch for some number of ticks after a successful
  // rename. A sweep reading the assembled value would rename the workspace a
  // second time, to a name the registry says it already has.
  //
  // Through `tick()`, because `tick()` is what populates `this.statuslines`
  // from the pane — the sweep alone would leave the map empty and the fixture
  // would prove nothing.
  it('reads the registry branch, not the assembled one the statusline still owns', async () => {
    const h = harness(undefined, 'ws/quiet-mesa');     // the pane still says the born name
    seed(h.home, { branch: 'ws/already-renamed' });    // ...the registry does not
    transcript(h.home, [TITLE('Already renamed')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.branch,
      'the fixture is only a fixture if the pane really was parsed').toBe('ws/quiet-mesa');
    await again(w);
    await again(w);
    expect(h.calls).toEqual([]);
  });

  it('does not fire without a title, and does fire once one appears', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);

    transcript(h.home, [USER('go'), TITLE('The title lands')]);
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/the-title-lands']);
  });

  it('does not fire for a main checkout', async () => {
    const h = harness();
    seed(h.home, { workspace: null, branch: 'main' });
    transcript(h.home, [TITLE('Fix the thing')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);
  });

  it('does not fire when the title slugifies to the name it already has', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('quiet mesa')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);
  });

  it('does not re-fire after a refusal, even once the transcript grows', async () => {
    const h = harness('{"refused":"has-upstream","detail":"already on the remote","paths":[]}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toHaveLength(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('has-upstream');

    // A grown transcript re-opens the stat gate; condition 4 is what still holds.
    transcript(h.home, [TITLE('Fix the PR sheet'), USER('more work')]);
    await again(w);
    await again(w);
    expect(h.calls).toHaveLength(1);
  });

  // The retry key is `<id>:<derived-branch>`, not `<id>` — so a title that
  // changes WHILE THE BRANCH IS STILL AT ITS BORN NAME earns exactly one fresh
  // attempt. Synthetic on purpose: measured on a 91 MB transcript, `ai-title` is
  // rewritten once per turn but the value never changed (1,809 lines, one
  // distinct value), so real data cannot exercise this branch. A key of `<id>`
  // alone passes every other case in this file and fails here.
  it('a title that changes before the rename lands earns one fresh attempt', async () => {
    const h = harness('{"refused":"name-taken-local","detail":"taken","paths":[]}');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(h.home);
    transcript(h.home, [TITLE('First guess at the work')]);
    const w = new FleetWatcher(testDeps(h.home, h.run), new Bus(), 2000);

    await w.sweepNames();
    expect(renames(h.calls)).toEqual(['ws/first-guess-at-the-work']);

    transcript(h.home, [TITLE('First guess at the work'), TITLE('Second and better guess')]);
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/first-guess-at-the-work', 'ws/second-and-better-guess']);

    // ...and exactly one. The new pair is now attempted too.
    transcript(h.home, [TITLE('First guess at the work'), TITLE('Second and better guess'), USER('x')]);
    await again(w);
    expect(h.calls).toHaveLength(2);
  });

  it('records NO attempt when the fleet’s ccd lacks the verb', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start', 'ws-reap'] };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), fleetState: state }, new Bus(), 2000);

    await w.sweepNames();
    expect(h.calls).toEqual([]);

    // ccd is installed; spec 1's caps lane refreshes the list. The transcript
    // has NOT changed, so this fires only if the unsupported pass recorded no
    // stat probe — i.e. only if verbSupported is asked BEFORE claimTitleRead.
    state.ccdVerbs = ['start', 'ws-reap', 'ws-rename'];
    await again(w);
    expect(renames(h.calls)).toEqual(['ws/fix-the-pr-sheet']);
  });

  it('joins the per-session queue rather than racing the writes that use it', async () => {
    vi.useRealTimers();   // a held promise plus a real setTimeout, not a clock
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const deps = testDeps(h.home, h.run);
    let release!: () => void;
    // Stands in for POST /workspace/reap, which holds the same key.
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const w = new FleetWatcher(deps, new Bus(), 2000);

    const sweep = w.sweepNames();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls, 'the rename must wait behind the held key').toEqual([]);

    release();
    await sweep;
    expect(h.calls).toHaveLength(1);
  });

  // ── the stat gate ──
  it('does not re-read an unchanged transcript, and does re-read a grown one', async () => {
    const h = harness();
    seed(h.home);
    const f = transcript(h.home, [USER('go')]);   // no title: the permanent state
    let reads = 0;
    const io: FleetIO = {
      ...localIO,
      readFileFrom: (p, off) => { if (p === f) reads += 1; return localIO.readFileFrom(p, off); },
    };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io }, new Bus(), 2000);

    await w.sweepNames();
    expect(reads).toBe(1);
    await again(w);
    await again(w);
    expect(reads, 'identical size AND mtime means the bytes cannot have changed').toBe(1);

    writeFileSync(f, readFileSync(f, 'utf8') + USER('more') + '\n');
    await again(w);
    expect(reads).toBe(2);
  });
});

describe('the naming lane', () => {
  it('sweeps once every ten seconds, not once a tick', async () => {
    const h = harness();
    seed(h.home);
    transcript(h.home, [USER('go')]);   // no title, so nothing is called either way
    let stats = 0;
    const io: FleetIO = {
      ...localIO,
      stat: (p) => { if (p.endsWith('.jsonl')) stats += 1; return localIO.stat(p); },
    };
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io }, new Bus(), 2000);

    await w.sweepNames(); await w.sweepNames(); await w.sweepNames();
    const afterFirst = stats;
    expect(afterFirst, 'the first sweep ran').toBeGreaterThan(0);

    // Under the interval: must NOT sweep. This is the assertion a mutant that
    // shrinks NAME_SWEEP_MS cannot survive.
    await vi.advanceTimersByTimeAsync(5_000);
    await w.sweepNames();
    expect(stats, 'under the interval the lane must not run').toBe(afterFirst);

    // Exactly at the interval, because the gate is `< NAME_SWEEP_MS` -> return.
    await vi.advanceTimersByTimeAsync(5_000);
    await w.sweepNames();
    expect(stats, 'at the interval it must').toBeGreaterThan(afterFirst);
  });

  it('the tick dispatches it, and does NOT wait for it', async () => {
    vi.useRealTimers();
    const h = harness();
    seed(h.home);
    transcript(h.home, [TITLE('Fix the PR sheet')]);
    const deps = testDeps(h.home, h.run);
    let release!: () => void;
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const w = new FleetWatcher(deps, new Bus(), 2000);

    // The tick returns while the sweep is still parked on the queue — awaiting
    // it would put the dialog detector behind a reap that can run for minutes.
    await w.tick();
    expect(h.calls).toEqual([]);
    release();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/server && npx vitest run test/name-sweep.test.ts`
Expected: FAIL — `w.sweepNames is not a function` on every case. The negative cases would otherwise pass vacuously, which is exactly why the positive one is first in the file and why the statusline case asserts its own fixture.

- [ ] **Step 3: Add the imports and the lane constant**

In `watch.ts`, add to the import block (after `:9`, `CCD_ARGV, verbSupported`):

```ts
import { deriveBranch } from './naming.js';
import { transcriptPath } from './transcript/resolve.js';
import { readAiTitle } from './transcript/title.js';
```

and the constant, immediately after `TASK_SWEEP_MS` (`:21`):

```ts
/** The fifth lane. It does NOT ride the 2 s tick: a title that appears ten
 *  seconds late costs nothing, and reading transcripts thirty times a minute to
 *  learn nothing costs real work — the nine transcripts on this box that carry
 *  no `ai-title` at all would be re-read forever. */
const NAME_SWEEP_MS = 10_000;
```

- [ ] **Step 4: Add the two pieces of state**

Beside the other lane clocks (after `lastCapsAt`, `:80`):

```ts
  /** The fifth lane's clock. */
  private lastNameSweep = 0;
  /** `<id>:<derived-branch>` for every pair already tried. THE DERIVED NAME,
   *  not the born slug: a title that changes while the branch is still at its
   *  born name earns exactly one fresh attempt, and a server restart earns one
   *  retry — which is the right amount, because the usual reason a rename
   *  failed is a condition a restart does not change. Deliberately not durable:
   *  a registry marker would be state ccd has to own, write and purge on reap,
   *  for a retry budget whose entire purpose is to be forgotten. */
  private attemptedRenames = new Set<string>();
  /** Per session: the transcript state whose title the sweep has already acted
   *  on. Same gate, for the same reason, as `SessionStream.claimAskRead`
   *  (`sessionws.ts:135-161`). */
  private titleProbe = new Map<string, { file: string; size: number; mtimeMs: number }>();
```

- [ ] **Step 5: Dispatch it from the tick**

In `tick()`, immediately after the caps block (`:154`):

```ts
    // NEVER awaited, same reasoning as sweepPr above and then some: this one
    // joins the per-session KeyedQueue, which `POST /workspace/reap` can hold
    // for minutes. Awaiting it would put the dialog detector and the
    // busy->idle push behind a reap. Overlapping sweeps are harmless — the
    // attempted-set is written BEFORE the call, so the second sweep's
    // condition 4 refuses the pair the first is still running.
    void this.sweepNames().catch(() => { /* one bad sweep must not kill the poll */ });
```

- [ ] **Step 6: Write the gate and the sweep**

Add both methods after `sweepTasks` (`:196`):

```ts
  /**
   * May we spend a transcript tail read on this session's title? Records the
   * state we read at, so the next sweep can tell whether anything could have
   * changed.
   *
   * A transcript with no `ai-title` is a PERMANENT state, not a startup window
   * — nine of the 609 on this box carry none, including some very large ones —
   * so re-reading them every ten seconds forever is roughly 7.7 MB/min across
   * the agent WS to learn nothing. Byte-identical bytes cannot have started
   * saying something they did not say last time.
   */
  private claimTitleRead(id: string, file: string, st: { size: number; mtimeMs: number } | null): boolean {
    if (st === null) {              // no transcript yet — nothing to read, nothing to remember
      this.titleProbe.delete(id);
      return false;
    }
    const p = this.titleProbe.get(id);
    if (p !== undefined && p.file === file && p.size === st.size && p.mtimeMs === st.mtimeMs) return false;
    this.titleProbe.set(id, { file, size: st.size, mtimeMs: st.mtimeMs });
    return true;
  }

  /**
   * Rename every workspace that is still on its born branch to the name Claude
   * Code already wrote. Four conditions, in this order, and the order is the
   * design:
   *
   *   1. it is a workspace, not a main checkout;
   *   2. the REGISTRY says the branch is still exactly `ws/<workspace>` —
   *      condition 2 is also the idempotence marker, which is why there is no
   *      new registry field, no marker file and nothing to purge on reap;
   *   3. the fleet's ccd implements the verb — asked BEFORE the probe below is
   *      recorded, so a fleet that installs a newer ccd re-reads transcripts
   *      that have not changed since;
   *   4. this `(id, derived name)` pair has not been attempted.
   *
   * The `<id>.uuid` inherited limitation applies and is not fixed here: it is
   * written once at `ccd start` and never refreshed, so after a `/clear` the
   * resolved path points at the superseded transcript. The chat stream and
   * `sessionCommands` share it; in practice this fires minutes after creation,
   * when the uuid is fresh.
   *
   * PUBLIC, unlike `sweepTasks`/`sweepPr`, and for a reason that is about the
   * tests being real rather than about convenience: `tick()` dispatches this
   * with `void` (it can sit on the queue for minutes), so a test that awaits
   * `tick()` has NOT awaited the sweep — every negative assertion about it
   * would pass while it was still running. `tick()` is already public for the
   * same class of reason.
   */
  async sweepNames(): Promise<void> {
    const now = Date.now();
    if (this.lastNameSweep !== 0 && now - this.lastNameSweep < NAME_SWEEP_MS) return;
    this.lastNameSweep = now;
    // The REGISTRY's branch, never the assembled `FleetSession.branch`: that one
    // is `sl?.branch ?? r.branch` (fleet.ts:100) and the statusline wins, so it
    // lags a rename by however long Claude Code takes to re-render its pane.
    // Same reason sweepTasks and sweepPr read the registry themselves.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      if (r.workspace === null) continue;
      const born = `ws/${r.workspace}`;
      if (r.branch !== born) continue;
      // A PROBE argv: it is never sent. `verbSupported` reads argv[0] only, and
      // asking here — before `claimTitleRead` writes anything — is what makes
      // "an unsupported verb records no attempt" true of the stat gate as well
      // as of the attempted set.
      if (!verbSupported(this.deps.fleetState, CCD_ARGV.wsRename(r.id, born))) continue;
      const cfgDir = this.deps.cfg.wrappers[r.wrapper];
      if (!cfgDir) continue;
      const file = transcriptPath(cfgDir, r.workdir, r.uuid);
      if (!this.claimTitleRead(r.id, file, await this.deps.io.stat(file))) continue;
      const title = await readAiTitle(this.deps.io, file);
      if (title === null) continue;
      const branch = deriveBranch(title);
      // A title that slugifies to nothing has no pair to mark: the retry key is
      // `<id>:<derived-branch>` and there is no derived branch. The stat gate is
      // what stops it being re-read, which is the same protection the marked
      // pairs get.
      if (branch === null) continue;
      const key = `${r.id}:${branch}`;
      if (this.attemptedRenames.has(key)) continue;
      this.attemptedRenames.add(key);
      if (branch === born) continue;      // the title already names the workspace
      // Through the per-session queue, so it serialises against every other
      // server-originated write on this session — the reap it must not race is
      // POST /workspace/reap, which is already queued. It does NOT serialise
      // against a ws-reap or ws-restore run by hand on the box: those take
      // `$REG/.reap-$id.lock`, which ws-rename does not, and that residue is
      // accepted.
      const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(CCD_ARGV.wsRename(r.id, branch)));
      if (!res.ok) {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} failed: ${res.stderr.trim()}`);
        continue;
      }
      let refused: unknown;
      try { refused = (JSON.parse(res.stdout.trim()) as { refused?: unknown }).refused; } catch { /* not an answer we can read */ }
      if (typeof refused === 'string') {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} refused: ${refused}`);
      }
    }
  }
```

`if (branch === born) continue;` sits AFTER the `attemptedRenames.add`, deliberately: the spec's error table marks that pair attempted, and the key is the one this session would have used.

- [ ] **Step 7: Run the new suite and the two structural gates**

Run: `cd infra/ccrc/server && npx vitest run test/name-sweep.test.ts test/verb-gate.test.ts test/pr-sweep.test.ts`
Expected: PASS. `verb-gate.test.ts` sees two `CCD_ARGV.wsRename(` sites in `sweepNames`, both gated because `verbSupported(` is in the same function; `ws-rename` is absent from `UNGATED_BY_DECISION`, which is correct.

- [ ] **Step 8: Run the whole server suite**

Run: `cd infra/ccrc/server && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add infra/ccrc/server/src/watch.ts infra/ccrc/server/test/name-sweep.test.ts
git commit -m "feat(ccrc): a 10s lane names the branch from the title

Condition 2 IS the idempotence marker — the registry branch stops equalling
ws/<slug> after a successful rename — so there is no new registry field, no
marker file and nothing to purge on reap.

It reads the REGISTRY's branch, not the assembled one: FleetSession.branch
prefers the tmux statusline, which lags a rename by however long Claude Code
takes to re-render. And verbSupported is asked before the stat probe is
recorded, so a fleet that installs a newer ccd re-reads transcripts that have
not changed since."
```

---

### Task 7: The name types itself in

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/TypedLabel.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/SessionLine.tsx:25` (import), `:107` (the label span)
- Modify: `infra/ccrc/pwa/src/session/SessionHeader.tsx:19` (import), `:170` (the crumb span)
- Create: `infra/ccrc/pwa/test/typed-label.test.tsx`
- Modify: `infra/ccrc/pwa/test/archive-screen.test.tsx`, `test/pr-sheet.test.tsx`, `test/reap-sheet.test.tsx` (one case each)

**Interfaces:**
- Consumes: `useReducedMotion` from `framer-motion` (already a dependency, `pwa/package.json:15`; the pattern is `ToolCard.tsx:121,210`, `const reduced = useReducedMotion() ?? false;`). `sessionLabel(session)` (`fleet/sessionLabel.ts:14`) is unchanged and still the single definition of the label chain.
- Produces: `TYPE_MS = 28`; `TypedLabel({ text, className }: { text: string; className?: string }): ReactNode`.

**The settled label must stay ONE text node.** `header.test.tsx:392-401` reads the crumb through `screen.getAllByText('ws/quiet-basin')`, and Testing Library's `getNodeText` concatenates *direct text-node children only* — a per-character split into sibling spans would break it. So the component renders `{shown}` as a single child plus an `aria-hidden` caret element that carries its own glyph, and the caret is absent once the text has settled.

**The caret is a glyph, not a stylesheet rule.** `contrast.test.ts:1262-1277` discovers every `@keyframes` opacity trough in the PWA's CSS and requires each to be registered in a hand-maintained `KEYFRAME_TROUGHS` map with a justification; a blinking caret would owe that map an entry for a mark that is on screen for at most `text.length × TYPE_MS` ms. A `▏` inside an `aria-hidden` span needs no rule, no colour pair and no keyframe.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/pwa/test/typed-label.test.tsx`:

```tsx
// The name was written by a model; it arrives the way a model writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';
import { TYPE_MS, TypedLabel } from '../src/fleet/TypedLabel';

// framer-motion's useReducedMotion caches its matchMedia answer in module state
// on first use, so a `vi.stubGlobal('matchMedia', …)` after the fact is not
// reliably observed — and setup.ts's shim already answers `matches: false` to
// every query, which pins only one of the two branches. Mocking the single
// export this component uses makes both deterministic; the same move
// test/chat.test.tsx makes for react-virtuoso. Vitest hoists `vi.hoisted` and
// `vi.mock` above the imports above, which is why the holder is reachable here.
// SessionLine's own subtree imports no framer-motion, so the mock reaches
// nothing else.
const { motionPref } = vi.hoisted(() => ({ motionPref: { reduced: false } }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => motionPref.reduced }));

afterEach(() => { cleanup(); vi.useRealTimers(); motionPref.reduced = false; });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, ...over,
});

describe('TypedLabel', () => {
  it('is silent on first mount — the whole value, immediately', () => {
    render(<TypedLabel text="ws/quiet-mesa" className="sess-label" />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });

  it('streams a CHANGED value in, character by character, then settles', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/quiet-mesa" />);
    rerender(<TypedLabel text="ws/fix-the-pr-sheet" />);

    // Mid-flight: a prefix, and a caret to say it is still arriving.
    act(() => { vi.advanceTimersByTime(TYPE_MS * 6); });
    const el = document.querySelector('span')!;
    expect(el.textContent!.startsWith('ws/fix')).toBe(true);
    expect(el.textContent).not.toContain('sheet');
    expect(document.querySelector('.typed-caret')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(TYPE_MS * 'ws/fix-the-pr-sheet'.length); });
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret'), 'the caret goes when the value has landed').toBeNull();
  });

  it('the settled value is ONE text node, so getByText still finds it', () => {
    // Not decoration: header.test.tsx reads the crumb through getAllByText, and
    // getNodeText concatenates direct TEXT-node children only. A per-character
    // split into sibling spans would make that query find nothing.
    render(<TypedLabel text="ws/quiet-mesa" className="chat-crumb" />);
    const el = document.querySelector('.chat-crumb')!;
    expect([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(1);
  });

  it('reduced motion swaps instantly and never renders a caret', () => {
    motionPref.reduced = true;
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/quiet-mesa" />);
    rerender(<TypedLabel text="ws/fix-the-pr-sheet" />);
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });

  it('a value that changes mid-flight retargets rather than interleaving', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/a" />);
    rerender(<TypedLabel text="ws/first-guess" />);
    act(() => { vi.advanceTimersByTime(TYPE_MS * 4); });
    rerender(<TypedLabel text="ws/second-guess" />);
    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(screen.getByText('ws/second-guess')).toBeInTheDocument();
  });
});

describe('the fleet line', () => {
  it('types the new branch in when a rename lands', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SessionLine session={s({ branch: 'ws/quiet-mesa' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();

    rerender(<SessionLine session={s({ branch: 'ws/fix-the-pr-sheet' })} onOpen={() => {}} onActions={() => {}} />);
    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
  });

  it('a session with a human-chosen name does not animate on a rename', () => {
    // sessionLabel is `name ?? branch ?? …`, and the server only ships a `name`
    // a human chose (fleet.ts:82 drops Claude Code's derived handles). A rename
    // under a chosen name changes nothing on screen, by design.
    vi.useFakeTimers();
    const { rerender } = render(
      <SessionLine session={s({ name: 'refactor-auth', branch: 'ws/quiet-mesa' })}
                   onOpen={() => {}} onActions={() => {}} />);
    rerender(<SessionLine session={s({ name: 'refactor-auth', branch: 'ws/fix-the-pr-sheet' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/typed-label.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/fleet/TypedLabel"`.

- [ ] **Step 3: Write the component**

Create `infra/ccrc/pwa/src/fleet/TypedLabel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Per-character delay. EXPORTED so the test advances the clock by a multiple
 *  of it rather than re-guessing a literal that a tuning change would silently
 *  invalidate. */
export const TYPE_MS = 28;

/**
 * Streams a CHANGED label in, character by character, with a caret.
 *
 * First mount never animates: a fleet screen that typed fourteen session names
 * in on every navigation would be a stunt, not a signal. What this marks is the
 * one event it exists for — a workspace's branch taking the name the model
 * wrote for it, arriving on some later frame with nothing else on screen
 * changing.
 *
 * The settled value is ONE text node. `getNodeText` — what Testing Library's
 * `getByText` matches on — concatenates direct text-node children only, and the
 * header's crumb is already read that way (`header.test.tsx:392-401`), so a
 * per-character split into sibling spans would break queries that have nothing
 * to do with this feature.
 *
 * The caret is a glyph rather than a stylesheet rule because a blinking one
 * would owe `contrast.test.ts`'s `KEYFRAME_TROUGHS` a registered opacity trough
 * — for a mark on screen for at most `text.length * TYPE_MS` ms.
 */
export function TypedLabel({ text, className }: { text: string; className?: string }): ReactNode {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(text);
  const prev = useRef(text);

  useEffect(() => {
    if (text === prev.current) return;   // first mount, and every re-render that changed nothing
    prev.current = text;
    if (reduced) { setShown(text); return; }
    setShown('');
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, TYPE_MS);
    // Retarget rather than interleave: a second change mid-flight cancels the
    // first run before the next one starts.
    return () => { clearInterval(timer); };
  }, [text, reduced]);

  return (
    <span className={className}>
      {shown}
      {shown !== text && <span className="typed-caret" aria-hidden="true">▏</span>}
    </span>
  );
}
```

- [ ] **Step 4: Mount it at the two places the spec names**

In `pwa/src/fleet/SessionLine.tsx`, add after the `sessionLabel` import (`:25`):

```tsx
import { TypedLabel } from './TypedLabel';
```

and replace `:107`:

```tsx
        <TypedLabel className="sess-label" text={label} />
```

The `viewTransitionName` stamp is on the `<button className="sess-open">` (`:60-72`), not on this span, so the shared-element morph is unaffected.

In `pwa/src/session/SessionHeader.tsx`, add after the `sessionLabel` import (`:19`):

```tsx
import { TypedLabel } from '../fleet/TypedLabel';
```

and replace `:170`:

```tsx
              <TypedLabel className="chat-crumb" text={crumb} />
```

`branchDuplicatesCrumb` (`:155`) still compares the *strings* `branch === crumb`, both from `sessionLabel`/`session.branch`, so the branch chip's suppression is untouched.

- [ ] **Step 5: Pin the three slug displays**

The born slug names a real and unchanged thing — the directory on disk — and a delete confirmation in particular must name what it will actually remove. One case each, all three with a branch that has already been renamed.

Append to `pwa/test/archive-screen.test.tsx` (inside the existing describe that holds the `names the row by workspace slug` case):

```tsx
    it('keeps the born slug after the branch has been renamed', () => {
      render(<ArchiveScreen sessions={[s({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' })]}
                            onOpen={() => {}} />);
      expect(screen.getByText('quiet-basin')).toBeInTheDocument();
      expect(screen.queryByText('ws/fix-the-pr-sheet')).not.toBeInTheDocument();
    });
```

Append to `pwa/test/pr-sheet.test.tsx`, at the end of the file:

```tsx
describe('the sheet names the directory, not the branch', () => {
  it('keeps the born slug after the branch has been renamed', async () => {
    open(sess({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' }));
    expect(await screen.findByText('quiet-basin')).toBeInTheDocument();
  });
});
```

Append to `pwa/test/reap-sheet.test.tsx`, at the end of the file:

```tsx
describe('the confirmation names what it will actually remove', () => {
  it('keeps the born slug after the branch has been renamed', async () => {
    render(<><ToastHost /><ReapSheet session={sess({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' })}
                                     open onClose={() => {}} onReaped={() => {}} /></>);
    expect(await screen.findAllByText(/quiet-basin/)).not.toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the PWA suite**

Run: `cd infra/ccrc/pwa && npx vitest run`
Expected: PASS. Watch `header.test.tsx` and `session-line.test.tsx` in particular: they are the two files whose existing `getByText`/`getAllByText` queries now run against a wrapped label, and they are the reason Step 3's settled value is one text node.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/TypedLabel.tsx infra/ccrc/pwa/src/fleet/SessionLine.tsx infra/ccrc/pwa/src/session/SessionHeader.tsx infra/ccrc/pwa/test
git commit -m "feat(ccrc): the new name types itself into the fleet line

First mount never animates — only a change from a previously rendered value —
so this marks the one event it exists for rather than replaying every name on
every navigation.

The settled label stays ONE text node: getNodeText concatenates direct text-node
children only, and the header crumb is already read through getAllByText. The
caret is a glyph rather than a CSS blink because a blinking one would owe
contrast.test.ts's KEYFRAME_TROUGHS an entry for a mark on screen for half a
second."
```

---

### Task 8: Gates

- [ ] **Step 1: Full suites, all three packages**

Run: `cd infra/ccrc/agent && npx vitest run && cd ../server && npx vitest run && cd ../pwa && npx vitest run`
Expected: PASS. Record the counts.

- [ ] **Step 2: Typecheck**

Run: `cd infra/ccrc/server && npx tsc --noEmit && cd ../agent && npx tsc --noEmit && cd ../pwa && npx tsc --noEmit`
Expected: clean. `server/test/typecheck-tests.test.ts` already covers `server/test/` inside the suite; this is the shipped-build half.

- [ ] **Step 3: ccd is a shell script — lint it too**

Run: `bash -n infra/<server-host>-portability/ccd && shellcheck -S error infra/<server-host>-portability/ccd || true`
Expected: `bash -n` clean. shellcheck is advisory here (ccd predates it); a new *error* introduced by this diff is a finding.

- [ ] **Step 4: Mutation sweep**

Sweep the whole diff, one literal mutant per added construct, full suite per mutant, sha256-verified restore between. The ones a green suite is likeliest to swallow:

| mutant | must fail |
|---|---|
| `SLUG_MAX` 40 → 41 | `naming.test.ts` boundary cases |
| `deriveBranch`: `slug[SLUG_MAX] === '-'` → `!== '-'` | `does not drop back when the cut already lands on a boundary` |
| `deriveBranch`: `at === -1 ? cut : cut.slice(0, at)` → always `cut` | `drops back to the last dash` |
| `deriveBranch`: drop the `^-+|-+$` strip | `lowercases, collapses…` |
| `TITLE_TAIL_BYTES` 256 KB → 64 KB | `reads a 256 KB tail` |
| `readAiTitle`: `if (from > 0) lines.shift()` deleted | `never returns half a line` |
| `readAiTitle`: keep the FIRST title instead of the last | `takes the LAST one` |
| `NAME_SWEEP_MS` 10_000 → 1 | `sweeps once every ten seconds` |
| `claimTitleRead`: drop `p.size === st.size` (and independently `p.mtimeMs === st.mtimeMs`) | `does not re-read an unchanged transcript` |
| the `verbSupported` check moved BELOW `claimTitleRead` | `records NO attempt when the fleet's ccd lacks the verb` |
| `r.branch !== born` → compare against the assembled fleet branch | `reads the registry branch, not the assembled one` |
| `attemptedRenames.add(key)` deleted | `does not re-fire after a refusal` |
| the key `` `${r.id}:${branch}` `` → `r.id` | `a title that changes before the rename lands earns one fresh attempt` |
| `deps.queue` → a fresh `new KeyedQueue()` in `sweepNames` | `joins the per-session queue` |
| ccd: any refusal token renamed | `wsaudit.test.ts` set equality |
| ccd: `_ws_rename_refuse` `return 0` → `die` | the token cases in `ccd-ws-rename.test.ts` |
| ccd: `[[ $# -eq 4 …]]` → `-ge 4` | `refuses anything but the exact four-token argv` |
| whitelist: `['ws-rename','--session']` → `['ws-rename']` | `ws-rename is grantable ONLY with --session` + the agent's boot audit |
| `TYPE_MS` 28 → 0 | `streams a CHANGED value in` |
| `TypedLabel`: `if (text === prev.current) return` deleted | `is silent on first mount` |

A survivor is a finding, not a pass.

- [ ] **Step 5: Verify the real thing**

The definition of done is behavioural and must be demonstrated, not inferred.

1. On openclaw, with the branch deployed and the new `ccd` copied to `~/.local/bin/ccd`: confirm `ccd caps` lists `ws-rename`, and confirm `GET /api/fleet` stops reporting it `unsupported` within 60 s **without restarting the agent** — that is spec 1's caps lane doing the job this spec depends on.
2. Create a workspace with `+`, give it one prompt, and watch the fleet line: within one `NAME_SWEEP_MS` of Claude Code writing the `ai-title`, the branch becomes the slugified title and the new name types itself in.
3. The negative that matters most: `git push -u origin ws/<slug>` on a fresh workspace, then give it a prompt. The branch must keep its born name **permanently**, `has-upstream` must appear once in the server log, and nothing must surface in the PWA.
4. The retry budget: confirm the refused workspace is not retried on the following sweeps, and that restarting ccrc-server buys it exactly one more attempt.

---

## Spec Coverage

| spec section | task |
|---|---|
| The rule — `NAME_SWEEP_MS`, four conditions, condition 2 reads the registry | 6 |
| Idempotence needs no new state | 6 (condition 2 is the marker; no registry field anywhere in this diff) |
| Deriving the name — 40 excludes `ws/`, drop back, hard-cut, empty/unchanged | 3 |
| The server does not re-implement `_ws_branch_valid` | 3 (Step 3's comment), 1 (`bad-branch` is the verdict) |
| Reading the title without re-reading the world — 256 KB tail, stat gate | 4, 6 (Step 6, `claimTitleRead`) |
| Inherited `<id>.uuid` limitation, stated not fixed | 6 (Step 6 docstring) |
| The retry-storm guard — `<id>:<derived-branch>`, not durable | 6 (Step 4, Step 6) |
| A title that changes before the rename lands earns one fresh attempt (synthetic — real data cannot exercise it) | 6 (Step 1) |
| Ordering against the rest of the fleet — the queue, and the hoist | 5, 6 |
| ccd: the new argv, exact arity, id validation | 1 |
| ccd: thirteen refusal tokens, JSON at exit 0, `:1241` keeps non-zero | 1 |
| ccd: no busy guard | 1 (no `_ws_status` call is added anywhere) |
| ccd: `git ls-remote` unreachable stays a warning | 1 (the `*)` arm is unchanged) |
| The server gains one argv entry, one grant and one timeout | 2 |
| The watcher call site carries `verbSupported` | 6 (Step 7 runs `verb-gate.test.ts`) |
| The name types itself in — `TypedLabel`, both mounts, reduced motion, exported delay | 7 |
| The three slug displays are untouched | 7 (Step 5) |
| Error-handling table, every row | 1 (tokens), 6 (Steps 1 and 6), 7 (human-chosen name) |
| Out of scope — no route, no client method, no wire change, no `ws-add` slug | nothing in this plan touches `shared/api.ts`, `pwa/src/lib/api.ts` or `CCD_ARGV.wsAdd` |
| Definition of done | 8 (Step 5) |

## Final Verification

Two properties will be green in unit tests and wrong on the fleet if they are only inferred, and both are in Task 8 Step 5.

The first is the caps dependency: this feature is invisible until the deployed agent re-reads `ccd caps`, and the only proof that it does is installing the new ccd under a running agent and watching the verb become callable without a restart. A suite that stubs `ccdVerbs` cannot tell that apart from a fleet where nothing works.

The second is `has-upstream`. It is the refusal that makes unattended naming safe — a branch that has been pushed is never renamed — and it is the one path whose fixture in the suite is a local bare repo rather than GitHub. Push a real workspace branch, prompt it, and confirm the born name survives: that is the half a passing unit suite would not have caught.
