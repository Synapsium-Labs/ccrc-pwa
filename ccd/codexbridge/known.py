"""codexbridge.known — the names the bridge expects to see, per stats family; any other name is `unexplained`.

Codex-bridge spec 2026-10-15 §2.9, D3 ("Names only, never content: unknown request fields, event types, item types,
error codes, incomplete reasons, response headers, unsupported-field names, model substitutions … the doctor warns
on a new name"); plan 2026-10-22, Task 5 and D-6418 (the names go to the stats file). `stats.Stats` records a name
outside this table in the stats file's `unexplained`, and Task 17's doctor row WARNs on it. A name is explained only
here, in a reviewed change: the rollout of that change restarts the bridge, whose stats file then drops the name at
load (`stats.Stats`).

EVERY NAME BELOW IS MEASURED OR SOURCED, never guessed, so a name the bridge has not seen yet WARNs once and is then
explained here or fixed. The sources:
- Claude Code 2.1.308 against a local stub (the plan's "What was measured", 27 runs, 75 requests): every message
  request carries `model, messages, system, tools, metadata, max_tokens, thinking, context_management,
  output_config, stream`; `context_management` is always the one edit `clear_thinking_20251015`; tools carry
  `defer_loading`; `output_config.effort` rides the `effort-2025-11-24` beta (`ccd/ccgpt-proxy.py`'s effort hook).
- The fields inbound drops by rule (D-6426 and the plan's Task 2 table), and the names inbound counts for a shape
  it maps (a dropped `thinking` block, `is_error`, `output_config.format`, D-6425) or refuses by name (a `document`
  block, an `output_config.format` of another type, D-6414).
- The Codex CLI's own reader of the same wire (upstream openai/codex @ 092d3ac, `codex-rs/`): the event types it
  reads or skips (codex-api/src/sse/responses.rs:347-501), the response headers it reads
  (codex-api/src/sse/responses.rs:31-34, 43-72), and the `x-codex-` header family it reads by prefix
  (codex-api/src/rate_limits.rs:28-48, 63-67, 180-231; codex-api/src/safety_buffering.rs:4-6).
- The reducer's and the error table's own sets, imported, never re-spelled: `reducer.IGNORED_EVENTS`,
  `reducer.KNOWN_INCOMPLETE`, `errors.ALL_CODES` (the single-definition row: an upstream code is spelled only in
  errors.py).

NOT HERE, ON PURPOSE: `clear_tool_uses_20250919` (D-6417: the doctor names that edit the first day it arrives); a
reasoning item with no encrypted content (`reducer.UNREADABLE_REASONING`: a reply whose reasoning cannot be replayed
is drift); every model substitution (each is a Claude Code fallback worth seeing).

MEASURED SINCE: the response headers of the backend's front end. The runbook's first live step (step 2, 2026-10-27)
printed every answer's header names, and each name every answer carried is now in `responseHeader` below, with what
it is (D-7083): the edge and security headers, the cookie, `x-oai-request-id` (D-7084) and a 2xx stream's absent
content type. A name the front end adds later still WARNs once, as any new name does.
"""

from typing import Dict, FrozenSet, Tuple

from . import errors, reducer

# The `x-codex-` response headers: the usage poller's family (`ccd/ccgpt-usage.py`), and Codex's rate-limit, credit
# and safety-buffering headers. Read by this prefix only, so the poller's five names stay spelled once (the plan's
# Global Constraints). `stats.Stats.usage_headers` keeps their values by the same prefix, under the rule its docstring
# states: a decimal number or a boolean (stats.USAGE_VALUE_RE), and never a stats.TOKEN_HEADERS name's value.
CODEX_HEADER_PREFIX = "x-codex-"

# The event types the reducer acts on (reducer.Reducer.feed) are not listed: the reducer never counts one, so a copy
# here would only hide the drift of the reducer ceasing to handle one.
# The event types the Codex CLI skips on purpose over HTTP SSE (codex-api/src/sse/responses.rs:480-491) that the
# reducer's IGNORED_EVENTS does not hold.
_CODEX_SKIPPED_EVENTS = frozenset({"codex.response.metadata", "response.metadata"})

KNOWN = {
    "requestField": frozenset({
        # measured on every Claude Code 2.1.308 message request
        "system", "metadata", "max_tokens", "thinking",
        # dropped by rule (D-6426; inbound.READ_KEYS' comment)
        "temperature", "top_p", "top_k", "stop_sequences", "service_tier", "mcp_servers", "container",
        # the names inbound counts for a shape it maps
        "thinking-block", "is_error", "defer_loading", "output_config.format",
    }),
    "eventType": reducer.IGNORED_EVENTS | _CODEX_SKIPPED_EVENTS,
    # R12's unmapped items, skipped and counted (plan Task 3)
    "itemType": frozenset({"web_search_call", "image_generation_call", "compaction"}),
    "errorCode": errors.ALL_CODES,
    "incompleteReason": reducer.KNOWN_INCOMPLETE,
    "responseHeader": frozenset({
        # read by Codex (responses.rs:31-34, 43-72) and by the error table (errors.py: the request id, retry-after)
        "openai-model", "x-reasoning-included", "x-models-etag", "x-request-id", "request-id", "retry-after",
        # the HTTP framing http.client itself reads, and the origin's Date (RFC 9110 §6.6.1, §8.3, §8.6; RFC 9112 §6)
        "content-type", "content-length", "transfer-encoding", "connection", "date",
        # the media type, counted as a name (the plan's Global Constraints): a stream, and an error body
        "content-type:text/event-stream", "content-type:application/json",
        # Every name below was measured on every answer of runbook step 2 (2026-10-27; D-7083). Only the name is
        # counted: stats.Stats.header_names keeps no value, and stream.AnthropicStream writes its own head.
        # The upstream request id: the backend's one, sent with no x-request-id and no request-id. errors.request_id_of
        # reads it third, as Codex does (openai/codex codex-rs/codex-api/src/api_bridge.rs at rust-v0.164.0,
        # extract_request_id; D-7084).
        "x-oai-request-id",
        # A backend 2xx stream carries no content type (server._media_type counts it so); it is reduced as a stream.
        "content-type:absent",
        # The CDN's edge: the server name, the ray id and the cache status. Codex reads cf-ray only, as a request
        # tracking id when no request id came (openai/codex codex-rs/codex-api/src/api_bridge.rs at rust-v0.164.0,
        # extract_request_tracking_id); nothing here reads one.
        "server", "cf-ray", "cf-cache-status",
        # The load-balancer and CDN cookies. Codex keeps only infrastructure cookies in its jar (openai/codex
        # codex-rs/http-client/src/chatgpt_cloudflare_cookies.rs at rust-v0.164.0); the bridge keeps none and sends
        # no Cookie (backend.build_headers).
        "set-cookie",
        # The browser policy and reporting headers of the origin's front end, read by nothing here or in Codex.
        "nel", "report-to", "strict-transport-security", "x-content-type-options", "cross-origin-opener-policy",
        "referrer-policy",
        # The origin proxy's own marker, read by nothing here or in Codex.
        "x-openai-proxy-wasm",
    }),
    "unsupportedField": frozenset({"document", "output_config.format"}),
    "modelSubstitution": frozenset(),
    "betaValue": frozenset({"effort-2025-11-24"}),
    "contextEdit": frozenset({"clear_thinking_20251015"}),
}  # type: Dict[str, FrozenSet[str]]

# Families whose names are also explained by a prefix (the x-codex- family above).
PREFIXES = {"responseHeader": (CODEX_HEADER_PREFIX,)}  # type: Dict[str, Tuple[str, ...]]


def explained(family: str, name: str) -> bool:
    """True when `name` is a known name of `family`, or carries one of that family's known prefixes."""
    if name in KNOWN.get(family, frozenset()):
        return True
    return any(name.startswith(p) for p in PREFIXES.get(family, ()))
