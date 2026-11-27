#!/usr/bin/env bash
# Regenerates approval-cases.jsonl (gen-approval-cases.mjs) and approval.golden: what the bash's own approval code
# answers for each case, cut from ccd/session-hook.sh and run here with real jq, one JSON line a case. `canon` runs
# APPROVAL_DIGEST_JQ as the gate does; `granted`, `refused` and `ruled` run the wait's jq programs over a client answer,
# each cut from its line in `_hook_approval_wait`, with the statements around them as the wait spells them; `scan` runs
# `_apr_scan` over a transcript step by step; `patch` and `drop` run `_hook_approval_route_patch` and
# `_hook_approvals_drop` over a hookstate file. approval_test.go holds attention's approval deciders to it, and
# approval-program.sha256 pins the text it was measured from (TestApprovalProgramPinned). Run it from anywhere, with the
# jq to measure on PATH (made on the Linux bench, jq 1.7, and checked on jq 1.8).
set -uo pipefail
cd "$(dirname "$0")"
hook=../../../../../ccd/session-hook.sh
node gen-approval-cases.mjs
# On Windows a native jq needs -b (JQFLAGS=-b), for the cut functions too.
[[ -z "${JQFLAGS:-}" ]] || jq() { command jq $JQFLAGS "$@"; }
FNS=(_apr_deny_history _hook_approval_gate _apr_park_print _apr_call _apr_scan _hook_approval_route_patch _hook_approvals_drop _hook_approval_wait)
VARS=(APPROVAL_REQUEST_MAX_BYTES APPROVAL_DIGEST_JQ APPROVAL_HOOK_WAIT_S APPROVAL_HOOK_STOP_STATES APPROVAL_PARK_DENY_TAIL)
fn() { awk -v h="$1() {" 'index($0, h) == 1 {on=1} on {print} on && $0 == "}" {exit}' "$hook"; }
pinned() { local n; for n in "${FNS[@]}"; do fn "$n"; done; for n in "${VARS[@]}"; do grep -m1 "^$n=" "$hook"; done; }
pinned | sha256sum | cut -d' ' -f1 > approval-program.sha256
for n in _apr_scan _hook_approval_route_patch _hook_approvals_drop; do eval "$(fn "$n")"; done
for n in "${VARS[@]}"; do eval "$(grep -m1 "^$n=" "$hook")"; done
prog() { grep -m1 -F "$1" "$hook" | sed -E "s/.*jq -(r|c) '(.*)' <<<\"\\\$APR_BODY\".*/\2/"; }
P_GRANTED=$(prog '(.id | if type == "number"')
P_ERROR=$(prog '.error // "" | tostring')
P_STATE=$(prog '.state // "" | tostring')
P_RULING=$(prog '.ruling // empty')
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
REG=$tmp id=x f=$tmp/x.hookstate.json hs_skip=""
while IFS= read -r c; do
  case "$(jq -r .fn <<<"$c")" in
    canon)
      text=$(jq -j .text <<<"$c")
      canon=$(jq -cSa "$APPROVAL_DIGEST_JQ" <<<"$text" 2>/dev/null) && [[ "$canon" == '['* ]] || canon=none
      jq -cn --arg canon "$canon" '{canon: $canon}' ;;
    granted)
      APR_BODY=$(jq -j .body <<<"$c"); rid="" waits="" pk=""
      { read -r rid; read -r waits; IFS= read -r pk; } < <(jq -r "$P_GRANTED" <<<"$APR_BODY" 2>/dev/null)
      if [[ "${rid:-}" =~ ^[0-9]{1,15}$ && "${waits:-}" =~ ^[0-9]{1,6}$ ]]; then
        jq -cn --arg rid "$rid" --arg waits "$waits" --arg pk "$pk" '{ok: true, rid: $rid, waits: $waits, pk: $pk}'
      else jq -cn '{ok: false}'; fi ;;
    refused)
      APR_BODY=$(jq -j .body <<<"$c"); APR_CODE=$(jq -r .code <<<"$c")
      w=$(jq -r "$P_ERROR" <<<"$APR_BODY" 2>/dev/null) || w=""
      [[ "$w" =~ ^[a-z][a-z0-9-]{0,47}$ ]] || w="http-$APR_CODE"
      jq -cn --arg r "request-refused:$w" '{route: $r}' ;;
    ruled)
      APR_BODY=$(jq -j .body <<<"$c"); v=more j=""
      state=$(jq -r "$P_STATE" <<<"$APR_BODY" 2>/dev/null) || state=""
      for st in $APPROVAL_HOOK_STOP_STATES; do [[ "$state" == "$st" ]] && v=stop; done
      [[ $v == more && "$state" == parked ]] && v=parked
      if [[ $v == more ]]; then j=$(jq -c "$P_RULING" <<<"$APR_BODY" 2>/dev/null) || j=""; fi
      jq -cn --arg v "$v" --arg j "$j" '{verdict: $v, j: $j}' ;;
    scan)
      apr_ti=$(jq -r .ti <<<"$c"); apr_tp=$tmp/t.jsonl; apr_tie="" apr_off=0 apr_seen=-1; outs=()
      rm -f "$apr_tp"
      for ((i = 0; i < $(jq '.steps | length' <<<"$c"); i++)); do
        s=$(jq -r ".steps[$i] // \"-\"" <<<"$c")
        if [[ $s == - ]]; then rm -f "$apr_tp"; else printf '%s' "$s" | base64 -d > "$apr_tp"; fi
        _apr_scan; rc=$?
        outs+=("$rc|$apr_tie|$apr_off|$apr_seen")
      done
      jq -cn '{steps: $ARGS.positional}' --args "${outs[@]}" ;;
    patch)
      out=$(jq -r .out <<<"$c"); aid=$(jq -r .aid <<<"$c"); ap_at=$(jq -r .at <<<"$c")
      jq -r .cur <<<"$c" | base64 -d > "$f"
      _hook_approval_route_patch "$(jq -r .word <<<"$c")"
      jq -cn --arg file "$(base64 -w0 < "$f")" '{file: $file}' ;;
    drop)
      aid=$(jq -r .aid <<<"$c"); ap_at=$(jq -r .at <<<"$c")
      jq -r .file <<<"$c" | base64 -d > "$f"
      _hook_approvals_drop
      jq -cn --arg file "$(base64 -w0 < "$f")" '{file: $file}' ;;
  esac
done < approval-cases.jsonl > approval.golden
wc -l approval-cases.jsonl approval.golden
