#!/usr/bin/env bash
# ~/.claude/statusline-command.sh
# Claude Code statusLine — custom status bar
#
# ONE copy per box, shared by every account: each config dir's settings.json
# points at this same path, and `$HOME` is the same for all of them (only
# CLAUDE_CONFIG_DIR differs). That is what makes `~/.ccrc/accounts.sh` — the
# roster projection ccrc generates — reachable from here at a fixed path, and
# it is why this file no longer carries an account list of its own.
#
# It carries NO roster knowledge: which account a config dir belongs to, that
# account's human label, its hue, and whether it reports rate limits at all
# are four questions answered by `~/.ccrc/accounts.sh`. Before that projection
# existed, all four were hand-written `case` arms here — the last copy of the
# roster in the tree, and the reason free-form account ids were only half
# delivered by stage 2a: an account those arms didn't name got no
# `~/.cc-limits/<id>.json` written for it, ever, and `projectHome`'s
# "unknown is not zero" rule then ranked it below every measured account
# permanently. A free-form account was silently never placed and never
# rescued. See `shared/generate.mjs` for the emitter.

input=$(cat)

# Require jq; fall back to bare label
if ! command -v jq >/dev/null 2>&1; then
  printf "claude-code\n"
  exit 0
fi

# ANSI escape codes (ANSI-C quoting — actual bytes, not literals)
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
CYAN=$'\033[36m'
MAGENTA=$'\033[35m'
BLUE=$'\033[34m'
DIM=$'\033[2m'
RESET=$'\033[0m'
SEP=" ${DIM}│${RESET} "

# The six roster hues (shared/roster.ts's HUES), as terminal colors. This is a
# HUE→ANSI table, not an account→color one: it is keyed on the closed set of
# hue names, so adding an account never touches it. `violet` and `amber` have
# no 16-color equivalent that isn't already spoken for (35 is magenta, 33 is
# the yellow the limit bars use), so both come from the 256-color cube — which
# is also what keeps this palette matching `pwa/src/styles/tokens.css`, where
# the same six hues render as `--acct-<hue>`.
VIOLET=$'\033[38;5;141m'
AMBER=$'\033[38;5;214m'

# ── make_bar <pct_int> <width> ───────────────────────────────────────────
#   Renders a color-coded fill bar: filled cells colored by level
#   (green <50%, yellow 50-80%, red >=80%), empty cells dim.
make_bar() {
  local pct=$1 width=$2
  [ "$pct" -lt 0 ]   && pct=0
  [ "$pct" -gt 100 ] && pct=100
  local filled=$(( (pct * width + 50) / 100 ))   # rounded to nearest cell
  local empty=$(( width - filled ))
  local color
  if   [ "$pct" -ge 80 ]; then color="$RED"
  elif [ "$pct" -ge 50 ]; then color="$YELLOW"
  else                          color="$GREEN"
  fi
  local fstr="" estr=""
  if [ "$filled" -gt 0 ]; then printf -v fstr '%*s' "$filled" ''; fstr=${fstr// /█}; fi
  if [ "$empty"  -gt 0 ]; then printf -v estr '%*s' "$empty"  ''; estr=${estr// /░}; fi
  printf '%s%s%s%s%s' "$color" "$fstr" "$DIM" "$estr" "$RESET"
}

segments=()

# ── 0. Account/config — CLAUDE_CONFIG_DIR is inherited from the wrapper
#      (claude2/claude-corp export it; the upstream account leaves it unset).
#
#      Sourcing the roster projection is best-effort on purpose. This hook runs
#      on EVERY render of EVERY session's status bar, so a box without ccrc
#      installed (a laptop with the same dotfiles) must still get a status bar
#      rather than an error: `-r` gates the source, and the script has no
#      `set -e`, so a projection that somehow failed to parse costs the account
#      segment and nothing else. `_ccrc_dir_id` is checked by NAME rather than
#      trusting the file's presence — an `accounts.sh` from a ccrc older than
#      this script parses fine and simply doesn't define it.
#
#      The path is derived from `$HOME` ALONE, with no environment override,
#      exactly as `ccd` derives it (ccd:105) and for a stronger version of the
#      same reason. ccd's rule is "a stray `Environment=` cannot run a live box
#      against someone else's account list"; this file additionally SOURCES the
#      result on every status-bar render of every session, so an override would
#      be an inherited variable choosing which bash executes inside every live
#      Claude Code session on the box. `CCRC_ACCOUNTS` overrides the SERVER's
#      roster path — deliberately not this one.
CCRC_ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"
# shellcheck source=/dev/null
[ -r "$CCRC_ACCOUNTS_SH" ] && . "$CCRC_ACCOUNTS_SH" 2>/dev/null
roster=0
declare -F _ccrc_dir_id >/dev/null 2>&1 && roster=1

cfg="${CLAUDE_CONFIG_DIR:-}"
# Unset CLAUDE_CONFIG_DIR means the upstream account, whose config dir the
# roster names — `$HOME/.claude` is only Claude Code's own default, and it is
# the fallback for a box with no roster, not the answer.
[ -z "$cfg" ] && [ "$roster" = 1 ] && cfg=$(_ccrc_cfg_dir "$CCRC_UPSTREAM")
[ -z "$cfg" ] && cfg="$HOME/.claude"
# A trailing slash would miss every literal `case` pattern below and cost the
# account its telemetry silently — the exact failure this file exists to stop.
while [ "$cfg" != "/" ] && [ "${cfg%/}" != "$cfg" ]; do cfg="${cfg%/}"; done

acct_id=""
[ "$roster" = 1 ] && acct_id=$(_ccrc_dir_id "$cfg")

if [ -n "$acct_id" ]; then
  acct=$(_ccrc_label "$acct_id")
  case "$(_ccrc_hue "$acct_id")" in
    cyan)    hue_color="$CYAN" ;;
    violet)  hue_color="$VIOLET" ;;
    blue)    hue_color="$BLUE" ;;
    magenta) hue_color="$MAGENTA" ;;
    amber)   hue_color="$AMBER" ;;
    green)   hue_color="$GREEN" ;;
    *)       hue_color="" ;;
  esac
  [ -n "$hue_color" ] && acct="${hue_color}${acct}${RESET}"
else
  # No roster, or a config dir no account claims. The directory name is the
  # most honest thing available and matches what this file did for an unknown
  # config dir before the roster existed.
  acct="$(basename "$cfg")"
fi
segments+=("👤 ${acct}")

# ── 1. Model + reasoning effort ─────────────────────────────────────────
model=$(printf '%s' "$input" | jq -r '.model.display_name // empty' 2>/dev/null)
if [ -n "$model" ]; then
  effort=$(printf '%s' "$input" | jq -r '.effort.level // empty' 2>/dev/null)
  if [ -n "$effort" ]; then
    segments+=("🤖 ${model} · ${effort}")
  else
    segments+=("🤖 ${model}")
  fi
fi

# ── 2. Git branch (skip cleanly if not in a repo or git unavailable) ─────
cwd=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && command -v git >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
  [ -n "$branch" ] && segments+=("⎇ ${branch}")
fi

# ── 3. Target/app (best-effort: repo.name > package.json name > omit) ───
target=""
if [ -n "$cwd" ]; then
  target=$(printf '%s' "$input" | jq -r '.workspace.repo.name // empty' 2>/dev/null)
  if [ -z "$target" ] && [ -f "${cwd}/package.json" ]; then
    target=$(jq -r '.name // empty' "${cwd}/package.json" 2>/dev/null)
  fi
  if [ -z "$target" ]; then
    target=$(basename "$cwd")
  fi
fi
[ -n "$target" ] && segments+=("🎯 ${target}")

# ── 4. Context usage — color-coded green(<50%) / yellow(50-80%) / red(>80%) ──
used_pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)
if [ -n "$used_pct" ]; then
  pct_int=$(printf "%.0f" "$used_pct")
  if   [ "$pct_int" -ge 80 ]; then ctx_color="$RED"
  elif [ "$pct_int" -ge 50 ]; then ctx_color="$YELLOW"
  else                              ctx_color="$GREEN"
  fi
  segments+=("▓ ctx $(make_bar "$pct_int" 8) ${ctx_color}${pct_int}%${RESET}")
fi

# ── 5. Session cost (field: cost.total_cost_usd — omit if absent) ────────
cost=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // empty' 2>/dev/null)
if [ -n "$cost" ]; then
  cost_str=$(printf "\$%.4f" "$cost" 2>/dev/null)
  segments+=("💲 ${cost_str}")
fi

# ── 6. Lines changed (cost.total_lines_added / total_lines_removed) ──────
lines_added=$(printf '%s' "$input" | jq -r '.cost.total_lines_added // empty' 2>/dev/null)
lines_removed=$(printf '%s' "$input" | jq -r '.cost.total_lines_removed // empty' 2>/dev/null)
lines_out=""
[ -n "$lines_added" ]   && [ "$lines_added"   != "0" ] && lines_out="${GREEN}+${lines_added}${RESET}"
[ -n "$lines_removed" ] && [ "$lines_removed" != "0" ] && {
  [ -n "$lines_out" ] && lines_out="${lines_out} "
  lines_out="${lines_out}${RED}-${lines_removed}${RESET}"
}
[ -n "$lines_out" ] && segments+=("$lines_out")

# ── 7. Rate limits — % used, color-coded (claude.ai subscribers only) ──
#     Consistent with context: counts up, green = low usage, red = nearly out.
rate_parts=()

five_used=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
if [ -n "$five_used" ]; then
  five_int=$(printf "%.0f" "$five_used")
  if   [ "$five_int" -ge 80 ]; then rl5_color="$RED"
  elif [ "$five_int" -ge 50 ]; then rl5_color="$YELLOW"
  else                               rl5_color="$GREEN"
  fi
  rate_parts+=("5h $(make_bar "$five_int" 5) ${rl5_color}${five_int}%${RESET}")
fi

seven_used=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)
if [ -n "$seven_used" ]; then
  seven_int=$(printf "%.0f" "$seven_used")
  if   [ "$seven_int" -ge 80 ]; then rl7_color="$RED"
  elif [ "$seven_int" -ge 50 ]; then rl7_color="$YELLOW"
  else                               rl7_color="$GREEN"
  fi
  rate_parts+=("7d $(make_bar "$seven_int" 5) ${rl7_color}${seven_int}%${RESET}")
fi

if [ ${#rate_parts[@]} -gt 0 ]; then
  rate_str="⏳ limits "
  for i in "${!rate_parts[@]}"; do
    [ "$i" -gt 0 ] && rate_str="${rate_str} ${DIM}·${RESET} "
    rate_str="${rate_str}${rate_parts[$i]}"
  done
  segments+=("$rate_str")
fi

# ── Side-effect: publish this account's limit telemetry for `ccd` auto-swap ──
#    Limits are account-scoped, so any session's report is valid for the whole
#    account — but NOT last-writer-wins, and that is the whole of the guard
#    below. Consumed by `ccd supervise` and by the server's `projectHome`
#    (server/src/limits.ts).
#
#    WHY LAST-WRITER-WINS WAS WRONG. `rate_limits` is whatever THIS session's
#    last API response said; a session that has been idle since the window
#    opened carries a snapshot of that moment, and every render republishes it
#    — with a FRESH `ts`, because `ts` is this writer's clock, not the
#    measurement's. EVERY session on an account is a writer of that one row (a
#    dozen of them on the box this was measured on), so the row alternated
#    between every session's private snapshot at render cadence. Measured live,
#    one account, one window (identical `resets_at` throughout): `five` came
#    back 0, 22, 0, 30 within six seconds, each stamped fresh, while the high
#    readings climbed 21 → 30 over six minutes and the low ones never moved
#    at all — which is what says which of them were snapshots. The two
#    PWA surfaces that poll this (the accounts strip and the accounts screen)
#    therefore disagreed permanently — they sample the same flapping row at
#    different offsets — and `projectHome` scored placements off whichever
#    snapshot happened to be on disk.
#
#    THE RULE, in the only vocabulary available: `resets_at` names the window
#    a reading belongs to, and inside one window used% only ever climbs,
#    because the window accumulates until it rolls. So a payload is provably
#    OLDER than the row on disk in exactly two shapes — its `resets_at` has
#    gone BACKWARDS (it predates a rollover the row already recorded), or the
#    two agree on the window and its usage is LOWER. Either way it is dropped
#    WHOLE rather than merged: the values and the `ts` on disk stay those of
#    the freshest reading anyone published, instead of an old reading wearing a
#    fresh timestamp. A rollover itself is not a regression — the row falls to
#    the new window's reading exactly as it always did, because the two windows
#    are never compared by value. Anything undecidable — no `resets_at` on
#    either side, an unparseable row, no `jq` verdict at all — publishes, which
#    is the behaviour this guard replaces, so a box whose payload never carried
#    `resets_at` is no worse off than it was.
#
#    Two gates, and they answer different questions. `$acct_id` non-empty means
#    the roster recognises this config dir at all. `CCRC_MEASURED` membership
#    means the roster says this account REPORTS rate limits — `gpt` does not
#    (`telemetry: "none"`), and a `~/.cc-limits/gpt.json` would be
#    indistinguishable from a real measurement of zero, which is precisely the
#    fake zero that `telemetry` was added to keep out of placement scoring.
#    An account off either gate is left unmeasured, which `projectHome` ranks
#    below every measured account rather than above them.
measured=0
if [ -n "$acct_id" ]; then
  for m in ${CCRC_MEASURED[@]+"${CCRC_MEASURED[@]}"}; do
    [ "$m" = "$acct_id" ] && { measured=1; break; }
  done
fi
if [ "$measured" = 1 ] && [ -n "${five_int:-}" ]; then
  mkdir -p "$HOME/.cc-limits"
  # resets_at are unix-epoch seconds when each window rolls over (may be absent).
  five_reset=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.resets_at // "null"' 2>/dev/null)
  seven_reset=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.resets_at // "null"' 2>/dev/null)
  acct_row="$HOME/.cc-limits/$acct_id.json"
  # One `jq` against the row on disk, and only when there IS one — the verdict
  # is a word, never a number this shell then has to re-decide. Any failure
  # (absent row, unparseable row, a `resets_at` that is not a number and so
  # not `--argjson`-able) leaves `acct_verdict` empty, which publishes.
  acct_verdict=""
  if [ -f "$acct_row" ]; then
    acct_verdict=$(jq -r \
      --argjson f "$five_int" --argjson s "${seven_int:-0}" \
      --argjson fr "${five_reset:-null}" --argjson sr "${seven_reset:-null}" '
        # TWO shapes of "this reading is older", and the row needs both. A
        # window that has ROLLED since the row was written leaves the two
        # readings incomparable by value — the stale one is the one whose
        # `resets_at` has gone backwards — while inside ONE window the
        # `resets_at` match and the values decide.
        def rewound($newReset; $oldReset):
          $newReset != null and $oldReset != null and $newReset < $oldReset;
        def undercuts($new; $old; $newReset; $oldReset):
          $newReset != null and $oldReset != null and $newReset == $oldReset and $new < $old;
        if rewound($fr; .fiveResetAt) or rewound($sr; .sevenResetAt) then "behind"
        elif undercuts($f; (.five // 0); $fr; .fiveResetAt)
          or undercuts($s; (.seven // 0); $sr; .sevenResetAt) then "behind"
        else "publish" end' "$acct_row" 2>/dev/null) || acct_verdict=""
  fi
  if [ "$acct_verdict" != "behind" ]; then
    # `$$`-unique, like the usage sidecar's own tmp: the fixed `.{acct}.tmp`
    # this replaces was ONE path shared by every session on the account, so two
    # renders landing together truncated and wrote the same file at once.
    acct_tmp="$HOME/.cc-limits/.$acct_id.$$.tmp"
    printf '{"five":%s,"seven":%s,"ts":%s,"fiveResetAt":%s,"sevenResetAt":%s}\n' \
      "$five_int" "${seven_int:-0}" "$(date +%s)" "${five_reset:-null}" "${seven_reset:-null}" \
      > "$acct_tmp" && mv -f "$acct_tmp" "$acct_row" || rm -f "$acct_tmp" 2>/dev/null
  fi
fi

# ── Side-effect 2: the per-session usage sidecar (routing spec 2026-09-14 §6) ──
#    Keyed by the CCD ID — the tmux session name with `cc-` stripped, derived
#    exactly as session-hook.sh derives it — and NEVER by the Claude session
#    uuid: Claude Code rotates the uuid on /clear and on compaction (`_sync_uuid`
#    in ccd exists for that reason), so the uuid cannot key anything durable.
#    `ts` is THIS writer's clock, so a reader can tell a live reading from a
#    stale one the way `.cc-limits` rows carry it. A render that names an
#    `agent` is a SUBAGENT's status bar: it shares the parent's session id and
#    would overwrite the main-loop row, so it goes to `<id>.agents/<name>.json`.
#    Gated on `~/.cc-sessions` existing: a laptop with the same dotfiles and no
#    ccd gets no sidecar and no error. `model.id`, not `display_name`: the id is
#    what the server classifies (`familyClassOf`); the display name is for
#    people. Every failure below is silent on purpose — this runs on every
#    render of every session and must never cost the status bar.
#
#    WHICH IS WHY THE tmux CALL IS BOUNDED. This is the first thing this hook
#    has ever asked of tmux, and it runs on EVERY render of every session — a
#    tmux CLIENT blocks waiting on the server, and an unreachable tmux server is
#    a measured failure class on this fleet, not a hypothetical (`_substrate_mark`,
#    `FleetSession.substrate`). Unbounded, the render STALLS instead of printing,
#    and the status line is itself a surface the server reads back
#    (`parseStatusline`: model, effort, ultracode, ctxPct, branch) — so an
#    unreachable tmux would have gone on to blind that too, a new consequence
#    this block introduced and the sentence above promised it would not. Two
#    seconds is far beyond a healthy `display-message` and far below anything a
#    person would watch; on expiry `tname` is empty, which is the same silent
#    no-sidecar path as a pane outside tmux. If NEITHER spelling of the bound is
#    on the box the call is SKIPPED, not run unguarded: `tname` is empty — the
#    same silence again, never a stall. (`session-hook.sh` carries the unguarded
#    idiom deliberately: it runs per hook EVENT, not per render.)
#
#    AND THE BOUND IS SPELLED PORTABLY. `timeout` is GNU; macOS ships it only as
#    `gtimeout` (coreutils). This file is installed ALONE into ~/.claude with no
#    `ccd` to source, so it carries the SELECTION arm of ccd's `_plat_timeout`
#    rather than the shim itself — the "explicit template" allowance
#    `macos-platform.test.ts` makes for a file that cannot source the platform
#    block. Bare, the bound was a macOS-only outage of the whole sidecar and a
#    silent one: no `timeout` on PATH means the substitution never reaches tmux,
#    so every session on such a box wrote no sidecar, ever. `_plat_timeout`'s
#    third arm (the background watcher) is deliberately NOT copied: it costs a
#    fork and a stamp file on every render, and skipping one tmux question is
#    the cheaper honest answer here.
usage_dir="$HOME/.cc-sessions/usage"
ccd_id=""
if [ -n "${TMUX_PANE:-}" ] && [ -d "$HOME/.cc-sessions" ]; then
  sl_timeout=""
  for sl_bin in timeout gtimeout; do
    if command -v "$sl_bin" >/dev/null 2>&1; then sl_timeout="$sl_bin"; break; fi
  done
  tname=""
  [ -n "$sl_timeout" ] && tname=$("$sl_timeout" 2 tmux display-message -p '#S' 2>/dev/null)
  case "$tname" in cc-?*) ccd_id="${tname#cc-}" ;; esac
  case "$ccd_id" in *[!A-Za-z0-9._-]*) ccd_id="" ;; esac
fi
if [ -n "$ccd_id" ]; then
  agent_name=$(printf '%s' "$input" | jq -r '.agent.name // empty' 2>/dev/null)
  agent_ok=1
  if [ -n "$agent_name" ]; then
    case "$agent_name" in *[!A-Za-z0-9._-]*|.|..) agent_ok=0 ;; esac
  fi
  if [ "$agent_ok" = 1 ]; then
    usage_json=$(printf '%s' "$input" | jq -c \
      --arg ts "$(date +%s)" --arg acct "$acct_id" --arg agent "$agent_name" '{
        ts: ($ts | tonumber),
        uuid: (.session_id // null),
        account: (if $acct == "" then null else $acct end),
        model: (.model.id // null),
        effort: (.effort.level // null),
        ctxPct: (.context_window.used_percentage // null),
        cost: (.cost.total_cost_usd // null),
        agent: (if $agent == "" then null else $agent end)
      }' 2>/dev/null)
    if [ -n "$usage_json" ]; then
      if [ -n "$agent_name" ]; then
        usage_target_dir="$usage_dir/$ccd_id.agents"; usage_file="$usage_target_dir/$agent_name.json"
      else
        usage_target_dir="$usage_dir"; usage_file="$usage_dir/$ccd_id.json"
      fi
      # atomic tmp-and-rename, the registry's own discipline (`_reg_set`)
      usage_tmp="$usage_target_dir/.$ccd_id.$$.tmp"
      mkdir -p "$usage_target_dir" 2>/dev/null \
        && { printf '%s\n' "$usage_json" > "$usage_tmp"; } 2>/dev/null \
        && mv -f "$usage_tmp" "$usage_file" 2>/dev/null \
        || rm -f "$usage_tmp" 2>/dev/null
    fi
  fi
fi

# ── Assemble single-line output ───────────────────────────────────────────
if [ ${#segments[@]} -eq 0 ]; then
  printf "claude-code\n"
  exit 0
fi

output="${segments[0]}"
for ((i = 1; i < ${#segments[@]}; i++)); do
  output="${output}${SEP}${segments[$i]}"
done

printf "%s\n" "$output"
