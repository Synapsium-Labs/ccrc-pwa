# Graphify-aware compaction: the structural card, the steering, the measurement — design

**Date:** 2026-09-09
**Status:** design approved in five sections by the operator (2026-09-09); **amended 2026-09-10** after the
payload measurement of §0.2 came back negative — the subagent guard became the scope rule of §3.0, on the
operator's direction that compaction works for a subagent exactly as for the main thread. The first draft of
§3.0 (newest file wins) was refuted by an adversarial review the same day and replaced by the liveness rule,
which answers `ambiguous` where it cannot answer. A second review of that rule and of Plan A (2026-09-10, four
agents) closed the remaining holes named in §3.0–§3.4 and Plan A's ledger (D-2411–D-2420). **D-2605 round 5
(2026-09-12) consolidates the final pre-Task-9 contract:** the journal is the sole measurement sink; immutable
ccrc row generation authorizes every compaction-lifecycle mutation; and a permanent per-session lock is published
only by a private `mktemp` source plus atomic hard link, never opened at its canonical pathname. PreCompact,
SessionStart(compact), PostCompact, registry-row creation, and purge use that one lock; ordinary hook paths remain
lock-free. Compact SessionStart validates generation and safely acquires/revalidates the lock before every
lifecycle observation, then holds it through match, claim, emit, and nonce-marker publication. PostCompact
retains an identity-checked private claim FD, unlinks canonical before touching that claim, and performs final
journal work and any cleanup only under a safely reacquired validated lock. The raw JSONL predicate, exact family
inventory, row/spawn/purge ownership, and honest crash/replay limits are in §3.4. **Round 6 (2026-09-13, this edit) closes five Important and nine Minor findings from two independent reviews of round 5's commit, entirely within this already-allocated D-2605 scope — no new deviation number:** the migration paragraph's hook set-temp grammar is corrected to the measured `<pid>.<id>.compactset.tmp` (the hook writes no card temp at all; the card file is the helper's alone); PreCompact and `_spawn_start` now CLOSE the stable lock before forking — the helper subprocess and the tmux server, respectively — and REACQUIRE after (PreCompact only; `_spawn_start` has nothing left to do under lock once its child env is built), because a held `flock` descriptor is inherited across fork/exec in bash and survives until every referencing descriptor closes, so no compliant design may hold one across a fork it does not control; PostCompact's final journal transaction gets its own longer, separately argued wait bound distinct from the shared `COMPACT_JOURNAL_LOCK_WAIT`, because its loss is unrecoverable where settlement's own residue is not; settlement gains an explicit genuinely-absent-canonical-set branch that commits one null-scope, null-provenance record instead of silently folding into the link-failure no-record branch; and `_reg_purge`'s three post-action callers report a named `_lc_fail`, never a suppressed success string, on a lock-miss. **Round 7 (2026-09-13) overturns round 6's own justification after an architecture
adjudication.** Round 6 let PreCompact release the stable lock across the bounded helper's canonical rewrite,
arguing the rewrite was "already gated on nonce ownership" — measured false: the helper's slot check
(`slotIsMine`) and its canonical write are two separate steps, check-then-act, not a compare-and-swap, so a
sibling PreCompact can acquire the freed lock, publish `scope:"ambiguous"` and remove the card, after which the
first helper's own rename destroys that verdict. The ruling adopts **Option A, a staging-only helper**: no
canonical pathname may appear in the helper's argv at all. The helper becomes a pure function of
transcript/graph/labels that writes two private stage files (named by the hook, passed as `--set-stage` and
`--card-stage`); every ownership decision, canonical publication and rollback question moves into the bash arm,
whose deciding section forks only synchronous children it reaps before leaving that section, so the
close-before-fork rule is satisfied there rather than disapplied. Two alternatives were measured unbuildable/unsafe
and rejected (a helper-held lock — node core has no `flock` binding; a helper launched under external
`flock(1)` — independently reproduced to create canonical paths, outlive its own invocation, and split the
critical section across two inodes), and accepting the race outright is forbidden by §3.0's own rule. §3.0's
ownership paragraph, §3.1's protocol, §3.2's helper contract, §3.4's artifact table and wait constants, and
§10's residual are rewritten to this ruling. Tasks 5 and 6's already-shipped `slotIsMine`/rollback code is
superseded, not rewritten, by Task 9 — recorded there and in the D-2605 ledger entry, not pretended away. Plan A is written and Tasks 1–8
are implemented; Task 9 is not. **Round 8 (2026-09-13) closes the provenance channel round 7's argv change
severed, and ten further Important findings from the same two-review round, entirely within this
already-allocated D-2605 scope — no new deviation number.** Option A's helper lost its only source for
`parentLive`/`liveAgents` when `--set` left its argv — it used to re-read them off the canonical set — and
nothing replaced that read, so every carded compaction would have published an impossible provenance tuple.
Fix: `--parent-live`/`--live-agents` join the `card` argv, copied verbatim into the staged set exactly as
`--scope`/`--agent`/`--at`/`--nonce` already are, since PreCompact has already computed their final values
(§3.0) before the helper ever runs; `--trigger` is deliberately NOT added, because these two explicit values
already pin the exact §3.0 matrix row without the helper deriving anything. Also in round 8: `steered` is
stamped by a private `jq` rewrite of the still-unrenamed set-stage (never a rename that somehow "carries" a
value, and never a rewrite of canonical); `COMPACT_LOCK_WAIT_SERVE` is named explicitly at compact
SessionStart's one acquisition; the helper's `.part` residue is named `<stage>.part`, with no second,
hook-unlearnable helper pid appended to a stage name that already carries the hook's; `_ws_slug_free` (Task 9)
is widened to an exact-family dot-leading scan so residue actually blocks slug reuse, the permanent lock its
sole named exclusion; `_hook_compact_served` and its canonical `set.served` rewrite
(`ccd/session-hook.sh:985-992`, called at `:1375`) join Task 9's deletion scope, superseded by the
nonce-marker publication §3.3 already specifies; the §2 diagram's ordering is corrected to match §3.1
(scope/graph-measure run lock-free, before acquisition); and the rollback-function deletion range is
corrected to `:792-842` (`:843` is blank, `:844` starts the next section banner) everywhere it previously
read `:792-847`. **Round 9 (2026-09-13) closes eleven Important and sixteen Minor findings from two more
independent reviews, entirely within this already-allocated D-2605 scope — no new deviation number.** Almost
every one was an UNMEASURED ASSERTION about bash, jq, or the shipped code, so each correction below is stated
with the probe or `grep -n` that establishes it. **Anchors are per-engine, not blanket:** §3.3's nonce
validator is respelled `^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$` for bash, which has no `\z` and reads it as a
literal `z` (measured: the `\z` spelling rejects every well-formed nonce and accepts exactly one ending in a
literal `z`), while jq/Oniguruma keeps `\z`; §3.4 states the rule once and §6's blanket "exact `\z` anchors …
remain unchanged" — the sentence that made copying `\z` into a bash arm the natural error — is retired.
**Compact SessionStart's held lock is justified correctly:** the arm forks repeatedly (`find`, `rm`, a `( )`
subshell, `mv`, `link`, `jq`, and the marker `mktemp`), and a held `{fd}<>` descriptor is measurably inherited
across fork/exec, so the close-before-fork rule APPLIES there and is SATISFIED by every child being
synchronous and reaped in-section — never disapplied, as round 8's text had it. **The absent-canonical source
scan is INVERTED:** the literal-adjacency recognizer matched zero real mutation sites (measured), so the scan
now enumerates primitives and resolves the canonical pathname through the variables bound to it, with a
mandatory non-vacuity control. **The two new provenance flags get a wire contract:** empty means JSON null,
`Number(v)` on a possibly-empty value is forbidden and named as the trap, and §5's mutation row gains the
`manual`/`main` leg — the only leg that can red a derivation mutant. **Both surviving pre-D-2605 producers
change shape**, including the SessionStart claim, whose legacy grammar joins the transition allowance.
**`_ws_slug_residue` is widened with `_ws_slug_free`**, so `ws-add`'s refusal still names what it found.
**Lock-MECHANISM absence now has a stated blast radius (SCOPED round 10):** closed for the three hook arms;
open — gated on the absence of `$REG/<id>.generation` — for `_reg_purge` reached through
`ws-rm`/`forget`/`ws-gc --prune` only. `ws-add`, `ws-restore` and `ws-reap` keep their SHIPPED fail-closed
refusals (`ccd/ccd:4341`, `:6745`, `:10202`); round 9 asserted a blanket over "ccd's own registry operations"
without measuring any of ccd's five `command -v flock` sites, and three of the five already fail closed.
Plus enumeration and citation corrections: five `compact-card.test.ts` call sites (not four), **SEVEN**
`session-hook.test.ts` assertions on the hook-written set's `served` (round 9 said five; `:2319` and `:2491`
assert it in property position, invisible to a `\.served` grep), `CompactSet.served`, the
`(protocol steps 12–14)` off-by-one, the §2 diagram's argv line, its "set
carrying `steered`" and its two-condition `iff`, the hold-section fork enumeration, §5's steering row, the
"(stage 2 only)" scope, rc 1's "nothing written", and `_reg_purge`'s "nothing here can gate the purge" comment.
**Branch:** `ws/graphify-compaction-card`
**Predecessors:** `2026-08-27-graphify-fleet-integration-design.md` (App. B),
`2026-09-02-graphify-read-side-ccrc-level-design.md` (R1, R4, R5), and the gpt-lane wedge plan
`plans/2026-09-08-gpt-lane-compaction-wedge.md` (PR #70, merged 2026-09-09 10:26 UTC), which fixed the
*cost* of compaction on that lane and left its *content* untouched. This spec is about the content.

The operator's objective, verbatim: **"it's about fidelity and size."**

## 0. What compaction does today, measured

Every number below was produced on the fleet box on 2026-09-09 by a command the section names; nothing
is quoted from memory. Of the 24 live Claude Code processes, 22 run **2.1.266** and 2 run 2.1.267
(`pgrep -af 'versions/2\.1\.[0-9]+'`, re-measured 2026-09-09 22:00 UTC; installed: 2.1.263, 2.1.265,
2.1.266, 2.1.267). The binary facts were read from 2.1.266 and cross-checked against 2.1.263 (no
behavioural drift in any compaction path; only minified names differ) — **not** against 2.1.267, which
arrived under this spec and is a residual (§10).

### 0.1 The summary

Over the 905 compactions of the last 10 days across six of the seven configured lanes (`glm` matched no
file in the window; `find ~/.claude*/projects -name
'*.jsonl' -mtime -10`, then `jq` over `compact_boundary` / `isCompactSummary` / `attachment` rows):

| quantity | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| summary text, chars | 16,946 | 48,284 | 89,090 |
| "Files and Code Sections" share of the summary | 24% | 43% | |
| summaries carrying a fenced code block | 82% | | |
| summaries in the nine-section format | 81% | | |
| re-injected material after the summary, chars — **n=30**, the most recent compactions, 2026-09-09T05:01–13:37Z | 150,597 | 279,588 | |
| re-injection ÷ summary — same n=30 | 3.3× | 19.7× | |

The full-compaction prompt fixes nine sections (the ranged per-message path uses a sibling prompt whose
section 3 drops the "Pay special attention to the most recent messages" clause; both take hook stdout
under the same `Additional Instructions:` heading); section 3 reads, verbatim from the binary:
*"Files and Code Sections: Enumerate specific files and code sections examined, modified, or created.
Pay special attention to the most recent messages and include full code snippets where applicable and
include a summary of why this file read or edit is important."* That section is where a summary is
least reliable — code paraphrased from memory, line numbers that drift — and it is the largest one.

### 0.2 Where the levers are, and are not

- **PreCompact hook stdout reaches the summariser on every path.** Auto, manual `/compact`, and the
  ranged per-message path all join the hook's stdout into the prompt under a literal
  `Additional Instructions:` heading, **uncapped** (the 10,000-char hook cap applies to the streaming
  SessionStart/PreToolUse path, not to this one). On the **auto** path the hook is the *only* source of
  custom instructions. The `## Compact Instructions` section of a `CLAUDE.md` is **not merged by code**:
  the string occurs once in the binary, inside the prompt's own worked example, and the prompt merely
  says *"there may be additional summarization instructions provided in the included context"* — the
  model arbitrates. So steering that must cover auto-compaction lives in the hook, which is also the only
  artifact the read-side ruling allows ccrc to write.
- **SessionStart hook context is spilled to disk above 10,000 chars** and replaced by a two-kilobyte
  notice naming the file. This already happens to the operator's own `~/.cc-handoff/restore.sh` at
  every compaction (17,099 bytes emitted at this session's last one; its own cap is 24,576). It is the
  hard ceiling on anything this design injects.
- **Re-injection is Claude Code's, keyed on its read-file state**, bounded at 5 files × 5,000 tokens,
  50,000 tokens total, plus invoked skills at 5,000 each and 25,000 total. The Bash tool *does* feed
  that state for view-shaped commands (`sed -n`, `cat -n`, `head`, `tail`, `grep`); nothing outside the
  binary can change what is re-injected. That 150k-char median (n=30) is not this design's to shrink.
- **PostCompact receives `compact_summary`**, the model's raw text after Claude Code filters to text
  blocks, joins and trims — but *before* the normalisation the injected message gets (the first
  `<analysis>…</analysis>` block dropped, `<summary>…</summary>` replaced by `Summary:` plus its trimmed
  inner text, blank runs collapsed). PostCompact stdout
  is shown to the user only; it is not context.
- **Order of events**, from the binary: PreCompact → summariser → re-injection, which fires
  SessionStart(compact) → PostCompact.
- **Precomputed-compaction reuse never fires on this fleet.** A PreCompact hook that prints anything
  forfeits it (`reuse:"miss_hook"`), so the risk had to be measured: of 905 compactions, **none**
  finished under 30 s (minimum 79 s), so nothing is forfeited today. Recorded per compaction
  (`steered`) so it stays measurable if that changes.
- **Subagent compactions fire all three hooks with payloads identical to the main thread's** — the
  *parent's* `session_id` and `transcript_path`, and **no `agent_type` or `agent_id` key at all**.
  Measured 2026-09-09 on 2.1.266: five headless runs through a fixture-HOME lane, the three payloads
  captured for five main-thread and two subagent compactions; the key sets are byte-identical
  (PreCompact: `custom_instructions cwd hook_event_name prompt_id session_id transcript_path trigger`;
  PostCompact: the same with `compact_summary` for `custom_instructions`; SessionStart(compact): `cwd
  hook_event_name model prompt_id session_id source transcript_path`). `prompt_id` does not help either:
  a subagent's rows carry the *parent's* `promptId` (two Workflow agents and fourteen parent rows of this
  session share one), and no `CLAUDE_*` environment variable in the binary names an agent.
- **Where a subagent's compaction lands, measured on the same runs.** The subagent's transcript is
  `<dirname transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl` for an `Agent`-tool
  subagent and `…/subagents/workflows/<run>/agent-<agent_id>.jsonl` for a Workflow agent (this session's
  own directory: 0 direct, 42–78 under `workflows/` per lane). A subagent that compacted twice wrote
  **both `compact_boundary` rows and both `isCompactSummary` rows into its own transcript** (the parent's
  carried none), and the SessionStart(compact) hook context landed there too, as
  `hook_additional_context` attachments — the card reaches the context that compacted. The parent's
  transcript does **not** yet carry a new `compact_boundary` when any of the three hooks fire, and the
  summariser's own `SubagentStop`, which fires during a main-thread compaction, writes no transcript.
- **What the filesystem can and cannot say about who is compacting** (measured 2026-09-10 on this box's
  own corpus): a compacting context writes nothing for the whole compaction (≥79 s, the floor above),
  so it is never the newest file for long; a parent waiting on a Workflow fan-out writes nothing at all
  (16 minutes without a row in one run of this session); Workflow agents start seven and eight at a
  time within 3 ms and run concurrently for 13–39 minutes, writing a row every 4–6 s with gaps over
  79 s in 1–2% of rows; and 5 of 197 main-thread compaction boundaries had a subagent transcript newer
  than the parent's last row. **At its own auto-compaction the parent is always live**: over 216 auto
  boundaries on this box's corpus, the parent's last assistant/user row preceded PreCompact by 0.8 s at
  p50, 3.7 s at p95, 28 s at most — never 120 s (manual compactions can be older, and are `main` by
  rule). §3.0 is built on exactly these facts, and it is why "newest file" was refuted and liveness is
  the rule.
- **Every hook payload carries `transcript_path`**, empty for served sessions.

### 0.3 The prototypes

- **Working set from the transcript.** In this session 162 of 179 tool calls were `Bash`, 9 were
  `Read`/`Edit`/`Write`: bypass-permissions mode routes reads through `cat`/`sed`/`grep`, so a derivation
  keyed on the `Read` tool alone would be near-empty. Mining path-like tokens out of every tool input and
  resolving them against the graph's own 820 `source_file` values (that graph's count; the one built at
  988ac1f4 carries 853) resolved 87 of 152 tokens with zero ambiguity over the whole 3.9 MB transcript —
  15 files (the rest were outside the tree or not in the graph); the card prototype below was fed 9 of
  those 15, the ones with graph symbols. The design's own window — since the last boundary, which sat at 77% of that file and left 19
  tool calls — resolved 11 tokens into **2 files**: right after a compaction the window is thin, which is
  why §3.2 also mines the previous summary's text. Cost: the boundary lookup 0.008–0.015 s; the whole
  `jq` prototype 0.836 s, of which ~0.38 s was the 9 MB graph's file list (3.4 s at 70 MB) — the cost the
  node helper removes by parsing the graph once.
- **The card from the graph.** A community-centric card is the wrong shape: a 9-file set from this
  session's whole transcript touches **50 of 474 communities**, and listing them consumed the whole budget at 2,400, 4,000 and 6,000
  chars while the file-specific sections came out empty. The `graphify` CLI cannot stand in
  (`explain` 1.38 s, `path` 1.72 s, `query` 1.46 s, each single-node, none takes a file set). Node's
  `JSON.parse` of `graph.json`, measured directly in three runs: 0.13–0.18 s at 9 MB and 1.15 s at 70 MB
  (MekWarLive); python's `json.load` measured 0.13 s at 9 MB in the prototype — equivalent, and
  untestable from vitest. Degree is a fair god-node proxy: the community label equals its top-degree node in 76–100% of
  touched communities, so a card that prints the label need not repeat the first god node.

## 1. The rule

**What the graph knows about the code a context was in is injected, computed, after every
compaction — the main thread's or a subagent's; the summariser is told it will be; and the summary is
measured for whether it changed.**

Goals: (1) *fidelity* — the files, symbols and dependents a context was working in survive compaction
exactly, not as the model remembers them; (2) *size* — the summary stops pasting code it can cite;
(3) *measured* — the effect is a number per compaction in the per-session journal, never an assertion.

Non-goals, stated: compaction time and the gpt-lane wedge (PR #70); Claude Code's re-injection;
Claude Code's summariser prompt; anything in a `CLAUDE.md`; the graph's write side.

Honest size ceiling: at the median the snippet section is ~4k chars and the card costs up to 4k, so
steering makes the summary roughly size-neutral; at the tail the snippet section is ~20k chars and
halving it saves far more than the card costs. **Fidelity is the headline; size is a tail win.**

## 2. Architecture

One ccrc-owned hook, `ccd/session-hook.sh`, gains behaviour in its three existing compaction arms, and
one new ccrc-owned helper, `ccd/compact-card.mjs`, does the work that needs a JSON parser. No new hook
events; `install-session-hooks.sh`'s event list is unchanged.

```
(every arm below is inert while ~/.ccrc/compact-card-off exists. ONLY PreCompact decides WHICH
 context is compacting — main, subagent or ambiguous — by the liveness rule of §3.0; later arms
 preserve that answer from the same nonce and never resolve)
private mktemp source --link--> $REG/.<id>.compactions.lock (permanent regular inode; never replaced/unlinked)
   │                         └─► ccrc row creation, _spawn_start and _reg_purge use this same mutex
PreCompact ──► scope + graph-measure (no lock) ──► lock, generation validate, overlap/young-claim check
   │          └─► $REG/<id>.compactset   (JSON: at, nonce, scope, provenance; files null)
   │          └─► CLOSE lock (no descriptor open across the fork below) ─► helper `card`, never for ambiguous
   │                    ─► --set-stage, --card-stage, --parent-live, --live-agents  (two PRIVATE files plus two
   │                        copied provenance values; NO canonical pathname in argv at all — the helper is a
   │                        pure function of transcript/graph/labels plus the hook's copied provenance values;
   │                        it publishes nothing)
   │          └─► REACQUIRE lock, generation + nonce-ownership revalidate: rc 0 renames card-stage then
   │              set-stage into canonical (card first; then `steered` is stamped into the still-private
   │              set-stage by one `jq` rewrite, and only then is that stage renamed into canonical); rc 3 renames only
   │              set-stage; any other rc, or a failed revalidation, publishes nothing and removes only this
   │              process's own stages — then release. A held flock is inherited across fork/exec, so it is
   │              never open while the helper subprocess runs
   └─ stage 2: prints STEER_TEXT iff the helper exited 0, nonce ownership was reconfirmed under the
      reacquired lock, the card-stage rename landed, and the steer switch is absent
summariser  (Claude Code; reads Additional Instructions)
SessionStart(compact) ──► lock, generation validate, atomically claim matching card, emit envelope, then publish
                          $REG/.<id>.compactserved.<nonce> from an owned private source before unlock
PostCompact ──► lock, generation validate, record canonical age, hard-link it to an absent private claim, retain
                a verified read FD of that claim, unlink canonical alias, then touch claim before release
   └─► helper `measure` reads only the retained FD (or its FD-derived private snapshot), never a reopened claim path
       └─► lock again, generation/claim-FD revalidate, FD-validate old JSONL, stage old bytes + one record, then rename
The journal is Plan A's sole authoritative measurement sink; readers derive ordinal from physical line position.
Task 9 creates no hookstate field and Plan A has no wire/chip hop.
```

**Staging.** Stage 1 ships card and measurement; Plan A has no wire. Stage 2, a separate PR after a
baseline window, ships the print. Every measurement carries `steered: true|false`, so the delta is
measured against unsteered compactions that were recorded with the card already present.

**Runtime.** The helper is plain node with no imports beyond `node:*` — the `shared/mark.mjs` precedent
for a deploy-side script the PWA never bundles — installed beside the hook by `deploy.sh`'s agent lane
(`install_atomic ccd/compact-card.mjs .cc-sessions/compact-card.mjs 644`, backed up like the hook). It is
unit-tested by vitest directly. The fleet box already runs node 22+ for `ccrc-agent`.

**Constants, each defined once, in the hook unless noted:**

| name | value | where | why |
| --- | ---: | --- | --- |
| `COMPACT_CARD_MAX_CHARS` | 4000 | hook, passed to the helper as `--max-chars` | the card's ceiling; clipped again at the read |
| `CARD_MAX_CHARS` | 2400 | hook (exists) — the emitter's clip today, kept as the **first** of two clips | the standing subjects' ceiling; the only defence for the ungated `GM_NODES` (D-1899), so it stays |
| `CARD_TOTAL_MAX_CHARS` | 6401 = `CARD_MAX_CHARS` + 1 (the join) + `COMPACT_CARD_MAX_CHARS`, derived | hook, the emitter's **second** clip, after the compact subject is appended | a pin on the sum, never a third budget: it cannot cut what the two clips admitted; pinned `< HARNESS_CONTEXT_SPILL_CHARS` |
| `HARNESS_CONTEXT_SPILL_CHARS` | 10000 | test constant, documented harness fact (2.1.266 `Pdr=1e4`) | above it the harness spills the context to disk |
| `COMPACT_CARD_MAX_AGE` | 1200 s | hook | the in-flight window: a card or canonical set older than this belongs to no compaction that can still arrive and is removed unread; an unconsumed canonical set *younger* than this at PreCompact means overlap (§3.0). At settlement, PostCompact saves the canonical set's age for provenance eligibility, then touches the hard-linked private claim so claim mtime instead signals active liveness until it is consumed or later stale-swept. An originally aged claim permits nonce-only marker settlement, never measurement provenance. Argued from the longest measured compaction, 826 s on the gpt lane, ×1.45 |
| `COMPACT_LIVE_S` | 120 s | hook | a transcript written inside this window is a live context (§3.0); measured cadence 4–6 s per row, gaps over 79 s in 1–2% of rows |
| `COMPACT_HELPER_TIMEOUT` | 8 s | hook | `timeout` around both helper calls, argued in §3.1 from measured inputs and **re-measured on the fleet's real graphs before it ships** (Plan A, Task 6); the first half of R2 |
| `COMPACT_LOCK_WAIT_SERVE` | 2 s | hook, compact SessionStart's acquisition ALONE | The one acquisition with a human waiting on it; a miss costs only the card, recorded honestly as `served:false`. Round 7 splits this from the shared wait below because SessionStart's cost model (a human waiting) is not PreCompact's or PostCompact's (a durable artifact lost off the hot path) |
| `COMPACT_LOCK_WAIT` | 5 s | hook and ccd lifecycle helpers | `flock -w "$1"` — the wait is the acquire helper's **first positional parameter**, never a constant spelled inside the helper, which is what lets `COMPACT_LOCK_WAIT_SERVE` and this constant coexist as two independently callable bounds. Used for every acquisition except compact SessionStart's: PreCompact's two acquisitions (initial, and the reacquire after the helper returns), PostCompact's settlement acquisition and its final-transaction reacquisition, row creation, `_spawn_start`, and `_reg_purge` — all off the hot path, each losing a durable artifact (a set, a card, a journal line) on a miss rather than costing a human a wait. Round 6's separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT` is retired: under round 7's option-A protocol PostCompact's settlement and final-transaction acquisitions are symmetric with PreCompact's two (both off the hot path, both losing a durable artifact on a miss), so they share this one bound rather than each inventing its own. Task 9 measures each held section's p95 and max on the fleet box the way Task 6 measured the helper (with `_hook_graph_measure` moved out of the lock, §3.1) and sets this bound at ≥ 8× measured p95 rounded up — 5 s stands only if that measurement supports it; fix the method, the number follows |
| `WINDOW_CAP` | 16 MiB | helper | the transcript window when no boundary exists — a transcript that has never compacted is far smaller (auto-compaction fires long before) |
| `GRAPH_MAX_BYTES` | 96 MiB | helper | a larger `graph.json` is not parsed (peak RSS runs ~5× the file; the 70 MB MekWarLive graph passes, measured at 1.15 s) — the set stands with `files: null` |
| `COMPACT_WORKSET_MAX` | 12 | hook, passed to the helper as `--max-files` | files on the card |
| `WORKSET_CAP` | 100 | helper | files the set file keeps |
| `GRAPH_GATE_MAX_BEHIND` | 10 | hook (exists) | the freshness predicate, shared with the gate |
| `~/.ccrc/compact-card-off` | file | operator switch, honoured by all three arms | the whole feature off: no card, no steering, no measurement |
| `~/.ccrc/compact-steer-off` | file | operator switch | stage 2's print off; card and measurement stay |

## 3. Mechanisms

### 3.0 Which transcript is compacting — the scope rule

Compaction is **one mechanism for the main thread and for every subagent** (operator direction,
2026-09-10: a subagent's context fills and compacts the same way, and its summary has the same fidelity
problem). The payload cannot say which one fired the hook (§0.2), and **only PreCompact can find out**:
from that moment the compacting context writes nothing for at least 79 s (§0.2, the floor over 905
compactions), so any later arm looking at the filesystem sees the compactor as the *quietest* context of
the session, not the newest. So the scope is decided ONCE, at PreCompact, and persisted in the set; the
two later arms read it and never resolve.

The rule, `_hook_compact_scope "$tp" "$trigger"`, answers one of **`main`**, **`subagent`** (with the
agent's transcript and id) or **`ambiguous`** — and `ambiguous` is an answer, not a failure: it means no
card, and a measurement that says so.

1. `trigger == manual` → `main`. Only the main thread can take a `/compact` (typed by the operator or by
   ccd's compactor at idle); no subagent ever does.
2. Otherwise the candidates are the parent transcript `$tp` and every `agent-*.jsonl` under
   `${tp%.jsonl}/subagents/`, at any depth (`Agent`-tool subagents sit directly in it, Workflow agents
   under `workflows/<run>/`; `${tp%.jsonl}` IS `<dirname>/<session_id>`, the transcript's basename being
   the session id, so no second payload read is needed). A candidate is **live** when its mtime is
   within `COMPACT_LIVE_S` (120 s) of now — `find … -mmin -2`, POSIX-portable (`-printf` is not).
3. **No live agent → `main`.** An auto-compaction fires right after a write, so the compactor is live;
   with no live agent the parent is the only context that can be compacting.
4. **Exactly one live agent and the parent NOT live → `subagent`, that file.** The parent is quiet while
   it waits on a foreground subagent (measured: 16 minutes without a row during one Workflow run, §0.2),
   so the one live writer is the compactor.
5. **Anything else → `ambiguous`**: the parent and an agent both live, or two or more live agents. Two
   contexts wrote within the window and nothing in the payload or on disk says which one stopped to
   compact. This is the honest answer for a Workflow fan-out — measured on this fleet, seven and eight
   agents of one session start within 3 ms and run concurrently for 13–39 minutes, writing a row every
   4–6 s — and for a main-thread compaction with a background subagent still running.

Downstream: a `main` or `subagent` scope mines the card from **that** transcript and `carried` from
that transcript's own previous summary; the set and journal carry `scope`, `agent` and `transcript`;
an `ambiguous` scope writes a set with `transcript: null`, no card, and PostCompact still measures
`chars`, `filesChars` and `fences` with `cited`/`setSize` null. **The scope is a journal tag, not a gate;
`ambiguous` is the one value that also withholds the card**, because a card built from a sibling's
transcript is wrong context, and wrong context is worse than none. Said plainly: a subagent's card is
reachable only for a **solo** live subagent; a fan-out's compactions are `ambiguous` by construction,
and the journal's count is what says whether that case is worth a discriminator Claude Code does not
carry today. The rule records its own inputs beside its verdict — `parentLive` (`true`, `false`, or `null`; **not** merely on a manual trigger — the normative matrix, the §3.1 example, the predicate and the shipped `_hook_compact_scope` all carry `null` for an ordinary `auto`/`main` verdict and for an `auto`/`ambiguous` verdict with two or more live agents too. Only `auto`/`subagent` is `false`; only a single-live-agent `auto`/`ambiguous` verdict is `true`) and `liveAgents` (the count; null on a manual trigger) — in the set and the journal, so every verdict can be
audited offline against the transcripts. An overlap-forced set also records `overlap:true`; ordinary
sets record `overlap:false`. This fact is what lets PostCompact distinguish a genuine scope answer from
a later PreCompact's degradation without trying to reconstruct ownership.

**Why this rule and not another — every candidate measured.** `agent_type`/`agent_id`: absent from all
three payloads. `prompt_id`: present on all three, but a subagent's rows carry the *parent's* prompt id
(measured on this session: two Workflow agents and fourteen parent rows share one `promptId`). A boundary
count in `$tp`: the boundary is not yet written at hook time, and a subagent's boundary lands in the
subagent's own transcript (§0.2). "Newest file wins" (the first draft of this section): a race — the
compactor is silent for ≥79 s, siblings write every 4–6 s, and 5 of 197 main-thread boundaries on this
box's corpus had a subagent transcript newer than the parent's last row. Hookstate's own `subagents`
list: stale entries, and the summariser fires a `SubagentStop` of its own. An environment variable naming
the agent: none in the 2.1.263 binary's `CLAUDE_*` set. Liveness is what is left, and it is exact where it
answers and silent where it cannot.

**What the corpus measures about the rule itself.** Two false directions, both counted on the first
live journal: **false ambiguity** — a sibling that finished inside the last `COMPACT_LIVE_S`, or a
foreground subagent that filled its context within two minutes of its spawn — costs a card, never a
wrong one; **false exactness** — the compactor reads as *stale* while exactly one other context is live,
so that other context is named. For a subagent compactor that needs a sibling that paused longer than
`COMPACT_LIVE_S` while the compactor's own last row aged past it too (gaps over 79 s are 1–2% of rows in
the measured agents); for the main thread it is empty on this corpus — at an auto-compaction the parent's
last row is 0.8 s old at p50, 3.7 s at p95, never 120 s (§0.2, n=216). Either way it is checkable
offline: the journal line names a subagent transcript whose file carries no `compact_boundary` near the
line's `at`, and `parentLive`/`liveAgents` beside it say what the rule saw. If `ambiguous` turns out
common, the fix is a discriminator Claude Code does not carry today (an agent id on the three payloads);
nothing in this design can conjure one, and the journal is what says whether asking for it is worth it.

**One slot, two contexts — overlap, before and after settlement.** The card and canonical set are one
file each per session id, and every context of the session can write them. The stable
`$REG/.<id>.compactions.lock` is therefore an **ownership-and-journal mutex**, not merely a journal-write
lock: every ccrc canonical publisher, private PostCompact claimer, and journal writer acquires it through
§3.4's one safe helper. PreCompact holds it while inspecting the canonical set and young claims, sweeping
its own lifecycle artifacts, and publishing its initial canonical set, then **closes it before invoking the
bounded helper** (§3.1's option-A protocol) — the helper never opens, publishes, or rolls back a canonical
pathname at all, so there is nothing left in the helper's own execution for this lock to gate. PreCompact
**reacquires** it once the helper returns or times out, and holds that second acquisition through
revalidating ownership and either renaming the helper's two private stage files into canonical or publishing
nothing. It does not hold it across any later arm.

Before PostCompact settles the predecessor, a lock-holder may find either the canonical set or a **young
private PostCompact claim** younger than `COMPACT_CARD_MAX_AGE`. Either means another compaction is in
flight (or failed inside the window), so the later PreCompact degrades its **own** set to `ambiguous` and
removes the canonical card. While the predecessor is still canonical, the symmetric degradation already
implemented may also replace it; once PostCompact's successful under-lock hard link has published a private
claim, its identity controls recovery too. Under the same stable lock, PreCompact scans only exact-this-session
claim names and uses `-ef` against canonical. A same-inode pair is the predecessor's already-settled alias:
PreCompact final-rechecks it, unlinks only the redundant canonical alias, and leaves that claim and its marker
untouched before it publishes its successor. Otherwise, after PostCompact has unlinked canonical and touched its new claim,
no later PreCompact may rewrite, relabel or delete that claimed predecessor. It can say only that overlap
was observed and degrade its own card/set. A failed compaction followed within the window can therefore cost the
successor its card, but cannot falsify the predecessor after settlement.

**Claimed-overlap normalisation.** A claim is private evidence for exactly one PostCompact, but its
private filename deliberately says nothing about the set contents: settlement must precede every set
read. After the hard-link settlement, the claim's JSON and its nonce are validated. A claimed document with
`overlap:true` cannot safely attribute either predecessor's original provenance after the
pre-settlement symmetric degradation, so `measure` runs without `--set`, its final `scope` is normalized
to `ambiguous`, `cited`/`setSize` are null, and `agent`, `transcript`, `parentLive`, `liveAgents`, `cwd`
and `built` are all null. An absent `overlap` is legacy-compatible ordinary/false because the already-
implemented Task 1–8 helper rewrites ordinary sets without carrying that member; explicit `false` has
the same meaning. A malformed document, a present non-boolean `overlap`, or an impossible
scope/provenance tuple runs without `--set`, with `scope` null and those same fields null.

**The ordinary provenance grammar is exact.** Validate it once before constructing either `--set` or
the final record. `cwd` is null or a non-empty string; `built` is null or a lowercase hexadecimal
string of 7–40 characters, and must be null when `cwd` is null; `agent` is null or a 1–128-character
`[A-Za-z0-9_-]+` string; `transcript` is null or a non-empty string; `parentLive` is null or boolean;
and `liveAgents` is null or a non-negative integer. In addition, an absent/false-overlap claim must
match exactly one row:

| trigger / scope | `agent` | `transcript` | `parentLive` | `liveAgents` |
|---|---|---|---|---:|
| `manual` / `main` | null | non-empty string | null | null |
| `auto` / `main` | null | non-empty string | null | 0 |
| `auto` / `subagent` | safe id | non-empty string | false | 1 |
| `auto` / `ambiguous` | null | null | true / null | 1 when true; integer ≥2 when null |

No other tuple is ordinary provenance. In particular, manual subagent/ambiguous, a main agent id,
a subagent without exactly one observed agent and quiet parent, ambiguous transcript/agent bytes,
negative/fractional counts, wrong JSON types, and `built` without `cwd` are malformed. This is a
consistency grammar, not a pathname permission: PostCompact never dereferences `cwd` or `transcript`.
An explicit `overlap:true` takes the normalization above before this table and retains only the honest
ambiguous scope; a present non-boolean overlap is malformed.

In every normalization case a separately validated safe nonce still owns exact-marker lookup:
`served` is true iff that exact marker exists, and only that marker is removed. An unsafe/missing nonce
forms no marker path and yields `served:false`. Only a fully valid claim whose `overlap` is absent or
false is passed to `measure`. Summary-only fields remain measurable in every normalized case. The
collision-resistant set nonce, never numeric `at`, owns every set/card/marker relationship; the
independent shell-generated claim identity owns settlement only. Under round 7's option-A protocol the
helper never reads or re-reads a canonical slot at all — it writes only its two private stage files, and
PreCompact alone revalidates ownership and performs the canonical rename under its reacquired lock, so
there is no read-to-rename race left in the helper's path to protect; PostCompact's own rename (of the
canonical set to its private claim) closes the equivalent race for the measurement path.

### 3.1 PreCompact arm (hook)

Runs from the very end of the hook, **after** the hookstate rename: the `working` stamp lands first and
never waits on any of this. **Round 7 adopts option A — a staging-only helper — after an architecture
adjudication overturned round 6's justification for releasing the lock across the helper's own canonical
rewrite** (measured false: the helper's slot check and its canonical write were check-then-act, not a
compare-and-swap; see the status line and §3.0). Under option A the helper never opens, renames, or rolls
back a canonical pathname — no canonical pathname appears in its argv at all — so every ownership decision,
canonical publication and rollback question moves into this bash arm, whose deciding section forks only
synchronous children it reaps before leaving that section — so the Standing rule below APPLIES to it and is
SATISFIED, never disapplied. The full protocol, in order:

```
 1. operator-off guard; payload transcript_path readable          [no lock]
 2. _hook_compact_scope                                            [no lock]
 3. _hook_graph_measure  ← MOVED OUT OF THE LOCK (reads git/tree only,
    touches no lifecycle artifact)                                 [no lock]
 4. acquire stable lock, wait = COMPACT_LOCK_WAIT; miss ⇒ arm inert, return 0
 5. validate CCRC_SESSION_GENERATION against $REG/<id>.generation
 6. overlap check (canonical set + young compactpost claims); ambiguous ⇒
    remove card; exact-family age sweep
 7. mint nonce; publish set{files:null} by hook temp + rename
 8. ambiguous / gate fails / helper absent ⇒ release, return 0
 9. RELEASE THE LOCK (close-before-fork)
10. run helper with --set-stage and --card-stage private paths, the nonce,
    scope/agent/at, and (round 8) --parent-live/--live-agents — no --trigger;
    NO --set, NO --out, no canonical path in argv
11. REACQUIRE, wait = COMPACT_LOCK_WAIT; miss ⇒ leave staged files as
    age-eligible exact residue, publish nothing, return 0
12. revalidate generation; re-read the canonical set head (bounded `read -N`
    plus the shipped nonce regex) and require the nonce is still ours
13. rc 0 ⇒ rename card-stage → canonical card; (stage 2 only) print STEER_TEXT,
       then stamp steered := (that printf's exit code == 0) into set-stage (jq,
       stage only, never canonical) — the "(stage 2 only)" scopes BOTH acts, so
       in Plan A neither runs and the helper's staged steered:false is published
       unchanged; rename that set-stage → canonical set
    rc 3 ⇒ rename set-stage → canonical set; no card; no print
    any other rc ⇒ publish nothing; remove only our own stages
14. release; return 0
```

Card-before-set inside the section is deliberate (settlement point 3 below). Both renames move complete
private files within one directory. **Standing rule: no lock descriptor may remain open across any fork or
exec whose child can outlive the critical section; the only compliant form is close-before-fork** — measured
directly on bash 5.2.21: a real child that outlives the parent's own `exec {fd}>&-` still leaves a fresh
acquirer timed out for the full wait, so no compliant implementation may keep the descriptor open across a
fork it does not control.

1. `~/.ccrc/compact-card-off` absent.
2. `.transcript_path` non-empty and a readable regular file.
3. `_hook_compact_scope "$tp" "$trigger"` (§3.0) answers, with **no lock held** — this and the guard above
   are steps 1–2 of the protocol. It needs `find`, which is new to this file and guarded inside the resolver
   with the `command -v jq` idiom — a box without it says **nothing** (no set), never a silent `main`.
4. `_hook_graph_measure` runs next, **also with no lock held** (protocol step 3): it touches no lifecycle
   artifact, only git/tree state, so it has nothing to gain from the mutex and round 7 moves it out —
   narrowing the held section to exactly the work that needs it.
5. **Acquire the stable lock** (protocol step 4, `COMPACT_LOCK_WAIT`). It creates an absent stable lock only
   from a private `mktemp` regular source published with POSIX `link`; a missing, unsafe, replaced, or
   contended lock makes PreCompact inert: no overlap decision, sweep, set/card publication, or helper call.
   Under that lock (protocol steps 5–7, continued into step 8 at item 7 — so this item-pair's own span, not
   a contradiction of the "steps 5–8" first held section enumerated below), first validate that
   `CCRC_SESSION_GENERATION` is a strict lowercase
   UUID and byte-for-byte equals the ccrc-owned `$REG/<id>.generation`; validate it again immediately before
   each publication or destructive mutation. A hook with no generation (including an already-running
   pre-upgrade process) fails closed for compaction lifecycle work only; ordinary hookstate behavior is
   unchanged. Then scan only exact-this-session regular claims matching
   `$REG/.<id>.compactpost.<pid>.<RANDOM>.<RANDOM>.claim`. If canonical and one such claim are the same
   inode under `-ef`, final-recheck that identity and unlink only the redundant canonical alias; do not read,
   touch, process, remove, consume, or alter that predecessor claim or its nonce marker. Then perform the
   **overlap check** of §3.0 (an unconsumed set younger than `COMPACT_CARD_MAX_AGE` → `ambiguous`, card
   removed), over both the remaining canonical set and young regular exact-session claims. A claimed
   predecessor is otherwise observation-only: PreCompact never rewrites or removes it. Also sweep this id's
   stale already-tested helper/card temp and stage families plus new PostCompact artifacts older than the
   window. Parse each basename by first removing an exactly quoted literal `.<id>.` prefix and then matching
   its remaining suffix grammar; never put the id inside an unescaped glob or ERE. New candidates are deleted
   only after their full suffix matches an age-eligible residual family in §3.4's exhaustive inventory. The
   scanner never uses a broad `.*compact*.tmp` matcher or an old loose pid/random/tmp grammar. After Task 9's
   producer migration it applies only target suffixes; during the one migration window it may additionally
   apply only §3.4's complete legacy grammar after age expiry. It does not remove live claims. `$REG/.<id>.compactions.lock` is explicitly excluded: it is never swept, repaired, replaced, or unlinked.
   This exact-prefix parse protects a second legal id such as `demo.quiet` when this id is `demo`, and vice
   versa.
6. Still under that lock, **the set is written here, always**, by the hook (`jq -cn --arg …`,
   temp-then-rename, the Task 9 target §3.4 private set-temp family
   `$REG/.<id>.compactset.<pid>.<nonce>.hook-write.tmp`):

   ```json
   {"v":1,"at":1789330000000,"nonce":"compact-1789330000000-<pid>-<RANDOM>-<RANDOM>","scope":"main","agent":null,
    "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
    "parentLive":null,"liveAgents":0,"overlap":false,
    "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh","steered":false,
    "files":null,"stats":null}
   ```

   `at` is an epoch-millisecond measurement only. PreCompact generates `nonce` once from that
   measurement, its PID and two Bash random values; it owns every set/card pairing and every canonical
   rename. `files: null` means **not mined**; the helper's `files: []` means **mined, empty** — two
   conditions, two values. `cwd`, `built` and `fresh` are
   `null` when the measurement had nothing to say; `parentLive`/`liveAgents` are null on a manual
   trigger. `overlap` is true only when this PreCompact observed a young canonical set or private
   PostCompact claim; otherwise false. Task 9 removes `served` from every future `.compactset` writer and
   rewrite; the isolated `measure` API may tolerate a legacy input member, but hook PostCompact never reads
   or trusts it. An `ambiguous` scope has `transcript: null`, `agent: null`, and the arm releases the lock and
   **stops here** (protocol step 8).
7. Still under that lock (protocol step 8, continued): the graph gate — `_hook_graph_measure` (step 3, above)
   returned 0 **and** `_hook_gate_tree` holds, a graph no more than `GRAPH_GATE_MAX_BEHIND` commits behind
   HEAD, the same predicate as the search gate, so the card and the gate agree about which trees count — and
   `$HOME/.cc-sessions/compact-card.mjs` is present. Any failure here also releases and returns 0. `node` and
   `timeout` are **not** guarded: a missing one fails the call exactly as a failing helper does (exit 127,
   swallowed by the call site), and a guard whose removal changes nothing observable is not a guard — on a
   userland with no `timeout` the helper never runs, the set is consumed by PostCompact, and the journal
   stays empty (§4).
8. **Release the lock** (protocol step 9, close-before-fork) and, with `--transcript` the resolved file of
   step 3 — never the payload's — numeric `--at`, the separately generated ownership `--nonce`, and (round 8)
   this PreCompact's own already-computed `--parent-live`/`--live-agents` — the helper's only remaining source
   for these two fields now that `--set` left its argv (§3.2) — run the bounded helper:

```
_hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" card \
  --transcript "$transcript" --cwd "$GM_CWD" --graph "$GM_CWD/graphify-out/graph.json" \
  --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
  --set-stage "$REG/.$id.compactset.$$.$nonce.stage" --card-stage "$REG/.$id.compactcard.$$.$nonce.stage" \
  --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
  --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$scope" --at "$at" --nonce "$nonce" \
  --parent-live "$parentLive" --live-agents "$liveAgents" [--agent "$agent"] [--steer]
```

   No `--out`, no `--set`: **no canonical pathname may appear in this argv at all**, the load-bearing
   property option A trades for the lock it no longer holds across the fork. `--parent-live`/`--live-agents`
   (round 8) are copied verbatim into the staged set exactly as `--scope`/`--agent` already are — PreCompact
   computed their final values at step 2 (§3.0) before the helper ever runs, so the helper never derives
   them. No `--trigger` reaches `card`: the two explicit values already pin the exact §3.0 matrix row a
   trigger would otherwise be needed to distinguish. `--steer` is passed when stage
   2 is built and `~/.ccrc/compact-steer-off` is absent, and it changes nothing the helper writes — the
   print (§3.5) is the hook's own act, below, never the helper's.
9. **Reacquire** the lock (protocol steps 11–12, `COMPACT_LOCK_WAIT`); a miss leaves the two stage files exactly
   where the helper left them — they age out through the ordinary exact-family sweep of step 5/6 above,
   never a special-cased cleanup — and publishes nothing. On success, revalidate generation and re-read the
   canonical set's head (the bounded, fork-free `read -N` idiom the hook already uses for the set's own head,
   `:934-935`) to confirm this nonce still owns the slot — bash has no `slotIsMine` counterpart to call; this
   head-parse **is** the ownership check, run under the lock this time, which is what makes it a real
   compare-and-swap where the pre-round-7 helper-side version was check-then-act.
10. Dispatch on the helper's exit code and this reacquired ownership, still under the lock (protocol step
    13; step 12's revalidation is item 9's, step 14's release is item 11's, so **steps 11–14 are each
    claimed by exactly one prose item** — round 9 generalised this to "each numbered box step", which is
    false at the other end and is corrected here (round 10, A-M4): step 8 is claimed by item 6's tail and
    again by item 7's "(protocol step 8, continued)", and steps 1–2 are claimed jointly by items 1, 2 and 3):
    - **rc 0 and ownership confirmed:** rename the card-stage file to the canonical card, then — in stage 2
      only, after the steer switch is absent — print `STEER_TEXT` (§3.5) **and then** stamp `steered` onto the
      still-private set-stage file (one `jq` rewrite of that stage, never of canonical — the stage is not yet
      canonical) to whether the `printf` that emitted `STEER_TEXT` itself exited 0, then rename that updated
      set-stage file to the canonical set. **The "in stage 2 only" scopes BOTH acts** — the print and the
      stamp — since the stamped value is that print's own exit code and there is nothing to stamp without it;
      **in Plan A neither runs**, and the rename publishes the helper's staged `steered:false` unchanged. Card before set is deliberate: the steering bit is decided by the
      print's own exit status, stamped into the private stage, and only then published by the rename — one
      uninterrupted section, no second lock acquisition, and no gap in
      which a lost lock could record `steered:false` for a compaction that was, in fact, steered.
    - **rc 3 and ownership confirmed:** rename only the set-stage file to canonical (`files: []`, mined,
      empty); no card exists, and stage 2 does not print, because a failed reacquire or a lost slot must
      return before the print — printing without a guaranteed stamp is worse than not printing.
    - **rc 0 or rc 3 but ownership FAILED to reconfirm** (newly reachable under option A: a sibling
      PreCompact acquired the freed lock during the helper's run, published its own verdict — normally
      `scope:"ambiguous", files:null` — and this nonce no longer owns the slot): publish **nothing**. Do
      **not** print `STEER_TEXT`. Do **not** stamp `steered` onto anybody's set, least of all the sibling's.
      Remove only this process's two stage files (and any of its own `.part` residue); on a failed reacquire,
      leave them as pid+nonce-exact age-eligible residue instead. The compaction is then measured against
      whatever the sibling published — the honest record.
    - **Any other exit code, or the timeout:** publish nothing; remove only this process's own stages under
      the same rule as above.
11. **Release; return 0** (protocol step 14). The existing `state="working"` write is unchanged and precedes
    all of this.

The helper writes each stage through its own `<stage>.part` temp plus rename — no helper pid in the name,
since `<stage>` already carries the hook's own pid and nonce and the hook never learns the helper's own pid
(round 8; a second pid component would make the residue unnameable by the exact-family inventory) — so
**a stage file exists if and only if it is complete** — the hook never inspects a partial stage, only "exists" or "does not". The
helper performs no slot check, no rollback, and no canonical read at all; its exit codes keep their existing
meanings (§3.2).

**Cost, and the contract it amends (§6, R2).** The helper is bounded by `COMPACT_HELPER_TIMEOUT` = 8 s.
The inputs: node startup ~0.05 s; `graph.json` parsed once and indexed; a window of at most
`WINDOW_CAP` = 16 MiB, every line parsed; and resolution through a **basename index**, O(tokens),
never a scan of the file set per token (the review measured the naive scan at 2–12 s on a 64 MiB window
against a 5,000-file graph). Task 6's five fresh-nonce, production-helper runs on this fleet box
(2026-09-10) measured ccrc's 9,543,597-byte graph at p95 0.36 s / peak 104,384 KiB RSS and the largest
admissible graph, MekWarLive's 70,434,955-byte graph, at p95 1.05 s / peak 332,184 KiB RSS. Both are
below the 4 s acceptance bound. The 111,097,911-byte MegaMek graph exceeds the 96 MiB cap and was
refused before parse (exit 1, 0.25 s, 44,928 KiB RSS), leaving the scratch set byte-identical and no card.
The scope `find`s, the overlap `find`, the temp sweep, the two payload `jq`s and the set write sit outside
the timeout and are bounded by construction. None of it is on the hot path: PreCompact brackets a
compaction of at least 79 s. It is still a wait the hook's header forbids, and §6 declares it. **The two held
sections, re-enumerated against the numbered box above rather than asserted** (round 9 — the round-8 ledger
recorded this sentence as "measured-accurate on inspection" in the very round that added a second `jq` to it,
which is a claim the inspection did not support): the FIRST held section is protocol steps 5–8, opened by the
acquire at step 4 and closed by the release at step 9; the SECOND is steps 12–13, opened by the reacquire at
step 11 and closed by the release at step 14. **The first section's list is in two parts, because the arm it
enumerates is half-shipped and half-designed (round 11, A-M1/B-M2 — rounds 9 and 10 each presented one list as
exhaustive and each omitted members).** SHIPPED — the children the first section forks today, measured
line by line: the overlap `find`
(`ccd/session-hook.sh:862`), step 6's **conditional ambiguous-card `rm -f "$cardf"` (`:865`)** — `rm` is an
external binary (measured on this box, `type -t rm` answers `file`), so it forks exactly as
`_hook_write_atomic`'s own conditional failure-path `rm -f` already listed here does, and conditionality is
therefore no excuse for leaving it out — the exact-family sweep `find` (`:869`), the `jq -cn` that builds the
initial set
document (`:875`), and — inside `_hook_write_atomic` (`:779-784`) — the `mv -f "$tmp" "$1"` at `:782` that
publishes it, plus the failure-path `rm -f` on either arm (`:781`, `:782`; the `printf` that writes the temp
is a builtin and forks nothing). ADDED BY TASK 9 in the same section, and so not measurable on the shipped
file: step 5's generation-read hard-link alias and its alias-unlink (`link` then `rm`; §3.4, "Generation:
immutable row authorization" — measured, `type -t link` and `type -t rm` both answer `file`, so each is a
fork), and step 6's conditional redundant-canonical-alias unlink (§3.1 item 5, an `rm`). Item 5's young-claim
scan forks iff Task 9 spells it with `find` rather than a bash glob; this document does not fix that choice,
which is one more reason a prose list cannot be the authority for the built arm. **Task 9's own
instrumentation is that authority**: §2's `COMPACT_LOCK_WAIT` row already sends it to `strace -f -e
trace=clone,clone3,fork,vfork,execve` over `_hook_compact_pre`, and §5's held-section row asserts the measured
child multiset between the acquire and the release equals the list as built, so adding or deleting any child
reds. **The scope `find`s are NOT in it, and round 9's own enumeration wrongly put
them there (round 10, A-I1):** `_hook_compact_scope` runs both of them (`:754`, `:761`) at protocol **step 2**,
which the numbered box above marks `[no lock]` and item 3 restates as running "with **no lock held**" — they
precede the step-4 acquire, and round 7 moved `_hook_graph_measure` out of the lock for exactly this reason,
"narrowing the held section to exactly the work that needs it". Folding them back in has two concrete costs:
§2's `COMPACT_LOCK_WAIT` row directs Task 9 to set that bound at ≥ 8× the measured p95 of each held section,
so instrumenting this list with a recursive `find` over `<transcript>/subagents` inflates the bound every
`_reg_purge` caller blocks on; and the other way to make the sentence true — moving the acquire above
`_hook_compact_scope` — directly reverses round 8's I8 correction. **Step 8 adds no fork at all**, worth
saying because the section boundary now extends to it: `_hook_gate_tree` (`:300-302`) is two builtin `[`
tests and `[ -f "$COMPACT_HELPER" ]` is a builtin. The second section forks the card-stage rename, the
round-8 `jq` that stamps `steered` into the still-private set-stage, the set-stage rename, and the stage
`rm`s on every non-publishing outcome; its ownership re-read is the bounded `read -N` plus bash regex and
forks nothing — measured with `strace -f -e trace=clone,clone3,fork,vfork,execve` over the shipped
`:934-935` sequence, which produced **zero** child-creating syscalls (the only `execve` in the trace is the
outer shell's own). Neither section is a short in-process sequence of syscalls alone, which is why Task 9
must measure them directly (§2) rather than assume they are cheap. Every one of the children listed above is
synchronous and reaped inside its own section, which is what makes the Standing rule satisfied rather than
inapplicable.

**Two source-order pins hold this enumeration in place (round 10, A-I1).** Task 9 asserts over
`_hook_compact_pre` that (a) the acquire-helper call site's source offset is GREATER than
`_hook_compact_scope`'s and `_hook_graph_measure`'s and LESS than the overlap `find`'s, and that the release
precedes the `_hook_timeout … node … card` call — moving the acquire above the scope call reds; and (b)
exactly two `find` invocations appear between the acquire and the release (the overlap and the sweep) —
adding a third, or relocating either scope `find` into the section, reds. **(b) is strengthened to the
MULTISET (round 11, B-M2)**, because a `find` count cannot see a child of any other shape appearing or
vanishing: assert the exact multiset of fork-creating commands between the acquire and the release equals the
list as built — two `find`, one `jq`, and the conditional `rm`/`mv`/`link` set enumerated above — so adding or
deleting ANY child there reds, not only a third `find`. **Both pins live in Task 9's own test list**
(Plan A, Task 9 Step 1 item 2, beside the fork-then-release legs): round 10 stated them here and named no
owning task, and measured, neither "source offset" nor "exactly two `find`" reached any Task 9 step — so the
implementer's extracted brief never asked for either (round 11, B-M8).

### 3.2 Helper subcommand `card`

**Input.** `--transcript` is whichever file §3.0 resolved — the parent's or a subagent's. The helper
copies `--scope`, `--agent`, `--transcript`, numeric `--at`, ownership `--nonce`, and (round 8)
`--parent-live`/`--live-agents` into the set, and writes `--nonce` as the **first line of the card-stage
file** (the hook strips it before injecting, after it has renamed the stage into the canonical card).
`--parent-live`/`--live-agents` are copied verbatim, never derived: round 7 removed the helper's only prior
source for them — a re-read of the canonical set via `--set` — with no replacement, which would have made
every carded compaction publish an impossible provenance tuple; round 8 threads the hook's own
already-computed values through as two more copied flags, exactly like `--scope`/`--agent`. No `--trigger`
reaches `card`: the two explicit values already pin the exact §3.0 matrix row a trigger would otherwise be
needed to distinguish (`auto`/`main`'s `liveAgents:0` from `manual`/`main`'s `liveAgents:null`, in
particular), so the helper has nothing left to derive from it.

**The wire contract for these two flags, stated once (round 9).** Both flags are unbracketed in the argv
above — always present, so the VALUE, never the flag's presence, encodes null. `--parent-live` takes exactly
`true`, `false`, or the empty string; `--live-agents` takes exactly a decimal integer matching `^[0-9]+$`, or
the empty string. **The empty string means JSON `null` for both.** This is not a new convention: it is the
hook's own, measured — `_hook_compact_scope` initialises `CS_PARENT_LIVE=""`/`CS_LIVE_N=""`
(`ccd/session-hook.sh:744`), returns on a manual trigger leaving both empty, sets `CS_LIVE_N="$n"` at `:756`
and `CS_PARENT_LIVE="false"` at `:762`, and the hook's own initial-set `jq` already reads exactly that
encoding back out at `:880-881`
(`parentLive:(if $pl=="true" then true elif $pl=="false" then false else null end)`,
`liveAgents:(if $ln=="" then null else ($ln|tonumber) end)`). The helper must convert identically and
exhaustively: empty string ⇒ `null`; `true`/`false` ⇒ the boolean; a string matching `^[0-9]+$` ⇒ the integer;
**anything else ⇒ a usage error (exit 2)**, never a silent coercion.

**`Number(v)` on a possibly-empty value is FORBIDDEN here, and is named as the trap because it is the file's
own established idiom.** `ccd/compact-card.mjs:795` already reads
`const maxChars = Number(o.maxChars), maxFiles = Number(o.maxFiles), at = Number(o.at);`, so extending that
idiom to `--live-agents` is the natural implementation — and it is wrong: measured on node,
`Number('') === 0` and `Number.isInteger(Number('')) === true`, so a manual-trigger compaction whose true
`liveAgents` is `null` would publish `0`. That tuple (`trigger:"manual"`, `scope:"main"`, `parentLive:null`,
`liveAgents:0`) matches no row of §3.0's matrix, `JOURNAL_RECORD_PRED` rejects it, and no journal line commits
— on the dominant population (§8 measures auto at 42% on the gpt lane, "0–7% elsewhere", so manual is 93–100%
of compactions on the other six lanes).
`REQUIRED_CARD`'s membership test is `k in o` (`ccd/compact-card.mjs:793`), which an empty-string value
satisfies, so the required-flag loop cannot catch this either. The `manual`/`main` leg of §5's round-8
mutation row exists precisely to red it.

**What "copied verbatim" means.** It means the VALUE published in the set is the hook's own measured value and
is never derived inside the helper — from `--scope`, from a `--trigger` the helper does not receive, or from
anything else. It does **not** mean the string is written into the set unconverted: the set's `parentLive` is a
JSON boolean or `null` and its `liveAgents` a JSON integer or `null` (`ccd/compact-card.d.mts:38`), so the
conversion above always runs. Verbatim is about provenance, not about representation.
**No canonical pathname reaches the helper (round 7, option A).** Its argv carries only `--set-stage`,
`--card-stage`, `--parent-live`, and `--live-agents` — private paths and values the hook names/computes —
and it performs **no slot check, no rollback, and no canonical read of any kind**: it is a pure function of
transcript/graph/labels (plus these copied provenance values) that writes exactly those two stage paths and
nothing else, ever. Ownership, canonical publication and rollback are the hook's job alone (§3.1);
the helper's own writer discipline is a `<stage>.part` temp plus atomic rename to `<stage>` for each of
the two stages, so **a stage file exists if and only if it is complete** — killing the helper mid-write
leaves a `.part` behind and no stage, and the hook publishes nothing. This is what makes PreCompact's
reacquire-and-rename (§3.1, protocol steps 11–13) a genuine compare-and-swap: the check (nonce still owns
the slot) and the act (the canonical rename) now happen inside one held lock section, where round 6's
helper-side check-then-act could not be. `graph.json` larger
than `GRAPH_MAX_BYTES` is refused the same way, before it is parsed. A subagent transcript has the same line shapes as the parent's, measured: an
`assistant` row is `{type:"assistant", message:{content:[{type:"tool_use", name, input}]}}`; the boundary
row is `{type:"system", subtype:"compact_boundary", compactMetadata:{trigger,…}}`; the previous summary
is `{type:"user", isCompactSummary:true, message:{content:"<string>"}}` — a string in 1,307 of 1,307
summaries on this box, with an array of `{type:"text", text}` blocks tolerated.

**Window.** The transcript since the last compaction boundary. Found by scanning the file *backwards*
from EOF in 1 MiB chunks for a line containing `"compact_boundary"` and confirming that the line parses
as `{type:"system", subtype:"compact_boundary"}` — a literal inside a message body is not a boundary
(the prototype named this false positive; the design closes it). No boundary: the whole file, capped at
the last `WINDOW_CAP`, realigned to the next line start (a mid-line start is not a partial parse
— `jq` and `JSON.parse` alike reject it wholesale, which the prototype measured as a silently empty set).
The previous compaction's summary — the `isCompactSummary` entry just after the boundary — is inside
the window by design and is **mined too**: its text, under the same token rule, tagged `carried`. That
is what lets a working set accumulate across compactions instead of collapsing to the handful of calls
since the last one (§0.3 measured 2 files without it).

**Mining.** For every window line with `type:"assistant"`, every content item with `type:"tool_use"`:

| tool | field | tag |
| --- | --- | --- |
| `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `input.file_path` / `input.notebook_path` | `edited` |
| `Read` | `input.file_path` | `touched` |
| `Bash` | tokens of `input.command` matching `[A-Za-z0-9_./-]+\.(<ext>)` | `touched` |
| the previous summary (`isCompactSummary`, any role) | tokens of its text, same regex | `carried` |

`<ext>` is the alternation of every extension the graph's own `source_file` values carry, derived, never
typed (this repo's graph: `ts md tsx mjs json sh mts js`). Files with no extension (`ccd/ccd`,
`ccd/ccclip` — 12 of this repo's 853, on the graph built at 988ac1f4) cannot be mined from shell text
and are a stated limitation, not a bug.

**Resolution**, against the set of `source_file` values in `graph.json`: strip a leading `<cwd>/` or
`./`; exact match first; else a suffix match on a path-segment boundary that is **unique** in the set.
Two or more suffix matches → dropped and counted `ambiguous`; an absolute path outside `<cwd>` → dropped
and counted `outside`; no match → counted `nomatch`. The counts go in the set file, so a thin card can be
told from a thin session.

**Ranking.** `edited` first, then `touched`, then `carried`, within each by occurrence count, then path.

**Two populations, named once.** The **working set** is every resolved file, up to 100 — what the set
file carries. The **carded files** are the first `COMPACT_WORKSET_MAX` of them — what the card prints.
`used by` lists and the blast-radius count are computed against the *working set*: a dependent that is
in the working set but not carded is not "outside" and is not counted.

**The graph.** `graph.json` is networkx node-link JSON (measured on this repo's 0.9.9 graph: 8,914
nodes, 17,452 links): `nodes[]` carry `id`, `label`, `source_file`, `source_location` (`L<n>`),
`community`, and the edges are under **`links[]`** as `{source, target, relation, …}` — thirteen
relations, of which `imports`, `imports_from`, `calls`, `references` and `indirect_call` mean "depends
on". `.graphify_labels.json` is `{"<community>": "<label>"}`. `built_at_commit` is the file's last key;
the helper parses the whole file once (0.13–0.18 s at 9 MB).

**The card.** File-centric, one line per file, terse, no markdown tables:

```
graphify card — this context's working set at compaction (subagent a43142b934b4bf501), from graphify-out/ (built at 40706e0c, fresh):
- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseStatusline:L132 parseCtxPct:L105 segmentAfter:L120 · used by server/src/watch.ts server/src/fleet.ts (+1)
- pwa/src/lib/models.ts [edited] · community "SessionScreen.tsx" · symbols modelOptions:L29 effortOptions:L54 · used by pwa/src/session/ModelSheet.tsx (+2)
- ccd/session-hook.sh [touched] · community "session-hook" · symbols _hook_graph_card:L278 _hook_emit_context:L59 _hook_graph_measure:L157 · used by server/test/session-hook.test.ts (+1)
(+6 files not shown)
Blast radius: 268 files import or call something in these 9 files.
Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.
```

(Format example, rendered from the 9-file whole-transcript set of §0.3 — all nine in the working set,
three carded before the budget cut; the symbol lines and counts are illustrative.) The header says
**this context's**, never "this session's", and carries `(subagent <id>)` on the subagent arm — it is
the one line that tells a summariser whose work the card describes. Per file: path; tag; the community
label of the file node (the node whose `metadata.kind` is `file`, else the file's top-degree node) from
`.graphify_labels.json` (omitted when its community has no label); its top five symbols by total degree
among the file's other nodes, as `label:L<line>` from `source_location`; and the top three files
*outside the working set* that carry a depends-on link **into** any node of the file, by link count then
path, with `(+n)` for the rest. Then one blast-radius line with the total count of dependent files
outside the working set. Then the fixed footer. The header carries the graph's commit (8 chars, or
`unknown` for an unstamped graph) and the freshness word `_hook_graph_measure` produced, verbatim — `fresh
— same content as HEAD`, `3 commits behind HEAD`, `freshness unmeasured` — so a card from a graph built at
another commit says so the way the graph card does, in the graph card's own vocabulary.

**Truncation** drops whole files from the bottom until the text fits `--max-chars`, then collapses
`used by` lists to their `(+n)`, never mid-line, and **always** prints `(+k files not shown)` when
anything was dropped — a short card must never read as a small working set (the prototype's `(not in
graph)` sentinel meant both, and the repo calls that an overloaded null).

**Files.** Task 9 first migrates every current helper/hook set/card temporary producer to §3.4's target
families and deletes the pre-round-7 rollback machinery outright (§3.4 names every function and call site).
The helper writes only its two hook-named stage paths, each through its own `<stage>.part` temp plus
rename — no `--out`, no `--set`, and no rollback family at all, because there is nothing to roll back: the
helper never touches a canonical pathname. The hook's own initial set write (protocol step 7, above) keeps
its existing `compactset.<pid>.<nonce>.hook-write.tmp` temp-then-rename family, unaffected by this change. No
generic `.<name>.<pid>.tmp` rule exists. A timeout orphan (an unrenamed helper `.part`, or a stage the hook
failed to reacquire for) is age-cleaned by the next validated PreCompact lock holder only when its full exact
suffix is an eligible family. The ordinary dot-free registry suffix loop does not see dot-leading lifecycle
names, so D-2605's locked exact-ID purge owns every residual family in §3.4 and deletes
`.generation` last; it never touches the permanent lock. The set the helper stages
— key order is part of the contract: `at`, `nonce`, and
`transcript` sit in the first 4 KiB, where the hook reads them with a bounded, fork-free `read -N`:

```json
{"v":1,"at":1789330000000,"nonce":"compact-1789330000000-<pid>-<RANDOM>-<RANDOM>","scope":"main","agent":null,
 "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
 "parentLive":null,"liveAgents":0,
 "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh",
 "steered":false,
 "files":[{"path":"server/src/pane/statusline.ts","tag":"edited","count":7}, ...],
 "stats":{"tokens":152,"resolved":87,"ambiguous":0,"outside":43,"nomatch":22}}
```

The already-implemented Task 1–8 helper rewrite above does not carry the hook document's ordinary
`overlap:false`; D-2605 therefore defines absent as legacy ordinary/false. The helper is never invoked for an
`overlap:true`/ambiguous scope because PreCompact stops before step 8 of §3.1's protocol. The pre-Task-9
helper code still emits its old direct-to-canonical temporary/rollback basenames; the migration paragraph
above, not this target-shape prose, governs their transition to the two hook-named stage paths.

Exit codes: 0 both stages written (set-stage and card-stage); 3 empty working set (set-stage written with
`files: []`, no card-stage); 2 usage (which now includes an out-of-vocabulary `--parent-live`/`--live-agents`
value, per the wire contract above); 1 any failure (unreadable input, malformed or oversized graph, a stage
write error) — **no CANONICAL pathname touched**, since the helper never receives one to begin with; a stage
written before the failure may remain, and is removed by the hook under its reacquired lock (§3.1 item 10) or
ages out as exact residue (§3.4). Round 9 corrects the earlier "nothing written", which was false for the one
reachable ordering it mattered in: rc 1 on a card-stage write error after a successful set-stage write leaves
that set-stage behind. Reads only the
three input files; writes only the two given stage paths, each through its own `<stage>.part` temp
plus rename, and nothing else.

### 3.3 SessionStart(compact) arm (hook)

Inside the existing `SessionStart` arm, only when `src == compact`, after the standing subjects are
built and before the D-306 `exit 0`. It never resolves scope. The compact arm begins with its
operator-off guard. **Immediately after that guard, before any lifecycle pathname is inspected,
aged, read, matched, claimed, deleted, emitted, or published, it validates the environment generation,
acquires the §3.4 stable lock (wait = `COMPACT_LOCK_WAIT_SERVE`, 2 s — the one acquisition a human is
waiting on; every other arm's acquisition in this design uses `COMPACT_LOCK_WAIT`, §2), and validates the
generation again under that lock.** **It retains that one
validated lock FD through every action below — match, claim, emit, and nonce-marker publication — and the
final generation recheck, closing only on return.**

**Why holding it is compliant (round 9 corrects the round-8 justification, which was measurably false).** The
earlier text read "this arm forks nothing, so there is no fork/exec boundary a held `flock` could straddle,
and Important-2's close-before-fork rule does not apply here at all." Measured against the shipped arm, it
forks repeatedly: `$(find "$f" -mmin …)` and the `rm -f "$f"` beside it at `ccd/session-hook.sh:923`, the
`( set -C; : > "$claim" )` subshell at `:953` (a `( … )` group is itself a fork — measured on bash 5.2.21,
`BASHPID` differs from the parent's), `mv -f` at `:954`, `link` at `:964` and `:970`, `rm -f` at `:955`,
`:965`, `:971` and `:974`, and the `jq -cn` inside `_hook_emit_context` at `:94` — plus the `mktemp`/`link`/`rm`
that step 5 and §3.4 add for the marker source. A held `{fd}<>` descriptor is **not** close-on-exec: measured
on bash 5.2.21, an exec'd child's `/proc/self/fd` lists the parent's lock descriptor pointing at the lock
file, so every one of those forks genuinely straddles the boundary the old sentence said did not exist.

**So the standing close-before-fork rule APPLIES here and is SATISFIED — never disapplied.** The arm forks
only synchronous children it reaps inside the section (`find`, `rm`, `mv`, `link`, `mktemp`, `jq`, and the
noclobber-placeholder subshell), none of which can outlive the critical section, and it is that property, not
an absence of forks, that makes retaining the descriptor safe. Measured on bash 5.2.21 with real processes:
with every child inside a held section synchronous, a fresh acquirer succeeded in 424 ms — bounded by the
holder's own 500 ms lifetime, with no extra delay from the forks; with a single `sleep 5 &` backgrounded
inside the same section, the fresh acquirer timed out for the full 3 s wait even though the holder's section
had already returned and closed its FD. §5 carries the corresponding row, and Plan A's fork-then-release
fixture is extended from PreCompact and `_spawn_start` to this arm, so backgrounding anything inside the
section reds rather than silently pinning the per-session mutex for that child's lifetime.

1. The environment `CCRC_SESSION_GENERATION` must be the strict lowercase ASCII UUID value for this row
   (§3.4 generation protocol). Missing, malformed, mismatched, absent, unsafe, unreadable, or replaced
   generation refuses silently. No card, set, marker, claim, or age probe occurs first.
2. Under the lock, inspect the regular/non-symlink card and canonical set, including age. An aged card is
   deleted only under this lock. Read the bounded set head and card claim only through owned, verified
   private aliases/FDs where §3.4 requires; validate the nonce with `^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$`
   — **spelled for bash, the engine that runs it** (§3.4, "Which regex engine anchors what"); the `\z` anchor
   this line previously carried is a jq/Oniguruma spelling and is a literal `z` here.
   A missing or crossed pair serves nothing. A barrier that replaces either pair member before lock
   acquisition is observed as that replacement, never as a stale pre-lock observation.
3. Atomically claim the matching card under the retained lock. The winner alone can read its body and
   form the compact subject. A losing, crossed, or body-less claim restores only its verified owned
   card through no-clobber link and creates no marker. The canonical set is never rewritten.
4. `_hook_emit_context` emits the two clips only after the current claimed pair is valid. A successful
   envelope is deliberately not filesystem-atomic. A crash after stdout and before marker publication
   is an honest possible `served:false` false negative.
5. Before unlock and only after successful output, revalidate environment generation and publish the
   exact nonce marker via §3.4's owned marker-source protocol. Same-nonce extant marker is idempotent
   only after it validates as a regular, non-symlink final marker under this lock. A marker is never
   created before output and no broad marker deletion is permitted. Close the FD on every exit.

The arm retains no process-specific lock after return. Missing/mismatched generation has the deliberately
strong property that an aged card, set, and marker remain byte-identical. Tests use a lock-acquisition
barrier plus pair replacement to prove no lifecycle observation leaks before the lock, and a mutation
which moves any first inspection above lock acquisition must turn red.

### 3.4 PostCompact arm (hook), registry lifecycle, and helper `measure`

The per-session journal is Plan A's sole authoritative measurement sink. There is no hookstate compaction
cache, no Plan-A wire, and no persisted `n`; a reader derives ordinal from committed physical JSONL position.
All compaction lifecycle processes use one stable lock implementation, generation storage implementation,
and exact family inventory below.

#### Stable lock: permanent canonical inode and private open alias

`$REG/.<id>.compactions.lock` is permanent for the registry ID/slot, deliberately spanning row generations
and safe reuse. No compliant path unlinks, replaces, repairs, truncates, recreates, or sweeps it. It is not
slug residue because it intentionally outlives the row. The Bash 4.4+/GNU-or-BSD protocol is:

1. To initialize an absent canonical lock, under `umask 077`, call `mktemp` with template
   `.<id>.compactions.lock-init.XXXXXX`. The literal terminal `XXXXXX` is a template only: the created source
   basename is `.<id>.compactions.lock-init.<mktemp6>`, where `<mktemp6>` is mktemp's six-character result.
   Validate that source as a regular, non-symlink file; publish canonical only by POSIX
   `link "$source" "$lock"`; remove the owned source on success, `EEXIST`, and every handled error.
   `EEXIST` means validate the incumbent; it never means open or recreate it. Never redirect or open canonical
   itself.
2. To acquire a lock, make an absent exact-family private hard-link open alias from canonical:
   `.<id>.compactions.lock-open.<pid>.<RANDOM>.<RANDOM>`. Both `$RANDOM` components are decimal, candidate
   collisions retry, and no final alias is precreated. Validate source canonical and alias as regular,
   non-symlink files; open the alias R/W on an anonymous FD; unlink that owned alias after FD acquisition,
   both on success and every handled failure. Thus an acquisition never has a create-capable operation at
   canonical, and all lock owners flock the one canonical inode.
3. Via `/proc/self/fd/$fd` or `/dev/fd/$fd`, require a regular FD target; require current canonical regular
   and non-symlink; and require `fd_path -ef canonical` before `flock`, after bounded
   `flock -w "$1" "$fd"` — **the wait is the acquire helper's first positional parameter, never a constant
   spelled inside the helper**, which is what lets `COMPACT_LOCK_WAIT_SERVE` (compact SessionStart alone) and
   `COMPACT_LOCK_WAIT` (every other acquisition, §2) coexist as two independently callable bounds through the
   one helper — and immediately before each mutation. Any unavailable
   inspection, FIFO, symlink (including dangling or to FIFO/regular), directory, disappearance, replacement,
   link/open/flock race, or mismatch closes the FD and refuses. It never recreates canonical. A test holds
   the old inode while canonical disappears and requires prompt refusal, zero recreated canonical, and no
   split critical section.

The first-publish source never leaks: implementation removes it before taking the common open-alias flow
(or safely uses it as the initial alias with the same single cleanup). Exact aged cleanup of crashed init or
open-alias residue is allowed only while a later validated stable lock is held (or by exact purge), parses
the literal `.<id>.` prefix first, and cannot select another dotted/shared-prefix ID. Mutation back to
`exec {fd}<>"$lock"` must red.

#### Generation: immutable row authorization

`$REG/<id>.generation` contains **exactly 36 lowercase ASCII UUID bytes and no terminal LF**. It is
ccrc-owned row authorization, not `.uuid`, a payload `session_id`, or journal data, and it never occurs in
the sixteen-key record. Under a stable lock, pathname metadata is classified before reading: genuine absence
is distinct from every present-invalid condition. A present value is accepted only from a readable,
non-symlink regular canonical file with exactly the byte grammar `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`.
FIFO, directory, symlink (including dangling or to a FIFO/regular file), unreadable, uppercase, empty,
multiline, malformed, replaced, and FD/path-mismatched values refuse promptly and are never repaired,
replaced, removed, or folded into absence.

Existing bytes are read through an exact owned generation-read hard-link alias
`.<id>.generation-read.<pid>.<RANDOM>.<RANDOM>` opened on a retained FD, then alias-unlinked and FD/current
canonical inode rechecked. Never use `_reg_get`, `_reg_read`, or `cat` on a raced canonical generation path.
For genuine absence only, `_plat_uuid` mints and validates, then writes the no-LF bytes under `umask 077` to a
private source made by template `.<id>.generation-init.XXXXXX`. Its resulting basename is
`.<id>.generation-init.<mktemp6>`, not a literal `XXXXXX` pathname; validate source bytes and publish only by
no-clobber `link`. `_plat_uuid` itself (`ccd/ccd:317-319`) emits a trailing LF on both its branches
(`uuidgen | tr 'A-F' 'a-f'` and `cat /proc/sys/kernel/random/uuid` both end in a newline), so the no-LF
contract binds the WRITER, not the generator: the writer strips that trailing LF before validating and
publishing. This is exact enough to need an explicit byte-count test (`wc -c` on the published source
asserted at exactly 36, not a pattern match a boundary LF could still satisfy) rather than a regex alone —
a naive `cat`-to-file implementation that skips the strip writes 37 bytes, fails the byte grammar on read,
and, because an invalid present generation is never repaired, replaced, or removed by contract, permanently
wedges that row: nothing may mint a fresh one over it, and no compliant cleanup unlinks it either.
It removes source on success/failure; `EEXIST` reclassifies the incumbent rather than
repairing it. Source/read-alias crashes are exact-family, age-gated cleanup under a later stable lock or exact
purge. `.generation` and any private generation residue block slug reuse (Task 9's widened `_ws_slug_free` check, below, is what makes this true); permanent lock does not.

#### Exact lifecycle family inventory

This is Task 9's exhaustive **target** compaction-lifecycle pathname inventory, not a claim about the current
pre-Task-9 implementation. Before either ordinary PreCompact age recovery or `_reg_purge` selects a private
artifact from it, Task 9 migrates every pre-D-2605 hook/helper set/card temporary producer named in the
transition paragraph below to these target families, and deletes every rollback producer outright (there is
no target-family successor for a rollback name, because option A gives nothing left to roll back). A checker
first strips the exact literal `.<id>.`
prefix for private files, or `$REG/<id>.` for canonical fields, then matches the entire remaining basename
against one table grammar. `<pid>` is `[1-9][0-9]*`; `<RANDOM>` is one decimal Bash `$RANDOM` result
(`0` through `32767`), and two occurrences are independent samples; `<at>` is decimal; `<nonce>` is exactly
`compact-<at>-<pid>-<RANDOM>-<RANDOM>` after its safe grammar has been validated; and `<mktemp6>` is the
six ASCII alphanumeric characters that replace a source template's terminal literal `XXXXXX`. `XXXXXX` occurs
only in a `mktemp` template, never in a created-name matcher. No lifecycle checker relies on a loose
pid/random/tmp glob. The permanent lock is the sole intentionally non-residual family.

**Which regex engine anchors what (round 9, stated once and referenced everywhere).** This design writes
regexes for two different engines and they do not share an end-of-string anchor. **jq/Oniguruma** — the
journal predicates of the Journal-contract section below — keeps `\z`, and `\z` there is correct and stays.
**bash** — every hook-side `[[ … =~ … ]]`, including §3.3 step 2's nonce validator — must anchor with `$`,
because POSIX ERE has no `\z` escape and `regcomp` reads it as a literal `z`. Measured on bash 5.2.21:
`[[ 'compact-1789330000000-4242-31-7' =~ ^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+\z ]]` does **not** match, while
the same pattern **does** match `compact-1789330000000-4242-31-7z` — so the `\z` spelling rejects every
well-formed nonce and accepts exactly the malformed one, inverting the acceptance criterion. The same two
strings under jq 1.7's `test("^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+\\z")` measure `true` and `false`
respectively, which is why the anchor is right there and wrong here.

`$` is not merely a tolerable substitute in the bash arm; it is sufficient. Measured on bash 5.2.21, the `$`
spelling matches the well-formed nonce, rejects the trailing-literal-`z` form, rejects a value carrying a
trailing LF, and rejects a value with an embedded LF followed by more text. That last pair is the one place
the engines genuinely differ in strictness and it favours bash: jq 1.7's `$` *accepts* a trailing LF
(measured `true` on `"compact-1789330000000-4242-31-7\n"`), where bash's `$` matches only at end of string and
refuses it. So no third construction is needed — but where a shape gate is preferred to a regex, this file's
own `case`/`${#x}` idiom (`ccd/session-hook.sh:768-769`) is the equivalent already shipped here. §6 states the
engine split rather than a blanket "`\z` anchors remain unchanged", which is what made copying `\z` into a
bash arm the natural error in the first place.

Every `mktemp` template and every `link` source/alias named in this section is created inside `$REG`, never
the process's cwd or a shared system temp directory — the diagrams elide the directory for width, but every
actual invocation names it, e.g. `mktemp "$REG/.<id>.compactions.lock-init.XXXXXX"`, never a bare
`.compactions.lock-init.XXXXXX`.

**Platform outcome, stated plainly.** The `flock(1)` command-line utility this design shells out to is
util-linux and is absent from stock macOS/BSD by default — the same portability caveat already noted for
`find` in §3.1. It is an external binary and nothing else: measured, `type -t flock` answers `file`, so there
is no builtin fallback and absence of the binary is absence of the mechanism.

**The ruling (round 9, SCOPED and gated round 10): lock-mechanism absence fails CLOSED for the three hook
arms, and OPEN — conditionally — for the three `_reg_purge` callers that carry no flock guard of their own.**
The round-8 text bounded the cost to "the ENTIRE compaction lifecycle — card, set,
journal, and lifecycle purge cleanup alike", which composed with §3.4's own "`_reg_purge` acquires/validates
the stable lock BEFORE any registry mutation" into something far larger than it stated: a permanent,
fleet-wide failure of `ws-rm`, `ws-reap`, `forget` and `ws-gc --prune`, each of which calls `_reg_purge`
(`ccd/ccd:4896` in `cmd_ws_rm`, `:11167` in `_ws_reap_tail` under `_ws_reap_locked`, `:11668` in
`_ws_gc_prune_row` under `ws-gc --prune`, `:15555` in `cmd_forget`) — three of them only AFTER irreversible
action. That is ccd's universal registry-destruction path, not the compaction lifecycle. The design does not
accept that cost, and does not need to.

**WHAT THIS RULING GOVERNS, measured against ccd's five shipped `command -v flock` sites (round 10, A-I2 /
B-2).** Round 9 asserted a blanket over "ccd's own registry operations" without measuring any of them. All
five, read at this commit:

| site | function | shipped disposition |
| --- | --- | --- |
| `ccd/ccd:2378` | `_lc_rotate` | fail OPEN — the probe's failure arm is a bare `return 0`, so rotation is skipped and the caller proceeds |
| `ccd/ccd:4341` | `cmd_ws_add` | fail **CLOSED** — `die "flock (util-linux) is unavailable — refusing to create a workspace unserialised"` |
| `ccd/ccd:6745` | `cmd_ws_restore` | fail **CLOSED** — `_lc_refuse restore … flock-unavailable` |
| `ccd/ccd:10202` | `cmd_ws_reap` | fail **CLOSED** — `_lc_refuse reap … flock-unavailable`, pinned by `server/test/ccd-ws-reap.test.ts:342` |
| `ccd/ccd:13242` | `_tmux_new_session` | fail OPEN (`if command -v flock …; then … fi`, no `else`) |

**Each of the five keeps its shipped disposition. D-2605 adds one more gate, and only that one fails open.**
Concretely, this ruling governs `_reg_purge` reached through `cmd_ws_rm` (`:4896`), `cmd_forget` (`:15555`)
and `_ws_gc_prune_row` (`:11668`) — the three call paths with no flock gate of their own — plus generation
initialization/export in row creation and `_spawn_start`. It does NOT govern `cmd_ws_add`, `cmd_ws_restore`
or `cmd_ws_reap`, which refuse before reaching any of that; `cmd_ws_reap` never reaches `_ws_reap_locked`
(`:10248`) → `_ws_reap_tail` (`:10594`) → `_reg_purge` (`:11167`) at all, since `_lc_refuse` "EMITS, THEN
DIES. Never returns." (`:2766`). Their doctrine is ccd's own and this design CITES it rather than
contradicting it — `ccd/ccd:10196-10197`: "NOT a degraded mode. Without `flock` the serialisation is absent,
not weaker, so the destructive verb does not run." Round 9's "row creation and `_spawn_start` … continue" is
accordingly **qualified**: it holds for row writes that do not pass through `cmd_ws_add`, and not for
`ccd ws-add`, which dies at `:4341` before `_ws_slug_free` (`:4356-4357`), before the addlock, and before any
registry row exists.

**THE GATE: `_reg_purge`'s fail-open is conditioned on the ABSENCE of `$REG/<id>.generation` (round 10).**
Fact (ii) below is a BOX-level claim established by a PROCESS-level probe: `command -v flock` resolves
against the calling process's PATH, so a box where ccd's PATH lacks `flock` while the hook's PATH has it puts
a locked, publishing hook beside an unlocked `_reg_purge` — the exact race the lock was added to remove, just
on ccd's side. On this fleet that cannot happen: `flock` is `/usr/bin/flock` (measured), and the hook's
environment descends from ccd's own tmux pane, so ccd's PATH is the ANCESTOR of the hook's and the dangerous
asymmetry requires the reverse; `ccd/ccd:19` states "Both production fleet boxes are GNU/Linux". It **is**
reachable on the second declared userland: `ccd/ccd:484-505` records that "a LaunchAgent gets launchd's own
minimal PATH" and that this "already bit this port once", and `_svc_job_path` (`:511-517`) appends
`/opt/homebrew/bin` and `/usr/local/bin` **only into the per-session plist** — so on a macOS box with
Homebrew util-linux, the supervised hook resolves `flock` while `ssh <mac> 'ccd forget <id>'` may not.

The witness is `$REG/<id>.generation`, **not** the permanent lock. The permanent lock is the wrong witness:
it is "permanent for the registry ID/slot, deliberately spanning row generations" and is minted even by a
purge against a never-existed id, so its presence proves history, not a live regime, and it would flip every
later purge to fail-closed on a box that genuinely lost `flock` — the fleet-wide wedge this ruling exists to
avoid. `.generation` is the right witness because this design already specifies all three properties it
needs, each stated above rather than invented here:

1. **Minted only by a flock-capable row creation.** "Row creation takes the stable lock only for exact
   residue check and generation initialization" (§3.4, ccd row creation), and §4's row for genuinely-absent
   generation says "only stable-lock protected private source plus no-clobber link may mint". A mechanism-absent
   row creation skips generation initialization entirely (the fail-open path below), so it mints none.
2. **Deleted LAST by purge.** "`_reg_purge` … deletes generation last, and never deletes permanent lock",
   with the mechanism spelled out: `generation` joins the loop's `archived || reaping` skip and one explicit
   `rm -f "$REG/$id.generation"` follows the archived/reaping tail.
3. **Replaced on row reuse.** "Interrupted purge preserves generation until last; safe reuse mints a fresh
   generation" (§3.4, `_ws_slug_free`).

Together those mean a PRESENT `.generation` proves THIS row's hooks were handed a generation and may hold the
lock right now. So: **generation present AND `flock` unresolvable ⇒ `_reg_purge` fails CLOSED**, returning the
distinct mechanism-absent refusal. **TWO post-action callers report it, not three (round 11, A-I5/B-M5) —
"the three post-action callers" is this document's fixed term for {`cmd_ws_rm`, `_ws_reap_locked`,
`cmd_forget`} and that set is wrong for THIS condition in both directions.** On a mechanism-absent box
`cmd_ws_rm` (`ccd/ccd:4896`) and `cmd_forget` (`:15555`) report `_lc_fail` naming the cause (mechanism absent
with a live generation); `_ws_gc_prune_row`'s dead-reg arm — the third GOVERNED caller — reaches `_reg_purge`
at `:11668` as its FIRST destructive act (measured: `_lc_tx`, `_lc_intent destroy`, then `_reg_purge`, then
`_lc_done destroy`), so it is the pre-action caller and DECLINES unchanged, exactly as the mutation-failure
paragraph below already says; and `_ws_reap_locked` is unreachable here, since `cmd_ws_reap` dies at
`:10202-10204` first. **That refusal is RECOVERABLE** — re-run the verb from a
flock-capable PATH — because the refusal itself adds nothing irreversible; it is the caller's own prior work
that was irreversible, and `_lc_fail` already names exactly that. This answers the stranding objection: the
row is not wedged forever, it is wedged until the operator invokes ccd with a PATH that resolves `flock`.
**Generation ABSENT ⇒ fail OPEN**, because no hook on this row ever received a generation, so no hook arm ever
ran the lifecycle, so there is nothing to race.

**The generation channel is itself what makes fact (ii) true on a consistent box**, and round 9 did not cite
it: a flock-less `_spawn_start` exports no `CCRC_SESSION_GENERATION`, and a hook with no generation "fails
closed for compaction lifecycle work only" — so every hook arm on such a box refuses regardless of what its
own PATH resolves. Fact (ii) is therefore carried by a mechanism, not by an assumption about the box.

**Rejected: a shared fixed absolute-path candidate list** for `flock` (the alternative mitigation), as the
primary fix. **(b) and (c) are decisive; (a) is real but weaker than it was argued, and the correction is
worth recording (round 10).** (a) It creates a SECOND spelling beside ccd's five shipped `command -v flock`
sites. The reviewer's supporting claim — and `ccd/session-hook.sh:1175-1177`'s own shipped comment, which
says "`single-definition.test.ts` does not scan `ccd/` at all — its four roots are the TypeScript packages"
— is **measurably FALSE against the shipped test.** `ROOTS` (`server/test/single-definition.test.ts:32-37`)
is indeed TypeScript-only, but the file carries a SECOND corpus: `bashRoots` (`:1115`) is
`[<repo>/ccd, <repo>/deploy]`, `BASH` (`:1139`) is every bash file under those plus `install.sh`, and
`holdersOf` (`:1145`) filters exactly that corpus on non-comment lines — the mechanism seven existing rules
already use, and `:1160-1164` pins `ccd/ccd` and `ccd/session-hook.sh` as members by name. So a single-spelling
pin over `ccd/` IS buildable, and drift would be catchable; (a) is a cost to pay, not an unfixable gap.
(b) It misclassifies any box whose `flock` sits off-list as mechanism-absent even though
`command -v` finds it, turning a working box silently inert, which is the worse direction under §10's
residual; and (c) the hook and ccd ship on the same AGENT-FIRST lane but as separate `install_atomic`
targets, so any list change has a window in which one side carries it. (b) alone is sufficient, and (c) is
untouched by the correction to (a). The darwin condition above is recorded
as the REASON the generation gate is needed at all, not as a reason to adopt the list. **Separately: the
stale hook comment at `session-hook.sh:1175-1177` is a defect in its own right** — it tells the next reader
that no mechanism exists where one does — and joins Task 9's comment scope beside `:1098`. **The anchor was
`:1167-1168` for one round and that is the WRONG range (round 11, A-I6/B-M3).** Measured on the shipped file,
`grep -n 'does not scan' ccd/session-hook.sh` returns exactly `:1175`, and the false sentence runs from
mid-`:1175` ("And `single-definition.test.ts` does not scan `ccd/` at") through `:1176` ("all — its four roots
are the TypeScript packages, as this branch's own README") to "addition says." on `:1177`; `:1178` begins a
SEPARATE and true sentence ("Keeping the three in step is a reading discipline, not a mechanism"), which is
why the range stops at `:1177` and not at `:1178`. Lines `:1167-1168` carry a different, CORRECT sentence
about `CCRC_WD_CLASS` deriving from the class constant — an implementer told to "restate as measured" at that
anchor would rewrite a true statement and leave the false one standing. Task 9's citation audit asserts, for
every `ccd/session-hook.sh:<n>-<m>` reference in either document, that the sentence quoted beside it occurs
within exactly those lines of the shipped file; reverting this anchor reds.

**Two caveats, stated plainly rather than hidden.** (1) The gate narrows the mint-after-test window, it does
not close it: a hook could mint nothing, but a row could pass the generation-absent test microseconds before
a concurrent row creation mints one — and only for a row still live enough to compact. It is a strict
improvement, never a proof. (2) A box that genuinely loses `flock` wedges its generation-PRESENT rows until
`flock` returns; that is the deliberate trade against silently racing them, and it is bounded by (1)'s own
condition — rows that never compacted carry no generation and purge normally.

The split is argued from four facts:

- **(i) These operations predate D-2605 and never needed this lock.** Row creation, `_spawn_start` and
  `_reg_purge` are shipped, working ccd mechanisms; the compaction lock is introduced by this design to
  serialize compaction-ARTIFACT publishers against one another. Gating pre-existing registry work on a
  mechanism it never required would be this design importing a new failure mode into unrelated code, not
  preserving an existing one.
- **(ii) On a mechanism-absent box there is no competitor to exclude.** The three hook arms refuse — closed —
  so no card, set, stage, claim, marker or journal artifact is ever published on such a box. `_reg_purge` can
  therefore race nothing: the exclusive party the lock exists to exclude cannot come into existence.
- **(iii) The one publication that is genuinely concurrent is already atomic without the lock.** Generation
  publication is a no-clobber `link` plus EEXIST-then-reclassify. Measured: `link src existing` returns rc 1
  with `File exists` and changes nothing, while `link src fresh` returns rc 0 and yields the same inode — so
  exactly one minter wins the pathname and every loser learns it did, which is the whole of the race the
  flock would have serialized there.
- **(iv) Mechanism-absent is never confused with lock-contended, because they are established by different
  probes at different times.** Mechanism-absence is a static property of the userland, established by
  `command -v flock` BEFORE any acquire is attempted (measured: rc 1 on a PATH without it, rc 0 with it).
  Contention is established by an acquire that ran: the binary existed and `flock -w` refused or timed out
  (measured: rc 1 on a held lock). Both spell their failure `1`, which is exactly why the distinction must be
  carried by WHICH probe answered and not by an exit status — the acquire helper tests the mechanism first and
  reports mechanism-absence as its own condition, never as a contended acquisition.

**This is not the forbidden "second lock-free concurrency regime", and the difference is worth saying
explicitly** (§10 states that prohibition, and it stands): that prohibition is about the HOOK falling back to
publishing contended compaction artifacts unlocked when `flock` is unavailable — a silent second regime racing
the locked one over the same canonical pathnames. Nothing here does that. The hook arms still refuse totally;
what fails open is ccd's own registry destruction, which publishes no compaction artifact, races no hook on a
mechanism-absent box by (ii), and is otherwise exactly the code that shipped before this design existed.

So, stated as an outcome: on a userland with no `flock` binary, the **compaction lifecycle** — card, set,
stages, claims, markers and journal — goes inert, silently and totally, the same way a missing `find` or `jq`
already does; never a partial or degraded mode. **This paragraph was byte-identical to its pre-gate parent for
one round and both its halves were false; the pre-gate wording is retracted and superseded here (round 11,
A-I2).**
`_reg_purge` reached through `ws-rm` (`ccd/ccd:4896`), `forget` (`:15555`) and `ws-gc --prune` (`:11668`) keeps
working exactly as it does today **on a generation-ABSENT row**, and fails CLOSED, recoverably, on a
generation-PRESENT one. `ws-reap` never reaches `_reg_purge` on such a box at all: `cmd_ws_reap` dies first at
`:10202-10204`, where `_lc_refuse` "EMITS, THEN DIES. Never returns." (`:2766`), so the fourth caller
`_ws_reap_tail` (`:11167`, under `_ws_reap_locked` `:10248`) is unreachable and "four callers keep working"
cannot be said here. Row creation and `_spawn_start` skip generation initialization/export and continue, for
row writes that do not pass through `cmd_ws_add` — `ws-add` itself dies at `:4341` — and they are NOT gated on
generation presence; that gate is `_reg_purge`'s alone (§4's row; §6 restates it and cites this paragraph).
All of which is consistent with "a hook with no generation fails closed for compaction lifecycle work only;
ordinary hookstate behavior is unchanged". §4 carries the row, §10 the residual, and §5 the fixture that pins
it.

| family | creator / precreated | exact basename after prefix | success cleanup / crash cleanup | purge / slug residue |
| --- | --- | --- | --- | --- |
| canonical set/card/journal | hook/helper; final path only from its owner | `compactset`, `compactcard`, `compactions` | normal lifecycle; never broad cleanup | exact purge; yes |
| helper stage set/card (round 7, option A) | path NAMED by the hook (never the helper); written by the helper through its own `<stage>.part` temp plus rename (no helper pid in the name — `<stage>` already carries the hook's), so the stage exists iff it is complete; renamed to canonical **only by the hook**, under its reacquired lock — the helper never opens, reads, or renames a canonical pathname | `compactset.<pid>.<nonce>.stage` / `compactcard.<pid>.<nonce>.stage`, with the helper's own mid-write residue at `compactset.<pid>.<nonce>.stage.part` / `compactcard.<pid>.<nonce>.stage.part` | after PreCompact's canonical rename, or removed by PreCompact itself on any non-publishing outcome (failed reacquire, lost ownership, non-0/3 exit, timeout); age under lock | exact purge; yes |
| hook atomic set temp | hook; private exclusive writer source | `compactset.<pid>.<nonce>.hook-write.tmp` | after rename/failure; age under lock | exact purge; yes |
| SessionStart card claim | SessionStart; deliberately precreated noclobber placeholder, then claimed by rename (not a `link`-created row; see note below) | `compactcard.<pid>.<nonce>.session-claim.tmp` | restore/remove under retained stable lock; age under later lock | exact purge; yes |
| PostCompact claim | PostCompact `link`; never precreated | `compactpost.<pid>.<RANDOM>.<RANDOM>.claim` | under validated final lock; age under later lock | exact purge; yes |
| final served marker | SessionStart `link`; never precreated | `compactserved.<nonce>` | PostCompact only under validated final lock; age under later lock | exact purge; yes |
| permanent lock | one-time init | `compactions.lock` | never | never; no |
| lock init source | `mktemp` template `compactions.lock-init.XXXXXX` | `compactions.lock-init.<mktemp6>` | every handled result; age under lock | exact purge; yes |
| lock open alias | every acquisition `link`; never precreated | `compactions.lock-open.<pid>.<RANDOM>.<RANDOM>` | after FD open/failure; age under lock | exact purge; yes |
| marker source | `mktemp` template `compactserved-source.<nonce>.XXXXXX` | `compactserved-source.<nonce>.<mktemp6>` | after `link`, EEXIST, every failure; age under lock | exact purge; yes |
| generation | row lifecycle | `generation` (non-dot canonical) | generation last on purge | generation-last; yes |
| generation source | `mktemp` template `generation-init.XXXXXX` | `generation-init.<mktemp6>` | every handled result; age under lock | exact purge; yes |
| generation read alias | generation reader `link`; never precreated | `generation-read.<pid>.<RANDOM>.<RANDOM>` | after FD open/failure; age under lock | exact purge; yes |
| journal stage/snapshot | journal writer; private exclusive file | `compactions-stage.<pid>.<RANDOM>.<RANDOM>.tmp` / `compactions-snapshot.<pid>.<RANDOM>.<RANDOM>.tmp` | after commit/failure; age under lock | exact purge; yes |

**Precreated is not itself a defect.** The SessionStart card claim row names a private regular file made by
a noclobber `: > claim` before the rename that claims a live pathname onto it — that IS a precreate,
deliberately: §3.3 requires exactly this placeholder so a canonical directory cannot be relocated over a
claim. "Never precreated" in the remaining rows (PostCompact claim, final served marker, lock open alias,
generation read alias) means something different and narrower: those are `link`-created only, with no
placeholder step at all, so the claimed/aliased name never exists as an empty file first. Reading "never
precreated" as a blanket property of the whole table is wrong; it names only the `link`-created rows. The
helper stage row is neither: it is neither `link`-created nor a noclobber placeholder claimed by rename —
the hook names an absent path and the helper's own atomic `.part`-then-rename discipline is what makes it
appear complete, once.

**Pre-D-2605-to-target migration.** Before enabling an ordinary target-family sweep, Task 9 changes every
current compaction writer, not just its scanner — starting from measured behavior, not assumption. **Before
round 7, the hook wrote no card temp at all: the card file's only writer was the helper's own `writeAtomic`
(`compact-card.mjs`), writing directly to canonical. Round 7 ends that:** the canonical card's only writer
becomes the hook, which renames the helper's card-stage file into place (§3.1); the helper's own
`writeAtomic` still exists but now targets only the two private stage paths, never a canonical one. The
hook's current *set*-temp grammar (for its own unrelated initial "files: null" publication) is measured, not
assumed, because a naive reading of its own helper function is wrong:
`_hook_write_atomic` (`ccd/session-hook.sh:780`) is `local tmp="$REG/.$id.$$.${1##*/}.tmp"`, and its only
two call sites (`:886`, `:990`) both pass `$set` = `$REG/$id.compactset`, so `${1##*/}` (the basename of
that path) expands to `$id.compactset`, and the produced name is `.$id.$$.$id.compactset.tmp` — the session
id occurs TWICE. After a checker strips the exact literal `.<id>.` prefix once, as every other family in
this table requires, the remaining suffix is `<pid>.<id>.compactset.tmp`, **not** the bare
`<pid>.compactset.tmp` a single-strip implementation would expect: a transition matcher written against the
wrong grammar matches nothing, so a helper killed by its deadline between the hook's write and its rename
leaks a permanent dotfile invisible to `_reg_purge`'s non-dot glob for as long as this file ships the old
producer. Task 9 must change the PRODUCER — `_hook_write_atomic`'s name construction — not merely the
scanner, before any ordinary sweep relies on the corrected grammar; and because this changes the exact
string Task 2's own landed test pins (`server/test/session-hook.test.ts`,
`toContain('local tmp="$REG/.$id.$$.${1##*/}.tmp"')`), that pin moves onto the new construction in the same
commit, not a commit later. Its **rollback** names were `<pid>.<nonce>.compactset-rollback.tmp`,
`<pid>.<nonce>.compactset-restore.tmp`, and `<pid>.<nonce>.compactcard-rollback.tmp`; its SessionStart
claim is `<pid>.compactcard-claim.tmp` (a LEGACY shape, migrated by Task 9 like the set temp — see the
"Both surviving producers CHANGE" list below) — these were independently re-measured
against the shipped `ccd/session-hook.sh:795,796,823,952` and `ccd/compact-card.mjs:422-423,457-459` and are
CORRECT as a description of what round 6 shipped; **round 7 deletes the three rollback names outright, with
no target-grammar successor**, because option A gives the hook nothing to roll back — every canonical
existence transition now happens inside one held lock section, so there is no partially-published state to
undo (§3.0's rollback/absent-set settlement). The current helper's atomic names, `compactset.<pid>.tmp` and
`compactcard.<pid>.tmp` (direct-to-canonical), and its rollback names,
`compactset.<pid>.<sha256nonce16>.<uuid36>.compactset.tmp`,
`compactset.<pid>.<sha256nonce16>.<uuid36>.compactset-restore.tmp`, and
`compactcard.<pid>.<sha256nonce16>.<uuid36>.compactcard.tmp` (where `<sha256nonce16>` is exactly the first
16 lowercase hex characters of SHA-256 over the validated nonce and `<uuid36>` is exactly the lowercase UUID
byte grammar in the generation section), are **likewise deleted outright, not migrated**: option A's helper
writes only the two stage-file names in the artifact table above, a producer introduced fresh by Task 9, not
a successor grammar for these.

**Both surviving producers CHANGE (round 9 deletes the "carry forward, unaltered in shape" clause, which was
false for each of the two producers it named).** They are the only two pre-D-2605 producers with a target-family
successor at all — that much was right — but neither keeps its shipped name:

- **The hook's set-temp producer changes its name construction.** This is already stated nineteen lines above
  ("Task 9 must change the PRODUCER — `_hook_write_atomic`'s name construction"), from the measured
  `<pid>.<id>.compactset.tmp` to the table's `compactset.<pid>.<nonce>.hook-write.tmp`. Its measured legacy
  shape — the two-id-occurrence one — is what the age-gated, locked transition matcher matches, never the bare
  `<pid>.compactset.tmp` an earlier draft of this paragraph stated.
- **The SessionStart claim producer changes its name construction too.** Its shipped shape is
  `<pid>.compactcard-claim.tmp` (measured at `ccd/session-hook.sh:952`,
  `claim="$REG/.$id.$$.compactcard-claim.tmp"`), and the table's row for that family is
  `compactcard.<pid>.<nonce>.session-claim.tmp` — a different grammar, not the same one. The target grammar is
  buildable at that point in the arm: §3.3 step 2 validates the nonce before step 3 claims, so the nonce is in
  hand and already safe when the claim name is constructed. Leaving the producer at its shipped shape would
  leave a name that matches neither PreCompact's exact-family sweep nor `_reg_purge`'s exact cleanup, so a
  SessionStart killed between its noclobber `: > claim` and its `mv` (or between the `mv` and the `rm`) would
  leak a permanent dot-leading file — precisely the leak this paragraph exists to close — and, under round 8's
  widened `_ws_slug_free`, an unmatched residue reads FREE, so the slug would be re-handed with a stranger's
  claim still present.

A transition cleanup may select an old artifact only after exact literal-ID stripping, the complete
corresponding legacy grammar, age expiry, and a validated stable lock. **The transition allowance therefore
names TWO legacy grammars, not one:** the hook set temp's two-id-occurrence `<pid>.<id>.compactset.tmp` shape
just derived, and the SessionStart claim's `<pid>.compactcard-claim.tmp`. It never uses an old `*compact*.tmp`,
generic pid/tmp, or broad glob matcher, and no new writer emits a legacy name.

The marker source grammar is deliberately disjoint from the final marker grammar while carrying the already
validated nonce verbatim. After `link "$source" "$marker"`, unlink the owned source on success, on `EEXIST`
after validating the exact same-nonce final marker, and on every handled failure. Crash before or after link
leaves only the exact source residue, never a served-marker lookalike. Independent mutations remove source
cleanup and change its family matcher; each must red.

#### Settlement, final transaction, and cleanup

PostCompact's operator-off, summary-type, and `find` guards precede lifecycle work. It then validates
generation, takes the stable lock, and revalidates before every age, canonical, claim, marker, journal, or
cleanup mutation. It never reads or ages canonical before this lock. Under the lock it first tests the canonical set's
pathname for existence — a distinct test from any `link` return code, because a genuinely absent canonical
and a present-but-unlinkable canonical both surface as a failing `link` in bash, and folding them together
silently unmeasures whichever population is absent. **Canonical set genuinely absent** (every pre-upgrade
row, or a PreCompact that went inert for any of its documented silent reasons — an operator-off file
appearing between arms is not a separate cause: PostCompact's own operator-off guard is checked first and
would already have returned, so this branch never runs to observe that file): PostCompact takes no claim at all, proceeds straight to final journal work below
with no age/claim/touch/unlink step, and its `measure` invocation carries no `--set`; the one record it
commits has `scope:null` and all six provenance fields null, matching §3.0's normalized no-set grammar
rather than the link-failure branch next. **Canonical set present:** it saves canonical age,
requires `touch`, links canonical set to a never-precreated exact private claim, and proves same inode.
It unlinks canonical **before** touching claim: hard links share mtime. If canonical unlink fails, remove
only the verified claim; canonical bytes and mtime remain unchanged. Only after canonical unlink succeeds
does it `touch claim` to mark active. If touch fails, restore canonical only with no-clobber
`link "$claim" "$set"`, prove same inode, then remove only verified claim. If restore collides, fails, or
cannot be proved, never overwrite its occupant or discard the only verified claim: retain that exact claim
as stale-recovery residue. Kill windows are explicit: before link leaves canonical; link-to-unlink leaves
same-inode aliases; after unlink-before-touch leaves claim; failed restore retains claim; later exact aged
recovery handles only eligible private residue.

**Round 7 makes the genuinely-absent branch's premise true rather than merely asserted.** Round 6 added the
absent-canonical-set branch above while PreCompact's helper could still, in principle, be mid-rollback of a
canonical write when PostCompact observed absence — a composition round 6 never fully closed. Under option
A, every canonical existence transition (PreCompact's own initial publish, its later stage-rename, and
PostCompact's own claim/unlink here) happens inside a held stable-lock section, and every existence test
happens inside the same lock, so "canonical set absent, observed under this lock" now has exactly one
possible meaning: nothing was ever published for this compaction. There is no PreCompact-side rollback left
to compose with. §5's rollback-mid-flight fixture is replaced by a source-scan control: no code path renames,
unlinks, or replaces the canonical set outside a held stable lock.

After settlement, helper input is only a retained verified claim FD or its FD-derived private snapshot.
No canonical or reopened claim path feeds helper. For final journal work — the sole authoritative measurement commit, and therefore the one phase whose
lock-miss loses something unrecoverable rather than something a later aged sweep repairs — the process
reacquires and validates the stable lock using `COMPACT_LOCK_WAIT` (§2) — the same bound the settlement
acquisition above used, both being off the hot path and each losing a durable artifact on a miss, so round 7
retires round 6's separate `COMPACT_JOURNAL_FINAL_LOCK_WAIT` in favor of one shared bound for both —
revalidates generation and claim-FD/current-path identity, then holds it through raw JSONL
validation, stage/whole-file atomic rename, and any claim/marker cleanup. The existing sixteen-key
`JOURNAL_RECORD_PRED`, integer and relation requirements, its exact `\z` anchors (jq/Oniguruma — these, and
only these, keep that spelling; §3.4, "Which regex engine anchors what"), full physical-line/terminal-LF
predicate, exact-one helper output, no `n`, FD CAS, and stage cleanup remain binding.

**One cleanup rule covers every post-settlement noncommit failure, including touch-restore residue:** claim
and marker cleanup happens only while a stable lock was successfully reacquired and validated. If helper,
dependency, final lock, generation, FD identity, or journal transaction fails and that lock cannot safely be
held, close retained FDs, remove only this process's unlinked snapshot/stage, and leave verified claim plus
exact marker as residue. No unlocked cleanup. If final lock is available, a noncommit failure may consume only
this verified owned claim and exact safe-nonce marker under all fences. Later exact age recovery, under a
validated stable lock, removes only this ID's claim and separately safe nonce marker/source after
`COMPACT_CARD_MAX_AGE`; it writes no retroactive record. A real-process final-lock-timeout test proves no
journal, no unlocked cleanup, exact residue retention, and later age cleanup — bounded by
`COMPACT_LOCK_WAIT`. A second real-process test holds the stable lock 3 s while only PostCompact's final
transaction waits on it, and asserts exactly one journal line still lands; passing
`COMPACT_LOCK_WAIT_SERVE` (the 2 s, human-facing bound) at this call site instead reds it — this is the
parameterized-wait control §2 requires, proving the final transaction is wired to the correct positional
argument, not merely to a same-named constant that happens to be long enough today.

The final marker lookup is nonce-only and occurs only from the privately claimed set under the final lock;
an originally aged set remains nonce-only/no-provenance regardless of active claim mtime. A successor canonical
set/card/marker survives predecessor paths byte-for-byte. One actual PostCompact process makes at most one
commit attempt; external replay after a post-rename crash can duplicate a measurement.

#### Journal contract: raw physical JSONL and FD compare-and-swap

One exact `JOURNAL_RECORD_PRED` gates both the accepted merged helper/claim object and every physical
journal line. It permits exactly these sixteen keys, with no persisted `n`: `agent`, `at`, `built`, `chars`,
`cited`, `cwd`, `fences`, `filesChars`, `liveAgents`, `parentLive`, `scope`, `served`, `setSize`, `steered`,
`transcript`, and `trigger`. `at`, `chars`, and `fences` are nonnegative integers; `filesChars` is null or a
nonnegative integer no greater than `chars`; `cited` and `setSize` are both null or nonnegative integers
with `cited <= setSize`; `trigger` is `auto` or `manual`; `scope` is `main`, `subagent`, `ambiguous`, or null;
and `steered` and `served` are booleans. `cwd` is null or nonempty; `built` is null or 7--40 lowercase hex and
requires non-null `cwd`; `agent` is null or a 1--128-character `[A-Za-z0-9_-]+` id; `transcript` is null or
nonempty; `parentLive` is null or boolean; and `liveAgents` is null or a nonnegative integer. Normal
provenance obeys §3.0's matrix, including auto/main `parentLive:null`, `liveAgents:0`; normalized no-set forms
have all six provenance values null, `cited:null`, and `setSize:null`, with scope only null or `ambiguous`.
Every integer requirement explicitly uses `floor == .`.

**The sixteen fields, and what each one MEASURES.** This table is restored here, beside `JOURNAL_RECORD_PRED`, so the predicate's type checks sit next to the semantics they pin. **D-2605 round 1 (`6330547f`) DELETED it, together with about seventy further lines of measurement prose, while rewriting the helper sections — and ten rounds of review did not notice, because every round measured what the document SAID and none measured what it had stopped saying (round 11, Package C).** The loss was prose only: every rule below is pinned by Task 8's landed tests, at the anchors named after the table, so nothing shipped was wrong for ten rounds — only unstated. The `chars`, `filesChars`, `fences`, `cited` and `setSize` rows are Task 8 fix round 3's FINAL rows, restored VERBATIM from `188c1d8a`; the rest are restated to the D-2605 model.

| field | meaning | type |
| --- | --- | --- |
| `chars` | length | integer |
| `filesChars` | chars from the "Files and Code Sections" heading to the next numbered heading; the heading regex tolerates `#`, `**`, a trailing colon and case (the corpus carries both `Errors and fixes` and `Errors and Fixes`); **a numbered-looking line inside a Markdown backtick fence is skipped — never a section start, never the terminating heading — since the corpus routinely quotes fenced numbered lists (including its own file listings) inside this very section, and counting one as the next heading truncates the span early (D-2553)**; an opener is a line-start (up to three spaces) run of at least three backticks and may carry an info string, while a close is a line-start (up to three spaces) run at least as wide as its opener followed only by whitespace — trailing non-whitespace is valid only on an opener; **null** when no such heading exists (19% of summaries are not in the nine-section format) | integer or null |
| `fences` | count of closed Markdown backtick fences under the `filesChars` fence rule; an unmatched opener covers EOF but does not increment the count | integer |
| `cited` | working-set files named in the summary: the file's repo-relative path appears only at non-path boundaries on both sides, or a path-segment-aligned suffix of it of at least two segments that is unique *within the set* appears; a suffix's left boundary is start of text, a non-path character, or `/`, while its right boundary remains end of text or a non-path character — computed from the set file alone, no graph needed | integer or null |
| `setSize` | `files.length` of the set; **null**, alongside `cited`, when any `files[]` entry lacks a non-empty string `path` rather than treating a corrupt list as a smaller valid working set | integer or null |
| `steered` | copied from the set; `false` when there is no set | boolean |
| `served` | **MARKER-DERIVED, never copied from a set** — the D-2605 correction, and the reason SessionStart no longer rewrites `set.served` at all: true iff the exact `$REG/.<id>.compactserved.<nonce>` marker exists, looked up under the final lock from the separately validated safe nonce this claim carries (§3.0, §3.3 step 5). An unsafe or missing nonce forms no marker path and reads `false`; so do a crossed pair, an aged card and a failed emit, which is what makes `cited` interpretable only where `served` is true | boolean |
| `trigger` | `auto` or `manual`, from the payload | string |
| `scope` | `main`, `subagent` or `ambiguous`, copied from the set; **null** without a set. `ambiguous` and null are different answers and neither is `"main"`: `ambiguous` is a verdict the §3.0 rule reached, null is no set to read a verdict from | string or null |
| `at` | epoch ms | integer |
| `agent` | the subagent id, copied from the set; null on every other scope and without a set — **journal line only** | string or null |
| `transcript` | the transcript §3.0 resolved, copied from the set; null for `ambiguous` and without a set — **journal line only** | string or null |
| `cwd` | the measured tree, copied from the set; null without a set | string or null |
| `built` | the measured graph build sha, copied from the set; null whenever `cwd` is null | string or null |
| `parentLive` | what the §3.0 liveness rule saw, copied from the set — §3.0's matrix is normative, including `null` for an ordinary `auto`/`main` verdict | boolean or null |
| `liveAgents` | the live-candidate count the §3.0 rule saw, copied from the set | integer or null |

**There is no `n` row, and that is a deletion this document intends.** The version this table is restored from carried one — "added by the hook, not the helper: the journal's line count before the append, plus one … so hookstate and the journal carry the same `n`". D-2605 removes both the hookstate cache and the persisted ordinal; a reader derives ordinal from committed physical JSONL position (§3.6). The six provenance fields land in the journal line only; the set carries `scope`, which is what a chip could one day render.

**Normalisation first, mirroring what the binary does before injecting** (restored, round 11 — §0.2 records the binary's own normalisation as a measured fact, but the rule that the HELPER must mirror it was lost with the table): drop the first `<analysis>…</analysis>` block (non-greedy, no global flag); replace `<summary>X</summary>`, when present, with the literal `Summary:` line followed by `X.trim()` — **replace, not unwrap**: the session sees that `Summary:` line and `chars` must count what the session sees; collapse runs of blank lines to one; trim. `compact_summary` is the raw text, so measuring it unnormalised would count scratch work the session never sees. Every field above is computed on the NORMALISED text. The summary reaches the helper through a PIPE, not a process substitution: under the hook's `set -uo pipefail` a failed `jq` fails the pipeline and the arm stops, so a zero is never recorded for a summary that was never read; `jq -r` appends one newline and the helper trims before measuring, so `chars` counts the text and not the plumbing (D-2418).

**Null is not zero, and "no set" is not "cited nothing"** (restored, round 11 — the chain tip carried the TYPES of these fields and none of the CONDITIONS). A set is the ordinary input but is **optional**: a served session, or a PreCompact that could not read its transcript, is still measured, with `scope`, `cited` and `setSize` **null** — not 0, and not `"main"`, because "no set" and "cited nothing" are different conditions and an unknown scope is not the main thread. A set with `files: null` (no graph, no node, helper failure, or `ambiguous`) yields `cited` and `setSize` null with `scope` KNOWN. So does a `files[]` list containing any entry without a non-empty string `path` — **null, never a smaller valid working set**, since silently dropping a corrupt entry would report a citation ratio against a set size the session never had. A set with `files: []` is the opposite case and is fully known: `cited: 0` and `setSize: 0`, mined and empty. A set that will not parse is measured as no set at all, never as a partial one. This is the ring rule applied to a measurement — an adapter may not narrow a distinction it received — and it is what makes the corpus answerable: a journal of 0s and a journal of nulls are different findings.

**Under D-2605 the input is the retained claim FD or its FD-derived private snapshot, never a reopened canonical path** (§3.4, Settlement). The `cited` row's "computed from the set file alone, no graph needed" is about the DOCUMENT, not about which pathname delivered it: the point it makes is that citation resolution needs no graph, so a journal line stays interpretable long after the graph has moved on.

**Where each of these is pinned, measured on the shipped tests** (so the prose above is a restatement of a mechanism, not a new promise): normalisation at `server/test/compact-card.test.ts:827-829` ("normalises as the harness does: the FIRST `<analysis>` dropped, `<summary>` REPLACED by a `Summary:` line, blank runs collapsed, trimmed"); the heading regex's tolerance of `#`, `**`, case and a trailing colon at `:833-838`, with both `3. Files and Code Sections:` and its `**`-wrapped spelling exercised; the fence rule and the unmatched opener at `:842-870` (`fences` 0 on an inline triple-backtick, 1 on a real pair, 0 on an unpaired opener); citation boundaries and within-set suffix uniqueness at `:875-893` (a bare basename scores 0, an ambiguous 2-segment suffix scores 0, `nota/b/c.ts` does not credit `x/a/b/c.ts`); null-vs-0 and null-vs-`main` at `:912-913`, `:922-931`, `:944` and `:954`; and `files: []` ⇒ `cited: 0`/`setSize: 0` at `:932` and `:940`. Round 1 deleted the prose and left every one of these green, which is exactly why no suite went red and no round noticed.

The validator consumes one raw string through `jq -Rse`, not an array. It accepts only empty content or content
ending in exactly the line structure below: a nonempty journal has a terminal LF, and after splitting it removes
only the final element introduced by that terminal LF. Thus every physical line must be nonempty JSON; a missing
final LF, blank line (including a second terminal LF), garbage, concatenated object, scalar, array, unknown key,
`n` key, fractional/negative number, bad relation, or escaped-newline-suffixed identifier fails. Completing
the enumeration with what does NOT fail: a **CRLF-terminated line** — a trailing `\r` immediately before the
split-off terminal LF — validates identically to a bare-LF line, because that `\r` is insignificant JSON
whitespace and `fromjson` accepts it after the closing brace; a **duplicate key** — `fromjson` keeps only the
last occurrence, so a line carrying the same key twice still parses to a sixteen-key object and passes; and
**leading whitespace before the opening `{`** — `fromjson`'s own JSON parser skips it the same as any other
insignificant whitespace. This design's own writer never emits any of the three, so all three are unreached
in practice, but the predicate does not reject any of them, and a validator that claims to
enumerate every failure should say so rather than imply there is no other case. `fromjson? //
false` turns no parse result into a false predicate rather than a vacuous `all`, and `jq -e` must emit `true`,
never `empty`:

```jq
def NONNEG_INT: type == "number" and . >= 0 and floor == .;
def NONEMPTY_STRING: type == "string" and length > 0;
def SAFE_AGENT: type == "string" and length >= 1 and length <= 128
  and test("^[A-Za-z0-9_-]+\\z");
def BUILT: type == "string" and test("^[0-9a-f]{7,40}\\z");
def NULL_PROVENANCE:
  . as $o | $o.cwd == null and $o.built == null and $o.agent == null
  and $o.transcript == null and $o.parentLive == null and $o.liveAgents == null;
def NORMAL_PROVENANCE:
  . as $o
  | (($o.cwd == null) or ($o.cwd | NONEMPTY_STRING))
    and ($o.built == null or (($o.built | BUILT) and $o.cwd != null))
    and ($o.agent == null or ($o.agent | SAFE_AGENT))
    and ($o.transcript == null or ($o.transcript | NONEMPTY_STRING))
    and ($o.parentLive == null or ($o.parentLive | type == "boolean"))
    and ($o.liveAgents == null or ($o.liveAgents | NONNEG_INT))
    and (
      (($o.trigger == "manual" and $o.scope == "main")
       and $o.agent == null and ($o.transcript | NONEMPTY_STRING)
       and $o.parentLive == null and $o.liveAgents == null)
      or (($o.trigger == "auto" and $o.scope == "main")
          and $o.agent == null and ($o.transcript | NONEMPTY_STRING)
          and $o.parentLive == null and $o.liveAgents == 0)
      or (($o.trigger == "auto" and $o.scope == "subagent")
          and ($o.agent | SAFE_AGENT) and ($o.transcript | NONEMPTY_STRING)
          and $o.parentLive == false and $o.liveAgents == 1)
      or (($o.trigger == "auto" and $o.scope == "ambiguous")
          and $o.agent == null and $o.transcript == null
          and (($o.parentLive == true and $o.liveAgents == 1)
               or ($o.parentLive == null and ($o.liveAgents | NONNEG_INT) and $o.liveAgents >= 2)))
    );
def JOURNAL_RECORD_PRED:
  type == "object"
  and ((keys | sort) == ["agent", "at", "built", "chars", "cited", "cwd", "fences", "filesChars",
                          "liveAgents", "parentLive", "scope", "served", "setSize", "steered",
                          "transcript", "trigger"])
  and (.at | NONNEG_INT) and (.chars | NONNEG_INT) and (.fences | NONNEG_INT)
  and (. as $o | ($o.filesChars == null or (($o.filesChars | NONNEG_INT) and $o.filesChars <= $o.chars)))
  and (. as $o | (($o.cited == null and $o.setSize == null)
       or (($o.cited | NONNEG_INT) and ($o.setSize | NONNEG_INT) and $o.cited <= $o.setSize)))
  and (.trigger == "auto" or .trigger == "manual")
  and (.scope == "main" or .scope == "subagent" or .scope == "ambiguous" or .scope == null)
  and (.steered | type == "boolean") and (.served | type == "boolean")
  and (NORMAL_PROVENANCE
       or (NULL_PROVENANCE and (.scope == null or .scope == "ambiguous")
           and .cited == null and .setSize == null));
. as $raw
| (($raw == "") or ($raw | endswith("\n")))
  and (if $raw == "" then true
       else ($raw | split("\n")) as $pieces
       | ($pieces[0:-1]) as $lines
       | ($lines | length > 0)
         and all($lines[]; (length > 0) and ((fromjson? // false) | JOURNAL_RECORD_PRED))
       end)
```

While holding the validated final lock, age-clean only this ID's exact journal stage/snapshot families; never
remove the permanent lock. Create the private stage with a never-precreated exact table name and validate it as
this writer's regular non-symlink file. If the live journal exists, open it read-only only after current-path
regular/non-symlink validation, retain that FD, and copy/read/validate its exact bytes from that FD; initial
absence is recorded as an expected final state. Before rename, an initially present pathname must still be the
same retained regular FD and an initially absent pathname must still be absent. A mismatch removes only this
writer's stage and preserves the old journal's bytes and pathname identity. Append exactly one compact JSON
object already accepted by `JOURNAL_RECORD_PRED` plus exactly one LF, verify the unchanged old-byte prefix, rerun
the raw validator over the entire stage, and require exactly one additional line byte-equal to that object. Then,
still under the retained FD and stable lock, atomically rename the stage over `$REG/<id>.compactions`. Journal-read
FD, claim FD, and lock FD are distinct resources and all close on every outcome. No `printf >>` path exists.

#### ccd row creation, spawn, purge, and ordering

Row creation takes the stable lock only for exact residue check and generation initialization, closes it on
every return before arbitrary setup work and before `_spawn_start`. `_spawn_start` acquires exactly once
immediately before primary `_tmux_new_session`, safely **reads and validates** the current generation into
a shell variable, then **closes the lock before** building or running either `_tmux_new_session` command.
**It never MINTS: round 9's "ensures/reads and validates" is replaced here, because "ensures" reads as
mint-if-absent and a reviewer took it that way (round 11, B-M4; reviewer A's stronger reading, that this is a
second spec-sanctioned minter, was refuted and is NOT adopted).** The minting vocabulary of this section —
"mints and validates", "private source made by template `.<id>.generation-init.XXXXXX`", "publish only by
no-clobber `link`", "generation initialization" — belongs to row creation alone, which is also how Plan A
divides the task ("`_spawn_start` primary/retry generation **export**"). A row with no generation is answered
by the standing rule instead: "a hook with no generation (including an already-running pre-upgrade process)
fails closed for compaction lifecycle work only", one unconditional outcome for every cause, never a mint
here. Generation-gate property (1) and caveat (1) below therefore name row creation and nothing else, and
that is correct rather than an omission. Continuing: a
held `flock` descriptor is inherited across fork/exec in bash and is released only when every referencing
descriptor closes (measured directly: a real child that outlives the parent's own `exec {fd}>&-` still holds a
fresh acquirer off for the full wait), so retaining it through the nonblocking tmux creation would let the tmux
server daemon (or anything it in turn spawns) pin the mutex for that daemon's entire lifetime — a resource this
design has no way to bound. Both the primary command and the resume `--session-id` retry command export
`CCRC_SESSION_GENERATION=<the exact value read under lock>` into that child's environment; releasing the lock
before the fork is safe because every lifecycle arm already refuses on an environment/canonical generation
mismatch under its own lock, so if the row is purged or its generation reused in the gap between close and
spawn, the child simply carries a generation that no longer matches — refused, not silently accepted. **That
refusal has no diagnostic and no bound in time:** a session spawned with a generation that was reused in this
gap is permanently inert for its whole life — every future compaction-lifecycle mutation for that row refuses
silently, by contract, and nothing distinguishes "this session's generation was reused before it ever ran"
from any other silent lifecycle refusal. §4 records this as its own row rather than folding it into the
ordinary mismatch case, because unlike an ordinary mismatch it cannot self-heal by any later event. No
compliant path may rely on tmux itself calling `closefrom()` or otherwise closing inherited descriptors: that
is a third-party implementation detail this design does not get to depend on. The resume
`--session-id` fallback independently acquires exactly once immediately before retry creation, requires the
same generation selected for that invocation/current same row (it mints nothing anywhere — the parenthetical
rules out the specific danger of minting FRESH into a row that changed underneath the retry, and does not
imply an ordinary mint path this arm has; round 11, B-M4), exports
it, and closes before the retry's own fork, by the same rule. No nested open and no sourced-ccd FD leak. Tests
inject every early return, prove immediate same-shell reacquire, prove primary/retry env, safe fresh-create
setup/spawn deadline, and red both a retained outer/primary FD mutant and a mutant that keeps the lock open
across either `_tmux_new_session` fork.

`_reg_purge` acquires/validates stable lock before lifecycle `purge` completion record or registry mutation,
captures measurement fields under lock, deletes exact-ID lifecycle artifacts and fields, deletes generation
last, and never deletes permanent lock. **The generation-last rule is a mechanism, not an outcome stated on its
own:** `.generation`'s suffix is dot-free exactly like every ordinary registry field, so the existing loop that
walks `$REG/$id.*` and skips only `suffix == archived || suffix == reaping` (`ccd/ccd:1840-1848`) would
otherwise delete it in ordinary glob order like any other field. Task 9 extends that same skip condition to
`archived || reaping || generation`, so the loop leaves it standing, and adds one further explicit
`rm -f "$REG/$id.generation"` after the existing archived/reaping tail (which itself must run first, per the
existing `reaping`-never-outlives-`archived` invariant) — mirroring the pattern the existing code already uses
for `hookstate.json`, `reaping`, and the conditional `archived` removal. Without both the skip-list extension
and the added final unlink, "deletes generation last" describes nothing the code does. A lock miss or unsafe
lock returns nonzero, emits no purge-done fact, deletes nothing, and never claims success. **A removal
failure is a different condition and round 9's text wrongly folded it into the same disjunction (round 10,
B-4):** the unlink loop runs strictly AFTER the emit, so by the time any `rm -f` can fail the purge-done fact
is already journaled; such a run returns nonzero with the fact on disk and registry/generation possibly still
standing, and its three post-action callers report `_lc_fail`. It is the emit that never claims success it
did not have, not the loop.

**The purge-done mechanism, measured, not the round-5 phrasing.** Round 5 described `_lc_done purge` as
emitted "only after successful purge using captured values"; round 6 dropped that sentence and kept only the
prohibition above. Measured against the shipped function (`ccd/ccd:1817-1828`) and its own comment ("this is
not half of a pair. It is the terminal fact... UNCONDITIONAL, and with NO `tx`"), the mechanism is the
opposite of round 5's phrasing: `_lc_done purge` is journaled **before** the unlink loop runs, unconditionally,
using values captured via `_reg_get` while the fields still exist to be read — the journal record does not
wait on deletion succeeding, because the backstop's whole point is that a destructive verb added later which
forgets to journal itself still leaves a record, and a record gated on the deletion loop's own success could
itself be defeated by the same failure it exists to survive. `server/test/ccd-lifecycle-purge.test.ts`'s
describe block is titled exactly this — `_reg_purge always journals, and journals BEFORE it unlinks`
(line 37) — with a source-order assertion pinning it. **That pin has ONE address, given in full here and
used unchanged everywhere else (round 11, M4): `ccd-lifecycle-purge.test.ts:37` (the `describe`), `:99` (the
enclosing `it('is unconditional: the emit is not guarded by any condition in the source')`), and `:115` (the
assertion itself, `expect.soft(emitAt, 'the backstop must precede the unlink loop').toBeLessThan(loopAt)`, with
`emitAt`/`loopAt` bound at `:111`/`:112`).** §3.4 addressed it as `:37`/`~111` and §6 as `:37`/`:99`; all
three anchors are real, so neither was wrong, but two spellings of one pin read as two pins to move. The
hedged `~111` is dropped. **This plan
declines to restore round 5's "only after successful purge" sentence verbatim: it is falsified by the pinned
test's own title and by the shipped source comment, not merely superseded.** What Task 9 does inherit from
round 5's intent is real, though: `_reg_purge`'s generation-last deletion and exact-family cleanup happen
strictly AFTER this early, unconditional journal emission, under the same stable lock — so the mechanism
worth stating is "capture-then-emit-early, deletion follows," not "emit-after-success." The
`ccd-lifecycle-purge.test.ts:37`/`:99`/`:115` source-order pin moves in the same commit as any Task 9 edit to
`_reg_purge`'s body, the same treatment round 6 correctly gave `session-hook.test.ts:2467`. **Its four
callers branch on the result, and three of them report differently from round 5's text:** `cmd_ws_rm`,
`_ws_reap_locked`, and `cmd_forget` each call `_reg_purge` only AFTER irreversible action (worktree, session,
branch, clips, or supervisor teardown has already happened), so a lock miss there cannot mean "nothing
happened" — it means real, irreversible work completed and the registry entry/generation were merely left
standing. Each of these three reports it as `_lc_fail <act> <id> <tx> <token> <detail>`, naming what completed
and that registry/generation remain, never a success string on stdout — this is exactly `_lc_fail`'s
documented distinction from `_lc_refuse` ("a refusal happens before anything irreversible, a failure after",
`ccd/ccd:2756`), and the withheld `purge` fact is itself what lets a caller or a reader distinguish a lock-miss
failure from a completed purge. The fourth caller, `_ws_gc_prune_row`'s dead-reg arm, calls `_reg_purge`
BEFORE any irreversible action on that row, so it alone may decline unchanged on a lock miss, in the
`_lc_refuse`-shaped sense round 5 described for all four. No rollback fiction. **Nothing forbids a caller
from emitting both `_lc_fail` and `_lc_done purge` for the same `tx` today; Task 9 must add that guard: a
`tx` has exactly one terminal fact, whichever fires first, and a caller path that could reach both is a
defect this design does not want to inherit.**

`_ws_slug_free` today globs `"$REG/$id".*` (a literal id, THEN a dot) and skips any suffix containing a
second dot — it is therefore structurally blind to every DOT-LEADING private family in this section
(lock-open alias, generation-read alias, marker source, lock-init/generation-init source, journal
stage/snapshot, and the permanent lock itself), because all of those start with a literal `.` **before** the
id, not after it. Before round 8 this paragraph both described that blindness AND asked a pin to observe the
opposite (a planted dot-leading residue reading not-free) — a pin no unchanged function could ever pass.
**Round 8 resolves this by widening the function itself, not by weakening the pin (Task 9):**
`_ws_slug_free` gains an exact-family dot-leading scan — for this id, strip the literal `.<id>.` prefix (the
same idiom PreCompact's own sweep already uses, §3.1 step 5) from every dotfile in `$REG`, and if what
remains matches ANY §3.4 private-family suffix grammar, or the file is the non-dot-leading canonical
`.generation` field, report **not-free**; the permanent lock's own suffix (`compactions.lock`) is the SOLE
named exclusion, since it is deliberately excluded from slug residue and spans generations by design. Every
OTHER private family — not merely one representative — is now visible to the check. The mutation-effective
pin plants `.demo.compactions.lock-open.1.2.3` (representative of the widened dot-leading class) **alongside
a second live id `demo.quiet`** and asserts each answers only for its own id — the widened prefix-strip must
not let `demo`'s check see `demo.quiet`'s residue or vice versa, which is exactly the nested-id hazard a naive
widening (a bare substring match instead of an exact `.<id>.` prefix) would reintroduce. Interrupted purge
preserves generation until last; safe reuse mints a fresh generation.

**`_ws_slug_residue` is widened IDENTICALLY, in the same task (round 9).** Round 8 widened only
`_ws_slug_free`, and the two functions are a pair: measured on the shipped tree they carry the same dot-skip
logic (`ccd/ccd:3940-3951` and `:3953-3962`), and `cmd_ws_add`'s refusal interpolates the second into the
message the first triggers — `die "slug in use: $slug — $REG/$project-$slug.{$(_ws_slug_residue "$project"
"$slug")}"` (`ccd/ccd:4356-4357`). Widening one alone makes `_ws_slug_free` refuse on a private-family residue
that `_ws_slug_residue` structurally cannot see, so the operator receives `slug in use: <slug> —
$REG/<id>.{}`: a refusal naming no file. That falsifies the shipped contract stated three lines above it
(`ccd/ccd:4350-4354`: "The refusal NAMES WHAT IT FOUND … The field list is the reclaim instruction: those are
the files, in `$REG`, and nothing else holds the slug"), which is the whole basis of this section's own "refusing
to build is the safe direction, it is visible … `rm` on the named files reclaims it" argument
(`ccd/ccd:3935-3939`), and it silently strands the slug in `_ws_slug_new` (`:3964-3974`) forever. So
`_ws_slug_residue` takes the SAME exact `.<id>.`-prefix strip, the SAME family-suffix match and the SAME
permanent-lock exclusion, emitting the dot-leading private names alongside the dot-free fields: **every reason
`_ws_slug_free` can refuse is a reason `_ws_slug_residue` can name.**

**Widening the residue function alone is NOT enough, and `cmd_ws_add`'s message template must change with it
(round 10, B-3).** The template hard-codes the prefix `$REG/$project-$slug.` — a dot AFTER the id — while
every widened family is dot-LEADING (`$REG/.<id>.compactions.lock-open.…`, the dot BEFORE the id). No return
value of `_ws_slug_residue` can make that template name such a file. Measured, with the shipped function body
in a throwaway `$REG` holding `.demo-quiet.compactions.lock-open.1.2.3`: returning the stripped suffix yields
`$REG/demo-quiet.{compactions.lock-open.1.2.3}`, whose implied path `$REG/demo-quiet.compactions.lock-open.1.2.3`
**does not exist**; returning the full dot-leading basename yields
`$REG/demo-quiet..demo-quiet.compactions.lock-open.1.2.3`, which **also does not exist**. That is strictly
worse than the empty-braces case round 9 set out to fix: the operator gets a confident reclaim instruction
pointing at a path that is not there, `rm` on it is a silent no-op, and `_ws_slug_new` (`:3964-3974`) then
skips that slug for its 60 attempts, forever. **So:** `_ws_slug_residue` emits complete `$REG`-relative
BASENAMES — dot-free fields as `<id>.<field>`, private families as `.<id>.<suffix>` — and `cmd_ws_add`'s die
prints them as a plain list rooted once, e.g. `die "slug in use: $slug — in $REG: $(…)"`, **dropping the
`$REG/<id>.{…}` brace template**, which cannot express a dot-leading name. Worth recording separately: that
template was never a working `rm` argument even for the dot-free case it was written for, because the shipped
separator carries a space (`out+="${out:+, }$suffix"`). Measured — `echo prefix.{uuid,workdir}` expands to
`prefix.uuid prefix.workdir`, while `echo prefix.{uuid, workdir}` prints the literal `prefix.{uuid, workdir}`
unexpanded. Two shipped comments assert the old
reason and must be restated as measured rather than left standing: `ccd/ccd:1129-1132`, which explains why
`$REG/claude-authdead` is invisible to `_reg_purge`, `_ws_slug_free` and `_ws_slug_residue` alike (after the
widening the reason is that the name is dotless *and* matches no `.<id>.`-prefixed private family, not the
dot-skip alone), and `ccd/session-hook.sh:1098` ("The same dot-free shape is what `_ws_slug_free` scans"),
which is no longer the whole of what it scans.

**Ordering, stated in full** — round 5 named only two locks, which understated it: the reap lock, reached
when `_reg_purge` is called through `_ws_reap_locked`, is the OUTERMOST lock (`cmd_ws_reap` acquires it before
`_ws_reap_locked` runs); the stable compaction lock nests inside it; and the lifecycle journal/rotation lock
nests inside that. No path holds any pair of these three in the reverse order.

**A disclosed, bounded cost: purge on a row with nothing left still mints the permanent lock.** The same
lock-acquire helper every caller uses initializes an absent canonical lock as its first step (Stable lock
protocol, above), and `_reg_purge` is exercised even against a bare/never-existed id
(`server/test/ccd-lifecycle-purge.test.ts`'s `_reg_purge never-existed` case). So a purge of an id that has, or
will have, no other registry file still leaves exactly one small regular file, `$REG/.<id>.compactions.lock`,
behind forever — purge is forbidden from ever deleting it, and `_ws_slug_free` already ignores it for reuse
purposes (above), so it never blocks a slug being reused. The cost is disclosed and bounded rather than fixed
with a second, non-creating acquire path: one dot-file per distinct id ever purged (idempotent — re-purging
the same id finds the lock already present and mints nothing new), growing with the fleet's total historical
id count, not with purge call volume, and invisible to every reuse/residue check that matters. An
operator-facing consequence follows directly from the ownership guarantees above: **`ws-rm` and `forget` can
now visibly decline** (an `_lc_fail`, per this section) when they race an in-flight compaction holding the
stable lock — a contention that could not exist before this lock did. That is a correct, disclosed cost of
ownership safety, not a regression to route around.

The cooperative ccrc boundary safely refuses what it can measure, not hostile same-UID replacement after the
last portable-Bash identity check.

### 3.5 Stage 2: the steering text (hook constant, pinned verbatim)

> ccrc: after compaction a structural card from this repository's knowledge graph will be re-injected,
> naming the files this context touched, their symbols as path:symbol:line, and the files that depend on
> them. In "Files and Code Sections" cite path:symbol:line with one sentence on why it matters; do not
> paste code snippets, the session re-reads them on demand and can run `graphify explain "<symbol>"`.
> Keep verbatim: decisions and their reasons, errors and their fixes, the user's messages, pending
> tasks, and the exact current step.

Printed as **one line** of plain text on PreCompact (the blockquote above wraps it for reading; the
constant has no newline), only after the helper's exit 0 AND a reconfirmed nonce ownership, only without the
steer switch, and only after the card-stage rename has already landed the canonical card (§3.1 protocol step
13). The print's own `printf` exit status is what `steered` records: the very next act, still under the same
held lock, is a private `jq` rewrite of the still-unrenamed set-stage file's own `steered` field to
`(that printf's exit code == 0)` — the stage is not yet canonical, so this touches no canonical byte — and
only then is the updated set-stage renamed into canonical: one uninterrupted section, no second lock
acquisition, **no later `jq` rewrite of canonical** (round 8 corrects an earlier draft that had the rename
itself somehow "carrying" the value, which no rename can do — a rename moves bytes, it does not write them).
A failed reacquire or a lost slot returns before the print ever runs, so no print is ever followed by a
`steered:false` it did not, in fact, earn; the residual named in §4 is the print succeeding and everything
after it — the private stage rewrite, then the rename — failing before it reaches canonical: not one syscall
wide (round 8 corrects this too, now that a `jq` rewrite sits between the print and the rename), but still
confined to this one process's own already-decided value, never re-derived, and surfacing only as the
canonical set staying the hook's earlier `files:null` placeholder for a compaction that WAS carded. It is
consistent with the operator's own `## Compact Instructions` ("drop verbose tool output
and full file listings"); where the base prompt asks for "full code snippets", the model arbitrates —
which is exactly why §3.4 exists.

### 3.6 Future wire and chip (Plan B, after the journal reader exists)

Plan A deliberately exposes **no hookstate measurement**. Its journal is the sole authority, and a
future server reader may publish the latest committed record after deriving its ordinal from physical
JSONL position. That design belongs to Plan B and must preserve absence tolerance without reintroducing
`n` as stored data.

The future L0 shape therefore omits `n`:

```ts
export interface CompactionMeas {
  at: number; trigger: 'auto' | 'manual'; scope: 'main' | 'subagent' | 'ambiguous' | null;
  chars: number; filesChars: number | null; fences: number;
  cited: number | null; setSize: number | null; steered: boolean; served: boolean;
}
```

Before Plan B can implement that type, it must specify one tolerant journal adapter that distinguishes
absent journal, unreadable journal, malformed tail and a valid latest record; it may attach a derived
one-based ordinal for display without persisting it. The old proposed hop
`hookstate.compaction -> FleetSession.compaction` is rejected by D-2605: a hookstate cache can race a
committed journal and is not an authority. `FLEET_PROTO` remains 1 if Plan B later adds an additive
field; the exact wire, persisted-revive and chip contract remains future work rather than a promise in
Plan A.

## 4. Failure modes, each silent by contract, each stated

| condition | behaviour |
| --- | --- |
| compact SessionStart missing/mismatched generation | before lock acquisition, no lifecycle pathname is inspected; card/set/marker remain byte-identical |
| stable canonical lock absent | initializer may publish it only from the private init source using `link`; a later canonical disappearance/replacement refuses, never recreates it |
| lock source/alias/FIFO/symlink/directory/mktemp/link/flock failure | close owned FD/source/alias; no critical mutation, no split critical section |
| card/set pair changes while SessionStart waits | acquire first, then inspect the current pair; no stale age/match/claim observation is reused |
| marker source link succeeds, EEXIST, or fails | unlink owned source on every handled result; only valid same-nonce final marker is idempotent |
| canonical set present but claim link fails | canonical remains untouched; no processing or record |
| canonical set genuinely absent (tested by pathname, never inferred from a `link` return) | no claim; `measure` runs without `--set`; one record committed with `scope:null` and all six provenance values null |
| helper exited 0/3 but PreCompact's reconfirm of nonce ownership failed (round 7, newly reachable under option A) | publish nothing; no `STEER_TEXT`; no `steered` stamp on any set; remove only this process's own stages (age-eligible residue on a failed reacquire); the compaction is measured against whatever a sibling published |
| (round 8, M1) `STEER_TEXT` printed and the card-stage already renamed, but the private `steered` stage-rewrite or the following set-stage rename fails | canonical card exists and was already read by the model; canonical set remains the hook's earlier `files:null` placeholder (or an un-renamed, updated stage only); PostCompact records that placeholder — `cited:null`, no working set — for a compaction that WAS carded |
| a session's generation was reused in the close-to-fork gap between row/`_spawn_start` releasing the lock and the child process starting | every future compaction-lifecycle mutation for that session refuses silently for its entire life; no diagnostic distinguishes this from any other silent generation mismatch |
| canonical unlink after same-inode claim fails | remove only verified claim; canonical bytes and original mtime remain unchanged |
| claim touch fails after canonical unlink | no-clobber restore only; if restore cannot prove same inode or collides, retain claim as exact stale residue and never overwrite occupant |
| helper/final lock/generation/FD/journal failure after settlement | no unlocked claim/marker cleanup; leave verified claim/exact marker unless a safely reacquired validated lock permits exact owned cleanup; no journal |
| later aged recovery | only matching exact-ID claim plus separately safe nonce marker/source is removed under stable lock; no retroactive journal record |
| generation canonical present but invalid or unreadable | refuse promptly; never repair, replace, remove, or classify as absent |
| generation canonical genuinely absent | only stable-lock protected private source plus no-clobber link may mint; EEXIST reclassifies winner |
| ccd purge LOCK miss (or unsafe lock) | no purge-done fact, NOTHING deleted, generation and registry remain; the three post-action callers report `_lc_fail`, the dead-reg pre-action caller alone may decline unchanged |
| ccd purge MUTATION failure (an `rm -f` inside the unlink loop) | **the purge-done fact is ALREADY journaled** — the emit precedes the loop unconditionally (`ccd/ccd:1828` before `:1840-1848`) — so registry and/or generation may remain WITH the fact on disk; callers report `_lc_fail`, never success. (Round 9's single combined row said "no purge-done fact" for this case too, which is false; corrected round 10, B-4) |
| (round 9, SCOPED round 10) lock MECHANISM absent — no `flock(1)` resolvable by the calling process, established by `command -v flock` before any acquire is attempted, never by a failed acquire | the three hook arms fail CLOSED: no card, set, stage, claim, marker or journal is ever published. `ccd ws-add` (`ccd/ccd:4341`), `ccd ws-restore` (`:6745`) and `ccd ws-reap` (`:10202`) keep their SHIPPED fail-CLOSED refusals and are outside this ruling. Of the `_reg_purge` callers, only `ws-rm` (`:4896`), `forget` (`:15555`) and `ws-gc --prune` (`:11668`) are governed, and they are gated on `$REG/<id>.generation`: **absent** ⇒ fail OPEN (`_reg_purge` runs its unlink loop and emits its purge-done fact, exactly as before D-2605 — no hook on that row ever held a generation, so nothing can race); **present** ⇒ fail CLOSED with the distinct mechanism-absent refusal, the **two** post-action callers that can be reached on such a box — `cmd_ws_rm` (`:4896`) and `cmd_forget` (`:15555`) — reporting `_lc_fail`, while `ws-gc --prune`'s dead-reg arm (`:11668`), which reaches `_reg_purge` before any irreversible act, DECLINES unchanged and `_ws_reap_locked` is unreachable (round 11, A-I5/B-M5). Recoverable by re-running from a flock-capable PATH. Row creation and `_spawn_start` skip generation initialization/export and continue **for row writes that do not pass through `cmd_ws_add`** — `ws-add` itself dies first. `_ws_slug_free` answers consistently, since on a box where no arm ever published, no compaction private residue exists to see (§3.4 Platform outcome, the five-site table, the generation gate, and facts i–iv) |
| crash after successful SessionStart stdout before marker | emitted card may later measure `served:false`; output and publication are not atomic |
| external replay after journal rename | an external later event may duplicate one committed record; process itself makes no internal reattempt |
| **(restored round 11, Package C — every measurement row below was deleted from this table by D-2605 round 1 and none had an equivalent at the chain tip)** served session: the payload's `transcript_path` is empty | no set, no card, no steering; PostCompact still measures, committing one record with `chars`/`filesChars`/`fences` and `scope`, `cited` and `setSize` **null** |
| no tool calls in the compaction window | helper exit 3: the set stands with `files: []` and no card-stage — a KNOWN empty working set, measured `cited:0`/`setSize:0`, never null |
| PostCompact reads a set older than `COMPACT_CARD_MAX_AGE` | the aged set is removed unread; the measurement still commits, with `scope`, `cited` and `setSize` null |
| the claimed set will not parse, or any `files[]` entry lacks a non-empty string `path` | measured as NO set — `measure` runs without `--set`, `scope`/`cited`/`setSize` null. **Never a smaller valid working set, and never 0**: dropping a corrupt entry would report a citation ratio against a set size the session never had |
| the card's first line is not the set's `nonce`, or there is no set | a crossed pair: nothing is served (§3.3 step 2), the card stays on disk until the overlap check or the age bound retires it, and the measurement reads `served:false` |
| the card was mined but never reached the model — crossed pair, aged card, failed emit, timed-out helper | `served:false` on the journal line, derived from the absent nonce marker; `cited` is not read against that line, which is the whole reason `served` is recorded |
| the summary is not in the nine-section format | `filesChars` null, every other field measured — 19% of summaries on the measured corpus (§0.2: 81% are) |
| the model ignores the steering entirely (Plan C, stage 2) | nothing fails and nothing is refused: that is precisely what `filesChars`, `fences` and `cited` exist to measure, recorded beside `steered:true` so the delta is computable against unsteered compactions |
| `~/.ccrc/compact-card-off` present at any arm | all three arms inert: no card, no set, no stage, no steering, no measurement and no journal line; a card already on disk is never served. Plan A keeps no hookstate `compaction`, so there is no cached chip value to carry or clear |

## 5. Mutation targets (red first, one mutation each)

The existing Task 1–8 mutation table remains binding for scope, card, helper, normalization, citations,
fences, exact-one helper output, raw JSONL, sixteen keys, no persisted `n`, and no hookstate cache. **That
deferral is honoured rather than assumed (round 11, Package C): the rows it defers to have LANDED, and here
are the ones that pin the measurement semantics §3.4's restored field table states**, measured on the shipped
suite — "the heading regex loses a spelling" is `server/test/compact-card.test.ts:833-838`, which exercises
`3. Files and Code Sections:` and its `**`-wrapped form; the fence rule and its unmatched opener are
`:842-870`; "`cited` folded to 0, or `scope` to `main`, without a set" is `:912-913` plus `:922-931`, `:944`
and `:954`; "`files: []` is a known empty set, not a missing one" is `:932` and `:940`; "PostCompact measures
raw text" is `:827-829`, where an `<analysis>` block is excluded from `chars`; and the citation boundary and
within-set suffix-uniqueness rules are `:875-893`. Round 1 deleted the PROSE those rows pin and left every one
of them green, which is why no suite reddened and no round noticed for ten rounds — a green suite proves the
mechanism, never the document. Task 9
adds the following real process and source pins, each through fixture HOME/PATH only.

| Task 9 mutation | expected red |
| --- | --- |
| move any compact SessionStart age/read/match/claim/delete/emission before stable acquisition | missing/mismatched old generation leaves aged card/set/marker byte-identical; a replacement barrier cannot reuse pre-lock observations |
| restore `exec {fd}<>"$lock"` or create-capable canonical open | canonical-disappearance/old-inode holder race refuses promptly, recreates no canonical, and never admits split critical sections |
| delete lock init/open alias cleanup or loosen a family matcher | successful publication/open leaves zero owned source/alias; crash residue ages out exact-ID only; dotted/shared-prefix neighbors survive |
| delete marker-source cleanup or make source grammar overlap final marker | success/EEXIST/failure leaves no owned source; crash source does not read as served marker; independent family matcher red |
| touch claim before canonical unlink | unlink-failure fixture changes canonical mtime; shipped path retains exact bytes+mtime |
| delete no-clobber restore/same-inode proof/claim retention | touch failure cannot restore original bytes+mtime; restore collision loses occupant or only verified claim |
| cleanup claim or marker after failed final lock without reacquiring validated lock | final-lock-timeout writes no journal and leaves exact residue; later aged locked cleanup alone removes it |
| generation via `_reg_get`, direct `cat`, shared write, or repair | malformed object fixture spawns/mutates/replaces generation; source pin and safe alias FD test red |
| omit generation source/read alias cleanup or loosen exact family | successful mint/read leaves no private residue; crashes age out exact-only; adjacent ID survives |
| retain row-creation or primary lock across setup/sleep, omit retry lock/env, or ignore an early close | deadline/same-shell reacquire/retry-reuse fixtures red; both primary/retry child envs carry exact generation |
| keep the lock descriptor open across `_spawn_start`'s or PreCompact's own fork instead of closing before it (an EFFECT pin, not the shape pin above) | a real forked child that outlives the parent's own `exec {fd}>&-` still lets a fresh acquirer succeed within `COMPACT_LOCK_WAIT`; restoring the hold makes a fresh acquirer time out until the child exits |
| **(round 9) background any command inside compact SessionStart's retained-lock section** — the one acquisition a human waits on, and previously the one held section with no mechanism at all, because the close-before-fork rule had been declared inapplicable here | enter the arm with the stable lock held and have the held section start a child that outlives it (`sleep 5 &`); let the arm return and close its FD, then assert a fresh acquirer still succeeds within `COMPACT_LOCK_WAIT_SERVE`. Backgrounding ANY command inside the section reds. Control, measured on bash 5.2.21: with every child synchronous a fresh acquirer succeeded in 424 ms (bounded by the holder's own lifetime), and with one `sleep 5 &` it timed out for the full 3 s wait — so the pin is effective in both directions, and it pins the property that actually makes holding safe (children are reaped in-section) rather than the false property that there are none |
| **(round 9, REWRITTEN round 10 — A-I2/B-2) lock-mechanism absence behaves as §4's row says** | Fixture HOME with `flock` made unresolvable by SHIMMING `command` — `command() { [[ "${1-}" == -v && "${2-}" == flock ]] && return 1; builtin command "$@"; }` — per `server/test/ccd-ws-reap.test.ts:355`'s own idiom, **never by emptying PATH**, because every stub in that suite spells its passthrough `command git`/`command find` and an emptied PATH would break them. Assert, leg by leg: (a) `ccd ws-add` REFUSES, exit non-zero, stderr containing its shipped `refusing to create a workspace unserialised`, and creates no registry field; (b) `ccd ws-reap` REFUSES with its shipped `_lc_refuse reap … flock-unavailable` / `refusing to run the destructive verb unserialised`, prints no document, and emits no `purge` fact; (c) `ccd ws-rm`, `ccd forget` and `ccd ws-gc --prune` on a **generation-ABSENT** row COMPLETE and `_reg_purge` emits exactly one `_lc_done purge`; **(d) SPLIT IN TWO (round 11, A-I5/B-M5), because the three governed callers do not answer alike and the round-10 wording let an implementer guess** — (d1) `ccd ws-rm` and `ccd forget` on a **generation-PRESENT** row REFUSE with the distinct mechanism-absent condition and each emits exactly ONE named `_lc_fail` and no `_lc_done purge`; (d2) `ccd ws-gc --prune` on the SAME row DECLINES unchanged, emitting neither `_lc_fail` nor `_lc_done purge`, because its dead-reg arm calls `_reg_purge` before any irreversible act. A leg asserting a THIRD `_lc_fail` is unsatisfiable on this fixture: `_ws_reap_locked` is never entered, `cmd_ws_reap` having died at `:10202-10204`. Mutations: making `ws-gc --prune` emit `_lc_fail` reds (d2); suppressing either reporter reds (d1); (e) the three hook arms publish NOTHING — no card, set, stage, claim, marker or journal line; (f) `_ws_slug_free` answers consistently with that state. Mutations, each reddening exactly one leg: deleting `ccd/ccd:4341-4342` or `:10202-10204` reds (a)/(b); making `_reg_purge` refuse on mechanism-absence regardless of generation reds (c); making it proceed regardless of generation reds (d1) and (d2); making the hook arms fall back to an unlocked publish reds (e) — that is §10's forbidden second regime. And establishing mechanism-absence by ATTEMPTING AN ACQUIRE instead of `command -v flock` reds — **but not for the reason round 10 gave (round 11, M7).** This fixture shims the QUESTION and leaves the real `flock` on PATH, so inside it an acquire-probe does not fail: measured here, with `command` shimmed, `command -v flock` answers **1** while a direct `flock -w 1 <fd>` on the row's own lock answers **0**. The mutant therefore concludes "mechanism present", proceeds, and reds (d1)/(d2) — the right red for the opposite reason to the one stated, which would send a reader debugging it to the wrong place. Add the explicit control asserting that direct `flock -w 1` answers 0 inside this fixture, so the mutation's redness is attributable to the probe substitution and not to a missing binary. The GENERAL argument — that `command -v` absence and a contended `flock -w` both spell their failure `1`, so the distinction must be carried by WHICH probe answered — is fact (iv), stated in §3.4, and it is measured there (uncontended acquire 0, contended acquire 1, `command -v` on a PATH without the binary 1; a genuinely missing binary invoked as a command answers **127**, not 1, which is a third value neither fact names) |
| revert the hook's set-temp producer to the pre-round-6 single-id `<pid>.compactset.tmp` grammar (or make the transition scanner assume single-id stripping) | residue planted at the shipped `_hook_write_atomic` name (`<pid>.<id>.compactset.tmp`), aged past `COMPACT_CARD_MAX_AGE`, is swept by the PreCompact arm while a same-aged foreign-id lookalike survives; reverting the grammar leaves the real residue standing |
| fold a genuinely absent canonical set into the link-failure no-record branch | PostCompact run with no `.compactset` present commits exactly one journal line with `scope:null`; collapsing the branches leaves zero journal lines |
| ignore `_reg_purge` result in any of four callers, or report a post-action lock-miss as decline/unchanged instead of `_lc_fail` | held-lock real fixture emits a named `_lc_fail` (not a suppressed success or a bare decline) for `cmd_ws_rm`, `_ws_reap_locked`, and `cmd_forget`, naming completed action and retained registry/generation; only the dead-reg pre-action caller may decline unchanged |
| emit both `_lc_fail` and `_lc_done purge` for the same `tx` | a fixture forcing both paths to fire for one `tx` reds against a guard requiring exactly one terminal fact per `tx` |
| **(round 7, option A) restore any canonical pathname to the helper's `card`-command argv** (`--set`/`--out`) | the argv-assertion fixture, extended to require `--set-stage`/`--card-stage` and to forbid `--set`/`--out` outright, reds the moment a canonical name reappears |
| **(round 8, THREE legs since round 9) drop `--parent-live`/`--live-agents` from the helper's `card` argv, have the helper derive them from `--scope`/`--trigger` instead of copying the hook's values, or convert `--live-agents` with `Number(v)`** | run the full PreCompact arm at `auto`/`main`, `auto`/`subagent` **and `manual`/`main`**; assert the canonical set after publication carries `liveAgents:0,parentLive:null`, `liveAgents:1,parentLive:false` and **`liveAgents:null,parentLive:null`** respectively, and that `measure --set <it>` yields a record `JOURNAL_RECORD_PRED` accepts (non-null `scope` and `cited` on the two auto legs). **The `manual`/`main` leg is the only one that can red a derivation mutant or the `Number('')` trap**, and it must be run through the full helper pipeline with a graph planted, since a fixture with no graph never reaches the `card` subcommand at all: `manual`/`main` and `auto`/`main` hand the helper the identical `scope:"main"` and no `--trigger`, so a scope-derivation table is correct for both auto legs and wrong only here; and `Number('') === 0` (measured, with `Number.isInteger(Number('')) === true`) turns this leg's `null` into `0`, a tuple §3.0's matrix does not contain and `JOURNAL_RECORD_PRED` rejects, committing no journal line while both auto legs stay green |
| **(round 7) the helper writes to a canonical set/card while both already exist** | run the card command against fixture canonical files present at both `.compactset` and `.compactcard`; assert both are byte-identical afterward — restoring either canonical write inside the helper reds this |
| **(round 7) the CAS: a sibling publishes `{ambiguous}` and removes the card while the helper runs** | a barrier fixture flips the canonical set to `ambiguous`/removes the card mid-helper-run; assert the originating PreCompact publishes nothing, the sibling's set survives byte-for-byte, no card exists, and only this process's own stages are gone; publishing without re-reading the nonce under the reacquired lock reds |
| **(round 7) stage completeness under a killed helper** | kill the helper mid-write (SIGKILL between its `.part` write and rename); assert no stage file exists, only a `.part`, and the hook publishes nothing |
| **(round 7, corrected round 9, SPLIT round 10 — A-I3; the order leg re-mechanised round 11 — B-M9) publication order — the PLAN A half, owned by Task 9** | **Leg 1, a SOURCE-ORDER pin, not a behaviour fixture:** inside `_hook_compact_pre`'s reacquired held section, assert the card-stage `mv`'s source offset is LESS than the set-stage `mv`'s; swapping the two statements reds, and the CONTROL is that with them swapped every behaviour test stays green — which is what shows a behaviour fixture could never have carried this leg. Round 10 kept "assert the card-stage rename precedes the set-stage rename (swapping the two reds)" with no mechanism named, and in Plan A there is none to find: the two renames are adjacent inside ONE held lock, the print and the stamp are "(stage 2 only)" and neither runs, so no concurrent hook can observe the intermediate state and the post-arm state is byte-identical under either order. An unpinned outcome is the defect class the round-10 split existed to close, reopened one row down. (The alternative mechanism — force the set-stage rename to fail and assert a canonical card exists beside the pre-helper set — is §4's own forced-set-rename-failure state and remains available; the source-order pin is chosen because it needs no injected failure.) **Leg 2, producible as written:** the arm publishes the helper's staged `steered:false` **byte-for-byte** — run the helper standalone into a temp stage with the same argv and compare; any hook-side rewrite of that member reds. That no `jq` ever rewrites the canonical set is already carried by the inverted source scan below, which reds on an unlocked or canonical-targeted `_hook_write_atomic`. These are the only legs a Plan A fixture can produce, because Plan A runs neither the print nor the stamp |
| **(PLAN C / stage 2 — owned by NO Task 9 step, marked outside Plan A the way §3.5 and §3.6 already are) print → stage-stamp → set-rename ordering** | When stage 2 exists: assert the card rename precedes the print, which precedes **the private `jq` rewrite that stamps `steered` into the still-unrenamed set-stage**, which precedes the set rename; a failed `printf` leaves `steered:false` stamped into the stage that same rename then publishes; stamping `steered` before the print, **rewriting canonical directly instead of the stage**, or stamping under a second lock acquisition, reds. **Round 9 made this row unreachable and round 10 moves it out:** the same round scoped "(stage 2 only)" to BOTH the print and the stamp and stated three times that in Plan A neither runs, while leaving this row inside a checklist §5 declares "every row this plan owns is named in a task" — so Task 9 was asked for a red no fixture can produce. That is D-2548's own recorded defect class, reopened by the commit that created the scoping |
| **(round 7) parameterized wait, not a same-named constant** | hold the lock 3 s while only the final transaction waits on it; exactly one journal line lands using `COMPACT_LOCK_WAIT`; passing `COMPACT_LOCK_WAIT_SERVE` at that call site instead reds (times out at 3 s under the 2 s bound) |
| **(round 8) wire `COMPACT_LOCK_WAIT_SERVE` at compact SessionStart's one acquisition, or leave it unwired** | hold the stable lock 3 s, then fire compact SessionStart; assert it returns having served nothing within ~2 s; passing `COMPACT_LOCK_WAIT` (5 s) at that call site instead serves at ~3 s and reds |
| **(round 7, recognizer INVERTED round 9) absent-canonical has exactly one meaning** | The round-8 recognizer grepped for a canonical-set literal *adjacent to* a primitive, and measured against the shipped tree it matches ZERO canonical-set mutation sites: in `ccd/session-hook.sh` the literal `compactset` occurs only at `:795`, `:796`, `:851`, `:920`, `:986` and the comment at `:1094`, none of which carries `rm`, `mv -f` or `link`; every mutating line (`:782`, `:802`, `:810`, `:817`, `:825`, `:836`, `:954`, `:964`, `:970`) names only a variable; and `ccd/ccd` contains ZERO occurrences of `compactset`/`compactcard`/`compactions` anywhere (measured `grep -c` = 0), so its own named inventory entry is unreachable by the stated pattern so its own named inventory entry is unreachable by the stated pattern. **Round 9 added "and the whole scan's single hit across both files is a comment (`ccd/ccd:1741`)"; that clause is dropped as unmeasured (round 11, M2).** Measured, `ccd/ccd:1741` reads `# this \`rm -f "$REG/$id".*\` directly were an unanchored glob: \`$id.*\`` — a primitive beside a registry GLOB, carrying no canonical-set literal at all, so it cannot be a hit of a recognizer defined as "a canonical-set literal *adjacent to* a primitive". The one line in either file that actually pairs a canonical literal with a primitive-shaped word is `ccd/session-hook.sh:1094` ("unlinks them with the row: `.compactset`"), also a comment. What the row needs to say is only what is measured: the round-8 recognizer's match set across both files is empty of real mutation sites, which is the whole argument. **The recognizer is therefore inverted.** Enumerate every rename/unlink/link/write primitive in the named files — `mv`, `rm`, `link`, `>` redirection and `_hook_write_atomic` in `ccd/session-hook.sh`; the BODY of `ccd/ccd:1840-1848`'s purge loop, not only its glob line; and `renameSync`/`unlinkSync`/`linkSync` in `ccd/compact-card.mjs`, which imports all three at `:23` and after Task 9 retains exactly the two inside `writeAtomic` (`:422-431`) — its `renameSync` at `:426` and the failure-path `unlinkSync` at `:428` — permitted only because no canonical pathname reaches the helper's argv; every other current occurrence (`:502`, `:506`, `:507`, `:508`, `:517`, `:519`, `:520`, `:528`, `:529`, `:537`, `:538`, `:546`, `:552`) sits inside `:433-560`, which Task 9 deletes. **THE ORDER MATTERS, and round 9 stated it backwards (round 10, A-M3): the canonical-pathname resolution is the FILTER that PRODUCES the found set, and only then must the found set EQUAL the allow-list.** Read the other way round — "require EACH primitive to appear on a named allow-list" — the row demands that every `mv`/`rm`/`>` in a 1,400-line hook and the whole purge-loop body sit on a four-entry list, which no correct tree satisfies. **The filter, and it covers the canonical CARD as well as the canonical SET (round 11, B-I2 — round 10 enumerated only the SET bindings while allow-listing a CARD rename, so the allow-list had a member the filter could never produce):** resolve the canonical pathname through the variables and positionals that carry it — **SET** `set="$REG/$id.compactset"` at `session-hook.sh:851` and `:920` (the third binding at `:986` belongs to `_hook_compact_served`, which this task DELETES, so it is absent from the post-Task-9 tree the scan runs over); **CARD** `cardf="$REG/$id.compactcard"` at `:851` and `f="$REG/$id.compactcard"` at `:920` (measured: `:851` binds `set` and `cardf` on one line, `:920` binds `f` and `set` on one line); `_hook_write_atomic`'s positional `$1` (`:780`, mutating at `mv -f "$tmp" "$1"`, `:782`) traced from every call site that passes one; and — **new clause, round 10** — **a variable bound by a GLOB whose pattern can match a canonical basename resolves to canonical.** That last clause is what puts `ccd/ccd:1848` (`rm -f "$f"`, with `f` bound by `for f in "$REG/$id".*` at `:1840`) into the found set honestly: measured, `ccd/ccd` contains ZERO `compactset`/`compactcard`/`compactions` literals, so its allow-list entry is unreachable by variable-binding or text adjacency alone, and a second glob-based canonical unlink added elsewhere in `ccd/ccd` outside the lock would otherwise evade the scan entirely. **"Adjacent" means same statement**, not same line and not same file. The helper's two surviving `writeAtomic` primitives (`renameSync` `:426`, `unlinkSync` `:428`) are excluded **BY THE FILTER** — no canonical pathname reaches the helper's argv at all, which is option A's load-bearing property — **not** by an allow-list entry; they appear on no entry and must not. **THE ALLOW-LIST, ENUMERATED BY MEASUREMENT (round 11, B-I2).** Round 10's four entries were unsatisfiable: at least five further canonical mutations exist on a CORRECT post-Task-9 tree and appeared on no entry, so the equality was RED on the correct tree and the only green path was to weaken the filter — losing the mutation-effectiveness the row exists for. The complete list is every rename/unlink/link of the canonical SET or CARD in the shipped hook plus every one the target protocol adds, each named here with its arm, its protocol step and its lock state; **the filtered found set must EQUAL exactly these thirteen.** (1) PreCompact step 6's ambiguous-card removal, `rm -f "$cardf"` (`session-hook.sh:865`), FIRST held lock. (2) PreCompact step 6's redundant-canonical-alias unlink (§3.1 item 5 — an `rm` on `$set` when canonical and an own claim are one inode under `-ef`), FIRST held lock. (3) PreCompact step 7's initial publication, `_hook_write_atomic "$set" "$doc"` (call site `:886`, mutating at `mv -f "$tmp" "$1"`, `:782`), FIRST held lock — round 8's inventory omitted this site entirely. (4) PreCompact step 13's card-stage rename into `$REG/<id>.compactcard`, SECOND (reacquired) held lock. (5) PreCompact step 13's set-stage rename into `$REG/<id>.compactset`, same lock. (6) SessionStart(compact) step 2's aged-card deletion, `rm -f "$f"` (`:923`), the one retained lock. (7) SessionStart(compact) step 3's claim by rename, `mv -f "$f" "$claim"` (`:954`), same lock. (8) SessionStart(compact) step 3's card restore on a losing, crossed or body-less claim, `link "$claim" "$f"` (`:964`, `:970`), same lock. (9) PostCompact settlement's claim link off canonical, `link "$set" "$claim"` — it names canonical, which is what puts it in the found set — settlement lock. (10) PostCompact settlement's canonical unlink, strictly before the claim `touch`, same lock. (11) PostCompact settlement's no-clobber restore after a failed `touch`, `link "$claim" "$set"`, same lock. (12) `_reg_purge`'s purge-loop body, `rm -f "$f"` with `f` bound by `for f in "$REG/$id".*` (`ccd/ccd:1840` → `:1848`), stable lock held for the whole function body. (13) `_reg_purge`'s generation-last unlink, `rm -f "$REG/$id.generation"`, placed AFTER the archived/reaping tail (`ccd/ccd:1868`) and therefore OUTSIDE `:1840-1848`, same lock — it is on the list because `.generation` is a canonical row artifact by Plan A's own Global Constraints, beside `.compactcard`, `.compactset` and `.compactions`; a future round that narrows "canonical pathname" to the set and card alone must move entry 13 to the excluded list in the SAME edit, or the equality breaks again. **Named for completeness and EXCLUDED BY THE FILTER — each must appear on no entry, and a scan that produces any of them is over-broad:** PreCompact step 6's exact-family age sweep (`find … -name ".$id.*compact*.tmp" … -delete`, `:869`, and its Task 9 exact-family successor), whose dot-LEADING `.tmp` grammar cannot match a canonical basename, so the glob clause does not reach it; PreCompact step 13's stage `rm`s on the non-publishing outcomes, which remove the unrenamed private stages and never name canonical; SessionStart's `( set -C; : > "$claim" )` placeholder and its `rm -f "$claim"` at `:955`/`:965`/`:971`/`:974`; PostCompact's `touch "$claim"`, which is private and is not in the primitive list at all; the marker source's `mktemp`/`link`/`rm`; and the helper's two `writeAtomic` primitives named above. **NON-VACUITY control, mandatory (strengthened round 10):** assert the found set is NON-EMPTY and contains BOTH `_hook_write_atomic`'s call site at `session-hook.sh:886` AND `ccd/ccd:1848` — a scan that finds nothing cannot red on anything, the round-8 spelling found nothing, and requiring only `:886` would leave the glob clause itself unproven. Added mutation: a second unlocked `rm -f "$REG/$id".*` loop elsewhere in `ccd/ccd` must red; under the round-9 resolution rule, with no glob clause, it stayed green. Mutations: restore `_hook_compact_rollback_set` (`ccd/session-hook.sh:792-819`) verbatim ⇒ reds, reached through `$set` → `$1` → the `mv -f "$set" "$claim"` at `:802`; add an unlocked `_hook_write_atomic "$set" "$doc"` outside any held lock ⇒ reds. Both stay GREEN under the round-8 literal-adjacency spelling, and both leave every behaviour test green |
| delete generation-last, drop `generation` from the purge loop's `archived`/`reaping` skip condition, or make `_ws_slug_free`'s widened dot-leading-residue check (round 8, Task 9) ignore a planted lock-open-alias residue, or let it leak across ids | interrupted purge permits reuse or safe reuse retains old generation; a fixture that leaves `generation` out of the skip list reds by deleting it out of order; `.demo.compactions.lock-open.1.2.3` planted alongside live id `demo.quiet` must read as not-free for `demo` only — the permanent lock alone must NOT, and `demo.quiet` must answer free for itself — a fixture that makes any of these read the wrong way reds |
| **(round 9, STRENGTHENED round 10 — B-3) widen `_ws_slug_free` without widening `_ws_slug_residue` AND `cmd_ws_add`'s message template, so `ws-add`'s refusal names nothing — or names a path that does not exist** | Plant `.<project>-<slug>.compactions.lock-open.1.2.3` in a fixture `$REG` beside a second live id `<project>-<slug>.mesa`, run `ccd ws-add --slug <slug> <project>`, and assert **(a)** it refuses, **(b)** the die message contains the literal basename `.<project>-<slug>.compactions.lock-open.1.2.3`, and **(c) every filesystem path the message names EXISTS** — parse the message, `stat` each path. **(c) is the mutation-effective part:** it goes RED under the round-9 text as written, because the `$REG/<id>.{…}` template cannot express a dot-leading name, and GREEN only once the template is replaced by a plain list rooted once. Reverting `_ws_slug_residue` alone must still red (a)+(b), while `_ws_slug_free`'s own not-free pin stays green, so the two functions cannot drift apart again. Measured on the shipped tree, `_ws_slug_free` (`ccd/ccd:3940-3951`) and `_ws_slug_residue` (`:3953-3962`) carry identical dot-skip logic and `cmd_ws_add`'s refusal at `:4355-4357` interpolates the latter, so widening only the former yields `slug in use: <slug> — $REG/<id>.{}` — empty braces, naming no file, falsifying the shipped contract three lines above it (`:4350-4354`, "The refusal NAMES WHAT IT FOUND … The field list is the reclaim instruction") |

## 6. Rings, invariants, and the waiting amendment

- **Rings and authority.** `compact-card.mjs` remains deploy-side `node:*` only. Plan A has no wire or
  hookstate compaction cache; journal physical-line ordinal is derived. Null-vs-zero, the sixteen-key
  predicate, exact-one output, retained journal FD/CAS, atomic stage/rename, and replay boundary remain
  unchanged. **Anchors are per-engine, not blanket (round 9, replacing "exact `\z` anchors … remain
  unchanged").** The journal predicates' `\z` anchors are jq/Oniguruma and remain unchanged there; every
  hook-side bash `[[ … =~ … ]]`, §3.3 step 2's nonce validator included, anchors with `$`, because POSIX ERE
  has no `\z` and reads it as a literal `z` (measured; §3.4, "Which regex engine anchors what"). The old
  blanket phrasing is exactly what made copying a `\z` into a bash arm the natural error.
- **Waits and lock division.** Ordinary hook paths are lock-free. PreCompact, compact SessionStart, and
  PostCompact use the permanent compaction flock only after their non-lifecycle guards; helper calls use the
  eight-second deadline. **No arm holds this lock descriptor open across a fork or exec it does not control:**
  PreCompact closes before its helper call and reacquires after; `_spawn_start` closes before either
  `_tmux_new_session`, with nothing left to do under lock afterward. Row creation, spawn, and purge use the
  same lock outside hook hot paths, nested inside the reap lock whenever purge is reached through
  `_ws_reap_locked`. The wait is the acquire helper's first positional parameter: compact SessionStart's one
  acquisition — the sole one a human waits on — uses `COMPACT_LOCK_WAIT_SERVE` (2 s); every other acquisition
  in this design (PreCompact's two, PostCompact's settlement and its post-settlement final journal
  transaction, row creation, `_spawn_start`, and `_reg_purge`) uses the shared `COMPACT_LOCK_WAIT` (5 s,
  argued from ≥ 8× the measured p95 of the sections it guards, per §2) — round 7 retires round 6's separate
  `COMPACT_JOURNAL_FINAL_LOCK_WAIT` in favor of this one shared bound. No lock is held over arbitrary setup,
  TUI settle, or `SPAWN_RESUME_SETTLE_S` sleep. `flock(1)`
  is util-linux and absent from stock macOS/BSD; there the **compaction lifecycle** refuses uniformly, like a
  missing `find` or `jq`. `ws-add`, `ws-restore` and `ws-reap` keep their own SHIPPED fail-closed refusals
  (`ccd/ccd:4341`, `:6745`, `:10202`), which this design does not touch; `_reg_purge` reached through
  `ws-rm`, `forget` or `ws-gc --prune`, plus row creation and `_spawn_start`, keep working as they did before
  D-2605 **only on a row with no `$REG/<id>.generation`** — a row that carries one refuses, recoverably, per
  §3.4's generation gate (§3.4, Platform outcome, and §4's row). Mechanism-absence is established by
  `command -v flock` before any acquire is attempted, never inferred from a failed one.
- **Exact lifecycle ownership.** §3.4's family table is the sole inventory for initial sources, open/read
  aliases, claim, marker, stage/snapshot, generation and cleanup. The stable lock spans generations and is
  intentionally excluded from slug residue; all other private families and `.generation` are residue.
- **Purge honesty.** The stable lock precedes lifecycle journaling/rotation; the full ordering is reap lock
  (outermost, when reached through `_ws_reap_locked`), then stable compaction lock, then lifecycle
  journal/rotation lock, never reversed. **`_reg_purge` emits its terminal fact EARLY — capture under lock,
  emit, then delete** — and this invariants section said the opposite ("may not emit its terminal fact until
  completed") for three rounds after §3.4 retracted it; an implementer obeying §6 would gate the emit on the
  unlink loop's success, which is precisely the mutant `ccd-lifecycle-purge.test.ts:37`/`:99`/`:115` exists to red
  and which `ccd/ccd:1822-1827`'s own comment argues the backstop exists to avoid (round 10, B-4). Its
  three post-action callers (`cmd_ws_rm`, `_ws_reap_locked`, `cmd_forget`) report a lock miss as `_lc_fail`,
  never a suppressed success or a bare decline, since irreversible work already happened by the time they
  call it — only the dead-reg pre-action caller may decline unchanged. `ws-rm` and `forget` can therefore
  now visibly decline against an in-flight compaction; that is disclosed, correct behavior.
- **Plan A stdout.** PreCompact/PostCompact stay silent. Compact SessionStart has its one envelope and marker
  crash boundary; Plan C alone adds steering stdout.

## 7. Deploy and staging

This spec yields **three plans at two explicit seams**, each independently useful:

1. **Plan A — agent lane**: §3.0–§3.4 (the scope rule, the three arms, the helper's two subcommands),
   §5's Hook, Helper and Installer groups. The payload measurement this item once named as its first task
   was taken before the plan (2026-09-09, §0.2) and came back negative, which is what produced §3.0;
   Plan A's first task is now the scope resolver with its fixture session directory. Deploy agent-first:
   `deploy.sh`'s agent lane ships hook and helper through `install_atomic`; the hook is read fresh at
   every event, no restart, no `caps` change. The journal is the deliverable — the corpus starts filling
   with no console change.
2. **Plan B — console lane**: first design the §3.6 journal adapter and its absent/unreadable/malformed distinctions; only then define the additive wire and chip. It reads the journal, never hookstate.
3. **Plan C — stage 2**: §3.5, the `--steer` pass and the print, after the baseline. **The act that takes
   the baseline is named**, as R5's revisit had to be (D-1365): on the fleet box, on a dated day,
   `cat ~/.cc-sessions/*.compactions | jq -c 'select(.steered==false)'` over the live sessions' journals,
   after at least 7 days or 100 journal lines since Plan A's deploy, whichever comes first; the reading —
   per lane, `chars`, `filesChars`, `fences`, `cited/setSize` — is recorded in Plan C's own measurement
   section before its first task, and the same command with `.steered==true` is re-run 7 days after
   Plan C deploys. Journals are per-session and purged with the session, so the baseline is a sample of
   the sessions alive that day, not a series; that is stated in the reading, and it is enough — the
   comparison is per lane and per tree, not per session.
4. Deviation numbers are minted at plan time through `ccrc-api ledger allocate`; this spec points to Plan A's already allocated D-2605 and defines no number itself.
   Candidates the plans will number: the R1 sentence and hook-header correction (§6); the `(not in
   graph)` overloaded sentinel the prototype produced, recorded so nobody re-derives it; the standing
   clip's status as the only defence for `GM_NODES`, which this design nearly removed; the
   `agent_type` guard the approved design carried and the measurement removed (§0.2, §3.0); and the
   newest-file rule the first amendment carried and the review refuted (§0.2) — a deviation from an
   approved design is numbered so nobody re-derives either.

## 8. Rejected, with the measurement that rejected each

- **A community-centric card.** 9 files → 50 communities; the budget went to listing them and the
  file-specific sections came out empty at every size tried.
- **A python helper.** Equivalent cost (0.13 s), but not testable from vitest, and the only python on the
  box that ccrc owns is graphify's venv, which is graphify's.
- **Steering from a `CLAUDE.md` `## Compact Instructions`.** The read-side ruling forbids ccrc writing
  one; and the binary does not merge that section — the model reads it in context and arbitrates.
- **ccd typing `/compact <text>`.** Manual compactions only — 42% of the gpt lane's were auto (85 of
  202), 0–7% elsewhere, and the auto ones are the ones that fire mid-turn at the wall; ccd
  already types a bare `/compact` at idle, and the hook covers both triggers.
- **Replacing section 3 with a digest and telling the summariser to omit code.** Fights the fixed base
  prompt hardest; if the model ignores the omission the session pays for both; the digest has its own
  sizing problem. Revisit only if stage 2's measurement shows `filesChars` not moving.
- **The `graphify` CLI as the card.** 1.4–1.7 s per call, single node, no file-set input.
- **A per-tree cache of the graph's file list** under `~/.ccrc` or `graphify-out/`. The sweep owns
  `graphify-out/`; the helper parses the whole graph in 0.13 s anyway, and the cache was the largest cost
  only in the `jq` prototype.
- **A fleet-wide journal under `~/.ccrc`.** It combines unrelated session writers and needs fleet-wide
  retention policy. The per-session journal remains the bounded-context artifact; it still needs its
  own stable lock because multiple contexts of one session can PostCompact concurrently.
- **A hookstate measurement cache.** Rejected by D-2605: it is a second mutable sink that can race the
  authoritative journal. Plan A writes only the journal; Plan B must read it.
- **Persisted `n`.** Rejected by D-2605: under concurrent writers it is derived state with its own race.
  The committed physical line position is already the ordinal, so every reader derives it.
- **Direct `printf >>` to the journal.** Rejected by D-2605: shell append does not make a JSON record
  transaction atomic and cannot preserve the old file on partial failure. Build-and-rename runs under
  the stable per-session flock.
- **Rewriting `set.served`.** Rejected by D-2605: SessionStart can race PostCompact and a successor set.
  A nonce-keyed marker records successful emission without mutating canonical set ownership.
- **Blocking compaction from PreCompact (exit 2).** Never; the wedge plan already showed what a
  compaction that cannot proceed costs.

## 9. Two levers outside ccrc, unchanged by this design

- `~/.cc-handoff/restore.sh` emits up to 24,576 bytes at SessionStart(compact); the harness spills above
  10,000 chars, so at every compaction the model gets a 2 KB preview and a path instead of the plan and
  the handoff note. Capping the script under 10,000 makes it land inline again.
- The `remember` plugin has re-delivered the same unchanged handoff at every SessionStart and prompt of
  this session (57 deliveries since 2026-09-07 21:52 at the time of writing).

## 10. Open residuals, stated

- Extension-less files are invisible to shell-text mining (12 of 853 on the graph built at 988ac1f4).
- The failed-compaction window in §4, including the deliberate `emit -> marker -> unlock` crash window: stdout
  can be visible without durable served evidence, so a later record may say `served:false` for a card that was
  emitted.
- Plan A gives at most one journal commit attempt per actual PostCompact hook process, not exactly-once delivery
  across an externally replayed event. A crash after rename before cleanup can therefore be replayed into a
  duplicate record until a future durable event-source invocation ID participates in the same transaction.
- The `ambiguous` rate and the false-exactness rate of §3.0, both counted on the first live corpus. A
  Workflow fan-out is `ambiguous` by construction; the only discriminator that would card those is an
  agent id on the three payloads, which only Claude Code can add — the journal says whether asking is
  worth it.
- **(restated, round 7)** Under option A the helper no longer has a slot re-read-to-rename interval at all —
  it never reads or renames a canonical pathname, so that specific race is gone, not merely excluded by a
  mutex. What remains is the **one-slot ambiguity itself**: this session still has exactly one canonical
  set/card pair, so two contexts of the same session can still only be told apart by the liveness rule of
  §3.0, never by having independent slots to publish into. PreCompact's own reacquire-and-revalidate CAS
  (§3.1 protocol steps 11–13) now executes entirely while the shared ownership mutex excludes PostCompact
  settlement and every other ccrc canonical publisher/claimer, closing the race option A was built to close;
  only a future per-transcript slot can remove the one-slot ambiguity itself, before the canonical pair even
  exists. The journal's `parentLive`/`liveAgents` fields keep that residual measurable.
- The `ambiguous` rate decides whether the fan-out case is worth asking Claude Code for an agent id.
  Task 6 already measured helper cost on the fleet's real admissible graphs; the lock waits (`COMPACT_LOCK_WAIT_SERVE`,
  `COMPACT_LOCK_WAIT`, §2) are deliberate missed-sample bounds whose contention rate is measured from the
  first live corpus.
- 2 of 24 live processes already run 2.1.267, which no binary fact here was read from; the first live run
  of Plan A on such a session is the check, and the payload measurement of §0.2 (the three key sets, one
  subagent compaction, and the subagent transcript's location) is repeated on it.
- If Anthropic enables precomputed compaction reuse on this fleet, stage 2 forfeits it; `steered` and the
  journal make that visible before it costs anything.
- **A named cost of option A, stated as a cost, not a side effect.** On a userland with no `flock(1)` binary
  the whole compaction lifecycle goes inert (§3.4, Platform outcome) — and because option A moves EVERY
  canonical publication behind that lock, this now means **no canonical set is published either**, where the
  pre-round-7, unlocked-helper shipped hook would still have written one (unsafely). This design explicitly
  rejects the alternative of falling back to an unlocked publish when `flock` is unavailable: that would be a
  silent second, lock-free concurrency regime living alongside the locked one, which is exactly the
  "accept and document the race" option §3.0 already forbids — just gated on a different condition. The
  honest choice is uniform inertness, stated here as its cost rather than left implicit.
- **(round 9, SCOPED round 10) The scope of that inertness, and the part of it this design declines to pay.**
  The bullet above is about compaction artifacts, and only those. `_reg_purge` is ccd's universal
  registry-destruction backstop — `ws-rm`, `forget` and `ws-gc --prune` reach it with no flock gate of their
  own, two of them only after irreversible action — and gating it unconditionally on a mechanism it never
  needed would have wedged every slug on such a box permanently, not transiently. §3.4's Platform-outcome
  ruling therefore fails OPEN there **on a generation-absent row** and CLOSED in the hook arms, argued from
  four facts plus the generation gate and pinned by a §5 fixture. **`ws-reap` is NOT in that list and round 9
  wrongly put it there (round 10, B-2):** `cmd_ws_reap` already refuses at `ccd/ccd:10202-10204` on such a
  box, pinned by `server/test/ccd-ws-reap.test.ts:342`, so it was never among the commands this ruling
  rescued — it is wedged there by shipped code independent of this design, deliberately. B's strengthening is
  worth recording: on a box where `ccd ws-add` also refuses (`:4341`), **no workspace row and hence no slug is
  ever taken at all**, so the "every slug wedged permanently" cost feared here cannot arise from ws-add. The
  residual that remains is narrower and
  real: **on a `flock`-absent box this design measures nothing at all.** No journal line is ever written, so
  the box is invisible to every question the journal exists to answer, and no diagnostic distinguishes it from
  a box on which nobody compacted. The fleet in question is Linux throughout, so this is a portability
  residual rather than a live one, but it is not a zero.
