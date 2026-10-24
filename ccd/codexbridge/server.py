"""codexbridge.server — a direct lane's one process: the Anthropic endpoint Claude Code talks to, speaking the backend.

Codex-bridge spec 2026-10-15 §2.1 ("One process per lane, on loopback, guarded by the lane's existing gateway key"),
§2.4 (the timers and the error answers), §2.6 (in `direct` mode the bridge is the lane's one refresher), §2.7 (the
stats file); plan 2026-10-22, Task 8 and "The bridge's contract": the environment, the routes, the error table, the
commit point (R17), the continuation and the usage rule; D-6410, D-6415 (the prompt-too-long numbers), D-6429 (the
drain), D-6431 (`stream:false` is folded).

ONE `/v1/messages` REQUEST, in order (`_Request.messages`): the key; the body, read and decoded through the shim's
own hooks (`Hooks`, passed in by the shim's direct entry, so none is copied here); the shim's effort resolution,
which hands back the `output_config` it popped; the model, checked against the lane catalogue read NOW (a refresh
that adds a model reaches a running bridge); `inbound.from_anthropic`; the token (`ensure_fresh`); the upstream
request. A 401 is answered by one `refresh_rejected` and one retry, unless the rejected token was issued within
FRESH_TOKEN_S (a refresh cannot cure that refusal, and would spend a refresh-token rotation per turn). A 2xx is read
by a reader thread into parsed events (`_Feed`), so the request's thread can ping, commit and time out while the
upstream is silent: the commit point is the first released block, a non-failure terminal, or HOLD_S after the head;
a ping follows PING_S of downstream silence; IDLE_TIMEOUT_S with no PARSED event (a `:` comment is not one) ends the
reply with `api_error`; and reading stops the moment the reducer's terminal is set. A reply that asks to be continued
(`end_turn:false`, `interrupted`) is sent again with its output items appended, at most CONTINUE_MAX times, its block
indexes running on; while a continued message waits for its next upstream head (or a 401's refresh), the request's
thread still pings (`_waiting`). Then the reasoning store, the stats file and, when the status file read an upstream
state, `ok`. An upstream failure the bridge meets itself (the idle bound, a timeout or transport failure of the post)
is recorded in the status file with a bounded code too, like every classified one.

THE CATALOGUE. A model outside it is the client's: 404 `not_found_error`, counted `modelSubstitution:<model>`. A
catalogue that is absent, unreadable or not in its shape is the bridge's: 503 `api_error` (retryable), counted
`catalogue-unreadable`, never a substitution.

THE OVERFLOW. Task 1's table answers the overflow row with the bare `prompt is too long` (the backend's message holds
no counts); here, where the D24 estimate and the lane's window are known, it becomes `overflow(N, M)` with
`N = count.estimate(countable_bytes, ratio, image_count)` and `M = min(window, floor(N * 0.9 / 1000) * 1000)`, the
window being the lane's CLAUDE_CODE_MAX_CONTEXT_TOKENS read from `<configDir>/settings.json` at that moment (200000
when absent), so N > M always; the upstream request id is kept, and the refusal goes to the stats file (D-6415).

NOTHING LEAKS. Every handler catches every exception itself: before the commit point it answers 503 `api_error`,
after it one `error` event, and it logs one line, `ccgpt-proxy: direct: <class name> <code>`, the code bounded by
`errors.CODE_RE`, never `str(e)`, an argument or a traceback. The server's own `handle_error` (an exception outside a
handler) logs the same line. No body, token or header value is logged or counted.

THE DRAIN (SIGTERM, D-6429). The signal handler only sets `stopping` and starts a thread that calls
`httpd.shutdown()`; when `serve_forever` returns on the main thread the listener is closed (new connections are
refused from then on), the in-flight requests get DRAIN_S to finish, every one still open is cut with `api_error`
(counted `drain-cut`; `AnthropicStream.cut` answers a 503 for one not yet committed), those writes get one second,
and the credential calls still in flight (a refresher tick, a request's `ensure_fresh` or `refresh_rejected`, counted
in `auth`) get up to STOP_MARGIN_S - DRAIN_WRITE_S - EXIT_MARGIN_S to finish, so a refresh the token endpoint has
answered reaches the disk before the process ends; then the stats file is flushed. The return is 0.

Every constant is read when it is used, so the test driver's `consts` reach it.
"""

import errno
import hmac
import http.client
import http.server
import importlib.util
import json
import math
import os
import re
import signal
import sys
import threading
import time
import uuid
from typing import Callable, Dict, List, Mapping, NamedTuple, Optional, Tuple

from . import backend, count, errors, inbound, reducer, sse, stats, store, stream

PING_S = 15.0
HOLD_S = 15.0
DRAIN_S = 5.0
STOP_MARGIN_S = 5.0
CONTINUE_MAX = 3
REFRESH_TICK_S = 60.0
FRESH_TOKEN_S = 300.0
WAIT_TICK_S = 0.25  # the request's thread wakes at least this often (a cut stream, a gone client)
DRAIN_WRITE_S = 1.0  # the drain's wait for the cut streams' writes
EXIT_MARGIN_S = 1.0  # what the drain leaves of STOP_MARGIN_S for the flush and the interpreter's exit
DEFAULT_WINDOW = 200000  # the window when the lane's settings name none (Claude Code's own default)
OVERFLOW_FRACTION = 0.9  # D-6415: M is at most this share of N, rounded down to 1000
ROUTE = "backend"  # the stats file's route for every request this server sends (the `siwc` route is Stage 3)
LOG_PREFIX = "ccgpt-proxy: direct: "

MESSAGES_PATH = "/v1/messages"
COUNT_PATH = "/v1/messages/count_tokens"
MODELS_PATH = "/v1/models"
LANE_PATH = "/ccgpt/lane"

CATALOGUE_UNREADABLE = "catalogue-unreadable"  # the outcome of a request the catalogue could not decide

# The launcher's grammar for the lane key (`ccd/ccrc-codex`): the whole of runtime.env, trailing newlines ignored.
KEY_RE = re.compile(r"LITELLM_MASTER_KEY=(sk-[0-9a-f]{48})")
LANE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FILE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_CLASS_RE = re.compile(r"[^A-Za-z0-9_]")

LANE_FILE = "lane.json"
RUNTIME_ENV = "runtime.env"
WINDOW_KEY = "CLAUDE_CODE_MAX_CONTEXT_TOKENS"
AUTH_LIBRARY_REMEDY = ("the bridge could not load the lane's credential library (CCRC_CODEX_AUTH_LIB); run 'ccrc "
                       "update' to reinstall it")


class BridgeConfig(NamedTuple):
    """The contract's environment of a `direct` process, and what `lane.json` and `runtime.env` add, read once."""
    lane: str
    port: int
    lane_dir: str
    auth_dir: str
    config_dir: str
    key: str
    catalogue: str
    auth_lib: str
    ccrc_version: str
    upstream_base: str
    stats_path: str
    store_path: str


class Hooks(NamedTuple):
    """The shim's request hooks (`ccd/ccgpt-proxy.py`), passed in by its direct entry so none is copied here."""
    read_body: Callable
    content_encoding: Callable
    decode_body: Callable
    apply_effort: Callable  # (data) -> (data, the output_config it popped)
    server_class: type


# ── the start ────────────────────────────────────────────────────────────────────────────────────────────────────
def _refuse(reason: str) -> None:
    raise SystemExit(LOG_PREFIX + reason)


def _required(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name)
    if not value:
        _refuse(name + " is not set")
    return value


def _home_relative(home: str, value: object, what: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or ".." in value.split("/"):
        _refuse("lane.json's " + what + " is not a HOME-relative path")
    return os.path.join(home, value)


def config_from_env(environ: Mapping[str, str]) -> BridgeConfig:
    """The contract's environment, `lane.json` and the key, read once at start. A missing or malformed value exits
    with one `ccgpt-proxy: direct: <reason>` line (SystemExit), naming the variable or the field, never a value."""
    if environ.get("CCGPT_BRIDGE") != "direct":
        _refuse("CCGPT_BRIDGE is not direct")
    lane = _required(environ, "CCGPT_ACCOUNT_ID")
    if not LANE_RE.fullmatch(lane):
        _refuse("CCGPT_ACCOUNT_ID is not a lane id")
    raw_port = _required(environ, "CCGPT_PROXY_PORT")
    if not (raw_port.isascii() and raw_port.isdigit() and 1 <= int(raw_port) <= 65535):
        _refuse("CCGPT_PROXY_PORT is not a port number")
    home = _required(environ, "HOME")
    lane_dir = _required(environ, "CCGPT_LANE_DIR")
    auth_lib = _required(environ, "CCRC_CODEX_AUTH_LIB")
    catalogue = _required(environ, "CCGPT_CATALOGUE")
    version = environ.get("CCGPT_CCRC_VERSION") or "dev"
    try:
        base = backend.upstream_base(environ)
    except ValueError:
        _refuse(backend.UPSTREAM_BASE_ENV + " must be an http:// URL on a loopback host; unset it for the default")
    try:
        with open(os.path.join(lane_dir, LANE_FILE), "rb") as f:
            manifest = json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError):
        _refuse("lane.json in CCGPT_LANE_DIR is missing or not JSON")
    if not isinstance(manifest, dict) or manifest.get("id") != lane:
        _refuse("lane.json in CCGPT_LANE_DIR names another lane")
    files = manifest.get("bridgeFiles")
    if not isinstance(files, dict):
        _refuse("lane.json carries no bridgeFiles; run 'ccrc update', which re-renders it")
    names = {}
    for key in ("stats", "store"):
        value = files.get(key)
        if not isinstance(value, str) or not FILE_NAME_RE.fullmatch(value):
            _refuse("lane.json's bridgeFiles." + key + " is not a file name")
        names[key] = value
    auth_dir = _home_relative(home, manifest.get("authDir"), "authDir")
    config_dir = _home_relative(home, manifest.get("configDir"), "configDir")
    try:
        with open(os.path.join(lane_dir, RUNTIME_ENV), "rb") as f:
            text = f.read(4096).decode("ascii")
    except (OSError, UnicodeDecodeError):
        _refuse("runtime.env in CCGPT_LANE_DIR is missing or unreadable")
    m = KEY_RE.fullmatch(text.rstrip("\n"))
    if m is None:
        _refuse("runtime.env does not hold one well-formed LITELLM_MASTER_KEY line (its bytes are not printed)")
    return BridgeConfig(lane=lane, port=int(raw_port), lane_dir=lane_dir, auth_dir=auth_dir, config_dir=config_dir,
                        key=m.group(1), catalogue=catalogue, auth_lib=auth_lib, ccrc_version=version,
                        upstream_base=base, stats_path=os.path.join(lane_dir, names["stats"]),
                        store_path=os.path.join(lane_dir, names["store"]))


# ── the credential library ───────────────────────────────────────────────────────────────────────────────────────
_LIB = {}  # type: Dict[str, object]
_LIB_LOCK = threading.Lock()


def load_auth_lib(path: str) -> object:
    """Stage 1's library, loaded by path (`spec_from_file_location`, never through sys.path) and cached for the
    process; every library call the bridge makes goes through the module this returns. A load that fails raises (and
    is tried again at the next call, so a reinstall cures a running bridge); the request path answers it 401
    `auth-library-absent`."""
    with _LIB_LOCK:
        lib = _LIB.get(path)
        if lib is not None:
            return lib
        spec = importlib.util.spec_from_file_location("ccgpt_auth", path)
        if spec is None or spec.loader is None:
            raise ImportError("no loader")
        lib = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = lib
        try:
            spec.loader.exec_module(lib)
        except BaseException:
            sys.modules.pop("ccgpt_auth", None)
            raise
        _LIB[path] = lib
        return lib


# ── small readers ────────────────────────────────────────────────────────────────────────────────────────────────
def catalogue_ids(path: str) -> Optional[List[str]]:
    """The lane catalogue's model ids (`{"models": [{"id": ...}, ...]}`), read at each call. None when the file is
    absent or unreadable, is not JSON, or has no `models` list: an undecidable catalogue, never an empty one."""
    try:
        with open(path, "rb") as f:
            doc = json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    rows = doc.get("models") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return None
    out = []  # type: List[str]
    for row in rows:
        mid = row.get("id") if isinstance(row, dict) else None
        if isinstance(mid, str) and mid and mid not in out:
            out.append(mid)
    return out


def lane_window(config_dir: str) -> int:
    """The lane's CLAUDE_CODE_MAX_CONTEXT_TOKENS from `<configDir>/settings.json`, read now; DEFAULT_WINDOW when the
    file or the value is absent or not a positive whole number."""
    try:
        with open(os.path.join(config_dir, "settings.json"), "rb") as f:
            doc = json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError):
        return DEFAULT_WINDOW
    env = doc.get("env") if isinstance(doc, dict) else None
    value = env.get(WINDOW_KEY) if isinstance(env, dict) else None
    if isinstance(value, str) and value.isascii() and value.isdigit():
        value = int(value)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return DEFAULT_WINDOW


def overflow_answer(e: errors.BridgeError, req: inbound.NeutralRequest, st: stats.Stats,
                    config_dir: str) -> errors.BridgeError:
    """D-6415: the overflow row with its numbers, the upstream request id kept, and the refusal in the stats file."""
    n = count.estimate(req.countable_bytes, st.ratio(ROUTE, req.model), req.image_count)
    window = lane_window(config_dir)
    m = min(window, int(math.floor(n * OVERFLOW_FRACTION / 1000)) * 1000)
    st.refusal(ROUTE, req.model, n, window)
    out = errors.overflow(n, m)
    out.request_id = e.request_id
    return out


def _bounded_class(e: BaseException) -> str:
    name = _CLASS_RE.sub("_", type(e).__name__)[:64]
    return name or "Exception"


def _code_of(e: BaseException) -> str:
    """A code for the log line: an AuthError's word, an OSError's errno name, else `internal`; bounded by CODE_RE."""
    code = getattr(e, "word", None)
    if not isinstance(code, str) and isinstance(e, OSError) and isinstance(e.errno, int):
        code = errno.errorcode.get(e.errno, "oserror")
    if not isinstance(code, str):
        code = "internal"
    code = code.lower()
    return code if errors.CODE_RE.fullmatch(code) else errors.UNRECOGNISED_CODE


def log_exception(e: BaseException) -> None:
    """The one log line of an exception: its class and a bounded code, never its text."""
    try:
        sys.stderr.write(LOG_PREFIX + _bounded_class(e) + " " + _code_of(e) + "\n")
        sys.stderr.flush()
    except Exception:  # a log that cannot be written is dropped
        pass


def _media_type(headers: Mapping[str, str]) -> str:
    value = headers.get("content-type")
    if not isinstance(value, str) or not value.strip():
        return "content-type:absent"
    return "content-type:" + value.split(";", 1)[0].strip().lower()


def _fresh(lib: object, token: Optional[str], now: float) -> bool:
    """Whether `token` was issued within FRESH_TOKEN_S of `now` (its `iat` claim), so a refresh cannot cure its
    rejection."""
    if not isinstance(token, str):
        return False
    iat = lib.claims_of(token).get("iat")
    if isinstance(iat, bool) or not isinstance(iat, (int, float)):
        return False
    return now - iat < FRESH_TOKEN_S


# ── the upstream feed ────────────────────────────────────────────────────────────────────────────────────────────
class _Feed:
    """A reader thread over one upstream body: it parses each chunk and hands the events over, so the request's
    thread can wait with a deadline. `end` is None while the body is open, else `eof`, `timeout` or `error`.

    `stop` closes the connection at once, from the request's thread: `backend.Upstream.close` shuts the socket down
    first, so a read in flight on the reader's thread returns at once and the close does not wait for the upstream's
    next bytes (an upstream that holds the connection open after its terminal event keeps no reader thread or socket).
    The reader closes it too when the body ends; the close runs once, whichever comes first."""

    def __init__(self, up: backend.Upstream) -> None:
        self._up = up
        self._cond = threading.Condition()
        self._events = []  # type: List[sse.SseEvent]
        self.end = None  # type: Optional[str]
        self._stopped = False
        self._closed = False
        self._thread = threading.Thread(target=self._run, name="codexbridge-feed", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        parser = sse.SseParser()
        end = "eof"
        try:
            for chunk in self._up.chunks:
                if self._stopped:
                    break
                parsed = parser.feed(chunk)
                if parsed:
                    with self._cond:
                        self._events.extend(parsed)
                        self._cond.notify_all()
            parsed = parser.close()
        except backend.UpstreamTimeout:
            end, parsed = "timeout", []
        except Exception:  # a reset, a closed connection: the stream ends here, and the reducer calls it truncated
            end, parsed = "error", []
        with self._cond:
            self._events.extend(parsed)
            self.end = end
            self._cond.notify_all()
        self._close()

    def _close(self) -> None:
        with self._cond:
            if self._closed:
                return
            self._closed = True
        try:
            self._up.close()
        except Exception as e:  # the connection is being dropped either way
            log_exception(e)

    def stop(self) -> None:
        """Read no more, and close the connection now."""
        with self._cond:
            self._stopped = True
        self._close()

    def take(self, timeout: float) -> Tuple[List[sse.SseEvent], Optional[str]]:
        """The events parsed since the last call, waiting up to `timeout` for one, and the end (None while open)."""
        with self._cond:
            if not self._events and self.end is None and timeout > 0:
                self._cond.wait(timeout)
            out, self._events = self._events, []
            return out, self.end


# ── the in-flight registry (the drain) ───────────────────────────────────────────────────────────────────────────
class _Flight:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._done = threading.Condition(self._lock)
        self.streams = set()  # type: set
        self.count = 0

    def enter(self, s: Optional[stream.AnthropicStream] = None) -> None:
        with self._lock:
            self.count += 1
            if s is not None:
                self.streams.add(s)

    def leave(self, s: Optional[stream.AnthropicStream] = None) -> None:
        with self._lock:
            self.count -= 1
            self.streams.discard(s)
            self._done.notify_all()

    def wait_idle(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        with self._lock:
            while self.count > 0:
                left = deadline - time.monotonic()
                if left <= 0:
                    return
                self._done.wait(left)

    def open_streams(self) -> List[stream.AnthropicStream]:
        with self._lock:
            return list(self.streams)


# ── one request ──────────────────────────────────────────────────────────────────────────────────────────────────
class _State(NamedTuple):
    cfg: BridgeConfig
    hooks: Hooks
    stats: stats.Stats
    store: store.ReasoningStore
    flight: _Flight
    auth: _Flight  # the credential calls in flight (no streams): the drain waits for them
    ua: str


def _json_answer(status: int, payload: object, headers: Optional[Dict[str, str]] = None) -> Tuple[int, Dict[str, str],
                                                                                                   bytes]:
    out = {"content-type": "application/json"}
    out.update(headers or {})
    return status, out, json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _local_error(status: int, etype: str, message: str, retry: bool = True) -> errors.BridgeError:
    return errors.BridgeError(status, etype, message, None if retry else dict(errors.NO_RETRY), kind="refused")


def _catalogue_unreadable(st: stats.Stats) -> errors.BridgeError:
    """The answer to a request the catalogue could not decide: the bridge's fault, retryable, counted on its own."""
    st.outcome(CATALOGUE_UNREADABLE)
    return _local_error(503, errors.API_ERROR, "the lane catalogue (CCGPT_CATALOGUE) is absent or unreadable")


class _Request:
    """One `/v1/messages` (or count_tokens) request on its handler's thread."""

    def __init__(self, state: _State, handler: http.server.BaseHTTPRequestHandler) -> None:
        self.state = state
        self.h = handler
        self.lib = None  # type: Optional[object]
        self.retried_401 = False

    # ── the request's opening ──
    def body(self) -> dict:
        """The body, read and decoded through the shim's hooks, and parsed as a JSON object."""
        hooks = self.state.hooks
        try:
            raw = hooks.read_body(self.h.headers, self.h.rfile)
        except ValueError:
            raise _local_error(400, errors.INVALID_REQUEST, "the request body's framing is malformed")
        encoding = hooks.content_encoding(self.h.headers)
        if encoding not in ("", "identity"):
            try:
                decoded = hooks.decode_body(raw, encoding)
            except Exception:
                raise _local_error(400, errors.INVALID_REQUEST, "the request body does not decode as its encoding")
            if decoded is raw:  # the shim's decode_body hands back the very bytes for an encoding it does not implement
                raise _local_error(415, errors.INVALID_REQUEST, "the request's content-encoding is not supported")
            raw = decoded
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise _local_error(400, errors.INVALID_REQUEST, "the request body is not JSON")
        if not isinstance(data, dict):
            raise _local_error(400, errors.INVALID_REQUEST, "the request body is not a JSON object")
        return data

    def library(self) -> object:
        if self.lib is None:
            try:
                self.lib = load_auth_lib(self.state.cfg.auth_lib)
            except Exception:
                raise errors.from_auth(errors.AUTH_LIBRARY_ABSENT, AUTH_LIBRARY_REMEDY)
        return self.lib

    def _auth_call(self, fn: Callable, *args: object, **kwargs: object) -> object:
        lib = self.library()
        self.state.auth.enter()
        try:
            return fn(*args, **kwargs)
        except lib.AuthError as e:
            raise errors.from_auth(getattr(e, "word", "auth-error"), str(e))
        finally:
            self.state.auth.leave()

    def reading(self) -> object:
        lib = self.library()
        cfg = self.state.cfg
        return self._auth_call(lib.ensure_fresh, cfg.auth_dir, lane=cfg.lane)

    def record(self, e: errors.BridgeError, rid: Optional[str]) -> None:
        """The upstream state, code and request id, in the status file (best effort)."""
        lib = self.lib
        if lib is None:
            return
        try:
            lib.record_upstream(self.state.cfg.auth_dir, state=e.state, code=e.code,
                                request_id=e.request_id or rid)
        except Exception as x:  # best effort: the answer is what matters
            log_exception(x)

    # ── the count ──
    def count_tokens(self) -> Tuple[int, Dict[str, str], bytes]:
        st = self.state
        data = self.body()
        data, output_config = st.hooks.apply_effort(data)
        req = inbound.from_anthropic(data, self.h.headers, names=st.stats, output_config=output_config,
                                     lookup=st.store.get)
        st.stats.outcome("countTokens")
        n = count.estimate(req.countable_bytes, st.stats.ratio(ROUTE, req.model), req.image_count)
        return _json_answer(200, {"input_tokens": n})

    # ── the message ──
    def messages(self, out: stream.AnthropicStream) -> None:
        st = self.state
        cfg = st.cfg
        data = self.body()
        data, output_config = st.hooks.apply_effort(data)
        model = data.get("model")
        if isinstance(model, str) and model:
            ids = catalogue_ids(cfg.catalogue)
            if ids is None:
                raise _catalogue_unreadable(st.stats)
            if model not in ids:
                st.stats.name("modelSubstitution", model)
                raise _local_error(404, errors.NOT_FOUND, "model not served by this lane (see its catalogue): "
                                   + (model if errors.CODE_RE.fullmatch(model.lower()) else errors.UNRECOGNISED_CODE),
                                   retry=False)
        req = inbound.from_anthropic(data, self.h.headers, names=st.stats, output_config=output_config,
                                     lookup=st.store.get)
        out.model = req.model
        out.buffered = not req.stream
        if not req.stream:
            st.stats.outcome("streamFalse")
        reading = self.reading()
        lib = self.lib
        prev_status = None
        try:
            prev_status = lib.read_status(cfg.auth_dir)
        except Exception as x:
            log_exception(x)
        items = list(req.items)
        continued = 0
        output_sum = 0
        last = reducer.ZERO_USAGE
        while True:
            turn = req._replace(items=items)
            result = self._one_response(turn, reading, out)
            if isinstance(result, errors.BridgeError):
                if result.kind == "overflow":
                    result = overflow_answer(result, req, st.stats, cfg.config_dir)
                out.error(result)
                st.stats.outcome("4xx" if 400 <= result.status < 500 else "5xx")
                return
            red, term, reading = result
            store.remember(st.store, red, req.session_id)
            output_sum += term.usage.output
            last = term.usage
            for key, n in red.counts.items():
                for _ in range(n):
                    st.stats.outcome(key)
            stop = reducer.stop_reason(term, red.emitted_tool_use, red.refusal)
            if reducer.needs_continuation(term, red.emitted_tool_use, refusal=red.refusal):
                if continued >= CONTINUE_MAX:
                    st.stats.outcome("continuation-cap")
                    stop = "end_turn"
                else:
                    continued += 1
                    st.stats.outcome("continuations")
                    items = items + red.output_items
                    out.continuation()
                    continue
            break
        usage = reducer.anthropic_usage(reducer.Usage(last.input, last.cached, last.cache_write, output_sum))
        st.stats.usage(ROUTE, req.model, req.countable_bytes, last.input, image_count=req.image_count,
                       continued=continued > 0)
        st.stats.outcome("2xx")
        if req.compaction:  # a success only, beside 2xx (the plan's request sequence)
            st.stats.outcome("compactionRequests")
        if out.buffered:
            out.commit()
            out.finish(stop, usage)
            status, headers, body = _json_answer(200, stream.fold(out.events))
            out.http(status, headers, body)
        else:
            out.finish(stop, usage)
        state = prev_status.get("state") if isinstance(prev_status, dict) else None
        if state in (errors.STATE_LIMIT_PAUSED, errors.STATE_INELIGIBLE):
            try:
                lib.record_upstream(cfg.auth_dir, state="ok", code=None, request_id=None)
            except Exception as x:
                log_exception(x)

    def _post(self, turn: inbound.NeutralRequest, reading: object) -> backend.Upstream:
        st = self.state
        body = backend.build_body(turn, instructions_form=backend.instructions_form(st.cfg.lane_dir))
        st.stats.request(ROUTE, turn.model, turn.countable_bytes)
        headers = backend.headers_for(reading, turn.session_id, st.ua)
        try:
            return backend.post(st.cfg.upstream_base, backend.encode_body(body), headers)
        except backend.UpstreamTimeout as e:
            err = errors.unavailable("the upstream did not answer within the idle bound",
                                     code="connect-timeout" if e.phase == "connect" else "idle-timeout")
        except (OSError, http.client.HTTPException):
            err = errors.unavailable("the upstream could not be reached", code="transport")
        self.record(err, None)
        raise err

    def _waiting(self, out: stream.AnthropicStream, fn: Callable, *args: object, **kwargs: object) -> object:
        """`fn(*args, **kwargs)`; once the stream is committed and streaming (a continued message), on a helper thread
        while this one pings after PING_S of downstream silence (spec §2.4), so a slow head or a refresh between two
        responses is not silence. Its exception is raised here; the wait ends only when `fn` returns, which its own
        bounds limit (CONNECT_TIMEOUT_S, IDLE_TIMEOUT_S, the library's)."""
        if not out.committed or out.buffered:
            return fn(*args, **kwargs)
        box = {}  # type: Dict[str, object]

        def run() -> None:
            try:
                box["value"] = fn(*args, **kwargs)
            except BaseException as e:  # handed to the request's thread below
                box["error"] = e

        helper = threading.Thread(target=run, name="codexbridge-wait", daemon=True)
        helper.start()
        while True:
            helper.join(max(0.0, min(WAIT_TICK_S, out.last_write_at + PING_S - time.monotonic())))
            if not helper.is_alive():
                break
            if time.monotonic() - out.last_write_at >= PING_S:
                out.ping()
        if "error" in box:
            raise box["error"]  # type: ignore[misc]
        return box["value"]

    def _one_response(self, turn: inbound.NeutralRequest, reading: object,
                      out: stream.AnthropicStream) -> object:
        """One upstream response: (reducer, terminal, reading) for a reply, or the BridgeError to answer."""
        st = self.state
        lib = self.lib
        while True:
            up = self._waiting(out, self._post, turn, reading)
            st.stats.header_names(up.headers)
            st.stats.name("responseHeader", _media_type(up.headers))
            st.stats.usage_headers(up.headers)
            rid = errors.request_id_of(up.headers)  # the table's own reader of x-request-id / request-id, bounded
            st.stats.request_id(rid)
            if 200 <= up.status < 300:
                return self._reduce(turn, up, out, rid, reading)
            e = backend.error_of(up, now=time.time())
            if up.status == 401 and not self.retried_401:
                self.retried_401 = True
                if _fresh(lib, getattr(reading, "access_token", None), time.time()):
                    st.stats.outcome("refresh-skipped-fresh-token")
                    self.record(e, rid)
                    return e
                st.stats.outcome("refresh-after-401")
                cfg = st.cfg
                reading = self._waiting(out, self._auth_call, lib.refresh_rejected, cfg.auth_dir, reading.access_token,
                                        lane=cfg.lane)
                continue
            self.record(e, rid)
            return e

    def _reduce(self, turn: inbound.NeutralRequest, up: backend.Upstream, out: stream.AnthropicStream,
                rid: Optional[str], reading: object) -> object:
        st = self.state
        red = reducer.Reducer(name_map=turn.name_map, names=st.stats, tools_required=turn.tools_required)
        feed = _Feed(up)
        head_at = time.monotonic()
        last_event = head_at
        timed_out = False
        try:
            while True:
                now = time.monotonic()
                waits = [WAIT_TICK_S, last_event + backend.IDLE_TIMEOUT_S - now]
                if not out.committed:
                    waits.append(head_at + HOLD_S - now)
                elif not out.buffered:
                    waits.append(out.last_write_at + PING_S - now)
                parsed, end = feed.take(max(0.0, min(waits)))
                now = time.monotonic()
                for ev in parsed:
                    last_event = now
                    red.feed(ev)
                    if red.terminal is not None:
                        break
                released = red.release()
                if not out.committed and (red.committable or now - head_at >= HOLD_S):
                    out.commit()
                if released:
                    out.blocks(released)
                if out.closed:  # cut by the drain, or the client went away
                    return errors.unavailable("the bridge stopped")
                if red.terminal is not None or end is not None:
                    # the socket's own idle bound (no bytes at all) is the idle bound too, never a truncation
                    timed_out = red.terminal is None and end == "timeout"
                    break
                if now - last_event >= backend.IDLE_TIMEOUT_S:
                    timed_out = True
                    break
                if out.committed and not out.buffered and now - out.last_write_at >= PING_S:
                    out.ping()
        finally:
            feed.stop()
        term = red.finish()
        released = red.release()
        if released:
            out.blocks(released)
        if timed_out:
            err = errors.unavailable("the upstream was silent past the idle bound", code="idle-timeout", rid=rid)
            self.record(err, rid)
            return err
        if term.error is not None:
            err = term.error
            if err.request_id is None:
                err.request_id = rid
            self.record(err, rid)
            return err
        if not out.committed:
            out.commit()
        return red, term, reading


# ── the handler ──────────────────────────────────────────────────────────────────────────────────────────────────
def _make_handler(state: _State) -> type:
    cfg = state.cfg

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args: object) -> None:  # the bridge logs nothing per request
            pass

        def _write(self, data: bytes) -> None:
            self.wfile.write(data)
            self.wfile.flush()

        def _answer(self, status: int, headers: Dict[str, str], body: bytes) -> None:
            self.close_connection = True
            try:
                self._write(stream.answer_bytes(status, headers, body))
            except (OSError, ValueError):
                pass

        def _error(self, e: errors.BridgeError) -> None:
            self._answer(*errors.http_answer(e))

        def _keyed(self) -> bool:
            given = self.headers.get("x-api-key")
            if not given:
                auth = self.headers.get("authorization") or ""
                if auth[:7].lower() == "bearer ":
                    given = auth[7:].strip()
            if not isinstance(given, str) or not given:
                return False
            return hmac.compare_digest(given.encode("utf-8", "replace"), cfg.key.encode("ascii"))

        def _route(self) -> None:
            path = self.path.split("?", 1)[0]
            self.close_connection = True
            if self.command == "GET" and path == LANE_PATH:
                self._answer(*_json_answer(200, {"lane": cfg.lane, "mode": "direct"}))
                return
            if not self._keyed():
                self._error(_local_error(401, errors.AUTHENTICATION, "the lane key is missing or wrong",
                                         retry=False))
                return
            if self.command == "POST" and path == MESSAGES_PATH:
                self._messages()
            elif self.command == "POST" and path == COUNT_PATH:
                self._count()
            elif self.command == "GET" and path == MODELS_PATH:
                ids = catalogue_ids(cfg.catalogue)
                if ids is None:
                    self._error(_catalogue_unreadable(state.stats))
                    return
                self._answer(*_json_answer(200, {
                    "data": [{"type": "model", "id": i, "display_name": i, "created_at": "1970-01-01T00:00:00Z"}
                             for i in ids],
                    "has_more": False, "first_id": ids[0] if ids else None, "last_id": ids[-1] if ids else None}))
            else:
                self._error(_local_error(404, errors.NOT_FOUND, "no such route on this lane"))

        def _count(self) -> None:
            try:
                self._answer(*_Request(state, self).count_tokens())
            except errors.BridgeError as e:
                self._error(e)
            finally:
                state.store.close()
                state.stats.flush()

        def _messages(self) -> None:
            out = stream.AnthropicStream(self._write, model="", message_id="msg_" + uuid.uuid4().hex)
            state.flight.enter(out)
            try:
                try:
                    _Request(state, self).messages(out)
                except errors.BridgeError as e:
                    out.error(e)
                    state.stats.outcome("4xx" if 400 <= e.status < 500 else "5xx")
                except Exception as e:  # every exception is answered here, and logged by its class only
                    log_exception(e)
                    out.error(errors.unavailable("the bridge failed"))
                    state.stats.outcome("5xx")
            finally:
                state.flight.leave(out)
                state.store.close()
                state.stats.flush()

        def _handle(self) -> None:
            try:
                self._route()
            except Exception as e:  # an exception outside a stream: 503, logged by its class only
                log_exception(e)
                self._error(errors.unavailable("the bridge failed"))

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _handle

    return Handler


def _make_server_class(base: type) -> type:
    class Bridged(base):  # type: ignore[valid-type, misc]
        daemon_threads = True

        def handle_error(self, request: object, client_address: object) -> None:
            e = sys.exc_info()[1]
            log_exception(e if e is not None else Exception())

    return Bridged


# ── the refresher ────────────────────────────────────────────────────────────────────────────────────────────────
def _refresher(cfg: BridgeConfig, stop: threading.Event, auth: _Flight) -> None:
    """The designated refresher (spec §2.6): every REFRESH_TICK_S, `ensure_fresh` at half the token's lifetime, so an
    idle lane's token is refreshed too. Never raises; a failure is logged by its class and tried at the next tick. A
    tick is counted in `auth`, so the drain waits for it, and starts nothing once `stop` is set."""
    while not stop.wait(REFRESH_TICK_S):
        auth.enter()
        try:
            if stop.is_set():
                return
            lib = load_auth_lib(cfg.auth_lib)
            r = lib.read(cfg.auth_dir)
            if r.credential != "present":
                continue
            lib.ensure_fresh(cfg.auth_dir, within_s=lib.half_life_s(r), lane=cfg.lane)
        except Exception as e:  # an AuthError among them: the request path answers it when a request comes
            log_exception(e)
        finally:
            auth.leave()


# ── the process ──────────────────────────────────────────────────────────────────────────────────────────────────
def serve(cfg: BridgeConfig, hooks: Hooks) -> int:
    """Serve the lane until SIGTERM, then drain (the module docstring); 0 after a drain."""
    st = stats.Stats(cfg.stats_path, cfg.lane)
    rs = store.ReasoningStore(cfg.store_path, outcome=st.outcome)
    flight = _Flight()
    auth = _Flight()
    state = _State(cfg, hooks, st, rs, flight, auth, backend.user_agent(cfg.ccrc_version))
    try:
        httpd = _make_server_class(hooks.server_class)(("127.0.0.1", cfg.port), _make_handler(state))
    except OSError as e:
        raise SystemExit(LOG_PREFIX + "failed to bind 127.0.0.1:%d (%s)" % (cfg.port, _code_of(e)))
    stopping = threading.Event()

    def on_term(signum: int, frame: object) -> None:
        if stopping.is_set():
            return
        stopping.set()
        threading.Thread(target=httpd.shutdown, name="codexbridge-shutdown", daemon=True).start()

    signal.signal(signal.SIGTERM, on_term)
    refresher = threading.Thread(target=_refresher, args=(cfg, stopping, auth), name="codexbridge-refresher", daemon=True)
    refresher.start()
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
    flight.wait_idle(DRAIN_S)
    cut = 0
    for s in flight.open_streams():
        if s.cut(errors.unavailable("the bridge is restarting")):
            cut += 1
            st.outcome("drain-cut")
    if cut:
        flight.wait_idle(DRAIN_WRITE_S)
    auth.wait_idle(max(0.0, STOP_MARGIN_S - DRAIN_WRITE_S - EXIT_MARGIN_S))
    st.flush(force=True)
    return 0
