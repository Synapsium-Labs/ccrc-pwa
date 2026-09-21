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
(`docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §10). Two
things changed from that reference, both load-bearing and both described in
that spec section:

  1. The probe **model** is read from `~/.ccrc/codex/<id>/lane.json`
     (`_probe_model` below), never hard-coded — a model frozen into a
     publisher is a second model policy. `lane.json` has no writer until
     Plan 2b, so this wave's behaviour is: read it if present, and if absent
     REFUSE naming the remedy that renders it (`ccrc doctor --fix` — spec
     §12's `--fix` table: "re-render `lane.json` and the LiteLLM config").
     Nothing here invents a default model.
  2. `CCGPT_ACCOUNT_ID`'s fallback to "the first lane" (the reference
     script's `${CCGPT_ACCOUNT_ID:-gpt}`) is REMOVED. An unnamed lane is an
     error, not lane one (task-10-brief.md) — see `_required_env`.

**Five consumer-facing properties this file exists to keep** (task-10-brief.md's
own table; each has its own test in `server/test/ccgpt-usage.test.ts` and its
own mutation in that file's commit history):

  - Written with `json.dump`'s DEFAULT separators (`_publish`) — `ccd`'s
    `_limit_json_num` greps with a pattern that tolerates whitespace after
    the colon *because* this producer writes `": "`. A compact writer makes
    `ccd` read the lane as entirely unknown.
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
    response and published.
  - The write is ATOMIC: tmp-then-rename (`_publish`, `os.replace`) — a
    reader never sees a half-written row.

**The `CCGPT_USAGE_ENDPOINT` seam** (Task 1's decision, `_usage_endpoint`):
production configuration surface, honoured ONLY when it names a loopback
host. task-10-rulings.md §1 OVERRULES the plan's own draft text, which had
asked for a non-loopback override to be silently "ignored" (i.e. fall
through to the real endpoint) — that would make a test suite pointed
somewhere unexpected capable of reaching the production Codex usage API. A
non-loopback override is refused outright instead: loud, and impossible for
any test in this wave to reach the network by accident. Costs nothing in
production, where the variable is unset and this check never fires.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from litellm.llms.chatgpt.authenticator import Authenticator


# The real production endpoint. Never dialed by this wave's own test suite —
# every case in server/test/ccgpt-usage.test.ts points CCGPT_USAGE_ENDPOINT
# at a loopback server it binds itself (task-10-rulings.md §1's hard
# constraint). Task 11 (separate task, not this file's) pins this constant
# as the compiled-in default and hardens the loopback check against
# look-alike hosts.
DEFAULT_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"

# Deliberately a small, exact set — not a substring/prefix test. task-11's
# own plan text names the substring hazard directly: `'127.0.0.1' in url`
# would accept `https://127.0.0.1.evil.test` as loopback. Parsing the URL and
# comparing the resolved HOSTNAME (not the raw string) already refuses that
# look-alike, `http://example.com`, and a bare hostname with no scheme
# (`urlsplit` gives such a value no `.hostname` at all, which is not in this
# set either) — task-10 does not need Task 11's own dedicated look-alike
# case to get this right, since it is not testing a substring shortcut.
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _required_env(name: str) -> str:
    """Read one required environment variable, or refuse to start naming it.

    `CCGPT_ACCOUNT_ID` is the only caller of this today — the reference
    script's `${CCGPT_ACCOUNT_ID:-gpt}` "first lane" fallback is REMOVED
    (task-10-brief.md's "one default that is removed"): an unnamed lane is
    an error, not lane one, because a template unit
    (`ccgpt-usage@<id>.timer`) always names its instance, and a publisher
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
    cannot itself cause a network access, whatever it decides.
    """
    try:
        host = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return False
    return host in _LOOPBACK_HOSTS


def _usage_endpoint() -> str:
    """The endpoint this run will poll: the compiled-in default, or
    `CCGPT_USAGE_ENDPOINT` when it is set AND loopback.

    task-10-rulings.md §1: a non-loopback override REFUSES outright (exits
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


ACCOUNT_ID = _required_env("CCGPT_ACCOUNT_ID")
USAGE_ENDPOINT = _usage_endpoint()

# HOME-following, exactly as the reference script's LIMITS_DIR was
# (task-10-brief.md: "it already follows HOME, so the output assertions
# port unchanged") — `os.path.expanduser` resolves against this process's
# own `HOME`, the fixture HOME under test, never the operator's real one.
LIMITS_DIR = os.path.join(os.path.expanduser("~"), ".cc-limits")

# `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §5.4:
# "lane manifest | `~/.ccrc/codex/<id>/lane.json` (generated, no secrets)".
LANE_PATH = os.path.join(os.path.expanduser("~"), ".ccrc", "codex", ACCOUNT_ID, "lane.json")


def _probe_model() -> str:
    """The model this poll probes with, read from `lane.json`'s
    `probeModel` field — never a hard-coded id (task-10-brief.md: "a model
    frozen into a publisher is a second model policy").

    `lane.json` has no writer until Plan 2b (task-10-brief.md), so this
    wave's behaviour is exactly what the brief asks for: read it if
    present, and if it is absent, unreadable or carries no usable
    `probeModel`, REFUSE naming a remedy an operator can actually type.

    task-10-rulings.md §4: the remedy names `ccrc doctor --fix`, not an
    invented verb. Per the design spec (§5.4, "written by the same
    materialiser that writes the lane's model files,
    `deploy/models-op.mjs`, atomically tmp-then-rename") and §12's `--fix`
    table ("`--fix` may: … regenerate a marker-verified launcher, re-render
    `lane.json` and the LiteLLM config …"), `ccrc doctor --fix` is the one
    user-facing verb that actually re-renders this file — `deploy/models-op.mjs`
    is a deploy-time module, not something an operator invokes directly, so
    naming the materialiser itself (as the rulings' fallback instructs when
    no real verb exists) would hand back a command that fails when typed.
    `ccrc doctor --fix` is real and does the job, so it is named directly.
    """
    try:
        with open(LANE_PATH, "r") as f:
            raw = f.read()
    except OSError:
        sys.exit(
            f"ccgpt-usage: refusing to publish — {LANE_PATH} does not exist; "
            "run `ccrc doctor --fix` to render it"
        )
    try:
        lane = json.loads(raw)
    except ValueError as e:
        sys.exit(f"ccgpt-usage: refusing to publish — {LANE_PATH} is not valid JSON: {e}")
    model = lane.get("probeModel") if isinstance(lane, dict) else None
    if not isinstance(model, str) or not model:
        sys.exit(
            f"ccgpt-usage: refusing to publish — {LANE_PATH} carries no usable "
            "probeModel; run `ccrc doctor --fix` to render it"
        )
    return model


def _token_dir() -> str:
    """Where this lane's ChatGPT OAuth credential lives, HOME-relative and
    keyed by the (now mandatory, never defaulted — see `_required_env`)
    lane id. `CHATGPT_TOKEN_DIR`, when the caller already set it, wins
    outright; nothing here overrides an explicit value. The reference
    script special-cased the bare id `gpt` to carry no suffix at all (a
    relic of the single-lane era); that special case is dropped along with
    the "first lane" default it served — every lane, `gpt` included, now
    gets the same `-<id>` suffix, consistent with "an unnamed lane is an
    error, not lane one" applying to every lane equally.
    """
    return os.environ.get("CHATGPT_TOKEN_DIR") or os.path.join(
        os.path.expanduser("~"), ".handoff", f"chatgpt-auth-{ACCOUNT_ID}"
    )


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


def _fetch_headers(model: str, token: str):
    """Make one minimal probe request and return the response headers —
    from a normal 200, or from a 429 that still carries the usage headers
    (task-10 property 4).

    Any OTHER failure — no usage header at all (auth failure, a 5xx, a
    malformed response) — re-raises: a probe that learned nothing must not
    publish a number. This is the reference script's own documented
    incident: letting an HTTPError with usage headers escape uncaught once
    froze a lane's row at `seven=97` (one point under `ccd`'s swap ceiling)
    for twelve hours, because the poll that would have corrected it kept
    dying instead of publishing the 100% it actually measured.
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
    }
    req = urllib.request.Request(USAGE_ENDPOINT, data=body, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        h = resp.headers
        resp.close()
    except urllib.error.HTTPError as e:
        h = e.headers
        if h.get("x-codex-primary-used-percent") is None:
            raise
        e.close()
    return h


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
    `open(target, "w")`) and with `json.dump`'s DEFAULT separators
    (task-10 property 1: never `separators=(',', ':')` — `ccd`'s
    `_limit_json_num` greps with a pattern that tolerates whitespace after
    the colon *because* this producer writes `": "`).

    `os.replace` succeeds over a target that is itself read-only, because
    replacing a directory entry is a permission the DIRECTORY grants, not
    the file being replaced — the deterministic discriminator
    task-10-rulings.md §2 gives for pinning this property without a timing
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
    model = _probe_model()
    os.environ.setdefault("CHATGPT_TOKEN_DIR", _token_dir())
    # Authenticator refreshes the access token if it has expired. Stubbed in
    # every test in this wave (server/test/fixtures/pystub, Task 1) to
    # return a fixed non-secret string — this file never sees, stores or
    # logs a real credential either way.
    token = Authenticator().get_access_token()
    headers = _fetch_headers(model, token)
    out = _build_row(headers)
    _publish(out)
    print(f"ccgpt-usage: {ACCOUNT_ID} {out['five']}%/5h {out['seven']}%/7d")


if __name__ == "__main__":
    main()
