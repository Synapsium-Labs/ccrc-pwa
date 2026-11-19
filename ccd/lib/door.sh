# ccd/lib/door.sh — the Overlord's door process, ccd's side (spec 2026-11-09 §3.6 H1 "The door process (H9)", §3.3.11 H12
# "The fence"; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md). Region `door` holds the program's pin
# check and the purge of the door process's registry directory, `$REG/.door/<id>/`; region `doorspawn` (PR A2) the spawn step
# that writes its tool-server config, called by `_profile_spawn_compose` for a surfaced row.
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after
# ccd/lib/long-lived.sh and after every other function and variable of ccd is defined, and these functions call those.
# It holds new code only (the large-file programme's rule: new code goes to its target module); no function of ccd/ccd moved
# here. Its pointer lines sit in ccd/ccd beside each region's one caller: `# @ccd-lib:door` beside `_reg_purge`, and
# `# @ccd-lib:doorspawn` beside `_profile_spawn_compose`.
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

# @ccd-lib:doorspawn
# THE SPAWN STEP (PR A2, Task 4; plan question 1, slug claude-code-starts-the-door-process): Claude Code starts the door process
# as its stdio tool server, from the `--mcp-config` file it is launched with, so ccd writes a fresh config with a fresh launch nonce
# at every surfaced spawn and the pane's command names only that file and the nonce's sha256. The nonce reaches jq through jq's
# own environment (`$ENV`), never an argv, and is written to `$REG/.door/<id>/mcp.json` (0600, its directories 0700) and nowhere
# else; the hash is taken over the nonce's 64-character hex TEXT, with no newline, as the claim door hashes it (A1's note F3).
_door_spawn() {   # id -> 0 with --mcp-config on PROFILE_SPAWN_FLAGS and CCRC_DOOR_NONCE_SHA256 on PROFILE_SPAWN_ENV; else 1 and DOOR_SPAWN_WHY
  local LC_ALL=C IFS=' ' id="${1-}" self="${BASH_SOURCE[0]}" dir=. prog nodebin nonce sum d f
  DOOR_SPAWN_WHY="the session id is not a registry id"
  _reg_id_ok "$id" && [[ "$id" != . && "$id" != .. ]] || return 1
  [[ "$self" == */* ]] && dir="${self%/*}"
  [[ "$dir" == /* ]] || dir="$PWD/$dir"
  prog="$dir/door-process.mjs" d="$REG/$DOOR_REG_DIR" f="$REG/$DOOR_REG_DIR/$id/mcp.json"
  DOOR_SPAWN_WHY="the door program is missing, linked or not the pinned one"; _door_prog_ok "$prog" || return 1
  DOOR_SPAWN_WHY="no node on PATH"; nodebin=$(command -v node 2>/dev/null) && [[ "$nodebin" == /* ]] || return 1
  DOOR_SPAWN_WHY="a door path holds a quote"; [[ "$f$prog$nodebin" != *"'"* ]] || return 1
  DOOR_SPAWN_WHY="no launch nonce could be read"
  nonce=$(_plat_timeout 5 od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n') && [[ "$nonce" =~ ^[0-9a-f]{64}$ ]] || return 1
  sum=$(printf '%s' "$nonce" | _plat_sha256 2>/dev/null) && sum="${sum%% *}" && [[ "$sum" =~ ^[0-9a-f]{64}$ ]] || return 1
  DOOR_SPAWN_WHY="the door directory is a link"; [[ ! -L "$d" && ! -L "$d/$id" ]] || return 1
  DOOR_SPAWN_WHY="the door directory could not be made"
  ( umask 077; mkdir -p "$d/$id" ) 2>/dev/null && [[ ! -L "$d" && ! -L "$d/$id" ]] && chmod 700 "$d" "$d/$id" 2>/dev/null || return 1
  DOOR_SPAWN_WHY="the tool-server config could not be written"; rm -f -- "$f.tmp" 2>/dev/null
  if ! ( umask 077; set -C; CCRC_DOOR_NONCE="$nonce" jq -n --arg node "$nodebin" --arg prog "$prog" --arg id "$id" --arg dir "$d/$id" \
    --arg api "$HOME/.local/bin/ccrc-api" '{mcpServers:{door:{type:"stdio",command:$node,args:[$prog],env:{CCRC_DOOR_NONCE:$ENV.CCRC_DOOR_NONCE,
      CCRC_SESSION_ID:$id,CCRC_DOOR_DIR:$dir,CCRC_API:$api}}}}' > "$f.tmp" && mv -f -- "$f.tmp" "$f" ) 2>/dev/null; then
    rm -f -- "$f.tmp" 2>/dev/null; return 1
  fi
  PROFILE_SPAWN_FLAGS="${PROFILE_SPAWN_FLAGS:+$PROFILE_SPAWN_FLAGS }--mcp-config '$f'"
  PROFILE_SPAWN_ENV="${PROFILE_SPAWN_ENV:+$PROFILE_SPAWN_ENV }CCRC_DOOR_NONCE_SHA256=$sum"
  DOOR_SPAWN_WHY=""
}
