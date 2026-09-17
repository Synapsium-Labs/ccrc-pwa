# Graphify compaction card — Plan A: the agent lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every compaction — the main thread's or a subagent's — the session is re-injected with a computed card of the files it was working in (symbols, community, dependents, from graphify's graph), and the summary is measured for whether it changed; the measurements start filling a per-session journal on the fleet box with no console change.

**Architecture:** `ccd/session-hook.sh` gains behavior in its three existing compaction arms. One permanent
per-row `.compactions.lock` inode is initialized by a private `mktemp` source and POSIX `link`, but is never
opened at its canonical pathname: each holder opens a verified private hard-link alias and verifies its FD against
the current canonical inode before/after flock and before mutation. Compact SessionStart locks, validates
generation under that lock, then observes/matches/claims/emits/marks in that order. PostCompact settles by link, canonical unlink,
then claim touch; it reads only a retained claim FD and reacquires the stable lock for its complete journal
transaction and any cleanup. Generation is an exact no-LF UUID authorization, private residue blocks reuse, and
permanent lock does not. `_reg_purge` gains an honest lock-guarded result, and Task 9 BUILDS the status branch in all four callers (measured on the pre-Task-9 tree `8e457995`, none read it; Task 9 built the branch in all four, and at this tip each reads the status into its own variable).
The journal is Plan A's sole measurement sink: no hookstate `compaction`, no persisted `n`; readers derive ordinal
from physical line position. The helper is plain node (`node:*` only, the `shared/mark.mjs` class) installed beside
the hook by `deploy.sh`'s agent lane and `ccrc install`. No new hook events; PreCompact and PostCompact print
nothing in Plan A (steering is Plan C).

**Tech Stack:** bash 4.4+ (the hook), node 22+ ESM (`.mjs`, no npm deps), jq, vitest 4 (`server/test`), TypeScript declaration sibling (`.d.mts`).

**Spec:** `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` — §0.2 (measured facts), §2 (architecture, constants), §3.0–§3.4 (this plan's mechanisms), §4 (failure modes), §5 (Hook, Helper, Installer mutation tables), §6 (rings/invariants), §7 item 1 (this plan). §3.5 (steering) and §3.6 (wire/chip) are Plans C and B and are NOT built here.

## Global Constraints

Every task's requirements implicitly include this section.

- **Work in a git worktree of `ws/graphify-compaction-card`** (superpowers:using-git-worktrees). Every path below is relative to that worktree's repo root. Run every vitest command from inside `server/`: `cd server && ./node_modules/.bin/vitest run test/<file>` — **never bare `npx vitest`** (it resolves a global copy and reports "no tests"). Run suites in the FOREGROUND with a tool timeout ≥ 600000 ms. Known load flakes to re-run in isolation before calling a break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **Fixture HOMEs only.** Never run the hook, `ccd`, `ccrc` or `deploy.sh` against the real `$HOME`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, `~/.ccrc` or any `claude-session@*` unit. Never run `graphify update` or any graph build — the ccrc sweep owns the write side; the helper READS `graphify-out/` and nothing else.
- **The hook's standing contract** (`ccd/session-hook.sh` header, `:4-8`, and its second lock-free assertion at `:70-72` — both must be amended the same way, in Task 9, not just the first): exit 0 on every path, write atomically or not at all, no network. Spec §6 R2 now declares the only waits: the eight-second helper deadline, `COMPACT_LOCK_WAIT_SERVE` (2 s, compact SessionStart's one acquisition alone), and `COMPACT_LOCK_WAIT` (5 s, every other acquisition — argued from ≥ 8× measured p95, not a round number; round 7 retires the separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT`). Of the hook's arms, only PreCompact, SessionStart(compact) and PostCompact take the permanent `$REG/.<id>.compactions.lock`; ordinary hook hot paths stay lock-free. On ccd's side, row creation, `_spawn_start` and `_reg_purge` take the same mutex too (spec §2, §6) — six acquisitions in all, which is what the next bullet's `COMPACT_LOCK_WAIT` enumerates. Stable publication uses a private `mktemp` regular source plus POSIX `link`, never shared-path noclobber redirection; then it opens read/write, verifies descriptor regularity plus current non-symlink pathname and descriptor/path inode identity before **and after** `flock -w "$1"` (the wait is the acquire helper's first positional parameter, never a constant spelled inside it), before critical mutation. FIFO/directory/symlink/replacement refusal is prompt; only genuine contention consumes the passed wait. The guarantee is among ccrc hook processes; hostile same-UID pathname changes after a final portable-Bash check are outside the threat boundary. **Read that boundary as the ACQUIRE'S OWN zero-width race, and no wider (r3 R1).** For one round it was read as covering the whole held section, and the measurement says otherwise: with a holder inside its section, a same-UID actor who unlinks canonical and mints a fresh inode at the same pathname off a private `mktemp` source lets a SECOND acquirer take the lock — measured through the shipped acquire on both sides, inode 1591479 -> 1591427, S rc 0 while H was still alive, against a control (replacement suppressed) of S rc 1. That window is minutes wide, not zero-width, and D-2793 cannot see it because it refuses a DISAPPEARANCE while the acquire's `[ -e "$lock" ]` arm is satisfied by a REPLACEMENT. So §3.4 item 3's "immediately before each mutation" clause is BUILT rather than argued away: `_hook_lock_still_canonical` re-asks `_hook_lock_same` — one identity predicate, called at a second moment — before every canonical mutation in every one of the HOOK's five held sections (eight sites). What stays outside the boundary is only what it always was: the gap between the last check and the syscall after it. **The ccd twin was built and then REFUSED on the measurement, and the residual is stated rather than closed:** `_reg_purge` has no placement where the check both helps and stays truthful — before its unconditional `_lc_done purge` emit it is adjacent to the acquire's own post-`flock` check and closes a zero-width window, while before the unlink loop, where the window is real, none of `_reg_purge`'s three statuses is true (1 and 2 assert no purge fact, 3 asserts the row IS destroyed), so a refusal there would fabricate a cause — the defect D-2782 was minted to end. Measured, the before-emit form also reds two deliberate shipped guards: `ccd-lifecycle-purge`'s "the acquisition is the ONE statement before the unconditional emit" and the canonical-write census, which read the guard's own release as an early unlock. Closing the ccd side needs a fourth status and four caller arms. Both waits are after hookstate. **In the three HOOK arms** — and only there — a missing `flock`, an unsafe lock, an absent helper or deadline command, a deadline expiry and lock contention are silent missed measurements; a pre-settlement failure leaves canonical state untouched, and every HOOK call site remains total (exit 0, nothing written). **ccd's three acquisitions are neither silent nor total, each by its own §4 row:** row creation fails CLOSED — it acquires before writing any row field, so a contended miss dies with a retryable message naming the lock and leaves `$REG` untouched; `_spawn_start` fails OPEN — it spawns without `CCRC_SESSION_GENERATION` and warns on stderr naming the lock, because a swap must never wedge on a compaction lock; and `_reg_purge`'s miss is reported by its callers as `_lc_fail`/`_lc_refuse_return`, with `ws-add`/`ws-restore`/`ws-reap` keeping their shipped fail-closed refusals. **Round 7 also removes every canonical pathname from the helper's argv** (option A, staging-only helper: `--set-stage`/`--card-stage`, never `--set`/`--out`) — the helper performs no slot check, rollback, or canonical read of any kind; every ownership decision and canonical rename is the hook's alone, under the lock, never across the fork that runs the helper. **Plan A prints nothing new**: SessionStart remains the only context event and retains D-306's early compact exit; PreToolUse is the only decision event; PreCompact and PostCompact stay in the stdout/stderr-silence loop. Plan C alone amends R1 for steering stdout.
- **Only ccrc-owned artifacts change**: the hook, the helper, `deploy/deploy.sh`, `ccd/ccrc`, tests, README, this plan and the spec's status line. No `CLAUDE.md` anywhere (operator ruling 2026-09-02).
- **Constants are defined once, in the hook, with the spec §2 values — with ONE stated exception, `COMPACT_LOCK_WAIT`, which has two byte-equal literal homes because `ccd/ccd` cannot read the hook's** (round 14, B-I6; the `where` column of §2's row for it is the contract, and says the same): `ccd/ccd` does not source `ccd/session-hook.sh` and the hook sources nothing, so row creation, `_spawn_start` and `_reg_purge` cannot read a value defined in the hook. Each file carries its own literal on the shipped precedent `ccd/ccd:203` records — "`ccd/session-hook.sh`'s `_hook_epoch_ms` is a deliberate local copy of this body (the hook sources nothing); a test pins the two identical", with the hook's reciprocal note at `ccd/session-hook.sh:38` ("This is a LOCAL copy of ccd's `_plat_epoch_ms`") — each comment names the other file as its twin, and Task 9 adds a `single-definition`-style rule over the bash corpus asserting the two `COMPACT_LOCK_WAIT=` spellings are byte-equal and that `COMPACT_LOCK_WAIT_SERVE=` appears in the hook alone. That rule is buildable where the suite already walks: `server/test/single-definition.test.ts:1274` is `const bashRoots = [path.join(ccrcRoot, 'ccd'), path.join(ccrcRoot, 'deploy')];`, and `:1319-1320` already lists `ccd/ccd` and `ccd/session-hook.sh` by name among the files that scan must have found. The rest of the list below stays hook-only: `COMPACT_CARD_MAX_CHARS=4000`, `CARD_MAX_CHARS=2400` (exists — **never moved, never raised**: it is the only defence for the ungated `GM_NODES`, D-1899), `CARD_TOTAL_MAX_CHARS` DERIVED as `$(( CARD_MAX_CHARS + 1 + COMPACT_CARD_MAX_CHARS ))`, `COMPACT_CARD_MAX_AGE=1200` (also the PostCompact claim/marker/temp age), `COMPACT_LIVE_S=120`, `COMPACT_HELPER_TIMEOUT=8`, `COMPACT_LOCK_WAIT_SERVE=2` (compact SessionStart's one acquisition alone), `COMPACT_LOCK_WAIT=5` (every other acquisition — PreCompact's two, PostCompact's settlement and final-transaction reacquire, row creation, `_spawn_start`, `_reg_purge` — argued from ≥ 8× measured p95 per Task 9's own measurement, not a round number; round 7 retires the separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT`), `COMPACT_WORKSET_MAX=12`, `GRAPH_GATE_MAX_BEHIND=10` (exists). In the helper: `WINDOW_CAP` = 16 MiB, `WORKSET_CAP` = 100, `GRAPH_MAX_BYTES` = 96 MiB. `COMPACT_SHAPE_PRED` is spelled once and used by the `jq -ce -s` exact-one-document gate; there is no hookstate read-back use.
- **Registry fields versus lifecycle files.** The spec §3.4 table is Task 9's authoritative target inventory. `.compactcard`, `.compactset`, `.compactions`, and `.generation` are canonical row artifacts; every private source, alias, claim, marker and snapshot uses only its target grammar after exact literal-ID prefix stripping. Before an ordinary sweep relies on it, Task 9 migrates every current hook/helper set/card temporary producer to that table and **deletes every rollback producer outright** (helper and hook alike — there is no target grammar for a rollback name under round 7's option A, because nothing is left to roll back); its explicitly enumerated legacy transition grammars are lock-held, age-gated, exact-only, and never a broad glob. The helper's two NEW writers are hook-named stage files (`compactset.<pid>.<nonce>.stage` / `compactcard.<pid>.<nonce>.stage`), each written through its own `<stage>.part` temp plus rename, so a stage exists iff it is complete; only the hook ever renames a stage into canonical. The permanent lock is intentionally not slug residue; every other generation/private family is. `XXXXXX` occurs only in a `mktemp` template and `<mktemp6>` names its resulting six-character basename. Locked age cleanup and purge are exact-ID only; a dotted/shared-prefix neighbor must survive byte-for-byte.
- **The `case "$event" in … esac` block is parsed by `server/test/install-session-hooks.test.ts`** (`^\s{2}([A-Za-z|]+)\)` on each line). Arm labels stay at two-space indent; never add a two-space-indented `Word)` line inside that block; add no event. New work hangs off the existing arms and off two call sites placed OUTSIDE the block (Tasks 2 and 9 say where).
- **TDD, red first, with a measured mutation per guard.** Each test is written and shown failing before the code; each guard task ends with a mutation step — apply the named mutation in an isolated disposable copy, run the named file, and observe the named case red. Do not use `git checkout`, `reset` or `stash` as a restore mechanism. The spec's §5 tables are the checklist; every row this plan owns is named in a task.
- **Deviation numbers are MINTED, never chosen.** This plan's `## Deviations found` section carries numbers allocated through `~/.local/bin/ccrc-api ledger allocate` at plan time. If execution finds a new deviation, allocate before writing it (`printf '{"project":"ccrc-pwa","count":1,"title":"<what>"}' | ~/.local/bin/ccrc-api ledger allocate --json -`); a session that cannot reach the allocator writes `D-TBD-<slug>` and reports it.
- **Commit per task**, message `type(scope): one sentence in the tree's voice`, trailer = **the exact `Co-Authored-By:` line the committing agent's own harness directive gives it** — the trailer names the model that authored the commit, and that changes with the controller's directive, so no fixed model name belongs here. Never copy a trailer out of this plan or out of an older commit. Never `git add -A`; every commit step lists its paths. Never `git stash`.
- **Node floor `>=22.13.0`.** The helper imports `node:*` only and is importable by vitest through its `.d.mts` sibling (`shared/mark.mjs` + `shared/mark.d.mts` is the precedent; `server/test/tsconfig.tests.json` pulls the import in, and `typecheck-tests.test.ts` must stay green).
- **Provenance markers:** `ccd/session-hook.sh` line 2 and `ccd/ccrc` line 2 carry no `# ccrc:generated` marker (measured 2026-09-10: `sed -n 2p`); `ccd/ccd` DOES, and Task 9 edits its purge inventory and re-stamps it with the command `server/test/ownership.test.ts` prescribes — `ownership.test.ts` is red until the re-stamp lands. Check with `sed -n 2p <file>` before assuming that for any other file.
- **No absolute repo paths in this plan or in any tracked file it edits** (lesson recorded 2026-09-09, crossrepo-programmes).

## File structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `ccd/session-hook.sh` | constants block; safe shared compaction-lock open/acquire helper; `_hook_compact_scope`; `_hook_write_atomic`; `_hook_compact_pre` with locked canonical-set + young-claim overlap (§3.1); `_hook_compact_card` exporting the served nonce, marker-after-emit and two-clip emitter (§3.3); `_hook_compact_post` with absent-target settlement and complete locked journal transaction (§3.4); the header's complete R2 sentence | 2, 6, 7, 9 |
| `ccd/ccd` | Task 9 only: row generation initialization; `_spawn_start` primary/retry generation export and FD boundaries (export only — it never mints); locked `_reg_purge` (including the generation gate and the explicit `rm -f "$REG/$id.generation"` after the archived/reaping tail at `:1868`); exact family cleanup; **`_ws_slug_free` AND `_ws_slug_residue`, widened as a pair** (round 9, spec §3.4); **`cmd_ws_add`'s refusal-message template at `:4355-4357`** (round 10, B-3 — widening the residue function without it yields a refusal that names no file); the comment scope at `:1129-1132` and `:1822-1827`; required provenance re-stamp. **(round 11, M5: the last two entries reached Task 9's body in rounds 9 and 10 and never reached this row, which is the plan's own index of the edit surface.)** | 9 |
| `ccd/compact-card.mjs` | the helper: `card` (window, mining, resolution, ranking, rendering, set) and `measure` (normalisation, fields, `cited`); removes future set `served` persistence and corrects journal-only/whole-list comments while retaining isolated legacy measurement tolerance; CLI + exit codes. **Task 9 (round 7, option A) deletes `ownedSlot`, `slotIsMine`, `rollbackClaimPath`, `reserveClaim`, `hasCanonicalOwner`, `firstCardLine`, `firstSetNonce`, `rollbackSet`, `rollbackCard`, and `rollbackPair`** (`ccd/compact-card.mjs:433-560`) and retargets `writeAtomic`/`cardCommand` at two hook-named stage paths (`--set-stage`/`--card-stage`) instead of canonical `--set`/`--out`; the helper performs no slot check, rollback, or canonical read of any kind | 3, 4, 5, 8, 9 |
| `ccd/compact-card.d.mts` | the helper's types for the vitest import; separates future canonical set shape from accepted legacy measurement input if required. **Task 9 deletes the `slotIsMine` (`:42`) and `rollbackHook` (`:50`) type exports** | 3 (extended in 4, 5, 8, 9) |
| `server/test/compactCardFixtures.ts` | shared fixture builders: transcript lines, the five-file graph, `graphJson()` | 1 |
| `server/test/compact-card.test.ts` | the helper's unit tests, including Task 9 set-shape/comment-compatible legacy input coverage | 3, 4, 5, 8, 9 |
| `server/test/session-hook.test.ts` | the hook's tests: `plantSession`, `plantHelper`, `plantGraph({content})`, the four describes | 1, 2, 6, 7, 9 |
| `server/test/ccd-reg-set-atomic.test.ts` | Task 9 only: retarget `:126-127`'s `_ws_slug_residue` assertion from the shipped bare field names to the `<id>.`-prefixed basenames the widened function emits — never to a substring match. **(round 14, B-I3: round 13 added this file to Task 9's prose disposition list and to nowhere else, so Steps 2/4 never ran it and Step 5 never staged it; it is now in both commands and in this table, which is the plan's own index of the edit surface.)** | 9 |
| `deploy/deploy.sh`, `ccd/ccrc`, `server/test/installTreeFixture.ts`, `server/test/ccrc-install.test.ts`, `server/test/compact-card-ship.test.ts` | install the helper beside the hook, backed up like the hook; the fixture tree ships it; pins | 10 |
| `README.md`, the spec's status line | final operator-facing journal/lifecycle wording and audit status only | 11 |

**Task order and why.** 1 (fixtures) → 2 (liveness, overlap, hook-written set) → 3, 4, 5 (helper `card`) → 6 (PreCompact invokes helper) → 7 (SessionStart atomically serves; Task 9 amends its served fact to marker-only) → 8 (helper `measure`) → 9 (PostCompact atomic settlement and sole-authority journal) → 10 (ship, scope unchanged) → 11 (docs updated to journal authority). Task 9 depends on Tasks 2, 7 and 8 and amends their integration contract without changing Task 10.

---

### Task 1: The shared fixtures — transcripts, a real-shaped graph, the helper beside the hook

**Files:**
- Create: `server/test/compactCardFixtures.ts`
- Modify: `server/test/session-hook.test.ts` (module scope, after `gatedTree` and before `const pre =`; and `plantGraph`)

**Interfaces:**
- Produces (fixtures module): `tl.toolUse(name, input)`, `tl.boundary()`, `tl.summary(text)`, `tl.user(text)` — one transcript line each, in the shapes measured on a 2.1.266 transcript; `GRAPH` — five files, ten nodes, eight links, two labelled communities; `graphJson(content, built)` — node-link JSON text with `built_at_commit` LAST.
- Produces (hook test): `plantGraph(dir, { …, content?: GraphContent })` writes real `nodes`/`links` and `.graphify_labels.json` when `content` is given; `plantHelper()` copies `ccd/compact-card.mjs` into the fixture `~/.cc-sessions/`; `plantSession({ sid?, lines, parentAge?, subagents? })` → `{ transcript, agents }` with SET mtimes — `parentAge`/`age` are seconds before now, and `LIVE` (5) / `DEAD` (600) are the two values the liveness rule (120 s) tells apart; `cardTree()` — a fresh-graph tree carrying `GRAPH`; the payload builders `preCompact`, `compactStart`, `postCompact`; `setFile()`, `cardFile()`, `journalFile()`, `readSet()`, `readCard()`.

- [ ] **Step 1: Write the fixtures module**

```ts
// server/test/compactCardFixtures.ts
// The compaction card's fixtures, shared by the hook's tests
// (session-hook.test.ts) and the helper's (compact-card.test.ts) so the two
// suites cannot drift apart on what a transcript line or a graph looks like.
//
// Every shape here was MEASURED, not remembered (2026-09-10, Claude Code
// 2.1.266, this repo's own graphify 0.9.9 graph): an assistant row carries
// `message.content[]` items of `type:"tool_use"` with `name` and `input`; the
// harness's boundary row is `{type:"system", subtype:"compact_boundary"}`;
// the compact summary is a `user` row with `isCompactSummary:true` and a
// STRING `message.content` (1,307 of 1,307 summaries across every lane on the
// fleet box); graph.json is networkx node-link JSON — `nodes[]` with `id`,
// `label`, `source_file`, `source_location` (`L<n>`), `community`, and the
// edges under `links[]` as `{source, target, relation}` — with
// `built_at_commit` as its LAST key.

export const tl = {
  toolUse: (name: string, input: object): string =>
    JSON.stringify({ type: 'assistant', message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name, input }] } }),
  boundary: (): string =>
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted',
      compactMetadata: { trigger: 'manual', preTokens: 100, postTokens: 10 } }),
  summary: (text: string): string =>
    JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: text } }),
  user: (text: string): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
};

export interface GraphNodeFx {
  id: string; label: string; norm_label: string; file_type: string; source_file: string;
  source_location: string; community: number; _origin: string; metadata?: { kind: string };
}
export interface GraphLinkFx {
  source: string; target: string; relation: string; weight: number; confidence: string; confidence_score: number;
}
export interface GraphContent { nodes: GraphNodeFx[]; links: GraphLinkFx[]; labels: Record<string, string> }

export const node = (id: string, label: string, file: string, line: number, community: number,
  kind?: string): GraphNodeFx => ({
  id, label, norm_label: label, file_type: 'code', source_file: file, source_location: `L${line}`,
  community, _origin: 'ast', ...(kind ? { metadata: { kind } } : {}),
});
export const link = (source: string, target: string, relation: string): GraphLinkFx =>
  ({ source, target, relation, weight: 1.0, confidence: 'EXTRACTED', confidence_score: 1.0 });

/** Twelve files. `statusline.ts` is depended on by `watch.ts` (in-set in
 *  most tests) and `fleet.ts` (outside); `models.ts` by `ModelSheet.tsx`.
 *  `big.ts` carries SIX symbols and FOUR outside dependents (`d1`–`d4`), so
 *  the five-symbol cap, the three-dependent cap and the `(+n)` rest all fire;
 *  `shared/api.ts` has no `metadata.kind` and no `L1` node named `api.ts`, so
 *  the file node is the degree fallback. Community 0 is labelled `watch.ts`,
 *  1 `SessionScreen.tsx`, 3 `api.ts`, 4 `big.ts`; community 2 (the hook) has
 *  NO label, which is the "omitted" branch. */
export const GRAPH: GraphContent = {
  nodes: [
    node('f_statusline', 'statusline.ts', 'server/src/pane/statusline.ts', 1, 0, 'file'),
    node('parseStatusline', 'parseStatusline', 'server/src/pane/statusline.ts', 132, 0),
    node('parseCtxPct', 'parseCtxPct', 'server/src/pane/statusline.ts', 105, 0),
    node('f_watch', 'watch.ts', 'server/src/watch.ts', 1, 0, 'file'),
    node('sweepMail', 'sweepMail', 'server/src/watch.ts', 40, 0),
    node('f_fleet', 'fleet.ts', 'server/src/fleet.ts', 1, 0, 'file'),
    node('f_models', 'models.ts', 'pwa/src/lib/models.ts', 1, 1, 'file'),
    node('modelOptions', 'modelOptions', 'pwa/src/lib/models.ts', 29, 1),
    node('f_sheet', 'ModelSheet.tsx', 'pwa/src/session/ModelSheet.tsx', 1, 1, 'file'),
    node('f_hook', 'session-hook.sh', 'ccd/session-hook.sh', 1, 2, 'file'),
    node('FleetSession', 'FleetSession', 'shared/api.ts', 10, 3),
    node('FLEET_PROTO', 'FLEET_PROTO', 'shared/api.ts', 5, 3),
    node('f_big', 'big.ts', 'server/src/big.ts', 1, 4, 'file'),
    node('s1', 's1', 'server/src/big.ts', 10, 4), node('s2', 's2', 'server/src/big.ts', 20, 4),
    node('s3', 's3', 'server/src/big.ts', 30, 4), node('s4', 's4', 'server/src/big.ts', 40, 4),
    node('s5', 's5', 'server/src/big.ts', 50, 4), node('s6', 's6', 'server/src/big.ts', 60, 4),
    node('f_d1', 'd1.ts', 'server/src/d1.ts', 1, 4, 'file'), node('f_d2', 'd2.ts', 'server/src/d2.ts', 1, 4, 'file'),
    node('f_d3', 'd3.ts', 'server/src/d3.ts', 1, 4, 'file'), node('f_d4', 'd4.ts', 'server/src/d4.ts', 1, 4, 'file'),
  ],
  links: [
    link('f_statusline', 'parseStatusline', 'contains'),
    link('f_statusline', 'parseCtxPct', 'contains'),
    link('f_watch', 'sweepMail', 'contains'),
    link('sweepMail', 'parseStatusline', 'calls'),
    link('f_watch', 'f_statusline', 'imports_from'),
    link('f_fleet', 'parseCtxPct', 'calls'),
    link('f_models', 'modelOptions', 'contains'),
    link('f_sheet', 'modelOptions', 'imports_from'),
    link('f_fleet', 'FleetSession', 'imports_from'),
    link('f_sheet', 'FleetSession', 'imports_from'),
    ...['s1', 's2', 's3', 's4', 's5', 's6'].map((x) => link('f_big', x, 'contains')),
    link('f_d1', 's1', 'calls'), link('f_d2', 's1', 'calls'), link('f_d3', 's1', 'calls'), link('f_d4', 's1', 'calls'),
    link('f_d1', 's2', 'calls'), link('f_d2', 's3', 'calls'),
  ],
  labels: { '0': 'watch.ts', '1': 'SessionScreen.tsx', '3': 'api.ts', '4': 'big.ts' },
};

/** graph.json text as graphify writes it — `built_at_commit` LAST. */
export const graphJson = (content: GraphContent, built: string): string =>
  JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes: content.nodes,
    links: content.links, hyperedges: [], built_at_commit: built });
```

- [ ] **Step 2: Extend `plantGraph` and add the hook-side fixtures**

In `server/test/session-hook.test.ts`, add to the imports (after `import { CCD } from './ccdWsHelpers.js';`):

```ts
import { tl, GRAPH, type GraphContent } from './compactCardFixtures.js';
```

Change `plantGraph`'s signature and body so `content` writes real nodes/links and the labels file. The whole function becomes:

```ts
const plantGraph = (dir: string, opts: {
  built?: string; nodes?: number; engine?: string | null; report?: boolean;
  pad?: number; content?: GraphContent;
} = {}): void => {
  const out = path.join(dir, 'graphify-out');
  fs.mkdirSync(out, { recursive: true });
  const built = opts.built ?? 'a'.repeat(40);
  const pad = opts.pad ?? 9000;
  const decoy = `  "built_at_commit": "${'0'.repeat(40)}",\n`;
  const filler = pad > 0 ? `  "pad": "${'x'.repeat(pad)}",\n` : '';
  // A REAL-SHAPED body when a test needs the helper to parse the graph: the
  // node-link keys graphify writes, between the decoy and the real stamp, so
  // the same file exercises the hook's tail read AND the helper's JSON.parse
  // (which takes the LAST duplicate key — the real one).
  const body = opts.content
    ? `  "directed": false,\n  "multigraph": false,\n  "graph": {},\n`
      + `  "nodes": ${JSON.stringify(opts.content.nodes)},\n  "links": ${JSON.stringify(opts.content.links)},\n`
    : '';
  fs.writeFileSync(path.join(out, 'graph.json'),
    `{\n${decoy}${filler}${body}  "hyperedges": [],\n  "built_at_commit": "${built}"\n}\n`);
  if (opts.content) fs.writeFileSync(path.join(out, '.graphify_labels.json'), JSON.stringify(opts.content.labels));
  if (opts.report !== false) {
    fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'),
      `# Graph Report - demo  (2026-09-02)\n\n## Summary\n`
      + `- ${opts.nodes ?? 7662} nodes · 15645 edges · 423 communities\n`);
  }
  if (opts.engine !== null) {
    fs.writeFileSync(path.join(out, '.graphify_engine'), `${opts.engine ?? '0.9.9'}\n`);
  }
};
```

(Keep the existing doc comment above it; only the `content` option and the `body`/labels lines are new.) Then, after `gatedTree` and before `const pre = …`, add:

```ts
// ── The compaction-card fixtures (spec §3.0–§3.4). Module scope, the same
// reason as `plantGraph`: four describes ask one mechanism of one hook.
const HELPER_SRC = path.resolve(__dirname, '../../ccd/compact-card.mjs');
/** The helper lands beside the hook, where deploy.sh's agent lane and `ccrc
 *  install` put it (Task 10). A test that wants "no helper" simply does not
 *  call this. */
const plantHelper = (): void =>
  fs.copyFileSync(HELPER_SRC, path.join(home, '.cc-sessions', 'compact-card.mjs'));

/** The liveness rule (spec §3.0) reads mtimes against `COMPACT_LIVE_S` =
 *  120 s: a transcript written inside the window is a LIVE context. These two
 *  ages sit well on either side of it. */
const LIVE = 5;
const DEAD = 600;
/** A session's transcripts under a fixture `~/.claude/projects/<slug>/`: the
 *  parent at `<sid>.jsonl`, each subagent at
 *  `<sid>/subagents/[<under>/]agent-<id>.jsonl` — the layout measured on the
 *  fleet box (Agent-tool subagents directly in `subagents/`, Workflow agents
 *  under `subagents/workflows/<run>/`). mtimes are SET, never inherited from
 *  the write order, because the scope rule IS an mtime rule: each file's
 *  `age` is seconds before now. The parent defaults to DEAD — quiet, the
 *  shape measured while it waits on a subagent — which is also harmless for
 *  a main-thread test with no agents (no live agent → main). */
const plantSession = (opts: {
  sid?: string; lines: string[]; parentAge?: number;
  subagents?: { id: string; lines: string[]; age: number; under?: string }[];
}): { transcript: string; agents: Record<string, string> } => {
  const sid = opts.sid ?? 'sess-1';
  const proj = path.join(home, '.claude', 'projects', '-home-u-tree');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, `${sid}.jsonl`);
  fs.writeFileSync(transcript, opts.lines.join('\n') + '\n');
  const now = Math.floor(Date.now() / 1000);
  const pt = now - (opts.parentAge ?? DEAD);
  fs.utimesSync(transcript, pt, pt);
  const agents: Record<string, string> = {};
  for (const a of opts.subagents ?? []) {
    const dir = path.join(proj, sid, 'subagents', ...(a.under ? [a.under] : []));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `agent-${a.id}.jsonl`);
    fs.writeFileSync(f, a.lines.join('\n') + '\n');
    fs.utimesSync(f, now - a.age, now - a.age);
    agents[a.id] = f;
  }
  return { transcript, agents };
};

/** A tree whose graph is fresh at HEAD and carries the five-file GRAPH. */
const cardTree = (): string => {
  const tree = path.join(home, 'tree');
  const first = gitTree(tree, 1);
  plantGraph(tree, { built: first, nodes: NODES, content: GRAPH });
  return tree;
};
/** A PATH of symlinks to the real tools the hook forks — everything except
 *  the ones named — so a test can make ONE command genuinely absent (the
 *  `command -v` guard is about absence; a stub that exits 127 is not absence).
 *  `tmux` stays the fixture stub. */
const minimalPath = (omit: string[]): string => {
  const bin = path.join(home, 'binmin');
  fs.mkdirSync(bin, { recursive: true });
  for (const t of ['bash', 'jq', 'git', 'tail', 'head', 'grep', 'tr', 'cat', 'mv', 'rm', 'wc', 'sort', 'date',
    'find', 'timeout', 'node', 'sed', 'mkdir']) {
    if (omit.includes(t)) continue;
    const real = execFileSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).trim();
    if (real) fs.symlinkSync(real, path.join(bin, t));
  }
  fs.copyFileSync(path.join(home, 'bin', 'tmux'), path.join(bin, 'tmux'));
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  return bin;
};
/** A stub on the fixture PATH: `timeout` that records its argv and execs the
 *  rest, or `node` that fails / prints garbage. */
const stub = (name: string, body: string): void =>
  fs.writeFileSync(path.join(home, 'bin', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
/** The three compaction payloads, with the keys 2.1.266 sends (measured
 *  2026-09-09: PreCompact `custom_instructions|cwd|hook_event_name|prompt_id|
 *  session_id|transcript_path|trigger`; PostCompact the same with
 *  `compact_summary` for `custom_instructions`; SessionStart(compact)
 *  `cwd|hook_event_name|model|prompt_id|session_id|source|transcript_path`). */
const preCompact = (tree: string, transcript: string, trigger = 'manual'): object =>
  ({ hook_event_name: 'PreCompact', trigger, cwd: tree, transcript_path: transcript,
    session_id: 'sess-1', prompt_id: 'p1', custom_instructions: null });
const compactStart = (tree: string, transcript: string): object =>
  ({ hook_event_name: 'SessionStart', source: 'compact', cwd: tree, transcript_path: transcript,
    session_id: 'sess-1', prompt_id: 'p1', model: 'claude-opus-5' });
const postCompact = (tree: string, transcript: string, summary: string, trigger = 'manual'): object =>
  ({ hook_event_name: 'PostCompact', trigger, cwd: tree, transcript_path: transcript,
    session_id: 'sess-1', prompt_id: 'p1', compact_summary: summary });
const setFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.compactset');
const cardFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.compactcard');
const journalFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.compactions');
const readSet = (): any => JSON.parse(fs.readFileSync(setFile(), 'utf8'));
/** The card file: line 1 is the set's collision-resistant `nonce`; `at` remains numeric measurement. */
const readCard = (): { nonce: string; text: string } => {
  const raw = fs.readFileSync(cardFile(), 'utf8');
  const nl = raw.indexOf('\n');
  return { nonce: raw.slice(0, nl), text: raw.slice(nl + 1) };
};
/** Tool calls that name files of GRAPH: an absolute Read under the tree and
 *  a view-shaped shell line (bypass-permissions sessions read through `sed`). */
const workLines = (tree: string): string[] => [
  tl.toolUse('Read', { file_path: path.join(tree, 'server/src/pane/statusline.ts') }),
  tl.toolUse('Bash', { command: 'sed -n 1,40p server/src/watch.ts' }),
];
```

- [ ] **Step 3: Run the hook suite — nothing changed in behaviour, the file still compiles**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: PASS, the same count as before this task. (`plantHelper` and friends are unused until Task 2; vitest does not fail on an unused const.)

- [ ] **Step 4: Commit**

```bash
git add server/test/compactCardFixtures.ts server/test/session-hook.test.ts
git commit -m "test(compaction-card): the shared fixtures — measured transcript lines, a five-file node-link graph, a session directory with set mtimes"
```

---

### Task 2: The liveness rule, the overlap check and the hook-written set (spec §3.0, §3.1 steps 1–4)

> **Historical implementation task.** These Task 2 examples preserve the completed commit's pre-D-2605 behavior. Task 9 migrates every lifecycle temporary, rollback, and SessionStart claim producer to the §3.4 target inventory before any ordinary cleanup relies on that inventory.

**Files:**
- Modify: `ccd/session-hook.sh` — a constants block after `CARD_MAX_CHARS=2400`; three functions after `_hook_hold_card` (before `[[ -n "${HOME:-}" ]] || exit 0`); one call site before the final `exit 0`
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — which context is compacting (spec §3.0)')`

**Interfaces:**
- Produces through the historical Task 2 commit: `_hook_compact_scope <transcript_path> <trigger>` → sets `CS_SCOPE` (`main` | `subagent` | `ambiguous`), `CS_TRANSCRIPT` (empty for ambiguous), `CS_AGENT` (empty unless subagent), `CS_LIVE_N` (the live-agent count; empty on a manual trigger), `CS_PARENT_LIVE` (`true`/`false` when it decided, else empty); rc 1 = nothing may be said. `_hook_write_atomic <path> <text>` → rc 0 written whole, 1 nothing left behind; pre-D-2605 temp `$REG/.<id>.<pid>.<suffix>.tmp`. `_hook_compact_pre` → the overlap check, the stale-temp sweep, then writes `$REG/<id>.compactset` with numeric `at`, one collision-resistant `nonce`, `overlap:true|false`, and `files:null` — NOT MINED; it stops for `ambiguous`. Task 6 extends it with the helper call and nonce-gated rollback (`_hook_compact_rollback_set`/`_hook_compact_rollback_card`/`_hook_compact_rollback`, `ccd/session-hook.sh:792-842`, called at `:899`). **Task 9 (round 7, option A) deletes those three rollback functions and their call site outright** — there is nothing left to roll back once the helper never touches a canonical pathname — migrates the surviving lifecycle temporary producers to the §3.4 target table before ordinary sweeping, removes the earlier `served` set-cache behavior, and extends overlap to young private PostCompact claims. Constants `COMPACT_CARD_OFF`, `COMPACT_HELPER`, `COMPACT_CARD_MAX_CHARS`, `CARD_TOTAL_MAX_CHARS`, `COMPACT_CARD_MAX_AGE`, `COMPACT_LIVE_S`, `COMPACT_HELPER_TIMEOUT`, `COMPACT_LOCK_WAIT_SERVE`, `COMPACT_LOCK_WAIT`, `COMPACT_WORKSET_MAX`, `COMPACT_SHAPE_PRED`.
- Consumes: `_hook_graph_measure` (sets `GM_CWD GM_BUILT GM_FRESH`, rc 0/1/2), `_hook_epoch_ms`, `CCRC_ID_MAX`, `$payload`, `$id`, `$REG`; the fixtures of Task 1 (`plantSession`, `LIVE`, `DEAD`, `minimalPath`, the payload builders).

- [ ] **Step 1: Write the failing tests**

Add, beside the existing `run` helper near the top of `server/test/session-hook.test.ts`, a variant that also returns stderr (the file already imports `spawnSync`):

```ts
/** `run`, plus stderr: the hook's contract is silence on BOTH streams, and a
 *  bare `find` over a directory that does not exist would break it on stderr
 *  while stdout stays clean. */
const runFull = (payload: object, env: Record<string, string> = {}): { stdout: string; stderr: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr };
};
```

Then append at the end of the file:

```ts
describe('the compaction card — which context is compacting (spec §3.0)', () => {
  it('PreCompact writes the set: scope main, the parent transcript, files null, the rule\'s inputs — no graph, no subagents/, no stderr', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);                                  // a tree with NO graph
    const { transcript } = plantSession({ lines: workLines(tree) });
    const r = runFull(preCompact(tree, transcript, 'auto'));
    expect(r).toEqual({ stdout: '', stderr: '' });
    expect(readState().state).toBe('working');
    const set = readSet();
    expect(set).toMatchObject({ v: 1, scope: 'main', agent: null, transcript, parentLive: null, liveAgents: 0,
      cwd: tree, built: null, fresh: null, steered: false, served: false, overlap: false, files: null, stats: null });
    expect(Number.isInteger(set.at)).toBe(true);
    expect(fs.existsSync(cardFile()), 'no graph, so no card').toBe(false);
  });

  it('one LIVE agent beside a quiet parent is that subagent, with its id, its path and the inputs the rule saw', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript, agents } = plantSession({ lines: workLines(tree), parentAge: DEAD,
      subagents: [{ id: 'a43142b934b4bf501', lines: [tl.user('hi')], age: LIVE }] });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'subagent', agent: 'a43142b934b4bf501',
      transcript: agents['a43142b934b4bf501'], parentLive: false, liveAgents: 1 });
  });

  it('finds a Workflow agent one directory deeper — subagents/workflows/<run>/', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript, agents } = plantSession({ lines: workLines(tree),
      subagents: [{ id: 'ad18df71e1499fc22', lines: [tl.user('hi')], age: LIVE, under: 'workflows/wf_d5df1d76-69e' }] });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'subagent', agent: 'ad18df71e1499fc22',
      transcript: agents['ad18df71e1499fc22'] });
  });

  it('a DEAD agent file beside a live parent is main — liveness, not existence', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree), parentAge: LIVE,
      subagents: [{ id: 'a1', lines: [tl.user('x')], age: DEAD }] });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'main', agent: null, transcript, liveAgents: 0, parentLive: null });
  });

  it('two live contexts are AMBIGUOUS — a live parent beside a live agent, or two live agents — and the set says which', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const both = plantSession({ lines: workLines(tree), parentAge: LIVE,
      subagents: [{ id: 'a1', lines: [tl.user('x')], age: LIVE }] });
    run(preCompact(tree, both.transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'ambiguous', agent: null, transcript: null, files: null,
      parentLive: true, liveAgents: 1 });
    fs.rmSync(setFile());
    const fanout = plantSession({ sid: 'sess-2', lines: workLines(tree), parentAge: DEAD, subagents: [
      { id: 'a1', lines: [tl.user('x')], age: LIVE },
      { id: 'a2', lines: [tl.user('y')], age: LIVE, under: 'workflows/wf_1' },
    ] });
    run(preCompact(tree, fanout.transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'ambiguous', agent: null, transcript: null, parentLive: null, liveAgents: 2 });
  });

  it('a MANUAL trigger is main whatever is live — only the main thread takes /compact — and records no liveness', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree), parentAge: LIVE,
      subagents: [{ id: 'a1', lines: [tl.user('x')], age: LIVE }] });
    run(preCompact(tree, transcript, 'manual'));
    expect(readSet()).toMatchObject({ scope: 'main', transcript, parentLive: null, liveAgents: null });
  });

  it('OVERLAP: an unconsumed set inside the in-flight window makes the next PreCompact ambiguous and removes the card', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet().scope).toBe('main');
    fs.writeFileSync(cardFile(), `${readSet().nonce}\ngraphify card — planted\n`);
    run(preCompact(tree, transcript, 'auto'));            // a second compaction, the first unfinished
    expect(readSet()).toMatchObject({ scope: 'ambiguous', transcript: null, overlap: true });
    expect(fs.existsSync(cardFile()), 'the card of the overlapped compaction is gone').toBe(false);
    // …but a set OLDER than the window is a compaction that never finished, not overlap
    const old = Math.floor(Date.now() / 1000) - 1200 - 60;
    fs.utimesSync(setFile(), old, old);
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet().scope).toBe('main');
  });

  it('sweeps this id\'s STALE compaction temps — a helper killed by timeout leaves one, and _reg_purge never sees a dot-leading name', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree) });
    const reg = path.join(home, '.cc-sessions');
    const stale = path.join(reg, '.demo-quiet-basin.compactcard.999.tmp');
    const young = path.join(reg, '.demo-quiet-basin.4242.compactset.tmp');
    const other = path.join(reg, '.other-id.compactcard.999.tmp');
    for (const f of [stale, young, other]) fs.writeFileSync(f, 'x');
    const old = Math.floor(Date.now() / 1000) - 1200 - 60;
    fs.utimesSync(stale, old, old); fs.utimesSync(other, old, old);
    run(preCompact(tree, transcript, 'auto'));
    expect(fs.existsSync(stale), 'stale temp of this id swept').toBe(false);
    expect(fs.existsSync(young), 'a young temp may belong to a helper in flight').toBe(true);
    expect(fs.existsSync(other), 'another id\'s temp is not ours to sweep').toBe(true);
  });

  it('a served session (empty transcript_path) and an unreadable path write no set', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    run({ ...preCompact(tree, ''), transcript_path: '' });
    expect(fs.existsSync(setFile())).toBe(false);
    run(preCompact(tree, path.join(home, 'nowhere', 'gone.jsonl')));
    expect(fs.existsSync(setFile())).toBe(false);
    expect(readState().state, 'the state write is not gated on the card').toBe('working');
  });

  it('with no `find` on PATH nothing may be said — no set, the state written, no stderr', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree) });
    const r = runFull(preCompact(tree, transcript, 'auto'), { PATH: minimalPath(['find']) });
    expect(r).toEqual({ stdout: '', stderr: '' });
    expect(fs.existsSync(setFile())).toBe(false);
    expect(readState().state).toBe('working');
  });

  it('an agent file whose name is unspeakable is refused — nothing is written', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree),
      subagents: [{ id: 'x y`z', lines: [tl.user('hi')], age: LIVE }] });
    run(preCompact(tree, transcript, 'auto'));
    expect(fs.existsSync(setFile())).toBe(false);
  });

  it('the operator file ~/.ccrc/compact-card-off silences the arm', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree) });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
    run(preCompact(tree, transcript));
    expect(fs.existsSync(setFile())).toBe(false);
    expect(readState().state).toBe('working');
  });

  it('with a fresh graph the set carries built and fresh, still files null before the helper exists', () => {
    const tree = cardTree();                            // no plantHelper(): Task 6 adds the card
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const set = readSet();
    expect(set.built).toMatch(/^[0-9a-f]{40}$/);
    expect(set.fresh).toBe('fresh');
    expect(set.files).toBeNull();
  });

  it('the set is written whole or not at all — no temp survives, and the temp is dot-prefixed with the pid', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1);
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const names = fs.readdirSync(path.join(home, '.cc-sessions'));
    expect(names.filter((n) => n.includes('compactset'))).toEqual(['demo-quiet-basin.compactset']);
    // the temp's shape, pinned in the source: `.<id>.<pid>.<suffix>.tmp`, the hookstate writer's own idiom
    expect(fs.readFileSync(HOOK, 'utf8')).toContain('local tmp="$REG/.$id.$$.${1##*/}.tmp"');
  });

  it('the constants are the spec\'s, the total is DERIVED, and the shape predicate is spelled once', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src).toMatch(/^COMPACT_CARD_MAX_CHARS=4000$/m);
    expect(src).toMatch(/^CARD_MAX_CHARS=2400$/m);
    expect(src).toMatch(/^CARD_TOTAL_MAX_CHARS=\$\(\( CARD_MAX_CHARS \+ 1 \+ COMPACT_CARD_MAX_CHARS \)\)$/m);
    expect(src).toMatch(/^COMPACT_CARD_MAX_AGE=1200$/m);
    expect(src).toMatch(/^COMPACT_LIVE_S=120$/m);
    expect(src).toMatch(/^COMPACT_HELPER_TIMEOUT=8$/m);
    expect(src).toMatch(/^COMPACT_WORKSET_MAX=12$/m);
    expect(2400 + 1 + 4000).toBeLessThan(10000);      // under the harness's spill (2.1.266 `Pdr=1e4`)
    expect(src.match(/^COMPACT_SHAPE_PRED=/gm)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the new describe and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "which context is compacting"`
Expected: FAIL — every `readSet()` throws ENOENT (no set file), the constants test fails on the first `toMatch`.

- [ ] **Step 3: The constants block**

> **HISTORICAL RECORD — the shipped text DIFFERS (round 10, A-M2).** Task 2 is complete, and measured against
> the tree at this commit `ccd/session-hook.sh:1091-1101` carries the OLD wording ("Three registry files per
> session … The same dot-free shape is what `_ws_slug_free` scans"), **not** the block below. So round 8's I5
> premise that this block "ships into `ccd/session-hook.sh`" is false against the tree, and no task is
> assigned to make the tree match it. The block is kept as the record of what Task 2 was asked to ship;
> **the live site is `session-hook.sh:1098`, already in Task 9's comment scope**, and a Task 9 implementer
> must edit the SHIPPED comment there rather than paste this one. The block is corrected below anyway so that
> pasting it cannot reintroduce the half-pair defect round 9's B-I5 closure just fixed.

In `ccd/session-hook.sh`, immediately after the line `CARD_MAX_CHARS=2400` (and before the `# BOUNDED AND ANCHORED.` comment that introduces `CCRC_PROJ_CLASS`), insert:

```bash
# ── THE COMPACTION CARD (spec 2026-09-09-graphify-compaction-card-design.md) ──
# Canonical row artifacts are `.compactset`, `.compactcard`, `.compactions`,
# and `.generation`; Task 9's §3.4 inventory names every private lifecycle
# source, alias, claim, marker, stage and snapshot. PreCompact publishes the
# set, SessionStart serves the card once through a private claim, and
# PostCompact replaces the journal atomically with old bytes plus one line;
# hookstate never reads it. `_ws_slug_free` AND `_ws_slug_residue` — a pair,
# never one alone — see canonical generation and every private residual family
# ONLY once Task 9 widens BOTH (round 8 I4; round 9 B-I5; spec §3.4): each
# strips the literal `.<id>.` prefix and matches the remainder against the
# family grammar or the bare `.generation` field; the permanent lock alone is
# the named exclusion for both. Every reason `_ws_slug_free` can refuse is a
# reason `_ws_slug_residue` can name, so `ws-add`'s refusal names real files.
# Locked exact-ID cleanup ignores only that permanent lock.
# No broad `.compact*.tmp` sweep is permitted.
# The kill-switch is the same shape as GRAPH_GATE_OFF and CCRC_CARD_OFF: a file
# the operator touches by hand, honoured by all three arms.
COMPACT_CARD_OFF="$HOME/.ccrc/compact-card-off"
COMPACT_HELPER="$HOME/.cc-sessions/compact-card.mjs"
COMPACT_CARD_MAX_CHARS=4000
# DERIVED, NEVER A THIRD BUDGET. `CARD_MAX_CHARS` above stays the FIRST clip
# and the standing subjects' whole ceiling — it is the only defence for the
# ungated `GM_NODES` (D-1899) and must not move. The compact subject is
# appended AFTER that clip, under its own ceiling, and this is a pin on the SUM
# the emitter may print: it cannot cut what the two clips admitted, and
# `session-hook.test.ts` holds it under the harness's 10,000-char spill
# (2.1.266 spills SessionStart context to disk above `Pdr=1e4`).
CARD_TOTAL_MAX_CHARS=$(( CARD_MAX_CHARS + 1 + COMPACT_CARD_MAX_CHARS ))
# THE IN-FLIGHT WINDOW, SPLIT BY ARTIFACT. An aged CARD is removed unread
# (SessionStart(compact)). An aged canonical SET is NOT: it is still claimed
# and measured at settlement, its age deciding provenance eligibility only.
# An unconsumed set YOUNGER than this at PreCompact means another compaction
# of this session is in flight (spec §3.0, overlap). Argued from the longest
# compaction measured on this fleet — 826 s, gpt lane, 2026-09-08 — times 1.45.
COMPACT_CARD_MAX_AGE=1200
# LIVENESS (spec §3.0). A transcript written inside this window is a live
# context. Measured: a working agent writes a row every 4–6 s and pauses over
# 79 s in 1–2% of rows; a compacting context writes nothing for ≥79 s; a parent
# waiting on a fan-out writes nothing at all; and at its own auto-compaction the
# parent's last row is 0.8 s old at p50, 3.7 s at p95, never 120 s (n=216).
# Used as `find -mmin` minutes.
COMPACT_LIVE_S=120
# THE HELPER WAIT (spec §6, amendment R2 of the header's contract): both
# helper calls use `_hook_timeout`, resolving `timeout` or `gtimeout`, for at
# most this many seconds, off the hot path — PreCompact and PostCompact bracket
# a compaction of at least 79 s — and after the hookstate write has landed.
# The later D-2605 lifecycle task (Task 9) adds the two separate lock waits below. Argued from
# measured inputs (node startup ~0.05 s, a 70 MB graph parsed and indexed in
# ~1.5 s, a 16 MiB window mined in well under a second through a basename
# index) at roughly twice their sum, and RE-MEASURED on this box's real graphs
# before it shipped — the p95 and peak RSS are recorded here by Task 6 of
# plans/2026-09-10-graphify-compaction-card-plan-a.md: <p95> s / <RSS> MB.
COMPACT_HELPER_TIMEOUT=8
# TWO LOCK WAITS (spec §3.4, §6 R2, round 7), not one shared journal-lock wait:
# `COMPACT_LOCK_WAIT_SERVE` is compact SessionStart's acquisition ALONE — the
# one a human is waiting on, whose miss costs only the card. `COMPACT_LOCK_WAIT`
# is every OTHER acquisition — PreCompact's two, PostCompact's settlement and
# final-transaction reacquire, row creation, `_spawn_start`, `_reg_purge` — all
# off the hot path, each losing a durable artifact on a miss rather than a
# human's wait. Both are passed as the acquire helper's FIRST POSITIONAL
# PARAMETER (`flock -w "$1" "$fd"`), never hardcoded inside the helper, which is
# what lets these two bounds share one acquire path: `COMPACT_LOCK_WAIT` is
# argued from measured p95 (below); `COMPACT_LOCK_WAIT_SERVE` is a deliberate
# product choice for the one human-facing wait, not an independent measurement
# of its own (round 8, M2).
# `COMPACT_LOCK_WAIT`'s value is derived, not a round number: Task 9 measures
# each held section's p95 and max on the fleet box (`_hook_graph_measure` moved
# OUT of the lock first, since it touches no lifecycle artifact) and sets it at
# >= 8x measured p95, rounded up. The lock is NEVER unlinked, so every writer
# contends on it.
COMPACT_LOCK_WAIT_SERVE=2
COMPACT_LOCK_WAIT=5
COMPACT_WORKSET_MAX=12
# ONE SPELLING of the shape exactly one helper measurement must have before it
# can become a journal record (spec §3.4). Task 9's `jq -ce -s` gate requires
# `length == 1` and applies this predicate to element zero; zero, plural,
# concatenated, malformed or wrong-shaped stdout commits nothing. The record
# has no persisted ordinal and never passes through hookstate. Concatenate this
# predicate into that one jq program; never re-spell it.
COMPACT_SHAPE_PRED='(type=="object" and (.chars|type)=="number" and (.fences|type)=="number" and (.at|type)=="number" and (.trigger=="auto" or .trigger=="manual") and (.steered|type)=="boolean" and (.served|type)=="boolean" and ((.filesChars|type)=="number" or .filesChars==null) and ((.cited|type)=="number" or .cited==null) and ((.setSize|type)=="number" or .setSize==null) and (.scope=="main" or .scope=="subagent" or .scope=="ambiguous" or .scope==null))'
```

- [ ] **Step 4: The three functions**

In `ccd/session-hook.sh`, after the closing `}` of `_hook_hold_card` and before `[[ -n "${HOME:-}" ]] || exit 0`, insert:

```bash
# ── THE COMPACTION CARD: WHICH CONTEXT IS COMPACTING (spec §3.0) ─────────
# The three compaction payloads carry the PARENT'S session_id and
# transcript_path and no agent field — for a subagent's compaction exactly as
# for the main thread's (measured 2026-09-09 on 2.1.266: five headless runs,
# byte-identical key sets; `prompt_id` is the parent's on a subagent's rows
# too). So the hook asks the filesystem, and ONLY HERE, at PreCompact: from
# this moment the compacting context writes nothing for ≥79 s, so any later
# arm would see it as the quietest file, never the newest. The rule is
# LIVENESS, not recency:
#   manual trigger            → main   (only the main thread takes /compact)
#   no live agent file        → main   (an auto-compaction fires right after a write)
#   one live agent, parent quiet → that subagent
#   anything else             → ambiguous — two contexts wrote inside the window
#                               and nothing says which one stopped to compact
# `ambiguous` is an ANSWER: no card (a sibling's card is wrong context, and
# wrong context is worse than none), a measurement that says so, and a count
# on the corpus. It is the honest answer for a Workflow fan-out — seven and
# eight agents of one session, measured, writing every 4–6 s for 13–39 min —
# so a subagent card is reachable only for a SOLO live subagent. The rule
# records what it saw (CS_LIVE_N, CS_PARENT_LIVE) beside its verdict, so every
# journal line can be audited offline against the transcripts.
# A subagent's transcript is `<transcript minus .jsonl>/subagents/**/
# agent-<id>.jsonl` (Agent-tool subagents directly in it, Workflow agents one
# `workflows/<run>/` deeper); `<transcript minus .jsonl>` IS
# `<dirname>/<session_id>`, so no second payload read is needed.
# `find -mmin` is on GNU and BSD alike; `-printf` is not, and this file's
# header declares two userlands. `find` itself is new to this file and guarded
# like `jq` at the top: a box without it says NOTHING rather than a silent
# `main` for every compaction.
_hook_compact_scope() {   # <transcript_path> <trigger> -> CS_SCOPE CS_TRANSCRIPT CS_AGENT CS_LIVE_N CS_PARENT_LIVE ; rc 1 = nothing may be said
  CS_SCOPE=""; CS_TRANSCRIPT=""; CS_AGENT=""; CS_LIVE_N=""; CS_PARENT_LIVE=""
  local tp="$1" trig="$2" dir="" f="" live="" n=0 mins=$(( COMPACT_LIVE_S / 60 ))
  [[ -n "$tp" && -f "$tp" && -r "$tp" ]] || return 1
  command -v find >/dev/null 2>&1 || return 1
  if [[ "$trig" == manual ]]; then CS_SCOPE="main"; CS_TRANSCRIPT="$tp"; return 0; fi
  dir="${tp%.jsonl}/subagents"
  if [[ -d "$dir" ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      n=$(( n + 1 )); live="$f"
    done < <(find "$dir" -name 'agent-*.jsonl' -mmin "-$mins" 2>/dev/null)
  fi
  CS_LIVE_N="$n"
  if (( n == 0 )); then CS_SCOPE="main"; CS_TRANSCRIPT="$tp"; return 0; fi
  if (( n > 1 )); then CS_SCOPE="ambiguous"; return 0; fi
  # The parent's own liveness decides only here, beside exactly one live
  # agent, and is recorded only when it decided.
  if [ -n "$(find "$tp" -mmin "-$mins" 2>/dev/null)" ]; then CS_PARENT_LIVE="true"; CS_SCOPE="ambiguous"; return 0; fi
  CS_PARENT_LIVE="false"
  [[ -f "$live" && -r "$live" ]] || return 1
  f="${live##*/}"; f="${f#agent-}"; f="${f%.jsonl}"
  # SHAPE-GATED, like every other string this file quotes: the id lands in the
  # set, the journal and (Plan B) the wire. A name this refuses is unspeakable
  # and the arm says nothing — `case` plus `${#x}`, the file's own idiom.
  case "$f" in ''|*[!A-Za-z0-9_-]*) return 1 ;; esac
  (( ${#f} <= CCRC_ID_MAX )) || return 1
  CS_SCOPE="subagent"; CS_TRANSCRIPT="$live"; CS_AGENT="$f"
  return 0
}

# The hookstate writer's own tmp+mv idiom (`$REG/.$id.$$.hookstate.tmp`),
# factored for the three compaction files. The braces put the REDIRECTION's
# failure under the 2>/dev/null too (D-1691). The temp is a DOTFILE beside its
# target — invisible to every suffix-shaped registry glob — and `$$` keeps two
# hooks' temps apart.
_hook_write_atomic() {   # <path> <text> -> 0 written whole; 1 nothing left behind
  local tmp="$REG/.$id.$$.${1##*/}.tmp"
  { printf '%s\n' "$2" > "$tmp"; } 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$1" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# ── PreCompact (spec §3.1): THE SET ALWAYS, THE CARD WITH A GRAPH ────────
# Called from the very end of this file, AFTER the hookstate rename: the
# `working` stamp lands first and never waits on the helper (Task 6 adds it,
# bounded by `timeout`). Prints nothing — stage 1. Every failure is silent and
# total for what comes after it.
_hook_compact_pre() {
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local tp="" trig="" set="$REG/$id.compactset" cardf="$REG/$id.compactcard" doc="" at="" overlap=false rc=0
  local mins=$(( COMPACT_CARD_MAX_AGE / 60 ))
  tp=$(jq -r '.transcript_path // empty' <<<"$payload" 2>/dev/null) || return 0
  trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || trig="auto"
  _hook_compact_scope "$tp" "$trig" || return 0
  # OVERLAP (spec §3.0). One slot per session id, and every context of the
  # session writes it. An unconsumed set still inside the in-flight window
  # means another compaction is in flight (or failed inside the window), and
  # no later arm can tell which context it serves — so BOTH degrade: this one
  # is ambiguous and the earlier one's card is removed. The helper makes the
  # verdict durable by re-reading the slot before each of its own writes.
  if [ -n "$(find "$set" -mmin "-$mins" 2>/dev/null)" ]; then
    overlap=true; CS_SCOPE="ambiguous"; CS_TRANSCRIPT=""; CS_AGENT=""
  fi
  [[ "$CS_SCOPE" != ambiguous ]] || rm -f "$cardf"
  # THE SWEEP. A helper killed by `timeout` can leave only an exact §3.4
  # private family. It is invisible to the old dot-free purge loop, so a later
  # validated lock holder ages only this ID's eligible residual suffixes; a
  # young one may belong to a helper in flight.
  _hook_compact_sweep_exact_families "$mins"  # §3.4 inventory; never a broad compact glob
  rc=0; _hook_graph_measure || rc=$?
  at=$(_hook_epoch_ms)
  nonce="compact-${at}-${$}-${RANDOM}-${RANDOM}"
  # THE HOOK'S OWN SET. `at` is numeric measurement; this one generated nonce
  # owns the card pair and every rollback seam (§3.3). `files:null` is NOT
  # MINED, which the helper's `files:[]` (mined, empty)
  # must never be read as — two conditions, two values. Written BEFORE the
  # graph gates, so PostCompact has the scope on a tree with no graph at all;
  # `built`/`fresh` are measured first so the journal carries them either way;
  # `parentLive`/`liveAgents` are what the rule saw, null where it did not look.
  # Serving is marker-only: no canonical set writer persists a `served` cache.
  doc=$(jq -cn --arg scope "$CS_SCOPE" --arg agent "$CS_AGENT" --arg t "$CS_TRANSCRIPT" \
      --arg pl "$CS_PARENT_LIVE" --arg ln "$CS_LIVE_N" --argjson overlap "$overlap" \
      --arg cwd "$GM_CWD" --arg built "$GM_BUILT" --arg fresh "$GM_FRESH" --arg nonce "$nonce" --argjson at "$at" \
      '{v:1, at:$at, nonce:$nonce, scope:$scope, agent:(if $agent=="" then null else $agent end),
        transcript:(if $t=="" then null else $t end),
        parentLive:(if $pl=="true" then true elif $pl=="false" then false else null end),
        liveAgents:(if $ln=="" then null else ($ln|tonumber) end),
        cwd:(if $cwd=="" then null else $cwd end),
        built:(if $built=="" then null else $built end),
        fresh:(if $fresh=="" then null else $fresh end), overlap:$overlap,
        steered:false, files:null, stats:null}' 2>/dev/null) || return 0
  _hook_write_atomic "$set" "$doc" || return 0
  [[ "$CS_SCOPE" != ambiguous ]] || return 0
  return 0
}
```

- [ ] **Step 5: The call site**

At the very end of `ccd/session-hook.sh`, replace the final two lines

```bash
[ -z "$pre_json" ] || printf '%s\n' "$pre_json"
exit 0
```

with

```bash
[ -z "$pre_json" ] || printf '%s\n' "$pre_json"
# PreCompact's card work runs LAST, after the `working` stamp is on disk: the
# helper it will call (Task 6) is bounded by `timeout`, and the state write
# must never wait on it. Nothing below prints.
if [[ "$event" == PreCompact ]]; then _hook_compact_pre || true; fi
exit 0
```

- [ ] **Step 6: Run the describe and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "which context is compacting"`
Expected: PASS — all 15 tests of the describe.

- [ ] **Step 7: Mutation checks** (in an isolated disposable copy: mutate, run the same command, and see the named case red)

1. In `_hook_compact_scope`, delete `-mmin "-$mins"` from the agents' `find` → `a DEAD agent file beside a live parent is main` goes red (the dead file now counts).
2. Delete the parent-liveness line (`if [ -n "$(find "$tp" …` → `ambiguous`) → the first half of `two live contexts are AMBIGUOUS` goes red (it answers subagent).
3. Replace `find "$dir" -name 'agent-*.jsonl'` with `find "$dir" -maxdepth 1 -name 'agent-*.jsonl'` → `finds a Workflow agent one directory deeper` goes red.
4. Delete the `if [[ "$trig" == manual ]]` line → `a MANUAL trigger is main` goes red.
5. Delete the overlap `if [ -n "$(find "$set" …` block → the OVERLAP test goes red (scope stays main, the card survives).
6. Delete the sweep `find "$REG" -maxdepth 1 …` line → `sweeps this id's STALE compaction temps` goes red; change `-mmin "+$mins"` to `-mmin "-$mins"` → the `young` assertion goes red.
7. Delete `command -v find >/dev/null 2>&1 || return 1` → `with no find on PATH` goes red (a set is written, scope `main`).
8. Delete the line `[ -e "$COMPACT_CARD_OFF" ] && return 0` in `_hook_compact_pre` → `the operator file … silences the arm` goes red.
9. Change `files:null` to `files:[]` in the jq program → the first test's `files: null` goes red; change `liveAgents:(…)` to `liveAgents:0` → the fan-out half of the AMBIGUOUS test goes red; force `overlap:false` → the overlap assertion goes red.
10. Delete the `case "$f" in …` shape gate → `an agent file whose name is unspeakable is refused` goes red.
11. Delete `2>/dev/null` from the agents' `find` and run the first test with a session that has no `subagents/` — it stays green (the directory guard skips the find); now also delete the `[[ -d "$dir" ]]` guard → its `stderr: ''` goes red. Record both in the commit body: the guard and the redirect each cover the other.

- [ ] **Step 8: Run the whole hook file and the installer test**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/install-session-hooks.test.ts`
Expected: PASS — the `prints NOTHING on every other event` row still holds for PreCompact, and the `case` block still parses to the same ten events.

- [ ] **Step 9: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): PreCompact decides which context is compacting by liveness — main, subagent or ambiguous — records what it saw, and writes the set, files null until mined (spec §3.0)"
```

---

### Task 3: The helper's skeleton and the transcript window (spec §3.2 "Window")

**Files:**
- Create: `ccd/compact-card.mjs`, `ccd/compact-card.d.mts`
- Test: `server/test/compact-card.test.ts` (new file)

**Interfaces:**
- Produces: `EXIT = {OK:0, FAILURE:1, USAGE:2, EMPTY:3}`, `WINDOW_CAP` (16 MiB), `CHUNK` (1 MiB), `isBoundaryLine(line)`, `readWindow(path, cap?, chunk?)` → `{text, boundary}` (the chunk size is a parameter so a test can build a deterministic chunk-edge straddle), `parseArgs(argv)` → `{cmd, opts}` | `{error}`; the CLI `node compact-card.mjs <card|measure> --flag value …` with exit 2 on usage (`card` requires `--transcript --cwd --graph --labels --out --set --max-chars --max-files --built --fresh --scope --at --nonce`). `at` must be a positive epoch-millisecond measurement and `nonce` a nonempty ownership string. `main` dispatches `card` to `cardCommand` (Task 5) and `measure` to `measureCommand` (Task 8); until those land, both subcommands exit 1 through the catch — no test asks for them before their task.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/compact-card.test.ts
// The compaction card's helper, imported directly (the `shared/mark.mjs`
// precedent: a deploy-side node script the PWA never bundles, unit-tested
// from vitest) and run as the hook runs it (`node <helper> <cmd> …`), for the
// exit codes and the files it leaves behind.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { tl, GRAPH, graphJson } from './compactCardFixtures.js';
import {
  EXIT, WINDOW_CAP, CHUNK, isBoundaryLine, readWindow, parseArgs,
} from '../../ccd/compact-card.mjs';

const HELPER = path.resolve(__dirname, '../../ccd/compact-card.mjs');
let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-compact-card-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name: string, text: string): string => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
/** The helper as the hook runs it. */
const helper = (args: string[], input = ''): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [HELPER, ...args], { input, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('readWindow — the transcript since the last boundary (spec §3.2)', () => {
  const boundary = tl.boundary();
  const row = (i: number): string => tl.user(`row ${i}`);

  it('returns the lines from the LAST boundary to EOF, boundary line included', () => {
    const p = write('t.jsonl', [row(1), boundary, row(2), boundary, row(3), row(4)].join('\n') + '\n');
    const w = readWindow(p);
    expect(w.boundary).toBe(true);
    expect(w.text.split('\n').filter(Boolean)).toEqual([boundary, row(3), row(4)]);
  });

  it('a "compact_boundary" literal that is NOT the harness row is not a boundary — the prototype\'s false positive', () => {
    // The RAW bytes must carry the needle `"compact_boundary"` — a literal
    // inside a JSON string is escaped by JSON.stringify and would never be
    // scanned. A `user` row whose own top-level `subtype` is the literal is the
    // shape: it is found FIRST by the backwards scan and must be rejected.
    const decoy = JSON.stringify({ type: 'user', subtype: 'compact_boundary', message: { role: 'user', content: 'not the harness' } });
    expect(decoy.includes('"compact_boundary"')).toBe(true);
    const p = write('t.jsonl', [row(1), boundary, row(2), decoy, row(3)].join('\n') + '\n');
    const w = readWindow(p);
    expect(w.boundary).toBe(true);
    expect(w.text.split('\n').filter(Boolean)).toEqual([boundary, row(2), decoy, row(3)]);
  });

  it('a boundary whose needle STRADDLES a chunk edge, several chunks back, is found', () => {
    // Deterministic: with a 4 KiB chunk, place the needle so the edge
    // `size - k*chunk` falls 8 bytes into it. `(size - needleOffset) % chunk`
    // is the needle's distance past the nearest edge counted from EOF.
    const chunk = 4096, want = 8;
    const build = (padLen: number): string => [row(1), boundary, tl.user('x'.repeat(padLen)), row(9)].join('\n') + '\n';
    let padLen = 3 * chunk;
    let text = build(padLen);
    const needle = text.indexOf('"compact_boundary"');
    const cur = (Buffer.byteLength(text) - needle) % chunk;
    padLen += (want - cur + chunk) % chunk;
    text = build(padLen);
    expect((Buffer.byteLength(text) - needle) % chunk).toBe(want);
    const p = write('t.jsonl', text);
    const w = readWindow(p, WINDOW_CAP, chunk);
    expect(w.boundary).toBe(true);
    expect(w.text.startsWith(boundary)).toBe(true);
    expect(w.text.trimEnd().endsWith(row(9))).toBe(true);
    expect(CHUNK).toBe(1024 * 1024);
  });

  it('with no boundary the whole file is the window', () => {
    const text = [row(1), row(2)].join('\n') + '\n';
    expect(readWindow(write('t.jsonl', text))).toEqual({ text, boundary: false });
  });

  it('with no boundary and a file over the cap, the window is the last cap bytes REALIGNED to a line start', () => {
    const text = Array.from({ length: 50 }, (_, i) => row(i)).join('\n') + '\n';
    const p = write('t.jsonl', text);
    const w = readWindow(p, 300);
    expect(w.boundary).toBe(false);
    expect(w.text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith(w.text)).toBe(true);
    for (const l of w.text.split('\n').filter(Boolean)) expect(() => JSON.parse(l)).not.toThrow();
    expect(WINDOW_CAP).toBe(16 * 1024 * 1024);
  });

  it('isBoundaryLine confirms only the harness shape', () => {
    expect(isBoundaryLine(boundary)).toBe(true);
    expect(isBoundaryLine(JSON.stringify({ type: 'user', subtype: 'compact_boundary' }))).toBe(false);
    expect(isBoundaryLine(JSON.stringify({ type: 'system', subtype: 'turn_duration' }))).toBe(false);
    expect(isBoundaryLine('not json')).toBe(false);
  });
});

describe('the CLI contract', () => {
  it('parseArgs reads --kebab-flags into camelCase, --steer as a boolean, and refuses a bare word', () => {
    expect(parseArgs(['card', '--max-chars', '4000', '--steer', '--scope', 'main']))
      .toEqual({ cmd: 'card', opts: { maxChars: '4000', steer: true, scope: 'main' } });
    expect(parseArgs(['card', 'stray'])).toEqual({ error: 'unexpected argument stray' });
    expect(parseArgs(['card', '--out'])).toEqual({ error: '--out needs a value' });
  });
  it('exits 2 on no subcommand, an unknown one, or a missing required flag, with nothing on stdout', () => {
    for (const args of [[], ['frobnicate'], ['card', '--transcript', 'x'], ['measure'], ['measure', '--trigger', 'weird']]) {
      const r = helper(args);
      expect(r.status, args.join(' ')).toBe(EXIT.USAGE);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^compact-card: /);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: FAIL — the import of `../../ccd/compact-card.mjs` cannot be resolved.

- [ ] **Step 3: Write the helper — header, constants, window, CLI**

```js
#!/usr/bin/env node
// ccd/compact-card.mjs — the compaction card's helper. `card` mines a
// transcript window for the files a context was working in, resolves them
// against graphify's graph.json and renders a structural card; `measure`
// scores a compaction summary against that working set.
//
// Spec: docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md
// (§3.2 `card`, §3.4 `measure`). Invoked ONLY by ccd/session-hook.sh, under
// `timeout`, on PreCompact and PostCompact; installed beside the hook as
// ~/.cc-sessions/compact-card.mjs by deploy.sh's agent lane and `ccrc install`.
//
// Plain node, `node:*` imports only — the `shared/mark.mjs` class: a
// deploy-side script the PWA never bundles, importable by vitest directly
// (types in the hand-written `compact-card.d.mts` beside it). Reads only the
// files it is given; writes only `--out` and `--set`, each through a
// dot-prefixed temp name and a rename — the hook's own idiom.
//
// Exit codes (spec §3.2): 0 written; 3 empty working set (the set is written
// with `files: []`, no card); 2 usage; 1 any failure. `card` prints nothing on
// stdout; `measure` prints exactly one JSON object. Every failure names itself
// on stderr, which the hook discards — the hook's contract is silence.
import { openSync, readSync, closeSync, fstatSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 2, EMPTY: 3 });

/** The window when no boundary exists: the last 16 MiB, realigned to a line
 *  start — a mid-line start is not a partial parse, `JSON.parse` rejects it
 *  wholesale, which the prototype measured as a silently empty set. 16 MiB,
 *  not 64: a transcript that has never compacted is far smaller (auto-
 *  compaction fires long before), and the cap bounds the helper's time and
 *  memory (a 64 MiB window measured 0.3 s to read and 0.4 s to mine). */
export const WINDOW_CAP = 16 * 1024 * 1024;
/** The backwards-scan chunk; a parameter of `readWindow` so a test can build
 *  a deterministic chunk-edge straddle with a small one. */
export const CHUNK = 1024 * 1024;
/** A boundary row is small (measured on this session's own transcript: 1,348
 *  and 1,943 bytes). A `"compact_boundary"` literal whose line start or end
 *  lies further away than this is inside a message body, not a row. */
const LINE_SCAN_MAX = 65536;
const NEEDLE = Buffer.from('"compact_boundary"');

/** Is this line the harness's own boundary row — `{type:"system",
 *  subtype:"compact_boundary"}` — and not a literal inside a message body? */
export function isBoundaryLine(line) {
  try {
    const o = JSON.parse(line);
    return o !== null && typeof o === 'object' && o.type === 'system' && o.subtype === 'compact_boundary';
  } catch {
    return false;
  }
}

/** The line containing byte offset `at`, bounded by LINE_SCAN_MAX on either
 *  side; null when a line end is not found inside the bound. */
function lineAt(fd, at, size) {
  const before = Math.min(LINE_SCAN_MAX, at);
  const after = Math.min(LINE_SCAN_MAX, size - at);
  const buf = Buffer.alloc(before + after);
  readSync(fd, buf, 0, buf.length, at - before);
  const nlBefore = before > 0 ? buf.lastIndexOf(0x0a, before - 1) : -1;
  const start = nlBefore >= 0 ? nlBefore + 1 : (at - before === 0 ? 0 : -1);
  const nlAfter = buf.indexOf(0x0a, before);
  const end = nlAfter >= 0 ? nlAfter : (at + after === size ? buf.length : -1);
  if (start < 0 || end < 0) return null;
  return { start: at - before + start, text: buf.subarray(start, end).toString('utf8') };
}

function readFrom(fd, start, size) {
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  return buf.toString('utf8');
}

/** The transcript window (spec §3.2): from the last CONFIRMED compaction
 *  boundary to EOF, found by scanning BACKWARDS in 1 MiB chunks for the
 *  literal and parsing the line it sits on; else the whole file, capped at the
 *  last `cap` bytes realigned to a line start. Chunks are searched as they
 *  are read and concatenated once, so a 64 MiB file with no boundary costs one
 *  pass, not sixty-four. */
export function readWindow(path, cap = WINDOW_CAP, chunkSize = CHUNK) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const chunks = [];
    let pos = size, total = 0;
    // The head of the previously read (later) chunk: a needle split across
    // the chunk edge is matched in `chunk + carry`, never lost.
    let carry = Buffer.alloc(0);
    while (pos > 0 && total < cap) {
      const len = Math.min(chunkSize, pos);
      pos -= len;
      const chunk = Buffer.alloc(len);
      readSync(fd, chunk, 0, len, pos);
      chunks.unshift(chunk);
      total += len;
      const probe = Buffer.concat([chunk, carry]);
      let at = probe.lastIndexOf(NEEDLE);
      while (at >= 0) {
        const line = lineAt(fd, pos + at, size);
        if (line && isBoundaryLine(line.text)) return { text: readFrom(fd, line.start, size), boundary: true };
        at = at > 0 ? probe.lastIndexOf(NEEDLE, at - 1) : -1;
      }
      carry = chunk.subarray(0, Math.min(NEEDLE.length - 1, chunk.length));
    }
    let buf = Buffer.concat(chunks);
    if (pos > 0 || buf.length > cap) {
      buf = buf.subarray(Math.max(0, buf.length - cap));
      const nl = buf.indexOf(0x0a);
      buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0);
    }
    return { text: buf.toString('utf8'), boundary: false };
  } finally {
    closeSync(fd);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
/** `--kebab-flag value` pairs into camelCase keys; `--steer` alone is a
 *  boolean; anything else is a usage error the caller reports. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--steer') { opts.steer = true; continue; }
    if (!a.startsWith('--')) return { error: `unexpected argument ${a}` };
    const v = rest[i + 1];
    if (v === undefined) return { error: `${a} needs a value` };
    i++;
    opts[a.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = v;
  }
  return { cmd, opts };
}

const REQUIRED_CARD = ['transcript', 'cwd', 'graph', 'labels', 'out', 'set', 'maxChars', 'maxFiles', 'built', 'fresh', 'scope', 'at', 'nonce'];

function usage(msg) {
  process.stderr.write(`compact-card: ${msg}\n`);
  return EXIT.USAGE;
}

export function main(argv) {
  const p = parseArgs(argv);
  if (p.error) return usage(p.error);
  if (!p.cmd) return usage('no subcommand (card | measure)');
  const o = p.opts;
  try {
    if (p.cmd === 'card') {
      for (const k of REQUIRED_CARD) if (!(k in o)) return usage(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required`);
      if (o.scope !== 'main' && o.scope !== 'subagent') return usage('--scope must be main or subagent');
      const maxChars = Number(o.maxChars), maxFiles = Number(o.maxFiles), at = Number(o.at);
      if (!Number.isInteger(maxChars) || maxChars <= 0) return usage('--max-chars must be a positive integer');
      if (!Number.isInteger(maxFiles) || maxFiles <= 0) return usage('--max-files must be a positive integer');
      if (!Number.isInteger(at) || at <= 0) return usage('--at must be epoch milliseconds');
      if (typeof o.nonce !== 'string' || o.nonce === '') return usage('--nonce must be a nonempty string');
      return cardCommand({ transcript: o.transcript, cwd: o.cwd, graph: o.graph, labels: o.labels,
        out: o.out, set: o.set, maxChars, maxFiles, built: o.built, fresh: o.fresh,
        scope: o.scope, agent: o.agent ?? null, at, nonce: o.nonce });
    }
    if (p.cmd === 'measure') {
      if (o.trigger !== 'auto' && o.trigger !== 'manual') return usage('--trigger must be auto or manual');
      const raw = readFileSync(0, 'utf8');
      const set = readSetForMeasure(o.set);
      process.stdout.write(JSON.stringify(measureCommand(raw, set, o.trigger)) + '\n');
      return EXIT.OK;
    }
    return usage(`unknown subcommand ${p.cmd}`);
  } catch (e) {
    process.stderr.write(`compact-card: ${e && e.message ? e.message : String(e)}\n`);
    return EXIT.FAILURE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
```

(`cardCommand` is Task 5's; `measureCommand` and `readSetForMeasure` are Task 8's; each task inserts its functions ABOVE the `// ── CLI` marker. Until they exist, `card`/`measure` with valid flags throw a ReferenceError inside the `try` and exit 1 — a state no test in Tasks 3–4 exercises.)

- [ ] **Step 4: The declaration sibling**

```ts
// ccd/compact-card.d.mts — types for the vitest import of compact-card.mjs
// (the `shared/mark.d.mts` precedent). Hand-written; grows with each task.
export const EXIT: Readonly<{ OK: 0; FAILURE: 1; USAGE: 2; EMPTY: 3 }>;
export const WINDOW_CAP: number;
export const CHUNK: number;
export interface WindowResult { text: string; boundary: boolean }
export function isBoundaryLine(line: string): boolean;
export function readWindow(path: string, cap?: number, chunkSize?: number): WindowResult;
export function parseArgs(argv: string[]):
  { cmd: string | undefined; opts: Record<string, string | true>; error?: undefined } | { error: string; cmd?: undefined; opts?: undefined };
export function main(argv: string[]): number;
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: PASS — every test in the file.

- [ ] **Step 6: Mutation checks** (in an isolated disposable copy, mutate `ccd/compact-card.mjs`, run the file, and see the case red)

1. In `readWindow`, replace `if (line && isBoundaryLine(line.text))` with `if (line)` → `a "compact_boundary" literal that is NOT the harness row` goes red (the decoy becomes the window's start).
2. Replace `carry = chunk.subarray(…)` with `carry = Buffer.alloc(0)` → `a boundary whose needle STRADDLES a chunk edge` goes red (the needle is split across two chunks and matched in neither; the window falls back to the whole file).
3. Delete the realign lines (`const nl = …; buf = nl >= 0 ? …`) → the `REALIGNED` test's `JSON.parse` loop goes red.

- [ ] **Step 7: Typecheck the tests and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: PASS (the `.d.mts` sibling types the import).

```bash
git add ccd/compact-card.mjs ccd/compact-card.d.mts server/test/compact-card.test.ts
git commit -m "feat(compact-card): the helper's skeleton — exit codes, the CLI, and the transcript window found by a backwards scan with a confirmed boundary"
```

---

### Task 4: Mining, resolution and the working set (spec §3.2 "Mining", "Resolution", "Ranking", "Two populations")

**Files:**
- Modify: `ccd/compact-card.mjs` (insert above the `// ── CLI` marker), `ccd/compact-card.d.mts`
- Test: `server/test/compact-card.test.ts`

**Interfaces:**
- Produces: `TAGS`, `WORKSET_CAP` (100), `extensionsOf(files)` → string[] longest-first, `tokenRegex(exts)` → RegExp | null, `mineTokens(windowText, re)` → `{token, tag}[]`, `fileIndex(files)` → `{files: Set, byBase: Map<basename, string[]>}` — the index that makes resolution O(tokens), never a scan of the file set per token, `resolveToken(token, index, cwd)` → `{path}` | `{reason}`, `workingSet(tokens, index, cwd, cap?)` → `{files: {path, tag, count}[], stats}`.

- [ ] **Step 1: Write the failing tests** (append to `server/test/compact-card.test.ts`; extend the import line with `extensionsOf, tokenRegex, mineTokens, fileIndex, resolveToken, workingSet, WORKSET_CAP`)

```ts
describe('mining — the working set out of the window (spec §3.2)', () => {
  const re = tokenRegex(['ts', 'sh', 'md']);

  it('tags Edit/Write/MultiEdit/NotebookEdit edited, Read touched, Bash tokens touched, the previous summary carried; skips lines that do not parse', () => {
    const win = [
      tl.toolUse('Edit', { file_path: '/w/server/src/a.ts', old_string: 'x', new_string: 'y' }),
      tl.toolUse('Write', { file_path: '/w/b.ts', content: '' }),
      tl.toolUse('MultiEdit', { file_path: '/w/m.ts', edits: [] }),
      tl.toolUse('NotebookEdit', { notebook_path: '/w/n.ipynb' }),
      tl.toolUse('Read', { file_path: '/w/c.ts' }),
      tl.toolUse('Bash', { command: 'sed -n 1,5p server/src/d.ts && cat -n ccd/e.sh | head' }),
      tl.summary('touched docs/f.md and server/src/a.ts; not g.tsz'),
      tl.toolUse('Grep', { pattern: 'x', path: 'server/src/z.ts' }),   // not a mined tool
      'not json at all',
    ].join('\n');
    expect(mineTokens(win, re)).toEqual([
      { token: '/w/server/src/a.ts', tag: 'edited' }, { token: '/w/b.ts', tag: 'edited' },
      { token: '/w/m.ts', tag: 'edited' }, { token: '/w/n.ipynb', tag: 'edited' },
      { token: '/w/c.ts', tag: 'touched' },
      { token: 'server/src/d.ts', tag: 'touched' }, { token: 'ccd/e.sh', tag: 'touched' },
      { token: 'docs/f.md', tag: 'carried' }, { token: 'server/src/a.ts', tag: 'carried' },
    ]);
  });

  it('a summary whose content is an array of text blocks is mined too, and a null regex mines only Edit/Read', () => {
    const arr = JSON.stringify({ type: 'user', isCompactSummary: true,
      message: { role: 'user', content: [{ type: 'text', text: 'see docs/f.md' }] } });
    expect(mineTokens(arr, re)).toEqual([{ token: 'docs/f.md', tag: 'carried' }]);
    const win = [tl.toolUse('Read', { file_path: '/w/c' }), tl.toolUse('Bash', { command: 'cat a.ts' })].join('\n');
    expect(mineTokens(win, null)).toEqual([{ token: '/w/c', tag: 'touched' }]);
  });

  it('the token regex is DERIVED from the graph\'s own extensions, longest first, anchored on both sides', () => {
    expect(extensionsOf(['a/b.ts', 'c.tsx', 'ccd/ccd', 'x.d.mts', '.hidden', 'noext.'])).toEqual(['mts', 'tsx', 'ts']);
    expect(tokenRegex([])).toBeNull();
    expect('run foo.tsx and bar.ts, not baz.tsz nor _qux.ts_'.match(tokenRegex(['tsx', 'ts'])!)).toEqual(['foo.tsx', 'bar.ts']);
    expect('a c++ file x.c+ and y.c'.match(tokenRegex(['c+', 'c'])!)).toEqual(['x.c+', 'y.c']);   // escaped
  });
});

describe('resolution — against the graph\'s own files (spec §3.2)', () => {
  const files = fileIndex(['server/src/pane/statusline.ts', 'server/src/watch.ts', 'pwa/src/watch.ts', 'ccd/ccd']);

  it('the index groups files by basename — the shape that keeps resolution O(tokens)', () => {
    expect(files.byBase.get('watch.ts')).toEqual(['server/src/watch.ts', 'pwa/src/watch.ts']);
    expect(files.byBase.get('ccd')).toEqual(['ccd/ccd']);
    expect(files.files.size).toBe(4);
  });

  it('strips the cwd and ./, matches exactly, then by a UNIQUE path-segment suffix', () => {
    expect(resolveToken('/w/server/src/watch.ts', files, '/w')).toEqual({ path: 'server/src/watch.ts' });
    expect(resolveToken('./server/src/watch.ts', files, '/w')).toEqual({ path: 'server/src/watch.ts' });
    expect(resolveToken('pane/statusline.ts', files, '/w')).toEqual({ path: 'server/src/pane/statusline.ts' });
    expect(resolveToken('ccd/ccd', files, '/w')).toEqual({ path: 'ccd/ccd' });
  });
  it('two suffix matches are AMBIGUOUS, never a guess', () => {
    expect(resolveToken('watch.ts', files, '/w')).toEqual({ reason: 'ambiguous' });
  });
  it('an absolute path outside the tree is OUTSIDE; an unknown path is NOMATCH', () => {
    expect(resolveToken('/etc/hosts.ts', files, '/w')).toEqual({ reason: 'outside' });
    expect(resolveToken('server/src/nope.ts', files, '/w')).toEqual({ reason: 'nomatch' });
    expect(resolveToken('/w', files, '/w')).toEqual({ reason: 'nomatch' });
  });
  it('a segment boundary is required — statusline.ts does not match xstatusline.ts', () => {
    expect(resolveToken('statusline.ts', fileIndex(['a/xstatusline.ts']), '/w')).toEqual({ reason: 'nomatch' });
  });
});

describe('the working set — ranked, counted, capped (spec §3.2)', () => {
  const files = fileIndex(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  it('ranks edited > touched > carried, then by count, then path; the strongest tag wins for a file', () => {
    const tokens = [
      { token: 'c.ts', tag: 'carried' as const }, { token: 'c.ts', tag: 'touched' as const },
      { token: 'b.ts', tag: 'touched' as const }, { token: 'b.ts', tag: 'touched' as const },
      { token: 'a.ts', tag: 'edited' as const }, { token: 'd.ts', tag: 'carried' as const },
      { token: '/x/out.ts', tag: 'touched' as const }, { token: 'zz.ts', tag: 'touched' as const },
    ];
    const { files: ws, stats } = workingSet(tokens, files, '/w');
    expect(ws).toEqual([
      { path: 'a.ts', tag: 'edited', count: 1 }, { path: 'b.ts', tag: 'touched', count: 2 },
      { path: 'c.ts', tag: 'touched', count: 2 }, { path: 'd.ts', tag: 'carried', count: 1 },
    ]);
    expect(stats).toEqual({ tokens: 8, resolved: 6, ambiguous: 0, outside: 1, nomatch: 1 });
  });
  it('the set keeps at most WORKSET_CAP files', () => {
    const many = fileIndex(Array.from({ length: 150 }, (_, i) => `f${i}.ts`));
    const tokens = [...many.files].map((t) => ({ token: t, tag: 'touched' as const }));
    expect(workingSet(tokens, many, '/w').files).toHaveLength(WORKSET_CAP);
    expect(WORKSET_CAP).toBe(100);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: FAIL — `extensionsOf`, `tokenRegex`, `mineTokens`, `resolveToken`, `workingSet` are not exported.

- [ ] **Step 3: The mining and resolution code** — insert in `ccd/compact-card.mjs` above `// ── CLI`

```js
// ── MINING (spec §3.2) ───────────────────────────────────────────────────
/** Ranked tags, strongest first. */
export const TAGS = Object.freeze(['edited', 'touched', 'carried']);
const TAG_RANK = { edited: 0, touched: 1, carried: 2 };
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** The working set is capped here; the card prints the first `--max-files`
 *  of it (two populations, spec §3.2). */
export const WORKSET_CAP = 100;

/** Every extension the graph's own files carry, longest first then
 *  alphabetical — DERIVED, never typed. Files with no extension (`ccd/ccd`)
 *  cannot be mined from shell text: a stated limitation, not a bug. */
export function extensionsOf(files) {
  const exts = new Set();
  for (const f of files) {
    const b = basename(f);
    const i = b.lastIndexOf('.');
    if (i > 0 && i < b.length - 1) exts.add(b.slice(i + 1));
  }
  return [...exts].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** `[A-Za-z0-9_./-]+\.(<ext>)`, anchored on both sides so `baz.tsz` and a
 *  mid-word start never match; null when the graph names no extension. */
export function tokenRegex(exts) {
  if (exts.length === 0) return null;
  const alt = exts.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![A-Za-z0-9_./-])[A-Za-z0-9_./-]+\\.(?:${alt})(?![A-Za-z0-9_])`, 'g');
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
  return '';
};

/** Raw path tokens out of a window, one row per occurrence (the mining table
 *  of spec §3.2): Edit-shaped tools' `file_path`/`notebook_path` → edited;
 *  `Read`'s `file_path` → touched; regex hits in a `Bash` command → touched;
 *  regex hits in the previous compaction's summary → carried. A line that
 *  does not parse is skipped, never fatal. */
export function mineTokens(windowText, re) {
  const out = [];
  for (const line of windowText.split('\n')) {
    if (line === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o === null || typeof o !== 'object') continue;
    const msg = o.message;
    if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item || item.type !== 'tool_use' || !item.input || typeof item.input !== 'object') continue;
        const inp = item.input;
        if (EDIT_TOOLS.has(item.name)) {
          const p = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
          if (typeof p === 'string' && p !== '') out.push({ token: p, tag: 'edited' });
        } else if (item.name === 'Read') {
          if (typeof inp.file_path === 'string' && inp.file_path !== '') out.push({ token: inp.file_path, tag: 'touched' });
        } else if (item.name === 'Bash' && re && typeof inp.command === 'string') {
          for (const m of inp.command.matchAll(re)) out.push({ token: m[0], tag: 'touched' });
        }
      }
    } else if (o.isCompactSummary === true && msg && re) {
      for (const m of textOf(msg.content).matchAll(re)) out.push({ token: m[0], tag: 'carried' });
    }
  }
  return out;
}

// ── RESOLUTION (spec §3.2) ───────────────────────────────────────────────
/** The graph's `source_file` set, indexed by basename. A suffix match can
 *  only ever hit a file with the token's own basename, so the candidates for
 *  a token are one Map lookup — O(tokens) for the whole window, never a scan
 *  of every file per token (the review measured that scan at 2–12 s on a
 *  64 MiB window against a 5,000-file graph). */
export function fileIndex(files) {
  const set = new Set(files);
  const byBase = new Map();
  for (const f of set) {
    const b = basename(f);
    const list = byBase.get(b);
    if (list) list.push(f); else byBase.set(b, [f]);
  }
  return { files: set, byBase };
}

/** One token against the index: strip a leading `<cwd>/` or `./`; exact
 *  match first; else a suffix match on a path-segment boundary that is UNIQUE
 *  in the set. Two or more → `ambiguous`; an absolute path outside `<cwd>` →
 *  `outside`; none → `nomatch`. */
export function resolveToken(token, index, cwd) {
  let t = token;
  if (cwd && (t === cwd || t.startsWith(cwd + '/'))) t = t.slice(cwd.length + 1);
  if (t.startsWith('/')) return { reason: 'outside' };
  while (t.startsWith('./')) t = t.slice(2);
  if (t === '') return { reason: 'nomatch' };
  if (index.files.has(t)) return { path: t };
  const suffix = '/' + t;
  const hits = (index.byBase.get(basename(t)) ?? []).filter((f) => f.endsWith(suffix));
  if (hits.length === 1) return { path: hits[0] };
  return { reason: hits.length > 1 ? 'ambiguous' : 'nomatch' };
}

/** The working set: every resolved file, the strongest tag it earned, its
 *  occurrence count; ranked edited > touched > carried, then count, then
 *  path; capped. `stats` is what tells a thin card from a thin session. */
export function workingSet(tokens, index, cwd, cap = WORKSET_CAP) {
  const stats = { tokens: tokens.length, resolved: 0, ambiguous: 0, outside: 0, nomatch: 0 };
  const acc = new Map();
  for (const { token, tag } of tokens) {
    const r = resolveToken(token, index, cwd);
    if (!r.path) { stats[r.reason]++; continue; }
    stats.resolved++;
    const cur = acc.get(r.path);
    if (!cur) acc.set(r.path, { path: r.path, tag, count: 1 });
    else { cur.count++; if (TAG_RANK[tag] < TAG_RANK[cur.tag]) cur.tag = tag; }
  }
  const ranked = [...acc.values()].sort((a, b) =>
    TAG_RANK[a.tag] - TAG_RANK[b.tag] || b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: ranked.slice(0, cap), stats };
}
```

Append to `ccd/compact-card.d.mts`:

```ts
export type Tag = 'edited' | 'touched' | 'carried';
export const TAGS: readonly Tag[];
export const WORKSET_CAP: number;
export interface Token { token: string; tag: Tag }
export interface SetFile { path: string; tag: Tag; count: number }
export interface SetStats { tokens: number; resolved: number; ambiguous: number; outside: number; nomatch: number }
export function extensionsOf(files: Iterable<string>): string[];
export function tokenRegex(exts: string[]): RegExp | null;
export function mineTokens(windowText: string, re: RegExp | null): Token[];
export interface FileIndex { files: Set<string>; byBase: Map<string, string[]> }
export function fileIndex(files: Iterable<string>): FileIndex;
export function resolveToken(token: string, index: FileIndex, cwd: string):
  { path: string; reason?: undefined } | { reason: 'outside' | 'ambiguous' | 'nomatch'; path?: undefined };
export function workingSet(tokens: Token[], index: FileIndex, cwd: string, cap?: number): { files: SetFile[]; stats: SetStats };
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: PASS — every test in the file.

- [ ] **Step 5: Mutation checks**

1. In `resolveToken`, change `if (hits.length === 1)` to `if (hits.length >= 1)` → `two suffix matches are AMBIGUOUS` goes red; replace the `byBase` lookup with a scan of `index.files` → the index test still passes but the resolution tests do too — record that the index's SHAPE is pinned by its own test and its cost by Task 6's measurement, not by a red here.
2. In `tokenRegex`, drop the `(?<![A-Za-z0-9_./-])` lookbehind → the `_qux.ts_`/`baz.tsz` expectations go red.
3. In `workingSet`, drop `|| b.count - a.count` → the ranking test goes red (b/c order).
4. In `mineTokens`, remove the `isCompactSummary` branch → the first mining test's `carried` rows go red.

- [ ] **Step 6: Commit**

```bash
git add ccd/compact-card.mjs ccd/compact-card.d.mts server/test/compact-card.test.ts
git commit -m "feat(compact-card): mine the window for edited/touched/carried files and resolve them against the graph's own file set — ambiguity is counted, never guessed"
```

---

### Task 5: The graph, the card, the two files, the exit codes (spec §3.2 "The card", "Truncation", "Files")

**Files:**
- Modify: `ccd/compact-card.mjs` (insert above `// ── CLI`), `ccd/compact-card.d.mts`
- Test: `server/test/compact-card.test.ts`

**Interfaces:**
- Produces: `GRAPH_MAX_BYTES` (96 MiB), `loadGraph(path, maxBytes?)` → `{nodes: Map, byFile: Map, files: Set, index: FileIndex, links, degree: Map}` (throws `too large` above the cap, before parsing), `loadLabels(path)` → object (empty on absence), `fileFacts(file, graph, labels, workset: Set)` → `{community, symbols, usedBy}`, `renderCard(set, graph, labels, {maxChars, maxFiles, built, fresh, scope, agent})` → string, `slotIsMine(setPath, nonce)` → the set on disk only when its collision-resistant `nonce` is ours, else null, `cardCommand(o)` → exit code; Task 9's final future writer shape is `{v, at, nonce, scope, agent, transcript, parentLive, liveAgents, cwd, built, fresh, steered, files, stats}` and keeps numeric `at`, then `nonce`, then `transcript` before `files` (the hook reads the head of the file, Task 7). It stages the rendered card before its first target write, rechecks nonce ownership immediately before each target write, and rolls back an after-set failure only while its nonce still owns the slot. `parentLive`/`liveAgents` are carried from the hook's set, and `steered` is always `false` here (the hook stamps it, Plan C); `served` is marker-derived only in the final journal record, although Task 9 may tolerate legacy measure input.

- [ ] **Step 1: Write the failing tests** (append; extend the import with `GRAPH_MAX_BYTES, loadGraph, loadLabels, fileFacts, renderCard, slotIsMine, cardCommand`)

```ts
describe('the card from the graph (spec §3.2)', () => {
  const plant = (): { graph: string; labels: string } => ({
    graph: write('graphify-out/graph.json', graphJson(GRAPH, 'deadbeefcafe')),
    labels: write('graphify-out/.graphify_labels.json', JSON.stringify(GRAPH.labels)),
  });
  const FOOTER = 'Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.';

  it('loadGraph reads node-link JSON: nodes by id and by file, the edges under `links`, degree per node, the basename index; refuses an oversized file before parsing', () => {
    const { graph } = plant();
    const g = loadGraph(graph);
    expect(g.files.size).toBe(12);
    expect(g.index.byBase.get('watch.ts')).toEqual(['server/src/watch.ts']);
    expect(g.byFile.get('server/src/pane/statusline.ts')!.map((n) => n.id)).toEqual(['f_statusline', 'parseStatusline', 'parseCtxPct']);
    expect(g.degree.get('parseStatusline')).toBe(2);   // contains + calls
    expect(g.degree.get('s1')).toBe(5);                // contains + 4 calls
    expect(g.degree.get('f_hook')).toBe(0);
    expect(() => loadGraph(write('bad.json', '{"nodes": 3}'))).toThrow(/nodes\/links/);
    expect(() => loadGraph(graph, 100)).toThrow(/too large/);
    expect(GRAPH_MAX_BYTES).toBe(96 * 1024 * 1024);
    expect(loadLabels(path.join(dir, 'absent.json'))).toEqual({});
  });

  it('fileFacts: the community label, top FIVE symbols by degree, the top three dependents OUTSIDE the working set with the rest counted', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const ws = new Set(['server/src/pane/statusline.ts', 'server/src/watch.ts']);
    expect(fileFacts('server/src/pane/statusline.ts', g, l, ws)).toEqual({
      community: 'watch.ts', symbols: ['parseCtxPct:L105', 'parseStatusline:L132'], usedBy: ['server/src/fleet.ts'] });
    // watch.ts is IN the set, so its imports_from/calls into statusline.ts are not "outside"
    expect(fileFacts('server/src/pane/statusline.ts', g, l, new Set(['server/src/pane/statusline.ts'])).usedBy)
      .toEqual(['server/src/watch.ts', 'server/src/fleet.ts']);    // watch.ts carries 2 links (calls + imports_from), fleet.ts 1
    expect(fileFacts('ccd/session-hook.sh', g, l, ws)).toEqual({ community: null, symbols: [], usedBy: [] });
    // six symbols → five, by degree then label; four dependents, by link count then path
    expect(fileFacts('server/src/big.ts', g, l, new Set(['server/src/big.ts']))).toEqual({
      community: 'big.ts', symbols: ['s1:L10', 's2:L20', 's3:L30', 's4:L40', 's5:L50'],
      usedBy: ['server/src/d1.ts', 'server/src/d2.ts', 'server/src/d3.ts', 'server/src/d4.ts'] });
    // no `metadata.kind`, no L1 node named after the file: the top-degree node stands in
    expect(fileFacts('shared/api.ts', g, l, new Set(['shared/api.ts']))).toEqual({
      community: 'api.ts', symbols: ['FLEET_PROTO:L5'], usedBy: ['pwa/src/session/ModelSheet.tsx', 'server/src/fleet.ts'] });
  });

  it('renders the card: header with the graph commit and freshness, one line per file, blast radius, the footer', () => {
    const { graph, labels } = plant();
    const set = { v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'deadbeefcafe',
      fresh: 'fresh', steered: false, stats: null,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'edited', count: 3 }, { path: 'server/src/watch.ts', tag: 'touched', count: 1 }] };
    const text = renderCard(set as any, loadGraph(graph), loadLabels(labels), { maxChars: 4000, maxFiles: 12, built: 'deadbeefcafe', fresh: 'fresh', scope: 'main', agent: null });
    expect(text.split('\n')).toEqual([
      'graphify card — this context\'s working set at compaction, from graphify-out/ (built at deadbeef, fresh):',
      '- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseCtxPct:L105 parseStatusline:L132 · used by server/src/fleet.ts',
      '- server/src/watch.ts [touched] · community "watch.ts" · symbols sweepMail:L40',
      'Blast radius: 1 file imports or calls something in these 2 files.',
      FOOTER,
    ]);
    const sub = renderCard(set as any, loadGraph(graph), loadLabels(labels), { maxChars: 4000, maxFiles: 12, built: '', fresh: '', scope: 'subagent', agent: 'a43142b934b4bf501' });
    expect(sub.split('\n')[0]).toBe('graphify card — this context\'s working set at compaction (subagent a43142b934b4bf501), from graphify-out/ (built at unknown):');
  });

  it('truncation drops WHOLE files from the bottom and always says how many were not shown', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const files = [...g.files].sort().map((p) => ({ path: p, tag: 'touched' as const, count: 1 }));
    const set = { v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null, files };
    const o = { built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null };
    const full = renderCard(set as any, g, l, { maxChars: 4000, maxFiles: 12, ...o });
    expect(full).not.toContain('files not shown');
    const capped = renderCard(set as any, g, l, { maxChars: 4000, maxFiles: 2, ...o });
    expect(capped).toContain('(+10 files not shown)');
    expect(capped.split('\n').filter((x) => x.startsWith('- '))).toHaveLength(2);
    const tight = renderCard(set as any, g, l, { maxChars: 420, maxFiles: 12, ...o });
    expect(tight.length).toBeLessThanOrEqual(420);
    expect(tight).toMatch(/\(\+\d+ files not shown\)/);
    for (const line of tight.split('\n')) expect(line.endsWith('·')).toBe(false);   // never mid-line
    expect(tight).toContain(FOOTER);
  });

  it('when one file still overflows, its `used by` list collapses to its count — never mid-line', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const set = { v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null,
      files: [{ path: 'server/src/big.ts', tag: 'edited' as const, count: 1 }] };
    const o = { built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, maxFiles: 12 };
    const full = renderCard(set as any, g, l, { maxChars: 4000, ...o });
    expect(full).toContain('· used by server/src/d1.ts server/src/d2.ts server/src/d3.ts (+1)');
    const collapsed = renderCard(set as any, g, l, { maxChars: full.length - 1, ...o });
    expect(collapsed).toMatch(/· used by \(\+4\)$/m);
    expect(collapsed).not.toContain('server/src/d1.ts');
    expect(collapsed.length).toBeLessThan(full.length);
  });

  /** The set the HOOK writes before the helper runs (Task 2's shape): the
   *  slot the helper must find its own `nonce` in, and the fields it carries. */
  const hookSet = (set: string, at: number, nonce = `nonce-${at}`, extra: object = {}): void =>
    fs.writeFileSync(set, JSON.stringify({ v: 1, at, nonce, scope: 'main', agent: null, transcript: '/t', parentLive: null, liveAgents: 0,
      cwd: dir, built: null, fresh: null, steered: false, served: false, files: null, stats: null, ...extra }) + '\n');

  it('cardCommand rewrites the hook\'s set and writes the card, `at`, `nonce`, and `transcript` before `files`, the hook\'s fields carried, and exits 0', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', [
      tl.toolUse('Read', { file_path: path.join(dir, 'server/src/pane/statusline.ts') }),
      tl.boundary(),
      tl.toolUse('Edit', { file_path: path.join(dir, 'server/src/pane/statusline.ts') }),
      tl.toolUse('Bash', { command: 'sed -n 1,40p server/src/watch.ts; cat /etc/passwd.ts' }),
      tl.summary('carried pwa/src/lib/models.ts'),
    ].join('\n') + '\n');
    const out = path.join(dir, 'reg', 'x.compactcard'), set = path.join(dir, 'reg', 'x.compactset');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1789330000000, 'nonce-a1', { scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1 });
    const rc = cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'deadbeefcafe', fresh: 'fresh', scope: 'subagent', agent: 'a1', at: 1789330000000, nonce: 'nonce-a1' });
    expect(rc).toBe(EXIT.OK);
    const s = JSON.parse(fs.readFileSync(set, 'utf8'));
    expect(Object.keys(s)).toEqual(['v', 'at', 'nonce', 'scope', 'agent', 'transcript', 'parentLive', 'liveAgents', 'cwd', 'built', 'fresh', 'steered', 'served', 'files', 'stats']);
    expect(s).toMatchObject({ v: 1, at: 1789330000000, nonce: 'nonce-a1', scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1,
      cwd: dir, built: 'deadbeefcafe', fresh: 'fresh', steered: false, served: false,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'edited', count: 1 },
              { path: 'server/src/watch.ts', tag: 'touched', count: 1 },
              { path: 'pwa/src/lib/models.ts', tag: 'carried', count: 1 }],
      stats: { tokens: 4, resolved: 3, ambiguous: 0, outside: 1, nomatch: 0 } });
    const card = fs.readFileSync(out, 'utf8').split('\n');
    expect(card[0]).toBe('nonce-a1');
    expect(card[1]).toContain('(subagent a1)');
    expect(card[2]).toBe('- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseCtxPct:L105 parseStatusline:L132 · used by server/src/fleet.ts');
    expect(fs.readdirSync(path.join(dir, 'reg')).sort()).toEqual(['x.compactcard', 'x.compactset']);   // no temp left
  });

  it('THE SLOT CHECK: a newer owner with the same `at` but another nonce, or no set at all, is refused — exit 1, nothing written', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    const args = { transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, at: 7, nonce: 'older-nonce' };
    expect(() => cardCommand(args)).toThrow(/slot/);                 // no set: the hook always writes one first
    hookSet(set, 7, 'newer-nonce', { scope: 'ambiguous', transcript: null }); // same ms, later owner
    const before = fs.readFileSync(set, 'utf8');
    expect(() => cardCommand(args)).toThrow(/slot/);
    expect(fs.readFileSync(set, 'utf8')).toBe(before);
    expect(fs.existsSync(out)).toBe(false);
    expect(slotIsMine(set, 'newer-nonce')).not.toBeNull();
    expect(slotIsMine(set, 'older-nonce')).toBeNull();
    expect(slotIsMine(path.join(dir, 'absent'), 'older-nonce')).toBeNull();
  });

  it('an empty working set writes the set with files [] and NO card, exit 3', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.user('hello') + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    expect(cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: '', fresh: '', scope: 'main', agent: null, at: 1, nonce: 'nonce-1' })).toBe(EXIT.EMPTY);
    expect(JSON.parse(fs.readFileSync(set, 'utf8'))).toMatchObject({ files: [], built: null, fresh: null, stats: { tokens: 0 }, steered: false, served: false });
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a write that cannot complete leaves no temp behind', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset');
    fs.mkdirSync(path.join(dir, 'reg'));
    const out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(out);                                                  // a DIRECTORY at the card's name: the rename fails
    hookSet(set, 1);
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'nonce-1' })).toThrow();
    expect(fs.readdirSync(path.join(dir, 'reg')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('as the hook runs it: exit 0 with nothing on stdout; a malformed graph is exit 1 with nothing rewritten; --steer is accepted and changes nothing', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    const args = ['card', '--transcript', transcript, '--cwd', dir, '--graph', graph, '--labels', labels,
      '--out', out, '--set', set, '--max-chars', '4000', '--max-files', '12', '--built', 'b', '--fresh', 'fresh', '--scope', 'main', '--at', '1', '--nonce', 'nonce-1'];
    const ok = helper(args);
    expect(ok).toEqual({ status: EXIT.OK, stdout: '', stderr: '' });
    fs.rmSync(out); hookSet(set, 1);
    expect(helper([...args, '--steer']).status).toBe(EXIT.OK);
    expect(JSON.parse(fs.readFileSync(set, 'utf8')).steered).toBe(false);
    fs.rmSync(out); hookSet(set, 1);
    fs.writeFileSync(graph, '{not json');
    const bad = helper(args);
    expect(bad.status).toBe(EXIT.FAILURE);
    expect(bad.stdout).toBe('');
    expect(JSON.parse(fs.readFileSync(set, 'utf8')).files, 'a failure rewrites nothing').toBeNull();
    expect(helper([...args, '--scope', 'nope']).status).toBe(EXIT.USAGE);
    expect(helper([...args, '--at', 'soon']).status).toBe(EXIT.USAGE);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: FAIL — `loadGraph` and friends are not exported.

- [ ] **Step 3: The graph, the card and the command** — insert above `// ── CLI`

```js
// ── THE GRAPH (spec §3.2) ────────────────────────────────────────────────
/** graph.json is networkx node-link JSON (measured on this repo's 0.9.9
 *  graph: 8,914 nodes, 17,452 links, 13 relations): `nodes[]` carry `id`,
 *  `label`, `source_file`, `source_location` (`L<n>`), `community`; the edges
 *  are under `links[]` as `{source, target, relation, …}`. `built_at_commit`
 *  is the LAST key — a duplicate at the head is the decoy `plantGraph` plants
 *  for the hook's tail read, and JSON.parse takes the last. Parsed ONCE per
 *  run: 0.13–0.18 s at 9 MB, measured. */
/** A graph.json larger than this is not parsed: node's peak RSS runs about
 *  five times the file (measured 249 MB at 51 MB), on a box that runs ~20
 *  sessions under a memory.high cgroup. The 70 MB MekWarLive graph passes. */
export const GRAPH_MAX_BYTES = 96 * 1024 * 1024;

export function loadGraph(graphPath, maxBytes = GRAPH_MAX_BYTES) {
  const size = statSync(graphPath).size;
  if (size > maxBytes) throw new Error(`graph.json: too large (${size} bytes over ${maxBytes})`);
  const g = JSON.parse(readFileSync(graphPath, 'utf8'));
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('graph.json: no nodes/links arrays');
  const nodes = new Map(), byFile = new Map(), files = new Set(), degree = new Map();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.source_file !== 'string') continue;
    nodes.set(n.id, n);
    files.add(n.source_file);
    const list = byFile.get(n.source_file);
    if (list) list.push(n); else byFile.set(n.source_file, [n]);
    degree.set(n.id, 0);
  }
  const links = [];
  for (const l of g.links) {
    if (!l || typeof l.source !== 'string' || typeof l.target !== 'string') continue;
    links.push(l);
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  return { nodes, byFile, files, index: fileIndex(files), links, degree };
}

/** `.graphify_labels.json` is `{"<community>": "<label>"}`. Absent or
 *  malformed → `{}`: every community clause is then omitted, which is what
 *  the spec says for a file "absent from it". */
export function loadLabels(labelsPath) {
  try {
    const o = JSON.parse(readFileSync(labelsPath, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** The link relations that mean "depends on" (spec §3.2 `used by`). */
const DEPENDS = new Set(['imports', 'imports_from', 'calls', 'references', 'indirect_call']);
const lineOf = (n) => { const m = /^L(\d+)$/.exec(String(n.source_location ?? '')); return m ? m[1] : null; };
const isFileNode = (n, file) =>
  (n.metadata && n.metadata.kind === 'file') || (n.source_location === 'L1' && n.label === basename(file));

/** One file's facts: the community label of its file node; its top five
 *  symbols by total degree, as `label:L<line>`; the files OUTSIDE the working
 *  set that carry a depends-on link INTO any of its nodes, by link count then
 *  path. A dependent that is in the working set is not "outside". */
export function fileFacts(file, graph, labels, workset) {
  const nodes = graph.byFile.get(file) ?? [];
  const deg = (n) => graph.degree.get(n.id) ?? 0;
  const byDegree = (a, b) => deg(b) - deg(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const fileNode = nodes.find((n) => isFileNode(n, file)) ?? [...nodes].sort(byDegree)[0] ?? null;
  const community = fileNode && fileNode.community !== undefined ? labels[String(fileNode.community)] : undefined;
  const symbols = nodes.filter((n) => n !== fileNode).sort(byDegree).slice(0, 5)
    .map((n) => { const l = lineOf(n); return l ? `${n.label}:L${l}` : String(n.label); });
  const ids = new Set(nodes.map((n) => n.id));
  const dependents = new Map();
  for (const l of graph.links) {
    if (!DEPENDS.has(l.relation) || !ids.has(l.target)) continue;
    const src = graph.nodes.get(l.source);
    if (!src || src.source_file === file || workset.has(src.source_file)) continue;
    dependents.set(src.source_file, (dependents.get(src.source_file) ?? 0) + 1);
  }
  const usedBy = [...dependents.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[0]);
  return { community: typeof community === 'string' ? community : null, symbols, usedBy };
}

const FOOTER = 'Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.';

/** The card (spec §3.2): file-centric, one line per carded file, terse, no
 *  tables. Truncation drops WHOLE files from the bottom until the text fits,
 *  then collapses `used by` lists to their `(+n)`, never mid-line, and ALWAYS
 *  prints `(+k files not shown)` when anything was dropped — a short card must
 *  never read as a small working set (the prototype's `(not in graph)` meant
 *  both; this repo calls that an overloaded null). */
export function renderCard(set, graph, labels, opts) {
  const workset = new Set(set.files.map((f) => f.path));
  const facts = new Map(set.files.map((f) => [f.path, fileFacts(f.path, graph, labels, workset)]));
  const blast = new Set();
  for (const f of facts.values()) for (const d of f.usedBy) blast.add(d);
  const built = (opts.built || '').slice(0, 8) || 'unknown';
  const who = opts.scope === 'subagent' ? ` (subagent ${opts.agent ?? 'unknown'})` : '';
  const header = `graphify card — this context's working set at compaction${who}, from graphify-out/ (built at ${built}${opts.fresh ? ', ' + opts.fresh : ''}):`;
  const row = (f, collapsed) => {
    const x = facts.get(f.path);
    let s = `- ${f.path} [${f.tag}]`;
    if (x.community) s += ` · community "${x.community}"`;
    if (x.symbols.length) s += ` · symbols ${x.symbols.join(' ')}`;
    if (x.usedBy.length) {
      if (collapsed) s += ` · used by (+${x.usedBy.length})`;
      else {
        const shown = x.usedBy.slice(0, 3), rest = x.usedBy.length - shown.length;
        s += ` · used by ${shown.join(' ')}${rest > 0 ? ` (+${rest})` : ''}`;
      }
    }
    return s;
  };
  const assemble = (n, collapsed) => {
    const shown = set.files.slice(0, n);
    const lines = [header, ...shown.map((f) => row(f, collapsed))];
    const hidden = set.files.length - shown.length;
    if (hidden > 0) lines.push(`(+${hidden} files not shown)`);
    lines.push(`Blast radius: ${blast.size} ${blast.size === 1 ? 'file imports or calls' : 'files import or call'} something in these ${set.files.length} files.`);
    lines.push(FOOTER);
    return lines.join('\n');
  };
  let n = Math.min(opts.maxFiles, set.files.length);
  let text = assemble(n, false);
  while (text.length > opts.maxChars && n > 1) { n--; text = assemble(n, false); }
  if (text.length > opts.maxChars) text = assemble(n, true);
  return text;
}

// ── THE TWO FILES ────────────────────────────────────────────────────────
/** Dot-prefixed temp beside the target, then rename: the hook's own idiom.
 *  Nothing partial is ever left at the target's name. */
function writeAtomic(target, text) {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to remove */ }
    throw e;
  }
}

/** THE SLOT CHECK (spec §3.0, overlap). `at` measures epoch milliseconds;
 *  `nonce` owns the slot and card line 1. Retain the exact hook-written bytes
 *  so post-set failure can restore them only while this nonce still owns it. */
function ownedSlot(setPath, nonce) {
  try {
    const text = readFileSync(setPath, 'utf8');
    const set = JSON.parse(text);
    return set && typeof set === 'object' && typeof nonce === 'string' && nonce !== '' && set.nonce === nonce
      ? { set, text } : null;
  } catch {
    return null;
  }
}

export function slotIsMine(setPath, nonce) {
  return ownedSlot(setPath, nonce)?.set ?? null;
}

function rollbackCard(setPath, outPath, nonce, original, write) {
  if (slotIsMine(setPath, nonce)) {
    try { write(setPath, original); } catch { /* preserve the primary failure */ }
  }
  try {
    const card = readFileSync(outPath, 'utf8');
    if (card.slice(0, card.indexOf('\n')) === nonce) unlinkSync(outPath);
  } catch { /* no partial card, or another writer removed it */ }
}

/** `card`: window → tokens → staged card → set → card. It stages rendering
 *  before the first target write, rechecks nonce ownership immediately before
 *  each target write, and restores only safe owned output after card failure. */
export function cardCommand(o) {
  const graph = loadGraph(o.graph);
  const labels = loadLabels(o.labels);
  const win = readWindow(o.transcript);
  const re = tokenRegex(extensionsOf(graph.files));
  const tokens = mineTokens(win.text, re);
  const { files, stats } = workingSet(tokens, graph.index, o.cwd);
  const mine = ownedSlot(o.set, o.nonce);
  if (!mine) throw new Error(`set ${o.set} is no longer this helper's slot`);
  const set = { v: 1, at: o.at, nonce: o.nonce, scope: o.scope, agent: o.agent ?? null, transcript: o.transcript,
    parentLive: typeof mine.set.parentLive === 'boolean' ? mine.set.parentLive : null,
    liveAgents: Number.isInteger(mine.set.liveAgents) ? mine.set.liveAgents : null,
    cwd: o.cwd, built: o.built || null, fresh: o.fresh || null, steered: false, files, stats };
  const card = files.length === 0 ? null : `${o.nonce}\n${renderCard(set, graph, labels, {
    maxChars: o.maxChars, maxFiles: o.maxFiles, built: o.built, fresh: o.fresh,
    scope: o.scope, agent: o.agent ?? null })}\n`;
  const write = o.writeAtomic ?? writeAtomic;
  if (!slotIsMine(o.set, o.nonce)) throw new Error(`set ${o.set} changed hands before the set was written — slot taken`);
  write(o.set, JSON.stringify(set) + '\n');
  if (card === null) return EXIT.EMPTY;
  try {
    if (!slotIsMine(o.set, o.nonce)) throw new Error(`set ${o.set} changed hands before the card was written — slot taken`);
    write(o.out, card);
  } catch (error) {
    rollbackCard(o.set, o.out, o.nonce, mine.text, write);
    throw error;
  }
  return EXIT.OK;
}
```

Append to `ccd/compact-card.d.mts`:

```ts
export interface GraphNode { id: string; label: string; source_file: string; source_location?: string; community?: number; metadata?: { kind?: string } }
export interface GraphLink { source: string; target: string; relation: string }
export const GRAPH_MAX_BYTES: number;
export interface Graph { nodes: Map<string, GraphNode>; byFile: Map<string, GraphNode[]>; files: Set<string>; index: FileIndex; links: GraphLink[]; degree: Map<string, number> }
export function loadGraph(graphPath: string, maxBytes?: number): Graph;
export function loadLabels(labelsPath: string): Record<string, string>;
export interface FileFacts { community: string | null; symbols: string[]; usedBy: string[] }
export function fileFacts(file: string, graph: Graph, labels: Record<string, string>, workset: Set<string>): FileFacts;
export interface CompactSet {
  v: 1; at: number; nonce: string; scope: 'main' | 'subagent' | 'ambiguous'; agent: string | null; transcript: string | null;
  parentLive: boolean | null; liveAgents: number | null;
  cwd: string | null; built: string | null; fresh: string | null; steered: boolean;
  files: SetFile[] | null; stats: SetStats | null;
}
export function slotIsMine(setPath: string, nonce: string): CompactSet | null;
export function renderCard(set: CompactSet & { files: SetFile[] }, graph: Graph, labels: Record<string, string>,
  opts: { maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent'; agent: string | null }): string;
export function cardCommand(o: {
  transcript: string; cwd: string; graph: string; labels: string; out: string; set: string;
  maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent';
  agent: string | null; at: number; nonce: string;
  writeAtomic?: (target: string, text: string) => void;
}): number;
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: PASS — every test in the file.

- [ ] **Step 5: Mutation checks**

1. In `fileFacts`, delete `|| workset.has(src.source_file)` → the `dependents OUTSIDE the working set only` case goes red (watch.ts appears).
2. In `renderCard`, delete `if (hidden > 0) lines.push(…)` → both `files not shown` expectations go red.
3. In `loadGraph`, read `g.edges` instead of `g.links` → the `degree` expectations and the whole render go red (no links).
4. In `cardCommand`, move `writeAtomic(o.set, …)` below `if (files.length === 0) return EXIT.EMPTY;` → `an empty working set writes the set with files []` goes red.
5. In `cardCommand`, write `text + '\n'` instead of `` `${o.nonce}\n${text}\n` `` → the `card[0]` nonce assertion goes red; replace `at: o.at` with `at: Date.now()` → the set's numeric-`at` assertion goes red.
6. Delete the initial `ownedSlot` guard → `THE SLOT CHECK` goes red (the later nonce owner's set is overwritten). Delete the pre-set-write `slotIsMine` guard → the render-staging takeover test goes red (a write occurs). Delete the pre-card-write guard → the later-owner rollback test goes red when its artificial takeover reaches the card seam. Each recheck is behavior-pinned at its own seam.
7. In `writeAtomic`'s `catch`, delete the `unlinkSync(tmp)` → `a write that cannot complete leaves no temp behind` goes red.
8. In `loadGraph`, delete the `size > maxBytes` throw → the `too large` assertion goes red.
9. In `cardCommand`, write `steered: true` again → the `--steer is accepted and changes nothing` assertion goes red.

- [ ] **Step 6: Commit**

```bash
git add ccd/compact-card.mjs ccd/compact-card.d.mts server/test/compact-card.test.ts
git commit -m "feat(compact-card): the card from the graph — symbols, community, dependents outside the set, blast radius, whole-file truncation that always says what it dropped"
```

---
### Task 6: PreCompact runs the helper — the card with a graph, under the helper's declared wait (spec §3.1 steps 5–6, §6 R2)

> **Historical implementation task.** Its temporary-name examples document the completed pre-D-2605 commit. Task 9 replaces every such producer with the §3.4 target inventory before ordinary exact-family sweeping; only the explicitly listed, lock-held, age-gated legacy transition matcher may recognize an old residue.

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_compact_pre` (the helper call), the file header's contract sentence, the `COMPACT_HELPER_TIMEOUT` comment (the measured p95 and RSS)
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — PreCompact and the helper (spec §3.1)')`

**Interfaces:**
- Consumes: the helper CLI of Tasks 3–5 (`card` with `--at`), `_hook_gate_tree`, `GM_*`, `COMPACT_HELPER`, `COMPACT_HELPER_TIMEOUT`.
- Produces: after a PreCompact on a gated tree with an unambiguous scope, `$REG/<id>.compactcard` (line 1 = the set's `nonce`) and the helper-rewritten set. The hook records `at` only as numeric measurement, generates one nonce from it/PID/two random values, passes it as `--nonce`, and on every helper result other than 0 or 3 restores the exact hook document and removes only same-nonce output; later owners survive.

- [ ] **Step 1: Write the failing tests** (`minimalPath` and `stub` are Task 1's fixtures)

Append at the end of the file:

```ts
describe('the compaction card — PreCompact and the helper (spec §3.1)', () => {
  it('with a fresh graph and the helper, PreCompact writes the card (nonce first) and the mined set, and prints nothing', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    expect(runFull(preCompact(tree, transcript))).toEqual({ stdout: '', stderr: '' });
    const set = readSet();
    expect(set).toMatchObject({ scope: 'main', transcript, steered: false, served: false, parentLive: null, liveAgents: null,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'touched', count: 1 },
              { path: 'server/src/watch.ts', tag: 'touched', count: 1 }],
      stats: { tokens: 2, resolved: 2, ambiguous: 0, outside: 0, nomatch: 0 } });
    const card = readCard();
    expect(card.nonce).toBe(set.nonce);
    expect(typeof set.at).toBe('number');
    expect(card.text).toContain('graphify card — this context\'s working set at compaction, from graphify-out/ (built at');
    expect(card.text).toContain('- server/src/pane/statusline.ts [touched]');
    expect(readState().state).toBe('working');
  });

  it('a subagent\'s card is mined from ITS transcript, and says so in the header', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({
      lines: [tl.toolUse('Read', { file_path: path.join(tree, 'server/src/fleet.ts') })], parentAge: DEAD,
      subagents: [{ id: 'a1', lines: [tl.toolUse('Read', { file_path: path.join(tree, 'pwa/src/lib/models.ts') })], age: LIVE }],
    });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'subagent', agent: 'a1', files: [{ path: 'pwa/src/lib/models.ts', tag: 'touched', count: 1 }] });
    const { text } = readCard();
    expect(text).toContain('(subagent a1)');
    expect(text).toContain('pwa/src/lib/models.ts');
    expect(text).not.toContain('server/src/fleet.ts');
  });

  it('an ambiguous scope writes no card even with a graph and the helper', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree), parentAge: LIVE,
      subagents: [{ id: 'a1', lines: [tl.user('x')], age: LIVE }] });
    run(preCompact(tree, transcript, 'auto'));
    expect(readSet()).toMatchObject({ scope: 'ambiguous', files: null });
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('a graph further behind HEAD than the gate allows writes the set but no card', () => {
    const tree = path.join(home, 'tree'); plantHelper();
    const first = gitTree(tree, 12);                         // HEAD is 11 commits past the graph
    plantGraph(tree, { built: first, nodes: NODES, content: GRAPH });
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    expect(readSet()).toMatchObject({ files: null, fresh: '11 commits behind HEAD' });
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('a failing helper, a missing helper, and a helper printing garbage each leave the hook\'s own set', () => {
    const tree = cardTree();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));                        // no helper planted
    expect(readSet().files).toBeNull();
    fs.rmSync(setFile());
    plantHelper(); stub('node', 'exit 1');
    run(preCompact(tree, transcript));
    expect(readSet().files).toBeNull();
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('the helper runs through `_hook_timeout` with the constant, and the argv is the spec\'s', () => {
    const tree = cardTree(); plantHelper();
    stub('timeout', 'printf \'%s\\n\' "$*" > "$HOME/timeout-argv"; shift; exec "$@"');
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const argv = fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8');
    expect(argv.startsWith('8 node ')).toBe(true);
    expect(argv).toContain(' card --transcript ');
    expect(argv).toContain(` --transcript ${transcript} `);
    expect(argv).toContain(' --max-chars 4000 --max-files 12 ');
    expect(argv).toContain(` --scope main --at ${readSet().at} --nonce ${readSet().nonce}`);
    expect(argv).not.toContain('--steer');                   // stage 1: never
    expect(fs.existsSync(cardFile())).toBe(true);
  });

  it('resolves gtimeout when timeout is absent, with the local resolver shape pinned', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src).toContain('_hook_timeout() {');
    expect(src).toContain('for bin in timeout gtimeout; do');
    expect(src).toContain('command -v "$bin" >/dev/null 2>&1');
    expect(src).toContain('"$bin" "$@"');
    expect(src).toContain('return 127');
    // Arrange a minimal PATH without timeout and a gtimeout argv stub; the
    // stub receives `8 node ...` and the helper creates the card.
  });

  // RESTATED BY MERGE FIX M1 (2026-09-16, merge 6e84524a): the row below used to
  // assert that the ARM was inert past the set — set written, `state: working`,
  // `_hook_timeout` returning 127 and its swallowed helper call leaving the
  // hook-owned set standing. The merged tree resolves `timeout`/`gtimeout`
  // ABOVE the event switch, for the bound on its one `tmux display-message`
  // question, and with neither name present it skips that question, leaves
  // `$tname` empty and exits 0 before any arm — so the WHOLE hook is inert and
  // there is no set, no card and no hookstate to assert. The row now pins that.
  it('with no timeout or gtimeout on PATH (a BSD userland) the WHOLE HOOK is inert — no set, no card, no hookstate, silence', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    const r = runFull(preCompact(tree, transcript), { PATH: minimalPath(['timeout']) });
    expect(r).toEqual({ stdout: '', stderr: '' });        // exit 0 is `runFull`'s own assertion
    expect(fs.existsSync(setFile())).toBe(false);
    expect(fs.existsSync(cardFile())).toBe(false);
    expect(fs.existsSync(stateFile())).toBe(false);
    // NON-VACUITY: the same payload on the ordinary PATH writes both.
    run(preCompact(tree, transcript));
    expect(readState().state).toBe('working');
    expect(fs.existsSync(setFile())).toBe(true);
  });

  it('a transcript with no tool calls: the set says mined-empty (files []), no card', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: [tl.user('hello')] });
    run(preCompact(tree, transcript));
    expect(readSet().files).toEqual([]);
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('the file header declares the helper wait — Task 9 extends R2 with the journal-lock wait', () => {
    const head = fs.readFileSync(HOOK, 'utf8').split('\n').slice(0, 16).join('\n');
    expect(head).toContain('COMPACT_HELPER_TIMEOUT');
    expect(head).toContain('locally resolved');
    expect(head).toContain('`timeout`/`gtimeout` deadline');
    // Historical Task 6 evidence. Task 9 deliberately updates this same header
    // and test to name the separate 2-second journal-lock deadline too.
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PreCompact and the helper"`
Expected: FAIL — no card is ever written (the helper is never called), the header test fails.

- [ ] **Step 3: The portable deadline resolver and helper call**

At the utility layer, after `_hook_epoch_ms`, add the hook-local resolver. The
hook is installed independently of `ccd`, so it cannot source the platform
block; it tries GNU `timeout`, then macOS Homebrew `gtimeout`, and only returns
127 after both are absent:

```bash
_hook_timeout() {
  local bin
  for bin in timeout gtimeout; do
    if command -v "$bin" >/dev/null 2>&1; then
      "$bin" "$@"
      return $?
    fi
  done
  return 127
}
```

In `_hook_compact_pre`, replace the final two lines

```bash
  [[ "$CS_SCOPE" != ambiguous ]] || return 0
  return 0
}
```

with

```bash
  [[ "$CS_SCOPE" != ambiguous ]] || return 0
  # A card needs a graph the gate would trust (the SAME predicate as the
  # search gate, so card and gate agree about which trees count) and the
  # helper beside this file. `node` remains unguarded: a missing one fails the
  # call below exactly as a failing helper does. `_hook_timeout` resolves the
  # deadline executable locally as `timeout` then `gtimeout`, and returns 127
  # when neither exists; that failure is swallowed, so the set remains for
  # PostCompact to claim and unlink at settlement, and the journal stays empty.
  # (MERGE FIX M1, 2026-09-16: the last clause no longer describes the merged
  # tree. The tmux bound above the event switch resolves the same two names
  # first, so a box with neither exits 0 before this arm runs and writes no set
  # at all — this 127 route is reachable only for a failure of `node` or the
  # helper, never for an absent deadline.)
  # Self-contained: spec §4 carries no node/timeout/helper-absent row (round 14,
  # A-11 = B-M4), so do not point at one.
  [ "$rc" -eq 0 ] && _hook_gate_tree || return 0
  [ -f "$COMPACT_HELPER" ] || return 0
  # THE HELPER WAIT (spec §6, R2): at most COMPACT_HELPER_TIMEOUT seconds,
  # after the hookstate rename, bracketing a compaction of at least 79 s. Task 9
  # later adds a separate 2-second journal-lock wait. Exit 0
  # wrote the card and rewrote the set; exit 3 rewrote the set with files [];
  # anything else — 1 (a refused slot, an oversized graph, a failure), 2, 124
  # from the resolved deadline, 127 — leaves the hook's own set standing.
  # Nothing is printed on any path (stage 1). `--steer` is never passed here:
  # the print and its `steered` stamp are Plan C's.
  _hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" card \
    --transcript "$CS_TRANSCRIPT" --cwd "$GM_CWD" \
    --graph "$GM_CWD/graphify-out/graph.json" \
    --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
    --out "$cardf" --set "$set" \
    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
    --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$CS_SCOPE" --at "$at" --nonce "$nonce" \
    ${CS_AGENT:+--agent "$CS_AGENT"} >/dev/null 2>&1
  helper_rc=$?
  [[ "$helper_rc" == 0 || "$helper_rc" == 3 ]] || _hook_compact_rollback "$set" "$cardf" "$nonce" "$doc"
  return 0
}
```

- [ ] **Step 4: The header's contract sentence (R2)**

In the file header of `ccd/session-hook.sh`, replace

```bash
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network, no locks, no waiting. A hook that can slow or break a
# session is worse than no hook.
```

with

```bash
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network, and only two bounded compaction waits: the eight-second
# helper deadline and the two-second stable-lock deadline (spec §6 R2).
# PreCompact and PostCompact use the helper deadline; only PreCompact,
# SessionStart(compact), and PostCompact take the permanent compaction lock.
# Safe malformed-path refusal is prompt, so only actual contention consumes its
# deadline. Both waits are after hookstate; ordinary hook paths remain lock-free.
# A hook that can slow or break a session is worse than no hook.
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PreCompact and the helper"`
Expected: PASS — every test of the describe.

- [ ] **Step 6: MEASURE the helper on this box's real graphs, and record it in the constant's comment**

The spec pins `COMPACT_HELPER_TIMEOUT` = 8 from measured inputs and requires the p95 and peak RSS on the fleet's real graphs before it ships (spec §3.1, §2). This box IS the fleet box. Against a scratch `$REG` under the scratchpad (never the live `~/.cc-sessions`), with this worktree's own `graphify-out/graph.json` (~9 MB) and the largest graph on the box (`find ~/worktrees ~/projects /mnt -maxdepth 6 -path '*/graphify-out/graph.json' -size +20M 2>/dev/null` — MekWarLive's ~70 MB is the expected answer; read-only), run five times each:

```bash
S=<scratchpad>/helper-measure; mkdir -p "$S"
T=<this session's own transcript path>
printf '{"v":1,"at":1,"nonce":"scratch-1","scope":"main","agent":null,"transcript":"%s","parentLive":null,"liveAgents":0,"cwd":"%s","built":null,"fresh":null,"steered":false,"files":null,"stats":null}\n' "$T" "$PWD" > "$S/x.compactset"
/usr/bin/time -v node ccd/compact-card.mjs card --transcript "$T" --cwd "$PWD" \
  --graph <graph.json> --labels <its .graphify_labels.json> --out "$S/x.compactcard" --set "$S/x.compactset" \
  --max-chars 4000 --max-files 12 --built x --fresh fresh --scope main --at 1 --nonce "scratch-1" 2>&1 | grep -E 'Elapsed|Maximum resident'
```

Record the p95 elapsed and the peak RSS for each graph in the `COMPACT_HELPER_TIMEOUT` comment (replace `<p95> s / <RSS> MB`). **Acceptance: p95 ≤ 4 s on the largest graph.** If it is not, STOP and report — do not raise the constant; the spec's cost argument is what is wrong. Task 6 measurement (2026-09-10, five fresh-nonce runs each): ccrc's 9,543,597-byte graph p95 0.36 s / peak 104,384 KiB RSS; largest admissible MekWarLive graph (70,434,955 bytes) p95 1.05 s / peak 332,184 KiB RSS. The 111,097,911-byte MegaMek graph exceeded the 96 MiB cap and exited 1 before parse in 0.25 s / 44,928 KiB RSS; its scratch set was byte-identical and no card existed.

- [ ] **Step 7: Mutation checks**

1. Delete the `_hook_timeout "$COMPACT_HELPER_TIMEOUT"` prefix (run `node` bare) → `the helper runs through _hook_timeout` goes red (no argv file).
2. Replace `--transcript "$CS_TRANSCRIPT"` with `--transcript "$tp"` → `a subagent's card is mined from ITS transcript` goes red (fleet.ts on the card).
3. Delete `[ "$rc" -eq 0 ] && _hook_gate_tree || return 0` → `a graph further behind HEAD` goes red (a card appears).
4. Replace `for bin in timeout gtimeout` with `for bin in timeout` → `resolves gtimeout` goes red.
5. ~~Replace `_hook_timeout`'s final `return 127` with `shift; "$@"` → `with no timeout or gtimeout on PATH` goes red because node runs bare and rewrites the set.~~ **RESTATED by merge fix M1 (2026-09-16).** That route is closed: on a PATH carrying neither name the merged hook exits above the event switch (its tmux bound resolves the same two names first), so the row never reaches `_hook_timeout` and this mutation cannot be what reds it. The row's control is now the bound itself — replace `[[ -n "$hooktmo" ]] && tname=$("$hooktmo" 2 tmux display-message -p '#S' 2>/dev/null)` with an unbounded `tname=$(tmux display-message -p '#S' 2>/dev/null)` and the row reds with `no set — the arm was never reached: expected true to be false`. Measured red on 2026-09-16.
6. Remove the nonce condition in `_hook_compact_rollback` → `timeout rollback never restores or removes a later nonce owner` goes red because the exact hook document overwrites the later set. Measured red on 2026-09-10.
7. Move the final PreCompact call before the hookstate rename → `records working hookstate before the bounded helper starts` goes red because the deadline stub refuses to capture its initial document. Measured red on 2026-09-10.
8. Treat same numeric `at` as ownership in `ownedSlot` → `THE SLOT CHECK` goes red because the older helper overwrites the later nonce owner. Measured red on 2026-09-10.
9. Delete the helper's pre-set-write `slotIsMine` guard → `rechecks the nonce after render staging and before the first target write` goes red (`writes` becomes 1). Delete the helper rollback ownership condition → its later-owner test goes red. Both measured red on 2026-09-10.
10. Delete `[ -f "$COMPACT_HELPER" ] || return 0` → no test reds (node fails on the missing file with the same outcome); the line is a short-circuit that saves a fork on an undeployed box, recorded here as unpinned by design.

- [ ] **Step 8: Run the whole file, then commit**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: PASS — including `prints NOTHING on every other event`, whose PreCompact row now runs with a graph in the tree.

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): PreCompact runs compact-card.mjs under the helper's declared wait, measured on this box's graphs — the card with a graph, the set either way (spec §3.1, R2)"
```

---

### Task 7: SessionStart(compact) serves the card once, to its set (spec §3.3; served-set cache superseded by Task 9/D-2605)

> **Historical implementation task.** Steps below describe the Task 7 commit so its completed fix-round evidence remains reproducible. They are not the final integration contract: Task 9 deletes the served-set rewrite, replaces its tests/call site with marker-after-emit behavior, and migrates its pre-D-2605 SessionStart claim producer to the §3.4 target inventory before ordinary cleanup relies on that inventory.

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_emit_context` (two arguments, two clips), a new `_hook_compact_card` after `_hook_compact_pre`, the SessionStart arm
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — SessionStart(compact) (spec §3.3)')`, and the existing `is printed for compact too` row unchanged

**Interfaces:**
- Produces through the Task 7 commit: `_hook_compact_card` sets `CARD_COMPACT`; `_hook_emit_context <standing> [<compact>]` applies the two clips and returns 1 when its `jq` cannot build the envelope; `_hook_compact_served` stamps the original set cache. **Task 9/D-2605 supersedes only the last integration:** it deletes `_hook_compact_served`, exports `CARD_COMPACT_NONCE`, and creates the exact marker after successful emit without rewriting canonical set. The consume-once and clipping work in this task remains unchanged.
- Consumes: the card and set files of Task 6; `COMPACT_CARD_MAX_AGE`, `COMPACT_CARD_MAX_CHARS`, `CARD_TOTAL_MAX_CHARS`.
- **fix-round correction (M1):** `_hook_compact_card` consumes the card through an ATOMIC claim-by-rename (`mv -f "$f" "$claim"`), not a bare read-then-`rm` — a bare read let every one of N concurrent SessionStart(compact) racers (the main thread and its own live subagents can all hit this arm close together) read the card before the first deleted it, serving it to more than one context (measured 8-way: 2 of 3 trials served it twice), contradicting spec §3.3 step 3. A losing `mv` (ENOENT) serves nothing; a crossed pair or a body-less nonce RESTORES the card via the same no-clobber `link` idiom `_hook_compact_rollback_card` (Task 6) already uses, so "the card stays" still holds for those two cases.

- [ ] **Step 1: Write the failing tests**

Append at the end of `server/test/session-hook.test.ts`:

```ts
describe('the compaction card — SessionStart(compact) (spec §3.3)', () => {
  /** A card+set pair on disk exactly as Task 6 leaves them, without running
   *  the helper: numeric `at` is measurement; `nonce` owns the first line. */
  const plantPair = (at: number, text: string, opts: { nonce?: string; setNonce?: string } = {}): void => {
    const nonce = opts.setNonce ?? `nonce-${at}`;
    fs.writeFileSync(setFile(), JSON.stringify({ v: 1, at, nonce, scope: 'main', agent: null,
      transcript: '/t.jsonl', parentLive: null, liveAgents: 0, cwd: null, built: null, fresh: null,
      steered: false, served: false, files: null, stats: null }) + '\n');
    fs.writeFileSync(cardFile(), `${opts.nonce ?? nonce}\n${text}\n`);
  };
  const CARD_TEXT = 'graphify card — this context\'s working set at compaction, from graphify-out/ (built at deadbeef, fresh):\n- a.ts [edited]\nBlast radius: 0 files import or call something in these 1 files.\nRe-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.';

  it('serves the card as the fourth subject on compact, strips the nonce, deletes the card, writes no hookstate (D-306)', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const { nonce, text } = readCard();
    const out = card(run(compactStart(tree, transcript)));
    expect(out).toContain('graphify: this tree has a knowledge graph');       // the standing subject
    expect(out).toContain('graphify card — this context');                    // the fourth
    expect(out.endsWith(text.trimEnd())).toBe(true);
    expect(out).not.toContain(`${nonce}\n`);
    expect(out.includes(` ${nonce} `), 'the nonce line reached the model').toBe(false);
    expect(fs.existsSync(cardFile()), 'consume-once').toBe(false);
    expect(fs.existsSync(setFile()), 'the set is PostCompact\'s to consume').toBe(true);
    expect(readSet().served, 'the fact of serving is stamped into the set').toBe(true);
    expect(readSet().nonce, 'the stamp preserves pair ownership').toBe(nonce);
    expect(typeof readSet().at, 'the stamp preserves numeric measurement').toBe('number');
    expect(readState().event, 'the compact SessionStart wrote state after all').toBe('PreCompact');
    // consume-once: a second compact SessionStart has no fourth subject
    const again = card(run(compactStart(tree, transcript)));
    expect(again).not.toContain('graphify card');
  });

  it('never serves it on startup, resume or clear — a card describes the compacted context and nothing else', () => {
    const tree = cardTree();
    plantPair(1, CARD_TEXT);
    for (const source of ['startup', 'resume', 'clear']) {
      const out = card(run({ hook_event_name: 'SessionStart', source, cwd: tree }));
      expect(out, source).not.toContain('graphify card');
      expect(fs.existsSync(cardFile()), source).toBe(true);
    }
  });

  it('an aged card is REMOVED, not served', () => {
    const tree = cardTree();
    plantPair(1, CARD_TEXT);
    const old = Math.floor(Date.now() / 1000) - 1200 - 60;
    fs.utimesSync(cardFile(), old, old);
    const out = card(run(compactStart(tree, '/t.jsonl')));
    expect(out).not.toContain('graphify card');
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('a crossed pair is not served: another nonce, or no set at all — the card stays, served stays false', () => {
    const tree = cardTree();
    plantPair(1, CARD_TEXT, { nonce: '2' });
    expect(card(run(compactStart(tree, '/t.jsonl')))).not.toContain('graphify card');
    expect(fs.existsSync(cardFile())).toBe(true);
    expect(readSet().served).toBe(false);
    fs.rmSync(setFile());
    expect(card(run(compactStart(tree, '/t.jsonl')))).not.toContain('graphify card');
    expect(fs.existsSync(cardFile())).toBe(true);
  });

  it('the operator file silences the fourth subject and leaves the card on disk', () => {
    const tree = cardTree();
    plantPair(1, CARD_TEXT);
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
    expect(card(run(compactStart(tree, '/t.jsonl')))).not.toContain('graphify card');
    expect(fs.existsSync(cardFile())).toBe(true);
  });

  it('TWO CLIPS: the standing subjects are clipped at CARD_MAX_CHARS exactly (D-1899\'s fixture) and the card is intact after them', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee', report: false });
    fs.writeFileSync(path.join(tree, 'graphify-out', 'GRAPH_REPORT.md'),
      `# Graph Report - demo  (2026-09-02)\n\n## Summary\n`
      + `- ${'9'.repeat(3000)} nodes · 15645 edges · 423 communities\n`);
    const standing = card(run(compactStart(tree, '/t.jsonl')));   // no card on disk: the standing clip alone
    expect(standing.length).toBe(2400);
    plantPair(1, CARD_TEXT);
    const out = card(run(compactStart(tree, '/t.jsonl')));
    expect(out.slice(0, 2400)).toBe(standing);
    expect(out.charAt(2400)).toBe(' ');
    expect(out.slice(2401)).toBe(CARD_TEXT);
    expect(out.length).toBeLessThanOrEqual(2400 + 1 + 4000);
  });

  it('a pathological card is clipped at COMPACT_CARD_MAX_CHARS and the sum at CARD_TOTAL_MAX_CHARS', () => {
    const tree = cardTree();
    plantPair(1, 'x'.repeat(100_000));
    const out = card(run(compactStart(tree, '/t.jsonl')));
    expect(out.length).toBeLessThanOrEqual(6401);
    expect(out.length - out.indexOf(' x')).toBeLessThanOrEqual(4001);
  });

  it('costs no more than 4x the cheap PostToolUse arm with a card present, on a 200-row registry — its OWN ratio', () => {
    // D-1898's method (see the startup-arm test above for why an absolute ms
    // number is the wrong shape): the compact arm interleaved with the cheap
    // arm in ONE run, its own array, its own p95. EXECUTOR: measure the shipped
    // band and a mutated band (replace `_hook_compact_card`'s bounded `read -N`
    // with `jq -r .at "$set"` plus a second `jq` on the card) over 15 isolated
    // runs each; record both bands in this comment and argue R from them. R=4
    // is provisional until then; report, never tune silently, if the shipped
    // band's p95 sits above 3.5.
    const reg = path.join(home, '.cc-sessions');
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 200; i++) {
      const id = `row-${i}`;
      fs.writeFileSync(path.join(reg, `${id}.uuid`), `uuid-${id}`);
      fs.writeFileSync(path.join(reg, `${id}.project`), i < 40 ? 'alpha' : `proj-${i}`);
      fs.writeFileSync(path.join(reg, `${id}.supervised`), String(now - 5));
    }
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.uuid'), 'uuid-1');
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.project'), 'alpha');
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.supervised'), String(now - 5));
    const tree = cardTree();
    const cheapTimes: number[] = [];
    const compactTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = process.hrtime.bigint();
      run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
      cheapTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
      plantPair(i + 1, CARD_TEXT);
      const t1 = process.hrtime.bigint();
      run(compactStart(tree, '/t.jsonl'));
      compactTimes.push(Number(process.hrtime.bigint() - t1) / 1e6);
    }
    const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95) - 1]!; };
    expect(p95(compactTimes) / p95(cheapTimes)).toBeLessThan(4);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "SessionStart\\(compact\\)"`
Expected: FAIL — no fourth subject is ever printed; the two-clip test's `out.slice(2401)` is empty.

- [ ] **Step 3: The emitter — two arguments, two clips, one site, a return code**

Replace `_hook_emit_context` in `ccd/session-hook.sh` (keep its existing comment block above the function; the body changes) with:

```bash
_hook_emit_context() {   # <standing> [<compact>] -> one JSON line on stdout, or nothing at all
  local j="" text=""
  # THE STANDING CLIP LIVES HERE, at the ONE site every subject passes through.
  # A per-subject clip is one each new subject can forget; this one cannot be.
  # It is also what stands between an operator-controlled field and `jq`'s own
  # MAX_ARG_STRLEN (measured 131072 on this box: at 130442 bytes of card the
  # exec fails, `|| return 0` swallows it, and the hook prints NOTHING —
  # deleting the graphify card for that session too).
  text="${1:0:$CARD_MAX_CHARS}"
  # THE SECOND CLIP (compaction-card spec §3.3), in the SAME site: the compact
  # subject is appended AFTER the standing clip, under its own ceiling, and the
  # sum is pinned at CARD_TOTAL_MAX_CHARS — derived from the two ceilings, never
  # a third budget. A pathological GM_NODES (D-1899) still loses only the
  # standing tail; the compact card behind it is intact.
  if [ -n "${2:-}" ]; then
    text="${text:+$text }${2:0:$COMPACT_CARD_MAX_CHARS}"
    text="${text:0:$CARD_TOTAL_MAX_CHARS}"
  fi
  # RETURNS 1 when the envelope could not be built — nothing was printed, and
  # the SessionStart arm must not stamp `served` for a card that never went
  # out. Every existing caller ignores the code, so nothing else changes.
  j=$(jq -cn --arg c "$text" \
    '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}' 2>/dev/null) \
    || return 1
  printf '%s\n' "$j"
}
```

- [ ] **Step 4: `_hook_compact_card` and `_hook_compact_served`** — insert after `_hook_compact_pre`

```bash
# ── SessionStart(compact) (spec §3.3): SERVE THE CARD ONCE, TO ITS SET ────
# This arm cannot tell which context it serves (§3.0: the compactor has been
# silent for ≥79 s by now) and NEVER resolves. It serves the card iff the card
# is the set's own — line 1 of the card is the set's `nonce` — and consumes it.
# An aged card belongs to no compaction that can still arrive and is REMOVED
# (a dot-free registry file that outlives its use would hold the slug); a
# crossed pair — another nonce, or no set — serves nothing and leaves the card
# for the overlap check or the age bound to retire. Two bounded, fork-free
# reads (`read -N`, the `_ct_read` idiom); one `find` for the age; one `rm`.
_hook_compact_card() {   # sets CARD_COMPACT; silent on every path
  CARD_COMPACT=""
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local f="$REG/$id.compactcard" set="$REG/$id.compactset" head="" nonce="" raw="" line1="" body=""
  [[ -f "$f" && -r "$f" ]] || return 0
  command -v find >/dev/null 2>&1 || return 0
  [ -n "$(find "$f" -mmin "-$(( COMPACT_CARD_MAX_AGE / 60 ))" 2>/dev/null)" ] || { rm -f "$f"; return 0; }
  [[ -f "$set" && -r "$set" ]] || return 0
  IFS= read -r -N 4096 head 2>/dev/null < "$set"
  [[ "$head" =~ \"nonce\":\"([^\"]+)\" ]] || return 0
  nonce="${BASH_REMATCH[1]}"
  IFS= read -r -N $(( COMPACT_CARD_MAX_CHARS + 64 )) raw 2>/dev/null < "$f"
  line1="${raw%%$'\n'*}"
  [[ "$line1" == "$nonce" ]] || return 0
  body="${raw#*$'\n'}"
  [[ "$body" != "$raw" ]] || return 0                 # a nonce with no text after it
  rm -f "$f"
  body="${body:0:$COMPACT_CARD_MAX_CHARS}"
  body="${body%"${body##*[![:space:]]}"}"
  [ -n "$body" ] || return 0
  CARD_COMPACT="$body"
  return 0
}

# THE FACT OF SERVING (spec §3.3 step 5). Called by the arm only after the
# emitter has PRINTED a card: one jq rewrite of the set, temp-then-rename, so
# PostCompact's `measure` can say whether `cited` is even interpretable — a
# card that was mined but never reached the model reads `served: false`, not
# as a citation miss. Silent on every failure; the set is left as it was.
_hook_compact_served() {
  local set="$REG/$id.compactset" doc=""
  [[ -f "$set" && -r "$set" ]] || return 0
  doc=$(jq -c '.served = true' "$set" 2>/dev/null) || return 0
  [[ "$doc" == \{* ]] || return 0
  _hook_write_atomic "$set" "$doc" || return 0
  return 0
}
```

- [ ] **Step 5: The SessionStart arm**

In the `SessionStart)` arm, replace

```bash
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD=""
    _hook_graph_card || true
    _hook_hold_card  || true
    _hook_ccrc_card  || true
    CARD="$CARD_GRAPH"
    [ -z "$CARD_HOLD" ] || CARD="${CARD:+$CARD }$CARD_HOLD"
    [ -z "$CARD_CCRC" ] || CARD="${CARD:+$CARD }$CARD_CCRC"
    [ -z "$CARD" ] || _hook_emit_context "$CARD"
    [[ "$src" == compact ]] && exit 0
```

with

```bash
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD_COMPACT=""; CARD=""
    _hook_graph_card || true
    _hook_hold_card  || true
    _hook_ccrc_card  || true
    # THE FOURTH SUBJECT, compact only (compaction-card spec §3.3): a card
    # describes the compacted context and nothing else, so startup, resume
    # and clear never read the file. It is passed to the emitter SEPARATELY —
    # the standing three keep their clip, the card gets its own (D-1899).
    [[ "$src" == compact ]] && { _hook_compact_card || true; }
    CARD="$CARD_GRAPH"
    [ -z "$CARD_HOLD" ] || CARD="${CARD:+$CARD }$CARD_HOLD"
    [ -z "$CARD_CCRC" ] || CARD="${CARD:+$CARD }$CARD_CCRC"
    # The stamp follows the PRINT, never the intent: only an emitter that
    # returned 0 with a compact subject in hand records `served`.
    if [ -n "$CARD$CARD_COMPACT" ]; then
      if _hook_emit_context "$CARD" "$CARD_COMPACT" && [ -n "$CARD_COMPACT" ]; then _hook_compact_served || true; fi
    fi
    [[ "$src" == compact ]] && exit 0
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "SessionStart\\(compact\\)"`
Expected: PASS — every test of the describe. Then the emitter describe: `./node_modules/.bin/vitest run test/session-hook.test.ts -t "the emitter"` — its three rows (2400 on startup, hold, node count) stay green: with no second argument the emitter behaves exactly as before.

- [ ] **Step 7: Mutation checks**

1. In `_hook_emit_context`, replace `text="${1:0:$CARD_MAX_CHARS}"` with `text="$1"` → `TWO CLIPS` goes red (`standing.length` is 3437, not 2400) — the standing clip cannot be deleted.
2. Move the standing clip after the append (clip `text` once at `CARD_TOTAL_MAX_CHARS` only) → `TWO CLIPS` goes red (`out.slice(2401)` is not the card).
3. **CORRECTED (fix-round I1):** as originally written this mutation deleted the clip in TWO places at once — `_hook_emit_context`'s `${2:0:$COMPACT_CARD_MAX_CHARS}` AND `_hook_compact_card`'s own `body="${body:0:$COMPACT_CARD_MAX_CHARS}"` — and the review found the two were a duplicate IN SERIES: each a complete substitute for the other, so neither alone was pinnable (`a pathological card` stayed GREEN under either one deleted by itself). `_hook_compact_card`'s duplicate slice is DELETED (its bounded `read -N COMPACT_CARD_MAX_CHARS+64` is the real, measured cost guard — 114 ms vs 17,370 ms for a `cat` fork on a 100 MB card — and stays, uncoupled from the clip). The single surviving mutation: in `_hook_emit_context`, delete `${2:0:$COMPACT_CARD_MAX_CHARS}`'s slice (`text="${text:+$text }$2"` instead) → `a pathological card` goes red (measured: 4057 not ≤4001) — output is otherwise byte-identical (confirmed: the whole describe passes unchanged with the duplicate removed).
4. Delete `[[ "$line1" != "$nonce" ]]` (now the FIRST of two separate `if` blocks under the atomic claim, fix-round M1) → `a crossed pair` goes red (served).
5. Delete the age `find` line → `an aged card is REMOVED` goes red (served).
6. **CORRECTED (fix-round M1):** the original `rm -f "$f"` no longer exists in that shape — consume-once is now an ATOMIC claim-by-rename (`mv -f "$f" "$claim"`), because a bare read-then-`rm` let every one of N concurrent SessionStart(compact) racers read the card before the first deleted it (measured 8-way against the pre-fix code: 2 of 3 trials served it twice). Mutation: revert to the pre-fix read-then-`rm` shape (or simply skip the `mv` claim and read `$f` directly, `rm -f "$f"` at the end) → the new `consume-once is ATOMIC` test goes red (more than one of 8 concurrent racers serve the same card). The single-writer `consume-once` assertion in the first test is unaffected by either shape and stays green either way — the concurrency test is what this mutation needs.
7. Drop the `[[ "$src" == compact ]] &&` guard on `_hook_compact_card` → `never serves it on startup, resume or clear` goes red.
8. Delete the `_hook_compact_served || true` call → the `served … stamped` assertion goes red (unaffected by fix-round I4, still a clean single-site red). **8b CORRECTED (fix-round I4):** the original recipe — call `_hook_compact_served` BEFORE the emitter, and in the SAME mutation break the emitter's jq program entirely (`jq -cn --arg c "$text" 'garbage'`) — is CONFOUNDED: breaking jq for every call stops ALL FOUR subjects printing, so the test's `card()` helper throws on its own "the hook printed nothing" check before the `served` assertion is ever reached (verified: the assertion that actually reddens is `card`'s, not `served`'s). The corrected single-site pin is the new test `a jq that fails ONLY the envelope build …` (I4): a jq shim that fails ONLY the SessionStart-envelope program (matched by text) and execs the real jq for every other call (the three other card builders, the served/set-doc rewrites), read via `runFull` directly (not `card()`) so the confound cannot recur. Mutation: `_hook_emit_context`'s trailing `|| return 1` → `|| return 0` → THIS test's `served` assertion alone goes red (verified: `stdout` stays empty under both, `served` is the only line that distinguishes them).
9. Delete `[ -e "$COMPACT_CARD_OFF" ] && return 0` in `_hook_compact_card` → `the operator file silences the fourth subject` goes red.
10. (fix-round M3, new) Delete `[[ "$body" != "$raw" ]]`'s check (now `if [[ "$body" == "$raw" ]]`) → `a nonce with no text after it` goes red (restored, not consumed).
11. (fix-round M3, new) Delete `command -v find >/dev/null 2>&1 || return 0` in `_hook_compact_card` → `with no find on PATH` goes red (find absent: must not be silently deleted).

- [ ] **Step 8: Run the whole file, then commit**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: PASS.

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): SessionStart(compact) serves the card once, to its set, as the fourth subject under two clips in one emitter (spec §3.3)"
```

---
### Task 8: The helper's `measure` — normalisation, the fields, `cited` (spec §3.4)

**Files:**
- Modify: `ccd/compact-card.mjs` (insert above `// ── CLI`), `ccd/compact-card.d.mts`
- Test: `server/test/compact-card.test.ts`

**Interfaces:**
- Produces: `normalizeSummary(raw)` → string, `filesSectionChars(text)` → number | null, `citedCount(text, paths)` → number, `measureCommand(raw, set | null, trigger)` → `{at, trigger, scope, chars, filesChars, fences, cited, setSize, steered, served}`; the CLI `measure [--set f] --trigger auto|manual` reading stdin, printing ONE JSON line, exit 0; exit 2 on a bad trigger. An unreadable or malformed `--set` is measured as NO set (nulls), never a lost measurement — spec §3.4.

- [ ] **Step 1: Write the failing tests** (append; extend the import with `normalizeSummary, filesSectionChars, citedCount, measureCommand`)

```ts
describe('measure — the summary the session will see (spec §3.4)', () => {
  it('normalises as the harness does: the FIRST <analysis> dropped, <summary> REPLACED by a Summary: line, blank runs collapsed, trimmed', () => {
    const raw = '\n<analysis>scratch\nwork</analysis>\n\n\n<summary>\n  Hello world\n\n\n\nmore\n</summary>\n<analysis>kept: only the first goes</analysis>\n\n';
    expect(normalizeSummary(raw)).toBe('Summary:\nHello world\n\nmore\n<analysis>kept: only the first goes</analysis>');
    expect(normalizeSummary('plain text')).toBe('plain text');
  });

  it('filesChars spans the "Files and Code Sections" heading to the next numbered heading, tolerating # ** case and a colon; null when absent', () => {
    const a = '1. Primary Request:\nx\n3. Files and Code Sections:\n- a.ts\n- b.ts\n4. Errors and fixes:\nnone\n';
    expect(filesSectionChars(a)).toBe('3. Files and Code Sections:\n- a.ts\n- b.ts\n'.length);
    const b = '**1. Primary Request**\nx\n## **3. files and code sections**\n- a.ts\n**4. Errors and Fixes:**\nnone';
    expect(filesSectionChars(b)).toBe('## **3. files and code sections**\n- a.ts\n'.length);
    expect(filesSectionChars('3. Files and Code Sections:\n- only section, to EOF')).toBe('3. Files and Code Sections:\n- only section, to EOF'.length);
    expect(filesSectionChars('no headings here\n\x60\x60\x60ts\ncode\n\x60\x60\x60')).toBeNull();
  });

  it('cited counts a set file when its path appears, or a UNIQUE suffix of at least two segments does — never a bare basename', () => {
    const paths = ['server/src/pane/statusline.ts', 'server/src/watch.ts', 'pwa/src/watch.ts'];
    expect(citedCount('touched server/src/pane/statusline.ts', paths)).toBe(1);
    expect(citedCount('see pane/statusline.ts', paths)).toBe(1);            // unique 2-segment suffix
    expect(citedCount('see statusline.ts', paths)).toBe(0);                 // a bare basename is not a citation
    expect(citedCount('see src/watch.ts', paths)).toBe(0);                  // ambiguous within the set
    expect(citedCount('see server/src/watch.ts and pwa/src/watch.ts', paths)).toBe(2);
  });

  it('measureCommand: the fields, and null — never 0 or main — without a set or without files', () => {
    const F = '\x60\x60\x60';                                       // a fence, never literal in a test file
    const text = `3. Files and Code Sections:\n- server/src/watch.ts\n${F}ts\nx\n${F}\n4. Next:\n${F}\ny\n${F}\n${F}`;
    const set = { v: 1, at: 1, nonce: 'nonce-1', scope: 'subagent', agent: 'a1', transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: true,
      files: [{ path: 'server/src/watch.ts', tag: 'edited', count: 1 }, { path: 'pwa/src/lib/models.ts', tag: 'touched', count: 1 }], stats: null };
    const m = measureCommand(text, set as any, 'auto');
    expect(m).toMatchObject({ trigger: 'auto', scope: 'subagent', chars: text.length, fences: 2, cited: 1, setSize: 2, steered: true, served: false });
    expect(measureCommand(text, { ...set, served: true } as any, 'auto').served).toBe(true);
    expect(m.filesChars).toBe(`3. Files and Code Sections:\n- server/src/watch.ts\n${F}ts\nx\n${F}\n`.length);
    expect(Number.isInteger(m.at)).toBe(true);
    expect(measureCommand(text, null, 'manual')).toMatchObject({ scope: null, cited: null, setSize: null, steered: false, served: false, trigger: 'manual' });
    expect(measureCommand(text, { ...set, scope: 'ambiguous', files: null } as any, 'auto')).toMatchObject({ scope: 'ambiguous', cited: null, setSize: null });
    expect(measureCommand(text, { ...set, scope: 'parent' } as any, 'auto').scope).toBeNull();
  });

  it('as the hook runs it: stdin in, one JSON line out, the trailing newline jq -r adds is not counted; exit 2 on a bad trigger; a bad set is NO set', () => {
    const set = write('s.compactset', JSON.stringify({ v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: null, built: null, fresh: null, steered: false, served: false, files: [], stats: null }) + '\n');
    const r = helper(['measure', '--set', set, '--trigger', 'manual'], 'hello world\n');
    expect(r.status).toBe(EXIT.OK);
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ chars: 11, scope: 'main', cited: 0, setSize: 0, trigger: 'manual', served: false });
    expect(helper(['measure', '--trigger', 'weird'], 'x').status).toBe(EXIT.USAGE);
    const bad = helper(['measure', '--set', write('bad.compactset', '{nope'), '--trigger', 'auto'], 'x');
    expect(bad.status).toBe(EXIT.OK);
    expect(JSON.parse(bad.stdout)).toMatchObject({ chars: 1, scope: null, cited: null, setSize: null });
    expect(helper(['measure', '--set', path.join(dir, 'absent'), '--trigger', 'auto'], 'x').status).toBe(EXIT.OK);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: FAIL — `normalizeSummary` and friends are not exported; the CLI `measure` exits 1 (ReferenceError).

- [ ] **Step 3: The measure code** — insert above `// ── CLI`

```js
// ── MEASURE (spec §3.4) ──────────────────────────────────────────────────
/** Mirrors what the harness does to `compact_summary` before injecting it
 *  (2.1.266, measured): drop the FIRST <analysis> block (non-greedy, no
 *  global flag); REPLACE <summary>X</summary> with a `Summary:` line and
 *  X.trim() — replace, not unwrap, because the session sees that line and
 *  `chars` must count what the session sees; collapse runs of blank lines to
 *  one; trim. */
export function normalizeSummary(raw) {
  let t = String(raw);
  t = t.replace(/<analysis>[\s\S]*?<\/analysis>/, '');
  t = t.replace(/<summary>([\s\S]*?)<\/summary>/, (_m, inner) => `Summary:\n${inner.trim()}`);
  t = t.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
  return t.trim();
}

/** A numbered heading as the corpus spells them: optional `#`s, optional
 *  `**`, `<n>.`, a title, an optional colon, optional closing `**`. */
const HEADING_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?[ \t]*\d+\.[ \t]+([^\n]*?)[ \t]*:?[ \t]*(?:\*\*)?[ \t]*$/gm;

/** Chars from the "Files and Code Sections" heading to the next numbered
 *  heading (or EOF); null when the summary has no such heading — 19% of the
 *  corpus is not in the nine-section format, and null is what keeps this
 *  field honest. */
export function filesSectionChars(text) {
  let start = -1;
  for (const m of text.matchAll(HEADING_RE)) {
    if (start < 0) { if (/^files and code sections$/i.test(m[1])) start = m.index; }
    else return m.index - start;
  }
  return start < 0 ? null : text.length - start;
}

/** Working-set files the summary names: the repo-relative path, or a
 *  path-segment-aligned suffix of it of at least two segments that is unique
 *  WITHIN THE SET. Computed from the set alone; no graph needed. */
export function citedCount(text, paths) {
  let n = 0;
  for (const p of paths) {
    if (text.includes(p)) { n++; continue; }
    const segs = p.split('/');
    let hit = false;
    for (let k = 2; k < segs.length && !hit; k++) {
      const suffix = segs.slice(-k).join('/');
      const unique = paths.filter((q) => q === suffix || q.endsWith('/' + suffix)).length === 1;
      if (unique && text.includes(suffix)) hit = true;
    }
    if (hit) n++;
  }
  return n;
}

const SCOPES = new Set(['main', 'subagent', 'ambiguous']);

/** The helper measurement object Task 9 enriches into the sole journal record.
 *  null — never 0, never "main" — wherever the set could not say: no set,
 *  or a set with `files: null`. No ordinal is persisted. */
export function measureCommand(raw, set, trigger) {
  const text = normalizeSummary(raw);
  const paths = set && Array.isArray(set.files) ? set.files.map((f) => f.path) : null;
  return {
    at: Date.now(),
    trigger,
    scope: set && SCOPES.has(set.scope) ? set.scope : null,
    chars: text.length,
    filesChars: filesSectionChars(text),
    // three backticks, hex-escaped so this source never carries a fence
    fences: Math.floor((text.match(/\x60\x60\x60/g) ?? []).length / 2),
    cited: paths ? citedCount(text, paths) : null,
    setSize: paths ? paths.length : null,
    steered: set ? set.steered === true : false,
    served: set ? set.served === true : false,
  };
}

/** The set for `measure`: absent, unreadable or malformed all read as NO SET
 *  (spec §3.4 — a bad set must never cost the whole measurement, and the
 *  hook consumes it either way). */
export function readSetForMeasure(setPath) {
  if (!setPath) return null;
  try {
    const o = JSON.parse(readFileSync(setPath, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}
```

Append to `ccd/compact-card.d.mts`:

```ts
export function normalizeSummary(raw: string): string;
export function filesSectionChars(text: string): number | null;
export function citedCount(text: string, paths: string[]): number;
export interface Measurement {
  at: number; trigger: 'auto' | 'manual'; scope: 'main' | 'subagent' | 'ambiguous' | null;
  chars: number; filesChars: number | null; fences: number; cited: number | null; setSize: number | null; steered: boolean; served: boolean;
}
export function measureCommand(raw: string, set: CompactSet | null, trigger: 'auto' | 'manual'): Measurement;
export function readSetForMeasure(setPath: string | undefined): CompactSet | null;
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card.test.ts`
Expected: PASS — every test in the file.

- [ ] **Step 5: Mutation checks**

1. In `normalizeSummary`, make the `<summary>` replacement `inner.trim()` alone (unwrap) → the first test goes red (no `Summary:` line).
2. Add the `g` flag to the `<analysis>` regex → the first test goes red (the second block is gone).
3. In `citedCount`, start `k` at 1 → `never a bare basename` goes red.
4. In `measureCommand`, make `cited: paths ? … : 0` → the null-vs-0 case goes red.
5. In `filesSectionChars`, drop `(?:\*\*)?` → the `**` spelling goes red.
6. In `readSetForMeasure`, rethrow instead of returning null → `a bad set is NO set` goes red (exit 1).
7. In `measureCommand`, write `served: false` unconditionally → the `served` assertions go red.

- [ ] **Step 6: Commit**

```bash
git add ccd/compact-card.mjs ccd/compact-card.d.mts server/test/compact-card.test.ts
git commit -m "feat(compact-card): measure the summary the session sees — normalised as the harness does, the files section, fences, citations against the set, null where the set cannot say"
```

---

### Task 9: Close D-2605 ownership, generation, and journal semantics (spec §§2–3.4)

**THE ERA OF THIS SECTION'S LINE ANCHORS, said once (round 14, the complete citation pass).** Every `ccd/ccd`
and `ccd/session-hook.sh` line number below that this section does not explicitly re-measure names the
PRE-Task-9 tree `8e457995` this task was WRITTEN AGAINST, because a prescription cites the code it is about
to change. Task 9 has since landed, so those anchors are superseded by construction and are the
stale-by-construction debt D-2758 parks in Task 11 — they are recorded, per reference, in the per-file
citation census in `server/test/session-hook.test.ts`, not repaired here: re-pointing a sentence about the
OLD arm at the NEW line is the defect that census exists to find. Where a clause in this section carries a
TIP anchor beside a pre-Task-9 one, that clause is NOT covered by this note — a mixed-era sentence is a
defect in either direction, and round 14 re-anchored or era-marked each one it measured.

**Files:**
- Modify: `ccd/session-hook.sh` — one lock/generation/family implementation; locked PreCompact rewritten to the
  round-7 option-A protocol (§3.1: scope/graph-measure moved out of the lock; acquire; overlap+sweep; publish
  initial set; release before the helper fork with NO canonical path in its argv; reacquire; re-read the
  canonical set head via bounded `read -N` to reconfirm nonce ownership — bash has no `slotIsMine` counterpart,
  so any surviving instruction to call it must instead name this head-parse idiom, already used at `:934-935`;
  rename card-stage then set-stage on rc 0, set-stage only on rc 3, publish nothing and remove only this
  process's own stages on any other outcome or a failed reconfirm; release); strict compact-SessionStart order
  (unchanged in shape; it forks only synchronous children it reaps inside its retained-lock section, which is
  what makes holding the descriptor compliant — round 9, see interface item 4); settlement (including the
  genuinely-absent-canonical-set branch, whose premise is
  now true rather than merely asserted, since no PreCompact-side rollback exists to compose with); retained
  claim FD; final journal (now reacquired with the SAME `COMPACT_LOCK_WAIT` settlement uses, not a separate
  final constant) and cleanup behavior. **Also in this task's scope, each a correction with no owner before
  now:** the header at `:4-8` AND the standing lock-free contract asserted a second time at `:70-72` ("no
  network, no locks, no waiting") both need Task 9's amendment — an earlier draft of this plan claimed Task 6
  already amended `:4-8` "the same way"; measured against the shipped file, `:4-8` still reads "no locks" with
  an exception scoped only to the helper's `timeout` deadline, so that claim was false and both citations are
  Task 9's alone, since Task 9 is what introduces a real `flock`; the constants-block comment at `:1095-1101`
  claiming "PreCompact sweeps this id's stale `.compact*.tmp` temps" describes the broad sweep Task 9
  forbids and must be corrected to the narrow, age-gated, exact-family transition matcher; two FURTHER
  broad-sweep comments, at `:790` (which rests a SAFETY argument on the very sweep Task 9 deletes) and `:951`,
  are unowned by any task before this one and belong here too; the live sweep implementation itself at `:869`
  is the code these three comments describe and must be named as what Task 9 replaces, not merely re-commented;
  and the `COMPACT_SHAPE_PRED` comment at `:1143-1148`, which still asserts two D-2605-forbidden behaviours (the
  hook adding `n`, and a hookstate read-back), must be rewritten to say what the constant is actually for —
  a cheap shape sanity gate (`jq -ce -s`, exact-one-document) on the helper's raw stdout object, applied
  BEFORE the strictly stronger `JOURNAL_RECORD_PRED` validates the merged record, not a persistence or
  read-back mechanism. `COMPACT_SHAPE_PRED` is otherwise unreferenced in the shipped file today; Task 9
  wires it into that one use. **Delete outright** (round 7, option A — Tasks 5/6 landed these; Task 9 removes
  them, it does not rewrite Task 5/6's own plan sections to pretend otherwise): the three rollback functions at
  `ccd/session-hook.sh:792-842` and their call site at `:899`. **Also delete outright (round 8, I6):**
  `_hook_compact_served` (`:985-992`) and its call at `:1375` — it performs exactly the canonical
  `set.served` rewrite D-2605 forbids ("the canonical set is never rewritten"), superseded by §3.3's
  nonce-marker publication, which this task already implements. **Widen `_ws_slug_free` (round 8, I4):**
  after stripping the literal `.<id>.` prefix, match the remainder against §3.4's private-family suffix
  grammar (or the bare, non-dot-leading `.generation` field) and report not-free on a match, with the
  permanent lock's own suffix (`compactions.lock`) the sole named exclusion — the function itself
  changes, not merely its test.
- Modify: `ccd/compact-card.mjs` — retarget `writeAtomic`/`cardCommand` (`:420-431`, `:569-598`) and `main`'s
  required-argument list at two hook-named stage paths (`--set-stage`/`--card-stage`), never a canonical
  `--set`/`--out`, **and (round 8, Critical) `--parent-live`/`--live-agents`** — copied verbatim into the
  staged set exactly as `--scope`/`--agent` already are, since `cardCommand` can no longer re-read them
  off a canonical set it never receives (`ownedSlot`'s current read at `:576`, `:579-580`, is exactly the
  channel round 7 severed with no replacement); `REQUIRED_CARD` (`:787`) gains `parentLive`/`liveAgents`,
  never `trigger`; no slot check, no rollback, no canonical read of any kind. **The wire contract for the two
  new flags is normative (round 9, B-I2/M-8), not left to the implementer:** `--parent-live` accepts exactly
  `true`, `false` or the empty string; `--live-agents` accepts exactly `^[0-9]+$` or the empty string; **empty
  means JSON `null` for both**, which is the hook's own measured encoding (`_hook_compact_scope` leaves
  `CS_PARENT_LIVE=""`/`CS_LIVE_N=""` at `ccd/session-hook.sh:951` and returns on a manual trigger; `:963`,
  `:969`) and the one its own initial-set `jq` already decodes at `:1479-1480`. The helper converts
  exhaustively — empty ⇒ `null`; `true`/`false` ⇒ boolean; `^[0-9]+$` ⇒ integer; **anything else ⇒ a usage
  error (exit 2)**. **`Number(v)` on a possibly-empty value is FORBIDDEN here and must be named as the trap
  in the code's own comment**, because it is this file's established idiom (`:803`,
  `const maxChars = Number(o.maxChars), maxFiles = Number(o.maxFiles), at = Number(o.at)`): measured,
  `Number('') === 0` with `Number.isInteger(Number('')) === true`, so it would publish `liveAgents:0` for
  every manual compaction whose true value is `null` — a tuple §3.0's matrix does not contain, which
  `JOURNAL_RECORD_PRED` rejects, committing no journal line on the dominant population. `REQUIRED_CARD`'s
  `k in o` presence test (`:801`) is satisfied by an empty string and cannot catch it. **"Copied verbatim"
  means the VALUE is the hook's and never derived — not that the string is written unconverted**: the set's
  `parentLive` is a JSON boolean or `null` and its `liveAgents` a JSON integer or `null`
  (`ccd/compact-card.d.mts:38`), so the conversion above always runs. **Delete outright**:
  `ownedSlot`, `slotIsMine`, `rollbackClaimPath`, `reserveClaim`, `hasCanonicalOwner`, `firstCardLine`,
  `firstSetNonce`, `rollbackSet`, `rollbackCard`, `rollbackPair` (`ccd/compact-card.mjs:433-560`).
  **Also in scope, and measured on this tree (round 13):** `measureCommand`'s own docstring at
  `ccd/compact-card.mjs:726-728` still reads "The measurement object the hook merges into hookstate (after
  adding `n`) and appends to the journal" — two behaviours D-2605 forbids, and the only remaining `hookstate`
  occurrence in the file (`grep -n 'hookstate' ccd/compact-card.mjs` returns `:726` alone). Restate it as the
  plan's own Task 8 section already does: the helper measurement object Task 9 enriches into the sole journal
  record, null — never 0, never `"main"` — wherever the set could not say, and no ordinal is persisted.
- Modify: `ccd/compact-card.d.mts` — **delete** the `slotIsMine` (`:42`) and `rollbackHook` (`:50`) type
  exports; **rewrite** `cardCommand`'s option type (`:45-51`), which round 8 (M8) found still declaring
  `out: string; set: string` after round 7's own argv change — replace those two members with
  `setStage: string; cardStage: string` and add `parentLive: boolean | null; liveAgents: number | null`,
  dropping `set`/`out` entirely. **Also (round 9, M7/B-M4) `CompactSet` (`:36-41`)**, whose `served: boolean`
  member (`:39`) is declared REQUIRED although this task removes `served` from every future set writer:
  make it **`served?: boolean`**, with a comment naming it a **tolerated LEGACY INPUT for the isolated
  `measure` path only** — `readSetForMeasure` may still be handed a pre-Task-9 set that carries it, and
  `Measurement.served` (`:57`) keeps its own required `served`, which `measure` still emits and the nonce
  marker overrides. State explicitly that **no `card`-written set carries `served` after this task**, so the
  optional member documents an input this code reads and never an output it writes.
- Modify: `ccd/ccd` — row-generation initialization, `_spawn_start` primary/retry environments and FD
  boundaries, `_reg_purge`, exact cleanup, **the THREE post-action `_reg_purge` callers `cmd_ws_rm`
  (`_rm_prc`, `ccd/ccd:6478`), `_ws_reap_tail` (`_rt_prc`, `:13020`) and `cmd_forget` (`_fg_prc`,
  `:19131`)** — round 12 named only the dead-reg arm's status branch as a change to BUILD, while these three
  were described in the present indicative; BEFORE Task 9 none of the four read `_reg_purge`'s status, each
  falling straight through to an unconditional `_lc_done`/success echo, so all four branches are code this
  task writes (round 13, B-I1) — Task 9 has since built all four, and the anchors above are the LANDED call
  sites, which this replaces the pre-Task-9 numbers with so that this list and the spec's own
  implementation-status paragraph name the same lines — **and
  `_lc_refuse`'s own neighbourhood (`ccd/ccd:4006-4035`, `_lc_fail` through `_lc_refuse`), where Task 9 adds
  the new non-fatal `_lc_refuse_return <act> <id> <tx> <token> <detail> [k v]…` emitter** that emits the `refused`
  fact and RETURNS (round 13, A-I4/A-I5/B-I3; the controller's ruling named the neighbourhood as `:2754-2790`,
  which starts inside `_lc_done`'s body and ends inside `_lc_surface_norm`'s docstring — re-measured to the
  exact emitter pair, `:2756` being `_lc_fail`'s definition line and `:2785` the brace closing `_lc_refuse`).
  **The NAME is `_lc_refuse_return`, not `_lc_refused` (round 14, B-M5):** the earlier spelling sat one
  character from `_lc_refuse` while differing in arity — FIVE positionals against `_lc_refuse`'s four,
  `local a="${1-}" i="${2-}" tok="${3-}" msg="${4-}"; shift 4` at `ccd/ccd:4045` — and in fatality
  (`ccd/ccd:4029`, "EMITS, THEN DIES. Never returns.", `die` at `:4047`), so a mistyped call would shift
  every argument by one AND kill the `ws-gc --prune` sweep at the first declining row, the exact outcome this
  emitter exists to prevent. The name now carries its distinguishing property. **Add the source pin with
  it:** every `_lc_refuse` call site passes exactly four positionals, every `_lc_refuse_return` call site
  exactly five, and the two name sets are disjoint; mutation — retype one `_lc_refuse_return` call as
  `_lc_refuse` ⇒ reds on arity, with the behaviour control that the `ws-gc --prune` forced-refusal fixture
  must still reach the NEXT row. Measured, the new name evades the guard its neighbourhood must evade:
  `server/test/ccd-wsaudit-nonpoison.test.ts:32-35` harvests `_reap_refuse\s+`, `"refused":"`, `'!` and
  `"verdict":"`, none of which it matches, so the pin `expect.soft(scan(src)).toHaveLength(55)` (`:78`) is
  unaffected.
  Beyond that neighbourhood this task also edits
  `_ws_slug_free` (`ccd/ccd:3940-3951` — spelled in full because the clause above names a `.test.ts`, and a
  bare `:N` inherits THAT file; round 8, I4: widened to an
  exact-family dot-leading scan — strip the literal `.<id>.` prefix, then match the remainder against §3.4's
  private-family suffix grammar or the bare `.generation` field; report not-free on a match; the
  permanent lock's own suffix is the sole named exclusion), **and (round 9, B-I5/B-M6) `_ws_slug_residue`
  (`:3953-3962`), widened with the IDENTICAL exact `.<id>.`-prefix strip, the IDENTICAL family-suffix match
  and the IDENTICAL permanent-lock exclusion**, emitting the dot-leading private names alongside the dot-free
  fields, so **every reason `_ws_slug_free` can refuse is a reason `_ws_slug_residue` can name**. Widening
  only the first breaks a shipped contract: `cmd_ws_add`'s refusal at `:4356-4357` is
  `die "slug in use: $slug — $REG/$project-$slug.{$(_ws_slug_residue "$project" "$slug")}"`, so an
  unwidened residue function yields `… — $REG/<id>.{}` — empty braces, naming no file — against the comment
  three lines above it (`:4350-4354`, "The refusal NAMES WHAT IT FOUND … The field list is the reclaim
  instruction"), and `_ws_slug_new` (`:3964-3974`) then skips that slug forever with nothing to tell the
  operator. Re-stamp in this task.
- **`cmd_ws_add`'s refusal MESSAGE at `ccd/ccd:5828-5830` is in this task's modify scope too (round 10,
  B-3)** — round 9 cited it only as the REASON to widen `_ws_slug_residue`, never as a site to change, and
  widening the function alone cannot fix it. The template hard-codes `$REG/$project-$slug.` — a dot AFTER the
  id — while every widened family is dot-LEADING. Measured with the shipped function body in a throwaway
  `$REG` holding `.demo-quiet.compactions.lock-open.1.2.3`: the stripped-suffix return yields the message
  `slug in use: quiet — $REG/demo-quiet.{compactions.lock-open.1.2.3}`, whose named path does NOT exist; the
  full-basename return yields `$REG/demo-quiet..demo-quiet.compactions.lock-open.1.2.3`, which does not exist
  either. **Change both together:** `_ws_slug_residue` emits complete `$REG`-relative BASENAMES (dot-free
  fields as `<id>.<field>`, private families as `.<id>.<suffix>`), and the die prints them as a plain list
  rooted once — `die "slug in use: $slug — in $REG: $(…)"` — dropping the `$REG/<id>.{…}` brace template.
  Note the shipped `, ` separator (`out+="${out:+, }$suffix"`) already breaks that template's implied brace
  expansion even for the dot-free case it was written for: measured, `echo prefix.{uuid,workdir}` expands but
  `echo prefix.{uuid, workdir}` prints the literal braces unexpanded, so it was never a working `rm`
  argument.
- **Comment scope in `ccd/ccd` and `ccd/session-hook.sh`, each a shipped sentence this task falsifies
  (round 9):** `ccd/ccd:1330-1333` ("`_reg_purge`, `_ws_slug_free` and `_ws_slug_residue` all glob
  `"$REG/$id".*` and skip any suffix containing a dot, so `$REG/claude-authdead` is invisible to all three") —
  after the widening the dot-skip is no longer the whole reason, so restate it as measured: the name is
  DOTLESS (nothing follows the id to match `"$REG/$id".*`) **and** matches no `.<id>.`-prefixed private
  family, which is what keeps it out of all three. `ccd/session-hook.sh:1098` ("The same dot-free shape is
  what `_ws_slug_free` scans") — no longer the whole of what it scans; name it alongside the broad-sweep
  sentence at `:1100-1101` already in this task's range, **and name `_ws_slug_residue` beside
  `_ws_slug_free` in it (round 10, A-M2)**, since round 9's own closure rules that "every reason
  `_ws_slug_free` can refuse is a reason `_ws_slug_residue` can name" — a comment naming only one of the
  pair re-creates the half-widening defect in prose. **Pin:** assert `ccd/session-hook.sh` contains no
  comment block naming `_ws_slug_free` as the scanner of the dot-free shape without naming
  `_ws_slug_residue` in the same block; deleting either name reds. (Measured at this commit, the shipped
  `:1091-1101` still carries the OLD text and names only `_ws_slug_free` — this is the live site, not
  Task 2's Step 3 block, which never reached the tree.)
  **`ccd/session-hook.sh:1175-1177` (round 10; ANCHOR CORRECTED round 11, A-I6/B-M3 — it read `:1167-1168`,
  which is a different and CORRECT sentence about `CCRC_WD_CLASS` deriving from the class constant, so an
  implementer following the old anchor would have rewritten a true statement and left the false one
  standing)** — "`single-definition.test.ts` does not scan `ccd/` at
  all — its four roots are the TypeScript packages" — measurably FALSE against the shipped test and in no
  other task's scope. Measured: `grep -n 'does not scan' ccd/session-hook.sh` returns exactly `:1175`; the
  false sentence runs from mid-`:1175` to "addition says." on `:1177`; the REMAINDER of `:1177` and `:1178`
  carry a separate, true
  sentence ("Keeping the three in step is a reading discipline, not a mechanism; if you widen one, widen the
  other two by hand."), so the restatement must not swallow the rest of `:1177` — which is why the range ends
  at `:1177`. Quote the sentence beside the anchor wherever it is cited, so the anchor is self-checking. Only `ROOTS` (`server/test/single-definition.test.ts:32-37`) is TypeScript-only;
  `bashRoots` (`:1115`) is `[<repo>/ccd, <repo>/deploy]`, `BASH` (`:1139`) is every bash file under them plus
  `install.sh`, `holdersOf` (`:1145`) filters that corpus on non-comment lines, and `:1160-1164` pins
  `ccd/ccd` and `ccd/session-hook.sh` as members BY NAME. Restate it as measured: the four TypeScript ROOTS
  do not cover `ccd/`, **but a second bash corpus does**, so keeping the three `CCRC_PROJ_CLASS` spellings in
  step is a reading discipline only because nobody has written that rule — not because no mechanism could
  express it.
  **And WIDEN the audit itself (round 13, A-I1/B-I4): it covers EVERY tracked-file reference in either
  document, not `ccd/session-hook.sh` alone.** For every `<tracked file>:<n>[-<m>]` reference —
  `ccd/session-hook.sh`, `ccd/ccd`, `ccd/compact-card.mjs`, `ccd/compact-card.d.mts` and `server/test/*`
  alike. **STATED SO IT IS SATISFIABLE ON A CORRECT TREE (round 14, A-4) — round 13's "the token quoted
  beside it occurs within exactly those lines" was RED on a correct tree, and the only green path was to
  weaken it:**

  1. **The premise.** The rule governs the relationship between a QUOTATION and a RANGE. Where a reference
     carries no quotation in its clause at all, there is nothing for the rule to check and it does not
     apply — a reference must not be required to quote something, because a correct citation can point at a
     line that has no token to quote. Measured: `ccd/session-hook.sh:1392` is a BLANK line, cited as such
     ("`:1392` is blank, `:1393` starts the next section banner"); a universal form refuses it by construction.
  2. **The rule.** For each `<tracked file>:<n>[-<m>]` reference, AT LEAST ONE quoted token or quoted excerpt
     **in the same clause** occurs within the cited lines. One clause may carry several quotations and one
     quotation may serve several references; one hit anywhere in the clause satisfies it. An excerpt
     containing an ellipsis is satisfied when each of its parts occurs.
  3. **Sub-rule A — a function named while pointing at a statement.** A citation that names a function and
     points at a statement must have its range inside that function's body. This is what lets
     "called from `citedCount` at `:717`" stand (`citedCount` is declared at `ccd/compact-card.mjs:708` and
     `:717` is inside it) while a citation that names a function and lands outside it entirely does not.
  4. **Sub-rule B — `pinned by <test>:N`.** A `pinned by` citation must land on that test's `it(` /
     `describe(` / `expect(` line, because what it asserts is that a named test pins the claim, not that a
     token appears somewhere in a test file.
  5. **Allow-list: quoted HISTORY.** A reference inside the `## Deviations found` ledger entry, or inside a
     quotation the same sentence marks as superseded, is exempt — a record of a corrected anchor must not be
     reddened by the audit that enforces the correction, or the next round deletes the record.

  **Two citations fail under every reading and are corrected in this round rather than left for the audit
  to find:** `holdersOf` is declared at `server/test/single-definition.test.ts:1303` with its body spanning
  `:1303-1304`, so a bare `:1304` names the `BASH.filter(…)` continuation and not the declaration; and
  §3.4's five-site cell cited `server/test/ccd-ws-reap.test.ts:344` beside a quoted `_lc_refuse reap …
  flock-unavailable` string that belongs to `ccd/ccd:12033` and occurs nowhere in that test — that same
  `server/test/ccd-ws-reap.test.ts:344` being the `it(` line titled `refuses to run the destructive verb
  unserialised when flock is missing`, which sub-rule B is exactly the rule for.

  **Non-vacuity and the mutation control.** The audit's own count must be reported: references resolved,
  allow-listed as history, and checked. Mutating any one corrected `ccd/compact-card.mjs` anchor by ±1 line
  must red; re-scoping the audit to `session-hook.sh` alone must make the eight corrected anchors' mutants
  green, which is the pin the widening buys — the merge that brought Task 8 fix round 4's
  `hasFullPathOccurrence`/`hasUniqueSuffixOccurrence` split moved `REQUIRED_CARD` (`:779`→`:787`), the
  `k in o` loop (`:793`→`:801`), the `const maxChars = Number(...)` idiom (`:795`→`:803`) and the
  nonempty-nonce check (`:799`→`:807`), and a round that re-measured the TEST file's anchors across that
  same merge stopped there. **Those four each moved +8 — each verified byte-identical at both ends — but
  the shift is NOT uniform and no other anchor may be repaired by arithmetic (round 14, A-10).** Measured
  against the pre-merge helper (`e5b29a25:ccd/compact-card.mjs`, 820 lines / 39571 bytes; this tree's, 828
  lines / 39768 bytes, so the net is **+8** across three interleaved hunks): `citedCount` moved `:697`→`:708`
  (**+11**), and the function the split renamed moved the other way — `hasAlignedOccurrence` at pre-merge
  `:684` is `hasFullPathOccurrence` at post-merge `:682` (**−2**). Three different displacements in one
  region is why the audit re-measures every reference instead of applying an offset, and the direct control
  on the generalisation is that `citedCount`'s post-merge line is 708, not `697 + 8`.

  **Do NOT add a "verbatim row name" leg.** Round 13's A-M1 clause required that every double-quoted string
  presented as a ROW of a named mutation table occur verbatim in that table; measured, the four strings it
  quoted occur ZERO times in the plan and only inside §5's own quotation of them in the spec, their table
  having been deleted at `188c1d8a`. The assertion was red on a correct tree unless allowed to match its own
  quotation, in which case it was vacuous. §5 now points at the plan's numbered `Step N: Mutation checks`
  items and quotes the plan's actual wording, so the audit needs no such leg (round 14, A-1 = B-I4). **`ccd/session-hook.sh:1115-1119` (round 13, A-M8)** — the shipped `COMPACT_CARD_MAX_AGE` comment
  ("A card or a set older than this belongs to no compaction that can still arrive and is removed unread"),
  in no task's scope before now. Measured, no arm removes an aged canonical SET unread: PreCompact publishes
  over it, compact SessionStart removes only an aged CARD (`:923`), and PostCompact claims and measures it.
  Split it by artifact the way spec §2's row now does — aged card removed unread, aged canonical set still
  claimed and measured with age deciding provenance eligibility only. **`server/test/ccd-authdead.test.ts:68-72`
  (round 13, B-M2)** — the third copy of the same sentence this task's widening falsifies, beside
  `ccd/ccd:1129-1132` and `ccd/session-hook.sh:1098` which round 9 already owns. It reads that
  `_reg_purge`, `_ws_slug_free` and `_ws_slug_residue` "all glob `"$REG/$id".*`, which requires a literal dot
  AFTER the id", and after the widening two of the three no longer do. Its assertions stay GREEN (the marker
  is dotless and matches no private family), so nothing reds — the comment simply becomes a lie, which is the
  `correcting-the-instance-is-not-correcting-the-claim` shape: restate it identically, that the marker is
  invisible because it is DOTLESS **and** matches no `.<id>.`-prefixed private family, not because of the
  dot-skip alone. `ccd/ccd:1822-1827`, whose last line reads
  "`_lc_done` returns 0 on every path, so nothing here can gate the purge" (round 9, B-M5) — this task's own
  lock acquisition falsifies it, and it is in no other task's scope. Restate it as measured, without
  overstating the change: **the emit still carries no condition of its own and still precedes the unlink
  loop**, but the whole function is now gated on the stable lock, so a lock miss yields no purge, no
  purge-done fact, and an `_lc_fail` from the three post-action callers.
- Test: `server/test/session-hook.test.ts` (**delete** the eleven timeout-rollback race tests; move the
  `_hook_write_atomic` verbatim pin at `:2467` onto the new construction in the same commit; **delete or
  retarget** (round 8, I6; enumeration corrected round 9 to FIVE; **corrected again round 10, B-1 — there are
  SEVEN assertions on this field, not five**) every test asserting on the hook-written set's `served`.
  Measured, `grep -n '\.served' server/test/session-hook.test.ts` returns exactly `:2938`, `:2967`, `:2987`,
  `:3016`, `:3038` — but that grammar is blind to the field in PROPERTY position, and measured,
  `grep -nE '(^|[^A-Za-z_])served[[:space:]]*:'` over the same file returns `:2319`, `:2491`, `:2913`,
  `:2979`, `:3011`, `:3032`. Two of those six are genuine assertions on the set the HOOK writes and neither
  document named them before round 10 (measured: `grep -c '2319\|2491'` over both documents returned 0).
  **Why they red:** both sit inside `expect(set).toMatchObject({…, served: false, …})`, and `toMatchObject`'s
  own subset equality FAILS on an absent key — measured against this repo's `@vitest/expect` 4.1.10 by calling
  its internals directly, `equals(actual, expected, [iterableEquality, subsetEquality])` with `actual` lacking
  `served` and `expected` carrying `served:false` returns **false**; with `served: undefined` present it also
  returns false; only a present `false` returns true. So after Task 9 removes the member from the writer, both
  fail in Step 4 as exactly the "unexplained failure" the self-check exists to prevent.
  **Disposition, per assertion, all seven:**
  - `:2938` ("the fact of serving is stamped into the set", inside the `it(` at `:2925`) — retarget to the
    nonce marker's existence: after a successful serve, `$REG/.<id>.compactserved.<nonce>` exists and the
    canonical set's bytes are unchanged.
  - `:2967` ("the winner stamped it", `toBe(true)`, inside the 8-racer consume-once atomicity test at
    `:2959`) — **retarget, do not delete and do not loosen.** Assert that exactly ONE racer's
    `compactserved.<nonce>` marker exists and that the canonical set's bytes are unchanged, KEEPING the
    surrounding 8-racer test and its `:2965` "exactly one of the 8 racers served the card" assertion. This
    is the assertion most likely to be "fixed" by weakening it; it pins consume-once atomicity.
  - `:2987` ("no print, no stamp", inside the `it(` at `:2979`) — retarget to "no marker exists", since the
    emitter returned nonzero and nothing was printed.
  - `:3016` (inside the crossed-pair test at `:3011`) — retarget to "no marker exists".
  - `:3038` (inside "a nonce with no text after it is not served" at `:3027`) — **retarget to "no marker
    exists"**, not delete: it asserts `toBe(false)` against a key the set no longer carries, so left alone it
    fails on `undefined !== false`, and its case (a body-less nonce restores the card and serves nothing) is
    its own.
  - **`:2319` (round 10, B-1)** — `expect(set).toMatchObject({ v:1, scope:'main', …, steered:false,
    served:false, files:null, stats:null })`, inside the §3.0 PreCompact test at `:2310`, asserting on the set
    the HOOK writes. **Disposition: DROP the `served: false` member from the literal.** The field ceases to
    exist on the writer's output; the surrounding test's subject is otherwise unchanged, so nothing else moves.
  - **`:2491` (round 10, B-1)** — `expect(set).toMatchObject({ scope:'main', transcript, steered:false,
    served:false, parentLive:null, liveAgents:null, … })`, inside the §3.1 PreCompact/helper test at `:2486`.
    **Disposition: DROP the `served: false` member**, same reason.
  - **`server/test/session-hook.test.ts:3115-3202` (round 13, B-I7) — the compact-SessionStart cost-ratio
    pin, the one landed assertion this task measurably PERTURBS and the only one that had no disposition.**
    It is `expect(median(compactTimes) / median(cheapTimes)).toBeLessThan(4)` (`:3201`) on exactly the arm
    Task 9 rewrites, with a shipped band of 2.926–3.375 median-over-20 and an estimator already corrected
    once (D-2549, p95 → median); its own comment records that a ~2-fork regression sits inside this row's
    noise floor under every estimator while a ten-fork one is cleanly separated. Task 9 adds roughly six to
    eight external-binary children per invocation to that arm — measured, `type -t` answers `file` for every
    one of `mktemp`, `link`, `rm`, `flock`, `find`, `mv`: the lock-open alias `link`+`rm`, the `flock`, the
    generation-read alias `link`+`rm`, and the marker source `mktemp`+`link`+`rm` — plus up to
    `COMPACT_LOCK_WAIT_SERVE` of real waiting. **Disposition: re-take the interleaved median/median
    measurement on the post-Task-9 arm and re-argue R from THAT sample, recording the new band in the row's
    own comment. NEVER raise the bound to make Step 4 green** — that is the repair the row's D-2549 comment
    exists to forbid. Keep the row's power provable in the same act: a mutation adding one further external
    child inside the compact arm must still red the re-argued R. This is a different measurement from §2's
    `COMPACT_LOCK_WAIT` direction, which measures each HELD SECTION's p95, not this arm's total cost against
    the cheap arm.

  Note `:3032` and `:2913` plant `served: false` inside fixture set literals; those are INPUTS, not
  assertions. `:2979` and `:3011` carry `served:` inside `it(…)` TITLE prose, not code.

  **Make the enumeration self-checking (grammar corrected round 10, B-1).** Add a source scan over
  `server/test/session-hook.test.ts` whose match set is the UNION of two grammars — `\.served` (the read
  position) and `(^|[^A-Za-z_])served\s*:` (the property position) — because neither alone sees both shapes:
  measured at this commit, the first returns the five read sites and none of the property sites, the second
  returns six property sites and none of the read sites. **SCOPE THE SCAN TO THE SET (round 11, B-M7).** Its subject is the
  `served` member of the canonical set document the HOOK writes — the field this task removes — and nothing
  else. Task 9 adds the PostCompact arm and its tests to this same file, and the journal record's sixteen keys
  INCLUDE `served` (spec §3.4; §3.3 step 5 makes it true iff the exact nonce marker exists), so the natural
  end-to-end pin for that mechanism — `expect(journal[0]).toMatchObject({ served: true })`, or
  `expect(readJournal()[0].served).toBe(true)` — matches BOTH halves of the union grammar and belongs to
  neither allow-list class below. Unscoped, Task 9's own new tests red the scan Task 9 just added. So match
  only inside SET contexts — a `readSet()` call, a `setFile()` write, or a set literal — and allow-list
  JOURNAL-record assertions as a class of their own. **Stated allow-list, TWO classes under the new scope, named the way
  the `_reg_purge` non-vacuity control is stated:** (1) **SessionStart(compact) hook fixtures that PLANT a
  canonical set** — `:2913`, inside `plantPair` (declared `:2909`, an `fs.writeFileSync(setFile(), …)`), and
  `:3032`, the same shape inside `a nonce with no text after it is not served` (`:3027`). They are INPUTS to
  the HOOK, whose SessionStart arm reads only the set head's nonce and never the `served` member; round 10
  called them "legacy `measure`-input fixtures", which is the wrong reason — measured, the isolated `measure`
  API is exercised in `server/test/compact-card.test.ts`, a file this scan does not cover, and its legacy
  input tolerance is a separate rule living there (round 11, B-M6). A future editor applying round 10's stated
  reason literally could delete these two as stale `measure` fixtures, or keep a genuinely stale one elsewhere
  on the same authority. **Pin both by their ENCLOSING CONSTRUCT** — an `fs.writeFileSync(setFile(), …)` call
  — not by a free-text class name; moving either line out of a set-planting call reds. (2) **assertions on a
  JOURNAL record** (the sixteen-key row), which must stay free to assert `served` in either position.
  Everything else in a SET context must be gone after Task 9. **Round 10's class (2), the `it(…)` title
  strings `:2979` and `:3011`, is retired: under the SET scope they are excluded BY THE SCOPE, not by an
  allow-list entry** — the same treatment the canonical-write scan gives the helper's `writeAtomic`
  primitives — and they must appear on no entry. **Control for class (2), in both directions:** write one
  PostCompact journal test asserting `served: true` on a committed row and assert the scan is GREEN; with
  class (2) removed it is RED, which is what proves the class is load-bearing rather than decorative.

  **NON-VACUITY control, and a correction to the figure round 10 was handed.** The control asserts the
  pre-fix scan's match set, outside the allow-list, is exactly the **SEVEN** assertions — `:2319`, `:2491`,
  `:2938`, `:2967`, `:2987`, `:3016`, `:3038`. It is worth being exact about what "seven" counts, because the
  number does not belong to either grammar on its own: the union matches **eleven** lines pre-fix — `:2319`,
  `:2491`, `:2913`, `:2938`, `:2967`, `:2979`, `:2987`, `:3011`, `:3016`, `:3032`, `:3038`. **Round 10
  arrived at seven as eleven minus four allow-listed; under the round-11 SET scope the arithmetic is eleven
  minus the TWO `it(…)` titles the scope excludes (`:2979`, `:3011`) = NINE in scope, minus the TWO
  allow-listed planting fixtures (`:2913`, `:3032`) = seven.** Same seven lines, and the control must assert
  all three numbers — eleven raw union matches, nine in SET scope, seven outside the allow-list — so a change
  to any one of them forces the sentence to be re-measured rather than silently absorbed. A control phrased as
  "the property-position scan finds seven lines" would be false — measured, that grammar finds six, only two
  of which are assertions. Prove the scan
  effective in both directions: with `:2319`/`:2491` left as shipped it must be RED before the fix and GREEN
  after, and re-adding `served: false` to either `toMatchObject` literal must red it again. **delete or retarget** (round 8, M6) the broad-sweep test at `:2390` ("sweeps this id's
  STALE compaction temps..."), which plants and asserts against the pre-round-7
  `.$id.*compact*.tmp`/rollback-family basenames this task's exact-family target grammar replaces),
  `server/test/compact-card.test.ts` (**delete** the TWELVE helper slot-check/rollback tests, not ten —
  `:455` ("THE SLOT CHECK..."), `:472` ("rechecks the nonce after render staging..."), and the ten
  rollback-race tests at `:504`, `:525`, `:542`, `:564`, `:592`, `:621`, `:652`, `:681`, `:712`, `:744` —
  their SUBJECT ceases to exist, replaced by the stronger CAS/argv/stage-completeness controls below;
  remove `slotIsMine` from the import list at `:15` and add a step-1 assertion that the module exports no
  `slotIsMine`/`rollback*` symbol; retarget the 15-key-order pins at `:441` and `:500`, which include
  `served` — a field this task's helper no longer writes; and retarget the **FIVE** remaining
  `cardCommand`/CLI calls that still pass `out`/`set` — `:425`, `:493`, **`:772`/`:773`**, `:781`, `:803` —
  to the new `--set-stage`/`--card-stage`/`--parent-live`/`--live-agents` argv. **Round 9 (B-I6) adds
  `:772`/`:773`, which round 8's own corrected "four remaining" still omitted:** `:772` is
  `it('requires a nonempty --nonce for card ownership, before touching its inputs', …)` and `:773` builds a
  full CLI argv carrying `'--out', 'o', '--set', 's'`. It is not one of the twelve tests this task deletes.
  **The nonce-required assertion must MOVE to an argv that already satisfies every other `REQUIRED_CARD`
  member**, or it stops testing the nonce: `main` returns on the FIRST missing key, in `REQUIRED_CARD` array
  order (`ccd/compact-card.mjs:703`, `for (const k of REQUIRED_CARD) if (!(k in o))`), and `nonce` is last in
  that array (`:688-689`) — both re-measured at this tip, where the array already carries the four keys this
  item adds; the `:801`/`:787` this clause previously carried are past the end of a 751-line file. So once the list
  gains `setStage`/`cardStage`/`parentLive`/`liveAgents` and loses `out`/`set`, the old argv makes `main`
  answer `--set-stage is required` and `server/test/compact-card.test.ts:777`'s
  `expect(missing.stderr).toContain('--nonce is required')` fails while `:778`'s empty-nonce assertion
  passes vacuously. After retargeting, `helper([…complete new argv minus
  --nonce]).stderr` must still contain `--nonce is required` (the `REQUIRED_CARD` loop's message) and
  `--nonce ''` must still return USAGE (the separate nonempty check at `ccd/compact-card.mjs:709`, whose message is `--nonce must be a nonempty string` — a different message from the loop's, so the two assertions do test two different guards).
  (round 8, I9/M11 corrected the original "ten" count and the omissions at
  `server/test/compact-card.test.ts:15`/`:441`/`:500`/`:425`/`:493`/`:781`/`:803` — spelled in full because the
  sentence before this one names `ccd/compact-card.mjs`, and a bare `:N` inherits THAT; round 9 corrects round 8's own residual
  omission of `:772`/`:773`. Both rounds undercounted the same way, by asserting an enumeration complete
  without re-measuring it — so re-measure this list against the file before executing, rather than trusting
  it)), `server/test/ccd-lifecycle-purge.test.ts` (move the
  `_reg_purge always journals, and journals BEFORE it unlinks` source-order pin, `:37`/`:111`, onto
  whatever Task 9's edit shifts it to, in the same commit; **strengthen** (round 8, I7) the `:99-147`
  "is unconditional" pin, whose own assertions (`emitAt < loopAt`, no trailing `||`/`&&`) stay green
  under a lock-acquire guard inserted before the emit — add a source-scan assertion that nothing but the
  header comment stands between the function's opening brace and the `_lc_done purge` call except the
  stable-lock acquisition this task adds, so a THIRD statement there reds), `server/test/ccd-workspaces.test.ts`, `server/test/ccd-spawn-split.test.ts`, `server/test/ccd-session-lifecycle.test.ts`, `server/test/ownership.test.ts`, and — **added round 13, B-I2** — `server/test/ccd-reg-set-atomic.test.ts`, whose `:126-127` asserts
  `h.sh('_ws_slug_residue demo quiet-basin').split(', ').sort()` equals `['uuid', 'workspace', 'wrapper']`, the
  BARE field names the shipped function emits (`out+="${out:+, }$suffix"`, `ccd/ccd:3959`). **Disposition:
  retarget to the `<id>.`-prefixed basenames** this task's widened `_ws_slug_residue` emits —
  `demo-quiet-basin.uuid`, `demo-quiet-basin.workspace`, `demo-quiet-basin.wrapper` — never loosen it to a
  substring match: its own comment at `:120-125` says it exists to stop a phantom session id in
  `readRegistryMeasured`, and that is the pin a substring would destroy. This file was in neither the test
  list nor the File-structure row before now, so Step 4 would have failed on a file the extracted brief never
  mentioned. **The other two residue call sites SURVIVE the widening and must not be touched:**
  `server/test/ccd-workspaces.test.ts:220` feeds `:223-227`, which branches only on `residue === ''` versus
  non-empty, and `:284` asserts `toBe('')` — measured, both key on emptiness alone, never on field spelling.

  **The brace-template assertion needed its own disposition, and the round-13 scan could not see it
  (round 14, B-I2; LANDED, re-measured by the whole-branch review).** It asserted the `$REG/<id>.{…}` BRACE
  TEMPLATE that round 10's B-3 ruling required this task to delete from `cmd_ws_add`'s die
  (`ccd/ccd:5830`); after the change the message reads `slug in use: quiet-mesa — in
  <REG>: demo-quiet-mesa.archived`, which does not contain the brace form, so the assertion would have gone
  red on a correct tree. It was neither an invocation of `_ws_slug_residue` nor an assertion on one, so the
  scan above was blind to it. **The disposition — retarget it to the rooted-list form, keeping both halves of
  what the line was buying — IS CARRIED OUT.** Measured at this tip in
  `it('refuses ws-add on the residue the purge is documented to leave')`
  (`server/test/ccd-workspaces.test.ts:243-268`): the brace template occurs nowhere in the file, and the two
  halves stand as `expect(out, 'the root is named once')` (`server/test/ccd-workspaces.test.ts:261`) and
  `.toContain('demo-quiet-mesa.archived')` (`server/test/ccd-workspaces.test.ts:262`), under a comment that
  names the retarget. **And WIDEN the self-checking scan**, which until now covered
  `_ws_slug_residue` invocations and assertions alone: it must cover that set UNION **every assertion on
  `cmd_ws_add`'s die message** — any `server/test/**` assertion naming the literal `.{` brace template, or
  asserting on the `slug in use:` string. Every member of the union must be named in this disposition list,
  and an unlisted one reds.

  **`:143`'s budget bound and `:164-166`'s terminal assertion, re-derived rather than nudged (round 14,
  B-I2).** Measured on the shipped tree by replaying the exact loop under the same `rm` shadow: `FIELDS`
  (`server/test/ccd-workspaces.test.ts:121-123`) has **21** entries; the purge loop skips three of them
  (`hookstate.json` on the `*.*` dot rule, `archived` and `reaping` on the state-marker rule) and so makes
  **18** `rm` calls, and the tail adds three more — `rm -f "$REG/$id.hookstate.json"` (`ccd/ccd:3083`),
  `rm -f "$REG/$id.reaping"` (`:3085`) and the conditional `rm -f "$REG/$id.archived"` (`:3091`) — for **21**
  in total. The bound at `:143` is `FIELDS.length + 2` = **23**, i.e. two budget steps of headroom past the
  last unlink, which is why `:164-166`'s `` .toBe(`${FIELDS.length + 2}:FREE`) `` is reachable at all.
  **That 21 is the SHIPPED count; the post-Task-9 count is a derivation from this task's own contract and
  must be re-measured, not taken from here.** Because `_reg_purge` now takes the mutex, its body additionally
  runs whatever `rm` the lock-init and acquire path perform — by §3.4's protocol, the lock-init source removal
  and the lock-open alias unlink — plus this task's explicit `rm -f "$REG/$id.generation"` after the
  archived/reaping tail. Three more `rm` calls under the shadow takes 21 to **24**, which is ABOVE the current
  bound of 23, so the final budget value would no longer run the purge to completion and `:164-166` would red
  while nothing is actually wrong. **Method, not number:** after the body is written, replay the loop under
  the same `rm` shadow, count the calls on a fully seeded row, and set `:143`'s bound to that count plus 2 —
  keeping the two steps of headroom the shipped bound has — with `:164-166`'s terminal expectation spelled as
  the same expression so the two cannot drift. Record the measured count in the commit. A bound left at 23
  makes the final `FREE` unreachable; a bound raised by guesswork makes the assertion pass while proving
  nothing, which is the failure `:164-166`'s own comment exists to prevent ("the purge never ran to
  completion, so FREE was never proved reachable").

**Interfaces and non-negotiable order:**

1. **Generation contract.** `$REG/<id>.generation` is authorization only and has exactly 36 lowercase ASCII UUID bytes, no terminal LF. It is neither `.uuid`, payload `session_id`, nor journal data. Under the stable lock, classify pathname metadata before reading: genuine absence differs from all present-invalid inputs. Read a present valid regular non-symlink file only through owned hard-link read alias `generation-read.<pid>.<RANDOM>.<RANDOM>` plus retained FD/current-canonical same-inode checks; never `_reg_get`, `_reg_read`, or direct `cat`. FIFO, directory, all symlink forms, unreadable, uppercase, empty, multiline, malformed, replacement, and mismatch refuse promptly and are never repaired/replaced/removed/folded to absent. Only genuine absence mints from validated `_plat_uuid`, writes to a source made by `mktemp` template `generation-init.XXXXXX` (result `generation-init.<mktemp6>`), then no-clobber links it; EEXIST reclassifies winner. Sources/aliases clean on every handled path and age out exact-only under later lock. `.generation` and private generation residue block reuse.
2. **Permanent lock protocol.** Canonical `$REG/.<id>.compactions.lock` spans generations/reuse and is never unlinked, replaced, repaired, truncated, recreated or swept. Initializer under `umask 077` uses `mktemp` template `compactions.lock-init.XXXXXX` (result `compactions.lock-init.<mktemp6>`), validates source, publishes only `link source canonical`, removes source on success/EEXIST/failure, and never opens canonical. Acquirer links canonical to absent exact `compactions.lock-open.<pid>.<RANDOM>.<RANDOM>` alias (two independent decimal `$RANDOM` values, collision retry, no precreated final alias), validates alias, opens alias R/W anonymous FD, then unlinks owned alias. Require FD regularity, current canonical regular/non-symlink, and FD/canonical same inode before flock, after `flock -w "$1"` — the wait is the acquire helper's first positional parameter, never a constant spelled inside it, which is what lets `COMPACT_LOCK_WAIT_SERVE` and `COMPACT_LOCK_WAIT` share one acquire path — and before mutation. Canonical disappearance/replacement, FIFO, symlink, directory, `mktemp`/`link`/`flock` absence, alias race, or mismatch refuses and never recreates canonical. **(round 9) "`flock` absence" here means the lock-MECHANISM is unavailable, and the acquire helper must report it as its own distinct condition, established by `command -v flock` BEFORE any acquire attempt — never inferred from a refused or timed-out acquire, which spells its failure with the same exit status (measured: both `1`). What each CALLER does with that condition differs and is item 9's ruling: the three hook arms refuse (closed); `_reg_purge`, row creation and `_spawn_start` proceed (open).** Cleanup is one owned source/alias path. Mutation to direct `exec {fd}<>"$lock"` must red.
3. **PreCompact lock scope — round 7, option A (staging-only helper), superseding round 6's Important 2.**
   Round 6 released the lock across the helper's own canonical rewrite, arguing that rewrite was "already
   gated on nonce ownership." Measured false: the helper's check (`slotIsMine`) and its act (the canonical
   write) were two separate steps — check-then-act, not a compare-and-swap — so a sibling PreCompact could
   acquire the freed lock, publish `scope:"ambiguous"` and remove the card, and have that verdict destroyed by
   the first helper's own later rename. Round 7's fix: **no canonical pathname may appear in the helper's argv
   at all.** PreCompact retains the acquired lock through scope/overlap resolution, the sweep, and the initial
   canonical set publication, then **closes it before invoking the bounded helper**, which it now runs with
   `--set-stage`/`--card-stage` (two private paths it names itself), scope/agent/at/nonce, and (round 8,
   Critical) `--parent-live`/`--live-agents` — the two provenance fields the helper otherwise has no way
   to learn now that `--set` is gone, copied verbatim from PreCompact's own already-computed values
   (§3.0), never derived by the helper and never carried by a `--trigger` flag — never `--set`/`--out`.
   A held
   `flock` descriptor is inherited across fork/exec in bash and released only when every referencing descriptor
   closes, so no lock descriptor may remain open across the helper's fork, exactly as round 6 established. It
   **reacquires** the lock immediately after the helper returns or times out and, still under that lock,
   revalidates generation and re-reads the canonical set's head (the bounded, fork-free `read -N` idiom the
   hook already uses at `:934-935` — bash has no `slotIsMine` counterpart, so this head-parse **is** the ownership
   check now) to confirm this nonce still owns the slot. Because the check and the act — reconfirm, then
   rename — now happen inside the SAME held lock section, this is a genuine compare-and-swap, where round 6's
   helper-side version could never be one. On success: rc 0 renames the card-stage file to canonical, then (in
   stage 2 only, after the steer switch is absent) prints `STEER_TEXT` **and then** (round 8, I1) stamps `steered`
   onto the still-private set-stage file — a `jq` rewrite of that one stage, never of canonical, since the
   stage is not yet canonical — to `(that printf's own exit code == 0)`. **(round 9, M-9) The "stage 2 only"
   scopes BOTH acts, the print and the stamp**, since the stamped value IS that print's exit code and there is
   nothing to stamp without it: **in Plan A neither runs**, and the helper's staged `steered:false` is
   published unchanged by the rename below. Then rename that UPDATED set-stage
   file to canonical — card before set, one uninterrupted section, so the steering bit is decided, stamped
   into the private stage, and only then published by the rename, without a second lock acquisition (a bare
   rename cannot itself "carry" a value; round 8 corrects an earlier draft that implied it could). rc 3 renames only
   the set-stage file (`files: []`); no card, no print. **Newly reachable under option A:** rc 0/3 but the
   reconfirm FAILS (a sibling published its own verdict during the helper's run) — publish nothing, print
   nothing, stamp `steered` on nobody's set, and remove only this process's own two stages (age-eligible
   residue on a failed reacquire); the compaction is then measured against whatever the sibling published. Any
   other exit or the timeout: publish nothing, remove only this process's own stages. The helper writes each
   stage through its own `<stage>.part` temp plus rename, so a stage exists iff it is complete, and
   performs no slot check, rollback, or canonical read at all — every ownership decision and canonical
   publication is this bash arm's alone.
4. **SessionStart order.** Immediately after operator-off guard, validate environment generation, acquire
   stable lock (round 8, I2: wait = `COMPACT_LOCK_WAIT_SERVE`, 2 s — the one acquisition a human is
   waiting on; every other acquisition in this plan uses `COMPACT_LOCK_WAIT`), and revalidate under lock
   **before every card/set/marker existence or age inspection, read, match, claim, deletion, emission, or marker publication**. Retain that FD through all actions and final generation check. **(round 9) Why that hold is compliant, stated as the standing rule's own qualifier rather than as an exemption:** this arm DOES fork — measured against the shipped file, `find` and `rm -f` at `ccd/session-hook.sh:2129`, the `( set -C; : > "$claim" )` subshell at `:953` (a `( … )` group forks; measured, `BASHPID` differs), `mv -f` at `:954`, `link` at `:964`/`:970`, `rm -f` at `:955`/`:965`/`:971`/`:974`, `jq -cn` inside `_hook_emit_context` at `:94`, plus this task's own marker `mktemp`/`link`/`rm` — and a held `{fd}<>` descriptor is NOT close-on-exec (measured: an exec'd child's `/proc/self/fd` lists the parent's lock fd). It holds safely because every one of those children is SYNCHRONOUS and reaped inside the section, so none can outlive it: the close-before-fork rule APPLIES here and is SATISFIED, never disapplied. Do not restore the earlier "this arm forks nothing" justification. Barrier replacement before acquisition sees only new state. **(round 9, B-I1) Spell the nonce validator for the engine that runs it.** This arm is bash, so the gate is `[[ "$nonce" =~ ^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$ ]]` — **`$`, never `\z`**: POSIX ERE has no `\z` escape and `regcomp` reads it as a literal `z`, so measured on bash 5.2.21 the `\z` spelling REJECTS every well-formed nonce and ACCEPTS exactly one ending in a literal `z`, which would serve nothing on every compaction and make every journal record read `served:false` forever. `$` is sufficient here, not merely tolerable: measured, it matches the well-formed nonce and rejects the trailing-`z` form, a trailing LF, and an embedded LF followed by more text. (jq/Oniguruma's `\z` in the journal predicates is correct there and unchanged — measured `true`/`false` on the same two strings; jq's `$` would NOT be, since it accepts a trailing LF.) This file's own `case`/`${#x}` shape-gate idiom (`ccd/session-hook.sh:975-976`) is an equally correct spelling if preferred. The mutation pair: mutating the validator to `\z` reds (nothing served, no marker), and planting a nonce with a trailing literal `z` and asserting it is REFUSED reds under the `\z` spelling — effective in both directions. Match/claim under lock; emit before exact marker source publication; only same-nonce extant final marker is idempotent. From the already validated safe nonce, make source with `mktemp` template `compactserved-source.<nonce>.XXXXXX` (result `compactserved-source.<nonce>.<mktemp6>`), disjoint from final `compactserved.<nonce>`, and remove it after successful `link`, EEXIST, and all handled failures. No set rewrite. Crash after output before marker remains honest false-negative evidence.
5. **Settlement order.** Under lock, first test the canonical set's pathname for existence (never inferred from a `link` return code alone, since a genuinely absent canonical and a present-but-unlinkable one both surface as a failing `link`). **Canonical set genuinely absent:** take no claim, run `measure` with no `--set`, and commit one record with `scope:null` and all six provenance fields null — never fold this into the link-failure branch. **This branch's premise is now true, not merely asserted (round 7):** with PreCompact's own rollback deleted, every canonical existence transition happens inside a held stable-lock section and every existence test happens inside the same lock, so "absent under the lock" has exactly one meaning — nothing was ever published for this compaction. The mutation-effective control is a source scan (no code path renames, unlinks, or replaces the canonical set outside a held lock region), not merely this behavior test. **Canonical set present:** save canonical age, use no-clobber hard link to never-precreated `compactpost.<pid>.<RANDOM>.<RANDOM>.claim`, prove same inode, unlink canonical first, then touch claim. If unlink fails, remove only verified claim and prove canonical original bytes+mtime unchanged. If touch fails after unlink, no-clobber link claim back to canonical, prove same inode, then remove only verified claim. A restore collision/failure/unprovable case never overwrites occupant or discards only verified claim; retains claim as exact recovery residue. Claim FD input is retained/verified; no reopened claim or canonical path reaches helper.
6. **Final transaction and cleanup.** Reacquire/validate lock — using the SAME `COMPACT_LOCK_WAIT` the settlement acquisition above uses (round 7 retires the separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT`: both are off the hot path and both lose a durable artifact on a miss, so they share one bound rather than each inventing its own) — and generation/claim FD identity before raw JSONL stage/rename; retain the existing exact 16 keys, full physical-line JSONL and terminal LF predicate, its `\z` anchors (**jq/Oniguruma only — round 9: bash has no `\z` and reads it as a literal `z`, so no bash arm in this task may copy that spelling; see the `--nonce` validator in item 4 and spec §3.4, "Which regex engine anchors what"**), integer/relational rules (plus the CRLF-tolerant completion of the enumeration), no persisted `n`, exact-one helper gate, FD CAS, stage cleanup, and one-attempt/external-replay boundary. Claim and marker cleanup occurs **only** under successfully reacquired/validated stable lock. If helper/dependency/final lock/generation/FD/journal transaction fails and final lock is not safely held, close retained FDs, remove only unlinked own snapshot/stage, leave verified claim plus exact marker residue, and write no journal. Later locked age recovery removes only this ID's exact claim and separately safe nonce marker/source, with no retroactive record. This rule also covers touch-restore residue.
7. **Target family table and exact sweeps.** Before any ordinary sweep relies on the spec §3.4 target table, migrate the current pre-D-2605 hook set-temp producer **and the SessionStart claim producer** to it — **(round 9, B-I4) BOTH change their name construction; neither "carries forward unaltered in shape", the clause round 8 carried and this round deletes.** The SessionStart claim's shipped shape is `<pid>.compactcard-claim.tmp` (measured: `claim="$REG/.$id.$$.compactcard-claim.tmp"`, `ccd/session-hook.sh:952`) and its target row is `compactcard.<pid>.<nonce>.session-claim.tmp` — a different grammar, buildable at that point because §3.3 step 2 validates the nonce before step 3 claims. Leaving it at the shipped shape leaves a name matched by neither PreCompact's exact-family sweep nor `_reg_purge`'s exact cleanup, so a SessionStart killed between its noclobber `: > claim` and its `mv` (or between the `mv` and the `rm`) leaks a permanent dot-leading file — the exact leak this migration exists to close — and under the widened `_ws_slug_free` an unmatched residue reads FREE, re-handing the slug with a stranger's claim present. **The legacy-transition allowance therefore names TWO grammars**, the set temp's two-id-occurrence `<pid>.<id>.compactset.tmp` and the claim's `<pid>.compactcard-claim.tmp`, each matched only after exact literal-ID stripping, age expiry and a validated stable lock. **Delete every rollback producer outright** (helper and hook alike) rather than migrate it — option A's helper has no canonical pathname to write and therefore nothing to roll back, so a rollback name has no target-grammar successor. **The hook's actual set-temp producer, `_hook_write_atomic`, emits `<pid>.<id>.compactset.tmp` after one literal-`.<id>.`-prefix strip (the id occurs twice in its constructed name), never the bare `<pid>.compactset.tmp` an earlier draft of this plan and spec assumed; the hook writes no card temp at all.** That producer is `ccd/session-hook.sh:780`, `local tmp="$REG/.$id.$$.${1##*/}.tmp"`, on the PRE-D-2605 tree this item plans against — Task 9 has since superseded that line, which is why the anchor stays here rather than moving to the migrated construction. Migrating this producer moves Task 2's own landed pin (`server/test/session-hook.test.ts`, `toContain('local tmp="$REG/.$id.$$.${1##*/}.tmp"')`) onto the new construction in the same commit. The helper's two producers are NEW, not migrated: two hook-named stage paths (`compactset.<pid>.<nonce>.stage` / `compactcard.<pid>.<nonce>.stage`), each written through the helper's own `<stage>.part` temp plus rename — a stage exists iff it is complete — and renamed into canonical only by the hook, under its reacquired lock. The table has exact grammars for set/card/journal, the hook's set-temp writer, the helper's two stage names, SessionStart claim, PostCompact claim, final marker, permanent lock, lock init source, lock-open alias, marker source, generation, generation source/read alias, and stage/snapshot. It defines `<pid>`, safe `<nonce>`, `$RANDOM`, and `<mktemp6>`; it has no undefined placeholders. A transition cleanup may match only a fully enumerated legacy grammar after literal exact-ID stripping — the two-id-occurrence set-temp shape above, not the bare one, **and (round 9) the SessionStart claim's `<pid>.compactcard-claim.tmp`** — plus age expiry and validated stable locking. Every ordinary checker strips literal exact ID prefix then validates the full target suffix; no family uses a loose terminal/pid/random/tmp pattern, `*compact*.tmp`, or broad glob. Successful source/alias paths leave zero owned artifacts; crash cleanup is age-gated under stable lock or exact purge. Permanent lock is ignored for slug reuse; `.generation` and all other listed private residue are not. Of the table's "never precreated" rows, only the `link`-created ones (PostCompact claim, final marker, lock-open alias, generation-read alias) are that; the SessionStart-claim row is a deliberately precreated noclobber placeholder, then claimed by rename, and the helper stage row is neither — the hook names an absent path and the helper's own `.part`-then-rename discipline is what makes it appear complete.
8. **Row creation/spawn boundaries.** Row creation locks only residue check/generation initialization and closes before arbitrary setup or `_spawn_start`. **It acquires BEFORE writing any row field, and a MISS fails CLOSED (round 13, B-I5):** die with a retryable message naming the lock, leaving NOTHING — no `.uuid`, no `.generation`, no partial row — so nothing irreversible has happened and re-running is the whole remedy. `_spawn_start` acquires once immediately before primary `_tmux_new_session`, safely **reads and validates — never mints —** generation into a shell variable (round 11, B-M4: "ensures" reads as mint-if-absent and a reviewer took it that way; minting is row creation's `generation initialization` alone, which is also how this table's `ccd/ccd` row divides the task, and a row with no generation is answered by the standing fail-closed rule, never by a mint here. The stronger reading — that `_spawn_start` is a second spec-sanctioned minter — was refuted and is not adopted), exports `CCRC_SESSION_GENERATION=<exact value>` into the child env, then **closes the lock before building or running either `_tmux_new_session` command** — never holds it through tmux creation, because the tmux server daemon (or anything it spawns) can outlive the critical section and no compliant path may rely on tmux calling `closefrom()`. Releasing first is safe because every lifecycle arm already refuses on an environment/canonical generation mismatch under its own lock, so a row purged or reused in the gap is simply refused downstream, never silently accepted. Resume fallback independently acquires immediately before retry, requires the invocation's same current-row generation (never mints into purged/reused row), exports it, and closes before the retry's own fork, by the same rule. No nested opens/leaked sourced-ccd FDs. **A CONTENDED MISS at `_spawn_start` — the acquire times out at `COMPACT_LOCK_WAIT` — fails OPEN (round 13, B-I5):** spawn WITHOUT `CCRC_SESSION_GENERATION`, print a visible stderr warning naming the lock, and state the cost plainly — that session's compaction lifecycle is inert until its next respawn, because a hook with no generation fails closed for lifecycle work only. Failing closed here is rejected: a rescue swap contending with the outgoing pane's own PreCompact, which can hold the lock for seconds, would not come back up, and a swap must never wedge on a compaction lock. The warning is printed rather than swallowed because a 5 s contended hold at spawn time is itself an anomaly, and because — like §4's generation-REUSE row — the resulting inertness cannot self-heal by any later event. It is self-consistent with the generation gate rather than an exception to it: a session with no generation cannot hold this lock, so there is no publisher the missed acquisition could have raced. **Test both:** a real-process fixture holding the stable lock longer than `COMPACT_LOCK_WAIT` while `_spawn_start` runs must show the session coming up, carrying no `CCRC_SESSION_GENERATION`, warning on stderr, and publishing nothing at its next PreCompact — mutating `_spawn_start` to die on the miss reds it; the same shape for row creation, where the miss must leave `$REG` byte-identical.
9. **Locked purge and honest callers.** `_reg_purge` locks/validates before measurement, mutation, or `_lc_done purge`; captures measurements under lock; deletes exact artifacts/fields and generation last; never permanent lock. **(round 8, I7) The lock acquisition this task adds is the ONE new statement allowed between the function's opening brace and the unconditional `_lc_done purge` emit** — nothing else may stand there, since the landed `ccd-lifecycle-purge.test.ts:99-147` pin only checks emit-before-unlink-loop and no trailing `||`/`&&`, which stays green under a silently inserted conditional guard; the test must be strengthened alongside this change (Test bullet, above), not left as the sole protection. **The purge-done mechanism is capture-then-emit-EARLY, not "only after success"**: measured against the shipped function (`ccd/ccd:1817-1828`) and its own comment ("UNCONDITIONAL, and with NO `tx`: this is not half of a pair. It is the terminal fact..."), `_lc_done purge` is journaled BEFORE the unlink loop runs, using values captured via `_reg_get` while the fields still exist — `server/test/ccd-lifecycle-purge.test.ts`'s own describe title, `_reg_purge always journals, and journals BEFORE it unlinks` (`:37`; the enclosing `it('is unconditional: the emit is not guarded by any condition in the source')` at `:99`; the source-order assertion itself at `:115`, with `emitAt`/`loopAt` bound at `:111`/`:112` — one pin, addressed the same way everywhere since round 11, M4), pins exactly this. A round-5 draft of this plan described the opposite ("only after successful purge"); that phrasing is not restored here because it is falsified by the pinned test's own title, not merely superseded — what Task 9 must preserve is the CAPTURE-then-EARLY-EMIT mechanism, and must move the `:37`/`:99`/`:115` source-order pin onto whatever its own edits shift it to, in the same commit (the same treatment this plan already gives `session-hook.test.ts:2467`). **Task 9 adds a one-terminal-fact guard, keyed on the CALLER's own act and on a `_lc_tx`-MINTED, NON-EMPTY tx (round 12, B-I3; re-keyed round 13, A-I5/B-I3):** exactly one terminal fact per (act, id, tx) among a caller's own `_lc_done <act>`, `_lc_fail <act>` and the new `_lc_refuse_return <act>`. `_lc_tx` (`ccd/ccd:3390-3402`, `printf '%s.%s.%s'` at `:3401`) can never return empty, so the non-empty key is exactly the set of minted transactions. **Three emitters fall OUTSIDE the guard, all for the same literal-empty-tx reason — stated here once:** (a) `_lc_refuse`, declared `act id token detail [k v]…` with NO tx positional (`ccd/ccd:4029`), emitting a literal `""` tx (`:4033`), and never returning (`die` at `:4047`) — so it can neither be bucketed with a tx-bearing terminal nor be followed by one; (b) `_lc_done purge`, exactly one call site (`ccd/ccd:3038`; `grep -c '_lc_done purge' ccd/ccd` = 1) with an empty tx by design, its own comment stating why ("UNCONDITIONAL, and with NO `tx`: this is not half of a pair", `:1822-1823`); and (c) `cmd_ws_restore`'s `_lc_done restore "$id" ""` (`:6780`) beside its `_lc_fail restore "$id" ""` at `:6838` and `:6844` — same act, same id, same literal empty tx, which a `""`-admitting guard would red on the CORRECT shipped tree. Measured, **twenty-one** lifecycle emits in `ccd/ccd` carry a literal empty tx — `_lc_done` at `:1735`, `:1828`, `:1907`, `:1951`, `:4491`, `:5324`, `:5647`, `:5738`, `:6293`, `:6780`, `:6885`, `:12657`, `:13492`, `:13948`, `:14058`, `:15315`, `:15382`, `:15415`, `:15471` and `_lc_fail` at `:6838`, `:6844`; the four `_lc_refuse … ""` sites (`:6630`, `:6638`, `:6646`, `:6706`) pass an empty ID, not an empty tx. So admitting `""` buckets unrelated acts across the whole file, and its only producible fixtures are nonsense pairs — `ccd ws-add`'s `_lc_done create "$id" ""` (`:4491`) against a later `ccd ws-rm`'s `_lc_done purge "$id" ""` (`:1828`) on one id. That, not an absence of fixtures, is the reason for the caller-keyed, minted-tx key (round 13, A-M5 corrects this bullet's earlier "no producible fixture at all" and its count of three). The caller-keyed tuple has real subjects: `_ws_gc_prune_row`'s orphan arm emits `_lc_done destroy … "$lctx"` (`:11813`) and `_lc_fail destroy … "$lctx"` (`:11816`) on the same (act, id, tx), and `cmd_ws_rm` the same at `:4913` and `:4858`. Neither pair can double-fire today — an `if`/`else`, and `die`'s `exit 1` (`:1022`) — so this is a MUTATION pin: it reds when a fixture flattens that `if`/`else` or drops that `die`. **The generation-last rule needs a mechanism, not just an outcome:** `.generation` is a dot-free suffix like any ordinary registry field, so the existing purge loop's skip condition (`ccd/ccd:3060`, whose shipped form adds the term `"$suffix" == generation` to the two it carried before Task 9) must be extended to `archived || reaping || generation`, and one further explicit `rm -f "$REG/$id.generation"` (`ccd/ccd:3107`) added after the existing archived/reaping tail — otherwise the loop deletes it in ordinary glob order and "generation last" is a no-op. **A LOCK MISS or unsafe lock is nonzero, emits no purge-done fact, deletes nothing, and asserts no success. A REMOVAL FAILURE is a different condition and this bullet conflated the two until round 10 (B-4): the unlink loop runs strictly AFTER the emit, so by the time any `rm -f` can fail the purge-done fact is already journaled** — such a run returns nonzero with the fact on disk and registry/generation possibly still standing. Writing "emits no purge-done" for that case is the same falsified round-5 phrasing this very bullet declines to restore two sentences earlier, and an implementer obeying it would gate the emit on the loop, which is the mutant `ccd-lifecycle-purge.test.ts:37`/`:99` exists to red. **Ordering, in full:** the reap lock (outermost, when reached through `_ws_reap_locked`), then the stable compaction lock, then the lifecycle journal/rotation lock — never any pair reversed. `cmd_ws_rm`, `_ws_reap_locked`, and `cmd_forget` call `_reg_purge` only AFTER irreversible action, so a lock miss there is reported as a named `_lc_fail <act> <id> <tx> <token> <detail>` (naming what completed and that registry/generation remain), never a suppressed success string and never folded into a bare decline — this is `_lc_fail`'s documented distinction from `_lc_refuse` (a refusal precedes anything irreversible, a failure follows it, `ccd/ccd:4020-4021` — the quoted sentence spans those two lines; `:2756` is the function's own definition line, and this anchor read `:2756` until round 12, B-M5). Only `_ws_gc_prune_row`'s dead-reg arm calls `_reg_purge` BEFORE irreversible action and so alone may DECLINE — **"Decline" was a code change there rather than the shipped arm (round 12, B-I2) — and Task 9 HAS since built it, so this item is re-measured to the landed tree (round 14, A-I2: the previous round moved the call-site anchor onto the built line while leaving the prose saying the status is never read, which the built line itself falsifies).** The pre-Task-9 reason it had to be built, on `8e457995`: `ccd/ccd:9` is `set -uo pipefail` with no `-e`, so an ignored `_reg_purge` status was silent, and the arm there (superseded, `8e457995:ccd/ccd:11665-11670`) ran `_reg_purge "$project-$slug"` (`:11668`) without reading it, then UNCONDITIONALLY `_lc_done destroy … "$lctx"` (`:11669`) and `_gc_reclaimed "dead registry entry …"` (`:11670`) — a refusing purge reported as a completed `destroy` plus an operator-facing `reclaimed` line while the registry row and its `.generation` still stood, repeated on every sweep, the false success `_reg_purge`'s own "never claims success" rule forbids. **What this task's modify scope asked for, and what now stands at `ccd/ccd:13588-13653`:** the arm captures into `_pr_prc` (`:13601`, `:13602`) and branches `== 3` (`:13603`), `== 2` (`:13609`) and `!= 0` (`:13619`); each non-zero arm emits `_gc_declined` (this function's own decline reporter, the same shape as `:12554`, `:12560`, `:12666`) at `:12611` and `:12655` beside exactly one `_lc_refuse_return destroy "$project-$slug" "$lctx" …` (`:13602`, `:12643`), and `_lc_done destroy` (`:12657`) with `_gc_reclaimed` (`:12658`) are reached only through the status-0 `else` (`:12656`). **The refusal is not optional (round 13, A-I4):** measured, `:11665-11667` has already run `local lctx; lctx=$(_lc_tx)` and `_lc_intent destroy … "$lctx" verb ws-gc …` before `_reg_purge` at `:11668`, and `_gc_declined` (`ccd/ccd:13206`) is `GC_DECLINED=$(( … )); _gc_row declined "$1"` — a printf report row, not a lifecycle emit — so a decline reported through it alone leaves that minted intent with ZERO terminal facts, permanently, on every sweep. **So Task 9 also ADDS the emitter:** `_lc_refuse_return <act> <id> <tx> <token> <detail> [k v]…`, a sibling of `_lc_fail` in `ccd/ccd:4006-4035` that emits the `refused` fact and RETURNS. `_lc_refuse` cannot be reused — it "EMITS, THEN DIES. Never returns." (`:4029`, `die` at `:4047`) — and `ws-gc --prune` must keep sweeping the next row. Every minted tx then closes with exactly one terminal fact and no intent is orphaned. No rollback fiction. Disclose and bound, rather than special-case: `_reg_purge` on an id with nothing else registered still mints the permanent lock via the same acquire helper every caller uses (exercised today by `ccd-lifecycle-purge.test.ts`'s `_reg_purge never-existed`), leaving one small dotfile per ever-purged id forever — bounded by total historical id count. **`_ws_slug_free` globs `"$REG/$id".*` (id, then dot) and is today structurally blind to every dot-leading private family, the permanent lock included.** Round 8 (I4) resolves this by widening the FUNCTION, not by weakening the pin: strip the literal `.<id>.` prefix from every dotfile in `$REG` and match the remainder against §3.4's private-family suffix grammar or the bare `.generation` field; report **not-free** on a match, with the permanent lock's own suffix (`compactions.lock`) the SOLE named exclusion. The pin plants `.demo.compactions.lock-open.1.2.3` (representative of the widened dot-leading class) alongside a second live id `demo.quiet` and asserts each answers only for its own id — a substring match instead of an exact `.<id>.` prefix strip would leak across ids and reintroduce the nested-id hazard the existing dot-free check was built to avoid. **(round 9, B-I5) `_ws_slug_residue` (`ccd/ccd:5353-5362`) is widened in the SAME task, with the IDENTICAL prefix strip, family match and permanent-lock exclusion**, so every reason `_ws_slug_free` can refuse is a reason `_ws_slug_residue` can name; otherwise `cmd_ws_add`'s refusal (`:5077-5079`) names no file, falsifying the shipped contract at `:5068-5072` and the "Refusing to build is the safe direction, it is visible" argument at `:4555-4559`. `ws-rm` and `forget` can now visibly decline against an in-flight compaction holding the stable lock; that is a disclosed, correct cost of ownership safety.

**(round 9, B-I8) The lock MECHANISM being unavailable is not the same condition as the lock being held, and this task must not conflate them.** `flock(1)` is util-linux and absent from stock macOS/BSD (measured: `type -t flock` answers `file`, so there is no builtin fallback). **Ruling (SCOPED and gated round 10, A-I2/B-2): mechanism-absence fails CLOSED for the three hook arms, and OPEN — conditionally — for the three `_reg_purge` callers that carry no flock guard of their own.** Round 9 asserted a blanket over "ccd's own registry operations" without measuring any of ccd's five shipped `command -v flock` sites. Measured at this tip: `_lc_rotate` (`ccd/ccd:3611`) and `_tmux_new_session` (`:16026-16037`) fail OPEN; **`cmd_ws_add` (`:5059-5060`), `cmd_ws_restore` (`:7568-7570`) and `cmd_ws_reap` (`:11025-11027`) already fail CLOSED**, the last pinned by `server/test/ccd-ws-reap.test.ts:344`, `it('refuses to run the destructive verb unserialised when flock is missing', …)`, and carrying ccd's own doctrine verbatim at `ccd/ccd:12013-12014` — "NOT a degraded mode. Without `flock` the serialisation is absent … so the destructive verb does not run" (the shipped comment wraps mid-sentence, so the ellipsis steps over the comment marker rather than omitting words). **All five keep their shipped disposition; this task must not touch any of them.** So `ws-reap` is NOT among the verbs this ruling rescues — it is refused before it can ever reach `_ws_reap_locked` (`:11071`) → `_ws_reap_tail` (`:11417`) → `_reg_purge` (`:12013`), because `_lc_refuse` "EMITS, THEN DIES. Never returns." (`:3355`) — and `ccd ws-add` does NOT "continue" either: it dies at `:5059-5060` before `_ws_slug_free` (`:5078-5079`) and before any registry row exists, so "row creation … continue" holds only for row writes that do not pass through `cmd_ws_add`. **What IS governed:** `_reg_purge` reached through `cmd_ws_rm` (`:5667`), `cmd_forget` (`:16642`) and `_ws_gc_prune_row` (`:12595`), plus generation init/export in row creation and `_spawn_start`.

**The fail-open is GATED on the ABSENCE of `$REG/<id>.generation` (round 10).** Fact (iv) establishes mechanism-absence with `command -v flock`, a property of the CALLING PROCESS's PATH, while fact (ii) reasons about a mechanism-absent BOX. On this Linux fleet the gap cannot open — `flock` is `/usr/bin/flock` (measured), the hook's environment descends from ccd's own tmux pane so ccd's PATH is the ANCESTOR of the hook's, and `ccd/ccd:19` states "Both production fleet boxes are GNU/Linux" — but it CAN on the darwin port: `ccd/ccd:621-642` records that "a LaunchAgent gets launchd's own minimal PATH" and that this "already bit this port once", and `_svc_job_path` (`:648-654`) appends `/opt/homebrew/bin` and `/usr/local/bin` only into the per-session plist, so a supervised hook can resolve `flock` while `ssh <mac> 'ccd forget <id>'` does not. **`<id>.generation` is the witness, not the permanent lock** — the lock spans row generations and is minted even by a purge against a never-existed id, so its presence proves history, not a live regime, and gating on it would wedge a genuinely flock-less box fleet-wide. The generation field has all three properties this task already specifies: it is minted ONLY by a flock-capable row creation (the fail-open path skips generation initialization), deleted LAST by purge (item 9 below), and replaced on row reuse ("safe reuse mints a fresh generation"). So a PRESENT generation proves this row's hooks were handed one and may hold the lock now. **Generation present + `flock` unresolvable ⇒ `_reg_purge` fails CLOSED** with the distinct mechanism-absent refusal. **TWO post-action callers report it, not three (round 11, A-I5/B-M5 — the spec was corrected in the same round and this sentence is the copy that would otherwise have survived it):** `cmd_ws_rm` (`ccd/ccd:5667`) and `cmd_forget` (`:16642`) each emit one named `_lc_fail`; `_ws_gc_prune_row`'s dead-reg arm (`:12595`) reaches `_reg_purge` as its FIRST destructive act (measured: `_lc_tx`, `_lc_intent destroy`, `_reg_purge`, then a terminal fact) and DECLINES — **and that same measured sequence is why "unchanged" was wrong (round 12, B-I2), on the arm as it then stood: it read no status, so unchanged it would have answered a refusal with `_lc_done destroy` and `_gc_reclaimed`, which is superseded here because Task 9 built the branch (round 14, A-I2).** At this tip it branches on the status and emits `_gc_declined` (`:12611`, `:12655`, the same shape as `:12554`, `:12560`, `:12666`) with neither — `_lc_done destroy` (`:12657`) and `_gc_reclaimed` (`:12658`) are reached only through the status-0 `else`. `_ws_reap_locked` is unreachable, `cmd_ws_reap` having died at `:11025-11027`. **this is RECOVERABLE** — re-run the verb from a flock-capable PATH — because the refusal itself adds nothing irreversible, which answers the stranding objection. **Generation absent ⇒ fail OPEN**: no hook on that row ever received a generation, so no hook arm ever ran the lifecycle, so there is nothing to race. **Name the generation channel as the mechanism that makes fact (ii) true** on a consistent box: a flock-less `_spawn_start` exports no `CCRC_SESSION_GENERATION`, and a hook with no generation fails closed for compaction lifecycle work — so every hook arm refuses regardless of its own PATH. **A shared fixed absolute-path candidate list for `flock` is REJECTED as the primary fix:** it misclassifies a box whose `flock` sits off-list as inert even though `command -v` finds it — the worse direction under §10's residual, and sufficient on its own — and ccd and the hook ship as separate `install_atomic` targets so any list change has a window where one side carries it. **A third reason was offered and is measurably wrong; record the correction rather than the reason (round 10):** the claim that a second spelling would drift "with no scan over `ccd/` to catch it", resting on `ccd/session-hook.sh:1175-1177`'s shipped comment ("`single-definition.test.ts` does not scan `ccd/` at all — its four roots are the TypeScript packages"; the anchor read `:1167-1168` until round 11, A-I6/B-M3 — measured, `grep -n 'does not scan'` returns exactly `:1175` and the sentence ends on `:1177`, while `:1167-1168` carry a different and CORRECT sentence), is FALSE against the shipped test. `ROOTS` (`server/test/single-definition.test.ts:32-37`) is TypeScript-only, but `bashRoots` (`:1274`) is `[<repo>/ccd, <repo>/deploy]`, `BASH` (`:1298`) is every bash file under them plus `install.sh`, and `holdersOf` (`:1304`) filters that corpus on non-comment lines — with `ccd/ccd` and `ccd/session-hook.sh` pinned as members at `:1319-1323`. A single-spelling pin over `ccd/` is therefore buildable. **Add that stale comment to this task's comment scope beside `:1098`**, since it tells the next reader no mechanism exists where one does. **Two caveats, stated:** the mint-after-test window is narrowed, not closed (and only for a row still live enough to compact); and a box that genuinely loses `flock` wedges its generation-PRESENT rows until `flock` returns. The argument is spec §3.4's four facts, all of which this task must keep true: (i) row creation, spawn and `_reg_purge` predate D-2605 and never needed this lock, which exists to serialize compaction-ARTIFACT publishers; (ii) on such a box no compaction artifact is ever published, because the hooks refuse — so there is no competitor to exclude; (iii) generation publication is already atomic through no-clobber `link` with EEXIST-then-reclassify (measured: `link src existing` ⇒ rc 1 `File exists`, nothing changed; `link src fresh` ⇒ rc 0, same inode), which resolves the only race the flock would have serialized there; (iv) mechanism-absence is a STATIC property of the userland established by `command -v flock` **before any acquire is attempted** (measured: rc 1 without it on PATH, rc 0 with it), where contention is established by an acquire that actually ran and refused or timed out (measured: `flock -w 1` against a held lock ⇒ rc 1). Both spell their failure `1`, so the acquire helper must carry the distinction in WHICH probe answered, never in an exit status. **This is NOT the "second lock-free concurrency regime" §10 forbids, and say so in the code comment:** that prohibition is about the HOOK publishing contended compaction artifacts unlocked as a fallback; nothing here does that — the hook arms still refuse totally, and what proceeds is ccd's own registry destruction, which publishes no compaction artifact and by (ii) races no hook on such a box.

- [ ] **Step 1: Write failing fixture-HOME tests**

1. Add deterministic compact SessionStart barriers proving generation/off guard order, pair replacement before acquisition, retained FD lock scope, aged byte identity on old/mismatched generation, marker-after-output, same-nonce idempotence, and source cleanup; plus target-family producer migration before ordinary sweep and exact legacy-transition-only cleanup. **Add (round 8, I6):** a source scan asserting no `jq … .served` write and no write to the canonical set outside PreCompact's two locked publications, plus a behavior test that after a successful serve the canonical set's bytes are unchanged and the nonce marker exists — replacing every deleted `_hook_compact_served` assertion. **Add (round 8, I2):** hold the stable lock 3 s, then fire compact SessionStart; assert it returns having served nothing within ~2 s using `COMPACT_LOCK_WAIT_SERVE`; passing `COMPACT_LOCK_WAIT` (5 s) at that call site instead serves at ~3 s and reds. **Add (round 9, B-I1) the nonce-validator pair, effective in both directions:** fixture-HOME SessionStart(compact) with a real hook-minted nonce and a matching card — assert the card IS served and `$REG/.<id>.compactserved.<nonce>` exists; mutating the validator to the `\z` spelling reds (nothing served, no marker, since bash reads `\z` as a literal `z` and no well-formed nonce ends in one). Second direction: plant a nonce with a trailing literal `z` and assert it is REFUSED — the `\z` spelling accepts it, so that leg reds under the mutation too. **Add (round 9, B-I4) the SessionStart-claim migration pair:** assert the shipped claim name matches the §3.4 table grammar `compactcard.<pid>.<nonce>.session-claim.tmp`; and plant `$REG/.<id>.<pid>.compactcard-claim.tmp` aged past `COMPACT_CARD_MAX_AGE` beside a same-aged foreign-id lookalike, run a validated PreCompact lock holder, and assert the this-id residue is swept while the foreign one survives. Leaving the producer at its shipped shape reds the first assertion; leaving its legacy grammar out of the transition matcher reds the second during the migration window.
2. Add real-process lock race tests: old inode held while canonical disappears; alias link/open/flock/final-check replacement; no recreated canonical or split critical section; FIFO/symlink/directory/missing `mktemp`/`link`/`flock`; zero successful source/alias artifacts and exact crashed residue cleanup. **Add a real fork-then-release test:** acquire the lock, fork a real child that outlives the parent's own `exec {fd}>&-`, and assert a fresh acquirer succeeds within `COMPACT_LOCK_WAIT` — this reds today and the existing shape-only "early close" fixture does not catch it; apply it to PreCompact-around-the-helper, `_spawn_start`-around-tmux-creation, **and (round 9, A-I2) compact SessionStart, which holds the mutex across its ENTIRE body and is the one acquisition a human waits on, yet had no mechanism at all while the close-before-fork rule was declared inapplicable to it.** For that third leg: enter the arm with the stable lock held, have the arm's held section start a child that outlives it (`sleep 5 &`), let the arm return and close its FD, and assert a fresh acquirer succeeds within `COMPACT_LOCK_WAIT_SERVE`. **Backgrounding any command inside that section must red.** Control, measured on bash 5.2.21 with real processes: all-synchronous children ⇒ fresh acquirer succeeded in 424 ms (bounded by the holder's own 500 ms lifetime, no extra delay from the forks); one `sleep 5 &` ⇒ fresh acquirer timed out for the full 3 s wait after the holder's section had already returned. The pin is effective in both directions. **Add the TWO SOURCE-ORDER PINS spec §3.1 assigns to this task (round 11, B-M8 — round 10 stated them in the spec and named no owning task; measured, "source offset" returned ZERO hits in this plan and "exactly two `find`" appeared only inside `## Deviations found`, which Task 11's extractor bounds away from every brief, so the implementer was never asked for either):** over `_hook_compact_pre`, **(a)** the acquire-helper call site's source offset is GREATER than `_hook_compact_scope`'s and `_hook_graph_measure`'s and LESS than the overlap `find`'s, and the release precedes the `_hook_timeout … node … card` call — moving the acquire above the scope call reds, which is the mutation that would reverse round 8's I8 correction; and **(b)** the exact MULTISET of fork-creating commands between the acquire and the release equals the section as built, so adding or deleting ANY child there reds, not only a third `find`. Run (b) with `strace -f -e trace=clone,clone3,fork,vfork,execve` over the built `_hook_compact_pre`, the way §3.1's second held section is already measured. **State the multiset PER SCENARIO (round 12, A-I4/B-I5 + B-M2).** The UNCONDITIONAL subset every **PUBLISHING** run produces is: two `find` (`ccd/session-hook.sh:1433`, `:1449`), **the `at=$(_hook_epoch_ms)` command substitution (`:1460`)**, the `jq -cn` (`:1473`), `_hook_write_atomic`'s publishing `mv -f` (`:997`), and this task's own generation-read `link` plus alias-unlink. **"Every PUBLISHING run", not "every run" (round 13, A-M9):** measured, `_hook_write_atomic`'s printf-failure arm (`ccd/session-hook.sh:996`) runs `rm -f "$tmp"; return 1` and never reaches the `mv -f` at `:782`, so on the write-failure branch this list's last member is absent — the mirror of the error this bullet's own closing sentence warns about. Both required scenarios below are publishing runs, so the subset holds for each; a third scenario forcing the printf to fail asserts the subset MINUS that `mv -f`, PLUS `:781`'s failure `rm -f`. `:871` is a fork and was missing from every earlier spelling of this list: measured on this box (bash 5.2.21), `strace -f -c -e trace=clone,clone3,fork,vfork,execve` over that one statement reports exactly **one** `clone` against **zero** for an identical harness calling `_hook_epoch_ms` without the substitution, because `$( )` forks a subshell even when the body is builtin-only (`_hook_epoch_ms`'s `EPOCHREALTIME` path, `:34-42`, execs nothing). Do NOT hoist `at` above the acquire to make the old list true: `at` is the publication timestamp protocol step 7 mints the nonce from, and it must be taken inside the section that publishes. The CONDITIONAL members are asserted only in a run that takes their branch — the ambiguous-card `rm -f "$cardf"` (`:865`) only when `CS_SCOPE` is `ambiguous` (and that arm releases at step 8, never opening the second section); `_hook_write_atomic`'s failure-path `rm -f` (`:781`, `:782`) only on a write failure. **The redundant-canonical-alias unlink is NOT a member (fix round 2, A-I4):** it is WITHDRAWN (D-2756, spec §3.1 item 5) and `_hook_compact_pre` performs no `-ef` test to condition it on, so a multiset containing it is red on a correct tree — and this bullet, which the spec itself nominates as the authority the pin is written against, was still instructing an implementer to include it. Assert at least the ordinary non-ambiguous run and the ambiguous run, each against its own expected multiset. A SINGLE expected list naming every conditional member is red on a correct tree — no one run can produce them all — which is the same unsatisfiable-equality class this plan's own canonical-write allow-list was re-specified to escape.
2b. **(round 12, A-I5/B-I6) Add the card-text injection source scan**, restoring the §4 safety invariant the chain deleted with no relocation. Over `ccd/session-hook.sh`'s three compaction arms, assert (a) every `jq` invocation that receives lifecycle or graph text receives it through `--arg`/`--argjson`/`--rawfile` — never interpolated into the program's text — and (b) no `eval`, no `bash -c`, and no unquoted expansion of a card/set/summary/graph-derived variable appears in a command word. NON-VACUITY, mandatory: the scan must FIND both `_hook_emit_context`'s `jq -cn --arg c "$text"` (`:94`) and the initial set build's `--arg`/`--argjson` run (`:875-885`); a scan finding nothing cannot red. Mutations, **Plan A**: replace `--arg c "$text"` with an interpolated jq program ⇒ reds; and, over the new `mktemp`/`link`/`rm`/`jq` statements this task adds around nonces, claim names and marker names — all built from graph- and payload-derived text — build any command word by unquoted expansion or any `jq` program by interpolation ⇒ reds. **The `steered` stage stamp is STAGE 2 / PLAN C ONLY and is NOT a leg of this matrix (round 14, A-3 = B-I7):** this task builds no such statement, spec §3.1 item 10, §3.5 and §6 each saying the stamp is one of the two stage-2-only acts that do not run in Plan A. Do not build one to satisfy the leg — that ships a stage-2 act into Plan A, which §3.1 protocol step 13 forbids; record the leg beside §3.5 and move on.
3. Add settlement tests for hard-link mtime order, unlink failure exact canonical bytes+mtime, touch failure restoration, restore collision preserving occupant/claim, kill windows, and final-lock-timeout residue/no-journal/later-age-cleanup, bounded by `COMPACT_LOCK_WAIT` (round 7 retires the separate final constant; settlement and the final transaction now share one bound). **Add a genuinely-absent-canonical-set test:** run PostCompact with no `.compactset` present and assert exactly one journal line commits with `scope:null`; a fixture that folds this into the link-failure branch must red. **Add the parameterized-wait control:** hold the stable lock 3 s while only the final transaction waits on it, and assert exactly one journal line still lands using `COMPACT_LOCK_WAIT`; passing `COMPACT_LOCK_WAIT_SERVE` (the 2 s, human-facing bound) at that call site instead must red.
4. Add generation tests for absent concurrent mint, valid same row over spawn/resume, every invalid object refusal/no mutation, missing `_plat_uuid`, source cleanup/crash residue, and literal direct-shared-write mutation. **Add an explicit byte-count test** (`wc -c` = 36, not a pattern match alone) covering `_plat_uuid`'s own trailing-LF emission, so a naive implementation that writes 37 bytes is caught rather than permanently wedging the row. Add row/create/primary/retry sleep-boundary and all early-return same-shell FD tests, including a mutant that keeps the lock open across either `_tmux_new_session` fork.
5. Hold lock more than two seconds through `_reg_purge` and all four actual fixture-HOME caller routes. Require, for the three post-action callers (`cmd_ws_rm`, `_ws_reap_locked`, `cmd_forget`), a named `_lc_fail` — not a suppressed success and not a bare decline — naming completed action and retained registry/generation; the dead-reg caller alone may DECLINE, and its decline must be BUILT — assert a `declined` row naming the id, **exactly ONE `refused` fact for that minted `$lctx` and no `done`/`fail` for it (round 13, A-I4)**, no `reclaimed` row, and the registry row and `.generation` still standing, with the sweep continuing to the next row; restoring `8e457995:ccd/ccd:11665-11670`'s status-blind arm (superseded at this tip by `ccd/ccd:12607-12672`) reds it, and dropping the `_lc_refuse_return` emit reds it too by leaving the `intent destroy` of `ccd/ccd:12579-12581` with zero terminal facts. Pin generation-last **as a mechanism**: a fixture that removes `generation` from the purge loop's `archived`/`reaping` skip condition must red by deleting it out of order, not merely by asserting the file is eventually gone. Pin reuse fresh generation and dotted/shared-prefix isolation. **(round 8, I4)** plant `.demo.compactions.lock-open.1.2.3` alongside a second LIVE id `demo.quiet` and assert `_ws_slug_free` reports not-free for `demo` only — the permanent lock alone must NOT, and `demo.quiet` must answer free for itself; pin that a never-existed id still mints exactly one lock file and nothing else. **(round 8, I7)** strengthen `ccd-lifecycle-purge.test.ts:99-147`'s "is unconditional" pin with a source-scan assertion that nothing but the header comment and this task's new lock acquisition may stand between the function's opening brace and the `_lc_done purge` emit — a third statement inserted there (e.g. a conditional gate) must red even though the existing emit-before-unlink-loop and no-trailing-`||`/`&&` assertions stay green. Pin the one-terminal-fact guard with a fixture it can actually produce (round 12, B-I3): flatten `_ws_gc_prune_row`'s orphan `if`/`else` (`ccd/ccd:13809` / `:13812`) so `_lc_done destroy` and `_lc_fail destroy` both fire under one `$lctx`, and separately drop the `die` after `cmd_ws_rm`'s `_lc_fail` (`:6425`, `die` at `:1223`) so its own `_lc_done destroy` (`:6547`) is reached — each must red, and deleting the guard must make both green. Add the GREEN control the minted-tx key buys (round 13, B-I3): drive `ws-restore` to a landed undo plus a failed spawn and assert the guard PASSES — `cmd_ws_restore` emits `_lc_done restore "$id" ""` (`:6780`) and `_lc_fail restore "$id" ""` (`:6838`/`:6844`) for the same act and id under a literal empty tx, so a guard admitting `""` reds on the correct shipped tree; widening the guard to admit empty-tx facts must red that control. Do NOT ask for a fixture forcing `_lc_fail` and `_lc_done purge` to share a `tx`: measured, `_lc_done purge`'s tx is the literal empty string at its single call site (`:1828`) and `_lc_tx` never returns empty, so no such fixture exists. Move the `ccd-lifecycle-purge.test.ts:37`/`:99`/`:115` source-order pin onto Task 9's edited `_reg_purge` body in this same commit. **(round 10, B-4; RE-SPECIFIED round 11, A-I4/B-I3, because the round-10 grammar was red on the correct tree AND blind to the one mutation it exists for) Add a DOCUMENTATION-CONSISTENCY scan beside that pin**, since the source-order assertion stays green under the prose regression and that is exactly why the prose regression survived three rounds. **What round 10 got wrong, measured at its own commit:** its regex, run over both documents, returned ZERO matches in the spec and FIVE in this plan (four at the scan paragraph, one in the D-2605 ledger), while its stated three-site allow-list named three SPEC sites that match nothing — §3.4's "only after successful purge" quotations contain none of the regex's alternatives at all, and §6's quotation is HARD-WRAPPED mid-phrase across two physical lines, so a line-scoped or whole-file grammar never crosses it. The guard was therefore simultaneously red on a correct tree and vacuous against a restored sentence that happens to wrap at this document's ~110-column width, which the surviving §6 quotation demonstrates it does. **THE SCAN, STATED SO IT CAN BE BUILT.** **Corpus:** exactly two files, named — `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` and `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`. **Grammar: PARAGRAPH-JOINED text, not physical lines.** Split each file into paragraphs on blank lines; within a paragraph, strip each physical line's leading and trailing whitespace and join the lines with ONE space. A line-scoped grammar is what made the guard vacuous, and the joined form is what makes the wrapped §6 quotation visible — so the join is load-bearing, not cosmetic. **Pattern 1** (the purge-emit regression): `/may not emit .{0,40}until completed|removal failure[^.]*no purge-done|mutation failure[^|]*no purge-done/i`. **Pattern 2** (the pre-gate four-caller rule, round 11, A-I2): `/_reg_purge[^.]{0,80}four callers[^.]{0,60}keep working/i`. **Allow-list, ONE rule, stated as a mechanism:** a match is allow-listed if and only if BOTH hold — (i) the match sits ENTIRELY inside a backtick-delimited or double-quote-delimited span of the joined paragraph, and (ii) that same paragraph contains at least one RETRACTION MARKER from this exact list, case-insensitively: `declines to restore`, `superseded`, `said the opposite`, `retract` (which also matches `retracted` and `retraction`). Everything else is a live claim and reds. Quotations exist in order to retract the phrasing they quote and must not be deleted by the scan that enforces the retraction — a scan that reds on the record of the correction teaches the next round to delete that record, and the whole point of this guard is that such deletions are what kept the regression alive. **The enumeration of the retracted sentences is ORDERED so the scan can see it without an exception:** restoring any of the four must red it — §6's "may not emit its terminal fact until completed"; §4's combined lock/mutation row; this plan's own "Lock miss/unsafe/removal failure is nonzero, emits no purge-done"; and §3.4's "or removal failure" disjunct. **NON-VACUITY control, mandatory.** Before the allow-list is applied, pattern 1's RAW match set over the paragraph-joined corpus must number exactly SIX — one in the spec (§6's wrapped retraction quotation, which a line-scoped grammar finds ZERO times, measured, and which is therefore the control that proves the join works), three in this paragraph (the regex literal above and two quoted sentences), and two in the D-2605 ledger entry — and ALL SIX must be allow-listed, leaving ZERO live matches (measured on the round-11 tree: RAW=6, ALLOWED=6, LIVE=0). If the raw count drops below six the join or the corpus is broken and the scan is proving nothing; if the live count rises above zero a retracted sentence has come back as a live claim. Note what the containment half of the rule enforces in practice: a quoted retracted phrase must sit WHOLLY inside one quotation, so an enumeration that lets an alternative match run from inside one quotation, across prose, into another reds — which is what both of round 10's own live matches did, and why this round reordered them rather than widening the rule. Pattern 2 has exactly ONE raw match on the round-11 tree, measured — this sentence's own quotation of the retracted rule, which the allow-list covers — so pattern 2's control is BOTH that count and the restoration mutation: restore "`_reg_purge` and its four callers keep working exactly as they do today" to §3.4's platform-outcome paragraph as a LIVE claim and it must red, while this quotation of it must not. **Two-direction control for pattern 1:** restore §6's sentence WRAPPED across two physical lines and assert it reds — a line-scoped grammar stays green, which is the control proving the normalisation is load-bearing — and restore it on one line and assert it reds too. **(round 9, B-I5; STRENGTHENED round 10, B-3) The refusal must NAME what it found, and every path it names must EXIST:** plant `.demo-quiet-basin.compactions.lock-open.1.2.3` in a fixture `$REG` beside a second live id `demo-quiet-basin.mesa` and run `ccd ws-add demo quiet-basin` — **POSITIONAL, because `--slug` is not a flag `cmd_ws_add` has (round 14, B-I1)**: its usage is `ccd ws-add [--no-rc] [--surface <word>] [--actor <text>] <project> [slug]` (`ccd/ccd:5725`) and its arg-loop catch-all `*) lc_args+=("$1"); shift ;;` (`:4950`) binds `project` to the literal `--slug`, which `_ws_project_valid` (`:4530-4532`) accepts, so the verb dies at `[[ -d "$main/.git" ]] || die "not a git repo: $main"` (`:4978`) before the flock gate (`:5059`), `_ws_slug_free` (`:5078`) and the die template (`:5092`) — (a) would pass for the wrong reason and (b)/(c) would fail on a CORRECT tree. `server/test/ccd-workspaces.test.ts:249-251` spells the same operator path, and `CCD_WS_SLUG` (`ccd/ccd:5385-5388`, used at `server/test/ccd-workspaces.test.ts:272`) is an equivalent spelling. Assert **(a)** it REFUSES, **(b)** the `die` message contains that exact basename — not `slug in use: quiet-basin — <REG>/demo-quiet-basin.{}` — and **(c) every filesystem path the message names EXISTS** (parse the message, `stat` each path). **(c) is the mutation-effective part:** it is RED under the round-9 text as written, because the `$REG/<id>.{…}` template cannot express a dot-leading name, and GREEN only once `cmd_ws_add`'s die is changed alongside the function. Reverting `_ws_slug_residue` alone reds (a)+(b) while `_ws_slug_free`'s own not-free pin stays green, so the two functions are pinned as a pair and cannot drift apart again. **(round 9, B-I8; REWRITTEN round 10, A-I2/B-2) Lock-mechanism absence:** run a fixture HOME with `flock` made unresolvable by SHIMMING `command` — `command() { [[ "${1-}" == -v && "${2-}" == flock ]] && return 1; builtin command "$@"; }`, the idiom `server/test/ccd-ws-reap.test.ts:357` already uses — **never by emptying PATH**, because every stub in that suite spells its own passthrough `command git`/`command find`. Assert, leg by leg: (a) `ccd ws-add` REFUSES, exit non-zero, stderr containing its shipped `refusing to create a workspace unserialised`, and creates no registry field; (b) `ccd ws-reap` REFUSES with its shipped `flock-unavailable` / `refusing to run the destructive verb unserialised` and emits no `purge` fact; (c) `ccd ws-rm`, `ccd forget` and `ccd ws-gc --prune` COMPLETE on a **generation-ABSENT** row, with exactly one `_lc_done purge`; **(d) SPLIT IN TWO (round 11, A-I5/B-M5)** — (d1) `ccd ws-rm` and `ccd forget` on a **generation-PRESENT** row REFUSE with the distinct mechanism-absent condition and each emits exactly ONE named `_lc_fail` and no `_lc_done purge`; (d2) `ccd ws-gc --prune` on the SAME row DECLINES, emitting neither `_lc_fail` nor `_lc_done purge`, because its dead-reg arm reaches `_reg_purge` before any irreversible act — **and this leg must assert the decline POSITIVELY and the false success NEGATIVELY (round 12, B-I2), or the shipped arm passes it**: assert a `declined` row naming the id, **exactly ONE `refused` fact for that minted `$lctx` (round 13, A-I4)**, NO `_lc_done destroy` and NO `_lc_fail` for that `tx`, NO `reclaimed` row, and `$REG/<id>.uuid` plus `$REG/<id>.generation` still standing. A leg asserting a THIRD `_lc_fail` is unsatisfiable here: `_ws_reap_locked` is never entered, `cmd_ws_reap` having died at `ccd/ccd:12032-12034`. Mutations: making `ws-gc --prune` emit `_lc_fail` reds (d2); restoring the status-blind arm Task 9 replaced (`8e457995:ccd/ccd:11665-11670`, superseded at this tip by `ccd/ccd:12607-12672`) so a `_lc_done destroy` and a `reclaimed` row appear reds (d2); suppressing either reporter reds (d1); (e) the three hook arms publish NOTHING (no card, set, stage, claim, marker, or journal line); (f) `_ws_slug_free` answers consistently with that state. Mutations, each reddening exactly one leg: deleting `ccd/ccd:5810-5811` or `:12032-12034` reds (a)/(b) — and neither may be "fixed" by loosening those shipped guards; making `_reg_purge` refuse regardless of generation reds (c); making it proceed regardless of generation reds (d1) and (d2); making the hook arms fall back to an unlocked publish reds (e). Establishing mechanism-absence by ATTEMPTING AN ACQUIRE rather than by `command -v flock` before it reds — **but not for the reason round 10 gave (round 11, M7).** This fixture shims the QUESTION and leaves the real `flock` on PATH, so measured inside it, `command -v flock` answers **1** while a direct `flock -w 1 <fd>` on the row's lock answers **0**: the mutant concludes "mechanism present", proceeds, and reds (d1)/(d2). Add the control asserting that direct `flock -w 1` answers 0 inside this fixture, so the redness is attributable to the probe substitution and not to a missing binary. The GENERAL argument — that `command -v` absence and a contended `flock -w` both spell their failure `1`, so the distinction must live in WHICH probe answered — is fact (iv) (measured: uncontended acquire 0, contended acquire 1, `command -v` on a PATH without the binary 1; a genuinely missing binary invoked as a command answers **127**, a third value neither fact names).
6. **(round 7/8, option A) Add the NINE staging-only-helper controls, replacing the twenty-three deleted rollback/slot-check race tests (twelve in `compact-card.test.ts`, eleven in `session-hook.test.ts` — round 8, I9 corrects the earlier "ten"/"twenty-one" counts):**
   - The helper cannot reach canonical: run the card command with both canonical files already present and assert both are byte-identical afterward; restoring either canonical write inside the helper reds this.
   - No canonical path in the helper's argv: extend the landed argv-assertion fixture to require `--set-stage`/`--card-stage` and to forbid `--set`/`--out` outright; passing `--set` reds. **(round 8, Critical)** the same fixture must also require `--parent-live`/`--live-agents`; dropping either reds.
   - **(round 8, Critical; THIRD LEG added round 9, A-I1/B-I2) The provenance channel itself:** run the full PreCompact arm at `auto`/`main`, `auto`/`subagent` **and `manual`/`main`**; assert the canonical set after publication carries `liveAgents:0,parentLive:null`, `liveAgents:1,parentLive:false` and **`liveAgents:null,parentLive:null`** respectively, and that `measure --set <it>` yields a record `JOURNAL_RECORD_PRED` accepts (non-null `scope` and `cited` on the two auto legs; on the manual leg, merged with `trigger:"manual"`, exactly one journal line commits). **The `manual`/`main` leg is the ONLY one that can red either mutant, and the two-leg version of this row was therefore overclaiming:** a scope-derivation table is CORRECT for both auto legs — the helper receives `scope:"main"` for `manual`/`main` and `auto`/`main` alike and no `--trigger`, and `ambiguous` never reaches it — so mutating the copy into a derivation leaves both auto legs green; and `Number(o.liveAgents)` likewise leaves them green while turning this leg's `null` into `0` (measured: `Number('') === 0`, `Number.isInteger(Number('')) === true`), a tuple §3.0's matrix does not contain and `JOURNAL_RECORD_PRED` rejects, so no journal line commits at all. **Plant a graph for this leg.** The existing manual-trigger fixture elsewhere in this plan runs with NO graph planted, so `_hook_gate_tree` refuses and the `card` subcommand is never invoked; it pins the hook's own initial `jq` write (which already maps `""→null` correctly) and cannot see the helper's argv-copy path at all. Mutation A: change the helper's conversion to `liveAgents: Number(o.liveAgents)` ⇒ only the manual leg reds. Mutation B: replace the copy with a scope-derivation table ⇒ only the manual leg reds. Control: with the shipped `'' → null` conversion, all three legs are green.
   - The CAS: a sibling barrier publishes `{ambiguous}` and removes the card while the helper runs; assert the originating PreCompact publishes nothing, the sibling's set survives byte-for-byte, no card exists, and only this process's own stages are gone; publishing without re-reading the nonce under the reacquired lock reds.
   - Close-before-fork by effect (already covered by item 2's fork-then-release test — do not duplicate, cross-reference it here).
   - Stage completeness: kill the helper mid-write (between its `.part` write and rename) and assert that NEITHER a stage file NOR its `.part` survives — the arm's own residue sweep removes the `.part` too — and that the hook publishes nothing. §5's row carries the same amendment (whole-branch re-review B-M2) and D-2802 records why the narrower intra-`writeAtomic` residual ships as a SOURCE pin instead.
   - Publication order and the steering bit — **the PLAN A half only (round 10, A-I3; the order leg re-mechanised round 11, B-M9)**. **Leg 1 is a SOURCE-ORDER pin, not a behaviour fixture:** over `_hook_compact_pre`'s reacquired held section, assert the card-stage `mv`'s source offset is LESS than EVERY set-stage `mv`'s, **and assert the counts beside the order — exactly one card-stage rename and exactly N set-stage renames, N pinned (round 12, B-M4)**: protocol step 13 has two publishing arms (rc 0 renames card-stage then set-stage; rc 3 renames set-stage alone), so a per-arm `case "$helper_rc" in 0) mv card; mv set ;; 3) mv set ;; esac` has TWO set-stage renames and "the set-stage `mv`'s offset" is undefined. Either factoring is allowed; the pin records which shipped, and splitting or merging that rename changes N and reds. Swapping the two statements reds, and the CONTROL is that with them swapped every behaviour test stays green — which is what shows a behaviour fixture could never have produced this red. Round 10 asked for "assert the card-stage rename precedes the set-stage rename (swapping them reds)" with no mechanism named, and in Plan A there is none to find: the two renames are adjacent inside ONE held lock, the print and the stamp are "(stage 2 only)" and neither runs, so no concurrent hook can observe the intermediate state and the post-arm state is byte-identical under either order — an unpinned outcome, which is the defect class the round-10 split existed to close. (The alternative, forcing the set-stage rename to fail and asserting a canonical card beside the pre-helper set, is §4's own forced-rename-failure state and stays available; the source-order pin is chosen because it needs no injected failure.) **Leg 2 is producible as written:** the arm publishes the helper's staged `steered:false` **byte-for-byte** — run the helper standalone into a temp stage with the same argv and compare; any hook-side rewrite of that member reds. That no `jq` ever rewrites the canonical set is carried by the inverted canonical-write source scan, not by this row. **The print → stage-stamp → set-rename ordering is NOT assertable here and moves to Plan C / stage 2, owned by no Task 9 step**, marked the way §3.5 and §3.6 already are: round 9 scoped "(stage 2 only)" to BOTH the print and the stamp and states three times that Plan A runs neither, and Global Constraints add "Plan A prints nothing new … Plan C alone amends R1 for steering stdout" — so in Plan A there is no print, no `jq` stamp and no ordering between them, and no fixture can red "stamping `steered` before the print" or "stamping under a second lock acquisition". Leaving it here would be D-2548's own recorded defect class — a §5 row promising a runtime red that is mathematically unreachable — reopened by the commit that created the scoping (round 8, I1; corrected round 10).
   - Parameterized wait (already covered by item 3's control above — cross-reference it here rather than duplicating).
   - Absent-canonical has exactly one meaning: a source scan asserting no code path renames, unlinks, or replaces the canonical set outside a held stable-lock region. **(round 9, A-I3/B-I3) The recognizer is INVERTED, because the round-8 literal-adjacency spelling matches zero real mutation sites.** Measured on the shipped tree: in `ccd/session-hook.sh` the literal `compactset` occurred only at `8e457995:ccd/session-hook.sh:795`, `:796`, `:851`, `:920`, `:986` and a comment at `:1094` — read on the tree this item was written against and superseded at this tip — and NONE of those lines carries `rm`, `mv -f` or `link`; conversely every mutating line names only a variable — e.g. `:782`, `:802`, `:810`, `:817`, `:825`, `:836`, `:954`, `:964`, `:970`, **a SAMPLE, not the complete set (round 13, B-M3): measured, further mutating lines exist at `:781`, `:797`, `:798`, `:997`, `:803`, `:811`, `:818`, `:824`, `:826`, `:831`, `:865`, `:923`, `:953`, `:955`, `:965`, `:971`, `:974`, `:1633` and `:1634`, and the claim holds of every one, so the argument survives the incomplete list; `:865` and `:923` also appear below as allow-list entries (1) and (6), there as canonical MUTATIONS the filter produces rather than as evidence about literals**; and `grep -c 'compactset\|compactcard\|compactions' ccd/ccd` returns **0**, so `ccd/ccd`'s own named inventory entry is unreachable by that pattern. **Implement it the other way round:** enumerate every rename/unlink/link/write primitive in the named files — `mv`, `rm`, `link`, `>` redirection and `_hook_write_atomic` in `ccd/session-hook.sh`; the **BODY** of `ccd/ccd:3037-3057`'s purge loop (the glob is `for f in "$REG/$id".*; do` at `:2399`, the `rm -f "$f"` at `:2432`, twenty lines apart at this tip and eight at the tree this sentence was written against); and `renameSync`/`unlinkSync`/`linkSync` in `ccd/compact-card.mjs` (all three imported at `:23`; after this task exactly the two inside `writeAtomic` (`:422-431`) survive — `renameSync` at `:426` and the failure-path `unlinkSync` at `:428` — allowed only because no canonical pathname reaches the helper's argv; every other current occurrence, `:502`/`:506`/`:507`/`:508`/`:517`/`:519`/`:520`/`:528`/`:529`/`:537`/`:538`/`:546`/`:552`, sits inside `:433-560`, which this task deletes) — then apply the FILTER, and only then require equality. **THE ORDER MATTERS, and round 9 stated it backwards; the spec was corrected in round 10 (A-M3) and this bullet — the text a Task 9 implementer's extracted brief actually carries — was not, so the implementer received the formulation the spec calls unsatisfiable (round 11, B-I1).** The canonical-pathname resolution is the FILTER that PRODUCES the found set, and only then must the found set EQUAL the allow-list. Read the other way round — "require EACH primitive to appear on a named allow-list" — the row demands that every `mv`/`rm`/`>` in a 1,400-line hook and the whole purge-loop body sit on a short list, which no correct tree satisfies; a scan built that way is red from its first run and the only recovery is to weaken it, at which point both mutations below stop reddening. **The filter, covering the canonical SET and the canonical CARD alike (round 11, B-I2 — round 10's filter enumerated only the SET bindings while allow-listing a CARD rename, so the allow-list had a member the filter could never produce):** resolve the canonical pathname through the variables and positionals that carry it — SET `set="$REG/$id.compactset"` at `session-hook.sh:851` and `:920` (the third binding at `:986` belongs to `_hook_compact_served`, which this task DELETES); CARD `cardf="$REG/$id.compactcard"` at `:851` and `f="$REG/$id.compactcard"` at `:920` (measured: `:851` binds `set` and `cardf` on one line, `:920` binds `f` and `set` on one line); `_hook_write_atomic`'s positional `$1` (`:780`, mutating at `mv -f "$tmp" "$1"`, `:782`) traced from every call site that passes one; and — **the glob clause (round 10)** — **a variable bound by a GLOB whose pattern can match a canonical basename resolves to canonical**, which is what puts `ccd/ccd:3070` (`rm -f "$f"`, `f` bound by `for f in "$REG/$id".*` at `ccd/ccd:3050`) into the found set honestly, since `grep -c 'compactset\|compactcard\|compactions' ccd/ccd` measures **0** and no literal or text-adjacency rule can reach it. **Define "adjacent" as SAME STATEMENT** — not same line, not same file; the word appeared exactly once in the spec with no definition anywhere. **The helper's two surviving `writeAtomic` primitives (`renameSync` `:426`, `unlinkSync` `:428`) are excluded BY THE FILTER** — no canonical pathname reaches the helper's argv at all, which is option A's load-bearing property — **not** by an allow-list entry; they appear on no entry and must not. **"CANONICAL PATHNAME" IS FIXED FOR THIS SCAN as the FOUR canonical row artifacts — `$REG/<id>.compactset`, `$REG/<id>.compactcard`, `$REG/<id>.compactions`, `$REG/<id>.generation` (round 12, B-I4)** — not set+card alone; entry 13 and entries 14–16 are `.generation`/`.compactions` mutations that a set+card scoping cannot produce, so the narrow reading and this list cannot both stand. **ALLOW-LIST, SIXTEEN ENTRIES, ENUMERATED BY MEASUREMENT (round 11, B-I2, EXTENDED round 12, B-I4 — the thirteen-entry equality was still red on a correct post-Task-9 tree: three further canonical mutations exist there and appeared on no entry). The filtered found set must EQUAL exactly these:** (1) PreCompact step 6's ambiguous-card removal, `rm -f "$cardf"` (`session-hook.sh:865`), FIRST held lock; (2) **WITHDRAWN (D-2756, fix round 1)** — spec §3.1 item 5 dropped the redundant-canonical-alias unlink as measurably redundant on this implementation (the overlap `find`'s claim clause already decides the verdict, and the unconditional initial publication's `mv -f` already replaces the directory entry), so this entry names no site and none may appear; the id is retained rather than renumbered so the citations to (3)–(16) stay true; (3) PreCompact step 7's initial publication, `_hook_write_atomic "$set" "$doc"` (call site `:886`), FIRST held lock — round 8's inventory omitted this site entirely; (4) PreCompact step 13's card-stage rename into `$REG/<id>.compactcard`, SECOND (reacquired) held lock; (5) PreCompact step 13's set-stage rename into `$REG/<id>.compactset`, same lock; (6) SessionStart(compact) step 2's aged-card deletion, `rm -f "$f"` (`:923`), the one retained lock; (7) SessionStart(compact) step 3's claim by rename, `mv -f "$f" "$claim"` (`:954`), same lock; (8) SessionStart(compact) step 3's card restore, `link "$claim" "$f"` (`:964`, `:970`), same lock; (9) PostCompact settlement's claim link off canonical, `link "$set" "$claim"` — it NAMES canonical, which is what puts it in the found set — settlement lock; (10) PostCompact settlement's canonical unlink, strictly before the claim `touch`, same lock; (11) PostCompact settlement's no-clobber restore after a failed `touch`, `link "$claim" "$set"`, same lock; (12) `_reg_purge`'s purge-loop BODY, `rm -f "$f"` (`ccd/ccd:1840` → `:1848`, eight lines apart), stable lock held for the whole function body; (13) `_reg_purge`'s generation-last unlink, `rm -f "$REG/$id.generation"`, placed AFTER the archived/reaping tail (`ccd/ccd:3091`) and therefore OUTSIDE `:3050-3070`, same lock — `.generation` is a canonical row artifact by this plan's own Global Constraints, and it is reached by the LITERAL-canonical clause below, not by variable tracing or the glob clause; (14) PostCompact's final journal transaction renaming its stage over `$REG/<id>.compactions` (spec §3.4, Journal contract), under the reacquired validated FINAL lock; (15) row creation's no-clobber `link` mint of `$REG/<id>.generation` off its stable-lock-protected private source (spec §3.4, Generation), under the ROW-CREATION lock — a `link` whose DESTINATION names canonical, the shape of entries 8 and 11; (16) PreCompact step 5's generation-read hard-link alias off `$REG/<id>.generation` plus its alias unlink (spec §3.1's ADDED-BY-TASK-9 list), under the FIRST held lock — a `link` whose SOURCE names canonical, the shape of entry 9. **RESOLUTION CLAUSE the thirteen-entry list was missing (round 12, B-I4): a LITERAL canonical pathname written directly as a primitive's argument resolves to canonical**, with no variable to trace and no glob to match — measured, `ccd/ccd` carries ZERO `compactset`/`compactcard`/`compactions` literals today (`grep -c` = 0), so every literal-canonical site in it is one this task adds. **Named for completeness and EXCLUDED BY THE FILTER — each must appear on no entry, and a scan that produces any of them is over-broad:** PreCompact step 6's exact-family age sweep (`:869` and its Task 9 successor), whose dot-LEADING `.tmp` grammar cannot match a canonical basename; PreCompact step 13's stage `rm`s on the non-publishing outcomes, which remove the unrenamed private stages; SessionStart's `( set -C; : > "$claim" )` placeholder and its `rm -f "$claim"` at `:955`/`:965`/`:971`/`:974`; PostCompact's `touch "$claim"`, private and not a listed primitive; the marker source's `mktemp`/`link`/`rm`; **the permanent lock's own init `mktemp`/`link`/`rm` and every acquisition's lock-open-alias `link`/`rm` (spec §3.4, Stable lock protocol steps 1–2) — the largest new family this task adds, absent from this list until round 13 (B-M4)**, excluded because `$REG/.<id>.compactions.lock` and `.<id>.compactions.lock-open.…` are dot-LEADING (so `for f in "$REG/$id".*` cannot match them) and are not among the four canonical row artifacts, which is also why the lock-open `link`'s SOURCE naming the lock does not make it entry-9-shaped; and the helper's two `writeAtomic` primitives above. **NON-VACUITY control, mandatory (strengthened round 10; the `ccd/ccd:3070` half reaches this bullet only in round 11):** assert the found set is NON-EMPTY and contains BOTH `_hook_write_atomic`'s call site at `session-hook.sh:886` AND `ccd/ccd:3070` — a scan that finds nothing cannot red on anything, the round-8 spelling found nothing, and requiring only `ccd/session-hook.sh:1488` would leave the glob clause itself unproven. **Mutations:** restore `_hook_compact_rollback_set` — the family Task 9 DELETED, superseded at this tip and re-anchorable at no line, so both numbers below name the era they were true in — (`8e457995:ccd/session-hook.sh:792-819`) verbatim ⇒ must red, reached through `$set` → the function's positional `$1` → its `mv -f "$set" "$claim"` at `8e457995:ccd/session-hook.sh:802`; add an unlocked `_hook_write_atomic "$set" "$doc"` outside any held lock ⇒ must red; **add a second unlocked `rm -f "$REG/$id".*` loop elsewhere in `ccd/ccd` ⇒ must red** (round 10's added mutation, which stayed green under the round-9 resolution rule with no glob clause); **add an unlocked `mv "$stage" "$REG/$id.compactions"` outside the final held lock ⇒ must red** (round 12, B-I4 — green under every earlier list, since no entry and no filter clause reached the journal); delete any one of the surviving allow-list entries ⇒ must red — the equality is over (1) and (3)–(17) since fix round 1 withdrew (2) (D-2756) and added (17), `_reg_generation_read`'s `link "$p" "$al"` at `ccd/ccd:2793`, a canonical-source `link` this list had never enumerated (D-2757); relocate `session-hook.sh:865`'s `rm` outside the held section ⇒ must red. All of these stay GREEN under the round-8 spelling and all leave every behaviour test green, which is why the scan, not a behaviour test, is the control.

- [ ] **Step 2: Run red**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/compact-card.test.ts test/ccd-lifecycle-purge.test.ts test/ccd-workspaces.test.ts test/ccd-reg-set-atomic.test.ts test/ccd-spawn-split.test.ts test/ccd-session-lifecycle.test.ts test/ownership.test.ts test/ccd-wsaudit-nonpoison.test.ts test/single-definition.test.ts test/ccd-die-containment.test.ts
```

Expected: all new guards are red against pre-Task-9 implementation.

- [ ] **Step 3: Implement Task 9 completely**

Implement one safe lock/generation/family helper contract exactly above. Before enabling an ordinary PreCompact or purge sweep, migrate the current pre-D-2605 hook set-temp and SessionStart-claim producers to the §3.4 target table, and **delete every rollback producer outright** (helper and hook alike —§3.4's option A leaves nothing to roll back); use a narrow, locked, age-gated legacy transition matcher only for the expressly listed old set-temp name. Rewrite PreCompact to the round-7 option-A protocol (§3.1: no canonical pathname in the helper's argv, but round 8's `--parent-live`/`--live-agents` DO join it, copied verbatim; reconfirm ownership via bounded `read -N`, never `slotIsMine`; rename stages under the reacquired lock, stamping `steered` into the private set-stage via `jq` before that rename, never into canonical), compact SessionStart (unchanged shape, now explicitly on `COMPACT_LOCK_WAIT_SERVE`), and PostCompact to honor their lock and cleanup boundaries. Delete `_hook_compact_served` and its call outright (round 8, I6). Implement ccd row setup/spawn/retry/purge/slug behavior here, not in Task 11 — `_ws_slug_free`'s widened dot-leading scan (round 8, I4) included. Re-stamp `ccd/ccd` immediately after its edit:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

**Why THESE suites and not every reader of `ccd/ccd` (round 14, B-M6; the basis is stated, not omitted —
and the finding's premise of "three" is measured wrong).** Measured on this tree, **37** landed suites read
`ccd/ccd`'s source text through `readFileSync(CCD, …)` — derive the set with
`grep -lE 'readFileSync\(CCD' server/test/*.test.ts` — and `server/test/single-definition.test.ts` reads it
through its `bashRoots` walk (`:1115`) without naming a `CCD` constant, for **38** in all. Running 38 suites
per task is not the rule; the rule is: **run the suite when what this task adds can reach its scan.** Three
were added to Steps 2 and 4 on that test, each with its reason:
`server/test/ccd-wsaudit-nonpoison.test.ts` harvests four token shapes over the whole file
(`_reap_refuse\s+`, `"refused":"`, `'!`, `"verdict":"` — `:32-35`) and pins the harvest with `expect.soft(scan(src)).toHaveLength(55)`
(`:78`), and this task adds new refusal vocabulary; `server/test/single-definition.test.ts` gains this task's
`COMPACT_LOCK_WAIT` byte-equality rule over `bashRoots`; and `server/test/ccd-die-containment.test.ts`
derives its CAN-DIE set by call-graph reachability over `readFileSync(CCD, 'utf8')` (`:311`), which the new
non-dying soft emitter enters. Measured, none of the three reds on what this task is SPECIFIED to add —
`_lc_refuse_return` matches none of the four harvest shapes, the new tokens are bare words, and no
single-definition rule names the new constants before this task adds one — so they are run to CATCH a
divergence from the specification, not because a break is predicted. **The other 35 are excluded on a stated
measurement:** none scans a function this task edits and none harvests a shape this task's additions can
match. If Step 3 adds a token, a `die`, or a constant beyond this task's specified surface, re-derive the
set with the `grep` above before trusting that exclusion.

- [ ] **Step 4: Run green and mutation matrix**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/compact-card.test.ts test/ccd-lifecycle-purge.test.ts test/ccd-workspaces.test.ts test/ccd-reg-set-atomic.test.ts test/ccd-spawn-split.test.ts test/ccd-session-lifecycle.test.ts test/ownership.test.ts test/ccd-wsaudit-nonpoison.test.ts test/single-definition.test.ts test/ccd-die-containment.test.ts
```

In an isolated copy mutate each order/identity/family/cleanup/purge-status/spawn-lock seam above. Every stated control must red; structural FD-close pins are acceptable only where a behavior test cannot observe the close.

- [ ] **Step 5: Commit**

```bash
git add ccd/session-hook.sh ccd/compact-card.mjs ccd/compact-card.d.mts ccd/ccd server/test/session-hook.test.ts server/test/compact-card.test.ts server/test/ccd-lifecycle-purge.test.ts server/test/ccd-workspaces.test.ts server/test/ccd-reg-set-atomic.test.ts server/test/ccd-spawn-split.test.ts server/test/ccd-session-lifecycle.test.ts server/test/ownership.test.ts
git commit -m "feat(hook): close compaction ownership, generation and journal fencing"
```

---

### Task 10: Ship the helper beside the hook — every door the hook goes through (spec §2 Runtime, §5 Installer)

**AMENDED from the completed preflight at Task 9's final tip `99017a13`.** This section was frozen
byte-for-byte through every D-2605 documentation round so that no correction writer could touch it;
the freeze is lifted for this one edit and closes again with the new byte count and SHA recorded in Task 11's
audit. Every constraint the frozen text carried is kept except the three the measurements below overturned,
and those three are D-2845, D-2846 and D-2847 in `## Deviations found`.

**What Task 9 left to ship.** Measured, not remembered — `git diff --name-only 8e457995..99017a13`, non-test
and non-doc: `ccd/ccd`, `ccd/compact-card.d.mts`, `ccd/compact-card.mjs`, `ccd/session-hook.sh`,
`shared/api.ts`, `server/src/coord/journalparse.ts`. Of those six exactly ONE has no door on any lane:
`ccd/compact-card.mjs`. `ccd/ccd` and `ccd/session-hook.sh` already ride the agent lane and `ccrc install`
unchanged; `ccd/compact-card.d.mts` is a declaration file that must NOT ship; `shared/api.ts` and
`server/src/coord/journalparse.ts` are the server lane's, and the paragraph after **Interfaces** is the
measurement that says the agent lane may go first anyway.

**Files:**
- Modify: `deploy/deploy.sh` — the agent lane's pre-install backup chain (one clause beside the hook's at
  `deploy/deploy.sh:560`, `cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh`), and one
  `install_atomic` call in the agent branch, placed immediately BEFORE
  `install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755` (`deploy/deploy.sh:629`).
- Modify: `ccd/ccrc` — `_inst_files` (one `_inst_atomic`, before
  `_inst_atomic "$tree/ccd/session-hook.sh" "$HOME/.cc-sessions/session-hook.sh" 755` at `ccd/ccrc:5217`) and
  its summary `echo`; the `_upd_backup_copy` list beside
  `_upd_backup_copy "$HOME/.cc-sessions/session-hook.sh" session-hook.sh` (`ccd/ccrc:6531`); and
  `_uninst_cc_sessions`' `rm -f` list, whose own header states that the list IS `_inst_files` +
  `_inst_skills`' "install set, exactly" (`ccd/ccrc:7129-7130`) — so an addition to `_inst_files` with no
  removal beside it does not merely leak a file, it falsifies a shipped sentence (D-2845).
- Modify: `server/test/installTreeFixture.ts` (`TREE_FILES` — the fixture tree `ccrc install` is run against;
  `_inst_atomic` DIES on a source the tree does not carry, so without this entry every `ccrc-install*.test.ts`
  run is red for a fixture reason rather than a real one).
- Modify: `server/test/ccrc-install.test.ts` (the modes `cases` array and the idempotence `targets` list).
- Modify: `server/test/ccrc-uninstall.test.ts` (`plantInstalledBox`'s `~/.cc-sessions` plant, and the removal
  list of `~/.cc-sessions: ccrc's own artifacts go file-by-file`).
- Modify: `agent/test/deploy-verify.test.ts` (the direct-scp ban set and the `install_atomic` call set).
- Create: `server/test/compact-card-ship.test.ts`.
- NOT modified, each for a measurement rather than a preference (D-2846):
  - `deploy/build-release.sh` and `server/test/build-release.test.ts`. The release tarball's pathspec names a
    DIRECTORY — `install.sh shared ccd deploy` (`deploy/build-release.sh:103-104`) — so the helper rides it the
    day it is committed, with no edit here. Step 1 pins that pathspec rather than trusting it, and the failure
    mode if it were ever narrowed is LOUD, not silent: `_inst_atomic` dies naming the missing source.
  - `ccd/compact-card.d.mts`. Hand-written "types for the vitest import of compact-card.mjs"
    (`ccd/compact-card.d.mts:1-2`) — nothing at run time opens it, `node` does not read it, and installing it
    would put an unrunnable artifact into `~/.cc-sessions` that `_uninst_cc_sessions` would then have to carry.
    Step 1 asserts that NO installer line on either door mentions it.
  - `ccd/ccd`. Task 9's 1,162 added lines ride the agent lane's existing
    `install_atomic ccd/ccd .local/bin/ccd 755` and `ccrc install`'s existing `_inst_atomic` of the same file.
    No new line, and the deploy's build stamp is unchanged.
  - `server/src/coord/*` and `shared/api.ts`. Server lane; see below.
  - Any `CLAUDE.md` at any level, and `graphify update` on either lane. ccrc writes only ccrc-owned artifacts —
    the session hook, this helper, the skills, the hookstate and the venv — and that ruling is not relaxed by a
    task whose whole subject is installers.

**Interfaces:**
- Consumes: `COMPACT_HELPER`, the hook's own single assignment
  (`ccd/session-hook.sh:2231`, `COMPACT_HELPER="$HOME/.cc-sessions/compact-card.mjs"`). It is the ONE source
  of truth for where the helper lives; every destination below is derived from it by the test rather than
  restated, so a hook that moves the helper and an installer that does not is red in both directions.
- Consumes: the hook's two guards for it, each an `[ -f "$COMPACT_HELPER" ]` test whose failure returns zero
  in silence — PreCompact's at `ccd/session-hook.sh:1301` guards the `card` call, PostCompact's at
  `ccd/session-hook.sh:1448` guards both `measure` calls. They are silent and TOTAL: on a box the hook reaches
  and the helper does not, every compaction publishes no set, serves no card and journals no measurement, and
  nothing anywhere says so. That silence is the whole reason this task exists as a task.
- Produces: `~/.cc-sessions/compact-card.mjs` at mode 0644 on every box the hook reaches — `deploy.sh`'s agent
  lane, `ccrc install`, `ccrc update` (with a backup in the same set as the hook's), and removed by
  `ccrc uninstall` in the same file-by-file sweep that removes the hook.

**Which lane ships what, and why AGENT-FIRST is safe here.** Measured on `99017a13`.

- `ccd/compact-card.mjs`, `ccd/session-hook.sh` and `ccd/ccd` are AGENT-lane artifacts: they land on the fleet
  host, through `install_atomic` from `deploy.sh agent <host>` or through `_inst_atomic` from `ccrc install`
  run on that box. `server/src/coord/journalparse.ts` is SERVER-lane source and reaches no fleet host at all —
  the agent lane's rsync source list is `agent shared deploy ccd` and carries no `server` directory.
  `shared/api.ts` is rsynced by BOTH lanes (both lists carry `shared`) and is compiled into `server/dist` on
  the server and into `agent/dist` on the fleet host, where nothing imports it: `agent/src` imports only
  `shared/agent-protocol.js`, `shared/buildinfo.js` and `shared/mark.mjs`.
- So an agent-first deploy of this branch puts a `ccd` that emits Task 9's two additions in front of a server
  that has not been updated yet. Both additions are tolerated, measured by reading the readers:
  - **The `unremoved` key.** `reviveMeas` builds a literal from the keys it names and performs no
    unknown-key check; the file's own docstring states the invariant — any key a future ccd emits that is not
    one of the modelled set "still never reaches `meas` — it is still recoverable only from `raw`, verbatim".
    An older server therefore stores the row whole and simply does not surface that one field. Additive,
    absence-permits, one reader per field.
  - **The three new `LcRefusalToken` members.** The journal parser reads the token as an unconstrained string
    (`server/src/coord/journalparse.ts:283`, `refusal: s(o, 'refusal')`), the column is a bare `TEXT` with no
    CHECK, and the vocabulary is consulted only at render, through
    `shared/api.ts:5644` — `return isLcRefusalToken(token) ? LC_REFUSAL_WORD[token] : null;` — whose `null` the
    console already composes as "render the token as itself". An older console shows
    `purge-incomplete` instead of its sentence: degraded, never lost, and that fallback is a designed
    condition in the renderer rather than an accident.
- **Therefore the agent lane may ship first and must**, which is the rule for anything touching `ccd/` or
  `session-hook.sh` anyway. The server lane's final gate is unchanged: `/health` reporting the shipped sha.
- **Task 10 performs NO deployment.** It makes deployment correct and testable. The act itself is the
  operator's, after merge, and is what the `## Deploy` section below describes.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/compact-card-ship.test.ts
// The compaction card's helper reaches a box the same way the hook does, and
// this file is why that stays true. The hook's two guards for it —
// `[ -f "$COMPACT_HELPER" ] || return 0`, once in PreCompact and once in
// PostCompact — are silent and total, so a helper shipped through one door and
// not another is a fleet of boxes that publish no set, serve no card and
// journal no measurement, with nothing anywhere saying so.
//
// THE PATH IS DERIVED FROM THE HOOK, NEVER RESTATED. Every destination below is
// built from `COMPACT_HELPER`'s own assignment in `ccd/session-hook.sh`, so the
// divergence class this file exists for — the hook looking in one place and an
// installer writing to another — reds in BOTH directions, rather than only when
// someone remembers to edit three literals in step.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** Executable lines only. `deploy.sh` and `ccrc` both discuss their own helpers
 *  by name in prose, and a scrape that counted comments would "prove" an
 *  ordering the shell never runs — `ccrc-api-ship.test.ts`'s rule, and its
 *  reason, applied to two files. */
const code = (src: string): string[] =>
  src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** `COMPACT_HELPER` as the hook spells it: `$HOME/…`. */
const helperAbs = (): string => {
  const m = /^COMPACT_HELPER="([^"]+)"$/m.exec(read('ccd/session-hook.sh'));
  expect(m, 'the hook still assigns COMPACT_HELPER exactly once, at top level').toBeTruthy();
  return m![1]!;
};
/** The same path as `install_atomic` spells a destination: HOME-relative. */
const helperRel = (): string => {
  const abs = helperAbs();
  expect(abs.startsWith('$HOME/'), `COMPACT_HELPER is not under $HOME: ${abs}`).toBe(true);
  return abs.slice('$HOME/'.length);
};
const helperName = (): string => path.posix.basename(helperAbs());

describe('compact-card.mjs ships', () => {
  it('deploy.sh installs it through install_atomic, at 644, where the hook looks for it', () => {
    const line = code(read('deploy/deploy.sh'))
      .filter((l) => l.startsWith('install_atomic ccd/compact-card.mjs'));
    expect(line, 'deploy.sh installs ccd/compact-card.mjs exactly once').toHaveLength(1);
    expect(line[0]).toBe(`install_atomic ccd/compact-card.mjs ${helperRel()} 644`);
  });

  it('it is never scp\'d straight to its final name', () => {
    // deploy-verify's own idiom, and its reason: bash executes a script lazily
    // from a saved byte offset, and `node` reads this one at whatever moment a
    // compaction starts. Both `"$BOX":dest` and `"$BOX:dest"` are banned, so a
    // call site "fixed" by switching quote style cannot sail through.
    const escaped = helperRel().replace(/[./]/g, '\\$&');
    const direct = new RegExp(
      `"\\$\\{SCP\\[@\\]\\}"\\s+\\S+\\s+("\\$BOX":|"\\$BOX:)${escaped}"?(?!\\.incoming)(\\s|$)`, 'm');
    expect(direct.test(read('deploy/deploy.sh')),
      'the helper is copied to its live name in place — the hazard install_atomic exists for').toBe(false);
  });

  it('it ships in the AGENT lane, before the hook that calls it', () => {
    const src = read('deploy/deploy.sh');
    const agentStart = src.indexOf('if [ "$TARGET" = "agent" ]');
    const agentEnd = src.indexOf('\nelse', agentStart);
    expect(agentStart, 'deploy.sh still has an agent branch').toBeGreaterThan(-1);
    expect(agentEnd, 'and it still ends at a top-level else').toBeGreaterThan(agentStart);
    const at = src.indexOf('install_atomic ccd/compact-card.mjs ');
    expect(at, 'the helper installs in the agent lane, not the server lane')
      .toBeGreaterThan(agentStart);
    expect(at, 'the helper installs in the agent lane, not the server lane').toBeLessThan(agentEnd);
    const lines = code(src);
    const helper = lines.findIndex((l) => l.startsWith('install_atomic ccd/compact-card.mjs '));
    const hook = lines.findIndex((l) => l.startsWith('install_atomic ccd/session-hook.sh '));
    expect(hook, 'deploy.sh still installs the hook').toBeGreaterThan(-1);
    expect(helper, 'the helper lands BEFORE the hook that calls it: the reverse order opens a window '
      + 'in which every live session on the box compacts against a helper that is not there yet, and '
      + 'the hook is silent about it').toBeLessThan(hook);
    expect(Math.abs(hook - helper),
      'the helper installs beside the hook — same lane, same event order').toBeLessThanOrEqual(2);
  });

  it('deploy.sh backs it up in the same set as the hook', () => {
    const src = read('deploy/deploy.sh');
    expect(src).toContain(`cp -a ~/${helperRel()} ~/ccrc-backups/$TS/${helperName()}`);
    expect(src, 'the hook is still the neighbour this is "the same set as"')
      .toContain('cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh');
  });

  it('ccrc install places it at 644 before the hook, update backs it up, uninstall removes it', () => {
    const src = read('ccd/ccrc');
    const lines = code(src);
    const abs = helperAbs();
    const name = helperName();
    expect(lines).toContain(`_inst_atomic "$tree/ccd/${name}" "${abs}" 644`);
    const helper = lines.indexOf(`_inst_atomic "$tree/ccd/${name}" "${abs}" 644`);
    const hook = lines.findIndex((l) => l.startsWith('_inst_atomic "$tree/ccd/session-hook.sh"'));
    expect(hook, 'ccrc install still places the hook').toBeGreaterThan(-1);
    expect(helper, 'ccrc install places the helper before the hook, for deploy.sh\'s reason')
      .toBeLessThan(hook);
    expect(lines).toContain(`_upd_backup_copy "${abs}" ${name}`);
    // `_uninst_cc_sessions`' own header says its list IS `_inst_files` +
    // `_inst_skills`' install set, exactly. An installer with no removal beside
    // it does not merely leak a file — it makes that sentence false.
    const fn = /_uninst_cc_sessions\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(fn, 'ccrc still has a _uninst_cc_sessions').toBeTruthy();
    expect(fn![1], 'ccrc uninstall removes the helper it installs').toContain(`"$reg/${name}"`);
  });

  it('the release tarball carries it, because the pathspec names a directory', () => {
    // `git archive … ccd` is why `build-release.sh` needs no edit for this
    // file. Pinned rather than trusted: narrowing that pathspec to a file list
    // would leave a tarball whose `ccrc install` dies on a missing source.
    expect(code(read('deploy/build-release.sh'))).toContain('install.sh shared ccd deploy \\');
  });

  it('the helper\'s TYPES never reach a box', () => {
    // `compact-card.d.mts` exists for the vitest import; `node` never reads it
    // and no box has a use for it, so it must not join the install set that
    // `_uninst_cc_sessions` has to mirror.
    for (const rel of ['deploy/deploy.sh', 'ccd/ccrc']) {
      expect(code(read(rel)).filter((l) => l.includes('compact-card.d.mts')),
        `${rel} ships the helper's declaration file to a box`).toEqual([]);
    }
  });

  it('imports node:* only — the shared/mark.mjs class, never bundled, never npm', () => {
    const src = read('ccd/compact-card.mjs');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, `${i} is not a node:* module`).toMatch(/^node:/);
  });
});
```

In `server/test/installTreeFixture.ts`, in `TREE_FILES`, directly BEFORE the line `  'ccd/session-hook.sh',`
add:

```ts
  // The compaction card's helper (compaction-card spec §2). `_inst_files`
  // places it beside the hook and BEFORE it, so the tree has to carry it or
  // `_inst_atomic` dies naming the missing source and every describe here goes
  // red for a fixture reason.
  'ccd/compact-card.mjs',
```

In `server/test/ccrc-install.test.ts`, in the `cases` array of `the session hooks, notify and the
tmux/statusline config land at their modes`, add before the `session-hook.sh` row:

```ts
      // The compaction card's helper (compaction-card spec §2): 0644, a script
      // `node` runs under the hook's `timeout`, never executed directly.
      [join(home, '.cc-sessions', 'compact-card.mjs'), placed(home, 'ccd', 'compact-card.mjs'), 0o644],
```

and in the `targets` list of `a second run rewrites none of them, and leaves no temp file behind`, before the
`session-hook.sh` entry:

```ts
      join(home, '.cc-sessions', 'compact-card.mjs'),
```

In `server/test/ccrc-uninstall.test.ts`, in `plantInstalledBox`, beside the other `~/.cc-sessions` artifacts:

```ts
  // The compaction card's helper (compaction-card spec §2): `_inst_files`
  // places it, so `_uninst_cc_sessions` is the sweep that must remove it.
  writeFileSync(join(reg, 'compact-card.mjs'), '// fixture helper\n', { mode: 0o644 });
```

and add `'compact-card.mjs'` to the removal list of `~/.cc-sessions: ccrc's own artifacts go file-by-file;
registry rows and operator switches stay`:

```ts
    for (const f of ['session-hook.sh', 'install-session-hooks.sh', 'notify.sh', 'compact-card.mjs',
      'install-coordinator-skill.sh', 'install-worker-skill.sh', 'install-graphify-skill.sh',
      'coordinator-skill', 'worker-skill']) {
```

In `agent/test/deploy-verify.test.ts`, in the test that bans a direct `scp` to a live name and then requires
each atomic install, add `'.cc-sessions/compact-card.mjs'` to the first list and this line to the second:

```ts
      'install_atomic ccd/compact-card.mjs .cc-sessions/compact-card.mjs',
```

- [ ] **Step 2: Run and watch them fail**

Run, from inside each package, in the foreground:

```bash
cd server && ./node_modules/.bin/vitest run test/compact-card-ship.test.ts test/ccrc-install.test.ts test/ccrc-uninstall.test.ts
cd agent  && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: FAIL, and for the stated reasons — the ship test finds no `install_atomic ccd/compact-card.mjs`
line at all; the install test's new `cases` row reports `was never installed` (the fixture tree now carries
the file, so `ccrc install` runs and `_inst_atomic` does not die — it simply never places it); the uninstall
test reports `compact-card.mjs survived`; deploy-verify reports the missing atomic install call. A run that
fails with `the shipped tree has no …/ccd/compact-card.mjs` instead means the `TREE_FILES` entry was missed.

- [ ] **Step 3: `deploy/deploy.sh`**

In the agent lane's pre-install backup chain, after the `session-hook.sh` clause, add:

```bash
    && { [ ! -f ~/.cc-sessions/compact-card.mjs ] || cp -a ~/.cc-sessions/compact-card.mjs ~/ccrc-backups/$TS/compact-card.mjs; } \
```

In the agent lane, directly BEFORE `install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755`,
add:

```bash
  # The compaction card's helper (compaction-card spec §2): plain node, no npm,
  # read by the hook's PreCompact and PostCompact arms under `_hook_timeout`.
  # 644 — `node` runs it; nothing executes it directly.
  #
  # BEFORE the hook, not after. The hook's guard for this file is SILENT and
  # total, so the window between the two installs decides which way a partial
  # deploy fails: helper-then-hook leaves a file no old hook calls, hook-then-
  # helper leaves every live session on the box compacting with no set, no card
  # and no journal line, and saying nothing about it. This comment deliberately
  # does NOT spell the install line itself — the ship test locates that call by
  # scanning for it, and a comment carrying the same spelling shadows the real
  # invocation, the trap this file's other notes record springing twice.
  install_atomic ccd/compact-card.mjs .cc-sessions/compact-card.mjs 644
```

- [ ] **Step 4: `ccd/ccrc`**

In `_inst_files`, directly BEFORE the `_inst_atomic "$tree/ccd/session-hook.sh" …` line, add:

```bash
  # The compaction card's helper, 0644 (compaction-card spec §2): a script
  # `node` runs under the hook's `timeout`, never executed directly. Before the
  # hook for the reason deploy.sh's agent lane states at its own copy — the
  # hook's guard for it is silent, so only this order makes a half-finished
  # converge fail in the harmless direction.
  _inst_atomic "$tree/ccd/compact-card.mjs" "$HOME/.cc-sessions/compact-card.mjs" 644
```

Replace `_inst_files`' summary line

```bash
  echo "install: files: session hooks, notify.sh, tmux.conf and the statusline in place"
```

with

```bash
  echo "install: files: session hooks, the compaction-card helper, notify.sh, tmux.conf and the statusline in place"
```

In the `_upd_backup_copy` list, directly after
`_upd_backup_copy "$HOME/.cc-sessions/session-hook.sh" session-hook.sh`, add:

```bash
  _upd_backup_copy "$HOME/.cc-sessions/compact-card.mjs" compact-card.mjs
```

In `_uninst_cc_sessions`, add the helper to the `rm -f` list — the list its own header calls `_inst_files` +
`_inst_skills`' install set, exactly:

```bash
  rm -f -- "$reg/session-hook.sh" "$reg/install-session-hooks.sh" "$reg/notify.sh" \
    "$reg/compact-card.mjs" \
    "$reg/install-coordinator-skill.sh" "$reg/install-worker-skill.sh" \
    "$reg/install-graphify-skill.sh" \
    || _ccrc_die "removing ccrc's files under $reg failed"
```

- [ ] **Step 5: Run and watch them pass**

```bash
cd server && ./node_modules/.bin/vitest run test/compact-card-ship.test.ts test/ccrc-install.test.ts test/ccrc-install-graphify.test.ts test/ccrc-update.test.ts test/ccrc-uninstall.test.ts test/ccrc-api-ship.test.ts test/build-release.test.ts test/deploy-coordinates.test.ts test/single-definition.test.ts
cd agent  && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: PASS throughout. Three of those suites are in the list as CONTROLS rather than as subjects: the
`ccrc-api` adjacency pin still holds (the helper sits before the hook, nowhere near `ccd` and `ccrc-api`), the
graphify install suite shares the fixture tree and must stay green, and `single-definition.test.ts` is what
would object if the helper's pathname had been enumerated a second time instead of derived.

- [ ] **Step 6: Mutation checks**

One mutation each, applied to a copy of the tree and reverted, with the whole ship suite run for each:

1. Delete the `install_atomic ccd/compact-card.mjs` line → `deploy.sh installs it through install_atomic`
   reds on `toHaveLength(1)`.
2. Replace that line with a direct `"${SCP[@]}" ccd/compact-card.mjs "$BOX":.cc-sessions/compact-card.mjs` →
   both `installs it through install_atomic` and `it is never scp'd straight to its final name` red. (The
   second alone is the one that catches a deploy which still "ships" the file.)
3. Move the `install_atomic` line out of the agent branch into the server branch → `it ships in the AGENT
   lane` reds on the `agentEnd` bound.
4. Swap the helper and hook install lines so the helper installs after → the same test reds on the
   `toBeLessThan(hook)` assertion, with the window it names in the message.
5. Change `COMPACT_HELPER` in `ccd/session-hook.sh` to any other path → four tests red at once (the deploy
   install line, the direct-scp ban, the backup clause and the whole `ccrc` install/update/uninstall test),
   because every destination is derived from that one assignment rather than restated.
6. Change `644` to `755` on the `ccrc` line → `ccrc install places it at 644` reds, and the `cases` row in
   `ccrc-install.test.ts` reports the wrong mode.
7. Delete the `_upd_backup_copy` line → the same test reds.
8. Delete the `"$reg/compact-card.mjs"` entry → the ship test's uninstall assertion AND
   `ccrc-uninstall.test.ts`'s `compact-card.mjs survived` both red.
9. Delete the `TREE_FILES` entry → every `ccrc-install*.test.ts` describe reds with `the shipped tree has no
   …/ccd/compact-card.mjs`.

- [ ] **Step 7: Commit**

```bash
git add deploy/deploy.sh ccd/ccrc server/test/installTreeFixture.ts server/test/ccrc-install.test.ts server/test/ccrc-uninstall.test.ts agent/test/deploy-verify.test.ts server/test/compact-card-ship.test.ts
git commit -m "feat(deploy): ship compact-card.mjs beside the hook on every door — deploy.sh's agent lane, ccrc install, ccrc update's backup, ccrc uninstall's sweep"
```

---

### Task 11: Final D-2605 documentation and committed-byte audit

**Files:**
- Modify: `README.md` only for final operator-facing journal/lifecycle wording, and `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` only for landed implementation status.
- Modify, OUTSIDE those two and named here rather than left to a diff (D-2849 set that precedent for exactly this shape): **this plan file itself** — its Global Constraints clause and Task 9's section, because D-2758 parks the corpus-wide citation re-anchoring in Task 11 and those anchors live here, plus the dated ledger appends this task's own gate rounds carry — and **`server/test/session-hook.test.ts`**, whose per-file citation census, narrated sum and exemption-free **Files:** ratchet are EXACT literals, so a repaired anchor reds the suite unless the census is re-measured in the same commit. Neither is a mechanism change: this task touches no file under `ccd/`, `deploy/`, `agent/src`, `shared/` or `server/src` at all, and Task 8's and Task 10's sections stay byte-identical, re-verified with Step 2's committed extractor after every commit.
- Test/audit: Task 9 lifecycle suites and `server/test/session-hook.test.ts`'s citation audit — the two ratchets above are this task's own deliverable, so they are run, not merely named. `server/test/ownership.test.ts` stood here through round 10 and is DROPPED rather than left standing: this task changes no ownership surface, and a file list nobody honours is the defect the exemption-free pass exists to catch. Task 11 implements no `ccd/ccd`, lock, purge, generation, spawn, or restamp mechanism; those are solely Task 9.
- Generate but do not commit: `.superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a/task-9-brief.md`, `task-11-brief.md`, and separate `.source-commit` provenance sidecars. Do not regenerate/edit Task 10 ignored brief.

- [ ] **Step 1: Audit final contract and preserve frozen task bytes**

Sweep operative spec/plan/Task 9/Task 11 text for direct canonical lock `<>`, touch-before-unlink, pre-lock compact SessionStart inspection, unlocked final cleanup, successful source leaks, conflicting families, unsafe generation reads/repair, ignored purge status, recursive retained FD, Task 11 ccd ownership, stale wire/hookstate/persisted-`n` claims. Preserve Task 8 final citation/fence prose byte-for-byte and preserve Task 10 byte-for-byte. Under the committed physical-line extractor, Task 10 must be exactly **24,688 bytes**, SHA-256 **`46535cdd524041584201abc0e8ac690df9cf1930d7398cefc3194a495de5dc7d`**; the superseded 7,804-byte/`199586...` slice dropped its retained terminal separator.

**Bound the final task's extraction explicitly (round 6, M7).** Task 11 is the LAST `### Task N` heading in this file, so a next-task-only stop condition never fires for it and the extractor runs to EOF — swallowing `## Deploy`, the entire `## Deviations found` ledger (43+ entries as of this round), and `## Self-review` into its own brief. Handing an executing agent a brief that defines dozens of D-numbers is the documented setup for that agent minting one itself (see the a-constraint-naming-the-allocator-invites-a-mint lesson). The extractor below now also stops before any `## `-level heading (exactly two `#` then whitespace — distinct from a three-`#` `### Task` heading, so no task boundary is affected), which bounds Task 11's brief to its own body.

- [ ] **Step 2: Regenerate equality-bound ignored briefs from a committed source**

The controller supplies `SOURCE_COMMIT`, the full 40-lowercase-hex SHA of the commit whose plan bytes are authority. A commit cannot self-name its own SHA, so do not infer `HEAD`, a branch, working-tree content, a base copy, or uncommitted file. Brief contains only extracted task bytes; separate sidecar contains provenance.

Run this exact byte-preserving algorithm once for Task 9 and once for Task 11 **after the final tracked docs commit**. It reads only literal `git show` object bytes, decodes nothing, uses no `splitlines()`, trims nothing, normalizes no EOL, and verifies with `cmp -s`.

```bash
SOURCE_COMMIT=<controller-supplied-full-40-hex-sha> TASK=9 python3 - <<'PY'
import os, re, subprocess
from pathlib import Path
source = os.environ['SOURCE_COMMIT']; task = os.environ['TASK']
if not re.fullmatch(r'[0-9a-f]{40}', source): raise SystemExit('SOURCE_COMMIT must be exactly 40 lowercase hexadecimal bytes')
if not re.fullmatch(r'[0-9]+', task): raise SystemExit('TASK must be decimal')
plan = 'docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md'
raw = subprocess.check_output(['git', 'show', f'{source}:{plan}'])
start_re = re.compile(rb'^#+[ \t]+Task[ \t]+' + task.encode('ascii') + rb'([^0-9]|$)')
next_re = re.compile(rb'^#+[ \t]+Task[ \t]+[0-9]+([^0-9]|$)')
section_re = re.compile(rb'^##[ \t]')  # exactly two '#': a top-level section, never a '### Task' heading
def extract(data):
    out = bytearray(); started = False; fenced = False
    for physical in re.findall(rb'[^\n]*\n|[^\n]+', data):
        body = physical[:-1] if physical.endswith(b'\n') else physical
        if not started:
            if not fenced and start_re.match(body): started = True
            else:
                if physical[:3] == b'```': fenced = not fenced
                continue
        if not fenced and out and (next_re.match(body) or section_re.match(body)): break
        out.extend(physical)
        if physical[:3] == b'```': fenced = not fenced
    if not out: raise SystemExit('requested task heading not found')
    return bytes(out)
out = extract(raw)
dst = Path('.superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a') / f'task-{task}-brief.md'
dst.parent.mkdir(parents=True, exist_ok=True); dst.write_bytes(out)
dst.with_suffix('.source-commit').write_bytes(source.encode('ascii') + b'\n')
dst.with_suffix('.expected').write_bytes(extract(subprocess.check_output(['git', 'show', f'{source}:{plan}'])))
PY
cmp -s .superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a/task-9-brief.md .superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a/task-9-brief.expected
rm .superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a/task-9-brief.expected
```

Repeat with `TASK=11`; do not run it for Task 10. The extractor begins at the first matching heading outside a fence, stops before next task heading OR before any bare `## `-level section heading (outside a fence) — the latter is what bounds Task 11's brief away from `## Deploy` onward, since no later `### Task` heading exists to stop it — toggles only when a physical line begins exactly with three backticks, and preserves every physical LF including missing final LF and the retained separator.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
    docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md server/test/session-hook.test.ts
git commit -m "docs: close D-2605 lifecycle and committed-byte audit"
```

---


## Deploy (after merge — agent-first, AGENT-FIRST is the rule for anything touching the hook)

`bash deploy/deploy.sh agent <fleet-host>` from a checkout of `main` on the box named in `~/.ccrc/deploy.env`. The hook is read fresh at every event and the helper beside it, so nothing restarts. The first live compaction on a current session is the check the spec names (§10): confirm `~/.cc-sessions/<id>.compactions` gains one complete line with all six provenance keys and no `n`; confirm the exact served marker and private claim are gone, the stable lock remains, and any successor set/card/marker bytes are unchanged. For a subagent compaction, `scope` and `transcript` name the agent file that carries the new `compact_boundary`. The journal is the deliverable; Plan B must read it through its future adapter.

## Deviations found

Numbers D-2384–D-2394 (the first review, eleven), D-2411–D-2420 (the second review, ten), D-2446–D-2455 (the first execution corrections, ten), and D-2460–D-2463 (the Task 6 fix-round corrections, four) were minted 2026-09-10 through `~/.local/bin/ccrc-api ledger allocate` (project `ccrc-pwa`; allocator floor then 2464), each defined here in the same act. **D-2605 was already allocated for the pre-Task-9 architecture amendment and is defined below; this edit allocates no number.**

- **D-2384 — the approved design's `agent_type` guard does not exist on the payloads.** Spec §3.1 guard 2, §3.3 step 0 and §3.4's guard were written as "`.agent_type` in the payload empty". Measured 2026-09-09 on 2.1.266 (five headless runs): the three compaction payloads for a subagent's compaction are byte-identical in key set to the main thread's — the parent's `session_id` and `transcript_path`, no agent field. Operator direction 2026-09-10: compaction works for a subagent exactly as for the main thread. Fix: the guard is gone; §3.0's scope rule replaces it, and the scope is a tag the console renders.
- **D-2385 — the first scope rule ("newest agent transcript wins") was a race, refuted before any code.** Three opus refuters (2026-09-10) measured on this box's corpus: a compacting context writes nothing for ≥79 s, siblings write every 4–6 s, Workflow fan-outs run seven and eight agents at once, and 5 of 197 main-thread boundaries had a newer subagent file. `prompt_id` is the parent's on a subagent's rows; no `CLAUDE_*` variable names an agent. Fix: liveness (§3.0) — manual → main; no live agent → main; one live agent beside a quiet parent → that subagent; anything else → `ambiguous`, which withholds the card and is measured. Recorded so nobody re-derives "newest wins".
- **D-2386 — one card and one set per session id, written by every context.** Two compactions of one session inside the in-flight window cross the pair and mislabel both journal lines, and no later arm can tell which context it serves. Original fix: an unconsumed set younger than `COMPACT_CARD_MAX_AGE` at PreCompact is overlap — that compaction is `ambiguous` and the card is removed; SessionStart(compact) serves only a matching pair; SessionStart and PostCompact never resolve. Superseded identity detail (D-2461): the set's collision-resistant `nonce`, not numeric `at`, is card line 1 and the matching key; `at` is retained only for measurement.
- **D-2387 — the set has two writers and two shapes.** The approved text had the helper as the set's only writer and exit 3 writing nothing; then PostCompact had no scope on a graphless tree. Fix: PreCompact writes the set always (`files: null` — not mined; `built`/`fresh` measured first so the journal carries them either way); the helper rewrites it on exit 0 and on exit 3 (`files: []` — mined, empty). Two conditions, two values.
- **D-2388 — `COMPACT_CARD_MAX_AGE` is 1200 s, the in-flight window, not a 3600 s serve bound.** The approved value bounded only the card's serving; the set had no age at all and a card that failed the bound was left standing. Argued from the longest measured compaction (826 s, gpt lane) ×1.45; applied to the card (removed when older), the set (removed unread when older) and the overlap check. **Superseded for the SET by D-2605 (round 13, A-M8):** an aged canonical set is NOT removed unread — PostCompact still claims it under the lock and measures it, its age deciding provenance eligibility only (spec §2's row, §3.4's settlement branch, §4's aged-set row). The card half stands unchanged.
- **D-2389 — the helper timeout is 8 s, declared as amendment R2 of the hook header's "no waiting".** The approved 20 s was a round number, 120× the hook's whole-arm p95; the wait was undeclared. Argued from node startup (~0.05 s), a 70 MB graph parsed in 1.15 s and a 64 MiB window scan (~1 s) at roughly twice their sum. The header sentence is corrected (Task 6); `find` is guarded inside the scope resolver, `node` remains unguarded, and D-2446 gives the deadline executable its portable local resolver. On a userland with neither deadline command, the feature is inert and says so.
- **D-2390 — `find -printf` is GNU-only; the hook declares two userlands.** The first amendment's one-liner (`-printf '%T@ %p' | sort -n | tail -1`) would print nothing on BSD and silently answer `main` for every subagent compaction, and `sort -n` is locale-sensitive. Fix: `find -mmin` (GNU and BSD) with a bash `read` loop and a `-d` guard; no sort.
- **D-2391 — the first plan proposed `compaction` as hookstate's sixth positional read-back line.** Its D-1249 ordering argument was internally consistent, but **D-2605 rejects the premise before Task 9**: hookstate is not a measurement cache, no read-back/reset/writer change lands, and `COMPACT_SHAPE_PRED` is used only by the exact-one helper-output gate. The journal is the sole authority.
- **D-2392 — the session's subagent directory is `${tp%.jsonl}/subagents`, not `<dirname tp>/<session_id>/subagents`.** Equivalent (the transcript's basename IS the session id, measured across five lanes), and it removes a second `jq` read of the payload and the shape gate a `$sid` interpolation would have needed.
- **D-2393 — the prototype's `(not in graph)` sentinel was an overloaded null.** It meant both "the card was cut" and "the working set was small". Recorded so nobody re-derives it: the card always prints `(+k files not shown)` when anything was dropped, and the set's `stats` tell a thin card from a thin session.
- **D-2394 — the first draft of the spec raised the emitter's clip to fit the compact card.** `CARD_MAX_CHARS` (2,400) is the only defence for the ungated `GM_NODES` (D-1899); raising it would have deleted that defence. Kept as the FIRST clip; the compact subject is appended after it under `CARD_TOTAL_MAX_CHARS`, derived, inside the one emitter.

The second review (2026-09-10, three opus refuters and a scout over the amended spec and this plan) found the following; each changed the spec and the plan before any code:

- **D-2411 — the overlap verdict was advisory: the earlier compaction's helper could overwrite it.** The hook marks the slot `ambiguous`, but the first draft's helper rewrote the set unconditionally, so a helper landing late restored a self-consistent pair the other context could consume. Original fix: the helper re-reads the set immediately before each of its two writes and refuses unless the slot is still its own (`slotIsMine`); what remains is the read-to-rename interval, stated in spec §10. Superseded identity detail (D-2461): `slotIsMine` compares the collision-resistant nonce, never numeric `at`.
- **D-2412 — `steered` was written before the fact.** The helper recorded `--steer` in the set before knowing whether it would exit 0, so an exit 3 under `--steer` would have read `steered: true` for a compaction that was never steered, corrupting Plan C's whole control variable. Fix: the helper always writes `steered: false`; the hook stamps `true` only after the print (Plan C); the flag is accepted and ignored here.
- **D-2413 — nothing recorded whether the card reached the model.** A mined set with a card that was never served (crossed pair, aged card, failed emit, timed-out helper) read exactly like a served one, so `cited` was uninterpretable. Original fix: `_hook_emit_context` returns non-zero when it prints nothing and Task 7 stamped `served:true` into the set. **Superseded before Task 9 by D-2605:** the emitter return remains, but SessionStart creates a nonce-keyed marker only after successful emit, never rewrites canonical set; PostCompact derives final `served` from its claimed nonce's exact marker.
- **D-2414 — the 5 s timeout was argued from parse time alone.** The review measured the first draft's naive suffix resolution (a scan of every file per token) at 2–12 s on a 64 MiB window against a 5,000-file graph, and `loadGraph` at ~1.5 s and ~250 MB RSS on a 51 MB graph. Fix: a basename index makes resolution O(tokens); `WINDOW_CAP` is 16 MiB (a never-compacted transcript is far smaller); `GRAPH_MAX_BYTES` (96 MiB) refuses a graph before parsing it; the timeout is 8 s and Task 6 re-measures p95 and RSS on this box's real graphs before it ships, with an acceptance bound.
- **D-2415 — a helper killed by `timeout` between its write and its rename leaked a dot-leading temp that the old generic `_reg_purge` never sees.** The final Task 9 contract supersedes the loose remedy: under the validated stable lock, PreCompact and purge age or delete only exact §3.4 family suffixes for this literal ID; no `.compact*.tmp` glob or generic pid/suffix grammar remains.
- **D-2416 — a PostCompact whose helper failed, or a box without `node`/`timeout`/the helper, left the set standing, and the next compaction inside the window read `ambiguous` for no reason.** Original fix said age/provenance would be read before consumption. **Strengthened before Task 9 by D-2605:** after the three fixed early guards, PostCompact safely acquires the shared stable mutex, saves canonical age, atomically hard-links canonical set to an independently named never-precreated private claim, unlinks only canonical alias, then touches that active claim before parsing/provenance or later dependency; every path consumes only that claim and preserves a successor canonical set byte-for-byte.
- **D-2417 — the `command -v node`/`command -v timeout` guards changed nothing observable in the original direct-append design.** The call site swallowed exec failure like helper failure, so those first mutation rows were green. **Superseded for Task 9 by D-2605's post-settlement dependency matrix:** `node`, resolved deadline, helper, and `flock` each have a one-at-a-time diagnostic failure case proving claim/marker cleanup, old-journal preservation, successor survival, and silence. PreCompact keeps its earlier behavior.
- **D-2418 — the approved spec block fed `measure` through a process substitution while claiming `pipefail` semantics.** A redirection is not a pipeline: a jq that died mid-write would have handed the helper a truncated summary and recorded a short `chars`. Fix: the plan's pipe form is now the spec's.
- **D-2419 — the rule recorded only its verdict, so its misfire rate could not be measured.** Fix: `parentLive` and `liveAgents` ride the set and the journal; the corpus measurement that closed the review's question — at an auto-compaction the parent's last row is 0.8 s old at p50, 3.7 s at p95, never 120 s (n=216) — is in spec §0.2.
- **D-2420 — three new dot-free registry suffixes would have silently staled `ccd/ccd`'s enumerated purge inventory, which the first draft forbade itself from touching.** Original fix: Task 11 added the three names to the comment, re-stamped `ccd/ccd`'s provenance marker with the command `ownership.test.ts` prescribes, and pinned the names. **Superseded before Task 9 by D-2605:** that inventory, its re-stamp, and the associated lifecycle cleanup now land with Task 9; Task 11 is documentation and committed-byte audit only.

The execution pass found the following corrections; D-2446–D-2455 were allocated together before these definitions were written:

- **D-2446 — a bare `timeout` conflicts with the shebang portability scanner and independent hook install.** The hook cannot borrow ccd's platform block. Fix: `_hook_timeout` locally resolves `timeout` then `gtimeout`; when neither tool exists it returns 127, which the existing silent call site swallows so the feature remains inert after the hook-owned set writes. **Merge fix M1 (2026-09-16) corrects the last clause, not the fix:** `_hook_timeout` ships exactly as described, but the tree around it moved — `ccd/session-hook.sh` now resolves the same two names above the event switch to bound its one `tmux display-message` question, and a box with neither exits 0 there, before the hook-owned set is written. "Inert after the set writes" was the whole-tree behaviour when this entry was made; the whole-tree behaviour now is that nothing is written at all, and the 127 return is reachable only for a failure the deadline itself does not resolve.
- **D-2447 — the helper CLI main guard failed under symlink invocation.** Fix: `realpathSync` establishes executable identity.
- **D-2448 — `readWindow`'s boundary-first chunk ignored the caller cap.** Fix: bound that read by cap minus already-read bytes.
- **D-2449 — `tokenRegex`'s leading lookbehind is output-neutral but a linear-time cost guard.** The output-only proof caused a reversal; a 64 KiB timing-effect test now pins it.
- **D-2450 — `TAG_RANK` duplicated `TAGS`, and unknown tags corrupted ordering.** Fix: derive the rank from `TAGS` and discard out-of-vocabulary tags.
- **D-2451 — two Task 4 mutation recipes were non-diagnostic on the original fixture data.** Fix: replace them with distinguishing count data and a timing effect.
- **D-2452 — Task 5's `steered:o.steer===true` mutation was vacuous because Plan A never forwards `--steer`.** Fix: mutate to `steered:true`.
- **D-2453 — L1 plus basename was an invented file-node heuristic contrary to the approved `metadata.kind`-or-highest-degree semantics.** Fix: remove it and test conflicting candidates.
- **D-2454 — the renderer stopped truncating at one file, allowing a long valid path to breach `maxChars` and clip mid-line without disclosure.** Fix: permit zero rows with `(+k files not shown)`.
- **D-2455 — the graph cap used `stat(path)` then `read(path)`, permitting replacement or growth above cap.** Fix: open once, bounded-read `maxBytes + 1` from that descriptor, and close in `finally`.
- **D-2460 — a helper error after the set rewrite falsely left `files` mined.** A card write can fail after the helper replaced the hook's `files:null` document, making PostCompact record a mining fact that never completed. Fix: render before the first target write; retain the exact initial bytes; after a post-set failure atomically claim **both set and card** with regular nonce/PID-qualified dot files before inspecting either canonical entry. The set stages a second exact-byte original source: a claimed A set returns only through no-clobber `link source target`; a claimed B/C set returns only through a no-clobber link from its retained claim. The card removes only a claimed A partial and restores a displaced B/C card through its retained claim. Direct regular placeholders prevent directory relocation, and exact-target `link` prevents a newer directory from receiving a contaminating child. Claims remain when C wins before or after restoration; failed-A restore artifacts stay sweepable with their A claim rather than risking deletion of a concurrent owner. The hook applies the same protocol for every helper result other than 0 or 3.
- **D-2461 — epoch-millisecond `at` collisions make it an unsafe owner.** Two PreCompact hooks can share a millisecond; treating `at` as identity lets an older helper or rollback overwrite a later owner. Fix: generate one `compact-<at>-<pid>-<RANDOM>-<RANDOM>` nonce in PreCompact, pass `--nonce`, store it immediately after numeric `at`, put it on card line 1, and use it at every ownership, pair, serve and rollback seam. Future Task 7 pairs by `.nonce`; Task 9 retains numeric `at` only as measurement.
- **D-2462 — the declared hookstate-first ordering lacked behavior evidence.** A source comment cannot prove the helper did not start before the `working` stamp became durable. Fix: the deadline-stub test reads persisted hookstate before it starts the helper, requires `state:"working"`, then drives a failing helper path whose rollback proves the initial document remains safe.
- **D-2463 — the graph cap had fixture-only refusal evidence.** The real megamek graph is 111,097,911 bytes, above the 96 MiB cap, so the production helper must refuse it before parse without changing a fresh set or producing a card. The Task 6 scratch measurement records that exit 1, unchanged bytes, absent card, duration and peak RSS.

- **D-2605 — Plan A's measurement authority and ownership transaction were raced.** The approved Task 9 draft kept a second `hookstate.compaction` cache, persisted `n`, appended with `printf >>`, read/aged the canonical set before ownership, deleted that pathname after helper execution, and let SessionStart rewrite `set.served`. Concurrent PostCompact and successor/SessionStart writers could disagree, lose a journal record, delete a successor, or mark the wrong set served. The final approved pre-Task-9 contract is the one in §§3.3–3.4 and Task 9: the journal is sole authority and physical position supplies ordinal; the permanent canonical lock is published from a private `mktemp` source via `link` and is never opened canonically; every holder opens an owned hard-link alias and validates FD/current-canonical identity before and after `flock` and before mutation. Compact SessionStart performs its operator-off guard, generation validation, lock acquisition, and under-lock revalidation before any lifecycle observation or mutation; it emits before publishing a same-nonce marker from a disjoint private source. PostCompact records canonical age, links a never-precreated private claim, proves identity, **unlinks canonical before touching claim**, then reads only retained claim-FD data. It safely reacquires the lock for exact raw-JSONL FD CAS/rename and every claim/marker cleanup; failure without that final lock leaves exact recovery residue. Generation is immutable exact no-LF UUID authorization read through owned aliases/FDs; no invalid present object is repaired. Task 9 alone owns ccd row creation, generation, spawn/retry export, purge, `_ws_slug_free`, and its provenance re-stamp; Task 11 is documentation and committed-byte audit only. The predicate retains all sixteen exact keys, `floor == .` integer/relational rules, raw physical-line terminal-LF semantics, and exact `\\z` anchors. Delivery is at-most-one attempt per actual process, not external replay exactly-once; the cooperative checks do not claim to defeat hostile same-UID mutation after their final portable-Bash check. Task 10 is unchanged. **Round 6 (2026-09-13) corrects five Important and nine Minor findings from two independent reviews of the round-5 commit, within this same D-2605 number — no new allocation:** the migration paragraph's hook set-temp grammar is corrected to the measured `<pid>.<id>.compactset.tmp` (the id occurs twice; the hook writes no card temp, only the helper does); PreCompact and `_spawn_start` now close the stable lock before forking — the bounded helper and the tmux spawn, respectively — and PreCompact alone reacquires after, because a held `flock` descriptor is inherited across fork/exec in bash and released only when every referencing descriptor closes, so no compliant design may hold one across a fork it does not control; PostCompact's final journal transaction now reacquires under its own longer `COMPACT_JOURNAL_FINAL_LOCK_WAIT` rather than the shared `COMPACT_JOURNAL_LOCK_WAIT`, since its miss is unrecoverable where settlement's own residue is not; settlement gains an explicit genuinely-absent-canonical-set branch, tested by pathname rather than inferred from a `link` return, that commits one null-scope/null-provenance record instead of silently folding into the link-failure no-record branch; and `_reg_purge`'s three post-action callers (`cmd_ws_rm`, `_ws_reap_locked`, `cmd_forget`) report a lock miss as a named `_lc_fail`, never a suppressed success string, since irreversible action already happened by the time any of them calls it — only the dead-reg pre-action caller may still decline unchanged. Minor corrections in the same round: `generation` is added to `_reg_purge`'s existing `archived`/`reaping` skip condition so the ordinary loop does not delete it out of order; `parentLive`'s prose now matches the matrix (null for ordinary auto/main and for auto/ambiguous with two or more agents, not only on a manual trigger); the artifact table's "never precreated" wording is narrowed to the `link`-created rows only; a disclosed, bounded cost is named for `_reg_purge` minting the permanent lock even against a never-existed id; `COMPACT_SHAPE_PRED`'s stale comment and its one real use (a pre-`JOURNAL_RECORD_PRED` shape gate on the helper's raw stdout) are assigned to Task 9; the raw-JSONL enumeration now names the one thing that does NOT fail, a CRLF-terminated line; Task 11's committed-byte extractor is bounded to stop before any `## `-level section heading, since Task 11 is the last `### Task N` heading and previously ran to EOF; and the hook's second lock-free standing-contract assertion (`:70-72`) and its stale broad-sweep constants comment (`:1095-1101`) are added to Task 9's file scope alongside the header Task 6 already amended. Also stated: `flock(1)` is util-linux and absent from stock macOS/BSD, where the whole compaction lifecycle goes inert exactly as it already does for a missing `find`/`jq`; `_plat_uuid` itself emits a trailing LF that the generation writer must strip, now with an explicit byte-count test; the full lock ordering is the reap lock (outermost, through `_ws_reap_locked`) then the stable compaction lock then the lifecycle journal/rotation lock; `ws-rm`/`forget` can now visibly decline against an in-flight compaction; and every `mktemp` template in §3.4 is explicitly inside `$REG`. Nothing else in round 5's contract changes. **Round 7 (2026-09-13) overturns round 6's own justification for one lock-across-fork exception, after an architecture adjudication, within this same D-2605 number — no new allocation.** Round 6 argued PreCompact could release the stable lock across the bounded helper because "the helper's canonical rewrite is already gated on nonce ownership" — measured false against the shipped helper (`ccd/compact-card.mjs:587-588`, `if (!slotIsMine(o.set, o.nonce)) throw …;` followed by a separate `write(o.set, …)`): check-then-act is not a compare-and-swap, so a sibling PreCompact acquiring the freed lock could publish `scope:"ambiguous"` and have that verdict destroyed by the first helper's own later rename, and `rollbackSet` (`ccd/compact-card.mjs:506`) renamed canonical away unconditionally before inspecting ownership at `:513`, making canonical transiently absent during every unlocked helper rollback — which round 6's new absent-set branch would then journal as a fabricated `scope:null` row. **Adopted: Option A, a staging-only helper.** No canonical pathname may appear in the helper's argv at all; it becomes a pure function of transcript/graph/labels writing two private stage files (named by the hook), and every ownership decision, canonical publication and rollback question moves into the hook, whose deciding section forks only synchronous children it reaps before leaving it (round 9 corrects round 7's "forks nothing"; §3.1's full protocol; interface item 3 above). Two alternatives were measured and rejected: **(B) helper acquires the lock itself — unbuildable**, node core has no `flock` binding (`fs.flock`, `fs.flockSync`, `fs.constants.LOCK_EX` all undefined, independently reproduced), and a `link`-based lockfile scheme would be a second, disjoint mechanism invisible to the `flock`-holding bash arms; **(C) helper launched under external `flock(1)` — measurably unsafe**, independently reproduced: `flock ./mk true` on an absent path creates it (exactly the create-capable canonical open §5 forbids), a backgrounded grandchild held the lock after the `flock` command returned, and with the path unlinked-then-recreated a second `flock -w 1` ran concurrently across two different inodes, splitting the critical section — unfixable because `flock(1)` itself is the acquirer, does no regularity/identity check, and never yields its descriptor; **(D) accept and document the race — forbidden** by §3.0's own rule and by the journal being the sole measurement authority. A per-transcript slot would dissolve the one-slot ambiguity rather than merely serializing it, but changes the artifact family and is named as the stated successor (spec §10), not a Task 9 deliverable. **Settlement's absent-canonical branch is corrected, not re-derived:** its premise is now true (every canonical existence transition happens inside a held lock, so "absent under the lock" has exactly one meaning) rather than merely asserted; §5's rollback-mid-flight fixture is replaced by a source scan asserting no code path renames, unlinks, or replaces the canonical set outside a held lock. **Two wait constants replace one:** `COMPACT_LOCK_WAIT_SERVE` (2 s, compact SessionStart's acquisition alone) and `COMPACT_LOCK_WAIT` (5 s, every other acquisition — PreCompact's two, PostCompact's settlement and final transaction, row creation, `_spawn_start`, `_reg_purge` — argued from ≥ 8× measured p95, not a round number), passed as the acquire helper's first positional parameter; round 6's separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT` and its false "short in-process sequence of syscalls" claim (the held sections span `find` twice, the sweep `find`, and `jq -cn`) are both retired. **Task 9 deletes, not migrates,** `ccd/compact-card.mjs:433-560` (`ownedSlot`, `slotIsMine`, `rollbackClaimPath`, `reserveClaim`, `hasCanonicalOwner`, `firstCardLine`, `firstSetNonce`, `rollbackSet`, `rollbackCard`, `rollbackPair`), `ccd/session-hook.sh:792-842` (the three rollback functions) and their call at `:899`, `ccd/compact-card.d.mts:42` (`slotIsMine`) and `:50` (`rollbackHook`), the twelve helper slot-check/rollback tests in `compact-card.test.ts` (round 8, I9 corrects this round's own "ten") and the eleven timeout-rollback race tests in `session-hook.test.ts` — their subject ceases to exist, replaced by nine stronger controls (interface item 3 and Step 1 item 6 above) that pin the absence of the capability rather than the repair of its misuse. **Also corrected in this round, independent of the ruling:** §3.0's normative ownership paragraph, which still described PreCompact "waiting for/accepting/rolling back" the helper's canonical rewrite; §10's residual, which claimed the helper "now executes while the shared ownership mutex excludes" other publishers — under option A the helper touches no canonical file, so the residual is restated as the one-slot ambiguity itself; `session-hook.sh:4-8` — Task 9's scope previously excluded it on the false premise that Task 6 already amended it "the same way," measured false against the shipped header; the purge-done mechanism, restated as measured (capture-then-emit-early, before the unlink loop — `ccd/ccd:1817-1828`, pinned by `ccd-lifecycle-purge.test.ts:37`/`:99`/`:115`) rather than round 5's falsified "only after successful purge" phrasing, which this round declines to restore verbatim precisely because the pinned test's own title contradicts it; the permanent lock's leading dot, restored at one spec citation; two further unowned broad-sweep comments (`session-hook.sh:790`, `:951`) and the live sweep they describe (`:869`) added to Task 9's scope; a guard added so no `tx` can emit both `_lc_fail` and `_lc_done purge`; `_ws_slug_free`'s pin corrected from a vacuous claim that it already sees every private family (it globs `id.*`, structurally blind to every dot-leading name) to a claim that a planted lock-open-alias residue reads not-free while the permanent lock alone does not; the unreachable "operator-off file appeared between arms" cause removed from the genuinely-absent branch (PostCompact's own operator-off guard runs first); a new §4 row for a session whose generation was reused in the close-to-fork gap, permanently and silently inert with no diagnostic; and every surviving instruction to call `slotIsMine` from a bash arm replaced with the bounded `read -N` head-parse idiom already used at `session-hook.sh:934-935`, since `slotIsMine` is a JavaScript export with no bash counterpart and, after this round, no bash caller either. **Declined:** this plan does not restore round 5's literal "`_lc_done purge` is emitted only after successful purge using captured values" sentence, because it is falsified by `ccd-lifecycle-purge.test.ts`'s own pinned title and the shipped source's own comment, not merely superseded by round 6 — see the correction above for what is restored instead. **Round 8 (2026-09-13) closes the provenance channel round 7's own argv change severed, plus ten further Important and eleven Minor findings from the same two-review round, within this same D-2605 number — no new allocation.** The CRITICAL: option A's helper lost its only source for `parentLive`/`liveAgents` when `--set` left its argv at round 7 — it used to read them via `ownedSlot(o.set, o.nonce)` (`ccd/compact-card.mjs:576`, `:579-580`) off the canonical set — and nothing replaced that read, so on the NORMAL path every carded compaction would publish an impossible provenance tuple (PostCompact's `measure` running without `--set`, collapsing `scope` and all six provenance fields to null) and trip the very "wrong `parentLive`" regression this design forbids. Neither field is derivable inside the helper from `--scope` alone (`auto`/`main` needs `liveAgents:0`, `manual`/`main` needs `liveAgents:null` — same scope, different values) nor would a bare `--trigger` suffice (`auto`/`ambiguous` needs the ACTUAL live-agent count, which only PreCompact's scope resolution has measured). **Fix, chosen explicitly over adding `--trigger`:** `--parent-live` and `--live-agents` join the `card` argv, copied verbatim into the staged set exactly as `--scope`/`--agent`/`--at`/`--nonce` already are; `--trigger` is deliberately NOT added, since PreCompact's already-computed values fully pin the exact §3.0 matrix row without the helper deriving anything — propagated to §3.1's protocol and argv, §3.2's Input, `REQUIRED_CARD`, `cardCommand`'s option type in `ccd/compact-card.d.mts:45-51` (which still declared `out: string; set: string`, the round-8 M8 finding folded into this same fix), and §5's mutation table. **Ten Important, all corrected in the same commit:** (I1) `steered` cannot be stamped by a rename — a rename moves bytes, it does not write them — so the hook now stamps `steered` into the still-private set-stage via one `jq` rewrite (never of canonical) immediately before the rename that publishes it; (I2) `COMPACT_LOCK_WAIT_SERVE` is now named explicitly at compact SessionStart's one lock acquisition, closing a wait constant that was defined but never wired to any call site; (I3) the helper's own mid-write residue is named `<stage>.part`, not `<stage>.<pid>.part` — the stage basename already carries the HOOK's pid and nonce, and a second, helper-owned pid component would be unnameable by the exact-family sweep, since the hook never learns the helper's pid (a foreground `timeout` call, no `$!`); (I4) `_ws_slug_free` is widened (Task 9) to an exact-family dot-leading scan — strip the literal `.<id>.` prefix, match the remainder against §3.4's private-family grammar or the bare `.generation` field, report not-free, permanent lock the sole exclusion — because the round-7 pin asked an unchanged, structurally-blind function to observe exactly what it cannot; (I5) Task 2's own Step 3 verbatim `_ws_slug_free` block, which ships into `ccd/session-hook.sh`, is corrected to match §3.4's (also corrected) text rather than the overstated claim it still carried; (I6) `_hook_compact_served` (`ccd/session-hook.sh:985-992`) and its call at `:1375` — a live, undeleted canonical `set.served` rewrite the original D-2605 ruling already forbids — join Task 9's deletion scope, along with the tests that assert it (`session-hook.test.ts:2938`, `:2979`/`:2987`, `:3011`/`:3016`); (I7) `ccd-lifecycle-purge.test.ts:99-147`'s "is unconditional" pin is strengthened to require that nothing but the header comment and Task 9's own new lock acquisition precede the `_lc_done purge` emit, since its existing assertions (emit-before-unlink-loop, no trailing `||`/`&&`) stay green under a silently inserted conditional guard; (I8) the §2 architecture diagram's ordering is corrected to `scope + graph-measure (no lock) → lock, generation validate, overlap/young-claim check`, matching §3.1's own protocol rather than implying the lock is held across scope resolution; (I9) Task 9's test-deletion enumeration undercounted `compact-card.test.ts` — TWELVE tests exercise `slotIsMine`/rollback directly (`:455`, `:472`, and the ten at `:504`,`:525`,`:542`,`:564`,`:592`,`:621`,`:652`,`:681`,`:712`,`:744`), not ten, and the import at `:15` and the key-order pins at `:441`/`:500` (which still include `served`) need the same treatment; (I10) the rollback-function deletion range is corrected to `:792-842` (`:843` is blank, `:844` starts the next section banner), everywhere this document previously read `:792-847`. **Eleven Minors, all addressed:** the §4 table gains a named row for the print succeeding and the following stage-rewrite-then-rename failing (M1); `COMPACT_LOCK_WAIT_SERVE=2` is stated plainly as a product choice, not an independent measurement, unlike its sibling (M2); this document's own off-by-one — "protocol step 6" for what the numbered box calls step 7 — is corrected in the spec (M7). **(M3 is superseded: round 8 recorded the "steps 5–7 and 9–13" hold-section sentence as "left as measured-accurate on inspection" in the very round that added a second `jq` to the section it enumerates, so that inspection did not support the claim. Round 9 re-enumerates both held sections against the numbered box — steps 5–8 under the step-4 acquire, steps 12–13 under the step-11 reacquire — and lists each section's own forks.)** the raw-JSONL enumeration now names a duplicate key and leading whitespace before `{` alongside the already-named CRLF case (M4); the absent-canonical source-scan control gets a named recognizer and a per-file inventory including `ccd/ccd:1840-1848`'s ordinary purge-loop unlink, which is lock-protected only because `_reg_purge` holds the lock for its whole body (M5); `session-hook.test.ts:2390`'s broad-sweep test is added to Task 9's scope (M6); the `.d.mts` enumeration is folded into the Critical's propagation list rather than left as a separate M8 (see above); the head-parse-idiom citation is corrected from `:958` (the card-claim body read) to `:934-935` (the actual set-head `read -N 4096` plus nonce regex) everywhere it appeared (M9); a quoted shipped comment is reordered to match its actual source order (M10); and four more `compact-card.test.ts` call sites still passing `out`/`set` (`:425`, `:493`, `:781`, `:803`) are folded into I9's accounting (M11) — **corrected in round 9 to FIVE: `:772`/`:773` is a genuine fifth site and round 8's "the four REMAINING" was itself an asserted-complete enumeration that was not.** **Round 9 (2026-09-13) closes eleven Important and sixteen Minor findings from two more independent reviews of the round-8 commit, within this same D-2605 number — no new allocation.** **⚠ READ ROUND 10 FIRST: five claims stated as fact in this round-9 record were measured false and are SUPERSEDED — (1) the flock ruling's blanket "OPEN for ccd's own registry operations" and its "`ws-rm`, `ws-reap`, `forget` and `ws-gc --prune`" list (`ws-add`/`ws-restore`/`ws-reap` already fail CLOSED, and the fail-open is now gated on generation-absence); (2) "so each numbered box step is claimed by exactly one prose item" (true only of steps 11–14); (3) "all five `session-hook.test.ts` `.served` assertions" and the `\.served`-only scan (there are SEVEN, and the grammar is blind to property position); (4) the hold-section fork list's inclusion of the scope `find`s (they are step 2, `[no lock]`); (5) `_ws_slug_residue` widened alone (`cmd_ws_add`'s message template must change with it). The sentences below are the round-9 record as written; the corrections are in the round-10 entry at the end of this ledger.** The round-8 findings shared one cause: load-bearing sentences asserting what bash, jq, or the shipped code does, written without a probe. Every correction below is recorded with the measurement that establishes it, and each was swept across BOTH documents rather than fixed at the one line a reviewer cited. **Regex engines, stated once (B-I1).** §3.3 step 2's nonce validator was spelled `^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+\z` but runs in bash, where POSIX ERE has no `\z` and `regcomp` reads it as a literal `z`: measured on bash 5.2.21, that pattern does NOT match a well-formed nonce and DOES match one ending in a literal `z`, so implemented verbatim it would have served nothing on every compaction and collapsed every journal record to `served:false`. The bash arm anchors with `$` (measured: matches the well-formed nonce, rejects the trailing-`z` form, rejects a trailing LF, rejects an embedded LF); jq/Oniguruma keeps `\z` (measured true/false on the same two strings). §3.4 states the engine rule once, §6's blanket "exact `\z` anchors … remain unchanged" — the sentence that made copying `\z` into a bash arm the natural error — is replaced by that split, and §3.3's validator is spelled out. The one place the engines differ in strictness favours bash: jq's `$` ACCEPTS a trailing LF (measured `true`), bash's does not. **Compact SessionStart's held lock (A-I2, M-3).** "This arm forks nothing, so … Important-2's close-before-fork rule does not apply here at all" was measurably false — the arm forks `find`+`rm` at `session-hook.sh:923`, the `( set -C; : > "$claim" )` subshell at `:953` (measured: `BASHPID` differs, so a `( )` group is a fork), `mv -f` at `:954`, `link` at `:964`/`:970`, `rm -f` at `:955`/`:965`/`:971`/`:974`, `jq -cn` at `:94`, plus this design's own marker `mktemp`/`link`/`rm` — and a held `{fd}<>` descriptor is measurably inherited across fork/exec (an exec'd child's `/proc/self/fd` lists it). Every "forks nothing" phrase in both documents — the spec's status line, its §3.1 preamble and its §3.3 preamble; the plan's SessionStart file bullet, interface item 4, and round 7's own ledger sentence — is replaced by the standing rule's qualifier: the arm forks only synchronous children it reaps inside the section, so the rule APPLIES and is SATISFIED, never disapplied. **(Cited by description, not by line, corrected round 10 A-M1: round 9 wrote `:27`, `:405`, `:734`, and at the very commit that recorded them only `:27` still landed on the replacement prose — `:405` is a §3.0 matrix row and `:734` is the "The card." heading, so a reader chasing them lands on unrelated content.) The one occurrence that SURVIVES is deliberate and true as scoped:** §3.1's second-held-section sentence says its ownership re-read "is the bounded `read -N` plus bash regex and forks nothing", which is correct — measured with `strace -f -e trace=clone,clone3,fork,vfork,execve` over the shipped `session-hook.sh:934-935` sequence (`read -r -N 4096` plus `[[ =~ ]]`), the trace contains ZERO clone/clone3/fork/vfork syscalls and its only `execve` is the outer shell's own. So a later sweeper's grep finding it is not a regression, and "Every … is replaced" should be read against the retired arm-level claim, never against that scoped one. §5 gains the row and the fork-then-release fixture is extended from PreCompact and `_spawn_start` to this arm; measured control, all-synchronous ⇒ fresh acquirer in 424 ms, one `sleep 5 &` ⇒ timed out for the full 3 s. **The absent-canonical source scan is INVERTED (A-I3/B-I3).** Round 8's "NAMED recognizer" grepped for a canonical-set literal adjacent to a primitive and matches ZERO real mutation sites: measured, `session-hook.sh`'s `compactset` literals (`:795`, `:796`, `:851`, `:920`, `:986`, comment `:1094`) carry no primitive, every mutating line names only a variable, and `grep -c 'compactset\|compactcard\|compactions' ccd/ccd` is **0**, so the scan's single hit across both files was a comment. It now enumerates primitives and resolves the canonical pathname through the variables bound to it (`set=` at `:851`/`:920`, `_hook_write_atomic`'s `$1` from every call site), defines "adjacent" as same statement, adds PreCompact's step-7 publication at `:886` as a fourth allowed site under its first held lock, and carries a mandatory NON-VACUITY control (found set non-empty and containing `:886`). **The provenance wire contract (A-I1/B-I2, M-8, M-2).** `--parent-live` takes `true`/`false`/empty and `--live-agents` a decimal or empty; **empty means JSON null for both**, which is the hook's own measured encoding (`:744`, `:756`, `:762`, decoded by its own `jq` at `:880-881`). The helper converts exhaustively and `Number(v)` on a possibly-empty value is FORBIDDEN and named as the trap — measured, `Number('') === 0` with `Number.isInteger` true, and the file's own idiom at `compact-card.mjs:803` invites exactly that extension, while `REQUIRED_CARD`'s `k in o` test (`:801`) is satisfied by an empty string. "Copied verbatim" is clarified to mean the VALUE is the hook's and never derived, not that the string is written unconverted. §5's round-8 row gains the `manual`/`main` leg — the ONLY leg that reds either a scope-derivation mutant or the `Number('')` trap, since both auto legs stay green under each — and the §2 diagram's argv line and "pure function" phrase are updated. **Both surviving producers change (B-I4).** "Only the hook's set-temp producer and the SessionStart claim producer carry forward, unaltered in shape" was false for both halves: the set temp is altered nineteen lines earlier, and the claim's shipped `<pid>.compactcard-claim.tmp` (measured at `session-hook.sh:952`) differs from the table's `compactcard.<pid>.<nonce>.session-claim.tmp`. The clause is deleted, the claim's target grammar is stated as buildable (step 2 validates the nonce before step 3 claims), and its legacy shape joins the transition allowance beside the set temp's two-id shape. **`_ws_slug_residue` is widened with `_ws_slug_free` (B-I5, B-M6).** Round 8 widened only the first of a pair, so `cmd_ws_add`'s refusal (`ccd/ccd:4356-4357`) would have printed empty braces and named no file, falsifying the shipped contract at `:4350-4354`; the residue function takes the identical prefix strip, family match and permanent-lock exclusion, and `ccd/ccd:1129-1132` and `session-hook.sh:1098` join the comment scope. **Enumerations (B-I6, B-I7, M-6, M-7, B-M4).** Five `compact-card.test.ts` call sites, not four (`:772`/`:773` added, with the requirement that the nonce-required assertion move to an argv satisfying every other `REQUIRED_CARD` member, since `main` returns on the first missing key in array order and `nonce` is last); all five `session-hook.test.ts` `.served` assertions with a per-assertion disposition (`:2967` retargets to exactly-one-marker while KEEPING the 8-racer test, `:3038` retargets to no-marker), plus a source scan asserting zero `\.served` occurrences remain; and `CompactSet.served` becomes `served?: boolean`, a tolerated legacy input for the isolated `measure` path only. **The `flock`-absence blast radius (B-I8).** Round 8 bounded the cost to "the compaction lifecycle" while its own rules composed into a permanent, fleet-wide failure of `_reg_purge` and therefore `ws-rm`, `ws-reap`, `forget` and `ws-gc --prune` (call sites measured at `ccd/ccd:4896`, `:11167`, `:11668`, `:15555`), three of them only after irreversible action. **Ruling: mechanism-absence fails CLOSED for the three hook arms and OPEN for ccd's own registry operations**, argued from four facts — these operations predate D-2605 and never needed this lock; on such a box no compaction artifact is ever published, so there is no competitor to exclude; generation publication is already atomic through no-clobber `link` with EEXIST-then-reclassify (measured); and mechanism-absence is a static property established by `command -v flock` before any acquire, never confused with contention (measured: both spell their failure `1`, so the distinction must live in which probe answered). It is explicitly NOT the forbidden second lock-free concurrency regime, and the difference is stated: that prohibition is about the HOOK publishing contended artifacts unlocked. §4 gains a row, §10 a residual, §5 a fixture. **Minors, each a real correction:** `(protocol steps 12–14)` at §3.1 item 10 becomes step 13 with item 9 renumbered to steps 11–12, so each numbered box step is claimed by exactly one prose item; the §2 diagram's "set carrying `steered`" and its two-condition `iff` (four conditions); the hold-section enumeration re-measured and its "measured-accurate" claim withdrawn; §5's steering row brought into line with the plan's own control, including the "rewriting canonical instead of the stage" mutation; "(stage 2 only)" scoped to BOTH the print and the stamp, with Plan A running neither and the staged `steered:false` published unchanged; rc 1's "nothing written" corrected to "no canonical pathname touched; a stage written before the failure may remain"; and `_reg_purge`'s "nothing here can gate the purge" comment (`ccd/ccd:1822-1827`) added to Task 9's comment scope, restated as measured without overstating the change. **Preserved unchanged:** the option-A ruling and its platform rejections; the CAS with no unlocked canonical writer; card-before-set; rollback removed not relocated; staging lifetime and family disjointness; the purge-done reconciliation and the refusal that produced it; `<pid>.<id>.compactset.tmp` and "no hook card temp"; generation-last as a mechanism; `parentLive`'s matrix and the "no `--trigger`" argument; the `_lc_fail` four-caller split; Task 11's `##`-bounded extractor; the jq `\z` anchors, the physical-line predicate, exactly 16 keys, no persisted `n`, no `hookstate.compaction`, exact-one helper output, retained journal FD/CAS; `ccd/ccd` runtime owned solely by Task 9; Plan A ships no wire; and no retroactive rewriting of completed Task 5/6/7 sections. **Round 10 (2026-09-13) closes seven Important and four Minor findings from two more independent reviews of the round-9 commit, within this same D-2605 number — no new allocation.** Round 9's own cause recurred one layer up: sentences about the SHIPPED TREE written without reading it. **The hold-section fork list (A-I1).** Round 9's "re-enumerated against the numbered box rather than asserted" sentence put step 2's lock-free scope `find`s inside the FIRST held section; the box marks step 2 `[no lock]` and item 3 restates it. The scope `find`s (`session-hook.sh:754`, `:761`) are deleted from the list, which is now the overlap `find` (`:862`), the sweep `find` (`:869`), the `jq -cn` (`:875`) and `_hook_write_atomic`'s `mv -f`/`rm -f` (`:782`, `:781`); step 8 is stated to add NO fork (`_hook_gate_tree` `:300-302` is builtin `[` tests). Two source-order pins land: acquire after scope/graph-measure and before the overlap `find`, and exactly two `find`s between acquire and release. **The flock ruling is SCOPED and GATED (A-I2, B-2, and both self-challenge verdicts).** Round 9 asserted a blanket over "ccd's own registry operations" having measured none of ccd's five `command -v flock` sites. Measured: `_lc_rotate` (`ccd/ccd:2378`) and `_tmux_new_session` (`:13242`) fail OPEN; `cmd_ws_add` (`:4341`), `cmd_ws_restore` (`:6745`) and `cmd_ws_reap` (`:10202`) already fail CLOSED, the last pinned by `ccd-ws-reap.test.ts:342` and carrying ccd's own doctrine at `:10196-10197` ("NOT a degraded mode … the destructive verb does not run"), which this design now CITES rather than contradicts. All five keep their shipped disposition; the ruling governs only `_reg_purge` via `cmd_ws_rm` (`:4896`), `cmd_forget` (`:15555`) and `_ws_gc_prune_row` (`:11668`), plus generation init/export. `ws-reap` is deleted from §4's and §10's fail-open lists; "row creation … continue" is qualified to row writes that do not pass through `cmd_ws_add`. **The PATH hole both reviewers found is closed by gating the fail-open on the ABSENCE of `$REG/<id>.generation`** — not on the permanent lock, which spans row generations and is minted even against a never-existed id, so its presence proves history rather than a live regime. The generation field's three needed properties are each already specified: minted only by a flock-capable row creation, deleted last by purge, replaced on row reuse. Present generation + unresolvable `flock` ⇒ `_reg_purge` fails CLOSED, recoverably (re-run from a flock-capable PATH; the refusal adds nothing irreversible), with `_lc_fail` naming the cause; absent ⇒ fail OPEN, since no hook on that row ever held a generation. The generation channel is also named as what makes fact (ii) true on a consistent box: a flock-less `_spawn_start` exports no `CCRC_SESSION_GENERATION`, so every hook arm refuses. A shared fixed-path `flock` list is REJECTED as primary — it misclassifies an off-list `flock` as inert, and separate `install_atomic` targets give any list change a one-sided window. **The third reason offered for that rejection is measurably wrong and the correction is recorded instead:** "no scan over `ccd/` to catch a second spelling" rests on `session-hook.sh:1175-1177`'s shipped comment (round 10 cited it as `:1167-1168`; corrected round 11, A-I6/B-M3 — `grep -n 'does not scan'` returns exactly `:1175` and `:1167-1168` carry a different, correct sentence), and measured against `server/test/single-definition.test.ts`, `bashRoots` (`:1115`) IS `[<repo>/ccd, <repo>/deploy]`, `BASH` (`:1139`) covers every bash file under them, and `holdersOf` (`:1145`) filters it — with `ccd/ccd` and `ccd/session-hook.sh` pinned as members at `:1160-1164`. Only `ROOTS` (`:32-37`) is TypeScript-only. That stale comment joins Task 9's comment scope; the darwin condition (`ccd/ccd:484-505`, `_svc_job_path` `:511-517`) is recorded as the reason the gate is needed at all. Two caveats stated: the mint-after-test window is narrowed not closed, and a box that genuinely loses `flock` wedges its generation-present rows until it returns. §5's fixture is rewritten to assert `ws-add`/`ws-reap` REFUSE with their existing messages, the other three complete on a generation-absent row and refuse on a generation-present one, and that mechanism-absence is established by SHIMMING `command` (`ccd-ws-reap.test.ts:355`'s idiom), never by an emptied PATH and never by an acquire attempt. **The steering row is SPLIT (A-I3).** Round 9 scoped "(stage 2 only)" to both the print and the stamp — so Plan A runs neither — while leaving a §5 row demanding Task 9 red a print/stamp ordering, D-2548's own recorded defect class. The Plan-A half (card-stage rename before set-stage rename; the helper's staged `steered:false` published byte-for-byte; no `jq` rewriting canonical) stays with Task 9; the print → stage-stamp → set-rename ordering moves to an explicitly Plan C / stage-2 row owned by no Task 9 step. **`.served` is SEVEN assertions, not five (B-1).** `session-hook.test.ts:2319` and `:2491` assert `served:false` in PROPERTY position inside `toMatchObject` literals on the hook-written set, invisible to a `\.served` grep; measured against this repo's `@vitest/expect` 4.1.10, subset equality returns FALSE on an absent key (and on present-but-`undefined`), so both red in Step 4 — exactly the surprise the self-check exists to prevent. Disposition: drop the member from each. The scan grammar becomes the UNION of `\.served` and `(^|[^A-Za-z_])served\s*:`, with a stated two-class allow-list (the `measure`-input fixtures `:2913`/`:3032`; the `it(…)` title prose `:2979`/`:3011`) and a non-vacuity control requiring exactly the seven assertions outside it. **The controller's prescribed control said the property-position scan finds SEVEN lines; measured, it finds SIX, only two of which are assertions — the seven is the UNION's eleven matches minus the four allow-listed, and the plan now says so.** **`_ws_slug_residue` alone cannot fix `ws-add`'s refusal (B-3).** `cmd_ws_add`'s message template hard-codes `$REG/<id>.` — a dot AFTER the id — while every widened family is dot-LEADING, so no return value can make it name a real file: measured, the stripped-suffix return yields a path that does not exist and the full-basename return yields `$REG/demo-quiet..demo-quiet.…`, which does not exist either. `ccd/ccd:4355-4357` joins Task 9's modify scope; the residue function emits complete `$REG`-relative basenames and the die prints a plain list rooted once, dropping the brace template — which measured never worked even for the dot-free case, since the shipped `, ` separator defeats brace expansion (`echo prefix.{uuid, workdir}` prints the literal braces). §5's test gains assertion (c): every path the message names EXISTS. **The retracted purge-emit claim survived in FOUR places, not three (B-4).** §6's normative "may not emit its terminal fact until completed"; §4's combined lock/mutation row; the plan's own Task 9 item 9, found by this round's own sweep and named by no reviewer ("Lock miss/unsafe/removal failure is nonzero, emits no purge-done"); and §3.4's "or removal failure" disjunct. (Round 11 reorders this enumeration so each quoted phrase sits wholly inside its own quotation marks: as round 10 wrote it, the `removal failure[^.]*no purge-done` alternative matched ACROSS two separate quotations and the intervening prose, which no containment-based allow-list can permit — this sentence was one of the two live matches the re-specified scan found.) All four are corrected: the emit precedes the unlink loop unconditionally (`ccd/ccd:1828` before `:1840-1848`), so a removal failure leaves the fact ALREADY journaled. §4 splits into a LOCK-miss row (no fact, nothing deleted) and a MUTATION-failure row (fact on disk, registry/generation may remain, callers `_lc_fail`); §6 becomes "emits its terminal fact EARLY — capture under lock, emit, then delete". Round 10's post-edit sweep then claimed: "'until completed' now returns ZERO in both documents". **That claim is false and is corrected here (round 11, M3/B-M1), together with the allow-list it produced.** Measured at round 10's own commit, the literal phrase occurs ZERO times in the spec — and only because it is HARD-WRAPPED across two physical lines inside §6's own retraction quotation, which a line or whole-file grep never crosses — and FIVE times in this plan, four inside the scan specification and one inside this very ledger sentence. A reader re-running the sweep to check the round's work gets a non-zero count and cannot tell whether the round lied or the sweep drifted. The same miscount produced the scan's wrong allow-list, which named three SPEC sites that match nothing at all. What is true: every surviving "no purge-done" is scoped to the lock-miss case or sits inside a quotation that the same paragraph marks as retracted, and the counts themselves are now a MEASUREMENT the scan asserts rather than a sentence a round writes. The documentation-consistency scan joins the test list, re-specified over paragraph-joined text of both named documents with a containment-plus-retraction-marker allow-list and a non-vacuity control that requires the wrapped §6 quotation to be found. **Minors (A-M1..4).** The ledger's "forks nothing" sweep is cited by description rather than by the stale `:27`/`:405`/`:734` (at that very commit `:405` was a matrix row and `:734` a heading), and the one true scoped survivor — §3.1's ownership re-read — is named, measured with `strace -f`: ZERO clone/clone3/fork/vfork syscalls for `read -N` plus `[[ =~ ]]`. Task 2's Step 3 constants block is marked a HISTORICAL record whose shipped text differs (measured: `session-hook.sh:1091-1101` carries the OLD wording), with `_ws_slug_residue` put beside `_ws_slug_free` in it and in the live `:1098` comment scope, plus a pin that neither may be named without the other. The inverted source scan is reordered so canonical-pathname resolution is the FILTER that produces the found set, states that the helper's two `writeAtomic` primitives are excluded BY the filter rather than by an allow-list entry, adds a glob-bound-target clause so `ccd/ccd:1848` is reachable honestly, and strengthens the non-vacuity control to require BOTH `session-hook.sh:886` and `ccd/ccd:1848`. §3.1 item 10's "each numbered box step is claimed by exactly one prose item" is replaced by the claim actually established (steps 11–14), since step 8 is claimed twice and steps 1–2 three times. **Preserved unchanged:** the option-A architecture and its platform rejections; the CAS with no unlocked canonical writer; card-before-set; rollback removed not relocated; staging lifetime; the purge-done reconciliation (emit early, capture under lock, delete after — NOT re-broken while fixing B-4); the provenance wire contract with empty-means-null and the manual/main leg; the engine rule (`$` in bash, `\z` in jq); the corrected transition producers; generation-last as a mechanism; `parentLive`'s matrix; the `_lc_fail` four-caller split; Task 11's `##`-bounded extractor; exactly 16 keys, no persisted `n`, no `hookstate.compaction`, exact-one helper output, retained journal FD/CAS; `ccd/ccd` runtime owned solely by Task 9 with Task 11 documentation and audit only; Plan A ships no wire; and no retroactive rewriting of completed Task 5/6/7 sections. **Round 11 (2026-09-14) closes the seven surviving Important and all sixteen Minor findings from two more independent reviews of the round-10 commit, within this same D-2605 number — no new allocation — and REPAIRS A DELETION THIS LEDGER NEVER RECORDED.** **The deletion, named here so the next merge can justify taking this side at an artifact conflict.** D-2605 round 1, commit `6330547f`, deleted from the spec the entire `field | meaning | type` measurement table for the journal record and roughly seventy further lines of measurement prose and matrix rows, while rewriting the helper sections. Ten rounds of review did not notice, because every round measured what the document SAID and none measured what it had stopped saying. Measured at the round-10 tip: `heading regex` occurred 0 times, `cited nothing` 0, `not 0` 0, `never a smaller` 0, `path-segment-aligned` 0, `unmatched opener` 0, `19%` 0; the word `cited` survived only inside the predicate’s TYPE constraints, so the document constrained the shape of the primary metric this plan exists to collect and no longer said what it MEANS. Round 11 restores it as an EQUIVALENCE AUDIT rather than a paste: the `chars`, `filesChars`, `fences`, `cited` and `setSize` rows are Task 8 fix round 3’s FINAL rows, byte-verbatim from `188c1d8a`, and sit beside `JOURNAL_RECORD_PRED` so the type checks stand next to the semantics they pin; `steered`, `trigger`, `scope` and `at` are restored with D-2605’s current meanings; `served` is restated as MARKER-DERIVED, never copied from a set, which is the whole of D-2605’s serving correction; the six provenance rows are added consistent with §3.0’s matrix; and there is NO `n` row, deliberately. The prose rules restored with it are the null-vs-zero rule (“no set” and “cited nothing” are different conditions, an unknown scope is not the main thread, a corrupt `files[]` entry yields null and never a smaller valid working set, `files: []` yields `cited:0`/`setSize:0`), normalise-first mirroring what the binary does before injecting, and nine measurement rows returned to §4 (served session; no tool calls; aged set; unparseable set; crossed pair; card never reached the model; nine-section-format miss; the model ignoring the steering; `compact-card-off`). **The loss was prose only, which is the finding that matters:** every restored rule is pinned by Task 8’s landed tests — normalisation at `server/test/compact-card.test.ts:827-831`, the heading regex at `:833-840`, the fence rule and unmatched opener at `:842-871` with the complete fence grammar at `:873-895`, citation boundaries and within-set suffix uniqueness at `:897-931`, null-vs-0 and null-vs-`main` at `:949-951`/`:959-968`, and `files: []` ⇒ `cited:0`/`setSize:0` at `:969` (every anchor below `:870` RE-MEASURED in round 12 — Task 8's fix rounds 3 and 4 inserted `:906-927` and `:929-931` into this file, shifting the tail of the list the chain had carried). Round 1 deleted the prose and left every one of those green, which is exactly why no suite reddened and no round noticed: a green suite proves the mechanism, never the document. **The Plan B chip and reader rows deleted in the same commit are NOT restored: they are DEFERRED to Plan B by §3.6, which states the tolerant journal adapter and the wire/chip contract are future work rather than a promise in Plan A.** **The seven surviving Importants.** §3.4’s concluding platform-outcome paragraph was byte-identical to its pre-gate parent and both halves were false — `_reg_purge` does not “keep working” on a generation-present row, and the fourth caller is unreachable because `cmd_ws_reap` dies at `ccd/ccd:10202-10204` where `_lc_refuse` “EMITS, THEN DIES. Never returns.” (`:2766`) — so it is restated to the gated rule (A-I2). The documentation-consistency scan is RE-SPECIFIED (A-I4/B-I3): it was red on the correct tree, its three-site allow-list matched nothing, and as a line grammar it could not see the wrapped restoration it exists to prevent. It now runs over PARAGRAPH-JOINED text of both named files, allow-lists a match only when it sits wholly inside a backtick- or double-quote-delimited span in a paragraph carrying one of four stated retraction markers, and carries a non-vacuity control requiring six raw matches including the wrapped §6 quotation a line grammar finds zero times. Measured on this commit: pattern 1 RAW=6 ALLOWED=6 LIVE=0; pattern 2 (the four-caller rule, added for A-I2) RAW=1 ALLOWED=1 LIVE=0. “The three post-action callers report `_lc_fail`” is corrected to TWO for the mechanism-absent condition (A-I5/B-M5): `cmd_ws_rm` (`:4896`) and `cmd_forget` (`:15555`) report; `_ws_gc_prune_row`’s dead-reg arm (`:11668`) reaches `_reg_purge` as its FIRST destructive act and declines unchanged; `_ws_reap_locked` is unreachable. The general LOCK-MISS statements keep “three”, which is correct on a flock-capable box. The stale hook-comment anchor moves from `:1167-1168` to `ccd/session-hook.sh:1175-1177` at all four sites (A-I6/B-M3; measured, `grep -n ‘does not scan’` returns exactly `:1175`, and `:1167-1168` carry a different, CORRECT sentence). Round 10’s A-M3 reordering of the inverted canonical-write scan is PROPAGATED verbatim into Task 9’s own bullet, which still carried the formulation the spec calls unsatisfiable (B-I1) — the brief is byte-extracted, so only an in-task fix reaches the implementer. And the §5 allow-list itself is re-enumerated BY MEASUREMENT from four entries to THIRTEEN (B-I2), because at least five further canonical mutations exist on a correct post-Task-9 tree and appeared on no entry, so the equality was red on the correct tree; the filter now covers the canonical CARD bindings as well as the SET, and six further primitives are named as EXCLUDED BY THE FILTER so no future round re-adds them to the list. **Minors.** The first held section’s fork list is split into what is SHIPPED (adding step 6’s `rm -f "$cardf"` at `:865`, measured `type -t rm` = `file`) and what Task 9 ADDS (step 5’s generation-read `link`/`rm`, step 6’s redundant-alias `rm`), with Task 9’s own instrumentation named as the authority and pin (b) strengthened from a `find` count to the exact fork MULTISET (A-M1/B-M2); both §3.1 source-order pins reach Task 9’s test list, which measured had neither (B-M8). The unmeasured “`ccd/ccd:1741`” hit is dropped (M2): measured, that line is a primitive beside a registry GLOB with no canonical literal, and the one line pairing a canonical literal with a primitive-shaped word is `ccd/session-hook.sh:1094`. The purge source-order pin gets ONE address everywhere — `ccd-lifecycle-purge.test.ts:37`/`:99`/`:115`, dropping the hedged `~111` (M4). The `ccd/ccd` File-structure row gains `_ws_slug_residue`, `cmd_ws_add`’s message template and the comment scope, all of which reached Task 9’s body in earlier rounds and never reached the plan’s own index (M5). The §2 diagram names `_spawn_start` beside row creation and `_reg_purge` (M6). §5’s acquire-probe mutation states the reason that actually holds inside its fixture (M7): measured with `command` shimmed, `command -v flock` answers 1 while a direct `flock -w 1` answers 0, so the mutant proceeds — the general “both spell their failure 1” argument is fact (iv) and belongs there, and a genuinely missing binary invoked as a command answers 127, a third value neither fact names. The `.served` scan is scoped to SET assertions with journal-record assertions allow-listed as their own class (B-M7), its class (1) is restated as SessionStart hook fixtures that PLANT a canonical set rather than “measure-input fixtures” (B-M6 — the isolated `measure` API lives in a file this scan does not cover), and the seven is re-derived as eleven raw minus two scope-excluded titles minus two allow-listed fixtures. The steering row’s rename ORDER becomes an explicit SOURCE-ORDER pin with a stated control (B-M9), since in Plan A nothing observable separates two adjacent renames inside one held lock. `_spawn_start`’s “ensures/reads” becomes “reads and validates — never mints” in both documents (B-M4), a wording precision fix only: the stronger reading, that it is a second spec-sanctioned minter, was REFUTED and is not adopted. The post-edit sweep claim “‘until completed’ now returns ZERO in both documents” is corrected to the measurement (M3/B-M1): zero in the spec only because the phrase wraps, five in this plan, and the counts are now asserted by the scan rather than stated by a round. **Two round-10 Importants were REFUTED with evidence and are NOT acted on:** §6’s extension of the generation gate to row creation and `_spawn_start` (closed by the same commit’s more precise, explicitly cited §3.4/§4 text, and by §5’s fixture carrying no such leg), and the inference that `_spawn_start` is a second generation minter. **Preserved unchanged:** the option-A architecture; the CAS with no unlocked canonical writer; the generation-gated flock rule and its four facts, with row creation and `_spawn_start` continuing as §3.4 and §4 state; the provenance wire contract; the engine rule; the corrected transition producers; the purge-done reconciliation (emit early, capture under lock, delete after); the `.served` seven-assertion disposition; the die-template fix; Task 11’s `##`-bounded extractor; exactly 16 keys, no persisted `n`, no `hookstate.compaction`, exact-one helper output, retained journal FD/CAS; `ccd/ccd` runtime owned solely by Task 9 with Task 11 documentation and audit only; Plan A ships no wire; and no retroactive rewriting of completed Task 5/6/7 sections. **Round 12 (the first round on the INTEGRATED branch: the D-2605 chain merged onto Task 8 head `188c1d8a`, so the shipped helper is Task 8 fix round 4) — 9 distinct Importants and 14 Minors, nothing refuted.** The headline correction REVERSES round 11's own disposition: §6's Waits bullet extended the generation gate to row creation and `_spawn_start`, which round 11 preserved on a round-10 refutation. A refutation is a claim, not a standing instruction, and two reviewers plus a refuter measured the sentence as a live contradiction of §3.4, §4, §10 and this plan; §6 now binds the gate to `_reg_purge` reached through `ws-rm`/`forget`/`ws-gc --prune` ALONE and states that row creation and `_spawn_start` are not gated on generation presence at any value, which is what finally makes §3.4's “§6 restates it” true (A-I1/B-I1). The restored `cited` row is NOT changed: on this tree `hasUniqueSuffixOccurrence` (`ccd/compact-card.mjs:692`, called at `:717`) implements it, and running the shipped module confirms the `/`-left-boundary case returns 1 — the row describes code that is now here (A-I2). Its TEST anchor did move: measured, `server/test/compact-card.test.ts:875-893` is the backtick-fence grammar test on this tree and the citation rules live at `:897-931`, so every anchor in that list below `:870` was re-measured (Task 8's fix rounds 3 and 4 inserted `:906-927` and `:929-931`). §3.1's SHIPPED fork list gains `at=$(_hook_epoch_ms)` (`ccd/session-hook.sh:871`) as a command substitution — measured one `clone` against a zero-clone control on the same harness — and `at` is NOT hoisted above the acquire, since the nonce embeds it (A-I4/B-I5); pin (b)'s multiset is restated PER SCENARIO because its conditional members cannot all appear in one run (B-M2), and the second held section's list is split so the stage-2-only `steered` `jq` is not built in Plan A (A-M7). The §4 card-text safety invariant the chain deleted with no relocation is RESTORED as both a §6 bullet and a §4 row, updated to name `_hook_emit_context`'s `jq -cn --arg c` envelope (`:94`), the two clips and the `--argjson` obligation on the `steered` stamp, with a source-scan mutation row and a Task 9 test (A-I5/B-I6). The dead-reg arm's “DECLINES unchanged” is corrected everywhere it appeared: measured, `_ws_gc_prune_row` (`ccd/ccd:11665-11670`) never reads `_reg_purge`'s status and follows it unconditionally with `_lc_done destroy` (`:11669`) and `_gc_reclaimed` (`:11670`), so “unchanged” is an instruction to emit a false success; the arm must branch and emit `_gc_declined` (`:11653`/`:11659`/`:11677`), `:11665-11670` joins Task 9's modify scope, and §5 leg (d2) now asserts the decline positively and the false success negatively (B-I2). The double-terminal guard is RE-KEYED from `tx` to the caller's own (act, id, tx): `_lc_done purge` has one call site (`:1828`) with a literal empty tx (`:1822-1823`) and `_lc_tx` never returns empty, so the tx-keyed fixture could never be built, while `:11813`/`:11816` and `:4913`/`:4858` do share the tuple — stated as a MUTATION pin, since measured, an `if`/`else` and `die`'s `exit 1` (`:1022`) keep each pair from double-firing today (B-I3). The canonical-write allow-list goes from thirteen to SIXTEEN with “canonical pathname” fixed to the four row artifacts and a literal-canonical resolution clause added, the three new entries being PostCompact's journal stage→`.compactions` rename, row creation's no-clobber `.generation` link mint, and the generation-read alias (B-I4). The aged-set §4 row is restated to the D-2605 model — claimed under the lock, canonical unlinked, provenance-ineligible, ALL SIX provenance fields null, `served` still from the nonce marker — measured with the section's own jq fence under jq 1.7 (accepted with `served` true and false; rejected with `transcript`, `cwd` or `liveAgents:0` carried), and “removed unread” is deleted (A-I3); two sibling no-set rows gain the same six-field null list (A-M8). Minors closed: the §3.1 authority sentence now cites Task 9 Step 1 item 2 instead of two references that resolve to nothing (A-M1/B-M3); a verbatim stutter in §5's inverted-scan row is deleted (A-M2); that row's `:1094` self-contradiction is narrowed to the `rm`/`mv -f`/`link` COMMAND (A-M3); round 11's own anchor correction had an off-by-one — the separate sentence begins mid-`:1177`, not at `:1178` — fixed in both documents (A-M4); “the six provenance fields land in the journal line only” is corrected to the set-then-journal contrast the set document at §3.1 item 6 and `:875-885` actually show (A-M5); §7's pointers to §5's deleted Hook/Helper/Installer groups and to R1 content §6 does not carry are repointed (A-M6/B-M1); `_lc_fail`'s quoted distinction is re-anchored from `ccd/ccd:2756` to `:2757-2758` (B-M5); the publication-order leg gains rename COUNTS beside the order, since step 13's two arms can produce two set-stage renames (B-M4); and §10 gains the residual for a compaction outliving `COMPACT_CARD_MAX_AGE`, whose journal line can be attributed to a successor's set because the overlap test is young-only (B-M6). **Declined as prescribed:** nothing — but two rulings were tightened by measurement rather than followed literally, each recorded above: A-I2's instruction to cite the helper beside the `:875-893` anchor assumed that anchor still named the citation test, and it does not on this tree; and B-I3's “which IS reachable” overstates the shipped code, where the double-terminal is control-flow-excluded, so the row is written as the mutation pin it can actually be rather than repeating the unreachable-red defect the finding raised. **Preserved unchanged:** the option-A architecture; the CAS with no unlocked canonical writer; the generation-gated flock rule now scoped to `_reg_purge` with `ws-add`/`ws-restore`/`ws-reap` keeping their shipped fail-closed gates; the provenance wire contract; the engine rule; the corrected transition producers; the purge-done reconciliation; the restored 16-key measurement table and its five verbatim Task 8 rows; the `.served` seven-assertion disposition; the die-template fix; Task 11's `##`-bounded extractor; exactly 16 keys, no persisted `n`, no `hookstate.compaction`, exact-one helper output, retained journal FD/CAS; `ccd/ccd` runtime owned solely by Task 9 with Task 11 documentation and audit only; Plan A ships no wire; and no retroactive rewriting of completed Task 5/6/7 sections. **Round 13 (2026-09-14) closes ten Important and fifteen Minor findings from the two round-12 reviews, within this same D-2605 number — no new allocation. Two round-12 Importants were REFUTED and are NOT acted on:** the injection scan's "three compaction arms" scope does contain `ccd/session-hook.sh:94`, because the document defines those arms by HOOK EVENT (`### 3.1 PreCompact arm`, `### 3.3 SessionStart(compact) arm`, `### 3.4 PostCompact arm`) and §3.3 names `:94` inside its own arm twice, at its fork enumeration and as its protocol step 4; and "its four callers branch on the result" is a TARGET, not a false shipped claim, since spec §5's mutation row and Task 9's own Step 1 item 5 already pin the behaviour red. The SECOND is nonetheless tightened as optional precision, because the asymmetry it measured is real: the three post-action callers (`cmd_ws_rm` `ccd/ccd:4896`, `_ws_reap_tail` `:11167`, `cmd_forget` `:15555`) now join Task 9's `ccd/ccd` modify list, and spec §3.4 and this plan's header say the status branch is a CODE CHANGE Task 9 builds in all four — measured, none of the four reads `_reg_purge`'s status today. **What changed.** Every `<file>:<n>[-<m>]` reference in both documents was RE-MEASURED on this tree; eight were stale, all in `ccd/compact-card.mjs`, all by exactly +8, because the merge onto Task 8 head brought fix round 4's `hasFullPathOccurrence`/`hasUniqueSuffixOccurrence` split (`:682`/`:692`) and round 12 re-measured only the TEST file across that same merge: `REQUIRED_CARD` `:779`→`:787`, the `k in o` loop `:793`→`:801`, the `const maxChars = Number(...)` idiom `:795`→`:803`, the nonempty-nonce check `:799`→`:807`, at spec `:729`/`:737`, the plan's `Modify: ccd/compact-card.mjs` bullet, plan `:2962`/`:2967` and one live citation inside this very entry. Task 9's citation audit is WIDENED from `ccd/session-hook.sh` to every tracked-file reference in either document (A-I1/B-I4). **The one-terminal-fact guard is re-keyed a second time and given the emitter it was missing (A-I4 + A-I5 + B-I3, all three symptoms of one defect).** It is now keyed on a `_lc_tx`-MINTED, NON-EMPTY tx (`ccd/ccd:2144-2156`, `printf '%s.%s.%s'` at `:2155`, never empty), and THREE emitters are stated once as falling outside it for the same literal-empty-tx reason: `_lc_refuse` (no tx positional at all, `:2766`; literal `""` at `:2783`; never returns, `die` at `:2784`), `_lc_done purge` (`:1828`, `:1822-1823`), and `cmd_ws_restore`'s `:6780`/`:6838`/`:6844` triple, which a `""`-admitting guard would red on the CORRECT shipped tree. Round 12's supporting count was wrong and is corrected by measurement: **twenty-one** literal-empty-tx lifecycle emits exist, not three, so the right objection to a tx key is that it buckets unrelated acts file-wide — its fixtures are nonsense pairs like `_lc_done create "$id" ""` (`:4491`) against `_lc_done purge "$id" ""` (`:1828`) — not that none exist (A-M5). And the dead-reg decline round 12 prescribed emitted ZERO terminal facts: measured, `:11665-11667` mints `$lctx` and emits `_lc_intent destroy` before `_reg_purge` at `:11668`, while `_gc_declined` (`ccd/ccd:11308`) is a printf report row, not a lifecycle emit. So **Task 9 ADDS a non-fatal, tx-bearing `_lc_refuse_return <act> <id> <tx> <token> <detail> [k v]…`** beside `_lc_fail`/`_lc_refuse` (`ccd/ccd:2756-2785`) that emits the `refused` fact and RETURNS; the dead-reg arm emits it beside `_gc_declined`, every minted tx closes with exactly one terminal fact, no intent is orphaned, and the sweep continues to the next row — documented in §3.4, §4's dead-reg and mechanism-absent rows, §5 (the unproducible decline row replaced by one asserting exactly one `refused` for the minted tx and no `done`/`fail`), §6, and this plan's interface item 9 and Step 1 item 5. `server/test/ccd-reg-set-atomic.test.ts:126-127` joins Task 9's test scope with the disposition "retarget to the `<id>.`-prefixed basenames", since the widened `_ws_slug_residue` turns its `['uuid','workspace','wrapper']` into `demo-quiet-basin.*`; `ccd-workspaces.test.ts:151` and `:204` survive, measured, because they key only on empty/non-empty (B-I2). `_spawn_start`'s and row creation's lock-MISS outcomes are named for the first time: `_spawn_start` fails OPEN on a contended miss — spawns with no `CCRC_SESSION_GENERATION`, warns on stderr naming the lock, and that session's compaction lifecycle is inert until its next respawn, because a swap must never wedge on a compaction lock and a session with no generation cannot hold it anyway — while row creation acquires before writing any row field and fails CLOSED, leaving nothing; §2's `COMPACT_LOCK_WAIT` blanket no longer asserts a durable-artifact loss for either (B-I5). §10's aged-set residual regains the SERVE half the chain deleted: on the same premise A's SessionStart(compact) can serve B's card and record `served:true` under B's transcript, and of the two listed closures only `overlap:true`-on-overwrite bears on it — the carried nonce is a settlement check and SessionStart runs first (B-I6). `server/test/session-hook.test.ts:3115-3202`, the landed compact-SessionStart cost-ratio pin (`R < 4` at `:3201`, shipped band 2.926–3.375, estimator corrected under D-2549), joins Task 9's disposition list with an instruction to RE-TAKE the interleaved median/median measurement on the post-Task-9 arm and re-argue R from that sample, never to raise the bound to make Step 4 green (B-I7). **Fifteen Minors closed:** §5's invented `"files: []` is a known empty set"` row name becomes the behaviour it actually pins at `compact-card.test.ts:969` (`grep -c 'known empty'` = 0 in the table), with row names and paraphrases no longer mixed under one set of quotes (A-M1); the `:923` gloss is un-inverted — a PATH right boundary refuses, a non-path one credits (A-M2); §6's and §4's unsatisfiable "never … a shell word" becomes "never interpolated into a `jq` program's text, and never an unquoted expansion in a command word", a quoted expansion into `mv`/`rm`/`link` being the compliant form the shipped tree already uses (A-M3); §6's injection bullet marks the `steered` stage rewrite as stage-2-only, which Plan A never builds (A-M4); §7 stops re-describing §5's referent and §5 names this plan's eight per-task Mutation-checks STEPS (measured: numbered lists, not tables; `grep -c 'expected red'` = 0) (A-M6); §3.0 gains the originally-aged claim as a FOURTH normalisation trigger, which is the mechanism §4's aged-set row and §3.4's "nonce-only/no-provenance" both depend on (A-M7); §2's `COMPACT_CARD_MAX_AGE` row, this plan's constants block and Task 9's comment scope (`ccd/session-hook.sh:1115-1119`) split the window by artifact — aged CARD removed unread, aged canonical SET claimed and measured — and D-2388's set half is marked superseded (A-M8); the per-scenario multiset's unconditional subset is "every PUBLISHING run", since `_hook_write_atomic`'s printf-failure arm (`:781`) never reaches the `mv -f` at `:782` (A-M9); Global Constraints' "Only … take the permanent lock" is scoped to the hook's arms and names ccd's three (B-M1); `server/test/ccd-authdead.test.ts:68-72` joins Task 9's comment scope as the third copy of the dot-skip sentence the widening falsifies (B-M2); §5's "every mutating line" enumeration is marked a SAMPLE and the measured remainder given, with `:865`/`:923` noted as allow-list entries for a different reason (B-M3); the exclusion list gains the permanent lock's init `mktemp`/`link`/`rm` and every acquisition's lock-open-alias `link`/`rm` (B-M4); §4's card-text row reads the two clips as §6 does — three acts on three subjects, not two alternatives (B-M5); and §3.3's ordering sentence is narrowed to card/set/claim/marker pathnames, the lock family being the acquire's own (B-M6). **FREEZE PROVENANCE, recorded as a measured fact rather than "fixed".** This plan's Task 8 section hashes `303588a932c7c08f3573f4138fa2a7982906db0f471ae36fe494b827bb33804d` at main (`188c1d8a`) and at this chain's base (`674bacf8`), while the chain's frozen `a84c441a4de821e61ff14ddbdc37a35c486ab7da68b5d36c4076ab28b2738d1d` differs by EXACTLY one length-neutral three-line docstring inside Task 8's fenced `measureCommand` code — "the hook merges into hookstate (after adding `n`) and appends to the journal" became "the helper measurement object Task 9 enriches into the sole journal record … No ordinal is persisted" — made by an early chain round and consistent with D-2605's own removal of the hookstate cache and the persisted ordinal. The freeze has protected the chain's version since round 4 and the merge carried it; both are 11,680 bytes. The section is NOT touched. What follows from it is a scope item, not an edit: measured on this tree the SHIPPED `ccd/compact-card.mjs:726-728` still carries the old sentence and is the file's only `hookstate` occurrence, so Task 9's `ccd/compact-card.mjs` scope now names restating it to match. **Declined as prescribed:** one, recorded rather than silently followed — the ruling gave `_lc_refuse`'s neighbourhood as `ccd/ccd:2754-2790`, which begins inside `_lc_done`'s body and ends inside `_lc_surface_norm`'s docstring, naming neither boundary of anything; re-measured to `:2756-2785`, `_lc_fail`'s definition line through the brace closing `_lc_refuse`, because the same round's A-I1 ruling makes every range citation self-checking and an arbitrary range would red the audit it widens. **Round 14 — the last documentation round before Task 9 is implemented — closed twelve Important and eleven Minor findings.** The Importants: `COMPACT_LOCK_WAIT` was given TWO byte-equal literal homes on the shipped `_hook_epoch_ms`/`_plat_epoch_ms` precedent (`ccd/ccd:203`, `ccd/session-hook.sh:31`), because `ccd/ccd` sources nothing that could carry a hook-defined value, with a `single-definition`-style equality pin over `bashRoots` (B-I6); `forget`'s recovery was narrowed to "only while a tmux server answers" and the `ws-gc --prune` substitute was TRACED and refuted — its scan walks `"$REG"/*.workspace` (`ccd/ccd:11464`) while `forget` refuses any row carrying a `workspace` field (`:15526-15528`), the disjointness `ccd/ccd:15479-15482` already states in shipped prose — leaving "bring a tmux server up, then re-run" as the named remedy (B-I5); the citation audit was restated SATISFIABLY, its universal form having been refuted by `ccd/session-hook.sh:843`, a blank line cited as one (A-4); §5's invented Task 1–8 table home and its verbatim-row-name audit clause were deleted and replaced with direct, measured pointers to the plan's `Step N: Mutation checks` items under Tasks 2–8 (A-1 = B-I4, B-M1), and four Task 9 rows were added for the subjects §8 records as D-2605's headline rejections (A-2); the injection row's `steered`-stamp leg was marked STAGE 2 / PLAN C ONLY in both documents (A-3 = B-I7); the two-shipped-comments count became three (A-6); the `ccd ws-add --slug` fixture became positional, `--slug` being a flag `cmd_ws_add` does not have (B-I1); `server/test/ccd-workspaces.test.ts:182`'s brace-template assertion got a disposition and the `rm`-budget bound a re-derivation method (B-I2); and `server/test/ccd-reg-set-atomic.test.ts` reached Steps 2, 4, 5 and the File-structure table (B-I3). The Minors: the soft emitter was RENAMED `_lc_refuse_return` so its distinguishing property is in the name (B-M5); the generation gate's "proves" was weakened to what it supports, with the two named inert-hook paths recorded (A-8 = B-M2); the aged/`overlap:true` precedence was fixed at `scope: null` with the measurement showing both spellings pass the predicate (A-9); the run-list exclusion was given a stated basis (B-M6); and A-7's dangling enumeration, A-10's non-uniform shift, A-11 = B-M4's dangling `(§4)` pointer and B-M3's lost clause were each closed. **REFUTED and not acted on as a finding:** A-5, the Global Constraints "silent / total" sentence, which the same commit's ccd dispositions already close elsewhere — the sentence was scoped to the hook arms as precision only. **Declined as prescribed, two, recorded rather than silently followed.** One: the ruling gave the null-vs-0 plan item as `plan:2702`; measured, `:2702` is item 2 (the `<analysis>` `g`-flag mutation) and the null-vs-0 item is item 4 at `:2704` — the measured anchor was written. Two: B-M6's premise of "three landed suites" that read `ccd/ccd`'s text is measurably wrong — `grep -lE 'readFileSync\(CCD' server/test/*.test.ts` returns **37**, and `server/test/single-definition.test.ts` reads it through its `bashRoots` walk without a `CCD` constant, for 38 — so the three named suites were added on a stated per-suite test (can this task's additions reach that scan?) rather than on a "reads the file" rule that would pull in 38. **Round 15 (2026-09-15, fix round 4 — the first round on the IMPLEMENTED Task 9, and minor-only: both r4 reviewers APPROVED at 0 Critical / 0 Important) closes A-M1, both halves of A-M2 and A-M3 within this same D-2605 number — no new allocation.** A-M1: compact SessionStart's identity refusal at the card claim now removes the no-clobber session-claim placeholder it had just created, which `_ws_private_family`'s `compactcard.*` arm otherwise read as residue and `_ws_slug_free` as a slug NOT FREE. A-M2(1): the aged-card removal's proof moved from ABOVE the age `find` to between that fork and the `rm`, the measure-then-prove-then-remove form PreCompact already uses. A-M2(2): the two pairs that shared one proof across a fork — the card-stage and set-stage renames, and PostCompact's canonical unlink and claim touch — each gained its own re-check, MEASURED rather than argued: the refusal between the renames leaves the card published beside step 7's own set and the serve arm serves that pair, and the refusal between the unlink and the touch leaves canonical absent with the claim RETAINED, which is the terminal state the failed-`touch` restore already leaves and which a later PostCompact answers through its absent-set branch — so both intermediate states are tolerated, both re-checks were built, and NO deviation was allocated for a residual window. The item-3 source scan's MUTATIONS list is split one entry per mutation, so the grouping is no longer carried in a test label. A-M3: the four `_reg_purge` status-1 callers now tell `canonical-vanished` from contention, the distinction `COMPACT_LOCK_WHY` already carried and only `cmd_ws_add` and `cmd_start` read. **Reviewer B's M52, RECORDED ONLY (2026-09-15):** §5 `:2107`'s SECOND alternative mutant — make the marker source's grammar overlap the final marker — changes no observable property on this implementation, because PostCompact's marker lookup is an EXACT pathname test that no `mktemp`-generated six-character suffix can satisfy and the renamed source is still swept by the `compactserved.*` family arm; the row's FIRST alternative is the effective one, is built, and is RED, so the row is satisfied and no spec edit and no deviation follow. **Also recorded, and not a finding:** `server/test/boot.test.ts:166`'s 3 s listen bound (r4 B-M1) is an undocumented load flake owned by boot, not by Task 9 — `boot.test.ts` is untouched by this range — so it was deliberately NOT touched here and no CLAUDE.md was edited. The citation census moved `ccd/ccd` 131 -> 132 and the headline 201 -> 202, measured by running the audit unchanged against a `git archive` of this round's base and of its tip and diffing: exactly one new failure, `ccd/ccd:6838`, shifted off a referent it had only coincidentally regained in round 3, rejoining the two siblings of its own citation triple that were already stale at both ends. **APPENDED 2026-09-15 (fix round 5, the light re-gate's four Minors):** two of them were round 4's own CONTROLS, named but never asserted. `ccd-ws-reap.test.ts`'s contention leg asserted only "still stand", a clause BOTH status-1 sentences carry, and `ccd-lifecycle-purge.test.ts` had no ws-gc control at all — `(d1b)`'s loop filters `ws-gc --prune` OUT, and the DEAD-REG arm read the token and the row and never the detail. MEASURED in throwaway copies: making each caller's canonical-vanished override fire unconditionally left `ccd-ws-reap` GREEN 88/88 and `ccd-lifecycle-purge` GREEN 50/50, so an ORDINARILY contended reap or gc decline could journal "restore the lock by hand" for a lock that is merely held. Both legs now assert the contention clause and the ABSENCE of the other token, and the same mutants are RED. **AND "STATUS 1 IS TWO CONDITIONS" WAS ITSELF THE OVERSTATEMENT** that let the conflation hide: `_compact_lock_acquire` returns 1 from TWELVE places, measured, and only the `flock -w` timeout is ordinary contention. Two more reached every durable caller with `COMPACT_LOCK_WHY` EMPTY and therefore with the contention remedy, which is false in both — the lock pathname occupied by a symlink, directory or FIFO, which nothing in this tree removes, and `mktemp` failing AT RUNTIME at the mint on a box whose `command -v mktemp` had already succeeded, so status 2 was never reachable. Both now carry their own token (`lock-path-occupied`, `lock-source-refused`) and each of the four durable callers keys a `case` on the VALUE so every cause carries its own true remedy, with an UNRECOGNISED token taking a catch-all rather than the contention sentence. The token set is DERIVED from the acquire by a source scan that requires every caller to key every token, so a fifth condition cannot silently inherit "wait and re-run". `lock-source-refused` rather than the obvious `mktemp-failed`: the literal word reds `macos-platform.test.ts`'s GNU-shim scan with five "bare mktemp" hits, and the token was renamed rather than the scan widened. TWO CALLERS BEYOND THE RULED FOUR were repaired in the same commit because they would otherwise have started lying: `cmd_ws_add`'s and `cmd_start`'s `die` clauses spelled the canonical-vanished cause out as though the token could only ever be that one; they are transient stderr, so they now name the token and stop. The runtime-mktemp fixture is a bash FUNCTION shim, not a PATH stub — `command -v mktemp` finds a function and answers 0 (asserted in the fixture), which is what makes it the runtime condition and not mechanism absence, and the brief's expectation that no stub could reach this state is corrected here. **The item-3 split also left three canonical mutations unlisted and unproved,** each on the far side of a fork: PostCompact's failed-`touch` restore and SessionStart's crossed-nonce and body-less card restores. The file already disagreed with itself — the comment above the first calls it a canonical mutation — and the concrete cost was measured: without a re-check, a stranger that replaces the lock inside `touch`'s fork has this process republish canonical with no row mutex and then discard the claim holding the only verified copy. All three now take a proof; on a failed proof there is NO restore and NO removal and the claim is RETAINED, which is the terminal state the first arm already reached whenever its no-clobber `link` collided. The body-less entry deliberately takes NO `branchOf`: that inheritance LOWERS a floor and the scan's `between` does not exclude guards inside the sibling's arm, so it would let the crossed-nonce proof — which returns before this path is reached — satisfy this entry. NO deviation was allocated in this round: every ruling was built rather than exempted. The citation census is UNCHANGED at 202 across all four commits, re-measured after each. **APPENDED 2026-09-15 (fix round 6, the light re-gate's three Minors):** R5-M1 — the post-`link` re-test in `_compact_lock_acquire` (the same occupied pathname the mint-time test names one instant later) returned bare `1` with `COMPACT_LOCK_WHY` left EMPTY, so all four durable callers took the empty-WHY arm and journaled the contention sentence for a pathname nothing in this tree will ever unoccupy — false twice over, exactly as the acquire's own comment already conceded. It now sets `COMPACT_LOCK_WHY=lock-path-occupied` there too, reusing the existing token and the existing caller arms rather than minting a fourth; a new `(d1d)` leg drives the race with a `mktemp` function shim that lets the mint succeed and then plants the directory the mint-time test already passed, over all four durable callers — MEASURED before (`RC=1 WHY=` empty, reproducing the reviewer's own probe) and after (`RC=1 WHY=lock-path-occupied`); deleting the new assignment reds both that leg and `(d1e)` again. R5-M2 — the `lock-source-refused` remedy asserted a cause the guard cannot detect ("it is $REG itself that refused the write … A re-run cannot help until that is repaired") on ANY non-zero from the mint's command substitution, which is equally a failed fork or fd exhaustion — the round's OWN `MKTEMP_FAIL` fixture (a healthy, writable `$REG`) is the counterexample. The sentence now reports the measurement and offers the cause as the usual one, never the only one, and never claims a re-run cannot help "until" a repair, only "while" whatever failed still holds; re-absolutising it reds the runtime-mktemp leg's new assertions, with every other leg GREEN. R5-M3 — `_ws_reap_tail`'s two tokened arms had no behaviour pin: `LEGS` (`ccd-lifecycle-purge.test.ts`) held only `ws-rm`, `forget` and `ws-gc --prune`, and rewriting the ws-reap caller's `lock-path-occupied` arm to the contention sentence left the whole file GREEN. `_compact_lock_why_remedy <id> <verb>` is now the ONE renderer all four durable callers consult — collapsing four copies into one, so a single caller's text drifting from the others is impossible rather than merely unpinned, with every token-specific sentence byte-identical to what shipped before except `lock-source-refused`'s R5-M2 reword — and `ws-reap` gets a `LEGS` entry that drives `_ws_reap_tail` directly at its `clips` resume phase, a level under `cmd_ws_reap`'s own outer flock gate (which is why `(d1)`'s NOFLOCK sub-legs keep excluding it; `ccd-ws-reap.test.ts` already pins that story through the real verb). MEASURED in a throwaway copy: mutating the helper's `lock-path-occupied` arm to the contention sentence reds every caller the loop reaches; dropping the ws-reap caller's own helper call reds its `(d1c)`, both `(d1d)` and `(d1e)` legs while every contention leg — including `ccd-ws-reap.test.ts`'s own — stays GREEN. NO deviation was allocated in this round: every ruling was built rather than exempted. `ccd-lifecycle-purge` 54/54, `ccd-ws-reap` 88/88, `session-hook` 295/295, `dtbd` + `deviation-refs` green after `git fetch origin main`; the citation census (loose `X:NNN`, measured independently at 206 — the count this round could reproduce and verify, unlike the round-16 entry's un-sourced 202) is unchanged across `ccd/ccd` + `session-hook.sh`, before and after this round's edits. **CORRECTION (2026-09-15, r7 R6-M2):** the parenthetical immediately above is wrong about 202, which is neither un-sourced nor a competing estimate of the same quantity — the two numbers measure different things and neither corrects the other. The loose `X:NNN` token count over `ccd/ccd` + `ccd/session-hook.sh` is the 206. The other is the STALE-CITATION census that gates the build: a per-file map asserted exactly, with its sum asserted beside it, pinned at `server/test/session-hook.test.ts:7043-7056`. It stood at 202 when the round-17 sentence called it un-sourced, and this round re-measured it to 201 (`ccd/ccd` 132 to 131 — four anchors repaired and one newly stale, all five of them line shifts under anchors already stale at this round's base, measured by diffing the audit's own failure sets across a `git archive` of base and of tip). Only the round-17 claim about the census is retracted here; nothing else in that entry is. **APPENDED 2026-09-16 (Task 11 fix round 1):** the `_lc_tx` anchors in the sentence above are PRE-Task-9 and stay written as they were — a ledger entry is corrected by a dated append, never in place, and an earlier commit of this round wrongly edited them here before reverting. MEASURED at this tip: `_lc_tx()` opens at `ccd/ccd:2733` and its closing brace is `:2745`, byte-identical to `8e457995`'s `:2144` and `:2156`, and the `printf '%s.%s.%s'` is `:2744`, byte-identical to that commit's `:2155`. §5's two-terminal-facts row and §3.4 of the spec carry those tip numbers; this entry keeps the numbers it was written with.

Task 7's fix round (2026-09-11, one review — 0 Critical, 4 Important, 3 Minor, one Minor elevated by the coordinator) found the following; D-2547–D-2552 were allocated together before these definitions were written:
 **APPENDED 2026-09-14 (r3 B-M5): one NEW load flake this task created, recorded here because CLAUDE.md is not ours to edit (operator ruling 2026-09-02).** `server/test/ccd-workspaces.test.ts`'s `holds at EVERY interruption point of _reg_purge` now runs 28 `sh()` invocations — a measuring pass plus `measureRmCalls() + 3` — each taking the row's stable lock inside `_reg_purge`, against 24 cheaper ones before. MEASURED by the r3 gate: 12,996 ms inside an 11-file run, and a 20 s TIMEOUT inside the 70-file chunk 01 at `--maxWorkers=2`, while the controller's and the implementer's own chunk-01 runs were green and every isolated re-run passes. It is a LOAD flake, `ccd-ws-gc`'s neighbour, and it is not on CLAUDE.md's documented list — so re-run it in isolation before calling a red real. Mitigated in the tree by an explicit `60_000` timeout matching the other D-2605 fixtures and by a mechanical `expect(verdicts.length).toBe(LAST + 1)`, so a protocol step that adds `rm` calls reports itself as a changed count rather than as an unexplained timeout. The controller reports the stale CLAUDE.md flake list to the operator.
- **D-2547 (I1) — the compact clip was duplicated IN SERIES, so neither site alone was pinnable.** `_hook_emit_context`'s `${2:0:$COMPACT_CARD_MAX_CHARS}` and `_hook_compact_card`'s own `body="${body:0:$COMPACT_CARD_MAX_CHARS}"` were each a complete substitute for the other — Step 7 mutation #3 (delete both) stayed GREEN on `a pathological card` as originally written. Measured: the bounded `read -N COMPACT_CARD_MAX_CHARS+64` is the real cost guard (114 ms vs 17,370 ms for a `cat` fork on a 100 MB card, 152x) and is NOT the clip. Fix: delete `_hook_compact_card`'s duplicate slice, keep its bounded read; the emitter's clip is now the ONLY clip on the compact subject. Verified: output byte-identical on every existing test; deleting the emitter's slice alone now reddens `a pathological card` (4057 not ≤4001, measured). Step 7 mutation #3 corrected in the same commit.
- **D-2548 (I2) — a spec §5 mutation-table row promised a runtime red that is mathematically unreachable, and a second row named no owning task.** `total clip raised` (envelope > `CARD_TOTAL_MAX_CHARS`) can never fire as a runtime effect: max(text) = 2400+1+4000 = 6401 = the constant exactly, so only a coordinated three-site mutation (text and both source ceilings) could ever exceed it, and defence in depth is the intended design (spec §3.3 step 4). Separately, `ceilings drift` (`HARNESS_CONTEXT_SPILL_CHARS`, spec §2 constants table) named no owning task in any file or task in this plan — confirmed by scanning every task and this file before this fix. Fix: `total clip raised` is restated in the spec as a source-level pin on the DERIVATION (the hook must spell `CARD_TOTAL_MAX_CHARS=$(( CARD_MAX_CHARS + 1 + COMPACT_CARD_MAX_CHARS ))` literally, pinned by a new Task 7 test reading the hook's own source); `ceilings drift` is now Task 7's, pinned by a new test that reads both ceilings from the hook's own source (`CARD_MAX_CHARS + COMPACT_CARD_MAX_CHARS < HARNESS_CONTEXT_SPILL_CHARS`, so raising either one reddens it independent of the first pin).
- **D-2549 (I3) — the compact arm's own ratio test used p95 of n=20, a noisy estimator on a loaded box, and mis-diagnosed a symptom as a defect.** p95 of 20 samples is `s[18]`, the second-largest value, owned by one outlier — iteration 0 measured a cold-start outlier (258 ms vs ~90 ms typical). On `openclaw` (16 cores, load average ~34 during measurement) the resulting RATIO was noisy enough that a two-jq-fork mutation's signal was indistinguishable from noise, read at Task 7 landing as "this row has no power here." Re-measured with a warm-up pass added and the estimator switched to median: 15 isolated shipped runs gave a spread of 14.5% of the mean (was 58.2% under p95); 0/15 crossed R=4. A larger probe (ten no-op `jq -n 'empty'` forks, five times the original two-fork mutation) gave 10/10 runs crossing R=4, cleanly separated from the shipped band — the row has real power for a regression an order of magnitude bigger than the one first proposed to calibrate it; the two-fork signal remains below this row's noise floor under every estimator, unchanged by this fix. Fix: median replaces p95 in this row only; D-1898's sibling row (~line 548) is deliberately NOT touched — measured and argued on its own, quieter sample, and generalizing an estimator fix across samples without measuring the second one is the error this repo already has a memory about.
- **D-2550 (I4) — Step 7's historical served-set mutation #8b was confounded and did not measure what it claimed (the mechanism is superseded by D-2605).** The original recipe broke the emitter's jq entirely (`'garbage'`) while ALSO moving the `served` call before the emit attempt; breaking jq stops every one of the four subjects printing, so the test's `card()` helper throws on its own "the hook printed nothing" check before the `served` assertion is ever reached — the assertion that actually reddens is `card`'s, not `served`'s. The underlying mechanism (`_hook_emit_context` returning 1 so the arm never stamps `served` for a card that did not print) is real, confirmed by a standalone probe (shipped: `served:false`, empty stdout; `return 1`→`return 0`: `served:true`, empty stdout). Fix: a new test builds a jq shim that fails ONLY the SessionStart-envelope program (matched by text: `hookSpecificOutput` + `SessionStart`) and execs the real jq for every other call this file makes, read via `runFull` directly rather than `card()` so the confound cannot recur. Verified: `return 1`→`return 0` reddens exactly and only the `served` assertion; `stdout` stays empty under both. Step 7 mutation #8b's record corrected in the same commit.
- **D-2551 (M1) — consume-once was not atomic: a bare read-then-`rm` let N concurrent SessionStart(compact) racers serve the same card.** The main thread and its own live subagents can all reach SessionStart(compact) close together; every racer could read the card's content before the first one deleted it. Measured against the pre-fix code, 8 real concurrent hook processes (`spawn`, not `spawnSync` — a loop of blocking calls can never overlap and would never race) against one planted card: 2 of 3 trials served it to more than one racer, contradicting spec §3.3 step 3 ("a card is never served to two contexts"). Fix: an atomic `mv` claim (`_hook_compact_card` moves the canonical card to a dot-prefixed, pid-scoped, `compact`-tagged claim before inspecting it) — exactly one racer's `mv` can win the pathname; a losing `mv` (ENOENT) serves nothing. The claim is provisional: a crossed pair or a body-less nonce restores the card via the same no-clobber `link` idiom `_hook_compact_rollback_card` (Task 6, D-2460) already uses, preserving "the card stays" for those two cases. Verified: 5/5 isolated runs of the new concurrency regression pass deterministically after the fix (exactly one served, every time); the same test reproduces the race against the pre-fix code.
- **D-2552 (M3) — four more `_hook_compact_card` guards were unaudited: one a provable no-op, two real but untested, one real but unpinnable.** `[ -n "$body" ]` was provably redundant (an empty `CARD_COMPACT` is already the function's initial value; assigning it again changes nothing) — deleted, matching D-2417's precedent for a guard nothing can redden. `[[ "$body" != "$raw" ]]` (a nonce with no text after it) and `command -v find` (the age check's dependency) are both REAL: deleting the first serves the nonce itself as the card body (verified red: `restored, not consumed` fails); deleting the second silently deletes every card on a box without `find` (verified red: the age check's `|| { rm -f "$f"; ...}` fires unconditionally). Both are now pinned by dedicated tests. `[[ -f "$set" && -r "$set" ]]` was measured unreddenable on this box (a missing/unreadable `$set` makes the subsequent `read < "$set"` fail its redirection silently, `head` stays `""`, the nonce regex fails, same outcome either way — confirmed no stderr leak either) but is KEPT as an argued early return: this file declares two userlands (header, line 1), and whether a failed stdin redirection stays silent is shell-and-platform behaviour this box's bash cannot prove for every `sh`/`bash` a fleet box might run. Recorded in a source comment rather than removed, unlike the first three.

Task 8's initial implementation review (2026-09-11, 0 Critical / 0 Important / 4 Minor, all four elevated by the coordinator because each corrupts or blinds the journal corpus itself) found the following. Only one of those four elevated Minors is a spec-conformance departure; D-2553 was allocated alone (count 1) for it and is defined here in the same commit as its fix. This describes the earlier review, not the later scoped fix-round review: that review is not approved and found 3 Important implementation findings.

- **D-2553 (Minor 2) — `filesSectionChars`'s heading scan is fence-unaware, biasing `filesChars` — a PRIMARY metric this plan exists to collect (Plan C's revisit clause is keyed on it not moving) — on exactly the corpus it studies.** A numbered-looking line inside a fenced code block (the corpus routinely quotes fenced numbered lists, including rendered file listings, inside the Files section itself) was matched by the same heading regex as a real section heading, so it was mistaken for the NEXT section and truncated the span early — reproduced independently (own fixtures, own numbers: 41 measured where the true span is 74, and a Files section quoting its own fenced numbered list truncated the same way) rather than copied from the review's figures. This is literally spec-conformant behaviour (the spec said nothing about fences), so it needed a spec amendment, not a silent fix: §3.4's `filesChars` row now says a numbered-looking line inside a fenced region is skipped — never a section start, never the terminating heading. Fix: `filesSectionChars` now line-scans JS string/code-unit offsets for Markdown fences: an opening run of at least three backticks begins at line start with up to three spaces; a closing line is otherwise whitespace and at least as wide as its opener; an unmatched opener covers EOF. It skips heading-regex matches inside those ranges in both directions (as a candidate start AND as a terminator). The later scoped fix round strengthened this implementation for variable widths and inline backtick strings; D-2553 remains the governing deviation. Verified: the existing suite's own fenced-fixture case (`measureCommand`'s test text, which nests two ordinary fences with no numbered-looking content inside them) is unaffected — its expected `filesChars` value is unchanged, because nothing inside those particular fences happens to look like a heading; the new regression fixtures red before the fix and green after.

The other three Minors this round fixed are conformance/test-quality corrections with NO deviation number, per the coordinator's own scoping (Minor 3 is "just fix it and pin it"; Minor 1 and 4a are hardening/test-strengthening against defects the spec never licensed):

- **Minor 1 — `readSetForMeasure`'s docstring claimed a guarantee ("a bad set must never cost the whole measurement") that only held for the top-level parse, not for an individual malformed `files[]` entry.** Measured through the real CLI (own reproduction): `files:[null]` and `files:[{"path":5}]` each threw (TypeError on `.path` of null, then `p.split is not a function`), losing the whole measurement (exit 1); `files:[{}]` against a summary containing the literal word "undefined" did not throw but silently scored a phantom citation (`cited:1, setSize:1`) because `String.prototype.includes` coerces `undefined` to the string `"undefined"`. Unreachable through today's writers (the hook never emits such a `files[]` entry), but a false docstring is still a defect this repo treats as one. The initial fix filtered malformed entries, but the later scoped fix round correctly found that this collapsed a corrupt list into a valid smaller denominator. Fix: `measureCommand` now makes `cited` and `setSize` null when ANY `files[]` entry lacks a non-empty string path; it still records all non-set-derived fields and keeps valid `files: []` at `0`/`0`. `readSetForMeasure` describes only its top-level-shape guarantee. Unit and CLI regressions cover malformed-only, mixed malformed/valid, phantom-citation, and valid-empty shapes.
- **Minor 3 — `citedCount`'s FULL-PATH branch (`text.includes(p)`) had no left-boundary check, so a shorter set member's full path could be credited merely for being a raw substring of a LONGER member's own cited full path** (`['a/b/c.ts','x/a/b/c.ts']`, summary naming only `x/a/b/c.ts`, scored 2). §3.4 requires citation to be path-segment-aligned; this half violated it. The initial fix added a left-boundary check. The later scoped fix round found the reciprocal gap: a full path can be a prefix of a longer token, and a unique multi-segment suffix can start inside one (`a/b/c.ts` in `a/b/c.tsx`; `a/b/c.ts` in `nota/b/c.ts`). Fix: full paths require absent or non-path characters on BOTH sides; a unique suffix keeps that strict right boundary but its left boundary is segment alignment — start of text, a non-path character, or `/`. The paths therefore use distinct helpers: `pwa/src/watch.ts` credits the unique `src/watch.ts` suffix, while a full `a/b/c.ts` cannot double-credit inside `x/a/b/c.ts`.
- **Minor 4a — `at` was pinned only by `Number.isInteger`, so replacing `Date.now()` with the constant `0` (or a frozen clock) stayed green while destroying the journal's whole time axis.** The reviewer separately ruled `Date.now()` itself CORRECT (three independent §3.4 reasons; the coordinator's dispatch instruction to change it was wrong) — so this is a test-only fix. The existing `measureCommand` test now captures `t0`/`t1` around the call and asserts `t0 <= m.at <= t1`; reproduced the blind spot first (mutated `at: Date.now()` to `at: 0` against the OLD test — stayed green) and the fix second (same mutation against the NEW assertions — reds on `expected 0 to be greater than or equal to <t0>`).
- **Fix round 3 (0 Critical / 2 Important, no new deviation) — citation and fence fidelity.** The approved unique multi-segment suffix rule is restored without weakening full paths: a suffix's left boundary is start, non-path, or `/`, its right boundary stays end/non-path, and full paths alone require non-path boundaries on both sides. Separate helper predicates prevent a generic left-boundary implementation from silently equating them; regressions credit `src/watch.ts` in `pwa/src/watch.ts`, reject `src/watch.tsx` and `nota/b/c.ts`, and prevent `a/b/c.ts` from double-crediting inside `x/a/b/c.ts`. The D-2553 scanner tests now mutation-pin the complete Markdown backtick grammar: four leading spaces are not an opener, two backticks are not a fence, opener info strings are allowed, and a closer permits whitespace only. The named `{0,3}->{0,4}`, `{3,}->{2,}`, and relaxed-close mutations each red `filesChars` and/or `fences`. Helper comments now accurately state PATH_CHAR's separate full/suffix roles and that malformed `files[]` entries make set-derived values all-or-unknown; helper-set `served` persistence is deliberately outside Task 8 (D-2605).
- **Fix round 4 (approved-review Minor elevated for a real corpus regression, no new deviation) — full paths cannot fall through to suffix matching.** A two-segment full path has no proper two-or-more-segment suffix, so `citedCount('see x/a/b.ts', ['a/b.ts'])` remains `0`; allowing the suffix loop to reach `k === segs.length` reinterprets that full path under suffix-only slash-left semantics and incorrectly returns `1`. The dedicated regression turns red under the single `k < segs.length` to `k <= segs.length` mutation. No production behavior changed.

Task 9's fix round 1 (2026-09-14, two independent Opus reviews of the runtime and its mutants — A: 1 Critical / 4 Important / 9 Minor, B: 1 Critical / 6 Important / 6 Minor, one refuted) minted **D-2756–D-2763** through `~/.local/bin/ccrc-api ledger allocate` (project `ccrc-pwa`, count 8; the read side showed floor 2756 and the POST issued the block 2756–2763, floor then 2764), each defined here in the same act.

- **D-2756 — §3.1 item 5's redundant-canonical-alias unlink is WITHDRAWN from the spec, not built in the runtime.** The step required PreCompact, under its first held lock, to scan this id's exact claims and unlink canonical when it and a claim were one inode under `-ef`. It was shipped as allow-list entry (2) at count 0 so that building it would red. MEASURED against the shipped arm, it changes nothing it could change: its only reachable premise is a PostCompact SIGKILLed between `link "$set" "$claim"` and `rm -f "$set"`, and in that state (a) the overlap `find` already matches `.<id>.compactpost.*.claim` inside the window, so the verdict is `ambiguous` with or without the unlink, and (b) `_hook_write_atomic "$set" …` runs on EVERY non-inert path INCLUDING the ambiguous one — the ambiguous return sits after the publication — and its `mv -f` replaces the directory entry, which IS the "unlink the redundant canonical alias" effect. Spec §3.1 item 5 now says so; §5's entry (2) is withdrawn with its ID RETAINED rather than renumbered, so every citation to entries (3)–(16) stays true; `server/test/session-hook.test.ts`'s ALLOW table drops the row and its control asserts `ALLOW.filter(count === 0)` is EMPTY. The clause that was never redundant is unchanged: a claimed predecessor is observation-only.
- **D-2757 — `_reg_generation_read`'s `link "$p" "$al"` (`ccd/ccd:1870`) is a canonical-source `link` that §5's sixteen never enumerated.** It is the ccd-side twin of entry (16)'s hook-side generation-read alias, it names `$REG/<id>.generation` as its SOURCE — the same shape as entry (9) — and the shipped inverted scan produces it as a site on no entry. A gap in the LIST, not in the tree: the site is correct and is taken under its caller's held lock. Added to §5 as entry (17), and to the plan's Task 9 copy of the list; the equality is now over (1) and (3)–(17).
- **D-2758 — the citation audit is unsatisfiable before Task 11 re-anchors, and ships as a per-file RATCHET instead of a pass.** Task 9 rewrote every file the spec and plan cite, so their line anchors are stale by construction and the plan's own Task 11 is where they are re-measured. Measured with the same audit run unchanged against three trees: 41 failing citations at the chain's base (`8e457995`), 206 at Task 9's tip (`e584cd23`), and 198 after this fix round. The census is EXACT, so a new stale citation reds AND a repair reds — with a message saying to re-measure and LOWER the census rather than widen the rule. This round lowered it twice, both times because its own edits shifted a cited file's lines back under anchors that had drifted past them: `ccd/ccd` 133→128 and `ccd/session-hook.sh` 43→42, then `server/test/compact-card.test.ts` 9→7. **APPENDED 2026-09-16 (whole-branch review, B-M5) — THE INVISIBLE RESIDUE, RECORDED IN THE TREE.** What the census counts is what the RULE CAN SEE, and a large class is structurally invisible to every pass. THE MECHANISM: `refsOf` scopes bare-`:N` inheritance to the CLAUSE, so a bare `:N` whose clause names no source file is dropped before it is ever resolved — deliberately, because paragraph-wide inheritance was measured to MIS-ATTRIBUTE 23 references, every one to a file whose length the range does not reach. THE COUNT: ~192 such references across the spec and the plan at the Task 11 fix-round-2 tip, enumerated with their inherited file in `.superpowers/sdd/2026-09-10-graphify-compaction-card-plan-a/t11r2-citation-table.md`, which `.gitignore:53` excludes and `git ls-files .superpowers` confirms is tracked nowhere — so the enumeration exists on one worktree and in no merged ref, and this paragraph is the part of it that survives. THEY ARE NOT REPAIRED, and the reason is a measurement rather than a preference: spelling ~190 filenames in full is a larger and riskier edit than the debt it closes, and the one alternative — widening inheritance by one clause — is the mis-attribution above. REPRODUCE IT by running the audit's `refsOf` over both documents and counting the references it `continue`s at the inheritance branch. A THIRD under-reporting mechanism is recorded beside the two D-2849 names (sub-rule A’s function-body fallback and the SUPERSEDED retraction marker): `SENT` treats a table-cell `|` as a clause boundary, so inside a `|`-row every cell is its own clause and an anchor in cell 1 is never joined to the quotation in cell 3. The `|`-row pass exists for that, and its own limit is now measured too — joining a 13 KB row gave a single reference ~128 quotable tokens to draw on, which the whole-branch review's specificity floor closes by binding each reference to its OWN cell plus the row's first cell. **AND A FOURTH, measured 2026-09-16 rather than reasoned about:** `QUOTED` pairs backticks LEFT TO RIGHT with no escape rule and no double-backtick rule, so a clause that quotes a shipped line carrying `\`-escaped backticks — §5's recognizer row quotes `ccd/ccd:2253`, whose text is ``# this \`rm -f "$REG/$id".*\` directly were an unanchored glob: \`$id.*\``` — DESYNCHRONISES every quoted span after it in that paragraph by one, so the tokens the audit extracts are the prose BETWEEN the real quotations. Measured consequences, both directions: three `ccd/compact-card.mjs` anchors passed for ten rounds on the junk token `" ("` the desync produced, and after this round re-anchored them CORRECTLY they still report, because the extractor cannot see `hasUniqueSuffixOccurrence` at all. Two sentences were given their own paragraph to re-synchronise the pairing, which is a document edit and changes no claim; a `|`-row is one paragraph by construction and cannot be split that way, so §5's row keeps the defect and this sentence is where it is recorded. Reproduce it by extracting the row's spans with the audit's own `QUOTED` and comparing them with the backticked text a reader sees.
- **D-2759 — the fix-round brief mis-stated which legs the acquire-probe mutant reds.** The brief said it reds "the control leg" of `ccd-lifecycle-purge.test.ts`'s mechanism-absence matrix. Measured, the matrix's control leg asks only whether `command -v flock` and a real `flock -w 1` answer differently; a mutant that established absence by ATTEMPTING an acquire reds legs **(d1)** and **(d2)** — the generation-PRESENT refusals — because those are the legs whose verdict depends on WHICH probe answered. Recorded so the next round does not go looking for a red in the wrong test.
- **D-2760 — §3.0's claimed-overlap trigger keys on `overlap:true` ITSELF, not only on a failed ordinary-provenance grammar.** The controller's C1 ruling said to validate the claimed set's (trigger, scope, agent, transcript, parentLive, liveAgents) tuple against §3.0's four rows and normalise anything that is not one of them, "which is every overlap-forced set". MEASURED over the five reachable pre-overlap verdicts, that parenthetical is false for two of them: an already-`ambiguous` verdict (auto with `liveAgents ≥ 2`, or `parentLive:true` with `liveAgents == 1`) keeps a tuple the ambiguous row ACCEPTS, because the overlap branch clears only `CS_TRANSCRIPT` and `CS_AGENT` and those were already empty. A grammar-only gate would therefore attribute `cwd` and `built` on exactly those two shapes. §3.0 checks `overlap:true` BEFORE the table and says so; the runtime is built as the union — age first and winning, then `overlap:true`, then the grammar — which produces exactly the record the ruling prescribes for an overlap-carrying set in every case the ruling names.
- **D-2761 — PostCompact's `touch` and `mktemp` dependency guards are ARGUED, not pinnable by behaviour; only the `find` guard is.** The brief asked for a `minimalPath` leg per binary, each reddening when its guard is deleted. Measured in a throwaway copy: deleting `command -v touch` or `command -v mktemp` from `_hook_compact_post` leaves the whole session-hook suite GREEN, including the new absence legs, because every mechanism downstream already fails safely — with `mktemp` gone `_hook_lock_acquire` refuses rc 2 before anything is claimed, and with `touch` gone the claim is taken and the failed-touch branch restores canonical by no-clobber `link` (same inode, same bytes, same mtime) and returns without committing. The end states are indistinguishable from the guards firing. The legs are kept — they pin the ARM's inertness, which is a real §4 property — and the two guards are pinned by SOURCE beside them, for the reason this file keeps its one other unpinnable guard: it declares two userlands, and "the fallback happens to be safe" is a property of this box's bash and coreutils. The `find` guard is different and is pinned by behaviour: this round's D-2605 age measurement gave it a subject, and deleting it makes every set read as aged and commit a `scope:null` line it could have attributed in full.
- **D-2762 — §5's `printf >>` partial-failure fixture is unbuildable through this suite's stub mechanism, and the canonical trace is widened instead.** The row names "the write interrupted between the first and last byte of the appended record" as its observable. Measured: `printf` is a bash BUILTIN — with a stub first on PATH, `type -t printf` still answers `builtin` and the stub never runs — so no fixture in this suite can truncate that write. The finding's own alternative is taken: the canonical-write scan's variable trace now makes the LOCAL-to-LOCAL hop (`j="$journal"` in the same body) that its positional trace could not, riding the existing fixpoint. Measured before the widening, the `j="$journal"; printf … >> "$j"` variant produced NO site at all; it now produces one, on no allow-list entry, with entry (14) losing its site in the same run.
- **D-2763 — the §5 canonical-write scan's lock model gains ONE named exception, for the retained serve lock.** `_hook_generation_ok` has no lock of its own, so `held` inherits through call sites; this round's §3.3-step-5 recheck (m2) makes `_hook_compact_mark_served` one of those call sites, and its ONLY call site is at TOP LEVEL, where `callSites` does not look — so the inherit clause answered false on `cs.length > 0` without ever measuring a lock, and entry (16) read as an unlocked canonical write. The section is real: `_hook_compact_card` retains its descriptor in `COMPACT_SERVE_FD` instead of releasing, `_hook_compact_serve_end` is its single release site, and the marker sits between the print and that release — a shape the per-function acquire/release walk has no model for. The exception is named in one place and all three facts plus the top-level call site are re-measured by a test beside it, so it is an exception with a measurement under it rather than an assertion.

- **D-2782 — `_reg_purge` answers with THREE distinct nonzero statuses, and a post-emit removal failure gets its own refusal token.** Spec §3.4 already said a removal failure "is a different condition" from a lock miss, and fix round 1 gave it a nonzero status — but the SAME nonzero the pre-emit lock refusal returns, so all four callers, which only asked `if ! _reg_purge`, hard-coded the lock as the cause. MEASURED before the split, on a dead-reg row with one un-removable field: `_ws_gc_prune_row` journaled `outcome:"refused"`, `refusal:"purge-refused"`, `detail:"…compactions.lock was unavailable; the registry row is untouched"` while the lock was HELD, the row was destroyed (`uuid`, `project`, `workspace`, `branch`, `workdir` and `generation` all gone) and a `purge` done-fact was already on disk — every clause false, and an `outcome:"refused"`, which `ccd/ccd` itself defines as "before anything irreversible", emitted after an irreversible act. The seam now returns **1** for the pre-emit lock refusal, **2** for mechanism-absent-with-a-live-generation (already distinct), and **3** for a post-emit removal failure, with `REG_PURGE_UNREMOVED` naming what would not unlink; one recorder (`_reg_purge_unremoved`) sets the status and appends the pathname together, so the two can never disagree. `cmd_ws_rm`, `_ws_reap_tail` and `cmd_forget` branch on the VALUE and emit `_lc_fail … purge-incomplete` for 3, with a detail that says the row WAS purged and names the leftover instead of prescribing a wait for a compaction that is not running; `_ws_gc_prune_row`'s dead-reg arm emits `_lc_fail destroy` rather than `_lc_refuse_return` for 3, for the same reason the word `refused` is wrong there. `purge-incomplete` joins `LcRefusalToken` ADDITIVELY (the way `purge-refused` did) with its own sentence, and the sweep report gains a third LABEL, `incomplete`, deliberately without a third counter: `reclaimed` would count a wedge as a success and `declined` would say nothing was removed, so the row says which and the tally borrows `GC_DECLINED`, whose job is to tell the operator a row needs reading. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2782 was allocated 2026-09-14 15:06:53 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2783, under the allocator title "_reg_purge gains a THIRD status (3) for a post-emit removal failure, and a purge-incomplete refusal token". Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2793 — the stable-lock acquire REFUSES a later canonical disappearance instead of minting a second inode under a live holder, and the refusal is a `WHY` rather than a third status.** §4 ("a later canonical disappearance/replacement refuses, never recreates it"), §5's mutation row and §3.4's named fixture all required this and NONE of it was built: `_hook_lock_acquire` called `_hook_lock_init` unconditionally and `_compact_lock_acquire` inlined the same mint-on-absence branch. MEASURED with two real processes on a fixture `$REG`, driving ccd's own acquire: holder acquires canonical inode 167576, a stranger unlinks canonical, a second acquirer answers `RC=0` and canonical is back at inode 167577 — two processes each holding `flock` on a different inode of one pathname, the exact hazard `ccd/session-hook.sh`'s header says the link-based design removes. **The review's prescribed mechanism — "refuse if an exact-family alias is observable in `$REG`" — cannot see the scenario its own prescribed fixture builds,** and that is measured too: with a real process holding the lock, `$REG` lists exactly `.<id>.compactions.lock` and ZERO `lock-open` aliases, because the acquire unlinks its alias the instant the FD is held, deliberately and by its own comment. What the holder keeps is a DESCRIPTOR, and Linux names it — `/proc/<pid>/fd/<n>` reads back the alias pathname with ` (deleted)` after it, and nothing after the holder is killed. So the gate is built with BOTH arms: (a) the alias on disk, which catches an acquisition in flight, and (b) the `/proc` descriptor, which catches a holder past its acquire. Arm (b) is gated on `$REG/<id>.generation` — the same witness `_reg_purge`'s fail-open rests on — and is ONE `find … -lname … -print -quit`, because a `readlink` per descriptor was MEASURED at 7.8–8.4 s on this box (517 processes, 2662 `/proc/<pid>/fd` entries), longer than `COMPACT_LOCK_WAIT` itself and a 6x slowdown of the whole suite, against 0.16 s for the single `find`. The refusal returns the ordinary rc 1 and names itself in `HOOK_LOCK_WHY` / `COMPACT_LOCK_WHY` as `canonical-vanished`: a third numeric status was MEASURED to be silently mis-disposed — all six hook acquire sites read the acquire as a boolean, and `cmd_start` and `_spawn_start` fall through an unrecognised code into a silent continue, so rc 3 would have made two spawn paths treat a live-holder race as mechanism absence — while `cmd_ws_add`'s `|| die` form is itself source-pinned. `cmd_ws_add` and `cmd_start` append a conditional remedy clause when the `WHY` is set, because "retry" is the wrong remedy for a lock file nothing will recreate. RESIDUALS, stated in §3.4 rather than implied: a live holder on a row with NO generation (whose only in-design instance is row creation itself, which owns the slug exclusively for that window), and a box without `/proc` or without `find`'s `-lname`/`-quit`, where the acquire answers "first-ever mint" exactly as it did before. **APPENDED 2026-09-14 (r3 A-M1): "all six hook acquire sites" is this entry's HISTORY — there are FIVE, and the argument is unaffected.** Measured by exact census at this tip: `_hook_lock_acquire "` has five call sites in `ccd/session-hook.sh` (PreCompact's acquire and reacquire, PostCompact's settlement and final transaction, compact SessionStart), which is exactly what §3.1/§3.3/§3.4 specify, and all five do read the acquire as a boolean. `_compact_lock_acquire "` has five call sites in `ccd/ccd` — `_reg_purge`, `cmd_ws_add`, `cmd_start` and `_spawn_start` TWICE — so the fall-through pair is two FUNCTIONS across THREE sites, not "two of ccd's five". Both numerals are now read out of the prose by a scan in `server/test/session-hook.test.ts` and compared against the counted sites, in the hook's comment and in the spec sentence alike, so adding or removing an acquire without updating the prose reds. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2793 was allocated 2026-09-14 15:35:01 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2794, under the allocator title "the stable-lock acquire refuses a LATER canonical disappearance instead of minting a second inode under a live" — exactly 110 characters, the allocator's title cap, so the record carries it cut off mid-phrase and this quotation is the whole of what was stored. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2801 — exact purge covers the two transition legacy grammars, and its arms are anchored on a decimal pid so they cannot reach a nested id.** `_ws_private_family` matched only target-family suffixes — every arm requires the family word first — so neither `<pid>.<id>.compactset.tmp` nor `<pid>.compactcard-claim.tmp` matched. `_hook_family_sweepable` carries both, but that sweep runs only from a LIVE row's PreCompact: a row upgraded across this deploy carrying legacy residue and then purged by `ws-rm`, `forget` or `ws-gc --prune` kept it FOR EVER, because no PreCompact will ever run for a destroyed row. Both grammars are added. The asymmetry this creates with `_ws_slug_free`, which shares the predicate, is DELIBERATE and not to be split away: the property that predicate establishes is that a partially-purged id is never reused as a clean one, and legacy residue is residue. **The arms are anchored on a DECIMAL PID, where the hook's sweep still uses a bare `*`** — measured while writing the fixture, the bare form made `_reg_purge demo-quiet-basin` delete `.demo-quiet-basin.x-y.999.compactcard-claim.tmp`, a DOTTED NESTED id's legacy residue, reintroducing through the transition allowance the exact cross-id hazard the dot-free pass's `*.*` skip exists to prevent. A legacy name's first component is the writer's pid and a nested id's is the rest of its id. The claim grammar is pinned exactly — decimal head, then the grammar and nothing else, and the first attempt at that exactness ("no more than two components") was itself wrong, because the grammar carries a dot and it rejected the real `999.compactcard-claim.tmp`. The set grammar carries the id in the middle and cannot be pinned that way, so one contrived collision remains — an id whose own trailing component is all digits, e.g. project `demo-quiet-basin.99` slug `9` — and it is stated rather than hidden. **APPENDED 2026-09-14 (r3 A-I2): "where the hook's sweep still uses a bare `*`" is this entry's HISTORY, not the shipped state — the hook's sweep is anchored too.** The clause above admitted the asymmetry without disposing of it, and a reviewer measured what it cost: driving the shipped `_hook_family_sweepable` through the sweep's own find→strip→match loop, one ordinary PreCompact for `demo-quiet-basin` deleted the neighbour id `demo-quiet-basin.x-y`'s `.demo-quiet-basin.x-y.999.compactcard-claim.tmp` and `.demo-quiet-basin.x-y.777.demo-quiet-basin.x-y.compactset.tmp`, while correctly keeping that neighbour's target-family `compactpost` claim — every target arm names its family word first, so only the two bare-`*` arms leaked. Both now carry the identical anchor `_ws_private_family` does: for the claim grammar `${1#*.}` must be `compactcard-claim.tmp` and `${1%%.*}` decimal, for the set grammar `${1%%.*}` decimal, with the same disclosure of the same one residual collision. Pinned by the neighbour-id leg added to `server/test/session-hook.test.ts`'s `sweeps this id's AGED EXACT FAMILIES` fixture, which reds when either arm is reverted to the bare `*`. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2801 was allocated 2026-09-14 15:58:02 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2802, under the allocator title "exact purge covers the two transition legacy grammars, anchored on a decimal pid so it cannot reach a nested i" — exactly 110 characters, the allocator's title cap, so the record carries it cut off mid-phrase and this quotation is the whole of what was stored. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2802 — §5's "(round 7) stage completeness under a killed helper" row ships as a SOURCE pin, because the prescribed EFFECT fixture is unbuildable.** The row prescribes "kill the helper mid-write (SIGKILL between its `.part` write and rename); assert no stage file exists, only a `.part`, and the hook publishes nothing". MEASURED with `strace -f -e trace=write` over a `writeFileSync` of 4 KiB, 64 KiB, 256 KiB and 1 MiB: **exactly ONE `write(2)` at every size**, so there is no inter-write window for a SIGKILL to land in at any payload this helper produces — the partial state the fixture is supposed to observe cannot exist. What ships instead is a source pin over `writeAtomic`'s body (`server/test/compact-card.test.ts`, "A STAGE EXISTS IFF IT IS COMPLETE"), and it is MUTATION-EFFECTIVE in its own right: replacing ``const tmp = `${target}.part` `` with `const tmp = target` reds exactly that one test (1 failed | 50 passed). The same mutant leaves the whole of `session-hook` GREEN (260/260), which is the measurement that says no behaviour fixture in the tree carries this property and the source pin is not redundant. Recorded here in the same shape as its two siblings from fix round 1 — D-2761 (the `touch`/`mktemp` dependency guards) and D-2762 (`printf >>`) — which is the record-keeping this substitution was missing: `SIGKILL`, `writeAtomic` and "stage completeness" appeared nowhere in this ledger, and "A STAGE EXISTS IFF" appeared in no document. **APPENDED 2026-09-14 (r3 B-M4): this entry OVERSTATES what is unbuildable, and the row's EFFECT fixture exists.** The row prescribes the kill window as "SIGKILL between its `.part` write and rename", and that fixture is in the tree and green — `server/test/session-hook.test.ts`, "STAGE COMPLETENESS: a helper killed between its `.part` write and its rename publishes nothing", landed in round 1 at `14fd00de`, BEFORE the record above said it was impossible. What is genuinely unbuildable is only the NARROWER intra-`writeFileSync` truncation the `strace` measurement rules out, and the source pin covers that residual. The hazard this correction closes is the one the round's own lessons name: a later round reading D-2802 as authoritative deletes the effect fixture as testing an unobservable state, and the ledger says nothing was lost. Both the record and the `compact-card.test.ts` comment now name the fixture by file and title, and the naming is a MECHANISM — `compact-card.test.ts`'s stage-completeness `it` asserts that title string is still present in `session-hook.test.ts`, so deleting the fixture reds the very test whose comment claimed none could exist. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2802 was allocated 2026-09-14 16:34:03 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2803, under the allocator title "stage completeness is pinned by SOURCE where §5 prescribes an EFFECT fixture, because writeFileSync issues one" — exactly 110 characters, the allocator's title cap, so the record carries it cut off mid-phrase and this quotation is the whole of what was stored. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2845 — the frozen Task 10 opened a third door and left the fourth shut: an installer with no removal beside it, which falsifies a shipped sentence rather than merely leaking a file.** The spec names ONE door for the helper (§2: installed beside the hook by `deploy.sh`'s agent lane), and the frozen Task 10 correctly widened that to `ccrc install` and `ccrc update`'s backup — but not to `ccrc uninstall`. MEASURED at `99017a13`: `_uninst_cc_sessions`' own header states that its `rm -f` list IS `_inst_files` + `_inst_skills`' "install set, exactly" (`ccd/ccrc:7129-7130`), and `server/test/ccrc-uninstall.test.ts`'s `~/.cc-sessions: ccrc's own artifacts go file-by-file` asserts that list by name, so an `_inst_files` addition with no matching removal leaves a claim in shipped source that the shipped source contradicts — and leaves the helper behind on a box an operator believes is off ccrc, in the one directory whose header forbids a directory sweep as the remedy. The amendment adds `"$reg/compact-card.mjs"` to that list, plants the file in `plantInstalledBox`, adds it to the suite's removal list, and pins the symmetry a second way in `server/test/compact-card-ship.test.ts`: the same test that asserts the install asserts the removal, out of the SAME derived pathname, so the two cannot be edited apart. Recorded because "the installer is the task" is the reading that produced the gap, and the next widening of an install set will have the same shape. **APPENDED 2026-09-15 (Task 10 fix round 1, gate finding A-1):** "out of the SAME derived pathname, so the two cannot be edited apart" was WIDER THAN THE ASSERTION it described, and this sentence says what the pin now holds. MEASURED at `e0fea490`: the removal leg read `expect(fn![1]).toContain('"$reg/' + name + '"')` with `$reg` a LITERAL inside the expected string and only the BASENAME derived from `COMPACT_HELPER` — so moving the hook's assignment and all three installer destinations to `$HOME/.ccrc/compact-card.mjs` while leaving the `rm -f` list naming `"$reg/compact-card.mjs"` left `server/test/compact-card-ship.test.ts` 8 passed / 0 failed, with the asymmetry caught only by `server/test/ccrc-install.test.ts` and `agent/test/deploy-verify.test.ts`. The pin now holds the FULL PATH and derives all of it: the test reads `_uninst_cc_sessions`' own `local reg="…"` binding out of the captured body, substitutes it into the removal line, and asserts the result carries `COMPACT_HELPER`'s own absolute path — so an install destination moved with the removal left behind reds HERE too, which is what this entry's claim always said. **APPENDED 2026-09-15 (Task 11, Step 1):** the frozen Task 10 carries a SECOND artifact the freeze puts out of reach, and it is a whole file rather than a line number. Task 10's Step 1 opens with a fenced `ts` block that is a transcript of `server/test/compact-card-ship.test.ts`, and MEASURED at this tip — the fenced physical lines joined, each with its own LF — it is 7,567 bytes, sha256 `7d66fd6de26a1d9c6bf3938198dbc317c34910976814d1e15a07bed3511d32d0` (7,566 without the final LF, which is the figure the Task 11 dispatch carried). That is byte-equal to the file as CREATED at `b58e4092` and still byte-equal at `e0fea490`; the Task 10 fix round then diverged them — `042f36b4` took the file to 9,609 bytes and it stands at 11,296 bytes here, sha256 `ff856b818b535101662f487b0c392d3d1c121860f17e905aed3204977359592d`. So the fence is a SUPERSEDED TRANSCRIPT of one commit's version of that file, not a statement about the tree, and repairing it is out of reach from Task 11 for exactly the reason D-2849 gives for the two stale line citations: it lives inside the 24,688-byte freeze Task 11's own Step 1 is instructed to preserve. Read the SHIPPED file, whose own comments carry this round's measurements — the full-path uninstall pin this entry's first append describes is in the file and not in the fence. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2845 through D-2847 were allocated 2026-09-15 18:08:57 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 3, floor then 2848, under the allocator title "Task 10 amendment — installer/uninstaller symmetry, the shipped set, and agent-lane ordering" — ONE mint for the three, which is why they are adjacent and share a timestamp, and why this entry's record names the block rather than the number. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2846 — the shipped set is the helper ALONE, and three files the preflight brief put in scope need no edit; each reason is a measurement.** The brief's `Modify:` list named `server/test/build-release.test.ts`, and its "what the amendment must state" asked for `compact-card.d.mts` "if it ships". MEASURED at `99017a13`: (a) `deploy/build-release.sh`'s pathspec is `install.sh shared ccd deploy` (`deploy/build-release.sh:103-104`) — a DIRECTORY, so the helper rides the release tarball the day it is committed and neither the script nor its suite needs a line, and if that pathspec were ever narrowed the failure is LOUD, because `_inst_atomic` dies naming the missing source rather than installing nothing; (b) `ccd/compact-card.d.mts` is "types for the vitest import of compact-card.mjs" (`ccd/compact-card.d.mts:1-2`), read by nothing at run time, so shipping it would place an unrunnable artifact in `~/.cc-sessions` that D-2845's removal list would then have to carry — it must NOT ship, and the amendment asserts that no installer line on either door mentions it; (c) `ccd/ccd`, whose 1,162 Task 9 lines are the largest single change in the set, already has a door on both lanes and needs no new line at all. What was actually missing from every door was one file. Recorded so the next reader of the preflight does not re-derive a scope three files wider than the work. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2845 through D-2847 were allocated 2026-09-15 18:08:57 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 3, floor then 2848, under the allocator title "Task 10 amendment — installer/uninstaller symmetry, the shipped set, and agent-lane ordering" — ONE mint for the three, which is why they are adjacent and share a timestamp, and why this entry's record names the block rather than the number. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2847 — the helper installs BEFORE the hook, not after, because the hook's guard for it is silent and the install order is therefore a choice of which way a partial deploy fails.** The frozen Task 10 placed the `install_atomic` "directly after `install_atomic ccd/session-hook.sh …`" and the `_inst_atomic` likewise. MEASURED at `99017a13`, the hook guards the helper at exactly two sites — `[ -f "$COMPACT_HELPER" ] || return 0` in PreCompact (`ccd/session-hook.sh:1301`, covering the `card` call) and in PostCompact (`ccd/session-hook.sh:1448`, covering both `measure` calls) — and both are silent and total. So hook-then-helper leaves a window, one scp-plus-ssh round trip wide on a box carrying ~20 live sessions, in which every compaction publishes no set, serves no card and journals no line, and says nothing; helper-then-hook leaves a window in which a file sits on disk that the old hook never calls. Neither is an error and only one is observable, which is what decides it. Both doors are reordered, the deploy comment says why at its own copy and `ccrc`'s cites it, and the order is a MECHANISM rather than a note: `server/test/compact-card-ship.test.ts` asserts the helper's index is less than the hook's on both lanes, so swapping the two lines reds with the window named in the failure message. The adjacency bound the frozen version relied on (`≤ 2` executable lines, `ccrc-api-ship.test.ts`'s idiom) is kept unchanged and is satisfied either way, which is exactly why it could not have caught this on its own. **APPENDED 2026-09-16 (whole-branch re-review, B-M1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, which is indistinguishable on the page from a number taken rather than issued. From the controller's allocator log, verbatim: D-2845 through D-2847 were allocated 2026-09-15 18:08:57 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 3, floor then 2848, under the allocator title "Task 10 amendment — installer/uninstaller symmetry, the shipped set, and agent-lane ordering" — ONE mint for the three, which is why they are adjacent and share a timestamp, and why this entry's record names the block rather than the number. Recorded for D-2848's reason: an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2848 — Task 10's mutation table entry 5 enumerates FOUR reds and the tree produces THREE: the direct-scp ban is a NEGATIVE assertion that no `COMPACT_HELPER` move can trip.** The amended Task 10's Step 6 item 5 says changing `COMPACT_HELPER` to another path makes "four tests red at once (the deploy install line, the direct-scp ban, the backup clause and the whole `ccrc` install/update/uninstall test)". MEASURED on the throwaway archive of this task's own commit, with `COMPACT_HELPER` moved to `$HOME/.cc-sessions/elsewhere/compact-card.mjs` and nothing else changed (one file differs, sha256-verified): THREE red — `deploy.sh installs it through install_atomic`, `deploy.sh backs it up in the same set as the hook`, and `ccrc install places it at 644 before the hook, update backs it up, uninstall removes it`. `it is never scp'd straight to its final name` stays GREEN, and cannot do otherwise: its whole body is `expect(direct.test(read('deploy/deploy.sh'))).toBe(false)` over a regex built FROM the helper's path (`server/test/compact-card-ship.test.ts:50-60`), so moving the path only makes it search for a direct `scp` to a name that is not in the file either — an absence that was already true. A negative assertion reds only when the banned thing APPEARS, never when its subject moves. The test is not dead, which is the control that makes this a counting error rather than a hole: mutant 2 (the install line replaced by `"${SCP[@]}" ccd/compact-card.mjs "$BOX":.cc-sessions/compact-card.mjs`) reds exactly that test, with `the helper is copied to its live name in place`. No code or test changed for this — the derivation the entry is really about (every destination built from the hook's one assignment) holds, and is pinned three ways rather than four. Recorded because a mutation table that names a count and a list is read as a measurement, and this one was written from the shape of the file rather than from a run. **APPENDED 2026-09-16 (whole-branch review, B-I1) — ALLOCATION PROVENANCE.** This entry carried no allocation record, and its number equals the floor the preceding D-2845–2847 record states, which is indistinguishable on the page from a number taken rather than issued. Measured by the controller against the allocator: D-2848 was allocated 2026-09-15 18:53:00 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2849, with a title matching this entry. Recorded here because an issued number whose issue is unrecorded is the same artifact as an unissued one to every later reader.
- **D-2849 — the frozen Task 10 cites two line numbers that Task 10's own steps MOVE, so executing the task falsifies its own section, and the freeze puts the repair out of reach.** D-2847 rules that the helper installs BEFORE the hook on both doors; Steps 3 and 4 therefore insert above `install_atomic ccd/session-hook.sh …` and above `_inst_atomic "$tree/ccd/session-hook.sh" …`. Two of the five references in the section's own **Files:** paragraph point at lines below those insertion points, so they go stale the moment the task is done. MEASURED, each as a SHIFT PROVEN BY BYTE-EQUALITY rather than assumed — sha256 of the cited line at `eb8a4447` against the same line at this tip: `deploy/deploy.sh:629` → `:643` (+14, `231a9934cd86b1426d31ff92239acb7ffa05abab2b2da49acd5ff8c3429e369f` on both sides) and `ccd/ccrc:6531` → `:6537` (+6, `100a047af57009cbd7deab5ef8039cb9cdc726796cf892d46cd1da4e3ba481e9` on both sides). The other three in that paragraph survive, measured by the audit itself and not reasoned about: `deploy/deploy.sh:560` because the backup clause lands AFTER it, `ccd/ccrc:5217` and `ccd/ccrc:7129-7130` because sub-rule A still anchors them. THE REPAIR IS UNREACHABLE FROM HERE AND FROM TASK 11: both stale references live inside the Task 10 section, frozen byte-for-byte at 24,688 B / `46535cdd524041584201abc0e8ac690df9cf1930d7398cefc3194a495de5dc7d`, and Task 11's Step 1 instruction is to preserve exactly those bytes — so the freeze and the execution cannot both be satisfied, and no later task in this plan may close it either. Recorded rather than repaired, and the exact ratchet in `server/test/session-hook.test.ts` is RE-MEASURED to say so: the per-file map gains `'ccd/ccrc': 1` and `'deploy/deploy.sh': 1`, the narrated sum moves 204 → 206, and `TOUCHED` gains the two files Task 10 rewrote so its claim — every failing citation points into a file this work rewrote — stays true and stays checked. The rule itself is untouched; only the count of what it finds. This is the one edit in Task 10 outside the section's own **Files:** list, and it is here because leaving a suite red to protect a file list would be the worse trade. **APPENDED 2026-09-15 (Task 10 fix round 1, gate finding B1, reproduced by an independent refuter):** FOUR of that paragraph's five references go stale, not two, and the entry above is wrong twice over — in the COUNT, and in the MECHANISM it gives for one of the pair it excused. Each of the two unrecorded shifts is PROVEN by the same method as the two above, sha256 of the cited line at `eb8a4447` against the same line at `e0fea490`: `ccd/ccrc:5217` → `:5223` (+6, `c412b7f02b3096ee024908dd78d4464cc36e4f43689df5da92728075c51c2e06` on both sides — the `_inst_atomic "$tree/ccd/session-hook.sh" …` line its clause quotes, the one Step 4 inserts directly above; tip `:5217` is the new comment's first line) and `ccd/ccrc:7129-7130` → `:7136-7137` (+7, `251e23869ba0bb0815e04445787e54d93cbff98451bc87c201a32da7f0706d11` on both sides — the `_uninst_cc_sessions` header reading "The list below is `_inst_files` + `_inst_skills`' install set, exactly."; tip `:7129-7130` is an `echo "uninstall: wrappers: …"` and a closing brace). Only `deploy/deploy.sh:560` really survives. AND THE TWO ARE EXEMPTED BY DIFFERENT MECHANISMS, each measured by an instrumented trace of the audit rather than reasoned about: `ccd/ccrc:5217` does pass through SUB-RULE A, because `_inst_files`' body still contains line 5217 and its clause quotes that function's name; `ccd/ccrc:7129-7130` never reaches sub-rule A at all — its clause contains "falsifies", the retraction matcher's `falsif` alternative fires, and the reference is classed as quoted history before the token step. Sub-rule A could not have anchored it in any case: `_uninst_cc_sessions()` begins at tip line `7138`, BELOW the cited range. SO THE CENSUS IS A MEASUREMENT OF WHAT THE AUDIT CATCHES, NOT OF THIS SECTION'S CITATION DEBT — `'ccd/ccrc': 1`, `'deploy/deploy.sh': 1` and the 206 are exactly right about the audit and understate the debt by half, and no ratchet built on that audit could ever surface the other two. THE REMEDY IS A SECOND PASS, NOT A WIDENED RULE, because widening the audit would red the retraction records it is right to exempt: `server/test/session-hook.test.ts` now carries `filesAudit`, scoped to `**Files:**` paragraphs and taking NO exemption — no ledger arm, no retraction marker, no sub-rule A — on the ground that a file list is a location index, never quoted history. MEASURED at this tip, its set is FIFTEEN references, not the four this section owns: these four (`deploy/deploy.sh:629`, `ccd/ccrc:5217`, `ccd/ccrc:6531`, `ccd/ccrc:7129-7130`) and eleven in Task 9's own **Files:** paragraph, which are the stale-by-construction debt D-2758 parks in Task 11. THREE of the fifteen are keys the census never reports at any line — `ccd/session-hook.sh:1098` as well as this section's two — which also answers the gate's open question about whether the retraction marker hides stale references elsewhere in the corpus: it does, and this is where they now show. **APPENDED 2026-09-15 (Task 11, Step 1):** the append above is exact about what the audit catches and imprecise about the paragraph. "FOUR of that paragraph's five references" is four of the five that the two `- Modify:` bullets carry — `deploy/deploy.sh:560` and `:629` in the first, `ccd/ccrc:5217`, `:6531` and `:7129-7130` in the second — and the **Files:** paragraph is longer than those two bullets. MEASURED at this tip with the shipped `filesAudit`, over the whole paragraph: it resolves SEVEN references and THREE survive. The two neither this entry nor its first append ever counted are in the `- NOT modified` sub-list and both pass on merit — `deploy/build-release.sh:103-104`, whose clause quotes the pathspec `install.sh shared ccd deploy` that is on those lines, and `ccd/compact-card.d.mts:1-2`, whose clause quotes that file's own first two lines. So the honest statement of this section's citation debt is FOUR STALE OF SEVEN RESOLVED, with `deploy/deploy.sh:560` the only survivor among the five in the `- Modify:` bullets and the other two survivors outside them; the exemption-free pass in `server/test/session-hook.test.ts` carries those same four and no more, and its own comment now says five-of-two-bullets rather than five-of-the-paragraph. **APPENDED 2026-09-16 (Task 11 fix round 1, gate findings B7/A-M6):** Task 11 itself made the departure this entry set the precedent for, and said nothing. MEASURED over 43786aae..36d7dccd, Task 11 modified TWO files its own **Files:** paragraph did not name — this plan (one hunk in Global Constraints, sixteen inside Task 9's section, two ledger appends: 24 changed lines, of which ZERO are in Task 11's own section) and `server/test/session-hook.test.ts` (73/17) — while naming `server/test/ownership.test.ts`, which the range never touches. Both departures were unavoidable for the same reason this entry gives for its own: D-2758 parks the corpus-wide re-anchoring in Task 11 and the anchors live in the plan, and the census literal is EXACT, so a repaired anchor reds the suite unless the same commit re-measures it — leaving a suite red to protect a file list would be the worse trade, here as there. Task 11's **Files:** paragraph now names both with those reasons, drops `ownership.test.ts`, and Step 3's stage command matches. NEITHER departure reaches a shipped file or a frozen section: measured across the whole of Task 11 and this fix round, no file under `ccd/`, `deploy/`, `agent/src`, `shared/` or `server/src` differs by a byte, and Task 8 (11,680 B / `a84c441a4de821e61ff14ddbdc37a35c486ab7da68b5d36c4076ab28b2738d1d`) and Task 10 (24,688 B / `46535cdd524041584201abc0e8ac690df9cf1930d7398cefc3194a495de5dc7d`) re-derive unchanged under Step 2's committed extractor after every commit of both. **APPENDED 2026-09-16 (whole-branch review, B-I1) — ALLOCATION PROVENANCE.** As for D-2848 above, and for the same reason: measured by the controller against the allocator, D-2849 was allocated 2026-09-15 19:18:10 UTC through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 1, floor then 2850, with a title matching this entry. Each of the two was a SINGLE mint rather than a block, which is why the two records are minutes apart and the numbers are adjacent; the project floor now stands at 2867. **APPENDED 2026-09-17 (second merge of `origin/main`, 03ecda65):** `deploy/deploy.sh:560` no longer survives either. Main's #114 inserted nine lines at `deploy/deploy.sh:508` — above the backup clause the reference names, which now stands at `:569` — so all FIVE of the two `- Modify:` bullets' references are stale, the per-file census reads `'deploy/deploy.sh': 2`, the exemption-free **Files:** set carries `:560` beside `:629`, and the named set in `server/test/session-hook.test.ts` is five rather than four. Still inside the 24,688-byte freeze, still recorded rather than repaired. The spec's two anchors into the same file (§2's `install_atomic` line and its backup clause) were re-pointed by content in the same commit, `:639`→`:648` and `:561`→`:570`, each cited line byte-identical on both trees.
- **D-2926 — the merge with `origin/main` composed `_reg_purge`, the launch lines and one initialiser out of two trees neither side ever ran, and each composition is named here because it is authorship, not arbitration.** MEASURED at the merge commit `6e84524a` (parents `fcf2c660`, this branch; `f27c8a86`, `origin/main`, 41 commits past the base `ee1d6228`): five files collided. In `ccd/ccd`, main's `_usage_purge "$id"` now stands between this branch's two tracked unlinks inside `_reg_purge` (`rm -f "$REG/$id.hookstate.json" || _reg_purge_unremoved …` / `_usage_purge "$id"` / `rm -f "$REG/$id.reaping" || _reg_purge_unremoved …`) — the usage sidecar's removal is main's "always 0" design and is deliberately NOT a tracked unlink, so a sidecar that cannot be removed does not raise `_reg_purge`'s status; `_usage_purge` itself is placed ABOVE the stable-lock block so `_reg_purge_unremoved` still stands immediately beside its one caller, as its own comment claims. The two tmux launch lines compose both sides' environments in one `exec env`: `${genenv}` (this branch's `CCRC_SESSION_GENERATION='…' `, D-2605) first, then `COLORTERM=truecolor`, then main's `$resenv` and `$launchflags` in place of the old `$rcflag` — all four names are bound in the same function on the merged tree. Two comment citations that both sides had re-anchored differently name `_ws_archive_manifest` — the function that exists on all three trees; main's spelling `_ws_manifest` never did — at the lines MEASURED on the merged tree. The line-2 `ccrc:generated` marker of `ccd/ccd` was re-stamped over the merged body, because each side's stamp was true of its own body and false of this one. In `ccd/session-hook.sh`, main's `_hook_memory_converge || true` runs before this branch's initialiser line, which keeps `CARD_COMPACT`, `COMPACT_SERVE_FD` and `COMPACT_SERVE_NONCE` that main's shorter line lacked; main's "(which returns early below)" is still true — the compact source still `exit 0`s after `_hook_compact_serve_end`. In the two fixtures, main's three new bins precede `ccd/compact-card.mjs` so main's "unlike the four above it" still counts four, and the helper is added to main's removal list. The merge commit's message carries the same list; this entry exists so the ledger does. Allocation: D-2926 through D-2933 were allocated 2026-09-17 00:12 UTC (response: numbers 2926–2933, floor 2934, http 201) through `ccrc-api ledger allocate --project ccrc-pwa` to `ccrc-pwa-amber-prairie`, count 8, floor then 2925 (2934 after), under the allocator title "Merge with origin/main f27c8a86 — the compositions, the BSD-userland degrade, converge silence, the timeout stubs, and two test pins the merged tree moved" — one mint for the block, which is why they are adjacent. **APPENDED 2026-09-17 (merge fix round M3, gate 1 A-I1):** the sentence above — "the usage sidecar's removal is main's 'always 0' design and is deliberately NOT a tracked unlink, so a sidecar that cannot be removed does not raise `_reg_purge`'s status" — described a composition that falsified the branch's own contract comment 22 lines above the call, and it is now reversed rather than merely restated. MEASURED before the change: a sidecar in a 0555 directory survives, `_reg_purge` answers **0**, and `REG_PURGE_UNREMOVED` is empty — the exact condition the "Every unlink from here down is tracked and the function returns 3 … if any of them failed" comment says cannot happen. `_usage_purge`'s three removals now each carry `|| _reg_purge_unremoved "<path>"` — the glob line recording its PATTERN, the `.agents` line GROUPED behind its `[[ -d ]]` so an absent directory records nothing — which makes the composition's invariant a mechanism and satisfies BOTH parents: main's "a REUSED id must never inherit a dead session's reading" and the branch's §3.4 "a removal failure is its own condition and its own status". It does not stop the purge, which is all main's "not a reason to stop purging the row" ever protected: the recorder sets `_pg_urc` and appends a pathname, the loop and every later unlink still run, and the status is reported once at the end exactly as for every other tracked unlink; `_usage_purge` itself still returns 0, and `_ws_slug_free` never reads `$REG/usage`, so slug reuse is unaffected either way. TWO consequences for the entry above: `_reg_purge_unremoved` no longer has "exactly one caller" — it is reached from two sites, `_reg_purge`'s own unlinks and `_usage_purge`, whose only call site is inside `_reg_purge`, so it is still ONE dynamic extent and its placement immediately beside `_reg_purge` is still what keeps `_pg_urc` in scope; and its SEPARATOR note no longer says `$REG/<id>.<suffix>` and `$REG/.<id>.<suffix>` are "the only two shapes that reach here", since the three usage shapes now do. PINNED, where nothing pinned it before: `server/test/ccd-usage-purge.test.ts` now carries a sealed-`$REG/usage` fixture (rc 3, all three paths named, the registry row destroyed anyway), a removable control (rc 0, empty record), and a source scan asserting `_usage_purge` has exactly one call site and it is inside `_reg_purge` — mutation-measured: reverting one recorder reds the first on its own clause, moving the call out of `_reg_purge` reds the third on its location assertion alone, and `ccd-workspaces.test.ts`'s RM_CALLS ratchet still measures 27 because no `rm` was added. Every shipped-file edit of that round was line-count neutral (`ccd/ccd` 21/21, `ccd/session-hook.sh` 5/5), so the 259 anchors M2 re-pointed stand. CARRIED from the same round's sweep, by name: eight stale anchors outside the sibling-clause class whose base bytes were their referents — spec:1296 `:12595`, spec:1325 `:16655`, spec:1955 `:1022`, spec:1983 `ccd/ccd:5091-5092`, spec:1987 `ccd/ccd:5081-5085`, spec:1990 `:4695-4705`, plan:3234 `ccd/ccd:12013-12014` — left for a citation round that re-measures the census with them, since several are full references the audit counts.
- **D-2927 — the BSD-userland degrade is the tmux bound's, not the arm's.** The spec's §3.1 item 7 and the plan's Task 6 row claimed that a userland carrying neither `timeout` nor `gtimeout` still got this arm's own work: the set written, the hookstate at `working`, `_hook_timeout` returning 127 and its swallowed helper call leaving the hook-owned set standing for PostCompact to claim at settlement. The merge with `origin/main` falsifies that. `ccd/session-hook.sh` now resolves the same two deadline names ABOVE the `case "$event"`, to bound its one `tmux display-message -p '#S'` question, and with neither present it does not ask the question at all — `$tname` stays empty and `[[ "$tname" == cc-?* ]] || exit 0` ends the run before there is a session id. Such a box writes no hookstate, no set, no card and no journal line: the WHOLE hook is inert, not this arm. The collision is resolved in main's favour — that rule is later, explicit, and about the hot path of every tool call in ~20 live sessions, while this arm's degrade was a portability convenience — so the test is rewritten to the merged fact and renamed (`with no timeout or gtimeout on PATH (a BSD userland) the WHOLE HOOK is inert — no set, no card, no hookstate, silence`), and the spec, the plan's copy of the row, its Step-3 draft comment, its Step-7 mutation 5 and the D-2446 entry now say so (merge fix round M1, commit `5e863213`).
- **D-2928 — `_hook_timeout`'s `return 127` is unreachable through the condition it was written for.** Its guard is the same `command -v timeout || command -v gtimeout` predicate as the merged tmux bound, so any box that reaches a compaction arm has already resolved one of the two binaries; only a binary vanishing from PATH mid-run could separate them. The 127 contract still covers what it can still see — a missing `node`, a helper that refuses — which other rows in `server/test/session-hook.test.ts` pin. The plan's Step-7 mutation 5 (replace the final `return 127` with `shift; "$@"` and that row reds) is therefore dead as written: the row never reaches the resolver. Its live control is the bound itself, measured red in M1 by replacing `[[ -n "$hooktmo" ]] && tname=$("$hooktmo" 2 tmux …)` with an unbounded call (`no set — the arm was never reached: expected true to be false`). No guard measures the unreachability itself; recorded as such.
- **D-2929 — main's `_hook_memory_converge` broke the hook's stderr silence on any PATH without `dirname`.** The function runs on every SessionStart including compact and forked `dirname` twice with no `2>/dev/null`, so a PATH that deliberately omits one command — exactly what the compaction suite's `minimalPath()` builds, and `dirname` is not in its tool list — produced `session-hook.sh: line 657: dirname: command not found` in the middle of two arms whose whole subject is silence (`with no find on PATH …` and `(e) with no flock …`). Both forks are replaced by `${tp%/*}`/`${d%/*}` behind a `*/*` guard, which decides nothing the function did not already decide (a slashless `transcript_path` is the relative payload the next comment already refuses, and `dirname` would have answered `.`, whose parent can never end in `/projects`), removes two subshells per SessionStart, and cannot speak on any PATH. Measured over the rest of the function: every other external already redirects stderr; `pwd -P` is a builtin and was left as is. This is an edit to main's code made by this branch's merge — authorship, recorded as such (M1 commit `fbbf6907`, red/green/control in the ledger).
- **D-2930 — a rename note in `ccd/ccd` pointed at a function that does not exist.** `_codex_lane_status`'s header recorded its 2026-09-14 parameterisation as "was `_gpt_status`", and this branch's dangling-identifier scan (`every backticked _identifier in a shell comment resolves to a function that exists`) reads a backticked lower-case `_name` on a comment line of either shipped shell file as a claim that such a function exists. The note now names the dead function without backticks and says why; the rewrite is line-count neutral so no `ccd/ccd` citation moves, and `ccd/ccd` was re-stamped because its line-2 `ccrc:generated` marker is a sha of its body (M1 commit `6101e0b1`).
- **D-2931 — a `timeout` stub on the fixture PATH is no longer a barrier around the helper.** The merged hook invokes `timeout` twice per run — once for the tmux bound above the event switch, once for the bounded helper — so a stub fires FIRST against a hook that has not started its arm, and an `exit` there empties `$tname` and ends the run. Two rows were red on that alone (`records working hookstate before the bounded helper starts …` and `THE CAS: a sibling that publishes its own verdict while the helper runs keeps it`), and four more passed only by luck: three argv recorders whose first recording was overwritten by the helper's later call, and the close-before-fork row, which was answering "got" from a window in which the arm had not yet taken the lock. All six stubs (`timeout` and `gtimeout` alike — main's bound resolves both by the identical predicate) now carry a `HELPER_ONLY` prologue (`case "$*" in *compact-card.mjs*) ;; *) shift; exec "$@" ;; esac`) that runs any non-helper bounded command unbounded and unobserved, and the `stub()` docstring records the two-invocation fact (M1 commit `f912bb95`).
- **D-2932 — the purge cost ratchet moved 25 → 27 because main's `_usage_purge` runs inside `_reg_purge`, and the number is re-measured rather than added.** `server/test/ccd-workspaces.test.ts`'s `holds at EVERY interruption point of _reg_purge` pins the purge's unlink count as a LITERAL (D-2605 fix round 3, B-M5: a bound derived from the measurement is tautological), and the merge red it with `expected 27 to be 25`. MEASURED at `6e84524a`: the whole `ccd/ccd` merge diff adds exactly four `rm` invocations — three in main's `_usage_purge` (`$REG/usage/<id>.json`, `$REG/usage/.<id>.*.tmp`, and an `rm -rf` of `<id>.agents` behind a `[[ -d ]]` the fixture never satisfies) and one in the `inert` field setter `_reg_purge` never calls — and removes none, so the delta is the two unconditional sidecar unlinks, which the fixture's own `measureRmCalls` instrument reports as 25 → 27. The comment's derived cost was RE-MEASURED too, by instrumenting the file's `sh` alias for one run: the `it` performs 31 real `sh()` invocations (one replay plus `RM_CALLS + 3`), where the old sentence said 28 — so an arithmetic "28 + 2" would have been wrong as well. The comment also now says the two new unlinks run mid-purge, between the `hookstate.json` unlink and the `reaping`/`archived` tail, so the pinned number is a claim about the total and not about ordering (merge fix round M1b).
- **D-2933 — main's bash-containment census names this branch's lock-holder spawn, which predates the census.** `ccd-workspaces.test.ts`'s `routes EVERY bash call site in every ccd test file through ALL THREE poisons` (main, after the fork) reads each `spawn('bash', …)` in the ccd suites and requires `ghContainedEnv(` with `systemd: true` and `tmux: true`; `ccd-lifecycle-purge.test.ts`'s `a HELD lock refuses the purge …` holder — `exec 9<>"$1" … flock 9 … sleep 8`, a process that runs nothing but `flock` and `sleep` — carried no options object. MEASURED with the census's own `expect.soft` pass: it was the ONLY site named; the siblings at the `HOLDER B` and canonical-disappearance rows already carry the three poisons. The holder now spawns with `{ cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) }`, which changes nothing it does, and the census keeps its rule — no exemption was added; the control (options removed, comment kept) reds the same three clauses (merge fix round M1b).

## Self-review (writing-plans checklist, corrected after Task 6 execution and fix-round review)

- **Spec coverage.** §3.0 → Task 2 (rule/canonical overlap) plus Task 9 (young-claim overlap and normalization); §3.1 → Tasks 2, 6 and 9; §3.2 → Tasks 3, 4, 5; §3.3 → Task 7 plus Task 9's marker-only amendment; §3.4 → Tasks 8 and 9 (sole sink, claim-first ownership, exact-one gate, stable-lock transaction); §5 Hook rows → Tasks 2, 6, 7, 9; §5 Helper → Tasks 3, 4, 5, 8; §5 Installer → Task 10 unchanged; §6 R2 → Tasks 6 and 9 (8-second helper deadline, plus round 7's two stable-lock waits — `COMPACT_LOCK_WAIT_SERVE` at 2 s for compact SessionStart alone, `COMPACT_LOCK_WAIT` at 5 s for every other acquisition); §6 registry/lifecycle runtime coupling → Task 9 only; Task 11 audits the final documentation and committed bytes without runtime work; §7 deploy → the Deploy section. Not in this plan, by the spec's own split: §3.5 (Plan C), §3.6 and the Wire rows (Plan B). **Correction (Task 7 fix round, I2):** §5's `ceilings drift` row (`HARNESS_CONTEXT_SPILL_CHARS`, spec §2 constants table) named no owning task anywhere in this plan before the fix round — confirmed absent by scanning every task and this file. Task 7 owns it now, since Task 7 introduced the second ceiling (`COMPACT_CARD_MAX_CHARS`) the row compares against the first; the pin reads both ceilings from the hook's own source rather than hand-copying their values. The neighbouring `total clip raised` row is also corrected there: its promised runtime red cannot occur (the value is provably unreachable, see the deviation below), restated as a source-level pin on the derivation.
- **Execution state.** Tasks 1–8 code and their scoped fix rounds are complete at the amendment base; Task 9 runtime is deliberately not implemented by this document-only D-2605 change. Task 6's focused tests, five-run real-graph and over-cap measurements, diagnostic mutations, and full validation are complete. The measured helper p95/RSS is recorded in the timeout comment: ccrc 0.36 s / 104,384 KiB and the largest admissible MekWarLive graph 1.05 s / 332,184 KiB; MegaMek was refused before parse with unchanged scratch bytes. The later claim-seam correction applies atomic claims to both set and card, adds deterministic set/card directory protection plus post-claim and post-successful-restore B/C interleavings, and verifies red helper and shell mutations back to nonce-read then atomic-original-write. Later plan tasks remain pending, including Task 7's compact-arm ratio band (R=4 provisional). The `[ -f "$COMPACT_HELPER" ]` shortcut is intentionally unpinned because deleting it leaves the same silent failure; nonce ownership, post-set rollback, later-owner protection and hookstate-first ordering require diagnostic red mutations.
- **Type consistency.** `CS_SCOPE`/`CS_TRANSCRIPT`/`CS_AGENT`/`CS_LIVE_N`/`CS_PARENT_LIVE` feed Task 6; Task 9 adds the explicit `overlap` fact and, under round 7's option A, moves canonical card/set ownership OFF the helper entirely — the helper writes only two hook-named stage paths, and the hook alone renames them to canonical under its reacquired lock. Task 7 pairs card and set by collision-resistant nonce; Task 9's claim name is deliberately independent of that nonce so settlement precedes parsing. `measureCommand` retains numeric `at` only as measurement. Its legacy `served` field is overridden in the final record by exact-marker existence. `COMPACT_SHAPE_PRED` gates one helper object; no hookstate or persisted ordinal type exists. Task 9 merges `cwd`, `built`, `agent`, `transcript`, `parentLive`, and `liveAgents` on every record, using nulls when attribution is unsafe and retaining `scope:"ambiguous"` for an explicit overlap claim.
- **Counts.** Test counts are not quoted per step ("every test in the file"): they drift with every added case and a wrong count makes a correct run look wrong. The `case "$event"` block parses to TEN events (`install-session-hooks.test.ts` floors at 10).
