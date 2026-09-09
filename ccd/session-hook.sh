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
  # THE TOTAL CLIP LIVES HERE, at the ONE site every subject passes through.
  # A per-subject clip is one each new subject can forget; this one cannot be.
  # It is also what stands between an operator-controlled field and `jq`'s own
  # MAX_ARG_STRLEN (measured 131072 on this box: at 130442 bytes of card the
  # exec fails, `|| return 0` swallows it, and the hook prints NOTHING —
  # deleting the graphify card for that session too).
  set -- "${1:0:$CARD_MAX_CHARS}"
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

# ── memory convergence ────────────────────────────────────────────────────
# One memory store per PROJECT (`~/.ccrc/memory/<slug>`), not one per agent
# home. `$CLAUDE_CONFIG_DIR/projects/<slug>/memory` is per-home, so a session
# that swaps accounts mid-run keeps its transcript, workspace, hold and branch
# and silently changes memory stores — the one continuity ccrc exists to
# provide, missing. Measured 2026-09-08: 40 real memory directories across 8
# homes, and a session that read its own superseded record after a swap.
#
# THE SLUG IS READ, NEVER COMPUTED. `<slug>` is a pure function of the project
# path, and a second implementation of it disagrees SILENTLY: a slug that
# misses names a directory that does not exist, so the caller finds nothing,
# exits 0, and converges nothing (the `remember` plugin's own #294). The
# harness has already told us the answer — `transcript_path` is
# `<config dir>/projects/<slug>/<uuid>.jsonl` — so its DIRECTORY is the pair
# being converged. Match, never derive.
#
# THIS FUNCTION NEVER MERGES. It acts only where there is nothing to lose: an
# absent link, or a plain directory that is EMPTY. A directory with content and
# a symlink pointing somewhere else are both LEFT EXACTLY AS FOUND and reported
# by `ccrc doctor` instead — a hook that fires on every session start, ~20
# times over on this box, must never be the thing that merges data. `ccrc
# memory` owns that, as an explicit operator act.
#
# `rmdir` IS the emptiness test: it succeeds only on an empty directory, so its
# own failure is the answer and there is no check-then-act window between
# asking and acting.
#
# Silent and total: every failure path returns 0. A box where this cannot work
# still gets its cards, its hookstate and its nudges.
_hook_memory_converge() {   # -> converge this (home, project) pair; prints nothing; always 0
  local tp d slug link store
  tp=$(jq -r '.transcript_path // empty' <<<"$payload" 2>/dev/null) || return 0
  [ -n "$tp" ] || return 0
  d=$(dirname -- "$tp") || return 0
  [ -d "$d" ] || return 0
  slug=$(basename -- "$d") || return 0
  # A scratch cwd accumulates no durable memory. The harness mints a slug for
  # every directory a session is started in, including throwaway temp dirs
  # (measured: a dozen `-tmp-*` slugs in one home), and converging those would
  # fill the store with empty directories nobody will ever read.
  case "$slug" in -tmp*) return 0 ;; esac
  link="$d/memory"
  store="$HOME/.ccrc/memory/$slug"
  # Steady state first, and it is the whole cost on a converged box.
  if [ -L "$link" ]; then
    # R20 (Task 4 review round 2): `-ef` + `-d` is the SAME definition of
    # "converged" `_mem_state` and `_check_memory` now both use — a link that
    # RESOLVES to the store (through a relative target too, with no
    # `readlink` needed) and whose store is genuinely a DIRECTORY. When it
    # holds, there is nothing to do, full stop; this fast path costs one
    # `-ef` and one `-d` on the box's own common case. It is provably a
    # no-op change against the arm below for every case measured so far
    # (both arms already `return 0` unconditionally, and the only side
    # effect, `mkdir -p`, was already gated on `[ -d "$store" ]`), but it
    # keeps this hook, `_mem_state` and `_check_memory` naming the exact same
    # fact rather than three descriptions that happen to agree today.
    if [ "$link" -ef "$store" ] && [ -d "$store" ]; then
      return 0
    fi
    if [ "$(readlink -- "$link" 2>/dev/null)" = "$store" ]; then
      # R12 (review round 2, extended here from Task 2's `_mem_state` to this
      # hook, Task 4): a link whose TEXT already names the canonical store,
      # but whose store directory is gone or was never created, is NOT
      # converged — `_mem_state` and `_check_memory` both call that pair
      # forked. Returning 0 here without creating it would leave the hook
      # firing on this project forever without ever closing the one gap
      # standing between it and converged. Creating the missing directory
      # loses nothing — there is nothing behind a dangling link to lose — so
      # this stays inside this function's own "acts only where there is
      # nothing to lose" contract, and the failure stays silent either way.
      # (Left as a raw `readlink` text compare, not `-f`: the target's own
      # ancestor directories may not exist yet in exactly this dangling
      # case, and GNU `readlink -f` requires all but the last path component
      # to exist, so canonicalising here would make a genuinely-dangling
      # correct link unrecognisable — the opposite of this arm's job.)
      [ -d "$store" ] || mkdir -p -- "$store" 2>/dev/null
      return 0
    fi
    return 0   # points elsewhere: its target holds data — doctor reports it
  fi
  if [ -e "$link" ]; then
    rmdir -- "$link" 2>/dev/null || return 0   # non-empty: leave it, doctor reports it
  fi
  mkdir -p -- "$store" 2>/dev/null || return 0
  ln -s -- "$store" "$link" 2>/dev/null || return 0
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
# `_hook_hold_card`. And `single-definition.test.ts` does not scan `ccd/` at
# all — its four roots are the TypeScript packages, as this branch's own README
# addition says. Keeping the three in step is a reading discipline, not a
# mechanism; if you widen one, widen the other two by hand.
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
    # Convergence is independent of the cards and of the hookstate write, and
    # must happen even for `source == compact` (which returns early below):
    # a compacted session is still a session whose home may be unconverged.
    _hook_memory_converge || true
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD=""
    _hook_graph_card || true
    _hook_hold_card  || true
    _hook_ccrc_card  || true
    CARD="$CARD_GRAPH"
    [ -z "$CARD_HOLD" ] || CARD="${CARD:+$CARD }$CARD_HOLD"
    [ -z "$CARD_CCRC" ] || CARD="${CARD:+$CARD }$CARD_CCRC"
    [ -z "$CARD" ] || _hook_emit_context "$CARD"
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
exit 0
