#!/usr/bin/env bash
# Unit tests for ccd's home-affinity swap decision (_swap_target / _avail / _home_for /
# _id_wrapper / spend-block billing groups). Sources ccd into a scratch HOME so it never
# touches real state; the source-guard in ccd skips the command dispatch.
set -u
CCD="$(cd "$(dirname "$0")/../../ccd" && pwd)/ccd"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP"
mkdir -p "$HOME/.local/bin" "$HOME/.cc-limits" "$HOME/.cc-sessions"
for w in claude claude2 claude-corp; do printf '#!/bin/sh\n' > "$HOME/.local/bin/$w"; chmod +x "$HOME/.local/bin/$w"; done
. "$CCD"   # defines the functions; source-guard prevents the dispatch from running

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf 'ok   - %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf 'FAIL - %s (got [%s] want [%s])\n' "$1" "${2:-}" "${3:-}"; }
eq(){ [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }
_now(){ date +%s; }
lim(){ printf '{"five":%s,"seven":%s,"ts":%s}\n' "$2" "$3" "${4:-$(_now)}" > "$HOME/.cc-limits/$1.json"; }
reset(){ rm -f "$HOME/.cc-limits"/*.json "$HOME/.cc-sessions"/spendblock.* "$HOME/.cc-sessions"/*.home; }

# --- id -> home ---
eq "_id_wrapper claude-corp-*" "$(_id_wrapper claude-corp-custom-tools)" "claude-corp"
eq "_id_wrapper claude2-*"     "$(_id_wrapper claude2-MekWarLive)"       "claude2"
eq "_id_wrapper claude-*"      "$(_id_wrapper claude-rp-llm)"            "claude"
printf 'claude2' > "$HOME/.cc-sessions/claude-rp-llm.home"
eq "_home_for explicit override" "$(_home_for claude-rp-llm)" "claude2"
rm -f "$HOME/.cc-sessions/claude-rp-llm.home"
eq "_home_for default = id prefix" "$(_home_for claude-rp-llm)" "claude"

# --- _avail ---
reset; lim claude 20 30; _avail claude && ok "_avail: low load available" || no "_avail low"
reset; lim claude 100 30; _avail claude && no "_avail: 5h maxed" || ok "_avail: 5h maxed unavailable"
reset; lim claude 50 99;  _avail claude && no "_avail: weekly high" || ok "_avail: weekly>=ceiling unavailable"
reset; _avail claude && ok "_avail: no telemetry = free" || no "_avail: notel"

# --- _swap_target ---
reset; lim claude 30 30; lim claude2 40 40; lim claude-corp 40 40
eq "stay home when home ok" "$(_swap_target id claude claude)" ""

reset; lim claude 100 30; lim claude2 40 40; lim claude-corp 20 20
eq "home maxed -> least-loaded fallback" "$(_swap_target id claude claude)" "claude-corp"

reset; lim claude 20 20; lim claude2 40 40
eq "return home when it's free" "$(_swap_target id claude2 claude)" "claude"

reset; lim claude 100 30; lim claude2 40 40
eq "stay on working non-home (home down)" "$(_swap_target id claude2 claude)" ""

reset; lim claude 100 30; lim claude2 100 30; lim claude-corp 15 15
eq "cur+home down -> third account" "$(_swap_target id claude2 claude)" "claude-corp"

reset; lim claude 100 30; lim claude2 100 30; lim claude-corp 100 30
eq "nowhere available -> stay put" "$(_swap_target id claude claude)" ""

printf -- '---\nPASS=%d FAIL=%d\n' "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]
