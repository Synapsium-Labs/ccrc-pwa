"""codexbridge.backend — the backend adapter: a NeutralRequest becomes a Responses body, its headers and one POST.

Codex-bridge spec 2026-10-15 §2.2 (the `backend` adapter targets today's route: `store:false`, `stream:true`, the
full history in `input`, tools at the top level; identity `originator: ccrc` and a ccrc User-Agent, D27), §2.3 ("No
top-level `instructions`, so nothing outranks it. A per-lane switch keeps the `instructions` form."), §2.4 ("An
upstream idle timeout of 300 s, as in Codex"); plan 2026-10-22, Task 7 and "The bridge's contract"; D-6420 (the
`bridge-instructions` marker), D-6425 (`output_config.format` becomes the Responses `text.format`), D-6426 (the
sampling fields are dropped on the backend route too).

THE BODY follows Codex's own request (upstream openai/codex @ 092d3ac: codex-rs/codex-api/src/common.rs:278-304),
with `stream` moved up beside `model`: `model`, `stream`, `input`, `tools`, `tool_choice`, `parallel_tool_calls`,
`reasoning` (only with an effort, never a `summary`), `store: false`, `include`, `prompt_cache_key`, then `text` only
for an output format. The developer message is `input[0]` (Codex sends no top-level `instructions` and puts its base
prompt in the first developer message), so Claude Code's system prompt is the highest-ranked text the model sees and
no prompt of the bridge's own is sent. Only with the lane's `bridge-instructions` marker does that text travel as
`instructions` instead, and then it is not `input[0]`. `max_output_tokens`, `temperature`, `top_p`, `user`, `metadata`,
`previous_response_id` and `truncation` are never sent.

THE REQUEST MARKERS (D-8622). Three more markers in the lane directory, each existence-only, read at each POST, no
writer in the tree, each adding one thing native Codex sends and this body otherwise does not:
`bridge-reasoning-all-turns` adds `"context": "all_turns"` to `reasoning` (Codex's `Reasoning` serialises `effort`,
`summary`, `context` in that order, so it follows the effort, or is `reasoning`'s only key with none), only for a
catalogue row saying `useResponsesLite: true`; `bridge-verbosity` adds `text.verbosity`, the row's
`defaultVerbosity`, only for a row saying `supportVerbosity: true` with a valid `defaultVerbosity`, in the one `text`
object before `format` (Codex's `TextControls` order); and `bridge-turn-state` echoes the `x-codex-turn-state`
header (D-8623; the server keeps the turn's value). `additions` decides the body's two from the row and the markers,
and `build_body` takes them as arguments, so it stays pure.
(upstream openai/codex @ 826b6e8: codex-rs/codex-api/src/common.rs `Reasoning`, `TextControls`,
`ResponsesApiRequest`; codex-rs/core/src/client.rs `build_reasoning`.) Codex's internal Lite header
(`x-openai-internal-codex-responses-lite`) is never sent: the bridge presents itself as ccrc, never as Codex (below).

THE HEADERS are Codex's spellings: `ChatGPT-Account-ID` (codex-rs/model-provider/src/bearer_auth_provider.rs:37-41),
carrying the CREDENTIAL's account id (`Reading.account_id`, the `chatgpt_account_id` claim), never CCGPT_ACCOUNT_ID,
which is the lane id; `session-id` (codex-rs/codex-api/src/requests/headers.rs:5-13). The originator is `ccrc` and the
User-Agent names ccrc: the bridge never presents itself as Codex.

THE ENDPOINT is DEFAULT_BASE. CCGPT_BRIDGE_UPSTREAM_BASE overrides it for tests only, and only with an `http://` URL on
a loopback host (Stage 1's rule for CCRC_CODEX_AUTH_BASE, `ccd/ccgpt-auth.py` `auth_base`); unset or empty names the
default; anything else raises ValueError at start, whose message never echoes the value.

THE TIMEOUTS. The connect (and its TLS handshake) is bounded by CONNECT_TIMEOUT_S. Then the socket's timeout is set to
the idle bound, which bounds the response head's wait and every read: a silent upstream raises UpstreamTimeout, which
the caller answers 503 `api_error`. The socket timeout is only the backstop: bytes such as `:` keepalive comments reset
it, while Codex's bound runs between parsed events (codex-rs/codex-api/src/sse/responses.rs:535-541,
codex-rs/model-provider-info/src/lib.rs:66), so the server (Task 8) also ends a stream when IDLE_TIMEOUT_S passes with
no parsed event. A socket timeout is caught as `socket.timeout`, which on 3.9 is an OSError and not TimeoutError.

Nothing here logs. An exception never carries a token, a body or the base URL; http.client's own header errors can
name a header value, so the caller logs an exception's class only (the plan's Global Constraints).
"""

import http.client
import json
import os
import platform
import re
import socket
import ssl
from typing import Callable, Dict, FrozenSet, Iterator, List, Mapping, NamedTuple, Optional, Tuple

from . import errors
from .inbound import NeutralRequest

DEFAULT_BASE = "https://chatgpt.com/backend-api/codex"
RESPONSES_PATH = "/responses"
ORIGINATOR = "ccrc"
IDLE_TIMEOUT_S = 300.0
CONNECT_TIMEOUT_S = 30.0

# The test override of DEFAULT_BASE, accepted only on a loopback host (above).
UPSTREAM_BASE_ENV = "CCGPT_BRIDGE_UPSTREAM_BASE"
# The marker in the lane directory that sends the system text as `instructions` (D-6420); no writer in the tree.
INSTRUCTIONS_MARKER = "bridge-instructions"
# D-8622: the request markers, beside INSTRUCTIONS_MARKER; each no writer in the tree, each off until an operator
# touches it (the module docstring).
ALL_TURNS_MARKER = "bridge-reasoning-all-turns"
VERBOSITY_MARKER = "bridge-verbosity"
TURN_STATE_MARKER = "bridge-turn-state"
MARKERS = (ALL_TURNS_MARKER, VERBOSITY_MARKER, TURN_STATE_MARKER)
# Codex's ReasoningContext::AllTurns, as serde writes it.
ALL_TURNS = "all_turns"
# Codex's OpenAiVerbosity words: the bound D-8620's catalogue readers put on `defaultVerbosity` (ccd/ccrc-models-probe's
# VERBOSITIES, shared/models.mjs's CATALOGUE_VERBOSITIES), pinned equal by codex-bridge-backend.test.ts.
VERBOSITIES = ("low", "medium", "high")
# D-8623: Codex's sticky-routing header, the same name on the response and on the request.
TURN_STATE_HEADER = "x-codex-turn-state"
# A value the bridge keeps and echoes: visible ASCII only, so it is one header token that http.client sends as it is.
TURN_STATE_RE = re.compile(r"[\x21-\x7e]{1,4096}")
# What `include` asks for: the encrypted reasoning the store keeps (spec §2.5).
INCLUDE = ("reasoning.encrypted_content",)
# The largest read of one chunk of the stream, and of an error answer's body (classify_http reads only its code).
READ_CHUNK = 65536
ERROR_BODY_MAX = 65536

# An override: `http://`, a loopback host (127.0.0.1, localhost or [::1]), an optional port, an optional path; no user
# information, query or fragment. Case-insensitive, as a URL's scheme and host are.
_LOOPBACK_BASE_RE = re.compile(r"http://(?:127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?(/[A-Za-z0-9._~/-]*)?",
                               re.IGNORECASE)
# Any base `post` is given: scheme, host (a bracketed IPv6 literal or a name), optional port, optional path.
_BASE_RE = re.compile(r"(https?)://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(/[^\s?#]*)?", re.IGNORECASE)
_UNPRINTABLE_RE = re.compile(r"[^\x20-\x7e]")


class UpstreamTimeout(Exception):
    """The upstream was silent past the bound: `phase` is `connect` (CONNECT_TIMEOUT_S), `head` (the response head,
    the idle bound) or `read` (the stream, the idle bound). The caller answers 503 `api_error`."""

    def __init__(self, phase: str) -> None:
        super().__init__(phase)
        self.phase = phase


class Upstream(NamedTuple):
    """One upstream answer: the status, the headers (names lower-cased; a repeated name's values joined with `, `),
    the body as an iterator of chunks (raising UpstreamTimeout past the idle bound), and `close`, which drops the
    connection and may be called more than once."""
    status: int
    headers: Dict[str, str]
    chunks: Iterator[bytes]
    close: Callable[[], None]


# ── the endpoint ─────────────────────────────────────────────────────────────────────────────────────────────────
def upstream_base(environ: Mapping[str, str]) -> str:
    """DEFAULT_BASE, unless CCGPT_BRIDGE_UPSTREAM_BASE names an `http://` URL on a loopback host (without a trailing
    `/`). Any other non-empty value raises ValueError, whose message names the rule, never the value."""
    value = environ.get(UPSTREAM_BASE_ENV)
    if not value:
        return DEFAULT_BASE
    m = _LOOPBACK_BASE_RE.fullmatch(value)
    if m is None or (m.group(1) is not None and int(m.group(1)) > 65535):
        raise ValueError(UPSTREAM_BASE_ENV + " must be an http:// URL on a loopback host (127.0.0.1, localhost or "
                         "::1); unset it to use the default endpoint")
    return value.rstrip("/")


def instructions_form(lane_dir: str) -> bool:
    """Whether the lane's `bridge-instructions` marker exists (D-6420), read at each call."""
    return os.path.exists(os.path.join(lane_dir, INSTRUCTIONS_MARKER))


def markers(lane_dir: str) -> FrozenSet[str]:
    """The request markers (D-8622) the lane directory holds now, read at each call."""
    return frozenset(m for m in MARKERS if os.path.exists(os.path.join(lane_dir, m)))


class Additions(NamedTuple):
    """What the request markers add to one body (D-8622): `reasoning.context` and `text.verbosity`, each None when
    not sent."""
    reasoning_context: Optional[str]
    verbosity: Optional[str]

    @property
    def carried(self) -> Tuple[str, ...]:
        """The markers whose field this body carries, in MARKERS' order."""
        return tuple(m for m, v in ((ALL_TURNS_MARKER, self.reasoning_context), (VERBOSITY_MARKER, self.verbosity))
                     if v is not None)


def additions(row: object, marks: FrozenSet[str]) -> Additions:
    """D-8622: the body's additions for a request whose model has catalogue `row` (None when it has none), with the
    markers `marks`: `all_turns` only for a row whose `useResponsesLite` is true, and the row's `defaultVerbosity`
    only for a row whose `supportVerbosity` is true and whose `defaultVerbosity` is one of VERBOSITIES (D-8620's
    fields; anything else, a string `"true"` among it, says no)."""
    fields = row if isinstance(row, dict) else {}
    context = ALL_TURNS if ALL_TURNS_MARKER in marks and fields.get("useResponsesLite") is True else None
    value = fields.get("defaultVerbosity")
    verbosity = (value if VERBOSITY_MARKER in marks and fields.get("supportVerbosity") is True
                 and isinstance(value, str) and value in VERBOSITIES else None)
    return Additions(context, verbosity)


# ── the body ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _is_developer_item(item: object, text: str) -> bool:
    return (isinstance(item, dict) and item.get("type") == "message" and item.get("role") == "developer"
            and item.get("content") == [{"type": "input_text", "text": text}])


def build_body(req: NeutralRequest, *, instructions_form: bool, reasoning_context: Optional[str] = None,
               verbosity: Optional[str] = None) -> dict:
    """The Responses body, keys in Codex's order with `stream` second (above). With `instructions_form`, the developer
    text is `instructions` and is not `input[0]`; otherwise there is never an `instructions` key. `reasoning_context`
    and `verbosity` are D-8622's additions (`additions`); with both None the body is the unmarked one, byte for byte."""
    items = list(req.items)
    body = {"model": req.model, "stream": True}  # type: Dict[str, object]
    if instructions_form and req.developer is not None:
        body["instructions"] = req.developer
        if items and _is_developer_item(items[0], req.developer):
            items = items[1:]
    body["input"] = items
    body["tools"] = list(req.tools)
    body["tool_choice"] = req.tool_choice if req.tool_choice is not None else "auto"
    body["parallel_tool_calls"] = bool(req.parallel_tool_calls)
    reasoning = {}  # type: Dict[str, object]
    if req.effort is not None:
        reasoning["effort"] = req.effort
    if reasoning_context is not None:  # D-8622: after the effort, as Codex's struct orders it
        reasoning["context"] = reasoning_context
    if reasoning:
        body["reasoning"] = reasoning
    body["store"] = False
    body["include"] = list(INCLUDE)
    body["prompt_cache_key"] = req.cache_key
    text = {}  # type: Dict[str, object]
    if verbosity is not None:  # D-8622: before the format, in one text object, as Codex's struct orders it
        text["verbosity"] = verbosity
    if req.output_format is not None:
        text["format"] = req.output_format
    if text:
        body["text"] = text
    return body


def encode_body(body: dict) -> bytes:
    """The body as compact UTF-8 JSON, its key order kept. A lone surrogate (a `\\ud800` escape in the request) cannot
    be UTF-8, so such a body is sent with every non-ASCII character escaped instead."""
    try:
        return json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    except UnicodeEncodeError:
        return json.dumps(body, separators=(",", ":"), ensure_ascii=True).encode("ascii")


# ── the headers ──────────────────────────────────────────────────────────────────────────────────────────────────
def user_agent(ccrc_version: str) -> str:
    """`ccrc/<version> (codex-bridge; <os> <release>; <arch>)`, every non-printable character replaced by `_`."""
    text = "ccrc/%s (codex-bridge; %s %s; %s)" % (ccrc_version, platform.system(), platform.release(),
                                                  platform.machine())
    return _UNPRINTABLE_RE.sub("_", text)


def build_headers(token: str, account_id: Optional[str], session_id: Optional[str], ua: str, *,
                  turn_state: Optional[str] = None) -> List[Tuple[str, str]]:
    """The request headers, in order. `account_id` is the credential's (`Reading.account_id`), never the lane id;
    the header is left out when it is None, and `session-id` when no session id is known. `turn_state`, the turn's
    captured `x-codex-turn-state` (D-8623), follows `session-id`, and only a value in TURN_STATE_RE's shape is sent."""
    headers = [("Authorization", "Bearer " + token)]
    if account_id is not None:
        headers.append(("ChatGPT-Account-ID", account_id))
    headers.append(("originator", ORIGINATOR))
    headers.append(("User-Agent", ua))
    if session_id is not None:
        headers.append(("session-id", session_id))
    if isinstance(turn_state, str) and TURN_STATE_RE.fullmatch(turn_state):
        headers.append((TURN_STATE_HEADER, turn_state))
    headers.append(("Content-Type", "application/json"))
    headers.append(("Accept", "text/event-stream"))
    headers.append(("Accept-Encoding", "identity"))
    return headers


def headers_for(reading: object, session_id: Optional[str], ua: str, *,
                turn_state: Optional[str] = None) -> List[Tuple[str, str]]:
    """build_headers over a reading of Stage 1's library (`ensure_fresh` or `refresh_rejected`): its access token and
    its account id, so the lane id has no path into the account header."""
    return build_headers(getattr(reading, "access_token"), getattr(reading, "account_id"), session_id, ua,
                         turn_state=turn_state)


# ── the transport ────────────────────────────────────────────────────────────────────────────────────────────────
def _split(base: str) -> Tuple[str, str, int, str]:
    m = _BASE_RE.fullmatch(base)
    if m is None:
        raise ValueError("the upstream base is not an http(s) URL")
    scheme = m.group(1).lower()
    host = m.group(2)
    if host.startswith("["):
        host = host[1:-1]
    port = int(m.group(3)) if m.group(3) is not None else (443 if scheme == "https" else 80)
    return scheme, host, port, (m.group(4) or "").rstrip("/")


def _chunks(resp: http.client.HTTPResponse) -> Iterator[bytes]:
    while True:
        try:
            data = resp.read1(READ_CHUNK)
        except socket.timeout:
            raise UpstreamTimeout("read")
        if not data:
            return
        yield data


def post(base: str, body: bytes, headers: List[Tuple[str, str]], *, idle_s: Optional[float] = None) -> Upstream:
    """POST `body` to `<base>/responses`. TLS is verified by the default context. The connect is bounded by
    CONNECT_TIMEOUT_S; then the socket's timeout is `idle_s` (IDLE_TIMEOUT_S, read when called, by default) for the
    request, the response head's wait and every read. A timeout raises UpstreamTimeout; any other transport failure
    (a refused connection, a reset) is raised as it is, an OSError or an http.client.HTTPException."""
    scheme, host, port, prefix = _split(base)
    idle = IDLE_TIMEOUT_S if idle_s is None else idle_s
    if scheme == "https":
        conn = http.client.HTTPSConnection(host, port, timeout=CONNECT_TIMEOUT_S, context=ssl.create_default_context())
    else:
        conn = http.client.HTTPConnection(host, port, timeout=CONNECT_TIMEOUT_S)
    phase = "connect"
    try:
        conn.connect()
        sock = conn.sock  # kept: for a `will_close` answer getresponse hands it to the response and clears conn.sock
        phase = "head"
        conn.sock.settimeout(idle)
        conn.putrequest("POST", prefix + RESPONSES_PATH, skip_accept_encoding=True)
        for name, value in headers:
            conn.putheader(name, value)
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        resp = conn.getresponse()
    except socket.timeout:
        conn.close()
        raise UpstreamTimeout(phase)
    except BaseException:
        conn.close()
        raise
    received = {}  # type: Dict[str, str]
    for name, value in resp.getheaders():
        key = name.lower()
        received[key] = received[key] + ", " + value if key in received else value

    def close() -> None:
        # The socket is shut down first, so a read in flight on another thread returns at once rather than holding the
        # response file's lock until the upstream's next bytes; a socket already closed refuses it, which is the same.
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        # The response first: for a `will_close` answer (`Connection: close`, or no length and not chunked)
        # getresponse has already closed `conn` and handed the socket to the response, whose file still holds it, so
        # conn.close() alone would leave the socket open (CPython http/client.py, HTTPConnection.getresponse).
        resp.close()
        conn.close()

    return Upstream(resp.status, received, _chunks(resp), close)


def error_of(upstream: Upstream, *, now: float) -> errors.BridgeError:
    """A non-2xx answer through the error table (`errors.classify_http`): at most ERROR_BODY_MAX bytes of its body
    are read (a body cut by the idle bound or a dropped connection is classified as far as it came), then the
    connection is closed."""
    body = b""
    try:
        for chunk in upstream.chunks:
            body += chunk
            if len(body) >= ERROR_BODY_MAX:
                body = body[:ERROR_BODY_MAX]
                break
    except (UpstreamTimeout, OSError, http.client.HTTPException):
        pass
    finally:
        upstream.close()
    return errors.classify_http(upstream.status, body, upstream.headers, now=now)
