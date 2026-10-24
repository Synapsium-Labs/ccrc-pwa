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
from typing import Callable, Dict, Iterator, List, Mapping, NamedTuple, Optional, Tuple

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


# ── the body ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _is_developer_item(item: object, text: str) -> bool:
    return (isinstance(item, dict) and item.get("type") == "message" and item.get("role") == "developer"
            and item.get("content") == [{"type": "input_text", "text": text}])


def build_body(req: NeutralRequest, *, instructions_form: bool) -> dict:
    """The Responses body, keys in Codex's order with `stream` second (above). With `instructions_form`, the developer
    text is `instructions` and is not `input[0]`; otherwise there is never an `instructions` key."""
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
    if req.effort is not None:
        body["reasoning"] = {"effort": req.effort}
    body["store"] = False
    body["include"] = list(INCLUDE)
    body["prompt_cache_key"] = req.cache_key
    if req.output_format is not None:
        body["text"] = {"format": req.output_format}
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


def build_headers(token: str, account_id: Optional[str], session_id: Optional[str], ua: str) -> List[Tuple[str, str]]:
    """The request headers, in order. `account_id` is the credential's (`Reading.account_id`), never the lane id;
    the header is left out when it is None, and `session-id` when no session id is known."""
    headers = [("Authorization", "Bearer " + token)]
    if account_id is not None:
        headers.append(("ChatGPT-Account-ID", account_id))
    headers.append(("originator", ORIGINATOR))
    headers.append(("User-Agent", ua))
    if session_id is not None:
        headers.append(("session-id", session_id))
    headers.append(("Content-Type", "application/json"))
    headers.append(("Accept", "text/event-stream"))
    headers.append(("Accept-Encoding", "identity"))
    return headers


def headers_for(reading: object, session_id: Optional[str], ua: str) -> List[Tuple[str, str]]:
    """build_headers over a reading of Stage 1's library (`ensure_fresh` or `refresh_rejected`): its access token and
    its account id, so the lane id has no path into the account header."""
    return build_headers(getattr(reading, "access_token"), getattr(reading, "account_id"), session_id, ua)


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
