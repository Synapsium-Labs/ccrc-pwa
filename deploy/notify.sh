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
#
# THE EXTRACTION RULE BELOW MUST STAY IDENTICAL TO `coord/token.ts`'s
# `readMailToken`/`extractToken`, WHICH READS THIS SAME COMMITTED FILE ON THE
# OTHER BOX (fix-round finding 1): first line that is neither blank nor a
# `#`-comment, whitespace stripped from it EVERYWHERE, not just the edges.
# The character CLASS used to match (`tr -d '[:space:]'` here, `.trim()`
# there) but the SCOPE did not — edges-only vs. everywhere — so any content
# with INTERIOR whitespace produced two different secrets from one committed
# file, permanently and silently (no journal line survives a
# `curl ... >/dev/null 2>&1 || true` here, or the `>/dev/null 2>&1` ccd wraps
# this script's invocation in). `deploy/ccrc-mail.token.example`'s own
# `#`-comment preamble is exactly that content, which is why comment lines
# are skipped rather than folded into the token: without the skip, the
# documented `cp *.example ccrc-mail.token && edit` setup path would ship a
# secret whose leading bytes are a comment nobody meant to sign with.
TOKEN_FILE="${CCRC_MAIL_TOKEN_FILE:-$HOME/.cc-secrets/ccrc-mail.token}"
tok=""
if [ -r "$TOKEN_FILE" ]; then
  tok="$(grep -v '^[[:space:]]*#' "$TOKEN_FILE" | grep -v '^[[:space:]]*$' | head -n1 | tr -d '[:space:]')"
fi

# Address resolution: CCRC_ADDR env > ~/.ccrc/ccrc.env's CCRC_HOST+CCRC_PORT >
# the reference fleet's legacy IP (kept one generation so a hook shipped ahead
# of the config file cannot go dark — same tolerance as the token above).
# The env file is grepped, never sourced: it holds tokens (ccd/ccrc:355-380).
ADDR="${CCRC_ADDR:-}"
if [ -z "$ADDR" ] && [ -r "$HOME/.ccrc/ccrc.env" ]; then
  _h="$(grep -E '^[[:space:]]*CCRC_HOST=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  _p="$(grep -E '^[[:space:]]*CCRC_PORT=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$_h" ] && [ -n "$_p" ] && ADDR="$_h:$_p"
fi
ADDR="${ADDR:-203.0.113.7:7788}"

curl -fsS -m 5 -X POST "http://${ADDR}/api/notify" \
  -H 'content-type: application/json' \
  ${tok:+-H "x-ccrc-mail-token: $tok"} \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
