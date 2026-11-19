# ccd/lib/door.sh — the Overlord's door process, ccd's side (spec 2026-11-09 §3.6 H1 "The door process (H9)", §3.3.11 H12
# "The fence"; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md). Region `door` holds the program's pin
# check and the purge of the door process's registry directory, `$REG/.door/<id>/`; the spawn step that writes its tool-server
# config is a later region (PR A2).
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/long-lived.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds new code only (the large-file programme's rule: new code goes to its target module); no function of ccd/ccd moved
# here. Its pointer line, `# @ccd-lib:door`, sits in ccd/ccd beside `_reg_purge`, its one caller.
#
# THE TRUST CHAIN is ccd/lib/disk-retention.sh's: installed beside ccd's body (`~/.local/libexec/ccrc/lib/door.sh`) by
# `ccd/ccd-entry-install.py`, pinned by the body (`__CCD_LIB_DOOR_SHA256`, near the foot of ccd/ccd, written at install time),
# read once, hashed and evaluated from the same bytes; a missing, linked or changed file refuses the start (`ccd: refused
# (lib-...)`, status 125) before any verb runs. The file ends in exactly one newline and holds no NUL byte.
#
# THE DIRECTORY HOLDS SECRETS (ruled, F1 and F4): `mcp.json` carries the launch nonce. `~/.cc-sessions/.door/**` is in
# `ACCOUNT_SECRET_PATHS` and `ACCOUNT_WRITE_DIRS` (shared/api.ts), so no session's tool reads or writes it; nothing here prints
# a file's contents. Zero new ccd verbs: these are internal functions of the spawn and purge paths.
#
# Every assignment here is a plain one, never `declare`: the loader evaluates this file inside a function, where a top-level
# `declare` would be local to it and lost.

# @ccd-lib:door
# The door process's registry directory, under `$REG`: one directory per session, `$REG/.door/<id>/`, dot-led so the
# registry's per-field globs (`$REG/<id>.*`) never see it.
DOOR_REG_DIR=.door
_door_prog_ok() {   # path -> 0 iff the door program at path is a readable regular file, not a link, and (installed) its SHA-256 is the pin
  # The pin is `__CCD_DOOR_SHA256` (ccd/ccd, rendered at install time, as the redactor's are). A SOURCE CHECKOUT (the loader's
  # published `__CCD_LAYOUT`) skips the digest, as `_docs_front` does for the redactor: nothing was installed to pin. An
  # installed body whose pin is still the placeholder refuses: the program was never installed with it. The file is read by a
  # `cat` under `_plat_timeout`, so a file swapped for a FIFO after the check cannot hold the spawn, and its bytes are piped into
  # the hashing command the loader chose (`__CCD_HASH_CMD`, the `_plat_sha256` shim or a fixed tool path), so no tool is named
  # here. A read cut short hashes short, or fails the pipe (`pipefail`), and either refuses.
  local LC_ALL=C IFS=' ' p="${1-}" sum
  local -a h
  h=("${__CCD_HASH_CMD[@]}")   # a copy, so the loader's one writer of __CCD_HASH_CMD stays _ccd_lib_load (ccd-lib-load.test.ts)
  [[ -n "$p" && ! -L "$p" && -f "$p" && -r "$p" ]] || return 1
  [[ $__CCD_LAYOUT == source ]] && return 0
  [[ "${__CCD_DOOR_SHA256-}" =~ ^[0-9a-f]{64}$ ]] || return 1
  (( ${#h[@]} > 0 )) || return 1
  sum=$(_plat_timeout 5 cat -- "$p" 2>/dev/null | "${h[@]}" 2>/dev/null) || return 1
  [[ "${sum%% *}" == "$__CCD_DOOR_SHA256" ]]
}
_door_purge() {   # id -> remove $REG/.door/<id>/'s four named files and the directory once empty; rc as _reg_purge's unlinks
  # Called by `_reg_purge` alone. The id is checked here (`_reg_id_ok`), never trusted from the caller; a linked `$REG/.door` or
  # `$REG/.door/<id>` is refused and recorded
  # (nothing removed through a link). Only the four LITERAL names go: the tool-server config and the
  # delta cache, each with its temp file; a file planted beside them stays, and so does the directory then. Each unlink that
  # fails is recorded through `_reg_purge_unremoved`, as `_reg_purge`'s own are. A door process still running can write `delta`
  # again after this (it holds no row lock) until its session's stdin closes: the next spawn's purge or write replaces it.
  local LC_ALL=C IFS=' ' id="${1-}" d f
  # `_reg_id_ok` admits `.` and `..`, which would name `$REG/.door` or `$REG` itself: refused here (slug door-purge-refuses-dot-ids).
  _reg_id_ok "$id" && [[ "$id" != . && "$id" != .. ]] || return 1
  d="$REG/$DOOR_REG_DIR/$id"
  if [[ -L "$REG/$DOOR_REG_DIR" || -L "$d" ]]; then _reg_purge_unremoved "$d"; return 1; fi
  [[ -d "$d" ]] || return 0
  for f in "$d/mcp.json" "$d/mcp.json.tmp" "$d/delta" "$d/delta.tmp"; do
    [[ -e "$f" || -L "$f" ]] || continue
    rm -f "$f" || _reg_purge_unremoved "$f"
  done
  rmdir "$d" 2>/dev/null || :
  return 0
}
