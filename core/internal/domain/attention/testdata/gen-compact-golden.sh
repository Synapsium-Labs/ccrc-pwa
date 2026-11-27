#!/usr/bin/env bash
# Regenerates compact-programs.txt and compact.golden: the compaction arms' jq programs, cut from ccd/session-hook.sh (the
# predicate constants by their assignments, the inline programs by perl over the arms' text), and real jq's answer over each
# case of compact-cases.jsonl, run as the hook runs it: `<exit status> <stdout as hex, or ->`, one line a case after jq's
# version. Run on the Linux bench (bash gen-compact-golden.sh); compact_test.go holds attention to it and each cut program
# to the hook's text.
set -euo pipefail
cd "$(dirname "$0")"
HOOK=../../../../../ccd/session-hook.sh
eval "$(sed -n "/^JOURNAL_RECORD_PRED_DEFS='/,/^'\$/p" "$HOOK")"
eval "$(sed -n "/^JOURNAL_STAGE_PRED='/,/^'\$/p" "$HOOK")"
eval "$(grep '^COMPACT_SHAPE_PRED=' "$HOOK")"
eval "$(grep '^COMPACT_TEXT_JQ=' "$HOOK")"
cut() { perl -0ne "if (/$1/s) { print \$1 } else { exit 3 }" "$HOOK"; }
SETDOC=$(cut 'doc=\$\(jq -cn .*?\n\s*\x27(\{v:1, at:\$at.*?)\x27 2>\/dev\/null\)')
REC1=$(cut '\x27(\$s\[0\] as \$set.*?)\x27 2>\/dev\/null\)')
REC2=$(cut '\x27(\$m \+ \{served: \$sv, scope:.*?)\x27 2>\/dev\/null\)')
NORM=$(cut '"\$JOURNAL_RECORD_PRED_DEFS"\x27(.*?)\x27 "\$snap"')
{ printf '%s\n%s\n' '## setdoc' "$SETDOC"; printf '%s\n%s\n' '## rec1' "$REC1"; printf '%s\n%s\n' '## rec2' "$REC2"
  printf '%s\n%s\n' '## norm' "$NORM"; } > compact-programs.txt
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
jq --version > compact.golden
emit() { local rc=$1 hex; hex=$(od -v -An -tx1 < "$tmp/out" | tr -d ' \n'); printf '%s %s\n' "$rc" "${hex:--}" >> compact.golden; }
while IFS= read -r c; do
  k=$(jq -r .k <<<"$c")
  : > "$tmp/out"
  set +e
  case "$k" in
    overlap) jq -r '.snap' <<<"$c" | base64 -d > "$tmp/snap"; jq -e '.overlap == true' "$tmp/snap" >/dev/null 2>&1 ;;
    norm) jq -r '.snap' <<<"$c" | base64 -d > "$tmp/snap"; trig=$(jq -r .trig <<<"$c")
      jq -e --arg trig "$trig" "$JOURNAL_RECORD_PRED_DEFS$NORM" "$tmp/snap" >/dev/null 2>&1 ;;
    shape) m=$(jq -r '.meas' <<<"$c" | base64 -d); printf '%s' "$m" | jq -ce -s "length == 1 and (.[0] | $COMPACT_SHAPE_PRED)" >/dev/null 2>&1 ;;
    rec1) m=$(jq -r '.meas' <<<"$c"); sv=$(jq -r '.served' <<<"$c"); jq -r '.snap' <<<"$c" | base64 -d > "$tmp/snap"
      jq -cn --argjson m "$m" --slurpfile s "$tmp/snap" --argjson sv "$sv" "$REC1" > "$tmp/out" 2>/dev/null ;;
    rec2) m=$(jq -r '.meas' <<<"$c"); sv=$(jq -r '.served' <<<"$c"); norm=$(jq -r '.norm' <<<"$c")
      jq -cn --argjson m "$m" --argjson sv "$sv" --arg norm "$norm" "$REC2" > "$tmp/out" 2>/dev/null ;;
    pred) r=$(jq -r '.rec' <<<"$c"); printf '%s' "$r" | jq -ce "$JOURNAL_RECORD_PRED_DEFS JOURNAL_RECORD_PRED" >/dev/null 2>&1 ;;
    stage) jq -r '.stage' <<<"$c" | base64 -d > "$tmp/stage"; old=$(jq -j '.old' <<<"$c"; printf x); old=${old%x}; rec=$(jq -j '.rec' <<<"$c")
      jq -ce -R -s --arg rec "$rec" --arg old "$old" "$JOURNAL_RECORD_PRED_DEFS $JOURNAL_STAGE_PRED" < "$tmp/stage" >/dev/null 2>&1 ;;
    text) jq -r '.file' <<<"$c" | base64 -d > "$tmp/f"; r=$(jq -r .r <<<"$c")
      jq -r --arg r "$r" "$COMPACT_TEXT_JQ" "$tmp/f" > "$tmp/out" 2>/dev/null ;;
    setdoc) g() { jq -j ".$1" <<<"$c"; }
      jq -cn --arg scope "$(g scope)" --arg agent "$(g agent)" --arg t "$(g t)" --arg pl "$(g pl)" --arg ln "$(g ln)" \
        --arg nonce "$(g nonce)" --arg ovl "$(g ovl)" --arg cwd "$(g cwd)" --arg built "$(g built)" --arg fresh "$(g fresh)" \
        --argjson at "$(g at)" "$SETDOC" > "$tmp/out" 2>/dev/null ;;
    *) echo "unknown kind $k" >&2; exit 2 ;;
  esac
  rc=$?
  set -e
  emit "$rc"
done < compact-cases.jsonl
wc -l compact.golden
