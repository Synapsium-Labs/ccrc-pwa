"""siwc-trial — the operator's one-off trial of the Sign in with ChatGPT plan-usage route.

Codex-bridge spec 2026-10-15 §2.2 (the `siwc` route and the terms that bind it), §2.6 (ID tokens are trusted through
TLS from the token endpoint), §5 ("The operator's trial") and decision D10: "The operator runs a helper; the token
never passes through an agent." Stage 3 (the `siwc` adapter) is built from what this trial records. It is run BY THE
OPERATOR, by hand, on their own machine, as a file under `-I` (it refuses without it); never by an agent, a session
or a timer:

    python3 -I deploy/siwc-trial.py signin  [--dir <dir>] [--no-browser] [--wait <1-900>]
    python3 -I deploy/siwc-trial.py status  [--dir <dir>]
    python3 -I deploy/siwc-trial.py models  [--dir <dir>]
    python3 -I deploy/siwc-trial.py probe   [--dir <dir>] --model <slug> (--step <1-21> | --all)
    python3 -I deploy/siwc-trial.py signout [--dir <dir>]

Standard library only, Python 3.9 or later, plus two things of this tree: the bridge package (`ccd/codexbridge`: its
recorder, its SSE parser, its transport and the live probe's printing bounds) and Stage 1's credential library
(`ccd/ccgpt-auth.py`, loaded by path: its JWT claim reader and its token-error classifier). So it runs from a whole
ccrc tree, a checkout or an installed one.

THE PROTOCOL is OpenAI's developer pages for Sign in with ChatGPT in an open-source tool (sign-in, accounts and
sessions, token reference, models and inference, preview limitations, errors and recovery), as read on 2026-11-10: a
public client under PKCE S256 with no secret, registered at its first sign-in as a dynamic client and issued a client
id bound to that user. It identifies itself as ccrc and nothing else (`agent_name_hint=ccrc`, `originator: ccrc`, a
`ccrc-siwc-trial/<n>` User-Agent), sends every request from the machine it runs on, and keeps the tokens in a local
file under the operator's control.

THE DIRECTORY (`--dir`, default `~/.config/ccrc-siwc-trial`; made 0700, its parent never made) holds, each 0600:
  host-id            this host's `ext_agent_host_id` (`urn:uuid:<uuid4>`), chosen once and kept. A second directory on
                     the same host should be given a copy of it before its first sign-in.
  registration.json  the issued client id and the validated subject, written by a validated sign-in and kept by
                     `signout`, so the next sign-in re-authorises the same registration.
  credential.json    the credential record, in the sign-in page's shape (issuer, subject, client_id,
                     ext_agent_host_id, id_token, access_token, refresh_token, token_type, expires_in, scopes,
                     saved_at; also email and earliest_refresh_at as received). Written beside itself and renamed
                     over itself, so the name never holds part of a write.
  siwc-trial.count   how many requests were sent to the API base.
  lock               held (flock) by every verb but `status`: one run per directory at a time.
  <recordings>/      (0700; the name a lane's recordings directory takes) one `siwc-<step>-<utc>-<n>.sse` per answer
                     in `record.py`'s format (the status line, the response headers, a blank line, the body's raw
                     bytes), and the request body beside it as `siwc-<step>-<utc>-<n>.request.json`. A recording is
                     raw: it holds ids, texts and encrypted reasoning, and so do the request files of steps 7, 14 and
                     15, which replay a recording. `record.py scrub` makes a corpus stream of one in a reviewed
                     change. Nothing in the tree registers this directory as a secret source, so no session's deny
                     rule or history redaction covers it: keep it where no session reads, and remove it after.

THE VERBS.
  signin   chooses or reuses the host id, then fetches the authorization server's discovery document: a Python that
           cannot reach the server or verify its certificate (one with no CA certificates) refuses here, before the
           browser opens, and the document's issuer and two endpoints are each printed as `same`, `differs` or
           `absent` beside the pages', which are the ones used. It listens on a free port of 127.0.0.1, prints the
           authorize URL (and opens the browser unless `--no-browser`), and waits `--wait` seconds (300; at most
           900) for one callback on `/auth/callback`: a consent given after the wait has ended reaches no listener,
           and a new registration made by it is not saved. The first request on that path IS the callback: its
           `state` is checked first, then an OAuth error, the code, and the client id (a new registration must be
           issued one; a re-authorisation must not be given another). A request on any other path is answered 404
           and the wait goes on; a second request on the callback path before the record is written refuses the
           attempt. The code is exchanged at the token endpoint, the ID token's claims are checked (issuer, audience
           the issued client id, expiry, nonce, a subject; no signature check, §2.6; a returning account's subject
           must be the saved one), and the registration and the record are written. A registration is saved only
           by a validated sign-in, so a first sign-in that fails after the consent registers a new client the next
           time. A re-authorisation sends the saved client id and neither `agent_name_hint` nor a hint that names
           the account (`id_token_hint`, `login_hint`): the URL is printed, and an ID token or an email never is.
  status   reads the record and prints the three facts (WHAT IT PRINTS). It sends nothing and never refreshes.
  models   `GET /v1/models`: each model's slug and visibility. The request is counted, as a probe's is.
  probe    the numbered requests of STEPS, each hand-built, tiny and synthetic: no prompt names a person, a project
           or a host. Every body carries `store: false` and `stream: true`; none carries a field the route's pages
           list as unsupported, but step 21, which carries one on purpose. `--all` runs them in order and stops
           after an answer it cannot continue past (below). Steps 7, 14 and 15 replay the latest recording of step 6
           or 13 and refuse without one.
  signout  revokes the refresh token at the discovery document's `revocation_endpoint` and deletes the record; the
           registration, the host id and the recordings stay. With no endpoint published, or one that is not on the
           authorization server's own origin (the token is never sent there), it says so and still deletes the
           record. When the revocation or the discovery document fails, the record is kept, so `signout` can be
           run again.

THE BOUNDS. The two bases are `https://auth.openai.com` and `https://api.openai.com`. CCRC_SIWC_AUTH_BASE and
CCRC_SIWC_API_BASE override them for the test suite only, and only as `http://127.0.0.1:<port>`, both or neither:
any other value refuses before anything is read or sent, so a stray variable never sends a token to another host.
Every request goes through `http.client`, which follows no redirect and reads no proxy setting. Requests to the API
base (`models` and every probe) are counted in the count file, raised BEFORE each is sent, and past PROBE_MAX nothing
is sent. The access token is refreshed only once it has expired, by one refresh-token request whose answer replaces
the old tokens in one rename; a refresh the endpoint refuses as dead (`invalid_grant`, `refresh_token_reused` and the
credential library's other codes) clears the refresh token from the record and refuses `needs-signin`, so it is never
tried again. The record keeps the answer's `earliest_refresh_at` as received, and nothing here reads it: the trial
refreshes only at expiry. `probe` and `models` refuse a record whose granted scopes lack `chatgpt.tokens.use.direct`.
Inside a Claude Code session (CLAUDECODE set) every verb refuses `in-session`: a speed bump, not a wall (`env -u
CLAUDECODE` passes it), as `ccrc history`'s writing verbs have, because of D10.

WHAT IT PRINTS (stdout, one `siwc-trial: ` line each): names and numbers. For a sign-in: its progress in fixed words
(the host id chosen or kept, the registration new or saved, each discovery field, the browser, the callback, the
exchange's status), then, as for `status`: whether plan usage is enabled, each granted scope's name, the seconds to
expiry. For a request: the step and its description, the request's number, the HTTP status, every response header
NAME, every event type, every finished item's type, the terminal event's type and its numeric usage fields, an
incomplete answer's reason, and for an error its shape and its code, param and type, each only under a bounded
pattern and never when it repeats the token that was sent; then the recording's file name. Never a header value, a
text, an id, a token, a code, a verifier, an ID token, an email or an encrypted content. ONE line carries values:
`authorize-url`, which the browser must be given. It holds the state, the nonce, the PKCE challenge, the host id and,
on a re-authorisation, the client id; never the verifier, a token or the email. A refusal is one stderr line,
`siwc-trial: refused <word>: <sentence>`; an exception is named by its class only, never its text.

EXIT 0 done: a sign-in written; the facts printed; every request answered by something the trial continues past (a
2xx stream read to `response.completed` or `response.incomplete`, or a 400, which is a recorded finding) and recorded
whole; the token revoked and the record deleted. 1 refused or failed: the refused step was not taken (a run's earlier
requests, if any, were sent and stay counted). 2 usage. 3 attempted, and not whole: a request was sent and counted
but its answer was another status, a `response.failed`, a stream with no terminal event, a transport failure or a
recording that could not be written (`--all` stops there and names the step); or a sign-out whose revocation was not
confirmed.
"""

import sys

if not sys.flags.isolated:  # before any other import: under -I nothing beside this file or in PYTHON* is imported
    sys.stderr.write("siwc-trial: refused not-isolated: run it as 'python3 -I deploy/siwc-trial.py <verb>', so "
                     "no module is taken from the working directory or the environment\n")
    sys.exit(1)

import base64
import calendar
import fcntl
import hashlib
import hmac
import http.client
import http.server
import json
import math
import os
import queue
import re
import secrets
import socketserver
import ssl
import threading
import time
import urllib.parse
import uuid
import webbrowser
from typing import Callable, Dict, List, NamedTuple, Optional, Sequence, Tuple

sys.dont_write_bytecode = True  # -I implies -E, so PYTHONDONTWRITEBYTECODE is ignored and an import would write
HERE = os.path.dirname(os.path.abspath(__file__))
TREE = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(TREE, "ccd"))  # the bridge package's parent, as its own file entries put it
from codexbridge import backend, errors, liveprobe, record, server, sse  # noqa: E402

VERSION = "1"
PREFIX = "siwc-trial: "
APP_NAME = backend.ORIGINATOR  # one name: the `agent_name_hint` and the `originator` header
USER_AGENT = "ccrc-siwc-trial/" + VERSION

# ── the endpoints (the sign-in, accounts and inference pages) ────────────────────────────────────────────────────
AUTH_BASE = "https://auth.openai.com"
API_ORIGIN = "https://api.openai.com"
API_PREFIX = "/v1"
ISSUER = AUTH_BASE
RESOURCE = API_ORIGIN + API_PREFIX  # the `resource` of every authorization and token request, whatever the base
AUTHORIZE_PATH = "/api/accounts/authorize"
TOKEN_PATH = "/api/accounts/oauth/token"
DISCOVERY_PATH = "/.well-known/openid-configuration"
MODELS_PATH = "/models"
CALLBACK_PATH = "/auth/callback"
AUTH_BASE_ENV = "CCRC_SIWC_AUTH_BASE"
API_BASE_ENV = "CCRC_SIWC_API_BASE"
SESSION_ENV = "CLAUDECODE"  # set, and not empty, inside a Claude Code session
_OVERRIDE_RE = re.compile(r"http://127\.0\.0\.1:([0-9]{1,5})")
DYNAMIC_CLIENT = "dynamic_agent_client"  # the first registration's entry point, never an id to save or exchange with
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
PLAN_SCOPE = "chatgpt.tokens.use.direct"

# ── the directory ────────────────────────────────────────────────────────────────────────────────────────────────
HOST_ID_FILE = "host-id"
REGISTRATION_FILE = "registration.json"
CREDENTIAL_FILE = "credential.json"
COUNT_FILE = "siwc-trial.count"
LOCK_FILE = "lock"
TMP_SUFFIX = ".tmp"
FILE_MODE = record.FILE_MODE
RECORD_MAX_BYTES = 1 << 20
SAVED_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_HOST_ID_RE = re.compile(r"urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                         r"|urn:ietf:params:oauth:jwk-thumbprint:[A-Za-z0-9:_-]{1,200}|did:key:[A-Za-z0-9]{1,200}")
_CLIENT_ID_RE = re.compile(r"[A-Za-z0-9_.-]{1,128}")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)

# ── the bounds ───────────────────────────────────────────────────────────────────────────────────────────────────
PROBE_MAX = 60  # requests to the API base, per directory
WAIT_S = 300  # the wait for the callback
WAIT_MAX_S = 900  # the longest `--wait`: a first registration (a sign-in, a name for the agent, the consent) is slow
CALLBACK_IO_S = 5.0  # a connection to the listener that sends nothing is dropped after this
SMALL_TIMEOUT_S = 30.0  # each socket operation of a token, discovery, revocation or models request
ANSWER_MAX = 1 << 20  # such an answer is read no further than this
PROBE_IDLE_S = 120.0  # a probe's answer may be silent this long
_MODEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
_PARAM_RE = re.compile(r"[A-Za-z0-9_.\[\]-]{1,64}")
_TERMINALS = ("response.completed", "response.incomplete", "response.failed")
_CONTINUES = ("response.completed", "response.incomplete")

# A name as the live probe prints one: itself under the stats file's NAME_RE, else `unrecognised`. The probe's two
# printing helpers (this and `_usage_lines`) are used as they are, so both routes' probes print under one bound.
_name = liveprobe._name


class Refused(Exception):
    """A refusal: a word, and a sentence naming the remedy, never a value."""

    def __init__(self, word: str, sentence: str) -> None:
        super().__init__(word)
        self.word = word
        self.sentence = sentence


def _out(line: str) -> None:
    sys.stdout.write(PREFIX + line + "\n")
    sys.stdout.flush()  # a pipe is block-buffered, and the authorize URL must be seen while the listener waits


def _err(line: str) -> None:
    sys.stderr.write(PREFIX + line + "\n")
    sys.stderr.flush()


def _class(e: BaseException) -> str:
    """An exception as it may be printed: its class. Its text can carry a value (http.client formats a header it
    refuses with %r)."""
    return _name(type(e).__name__)


def _finite(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _shown(value: Optional[str], pattern: "re.Pattern[str]", sent: Sequence[str]) -> str:
    """A code, param or type as it may be printed: itself under `pattern`, else `unrecognised`; and `unrecognised`
    when it carries, or is a piece of, something this run sent (`sent`: a token, a code, a verifier), because an
    endpoint that echoes a short secret as its error code would otherwise have it printed."""
    if not isinstance(value, str) or not pattern.fullmatch(value):
        return errors.UNRECOGNISED_CODE
    low = value.lower()
    for secret in sent:
        s = secret.lower()
        if s and (s in low or (len(low) >= 8 and low in s)):
            return errors.UNRECOGNISED_CODE
    return value


def _code(value: object, sent: Sequence[str]) -> Optional[str]:
    """A code lower-cased, as the bridge reads one (`errors.CODE_RE`), bounded by `_shown`; None when there is none."""
    if not isinstance(value, str) or not value.strip():
        return None
    return _shown(value.lower(), errors.CODE_RE, sent)


# ── the two bases ────────────────────────────────────────────────────────────────────────────────────────────────
class Bases(NamedTuple):
    auth: str  # the authorization server
    api: str  # the API, with its /v1


def bases(environ: Dict[str, str]) -> Bases:
    """The two real bases, or two loopback fakes: an override is `http://127.0.0.1:<port>` and nothing else, and one
    base overridden without the other is refused too, so a real token never goes to a fake's partner and a fake's
    never to the real API. The refusal never echoes the value."""
    values = []  # type: List[Optional[str]]
    for env, word in ((AUTH_BASE_ENV, "bad-auth-base"), (API_BASE_ENV, "bad-api-base")):
        value = environ.get(env)
        if not value:
            values.append(None)
            continue
        m = _OVERRIDE_RE.fullmatch(value)
        if m is None or not 0 < int(m.group(1)) <= 65535:
            raise Refused(word, env + " must be an http:// URL on 127.0.0.1 with a port and nothing after it (the "
                          "test suite's fake); unset it to use the real endpoint")
        values.append(value)
    if (values[0] is None) != (values[1] is None):
        raise Refused("base-pair", AUTH_BASE_ENV + " and " + API_BASE_ENV + " are set together or not at all; unset "
                      "both to use the real endpoints")
    if values[0] is None or values[1] is None:
        return Bases(AUTH_BASE, API_ORIGIN + API_PREFIX)
    return Bases(values[0], values[1] + API_PREFIX)


# ── the directory's files ────────────────────────────────────────────────────────────────────────────────────────
def default_dir() -> str:
    return os.path.join(os.path.expanduser("~"), ".config", "ccrc-siwc-trial")


def make_dir(d: str) -> None:
    """The trial directory, made 0700 when absent (its last level only), as the recorder makes its own."""
    if not record.ensure_dir(d):
        raise Refused("dir-unusable", "the trial directory cannot be made, or is a symlink or not a directory; make "
                      "its parent directory first, or pass --dir")


def take_lock(d: str) -> None:
    """One run per directory: an exclusive flock on LOCK_FILE, never waited for, held until the process ends. It
    keeps two runs from racing the rotating refresh token or the count."""
    try:
        fd = os.open(os.path.join(d, LOCK_FILE), os.O_RDWR | os.O_CREAT | _NOFOLLOW, FILE_MODE)
    except FileNotFoundError:
        raise Refused("no-credential", "the trial directory does not exist; run signin")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise Refused("busy", "another run holds this directory; wait for it to end")


def write_private(path: str, data: bytes) -> None:
    """`data` at `path`, 0600: written to a new file beside it, synced, then renamed over it, so `path` never holds
    part of a write and a reader sees the old bytes or the new; then the directory is synced."""
    tmp = path + TMP_SUFFIX
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | _NOFOLLOW, FILE_MODE)
        try:
            os.fchmod(fd, FILE_MODE)
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    _sync_dir(os.path.dirname(path))


def _sync_dir(d: str) -> None:
    try:
        fd = os.open(d, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _write_json(path: str, value: dict) -> None:
    write_private(path, (json.dumps(value, indent=2) + "\n").encode("utf-8"))


def _read_json(path: str) -> object:
    """A small JSON file's value. FileNotFoundError when it is absent; ValueError when it is not JSON."""
    with open(path, "rb") as f:
        raw = f.read(RECORD_MAX_BYTES + 1)
    if len(raw) > RECORD_MAX_BYTES:
        raise ValueError("too large")
    try:
        return json.loads(raw.decode("utf-8"))
    except RecursionError:
        raise ValueError("nested too deep")


def host_id(d: str) -> Tuple[str, bool]:
    """(this host's `ext_agent_host_id`, whether it was chosen now). It is chosen once, before the first sign-in, and
    kept: a file that cannot be read or is no host id is refused, never replaced."""
    path = os.path.join(d, HOST_ID_FILE)
    try:
        with open(path, "rb") as f:
            text = f.read(1024).decode("ascii", "replace").strip()
    except FileNotFoundError:
        value = "urn:uuid:" + str(uuid.uuid4())
        write_private(path, (value + "\n").encode("ascii"))
        return value, True
    except OSError:
        text = ""
    if not _HOST_ID_RE.fullmatch(text):
        raise Refused("host-id-unreadable", "the directory's " + HOST_ID_FILE + " cannot be read or holds no host id "
                      "(urn:uuid:, a JWK thumbprint URI or did:key:); the operator decides what it should hold")
    return text, False


def read_registration(d: str) -> Optional[Tuple[str, str]]:
    """(the issued client id, the validated subject) of the directory's registration, or None when there is none."""
    try:
        value = _read_json(os.path.join(d, REGISTRATION_FILE))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        value = None
    client = value.get("client_id") if isinstance(value, dict) else None
    subject = value.get("subject") if isinstance(value, dict) else None
    if not (isinstance(client, str) and _CLIENT_ID_RE.fullmatch(client) and client != DYNAMIC_CLIENT
            and isinstance(subject, str) and subject):
        raise Refused("registration-unreadable", "the directory's " + REGISTRATION_FILE + " cannot be read or is out "
                      "of shape; the operator decides whether to remove it, which registers a new client")
    return client, subject


def _saved_at(rec: dict) -> Optional[int]:
    try:
        return calendar.timegm(time.strptime(rec.get("saved_at"), SAVED_AT_FORMAT))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def read_record(d: str) -> dict:
    """The credential record, checked for the fields the verbs read."""
    try:
        rec = _read_json(os.path.join(d, CREDENTIAL_FILE))
    except (FileNotFoundError, NotADirectoryError):
        raise Refused("no-credential", "the directory holds no credential record; run signin")
    except (OSError, ValueError):
        rec = None
    ok = (isinstance(rec, dict) and isinstance(rec.get("access_token"), str) and rec["access_token"]
          and isinstance(rec.get("client_id"), str) and _CLIENT_ID_RE.fullmatch(rec["client_id"])
          and isinstance(rec.get("scopes"), list) and all(isinstance(s, str) for s in rec["scopes"])
          and _finite(rec.get("expires_in")) and _saved_at(rec) is not None
          and (rec.get("refresh_token") is None or isinstance(rec["refresh_token"], str)))
    if not ok:
        raise Refused("credential-unreadable", "the directory's " + CREDENTIAL_FILE + " cannot be read or is out of "
                      "shape; run signin again")
    return rec  # type: ignore[return-value]


def seconds_left(rec: dict, now: float) -> int:
    """The seconds until the access token expires: `saved_at` plus `expires_in`, less `now`; negative once past."""
    return int(_saved_at(rec) + rec["expires_in"] - now)  # type: ignore[operator]


def facts(rec: dict) -> None:
    """The three facts of a sign-in: whether plan usage is enabled (the granted scopes hold PLAN_SCOPE), each granted
    scope's name, and the seconds to the access token's expiry."""
    _out("plan-usage " + ("enabled" if PLAN_SCOPE in rec["scopes"] else "not-enabled"))
    for scope in rec["scopes"]:
        _out("scope " + _name(scope))
    _out("expires-in %d" % seconds_left(rec, time.time()))


def require_plan(rec: dict) -> None:
    if PLAN_SCOPE not in rec["scopes"]:
        raise Refused("plan-usage-not-enabled", "the granted scopes do not include " + PLAN_SCOPE + ", so nothing is "
                      "sent to the API; enable ChatGPT plan usage for this app, then run signin again")


# ── the requests with small answers ──────────────────────────────────────────────────────────────────────────────
class Answer(NamedTuple):
    status: int
    names: List[str]  # the answer's header names, lower-cased, in order
    body: bytes


def small_request(base: str, method: str, path: str, headers: Sequence[Tuple[str, str]],
                  body: Optional[bytes] = None) -> Answer:
    """One request whose answer is small (a token answer, the discovery document, the model list): `method` to
    `base` + `path` over http.client, which follows no redirect and reads no proxy setting, so nothing is sent
    anywhere but `base`. TLS is verified by the default context. At most ANSWER_MAX bytes of the answer are read."""
    parts = urllib.parse.urlsplit(base)
    if parts.scheme == "https":
        conn = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=SMALL_TIMEOUT_S,
                                           context=ssl.create_default_context())  # type: http.client.HTTPConnection
    else:
        conn = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=SMALL_TIMEOUT_S)
    try:
        conn.request(method, parts.path + path, body=body, headers=dict(headers))
        resp = conn.getresponse()
        return Answer(resp.status, [name.lower() for name, _ in resp.getheaders()], resp.read(ANSWER_MAX))
    finally:
        conn.close()


def post_form(base: str, path: str, fields: Sequence[Tuple[str, str]]) -> Answer:
    return small_request(base, "POST", path, [("Content-Type", "application/x-www-form-urlencoded"),
                                              ("Accept", "application/json"), ("User-Agent", USER_AGENT)],
                         urllib.parse.urlencode(list(fields)).encode("ascii"))


class Unreachable(Exception):
    """The discovery document could not be had; the text is a class, a status or a word, never a value."""


def discovery(b: Bases) -> dict:
    """The authorization server's discovery document; Unreachable when it cannot be fetched, is not a 200 or is not
    a JSON object."""
    try:
        doc = small_request(b.auth, "GET", DISCOVERY_PATH, [("Accept", "application/json"), ("User-Agent", USER_AGENT)])
    except Exception as e:
        raise Unreachable(_class(e))
    if doc.status != 200:
        raise Unreachable("status %d" % doc.status)
    try:
        found = json.loads(doc.body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        found = None
    if not isinstance(found, dict):
        raise Unreachable("not a JSON object")
    return found


def preflight(b: Bases) -> None:
    """Before the browser is opened: fetch the discovery document, which proves this Python can reach the
    authorization server and verify its certificate. A Python with no CA certificates fails here, not at the code
    exchange, where the consent has been given and a new registration's client id would be lost. Then say whether
    the issuer and the two endpoints the document publishes are the ones the pages give, which are the ones used."""
    try:
        published = discovery(b)
    except Unreachable as e:
        raise Refused("auth-unreachable", "the authorization server's discovery document could not be read (%s), so "
                      "the browser was not opened and nothing was registered; SSLCertVerificationError means this "
                      "python3 has no CA certificates, so run the helper with one that has" % e)
    for field, ours in (("issuer", ISSUER), ("authorization_endpoint", b.auth + AUTHORIZE_PATH),
                        ("token_endpoint", b.auth + TOKEN_PATH)):
        got = published.get(field)
        _out("discovery %s %s" % (field, "same" if got == ours else "absent" if got is None else "differs"))


def auth_lib() -> object:
    """Stage 1's credential library, from this tree, loaded by path as the bridge loads it. The trial uses its JWT
    claim reader (`claims_of`) and its token-error classifier (`classify_error`), and none of its files."""
    return server.load_auth_lib(os.path.join(TREE, "ccd", "ccgpt-auth.py"))


def token_answer(body: bytes) -> dict:
    """A 200 token answer's fields, as the record keeps them: `access_token` and a positive `expires_in` are
    required; `refresh_token`, `id_token`, `scope` (None when absent) and `earliest_refresh_at` are kept when sent."""
    try:
        obj = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        obj = None
    access = obj.get("access_token") if isinstance(obj, dict) else None
    expires = obj.get("expires_in") if isinstance(obj, dict) else None
    refresh = obj.get("refresh_token") if isinstance(obj, dict) else None
    if (not (isinstance(access, str) and access) or not _finite(expires) or expires <= 0  # type: ignore[operator]
            or not (refresh is None or (isinstance(refresh, str) and refresh))):
        raise Refused("token-answer-malformed", "the token endpoint's answer is not a JSON object with an access "
                      "token and a lifetime in seconds; nothing was written")
    scope, earliest = obj.get("scope"), obj.get("earliest_refresh_at")
    return {
        "access_token": access, "refresh_token": refresh, "expires_in": int(expires),  # type: ignore[arg-type]
        "id_token": obj.get("id_token") if isinstance(obj.get("id_token"), str) else None,
        "token_type": obj.get("token_type") if isinstance(obj.get("token_type"), str) else "Bearer",
        "scopes": scope.split() if isinstance(scope, str) else None,
        "earliest_refresh_at": earliest if isinstance(earliest, str) or _finite(earliest) else None,
    }


# ── signin: the callback ─────────────────────────────────────────────────────────────────────────────────────────
_CALLBACK_REFUSALS = {
    "callback-malformed": "the callback's query could not be read, or gave state, code, client_id or error more "
                          "than once; run signin again",
    "state-mismatch": "the callback's state is not this attempt's; nothing was exchanged; run signin again",
    "access-denied": "the sign-in was declined in the browser (access_denied); nothing was exchanged",
    "callback-error": "the callback carried an OAuth error; nothing was exchanged; run signin again",
    "no-code": "the callback carried no authorization code; run signin again",
    "registration-incomplete": "the callback of a new registration named no issued client id, so the registration "
                               "is incomplete; run signin again",
    "client-changed": "the callback named a client id other than the saved registration's; the record stands; run "
                      "signin again, or use another --dir for another account",
}


class Verdict(NamedTuple):
    word: Optional[str]  # None: the callback is this attempt's
    code: str
    client: str  # the client id the exchange is made with


def judge_callback(query: str, state: str, saved_client: Optional[str]) -> Verdict:
    """The callback's query against the pending attempt, in the sign-in page's order: `state` first, then an OAuth
    error, then the code, then the client id. A new registration (`saved_client` None) must be issued an id, which
    is never the registration entry point; a re-authorisation may be given none and must not be given another."""
    try:
        pairs = urllib.parse.parse_qs(query, keep_blank_values=True, max_num_fields=32)
    except ValueError:
        return Verdict("callback-malformed", "", "")
    for name in ("state", "code", "client_id", "error"):
        if len(pairs.get(name, [])) > 1:
            return Verdict("callback-malformed", "", "")
    one = {name: values[0] for name, values in pairs.items()}
    if not hmac.compare_digest(one.get("state", "").encode("utf-8"), state.encode("utf-8")):
        return Verdict("state-mismatch", "", "")
    if "error" in one:
        return Verdict("access-denied" if one["error"] == "access_denied" else "callback-error", "", "")
    code, client = one.get("code", ""), one.get("client_id")
    if not code:
        return Verdict("no-code", "", "")
    if saved_client is None:
        if client is None or client == DYNAMIC_CLIENT or not _CLIENT_ID_RE.fullmatch(client):
            return Verdict("registration-incomplete", "", "")
        return Verdict(None, code, client)
    if client is not None and client != saved_client:
        return Verdict("client-changed", "", "")
    return Verdict(None, code, saved_client)


class _Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ccrc-siwc-trial"
    sys_version = ""
    timeout = CALLBACK_IO_S

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # the default writes the request line to stderr: the code and the state

    def _say(self, status: int, text: str) -> None:
        raw = ("ccrc siwc-trial: " + text + "\n").encode("ascii")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        listener = self.server.listener  # type: ignore[attr-defined]
        url = urllib.parse.urlsplit(self.path)
        if url.path != CALLBACK_PATH:
            self._say(404, "refused callback-path")
            if not listener.taken:
                listener.events.put(None)
            return
        if listener.taken:
            listener.second.set()
            self._say(409, "refused second-callback")
            return
        listener.taken = True
        verdict = judge_callback(url.query, listener.state, listener.saved_client)
        listener.events.put(verdict)  # before the answer: a browser that has gone away must not lose the verdict
        if verdict.word is None:
            self._say(200, "the callback was received; go back to the terminal")
        else:
            self._say(400, "refused " + verdict.word)


class _Server(http.server.HTTPServer):
    def server_bind(self) -> None:
        """`TCPServer`'s bind, then the two names `HTTPServer` sets, without its reverse lookup of the bind address.

        `HTTPServer.server_bind` names the server `socket.getfqdn(host)`, which nothing here reads; on macOS that lookup
        of 127.0.0.1 has taken about 35 s in a new process (as `ccd/ccgpt-proxy.py`'s `_Server` measured), so the
        sign-in printed its URL and listened half a minute late (D-8343)."""
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def handle_error(self, request: object, client_address: object) -> None:
        pass  # the default prints a traceback when a connection is dropped mid-answer


class Listener:
    """The loopback listener of one sign-in attempt: 127.0.0.1 on a free port, one request at a time. The first
    request on CALLBACK_PATH is the callback and is judged as it arrives; a later one sets `second`; a request on
    another path is answered 404 and reported."""

    def __init__(self, state: str, saved_client: Optional[str]) -> None:
        self.state = state
        self.saved_client = saved_client
        self.taken = False
        self.second = threading.Event()
        self.events = queue.Queue()  # type: queue.Queue
        self._httpd = _Server(("127.0.0.1", 0), _Handler)
        self._httpd.listener = self  # type: ignore[attr-defined]
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self._thread.start()

    def wait(self, wait_s: int) -> Verdict:
        """The callback's verdict, at most `wait_s` seconds from now."""
        deadline = time.monotonic() + wait_s
        while True:
            try:
                verdict = self.events.get(timeout=max(0.0, deadline - time.monotonic()))
            except queue.Empty:
                raise Refused("callback-timeout", "no callback arrived on " + CALLBACK_PATH + " within the wait; run "
                              "signin again")
            if verdict is None:
                _err("refused callback-path: a request on a path other than " + CALLBACK_PATH + " was answered 404 "
                     "and is not the callback; still waiting")
                continue
            if verdict.word is not None:
                raise Refused(verdict.word, _CALLBACK_REFUSALS[verdict.word])
            return verdict

    def only_one(self) -> None:
        if self.second.is_set():
            raise Refused("second-callback", "a second request arrived on " + CALLBACK_PATH + " before the record "
                          "was written, so the attempt is dropped and nothing was written; run signin again")

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


def check_id_token(id_token: Optional[str], client: str, nonce: str, now: float) -> Tuple[str, Optional[str]]:
    """(the subject, the email or None) of an ID token whose claims hold: the issuer, an audience that is or holds
    the issued client id, an expiry still ahead, this attempt's nonce and a subject. The claims are decoded, not
    verified: the token came from the token endpoint over TLS (spec §2.6)."""
    claims = auth_lib().claims_of(id_token)  # type: ignore[attr-defined]
    if not claims:
        raise Refused("id-token-unreadable", "the token answer carried no ID token whose claims can be read; nothing "
                      "was written")
    if claims.get("iss") != ISSUER:
        raise Refused("id-token-issuer", "the ID token's issuer is not the authorization server; nothing was written")
    aud = claims.get("aud")
    if not (aud == client or (isinstance(aud, list) and client in aud)):
        raise Refused("id-token-audience", "the ID token's audience is not the issued client id; nothing was written")
    if not _finite(claims.get("exp")) or claims["exp"] <= now:
        raise Refused("id-token-expired", "the ID token carries no expiry ahead of this machine's clock; nothing was "
                      "written")
    got = claims.get("nonce")
    if not isinstance(got, str) or not hmac.compare_digest(got.encode("utf-8"), nonce.encode("utf-8")):
        raise Refused("id-token-nonce", "the ID token's nonce is not this attempt's; nothing was written")
    subject = claims.get("sub")
    if not (isinstance(subject, str) and subject):
        raise Refused("id-token-subject", "the ID token carries no subject; nothing was written")
    email = claims.get("email")
    return subject, email if isinstance(email, str) else None


def cmd_signin(d: str, b: Bases, no_browser: bool, wait_s: int) -> int:
    make_dir(d)
    take_lock(d)
    host, chosen = host_id(d)
    _out("host-id " + ("chosen" if chosen else "kept"))
    saved = read_registration(d)
    saved_client = saved[0] if saved is not None else None
    _out("registration " + ("saved" if saved is not None else "new"))
    preflight(b)
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    listener = Listener(state, saved_client)
    try:
        redirect = "http://127.0.0.1:%d%s" % (listener.port, CALLBACK_PATH)  # never `localhost`; only the port varies
        params = [("client_id", saved_client or DYNAMIC_CLIENT)]
        if saved_client is None:
            params.append(("agent_name_hint", APP_NAME))  # a first registration's only
        params += [("ext_agent_host_id", host), ("response_type", "code"), ("redirect_uri", redirect),
                   ("scope", SCOPES), ("resource", RESOURCE), ("state", state), ("nonce", nonce),
                   ("code_challenge_method", "S256"), ("code_challenge", challenge)]
        url = b.auth + AUTHORIZE_PATH + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe="")
        _out("authorize-url " + url)
        if no_browser:
            _out("browser skipped")
        else:
            try:
                opened = webbrowser.open(url)
            except Exception:
                opened = False
            _out("browser " + ("opened" if opened else "unopened"))
        verdict = listener.wait(wait_s)
        _out("callback received")
        listener.only_one()
        try:
            answer = post_form(b.auth, TOKEN_PATH, [
                ("grant_type", "authorization_code"), ("client_id", verdict.client), ("code", verdict.code),
                ("code_verifier", verifier), ("redirect_uri", redirect), ("resource", RESOURCE)])
        except Exception as e:
            raise Refused("exchange-failed", "the token endpoint could not be reached (" + _class(e) + "); run "
                          "signin again")
        if answer.status != 200:
            code = auth_lib().classify_error(answer.status, answer.body)[1]  # type: ignore[attr-defined]
            raise Refused("exchange-refused", "the token endpoint refused the code (%d %s); run signin again"
                          % (answer.status, _code(code, [verdict.code, verifier]) or "none"))
        _out("exchange %d" % answer.status)
        now = time.time()
        tokens = token_answer(answer.body)
        subject, email = check_id_token(tokens["id_token"], verdict.client, nonce, now)
        if saved is not None and subject != saved[1]:
            raise Refused("account-changed", "the ID token's subject is not the saved registration's account; the "
                          "record stands; use another --dir for another account")
        _out("id-token valid")
        listener.only_one()
    finally:
        listener.close()
    rec = {
        "email": email, "issuer": ISSUER, "subject": subject, "client_id": verdict.client, "ext_agent_host_id": host,
        "id_token": tokens["id_token"], "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"], "token_type": tokens["token_type"],
        "expires_in": tokens["expires_in"], "scopes": tokens["scopes"] or [],
        "saved_at": time.strftime(SAVED_AT_FORMAT, time.gmtime(now)),
        "earliest_refresh_at": tokens["earliest_refresh_at"],
    }
    # The registration first: were the record's write to fail after it, the next sign-in re-authorises this client.
    _write_json(os.path.join(d, REGISTRATION_FILE), {"client_id": verdict.client, "subject": subject})
    _write_json(os.path.join(d, CREDENTIAL_FILE), rec)
    _out("credential written")
    facts(rec)
    return 0


# ── the token, kept fresh ────────────────────────────────────────────────────────────────────────────────────────
def fresh(d: str, b: Bases, rec: dict) -> dict:
    """The record with an access token that has not expired: itself, or what ONE refresh-token request made of it
    (the accounts page: `grant_type`, the issued client id, the refresh token and the resource; no `scope`, which
    keeps the grant). The answer's tokens, lifetime and scopes replace the old in one rename; the validated ID token
    stays. A refresh refused as dead clears the refresh token and refuses `needs-signin`, so no later run sends it
    again; any other failure keeps the tokens."""
    if seconds_left(rec, time.time()) > 0:
        return rec
    refresh = rec.get("refresh_token")
    if not refresh:
        raise Refused("needs-signin", "the access token has expired and the record holds no refresh token; run "
                      "signin again")
    try:
        answer = post_form(b.auth, TOKEN_PATH, [("grant_type", "refresh_token"), ("client_id", rec["client_id"]),
                                                ("refresh_token", refresh), ("resource", RESOURCE)])
    except Exception as e:
        raise Refused("refresh-failed", "the token endpoint could not be reached (" + _class(e) + "); the tokens are "
                      "kept; run the verb again")
    if answer.status != 200:
        lib = auth_lib()
        kind, code = lib.classify_error(answer.status, answer.body)  # type: ignore[attr-defined]
        shown = "%d %s" % (answer.status, _code(code, [refresh]) or "none")
        if kind == lib.KIND_NEEDS_SIGNIN:  # type: ignore[attr-defined]
            _write_json(os.path.join(d, CREDENTIAL_FILE), dict(rec, refresh_token=None))
            raise Refused("needs-signin", "the refresh was refused (" + shown + "), so the refresh token is dead and "
                          "was cleared from the record; run signin again")
        raise Refused("refresh-failed", "the refresh was refused (" + shown + "); the tokens are kept; run the verb "
                      "again")
    tokens = token_answer(answer.body)
    new = dict(rec, access_token=tokens["access_token"], expires_in=tokens["expires_in"],
               token_type=tokens["token_type"], saved_at=time.strftime(SAVED_AT_FORMAT, time.gmtime()),
               earliest_refresh_at=tokens["earliest_refresh_at"])
    if tokens["refresh_token"] is not None:
        new["refresh_token"] = tokens["refresh_token"]
    if tokens["scopes"] is not None:
        new["scopes"] = tokens["scopes"]
    _write_json(os.path.join(d, CREDENTIAL_FILE), new)
    _out("refresh done")
    return new


# ── the count ────────────────────────────────────────────────────────────────────────────────────────────────────
def next_count(d: str) -> int:
    """The number the next request takes: the count plus one, refused past PROBE_MAX or when the file is no count."""
    try:
        with open(os.path.join(d, COUNT_FILE), "rb") as f:
            text = f.read(64).decode("ascii", "replace").strip()
    except FileNotFoundError:
        text = "0"
    except OSError:
        text = ""
    if not (text.isascii() and text.isdigit()):
        raise Refused("count-unreadable", COUNT_FILE + " cannot be read or does not hold a whole number; the "
                      "operator decides what it should read")
    if int(text) >= PROBE_MAX:
        raise Refused("count-exhausted", "the directory's %d requests are spent; the operator rules on any more"
                      % PROBE_MAX)
    return int(text) + 1


def write_count(d: str, n: int) -> None:
    write_private(os.path.join(d, COUNT_FILE), ("%d\n" % n).encode("ascii"))


# ── what an answer prints ────────────────────────────────────────────────────────────────────────────────────────
def _error_fields(err: dict, sent: Sequence[str]) -> None:
    """An error object's `code` and `type` (lower-cased, as the bridge reads a code) and its `param`, each printed
    only under its bound."""
    code, kind = _code(err.get("code"), sent), _code(err.get("type"), sent)
    if code is not None:
        _out("error-code " + code)
    if isinstance(err.get("param"), str) and err["param"]:
        _out("error-param " + _shown(err["param"], _PARAM_RE, sent))
    if kind is not None:
        _out("error-type " + kind)


def _error_body(body: bytes, sent: Sequence[str]) -> None:
    """A non-2xx answer's body, by its shape: the Responses layer's `{"error": {...}}`, a bare `{"error": "<code>"}`,
    the direct route's `{"detail": ...}` (whose text is diagnostic and is never printed), or neither."""
    try:
        obj = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        _out("error-shape not-json")
        return
    err = obj.get("error") if isinstance(obj, dict) else None
    if isinstance(err, dict):
        _out("error-shape error-object")
        _error_fields(err, sent)
    elif isinstance(err, str):
        _out("error-shape error-string")
        _out("error-code " + (_code(err, sent) or errors.UNRECOGNISED_CODE))
    else:
        _out("error-shape " + ("detail" if isinstance(obj, dict) and "detail" in obj else "other"))


def _event(ev: sse.SseEvent, terminal: Optional[dict], sent: Sequence[str]) -> Optional[dict]:
    _out("event " + _name(ev.type))
    data = ev.data if isinstance(ev.data, dict) else {}
    if ev.type == "response.output_item.done":
        item = data.get("item")
        _out("item " + _name(item.get("type") if isinstance(item, dict) else None))
    elif ev.type == "error":
        _error_fields(data["error"] if isinstance(data.get("error"), dict) else data, sent)
    if ev.type in _TERMINALS:
        return data
    return terminal


def report(up: backend.Upstream, rec: Optional[record.Recording], sent: Sequence[str]) -> int:
    """Read the whole answer into the recording and print its names (the module docstring). 0 for an answer the
    trial continues past: a 2xx stream read to `response.completed` or `response.incomplete`, or a 400; else 3."""
    _out("status %d" % up.status)
    for name in up.headers:
        _out("header " + _name(name))
    ok = 200 <= up.status < 300
    parser = sse.SseParser()
    terminal = None  # type: Optional[dict]
    body = b""
    whole = True
    try:
        for chunk in up.chunks:
            if rec is not None:
                rec.write(chunk)
            if ok:
                for ev in parser.feed(chunk):
                    terminal = _event(ev, terminal, sent)
            else:
                body += chunk
                if len(body) >= backend.ERROR_BODY_MAX:
                    break
        if ok:
            for ev in parser.close():
                terminal = _event(ev, terminal, sent)
    except backend.UpstreamTimeout as e:
        _out("transport timeout-" + _name(e.phase))
        whole = False
    except Exception as e:  # kept apart from the caller's catch, so a terminal seen before the failure is reported
        _out("transport " + _class(e))
        whole = False
    if not ok:
        _error_body(body, sent)
        return 0 if whole and up.status == 400 else 3
    kind = terminal.get("type") if terminal is not None else None
    _out("terminal " + (_name(kind) if terminal is not None else "none"))
    response = terminal.get("response") if terminal is not None else None
    if isinstance(response, dict):
        for line in liveprobe._usage_lines(response.get("usage")):  # numbers only; a key that is an item id as its kind
            _out(line)
        details = response.get("incomplete_details")
        if kind == "response.incomplete" and isinstance(details, dict):
            _out("incomplete-reason " + (_code(details.get("reason"), sent) or "none"))
        if kind == "response.failed" and isinstance(response.get("error"), dict):
            _error_fields(response["error"], sent)
    return 0 if whole and kind in _CONTINUES else 3


# ── the probe's requests ─────────────────────────────────────────────────────────────────────────────────────────
# Every prompt is a short synthetic sentence about nothing. The developer message, the one-word prompt, the two-call
# prompt and the tool are the backend route's live probe's in other words, so the two routes' recordings compare.
DEVELOPER = "You are a terse assistant used to check a connection."
ONE_WORD = "Reply with the single word: ok"
ONE_CALL = "Call probe_echo once with the word one."
TWO_CALLS = "Call probe_echo twice in parallel: once with the word one, and once with the word two."
LONG_CALL = "Call the one tool you have once with the word one."
JSON_WORD = "Reply with a JSON object whose word is ok."
# A prompt cache engages only past a minimum prompt length (the pages give no figure; the public API's is 1,024
# tokens), so the caching steps carry one plain sentence many times over: about 2,500 tokens.
CACHE_TEXT = "This plain sentence is repeated so that the prompt is long enough to be cached. " * 160
CACHE_KEY = "ccrc-siwc-trial-cache"
TOOL_RESULT = "done"
REPLAY_EFFORT = "medium"  # steps 13 to 15: enough for the model to emit a reasoning item before its call

FUNCTION = {"type": "function", "name": "probe_echo", "description": "Echo one word back.",
            "parameters": {"type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"]},
            "strict": False}  # the bridge's own function shape (`inbound._tool`)
LONG_NAME = ("probe_echo_with_a_name_of_seventy_characters_" + "x" * 70)[:70]
# A NAMESPACE groups function tools. The preview page says only "Group function/custom tools in namespaces"; this
# is the public Responses API's namespace tool, named `functions` as spec §2.2 plans for the adapter.
NAMESPACE_NAME = "functions"


def _namespace(function: dict) -> dict:
    return {"type": "namespace", "name": NAMESPACE_NAME, "description": "The tools of the connection check.",
            "tools": [function]}


NAMESPACE = _namespace(FUNCTION)
# An `additional_tools` INPUT ITEM supplies tools inside `input`. The preview page names it and gives no shape; this
# is the Codex CLI's (its `ResponseItem::AdditionalTools`: a `developer` role and a `tools` list).
ADDITIONAL_TOOLS = {"type": "additional_tools", "role": "developer", "tools": [NAMESPACE]}
# A 1x1 PNG (70 bytes), for the tool result of step 8.
PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
SCHEMA = {"type": "json_schema", "name": "probe_reply", "strict": True,
          "schema": {"type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"],
                     "additionalProperties": False}}
INCLUDE = list(backend.INCLUDE)  # ["reasoning.encrypted_content"], as the bridge asks
DELIBERATE_FIELD = "max_output_tokens"  # step 21's one unsupported field
# A body's optional keys, in the bridge's order (`backend.build_body`): before `store`, and after it.
_BEFORE_STORE = ("tools", "tool_choice", "parallel_tool_calls", "reasoning")
_AFTER_STORE = ("include", "prompt_cache_key", "text", DELIBERATE_FIELD)


def _message(role: str, text: str) -> dict:
    kind = "output_text" if role == "assistant" else "input_text"
    return {"type": "message", "role": role, "content": [{"type": kind, "text": text}]}


def _body(model: str, items: List[dict], **fields: object) -> dict:
    """A Responses body: `model`, `stream: true`, `instructions` when given, `input`, the step's own keys, and
    `store: false`. A key is present only when the step sets it; no `system`-role item is ever built."""
    body = {"model": model, "stream": True}  # type: Dict[str, object]
    if "instructions" in fields:
        body["instructions"] = fields["instructions"]
    body["input"] = items
    for key in _BEFORE_STORE:
        if key in fields:
            body[key] = fields[key]
    body["store"] = False
    for key in _AFTER_STORE:
        if key in fields:
            body[key] = fields[key]
    return body


def _start(text: str, developer: str = DEVELOPER) -> List[dict]:
    """The developer-first input: the developer message, then the user's."""
    return [_message("developer", developer), _message("user", text)]


def _call(call_id: str, name: str, namespace: Optional[str], arguments: str) -> dict:
    """A `function_call` input item as the bridge writes one for history (`call_id`, `name`, `arguments`, no item
    id), with the `namespace` spec §2.3 plans on this route when the call has one."""
    item = {"type": "function_call", "call_id": call_id, "name": name}
    if namespace is not None:
        item["namespace"] = namespace
    item["arguments"] = arguments
    return item


def _latest(rec_dir: str, step: int) -> bytes:
    pattern = re.compile(r"siwc-%d-([0-9]{8}T[0-9]{6}Z)-([0-9]{1,3})\.sse" % step)
    try:
        found = [m for m in (pattern.fullmatch(n) for n in os.listdir(rec_dir)) if m]
        latest = max(found, key=lambda m: (m.group(1), int(m.group(2))))
        with open(os.path.join(rec_dir, latest.group(0)), "rb") as f:
            return f.read()
    except (OSError, ValueError):
        raise Refused("step-%d-first" % step, "no recording of step %d can be read in the recordings directory; run "
                      "--step %d first" % (step, step))


def replayed(rec_dir: str, step: int, reasoning: Optional[bool]) -> List[dict]:
    """The input items that replay the latest recording of `step`: each finished function call under a
    `toolu_`-shaped id (the live probe's: the same call always gets the same one), in order, then a result for each.
    `reasoning` None leaves reasoning items out; True replays each one that carries encrypted content before the call
    it preceded, as it was recorded; False the same without its id."""
    status, raw = record.split_head(_latest(rec_dir, step))
    again = "run --step %d again" % step
    if status is None or not 200 <= status < 300:
        raise Refused("step-%d-first" % step, "the latest recording of step %d is not a 2xx answer; %s" % (step, again))
    parser = sse.SseParser()
    items, results, thoughts = [], [], 0  # type: List[dict], List[dict], int
    for ev in parser.feed(raw) + parser.close():
        item = ev.data.get("item") if ev.type == "response.output_item.done" and isinstance(ev.data, dict) else None
        if not isinstance(item, dict):
            continue
        if item.get("type") == "reasoning" and reasoning is not None and isinstance(item.get("encrypted_content"), str):
            thoughts += 1
            items.append({k: v for k, v in item.items() if reasoning or k != "id"})
        elif (item.get("type") == "function_call" and isinstance(item.get("call_id"), str)
              and isinstance(item.get("name"), str)):
            call_id = liveprobe.toolu_id(item["call_id"])
            namespace = item.get("namespace") if isinstance(item.get("namespace"), str) else None
            arguments = item.get("arguments") if isinstance(item.get("arguments"), str) else "{}"
            items.append(_call(call_id, item["name"], namespace, arguments))
            results.append({"type": "function_call_output", "call_id": call_id, "output": TOOL_RESULT})
    if not results:
        raise Refused("step-%d-first" % step, "the latest recording of step %d holds no tool call; %s" % (step, again))
    if reasoning is not None and not thoughts:
        raise Refused("step-%d-first" % step, "the latest recording of step %d holds no reasoning item with "
                      "encrypted content; %s" % (step, again))
    return items + results


Request = Tuple[str, dict]  # (a label for the request line, `` for a step's only request; the body)


def _one(body: dict) -> List[Request]:
    return [("", body)]


def _step8(model: str) -> dict:
    call_id = liveprobe.toolu_id("siwc-trial-step-8")
    output = [{"type": "input_text", "text": TOOL_RESULT},
              {"type": "input_image", "image_url": "data:image/png;base64," + PNG_1X1, "detail": "auto"}]
    items = _start(ONE_CALL) + [_call(call_id, FUNCTION["name"], NAMESPACE_NAME, '{"word":"one"}'),  # type: ignore
                                {"type": "function_call_output", "call_id": call_id, "output": output}]
    return _body(model, items, tools=[NAMESPACE])


def _step13(model: str, items: List[dict]) -> dict:
    return _body(model, items, tools=[NAMESPACE], reasoning={"effort": REPLAY_EFFORT}, include=INCLUDE)


def _cached(model: str, keyed: bool) -> dict:
    items = _start(ONE_WORD, CACHE_TEXT)
    return _body(model, items, prompt_cache_key=CACHE_KEY) if keyed else _body(model, items)


class Step(NamedTuple):
    what: str  # the description printed with the step; never a prompt
    build: Callable[[str, str], List[Request]]  # (the model, the recordings directory) -> the step's requests


STEPS = {
    1: Step("a one-word reply: the developer message first, no instructions",
            lambda m, r: _one(_body(m, _start(ONE_WORD)))),
    2: Step("the same reply with top-level instructions and no developer message",
            lambda m, r: _one(_body(m, [_message("user", ONE_WORD)], instructions=DEVELOPER))),
    3: Step("one function tool in a namespace",
            lambda m, r: _one(_body(m, _start(ONE_CALL), tools=[NAMESPACE]))),
    4: Step("the same tool at the top level, which the route may refuse",
            lambda m, r: _one(_body(m, _start(ONE_CALL), tools=[FUNCTION]))),
    5: Step("a tool supplied late: an additional_tools input item after a first exchange, no top-level tools",
            lambda m, r: _one(_body(m, _start(ONE_WORD) + [_message("assistant", "ok"), ADDITIONAL_TOOLS,
                                                           _message("user", ONE_CALL)]))),
    6: Step("two parallel calls (parallel_tool_calls true)",
            lambda m, r: _one(_body(m, _start(TWO_CALLS), tools=[NAMESPACE], parallel_tool_calls=True))),
    7: Step("step 6's round trip: its calls under toolu_-shaped ids, and a result for each",
            lambda m, r: _one(_body(m, _start(TWO_CALLS) + replayed(r, 6, None), tools=[NAMESPACE],
                                    parallel_tool_calls=True))),
    8: Step("a tool result that carries a 1x1 PNG inline", lambda m, r: _one(_step8(m))),
    9: Step("tool_choice required, under a prompt that asks for no call",
            lambda m, r: _one(_body(m, _start(ONE_WORD), tools=[NAMESPACE], tool_choice="required"))),
    10: Step("tool_choice naming one function, under a prompt that asks for no call",
             lambda m, r: _one(_body(m, _start(ONE_WORD), tools=[NAMESPACE],
                                     tool_choice={"type": "function", "name": FUNCTION["name"]}))),
    11: Step("tool_choice none, under a prompt that asks for a call",
             lambda m, r: _one(_body(m, _start(ONE_CALL), tools=[NAMESPACE], tool_choice="none"))),
    12: Step("a tool whose name is 70 characters",
             lambda m, r: _one(_body(m, _start(LONG_CALL), tools=[_namespace(dict(FUNCTION, name=LONG_NAME))]))),
    13: Step("reasoning with its encrypted content included, and a tool call",
             lambda m, r: _one(_step13(m, _start(ONE_CALL)))),
    14: Step("step 13's round trip: its reasoning item replayed with its id",
             lambda m, r: _one(_step13(m, _start(ONE_CALL) + replayed(r, 13, True)))),
    15: Step("step 13's round trip: its reasoning item replayed without its id",
             lambda m, r: _one(_step13(m, _start(ONE_CALL) + replayed(r, 13, False)))),
    16: Step("two effort levels, one request each: low, then high",
             lambda m, r: [("effort " + e, _body(m, _start(ONE_WORD), reasoning={"effort": e}))
                           for e in ("low", "high")]),
    17: Step("structured output: text.format with a small JSON schema",
             lambda m, r: _one(_body(m, _start(JSON_WORD), text={"format": SCHEMA}))),
    18: Step("a long prompt under a prompt_cache_key, the first time", lambda m, r: _one(_cached(m, True))),
    19: Step("the same request under the same prompt_cache_key", lambda m, r: _one(_cached(m, True))),
    20: Step("the same request with no prompt_cache_key", lambda m, r: _one(_cached(m, False))),
    21: Step("step 1 with one unsupported field (" + DELIBERATE_FIELD + "), to record the route's refusal",
             lambda m, r: _one(_body(m, _start(ONE_WORD), **{DELIBERATE_FIELD: 16}))),
}  # type: Dict[int, Step]


def recordings_name() -> str:
    """The name a lane's recordings directory takes, which the trial's takes too. It is read from its one speller,
    `laneManifest`'s `bridgeFiles` in `deploy/models-op.mjs` (the file beside this one): the bridge reads the name
    from a lane's `lane.json`, the trial directory is no lane, and single-definition's Task 10 row allows the name
    no second quoted spelling."""
    try:
        with open(os.path.join(HERE, "models-op.mjs"), "r", encoding="utf-8") as f:
            m = re.search(r"\bbridgeFiles:\s*\{[^}]*\brecordings:\s*'([^']*)'", f.read())
    except (OSError, UnicodeError):
        m = None
    if m is None or not server.FILE_NAME_RE.fullmatch(m.group(1)):
        raise Refused("recordings-name", "the recordings directory's name could not be read from "
                      "deploy/models-op.mjs; run the helper from a whole ccrc tree")
    return m.group(1)


def send(d: str, b: Bases, rec_dir: str, token: str, step: int, label: str, body: dict, n: int) -> int:
    """One counted request: its body written beside where its recording goes, the count raised, then the POST, its
    answer recorded and reported. Returns `report`'s status, or 3 when the request or its recording failed."""
    name = "siwc-%d-%s-%d" % (step, time.strftime(record.UTC_FORMAT, time.gmtime()), n)
    raw = backend.encode_body(body)
    request = record.open_file(rec_dir, name + ".request.json")
    if request is not None:
        request.write(raw)
        request.close()
    if request is None or request.failed:
        raise Refused("request-unwritten", "the request body could not be written into the recordings directory; "
                      "nothing was counted or sent")
    write_count(d, n)  # raised before the request is sent, so a request that dies, or never leaves, still counts
    _out("request %d of %d%s" % (n, PROBE_MAX, " " + label if label else ""))
    headers = backend.build_headers(token, None, None, USER_AGENT)  # the token, `originator: ccrc`, the User-Agent
    try:
        up = backend.post(b.api, raw, headers, idle_s=PROBE_IDLE_S)
    except backend.UpstreamTimeout as e:
        _out("transport timeout-" + _name(e.phase))
        return 3
    except Exception as e:
        _out("transport " + _class(e))
        return 3
    rec = None  # type: Optional[record.Recording]
    try:
        rec = record.open_file(rec_dir, name + ".sse")
        if rec is not None:
            rec.write(record.head(up.status, up.headers))
        rc = report(up, rec, [token])
        if rec is None or rec.failed:
            _out("recording unwritten")
            return 3
        _out("recorded " + name + ".sse")
        return rc
    except Exception as e:  # the answer was sent for and may have been 2xx, so 3, not a transport line
        _out("recording " + _class(e))
        return 3
    finally:
        if rec is not None:
            rec.close()
        up.close()


def cmd_probe(d: str, b: Bases, model: str, steps: List[int]) -> int:
    take_lock(d)
    rec = read_record(d)
    require_plan(rec)
    rec_dir = os.path.join(d, recordings_name())
    for step in steps:
        _out("step %d %s" % (step, STEPS[step].what))
        rc = 0
        for label, body in STEPS[step].build(model, rec_dir):
            n = next_count(d)
            if not record.ensure_dir(rec_dir):
                raise Refused("recordings-unusable", "the recordings directory cannot be made, or is a symlink or "
                              "not a directory; nothing was counted or sent")
            rec = fresh(d, b, rec)
            require_plan(rec)
            rc = send(d, b, rec_dir, rec["access_token"], step, label, body, n)
            if rc != 0:
                break
        if rc != 0:
            if len(steps) > 1:
                _out("stopped at step %d" % step)
            return rc
    return 0


def cmd_models(d: str, b: Bases) -> int:
    take_lock(d)
    rec = read_record(d)
    require_plan(rec)
    n = next_count(d)
    rec = fresh(d, b, rec)
    require_plan(rec)
    token = rec["access_token"]
    write_count(d, n)  # raised before the request is sent
    _out("request %d of %d" % (n, PROBE_MAX))
    try:
        answer = small_request(b.api, "GET", MODELS_PATH, [
            ("Authorization", "Bearer " + token), ("originator", backend.ORIGINATOR), ("User-Agent", USER_AGENT),
            ("Accept", "application/json")])
    except Exception as e:
        _out("transport " + _class(e))
        return 3
    _out("status %d" % answer.status)
    for name in answer.names:
        _out("header " + _name(name))
    if answer.status != 200:
        _error_body(answer.body, [token])
        return 3
    try:
        models = json.loads(answer.body.decode("utf-8")).get("models")
    except (ValueError, UnicodeError, RecursionError, AttributeError):
        models = None
    if not isinstance(models, list):
        _out("models unrecognised")
        return 3
    for model in models:  # a slug and a visibility are names; a display name is not printed
        if isinstance(model, dict):
            _out("model %s %s" % (_name(model.get("slug")), _name(model.get("visibility"))))
    return 0


# ── signout ──────────────────────────────────────────────────────────────────────────────────────────────────────
_KEPT = "the record is kept: run signout again, or remove " + CREDENTIAL_FILE + " by hand and disconnect the app " \
        "in ChatGPT Settings"
_UNCONFIRMED = "the refresh token was not revoked at the authorization server; disconnect the app in ChatGPT " \
               "Settings to end its access"


def revoke(b: Bases, rec: dict) -> Tuple[Optional[str], bool]:
    """Revoke the record's refresh token at the discovery document's `revocation_endpoint` (the accounts page: a
    form POST of `token`, `token_type_hint=refresh_token` and the issued `client_id`; an empty 200 is success).
    Returns (None when revoked, else why not; whether the record is still deleted). The endpoint must be on the
    authorization server's own origin: the token is sent nowhere else."""
    refresh = rec.get("refresh_token")
    if not refresh:
        return "no-refresh-token", True
    try:
        endpoint = discovery(b).get("revocation_endpoint")
    except Unreachable:
        return "discovery-failed", False
    if not (isinstance(endpoint, str) and endpoint):
        return "none-published", True
    try:
        at, home = urllib.parse.urlsplit(endpoint), urllib.parse.urlsplit(b.auth)
        same = ((at.scheme, at.netloc) == (home.scheme, home.netloc) and at.path.startswith("/")
                and not at.query and not at.fragment)
    except ValueError:
        same = False
    if not same:
        return "endpoint-elsewhere", True
    try:
        answer = post_form(b.auth, at.path, [("token", refresh), ("token_type_hint", "refresh_token"),
                                             ("client_id", rec["client_id"])])
    except Exception:
        return "transport", False
    if answer.status != 200:
        return "status-%d" % answer.status, False
    return None, True


def cmd_signout(d: str, b: Bases) -> int:
    take_lock(d)
    rec = read_record(d)
    why, delete = revoke(b, rec)
    _out("revocation " + ("confirmed" if why is None else "unconfirmed " + why))
    if not delete:
        _out("credential kept")
        _err(_KEPT)
        return 3
    os.unlink(os.path.join(d, CREDENTIAL_FILE))
    _sync_dir(d)
    _out("credential deleted")
    if why is not None:
        _err(_UNCONFIRMED)
        return 3
    return 0


# ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
USAGE = ("usage: siwc-trial.py signin [--dir <dir>] [--no-browser] [--wait <1-%d>] | status [--dir <dir>] | models "
         "[--dir <dir>] | probe [--dir <dir>] --model <slug> (--step <1-%d> | --all) | signout [--dir <dir>]"
         % (WAIT_MAX_S, max(STEPS)))
_OPTIONS = {"signin": {"--dir": True, "--no-browser": False, "--wait": True}, "status": {"--dir": True},
            "models": {"--dir": True}, "probe": {"--dir": True, "--model": True, "--step": True, "--all": False},
            "signout": {"--dir": True}}  # each verb's options, and whether one takes a value


def parse(argv: List[str]) -> Optional[Tuple[str, Dict[str, str]]]:
    """(the verb, its options), or None for a usage error. A flag's value is ``; no option is given twice."""
    if not argv or argv[0] not in _OPTIONS:
        return None
    known, got = _OPTIONS[argv[0]], {}  # type: Dict[str, bool], Dict[str, str]
    i = 1
    while i < len(argv):
        name = argv[i]
        if name not in known or name in got or (known[name] and i + 1 >= len(argv)):
            return None
        got[name] = argv[i + 1] if known[name] else ""
        i += 2 if known[name] else 1
    number = lambda v: int(v) if v.isascii() and v.isdigit() and len(v) <= 3 else 0  # noqa: E731
    if "--dir" in got and not got["--dir"]:
        return None
    if "--wait" in got and not 1 <= number(got["--wait"]) <= WAIT_MAX_S:
        return None
    if argv[0] == "probe":
        if not _MODEL_RE.fullmatch(got.get("--model", "")) or ("--step" in got) == ("--all" in got):
            return None
        if "--step" in got and number(got["--step"]) not in STEPS:
            return None
    return argv[0], got


def main(argv: List[str]) -> int:
    parsed = parse(argv)
    if parsed is None:
        _err(USAGE)
        return 2
    verb, got = parsed
    try:
        if os.environ.get(SESSION_ENV):
            raise Refused("in-session", "this helper is the operator's, run by hand from their own shell, never by "
                          "a session (spec D10: the token never passes through an agent)")
        b = bases(dict(os.environ))  # before anything is read or sent
        d = got.get("--dir") or default_dir()
        if verb == "signin":
            return cmd_signin(d, b, "--no-browser" in got, int(got.get("--wait", WAIT_S)))
        if verb == "status":
            facts(read_record(d))
            return 0
        if verb == "models":
            return cmd_models(d, b)
        if verb == "probe":
            return cmd_probe(d, b, got["--model"], sorted(STEPS) if "--all" in got else [int(got["--step"])])
        return cmd_signout(d, b)
    except Refused as r:
        _err("refused " + r.word + ": " + r.sentence)
        return 1
    except KeyboardInterrupt:
        _err("interrupted")
        return 1
    except Exception as e:  # its class only: an exception's text can carry a value
        _err("failed " + _class(e))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
