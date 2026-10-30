# ccd/lib/train-proof.sh — the train proof of a PR a merge train landed and closed, moved out of ccd/ccd (D-7362's
# code; the move is D-7463).
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/disk-retention.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds, in the order ccd had them:
#   1. `_pr_train_py`, the train record's python: `_pr_py`'s `train-refs` and `train-check` modes (D-7335, D-7381), which
#      `_pr_py` hands to it with the same argv and stdin;
#   2. the bounded prover, `ccd pr-train-prove` (D-7378, D-7381);
#   3. the train proof's budgets, its kept proofs and tried records, `_ws_train_record` and `_pr_train_proofs` (D-7362,
#      D-7378, D-7381).
# It is a MOVE and nothing else: not one function body changed on the way (the python's first mode reads `if` where it
# read `elif`, the program's head being its own), and every test that exercised the train proof still does.
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/train-proof.sh`)
# by `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_TRAIN_SHA256`, near the foot of ccd/ccd, written at
# install time), read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start
# (`ccd: refused (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.

# @ccd-lib:trainpy
_pr_train_py() {   # mode [args…]; stdin = gh's JSON for the mode. `_pr_py`'s train-record modes (`train-refs`, `train-check`), reached through `_pr_py`
  # The program arrives on fd 3 and the JSON on stdin, for the reason `_pr_py`'s header gives.
  python3 /dev/fd/3 "$@" 3<<'PY'
import json, re, sys

mode = sys.argv[1]
# A PR number: the run id's grammar (`_child_runid_valid`, a positive decimal of at most ten
# digits), spelled in this program as in `_pr_py`'s because python cannot call the bash helper.
PR_NUM = r'[1-9][0-9]{0,9}'

if mode == 'train-refs':
    # The train PRs a member's comments name: `train #<n>` in any comment, the
    # comment a merge train leaves when it closes a member with the label.
    # Newest comment first, each number once, and EVERY one: a cap would let
    # stray newer mentions hide the real train, and `_ws_train_record`'s
    # deadline is what bounds the reads. Only digits leave here, so the shell
    # can anchor them before any reaches an argv.
    (member,) = sys.argv[2:3]
    try:
        doc = json.loads(sys.stdin.read() or 'null')
    except ValueError:
        doc = None
    comments = doc.get('comments') if isinstance(doc, dict) else None
    seen = []
    for c in reversed(comments if isinstance(comments, list) else []):
        body = c.get('body') if isinstance(c, dict) else None
        if not isinstance(body, str):
            continue
        for m in re.finditer(rf'(?i)\btrain\s+#({PR_NUM})\b', body):
            if m.group(1) != member and m.group(1) not in seen:
                seen.append(m.group(1))
    sys.stdout.write(''.join(n + '\n' for n in seen))

elif mode == 'train-check':
    # THE TRAIN RECORD (D-7335). stdin is one train PR (`gh pr view`) or a list
    # of them (`gh pr list --search`). A train proves the member landed when it
    # is MERGED into the member's base, from this repository, with a merge
    # commit, and its body's ONE `ccrc-train v1` block lists the member at
    # exactly the member's head. The block is an HTML comment on lines of its
    # own, the only part of the body a machine reads:
    #     <!-- ccrc-train v1
    #     member #<n> <40-hex head sha>
    #     -->
    # Human tables and lists beside it are never parsed. No block, two blocks,
    # a block that never closes, a line in it that is not a member line, or a
    # member listed twice proves nothing. Prints `<train>\t<merge oid>` for the
    # first that proves; else `?<sentence>` when a candidate's answer was not
    # definitive (an OPEN train, a missing or odd state), `!<sentence>` for the
    # first failed candidate's reason, nothing when there was no candidate at
    # all, or `?unreadable` when stdin was no PR's JSON and no list of them
    # (D-7381). Only a CLOSED train, another sha or no listing fails.
    (member, head, base_short) = sys.argv[2:5]
    try:
        doc = json.loads(sys.stdin.read() or 'null')
    except ValueError:
        doc = None
    if not isinstance(doc, (list, dict)):
        # No pull request's JSON at all (empty, unparseable, a bare value): GitHub
        # said nothing about any train, so `?` — unread, never a failed candidate (D-7381).
        sys.stdout.write('?unreadable\n')
        sys.exit(0)
    cands = doc if isinstance(doc, list) else [doc]
    OPEN, CLOSE = '<!-- ccrc-train v1', '-->'
    MEMBER = re.compile(rf'member #({PR_NUM}) ([0-9a-f]{{40}})')

    def train_block(body):
        # -> ({member number: head sha}, None) or (None, why).
        lines = [l.strip() for l in body.splitlines()]
        starts = [i for i, l in enumerate(lines) if l == OPEN]
        if not starts:
            return None, 'carries no ccrc-train v1 block'
        if len(starts) > 1:
            return None, 'carries %d ccrc-train v1 blocks, not one' % len(starts)
        got = {}
        for l in lines[starts[0] + 1:]:
            if l == CLOSE:
                return got, None
            m = MEMBER.fullmatch(l)
            if m is None:
                return None, 'has a ccrc-train v1 block with a line that is not a member line'
            if m.group(1) in got:
                return None, 'has a ccrc-train v1 block listing #%s twice' % m.group(1)
            got[m.group(1)] = m.group(2)
        return None, 'has a ccrc-train v1 block that never closes'

    why = None
    unread = None
    for t in cands:
        if not isinstance(t, dict):
            continue
        n = t.get('number')
        if not isinstance(n, int) or str(n) == member:
            continue
        oid = (t.get('mergeCommit') or {}).get('oid')
        state = t.get('state')
        if state == 'CLOSED':
            # GitHub's definitive answer: closed and never merged. A failed candidate.
            why = why or 'train #%d is closed, not merged' % n
            continue
        if (state != 'MERGED' or not isinstance(t.get('mergedAt'), str)
                or not isinstance(oid, str) or re.fullmatch(r'[0-9a-f]{40}', oid) is None):
            # An OPEN train may still merge, and a missing or odd state (or a
            # MERGED one with no merge commit) says nothing definitive: UNREAD,
            # never a failed candidate (#1797 round 7, D-7381).
            unread = unread or ('train #%d is still open' % n if state == 'OPEN'
                                else "train #%d's state could not be read" % n)
            continue
        if t.get('baseRefName') != base_short or t.get('isCrossRepository') is not False:
            why = why or 'train #%d did not merge into %s from this repository' % (n, base_short)
            continue
        body = t.get('body') if isinstance(t.get('body'), str) else ''
        listed, bad = train_block(body)
        if bad:
            why = why or 'train #%d %s' % (n, bad)
            continue
        if member not in listed:
            why = why or "train #%d's ccrc-train v1 block does not list #%s" % (n, member)
            continue
        if listed[member] != head:
            why = why or "train #%d's ccrc-train v1 block lists #%s at %s, not its head %s" % (n, member, listed[member], head)
            continue
        sys.stdout.write('%d\t%s\n' % (n, oid))
        sys.exit(0)
    # An unread candidate is never outvoted by a failed one: `?` wins over `!`.
    if unread:
        sys.stdout.write('?' + unread + '\n')
    elif why:
        sys.stdout.write('!' + why + '\n')
PY
}

# @ccd-lib:trainprove
cmd_pr_train_prove() {   # ccd pr-train-prove --project <project> [--max <K>]
  # THE BOUNDED PROVER (D-7378). `pr-state --project` has no room for a train
  # read inside its bound (`pr-timeout-budget.test.ts`), so a member a merge
  # train landed and CLOSED reads `train-unread` (unmeasured) on the sweep
  # until its proof is kept. This verb is the one place the sweep's members
  # are proven: the server runs it after the sweep, as a separate call with its
  # own timeout row, whenever a line read `train-unread`. It reads the same row
  # window the sweep reads (`_gh_pr_list`, one call), proves at most K
  # labelled CLOSED members that have no kept proof yet under
  # PR_TRAIN_PROVE_TIMEOUT for the whole call, and keeps every proof in
  # `$REG/.train-proofs`. The next sweep then reads `merged` from the kept
  # proof, which is what wakes `sweepMerged` and a run's merging wait.
  #
  # IT IS FAIR (D-7381). Each attempt that does not prove writes the member's
  # TRIED line (`$REG/.train-tried`, outcome and time, never a proof). The K
  # are chosen from the members with no tried line first, then the OLDEST
  # tried, so members GitHub keeps refusing never starve one that landed. A
  # member whose record was read and FAILED less than PR_TRAIN_TRIED_TTL ago is
  # not asked again (`unproven`, no gh call) and the sweep reads it
  # `train-unproven`; an `unread` outcome is asked again on the next call.
  #
  # One JSON line per labelled member of the project's workspaces (a member
  # two workspaces share is listed once, under the first):
  #   {"id","number","proof"} with proof one of
  #   kept      a proof was already kept; no gh call
  #   proved    proven now, and kept
  #   unproven  the record was read and did not prove it, now or less than
  #             PR_TRAIN_TRIED_TTL ago (nothing kept)
  #   unread    the record could not be read inside the budget (nothing kept)
  #   deferred  past this call's K; a later call reaches it
  local p="" max="$PR_TRAIN_PROVE_MAX"
  while (( $# )); do
    case "$1" in
      --project) [[ $# -ge 2 ]] || die "usage: ccd pr-train-prove --project <project> [--max <K>]"; p="$2"; shift 2 ;;
      --max)     [[ $# -ge 2 ]] || die "usage: ccd pr-train-prove --project <project> [--max <K>]"; max="$2"; shift 2 ;;
      *)         die "usage: ccd pr-train-prove --project <project> [--max <K>]" ;;
    esac
  done
  [[ "$p" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad project"
  [[ "$max" =~ ^([1-9]|1[0-6])$ ]] || die "bad --max (1 to 16)"

  local -a ids=()
  local f id
  for f in "$REG"/*.workspace; do
    [[ -e "$f" ]] || continue
    id=$(basename "$f" .workspace)
    [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || continue
    [[ -f "$REG/$id.uuid" ]] || continue
    [[ "$(_reg_get "$id" project)" == "$p" ]] || continue
    ids+=("$id")
  done
  (( ${#ids[@]} )) || return 0

  local main repo rows
  main="$PROJECTS_ROOT/$p"
  repo=$(_gh_repo_slug "$main") || { printf '{"phase":"unknown","reason":"no-remote"}\n'; return 0; }
  rows=$(_gh_pr_list "$repo") || { printf '%s\n' "$rows"; return 0; }

  # 1. Every labelled member, once, in workspace order: `<id> <n> <head> <base>`.
  local project branch base baseShort tip ahead workdir wthead registered BIND_REFUSAL c h rc key i
  local -a entries=()
  local -A seen=() word=()
  for id in "${ids[@]}"; do
    _pr_bind_facts "$id" "$main" "" || continue
    while IFS=$'\t' read -r c h; do
      _pr_num_valid "$c" && [[ "$h" =~ ^[0-9a-f]{40}$ ]] || continue
      key="$c $h $baseShort"
      [[ -n "${seen[$key]:-}" ]] && continue
      seen[$key]=1
      entries+=("$id $key")
    done < <(printf '%s' "$rows" | _pr_py train-cands "$branch" "$baseShort")
  done

  # 2. Answer what needs no gh call; rank the rest: no tried line first (0),
  #    then by when it was last tried, oldest first; ties keep workspace order.
  local -a ranked=()
  for (( i = 0; i < ${#entries[@]}; i++ )); do
    read -r id c h baseShort <<< "${entries[$i]}"
    key="$c $h $baseShort"
    if _ws_train_kept "$repo" "$baseShort" "$c" "$h"; then
      word[$key]=kept
    elif _ws_train_tried_fresh_failed "$repo" "$baseShort" "$c" "$h"; then
      word[$key]=unproven
    elif _ws_train_tried_get "$repo" "$baseShort" "$c" "$h"; then
      ranked+=("$(( _WS_TRIED_AT + 1 )) $i")
    else
      ranked+=("0 $i")
    fi
  done

  # 3. Prove the first K under the call's one budget; the rest wait.
  local spent=0 r
  local _PR_TRAIN_DEADLINE=$(( SECONDS + PR_TRAIN_PROVE_TIMEOUT ))
  local -a order=()
  (( ${#ranked[@]} )) && mapfile -t order < <(printf '%s\n' "${ranked[@]}" | sort -s -n -k1,1 -k2,2)
  for r in "${order[@]}"; do
    i="${r#* }"
    read -r id c h baseShort <<< "${entries[$i]}"
    key="$c $h $baseShort"
    if (( spent >= max )); then word[$key]=deferred; continue; fi
    spent=$(( spent + 1 ))
    _ws_train_record "$main" "$repo" "$c" "$h" "$baseShort" 1 < /dev/null; rc=$?
    case "$rc" in 0) word[$key]=proved ;; 1) word[$key]=unproven ;; *) word[$key]=unread ;; esac
  done

  for r in "${entries[@]}"; do
    read -r id c h baseShort <<< "$r"
    printf '{"id":%s,"number":%s,"proof":"%s"}\n' "$(_json_str "$id")" "$c" "${word["$c $h $baseShort"]}"
  done
  return 0
}

# @ccd-lib:trainrecord
# THE TRAIN PROOF'S TIME BUDGETS (D-7362), in seconds: the most one verb may
# spend on train records, over every member it proves, each gh call bounded by
# what is left (never more than `PR_GH_TIMEOUT`). The proof is computed in ONE
# place (`_pr_train_proofs` -> `_ws_train_record`) and every reader takes its
# answer, so the budgets are the only per-verb difference:
#   pr-state --session  PR_STATE_TRAIN_TIMEOUT (inside the 25 s bound, beside its one rows call)
#   pr-state --project  0 — the sweep has no room (`pr-timeout-budget.test.ts`) and reads proofs a
#                       `--session` read, an audit or `pr-train-prove` already made and kept; a
#                       labelled member with no kept proof reads `train-unread` (D-7378), unmeasured
#   pr-train-prove      PR_TRAIN_PROVE_TIMEOUT over at most PR_TRAIN_PROVE_MAX members, its own verb and
#                       its own server row, run by the 120 s sweep after `pr-state --project` (D-7378)
#   pr-landing          PR_LANDING_TRAIN_TIMEOUT, beside its GraphQL and REST reads, keeping nothing
#   ws-audit / ws-reap  WS_TRAIN_TIMEOUT per workspace
# Running out of budget proves nothing and is UNREAD (rc 2), never `not landed`.
# Only a read with no budget at all (it can make no gh call: the sweep) answers
# from the member's tried record, when it says the record was read and FAILED
# less than PR_TRAIN_TRIED_TTL ago (D-7381): then it is that refusal (rc 1).
PR_STATE_TRAIN_TIMEOUT=6
PR_LANDING_TRAIN_TIMEOUT=3
WS_TRAIN_TIMEOUT=16
PR_TRAIN_PROVE_TIMEOUT=16
PR_TRAIN_PROVE_MAX=3
# THE KEPT PROOFS: one `<repo> <base> <member> <head> <train> <train merge
# commit>` line per proven member, appended by a proof made with keep=1. A
# MERGED train never un-merges, so a proof stands for good; nothing but a proof
# is written, so a refusal is always re-asked. Keyed by the base too (D-7378):
# a proof that a train merged into one base is no proof for another. Every
# field is anchored on the way in and again on the way out, and a line that
# does not parse (an older five-field line among them) is no proof.
PR_TRAIN_PROOFS_FILE=.train-proofs
# THE TRIED RECORDS (D-7381): one `<repo> <base> <member> <head> <outcome>
# <epoch>` line per member a proof was ATTEMPTED for and did not prove, written
# by a read that keeps (keep=1). The outcome is `failed` (GitHub answered and
# the record did not prove it: `_ws_train_record`'s 1) or `unread` (its 2). A
# separate file from the proofs, and NEVER read as a proof: it only orders the
# prover (no record first, then the oldest tried) and, while a `failed` line is
# fresh (PR_TRAIN_TRIED_TTL), lets a read with no budget at all (no gh call
# made) answer `train-unproven` instead of `train-unread` and keeps the prover
# from asking again. An `unread` line is retried on the next call. A proof found
# by any read (keep=0 too) removes the member's line, and a kept proof is
# consulted before any line; lines older than PR_TRAIN_TRIED_KEEP are dropped
# on write.
PR_TRAIN_TRIED_FILE=.train-tried
PR_TRAIN_TRIED_TTL=1800
PR_TRAIN_TRIED_KEEP=86400

_ws_train_tried_get() {   # repo base number head -> 0 with the outcome in _WS_TRIED_OUTCOME and its epoch in _WS_TRIED_AT; 1 when none is recorded
  local got
  _WS_TRIED_OUTCOME="" _WS_TRIED_AT=""
  _ws_train_keyable "$1" "$2" && [[ -f "$REG/$PR_TRAIN_TRIED_FILE" ]] || return 1
  got=$(awk -v r="$1" -v b="$2" -v n="$3" -v h="$4" \
          '$1 == r && $2 == b && $3 == n && $4 == h && NF == 6 { l = $5 " " $6 } END { if (l != "") print l }' \
          "$REG/$PR_TRAIN_TRIED_FILE" 2>/dev/null)
  [[ "$got" =~ ^(failed|unread)\ ([0-9]{1,12})$ ]] || return 1
  _WS_TRIED_OUTCOME="${BASH_REMATCH[1]}" _WS_TRIED_AT="${BASH_REMATCH[2]}"
}

_ws_train_tried_fresh_failed() {   # repo base number head -> 0 when the member's record was read and FAILED less than PR_TRAIN_TRIED_TTL ago
  local now age
  _ws_train_tried_get "$@" && [[ "$_WS_TRIED_OUTCOME" == failed ]] || return 1
  _now_s_to now
  age=$(( now - _WS_TRIED_AT ))
  (( age >= 0 && age < PR_TRAIN_TRIED_TTL ))
}

_ws_train_tried_put() {   # repo base number head outcome -> replaces the member's tried line with `outcome` now (`failed` or `unread`), or removes it when outcome is empty. Best effort: a file that cannot be written orders nothing and proves nothing
  local f="$REG/$PR_TRAIN_TRIED_FILE" tmp now
  _ws_train_keyable "$1" "$2" && _pr_num_valid "$3" && [[ "$4" =~ ^[0-9a-f]{40}$ ]] || return 0
  [[ -z "$5" || "$5" == failed || "$5" == unread ]] || return 0
  [[ -n "$5" || -f "$f" ]] || return 0
  _now_s_to now
  tmp=$(mktemp "$REG/.train-tried.tmp.XXXXXX" 2>/dev/null) || return 0
  {
    [[ ! -f "$f" ]] || awk -v r="$1" -v b="$2" -v n="$3" -v h="$4" -v now="$now" -v keep="$PR_TRAIN_TRIED_KEEP" \
      'NF == 6 && !($1 == r && $2 == b && $3 == n && $4 == h) && $6 ~ /^[0-9]+$/ && now - $6 < keep { print }' "$f"
    if [[ -n "$5" ]]; then printf '%s %s %s %s %s %s\n' "$1" "$2" "$3" "$4" "$5" "$now"; fi
  } > "$tmp" 2>/dev/null && mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
  return 0
}

_ws_train_left() {   # -> on stdout, the seconds the next train-record gh call may take: what is left of `_PR_TRAIN_DEADLINE` (a `$SECONDS` value; unset is none left), never more than PR_GH_TIMEOUT; rc 1 once it is spent
  local l=$(( ${_PR_TRAIN_DEADLINE:-$SECONDS} - SECONDS ))
  (( l > 0 )) || return 1
  (( l < PR_GH_TIMEOUT )) || l=$PR_GH_TIMEOUT
  printf '%s' "$l"
}

_pr_num_valid() { _child_runid_valid "$@"; }   # value -> 0 iff it is a legal PR number: the run id's grammar (a positive decimal of at most ten digits, ASCII in every locale), spelled once in _child_runid_valid

_ws_train_keyable() {   # repo base -> 0 when both may stand as one field of a kept-proof line: the slug's own spelling, and a base name with no space, no leading dash and nothing outside a ref's usual letters
  [[ "$1" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ && "$2" =~ ^[A-Za-z0-9._/-]+$ && "$2" != -* ]]
}

_ws_train_kept() {   # repo base number head -> 0 with the kept proof's train in _WS_TRAIN_NUM and its merge commit in _WS_TRAIN_MERGE; 1 when none is kept. Same repository, same base, same member, same head (D-7378)
  local kept
  _ws_train_keyable "$1" "$2" && [[ -f "$REG/$PR_TRAIN_PROOFS_FILE" ]] || return 1
  kept=$(awk -v r="$1" -v b="$2" -v n="$3" -v h="$4" \
           '$1 == r && $2 == b && $3 == n && $4 == h && NF == 6 { print $5 " " $6; exit }' \
           "$REG/$PR_TRAIN_PROOFS_FILE" 2>/dev/null)
  [[ "$kept" =~ ^([^ ]+)\ ([0-9a-f]{40})$ ]] || return 1
  _WS_TRAIN_NUM="${BASH_REMATCH[1]}" _WS_TRAIN_MERGE="${BASH_REMATCH[2]}"
  _pr_num_valid "$_WS_TRAIN_NUM" || { _WS_TRAIN_NUM="" _WS_TRAIN_MERGE=""; return 1; }
}

_ws_train_record() {   # main repo number headOid baseShort [keep] -> 0 with the train PR in _WS_TRAIN_NUM and its merge commit in _WS_TRAIN_MERGE; else 1 (not landed) or 2 (GitHub could not be reached, or the budget ran out, before anything proved it), the sentence in _WS_TRAIN_WHY. Called directly, never in $(…), so the globals reach the caller
  # THE PROOF FOR A PR CLOSED AS LANDED IN A MERGE TRAIN, and it is the TRAIN
  # RECORD, never a tree merge. A train squashes its members together and
  # resolves their overlaps, so no member's tree need be in the landing commit
  # — two members editing one hunk each fail any tree comparison — and main
  # editing those lines later makes a merge into its head conflict for ever.
  # What does hold is what the train itself wrote down: the train PR the member
  # names (in the comment the train leaves on it, `train #<n>`), or one a
  # search on the member's head sha finds, is MERGED and its one `ccrc-train v1`
  # block lists this member at exactly this member's head sha (`_pr_py
  # train-check`, D-7335; the format is in the README).
  #
  # EVERY REFERENCE IS A CANDIDATE, AND A BAD ONE IS ONLY A FAILED CANDIDATE
  # (D-7362) — and a candidate FAILS only when GitHub DEFINITIVELY answered
  # about it (D-7381): the train PR was read and is CLOSED unmerged (an OPEN
  # train, or a missing or odd state, is unread: it may yet merge), lists
  # another sha or does not list the member, or gh said the number is not a
  # pull request in this repository (rc 1 with `Could not resolve to a
  # PullRequest` on its stderr). Every other failure — rc 1 with an HTTP 5xx, a
  # rate limit, a network or auth error, rc 124, a signal, an answer that is
  # not a pull request's JSON — is UNREAD. The search goes on through every
  # reference the comments name and then the search fallback: a newer stray
  # `train #77` never hides the real train named before it. `2` means GitHub
  # did not answer about SOME candidate — a train, the member's comments or the
  # search — or the deadline (`_PR_TRAIN_DEADLINE`, a `$SECONDS` value the verb
  # set; unset is no budget at all) ran out, and nothing proved the landing: an
  # unread candidate is never outvoted by an empty search. A proof found first
  # always wins.
  #
  # A READ WITH NO BUDGET LEFT — one that can make no gh call at all, the
  # `--project` sweep — answers from the member's TRIED record (D-7381): a
  # record read and FAILED less than PR_TRAIN_TRIED_TTL ago is `1` (closed,
  # `train-unproven`), so the sweep shows a refused member as refused while the
  # record is fresh; anything else is `2`. A read that DID ask GitHub and hit an
  # unread candidate is `2` regardless of a fresh line (#1797 round 7). With
  # keep=1 an attempt that did not prove writes the member's tried line
  # (`failed` for 1, `unread` for 2); a proof found by any read, keep=0
  # included, removes it; an answer taken from a fresh line rewrites nothing.
  #
  # The caller bound the member: CLOSED with the label, on this branch and
  # base. Every number and sha placed in a gh argv is anchored first (spec §7):
  # the member number and head here, a train number by `train-refs`'s
  # digit-only output and again below.
  local main="$1" repo="$2" n="$3" head="$4" base="$5" keep="${6:-0}" out t ans why="" unreach=0 left rc errf
  _WS_TRAIN_WHY="" _WS_TRAIN_MERGE="" _WS_TRAIN_NUM=""
  _pr_num_valid "$n" && [[ "$head" =~ ^[0-9a-f]{40}$ ]] \
    || { _WS_TRAIN_WHY="gh named #$n at '$head', not a full head sha a train record can list"; return 1; }
  # A proof already kept answers without a gh call, before any tried line is
  # consulted, and clears a stale one (round 7).
  if _ws_train_kept "$repo" "$base" "$n" "$head"; then
    _ws_train_tried_get "$repo" "$base" "$n" "$head" && _ws_train_tried_put "$repo" "$base" "$n" "$head" ""
    return 0
  fi
  local fields=number,state,mergedAt,mergeCommit,body,baseRefName,isCrossRepository
  if ! left=$(_ws_train_left); then
    if _ws_train_tried_fresh_failed "$repo" "$base" "$n" "$head"; then
      _WS_TRAIN_WHY="the train record for #$n was read and did not prove it less than $(( PR_TRAIN_TRIED_TTL / 60 )) minutes ago"; return 1
    fi
    _WS_TRAIN_WHY="the train record for #$n was not read inside this read's time budget"; return 2
  fi
  # gh's stderr for a train read is what tells a definitive "no such pull
  # request" from a transient failure; with no scratch file every failure is unread.
  errf=$(_plat_mktemp 2>/dev/null) || errf=""
  if out=$(_plat_timeout "$left" gh pr view "$n" --repo "$repo" --json comments 2>/dev/null); then
    while IFS= read -r t; do
      _pr_num_valid "$t" || continue
      left=$(_ws_train_left) || { unreach=1; break; }
      if ans=$(_plat_timeout "$left" gh pr view "$t" --repo "$repo" --json "$fields" 2>"${errf:-/dev/null}"); then :
      else
        rc=$?
        # FAILED only when GitHub said this number is no pull request here
        # (D-7381); a 5xx, a rate limit, the network, auth, a timeout (124) or
        # a signal is UNREAD (D-7378).
        if (( rc == 1 )) && [[ -n "$errf" ]] \
             && grep -qE 'Could not resolve to a PullRequest|is not a pull request' "$errf" 2>/dev/null; then
          [[ -n "$why" ]] || why="#$n names train #$t, which GitHub says is not a pull request in this repository"
        else
          unreach=1
        fi
        continue
      fi
      ans=$(printf '%s' "$ans" | _pr_py train-check "$n" "$head" "$base")
      case "$ans" in
        '!'*) [[ -n "$why" ]] || why="${ans#!}" ;;
        # An answer that is no train PR's JSON says nothing about the train: unread.
        ''|'?'*) unreach=1 ;;
        *)    _WS_TRAIN_NUM="${ans%%$'\t'*}" _WS_TRAIN_MERGE="${ans#*$'\t'}"; break ;;
      esac
    done < <(printf '%s' "$out" | _pr_py train-refs "$n")
  else
    unreach=1
  fi
  [[ -n "$errf" ]] && rm -f "$errf"
  if [[ -z "$_WS_TRAIN_MERGE" ]]; then
    if left=$(_ws_train_left) && out=$(_plat_timeout "$left" gh pr list --repo "$repo" --state merged --limit 5 \
            --search "$head in:body" --json "$fields" 2>/dev/null); then
      ans=$(printf '%s' "$out" | _pr_py train-check "$n" "$head" "$base")
      case "$ans" in
        '!'*)  [[ -n "$why" ]] || why="${ans#!}" ;;
        # A search answer that is not a JSON list of PRs was not read.
        '?'*)  unreach=1 ;;
        ?*)    _WS_TRAIN_NUM="${ans%%$'\t'*}" _WS_TRAIN_MERGE="${ans#*$'\t'}" ;;
      esac
    else
      unreach=1
    fi
  fi
  if _pr_num_valid "$_WS_TRAIN_NUM" && [[ "$_WS_TRAIN_MERGE" =~ ^[0-9a-f]{40}$ ]]; then
    if [[ "$keep" == 1 ]] && _ws_train_keyable "$repo" "$base"; then
      printf '%s %s %s %s %s %s\n' "$repo" "$base" "$n" "$head" "$_WS_TRAIN_NUM" "$_WS_TRAIN_MERGE" \
        >> "$REG/$PR_TRAIN_PROOFS_FILE" 2>/dev/null || true
    fi
    # A proof found by ANY read removes the member's tried line, keep=0 too: a
    # read that keeps no proof still never leaves a stale `failed` line behind.
    _ws_train_tried_put "$repo" "$base" "$n" "$head" ""
    return 0
  fi
  _WS_TRAIN_NUM="" _WS_TRAIN_MERGE=""
  if (( unreach )); then
    # A read that made gh calls and hit an unread candidate is UNREAD, whatever
    # a fresh `failed` line says (round 7): only the no-budget return above,
    # which could ask GitHub nothing, answers from that line.
    [[ "$keep" == 1 ]] && _ws_train_tried_put "$repo" "$base" "$n" "$head" unread
    _WS_TRAIN_WHY="GitHub could not be read for the train record of #$n${why:+, and $why}"; return 2
  fi
  [[ "$keep" == 1 ]] && _ws_train_tried_put "$repo" "$base" "$n" "$head" failed
  _WS_TRAIN_WHY="${why:-no merged train PR names #$n or lists it at $head}"
  return 1
}

_pr_train_proofs() {   # main repo branch baseShort keep rows -> _PR_TRAIN_PROOFS (the lines `_pr_py` hands python), _PR_TRAIN_REFUSED (`<n> <head>` per member whose record was READ and failed) and _PR_TRAIN_FAILS (`<n> <rc> <sentence>` per refused member). Called directly, never in $(…)
  # THE ONE PLACE `landedInTrain` IS DECIDED (D-7362). Every reader of a train
  # landing — `pr-state`'s phase and the archive trigger it feeds, the landing
  # lane's merged notice, the queue word, the cleanup audit and the reap —
  # runs the rows through here before `_pr_py` annotates them, and `annotate`
  # sets `landedInTrain` only for a member listed in `_PR_TRAIN_PROOFS`. A
  # label whose record was read and failed is `trainUnproven`: closed, never
  # merged. A label whose record was NOT read (rc 2: no budget, a timeout,
  # GitHub unreachable) is in neither list and reads `trainUnread`: unmeasured
  # (D-7378). EVERY call starts from empty, so a list can never carry one
  # call's — or one workspace's — answers into the next.
  local main="$1" repo="$2" branch="$3" base="$4" keep="$5" rows="$6" c h rc
  _PR_TRAIN_PROOFS="" _PR_TRAIN_FAILS="" _PR_TRAIN_REFUSED=""
  while IFS=$'\t' read -r c h; do
    _pr_num_valid "$c" && [[ "$h" =~ ^[0-9a-f]{40}$ ]] || continue
    _ws_train_record "$main" "$repo" "$c" "$h" "$base" "$keep"; rc=$?
    if (( rc == 0 )); then
      _PR_TRAIN_PROOFS+="$c $h $_WS_TRAIN_NUM $_WS_TRAIN_MERGE"$'\n'
    else
      (( rc == 1 )) && _PR_TRAIN_REFUSED+="$c $h"$'\n'
      _PR_TRAIN_FAILS+="$c $rc $_WS_TRAIN_WHY"$'\n'
    fi
  done < <(printf '%s' "$rows" | _pr_py train-cands "$branch" "$base")
  return 0
}
