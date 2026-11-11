#!/bin/bash
# Regenerates traces/<name>.txt: one run per reading that the report cites.
cd "$(dirname "$0")"
mkdir -p traces
while read -r name args; do
  [ -z "$name" ] && continue
  python3 check.py $args > "traces/$name.txt" 2>&1
  echo "$name: $(grep -E '^===' "traces/$name.txt" | cut -c5-120 | tr '\n' ';')"
done <<'EOF'
safe-core core
safe-renewal renewal
safe-genmachine genmachine
safe-lineage lineage
core-outfirst core OUTCOME_REACH_TXN=outcome-first
core-split core RAISE_TXN=split
asks-refnone asks REFUSED_SETTLE=none
asks-done asks OUTCOME_AT=done
asks-settle asks REV_BUMP_AT=settle
race-stands race STALE_OPERATOR_TAP=stands
gen-literal genmachine CARD_DOOR_SKIPS=literal
gen-renew-active genmachine FAILED_RENEWAL_RETURNS=active
renew-active renewal FAILED_RENEWAL_RETURNS=active
gen-oldkey genmachine START_WHILE_DOWN=lost-oldkey
card-noholds renewal CARD_LISTS_HOLDS=False
card-cap renewal CARD_CAP=1
pause-brief pause PAUSE_REACH=brief-only
staging-noreach grants STAGING_REACHES=False
late-answer core ANSWER_CHECKS_DEADLINE=False DOORS_BEFORE_BOOT_PASS=True BOOT_UNMEASURED_RELEASES=False
boot-keeps core BOOT_UNMEASURED_RELEASES=False
push-noretry push RETRY_AT_RUNTIME=False
nohold-push nohold NONBLOCKING_PUSH=push
nohold-none nohold NONBLOCKING_PUSH=none
dead-all deadpush I9_SCOPE=all
value-entry value STATE_A_FACT_AUTH=entry
lineage-replace lineage REINHERIT=replace
lineage-opremove lineage OP_CLASS_REMOVALS=1
witness restore WITNESS_LAG=True
EOF
