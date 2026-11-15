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
