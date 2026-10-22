#!/usr/bin/env python3
"""ccgpt-auth — the one library that reads and writes a Codex lane's ChatGPT credential.

THE RULE THIS FILE HOLDS (codex-bridge spec 2026-10-15 §2.6, amending the GPT-lane ownership spec §9): exactly one
ccrc library, this file, reads and writes a Codex lane's credential; history's redaction reads the credential files as
secret sources and never writes them. Every other ccrc program goes through this library: a Python caller loads it
by file path (under `-I` a sibling module is not on `sys.path`), a bash or node caller runs it as a command line.

The credential is `auth.json` in the lane's authDir, in LiteLLM's backend format (`access_token`, `refresh_token`,
`id_token`, `expires_at`, `account_id`), kept while any LiteLLM tier exists. Beside it the library keeps three files
of its own, all mode 0600, named once below and spelled nowhere else in shipped code (bash and node ask the CLI):
- `auth.pending.json`, the checkpoint: the next credential, written and fsynced before the rename that commits it;
- `auth.json.lock`, the lock: `flock(2)` on this file, never on the credential, whose inode a rename replaces;
- `auth.status.json`, the non-secret status: state, expiry, last refresh, last error code, last request id.

A dead credential is a state, `needs-signin`, never retried and never answered with a sign-in flow inside a request.

Standard library only, never LiteLLM, and Python 3.9 syntax (Apple's `python3` can be 3.9): no `match`, no
parenthesised context managers, no PEP 604 union evaluated at runtime (`typing.Optional` instead).

NOTHING BINDS A CONSTANT EARLY. Every bound argument defaults to `None` and resolves to its module constant when the
function is called, and `config_hash()` reads the current constants, so a caller (or a test) that sets a constant on
the module changes what the next call does.
"""

import base64
import contextlib
import errno
import fcntl
import hashlib
import http.client
import json
import math
import os
import re
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterator, List, NamedTuple, Optional, TextIO, Tuple

# ── the files ────────────────────────────────────────────────────────────────────────────────────────────────────
CREDENTIAL_NAME = "auth.json"
PENDING_NAME = "auth.pending.json"
LOCK_NAME = "auth.json.lock"
STATUS_NAME = "auth.status.json"

# ── families ─────────────────────────────────────────────────────────────────────────────────────────────────────
# A write to a backend handle refuses any family other than None (unclaimed) and FAMILY_BACKEND.
FAMILY_BACKEND = "chatgpt-backend"
FAMILY_CODEX_CLI = "codex-cli"
FAMILY_UNKNOWN = "unknown"
# The top-level keys that make an object LiteLLM's backend record (its `_build_auth_record` and its device marker).
BACKEND_KEYS = ("access_token", "refresh_token", "id_token", "device_code_requested_at")

# ── states (the status file's `state`) ───────────────────────────────────────────────────────────────────────────
# Stage 1 produces ok, needs-signin and config-error; the other three are the bridge's and are only accepted.
STATES = ("ok", "needs-signin", "limit-paused", "ineligible", "plan-disabled", "config-error")

# ── the readings ─────────────────────────────────────────────────────────────────────────────────────────────────
CREDENTIAL_WORDS = ("present", "absent", "unreadable", "foreign-family", "incomplete")
EXPIRY_SKEW_S = 60  # LiteLLM's TOKEN_EXPIRY_SKEW_SECONDS
READ_RETRIES = 3  # a JSON parse failure is re-read this many times ...
READ_RETRY_S = 0.05  # ... this far apart, then answers unreadable

# ── the lock and the commit ──────────────────────────────────────────────────────────────────────────────────────
LOCK_POLL_S = 0.05  # held() polls a non-blocking flock this often ...
LOCK_WAIT_S = 60.0  # ... until this bound, then raises LockTimeout
FILE_MODE = 0o600  # every file the library makes, set by fchmod after creation (umask-proof)
DIR_MODE = 0o700  # every authDir level held() makes, set by chmod after mkdir

# ── the endpoints (LiteLLM 1.105.0 `litellm/llms/chatgpt/common_utils.py`) ──────────────────────────────────────
AUTH_BASE = "https://auth.openai.com"
TOKEN_PATH = "/oauth/token"
DEVICE_CODE_PATH = "/api/accounts/deviceauth/usercode"
DEVICE_TOKEN_PATH = "/api/accounts/deviceauth/token"
DEVICE_VERIFY_PATH = "/codex/device"
# The Codex CLI's public OAuth client id, copied from LiteLLM 1.105.0's CHATGPT_CLIENT_ID (common_utils.py:21).
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
# The JWT claim that carries the ChatGPT account id (LiteLLM's OPENAI_AUTH_CLAIM_KEY).
ACCOUNT_CLAIM = "https://api.openai.com/auth"
ACCOUNT_ID_KEY = "chatgpt_account_id"

# The test override of AUTH_BASE. Accepted ONLY for a loopback http:// URL: the poller's `_LOOPBACK_HOSTS` rule
# (ccd/ccgpt-usage.py), a hostname equality after a parse, never a substring test over the raw text.
AUTH_BASE_ENV = "CCRC_CODEX_AUTH_BASE"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# ── the refresh and its error codes ──────────────────────────────────────────────────────────────────────────────
# A refusal of the refresh is classified as Codex classifies it (upstream openai/codex @ 092d3ac,
# codex-rs/login/src/auth/manager.rs:1655-1691): permanent on any 401, on invalid_grant with a 400, and on the other
# codes below at any status; invalid_client is a configuration error (spec §2.6); every other rejection is transient.
NEEDS_SIGNIN_CODES = frozenset({"invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
                                "refresh_token_invalidated", "refresh_token_reused"})
CONFIG_ERROR_CODES = frozenset({"invalid_client"})
TOKEN_TIMEOUT_S = 30.0  # the one network call of a refresh
REFRESH_SCOPE = "openid profile email"  # LiteLLM's refresh request (authenticator.py:304-312)
ANSWER_MAX_BYTES = 1 << 20  # a token answer, or a refusal's body, is read no further than this
# What `classify_error` reads is stored only when it matches CODE_RE (else UNRECOGNISED_CODE), and a request id only
# when it matches REQUEST_ID_RE (else nothing): neither field may carry a token, a JWT segment or an account id.
CODE_RE = re.compile(r"^[a-z0-9_.-]{1,64}$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
UNRECOGNISED_CODE = "unrecognised"
KIND_NEEDS_SIGNIN = "needs-signin"
KIND_CONFIG_ERROR = "config-error"
KIND_TRANSIENT = "transient"

# ── the device-code sign-in (LiteLLM 1.105.0's protocol, `litellm/llms/chatgpt/authenticator.py:153-299`) ──────────
DEVICE_TIMEOUT_S = 900  # LiteLLM's DEVICE_CODE_TIMEOUT_SECONDS: the device code's own 15 minutes
# LiteLLM's DEVICE_CODE_POLL_SLEEP_SECONDS: the poll waits max(interval, this), and this when no interval is given.
DEVICE_POLL_MIN_S = 5
# The exchange's redirect_uri, on AUTH_BASE as LiteLLM sends it: a value the endpoint compares, never a URL fetched.
DEVICE_CALLBACK_PATH = "/deviceauth/callback"
SIGNIN_COMMIT_TRIES = 3  # a sign-in's commit is tried this many times ...
SIGNIN_COMMIT_RETRY_S = 0.5  # ... this far apart, then the sign-in fails and nothing is saved
# The sentence `already-signed-in` carries: in litellm mode a sign-in never refreshes (ruling 1), so a present
# credential whose refresh token is dead is learnt of only by the lane's next request.
ALREADY_SIGNED_IN = ("the lane's credential is present; if the lane's refresh token is dead, the lane's next request "
                     "records needs-signin; run this again then")

# ── the status file ──────────────────────────────────────────────────────────────────────────────────────────────
STATUS_VERSION = 1
STATUS_MAX_BYTES = 65536  # a status file is read no further than this
STATUS_TMP_SUFFIX = ".tmp"  # the status is written beside itself, then renamed over itself


# ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────
class AuthError(Exception):
    """A refusal. `.word` is the refusal word; `str()` is a sentence naming the remedy and no secret."""

    word = "auth-error"

    def __init__(self, sentence: str, code: Optional[str] = None, request_id: Optional[str] = None) -> None:
        super().__init__(sentence)
        self.code = code
        self.request_id = request_id


class NotSignedIn(AuthError):
    word = "not-logged-in"


class NeedsSignin(AuthError):
    word = "needs-signin"


class ConfigError(AuthError):
    word = "config-error"


class ForeignFamily(AuthError):
    word = "foreign-family"


class Unreadable(AuthError):
    word = "credential-unusable"


class RefreshFailed(AuthError):
    """Transient: a network failure, a timeout, a redirect, or a rejection classified transient."""

    word = "refresh-failed"


class LockTimeout(AuthError):
    word = "auth-lock-busy"


class EndpointRefused(AuthError):
    """A non-loopback CCRC_CODEX_AUTH_BASE."""

    word = "auth-endpoint-refused"


class LoginFailed(AuthError):
    word = "login-failed"


class HeldReentry(RuntimeError):
    """A programming error, NOT an AuthError: entering the lock for a path this thread already holds."""


# ── the endpoint ─────────────────────────────────────────────────────────────────────────────────────────────────
def auth_base_source() -> str:
    """`"override"` when CCRC_CODEX_AUTH_BASE is set and not empty, else `"default"`."""
    return "override" if os.environ.get(AUTH_BASE_ENV) else "default"


def auth_base() -> str:
    """The base URL every token, device-code and exchange request goes to.

    AUTH_BASE, unless CCRC_CODEX_AUTH_BASE names an override, which must be an `http://` URL whose parsed hostname
    is a loopback host, with no user information; anything else raises EndpointRefused. The refusal never echoes
    the URL, which could carry user information."""
    value = os.environ.get(AUTH_BASE_ENV)
    if not value:
        return AUTH_BASE
    refusal = EndpointRefused(
        AUTH_BASE_ENV + " must be an http:// URL on a loopback host (127.0.0.1, localhost or ::1); "
        "unset it to use the default endpoint"
    )
    try:
        parts = urllib.parse.urlsplit(value)
        host = parts.hostname
        parts.port  # raises ValueError for a port that is not a number in range
    except ValueError:
        raise refusal
    if parts.scheme != "http" or host not in LOOPBACK_HOSTS or parts.username is not None or parts.password is not None:
        raise refusal
    return value.rstrip("/")


def config_hash() -> str:
    """sha256 hex of the library's own CLIENT_ID, AUTH_BASE and TOKEN_PATH, read at each call (never the override)."""
    text = CLIENT_ID + "\n" + AUTH_BASE + "\n" + TOKEN_PATH
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── paths ────────────────────────────────────────────────────────────────────────────────────────────────────────
class Paths(NamedTuple):
    credential: str
    pending: str
    lock: str
    status: str


def paths_for(auth_dir: str) -> Paths:
    """The credential and its three side files. `auth_dir` must be absolute: a relative one would resolve against
    whatever directory the caller happens to run in."""
    if not isinstance(auth_dir, str) or not os.path.isabs(auth_dir):
        raise ValueError("ccgpt-auth: an authDir must be an absolute path")
    d = os.path.normpath(auth_dir)
    return Paths(
        credential=os.path.join(d, CREDENTIAL_NAME),
        pending=os.path.join(d, PENDING_NAME),
        lock=os.path.join(d, LOCK_NAME),
        status=os.path.join(d, STATUS_NAME),
    )


# ── families and claims ──────────────────────────────────────────────────────────────────────────────────────────
def family_of(obj: object) -> Optional[str]:
    """The family a parsed credential file belongs to, by the contract's five arms in order:
    1. `{}` -> None (unclaimed, writable);
    2. a string `family` key -> that value;
    3. a `tokens` key: an object -> "codex-cli" (the Codex CLI's own auth.json); anything else -> "unknown";
    4. any of BACKEND_KEYS at the top level -> "chatgpt-backend";
    5. anything else (an object with none of those keys, a non-object JSON value) -> "unknown"."""
    if not isinstance(obj, dict):
        return FAMILY_UNKNOWN
    if not obj:
        return None
    family = obj.get("family")
    if isinstance(family, str):
        return family
    if "tokens" in obj:
        return FAMILY_CODEX_CLI if isinstance(obj["tokens"], dict) else FAMILY_UNKNOWN
    if any(k in obj for k in BACKEND_KEYS):
        return FAMILY_BACKEND
    return FAMILY_UNKNOWN


def claims_of(jwt: str) -> dict:
    """A JWT's payload claims, decoded WITHOUT a signature check (spec §2.6: an ID token received directly from the
    token endpoint is trusted through TLS). `{}` on anything undecodable, a payload nested past the parser's recursion
    limit included."""
    if not isinstance(jwt, str):
        return {}
    parts = jwt.split(".")
    if len(parts) < 2:
        return {}
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
    except (ValueError, UnicodeError, TypeError, RecursionError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _finite_number(value: object) -> bool:
    """A JSON number usable as an epoch: not a bool, and finite (Python's `json.loads` accepts NaN and Infinity, and
    a NaN expiry compares false both ways, so it would read as never expired). Total: a JSON integer too large for a
    float makes `math.isfinite` raise OverflowError, and that answers False too."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _exp_of(token: Optional[str]) -> Optional[int]:
    exp = claims_of(token).get("exp") if isinstance(token, str) else None
    if _finite_number(exp):
        return int(exp)
    return None


def _account_id_of(token: Optional[str]) -> Optional[str]:
    auth = claims_of(token).get(ACCOUNT_CLAIM) if isinstance(token, str) else None
    if isinstance(auth, dict):
        account_id = auth.get(ACCOUNT_ID_KEY)
        if isinstance(account_id, str) and account_id:
            return account_id
    return None


def _nonempty_str(value: object) -> Optional[str]:
    return value if isinstance(value, str) and value else None


# ── readings ─────────────────────────────────────────────────────────────────────────────────────────────────────
Identity = Tuple[int, int, int]  # (st_ino, st_mtime_ns, st_size) of the file read


class Reading(NamedTuple):
    credential: str  # one of CREDENTIAL_WORDS
    access_token: Optional[str]
    refresh_token: Optional[str]
    account_id: Optional[str]
    expires_at: Optional[float]
    family: Optional[str]
    identity: Optional[Identity]
    detail: str  # a sentence, never a token


# The unsaved records: authDir -> (record, identity of the file the record was to replace, measured under the lock,
# the ok-status fields of the refresh that produced it or None). `read` answers from one while the file's identity
# still equals its identity, and otherwise ignores it, leaving the map unchanged and printing nothing. Three writers
# change the map, each under the lock: `commit_record` and `retry_unsaved`, and `ensure_fresh`, which drops a record
# whose own refresh token the endpoint refused as needs-signin (one stderr line, no token). The status fields
# (`lastRefreshAt`, `lastRequestId`) are kept with the record, not read back from the status file, because that file
# was measured on the file the record replaces and its own write may have failed with the commit's.
_UNSAVED: Dict[str, Tuple[dict, Optional[Identity], Optional[dict]]] = {}


def _identity(st: os.stat_result) -> Identity:
    return (st.st_ino, st.st_mtime_ns, st.st_size)


def _empty(word: str, detail: str, identity: Optional[Identity] = None, family: Optional[str] = None) -> Reading:
    return Reading(word, None, None, None, None, family, identity, detail)


def _reading_of(obj: object, identity: Optional[Identity], where: str) -> Reading:
    """Classify one parsed credential object. Derived fields are derived IN MEMORY and never written back."""
    family = family_of(obj)
    if isinstance(obj, dict) and not obj:
        return _empty("absent", "the credential file at " + where + " is an empty object; sign the lane in", identity)
    if family != FAMILY_BACKEND:
        return _empty(
            "foreign-family",
            "the file at " + where + " belongs to the " + json.dumps(family) + " family, not " + FAMILY_BACKEND
            + "; ccrc never writes over it; move it aside to sign the lane in",
            identity,
            family,
        )
    assert isinstance(obj, dict)
    # An empty string counts as no token: a token of no characters can never authenticate a request.
    access = _nonempty_str(obj.get("access_token"))
    refresh = _nonempty_str(obj.get("refresh_token"))
    if access is None or refresh is None:
        return _empty(
            "incomplete",
            "the credential at " + where + " has no access token or no refresh token (an unfinished sign-in "
            "leaves this); sign the lane in",
            identity,
            family,
        )
    stored = obj.get("expires_at")
    if _finite_number(stored):
        expires_at = stored  # type: Optional[float]
    else:
        expires_at = _exp_of(access)
    account_id = _nonempty_str(obj.get("account_id"))
    if account_id is None:
        account_id = _account_id_of(_nonempty_str(obj.get("id_token"))) or _account_id_of(access)
    return Reading("present", access, refresh, account_id, expires_at, family, identity,
                   "the credential at " + where + " is present")


# What `_current_identity` answers for a path it cannot measure as a regular file: a path that cannot be stat'ed for
# any reason but ENOENT, or a non-regular file. It equals no identity and not `None`, so an unsaved record bound to
# an ABSENT file (identity None) is never served over a FIFO, a symlink or an unreadable path.
_UNMEASURED = object()


def _current_identity(path: str) -> object:
    """The identity of the regular file at `path` (an `Identity`); `None` ONLY when nothing is there (ENOENT);
    `_UNMEASURED` (a bare `object()` sentinel, hence the `object` return type) otherwise."""
    try:
        st = os.lstat(path)
    except OSError as e:
        return None if e.errno == errno.ENOENT else _UNMEASURED
    return _identity(st) if stat.S_ISREG(st.st_mode) else _UNMEASURED


def _remedy(e: OSError, auth_dir: str, opened: bool) -> str:
    """The remedy for an `OSError` the read met, chosen by its errno and by whether `lstat` had already succeeded
    (`opened`): a symlink the open refused (ELOOP on the open), a file whose own mode refuses the open (EACCES or
    EPERM on the open), a path on the way that is not a directory or loops (ENOTDIR, or ELOOP from `lstat`), or a
    directory on the way that cannot be searched (anything else, an `lstat` EACCES included)."""
    if opened and e.errno == errno.ELOOP:
        return "the path is a symlink; move it aside and sign the lane in"
    if opened and e.errno in (errno.EACCES, errno.EPERM):
        return "fix its mode with chmod 600"
    if e.errno in (errno.ENOTDIR, errno.ELOOP):
        return auth_dir + " or a directory above it is not a directory, or is a symlink loop; fix the lane's authDir"
    return "check the permissions of " + auth_dir + " and the directories above it"


# The remedy for an `OSError` from the `fstat` or a `read` of a file that already opened as a regular file: its path
# and its mode are already proven, so only a retry or a fresh sign-in can help.
READ_FAILED_REMEDY = (
    "the file opened but could not be read; retry, and if it persists move it aside and sign the lane in"
)


def _key(auth_dir: str) -> str:
    """The unsaved map's key for an authDir: the normalised path `paths_for` builds every file from."""
    return os.path.normpath(auth_dir)


def read(auth_dir: str) -> Reading:
    """Read the lane's credential. Never writes, never locks, never touches the network.

    Answers the unsaved record first while its identity still matches the file. A non-regular file at the path, a
    symlink included, is `unreadable` by `lstat`, without being opened. The open is `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`,
    so a file swapped in between the two never blocks the read: a symlink fails the open (ELOOP), and a FIFO opens at
    once and is refused by the `fstat` that follows. A JSON parse failure (a file LiteLLM is rewriting in place) is
    re-read up to READ_RETRIES times, READ_RETRY_S apart, and then answers `unreadable`, never `absent`. Any
    `OSError` other than ENOENT is `unreadable`: from `lstat` or the open, its remedy chosen by errno; from the
    `fstat` or a `read` after the open, READ_FAILED_REMEDY. A file nested past the parser's recursion limit is
    `unreadable` at once, with no re-read."""
    return _read_raw(auth_dir)[0]


def _read_raw(auth_dir: str) -> Tuple[Reading, object]:
    """`read`, with the object it classified: the unsaved record, the file's parsed JSON, or None when nothing parsed.
    The refresher merges a token answer over that object (it keeps the stored `id_token`, which a Reading does not
    carry)."""
    p = paths_for(auth_dir)
    where = p.credential
    unsaved = _UNSAVED.get(_key(auth_dir))
    if unsaved is not None:
        record, bound, _ = unsaved
        if _current_identity(where) == bound:
            r = _reading_of(record, bound, where)
            return r._replace(detail="an unsaved credential for " + where + " is held in memory; the next refresh "
                              "writes it"), record
    return _read_file_raw(auth_dir)


def _read_file(auth_dir: str) -> Reading:
    """`read` without the unsaved record: what the file itself holds. The writers re-read through this under the lock,
    because what they may overwrite is the file, never the record in memory."""
    return _read_file_raw(auth_dir)[0]


def _read_file_raw(auth_dir: str) -> Tuple[Reading, object]:
    """`_read_file`, with the parsed object it classified (None when nothing parsed)."""
    parsed = _parse_file(auth_dir)
    if isinstance(parsed, Reading):
        return parsed, None
    obj, identity = parsed
    return _reading_of(obj, identity, paths_for(auth_dir).credential), obj


def _parse_file(auth_dir: str) -> object:
    """The file's parsed JSON and its identity, as a pair; or the `unreadable`/`absent` Reading that answers instead.
    (`object`: a Reading or a pair, which Python 3.9's typing spells only as a Union.)"""
    p = paths_for(auth_dir)
    where = p.credential
    retries = READ_RETRIES
    retry_s = READ_RETRY_S
    attempt = 0
    while True:
        try:
            st = os.lstat(where)
        except OSError as e:
            if e.errno == errno.ENOENT:
                return _empty("absent", "no credential at " + where + "; sign the lane in")
            return _empty("unreadable", "the credential at " + where + " cannot be read (" + errno.errorcode.get(
                e.errno or 0, "error") + "); " + _remedy(e, auth_dir, opened=False))
        if not stat.S_ISREG(st.st_mode):
            return _empty("unreadable", "the credential path " + where + " is not a regular file; move it aside "
                          "and sign the lane in", _identity(st))
        try:
            fd = os.open(where, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
                         | getattr(os, "O_CLOEXEC", 0))
        except OSError as e:
            if e.errno == errno.ENOENT:
                return _empty("absent", "no credential at " + where + "; sign the lane in")
            return _empty("unreadable", "the credential at " + where + " cannot be opened (" + errno.errorcode.get(
                e.errno or 0, "error") + "); " + _remedy(e, auth_dir, opened=True), _identity(st))
        identity = None  # type: Optional[Identity]
        try:
            fst = os.fstat(fd)
            if not stat.S_ISREG(fst.st_mode):
                return _empty("unreadable", "the credential path " + where + " was replaced by a non-regular file "
                              "while it was read; move it aside and sign the lane in", _identity(fst))
            identity = _identity(fst)
            chunks = []
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
        except OSError as e:  # the open succeeded, so no path or permission remedy applies (EIO, ESTALE)
            return _empty("unreadable", "the credential at " + where + " cannot be read (" + errno.errorcode.get(
                e.errno or 0, "error") + "); " + READ_FAILED_REMEDY, identity)
        finally:
            os.close(fd)
        try:
            obj = json.loads(b"".join(chunks).decode("utf-8"))
        except RecursionError:  # nested past the parser's limit: no re-read can heal it
            return _empty("unreadable", "the credential at " + where + " is nested too deeply to parse; move it "
                          "aside and sign the lane in", identity)
        except ValueError:  # JSONDecodeError and UnicodeDecodeError alike
            if attempt < retries:
                attempt += 1
                time.sleep(retry_s)
                continue
            return _empty("unreadable", "the credential at " + where + " is not valid JSON after "
                          + str(retries) + " re-reads; if a tier is rewriting it, retry; otherwise sign the lane in",
                          identity)
        return obj, identity


def expired(r: Reading, within_s: Optional[float] = None, now: Optional[float] = None) -> bool:
    """True when the reading's access token expires within `within_s` (EXPIRY_SKEW_S, read when called, by default).

    `r.expires_at` is already the file's number or the one derived from the access token's `exp`, so a null means
    neither exists, and that is expired: LiteLLM's rule (`authenticator.py:113-122`)."""
    skew = EXPIRY_SKEW_S if within_s is None else within_s
    t = time.time() if now is None else now
    if r.expires_at is None:
        return True
    return t >= float(r.expires_at) - float(skew)


# ── the lock ─────────────────────────────────────────────────────────────────────────────────────────────────────
# The lock paths this thread holds. It is a RE-ENTRY GUARD, never the exclusion: exclusion is flock(2) alone, on a
# file each held() opens afresh, so two threads of one process are two open file descriptions and exclude each other
# exactly as two processes do. Without the guard a nested held() in one thread would wait out LOCK_WAIT_S on itself.
_HELD = threading.local()


def _held_here() -> set:
    paths = getattr(_HELD, "paths", None)
    if paths is None:
        paths = set()
        _HELD.paths = paths
    return paths


def _errno_word(e: OSError) -> str:
    return errno.errorcode.get(e.errno or 0, "error")


def _make_auth_dir(auth_dir: str) -> None:
    """Create a missing authDir, each missing level by `os.mkdir` and then `os.chmod(DIR_MODE)`, so a umask that
    removes owner bits changes nothing. An existing level keeps its mode (an adopted authDir keeps its own, the A4
    rule), and so does one another process makes first."""
    d = os.path.normpath(auth_dir)
    missing = []
    cur = d
    while not os.path.lexists(cur):
        missing.append(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    try:
        for level in reversed(missing):
            try:
                os.mkdir(level, DIR_MODE)
            except FileExistsError:
                continue
            os.chmod(level, DIR_MODE)
    except OSError as e:
        raise Unreadable("the authDir " + d + " cannot be created (" + _errno_word(e) + "); check the permissions of "
                         "the directories above it")


def _open_lock(path: str) -> int:
    """Open (creating) the lock file: `O_RDWR|O_CREAT|O_NOFOLLOW`, plus `O_NONBLOCK` (a FIFO at the lock path opens
    at once and is refused by the `fstat`, where POSIX leaves a blocking `O_RDWR` open of a FIFO undefined) and
    `O_CLOEXEC` (a child exec'd under `held` never inherits the descriptor, so the flock never outlives this
    process), then `fchmod(FILE_MODE)`. A symlink (ELOOP), a non-regular file, or a lock this process may not open
    (EACCES) is `Unreadable`, and nothing at the path is changed. The EACCES remedy names `chmod 600` for an existing
    lock, and the authDir's permissions for a lock the open could not create."""
    flags = (os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0))
    try:
        fd = os.open(path, flags, FILE_MODE)
    except OSError as e:
        if e.errno == errno.ELOOP:
            raise Unreadable("the credential lock " + path + " is a symlink (ELOOP); ccrc never follows it; remove "
                             "it and retry")
        if e.errno in (errno.EACCES, errno.EPERM):
            if os.path.lexists(path):
                raise Unreadable("the credential lock " + path + " cannot be opened (" + _errno_word(e) + "); fix "
                                 "its mode with chmod 600 " + path)
            raise Unreadable("the credential lock " + path + " cannot be created (" + _errno_word(e) + "); check "
                             "the permissions of " + os.path.dirname(path))
        raise Unreadable("the credential lock " + path + " cannot be opened (" + _errno_word(e) + "); check the "
                         "permissions of " + os.path.dirname(path))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Unreadable("the credential lock path " + path + " is not a regular file; remove it and retry")
        os.fchmod(fd, FILE_MODE)
    except OSError as e:
        os.close(fd)
        raise Unreadable("the credential lock " + path + " cannot be set to mode 600 (" + _errno_word(e) + "); fix "
                         "its owner and mode with chmod 600 " + path)
    except BaseException:
        os.close(fd)
        raise
    return fd


@contextlib.contextmanager
def held(auth_dir: str, wait_s: Optional[float] = None) -> Iterator[Paths]:
    """Hold the lane's credential lock: `flock(2)` on `auth.json.lock`, never on the credential, whose inode every
    commit replaces. Yields the lane's `Paths`.

    A missing authDir is created first, before the lock is opened (`_make_auth_dir`). The lock is polled with a
    non-blocking flock every LOCK_POLL_S until `wait_s` (LOCK_WAIT_S, read when called, by default); past it,
    LockTimeout. Entering held() for a path this thread already holds raises HeldReentry AT ONCE. The kernel releases
    the lock when the descriptor closes, on exit or on process death, so a crash never leaves a stale lock."""
    p = paths_for(auth_dir)
    mine = _held_here()
    if p.lock in mine:
        raise HeldReentry("ccgpt-auth: this thread already holds the credential lock " + p.lock + "; a nested "
                          "held() would wait on itself")
    wait = LOCK_WAIT_S if wait_s is None else wait_s
    poll = LOCK_POLL_S
    _make_auth_dir(auth_dir)
    fd = _open_lock(p.lock)
    try:
        deadline = time.monotonic() + float(wait)
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as e:
                if e.errno not in (errno.EWOULDBLOCK, errno.EAGAIN, errno.EACCES):
                    raise Unreadable("the credential lock " + p.lock + " cannot be taken (" + _errno_word(e) + ")")
            left = deadline - time.monotonic()
            if left <= 0:
                raise LockTimeout("the credential lock " + p.lock + " is still held after " + str(wait) + " s: "
                                  "another ccrc process is refreshing or signing in this lane; retry")
            time.sleep(min(float(poll), left))
        mine.add(p.lock)
        try:
            yield p
        finally:
            mine.discard(p.lock)
    finally:
        os.close(fd)


# ── the commit ───────────────────────────────────────────────────────────────────────────────────────────────────
def _refuse_unwritable(r: Reading) -> None:
    """A write never goes over a file that reads `unreadable` (it may be a tier's half-written rewrite, or a file
    whose mode refuses ccrc) nor over another family's file; both are left exactly as they are."""
    if r.credential == "unreadable":
        raise Unreadable("ccrc will not write over it: " + r.detail)
    if r.family is not None and r.family != FAMILY_BACKEND:
        raise ForeignFamily(r.detail)


def _unlink_absent_ok(path: str) -> None:
    """Unlink `path` (a symlink is unlinked itself, never followed); a missing file is fine."""
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        n = os.write(fd, view)
        view = view[n:]


def _fsync_dir(d: str) -> None:
    fd = os.open(d, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def commit_record(auth_dir: str, record: dict, refreshed: Optional[dict] = None) -> bool:
    """Write `record` as the lane's credential. The caller holds `held(auth_dir)`; this creates no directory.

    Re-reads the file under the lock and refuses, with the file untouched, one that reads `unreadable` (Unreadable)
    or belongs to another family (ForeignFamily). Then the checkpoint: any old one is unlinked (a symlink there is
    unlinked, never followed), `auth.pending.json` is opened `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, set to FILE_MODE
    by fchmod, written and fsynced; then it is renamed over the credential and the directory fsynced.

    True when the record is on disk. On an OSError anywhere in that sequence (a full disk) the record is kept in
    memory as this process's unsaved record, bound to the identity of the file it was to replace (measured under the
    lock), a partial checkpoint is unlinked, and the answer is False: `read` serves the record while that file is
    unchanged, and `retry_unsaved` writes it at the next holder. A failure AFTER the rename (the directory fsync)
    binds the record to the file now in place, which already holds it, so the retry re-runs the commit, fsync
    included, rather than dropping it. `refreshed` (the refresher's `lastRefreshAt` and `lastRequestId`) is kept with
    an unsaved record, so the status `retry_unsaved` writes for it carries this refresh's fields."""
    p = paths_for(auth_dir)
    key = _key(auth_dir)
    current = _read_file(auth_dir)
    _refuse_unwritable(current)
    identity = current.identity
    data = json.dumps(record).encode("utf-8")
    replaced = False
    try:
        _unlink_absent_ok(p.pending)
        fd = os.open(p.pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                     FILE_MODE)
        try:
            os.fchmod(fd, FILE_MODE)
            _write_all(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(p.pending, p.credential)
        replaced = True
        _fsync_dir(os.path.dirname(p.credential))
    except OSError:
        if replaced:
            bound = _current_identity(p.credential)  # type: object
        else:
            bound = identity
            try:
                _unlink_absent_ok(p.pending)
            except OSError:
                pass
        _UNSAVED[key] = (dict(record), bound, dict(refreshed) if refreshed is not None else None)  # type: ignore
        return False
    _UNSAVED.pop(key, None)
    return True


def retry_unsaved(auth_dir: str) -> str:
    """Write this process's unsaved record for `auth_dir`, if any. The caller holds `held(auth_dir)` and has just
    run `recover_pending`.

    `"none"`: no record. `"dropped"`: the credential file is no longer the one the record was to replace (a sign-in
    or a restore wrote it since), so the record is removed and the file kept, with one stderr line naming the authDir
    and no token; this is the only place a mismatched record is dropped. `"written"`: the commit succeeded and the
    record is cleared; the status file is rewritten as the refresh that produced the record would have written it:
    state `ok`, `lastErrorCode` null, `expiresAt` the record's, `lastRefreshAt` and `lastRequestId` the ones kept with
    the record, `unsaved: false` and the new file's identity. Nothing else is carried from the status on disk: it was
    measured on the file the record replaces (another process's needs-signin there is about that file's token, not
    this record's), and it may be older than this refresh when the status write failed with the commit. A
    needs-signin met on the record's own token never reaches here: `ensure_fresh` drops the record. The one thing
    carried is a config-error that bars under this config: it is about ccrc's OAuth client, not a file's token, so
    its `state`, `lastErrorCode` and `lastRequestId` stay, bound to the new file, and no request follows until the
    config changes. `"still-unsaved"`: the commit failed again and the record stays."""
    p = paths_for(auth_dir)
    key = _key(auth_dir)
    entry = _UNSAVED.get(key)
    if entry is None:
        return "none"
    record, bound, refreshed = entry
    if _current_identity(p.credential) != bound:
        del _UNSAVED[key]
        sys.stderr.write("ccgpt-auth: dropped an unsaved credential for " + key + ": the credential file changed "
                         "since it was refreshed (a sign-in or a restore); the file on disk is kept\n")
        sys.stderr.flush()
        return "dropped"
    # Read before the commit: the status is current only while the file it was measured on is still in place.
    prev = read_status(auth_dir)
    if not commit_record(auth_dir, record, refreshed):
        return "still-unsaved"
    kept = refreshed or {}
    if _bars(prev) and prev is not None and prev.get("state") == KIND_CONFIG_ERROR:
        state, code, rid = KIND_CONFIG_ERROR, prev.get("lastErrorCode"), prev.get("lastRequestId")
    else:
        state, code, rid = "ok", None, kept.get("lastRequestId")
    write_status(auth_dir, state=state, expiresAt=record.get("expires_at"), lastRefreshAt=kept.get("lastRefreshAt"),
                 lastErrorCode=code, lastRequestId=rid, identity=_current_identity(p.credential), unsaved=False)
    return "written"


def recover_pending(auth_dir: str) -> str:
    """Settle a checkpoint a crash left between its fsync and its rename. The caller holds `held(auth_dir)`.

    `"none"`: no checkpoint. `"promoted"`: a checkpoint that is a regular file, parses as a backend record with both
    tokens, and whose mtime is not older than the credential's, is renamed into place and the directory fsynced.
    `"discarded"`: any other checkpoint is unlinked. A promotion is a write, so it refuses as `commit_record` does,
    over a credential that reads `unreadable` or belongs to another family, with both files left as they are.

    The checkpoint is fsynced through the descriptor it is read by before it is promoted (its writer may have died
    between its write and its fsync). An `OSError` is `Unreadable`, naming the checkpoint and the errno, with both
    files kept as they are: from the checkpoint's `lstat` (any errno but ENOENT), from the open or a read of the
    checkpoint (an unread checkpoint may be the only copy of a refreshed pair, so it is never discarded), from the
    rename, or from the unlink of a discarded checkpoint. The open's remedy follows its errno: a checkpoint gone
    since the `lstat` (ENOENT) answers `"none"`, as at the `lstat`; a symlink swapped in since (ELOOP) is refused
    with a remedy that names it; any other errno names `chmod 600` and the disk. A
    checkpoint that would be promoted but whose fsync failed is refused the same way, never promoted and never
    discarded; one that would be discarded is discarded whatever its fsync answered. A failure of the directory fsync
    after the rename still answers `"promoted"`: the checkpoint is in place."""
    p = paths_for(auth_dir)
    try:
        pst = os.lstat(p.pending)
    except OSError as e:
        if e.errno == errno.ENOENT:
            return "none"
        raise Unreadable("the checkpoint " + p.pending + " cannot be read (" + _errno_word(e) + "); check the "
                         "permissions of " + os.path.dirname(p.pending))
    candidate = None  # type: Optional[Reading]
    sync_error = None  # type: Optional[OSError]
    if stat.S_ISREG(pst.st_mode):
        try:
            fd = os.open(p.pending, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
                         | getattr(os, "O_CLOEXEC", 0))
            try:
                chunks = []
                while True:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                try:
                    os.fsync(fd)
                except OSError as e:
                    sync_error = e
            finally:
                os.close(fd)
        except OSError as e:
            if e.errno == errno.ENOENT:  # removed out of band since the lstat: what the lstat's ENOENT answers
                return "none"
            if e.errno == errno.ELOOP:  # a symlink swapped in since the lstat, refused by O_NOFOLLOW
                raise Unreadable("the checkpoint " + p.pending + " became a symlink while it was read (ELOOP); ccrc "
                                 "never follows it and keeps the credential as it is; retry, and the next recover "
                                 "removes the symlink")
            raise Unreadable("the checkpoint " + p.pending + " cannot be read (" + _errno_word(e) + "); ccrc keeps "
                             "it and the credential as they are; fix its mode with chmod 600 " + p.pending
                             + " or fix the disk, and retry")
        try:
            candidate = _reading_of(json.loads(b"".join(chunks).decode("utf-8")), None, p.pending)
        except (ValueError, RecursionError):
            candidate = None
    current = _read_file(auth_dir)
    older = current.identity is not None and pst.st_mtime_ns < current.identity[1]
    if candidate is None or candidate.credential != "present" or older:
        try:
            _unlink_absent_ok(p.pending)
        except OSError as e:
            raise Unreadable("the checkpoint " + p.pending + " cannot be removed (" + _errno_word(e) + "); check "
                             "the permissions of " + os.path.dirname(p.pending))
        return "discarded"
    _refuse_unwritable(current)
    if sync_error is not None:
        raise Unreadable("the checkpoint " + p.pending + " cannot be made durable (" + _errno_word(sync_error)
                         + "); ccrc keeps it and the credential as they are; free space or fix the disk and retry")
    try:
        os.replace(p.pending, p.credential)
    except OSError as e:
        raise Unreadable("the checkpoint " + p.pending + " cannot be renamed into place (" + _errno_word(e) + "); "
                         "ccrc keeps it and the credential as they are; free space or fix the disk and retry")
    try:
        _fsync_dir(os.path.dirname(p.credential))
    except OSError:
        pass  # the rename happened: the checkpoint is the credential now
    return "promoted"


# ── the status file ──────────────────────────────────────────────────────────────────────────────────────────────
# The fields write_status takes.
_STATUS_FIELDS = frozenset(("state", "expiresAt", "lastRefreshAt", "lastErrorCode", "lastRequestId", "identity",
                            "unsaved"))
# The authDirs whose status write has failed since the last one that succeeded: each failure is named once.
_STATUS_WARNED = set()  # type: set


def _identity_json(identity: object) -> Optional[dict]:
    if isinstance(identity, tuple) and len(identity) == 3:
        ino, mtime_ns, size = identity
        return {"ino": ino, "mtimeNs": mtime_ns, "size": size}
    return None


def _identity_from_json(value: object) -> object:
    """A status file's `identity` as an `Identity`, `None` for a JSON null, `_UNMEASURED` for anything else."""
    if value is None:
        return None
    if isinstance(value, dict):
        parts = (value.get("ino"), value.get("mtimeNs"), value.get("size"))
        if all(type(x) is int for x in parts):
            return parts
    return _UNMEASURED


def _epoch_or_none(value: object) -> Optional[int]:
    return int(value) if _finite_number(value) else None  # type: ignore[arg-type]


def read_status(auth_dir: str) -> Optional[dict]:
    """The lane's status file, when it parses as a JSON object, is `version` 1, and its `identity` is the credential
    file's current one; else None (no file, another shape, or a status measured on a credential that has changed since,
    such as a sign-in or a restore). Never writes, never locks. A non-regular file at the path is None, unopened. An
    identity that cannot be measured on either side (a malformed one in the file; a credential path that is not a
    regular file) matches nothing, so such a status is never current."""
    p = paths_for(auth_dir)
    try:
        if not stat.S_ISREG(os.lstat(p.status).st_mode):
            return None
        fd = os.open(p.status, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0))
        try:
            chunks = []
            left = STATUS_MAX_BYTES
            while left > 0:
                chunk = os.read(fd, min(65536, left))
                if not chunk:
                    break
                chunks.append(chunk)
                left -= len(chunk)
        finally:
            os.close(fd)
    except OSError:
        return None
    try:
        obj = json.loads(b"".join(chunks).decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        return None
    if not isinstance(obj, dict) or type(obj.get("version")) is not int or obj["version"] != STATUS_VERSION:
        return None
    recorded = _identity_from_json(obj.get("identity"))
    current = _current_identity(p.credential)
    if recorded is _UNMEASURED or current is _UNMEASURED or recorded != current:
        return None
    return obj


def _bars(status: Optional[dict]) -> bool:
    """A current status bars a refresh when its state is needs-signin, or config-error measured under this library's
    current config (a config-error under another `configHash` is stale: the next call retries once)."""
    if status is None:
        return False
    state = status.get("state")
    if state == KIND_NEEDS_SIGNIN:
        return True
    return state == KIND_CONFIG_ERROR and status.get("configHash") == config_hash()


def write_status(auth_dir: str, **fields: object) -> bool:
    """Write the lane's non-secret status file. Under `held(auth_dir)` only (a RuntimeError otherwise: the status has
    one writer at a time, as the credential does).

    `fields`: `state` (one of STATES, required), `expiresAt`, `lastRefreshAt` (epoch seconds or None),
    `lastErrorCode` (a code `classify_error` already bounded, or a library code, or None), `lastRequestId` (already
    bounded by REQUEST_ID_RE, or None), `identity` (the credential file's, or None) and `unsaved`. `version`, `family`,
    `consent` (always null in Stage 1), `configHash` (`config_hash()`, read now) and `updatedAt` are the writer's own.

    Written as `auth.status.json` + STATUS_TMP_SUFFIX (unlinked first, opened O_EXCL|O_NOFOLLOW, set to FILE_MODE by
    fchmod, fsynced) and renamed over the status. A failure is swallowed, the temp file removed, and named on stderr
    once per authDir until a write succeeds again: the status is never worth a refresh. True when it was written."""
    p = paths_for(auth_dir)
    if p.lock not in _held_here():
        raise RuntimeError("ccgpt-auth: write_status is called under held() only")
    unknown = set(fields) - _STATUS_FIELDS
    if unknown:
        raise TypeError("ccgpt-auth: write_status takes no field " + ", ".join(sorted(unknown)))
    state = fields.get("state")
    if state not in STATES:
        raise ValueError("ccgpt-auth: a status state is one of " + ", ".join(STATES))
    code = fields.get("lastErrorCode")
    rid = fields.get("lastRequestId")
    obj = {
        "version": STATUS_VERSION,
        "family": FAMILY_BACKEND,
        "state": state,
        "expiresAt": _epoch_or_none(fields.get("expiresAt")),
        "lastRefreshAt": _epoch_or_none(fields.get("lastRefreshAt")),
        "lastErrorCode": code if isinstance(code, str) else None,
        "lastRequestId": rid if isinstance(rid, str) else None,
        "consent": None,
        "identity": _identity_json(fields.get("identity")),
        "configHash": config_hash(),
        "unsaved": bool(fields.get("unsaved", False)),
        "updatedAt": int(time.time()),
    }
    data = json.dumps(obj, sort_keys=True).encode("utf-8")
    tmp = p.status + STATUS_TMP_SUFFIX
    key = _key(auth_dir)
    try:
        _unlink_absent_ok(tmp)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), FILE_MODE)
        try:
            os.fchmod(fd, FILE_MODE)
            _write_all(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, p.status)
    except OSError as e:
        try:
            _unlink_absent_ok(tmp)
        except OSError:
            pass
        if key not in _STATUS_WARNED:
            _STATUS_WARNED.add(key)
            sys.stderr.write("ccgpt-auth: the status file for " + key + " could not be written (" + _errno_word(e)
                             + "); the credential is unaffected\n")
            sys.stderr.flush()
        return False
    _STATUS_WARNED.discard(key)
    return True


# ── the refresh ──────────────────────────────────────────────────────────────────────────────────────────────────
def _error_name(body: bytes) -> Optional[str]:
    """The error name as Codex's `TokenErrorDetail::parse` reads it (upstream openai/codex @ 092d3ac,
    codex-rs/login/src/oauth/error.rs:135-164): from a JSON object body, a string `error`, else a string `error.code`,
    else a top-level string `code`, each skipped when it is blank (Codex's `nonempty_text` tests the trimmed text and
    answers the text as received). None when none of the three is a non-blank string."""
    try:
        obj = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        return None
    if not isinstance(obj, dict):
        return None

    def text(value: object) -> Optional[str]:
        return value if isinstance(value, str) and value.strip() else None

    name = text(obj.get("error"))
    if name is None and isinstance(obj.get("error"), dict):
        name = text(obj["error"].get("code"))
    if name is None:
        name = text(obj.get("code"))
    return name


def classify_error(status: int, body: bytes) -> Tuple[str, Optional[str]]:
    """Classify a refusal of the refresh as Codex classifies it: `(kind, code)`.

    The name `_error_name` reads is lower-cased, as Codex compares it, before it is classified; `code` is that
    lower-cased name when it matches CODE_RE, else UNRECOGNISED_CODE, and None when there is no name. The body itself
    is never kept, logged or formatted. The kind, in this order: config-error when the code is in CONFIG_ERROR_CODES,
    whatever the status (spec §2.6); needs-signin on any 401, whatever its code or body; needs-signin for invalid_grant
    on a 400; needs-signin for any other code in NEEDS_SIGNIN_CODES, whatever the status; otherwise transient (no code,
    an unknown code, and invalid_grant on a status other than 400 or 401, D-6382)."""
    name = _error_name(body)
    lowered = name.lower() if name is not None else None
    code = None if lowered is None else (lowered if CODE_RE.fullmatch(lowered) else UNRECOGNISED_CODE)
    if lowered in CONFIG_ERROR_CODES:
        return KIND_CONFIG_ERROR, code
    if status == 401:
        return KIND_NEEDS_SIGNIN, code
    if lowered == "invalid_grant":
        return (KIND_NEEDS_SIGNIN if status == 400 else KIND_TRANSIENT), code
    if lowered in NEEDS_SIGNIN_CODES:
        return KIND_NEEDS_SIGNIN, code
    return KIND_TRANSIENT, code


def _request_id(headers: object) -> Optional[str]:
    """`x-request-id`, else `request-id`, from an answer's headers; kept only when it matches REQUEST_ID_RE."""
    get = getattr(headers, "get", None)
    if get is None:
        return None
    for name in ("x-request-id", "request-id"):
        value = get(name)
        if value is not None:
            return value if isinstance(value, str) and REQUEST_ID_RE.fullmatch(value) else None
    return None


def _echoes(code: str, secret: str) -> bool:
    """True when a code carries the submitted refresh token, or a piece of it long enough to identify it: a token of at
    most 64 characters fits CODE_RE once `classify_error` lower-cases it, so an endpoint that echoes it as its error
    code must not have it stored. Compared without case, because the code is already lower-cased."""
    s = secret.lower()
    return bool(s) and (s in code or (len(code) >= 8 and code in s))


class _Redirected(Exception):
    def __init__(self, status: int, headers: object) -> None:
        super().__init__(status)
        self.status = status
        self.headers = headers


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect from the token route is refused: its Location is never fetched (a refresh token is never sent, nor a
    request made, anywhere but the configured endpoint)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        try:
            fp.close()
        finally:
            raise _Redirected(code, headers)


def _read_answer(resp: object, deadline: float) -> bytes:
    """An answer's body, at most ANSWER_MAX_BYTES, read before `deadline` (a `time.monotonic()` value): each read is
    one receive (`read1`) under the time left, so an endpoint that sends its answer slowly cannot stretch the request
    past TOKEN_TIMEOUT_S, which bounds the body as a whole, not each socket operation. Past the deadline, TimeoutError
    (an OSError). Used for a 2xx answer and for an error answer's body alike.

    What the deadline does not bound: the status line and the headers, read by `http.client` under TOKEN_TIMEOUT_S per
    socket operation before this runs; and, in a chunked answer, a chunk-size line, which `read1` reads with
    `readline`, each of whose receives waits up to the time left, so one slowly sent line can pass the deadline."""
    chunks = []
    left = ANSWER_MAX_BYTES
    while left > 0:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("the token request's deadline passed")
        sock = getattr(getattr(getattr(resp, "fp", None), "raw", None), "_sock", None)
        if sock is not None:
            sock.settimeout(remaining)
        chunk = resp.read1(min(65536, left))  # type: ignore[attr-defined]
        if not chunk:
            break
        chunks.append(chunk)
        left -= len(chunk)
    return b"".join(chunks)


# What a token request's transport can raise: urllib's URLError and a socket timeout are OSErrors; a connection the
# server drops mid-answer raises http.client's own exceptions.
_TRANSPORT_ERRORS = (OSError, http.client.HTTPException, ValueError)


def token_request(refresh_token: str) -> Tuple[dict, Optional[str]]:
    """The one network call of a refresh: POST auth_base() + TOKEN_PATH with LiteLLM's JSON body (client_id,
    grant_type refresh_token, the refresh token, scope), timeout TOKEN_TIMEOUT_S, redirects refused.

    Returns the answer (a JSON object) and its request id. Raises NeedsSignin, ConfigError or RefreshFailed, each
    carrying `.code` (classify_error's, or None) and `.request_id`; EndpointRefused for a non-loopback override, before
    any request. No sentence formats the answer, its body or a token. The answer's body, an error answer's included, is
    read within one deadline, TOKEN_TIMEOUT_S from the start of the request (`_read_answer`, which names what that
    deadline does not bound: the status line, the headers and a chunked answer's chunk-size lines). A request id or an
    error code that echoes the submitted refresh token is not stored."""
    url = auth_base() + TOKEN_PATH
    deadline = time.monotonic() + float(TOKEN_TIMEOUT_S)
    payload = json.dumps({"client_id": CLIENT_ID, "grant_type": "refresh_token", "refresh_token": refresh_token,
                          "scope": REFRESH_SCOPE}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json"})
    opener = urllib.request.build_opener(_RefuseRedirect)

    def _rid(headers: object) -> Optional[str]:
        # A request id that carries the submitted refresh token (REQUEST_ID_RE admits a token of at most 128
        # characters, any case) is an echo, never stored: compared case-folded, as `_echoes` compares a code.
        value = _request_id(headers)
        return None if value is not None and _echoes(value.lower(), refresh_token) else value

    try:
        resp = opener.open(req, timeout=float(TOKEN_TIMEOUT_S))
    except _Redirected as e:
        raise RefreshFailed("the token endpoint answered a redirect (HTTP " + str(e.status) + "), which ccrc never "
                            "follows; the credential is unchanged; retry", request_id=_rid(e.headers))
    except urllib.error.HTTPError as e:
        rid = _rid(e.headers)
        try:
            raw = _read_answer(e.fp, deadline) if e.fp is not None else b""
        except _TRANSPORT_ERRORS:
            raw = b""
        finally:
            e.close()
        kind, code = classify_error(e.code, raw)
        if code is not None and _echoes(code, refresh_token):
            code = UNRECOGNISED_CODE
        because = "HTTP " + str(e.code) + (", " + code if code else "")
        if kind == KIND_CONFIG_ERROR:
            raise ConfigError("the token endpoint refused ccrc's OAuth client (" + because + "); run ccrc update, then "
                              "sign the lane in", code=code, request_id=rid)
        if kind == KIND_NEEDS_SIGNIN:
            raise NeedsSignin("the token endpoint refused the lane's refresh token (" + because + "); the credential "
                              "is dead and is never retried; sign the lane in", code=code, request_id=rid)
        raise RefreshFailed("the token endpoint refused the refresh (" + because + "); the credential is unchanged; "
                            "retry", code=code, request_id=rid)
    except _TRANSPORT_ERRORS as e:
        raise RefreshFailed("the token endpoint could not be reached (" + type(e).__name__ + "); the credential is "
                            "unchanged; retry")
    rid = _rid(resp.headers)
    try:
        with resp:
            raw = _read_answer(resp, deadline)
    except _TRANSPORT_ERRORS as e:
        raise RefreshFailed("the token endpoint's answer could not be read (" + type(e).__name__ + "); the credential "
                            "is unchanged; retry", request_id=rid)
    try:
        answer = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        answer = None
    if not isinstance(answer, dict):
        raise RefreshFailed("the token endpoint's answer is not a JSON object; the credential is unchanged; retry",
                            code="refresh-response-unreadable", request_id=rid)
    return answer, rid


def _merge(r: Reading, old: object, answer: dict, rid: Optional[str]) -> dict:
    """The next credential: the answer's tokens over the stored ones, in LiteLLM's five keys.

    The answer must carry an access token (RefreshFailed `refresh-response-incomplete` otherwise, naming no field's
    value). A missing refresh token or id token keeps the stored one, as Codex keeps every token its refresh answer
    lacks (upstream openai/codex @ 092d3ac, codex-rs/login/src/auth/manager.rs:1600-1623), so a credential is never
    thrown away for a missing field. A stored `id_token` is kept only when it is a non-empty string (the backend
    format's `id_token` is a string); with neither the answer's nor a stored one, the record's `id_token` is null, and
    the refresh still succeeds. `expires_at` is the access token's `exp`, else now + `expires_in`, else null;
    `account_id` is the id token's claim, else the access token's, else the stored one."""
    access = _nonempty_str(answer.get("access_token"))
    if access is None:
        raise RefreshFailed("the token endpoint's answer carried no access token; the credential is unchanged; retry",
                            code="refresh-response-incomplete", request_id=rid)
    refresh = _nonempty_str(answer.get("refresh_token")) or r.refresh_token
    id_token = _nonempty_str(answer.get("id_token"))
    if id_token is None and isinstance(old, dict):
        id_token = _nonempty_str(old.get("id_token"))
    expires_at = _exp_of(access)
    if expires_at is None and _finite_number(answer.get("expires_in")):
        try:
            expires_at = int(time.time() + float(answer["expires_in"]))
        except (OverflowError, ValueError):
            expires_at = None
    account_id = (_account_id_of(id_token) or _account_id_of(access) or r.account_id)
    return {"access_token": access, "refresh_token": refresh, "id_token": id_token, "expires_at": expires_at,
            "account_id": account_id}


def _raise_for(r: Reading) -> None:
    """A reading the refresher cannot refresh: absent is NotSignedIn, incomplete NeedsSignin, another family's file
    ForeignFamily, anything unreadable Unreadable; each names the reading's own remedy."""
    if r.credential == "present":
        return
    if r.credential == "absent":
        raise NotSignedIn(r.detail)
    if r.credential == "incomplete":
        raise NeedsSignin(r.detail)
    if r.credential == "foreign-family":
        raise ForeignFamily(r.detail)
    raise Unreadable(r.detail)


def _state_error(state: str, code: Optional[str], rid: Optional[str], lane: Optional[str]) -> AuthError:
    who = lane if lane else "<lane>"
    because = code if code else "no error code"
    if state == KIND_CONFIG_ERROR:
        return ConfigError("the token endpoint refused ccrc's OAuth client (" + because + "); a sign-in alone does not "
                           "cure it: run ccrc update, then ccrc codex login " + who, code=code, request_id=rid)
    return NeedsSignin("the lane's credential needs a sign-in (" + because + "); ccrc never retries a dead "
                       "credential: run ccrc codex login " + who, code=code, request_id=rid)


def _from_unsaved(auth_dir: str, old: object) -> bool:
    """True when the reading `_read_raw` answered with `old` was served from this process's unsaved record."""
    entry = _UNSAVED.get(_key(auth_dir))
    return entry is not None and old is entry[0]


def _raise_if_barred(auth_dir: str, lane: Optional[str], unsaved: bool = False) -> None:
    """Raise the state a current status bars with. `unsaved`: the reading was served from this process's unsaved
    record, which a needs-signin never bars: that status was measured on the file the record replaces, so it is about
    that file's refresh token, not the record's (a refusal of the record's own token drops the record instead, in
    `ensure_fresh`). A config-error bars it as it bars any reading: it is about ccrc's OAuth client, not one token.
    `ensure_fresh` calls this for an unsaved reading under the lock only, after `retry_unsaved` has had its chance."""
    status = read_status(auth_dir)
    if _bars(status):
        assert status is not None
        if unsaved and status.get("state") == KIND_NEEDS_SIGNIN:
            return
        code = status.get("lastErrorCode")
        rid = status.get("lastRequestId")
        raise _state_error(status["state"], code if isinstance(code, str) else None,
                           rid if isinstance(rid, str) else None, lane)


def _unchanged_state(prev: Optional[dict]) -> str:
    """The state a transient failure leaves: the current status's, unless that is one the failure contradicts, else
    ok. A config-error reaches here only when it is stale (measured under another config). A current needs-signin
    never does: the bar raises it for a reading from the file, and for the unsaved record's reading `ensure_fresh`
    leaves it standing and writes no status (it is about the file's token, which this request did not send)."""
    state = prev.get("state") if prev is not None else None
    if state in STATES and state not in (KIND_NEEDS_SIGNIN, KIND_CONFIG_ERROR):
        return state  # type: ignore[return-value]
    return "ok"


def ensure_fresh(auth_dir: str, *, within_s: Optional[float] = None, lane: Optional[str] = None) -> Reading:
    """The refresher's door: the lane's credential, refreshed when it expires within `within_s` (EXPIRY_SKEW_S, read
    when called, by default). Spec §2.6 figure 4, with this plan's checkpoint, status binding and unsaved record.

    A present, unexpired credential with no unsaved record bound is answered at once: no lock, no network. A status
    that bars the credential (needs-signin, or config-error under this config) is raised at once, never retried and
    never waiting on the lock. A reading served from the unsaved record is never barred before the lock: under it,
    `retry_unsaved` writes the record once the disk takes it (keeping a config-error that bars), and an unexpired
    record is answered. It is never barred by a needs-signin: the status was measured on the file the record
    replaces, and a refusal met there is about that file's token, not the record's, so the record's own refresh
    writes no status over that needs-signin unless its commit succeeds. A config-error bars it, under the lock,
    before any request. When the endpoint refuses the unsaved record's own refresh token as needs-signin, the record
    is dropped (one stderr line, no token), so the needs-signin written, bound to the file on disk, bars every later
    call and no retry writes ok over it. Otherwise, under `held`: settle a
    checkpoint (`recover_pending`), write an unsaved record (`retry_unsaved`), re-read (another process may have
    refreshed or failed, and is obeyed), re-check the status, then make the one token request. A refusal writes its
    state to the status file and raises it; a transient failure leaves the state as it was and raises RefreshFailed.
    A refresh is committed atomically; a commit that cannot write keeps the record in memory, served by `read` and
    written by the next holder. `lane` names the lane in a remedy (`ccrc codex login <lane>`)."""
    key = _key(auth_dir)
    r, old = _read_raw(auth_dir)
    _raise_for(r)
    if not expired(r, within_s) and key not in _UNSAVED:
        return r
    if not _from_unsaved(auth_dir, old):
        _raise_if_barred(auth_dir, lane)
    with held(auth_dir) as p:
        recover_pending(auth_dir)
        retry_unsaved(auth_dir)
        r, old = _read_raw(auth_dir)
        _raise_for(r)
        if not expired(r, within_s):
            return r  # the unsaved record too: a disk that stays full never asks again
        from_unsaved = _from_unsaved(auth_dir, old)
        _raise_if_barred(auth_dir, lane, unsaved=from_unsaved)
        prev = read_status(auth_dir)
        # A needs-signin another process measured on the file the unsaved record replaces: it stays (that file's
        # refresh token is dead), so no status this request writes about that file may clear it.
        standing = from_unsaved and _bars(prev)
        # The unsaved record's own lastRefreshAt, never the status on disk's, which may predate the record's refresh
        # when that refresh's status write failed with its commit.
        kept = _UNSAVED[key][2] if from_unsaved else None
        failed = dict(expiresAt=r.expires_at, identity=r.identity, unsaved=key in _UNSAVED,
                      lastRefreshAt=(kept.get("lastRefreshAt") if kept is not None
                                     else prev.get("lastRefreshAt") if prev is not None else None))
        try:
            answer, rid = token_request(r.refresh_token or "")
            rec = _merge(r, old, answer, rid)
        except (NeedsSignin, ConfigError) as e:
            if e.word == KIND_NEEDS_SIGNIN and from_unsaved:
                # The record's own refresh token is dead: drop the record (nothing in it can be refreshed again), so
                # the needs-signin bound to the file on disk bars every later call.
                del _UNSAVED[key]
                failed["unsaved"] = False
                sys.stderr.write("ccgpt-auth: dropped an unsaved credential for " + key + ": the token endpoint "
                                 "refused its refresh token; the file on disk is kept\n")
                sys.stderr.flush()
            write_status(auth_dir, state=e.word, lastErrorCode=e.code, lastRequestId=e.request_id, **failed)
            raise _state_error(e.word, e.code, e.request_id, lane) from None
        except RefreshFailed as e:
            if not standing:
                write_status(auth_dir, state=_unchanged_state(prev), lastErrorCode=e.code,
                             lastRequestId=e.request_id, **failed)
            raise
        refreshed = dict(lastRefreshAt=time.time(), lastRequestId=rid)
        saved = commit_record(auth_dir, rec, refreshed)
        # The file still on disk when the commit could not write: the identity the unsaved record is bound to.
        bound = _current_identity(p.credential) if saved else _UNSAVED.get(key, (rec, r.identity, None))[1]
        if saved or not standing:
            write_status(auth_dir, state="ok", expiresAt=rec["expires_at"], lastErrorCode=None, identity=bound,
                         unsaved=not saved, **refreshed)
        identity = bound if isinstance(bound, tuple) else None  # type: Optional[Identity]
        out = _reading_of(rec, identity, p.credential)
        if not saved:
            out = out._replace(detail="an unsaved credential for " + p.credential + " is held in memory; the next "
                               "refresh writes it")
        return out


# ── the device-code sign-in ──────────────────────────────────────────────────────────────────────────────────────
def _again(lane: str) -> str:
    return "nothing was saved; sign in again with ccrc codex login " + lane


def _json_object(raw: bytes) -> Optional[dict]:
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        return None
    return obj if isinstance(obj, dict) else None


def _signin_post(url: str, body: bytes, content_type: str, what: str, lane: str) -> Tuple[int, bytes, Optional[str]]:
    """One sign-in request: POST `body` to `url`, redirects refused, the answer's body read within TOKEN_TIMEOUT_S of
    the request's start (`_read_answer`, as the refresh reads). Answers `(status, body, request id)` for any HTTP
    answer, 2xx or not; a redirect or a transport failure is LoginFailed, naming `what` and never the body."""
    deadline = time.monotonic() + float(TOKEN_TIMEOUT_S)
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": content_type, "Accept": "application/json"})
    opener = urllib.request.build_opener(_RefuseRedirect)
    try:
        resp = opener.open(req, timeout=float(TOKEN_TIMEOUT_S))
    except _Redirected as e:
        raise LoginFailed("the " + what + " answered a redirect (HTTP " + str(e.status) + "), which ccrc never "
                          "follows; " + _again(lane))
    except urllib.error.HTTPError as e:
        rid = _request_id(e.headers)
        try:
            raw = _read_answer(e.fp, deadline) if e.fp is not None else b""
        except _TRANSPORT_ERRORS:
            raw = b""
        finally:
            e.close()
        return e.code, raw, rid
    except _TRANSPORT_ERRORS as e:
        raise LoginFailed("the " + what + " could not be reached (" + type(e).__name__ + "); " + _again(lane))
    rid = _request_id(resp.headers)
    try:
        with resp:
            raw = _read_answer(resp, deadline)
    except _TRANSPORT_ERRORS as e:
        raise LoginFailed("the " + what + "'s answer could not be read (" + type(e).__name__ + "); " + _again(lane))
    return resp.status, raw, rid


def _poll_interval(value: object) -> float:
    """The device code's poll interval: the answer's `interval` (a number, or a string of one), never under
    DEVICE_POLL_MIN_S, which is also what an answer without a usable one gets (LiteLLM's `max(interval, 5)` and its
    default of 5)."""
    floor = float(DEVICE_POLL_MIN_S)
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return floor
    if not _finite_number(value):
        return floor
    return max(float(value), floor)  # type: ignore[arg-type]


def _request_device_code(base: str, lane: str) -> Tuple[str, str, float]:
    """POST DEVICE_CODE_PATH `{client_id}`: answers `(device_auth_id, user_code, poll interval)`."""
    status, raw, _ = _signin_post(base + DEVICE_CODE_PATH, json.dumps({"client_id": CLIENT_ID}).encode("utf-8"),
                                  "application/json", "device-code request", lane)
    if not 200 <= status < 300:
        raise LoginFailed("the device-code request was refused (HTTP " + str(status) + "); " + _again(lane))
    data = _json_object(raw) or {}
    device_auth_id = _nonempty_str(data.get("device_auth_id"))
    user_code = _nonempty_str(data.get("user_code") or data.get("usercode"))
    if device_auth_id is None or user_code is None:
        raise LoginFailed("the device-code answer carried no device_auth_id or no user_code; " + _again(lane))
    return device_auth_id, user_code, _poll_interval(data.get("interval"))


def _poll_device(base: str, device_auth_id: str, user_code: str, interval: float, wait_s: float,
                 lane: str) -> Tuple[str, str]:
    """Poll DEVICE_TOKEN_PATH until the operator approves the code: answers `(authorization_code, code_verifier)`. A 403
    or a 404 is pending, and so is a 2xx answer that lacks any of the three fields LiteLLM requires; each wait is
    `interval`, cut short at the deadline, `wait_s` from the first poll. Any other answer is LoginFailed."""
    body = json.dumps({"device_auth_id": device_auth_id, "user_code": user_code}).encode("utf-8")
    deadline = time.monotonic() + float(wait_s)
    timed_out = LoginFailed("timed out waiting for the device code to be approved (" + str(wait_s) + " s); "
                            + _again(lane))
    while True:
        if deadline - time.monotonic() <= 0:
            raise timed_out
        status, raw, _ = _signin_post(base + DEVICE_TOKEN_PATH, body, "application/json", "device-code poll", lane)
        if 200 <= status < 300:
            data = _json_object(raw) or {}
            code = _nonempty_str(data.get("authorization_code"))
            challenge = _nonempty_str(data.get("code_challenge"))
            verifier = _nonempty_str(data.get("code_verifier"))
            if code is not None and challenge is not None and verifier is not None:
                return code, verifier
        elif status not in (403, 404):
            raise LoginFailed("the device-code poll was refused (HTTP " + str(status) + "); " + _again(lane))
        left = deadline - time.monotonic()
        if left <= 0:
            raise timed_out
        time.sleep(min(interval, left))


def _exchange(base: str, code: str, verifier: str, lane: str) -> Tuple[dict, Optional[str]]:
    """Exchange the authorization code at TOKEN_PATH, form-encoded as LiteLLM sends it. The answer must carry all three
    tokens (ruling R8: the sign-in exchange only; a refresh keeps the tokens its answer lacks); a refusal names the
    missing fields' names, never a value. Answers the backend record and the answer's request id."""
    form = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": AUTH_BASE + DEVICE_CALLBACK_PATH,
        "client_id": CLIENT_ID,
        "code_verifier": verifier,
    }).encode("ascii")
    status, raw, rid = _signin_post(base + TOKEN_PATH, form, "application/x-www-form-urlencoded", "token exchange",
                                    lane)
    if not 200 <= status < 300:
        raise LoginFailed("the token exchange was refused (HTTP " + str(status) + "); " + _again(lane))
    answer = _json_object(raw)
    if answer is None:
        raise LoginFailed("the token exchange's answer is not a JSON object; " + _again(lane))
    missing = [k for k in ("access_token", "refresh_token", "id_token") if _nonempty_str(answer.get(k)) is None]
    if missing:
        raise LoginFailed("the token exchange's answer carried no " + " and no ".join(missing) + "; " + _again(lane))
    return _merge(_empty("absent", ""), None, answer, rid), rid


def _refuse_signin(r: Reading) -> None:
    """A sign-in never writes over a file that reads `unreadable` nor over another family's file, and refuses them
    before any request, so an operator who cannot keep the result never approves a code."""
    if r.credential == "unreadable":
        raise Unreadable("ccrc will not sign in over it: " + r.detail)
    if r.credential == "foreign-family":
        raise ForeignFamily(r.detail)


def _pending_exists(auth_dir: str) -> bool:
    """True when something is at the checkpoint path, or the path cannot be measured (the lock and `recover_pending`
    then name why)."""
    try:
        os.lstat(paths_for(auth_dir).pending)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True


def sign_in_device(auth_dir: str, *, lane: str, out: Optional[TextIO] = None, timeout_s: Optional[float] = None) -> str:
    """Sign the lane in by LiteLLM's device-code protocol, writing the credential through the library's commit.

    1. `read`, with no lock and nothing written: `unreadable` refuses Unreadable and `foreign-family` ForeignFamily,
       before any request.
    2. A checkpoint (any file at its path) is settled under `held` (`recover_pending`, `retry_unsaved`), and the
       reading taken again; with no checkpoint nothing is locked here, so an abandoned sign-in creates no lock file.
    3. `"already-signed-in"`, with no network, when the reading is `present` and no current status bars it
       (needs-signin, or config-error under this config): in litellm mode a sign-in never refreshes (ruling 1).
    4. Otherwise the device flow: the device code, LiteLLM's four lines on `out` (sys.stdout, read when called), the
       poll (`timeout_s`, DEVICE_TIMEOUT_S read when called by default), the exchange. NOTHING is written before the
       exchange answers, so a sign-in abandoned or killed at any point before leaves the authDir as it was.
    5. Under one `held`: settle a checkpoint and an unsaved record, refuse as in step 1, then commit, tried
       SIGNIN_COMMIT_TRIES times SIGNIN_COMMIT_RETRY_S apart; a commit that never lands is LoginFailed with the old
       file unchanged and the sign-in's record not kept; on success the status is `ok`. Answers `"signed-in"`.
    With CCRC_CODEX_AUTH_BASE set, one stderr line names it and its URL before the first request."""
    stream = sys.stdout if out is None else out
    wait = DEVICE_TIMEOUT_S if timeout_s is None else timeout_s
    r = read(auth_dir)
    _refuse_signin(r)
    if _pending_exists(auth_dir):
        with held(auth_dir):
            recover_pending(auth_dir)
            retry_unsaved(auth_dir)
        r = read(auth_dir)
        _refuse_signin(r)
    if r.credential == "present" and not _bars(read_status(auth_dir)):
        return "already-signed-in"
    base = auth_base()
    if auth_base_source() == "override":
        sys.stderr.write("ccgpt-auth: " + AUTH_BASE_ENV + " is set: every sign-in request goes to " + base
                         + ", not to the default endpoint\n")
        sys.stderr.flush()
    device_auth_id, user_code, interval = _request_device_code(base, lane)
    stream.write("Sign in with ChatGPT using device code:\n"
                 "1) Visit " + AUTH_BASE + DEVICE_VERIFY_PATH + "\n"
                 "2) Enter code: " + user_code + "\n"
                 "Device codes are a common phishing target. Never share this code.\n")
    stream.flush()
    code, verifier = _poll_device(base, device_auth_id, user_code, interval, wait, lane)
    record, rid = _exchange(base, code, verifier, lane)
    key = _key(auth_dir)
    with held(auth_dir) as p:
        recover_pending(auth_dir)
        retry_unsaved(auth_dir)
        _refuse_signin(read(auth_dir))
        kept = _UNSAVED.get(key)  # an unsaved refresh `retry_unsaved` could not write: it stays as it was
        saved = False
        for attempt in range(int(SIGNIN_COMMIT_TRIES)):
            if attempt:
                time.sleep(float(SIGNIN_COMMIT_RETRY_S))
            if commit_record(auth_dir, record):
                saved = True
                break
        if not saved:
            if kept is None:
                _UNSAVED.pop(key, None)
            else:
                _UNSAVED[key] = kept
            raise LoginFailed("the credential could not be written after " + str(SIGNIN_COMMIT_TRIES) + " tries: the "
                              "disk is full; nothing was saved; sign in again once it frees (ccrc codex login "
                              + lane + ")")
        write_status(auth_dir, state="ok", expiresAt=record.get("expires_at"), lastRefreshAt=time.time(),
                     lastErrorCode=None, lastRequestId=rid, identity=_current_identity(p.credential), unsaved=False)
    return "signed-in"


# ── the status report ────────────────────────────────────────────────────────────────────────────────────────────
def _str_or_none(value: object) -> Optional[str]:
    return value if isinstance(value, str) else None


def status_report(auth_dir: str) -> dict:
    """The lane's non-secret status, for bash and node callers. Never writes, never touches the network.

    `source` is `"file"` when the status file is current (`read_status`), else `"computed"` from `read` (a
    credential no library process has written a status for, or one changed since): then `state` is `ok` for a
    present credential and null otherwise, and the refresh fields are null. `credential` is always `read`'s word.
    `mode`, `modeOk` (owner-readable, no group or other bits) and `ownerOk` (owned by `os.getuid()`) come from the
    credential's `lstat`, and are null when nothing is there. Never `account_id`, never a token."""
    p = paths_for(auth_dir)
    r = read(auth_dir)
    status = read_status(auth_dir)
    try:
        st = os.lstat(p.credential)  # type: Optional[os.stat_result]
    except OSError:
        st = None
    mode = stat.S_IMODE(st.st_mode) if st is not None else None
    if status is not None:
        report = {
            "source": "file",
            "family": _str_or_none(status.get("family")),
            "state": _str_or_none(status.get("state")),
            "expiresAt": _epoch_or_none(status.get("expiresAt")),
            "lastRefreshAt": _epoch_or_none(status.get("lastRefreshAt")),
            "lastErrorCode": _str_or_none(status.get("lastErrorCode")),
            "lastRequestId": _str_or_none(status.get("lastRequestId")),
            "unsaved": status.get("unsaved") is True,
            "updatedAt": _epoch_or_none(status.get("updatedAt")),
        }  # type: dict
    else:
        report = {
            "source": "computed",
            "family": r.family,
            "state": "ok" if r.credential == "present" else None,
            "expiresAt": _epoch_or_none(r.expires_at),
            "lastRefreshAt": None,
            "lastErrorCode": None,
            "lastRequestId": None,
            "unsaved": False,
            "updatedAt": None,
        }
    report.update({
        "credential": r.credential,
        "mode": format(mode, "04o") if mode is not None else None,
        "modeOk": (bool(mode & 0o400) and not mode & 0o077) if mode is not None else None,
        "ownerOk": (st.st_uid == os.getuid()) if st is not None else None,
        "authBase": auth_base_source(),
    })
    return report


# ── the command line ─────────────────────────────────────────────────────────────────────────────────────────────
USAGE = ("usage: ccgpt-auth.py status [--lane <id>] | signin --lane <id> | paths | secret-files, each with --auth-dir "
         "<absolute>")
# Each verb's options: (required, optional). Every option takes one value.
_VERBS = {
    "status": (frozenset({"--auth-dir"}), frozenset({"--lane"})),
    "signin": (frozenset({"--auth-dir", "--lane"}), frozenset()),
    "paths": (frozenset({"--auth-dir"}), frozenset()),
    "secret-files": (frozenset({"--auth-dir"}), frozenset()),
}


def _usage() -> int:
    sys.stderr.write(USAGE + "\n")
    return 2


def main(argv: List[str]) -> int:
    """The command line bash and node callers use. Every verb takes `--auth-dir <absolute>`; a relative one, an
    unknown verb or option, a repeated or valueless option, or a missing required one is usage: one line on stderr,
    rc 2. No verb ever prints a token.
      status [--lane <id>]  one JSON object, `status_report`, rc 0
      signin --lane <id>    the device lines on stdout, then `ccgpt-auth: <id>: signed-in` or
                            `ccgpt-auth: <id>: already-signed-in: <ALREADY_SIGNED_IN>`, rc 0; or
                            `ccgpt-auth: <word>: <sentence>` on stderr, rc 1
      paths                 {"credential", "pending", "lock", "status", "lockWaitS"}, rc 0
      secret-files          the credential and checkpoint paths, one per line, rc 0"""
    if not argv or argv[0] not in _VERBS:
        return _usage()
    verb = argv[0]
    required, optional = _VERBS[verb]
    opts = {}  # type: Dict[str, str]
    rest = argv[1:]
    i = 0
    while i < len(rest):
        name = rest[i]
        if name not in required | optional or name in opts or i + 1 >= len(rest):
            return _usage()
        opts[name] = rest[i + 1]
        i += 2
    if not required <= set(opts):
        return _usage()
    auth_dir = opts["--auth-dir"]
    if not os.path.isabs(auth_dir):
        return _usage()
    out = sys.stdout
    if verb == "status":
        out.write(json.dumps(status_report(auth_dir), sort_keys=True) + "\n")
        return 0
    if verb == "paths":
        p = paths_for(auth_dir)
        out.write(json.dumps({"credential": p.credential, "pending": p.pending, "lock": p.lock, "status": p.status,
                              "lockWaitS": LOCK_WAIT_S}, sort_keys=True) + "\n")
        return 0
    if verb == "secret-files":
        p = paths_for(auth_dir)
        out.write(p.credential + "\n" + p.pending + "\n")
        return 0
    lane = opts["--lane"]
    try:
        result = sign_in_device(auth_dir, lane=lane, out=out)
    except AuthError as e:
        out.flush()
        sys.stderr.write("ccgpt-auth: " + e.word + ": " + str(e) + "\n")
        return 1
    line = "ccgpt-auth: " + lane + ": " + result
    if result == "already-signed-in":
        line += ": " + ALREADY_SIGNED_IN
    out.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
