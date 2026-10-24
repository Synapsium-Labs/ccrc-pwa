"""codexbridge.errors — the bridge's error table: an upstream failure becomes an Anthropic error.

Codex-bridge spec 2026-10-15 §2.4; plan 2026-10-22, "The bridge's contract": the error table, and D-6411 (policy),
D-6412 (usage limit), D-6413 (throttling), D-6414 (an unmapped feature), D-6415 (the prompt-too-long numbers). Error
shapes follow Claude Code 2.1.308's embedded gateway contract where it has one.

Every failure is one BridgeError. Before the commit point it is answered as a real HTTP status (`http_answer`); after
it, as one `error` event with no `message_stop` (`event`). The two carry the same `error.type` and message.

THE UPSTREAM CODES ARE SPELLED HERE ONLY. Seven sets, and ALL_CODES, their union, which the known-names table
(Task 5) is built from rather than re-spelled. The codes are the ChatGPT backend's, as the Codex CLI reads them
(upstream openai/codex @ 092d3ac: codex-rs/codex-api/src/api_bridge.rs:101-218,
codex-rs/codex-api/src/sse/responses_error.rs:26-103, codex-rs/codex-api/src/sse/responses.rs:1137).

`classify_http` reads the body's `error.code`, then its `error.type`, BEFORE the HTTP status, so a code's row wins over
its status's row: `slow_down` and `server_is_overloaded` both arrive as an HTTP 503.

NO ANSWER FORMATS THE UPSTREAM BODY. A message names the row and the upstream code (bounded by CODE_RE, else
`unrecognised`), never the upstream message or any other field. The one field read for its text is an HTTP 400's
`error.message`, tested for "context window" and never kept. The request id is kept only when it matches
REQUEST_ID_RE, as Stage 1's status file bounds it (`ccd/ccgpt-auth.py`).

THE OVERFLOW'S NUMBERS. The backend's overflow message carries no token counts, so `classify_http` and
`classify_failed` answer the overflow row (kind `overflow`) with the bare text `prompt is too long`, which Claude
Code's loose match already reads as an overflow; the server, which holds the D24 estimate N and the lane's window,
answers `overflow(n, m)` in its place, keeping the request id (D-6415, Task 8).
"""

import json
import math
import re
from typing import Dict, Mapping, Optional, Tuple

from . import sse

# ── the code sets ────────────────────────────────────────────────────────────────────────────────────────────────
# The prompt did not fit the model's window (`response.failed`, or an HTTP 400).
OVERFLOW_CODES = frozenset({"context_length_exceeded"})
# A plan or spend limit: the lane is paused until its window resets (D-6412).
QUOTA_CODES = frozenset({
    "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded", "organization_usage_limit_exceeded",
})
# The backend's usage limit, which it sends as an `error.type` on an HTTP 429 body (api_bridge.rs:187-218). The table
# reads it as a code or a type, at any HTTP status and in a `response.failed`, as it reads every set here.
USAGE_LIMIT_TYPES = frozenset({"usage_limit_reached"})
# Throttling, worth a retry (D-6413). `slow_down` arrives as an HTTP 503 (api_bridge.rs:101-115).
TRANSIENT_RATE_CODES = frozenset({"rate_limit_exceeded", "slow_down"})
# The account's plan does not include Codex usage.
INELIGIBLE_CODES = frozenset({"usage_not_included"})
# A policy refusal (D-6411; api_bridge.rs:120-171, responses_error.rs:26-103).
POLICY_CODES = frozenset({"cyber_policy", "bio_policy", "invalid_prompt", "misalignment_policy_violation"})
# The upstream is overloaded.
OVERLOAD_CODES = frozenset({"server_is_overloaded", "flex_unavailable"})

ALL_CODES = (OVERFLOW_CODES | QUOTA_CODES | USAGE_LIMIT_TYPES | TRANSIENT_RATE_CODES | INELIGIBLE_CODES | POLICY_CODES
             | OVERLOAD_CODES)

# Stage 1's bounds (`ccd/ccgpt-auth.py`'s CODE_RE and REQUEST_ID_RE): a code is kept lower-cased when it matches,
# else as UNRECOGNISED_CODE; a request id is kept only when it matches. COPIED, not imported: this module must answer
# `auth-library-absent` when the library does not load, so it cannot read the library's constants at import.
# codex-bridge-errors.test.ts loads the library by path and asserts both patterns equal its own.
CODE_RE = re.compile(r"^[a-z0-9_.-]{1,64}$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
UNRECOGNISED_CODE = "unrecognised"
RETRY_AFTER_RE = re.compile(r"^[0-9]{1,7}$")  # an upstream `retry-after` is passed through only as delta-seconds

# An HTTP 400 whose message says this is an overflow even with no code (responses_error.rs:47-48).
OVERFLOW_PHRASE = "context window"

# ── the AuthError rows (Stage 1's words) ─────────────────────────────────────────────────────────────────────────
# The credential is unusable until the operator acts: 401, never retried.
AUTH_DEAD_WORDS = frozenset({
    "needs-signin", "not-logged-in", "config-error", "foreign-family", "credential-unusable", "auth-endpoint-refused",
})
# Transient: 503 with no `x-should-retry`, so Claude Code retries twice.
AUTH_TRANSIENT_WORDS = frozenset({"refresh-failed", "auth-lock-busy"})
# Not a library word: the bridge raises it itself when CCRC_CODEX_AUTH_LIB does not load.
AUTH_LIBRARY_ABSENT = "auth-library-absent"

# ── the Anthropic error types ────────────────────────────────────────────────────────────────────────────────────
INVALID_REQUEST = "invalid_request_error"
BILLING = "billing_error"
RATE_LIMIT = "rate_limit_error"
PERMISSION = "permission_error"
POLICY_BLOCKED = "policy_blocked"
OVERLOADED = "overloaded_error"
API_ERROR = "api_error"
AUTHENTICATION = "authentication_error"
NOT_FOUND = "not_found_error"

NO_RETRY = {"x-should-retry": "false"}

# The states the bridge records through the library's `record_upstream` (Task 6); both are in Stage 1's STATES.
STATE_LIMIT_PAUSED = "limit-paused"
STATE_INELIGIBLE = "ineligible"


class BridgeError(Exception):
    """One failure. `status` and `headers` are the real HTTP answer before the commit point; `etype` and `message`
    are the Anthropic `error.type` and message, before and after it. `state` is what the bridge records in the
    status file (`limit-paused`, `ineligible`), else None. `code` is the upstream code, bounded; `request_id` the
    upstream request id, bounded. `kind` names the table row: overflow, billing, rate, ineligible, policy,
    overloaded, unavailable, refused, auth, capability."""

    def __init__(self, status: int, etype: str, message: str, headers: Optional[Dict[str, str]] = None,
                 state: Optional[str] = None, code: Optional[str] = None, request_id: Optional[str] = None,
                 kind: str = "refused") -> None:
        super().__init__(message)
        self.status = status
        self.etype = etype
        self.message = message
        self.headers = dict(headers or {})
        self.state = state
        self.code = code
        self.request_id = request_id
        self.kind = kind


# ── reading an upstream answer ───────────────────────────────────────────────────────────────────────────────────
def _bounded_code(value: object) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    lowered = value.lower()
    return lowered if CODE_RE.fullmatch(lowered) else UNRECOGNISED_CODE


def _error_object(obj: object) -> Optional[dict]:
    """The `error` object of a body (`{"error": {...}}`), or the object itself when it carries a `code` (a
    `response.failed`'s `response.error`, a top-level `error` event)."""
    if not isinstance(obj, dict):
        return None
    inner = obj.get("error")
    if isinstance(inner, dict):
        return inner
    return obj


def _names(err: Optional[dict]) -> Tuple[Optional[str], Optional[str]]:
    """(code, type), each bounded; the code is `error.code`, else a string `error` (a bare `{"error": "<code>"}`)."""
    if err is None:
        return None, None
    code = _bounded_code(err.get("code"))
    if code is None and isinstance(err.get("error"), str):
        code = _bounded_code(err["error"])
    etype = err.get("type")
    return code, (_bounded_code(etype) if etype != "error" else None)


def _header(headers: object, name: str) -> Optional[str]:
    get = getattr(headers, "get", None)
    if get is None:
        return None
    value = get(name)
    if value is None and hasattr(headers, "items"):
        for k, v in headers.items():  # a plain dict whose keys are not lower-cased
            if isinstance(k, str) and k.lower() == name:
                value = v
                break
    return value if isinstance(value, str) else None


def request_id_of(headers: object) -> Optional[str]:
    """The upstream request id (`x-request-id`, else `request-id`), kept only under REQUEST_ID_RE; else None."""
    for name in ("x-request-id", "request-id"):
        value = _header(headers, name)
        if value is not None:
            return value if REQUEST_ID_RE.fullmatch(value) else None
    return None


def _number(value: object) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:  # an integer too large for a float: JSON allows one, and the upstream sends the body
        return None
    return number if math.isfinite(number) else None


def _retry_after_from_reset(err: Optional[dict], now: float) -> Optional[str]:
    """Seconds until the limit resets: `resets_at` (epoch seconds), else `resets_in_seconds` (the usage-limit body
    measured in spec 2026-09-13's S1-R10 row named that field); None when unknown or already past."""
    if err is None:
        return None
    at = _number(err.get("resets_at"))
    delta = (at - now) if at is not None else _number(err.get("resets_in_seconds"))
    if delta is None or delta <= 0:
        return None
    return str(int(math.ceil(min(delta, 1e7 - 1))))


def _says(code: Optional[str]) -> str:
    return code if code is not None else "no code"


# ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _overflow_unknown(rid: Optional[str]) -> BridgeError:
    """The overflow row before its numbers are known; its code is the overflow code, whatever the upstream named."""
    return BridgeError(400, INVALID_REQUEST, "prompt is too long", code="context_length_exceeded", request_id=rid,
                       kind="overflow")


def _billing(code: str, err: Optional[dict], rid: Optional[str], now: float) -> BridgeError:
    headers = {}
    retry_after = _retry_after_from_reset(err, now)
    if retry_after is not None:
        headers["retry-after"] = retry_after
    headers.update(NO_RETRY)
    return BridgeError(429, BILLING, "usage limit reached (%s): the lane's plan limit is spent until it resets" % code,
                       headers, STATE_LIMIT_PAUSED, code, rid, "billing")


def _rate(code: Optional[str], retry_after: Optional[str], rid: Optional[str]) -> BridgeError:
    headers = {"retry-after": retry_after} if retry_after is not None else {}
    return BridgeError(429, RATE_LIMIT, "rate limited upstream (%s)" % _says(code), headers, None, code, rid, "rate")


def _ineligible(code: str, rid: Optional[str]) -> BridgeError:
    return BridgeError(403, PERMISSION, "%s: this account's plan does not include Codex usage" % code, dict(NO_RETRY),
                       STATE_INELIGIBLE, code, rid, "ineligible")


def _policy(code: str, rid: Optional[str]) -> BridgeError:
    return BridgeError(400, POLICY_BLOCKED, "policy_blocked: the upstream refused the request (%s)" % code,
                       dict(NO_RETRY), None, code, rid, "policy")


def _overloaded(code: str, rid: Optional[str]) -> BridgeError:
    return BridgeError(529, OVERLOADED, "upstream overloaded (%s)" % code, None, None, code, rid, "overloaded")


def unavailable(what: str, code: Optional[str] = None, rid: Optional[str] = None) -> BridgeError:
    """The unavailable row (spec §2.4 "529 or 503"), its one writer: the reducer's no-terminal and unknown-reason
    failures are built here too."""
    return BridgeError(503, API_ERROR, "upstream unavailable (%s)" % what, None, None, code, rid, "unavailable")


def _by_code(code: Optional[str], etype: Optional[str], err: Optional[dict], rid: Optional[str], now: float,
             retry_after: Optional[str]) -> Optional[BridgeError]:
    """The row a code or type names, or None when neither is in a set."""
    for name in (code, etype):
        if name is None:
            continue
        if name in OVERFLOW_CODES:
            return _overflow_unknown(rid)
        if name in USAGE_LIMIT_TYPES or name in QUOTA_CODES:
            return _billing(name, err, rid, now)
        if name in TRANSIENT_RATE_CODES:
            return _rate(name, retry_after, rid)
        if name in INELIGIBLE_CODES:
            return _ineligible(name, rid)
        if name in POLICY_CODES:
            return _policy(name, rid)
        if name in OVERLOAD_CODES:
            return _overloaded(name, rid)
    return None


def classify_http(status: int, body: bytes, headers: Mapping[str, str], *, now: float) -> BridgeError:
    """An upstream HTTP answer that is not a 2xx stream. The body's code and type are read first; the status decides
    only when neither is in a set."""
    try:
        obj = json.loads(body.decode("utf-8")) if body else None
    except (ValueError, UnicodeError, RecursionError):
        obj = None
    err = _error_object(obj)
    code, etype = _names(err)
    rid = request_id_of(headers)
    raw_retry = _header(headers, "retry-after")
    retry_after = raw_retry.strip() if raw_retry is not None and RETRY_AFTER_RE.fullmatch(raw_retry.strip()) else None
    shown = code if code is not None else etype
    row = _by_code(code, etype, err, rid, now, retry_after)
    if row is not None:
        return row
    if status == 400 and err is not None:
        message = err.get("message")
        if isinstance(message, str) and OVERFLOW_PHRASE in message.lower():
            return _overflow_unknown(rid)
    if status == 401:
        return BridgeError(401, AUTHENTICATION, "the upstream refused the lane's token (%s)" % _says(shown),
                           dict(NO_RETRY), None, shown, rid, "auth")
    if status == 429:
        return _rate(shown, retry_after, rid)
    if status == 403 and not isinstance(obj, dict):
        # a 403 whose body is not a JSON object is an edge's page (a Cloudflare challenge), not the backend's refusal;
        # a JSON 403 with no code is the backend's, and takes the other-4xx row below
        return unavailable("HTTP 403 that is not the backend's JSON", None, rid)
    if 400 <= status < 500:
        return BridgeError(status, INVALID_REQUEST, "the upstream refused the request: %s"
                           % (shown if shown is not None else "HTTP %d" % status), None, None, shown, rid, "refused")
    return unavailable("HTTP %d" % status if isinstance(status, int) else "HTTP ?", shown, rid)


def classify_failed(error: Optional[dict], *, now: float) -> BridgeError:
    """A `response.failed`'s `response.error`, or a top-level `error` event's body. A code no set holds, or none, is
    the unavailable row."""
    err = _error_object(error)
    code, etype = _names(err)
    row = _by_code(code, etype, err, None, now, None)
    if row is not None:
        return row
    shown = code if code is not None else etype
    return unavailable("the response failed: %s" % _says(shown), shown, None)


def overflow(n: int, m: int) -> BridgeError:
    """The prompt-too-long refusal, in the exact text Claude Code's compaction reads (D-6415: N is the D24 estimate,
    M the lower of the lane's window and floor(0.9 N / 1000) x 1000). No `x-should-retry`: the measured recovery
    used none."""
    return BridgeError(400, INVALID_REQUEST, "prompt is too long: %d tokens > %d maximum" % (int(n), int(m)),
                       code="context_length_exceeded", kind="overflow")


def capability(cls: str, detail: str) -> BridgeError:
    """A request feature the bridge does not map: `capability_rejected: <class>`, from Claude Code's class table, with
    the field after it (D-6414)."""
    message = "capability_rejected: " + cls + ((" (" + detail + ")") if detail else "")
    return BridgeError(400, INVALID_REQUEST, message, kind="capability")


def from_auth(word: str, sentence: str) -> BridgeError:
    """An AuthError from Stage 1's library (or AUTH_LIBRARY_ABSENT). A transient word is 503 with no
    `x-should-retry`; every other word, `login-failed` and an unknown one included, is the 401 row."""
    message = word + ": " + sentence
    if word in AUTH_TRANSIENT_WORDS:
        return BridgeError(503, API_ERROR, message, kind="unavailable")
    return BridgeError(401, AUTHENTICATION, message, dict(NO_RETRY), kind="auth")


# ── the two answers ──────────────────────────────────────────────────────────────────────────────────────────────
def _payload(e: BridgeError) -> dict:
    return {"type": "error", "error": {"type": e.etype, "message": e.message}}


def http_answer(e: BridgeError) -> Tuple[int, Dict[str, str], bytes]:
    """Before the commit point: the real status, its headers, and the Anthropic error body."""
    headers = {"content-type": "application/json"}
    headers.update(e.headers)
    return e.status, headers, json.dumps(_payload(e), separators=(",", ":")).encode("utf-8")


def event(e: BridgeError) -> bytes:
    """After the commit point: one `error` event, never followed by a `message_stop`."""
    return sse.frame("error", _payload(e))
