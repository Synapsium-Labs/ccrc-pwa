# ccd/lib/disk-retention.sh — the fleet disk-retention code that used to sit inside ccd/ccd (GitHub #1279; D-6913).
#
# NOT AN EXECUTABLE and not sourceable on its own: ccd/ccd loads it at the foot of its own file (`_ccd_lib_load`), after every
# other function and variable of ccd is defined, and these functions call those. It holds, in the order ccd had them:
#   1. the orphan census, the fourteen-rung ladder and the ws-orphan verb (DR-16, D-6628; DR-17, D-6629; DR-22, D-6634);
#   2. NESTED-RESCUE-V1 and the scratch-rescue verb (DR-20, D-6632);
#   3. the stale arm of the reclaim (DR-26, D-6638);
#   4. the loose arm of ws-collect (DR-13, D-6625), LOOSE-BEGIN .. LOOSE-END.
# It is a MOVE and nothing else: not one function body changed on the way, and every test that exercised a region still does.
#
# THE TRUST CHAIN. This file is installed beside ccd's body (`~/.local/libexec/ccrc/lib/disk-retention.sh`, by the same
# program that installs the body and the launcher, `ccd/ccd-entry-install.py`). The launcher pins the BODY's SHA-256; the
# body pins THIS file's (`__CCD_LIB_SHA256`, near the foot of ccd/ccd), reads the file once into a variable, hashes that
# variable, and evaluates that same variable, so the bytes checked are the bytes run. A missing, linked or changed file
# refuses the start (`ccd: refused (lib-...)`, status 125) before any verb runs. The path is the body's own directory, taken
# from `BASH_SOURCE`; no environment variable and no argument names it. The pin is written at install time, never committed
# (ccd/ccd-entry-install.py renders this file's digest into the installed body, then stamps it), so editing this file needs
# no restamp. The file ends in exactly one newline and holds no NUL byte.

# @ccd-lib:orphan
# ── orphan trees: the census, and the ONE ladder (DR-16, D-6628, fleet-disk-retention spec §2.3) ──
# READ-ONLY. `ws-audit --orphans` lists every linked worktree no registry row names, by location class; `ws-audit
# --orphan-hex <hex>` answers the first refusal of the fourteen-rung ladder, or a token the server's act re-proves. The
# rungs the operator's `ws-gc --prune` shares (dirty, HEAD, nested checkouts) are `_ws_orphan_rung`, called by both, so the
# verb and the lane cannot drift. Nothing here removes, moves or writes anything.
WS_ORPHAN_FLOOR_S=604800        # 7 days: the newest ctime under the tree must be older (spec §2.3 rung 13)
WS_ORPHAN_FLOOR_PRESSURE_S=259200   # 3 days under `_disk_pressure` (spec §2.5.3); inert until that function exists on this ccd
WS_ORPHAN_CENSUS_ROWS=4096; WS_ORPHAN_CENSUS_S=60
_WS_ORPHAN_WORD=''; _WS_ORPHAN_WHY=''; _WS_ORPHAN_BRANCH=''; _WS_ORPHAN_HEAD=''; _WS_ORPHAN_VERDICT=''
_WS_ORPHAN_CLASS=''; _WS_ORPHAN_MAIN=''; _WS_ORPHAN_TOKEN=''; _WS_ORPHAN_RESCUE=''
_WS_ORPHAN_NEWEST=''; _WS_ORPHAN_ENTRIES=''; _WS_ORPHAN_FLOOR=''; _WS_ORPHAN_TREE=''

_ws_orphan_hex() { LC_ALL=C od -An -v -tx1 | tr -d ' \n'; }   # stdin -> lowercase hex
_ws_orphan_unhex() {   # hex -> the path on stdout; rc 1 when it is not an even run of hex, or holds a NUL or a newline
  [[ "${1-}" =~ ^[0-9a-f]+$ ]] && (( ${#1} % 2 == 0 && ${#1} <= 8192 )) || return 1
  python3 -c 'import sys
b = bytes.fromhex(sys.argv[1])
sys.exit(1) if (b"\0" in b or b"\n" in b) else sys.stdout.buffer.write(b)' "$1"
}

_ws_orphan_stanzas() {   # main -> one line per worktree git lists: path<TAB>head<TAB>branch|detached<TAB>locked<TAB>prunable<TAB>ismain
  local line wt='' hd='' br=detached lk=0 pr=0 n=0
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }"; hd=''; br=detached; lk=0; pr=0 ;;
      "HEAD "*)     hd="${line#HEAD }" ;;
      "branch "*)   br="${line#branch refs/heads/}" ;;
      locked*)      lk=1 ;;
      prunable*)    pr=1 ;;
      "")           [[ -n "$wt" ]] || continue
                    # a quoted path (git C-quotes a newline) or one with a tab cannot ride a hex field: left unlisted, so it is never removed
                    [[ "$wt" != \"* && "$wt" != *$'\t'* ]] && printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$wt" "$hd" "$br" "$lk" "$pr" "$(( n == 0 ))"
                    n=$(( n + 1 )); wt='' ;;
    esac
  done < <(git -C "$1" worktree list --porcelain 2>/dev/null; echo)
}

_ws_orphan_class() {   # tree mainreal wsroot project [checkouts] -> echoes ccd-root | claude | superpowers | other (LOCATION only)
  #   `checkouts` (DR-22, G4): every checkout of the repository, one per line; a `.claude`/`.superpowers` directory of ANY of them counts
  local t="$1" m="$2" w="$3" pj="$4" rel k x
  rel="${t#$w/$pj/}";            [[ "$t" == "$w/$pj/"* && -n "$rel" && "$rel" != */* ]] && { echo ccd-root; return 0; }
  for k in claude superpowers; do
    [[ "$t" == */."$k"/worktrees/* && "${t##*/."$k"/worktrees/}" != */* && -n "${t##*/."$k"/worktrees/}" ]] || continue
    x="${t%/."$k"/worktrees/*}"
    [[ "$x" == "$m" || $'\n'"${5-}"$'\n' == *$'\n'"$x"$'\n'* ]] && { echo "$k"; return 0; }
  done
  echo other
}
_ws_orphan_inside() {   # tree -> the id of the registry row whose workdir CONTAINS the tree (the nearest), '' when none (DR-22, G4)
  local f id wd q best='' bl=0
  for f in "$REG"/*.workdir; do
    [[ -f "$f" && ! -L "$f" && -r "$f" ]] || continue
    id=$(basename "$f" .workdir); wd=$(<"$f"); [[ -n "$wd" ]] || continue
    q="$wd"; [[ -d "$wd" ]] && _ws_dir_physical "$wd" && q="$_WS_PHYS"
    if [[ "$1" == "$wd"/* || "$1" == "$q"/* ]] && (( ${#q} > bl )); then best="$id"; bl=${#q}; fi
  done
  printf '%s' "$best"
}

_ws_orphan_rung() {   # dirty|head|secrets|nested path -> 0 passes; 1 refuses (_WS_ORPHAN_WORD, _WS_ORPHAN_WHY); 2 unmeasured
  local r="$1" p="$2" n
  _WS_ORPHAN_WORD=''; _WS_ORPHAN_WHY=''
  case "$r" in
    dirty)   # `ws-gc --prune`'s own first gate, one definition
      if _ws_gc_dirty "$p"; then _WS_ORPHAN_WORD="$GC_DIRTY_STATE"; _WS_ORPHAN_WHY="${GC_DIRTY_WHY}"; return 1; fi ;;
    head)
      _WS_ORPHAN_BRANCH=$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null) || _WS_ORPHAN_BRANCH=''
      _WS_ORPHAN_HEAD=$(git -C "$p" rev-parse --verify --quiet HEAD 2>/dev/null) || _WS_ORPHAN_HEAD=''
      [[ -n "$_WS_ORPHAN_BRANCH" && "$_WS_ORPHAN_HEAD" =~ ^[0-9a-f]{40,64}$ ]] \
        || { _WS_ORPHAN_WORD=head-unreadable; _WS_ORPHAN_WHY="HEAD of $p could not be read"; return 1; } ;;
    secrets)   # the same ignored-set rule `ws-gc --prune` asks, output discarded: the word is the answer here
      _ws_gc_reclaimable "$p" >/dev/null && return 0
      if (( ${#REAP_SENSITIVE[@]} != 0 )); then _WS_ORPHAN_WORD=secrets-ignored; _WS_ORPHAN_WHY="$p holds ${#REAP_SENSITIVE[@]} secret-shaped ignored file(s)"; return 1; fi
      _WS_ORPHAN_WORD=unmeasured; _WS_ORPHAN_WHY="the ignored set of $p could not be read${REAP_IGNREASON:+: $REAP_IGNREASON}"; return 2 ;;
    nested)
      if ! n=$(_ws_nested_checkouts "$p"); then
        _WS_ORPHAN_WORD=unmeasured; _WS_ORPHAN_WHY="$p could not be scanned for nested checkouts${_WS_NESTED_WHY:+ ($_WS_NESTED_WHY)}"; return 2
      fi
      if [[ -n "$n" ]]; then _WS_ORPHAN_WORD=nested-checkout; _WS_ORPHAN_WHY="$p holds nested checkouts"; _WS_ORPHAN_NESTED="$n"; return 1; fi ;;
  esac
  return 0
}

_ws_orphan_refuse() {   # word why -> rc 1, the ladder's answer
  _WS_ORPHAN_WORD="$1"; _WS_ORPHAN_WHY="$2"
  if [[ "$1" == unmeasured ]]; then _WS_ORPHAN_VERDICT=unmeasured; else _WS_ORPHAN_VERDICT=refused; fi
  return 1
}

_ws_orphan_registered() {   # tree sp class project slug -> 0 no registry row names it; 1 one does (_WS_ORPHAN_WHY); 2 unmeasured
  local p="$1" sp="$2" cls="$3" pj="$4" slug="$5" f id wd q hit
  _WS_ORPHAN_WHY=''
  if [[ "$cls" == ccd-root && -f "$REG/$pj-$slug.uuid" ]]; then _WS_ORPHAN_WHY="registry row $pj-$slug names this slug"; return 1; fi
  for f in "$REG"/*.workdir; do   # every row that names a workdir, workspace or plain session alike
    [[ -e "$f" || -L "$f" ]] || continue
    id=$(basename "$f" .workdir)
    [[ -f "$f" && ! -L "$f" && -r "$f" ]] || { _WS_ORPHAN_WHY="the workdir field of registry row $id is not a readable regular file"; return 2; }   # read in place, as `_ws_gc_manifest_bytes` does: a call into the registry's reader would be one more cross-context reference
    wd=$(<"$REG/$id.workdir"); [[ -n "$wd" ]] || continue
    hit=0
    for q in "$p" "$sp"; do [[ "$wd" == "$q" || "$wd" == "$q"/* ]] && hit=1; done
    if (( ! hit )) && [[ -d "$wd" ]]; then   # through a link or an alias: the directory the row names, and every ancestor, by identity
      _ws_dir_physical "$wd" || { _WS_ORPHAN_WHY="the workdir of $id could not be resolved ($_WS_PHYS_WHY)"; return 2; }
      q="$_WS_PHYS"
      while :; do
        [[ "$q" -ef "$sp" ]] && { hit=1; break; }
        [[ "$q" == / || -z "$q" ]] && break
        q="${q%/*}"; [[ -n "$q" ]] || q=/
      done
    fi
    (( ! hit )) || { _WS_ORPHAN_WHY="registry row $id has its workdir at, inside or through this tree"; return 1; }
  done
  return 0
}

_ws_orphan_holders() {   # tree sp -> rung 12: 0 nobody holds it; 1 with _ws_orphan_refuse's in-use or unmeasured word
  local p="$1" sp="$2" rc=0 i
  local -a say=("$p")
  [[ "$sp" == "$p" ]] || say+=("$sp")
  _ws_path_users_many "${say[@]}"
  for i in "${!say[@]}"; do
    case "${_WS_PATH_USERS_RCS[i]}" in
      0) : ;;
      1) _ws_orphan_refuse in-use "${_WS_PATH_USERS_WHY_OF[i]}"; return 1 ;;
      *) _ws_orphan_refuse unmeasured "${_WS_PATH_USERS_WHY_OF[i]:-who uses ${say[i]} was never asked}"; return 1 ;;
    esac
  done
  _ws_cwd_users "$sp"; rc=$?
  case "$rc" in
    0) : ;;
    1) _ws_orphan_refuse in-use "$_WS_CWD_USERS_WHY"; return 1 ;;
    *) _ws_orphan_refuse unmeasured "$_WS_CWD_USERS_WHY"; return 1 ;;
  esac
  return 0
}

_ws_orphan_nested_ok() {   # tree -> 0 when the marker is live and EVERY nested checkout can be pinned or rescued whole; sets
  #   _WS_ORPHAN_NLIST (kind<TAB>path per line, kind same|foreign) and _WS_ORPHAN_NBIND (the token's nestedRescue= inputs); 1 keeps the tree
  local pr mr c cc rel kind b nl=''
  _WS_ORPHAN_NLIST=''; _WS_ORPHAN_NBIND=()
  _ws_nested_rescue_live || return 1
  pr=$(cd "$1" >/dev/null 2>&1 && pwd -P) && mr=$(_ws_common_dir "$1") || return 1
  while IFS= read -r c; do
    [[ -n "$c" ]] || continue
    [[ "$c" == "$pr"/* && "${c##*/}" =~ ^[A-Za-z0-9._-]+$ ]] || return 1   # _ws_leaf_remove takes one id-shaped leaf name; any other keeps the tree
    rel="${c#"$pr"/}"; cc=$(_ws_common_dir "$c") || return 1
    [[ -z "$(git -C "$1" ls-files -s -- "$rel" 2>/dev/null)" ]] || return 1   # the outer tree tracks this path (a gitlink): git worktree remove would refuse once it is gone
    _ws_leaf_checkouts "$c" || return 1   # the removal's own predicate (a submodule's .git file with no back-link), so the audit and the act agree
    REAP_SENSITIVE=(); RECLAIM_SECRETS=(); _ws_nested_secrets "$c" "$rel"; (( ${#REAP_SENSITIVE[@]} == 0 )) || return 1   # a secret-shaped file is never carried, so the checkout stays
    if [[ "$cc" == "$mr" ]]; then
      kind=same
      _ws_reclaim_gitdir_own "$c" "$mr" && [[ ! -e "$_WS_GITDIR_DIR/locked" ]] && git -C "$c" rev-parse --verify --quiet "HEAD^{commit}" >/dev/null 2>&1 && ! _ws_nested_busy "$c" || return 1
    else kind=foreign; _ws_nested_rescue_shape "$c" || return 1; fi
    b=$(_ws_nested_bind "$c" "$rel") || return 1
    nl+="$kind"$'\t'"$c"$'\n'; _WS_ORPHAN_NBIND+=("$b")
  done <<< "$_WS_ORPHAN_NESTED"
  _WS_ORPHAN_NLIST="$nl"
}

_ws_orphan_tail() {   # tree sp -> rungs 10 to 14, in order; 0 all pass, else _ws_orphan_refuse's word and rc 1
  local p="$1" sp="$2" now secs floor="$WS_ORPHAN_FLOOR_S"
  _ws_orphan_rung secrets "$p" || { _ws_orphan_refuse "$_WS_ORPHAN_WORD" "$_WS_ORPHAN_WHY"; return 1; }
  _ws_orphan_rung nested "$p"  || {   # DR-22 (contained: a foreign repo's fsmonitor and hooks never run in the audit): under the marker a rescuable nested checkout is a RESCUE arm (like rung 9), not a stop
    if [[ "$_WS_ORPHAN_WORD" == nested-checkout ]] && _ws_reclaim_contained _ws_orphan_nested_ok "$p"; then _WS_ORPHAN_R11=1; _WS_ORPHAN_R11WHY="$_WS_ORPHAN_WHY"
    else _ws_orphan_refuse "$_WS_ORPHAN_WORD" "$_WS_ORPHAN_WHY"; return 1; fi; }
  _ws_orphan_holders "$p" "$sp" || return 1   # rung 12: the holder probe, one definition the verb asks again nearest the act
  # rung 13: the newest ctime of every entry, the `.git` file included
  if declare -F _disk_pressure >/dev/null 2>&1 && _disk_pressure "$sp"; then floor="$WS_ORPHAN_FLOOR_PRESSURE_S"; fi
  _ws_collect_idle "$sp" || { _ws_orphan_refuse unmeasured "$_WS_IDLE_DETAIL"; return 1; }
  _WS_ORPHAN_NEWEST="$_WS_IDLE_NEWEST_NS"; _WS_ORPHAN_ENTRIES="$_WS_IDLE_COUNT"; _WS_ORPHAN_FLOOR="$floor"
  now=$(date +%s); secs="${_WS_IDLE_NEWEST_NS%?????????}"; : "${secs:=0}"
  (( now - secs >= floor )) || { _ws_orphan_refuse changed-recently "the newest change under $sp is $(( (now - secs) / 3600 )) h old; the floor is $(( floor / 3600 )) h"; return 1; }
  # rung 14: pause, asked last
  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \
    || { _ws_orphan_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused)"; return 1; }
  return 0
}

_ws_orphan_ladder() {   # path -> 0 with _WS_ORPHAN_TOKEN (and _WS_ORPHAN_VERDICT=token); 1 with _WS_ORPHAN_WORD, _WS_ORPHAN_WHY
  #   and _WS_ORPHAN_VERDICT refused|unmeasured. A tree whose ONLY refusal is rung 9 also gets _WS_ORPHAN_RESCUE.
  local p="${1-}" m mr wsroot pj sp='' sh sb sl spr smain line n slug cls ahead errf err rc r9=0 r9why='' tail_rc=0
  local tid mid aid gd stat_sha ign
  _WS_ORPHAN_WORD=''; _WS_ORPHAN_WHY=''; _WS_ORPHAN_VERDICT=''; _WS_ORPHAN_TOKEN=''; _WS_ORPHAN_RESCUE=''
  _WS_ORPHAN_CLASS=''; _WS_ORPHAN_MAIN=''; _WS_ORPHAN_BRANCH=''; _WS_ORPHAN_HEAD=''
  _WS_ORPHAN_NEWEST=''; _WS_ORPHAN_ENTRIES=''; _WS_ORPHAN_FLOOR=''
  _WS_ORPHAN_R11=0; _WS_ORPHAN_R11WHY=''; _WS_ORPHAN_NESTED=''; _WS_ORPHAN_NLIST=''; _WS_ORPHAN_NBIND=(); _WS_ORPHAN_INSIDE=''
  wsroot=$(cd "$WORKTREES_ROOT" >/dev/null 2>&1 && pwd -P) || wsroot="$WORKTREES_ROOT"
  # 1: a linked worktree of a main checkout under PROJECTS_ROOT, by identity (its stanza -ef the path)
  _ws_reclaim_plain_path "$p" && [[ -d "$p" && ! -L "$p" ]] \
    || { _ws_orphan_refuse not-a-worktree "$p is not one plain real directory"; return 1; }
  for m in "$PROJECTS_ROOT"/*; do
    [[ -e "$m/.git" ]] || continue
    mr=$(cd "$m" >/dev/null 2>&1 && pwd -P) || continue
    while IFS=$'\t' read -r line sh sb sl spr smain; do
      [[ "$line" -ef "$p" ]] || continue
      sp="$line"; _WS_ORPHAN_MAIN="$mr"; pj=$(basename "$m"); break 2
    done < <(_ws_orphan_stanzas "$m")
  done
  [[ -n "$sp" ]] || { _ws_orphan_refuse not-a-worktree "no worktree list of a project names $p"; return 1; }
  slug=$(basename "$sp"); _WS_ORPHAN_TREE="$sp"
  # 2: scope
  cls=$(_ws_orphan_class "$sp" "$_WS_ORPHAN_MAIN" "$wsroot" "$pj" "$(_ws_orphan_stanzas "$_WS_ORPHAN_MAIN" | cut -f1)"); _WS_ORPHAN_CLASS="$cls"
  [[ "$cls" != other ]] || { _ws_orphan_refuse out-of-scope "$sp is neither under the ccd worktree root nor a claude or superpowers worktree"; return 1; }
  # 3: not the main checkout under any spelling
  if [[ "$smain" == 1 ]]; then _ws_orphan_refuse not-a-workspace "$sp is a main checkout"; return 1; fi
  for m in "$PROJECTS_ROOT"/*; do
    [[ -e "$m/.git" ]] || continue
    [[ "$p" -ef "$m" ]] && { _ws_orphan_refuse not-a-workspace "$p is the main checkout $m"; return 1; }
  done
  # 4: no registry row names it
  _ws_orphan_registered "$p" "$sp" "$cls" "$pj" "$slug"; rc=$?
  (( rc == 0 )) || { if (( rc == 1 )); then _ws_orphan_refuse registered "$_WS_ORPHAN_WHY"; else _ws_orphan_refuse unmeasured "$_WS_ORPHAN_WHY"; fi; return 1; }
  _WS_ORPHAN_INSIDE=$(_ws_orphan_inside "$sp")   # a row whose workdir CONTAINS the tree passes rung 4 and is named (G4)
  # 5: not locked in git
  [[ "$sl" != 1 ]] || { _ws_orphan_refuse locked "$sp is locked in git"; return 1; }
  # 6: clean and readable
  _ws_orphan_rung dirty "$p" || { _ws_orphan_refuse "$_WS_ORPHAN_WORD" "${_WS_ORPHAN_WHY:-$p is not clean}"; return 1; }
  stat_sha=$(git -C "$p" status --porcelain --untracked-files=all 2>/dev/null | _plat_sha256 | cut -d' ' -f1)
  # 7: no operation in progress, no index.lock
  n=$(_ws_child_op "$p") || { _ws_orphan_refuse unmeasured "whether $p is mid-operation could not be read"; return 1; }
  [[ -z "$n" ]] || { _ws_orphan_refuse tree-busy "$p is mid-$n"; return 1; }
  gd=$(git -C "$p" rev-parse --absolute-git-dir 2>/dev/null) && [[ -n "$gd" ]] \
    || { _ws_orphan_refuse unmeasured "the git directory of $p could not be located"; return 1; }
  [[ ! -e "$gd/index.lock" && ! -L "$gd/index.lock" ]] || { _ws_orphan_refuse tree-busy "$gd/index.lock stands"; return 1; }
  # 8: HEAD reads
  _ws_orphan_rung head "$p" || { _ws_orphan_refuse "$_WS_ORPHAN_WORD" "$_WS_ORPHAN_WHY"; return 1; }
  [[ "$_WS_ORPHAN_BRANCH" != HEAD ]] || _WS_ORPHAN_BRANCH=detached
  # 9: nothing on HEAD that no remote has. Hook-free (rev-list runs none); a count it cannot give is unmeasured, never a number
  errf=$(_plat_mktemp) || { _ws_orphan_refuse unmeasured "no scratch file to count the commits of $p"; return 1; }
  ahead=$(LC_ALL=C git -C "$p" rev-list --count HEAD --not --remotes 2>"$errf"); rc=$?
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  { (( rc == 0 )) && [[ -z "$err" && "$ahead" =~ ^[0-9]+$ ]]; } \
    || { _ws_orphan_refuse unmeasured "the commits of $p on no remote could not be counted${err:+: ${err%%$'\n'*}}"; return 1; }
  if (( ahead != 0 )); then r9=1; r9why="$ahead commit(s) of $p are on no remote"; fi
  # 10 to 14
  _ws_orphan_tail "$p" "$sp" || tail_rc=$?
  if (( r9 )); then
    _ws_orphan_refuse head-not-on-remote "$r9why"
    (( tail_rc == 0 )) || return 1
  elif (( tail_rc != 0 )); then
    return 1
  elif (( _WS_ORPHAN_R11 )); then
    _ws_orphan_refuse nested-checkout "$_WS_ORPHAN_R11WHY; only --rescue with a rescue token may take it"
  fi
  # the token: every input named, the tree's and its main checkout's and its admin directory's identities, the content digests
  _ws_path_ident "$sp" && tid="$_WS_IDENT" || { _ws_orphan_refuse unmeasured "${_WS_IDENT_WHY:-the identity of $sp was never read}"; return 1; }
  _ws_path_ident "$_WS_ORPHAN_MAIN" follow && mid="$_WS_IDENT" || { _ws_orphan_refuse unmeasured "${_WS_IDENT_WHY:-the identity of $_WS_ORPHAN_MAIN was never read}"; return 1; }
  _ws_path_ident "$gd" follow && aid="$_WS_IDENT" || { _ws_orphan_refuse unmeasured "${_WS_IDENT_WHY:-the identity of $gd was never read}"; return 1; }
  ign="$REAP_IGNDIGEST"
  local -a inp=("pathhex=$(printf '%s' "$p" | _ws_orphan_hex)" "tree=$tid" "main=$mid" "admin=$aid" "head=$_WS_ORPHAN_HEAD"
                "branch=$_WS_ORPHAN_BRANCH" "status=$stat_sha" "ignored=$ign" "newestctimens=$_WS_ORPHAN_NEWEST"
                "entries=$_WS_ORPHAN_ENTRIES" "floor=$_WS_ORPHAN_FLOOR")
  if (( r9 || _WS_ORPHAN_R11 )); then
    _WS_ORPHAN_RESCUE=$(_ws_reclaim_fingerprint mode=orphan-rescue "${inp[@]}" ${_WS_ORPHAN_NBIND[@]+"${_WS_ORPHAN_NBIND[@]}"})
    return 1   # _ws_orphan_refuse above already named head-not-on-remote
  fi
  _WS_ORPHAN_TOKEN=$(_ws_reclaim_fingerprint mode=orphan "${inp[@]}"); _WS_ORPHAN_VERDICT=token
  return 0
}

_ws_orphan_census() {   # ccd ws-audit --orphans -> ONE JSON document: every linked worktree by location class
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the census safely"
  local wsroot m mr pj line sh sb sl spr smain cls slug rows=0 trunc=false first=1 t0=$SECONDS d age ph out='[' chk ins
  local -a seen scan
  wsroot=$(cd "$WORKTREES_ROOT" >/dev/null 2>&1 && pwd -P) || wsroot="$WORKTREES_ROOT"
  for m in "$PROJECTS_ROOT"/*; do
    [[ -e "$m/.git" ]] || continue
    mr=$(cd "$m" >/dev/null 2>&1 && pwd -P) || continue
    pj=$(basename "$m"); seen=(); chk=$(_ws_orphan_stanzas "$m" | cut -f1)
    while IFS=$'\t' read -r line sh sb sl spr smain; do
      seen+=("$line")
      [[ "$smain" != 1 ]] || continue
      cls=$(_ws_orphan_class "$line" "$mr" "$wsroot" "$pj" "$chk"); slug=$(basename "$line")
      [[ "$cls" == ccd-root && -f "$REG/$pj-$slug.uuid" ]] && continue   # a registered workspace is not an orphan
      if (( rows >= WS_ORPHAN_CENSUS_ROWS || SECONDS - t0 >= WS_ORPHAN_CENSUS_S )); then trunc=true; break 2; fi
      age=$(_ws_gc_age "$line"); [[ "$age" == - ]] && age=null
      ph=$(printf '%s' "$line" | _ws_orphan_hex); ins=$(_ws_orphan_inside "$line")
      (( first )) || out+=','; first=0; rows=$(( rows + 1 ))
      out+=$(printf '{"pathHex":"%s","class":"%s","project":%s,"main":%s,"branch":%s,"head":%s,"locked":%s,"prunable":%s,"ageDays":%s,"inside":%s}' \
        "$ph" "$cls" "$(_json_str "$pj")" "$(_json_str "$mr")" "$( [[ "$sb" == detached ]] && echo null || _json_str "$sb")" \
        "$(_json_str "$sh")" "$( (( sl )) && echo true || echo false)" "$( (( spr )) && echo true || echo false)" "$age" "$( [[ -n "$ins" ]] && _json_str "$ins" || echo null)")
    done < <(_ws_orphan_stanzas "$m")
    # a directory under a scanned root that no list names is not a worktree, and is the operator's
    scan=("$wsroot/$pj"/*)
    while IFS= read -r d; do [[ -n "$d" ]] && scan+=("$d/.claude/worktrees"/* "$d/.superpowers/worktrees"/*); done <<< "${chk:-$mr}"
    for d in "${scan[@]}"; do
      [[ -d "$d" && ! -L "$d" ]] || continue
      line=0; for ph in ${seen[@]+"${seen[@]}"}; do [[ "$ph" == "$d" || "$ph" -ef "$d" ]] && { line=1; break; }; done
      (( ! line )) || continue
      [[ "$d" != "$wsroot/$pj/"* || ! -f "$REG/$pj-$(basename "$d").uuid" ]] || continue
      if (( rows >= WS_ORPHAN_CENSUS_ROWS || SECONDS - t0 >= WS_ORPHAN_CENSUS_S )); then trunc=true; break 2; fi
      (( first )) || out+=','; first=0; rows=$(( rows + 1 ))
      out+=$(printf '{"pathHex":"%s","class":"not-a-worktree","project":%s,"main":%s,"branch":null,"head":"","locked":false,"prunable":false,"ageDays":null,"inside":null}' \
        "$(printf '%s' "$d" | _ws_orphan_hex)" "$(_json_str "$pj")" "$(_json_str "$mr")")
    done
  done
  printf '{"mode":"orphans","truncated":%s,"rows":%s]}\n' "$trunc" "$out"
}

_ws_orphan_audit() {   # ccd ws-audit --orphan-hex <hex> -> ONE JSON document; exit 1 when the answer is unmeasured (retry)
  local hex="${1-}" p rc=0
  [[ $# -eq 1 ]] || die "usage: ccd ws-audit --orphan-hex <hex>"
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the audit record safely"
  p=$(_ws_orphan_unhex "$hex") || die "bad path hex"
  _ws_orphan_ladder "$p" || rc=$?
  printf '{"mode":"orphan","pathHex":%s,"class":%s,"main":%s,"branch":%s,"head":%s,"verdict":%s,"refusal":%s,"detail":%s,"token":%s,"rescueToken":%s,"newestCtimeNs":%s,"entries":%s,"floorS":%s,"inside":%s}\n' \
    "$(_json_str "$hex")" "$(_json_str "$_WS_ORPHAN_CLASS")" "$(_json_str "$_WS_ORPHAN_MAIN")" "$(_json_str "$_WS_ORPHAN_BRANCH")" \
    "$(_json_str "$_WS_ORPHAN_HEAD")" "$(_json_str "$_WS_ORPHAN_VERDICT")" \
    "$( [[ -n "$_WS_ORPHAN_WORD" ]] && _json_str "$_WS_ORPHAN_WORD" || echo null)" "$(_json_str "$_WS_ORPHAN_WHY")" \
    "$( [[ -n "$_WS_ORPHAN_TOKEN" ]] && _json_str "$_WS_ORPHAN_TOKEN" || echo null)" \
    "$( [[ -n "$_WS_ORPHAN_RESCUE" ]] && _json_str "$_WS_ORPHAN_RESCUE" || echo null)" \
    "$( [[ -n "$_WS_ORPHAN_NEWEST" ]] && _json_str "$_WS_ORPHAN_NEWEST" || echo null)" \
    "${_WS_ORPHAN_ENTRIES:-null}" "${_WS_ORPHAN_FLOOR:-null}" "$( [[ -n "$_WS_ORPHAN_INSIDE" ]] && _json_str "$_WS_ORPHAN_INSIDE" || echo null)"
  if [[ "$_WS_ORPHAN_VERDICT" == unmeasured ]]; then
    echo "ccd: ws-audit --orphan-hex measured nothing: $_WS_ORPHAN_WHY — retry" >&2
    return 1
  fi
  return 0
}

# ── ws-orphan: the destructive verb (DR-17, D-6629, spec §2.3, §2.6.2) ──────────────────────────────────────────
# THE SERVER'S ACT, composed by the server and by nothing else (CLAUDE.md SAFETY). The token `ws-audit --orphan-hex`
# minted must equal the one the SAME ladder recomputes here, inside `$REG/.orphan-<sha16>.lock`. stdout is ONE JSON
# line: `{"removed":true,…}`, a refusal at exit 0, or `{"failed":…}` at exit 1. `git worktree remove` is never given
# `--force` and the branch only ever `-d`: git's own refusals are the last rung.
_ws_orphan_gap() { :; }   # a test seam between the steps, as `_ws_collect_gap` is the collector's
_ws_orphan_refused() {   # id tx word detail -> journaled (closing the intent when tx is set) and printed; rc 0
  local d; d=$(_ws_leaf_why_line "$4")
  _lc_emit destroy refused "$1" "$2" verb ws-orphan refusal "$3" detail "$d" dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
  printf '{"refused":%s,"detail":%s,"paths":[]}\n' "$(_json_str "$3")" "$(_json_str "$d")"
  return 0
}
_ws_orphan_failed() {   # id tx word detail -> the post-start failure, journaled and printed from one detail; rc 1
  local d; d=$(_ws_leaf_why_line "$4")
  _lc_fail destroy "$1" "$2" "$3" "$d" verb ws-orphan dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
  printf '{"failed":%s,"detail":%s}\n' "$(_json_str "$3")" "$(_json_str "$d")"
  return 1
}

_ws_orphan_locked() {   # token rescue -> everything the lock serialises (id, s16, p and the decision words are cmd_ws_orphan's)
  local tok="$1" rescue="$2" want sp m cls br head tx n=0 err bres=left want_n sha nk np
  _ws_orphan_ladder "$p" || :
  [[ "$_WS_ORPHAN_VERDICT" != unmeasured ]] || { _ws_orphan_failed "$id" "" probe-unmeasured "nothing was removed: $_WS_ORPHAN_WHY"; return 1; }
  want="$_WS_ORPHAN_TOKEN"
  if (( rescue )); then
    if [[ -n "$_WS_ORPHAN_RESCUE" ]]; then want="$_WS_ORPHAN_RESCUE"
    elif [[ -n "$_WS_ORPHAN_TOKEN" ]]; then _ws_orphan_refused "$id" "" no-rescue-token "--rescue was given for a tree that needs no rescue; nothing was pinned or removed"; return 0
    fi
  elif [[ -n "$_WS_ORPHAN_RESCUE" ]]; then
    _ws_orphan_refused "$id" "" "$_WS_ORPHAN_WORD" "$_WS_ORPHAN_WHY"; return 0
  fi
  if [[ -z "$want" ]]; then
    case "$_WS_ORPHAN_WORD" in
      paused|in-use) _ws_orphan_refused "$id" "" "$_WS_ORPHAN_WORD" "nothing was removed: $_WS_ORPHAN_WHY" ;;
      *) _ws_orphan_refused "$id" "" state-changed "nothing was removed: the tree no longer passes the audit that minted the token ($_WS_ORPHAN_WORD: $_WS_ORPHAN_WHY)" ;;
    esac
    return 0
  fi
  [[ "$tok" == "$want" ]] || { _ws_orphan_refused "$id" "" state-changed "nothing was removed: the tree changed since the audit that minted the token"; return 0; }
  sp="$_WS_ORPHAN_TREE"; m="$_WS_ORPHAN_MAIN"; cls="$_WS_ORPHAN_CLASS"; br="$_WS_ORPHAN_BRANCH"; head="$_WS_ORPHAN_HEAD"
  _ws_orphan_gap recomputed
  tx=$(_lc_tx)
  _lc_intent destroy "$id" "$tx" verb ws-orphan meas.mode "$cls" meas.state "$( ((rescue)) && echo rescue || echo plain)" dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
  if (( rescue )); then   # the pin first: a failed pin stops the act with the tree whole
    want_n=$({ git -C "$p" reflog show HEAD --format=%H 2>/dev/null; printf '%s\n' "$head"; } | sort -u \
      | while read -r sha; do [[ "$sha" =~ ^[0-9a-f]{40}$ ]] && git -C "$m" cat-file -e "${sha}^{commit}" 2>/dev/null && echo x; done | wc -l | tr -d ' ')
    n=$(_ws_attic_pin "$m" "orphan/$s16" "$p" "$head" HEAD 0)
    { [[ "$n" =~ ^[1-9][0-9]*$ && "$n" == "$want_n" ]] && git -C "$m" rev-parse --verify --quiet "refs/ccrc/attic/orphan/$s16/$head" >/dev/null 2>&1; } \
      || { _ws_orphan_failed "$id" "$tx" pin-failed "nothing was removed: HEAD of $p could not be pinned under refs/ccrc/attic/orphan/$s16/"; return 1; }
  fi
  if (( rescue && _WS_ORPHAN_R11 )); then   # DR-22 (D-6634): each nested checkout is pinned or rescued whole, and re-proved, before anything goes
    _ws_orphan_nested_pin "$m" "$p" "$s16" || { _ws_orphan_failed "$id" "$tx" pin-failed "nothing was removed: $RECLAIM_PIN_WHY"; return 1; }
  fi
  _ws_orphan_gap pinned
  if ! _ws_orphan_holders "$p" "$sp"; then   # the holder, asked once more nearest the act
    if [[ "$_WS_ORPHAN_VERDICT" == unmeasured ]]; then _ws_orphan_failed "$id" "$tx" probe-unmeasured "nothing was removed: $_WS_ORPHAN_WHY"; return 1; fi
    _ws_orphan_refused "$id" "$tx" "$_WS_ORPHAN_WORD" "nothing was removed: $_WS_ORPHAN_WHY"; return 0
  fi
  if (( rescue && _WS_ORPHAN_R11 )); then   # the rescued directories go first, by the collector's own removal; then git's, never forced
    while IFS=$'\t' read -r nk np; do
      [[ -n "$np" ]] || continue
      _ws_leaf_remove "${np%/*}" "${np##*/}" || { _ws_orphan_failed "$id" "$tx" nested-remove-failed "$np was not removed ($_WS_LEAF_WHY); the tree is left as it stands"; return 1; }
    done < <(printf '%s' "$_WS_ORPHAN_NLIST" | LC_ALL=C sort -t $'\t' -k2,2 -r)
  fi
  err=$(git -C "$m" worktree remove -- "$p" 2>&1) && [[ ! -e "$p" ]] \
    || { _ws_orphan_failed "$id" "$tx" worktree-remove-failed "git did not remove $p, and it is left as it stands: ${err:-the directory still stands}"; return 1; }
  if [[ "$cls" == ccd-root && "$br" != detached && -n "$br" ]]; then   # a ccd-root tree's branch is ours; -d only, never -D
    if git -C "$m" branch -d -- "$br" >/dev/null 2>&1; then bres=deleted; else bres=branch-kept; fi
  fi
  _lc_done destroy "$id" "$tx" verb ws-orphan meas.mode "$cls" meas.branch "$bres" meas.attic "$( ((rescue)) && echo "$n")" dec.surface "$lc_surface" dec.actor "$lc_actor" dec.reason "$lc_reason"
  printf '{"removed":true,"pathHex":%s,"class":%s,"branch":%s,"pinned":%s}\n' "$(_json_str "$(printf '%s' "$p" | _ws_orphan_hex)")" "$(_json_str "$cls")" "$(_json_str "$bres")" "$n"
}

_ws_orphan_nested_pin() {   # main tree s16 -> 0 when each nested checkout is pinned (same repository) or rescued (foreign) under
  #   refs/ccrc/attic/orphan/<s16>/nested/<pathhex>/ and every pin re-proved; 1 with RECLAIM_PIN_WHY. Run under `_ws_reclaim_contained`.
  local m="$1" pr b kind c rel wip sha got
  RECLAIM_PIN_WHY=''; RECLAIM_SECRETS=()
  pr=$(cd "$2" >/dev/null 2>&1 && pwd -P) || { RECLAIM_PIN_WHY="could not resolve $2"; return 1; }
  while IFS=$'\t' read -r kind c; do
    [[ -n "$c" ]] || continue
    rel="${c#"$pr"/}"; b="refs/ccrc/attic/orphan/$3/nested/$(_ws_hex "$rel")"
    if [[ "$kind" == foreign ]]; then _ws_nested_rescue "$m" "$c" "$b" "orphan-$3" orphan "$rel/" || return 1; continue; fi
    _ws_wip_commit "$c" "orphan-$3" orphan "$rel/" || { RECLAIM_PIN_WHY="$RECLAIM_WIP_WHY"; return 1; }
    wip="$RECLAIM_WIP_SHA"
    { git -C "$c" reflog show HEAD --format=%H 2>/dev/null | LC_ALL=C sort -u | sed "s#.*#& reflog/&#"; git -C "$c" rev-parse --verify --quiet "HEAD^{commit}" | sed 's#.*#& heads/&#'
      [[ -z "$wip" ]] || echo "$wip wips/$wip"; } | while read -r sha got; do
      [[ "$sha" =~ ^[0-9a-f]{40,64}$ ]] && git -C "$m" update-ref "$b/$got" "$sha" 2>/dev/null && [[ "$(git -C "$m" rev-parse --verify --quiet "$b/$got")" == "$sha" ]] || exit 1
    done
    [[ "${PIPESTATUS[1]}" == 0 && -n "$(git -C "$m" for-each-ref --count=1 "$b/heads/")" ]] || { RECLAIM_PIN_WHY="the nested checkout at $c could not be pinned under $b/"; return 1; }
  done <<< "$_WS_ORPHAN_NLIST"
}

cmd_ws_orphan() {   # ccd ws-orphan --expect <token> --tree-hex <hex> [--rescue] [--surface <word>] [--actor <text>] [--reason <text>]
  local U='usage: ccd ws-orphan --expect <token> --tree-hex <hex> [--rescue] [--surface <word>] [--actor <text>] [--reason <text>]'
  local lc_surface=none lc_actor='' lc_reason='' gs=0 ga=0 gr=0 token='' hex='' rescue=0 w
  while (( $# )); do
    case "$1" in
      --expect)   [[ $# -ge 2 && -z "$token" ]] || die "$U"; token="$2"; shift 2 ;;
      --tree-hex) [[ $# -ge 2 && -z "$hex" ]] || die "$U"; hex="$2"; shift 2 ;;
      --rescue)   (( ! rescue )) || die "$U"; rescue=1; shift ;;
      --surface)  [[ $# -ge 2 ]] || die "$U"; gs=1; lc_surface="$2"; shift 2 ;;
      --actor)    [[ $# -ge 2 ]] || die "$U"; ga=1; lc_actor="$2"; shift 2 ;;
      --reason)   [[ $# -ge 2 ]] || die "$U"; gr=1; lc_reason="$2"; shift 2 ;;
      *)          die "$U" ;;
    esac
  done
  if (( gs )); then w=$(_lc_surface_norm "$lc_surface"); lc_surface=${w:-unknown}; fi
  if (( ga )); then [[ -n "${lc_actor//[[:space:]]/}" ]] || die "--actor must be non-blank"; _lc_dec_ok "$lc_actor" || die "--actor is longer than $_LC_DEC_MAX bytes"; fi
  if (( gr )); then [[ -n "${lc_reason//[[:space:]]/}" ]] || die "--reason must be non-blank"; _lc_dec_ok "$lc_reason" || die "--reason is longer than $_LC_DEC_MAX bytes"; fi
  [[ -n "$token" && -n "$hex" ]] || die "$U"
  [[ $token =~ ^[0-9a-f]{64}$ ]] || die "bad token"
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the record safely"
  local p; p=$(_ws_orphan_unhex "$hex") && [[ "$p" == /?* ]] || die "bad tree hex"
  local s16 id; s16=$(printf '%s' "$p" | _plat_sha256 | cut -d' ' -f1 | cut -c1-16); id="orphan-$s16"
  # no lock is opened for a path that is not one plain directory: the lock files are never removed
  [[ -d "$p" && ! -L "$p" ]] || { _ws_orphan_refused "$id" "" not-a-worktree "$p is not one plain real directory; no lock was taken"; return 0; }
  command -v flock >/dev/null 2>&1 || _lc_refuse destroy "$id" flock-unavailable "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  local lfd rc=0
  exec {lfd}>>"$REG/.orphan-$s16.lock" || _lc_refuse destroy "$id" lock-unopenable "cannot open the orphan lock at $REG/.orphan-$s16.lock"
  flock -n "$lfd" || { exec {lfd}>&-; _ws_orphan_refused "$id" "" locked-elsewhere "another ccd process holds the orphan lock for $p"; return 0; }
  _ws_reclaim_contained _ws_orphan_locked "$token" "$rescue"; rc=$?
  exec {lfd}>&-
  return "$rc"
}

# @ccd-lib:nested
# NESTED-RESCUE-V1 (D-6632, disk-retention spec §2.7.1). Under `$REG/nested-rescue-live`, a nested checkout of ANOTHER
# repository that `_ws_reclaim_foreign_clean` refuses for work (dirty, a hidden-flag edit, a commit on no remote) is
# RESCUED instead of refusing rung 9: the pin WIP-commits it, fetches its refs, its HEAD and the WIP into the project's
# attic, and re-proves each landed. Without the marker rung 9 is unchanged and only names what it would rescue.
WS_NESTED_RESCUE_MAX_MB=512   # bytes the rescue may add to the project's store; the kill rule raises it, nothing lowers it
_ws_nested_rescue_live() { [[ -e "$REG/nested-rescue-live" ]]; }
# Rescuable = the marker AND a HEAD that resolves: `_ws_wip_commit` needs HEAD^{tree}, so an unborn repository (only untracked
# files) can never be pinned, and a token over it would only buy a retry loop. It stays containment-unproven, as without the marker.
# A SHALLOW or PARTIAL clone is not rescuable either: a fetch from a shallow source into a full repository rejects every ref
# (rc 0, nothing lands), so its token would answer nested-rescue-failed on every pass; it stays containment-unproven.
# A LINKED WORKTREE of the nested repository (its detached HEAD names a commit no ref does, and the worktree lives outside the tree
# being removed) and LFS or annex content (in `.git/lfs` or `.git/annex`, which a fetch never moves) hold work the rescue cannot
# carry, so a repository with either stays containment-unproven. Only the repository's OWN config is read (a global or system
# `filter.lfs.*` is on every box with git-lfs). A repository mid-operation (rebase, am, merge, an index.lock) keeps state no ref or
# reflog reaches (the autostash commit, unapplied patches), so it stays containment-unproven too. So does any `.git/<dir>` beyond
# the standard ones (git-crypt keys, submodule stores, ...): state a fetch of refs never carries.
_ws_nested_rescue_shape() {   # what arming WOULD rescue: marker-independent, so the shadow list never names what the arm refuses
  local c
  c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [[ -n "$c" ]] \
    && git -C "$1" rev-parse --verify --quiet "HEAD^{commit}" >/dev/null 2>&1 \
    && [[ "$(git -C "$1" rev-parse --is-shallow-repository 2>/dev/null)" == false ]] \
    && [[ -z "$(git -C "$1" config --local --get-regexp '^(extensions\.partialclone|remote\..*\.(promisor|partialclonefilter)|filter\.lfs\..*)$' 2>/dev/null)" ]] \
    && [[ "$(git -C "$1" worktree list --porcelain 2>/dev/null | grep -c '^worktree ')" == 1 ]] \
    && [[ ! -e "$c/lfs/objects" && ! -e "$c/annex" ]] \
    && [[ -z "$(find "$c" -mindepth 1 -maxdepth 1 -type d ! \( -name branches -o -name hooks -o -name info -o -name logs -o -name objects -o -name refs -o -name rr-cache \) 2>/dev/null)" ]] \
    && ! _ws_nested_busy "$1"
}
_ws_nested_busy() {   # nested dir -> 0 when an operation is in progress or unprobeable (state no ref or reflog reaches)
  local f
  [[ -z "$(_ws_child_op "$1" 2>/dev/null || echo unprobeable)" ]] || return 0
  for f in MERGE_AUTOSTASH index.lock; do [[ ! -e "$(git -C "$1" rev-parse --path-format=absolute --git-path "$f" 2>/dev/null)" ]] || return 0; done
  return 1
}
_ws_nested_rescuable() { _ws_nested_rescue_live && _ws_nested_rescue_shape "$1"; }
_ws_nested_secrets() {   # nested rel -> its secret-shaped paths (untracked, IGNORED, or modified tracked) join REAP_SENSITIVE and RECLAIM_SECRETS
  local e p skip
  while IFS= read -r -d '' e; do
    case "$e" in [RC]?' '*|?[RC]' '*) IFS= read -r -d '' skip || :; p="${e:3}" ;; ??' '*) p="${e:3}" ;; *) continue ;; esac
    _ws_reclaim_secret_path "$p" && { REAP_SENSITIVE+=("$2/$p"); RECLAIM_SECRETS+=("$2/$p"); }
  done < <(git -C "$1" -c core.quotePath=false status --porcelain=v1 -z --untracked-files=all --ignored 2>/dev/null)
  return 0
}
_ws_hex() { printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'; }
_ws_lines_json() {   # lines -> a JSON array of strings
  local out="[" first=1 l; while IFS= read -r l; do [[ -n "$l" ]] || continue; (( first )) || out+=","; first=0; out+="$(_json_str "$l")"; done <<< "$1"; printf '%s]' "$out"
}
_ws_rescue_doc() {   # the audit document's `nestedRescue` key (with its comma), only when a rescue is or would be in play
  [[ -n "$RECLAIM_RESCUE$RECLAIM_RESCUE_WOULD" ]] || return 0
  printf '"nestedRescue":{"wouldRescue":%s,"rescue":%s},' "$(_ws_lines_json "$RECLAIM_RESCUE_WOULD")" "$(_ws_lines_json "$RECLAIM_RESCUE")"
}
_ws_nested_bind() {   # nested rel -> `nestedRescue=<pathhex>:<HEAD or ->:<status digest>`, the token's binding of a rescue
  local h st d
  h=$(git -C "$1" rev-parse --verify --quiet "HEAD^{commit}" 2>/dev/null) || h=-
  st=$(git -C "$1" status --porcelain --untracked-files=all 2>/dev/null) || return 1
  d=$(printf '%s' "$st" | _plat_sha256 | cut -d' ' -f1)
  printf 'nestedRescue=%s:%s:%s' "$(_ws_hex "$2")" "$h" "$d"
}
_ws_store_kb() { git -C "$1" count-objects -v 2>/dev/null | awk -F': ' '$1 == "size" || $1 == "size-pack" { s += $2 } END { print s + 0 }'; }
_ws_nested_same() {   # main nested base wip -> 0 when `$base/` already holds THIS rescue: same HEAD, same WIP tree, no ref of it moved
  local w
  [[ "$(git -C "$1" rev-parse --verify --quiet "$3/head" 2>/dev/null)" == "$(git -C "$2" rev-parse --verify --quiet "HEAD^{commit}" 2>/dev/null)" ]] || return 1
  if [[ -n "$4" ]]; then w=$(git -C "$1" rev-parse --verify --quiet "$3/wip^{tree}" 2>/dev/null); [[ -n "$w" && "$w" == "$(git -C "$2" rev-parse "$4^{tree}" 2>/dev/null)" ]] || return 1
  else ! git -C "$1" rev-parse --verify --quiet "$3/wip" >/dev/null 2>&1 || return 1; fi
  ! git -C "$1" for-each-ref --format='%(objectname) %(refname)' "$3/refs/" | sed "s# $3/# #" | grep -vxFf <(git -C "$2" for-each-ref --format='%(objectname) %(refname)') | grep -q .
}
_ws_nested_unland() { git -C "$1" for-each-ref --format='%(refname)' "$2/" | { grep -v "^$2/again-" || true; } | sed 's/^/delete /' | git -C "$1" update-ref --stdin 2>/dev/null; return 0; }   # a fresh base this pass claimed, its re-prove failed: leave no claim or partial refs for a retry to outgrow
_ws_nested_rescue() {   # main nested base id childof prefix -> 0 with RECLAIM_RESCUE_ENTRY (one JSON object); 1 with
  #                         RECLAIM_PIN_WORD (nested-rescue-too-large | nested-rescue-failed) and RECLAIM_PIN_WHY.
  # Run under `_ws_reclaim_contained`. Moves no ref in the nested repository; adds refs only under `$base`.
  local main="$1" n="$2" base="$3" id="$4" childof="$5" prefix="$6" wip b a q ref want got specs=() errf orph tips base0 reuse=0 blob tries=0 wantl gotl c
  RECLAIM_PIN_WORD=nested-rescue-failed; RECLAIM_RESCUE_ENTRY=""
  ! _ws_nested_busy "$n" || { RECLAIM_PIN_WHY="the nested repository at $n has an operation in progress — its autostash and patch state is on no ref, so it stays"; return 1; }
  _ws_nested_rescue_shape "$n" || { RECLAIM_PIN_WHY="the nested repository at $n has a shape a fetch cannot carry (LFS or annex content, a linked worktree, a partial or shallow clone) — it stays"; return 1; }
  _ws_wip_commit "$n" "$id" "$childof" "$prefix" || { RECLAIM_PIN_WHY="could not capture the uncommitted work of the nested repository at $n: $RECLAIM_WIP_WHY"; return 1; }
  wip="$RECLAIM_WIP_SHA"
  # A global clean filter can write content into `.git/lfs` while the WIP is staged and commit only a pointer: look again.
  c=$(git -C "$n" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [[ -n "$c" && ! -e "$c/lfs/objects" && ! -e "$c/annex" ]] \
    || { RECLAIM_PIN_WHY="staging the uncommitted work of the nested repository at $n wrote LFS or annex content a fetch never moves — it stays"; return 1; }
  git -C "$n" rev-parse --verify --quiet "HEAD^{commit}" >/dev/null 2>&1 \
    || { RECLAIM_PIN_WHY="the nested repository at $n has no commit at HEAD — there is nothing to pin it by, so it stays"; return 1; }
  errf=$(_plat_mktemp) || { RECLAIM_PIN_WHY="could not make a scratch file to rescue $n"; return 1; }
  base0="$base"   # the base is chosen (and claimed) only at landing, below
  specs=("+refs/*:$base/refs/*")
  # A commit only a reflog names (a stash below the newest, a reset-away tip) is in no ref: it is fetched by sha too.
  orph=$(git -C "$n" rev-list --reflog --not --all 2>/dev/null) \
    || { RECLAIM_PIN_WHY="could not list the commits only the reflogs of the nested repository at $n name"; return 1; }
  tips=$(git -C "$n" reflog show --all --format=%H 2>/dev/null | LC_ALL=C sort -u | { grep -Fxf <(printf '%s\n' "$orph") || true; })
  (( $(printf '%s' "$tips" | grep -c .) <= 500 )) || { RECLAIM_PIN_WHY="the nested repository at $n has over 500 reflog-only commits — it stays"; return 1; }
  for want in $tips; do specs+=("+$want:$base/reflog/$want"); done
  git -C "$n" rev-parse --verify --quiet "HEAD^{commit}" >/dev/null 2>&1 && specs+=("+HEAD:$base/head")
  [[ -z "$wip" ]] || specs+=("+$wip:$base/wip" "+$wip:$base/wips/$wip")
  # THE BOUND IS MEASURED BEFORE ANYTHING LANDS, in a throwaway repository that borrows the project's store as an alternate, so the
  # answer is the same on every attempt: a refused rescue must not leave its objects in the store for the next one to find already paid.
  # An ordinary PACKED fetch (`unpackLimit=1`) keeps delta compression, so `size-pack` is a compressed upper bound on what would land
  # (it may count objects no ref reaches, which only errs toward keeping). The landing fetch below carries the same `unpackLimit=1`,
  # because git's default would write a rescue of fewer than 100 objects as loose, undeltified objects, many times the measured size. A repository whose own store is far over the bound is
  # refused before any fetch, so a huge clone never writes its objects to temp on a box that is short of disk.
  a=$(_ws_store_kb "$n")
  if (( a > 4 * WS_NESTED_RESCUE_MAX_MB * 1024 )); then
    rm -f "$errf"; RECLAIM_PIN_WORD=nested-rescue-too-large
    RECLAIM_PIN_WHY="the nested repository at $n holds $(( a / 1024 )) MiB, far over the $WS_NESTED_RESCUE_MAX_MB MiB bound — nothing was taken"; return 1
  fi
  q=$(_plat_mktemp_d) && { _WS_NQ=$q; [[ -n "$(trap -p EXIT)" ]] || trap 'rm -rf "${_WS_NQ:-}"' EXIT; } && git init -q --bare "$q" 2>/dev/null \
    && git -C "$main" rev-parse --path-format=absolute --git-path objects >"$q/objects/info/alternates" 2>/dev/null \
    || { rm -rf "$q"; rm -f "$errf"; RECLAIM_PIN_WHY="could not make a scratch repository to measure the rescue of $n"; return 1; }
  git -C "$q" -c gc.auto=0 -c transfer.unpackLimit=1 -c uploadpack.allowAnySHA1InWant=true fetch -q --no-tags --no-write-fetch-head "$n" "${specs[@]}" >/dev/null 2>"$errf" \
    || { RECLAIM_PIN_WHY="could not fetch the nested repository at $n to measure it: $(head -1 "$errf")"; rm -rf "$q"; rm -f "$errf"; return 1; }
  a=$(_ws_store_kb "$q"); rm -rf "$q"; _WS_NQ=""; b=0
  if (( a > WS_NESTED_RESCUE_MAX_MB * 1024 )); then
    rm -f "$errf"; RECLAIM_PIN_WORD=nested-rescue-too-large
    RECLAIM_PIN_WHY="rescuing the nested repository at $n would add $(( a / 1024 )) MiB to the project, over the $WS_NESTED_RESCUE_MAX_MB MiB bound — nothing was taken"; return 1
  fi
  # APPEND-ONLY: a name the attic already holds is never force-moved (a second same-named repository would orphan the first's tips),
  # except by the rescue of the SAME tree (the settle re-pin), which lands in place. A base is CLAIMED by a create-only `update-ref`,
  # so two rescues choosing at once cannot both take one name; the loser takes the next.
  if [[ -n "$(git -C "$main" for-each-ref --count=1 "$base/" 2>/dev/null)" ]]; then
    if _ws_nested_same "$main" "$n" "$base" "$wip"; then reuse=1; else base="$base0/again-$(date +%s)-$$-$RANDOM"; fi
  fi
  if (( ! reuse )); then
    blob=$(git -C "$main" hash-object -w --stdin </dev/null 2>/dev/null) || { rm -f "$errf"; RECLAIM_PIN_WHY="could not claim a place in the attic for the nested repository at $n"; return 1; }
    until git -C "$main" update-ref "$base/claim" "$blob" "" 2>/dev/null; do
      (( ++tries < 8 )) || { rm -f "$errf"; RECLAIM_PIN_WHY="could not claim a place in the attic for the nested repository at $n"; return 1; }
      base="$base0/again-$(date +%s)-$$-$RANDOM"
    done
  fi
  specs=("${specs[@]//$base0/$base}")
  git -C "$main" -c gc.auto=0 -c transfer.unpackLimit=1 -c fetch.unpackLimit=1 -c uploadpack.allowAnySHA1InWant=true fetch -q --no-tags --no-write-fetch-head "$n" "${specs[@]}" >/dev/null 2>"$errf" \
    || { RECLAIM_PIN_WHY="could not fetch the nested repository at $n into the attic: $(head -1 "$errf")"; rm -f "$errf"; (( reuse )) || git -C "$main" update-ref -d "$base/claim" 2>/dev/null; return 1; }
  rm -f "$errf"
  # RE-PROVE (spec §2.7.1 step 3): every ref tip, HEAD, the WIP and each reflog-only tip resolve under the attic.
  while read -r want ref; do
    [[ -n "$want" ]] || continue
    got=$(git -C "$main" rev-parse --verify --quiet "$base/$ref" 2>/dev/null)
    [[ "$got" == "$want" ]] || { RECLAIM_PIN_WHY="$ref of the nested repository at $n did not land under $base/"; (( reuse )) || _ws_nested_unland "$main" "$base"; return 1; }
  done < <({ git -C "$n" for-each-ref --format='%(objectname) %(refname)'; git -C "$n" rev-parse --verify --quiet "HEAD^{commit}" | sed 's/$/ head/'; [[ -z "$wip" ]] || echo "$wip wip"; for want in $tips; do echo "$want reflog/$want"; done; } 2>/dev/null)
  # ... and the re-prove is TOTAL, not list-based: every commit any ref, any worktree HEAD or any reflog of the nested repository
  # reaches must be reachable from what landed, so a commit no listing above names (a linked worktree's detached HEAD) fails here.
  wantl=$(git -C "$n" rev-list --all --reflog 2>/dev/null | LC_ALL=C sort -u; exit "${PIPESTATUS[0]}") \
    && gotl=$(git -C "$main" for-each-ref --format='%(objectname)' "$base/refs/" "$base/head" "$base/wips/" "$base/reflog/" 2>/dev/null | git -C "$main" rev-list --stdin 2>/dev/null | LC_ALL=C sort -u) \
    && [[ -z "$(comm -23 <(printf '%s\n' "$wantl") <(printf '%s\n' "$gotl") | grep .)" ]] \
    || { RECLAIM_PIN_WHY="the nested repository at $n holds commits that did not all land under $base/ — it stays"; (( reuse )) || _ws_nested_unland "$main" "$base"; return 1; }
  RECLAIM_PIN_WORD=""
  RECLAIM_RESCUE_ENTRY=$(printf '{"path":%s,"refs":%s,"wip":%s,"bytes":%s}' "$(_json_str "${prefix%/}")" "$(_json_str "$base/")" \
    "$( [[ -n "$wip" ]] && _json_str "$wip" || echo null)" "$(( (a - b) * 1024 ))")
}

_ws_scratch_rescue_run() {   # id main path -> `_ws_nested_rescue`'s answer for a session's scratch repository, as a document
  local id="$1" main="$2" d="$3" mainreal dcommon top name
  RECLAIM_SECRETS=(); RECLAIM_PIN_WHY=""; RECLAIM_PIN_WORD=nested-rescue-failed
  mainreal=$(_ws_common_dir "$main") && dcommon=$(_ws_common_dir "$d") && top=$(cd -- "$d" 2>/dev/null && git rev-parse --path-format=absolute --show-toplevel 2>/dev/null) \
    && [[ "$dcommon" != "$mainreal" && "$top" == "$(cd -P -- "$d" && pwd -P)" ]] \
    || { printf '{"failed":%s,"detail":%s}\n' '"nested-rescue-failed"' "$(_json_str "$d is not the root of a repository other than $main's own")"; return 1; }
  name="${d##*/}"
  if _ws_nested_rescue "$main" "$d" "refs/ccrc/attic/$id/scratch/$(_ws_hex "$name")" "$id" scratch "$name/"; then
    printf '{"rescued":%s}\n' "$RECLAIM_RESCUE_ENTRY"
  else
    printf '{"failed":%s,"detail":%s}\n' "$(_json_str "$RECLAIM_PIN_WORD")" "$(_json_str "$RECLAIM_PIN_WHY")"; return 1
  fi
}
cmd_scratch_rescue() {   # ccd scratch-rescue --session <id> <path> — keep a session's scratch repository in its project's attic
  # The size budget's rescue (spec §2.1.1, ruling 3): called ONLY by `ccd-tmp-sweep`, behind the direct entry like `ws-collect`, and
  # forbidden to sessions. It deletes nothing; it adds refs under `refs/ccrc/attic/<id>/scratch/<namehex>/` and prints one document.
  local project LC_ALL=C
  [[ $# -eq 3 && "$1" == --session ]] || die "usage: ccd scratch-rescue --session <id> <path>"
  # The id check and the project read are inline (the id grammar of `_reg_id_ok`, the read of `_reg_get`) so this verb adds no
  # edge into the registry context and no `_reg_get` call to the census; a missing or unreadable field is refused below.
  [[ "$2" =~ ^[A-Za-z0-9._-]+$ && "$2" != -* ]] || die "bad session id"
  [[ -f "$REG/$2.uuid" ]] || die "no such session: $2"
  project=""; [[ -f "$REG/$2.project" && ! -L "$REG/$2.project" ]] && _file_read_to project "$REG/$2.project"
  [[ -n "$project" && "$3" == /* && -d "$3" && ! -L "${3%/}" ]] || die "$3 is not one plain absolute directory"
  _ws_reclaim_contained _ws_scratch_rescue_run "$2" "$PROJECTS_ROOT/$project" "$3"
}

# @ccd-lib:stale
# THE STALE ARM (DR-26, D-6638; spec §2.7.3). A kept child is reclaimed after seven idle days, and the server names
# WHY it was kept: `--stale held|run-absent|review|terminal`. Only `held` moves a rung (rung 4, by the hold's digest);
# the others change nothing but the token, which binds the word, the digest and the box's idle instant. The words
# are the CALLER's (`_ws_stale_argv`, from the verb's or the audit's flags), set as locals there, so an exported
# environment never arms the arm; the expiry ladder, which shares `_ws_reclaim_ladder`, never sets them.
WS_STALE_IDLE_S=604800   # seven days, spec §2.7.3. The box's half of "idle"; raise-only, nothing lowers it.
_WS_STALE_WORD=""; _WS_STALE_DIGEST=""
_ws_stale_argv() {   # [--defer-expired] [--stale <word>] [--hold-digest <sha256>] ... -> sets the caller's `defer`, `_WS_STALE_WORD` and `_WS_STALE_DIGEST`; rc 1 on anything else
  while (( $# )); do
    case "$1" in
      --defer-expired) defer=1; shift ;;
      --stale)         [[ $# -ge 2 && -z $_WS_STALE_WORD ]] || return 1; _WS_STALE_WORD=$2; shift 2 ;;
      --hold-digest)   [[ $# -ge 2 && -z $_WS_STALE_DIGEST ]] || return 1; _WS_STALE_DIGEST=$2; shift 2 ;;
      *)               return 1 ;;
    esac
  done
  case "$_WS_STALE_WORD" in
    held)                         [[ $_WS_STALE_DIGEST =~ ^[0-9a-f]{64}$ ]] ;;
    run-absent|review|terminal|'') [[ -z $_WS_STALE_DIGEST ]] ;;
    *)                            return 1 ;;
  esac
}
_ws_reclaim_hold_released() {   # id -> 0 when `--stale held` was given and the hold's bytes hash to the digest it carries; else 1 (the hold stands)
  [[ $_WS_STALE_WORD == held && "${_WS_LADDER_BIND[0]-}" != mode=expire && -f "$REG/$1.hold" && -r "$REG/$1.hold" ]] || return 1
  [[ "$(_plat_sha256 < "$REG/$1.hold" 2>/dev/null | cut -d' ' -f1)" == "$_WS_STALE_DIGEST" ]]
}
_ws_reclaim_stale_idle() {   # id transcript probe-verdict pane-activity -> 0 (the token bound to the idle instant), or REAP_VERDICT=not-idle|unmeasured
  # The ladder asks tmux and `_transcript_path` (it already holds the probe and the pane's name) and hands the answers
  # here; this decides. The newest of the transcript, `.lastend`, `.spawn`, `.woke`, `.supervised` and a live pane's
  # `#{window_activity}` must be older than WS_STALE_IDLE_S. Nothing recorded, or anything unreadable: unmeasured.
  local id="$1" tp="$2" verdict="$3" act="$4" p m newest=0 seen=0
  for p in "$tp" "$REG/$id.lastend" "$REG/$id.spawn" "$REG/$id.woke" "$REG/$id.supervised"; do
    [[ -n $p && ( -e $p || -L $p ) ]] || continue
    m=$(_plat_mtime "$p" 2>/dev/null) && [[ $m =~ ^[0-9]+$ ]] \
      || { _ws_reclaim_unmeasured "when $p was last written could not be read — $id's idle time is unmeasured"; return 1; }
    seen=1; (( m > newest )) && newest=$m
  done
  case "$verdict" in
    gone) : ;;
    live) [[ $act =~ ^[0-9]+$ ]] \
            || { _ws_reclaim_unmeasured "$id's tmux session is up and would not say when it was last active — its idle time is unmeasured"; return 1; }
          seen=1; (( act > newest )) && newest=$act ;;
    *)    _ws_reclaim_unmeasured "whether $id's tmux session is up could not be asked — its idle time is unmeasured"; return 1 ;;
  esac
  (( seen )) || { _ws_reclaim_unmeasured "nothing records when $id last worked (no transcript, .lastend, .spawn, .woke, .supervised or pane)"; return 1; }
  (( $(date +%s) - newest > WS_STALE_IDLE_S )) \
    || { _reap_refuse not-idle "$id worked at epoch $newest, less than $WS_STALE_IDLE_S seconds ago — a stale reclaim waits for seven idle days"; return 1; }
  _WS_LADDER_BIND+=("stale=$_WS_STALE_WORD" "holdDigest=$_WS_STALE_DIGEST" "idleAt=$newest")
}

# @ccd-lib:loose
# ── loose temp entries: the loose arm of ws-collect (fleet disk retention spec 2026-10-23 §2.4, D-6625) ── LOOSE-BEGIN ──
# An entry directly under `~/.cc-tmp` that no witness and no registry row names (a stray directory or file) is the
# operator's today (D-5888 declined it: nothing identified it). This arm collects it in the same quarantine, with an
# identity the TOKEN binds instead of a witness: dev, inode, birth time, type, owner, the newest ctime, the entry
# count and the floor, and a licence needs two unchanged observations of that token an interval apart (the lane's).
# It is a SIBLING of the witnessed arm and borrows its parts: the quarantine and slot, the rename, the idle walk, the
# in-use probe, the checkout and row questions, the removal helper and the pause. What is its own: the lock
# `$REG/.collect-loose.lock` (no reap lock: there is no id), the record family `$REG/tmpquarantine-loose/`, and names
# that cross the wire as hex, so no entry's name is ever read as an option. Linux only, like the witnessed arm.
_DISK_CRITICAL_PCT=92   # equal to L0's DISK_CRITICAL_PCT; server/test/disk-twins.test.ts reads this line
WS_LOOSE_CENSUS_MAX=1024
WS_LOOSE_FLOOR_S=172800            # 48 h: twice the witnessed floor
WS_LOOSE_PRESSURE_FLOOR_S=86400    # 24 h under pressure, never below the witnessed 24 h floor
_WS_LOOSE_NAME=''; _WS_LOOSE_CLASS=''; _WS_LOOSE_WHY=''; _WS_LOOSE_SHA=''; _WS_LOOSE_FLOOR=''; _WS_LOOSE_PRESSURE=0
_WS_LOOSE_DEV=''; _WS_LOOSE_INO=''; _WS_LOOSE_BT=''; _WS_LOOSE_TYPE=''; _WS_LOOSE_UID=''; _WS_LOOSE_ACCEPTED=''
_WS_LOOSE_RECORD=''; _WS_LOOSE_PHASE=''; _WS_LOOSE_RECS=(); _WS_LOOSE_SLOTS=()
_WS_LREC_DEV=''; _WS_LREC_INO=''; _WS_LREC_BT=''; _WS_LREC_TYPE=''; _WS_LREC_TOKEN=''; _WS_LREC_CO=''; _WS_LREC_SLOT=''

_disk_pressure() {   # path -> 0 when the file system holding path is at or over _DISK_CRITICAL_PCT of its bytes or inodes;
  #                      1 when it is not, or could not be read (unmeasured is not pressure: the longer floor holds).
  #                      Bytes are df's own used / (used + avail), as in shared/disk.ts (the agent's L0 reading)
  local p="${1-}" r
  [[ "$CCD_OS" != darwin && -n "$p" ]] || return 1
  r=$(LC_ALL=C df -Pk -- "$p" 2>/dev/null | awk -v t="$_DISK_CRITICAL_PCT" 'NR == 2 && ($3 + $4) > 0 && $3 * 100 >= t * ($3 + $4) { print "y" }')
  [[ "$r" != y ]] || return 0
  r=$(LC_ALL=C df -Pi -- "$p" 2>/dev/null | awk -v t="$_DISK_CRITICAL_PCT" 'NR == 2 && $2 > 0 && $3 * 100 >= t * $2 { print "y" }')
  [[ "$r" == y ]]
}

_ws_loose_hex() { printf '%s' "${1-}" | LC_ALL=C od -An -v -tx1 | tr -d ' \n'; }   # name -> its bytes as lower-case hex
_ws_loose_unhex() {   # hex -> 0 with _WS_LOOSE_NAME = the bytes it spells; 1 when it is not 1..255 whole bytes, or holds a NUL
  local LC_ALL=C h="${1-}" i p b n=''
  _WS_LOOSE_NAME=''
  [[ "$h" =~ ^([0-9a-f]{2}){1,255}$ ]] || return 1
  for (( i = 0; i < ${#h}; i += 2 )); do p="${h:i:2}"; [[ "$p" != 00 ]] || return 1; printf -v b "\\x$p"; n+="$b"; done
  _WS_LOOSE_NAME="$n"
}
_ws_loose_name_ok() {   # name -> 0 when it is one printable UTF-8 path component: no `/`, no control byte, not `.` or `..`
  local LC_ALL=C n="${1-}"
  [[ -n "$n" && "$n" != . && "$n" != .. && ${#n} -le 255 && "$n" != */* && "$n" != *[[:cntrl:]]* ]] || return 1
  [[ "$n" == *[$'\x80'-$'\xff']* ]] || return 0
  printf '%s' "$n" | python3 -I -c 'import sys; sys.stdin.buffer.read().decode("utf-8")' 2>/dev/null
}
_ws_loose_sha16() { local h; h=$(printf '%s' "${1-}" | _plat_sha256 | cut -d' ' -f1) && _WS_LOOSE_SHA="${h:0:16}" && [[ "$_WS_LOOSE_SHA" =~ ^[0-9a-f]{16}$ ]]; }

_ws_loose_class() {   # name -> 0 with _WS_LOOSE_CLASS = quarantine | refused | witnessed | registered | loose | absent;
  #                       2 unmeasured (_WS_LOOSE_WHY). The order of spec §2.4: a name that cannot be one, a link or a
  #                       special file, is the operator's; a witness or a registry row names the witnessed arm's entries
  local n="${1-}" p="$HOME/.cc-tmp/${1-}" f rc
  _WS_LOOSE_CLASS=''; _WS_LOOSE_WHY=''
  [[ "$n" != .ccd-quarantine ]] || { _WS_LOOSE_CLASS=quarantine; return 0; }
  _ws_loose_name_ok "$n" || { _WS_LOOSE_CLASS=refused; return 0; }
  [[ ! -L "$REG/tmproots" ]] || { _WS_LOOSE_WHY="$REG/tmproots is a link, which ccd never follows, so whether the entry is witnessed was never asked"; return 2; }
  for f in "tmproots/$n" "$n.child" "$n.uuid"; do
    _ws_reclaim_absent "$REG/$f"; rc=$?
    (( rc != 2 )) || { _WS_LOOSE_WHY="${_WS_ABSENT_WHY:-whether $REG/$f stands could not be asked}"; return 2; }
    (( rc != 1 )) || { [[ "$f" == tmproots/* ]] && _WS_LOOSE_CLASS=witnessed || _WS_LOOSE_CLASS=registered; return 0; }
  done
  _ws_loose_slug_held "$n"; rc=$?   # the listing control and the slug-free check: registry residue is a row's
  (( rc != 2 )) || return 2
  (( rc != 1 )) || { _WS_LOOSE_CLASS=registered; return 0; }
  [[ ! -L "$p" ]] || { _WS_LOOSE_CLASS=refused; return 0; }
  if [[ -d "$p" || -f "$p" ]]; then _WS_LOOSE_CLASS=loose; return 0; fi
  _ws_reclaim_absent "$p"; rc=$?
  (( rc != 2 )) || { _WS_LOOSE_WHY="${_WS_ABSENT_WHY:-whether the entry stands could not be asked}"; return 2; }
  if (( rc == 0 )); then _WS_LOOSE_CLASS=absent; else _WS_LOOSE_CLASS=refused; fi
}

_ws_loose_unmeasured_doc() {   # why -> the census' unmeasured answer, exit 1 (the server retries)
  printf '{"mode":"collect-census","truncated":false,"max":%s,"unmeasured":%s,"counts":{},"entries":[]}\n' "$WS_LOOSE_CENSUS_MAX" "$(_json_str "$1")"
  echo "ccd: ws-audit --collect-census measured nothing: $1 — retry" >&2; return 1
}
_ws_loose_census_records() {   # -> _WS_CREC_JSON (the records' rows) and _WS_CREC_BAD (unread ones, and any past the bound).
  #                                A killed verb's entry sits in the quarantine, which the listing does not walk: only its record names it
  local LC_ALL=C f n hex line seen=0
  _WS_CREC_JSON=''; _WS_CREC_BAD=0
  _ws_loose_records_of '*' || { _WS_CREC_BAD=1; return 0; }   # an unlistable directory is unmeasured, never empty
  for f in "${_WS_LOOSE_RECS[@]}"; do
    n="${f##*/}"
    if (( ++seen > WS_LOOSE_CENSUS_MAX )); then _WS_CREC_BAD=$(( _WS_CREC_BAD + 1 )); continue; fi
    { line=$(head -c 4096 -- "$f"); } 2>/dev/null; hex=''
    [[ "$line" =~ ^v=1\ name=([0-9a-f]+)\  ]] && hex="${BASH_REMATCH[1]}"
    if [[ -n "$hex" ]] && _ws_loose_record_read "$f" "$hex" && _ws_loose_unhex "$hex" && _ws_loose_sha16 "$hex" && [[ "$_WS_LOOSE_SHA" == "${n%%.*}" ]]; then
      _WS_CREC_JSON+="${_WS_CREC_JSON:+,}{\"hex\":\"$hex\",\"record\":\"$n\"}"
    else _WS_CREC_BAD=$(( _WS_CREC_BAD + 1 )); fi
  done
}
_ws_loose_census() {   # ccd ws-audit --collect-census — READ-ONLY: the top-level entries of `~/.cc-tmp`, classed, as hex
  local LC_ALL=C root outf errf err rc n name hex cls out='' first=1 seen=0 trunc=false
  local -A cnt=([quarantine]=0 [witnessed]=0 [registered]=0 [refused]=0 [loose]=0 [absent]=0)
  [[ "$CCD_OS" != darwin ]] || { _ws_loose_unmeasured_doc "the loose census runs on Linux only"; return; }
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the census safely"
  _ws_reclaim_absent "$HOME/.cc-tmp"; rc=$?
  (( rc != 2 )) || { _ws_loose_unmeasured_doc "${_WS_ABSENT_WHY:-whether ~/.cc-tmp stands could not be asked}"; return; }
  if (( rc == 0 )); then
    _ws_loose_census_records
    printf '{"mode":"collect-census","truncated":false,"max":%s,"counts":{"quarantine":0,"witnessed":0,"registered":0,"refused":0,"loose":0},"entries":[],"records":[%s],"recordsUnmeasured":%s}\n' "$WS_LOOSE_CENSUS_MAX" "$_WS_CREC_JSON" "$_WS_CREC_BAD"; return 0
  fi
  _ws_collect_qpath || { _ws_loose_unmeasured_doc "$_WS_QPATH_WHY"; return; }
  root="${_WS_QPATH%/.ccd-quarantine}"
  outf=$(_plat_mktemp) && errf=$(_plat_mktemp) || { _ws_loose_unmeasured_doc "could not make a scratch file to list $root"; return; }
  find -P "$root" -mindepth 1 -maxdepth 1 -print0 2>"$errf" | sort -z >"$outf"; rc=${PIPESTATUS[0]}
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  if (( rc != 0 )) || [[ -n "$err" ]]; then rm -f "$outf"; _ws_loose_unmeasured_doc "could not list $root (find exit $rc${err:+: ${err%%$'\n'*}})"; return; fi
  while IFS= read -r -d '' n; do
    name="${n#"$root"/}"
    if (( seen >= WS_LOOSE_CENSUS_MAX )); then trunc=true; break; fi
    seen=$(( seen + 1 ))
    _ws_loose_class "$name" || { rm -f "$outf"; _ws_loose_unmeasured_doc "$_WS_LOOSE_WHY"; return; }
    cls="$_WS_LOOSE_CLASS"; [[ "$cls" != absent ]] || cls=refused   # gone between the listing and the class: the operator's, never loose
    cnt[$cls]=$(( cnt[$cls] + 1 ))
    hex=$(_ws_loose_hex "$name")
    (( first )) || out+=','; first=0; out+="{\"hex\":\"$hex\",\"class\":\"$cls\"}"
  done < "$outf"
  rm -f "$outf"; _ws_loose_census_records
  printf '{"mode":"collect-census","truncated":%s,"max":%s,"counts":{"quarantine":%s,"witnessed":%s,"registered":%s,"refused":%s,"loose":%s},"entries":[%s],"records":[%s],"recordsUnmeasured":%s}\n' \
    "$trunc" "$WS_LOOSE_CENSUS_MAX" "${cnt[quarantine]}" "${cnt[witnessed]}" "${cnt[registered]}" "${cnt[refused]}" "${cnt[loose]}" "$out" "$_WS_CREC_JSON" "$_WS_CREC_BAD"
}

_ws_loose_ident() {   # path dev:ino btime type -> 0 path is that entry (an lstat: a link is never followed); 1 something
  #                      else stands there, or nothing does; 2 unmeasured, or path ends in `/`, `/.` or `/..`
  local p="${1-}" want="${2-}" bt="${3-}" ty="${4-}" have hbt rc
  case "$p" in */|*/.|*/..) return 2 ;; esac
  [[ ! -L "$p" ]] || return 1
  if [[ ! -e "$p" ]]; then _ws_reclaim_absent "$p"; rc=$?; (( rc == 0 )) && return 1; return 2; fi
  case "$ty" in d) [[ -d "$p" ]] || return 1 ;; f) [[ -f "$p" ]] || return 1 ;; *) return 2 ;; esac
  have=$(_plat_devino "$p" 2>/dev/null) && [[ "$have" =~ ^[0-9]+:[0-9]+$ ]] || return 2
  [[ "$have" == "$want" ]] || return 1
  [[ "$bt" == - ]] && return 0
  hbt=$(_plat_btime "$p" 2>/dev/null) && [[ "$hbt" =~ ^-?[0-9]+$ ]] || return 2
  [[ "$hbt" == "$bt" ]]
}

_ws_loose_idle() {   # path type -> 0 with _WS_IDLE_NEWEST_NS and _WS_IDLE_COUNT; 2 unmeasured (_WS_IDLE_WHY, _WS_IDLE_DETAIL).
  #                    A directory is the witnessed arm's walk; a regular file is its own ctime, whole seconds (one entry)
  local p="${1-}" c
  _WS_IDLE_NEWEST_NS=''; _WS_IDLE_COUNT=''; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''
  [[ "${2-}" == d ]] && { _ws_collect_idle "$p"; return; }
  c=$(_plat_ctime "$p" 2>/dev/null) && [[ "$c" =~ ^[1-9][0-9]{0,11}$ ]] \
    || { _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL="the change time of $p could not be read"; return 2; }
  _WS_IDLE_NEWEST_NS="${c}000000000"; _WS_IDLE_COUNT=1
}

_ws_loose_floor() {   # -> 0 with _WS_LOOSE_FLOOR (whole seconds) and _WS_LOOSE_PRESSURE (1 under _disk_pressure);
  #                      2 with _WS_FLOOR_WHY when the raise knob WS_COLLECT_LOOSE_FLOOR_S is set and not a whole number
  # max(base, knob): the knob only raises. The base is 48 h; under pressure on the box's own file system it is 24 h, never
  # lower: the witnessed arm's floor is the lowest any collector keeps (spec §2.5.3).
  local b="$WS_LOOSE_FLOOR_S" o="${WS_COLLECT_LOOSE_FLOOR_S-}"
  _WS_FLOOR_WHY=''; _WS_LOOSE_FLOOR=''; _WS_LOOSE_PRESSURE=0
  if _disk_pressure "$HOME/.cc-tmp"; then _WS_LOOSE_PRESSURE=1; b="$WS_LOOSE_PRESSURE_FLOOR_S"; fi
  if [[ -n "$o" ]]; then
    [[ "$o" =~ ^[0-9]+$ ]] || { _WS_FLOOR_WHY="WS_COLLECT_LOOSE_FLOOR_S is set and is not a whole number of seconds, so the raised floor it asks for was never read"; return 2; }
    [[ "$o" =~ ^0*([1-9][0-9]*)?$ ]]; o="${BASH_REMATCH[1]:-0}"
    if (( ${#o} > 9 )); then b=999999999; elif (( 10#$o > b )); then b=$(( 10#$o )); fi
  fi
  _WS_LOOSE_FLOOR="$b"
}

_ws_loose_registered() {   # name -> 0 when no witness and no `.child`/`.uuid` row names it; 1 when one does; 2 unmeasured
  local n="${1-}" f rc
  _WS_LOOSE_WHY=''
  for f in "tmproots/$n" "$n.child" "$n.uuid"; do
    _ws_reclaim_absent "$REG/$f"; rc=$?
    (( rc != 2 )) || { _WS_LOOSE_WHY="${_WS_ABSENT_WHY:-whether $REG/$f stands could not be asked}"; return 2; }
    (( rc != 1 )) || { _WS_LOOSE_WHY="$REG/$f stands — the entry is no longer loose"; return 1; }
  done
  _ws_loose_slug_held "$n"; rc=$?
  (( rc != 2 )) || return 2
  (( rc != 1 )) || return 1
  return 0
}
_ws_loose_slug_held() {   # name -> 0 free (or not slug-shaped); 1 a registry file of that id stands; 2 unmeasured (_WS_LOOSE_WHY).
  #                          `_ws_collect_prelock`'s listing control: the one name a wildcard of `$REG` must find is `tmproots`
  local n="${1-}" ctl=()
  _WS_LOOSE_WHY=''
  [[ "$n" == *-* ]] || return 0
  ctl=("$REG"/tmproot[s])
  [[ ${#ctl[@]} -eq 1 && "${ctl[0]}" == "$REG/tmproots" ]] || { _WS_LOOSE_WHY="$REG could not be listed as the witness directory is read, so whether a registry file names the entry was never asked"; return 2; }
  _ws_slug_free "${n%-*}" "${n##*-}" || { _WS_LOOSE_WHY="a registry file of the id $n stands — the entry is no longer loose"; return 1; }
}

_ws_loose_rows_file() {   # file -> 0 no registry row names it or a path below it; 1 one does; 2 unmeasured (_WS_LOOSE_WHY)
  #                            A standing regular file cannot be a session's workdir or hold one, so each row's spelling is
  #                            read against the file's own, as written and under the root's physical path; nothing is resolved.
  #                            (D-6858)
  local p="${1-}" root phys='' f o w rc held='' unread=''
  root="${p%/*}"; _ws_dir_physical "$root" && phys="${_WS_PHYS%/}/${p##*/}"
  [[ -n "$phys" ]] || { _WS_LOOSE_WHY="${_WS_PHYS_WHY:-the root of the entry could not be resolved}, so a row spelled by its physical path was never compared"; return 2; }
  f=$(find -P "$REG" -mindepth 1 -maxdepth 1 -name '*.workdir' ! -name '.*' 2>/dev/null) || { _WS_LOOSE_WHY="could not list $REG"; return 2; }
  while IFS= read -r o; do
    [[ -n "$o" ]] || continue
    o="${o##*/}"; o="${o%.workdir}"
    w=$(_reg_read "$o" workdir); rc=$?
    (( rc == 1 )) && continue   # gone between the listing and the read
    (( rc == 0 )) || { unread+="${unread:+, }$o"; continue; }
    [[ "$w" == "$p" || "$w" == "$p"/* || "$w" == "$phys" || "$w" == "$phys"/* ]] && held+="${held:+, }$o"
  done <<< "$f"
  [[ -z "$held" ]] || { _WS_LOOSE_WHY="registry row(s) lie at or through the entry — $held"; return 1; }
  [[ -z "$unread" ]] || { _WS_LOOSE_WHY="registry row(s) $unread could not be read, so whether one names the entry was never asked"; return 2; }
  return 0
}
_ws_loose_rows() {   # name path -> 0 no registry row lies at, inside or through path; 1 one does; 2 unmeasured (_WS_LOOSE_WHY)
  local n="${1-}" p="${2-}" rc
  _WS_LOOSE_WHY=''
  [[ ! -f "$p" || -L "$p" ]] || { _ws_loose_rows_file "$p"; return; }   # a file is no workdir: the shared rung resolves its path as one
  _ws_reclaim_workdir_shared "$n" "$p" keep-own; rc=$?   # a row named for the entry itself is not skipped as its own
  if (( rc == 0 )); then
    [[ -z "$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS" ]] && return 0
    _WS_LOOSE_WHY="registry row(s) lie at, inside or through the entry — at: ${_WS_SHARED_ROWS:-none}; inside: ${_WS_NESTED_ROWS:-none}; through: ${_WS_THROUGH_ROWS:-none}"
    return 1
  fi
  _WS_LOOSE_WHY="${_WS_SHARED_WHY:-the registry could not be compared with the entry}"; return 2
}

_ws_loose_rec_dir() { printf '%s' "$REG/tmpquarantine-loose"; }
_ws_loose_records_of() {   # sha|'*' -> 0 with _WS_LOOSE_RECS = every record of that entry's name (exact `<sha>.<ns>.<pid>`; '*' = any 16-hex sha); 2 unlistable
  local LC_ALL=C sha="${1-}" pat d outf errf err rc f
  _WS_LOOSE_RECS=(); _WS_LOOSE_WHY=''
  pat="$sha"; [[ "$sha" != '*' ]] || pat='[0-9a-f]{16}'
  d=$(_ws_loose_rec_dir)
  [[ ! -L "$d" ]] || { _WS_LOOSE_WHY="$d is a link, which ccd never follows, so the loose records were never listed"; return 2; }
  _ws_reclaim_absent "$d"; rc=$?
  (( rc != 0 )) || return 0
  (( rc != 2 )) || { _WS_LOOSE_WHY="${_WS_ABSENT_WHY:-whether $d stands could not be asked}"; return 2; }
  outf=$(_plat_mktemp) && errf=$(_plat_mktemp) || { _WS_LOOSE_WHY="could not make a scratch file to list $d"; return 2; }
  find -P "$d" -mindepth 1 -maxdepth 1 -name "$sha.*" -print0 >"$outf" 2>"$errf"; rc=$?
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  if (( rc != 0 )) || [[ -n "$err" ]]; then rm -f "$outf"; _WS_LOOSE_WHY="could not list $d (find exit $rc)"; return 2; fi
  while IFS= read -r -d '' f; do [[ "${f##*/}" =~ ^$pat\.[0-9]+\.[0-9]+$ ]] && _WS_LOOSE_RECS+=("$f"); done < "$outf"
  rm -f "$outf"
}
_ws_loose_record_write() {   # hex slot token -> 0 written and PROVEN by reading it back; 1 not written (_WS_LOOSE_WHY)
  local LC_ALL=C hex="${1-}" slot="${2-}" token="${3-}" dir name f tmp line
  _WS_LOOSE_WHY=''
  name="${slot##*/slot.loose.}"
  [[ "$slot" == /*/slot.loose.* && "$name" =~ ^[0-9a-f]{16}\.[0-9]+\.[0-9]+$ && "$token" =~ ^[0-9a-f]{64}$ ]] \
    || { _WS_LOOSE_WHY="$slot is not a loose quarantine slot, or the token is not one ccd mints, so no record was written"; return 1; }
  _ws_collect_pairs_ok "${_WS_LOOSE_ACCEPTED-}" || { _WS_LOOSE_WHY="the accepted checkouts are not a list ccd writes, so no record was written"; return 1; }
  line="v=1 name=$hex dev=$_WS_LOOSE_DEV ino=$_WS_LOOSE_INO btime=$_WS_LOOSE_BT type=$_WS_LOOSE_TYPE token=$token checkouts=${_WS_LOOSE_ACCEPTED-}"
  dir=$(_ws_loose_rec_dir)
  [[ ! -L "$dir" ]] || { _WS_LOOSE_WHY="$dir is a link, which is never followed, so no record was written"; return 1; }
  [[ -e "$dir" ]] || mkdir -m 0700 -- "$dir" 2>/dev/null || :
  [[ -d "$dir" && ! -L "$dir" ]] || { _WS_LOOSE_WHY="$dir could not be made a directory, so no record was written"; return 1; }
  f="$dir/$name"; tmp="$dir/.$name.$BASHPID.$RANDOM.tmp"
  [[ ! -e "$f" && ! -L "$f" ]] || { _WS_LOOSE_WHY="$f already stands — a record is never overwritten"; return 1; }
  { printf '%s\n' "$line" > "$tmp"; } 2>/dev/null && mv -f -- "$tmp" "$f" 2>/dev/null \
    || { rm -f -- "$tmp" 2>/dev/null; _WS_LOOSE_WHY="$f could not be written, so no record was written"; return 1; }
  if ! _ws_loose_record_read "$f" "$hex" || [[ "$_WS_LREC_TOKEN" != "$token" ]]; then
    rm -f -- "$f" 2>/dev/null; _WS_LOOSE_WHY="$f did not read back as it was written, so it was removed and nothing moves"; return 1
  fi
}
_ws_loose_record_read() {   # file hex -> 0 parsed (_WS_LREC_*); 1 absent, PROVEN; 2 malformed or not this entry's; 3 unmeasured
  local LC_ALL=C f="${1-}" hex="${2-}" name body line rc
  local -a m
  local re='^v=1 name=([0-9a-f]+) dev=([0-9]+) ino=([0-9]+) btime=(-|[1-9][0-9]*) type=([df]) token=([0-9a-f]{64}) checkouts=([^ ]*)$'
  _WS_LREC_DEV=''; _WS_LREC_INO=''; _WS_LREC_BT=''; _WS_LREC_TYPE=''; _WS_LREC_TOKEN=''; _WS_LREC_CO=''; _WS_LREC_SLOT=''; _WS_LOOSE_WHY=''
  name="${f##*/}"
  [[ "$name" =~ ^[0-9a-f]{16}\.[0-9]+\.[0-9]+$ && ! -L "${f%/*}" ]] || return 2
  _ws_reclaim_absent "$f"; rc=$?
  (( rc != 0 )) || return 1
  (( rc != 2 )) || { _WS_LOOSE_WHY="whether the loose record $f stands was never measured (${_WS_ABSENT_WHY-})"; return 3; }
  [[ -f "$f" && ! -L "$f" ]] || return 2
  { body=$(head -c 4096 -- "$f"); } 2>/dev/null || return 2
  line="${body%$'\n'}"
  [[ "$line" != *$'\n'* && "$line" =~ $re && "${BASH_REMATCH[1]}" == "$hex" ]] || return 2
  m=("${BASH_REMATCH[@]}")   # the pair check below runs a regex of its own
  _ws_collect_pairs_ok "${m[7]}" || return 2
  _WS_LREC_DEV="${m[2]}"; _WS_LREC_INO="${m[3]}"; _WS_LREC_BT="${m[4]}"; _WS_LREC_TYPE="${m[5]}"; _WS_LREC_TOKEN="${m[6]}"; _WS_LREC_CO="${m[7]}"
  _ws_collect_qpath || { _WS_LOOSE_WHY="$_WS_QPATH_WHY"; return 3; }
  _WS_LREC_SLOT="$_WS_QPATH/slot.loose.$name"
}
_ws_loose_unwind() {   # slot rec -> 0 when the slot, where it stands, was removed EMPTY and the record dropped; else 1
  local slot="${1-}" rec="${2-}" rc
  _ws_reclaim_absent "$slot"; rc=$?
  if (( rc == 1 )); then rmdir -- "$slot" 2>/dev/null || return 1; _ws_reclaim_absent "$slot" || return 1; elif (( rc == 2 )); then return 1; fi
  [[ "${rec%/*}" == "$(_ws_loose_rec_dir)" && ! -L "${rec%/*}" ]] || return 1
  rm -f -- "$rec" 2>/dev/null; _ws_reclaim_absent "$rec"
}

_ws_loose_eval() {   # name hex -> the FRESH rungs: REAP_VERDICT `collectable` (REAP_TOKEN), a word, or `unmeasured`.
  #                     The CALLER HOLDS `$REG/.collect-loose.lock`. Reads only.
  local name="${1-}" hex="${2-}" path="$HOME/.cc-tmp/${1-}" rc me mode owner floor now why=walk-failed dv
  _ws_loose_class "$name" || { _ws_collect_unmeasured registry "$_WS_LOOSE_WHY"; return 1; }
  [[ "$_WS_LOOSE_CLASS" == loose ]] || { _ws_collect_refuse not-loose "the entry is class $_WS_LOOSE_CLASS — only a loose entry is this arm's"; return 1; }
  _ws_collect_qcheck || { _ws_collect_unmeasured quarantine "$_WS_Q_WHY — no entry is licensed to move into it, and the next pass asks again"; return 1; }
  _ws_collect_slots_of "loose.$_WS_LOOSE_SHA" || { _ws_collect_unmeasured quarantine "$_WS_QSLOTS_WHY"; return 1; }
  (( ${#_WS_QSLOTS[@]} == 0 )) || { _ws_collect_refuse quarantine-kept "the quarantine slot ${_WS_QSLOTS[0]##*/} stands with no record naming it, and the entry is not collected beside it"; return 1; }
  _WS_LOOSE_TYPE=''
  [[ -d "$path" && ! -L "$path" ]] && _WS_LOOSE_TYPE=d
  [[ -f "$path" && ! -L "$path" ]] && _WS_LOOSE_TYPE=f
  [[ -n "$_WS_LOOSE_TYPE" ]] || { _ws_collect_refuse not-loose "the entry is neither a regular file nor a directory"; return 1; }
  me=$(id -u) && _WS_LOOSE_UID=$(_ws_leaf_uid "$path") || { _ws_collect_unmeasured identity "who owns the entry could not be read"; return 1; }
  [[ "$_WS_LOOSE_UID" == "$me" ]] || { _ws_collect_refuse not-loose "the entry belongs to uid $_WS_LOOSE_UID, not this uid $me — it is the operator's"; return 1; }
  dv=$(_plat_devino "$path" 2>/dev/null) && [[ "$dv" =~ ^[0-9]+:[0-9]+$ ]] || { _ws_collect_unmeasured identity "the device and inode of the entry could not be read"; return 1; }
  _WS_LOOSE_DEV="${dv%%:*}"; _WS_LOOSE_INO="${dv##*:}"
  _WS_LOOSE_BT=$(_plat_btime "$path" 2>/dev/null) && [[ "$_WS_LOOSE_BT" =~ ^[1-9][0-9]*$ ]] || _WS_LOOSE_BT=-
  if [[ "$_WS_LOOSE_TYPE" == d ]]; then
    mode=$(_plat_mode "$path" 2>/dev/null) && [[ "$mode" =~ ^[0-7]{1,4}$ ]] || { _ws_collect_unmeasured mode "the mode of the entry could not be read"; return 1; }
    owner="00$mode"; owner="${owner: -3:1}"
    (( (owner & 2) != 0 )) || { _ws_collect_unmeasured mode "the entry is mode $mode: without owner write it cannot be renamed into the quarantine, and the collector never changes a mode"; return 1; }
  fi
  _ws_loose_idle "$path" "$_WS_LOOSE_TYPE"; rc=$?
  if (( rc != 0 )) || [[ ! "${_WS_IDLE_NEWEST_NS-}" =~ ^[0-9]{1,19}$ || ! "${_WS_IDLE_COUNT-}" =~ ^[0-9]{1,9}$ ]]; then
    if (( rc != 0 )); then case "${_WS_IDLE_WHY-}" in timeout|unreadable|cap) why="$_WS_IDLE_WHY" ;; esac; fi
    _ws_collect_unmeasured "idle:$why" "the walk of the entry for its newest change did not finish ($why), so how long it has been idle is unknown"; return 1
  fi
  _WS_COLLECT_NEWEST_NS="$_WS_IDLE_NEWEST_NS"; _WS_COLLECT_ENTRIES="$_WS_IDLE_COUNT"
  _ws_loose_floor || { _ws_collect_unmeasured floor "${_WS_FLOOR_WHY:-the idle floor could not be read}, so how long the entry must stay idle is unknown"; return 1; }
  floor="$_WS_LOOSE_FLOOR"; _WS_COLLECT_FLOOR="$floor"
  _WS_COLLECT_IDLE_AT=$(( (10#$_WS_COLLECT_NEWEST_NS + floor * 1000000000 + 999999999) / 1000000000 ))
  now=$(_ws_collect_now_ns) && [[ "$now" =~ ^[1-9][0-9]{9,18}$ ]] || { _ws_collect_unmeasured clock "this box's clock could not be read"; return 1; }
  (( 10#$now - 10#$_WS_COLLECT_NEWEST_NS >= floor * 1000000000 )) \
    || { _ws_collect_refuse changed-recently "the newest change under the entry is less than ${floor}s old — it is collectable from epoch $_WS_COLLECT_IDLE_AT, if nothing changes it first"; return 1; }
  _ws_path_users "$path"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured in-use "${_WS_PATH_USERS_WHY-}"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse in-use "a process of this uid still uses the entry (pid ${_WS_PATH_USERS_PIDS-}: ${_WS_PATH_USERS_WHY-})"; return 1; }
  _WS_CHECKOUTS_ACCEPTED=''
  if [[ "$_WS_LOOSE_TYPE" == d ]]; then
    _ws_leaf_checkouts "$path"; rc=$?
    (( rc != 2 )) || { [[ -z "${_WS_CHECKOUTS_CAPPED-}" ]] || { _ws_collect_unmeasured checkouts-cap "${_WS_CHECKOUTS_WHY-}"; return 1; }; _ws_collect_unmeasured checkouts "${_WS_CHECKOUTS_WHY-}"; return 1; }
    (( rc != 1 )) || { _ws_collect_refuse containment-unproven "${_WS_CHECKOUTS_WHY-}"; return 1; }
  fi
  _WS_LOOSE_ACCEPTED="${_WS_CHECKOUTS_ACCEPTED-}"
  _ws_loose_rows "$name" "$path"; rc=$?
  (( rc != 2 )) || { _ws_collect_unmeasured rows "$_WS_LOOSE_WHY"; return 1; }
  (( rc != 1 )) || { _ws_collect_refuse containment-unproven "$_WS_LOOSE_WHY"; return 1; }
  _ws_collect_paused || return 1
  REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-loose "name=$hex" "dev=$_WS_LOOSE_DEV" "ino=$_WS_LOOSE_INO" "btime=$_WS_LOOSE_BT" \
    "type=$_WS_LOOSE_TYPE" "uid=$_WS_LOOSE_UID" "newestCtimeNs=$_WS_COLLECT_NEWEST_NS" "entries=$_WS_COLLECT_ENTRIES" "floor=$floor")
  [[ "$REAP_TOKEN" =~ ^[0-9a-f]{64}$ ]] || { REAP_TOKEN=''; _ws_collect_unmeasured token "the loose collection token could not be minted"; return 1; }
  REAP_VERDICT=collectable
}

_ws_loose_resume_eval() {   # name hex rec -> a RESUME from the record: `collectable` with a token binding the record and the
  #                            phase read off the disk (moved | unmoved | removed), else a word. Reads only; never the floor
  local name="${1-}" hex="${2-}" rec="${3-}" rc sl orig q
  _WS_LOOSE_PHASE=''; _WS_LOOSE_RECORD="$rec"
  _ws_loose_record_read "$rec" "$hex"; rc=$?
  (( rc != 3 )) || { _ws_collect_unmeasured records "$_WS_LOOSE_WHY"; return 1; }
  (( rc == 0 )) || { _ws_collect_refuse quarantine-kept "the loose record ${rec##*/} is kept for the operator: it is gone or not one ccd wrote for this entry"; return 1; }
  sl="$_WS_LREC_SLOT/leaf"; q="${_WS_LREC_SLOT%/*}"; orig="${q%/.ccd-quarantine}/$name"
  _ws_loose_ident "$sl" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" "$_WS_LREC_TYPE"; rc=$?
  if (( rc == 0 )); then _WS_LOOSE_PHASE=moved
  elif (( rc == 2 )); then _ws_collect_unmeasured identity "the identity of the slot's leaf could not be read"; return 1
  else
    _ws_reclaim_absent "$sl"; rc=$?
    (( rc != 2 )) || { _ws_collect_unmeasured leaf "${_WS_ABSENT_WHY-}"; return 1; }
    (( rc == 0 )) || { _ws_collect_refuse quarantine-kept "the slot's leaf is not the entry record ${rec##*/} names — it is the operator's"; return 1; }
    _ws_loose_ident "$orig" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" "$_WS_LREC_TYPE"; rc=$?
    (( rc != 2 )) || { _ws_collect_unmeasured identity "the identity of the entry could not be read"; return 1; }
    if (( rc == 0 )); then _WS_LOOSE_PHASE=unmoved; else _WS_LOOSE_PHASE=removed; fi
  fi
  REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-loose-resume "name=$hex" "record=${rec##*/}" "phase=$_WS_LOOSE_PHASE" \
    "dev=$_WS_LREC_DEV" "ino=$_WS_LREC_INO" "btime=$_WS_LREC_BT" "type=$_WS_LREC_TYPE" "token=$_WS_LREC_TOKEN")
  [[ "$REAP_TOKEN" =~ ^[0-9a-f]{64}$ ]] || { REAP_TOKEN=''; _ws_collect_unmeasured token "the loose resume token could not be minted"; return 1; }
  REAP_VERDICT=collectable
}

_ws_loose_fork() {   # name hex -> the ONE evaluation `ws-audit --loose-hex … --collect` and `ws-collect --loose-hex` share: a
  #                     standing record RESUMES, else the fresh rungs. The CALLER HOLDS `$REG/.collect-loose.lock`.
  local name="${1-}" hex="${2-}"
  _ws_collect_reset; _WS_LOOSE_RECORD=''; _WS_LOOSE_PHASE=''; _WS_LOOSE_CLASS=''
  _ws_loose_records_of "$_WS_LOOSE_SHA" || { _ws_collect_unmeasured records "$_WS_LOOSE_WHY"; return 1; }
  if (( ${#_WS_LOOSE_RECS[@]} == 1 )); then _ws_loose_resume_eval "$name" "$hex" "${_WS_LOOSE_RECS[0]}"
  elif (( ${#_WS_LOOSE_RECS[@]} > 1 )); then _ws_collect_refuse quarantine-kept "${#_WS_LOOSE_RECS[@]} loose records name the entry — they are the operator's"
  else _ws_loose_eval "$name" "$hex"; fi
}

_ws_loose_audit() { _ws_reclaim_contained _ws_loose_audit_contained "$@"; }   # hex -> ONE JSON document; exit 1 on `unmeasured`
_ws_loose_audit_contained() {
  local hex="${1-}" name lfd rc=0
  _ws_loose_unhex "$hex" || die "bad loose hex"
  name="$_WS_LOOSE_NAME"
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the audit record safely"
  _ws_collect_reset; _WS_LOOSE_RECS=(); _WS_LOOSE_CLASS=''; _WS_LOOSE_PHASE=''; _WS_LOOSE_RECORD=''; _WS_LOOSE_PRESSURE=0; _WS_LOOSE_TYPE=''; _WS_LOOSE_UID=''
  _ws_loose_sha16 "$hex" || die "bad loose hex"
  if [[ "$CCD_OS" == darwin ]]; then _ws_collect_unmeasured platform "the loose arm runs on Linux only"
  elif ! _ws_collect_mv_ok; then _ws_collect_unmeasured mv "this box's mv has no --no-copy, so the move could only ever be a copy"
  elif ! command -v flock >/dev/null 2>&1; then _ws_collect_unmeasured flock "flock (util-linux) is unavailable"
  elif ! { exec {lfd}>>"$REG/.collect-loose.lock"; } 2>/dev/null; then _ws_collect_unmeasured lock "cannot open $REG/.collect-loose.lock"
  elif ! flock -n "$lfd"; then exec {lfd}>&-; _ws_collect_refuse in-progress "another ccd process holds the loose collect lock" || :
  else _ws_loose_fork "$name" "$hex" || :; exec {lfd}>&-; fi
  _ws_loose_audit_doc "$name" "$hex"
}
_ws_loose_audit_doc() {   # name hex -> THE document on stdout; rc 1 on `unmeasured`, else 0
  local name="${1-}" hex="${2-}" path="$HOME/.cc-tmp/${1-}" newest=null entries=null idleat=null probe=null floor=null recs='[' r first=1 cls=null ty=null uid=null
  [[ -n "$REAP_VERDICT" ]] || _ws_collect_unmeasured eval "the evaluation answered nothing" || :
  for r in ${_WS_LOOSE_RECS[@]+"${_WS_LOOSE_RECS[@]}"}; do (( first )) || recs+=','; first=0; recs+="$(_json_str "${r##*/}")"; done; recs+=']'
  [[ -z "$_WS_COLLECT_NEWEST_NS" ]] || newest=$(_json_str "$_WS_COLLECT_NEWEST_NS")
  [[ -z "$_WS_COLLECT_ENTRIES" ]] || entries="$_WS_COLLECT_ENTRIES"
  [[ -z "$_WS_COLLECT_IDLE_AT" ]] || idleat="$_WS_COLLECT_IDLE_AT"
  [[ -z "$_WS_COLLECT_PROBE" ]] || probe=$(_json_str "$_WS_COLLECT_PROBE")
  [[ -z "$_WS_COLLECT_FLOOR" ]] || floor="$_WS_COLLECT_FLOOR"
  [[ -z "$_WS_LOOSE_CLASS" ]] || cls=$(_json_str "$_WS_LOOSE_CLASS")
  [[ -z "$_WS_LOOSE_TYPE" ]] || ty=$(_json_str "$_WS_LOOSE_TYPE")
  [[ ! "$_WS_LOOSE_UID" =~ ^[0-9]+$ ]] || uid="$_WS_LOOSE_UID"
  printf '{"mode":"collect-loose","name":%s,"collect":{"class":%s,"type":%s,"uid":%s,"records":%s,"newestCtimeNs":%s,"entries":%s,"floorS":%s,"pressure":%s,"idleAt":%s,"unmeasured":%s},' \
    "$(_json_str "$hex")" "$cls" "$ty" "$uid" "$recs" "$newest" "$entries" "$floor" "$( ((_WS_LOOSE_PRESSURE)) && echo true || echo false )" "$idleat" "$probe"
  [[ -z "$_WS_LOOSE_PHASE" ]] || printf '"resume":%s,' "$(_json_str "$_WS_LOOSE_PHASE")"
  if [[ "$REAP_VERDICT" == collectable ]]; then printf '"verdict":%s,"detail":"","token":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_TOKEN")"; return 0; fi
  printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$(_ws_leaf_why_line "$REAP_DETAIL")")"
  [[ "$REAP_VERDICT" != unmeasured ]] || { echo "ccd: ws-audit --loose-hex --collect measured nothing ($_WS_COLLECT_PROBE): $REAP_DETAIL — retry" >&2; return 1; }
  return 0
}

_ws_loose_route() {   # args of `ws-audit` that are not `--session …` -> runs the loose census or audit; 99 when they are neither.
  #                      cmd_ws_audit sits above the frozen citation corpus, so its one hand-off is on its usage line
  case "$#:${1-}:${3-}" in
    1:--collect-census:) _ws_loose_census ;;
    3:--loose-hex:--collect) _ws_loose_audit "$2" ;;
    *) return 99 ;;
  esac
}

_ws_loose_move() {   # src dst dev:ino btime type -> 0 PROVEN moved (dst is that entry, nothing at src); 1 PROVEN not moved;
  #                     2 unmeasured (_WS_MOVE_WHY), and 2 with nothing renamed when src is not PROVEN that entry first
  local src="${1-}" dst="${2-}" want="${3-}" bt="${4-}" ty="${5-}" err mrc a b
  _WS_MOVE_WHY=''
  _ws_loose_ident "$src" "$want" "$bt" "$ty"; a=$?
  (( a == 0 )) || { _WS_MOVE_WHY="the source is not PROVEN the entry $want (identity answer $a), so nothing was renamed"; return 2; }
  _ws_collect_mv_ok || { _WS_MOVE_WHY="this box has no 'mv --no-copy' (or is Darwin), so nothing was renamed"; return 2; }
  err=$(_ws_collect_mv "$src" "$dst" 2>&1); mrc=$?
  _ws_loose_ident "$dst" "$want" "$bt" "$ty"; a=$?
  if (( a == 0 )); then
    _ws_reclaim_absent "$src"; b=$?
    (( b != 0 )) || return 0
    _WS_MOVE_WHY="the destination is $want, but ${_WS_ABSENT_WHY:-something stands at the source again} — the move is not proven"; return 2
  fi
  _ws_loose_ident "$src" "$want" "$bt" "$ty"; b=$?
  (( b != 0 )) || { _WS_MOVE_WHY="the entry was not moved (mv exit $mrc${err:+: ${err%%$'\n'*}})"; return 1; }
  _WS_MOVE_WHY="neither the destination nor the source is the entry $want after the rename (mv exit $mrc${err:+: ${err%%$'\n'*}})"; return 2
}

_ws_loose_reprove() {   # name hex orig slotleaf dev:ino btime type -> 0 every proof after the move holds; 1 a doubt
  #                        (_WS_REPROVE_WORD, _WS_REPROVE_WHY); 2 one could not be asked; 3 the slot's leaf is PROVEN gone
  local name="${1-}" orig="${3-}" sl="${4-}" want="${5-}" bt="${6-}" ty="${7-}" rc s
  _WS_REPROVE_WORD=''; _WS_REPROVE_WHY=''
  _ws_loose_registered "$name"; rc=$?
  (( rc != 1 )) || { _WS_REPROVE_WORD=registered; _WS_REPROVE_WHY="$_WS_LOOSE_WHY"; return 1; }
  (( rc != 2 )) || { _WS_REPROVE_WHY="$_WS_LOOSE_WHY"; return 2; }
  for s in "$orig" "$sl"; do   # a cwd or an open file follows a rename, so both spellings are asked
    _ws_path_users "$s"; rc=$?
    (( rc != 1 )) || { _WS_REPROVE_WORD=in-use; _WS_REPROVE_WHY="$_WS_PATH_USERS_WHY"; return 1; }
    (( rc != 2 )) || { _WS_REPROVE_WHY="$_WS_PATH_USERS_WHY"; return 2; }
  done
  _ws_loose_rows "$name" "$orig"; rc=$?
  (( rc != 1 )) || { _WS_REPROVE_WORD=containment-unproven; _WS_REPROVE_WHY="$_WS_LOOSE_WHY"; return 1; }
  (( rc != 2 )) || { _WS_REPROVE_WHY="$_WS_LOOSE_WHY"; return 2; }
  if [[ "$ty" == d ]]; then _ws_collect_mounts_clear "$sl" || { _WS_REPROVE_WHY="$_WS_MOUNTS_WHY"; return 2; }; fi
  _ws_loose_ident "$sl" "$want" "$bt" "$ty"; rc=$?
  (( rc != 0 )) || return 0
  (( rc != 2 )) || { _WS_REPROVE_WHY="the identity of the slot's leaf could not be read"; return 2; }
  _ws_reclaim_absent "$sl"; rc=$?
  (( rc != 0 )) || { _WS_REPROVE_WHY="the entry vanished from its slot, so there is nothing there to move back or remove"; return 3; }
  (( rc != 2 )) || { _WS_REPROVE_WHY="${_WS_ABSENT_WHY-}"; return 2; }
  _WS_REPROVE_WORD=quarantine-kept; _WS_REPROVE_WHY="the slot's leaf is not the recorded entry $want: something else stands in the slot"; return 1
}

_ws_loose_putback() {   # jid slot rec orig lctx why surface actor reason -> 0 the entry is back at orig, PROVEN, the slot and the record
  #                        cleared; 2 refused and printed (the slot's leaf is not the record's entry, or orig was taken again); 1 else
  local jid="${1-}" slot="${2-}" rec="${3-}" orig="${4-}" lctx="${5-}" why="${6-}" irc arc mrc=0
  _ws_collect_gap restoring "$jid" "$slot"
  _ws_loose_ident "$slot/leaf" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" "$_WS_LREC_TYPE"; irc=$?
  if (( irc == 1 )); then
    _ws_reclaim_absent "$slot/leaf"; arc=$?
    if (( arc == 1 )); then
      _ws_collect_refused "$jid" "$lctx" quarantine-kept "kept in its slot with the loose record ${rec##*/}, for the operator, and nothing was moved back or removed: the slot's leaf is not the recorded entry, after: $why" "$7" "$8" "$9"
      return 2
    fi
    if (( arc == 0 )); then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "the record and its slot stand: the entry vanished from its slot before it could go back, after: $why")"; return 1; fi
  fi
  _ws_loose_move "$slot/leaf" "$orig" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" "$_WS_LREC_TYPE"; mrc=$?
  if (( mrc == 0 )); then
    _ws_loose_unwind "$slot" "$rec" && return 0
    _ws_collect_keep "$jid" "$rec" "$lctx" "the entry is back at its place, but its slot or its record could not be cleared after: $why"; return 1
  fi
  if (( mrc == 1 )); then
    _ws_reclaim_absent "$orig" || :
    if [[ -e "$orig" || -L "$orig" ]]; then
      _ws_collect_refused "$jid" "$lctx" quarantine-kept "kept in its slot with the loose record ${rec##*/}, for the operator, and nothing was removed: the entry's place was taken again since the move, after: $why" "$7" "$8" "$9"
      return 2
    fi
  fi
  _ws_collect_keep "$jid" "$rec" "$lctx" "what the slot holds could not be proven back at its place, after: $why${_WS_MOVE_WHY:+ ($_WS_MOVE_WHY)}"; return 1
}

_ws_loose_finish() {   # jid hex rec slot lctx resumed -> the order from the entry's absence to the record's drop; 0 done | 1 kept
  local jid="${1-}" hex="${2-}" rec="${3-}" slot="${4-}" lctx="${5-}" resumed="${6-}" rc
  _ws_reclaim_absent "$slot/leaf"; rc=$?
  (( rc == 0 )) || { _ws_collect_keep "$jid" "$rec" "$lctx" "the slot's leaf is not proven gone${_WS_ABSENT_WHY:+ ($_WS_ABSENT_WHY)}"; return 1; }
  _ws_reclaim_absent "$slot"; rc=$?
  if (( rc == 1 )); then rmdir -- "$slot" 2>/dev/null || :; _ws_reclaim_absent "$slot"; rc=$?; fi
  (( rc == 0 )) || { _ws_collect_keep "$jid" "$rec" "$lctx" "the slot could not be removed empty: it holds something this verb did not put there ($slot)"; return 1; }
  _ws_collect_gap emptied "$jid" "$slot"
  [[ "${rec%/*}" == "$(_ws_loose_rec_dir)" ]] && rm -f -- "$rec" 2>/dev/null && _ws_reclaim_absent "$rec" \
    || { _ws_collect_keep "$jid" "$rec" "$lctx" "the entry is gone, but its record could not be dropped"; return 1; }
  _ws_collect_gap dropped "$jid" "$slot"
  _lc_done collect "$jid" "$lctx" verb ws-collect meas.resumed "$resumed" meas.leaf removed detail "$(_ws_leaf_why_line "collected loose entry $hex via ${slot##*/} (record ${rec##*/})")"
  printf '{"collected":%s,"record":%s,"resumed":%s,"loose":true}\n' "$(_json_str "$hex")" "$(_json_str "${rec##*/}")" "$( [[ -n "$resumed" ]] && echo true || echo false )"
}

_ws_loose_after_move() {   # jid name hex rec orig lctx resumed surface actor reason -> steps 5 and 6, then the order to the end
  local jid="${1-}" name="${2-}" hex="${3-}" rec="${4-}" orig="${5-}" lctx="${6-}" resumed="${7-}" surface="${8-}" actor="${9-}" reason="${10-}" rc prc slot
  _ws_loose_record_read "$rec" "$hex"; rc=$?
  if (( rc == 3 )); then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "the record and its slot stand, and nothing was moved back or removed: ${_WS_LOOSE_WHY-}")"; return 1; fi
  if (( rc == 1 )); then _ws_reclaim_fail "$jid" "$lctx" quarantine-kept "the entry stays in its slot, for the operator: its loose record vanished after the move"; return 1; fi
  (( rc == 0 )) || { _ws_collect_keep "$jid" "$rec" "$lctx" "the loose record could not be read back after the move"; return 1; }
  slot="$_WS_LREC_SLOT"
  _ws_loose_reprove "$name" "$hex" "$orig" "$slot/leaf" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" "$_WS_LREC_TYPE"; rc=$?
  if (( rc == 3 )); then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "the record and its slot stand, and nothing was moved back or removed: $_WS_REPROVE_WHY")"; return 1; fi
  if (( rc != 0 )); then
    local why="$_WS_REPROVE_WHY" word="$_WS_REPROVE_WORD"
    if (( rc == 1 )) && [[ "$word" == quarantine-kept ]]; then
      _ws_collect_refused "$jid" "$lctx" quarantine-kept "kept in its slot with the loose record ${rec##*/}, for the operator, and nothing was moved back or removed: $why" "$surface" "$actor" "$reason"; return 0
    fi
    _ws_loose_putback "$jid" "$slot" "$rec" "$orig" "$lctx" "$why" "$surface" "$actor" "$reason"; prc=$?
    (( prc != 2 )) || return 0
    (( prc == 0 )) || return 1
    if (( rc == 2 )); then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "the entry was moved back and nothing was removed: $why")"; return 1; fi
    _ws_collect_refused "$jid" "$lctx" "$word" "the entry was moved back and nothing was removed: $why" "$surface" "$actor" "$reason"; return 0
  fi
  _ws_collect_gap proven "$jid" "$slot"
  if [[ "$_WS_LREC_TYPE" == d ]]; then
    _ws_leaf_remove "$slot" leaf "$_WS_LREC_DEV:$_WS_LREC_INO" "$orig" "$_WS_LREC_CO"; rc=$?
  else   # a regular file is unlinked, never followed, and only while it is still the recorded one
    _ws_loose_ident "$slot/leaf" "$_WS_LREC_DEV:$_WS_LREC_INO" "$_WS_LREC_BT" f
    case $? in
      0) rm -f -- "$slot/leaf" 2>/dev/null; _ws_reclaim_absent "$slot/leaf"; rc=$?; (( rc == 0 )) || { _WS_LEAF_WHY="the file could not be unlinked"; rc=2; } ;;
      1) _WS_LEAF_WHY="the slot's leaf is not the recorded file"; rc=1 ;;
      *) _WS_LEAF_WHY="the identity of the slot's file could not be read"; rc=2 ;;
    esac
  fi
  case "$rc" in
    0) : ;;
    1) _ws_loose_putback "$jid" "$slot" "$rec" "$orig" "$lctx" "${_WS_LEAF_WHY-}" "$surface" "$actor" "$reason"; prc=$?
       (( prc != 2 )) || return 0
       (( prc == 0 )) || return 1
       _ws_collect_refused "$jid" "$lctx" containment-unproven "the entry was moved back and nothing was removed: ${_WS_LEAF_WHY-}" "$surface" "$actor" "$reason"; return 0 ;;
    *) _ws_collect_keep "$jid" "$rec" "$lctx" "${_WS_LEAF_WHY-}"; return 1 ;;
  esac
  _ws_collect_gap removed "$jid" "$slot"
  _ws_loose_finish "$jid" "$hex" "$rec" "$slot" "$lctx" "$resumed"
}

_ws_loose_fresh() {   # jid name hex q orig lctx surface actor reason -> steps 2 to 4 of a fresh collection, then the rest
  local jid="${1-}" name="${2-}" hex="${3-}" q="${4-}" orig="${5-}" lctx="${6-}" surface="${7-}" actor="${8-}" reason="${9-}" rc slot rec rname dropped why
  _ws_loose_ident "$orig" "$_WS_LOOSE_DEV:$_WS_LOOSE_INO" "$_WS_LOOSE_BT" "$_WS_LOOSE_TYPE"; rc=$?
  if (( rc == 1 )); then _ws_collect_refused "$jid" "" state-changed "nothing was moved: the entry the evaluation saw in this lock is gone or is another" "$surface" "$actor" "$reason"; return 0; fi
  (( rc == 0 )) || { _ws_reclaim_fail "$jid" "" probe-unmeasured "nothing was moved: the identity of the entry could not be read"; return 1; }
  _WS_CHECKOUTS_ACCEPTED=''
  if [[ "$_WS_LOOSE_TYPE" == d ]]; then
    _ws_leaf_checkouts "$orig"; rc=$?
    (( rc != 1 )) || { _ws_collect_refused "$jid" "" containment-unproven "nothing was moved: ${_WS_CHECKOUTS_WHY-}" "$surface" "$actor" "$reason"; return 0; }
    (( rc == 0 )) || { _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved: ${_WS_CHECKOUTS_WHY-}")"; return 1; }
  fi
  _WS_LOOSE_ACCEPTED="${_WS_CHECKOUTS_ACCEPTED-}"
  _ws_collect_slot_path "$q" "loose.$_WS_LOOSE_SHA" \
    || { _ws_reclaim_fail "$jid" "" probe-unmeasured "nothing was moved: no quarantine slot could be named (the clock could not be used)"; return 1; }
  slot="$_WS_SLOT"; rname="${slot##*/slot.loose.}"; rec="$(_ws_loose_rec_dir)/$rname"
  _ws_loose_record_write "$hex" "$slot" "$REAP_TOKEN" \
    || { _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved: the loose record could not be written (${_WS_LOOSE_WHY-})")"; return 1; }
  _ws_collect_gap recorded "$jid" "$slot"
  _ws_collect_slot_make "$slot"; rc=$?
  if (( rc != 0 )); then
    why="${_WS_SLOT_WHY:-the quarantine slot could not be made}"
    if rm -f -- "$rec" 2>/dev/null && _ws_reclaim_absent "$rec"; then dropped='and the record was dropped'; else dropped='and the record could not be dropped: the next pass clears it'; fi
    _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved, $dropped: $why")"; return 1
  fi
  _ws_collect_gap slotted "$jid" "$slot"
  _lc_intent collect "$jid" "$lctx" verb ws-collect detail "$(_ws_leaf_why_line "loose record $rname: moving the entry into ${slot##*/}/leaf")" dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  _ws_loose_move "$orig" "$slot/leaf" "$_WS_LOOSE_DEV:$_WS_LOOSE_INO" "$_WS_LOOSE_BT" "$_WS_LOOSE_TYPE"; rc=$?
  why="${_WS_MOVE_WHY-}"
  case "$rc" in
    0) : ;;
    1) if _ws_loose_unwind "$slot" "$rec"; then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved, and the slot and the record were cleared: the move was not proven ($why)")"
       else _ws_collect_keep "$jid" "$rec" "$lctx" "the move was not proven, and its slot or its record could not be cleared ($why)"; fi
       return 1 ;;
    *) _ws_reclaim_absent "$slot/leaf"; rc=$?
       if (( rc == 1 )); then _ws_collect_refused "$jid" "$lctx" quarantine-kept "kept in its slot with its record, for the operator, and nothing was moved back or removed: what reached the slot is not proven the entry ($why)" "$surface" "$actor" "$reason"; return 0; fi
       if (( rc == 0 )) && _ws_loose_unwind "$slot" "$rec"; then _ws_reclaim_fail "$jid" "$lctx" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved, and the empty slot and the record were cleared: the move was not proven ($why)")"; return 1; fi
       _ws_collect_keep "$jid" "$rec" "$lctx" "the move was not proven, and whether anything reached its slot could not be asked ($why)"; return 1 ;;
  esac
  _ws_collect_gap moved "$jid" "$slot"
  _ws_loose_after_move "$jid" "$name" "$hex" "$rec" "$orig" "$lctx" "" "$surface" "$actor" "$reason"
}

_ws_loose_resume() {   # jid name hex rec orig lctx surface actor reason -> resume FROM the record, at the phase the evaluation read
  local jid="${1-}" name="${2-}" hex="${3-}" rec="${4-}" orig="${5-}" lctx="${6-}" surface="${7-}" actor="${8-}" reason="${9-}" rname rc slot
  rname="${rec##*/}"
  _ws_loose_record_read "$rec" "$hex"; rc=$?
  if (( rc == 1 )); then _ws_collect_refused "$jid" "" state-changed "nothing was moved or removed, and the next audit reads the entry afresh: record $rname vanished before this verb read it" "$surface" "$actor" "$reason"; return 0; fi
  if (( rc == 3 )); then _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "the record and its slot stand: ${_WS_LOOSE_WHY-}")"; return 1; fi
  (( rc == 0 )) || { _ws_collect_refused "$jid" "" quarantine-kept "kept as it stands, for the operator: record $rname is not a loose record this verb wrote for the entry" "$surface" "$actor" "$reason"; return 0; }
  slot="$_WS_LREC_SLOT"
  _lc_intent collect "$jid" "$lctx" verb ws-collect meas.resumed "$rname" detail "$(_ws_leaf_why_line "resuming loose record $rname at ${_WS_LOOSE_PHASE-}")" dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  case "${_WS_LOOSE_PHASE-}" in
    moved) _ws_collect_gap moved "$jid" "$slot"; _ws_loose_after_move "$jid" "$name" "$hex" "$rec" "$orig" "$lctx" "$rname" "$surface" "$actor" "$reason"; return ;;
    unmoved)
      if _ws_loose_unwind "$slot" "$rec"; then
        _ws_collect_refused "$jid" "$lctx" state-changed "nothing was removed, the slot and the record were cleared: record $rname described a collection whose move never happened or was undone" "$surface" "$actor" "$reason"; return 0
      fi
      _ws_collect_keep "$jid" "$rec" "$lctx" "the entry never left its place, but its slot or the record could not be cleared"; return 1 ;;
    removed) _ws_loose_finish "$jid" "$hex" "$rec" "$slot" "$lctx" "$rname"; return ;;
  esac
  _ws_reclaim_fail "$jid" "" probe-unmeasured "nothing was moved or removed: the evaluation named no phase this verb acts on for record $rname"; return 1
}

_ws_loose_locked() {   # token hex surface actor reason -> everything the loose lock serialises
  local token="${1-}" hex="${2-}" surface="${3-}" actor="${4-}" reason="${5-}" name q rroot orig lctx jid
  name="$_WS_LOOSE_NAME"; jid="loose-$_WS_LOOSE_SHA"
  _ws_collect_gap locked "$jid"
  if ! _ws_collect_paused; then _ws_collect_refused "$jid" "" paused "nothing was moved or removed: ${REAP_DETAIL-}" "$surface" "$actor" "$reason"; return 0; fi
  _ws_loose_fork "$name" "$hex"
  [[ -n "${REAP_VERDICT-}" ]] || { REAP_VERDICT=unmeasured; REAP_DETAIL="the loose evaluation answered no verdict"; }
  if [[ "$REAP_VERDICT" == collectable && "$token" != "${REAP_TOKEN-}" ]]; then
    REAP_VERDICT=state-changed; REAP_DETAIL="nothing was moved: the entry changed since the audit that minted the token (expected ${REAP_TOKEN-}, was given $token)"
  fi
  if [[ "$REAP_VERDICT" == unmeasured ]]; then _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "${REAP_DETAIL-}")"; return 1; fi
  if [[ "$REAP_VERDICT" != collectable ]]; then _ws_collect_refused "$jid" "" "$REAP_VERDICT" "${REAP_DETAIL-}" "$surface" "$actor" "$reason"; return 0; fi
  _ws_collect_gap consented "$jid"
  _ws_collect_mv_ok || { _ws_reclaim_fail "$jid" "" probe-unmeasured "nothing was moved: the collector moves only by a rename that never copies, and this box cannot"; return 1; }
  if ! _ws_collect_qdir || [[ "${_WS_Q-}" != /?*/.ccd-quarantine ]]; then
    _ws_reclaim_fail "$jid" "" probe-unmeasured "$(_ws_leaf_why_line "nothing was moved: ${_WS_Q_WHY:-the quarantine directory is not <physical ~/.cc-tmp>/.ccd-quarantine}")"; return 1
  fi
  q="$_WS_Q"; rroot="${q%/.ccd-quarantine}"; orig="$rroot/$name"; lctx=$(_lc_tx)
  if [[ -n "${_WS_LOOSE_RECORD-}" ]]; then _ws_loose_resume "$jid" "$name" "$hex" "$_WS_LOOSE_RECORD" "$orig" "$lctx" "$surface" "$actor" "$reason"
  else _ws_loose_fresh "$jid" "$name" "$hex" "$q" "$orig" "$lctx" "$surface" "$actor" "$reason"; fi
}

_ws_loose_collect() {   # token hex surface actor reason -> ccd ws-collect --expect <token> --loose-hex <hex>: ONE JSON line
  local token="${1-}" hex="${2-}" surface="${3-}" actor="${4-}" reason="${5-}" lfd rc=0 jid
  local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || die "bad token"
  _ws_loose_unhex "$hex" || die "bad loose hex"
  _ws_loose_sha16 "$hex" || die "bad loose hex"
  jid="loose-$_WS_LOOSE_SHA"
  _json_str probe >/dev/null 2>&1 || die "python3 unavailable — cannot quote the collection record safely"
  command -v flock >/dev/null 2>&1 || _lc_refuse collect "$jid" flock-unavailable "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  exec {lfd}>>"$REG/.collect-loose.lock" || _lc_refuse collect "$jid" lock-unopenable "cannot open the loose collect lock at $REG/.collect-loose.lock"
  flock -n "$lfd" || {
    _lc_emit collect refused "$jid" "" verb ws-collect refusal in-progress detail "another ccd process is collecting a loose entry and still holds the lock"
    exec {lfd}>&-
    printf '{"refused":"in-progress","detail":%s,"paths":[]}\n' "$(_json_str "another ccd process is collecting a loose entry and still holds the lock")"
    return 0
  }
  _ws_reclaim_contained _ws_loose_locked "$token" "$hex" "$surface" "$actor" "$reason"; rc=$?
  exec {lfd}>&-
  return "$rc"
}
# COLLECT-LOOSE-V1. `cmd_caps` echoes `collect-loose-v1` beside `collect-v1`: this box has `ws-audit --collect-census`,
# `ws-audit --loose-hex <hex> --collect`, `ws-collect --expect <token> --loose-hex <hex>` and the record family under
# `$REG/tmpquarantine-loose/`, in one ccd inode. The server composes them only behind that word (D-6625).
# ── end loose temp entries ───────────────────────────────────────────────────── LOOSE-END ──
