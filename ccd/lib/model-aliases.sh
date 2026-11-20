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
# that asks four classes forks once. `$mode` picks the Anthropic arm (`aliases`: the aliases and advance files; `held`: the same, and with the aliases file ABSENT
# it answers each class's hold from the advance file alone, `facts - - <held-id|-> - -`, for a launch) or the Codex arm
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
def holdof($D; $c):
  if $D.st == "unreadable" then {e: "unreadable advance"}
  elif $D.st == "invalid" then {e: "invalid advance"}
  elif $D.st == "ok" and (($D.v | type) != "object" or ($D.v.classes | type) != "object") then {e: "invalid advance"}
  else
    (if $D.st == "ok" then ($D.v.classes[$c] | if type == "object" then .hold else null end) else null end) as $hold
    | if $hold != null and ($hold | type) != "object" then {e: "invalid hold"}
      elif $hold != null and ($hold.model // null | idn | not) then {e: "invalid hold.model"}
      else {hold: $hold}
      end
  end;
def anthropic($A; $D; $c):
  if $A.st == "absent" then (if $mode == "held" then (holdof($D; $c) | .e // "facts - - \(.hold.model // "-") - -") else "absent" end)
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
      else
        holdof($D; $c) as $H
        | if $H.e != null then $H.e
          else
            ($H.hold != null) as $held
            | ($H.hold.model // null) as $hm
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
  local IFS=$' \t\n' __ma_a __ma_b __ma_key __ma_ck __ma_c __ma_cl='' __ma_out __ma_line __ma_m="$2"
  [[ "$2" != aliases ]] || __ma_m="${ALIAS_FACTS_MODE:-aliases}"   # a launch's caller makes `ALIAS_FACTS_MODE=held` a local of its own: that is the only way in
  __ma_ck="$__ma_m:$3"
  for __ma_c in $ROUTE_CLASSES; do [[ "$__ma_c" == default ]] || __ma_cl+="$__ma_c "; done
  if [[ " $__ma_cl" != *" $4 "* ]]; then printf -v "$1" '%s' 'invalid class'; return 0; fi
  declare -gA _MA_KEY _MA_ANS 2>/dev/null || :
  _ma_file_to __ma_a "$5"; _ma_file_to __ma_b "$6"
  # A file that is no regular, readable file decides the answer without jq (the same words the jq program gives): the supervise tick asks
  # from `_route_effort_for_to` on every box, most of which have no model files yet, and an unread file must cost no fork (every TICK_BUDGET).
  if [[ "$2" == codex ]]; then
    [[ "${__ma_a%%:*}" == ok && "${__ma_b%%:*}" == ok ]] || { printf -v "$1" '%s' unknown; return 0; }
  elif [[ "${__ma_a%%:*}" != ok && ! ( "$__ma_m" == held && "${__ma_a%%:*}" == absent && "${__ma_b%%:*}" != absent ) ]]; then   # (a launch, mode `held`, reads the advance file when only the aliases file is absent)
    if [[ "${__ma_a%%:*}" == absent ]]; then printf -v "$1" '%s' absent; else printf -v "$1" '%s' 'unreadable aliases'; fi
    return 0
  fi
  __ma_key="${#__ma_a}:$__ma_a:$__ma_b"
  if [[ "${_MA_KEY[$__ma_ck]-}" != "$__ma_key" || -z "${_MA_ANS[$__ma_ck:$4]+set}" ]]; then
    __ma_out="$(jq -n -r --arg mode "$__ma_m" --arg as "${__ma_a%%:*}" --arg at "${__ma_a#*:}" --arg bs "${__ma_b%%:*}" --arg bt "${__ma_b#*:}" \
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

_alias_facts_to() {   # var wrapper class -> var = ONE line: `absent`, `unreadable <aliases|advance>`, `invalid <field>` or `facts <id|-> <efforts> <held-id|-> <orphaned-level|-> <seen|->`; always rc 0. The tick asks plainly (no aliases file, no fork); a launch (`_held_model_env_to`, `_alias_launch_mark`) asks with `ALIAS_FACTS_MODE=held` as a local of its own, so a hold the advance file keeps survives an absent aliases file
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

# THE EFFORT-LEVEL RULE FROM DATA (plan Task A3.3, D-8750): a class takes no effort level when its model lists none. `_class_takes_no_effort`
# asks the lane's files; the standing haiku rule (class `haiku` takes none) answers wherever the files cannot say, so a lane with no file, an
# unreadable or invalid one, a row with no effort field, a Codex catalogue's empty list or no lane at all behaves exactly as ccd did before. On a
# Codex lane the reader answers `-` for an empty list, never `none`, so rc 0 never arises there and data only ever RELAXES the rule.
# @ccd-lib:efforts
_class_takes_no_effort() {   # wrapper class -> rc 0 the class's model says it takes no effort level (`none`), rc 1 it lists levels, rc 2 the files cannot say (`-`, `unknown`, an invalid answer, an empty class or no lane); reads cached facts only
  local __ne_e
  [[ -n "${2-}" ]] || return 2
  _lane_class_efforts_to __ne_e "$1" "$2"
  case "$__ne_e" in
    none) return 0 ;;
    -|unknown|'') return 2 ;;
    *[!A-Za-z0-9._,-]*) return 2 ;;   # any other answer (one with a space, as `invalid ...`) is no list of levels
    *) return 1 ;;
  esac
}

_class_effort_barred_to() {   # var wrapper class -> rc 0 the class takes no effort level, rc 1 it takes one. var (when not empty) = what to name in a refusal: `model <id>` when the lane's data decided, `class <class>` when the standing haiku rule did, empty on rc 1. The one decision all five sites of ccd share
  local __eb_w="$2" __eb_c="${3-}" __eb_ans __eb_a __eb_id __eb_h
  [[ -z "$1" ]] || printf -v "$1" ''
  _class_takes_no_effort "$__eb_w" "$__eb_c"
  case $? in
    0) _alias_facts_to __eb_ans "$__eb_w" "$__eb_c"
       read -r __eb_a __eb_id _ __eb_h _ <<< "$__eb_ans"
       [[ "$__eb_h" == - ]] || __eb_id="$__eb_h"   # a held class is judged on the held row, so the refusal names the held id
       if [[ "$__eb_a" == facts && "$__eb_id" != - ]]; then __eb_id="model $__eb_id"; else __eb_id="class $__eb_c"; fi ;;
    1) return 1 ;;
    *) [[ "$__eb_c" == haiku ]] || return 1; __eb_id="class haiku" ;;
  esac
  [[ -z "$1" ]] || printf -v "$1" '%s' "$__eb_id"
  return 0
}

# EFFORT CARRIED TO THE ALIAS'S CURRENT ID (plan Task A3.5, D23, D-8746, spec §2.5.5): Claude Code saves a plain `/effort` per model id in the
# home's settings, so a level saved under an older id of a class's family is ORPHANED when the alias moves on, and the aliases file records it.
# ccd carries it to the current id at launch, session-only (`--effort`), and only for a record whose effort is `auto` ("the lane decides": the
# saved level is the lane's decision); the caller (`_spawn_start`) asks only then. ccrc writes no model or effort choice into the home. A level
# the current row lists none of is never carried: a launch is never stopped by a level Claude Code would refuse, and a model that takes none
# takes no carried level.
_orphaned_effort_to() {   # var wrapper class -> rc 0 and var = the orphaned level to put on `--effort`; rc 1 and var empty when the lane is no Anthropic backend, there is no class, no readable file, no orphan, the class is held or its id unlaunchable, or the current row does not list the level
  local IFS=$' \t\n' __oe_ans __oe_a __oe_id __oe_e __oe_h __oe_o
  printf -v "$1" ''
  [[ -n "${3-}" ]] && _is_anthropic_backend "$2" || return 1
  _alias_facts_to __oe_ans "$2" "$3"
  read -r __oe_a __oe_id __oe_e __oe_h __oe_o _ <<< "$__oe_ans"
  [[ "$__oe_a" == facts && "$__oe_o" != - && "$__oe_h" == - && "$__oe_id" != - ]] || return 1   # a held class runs the held id, and an unlaunchable one has none: neither carries the alias's orphan
  case ",$__oe_e," in
    *",$__oe_o,"*|,-,) ;;   # listed, or a row with no effort field (which cannot rule it out)
    *) return 1 ;;          # a list without it, or `none`
  esac
  printf -v "$1" '%s' "$__oe_o"
  return 0
}

# THE LAUNCH MARKER (plan Task A3.2, D-8744): `$REG/<id>.aliaslaunch`, one line `<born-epoch> <wrapper> <class> <model-id|->`. A fresh alias
# launch is marked at spawn with `-` for the id and filled once by the supervise tick's own step, `_alias_observe`, with the id the
# session first reported after its process started. A resume, a swap, a respawn, a held launch, an explicit model and class `default`
# are never marked: only a fresh launch by the alias is evidence of what the alias resolved to. The marker is written in place with a
# plain redirect (no temp file), and `_reg_purge` reaps it with the row like any dot-free field.
# @ccd-lib:aliaslaunch
_alias_launch_mark() {   # id wrapper class mode flags -> writes the marker iff this spawn is a fresh alias launch (see above); always rc 0
  local IFS=$' \t\n' id="$1" wrapper="$2" cls="$3" mode="$4" flags="$5" ans w1 held born ALIAS_FACTS_MODE=held
  [[ "$mode" == new && -n "$cls" && "$cls" != default ]] || return 0
  [[ " $ROUTE_CLASSES " == *" $cls "* ]] || return 0
  _is_anthropic_backend "$wrapper" || return 0
  [[ " $flags " == *" --model $cls "* && "${flags#*--model }" != *"--model"* ]] || return 0   # the class's own `--model`, and no other model flag
  _alias_facts_to ans "$wrapper" "$cls"   # a held id for THIS class stops the mark (even with no aliases file); a hold elsewhere, no file at all or an unreadable one does not
  read -r w1 _ _ held _ <<< "$ans"
  [[ "$w1" == facts && "$held" != - ]] && return 0
  born=$(_pane_born "$id")
  [[ "$born" =~ ^[0-9]+$ ]] || return 0   # tmux cannot say when the process started: nothing to date a reading against
  printf '%s %s %s -\n' "$born" "$wrapper" "$cls" > "$REG/$id.aliaslaunch" 2>/dev/null || :
  return 0
}

ALIAS_TPATH=""   # the transcript path `_alias_fill_overruled` last named (empty when it could not): the observe step waits on it with builtins
_alias_fill_overruled() {   # id born-epoch reading-ts -> rc 0 iff the transcript holds a /model typed in [born, reading-ts] (or an undatable one): that launch's first reading is not the alias's own resolution; rc 1 none; rc 2 the transcript cannot be named, found or read (the opposite of the readback's choice: a wrong fill can record a move, so no fill; no transcript is no proof of no /model). Sets ALIAS_TPATH
  local IFS=$' \t\n' id="$1" born="$2" ts="$3" f m out kind at
  ALIAS_TPATH=''
  f=$(_transcript_path "$id") || return 2
  ALIAS_TPATH="$f"
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

_alias_launch_fill() {   # id -> rc 0 decided (filled, or dropped as overruled), 1 judged and not filled, 2 undecided (the transcript could not be read: ask again, see `_alias_launch_observe`). Fills an unfilled marker once, never rewrites a filled one.
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

# `_alias_launch_observe` costs, per tick and per session: no marker, a filled one or a sidecar no newer than the marker: builtins only (a test and
# a read). Otherwise the sidecar's bytes are read with builtins and compared with the memo, `_ALIAS_JUDGED[<id>]` = `<born>:<bytes>` last judged: a
# judged state costs that read alone, and the fill (`_usage_sidecar_read`, `_transcript_path`, `_operator_choice_read`: about 18 forks) runs once per
# distinct sidecar. An UNDECIDED fill (rc 2: no transcript yet, or one that cannot be read) is memoed the same way, so an unprompted pane costs the
# fill once, not every tick; the marker stays unfilled and retryable, because no transcript is no proof of no `/model`. What re-opens the question
# with no forks: a transcript that was absent and is now a file (`_ALIAS_TWAIT[<id>]` holds the path the fill looked at, tested with `[[ -f ]]`),
# or changed sidecar bytes. `ccd-tick-budget.test.ts` measures exactly these: the steady tick of such a pane costs the idle figure.
_alias_launch_observe() {   # id -> the marker half of `_alias_observe`; always rc 0 (see the cost note above)
  local id="$1" f="$REG/$1.aliaslaunch" sc="$REG/usage/$1.json" m body='' key tp rc
  [[ -e "$f" ]] || return 0
  _reg_read_to m "$id" aliaslaunch || return 0
  [[ "$m" == *" -" ]] || return 0   # filled (or not a marker): nothing to do
  [[ -f "$sc" && "$sc" -nt "$f" ]] || return 0
  { IFS= read -r -N 4096 body < "$sc"; } 2>/dev/null || :
  declare -gA _ALIAS_JUDGED _ALIAS_TWAIT 2>/dev/null || :   # supervisor-global arrays keyed by session id: the memo above, and the transcript path an undecided fill waits on
  key="${m%% *}:$body"
  if [[ "${_ALIAS_JUDGED[$id]-}" == "$key" ]]; then
    tp="${_ALIAS_TWAIT[$id]-}"
    [[ -n "$tp" && -f "$tp" ]] || return 0   # judged on these bytes, and no transcript has appeared since
  fi
  _alias_launch_fill "$id"
  rc=$?
  _ALIAS_JUDGED["$id"]="$key"
  if (( rc == 2 )) && [[ -n "$ALIAS_TPATH" && ! -f "$ALIAS_TPATH" ]]; then _ALIAS_TWAIT["$id"]="$ALIAS_TPATH"; else unset '_ALIAS_TWAIT[$id]'; fi
  return 0
}

# THE ROUTING RECORD'S MODEL ID (plan Task A3.6, spec §2.5.6): `routeapplied` carries `model=<bare id>`, the id the session's own reading last
# named, on every lane. It is RECORDED, never typed, by the tick's own step (`_alias_observe`, outside `_route_apply_check`'s gate, which
# returns first when nothing is pending) and by `_route_readback` when it confirms a class from a fresh reading. It is written with `keep`
# (`_route_applied_set`'s fourth argument), which leaves the stamp (`routeapplied`'s mtime) where it was, so a reading is judged against
# the last write that MOVED the stamp. `_route_applied_set` drops it when the class changes; a spawn's settle and the seed write a whole
# new list without it, so it is recorded again after either. Nothing here creates `routeapplied`, and nothing types a model: an id change
# is recorded and the session moves at its next spawn (the coordinator's ruling on A3.0 Step 3's fallback). Nothing in the pending check
# reads `model=`, `picked=` or `held=`: `_route_pending_word_to` compares `class` and `effort` by name only.
# @ccd-lib:modelid
# A narrow writer, legitimately different from `_reg_set` (the one writer of registry fields): only this one can carry the OLD file's mtime across the
# rename, which is the stamp the readback judges a reading against; every write that is not a kept one is `_reg_set`'s.
_route_applied_put() {   # id list [keep] -> writes routeapplied; with `keep` the new file takes the old file's mtime (`touch -r`) before it is renamed, so the stamp does not move, and a missing file is NOT created (rc 1); rc 0 iff it is on disk
  local id="$1" tmp __ap_keep="${3-}" f=routeapplied
  [[ -n "$__ap_keep" && -e "$REG/$id.routeapplied" ]] || { _reg_set "$id" routeapplied "$2"; return; }   # every write but a kept one is `_reg_set`'s
  _REG_SET_SEQ=$(( _REG_SET_SEQ + 1 ))
  tmp="$REG/.$id.$f.$BASHPID.$_REG_SET_SEQ.tmp"   # `_reg_set`'s own template (`.<id>.<field>.<pid>.<seq>.tmp`), so the id-length census covers it
  printf '%s' "$2" > "$tmp" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  touch -r "$REG/$id.routeapplied" -- "$tmp" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  _plat_mv_notdir "$tmp" "$REG/$id.routeapplied" || { rm -f -- "$tmp"; return 1; }
}

_route_applied_unpick_to() {   # var list -> var = the word list without `model=` and `picked=` (a class change drops both); builtins only; rc 0
  local __up_w __up_out=''
  local -a __up_words=()
  read -r -a __up_words <<< "$2"
  for __up_w in ${__up_words[@]+"${__up_words[@]}"}; do
    [[ "$__up_w" == model=* || "$__up_w" == picked=* ]] && continue
    __up_out="${__up_out:+$__up_out }$__up_w"
  done
  printf -v "$1" '%s' "$__up_out"
  return 0
}

_route_model_record() {   # id raw-model -> records `model=<bare id>` in `routeapplied`, keeping the stamp; the one spelling of that write; rc 0
  local bare
  _model_id_bare_to bare "$2"
  _route_applied_set "$1" model "$bare" keep
  return 0
}

_alias_model_observe() {   # id -> the recording half of `_alias_observe`; always rc 0. Steady state (no routeapplied, or a recorded model) is builtins only; `_usage_sidecar_read`, `_pane_born` and `_plat_mtime` fork, and run only behind builtin gates: a regular sidecar newer than `routeapplied` whose bytes (with the record and the registry uuid) changed since this supervisor last judged them. Its memo is its own, never the marker's.
  local IFS=$' \t\n' id="$1" ra sc="$REG/usage/$1.json" body='' key line rk rts rmodel ruuid cur born stamp
  [[ -e "$REG/$id.routeapplied" ]] || return 0   # never creates the file: a session with no routing record has no class and no model to record
  _reg_read_to ra "$id" routeapplied || return 0
  # PART 2's SEAM: a landed re-pick (`picked=` differs from `model=` and the reading names `picked`) will also be recorded here. Until then
  # a recorded model ends the step.
  [[ " $ra " == *" model="* ]] && return 0
  [[ -f "$sc" && "$sc" -nt "$REG/$id.routeapplied" ]] || return 0
  { IFS= read -r -N 4096 body < "$sc"; } 2>/dev/null || :
  _reg_read_to cur "$id" uuid
  declare -gA _ALIAS_MODEL_JUDGED 2>/dev/null || :
  key="$ra|$cur|$body"
  [[ "${_ALIAS_MODEL_JUDGED[$id]-}" == "$key" ]] && return 0
  _ALIAS_MODEL_JUDGED["$id"]="$key"
  line=$(_usage_sidecar_read "$id")
  read -r rk rts rmodel _ ruuid <<< "$line"
  [[ "$rk" == reading && "$rts" =~ ^[0-9]+$ && "$rmodel" != - && "$ruuid" != - && "$ruuid" == "$cur" ]] || return 0
  born=$(_pane_born "$id")
  stamp=$(_plat_mtime "$REG/$id.routeapplied" 2>/dev/null)
  if ! [[ "$born" =~ ^[0-9]+$ && "$stamp" =~ ^[0-9]+$ ]]; then unset '_ALIAS_MODEL_JUDGED[$id]'; return 0; fi   # undecided (tmux or the stamp cannot say): ask again
  (( 10#$rts > 10#$born && 10#$rts > 10#$stamp )) || return 0   # strictly later than both: a reading in the stamp's own second cannot be told from the previous process's
  _route_model_record "$id" "$rmodel"
  return 0
}

# What `ccd-tick-budget.test.ts` measures of this step, on the real supervise loop: a session whose `model=` the run itself records on tick 1,
# one with an unfilled marker, a newer sidecar and no transcript (the fill runs on tick 1 only), and a lane with an advance file and no aliases
# file (never read by the tick); each costs the idle-home figure on ticks 2..N. The fork counts of a single fill are in the tests of
# `_alias_launch_observe` (ccd-alias-launch.test.ts), not in that fixture.
_alias_observe() {   # id -> the supervise tick's own step (never inside `_route_apply_check`, whose gate 1 returns first when nothing is pending): the launch marker's fill, then the routing record's model id; always rc 0
  _alias_launch_observe "$1"
  _alias_model_observe "$1"
  return 0
}

# A HELD ID AT LAUNCH (plan Task A3.4, D24, spec §2.5.7): while a class's advance-file hold names a model, every launch of the lane carries
# `ANTHROPIC_DEFAULT_<CLASS>_MODEL='<held id>'` in its environment, so `--model <class>`, the picker's alias row and a subagent naming the
# alias all resolve to the held id (A3.0 Step 1 measured that Claude Code honours the key, in the main session, a subagent and after
# `--resume`). One key per held class, for every class, never only the session's own. The id is only ever one the reader (`_alias_facts_to`,
# whose jq program applies `MODEL_ID_RE`) answered as `facts`: a refused id answers `invalid hold.model` and is never spliced. A hold ccd
# cannot read (`unreadable`/`invalid` for the aliases or the advance file) launches that class on the alias and is said once, floored.
# `HELD_MODEL_PAIRS` is the second answer, for `_spawn_start`'s `routeapplied` word `held=<class>:<id>[,<class>:<id>...]`.
# @ccd-lib:held
HELD_MODEL_PAIRS=""
_held_model_env_to() {   # var wrapper [id] -> var = the env words (each followed by one space, so the caller splices them as it does `$tmpenv`), empty when nothing is held or the lane is no Anthropic backend; sets HELD_MODEL_PAIRS; with an id, writes the floored `held-unread` line for a file it could not read; always rc 0
  local IFS=$' \t\n' __hm_w="$2" __hm_id="${3-}" __hm_c __hm_ans __hm_a __hm_h __hm_env='' __hm_unread='' ALIAS_FACTS_MODE=held
  HELD_MODEL_PAIRS=''
  printf -v "$1" ''
  _is_anthropic_backend "$__hm_w" || return 0
  for __hm_c in $ROUTE_CLASSES; do
    [[ "$__hm_c" == default ]] && continue
    _alias_facts_to __hm_ans "$__hm_w" "$__hm_c"
    read -r __hm_a _ _ __hm_h _ <<< "$__hm_ans"
    case "$__hm_a" in
      facts) [[ "$__hm_h" != - ]] || continue
             __hm_env+="ANTHROPIC_DEFAULT_${__hm_c^^}_MODEL='$__hm_h' "
             HELD_MODEL_PAIRS+="${HELD_MODEL_PAIRS:+,}$__hm_c:$__hm_h" ;;
      absent) ;;
      *) __hm_unread="$__hm_ans" ;;
    esac
  done
  printf -v "$1" '%s' "$__hm_env"
  if [[ -n "$__hm_unread" && -n "$__hm_id" ]] && ! _route_note_floored "$__hm_id" heldunread; then
    echo "$(date '+%F %T') held-unread $__hm_id: $__hm_w's aliases or advance file could not be read ($__hm_unread) — launched on the alias, no held id; ccrc doctor names the file" >> "$REG/swap.log"
  fi
  return 0
}
