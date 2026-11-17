# ccd/lib/long-lived.sh — the Overlord's ccd arms (spec 2026-11-09 §3.2 C4, §3.4): the arms a long-lived role needs on the
# fleet box. Region `keepawake` holds the two sleep markers' one writer in the tree, `ccd keep-awake`.
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/pool-set.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds new code only (the large-file programme's rule: new code goes to its target module); no function of ccd/ccd moved
# here. Its region `keepawake` sits in ccd/ccd beside `cmd_coord_pause`, its precedent, where its pointer line is.
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/long-lived.sh`)
# by `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_LONGLIVED_SHA256`, near the foot of ccd/ccd, written at
# install time), read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start
# (`ccd: refused (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.
#
# Every assignment here is a plain one, never `declare`: the loader evaluates this file inside a function, where a top-level
# `declare` would be local to it and lost.

# @ccd-lib:keepawake
# THE STAMP (plan w1-ccd-arms, question 1): the exact bytes `ccd keep-awake` writes into each marker, no newline. Only a
# marker holding exactly these bytes is keep-awake's: `off` removes no other, and the renewal's fresh start passes no other.
KEEP_AWAKE_STAMP='keep-awake v1'
cmd_keep_awake() {   # ccd keep-awake --session <id> --state on|off — set or clear the two sleep markers on one session (spec §3.2, C4)
  # A server-composed verb, never a session's (the designation's create and retire, X6): it writes `$REG/<id>.no-hibernate`
  # and `$REG/<id>.no-roll` holding its stamp, and removes only a marker holding exactly that stamp (question 8). A marker
  # it did not write is the operator's opt-out: kept, and said twice, as today's line (`kept <marker>: not keep-awake's`)
  # and as the token `kept-foreign <marker>`, which a caller may parse; the verb still exits 0. `on` writes the stamp into
  # a temp file in `$REG` (mktemp, a regular file it owns) and publishes it with link(2), `_reg_generation_mint`'s
  # idiom: link fails EEXIST on EVERY kind of entry (a regular file, a dangling link, a FIFO, a link to /dev/null), so a
  # hand marker made between the check and the publish is never overwritten, never blocks the verb and is never written
  # through, and a write that fails (a short write, ENOSPC) is never published, so no partial marker is left. The temp
  # file is removed either way. A marker either arm cannot read (a link, not a regular file, not readable, or the bounded
  # read timed out) is kept, said with why, and the verb exits 1. CHECKED on both arms, for `cmd_coord_pause`'s reason:
  # no `-e`, so an unchecked write would fall through to the echo. Only the `kept-foreign` token is for parsing.
  # Each marker's publish is one spelled line, so the single-definition scan sees each write (ask-digest.test.ts, D-5242).
  local LC_ALL=C IFS=' ' id="${2-}" state="${4-}" field f t rc=0
  [[ $# -eq 4 && "$1" == --session && "$3" == --state && ( "$state" == on || "$state" == off ) ]] \
    || die "usage: ccd keep-awake --session <id> --state on|off"
  _reg_id_ok "$id" || die "bad session id"
  [[ "$state" == off || -f "$REG/$id.uuid" ]] || die "no such session: $id"
  for field in no-hibernate no-roll; do
    f="$REG/$id.$field"; _keep_awake_ours "$id" "$field"
    case "$state $KEEP_AWAKE_READ" in
      # ACCEPTED WINDOW (review 2231 F5): the read and the remove are two steps, so an operator's marker swapped in by the
      # same uid between them is removed. Closing it would take a rename-aside-and-verify for a same-user hand edit
      # landing inside microseconds; the coordinator accepted the window.
      "off ours") rm -f -- "$f" && [[ ! -e "$f" && ! -L "$f" ]] && continue; die "could not remove $f — the marker still stands" ;;
      "on absent")
        t=$(mktemp "$REG/.$id.$field.keep-awake.XXXXXX" 2>/dev/null) || die "could not write $f — the session is NOT kept awake"
        if [[ "$field" == no-hibernate ]]; then { printf '%s' "$KEEP_AWAKE_STAMP" > "$t" && link "$t" "$REG/$id.no-hibernate"; } 2>/dev/null
        else { printf '%s' "$KEEP_AWAKE_STAMP" > "$t" && link "$t" "$REG/$id.no-roll"; } 2>/dev/null; fi; rm -f -- "$t"
        # Read again (review 2231 F4): the loser of two concurrent `on` calls finds the winner's marker, which is ours.
        _keep_awake_ours "$id" "$field" && continue
        [[ -e "$f" || -L "$f" ]] || die "could not write $f — the session is NOT kept awake" ;;
      "on ours"|"off absent") continue ;;
    esac
    if [[ "$KEEP_AWAKE_READ" == unreadable ]]; then rc=1; printf 'kept %s: unreadable (a link, not a regular file, not readable, or the read timed out)\n' "$field"
    else printf 'kept %s: not keep-awake'"'"'s\nkept-foreign %s\n' "$field" "$field"; fi
  done
  # `awake` only when both markers are provably keep-awake's or foreign (rc 0): an unreadable entry is no promise of sleep.
  if [[ "$state" == off ]]; then echo "released $id"; elif (( ! rc )); then echo "awake $id"; fi
  return "$rc"
}
_keep_awake_ours() {   # id marker -> rc 0 iff $REG/<id>.<marker> is a regular, readable file, not a link, holding exactly the
  # stamp; rc 1 otherwise, never rc 2 (every caller but `off` treats "not provably ours" one way). It sets KEEP_AWAKE_READ
  # to one of four words, so `off` alone tells a foreign marker from one it cannot read: `ours`, `absent` (no entry, -e and
  # -L both false), `foreign` (readable, other bytes) or `unreadable`. The read is bounded twice: in size (65 bytes, so a
  # longer file or a NUL, turned into a newline, is not the stamp) and in time (`_plat_timeout 2`, so a FIFO swapped in
  # between the -f test and the open cannot block). C locale: the same bytes give one verdict under any caller's locale.
  local LC_ALL=C IFS=' ' f="$REG/$1.$2" v
  KEEP_AWAKE_READ=unreadable; [[ -d "$REG" && -x "$REG" ]] || return 1
  KEEP_AWAKE_READ=absent; [[ -e "$f" || -L "$f" ]] || return 1
  KEEP_AWAKE_READ=unreadable; [[ -L "$f" || ! -f "$f" || ! -r "$f" ]] && return 1
  v=$( { _plat_timeout 2 head -c 65 -- "$f" | tr '\000' '\n'; } 2>/dev/null && printf x) || return 1
  KEEP_AWAKE_READ=foreign; [[ "${v%x}" == "$KEEP_AWAKE_STAMP" ]] || return 1
  KEEP_AWAKE_READ=ours
}

# @ccd-lib:holddown
# THE HOLD-DOWN (spec §3.4 H16, "The return waits, and ccd owns the hold-down"; Table 11.5b; plan w1-ccd-arms, questions 3,
# 4 and 5): a long-lived role keeps its fallback class this many seconds after its degraded stamp was written, though its
# intended class is servable again, so a lane that serves on and off never flips the class each settle. Always longer than
# a generation's least age (`shared/continuity.ts#LEAST_AGE_MS`; `ccd-route-holddown.test.ts` harvests both). ccd's alone:
# the server's serviceability answer has no hold-down input (question 3), and it is asked only at the settle's servable arm
# and the fresh pick's first step, never in `_route_restore`, so the stale-intent clear is never held (question 4).
ROUTE_HOLD_DOWN_S=3600
_role_long_lived() {   # id -> rc 0 long-lived | 1 not (no profile entry, or the row's longLived is false) | 2 undecidable
  # FLEET_ROLES.longLived, projected into the launch row (slug long-lived-is-projected): ccd holds no role-name list. No
  # entry at the route field `profile` is today's behaviour. An entry that is a link, not a regular file or not readable,
  # bytes outside the field's `^[a-z]{1,16}$`, a row that is absent, a key that is absent or not a boolean, or a launch
  # profiles file jq cannot read are all undecidable (rc 2), which every caller reads as long-lived: it fails safe (question
  # 5). The read is bounded in size (17 bytes) and time (`_plat_timeout 2`: a FIFO swapped in after the -f test cannot block).
  local LC_ALL=C IFS=' ' f="$REG/$1.profile" p v
  [[ -d "$REG" && -x "$REG" ]] || return 2
  [[ -e "$f" || -L "$f" ]] || return 1
  [[ -L "$f" || ! -f "$f" || ! -r "$f" ]] && return 2
  p=$( { _plat_timeout 2 head -c 17 -- "$f" | tr '\000' '\n'; } 2>/dev/null && printf x) || return 2; p="${p%x}"
  [[ "$p" =~ ^[a-z]{1,16}$ ]] || return 2
  v=$(jq -r --arg r "$p" '.[$r].longLived | if type == "boolean" then . else error("no boolean") end' "$LAUNCH_PROFILES_JSON" 2>/dev/null) || return 2
  case "$v" in true) return 0 ;; false) return 1 ;; *) return 2 ;; esac
}
_route_holddown_holds() {   # id -> rc 0 hold | 1 the return may land | 3 hold, and the stamp's time is later than ccd's clock
  # THE DECIDER WRITES NOTHING (review 2148 F8), so the fresh pick's read of it touches nothing. Not long-lived: rc 1, today.
  # Long-lived or undecidable: the age of `$REG/<id>.degraded` by its mtime (`_reg_set` renames a temp file over it, so the
  # mtime is the write's time) against ccd's clock (`_now_s_to`). A time that cannot be read holds (unmeasured holds).
  local LC_ALL=C IFS=' ' t now
  _role_long_lived "$1"; (( $? == 1 )) && return 1
  t=$(_plat_mtime "$REG/$1.degraded" 2>/dev/null); [[ "$t" =~ ^[0-9]{1,12}$ ]] || return 0
  _now_s_to now; (( 10#$t > now )) && return 3
  (( now - 10#$t < ROUTE_HOLD_DOWN_S )) && return 0; return 1
}
_route_holddown_settle() {   # id degraded-class -> rc 0 hold (the settle composes the degraded class) | rc 1 restore
  # The settle's act on the decider's answer. A stamp whose time reads later than ccd's clock (a clock that stepped back)
  # is written again, its value unchanged, so it ages from now: one more hold-down at most (Review Focus 5). It is a third
  # writer of the stamp's TIME, never of its class (slug holddown-restamp-writes-the-same-value), and says so once.
  _route_holddown_holds "$1"; case $? in 1) return 1 ;; 3) _reg_set "$1" degraded "$2" 2>/dev/null &&
    echo "$(date '+%F %T') holddown-restamp $1: the degraded stamp's time read later than ccd's clock; $2 written again as now" >> "$REG/swap.log" ;; esac
  return 0
}

# @ccd-lib:freshpick
_fresh_crossing_end() {   # id — a proven renewal ends a set-side crossing (spec §3.4 C46, "Every renewal clears the crossing marker"). Always 0.
  # Called only after the consuming spawn's receipt proved the fresh start (review 2148 F4; slug crossing-ends-after-the-
  # receipt): a renewal that failed (exit 4), was not restored (5), was not killed (6) or was not proven (7) keeps the
  # operator's crossing, which C46 says holds until the next renewal. Only a set side ends it here, with the tick's own line
  # format. `set-unreadable` or `set-malformed` keeps it (the tick's "an unreadable pin is not deleted"): the tick ends it once
  # the side reads again. A project side's crossing is the tick's, as today.
  local LC_ALL=C IFS=' '
  [[ -e "$REG/$1.crosspool" || -L "$REG/$1.crosspool" ]] || return 0
  [[ "$(_session_pool_side "$1")" == "set "* ]] || return 0
  rm -f -- "$REG/$1.crosspool"
  echo "$(date '+%F %T') crosspool-ended $1: renewal" >> "$REG/swap.log"
  return 0
}
# THE FRESH PICK (spec §3.4 C56 and C57, Table 3.4a; plan w1-ccd-arms Task 6): the account a renewal's fresh start lands on,
# from the ordered list on the route record (`acctorder`), the designation's and the renewal lane's, never ccd's to write.
# The soft line: step 1 and step 2 take an account only while its load (`_limit_score`, the larger window) is UNDER it.
# The fallback class is Table 3.4a's Opus, never `_class_below`: an Opus-designated Overlord never falls back to Sonnet.
FRESH_PICK_SOFT_PCT=70
FRESH_PICK_FALLBACK_CLASS=opus
_fresh_pick_ok() {   # account side -> rc 0 the account may take this session at all; rc 1 and FRESH_PICK_FAIL = the first failed check
  # A roster id (pool set Q9: the list is checked for shape only), enabled, not auth-dead, under the ceiling, served by the
  # session's pool side (`_pool_ok` rc 0: a crossing does not count, since a proven renewal ends it), and an Anthropic lane
  # (slug fresh-pick-anthropic-only-in-w1: C56 admits another provider's lane only if the operator lists it, which nothing
  # records yet, so the piece that records it widens the server's list and this check together). Writes nothing, except
  # `_authdead`'s D-3524 expiry of a stale marker: `_authdead` removes a marker whose lane's credential changed since, as it
  # does for every placement reader, because it is that marker's one owner (review 2336 F1, ruled: accepted, pinned).
  FRESH_PICK_FAIL=unknown; _is_valid_wrapper "$1" || return 1; FRESH_PICK_FAIL=disabled; _account_ok "$1" || return 1
  FRESH_PICK_FAIL=authdead; ! _authdead "$1" || return 1; FRESH_PICK_FAIL='at-ceiling'; _avail "$1" || return 1
  FRESH_PICK_FAIL=pool; _pool_ok "$1" "$2" || return 1; FRESH_PICK_FAIL=backend; _is_anthropic_backend "$1" || return 1; FRESH_PICK_FAIL=''
}
_fresh_pick_field_to() {   # var id field cap -> rc 0 var = the field's bytes, at most cap (a NUL reads as a newline) | 1 no entry
  # | 2 a link, not a regular file, not readable, or the read failed, or `$REG` is not a searchable directory (it cannot say
  # whether an entry stands, so never "no entry": review 2336 F2). Bounded in size and in time (`_plat_timeout 2`), so a
  # FIFO swapped in after the type test cannot block, as `_role_long_lived` reads `profile`; never `_route_get`, whose read is not.
  local LC_ALL=C IFS=' ' f="$REG/$2.$3" v; printf -v "$1" ''
  [[ -d "$REG" && -x "$REG" ]] || return 2; [[ -e "$f" || -L "$f" ]] || return 1; [[ -L "$f" || ! -f "$f" || ! -r "$f" ]] && return 2
  v=$( { _plat_timeout 2 head -c "$4" -- "$f" | tr '\000' '\n'; } 2>/dev/null && printf x) || return 2; printf -v "$1" '%s' "${v%x}"
}
# shellcheck disable=SC2034  # FRESH_PICK_STEP and FRESH_PICK_WHY are the answer, read by the fresh start in PR C2
_fresh_pick_to() {   # var id cur -> rc 0, var = the account to start on, FRESH_PICK_STEP = 1|2|none; rc 1, var empty, FRESH_PICK_WHY = the cause
  # CALLED BY NOTHING YET (PR C1): PR C2 adds step 3 and `stay` and calls it last in the fresh start's re-measure. It
  # WRITES NOTHING, except `_authdead`'s D-3524 expiry of a stale marker (`_fresh_pick_ok`): no other registry field, no
  # stamp, no route row, no log line (the hold-down is read through its decider, `_route_holddown_holds`, which writes
  # nothing either). No `acctorder` entry is today's behaviour: the current account. The C locale makes the load parse
  # byte-wise: a figure in other digits is no load under any caller's locale, and says nothing on stderr.
  # UNDECIDABLE IS A REFUSAL, NEVER A PICK (Review Focus 2): a list that is not a regular readable file, or not one
  # `_acctorder_valid` accepts (read at the cap + 1 bytes, so a longer one fails), a set side that cannot be read or parsed,
  # and a class that cannot be read or is off the route's vocabulary (slug fresh-pick-refuses-an-unreadable-class) each
  # answer rc 1 with the sentence naming the remedy. Step 1 is skipped while a degraded stamp stands and the hold-down holds
  # (rc 0, or 3 for a stamp later than ccd's clock). One pass over the list asks each account's hard filter, its load and
  # the class gate on the class (step 1, returning at once) and on the fallback (step 2, the first kept); an account that
  # passes neither leaves one clause, its first failed check in one word (`_fresh_pick_ok`'s, `load` or `class`). A class of
  # `default` or none has no step 2 and no hold, and its gate still asks `_serviceable` with the id (main's signature,
  # serviceability A's seam), which answers servable unless a set side's account has no continuity record.
  local LC_ALL=C IFS=' ' list side cls fb='' hold='' a s p2='' why='' rc
  printf -v "$1" ''; FRESH_PICK_STEP=none; FRESH_PICK_WHY=''
  _fresh_pick_field_to list "$2" acctorder $((ROUTE_LIST_MAX_BYTES + 1)); rc=$?
  (( rc == 1 )) && { printf -v "$1" '%s' "$3"; return 0; }
  (( rc == 0 )) && _acctorder_valid "$list" || { FRESH_PICK_WHY="the ordered account list on $REG/$2.acctorder cannot be read; the server writes it again at its next sweep"; return 1; }
  side=$(_session_pool_side "$2"); [[ "$side" == set-unreadable || "$side" == set-malformed ]] && { FRESH_PICK_WHY=$(_pool_set_undecidable_why "${side#set-}" "$2"); return 1; }
  _fresh_pick_field_to cls "$2" class 65; rc=$?
  (( rc == 1 )) || { (( rc == 0 )) && _route_valid class "$cls"; } || { FRESH_PICK_WHY="the class on $REG/$2.class cannot be read; the designation writes it again"; return 1; }
  [[ "$cls" == default ]] && cls=''; [[ "$cls" == fable ]] && fb=$FRESH_PICK_FALLBACK_CLASS
  [[ -n "$cls" ]] && [[ -e "$REG/$2.degraded" || -L "$REG/$2.degraded" ]] && { _route_holddown_holds "$2"; (( $? != 1 )) && hold=1; }
  for a in ${list//,/ }; do
    _fresh_pick_ok "$a" "$side" || { why+="; $a $FRESH_PICK_FAIL"; continue; }
    s=$(_limit_score "$a"); [[ "$s" =~ ^[0-9]{1,3}$ ]] && (( 10#$s < FRESH_PICK_SOFT_PCT )) || { why+="; $a load"; continue; }
    [[ -z "$hold" ]] && _class_gate "$a" "$cls" "$2" && { printf -v "$1" '%s' "$a"; FRESH_PICK_STEP=1; return 0; }
    [[ -n "$fb" && -z "$p2" ]] && _class_gate "$a" "$fb" "$2" && { p2=$a; continue; }
    why+="; $a class"
  done
  [[ -n "$p2" ]] && { printf -v "$1" '%s' "$p2"; FRESH_PICK_STEP=2; return 0; }
  FRESH_PICK_WHY="no account on the ordered list can take it: ${why#; }"; return 1
}
