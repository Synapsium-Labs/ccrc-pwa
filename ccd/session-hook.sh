#!/usr/bin/env bash
# session-hook.sh — Claude Code hook → ~/.cc-sessions/<id>.hookstate.json
#
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network, no locks, no waiting. A hook that can slow or break a
# session is worse than no hook. Consumed read-only by the ccrc server via
# the agent (whitelist: .cc-sessions is readable; nothing here needs a
# grant). Non-fleet sessions (no tmux, foreign session name) exit silently.
set -uo pipefail

# ── epoch milliseconds, on two userlands ────────────────────────────────
# `date +%s%3N` is GNU. BSD's date has no `%N`: it prints the literal letter,
# so the format answers `17876553263N` — not a number, which the `--argjson
# updatedAt` below rejects. `jq` then fails, the `|| exit 0` swallows it, and
# THE HOOK WRITES NOTHING. That is the worst shape this file can fail in: the
# server reads a session's state from this file, so every session on the box
# would read as unsupervised while looking perfectly healthy from the inside.
#
# `EPOCHREALTIME` is a bash builtin — no fork, no coreutils, same answer on
# both platforms (measured against `date +%s%3N` on Linux, to the
# millisecond). The separator is taken as either `.` or `,` because that field
# is formatted with the locale's decimal point. BUT the builtin is bash 5.0+
# and the declared floor is 4.4 — a 4.4 box takes the fallback, and on
# BSD the bare fallback answers the exact non-number described above. So the
# fallback VALIDATES, and degrades to whole seconds ×1000: millisecond
# precision lost, THE WRITE KEPT — the one trade this file's contract allows.
#
# This is a LOCAL copy of ccd's `_plat_epoch_ms`, and deliberately so: this
# file is installed on its own into ~/.cc-sessions and runs as Claude Code's
# hook, with no ccd around to source. A test pins the two bodies identical.
_hook_epoch_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local s="${EPOCHREALTIME%%[.,]*}" f="${EPOCHREALTIME#*[.,]}"
    f="${f}000"; printf '%s%s' "$s" "${f:0:3}"
    return 0
  fi
  local t; t=$(date +%s%3N 2>/dev/null)
  if [[ "$t" =~ ^[0-9]{13,}$ ]]; then printf '%s' "$t"; else printf '%s000' "$(date +%s)"; fi
}

# ── THE THREE ENVELOPES: R1's card, R5's deny, R6's nudge ─────────────────
# Claude Code reads a hook's stdout as a PER-EVENT CONTRACT — on SessionStart it
# is context to inject, on PreToolUse it is a permission decision OR context
# (`additionalContext`) for the call that proceeds — and those two events are
# the only ones this file prints on. Until D-1613 there was one printf and the
# rule was "the card, and nothing else, ever"; now there are three builders,
# each naming its own `hookEventName`, which is what stops a card being
# delivered as a decision or the other way round. A card that leaked onto
# another event would not be noise; it would be an answer to a question nobody
# asked. So this emitter is called from inside the SessionStart arm and nowhere
# else; `_hook_deny_json` (the gate, D-1613) and `_hook_nudge_json` (the Read
# nudge, D-1745) are BUILDERS called only inside a `$( )` from the PreToolUse
# arm, and whichever one the arm chose is printed from ONE site at the end of
# the file, after the hookstate rename lands (D-1689) — at most one line per
# event, never both. Every failure path in any of them prints NOTHING; this
# file's standing contract (exit 0 on every path, no network, no locks, no
# waiting) is unchanged. Every read below is a local file or a git ref.
_hook_emit_context() {   # <text> -> one JSON line on stdout, or nothing at all
  local j=""
  j=$(jq -cn --arg c "$1" \
    '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}' 2>/dev/null) \
    || return 0
  printf '%s\n' "$j"
}

# R5's emitter (D-1613). PreToolUse's own contract shape, built with `jq -cn` so
# a reason carrying backticks, quotes and an em dash is quoted by the tool that
# will parse it. A jq that cannot build it returns 1 and the caller says nothing
# AND counts nothing — the fail-open the whole gate is written under.
_hook_deny_json() {   # <reason> -> the deny envelope, one line; 1 when it could not be built
  # Called ONLY inside a $( ) capture: the envelope is printed to the hook's
  # real stdout at the very end of this file, after the hookstate rename has
  # landed, never from here (D-1689).
  local j=""
  j=$(jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny",
      permissionDecisionReason:$r}}' 2>/dev/null) \
    || return 1
  printf '%s\n' "$j"
}

# R6's emitter (D-1745). The SAME print site as the deny above — built inside
# a $( ) capture, printed at the end of this file after the hookstate rename —
# and the same fail-open: a jq that cannot build the envelope returns 1 and the
# caller says nothing. What it does NOT carry is a `permissionDecision`: this
# is `additionalContext` and the call proceeds. A `Read` is never denied, which
# is the ruling itself — `Edit` requires a prior `Read`, so a deny here would
# charge every session told to fix a named file one denial before its edit.
_hook_nudge_json() {   # <nudge> -> the nudge envelope, one line; 1 when it could not be built
  local j=""
  j=$(jq -cn --arg c "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse", additionalContext:$c}}' 2>/dev/null) \
    || return 1
  printf '%s\n' "$j"
}

# Measured for THIS session's tree, never for the fleet in general — the block
# this replaces asserted "this project has a knowledge graph" of every project
# the account ever opened, including the trees the sweep refuses.
#
# COST. `built_at_commit` is the LAST key of graph.json, which is 8 MB on this
# repo, so it is read with `tail -c 4096` and never by parsing the file. The
# node count comes off the head of GRAPH_REPORT.md's summary line (`head -c
# 4096`) — the sweep census carries no node count and manifest.json is a
# per-file hash map, so neither of the design's two named sources actually
# holds the number (D-1246). `git rev-parse` and `git rev-list --left-right
# --count` are ref reads. Any failure omits its clause; a total failure prints nothing.
# D-1368 — FRESHNESS IS CONTENT, NOT COMMIT IDENTITY. This file's ONE spelling
# of that predicate, asked by `_hook_graph_measure` below and nowhere else —
# and through it by BOTH readers, the card and the search gate (D-1613), which
# is why the measurement is a function and not two copies of a git call.
#
# `built != HEAD` was spent as "the graph is of another commit", and after a
# squash merge — or any rewrite that keeps the tree — that is false: HEAD's
# tree is byte-identical to the built commit's, so the graph describes THIS
# tree exactly. The card then said `not an ancestor of HEAD` about a graph
# whose content IS HEAD's; and `fresh` is the one word clause 12 of the worker
# skill says licenses taking a query answer as read, so the wrong answer here
# switches a dispatched worker's verification duty ON over a graph that needs
# none — the same trust the D-1353 direction spends, spent the other way.
# MEASURED on the live fleet 2026-09-03 (built 0281e084, HEAD 6a26a9a3,
# `rev-parse X^{tree}` identical for both).
#
# EITHER SIDE ANSWERING EMPTY IS NOT A MATCH: a garbage-collected built commit
# cannot be compared at all, and the caller falls through to the ancestry
# measurement, which answers `freshness unmeasured` for it. Staleness is
# measured or it is not claimed.
_hook_same_tree() {   # <tree> <built-sha> -> 0 iff built's tree == HEAD's tree
  local t="$1" bt ht
  bt=$(git -C "$t" rev-parse --verify -q "$2^{tree}" 2>/dev/null) || bt=""
  ht=$(git -C "$t" rev-parse --verify -q 'HEAD^{tree}' 2>/dev/null) || ht=""
  [ -n "$bt" ] && [ -n "$ht" ] && [ "$bt" = "$ht" ]
}

# ── ONE MEASUREMENT, TWO READERS (D-1613) ───────────────────────────────
# The R1 card and the R5 search gate ask the SAME question of the SAME tree,
# and freshness has exactly ONE spelling in this file (D-1368's rule, kept). So
# the measurement is factored out here and SETS GLOBALS rather than printing:
# the card renders them, the gate compares them against its bounds, and neither
# can drift from the other by an edit to one of them.
#
# THE RETURN CODE IS THREE-VALUED, deliberately — no overloaded null at a seam:
#   0  a graph is there and was measured (`GM_BUILT` may still be empty: an
#      unstamped graph is a MEASURED absence, and the gate reads it as one)
#   1  the tree resolved and carries no `graphify-out/graph.json` — the card's
#      census branch, which the gate has nothing to say about
#   2  no tree at all: no cwd anywhere, or a cwd that is not a directory
# 1 and 2 collapsed would hand the card a `$GM_CWD` it must not speak about.
_hook_graph_measure() {   # -> GM_CWD GM_BUILT GM_NODES GM_ENGINE GM_PIN GM_FRESH GM_BEHIND
  GM_CWD=""; GM_BUILT=""; GM_NODES=""; GM_ENGINE=""; GM_PIN=""; GM_FRESH=""; GM_BEHIND=""
  local tip="" lr="" ahead="" behind="" bcommit="" cwd=""
  cwd=$(jq -r '.cwd // empty' <<<"$payload" 2>/dev/null) || cwd=""
  # `$REG/<id>.workdir` is the registry's own durable answer, and the fallback
  # for a harness whose payload carries no cwd at all.
  [ -n "$cwd" ] || cwd=$(cat "$REG/$id.workdir" 2>/dev/null) || cwd=""
  [ -n "$cwd" ] || return 2
  [ -d "$cwd" ] || return 2
  GM_CWD="$cwd"
  [ -f "$cwd/graphify-out/graph.json" ] || return 1

  GM_BUILT=$(tail -c 4096 "$cwd/graphify-out/graph.json" 2>/dev/null \
    | grep -oE '"built_at_commit"[[:space:]]*:[[:space:]]*"[0-9a-f]+"' | tail -n1) || GM_BUILT=""
  # ONE CLAUSE DECIDES WHICH MATCH WINS, and it is `| tail -n1` above (D-1361).
  # `${GM_BUILT#*:}` takes the FIRST colon because the key it strips carries
  # none; the older `##*:` took the last, which silently re-implemented the
  # pipeline's last-wins decision inside the field split — two mechanisms for
  # one decision, and the effect was that `| tail -n1` could be deleted with the
  # whole suite green (measured), because on a two-match read the parameter
  # expansion went on quietly answering the right sha. Behaviour is unchanged
  # for every single match, which is every read `tail -n1` survives; what
  # changes is that the clause is now a mechanism a test can redden.
  GM_BUILT="${GM_BUILT#*:}"; GM_BUILT="${GM_BUILT//\"/}"; GM_BUILT="${GM_BUILT// /}"
  [[ "$GM_BUILT" =~ ^[0-9a-f]{7,40}$ ]] || GM_BUILT=""

  GM_NODES=$(head -c 4096 "$cwd/graphify-out/GRAPH_REPORT.md" 2>/dev/null \
    | grep -oE '[0-9]+ nodes' | head -n1) || GM_NODES=""
  GM_NODES="${GM_NODES% nodes}"
  [[ "$GM_NODES" =~ ^[0-9]+$ ]] || GM_NODES=""

  GM_ENGINE=$(head -c 64 "$cwd/graphify-out/.graphify_engine" 2>/dev/null | tr -d '[:space:]') || GM_ENGINE=""
  GM_PIN=$(head -c 64 "$HOME/.ccrc/graphify.pin" 2>/dev/null | tr -d '[:space:]') || GM_PIN=""

  # STALENESS IS MEASURED OR IT IS NOT CLAIMED. A tree with no git, or a
  # rev-list that will not answer, gets no freshness clause rather than a
  # "fresh" nobody checked — a session querying a graph 97 commits stale gets
  # confident wrong answers, which is the whole reason this clause exists.
  #
  # GM_BEHIND (D-1613) is the DISTANCE the word above is a rendering of, and it
  # is set ONLY where that word IS a distance — 0 for both fresh arms. It stays
  # empty for `not an ancestor of HEAD`, for `freshness unmeasured`, for a tree
  # with no git and for a graph with no acceptable stamp: four conditions
  # GM_FRESH still tells apart, and which the GATE treats alike because a graph
  # the card has already called not-this-tree's is not one to push a session at.
  tip=$(git -C "$cwd" rev-parse HEAD 2>/dev/null) || tip=""
  if [ -n "$GM_BUILT" ] && [ -n "$tip" ]; then
    if [ "$tip" = "$GM_BUILT" ]; then
      GM_FRESH="fresh"; GM_BEHIND=0
    elif _hook_same_tree "$cwd" "$GM_BUILT"; then
      # D-1368. THE STATE IS STILL `fresh`; the rest is a qualifier on it.
      # `— same content as HEAD` is APPENDED to the word rather than replacing
      # it, and that is a decision about the contract, not about the code:
      # `fresh` is the one word clause 12 of the worker skill branches on, and
      # a reader of this card does exactly the same thing here as it does for a
      # graph built at HEAD itself — takes the query answer as read. A new
      # STATE would have to be named by both skill docs, which harvest this
      # file's freshness assignments (D-1340/D-1342); a qualifier must not,
      # because there is no new decision to attach to it. It is appended only
      # when the graph was built at a DIFFERENT commit — an abbreviated sha
      # naming this very HEAD resolves to `$tip` and keeps the bare word — so a
      # reader can still tell "built here" from "built elsewhere, same bytes".
      GM_FRESH="fresh"; GM_BEHIND=0
      bcommit=$(git -C "$cwd" rev-parse --verify -q "$GM_BUILT^{commit}" 2>/dev/null) || bcommit=""
      [ "$bcommit" = "$tip" ] || GM_FRESH+=" — same content as HEAD"
    else
      # ANCESTRY, NOT DISTANCE (D-1353). `rev-list --count "$built..HEAD"` asks
      # ONE side of the question — how many commits HEAD carries that the
      # graph's commit cannot reach — and it answers 0 for two conditions this
      # card must not collapse: the graph was built AT this HEAD (an ABBREVIATED
      # sha, the only way to reach this arm at all, since the equality above
      # already took the full-sha case), and the graph was built at a commit
      # HEAD cannot reach forward to. The second is a graph of a tree this
      # session is not on — the sweep builds at a feature-branch tip, the
      # session then checks out `main` — and it was announced as `fresh`, which
      # is the one word clause 12 of the worker skill says licenses taking a
      # query answer as read. Three dots plus `--left-right` asks BOTH sides: L
      # is what the graph has and HEAD cannot reach, R is what HEAD has and the
      # graph does not. Any L at all means the graph describes commits this tree
      # does not carry — whether it sits ahead of HEAD or on a diverged branch,
      # where the one-sided count did not merely round to fresh but reported a
      # bare "behind" for a graph that is also ahead. Those two share ONE word
      # rather than collapsing onto a word that means something else, because a
      # reading session does the same thing in both: the graph is not of this
      # tree, so every answer is a lead.
      lr=$(git -C "$cwd" rev-list --left-right --count "$GM_BUILT...HEAD" 2>/dev/null) || lr=""
      # NOT SILENCE (D-1336). Silence here would collapse two conditions a
      # reading session handles differently onto one value, which this repo
      # calls a defect and not a style ("no overloaded null at a seam"): a
      # tree with no git names no sha AND no freshness, while this arm has a
      # sha in hand that git would not answer for. A card that names a sha
      # and then says nothing about it reads as neutral; the true word is
      # that the graph is UNDATABLE, so say it. The pair is matched WHOLE —
      # anything but two counts is the unmeasured answer, never a half-read
      # number standing in for both sides.
      if [[ "$lr" =~ ^([0-9]+)[[:space:]]+([0-9]+)$ ]]; then
        ahead="${BASH_REMATCH[1]}"; behind="${BASH_REMATCH[2]}"
        if   [ "$ahead"  -gt 0 ]; then GM_FRESH="not an ancestor of HEAD"
        elif [ "$behind" -eq 0 ]; then GM_FRESH="fresh"; GM_BEHIND=0
        elif [ "$behind" -eq 1 ]; then GM_FRESH="1 commit behind HEAD"; GM_BEHIND="$behind"
        else                           GM_FRESH="$behind commits behind HEAD"; GM_BEHIND="$behind"
        fi
      else
        GM_FRESH="freshness unmeasured"
      fi
    fi
  fi
  return 0
}

# CONDITIONS 2 AND 3 OF THE ARM (spec §2 "R5 — built"), asked of the last
# measurement and spelled ONCE (D-1613): the card's gate sentence and the gate
# itself must agree about which trees the gate is armed for, or the card
# promises a deny that never comes (or, worse, stays silent about one that does).
# GM_BEHIND is set only where a stamp the tail read accepted could be dated
# against HEAD, so its emptiness carries condition 2's failure as well as the
# freshness states that do not gate.
_hook_gate_tree() {   # -> 0 iff the measured tree carries a graph fresh enough to gate on
  [ -n "$GM_BEHIND" ] && [ "$GM_BEHIND" -le "$GRAPH_GATE_MAX_BEHIND" ]
}

_hook_graph_card() {
  local row="" line="" rc=0
  _hook_graph_measure || rc=$?
  [ "$rc" -ne 2 ] || return 0

  if [ "$rc" -eq 1 ]; then
    # SILENCE IS THE TRUE ANSWER for a tree the sweep has not reached: a card
    # asserting a graph that is not there is worse than no card. The one thing
    # worth saying instead is the sweep's OWN last word about this tree, when
    # its census carries one — a session that knows the tree was REFUSED does
    # not go hunting for a graph that is never going to appear. The census is
    # `{passes:[…]}`, last 10, newest LAST.
    row=$(jq -r --arg p "$GM_CWD" \
      '(.passes // []) | last | (.trees // [])
       | map(select(.path == $p and ((.reason // "") != "")))
       | if length == 0 then empty else (.[0].outcome + ": " + .[0].reason) end' \
      "$HOME/.ccrc/graph-sweep.json" 2>/dev/null) || row=""
    [ -n "$row" ] || return 0
    # CLIP BEFORE INTERPOLATING (D-1335). `.reason` is repo-controlled text the
    # sweep copied off an engine's stderr LINE (`BUILD_REASON="$first"`, one
    # `head -n1`, unbounded) or off a whole matched refusal line, and it lands
    # verbatim in this session's `additionalContext`. Every other payload this
    # file emits is already capped — `.[0:200]` on the approval summary, 64KB on
    # the state envelope — and this one was not. 400 characters keeps the
    # outcome and the head of the reason, which is the part that says what to do
    # about it. The other arm needs no cap: each of its fields is bounded at the
    # read (a validated 7-40 hex sha sliced to 8, digits off a 4096-byte head,
    # `head -c 64` on engine and pin).
    row="${row:0:400}"
    _hook_emit_context "graphify: this tree has no knowledge graph — the ccrc sweep's last pass says $row. Do not build one here; the sweep owns the write side."
    return 0
  fi

  line="graphify: this tree has a knowledge graph — graphify-out/"
  [ -z "$GM_NODES" ] || line="$line, $GM_NODES nodes"
  [ -z "$GM_BUILT" ] || line="$line, built at ${GM_BUILT:0:8}"
  [ -z "$GM_FRESH" ] || line="$line ($GM_FRESH)"
  # The engine/pin pair earns its place: sessions were measured running an
  # unversioned July copy of graphify against 0.9.9 graphs, and that drift is
  # invisible until a query fails strangely.
  [ -z "$GM_ENGINE" ] || line="$line, engine $GM_ENGINE"
  [ -z "$GM_PIN" ]    || line="$line (pin $GM_PIN)"
  # Single-quoted: the sentence carries backticks and double quotes verbatim.
  line="$line"'. Answer codebase questions with `graphify query "<question>"` first; `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for one concept; read `graphify-out/GRAPH_REPORT.md` only for broad architecture. Do not run `graphify update` or any build here — the ccrc sweep owns the write side.'
  # R5 (D-1613): the card says what the gate will DO in this tree, and it says
  # it only where the gate is actually armed — a card promising a deny that
  # never comes teaches the session to ignore the card. The kill-switch arm is
  # the same predicate with the operator's file on top of it, because "off" is
  # only worth saying where "on" would otherwise have been true.
  if _hook_gate_tree; then
    if [ -e "$GRAPH_GATE_OFF" ]; then
      line="$line Search tools are not gated here: the search gate is off (operator file)."
    else
      line="$line Search tools (Grep, Glob, shell grep/rg/find) are gated, and source-file reads are nudged, until this session's first graph query."
    fi
  fi
  _hook_emit_context "$line"
  return 0
}

[[ -n "${HOME:-}" ]] || exit 0
REG="$HOME/.cc-sessions"

# ── R4: what counts as READING the graph ────────────────────────────────
# `query`, `path` and `explain` only. `graphify update` and every build are
# WRITES, and the sweep owns the write side — counting them here would make
# the number say the opposite of what it is for. The leading class is what
# stops `mygraphify query` and prose mentioning the command from counting;
# the trailing one stops `graphify querying-something-else`.
GRAPH_QUERY_RE='(^|[;&|[:space:]])graphify[[:space:]]+(query|path|explain)([[:space:]]|$)'

# ── R5: the search gate's bounds, its kill-switch and what it gates ─────
# D-1613. Every one of these is named ONCE and read everywhere it is needed —
# the card's gate sentence, the arm condition and the deny reason all take the
# bounds from here, so the sentence a session reads and the rule it meets can
# not say different numbers.
#
# The kill-switch is a FILE the operator touches by hand, in a directory ccrc
# owns and nothing in this tree writes: same shape as `$REG/coordinator-paused`
# and `$REG/mail-disabled` — a convention with a speed bump, releasable without
# a deploy and without a token.
GRAPH_GATE_OFF="$HOME/.ccrc/graph-gate-off"
GRAPH_GATE_MAX_BEHIND=10
GRAPH_GATE_MAX_DENIALS=3
# A search at the HEAD of the line is a codebase question; a search at the tail
# of a pipeline (`vitest run | grep Tests`) is filtering output this session
# already produced, and gating that would be the gate answering a question
# nobody asked. So the head is what is matched: after at most one `cd <dir> &&`
# / `cd <dir>;` prefix and any run of `FOO=bar ` assignments, the first word.
# `graphify` is not in the list and so is never gated — the gate must never
# stand between a session and the very command that opens it.
# ── R6: what a source READ is (D-1745) ──────────────────────────────────
# The gate leaves `Read` alone — a named file is not a question — so a session
# can navigate file by file and never meet it. The ruling closes that hole with
# a NUDGE on a source read, never a deny: `Edit` requires a prior `Read`, and a
# deny here would charge every session told to fix a named file one denial
# before its first edit.
#
# THE LIST IS GRAPHIFY'S OWN, not this file's opinion: `_HOOK_SOURCE_EXTS` in
# graphify 0.9.9's `graphify/__main__.py`, the tuple its own project-scoped
# `Read|Glob` hook nudges on, in its own order. It is spelled HERE and only
# here — `session-hook.test.ts` harvests this assignment rather than retyping
# the list, so a drift in either direction is red.
#
# ANCHORED AT THE END, dot-prefixed: `.json` can never match `.js`, `a.js.map`
# is a `.map`, and a final segment with no dot has no extension at all. The
# path is matched whole, so a `dist.ts/README` matches nothing either — the
# anchor makes the last segment the only one that can end the string.
GRAPH_NUDGE_READ_RE='\.(py|js|ts|tsx|jsx|astro|vue|svelte|go|rs|java|rb|c|h|cpp|hpp|cc|cs|kt|swift|php|scala|lua|sh|md|rst|txt|mdx)$'
# DERIVED, never re-spelled (single-definition): the same alternation with the
# JSON string terminator in place of end-of-line, so the raw payload can be
# refused before any jq fork. A payload whose `file_path` ends in a source
# extension cannot fail to carry `<ext>"`, so the prefilter has no false
# negative that matters; a false positive costs one jq the anchored match then
# refuses.
GRAPH_NUDGE_PRE_RE="${GRAPH_NUDGE_READ_RE%\$}\""
GRAPH_SEARCH_RE='^[[:space:]]*(cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(rg|grep|egrep|fgrep|ugrep|ag|ack|find|fd|git[[:space:]]+grep)([[:space:]]|$)'

payload=$(cat 2>/dev/null) || exit 0
[[ -n "${TMUX_PANE:-}" ]] || exit 0
tname=$(tmux display-message -p '#S' 2>/dev/null) || exit 0
[[ "$tname" == cc-?* ]] || exit 0
id="${tname#cc-}"
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || exit 0
[[ -d "$REG" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

event=$(jq -r '.hook_event_name // empty' <<<"$payload" 2>/dev/null) || exit 0
[[ -n "$event" ]] || exit 0

state="" ask_json="null" interrupted="false" src="" gcmd=""
case "$event" in
  UserPromptSubmit) state="working" ;;
  PostToolUse)
    state="working"
    # ONE payload read for the counter, on the one event that can carry a
    # command, and only for Bash: a tool_input.command on any other tool is
    # not a shell line this box ran.
    #
    # THE PREFILTER IS A BUDGET, NOT A STYLE CHOICE. This arm is the HOT PATH —
    # `session-hook.test.ts` pins p95 of 20 PostToolUse runs under 150 ms, and
    # a bare `jq` fork on this box measures ~5 ms against a ~46 ms run. A shell
    # line that runs `graphify` CANNOT fail to put the eight characters
    # `graphify` somewhere in the payload (JSON escaping never touches them),
    # so a payload without them needs no jq at all and the common tool call
    # pays nothing. `$gcmd` stays "" there, which the increment below already
    # treats as "no command".
    if [[ "$payload" == *graphify* ]]; then
      gcmd=$(jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' \
        <<<"$payload" 2>/dev/null) || gcmd=""
    fi ;;
  PreCompact) state="working" ;;
  PostCompact)
    trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || exit 0
    [[ "$trig" == manual ]] && state="done" || state="working" ;;
  PreToolUse)
    tool=$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null) || exit 0
    if [[ "$tool" == AskUserQuestion ]]; then
      state="waiting"
      ask_json=$(jq -c '{questions: (.tool_input.questions // [])}' <<<"$payload" 2>/dev/null) || ask_json="null"
    else
      state="working"
    fi ;;
  PermissionRequest)
    state="waiting"
    tool=$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null) || exit 0
    if [[ "$tool" == AskUserQuestion ]]; then
      # MEASURED 2026-08-05, live fleet probe against Claude Code 2.1.222:
      # this harness version delivers AskUserQuestion as PermissionRequest,
      # NOT PreToolUse — the PreToolUse arm above is Orca's mapping, written
      # against a different harness version, and is kept rather than
      # replaced because which arm actually fires is a harness detail this
      # script cannot control or predict for the next upgrade. Without this
      # check the branch below wrote {approval:{tool:"AskUserQuestion",
      # summary:""}} — an empty, useless envelope — silently losing the real
      # questions/options while the pane showed an actual 3-option menu. Both
      # paths must keep producing the same {questions:…} envelope shape.
      ask_json=$(jq -c '{questions: (.tool_input.questions // [])}' <<<"$payload" 2>/dev/null) || ask_json="null"
    else
      ask_json=$(jq -c '{approval: {tool: (.tool_name // "unknown"),
        summary: ((.tool_input.command // .tool_input.file_path // .tool_input.path
                   // .tool_input.url // .tool_input.pattern // "") | tostring | .[0:200])}}' \
        <<<"$payload" 2>/dev/null) || ask_json="null"
    fi ;;
  SessionStart)
    # F1 (build4 dogfood, docs/superpowers/programs/build4.md): a freshly
    # spawned session has never taken a turn, so it has no hookstate file at
    # all — the mail delivery gate's `hs === null` conjunct correctly
    # fails SHUT on that (never inject mid-thought), but with NOTHING ever
    # writing this id's first hookstate, that worker's very FIRST
    # coordination brief sat queued forever (measured live: ~40min, until a
    # human-forced first turn). A just-started session is definitionally at
    # an idle boundary — sitting there waiting for input, exactly like a
    # session that just finished a `Stop` — so SessionStart writes `done`
    # too, the same idle the delivery gate already knows how to read.
    #
    # D-306 (was D-B8-10): this arm shipped UNWIRED — install-session-hooks.sh's event list
    # omitted SessionStart — so F1 was never actually fixed on the fleet, and
    # nothing re-stamped state when a supervisor resumed a session. Measured on
    # the 2026-08-19 reboot: 12 of 17 live sessions still carried hookstate
    # written before the boot that restarted them, two of them `working` —
    # stamped by a process that no longer existed. Only `Stop` clears `working`,
    # and a killed turn never reaches its `Stop`.
    #
    # Wiring it exposes the case the unconditional `done` above gets wrong:
    # `source` is compact when the harness fires SessionStart in the MIDDLE of a
    # turn to re-inject context after compaction. Stamping `done` there would
    # tell the mail gate an actively-thinking session is idle — the precise
    # mid-thought injection the gate exists to prevent. PreCompact/PostCompact
    # already own that transition, so compact is inert here: write nothing at
    # all and leave whatever PreCompact wrote standing. Every other source —
    # startup, resume, clear, or ABSENT on an older harness — is a real idle
    # boundary (absence-permits: the pre-`source` payload was the F1 startup).
    src=$(jq -r '.source // empty' <<<"$payload" 2>/dev/null) || src=""
    # BEFORE the compact exit, deliberately: the hookstate write stays skipped
    # for compact (D-306 — PreCompact/PostCompact own that transition), and the
    # card is independent of it. Compaction is precisely when a session loses
    # what it knew, so it is the source that most needs the card.
    _hook_graph_card || true
    [[ "$src" == compact ]] && exit 0
    state="done" ;;
  Stop)
    state="done"
    [[ $(jq -r '.is_interrupt // false' <<<"$payload" 2>/dev/null) == true ]] && interrupted="true" ;;
  SubagentStart|SubagentStop) state="" ;;   # subagent-set update only
  *) exit 0 ;;
esac

f="$REG/$id.hookstate.json"
# Prior subagent set survives state transitions; a corrupt file reads as [].
# ONE fork for all four fields (was two, and each counter would have added one).
# Same hot-path budget as the arm above: `$f` is read on every event, and
# `subs`/`prev_state` were already two forks over one file. Four values on
# four LINES, not `@tsv` — `@tsv` escapes a tab or newline inside a subagent
# name as a backslash sequence, which would hand `--argjson subagents` a string
# that is no longer JSON. `tostring` of a compact ARRAY contains no newline, so
# line-splitting is safe where tab-splitting is not.
#
# D-1249: order matters, because line-splitting is POSITIONAL. `tostring` keeps
# the escape only for an array — on a JSON *string* it returns the text RAW, so
# an externally-corrupted `.subagents` that is a string with a newline in it
# emits four lines and shifts every field after it onto the wrong one. So the
# one field that can carry unbounded text goes LAST: a shift can then only
# corrupt `subs` itself, which the `\[*` guard below already catches. `state`
# leads (bounded set, and the shifted-into value it would otherwise take has no
# guard — an out-of-set `state` reaches `hookstate.ts:233` and degrades to
# NO_STATE, but it should never be reachable from another field's overflow),
# and the two counters sit in the middle, each behind its own `^[0-9]+$` guard.
#
# Both counters survive state transitions exactly as `subs` does, and a file
# that never carried either field reads as 0 — this is the WRITER, where 0
# is the honest start; `hookstate.ts` is the reader, and there absent stays
# `null` rather than folding to 0. A jq that fails (no file, corrupt file)
# prints nothing, all four `read`s come up empty, and each falls back to the
# degrade it already had (D-1613 measures that failure separately for the gate,
# just below: for the WRITE the degrade is unchanged). This file runs under `set -uo pipefail` and NOT
# `set -e`, so a `read` hitting EOF is inert.
subs=""; prev_state=""; gq=""; gd=""
{ read -r prev_state; read -r gq; read -r gd; read -r subs; } < <(jq -r \
  '(.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end),
   (if (.graphGateDenials | type) == "number" then (.graphGateDenials | floor) else 0 end),
   (.subagents // [] | tostring)' \
  "$f" 2>/dev/null)
# A HOOKSTATE THAT EXISTS AND WILL NOT PARSE IS NOT A SESSION THAT COUNTED ZERO
# (D-1613). Both degrade to 0 for the WRITE — that is the honest start, and it
# is what this file has always done — but only one of them may arm the gate: a
# corrupt file means this session's query count is UNKNOWN, and the gate denies
# on a measured zero or not at all. The probe is `gq`, because the jq program
# above emits a number on that line for every object it can read at all, so an
# empty `gq` beside a file that IS there can only be a read that failed.
hs_unreadable=0
[[ -f "$f" && -z "$gq" ]] && hs_unreadable=1
[[ "$subs" == \[* ]] || subs="[]"
[[ "$gq" =~ ^[0-9]+$ ]] || gq=0
[[ "$gd" =~ ^[0-9]+$ ]] || gd=0
# `startup` and `clear` are new sessions; `resume` and `compact` are the SAME
# session still going, and a counter that reset on compaction would erase the
# evidence at precisely the moment the session most needed the card (R1).
# `compact` never reaches this line at all — the SessionStart arm exits at its
# compact guard (D-306) — so its carry is STRUCTURAL, protected by that exit
# and not by this condition. `resume` is the source this condition protects.
#
# D-1248: written as "everything except resume", NOT "startup or clear", so a
# SessionStart carrying NO `source` reads the same way here as it does in the
# arm above — where absence-permits makes it the F1 startup (:146-147) and
# `session-hook.test.ts` pins it as `done`. Spelled as an allow-list, a
# source-less SessionStart would be a NEW session for `state` and the SAME
# session for `graphQueries`, one file collapsing a distinction it drew two
# lines earlier: the counter would never reset on an older harness and would
# accumulate forever across restarts of one tmux session name (the hookstate
# file is keyed `cc-<id>`, which survives them), so the card would report
# previous sessions' reads as this one's. A future `source` this build has
# never heard of lands on the same side as absence — a new boundary resets,
# which is the degrade that costs a count rather than inventing one.
# The denial count resets WITH the query count and for the same reason: the
# gate meets a session once per new context, so a dispatched worker meets it
# once per wave (dispatch `/clear`s it from wave 2 on) and a `/clear` by hand
# re-arms it. A `resume` is the same session still going, and re-arming there
# would deny a search the session had already paid for once.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; gd=0; fi
if [[ -n "$gcmd" && "$gcmd" =~ $GRAPH_QUERY_RE ]]; then gq=$((gq + 1)); fi

# ── R5: THE SEARCH GATE (D-1613) ────────────────────────────────────────
# The spec DECLINED this gate and the operator reversed it on R4's own reading:
# 4 graph queries fleet-wide in the two days after the read side deployed, 10 of
# 18 live sessions still at `graphQueries` 0. The card and the worker skill's
# clause 12 moved nothing a counter could see, so the ask became a deny.
#
# THE ONLY THING THIS FILE PRINTS ON A NON-SessionStart EVENT, and it is the
# one shape PreToolUse defines: a permission decision. Silence is the default on
# every other path, so every read that will not answer costs the session nothing
# — a hook that can wedge a turn is worse than no hook. The envelope is BUILT
# here and PRINTED at the end of the file, after the hookstate write lands
# (D-1689): a deny that has gone out is a denial the next event must be able to
# see, or the bound of three is a promise this file cannot keep.
#
# ORDER IS BUDGET (the same argument the PostToolUse prefilter above makes).
# The cheap conjuncts run first: the counters are already in hand, the
# kill-switch is one stat, the tool name was read by the arm above, and only a
# GATED call in an ARMED session pays for the jq that reads the command or the
# git that dates the graph. A session that has queried once, or that has spent
# its three denials, never pays anything again.
# R6 (D-1745) shares this arm rather than copying it: the nudge's conditions
# ARE the gate's 1-4 (kill-switch, a datable graph, freshness inside the bound,
# `graphQueries` 0), and only the fifth — the denial bound — is the gate's
# alone, because a nudge spends nothing and is never bounded. Two copies of one
# predicate is the drift the card's own `_hook_gate_tree` exists to prevent.
# ONE LINE PER EVENT: `Read` is never gated and `Grep`/`Glob`/`Bash` is never
# nudged, so the two branches below are mutually exclusive by the tool name,
# and `pre_json` (the deny's `deny_json`, generalised) holds whichever one was
# built.
pre_json=""
if [[ "$event" == PreToolUse && "$hs_unreadable" -eq 0 && "$gq" -eq 0 ]] \
   && [ ! -e "$GRAPH_GATE_OFF" ]; then
  gated=0 nudged=0 bounded=0 fpath=""
  [[ "$gd" -lt "$GRAPH_GATE_MAX_DENIALS" ]] && bounded=1
  case "${tool:-}" in
    Grep|Glob) gated=1 ;;
    Read)
      # ORDER IS BUDGET, as everywhere else in this arm: the tool name was read
      # by the arm above and is free, the prefilter is a bash regex over a
      # string already in memory, and only a source read pays for the jq that
      # reads the path or the git that dates the graph.
      # LOWERCASED before every match (D-1797): graphify's own `hook-guard read`
      # lowercases the path before testing the extension, and the list here is
      # graphify's own, so `A.TS` must answer the same way on both halves.
      if [[ "${payload,,}" =~ $GRAPH_NUDGE_PRE_RE ]]; then
        fpath=$(jq -r 'if .tool_name == "Read" then (.tool_input.file_path // "") else "" end' \
          <<<"$payload" 2>/dev/null) || fpath=""
        if [[ -n "$fpath" && "${fpath,,}" =~ $GRAPH_NUDGE_READ_RE ]]; then
          # NEVER UNDER `graphify-out/`, at any depth: the card sends the
          # session to `GRAPH_REPORT.md` by name, and nudging that read would
          # have the two halves of the same mechanism contradict each other.
          case "${fpath,,}" in
            graphify-out/*|*/graphify-out/*) ;;
            *) nudged=1 ;;
          esac
        fi
      fi ;;
    Bash)
      # The prefilter is the PostToolUse arm's budget argument, in the other
      # direction: a command that HEADS with one of the search words cannot
      # fail to put that word somewhere in the payload, so a payload without
      # any of the six substrings needs no jq at all. A false negative is
      # impossible, which is the only direction that would matter; a false
      # positive costs one jq fork the regex then refuses, and the substrings
      # DO occur inside ordinary words — `npm run package` carries `ack`,
      # `manage.py migrate` carries `ag` (2 of 14 ordinary commands measured,
      # D-1691) — so a session that never searches pays that one fork on each
      # such call for as long as it sits at zero queries. One fork, not a jq
      # on every Bash call: that is the whole of the budget claim.
      if [[ "$payload" =~ (rg|grep|ag|ack|find|fd) ]]; then
        scmd=$(jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' \
          <<<"$payload" 2>/dev/null) || scmd=""
        [[ -n "$scmd" && "$scmd" =~ $GRAPH_SEARCH_RE ]] && gated=1
      fi ;;
  esac
  # THE BOUND IS DECIDED HERE AND NOWHERE ELSE (D-1797). The R6 refactor had
  # `bounded` consulted in the `Grep|Glob` arm and in the `Bash` prefilter as
  # well, which made THIS conjunct redundant and left the shell copy pinned by
  # nothing (measured: dropping it stayed green). One site now, so the bound
  # test — three denials on `Grep`, then a `Grep` AND a shell search silent —
  # reds the moment the conjunct goes. The price is one jq per shell search
  # for a session that has spent its three denials and still never queried,
  # which is the rare shape by design.
  if [[ "$gated" -eq 1 && "$bounded" -eq 1 ]] && _hook_graph_measure && _hook_gate_tree; then
    # The card's own vocabulary — node count and freshness word, measured by the
    # card's own function — plus the act, plus the bound. A session that cannot
    # run Bash at all still gets through on its fourth search, and the board
    # shows the denials it spent getting there.
    greason="graphify gate: this tree has a knowledge graph ("
    [ -z "$GM_NODES" ] || greason+="$GM_NODES nodes, "
    greason+="$GM_FRESH) and this session has not queried it yet."
    greason+=' Search tools open after one graph query — run: `graphify query "<your question in plain words>"` (`graphify path "<A>" "<B>"` for a relationship, `graphify explain "<concept>"` for one concept).'
    greason+=" Denial $((gd + 1)) of $GRAPH_GATE_MAX_DENIALS; after $GRAPH_GATE_MAX_DENIALS the gate opens anyway."
    # COUNTED ONLY IF IT CAN BE SAID, SAID ONLY ONCE IT IS COUNTED (D-1689).
    # A builder that could not make its JSON has denied nothing, and charging
    # the session for it would spend the bound on denials it never saw. And the
    # envelope it did make goes out at the END of this file, after the rename:
    # measured on the branch before the fix, with the registry unwritable every
    # search read "Denial 1 of 3" forever, and the one graphify query that
    # would have opened the gate was lost by the same failed write.
    if pre_json=$(_hook_deny_json "$greason"); then gd=$((gd + 1)); else pre_json=""; fi
  elif [[ "$nudged" -eq 1 ]] && _hook_graph_measure && _hook_gate_tree; then
    # The card's own vocabulary again, measured by the card's own function, and
    # the act — but no bound and no count: the nudge is advice, it spends
    # nothing, and it stops the moment the session queries. The node clause is
    # omitted when the count could not be measured, exactly as the deny's is.
    nreason="graphify: this tree has a knowledge graph ("
    [ -z "$GM_NODES" ] || nreason+="$GM_NODES nodes, "
    nreason+="$GM_FRESH) and this session has not queried it yet."
    nreason+=' Before reading files to orient, run: `graphify query "<your question in plain words>"` (`graphify explain "<concept>"` for one concept).'
    nreason+=' Reading a named file to edit it needs no query.'
    pre_json=$(_hook_nudge_json "$nreason") || pre_json=""
  fi
fi

if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then
  name=$(jq -r '.agent_name // .subagent_name // .agent_type // "subagent"' <<<"$payload" 2>/dev/null) || name="subagent"
  now=$(_hook_epoch_ms)
  if [[ "$event" == SubagentStart ]]; then
    subs=$(jq -c --arg n "$name" --argjson t "$now" \
      '(. + [{name:$n, startedAt:$t}]) | .[-32:]' <<<"$subs" 2>/dev/null) || subs="[]"
  else
    subs=$(jq -c --arg n "$name" 'del(.[ (map(.name) | index($n)) // empty ])' <<<"$subs" 2>/dev/null) || subs="[]"
  fi
  # Session state untouched: keep the previous state (or skip entirely when
  # no state was ever written — a subagent event before any turn is inert).
  [[ -n "$prev_state" ]] || exit 0
  state="$prev_state"
  ask_json=$(jq -c '.ask // null' "$f" 2>/dev/null) || ask_json="null"
  interrupted=$(jq -r 'if .interrupted == true then "true" else "false" end' "$f" 2>/dev/null) || interrupted="false"
fi

# Transitions to working/done clear the ask: an answered question must not
# stay sticky on the sheet.
[[ "$state" == working || "$state" == done ]] && { [[ "$event" == SubagentStart || "$event" == SubagentStop ]] || ask_json="null"; }

out=$(jq -cn \
  --argjson v 1 --arg state "$state" --arg event "$event" \
  --arg sessionId "${CLAUDE_CODE_SESSION_ID:-}" --argjson pid "${CLAUDE_PID:-0}" \
  --argjson updatedAt "$(_hook_epoch_ms)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" --argjson graphQueries "$gq" \
  --argjson graphGateDenials "$gd" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries,
    graphGateDenials:$graphGateDenials}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0

# 64KB cap: drop the questions envelope before anything else — a truncated
# envelope is worse than none.
if (( ${#out} > 65536 )); then
  out=$(jq -c '.ask = null' <<<"$out" 2>/dev/null) || exit 0
  (( ${#out} <= 65536 )) || exit 0
fi

# The braces put the REDIRECTION's own failure under the 2>/dev/null too: with
# `> "$tmp" 2>/dev/null` bash reports an unopenable "$tmp" on the hook's real
# stderr before the second redirection is applied (D-1691).
tmp="$REG/.$id.$$.hookstate.tmp"
{ printf '%s\n' "$out" > "$tmp"; } 2>/dev/null || { rm -f "$tmp"; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp"; exit 0; }
# The one PreToolUse envelope this file ever prints — a deny (R5) or a nudge
# (R6) — and only now: the count a deny names is on disk, so the next event
# will see it (D-1689). The nudge counts nothing, but it shares this site so
# that neither branch can ever print from inside the arm.
[ -z "$pre_json" ] || printf '%s\n' "$pre_json"
exit 0
