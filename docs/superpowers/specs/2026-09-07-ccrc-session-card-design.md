# The ccrc session card — telling a session what ccrc already knows about it

**Status:** design, awaiting operator review. No implementation.
**Date:** 2026-09-07
**Slice:** R7 (tell-only). Enforcement is explicitly NOT in scope; see §2.
**Deploy lane:** AGENT-FIRST (`ccd/session-hook.sh`).

---

## 1. The problem, measured

ccrc's session-hook is a **one-way sensor**. It is wired to ten Claude Code hook
events in every rostered HOME and it is the only ccrc code a session executes
inside its own workspace. Nine of its ten arms are pure bookkeeping; facts flow
one direction only — *session → hookstate → server → PWA → the operator's phone*.

Nothing flows back down. The single exception is graphify's SessionStart card,
and graphify is not ccrc.

The consequence is visible in the corpus itself. `ccd/worker-skill/SKILL.md`'s
frontmatter names the hold file as its own trigger:

> "…or when this workspace's hold reads `program:<slug> wave:N/M` and you are
> not the session that opened the run."

A grep of both skill directories for `.hold`, "hold file", or the registry path
returns **zero hits**. The corpus declares a trigger and never says where the
file is, and no session is ever shown it.

### 1.1 The fleet as measured

Measured on the fleet host on 2026-09-07 (the census drifted twice during the
investigation — **do not quote these as stable**; re-measure before the reading):

| | |
|---|---|
| registry rows | 23 |
| archived | 6 |
| rows with a live pane | 17 |
| rows carrying a `.hold` | **2** |
| rows with at least one co-tenant | **16 of 17** |

By project: ccrc-pwa 7, custom-tools 3, MekWarLive 2, intake-platform 2,
expoAI-assistant 2, rp-llm 1. Both held sessions *also* have co-tenants, so the
two populations overlap and do not nest. Five of the hold-less are **main
checkouts**, which `ccd ws-hold` refuses outright (`ccd:5306` — *"nothing ever
auto-archives a main checkout, so a hold there is a lie waiting to confuse
someone"*), so the hold vocabulary is structurally inapplicable to them.

### 1.2 The falsification baseline

Taken by the orchestrator against the live server, `GET /api/claims?all=1`:

```
total claim rows ever: 34   distinct holders: 10
  ccrc-pwa 16 · expoAI-assistant 11 · MekWarLive 7
runId IS NULL rows: 0
live claims at the time of reading: 0
```

`POST /api/claims` accepts `runId: null` deliberately — `routes.ts:1886-1897` is
an explicit arm, not a fallthrough. **The programless claim is a first-class,
supported act that has never once been taken in the life of the table.** Every
claim ever made was by a session a coordinator had already mailed.

That zero is the baseline this design is measured against.

---

## 2. Scope, and the rulings that set it

Operator rulings, in the order they were given:

1. **All four stings ring true** — sessions ignore the coordination fabric;
   sessions don't know their own protocol; sessions don't use the ledger and
   registry; the operator is the scheduler.
2. **Tell-only, first.** SessionStart card, plus an adoption counter. **No deny
   gates.** Measure adoption, then decide whether enforcement is warranted —
   the graphify R4 → R5 sequence, where a measured near-zero earned the
   enforcement ruling.
3. **PRs #40 and #47 stay out of scope.**
4. **Both arms** — the card speaks to the 2 held sessions *and* to the
   co-tenant majority. Ruled on the 0-programless-claims baseline above.
5. **`CARD_MAX_CHARS`**, with the existing 600 left untouched (§4.4). Ruled at
   1200; **corrected to 1800 while writing the plan** — the 1200 was argued from
   a 906-character worst case that understated the held subject at ~125 chars,
   which was the co-tenant investigation's own shortened model rather than
   §4.2's actual 592-character text. The real worst live combination is 1363
   (§4.4), so 1200 would have truncated the co-tenant sentence on exactly the
   sessions that carry a hold.
6. **`ccrc-api claims list` gains the `all` query key** — one word, one test row.
7. **The hold moves above the `/clear` in `dispatch.ts`** (§4.2.1).

The statusline segment, originally in scope, is **cut from this slice** — see
§10.1. It is not tell-only in effect.

---

## 3. Architecture

The design adds one thing: **a return path at the hook**, so a session can read
the registry sitting beside it.

What bounds that path also defines it. `session-hook.sh:4-9`:

> "Runs on the HOT PATH of every tool call in every fleet session, so the
> contract is absolute: exit 0 on every path, write atomically or not at all,
> **no network, no locks, no waiting**."

`coord.db` lives on the *server* box. So the card can carry only what
`$HOME/.cc-sessions/` proves locally. That rules out — permanently, not pending
work — run state, program state, coordinator identity, mail presence, and
whether a brief was ever sent. Every sentence whose truth lives in coord.db is
phrased as a question with `ccrc-api runs list` named as its arbiter.

Two provable subjects remain, and the design is those two:

| subject | reaches | proves | cost |
|---|---|---|---|
| **HELD** — quote `<id>.hold` | 2 of 17 | a claim on this workspace | 1 read, 0.02 ms |
| **CO-TENANT** — count rows naming the same project | 16 of 17 | who else is in this project | 3.5 ms p50 |

### 3.1 The two disciplines

Both subjects rest on the same pair, and almost every attack found against them
is defeated by discipline rather than by code:

> **QUOTE WHAT YOU MEASURED, NEVER NARRATE.**
> **GATE ON AN EXACT SHAPE.**

`divergence.ts` kind 3 (`claim-divergence`) *is* the held subject's failure
mode, already named, already typed, already swept. The hold has **no expiry by
design** (`2026-08-06-workspace-hold-programs-design.md:89-91`), is written by
**five actors with five different meanings**, and its bytes are
indistinguishable except by shape. `ccd` says it out loud at the one rung that
refuses a hold on a main checkout: *"a hold there is a lie waiting to confuse
someone."*

---

## 4. Components

### 4.1 One emit, or both cards die

`_hook_graph_card` becomes a **builder** that sets `CARD_GRAPH` instead of
emitting. `_hook_hold_card` and `_hook_ccrc_card` set their own strings. One
site joins and emits.

This is not tidiness. Claude Code parses hook stdout beginning with `{` as **one
whole JSON document**. Two well-formed envelopes throw (`Unexpected
non-whitespace character after JSON at position 80` — reproduced), and the
multi-document tolerance forgives only output where *every* line fails, which
two valid cards do not. The caller returns `{answer:{}}`.

That is not "the new card is dropped". It is **no `additionalContext` at all**,
so the shipped graphify card — which worker clause 12 instructs sessions to
weigh — stops arriving fleet-wide, on every SessionStart source, with a warning
that misdiagnoses it. The warning string is verbatim in the shipped binary:

> `Hook output looks like a JSON object but is not valid JSON … Emit the payload
> with a JSON encoder (jq, ConvertTo-Json, json.dumps) rather than string
> concatenation`

The existing suite cannot catch it: `grep '\.hold' server/test/session-hook.test.ts`
returns nothing, so a hold-conditional second emit would ship with all 20
`card()` tests green.

The refactor is also required for a second, independent reason:
`_hook_graph_card` returns early at `:274` (no cwd, or a cwd that is not a
directory) and `:288` (no census row). A co-tenant subject riding inside it
would inherit both gates, and neither has anything to do with co-tenancy, which
is a registry fact rather than a tree fact.

### 4.2 The HELD subject

Gated on one bounded, anchored match against `holdReason`'s exact shape
(`rundefs.ts:90-93`). The gate extracts nothing; it decides only which sentence
to say.

**Case A — dispatched shape** (` run:<digits>` present, not archived, cwd inside
the workdir):

> ccrc-program: this workspace is claimed — `~/.cc-sessions/<id>.hold` reads
> `program:account-pools wave:3/6 run:34`, which is the `ccrc-worker` skill's
> declared trigger. Run that skill; its first read is
> `~/.local/bin/ccrc-api mail list --to <id>`, and a brief you already acked is
> not listed again — the plan it named is the durable record. The hold is
> written by the ccrc server and can outlive the run that wrote it: whether that
> run is still open, and whether any brief was sent, are answered only by
> `~/.local/bin/ccrc-api runs list`, never by this file.

**Case B — no `run:` suffix.** Two producers reach it: `close.ts:302-305`'s
anticipatory `holdReason(program, wave+1, waveOf, null)` for a run that does not
exist yet, and the hand hold `ledger-template.md:3-5` still instructs. The text
says outright: *"It names NO run: a close claimed this workspace for a next
wave, or a human wrote it by hand — no dispatch placed it."*

**Case C — bytes fail the shape.** **Silence.** An operator's free-text hold is
not a program claim, and `POST /api/sessions/:id/hold` validates only
non-blankness (`server.ts:2004-2032`). This single ruling also closes the
ANSI-injection, newline and oversize-slug hazards structurally: a string that
fails the bound is never rendered.

**Case D — present but unreadable** (a directory at that path, mode 000, empty).
Its own sentence, because collapsing absent with unreadable is the repo's named
"overloaded null at a seam" defect. `-e` not `-f`, matching all four of ccd's
hold readers, whose stated rule is *doubt reads as HELD*.

**Case E — archived with a standing hold.** Live on this box:
`data-internal-still-prairie`, stamped `archived=… reason=merged:#160`, with a
live pane. The card calls those bytes *"the residue of a claim, not an
assignment"* and drops the worker imperative entirely.

**Case F — cwd outside the workspace.** The graphify subject measures the
payload's `cwd`; the program subject measures the tmux session id. When they
disagree the card names the workspace by path and drops the demonstrative,
because otherwise "this workspace" and "this tree" are two subjects in one
string.

> **Amended by the fix wave (C1) — this section specified an ungated field, and
> that was the spec's own defect.** Case C rules that a string failing its gate
> is never rendered, and §4.2's hold bytes carry a shape gate *and*
> `CCRC_HOLD_MAX` for exactly that reason. The workdir this case interpolates
> was given **neither**, though it is the same kind of value: registry text
> reaching a model's context verbatim, in a file any session on this box can
> write (one UNIX user, `ccd` has no caller auth). Two consequences, both
> reproduced against the shipped file. **(a)** `_ct_read` caps at
> `CCRC_ID_MAX` (128), so a cwd EXACTLY EQUAL to a longer workdir compared
> unequal to its own truncated reading and the card asserted a directory
> disagreement that does not exist beside a path that does not exist — the
> precise truncation hazard `CCRC_HOLD_MAX=127` was invented for, applied to one
> field and not its sibling. **(b)** Backticks, newlines, ANSI escapes and
> instruction-shaped prose landed verbatim in `additionalContext`, re-injected
> on every compaction for as long as the hold stood. This card is the first
> mechanism in the tree piping another row's registry bytes into a peer
> session's model context; before it, registry bytes flowed session → server →
> PWA → a human.
>
> **Ruled: the workdir takes the hold's treatment.** `CCRC_WD_CLASS`
> (`CCRC_PROJ_CLASS` with `/` **prepended** — appended, the class's trailing `-`
> would fall mid-class and spell the reversed range `_-/`) as a `case` glob, and
> `CCRC_WD_MAX` = `CCRC_ID_MAX - 1`, derived so the off-by-one is a mechanism
> rather than a second literal. On failure `wd=""`, which restores the plain
> demonstrative — **silence over a false claim**, the same ruling Case C makes.
> The cost is accepted and named: a genuine disagreement whose workdir is
> unspeakable now reads as "this workspace", because a card that cannot measure
> the disagreement must not assert one.

#### 4.2.1 The wave-lateness defect, and its fix

`dispatch.ts` sends the `/clear` at `:533` and writes the hold at step 5,
`:550-556`. So the SessionStart that `/clear` triggers fires **before** that
wave's hold exists: wave 1 sees no hold at all, and wave N sees **wave N−1's
bytes**.

Under this design's own discipline that is a defect, not a rounding error. The
card never claims currency — it says the hold *"can outlive the run that wrote
it"* and names `runs list` as arbiter — so the stale reading is disclosed rather
than asserted, and any *later* SessionStart within the wave (a compaction, a
resume) reads correct bytes. But the moment the card is most wanted is the one
moment it is reliably stale.

**Ruled (operator, 2026-09-07): move the hold above the `/clear`.** This is a
coordination-path change inside a tell-only slice and is recorded here as such.
The existing order already carries the hazard it appears to guard against — a
failed `ws-hold` returns before the transaction with the `/clear` already sent.

### 4.3 The CO-TENANT subject

**The prescribed act is `peers list`, not `claims take`.** One call, no body, no
`whoami`, mutates nothing, cannot wedge anything — and its 200 carries
`PEER_ETIQUETTE` verbatim from its declared primary home (`shared/api.ts:5615`),
whose **rule 0 is**:

> "Claim before you edit: POST /api/claims names every path you will touch,
> all-or-nothing, and a 409 names the holder — the 409 is the address, not a
> rejection to work around."

So the card stops paraphrasing the protocol and points at the route that
*delivers* it. That closes the bootstrap gap instead of talking around it.

Three further reasons this spelling and no other:

- Prescribing `claims take` would push 16 sessions toward a wedge.
  `pathsOverlap` is exact-match **and** directory-prefix containment both ways;
  `decideClaim` is all-or-nothing; `claimAttempt` never consults `runId`, so
  there is **no precedence rule** and an ad-hoc claim can beat a program
  worker's claim to the same paths, with clause 11 telling the loser to mail a
  peer and wait. Measured on this repo's last 40 merges: concurrent PRs collide
  on an exact file **44%** of the time and on a directory **93%**.
- An ad-hoc claim is released by nothing — not a run close
  (`releaseClaimsForRun` is keyed on runId), not an archive, not any alarm — and
  `POST /api/claims/:id/break`, the corpus's named release valve, **has no
  client at all** (§10.3).
- It is the only spelling that stays green against `claims-advisory.test.ts`,
  whose FORBIDDEN scan makes rule 0 literally unquotable inside the hook file.
  The hook names the **client verb**, never the route. Measured against the
  patched file: 0 hits.

**The wording is the literal predicate**, because three of the four
load-bearing words in "N other live sessions share this project" are unsayable
from the registry:

- *live* — `_swap_beat` (`ccd:13517`) re-stamps `.supervised` through a whole
  `cp -a` carry, on purpose. Measured: 6 of 16 rows silent over 5 h, 5 over
  18 h, one at 37.9 h, every one of them reporting `deliverable:"yes"`.
- *share* — the seven ccrc-pwa rows resolve to seven distinct workdirs on six
  distinct branches. They share a registry string and not one byte on disk.

What ships (154–177 chars across all speaking sessions):

> ccrc: 6 other supervised rows name project `ccrc-pwa`;
> `~/.local/bin/ccrc-api peers list --of ccrc-pwa-clear-river` names them and
> returns the five peer rules.

Singular at N=1 (`other supervised row names`). `at least N` when any peer was
unmeasurable. **Silence** on: no co-tenants; unreadable registry or own
`.project`; underivable project; project bytes failing the shape gate;
kill-switch present.

A **main checkout gets the identical sentence**. `.workspace` is never read, and
that is deliberate: `claude-ccrc-pwa`'s workdir shares no more bytes with its
six peers than they share with each other, so there is nothing measurably
different to say. This is also the case that makes CO-TENANT strictly wider than
HELD — for the five main checkouts, co-tenancy is the only thing the card can
truthfully say at all.

**The predicate, exactly:** trimmed `.project` equality — reproducing the
server's `field()`'s `content.trim()` (`registry.ts:333`) — plus `.supervised`
present, numeric, and `now − s ∈ [0, 120)`, which is `_session_state`'s own line
(`ccd:1792`) including its `>= 0` clock-skew guard. **Never `.archived`.**
`peers.ts:72-76` (D9) says the peers route *"does NOT filter on .archived …
archivedAt is reported verbatim and decides nothing"*; filtering on it here
would reproduce in the hook the exact lie the server refuses to tell.

### 4.4 The emitter's clip, and the 600

`set -- "${1:0:$CARD_MAX_CHARS}"` as the **first statement** of
`_hook_emit_context` — the one site every subject passes through, so no future
subject can forget it. `CARD_MAX_CHARS=1800`.

The existing `toBeLessThan(600)` is **left untouched and green**. Three
measurements say it is not the ceiling it looks like:

1. It lives inside `it('clips a pathological census reason instead of injecting
   it whole')` (`session-hook.test.ts`), which plants no graph and therefore
   drives the **census** arm, whose worst case is 532 — and that arm is empty on
   this fleet (0 trees carry a sweep reason; longest ever retained, 75 chars).
2. Its own failure message names what it is for — *"an unbounded repo-controlled
   string reached the session"* — so it is a **taint bound on `.reason`**, not a
   context budget.
3. On the same compact SessionStart, the neighbour hook
   `~/.cc-handoff/restore.sh` emits its own envelope capped at 24576 bytes, 41×
   larger.

The real numbers, which every prior estimate got wrong: **the live graphify card
measures 570–593 characters, not 537**, because no repo-tree fixture plants
`~/.ccrc/graphify.pin` and the hook reads it from `$HOME` (`:163`, appending
` (pin 0.9.9)` = 12 chars). Real headroom under 600 was **six characters**.

The worst live three-subject combination is **1363**, not the 906 first
computed: graphify 593 + §4.2's held case A at **592** + co-tenant 176 + two
joins. The 906 came from the co-tenant investigation modelling the held clause
at ~125 characters — its own shortened sketch, since it was instructed not to
redesign the held arm — and the two halves' budgets were never reconciled until
the plan was written. `CARD_MAX_CHARS=1800` clears 1363 by 32% and is 7.3% of
the 24576 bytes the neighbour hook already emits on this event. At 1200 the clip
would have truncated the co-tenant sentence on exactly the two sessions that
carry a hold — the sessions the held subject exists for.

The bound was fiction in the other direction too: the shipped hook was made to
emit **3,570 characters** with no ccrc card at all and every suite green,
because `GM_NODES` takes unbounded digits off a 4096-byte head — falsifying the
hook's own comment at `:296-298` that each field is bounded at the read.

### 4.5 The counters

Two counters, attributed apart by **disjoint verb pairs**:

```
CCRC_PEERS_RE='(^|[;&|[:space:]])peers[[:space:]]+list([[:space:]]|$)'
CCRC_CLAIMS_RE='(^|[;&|[:space:]])claims[[:space:]]+take([[:space:]]|$)'
```

Anchoring on the **verb pair and not the client name** is a measured decision,
not a preference. Both skills set `API="$HOME/.local/bin/ccrc-api"` and then
call `"$API" peers list`, while the hook reads `.tool_input.command` — the
**unexpanded** shell text. A counter anchored on `ccrc-api` scores **0** on the
spelling the fleet actually uses. The leading character class stops `speers
list` and prose; the trailing one stops `peers listing`.

The PostToolUse prefilter is widened on **two-word phrases**, never single
words. Measured: a payload containing the word `mail` in a path costs 28.8 ms
patched against 28.7 shipped — no extra fork; a single-word `*claims*` prefilter
measured 42 ms against 33.

Both new fields sit in the **middle** of the carry read-back, never after
`subs` — D-1249's positional rule — and it remains one fork. `hs_unreadable`
still probes `gq`, the first numeric line, and must not be changed.

`server/src/hookstate.ts` needs **no change**, and that is measured rather than
assumed: `readHookStateMeasured` validates named keys and returns an object
literal built from those names, with no `Object.keys`, no `additionalProperties`
check and no key census. An unknown key is never looked at. This is the R6
precedent — PR #58 added a whole new emitter and changed no wire field.

### 4.6 The kill-switch

`~/.ccrc/ccrc-card-off`, one `[ -e ]` at the top of the builder, the
`GRAPH_GATE_OFF` shape exactly (`:352`). Three lines.

Bash re-reads the hook on every invocation, so `install_atomic` makes the card
live on ~17 sessions at the speed of their next compaction, `/clear` or resume —
and compaction fires SessionStart **mid-turn**, which is when a bad card does
the most damage. Without the file, rollback is a full agent-lane redeploy on a
reverted tree. With it, rollback is a `touch` from a phone.

---

## 5. Data flow

```
SessionStart payload ─┐
                      ├─→ _hook_graph_card  → CARD_GRAPH   (builder, emits nothing)
$REG/<id>.hold ───────┼─→ _hook_hold_card   → CARD_HOLD    (builder)
$REG/*.uuid ──────────┤
$REG/*.project ───────┼─→ _hook_ccrc_card   → CARD_CCRC    (builder)
$REG/*.supervised ────┘
                           └─→ join → _hook_emit_context → ONE line
                                        │
                                        └─ set -- "${1:0:$CARD_MAX_CHARS}"
```

One direction, one hop, no network. Everything said is either bytes quoted or a
count under a named predicate.

### 5.1 Cost

Measured on the fleet host, shipped hook against a fixture HOME with a stub
tmux — the harness shape `server/test/session-hook.test.ts` uses:

| arm | p50 | p95 |
|---|---|---|
| PostToolUse (Bash `ls`) — the only arm the repo times | 31 ms | 39 ms |
| SessionStart, shipped, fresh graph | 72–79 ms | 88–90 ms |
| SessionStart under a load spike | — | **146 ms** (allowance 150) |
| the co-tenant probe alone, in situ, cold, at load 14 | **3.54 ms** | **5.24 ms** |
| SessionStart end-to-end delta, tightly paired | +4.4 ms | +1.5 ms |

Two traps that only appeared under cold-process measurement, both of which a hot
200-iteration loop hides:

- **`v=$(_helper)` costs 61.9 ms.** Command substitution forks a subshell even
  around a shell function. The read helper must set a global.
- **Bounded regex repetition is expensive.** `[[ $x =~ ^[A-Za-z0-9._-]{1,128}$ ]]`
  costs 13.1–18.5 ms over 23 evaluations; the same class with `+` costs 1.2–4.1;
  `case` plus `${#x}` costs 1.4–2.2. That one substitution took the probe from
  17.4 ms p50 to 3.5.

Reference points, 50–200 iterations each: `$(<file)` 0.020 ms · `read -r x < file`
0.028 ms · `h=$(cat file)` 3.05 ms · `jq -cn` 5.93 ms · `git rev-parse HEAD`
3.26 ms · `tmux display-message` 4.35 ms.

---

## 6. Error handling

Every failure is silence or a named condition — never a confident wrong
sentence.

| condition | answer |
|---|---|
| no co-tenants | **silence** — the true answer for a lone row |
| registry or own `.project` unreadable | **silence** |
| project bytes fail the shape gate (`[A-Za-z0-9._-]`, ≤64) | **silence** |
| kill-switch present | **silence** |
| *some* peers unmeasurable | `at least N` — the count is a floor, said as one |
| hold bytes fail `holdReason`'s shape | **silence** on the program subject |
| hold present but unreadable | its own sentence — *doubt reads as HELD* |

Three mechanics, each a defect found by measurement:

- **The read helper returns three codes** — 0 read, 1 absent, 2 unmeasurable.
  Absent and unreadable are two conditions a caller handles differently; that is
  D-114's rule (`readFileMeasured`) transcribed into bash, and it is what lets
  "some peers unmeasurable" say `at least` instead of quietly undercounting.
- **Never `$(<f 2>/dev/null)`.** It parses as a null command with redirections
  and returns the empty string, silently converting unreadable into absent. The
  guard is `[[ -e ]]` then `[[ -f && -r ]]`, with `-f` excluding the directory
  shape `-r` admits. Without it, one mode-000 `.project` prints `Permission
  denied` into the harness from every co-tenant session on every SessionStart.
- **Trim before the gate.** `field()` does `content.trim()`; bash `$(<f)` strips
  trailing *newlines* only. One trailing space in a `.project` file would split
  the hook's grouping from the server's silently, with a plausible number on
  both sides.

---

## 7. Testing

Roughly 14 new `it()` rows in two new describes. Mutation-table discipline: no
guard without a test that reds when the guard is mutated.

**Every existing test stays green, byte for byte, untouched.**
`session-hook.test.ts`'s `beforeEach` creates an empty `.cc-sessions` with no
`.uuid` rows, so the co-tenant subject lands on the silence arm in all 20
existing `card()` assertions. Verified by running the patched hook against a
replica of that fixture: the census arm emits 532 characters, byte-identical to
shipped, still containing `failed`.

| test | mutation it kills |
|---|---|
| `emits exactly one parseable line when a hold is present` | the second-emit shape |
| `counts an archived row whose supervisor is still beating — the archive stamp decides nothing (D9)` | filtering on `.archived` |
| `a trailing space in .project groups exactly as the server does` | deleting the trim expansions |
| `an unreadable peer .project costs no stderr and is reported, never folded into absence` | folding rc 2 into rc 1 |
| `a directory at a registry path is not read` | `-r` without `-f` |
| `the card never claims liveness or shared files, and always names the route that can` | rewording toward "live sessions share" |
| `the co-tenant subject survives a tree graphify says nothing about` | riding inside `_hook_graph_card` |
| `the hook, ccd and shared agree on the supervised-freshness window` | drift in the third copy of `SUPERVISED_FRESH_MS` |
| `clips the assembled card at the emitter, on every arm` | removing the clip |
| `a pathological hold cannot delete the card` | ditto, at 200,000 bytes |
| `counts the spelling the fleet actually uses, not the one it reads` | anchoring on `ccrc-api` |
| `p95 of 20 SessionStart runs stays under the budget with a 200-row registry` | reverting the `case` shape gate to `{1,128}` |
| `the operator file silences the subject and nothing else` | removing the kill-switch check |

`claims-advisory.test.ts`'s existing
`it('ccd/ccd and session-hook.sh carry ZERO claims-API references')` stays
**unchanged and green** against the patched file — measured, 0 hits. That is the
structural reason the card names the client verb and never the route.

`CCRC_FRESH_S=120` is a **third** copy of `SUPERVISED_FRESH_MS`
(`shared/api.ts:1677` = 120_000; `ccd:1792` = `< 120`), and
`single-definition.test.ts`'s roots are `shared`, `server/src`, `pwa/src` and
`agent/src` — it does not scan `ccd/`, so nothing would otherwise catch the
drift. The local copy follows this file's own established precedent
(`_hook_epoch_ms` is a deliberate local copy of ccd's `_plat_epoch_ms`, with a
test pinning the two bodies identical), because the hook is installed alone into
`~/.cc-sessions` and can source nothing.

---

## 8. The effect measurement

Tests pin shape, not effect. A green mutation-proof suite can guard a mechanism
that does nothing.

### 8.1 The denominator, stated before the numerator

It is **not "sessions"**. The counter's unit is the **pane** — a subagent's tool
call increments the parent's counter, and the card reaches only the parent. And
a context is not a session: counters reset on every SessionStart whose source is
not `resume`. So the denominator is `coTenantN` summed **over a series**, and
the reading must be a series, never a snapshot.

Two structural blind spots the plan must state rather than discover:

- **SessionStart does not fire for subagents** (measured). A worker that runs
  its wave through subagents has subagents that never saw the card.
- **A wave-1 worker never sees the held subject** — a fresh `ws-add` spawn whose
  only SessionStart precedes the hold by construction (mitigated but not
  eliminated by §4.2.1).

The held subject's audience is the top-level context of waves ≥ 2 — honestly, 2
sessions today. The co-tenant subject's audience is 16, and does not depend on a
hold.

### 8.2 Baseline, recorded before the deploy

- **B0 — fix the carrier first**, then let it run one full day. Expect 24
  readings; measured today, broken: **2 of 12 cron fires landed**.
- **B1 — the falsification.** `ccrc-api claims list --all 1`, reporting rows /
  programless / holders / projects. **Baseline: 34 / 0 / 10 / 3.** Requires the
  one-word client change (§2 ruling 6).
- **B2 — the instrument's pre-deploy signature.** Measured today with a
  corrected carrier, read-only:
  `{"queriesToday":49,"denied":5,"zeroQuery":3,"peerRead":0,"claimed":0,`
  `"nullPeerRead":23,"heldN":2,"coTenantN":16,"liveN":18}`.
  **`nullPeerRead: 23`** — every row, no field — is what proves the hook has not
  shipped. Its fall to 0 is what proves it has.
  (`liveN:18` against §1.1's 17 is the fleet drifting between two readings taken
  minutes apart, not a discrepancy — which is exactly why the reading is a
  series and why §1.1's census must be re-measured rather than quoted.)
- **B3 — the server-load baseline**, because this card's act is expensive:
  `GET /api/peers` measured **1.71–2.15 s** wall (it runs `assembleFleet`)
  against **0.11–0.40 s** for `GET /api/claims`.
- **B4 — the deploy fingerprint:** `diff <(git show origin/main:ccd/session-hook.sh)
  ~/.cc-sessions/session-hook.sh`.

### 8.3 The reading

At 7 days **or** after three wave dispatches, whichever is later — not 48 hours;
at this fleet's wave cadence a 48-hour number measures the cadence, not the
mechanism.

Reported in the D-1613 format, with `null` called out separately from `0`:
*"`ccrcPeerReads` 0 in N sessions, ≥1 in M, `null` in K (no SessionStart since
the deploy)"*.

**Both directions must be readable.** "It worked" is readable off the claims
table and the peer-read counter. "It flooded" is **not**, unless the denominator
is captured session-side — a claim *conflict* leaves no trace anywhere: the 409
arm writes no row, emits no feed event, records no lifecycle event, sends no
push, and the server runs `Fastify({ logger: false })`. Only the winner of a
contest gets a durable artefact. The attempts-to-grants ratio is the conflict
rate, and attempts exist only in the hook counter.

The flood reading also watches B3: the card points 16 sessions at a ~1.9 s
single-process server operation, which dwarfs the 3.5 ms the hook pays.

---

## 9. File census and deploy

**This slice — agent lane** (ships to the fleet host first; the server reads
what the hook writes):

- `ccd/session-hook.sh` — 739 → ~945 lines, 11 hunks. The emitter clip; the
  builder refactor; the two card builders; the constants; the counter prefilter,
  regexes, carry lines, guards, reset and increments.
- `ccd/ccrc-api` — one word at `:110`: `…|no|project` → `…|no|project,all`.

**This slice — server lane, tests and one source change:**

- `server/test/session-hook.test.ts` — the ~14 rows in §7, two new describes.
  `beforeEach` unchanged.
- `server/src/coord/dispatch.ts` — the hold/`/clear` reorder (§4.2.1), with its
  own test.

**This slice — no lane** (operator plumbing, hand-installed, outside every
checkout):

- `~/.local/bin/graph-gate-snapshot` — the `|| echo 0` fix, the registry pass,
  the new per-session fields and roll-ups. **Ship this before the card**, and
  let it run one clean day, or B0 has no baseline.

**This slice — docs:** `README.md` (the SessionStart-card section gains both
subjects, the kill-switch and `CARD_MAX_CHARS` — precedent: PR #58 touched
README for R6), and the implementation plan with its `## Deviations found`
ledger.

**Deviation numbers:** none are allocated or defined by this spec. Every `D-N`
in the plan must be **issued** by `POST /api/ledger/deviations` and defined in
the same act.

### 9.1 Implementation prerequisite

`ws/clear-river` is **2 commits behind `origin/main`**, and its
`ccd/session-hook.sh` is 644 lines against origin's 739 — missing R6 and pools
2a. An agent-lane deploy from this tree would silently revert both across 17
live sessions. **Branch from `origin/main`.**

---

## 10. Out of this slice

### 10.1 The statusline segment — cut, and why

Originally in scope. It is **not tell-only in effect**: the statusline row sits
inside the `tail -8` window `_auto_swap_check` feeds to `_pane_hard_blocked`,
whose pattern includes `rate limit(ed| exceeded| reached)?` and
`out of (usage|credits)` — and `POST /api/runs` accepts any non-blank `program`.
A program so named would take the IMMEDIATE-RESCUE branch and `_dispatch_swap`
the session **mid-wave**. That is a lifecycle mutation reachable from a value
nothing validates.

It also costs a `tmux display-message` fork per render on a ~300 ms debounce
path already measured at ~106 ms per render across ~20 sessions, because the
payload carries no ccd id.

If it is wanted, it needs its own slice with the sanitiser landing first and a
cross-surface test feeding the real script's real output to both
`parseStatusline` and ccd's `_pane_ctx_pct` / `_pane_hard_blocked` — a seam no
test in the repo crosses today.

### 10.2 The hold-less broadcast — superseded

A standing "you are a ccrc fleet session" line is legal (D-1245's grounds were
ownership and scope-mismatch; the hook is an artifact ccrc owns whose output
varies per session) and still wrong: to a session with no hold, no mail and no
claim it is *"an answer to a question nobody asked"* — the hook's own words for
that failure. The co-tenant subject replaces it with a measured fact.

### 10.3 Pre-existing defects this work surfaced but does not fix

- **`POST /api/claims/:id/break` has no client.** It is one of the four ungated
  operator valves and is reachable from nothing that ships: `ccrc-api` omits it
  deliberately, and `pwa/src/lib/api.ts:631-639` exposes only `claims()` with a
  docstring saying the break door is *"deliberately unnamed"*. Unwedging N
  claims today is N hand-built raw POSTs. The kill-switch file is what lets this
  slice ship without waiting on it.
- **`.hold` has no length cap at either write door** (`server.ts:2022-2024` and
  `ccd:5304` check type and blankness only) while `--actor` on the same verb is
  capped at 512. `CARD_MAX_CHARS` stops the card vanishing; it fixes nothing
  retroactively.
- **`allClaims()` / `claimsForProject(…, true)` have no LIMIT** while four
  sibling reads clamp — measured at 180 ms and 4.1 MB at 20k rows. It is also
  the read B1 depends on. `HotFilesStrip`'s open list has no cap either.
- **`install_atomic ccd/session-hook.sh` is `deploy.sh:629`**, 51 lines and 8
  remote round-trips before the `stamp_build` gate at `:694` that the
  neighbouring comment argues nothing may precede — so a failed build leaves the
  new hook live on ~17 sessions with `build.json` naming the old sha.
- **The shipped hook leaks 198 bytes of stderr** (`rm: cannot remove … Permission
  denied`) when `~/.cc-sessions` is unwritable, from the hookstate write path.
  Reproduced on the shipped file. The new probe adds zero stderr in all 21
  fixtures.

### 10.4 Explicitly not built

`FLEET_PROTO` stays at 1 — the counters are additive and a bump is forbidden.
The hookstate envelope's `v` stays 1: a `v:2` writer deployed agent-first would
blind the server to every session on the fleet until the server lane shipped.
No CLAUDE.md is written, per the 2026-09-02 ruling. No account-name list enters
any shipped source file. No new ccd verb.

---

## 11. Prior art

The graphify sequence is this design's template and its warning:

- **R1** shipped a SessionStart card.
- **R4** added `graphQueries` and measured the effect: **4 queries fleet-wide,
  10 of 18 sessions at zero.** "The card and clause 12 moved nothing the counter
  could see."
- That measured zero earned the **R5** enforcement ruling and its PreToolUse
  deny gate; **R6** added the Read nudge.

This slice is R7's R1-and-R4 in one step: ship the card *and* the counter
together, so the ruling on enforcement is made against a number rather than an
argument. R6 shipped tell-only with no counter and is unmeasured today.

---

## 12. Verification status

Verified personally by the author of this spec, against the live tree and box:
the claims-table baseline (§1.2); `runId: null`'s explicit arm; the two-envelope
parse failure and the warning string in the shipped 2.1.263 bundle; the
`graph-gate-snapshot` reproduction; the `dispatch.ts` hold/`/clear` ordering
(§4.2.1); the 600-cap's real subject (§4.4); `PEER_ETIQUETTE`'s five rules
(§4.3); the worktree staleness (§9.1).

Everything else — the timing tables, the fleet census, the fixture replays, the
merge-collision rates, the character counts — was measured by the investigation's
agents on this box and is cited with its method. Where a number could not be
measured it is named as unmeasured rather than estimated.
