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

# The directory of a lane's model files (the models writer's one home, `~/.ccrc/models/`; ccd/ccd names no models path itself).
MODEL_ALIASES_DIR="$HOME/.ccrc/models"

# THE ONE JQ PROGRAM of both readers: it answers every class of a wrapper at once, one `<class> <answer>` line each, so a tick
# that asks four classes forks once. `$mode` picks the Anthropic arm (`aliases`: the aliases and advance files) or the Codex arm
# (`codex`: the registry and the catalogue). The id shape is `MODEL_ID_RE`'s, `shared/models.mjs`'s one owner, copied with `\z`
# in place of `$` (the engine's `$` also matches before a final newline, which would splice a second line into an answer). An
# effort level or orphaned level is spliced into a line, so it must be one token of `[A-Za-z0-9._-]`; anything else is invalid.
MODEL_ALIASES_JQ='
def isid: type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\\z");
def tok: type == "string" and test("^[A-Za-z0-9._-]+\\z");
def idn: . == null or isid;
def objn: . == null or type == "object";
def bare: if type == "string" and endswith("[1m]") then .[:-4] else . end;
def load($s; $t): if $s == "ok" then (try {st: "ok", v: ($t | fromjson)} catch {st: "invalid"}) else {st: $s} end;
def rowbad: . != null and (type != "object" or ((.efforts // null) | . != null and (type != "array" or any(.[]; tok | not))));
def effs: (.efforts // null) | if . == null then "-" elif length == 0 then "none" else join(",") end;
def anthropic($A; $D; $c):
  if $A.st == "absent" then "absent"
  elif $A.st == "unreadable" then "unreadable aliases"
  elif $A.st == "invalid" then "invalid json"
  elif ($A.v | type) != "object" or $A.v.v != 1 then "invalid v"
  elif ($A.v.classes | type) != "object" then "invalid classes"
  else
    ($A.v.classes[$c]) as $x
    | if ($x | type) != "object" then "invalid classes.\($c)"
      elif ($x.id | idn | not) then "invalid classes.\($c).id"
      elif ($x.unlaunchable | objn | not) then "invalid classes.\($c).unlaunchable"
      elif ($x.seenId | idn | not) then "invalid classes.\($c).seenId"
      elif ($x.orphaned | objn | not) then "invalid classes.\($c).orphaned"
      elif ($x.orphaned != null and ($x.orphaned.level | tok | not)) then "invalid classes.\($c).orphaned.level"
      elif ($x.row | rowbad) then "invalid classes.\($c).row"
      elif ($x.heldRow | rowbad) then "invalid classes.\($c).heldRow"
      elif $D.st == "unreadable" then "unreadable advance"
      elif $D.st == "invalid" then "invalid advance"
      elif $D.st == "ok" and (($D.v | type) != "object" or ($D.v.classes | type) != "object") then "invalid advance"
      else
        (if $D.st == "ok" then ($D.v.classes[$c] | if type == "object" then .hold else null end) else null end) as $hold
        | if $hold != null and ($hold | type) != "object" then "invalid hold"
          elif $hold != null and ($hold.model // null | idn | not) then "invalid hold.model"
          else
            ($hold != null) as $held
            | ($hold.model // null) as $hm
            | (if $x.unlaunchable != null or $x.id == null then "-" else $x.id end) as $id
            | (if $held and $hm != null then $x.heldRow else $x.row end) as $row
            | "facts \($id) \(if $id == "-" or $row == null then "-" else ($row | effs) end) \($hm // "-") \(if $x.orphaned == null then "-" else $x.orphaned.level end) \(if $id != "-" and ($x.seenId | bare) == $id then "seen" else "-" end)"
          end
      end
  end;
def codex($R; $C; $c):
  if $R.st != "ok" or $C.st != "ok" then "unknown"
  elif ($R.v | type) != "object" or ($R.v.classes | type) != "object" or ($C.v | type) != "object" or ($C.v.models | type) != "array" then "unknown"
  else
    ($R.v.classes[$c] // null) as $pin
    | if $pin == null then "-"
      elif ($pin | isid | not) then "unknown"
      else
        ([$C.v.models[] | select(type == "object" and .id == $pin)] | first // null) as $row
        | if $row == null then "-"
          elif ($row | rowbad) then "unknown"
          else ($row | effs) | if . == "none" then "-" else . end
          end
      end
  end;
load($as; $at) as $A | load($bs; $bt) as $B
| ($classes | split(" "))[] as $c
| "\($c) \(if $mode == "codex" then codex($A; $B; $c) else anthropic($A; $B; $c) end)"
'

_ma_file_to() {   # var file -> var = `absent` (no such path), `unreadable` (a path that is no readable regular file: a FIFO, a directory) or `ok:<bytes>`; builtins only, never opens a non-regular file; rc 0
  local __mf_f="$2" __mf_v=""
  if [[ ! -e "$__mf_f" ]]; then
    printf -v "$1" '%s' absent
  elif [[ -f "$__mf_f" && -r "$__mf_f" ]]; then
    { IFS= read -r -d '' __mf_v < "$__mf_f"; } 2>/dev/null || :
    printf -v "$1" 'ok:%s' "$__mf_v"
  else
    printf -v "$1" '%s' unreadable
  fi
  return 0
}

_ma_answer_to() {   # var mode wrapper class file-a file-b -> var = the answer line for the class, from the per-wrapper cache; ONE jq fork answers all four classes when either file's bytes changed; rc 0
  local IFS=$' \t\n' __ma_a __ma_b __ma_key __ma_ck="$2:$3" __ma_c __ma_cl='' __ma_out __ma_line
  for __ma_c in $ROUTE_CLASSES; do [[ "$__ma_c" == default ]] || __ma_cl+="$__ma_c "; done
  if [[ " $__ma_cl" != *" $4 "* ]]; then printf -v "$1" '%s' 'invalid class'; return 0; fi
  declare -gA _MA_KEY _MA_ANS 2>/dev/null || :
  _ma_file_to __ma_a "$5"; _ma_file_to __ma_b "$6"
  __ma_key="${#__ma_a}:$__ma_a:$__ma_b"
  if [[ "${_MA_KEY[$__ma_ck]-}" != "$__ma_key" || -z "${_MA_ANS[$__ma_ck:$4]+set}" ]]; then
    __ma_out="$(jq -n -r --arg mode "$2" --arg as "${__ma_a%%:*}" --arg at "${__ma_a#*:}" --arg bs "${__ma_b%%:*}" --arg bt "${__ma_b#*:}" \
      --arg classes "${__ma_cl% }" "$MODEL_ALIASES_JQ" 2>/dev/null)" || __ma_out=''
    if [[ -z "$__ma_out" ]]; then   # jq failed: not cached, so the next ask tries again
      printf -v "$1" '%s' "$([[ "$2" == codex ]] && echo unknown || echo 'unreadable aliases')"
      return 0
    fi
    while IFS= read -r __ma_line; do _MA_ANS["$__ma_ck:${__ma_line%% *}"]="${__ma_line#* }"; done <<< "$__ma_out"
    _MA_KEY["$__ma_ck"]="$__ma_key"
  fi
  printf -v "$1" '%s' "${_MA_ANS[$__ma_ck:$4]}"
  return 0
}

_alias_facts_to() {   # var wrapper class -> var = ONE line: `absent`, `unreadable <aliases|advance>`, `invalid <field>` or `facts <id|-> <efforts> <held-id|-> <orphaned-level|-> <seen|->`; always rc 0
  _ma_answer_to "$1" aliases "$2" "$3" "$MODEL_ALIASES_DIR/$2.aliases.json" "$MODEL_ALIASES_DIR/$2.advance.json"
}

_lane_class_efforts_to() {   # var wrapper class -> var = the class's effort levels: an Anthropic lane's `<efforts>` (comma list, `none`, `-`), a Codex lane's catalogue levels (comma list, `-` for an empty or missing list), `unknown` when the files cannot say; rc 0
  local __lc_ans __lc_a __lc_b __lc_e
  if _is_anthropic_backend "$2"; then
    _alias_facts_to __lc_ans "$2" "$3"
    read -r __lc_a __lc_b __lc_e _ <<< "$__lc_ans"
    if [[ "$__lc_a" == facts ]]; then printf -v "$1" '%s' "$__lc_e"; else printf -v "$1" '%s' unknown; fi
  elif _is_codex_backend "$2"; then
    _ma_answer_to "$1" codex "$2" "$3" "$MODEL_ALIASES_DIR/$2.classes.json" "$MODEL_ALIASES_DIR/$2.json"
  else
    printf -v "$1" '%s' unknown
  fi
  return 0
}

# THE LAUNCH MARKER (plan Task A3.2, D-8744): `$REG/<id>.aliaslaunch`, one line `<born-epoch> <wrapper> <class> <model-id|->`. A fresh alias
# launch is marked at spawn with `-` for the id and filled once by the supervise tick's own step, `_alias_observe`, with the id the
# session first reported after its process started. A resume, a swap, a respawn, a held launch, an explicit model and class `default`
# are never marked: only a fresh launch by the alias is evidence of what the alias resolved to. The marker is written in place with a
# plain redirect (no temp file), and `_reg_purge` reaps it with the row like any dot-free field.
# @ccd-lib:aliaslaunch
_alias_launch_mark() {   # id wrapper class mode flags -> writes the marker iff this spawn is a fresh alias launch (see above); always rc 0
  local IFS=$' \t\n' id="$1" wrapper="$2" cls="$3" mode="$4" flags="$5" ans w1 held born
  [[ "$mode" == new && -n "$cls" && "$cls" != default ]] || return 0
  [[ " $ROUTE_CLASSES " == *" $cls "* ]] || return 0
  _is_anthropic_backend "$wrapper" || return 0
  [[ " $flags " == *" --model $cls "* && "${flags#*--model }" != *"--model"* ]] || return 0   # the class's own `--model`, and no other model flag
  _alias_facts_to ans "$wrapper" "$cls"   # a held id for THIS class stops the mark; a hold elsewhere, no aliases file or an unreadable one does not
  read -r w1 _ _ held _ <<< "$ans"
  [[ "$w1" == facts && "$held" != - ]] && return 0
  born=$(_pane_born "$id")
  [[ "$born" =~ ^[0-9]+$ ]] || return 0   # tmux cannot say when the process started: nothing to date a reading against
  printf '%s %s %s -\n' "$born" "$wrapper" "$cls" > "$REG/$id.aliaslaunch" 2>/dev/null || :
  return 0
}

_alias_fill_overruled() {   # id born-epoch reading-ts -> rc 0 iff the transcript holds a /model typed in [born, reading-ts] (or an undatable one): that launch's first reading is not the alias's own resolution; rc 1 none; rc 2 the transcript cannot be named, found or read (the opposite of the readback's choice: a wrong fill can record a move, so no fill, and the next tick asks again)
  local IFS=$' \t\n' id="$1" born="$2" ts="$3" f m out kind at
  f=$(_transcript_path "$id") || return 2
  [[ -f "$f" && -r "$f" ]] || return 2
  m=$(_plat_mtime "$f" 2>/dev/null)
  [[ "$m" =~ ^[0-9]+$ ]] || return 2
  (( 10#$m < 10#$born )) && return 1   # last written before the process started: it holds no newer row
  out=$(_operator_choice_read "$f" "0 since" "$ROUTE_READBACK_TAIL" strict) || return 2
  while read -r kind _ at _; do
    [[ "$at" =~ ^[0-9]+$ ]] || continue
    case "$kind" in
      drift-model|ran-model) (( 10#$at == 0 || (10#$at >= 10#$born && 10#$at <= 10#$ts) )) && return 0 ;;
    esac
  done <<< "$out"
  return 1
}

_alias_launch_fill() {   # id -> rc 0 decided (filled, or dropped as overruled), 1 judged and not filled, 2 undecided (the transcript could not be read: ask again). Fills an unfilled marker once, never rewrites a filled one.
  local IFS=$' \t\n' id="$1" m born wr cls mid line rk rts rmodel ruuid cur bare
  _reg_read_to m "$id" aliaslaunch || return 1
  read -r born wr cls mid <<< "$m"
  [[ "$born" =~ ^[0-9]+$ && -n "$wr" && -n "$cls" && "$mid" == - ]] || return 1
  line=$(_usage_sidecar_read "$id")
  read -r rk rts rmodel _ ruuid <<< "$line"
  [[ "$rk" == reading && "$rts" =~ ^[0-9]+$ ]] || return 1
  (( 10#$rts > 10#$born )) || return 1   # strictly later: a reading in the epoch's own second cannot be told from the previous process's
  [[ "$rmodel" != - && "$ruuid" != - ]] || return 1
  _reg_read_to cur "$id" uuid
  [[ "$ruuid" == "$cur" ]] || return 1
  _alias_fill_overruled "$id" "$born" "$rts"
  case $? in
    0) rm -f -- "$REG/$id.aliaslaunch"; return 0 ;;
    1) ;;
    *) return 2 ;;
  esac
  _model_id_bare_to bare "$rmodel"
  printf '%s %s %s %s\n' "$born" "$wr" "$cls" "$bare" > "$REG/$id.aliaslaunch" 2>/dev/null || return 1
  return 0
}

_alias_observe() {   # id -> the supervise tick's own step (never inside `_route_apply_check`, whose gate 1 returns first when nothing is pending); always rc 0. Builtins only until a marker is unfilled, its sidecar is newer than it and the sidecar's bytes changed since this supervisor last judged them.
  local id="$1" f="$REG/$1.aliaslaunch" sc="$REG/usage/$1.json" m body='' key
  [[ -e "$f" ]] || return 0
  _reg_read_to m "$id" aliaslaunch || return 0
  [[ "$m" == *" -" ]] || return 0   # filled (or not a marker): nothing to do
  [[ -f "$sc" && "$sc" -nt "$f" ]] || return 0
  { IFS= read -r -N 4096 body < "$sc"; } 2>/dev/null || :
  declare -gA _ALIAS_JUDGED 2>/dev/null || :   # the memo, a supervisor-global array keyed by session id: `<marker's born epoch>:<sidecar bytes>` last judged
  key="${m%% *}:$body"
  [[ "${_ALIAS_JUDGED[$id]-}" == "$key" ]] && return 0
  _alias_launch_fill "$id"
  (( $? == 2 )) || _ALIAS_JUDGED["$id"]="$key"
  return 0
}
