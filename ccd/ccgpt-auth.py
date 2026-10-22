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
import errno
import hashlib
import json
import os
import stat
import time
import urllib.parse
from typing import Dict, NamedTuple, Optional, Tuple

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
    token endpoint is trusted through TLS). `{}` on anything undecodable."""
    if not isinstance(jwt, str):
        return {}
    parts = jwt.split(".")
    if len(parts) < 2:
        return {}
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
    except (ValueError, UnicodeError, TypeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _exp_of(token: Optional[str]) -> Optional[int]:
    exp = claims_of(token).get("exp") if isinstance(token, str) else None
    if isinstance(exp, (int, float)) and not isinstance(exp, bool):
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


# The unsaved records: authDir -> (record, identity of the file the record was to replace, measured under the lock).
# `read` answers from one while the file's identity still equals its identity, and otherwise ignores it, leaving
# the map unchanged and printing nothing. Only the writer side (`commit_record`, `retry_unsaved`) changes the map.
_UNSAVED: Dict[str, Tuple[dict, Identity]] = {}


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
    if isinstance(stored, (int, float)) and not isinstance(stored, bool):
        expires_at = stored  # type: Optional[float]
    else:
        expires_at = _exp_of(access)
    account_id = _nonempty_str(obj.get("account_id"))
    if account_id is None:
        account_id = _account_id_of(_nonempty_str(obj.get("id_token"))) or _account_id_of(access)
    return Reading("present", access, refresh, account_id, expires_at, family, identity,
                   "the credential at " + where + " is present")


def _current_identity(path: str) -> Optional[Identity]:
    try:
        st = os.lstat(path)
    except OSError:
        return None
    return _identity(st) if stat.S_ISREG(st.st_mode) else None


def read(auth_dir: str) -> Reading:
    """Read the lane's credential. Never writes, never locks, never touches the network.

    Answers the unsaved record first while its identity still matches the file. A non-regular file at the path, a
    symlink included, is `unreadable` by `lstat`, without being opened; the open is `O_RDONLY|O_NOFOLLOW`, which
    guards a swap between the two. A JSON parse failure (a file LiteLLM is rewriting in place) is re-read up to
    READ_RETRIES times, READ_RETRY_S apart, and then answers `unreadable`, never `absent`. Any `OSError` other than
    ENOENT is `unreadable`."""
    p = paths_for(auth_dir)
    where = p.credential
    unsaved = _UNSAVED.get(os.path.normpath(auth_dir))
    if unsaved is not None:
        record, bound = unsaved
        if _current_identity(where) == bound:
            r = _reading_of(record, bound, where)
            return r._replace(detail="an unsaved credential for " + where + " is held in memory; the next refresh "
                              "writes it")
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
                e.errno or 0, "error") + "); fix its mode with chmod 600")
        if not stat.S_ISREG(st.st_mode):
            return _empty("unreadable", "the credential path " + where + " is not a regular file; move it aside "
                          "and sign the lane in", _identity(st))
        try:
            fd = os.open(where, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        except OSError as e:
            if e.errno == errno.ENOENT:
                return _empty("absent", "no credential at " + where + "; sign the lane in")
            return _empty("unreadable", "the credential at " + where + " cannot be opened (" + errno.errorcode.get(
                e.errno or 0, "error") + "); fix its mode with chmod 600")
        try:
            fst = os.fstat(fd)
            if not stat.S_ISREG(fst.st_mode):
                return _empty("unreadable", "the credential path " + where + " is not a regular file",
                              _identity(fst))
            identity = _identity(fst)
            chunks = []
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
        except OSError as e:
            return _empty("unreadable", "the credential at " + where + " cannot be read (" + errno.errorcode.get(
                e.errno or 0, "error") + ")")
        finally:
            os.close(fd)
        try:
            obj = json.loads(b"".join(chunks).decode("utf-8"))
        except ValueError:  # JSONDecodeError and UnicodeDecodeError alike
            if attempt < retries:
                attempt += 1
                time.sleep(retry_s)
                continue
            return _empty("unreadable", "the credential at " + where + " is not valid JSON after "
                          + str(retries) + " re-reads; if a tier is rewriting it, retry; otherwise sign the lane in",
                          identity)
        return _reading_of(obj, identity, where)


def expired(r: Reading, within_s: Optional[float] = None, now: Optional[float] = None) -> bool:
    """True when the reading's access token expires within `within_s` (EXPIRY_SKEW_S, read when called, by default).

    `r.expires_at` is already the file's number or the one derived from the access token's `exp`, so a null means
    neither exists, and that is expired: LiteLLM's rule (`authenticator.py:113-122`)."""
    skew = EXPIRY_SKEW_S if within_s is None else within_s
    t = time.time() if now is None else now
    if r.expires_at is None:
        return True
    return t >= float(r.expires_at) - float(skew)
