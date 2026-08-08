#!/usr/bin/env bash
# ccd swap hook -> ccrc. $1 = human-readable message.
#
# The token authenticates THE BOX, which is the honest unit: every fleet session
# runs as one UNIX user and can read this file, so it proves "a process on the
# fleet host", never "this session" (spec:26-30, and the spec's own sentence
# about freshness rather than forgery-proofness). It closes the tailnet, not
# the box.
#
# An ABSENT token still sends: the server tolerates it for one deploy
# generation so a hook shipped before the token cannot go dark. Do not make
# this hard-fail — that turns a rollout ordering detail into a silent loss of
# every swap notice.
TOKEN_FILE="${CCRC_MAIL_TOKEN_FILE:-$HOME/.cc-secrets/ccrc-mail.token}"
tok=""
[ -r "$TOKEN_FILE" ] && tok="$(tr -d '\r\n' < "$TOKEN_FILE")"

curl -fsS -m 5 -X POST "http://${CCRC_ADDR:-203.0.113.7:7788}/api/notify" \
  -H 'content-type: application/json' \
  ${tok:+-H "x-ccrc-mail-token: $tok"} \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
