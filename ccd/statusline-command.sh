#!/usr/bin/env bash
# ~/.claude/statusline-command.sh
# Claude Code statusLine — custom status bar
# Shared by all three accounts on server-box AND the Mac: each config dir's settings.json points here.

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
#      (claude2/claude-corp export it; bare `claude` leaves it unset → ~/.claude).
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
case "$cfg" in
  "$HOME/.claude")          acct="${CYAN}team·max${RESET}" ;;
  "$HOME/.claude-personal") acct="${MAGENTA}alt·max${RESET}" ;;
  "$HOME/.claude-corp")     acct="${BLUE}team·shared${RESET}" ;;
  "$HOME/.claude-dev0")     acct="${GREEN}lab·dev0${RESET}" ;;
  *)                        acct="$(basename "$cfg")" ;;
esac
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
#    account; last writer wins. Consumed by `ccd supervise` on server-box.
case "$cfg" in
  "$HOME/.claude")          lbl="claude" ;;
  "$HOME/.claude-personal") lbl="claude2" ;;
  "$HOME/.claude-corp")     lbl="claude-corp" ;;
  "$HOME/.claude-dev0")     lbl="claude-dev0" ;;
  *)                        lbl="" ;;
esac
if [ -n "$lbl" ] && [ -n "${five_int:-}" ]; then
  mkdir -p "$HOME/.cc-limits"
  # resets_at are unix-epoch seconds when each window rolls over (may be absent).
  five_reset=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.resets_at // "null"' 2>/dev/null)
  seven_reset=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.resets_at // "null"' 2>/dev/null)
  printf '{"five":%s,"seven":%s,"ts":%s,"fiveResetAt":%s,"sevenResetAt":%s}\n' \
    "$five_int" "${seven_int:-0}" "$(date +%s)" "${five_reset:-null}" "${seven_reset:-null}" \
    > "$HOME/.cc-limits/.$lbl.tmp" && mv -f "$HOME/.cc-limits/.$lbl.tmp" "$HOME/.cc-limits/$lbl.json"
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
