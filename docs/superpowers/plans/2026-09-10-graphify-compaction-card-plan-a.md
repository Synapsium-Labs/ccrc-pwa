# Graphify compaction card — Plan A: the agent lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every compaction — the main thread's or a subagent's — the session is re-injected with a computed card of the files it was working in (symbols, community, dependents, from graphify's graph), and the summary is measured for whether it changed; the measurements start filling a per-session journal on the fleet box with no console change.

**Architecture:** `ccd/session-hook.sh` gains behaviour in its three existing compaction arms: PreCompact decides WHICH context is compacting — `main`, `subagent` or `ambiguous`, by the liveness rule of spec §3.0, ONCE — writes the set file, and for an unambiguous scope runs the new helper `ccd/compact-card.mjs card` to mine that transcript's window, resolve the files against `graphify-out/graph.json` and write the card with the set's `at` as its first line; SessionStart(compact) serves that card once, as the fourth subject of the one envelope, iff the card's first line is the set's `at` (it never resolves); PostCompact runs `compact-card.mjs measure` over `compact_summary` against the set (iff inside the in-flight window), merges the result into hookstate as `compaction` and appends the journal. The helper is plain node (`node:*` only, the `shared/mark.mjs` class) installed beside the hook by `deploy.sh`'s agent lane and `ccrc install`. No new hook events; nothing printed on PreCompact in this plan (that is Plan C).

**Tech Stack:** bash 4.4+ (the hook), node 22+ ESM (`.mjs`, no npm deps), jq, vitest 4 (`server/test`), TypeScript declaration sibling (`.d.mts`).

**Spec:** `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` — §0.2 (measured facts), §2 (architecture, constants), §3.0–§3.4 (this plan's mechanisms), §4 (failure modes), §5 (Hook, Helper, Installer mutation tables), §6 (rings/invariants), §7 item 1 (this plan). §3.5 (steering) and §3.6 (wire/chip) are Plans C and B and are NOT built here.

## Global Constraints

Every task's requirements implicitly include this section.

- **Work in a git worktree of `ws/graphify-compaction-card`** (superpowers:using-git-worktrees). Every path below is relative to that worktree's repo root. Run every vitest command from inside `server/`: `cd server && ./node_modules/.bin/vitest run test/<file>` — **never bare `npx vitest`** (it resolves a global copy and reports "no tests"). Run suites in the FOREGROUND with a tool timeout ≥ 600000 ms. Known load flakes to re-run in isolation before calling a break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **Fixture HOMEs only.** Never run the hook, `ccd`, `ccrc` or `deploy.sh` against the real `$HOME`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, `~/.ccrc` or any `claude-session@*` unit. Never run `graphify update` or any graph build — the ccrc sweep owns the write side; the helper READS `graphify-out/` and nothing else.
- **The hook's standing contract** (`ccd/session-hook.sh` header): exit 0 on every path, write atomically or not at all, no network, no locks — unchanged; **no waiting** is amended ONCE, as spec §6's R2: the two compaction arms wait on the helper under `timeout` for at most `COMPACT_HELPER_TIMEOUT` (8 s, re-measured on this box's real graphs in Task 6 before it ships), off the hot path, after the hookstate write has landed. Task 6 corrects the header sentence. Every new call site is `|| true`/`|| return 0`-shaped; `find` is guarded with `command -v` inside the resolver (the file's `jq` idiom); `node` and `timeout` are NOT — their absence is indistinguishable from a failing helper at the call site, and a guard nothing can redden is not a mechanism. **Plan A prints nothing new**: SessionStart is still the only event that prints context, PreToolUse the only one that prints a decision; the `prints NOTHING on every other event` test keeps PreCompact and PostCompact in its loop and must stay green. The R1 "one printf" rule and the hook header's two-event sentence are NOT amended here — that is Plan C's, with the print.
- **Only ccrc-owned artifacts change**: the hook, the helper, `deploy/deploy.sh`, `ccd/ccrc`, tests, README, this plan and the spec's status line. No `CLAUDE.md` anywhere (operator ruling 2026-09-02).
- **Constants are defined once, in the hook, with the spec §2 values**: `COMPACT_CARD_MAX_CHARS=4000`, `CARD_MAX_CHARS=2400` (exists — **never moved, never raised**: it is the only defence for the ungated `GM_NODES`, D-1899), `CARD_TOTAL_MAX_CHARS` DERIVED as `$(( CARD_MAX_CHARS + 1 + COMPACT_CARD_MAX_CHARS ))`, `COMPACT_CARD_MAX_AGE=1200` (the in-flight window), `COMPACT_LIVE_S=120` (liveness), `COMPACT_HELPER_TIMEOUT=8`, `COMPACT_WORKSET_MAX=12`, `GRAPH_GATE_MAX_BEHIND=10` (exists). In the helper: `WINDOW_CAP` = 16 MiB, `WORKSET_CAP` = 100, `GRAPH_MAX_BYTES` = 96 MiB. The jq shape predicate `COMPACT_SHAPE_PRED` is spelled ONCE and concatenated into both jq programs that need it.
- **Registry files carry dot-free suffixes** — `.compactcard`, `.compactset`, `.compactions` — so `ccd/ccd`'s `_reg_purge` (which removes every dot-free `$REG/<id>.<suffix>` except `archived` and `reaping`, plus the explicitly named `hookstate.json`) unlinks them with the row. The same dot-free shape is what `_ws_slug_free` scans, so nothing may outlive its use: aged cards and sets are removed, never left (spec §6). Temp names are dot-PREFIXED and carry the writer's pid — the hook's `$REG/.<id>.<pid>.<suffix>.tmp` (its hookstate idiom), the helper's `$REG/.<name>.<pid>.tmp` — invisible to every suffix-shaped registry glob AND to `_reg_purge`, which is why PreCompact sweeps this id's stale `.compact*.tmp` temps (a helper killed by `timeout` between write and rename leaves one).
- **The `case "$event" in … esac` block is parsed by `server/test/install-session-hooks.test.ts`** (`^\s{2}([A-Za-z|]+)\)` on each line). Arm labels stay at two-space indent; never add a two-space-indented `Word)` line inside that block; add no event. New work hangs off the existing arms and off two call sites placed OUTSIDE the block (Tasks 2 and 9 say where).
- **TDD, red first, with a measured mutation per guard.** Each test is written and shown failing before the code; each guard task ends with a mutation step — apply the named mutation, run the named file, observe the named case red, restore with `git checkout -- <file>` **in the worktree only**. The spec's §5 tables are the checklist; every row this plan owns is named in a task.
- **Deviation numbers are MINTED, never chosen.** This plan's `## Deviations found` section carries numbers allocated through `~/.local/bin/ccrc-api ledger allocate` at plan time. If execution finds a new deviation, allocate before writing it (`printf '{"project":"ccrc-pwa","count":1,"title":"<what>"}' | ~/.local/bin/ccrc-api ledger allocate --json -`); a session that cannot reach the allocator writes `D-TBD-<slug>` and reports it.
- **Commit per task**, message `type(scope): one sentence in the tree's voice`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `git add -A`; every commit step lists its paths. Never `git stash`.
- **Node floor `>=22.13.0`.** The helper imports `node:*` only and is importable by vitest through its `.d.mts` sibling (`shared/mark.mjs` + `shared/mark.d.mts` is the precedent; `server/test/tsconfig.tests.json` pulls the import in, and `typecheck-tests.test.ts` must stay green).
- **Provenance markers:** `ccd/session-hook.sh` line 2 and `ccd/ccrc` line 2 carry no `# ccrc:generated` marker (measured 2026-09-10: `sed -n 2p`); `ccd/ccd` DOES, and Task 11 edits one comment in it (the purge inventory) and re-stamps it with the command `server/test/ownership.test.ts` prescribes — `ownership.test.ts` is red until the re-stamp lands. Check with `sed -n 2p <file>` before assuming that for any other file.
- **No absolute repo paths in this plan or in any tracked file it edits** (lesson recorded 2026-09-09, crossrepo-programmes).

## File structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `ccd/session-hook.sh` | constants block; `_hook_compact_scope` — the liveness rule (§3.0); `_hook_write_atomic`; `_hook_compact_pre` with the overlap check (§3.1); `_hook_compact_card` — the nonce pair — and the two-clip emitter (§3.3); `_hook_compact_post` with the set age bound, hookstate read-back/writer for `compaction` (§3.4); the header's R2 sentence | 2, 6, 7, 9 |
| `ccd/compact-card.mjs` | the helper: `card` (window, mining, resolution, ranking, rendering, set) and `measure` (normalisation, fields, `cited`); CLI + exit codes | 3, 4, 5, 8 |
| `ccd/compact-card.d.mts` | the helper's types for the vitest import | 3 (extended in 4, 5, 8) |
| `server/test/compactCardFixtures.ts` | shared fixture builders: transcript lines, the five-file graph, `graphJson()` | 1 |
| `server/test/compact-card.test.ts` | the helper's unit tests | 3, 4, 5, 8 |
| `server/test/session-hook.test.ts` | the hook's tests: `plantSession`, `plantHelper`, `plantGraph({content})`, the four describes | 1, 2, 6, 7, 9 |
| `deploy/deploy.sh`, `ccd/ccrc`, `server/test/installTreeFixture.ts`, `server/test/ccrc-install.test.ts`, `server/test/compact-card-ship.test.ts` | install the helper beside the hook, backed up like the hook; the fixture tree ships it; pins | 10 |
| `README.md`, `ccd/ccd` (the purge inventory comment, re-stamped), the spec's status line | the operator-facing paragraph; the inventory names the three files; "Plan A written" | 11 |

**Task order and why.** 1 (fixtures) → 2 (the liveness rule, the overlap check and the hook-written set: the smallest end-to-end slice, no helper yet) → 3, 4, 5 (the helper's `card`, bottom up: window → mining/resolution → rendering/files) → 6 (the hook invokes the helper) → 7 (SessionStart serves the card) → 8 (the helper's `measure`) → 9 (PostCompact measures, hookstate, journal) → 10 (ship) → 11 (docs). Each task leaves the suite green.

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
/** The card file: line 1 is the set's `at` (the nonce, spec §3.2), the rest the text. */
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

**Files:**
- Modify: `ccd/session-hook.sh` — a constants block after `CARD_MAX_CHARS=2400`; three functions after `_hook_hold_card` (before `[[ -n "${HOME:-}" ]] || exit 0`); one call site before the final `exit 0`
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — which context is compacting (spec §3.0)')`

**Interfaces:**
- Produces: `_hook_compact_scope <transcript_path> <trigger>` → sets `CS_SCOPE` (`main` | `subagent` | `ambiguous`), `CS_TRANSCRIPT` (empty for ambiguous), `CS_AGENT` (empty unless subagent), `CS_LIVE_N` (the live-agent count; empty on a manual trigger), `CS_PARENT_LIVE` (`true`/`false` when it decided, else empty); rc 1 = nothing may be said. `_hook_write_atomic <path> <text>` → rc 0 written whole, 1 nothing left behind; temp `$REG/.<id>.<pid>.<suffix>.tmp`. `_hook_compact_pre` → the overlap check, the stale-temp sweep, then writes `$REG/<id>.compactset` (`at` the nonce; `files:null` — NOT MINED; `served:false`) and stops for `ambiguous`; Task 6 extends it with the helper call. Constants `COMPACT_CARD_OFF`, `COMPACT_HELPER`, `COMPACT_CARD_MAX_CHARS`, `CARD_TOTAL_MAX_CHARS`, `COMPACT_CARD_MAX_AGE`, `COMPACT_LIVE_S`, `COMPACT_HELPER_TIMEOUT`, `COMPACT_WORKSET_MAX`, `COMPACT_SHAPE_PRED`.
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
      cwd: tree, built: null, fresh: null, steered: false, served: false, files: null, stats: null });
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
    fs.writeFileSync(cardFile(), `${readSet().at}\ngraphify card — planted\n`);
    run(preCompact(tree, transcript, 'auto'));            // a second compaction, the first unfinished
    expect(readSet()).toMatchObject({ scope: 'ambiguous', transcript: null });
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

In `ccd/session-hook.sh`, immediately after the line `CARD_MAX_CHARS=2400` (and before the `# BOUNDED AND ANCHORED.` comment that introduces `CCRC_PROJ_CLASS`), insert:

```bash
# ── THE COMPACTION CARD (spec 2026-09-09-graphify-compaction-card-design.md) ──
# Three registry files per session, every suffix DOT-FREE so `_reg_purge`'s
# loop (`ccd/ccd`: every dot-free `$REG/<id>.<suffix>` except `archived` and
# `reaping`) unlinks them with the row: `.compactset` (PreCompact writes it,
# PostCompact consumes it), `.compactcard` (PreCompact writes it when the tree
# has a graph the gate would trust; SessionStart(compact) serves it ONCE and
# deletes it), `.compactions` (the per-session journal PostCompact appends,
# never read here). The same dot-free shape is what `_ws_slug_free` scans, so
# every arm removes what it will not serve — an aged card, an aged set — and
# PreCompact sweeps this id's stale `.compact*.tmp` temps, which lead with a
# dot and are therefore invisible to `_reg_purge`.
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
# THE IN-FLIGHT WINDOW. A card or a set older than this belongs to no
# compaction that can still arrive and is removed unread; an unconsumed set
# YOUNGER than this at PreCompact means another compaction of this session is
# in flight (spec §3.0, overlap). Argued from the longest compaction measured
# on this fleet — 826 s, gpt lane, 2026-09-08 — times 1.45.
COMPACT_CARD_MAX_AGE=1200
# LIVENESS (spec §3.0). A transcript written inside this window is a live
# context. Measured: a working agent writes a row every 4–6 s and pauses over
# 79 s in 1–2% of rows; a compacting context writes nothing for ≥79 s; a parent
# waiting on a fan-out writes nothing at all; and at its own auto-compaction the
# parent's last row is 0.8 s old at p50, 3.7 s at p95, never 120 s (n=216).
# Used as `find -mmin` minutes.
COMPACT_LIVE_S=120
# THE ONE WAIT THIS FILE ALLOWS (spec §6, amendment R2 of the header's
# contract): both helper calls run under `timeout` for at most this many
# seconds, off the hot path — PreCompact and PostCompact bracket a compaction
# of at least 79 s — and after the hookstate write has landed. Argued from
# measured inputs (node startup ~0.05 s, a 70 MB graph parsed and indexed in
# ~1.5 s, a 16 MiB window mined in well under a second through a basename
# index) at roughly twice their sum, and RE-MEASURED on this box's real graphs
# before it shipped — the p95 and peak RSS are recorded here by Task 6 of
# plans/2026-09-10-graphify-compaction-card-plan-a.md: <p95> s / <RSS> MB.
COMPACT_HELPER_TIMEOUT=8
COMPACT_WORKSET_MAX=12
# ONE SPELLING of the shape a `compaction` object must have to reach
# `--argjson` (spec §3.4, "shape gates, both directions"): the helper's stdout
# passes it before the hook adds `n`, and the value read back from hookstate
# passes it again before it is re-emitted. Anything else degrades to `null`
# AND THE WRITE PROCEEDS — a hook that writes nothing is the worst shape this
# file can fail in (header). Concatenated into two jq programs; never re-spelled.
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
  local tp="" trig="" set="$REG/$id.compactset" cardf="$REG/$id.compactcard" doc="" at="" rc=0
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
    CS_SCOPE="ambiguous"; CS_TRANSCRIPT=""; CS_AGENT=""
  fi
  [[ "$CS_SCOPE" != ambiguous ]] || rm -f "$cardf"
  # THE SWEEP. A helper killed by `timeout` between its temp write and its
  # rename leaves `.<id>.<name>.<pid>.tmp`, which leads with a dot and is
  # therefore invisible to `_reg_purge`; nothing else would ever remove it.
  # Only THIS id's compaction temps, only older than the window — a young one
  # may belong to a helper in flight.
  find "$REG" -maxdepth 1 -name ".$id.*compact*.tmp" -mmin "+$mins" -delete 2>/dev/null || true
  rc=0; _hook_graph_measure || rc=$?
  at=$(_hook_epoch_ms)
  # THE HOOK'S OWN SET. `at` is the nonce the card will be paired on (§3.3).
  # `files:null` is NOT MINED, which the helper's `files:[]` (mined, empty)
  # must never be read as — two conditions, two values. Written BEFORE the
  # graph gates, so PostCompact has the scope on a tree with no graph at all;
  # `built`/`fresh` are measured first so the journal carries them either way;
  # `parentLive`/`liveAgents` are what the rule saw, null where it did not look;
  # `served` is stamped by SessionStart(compact) after a successful emit.
  doc=$(jq -cn --arg scope "$CS_SCOPE" --arg agent "$CS_AGENT" --arg t "$CS_TRANSCRIPT" \
      --arg pl "$CS_PARENT_LIVE" --arg ln "$CS_LIVE_N" \
      --arg cwd "$GM_CWD" --arg built "$GM_BUILT" --arg fresh "$GM_FRESH" --argjson at "$at" \
      '{v:1, at:$at, scope:$scope, agent:(if $agent=="" then null else $agent end),
        transcript:(if $t=="" then null else $t end),
        parentLive:(if $pl=="true" then true elif $pl=="false" then false else null end),
        liveAgents:(if $ln=="" then null else ($ln|tonumber) end),
        cwd:(if $cwd=="" then null else $cwd end),
        built:(if $built=="" then null else $built end),
        fresh:(if $fresh=="" then null else $fresh end),
        steered:false, served:false, files:null, stats:null}' 2>/dev/null) || return 0
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

- [ ] **Step 7: Mutation checks (each: mutate, run the same command, see the named case red, `git checkout -- ccd/session-hook.sh`)**

1. In `_hook_compact_scope`, delete `-mmin "-$mins"` from the agents' `find` → `a DEAD agent file beside a live parent is main` goes red (the dead file now counts).
2. Delete the parent-liveness line (`if [ -n "$(find "$tp" …` → `ambiguous`) → the first half of `two live contexts are AMBIGUOUS` goes red (it answers subagent).
3. Replace `find "$dir" -name 'agent-*.jsonl'` with `find "$dir" -maxdepth 1 -name 'agent-*.jsonl'` → `finds a Workflow agent one directory deeper` goes red.
4. Delete the `if [[ "$trig" == manual ]]` line → `a MANUAL trigger is main` goes red.
5. Delete the overlap `if [ -n "$(find "$set" …` block → the OVERLAP test goes red (scope stays main, the card survives).
6. Delete the sweep `find "$REG" -maxdepth 1 …` line → `sweeps this id's STALE compaction temps` goes red; change `-mmin "+$mins"` to `-mmin "-$mins"` → the `young` assertion goes red.
7. Delete `command -v find >/dev/null 2>&1 || return 1` → `with no find on PATH` goes red (a set is written, scope `main`).
8. Delete the line `[ -e "$COMPACT_CARD_OFF" ] && return 0` in `_hook_compact_pre` → `the operator file … silences the arm` goes red.
9. Change `files:null` to `files:[]` in the jq program → the first test's `files: null` goes red; change `liveAgents:(…)` to `liveAgents:0` → the fan-out half of the AMBIGUOUS test goes red.
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
- Produces: `EXIT = {OK:0, FAILURE:1, USAGE:2, EMPTY:3}`, `WINDOW_CAP` (16 MiB), `CHUNK` (1 MiB), `isBoundaryLine(line)`, `readWindow(path, cap?, chunk?)` → `{text, boundary}` (the chunk size is a parameter so a test can build a deterministic chunk-edge straddle), `parseArgs(argv)` → `{cmd, opts}` | `{error}`; the CLI `node compact-card.mjs <card|measure> --flag value …` with exit 2 on usage (`card` requires `--transcript --cwd --graph --labels --out --set --max-chars --max-files --built --fresh --scope --at`). `main` dispatches `card` to `cardCommand` (Task 5) and `measure` to `measureCommand` (Task 8); until those land, both subcommands exit 1 through the catch — no test asks for them before their task.

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

const REQUIRED_CARD = ['transcript', 'cwd', 'graph', 'labels', 'out', 'set', 'maxChars', 'maxFiles', 'built', 'fresh', 'scope', 'at'];

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
      if (!Number.isInteger(at) || at <= 0) return usage('--at must be the set\'s epoch-ms nonce');
      return cardCommand({ transcript: o.transcript, cwd: o.cwd, graph: o.graph, labels: o.labels,
        out: o.out, set: o.set, maxChars, maxFiles, built: o.built, fresh: o.fresh,
        scope: o.scope, agent: o.agent ?? null, at });
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

- [ ] **Step 6: Mutation checks** (mutate `ccd/compact-card.mjs`, run the file, see the case red, `git checkout -- ccd/compact-card.mjs`)

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
- Produces: `GRAPH_MAX_BYTES` (96 MiB), `loadGraph(path, maxBytes?)` → `{nodes: Map, byFile: Map, files: Set, index: FileIndex, links, degree: Map}` (throws `too large` above the cap, before parsing), `loadLabels(path)` → object (empty on absence), `fileFacts(file, graph, labels, workset: Set)` → `{community, symbols, usedBy}`, `renderCard(set, graph, labels, {maxChars, maxFiles, built, fresh, scope, agent})` → string, `slotIsMine(setPath, at)` → the set on disk when its `at` is ours, else null, `cardCommand(o)` → exit code; the set file shape `{v, at, scope, agent, transcript, parentLive, liveAgents, cwd, built, fresh, steered, served, files, stats}` with `at` and `transcript` BEFORE `files` (the hook reads the head of the file, Task 7), `parentLive`/`liveAgents`/`served` CARRIED from the hook's set, and `steered` always `false` here (the hook stamps it, Plan C).

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
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'deadbeefcafe',
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
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null, files };
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
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null,
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
   *  slot the helper must find its own `at` in, and the fields it carries. */
  const hookSet = (set: string, at: number, extra: object = {}): void =>
    fs.writeFileSync(set, JSON.stringify({ v: 1, at, scope: 'main', agent: null, transcript: '/t', parentLive: null, liveAgents: 0,
      cwd: dir, built: null, fresh: null, steered: false, served: false, files: null, stats: null, ...extra }) + '\n');

  it('cardCommand rewrites the hook\'s set and writes the card, `at` and `transcript` before `files`, the hook\'s fields carried, the nonce as the card\'s first line, and exits 0', () => {
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
    hookSet(set, 1789330000000, { scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1 });
    const rc = cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'deadbeefcafe', fresh: 'fresh', scope: 'subagent', agent: 'a1', at: 1789330000000 });
    expect(rc).toBe(EXIT.OK);
    const s = JSON.parse(fs.readFileSync(set, 'utf8'));
    expect(Object.keys(s)).toEqual(['v', 'at', 'scope', 'agent', 'transcript', 'parentLive', 'liveAgents', 'cwd', 'built', 'fresh', 'steered', 'served', 'files', 'stats']);
    expect(s).toMatchObject({ v: 1, at: 1789330000000, scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1,
      cwd: dir, built: 'deadbeefcafe', fresh: 'fresh', steered: false, served: false,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'edited', count: 1 },
              { path: 'server/src/watch.ts', tag: 'touched', count: 1 },
              { path: 'pwa/src/lib/models.ts', tag: 'carried', count: 1 }],
      stats: { tokens: 4, resolved: 3, ambiguous: 0, outside: 1, nomatch: 0 } });
    const card = fs.readFileSync(out, 'utf8').split('\n');
    expect(card[0]).toBe('1789330000000');                                            // the nonce
    expect(card[1]).toContain('(subagent a1)');
    expect(card[2]).toBe('- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseCtxPct:L105 parseStatusline:L132 · used by server/src/fleet.ts');
    expect(fs.readdirSync(path.join(dir, 'reg')).sort()).toEqual(['x.compactcard', 'x.compactset']);   // no temp left
  });

  it('THE SLOT CHECK: a set whose `at` is not the helper\'s, or no set at all, is refused — exit 1, nothing written', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    const args = { transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12, built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, at: 7 };
    expect(() => cardCommand(args)).toThrow(/slot/);                 // no set: the hook always writes one first
    hookSet(set, 8, { scope: 'ambiguous', transcript: null });          // an overlapping PreCompact took the slot
    const before = fs.readFileSync(set, 'utf8');
    expect(() => cardCommand(args)).toThrow(/slot/);
    expect(fs.readFileSync(set, 'utf8')).toBe(before);
    expect(fs.existsSync(out)).toBe(false);
    expect(slotIsMine(set, 8)).not.toBeNull();
    expect(slotIsMine(set, 7)).toBeNull();
    expect(slotIsMine(path.join(dir, 'absent'), 7)).toBeNull();
  });

  it('an empty working set writes the set with files [] and NO card, exit 3', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.user('hello') + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    expect(cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: '', fresh: '', scope: 'main', agent: null, at: 1 })).toBe(EXIT.EMPTY);
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
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1 })).toThrow();
    expect(fs.readdirSync(path.join(dir, 'reg')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('as the hook runs it: exit 0 with nothing on stdout; a malformed graph is exit 1 with nothing rewritten; --steer is accepted and changes nothing', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    const args = ['card', '--transcript', transcript, '--cwd', dir, '--graph', graph, '--labels', labels,
      '--out', out, '--set', set, '--max-chars', '4000', '--max-files', '12', '--built', 'b', '--fresh', 'fresh', '--scope', 'main', '--at', '1'];
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

/** THE SLOT CHECK (spec §3.0, overlap). The hook wrote the set before
 *  running this helper; if the set on disk no longer carries this helper's
 *  `at`, an overlapping PreCompact has taken the slot and marked it
 *  ambiguous — this helper must not overwrite that verdict. Re-read
 *  immediately before EACH write; what remains is the interval between the
 *  read and the rename. Returns the set when it is ours (its fields are
 *  carried into the rewrite), else null. */
export function slotIsMine(setPath, at) {
  try {
    const cur = JSON.parse(readFileSync(setPath, 'utf8'));
    return cur && typeof cur === 'object' && cur.at === at ? cur : null;
  } catch {
    return null;
  }
}

/** `card`: window → tokens → working set → set file (always) → card (when
 *  the set is non-empty). Key ORDER in the set is part of the contract: `at`
 *  and `transcript` sit in the first 4 KiB, where the hook reads them with a
 *  bounded, fork-free `read -N` (spec §3.3 step 2). `at` is the hook's nonce
 *  — never Date.now() here — and it is ALSO the card's first line, which is
 *  what pairs a card to its set. `parentLive`, `liveAgents` and `served` are
 *  the hook's and are CARRIED; `steered` is always false here — the hook
 *  stamps it after the print (Plan C), never the helper. A refused slot
 *  throws, which `main` reports as exit 1 with nothing written. */
export function cardCommand(o) {
  const graph = loadGraph(o.graph);
  const labels = loadLabels(o.labels);
  const win = readWindow(o.transcript);
  const re = tokenRegex(extensionsOf(graph.files));
  const tokens = mineTokens(win.text, re);
  const { files, stats } = workingSet(tokens, graph.index, o.cwd);
  const mine = slotIsMine(o.set, o.at);
  if (!mine) throw new Error(`set at ${o.set} is no longer this helper's slot`);
  const set = { v: 1, at: o.at, scope: o.scope, agent: o.agent ?? null, transcript: o.transcript,
    parentLive: typeof mine.parentLive === 'boolean' ? mine.parentLive : null,
    liveAgents: Number.isInteger(mine.liveAgents) ? mine.liveAgents : null,
    cwd: o.cwd, built: o.built || null, fresh: o.fresh || null, steered: false, served: mine.served === true, files, stats };
  writeAtomic(o.set, JSON.stringify(set) + '\n');
  if (files.length === 0) return EXIT.EMPTY;
  const text = renderCard(set, graph, labels, { maxChars: o.maxChars, maxFiles: o.maxFiles,
    built: o.built, fresh: o.fresh, scope: o.scope, agent: o.agent ?? null });
  if (!slotIsMine(o.set, o.at)) throw new Error(`set at ${o.set} changed hands before the card was written — slot taken`);
  writeAtomic(o.out, `${o.at}\n${text}\n`);
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
  v: 1; at: number; scope: 'main' | 'subagent' | 'ambiguous'; agent: string | null; transcript: string | null;
  parentLive: boolean | null; liveAgents: number | null;
  cwd: string | null; built: string | null; fresh: string | null; steered: boolean; served: boolean;
  files: SetFile[] | null; stats: SetStats | null;
}
export function slotIsMine(setPath: string, at: number): CompactSet | null;
export function renderCard(set: CompactSet & { files: SetFile[] }, graph: Graph, labels: Record<string, string>,
  opts: { maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent'; agent: string | null }): string;
export function cardCommand(o: {
  transcript: string; cwd: string; graph: string; labels: string; out: string; set: string;
  maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent';
  agent: string | null; at: number;
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
5. In `cardCommand`, write `text + '\n'` instead of `` `${o.at}\n${text}\n` `` → the `card[0]` nonce assertion goes red; replace `at: o.at` with `at: Date.now()` → the set's `at` assertion goes red.
6. Delete the first `slotIsMine` check (write regardless) → `THE SLOT CHECK` goes red (the ambiguous set is overwritten); delete the second → the same test stays green (the first check already refused) — record that the second check's window is the render's duration, pinned by reading, and the first is the mechanism.
7. In `writeAtomic`'s `catch`, delete the `unlinkSync(tmp)` → `a write that cannot complete leaves no temp behind` goes red.
8. In `loadGraph`, delete the `size > maxBytes` throw → the `too large` assertion goes red.
9. In `cardCommand`, write `steered: o.steer === true` again → the `--steer is accepted and changes nothing` assertion goes red.

- [ ] **Step 6: Commit**

```bash
git add ccd/compact-card.mjs ccd/compact-card.d.mts server/test/compact-card.test.ts
git commit -m "feat(compact-card): the card from the graph — symbols, community, dependents outside the set, blast radius, whole-file truncation that always says what it dropped"
```

---
### Task 6: PreCompact runs the helper — the card with a graph, under the one declared wait (spec §3.1 steps 5–6, §6 R2)

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_compact_pre` (the helper call), the file header's contract sentence, the `COMPACT_HELPER_TIMEOUT` comment (the measured p95 and RSS)
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — PreCompact and the helper (spec §3.1)')`

**Interfaces:**
- Consumes: the helper CLI of Tasks 3–5 (`card` with `--at`), `_hook_gate_tree`, `GM_*`, `COMPACT_HELPER`, `COMPACT_HELPER_TIMEOUT`.
- Produces: after a PreCompact on a gated tree with an unambiguous scope, `$REG/<id>.compactcard` (line 1 = the set's `at`) and the helper-rewritten set; every failure leaves the hook's own set.

- [ ] **Step 1: Write the failing tests** (`minimalPath` and `stub` are Task 1's fixtures)

Append at the end of the file:

```ts
describe('the compaction card — PreCompact and the helper (spec §3.1)', () => {
  it('with a fresh graph and the helper, PreCompact writes the card (nonce first) and the mined set, and prints nothing', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    expect(runFull(preCompact(tree, transcript))).toEqual({ stdout: '', stderr: '' });
    const set = readSet();
    expect(set).toMatchObject({ scope: 'main', transcript, steered: false, served: false, parentLive: null, liveAgents: 0,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'touched', count: 1 },
              { path: 'server/src/watch.ts', tag: 'touched', count: 1 }],
      stats: { tokens: 2, resolved: 2, ambiguous: 0, outside: 0, nomatch: 0 } });
    const card = readCard();
    expect(card.nonce).toBe(String(set.at));
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

  it('the helper runs under `timeout` with the constant, and the argv is the spec\'s', () => {
    const tree = cardTree(); plantHelper();
    stub('timeout', 'printf \'%s\\n\' "$*" > "$HOME/timeout-argv"; shift; exec "$@"');
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const argv = fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8');
    expect(argv.startsWith('8 node ')).toBe(true);
    expect(argv).toContain(' card --transcript ');
    expect(argv).toContain(` --transcript ${transcript} `);
    expect(argv).toContain(' --max-chars 4000 --max-files 12 ');
    expect(argv).toContain(` --scope main --at ${readSet().at}`);
    expect(argv).not.toContain('--steer');                   // stage 1: never
    expect(fs.existsSync(cardFile())).toBe(true);
  });

  it('with no `timeout` on PATH (a BSD userland) the arm is inert past the set — silent on stderr, the state written', () => {
    // A BEHAVIOUR pin, not a guard pin: there is no `command -v timeout` guard,
    // because a missing `timeout` fails the call site exactly as a failing
    // helper does (exit 127, swallowed) and a guard nothing can redden is not a
    // mechanism. What this row holds is the outcome the spec's §4 promises.
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    const r = runFull(preCompact(tree, transcript), { PATH: minimalPath(['timeout']) });
    expect(r).toEqual({ stdout: '', stderr: '' });
    expect(readSet().files).toBeNull();
    expect(fs.existsSync(cardFile())).toBe(false);
    expect(readState().state).toBe('working');
  });

  it('a transcript with no tool calls: the set says mined-empty (files []), no card', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: [tl.user('hello')] });
    run(preCompact(tree, transcript));
    expect(readSet().files).toEqual([]);
    expect(fs.existsSync(cardFile())).toBe(false);
  });

  it('the file header declares the one wait it allows — the R2 amendment', () => {
    const head = fs.readFileSync(HOOK, 'utf8').split('\n').slice(0, 14).join('\n');
    expect(head).toContain('COMPACT_HELPER_TIMEOUT');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PreCompact and the helper"`
Expected: FAIL — no card is ever written (the helper is never called), the header test fails.

- [ ] **Step 3: The helper call**

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
  # helper beside this file. `node` and `timeout` are NOT guarded: a missing
  # one fails the call below exactly as a failing helper does (exit 127,
  # swallowed), and a guard whose removal changes nothing observable is not a
  # guard. On a userland with no `timeout` (BSD) the helper never runs, the
  # set is consumed by PostCompact, and the journal stays empty — spec §4.
  [ "$rc" -eq 0 ] && _hook_gate_tree || return 0
  [ -f "$COMPACT_HELPER" ] || return 0
  # THE ONE WAIT (spec §6, R2): at most COMPACT_HELPER_TIMEOUT seconds, after
  # the hookstate rename, bracketing a compaction of at least 79 s. Exit 0
  # wrote the card and rewrote the set; exit 3 rewrote the set with files [];
  # anything else — 1 (a refused slot, an oversized graph, a failure), 2, 124
  # from timeout, 127 — leaves the hook's own set standing. Nothing is printed
  # on any path (stage 1). `--steer` is never passed here: the print and its
  # `steered` stamp are Plan C's.
  timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" card \
    --transcript "$CS_TRANSCRIPT" --cwd "$GM_CWD" \
    --graph "$GM_CWD/graphify-out/graph.json" \
    --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
    --out "$cardf" --set "$set" \
    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
    --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$CS_SCOPE" --at "$at" \
    ${CS_AGENT:+--agent "$CS_AGENT"} >/dev/null 2>&1 || true
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
# all, no network, no locks, no waiting — with ONE declared exception (the
# compaction-card spec, §6 amendment R2): the PreCompact and PostCompact arms
# wait on `~/.cc-sessions/compact-card.mjs` under `timeout` for at most
# COMPACT_HELPER_TIMEOUT seconds, off the hot path (each brackets a compaction
# of at least 79 s) and only after the hookstate write has landed. A hook that
# can slow or break a session is worse than no hook.
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PreCompact and the helper"`
Expected: PASS — every test of the describe.

- [ ] **Step 6: MEASURE the helper on this box's real graphs, and record it in the constant's comment**

The spec pins `COMPACT_HELPER_TIMEOUT` = 8 from measured inputs and requires the p95 and peak RSS on the fleet's real graphs before it ships (spec §3.1, §2). This box IS the fleet box. Against a scratch `$REG` under the scratchpad (never the live `~/.cc-sessions`), with this worktree's own `graphify-out/graph.json` (~9 MB) and the largest graph on the box (`find ~/worktrees ~/projects /mnt -maxdepth 6 -path '*/graphify-out/graph.json' -size +20M 2>/dev/null` — MekWarLive's ~70 MB is the expected answer; read-only), run five times each:

```bash
S=<scratchpad>/helper-measure; mkdir -p "$S"
T=<this session's own transcript path>
printf '{"v":1,"at":1,"scope":"main","agent":null,"transcript":"%s","parentLive":null,"liveAgents":0,"cwd":"%s","built":null,"fresh":null,"steered":false,"served":false,"files":null,"stats":null}\n' "$T" "$PWD" > "$S/x.compactset"
/usr/bin/time -v node ccd/compact-card.mjs card --transcript "$T" --cwd "$PWD" \
  --graph <graph.json> --labels <its .graphify_labels.json> --out "$S/x.compactcard" --set "$S/x.compactset" \
  --max-chars 4000 --max-files 12 --built x --fresh fresh --scope main --at 1 2>&1 | grep -E 'Elapsed|Maximum resident'
```

Record the p95 elapsed and the peak RSS for each graph in the `COMPACT_HELPER_TIMEOUT` comment (replace `<p95> s / <RSS> MB`). **Acceptance: p95 ≤ 4 s on the largest graph.** If it is not, STOP and report — do not raise the constant; the spec's cost argument is what is wrong.

- [ ] **Step 7: Mutation checks**

1. Delete the `timeout "$COMPACT_HELPER_TIMEOUT"` prefix (run `node` bare) → `the helper runs under timeout` goes red (no argv file).
2. Replace `--transcript "$CS_TRANSCRIPT"` with `--transcript "$tp"` → `a subagent's card is mined from ITS transcript` goes red (fleet.ts on the card).
3. Delete `[ "$rc" -eq 0 ] && _hook_gate_tree || return 0` → `a graph further behind HEAD` goes red (a card appears).
4. Delete `[ -f "$COMPACT_HELPER" ] || return 0` → no test reds (node fails on the missing file with the same outcome); the line is a short-circuit that saves a fork on an undeployed box, recorded here as unpinned by design.

- [ ] **Step 8: Run the whole file, then commit**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: PASS — including `prints NOTHING on every other event`, whose PreCompact row now runs with a graph in the tree.

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): PreCompact runs compact-card.mjs under the one declared wait, measured on this box's graphs — the card with a graph, the set either way (spec §3.1, R2)"
```

---

### Task 7: SessionStart(compact) serves the card once, to its set (spec §3.3)

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_emit_context` (two arguments, two clips), a new `_hook_compact_card` after `_hook_compact_pre`, the SessionStart arm
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — SessionStart(compact) (spec §3.3)')`, and the existing `is printed for compact too` row unchanged

**Interfaces:**
- Produces: `_hook_compact_card` → sets `CARD_COMPACT` (the card text without its nonce line, clipped) or leaves it empty; `_hook_emit_context <standing> [<compact>]` — clips `<standing>` at `CARD_MAX_CHARS`, appends `<compact>` clipped at `COMPACT_CARD_MAX_CHARS` with a one-space join, clips the sum at `CARD_TOTAL_MAX_CHARS`, prints ONE line, and now returns 1 when its `jq` could not build the envelope (callers that ignore the code are unchanged); `_hook_compact_served` → stamps `served: true` into the set, called by the arm only after the emitter printed a card.
- Consumes: the card and set files of Task 6; `COMPACT_CARD_MAX_AGE`, `COMPACT_CARD_MAX_CHARS`, `CARD_TOTAL_MAX_CHARS`.

- [ ] **Step 1: Write the failing tests**

Append at the end of `server/test/session-hook.test.ts`:

```ts
describe('the compaction card — SessionStart(compact) (spec §3.3)', () => {
  /** A card+set pair on disk exactly as Task 6 leaves them, without running
   *  the helper: `at` is the nonce, the card's first line. */
  const plantPair = (at: number, text: string, opts: { nonce?: string; setAt?: number } = {}): void => {
    fs.writeFileSync(setFile(), JSON.stringify({ v: 1, at: opts.setAt ?? at, scope: 'main', agent: null,
      transcript: '/t.jsonl', parentLive: null, liveAgents: 0, cwd: null, built: null, fresh: null,
      steered: false, served: false, files: null, stats: null }) + '\n');
    fs.writeFileSync(cardFile(), `${opts.nonce ?? String(at)}\n${text}\n`);
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
    expect(readSet().at, 'the stamp rewrites nothing else').toBe(Number(nonce));
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
# is the set's own — line 1 of the card is the set's `at` — and consumes it.
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
  [[ "$head" =~ \"at\":([0-9]+) ]] || return 0
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
3. Delete `text="${text:0:$CARD_TOTAL_MAX_CHARS}"` and `${2:0:$COMPACT_CARD_MAX_CHARS}`'s slice → `a pathological card` goes red.
4. Delete `[[ "$line1" == "$nonce" ]] || return 0` → `a crossed pair` goes red (served).
5. Delete the age `find` line → `an aged card is REMOVED` goes red (served).
6. Delete `rm -f "$f"` → `consume-once` goes red.
7. Drop the `[[ "$src" == compact ]] &&` guard on `_hook_compact_card` → `never serves it on startup, resume or clear` goes red.
8. Delete the `_hook_compact_served || true` call → the `served … stamped` assertion goes red; call it BEFORE the emitter instead → change the emitter's jq to `jq -cn --arg c "$text" 'garbage'` in the same mutation and the first test's `served` assertion goes red (a stamp for a card that never printed).
9. Delete `[ -e "$COMPACT_CARD_OFF" ] && return 0` in `_hook_compact_card` → `the operator file silences the fourth subject` goes red.

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
    const set = { v: 1, at: 1, scope: 'subagent', agent: 'a1', transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: true,
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
    const set = write('s.compactset', JSON.stringify({ v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: null, built: null, fresh: null, steered: false, served: false, files: [], stats: null }) + '\n');
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

/** The measurement object the hook merges into hookstate (after adding `n`)
 *  and appends to the journal. null — never 0, never "main" — wherever the
 *  set could not say: no set, or a set with `files: null`. */
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

### Task 9: PostCompact measures, hookstate carries `compaction`, the journal fills (spec §3.4)

**Files:**
- Modify: `ccd/session-hook.sh` — a new `_hook_compact_post` after `_hook_compact_card`; the hookstate read-back (a sixth positional line); the reset line; the writer; one call site after the `SubagentStart|SubagentStop` block
- Test: `server/test/session-hook.test.ts` — new `describe('the compaction card — PostCompact and the journal (spec §3.4)')`, and the reset tests mirrored from D-1248's

**Interfaces:**
- Produces: hookstate member `compaction` (the measurement plus `n`, or `null`), read back on every event, reset to `null` on a non-resume SessionStart; `$REG/<id>.compactions` — one JSON line per measured compaction, the measurement plus `cwd`, `built`, `agent`, `transcript`; the set consumed on EVERY path once it is this compaction's (helper missing, `node`/`timeout` missing, helper failing, shape gate refusing).
- Consumes: the helper's `measure` (Task 8), `COMPACT_SHAPE_PRED`, `COMPACT_CARD_MAX_AGE`, `$trig` (set by the PostCompact arm), the read-back variables.

- [ ] **Step 1: Write the failing tests**

Append at the end of `server/test/session-hook.test.ts`:

```ts
describe('the compaction card — PostCompact and the journal (spec §3.4)', () => {
  const F = '\x60\x60\x60';                                         // a fence, never literal in a test file
  const SUMMARY = `<analysis>scratch</analysis>\n1. Primary Request and Intent:\nfix the parser\n3. Files and Code Sections:\n- server/src/pane/statusline.ts — the parser\n${F}ts\nx\n${F}\n4. Errors and fixes:\nnone`;
  const NORMALISED = `1. Primary Request and Intent:\nfix the parser\n3. Files and Code Sections:\n- server/src/pane/statusline.ts — the parser\n${F}ts\nx\n${F}\n4. Errors and fixes:\nnone`;
  const readJournal = (): any[] => fs.readFileSync(journalFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('measures the summary the session sees, writes compaction with n=1, appends the journal line, consumes the set', () => {
    const tree = cardTree(); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const set = readSet();
    expect(runFull(postCompact(tree, transcript, SUMMARY))).toEqual({ stdout: '', stderr: '' });
    const s = readState();
    expect(s.state).toBe('done');
    expect(s.compaction).toMatchObject({ n: 1, trigger: 'manual', scope: 'main', chars: NORMALISED.length, fences: 1,
      cited: 1, setSize: 2, steered: false, served: false });
    expect(s.compaction.filesChars).toBe(`3. Files and Code Sections:\n- server/src/pane/statusline.ts — the parser\n${F}ts\nx\n${F}\n`.length);
    expect(readJournal()).toEqual([{ ...s.compaction, cwd: tree, built: set.built, agent: null, transcript }]);
    expect(fs.existsSync(setFile()), 'the set is consumed').toBe(false);
  });

  it('<summary> is REPLACED, not unwrapped — the Summary: line is counted', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', '<summary>\n  Hello world\n</summary>'));
    expect(readState().compaction.chars).toBe('Summary:\nHello world'.length);
  });

  it('without a set: scope, cited and setSize are null — not 0, not main; the journal line carries nulls', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', 'x'));
    expect(readState().compaction).toMatchObject({ n: 1, scope: null, cited: null, setSize: null, chars: 1 });
    expect(readJournal()[0]).toMatchObject({ cwd: null, built: null, agent: null, transcript: null });
  });

  it('a set with files null (no graph) keeps scope and built; cited and setSize stay null', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    run(postCompact(tree, transcript, 'x'));
    expect(readState().compaction).toMatchObject({ scope: 'main', cited: null, setSize: null });
    expect(readJournal()[0]).toMatchObject({ transcript, built: null, cwd: tree });
  });

  it('a subagent scope and an ambiguous scope land in hookstate and the journal', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    const sub = plantSession({ lines: workLines(tree), parentAge: DEAD, subagents: [{ id: 'a1', lines: [tl.user('x')], age: LIVE }] });
    run(preCompact(tree, sub.transcript, 'auto'));
    run(postCompact(tree, sub.transcript, 'x', 'auto'));
    expect(readState().compaction).toMatchObject({ scope: 'subagent', trigger: 'auto' });
    expect(readJournal()[0]).toMatchObject({ scope: 'subagent', agent: 'a1', transcript: sub.agents['a1'] });
    const amb = plantSession({ sid: 'sess-2', lines: workLines(tree), parentAge: LIVE, subagents: [{ id: 'a1', lines: [tl.user('x')], age: LIVE }] });
    run(preCompact(tree, amb.transcript, 'auto'));
    run(postCompact(tree, amb.transcript, 'x', 'auto'));
    expect(readState().compaction).toMatchObject({ n: 2, scope: 'ambiguous', cited: null });
    expect(readJournal()[1]).toMatchObject({ scope: 'ambiguous', agent: null, transcript: null });
  });

  it('an AGED set is removed and never read — the measurement says no set', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    const old = Math.floor(Date.now() / 1000) - 1200 - 60;
    fs.utimesSync(setFile(), old, old);
    run(postCompact(tree, transcript, 'x'));
    expect(readState().compaction).toMatchObject({ scope: null, setSize: null });
    expect(fs.existsSync(setFile())).toBe(false);
  });

  it('n is the journal\'s own count: two compactions, n 2, two lines, hookstate agrees', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', 'a'));
    run(postCompact(tree, '', 'bb'));
    expect(readState().compaction).toMatchObject({ n: 2, chars: 2 });
    expect(readJournal().map((l) => l.n)).toEqual([1, 2]);
  });

  it('well-formed JSON of the WRONG shape, garbage, or a failing helper each carry the previous compaction and write no line — the state is still written', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', 'first'));
    // parses, starts with `{`, and is NOT the pinned shape: only COMPACT_SHAPE_PRED stops it
    stub('node', 'printf \'{"chars":"17k","n":1}\\n\'; exit 0');
    run(postCompact(tree, '', 'second', 'auto'));
    expect(readState()).toMatchObject({ state: 'working', event: 'PostCompact' });
    expect(readState().compaction).toMatchObject({ n: 1, chars: 5 });
    stub('node', 'printf \'not json\\n\'; exit 0');
    run(postCompact(tree, '', 'third', 'auto'));
    expect(readState().compaction).toMatchObject({ n: 1, chars: 5 });
    stub('node', 'exit 1');
    run(postCompact(tree, '', 'fourth', 'auto'));
    expect(readState().compaction).toMatchObject({ n: 1, chars: 5 });
    expect(readJournal()).toHaveLength(1);
  });

  it('a failing helper still CONSUMES the set — the next compaction is not ambiguous for it; and a missing helper consumes it too', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    const { transcript } = plantSession({ lines: workLines(tree) });
    run(preCompact(tree, transcript));
    stub('node', 'exit 1');
    run(postCompact(tree, transcript, 'x'));
    expect(fs.existsSync(setFile()), 'consumed on the failure path').toBe(false);
    expect(readState().compaction).toBeNull();
    fs.rmSync(path.join(home, 'bin', 'node'));
    run(preCompact(tree, transcript));
    fs.rmSync(path.join(home, '.cc-sessions', 'compact-card.mjs'));
    run(postCompact(tree, transcript, 'x'));
    expect(fs.existsSync(setFile()), 'consumed when the helper is missing').toBe(false);
    expect(readState().compaction).toBeNull();
  });

  it('the journal that cannot be appended leaves hookstate untouched — n never runs ahead of the journal', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    fs.mkdirSync(journalFile());                                   // a DIRECTORY at the journal's name
    run(postCompact(tree, '', 'hello'));
    expect(readState()).toMatchObject({ state: 'done', compaction: null });
  });

  it('the shape predicate is spelled once and used twice — the helper gate and the read-back', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src.match(/^COMPACT_SHAPE_PRED=/gm)).toHaveLength(1);
    expect(src.match(/\$COMPACT_SHAPE_PRED/g)?.length).toBe(2);
  });

  it('a corrupt compaction on disk reads back null and the write proceeds', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const hs = readState();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...hs, compaction: 'garbage' }));
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    expect(readState()).toMatchObject({ state: 'working', compaction: null });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...hs, compaction: { chars: '17k', n: 1 } }));
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    expect(readState().compaction).toBeNull();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...hs, compaction: { n: 1, at: 1, trigger: 'auto', scope: 'main', chars: 5, filesChars: null, fences: 0, cited: null, setSize: null, steered: false } }));
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    expect(readState().compaction).toMatchObject({ n: 1, chars: 5 });
  });

  it('is carried across events and subagent events, kept on resume and compact, reset on startup, clear and a source-less SessionStart (D-1248)', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', 'hello'));
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    run({ hook_event_name: 'Stop' });
    expect(readState().compaction.chars).toBe(5);
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().compaction.chars).toBe(5);
    run({ hook_event_name: 'SessionStart', source: 'compact' });      // writes nothing (D-306)
    expect(readState().compaction.chars).toBe(5);
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(readState().compaction).toBeNull();
    run(postCompact(tree, '', 'hello'));
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    expect(readState().compaction).toBeNull();
    run(postCompact(tree, '', 'hello'));
    run({ hook_event_name: 'SessionStart' });
    expect(readState().compaction).toBeNull();
  });

  it('the operator file: no measurement, no journal line, the previous compaction carried, the state still written', () => {
    const tree = path.join(home, 'tree'); gitTree(tree, 1); plantHelper();
    run(postCompact(tree, '', 'first'));
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
    run(postCompact(tree, '', 'second', 'auto'));
    expect(readState()).toMatchObject({ state: 'working', event: 'PostCompact' });
    expect(readState().compaction).toMatchObject({ n: 1, chars: 5 });
    expect(readJournal()).toHaveLength(1);
  });

  it('a session that never compacted carries compaction null, and every event re-emits the member', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState()).toHaveProperty('compaction', null);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PostCompact and the journal"`
Expected: FAIL — `readState().compaction` is undefined everywhere.

- [ ] **Step 3: `_hook_compact_post`** — insert after `_hook_compact_card`

```bash
# ── PostCompact (spec §3.4): MEASURE THE SUMMARY THE SESSION WILL SEE ─────
# Runs after the hookstate read-back (it needs the carried `comp`) and before
# the writer. Sets `comp` — the `compaction` member — and appends the journal;
# on ANY failure `comp` is CARRIED unchanged and no line is written: a
# measurement that did not happen is not a zero. Never resolves the scope
# (§3.0): the scope is the set's. The set is this compaction's only inside
# the in-flight window; an older one was left by a compaction that never
# finished — removed, never read (a dot-free registry file that outlives its
# use would hold the slug).
_hook_compact_post() {
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local set="$REG/$id.compactset" jf="$REG/$id.compactions" m="" n="" line="" extra=""
  local -a sa=()
  jq -e '(.compact_summary|type)=="string"' <<<"$payload" >/dev/null 2>&1 || return 0
  command -v find >/dev/null 2>&1 || return 0
  # THE SET IS SETTLED FIRST, before any tool guard (spec §3.4): an aged one
  # was left by a compaction that never finished — removed, never read; a
  # young one is this compaction's, its journal fields are read NOW, and it is
  # CONSUMED on every path from here — a set that outlived its compaction
  # would mark the next one `ambiguous` for no reason.
  if [[ -f "$set" && -r "$set" ]]; then
    if [ -n "$(find "$set" -mmin "-$(( COMPACT_CARD_MAX_AGE / 60 ))" 2>/dev/null)" ]; then
      sa=(--set "$set")
      extra=$(jq -c '{cwd:.cwd, built:.built, agent:.agent, transcript:.transcript}' "$set" 2>/dev/null) || extra=""
      [[ "$extra" == \{* ]] || extra='{"cwd":null,"built":null,"agent":null,"transcript":null}'
    else
      rm -f "$set"
    fi
  fi
  [ -n "$extra" ] || extra='{"cwd":null,"built":null,"agent":null,"transcript":null}'
  # From here every exit consumes the set. `node` and `timeout` are not
  # guarded (a missing one fails the pipeline like a failing helper, exit 127
  # swallowed); the helper file is, to save a fork on an undeployed box.
  if [ ! -f "$COMPACT_HELPER" ]; then rm -f "$set"; return 0; fi
  # `jq -r` appends one newline; the helper trims before it measures. A PIPE,
  # not a process substitution: under `pipefail` a failed jq fails the
  # pipeline and this arm stops — a zero is never recorded for a summary that
  # was never read.
  m=$(jq -r '.compact_summary' <<<"$payload" 2>/dev/null \
      | timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" measure "${sa[@]}" --trigger "$trig" 2>/dev/null) \
      || { rm -f "$set"; return 0; }
  rm -f "$set"
  # SHAPE GATE, direction one (spec §3.4): exactly one object of the pinned
  # shape, or nothing — exit 0 with garbage, or with well-formed JSON of the
  # wrong shape, carries the previous value.
  m=$(jq -c 'if '"$COMPACT_SHAPE_PRED"' then . else empty end' <<<"$m" 2>/dev/null) || return 0
  [[ "$m" == \{* ]] || return 0
  # `n` IS THE JOURNAL'S OWN COUNT plus one — computed here, never by the
  # helper, so hookstate and the journal carry the same number. `wc -l` pads
  # on BSD; the whitespace strip is for that.
  n=$(wc -l < "$jf" 2>/dev/null) || n=0
  n="${n//[[:space:]]/}"; [[ "$n" =~ ^[0-9]+$ ]] || n=0
  n=$(( n + 1 ))
  m=$(jq -c --argjson n "$n" '. + {n:$n}' <<<"$m" 2>/dev/null) || return 0
  line=$(jq -c --argjson e "$extra" '. + $e' <<<"$m" 2>/dev/null) || return 0
  # THE APPEND DECIDES. `comp` takes the new value only once the line is on
  # disk, so hookstate's `n` can never run ahead of the journal's count.
  { printf '%s\n' "$line" >> "$jf"; } 2>/dev/null || return 0
  comp="$m"
  return 0
}
```

- [ ] **Step 4: The read-back, the reset, the writer, the call site**

(a) The read-back. Replace

```bash
subs=""; prev_state=""; gq=""; gd=""; cp=""; cc=""
{ read -r prev_state; read -r gq; read -r gd; read -r cp; read -r cc; read -r subs; } < <(jq -r \
  '(.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end),
   (if (.graphGateDenials | type) == "number" then (.graphGateDenials | floor) else 0 end),
   (if (.ccrcPeerReads | type) == "number" then (.ccrcPeerReads | floor) else 0 end),
   (if (.ccrcClaims | type) == "number" then (.ccrcClaims | floor) else 0 end),
   (.subagents // [] | tostring)' \
  "$f" 2>/dev/null)
```

with

```bash
# `compaction` (compaction-card spec §3.4) is the SIXTH positional line and
# `subagents` stays LAST: D-1249's rule — the one field that can carry
# unbounded text goes last — holds, because this line is either the literal
# `null` or the `tostring` of an OBJECT that passed the pinned shape, which
# escapes any newline inside it. The shape gate rides the read-back jq (one
# fork, spelled once as COMPACT_SHAPE_PRED); anything else reads as null and
# THE WRITE PROCEEDS without the member.
subs=""; prev_state=""; gq=""; gd=""; cp=""; cc=""; comp=""
{ read -r prev_state; read -r gq; read -r gd; read -r cp; read -r cc; read -r comp; read -r subs; } < <(jq -r \
  '(.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end),
   (if (.graphGateDenials | type) == "number" then (.graphGateDenials | floor) else 0 end),
   (if (.ccrcPeerReads | type) == "number" then (.ccrcPeerReads | floor) else 0 end),
   (if (.ccrcClaims | type) == "number" then (.ccrcClaims | floor) else 0 end),
   (.compaction | if '"$COMPACT_SHAPE_PRED"' then tostring else "null" end),
   (.subagents // [] | tostring)' \
  "$f" 2>/dev/null)
```

(b) After `[[ "$cc" =~ ^[0-9]+$ ]] || cc=0` add:

```bash
[[ "$comp" == \{* ]] || comp="null"
```

(c) The reset line. Replace

```bash
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; gd=0; cp=0; cc=0; fi
```

with

```bash
# `compaction` resets with the counters and for D-1248's reason: a stale
# last-compaction would describe the previous context as current.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; gd=0; cp=0; cc=0; comp="null"; fi
```

(d) The call site. After the `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then … fi` block (and before the `# Transitions to working/done clear the ask` comment), add:

```bash
# PostCompact's measurement (compaction-card spec §3.4): after the read-back,
# so a failed measurement carries `comp`; before the writer, so a successful
# one lands in this event's write.
if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi
```

(e) The writer. In the `out=$(jq -cn …` call add the argument `--argjson compaction "$comp" \` after `--argjson ccrcClaims "$cc" \`, and in its object add `compaction:$compaction` after `ccrcClaims:$ccrcClaims`:

```bash
out=$(jq -cn \
  --argjson v 1 --arg state "$state" --arg event "$event" \
  --arg sessionId "${CLAUDE_CODE_SESSION_ID:-}" --argjson pid "${CLAUDE_PID:-0}" \
  --argjson updatedAt "$(_hook_epoch_ms)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" --argjson graphQueries "$gq" \
  --argjson graphGateDenials "$gd" \
  --argjson ccrcPeerReads "$cp" --argjson ccrcClaims "$cc" \
  --argjson compaction "$comp" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries,
    graphGateDenials:$graphGateDenials, ccrcPeerReads:$ccrcPeerReads,
    ccrcClaims:$ccrcClaims, compaction:$compaction}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "PostCompact and the journal"`
Expected: PASS — every test of the describe. Then the whole file: `./node_modules/.bin/vitest run test/session-hook.test.ts` — every earlier row still green (the `D-1249` multi-line-subagents row in particular: `subagents` is still the last line).

- [ ] **Step 6: Mutation checks**

1. In `_hook_compact_post`, replace the shape-gate `jq -c 'if … then . else empty end'` with `cat` → `well-formed JSON of the WRONG shape` goes red (the `{"chars":"17k","n":1}` object passes the `\{*` prefix guard and reaches `--argjson`).
2. Delete the read-back's `if '"$COMPACT_SHAPE_PRED"' then tostring else "null" end` (emit `.compaction | tostring`) → `a corrupt compaction on disk` goes red.
3. Compute `n` inside the helper's stdout instead (hard-code `n: 1` in the merge) → `n is the journal's own count` goes red.
4. Delete `comp="null"` from the reset line → the D-1248 test goes red on `startup`.
5. Delete the set-age `find` (always `sa=(--set "$set")`) → `an AGED set is removed` goes red.
6. Move `comp="$m"` above the journal append → `the journal that cannot be appended leaves hookstate untouched` goes red.
7. Delete the `rm -f "$set"` after the helper pipeline (and the one in its `||` arm) → `a failing helper still CONSUMES the set` goes red.
8. Delete `[ -e "$COMPACT_CARD_OFF" ] && return 0` in `_hook_compact_post` → `the operator file: no measurement` goes red.

- [ ] **Step 7: Run the whole hook file and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: PASS.

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): PostCompact measures the summary against the set and journals it — hookstate carries compaction through the shape gate, both directions (spec §3.4)"
```

---
### Task 10: Ship the helper beside the hook — every door the hook goes through (spec §2 Runtime, §5 Installer)

**Files:**
- Modify: `deploy/deploy.sh` (the backup line list and the agent-lane `install_atomic` block), `ccd/ccrc` (`_inst_files`, its summary `echo`, the `_upd_backup_copy` list)
- Modify: `server/test/installTreeFixture.ts` (`TREE_FILES` — the fixture tree `ccrc install` is run against; `_inst_atomic` DIES on a source the tree does not carry, so without this entry every `ccrc-install*.test.ts` run is red)
- Modify: `server/test/ccrc-install.test.ts` (the modes `cases` array and the idempotence `targets` list)
- Create: `server/test/compact-card-ship.test.ts`

**Interfaces:**
- Produces: `~/.cc-sessions/compact-card.mjs` at mode 0644 on every box the hook reaches — `deploy.sh`'s agent lane, `ccrc install`, `ccrc update` (with a backup in the same set as the hook's).

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/compact-card-ship.test.ts
// The compaction card's helper reaches a box the same way the hook does, and
// this file is why that stays true: the hook's PreCompact guard (`[ -f
// "$COMPACT_HELPER" ]`) fails SILENTLY, so a helper shipped through one door
// and not the other is a fleet where half the boxes never write a card and
// nothing says so.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const deploy = (): string => readFileSync(path.resolve(__dirname, '../../deploy/deploy.sh'), 'utf8');
const ccrc = (): string => readFileSync(path.resolve(__dirname, '../../ccd/ccrc'), 'utf8');
const code = (src: string): string[] =>
  src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('compact-card.mjs ships', () => {
  it('deploy.sh installs it through install_atomic, at 644, beside the hook', () => {
    const lines = code(deploy());
    const line = lines.filter((l) => l.startsWith('install_atomic ccd/compact-card.mjs'));
    expect(line, 'deploy.sh installs ccd/compact-card.mjs exactly once').toHaveLength(1);
    expect(line[0]).toBe('install_atomic ccd/compact-card.mjs .cc-sessions/compact-card.mjs 644');
    const hook = lines.findIndex((l) => l.startsWith('install_atomic ccd/session-hook.sh '));
    const helper = lines.findIndex((l) => l.startsWith('install_atomic ccd/compact-card.mjs '));
    expect(Math.abs(helper - hook), 'the helper installs beside the hook — the same lane, the same event order').toBeLessThanOrEqual(2);
  });

  it('deploy.sh backs it up in the same set as the hook', () => {
    const src = deploy();
    expect(src).toContain('cp -a ~/.cc-sessions/compact-card.mjs ~/ccrc-backups/$TS/compact-card.mjs');
    expect(src).toContain('cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh');
  });

  it('ccrc install stages it through _inst_atomic at 644, and ccrc update backs it up', () => {
    const lines = code(ccrc());
    expect(lines).toContain('_inst_atomic "$tree/ccd/compact-card.mjs" "$HOME/.cc-sessions/compact-card.mjs" 644');
    expect(lines).toContain('_upd_backup_copy "$HOME/.cc-sessions/compact-card.mjs" compact-card.mjs');
  });

  it('imports node:* only — the shared/mark.mjs class, never bundled, never npm', () => {
    const src = readFileSync(path.resolve(__dirname, '../../ccd/compact-card.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, `${i} is not a node:* module`).toMatch(/^node:/);
  });
});
```

In `server/test/installTreeFixture.ts`, in `TREE_FILES`, directly after the line `  'ccd/session-hook.sh',` add:

```ts
  'ccd/compact-card.mjs',
```

In `server/test/ccrc-install.test.ts`, in the `cases` array of `the session hooks, notify and the tmux/statusline config land at their modes`, add after the `notify.sh` row:

```ts
      // The compaction card's helper (compaction-card spec §2): 0644, a
      // script `node` runs, never executed directly.
      [join(home, '.cc-sessions', 'compact-card.mjs'), placed(home, 'ccd', 'compact-card.mjs'), 0o644],
```

and in the `targets` list of `a second run rewrites none of them, and leaves no temp file behind`, after the `notify.sh` entry:

```ts
      join(home, '.cc-sessions', 'compact-card.mjs'),
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card-ship.test.ts test/ccrc-install.test.ts`
Expected: FAIL — the ship test finds no `install_atomic ccd/compact-card.mjs` line; in the install test the new `cases` row reports `was never installed` (the fixture tree now carries the file, so `ccrc install` runs; `_inst_files` does not place it yet).

- [ ] **Step 3: deploy.sh**

In `deploy/deploy.sh`, in the backup command (the `"${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS …` chain), after the `session-hook.sh` clause add:

```bash
    && { [ ! -f ~/.cc-sessions/compact-card.mjs ] || cp -a ~/.cc-sessions/compact-card.mjs ~/ccrc-backups/$TS/compact-card.mjs; } \
```

In the agent lane, directly after `install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755`, add:

```bash
  # The compaction card's helper (compaction-card spec §2): plain node, no
  # npm, read by the hook's PreCompact and PostCompact arms under `timeout`.
  # 644 — `node` runs it; nothing executes it directly. Same lane, same
  # atomic install as the hook: the hook's guard for it is SILENT, so a box
  # reached by the hook and not the helper would simply never write a card.
  install_atomic ccd/compact-card.mjs .cc-sessions/compact-card.mjs 644
```

- [ ] **Step 4: ccd/ccrc**

In `_inst_files`, directly after the `_inst_atomic "$tree/ccd/session-hook.sh" …` line, add:

```bash
  # The compaction card's helper, 0644 (compaction-card spec §2): a script
  # `node` runs under the hook's `timeout`, never executed directly.
  _inst_atomic "$tree/ccd/compact-card.mjs" "$HOME/.cc-sessions/compact-card.mjs" 644
```

In the `_upd_backup_copy` list, directly after `_upd_backup_copy "$HOME/.cc-sessions/session-hook.sh" session-hook.sh`, add:

```bash
  _upd_backup_copy "$HOME/.cc-sessions/compact-card.mjs" compact-card.mjs
```

And replace `_inst_files`'s summary line

```bash
  echo "install: files: session hooks, notify.sh, tmux.conf and the statusline in place"
```

with

```bash
  echo "install: files: session hooks, the compaction-card helper, notify.sh, tmux.conf and the statusline in place"
```

- [ ] **Step 5: Run and watch them pass**

Run: `cd server && ./node_modules/.bin/vitest run test/compact-card-ship.test.ts test/ccrc-install.test.ts test/ccrc-install-graphify.test.ts test/ccrc-api-ship.test.ts test/deploy-coordinates.test.ts`
Expected: PASS — the ccrc-api adjacency pin still holds (the helper line sits after the hook line, not between `ccd` and `ccrc-api`), and the graphify install suite, which shares the fixture tree, is green.

- [ ] **Step 6: Mutation checks**

1. Delete the `install_atomic ccd/compact-card.mjs` line → `deploy.sh installs it` goes red.
2. Change `644` to `755` on the ccrc line → `ccrc install stages it` goes red, and the `cases` row reads the wrong mode.
3. Delete the `_upd_backup_copy` line → `ccrc update backs it up` goes red.
4. Delete the `TREE_FILES` entry → every `ccrc-install*.test.ts` describe goes red with `the shipped tree has no ccd/compact-card.mjs`.

- [ ] **Step 7: Commit**

```bash
git add deploy/deploy.sh ccd/ccrc server/test/installTreeFixture.ts server/test/ccrc-install.test.ts server/test/compact-card-ship.test.ts
git commit -m "feat(deploy): ship compact-card.mjs beside the hook on every door — deploy.sh's agent lane, ccrc install, ccrc update's backup"
```

---

### Task 11: The operator-facing paragraph, the purge inventory, the spec's status, the full suite

**Files:**
- Modify: `README.md` (after the session-hook contract paragraph, the one ending "…kept apart from `0` (measured none)."), `ccd/ccd` (ONE comment — the registry inventory `_reg_purge` carries — and its provenance re-stamp), `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` (the `**Status:**` line)
- Test: `server/test/session-hook.test.ts` (one pin that the inventory names the three files)

- [ ] **Step 0: The purge inventory names the three files, and `ccd/ccd` is re-stamped**

`_reg_purge`'s comment in `ccd/ccd` enumerates every dot-free registry field a session has ("The dot-free claim, measured against every registry file a session has today: …"), and its own moral is that an inventory that omits files is one a future writer copies. Add the three names, alphabetically, so the line

```bash
  # `compactnote`, `compactskip`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
```

becomes

```bash
  # `compactcard`, `compactions`, `compactnote`, `compactset`, `compactskip`, `crosspool`, `hold`,
  # `home`, `hookstate`, `lastcompact`, `lastswap`,
```

`ccd/ccd` carries a `# ccrc:generated` marker on line 2 and `server/test/ownership.test.ts` fails when the body no longer matches it. Re-stamp, with the command that test prescribes, from the repo root:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

Then pin the inventory, appended to the Task 2 describe in `server/test/session-hook.test.ts`:

```ts
  it('ccd/ccd\'s purge inventory names the three files this hook adds', () => {
    const ccd = fs.readFileSync(path.resolve(__dirname, '../../ccd/ccd'), 'utf8');
    const block = /The dot-free claim, measured against every registry file[\s\S]*?`workspace`, `wrapper`\./.exec(ccd);
    expect(block, 'the inventory paragraph moved').not.toBeNull();
    for (const name of ['compactcard', 'compactset', 'compactions']) expect(block![0]).toContain(`\`${name}\``);
  });
```

Run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/session-hook.test.ts -t "purge inventory|marker"`
Expected: PASS (red before the re-stamp on `ownership.test.ts`; red before the edit on the new pin).

- [ ] **Step 1: README**

Directly after the paragraph that ends `each read back with \`null\` (no field, an older hook) kept apart from \`0\` (measured none).`, add:

```markdown
**The compaction card** (spec `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`,
Plan A). On PreCompact the hook decides which context is compacting — `main`, `subagent` or
`ambiguous`, by a liveness rule over the session's transcripts, because the three compaction payloads
carry the parent's `session_id` and `transcript_path` for a subagent's compaction too — writes
`~/.cc-sessions/<id>.compactset`, and for an unambiguous scope on a tree whose graph the search gate
would trust runs `~/.cc-sessions/compact-card.mjs card` under a 5 s `timeout`: the files that context
was working in, mined from its transcript since the last compaction, resolved against
`graphify-out/graph.json`, rendered as one line per file (community, symbols as `label:L<n>`,
dependents outside the set) into `<id>.compactcard`. On SessionStart(compact) that card is served once,
as the fourth subject of the one envelope, iff its first line is the set's `at`. On PostCompact
`compact-card.mjs measure` scores the summary the session will see — `chars`, `filesChars`, `fences`,
`cited` against the set — into hookstate as `compaction` (with `n`, the journal's own count) and appends
one line to `<id>.compactions`, the per-session study corpus. `~/.ccrc/compact-card-off` turns all three
arms off. `ambiguous` withholds the card and is measured: a Workflow fan-out is ambiguous by
construction, and the journal says how often.
```

- [ ] **Step 2: The spec's status line**

Replace, on the spec's `**Status:**` line, the trailing `no implementation yet` with `Plan A written (\`plans/2026-09-10-graphify-compaction-card-plan-a.md\`)`.

- [ ] **Step 3: The full server suite, in the foreground**

Run: `cd server && ./node_modules/.bin/vitest run`
Expected: PASS. Re-run any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` in isolation before calling a red a break. `typecheck-tests` in particular is the gate that proves `compact-card.d.mts` types the import.

- [ ] **Step 4: Commit**

```bash
git add README.md ccd/ccd server/test/session-hook.test.ts docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md
git commit -m "docs: the compaction card in the README's hook section and in ccd's purge inventory (re-stamped); the spec says Plan A is written"
```

---

## Deploy (after merge — agent-first, AGENT-FIRST is the rule for anything touching the hook)

`bash deploy/deploy.sh agent <fleet-host>` from a checkout of `main` on the box named in `~/.ccrc/deploy.env`. The hook is read fresh at every event and the helper beside it, so nothing restarts. The first live compaction on a 2.1.267 session is the check the spec names (§10): confirm `~/.cc-sessions/<id>.compactions` gains a line and, for one subagent compaction, that its `scope` and `transcript` name the agent file that carries the new `compact_boundary`. The journal is the deliverable; Plan B renders it.

## Deviations found

Numbers D-2384–D-2394 (the first review, eleven) and D-2411–D-2420 (the second review, ten) minted 2026-09-10 through `~/.local/bin/ccrc-api ledger allocate` (project `ccrc-pwa`; floor now 2421), each defined here in the same act.

- **D-2384 — the approved design's `agent_type` guard does not exist on the payloads.** Spec §3.1 guard 2, §3.3 step 0 and §3.4's guard were written as "`.agent_type` in the payload empty". Measured 2026-09-09 on 2.1.266 (five headless runs): the three compaction payloads for a subagent's compaction are byte-identical in key set to the main thread's — the parent's `session_id` and `transcript_path`, no agent field. Operator direction 2026-09-10: compaction works for a subagent exactly as for the main thread. Fix: the guard is gone; §3.0's scope rule replaces it, and the scope is a tag the console renders.
- **D-2385 — the first scope rule ("newest agent transcript wins") was a race, refuted before any code.** Three opus refuters (2026-09-10) measured on this box's corpus: a compacting context writes nothing for ≥79 s, siblings write every 4–6 s, Workflow fan-outs run seven and eight agents at once, and 5 of 197 main-thread boundaries had a newer subagent file. `prompt_id` is the parent's on a subagent's rows; no `CLAUDE_*` variable names an agent. Fix: liveness (§3.0) — manual → main; no live agent → main; one live agent beside a quiet parent → that subagent; anything else → `ambiguous`, which withholds the card and is measured. Recorded so nobody re-derives "newest wins".
- **D-2386 — one card and one set per session id, written by every context.** Two compactions of one session inside the in-flight window cross the pair and mislabel both journal lines, and no later arm can tell which context it serves. Fix: an unconsumed set younger than `COMPACT_CARD_MAX_AGE` at PreCompact is overlap — that compaction is `ambiguous` and the card is removed; the set's `at` is the card's first line and SessionStart(compact) serves only a matching pair; SessionStart and PostCompact never resolve.
- **D-2387 — the set has two writers and two shapes.** The approved text had the helper as the set's only writer and exit 3 writing nothing; then PostCompact had no scope on a graphless tree. Fix: PreCompact writes the set always (`files: null` — not mined; `built`/`fresh` measured first so the journal carries them either way); the helper rewrites it on exit 0 and on exit 3 (`files: []` — mined, empty). Two conditions, two values.
- **D-2388 — `COMPACT_CARD_MAX_AGE` is 1200 s, the in-flight window, not a 3600 s serve bound.** The approved value bounded only the card's serving; the set had no age at all and a card that failed the bound was left standing. Argued from the longest measured compaction (826 s, gpt lane) ×1.45; applied to the card (removed when older), the set (removed unread when older) and the overlap check.
- **D-2389 — the helper timeout is 5 s, declared as amendment R2 of the hook header's "no waiting".** The approved 20 s was a round number, 120× the hook's whole-arm p95; the wait was undeclared. Argued from node startup (~0.05 s), a 70 MB graph parsed in 1.15 s and a 64 MiB window scan (~1 s) at roughly twice their sum. The header sentence is corrected (Task 6); `find`, `timeout` and `node` are guarded like `jq`; on a userland with no `timeout` the feature is inert and says so.
- **D-2390 — `find -printf` is GNU-only; the hook declares two userlands.** The first amendment's one-liner (`-printf '%T@ %p' | sort -n | tail -1`) would print nothing on BSD and silently answer `main` for every subagent compaction, and `sort -n` is locale-sensitive. Fix: `find -mmin` (GNU and BSD) with a bash `read` loop and a `-d` guard; no sort.
- **D-2391 — hookstate's positional read-back gains `compaction` as the SIXTH line, before `subagents`.** D-1249's rule (the one unbounded-text field goes last) holds because the line is `null` or the `tostring` of an object that passed `COMPACT_SHAPE_PRED`, which escapes any newline; the predicate is spelled once and concatenated into both jq programs that need it (the helper-stdout gate and the read-back).
- **D-2392 — the session's subagent directory is `${tp%.jsonl}/subagents`, not `<dirname tp>/<session_id>/subagents`.** Equivalent (the transcript's basename IS the session id, measured across five lanes), and it removes a second `jq` read of the payload and the shape gate a `$sid` interpolation would have needed.
- **D-2393 — the prototype's `(not in graph)` sentinel was an overloaded null.** It meant both "the card was cut" and "the working set was small". Recorded so nobody re-derives it: the card always prints `(+k files not shown)` when anything was dropped, and the set's `stats` tell a thin card from a thin session.
- **D-2394 — the first draft of the spec raised the emitter's clip to fit the compact card.** `CARD_MAX_CHARS` (2,400) is the only defence for the ungated `GM_NODES` (D-1899); raising it would have deleted that defence. Kept as the FIRST clip; the compact subject is appended after it under `CARD_TOTAL_MAX_CHARS`, derived, inside the one emitter.

The second review (2026-09-10, three opus refuters and a scout over the amended spec and this plan) found the following; each changed the spec and the plan before any code:

- **D-2411 — the overlap verdict was advisory: the earlier compaction's helper could overwrite it.** The hook marks the slot `ambiguous`, but the first draft's helper rewrote the set unconditionally, so a helper landing late restored a self-consistent pair the other context could consume. Fix: the helper re-reads the set immediately before each of its two writes and refuses unless its `at` is its own (`slotIsMine`); what remains is the read-to-rename interval, stated in spec §10.
- **D-2412 — `steered` was written before the fact.** The helper recorded `--steer` in the set before knowing whether it would exit 0, so an exit 3 under `--steer` would have read `steered: true` for a compaction that was never steered, corrupting Plan C's whole control variable. Fix: the helper always writes `steered: false`; the hook stamps `true` only after the print (Plan C); the flag is accepted and ignored here.
- **D-2413 — nothing recorded whether the card reached the model.** A mined set with a card that was never served (crossed pair, aged card, failed emit, timed-out helper) read exactly like a served one, so `cited` was uninterpretable. Fix: `_hook_emit_context` returns non-zero when it prints nothing; the arm stamps `served: true` into the set only after a printed card; `measure` copies it; `COMPACT_SHAPE_PRED` and the wire type carry it.
- **D-2414 — the 5 s timeout was argued from parse time alone.** The review measured the first draft's naive suffix resolution (a scan of every file per token) at 2–12 s on a 64 MiB window against a 5,000-file graph, and `loadGraph` at ~1.5 s and ~250 MB RSS on a 51 MB graph. Fix: a basename index makes resolution O(tokens); `WINDOW_CAP` is 16 MiB (a never-compacted transcript is far smaller); `GRAPH_MAX_BYTES` (96 MiB) refuses a graph before parsing it; the timeout is 8 s and Task 6 re-measures p95 and RSS on this box's real graphs before it ships, with an acceptance bound.
- **D-2415 — a helper killed by `timeout` between its write and its rename leaked a dot-leading temp that `_reg_purge` never sees.** Fix: PreCompact sweeps this id's `.compact*.tmp` temps older than the in-flight window; the hook's own temps follow the hookstate idiom `.<id>.<pid>.<suffix>.tmp`.
- **D-2416 — a PostCompact whose helper failed, or a box without `node`/`timeout`/the helper, left the set standing, and the next compaction inside the window read `ambiguous` for no reason.** Fix: the set is settled (age-checked, its journal fields read) before any tool guard and consumed on every path from there; a set `measure` cannot parse reads as no set, never a lost measurement.
- **D-2417 — the `command -v node`/`command -v timeout` guards changed nothing observable.** The call site swallows an exec failure exactly as a failing helper's, so the first draft's mutation row for them was green. Fix: the two guards are dropped and the behaviour pinned instead; the `find` guard stays, inside the resolver, where its removal turns a silent `main` into a measurable red.
- **D-2418 — the approved spec block fed `measure` through a process substitution while claiming `pipefail` semantics.** A redirection is not a pipeline: a jq that died mid-write would have handed the helper a truncated summary and recorded a short `chars`. Fix: the plan's pipe form is now the spec's.
- **D-2419 — the rule recorded only its verdict, so its misfire rate could not be measured.** Fix: `parentLive` and `liveAgents` ride the set and the journal; the corpus measurement that closed the review's question — at an auto-compaction the parent's last row is 0.8 s old at p50, 3.7 s at p95, never 120 s (n=216) — is in spec §0.2.
- **D-2420 — three new dot-free registry suffixes would have silently staled `ccd/ccd`'s enumerated purge inventory, which the first draft forbade itself from touching.** Fix: Task 11 adds the three names to the comment, re-stamps `ccd/ccd`'s provenance marker with the command `ownership.test.ts` prescribes, and pins the names.

## Self-review (writing-plans checklist, run before the numbers were minted)

- **Spec coverage.** §3.0 → Task 2 (rule, overlap) and Task 6 (guards); §3.1 → Tasks 2 and 6; §3.2 → Tasks 3, 4, 5; §3.3 → Task 7; §3.4 → Tasks 8, 9; §5 Hook rows → Tasks 2, 6, 7, 9 (each row named in a test or a mutation step; the two cost rows as the stub-`timeout` pin and the compact arm's own ratio); §5 Helper → Tasks 3, 4, 5, 8; §5 Installer → Task 10; §6 R2 → Task 6; §6 dot-free coupling → Tasks 2 (comment), 7 and 9 (removal); §7 deploy → the Deploy section. Not in this plan, by the spec's own split: §3.5 (Plan C), §3.6 and the Wire rows (Plan B).
- **Placeholders.** Every step carries its code. Two measurements are deliberately deferred to execution because they need the shipped code on this box, and each carries an owner and an acceptance criterion: the compact arm's ratio band (Task 7, R=4 provisional; the executor records the shipped and mutated bands in the test comment and reports if the shipped p95 sits above 3.5) and the helper's p95/RSS on the real graphs (Task 6; p95 ≤ 4 s on the largest graph, else stop and report). Two mutation rows are recorded as unpinned by design (`[ -f "$COMPACT_HELPER" ]`, the second `slotIsMine`) rather than claimed red.
- **Type consistency.** `CS_SCOPE`/`CS_TRANSCRIPT`/`CS_AGENT`/`CS_LIVE_N`/`CS_PARENT_LIVE` (Task 2) are what Task 6's helper call reads; Task 7 reads only `readCard()`'s `{nonce, text}` and the set's `at`; `cardCommand`'s `at: number` (Task 5) is what Task 3's `main` passes and Task 6's `--at "$at"` supplies; `measureCommand`'s `scope` literals and `served` (Task 8) match `COMPACT_SHAPE_PRED` (Task 2) and the spec's `CompactionMeas`; Task 9 builds its sets by running PreCompact for real, and reads `cwd`, `built`, `agent`, `transcript` from the set the hook wrote (Task 2's shape, carried by Task 5's rewrite).
- **Counts.** Test counts are not quoted per step ("every test in the file"): they drift with every added case and a wrong count makes a correct run look wrong. The `case "$event"` block parses to TEN events (`install-session-hooks.test.ts` floors at 10).
