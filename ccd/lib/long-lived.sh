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
  # it did not write is the operator's opt-out: kept, and said (`kept <marker>: not keep-awake's`). `on` creates over an
  # absent entry with a no-clobber create (`set -C`, O_EXCL: `_dispatch_swap`'s claim file is the precedent), so a hand
  # marker made between the check and the write is never overwritten. A marker `off` cannot read (a link, not a regular
  # file, not readable, or the bounded read timed out) is kept, and the verb exits 1. CHECKED on both arms, for
  # `cmd_coord_pause`'s reason: no `-e`, so an unchecked write would fall through to the echo. Nothing parses the echo.
  # Each marker's create is one spelled line, so the single-definition scan sees each write (ask-digest.test.ts, D-5242).
  local LC_ALL=C IFS=' ' id="${2-}" state="${4-}" m f rc=0
  [[ $# -eq 4 && "$1" == --session && "$3" == --state && ( "$state" == on || "$state" == off ) ]] \
    || die "usage: ccd keep-awake --session <id> --state on|off"
  _reg_id_ok "$id" || die "bad session id"
  [[ "$state" == off || -f "$REG/$id.uuid" ]] || die "no such session: $id"
  for m in no-hibernate no-roll; do
    f="$REG/$id.$m"; _keep_awake_ours "$id" "$m"
    case "$state $KEEP_AWAKE_READ" in
      "off ours") rm -f -- "$f" && [[ ! -e "$f" && ! -L "$f" ]] && continue; die "could not remove $f — the marker still stands" ;;
      "on absent")
        if [[ "$m" == no-hibernate ]]; then ( set -C; printf '%s' "$KEEP_AWAKE_STAMP" > "$REG/$id.no-hibernate" ) 2>/dev/null
        else ( set -C; printf '%s' "$KEEP_AWAKE_STAMP" > "$REG/$id.no-roll" ) 2>/dev/null; fi && continue
        [[ -e "$f" || -L "$f" ]] || die "could not write $f — the session is NOT kept awake" ;;
      "on ours"|"off absent") continue ;;
      "off unreadable") rc=1 ;;
    esac
    printf 'kept %s: not keep-awake'"'"'s\n' "$m"
  done
  if [[ "$state" == on ]]; then echo "awake $id"; else echo "released $id"; fi
  return "$rc"
}
_keep_awake_ours() {   # id marker -> rc 0 iff $REG/<id>.<marker> is a regular, readable file, not a link, holding exactly the
  # stamp; rc 1 otherwise, never rc 2 (every caller but `off` treats "not provably ours" one way). It sets KEEP_AWAKE_READ
  # to one of four words, so `off` alone tells a foreign marker from one it cannot read: `ours`, `absent` (no entry, -e and
  # -L both false), `foreign` (readable, other bytes) or `unreadable`. The read is bounded twice: in size (65 bytes, so a
  # longer file or a NUL, turned into a newline, is not the stamp) and in time (`_plat_timeout 2`, so a FIFO swapped in
  # between the -f test and the open cannot block). C locale: the same bytes give one verdict under any caller's locale.
  local LC_ALL=C IFS=' ' f="$REG/$1.$2" v
  KEEP_AWAKE_READ=absent; [[ -e "$f" || -L "$f" ]] || return 1
  KEEP_AWAKE_READ=unreadable; [[ -L "$f" || ! -f "$f" || ! -r "$f" ]] && return 1
  v=$( { _plat_timeout 2 head -c 65 -- "$f" | tr '\000' '\n'; } 2>/dev/null && printf x) || return 1
  KEEP_AWAKE_READ=foreign; [[ "${v%x}" == "$KEEP_AWAKE_STAMP" ]] || return 1
  KEEP_AWAKE_READ=ours
}
