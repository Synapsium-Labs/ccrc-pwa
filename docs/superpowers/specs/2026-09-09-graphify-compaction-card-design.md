# Graphify-aware compaction: the structural card, the steering, the measurement — design

**Date:** 2026-09-09
**Status:** design approved in five sections by the operator (2026-09-09); **amended 2026-09-10** after the
payload measurement of §4 came back negative — the subagent guard became the scope rule of §3.0, on the
operator's direction that compaction works for a subagent exactly as for the main thread; no implementation yet
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
  captured for five main-thread and two subagent compactions; the key sets are byte-identical. The
  subagent's own transcript is `<dirname transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl`
  for an `Agent`-tool subagent and `…/subagents/workflows/<run>/agent-<agent_id>.jsonl` for a Workflow
  agent (this session's own directory: 0 direct, 42–78 under `workflows/` per lane), and while it
  compacts it is the most recently written transcript of the session — the parent is idle, waiting on
  it. The parent's transcript does **not** yet carry the new `compact_boundary` when any of the three
  hooks fire, so a boundary count cannot tell the two apart either; and the summariser's own
  `SubagentStop`, which fires during a main-thread compaction, writes no transcript. §3.0 stands on
  exactly these facts.
- **Every hook payload carries `transcript_path`**, empty for served sessions.

### 0.3 The prototypes

- **Working set from the transcript.** In this session 162 of 179 tool calls were `Bash`, 9 were
  `Read`/`Edit`/`Write`: bypass-permissions mode routes reads through `cat`/`sed`/`grep`, so a derivation
  keyed on the `Read` tool alone would be near-empty. Mining path-like tokens out of every tool input and
  resolving them against the graph's own 820 `source_file` values resolved 87 of 152 tokens with zero
  ambiguity over the whole 3.9 MB transcript — 15 files (the rest were outside the tree or not in the
  graph). The design's own window — since the last boundary, which sat at 77% of that file and left 19
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

Goals: (1) *fidelity* — the files, symbols and dependents a session was working in survive compaction
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
(every arm below is inert while ~/.ccrc/compact-card-off exists; each first resolves WHICH
 transcript is compacting — the main thread's or a subagent's — by the scope rule of §3.0)
PreCompact ──► scope ──► $REG/<id>.compactset            (JSON: scope, agent, transcript; files null)
   │          └► helper `card` ──► $REG/<id>.compactcard  (text, ≤ COMPACT_CARD_MAX_CHARS)
   │                            └─► $REG/<id>.compactset  (rewritten: files, tags, counts, steered)
   └─ stage 2: prints STEER_TEXT iff the helper exited 0 and the steer switch is absent
summariser  (Claude Code; reads Additional Instructions)
SessionStart(compact) ──► scope again; iff the set names the same transcript, appends .compactcard
                          as the 4th subject of the ONE envelope and deletes it
PostCompact ──► helper `measure` (compact_summary on stdin, .compactset) ──► hookstate.compaction
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
| `COMPACT_CARD_MAX_AGE` | 3600 s | hook | a card older than this is never served |
| `COMPACT_HELPER_TIMEOUT` | 20 s | hook | `timeout` around both helper calls; measured 0.2–1.5 s |
| `COMPACT_WINDOW_CAP` | 64 MiB | helper | the transcript window when no boundary exists |
| `COMPACT_WORKSET_MAX` | 12 | helper | files on the card; the set file keeps up to 100 |
| `GRAPH_GATE_MAX_BEHIND` | 10 | hook (exists) | the freshness predicate, shared with the gate |
| `~/.ccrc/compact-card-off` | file | operator switch, honoured by all three arms | the whole feature off: no card, no steering, no measurement |
| `~/.ccrc/compact-steer-off` | file | operator switch | stage 2's print off; card and measurement stay |

## 3. Mechanisms

### 3.0 Which transcript is compacting — the scope rule

Compaction is **one mechanism for the main thread and for every subagent** (operator direction,
2026-09-10: a subagent's context fills and compacts the same way, and its summary has the same fidelity
problem). The payload cannot say which one fired the hook (§0.2), so the hook decides it from the
filesystem, once per arm, with one function, `_hook_compact_scope "$tp" "$sid"`:

1. `dir="$(dirname "$tp")/$sid/subagents"` — the session's own subagent directory.
2. The **newest** `agent-*.jsonl` under `$dir`, at any depth, that is **newer than `$tp`**:
   `find "$dir" -name 'agent-*.jsonl' -newer "$tp" -printf '%T@ %p\n' | sort -n | tail -1` — one
   fork, 0.00 s measured over 621 entries; a missing `$dir` is the empty result. Any depth, because
   `Agent`-tool subagents sit directly in it and Workflow agents one `workflows/<run>/` deeper (§0.2).
3. Found → scope **`subagent`**, transcript that file, `agent` its `<agent_id>`. Not found → scope
   **`main`**, transcript `$tp`, `agent` null.

Every downstream step takes the *resolved* transcript: the card is mined from the subagent's own work,
`carried` from the subagent's own previous summary, the set and the journal record `scope`, `agent`
and `transcript`, and hookstate `compaction` carries `scope`. Nothing is skipped and nothing is
main-only. **The scope is a tag the console renders, not a gate.**

**Why this rule and not another.** `agent_type`/`agent_id`: absent from all three payloads (§0.2). A
boundary count in `$tp`: not yet written at hook time (§0.2). Hookstate's own `subagents` list, which the
`SubagentStart`/`SubagentStop` arms maintain: measured to carry stale entries — a `SubagentStop` does not
always arrive, and the summariser fires one of its own — so it cannot say whether a subagent is
*running*, let alone compacting. The mtime rule is exact whenever one context is active: a foreground
subagent compacts while its parent waits on it, and the main thread compacts between subagents. The
transcripts keep the truth for any later check.

**Residual, stated.** With a *background* subagent writing while another context compacts, the newest
file is the writer, not the compactor, and for that one compaction the scope, the card and the journal
line describe a sibling context of the same session. It is bounded (one compaction; a card of a sibling
in the same session, never another session's), it is visible (the journal line's `transcript`, checked
offline against that transcript's own `compact_boundary` stamps — the compactor's carries one just after
the line's `at`, the writer's does not), and it is measured on the first live corpus before it is fixed.
If it is not rare, the fix is a card file per transcript, which needs `_reg_purge` to learn a second
suffix shape; not before the number says so.

### 3.1 PreCompact arm (hook)

Guard chain, in order, every failure silent and total (nothing written, nothing printed):

1. `~/.ccrc/compact-card-off` absent.
2. `.transcript_path` non-empty and a readable regular file.
3. `_hook_compact_scope` (§3.0) resolves the compacting transcript, and the resolved file is readable.
   **The set file is written here, always** — `{v, at, scope, agent, transcript, cwd, files: null,
   stats: null, steered: false}`, by the hook (`jq -cn --arg …`, temp-then-rename) — so PostCompact has
   the scope whether or not anything below runs. `files: null` means *not mined*; the helper's
   `files: []` means *mined, empty*: two conditions, two values.
4. `_hook_graph_measure` returns 0 **and** `_hook_gate_tree` holds — the tree has a graph no more than
   `GRAPH_GATE_MAX_BEHIND` commits behind HEAD. Same predicate as the search gate, so the card and the
   gate agree about which trees count.
5. `node` on `PATH` and `$HOME/.cc-sessions/compact-card.mjs` present.

Then, with `--transcript` the **resolved** file of guard 3, never the payload's:

```
timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" card \
  --transcript "$transcript" --cwd "$GM_CWD" --graph "$GM_CWD/graphify-out/graph.json" \
  --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
  --out "$REG/$id.compactcard" --set "$REG/$id.compactset" \
  --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
  --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$scope" [--agent "$agent"] [--steer]
```

`--steer` is passed when stage 2 is built and `~/.ccrc/compact-steer-off` is absent; the helper records
it in the set file, so the *intent* to steer and the *fact* of steering are one bit. Exit 0: the card
was written, and the set rewritten with the working set; in stage 2 the hook then prints `STEER_TEXT`
(§3.5) — one line, plain text, the second and last deliberate stdout site in the file. Exit 3: the
working set was empty — the set is rewritten with `files: []`, no card. Any other exit, or the timeout:
nothing more; the hook's own set from guard 3 stands. The existing `state="working"` write is
unchanged.

Cost is not on the hot path — the compaction that follows takes 79 s at minimum on this fleet — but it
is bounded by the timeout and pinned by a test (§5).

### 3.2 Helper subcommand `card`

**Input.** `--transcript` is whichever file §3.0 resolved — the parent's or a subagent's. The helper
neither knows nor cares which, beyond copying `--scope` and `--agent` into the set; a subagent transcript
has the same line shapes (`assistant` rows with `tool_use` items, `compact_boundary`, `isCompactSummary`).

**Window.** The transcript since the last compaction boundary. Found by scanning the file *backwards*
from EOF in 1 MiB chunks for a line containing `"compact_boundary"` and confirming that the line parses
as `{type:"system", subtype:"compact_boundary"}` — a literal inside a message body is not a boundary
(the prototype named this false positive; the design closes it). No boundary: the whole file, capped at
the last `COMPACT_WINDOW_CAP`, realigned to the next line start (a mid-line start is not a partial parse
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
typed. Files with no extension (`ccd/ccd`, `ccd/ccclip` — 11 of this repo's 820) cannot be mined from
shell text and are a stated limitation, not a bug.

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

**The card.** File-centric, one line per file, terse, no markdown tables:

```
graphify card — this session's working set at compaction, from graphify-out/ (built at 40706e0c, fresh):
- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseStatusline:L132 parseCtxPct:L105 segmentAfter:L120 · used by server/src/watch.ts server/src/fleet.ts (+1)
- pwa/src/lib/models.ts [edited] · community "SessionScreen.tsx" · symbols modelOptions:L29 effortOptions:L54 · used by pwa/src/session/ModelSheet.tsx (+2)
- ccd/session-hook.sh [touched] · community "session-hook" · symbols _hook_graph_card:L278 _hook_emit_context:L59 _hook_graph_measure:L157 · used by server/test/session-hook.test.ts (+1)
(+6 files not shown)
Blast radius: 268 files import or call something in these 9 files.
Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.
```

(Format example, rendered from the 9-file whole-transcript set of §0.3 — all nine in the working set,
three carded before the budget cut; the symbol lines and counts are illustrative.) Per file: path; tag; the community label of the file node from `.graphify_labels.json` (omitted when the
file is absent from it); its top five symbols by total degree among nodes whose `source_file` is the
file, as `label:L<line>` from `source_location`; and the top three files *outside the working set* that carry an
`imports`, `imports_from`, `calls`, `references` or `indirect_call` link **into** any node of the file,
by link count, with `(+n)` for the rest. Then one blast-radius line with the total count of dependent
files outside the working set. Then the fixed footer. The header carries the graph's commit (8 chars) and the
freshness word `_hook_graph_measure` produced, so a card from a graph built at another commit says so
the way the graph card does.

**Truncation** drops whole files from the bottom until the text fits `--max-chars`, then collapses
`used by` lists to their `(+n)`, never mid-line, and **always** prints `(+k files not shown)` when
anything was dropped — a short card must never read as a small working set (the prototype's `(not in
graph)` sentinel meant both, and the repo calls that an overloaded null).

**Files.** Both written to a dot-prefixed temp name in `$REG` and renamed into place, the hook's own
idiom. Names carry **no second dot** on purpose: `_reg_purge` removes `$REG/<id>.<suffix>` only when the
suffix has no dot (its nested-id guard), and removes `hookstate.json` by an explicit line; these three
are purged with the session by the loop, no explicit line needed.

`.compactset`:

```json
{"v":1,"at":1789330000000,"scope":"main","agent":null,
 "transcript":"/home/u/.claude/projects/-home-u-worktrees-ccrc-pwa-amber-prairie/<session>.jsonl",
 "cwd":"/home/u/worktrees/ccrc-pwa/amber-prairie","built":"40706e0c","fresh":"fresh",
 "steered":false,
 "files":[{"path":"server/src/pane/statusline.ts","tag":"edited","count":7}, ...],
 "stats":{"tokens":152,"resolved":87,"ambiguous":0,"outside":43,"nomatch":22}}
```

Exit codes: 0 card and set written; 3 empty working set (set written with `files: []`, no card); 2 usage;
1 any failure (unreadable input, malformed graph, write error — nothing written, the hook's own set
stands). Reads only the three input files; writes only the two named outputs.

### 3.3 SessionStart(compact) arm (hook)

Inside the existing `SessionStart` arm, **only when `src == compact`**, after the three standing
subjects are built and before the D-306 `exit 0`:

0. `~/.ccrc/compact-card-off` absent — **before the file is touched**.
1. `f="$REG/$id.compactcard"`; require a regular file younger than `COMPACT_CARD_MAX_AGE` (a
   `find -newermt`/`stat` age check, one syscall).
2. **The card must be this context's.** `_hook_compact_scope` (§3.0) is evaluated again, and the set
   file's `transcript` must equal the resolved one. A missing set, or a different transcript, serves
   nothing and leaves the card on disk untouched — it belongs to a compaction still in flight, or to
   nobody, and the age bound retires it. Wrong context is worse than no context.
3. Read it, clip at `COMPACT_CARD_MAX_CHARS` (defence in depth behind the helper's bound), `rm -f` it.
   Consume-once: a card is never served to two contexts.
4. **Two clips, one per budget.** The three standing subjects are joined and clipped at
   `CARD_MAX_CHARS` exactly as today — that clip is the *only* defence for the ungated `GM_NODES`
   (`_hook_graph_measure`, D-1899: 3,000 digits in the report head measured a 3,437-char graph card), and
   it must not move. The compact subject is then appended as the **fourth and last** subject with the
   same one-space join, and the emitter clips the result at `CARD_TOTAL_MAX_CHARS`, which is *derived* as
   the two ceilings plus the join — a pin on the sum, not a third budget — and pinned under
   `HARNESS_CONTEXT_SPILL_CHARS`.

Startup, resume and clear **never** read the file: a card describes the compacted context and nothing
else. Hookstate is **not** written — D-306 holds exactly as today, and its test extends to a run with a
card present. Cost is one `find`, one `jq` read of the set, one stat and one read; the existing
"SessionStart ≤ 4× the cheap arm" ratio test gains a compact-with-card run.

Nothing new is reachable: with a pathological `GM_NODES` the standing join is clipped at 2,400 exactly
as today (the graph card loses its tail, unchanged behaviour) and the compact card is intact; the
second clip never fires. A mutation row pins that the standing clip cannot be deleted or moved without
a red.

### 3.4 PostCompact arm (hook) and helper subcommand `measure`

Guard: `~/.ccrc/compact-card-off` absent; `.compact_summary` present and a string. The set file is
**expected** — PreCompact writes it whenever a transcript resolved (§3.1 guard 3) — but **optional**: a
served session, or a PreCompact that could not read its transcript, is still measured, with `scope`,
`cited` and `setSize` **null** — not 0, and not `"main"` — because "no set" and "cited nothing" are
different conditions, and an unknown scope is not the main thread. A set with `files: null` (no graph,
no node, helper failure) yields `cited` and `setSize` null with `scope` known.

```
timeout "$COMPACT_HELPER_TIMEOUT" node "$HELPER" measure [--set "$REG/$id.compactset"] \
   --trigger "$trig" < <(jq -r '.compact_summary' <<<"$payload")
```

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
| `filesChars` | chars from the "Files and Code Sections" heading to the next numbered heading; the heading regex tolerates `**`, a trailing colon and case (the corpus carries both `Errors and fixes` and `Errors and Fixes`); **null** when no such heading exists (19% of summaries are not in the nine-section format) | integer or null |
| `fences` | count of fenced code blocks (pairs of triple backticks) | integer |
| `cited` | working-set files named in the summary: the file's repo-relative path appears, or a path-segment-aligned suffix of it of at least two segments that is unique *within the set* appears — computed from the set file alone, no graph needed | integer or null |
| `setSize` | `files.length` of the set | integer or null |
| `steered` | copied from the set; `false` when there is no set | boolean |
| `trigger` | `auto` or `manual`, from the payload | string |
| `scope` | `main` or `subagent`, copied from the set; **null** without a set | string or null |
| `at` | epoch ms | integer |
| `n` | **added by the hook, not the helper**: the journal's line count before the append, plus one — merged into the object before both writes, so hookstate and the journal carry the same `n`; it counts compactions of **either scope**, because the journal is the session's and a subagent's compaction is the session's compaction | integer |

`agent` and `transcript` are copied from the set into the **journal line only** (below); hookstate and
the wire carry `scope`, which is what a chip can render.

**Shape gates, both directions** — the hookstate writer is one `jq -cn --argjson …` whose failure is
`|| exit 0`, and a hook that writes nothing is "the worst shape this file can fail in" (its own header).
So the helper's stdout is accepted only if it parses as exactly one JSON object (`jq -e 'type=="object"'`
into a variable; anything else, including exit 0 with garbage, carries the previous value); and the
value read back from hookstate is re-validated the same way before it reaches `--argjson`, degrading to
`null` — the same `^[0-9]+$` discipline the counters already have, for an object. On any failure the
write proceeds without the member, never not at all.

The hook adds `n`, then merges the object into hookstate as **`compaction`** — read back on every
event and re-emitted like the counters, so it survives state transitions; **reset to `null` on `SessionStart` with
any source but `resume`** (the same boundary and reason as the counters, D-1248: a stale last-compaction
would describe the previous context as current); carried on `resume` and, structurally, on `compact`;
overwritten by the next PostCompact. Then the same object plus `cwd`, `built`, `agent` and `transcript`
from the set is appended as one line (< 1 KB, a single `>>` write, no lock) to
**`$REG/<id>.compactions`**, the study corpus; the set file is deleted. If the helper fails, `compaction` is carried unchanged and no journal line is written — a
measurement that did not happen is not a zero. Nothing is printed. The existing done/working transition
is unchanged.

### 3.5 Stage 2: the steering text (hook constant, pinned verbatim)

> ccrc: after compaction a structural card from this repository's knowledge graph will be re-injected,
> naming the files this session touched, their symbols as path:symbol:line, and the files that depend on
> them. In "Files and Code Sections" cite path:symbol:line with one sentence on why it matters; do not
> paste code snippets, the session re-reads them on demand and can run `graphify explain "<symbol>"`.
> Keep verbatim: decisions and their reasons, errors and their fixes, the user's messages, pending
> tasks, and the exact current step.

Printed as **one line** of plain text on PreCompact (the blockquote above wraps it for reading; the
constant has no newline), only after the helper's exit 0, only without the steer switch. It is consistent with the operator's own `## Compact Instructions` ("drop verbose tool output
and full file listings"); where the base prompt asks for "full code snippets", the model arbitrates —
which is exactly why §3.4 exists.

### 3.6 The wire and the chip

One type, **`CompactionMeas`**, declared in `shared/api.ts` (L0, imports nothing) and imported by the
server's hookstate reader; `single-definition.test.ts` gains a holder pin
(`expect(holders).toEqual(['shared/api.ts'])`).

```ts
export interface CompactionMeas {
  n: number; at: number; trigger: 'auto' | 'manual'; scope: 'main' | 'subagent' | null;
  chars: number; filesChars: number | null; fences: number;
  cited: number | null; setSize: number | null; steered: boolean;
}
```

| hop | file | rule |
| --- | --- | --- |
| reader | `server/src/hookstate.ts` — `HookState.compaction: CompactionMeas \| null`, own reviver beside the counter ladder | absent/null → `null` ("no field": a hook that predates this); present → every member validated; malformed → the same `Malformed` the counters throw, rejecting the whole read |
| assembly | `server/src/fleet.ts` — `compaction: hs?.compaction ?? null` | no hook data and a hook without the field collapse to one `null`, right here because the console does the same with both |
| wire | `shared/api.ts` — `FleetSession.compaction: CompactionMeas \| null`, required member, **additive, `FLEET_PROTO` stays 1** | an older PWA ignores the key; an older server omits it and the tolerant reader answers `null` |
| persisted revive | `reviveFleetSession`: one `asObj` block on the `reviveSubstrate` model | absent → `null`; present-but-malformed → `MalformedSnapshot`. Two separate guarantees: `FleetSession.compaction` being a **required member** is what stops every full object literal typed `FleetSession` compiling until it names the key (about 25 fixture builders in `pwa/test` and one in `server/test/fleetstate.test.ts`, whose three spread literals compile unchanged — re-measure at plan time), and the reviver's literal return is what stops a revival path forgetting to compute it |
| live-frame reader | `compactionInfo(session)` beside `graphReadCount` | the ONE reader every PWA surface uses; the `tolerantCount` ladder, whole-object: no finite `chars` → `null`, never a partial chip; the `number \| null` members (`filesChars`, `cited`, `setSize`) are then read individually through the same tolerance, a non-boolean `steered` reads `false`, and a `scope` that is neither of the two literals nor `null` reads the whole object `null` |
| chip | `pwa/src/fleet/SessionLine.tsx`, `.sess-compact` in the same conditional run as `.sess-graph`; `RunsScreen.tsx` reuses class and reader | gated on the reader being non-null: `compact 17k` — `sub·compact 17k` when `scope` is `subagent` — then `· cites 7/12` when `setSize` is non-null; `steered` on the `title` attribute |

## 4. Failure modes, each silent by contract, each stated

| condition | behaviour |
| --- | --- |
| served session (`transcript_path` empty) | no card, no steering; PostCompact still measures, citations null |
| transcript unreadable, or no tool calls in the window | helper exits 1/3, nothing written, nothing printed |
| no graph, or > `GRAPH_GATE_MAX_BEHIND` behind | no card, no steering; the standing graph card still says why |
| graph built at another commit but same content as HEAD, or ≤ `GRAPH_GATE_MAX_BEHIND` behind | the card header carries the same freshness word the graph card uses |
| helper or node missing; helper timeout | silent; temp-then-rename leaves nothing partial |
| compaction blocked or failed after PreCompact | card and set remain; card served once within the hour or never; set overwritten by the next PreCompact. **Residual:** a failed compaction followed within the hour by one whose PreCompact could not write measures citations against the older set |
| subagent compaction | §3.0 resolves the subagent's own transcript; card, steering and measurement proceed exactly as for the main thread, tagged `scope:"subagent"` with the `agent` id. The payload still carries the parent's transcript and id — which is why the rule exists |
| a background subagent writes while another context compacts | the mtime rule names the writer: that one compaction's scope, card and journal line describe a sibling context of the same session (§3.0 residual). Recorded in the journal's `transcript`, checkable against that transcript's own `compact_boundary` stamps; measured on the first live corpus before any fix |
| the set names a transcript other than the one SessionStart(compact) resolves, or there is no set | the card is not served and stays on disk until the age bound retires it (§3.3 step 2) |
| `agent_type` / `agent_id` on the payloads | **measured absent** (2026-09-09, §0.2); the design once gated on the field and no longer does — the measurement was the first task of Plan A and was taken before it |
| `~/.ccrc/compact-card-off` present | all three arms inert: no card, no steering, no measurement, no journal line; a card already on disk is never served |
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
| scope resolution dropped (always `main`) | a fixture session directory whose `subagents/agent-x.jsonl` is newer than the parent transcript: the set reads `scope:"subagent"`, `agent:"x"`, `transcript` that file, and a path named only in the subagent transcript is on the card |
| scope resolution stops at one depth | the same, with the agent file under `subagents/workflows/wf_1/` |
| scope resolution ignores mtime | the same fixture with the parent transcript touched newer → `scope:"main"` and the parent's path on the card |
| set not written without a graph | graphless fixture tree → set present with `files: null` and `scope` set; the PostCompact journal line carries `scope` with `cited`/`setSize` null |
| helper exit 3 writes no set | transcript with no tool calls → set present with `files: []`, no card |
| `transcript_path` guard removed | empty path writes nothing |
| freshness predicate dropped | fixture built at a non-ancestor sha writes nothing |
| `compact-card-off` ignored in any arm | card + set absent; no fourth subject served with a card on disk; hookstate `compaction` unchanged and no journal line after a PostCompact |
| `compact-steer-off` ignored | card yes, stdout `''`, set `steered:false` |
| SessionStart step 2 dropped | `source:"compact"` with a set naming a transcript other than the resolved one → the card stays on disk and no fourth subject is printed; the same with no set at all |
| `scope` not carried | after a subagent-scoped compaction, hookstate `compaction.scope == "subagent"` and the journal line carries `agent` and `transcript` |
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
| journal not appended / set not deleted | line count and file presence |
| `carried` mining dropped | a window holding only a previous summary that names two files → set has both, tagged `carried` |
| `compaction` reset on resume, or not reset on clear | reset-boundary tests mirroring D-1248's |
| PreCompact cost unbounded | absolute p95 budget on the fixture (node startup + tiny graph), load caveat as the existing tests' |
| compact SessionStart with a card slows | the existing 4× ratio test, with the card present |

**Helper** (`server/test/compact-card.test.ts`, importing the `.mjs`): backwards boundary scan, the
literal-in-a-body false positive, the 64 MiB cap realigned to a line, tag and token mining, exact and
unique-suffix resolution with `ambiguous`/`outside`/`nomatch` counts, ranking, card format, `(+k files
not shown)` on any drop, the ceiling, `measure` normalisation, every exit code.

**Installer/deploy**: `deploy.sh` ships the helper by `install_atomic` beside the hook (pinned like the
hook's own line); `install-session-hooks.sh` unchanged — the derived wiring test stays untouched.

**Wire and console** (one row per §3.6 hop):

| mutation | expected red |
| --- | --- |
| reviver folds absent and malformed | a malformed-member fixture must throw `Malformed`; an absent field must read `null` |
| assembly returns `undefined` | `fleet.ts` fixture without hookstate → `compaction === null` |
| `reviveFleetSession` widens instead of returning a literal | the fixture-builder compile check; a malformed persisted object must throw `MalformedSnapshot` |
| `compactionInfo` returns a partial object | a frame with `chars: "17k"` reads `null` |
| chip renders `cites` with `setSize` null | session-line test |
| a second `CompactionMeas` declaration | `single-definition.test.ts` holder pin |

## 6. Rings, invariants, and the one amendment

- **Rings.** `compact-card.mjs` is a deploy-side node script (the `shared/mark.mjs` class: `node:*`
  only, never bundled). `CompactionMeas` is L0. The hookstate reviver is the L3 adapter and may not
  narrow a distinction it received — hence null-vs-0 on `cited`/`setSize`/`filesChars`, and `Malformed`
  rather than a folded object.
- **Wire discipline.** Additive; `FLEET_PROTO` 1; one tolerant reader per field; `reviveFleetSession`
  literal.
- **The hook's standing contract** (exit 0 on every path, atomic writes, no network, no locks, no
  waiting) is unchanged. The helper runs under `timeout`; every call site is `|| true`-shaped.
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
   clip's status as the only defence for `GM_NODES`, which this design nearly removed; and the
   `agent_type` guard the approved design carried and the measurement removed (§0.2, §3.0) — a deviation
   from an approved design is numbered so nobody re-derives the guard.

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

- Extension-less files are invisible to shell-text mining (11 of 820 here).
- The failed-compaction window in §4.
- The background-subagent misattribution of §3.0: bounded, visible in the journal, measured on the first
  live corpus; the fix, if the number asks for one, is a card file per transcript and a second suffix
  shape in `_reg_purge`.
- 2 of 24 live processes already run 2.1.267, which no binary fact here was read from; the first live run
  of Plan A on such a session is the check, and the payload measurement of §0.2 (the three key sets, one
  subagent compaction, and the subagent transcript's location) is repeated on it.
- If Anthropic enables precomputed compaction reuse on this fleet, stage 2 forfeits it; `steered` and the
  journal make that visible before it costs anything.
