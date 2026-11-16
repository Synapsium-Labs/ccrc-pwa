#!/bin/sh
# Runs every check twice: against the text as written, and with the rules REPORT.md proposes (FIX=1).
# Output goes to out/<script>.txt and out/<script>.fixed.txt. Exit status 0 always: a CE line is a finding, not a crash.
cd "$(dirname "$0")" || exit 1
mkdir -p out
for s in d02_generation d03_roleof d04_reservation d05_readiness d06_askoract d07_class d08_push d09_followup d10_rank d11_mayact d13_brief d14_states v_vocab; do
  python3 "$s.py" > "out/$s.txt" 2>&1 || echo "$s.py exited $?" >> "out/$s.txt"
  FIX=1 python3 "$s.py" > "out/$s.fixed.txt" 2>&1 || echo "$s.py exited $?" >> "out/$s.fixed.txt"
  printf '%-18s %3s CE as written, %3s with the proposed edits\n' "$s" "$(grep -c '^CE ' "out/$s.txt")" "$(grep -c '^CE ' "out/$s.fixed.txt")"
done
