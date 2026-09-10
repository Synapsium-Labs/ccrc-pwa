# Graphify-aware compaction: the structural card, the steering, the measurement — design

**Date:** 2026-09-09
**Status:** design approved in five sections by the operator (2026-09-09); **amended 2026-09-10** after the
payload measurement of §0.2 came back negative — the subagent guard became the scope rule of §3.0, on the
operator's direction that compaction works for a subagent exactly as for the main thread. The first draft of
§3.0 (newest file wins) was refuted by an adversarial review the same day and replaced by the liveness rule,
which answers `ambiguous` where it cannot answer. A second review of that rule and of Plan A (2026-09-10, four
agents) closed the remaining holes named in §3.0–§3.4 and Plan A's ledger (D-2411–D-2420); no implementation yet
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
 context is compacting — main, subagent or ambiguous — by the liveness rule of §3.0; the two later
 arms read that decision from the set and never resolve)
PreCompact ──► scope + overlap check ──► $REG/<id>.compactset   (JSON: at, scope, agent, transcript; files null)
   │          └► helper `card` (never for ambiguous) ──► $REG/<id>.compactcard  (line 1: the set's `at`; then the text)
   │                                                   └─► $REG/<id>.compactset  (rewritten: files, tags, counts, steered)
   └─ stage 2: prints STEER_TEXT iff the helper exited 0 and the steer switch is absent
summariser  (Claude Code; reads Additional Instructions)
SessionStart(compact) ──► iff the card's line 1 is the set's `at`: appends the card as the 4th subject
                          of the ONE envelope and deletes it; an aged card is removed instead
PostCompact ──► helper `measure` (compact_summary on stdin; the set iff inside the window) ──► hookstate.compaction
                                                                                            └─► $REG/<id>.compactions (journal)
server hookstate reader ──► FleetSession.compaction ──► PWA chip `compact 17k · cites 7/12`
                                                        (`sub·compact …` for a subagent's)
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
| `COMPACT_CARD_MAX_AGE` | 1200 s | hook | the in-flight window: a card or a set older than this belongs to no compaction that can still arrive and is removed unread; an unconsumed set *younger* than this at PreCompact means overlap (§3.0). Argued from the longest measured compaction, 826 s on the gpt lane, ×1.45 |
| `COMPACT_LIVE_S` | 120 s | hook | a transcript written inside this window is a live context (§3.0); measured cadence 4–6 s per row, gaps over 79 s in 1–2% of rows |
| `COMPACT_HELPER_TIMEOUT` | 8 s | hook | `timeout` around both helper calls, argued in §3.1 from measured inputs and **re-measured on the fleet's real graphs before it ships** (Plan A, Task 6); the R2 amendment of §6 |
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
that transcript's own previous summary; the set, the journal and hookstate carry `scope`, `agent` and
`transcript`; an `ambiguous` scope writes a set with `transcript: null`, no card, and PostCompact still
measures `chars`, `filesChars` and `fences` with `cited`/`setSize` null. **The scope is a tag the console
renders, not a gate; `ambiguous` is the one value that also withholds the card**, because a card built
from a sibling's transcript is wrong context, and wrong context is worse than none. Said plainly: a
subagent's card is reachable only for a **solo** live subagent; a fan-out's compactions are `ambiguous`
by construction, and the journal's count is what says whether that case is worth a discriminator Claude
Code does not carry today. The rule records its own inputs beside its verdict — `parentLive`
(true/false, null on a manual trigger) and `liveAgents` (the count) — in the set and the journal, so
every verdict can be audited offline against the transcripts.

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

**One slot, two contexts — overlap.** The card and the set are one file each per session id, and every
context of the session writes them. When PreCompact finds an **unconsumed set younger than
`COMPACT_CARD_MAX_AGE`**, another compaction of this session is in flight (or failed inside the window),
and no later arm can tell which context it serves. So BOTH degrade: this PreCompact writes its set as
`ambiguous` and removes the card; the earlier compaction's SessionStart(compact) finds no card and its
PostCompact reads an `ambiguous` set. A failed compaction followed within the window by another costs
that one its card (consecutive boundaries under an hour are 1% of intervals on this box; failures are
rarer). **The verdict is durable, not advisory**: the helper re-reads the set on disk immediately before
each of its two writes and refuses (exit 1, nothing written) unless the set still carries its own `--at`
— so an overlapping PreCompact that has already taken the slot cannot be overwritten by the earlier
compaction's helper landing late. The card and the set are additionally **paired by a nonce** — the set's
`at`, written as the card's first line — so the crossed-pair half of the race is unservable. What
remains is the interval between the helper's re-read and its rename, milliseconds against a 79 s
window, stated in §10.

### 3.1 PreCompact arm (hook)

Runs from the very end of the hook, **after** the hookstate rename: the `working` stamp lands first and
never waits on any of this. Guard chain, in order, every failure silent and total for what follows:

1. `~/.ccrc/compact-card-off` absent.
2. `.transcript_path` non-empty and a readable regular file.
3. `_hook_compact_scope "$tp" "$trigger"` (§3.0) answers. It needs `find`, which is new to this file and
   guarded inside the resolver with the `command -v jq` idiom — a box without it says **nothing**
   (no set), never a silent `main`. Then the **overlap check** of §3.0 (an unconsumed set younger than
   `COMPACT_CARD_MAX_AGE` → `ambiguous`, card removed), and a sweep of this id's stale compaction temps
   (`$REG/.<id>.*compact*.tmp` older than the window — a helper killed by `timeout` between its write and
   its rename leaves one, and a dot-leading name is invisible to `_reg_purge`).
4. `_hook_graph_measure` runs — for its `GM_CWD`, `GM_BUILT` and `GM_FRESH`, which the set records
   whatever comes next — and **the set is written here, always**, by the hook (`jq -cn --arg …`,
   temp-then-rename, the temp `$REG/.<id>.$$.compactset.tmp`):

   ```json
   {"v":1,"at":1789330000000,"scope":"main","agent":null,
    "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
    "parentLive":true,"liveAgents":0,
    "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh","steered":false,"served":false,
    "files":null,"stats":null}
   ```

   `at` is the nonce every later step pairs on. `files: null` means **not mined**; the helper's
   `files: []` means **mined, empty** — two conditions, two values. `cwd`, `built` and `fresh` are
   `null` when the measurement had nothing to say; `parentLive`/`liveAgents` are null on a manual
   trigger. An `ambiguous` scope has `transcript: null`, `agent: null`, and the arm **stops here**.
5. The graph gate: `_hook_graph_measure` returned 0 **and** `_hook_gate_tree` holds — a graph no more
   than `GRAPH_GATE_MAX_BEHIND` commits behind HEAD, the same predicate as the search gate, so the card
   and the gate agree about which trees count.
6. `$HOME/.cc-sessions/compact-card.mjs` present. `node` and `timeout` are **not** guarded: a missing
   one fails the call exactly as a failing helper does (exit 127, swallowed by the call site), and a
   guard whose removal changes nothing observable is not a guard — on a userland with no `timeout` the
   helper never runs, the set is consumed by PostCompact, and the journal stays empty (§4).

Then, with `--transcript` the resolved file of step 3 — never the payload's — and `--at` the nonce:

```
timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" card \
  --transcript "$transcript" --cwd "$GM_CWD" --graph "$GM_CWD/graphify-out/graph.json" \
  --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
  --out "$REG/$id.compactcard" --set "$REG/$id.compactset" \
  --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
  --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$scope" --at "$at" [--agent "$agent"] [--steer]
```

`--steer` is passed when stage 2 is built and `~/.ccrc/compact-steer-off` is absent, and it changes
nothing the helper writes: **`steered` is stamped by the hook, after the fact** — in stage 2, only after
exit 0 and only after `STEER_TEXT` has been printed, one `jq` rewrite of the set sets `steered: true`.
The intent to steer and the fact of steering are one bit precisely because nobody writes the bit before
the print. Exit 0: the card was written and the set rewritten with the working set; in stage 2 the hook
then prints `STEER_TEXT` (§3.5) — one line, plain text, the second and last deliberate stdout site in the
file — and stamps. Exit 3: the working set was empty — the set is rewritten with `files: []`, no card.
Any other exit (a slot no longer the helper's, a graph over `GRAPH_MAX_BYTES`, a failure), or the
timeout: nothing more; the hook's own set stands. The existing `state="working"` write is unchanged.

**Cost, and the contract it amends (§6, R2).** The helper is bounded by `COMPACT_HELPER_TIMEOUT` = 8 s.
The inputs: node startup ~0.05 s; `graph.json` parsed once and indexed — 0.13–0.18 s at 9 MB, 1.15 s at
70 MB (MekWarLive), with peak RSS about five times the file, which is why `GRAPH_MAX_BYTES` refuses
larger ones; a window of at most `WINDOW_CAP` = 16 MiB, every line parsed (a 64 MiB window measured
0.3 s to read and 0.4 s to mine, before the cap); resolution through a **basename index**, O(tokens),
never a scan of the file set per token (the review measured the naive scan at 2–12 s on a 64 MiB window
against a 5,000-file graph). 8 s is roughly twice the sum on the worst tree on this fleet, on an idle box;
**Plan A's Task 6 re-measures p95 and RSS on the fleet box's real graphs before the constant ships, and
stops to report if p95 exceeds half the bound.** The scope `find`s, the overlap `find`, the temp sweep,
the two payload `jq`s and the set write sit outside the timeout and are bounded by construction. None of
it is on the hot path: PreCompact brackets a compaction of at least 79 s. It is still a wait the hook's
header forbids, and §6 declares it.

### 3.2 Helper subcommand `card`

**Input.** `--transcript` is whichever file §3.0 resolved — the parent's or a subagent's. The helper
neither knows nor cares which, beyond copying `--scope`, `--agent`, `--transcript` and `--at` into the
set and writing `--at` as the **first line of the card file** (the nonce §3.3 pairs on; the hook strips
it before injecting). **The slot check.** Immediately before each of its two writes the helper re-reads
the set on disk and refuses — exit 1, nothing written — unless its `at` is the helper's own `--at`: the
hook's overlap verdict (§3.0) is then durable against a helper that lands late. `graph.json` larger than
`GRAPH_MAX_BYTES` is refused the same way, before it is parsed. A subagent transcript has the same line shapes as the parent's, measured: an
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
line needed. The set the helper writes — key order is part of the contract: `at` and `transcript`
sit in the first 4 KiB, where the hook reads them with a bounded, fork-free `read -N`:

```json
{"v":1,"at":1789330000000,"scope":"main","agent":null,
 "transcript":"/home/u/.claude/projects/-home-u-tree/<session>.jsonl",
 "parentLive":true,"liveAgents":0,
 "cwd":"/home/u/tree","built":"40706e0c","fresh":"fresh",
 "steered":false,"served":false,
 "files":[{"path":"server/src/pane/statusline.ts","tag":"edited","count":7}, ...],
 "stats":{"tokens":152,"resolved":87,"ambiguous":0,"outside":43,"nomatch":22}}
```

Exit codes: 0 card and set written; 3 empty working set (set written with `files: []`, no card); 2 usage;
1 any failure (unreadable input, malformed or oversized graph, a slot no longer the helper's, write
error — nothing written, the hook's own set stands). Reads only the three input files; writes only the
two named outputs, each through `.<name>.<pid>.tmp`.

### 3.3 SessionStart(compact) arm (hook)

Inside the existing `SessionStart` arm, **only when `src == compact`**, after the three standing
subjects are built and before the D-306 `exit 0`. **No scope resolution here** — this arm cannot tell
which context it serves (§3.0), so it serves the card iff the card is the set's own:

0. `~/.ccrc/compact-card-off` absent — **before the file is touched**.
1. `f="$REG/$id.compactcard"` exists; younger than `COMPACT_CARD_MAX_AGE` (`find -mmin`, one fork) —
   an older card belongs to no compaction that can still arrive and is **removed**, never served.
2. **The pair.** The set exists, and its `at` (a bounded `read -N 4096` of the set's head, fork-free)
   equals the card's first line. A set naming another nonce, or no set, is a crossed pair — a card that
   is not this compaction's — and nothing is served; the card stays for §3.0's overlap check or step 1
   to retire.
3. Read the rest of the card (bounded `read -N`, clipped at `COMPACT_CARD_MAX_CHARS` — defence in depth
   behind the helper's bound), `rm -f` it. Consume-once: a card is never served to two contexts.
4. **Two clips, one site.** `_hook_emit_context` takes two arguments now: the standing join, which it
   clips at `CARD_MAX_CHARS` exactly as today — that clip is the *only* defence for the ungated
   `GM_NODES` (`_hook_graph_measure`, D-1899: 3,000 digits in the report head measured a 3,437-char graph
   card), and it stays the first clip — and the compact subject, appended after it with the same
   one-space join under `COMPACT_CARD_MAX_CHARS`, the result clipped at `CARD_TOTAL_MAX_CHARS`, *derived*
   as the two ceilings plus the join — a pin on the sum, not a third budget — and pinned under
   `HARNESS_CONTEXT_SPILL_CHARS`. Both clips live inside the one emitter, which is the rule its own
   comment states ("a per-subject clip is one each new subject can forget; this one cannot be").
5. **The fact of serving is recorded.** Only after the emitter has printed — it returns non-zero when
   its `jq` could not build the envelope — the arm stamps `served: true` into the set (one `jq` rewrite,
   temp-then-rename). `measure` copies it, so `cited` is interpretable only where `served` is true: a
   card that was mined but never reached the model (a crossed pair, an aged card, a timed-out helper, a
   failed emit) reads as `served: false`, not as a citation miss.

Where the context lands is **measured** (§0.2): a subagent's SessionStart(compact) context is attached
to the subagent's own transcript, beside its own boundary and summary. Startup, resume and clear
**never** read the file: a card describes the compacted context and nothing else. Hookstate is **not**
written — D-306 holds exactly as today, and its test extends to a run with a card present. Cost is one
`find`, two bounded reads, one `rm`, the emit and — with a card — one `jq` for the stamp; the arm gets
its **own** interleaved ratio test against
the cheap arm, with its own array and a ceiling argued from a measured shipped-vs-mutated band the way
D-1898 argued the startup arm's (folding one compact run into the startup array would put it at the max,
where a p95 read cannot see it).

Nothing new is reachable: with a pathological `GM_NODES` the standing join is clipped at 2,400 exactly
as today (the graph card loses its tail, unchanged behaviour) and the compact card is intact; the
second clip never fires. A mutation row pins that the standing clip cannot be deleted or moved without
a red.

### 3.4 PostCompact arm (hook) and helper subcommand `measure`

Guard, in order: `~/.ccrc/compact-card-off` absent; `.compact_summary` present and a string; `find`
present; **then the set is settled before any tool guard** — a set older than `COMPACT_CARD_MAX_AGE` was
left by a compaction that never finished and is removed, never read; a younger one is this compaction's,
its `cwd`/`built`/`agent`/`transcript` are read for the journal line, and **it is consumed on every path
from here** (the helper missing, `node` or `timeout` missing, the helper failing, the shape gate refusing):
a set that outlived its compaction would mark the next one `ambiguous` for no reason. **No scope
resolution here either** — the scope is the set's. The set is **expected** (PreCompact writes it whenever
a transcript resolved, §3.1 step 4) but **optional**: a served session, or a PreCompact that could not
read its transcript, is still measured, with `scope`, `cited` and `setSize` **null** — not 0, and not
`"main"` — because "no set" and "cited nothing" are different conditions, and an unknown scope is not the
main thread. A set with `files: null` (no graph, no node, helper failure, or `ambiguous`) yields `cited`
and `setSize` null with `scope` known; a set that will not parse is measured as no set, never a lost
measurement.

```
jq -r '.compact_summary' <<<"$payload" \
  | timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" measure [--set "$REG/$id.compactset"] --trigger "$trig"
```

(A pipe, not a process substitution: under the file's `set -uo pipefail` a failed `jq` fails the
pipeline and the arm stops — a zero is never recorded for a summary that was never read. `jq -r`
appends one newline; the helper trims before measuring, so `chars` counts the text and not the
plumbing.)

The helper prints one JSON object. **Normalisation first**, mirroring what the binary does before
injecting: drop the first `<analysis>…</analysis>` block (non-greedy, no global flag); replace
`<summary>X</summary>`, when present, with the literal `Summary:` line followed by `X.trim()` — replace,
not unwrap: the session sees that `Summary:` line and `chars` must count what the session sees; collapse
runs of blank lines to one; trim. `compact_summary` is the raw text, so measuring it unnormalised would
count scratch work the session never sees.

On the normalised text:

| field | meaning | type |
| --- | --- | --- |
| `chars` | length | integer |
| `filesChars` | chars from the "Files and Code Sections" heading to the next numbered heading; the heading regex tolerates `#`, `**`, a trailing colon and case (the corpus carries both `Errors and fixes` and `Errors and Fixes`); **null** when no such heading exists (19% of summaries are not in the nine-section format) | integer or null |
| `fences` | count of fenced code blocks (pairs of triple backticks; an odd count floors) | integer |
| `cited` | working-set files named in the summary: the file's repo-relative path appears, or a path-segment-aligned suffix of it of at least two segments that is unique *within the set* appears — computed from the set file alone, no graph needed | integer or null |
| `setSize` | `files.length` of the set | integer or null |
| `steered` | copied from the set; `false` when there is no set | boolean |
| `served` | copied from the set (§3.3 step 5); `false` when there is no set | boolean |
| `trigger` | `auto` or `manual`, from the payload | string |
| `scope` | `main`, `subagent` or `ambiguous`, copied from the set; **null** without a set | string or null |
| `at` | epoch ms | integer |
| `n` | **added by the hook, not the helper**: the journal's line count before the append, plus one — merged into the object before both writes, so hookstate and the journal carry the same `n`; it counts compactions of **every scope**, because the journal is the session's and a subagent's compaction is the session's compaction | integer |

`agent` and `transcript` are copied from the set into the **journal line only** (below); hookstate and
the wire carry `scope`, which is what a chip can render.

**Shape gates, both directions** — the hookstate writer is one `jq -cn --argjson …` whose failure is
`|| exit 0`, and a hook that writes nothing is "the worst shape this file can fail in" (its own header).
So the helper's stdout is accepted only if it parses as exactly one JSON object of the pinned shape
(`COMPACT_SHAPE_PRED`, spelled once in the hook and concatenated into both jq programs; anything else,
including exit 0 with garbage, carries the previous value); and the value read back from hookstate is
re-validated by the same predicate inside the read-back `jq` — as a sixth positional line placed
**before** `subagents`, which stays last because it is the one field that can carry unbounded text
(D-1249) — degrading to `null`. On any failure the write proceeds without the member, never not at all.

The hook adds `n`, then merges the object into hookstate as **`compaction`** — read back on every
event and re-emitted like the counters, so it survives state transitions; **reset to `null` on `SessionStart` with
any source but `resume`** (the same boundary and reason as the counters, D-1248: a stale last-compaction
would describe the previous context as current); carried on `resume` and, structurally, on `compact`;
overwritten by the next PostCompact; **carried, not cleared, while `compact-card-off` is present** — the
chip shows the last measurement until the next non-resume SessionStart. Then the same object plus
`cwd`, `built`, `agent` and `transcript` from the set (`null` each without a set) is appended as one
line (< 1 KB, a single `>>` write, no lock) to **`$REG/<id>.compactions`**, the study corpus. If the helper fails, `compaction` is carried unchanged and
no journal line is written — a measurement that did not happen is not a zero — and the set is consumed
all the same. Nothing is printed. The existing done/working transition is unchanged.

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

### 3.6 The wire and the chip

One type, **`CompactionMeas`**, declared in `shared/api.ts` (L0, imports nothing) and imported by the
server's hookstate reader; `single-definition.test.ts` gains a holder pin
(`expect(holders).toEqual(['shared/api.ts'])`).

```ts
export interface CompactionMeas {
  n: number; at: number; trigger: 'auto' | 'manual'; scope: 'main' | 'subagent' | 'ambiguous' | null;
  chars: number; filesChars: number | null; fences: number;
  cited: number | null; setSize: number | null; steered: boolean; served: boolean;
}
```

| hop | file | rule |
| --- | --- | --- |
| reader | `server/src/hookstate.ts` — `HookState.compaction: CompactionMeas \| null`, own reviver beside the counter ladder | absent/null → `null` ("no field": a hook that predates this); present → every member validated; malformed → the same `Malformed` the counters throw, rejecting the whole read |
| assembly | `server/src/fleet.ts` — `compaction: hs?.compaction ?? null` | no hook data and a hook without the field collapse to one `null`, right here because the console does the same with both |
| wire | `shared/api.ts` — `FleetSession.compaction: CompactionMeas \| null`, required member, **additive, `FLEET_PROTO` stays 1** | an older PWA ignores the key; an older server omits it and the tolerant reader answers `null` |
| persisted revive | `reviveFleetSession`: one `asObj` block on the `reviveSubstrate` model | absent → `null`; present-but-malformed → `MalformedSnapshot`. Two separate guarantees: `FleetSession.compaction` being a **required member** is what stops every full object literal typed `FleetSession` compiling until it names the key (about 25 fixture builders in `pwa/test` and one in `server/test/fleetstate.test.ts`, whose three spread literals compile unchanged — re-measure at plan time), and the reviver's literal return is what stops a revival path forgetting to compute it |
| live-frame reader | `compactionInfo(session)` beside `graphReadCount` | the ONE reader every PWA surface uses; the `tolerantCount` ladder, whole-object: no finite `chars` → `null`, never a partial chip; the `number \| null` members (`filesChars`, `cited`, `setSize`) are then read individually through the same tolerance, a non-boolean `steered` or `served` reads `false`, and a `scope` that is none of the three literals nor `null` reads the whole object `null` |
| chip | `pwa/src/fleet/SessionLine.tsx`, `.sess-compact` in the same conditional run as `.sess-graph`; `RunsScreen.tsx` reuses class and reader | gated on the reader being non-null: `compact 17k` — `sub·compact 17k` when `scope` is `subagent`, plain for `main`, `ambiguous` and `null` — then `· cites 7/12` when `setSize` is non-null; `scope` and `steered` on the `title` attribute |

## 4. Failure modes, each silent by contract, each stated

| condition | behaviour |
| --- | --- |
| served session (`transcript_path` empty) | no set, no card, no steering; PostCompact still measures, with `scope`, `cited` and `setSize` null |
| transcript unreadable | nothing written (§3.1 guard 2), nothing printed |
| no tool calls in the window | helper exit 3: the set stands with `files: []`, no card |
| no graph, or > `GRAPH_GATE_MAX_BEHIND` behind | no card, no steering; the set stands with `files: null`; the standing graph card still says why |
| graph built at another commit but same content as HEAD, or ≤ `GRAPH_GATE_MAX_BEHIND` behind | the card header carries the same freshness word the graph card uses |
| `find` missing | nothing written by PreCompact — the scope cannot be measured and a silent `main` would be a wrong answer; PostCompact writes nothing either |
| `node` or `timeout` missing (a BSD userland); helper missing, refusing, or timing out | silent; the hook's own set stands (`files: null`) and PostCompact consumes it; nothing partial at a target name, and a temp orphaned by `timeout` is swept by the next PreCompact. With no `timeout` the helper never runs: no card, no measurement, no journal line — §6's R2 states it |
| `graph.json` over `GRAPH_MAX_BYTES` | no card; the set stands with `files: null` and `built` set — the journal shows a graphed tree that was never carded |
| PostCompact's helper fails, or the set will not parse | `compaction` carried, no journal line; the set is consumed all the same, so the next compaction is not `ambiguous` for it |
| compaction blocked or failed after PreCompact | card and set remain. Inside `COMPACT_CARD_MAX_AGE` the next PreCompact reads them as overlap (§3.0): that compaction is `ambiguous`, no card. After the window the card is removed at the next SessionStart(compact) and the set at the next PostCompact, both unread |
| a second PreCompact inside the in-flight window (overlap) | both compactions degrade: the later set is `ambiguous` and the card is removed; the earlier one gets no card and an `ambiguous` measurement (§3.0) |
| `compact-card-off` flipped between PreCompact and PostCompact | the pair stays until the window retires it; nothing served, nothing measured |
| subagent compaction, the one live agent beside a quiet parent | §3.0 resolves the subagent's own transcript; card, steering and measurement proceed exactly as for the main thread, tagged `scope:"subagent"` with the `agent` id. The payload still carries the parent's transcript and id — which is why the rule exists |
| two contexts live at PreCompact — a Workflow fan-out, or a background subagent beside its parent | scope `ambiguous`: a set with `transcript: null`, no card, a measurement with `cited`/`setSize` null; counted on the corpus (§3.0) |
| a live sibling paused longer than `COMPACT_LIVE_S` while another context compacted | one mislabelled compaction (false exactness, §3.0); checkable offline — the journal names a subagent transcript that carries no `compact_boundary` near the line's `at` |
| the card's first line is not the set's `at`, or there is no set | a crossed pair: not served (§3.3 step 2); the overlap check or the age bound retires it; the measurement reads `served: false` |
| the card was mined but never reached the model (crossed pair, aged card, failed emit) | `served: false` on the journal line; `cited` is not read against it |
| `agent_type` / `agent_id` on the payloads | **measured absent** (2026-09-09, §0.2); the approved design gated on the field and no longer does — the measurement it named as Plan A's first task was taken before any plan was written (§7 item 1) |
| `~/.ccrc/compact-card-off` present | all three arms inert: no card, no steering, no measurement, no journal line; a card already on disk is never served; a `compaction` already in hookstate is carried, not cleared — the chip persists until the next non-resume SessionStart |
| helper prints non-JSON with exit 0 | the shape gate carries the previous `compaction`; hookstate is still written |
| stage 2 forfeits precomputed compaction | measured never used here; `steered` recorded; steer switch exists |
| card text reaches the model | repo-controlled labels and paths only, bounded twice, passed through `jq --arg`, never interpolated into shell |
| summary not in the nine-section format | `filesChars` null, everything else measured |
| the model ignores the steering | that is what `filesChars`, `fences` and `cited` are for |

## 5. Mutation targets (red first, one mutation each)

**Hook** (`server/test/session-hook.test.ts`, fixture HOME, a fixture tree with a small `graph.json`
+ labels, fixture transcripts):

| mutation | expected red |
| --- | --- |
| PreCompact arm deleted | card + set absent after a PreCompact with a graphed tree and a mined transcript |
| stage 1 prints on PreCompact | stdout-empty test (the existing `printed on stdout` pin, PreCompact included) |
| stage 2 prints without exit 0 | transcript with no tool calls → exit 3 → stdout `''` |
| stage 2 text edited | verbatim pin of `STEER_TEXT` |
| the liveness rule dropped (always `main`) | one live `subagents/agent-x.jsonl` beside a quiet parent: the set reads `scope:"subagent"`, `agent:"x"`, `transcript` that file, and a path named only in the agent's transcript is on the card |
| liveness stops at one depth | the same, with the agent file under `subagents/workflows/wf_1/` |
| liveness ignores mtime (every agent file counts) | a dead agent file (older than `COMPACT_LIVE_S`) beside a live parent → `scope:"main"` and the parent's path on the card |
| two live contexts not ambiguous | a live parent beside a live agent → `scope:"ambiguous"`, `transcript: null`, no card; two live agents → the same |
| manual trigger not `main` | `trigger:"manual"` with a live agent → `scope:"main"` |
| overlap check dropped | a second PreCompact inside `COMPACT_CARD_MAX_AGE` → the set reads `ambiguous` and the card is gone |
| the nonce not written, or not compared | a card whose first line is not the set's `at` → not served, still on disk; a served card never contains the nonce line |
| aged card not removed | a card older than `COMPACT_CARD_MAX_AGE` → removed at SessionStart(compact), not served |
| PostCompact reads an aged set | a set older than the window → removed; measurement with `scope`/`cited`/`setSize` null |
| the `find` guard in the resolver dropped | a fixture PATH with no `find` → a set is written with a silent `main`; with the guard, nothing is written and stderr is empty |
| the slot check dropped | a set whose `at` is not the helper's `--at` → the helper exits 1 and writes nothing; with the check dropped it overwrites |
| the temp sweep dropped | a stale `.<id>.compactcard.999.tmp` older than the window survives PreCompact; a young one always survives |
| `served` not stamped | after a served card the set (and the journal line) read `served: true`; after a crossed pair `false` |
| the set not consumed on a failing PostCompact | a failing helper leaves the set; the next PreCompact inside the window reads `ambiguous` |
| a malformed set loses the measurement | a set that will not parse → `compaction` written with `scope`/`cited`/`setSize` null, the set consumed |
| the graph size guard dropped | a `graph.json` over `GRAPH_MAX_BYTES` (a padded fixture) → exit 1, the hook's set stands |
| `steered` stamped before the print | (Plan C) a helper exit 3 under `--steer` → `steered: false` |
| set not written without a graph | graphless fixture tree → set present with `files: null` and `scope` set; the PostCompact journal line carries `scope` with `cited`/`setSize` null and `built` null |
| helper exit 3 writes no set | transcript with no tool calls → set present with `files: []`, no card |
| `transcript_path` guard removed | empty path writes nothing |
| freshness predicate dropped | fixture built at a non-ancestor sha writes no card; the set stands with `files: null` |
| `compact-card-off` ignored in any arm | card + set absent; no fourth subject served with a card on disk; hookstate `compaction` unchanged and no journal line after a PostCompact |
| `compact-steer-off` ignored | card yes, stdout `''`, set `steered:false` |
| SessionStart step 2 dropped | `source:"compact"` with no set at all → the card stays on disk and no fourth subject is printed |
| `scope` not carried | after a subagent-scoped compaction, hookstate `compaction.scope == "subagent"` and the journal line carries `agent` and `transcript`; after an ambiguous one, `"ambiguous"` with both null |
| card not served on compact | envelope lacks the 4th subject; card served on startup → must not be |
| card not consumed | file still present after the compact SessionStart |
| age bound dropped | a card older than `COMPACT_CARD_MAX_AGE` is served |
| compact SessionStart writes hookstate | D-306 test, extended with a card present |
| standing clip deleted or moved | a fixture with 3,000 digits in the report head (D-1899's own) plus a card present: the standing subjects exceed `CARD_MAX_CHARS`, or the compact card is not intact |
| total clip raised | envelope > `CARD_TOTAL_MAX_CHARS` with a pathological card |
| ceilings drift | `CARD_MAX_CHARS + COMPACT_CARD_MAX_CHARS >= HARNESS_CONTEXT_SPILL_CHARS` |
| PostCompact measures raw text | fixture summary with an `<analysis>` block → `chars` excludes it |
| `<summary>` unwrapped instead of replaced | fixture with a `<summary>` block → the `Summary:` line survives into the measured text |
| helper stdout accepted unparsed | helper printing `not json` with exit 0 → hookstate still written, `compaction` unchanged; a corrupt `compaction` on disk → hookstate still written, member `null` |
| `n` computed twice | after two compactions, hookstate `n` equals the journal's line count |
| heading regex loses a spelling | both `3. Files and Code Sections:` and `**3. Files and Code Sections:**` fixtures |
| `cited` folded to 0, or `scope` to `"main"`, without a set | null-vs-0 and null-vs-main tests |
| `compact-card-off` ignored in the SessionStart or PostCompact arm | one mutation per arm: the arm's own guard deleted → that arm's operator-file test red |
| journal not appended / set not deleted | line count and file presence |
| `carried` mining dropped | a window holding only a previous summary that names two files → set has both, tagged `carried` |
| `compaction` reset on resume, or not reset on clear | reset-boundary tests mirroring D-1248's |
| the helper not under `timeout` | a stub `timeout` on the fixture PATH records the constant and the argv; deleting the wrapper reds it. An absolute-ms budget is NOT used: session-hook.test.ts records why it was rejected for a hook arm (D-1898); the helper's own cost is MEASURED on the fleet's real graphs before the constant ships (Plan A, Task 6) and recorded beside it |
| compact SessionStart with a card slows | its own interleaved ratio test against the cheap arm — own array, own ceiling argued from a measured shipped-vs-mutated band, D-1898's method; never folded into the startup array, where one slow run hides at the max |

**Helper** (`server/test/compact-card.test.ts`, importing the `.mjs`): backwards boundary scan, the
literal-in-a-body false positive, the 16 MiB cap realigned to a line, tag and token mining, exact and
unique-suffix resolution with `ambiguous`/`outside`/`nomatch` counts, ranking, the graph's node-link
shape (edges under `links`), card format with the scope in the header, `(+k files not shown)` on any
drop, the ceiling, the copy of `--scope`/`--agent`/`--transcript`/`--at` into the set and the nonce as
the card's first line, pid-suffixed temps, `measure` normalisation, every exit code.

**Installer/deploy**: `deploy.sh` ships the helper by `install_atomic` beside the hook (pinned like the
hook's own line); `install-session-hooks.sh` unchanged — the derived wiring test stays untouched.

**Wire and console** (the §3.6 hops, and the two scope behaviours):

| mutation | expected red |
| --- | --- |
| reviver folds absent and malformed | a malformed-member fixture must throw `Malformed`; an absent field must read `null` |
| assembly returns `undefined` | `fleet.ts` fixture without hookstate → `compaction === null` |
| `reviveFleetSession` widens instead of returning a literal | the fixture-builder compile check; a malformed persisted object must throw `MalformedSnapshot` |
| `compactionInfo` returns a partial object | a frame with `chars: "17k"` reads `null` |
| chip renders `cites` with `setSize` null | session-line test |
| `scope` tolerance dropped | a frame with `scope: "parent"` reads the whole object `null` |
| chip drops the `sub·` prefix | a `scope: "subagent"` frame renders `sub·compact`; an `ambiguous` one renders plain |
| a second `CompactionMeas` declaration | `single-definition.test.ts` holder pin |

## 6. Rings, invariants, and the one amendment

- **Rings.** `compact-card.mjs` is a deploy-side node script (the `shared/mark.mjs` class: `node:*`
  only, never bundled). `CompactionMeas` is L0. The hookstate reviver is the L3 adapter and may not
  narrow a distinction it received — hence null-vs-0 on `cited`/`setSize`/`filesChars`, and `Malformed`
  rather than a folded object.
- **Wire discipline.** Additive; `FLEET_PROTO` 1; one tolerant reader per field; `reviveFleetSession`
  literal.
- **The hook's standing contract** (exit 0 on every path, atomic writes, no network, no locks) is
  unchanged in every clause but one — and **amendment R2** names it: *no waiting* gains the two
  compaction arms, which wait on the helper for at most `COMPACT_HELPER_TIMEOUT` (8 s, argued in §3.1 and
  re-measured on the fleet before it ships),
  off the hot path (each brackets a compaction of at least 79 s) and never for the hookstate write,
  which lands first. The hook header's contract sentence is corrected to say so in Plan A. Every call
  site is `|| true`-shaped; `find` is guarded like `jq` inside the resolver; `node` and `timeout` are not,
  because their absence is indistinguishable from a failing helper at the call site and a guard nothing
  can redden is not a mechanism.
- **The three registry names are dot-free suffixes, and that is a coupling, not a convenience.**
  `_reg_purge`'s loop removes every dot-free `$REG/<id>.<suffix>` except `archived` and `reaping` (last,
  in that order) and the explicitly named `<id>.hookstate.json` — so `compactcard`, `compactset` and
  `compactions` go with the row. The same dot-free shape is what `_ws_slug_free`/`_ws_slug_residue`
  scan, so a file that outlived its row would hold the slug; every arm therefore removes what it will
  not serve — the aged card (§3.3), the aged set (§3.4), the consumed pair — and the destructive verbs
  stop the session before they purge, so no hook writes after the purge.
- **Amendment to the read-side spec, R1.** It rules that *"the card path is the only `printf` to stdout
  in the file"* and the hook's own header says the two events it prints on are SessionStart and
  PreToolUse. Both become three: **PreCompact stdout is a second, deliberate site, and its stdout is
  instructions to the summariser, not context to the model.** The read-side spec gets a one-line pointer
  under R1 to this section (delete-or-point; never a silent contradiction), the hook header is corrected,
  and the stdout-empty test excepts PreCompact only in stage 2.
- **Rulings honoured.** Only ccrc-owned artifacts change (hook, helper, installer/deploy, hookstate,
  server, PWA). No `CLAUDE.md`. The graph is read, never built — App. B's rejection of session-side
  extraction stands. The effect is measured at PostCompact and visible on the console.

## 7. Deploy and staging

This spec yields **three plans at two explicit seams**, each independently useful:

1. **Plan A — agent lane**: §3.0–§3.4 (the scope rule, the three arms, the helper's two subcommands),
   §5's Hook, Helper and Installer groups. The payload measurement this item once named as its first task
   was taken before the plan (2026-09-09, §0.2) and came back negative, which is what produced §3.0;
   Plan A's first task is now the scope resolver with its fixture session directory. Deploy agent-first:
   `deploy.sh`'s agent lane ships hook and helper through `install_atomic`; the hook is read fresh at
   every event, no restart, no `caps` change. The journal is the deliverable — the corpus starts filling
   with no console change.
2. **Plan B — console lane**: §3.6 and §5's Wire-and-console group. Server lane, then PWA.
3. **Plan C — stage 2**: §3.5, the `--steer` pass and the print, after the baseline. **The act that takes
   the baseline is named**, as R5's revisit had to be (D-1365): on the fleet box, on a dated day,
   `cat ~/.cc-sessions/*.compactions | jq -c 'select(.steered==false)'` over the live sessions' journals,
   after at least 7 days or 100 journal lines since Plan A's deploy, whichever comes first; the reading —
   per lane, `chars`, `filesChars`, `fences`, `cited/setSize` — is recorded in Plan C's own measurement
   section before its first task, and the same command with `.steered==true` is re-run 7 days after
   Plan C deploys. Journals are per-session and purged with the session, so the baseline is a sample of
   the sessions alive that day, not a series; that is stated in the reading, and it is enough — the
   comparison is per lane and per tree, not per session.
4. Deviation numbers are minted at plan time through `ccrc-api ledger allocate`; this spec defines none.
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
- **A fleet-wide journal under `~/.ccrc`.** Needs a lock and rotation; a per-session file needs neither
  and is purged with the session.
- **A `compactions` counter beside the object.** `n` inside the object and the journal's line count are
  the same number.
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
- The pair race of §3.0, narrowed to the interval between the helper's slot re-read and its rename:
  an overlapping PreCompact landing inside those milliseconds can leave a matching pair that the other
  context's SessionStart(compact) consumes — one served card in the wrong context, recorded as
  `served: true` under the wrong `transcript`. Nothing shorter than a per-transcript slot closes it, and
  the journal's `parentLive`/`liveAgents` make the case findable.
- The helper's cost on the fleet's largest graphs, measured in Plan A's Task 6 before
  `COMPACT_HELPER_TIMEOUT` ships; and the `ambiguous` rate, which decides whether the fan-out case is
  worth asking Claude Code for an agent id.
- 2 of 24 live processes already run 2.1.267, which no binary fact here was read from; the first live run
  of Plan A on such a session is the check, and the payload measurement of §0.2 (the three key sets, one
  subagent compaction, and the subagent transcript's location) is repeated on it.
- If Anthropic enables precomputed compaction reuse on this fleet, stage 2 forfeits it; `steered` and the
  journal make that visible before it costs anything.
