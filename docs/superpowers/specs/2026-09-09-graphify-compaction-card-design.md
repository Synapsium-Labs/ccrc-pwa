# Graphify-aware compaction: the structural card, the steering, the measurement — design

**Date:** 2026-09-09
**Status:** design approved in five sections by the operator (2026-09-09); **amended 2026-09-10** after the
payload measurement of §0.2 came back negative — the subagent guard became the scope rule of §3.0, on the
operator's direction that compaction works for a subagent exactly as for the main thread. The first draft of
§3.0 (newest file wins) was refuted by an adversarial review the same day and replaced by the liveness rule,
which answers `ambiguous` where it cannot answer. A second review of that rule and of Plan A (2026-09-10, four
agents) closed the remaining holes named in §3.0–§3.4 and Plan A's ledger (D-2411–D-2420). **Amended again
before Task 9 on 2026-09-12 (D-2605):** the journal is the sole measurement sink; a stable, never-unlinked
per-session lock is the shared ownership-and-journal mutex; PostCompact publishes a private claim only through
an atomic exact-target hard link from the canonical set while holding that mutex, records the canonical age before
that link, and touches the linked claim active before release. Serving is recorded by a nonce marker rather than a
raced set rewrite, and journal commits are serialized and atomically replaced. Plan A is written and Tasks 1–8 are
implemented; Task 9 is not.
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
(3) *measured* — the effect is a number per compaction on the wire, never an assertion.

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
PreCompact ──► safely acquires flock($REG/.<id>.compactions.lock), then scope + overlap/young-claim check
   │          └─► $REG/<id>.compactset   (JSON: at, nonce, scope, provenance; files null)
   │          └─► helper `card` (never for ambiguous) ─► $REG/<id>.compactcard  (line 1: nonce; then text)
   │                                                   └─► canonical set  (rewritten: files, tags, counts, steered)
   │          └─► releases that same lock only after every canonical publication/rollback is complete
   └─ stage 2: prints STEER_TEXT iff the helper exited 0 and the steer switch is absent
summariser  (Claude Code; reads Additional Instructions)
SessionStart(compact) ──► atomically claims and emits a matching card; exports its nonce
                          └─► $REG/.<id>.compactserved.<nonce>  (created only after successful emit)
PostCompact ──► safely acquires the same lock; records canonical age; atomically hard-links its canonical set
                to absent $REG/.<id>.compactpost.<pid>.<random>.<random>.claim, touches that active claim, then
                unlinks only the canonical alias; releases lock
   └─► helper `measure` (compact_summary on stdin; only that private claim is passed when saved age permits)
       └─► safely reacquires the same lock, FD-validates old physical JSONL lines, builds old bytes + one complete
           JSON line in a dot-temp, rechecks journal identity, and atomically renames the stage over $REG/<id>.compactions
The journal is Plan A's sole authoritative measurement sink; readers derive ordinal from physical line position.
Task 9 creates no hookstate field and Plan A has no wire/chip hop.
```

**Staging.** Stage 1 ships everything except the print: card, measurement, wire. Stage 2, a separate PR
after a baseline window, ships the print. Every measurement carries `steered: true|false`, so the delta
is measured against unsteered compactions that were recorded with the card already present.

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
| `COMPACT_JOURNAL_LOCK_WAIT` | 2 s | hook | `flock -w 2` after safe open of the shared stable ownership-and-journal mutex in PreCompact and PostCompact; an ownership/journal miss is cheaper than waiting behind a wedged holder, and this is the second, separately bounded half of R2 |
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
carry today. The rule records its own inputs beside its verdict — `parentLive` (true/false, null on a
manual trigger) and `liveAgents` (the count) — in the set and the journal, so every verdict can be
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
its own lifecycle artifacts, publishing its initial canonical set, and waiting for/accepting/rolling back its
`card` helper's canonical rewrite. It releases only after that publication path is complete; it does not hold
it across any later arm.

Before PostCompact settles the predecessor, a lock-holder may find either the canonical set or a **young
private PostCompact claim** younger than `COMPACT_CARD_MAX_AGE`. Either means another compaction is in
flight (or failed inside the window), so the later PreCompact degrades its **own** set to `ambiguous` and
removes the canonical card. While the predecessor is still canonical, the symmetric degradation already
implemented may also replace it; once PostCompact's successful under-lock hard link has published a private
claim and the canonical alias is unlinked, that link is the settlement boundary: no later PreCompact may rewrite,
relabel or delete that claimed predecessor. It can say only that overlap was observed and degrade its own card/set. A failed
compaction followed within the window can therefore cost the successor its card, but cannot falsify the
predecessor after settlement.

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
independent shell-generated claim identity owns settlement only. The helper's existing canonical slot
re-read still protects its two PreCompact writes; PostCompact's rename closes the remaining
read-to-rename race for the measurement path.

### 3.1 PreCompact arm (hook)

Runs from the very end of the hook, **after** the hookstate rename: the `working` stamp lands first and
never waits on any of this. Guard chain, in order, every failure silent and total for what follows:

1. `~/.ccrc/compact-card-off` absent.
2. `.transcript_path` non-empty and a readable regular file.
3. `_hook_compact_scope "$tp" "$trigger"` (§3.0) answers. It needs `find`, which is new to this file and
   guarded inside the resolver with the `command -v jq` idiom — a box without it says **nothing**
   (no set), never a silent `main`. Before it inspects a canonical set, a young claim, or any new
   lifecycle family, call the one §3.4 safe lock-open/acquire helper. It creates an absent stable lock only
   with noclobber regular-file creation; a missing, unsafe, replaced, or contended lock makes PreCompact
   inert: no overlap decision, sweep, set/card publication, or helper call. On success it retains the
   descriptor lock through steps 3–6, including the helper's set/card publication and rollback.

   Under that lock, perform the **overlap check** of §3.0 (an unconsumed set younger than
   `COMPACT_CARD_MAX_AGE` → `ambiguous`, card removed), now over both the canonical set and young regular
   claims matching `$REG/.<id>.compactpost.<pid>.<random>.<random>.claim`. A claimed predecessor is
   observation-only: PreCompact never rewrites or removes it. Also sweep this id's stale already-tested
   helper/rollback/card temp families plus new PostCompact artifacts older than the window. Parse each
   basename by first removing an exactly quoted literal `.<id>.` prefix and then matching its remaining
   suffix grammar; never put the id inside an unescaped glob or ERE. New candidates are deleted only after
   their basenames match one exact grammar: `compactpost.<digits>.<digits>.<digits>.claim`,
   `compactserved.compact-<digits>-<digits>-<digits>-<digits>`,
   `compactserved.<digits>.<digits>.<digits>.tmp`, or
   `compactions.<digits>.<digits>.<digits>.tmp`. The marker temp independently reserves its own decimal
   random components but uses the same PID-plus-two-random-component shape. All lead with a dot and are
   invisible to `_reg_purge`. `$REG/.<id>.compactions.lock` matches none of those grammars, is explicitly
   excluded before deletion, and is never swept, repaired, replaced, or unlinked. This exact-prefix parse
   protects a second legal id such as `demo.quiet` when this id is `demo`, and vice versa.
4. Still under that lock, `_hook_graph_measure` runs — for its `GM_CWD`, `GM_BUILT` and `GM_FRESH`, which
   the set records whatever comes next — and **the set is written here, always**, by the hook (`jq -cn --arg …`,
   temp-then-rename, the temp `$REG/.<id>.$$.compactset.tmp`):

   ```json
   {"v":1,"at":1789330000000,"nonce":"compact-1789330000000-<pid>-<random>-<random>","scope":"main","agent":null,
    "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
    "parentLive":true,"liveAgents":0,"overlap":false,
    "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh","steered":false,
    "files":null,"stats":null}
   ```

   `at` is an epoch-millisecond measurement only. PreCompact generates `nonce` once from that
   measurement, its PID and two Bash random values; it owns every set/card pairing and rollback.
   `files: null` means **not mined**; the helper's `files: []` means **mined, empty** — two
   conditions, two values. `cwd`, `built` and `fresh` are
   `null` when the measurement had nothing to say; `parentLive`/`liveAgents` are null on a manual
   trigger. `overlap` is true only when this PreCompact observed a young canonical set or private
   PostCompact claim; otherwise false. Task 9 removes `served` from every future `.compactset` writer and
   rewrite; the isolated `measure` API may tolerate a legacy input member, but hook PostCompact never reads
   or trusts it. An `ambiguous` scope has `transcript: null`, `agent: null`, and the arm **stops here**.
5. The graph gate: `_hook_graph_measure` returned 0 **and** `_hook_gate_tree` holds — a graph no more
   than `GRAPH_GATE_MAX_BEHIND` commits behind HEAD, the same predicate as the search gate, so the card
   and the gate agree about which trees count.
6. `$HOME/.cc-sessions/compact-card.mjs` present. `node` and `timeout` are **not** guarded: a missing
   one fails the call exactly as a failing helper does (exit 127, swallowed by the call site), and a
   guard whose removal changes nothing observable is not a guard — on a userland with no `timeout` the
   helper never runs, the set is consumed by PostCompact, and the journal stays empty (§4).

Then, with `--transcript` the resolved file of step 3 — never the payload's — and numeric
`--at` plus the separately generated ownership `--nonce`:

```
_hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" card \
  --transcript "$transcript" --cwd "$GM_CWD" --graph "$GM_CWD/graphify-out/graph.json" \
  --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
  --out "$REG/$id.compactcard" --set "$REG/$id.compactset" \
  --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
  --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$scope" --at "$at" --nonce "$nonce" [--agent "$agent"] [--steer]
```

`--steer` is passed when stage 2 is built and `~/.ccrc/compact-steer-off` is absent, and it changes
nothing the helper writes. The parent retains the stable descriptor lock while it waits for this bounded helper
and while it performs the following canonical `steered` rewrite/any rollback; PostCompact cannot settle a
half-finished writer. **`steered` is stamped by the hook, after the fact** — in stage 2, only after
exit 0 and only after `STEER_TEXT` has been printed, one `jq` rewrite of the set sets `steered: true`.
The intent to steer and the fact of steering are one bit precisely because nobody writes the bit before
the print. Exit 0: the card was written and the set rewritten with the working set; in stage 2 the hook
then prints `STEER_TEXT` (§3.5) — one line, plain text, the second and last deliberate stdout site in the
file — and stamps. Exit 3: the working set was empty — the set is rewritten with `files: []`, no card.
Any other exit (a slot no longer the helper's, a graph over `GRAPH_MAX_BYTES`, a failure), or the
timeout: the hook rolls back **both set and card** through atomic regular-file claims. For the set it
stages a regular claim placeholder and an exact-byte original-restore source, then atomically
renames the set into the claim before inspecting its nonce. A claimed A set is restored only with POSIX `link source
target` no-clobber creation from the staged original; a claimed B/C set is restored only with the
same no-clobber link from its claim. The foreign claim remains after either a failed or successful
restore, because C can replace canonical afterward. The card uses the equivalent claim protocol,
inspecting its claimed first line and deleting only an A-owned partial. Regular placeholders mean a
canonical directory cannot be moved over a claim; exact-target `link` treats a current directory as
occupied rather than creating a child inside it. Claims and any failed-A restore artifacts are direct
dot files eligible for the existing stale `.*compact*.tmp` sweep. A later owner is never overwritten
or unlinked. The existing `state="working"` write is unchanged.

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
compaction of at least 79 s. It is still a wait the hook's header forbids, and §6 declares it.

### 3.2 Helper subcommand `card`

**Input.** `--transcript` is whichever file §3.0 resolved — the parent's or a subagent's. The helper
copies `--scope`, `--agent`, `--transcript`, numeric `--at`, and ownership `--nonce` into the set, and
writes `--nonce` as the **first line of the card file** (the hook strips it before injecting).
**The slot check.** It stages the render before naming either target, then immediately before each target
write re-reads the set and refuses — exit 1, nothing written — unless its nonce is the helper's own
`--nonce`: the hook's overlap verdict (§3.0) is then durable against a helper that lands late. If the
set rewrite succeeded but the subsequent card write fails, the helper rolls back both targets with
the same atomic-claim discipline: it stages an exact-byte original set source beside a regular set
claim placeholder, moves the canonical set into that claim before inspecting ownership, and restores
only through no-clobber hard links. A claimed A set links the staged original back; a claimed B/C set
links the foreign claim back and keeps that claim through C-before/after-restore races. It then claims
the card pathname before inspecting its first line, removes only a claimed same-nonce partial, and
uses no-clobber hard-link creation for a displaced later card. The regular reservations mean a
directory at either canonical pathname cannot be relocated over a claim. The next PreCompact sweeps
retained claims and any failed-A restore artifacts after the in-flight window. A later owner is never
overwritten or unlinked. `graph.json` larger
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

**Files.** Both written to a dot-prefixed temp name carrying the writer's pid
(`$REG/.<name>.<pid>.tmp`, the hook's own `$$` idiom, so two writers never share a temp) and renamed
into place; a temp orphaned by `timeout`'s SIGTERM is swept by the next PreCompact (§3.1 step 3), because
`_reg_purge` never sees a dot-leading name. Names carry **no second dot** on purpose: `_reg_purge` unlinks `$REG/<id>.<suffix>` for every
dot-free suffix except `archived` and `reaping` (which it removes last, in that order) plus the one
explicitly named `<id>.hookstate.json`; these three are purged with the row by the loop, no explicit
line needed. The set the helper writes — key order is part of the contract: `at`, `nonce`, and
`transcript` sit in the first 4 KiB, where the hook reads them with a bounded, fork-free `read -N`:

```json
{"v":1,"at":1789330000000,"nonce":"compact-1789330000000-<pid>-<random>-<random>","scope":"main","agent":null,
 "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
 "parentLive":true,"liveAgents":0,
 "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh",
 "steered":false,
 "files":[{"path":"server/src/pane/statusline.ts","tag":"edited","count":7}, ...],
 "stats":{"tokens":152,"resolved":87,"ambiguous":0,"outside":43,"nomatch":22}}
```

The already-implemented Task 1–8 helper rewrite above does not carry the hook document's ordinary
`overlap:false`; D-2605 therefore defines absent as legacy ordinary/false. It never rewrites an
`overlap:true` document because PreCompact stops before invoking the helper for an ambiguous scope.

Exit codes: 0 card and set written; 3 empty working set (set written with `files: []`, no card); 2 usage;
1 any failure (unreadable input, malformed or oversized graph, a slot no longer the helper's, write
error — nothing written, the hook's own set stands). Reads only the three input files; writes only the
two named outputs, each through `.<name>.<pid>.tmp`.

### 3.3 SessionStart(compact) arm (hook)

Inside the existing `SessionStart` arm, **only when `src == compact`**, after the three standing
subjects are built and before the D-306 `exit 0`. **No scope resolution here** — this arm cannot tell
which context it serves (§3.0), so it serves the card iff the card is the set's own:

0. `~/.ccrc/compact-card-off` absent — **before any card, set or marker is touched**.
1. `f="$REG/$id.compactcard"` exists; younger than `COMPACT_CARD_MAX_AGE` (`find -mmin`, one fork) —
   an older card belongs to no compaction that can still arrive and is **removed**, never served.
2. **The pair.** The canonical set exists, and its `nonce` (a bounded `read -N 4096` of the set's head,
   fork-free) equals the card's first line. The nonce must match
   `^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$` before it can enter a pathname. A set naming another nonce,
   or no set, is a crossed pair — nothing is served and the card stays for overlap/age retirement.
3. Atomically rename the card to its existing pid-scoped private claim, then read its bounded body.
   Exactly one concurrent SessionStart can win. The winning arm exports the validated nonce in
   `CARD_COMPACT_NONCE`; a losing, crossed or body-less arm exports nothing and restores as already
   specified. The canonical compactset is **never rewritten** by SessionStart.
4. **Two clips, one site.** `_hook_emit_context` takes two arguments now: the standing join, which it
   clips at `CARD_MAX_CHARS` exactly as today — that clip is the *only* defence for the ungated
   `GM_NODES` — and the compact subject, appended after it under `COMPACT_CARD_MAX_CHARS`, the result
   clipped at derived `CARD_TOTAL_MAX_CHARS`. Both clips live inside the one emitter.
5. **The fact of serving is a nonce marker, not a raced set cache.** Only after the emitter has printed
   successfully and `CARD_COMPACT_NONCE` is non-empty, create the empty regular marker
   `$REG/.<id>.compactserved.<nonce>` atomically: reserve two decimal random components, noclobber-write
   an empty `$REG/.<id>.compactserved.<pid>.<random>.<random>.tmp`, then no-clobber `link temp marker`, then
   remove only that temp. An existing same-nonce marker is idempotent;
   any other create failure records nothing. Marker names accept only the nonce grammar above, so payload
   bytes never shape a path. PostCompact sets `served:true` only when its **privately claimed** set's nonce
   matches that exact marker, and it removes only that marker after the journal attempt; a successor's
   marker is never touched. Markers older than `COMPACT_CARD_MAX_AGE` are swept by PreCompact only,
   never by broad `rm`.

Where the context lands is **measured** (§0.2): a subagent's SessionStart(compact) context is attached
to the subagent's own transcript, beside its own boundary and summary. Startup, resume and clear
**never** read the file: a card describes the compacted context and nothing else. Hookstate is **not**
written — D-306 holds exactly as today, and its early structural `exit 0` remains before the hookstate
reader/writer. Cost is one `find`, bounded reads, atomic card claim, emit, and one atomic empty-marker
create only after a successful card emit; the arm keeps its own interleaved ratio test.

Nothing new is reachable: with a pathological `GM_NODES` the standing join is clipped at 2,400 exactly
as today (the graph card loses its tail, unchanged behaviour) and the compact card is intact; the
second clip never fires. A mutation row pins that the standing clip cannot be deleted or moved without
a red.

### 3.4 PostCompact arm (hook) and helper subcommand `measure`

The per-session journal is **Plan A's sole authoritative measurement sink**. Task 9 does not add a
`compaction` member to hookstate, a future wire type, or a console cache: keeping a second mutable copy
would race the journal transaction and make two sources disagree. A reader that needs “compaction N”
derives N from the committed physical JSONL position (one-based), never from a persisted `n` field.

**Shared safe lock-open/acquire helper.** PreCompact and both PostCompact critical sections use exactly one
`_hook_compact_lock_acquire` helper; no ccrc publisher or claimer takes an ad hoc lock. It receives only the
literal-derived stable path `$REG/.<id>.compactions.lock`, never a payload-derived pathname. Its supported Bash
4.4+ GNU/BSD mechanism is explicit:

1. If the pathname is absent, create it only with a noclobber redirection in a subshell, then recheck it; a
   collision simply follows the extant-path checks. Hook code never repairs, replaces, truncates, or unlinks it.
2. Require the extant pathname to be a non-symlink regular file (`[[ -f "$lock" && ! -L "$lock" ]]`). Open it
   read/write with Bash's `exec {fd}<>"$lock"`; read/write is load-bearing because opening a raced FIFO read-only
   can wait for a writer. Opening the pathname read/write itself avoids a raced FIFO waiting for a peer, before
   the later descriptor regularity and descriptor/path inode checks. The regular/non-symlink precheck makes this
   nonblocking on the supported Bash platforms.
3. Immediately inspect the descriptor through `/proc/self/fd/$fd` on GNU hosts or `/dev/fd/$fd` on BSD hosts:
   it must name a regular file. Reinspect the current pathname as non-symlink regular, then use Bash's
   `[[ "/proc/self/fd/$fd" -ef "$lock" ]]` or its `/dev/fd` counterpart to prove descriptor and pathname are
   the same inode. If any inspection is unavailable or fails, close the descriptor and refuse; never lock an
   old inode after pathname replacement. Run `flock -w "$COMPACT_JOURNAL_LOCK_WAIT" "$fd"` (exactly two
   seconds), then repeat the descriptor-regular, pathname non-symlink-regular, and descriptor/path-same-inode
   checks **after the successful flock and before every critical mutation**. Retain the descriptor only if both
   checks pass. The deadline covers lock contention, not malformed opens: FIFO, directory, symlink-to-regular,
   symlink-to-FIFO, replacement before `flock`, replacement between precheck and `flock`, and mismatched-inode
   fixtures must all refuse promptly. The caller always closes the retained descriptor after its critical section.

**Threat boundary.** This helper guarantees mutual exclusion among ccrc hook processes because every ccrc
publisher, claimer, and journal writer uses it and never unlinks or replaces the stable lock. It safely refuses
malformed artifacts it observes. A hostile or arbitrary same-UID actor that changes a pathname after the final
check and before a filesystem syscall is outside Plan A's portable Bash threat boundary; the same bounded
statement applies to claim and journal pathname compare-and-swap checks. The implementation must not describe
those bounded checks as protection from an adversary it cannot exclude.

**Guard and settlement order, fixed.** Every guard is silent; stdout and stderr stay empty.

1. `~/.ccrc/compact-card-off` is absent. When it is present PostCompact does not touch the pending
   canonical set, card, marker, claims, journal, lock or temps.
2. `.compact_summary` exists and has JSON type `string`.
3. `find` exists.
4. **Acquire before settlement, age, parse, provenance or helper/tool guards.** Use the shared safe helper
   above for `$REG/.<id>.compactions.lock`. On missing/unsafe/replaced/contended lock, leave the canonical
   pathname untouched and write no journal record. With the shared ownership mutex held, require a readable,
   non-symlink regular canonical set in the same `$REG` filesystem, measure its original age into a saved boolean,
   then generate an exact-grammar `$REG/.<id>.compactpost.<pid>.<random>.<random>.claim` identity using only
   shell-owned values. `<pid>` and both `<random>` components are decimal digits and the whole name must match the
   exact internal grammar before use. Do **not** pre-create, reserve, touch, or otherwise materialize the final
   claim pathname. Instead, use POSIX `link "$set" "$claim"` as the atomic exact-target no-clobber operation.
   Its success is the sole settlement publication: it refuses an existing file, symlink, or directory target and
   never creates a child below a directory. On success, immediately `touch` the private claim while still locked,
   then unlink only the canonical alias before releasing the mutex. The saved original-age boolean, not the touched
   claim mtime, decides whether provenance and `--set` are usable; the touched claim mtime means an active claim
   cannot be stale-swept during the eight-second helper plus two-second journal-lock interval. A collision,
   malformed candidate, link failure, or failed absence-safe target handling retries a fresh candidate or refuses
   with canonical untouched and no record. If the canonical unlink fails after a successful link, keep the claim,
   treat settlement as complete, and release the lock: a later locked publisher may refuse safely, but must never
   delete that claim. A kill after link leaves the claim authoritative while the canonical alias is safely
   replaceable by the next locked PreCompact. If no readable regular canonical set exists, release the lock and
   proceed without a set. This is a same-filesystem `$REG` protocol, not a cross-device move.
5. Only after that settlement, parse only the private claim. Independently validate its nonce first: when safe,
   derive `served` from exact marker `$REG/.<id>.compactserved.<nonce>` and clean only that marker; when unsafe,
   `served:false` and no marker path is formed. This nonce-only parse is permitted when the **saved original age**
   is aged so marker ownership can settle without reading any canonical successor. An originally aged claim runs
   without `--set` and supplies null scope/provenance even though its active claim mtime is young. Only an
   originally young claim is additionally validated against §3.0's exact provenance grammar. Only an originally
   young, valid claim with `overlap` absent or `false` is passed to `measure` and supplies `cwd`, `built`, `agent`,
   `transcript`, `parentLive` and `liveAgents`; every normalization case proceeds without `--set`, preserving
   summary-only metrics. No broad marker glob participates.
6. Require `flock`, a resolved `timeout`/`gtimeout`, `node`, and the helper. Any missing dependency or
   helper failure consumes only the private claim and matching marker, leaves any canonical successor
   untouched, writes no journal line, and exits 0. `find` is earlier because it is needed to establish
   the settlement/age contract; all other dependency guards are after settlement by design.

Feed the summary through the existing pipeline form. The helper prints JSON; the hook accepts it only
with an **exact-one-document gate**:

```bash
jq -r '.compact_summary' <<<"$payload" \
  | _hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" measure [--set "$claim"] --trigger "$trig" \
  | jq -ce -s 'if length == 1 and (.[0] | <COMPACT_SHAPE_PRED>) then .[0] else empty end'
```

`jq -ce -s` is load-bearing: zero, plural, concatenated or wrong-shaped helper output is rejected even
when the helper exits 0. The accepted measurement contains no `n`. Merge into its journal record the
claim provenance **`cwd`, `built`, `agent`, `transcript`, `parentLive`, `liveAgents`**, and the marker-derived
`served` value (overriding the helper's legacy set copy). With no usable set those six provenance fields
are null, `cited`/`setSize` are null, and scope is null except that an explicit `overlap:true` claim
retains the honest `ambiguous` tag; `served` follows only the separately safe exact nonce marker.
`chars`, `filesChars`, `fences`, `trigger`, `at` and `steered` retain the helper's normal meanings. A valid `files: []` still yields `cited:0` and
`setSize:0`; malformed entries never shrink the denominator.

**Journal transaction — no `>>` fiction.** The stable lock inode is exactly
`$REG/.<id>.compactions.lock`. It is dot-prefixed, per-session, and **never unlinked** by PostCompact,
marker cleanup, stale-temp cleanup, PreCompact or purge-adjacent code; all writers therefore contend on the
same inode rather than locking replaced inodes. After the helper completes and the final compact object is
accepted, **reacquire it with the same shared safe helper**. If `flock` is absent, safe opening fails, the
pathname was replaced, or the mutex cannot be acquired inside two seconds, record nothing. No fallback
append, and the helper's eight-second deadline is never held inside this critical section.

Define one exact `JOURNAL_RECORD_PRED` and use it for both the accepted merged helper/claim object and every
physical journal line. It requires exactly these keys, in no other combination: `agent`, `at`, `built`, `chars`,
`cited`, `cwd`, `fences`, `filesChars`, `liveAgents`, `parentLive`, `scope`, `served`, `setSize`, `steered`,
`transcript`, and `trigger` (there is specifically no persisted `n`). `at`, `chars`, and `fences` are
nonnegative integers; `filesChars` is null or a nonnegative integer no greater than `chars`; `cited` and
`setSize` are both null or nonnegative integers satisfying `cited <= setSize`; `trigger` is `auto` or `manual`;
`scope` is `main`, `subagent`, `ambiguous`, or null; and `steered` and `served` are booleans. The six provenance
keys are exact types: `cwd` is null or a nonempty string; `built` is null or 7--40 lowercase hex and requires a
non-null `cwd`; `agent` is null or a 1--128-character `[A-Za-z0-9_-]` id; `transcript` is null or a nonempty
string; `parentLive` is null or boolean; and `liveAgents` is null or a nonnegative integer. When provenance is
usable it also obeys the §3.0 trigger/scope cross-field matrix; normalized no-set and overlap forms use the
already specified null provenance distinctions. In jq terms, the predicate must make these integer and relation
requirements explicit with `floor == .`, not merely `type == "number"`.

While holding the safe descriptor lock, remove only stale stage temps older than `COMPACT_CARD_MAX_AGE` whose
full basenames match the exact owner grammar `.<id>.compactions.<digits>.<digits>.<digits>.tmp`; parse the
literal id prefix before matching the suffix, so another legal id sharing a prefix or dot is never selected.
Never remove the stable lock.

Create this writer's stage as `$REG/.<id>.compactions.<pid>.<random>.<random>.tmp` with noclobber, verify the
stage pathname remains this writer's non-symlink regular temp, and reuse the two random decimal components from
this writer's independent claim identity (also when no canonical set was present). If the live journal exists,
open it read-only on a descriptor only after requiring a readable non-symlink regular pathname, then verify the
descriptor is regular and descriptor/path inode identity; copy/read/validate exact old bytes from that still-open
FD, not by reopening the pathname. If absent, record that absence as the expected final state. Never overwrite a
directory fixture. Before final replacement, revalidate that an initially present journal pathname is still
non-symlink regular and names the same open FD; an initially absent journal must still be absent. Any mismatch
refuses, preserving both byte sequences.

The raw validator is truth-valued: `jq -Rse` receives **one raw string**, not an array, so bind it as `$raw`,
require `$raw == ""` or a terminal LF, remove exactly that final empty split element, reject every remaining blank
physical line, and require `all($lines[]; ((fromjson? // false) | JOURNAL_RECORD_PRED))`. The `// false`
turns a `fromjson?` parse failure (which otherwise yields no value) into a predicate failure rather than a
vacuous `all` success. Invoke `jq -e` so successful validation emits `true`, never `empty`. Its shape is:

```jq
def NONNEG_INT: type == "number" and . >= 0 and floor == .;
def NONEMPTY_STRING: type == "string" and length > 0;
def SAFE_AGENT: type == "string" and length >= 1 and length <= 128
  and test("^[A-Za-z0-9_-]+$");
def BUILT: type == "string" and test("^[0-9a-f]{7,40}$");
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
       else ($raw | rtrimstr("\n") | split("\n")) as $lines
       | ($lines | length > 0)
         and all($lines[]; (length > 0) and ((fromjson? // false) | JOURNAL_RECORD_PRED))
       end)
```

A first valid line must succeed. Newline-terminated blank, garbage, scalar, array, concatenated-object,
wrong-shape, unknown-key, `n`-bearing, negative, fractional, and impossible-relation lines must all refuse.
Copy the FD-validated old bytes byte-for-byte to the private stage; append exactly one compact JSON object already
validated by `JOURNAL_RECORD_PRED` plus exactly one LF. Verify the exact old-byte prefix, then rerun that raw
truth-valued validation over the **entire** stage and require exactly one additional valid line whose compact JSON
bytes equal the accepted object. Immediately after the journal identity/absence and stage-target rechecks,
atomically `mv -f` the stage over `$REG/<id>.compactions` while still holding the descriptor lock, then close it.
A stage write, validation, identity, or rename failure removes only this writer's temp and preserves the old
journal byte-for-byte. `printf >>` to the live file is forbidden: shell append is not a record-atomic
multi-process commit.

After the attempt, remove only the privately claimed set and, when that settled claim's separately
parsed nonce was safe, only `$REG/.<id>.compactserved.<nonce>` — on success or failure, including the
aged-claim path. **Exception:** if the canonical-alias unlink failed immediately after successful link, retain
that authoritative claim for stale sweep rather than cleanup. Never remove a canonical pathname after helper
execution. Thus a canonical successor and its marker survive every predecessor path byte-for-byte.
Nothing is printed; the existing done/working hookstate transition is unchanged and carries no
compaction measurement.

**Normalisation and measurement fields.** The helper first mirrors Claude Code: drop the first
`<analysis>…</analysis>` block; replace `<summary>X</summary>` with `Summary:` plus `X.trim()`; collapse
blank runs; trim. It measures `chars`, fence-aware `filesChars`, `fences`, set-relative `cited`,
`setSize`, `steered`, `trigger`, `scope` and `at` exactly as already implemented. `served` in the final
journal record is the marker-derived fact above; Task 9 stops treating the earlier set field as a served
cache, and future writers do not persist it in `.compactset`.

### 3.5 Stage 2: the steering text (hook constant, pinned verbatim)

> ccrc: after compaction a structural card from this repository's knowledge graph will be re-injected,
> naming the files this context touched, their symbols as path:symbol:line, and the files that depend on
> them. In "Files and Code Sections" cite path:symbol:line with one sentence on why it matters; do not
> paste code snippets, the session re-reads them on demand and can run `graphify explain "<symbol>"`.
> Keep verbatim: decisions and their reasons, errors and their fixes, the user's messages, pending
> tasks, and the exact current step.

Printed as **one line** of plain text on PreCompact (the blockquote above wraps it for reading; the
constant has no newline), only after the helper's exit 0, only without the steer switch — and only then
is `steered: true` stamped into the set (§3.1), so the bit records the print, never the intent. It is consistent with the operator's own `## Compact Instructions` ("drop verbose tool output
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
| served session (`transcript_path` empty) | no PreCompact set/card; PostCompact still measures summary-only fields and commits a no-set record if every dependency and journal stage succeeds |
| transcript unreadable | nothing written by PreCompact, nothing printed |
| no tool calls in the window | helper exit 3: set has `files: []`, no card |
| no graph, stale graph or graph over `GRAPH_MAX_BYTES` | no card; set retains `files:null`; journal provenance still includes measured `cwd`/`built` where available |
| `find` missing | PreCompact says nothing; PostCompact does not claim or alter the pending set and records nothing |
| canonical set has an unsafe/missing nonce or unsafe provenance | settlement still happens before inspection; consume the private claim as normalized no-set, commit summary-only metrics if dependencies permit, and never form a marker name |
| PostCompact wins the atomic claim; a successor then writes canonical set/card/marker | predecessor uses and removes only its private claim and exact marker; successor survives byte-for-byte |
| PostCompact loses/no canonical set | measure without a set; never unlink a pathname another arm may have installed |
| canonical set was originally aged at settlement | save that age before the hard link; touch the new private claim active, parse only its nonce from it, consume it as no-set provenance, and remove only the exact safe-nonce marker; an immediate later PreCompact preserves the young active claim, while a killed claim ages out after 1200 s |
| claimed set is malformed, has unsafe provenance, or is overlap-marked | keep summary-only measurement; malformed/unsafe provenance gives null scope, overlap gives `scope:"ambiguous"`, and all six provenance fields are null; a separately safe claimed nonce still controls only its exact served marker |
| helper, `node`, deadline, `flock` or lock-open missing/fails | if failure is before settlement, canonical remains untouched; after settlement consume only private claim and its safe-nonce marker; no journal line; canonical successor and old journal unchanged |
| lock path is FIFO, directory, symlink (including to FIFO), replaced before or between validation and `flock`, or descriptor/path inode differs | shared read/write safe-open refuses promptly before critical mutation; canonical remains untouched before settlement and no journal line is written |
| lock wait exceeds `COMPACT_JOURNAL_LOCK_WAIT` (2 s) | miss this ownership/journal attempt silently; no unlocked fallback; canonical is untouched if settlement has not occurred |
| claim target candidate collides, is malformed, symlinked, or directory-shaped | `link "$set" "$claim"` atomically refuses it; retry a fresh exact candidate or refuse, never pre-create a final claim, create a directory child, or touch canonical on a failed link |
| hard link succeeds but canonical alias unlink fails | claim is authoritative and retained; settlement is complete, no claim is deleted, and a later locked publisher may refuse safely |
| journal pathname changes after FD validation or before final replacement; initially absent journal appears | final identity/absence compare-and-swap refuses; preserve both preexisting and staged bytes, never overwrite a directory |
| helper prints zero, plural, concatenated, garbage or wrong-shape JSON with exit 0 | `jq -ce -s` exact-one gate refuses; no journal line |
| journal is a symlink, directory, unreadable, non-newline-terminated, blank-lined, garbage, scalar, array, concatenated, wrong-shaped, unknown-key, or `n`-bearing JSONL file | raw-line validation refuses commit; preserve old pathname/bytes |
| stage write/validation/rename fails | remove only this writer's dot-temp; old journal byte-for-byte unchanged |
| concurrent valid PostCompact writers | stable never-unlinked lock serializes full read+stage+rename transactions; journal contains each complete JSON object once, never interleaved or lost |
| compaction blocked/failed after PreCompact | canonical card/set remain; a later PreCompact within the window degrades itself for overlap; after the window stale cleanup retires them |
| second PreCompact before predecessor settlement | existing symmetric degradation may replace canonical predecessor; both lose the card |
| second PreCompact after predecessor atomic claim | sees young claim, degrades only its own set/card and cannot rewrite the predecessor claim |
| SessionStart emit succeeds | exports served nonce and atomically creates exactly `$REG/.<id>.compactserved.<nonce>`; it never rewrites canonical set |
| SessionStart emit fails or pair is crossed | no marker; `served:false` for the eventual matching claim |
| marker and successor race | PostCompact removes only marker named by its claimed nonce; a successor marker survives |
| `compact-card-off` flips on before PostCompact | all pending canonical files remain byte-for-byte; no claim, marker removal, lock or journal write |
| stale private claims/markers/stage temps | PreCompact sweeps only this id's matching dot-files older than 1200 s; young claims remain overlap evidence; `.compactions.lock` is never swept/unlinked |
| stage 2 forfeits precomputed compaction | measured never used here; `steered` recorded; steer switch exists |
| card text reaches the model | repo-controlled labels and paths only, bounded twice, passed through `jq --arg`, never interpolated into shell |
| summary not in the nine-section format | `filesChars:null`, everything else measurable |
| model ignores steering | `filesChars`, `fences` and `cited` expose that in the journal |

## 5. Mutation targets (red first, one mutation each)

The helper's existing Task 1–8 mutation rows remain binding: transcript window/boundary, mining and
resolution, graph cap, nonce ownership and rollback, rendering/truncation, summary normalization,
fence-aware `filesChars`, aligned citations, malformed `files[]`, two-clip SessionStart output and
atomic card consume-once. Task 9 adds the hook-level table below; each dependency is broken one at a
time against fixture HOME/PATH.

| Task 9 mutation | expected red |
| --- | --- |
| PostCompact emits stdout or first-journal failure leaks stderr | first journal run under a deliberately failed stage has `{stdout:'',stderr:''}` |
| compact-summary type guard removed | absent/non-string summary claims no set and writes no journal |
| `find` guard removed | PATH without `find` changes pending-set bytes; shipped arm leaves it untouched |
| set claimed after age/parse/helper work | concurrent successor test loses or reads successor; shipped claim is first after the three guards |
| private claim removed in favor of reading canonical | successor installed after settlement is changed or consumed |
| private claim cleanup removed | success, helper failure and journal failure leave a full-basename `.<id>.compactpost.<digits>.<digits>.<digits>.claim` |
| canonical `rm` retained after helper | successor set survival test loses exact bytes |
| young-claim overlap ignored | PreCompact writes an exact scope/card while a young private claim exists instead of degrading only itself |
| settled predecessor rewritten by later PreCompact | predecessor claim bytes change after the later PreCompact |
| overlap marker omitted/trusted as provenance | an overlap-marked claim reaches `measure`, loses its `ambiguous` tag, or invents agent/transcript/cwd/built instead of normalized provenance |
| ordinary provenance type/cross-field grammar relaxed | one valid-row fixture or one rejected tuple flips classification; every §3.0 matrix row and each field domain has a diagnostic case |
| aged claim treated as measurement provenance or nonce read from canonical | aged fixture permits only nonce parsing from the settled claim, proves no `--set`/provenance use, and requires cleanup of only that nonce's exact marker |
| SessionStart marker set rewrite restored | SessionStart changes canonical set bytes; marker-only test requires byte identity |
| marker created before successful emit | targeted jq-envelope failure leaves a served marker |
| marker creation non-atomic/unsafe nonce admitted | concurrent compact starts produce malformed/foreign marker names |
| broad marker deletion | predecessor PostCompact deletes a successor's different-nonce marker |
| exact marker lookup removed | journal says `served:true` without the claim-nonce marker, or false with it |
| marker/claim stale sweep or exact owner match removed | stale matching artifacts survive or another legal id with a shared prefix/dot loses bytes; mutate each family matcher independently while claim, marker, marker-temp, stage, and lock fixtures prove only this id is selected |
| generated claim/marker-temp/stage grammar, saved-age decision, `link`, touch, or canonical-alias unlink changed | planted collision/file/symlink/directory candidates plus full-basename assertions reject a missing/changed PID or either decimal random component; `link` must fail without a claim/canonical change, link-to-copy mutation must redden, an originally aged set paused after release remains a young active no-set claim through concurrent PreCompact then ages out after 1200 s if killed, and a failed canonical unlink preserves its claim |
| helper stdout gate uses scalar `jq -c` | helper printing two valid objects is accepted; `jq -ce -s length==1` must reject it |
| `n` added to helper, journal or future type | source and record assertions forbid an `n` key; ordinal is line index + 1 |
| any of helper file, `node`, deadline or `flock` dependencies bypassed | one PATH mutation per dependency must produce no line, clean streams, cleaned claim/marker and unchanged old journal/successor |
| safe lock open, descriptor regularity, pathname regularity, pre- or post-`flock` inode identity, or 2-second `flock` wait removed | FIFO, directory, symlink-to-regular, symlink-to-FIFO, pre-`flock` and pre-critical-mutation path-replacement, and mismatched-inode fixtures fail promptly; a held safe lock returns within the measured 2 s wait plus harness allowance and leaves canonical/no journal according to phase |
| stable lock unlinked, repaired, or replaced | source pin plus two-writer test detects replacement-inode serialization failure; every stale sweep leaves it byte-identical |
| live `printf >>` used | source pin and concurrency stress reject append to the authoritative file |
| journal transaction serialized only around rename | N concurrent PostCompact processes lose records; shipped journal has N complete parseable lines |
| stage omits old bytes or rewrites them | preplanted byte fixture differs before the appended newline |
| raw validator treats `jq -Rs` as an array, emits `empty`, or accepts only a terminal-LF check | a first valid record must succeed with `jq -e` emitting true; newline-terminated blank, garbage, scalar, array, concatenated-object, wrong-shape, unknown-key, `n`, negative, fractional, and impossible `filesChars`/`chars` or `cited`/`setSize` relation lines must each refuse |
| stage/rename failure mutates live journal | injected write failure and injected rename failure each preserve exact old bytes |
| old journal symlink/non-regular/unreadable guard or FD/path identity recheck removed | dedicated symlink, directory, unreadable, and replacement-before-final-CAS cases each refuse replacement with no stderr and preserve both byte sequences |
| operator guard moved after settlement | `compact-card-off` no longer preserves pending set/card/marker bytes |
| provenance omission | committed line lacks any of `cwd,built,agent,transcript,parentLive,liveAgents` |

**SessionStart and existing scope mutations made explicit by D-2605:** successful emit exports the served
nonce; marker creation follows the emit; compact keeps D-306's early structural exit; no compact arm
rewrites canonical `.compactset`; a crossed pair restores its claimed card and creates no marker. The
Task 11 inventory pin names only dot-free `compactcard`, `compactset`, `compactions`: private dot-files
are lifecycle artifacts, not registry fields.

## 6. Rings, invariants, and the waiting amendment

- **Rings.** `compact-card.mjs` is a deploy-side node script (the `shared/mark.mjs` class: `node:*`
  only, never bundled). Plan A adds no L0/wire type and no hookstate reader; the future `CompactionMeas`
  shape in §3.6 belongs to Plan B. The journal record keeps null-vs-0 on
  `cited`/`setSize`/`filesChars`, and malformed provenance never becomes a smaller invented set.
- **The hook's standing contract** remains exit 0, silent failures, atomic writes and no network.
  Amendment R2 now names two bounded off-hot-path waits and one lock exception: PreCompact and
  PostCompact may wait at most `COMPACT_HELPER_TIMEOUT` (8 s) for the helper, and both arms may wait at
  most `COMPACT_JOURNAL_LOCK_WAIT` (2 s) for the same stable per-session ownership-and-journal mutex.
  The hookstate write still lands before either arm; no lock is taken on the tool-call hot path. The header
  must say **"no locks except the never-unlinked compaction flock; no waiting except the 8 s helper and
  2 s compaction-lock deadlines"** rather than the old single-exception sentence. Safe-open malformed-path
  refusal is prompt and is not a lock-contention wait. Missing dependencies and deadline expiry are silent
  missed measurements, never unbounded fallbacks.
- **Registry versus lifecycle names.** `compactcard`, `compactset` and `compactions` are the only new
  dot-free registry suffixes; `_reg_purge` and slug-residue scans own those. Private claims,
  nonce-keyed served markers, journal stage temps and `.compactions.lock` are dot-prefixed lifecycle
  files. PreCompact age-sweeps stale claims/markers/temps for its id, but the stable lock inode is
  permanent for that session id and never unlinked: replacing the journal must not replace its lock.
  Destructive verbs stop the session before purge, so no hook writes after the row is purged.
- **Plan A stdout.** It remains silent on PreCompact and PostCompact. SessionStart retains D-306's early
  structural exit after its one envelope. The read-side R1/header amendment that adds PreCompact
  steering stdout is Plan C only; Task 9 must not weaken the stage-1 silence test.
- **Rulings honoured.** Only ccrc-owned artifacts change. No `CLAUDE.md`. The graph is read, never built
  — App. B's rejection of session-side extraction stands. Plan A's effect is measured at PostCompact in
  the journal; console visibility waits for a journal-based Plan B adapter.

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
- The failed-compaction window in §4.
- The `ambiguous` rate and the false-exactness rate of §3.0, both counted on the first live corpus. A
  Workflow fan-out is `ambiguous` by construction; the only discriminator that would card those is an
  agent id on the three payloads, which only Claude Code can add — the journal says whether asking is
  worth it.
- The PreCompact helper retains its internal slot re-read-to-rename interval described in §3.2, but it
  now executes while the shared ownership mutex excludes PostCompact settlement and every other ccrc
  canonical publisher/claimer. Only a future per-transcript slot can remove the one-slot ambiguity before
  the canonical pair exists. The journal's `parentLive`/`liveAgents` fields keep the residual measurable.
- The `ambiguous` rate decides whether the fan-out case is worth asking Claude Code for an agent id.
  Task 6 already measured helper cost on the fleet's real admissible graphs; the 2 s journal lock wait
  is a deliberate missed-sample bound whose contention rate is measured from the first live corpus.
- 2 of 24 live processes already run 2.1.267, which no binary fact here was read from; the first live run
  of Plan A on such a session is the check, and the payload measurement of §0.2 (the three key sets, one
  subagent compaction, and the subagent transcript's location) is repeated on it.
- If Anthropic enables precomputed compaction reuse on this fleet, stage 2 forfeits it; `steered` and the
  journal make that visible before it costs anything.
