# ccd/lib/pool-set.sh — a session's pool set (the Overlord's W1, spec 2026-11-09 §3.4 C46): the pool rule's session side
# as a set of pool names with a yes or no for accounts in no pool, carried on the session's route record.
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/delegation-lease.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds new code only (the large-file programme's rule: new code goes to its target module); no function of ccd/ccd moved
# here. Its one region, `poolset`, sits in ccd/ccd at the route record's validators (`_route_valid`), where its pointer line is.
# The set's spelling is written once per language: here (`_poolset_parse`) and in `shared/poolset.ts` (`parsePoolSet`), both
# driven by the one spelling table (`server/test/fixtures/poolSetSpelling.ts`).
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/pool-set.sh`)
# by `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_POOLSET_SHA256`, near the foot of ccd/ccd, written at
# install time), read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start
# (`ccd: refused (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.
#
# Every assignment here is a plain one, never `declare`: the loader evaluates this file inside a function, where a top-level
# `declare` would be local to it and lost.

# @ccd-lib:poolset
# THE SET'S BOUNDS (spec §3.4 C46; the plan's "The rule, widened"). A set's one-token spelling, and the Overlord's ordered
# account list (`acctorder`), each at most this many BYTES; `shared/poolset.ts#POOL_SET_SPELLING_MAX_BYTES` is the other
# spelling of the first, held equal by the spelling table.
POOL_SET_SPELLING_MAX_BYTES=1024
ROUTE_LIST_MAX_BYTES=1024
_poolset_parse() {   # spelling -> rc 0 and two lines, `names=<n1> <n2>…` and `untagged=yes|no`; rc 1 and nothing: malformed
  # `shared/poolset.ts#parsePoolSet`'s grammar, the two held equal by the one spelling table: `^(N(,N)*)?(\+untagged)?$`, N a
  # pool name (`POOL_NAME_RE`), non-empty as a whole, the names strictly ascending in byte order (so a repeat or an unsorted
  # list is malformed, and one set has one spelling), at most `POOL_SET_SPELLING_MAX_BYTES` bytes. The empty set has no
  # spelling (open question 3): an empty names list without `+untagged` is malformed. The C locale gives one verdict for any
  # bytes, and the charset test comes first, so a newline, a CR or any byte off the grammar never reaches the split; its
  # own IFS makes the split the space the commas became, whatever the caller set (both pinned, review 2120 F2 and F5).
  local LC_ALL=C IFS=' ' s="$1" u=no n prev="" names=""
  [[ -n "$s" && ${#s} -le $POOL_SET_SPELLING_MAX_BYTES && "$s" =~ ^[a-z0-9,+-]+$ ]] || return 1
  [[ "$s" == *+untagged ]] && { u=yes; s="${s%+untagged}"; }
  [[ "$s" != ,* && "$s" != *, && "$s" != *,,* ]] || return 1
  for n in ${s//,/ }; do
    [[ "$n" =~ $POOL_NAME_RE ]] || return 1
    [[ -z "$prev" || "$prev" < "$n" ]] || return 1
    prev="$n"; names+="${names:+ }$n"
  done
  printf 'names=%s\nuntagged=%s\n' "$names" "$u"
}
_acctorder_valid() {   # list -> 0 iff account ids joined by `,`, none twice, at most `ROUTE_LIST_MAX_BYTES` bytes; else 1
  # SHAPE ONLY, never roster membership (open question 9): an account removed later leaves the record well-formed, and
  # the pick that reads the list skips an id `_is_valid_wrapper` does not know. The id is the fleet's wrapper-name shape,
  # `shared/roster.ts#ACCOUNT_ID_RE`, as `_acct_pool_state` reads it.
  local LC_ALL=C IFS=' ' v="$1" a seen=,
  [[ -n "$v" && ${#v} -le $ROUTE_LIST_MAX_BYTES && "$v" =~ ^[A-Za-z0-9._-]{1,64}(,[A-Za-z0-9._-]{1,64})*$ ]] || return 1
  for a in ${v//,/ }; do [[ "$seen" == *",$a,"* ]] && return 1; seen+="$a,"; done
  return 0
}
_session_pool_side() {   # id [project] -> "set <spelling>" | set-unreadable | set-malformed | _project_pool_state's four words; rc 0
  # THE ONE READER OF A SESSION'S POOL SIDE (C46): the set on its route record when one stands, else its project's tag
  # through `_project_pool_state`, the one reader of that tag. A `poolset` entry that exists is never "no set" (Review
  # Focus 1): a link, a non-regular file or an unreadable one is `set-unreadable` (`_reg_read`'s own tests, without its read,
  # which takes the whole file and drops a NUL), and bytes that are not one spelling are `set-malformed`. The read is bounded
  # at the cap + 1 bytes, so a NUL or a read that hit the cap answers rc 0 and is malformed, and a failed open leaves zero
  # bytes, malformed too. A `$REG` that cannot be searched answers `unreadable` whatever the project argument, an empty one
  # included: it cannot say whether a set stands, so it never answers an empty project's `untagged` (review 2134 F2).
  # The project is the second argument when one is passed (`$# -ge 2`, so an empty project is not "no project"); otherwise
  # it is the row's field, read as `_swap_target` reads it: absent is the empty name, unreadable is `unreadable` unless no
  # project can be tagged (`_pool_untaggable`).
  local LC_ALL=C IFS=' ' f="$REG/$1.poolset" v="" p prc
  [[ -d "$REG" && -x "$REG" ]] || { echo unreadable; return 0; }
  if [[ -e "$f" || -L "$f" ]]; then
    [[ -L "$f" || ! -f "$f" || ! -r "$f" ]] && { echo set-unreadable; return 0; }
    if { IFS= read -r -d '' -n $((POOL_SET_SPELLING_MAX_BYTES + 1)) v; } 2>/dev/null < "$f"; then v=""; fi
    _poolset_parse "$v" >/dev/null && echo "set $v" || echo set-malformed
    return 0
  fi
  (( $# >= 2 )) && { _project_pool_state "$2"; return 0; }
  _reg_read_to p "$1" project; prc=$?
  (( prc == 2 )) && ! _pool_untaggable && { echo unreadable; return 0; }
  _project_pool_state "$p"
}
_pool_ok_set() {   # account-id side-word -> 0 serve | 1 mismatch | 2 undecidable; sets POOL_OK_SIDE/POOL_OK_STATE, so call it bare
  # `_pool_ok`'s set case, the rule's one membership test for a set (Review Focus 3; `shared/poolrule.ts#poolRule`'s set arm,
  # the two driven by one table). A bad set is undecidable on the set side before the account side is read, so an untagged
  # account never serves past it: `set-unreadable`, `set-malformed`, a spelling that does not parse (a caller's word, never
  # `_session_pool_side`'s), and a set word this build does not know, which names the set side too, never the project's
  # tag file (A1 review N5). Then the account side as `_pool_ok` reads it: undecidable there, an untagged account serves
  # iff the set says `+untagged`, and `named p` serves iff p is a pool name and one of the set's names (a "name" that spans
  # two adjacent names, `pool-a pool-b`, is no pool name: review 2134 F4).
  local LC_ALL=C IFS=' ' ap parsed names
  POOL_OK_SIDE='set'; POOL_OK_STATE=unrecognised
  [[ "$2" == set-unreadable || "$2" == set-malformed ]] && { POOL_OK_STATE=${2#set-}; return 2; }
  [[ "$2" == "set "* ]] || return 2
  POOL_OK_STATE=malformed; parsed=$(_poolset_parse "${2#set }") || return 2
  names=${parsed%%$'\n'*}; names=${names#names=}
  ap=$(_acct_pool_state "$1"); POOL_OK_SIDE=account; POOL_OK_STATE="$ap"
  case "$ap" in
    untagged)  [[ "$parsed" == *$'\n'untagged=yes ]] && return 0; return 1 ;;
    "named "*) _pool_name_valid "${ap#named }" && [[ " $names " == *" ${ap#named } "* ]] && return 0; return 1 ;;
    *)         return 2 ;;
  esac
}
_pool_set_undecidable_why() {   # state id -> the rc-2 sentence for the set side (`_pool_undecidable_why`'s set arm)
  echo "the pool set for session $2 is $1: $REG/$2.poolset — the server writes it again at its next sweep, or the operator saves the set again in Settings; the project's tag is not involved"
}
_pool_set_mismatch_why() {   # account-id account-state spelling -> the rc-1 clause for a set (`_pool_mismatch_why`'s set arm)
  [[ "$2" == untagged ]] && { echo "$1 is in no pool and the session's pool set '$3' does not admit untagged accounts"; return 0; }
  echo "$1 is in pool '${2#named }' (measured from the projection, $REG/pool-epoch) and that pool is not in the session's pool set '$3'"
}
# ── THE USERS KEYED BY A SESSION (PR A3: Table 3.4d, the plan's Tasks 4 and 5) ───────────────────────────────────────
# Every ccd user of the pool decision keyed by a session reads `_session_pool_side`, and these helpers give a side word
# its token, its crossing field, its undecided word and its sentences. None decides membership: that is `_pool_ok`'s.
_pool_side_is_set() { local LC_ALL=C IFS=' '; [[ "$1" == "set "* || "$1" == set-unreadable || "$1" == set-malformed ]]; }   # side word -> 0 iff a set side
_pool_set_sid() { _pool_side_is_set "$1" && printf '%s' "$2"; return 0; }   # side id -> the id iff a set side (`_pool_undecidable_why`'s fifth)
_pool_side_token() {   # side word -> one log token, which is also the crossing marker's pool field: `<n>`, `set:<spelling>`, else the word
  # A set side never prints as a pool name ("set pool-b"), and a named side prints exactly what it printed before A3.
  local LC_ALL=C IFS=' '
  case "$1" in "named "*) printf '%s\n' "${1#named }" ;; "set "*) printf 'set:%s\n' "${1#set }" ;; *) printf '%s\n' "$1" ;; esac
}
_pool_cross_match() {   # side-word marker-field -> 0 iff a crossing marker's pool field names this decided side
  # A `set:` field holds only while the side reads that same spelling, so a crossing lapses when the set changes and not
  # when the operator only reorders it (the spelling is sorted). A named field holds only while the project reads it.
  # The field is the marker file's bytes, so the comparison runs in the C locale, as every reader of a set does.
  local LC_ALL=C IFS=' '
  [[ "$1" == "named "* && "$2" == "${1#named }" ]] || [[ "$1" == "set "* && "$2" == "set:${1#set }" ]]
}
_pool_cross_lapse_why() {   # decided side word -> `crosspool-ended`'s reason when the side no longer matches the marker
  if [[ "$1" == "set "* ]]; then echo "account set is now ${1#set }"; else echo "project pool is now $1"; fi
}
_pool_undecided_rc() {   # POOL_OK_SIDE -> `_swap_target`'s undecided rc: 4 the project, 7 the account (projection), 8 the set
  case "$1" in account) return 7 ;; set) return 8 ;; *) return 4 ;; esac
}
_pool_undecided_word() {   # `_swap_target`'s rc, or POOL_OK_SIDE -> the `_undecidable_cause` word for that side
  case "$1" in 7|account) echo projection ;; 8|set) echo set ;; *) echo pool ;; esac
}
_pool_undecidable_cause() {   # word id -> `_undecidable_cause`'s sentence for `projection` or `set`
  # `projection` is every session's, not only a set session's (slug `projection-word-fleet-wide`): an undecidable account
  # side names the projection and its remedy, never the project's tag. A set session's says the set decided (A2 F1).
  if [[ "$1" == set ]]; then
    printf '%s' "the account set on the route record could not be read or parsed ($REG/$2.poolset), so no destination could be computed; the server writes it again at its next sweep, or the operator saves the set again"
    return 0
  fi
  local tail="not the project tag"; _pool_side_is_set "$(_session_pool_side "$2")" && tail="the session pool set decided, and the project tag is not involved"
  printf '%s' "the pool projection could not be read ($REG/pool-epoch), so no destination could be computed; the remedy is the pool sync and the control-plane link, $tail"
}
_pool_set_start_warn() {   # id wrapper prc side state project pps -> `cmd_start`'s warning for an existing row its set does not serve
  # An existing row is never refused (slug `existing-row-warns-the-tick-relocates`): a mismatch warns, and the tick moves it
  # back at its next idle boundary; an undecidable set warns too, naming the file, where a project-side rc 2 is silent.
  if (( $3 == 1 )); then echo "ccd: warn: $1 lives on $2: $(_pool_mismatch_why "$2" "$5" "$6" "$7") — the auto-swapper relocates it at the next idle boundary"
  else echo "ccd: warn: $1 lives on $2 and its pool could not be decided: $(_pool_undecidable_why "$4" "$5" "$6" "$2" "$1") — nothing moves until it can"; fi
}
