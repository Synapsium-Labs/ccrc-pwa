#!/usr/bin/env python3
"""ccgpt-proxy — ccrc's front shim between Claude Code and the LiteLLM proxy
that fronts a ChatGPT/Codex subscription lane.

Binds a port, answers its own identity, and forwards every request
byte-for-byte — except a POST body on a path ending `/messages`, which is
parsed as JSON and rewritten: every mid-conversation `role: "system"` entry
inside `messages` becomes `role: "user"`, in place (`_fold_midturn_system`).
Codex refuses a `system` entry there, and because the entry is replayed with
the conversation history, one unfolded injection fails every later turn of
that session. A body on that path the shim cannot parse at all is still
forwarded unrewritten today — three call sites, catalogued as D-3151 in the
plan's `## Deviations found`, until Task 7 replaces them with an explicit
refusal.

Listens on 127.0.0.1:$CCGPT_PROXY_PORT; forwards to the LiteLLM proxy at
127.0.0.1:$CCGPT_LITELLM_PORT. No credentials are stored here — the
Authorization header passes through unexamined.

THE LANE'S NAME, ANSWERED LOCALLY. A caller asks GET /ccgpt/lane before it
trusts a listening shim port, because a port is only a number: two lanes can
have their proxy ports collide with something else entirely (a stray test
mock, another lane's leftover listener), and the only way to tell this
listener apart from one of those is to ask it who it is. The answer is the
account id this shim was started with — the same id a later task will use to
resolve this lane's own effort defaults and credentials. Plan 2b's adoption
check refuses to attach to a listener that answers a DIFFERENT lane's id.

THERE ARE NO DEFAULT PORTS OR LANE ID. `CCGPT_ACCOUNT_ID`, `CCGPT_PROXY_PORT`
and `CCGPT_LITELLM_PORT` are all required; a missing one is a refusal to
start, loudly, naming the variable — not a guessed port. A defaulted port is
the exact mechanism by which one lane's shim would silently reach another
lane's gateway and bill the wrong account.
"""
import os
import sys
import json
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _required_env(name: str) -> str:
    """Read one required environment variable, or refuse to start.

    No default is offered for any of the three variables this shim reads —
    see the module docstring's note on why a defaulted port is unsafe here,
    not merely unhelpful.
    """
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ccgpt-proxy: refusing to start — {name} is not set")
    return value


def _required_port(name: str) -> int:
    """Like `_required_env`, but for a variable that must parse as a port
    number. Left unwrapped, a non-numeric value escaped as a bare
    `ValueError` traceback instead of the same named refusal every other
    missing or invalid variable gets (fix round 1, M-3)."""
    raw = _required_env(name)
    try:
        return int(raw)
    except ValueError:
        sys.exit(f"ccgpt-proxy: refusing to start — {name} is not a valid port number: {raw!r}")


def _fold_midturn_system(data):
    """Every messages[*] with role 'system' becomes 'user', IN PLACE.

    The beta that produces these entries exists because position carries
    meaning, so this never hoists. Both content shapes convert: the sender
    draws no distinction between a plain string and a content-block list, and
    the string arm survives today only because a layer below happens to hoist
    it. Codex refuses either, and the entry is replayed with the history, so
    one unfolded injection fails every later turn.
    """
    msgs = data.get("messages")
    if not isinstance(msgs, list):
        # D-3151, arm 3 of 3: `messages` present but not a list (e.g. a
        # dict) leaves any `role: "system"` entries inside it untouched —
        # `data` is returned as-is and the caller re-encodes and forwards it.
        # Safe today only because the measured fact D-3151 records: every
        # body reaching this shape is one the real upstream parser also
        # rejects, so it can never become the sticky replay hazard the fold
        # exists to close. Task 7 replaces this arm; it does not add a
        # fourth branch beside it.
        return data
    for m in msgs:
        if isinstance(m, dict) and m.get("role") == "system":
            m["role"] = "user"
    return data


def _rewrite_messages_body(body: bytes) -> bytes:
    """The `/messages`-path rewrite: fold mid-conversation `system` turns,
    then re-encode. `ensure_ascii=False` (fix round 1, M-5): the default
    would re-escape every non-ASCII byte the client sent even when nothing
    needed folding, and a proxy that rewrites more of the wire than it must
    is a proxy whose diffs are harder to reason about — keep the forwarded
    body as close to what arrived as re-encoding allows.

    A body that cannot be turned into a JSON object at all — malformed JSON,
    a non-object top level, or JSON nested deep enough that the decoder
    itself gives up (fix round 1, I-1: `RecursionError` is a `RuntimeError`
    subclass, not a `ValueError`, and used to escape this except arm
    entirely, dropping the connection with no HTTP response) — has nothing
    safe to fold into, so it is forwarded exactly as received. D-3151, arms 1
    and 2 of 3 (the third is `_fold_midturn_system`'s own non-list arm):
    recorded in the plan's `## Deviations found`, safe only because every
    body reaching either arm today is one the real upstream parser also
    rejects. Task 7 replaces both with an explicit refusal rather than
    adding a fourth branch beside them.
    """
    try:
        data = json.loads(body)
    except (TypeError, ValueError, RecursionError):
        # D-3151, arm 1 of 3.
        return body
    if not isinstance(data, dict):
        # D-3151, arm 2 of 3: valid JSON whose top level is not an object —
        # e.g. a bare array — carries no `messages` key and so cannot be
        # routed as an Anthropic request either; see the docstring above.
        return body
    data = _fold_midturn_system(data)
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


ACCOUNT_ID = _required_env("CCGPT_ACCOUNT_ID")
PROXY_PORT = _required_port("CCGPT_PROXY_PORT")
LITELLM_PORT = _required_port("CCGPT_LITELLM_PORT")
UPSTREAM = f"http://127.0.0.1:{LITELLM_PORT}"

LANE_PATH = "/ccgpt/lane"

# Per-hop headers (RFC 7230 §6.1, plus accept-encoding) must never be copied
# from one connection onto the next — they describe THIS hop, not the
# message, and copying content-length/transfer-encoding across a body this
# shim may later rewrite would describe a size that no longer matches.
HOP_BY_HOP = {
    "host", "connection", "content-length", "transfer-encoding", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
    "accept-encoding",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _lane(self):
        payload = json.dumps({"lane": ACCOUNT_ID}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    def _relay(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        path_only = self.path.split("?", 1)[0].rstrip("/")
        if path_only == LANE_PATH:
            # A body on this endpoint is unexpected but drained above so a
            # client that sent one (a generic HTTP client dressing every
            # verb with headers) doesn't leave bytes on the wire.
            self._lane()
            return
        # Every other path is forwarded exactly as received, except one
        # ending `/messages`: that body is JSON, and Codex refuses a
        # mid-conversation `role: "system"` entry inside its `messages` —
        # _fold_midturn_system converts each one to `user`, in place, before
        # the request ever leaves this shim. Suffix match, not the exact
        # literal `/v1/messages` (fix round 1, M-4): spec §6.4 speaks of
        # "non-/messages paths", and nothing in this repo yet pins the
        # generated launcher's base URL to an empty path component — a
        # prefixed mount (e.g. a path-carrying `ANTHROPIC_BASE_URL`) must
        # not silently bypass the fold.
        if body and path_only.endswith("/messages"):
            body = _rewrite_messages_body(body)
        req = urllib.request.Request(UPSTREAM + self.path, data=body or None, method=self.command)
        for key, value in self.headers.items():
            if key.lower() not in HOP_BY_HOP:
                req.add_header(key, value)
        if body:
            req.add_header("Content-Length", str(len(body)))
        try:
            resp = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as e:
            resp = e
        except (urllib.error.URLError, OSError) as e:
            self.send_error(502, f"ccgpt-proxy: upstream unreachable: {e}")
            return
        self.send_response(resp.status)
        for key, value in resp.headers.items():
            if key.lower() not in HOP_BY_HOP:
                self.send_header(key, value)
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()

    # Every verb Claude Code or ccgpt itself might issue is forwarded — GET
    # and HEAD for probes/health checks, OPTIONS for a preflight-shaped
    # client, the rest for the actual traffic. Without HEAD/OPTIONS here,
    # `BaseHTTPRequestHandler`'s own default answers a bare 501 for either,
    # which would make "everything else forwarded untouched" (module
    # docstring) not literally true (fix round 1, M-5).
    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _relay


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PROXY_PORT), Handler)
    except OSError as e:
        # Unwrapped, a bind failure (most commonly EADDRINUSE) is a bare
        # socketserver traceback with no ccrc-shaped message (fix round 1,
        # M-4) — easy to miss in a unit's journal next to everything else a
        # crashing process prints.
        sys.exit(f"ccgpt-proxy: failed to bind 127.0.0.1:{PROXY_PORT}: {e}")
    server.serve_forever()
