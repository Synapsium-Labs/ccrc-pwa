#!/usr/bin/env bash
# session-hook.sh — Claude Code hook → ~/.cc-sessions/<id>.hookstate.json
#
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network — and on the HOT PATH, no locks and no waiting. TWO declared
# exceptions, both OFF the hot path and both in the compaction arms alone:
# the helper's one hookstate-first, COMPACT_HELPER_TIMEOUT-bounded,
# locally resolved `timeout`/`gtimeout` deadline; and, since D-2605, the row's
# permanent stable lock, taken with a bounded `flock -w` of COMPACT_LOCK_WAIT
# (COMPACT_LOCK_WAIT_SERVE on compact SessionStart, the one acquisition a human
# is waiting on) and never held across a fork the arm does not reap. A miss
# publishes nothing; there is no unlocked fallback. Every OTHER event — every
# PreToolUse, PostToolUse and Stop, which is where the hot path actually is —
# still takes no lock and waits on nothing. A hook that can slow or break a
# session is worse than no hook. Consumed read-only by the ccrc server via the agent
# (whitelist: .cc-sessions is readable; nothing here needs a grant). Non-fleet
# sessions (no tmux, foreign session name) exit silently.
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
# file's standing contract (exit 0 on every path, no network, and on the hot
# path no locks and no waiting) is unchanged except the two declared
# compaction-arm exceptions the header states — the hookstate-first bounded
# helper wait, and D-2605's bounded stable-lock acquisition. Every read below
# is a local file or a git ref.
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
    # about it. THE OTHER ARM IS NOT BOUNDED AT THE READ (D-1899), and this comment
    # claimed it was until the fix wave corrected it (I4). Two of its three
    # fields are — a validated 7-40 hex sha sliced to 8, `head -c 64` on engine
    # and pin — but `GM_NODES` is UNBOUNDED REPETITION inside a 4096-byte head:
    # `grep -oE '[0-9]+ nodes'` captures however many digits fit, captures them
    # WHOLE (so no length gate downstream sees a truncated value to refuse), and
    # they are interpolated straight into the graphify sentence. Measured: 3000
    # digits inside the head drive the assembled card to 3437 characters. What
    # actually holds that is `CARD_MAX_CHARS` at the emitter, and the test that
    # measures it is `a pathological node count cannot delete the card`
    # (`server/test/session-hook.test.ts`) — never this arm's own reads.
    row="${row:0:400}"
    CARD_GRAPH="graphify: this tree has no knowledge graph — the ccrc sweep's last pass says $row. Do not build one here; the sweep owns the write side."
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
  CARD_GRAPH="$line"
  return 0
}

# ── THE CO-TENANT SUBJECT (R7) ──────────────────────────────────────────
# ONE READ, THREE ANSWERS. `readFileMeasured`'s rule (D-114) in bash: absent
# and unreadable are two conditions a caller handles differently, so they get
# two return codes. `-f` is not decoration — `-r` is TRUE for a DIRECTORY and
# `$(<dir)` is silently empty with rc 0, and ccd names a directory planted at a
# registry path as a real attack shape.
#
# NEVER `2>/dev/null` on a `$(<f)`: bash parses that as a null command with
# redirections, NOT the fork-free read — measured, it returns the EMPTY STRING
# and rc 0 on a perfectly readable file, so the reflex idiom is a silent wrong
# answer. The `[[ -f && -r ]]` guard is what makes stderr silent instead — for
# THAT hazard. `$(<f)` carries a SECOND, independent one: on a NUL byte in the
# file it silently strips the byte but STILL WRITES bash's own "warning:
# command substitution: ignored null byte in input" to real stderr (measured,
# bash 5.2). The `-f && -r` guard cannot see this either — the loss happens
# INSIDE the read, on a file that already passed every prior check. Fix round
# 1 (finding 1) replaced the read itself with the bash builtin below.
#
# `IFS= read -r -N "$CCRC_ID_MAX" CT_V` is fork-free (a builtin, no subshell —
# see "IT SETS CT_V AND NEVER PRINTS" below) AND BOUNDED — `$(<f)` read the
# WHOLE file before the trim ever ran, so one 2 MB peer `.project` took the
# probe from 5 ms to 759 ms and one 8 MB file to 3.3 s (fix round 1, finding
# 2); `-N` caps the bytes this function ever holds regardless of how large the
# file on disk is (re-measured after the fix: the same 2 MB and 8 MB files
# both read back in ~3 ms).
#
# THE BOUND IS `CCRC_ID_MAX` (128), NOT `CCRC_PROJ_MAX` (64), though every
# caller today reads either a `.project` field (bound by `CCRC_PROJ_MAX`) or a
# `.supervised` epoch integer (far shorter than either bound). Reading exactly
# `CCRC_PROJ_MAX` would make an over-long value TRUNCATE to precisely the
# bound and then PASS the length gate as if it had always been that short —
# exactly the "silently truncated into a passing value" failure fix round 1
# (finding 2) named. Reading the LARGER of this file's two length constants
# means a value genuinely within `CCRC_PROJ_MAX` is always captured whole (a
# short read), while anything longer is truncated at a length that STILL
# exceeds `CCRC_PROJ_MAX` (128 > 64) — so the length gate downstream still
# correctly refuses it instead of silently accepting the truncated prefix.
#
# `read -N` returns 1 on a SHORT READ (fewer than the requested count because
# EOF arrived first) — the NORMAL case for every field this function reads,
# never an error — so this function does not branch on that return value; only
# the `-e`/`-f`/`-r` checks above decide absent vs unmeasurable. `-N` ignores
# delimiters, so a trailing newline lands inside `CT_V` exactly as it did
# before; the trim below is unchanged and still strips it.
#
# `2>/dev/null` COMES FIRST, before the `< "$1"` redirection, not after:
# reversed, it does nothing — a failed INPUT redirection is reported and
# aborts the command before a LATER stderr redirection ever takes effect
# (measured: `read … < gone 2>/dev/null` still printed "No such file or
# directory" to real stderr; `read … 2>/dev/null < gone` printed nothing). The
# only way this fires on a path that just passed `-e`/`-f`/`-r` is a TOCTOU
# race — another process deleting or replacing the row between the check and
# the read — and on that race `CT_V` stays empty, which every caller already
# treats the same as a genuinely empty field.
#
# A NUL byte in the file is still silently dropped — bash variables cannot
# hold one, full stop, and no fork-free mechanism here can detect one was
# ever there. What changes is that `read` does this WITHOUT bash's `$(<f)`
# warning (measured: zero stderr on `al\0pha`). The narrow "unsafe" divergence
# finding 1 named — the byte-preserving server groups `al\0pha` on its own,
# this hook groups the NUL-stripped `alpha` — is UNCHANGED and accepted:
# closing it would need a `stat`/`wc` fork this file's zero-fork budget
# does not have.
#
# IT SETS `CT_V` AND NEVER PRINTS. `v=$(_ct_read f)` would be a command
# SUBSTITUTION, which forks a subshell even around a shell function: measured
# 61.9 ms for one 22-row pass that way against 2.97 ms this way. The whole
# probe forks ZERO times (strace: 0 clone/clone3/vfork over one pass — still
# true after fix round 1's read change, re-measured).
#
# The trim reproduces the server's own `field()` (`server/src/registry.ts:333`
# does `content.trim()`), so the hook and the server group rows the same way.
_ct_read() {   # <path> -> CT_V ; rc 0 read, 1 absent, 2 unmeasurable
  CT_V=""
  [[ -e "$1" ]] || return 1
  [[ -f "$1" && -r "$1" ]] || return 2
  IFS= read -r -N "$CCRC_ID_MAX" CT_V 2>/dev/null < "$1"
  CT_V="${CT_V#"${CT_V%%[![:space:]]*}"}"; CT_V="${CT_V%"${CT_V##*[![:space:]]}"}"
  return 0
}

# THE RUNG IS THE SUPERVISOR HEARTBEAT, NOT `.archived` — and that is a ruling
# this repo already made. `server/src/coord/peers.ts` (D9): the peers route
# "does NOT filter on `.archived` ... `archivedAt` is reported verbatim and
# decides nothing", and it ships `archiveContradicted`/`archivedStale` to NAME
# the contradiction. Measured on this box: `data-internal-still-prairie` has
# carried `.archived` for 33 days beside a 4-second-old heartbeat, and the
# server calls it `deliverable:"yes"`. In the other direction a main checkout
# can never be archived at all, so an `.archived` filter over-counts a dead
# main checkout forever with nothing to correct it. The heartbeat is the one
# field a dead row stops writing, and 120 s is `SUPERVISED_FRESH_MS`.
#
# THE PROJECT IS READ, NEVER PARSED OUT OF THE ID. Measured over all 22 rows:
# `${id%-*}` is right 0 times and `${id#*-}` 3 times, because ccd mints ids
# both `<wrapper>-<project>` and `<project>-<slug>` and both halves are
# hyphenated. There is no fallback there, only a wrong answer.
_ct_probe() {   # -> CT_N CT_U CT_PROJ ; rc 1 = nothing may be said
  CT_N=0; CT_U=0; CT_PROJ=""
  local me="" f o rc now
  _ct_read "$REG/$id.project"; rc=$?
  [[ $rc -ne 2 ]] || return 1
  me="$CT_V"; [[ -n $me ]] || me="$id"
  case "$me" in ''|*[!$CCRC_PROJ_CLASS]*) return 1 ;; esac
  (( ${#me} <= CCRC_PROJ_MAX )) || return 1
  # GUARDED, like every other reader of this builtin in the tree (`:33` here,
  # `ccrc:269`, `ccd:210`). `EPOCHREALTIME` is bash 5.0+ and this file's
  # declared floor is 4.4, so a bare `${EPOCHREALTIME%%...}` under `set -u` is
  # not a wrong number — it ABORTS THE SHELL, here, inside the probe, BEFORE
  # the card is emitted and BEFORE the hookstate write: on a sub-5.0 box that
  # is no card, no state write, a non-zero exit and stderr noise on every
  # SessionStart, which is the worst shape this file can fail in. Empty `now`
  # degrades to SILENCE instead: `(( now - ... ))` reads an empty variable as
  # 0, every heartbeat then measures as future-dated, `CT_N` stays 0 and the
  # subject says nothing. Silence is the true answer for a box that cannot
  # measure the clock.
  now="${EPOCHREALTIME:-}"; now="${now%%[.,]*}"
  # SUFFIX-ANCHORED, never `$REG/$id*` and never bare `$REG/*`: `_reg_purge`
  # records MEASURED id-nesting collisions an unanchored glob matches both
  # sides of, and wave 2a put the project pool tag in a DOTLESS `$REG/pools/`
  # precisely because "every registry glob is SUFFIX-shaped ... so a directory
  # is invisible to all of them". Bare `$REG/*` also costs 3.75 ms against
  # 0.51 ms here — 485 entries, 126 of them leaked `_reg_set` tmp dotfiles.
  #
  # THE ID SET IS `.uuid`, which is the enumeration the SERVER itself uses
  # (`registry.ts` derives the whole fleet id list from
  # `names.filter(n => n.endsWith('.uuid'))`). Globbing `*.project` instead
  # would make a row that carries no `.project` INVISIBLE — but the server
  # gives that row `project ?? id`, so the two sides would enumerate different
  # fleets. `$o` is COMPARED against `$id` first and shape-gated SECOND (fix
  # round 1, finding 7 corrected this comment — it previously claimed the
  # opposite order). The order is harmless either way: `[[ ]]` treats only its
  # RIGHT operand (`$id`, already validated at the top of this file) as a
  # pattern, so `$o` on the LEFT of `==` is matched LITERALLY no matter its own
  # shape — an ungated `*` there is just a string, never a wildcard. The shape
  # gate below exists for what runs AFTER it, not for this comparison: `$o` is
  # INTERPOLATED into a registry path two lines down, and that read is what
  # the gate protects.
  for f in "$REG"/*.uuid; do
    o="${f%.uuid}"; o="${o##*/}"
    [[ $o == "$id" ]] && continue
    case "$o" in ''|*[!$CCRC_PROJ_CLASS]*) continue ;; esac
    (( ${#o} <= CCRC_ID_MAX )) || continue
    # CT_U IS FLEET-SCOPED, DELIBERATELY, NOT PROJECT-SCOPED (fix round 1,
    # finding 6): an unmeasurable `.project` on this row could belong to ANY
    # project — its own value cannot be read to rule that out — so it still
    # earns THIS card's "at least" qualifier even if it turns out to belong
    # elsewhere. One bad row anywhere in the fleet then hedges every project's
    # card, which is coarser than a per-project uncertainty count would be,
    # but it is never a false EXACT count — the direction every other gate in
    # this function also protects.
    _ct_read "$REG/$o.project"; rc=$?
    [[ $rc -ne 2 ]] || { CT_U=$(( CT_U + 1 )); continue; }
    # NOT AN EXACT `??` (fix round 1, finding 4): the server's `project ?? id`
    # (`registry.ts`) coalesces NULL only, so a `.project` that reads back
    # empty or whitespace-only stays `''` on the server — but this `-n` test
    # coalesces THAT case too, falling back to `$o` here where the server
    # would not. The divergence is SAFE, unlike the NUL byte's unsafe
    # direction above: two rows with an empty `.project` group together as
    # `''` on the server and separately (or not at all) here, so this hook can
    # only UNDER-count or fall silent, never claim a co-tenant the server does
    # not also see.
    [[ -n $CT_V ]] || CT_V="$o"
    [[ $CT_V == "$me" ]] || continue
    # A ROW WITH NO `.supervised` IS A MEASURED ABSENCE, not an unmeasured row:
    # on this box the 5 rows lacking it are all archived AND stopped. Folding
    # absence into doubt would put "at least" on every card forever.
    _ct_read "$REG/$o.supervised"; rc=$?
    [[ $rc -ne 1 ]] || continue
    if [[ $rc -eq 2 ]]; then CT_U=$(( CT_U + 1 )); continue; fi
    case "$CT_V" in ''|*[!0-9]*) CT_U=$(( CT_U + 1 )); continue ;; esac
    # `10#$CT_V`, NOT BARE `$CT_V` (fix round 1, finding 5): `(( ))` treats a
    # leading-zero numeric string as OCTAL, and a value like "0899" is not
    # valid octal (8 and 9 are not octal digits) — bash errors "value too
    # great for base" to real stderr (measured) on a `.supervised` the case
    # pattern just above proved is all-digits. `10#` forces base 10, which is
    # always a legal reading of an all-digit string.
    (( now - 10#$CT_V >= 0 && now - 10#$CT_V < CCRC_FRESH_S )) && CT_N=$(( CT_N + 1 ))
  done
  CT_PROJ="$me"
  return 0
}

# THE CARD SAYS WHAT THE REGISTRY PROVED AND NOTHING MORE. It does not say
# "live" — no local field can. `_swap_beat` re-stamps `.supervised` through a
# whole `cp -a` carry ON PURPOSE, and 6 of 16 rows have been silent over 5 h
# while reading `deliverable:"yes"` to the server. It does not say "share"
# either: the 7 ccrc-pwa rows resolve to 7 distinct workdirs on 6 distinct
# branches — they share a registry string, not a byte on disk. It says
# `supervised rows name project <p>`, which is the literal measurement, and
# hands the session the ONE authority that can answer the rest.
#
# IT PRESCRIBES `peers list`, NOT `claims take`. The 200 that route returns
# carries PEER_ETIQUETTE verbatim, whose rule 0 IS "claim before you edit" — so
# the card points at the authority instead of paraphrasing it. Prescribing the
# claim directly would push every co-tenant at an 8-hour, alarm-invisible wedge
# with no precedence rule (`claimAttempt` never consults `runId`) and no client
# for the release valve. The hook names the CLIENT VERB, never the route, which
# is also what keeps `claims-advisory.test.ts`'s FORBIDDEN scan green.
_hook_ccrc_card() {
  CARD_CCRC=""
  [ -e "$CCRC_CARD_OFF" ] && return 0
  _ct_probe || return 0
  [ "$CT_N" -gt 0 ] || return 0      # SILENCE is the true answer for a lone row
  local n="other supervised rows name" s=""
  [ "$CT_N" -eq 1 ] && n="other supervised row names"
  [ "$CT_U" -eq 0 ] || s="at least "
  CARD_CCRC="ccrc: $s$CT_N $n project \`$CT_PROJ\`; \`~/.local/bin/ccrc-api peers list --of $id\` names them and returns the five peer rules."
  return 0
}

# ── THE PROGRAM SUBJECT (R7) ────────────────────────────────────────────
# QUOTE THE BYTES, NEVER NARRATE THE PROGRAM. `rundefs.ts` declares the reason
# string is never parsed back anywhere in this tree; `wave-lifecycle.md` forbids
# inferring a wave from it ("never parse a hold reason to learn what wave you
# are on. Ask `GET /api/runs`") and the coordinator skill forbids inferring a
# role — pinned VERBATIM by `coordinator-skill.test.ts`. So this function
# QUOTES and POINTS: the only thing it derives is WHICH SENTENCE to say.
#
# It is also empirically necessary. One program on this box read 1/5 -> 2/6 ->
# 3/6 -> 4/6 -> 5/7 -> 6/7 -> 7/8 -> 8/9: the denominator was revised upward
# five times, so "wave 3 of 6" would have been wrong five times over.
#
# THE SHAPE GATE IS THE SANITISER TOO. A hold that fails it is unspeakable and
# the subject is silent, which is what closes the ANSI, newline and oversize
# hazards structurally rather than by a clip that a later subject can forget.
# `=~` is affordable here — once per SessionStart, not once per row.
_hook_hold_card() {
  CARD_HOLD=""
  [ -e "$CCRC_CARD_OFF" ] && return 0
  local rc h wd="" subj="this workspace"
  _ct_read "$REG/$id.hold"; rc=$?
  [ "$rc" -eq 1 ] && return 0                      # absent — nothing to say
  if [ "$rc" -eq 2 ]; then                         # unreadable — doubt reads as HELD
    CARD_HOLD="ccrc-program: this workspace is held and the hold's reason could not be read — \`~/.cc-sessions/$id.hold\` exists but is not a readable file. Every other reader on this box treats that as HELD. If a program wave is running here, \`~/.local/bin/ccrc-api runs list\` is the only thing that can say so."
    return 0
  fi
  h="$CT_V"
  # CASE D'S THIRD SHAPE: PRESENT, READABLE, AND CARRYING NOTHING (I3, D-1902). Spec
  # §4.2 names it beside the directory and the mode-000 file — "a directory at
  # that path, mode 000, empty" — and rules all three get a sentence because
  # DOUBT READS AS HELD. It shipped unimplemented: an empty or whitespace-only
  # `.hold` returns rc 0 with `CT_V=""`, passes the length bound, fails the
  # shape gate and falls to SILENCE, telling a workspace every other reader on
  # this box calls HELD that there is nothing to say.
  #
  # It is reachable and it is already named twice in this tree.
  # `registry.ts`'s `HOLD_NO_REASON` — "`ccd ws-hold` refuses to write one, but
  # `touch $REG/<id>.hold` still does" — renders it `<hold file is empty — no
  # program named>`, and `cmd_ws_rm`/`cmd_ws_reap` refuse on `-e "$REG/$id.hold"`
  # without reading a byte.
  #
  # IT NEEDS ITS OWN CLAUSE, NOT CASE D'S. That sentence says the file "exists
  # but is not a readable file", which would itself be FALSE here — the file is
  # a perfectly readable file that carries no reason. So this says what is true
  # and hands over the one authority that can answer the rest, exactly as the
  # unreadable arm does.
  if [ -z "$h" ]; then
    CARD_HOLD="ccrc-program: this workspace is held and the hold names no program — \`~/.cc-sessions/$id.hold\` is present, readable, and carries no reason. \`ccd ws-hold\` refuses to write one that way, so a \`touch\` or a hand-edit did. Every other reader on this box treats a present \`.hold\` as HELD. If a program wave is running here, \`~/.local/bin/ccrc-api runs list\` is the only thing that can say so."
    return 0
  fi
  (( ${#h} <= CCRC_HOLD_MAX )) || return 0
  [[ "$h" =~ ^program:[A-Za-z0-9._-]+' 'wave:[0-9]+(/[0-9]+)?(' 'run:[0-9]+)?$ ]] || return 0
  # AN ARCHIVE DOES NOT CLEAR A HOLD. `cmd_ws_archive` does no registry rm, and
  # `close.ts`'s failed+archive arm releases nothing, so the bytes outlive the
  # workspace. Live on this box today.
  if [ -e "$REG/$id.archived" ]; then
    CARD_HOLD="ccrc-program: this workspace is stamped ARCHIVED and still carries a claim — \`~/.cc-sessions/$id.hold\` reads \`$h\`. An archive does not clear a hold, so those bytes are the residue of a claim, not an assignment. Take that to the operator rather than starting a wave on it."
    return 0
  fi
  # ONE EMITTED STRING, TWO REFERENTS. The graphify subject measures the
  # payload's cwd; this one measures the tmux session id. A session that cd'd,
  # or a second window opened in `cc-<held-id>`, makes "this workspace" and
  # "this tree" different subjects with no way for the reader to tell — so on
  # disagreement, or when the cwd could not be measured at all, the card names
  # the workspace by path and drops the demonstrative.
  _ct_read "$REG/$id.workdir" && wd="$CT_V"
  # THE WORKDIR IS A BYTE CHANNEL INTO A MODEL'S CONTEXT, AND THESE TWO GATES
  # ARE WHAT CLOSE IT (C1, D-1901). Do not relax either as noise. Every other value
  # card quotes is gated — `$h` by the anchored shape match AND
  # `CCRC_HOLD_MAX`, `$CT_PROJ` by `CCRC_PROJ_CLASS` AND `CCRC_PROJ_MAX`; `$id`
  # by its own class at the top of this file, a shape gate with no length bound
  # (which is why D-1903's sum treats its length as MODELLED). This one had
  # neither kind of gate, and it
  # is the same kind of string: registry text that lands VERBATIM in a session's
  # `additionalContext`, re-injected on every compaction, for as long as the
  # hold stands. `$REG/<id>.workdir` is a file ANY session on this box can
  # write — one UNIX user, `ccd` has no caller auth, and CLAUDE.md's own threat
  # model says outright not to assume server-side checks stop a session acting
  # directly — so ungated it carried backticks, newlines, ANSI escapes and
  # instruction-shaped prose from one session straight into a peer's context.
  # This card is the first mechanism in the tree that pipes another row's
  # registry bytes into a peer's model context; the hold bytes were gated for
  # exactly this reason and the workdir was missed.
  #
  # THE LENGTH BOUND IS `CCRC_HOLD_MAX`'S OFF-BY-ONE ARGUMENT APPLIED TO ITS
  # SIBLING, and it fixes a lie as well as a hazard. `_ct_read` reads at most
  # `CCRC_ID_MAX` (128) characters, so a value that comes back 128 long MAY
  # have been truncated. Ungated, a 132-character workdir that the cwd EQUALS
  # EXACTLY comes back cut to 128, compares unequal to `$GM_CWD`, and the card
  # takes the disagreement branch: it asserts a directory disagreement that does
  # not exist, beside a path that does not exist. Refusing at one under the read
  # cap means every path this subject quotes was captured WHOLE.
  #
  # ON FAILURE `wd=""` — SILENCE, NEVER A GUESS. An empty `$wd` makes the
  # condition below false, so the card falls back to the plain demonstrative
  # rather than asserting a disagreement it cannot measure. Same ruling as
  # Case C's: a value that fails a gate is never rendered.
  #
  # `case` plus `${#x}`, not an ERE — this file's own measured idiom (see
  # `CCRC_PROJ_CLASS` below); zero forks either way.
  (( ${#wd} <= CCRC_WD_MAX )) || wd=""
  case "$wd" in *[!$CCRC_WD_CLASS]*) wd="" ;; esac
  if [ -z "${GM_CWD:-}" ] || { [ -n "$wd" ] && [ "$GM_CWD" != "$wd" ]; }; then
    subj="the workspace \`$id\`${wd:+ (\`$wd\`)}"
  fi
  # WHAT THESE TWO SENTENCES MAY SAY ABOUT THE WORKER SKILL (D-1922). They
  # used to call the hold "the `ccrc-worker` skill's declared trigger" and to
  # name that skill's "first read". Both were false, and this card's whole
  # promise is that no sentence it emits can be. (a) The skill's declared
  # trigger (`worker-skill/SKILL.md:3`) is `program:<slug> wave:N/M` AND "you
  # are not the session that opened the run" — but the gate above accepts
  # `wave:N` with NO denominator, which `holdReason` really writes whenever
  # `waveOf === null` (`rundefs.ts:90-93`), and the second condition is not
  # measurable from this box at all. (b) The skill's first read is
  # `ccrc-api whoami` (SKILL.md:24-33, "Learn who you are, first"); `mail
  # list` appears NOWHERE in it. What survives is what the hook can measure:
  # the bytes name a program and a wave, and `mail list --to` is a real client
  # verb (`ccrc-api:100`) whose route excludes acked rows
  # (`outstandingMailFor`). So the card says that, and recommends the skill
  # rather than describing it.
  # NO ` run:` SUFFIX means no dispatch placed it: `closeRun`'s non-final arm
  # writes `holdReason(program, wave+1, waveOf, null)` for a run that does not
  # exist yet, and `ledger-template.md` still instructs a hand hold.
  case "$h" in
    *" run:"*) ;;
    *) CARD_HOLD="ccrc-program: $subj is claimed — \`~/.cc-sessions/$id.hold\` reads \`$h\`, which names a program and a wave — what the \`ccrc-worker\` skill is for. It names NO run: a close claimed this workspace for a next wave, or a human wrote it by hand — no dispatch placed it. Run \`~/.local/bin/ccrc-api runs list\` before acting on it; whether any run is open, and whether a brief was sent, are answered there and never by this file."
       return 0 ;;
  esac
  CARD_HOLD="ccrc-program: $subj is claimed — \`~/.cc-sessions/$id.hold\` reads \`$h\`, which names a program and a wave — what the \`ccrc-worker\` skill is for. Run that skill. Any brief sent to you is listed by \`~/.local/bin/ccrc-api mail list --to $id\`, and one you already acked is not listed again — the plan it named is the durable record. The hold can outlive the run that wrote it: whether that run is still open, and whether any brief was sent, are answered only by \`~/.local/bin/ccrc-api runs list\`, never by this file."
  return 0
}

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

# The hookstate writer's own tmp+mv idiom, MIGRATED TO THE §3.4 TARGET FAMILY
# GRAMMAR (D-2605): `compactset.<pid>.<nonce>.hook-write.tmp` after the literal
# `.<id>.` prefix. The pre-D-2605 name this replaces was `.$id.$$.${1##*/}.tmp`,
# which expands to `.<id>.<pid>.<id>.compactset.tmp` — the id occurring TWICE,
# not the bare `<pid>.compactset.tmp` an earlier draft assumed — and it is
# matched by nothing but the narrow, age-gated transition allowance below.
# Migrating it is what lets PreCompact's sweep be EXACT: a temp left by a hook
# killed between the printf and the `mv` is now a name the sweep can recognise
# by grammar rather than by a `*compact*.tmp` glob that would also match a
# stranger. The braces put the REDIRECTION's failure under the 2>/dev/null too
# (D-1691). The temp is a DOTFILE beside its target — invisible to every
# suffix-shaped registry glob — and `<pid>` plus the nonce keep two hooks apart.
_hook_write_atomic() {   # <path> <nonce> <text> -> 0 written whole; 1 nothing left behind
  local base="${1##*/}"; base="${base#"$id."}"
  local tmp="$REG/.$id.$base.$$.$2.hook-write.tmp"
  { printf '%s\n' "$3" > "$tmp"; } 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$1" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# THE EXACT FAMILY GRAMMAR (spec §3.4, "Exact lifecycle family inventory").
# Given a basename with the LITERAL `.<id>.` prefix already stripped, answer
# whether an AGED instance of it is this row's private compaction residue that
# a lock-holding sweep may remove. Exactness is the point: the pre-D-2605 sweep
# was `-name ".$id.*compact*.tmp"`, a glob that matches by coincidence rather
# than by family, and under the widened `_ws_slug_free` an unmatched residue
# reads FREE and re-hands the slug with a stranger's claim still present.
#
# The literal-prefix strip is what keeps a NESTED id out: `.demo.x.foo` and
# `.demo-x.foo` are different strings, and a suffix that did not strip keeps
# its leading dot, which no arm below can match — so an unrecognised name is
# LEFT ALONE rather than guessed at.
_hook_family_sweepable() {   # <suffix after the literal `.<id>.` strip> -> 0 iff aged private residue
  case "$1" in
    # THE PERMANENT LOCK, first and by name: it deliberately outlives the row,
    # spans generations and safe slug reuse, and no compliant path sweeps it.
    compactions.lock) return 1 ;;
    compactset.*.stage|compactcard.*.stage) return 0 ;;
    compactset.*.stage.part|compactcard.*.stage.part) return 0 ;;
    compactset.*.hook-write.tmp|compactcard.*.hook-write.tmp) return 0 ;;
    compactcard.*.session-claim.tmp) return 0 ;;
    compactpost.*.claim) return 0 ;;
    compactions.lock-init.*|compactions.lock-open.*) return 0 ;;
    compactserved-source.*) return 0 ;;
    # THE FINAL SERVED MARKER, and its cell says both things at once: PostCompact
    # removes it under its own validated final lock after it has been READ, and a
    # later locked AGE sweep reclaims one whose PostCompact never came — a missing
    # helper, a timed-out one, a refused shape gate. Without this arm the only
    # thing that ever reclaimed such a marker was `_reg_purge`, i.e. row
    # destruction, so every compaction that failed to settle left one permanent
    # file on a live row. The two patterns are disjoint: `compactserved.` cannot
    # match `compactserved-source.`, the character after the stem differing.
    compactserved.*) return 0 ;;
    generation-init.*|generation-read.*) return 0 ;;
    compactions-stage.*.tmp|compactions-snapshot.*.tmp) return 0 ;;
    # ── THE TRANSITION ALLOWANCE, exactly two legacy grammars ────────────
    # Both are pre-D-2605 producers this task migrated, and both are matched
    # only after the exact literal-ID strip, only past the age bound, and only
    # under a validated stable lock. Nothing else legacy is admitted, and this
    # allowance is what keeps a hook killed across the upgrade from leaving a
    # permanent dot-leading file.
    # ANCHORED ON A DECIMAL HEAD (r3 A-I2), exactly as the ccd twin
    # `_ws_private_family` already is (D-2801). The literal `.<id>.` strip is
    # not enough for THESE TWO ARMS: both patterns begin with a bare `*`, so a
    # second legal id nested under this one — `demo-quiet-basin.x-y` when this
    # row is `demo-quiet-basin`, the shape a dotted project DIRECTORY name
    # makes legal — still matches after the strip. MEASURED before this anchor:
    # one ordinary PreCompact for `demo-quiet-basin` deleted the neighbour's
    # `.demo-quiet-basin.x-y.999.compactcard-claim.tmp` and
    # `.demo-quiet-basin.x-y.777.demo-quiet-basin.x-y.compactset.tmp`, while
    # correctly keeping its target-family `compactpost` claim — every target
    # arm above names its family word first, so only these two leaked. The
    # consequence is the chain this function's header traces: the neighbour's
    # residue gone makes its slug read FREE under the widened `_ws_slug_free`
    # while its row may be half-purged. A legacy name's first component is the
    # WRITER'S PID, and a nested id's first component is the rest of its id, so
    # requiring a pure decimal head separates them.
    #
    # The claim grammar is pinned EXACTLY — decimal head, then the grammar and
    # nothing else. "Exactly two components" is the WRONG exactness test here
    # because the grammar itself carries a dot: measured on the ccd twin, that
    # spelling rejected the real `999.compactcard-claim.tmp`. The set grammar
    # carries the id in the MIDDLE and cannot be pinned that way, so one
    # contrived collision remains and is STATED rather than hidden — the same
    # one `_ws_private_family` discloses: an id whose own trailing component is
    # all digits (project `demo-quiet-basin.99`, slug `9`) presents a decimal
    # head after this id's strip. Legal, and its cost is one reclaimed legacy
    # tmp of a neighbour, inside the upgrade window.
    *.compactset.tmp)                        # `<pid>.<id>.compactset.tmp`
      [[ "${1%%.*}" =~ ^[0-9]+$ ]] || return 1
      return 0 ;;
    *.compactcard-claim.tmp)                 # `<pid>.compactcard-claim.tmp`
      [[ "${1#*.}" == "compactcard-claim.tmp" ]] || return 1
      [[ "${1%%.*}" =~ ^[0-9]+$ ]] || return 1
      return 0 ;;
  esac
  return 1
}

# ── THE PERMANENT STABLE LOCK (spec §3.4, "Stable lock") ─────────────────
# ONE mutex per registry row — `$REG/.<id>.compactions.lock` — deliberately
# spanning row generations and safe slug reuse. No path here unlinks, replaces,
# repairs, truncates, recreates or sweeps it; it is not slug residue precisely
# because it outlives the row. Two properties are what make it a real mutex
# rather than a pathname race, and each is pinned:
#
#  1. CANONICAL IS NEVER OPENED AT ITS OWN PATHNAME. `exec {fd}<>"$lock"` is
#     create-capable, so two racers can each create a DIFFERENT inode at the
#     same pathname and each be told by `flock` that it holds "the" lock —
#     nothing about either flock call looks wrong afterwards. Canonical is
#     published exactly once, by POSIX `link` off a private `mktemp` source
#     (measured on this box: `link src existing` is rc 1 `File exists` and
#     changes nothing; `link src fresh` is rc 0 and the two names share one
#     inode), and every acquisition afterwards opens a private hard-link ALIAS.
#     So no acquisition ever has a create-capable operation at canonical, and
#     every owner flocks the one canonical inode.
#  2. THE WAIT IS A PARAMETER, `flock -w "$1"`. This helper spells no constant
#     of its own, which is what lets COMPACT_LOCK_WAIT_SERVE (the one
#     acquisition a human waits on) and COMPACT_LOCK_WAIT (every other) be two
#     independently callable bounds through one code path. A helper that
#     hard-coded either would make the other unreachable, and no behaviour test
#     distinguishes "waited 2 s because it was asked to" from "waited 2 s
#     because that is all it knows".
#
# MECHANISM ABSENCE IS NOT CONTENTION. `command -v flock` is asked BEFORE any
# acquire is attempted, because a contended `flock -w` and a missing binary
# both spell their failure `1` (measured: uncontended acquire 0, contended
# acquire 1, `command -v` on a PATH without the binary 1), so the distinction
# can live only in WHICH probe answered — never in an exit status. `rc 2` is
# that condition and `rc 1` an ordinary refusal; the three hook arms treat
# rc 2 as fail-CLOSED (spec §3.4, "Platform outcome"), which is why this file
# still publishes no compaction artifact on a box without `flock`.
_hook_lock_same() {   # <fd> <canonical> -> 0 iff the FD's target and canonical are one regular inode
  local fd="$1" lock="$2" p=""
  if [ -e "/proc/self/fd/$fd" ]; then p="/proc/self/fd/$fd"
  elif [ -e "/dev/fd/$fd" ]; then p="/dev/fd/$fd"
  else return 1; fi
  # `-f` and `-ef` both FOLLOW the /proc symlink, so these read the FD's own
  # target: a FIFO, a directory and a symlink at canonical each fail here
  # (measured), and a canonical REPLACED since the open fails `-ef`.
  [[ -f "$p" ]] || return 1
  [[ -f "$lock" && ! -L "$lock" ]] || return 1
  [[ "$p" -ef "$lock" ]] || return 1
  return 0
}

# ── IS AN ABSENT CANONICAL A FIRST-EVER MINT, OR A LATER DISAPPEARANCE? ──
# §4: "a later canonical disappearance/replacement refuses, never recreates
# it." Without this the two are indistinguishable and the mint arm publishes a
# SECOND inode at the same pathname while a live holder still owns the first —
# two processes each told by `flock` that it holds "the" lock, which is the
# exact hazard this file's header says the link-based design exists to remove.
# MEASURED before this function existed, with two real processes: holder
# acquires (canonical inode 167576), a stranger unlinks canonical, a second
# acquirer runs -> `RC=0`, canonical recreated at inode 167577.
#
# TWO ARMS, BECAUSE ONE OF THEM CANNOT SEE THE SCENARIO §4 NAMES.
#
#  (a) AN ACQUISITION IN FLIGHT leaves its exact-family alias on disk between
#      its `link` and the `rm -f` that follows its `exec`. Short, but a real
#      window, and a real on-disk state a fixture can construct.
#
#  (b) A LIVE HOLDER PAST ITS ACQUIRE LEAVES NO NAME AT ALL. MEASURED: with a
#      real process holding this lock, `$REG` lists exactly
#      `.<id>.compactions.lock`, and ZERO `lock-open` aliases — the acquire
#      unlinks its alias immediately and deliberately, so (a) alone is blind to
#      the very race the spec names. What the holder does keep is a DESCRIPTOR
#      on the unlinked inode, and Linux names it: MEASURED,
#      `/proc/<pid>/fd/<n>` reads back
#      `…/.<id>.compactions.lock-open.<pid>.<r>.<r> (deleted)` while the holder
#      lives, and nothing after it is killed.
#
# EXACT FAMILY, NEVER A SUBSTRING: the literal `.<id>.compactions.lock-open.`
# prefix, so a NESTED id (`demo.quiet` beside `demo`, legal because project
# directory names may hold dots) answers only for itself.
#
# ARM (b) IS GATED THREE TIMES, because it is the only expensive thing in this
# file. First on an ABSENT canonical, which is out of contract and essentially
# never true. Then on `$REG/<id>.generation`, the same witness `_reg_purge`
# gates its own fail-open on: minted only by a flock-capable row creation, so
# its ABSENCE proves no hook on this row ever held this lock and the absent
# canonical is an ordinary first-ever mint. Then on `/proc` and `find` being
# there at all — `find` is asked for rather than assumed, and where `-lname`
# or `-quit` is missing the expression simply finds nothing and this function
# answers "first-ever mint", which is the pre-D-2605 behaviour and is stated as
# a residual rather than hidden behind a refusal this arm could not justify.
#
# WHAT IS STILL UNDETECTED, stated rather than implied: a live holder on a row
# with NO generation. The only in-design holder of that shape is row creation
# itself, between its own acquire and its `_reg_generation_init` — and row
# creation owns the slug exclusively for that window, so there is no second
# actor for it to race.
_hook_lock_vanished() {   # -> 0 iff an ABSENT canonical is a LATER disappearance, not a first-ever mint
  local f
  for f in "$REG/.$id.compactions.lock-open."*; do
    { [ -e "$f" ] || [ -L "$f" ]; } && return 0
  done
  # THE ROW MUST BE LIVE BEFORE ANYTHING EXPENSIVE RUNS. `<id>.generation` is
  # the same witness `_reg_purge` gates its fail-open on: it is minted only by a
  # flock-capable row creation, so its ABSENCE proves no hook on this row ever
  # held this lock and an absent canonical is an ordinary first-ever mint. With
  # it absent this function is one glob and no fork, which is what every real
  # `ws-add` and `start` pays.
  [ -e "$REG/$id.generation" ] || [ -L "$REG/$id.generation" ] || return 1
  [ -d /proc ] || return 1
  command -v find >/dev/null 2>&1 || return 1
  # ONE FORK, NOT ONE PER DESCRIPTOR. MEASURED on this box (517 processes, 2662
  # `/proc/<pid>/fd` entries): a bash loop calling `readlink` per entry takes
  # 7.8-8.4 s — longer than COMPACT_LOCK_WAIT itself — while this single
  # `find -lname … -quit` takes 0.16 s. `-lname` matches the SYMLINK TARGET,
  # which for an unlinked file reads `<pathname> (deleted)`, so the exact-family
  # prefix still matches.
  [[ -n "$(find /proc -mindepth 3 -maxdepth 3 -path '/proc/[0-9]*/fd/*' \
             -lname "$REG/.$id.compactions.lock-open.*" -print -quit 2>/dev/null)" ]] || return 1
  return 0
}

_hook_lock_init() {   # <canonical> -> 0 canonical exists and validates; 1 otherwise
  local lock="$1" src=""
  # EEXIST MEANS VALIDATE THE INCUMBENT — never open it, never recreate it.
  if [ -e "$lock" ] || [ -L "$lock" ]; then
    [[ -f "$lock" && ! -L "$lock" ]] || return 1
    return 0
  fi
  # The template's terminal `XXXXXX` is a template, not a pathname: the created
  # basename is `.<id>.compactions.lock-init.<mktemp6>` (measured, six chars,
  # mode 600 under the subshell's `umask 077`).
  src=$( umask 077; mktemp "$REG/.$id.compactions.lock-init.XXXXXX" 2>/dev/null ) || return 1
  [[ -f "$src" && ! -L "$src" ]] || { rm -f "$src" 2>/dev/null; return 1; }
  link "$src" "$lock" 2>/dev/null || true
  # THE SOURCE GOES ON EVERY HANDLED RESULT — success, EEXIST and failure
  # alike — so the first publish can never leak a private file.
  rm -f "$src" 2>/dev/null || true
  [[ -f "$lock" && ! -L "$lock" ]] || return 1
  return 0
}

_hook_lock_acquire() {   # <wait-seconds> -> 0 acquired (HOOK_LOCK_FD set); 1 refused; 2 mechanism absent
  local lock="$REG/.$id.compactions.lock" al="" fd="" tries=0
  HOOK_LOCK_FD=""
  # WHY, NOT A SECOND STATUS. Every one of this file's six acquire sites reads
  # the acquire as a boolean (`|| return 0`) and ccd's five read the VALUE with
  # two of them — `cmd_start` and `_spawn_start` — falling through an unknown
  # code into a silent continue, so a third numeric status would be a distinct
  # refusal nobody distinguishes. The condition is carried in a named
  # out-parameter instead, the way `GC_DIRTY_WHY` and `_WS_NESTED_WHY` already
  # carry theirs, and cleared on entry so a stale one is never read as this
  # call's.
  HOOK_LOCK_WHY=""
  command -v flock  >/dev/null 2>&1 || return 2
  command -v mktemp >/dev/null 2>&1 || return 2
  command -v link   >/dev/null 2>&1 || return 2
  # REFUSE BEFORE THE MINT, so "recreates no canonical" is a mechanism and not
  # an intention: nothing has been created at this point, so the refusal owns
  # nothing to clean up and the holder's inode is never displaced.
  if [ ! -e "$lock" ] && [ ! -L "$lock" ] && _hook_lock_vanished; then
    HOOK_LOCK_WHY=canonical-vanished
    return 1
  fi
  _hook_lock_init "$lock" || return 1
  # An absent exact-family alias, NEVER precreated: two independent decimal
  # $RANDOM components, and a candidate collision retries rather than adopting
  # a stranger's name.
  while (( tries < 8 )); do
    al="$REG/.$id.compactions.lock-open.$$.$RANDOM.$RANDOM"
    [ -e "$al" ] || [ -L "$al" ] || break
    al=""; tries=$(( tries + 1 ))
  done
  [[ -n "$al" ]] || return 1
  [[ -f "$lock" && ! -L "$lock" ]] || return 1
  link "$lock" "$al" 2>/dev/null || return 1
  [[ -f "$al" && ! -L "$al" ]] || { rm -f "$al" 2>/dev/null; return 1; }
  # A failed `exec` redirection returns 1 and does NOT exit a non-interactive
  # bash (measured); the `2>/dev/null` is what keeps this file's stderr-silence
  # contract, since the failure message is printed by the shell itself.
  # `{ exec …; } 2>/dev/null`, NEVER `exec … 2>/dev/null`. MEASURED, and it is
  # a real defect rather than a style point: `exec` with redirections and NO
  # COMMAND applies them to THE SHELL, permanently — so the bare form silences
  # this process's stderr for the rest of the run, not just for the open.
  # (Caught by `ccd-spawn-split.test.ts`'s operator-facing resume warning going
  # missing on the ccd side; the same idiom is here, where the contract is
  # silence anyway and nothing would have reddened.) A `{ …; }` group is not a
  # subshell, so the `{fd}` assignment still lands in this scope, and a failed
  # open still returns 1.
  { exec {fd}<>"$al"; } 2>/dev/null || { rm -f "$al" 2>/dev/null; return 1; }
  # THE ALIAS GOES NOW, on success and on every handled failure below: the FD is
  # the only reference this process keeps, so a completed acquisition leaves
  # zero owned artifacts and a crash leaves at most one aged, exact-family name.
  rm -f "$al" 2>/dev/null || true
  _hook_lock_same "$fd" "$lock" || { { exec {fd}>&-; } 2>/dev/null; return 1; }
  flock -w "$1" "$fd" 2>/dev/null || { { exec {fd}>&-; } 2>/dev/null; return 1; }
  _hook_lock_same "$fd" "$lock" || { { exec {fd}>&-; } 2>/dev/null; return 1; }
  HOOK_LOCK_FD="$fd"
  return 0
}

# ── THE GENERATION GATE (spec §3.1 step 5, §3.3, §3.4) ───────────────────
# `$REG/<id>.generation` is the row's AUTHORIZATION, minted once by ccd's row
# creation and handed to this process in its environment by `_spawn_start`.
# Every lifecycle arm validates the two against each other UNDER THE LOCK,
# before it inspects, reads, claims, deletes, emits or publishes anything.
#
# IT FAILS CLOSED, and the cost is disclosed rather than hidden: a session
# whose spawn could not read a generation — a pre-D-2605 row, or a spawn whose
# acquire was contended — publishes NO compaction artifact for its whole life,
# until its next respawn. That is the property ccd's own fail-open at
# `_reg_purge` is gated on: absence of the generation proves no hook on that row
# ever received one, so no hook arm ever ran the lifecycle and there is nothing
# for a destructive verb to race.
#
# WHY THE ENVIRONMENT AND THE FILE BOTH: the environment value is what this
# PANE was authorized with, the file is what the ROW is authorized with now, and
# a mismatch means the row was purged and re-created under a pane that outlived
# it. Publishing then would write one session's measurement into another's slot.
# The read goes through the same owned hard-link alias ccd's side uses — never a
# bare `cat` on a pathname that can be replaced between the test and the read.
_hook_generation_ok() {   # -> 0 iff this pane's generation is the row's current one
  local want="${CCRC_SESSION_GENERATION:-}" p="$REG/$id.generation" al="" fd="" tries=0 got=""
  [[ -n "$want" ]] || return 1
  [[ "$want" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 1
  [[ -f "$p" && ! -L "$p" && -r "$p" ]] || return 1
  command -v link >/dev/null 2>&1 || return 1
  while (( tries < 8 )); do
    al="$REG/.$id.generation-read.$$.$RANDOM.$RANDOM"
    [ -e "$al" ] || [ -L "$al" ] || break
    al=""; tries=$(( tries + 1 ))
  done
  [[ -n "$al" ]] || return 1
  link "$p" "$al" 2>/dev/null || return 1
  [[ -f "$al" && ! -L "$al" ]] || { rm -f "$al" 2>/dev/null; return 1; }
  { exec {fd}<"$al"; } 2>/dev/null || { rm -f "$al" 2>/dev/null; return 1; }
  rm -f "$al" 2>/dev/null || true
  # 37, not 36: a 37-character read SEES a trailing LF or a longer file, where a
  # 36-character one would silently accept the first 36 bytes of either.
  IFS= read -r -N 37 got <&"$fd" 2>/dev/null || true
  # STILL THE SAME INODE: a canonical replaced since the `link` is a different
  # row's authorization wearing this name.
  if ! _hook_lock_same "$fd" "$p"; then { exec {fd}<&-; } 2>/dev/null; return 1; fi
  { exec {fd}<&-; } 2>/dev/null || true
  [[ "$got" == "$want" ]] || return 1
  return 0
}

_hook_lock_release() {   # <fd> -> close it; the flock lifts when the LAST reference closes
  local fd="${1-}"
  # An empty operand is `ambiguous redirect` (measured), so the guard is real
  # rather than defensive; closing an already-closed descriptor is rc 0.
  [[ -n "$fd" ]] || return 0
  { exec {fd}>&-; } 2>/dev/null || true
  return 0
}

# ── THE PRE-MUTATION IDENTITY RE-CHECK (spec §3.4, stable lock item 3) ────
# Item 3 asks the holder to prove its descriptor still names canonical BEFORE
# EACH MUTATION, not only across its own `flock`. The acquire's paired checks
# cannot stand in for that, and the gap is MEASURED rather than argued (r3 R1),
# in a fixture $REG with the SHIPPED acquire on both sides:
#
#   holder H acquires (rc 0) and a stranger's `flock -n` on canonical answers
#   1 — H really holds it. A same-UID actor then UNLINKS canonical and mints a
#   fresh inode at the same pathname off a private `mktemp` source, exactly as
#   the acquire itself mints one: inode 1591479 -> 1591427. A second acquirer S
#   runs the same shipped acquire and GETS IT — rc 0, fd 11, no `WHY` — while H
#   is still alive and still inside its section. CONTROL, same fixture with the
#   replacement suppressed: S answers rc 1. So the instrument is real, and the
#   two processes genuinely hold one pathname's mutex at once.
#
# D-2793 refuses a canonical DISAPPEARANCE, and this is a REPLACEMENT: the
# acquire's `[ -e "$lock" ]` arm is satisfied, the vanished probe never runs,
# and every identity check the acquire makes compares the NEW inode with
# itself. Nothing in the acquire CAN see it, because by the time it happens the
# acquire has returned. Only the holder can, and only by asking again.
#
# The check itself is `_hook_lock_same`, unchanged and uncopied — the identity
# predicate has one definition, and this is a NAME for calling it at a second
# moment, not a second implementation of it.
#
# WHY THERE IS NO ccd TWIN, MEASURED RATHER THAN OMITTED. The same rule was
# built for `_reg_purge` and then REFUSED on the measurement, because that
# function has no placement where the check both helps and stays truthful:
#
#   - Before its unconditional `_lc_done purge` emit is the only spot where a
#     refusal can honestly answer 1 ("nothing deleted, no purge fact"), and
#     there it is ADJACENT to the acquire's own post-`flock` identity check —
#     nothing runs between them, so it closes a zero-width window.
#   - Before the unlink loop is where the window is real (the emit's own
#     `_reg_get` children have run by then), and there NO status in
#     `_reg_purge`'s vocabulary is true: 1 and 2 both assert no purge fact, 3
#     asserts the row IS destroyed. A refusal told by any of them fabricates a
#     cause, which is the defect D-2782 was minted to end.
#   - Measured, the before-emit form also reds two shipped guards that exist on
#     purpose: `ccd-lifecycle-purge`'s "the acquisition is the ONE statement
#     before the unconditional emit" (nothing there may GATE the purge) and
#     this suite's canonical-write census, which read the guard's own release
#     as an early unlock and reported two later unlinks as lock-free.
#
# So the ccd side's residual is STATED rather than closed: a canonical
# replacement landing between `_reg_purge`'s emit and its unlinks is not
# refused today, and closing it needs a fourth status and four caller arms.
_hook_lock_still_canonical() {   # <fd> -> 0 iff this descriptor is STILL the canonical inode
  _hook_lock_same "${1-}" "$REG/.$id.compactions.lock"
}

# ── PreCompact (spec §3.1): THE SET ALWAYS, THE CARD WITH A GRAPH ────────
# Called from the very end of this file, AFTER the hookstate rename: the
# `working` stamp lands first and never waits on the helper (Task 6's sole
# deadline is locally resolved as `timeout` or `gtimeout`). Prints nothing —
# stage 1. Every failure is silent and total for what comes after it.
_hook_compact_pre() {
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local tp="" trig="" set="$REG/$id.compactset" cardf="$REG/$id.compactcard" doc="" at="" nonce="" rc=0 helper_rc=0 lockfd=""
  local aged="" cand="" suffix="" setstage="" cardstage="" ownhead="" ovl="false"
  local mins=$(( COMPACT_CARD_MAX_AGE / 60 ))
  tp=$(jq -r '.transcript_path // empty' <<<"$payload" 2>/dev/null) || return 0
  trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || trig="auto"
  _hook_compact_scope "$tp" "$trig" || return 0
  # MEASURED OUTSIDE THE LOCK, DELIBERATELY (spec §3.1, round 7 option A).
  # Scope resolution and the graph measurement both fork and can be slow, and
  # neither reads nor writes a canonical artifact — holding the row's mutex
  # across them would serialise every sibling context of this session behind
  # work that has nothing to exclude. The source-order pin over this function
  # asserts exactly that: the acquire below sits AFTER both of these calls and
  # BEFORE the overlap `find`.
  rc=0; _hook_graph_measure || rc=$?
  # ACQUIRE. From here to the release, this arm owns the row: the overlap
  # verdict, the sweep and the initial canonical publication are one
  # uninterrupted section, so no sibling can publish between the check and the
  # act. A refusal (rc 1) or an absent mechanism (rc 2) publishes NOTHING —
  # there is no unlocked fallback, which is what keeps §10's "no second
  # lock-free concurrency regime" true.
  _hook_lock_acquire "$COMPACT_LOCK_WAIT" || return 0
  lockfd="$HOOK_LOCK_FD"
  # STEP 5: the generation, validated UNDER the lock and before any inspection.
  _hook_generation_ok || { _hook_lock_release "$lockfd"; return 0; }
  # OVERLAP (spec §3.0). One slot per session id, and every context of the
  # session writes it. An unconsumed set still inside the in-flight window
  # means another compaction is in flight (or failed inside the window), and
  # no later arm can tell which context it serves — so BOTH degrade: this one
  # is ambiguous and the earlier one's card is removed. The helper makes the
  # verdict durable by re-reading the slot before each of its own writes.
  # ONE `find`, two subjects: an unconsumed canonical set inside the window, and
  # a young PostCompact claim, which is the same evidence one settlement step
  # later — a compaction whose set has already been claimed is still in flight.
  if [ -n "$(find "$REG" -maxdepth 1 \( -name "$id.compactset" -o -name ".$id.compactpost.*.claim" \) -mmin "-$mins" 2>/dev/null)" ]; then
    CS_SCOPE="ambiguous"; CS_TRANSCRIPT=""; CS_AGENT=""; ovl="true"
  fi
  # ITEM 3 (r3 R1), and the first of this section's three: `find` ran between
  # the acquire and here, so this is a fresh moment and it gets a fresh proof.
  _hook_lock_still_canonical "$lockfd" || { _hook_lock_release "$lockfd"; return 0; }
  [[ "$CS_SCOPE" != ambiguous ]] || rm -f "$cardf"
  # THE SWEEP — EXACT FAMILY, age-gated, under this held lock. A hook killed
  # between a temp write and its rename leaves a dot-leading private file
  # invisible to `_reg_purge`'s dot-free loop, so somebody must reap it; but
  # the pre-D-2605 `-name ".$id.*compact*.tmp" -delete` reaped by COINCIDENCE,
  # and it is the code this task replaces, not merely re-comments. Candidates
  # are enumerated by one `find` into a variable — `$( )` is synchronous, where
  # a `< <( )` process substitution's child is not a child this shell waits for,
  # which matters inside a held lock section — and each basename is then
  # matched against the exact family grammar.
  aged=$(find "$REG" -maxdepth 1 -name ".$id.*" -mmin "+$mins" 2>/dev/null) || aged=""
  # ITEM 3 again: the `find` above is a synchronous child, which is exactly the
  # window a replacement lands in. One proof covers the whole loop because the
  # loop forks nothing.
  _hook_lock_still_canonical "$lockfd" || { _hook_lock_release "$lockfd"; return 0; }
  while IFS= read -r cand; do
    [[ -n "$cand" ]] || continue
    suffix="${cand##*/}"; suffix="${suffix#".$id."}"
    _hook_family_sweepable "$suffix" || continue
    rm -f "$cand" 2>/dev/null || true
  done <<<"$aged"
  at=$(_hook_epoch_ms)
  nonce="compact-${at}-${$}-${RANDOM}-${RANDOM}"
  # `at` is the epoch-ms measurement. The nonce is the collision-resistant slot
  # identity, preserved in the set head and passed to the helper/card line 1.
  # `overlap` IS THE ONLY CHANNEL §3.0 GIVES POSTCOMPACT to tell an
  # overlap-DEGRADED set from a genuinely ambiguous verdict: the branch above
  # writes the same `scope` for both, and the two prescribe different records
  # (a forced one may attribute nothing at all). It is published HERE and only
  # here. The Task-1–8 helper rewrites the set WITHOUT this member, which §3.0
  # rules legacy-compatible ordinary/false — and that is sound rather than
  # merely tolerated, because a `true` value never reaches the helper at all:
  # the ambiguous return below sits between this publication and the helper
  # fork, so every set the helper rewrites had `overlap:false`.
  doc=$(jq -cn --arg scope "$CS_SCOPE" --arg agent "$CS_AGENT" --arg t "$CS_TRANSCRIPT" \
      --arg pl "$CS_PARENT_LIVE" --arg ln "$CS_LIVE_N" --arg nonce "$nonce" --arg ovl "$ovl" \
      --arg cwd "$GM_CWD" --arg built "$GM_BUILT" --arg fresh "$GM_FRESH" --argjson at "$at" \
      '{v:1, at:$at, nonce:$nonce, scope:$scope, overlap:($ovl == "true"),
        agent:(if $agent=="" then null else $agent end),
        transcript:(if $t=="" then null else $t end),
        parentLive:(if $pl=="true" then true elif $pl=="false" then false else null end),
        liveAgents:(if $ln=="" then null else ($ln|tonumber) end),
        cwd:(if $cwd=="" then null else $cwd end),
        built:(if $built=="" then null else $built end),
        fresh:(if $fresh=="" then null else $fresh end),
        steered:false, files:null, stats:null}' 2>/dev/null) || { _hook_lock_release "$lockfd"; return 0; }
  # ITEM 3, the third: `date` and `jq` both ran since the last proof, and this
  # is the section's one canonical PUBLICATION.
  _hook_lock_still_canonical "$lockfd" || { _hook_lock_release "$lockfd"; return 0; }
  _hook_write_atomic "$set" "$nonce" "$doc" || { _hook_lock_release "$lockfd"; return 0; }
  # RELEASE BEFORE THE HELPER FORK (spec §3.1, round 6/7). A held `flock`
  # descriptor is inherited across fork/exec in bash — measured, an exec'd
  # child's `/proc/self/fd` lists the parent's lock fd, and the lock lifts only
  # when EVERY referencing descriptor closes — so a helper that outlived its
  # deadline would hold this row's mutex with it. Every child forked ABOVE this
  # line is synchronous and reaped inside the section, which is what makes
  # holding the descriptor across them compliant.
  _hook_lock_release "$lockfd"; lockfd=""
  [[ "$CS_SCOPE" != ambiguous ]] || return 0
  [ "$rc" -eq 0 ] && _hook_gate_tree || return 0
  [ -f "$COMPACT_HELPER" ] || return 0
  # STEP 10. TWO PRIVATE STAGE PATHS THIS ARM NAMES ITSELF, and NO canonical
  # pathname anywhere in the helper's argv — the load-bearing property of
  # round 7's option A. `--parent-live`/`--live-agents` carry the two §3.0
  # provenance values verbatim, because with `--set` gone the helper has no
  # other channel to learn them and deriving them from `--scope` would be a
  # different measurement wearing the same name. There is no `--trigger`: the
  # record's trigger comes from the PostCompact payload at `measure` time.
  setstage="$REG/.$id.compactset.$$.$nonce.stage"
  cardstage="$REG/.$id.compactcard.$$.$nonce.stage"
  _hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" card \
    --transcript "$CS_TRANSCRIPT" --cwd "$GM_CWD" \
    --graph "$GM_CWD/graphify-out/graph.json" \
    --labels "$GM_CWD/graphify-out/.graphify_labels.json" \
    --set-stage "$setstage" --card-stage "$cardstage" \
    --parent-live "$CS_PARENT_LIVE" --live-agents "$CS_LIVE_N" \
    --max-chars "$COMPACT_CARD_MAX_CHARS" --max-files "$COMPACT_WORKSET_MAX" \
    --built "$GM_BUILT" --fresh "$GM_FRESH" --scope "$CS_SCOPE" --at "$at" --nonce "$nonce" \
    ${CS_AGENT:+--agent "$CS_AGENT"} >/dev/null 2>&1
  helper_rc=$?
  # STEP 11. REACQUIRE. A miss leaves the two stages exactly where they are, as
  # age-eligible exact-family residue a later lock-holding sweep reclaims, and
  # publishes nothing — never an unlocked rename.
  _hook_lock_acquire "$COMPACT_LOCK_WAIT" || return 0
  lockfd="$HOOK_LOCK_FD"
  # STEP 12, first half: the generation AGAIN. The row can be purged and
  # re-created while the helper runs, and a rename taken on that authority
  # would publish this pane's measurement into another session's slot.
  if ! _hook_generation_ok; then
    rm -f "$cardstage" "$setstage" "$cardstage.part" "$setstage.part" 2>/dev/null || true
    _hook_lock_release "$lockfd"; return 0
  fi
  # STEP 12, SECOND HALF: WHAT THE CANONICAL PATHNAME NOW HOLDS, asked before
  # it is opened (r3 A-I1). Across the helper window this arm holds no lock by
  # design, so the object at `$set` on reacquire may be anything a same-UID
  # stranger left there — and `2>/dev/null` silences NOTHING for the read
  # below: a FIFO blocks in open(2) rather than failing, so the redirection
  # never returns. Measured, that parks this process INSIDE the held stable
  # lock for ever, and because Task 9 put `_reg_purge` under the same lock it
  # takes the row's whole destruction path with it — every later PreCompact,
  # PostCompact and compact SessionStart, plus `ccd ws-rm`, `ccd forget`,
  # `ccd ws-gc --prune`, `ccd ws-reap` and `ws-add`/`start` for that slug,
  # refuse that row permanently. That is the wedge §3.4's fail-open ruling
  # exists to prevent, reached by an unbounded hang instead of a refusal.
  # The sibling arms already ask exactly this — PostCompact's settlement
  # (`[[ -f "$set" && ! -L "$set" && -r "$set" ]]`) and the serve arm's
  # `[[ -f "$set" && -r "$set" ]]` — and this was the only arm without it and
  # the only one whose failure had no bound.
  #
  # A FAILURE HERE READS "THE SLOT IS NOT OURS", the same disposition as the
  # nonce miss below: drop this process's own stages and publish nothing. An
  # ABSENT set keeps today's semantics EXACTLY rather than gaining a new one —
  # the redirection already failed silently, `ownhead` already stayed empty and
  # the nonce test below already published nothing — the arm simply now says so
  # before the open rather than after it.
  if ! [[ -f "$set" && ! -L "$set" && -r "$set" ]]; then
    rm -f "$cardstage" "$setstage" "$cardstage.part" "$setstage.part" 2>/dev/null || true
    _hook_lock_release "$lockfd"; return 0
  fi
  # STEP 12. THE COMPARE-AND-SWAP. Re-read the canonical set's HEAD with the
  # bounded, fork-free `read -N` idiom this file already uses on the serve side
  # and require the nonce to still be ours. Bash has no `slotIsMine`
  # counterpart and does not need one: because this check and the renames below
  # sit inside the SAME held section, they are one compare-and-swap — which
  # round 6's helper-side check, whose act was a separate later write, could
  # never be. A sibling that published its own verdict while the helper ran
  # owns the slot now, and this arm publishes NOTHING over it.
  IFS= read -r -N 4096 ownhead 2>/dev/null < "$set"
  # ITEM 3, before the two renames: the reacquire proved identity at ITS
  # moment, and the whole helper window sat before it. The disposition is this
  # arm's own — drop this process's stages, publish nothing.
  if ! _hook_lock_still_canonical "$lockfd"; then
    rm -f "$cardstage" "$setstage" "$cardstage.part" "$setstage.part" 2>/dev/null || true
    _hook_lock_release "$lockfd"; return 0
  fi
  if [[ "$ownhead" =~ \"nonce\":\"([^\"]+)\" ]] && [[ "${BASH_REMATCH[1]}" == "$nonce" ]]; then
    # STEP 13. CARD BEFORE SET, one uninterrupted section. In stage 2 the print
    # and the `steered` stamp sit between these two renames; Plan A runs
    # neither, so the helper's staged `steered:false` is published unchanged.
    if [[ "$helper_rc" == 0 ]]; then
      mv -f "$cardstage" "$cardf" 2>/dev/null || true
      mv -f "$setstage" "$set" 2>/dev/null || true
    elif [[ "$helper_rc" == 3 ]]; then
      mv -f "$setstage" "$set" 2>/dev/null || true
    fi
  fi
  # ONLY THIS PROCESS'S OWN STAGES, on every non-publishing outcome — a failed
  # reconfirm, a non-0/3 exit, a timeout — and a no-op after a successful
  # rename. The `.part` names are the helper's own mid-write residue.
  rm -f "$cardstage" "$setstage" "$cardstage.part" "$setstage.part" 2>/dev/null || true
  # STEP 14.
  _hook_lock_release "$lockfd"; lockfd=""
  return 0
}

# ── PostCompact (spec §3.4): SETTLE, MEASURE, COMMIT ONE JOURNAL LINE ─────
# The compaction's sole authoritative measurement, and the one phase whose lock
# miss loses something UNRECOVERABLE rather than something a later aged sweep
# repairs — which is why it takes the same COMPACT_LOCK_WAIT settlement uses
# rather than a shorter bound of its own.
#
# THE TWO BRANCHES ARE DISTINGUISHED BY A PATHNAME TEST, NOT BY A `link`
# RETURN CODE. A genuinely absent canonical set and a present-but-unlinkable
# one both surface as a failing `link` in bash, and folding them together
# silently unmeasures whichever population is absent. Under option A that test
# now has exactly ONE meaning, too: every canonical existence transition and
# every existence test happens inside a held stable-lock section, and no
# PreCompact-side rollback survives to compose with, so "absent under this
# lock" means nothing was ever published for this compaction.
_hook_compact_post() {
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local set="$REG/$id.compactset" journal="$REG/$id.compactions"
  local summary="" trig="" lockfd="" claim="" snap="" stage="" jfd="" claimfd=""
  # Cleared on entry for the reason every out-parameter in this tree is: a
  # value from a previous call read as this one's is the fabricated fact.
  POST_CLAIM_FD=""
  local present=0 meas="" rec="" nonce="" cand="" served="false" tries=0 head="" old=""
  local aged=0 norm=""
  summary=$(jq -r '.compact_summary // empty' <<<"$payload" 2>/dev/null) || return 0
  [[ -n "$summary" ]] || return 0
  trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || trig="auto"
  [[ "$trig" == manual || "$trig" == auto ]] || trig="auto"
  command -v find   >/dev/null 2>&1 || return 0
  command -v touch  >/dev/null 2>&1 || return 0
  command -v mktemp >/dev/null 2>&1 || return 0
  [ -f "$COMPACT_HELPER" ] || return 0

  # ── SETTLEMENT, under the row's mutex ──────────────────────────────────
  _hook_lock_acquire "$COMPACT_LOCK_WAIT" || return 0
  lockfd="$HOOK_LOCK_FD"
  _hook_generation_ok || { _hook_lock_release "$lockfd"; return 0; }
  if [ -e "$set" ] || [ -L "$set" ]; then present=1; fi
  if (( present )); then
    if ! [[ -f "$set" && ! -L "$set" && -r "$set" ]]; then _hook_lock_release "$lockfd"; return 0; fi
    while (( tries < 8 )); do
      claim="$REG/.$id.compactpost.$$.$RANDOM.$RANDOM.claim"
      [ -e "$claim" ] || [ -L "$claim" ] || break
      claim=""; tries=$(( tries + 1 ))
    done
    [[ -n "$claim" ]] || { _hook_lock_release "$lockfd"; return 0; }
    # NEVER PRECREATED: `link` is the create, so exactly one process can win
    # this name, and the claim is this compaction's private copy of canonical.
    link "$set" "$claim" 2>/dev/null || { _hook_lock_release "$lockfd"; return 0; }
    [[ "$claim" -ef "$set" ]] || { rm -f "$claim" 2>/dev/null; _hook_lock_release "$lockfd"; return 0; }
    # THE ORIGINAL AGE, MEASURED HERE AND NOWHERE LATER (spec §3.0's fourth
    # normalisation trigger). It has to be read before the `touch` below,
    # because HARD LINKS SHARE MTIME: after that stamp the claim — and the
    # inode canonical used to name — both read young, and the pre-settlement
    # age is unrecoverable. This is the measurement `command -v find` above is
    # the guard for; without it that guard guards nothing.
    #
    # An aged set is still CLAIMED and still consumed. Age gates only what may
    # be ATTRIBUTED: a PreCompact that went inert for one of its documented
    # silent reasons leaves a PREVIOUS compaction's set standing, and copying
    # its transcript, agent and cwd onto this compaction's line is a wrong
    # record — worse than a missing one. A `find` that answers nothing, for any
    # reason, reads AGED, which is the direction that attributes less.
    [ -n "$(find "$set" -mmin "-$(( COMPACT_CARD_MAX_AGE / 60 ))" 2>/dev/null)" ] || aged=1
    # UNLINK CANONICAL BEFORE TOUCHING THE CLAIM, and the order is the whole
    # point: HARD LINKS SHARE MTIME (measured), so a `touch` taken while both
    # names still point at one inode would age canonical too, and a sibling's
    # overlap check would then read this settled compaction as still in flight.
    # ITEM 3, before the settlement's own two mutations: a `find` ran just
    # above for the age measurement, so the proof is taken again here. The
    # disposition is the one the `rm` failure below already uses.
    if ! _hook_lock_still_canonical "$lockfd"; then
      rm -f "$claim" 2>/dev/null || true
      _hook_lock_release "$lockfd"; return 0
    fi
    if ! rm -f "$set" 2>/dev/null; then
      # Only the VERIFIED claim goes; canonical's bytes and mtime are untouched.
      rm -f "$claim" 2>/dev/null || true
      _hook_lock_release "$lockfd"; return 0
    fi
    if ! touch "$claim" 2>/dev/null; then
      # RESTORE canonical only by no-clobber `link`, and only onto an absent
      # pathname. If the restore collides, fails, or cannot be proved, the
      # occupant is never overwritten and the only verified copy of these bytes
      # is never discarded — the claim is RETAINED as exact recovery residue.
      if link "$claim" "$set" 2>/dev/null && [[ "$claim" -ef "$set" ]]; then
        rm -f "$claim" 2>/dev/null || true
      fi
      _hook_lock_release "$lockfd"; return 0
    fi
    # THE RETAINED CLAIM FD. From here the helper's input is this descriptor's
    # own bytes — an FD-derived private snapshot — never canonical and never a
    # reopened claim pathname.
    { exec {claimfd}<"$claim"; } 2>/dev/null || { _hook_lock_release "$lockfd"; return 0; }
    # A PRIVATE EXCLUSIVE FILE, created by a no-clobber redirection — NOT an
    # `mktemp` row. The §3.4 table reserves `mktemp` for the three families
    # whose name must be unguessable (the lock init source, the marker source,
    # the generation source); this one is already private by construction, its
    # name carrying this process's pid and two `$RANDOM` components, and it
    # takes no `XXXXXX` template. (Measured: spelling it as `mktemp` with this
    # name fails outright — mktemp requires at least three trailing `X`s — and
    # the arm silently committed nothing.)
    tries=0; snap=""
    while (( tries < 8 )); do
      snap="$REG/.$id.compactions-snapshot.$$.$RANDOM.$RANDOM.tmp"
      [ -e "$snap" ] || [ -L "$snap" ] || break
      snap=""; tries=$(( tries + 1 ))
    done
    [[ -n "$snap" ]] || { { exec {claimfd}<&-; } 2>/dev/null; _hook_lock_release "$lockfd"; return 0; }
    if ! { ( umask 077; set -C; : > "$snap" ); } 2>/dev/null || [[ ! -f "$snap" || -L "$snap" ]]; then
      { exec {claimfd}<&-; } 2>/dev/null; _hook_lock_release "$lockfd"; return 0
    fi
    # A FAILED COPY TAKES THE SAME DISPOSITION AS A FAILED SNAPSHOT CREATION
    # eight lines above — return WITHOUT committing, leaving the verified claim
    # as residue. The alternative this replaces cleared `$snap` and fell
    # through, which reached the no-set record from a compaction that HAD a
    # set and then discarded the claim holding the only surviving copy of those
    # bytes (canonical is already unlinked here). That gave §3.4's absent
    # branch a SECOND meaning, and an adapter may not narrow a distinction it
    # received: the no-set branch is entered from the PATHNAME test alone.
    if ! { cat <&"$claimfd" > "$snap"; } 2>/dev/null; then
      { exec {claimfd}<&-; } 2>/dev/null || true
      rm -f "$snap" 2>/dev/null || true      # this process's own, and only it
      _hook_lock_release "$lockfd"; return 0
    fi
    # NOT CLOSED HERE. §3.4's settlement sentence requires the final
    # transaction to revalidate "generation and claim-FD/current-path
    # identity", and an FD closed at the snapshot cannot answer the second
    # half: between the release below and the final reacquire the lock is not
    # held — `measure` runs there by design — so the claim PATHNAME is
    # unguarded for that window, and unlinking it by name afterwards is an
    # unlink of whatever now wears the name. The descriptor is the only thing
    # that still names the inode this process linked.
    POST_CLAIM_FD="$claimfd"
  fi
  _hook_lock_release "$lockfd"; lockfd=""

  # ── MEASURE, outside the lock, with the lock descriptor already closed ──
  # `measure` reads the summary from a PIPE: under `set -uo pipefail` a failed
  # `jq` fails the pipeline and this arm stops, so a zero is never recorded for
  # a summary that was never read.
  #
  # ── §3.0 NORMALISATION, DECIDED ONCE, BEFORE `measure` IS CALLED ───────
  # `norm` empty means the claim is ordinary and provenance-ELIGIBLE and is
  # passed with `--set`; otherwise it holds the ONE `scope` the normalized
  # record commits, and `measure` runs WITHOUT `--set` so `cited`, `setSize`
  # and all six provenance fields are null either way. The three tests are in
  # §3.0's own precedence order and AGE IS LAST AND WINS — stated in prose
  # there precisely because JOURNAL_RECORD_PRED accepts both spellings, so the
  # predicate is not the mechanism that decides it.
  #
  # THE GRAMMAR IS NOT RE-SPELLED HERE. `NORMAL_PROVENANCE` already carries
  # §3.0's four-row table plus the per-field shapes; the set document uses the
  # same member names and lacks only `trigger`, which the record takes from
  # THIS payload — so the check is that definition applied to the claim with
  # this run's trigger spliced in. A jq that fails for any reason (a malformed
  # document, unparseable bytes) leaves `norm` set, which is the direction that
  # attributes nothing.
  if [[ -n "$snap" ]]; then
    if (( aged )); then
      norm="null"
    elif jq -e '.overlap == true' "$snap" >/dev/null 2>&1; then
      norm="ambiguous"
    elif ! jq -e --arg trig "$trig" "$JOURNAL_RECORD_PRED_DEFS"'
            (.overlap == null or .overlap == false)
            and (. + {trigger: $trig} | NORMAL_PROVENANCE)' "$snap" >/dev/null 2>&1; then
      norm="null"
    fi
  fi
  if [[ -n "$snap" && -z "$norm" ]]; then
    meas=$(printf '%s' "$summary" | _hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" measure \
             --set "$snap" --trigger "$trig" 2>/dev/null) || meas=""
  else
    meas=$(printf '%s' "$summary" | _hook_timeout "$COMPACT_HELPER_TIMEOUT" node "$COMPACT_HELPER" measure \
             --trigger "$trig" 2>/dev/null) || meas=""
  fi
  # EXACTLY ONE DOCUMENT, and a cheap shape gate BEFORE the strictly stronger
  # record predicate below — `jq -ce -s` over the helper's raw stdout.
  if ! printf '%s' "$meas" | jq -ce -s "length == 1 and (.[0] | $COMPACT_SHAPE_PRED)" >/dev/null 2>&1; then
    _hook_compact_post_abandon "$claim" "$snap"; return 0
  fi

  # ── THE FINAL TRANSACTION, under a reacquired lock ──────────────────────
  _hook_lock_acquire "$COMPACT_LOCK_WAIT" || { _hook_compact_post_abandon "" "$snap"; return 0; }
  lockfd="$HOOK_LOCK_FD"
  # REVALIDATED before the one act no later sweep can repair.
  _hook_generation_ok || { _hook_compact_post_fail "$lockfd" "$claim" "$snap"; return 0; }
  # `served` IS MARKER-DERIVED, never copied from a set: looked up here, under
  # the final lock, from the separately validated safe nonce this claim
  # carries. An unsafe or missing nonce forms no marker path and reads false.
  if [[ -n "$snap" ]]; then
    IFS= read -r -N 4096 head 2>/dev/null < "$snap"
    if [[ "$head" =~ \"nonce\":\"([^\"]+)\" ]]; then
      # THE GATE CAME FIRST AND `nonce` IS ASSIGNED ONLY INSIDE IT (r3 A-M2).
      # The capture used to sit here, outside the grammar test, and the commit
      # path 106 lines below builds `rm -f "$REG/.$id.compactserved.$nonce"`
      # from it — so an unsafe value DID form a marker pathname, which is the
      # opposite of what the comment above and §3.3 step 2 both say ("it gates
      # a PATH COMPONENT ... a nonce this refuses forms no marker path at
      # all"). MEASURED on the shipped arm: a canonical set carrying
      # `"nonce":"x/../victim"`, a directory at `$REG/.<id>.compactserved.x`
      # and a file at `$REG/victim` — one PostCompact committed its record and
      # DELETED `$REG/victim`, a registry file that is not a marker. It grants
      # no capability an out-of-contract same-UID writer does not already have,
      # which is why it is Minor; what it did was falsify a shipped invariant
      # for the sake of two moved lines.
      #
      # `cand` is the local the gate reads. `nonce` stays EMPTY on a refusal,
      # and the `[[ -z "$nonce" ]] ||` guard on the removal path then means
      # exactly what its own comment already claimed.
      cand="${BASH_REMATCH[1]}"
      # `-f` AND NOT `-L`, never a bare `-e`: this is the READING end of the
      # marker the compact SessionStart arm publishes, and a bare existence
      # test answers `served:true` for a symlink to anything and `served:false`
      # for a dangling one — a durable claim about a compaction derived from an
      # object that is not a marker. The two ends spell one definition. (The
      # publishing function is deliberately NOT named here: a scan beside the
      # retained-serve-lock pin asserts that no function body in this file
      # mentions it, which is how "its only call site is top level" is
      # measured.)
      if [[ "$cand" =~ ^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$ ]]; then
        nonce="$cand"
        if [[ -f "$REG/.$id.compactserved.$nonce" && ! -L "$REG/.$id.compactserved.$nonce" ]]; then served="true"; fi
      fi
    fi
  fi
  # THE SIXTEEN-KEY RECORD: the helper's measurement ENRICHED with the six
  # provenance fields copied from the set, and with `served` overridden by the
  # marker. Without a set every one of the six is null, which is §3.0's
  # normalized no-set grammar and NOT the same answer as `"main"`.
  if [[ -n "$snap" && -z "$norm" ]]; then
    rec=$(jq -cn --argjson m "$meas" --slurpfile s "$snap" --argjson sv "$served" \
      '$s[0] as $set | $m + {served: $sv,
        cwd: $set.cwd, built: $set.built, agent: $set.agent,
        transcript: $set.transcript, parentLive: $set.parentLive, liveAgents: $set.liveAgents}' 2>/dev/null) || rec=""
  else
    # ONE SPELLING FOR BOTH NO-`--set` POPULATIONS — the genuinely absent
    # canonical set (`snap` empty, `norm` empty, `served` still its false
    # initialiser) and a normalized claim (`norm` set, `served` MARKER-derived,
    # exactly as §3.0 requires of every normalization case). `cited`/`setSize`
    # are NOT overridden: `measure` without `--set` already answers null for
    # both, and overriding them here would hide a helper that did not.
    rec=$(jq -cn --argjson m "$meas" --argjson sv "$served" --arg norm "$norm" \
      '$m + {served: $sv, scope: (if $norm == "ambiguous" then "ambiguous" else null end),
             cwd: null, built: null, agent: null,
             transcript: null, parentLive: null, liveAgents: null}' 2>/dev/null) || rec=""
  fi
  [[ -n "$rec" ]] || { _hook_compact_post_fail "$lockfd" "$claim" "$snap"; return 0; }
  printf '%s' "$rec" | jq -ce "$JOURNAL_RECORD_PRED_DEFS JOURNAL_RECORD_PRED" >/dev/null 2>&1 \
    || { _hook_compact_post_fail "$lockfd" "$claim" "$snap"; return 0; }

  # THE STAGE: a never-precreated exact table name, validated as this writer's
  # own regular non-symlink file.
  tries=0; stage=""
  while (( tries < 8 )); do
    stage="$REG/.$id.compactions-stage.$$.$RANDOM.$RANDOM.tmp"
    [ -e "$stage" ] || [ -L "$stage" ] || break
    stage=""; tries=$(( tries + 1 ))
  done
  [[ -n "$stage" ]] || { _hook_compact_post_fail "$lockfd" "$claim" "$snap"; return 0; }
  if ! { ( umask 077; set -C; : > "$stage" ); } 2>/dev/null; then
    _hook_compact_post_fail "$lockfd" "$claim" "$snap"; return 0
  fi
  # VALIDATED AS THIS WRITER'S OWN regular non-symlink file before a byte of
  # the old journal is copied into it.
  [[ -f "$stage" && ! -L "$stage" ]] || { _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
  old=""
  if [ -e "$journal" ] || [ -L "$journal" ]; then
    [[ -f "$journal" && ! -L "$journal" && -r "$journal" ]] \
      || { _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
    { exec {jfd}<"$journal"; } 2>/dev/null || { _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
    { cat <&"$jfd" > "$stage"; } 2>/dev/null \
      || { { exec {jfd}<&-; } 2>/dev/null; _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
    # `$( )` STRIPS EVERY TRAILING NEWLINE (measured), and a journal always ends
    # in one — so a bare `old=$(cat …)` loses exactly the byte that makes the
    # length equality below exact, and the SECOND record of a session's life is
    # refused while the first commits. The `printf x` sentinel plus `${old%x}`
    # is what keeps the prefix byte-exact.
    old=$(cat "$stage" 2>/dev/null; printf x) || old="x"
    old="${old%x}"
  fi
  { printf '%s\n' "$rec" >> "$stage"; } 2>/dev/null \
    || { [[ -n "$jfd" ]] && { exec {jfd}<&-; } 2>/dev/null; _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
  # THE RAW VALIDATOR over the WHOLE stage, plus exactly one additional line
  # byte-equal to the object — so a commit that appended twice, or appended
  # something the predicate would not accept, never reaches canonical.
  if ! jq -ce -R -s --arg rec "$rec" --arg old "$old" \
        "$JOURNAL_RECORD_PRED_DEFS $JOURNAL_STAGE_PRED" < "$stage" >/dev/null 2>&1; then
    [[ -n "$jfd" ]] && { exec {jfd}<&-; } 2>/dev/null
    _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0
  fi
  # THE FD COMPARE-AND-SWAP: an initially PRESENT journal must still be the same
  # retained regular FD, and an initially ABSENT one must still be absent.
  if [[ -n "$jfd" ]]; then
    if ! _hook_lock_same "$jfd" "$journal"; then
      { exec {jfd}<&-; } 2>/dev/null
      _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0
    fi
    { exec {jfd}<&-; } 2>/dev/null || true
  elif [ -e "$journal" ] || [ -L "$journal" ]; then
    _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0
  fi
  # ITEM 3, before the journal commit: this section reacquired, then read and
  # wrote a private stage through several synchronous children. Same handler as
  # a failed `mv`, because the outcome is the same one — nothing committed, and
  # this arm's own residue cleaned up.
  _hook_lock_still_canonical "$lockfd" || { _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
  mv -f "$stage" "$journal" 2>/dev/null || { _hook_compact_post_fail "$lockfd" "$claim" "$snap" "$stage"; return 0; }
  # COMMITTED. Claim and marker cleanup happens ONLY here, under the
  # successfully reacquired and validated lock — never on a failure path.
  #
  # THE CLAIM IS CONSUMED BY IDENTITY, NOT BY NAME (§3.4 settlement). The
  # retained descriptor and the current pathname must still be one regular
  # inode; if they are not, the name was replaced while the lock was down and
  # the occupant is a stranger's file this arm has no licence to delete. The
  # record still commits — it was built from the snapshot, which is
  # FD-derived — and the stranger is left exactly where it was.
  if [[ -n "$claim" ]] && [[ -n "${POST_CLAIM_FD:-}" ]] \
     && _hook_lock_same "$POST_CLAIM_FD" "$claim"; then
    rm -f "$claim" 2>/dev/null || true
  fi
  _hook_post_claim_close
  [[ -z "$snap" ]]  || rm -f "$snap"  2>/dev/null || true
  [[ -z "$nonce" ]] || rm -f "$REG/.$id.compactserved.$nonce" 2>/dev/null || true
  _hook_lock_release "$lockfd"
  return 0
}

# NO UNLOCKED CLEANUP. When the final lock is not safely held, the verified
# claim and the exact marker are LEFT as residue for a later aged recovery
# under a validated lock — discarding the only verified copy of a compaction's
# set because this process could not take a lock is the one thing this arm may
# not do. Only this process's own snapshot goes, and only because nothing else
# can ever read it.
_hook_compact_post_abandon() {   # <claim> <snapshot>
  # The retained claim descriptor goes on this path too — see
  # `_hook_compact_post_fail`'s note. The CLAIM FILE is deliberately left:
  # abandoning is what "leave the only verified copy as recovery residue"
  # means, and a descriptor is not a copy.
  _hook_post_claim_close
  [[ -z "${2-}" ]] || rm -f "$2" 2>/dev/null || true
  return 0
}

# The final lock IS held here, so this path may consume this process's own
# stage and snapshot — but it still leaves the claim and the marker, because a
# noncommit means the measurement has not been recorded and the evidence must
# outlive the attempt.
_hook_compact_post_fail() {   # <lockfd> <claim> <snapshot> [<stage>]
  # THE RETAINED CLAIM DESCRIPTOR GOES HERE TOO, and it rides a named global
  # rather than a fifth positional: this helper has fifteen call sites, and a
  # new positional threaded through all of them is fifteen chances to pass the
  # wrong thing. `POST_CLAIM_FD` is set beside the `exec` that opens it and
  # cleared by whoever closes it, so "is it still open" has exactly one answer.
  _hook_post_claim_close
  [[ -z "${4-}" ]] || rm -f "$4" 2>/dev/null || true
  [[ -z "${3-}" ]] || rm -f "$3" 2>/dev/null || true
  _hook_lock_release "${1-}"
  return 0
}

_hook_post_claim_close() {   # close the retained claim FD, once, from anywhere
  [[ -n "${POST_CLAIM_FD:-}" ]] || return 0
  local fd="$POST_CLAIM_FD"
  POST_CLAIM_FD=""
  { exec {fd}<&-; } 2>/dev/null || true
  return 0
}

# ── SessionStart(compact) (spec §3.3): SERVE THE CARD ONCE, TO ITS SET ────
# This arm cannot tell which context it serves (§3.0: the compactor has been
# silent for ≥79 s by now) and NEVER resolves. It serves the card iff the card
# is the set's own — line 1 of the card is the set's `nonce` — and consumes it.
# An aged card belongs to no compaction that can still arrive and is REMOVED
# (a dot-free registry file that outlives its use would hold the slug); a
# crossed pair — another nonce, or no set — serves nothing and leaves the card
# for the overlap check or the age bound to retire. THE ONLY CLIP LIVES IN THE
# EMITTER (`_hook_emit_context`'s `${2:0:$COMPACT_CARD_MAX_CHARS}`) — a second
# slice here was a duplicate in series with it: each was a complete substitute
# for the other, so neither alone was pinnable (fix-round I1). The bounded
# `read -N COMPACT_CARD_MAX_CHARS+64` below is not that clip; it is the real
# cost guard — measured on a 100 MB card, 114 ms vs 17,370 ms for a `cat` fork
# (152x) — and stays, uncoupled from the emitter's own slice.
#
# UNDER THE ROW'S MUTEX, FOR ITS WHOLE BODY (spec §3.3, D-2605). The acquire
# sits immediately after the operator-off guard and before the FIRST existence
# or age inspection, because every one of them — the card's `-f`, the age
# `find`, the set's head read, the claim, the restore, the deletion — is a
# check whose act follows it, and a sibling publishing in between is exactly
# what the mutex excludes. The FD is RETAINED across the whole section rather
# than taken per step: this arm forks (the age `find`, the `( set -C; : > … )`
# subshell, `mv`, `link`, `rm`, the emitter's `jq`), and a held `{fd}<>`
# descriptor is NOT close-on-exec — measured, an exec'd child's
# `/proc/self/fd` lists the parent's lock fd — but every one of those children
# is SYNCHRONOUS and reaped inside the section, so none can outlive it. The
# close-before-fork rule APPLIES here and is SATISFIED; it is not disapplied.
# Backgrounding anything inside `_hook_compact_card_locked` would break that.
#
# The bound is COMPACT_LOCK_WAIT_SERVE, not COMPACT_LOCK_WAIT: this is the one
# acquisition a human is waiting on, and a miss costs one unserved card and
# nothing durable. The split lives in the two call sites, never in the acquire
# helper, which takes its wait as its first positional.
_hook_compact_card() {   # sets CARD_COMPACT; silent on every path
  CARD_COMPACT=""; COMPACT_SERVE_FD=""; COMPACT_SERVE_NONCE=""
  [ -e "$COMPACT_CARD_OFF" ] && return 0
  local lockfd=""
  _hook_lock_acquire "$COMPACT_LOCK_WAIT_SERVE" || return 0
  lockfd="$HOOK_LOCK_FD"
  # Validated under the lock and BEFORE the first existence or age inspection,
  # which is what "before any lifecycle observation or mutation" means here.
  if ! _hook_generation_ok; then _hook_lock_release "$lockfd"; return 0; fi
  _hook_compact_card_locked || true
  # THE LOCK IS RETAINED PAST THIS RETURN only when a card is actually going to
  # be printed: the marker that records the fact of serving belongs to the same
  # held section that claimed the card, and the print sits between them at the
  # one site this file prints from. On every other path the descriptor is
  # closed here, which is the single release site for those paths.
  if [ -n "$CARD_COMPACT" ]; then COMPACT_SERVE_FD="$lockfd"; return 0; fi
  _hook_lock_release "$lockfd"
  return 0
}

_hook_compact_card_locked() {   # the retained-lock body; sets CARD_COMPACT
  local f="$REG/$id.compactcard" set="$REG/$id.compactset" claim="" head="" nonce="" raw="" line1="" body=""
  [[ -f "$f" && -r "$f" ]] || return 0
  command -v find >/dev/null 2>&1 || return 0
  # ITEM 3 in the retained-lock body. `HOOK_LOCK_FD` is the descriptor the
  # caller acquired and still holds; this function has no local for it. On a
  # failed proof the arm says nothing and the caller releases, which is this
  # body's own disposition on every other refusal.
  _hook_lock_still_canonical "$HOOK_LOCK_FD" || return 0
  [ -n "$(find "$f" -mmin "-$(( COMPACT_CARD_MAX_AGE / 60 ))" 2>/dev/null)" ] || { rm -f "$f"; return 0; }
  # ARGUED, UNPINNABLE (fix-round M3): measured on this box, deleting this
  # guard changes nothing observable — a missing/unreadable `$set` makes the
  # `read < "$set"` below fail its redirection silently (swallowed same as a
  # `2>/dev/null` command failure; `head` stays "" and the nonce regex below
  # fails), so no test can redden it here, the way D-2417's dropped guards
  # could not. Kept anyway, unlike those: this file declares two userlands
  # (header, line 1), and whether a failed stdin redirection stays silent
  # is shell-and-platform behaviour this box's bash cannot prove for every
  # `sh`/`bash` a fleet box might run. One cheap `[[ ]]` against that risk.
  [[ -f "$set" && -r "$set" ]] || return 0
  IFS= read -r -N 4096 head 2>/dev/null < "$set"
  [[ "$head" =~ \"nonce\":\"([^\"]+)\" ]] || return 0
  nonce="${BASH_REMATCH[1]}"
  # THE SAFE-NONCE GATE (spec §3.3 step 2), spelled for the engine that RUNS
  # it. This is bash, so the anchor is `$` — NEVER `\z`: POSIX ERE has no `\z`
  # escape and `regcomp` reads it as a literal `z`, so measured on bash 5.2.21
  # the `\z` spelling REJECTS every well-formed nonce and ACCEPTS exactly one
  # ending in a literal `z` — nothing would ever be served and every journal
  # record would read `served:false` forever. `$` is sufficient here, not
  # merely tolerable: measured, it matches the well-formed nonce and rejects
  # the trailing-`z` form, a trailing LF, and an embedded LF followed by more
  # text. (jq/Oniguruma's `\z` in the journal predicates is correct THERE and
  # is unchanged; jq's `$` would not be, since it accepts a trailing LF.)
  #
  # It gates a PATH COMPONENT: the marker and its source are both named from
  # this string, so a nonce this refuses forms no marker path at all.
  [[ "$nonce" =~ ^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$ ]] || return 0
  # ATOMIC CLAIM (consume-once, spec §3.3 step 3, fix-round M1): a bare
  # read-then-`rm` lets every one of N concurrent SessionStart(compact)
  # racers (the main thread and its live subagents can all hit this arm
  # close together) read the card before the first one deletes it, serving
  # the same bytes to N contexts — measured against the pre-fix code, 8
  # concurrent racers per trial: 2 of 3 isolated trials served the card to 2
  # racers instead of 1. `mv` wins
  # the pathname for exactly one racer; a losing `mv` (ENOENT — another racer
  # already claimed it) serves nothing. The claim is PROVISIONAL: a crossed
  # pair or a body-less nonce restores the card (spec's "the card stays")
  # through the same regular-placeholder-then-no-clobber-`link` idiom this
  # function itself uses below — the `( set -C; : > "$claim" )` placeholder and
  # the `link "$claim" "$f"` restore beside it. (This sentence used to point at
  # `_hook_compact_rollback_card`, a function D-2605 deleted along with its one
  # call site; a reader following the pointer found nothing.) Only a matching,
  # non-empty pair keeps the claim consumed. Dot-prefixed, pid-scoped and named to the
  # §3.4 target grammar, so an orphaned claim (this process killed mid-read) is
  # reclaimed, AGED and under a held lock, by `_hook_family_sweepable`'s
  # `compactcard.*.session-claim.tmp` arm. This sentence used to say such a
  # claim is swept by PreCompact's existing `.$id.*compact*.tmp` glob; that
  # glob went with the rest of the pre-D-2605 sweep, which matched by
  # coincidence rather than by family — and the very next paragraph, announcing
  # the migration to this name, already contradicted it.
  # MIGRATED TO THE §3.4 TARGET GRAMMAR (D-2605). The shipped shape was
  # `.<id>.<pid>.compactcard-claim.tmp`, a name matched by neither PreCompact's
  # exact-family sweep nor `_reg_purge`'s exact cleanup, so a SessionStart
  # killed between its no-clobber `: >` and its `mv` — or between the `mv` and
  # the `rm` — leaked a permanent dot-leading file, and under the widened
  # `_ws_slug_free` an unmatched residue reads FREE and re-hands the slug with
  # a stranger's claim still present. The nonce is available here because step
  # 2 above validated it before step 3 claims.
  claim="$REG/.$id.compactcard.$$.$nonce.session-claim.tmp"
  ( set -C; : > "$claim" ) 2>/dev/null || return 0
  # ITEM 3 again: `find` and the nonce read sit between the proof above and
  # this one, and this is where canonical actually moves.
  _hook_lock_still_canonical "$HOOK_LOCK_FD" || return 0
  if ! { mv -f "$f" "$claim"; } 2>/dev/null; then
    { rm -f "$claim"; } 2>/dev/null || true
    return 0
  fi
  IFS= read -r -N $(( COMPACT_CARD_MAX_CHARS + 64 )) raw 2>/dev/null < "$claim"
  line1="${raw%%$'\n'*}"
  if [[ "$line1" != "$nonce" ]]; then
    # POSIX `link source target` creates exactly target or fails EEXIST —
    # unlike `ln`, a directory at target cannot receive a child named after
    # the source.
    { link "$claim" "$f"; } 2>/dev/null || true
    { rm -f "$claim"; } 2>/dev/null || true
    return 0
  fi
  body="${raw#*$'\n'}"
  if [[ "$body" == "$raw" ]]; then                    # a nonce with no text after it
    { link "$claim" "$f"; } 2>/dev/null || true
    { rm -f "$claim"; } 2>/dev/null || true
    return 0
  fi
  { rm -f "$claim"; } 2>/dev/null || true
  body="${body%"${body##*[![:space:]]}"}"
  CARD_COMPACT="$body"
  # Carried to the marker publication, which happens after the PRINT and
  # inside this same held section. Set only on the one path that actually
  # serves, so nothing else can mint a marker.
  COMPACT_SERVE_NONCE="$nonce"
  return 0
}

# THE FACT OF SERVING (spec §3.3 step 5) — A MARKER, NOT A SET REWRITE.
# What stood here rewrote `set.served` with `jq`, which is exactly the act
# D-2605 forbids: THE CANONICAL SET IS NEVER REWRITTEN. Two writers racing on
# one document is how a compaction loses a record or marks the wrong set
# served, and no amount of temp-then-rename care fixes a design that has two
# authors for one artifact. The fact of serving is now recorded by PUBLISHING A
# SEPARATE NAME — `$REG/.<id>.compactserved.<nonce>` — from a DISJOINT private
# source, so the set stays byte-identical from PreCompact's publication until
# PostCompact claims it, and `measure` derives `served` from the marker's
# existence under the final lock.
#
# THE ORDER IS EMIT-THEN-MARK, and it is deliberate: a crash between the print
# and the marker leaves an honest FALSE NEGATIVE (the card reached the model,
# the journal says it did not) rather than a lie in the other direction, which
# would make `cited` uninterpretable exactly where it matters.
#
# Idempotence: only an extant marker for the SAME nonce is idempotent — `link`
# is no-clobber (measured, rc 1 `File exists`, nothing changed), so a repeat
# leaves the first marker standing and removes only its own source.
_hook_compact_mark_served() {
  local marker="" src=""
  # The nonce reached here through §3.3 step 2's bash validator, so it is
  # already a safe path component; an unsafe or empty one forms NO marker path
  # at all and the compaction simply reads `served:false`.
  [[ -n "$COMPACT_SERVE_NONCE" ]] || return 0
  # THE SECOND VALIDATION §3.3 step 5 NAMES — "before unlock and only after
  # successful output, revalidate environment generation and publish the exact
  # nonce marker". The arm held the lock from the claim through the print, so
  # the window this closes is narrow, but it is the one arm whose specified
  # DOUBLE validation was absent: a marker is a durable fact about a row, and
  # the row this pane was authorized for is the only row it may write one for.
  _hook_generation_ok || return 0
  marker="$REG/.$id.compactserved.$COMPACT_SERVE_NONCE"
  command -v mktemp >/dev/null 2>&1 || return 0
  src=$( umask 077; mktemp "$REG/.$id.compactserved-source.$COMPACT_SERVE_NONCE.XXXXXX" 2>/dev/null ) || return 0
  [[ -f "$src" && ! -L "$src" ]] || { rm -f "$src" 2>/dev/null; return 0; }
  link "$src" "$marker" 2>/dev/null || true
  # EEXIST MEANS VALIDATE THE INCUMBENT — §3.3 step 5's "same-nonce extant
  # marker is idempotent ONLY AFTER it validates as a regular, non-symlink
  # final marker under this lock". THE VALIDATION IS AT THE READING END, and
  # that placement is measured rather than chosen for convenience.
  #
  # Written HERE it can have no effect, because §3.4's own marker-source rule
  # unlinks the source "on success, on `EEXIST` after validating …, and on
  # every handled failure" — all three — so validate-then-unlink and unlink do
  # the same thing to the same file, and this arm returns 0 either way.
  # MEASURED, in a throwaway copy: a mutant deleting a
  # `[[ -f "$marker" && ! -L "$marker" ]] || { rm -f "$src"; return 0; }`
  # placed here leaves the suite GREEN, while the control mutant in the same
  # run — loosening the reading end back to a bare `-e` — reds. A guard no
  # input can distinguish is not a guard; it is a comment with a semicolon.
  #
  # What the requirement is ABOUT is real and is enforced where it bites: an
  # occupant that is a symlink or a directory makes this `link` fail EEXIST and
  # NO marker is published, and a bare `[ -e … ]` at the lookup then derives a
  # durable `served` from that object — `true` for a symlink to anything,
  # `false` for a dangling one. `_hook_compact_post`'s lookup asks
  # `-f && ! -L`, so the two ends spell one definition of what a marker IS.
  # Reachable only through an out-of-contract same-UID writer, which is why
  # neither end complains: this one publishes nothing and returns 0.
  #
  # THE SOURCE GOES ON EVERY HANDLED RESULT — success, EEXIST and failure —
  # so the disjoint name never becomes residue of its own.
  rm -f "$src" 2>/dev/null || true
  return 0
}

# The retained serve lock's ONE release site. `_hook_compact_card` keeps the
# descriptor open past its own return when, and only when, a card is going to
# be printed, because the marker above must be published inside the SAME held
# section that claimed the card and the print sits between them.
_hook_compact_serve_end() {
  [[ -n "$COMPACT_SERVE_FD" ]] || return 0
  _hook_lock_release "$COMPACT_SERVE_FD"
  COMPACT_SERVE_FD=""
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

# ── R7: what counts as ACTING ON THE CARD ───────────────────────────────
# ANCHORED ON THE VERB PAIR, NEVER ON THE CLIENT'S NAME. Both skills teach
# `API="$HOME/.local/bin/ccrc-api"` and then call `"$API" peers list`
# (coordinator-skill/references/peer-protocol.md), and this hook reads the
# UNEXPANDED command text — so a regex anchored on `ccrc-api` scores ZERO on
# every call the fleet actually makes, and looks perfectly healthy doing it.
# The leading class stops `speers list` and prose; the trailing one stops
# `peers listing`.
CCRC_PEERS_RE='(^|[;&|[:space:]])peers[[:space:]]+list([[:space:]]|$)'
CCRC_CLAIMS_RE='(^|[;&|[:space:]])claims[[:space:]]+take([[:space:]]|$)'

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

# ── R7: the card's bounds and its kill-switch ───────────────────────────
# Same shape as GRAPH_GATE_OFF above and as `$REG/coordinator-paused`: a file
# the operator touches by hand, releasable without a deploy and without a
# token. Measured cost of the test: p50 0.016 ms.
CCRC_CARD_OFF="$HOME/.ccrc/ccrc-card-off"
# THE TOTAL, argued rather than inherited. The `<600` in `session-hook.test.ts`
# is a TAINT bound on ONE repo-controlled field — its own message says so ("an
# unbounded repo-controlled string reached the session") — and it binds the
# census arm alone; it stays exactly as it is. THIS is a different number for a
# different job: the ceiling on the whole assembled card.
#
# ARGUED FROM THE STRUCTURAL WORST CASE, NOT THE LIVE ONE (fix wave, M5, D-1903). The
# shipped 1800 was argued from the worst combination measured ON THIS FLEET —
# graphify 593 + held 592 + co-tenant 176 + 2 joins = 1363, cleared by 32% —
# and a live sample is the wrong quantity to size a bound with. What this bound
# has to clear is the worst combination the code can PRODUCE with every GATED
# field at its own cap.
#
# RE-MEASURED END-TO-END, 2026-09-08, CORRECTING THE FIX WAVE'S OWN ARITHMETIC
# (a reviewer's re-measurement of it, verified here against a fixture HOME run
# through this file rather than hand-counted). graphify 719 (every optional
# clause present, a 12-digit node count, engine and pin each at their 64-byte
# `head -c` cap, the LONGEST freshness phrasing this file can produce — `fresh
# — same content as HEAD`, D-1368 — and the armed-gate sentence) + §4.2 held
# case A 860 (a 127-character workdir in the subject, a 127-character hold
# whose reason NAMES A RUN — the longer of the two case-A sentences the code
# can emit — and a 40-character id) + co-tenant 245 (a 64-character project and
# a TWO-DIGIT count — see below) + two one-space joins = 1826, not the fix
# wave's 1768: its own 801 for held case A undercounted the true 860 by 59.
# TWO OF THE THREE COMPONENTS ARE MODELLED, NOT BOUNDED. `$id` carries a shape
# gate but no length cap and appears more than once across these sentences, so
# 1826 assumes a 40-character id rather than proving a ceiling (the longest id
# live on this fleet today is 29, `expoAI-assistant-keen-prairie`); and
# `$CT_N` is interpolated un-padded, so each extra digit adds one character —
# 244 at one co-tenant, 245 at the two-digit counts this fleet actually
# carries (`coTenantN:15` in the pre-deploy baseline), 246 at three. The
# singular/plural halves are the same length, so the digits are the whole of
# it. 245 is the live shape and what the sum above uses.
#
# AGAINST THE OLD 1800 THIS WAS NEVER HEADROOM. 1826 exceeds 1800 by 26
# characters, so the 1800 this branch carried until D-1903 did not clear its
# own structural worst case: it truncates that combination silently, mid-word,
# inside the CO-TENANT sentence (`… returns the five peer rules.` cut to `… re`),
# on exactly the join order (graphify -> hold -> ccrc) already named as the
# risk — the subject naming the route to the peer rules is the one that
# vanishes, on exactly the sessions carrying a hold. No session ever received
# it: the card has never been deployed, and 1800 existed only inside this
# branch. The fix wave's "32 characters of headroom, not 32%" claim had the
# right units and the wrong sign: the 1800 it describes carried NEGATIVE
# headroom against its own structural worst case, so raising it to 2400 closed
# a silent-truncation risk rather than widening a comfortable margin.
#
# 2400 clears 1826 by 574 characters (about 31%) and is still under 10% of the
# 24576 bytes the neighbour hook on this same compact SessionStart
# (`~/.cc-handoff/restore.sh`) already emits. It is a ceiling, never a budget
# the subjects may spend up to: `GM_NODES` is ungated (see
# `_hook_graph_measure`, I4) and can exceed ANY bound on its own, which is why
# the clip exists at all and why the number above only has to cover the
# fields that ARE gated. Raising the bound is the cheap answer;
# drop-whole-subject logic on the hot path is not, and was refused.
CARD_MAX_CHARS=2400
# ── THE COMPACTION CARD (spec 2026-09-09-graphify-compaction-card-design.md) ──
# Three registry files per session, every suffix DOT-FREE so `_reg_purge`'s
# loop (`ccd/ccd`: every dot-free `$REG/<id>.<suffix>` except `archived` and
# `reaping`) unlinks them with the row: `.compactset` (PreCompact writes it,
# PostCompact consumes it), `.compactcard` (PreCompact writes it when the tree
# has a graph the gate would trust; SessionStart(compact) serves it ONCE and
# deletes it), `.compactions` (the per-session journal PostCompact appends,
# never read here). That dot-free shape is what `_ws_slug_free`'s FIRST pass
# scans and what `_ws_slug_residue` names — the two are widened together, and a
# comment naming only one of the pair re-creates the half-widening defect in
# prose — but since D-2605 neither stops there: both take a SECOND pass over
# the dot-LEADING `.<id>.…` private families, which the `"$REG/$id".*` glob
# (id, then a dot) is structurally blind to. So every arm removes what it will
# not serve — an aged card, an aged set — and PreCompact sweeps this id's aged
# private residue by EXACT FAMILY (`_hook_family_sweepable`), never by the
# `.compact*.tmp` glob it used to use, which matched by coincidence rather than
# by grammar. Those names lead with a dot and are therefore invisible to
# `_reg_purge`'s own dot-free loop, which is why somebody here must reap them.
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
# THE IN-FLIGHT WINDOW, WHICH DECIDES A DIFFERENT THING PER ARTIFACT. An aged
# CARD belongs to no compaction that can still arrive and is removed UNREAD
# (a dot-free registry file that outlives its use would hold the slug). An aged
# canonical SET is NOT removed unread: PreCompact publishes over it and
# PostCompact still claims and measures it — age decides only its provenance
# eligibility, never whether it is read. An unconsumed set YOUNGER than this at
# PreCompact means another compaction of this session is in flight (spec §3.0,
# overlap). Argued from the longest compaction measured
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
# contract): both helper calls use `_hook_timeout`, which resolves `timeout`
# or `gtimeout`, for at most this many seconds, off the hot path — PreCompact
# and PostCompact bracket a compaction
# of at least 79 s — and after the hookstate write has landed. Argued from
# measured inputs (node startup ~0.05 s, a 70 MB graph parsed and indexed in
# ~1.5 s, a 16 MiB window mined in well under a second through a basename
# index) at roughly twice their sum, and RE-MEASURED on this box's real graphs
# before it shipped — the p95 and peak RSS are recorded here by Task 6 of
# plans/2026-09-10-graphify-compaction-card-plan-a.md: ccrc 9,543,597-byte graph
# p95 0.36 s / 104,384 KiB RSS; largest admissible graph (MekWarLive,
# 70,434,955 bytes) p95 1.05 s / 332,184 KiB RSS (five fresh-nonce runs each,
# 2026-09-10).
COMPACT_HELPER_TIMEOUT=8
COMPACT_WORKSET_MAX=12
# ── THE TWO STABLE-LOCK BOUNDS (spec §2, §3.4) ───────────────────────────
# Both are passed to `_hook_lock_acquire` as its FIRST POSITIONAL, never
# spelled inside it: that parameterization is the whole reason two bounds can
# coexist through one acquire path, and a helper carrying either constant in
# its own body would make the other unreachable.
#
# COMPACT_LOCK_WAIT is every acquisition EXCEPT compact SessionStart's:
# PreCompact's two sections, PostCompact's settlement and its final journal
# transaction (round 7 retired the separate final constant — both are off the
# hot path and both lose a durable artifact on a miss, so they share one
# bound), and `ccd`'s own row-creation, `_spawn_start` and `_reg_purge`
# acquisitions, which carry a twinned literal of the same value.
#
# MEASURED, NOT ARGUED (Task 9, 2026-09-14, fleet box `openclaw`, load ~5.8,
# fixture HOME — never the live one). What a waiter can be blocked behind is
# ONE HELD SECTION, so each section is timed at its own acquire and release
# rather than the arm being timed end to end, n=30 per section:
#
#   PreCompact section 1 (overlap + exact sweep + initial publish)
#                                  p50 22.12 ms   p95 27.59 ms   max 28.75 ms
#   PreCompact section 2 (reconfirm + the two renames)
#                                  p50  8.39 ms   p95 11.02 ms   max 12.57 ms
#   compact SessionStart (retained, whole body incl. the marker)
#                                  p50 24.98 ms   p95 31.75 ms   max 32.59 ms
#
# THE DERIVATION: the bound stands at 5 s only if it is at least 8x the worst
# measured p95. Worst p95 = 31.75 ms, so the floor this rule sets is 254 ms;
# 5 s is 158x it, and COMPACT_LOCK_WAIT_SERVE's 2 s is 63x. The headroom is
# deliberate and is not slack to be trimmed: only a SAME-ROW sibling contends
# (one registry row is one session's contexts), and the cost of a miss is a
# lost durable artifact, so the bound is set to make a miss mean "something is
# genuinely wedged" rather than "the box was busy".
COMPACT_LOCK_WAIT=5
# COMPACT_LOCK_WAIT_SERVE is compact SessionStart's ALONE — the one
# acquisition a human is waiting on, at the top of a resumed session. A miss
# there costs one unserved card and nothing durable, so it gives up sooner
# than every other arm rather than making the session wait. Measured above:
# 2 s is 63x the worst held-section p95, so an ordinary uncontended serve
# never approaches it and a miss here really is contention.
COMPACT_LOCK_WAIT_SERVE=2
# ── THE JOURNAL RECORD PREDICATE (spec §3.4, "Journal contract") ─────────
# ONE predicate gates BOTH the merged record before it is staged and every
# physical line of the staged file, so a line that reaches `$REG/<id>.compactions`
# has passed the same test twice — once as an object and once as bytes.
#
# SIXTEEN KEYS, and `(keys|sort) == [...]` rather than a presence check: an
# extra key is as much a defect as a missing one, and there is NO `n` — D-2605
# removes the persisted ordinal, a reader derives it from committed physical
# JSONL position.
#
# `\z`, NOT `$`, AND ONLY HERE. These anchors run in jq's Oniguruma, where `\z`
# is end-of-string; jq's `$` would accept a trailing LF. The bash arms in this
# file must use `$` instead, because POSIX ERE has no `\z` and `regcomp` reads
# it as a literal `z` — the two engines take opposite spellings and neither may
# borrow the other's (spec §3.4, "Which regex engine anchors what").
#
# Every integer requirement spells `floor == .` explicitly: jq has one number
# type, so `1.0` and `1` compare equal and a bare `type == "number"` would admit
# a fractional count.
JOURNAL_RECORD_PRED_DEFS='
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
'
# THE RAW BYTES of the staged file, read with `-R -s` so the predicate sees the
# whole thing as ONE string and can say something about its physical shape:
# every line is a complete JSON object the record predicate accepts, the file
# ends in exactly one LF, the pre-append bytes are still its exact prefix, and
# the ONLY thing added is this record plus one LF — a length equality, which is
# what makes "exactly one additional line" exact rather than approximate.
JOURNAL_STAGE_PRED='
. as $raw
| ($raw | endswith("\n"))
  and ($raw | startswith($old))
  and (($raw | length) == (($old | length) + ($rec | length) + 1))
  and (($raw | split("\n"))[0:-1] as $lines
       | ($lines | length) > 0
         and all($lines[]; (length > 0) and ((fromjson? // false) | JOURNAL_RECORD_PRED))
         and ($lines[-1] == $rec))
'
# ONE SPELLING of the shape a `compaction` object must have (spec §3.4, "shape
# gates, both directions"). WHAT IT IS FOR, restated against the shipped code:
# it is a CHEAP SHAPE SANITY GATE on the helper's raw stdout — `jq -ce -s`,
# exactly one document — applied BEFORE the strictly stronger
# `JOURNAL_RECORD_PRED` validates the merged record. It is not a persistence
# mechanism and not a read-back: the sentences this replaces said the hook adds
# `n` to the object and that a value is read back from hookstate, and D-2605
# forbids BOTH — there is no hookstate compaction cache and no persisted
# ordinal, a reader derives ordinal from committed physical JSONL position.
# Never re-spelled.
COMPACT_SHAPE_PRED='(type=="object" and (.chars|type)=="number" and (.fences|type)=="number" and (.at|type)=="number" and (.trigger=="auto" or .trigger=="manual") and (.steered|type)=="boolean" and (.served|type)=="boolean" and ((.filesChars|type)=="number" or .filesChars==null) and ((.cited|type)=="number" or .cited==null) and ((.setSize|type)=="number" or .setSize==null) and (.scope=="main" or .scope=="subagent" or .scope=="ambiguous" or .scope==null))'
# BOUNDED AND ANCHORED. The project string is registry text that lands verbatim
# in a prompt, so it is gated on a SHAPE rather than clipped to a length: a
# value this refuses is UNSPEAKABLE and the card says nothing, rather than
# quoting bytes it cannot vouch for. The class is `id`'s own plus a length
# bound; it admits no whitespace, so the trailing-space divergence that would
# split the hook's grouping from the server's is refused, not guessed at.
#
# THE SHAPE GATE IS A `case` GLOB PLUS `${#x}`, NOT AN ERE, AND THAT IS A
# BUDGET DECISION MEASURED RATHER THAN ASSUMED. The natural spelling here is
# `[[ $x =~ ^[A-Za-z0-9._-]{1,128}$ ]]`, and the BOUNDED REPETITION is what
# costs: over 23 evaluations, `{1,128}` measures 13.1-18.5 ms and `{1,64}`
# 7.9-13.9 ms, against 1.2-4.1 ms for the same class with `+` and 1.4-2.2 ms
# for `case` plus `${#x}`. `=~` is free where the shipped hook uses it — once
# per event; inside a per-row loop the `{m,n}` expansion was the WHOLE cost of
# this probe (17.4 ms p50 before, 4.5 ms after).
#
# THE CLASS IS A CONSTANT THE `case` PATTERNS EXPAND, because a variable inside
# a bracket expression works and costs the same (measured) — and `CCRC_WD_CLASS`
# below DERIVES from it rather than re-spelling it. But this comment used to
# claim the class is "spelled ONCE" in this file and that
# `single-definition.test.ts` would redden a second copy, and BOTH halves were
# false (fix wave, I7). There are three spellings, because an ERE cannot
# interpolate a bracket-class variable the way `case` can: this constant, the
# session-id gate `[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]]` near the bottom of this
# file, and the hold's shape gate `^program:[A-Za-z0-9._-]+ wave:...` in
# `_hook_hold_card`. And `single-definition.test.ts`'s four `ROOTS` are the
# TypeScript packages, so they do not cover `ccd/` — BUT A SECOND BASH CORPUS
# DOES: `bashRoots` is `[<repo>/ccd, <repo>/deploy]`, `BASH` is every bash file
# under them plus `install.sh`, `holdersOf` filters that corpus on non-comment
# lines, and this file and `ccd/ccd` are pinned as members BY NAME. (The
# sentence this replaces said the test "does not scan `ccd/` at all", which is
# measurably false against the shipped test and told the next reader no
# mechanism existed where one does.) Keeping the three `CCRC_PROJ_CLASS`
# spellings in step is therefore a reading discipline only because nobody has
# written that rule — not because no mechanism could express it; if you widen
# one, widen the other two by hand.
CCRC_PROJ_CLASS='A-Za-z0-9._-'
CCRC_PROJ_MAX=64
CCRC_ID_MAX=128
# `SUPERVISED_FRESH_MS` (`shared/api.ts`) in seconds — the same 120 s window
# `_session_state`'s bash twin uses, tolerating 4 missed 30 s beats.
CCRC_FRESH_S=120
# The hold's own bound. `POST /api/sessions/:id/hold` validates only that the
# reason is a non-blank string and `ccd` only blankness, while `--actor` on the
# same verb IS capped at 512 — so this is the first bound the value meets.
# A hold that fails it is UNSPEAKABLE and the subject is silent.
#
# 127, NOT 256, AND THE OFF-BY-ONE IS THE WHOLE POINT (D-1896). `_ct_read` reads at most
# `CCRC_ID_MAX` (128) characters, so a value that comes back 128 long MAY have
# been truncated and there is no way to tell from here. Refusing at 127 means
# every value this function ever quotes was captured WHOLE. A 256 bound would
# be unreachable — dead, and worse than absent, because a 400-character hold
# would arrive truncated to 128, could lose its ` run:<id>` suffix in the cut,
# and would then render as CASE B ("It names NO run") for a hold that names one.
# Quoting a truncated hold as if it were the whole hold is exactly the lying
# card this design exists to prevent, so the bound refuses instead.
CCRC_HOLD_MAX=127
# The workdir's own two bounds (C1), argued at the gate that uses them in
# `_hook_hold_card`. The class is DERIVED from `CCRC_PROJ_CLASS` with the `/`
# PREPENDED, never appended: appended, the `-` this file's class ends with would
# land mid-class and spell the reversed range `_-/`, which is not a path class
# at all. The length is DERIVED from the read cap rather than restating 127, so
# the off-by-one — a value that reached `_ct_read`'s cap may have been truncated
# and must be refused — is a mechanism here instead of a number that has to be
# kept in step with `CCRC_ID_MAX` by hand. Both expansions are builtins: no fork.
CCRC_WD_CLASS="/$CCRC_PROJ_CLASS"
CCRC_WD_MAX=$(( CCRC_ID_MAX - 1 ))
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
    # R7 adds TWO-WORD phrases, not two words. Measured: a single-word
    # `*claims*` prefilter costs an extra jq fork on any payload merely
    # mentioning the word (p50 42 ms vs 33 ms); the phrases cost nothing
    # measurable. A line that runs them cannot fail to carry them literally.
    if [[ "$payload" == *graphify* || "$payload" == *"peers list"* \
       || "$payload" == *"claims take"* ]]; then
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
    # ONE EMIT, INDEPENDENT SUBJECTS. Two SessionStart envelopes make the
    # harness's stdout parser throw and the caller returns `{answer:{}}` —
    # which deletes BOTH cards fleet-wide, silently, with a warning that blames
    # a quoting bug that does not exist. So the builders SET text and this is
    # the only site that prints. `_hook_graph_card` returns early for a tree
    # with no cwd and for a tree the sweep left no word about; a registry
    # subject must not inherit either gate, because neither has anything to do
    # with the registry. THE JOIN SEPARATOR IS ONE SPACE — `${CARD:+$CARD }`
    # appends it only when a prior subject already put text in `$CARD`, so a
    # lone subject carries no leading or trailing space and a third subject
    # (Task 5) joins the same way, on the same separator, without re-deriving it.
    # INITIALISED HERE, BESIDE THE SUBJECTS, not inside `_hook_compact_card`:
    # that function runs only on `source == compact`, while
    # `_hook_compact_serve_end` below runs on EVERY SessionStart, and this file
    # is `set -u`. An initialiser that lived only on the compact path would
    # make every other SessionStart die on an unbound variable — the worst
    # shape this file can fail in, since the server reads the state it writes.
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD_COMPACT=""; CARD=""
    COMPACT_SERVE_FD=""; COMPACT_SERVE_NONCE=""
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
      if _hook_emit_context "$CARD" "$CARD_COMPACT" && [ -n "$CARD_COMPACT" ]; then _hook_compact_mark_served || true; fi
    fi
    # THE RETAINED SERVE LOCK ENDS HERE, on every path through this arm — the
    # marker, when one was published, was the last act inside it.
    _hook_compact_serve_end || true
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
subs=""; prev_state=""; gq=""; gd=""; cp=""; cc=""
{ read -r prev_state; read -r gq; read -r gd; read -r cp; read -r cc; read -r subs; } < <(jq -r \
  '(.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end),
   (if (.graphGateDenials | type) == "number" then (.graphGateDenials | floor) else 0 end),
   (if (.ccrcPeerReads | type) == "number" then (.ccrcPeerReads | floor) else 0 end),
   (if (.ccrcClaims | type) == "number" then (.ccrcClaims | floor) else 0 end),
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
[[ "$cp" =~ ^[0-9]+$ ]] || cp=0
[[ "$cc" =~ ^[0-9]+$ ]] || cc=0
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
# R7's counters reset with R4's and for D-1248's exact reason: the card is
# emitted once per new context, so a counter carried across a `/clear` would
# credit context N+1's card with context N's act.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; gd=0; cp=0; cc=0; fi
if [[ -n "$gcmd" && "$gcmd" =~ $GRAPH_QUERY_RE ]]; then gq=$((gq + 1)); fi
# THE PROXIMATE ACT and THE DISTAL ONE, counted apart. `peers list` is the act
# the co-tenant card prescribes; `claims take` is what that answer's own rule 0
# prescribes next, and it is the one with a durable server-side arbiter.
if [[ -n "$gcmd" && "$gcmd" =~ $CCRC_PEERS_RE  ]]; then cp=$((cp + 1)); fi
if [[ -n "$gcmd" && "$gcmd" =~ $CCRC_CLAIMS_RE ]]; then cc=$((cc + 1)); fi

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
  --argjson ccrcPeerReads "$cp" --argjson ccrcClaims "$cc" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries,
    graphGateDenials:$graphGateDenials, ccrcPeerReads:$ccrcPeerReads,
    ccrcClaims:$ccrcClaims}
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
# The two compaction arms run LAST, after the `working`/`done` stamp is on
# disk: each calls the helper under one locally resolved deadline, and the
# state write must never wait on either. Nothing below prints — PostCompact's
# whole output is a journal line on disk, and this file's contract is silence.
if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi
if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi
exit 0
