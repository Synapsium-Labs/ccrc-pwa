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
# `tr -d '[:space:]'`, not `tr -d '\r\n'`: the server reads its copy of the
# SAME file with `readFileSync(...).trim()` (coord/token.ts), which strips a
# trailing space or tab as readily as a newline. A `tr` that only deleted CR/LF
# left a stray trailing space on either box's copy producing two different
# byte strings from one committed file — a length mismatch `checkMailToken`
# has to call `'bad'`, permanently and silently (no journal line survives a
# `curl ... >/dev/null 2>&1 || true` here, or the `>/dev/null 2>&1` ccd wraps
# this script's invocation in). Stripping ALL whitespace is safe for the
# token itself: `openssl rand -hex 32` never produces any.
TOKEN_FILE="${CCRC_MAIL_TOKEN_FILE:-$HOME/.cc-secrets/ccrc-mail.token}"
tok=""
[ -r "$TOKEN_FILE" ] && tok="$(tr -d '[:space:]' < "$TOKEN_FILE")"

curl -fsS -m 5 -X POST "http://${CCRC_ADDR:-203.0.113.7:7788}/api/notify" \
  -H 'content-type: application/json' \
  ${tok:+-H "x-ccrc-mail-token: $tok"} \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
