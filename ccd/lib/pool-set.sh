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
