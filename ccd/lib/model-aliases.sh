# ccd/lib/model-aliases.sh — the model-class Anthropic arm's ccd side (plan docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md,
# wave A3; spec docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md §2.5): one cached reader of a lane's aliases and
# advance files, the launch marker, the effort-level rule from data, a held id at launch and the routing record's model id. Region
# `aliases` holds them.
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/door.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds new code only (the large-file programme's rule: new code goes to its target module); no function of ccd/ccd moved here.
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/model-aliases.sh`) by
# `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_ALIASES_SHA256`, near the foot of ccd/ccd, written at install time),
# read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start (`ccd: refused
# (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.
#
# Every assignment here is a plain one, never `declare`: the loader evaluates this file inside a function, where a top-level
# `declare` would be local to it and lost.

# @ccd-lib:aliases
_model_id_bare_to() {   # var raw -> var = raw with ONE trailing `[1m]` removed (Claude Code's mark of a 1M-context session), by parameter expansion, no fork; rc 0
  local __mib_raw="${2-}"
  printf -v "$1" '%s' "${__mib_raw%\[1m\]}"
  return 0
}
