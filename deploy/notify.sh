#!/usr/bin/env bash
# ccd swap hook -> ccrc. $1 = human-readable message.
curl -fsS -m 5 -X POST "http://${CCRC_ADDR:-203.0.113.7:7788}/api/notify" \
  -H 'content-type: application/json' \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
