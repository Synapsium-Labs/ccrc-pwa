# Smart Branch Naming Implementation Plan (PR H)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace born `ws/soft-prairie` renames itself to `ws/brainstorm-helix-and-slide-notes` within ten seconds of Claude Code writing the `ai-title` it already generated — and the new name types itself into the fleet line.

**Architecture:** `ccd ws-rename` leaves the positional generation for `--session/--branch` with a JSON refusal envelope at exit 0, so a refusal is an answer the server can read rather than a stderr string indistinguishable from a transport failure. The server gains one argv entry, one grant, one timeout, and a sixth `FleetWatcher` lane at 10 s that reads the *registry* branch, tails 256 KB of transcript behind a stat gate, derives a slug, and calls the verb through the process's one `KeyedQueue` — which has to be hoisted out of `buildServer` first. The PWA wraps the single label definition in a typewriter and deletes the one copy of that definition that grew back.

**Tech Stack:** bash + python3 heredoc (ccd), TypeScript ESM (Node ≥22, Fastify), vitest, React 19 + framer-motion (already a dependency). No new dependencies. ccd is tested through the existing fixture-HOME harness (`server/test/ccdWsHelpers.ts`).

**Spec:** `docs/superpowers/specs/2026-08-03-ccrc-smart-branch-naming-design.md` (approved; decisions D1–D10 binding), executed with the eight Rider-D deltas of `docs/superpowers/specs/2026-08-07-build3-riders-design.md:191-226`.

**Supersedes** `docs/superpowers/plans/2026-08-03-ccrc-smart-branch-naming.md`, which targets the pre-extraction `infra/ccrc/*` + `infra/ccrc-portability/ccd` layout that no longer exists. Task structure, code shapes and test cases are mined from it; **every path and every line anchor below was re-derived against `origin/main` — the tree this plan targets and the branch was cut from — and verified by grep/read.** (Corrected, Build 3 PR H whole-branch review: an earlier version of this plan's `ccd/ccd` and `server.ts` anchors used the scout's `7f2c250` base instead of `origin/main`, and were wrong throughout despite this same sentence claiming otherwise. See the Self-review section for the re-derivation and the specific corrected values. As execution proceeded across several review rounds, this tree ALSO moved past `origin/main` — an anchor here is a snapshot at plan-writing time, not a live index of the current source; trust the shipped source's own comments for that.)

**Dependency, already satisfied:** the caps-refresh lane (`CAPS_REFRESH_MS`, `server/src/watch.ts:30`, `server/src/refreshcaps.ts`) is shipped. Without it a fleet whose ccd gains the new verb would keep answering `unsupported` until someone restarted the agent.

**Branch:** one PR, `feat/smart-branch-naming`, cut from current `main`. The orchestrator merges and deploys.

---

## Deviations found

**Post-build sync.** This plan's execution ran across several review rounds on the same branch, and fixes from later findings (review findings 1, 2, 3 and 5 — see D-5 below) landed in the shipped tree without every verbatim code block in this document being re-diffed against them. The blocks affected — the fault-vs-refusal comment in Task 1's `ccd-ws-rename.test.ts` excerpt, the `_ws_branch_valid` claim in Task 5's `naming.ts` docstring, Task 6's `sweepNames` docstring/constants/state (the archived guard and `PERMANENT_REFUSALS`/`nameSweepRetired`), and the Task 9 mutation table's `attemptedRenames.add(key)` row — have been aligned to the shipped tree after execution, each marked inline where it happens. This section's own prose (D-5 and its Task 9 correction) was already accurate; only the surrounding verbatim blocks had drifted.

Five, recorded rather than silently redesigned. Each names the minimal faithful adaptation.

### D-1 (blocking) — a `_ws_rename_refuse` helper defeats the refusal-token harvest

The superseded plan factors the envelope into `_ws_rename_refuse() { printf '{"refused":"%s","detail":%s,"paths":[]}\n' "$1" ...; }`. **That emits no harvestable token.** `server/test/wsaudit.test.ts:57` scans ccd's source with

```js
for (const m of ccdSrc.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
```

and `%` is not in `[a-zA-Z0-9-]`, so a helper contributes nothing to `ccdTokens`. The other three harvesting regexes (`_reap_refuse\s+<tok>`, `'!<tok>`, `"verdict":"<tok>"`) do not see `_ws_rename_refuse bad-args …` either. The consequence is not "the tokens are missed" — it is that `wsaudit.test.ts:88` (*every sentence in wsaudit.ts maps to a token ccd can actually emit*) and `:97` (*the two sets are exactly equal*) go **red on the nine new sentences the spec requires**, and the only fixes would be to delete the sentences or to weaken the linkage test — both of which the spec forbids (`spec:362-369`).

**Adaptation:** emit each refusal as an **inline literal `printf`**, which is ccd's own dominant idiom — `cmd_ws_reap` does exactly this at ~30 sites (`ccd/ccd:4600`, `:4680`, `:4731`, …); only the one genuinely dynamic verdict (`ccd/ccd:5002`) uses `%s`. Verified by running the harvest over `ccd/ccd` on this tree: **45 tokens today, 45 `SENTENCES` keys, and exactly nine of ws-rename's thirteen are new** (`bad-args`, `bad-branch`, `worktree-unregistered`, `detached`, `unchanged`, `has-upstream`, `name-taken-local`, `name-taken-origin`, `worktree-foreign`) — the spec's count, confirmed by measurement rather than assumed.

### D-2 (cosmetic) — "the fifth lane" is taken

The superseded plan calls the naming sweep "the fifth lane". Since it was written, hook-state sweeping claimed that ordinal in the code itself (`server/src/watch.ts:104-107`, and `server/src/fleet.ts`'s `hookStates` parameter doc). The naming sweep is **the sixth lane**; every comment below says so.

### D-3 (counting) — the queue has seven join sites today, not six

Rider D delta 2 says seven *including* the rename. Measured (`grep -rn '\.queue\.run(' server/src`): **seven existing** call sites — `inject/send.ts:266` (`sendPrompt`), `:487` (`submitEnter`), `:533` (`answerDialog`), `:567` (`interrupt`), **`inject/ask.ts:39` (`answerAsk`, through `AskDeps extends SendDeps` — the one the rider's list omits)**, `server.ts:579` (`POST /pr`), `server.ts:702` (`POST /workspace/reap`). The rename makes **eight**. Nothing about the design changes; the hoist is still the mechanism and Task 4's structural guard counts the property that matters (*one* `new KeyedQueue()` in `server/src`, and it is at the composition root) rather than a site count that ordinary edits would rot.

### D-4 (accepted hazard, stated) — `ccd caps` already advertises `ws-rename`

`ccd/ccd:1480` on `origin/main` (the pre-PR ccd this paragraph describes; corrected from `:1454`, a scout-base anchor — Build 3 PR H whole-branch review) lists `ws-rename` while the verb is still positional, so `verbSupported` answers **true** on a fleet whose ccd predates this PR: the probe-before-claim rule (`spec:354-360`) is necessary but not sufficient across this one upgrade. The old body binds its two arguments positionally — `local id="${1:?usage: …}"; local new="${2:?…}"` — and the new argv is `['ws-rename', '--session', <id>, '--branch', <name>]`, so `$1` is the literal `--session` and `$2` is `<id>`, **both non-empty**: neither `${1:?}` nor `${2:?}` fires. Execution falls through to `[[ -f "$REG/$id.uuid" ]] || die "no such session: $id"` with `id` bound to `--session`, so an old ccd dies **`no such session: --session`** — not bash's own usage refusal (measured; see Build 3 PR H review finding 3, which corrected the same false sentence in `watch.ts`'s docstring). **This is accepted and not engineered around** (Rider D delta 5): it surfaces as one non-ok `CcdResult` per (session, derived name), the retry guard absorbs it, and the rollout is agent-first so the window is the length of one deploy. Do not add a shape probe, a version verb, or a caps entry rename to close it.

### D-5 (blocking, retroactive) — `PERMANENT_REFUSALS` deviates from spec:151-158/408 (spec:429, after the spec's own later "Corrected" amendment shifted it) and the earlier plan text; both the design doc and Task 8's own copy were stale until this task

Spec:151-158 and the definition of done (spec:429, "A workspace that refused once is not retried until its title changes or the server restarts") describe **one** retry rule for every refusal: a title change is always worth exactly one fresh attempt, never zero. Build 3 PR H review finding 1, landed earlier on this branch (commit 284679d), found that rule unsafe for five of the thirteen tokens — `has-upstream`, `not-a-workspace`, `worktree-unregistered`, `worktree-foreign`, `bad-branch` — because each names a fact about the workspace's shape that a later title cannot change, so retrying them forever on every title edit is pure waste. `server/src/watch.ts:45-47` (`PERMANENT_REFUSALS`) and `:164`/`:489`/`:535` (`nameSweepRetired`) implement the split: those five retire the *session* — `if (this.nameSweepRetired.has(r.id)) continue;` at `:489`, before any stat or transcript read — while the remaining eight (`bad-args`, `no-such-session`, `incomplete-registry`, `worktree-missing`, `detached`, `unchanged`, `name-taken-local`, `name-taken-origin`) still earn the spec's one fresh attempt per changed derived name, via `attemptedRenames`.

That review finding updated only `watch.ts`'s own docstrings and this file's D-4 neighbourhood was left alone — Task 8's original prose (this plan, "Step 1: Write it") was copied verbatim from the spec's single-rule sentence, before finding 1 landed, and nobody re-diffed it after. It shipped in commit 8d3b350 describing behaviour the branch no longer has. **Adaptation:** README.md:101-102's retry sentence now names the five-token permanent set explicitly and says the other eight retry on a changed derived name, matching `PERMANENT_REFUSALS` rather than the single-rule spec text; the spec document itself is intentionally left as the historical design record and not edited by this task.

**Correction (Task 9, review finding 5):** the paragraph above, `watch.ts:36-59`'s own comment, and README.md:102-105 all repeated the same false claim about `bad-branch` — that it "names a fact about the workspace's shape that a later title cannot change." It does not: `bad-branch` is a verdict on `deriveBranch(title)`, and a later title is precisely the thing that can change that verdict. `PERMANENT_REFUSALS` is now **four** tokens, not five — `has-upstream`, `not-a-workspace`, `worktree-unregistered`, `worktree-foreign` — and `bad-branch` retries per `(id, derived-branch)` like the other eight, via `attemptedRenames`, same as the spec's single rule already says for it. This was latent rather than live: `deriveBranch` (`naming.ts:32-49`) only ever emits `ws/[a-z0-9]+(-[a-z0-9]+)*`, a subset `_ws_branch_valid` (`ccd/ccd:1337-1347`) always accepts, so the sweep has never actually produced a `bad-branch` refusal — but the comment asserted a permanence guarantee the code did not have, and the guard would have been wrong the day the arm ever did fire.

**Correction (Build 3 PR H whole-branch review, retroactive):** the "spec document itself is intentionally left as the historical design record and not edited by this task" sentence above was itself found insufficient — an approved spec is the document a future implementer (and an operator following a stuck-workspace log line to the DoD) is told to trust, and it is served rendered, not read as an archive. The spec is now amended in place with two dated "Corrected 2026-08-07" notes (retry-storm guard section and Definition of Done) stating the session-level retirement rule directly, rather than leaving the correction findable only here. **`PERMANENT_REFUSALS` also grew a fifth token in the same review round, for an unrelated reason:** `registry-branch-drift`, a new refusal `cmd_ws_rename` now raises when git's own worktree record disagrees with the registry's `branch` field (the corroboration `cmd_ws_reap` already required) — see the spec's own retry-storm-guard correction and `server/src/watch.ts`'s `PERMANENT_REFUSALS` docstring for why it belongs in the same set as the other four.

---

## Global Constraints (from the spec, verbatim where quoted)

- **The derivation rule.** "Lowercase the title; replace every run of non-alphanumerics with a single `-`; strip leading and trailing `-`; truncate the slug to at most 40 characters; prefix `ws/`." The 40 counts **the slug only, not the `ws/` prefix**. "At a word boundary" means **cut at 40, then drop back to the last `-` at or before the cut, never forward past it**; if the first 40 characters contain no `-` at all, **hard-cut at 40**. "A title that slugifies to the empty string, or to the name it already has, is not a rename — no call is made."
- **The server does not re-implement `_ws_branch_valid`.** "That rule has one definition, on the box, and the server learns its verdict from the refusal token. Two implementations of one rule drift; that is what they do."
- **Thirteen refusal tokens, twelve of them refusals plus `bad-args`, all printing JSON on stdout at exit 0.** In ccd's own evaluation order: `bad-args`, `no-such-session`, `not-a-workspace`, `incomplete-registry`, `worktree-missing`, `bad-branch`, `worktree-unregistered`, `detached`, `worktree-foreign`, `unchanged`, `has-upstream`, `name-taken-local`, `name-taken-origin`. **"`git branch -m` failing is the one path that keeps a non-zero exit. It is a fault, not a refusal: nothing about the request was wrong."** `git ls-remote` being unreachable stays a **warning**, not a refusal. **No busy guard** — "when the title lands the session is busy by definition."
- **`has-upstream` is the load-bearing refusal:** "a branch that has been pushed is never renamed."
- **The retry key is `<id>:<derived-branch>`** — the derived name, not the born slug. One attempt per (session, derived name), in memory, "deliberately not durable".
- **A refusal marks the pair attempted; an unsupported verb does NOT**, "or upgrading ccd would leave every existing workspace permanently unnamed." "`verbSupported` is therefore asked **before** the transcript is claimed, using a probe argv built from the born branch; the probe is never sent, because `verbSupported` reads `argv[0]` only."
- **Condition 2 reads the registry, not the assembled `FleetSession`.** `FleetSession.branch` is `sl?.branch ?? r.branch ?? null` (`server/src/fleet.ts:155`) and the statusline wins deliberately; `cmd_ws_rename` writes the registry synchronously. **Condition 2 *is* the idempotence marker** — no new registry field, no marker file, nothing to purge on reap.
- **The transcript read is a 256 KB tail behind a stat gate** copied from `claimAskRead` (`server/src/sessionws.ts:178-187`): "unchanged size and mtime means the bytes cannot have started saying something they did not say last time."
- **Refusal tokens reach `wsaudit.ts`, not the PWA.** Nine sentences that no sheet renders are written anyway, "rather than making the linkage test verb-aware, because that test is an approved mechanism and weakening it to fit a new caller is the wrong trade." See **D-1** for the shape that keeps them harvestable.
- **Rollout: agent first** (this ships `ccd/`), then server+PWA — standing discipline, and the deploy script installs ccd before restarting the agent for the same reason (`README.md:198`).
- Run ALL verification **FOREGROUND** in single blocking calls (the server suite is ~200 s; the ccd files alone are ~90 s — use `timeout ≥600000` ms). Report REAL printed counts. Never background a suite.
- **Mutation sweep the whole diff** — one literal mutant per added construct, full suite per mutant, sha256-verified restore between (Task 9).

**Read the code before you write it.** Every code block below is **shape-authoritative, not text-authoritative**: it fixes the decision, the comment and the assertion, but where it disagrees with a harness helper, an existing idiom or a neighbouring file's conventions, **the tree wins**. `server/test/ccdWsHelpers.ts` is the authority on its own API (it has `sh`/`reg`/`git`/`makeRepo`/`makeGhRepo`/`calls`/`ghPoison`/`cleanup` and **no** `wsId`); `server/test/helpers.ts` is the authority on `testDeps`; `pwa/test/session-line.test.tsx:15-23` is the authority on the current `FleetSession` fixture shape. Copy from them rather than from here when the two differ.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `ccd/ccd` | `cmd_ws_rename` (`:1348-1439`); `_ws_branch_valid` (`:1337-1346`) untouched; dispatch (`:6935`) and usage (`:6947`) untouched; `cmd_caps` (`:1480`) untouched — **anchors re-derived against `origin/main`, the tree this plan targets (Build 3 PR H whole-branch review; the previous set used the scout's `7f2c250` base instead)** | flags, exact arity, id validation, 13 inline refusal envelopes, JSON success |
| `server/test/ccd-ws-rename.test.ts` | the verb's own suite (24 cases: 5 on `_ws_branch_valid`, 19 on `ws-rename`) | rewrite the 19; the 5 are untouched |
| `server/test/ccd-workspaces.test.ts:479` | the only other caller of the verb in the repo | positional → flags |
| `server/src/wsaudit.ts` | refusal token → sentence | +9 entries (45 → 54) |
| `server/src/ccdargv.ts` | the only place a ccd argv is built | `+wsRename` after `wsRelease` (`:78`) |
| `agent/src/whitelist.ts` | exec grant list + gated-verb table | `+['ws-rename','--session']` (after `:318`); `REQUIRED_VERB_FLAG` (`:218`) gains its second entry |
| `agent/test/types/ok/legit-whitelist.ts` | compile-level pins on the rule tables | `+RenameNeedsSession` (after `:70`) |
| `server/src/remote/runner.ts` | per-verb budgets (`CCD_VERB_TIMEOUT_MS`, `:27-37`) | `+'ws-rename': 20_000` |
| `server/test/whitelist-subset.test.ts` | `SAMPLES` (`:13-34`), `EXPECTED` (`:238-260`), layer 3 | `+wsRename` in both (compile-enforced) + one grant assertion |
| `server/src/server.ts` | `Deps` (`:69-96`), `sendDeps` (`:321`) | `queue` becomes a required `Deps` field |
| `server/src/index.ts` | composition root (`:32-52`, `:61`) | owns the one `KeyedQueue` |
| `server/test/single-definition.test.ts` | structural one-definition guards | +1 guard: one `new KeyedQueue()`, at the root; +1 guard: one `sessionLabel` chain |
| `server/src/naming.ts` | **new** — title → branch | create |
| `server/src/transcript/title.ts` | **new** — the stat-gated `ai-title` tail read | create |
| `server/test/naming.test.ts` | **new** — derivation + title read | create |
| `server/src/watch.ts` | the sweep lanes (`:24`, `:30`, `:35`; `tick()` `:194`) | `+NAME_SWEEP_MS` lane, three fields, `claimTitleRead`, `sweepNames` |
| `server/test/name-sweep.test.ts` | **new** — the lane's four conditions | create |
| `pwa/src/fleet/TypedLabel.tsx` | **new** — the typewriter | create |
| `pwa/src/fleet/SessionLine.tsx` | fleet-line label (`:26` import, `:204` span) | wrap in `TypedLabel` |
| `pwa/src/session/SessionHeader.tsx` | header crumb (`:19` import, `:221` span) | wrap in `TypedLabel` |
| `pwa/src/fleet/SessionActionsSheet.tsx:203` | the second copy of the label chain | import `sessionLabel` |
| `pwa/test/typed-label.test.tsx` | **new** | create |
| `pwa/test/archive-screen.test.tsx`, `test/pr-sheet.test.tsx`, `test/reap-sheet.test.tsx`, `test/session-actions-sheet.test.tsx` | the born slug survives a rename; the sheet's label | one case each |
| `README.md` | operator-facing | the naming lane + the new verb shape |

Twelve `Deps` literals in eight test files gain one field each in Task 4; they are enumerated there rather than here.

---

### Task 1: `ws-rename` joins ccd's new generation

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_rename` (`:1322-1413`) replaced in full. `_ws_branch_valid` (`:1311-1320`), the dispatch arm (`:6846`), the usage string (`:6858`) and `cmd_caps` (`:1454`) are **untouched** — the verb's name did not move.
- Modify: `server/test/ccd-ws-rename.test.ts` — the `describe('ws-rename', …)` block (`:52-284`). Lines 1-51 (imports, `addOne()`, the `_ws_branch_valid` describe) are unchanged.
- Modify: `server/test/ccd-workspaces.test.ts:479`

**Interfaces:**
- Consumes: `_json_str` (`ccd/ccd:212`, the ONLY JSON escaper in ccd; a bare `$(_json_str …)` inside a printf argument list swallows its status by construction, which is why every record-builder probes once up front — `ccd:3733`, `:4571`); `_reg_get`/`_reg_set` (`ccd:98-99`); `_ws_wt_branch` (`ccd:1155`); `_ws_common_dir` (`ccd:1136`); `_ws_branch_valid` (`ccd:1311`); `die` (`ccd:51`); `$REG` (`ccd:6`), `$PROJECTS_ROOT` (`ccd:12`).
- Produces: `ccd ws-rename --session <id> --branch <name>`. Success → `{"renamed":"<id>","old":"<branch>","new":"<branch>"}` on stdout, exit 0. Refusal → `{"refused":"<token>","detail":"<sentence>","paths":[]}` on stdout, **exit 0**. Fault (`git branch -m` failed, or python3 missing) → non-zero exit with stderr.

**Why `"paths":[]` is carried into a verb that has no paths:** the spec adopts `ws-reap`'s envelope as *the shape*, not as a family of per-verb shapes. Every reader keys on `refused`; one refusal shape across the new generation costs less than two that differ by an empty array.

**Why the tokens are inline literals and not a helper:** see **Deviation D-1**. This is the single most important thing to get right in this task, and Task 2 is red until it is.

**Known-red at the end of this task:** ccd now emits nine tokens `SENTENCES` has no copy for, so `server/test/wsaudit.test.ts` fails its two set-equality assertions. That is by construction — Task 2 closes it, immediately, in the same PR. Do not "fix" it by dropping a token.

- [ ] **Step 1: Rewrite the ws-rename suite against the new shape**

Replace the whole `describe('ws-rename', …)` block in `server/test/ccd-ws-rename.test.ts`. Keep `:1-51` exactly as they are.

```ts
describe('ws-rename', () => {
  /** Every refusal is an ANSWER now: one JSON object on stdout at exit 0. `h.sh`
   *  throws on a non-zero exit, so reading refusals THROUGH it is also the
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
  // generation. `${1:?}`/`${2:?}` was a MINIMUM-arity guard whose usage line
  // was bash's, and extra argv was silently ignored.
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

  it('refuses an unknown id', () => {
    expect(refusal('nope-nothing', 'feat/real-name')).toBe('no-such-session');
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

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(refusal('demo-quiet-mesa', 'feat/../escape')).toBe('bad-branch');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(refusal('demo-quiet-mesa', 'ws/quiet-mesa')).toBe('unchanged');
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
    // unusable offline for a branch that has never been pushed. The warn goes to
    // stderr, so this one reads the merged stream and does not JSON.parse it.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(out).toContain('"renamed"');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('is reachable as a subcommand', () => {
    addOne();
    const o = JSON.parse(
      h.sh(`"${CCD}" ws-rename --session demo-quiet-mesa --branch feat/real-name`),
    ) as Record<string, unknown>;
    expect(o.new).toBe('feat/real-name');
  });

  // `git branch -m` failing is THE one path that keeps a non-zero exit: nothing
  // about the request was wrong, so it is a fault and not a refusal — the caller
  // must not read it as a REFUSAL ANSWER (no token, no refusalSentence), but the
  // pair IS still marked attempted, like every other non-ok CcdResult. The shim
  // spells its own `command git` passthrough, as every git stub here does.
  it('exits non-zero when the rename itself fails — a fault, not a refusal', () => {
    const wt = addOne();
    const NOMV = `git() { [[ "$*" == *"branch -m"* ]] && { echo "fatal: nope" >&2; return 1; }; command git "$@"; };`;
    expect(() => h.sh(`${NOMV} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`))
      .toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

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
  // words — and now its own token.
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
  // answers `ws/second-slug` — while git's record in $main still says the path
  // is ours on ws/quiet-mesa. Both worktrees belong to $main, so
  // `_ws_common_dir` sees one common directory on both sides and the guard
  // passes, correctly: nothing here is a stranger's. What is left to get right
  // is which branch the remaining reads and the write actually name.
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

  it('renames the recorded branch in the project, not the branch the directory has checked out', () => {
    const [ours, sibling] = restoredFromSibling();
    // The fixture: the two answers disagree, and only one of them is evidence.
    expect(h.git(ours, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/second-slug');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${ours}"`)).toBe('ws/quiet-mesa');

    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    // Ours moved, so the object it printed is true...
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(branches('feat/real-name')).not.toBe('');
    // ...and the sibling workspace still has its own branch and its own record.
    expect(branches('ws/second-slug')).not.toBe('');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${sibling}"`)).toBe('ws/second-slug');
  });

  // The upstream check is asked in $main and about $old BY NAME, which is the
  // only way it can be about the branch this rename is about. In-worktree
  // `@{u}` asks after the DIRECTORY's current branch instead: here that is the
  // sibling's, which has never been pushed, so the one guard that exists to
  // stop a rename after a push answers about the wrong branch and waves ours
  // through.
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
});
```

`mainDir`/`branches` are `const`s declared partway through the block, so the two cases above them that use `branches` must move below the declarations, or the declarations must move to the top of the describe. **Move the declarations to the top of the describe** — TDZ, not hoisting, and a `ReferenceError` inside an `it` reads as a mystery.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run test/ccd-ws-rename.test.ts`
Expected: FAIL. `cmd_ws_rename --session …` is read positionally, so `$1` is the literal `--session`, `[[ -f "$REG/--session.uuid" ]]` misses and `die` exits 1 — `h.sh` throws and `JSON.parse` is never reached. The five `_ws_branch_valid` cases still pass.

- [ ] **Step 3: Rewrite the verb**

Replace `ccd/ccd:1322-1413` in full. Every long comment in today's body is **kept verbatim**; only the guards' failure arms change, plus the header, the probe and the arity block.

```bash
cmd_ws_rename() {   # ccd ws-rename --session <id> --branch <name> — rename a
  # workspace branch before it is pushed.
  #
  # FLAGS, not positionals, and every refusal is an ANSWER: one JSON object on
  # stdout at exit 0. Both changes are for the same caller. This verb's first
  # unattended caller is FleetWatcher's naming sweep, on the far side of the
  # agent WS, where a non-zero exit carrying a stderr string is
  # indistinguishable from the agent being down — and "this branch is already
  # pushed, never rename it" must not be retried the way a transport failure is.
  # The flags matter from the other end for the same reason: the agent's exec
  # whitelist matches by PREFIX, so a positional verb can only be granted as the
  # one-token ['ws-rename'], which permits `ccd ws-rename <anything>
  # <anything…>` for a call no human ever reviews.
  #
  # THE TOKENS ARE INLINE LITERALS, not arguments to a helper, and that is
  # load-bearing rather than stylistic. `server/test/wsaudit.test.ts:57` scans
  # THIS FILE with /"refused":"([a-zA-Z0-9-]+)"/ and asserts set equality in
  # both directions against `wsaudit.ts`'s SENTENCES; a helper whose format
  # string reads `"refused":"%s"` contributes no token to that scan, so the nine
  # sentences this verb needs would fail the reverse direction and the only
  # fixes would be deleting copy or weakening an approved mechanism.
  # `cmd_ws_reap` already writes every one of its ~30 refusals this way.
  #
  # `_json_str`'s status, checked ONCE and up front — the same probe, for the
  # same reason, as `cmd_ws_audit` (ccd:3733) and `cmd_ws_reap` (ccd:4571).
  # Every refusal below quotes its detail inside a printf ARGUMENT LIST, where a
  # failure is a swallowed status and an empty argument — `"detail":,` — i.e. a
  # document the server reports as a parse error rather than as the refusal it
  # actually was. BEFORE the arity check, because `bad-args` is itself one of
  # the refusals that needs quoting. python3 missing is a FAULT, not a refusal:
  # the verb cannot answer at all.
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the rename answer safely"

  # Exact arity and flag order, the shape `cmd_ws_hold` (ccd:1467) and
  # `cmd_ws_release` (ccd:1510) use. `[[ ]]` short-circuits, so `$1` is never
  # expanded when `$#` is 0 and `set -u` has nothing to complain about. The
  # positional form this replaces was a MINIMUM-arity guard (`${1:?}`/`${2:?}`)
  # whose usage refusal was bash's rather than ccd's, and it ignored extra argv.
  if [[ $# -ne 4 || $1 != --session || $3 != --branch ]]; then
    printf '{"refused":"bad-args","detail":%s,"paths":[]}\n' \
      "$(_json_str "usage: ccd ws-rename --session <id> --branch <name>")"
    return 0
  fi
  local id=$2 new=$4
  if [[ ! $id =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '{"refused":"bad-args","detail":%s,"paths":[]}\n' \
      "$(_json_str "bad session id: $id")"
    return 0
  fi

  if [[ ! -f "$REG/$id.uuid" ]]; then
    printf '{"refused":"no-such-session","detail":%s,"paths":[]}\n' \
      "$(_json_str "ccrc has no registry entry for $id")"
    return 0
  fi

  local ws project workdir
  ws=$(_reg_get "$id" workspace); project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  # The absence of a workspace field is what distinguishes a main checkout.
  if [[ -z "$ws" ]]; then
    printf '{"refused":"not-a-workspace","detail":%s,"paths":[]}\n' \
      "$(_json_str "$id is not a workspace — refusing to rename a main checkout's branch")"
    return 0
  fi
  if [[ -z "$project" || -z "$workdir" ]]; then
    printf '{"refused":"incomplete-registry","detail":%s,"paths":[]}\n' \
      "$(_json_str "incomplete registry for '$id'")"
    return 0
  fi
  # KEPT deliberately, now that the branch no longer has to be read out of the
  # directory. The record does survive a hand-deletion, so this rename WOULD
  # work — but ws-rename exists for a workspace still being worked in, and a
  # vanished directory is a broken one. Renaming would print a success line and
  # say nothing about the breakage, hiding exactly what ws-gc exists to surface;
  # refusing names it, and ws-rm already handles a gone directory deliberately.
  if [[ ! -d "$workdir" ]]; then
    printf '{"refused":"worktree-missing","detail":%s,"paths":[]}\n' \
      "$(_json_str "worktree is gone: $workdir")"
    return 0
  fi
  # NOT re-implemented on the server. This rule has one definition, on the box,
  # and the server learns its verdict from the `bad-branch` token — two
  # implementations of one rule drift, which is what they do.
  if ! _ws_branch_valid "$new"; then
    printf '{"refused":"bad-branch","detail":%s,"paths":[]}\n' \
      "$(_json_str "invalid branch name: $new")"
    return 0
  fi

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
  if (( registered != 0 )); then
    printf '{"refused":"worktree-unregistered","detail":%s,"paths":[]}\n' \
      "$(_json_str "no worktree record for $workdir in $main — nothing renamed; with no registration no branch name is corroborated (the registry says '${reg_branch:-?}', which nothing now ties to that path): move the leftover directory aside, then git -C $main worktree add $workdir ${reg_branch:-<branch>}")"
    return 0
  fi
  #   2: registered, and the registration says `detached`. The remedy is to check
  #      a branch out, not to repair anything.
  if [[ -z "$old" ]]; then
    printf '{"refused":"detached","detail":%s,"paths":[]}\n' \
      "$(_json_str "$id is on a detached HEAD — nothing to rename")"
    return 0
  fi
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
  if [[ -z "$main_common" || "$wd_common" != "$main_common" ]]; then
    printf '{"refused":"worktree-foreign","detail":%s,"paths":[]}\n' \
      "$(_json_str "$workdir is not a worktree of $main — nothing renamed; move or delete the directory by hand, then git -C $main worktree prune && git -C $main worktree add $workdir $old")"
    return 0
  fi
  if [[ "$old" == "$new" ]]; then
    printf '{"refused":"unchanged","detail":%s,"paths":[]}\n' \
      "$(_json_str "already named $new")"
    return 0
  fi

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
    printf '{"refused":"has-upstream","detail":%s,"paths":[]}\n' \
      "$(_json_str "$old has an upstream — it is already on the remote; rename before pushing, not after")"
    return 0
  fi

  if git -C "$main" show-ref --verify --quiet "refs/heads/$new"; then
    printf '{"refused":"name-taken-local","detail":%s,"paths":[]}\n' \
      "$(_json_str "branch already exists locally: $new")"
    return 0
  fi

  # --exit-code: 0 = the head exists, 2 = it does not, anything else = we could
  # not ask. Unreachable is not the same as taken, and it stays a WARNING: a
  # refusal here would make ws-rename unusable offline for a branch that has
  # never been pushed.
  local rc; git -C "$main" ls-remote --exit-code --heads origin "$new" >/dev/null 2>&1; rc=$?
  case "$rc" in
    0) printf '{"refused":"name-taken-origin","detail":%s,"paths":[]}\n' \
         "$(_json_str "branch already exists on origin: $new")"
       return 0 ;;
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
  #
  # NO BUSY GUARD, deliberately, unlike `ws-archive`'s `session-busy`: when the
  # title this verb's automatic caller derives from lands, the session is busy by
  # definition — it is answering the first prompt. A busy guard would refuse the
  # only moment automatic naming ever fires.
  git -C "$main" branch -m "$old" "$new" || die "rename failed: $old -> $new"
  _reg_set "$id" branch "$new"
  printf '{"renamed":%s,"old":%s,"new":%s}\n' \
    "$(_json_str "$id")" "$(_json_str "$old")" "$(_json_str "$new")"
}
```

The registry field inventory comment (`ccd/ccd:129`) already lists `branch`; this verb writes no new field, so that comment is unchanged.

- [ ] **Step 4: Move the one other caller in the repo**

`server/test/ccd-workspaces.test.ts:479` (inside *"removes the RENAMED branch after ws-rename, leaving no ws/<slug> branch behind"*, `:477`) is the only other place anything invokes the verb. Replace:

```ts
    sh(`cmd_ws_rename demo-quiet-mesa feat/renamed`);
```

with:

```ts
    sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/renamed`);
```

- [ ] **Step 5: Run the two ccd suites**

Run: `cd server && npx vitest run test/ccd-ws-rename.test.ts test/ccd-workspaces.test.ts` (foreground, ~90 s)
Expected: PASS. Record the real counts.

Then run `cd server && npx vitest run test/wsaudit.test.ts` and **expect it to FAIL** with nine tokens listed as missing from `SENTENCES`. Copy that list into the Task 2 commit message — it is the measurement, not a guess.

- [ ] **Step 6: Lint the shell**

Run: `bash -n ccd/ccd && shellcheck -S error ccd/ccd || true`
Expected: `bash -n` clean. shellcheck is advisory (ccd predates it); a *new* error introduced by this diff is a finding.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-ws-rename.test.ts server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): ws-rename answers in JSON instead of dying on stderr

Twelve prose refusals become twelve tokens on stdout at exit 0, plus a
thirteenth for an argv ccd cannot read. Only \`git branch -m\` failing keeps a
non-zero exit — it is a fault, and nothing about the request was wrong.

The flags are not cosmetics: the agent's exec whitelist matches by prefix, so a
positional verb can only be granted as the one-token ['ws-rename'], which
permits any argv at all after it.

The tokens are inline printf literals rather than a helper's %s, because
wsaudit.test.ts harvests this file for \"refused\":\"<token>\" and asserts set
equality against SENTENCES. wsaudit.test.ts is red until the next commit, by
construction."
```

---

### Task 2: nine sentences nobody renders yet

**Files:**
- Modify: `server/src/wsaudit.ts` — `SENTENCES` (`:17-145`), appending after the `'held'` entry (`:144`)

**Interfaces:**
- Consumes: nothing.
- Produces: nine new keys on `SENTENCES` (45 → 54), consumed by `refusalSentence` (`server/src/wsaudit.ts:147`) and enumerated by `server/test/wsaudit.test.ts:52-101`.

**Why they are written when nothing renders them:** `wsaudit.test.ts` demands **exact set equality in both directions** (`:97`) between the tokens ccd's source can emit and `SENTENCES`'s keys — the mechanism that caught `branch-drift` → `registry-branch-drift`. Automatic naming logs its refusals server-side and surfaces nothing in the PWA, and this plan builds no manual rename control; the spec chose to write the copy anyway rather than teach the linkage test about verbs. Four of ws-rename's thirteen tokens (`no-such-session`, `not-a-workspace`, `incomplete-registry`, `worktree-missing`) are shared with `ws-reap` and are **already** above — do not duplicate them (a duplicate object key is not a test failure, it is a silent overwrite).

- [ ] **Step 1: Confirm the failure names exactly nine tokens**

Run: `cd server && npx vitest run test/wsaudit.test.ts`
Expected: FAIL, and the diff on *"the two sets are exactly equal"* lists exactly `bad-args, bad-branch, detached, has-upstream, name-taken-local, name-taken-origin, unchanged, worktree-foreign, worktree-unregistered`. If it lists more or fewer, Task 1's tokens are misspelled — fix there, not here.

- [ ] **Step 2: Write the copy**

Append to the `SENTENCES` object in `server/src/wsaudit.ts`, after the `'held'` entry:

```ts
  // ── ws-rename. Nine tokens whose copy no sheet renders TODAY: automatic
  // naming logs its refusals server-side and surfaces nothing in the PWA, and
  // this branch builds no manual rename control. They are here because
  // `wsaudit.test.ts` enumerates ccd's source and requires the two sets to be
  // EQUAL — the mechanism that caught `branch-drift` -> `registry-branch-drift`
  // — and because if a rename control is ever added the copy is already right
  // rather than a bash identifier on a phone screen. Four more of ws-rename's
  // thirteen tokens (`no-such-session`, `not-a-workspace`, `incomplete-registry`,
  // `worktree-missing`) are shared with ws-reap and are already above.
  //
  // VOCABULARY DEFERRAL, recorded rather than fixed (spec:371-376): the reap
  // side says `detached-head`, `foreign-worktree` and `no-worktree-record`
  // where these say `detached`, `worktree-foreign` and `worktree-unregistered`.
  // That is a real inconsistency, left as specified because nothing renders
  // these strings — aligning them later is cheap, and churning a written plan
  // and an approved table for a cosmetic gain is not worth it now.
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

- [ ] **Step 3: Run it**

Run: `cd server && npx vitest run test/wsaudit.test.ts`
Expected: PASS. The sanity floor (`ccdTokens.length > 30`) now sees 54; *"the two sets are exactly equal"* is the assertion to read, because it prints both sorted arrays on failure.

- [ ] **Step 4: Commit**

```bash
git add server/src/wsaudit.ts
git commit -m "feat(server): copy for ws-rename's nine new refusal tokens

wsaudit.test.ts demands set equality in BOTH directions between the tokens ccd
can emit and SENTENCES, so these are written even though no sheet renders them
— weakening an approved linkage test to fit a new caller is the wrong trade.
The reap side's detached-head/foreign-worktree/no-worktree-record vocabulary is
deliberately NOT aligned here; that deferral is recorded at the entries."
```

---

### Task 3: the server may emit it, but only with `--session`

**Files:**
- Modify: `server/src/ccdargv.ts:56-79` (`CCD_ARGV`) — add after `wsRelease` (`:78`)
- Modify: `agent/src/whitelist.ts:206-218` (`REQUIRED_VERB_FLAG` + its docstring), `:282-320` (`EXEC_WHITELIST.ccd` — after `['ws-release','--session']`, `:318`)
- Modify: `agent/test/types/ok/legit-whitelist.ts:70` (after `ReapNeedsExpect`)
- Modify: `server/src/remote/runner.ts:27-37` (`CCD_VERB_TIMEOUT_MS`)
- Modify: `server/test/remote-runner.test.ts:78-84` (`describe('per-verb timeouts')` `it.each` table) — the row that lets a mutant on the new `CCD_VERB_TIMEOUT_MS` entry be caught
- Modify: `server/test/whitelist-subset.test.ts:13-34` (`SAMPLES`), `:238-260` (`EXPECTED`), `:85-210` (layer 3)

**Interfaces:**
- Consumes: `argv()` (`server/src/ccdargv.ts:46`) — the only mint site for `CcdArgv`, `Object.freeze`d.
- Produces: `CCD_ARGV.wsRename(id: string, branch: string): CcdArgv` → `['ws-rename','--session',id,'--branch',branch]`. `EXEC_WHITELIST.ccd` gains `['ws-rename','--session']`; `REQUIRED_VERB_FLAG` gains `'ws-rename': '--session'`; `CCD_VERB_TIMEOUT_MS` gains `'ws-rename': 20_000`.

`SAMPLES` and `EXPECTED` are `Record<keyof typeof CCD_ARGV, string[]>`, so a missing key is **TS2741/TS2739** under `typecheck-tests.test.ts`'s spawned tsc — this task cannot be half-done.

- [ ] **Step 1: Write the failing test**

In `server/test/whitelist-subset.test.ts`, add to `SAMPLES` after the `wsRelease` line (`:33`):

```ts
  wsRename: ['demo-quiet-basin', 'ws/brainstorm-helix-and-slide-notes'],
```

and to `EXPECTED` after its `wsRelease` line (`:259`):

```ts
  wsRename: ['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/brainstorm-helix-and-slide-notes'],
```

Then add a new assertion inside `describe('layer 3 — the list never drifts wider than the code')`, immediately after the `ws-reap` one (which ends at `:161`):

```ts
  // The SECOND entry in REQUIRED_VERB_FLAG, and the first one that is not there
  // because the verb is destructive. `ws-rename` destroys nothing; it is here
  // because it is the SECOND verb the server calls unattended — after
  // `ws-archive`, which `FleetWatcher.archiveMerged` already fires on merge
  // with no human in the loop — and the first whose argv is derived from
  // model output (FleetWatcher's naming sweep). So the grant must name the
  // flag rather than the verb: a bare `['ws-rename']` permits `ccd ws-rename
  // <anything> <anything…>`, which is exactly the positional argv surface
  // this branch left behind. Cross-PACKAGE and object-reading, for the
  // reasons the ws-reap assertion above states.
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

Run: `cd server && npx vitest run test/whitelist-subset.test.ts test/typecheck-tests.test.ts`
Expected: FAIL — `typecheck-tests.test.ts` reports TS2353 (`wsRename` does not exist in `Record<keyof typeof CCD_ARGV, string[]>`) on both new object entries, and the new `it` fails with `rn.length` 0.

- [ ] **Step 3: Add the argv entry**

In `server/src/ccdargv.ts`, after the `wsRelease` line (`:78`):

```ts
  /** The second ccd write with no human in the loop — after `wsArchive`, which
   *  `FleetWatcher.archiveMerged` already fires unattended on merge — and the
   *  first whose argv is derived from model output. `--branch` carries a name
   *  `_ws_branch_valid` has NOT seen yet: validation lives on the box, once,
   *  and the server learns its verdict from the `bad-branch` refusal token. */
  wsRename:  (id: string, branch: string) => argv(['ws-rename', '--session', id, '--branch', branch]),
```

- [ ] **Step 4: Grant it, and gate the flag**

In `agent/src/whitelist.ts`, replace the `REQUIRED_VERB_FLAG` docstring and constant (`:206-218`):

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
 * `ws-rename` destroys nothing, and is here because it is the second verb the
 * server calls UNATTENDED — after `ws-archive`, which `FleetWatcher.archiveMerged`
 * already fires on merge with no human anywhere in the path — and the first
 * whose argv is derived from model output (FleetWatcher's naming sweep).
 * Prefix matching means a one-token `['ws-rename']` permits `ccd ws-rename
 * <anything> <anything…>` — the whole positional argv surface the verb used
 * to have — for a call no human ever reviews. Naming the flag makes the grant
 * two tokens wide, and makes losing it both a compile error and a boot
 * refusal.
 *
 * Kept as data rather than a hardcoded `if` so the type below and the runtime
 * audit read the SAME source — the P2 failure mode (auditor and lookup asking
 * different questions) is the one to avoid while fixing P1.
 */
export const REQUIRED_VERB_FLAG = { 'ws-reap': '--expect', 'ws-rename': '--session' } as const;
```

and add the grant to `EXEC_WHITELIST.ccd`, after `['ws-release', '--session'],` (`:318`):

```ts
    // Unattended caller (FleetWatcher's naming sweep): the flag is what keeps
    // this grant two tokens wide instead of one, and REQUIRED_VERB_FLAG is what
    // makes losing it a boot refusal rather than a widening nobody notices.
    ['ws-rename',  '--session'],
```

In `agent/test/types/ok/legit-whitelist.ts`, after `ReapNeedsExpect` (`:70`):

```ts
export type RenameNeedsSession = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-rename'], '--session'>>;
```

- [ ] **Step 5: Give it a budget**

In `server/src/remote/runner.ts`, inside `CCD_VERB_TIMEOUT_MS` (`:27-37`), after the `'pr-state': 20_000,` line:

```ts
  // Same reach as pr-state, and the same number: it shells out to `git
  // ls-remote` against origin before it will rename. Without an entry it
  // silently inherits the flat 90 s, which is nine naming lanes' worth.
  'ws-rename': 20_000,
```

**Also add the discriminating row**, or this entry has no test that can tell it apart from its own absence. In `server/test/remote-runner.test.ts`, inside the `describe('per-verb timeouts')` `it.each` table (`:78-84`), after the `pr-state` row:

```ts
    [['ws-rename', '--session', 'x', '--branch', 'ws/x'], 20_000],
```

- [ ] **Step 6: Run the gates this task moves**

Run: `cd agent && npx vitest run && cd ../server && npx vitest run test/whitelist-subset.test.ts test/verb-gate.test.ts test/ccdargv-brand.test.ts test/typecheck-tests.test.ts`
Expected: PASS everywhere. `verb-gate.test.ts` must **still pass**: `wsRename` has no call site yet, and that test only polices sites that exist (`ALL_SITES` is discovered by scanning `server/src`). `auditExecWhitelist` runs at agent module load, so a malformed grant fails every agent test at once rather than one — record the agent suite's real count.

- [ ] **Step 7: Commit**

```bash
git add server/src/ccdargv.ts agent/src/whitelist.ts agent/test/types/ok/legit-whitelist.ts server/src/remote/runner.ts server/test/whitelist-subset.test.ts server/test/remote-runner.test.ts
git commit -m "feat(ccrc): the server may emit ws-rename, but only with --session

REQUIRED_VERB_FLAG gains its second entry, and the first one that is not about a
destructive verb: ws-rename is the second verb the server calls with no human
in the loop (after ws-archive, which FleetWatcher.archiveMerged already fires
on merge) and the first whose argv is derived from model output. A bare
one-token grant would permit the entire positional argv surface the verb just
left behind.

20s, the same budget pr-state was given, because it reaches origin through
git ls-remote before it will rename anything."
```

---

### Task 4: one queue for the process

**Files:**
- Modify: `server/src/server.ts:68-96` (`Deps`), `:312` (`sendDeps`)
- Modify: `server/src/index.ts:32-52` (both `deps` literals), and one new import
- Modify: `server/test/helpers.ts:37`, plus twelve hand-built `Deps` literals in seven test files (enumerated in Step 3)
- Modify: `server/test/single-definition.test.ts` (new guard), `server/test/routes.test.ts` (behavioural pin)

**Interfaces:**
- Consumes: `KeyedQueue` (`server/src/inject/queue.ts:6`) — per-key FIFO; different keys fully independent; a rejected fn rejects its own caller but never blocks the fns behind it.
- Produces: `Deps.queue: KeyedQueue`, **required**. `buildServer` stops constructing one; `FleetWatcher` (Task 6) reads `this.deps.queue`.

**Why required and not optional:** the whole property is that there is exactly ONE queue, so an optional field with a `?? new KeyedQueue()` fallback at each reader is the bug wearing the fix's clothes — two queues serialise nothing, silently, and no test would say so. Required makes a missed site a compile error under `typecheck-tests.test.ts`'s spawned tsc.

**Why not a constructor parameter on `FleetWatcher`:** `intervalMs` and `cachePath` already occupy positions 3 and 4 (`server/src/watch.ts:137`), so the queue would land at position 5 and `index.ts` would read `new FleetWatcher(deps, bus, undefined, undefined, queue)` — a call whose correctness depends on counting `undefined`s, and whose default is the very fallback this task exists to remove.

**The seven existing join sites** (deviation D-3, measured): `inject/send.ts:266,487,533,567`, `inject/ask.ts:39`, `server.ts:579,702`. All are unchanged — they read `d.queue` / `sendDeps.queue`, and `sendDeps` now forwards `deps.queue`. The rename makes eight.

- [ ] **Step 1: Write the failing structural guard**

Append to `server/test/single-definition.test.ts` (it already scans `shared`, `server/src`, `pwa/src`, `agent/src` — the `ROOTS` array at `:29-34`):

```ts
describe('one KeyedQueue for the process', () => {
  // The seam the naming sweep needs. `buildServer` used to construct its own
  // KeyedQueue inline (`server.ts:321` on origin/main, the tree this diverged
  // from), which FleetWatcher — built two lines EARLIER in index.ts (`:61` vs
  // `:63` on that same tree; `:68` vs `:70` on this one, now that the queue
  // itself hoisted one level further to `index.ts:37`) — had no way to reach.
  // A watcher that built its own would serialise its rename against nothing,
  // and `POST /workspace/reap` (`server.ts:718`) is exactly the write it must
  // not race. An optional Deps field with a `?? new KeyedQueue()` fallback is
  // the same bug with a green suite, which is why this scans for the
  // CONSTRUCTOR rather than for the field.
  const CONSTRUCTS = /\bnew KeyedQueue\s*\(/;

  it('is constructed in exactly one file under server/src, and that file is the composition root', () => {
    const holders = ALL.filter((f) => f.includes(`${path.sep}server${path.sep}src${path.sep}`))
      .filter((f) => CONSTRUCTS.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['server/src/index.ts']);
  });

  it('both consumers take it from Deps rather than making their own', () => {
    for (const f of ['server/src/server.ts', 'server/src/watch.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).not.toMatch(CONSTRUCTS);
    }
    expect(readFileSync(path.join(ccrcRoot, 'server/src/server.ts'), 'utf8'))
      .toContain('queue: deps.queue');
  });
});
```

(`server/src/watch.ts` has no queue reference until Task 6; the second assertion is a *negative* on it, so it passes now and stays meaningful after.)

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run test/single-definition.test.ts`
Expected: FAIL — `holders` is `['server/src/server.ts']`.

- [ ] **Step 3: Add the field and build it at the root**

In `server/src/server.ts`, inside `Deps`, after the `refreshCaps` entry (`:82`):

```ts
  /** The ONE per-session write queue for the process. Built in `index.ts` and
   *  handed to both `buildServer` and `FleetWatcher`, because the naming
   *  sweep's `ws-rename` has to serialise against `POST /workspace/reap` — and
   *  two `KeyedQueue`s serialise nothing at all. Required, not optional: an
   *  absent field with a local fallback is exactly how a second queue gets
   *  built with every suite green. */
  queue: KeyedQueue;
```

`KeyedQueue` is already imported at `server.ts:21`. Replace `:312`:

```ts
  const sendDeps: SendDeps = { tmux: deps.tmux, queue: deps.queue };
```

In `server/src/index.ts`, add the import beside the others (after `:13`):

```ts
import { KeyedQueue } from './inject/queue.js';
```

and insert above `let deps: Deps;` (`:32`):

```ts
// ONE queue, above the mode branch, so both modes and both consumers get the
// same object. Serialising the naming sweep's rename against
// POST /workspace/reap is the point; a per-consumer queue would serialise a
// call only against itself.
const queue = new KeyedQueue();
```

then add `queue` to both `deps` literals (`:42-46` remote, `:48-51` local) — one token each, beside `push`/`notifyLog`/`presence`.

- [ ] **Step 4: Let tsc name the test sites, and fix exactly these**

Run: `cd server && npx tsc -p test/tsconfig.tests.json --noEmit` (or just run `test/typecheck-tests.test.ts`, which spawns the same compile).

This is the complete list measured on this tree. Every one takes the same one-token addition, and each file gains `import { KeyedQueue } from '../src/inject/queue.js';`:

| file:line | site |
|---|---|
| `test/helpers.ts:37` | `testDeps`'s return literal — **the one that covers most files** |
| `test/routes.test.ts:61` | inline `buildServer({…})` |
| `test/commands.test.ts:48`, `:63` | inline `buildServer({…})` |
| `test/dialog.test.ts:242`, `:297` | `const deps = {…}` |
| `test/lifecycle.test.ts:47`, `:112`, `:139` | inline `buildServer({…})` |
| `test/fleet-health.test.ts:28` | factory return literal |
| `test/sessionws.test.ts:218`, `:525`, `:604` | `const deps: Deps = {…}` / inline `buildServer({…})` |

Every other `Deps` in the suite is `{ ...testDeps(...) }` and inherits the field for free — do not touch those.

A fresh `new KeyedQueue()` per factory call is right: tests want independent queues, and `testDeps()` is called once per fixture.

- [ ] **Step 5: Pin the behaviour, not just the shape**

Append to `server/test/routes.test.ts`, in a new `describe` at the end of the file:

```ts
describe('one queue for the process', () => {
  it('Deps carries the queue, and submissions under one key run in order', async () => {
    const deps = testDeps();
    const seen: string[] = [];
    await Promise.all([
      deps.queue.run('demo-quiet-mesa', async () => { seen.push('a'); }),
      deps.queue.run('demo-quiet-mesa', async () => { seen.push('b'); }),
    ]);
    expect(seen).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 6: Run the whole server suite**

Run: `cd server && npx vitest run` (foreground, ~200 s, `timeout: 600000`)
Expected: PASS, count = baseline + 3. `typecheck-tests.test.ts` is the gate proving no `Deps` literal was missed.

- [ ] **Step 7: Commit**

```bash
git add server/src/server.ts server/src/index.ts server/test
git commit -m "refactor(server): the KeyedQueue moves to the composition root

It was a local const inside buildServer, and FleetWatcher is constructed two
lines earlier in index.ts — so the watcher had no way to reach it. Required on
Deps rather than optional: an optional field with a local fallback builds a
SECOND queue that serialises nothing, with every suite green. A structural guard
now pins that `new KeyedQueue()` appears in exactly one file under server/src."
```

---

### Task 5: the name the model wrote becomes a branch name

**Files:**
- Create: `server/src/naming.ts`
- Create: `server/src/transcript/title.ts`
- Create: `server/test/naming.test.ts`

**Interfaces:**
- Consumes: `FleetIO` (`server/src/io.ts:11-24`) — `stat(path): Promise<{mtimeMs, size} | null>` and `readFileFrom(path, offset): Promise<{data: string; size: number} | null>`, both of which cross the agent WS in remote mode and both of which return `null` rather than throwing. `deriveBranch` consumes nothing at all — no io, no config, no clock.
- Produces: `SLUG_MAX = 40`; `deriveBranch(title: string): string | null` — `null` when the title slugifies to the empty string, otherwise `ws/<slug>` with `slug.length <= SLUG_MAX`. `readAiTitle(io: FleetIO, file: string): Promise<string | null>` — the LAST non-blank `ai-title` in the 256 KB tail, or `null`.

`readAiTitle`'s signature mirrors `readPendingAsk(io, file)` (`server/src/transcript/ask.ts:54`) exactly, including its own `stat`: the caller stats to decide whether to read at all, and this stats again to size the tail. That is one extra ~100-byte RPC per session per sweep against a read of up to 256 KB, and it buys a function testable with `localIO` and a real file, exactly as `ask.test.ts` tests its neighbour.

- [ ] **Step 1: Write the failing tests**

Create `server/test/naming.test.ts`:

```ts
// The 40 is the SLUG's budget, not the branch's: `ws/` is three more characters
// on the wire and the rule deliberately does not count them.
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { SLUG_MAX, deriveBranch } from '../src/naming.js';
import { readAiTitle } from '../src/transcript/title.js';
import { mkTmp } from './tmpHelpers.js';

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
    // The spec's own worked example. `brainstorm-helix-and-slide-notes-integration`
    // is 44 characters; a cut at 40 lands mid-`integration`, and dropping BACK
    // gives 32. Rounding forward would give the whole 44 and blow the budget.
    expect(deriveBranch('Brainstorm Helix and slide notes integration'))
      .toBe('ws/brainstorm-helix-and-slide-notes');
  });

  it('does not drop back when the cut already lands on a boundary', () => {
    // slug[40] === '-': the first 40 characters are a whole word run, so there
    // is nothing to drop back over. A blind lastIndexOf would lose the last
    // whole word for no reason.
    const slug = 'a'.repeat(SLUG_MAX);
    expect(deriveBranch(`${'a'.repeat(SLUG_MAX)} b`)).toBe(`ws/${slug}`);
  });

  it('hard-cuts a single word with no dash in the first 40 characters', () => {
    // 45 characters, one word: there is no boundary to drop back to, so the
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
    // `transcript/ask.ts:11-16` names `ai-title` among the types it deliberately
    // skips; this is the first consumer it has ever had.
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

Run: `cd server && npx vitest run test/naming.test.ts`
Expected: FAIL — `Cannot find module '../src/naming.js'`.

- [ ] **Step 3: Write the derivation**

Create `server/src/naming.ts`:

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
 * `null` when the title has nothing alphanumeric in it — not an empty string.
 * `ws/${''}` is `ws/`, and ccd's own `_ws_branch_valid` (`ccd/ccd:1337-1347`)
 * DOES refuse a name that starts or ends with a slash, so the box would answer
 * `bad-branch` rather than ever create that ref — but sending the call anyway
 * would still burn the one-attempt-per-(id, derived-branch) retry budget on a
 * name nobody chose, for a title that has nothing to give. A caller that gets
 * `null` makes no call at all, which is the spec's own rule: "a title that
 * slugifies to the empty string ... is not a rename — no call is made."
 *
 * The character class is a subset of what ccd's `_ws_branch_valid`
 * (`ccd/ccd:1337-1347`) permits, on purpose — but this is NOT a second copy of
 * that rule. The rule has one definition, on the box; this only avoids sending
 * names that are certain to be refused, and the verdict still comes back as
 * `bad-branch`.
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

There is deliberately no trailing-dash strip at the end: the collapse leaves no `--` run and strips both ends, so `cut` can only end in `-` when `slug[SLUG_MAX - 1] === '-'` — and in that case `lastIndexOf` finds exactly that index and `slice(0, at)` removes it. The `never emits a trailing dash` case is what holds that reasoning to account.

- [ ] **Step 4: Write the reader**

Create `server/src/transcript/title.ts`:

```ts
// The line Claude Code has been writing since before ccrc existed, and which
// nothing has ever consumed: `ask.ts:11-16` names `ai-title` among the types it
// deliberately skips. It is a name a model generated from the first prompt, and
// it is already paid for.
import type { FleetIO } from '../io.js';

/** Measured across the 600 transcripts on this box that carry an `ai-title`:
 *  the last one sits at most 45,996 bytes from EOF (p95 31,177; median 12,687).
 *  256 KB is 5.5x headroom on the worst case, where 64 KB would be 1.4x and too
 *  tight. Same figure as `ask.ts`'s TAIL_BYTES, arrived at from a different
 *  measurement — and far under `tail.ts`'s backlog window, which is what bounds
 *  the agent's RSS. */
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

- [ ] **Step 5: Run it**

Run: `cd server && npx vitest run test/naming.test.ts`
Expected: PASS, 15 cases.

- [ ] **Step 6: Commit**

```bash
git add server/src/naming.ts server/src/transcript/title.ts server/test/naming.test.ts
git commit -m "feat(server): a title becomes a branch name, read from the tail

The 40 is the slug's budget and excludes ws/. The boundary drops BACK to the
last dash at or before the cut — forward would blow the budget — and a cut that
already lands on a dash drops back no further, which a blind lastIndexOf would
get wrong by one whole word.

The reader takes a 256 KB tail, the same window readPendingAsk uses, sized from
a measurement of the 600 transcripts on this box that carry an ai-title: the
last sits at most 45,996 bytes from EOF. Last wins rather than first, because
Claude Code rewrites the line once per turn."
```

---

### Task 6: the naming sweep

**Files:**
- Modify: `server/src/watch.ts` — three imports (after `:9`); `NAME_SWEEP_MS` and `PERMANENT_REFUSALS` beside `TASK_SWEEP_MS` (`:24`); four fields (beside `lastCapsAt`, `:115`); one dispatch in `tick()` (after the caps block, which closes at `:233`); `claimTitleRead` + `sweepNames` (after `sweepTasks`, which closes at `:334`). Post-build sync: `PERMANENT_REFUSALS` and `nameSweepRetired` did not exist at this task originally — see the note before Step 3's code block.
- Create: `server/test/name-sweep.test.ts`

**Interfaces:**
- Consumes: `readRegistry(io, cfg)` → `SessionRecord[]` with `workspace: string | null`, `branch: string | null`, `wrapper`, `workdir`, `uuid` (`server/src/registry.ts:102`); `transcriptPath(configDir, dir, uuid)` (`server/src/transcript/resolve.ts:8`); `readAiTitle` and `deriveBranch` (Task 5); `CCD_ARGV.wsRename` + `verbSupported` (Task 3, already imported at `watch.ts:9`); `this.deps.queue` (Task 4); `this.deps.runCcd`.
- Produces: `NAME_SWEEP_MS = 10_000`; `PERMANENT_REFUSALS: ReadonlySet<string>`; `private lastNameSweep`, `private attemptedRenames: Set<string>`, `private nameSweepRetired: Set<string>`, `private titleProbe: Map<…>`; `private claimTitleRead(...)`; **`async sweepNames(): Promise<void>` — public**.

**Why `sweepNames` is public and `sweepTasks` is not:** `tick()` dispatches it with `void`, deliberately (it can wait minutes behind a queued reap), so a test that `await`s `tick()` has *not* awaited the sweep — every assertion about it would be a race, and every negative assertion would pass while the sweep was still running. Public, it is awaited directly and the tests are deterministic. One test still goes through `tick()`, to prove the lane is wired in *and* that the tick does not wait for it.

**Condition 2 reads `SessionRecord.branch`, never `FleetSession.branch`.** The assembled value is `sl?.branch ?? r.branch ?? null` (`server/src/fleet.ts:155`) and the statusline wins deliberately — but `cmd_ws_rename` writes the registry synchronously while the statusline only moves when Claude Code re-renders, so for some number of ticks after a successful rename the assembled branch still reads the born name. The sweep calls `readRegistry` itself, exactly as `sweepTasks` (`:323`) and `sweepPr` (`:362`) already do.

**Order is load-bearing:** `verbSupported` is asked BEFORE `claimTitleRead` records anything. Recording a probe for a session the fleet cannot rename would make the next sweep skip the read of an unchanged transcript, so a fleet that installed a newer ccd would leave every existing workspace unnamed until its transcript happened to grow — the exact outcome the spec's `verbSupported` row exists to prevent.

- [ ] **Step 1: Write the failing test**

Create `server/test/name-sweep.test.ts`:

```ts
// The sixth lane. (The fifth is hook-state sweeping — watch.ts:154.) Four
// conditions, and the two that are easy to get wrong are which `branch` it
// reads (the registry's, not the assembled one) and when it records the stat
// probe (after the verb gate, never before it).
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
const MUNGED = '-w-demo-quiet-mesa';      // mungePath: /._ -> - (munge.ts:1)

/** Registry row for a workspace still on its born branch. `readRegistry` needs
 *  wrapper+workdir+uuid or it skips the row entirely (registry.ts:122). */
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
 *  resolves to for the row `seed` writes: `<home>/.claude/projects/<munged>/<uuid>.jsonl`. */
const transcript = (home: string, lines: string[]): string => {
  const dir = path.join(home, '.claude', 'projects', MUNGED);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
};

/** A statusline pane in the shape `parseStatusline` parses: the branch is the
 *  `⎇` segment, delimited by the box-vertical. Check `src/pane/statusline.ts`
 *  and copy its own fixture idiom if this drifts. */
const pane = (branch: string): string =>
  `  👤 claude │ 🤖 Sonnet 5 │ ⎇ ${branch} │ 🎯 demo`;

interface Harness { home: string; calls: string[][]; run: Runner }

/** A runner that answers tmux well enough and records every ws-rename argv.
 *  It goes through `testDeps`'s guardRunner, so an argv the agent whitelist
 *  refuses throws here rather than being silently recorded. */
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

/** Fake timers are the default here, not the exception: see `again`. Tests that
 *  need real ones say so. */
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
  // `sl?.branch ?? r.branch` (fleet.ts:155) — the statusline WINS, deliberately
  // — and it only moves when Claude Code re-renders, so it still reports the
  // born branch for some number of ticks after a successful rename. A sweep
  // reading the assembled value would rename the workspace a second time, to a
  // name the registry says it already has.
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

    // ccd is installed; the caps lane refreshes the list. The transcript has NOT
    // changed, so this fires only if the unsupported pass recorded no stat probe
    // — i.e. only if verbSupported is asked BEFORE claimTitleRead.
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
    // Stands in for POST /workspace/reap (server.ts:718), which holds the same key.
    void deps.queue.run(ID, () => new Promise<void>((r) => { release = r; }));
    const w = new FleetWatcher(deps, new Bus(), 2000);

    const sweep = w.sweepNames();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls, 'the rename must wait behind the held key').toEqual([]);

    release();
    await sweep;
    expect(h.calls).toHaveLength(1);
  });

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

Run: `cd server && npx vitest run test/name-sweep.test.ts`
Expected: FAIL — `w.sweepNames is not a function` on every case. The negative cases would otherwise pass vacuously, which is exactly why the positive one is first in the file and why the statusline case asserts its own fixture.

- [ ] **Step 3: Add the imports and the lane constant**

In `server/src/watch.ts`, add to the import block (after `:9`, `CCD_ARGV, verbSupported`):

```ts
import { deriveBranch } from './naming.js';
import { transcriptPath } from './transcript/resolve.js';
import { readAiTitle } from './transcript/title.js';
```

and the constants, immediately after `TASK_SWEEP_MS` (`:24`) — Post-build sync: `PERMANENT_REFUSALS` did not exist at this step originally; review findings 1 and 5 (see D-5) added and then corrected it, and this block now shows the shipped result rather than the intermediate one:

```ts
/** The sixth lane (the fifth is hook-state sweeping, which rides the 2 s tick).
 *  Naming does NOT ride that tick: a title that appears ten seconds late costs
 *  nothing, and reading transcripts thirty times a minute to learn nothing costs
 *  real work — the nine transcripts on this box that carry no `ai-title` at all
 *  would be re-read forever, roughly 7.7 MB/min across the agent WS. */
const NAME_SWEEP_MS = 10_000;

/** Refusal tokens (of ccd's thirteen, `spec:55`) that cannot stop being true:
 *  a branch, once pushed, is never un-pushed (`has-upstream`); a checkout
 *  that is not a workspace, a worktree ccd cannot find registered, and a
 *  worktree whose directory belongs to a different session are all facts
 *  about the session's shape that a title landing later cannot change (the
 *  last two ship their own remedy in the refusal detail, `git -C $main
 *  worktree add …`, which "cannot stop being true" only in the narrower
 *  sense that no TITLE fixes it). `name-taken-local`/`name-taken-origin`
 *  and `unchanged` are deliberately absent — a name collision or a
 *  since-changed title can resolve on the next sweep. See
 *  `FleetWatcher.nameSweepRetired` and review finding 1.
 *
 *  `bad-branch` is deliberately NOT here, unlike the earlier draft of this
 *  set (review finding 5): it is a verdict on `deriveBranch(title)`, not on
 *  the workspace, and a later title is exactly the thing that can change it.
 *  Retiring the SESSION on `bad-branch` would be wrong the day it ever fires
 *  — `attemptedRenames`'s per-(id, derived-branch) key is already the
 *  correct guard for a name-dependent refusal. Today the arm is dead code:
 *  `deriveBranch` only ever emits `ws/[a-z0-9]+(-[a-z0-9]+)*`, a subset
 *  `_ws_branch_valid` (`ccd/ccd:1337-1347`) always accepts, so `bad-branch`
 *  never actually reaches this lane — see `naming.ts:26-30`. */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([
  'has-upstream', 'not-a-workspace', 'worktree-unregistered', 'worktree-foreign',
]);
```

- [ ] **Step 4: Add the four pieces of state**

Beside the other lane clocks, after `lastCapsAt` (`:115`):

```ts
  /** The sixth lane's clock. */
  private lastNameSweep = 0;
  /** `<id>:<derived-branch>` for every pair already tried. THE DERIVED NAME,
   *  not the born slug: a title that changes while the branch is still at its
   *  born name earns exactly one fresh attempt, and a server restart earns one
   *  retry — which is the right amount, because the usual reason a rename
   *  failed is a condition a restart does not change, and the one reason it
   *  might have (a transient fleet outage) is worth one more try. Deliberately
   *  not durable: a registry marker would be state ccd has to own, write and
   *  purge on reap, for a retry budget whose entire purpose is to be
   *  forgotten. */
  private attemptedRenames = new Set<string>();
  /** Session ids the sweep will never spend another transcript read on.
   *  `attemptedRenames` is keyed per (id, derived branch) and cannot express
   *  this: a title that keeps changing on a workspace whose branch was
   *  already pushed would keep minting fresh pairs forever, and each one
   *  earns its "one fresh attempt" — the stat gate (`claimTitleRead`) never
   *  closes on a session whose transcript is still growing. Populated only by
   *  a refusal that is permanent BY CONSTRUCTION (`PERMANENT_REFUSALS`),
   *  never by a transient one — a fleet outage or a name collision can stop
   *  being true; a pushed branch cannot become un-pushed. Review finding 1:
   *  without this, a live workspace stuck on `has-upstream` re-reads a 256 KB
   *  tail every ten seconds indefinitely, the exact cost the stat gate exists
   *  to price out. Deliberately not durable, same reasoning as
   *  `attemptedRenames`. */
  private nameSweepRetired = new Set<string>();
  /** Per session: the transcript state whose title the sweep has already acted
   *  on. Same gate, for the same reason, as `SessionStream.claimAskRead`
   *  (`sessionws.ts:178-187`). */
  private titleProbe = new Map<string, { file: string; size: number; mtimeMs: number }>();
```

- [ ] **Step 5: Dispatch it from the tick**

In `tick()`, immediately after the caps block (`:225-233`, i.e. before the `assembleFleet` call at `:234`):

```ts
    // NEVER awaited, same reasoning as sweepPr above and then some: this one
    // joins the per-session KeyedQueue, which `POST /workspace/reap` can hold
    // for minutes. Awaiting it would put the dialog detector and the
    // busy->idle push behind a reap. Overlapping sweeps are harmless — the
    // attempted-set is written BEFORE the call, so a second sweep's condition 4
    // refuses the pair the first is still running.
    void this.sweepNames().catch(() => { /* one bad sweep must not kill the poll */ });
```

- [ ] **Step 6: Write the gate and the sweep**

Add both methods after `sweepTasks` (closes `:334`), before `sweepPr`'s docstring (`:336`):

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
   * saying something they did not say last time. Copied from
   * `SessionStream.claimAskRead` (`sessionws.ts:178-187`), keyed per SESSION
   * rather than per stream because this map outlives any one socket.
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
   *   1. it is a workspace, not a main checkout, and not archived — `ccd
   *      ws-archive` "DESTROYS NOTHING" (`ccd:1670`), so an archived row keeps
   *      `workspace`, `branch = ws/<slug>`, its worktree and its transcript,
   *      fully in scope for conditions 2-4 unless excluded here; same guard,
   *      same shape, as the write right below this one in the file
   *      (`archiveMerged`, `r.workspace === null || r.archivedAt !== null`) —
   *      review finding 2;
   *   2. the REGISTRY says the branch is still exactly `ws/<workspace>` —
   *      condition 2 is also the idempotence marker, which is why there is no
   *      new registry field, no marker file and nothing to purge on reap;
   *   3. the fleet's ccd implements the verb — asked BEFORE the probe below is
   *      recorded, so a fleet that installs a newer ccd re-reads transcripts
   *      that have not changed since;
   *   4. this `(id, derived name)` pair has not been attempted, AND the
   *      session has not been retired outright by an earlier refusal that is
   *      permanent by construction (`PERMANENT_REFUSALS` — review finding 1;
   *      `nameSweepRetired` is checked first, since it is the cheaper
   *      question and answers it without a stat or a transcript read).
   *
   * KNOWN GAP IN CONDITION 3, accepted and not engineered around: `ccd caps`
   * has advertised `ws-rename` since long before it took flags (`ccd:1454`), so
   * a fleet on an older ccd passes the verb gate. The old body binds the verb's
   * two arguments positionally — `local id="${1:?usage: …}"; local
   * new="${2:?…}"` — and this argv is `['ws-rename', '--session', <id>,
   * '--branch', <name>]`, so `$1` is the literal string `--session` and `$2`
   * is `<id>` — BOTH non-empty, so neither `${1:?}` nor `${2:?}` fires. It
   * falls through to `[[ -f "$REG/$id.uuid" ]] || die "no such session: $id"`
   * with `id` bound to `--session`, and dies `no such session: --session` —
   * NOT bash's own usage refusal (measured; see review finding 3). That is one
   * non-ok result per (session, derived name), absorbed by the retry guard,
   * and the rollout is agent-first so the window is one deploy long.
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
    // is `sl?.branch ?? r.branch` (fleet.ts:155) and the statusline wins, so it
    // lags a rename by however long Claude Code takes to re-render its pane.
    // Same reason sweepTasks and sweepPr read the registry themselves.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      // `ws-archive` destroys nothing — an archived row is still `workspace
      // !== null` with `branch` still at the born name — so it is excluded
      // here explicitly, the same shape `archiveMerged` below already uses.
      if (r.workspace === null || r.archivedAt !== null) continue;
      const born = `ws/${r.workspace}`;
      if (r.branch !== born) continue;
      // The cheapest question in the function, asked before anything that
      // costs a stat or a read: a session already retired by a permanent
      // refusal (`has-upstream` and its siblings) can never un-retire.
      if (this.nameSweepRetired.has(r.id)) continue;
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
      // AFTER the add, deliberately: the spec's error table marks this pair
      // attempted, and the key is the one this session would have used.
      if (branch === born) continue;      // the title already names the workspace
      // Through the per-session queue, so it serialises against every other
      // server-originated write on this session — the reap it must not race is
      // POST /workspace/reap, which is already queued. It does NOT serialise
      // against a ws-reap or ws-restore run by hand on the box: those take
      // `$REG/.reap-$id.lock`, which ws-rename does not, and that residue is
      // accepted (a hand-run reap on a workspace whose first turn is still
      // landing is not a case worth a lock for, and the rename is a
      // `git branch -m` a reap would immediately make moot).
      const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(CCD_ARGV.wsRename(r.id, branch)));
      if (!res.ok) {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} failed: ${res.stderr.trim()}`);
        continue;
      }
      let refused: unknown;
      try { refused = (JSON.parse(res.stdout.trim()) as { refused?: unknown }).refused; }
      catch { /* not an answer we can read — an older ccd, or a fault */ }
      if (typeof refused === 'string') {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} refused: ${refused}`);
        // Permanent by construction: nothing about a LATER title can make a
        // pushed branch un-pushed, or a foreign/unregistered worktree become
        // this session's own. Retire the session, not just this pair — see
        // `nameSweepRetired`.
        if (PERMANENT_REFUSALS.has(refused)) this.nameSweepRetired.add(r.id);
      }
    }
  }
```

Post-build sync: the block above shows the shipped `sweepNames` — the four-condition list now names the archived exclusion and the `nameSweepRetired` guard, and the KNOWN GAP paragraph carries the measured failure mode (review finding 3) rather than the assumed "bash's own usage refusal". Neither existed at this step originally; they landed via review findings 1, 2, 3 and 5 on this same branch (see D-5) and were never folded back into this code block until now.

**Second post-build sync (Build 3 PR H whole-branch review, retroactive):** `sweepNames` changed again after the sync above — `registry-branch-drift` joined `PERMANENT_REFUSALS`, both retirement sets are now keyed on `<id>#<uuid>` rather than bare `<id>` (a recycled slug hazard, unrelated to D-5), and the KNOWN GAP paragraph's `ccd:1454` anchor was corrected to `ccd:1628` (the shipped tree's own `cmd_caps` entry — see the D-4 paragraph above for why that same fact reads `:1480` there instead: D-4 describes an OLD, pre-PR ccd, whose correct baseline is `origin/main`, not this branch's HEAD). The block above is **not** re-synced a second time — see the note on the plan's own line-anchor claims in the Self-review section: this document is an execution record of the tree at the time each task ran, not a live mirror of `server/src/watch.ts`. Read the shipped file for the current text.

- [ ] **Step 7: Run the new suite and the structural gates**

Run: `cd server && npx vitest run test/name-sweep.test.ts test/verb-gate.test.ts test/pr-sweep.test.ts test/single-definition.test.ts`
Expected: PASS. `verb-gate.test.ts` sees two `CCD_ARGV.wsRename(` sites inside `sweepNames`, both gated because `verbSupported(` is in the same function, and `ws-rename` is absent from `UNGATED_BY_DECISION` — which is correct.

- [ ] **Step 8: Run the whole server suite**

Run: `cd server && npx vitest run` (foreground, `timeout: 600000`)
Expected: PASS. Record the real count.

- [ ] **Step 9: Commit**

```bash
git add server/src/watch.ts server/test/name-sweep.test.ts
git commit -m "feat(server): a 10s lane names the branch from the title

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

### Task 7: the name types itself in, and the label has one definition again

**Files:**
- Create: `pwa/src/fleet/TypedLabel.tsx`
- Modify: `pwa/src/fleet/SessionLine.tsx` (`:26` import block, `:204` the label span)
- Modify: `pwa/src/session/SessionHeader.tsx` (`:19` import block, `:221` the crumb span)
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx:203` (the duplicated chain → an import)
- Modify: `server/test/single-definition.test.ts` (the sessionLabel guard)
- Create: `pwa/test/typed-label.test.tsx`
- Modify: `pwa/test/archive-screen.test.tsx`, `pwa/test/pr-sheet.test.tsx`, `pwa/test/reap-sheet.test.tsx`, `pwa/test/session-actions-sheet.test.tsx` (one case each)

**Interfaces:**
- Consumes: `useReducedMotion` from `framer-motion` (already a dependency, `pwa/package.json:15`; the idiom is `pwa/src/session/ToolCard.tsx:121,210`, `const reduced = useReducedMotion() ?? false;`). `sessionLabel(session)` (`pwa/src/fleet/sessionLabel.ts:14`) is unchanged and is the single definition of the label chain.
- Produces: `TYPE_MS = 28`; `TypedLabel({ text, className }: { text: string; className?: string }): ReactNode`.

**The settled label must stay ONE text node.** `pwa/test/header.test.tsx:502` reads the crumb through `screen.getAllByText('ws/quiet-basin')` and asserts length 1, and Testing Library's `getNodeText` concatenates *direct text-node children only* — a per-character split into sibling spans would break it. So the component renders `{shown}` as a single child plus an `aria-hidden` caret element carrying its own glyph, and the caret is absent once the text has settled. `pwa/test/session-line.test.tsx:150,196` does `screen.getByText('quiet-mesa').closest('button')`, which also survives: the wrapper span stays inside `.sess-open`.

**The caret is a glyph, not a stylesheet rule.** `pwa/test/contrast.test.ts:1298-1311` discovers every `@keyframes` opacity trough in the PWA's CSS and requires each to be registered in a hand-maintained `KEYFRAME_TROUGHS` map with a justification over 20 characters; a blinking caret would owe that map an entry for a mark on screen for at most `text.length × TYPE_MS` ms. A `▏` inside an `aria-hidden` span needs no rule, no colour pair and no keyframe. **Add no CSS for `.typed-caret`.**

**Why `SessionActionsSheet` is in this task and not its own:** it holds a verbatim second copy of the label chain (`:203`, `session.name ?? session.branch ?? session.workspace ?? session.id`), which is precisely the drift `sessionLabel.ts`'s own docstring exists to prevent and which the sheet's title would otherwise diverge on the first time the chain changes. Measured: exactly two files in the tree contain that expression.

- [ ] **Step 1: Write the failing tests**

Create `pwa/test/typed-label.test.tsx`. **Copy the `s()` fixture from `pwa/test/session-line.test.tsx:15-23` rather than the one below if the two differ — `FleetSession` grows, and that file is the one kept current:**

```tsx
// The name was written by a model; it arrives the way a model writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';
import { TYPE_MS, TypedLabel } from '../src/fleet/TypedLabel';

// framer-motion's useReducedMotion caches its matchMedia answer in module state
// on first use, so a `vi.stubGlobal('matchMedia', …)` after the fact is not
// reliably observed — and setup.ts:7's shim already answers `matches: false` to
// every query, which pins only one of the two branches. Mocking the single
// export this component uses makes both deterministic; the same move
// test/chat.test.tsx:16 makes for react-virtuoso. Vitest hoists `vi.hoisted`
// and `vi.mock` above the imports, which is why the holder is reachable here.
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
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, ...over,
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
    // Not decoration: header.test.tsx:502 reads the crumb through
    // getAllByText and asserts length 1, and getNodeText concatenates direct
    // TEXT-node children only. A per-character split into sibling spans would
    // make that query find nothing.
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
    // a human chose (fleet.ts:128 drops Claude Code's derived handles). A rename
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

And append the second one-definition guard to `server/test/single-definition.test.ts`:

```ts
describe('one sessionLabel', () => {
  // `pwa/src/fleet/sessionLabel.ts`'s whole docstring is "what to call a
  // session, everywhere" — and by the time smart branch naming landed there
  // were two: the sheet's title (`SessionActionsSheet.tsx:203`) had grown a
  // verbatim copy of the chain. Same class as UNCHECKED_PR above, same fix, and
  // this is the mechanism rather than another comment asking nicely.
  const CHAIN = /session\.name \?\? session\.branch/;

  it('is defined in exactly one file, and that file is sessionLabel.ts', () => {
    const holders = ALL.filter((f) => CHAIN.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['pwa/src/fleet/sessionLabel.ts']);
  });

  it('is what the former copy site now uses', () => {
    const src = readFileSync(path.join(ccrcRoot, 'pwa/src/fleet/SessionActionsSheet.tsx'), 'utf8');
    expect(src).toContain('sessionLabel');
    expect(src).toMatch(/import \{ sessionLabel \} from '\.\/sessionLabel'/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd pwa && npx vitest run test/typed-label.test.tsx` → FAIL, `Failed to resolve import "../src/fleet/TypedLabel"`.
Run: `cd server && npx vitest run test/single-definition.test.ts` → FAIL, `holders` has two entries.

- [ ] **Step 3: Write the component**

Create `pwa/src/fleet/TypedLabel.tsx`:

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
 * header's crumb is already read that way (`header.test.tsx:502`), so a
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

In `pwa/src/fleet/SessionLine.tsx`, add after the `sessionLabel` import (`:26`):

```tsx
import { TypedLabel } from './TypedLabel';
```

and replace `:204`:

```tsx
          <TypedLabel className="sess-label" text={label} />
```

The `view-transition-name` stamp is on `<button className="sess-open">` (`:197-203`), not on this span, so the shared-element morph is unaffected — and `fleet-css.test.ts`'s `.sess-open` / `.sess-body` assertions are untouched because no class moves.

In `pwa/src/session/SessionHeader.tsx`, add after the `sessionLabel` import (`:19`):

```tsx
import { TypedLabel } from '../fleet/TypedLabel';
```

and replace `:221`:

```tsx
              <TypedLabel className="chat-crumb" text={crumb} />
```

`branchDuplicatesCrumb` (`:206`) still compares the *strings* `branch === crumb`, both from `sessionLabel`/`session.branch`, so the branch chip's suppression is untouched.

- [ ] **Step 5: Delete the second label definition**

In `pwa/src/fleet/SessionActionsSheet.tsx`, add to the import block:

```tsx
import { sessionLabel } from './sessionLabel';
```

and replace `:203`:

```tsx
  const label = sessionLabel(session);
```

- [ ] **Step 6: Pin the three slug displays and the sheet title**

The born slug names a real and unchanged thing — the directory on disk — and a delete confirmation in particular must name what it will actually remove. One case each, all with a branch that has already been renamed. Match each file's existing fixture helpers (`s()` / `sess()` / `open()`); the shapes below are the assertions, not the plumbing.

`pwa/test/archive-screen.test.tsx` (inside the describe that holds the *names the row by workspace slug* case; the row renders `s.workspace ?? s.id` at `ArchiveScreen.tsx:103`):

```tsx
    it('keeps the born slug after the branch has been renamed', () => {
      render(<ArchiveScreen sessions={[s({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' })]}
                            onOpen={() => {}} />);
      expect(screen.getByText('quiet-basin')).toBeInTheDocument();
      expect(screen.queryByText('ws/fix-the-pr-sheet')).not.toBeInTheDocument();
    });
```

`pwa/test/pr-sheet.test.tsx` (the sheet title is `session.workspace ?? session.project`, `PrSheet.tsx:92`):

```tsx
describe('the sheet names the directory, not the branch', () => {
  it('keeps the born slug after the branch has been renamed', async () => {
    open(sess({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' }));
    expect(await screen.findByText('quiet-basin')).toBeInTheDocument();
  });
});
```

`pwa/test/reap-sheet.test.tsx` (the slug is `session.workspace ?? session.id`, `ReapSheet.tsx:190`):

```tsx
describe('the confirmation names what it will actually remove', () => {
  it('keeps the born slug after the branch has been renamed', async () => {
    render(<><ToastHost /><ReapSheet session={sess({ workspace: 'quiet-basin', branch: 'ws/fix-the-pr-sheet' })}
                                     open onClose={() => {}} onReaped={() => {}} /></>);
    expect(await screen.findAllByText(/quiet-basin/)).not.toHaveLength(0);
  });
});
```

`pwa/test/session-actions-sheet.test.tsx` (the sheet title, which now goes through `sessionLabel` — the assertion that the dedup did not change behaviour). Put it inside the describe that already holds `f()` and `sheetProps` (`:193`), or use the file's top-level `s()` (`:9`) and spell the props out if it lands elsewhere:

```tsx
  it('titles the sheet with the label chain, branch outranking the slug', () => {
    render(<SessionActionsSheet session={f({ name: null, branch: 'ws/fix-the-pr-sheet', workspace: 'quiet-basin' })}
                                {...sheetProps} />);
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run the PWA suite and the server guard**

Run: `cd pwa && npx vitest run && npx tsc --noEmit` (foreground)
Expected: PASS. Watch `header.test.tsx` and `session-line.test.tsx` in particular: they are the files whose existing `getByText`/`getAllByText`/`closest('button')` queries now run against a wrapped label, and they are the reason Step 3's settled value is one text node.

Run: `cd server && npx vitest run test/single-definition.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/fleet/TypedLabel.tsx pwa/src/fleet/SessionLine.tsx pwa/src/fleet/SessionActionsSheet.tsx pwa/src/session/SessionHeader.tsx pwa/test server/test/single-definition.test.ts
git commit -m "feat(pwa): the new name types itself in, and the label has one definition again

First mount never animates — only a change from a previously rendered value —
so this marks the one event it exists for rather than replaying every name on
every navigation. The settled label stays ONE text node: getNodeText
concatenates direct text-node children only, and the header crumb is already
read through getAllByText. The caret is a glyph rather than a CSS blink because
a blinking one would owe contrast.test.ts's KEYFRAME_TROUGHS an entry for a mark
on screen for half a second.

SessionActionsSheet held a verbatim second copy of the label chain; it imports
sessionLabel now, and single-definition.test.ts is what keeps it that way."
```

---

### Task 8: the operator-facing record

**Files:**
- Modify: `README.md` — one paragraph under *How a session's state is known* (before `### The attention bucket`, `:81`), and one sentence in the deploy-ordering paragraph (`:200-205`)

**Interfaces:** none. Prose, pinned by nothing — which is why it is short and factual rather than a second copy of the spec.

- [ ] **Step 1: Write it**

Add a subsection after the pane-scraper paragraph (`README.md:78-80`) and before `### The attention bucket`:

```markdown
### The branch takes the name the model already wrote

A workspace is born `ws/soft-prairie` — two words from a random table, fixing
the session id, the directory, the tmux session, the unit, the registry key and
the branch. The name says nothing about the work. Claude Code, meanwhile, has
already written one: every transcript carries an `ai-title` line generated from
the first prompt, and until now nothing read it.

`FleetWatcher`'s naming lane (10 s) renames the branch to that title, slugified:
lowercase, non-alphanumeric runs collapsed to `-`, at most 40 characters cut
back to a word boundary, prefixed `ws/`. It fires only while the branch is still
exactly its born name — that comparison *is* the idempotence marker, so there is
no new registry field and nothing to clean up on reap — and it reads the
transcript behind a size+mtime gate, so a transcript with no title (nine of 609
on this box) is not re-read forever.

**A branch that has been pushed is never renamed.** `ccd ws-rename` refuses with
`has-upstream` — checked two ways, a configured tracking upstream OR the old
name showing up on origin directly, so a branch pushed by hand with no `-u`
(no upstream is configured, but the name is on the remote) is caught the same
as one pushed through `ccd pr-open`'s `--set-upstream` — which is what makes
running this unattended safe. `ccd ws-rename` also refuses `registry-branch-drift`
when git's own record for the worktree disagrees with the registry's `branch`
field — the same corroboration `ws-reap` already requires — so a workspace
hand-renamed with a bare `git branch -m` (bypassing this verb, and so never
updating the registry) cannot have some *other* branch renamed out from under
it by a sweep that still believes the registry's stale name. It refuses in
JSON on stdout at exit 0 — fourteen named tokens, whose copy lives in
`server/src/wsaudit.ts` — and the one REFUSAL path that keeps a non-zero exit
is `git branch -m` itself failing, a fault rather than a refusal (the only
other non-zero path is the python3-availability probe at the top of the
function, also a fault, not a refusal). A refused workspace keeps its born
name. Five of the fourteen refusals describe a fact about the workspace that a
later title cannot change — `has-upstream`, `not-a-workspace`,
`worktree-unregistered`, `worktree-foreign` and `registry-branch-drift`
(`server/src/watch.ts`'s `PERMANENT_REFUSALS`; the last three ship their own
remedy in the refusal detail — the first two a `git -C $main worktree add …`,
the last a re-run of `ccd ws-rename` once the registry and git agree again —
so "cannot stop being true" holds only in the sense that no title fixes it) —
and those retire the session outright: no further attempt, on any title, until
the server restarts. `bad-branch` is a verdict on the *derived branch*, not the
workspace, so it is deliberately not in that set — a title that changes can
change it — even though `deriveBranch` never actually emits a name `ccd` would
reject, so the refusal does not fire in practice. Every other refusal marks
only that one `(session, derived name)` pair attempted, so a title that
changes to a different slug still earns a fresh attempt on the next sweep.

The name types itself into the fleet line and the session header when it lands
(`pwa/src/fleet/TypedLabel.tsx`); `prefers-reduced-motion` swaps it instantly.
The workspace slug itself never changes — the archive list, the PR sheet and the
cleanup confirmation all still name the directory on disk.
```

**Post-build sync (Build 3 PR H whole-branch review):** the block above is
re-synced to the shipped `README.md` a second time — `registry-branch-drift`
(a new refusal, and a fifth `PERMANENT_REFUSALS` token, for a reason unrelated
to D-5) and the `has-upstream`/`git branch -m`-fault wording corrections both
landed after commit 7019ee0's sync and are folded in here now rather than left
to drift again.

Then extend the deploy-ordering paragraph (`README.md:200-205`) with one sentence:

```markdown
`ccd ws-rename` is the same rule with a sharper edge: the naming lane calls it
unattended, and `ccd caps` has advertised the verb since long before it took
flags — so a server deployed ahead of its ccd sees the verb gate pass and the
call fail. One attempt per workspace, absorbed by the lane's retry guard, and
zero if the agent ships first.
```

- [ ] **Step 2: Check the README's own guard still passes**

Run: `cd server && npx vitest run test/readme-holds.test.ts`
Expected: PASS. That test slices the README from `### Workspace holds & programs` to the next `## ` heading; the new `###` subsection goes **before** it (under *How a session's state is known*), so the slice is unchanged. If the new section is placed after the holds section instead, that test's slice swallows it — put it where this step says.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the naming lane, and why ws-rename ships with the agent first"
```

---

### Task 9: gates, mutants and the live proof

- [ ] **Step 1: Full suites, all three packages, foreground**

Run: `cd agent && npx vitest run && cd ../server && npx vitest run && cd ../pwa && npx vitest run` (`timeout: 600000`)
Expected: PASS. **Record the real printed counts**, package by package, against the pre-branch baseline.

Adaptation note (post-build): on the fleet host, the `server` suite exercises `ccd`'s own disk-floor check (`ccd/ccd:1005`, `CCD_DISK_FLOOR_GB`, default 10) through the fixture-HOME harness, so it needs at least that much free in `/tmp` (or wherever fixture homes land) or it goes red with `only <N>G free … floor is 10G` — not a code defect. `CCD_DISK_FLOOR_GB` is the one environment override `ccd` honours for exactly this; set it lower (e.g. `CCD_DISK_FLOOR_GB=1`) as a sanctioned override when the box is genuinely short on space, rather than reading it as a suite failure.

- [ ] **Step 2: Typecheck the shipped builds**

Run: `cd server && npx tsc --noEmit && cd ../agent && npx tsc --noEmit && cd ../pwa && npx tsc --noEmit`
Expected: clean. `server/test/typecheck-tests.test.ts` already covers `server/test/` from inside the suite; this is the shipped half.

- [ ] **Step 3: ccd is a shell script — lint it too**

Run: `bash -n ccd/ccd && shellcheck -S error ccd/ccd || true`
Expected: `bash -n` clean; no *new* shellcheck error attributable to this diff.

- [ ] **Step 4: Mutation sweep**

One literal mutant per added construct, full suite per mutant, sha256-verified restore between. The ones a green suite is likeliest to swallow:

| mutant | must fail |
|---|---|
| `SLUG_MAX` 40 → 41 | `naming.test.ts` boundary cases |
| `deriveBranch`: `slug[SLUG_MAX] === '-'` → `!== '-'` | `does not drop back when the cut already lands on a boundary` |
| `deriveBranch`: `at === -1 ? cut : cut.slice(0, at)` → always `cut` | `drops back to the last dash` |
| `deriveBranch`: drop the `^-+\|-+$` strip | `lowercases, collapses…` |
| `TITLE_TAIL_BYTES` 256 KB → 64 KB | `reads a 256 KB tail` |
| `readAiTitle`: delete `if (from > 0) lines.shift()` | `never returns half a line` |
| `readAiTitle`: keep the FIRST title instead of the last | `takes the LAST one` |
| `NAME_SWEEP_MS` 10_000 → 1 | `sweeps once every ten seconds` |
| `claimTitleRead`: drop `p.size === st.size` (and independently `p.mtimeMs === st.mtimeMs`) | `does not re-read an unchanged transcript` |
| move the `verbSupported` check BELOW `claimTitleRead` | `records NO attempt when the fleet's ccd lacks the verb` |
| `r.branch !== born` → compare against the assembled fleet branch | `reads the registry branch, not the assembled one` |
| delete `attemptedRenames.add(key)` | `a title that changes before the rename lands earns one fresh attempt` |
| the key `` `${r.id}:${branch}` `` → `r.id` | `a title that changes before the rename lands earns one fresh attempt` |
| `deps.queue` → a fresh `new KeyedQueue()` inside `sweepNames` | `joins the per-session queue` **and** `single-definition.test.ts` |
| ccd: any refusal token renamed | `wsaudit.test.ts` set equality |
| ccd: any refusal's `return 0` → `die` | that token's case in `ccd-ws-rename.test.ts` |
| ccd: `[[ $# -ne 4 …]]` → `-lt 4` | `refuses anything but the exact four-token argv` |
| ccd: drop the `has-upstream` guard | `refuses once the branch has an upstream` + the sibling-fixture case |
| whitelist: `['ws-rename','--session']` → `['ws-rename']` | `ws-rename is grantable ONLY with --session` + the agent's boot audit |
| `TYPE_MS` 28 → 0 | `streams a CHANGED value in` |
| `TypedLabel`: delete `if (text === prev.current) return` | `is silent on first mount` |
| `SessionActionsSheet`: re-inline the chain | `single-definition.test.ts` |

Post-build sync: the `attemptedRenames.add(key)` row originally named `does not re-fire after a refusal` — the `has-upstream` fixture — as the killing test. Once `PERMANENT_REFUSALS` retired the whole session on that refusal (review finding 1), `nameSweepRetired` alone was enough to keep that fixture green with the `.add(key)` deleted, so the row no longer named a discriminating test. `a title that changes before the rename lands earns one fresh attempt` uses `name-taken-local`, which is not in `PERMANENT_REFUSALS`, so `attemptedRenames` is genuinely what the third call is gated on there — the test Task 9 actually verified this mutant against.

A survivor is a finding, not a pass.

- [ ] **Step 5: Deploy, agent first**

This ships `ccd/`, so the order is not optional:

1. `CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh agent you@198.51.100.7`
2. `CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh`

The deploy script installs `ccd` before restarting the agent (`README.md:198`), which is what makes the caps list fresh.

- [ ] **Step 6: Verify the real thing**

The definition of done is behavioural and must be demonstrated, not inferred.

1. On the fleet host, with the new `ccd` installed: confirm `ccd caps` lists `ws-rename`, and confirm `ccd ws-rename` with no argv now answers `{"refused":"bad-args",…}` on stdout at exit 0 rather than bash's usage line at exit 1 — that is the shape upgrade, observed rather than assumed.
2. Confirm `GET /api/fleet` stops reporting `ws-rename` unsupported within 60 s **without restarting the agent** — the caps lane doing the job this feature depends on.
3. Create a workspace with `+`, give it one prompt, and watch the fleet line: within one `NAME_SWEEP_MS` of Claude Code writing the `ai-title`, the branch becomes the slugified title and the new name types itself in.
4. **The negative that matters most:** `git push -u origin ws/<slug>` on a fresh workspace, then give it a prompt. The branch must keep its born name **permanently**, `has-upstream` must appear once in the server log, and nothing must surface in the PWA.
5. The retry budget: confirm the refused workspace is not retried on the following sweeps, and that restarting `ccrc-server` buys it exactly one more attempt.
6. **No destructive verbs and no touching live sessions** during any of the above.

---

## Spec Coverage

| spec section | task |
|---|---|
| The rule — `NAME_SWEEP_MS`, four conditions, condition 2 reads the registry | 6 |
| Idempotence needs no new state | 6 (condition 2 is the marker; no registry field anywhere in this diff) |
| Deriving the name — 40 excludes `ws/`, drop back never forward, hard-cut, empty/unchanged | 5 |
| The worked example `Brainstorm Helix and slide notes integration` → `ws/brainstorm-helix-and-slide-notes` | 5 (Step 1), 6 (Step 1, end to end) |
| The server does not re-implement `_ws_branch_valid` | 5 (the function's own docstring), 1 (`bad-branch` is the verdict) |
| Reading the title without re-reading the world — 256 KB tail, stat gate copied from `claimAskRead` | 5, 6 (Step 6, `claimTitleRead`) |
| Inherited `<id>.uuid` limitation, stated not fixed | 6 (Step 6 docstring) |
| The retry-storm guard — `<id>:<derived-branch>`, not durable | 6 (Steps 4 and 6) |
| A title that changes before the rename lands earns one fresh attempt (synthetic — real data cannot exercise it) | 6 (Step 1) |
| Ordering against the rest of the fleet — the queue join, and the hoist | 4, 6 |
| ccd: the new argv, exact arity, id validation | 1 |
| ccd: thirteen refusal tokens, JSON at exit 0, `git branch -m` keeps non-zero | 1 |
| ccd: no busy guard | 1 (no status call is added anywhere) |
| ccd: `git ls-remote` unreachable stays a warning | 1 (the `*)` arm) |
| Refusal tokens reach `wsaudit.ts` — nine sentences, set equality both ways | 2 (and **D-1**, which is what makes them harvestable at all) |
| The server gains one argv entry, one grant and one timeout | 3 |
| The watcher call site carries `verbSupported` | 6 (Step 7 runs `verb-gate.test.ts`) |
| `verbSupported` asked BEFORE the transcript is claimed | 6 (Step 6, and the mutant in 9) |
| The name types itself in — `TypedLabel`, both mounts, reduced motion, exported delay | 7 |
| The three slug displays are untouched | 7 (Step 6) |
| A human-chosen name still outranks the branch | 7 (Step 1, `does not animate on a rename`) |
| Error-handling table, every row | 1 (tokens), 6 (Steps 1 and 6), 7 (human-chosen name) |
| Rider D delta 7 — no interaction with holds/prhistory, asserted | 1 (Step 1, ccd side), 6 (Step 1, server side) |
| Rider D delta 6 — `sessionLabel` duplication folded in | 7 (Steps 5-6, guarded structurally) |
| Rider D delta 5 — the caps hazard stated, not engineered around | **D-4**, 6 (`sweepNames` docstring), 8 (README) |
| Out of scope — no route, no client method, no wire change, no `ws-add` slug | nothing in this plan touches `shared/api.ts`, `pwa/src/lib/api.ts` or `CCD_ARGV.wsAdd` |
| Definition of done | 9 (Step 6) |

---

## Self-review — what was checked, and how

- **Every path in the File Structure table was `ls`/`grep`-verified to exist** (or is marked Create:). No `infra/` path appears as a target anywhere in this plan (the only two mentions are this line and the "supersedes" note); the superseded plan's 24 `infra/ccrc/*` and `infra/ccrc-portability/ccd` paths were each re-derived to `ccd/`, `server/`, `agent/`, `pwa/`.
- **Every ccd anchor re-derived** against `ccd/ccd` **on `origin/main`, the tree this plan actually targets** (corrected, Build 3 PR H whole-branch review: the values below previously came from the scout's `7f2c250` base rather than from `origin/main`, and were wrong throughout — see finding 6/10 of that review): `_ws_branch_valid` **1337-1346**; `cmd_ws_rename` **1348-1439**; the twelve refusal `die`s, in evaluation order (`no-such-session`/`not-a-workspace`/`incomplete-registry`/`worktree-missing`/`bad-branch`/`worktree-unregistered`/`detached`/`worktree-foreign`/`unchanged`/`has-upstream`/`name-taken-local`/`name-taken-origin`) → **1351/1356/1357/1364/1365/1387/1390/1405/1406/1415/1419/1425**; the `git branch -m` fault → **1436**; dispatch **6935**; usage **6947**; `cmd_caps`'s entry → **1480**; `_json_str` → **222**; `_reg_get`/`_reg_set` → **108-109**; the flag idiom `cmd_ws_hold` at **1487-1533**. (The reap-envelope-example and `_json_str probe`-siblings sub-claim from the previous version of this bullet is **dropped** rather than re-verified: it points at illustrative precedent inside `cmd_ws_reap`/`cmd_ws_audit`, not at anything Task 1 depends on, and is not worth re-deriving against a tree neither of those functions changed on. Trust the shipped source comments — `ccd/ccd:1371-1372` — for the current, HEAD-verified version of that same pointer.)
- **Every server/PWA anchor re-derived:** `server.ts` sendDeps 234 → **321** (`origin/main`); `Deps` → **69-96**; `index.ts` watcher 39 → **61** (buildServer **63**); `watch.ts` `TASK_SWEEP_MS` 21 → **24**, `CAPS_REFRESH_MS` **30**, `PR_SWEEP_MS` **35**, `tick()` 79 → **194**, `sweepTasks` **319-334** (all four also re-verified directly against `origin/main`, the plan's own baseline — they drift further on later trees as unrelated lanes land, which is expected and not a re-verification failure); `fleet.ts` name-drop 82 → **128**, branch precedence 100 → **155**; `sessionws.ts` claimAskRead 135-161 → **178-187**; `ask.ts` `readPendingAsk` **54**, `TAIL_BYTES` **9**, the `ai-title` skip comment **11-16**; `wsaudit.test.ts` linkage 52-101 → **52-101** (harvest regexes at **56-60**); `whitelist.ts` `REQUIRED_VERB_FLAG` **218** (unmoved), `EXEC_WHITELIST.ccd` **282-320**, `isExecAllowed` 541-605 → **552-615**; `runner.ts` `CCD_VERB_TIMEOUT_MS` **27-37** (unmoved); `ccdargv.ts` table 56-77 → **56-79**; `sessionLabel.ts` **14-15**; `SessionLine.tsx` label span 107 → **204** (import **26**); `SessionHeader.tsx` crumb 170 → **221** (import **19**, `branchDuplicatesCrumb` **206**); `PrSheet.tsx` **92** (unmoved); `ReapSheet.tsx` 175 → **190**; `ArchiveScreen.tsx` 88 → **103**; `ToolCard.tsx` **121,210** (unmoved); `header.test.tsx` crumb query 392-401 → **502**; `contrast.test.ts` `KEYFRAME_TROUGHS` 1262-1277 → **1298-1311**.
- **A note on reading any anchor in this plan later:** every number above was verified against `origin/main` at the time this plan was written — the tree the plan describes editing — not against whatever `ccd/ccd`/`server/src` look like today. Six commits and two whole-branch review rounds have moved code since; the shipped source's own comments (`ccd/ccd`, `server/src/watch.ts`) carry HEAD-verified anchors where they cite each other, and are the ones to trust for the current tree. This plan is an execution record, not a live index.
- **The nine new refusal tokens were measured, not assumed.** I ran `wsaudit.test.ts`'s four harvesting regexes over `ccd/ccd`: 45 tokens, 45 `SENTENCES` keys, and exactly nine of ws-rename's thirteen absent. That measurement is what produced **Deviation D-1** — the superseded plan's `_ws_rename_refuse` helper would have left all nine unharvested and turned the spec's own requirement into a red suite.
- **The queue join sites were counted, not quoted.** `grep -rn '\.queue\.run(' server/src` → seven, including `inject/ask.ts:39`, which the rider's list omits (**D-3**).
- **The lane ordinal was checked against the code**, not the old plan: hook-state sweeping already calls itself the fifth lane (**D-2**).
- **The `Deps`-literal blast radius was measured** rather than copied: twelve sites in seven files plus `helpers.ts`, all listed in Task 4 Step 4; the superseded plan's list named different files and different lines.
- **The superseded plan's `ccd-workspaces.test.ts:479` caller still exists** at that exact line (inside the `:477` case) — one of the few anchors that did not move.
- **Harness API claims were checked against `ccdWsHelpers.ts`:** `sh`/`reg`/`git`/`makeRepo`/`makeGhRepo`/`calls`/`ghPoison`/`home`/`cleanup`; there is no `wsId`, and `sh` throws on a non-zero exit (which is what makes "read every refusal through `h.sh`" also the exit-code assertion).
- **The PWA fixture shape was checked:** `FleetSession` has gained `held`, `hookState`, `askSummary`, `subagents`, `bucket`, `bucketSince` since the superseded plan was written, so the plan points at `session-line.test.tsx:15-23` as the live fixture rather than freezing a stale literal.
- **The `sessionLabel` duplication was confirmed to be exactly two files** (`sessionLabel.ts:15`, `SessionActionsSheet.tsx:203`), which is what makes the structural guard in Task 7 a two-line assertion rather than an allowlist.
- **`verb-gate.test.ts` was read to confirm the ordering claim**: `wsRename` may land in `CCD_ARGV` (Task 3) before it has a call site, because `ALL_SITES` is discovered by scanning `server/src` and the exemption list is checked only against sites that exist.
- **Not verified, and stated as such:** the "600 transcripts / 45,996 bytes / nine with no title / 91 MB, 1,809 lines" measurements are carried forward from the approved spec. They are load-bearing for `TITLE_TAIL_BYTES` and for the stat gate's justification; they were taken on the fleet host on 2026-08-03 and are not re-measurable from this checkout. If the implementer can re-run them cheaply on openclaw, do — and if the worst case has grown past ~256 KB, that is a finding, not a licence to widen the tail silently.
