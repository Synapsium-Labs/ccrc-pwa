# Artifact lifecycle policy — every generated artifact has a declared lifecycle

**Status:** RULINGS PARTIALLY IN (2026-08-11) — see below; remaining questions still open.

## Operator rulings, 2026-08-11

1. **Specs and plans are forever** — and already are: they live in `docs/superpowers/` in git,
   committed and pushed with PRs. No new mechanism needed; the ruling confirms the status quo.
   The 7G transcript pool is CONVERSATION transcripts (Claude Code session `.jsonl` logs), a
   separate class — retention ruling still pending, with a proposed horizon below.
2. **Archived→reaped horizon: seven days at most.** Tier B (automatic behind an operator-visible
   kill-switch). This overrules ccd:6386-6389's "no timer, no grace window" stance for the
   fleet-scale case, by explicit operator decision. Auto-reap keeps every existing safety: the
   `--expect` audit token is minted by the sweep itself, the attic refs still pin the branch's
   object graph, and the sweep logs each reap and refuses anything it cannot prove archived+idle.
3. **coord.db: compact is OK.** Byte-identical mail replay is NOT a forever guarantee — it holds
   only while a delivery is outstanding. Old envelopes may be nulled at a horizon with the
   delivery row, states and timestamps preserved. A VACUUM path must ship with the first
   compaction (nothing checkpoints the live db today).
4. **cdk.out: CONTAIN.** Writer identified: `aws-cdk-lib`'s `App` defaults its outdir to
   `mkdtemp(os.tmpdir() + '/cdk.out')` — every CDK **unit test** (`Template.fromStack` /
   `new App()` with no `outdir`) leaks one dir per App, bundled assets included. Confirmed
   writers: intake-platform's BoardStack tests (active today), three custom-tools projects.
   Containment design: ccd's session launch exports `TMPDIR=$HOME/.cc-tmp/<session-id>` — a
   ccd-declared, per-session root that `os.tmpdir()` (and every other well-behaved mktemp user)
   follows, making ALL tool scratch S-pattern by construction; collected at reap and by a
   boot sweep. Until that ships (Build 5), the >6h `/tmp/cdk.out*` sweep continues manually
   under the existing precedent.
5. **Foreign worktrees: one-time cleanup approved in principle**; detail requested and delivered
   (see the session record) — execution list awaiting confirmation because two are visibly
   live-dirty including one modified today, and committed branches survive worktree removal
   in the shared `.git` regardless.

---

**Original draft status:** awaiting operator rulings on the open questions below.
**Operator directive (2026-08-11, verbatim):** "cleanup as a strategy and policy to have
defined lifecycle of all generated artefacts by agents/workspaces/etc."

This is a governance document, not a cleanup script. Its rule is that an artifact class
without a declared lifecycle is itself the defect — byte recovery is a consequence, not
the goal. It was synthesised from a read-only audit of both boxes (2026-08-11) plus an
exhaustive inventory of every creator/deleter pair in the code; every number below was
measured, not estimated. Implementation rides Build 5.

Context at audit time: the fleet host was at 93% disk with /tmp/cdk.out* leaking ~12GB/day
(816 dirs / 11G in 22 hours — an undeclared root AND an undeclared lifecycle, the double
defect this policy exists to make impossible). A precedent-sanctioned sweep of >6h-old
/tmp/cdk.out dirs freed 9G the same day; the leak's writer is still unidentified (open
question 6).

---

## ARTIFACT LIFECYCLE POLICY

*A governance document for ccrc-pwa. Read-only audit basis: three scouts + spot re-verification at commit `a19cec2`, 2026-08-11. Nothing was deleted, moved, or pruned to produce it.*

**The reframe, honoured:** this is not a cleanup proposal. It is a statement that **every artifact class this system generates must have a declared lifecycle**, and that **a class without one is the defect** — regardless of how many bytes it currently occupies. Byte recovery is a consequence. The 1.4M of `ccd.bak-*` files (#18) is exactly as much a policy violation as the 11G of `/tmp/cdk.out` (#7); they differ only in urgency.

The state of play in one sentence: **"programme finished" in this codebase today means "run closed, workspace metadata-archived" — it does not mean "bytes reclaimed," and nothing turns the former into the latter without a human doing it by hand, workspace by workspace, forever.**

---

# 1. THE POLICY SPINE — CONTAINMENT AS THE ORGANISING PRINCIPLE

## 1.1 The rule this system already has

Agents write inside their workspace. The server writes uploads inside `.cc-clips`, and asserts it at the write site — `clip.ts:40-48` composes the path and then checks `full.startsWith(root + path.sep)`, with a comment that says the assertion is *not* dead code because an earlier revision dropped it and `name` could escape. `docs/superpowers/specs/2026-08-04-worktree-ownership-design.md:51` requires all containment math on `pwd -P`-resolved paths on both sides, because the fleet's roots are symlinked. The agent package has structural PATH containment. `ccd` refuses to remove worktrees it did not create (ccd:6402).

Containment is already this system's deepest habit. **What has never been done is to name it as the lifecycle foundation.**

## 1.2 The foundational rule

> **An artifact born inside a declared root INHERITS that root's lifecycle, and is collected by that root's own end-of-life — automatically, by construction, with no per-artifact code.**

This is the whole policy in one line, and its power is best seen in the numbers. Of the 18G in `~/worktrees`, **15.5G is `node_modules`** (#2) — 788 directories, the single largest identified mass on the fleet host. It needs no retention rule, no TTL, no sweep, no manifest entry of its own, and no engineering whatsoever. It is inside a workspace; it dies when the workspace dies. The same is true of build output, `.git` objects, `dist/`, coverage reports, and every future artifact any agent invents inside a worktree, forever. **Containment is a lifecycle that scales to artifacts that do not exist yet.**

Contrast #7: 11G of `/tmp/cdk.out<rand6>`, 816 directories, all created in 22 hours, growing at ~12GB/day, currently the fastest path to filling a disk with 23G free. Byte-for-byte it is the *same artifact* as #3 — `cdk synth` output, `asset.*.zip` plus bundled `node_modules`. The only difference is **where it was written**. Inside a workspace it is free to govern. In `/tmp` it requires a bespoke collector, an owner nobody has found, and an age heuristic that must guess whether a live process still needs it.

**Corollary — the cheapest lifecycle is containment.** When a writer is discovered outside a declared root, the first remedy is to *move the writer inside a root*, not to write a collector for it. A collector is what you build when the writer cannot be moved.

## 1.3 The two defect classes

This gives the policy the thing a governance document needs: violations that are *detectable as violations*, not merely as mess.

- **Class A — CONTAINMENT VIOLATION.** A write outside every declared root. Not "untidy": a breach of the system's stated contract, and the reason the disk is at 93%.
  Instances: #7 `/tmp/cdk.out*` (11G), #8 `custom-tools/cdk.out` (28G, grown from ~20G), #5 the five registry-orphan worktrees (5.16G, created by `git worktree add` outside `ccd ws-add` — established by both scouts, since `cmd_forget` structurally cannot produce that state), #6 the foreign `.claude/worktrees` pool (~28G, a *second* worktree mechanism this system is unaware of).
- **Class B — LIFECYCLE GAP.** A write inside a declared root that has no declared disposition. Contained, therefore collectable in principle, but with no rule saying when.
  Instances: #4 archived-never-reaped workspaces (9.77G), #9 scratchpads (5.8G), #10 transcripts (7.0G), #11 clips, #14 tombstones, #15 attic refs, #22-27 coord.db's seven insert-only tables.

Class A is a *contract* problem; Class B is a *policy* problem. They need different remedies (move the writer / declare the disposition) and different detectors (§4d's audit catches A; §4b's tests catch B). Conflating them is why the disk filled while everyone was looking at workspaces.

## 1.4 The declared roots

| root | governs | governed by | status |
|---|---|---|---|
| **`<workspace>`** — the git worktree (`$PROJECTS_ROOT/<p>/…`, `~/worktrees/<p>/<slug>`) | everything an agent writes while working: source, `node_modules`, build output, `.git` objects, `cdk.out` | pattern **W**: `ws-add` → `ws-archive` → `ws-reap` | root declared; **collection edge exists but never fires automatically** |
| **`~/.cc-clips/<id>/`** | pasted images | pattern **S**; containment asserted at the write site (clip.ts:40-48) | root declared and enforced; disposition undeclared |
| **`~/.cc-sessions/<id>.*`** | registry: `.workdir`, `.archived*`, `.hookstate.json`, `.uuid` | pattern **S**; `_reg_purge` ccd:110-206 is the only registry deleter in the repo | healthy — **zero dangling rows**, 1.6M total |
| **`~/.cc-sessions/.reaped/`** | tombstones | pattern **O** — *proposed* ruling | ruling never made; currently an unstated default |
| **`refs/ccrc/attic/<id>/*`** (a namespace, not a directory) | reaped branch tips | pattern **O** with a byte caveat | declared permanent in-code (ccd:2183) but the *pinned object graph* was never costed |
| **`~/.cc-limits/`** | per-wrapper telemetry | pattern **X** | bounded by construction |
| **`~/.ccrc/`** (server) | `coord.db`, `mail.token` | pattern **P** for rows / **O** for the token | file backed up correctly; **rows ungoverned** |
| **`~/ccrc/`, `~/ccrc-backups/`** (both boxes) | deploy tree, coord.db+dist snapshots | pattern **R** — `prune_backups` keep 10 | **the exemplar. Do not re-fix.** |
| **`<cfg>/projects/…/<uuid>.jsonl`** | transcripts | written by Claude Code, read-only here | root declared; **no lifecycle, and no verb even exists** |
| **`/tmp/claude-1000/<munged>/<uuid>/scratchpad`** | agent working files | pattern **S** *(contestable)* | **a root we declare to agents in their own system prompt and then never collect** — the purest illustration of Class B |

Anything not in this table is undeclared. The audit in §4d exists to find writes there, and the manifest in §4a exists so "undeclared" is a machine-checkable predicate rather than an opinion.

---

# 2. THE LIFECYCLE MODEL

Seven patterns. Each has states, an explicit **trigger** per edge, and a **disposition bound**. Every class in Appendix A is assigned to exactly one. **There is no default pattern** — an unassigned class is a red test, and the only way to leave one unassigned is an explicit operator ruling recorded in the manifest.

### W — workspace-bound
`active → merged → archived → reaped(collected)`
- `active→merged`: PR phase becomes `merged` (prstate).
- `merged→archived`: **exists and works.** `archiveMerged` (watch.ts:1797), `PR_SWEEP_MS = 120_000`. Requires: measured identity (`measuredIdentity(r) !== null`, checked *before anything else* — see its own comment on why a degraded row is unsafe), phase `merged` (unknown never archives), no hold, and `archiveSafety` verdict `ok` **read fresh at the decision point, not from the sweep's opening snapshot**. Metadata-only: `ws-archive` destroys nothing (ccd:1840).
- `archived→reaped`: **THE MISSING EDGE.** The verb exists (`cmd_ws_reap` ccd:4816) and is complete — attic pin, tombstone, worktree, branch, clips, registry — but has zero automatic callers (`grep CCD_ARGV.wsReap` → the argv builder and one human-tapped route, server.ts:851).
- Bound: terminal-state-derived (`archived`) **plus** an age horizon (§Open Q2).
- Note: ccd's own comment (ccd:6386-6389) says *"Archived is the STAGING for a confirmed deletion, not a queue a sweep drains. No timer, no grace window."* **This policy does not overrule that — it satisfies it.** The objection is to *time alone* as authority. §5 Tier B supplies evidence-plus-time, twice observed, with a kill-switch — which is what "confirmed" can honestly mean at fleet scale.

### S — session-bound
`live → dead → collected`
- `live→dead`: session exits / registry marks dead.
- `dead→collected`: `_reg_purge` (ccd:110-206) for registry files; `rm -rf` for clips and scratchpad. Today: only via `forget` or a full reap, both human-tapped.
- Bound: terminal state + age. **Rule: an S-artifact must never outlive its session's W-artifact.** #9's 883M scratchpad for a workspace archived hours ago is the violation this rule names.

### P — programme-bound (ledger)
`open → closed → compacted → (retained indefinitely | exported)`
- `open→closed`: `closeRun` (close.ts:60-170) — note it only UPDATEs `state`; no row leaves.
- `closed→compacted`: age-after-close horizon. **Compaction, not deletion** — see §5. Ledgers with audit value keep the row that proves *what happened* and shed the bulk that proves *exactly how it was worded*.
- Bound: bytes-per-closed-programme after compaction, not row count.
- This is the pattern with **zero implementations today**: all seven of coord.db's mutable tables sit here with no deleter, no compactor, and — per store.ts:437-452's own docstring — with unbounded growth already written down as accepted fact.

### R — ring-capped
`written → evicted-by-newer`
- Trigger: **the same transaction as the write.** This is the pattern's defining property and why it never fails: there is no sweep to forget to schedule.
- Bound: count (or bytes).
- Working instances: `feed_events` (2000, store.ts:1104 — the only `DELETE FROM` in the repository), the notify-log ring (200, notifylog.ts:54-57), `~/ccrc-backups` (keep 10, deploy.sh:59-63, verified live on both boxes).
- **Every one of the system's three genuinely-solved cases is this pattern.** When a class can be R, make it R.

### X — singleton / overwrite-in-place
`written → overwritten`. Trigger: every write. Bound: 1 by construction. `state-cache.json`, `push-subs.json`, `.cc-limits/*.json`, the notify-log disk file, `coordinator_state`, `~/ccrc/server/node_modules` (`npm ci` replaces rather than grows). Named explicitly so these are never mistaken for unbounded — and so a future `.json` that starts *appending* is a visible pattern change rather than a silent one.

### E — tool-scratch (ephemeral, valueless, regenerable)
`created → idle → collected`
- Trigger: mtime age past a horizon **and** no live owner.
- Bound: age alone.
- **This is the only pattern where age alone is sufficient authority**, and precisely because the artifact has no audit value and can be regenerated by re-running the tool. `cdk.out` is E. The policy's preferred remedy for E is still §1.2: move it inside a workspace and it becomes W for free.

### O — operator-permanent (record of what happened)
`written → retained forever, by ruling`
- No collection edge, **by explicit decision recorded in the manifest with a stated reason** — never by omission.
- Requirement: an O class must be **affordable** — bounded bytes-per-event, so that permanence is a cost you can multiply out. A tombstone (#14) is one small JSON per reaped workspace: affordable, therefore legitimately O. An unbounded transcript (#10) at 584MB per session **cannot be O without a size discipline**, which is why it is the first open question and not a ruling I can make.
- The O pattern is what makes the policy honest: it is how an artifact stays forever *on the record* rather than forever *by accident*.

## 2.1 Assignment summary

| pattern | classes (Appendix A numbers) |
|---|---|
| **W** | 1, 2, 3, 4, 5 |
| **S** | 9, 11, 12, 13 |
| **P** | 22, 23, 24, 25, 26, 27 |
| **R** | 16, 18, 21, 30, 33 |
| **X** | 20, 28, 32, 34 |
| **E** | 7, 8 |
| **O** | 10*, 14, 15, 17, 19, 31* |
| **UNASSIGNED — ruling required** | 6 (foreign worktrees), 35 (journald), 36 (server-box generic caches / dual-role box) |

`*` = proposed, pending an operator ruling (§Open Q1, Q8iv). The three UNASSIGNED rows are not oversights — they are the classes where an assignment would be a decision I do not have standing to make, and under this policy **an honest UNASSIGNED with a named open question is compliant; a silent default is not.**

---

# 3. THE INVENTORY

See **Appendix A** (the `inventory` field): 36 classes with creator file:line, pattern, current deleter, gap, and measured bytes/rows, plus §A.3 reconciling the three scouts (they contradict each other nowhere; the two apparent conflicts — backup dir counts and 42G-vs-18G — resolve to two boxes and two scan scopes respectively).

The one number nobody has: **the object graph pinned by attic refs (#15).** Refs are ~50 bytes; what they retain is unmeasured, and by design blocks `git gc --prune` forever.

---

# 4. ENFORCEMENT — in this repo's idiom

A policy without a test decays. This repo already knows that and says so in prose that should be this section's epigraph — `server/test/single-definition.test.ts`:

> *"Both of these started life as a COMMENT asking the next reader not to copy something, and both were copied anyway… A comment is a request; a red suite is a mechanism."*

And, in the same header, the honesty this section is obliged to match:

> *"These scan TEXT, deliberately, and that is a limitation worth stating… The bar is 'a reasonable person adding a fourth copy in the ordinary way is stopped before review', not 'unforgeable'."*

## (a) The machine-readable manifest — `shared/lifecycle.ts`

The roster pattern, exactly as `ACCOUNTS` and `PR_REASONS` do it (shared/api.ts:216: `PR_REASONS = Object.keys(PR_REASON_MAP)`, derived not hand-typed, because — per config.ts's own comment — the hand-typed literal beside the roster is how `claude-dev0` went missing for its entire life).

```ts
export const ARTIFACT_CLASSES = {
  'workspace.worktree': {
    root: 'workspace',
    pattern: 'W',
    creators: ['ccd/ccd:cmd_ws_add'],
    collector: 'ccd/ccd:cmd_ws_reap',
    bound: { kind: 'terminal+age', state: 'archived', days: 14 },
    tier: 'B',
    enforcement: 'scanned',
  },
  'transcript.jsonl': {
    root: 'wrapper-config',
    pattern: 'O',
    creators: ['<external: Claude Code harness>'],
    collector: null,
    ruling: 'OPEN — see policy Open Question 1. Retained pending operator ruling.',
    bound: { kind: 'none' },
    tier: 'C',
    enforcement: 'audit-only',
  },
  // …one entry per class in Appendix A
} as const;
```

Non-negotiable field rules: `collector: null` **requires** a non-empty `ruling` string; `pattern: 'O'` requires a stated bytes-per-event affordability note; `enforcement: 'audit-only'` requires naming *why* code cannot hold it. The policy document derives from this file — the Appendix A table is generated (or diffed in CI) against it, so the doc cannot drift from the manifest the way three copies of `UNCHECKED_PR` drifted from their comment.

## (b) Tests — graded by what is honestly mechanisable

**Strong (a scanner genuinely decides it):**
- **T1 — every destructive site is a registered collector.** Scan `server/src`, `ccd/ccd`, `deploy/` for `DELETE FROM`, `rm -rf`, `rm -f`, `unlinkSync`, `rmSync`. Each hit must map to a manifest `collector`. Today this yields exactly 4 legitimate sites (store.ts:1104, `_reg_purge` ccd:110, the reap tail, `prune_backups`) — a small, stable set, which is what makes the test cheap and the allowlist readable. Same text-scan idiom, same disclosed limitation, as `single-definition.test.ts`.
- **T2 — every coord.db table has a pattern.** Parse `CREATE TABLE` out of `server/src/coord/schema.ts` (one file, canonical DDL) and require a manifest entry for each. **A new table with no lifecycle turns the suite red.** This is the highest-value test in the set: it makes the exact defect that produced seven unbounded tables impossible to repeat, and it is fully decidable.
- **T3 — the roots table is complete.** Every root in the manifest resolves to a real `CcrcConfig` field or a documented external path; every `CcrcConfig` path-valued field appears as a root. Closes the gap where a new `cfg.somethingDir` gains writers and no lifecycle.

**Medium (a lint with false positives, tuned):**
- **T4 — no literal escape hatches.** Flag string literals beginning `/tmp/` or `~/` in `server/src`, `agent/src`, `ccd/ccd` that are not built from a declared-root constant. This is the test that would have caught `/tmp/cdk.out` **if the writer lived in this repo.** It does not, which is the point of the next paragraph.

**Convention only — and the policy says so out loud rather than overpromising:**
- What a **Claude agent writes at runtime** cannot be caught by any test in this repository. `cdk synth`'s `mktemp -d` (#7), a subagent's `.claude/worktrees` checkout (#6), and the transcripts themselves (#10) are all authored by processes outside this codebase. These classes carry `enforcement: 'audit-only'` in the manifest, and they are held by exactly two things: **(i)** the agent-facing contract (system prompt / skill text: *"write inside your workspace or your scratchpad; nothing else"*), and **(ii)** the §4d audit, which is the only mechanism that can *observe* a violation after the fact. Claiming CI coverage here would be a lie, and a policy that lies about its own enforcement is worse than one that admits a hole — because the hole then goes unwatched.

## (c) Collection edges log what they collected and refuse what they cannot prove

The exemplar is `archiveMerged` (watch.ts:1797), and its structure should be copied verbatim by every new collector:

- **Two rungs, and only the fresh one may authorise.** The hold is read from the sweep's opening snapshot (fast, can be blind, *can never be wrong in the destructive direction*) and then again fresh at the decision point via `archiveSafety` (authoritative). Its own comment spells out the asymmetry. **Any auto-reap MUST do the same: eligible at sweep N, re-proved by a fresh read at sweep N+1.** Twice-observed evidence is this system's existing standard for a destructive-adjacent act and the policy adopts it wholesale.
- **Skip before you test.** `if (measuredIdentity(r) === null) continue;` runs before every other check, because a degraded row reads `null` for both `workspace` and `archivedAt` — and a false-negative `archivedAt` would make an already-archived workspace look freshly eligible. Every collector must establish that it can *read* the thing before it decides anything about it.
- **Refuse in a typed vocabulary that already exists.** `_reap_refuse` codes (`foreign-worktree`, `registry-branch-drift`, `no-worktree-record`), `_gc_declined` ("could not read the status of $p — refusing to remove a tree it cannot describe"), and the mail rejection codes. New collectors extend this vocabulary; they do not invent a second one.
- **Never affirm an unmeasured figure.** `cmd_ws_gc` refuses to print a total when `du` exited non-zero or wrote to stderr (ccd:6437-6465): *"total unmeasured across N worktrees — du could not read all of them, so there is no figure to give."* Every collection log inherits this. A collector that reports "reclaimed 6.8G" must have measured 6.8G.
- **Log one line per collected item**, naming class, evidence, and bytes — so the audit trail of a collection is reconstructable from the log alone.

## (d) The audit surface — the policy's own drill

**`ccd ws-gc` already is this, for worktrees.** It scans `$PROJECTS_ROOT` via git's own worktree list (not the registry — which is exactly why it *sees* the five registry-orphans that no registry-walking tool can), classifies into `tracked` / `archived` / `orphan` / `stale-meta` / `dead-reg` / `foreign` / `foreign-stale`, measures bytes with a single inode-deduping `du`, and **reports without acting**. It independently produced the 9.77G and 5.16G figures two scouts arrived at by hand.

**The detection machinery already exists and is accurate. It is simply not wired to anything.** That is the cheapest large finding in this audit.

Generalise it to `ccd lifecycle-audit` / `GET /api/lifecycle/audit`, which walks the manifest and reports, per class: declared pattern, measured bytes/count, oldest item, **overdue** count (past its declared bound), and — the part `ws-gc` cannot do — **undeclared roots**: paths under `$HOME`, `$PROJECTS_ROOT` and `/tmp` matching no manifest root. That last check is the only thing in this entire policy that can catch a Class A violation like `/tmp/cdk.out`, and it would have caught it on day one, at 500MB instead of 11G.

Rules for the audit: it **reports, never collects** (a measuring pass stays a measuring pass — the same discipline this audit itself was run under); it runs on a schedule with its output surfaced in the PWA and pushed when drift crosses a threshold; and **its own output is R-pattern**, keep N, because an audit log that grows forever is the joke that writes itself.

---

# 5. TIERS FOR THE COLLECTION EDGES

Governing principle: **destructive acts stay operator-sanctioned or provable-by-evidence, and ledgers with audit value COMPACT rather than delete.** The tier boundary is *reversibility*, not size.

## Tier A — automatic now (provable, reversible, or valueless)

| edge | why A |
|---|---|
| **E-pattern tool scratch** (#7 `/tmp/cdk.out*`, #8 `cdk.out`) past an idle horizon | valueless and regenerable: re-run `cdk synth`. No audit value, no user content, no unrecoverable state. Age alone is legitimate authority *only here*. **Preferred fix first:** move the writer inside the workspace (§1.2) and this edge stops needing to exist. Reclaims 11G now, stops 12GB/day. |
| **S-pattern scratchpads** (#9) for sessions whose workspace is archived or gone | the rule "an S-artifact never outlives its W-artifact" is decidable from the registry, not from a guess. 5.8G. |
| **Ring caps** — `mail_rejections` (#27) gains a `FEED_RETENTION`-shaped cap; `ccd.bak-*` (#18) keeps newest N | the R pattern is safe *because the eviction runs in the same transaction as the write* — no sweep, no schedule, nothing to forget. Copy store.ts:1098-1107 exactly. (Caveat: if the operator rules #27 a security ledger rather than noise, it moves to P — §Open Q8ii.) |
| **Declare the backup exemptions** (#17, #31) | not a deletion at all: give the hand-made siblings an explicit `O` ruling in the manifest so `prune_backups`' deliberate glob-restriction is *recorded* rather than merely observed. |

## Tier B — automatic behind an operator-visible kill-switch

| edge | why B, and why not A |
|---|---|
| **`archived → reaped` for W** (#4, 9.77G today and structurally unbounded) | this is the policy's centrepiece. Not A, because it destroys a worktree a human might still want to `cd` into — irreversible *in place*. But not C either, because `ws-reap` **already writes the attic pin and the tombstone before it destroys anything**: the commits survive, recoverable. That is reversible-*in-substance*, and it is precisely the line between A and B. Requires: merge proof, no hold, not attached, past the age horizon, **twice-observed** per §4c, plus per-reap push notification and a kill-switch (registry flag + PWA toggle) that is visible in the fleet UI, not buried in env. |
| **S-collection of clips (#11) and registry (#12,#13) on session death** | same shape one level down. A pasted screenshot is *user content*, which is why it gets a switch and a horizon rather than an unattended sweep. |

## Tier C — operator-only, forever

| edge | why C |
|---|---|
| `ws-rm`, `ws-gc --prune` | already `UNGRANTABLE_VERBS` (whitelist.ts:241) — unreachable from PWA and agent, a human on the box only. **The policy ratifies this rather than loosening it.** A governance document that used "we now have a policy" as leverage to widen destructive reach would be the worst possible outcome of this exercise. |
| `ws-attic --drop` | terminal-only by design (ccd:2181-2183). Dropping an attic ref discards the last recoverable copy of a reaped branch — the act that makes Tier B's reversibility claim true. It must never be automatable, or Tier B silently becomes irreversible. |
| **foreign worktrees** (#6, ~28G) | *"ccd removes only what it created."* The audit reports them; a human — or their actual owner, once identified — collects them. Ruling needed (§Open Q6). |
| **transcripts** (#10, 7.0G) | the only record of what an agent actually did. Even with a retention ruling, the deleter is a human-tapped verb. |
| **any `DELETE FROM` on a P-table** | see below. |

## The COMPACT rule for ledgers

Coord.db's P-tables must never learn a `DELETE`. They compact:

- **`run_events` (#24):** for a run closed beyond the horizon, keep the terminal event and collapse the intermediate transitions into one `compacted` event carrying counts and the first/last timestamps. Six-plus rows become two; *the run's outcome and duration survive intact*.
- **`mail_deliveries` (#26):** keep the row, its states, and its timestamps; null out the **rendered envelope** — the largest field, and a second copy of a message whose original is still in `mail`. **Stated cost, honestly:** `envelope.ts`'s byte-identical-replay guarantee becomes explicitly scoped to *un-compacted* rows. Replay dies at the horizon; audit does not. That is a real trade and it needs the operator's sign-off (§Open Q3), not a maintainer's assumption.
- **`work_items` (#25):** terminal-state items compact to a per-run summary row.
- **Then `VACUUM`.** Note the prerequisite nobody has: **the live coord.db is never `VACUUM`ed or checkpointed.** db.ts:162 sets `PRAGMA journal_mode = WAL` and nothing in the file issues either; the repo's only `VACUUM INTO` (backup-coord.mjs:34) runs against a copy. Compaction without a live-file VACUUM path frees pages into the freelist and returns zero bytes to the filesystem — and, worse, every one of the 10 retained backups keeps carrying them.

---

# 6. WHAT A FINISHED 5-WAVE PROGRAMME LEAVES

Inputs named so the arithmetic can be argued with. A wave ≈ one run ≈ one workspace. Medians from the measured pool (#1: 26 workspaces / 18G; CDK repos are outliers at 3.7-4.0G, typical non-CDK ≈ 0.7G). Scratchpad median from #9's measured 538-883M. Transcript per session varies enormously (measured 50M-584M); ~150M used, which is conservative against a 584M worst case.

## Today

| per wave | bytes | fate |
|---|---|---|
| workspace worktree (≈86% `node_modules`) | ~0.70 G | archived by the 120s sweep; **never reaped** → permanent |
| scratchpad | ~0.65 G | permanent, outlives the workspace |
| transcript (×1; ×2-3 if the session spans wrapper HOMEs) | ~0.15 G | permanent, no verb exists |
| clips, registry markers, tombstone/attic | ~0.01 G | permanent |
| coord.db rows | KB-to-low-MB | permanent, ×10 amplification into every retained backup |
| **per wave** | **≈ 1.5 G** | |

**A finished 5-wave programme leaves ≈ 7.5 G, essentially all of it permanent, and returns 0 bytes.** Plus, if any wave touches a CDK repo, an unbounded Class-A `cdk.out` spill outside the programme's accounting entirely (fleet-wide that channel is running at 12GB/day).

## Under the policy

| per wave | bytes | fate |
|---|---|---|
| worktree + scratchpad + clips | ~1.35 G | **collected** at Tier-B reap |
| transcript | ~0.15 G → ~0.03 G | with a horizon + gzip + cross-HOME dedup (the 1.68G/3-copy case is ⅔ pure duplication) |
| compacted ledger rows | < 1 MB | retained, audit intact |
| tombstone + ≤201 attic refs | < 50 KB | **O — permanent by ruling**, plus an *unmeasured* pinned object graph (§Open Q4) |
| **per wave** | **≈ 0.03 G** | |

**≈ 0.15 G residue per finished 5-wave programme, from ≈ 7.5 G — about 98% returned.** The dominant remaining term is whatever the transcript ruling says, which is why Open Question 1 is first.

## Fleet steady state

**Today:** monotone. 12 GB/day (Class A `cdk.out` alone) + ~1.5 G per finished wave + transcripts, against **23 G free = roughly a 2-day runway.** Nothing in the trend bends.

**Under the policy** — a genuine steady state, with the shape `concurrent live work + (horizon × rate × residue) + fixed rings`:

- 8 concurrent live workspaces × ~1.3 G ≈ **10 G** (the working set — irreducible, and correctly so)
- 90-day horizon × 2 programmes/day × 0.15 G ≈ **27 G** (retained history, and the term the rulings move)
- rings, backups, registry, deploy trees ≈ **< 1 G**
- **≈ 38 G, flat** — a number the operator can budget against, versus a curve nobody can.

Two caveats stated plainly: *programmes/day* and the *90-day horizon* are operator rulings, not measurements — change either and the middle term moves linearly. And the attic-pinned object graph (#15) is the one term in this model with no measured value at all.

## The immediate arithmetic worth noting

Firing only the collection edges that **already exist**, with detection that **already works** and is already accurate, would return: 9.77 G (#4 archived) + 5.16 G (#5 orphans) + 11 G (#7 `/tmp/cdk.out`) + 5.8 G (#9 scratchpads) ≈ **32 G — more than the 23 G currently free.** The 93%-full disk is not an engineering-capability problem. It is a governance problem: nothing has ever declared *when* these things end.

---

## APPENDIX A — THE ARTIFACT INVENTORY (the policy's normative roster)

Every class the three scouts found, reconciled. `pattern` is the assignment from §2 of the proposal. `gap` is measured against that assignment — a class whose current deleter already satisfies its pattern reads `none`. Line numbers verified in-tree at `a19cec2` unless marked (scout).

### A.1 — Filesystem, fleet host (this box; /dev/sda1 301G, 266G used, 23G free = 93% — re-measured now)

| # | class | root | creator (file:line) | pattern | current deleter | gap vs policy | measured today |
|---|---|---|---|---|---|---|---|
| 1 | workspace worktree (source, build output, .git objects) | `$PROJECTS_ROOT/<project>/…`, `~/worktrees/<p>/<slug>` | `cmd_ws_add` ccd:1030 | **W** workspace-bound | `cmd_ws_reap` ccd:4816 — **human tap only** (`server.ts:851`, `--expect` token) | collection edge exists but has **zero automatic callers**; `ws-gc --prune` explicitly refuses `archived` (ccd:6386-6389) | 26 dirs / 18G across 10 projects |
| 2 | `node_modules` inside a workspace | inside #1 | package managers, at agent runtime | **W** (inherited — no policy of its own) | dies with #1 | none *in the policy*; blocked entirely by #1's missing edge | 788 dirs / ~15.5G (86% of #1's bytes) |
| 3 | `cdk.out/asset.*/node_modules` inside a workspace | inside #1 | `cdk synth` at agent runtime | **W** (inherited) | dies with #1 | none in policy; worst multiplier — ~30 near-identical 86-90M copies in one workspace | ops-alert-centre-api alone = 4.0G |
| 4 | archived-but-unreaped workspaces | as #1 | `cmd_ws_archive` ccd:1728 sets the state, destroys nothing (ccd:1840: *"worktree kept at $workdir, nothing deleted"*) | **W**, state `archived` | none — inflow is automatic (`archiveMerged`, watch.ts:1797, `PR_SWEEP_MS=120_000` watch.ts:92), outflow is manual | **the queue with an inflow and no outflow.** This is the policy's single largest structural defect | 10 workspaces / **9.77G** (ws-gc's own read-only scan); warm-meadow alone 6.8G, idle 4 units |
| 5 | ccd-registry-orphan worktrees | as #1 | `git worktree add` outside `ccd ws-add` (inferred: `cmd_forget` ccd:7096-7098 structurally cannot produce this state) | **W**, state `orphan` | `ws-gc --prune` orphan arm (ccd:6115-6191) — operator-CLI-only (`UNGRANTABLE_VERBS` whitelist.ts:241) | detection works and is accurate; **nothing runs it** | 5 worktrees / **5.16G** |
| 6 | "foreign" worktrees `<project>/.claude/worktrees/<name>` | outside every ccd root | Claude Code's own subagent/workflow mechanism — **not this repo** | **UNASSIGNED — operator ruling required (§Open Q6)** | ccd refuses by design ("ccd removes only what it created", ccd:6402) | **a second worktree ecosystem, comparable to or larger than everything ccd manages, with no owner and no collector** | ws-gc fleet total 42G/94 worktrees incl. ccd's own; unique foreign pool ~28G. expoAI-assistant ~35 (0.7-1.2G ea, idle 11-21), custom-tools claude-usage-a1 4.8G idle 21, intake-platform 5 (~0.4G ea). Caveat: data-internal double-listed via sibling worktree-of-a-worktree; du inode-dedup likely already collapses the headline |
| 7 | `/tmp/cdk.out<rand6>` | **no declared root — containment violation** | `mktemp -d` inside some `cdk synth` caller; **owner not found** by any scout (not ccd, not systemd, not crontab) | **E** tool-scratch | **none anywhere** | undeclared root **and** undeclared lifecycle — the double defect | **816 dirs / 11G, ALL created in 22h ≈ 12GB/day.** At 23G free ≈ 2-day runway |
| 8 | `custom-tools/cdk.out` (main checkout) | inside a project root, outside any workspace | same tool, non-temp invocation | **E** tool-scratch | none | previously-known offender; **grew, not shrank** | **28G**, up from ~20G measured previously (`/data/projects/…` confirmed same inode — not double-counted) |
| 9 | `/tmp/claude-1000/<munged-workdir>/<uuid>/scratchpad` | declared root (agents are told to use it) with **no declared lifecycle** | Claude Code harness, per session | **S** session-bound *(assignment contestable — §Open Q8i)* | none | outlives the workspace it belongs to by design-accident | **5.8G**; ccrc-pwa/calm-mesa 883M with its workspace archived hours ago; data-internal still-prairie/plain-harbor/clear-mesa 538-753M each |
| 10 | transcripts `<cfg>/projects/<munged>/<uuid>.jsonl` | declared root, written by Claude Code not by us | Claude Code itself; this repo only ever **reads** (`_transcript_path` ccd:~301, `resolveTranscriptFile` server/src/transcript/resolve.ts) | **O** operator-permanent *(pending ruling — §Open Q1)* | **none, anywhere in the repo.** `cmd_forget` ccd:7123 keeps them on purpose | no verb exists, not even a manual one; and the 2-3× wrapper duplication is pure waste under any horizon | **~7.0G / 7,083 files.** .claude 2.2G, -personal 2.7G, -corp 1.4G, -dev0 391M, -gpt 330M, -glm 14M. One rp-llm session = 584M, and **the same session id is duplicated across 3 wrapper HOMEs ≈ 1.68G for one conversation** |
| 11 | `.cc-clips/<id>/*` pasted images | `cfg.clipsDir` — declared, containment asserted at the write site (clip.ts:40-48, `full.startsWith(root + sep)`) | `stageUpload` clip.ts:59-72 — no cap, no dedup, no expiry | **S** session-bound *(contestable — user content, §Open Q8iii)* | full `ws-reap` tail `rm -rf` only (ccd:4368/4465); untouched by `ws-archive`; explicitly kept by `forget` (ccd:7123) | archived-not-reaped and forgotten sessions keep every screenshot forever | 53M / 12 upload dirs (one per wrapper+project chat) |
| 12 | registry files `~/.cc-sessions/<id>.*` incl. `.hookstate.json` | `cfg.registryDir` — declared | `ccd ws-add`, `session-hook.sh:69,111` (tmp+rename) | **S** session-bound | `_reg_purge` ccd:110-206 — **the only registry deleter in the repo**, two call sites: `cmd_forget` ccd:7085, `_ws_reap_tail` step (i) | neither call site is automatic; but bytes are trivial and the registry is internally clean | **1.6M / 321 files / ~30 session ids. Zero dangling rows** — every `.workdir` target still exists. One stray `.bak-20260803-115314/` (32K) |
| 13 | `.archived` / `.archivedreason` / `.archivemanifest` markers | registry | ccd:1787, 1832-1833 | **S** (rides #12) | `ws-restore` ccd:2157, or full reap's `_reg_purge` | permanent in the common archived-never-reaped case; individually tiny | KB, ×10 archived |
| 14 | `.reaped/<id>.json` tombstones | registry | `_ws_tombstone` ccd:4587 — *"the one document that outlives the workspace"* | **O** operator-permanent (proposed ruling — §Open Q5) | **none, anywhere** (`grep "rm.*reaped" ccd/ccd` → nothing) | none, **if** the O ruling is confirmed; today it is an *unstated* default, which is itself the defect | one small JSON per reaped workspace, uncapped |
| 15 | `refs/ccrc/attic/<id>/*` git refs | inside each main repo's `.git` | `_ws_attic_pin` ccd:4302-4355, up to **201 refs per reap** | **O** operator-permanent **with a byte caveat** (§Open Q4) | `ccd ws-attic --drop`, terminal-only and excluded from the PWA/agent whitelist by design (ccd:2181-2183) | the refs are ~50 bytes; **what they retain is the cost** — by design they pin every commit on a reaped branch against `git gc`'s `pruneExpire`, forever ("Attic refs are never garbage-collected on a timer", ccd:2183) | refs negligible; pinned object graph unmeasured — **the one number no scout could produce** |
| 16 | `~/ccrc-backups/<YYYYMMDD-HHMMSS>/` (fleet host copy) | declared | `backup-coord.mjs:34` (`VACUUM INTO`, temp-then-rename), per deploy | **R** ring-capped | `prune_backups` deploy.sh:59-63, `CCRC_BACKUP_KEEP=10`; called after **both** targets (deploy.sh:198, 249) | **none — the exemplar.** Verified working on both boxes independently | 5.1M / 9 dirs, Aug 5→11 |
| 17 | `~/ccrc-backups/pre-flip-agent-dist/` | declared root, non-timestamped | hand-made, one-off | **O** — must be *declared* permanent, not silently exempt | none: outside the timestamp glob **by deliberate design** (deploy.sh's own comment) | the exemption is correct; the *silence* is the defect. An unbounded sibling nobody declared | tiny, permanent |
| 18 | `~/.local/bin/ccd.bak-*`, `ccd.pre-flip` | `~/.local/bin` | ad hoc, by hand | **R** ring-capped (proposed) | none | a second, ungoverned backup lineage predating #16 — same shape as the big leaks at 1/10000th the size | 5 files / 1.4M |
| 19 | `~/.cc-secrets/*` | declared | out of scope | **O** operator-permanent | n/a | none | 16K / 3 files (existence+size only, contents never read) |
| 20 | `~/.cc-limits/<wrapper>.json` | declared | `statusline-command.sh:161-167`, tmp+rename overwrite | **X** singleton-overwrite | overwritten in place | none | bounded by wrapper count (4-5), not session count |

### A.2 — Server box (server-box, 203.0.113.7; `/` 150G, 102G used, 43G free = 71%)

| # | class | creator (file:line) | pattern | current deleter | gap vs policy | measured today |
|---|---|---|---|---|---|---|
| 21 | `feed_events` rows | `recordFeedEvent` store.ts:1101 | **R** ring-capped | store.ts:1104 `DELETE FROM feed_events WHERE id NOT IN (… LIMIT ?)`, `FEED_RETENTION = 2000` store.ts:1081, **in the same transaction as every insert** | **none — the exemplar, and the only `DELETE FROM` in the entire repository** (verified: `grep -rn "DELETE FROM"` across server/ ccd/ shared/ agent/ deploy/ pwa/ → 1 hit) | 107 / 2000 rows |
| 22 | `programs` rows | store.ts:231, 1276 | **P** programme-bound | **none** | no DELETE, no TTL, no archival, no cap | 0 rows |
| 23 | `runs` rows | store.ts:235, 1302; `closeRun` only UPDATEs `state` (close.ts:60-170) | **P** | **none** | the team already *found* this: store.ts:437-452's docstring records that `GET /api/runs?closed=1` "walked the entire runs table, forever, with no LIMIT and no retention" and that the fix **clamped the read only** — *"the archive half… grows without bound"* is written down as accepted fact | 0 rows |
| 24 | `run_events` rows | store.ts:277, sole writer `CoordStore.advance` store.ts:252 | **P** | **none** | `RUN_TRANSITIONS` (shared/api.ts:1740) gives a happy-path floor of **6 permanent rows per run** (planned→dispatched→working→awaiting-review→merging→closing→done), more per bounce (`working↔awaiting-review↔merging` is a legal cycle) | 0 rows |
| 25 | `work_items` rows | `addWorkItem` store.ts:622/624 | **P** | **none** | uncapped; a `done`/`abandoned` item just sits in that state forever | 0 rows |
| 26 | `mail` + `mail_deliveries` rows | store.ts:647, 785 | **P** | **none** — delivery state cycles queued→delivered→acked/rejected *in place* | **every message costs 2 permanent rows, and they are not the same size**: the delivery row stores the *rendered envelope*, a second and larger copy (envelope.ts: *"RENDERED ONCE, AT QUEUE TIME, AND STORED… a replay is byte-identical because it is the same string"*). Body capped at 8KiB (`MAIL_BODY_MAX_BYTES`) — so per-message cost is real, not nominal | 0 / 0 rows |
| 27 | `mail_rejections` rows | store.ts:1050 | **P** *(contestable — ring vs security ledger, §Open Q8ii)* | **none** — no analogous cap to #21 | **live proof that non-programme traffic accumulates permanently**: 7 rows already, all dev/smoke-test probes (`fromId:"probe-sender"`, `toId:"no-such-session-probe"`, `subject:"probe"`) | **7 rows** |
| 28 | `coordinator_state` row | — | **X** singleton | n/a | none — fixed singleton | 1 row |
| 29 | coord.db file itself | `db.ts` | — | never `VACUUM`ed, never `wal_checkpoint`ed: db.ts:162 sets `PRAGMA journal_mode = WAL` and nothing in the file issues either. The only `VACUUM INTO` in the repo (backup-coord.mjs:34) runs against a **copy** | compaction (§5) is unimplementable without adding a VACUUM path to the live file | 77KB main / 24 pages / freelist 0; `-wal` 976KB (normal, and backup-coord.mjs's header already cites this exact ratio as its reason for `VACUUM INTO` over `cp`) |
| 30 | `~/ccrc-backups/` (server copy) | as #16 | **R** | `prune_backups`, same code | none — verified independently on the live box: **exactly 10** dirs, 20260807-035654→20260811-065329, oldest visibly pruned as new land | 10 dirs × ~1.4-1.5MB ≈ 14MB (coord.db snapshot ~94KB + dist-pwa ~1.4MB) |
| 31 | `~/ccrc-src-backup-20260728-120810.tgz` | hand-made, loose in `$HOME` | **O** or **R** — ruling (§Open Q8iv) | none — outside `~/ccrc-backups` and thus outside `prune_backups` entirely | same class as #17: a hand-made sibling the timestamp glob was *designed* not to sweep | 121KB |
| 32 | `~/ccrc/server/node_modules` | `npm ci` per deploy | **X** replace-in-place | `npm ci` replaces it | none — not additive | 170MB (largest item in the deploy tree) |
| 33 | `notify-log` ring | notifylog.ts:54-57 | **R** ring-capped | in-memory splice, same call, `RING = 200`; the on-disk file holds only `{epoch, seq}` (:87) | none | 58B on disk |
| 34 | `state-cache.json`, `push-subs.json` | fleetstate.ts:33,41 | **X** singleton-overwrite | tmp+rename overwrite every write | none | 18.7KB / 733B |
| 35 | `/var/log/journal` | journald | **UNASSIGNED — out of this repo's remit, but on its box (§Open Q10)** | journald defaults; **no explicit `SystemMaxUse`** in journald.conf | uncapped by explicit config; not urgent at 43G free | 478MB (470MB current + 8.1MB stale machine-id) |
| 36 | server-box `~/.cache` 7.8G, `~/.npm` 5.0G, `~/.pnpm-store` 1.6G, several multi-GB `~/.claude*` homes | generic tooling | **UNASSIGNED (§Open Q9)** | none | this box also carries `~/.cc-sessions` (57 files) and multiple `~/.claude*` wrapper homes the brief assigned to the fleet host — **either it doubles as a fleet member or these are legacy**; unresolved | the bulk of its 102G |

### A.3 — Scout reconciliation (the three reports agree; where they appear not to, here is why)

1. **`~/ccrc-backups` counted twice, correctly.** Scout 1: 9 dirs / 5.1M (fleet host). Scout 2: 10 dirs / ~14MB (server box). Not a contradiction — `prune_backups` is called after **both** the agent-target and server-target deploys (deploy.sh:198 and :249), so each box keeps its own independently-pruned ring. Both under keep=10. Both correct.
2. **"42G of worktrees" vs "18G of worktrees".** `ws-gc`'s scan spans every project under `$PROJECTS_ROOT`, not `~/worktrees` — so 42G/94 is ccd's 18G **plus** the ~28G foreign `.claude/worktrees` pool (#6). Scout 1's own caveat stands: the data-internal set is enumerated twice (once as project `data-internal`, once via sibling repo `wt-model-rates-sync`, itself a worktree of data-internal), so unique < 42G, though `du -scb`'s inode dedup (ccd:6437's own comment: *"it de-dupes inodes shared between worktrees, so this is the exact figure that removing the lot would free"*) likely already collapses the headline total.
3. **Disk pressure figure.** Brief said 98%, scout 1 measured 92%, I re-measured now: **301G / 266G used / 23G free = 93%**. All three are consistent with #7 climbing ~12GB/day ≈ 4 points of `/` per day. The runway number (~2 days) is the one that matters and all three agree on it.
4. **coord.db, code vs live, agree exactly.** Scout 3's static read (one `DELETE FROM`, feed_events only) and scout 2's live `readOnly` query (0 rows in six of eight tables, 7 in mail_rejections, 107 in feed_events) are the same finding from both ends. The critical inference: **today's coord.db is 77KB because no programme has closed a run through this box's ledger yet — not because the code prevents growth.**
5. **`ccd forget` cannot have caused the orphans (#5).** Scout 1 and scout 3 independently establish this: `cmd_forget` refuses on any id with a non-empty `workspace` (ccd:7096-7098). The orphans are near-certainly `git worktree add` checkouts made outside `ccd ws-add` — i.e. **class-A containment violations**, not registry corruption. That distinction is what puts them under §1's rule rather than §2's.
6. **Nothing contradicted.** The three scouts disagree on no fact. The only unmeasured quantity in the whole inventory is #15's pinned object graph.

---

## Open questions — operator rulings required

- TRANSCRIPT RETENTION (#10, 7.0G, blocks the largest term in the steady-state model). Do transcripts have value beyond engineering debugging — compliance, product analytics, training corpus, dispute record? That answer sets the pattern: O (permanent, needs a size discipline to be affordable) versus P/S with a horizon. Two sub-rulings regardless of the first: (a) what horizon — 30/90/365 days, or 'until the session is reaped'? (b) is the 2-3x duplication across wrapper HOMEs intentional per-account isolation, or an artifact? One rp-llm conversation occupies 1.68G as three near-verbatim copies (584M/550M/549M); if it is an artifact, de-dup alone returns ~2/3 of the largest transcripts with no retention decision at all. Note the constraint: no verb to delete a transcript exists anywhere in the repo today, so any ruling other than 'permanent' requires building the first one.
- THE ARCHIVED-TO-REAPED HORIZON (#4, 9.77G today, the policy's centrepiece). How many days does an archived-and-unreaped workspace sit before Tier-B auto-reap fires? And does the kill-switch default ON (collect unless stopped) or OFF (opt in per box)? This directly negotiates with ccd's own written design stance (ccd:6386-6389: 'Archived is the STAGING for a confirmed deletion, not a queue a sweep drains. No timer, no grace window'). The proposal argues evidence-plus-time-twice-observed satisfies 'confirmed' at fleet scale, but that comment was written deliberately and only its author or the operator can overrule it. If the answer is 'never automate this', the policy still holds — but the W pattern's collection edge becomes Tier C and the steady-state number in section 6 does not apply.
- COORD.DB: COMPACT OR KEEP FOREVER (#22-27, seven insert-only tables)? Specifically: is envelope.ts's byte-identical mail replay guarantee required forever, or only while a delivery is outstanding? Compaction nulls the rendered envelope on old deliveries and breaks replay past the horizon while preserving the delivery row, its states and timestamps. If replay must hold forever, mail_deliveries becomes O and the ledger grows unbounded by ruling rather than by accident — which is a legitimate answer, but it should be a decision. Related and required either way: adding a VACUUM path to the LIVE coord.db (nothing in the repo ever VACUUMs or checkpoints it — db.ts:162 sets WAL and stops there), without which compaction returns pages to the freelist and zero bytes to the filesystem, and every one of the 10 retained backups keeps carrying them.
- ATTIC REFS AND THEIR PINNED OBJECT GRAPH (#15). refs/ccrc/attic/<id>/* (up to 201 per reap) are documented in-code as never garbage-collected on a timer, and their explicit purpose is to keep every commit on a reaped branch referenced against git gc's pruneExpire, permanently. The refs are ~50 bytes; the retained object graph is THE ONE QUANTITY NO SCOUT COULD MEASURE. Ruling needed: is 'a reaped branch is recoverable forever' a hard requirement, or does the pin drop at a horizon (e.g. 180 days post-reap)? This is load-bearing for Tier B: the attic pin is exactly what makes auto-reap reversible-in-substance and therefore automatable at all. A horizon here converts Tier B's guarantee into a time-limited one, and that trade should be made knowingly. (A measurement pass — git count-objects against the pinned refs — is worth commissioning before ruling.)
- THE FOREIGN WORKTREE ECOSYSTEM (#6, ~28G — comparable to or larger than everything ccd manages). <project>/.claude/worktrees/* is a SECOND worktree mechanism (Claude Code's own subagent/workflow checkouts) that this system is unaware of and that ccd refuses to touch on principle ('ccd removes only what it created'). expoAI-assistant alone holds ~35 of them at 0.7-1.2G each, several idle 11-21 sample-units; custom-tools has one at 4.8G idle 21. Ruling: (a) extend ccd's remit to adopt and govern them, (b) build a separate collector owned by whoever owns that mechanism, or (c) declare them operator-only forever with audit visibility and no automatic collection. This is the largest unassigned class in the inventory and the policy cannot assign it without an owner.
- WHO CREATES /tmp/cdk.out<rand6> (#7, 11G, ~12GB/day, the fastest path to filling the disk)? No scout could find an owner — not ccd, not a systemd timer, not crontab. Something runs `cdk synth` against a fresh `mktemp -d` per invocation and never cleans up. The ruling that matters is which remedy: (a) CONTAIN — move the writer inside a workspace, after which it is W-pattern and free to govern, no collector needed (strongly preferred, per policy section 1.2); or (b) COLLECT — accept the /tmp write and add an E-pattern age-based sweep. (a) requires identifying and editing the writer; (b) requires an age horizon safe against a synth still in flight. Same question applies to the 28G custom-tools/cdk.out in the main checkout (#8), which has grown from ~20G since a prior session measured it.
- CONTESTABLE PATTERN ASSIGNMENTS — four the policy assigned but should not be assumed settled. (i) /tmp/claude-1000 scratchpads (#9, 5.8G): assigned S (session-bound), but they are keyed by WORKTREE PATH and outlive the workspace — a case could be made for W. The distinction decides whether reap collects them or session-death does. (ii) mail_rejections (#27): assigned P (programme ledger), but it could equally be R (ring-capped, exactly like feed_events) — the deciding question is whether a refusal record has SECURITY value worth keeping past the ring. Live evidence sharpens this: its 7 current rows are all smoke-test probes, i.e. noise, but a real rejection may be the only trace of an attempted unauthorised send. (iii) .cc-clips (#11): assigned S, but pasted screenshots are USER content, not system state — arguably O, or a longer horizon than the session's. (iv) the one-off backup strays — ~/ccrc-backups/pre-flip-agent-dist (#17), ~/ccrc-src-backup-*.tgz (#31), ~/.local/bin/ccd.bak-* (#18): each is trivially small and permanently unmanaged. Declare each explicitly O (a deliberate keepsake, recorded in the manifest) or fold them into a retention glob? The bytes are irrelevant; the precedent is not — these are the exact shape of the big leaks, and how the policy treats a 1.4M version of the defect sets how seriously it treats the class.
- SCOPE OF THE POLICY BEYOND THIS REPO'S ARTIFACTS. Does the lifecycle policy cover generic tooling caches on the server box (~/.cache 7.8G, ~/.npm 5.0G, ~/.pnpm-store 1.6G — the bulk of its 102G), or are they explicitly out of remit and out of the audit? Related and unresolved by any scout: the server box ALSO carries ~/.cc-sessions (57 files) and multiple ~/.claude* wrapper-config homes, which the brief assigned exclusively to the fleet host. Either that box doubles as a fleet member (in which case the whole fleet-host section of this policy applies to it too, and section 6's steady-state number needs a second instance) or those dirs are legacy/orphaned (in which case they are themselves an undeclared artifact class awaiting collection). This must be resolved before the audit can report drift on that box without either false positives or blind spots.
- DECLARED BYTE BUDGET PER BOX. The audit (section 4d) reports drift against declared lifecycles, but without a per-box disk budget 'overdue' can only ever mean 'past its age bound' — never 'over budget'. Does the operator want a declared budget per box (e.g. fleet host: 200G soft / 250G hard against 301G total) so the audit can escalate on bytes as well as age, and so section 6's ~38G steady-state estimate has something to be measured against? Without one, the policy can detect an artifact that outlived its rule but not a fleet that is collectively too large while every individual class is compliant.
- JOURNALD RETENTION (#35, 478MB on the server box, not urgent at 43G free). journald.conf sets no explicit SystemMaxUse or retention; defaults apply, and 8.1MB is stale from a prior provisioning's machine-id. Out of this repo's remit but on its box: declare an explicit bound (making it a governed class in the manifest) or record an explicit ruling that OS-level logging is outside the policy? Either answer is fine; the unstated default is what the policy forbids.
