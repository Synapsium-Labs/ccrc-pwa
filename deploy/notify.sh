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

# Address resolution: CCRC_ADDR env > ~/.ccrc/ccrc.env's CCRC_HOST+CCRC_PORT.
# The env file is grepped, never sourced: it holds tokens (ccd/ccrc:355-380).
#
# CCRC_ADDR MAY CARRY A SCHEME (D-174), and on an exposed fleet it must. A box
# put behind a reverse proxy binds the server to LOOPBACK — that is the point
# of the proxy — at which point `host:port` from another machine reaches
# nothing. Measured 2026-08-23: after the reference server moved to a loopback
# bind, this hook's address answered `000` (connection refused) from the fleet
# host, and because the curl below ends `|| true`, every swap notice had been
# silently dropped with no error anywhere. An address with `://` is used
# verbatim; a bare `host:port` keeps the plain-http shape it always had.
ADDR="${CCRC_ADDR:-}"
# THE FLEET HOST'S TIER, and the one that fixes the proxied case. This hook
# runs on the FLEET box, which by design has no `~/.ccrc/ccrc.env` at all —
# `_check_config`'s D-86 note is explicit that its absence there is correct,
# not a gap. What that box does have is `agent.env`, and #89 already put the
# server's address in it as `CCRC_SERVER_URL`, "the address the coordination
# skills derive their HTTP API base from". Reusing it means the fleet box
# learns where the server is exactly ONCE, and this hook stops being a second
# thing to remember to provision. `ws(s)://` maps to `http(s)://` the same way
# the skills map it.
if [ -z "$ADDR" ] && [ -r "$HOME/.ccrc/agent.env" ]; then
  ADDR="$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$HOME/.ccrc/agent.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  case "$ADDR" in
    wss://*) ADDR="https://${ADDR#wss://}" ;;
    ws://*)  ADDR="http://${ADDR#ws://}" ;;
  esac
fi
if [ -z "$ADDR" ] && [ -r "$HOME/.ccrc/ccrc.env" ]; then
  _h="$(grep -E '^[[:space:]]*CCRC_HOST=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  _p="$(grep -E '^[[:space:]]*CCRC_PORT=' "$HOME/.ccrc/ccrc.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$_h" ] && [ -n "$_p" ] && ADDR="$_h:$_p"
fi

# No address configured is a SILENT NO-OP, deliberately (D-174). The legacy
# third tier here was the reference fleet's own IP, kept "one generation" so a
# hook shipped ahead of its config could not go dark; it outlived that
# generation and became a compiled-in address pointing at one operator's box —
# which, on anyone else's install, is a POST of this fleet's activity to a
# stranger's machine. Notify is best-effort by contract: a hook that cannot
# resolve an address sends nothing rather than guessing one.
[ -n "$ADDR" ] || exit 0
# Only the BASE is resolved here; the path stays on the curl line below. Two
# reasons, one of them measured: the endpoint being visible at the call site is
# how a reader knows what this hook talks to, and `auth-passkey.test.ts`'s
# consumer scan looks for a `/api/` path on a line that also says `curl` — a
# URL fully assembled up here reads to it as "no consumer", which is exactly
# the blind spot that scan exists to prevent. It caught this file mid-edit.
case "$ADDR" in
  *://*) BASE="${ADDR%/}" ;;
  *)     BASE="http://${ADDR}" ;;
esac

curl -fsS -m 5 -X POST "$BASE/api/notify" \
  -H 'content-type: application/json' \
  ${tok:+-H "x-ccrc-mail-token: $tok"} \
  -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
