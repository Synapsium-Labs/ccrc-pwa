# FROZEN (#387, tick-diet spec §9, plan Task 2) — the legacy bodies of the sixteen helpers the supervisor tick diet
# converts or reads through, exactly as `ccd/ccd` holds them at 0d0ea592166496be5eccb948313e381bcb2b87c8, the base every
# tick-diet wave is measured against. `ccd-tick-diet-equivalence.test.ts` sources this file over the tree's `ccd/ccd`
# and compares each converted helper (its stdout, stderr, rc, out-var and registry bytes) with its legacy twin here.
#
# THE RENAME MAP. Each function `_X` is renamed `_legacy_X`, so `_reg_get` is `_legacy_reg_get`. The sixteen are
# `_reg_get`, `_reg_read`, `_authdead`, `_cfg_dir`, `_limit_json_num`, `_limit_field`, `_share_pct`, `_home_measured`,
# `_route_peek`, `_route_effort_for`, `_route_applied_get`, `_route_wanted`, `_route_pending_word`,
# `_route_apply_pending`, `_limit_score` and `_avail` (the last two vendored by W2 Task 9, for its callers' rows, by
# the remedy below). Every occurrence of those names below, code and comments alike, carries the prefix, so a call
# from one vendored body to another stays inside this file. Every other call (`_route_valid`, `_route_get`,
# `_route_inert_has`, `_id_wrapper`, `_authdead_expired`, `_route_any`, `_ccrc_cfg_dir`, …) reaches the LIVE function
# of the sourced tree.
#
# Never edit what follows. The suite pins this file's sha256 (E0a), each body with the map reversed against
# `git show 0d0ea592:ccd/ccd` (E0b), and every live helper these bodies reach, transitively, at its 0d0ea592 definition
# (E0c). If a later wave must change one of those helpers, it first VENDORS it here, the same way and from the same
# sha, in one commit: 0d0ea592's body appended as `_legacy_X`, every call to `_X` in the bodies above renamed to match,
# `_X` added to the map above and to the suite's `VENDORED` (so E0b reverses that rename too), and E0a's sha re-pinned.
# That is the one edit this file takes. A copy under the live name would not do: sourced after `ccd/ccd`, it would
# replace the live helper on BOTH sides, and no row would ever run the changed one.

_legacy_reg_get() { [[ -f "$REG/$1.$2" && ! -L "$REG/$1.$2" ]] || return 1; cat "$REG/$1.$2" 2>/dev/null; }   # id field

_legacy_reg_read() {   # id field -> stdout the value; rc 0 = read, 1 = absent, 2 = unreadable
  local f="$REG/$1.$2" v
  # THE TYPE CHECK COMES BEFORE THE OPEN, and it is not defensive dressing:
  # `cat -- "$f"` opens whatever is at `$f` with no regard for its TYPE, and
  # C1 put this function inside the `cmd_supervise` loop. A FIFO with no
  # writer blocks in `open(2)` forever; a symlink to `/dev/zero` blocks in
  # `read(2)` forever. Either one HANGS a supervisor permanently, with no exit
  # code and nothing on stdout for anything to notice — strictly worse than
  # any wrong answer this function could give. `_project_pool_state` already
  # carries this precondition and the paragraph arguing it (`grep -n 'THE
  # READER MAY NEVER BLOCK' ccd/ccd`); `_legacy_reg_read` copied that function's
  # LEVEL ORDER and dropped its loudest precondition (found by the #67 review;
  # this is that gap closed, not a new idea).
  #
  # `-f` AND NOT `-r`: `-f` is true for a regular file (or a symlink chain
  # resolving to one) whatever its mode, so a `chmod 000` file still reaches
  # the `cat` below, fails there, and falls to the ladder that answers
  # UNREADABLE — which is the whole point of this function. `-r` would
  # short-circuit that case into the same arm by a different route and, for
  # root, answer differently again.
  #
  # AND THE HALF THIS PARAGRAPH USED TO NAME AND THEN NOT ARGUE (D-2989): it
  # said `-f` resolves a symlink CHAIN and then reasoned about mode alone, as
  # if the chain were incidental. It is not — a resolving link is the one
  # input that makes this function answer rc 0 with bytes that are not the
  # field's. That is why the `-L` refusal above is asked before `-f` and not
  # folded into this pairing: mode decides between READ and UNREADABLE, and
  # type decides whether the path is a field at all.
  # A SYMLINK AT A FIELD PATH IS NOT A FIELD (D-2989, review 71 CRITICAL 1).
  # `-f` FOLLOWS the chain, so a link at `$REG/<id>.<field>` resolving to any
  # readable regular file ANYWHERE answered rc 0 with THAT file's bytes — a
  # fabricated value from outside `$REG`, byte-for-byte indistinguishable from
  # a real read, and reproduced in a fixture HOME before this was written.
  # `-L` does not follow and is asked FIRST. The verdict is rc 2 and not rc 1
  # because something IS there and it is not absent — the same verdict the
  # DANGLING case already got at the field level below. That case reached rc 2;
  # the RESOLVING case, which is the one that fabricates, did not.
  [[ -L "$f" ]] && return 2
  if [[ -f "$f" ]] && v=$(cat -- "$f" 2>/dev/null); then printf '%s' "$v"; return 0; fi
  # `cat` failed, so the question is now WHY, and the two levels are asked in
  # the order `_project_pool_state` asks them (`grep -n '^_project_pool_state()'
  # ccd/ccd`): the DIRECTORY the field sits in first, then the field.
  #
  # THE REGISTRY LEVEL (D-1989, corrected at review to D-1996). This is the
  # POSITIVE pairing, `-d && -x`, copied from `ccd/ccd:1141` — the one
  # condition that was here before, `-d "$REG" && ! -x "$REG"`, covered exactly
  # one of the anomalies and left `$REG` missing, `$REG` a regular file, `$REG`
  # a symlink loop and `$REG`'s own PARENT unsearchable all answering ABSENT
  # for fields that may well exist. The sibling's comment states the ruling
  # this now shares: "`$REG` missing entirely gets the SAME `unreadable`
  # verdict". A registry you cannot enter tells you nothing about a field.
  [[ -d "$REG" && -x "$REG" ]] || return 2
  # THE FIELD LEVEL. `-e` follows symlinks, so a DANGLING symlink is a name
  # that exists and cannot be read; `-L` is what keeps it out of the absent
  # arm, spelled as the same one-expression pairing `_project_pool_state` uses
  # at `:1151-1152`.
  [[ -e "$f" || -L "$f" ]] && return 2
  return 1
}

_legacy_authdead() {   # wrapper -> success iff a well-formed auth-dead marker stands for it
  local f="$REG/$1-authdead" t
  # `! -L` AND NOT `-f` ALONE (D-2989, re-censused by PAIRING). `-f` FOLLOWS the
  # chain, so a symlink at `$REG/<wrapper>-authdead` pointing at ANY file whose
  # first word is digits passes this test and the `cat` below returns THAT
  # file's bytes — a fabricated AUTH-DEAD verdict from outside `$REG`, which
  # `cmd_*`'s placement skip and the rescue arm both key on. The marker is not
  # a `<id>.<field>` path, which is exactly why the first census — named by the
  # FIELD-path grammar — could not contain it.
  [[ -f "$f" && ! -L "$f" ]] || return 1
  t=$(cat "$f" 2>/dev/null); t="${t%% *}"
  [[ "$t" =~ ^[0-9]+$ ]] && ! _authdead_expired "$1" "$t"   # D-3524: a verdict about a credential no longer on disk is not one
}

_legacy_cfg_dir() { _ccrc_cfg_dir "$1"; }   # wrapper -> the CLAUDE_CONFIG_DIR that wrapper uses

_legacy_limit_json_num() {   # file key -> that key's number, or "" when absent, null or non-numeric.
  # [[:space:]]* — ZERO or more, tolerant on purpose: the Anthropic accounts'
  # telemetry is printf'd compact by statusline-command.sh, while gpt-lane rows are
  # written by Python's json.dump (ccd/ccgpt-usage.py), whose default separators put a
  # space after every colon — `{"five": null, "seven": 0, ...}`. (task-10-fix-rulings.md
  # D-3159, corrected 2026-09-21: this comment used to claim a compact writer would make
  # ccd read the lane as entirely unknown — measurably false, since this same zero-or-more
  # pattern matches a compact row identically. The producer keeps the spaced style anyway,
  # for a stricter future reader; this grep does not require it.)
  grep -oE "\"$2\"[[:space:]]*:[[:space:]]*[0-9]+" "$1" | head -1 | grep -oE '[0-9]+$'
}

_legacy_limit_field() {   # wrapper five|seven [maxage-secs] -> that limit %, or "" when unknown
  # FOUR conditions answer "": no file, no value for this field, a caller that
  # demanded fresher telemetry than exists, and a value whose own window has
  # ENDED. They mean one thing to every caller — nobody has measured this
  # window — and what they must NOT mean is 0, which is a measurement.
  local f="$LIMITS_DIR/$1.json" field="$2" maxage="${3:-0}" val ts now reset
  [[ -f "$f" ]] || return 0
  val=$(_legacy_limit_json_num "$f" "$field")
  ts=$(_legacy_limit_json_num "$f" ts)
  now=$(date +%s)
  if [[ "$maxage" -gt 0 && ( -z "$ts" || $((now - ts)) -gt "$maxage" ) ]]; then return 0; fi
  # A reading whose own window has already reset describes a window that ENDED.
  # resetAt comes straight from the API (statusline-command.sh), so this is fact,
  # where the age rule below is inference. It matters because telemetry is only
  # written when a session renders its statusline: an idle account stops
  # reporting entirely, so its last sample can outlive its window by days.
  # Observed 2026-07-27: claude read seven=98 for 14h after its 7d window reset,
  # which excluded it from every pool and stranded two sessions on gpt.
  # Both rules below RETRACT a known value; neither may conjure one. gpt.json carries
  # `"five": null` with no 5h window at all, and a reset timestamp for a window nobody
  # ever measured says nothing about its value — "unknown" has to stay "" (readLimits
  # keeps it null), or _legacy_limit_score's wholly-unknown branch becomes unreachable.
  reset=$(_legacy_limit_json_num "$f" "${field}ResetAt")
  if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
    # WAS `printf '0'`. That 0 was INFERRED from a timestamp, never observed,
    # and it entered the ranking as the best measurement on the fleet:
    # _legacy_limit_score returned max(0,0)=0, and _ws_least_loaded's strict `<` kept
    # it over every account that had honestly reported. Nothing runs on the
    # account it won, so nothing ever replaced the 0 — the emptiest-looking
    # account was simply the one whose window had lapsed. Same magnet, same
    # shape, as the two unknown-is-zero defects recorded in _ws_least_loaded and
    # _swap_target; this is the third site, and unlike those two it fires on a
    # perfectly healthy fleet every time a window turns over.
    #
    # The honest answer is "": this window ended and nobody has measured the new
    # one. _legacy_avail keeps the account ELIGIBLE (see its comment — eligibility and
    # rank are different questions, and it refuses only on a KNOWN half at the
    # ceiling), _ws_least_loaded skips it, _swap_target ranks it last at 100.
    # Availability does not change; only preference does — and that holds for a
    # row with only ONE window ended, because _legacy_limit_score answers "" unless
    # both halves are measured.
    return 0
  fi
  # Fallback when the file carries no resetAt (the gpt 429 exclusion, and files
  # written before those fields existed): a sample older than its own window has
  # certainly rolled over. (7d decays slowly, so a stale seven only answers
  # unknown after a full week.) Same answer as the branch above and for the same
  # reason — this path INFERS that the window turned over, so it may not report
  # a measurement. The server's mirror sets fiveRolledOver/sevenRolledOver on
  # exactly this path for exactly this reason (server/src/limits.ts).
  if [[ -n "$val" && -n "$ts" ]]; then
    [[ "$field" == "five"  && $((now - ts)) -gt 18000  ]] && return 0
    [[ "$field" == "seven" && $((now - ts)) -gt 604800 ]] && return 0
  fi
  printf '%s' "$val"
}

_legacy_share_pct() {   # wrapper -> stdout the sweep's Fable share for that account as an INTEGER percent; rc 0 figure | 1 no figure | 2 stale
  # The sweep (ccd-usage-sweep) writes $REG/usage/sweep/latest.json: `perAccount.<id>.fableShare.estimate` is a FRACTION of
  # the account's PRICED weekly usage (or null), `finishedAt` is %Y-%m-%dT%H:%M:%SZ. Nested JSON, so python3 (ccd's
  # existing JSON tool, forty-one sites) rather than the flat-file grep `_legacy_limit_json_num` uses. floor(x*100+0.5), NOT
  # Python's round(): that is banker's rounding and the TypeScript twin (server/src/shares.ts) would disagree at .5.
  local f="$REG/usage/sweep/latest.json"
  [[ -r "$f" ]] || return 1
  LC_ALL=C.UTF-8 python3 - "$f" "$1" "$SHARE_FRESH_S" <<'PY'
import calendar, json, sys, time
f, acct, fresh = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    d = json.load(open(f))
    at = calendar.timegm(time.strptime(d["finishedAt"], "%Y-%m-%dT%H:%M:%SZ"))
    est = d["perAccount"][acct]["fableShare"]["estimate"]
except Exception:
    sys.exit(1)
if not isinstance(est, (int, float)) or isinstance(est, bool):
    sys.exit(1)
if int(time.time()) - at > fresh:
    sys.exit(2)
print(int(est * 100 + 0.5))
PY
}

_legacy_home_measured() {   # id -> stdout the effective home; rc 0 decided, rc 2 unreadable
  local h rc
  h=$(_legacy_reg_read "$1" home); rc=$?
  [[ "$rc" -eq 2 ]] && return 2
  [[ -n "$h" ]] && { printf '%s' "$h"; return 0; }
  _id_wrapper "$1"
}

_legacy_route_peek() {   # id field -> stdout the VALIDATED value, or nothing. PURE: no journal
  # line, no floor marker, no registry write of any kind. For a caller that
  # reads a field only to DECIDE, and may `die` before it writes anything —
  # `cmd_route`'s haiku+effort pair check, where `_route_get` used to leave a
  # note and a floor marker behind on a call that then refused and changed
  # nothing (fix round 2, minor M2). `_route_get` stays what every APPLY path
  # uses: a value a real spawn actually dropped is what the journal is for.
  # Both conditions `_route_valid` refuses are silent here — this read makes no
  # claim about which it saw, and the caller's own `die` is not reached from
  # here anyway.
  local id="$1" f="$2" v
  v=$(_legacy_reg_get "$id" "$f") || return 0
  _route_valid "$f" "$v" && printf '%s' "$v"
  return 0
}

_legacy_route_effort_for() {   # id class [quiet] -> stdout the effort to apply. Haiku 4.5 takes no effort
  # level (the served catalogue gives it `thinking.type: none`), so the PAIR is
  # refused here with its own note and nothing is typed. `auto` is spec
  # §5.1's ABSENT-equivalent — haiku+auto types nothing and notes nothing,
  # same as haiku+absent; only haiku+a LEVEL is the refused pair (controller
  # ruling S1-R5, matched by `cmd_route`'s own pair check above).
  #
  # `quiet` IS A THIRD ARGUMENT AND NOT A SECOND FUNCTION (controller ruling
  # S4-R9). The rule this applies is one rule; a peek-shaped copy of it beside
  # this one is the drift that makes a gate and an applier disagree about the
  # same record. What `quiet` removes is the WRITING, all of it: the journal
  # read becomes `_legacy_route_peek` (no `route-reject`/`route-unmeasured` line, no
  # floor marker) and the pair refusal becomes silent. Omitting the argument
  # leaves every existing caller byte-for-byte what it was — the settle and
  # `cmd_caps`' journaling read still say everything they said.
  #
  # WHO ASKS QUIETLY: `_legacy_route_wanted`, which runs on the 5s supervise tick for
  # every live session. A tick may not write, and this used to: a haiku+level
  # record left a `routenotepair` floor marker and a `route-refuse` line the
  # first time the applier's own gate looked at it.
  local id="$1" cls="$2" quiet="${3:-}" e
  if [[ "$quiet" == quiet ]]; then e=$(_legacy_route_peek "$id" effort); else e=$(_route_get "$id" effort); fi
  if [[ "$cls" == haiku && "$e" == auto ]]; then
    e=""
  elif [[ "$cls" == haiku && -n "$e" ]]; then
    [[ "$quiet" == quiet ]] || _route_pair_note "$id"
    e=""
  fi
  printf '%s' "$e"
  return 0
}

_legacy_route_applied_get() {   # id field -> stdout the recorded value, or nothing. Always 0.
  local id="$1" f="$2" w
  local -a words=()
  read -r -a words <<< "$(_legacy_reg_get "$id" routeapplied 2>/dev/null)"
  for w in ${words[@]+"${words[@]}"}; do
    [[ "$w" == "$f="* ]] && { printf '%s' "${w#*=}"; return 0; }
  done
  return 0
}

_legacy_route_wanted() {   # id -> stdout "<class> <effort>": the two values the applier would type.
  # ONE SPELLING, read by both the cheap pending check and the applier itself —
  # two copies of "what does this record ask for" is exactly the drift that would
  # make the tick loop for ever on a field it then declines to type.
  #
  # AN ABSENT FIELD IS AN EMPTY WORD, AND THAT IS NOT `default`/`auto`
  # (controller ruling S4-R8). Three conditions, three answers: the field is
  # ABSENT (nothing is pending for it and nothing is ever typed for it), or it
  # carries the explicit word `default`/`auto` (the picker's `Default` row; the
  # lane decides the level), or it carries a real value. Collapsing the first two
  # is what made a live session carrying only `compact=off` get `/model` + Enter
  # + `s` on the first tick, overriding a model a human had picked by hand. The
  # settle has always drawn the same line — `[[ -n "$rclass" && "$rclass" !=
  # default ]]` composes no `--model` for either, but it composes nothing for an
  # absent class the way it composes nothing for `default`, and now says so in
  # its `routeapplied` stamp too.
  #
  # THE CLASS SERVED, NEVER THE INTENDED ONE: a `degraded` stamp means this lane
  # measured unable to serve `class`, and typing the intended class into the
  # picker would ask the pane for a model the settle already ruled out (and, on
  # the fable rung, one the picker does not even list).
  #
  # AN INERT FIELD IS NOT WANTED AT ALL (controller ruling S4-R9). `inert` is the
  # settle's own statement that this lane could not apply the field; a tick that
  # then typed it would contradict the record on disk, and the `routeapplied`
  # stamp beside it would claim a state nobody set. `class` is never inert —
  # `ROUTE_INERTABLE` has no word for it — so only the effort arm asks. `subagent`
  # IS inertable (slice 6 Task 3) and still does not ask here, for a different
  # reason: this function answers the two values THE APPLIER TYPES, and the
  # subagent is an env key on the spawn's argv with no picker behind it. Its
  # inert stamp is read where it is claimed instead — `_route_apply_seed` and
  # `_spawn_start`'s `routeapplied` line.
  #
  # IT WRITES NOTHING. Five registry READS and no write: `_legacy_route_peek` for
  # `class` and `degraded` and `inert`, and `_legacy_route_effort_for … quiet`, which is
  # a sixth read (`effort`) through the same pure reader. That is the whole
  # contract this function owes `_legacy_route_apply_pending`, which runs on every live
  # session every five seconds.
  local id="$1" cls deg eff
  cls=$(_legacy_route_peek "$id" class)
  deg=$(_legacy_route_peek "$id" degraded)
  [[ -n "$deg" ]] && cls="$deg"
  eff=$(_legacy_route_effort_for "$id" "$cls" quiet)
  _route_inert_has "$(_legacy_route_peek "$id" inert)" effort && eff=""
  printf '%s %s' "$cls" "$eff"
  return 0
}

_legacy_route_pending_word() {   # id -> "<field>=<value>" for the FIRST field the applier would type, or nothing
  # THE ONE PLACE "is this field pending" is decided, so the cheap gate, the
  # applier and the give-up note can never disagree about WHICH field is stuck.
  # Class first, then effort — `_route_apply_now`'s own order (D-2811).
  local id="$1" want cls eff
  want=$(_legacy_route_wanted "$id"); cls="${want%% *}"; eff="${want#* }"
  [[ -n "$cls" && "$cls" != "$(_legacy_route_applied_get "$id" class)" ]] && { printf 'class=%s' "$cls"; return 0; }
  [[ -n "$eff" && "$eff" != "$(_legacy_route_applied_get "$id" effort)" ]] && { printf 'effort=%s' "$eff"; return 0; }
  return 0
}

_legacy_route_apply_pending() {   # id -> 0 iff the record asks for a class or effort `routeapplied` does not record
  # REGISTRY READS ONLY, AND THAT IS NOW TRUE (controller ruling S4-R9; it was
  # not, and the comment here said it was — `_legacy_route_wanted` reached
  # `_legacy_route_effort_for`, which could leave a `routenotepair` marker and a
  # `route-refuse` line on a tick). The reads: `_route_any`'s seven `-e` stats,
  # then `_legacy_route_wanted`'s four (`class`, `degraded`, `effort`, `inert`) and one
  # or two `_legacy_route_applied_get`s. This is the tick's first act on every live
  # session — ~20 sessions x 12 ticks a minute — so the healthy answer, nothing
  # pending, has to cost a few stats and no tmux at all.
  local id="$1"
  _route_any "$id" || return 1
  [[ -n "$(_legacy_route_pending_word "$id")" ]] && return 0
  return 1
}

_legacy_limit_score() {   # wrapper -> account pressure = max(5h%, 7d%); "" unless BOTH windows are measured
  # Weekly limits are as blocking as 5h ones (user directive 2026-07-05) — a target with a
  # free 5h window but an exhausted week is NOT a good landing spot, and an account nearing
  # its weekly cap should evacuate just like one nearing its 5h cap.
  #
  # EITHER HALF UNKNOWN MAKES THE ROW UNKNOWN. This was `&&` — "" only when
  # BOTH halves were empty — with `: "${five:=0}"` substituting 0 for the
  # missing one. That substitution is the same unknown-is-zero magnet the
  # provenance fix removed from _legacy_limit_field, surviving through the half that
  # was still readable: `{five: <window ended>, seven: 5}` scored 5, which made
  # an account whose 5h state nobody had measured the emptiest-looking on the
  # fleet, and _ws_least_loaded's strict `<` sent placement there. The score is
  # a MAXIMUM, so one known half bounds the truth only from BELOW — it could
  # really be 99 — and a bound from below is not a score.
  #
  # This is a RANK, and rank is the only thing it answers. Eligibility asks a
  # different question and needs only that lower bound, so `_legacy_avail` reads
  # `_legacy_limit_field` itself rather than routing through here; see its comment.
  # Splitting the two is what let this guard tighten without stripping the gpt
  # lane of its only exclusion — measured: with `_legacy_avail` still reading this
  # function, gpt's real `{"five": null, "seven": 99}` went from EXCLUDED to
  # "enabled, available" and three _codex_lane_status assertions went red.
  #
  # A WINDOW THE PLAN DOES NOT HAVE IS NOT AN UNMEASURED WINDOW. The guard above
  # is right that one KNOWN half bounds a max() only from below — but that
  # reasoning assumes the other half exists and nobody has looked at it yet. A
  # ChatGPT/Codex Pro lane has NO 5h window at all: the backend reports
  # `x-codex-secondary-window-minutes: 0`, and ccgpt-usage carries that through
  # as `fiveWindowMinutes` so the two cases stop looking alike in the row (both
  # are `five: null`). When the 5h window does not exist, the weekly figure is
  # not half the truth — it is the WHOLE truth, and max() over the one window
  # that exists is a real score, not a lower bound.
  #
  # Read the marker RAW, not through `_legacy_limit_field`: it is the row's SHAPE, not a
  # measurement, so the rollover and age rules must not touch it.
  #
  # ABSENT MEANS APPLICABLE, and that is load-bearing rather than merely tidy.
  # ccd writes a SECOND shape into this very file — the 429 exclusion
  # `{"five":100,"seven":0,"ts":N}` — and that row carries no marker, so it falls
  # through to the pair rule below and still scores 100. Inferring "weekly-only"
  # per-ACCOUNT instead would score that row `seven` = 0, i.e. the emptiest
  # account on the fleet, which is the unknown-is-zero magnet this file has
  # already had to remove three times (_ws_least_loaded, this function's old
  # `:="0"`, and _legacy_limit_field's inferred 0). The marker is per-ROW for that reason.
  local five seven fivewin
  five=$(_legacy_limit_field "$1" five 0); seven=$(_legacy_limit_field "$1" seven 0)
  # 2>/dev/null like the sibling read at the top of this file: a lane whose row
  # does not exist yet (a fresh box, a newly added lane before its first poll) is
  # an ordinary state here, and `_legacy_limit_field` above answers it with a -f guard
  # rather than a grep error on the operator's terminal.
  fivewin=$(_legacy_limit_json_num "$LIMITS_DIR/$1.json" fiveWindowMinutes 2>/dev/null)
  if [[ "$fivewin" == 0 ]]; then
    [[ -z "$seven" ]] && return 0        # the one applicable window is unknown
    printf '%s' "$seven"; return 0
  fi
  [[ -z "$five" || -z "$seven" ]] && return 0
  (( seven > five )) && printf '%s' "$seven" || printf '%s' "$five"
}

_legacy_avail() {   # wrapper -> success if it has included-usage headroom (rate score under the ceiling).
  # The monthly spend cap only gates PAID OVERAGE above 100%, so an account under the ceiling is
  # always usable, and a spend-blocked one is already >=100% (excluded by this same rate check).
  #
  # UNKNOWN IS AVAILABLE HERE. It is not a score, and this is the one of the
  # three unknown-handling sites that must stay permissive, because ELIGIBILITY
  # and RANK are different questions and only this function answers the first.
  #
  #   • This function answers "may a session RUN here" — and it also answers
  #     `_swap_target`'s two "stay" shortcuts (`_legacy_avail "$home"`, `_legacy_avail
  #     "$cur"`). Telemetry is only written when a session renders its
  #     statusline (see _legacy_limit_field), so an account that is merely QUIET
  #     reports nothing at all. Reading that as blocked would evacuate every
  #     session off a perfectly healthy home the moment it went quiet — the
  #     mirror image of the 2026-07-27 incident _legacy_limit_field records — and
  #     would leave a hard-blocked session with NO destination.
  #     `ccd-login-screen.test.ts`'s "evacuates even though home carries zero
  #     telemetry" case is exactly that rescue, run over a fleet with no
  #     telemetry files whatsoever: it passes only while unknown is available.
  #     AND UNKNOWN IS NO LONGER RARE. Since the provenance fix, _legacy_limit_field
  #     answers "" for a window that has merely ENDED, not only for an account
  #     nobody ever measured — so every account passes through unknown each time
  #     a window turns over, on a healthy fleet. That makes this function's
  #     permissiveness load-bearing rather than a corner case: a rolled-over
  #     account was available because it scored 0 and is available now because
  #     no KNOWN half sits at the ceiling — the same answer for an honest
  #     reason, and reached without consulting a score at all (next bullet).
  #   • Ranking is where unknown must lose, and both ranking sites now make it
  #     lose, by the means each can afford. `_ws_least_loaded` SKIPS an
  #     unmeasured account outright (it has a fallback for the all-unmeasured
  #     fleet, so skipping costs nothing). `_swap_target` cannot skip — a
  #     rescue with no destination strands a stuck session — so it ranks
  #     unmeasured LAST instead, eligible but never preferred.
  #   • ELIGIBILITY NEEDS ONLY A LOWER BOUND; RANK NEEDS A FULL MEASUREMENT.
  #     That is why this function reads `_legacy_limit_field` directly instead of
  #     asking `_legacy_limit_score`, which now answers "" whenever EITHER half is
  #     unknown. A single KNOWN half at or above the ceiling is already PROOF
  #     there is no headroom, whatever the other half turns out to be — so it
  #     refuses. Nothing known says nothing, so it admits. The extension is
  #     byte-identical to the `max(five, seven) < SWAP_CEILING` this replaced:
  #     for a fully-measured row `max < C` is exactly "neither half >= C", for a
  #     wholly-unknown row both spellings admit, and for a half-known row the
  #     old `: "${five:=0}"` made the score the known half anyway. What changes
  #     is only WHICH function it depends on, and that is the whole point: it
  #     frees `_legacy_limit_score` to be strict about rank without taking gpt's only
  #     exclusion with it (`{"five": null, "seven": 99}` must stay excluded, and
  #     _codex_lane_status's entry guard is this function).
  #
  # An earlier version of this comment claimed the three sites could not be
  # aligned without breaking something. That was true only of the alignment it
  # considered, "unknown ⇒ ineligible everywhere", which does break the rescue
  # above. Rank-last is the third option it missed, and it is what
  # `_swap_target` does today (review round 1, finding 1). The rule the three
  # sites now share:
  #
  #     unmeasured never OUTRANKS measured, and never becomes INELIGIBLE.
  #
  # Placement's fallback is the one deliberate exception, and it is a fallback
  # rather than a ranking: prefer measured accounts; if NONE is measured, take
  # the first home-able account in roster order.
  local w="$1" five seven
  five=$(_legacy_limit_field "$w" five 0); seven=$(_legacy_limit_field "$w" seven 0)
  [[ -n "$five"  && "$five"  -ge "$SWAP_CEILING" ]] && return 1
  [[ -n "$seven" && "$seven" -ge "$SWAP_CEILING" ]] && return 1
  return 0                                                # no KNOWN half at the ceiling = assume free
}
