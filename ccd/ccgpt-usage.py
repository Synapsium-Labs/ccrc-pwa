#!/usr/bin/env python3
"""ccgpt-usage — publishes one ChatGPT/Codex lane's usage window into
`~/.cc-limits/<id>.json`, the same `{five, seven, ts, ...}` shape the
Anthropic accounts' statusline writer produces, so `ccd`'s swap logic and the
ccrc accounts strip get REAL gpt headroom instead of guessing from 429s.

Source: the Codex backend returns usage as `x-codex-*` RESPONSE HEADERS on
every `/responses` call (the same data the Codex CLI shows). This publisher
makes one minimal request and reads the headers directly — primary window
(weekly, 10080 min) publishes as `seven`; secondary (5h-style) publishes as
`five` only when its own window is active, else `five` is `null` (Codex Pro
is weekly-only for some plans, and a bogus "5h" derived from the weekly
figure would mislead a reader).

Ported from the production publisher this repository does not ship
(task-10-brief.md) as part of Plan 2a of the gpt-lane-ownership migration
(`docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §10).
**Three** things changed from that reference — corrected from "two" in fix
round 1 (task-10-fix-rulings.md I-2), which is when the third was noticed:

  1. The probe **model** is read from `~/.ccrc/codex/<id>/lane.json`
     (`_probe_model` below), never hard-coded — a model frozen into a
     publisher is a second model policy. `lane.json`'s writer is
     `deploy/models-op.mjs`'s materialiser (Plan 2b-1 Task 6), which every
     `ccrc models <id>` mutation runs, and which `ccrc doctor --fix` runs
     where doctor FAILs a lane's lane.json (Plan 3a Task 8). So this file
     reads the manifest if present, and REFUSES if it is absent or unusable,
     each refusal naming a remedy that works on this tree. Nothing here
     invents a default model.
  2. `CCGPT_ACCOUNT_ID`'s fallback to "the first lane" (the reference
     script's `${CCGPT_ACCOUNT_ID:-gpt}`) is REMOVED. An unnamed lane is an
     error, not lane one (task-10-brief.md) — see `_required_env`.
  3. The OAuth token directory is read from `lane.json`'s `authDir` field
     (`_token_dir` below), never re-derived from a naming convention. Fix
     round 1's task-10 I-2: the reference computes `$HOME/.handoff/chatgpt-auth[-<id>]`
     itself, but spec §5.4 line 333 says `lane.json` "is the one thing
     `ccgpt`, the shim and the publisher read, so none of them re-derives a
     path from a naming convention" — this file used to violate that
     sentence in a file that already opens `lane.json` two functions away.

**Five consumer-facing properties this file exists to keep** (task-10-brief.md's
own table, carried into `docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md`'s
Task 10; each has its own test in `server/test/ccgpt-usage.test.ts` and its
own mutation in that file's commit history):

  - Written with `json.dump`'s DEFAULT separators (`_publish`). *(Reason
    corrected in fix round 1, D-3159 — see that entry and
    `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §10's
    own correction: no shipped reader distinguishes a compact row from a
    spaced one today, since both `ccd`'s `_limit_json_num`/`_limit_has_key`
    match with `[[:space:]]*`, zero or more. The property is KEPT anyway —
    it matches the reference producer byte-for-byte and holds this file
    stable for a stricter future reader — but "a compact writer makes `ccd`
    read the lane as entirely unknown" was never true and is not repeated
    here.)*
  - `fiveResetAt`/`sevenResetAt` are emitted on EVERY poll, `null` included
    (`_build_row`) — `_limit_has_key` asks whether the keys exist at all;
    that presence is the only thing separating this row from the compact
    three-key 429-exclusion row `ccd` writes itself. Omitting a `null`
    renders a weekly cap as a five-hour cooldown.
  - ABSENT is not the same answer as ZERO for the secondary-window minutes
    (`_build_row`'s `five_window`) — `server/src/limits.ts` keeps
    `fiveWindowMinutes` only when present and reads an explicit `0` as "no
    5h window at all". Two readers share one rule and must not drift.
  - A 429 carrying the rate-limit headers IS a valid measurement, not a
    failed poll (`_fetch_headers`) — the headers are read off the error
    response and published. A REDIRECT status is never this, however its
    headers are dressed — see `_fetch_headers`'s own docstring, fix round
    1 task-10 C-1.
  - The write is ATOMIC: tmp-then-rename (`_publish`, `os.replace`) — a
    reader never sees a half-written row.

**The `CCGPT_USAGE_ENDPOINT` seam** (Task 1's decision, `_usage_endpoint`):
production configuration surface, honoured ONLY when it names a loopback
host. task-10-rulings.md (commit af7cc0bc) §1 OVERRULES the plan's own draft text, which had
asked for a non-loopback override to be silently "ignored" (i.e. fall
through to the real endpoint) — that would make a test suite pointed
somewhere unexpected capable of reaching the production Codex usage API. A
non-loopback override is refused outright instead. Costs nothing in
production, where the variable is unset and this check never fires.

**That refusal is necessary but not sufficient (task-10 fix round 1, C-1).** The
loopback check binds the FIRST hop only; `urlopen`'s default opener follows
redirects, so a vetted loopback endpoint answering `3xx` could send this
process anywhere, bearer token riding along, and a forged response from
that second hop would otherwise publish as a real measurement. `_fetch_headers`
below builds its own opener that refuses every redirect outright — see its
docstring.

**The interpreter (task-10 fix round 1, M-3).** The reference selects the LiteLLM
venv's own python (falling back to a bare `python3`) because the real
`litellm` package it hard-imports is virtualenv-installed, not on the
system interpreter. This file imported LiteLLM's `Authenticator` the same
way until codex-bridge Stage 1 Task 7, and the systemd unit's own `ExecStart`
runs it under the Codex runtime's interpreter, `-I`. It imports nothing of
LiteLLM now: the lane's credential is READ through ccrc's auth library (below),
which is standard library only, so any `python3` of 3.9 or later runs it.

**The credential is only read (codex-bridge Stage 1, Task 7; spec 2026-10-15
§2.6).** "In `litellm` mode LiteLLM, which ignores the lock, is the only
refresher and every other caller only reads." This poll loads
`ccd/ccgpt-auth.py` by its path, beside this file's own real path (under `-I`
a sibling module is not on `sys.path`), and calls only its readers: `read`,
`read_status`, `expired` and the pure `bars`. It never refreshes, never
takes the library's lock and never signs in. Each reading it cannot use is one
refusal line, remedy first, and nothing is published (`_require_logged_in`):
  - `absent`: `not-logged-in`, `ccrc codex login <id>`;
  - `incomplete`, or a needs-signin the tier recorded: `login-required`,
    `ccrc codex login <id>`;
  - `unreadable`, `foreign-family`: `credential-unusable`, `ccrc doctor`;
  - a config-error the tier recorded: `credential-unusable`, `ccrc update`
    then `ccrc codex login <id>`;
  - an expired access token: `token-expired`, none needed, because the
    lane's tier refreshes it on its next request;
  - a library that cannot be loaded: `auth-library-absent`, `ccrc update`.

**The direct arm (codex-bridge Stage 2, Task 14; spec 2026-10-15 §2.6's
table: "in `direct` mode reads the usage the bridge saw on real traffic and
asks upstream only when the lane is idle; sends the account id and
`originator: ccrc`").** On a lane whose `lane.json` names `bridge: "direct"`,
the bridge keeps the `x-codex-` values of its last upstream response in its
stats file (`usageHeaders`, `ccd/codexbridge/stats.py`), the file named by
`lane.json`'s `bridgeFiles.stats`. When that snapshot is at most
`BRIDGE_FRESH_S` old and carries the primary figure, this poll builds the row
from it (`_build_row`, the same five names) and publishes it with NO request,
no probe model and no credential read: the measurement is the bridge's, made on
the lane's own traffic. Any other stats file (absent, unreadable, another lane's
or version's, a stamp it cannot read or one in the future, no primary figure) is
no measurement, and the poll makes today's request instead, with
`originator: ccrc` (`_bridge_headers`). Only the exact word `direct` is the
direct arm: a `litellm` lane, and a lane.json from before the bridge (no
`bridge` key), poll exactly as before, `originator: codex_cli_rs` (D-6373).
This file stays the only writer of `~/.cc-limits/<id>.json`.
"""
import datetime
import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


# The real production endpoint. Never dialed by this wave's own test suite —
# every case in server/test/ccgpt-usage.test.ts binds its own loopback server
# on this suite's fixed port (task-10-fix-rulings.md M-1, commit f813102e).
# What varies between cases is not WHETHER a server is bound, but whether
# CCGPT_USAGE_ENDPOINT is pointed AT it: a case that expects the subject to
# refuse before ever making a request binds a server anyway and asserts it
# saw ZERO requests (task-10 M-7) — never merely that the subject exited non-zero —
# including the non-loopback-override case, whose bound server is
# deliberately NOT what CCGPT_USAGE_ENDPOINT names: it exists solely to
# prove the refusal doesn't reach THIS box's own mock either, not only the
# (unreachable-by-design) host actually named in the override.
# Task 11 (separate task, not this file's) pins this constant as the
# compiled-in default and hardens the loopback check against look-alike
# hosts.
DEFAULT_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"

# Deliberately a small, exact set — not a substring/prefix test. task-11's
# own plan text names the substring hazard directly: `'127.0.0.1' in url`
# would accept `https://127.0.0.1.evil.test` as loopback. Parsing the URL and
# comparing the resolved HOSTNAME (not the raw string) already refuses that
# look-alike, `http://example.com`, and a bare hostname with no scheme
# (`urlsplit` gives such a value no `.hostname` at all, which is not in this
# set either) — task-10 does not need Task 11's own dedicated look-alike
# case to get this right, since it is not testing a substring shortcut.
# NOTE: this check binds the FIRST hop only — see the module docstring's own
# task-10 fix-round-1 C-1 paragraph and `_fetch_headers`'s docstring for what closes
# the gap a hostname check alone cannot.
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

# The direct arm (module docstring): the bridge's `usageHeaders` snapshot is a
# measurement for this long after its stamp; past it, the lane is idle and this
# poll asks upstream itself. One poll period (the timer's 15 minutes).
BRIDGE_FRESH_S = 900
# A stats file larger than this is not read (the bridge's own load bound,
# `ccd/codexbridge/stats.py`'s READ_MAX, is the same 16 MiB).
_STATS_READ_MAX = 16 * 2**20
# The bridge's stamp, `_iso` in `ccd/codexbridge/stats.py`: ISO-8601 UTC with
# milliseconds.
_STATS_STAMP = "%Y-%m-%dT%H:%M:%S.%fZ"
# A file name `lane.json`'s `bridgeFiles` may carry, as the bridge itself
# checks it (`ccd/codexbridge/server.py`'s FILE_NAME_RE): never a path.
_FILE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
# The originator each mode's request sends: D-6373 for a litellm lane, D27 for
# a direct one (the bridge's own, `ccd/codexbridge/backend.py`'s ORIGINATOR).
_ORIGINATOR = {"litellm": "codex_cli_rs", "direct": "ccrc"}


def _required_env(name: str) -> str:
    """Read one required environment variable, or refuse to start naming it.

    `CCGPT_ACCOUNT_ID` is the only caller of this today — the reference
    script's `${CCGPT_ACCOUNT_ID:-gpt}` "first lane" fallback is REMOVED
    (task-10-brief.md's "one default that is removed", carried into
    `docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md`'s
    Task 10): an unnamed lane is
    an error, not lane one, because a template unit
    (`ccrc-codex-usage@<id>.timer`) always names its instance, and a publisher
    that guesses a lane when it is not told one can silently publish the
    wrong lane's row under an empty-string or missing id.
    """
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ccgpt-usage: refusing to publish — {name} is not set (no default lane)")
    return value


def _is_loopback(url: str) -> bool:
    """True iff `url` parses to a hostname in `_LOOPBACK_HOSTS`.

    A hostname EQUALITY check, not a substring test over the raw URL text —
    see the module-level comment on `_LOOPBACK_HOSTS` for why that
    distinction is the whole point of Task 11's own mutation. `urlsplit`
    never performs DNS resolution, so this check is a pure string parse: it
    cannot itself cause a network access, whatever it decides. It says
    nothing about where a REDIRECT from this URL might point — that is
    `_fetch_headers`'s `_NoRedirectHandler`'s job, not this function's.
    """
    try:
        host = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return False
    return host in _LOOPBACK_HOSTS


def _usage_endpoint() -> str:
    """The endpoint this run will poll: the compiled-in default, or
    `CCGPT_USAGE_ENDPOINT` when it is set AND loopback.

    task-10-rulings.md (commit af7cc0bc) §1: a non-loopback override REFUSES outright (exits
    non-zero, naming the variable and the value) rather than being silently
    ignored. The publisher sends a bearer token to whatever this function
    returns, so a non-loopback override is a credential-redirection hazard,
    not a harmless no-op — "ignored" would mean "falls through to the real
    endpoint," which is not safe to make silent.
    """
    override = os.environ.get("CCGPT_USAGE_ENDPOINT")
    if not override:
        return DEFAULT_USAGE_ENDPOINT
    if not _is_loopback(override):
        sys.exit(
            "ccgpt-usage: refusing to publish — CCGPT_USAGE_ENDPOINT is not a "
            f"loopback URL: {override!r}"
        )
    return override


# task-10 M-4 (task-10-fix-rulings.md, commit 4893935a): every module-scope statement above this line
# validates ccrc's OWN configuration (env vars, the endpoint) and needs no
# third-party package at all. The `litellm` import this file carried was placed
# AFTER these two assignments run, deliberately — with it at the top of the file
# (its original position), an unset CCGPT_ACCOUNT_ID on a box with no
# `litellm` installed surfaced as a raw `ImportError` instead of this file's
# own named refusal. That import is gone (codex-bridge Stage 1, Task 7), and the
# auth library that replaced it is loaded in `main`, after these refusals too.
ACCOUNT_ID = _required_env("CCGPT_ACCOUNT_ID")
USAGE_ENDPOINT = _usage_endpoint()

# HOME-following, exactly as the reference script's LIMITS_DIR was
# (task-10-brief.md: "it already follows HOME, so the output assertions
# port unchanged" —
# `docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md`'s
# Task 10 "Reference" line) — `os.path.expanduser` resolves against this process's
# own `HOME`, the fixture HOME under test, never the operator's real one.
LIMITS_DIR = os.path.join(os.path.expanduser("~"), ".cc-limits")

# `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §5.4:
# "lane manifest | `~/.ccrc/codex/<id>/lane.json` (generated, no secrets)".
# task-10 M-5 (task-10-fix-rulings.md): named LANE_MANIFEST_PATH, not LANE_PATH —
# `ccd/ccgpt-proxy.py`'s own `LANE_PATH` is a DIFFERENT thing, the HTTP
# route `/ccgpt/lane` its shim answers on, and the two files sit side by
# side in the same directory.
LANE_MANIFEST_PATH = os.path.join(os.path.expanduser("~"), ".ccrc", "codex", ACCOUNT_ID, "lane.json")

# ── the auth library (codex-bridge Stage 1, Task 7) ──
# The one library that reads and writes a Codex lane's credential, placed
# beside this file (`~/.local/bin/ccgpt-auth.py`, the fifth GPT-lane file).
# Loaded by PATH, from this file's own real path: the unit runs this file under
# `-I`, where neither the script's directory nor PYTHONPATH is on `sys.path`.
AUTH_LIBRARY_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), "ccgpt-auth.py")


def _refuse(word: str, remedy: str, why: str) -> None:
    """One refusal line, remedy first: `ccgpt-usage: <word>: <remedy> — <why>; nothing was published`, rc 1. `why`
    never carries a token: the library's `detail` sentences name paths and states only."""
    sys.exit(f"ccgpt-usage: {word}: {remedy} — {why}; nothing was published")


def _load_auth_library():
    """The auth library, loaded from `AUTH_LIBRARY_PATH`, or the `auth-library-absent` refusal.

    `sys.dont_write_bytecode` is held for the load, so no `__pycache__` lands in `~/.local/bin`. Any failure to load
    (no file, a file that does not import, one without the readers this poll calls) is the one refusal, naming the
    exception's class and never its arguments."""
    import importlib.util
    was = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("ccgpt_auth", AUTH_LIBRARY_PATH)
        if spec is None or spec.loader is None:
            raise ImportError("no loader")
        lib = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = lib
        spec.loader.exec_module(lib)
        for name in ("read", "read_status", "expired", "bars"):
            getattr(lib, name)
        return lib
    except (Exception, SystemExit) as e:
        sys.modules.pop("ccgpt_auth", None)
        _refuse("auth-library-absent", "run ccrc update",
                f"ccrc's auth library {AUTH_LIBRARY_PATH} could not be loaded ({type(e).__name__}), so lane "
                f"{ACCOUNT_ID}'s credential cannot be read")
    finally:
        sys.dont_write_bytecode = was
# ── end the auth library ──


def _read_lane() -> dict:
    """Read and parse `~/.ccrc/codex/<id>/lane.json` once — the single read
    both `_probe_model` and `_token_dir` work from (task-10-fix-rulings.md
    I-2, commit 4893935a: `_token_dir` used to re-derive its own path from a naming
    convention in a file that already opens this same file two functions
    away — read once, here, instead).

    `lane.json` is written by `deploy/models-op.mjs`'s materialiser, which
    every `ccrc models <id>` mutation runs (Plan 2b-1 Task 6), and which
    `ccrc doctor --fix` runs where doctor FAILs a lane's lane.json (Plan 3a
    Task 8). The behaviour for the file itself: read it if present and
    well-formed, and REFUSE if it is absent or not valid JSON. The absent
    refusal names both acts that render it — `ccrc doctor --fix`, and, for a
    lane with no class registry yet, `ccrc models <id> init codex` (settling
    task-10-rulings.md (commit 4893935a) §4's deferral). Per-field validation
    (a present-but-wrong-shape `probeModel`/`authDir`) happens at each
    field's own reader below, and each names a remedy that works today.
    """
    try:
        with open(LANE_MANIFEST_PATH, "r") as f:
            raw = f.read()
    except OSError:
        sys.exit(
            f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} does not exist; "
            f"run `ccrc doctor --fix` (no class registry yet: `ccrc models {ACCOUNT_ID} init codex`)"
        )
    try:
        lane = json.loads(raw)
    except ValueError as e:
        sys.exit(f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} is not valid JSON: {e}")
    if not isinstance(lane, dict):
        sys.exit(f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} is not a JSON object")
    return lane


def _probe_model(lane: dict) -> str:
    """The model this poll probes with, read from `lane.json`'s
    `probeModel` field — never a hard-coded id (task-10-brief.md: "a model
    frozen into a publisher is a second model policy" — carried into
    `docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md`'s
    Task 10).

    The remedy names `ccrc models <id> set-class haiku <modelId>`, not
    `ccrc doctor --fix` (Plan 2b-1 Task 6 fix round 1, T2): the manifest's
    writer (`deploy/models-op.mjs`'s `laneManifest`) takes `probeModel` from
    the lane's haiku class and OMITS it when that class is unassigned, so any
    re-render (`ccrc models`' own, or `ccrc doctor --fix`'s) reproduces it, and
    assigning haiku is the one act that cures it (that verb re-renders
    lane.json as it goes). The ABSENT-file refusal in `_read_lane` keeps its
    own remedy.
    """
    model = lane.get("probeModel")
    if not isinstance(model, str) or not model:
        sys.exit(
            f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} carries no usable "
            f"probeModel; run `ccrc models {ACCOUNT_ID} set-class haiku <modelId>` "
            "to assign this lane's haiku class"
        )
    return model


def _token_dir(lane: dict) -> str:
    """This lane's OAuth token directory, read from `lane.json`'s `authDir`
    field — never re-derived from a naming convention
    (task-10-fix-rulings.md I-2; spec §5.4 line 333: `lane.json` "is the
    one thing `ccgpt`, the shim and the publisher read, so none of them
    re-derives a path from a naming convention"). The first draft of this
    file computed `$HOME/.handoff/chatgpt-auth-<id>` itself instead — a
    real behaviour change from the reference too, since the reference's
    `""`-suffix special case for the bare lane id `gpt` was dropped along
    with the "first lane" default it served, and the review measured that
    one live lane's token directory would silently move to a directory
    that does not exist. Reading `authDir` here removes the spec violation
    and the silent move at once.

    `authDir` is validated `$HOME`-relative by the roster (spec §4.1: no
    leading `/`, no `..`), so joining it onto `os.path.expanduser("~")`
    reproduces the directory the roster itself named. No environment-variable
    override, unlike the dropped derivation's `CHATGPT_TOKEN_DIR` fallback —
    the same "one source of truth" reasoning `probeModel` has always had.

    The remedy names a `ccrc models` mutation, not `ccrc doctor --fix`: the
    materialiser copies `authDir` from the roster's `exec.authDir` on every
    mutation, so any one of them re-renders a manifest that lost it — and a
    roster whose codex row has no `exec.authDir` is refused by that same verb,
    naming the field. `ccrc doctor --fix` re-renders it too (Plan 3a Task 8).
    """
    auth_dir = lane.get("authDir")
    if not isinstance(auth_dir, str) or not auth_dir:
        sys.exit(
            f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} carries no usable "
            f"authDir; re-render it from the roster's exec.authDir by running any "
            f"`ccrc models {ACCOUNT_ID}` mutation, e.g. "
            f"`ccrc models {ACCOUNT_ID} set-class haiku <modelId>`"
        )
    return os.path.join(os.path.expanduser("~"), auth_dir)


def _require_logged_in(lib, token_dir: str):
    """The lane's credential, READ through the auth library, or this poll's refusal (codex-bridge Stage 1, Task 7).

    The pre-check the reference bash wrapper made before ever invoking Python
    (task-10-fix-rulings.md I-3, commit 4893935a) was existence only. The
    library decides absence now, and every other reading too, and this poll
    only reads: `read` (which never writes, locks or touches the network),
    the status the lane's tier recorded for this credential (`read_status`,
    current only while the credential is the one it was measured on, so a
    fresh sign-in clears it), and `expired`. It never refreshes: in litellm
    mode the lane's tier is the only refresher, and a refresh token is single
    use.

    The not-logged-in message names the TOKEN DIRECTORY, which only THIS
    publisher knows because only this publisher computed it (from
    `lane.json`'s `authDir`, `_token_dir` above), so an operator has a path to
    act on. A needs-signin bars before the expiry, so a dead credential is
    never answered `token-expired`; a config-error bars only when it was
    measured under the library's current OAuth configuration. Whether a
    status bars is the library's own rule, asked through `bars` (D-6692),
    which its refresher keeps too.
    """
    r = lib.read(token_dir)
    login = f"run ccrc codex login {ACCOUNT_ID}"
    if r.credential == "absent":
        _refuse("not-logged-in", login, f"lane {ACCOUNT_ID} is not logged in ({token_dir})")
    if r.credential in ("unreadable", "foreign-family"):
        _refuse("credential-unusable", "run ccrc doctor", r.detail)
    if r.credential != "present":
        _refuse("login-required", login, f"lane {ACCOUNT_ID} holds no usable token ({r.detail}), and this "
                "unattended poll never starts a sign-in")
    status = lib.read_status(token_dir)
    # Whether the status bars is the library's one rule (`bars`, D-6692); this
    # poll only picks the refusal's words.
    if lib.bars(status) and status.get("state") == "needs-signin":
        _refuse("login-required", login, f"lane {ACCOUNT_ID}'s tier recorded that its credential needs a sign-in, "
                "and this unattended poll never starts one")
    if lib.bars(status):
        _refuse("credential-unusable", f"run ccrc update, then ccrc codex login {ACCOUNT_ID}",
                "the token endpoint refused ccrc's OAuth client when the lane's tier last refreshed, and a sign-in "
                "alone does not cure it")
    if lib.expired(r):
        _refuse("token-expired", "none needed", "the lane's tier refreshes it on its next request; if its refresh "
                "token is dead, that request records needs-signin")
    return r


def _num(headers, name: str, default: int = 0) -> int:
    """Read `name` off `headers` as an int, or `default` for absent/empty/
    non-integral — the same permissive reading the reference script uses for
    every `x-codex-*-used-percent`/`-reset-at` header. Absence here is a
    reasonable "no measurement" default for a USED-PERCENT value (0%), but
    NOT for the secondary-window-minutes field, which is why that one is
    read separately in `_build_row` rather than through this helper — see
    the property-3 comment there.
    """
    try:
        return int(headers.get(name, default))
    except (TypeError, ValueError):
        return default


def _measured(headers) -> bool:
    """Whether `headers` (a response's, or the bridge's snapshot) carry the
    primary usage figure, without which nothing they say is a measurement: the
    one test both sources pass before `_build_row` reads them."""
    return headers.get("x-codex-primary-used-percent") is not None


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuses every redirect outright (task-10-fix-rulings.md C-1, commit 4893935a):
    `redirect_request` returning `None` makes CPython's own
    `HTTPRedirectHandler` raise `HTTPError` carrying the ORIGINAL response's
    status and headers, rather than following `Location` anywhere. Covers
    every redirect status this handler's parent class recognises — 301,
    302, 303, 307, and (CPython >= 3.11) 308 — through the one method they
    all funnel through, not a per-status override.

    This publisher's endpoint has no legitimate reason to redirect at all.
    `urlopen`'s DEFAULT opener follows redirects, and the review measured
    the consequence directly: a loopback mock answering `302` sent the
    child to an arbitrary second host, `Authorization: Bearer …` riding
    along verbatim, and that host's forged `x-codex-*` headers were
    published as a real measurement. Re-validating each hop's loopback-ness
    and stripping `Authorization` across a host change was considered and
    rejected — refusing outright is simpler, and there is no legitimate
    redirect this endpoint should ever send for that extra machinery to
    preserve.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirectHandler)

# Redirect-class statuses are never a valid measurement, however their
# headers are dressed (task-10-fix-rulings.md C-1's "widens the hazard"
# note, commit 4893935a — see `_NoRedirectHandler`'s docstring above):
# with redirects refused, a 3xx becomes an ordinary `HTTPError`, and
# `_fetch_headers`'s broad "any HTTPError carrying the usage header is
# valid" carve-out would otherwise publish a FIRST hop's own forged 3xx
# response too, with no second hop needing to be followed at all. Excluded
# outright, whatever the headers claim.
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def _fetch_headers(model: str, token: str, account_id=None, originator: str = _ORIGINATOR["litellm"]):
    """Make one minimal probe request and return the response headers —
    from a normal 200, or from a 429 that still carries the usage headers
    (task-10 property 4).

    Sent through `_OPENER`, whose `_NoRedirectHandler` refuses every
    redirect (task-10-fix-rulings.md C-1) — see that class's own docstring.
    Sends six headers, seven with the account id: this file's OWN
    `content-type`/`accept` for its POST body, plus the same FOUR-header identity block the in-tree
    reference sends (`ccd/ccrc-models-probe`'s own `headers = {...}` dict,
    below its `account_id` read — a GET with neither `content-type` nor
    `accept`, so those two are not part of what is "matched" here) —
    `Authorization`, `originator`, `user-agent`, `session_id` — restored in
    fix round 1 (task-10 C-2, D-3160) after this file's port had dropped everything but
    `Authorization`. `ccd/ccrc-models-probe` documents that block as "what
    the backend expects from a real Codex CLI caller"; dropping it risked
    the backend answering with no usage headers at all, which is exactly
    the "ccd reads the lane as unknown" condition this file exists to
    remove.

    The reference sends a FIFTH identity header beyond those four,
    `ChatGPT-Account-Id`. This file dropped it under D-3160: the ownership
    spec's §9 forbade reading an OAuth file's CONTENTS anywhere in ccrc
    ("existence and mode only"), so the publisher could not derive the
    backend's per-workspace account id, and `lane.json`'s own `id` is ccrc's
    lane name, the WRONG value under this header. That rule changed with
    codex-bridge Stage 1 (spec 2026-10-15 §2.6, D15): exactly one ccrc library,
    `ccd/ccgpt-auth.py`, reads the credential, and its reading carries
    `account_id` (the file's, else the `chatgpt_account_id` claim of the id
    token, then of the access token). So the header is sent now, when the
    reading has one (`account_id`), as LiteLLM's own tier sends it, which
    disambiguates a token valid across several workspaces; with none it is
    omitted, as before. `originator` is the caller's: `codex_cli_rs` on a
    `litellm` lane (D-6373), and ccrc's own `ccrc` on a `direct` lane, whose
    bridge owns the request identity (codex-bridge D27, Stage 2 Task 14).

    Any OTHER failure — no usage header at all (auth failure, a 5xx, a
    malformed response), or any redirect status regardless of its headers
    (`_REDIRECT_STATUSES`) — re-raises: a probe that learned nothing must
    not publish a number. The non-redirect half of this rule is the
    reference script's own documented incident: letting an HTTPError with
    usage headers escape uncaught once froze a lane's row at `seven=97`
    (one point under `ccd`'s swap ceiling) for twelve hours, because the
    poll that would have corrected it kept dying instead of publishing the
    100% it actually measured.
    """
    body = json.dumps({
        "model": model,
        "instructions": "reply ok",
        "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "ok"}]}],
        "stream": True,
        "store": False,
    }).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "content-type": "application/json",
        "accept": "text/event-stream",
        "originator": originator,
        "user-agent": "codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown",
        "session_id": "00000000-0000-0000-0000-000000000000",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id
    req = urllib.request.Request(USAGE_ENDPOINT, data=body, headers=headers)
    try:
        resp = _OPENER.open(req, timeout=30)
        h = resp.headers
        resp.close()
    except urllib.error.HTTPError as e:
        h = e.headers
        if e.code in _REDIRECT_STATUSES or not _measured(h):
            raise
        e.close()
    return h


def _lane_mode(lane: dict) -> str:
    """`direct` when `lane.json` names exactly that mode, else `litellm`.

    Not `_codex_lane_mode`'s refusal (`ccd/ccrc`): that reader chooses tiers and
    must not guess. This poll only chooses where a measurement comes from, and
    every value but the exact word `direct` (`litellm`, a lane.json from before
    the bridge with no `bridge` key, a word this build does not know) keeps
    today's poll exactly, so no reading of this key can stop a lane publishing.
    """
    return "direct" if lane.get("bridge") == "direct" else "litellm"


def _bridge_headers(lane: dict):
    """The `x-codex-` values the lane's bridge last saw, as a dict of lower-cased
    header names to their string values, when its stats file holds a usable
    snapshot at most `BRIDGE_FRESH_S` old; else None, and the caller asks upstream.

    The file is `lane.json`'s `bridgeFiles.stats`, a plain file name in the lane
    directory (never a path, as the bridge checks it). It is read without
    following a symlink, only when it is a regular file, and at most
    `_STATS_READ_MAX` bytes. A usable snapshot is the bridge's version-1
    document for THIS lane whose `usageHeaders` has a stamp in `_STATS_STAMP`'s
    form that is not in the future and a `values` object of string values that
    carries the primary figure (`_measured`): as `_fetch_headers` refuses a
    response without it, a snapshot without it is no measurement, and
    `_build_row` would publish a `seven` of 0 nobody measured. Never raises: every
    other file is None.
    """
    files = lane.get("bridgeFiles")
    name = files.get("stats") if isinstance(files, dict) else None
    if not isinstance(name, str) or not _FILE_NAME_RE.fullmatch(name):
        return None
    path = os.path.join(os.path.dirname(LANE_MANIFEST_PATH), name)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        with os.fdopen(fd, "rb", closefd=False) as f:
            raw = f.read(_STATS_READ_MAX + 1)
        if len(raw) > _STATS_READ_MAX:
            return None
        doc = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, RecursionError):  # UnicodeDecodeError and JSONDecodeError are ValueErrors
        return None
    finally:
        os.close(fd)
    if not isinstance(doc, dict) or doc.get("version") != 1 or doc.get("lane") != ACCOUNT_ID:
        return None
    snap = doc.get("usageHeaders")
    if not isinstance(snap, dict):
        return None
    at, values = snap.get("at"), snap.get("values")
    if not isinstance(at, str) or not isinstance(values, dict):
        return None
    try:
        stamp = datetime.datetime.strptime(at, _STATS_STAMP).replace(tzinfo=datetime.timezone.utc).timestamp()
    except (ValueError, OverflowError, OSError):
        return None
    age = time.time() - stamp
    if not 0 <= age <= BRIDGE_FRESH_S:
        return None
    if not all(isinstance(k, str) and isinstance(v, str) for k, v in values.items()):
        return None
    if not _measured(values):
        return None
    return values


def _build_row(headers) -> dict:
    """Turn the probe's response headers into the row this file publishes.

    `seven` is always the primary (weekly, 10080min) figure. `five` mirrors
    the secondary figure only when the secondary window is genuinely active
    (`sec_window > 0`); otherwise `five` is `null` — a lane with no 5h
    window at all must not report a bogus "5h" that is really the weekly
    number.

    Property 3 — ABSENT is not ZERO for `x-codex-secondary-window-minutes`
    — is why `five_window` is read directly off the header (not through
    `_num`, whose `default=0` would erase the distinction) and carried as a
    literal `None` for "header truly absent or unparseable" versus an
    explicit `0` for "header present and says zero". `server/src/limits.ts`
    keeps `fiveWindowMinutes` only when present in the JSON at all and
    reads an explicit `0` as "this plan has no 5h window"; folding absence
    into 0 here would assert that fact on evidence nobody produced, and a
    lane whose 5h window really is 100% but was polled while this header
    happened to be missing would score as the emptiest lane on the fleet.

    Property 2 — `fiveResetAt`/`sevenResetAt` are ALWAYS emitted, `null`
    included — is why both keys are written into `out` unconditionally,
    never omitted for a `None` value; `_limit_has_key` (`ccd/ccd`) reads
    presence, not value, to tell this row apart from the compact three-key
    429-exclusion row `ccd` writes itself.
    """
    primary = _num(headers, "x-codex-primary-used-percent")
    secondary = _num(headers, "x-codex-secondary-used-percent")

    raw_window = headers.get("x-codex-secondary-window-minutes")
    try:
        five_window = None if raw_window is None else int(raw_window)
    except (TypeError, ValueError):
        five_window = None
    sec_window = five_window if five_window is not None else 0

    prim_reset = _num(headers, "x-codex-primary-reset-at") or None
    sec_reset = _num(headers, "x-codex-secondary-reset-at") or None

    seven, seven_reset = primary, prim_reset
    if sec_window > 0:
        five, five_reset = secondary, sec_reset
    else:
        five, five_reset = None, None

    out = {
        "five": five,
        "seven": seven,
        "ts": int(time.time()),
        "fiveResetAt": five_reset,
        "sevenResetAt": seven_reset,
    }
    # Property 3, the other half: the key itself is only WRITTEN when the
    # header was genuinely present and parsed — never defaulted to 0 by its
    # own absence. See this function's own docstring above.
    if five_window is not None:
        out["fiveWindowMinutes"] = five_window
    return out


def _publish(out: dict) -> None:
    """Write `out` to `~/.cc-limits/<ACCOUNT_ID>.json` — atomically
    (task-10 property 5: tmp-then-rename via `os.replace`, never a direct
    `open(target, "w")`) and with `json.dump`'s DEFAULT separators. *(The
    reason stated here used to be "so `ccd`'s `_limit_json_num` can read the
    row" — measurably false, D-3159, fix round 1: that grep tolerates
    whitespace after the colon with `[[:space:]]*`, zero OR MORE, so a
    compact row reads identically. The property is kept — it matches the
    reference producer byte-for-byte and holds this file stable for a
    stricter future reader — the false reason is simply not repeated here.)*

    `os.replace` succeeds over a target that is itself read-only, because
    replacing a directory entry is a permission the DIRECTORY grants, not
    the file being replaced — the deterministic discriminator
    task-10-rulings.md (commit af7cc0bc) §2 gives for pinning this property without a timing
    race (verified empirically before relying on it here: see the report).
    A direct `open(target, "w")`, by contrast, needs WRITE permission on
    the file itself and raises `PermissionError` against the same
    fixture — which is exactly what the atomicity test in
    `server/test/ccgpt-usage.test.ts` exploits.
    """
    os.makedirs(LIMITS_DIR, exist_ok=True)
    tmp = os.path.join(LIMITS_DIR, "." + ACCOUNT_ID + ".tmp")
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, os.path.join(LIMITS_DIR, ACCOUNT_ID + ".json"))


def main() -> None:
    lane = _read_lane()
    mode = _lane_mode(lane)
    if mode == "direct":
        # The direct arm (module docstring): the bridge's own measurement, with no request, no probe model and no
        # credential read, when it is fresh.
        seen = _bridge_headers(lane)
        if seen is not None:
            out = _build_row(seen)
            _publish(out)
            print(f"ccgpt-usage: {ACCOUNT_ID} {out['five']}%/5h {out['seven']}%/7d (from the bridge's headers)")
            return
    model = _probe_model(lane)
    token_dir = _token_dir(lane)
    # Read, never refreshed (codex-bridge Stage 1, Task 7): see `_require_logged_in`. The token is a fixture's
    # synthetic one in every test. This file never stores or logs a credential, and no refusal formats one.
    reading = _require_logged_in(_load_auth_library(), token_dir)
    headers = _fetch_headers(model, reading.access_token, reading.account_id, _ORIGINATOR[mode])
    out = _build_row(headers)
    _publish(out)
    print(f"ccgpt-usage: {ACCOUNT_ID} {out['five']}%/5h {out['seven']}%/7d")


if __name__ == "__main__":
    main()
