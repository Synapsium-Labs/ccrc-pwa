#!/usr/bin/env bash
# Regenerates delegation.golden: what real jq prints for `spool` and `lrec` (DSP_DEFS, cut from ccd/session-hook.sh,
# with the parse's own preamble defs and `now` fixed) over the hand-made cases (delegation-synthetic.jsonl, made by
# gen-delegation-cases.mjs) and three versions of the capture corpus (server/test/fixtures/delegation). One line per
# (case, cap): `[<spool's four lines>, <lrec's row>]`. delegation_test.go holds attention.SpoolLine and attention.LaunchRow
# to it, and pins the program's text by sha256, so a change to the bash's program is red there. Made on the Linux
# bench (jq 1.7); run it from anywhere with the jq to measure on PATH. The clock is 1700000000.5 s.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")"
hook=../../../../../ccd/session-hook.sh
defs=$(grep -m1 "^DSP_DEFS='" "$hook")
defs=${defs#DSP_DEFS=\'}
defs=${defs%%\'; dsp_dir=*}
pre='def keep(f): explode | map(select(f)) | implode; def alpha: (. >= 65 and . <= 90) or (. >= 97 and . <= 122); def idch: alpha or (. >= 48 and . <= 57) or . == 95 or . == 45; def idmax: 64; def now: 1700000000.5;'
printf '%s' "$defs" | sha256sum | cut -d' ' -f1 > delegation-program.sha256
run() { # <payload json> <cap> <ver> <wr>
  jq -c --arg sid demo-quiet-basin --arg gen 0189abcd-1234-5678-9abc-0123456789ab --arg ver "$3" --arg wr "$4" \
    "$pre def dspcap: $2; $defs"' [(try spool catch ["", "", "", ""]), ([try lrec catch ""] | if length == 1 and (.[0] | type) == "string" then .[0] else "" end)]' <<<"$1"
}
{
  while IFS= read -r c; do
    p=$(jq -c .p <<<"$c"); ver=$(jq -r '.ver // "2.1.318"' <<<"$c"); wr=$(jq -r '.wr // "lane-a"' <<<"$c")
    for cap in 4096 1008 400 300 260; do run "$p" "$cap" "$ver" "$wr"; done
  done < delegation-synthetic.jsonl
  for v in 2.1.280 2.1.318 2.1.319; do
    for f in ../../../../../server/test/fixtures/delegation/$v/*.json; do
      while IFS= read -r p; do for cap in 4096 1008; do run "$p" "$cap" 2.1.318 lane-a; done; done < <(jq -c '.events[].payload' "$f")
    done
  done
} > delegation.golden
wc -l delegation.golden
