"""codexbridge.liveprobe — the first live step's six tiny requests, sent by the operator one at a time.

Codex-bridge spec 2026-10-15 §5 ("the first live step") and D27 ("Send `originator: ccrc`"); plan 2026-10-22, Task
18 and the operator runbook's step 2. Run as a file under `-I`, never by an agent unless the operator says so:

    python3 -I <tree>/ccd/codexbridge/liveprobe.py --lane <id> --step <1-6> [--dry-run]

THE STEPS (the runbook's list), each one request built the way the bridge builds one (`inbound.from_anthropic`, then
`backend.build_body`, always without `instructions`, whatever the lane's `bridge-instructions` marker says), with
`originator: ccrc`, the bridge's User-Agent, effort EFFORT and one session id per lane, so steps 1 and 5 share their
`session-id` and `prompt_cache_key`:
  1. a one-word reply;
  2. two parallel calls of one top-level tool (`parallel_tool_calls: true`);
  3. step 2's round trip: the reply in step 2's latest recording sent back with each call under a `toolu_`-shaped id
     and a result for each, its reasoning items replayed where the bridge's store would put them (before the block
     that followed each);
  4. a turn's first request: the user message, then a developer message after it;
  5. step 1 again;
  6. step 3 with each reasoning item sent without its `rs_` id (the runbook's "with and without its rs_ id"). Re-running
     a step that failed for a reason not about the request is that step again, counted like any other.

THE BOUNDS. Nothing is read or sent unless the lane directory holds the operator's ALLOW_MARKER (no writer in the
tree). The credential is read with Stage 1's `read` ONLY, and an expired access token refuses `token-expired`: the
probe runs while the lane is on `litellm`, whose LiteLLM is the lane's one refresher, so the probe never refreshes.
The lane's requests are counted in COUNT_FILE, raised BEFORE each request is sent, and past PROBE_MAX nothing is
sent. `--dry-run` prints the body it would send, and reads no credential, counts nothing and sends nothing.

WHAT IT PRINTS (stdout, one `liveprobe: ` line each): the status, the upstream request id (bounded), every response
header NAME, every event type, every finished item's type, the terminal's `end_turn` and its numeric usage fields;
never a header value, a text, an id or an encrypted content. The answer is recorded raw, head and body, in the lane's
recordings directory as `liveprobe-<step>-<utc>-<n>.sse` (0600, directory 0700; `n` the request's count, so a bridge
recording's cap never counts it), for the operator to scrub into the corpus (`record.py scrub`) in a reviewed change.
A refusal is one stderr line, `liveprobe: refused <word>: <sentence>`; any other failure before the send is
`liveprobe: failed <class>; nothing was sent`, and one after it `liveprobe: transport <class>`: an exception is named
by its class only, never its text (http.client formats a header value it refuses with %r). Exit 0 answered 2xx, 1
refused or failed (nothing sent), 2 usage, 3 attempted and counted but not answered 2xx: the count is raised before
the post, so a request that never left (a header http.client refuses in putheader, before endheaders writes a byte; a
refused connection) is charged too.

The CLI runs only under `__main__` (the block below), so importing the module through `load_all()` does nothing.
"""

if __name__ == "__main__":  # run as a file under -I: the package's parent goes first on sys.path, nothing else
    import os as _os
    import sys as _sys

    _sys.dont_write_bytecode = True
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    from codexbridge import liveprobe as _liveprobe

    _sys.exit(_liveprobe.main(_sys.argv[1:]))

import hashlib
import os
import re
import sys
import time
import uuid
from typing import Callable, Dict, List, NamedTuple, Optional, Tuple

from . import ListSink, backend, errors, inbound, record, reducer, server, sse, stats, stream

PROBE_MAX = 6
ALLOW_MARKER = "liveprobe-allowed"
COUNT_FILE = "liveprobe.count"
STEPS = (1, 2, 3, 4, 5, 6)
EFFORT = "low"
DEFAULT_AUTH_LIB = os.path.join("~", ".local", "bin", "ccgpt-auth.py")  # the contract's CCRC_CODEX_AUTH_LIB
PREFIX = "liveprobe: "

SYSTEM = "You are a terse assistant used to check a connection."
ONE_WORD = "Reply with the single word: ok"
TWO_CALLS = "Call probe_echo twice in parallel: once with the word one, and once with the word two."
LATE_DEVELOPER = "Answer in lower case."
TOOL = {"name": "probe_echo", "description": "Echo one word back.",
        "input_schema": {"type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"]}}
TOOL_RESULT = "done"
TOOLU_PREFIX = "toolu_01"

_STEP2_RE = re.compile(r"^liveprobe-2-([0-9]{8}T[0-9]{6}Z)-([0-9]{1,3})\.sse$")
_TERMINALS = ("response.completed", "response.incomplete", "response.failed")


class Refused(Exception):
    """A refusal before anything is sent: a word, and a sentence naming the remedy, never a value."""

    def __init__(self, word: str, sentence: str) -> None:
        super().__init__(word)
        self.word = word
        self.sentence = sentence


class LaneFiles(NamedTuple):
    lane: str
    lane_dir: str
    auth_dir: str
    rec_dir: str
    catalogue: str
    session: str


def _out(line: str) -> None:
    sys.stdout.write(PREFIX + line + "\n")


def _name(value: object) -> str:
    """A name as the probe may print it: itself under the stats file's NAME_RE, else `unrecognised`."""
    return value if isinstance(value, str) and stats.NAME_RE.fullmatch(value) else errors.UNRECOGNISED_CODE


# ── the lane ─────────────────────────────────────────────────────────────────────────────────────────────────────
def lane_files(lane: str) -> LaneFiles:
    """The lane's directory, which must hold ALLOW_MARKER before anything else is read, then its `lane.json`."""
    home = os.path.expanduser("~")
    # Spelled here, not received: the bridge gets this path as CCGPT_LANE_DIR from ccd/ccrc's bridge environment, and
    # deploy/models-op.mjs's laneManifest writes the lane.json in it, but the probe is an operator CLI run with no tier
    # environment, so it has no owner to receive the path from.
    lane_dir = os.path.join(home, ".ccrc", "codex", lane)
    if not os.path.exists(os.path.join(lane_dir, ALLOW_MARKER)):
        raise Refused("no-marker", "the lane directory holds no " + ALLOW_MARKER + " marker; the operator touches it "
                      "for the first live step and removes it after")
    try:
        manifest = server.read_manifest(home, lane_dir, lane)  # the bridge's own reader, so the two read it alike
    except server.ManifestError as e:
        if e.kind == "unknown":
            raise Refused("lane-unknown", "the lane's lane.json is missing, not JSON or names another lane; run "
                          "'ccrc update'")
        raise Refused("lane-malformed", "the lane's lane.json is out of shape at " + e.field + "; run 'ccrc update'")
    session = str(uuid.uuid5(uuid.NAMESPACE_URL, "ccrc-liveprobe:" + lane))
    # The catalogue's path is spelled here for the same reason: the bridge receives it as CCGPT_CATALOGUE (ccd/ccrc).
    return LaneFiles(lane, lane_dir, manifest.auth_dir, os.path.join(lane_dir, manifest.files.recordings),
                     os.path.join(home, ".ccrc", "models", lane + ".json"), session)


def read_count(lane_dir: str) -> int:
    try:
        with open(os.path.join(lane_dir, COUNT_FILE), "rb") as f:
            text = f.read(64).decode("ascii", "replace").strip()
    except FileNotFoundError:
        return 0
    except OSError:
        raise Refused("count-unreadable", COUNT_FILE + " cannot be read; the operator decides what it should read")
    if not (text.isascii() and text.isdigit()):
        raise Refused("count-unreadable", COUNT_FILE + " does not hold a whole number; the operator decides what it "
                      "should read")
    return int(text)


def write_count(lane_dir: str, n: int) -> None:
    """`n` into COUNT_FILE (0600), beside itself then renamed over itself."""
    path = os.path.join(lane_dir, COUNT_FILE)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, ("%d\n" % n).encode("ascii"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)


# ── the requests ─────────────────────────────────────────────────────────────────────────────────────────────────
def _body(model: str, messages: List[dict], tools: Optional[List[dict]] = None) -> dict:
    body = {"model": model, "system": SYSTEM, "messages": messages, "reasoning": {"effort": EFFORT},
            "stream": True}  # type: Dict[str, object]
    if tools:
        body["tools"] = tools
    return body


def toolu_id(call_id: str) -> str:
    """A `toolu_`-shaped id for an upstream call id: the same call always gets the same one."""
    return TOOLU_PREFIX + hashlib.sha256(call_id.encode("utf-8", "replace")).hexdigest()[:22]


def _latest_step2(rec_dir: str) -> bytes:
    try:
        found = [m for m in (_STEP2_RE.fullmatch(n) for n in os.listdir(rec_dir)) if m]
    except OSError:
        found = []
    if not found:
        raise Refused("step-2-first", "no recording of step 2 in the lane's recordings directory; run --step 2 first")
    latest = max(found, key=lambda m: (m.group(1), int(m.group(2))))
    try:
        with open(os.path.join(rec_dir, latest.group(0)), "rb") as f:
            return f.read()
    except OSError:
        raise Refused("step-2-first", "the latest recording of step 2 cannot be read; run --step 2 again")


def round_trip(files: LaneFiles, model: str, keep_ids: bool) -> Tuple[List[dict], Callable[[str], Optional[dict]]]:
    """Step 3's (or 6's) messages, and the lookup that replays step 2's reasoning: the reply of step 2's latest
    recording, read by the bridge's own reducer, sent back under `toolu_`-shaped ids with a result for each call."""
    status, raw = record.split_head(_latest_step2(files.rec_dir))
    if status is None or not 200 <= status < 300:
        raise Refused("step-2-first", "the latest recording of step 2 is not a 2xx answer; run --step 2 again")
    first = [{"role": "user", "content": TWO_CALLS}]
    req = inbound.from_anthropic(_body(model, first, [TOOL]), {}, names=ListSink())
    red = reducer.Reducer(name_map=req.name_map, names=ListSink(), tools_required=req.tools_required)
    parser = sse.SseParser()
    events = []  # type: List[Tuple[str, dict]]
    for ev in parser.feed(raw) + parser.close():
        red.feed(ev)
        events.extend(red.release())
        if red.terminal is not None:
            break
    red.finish()
    events.extend(red.release())
    content = stream.fold(events)["content"]
    calls = [b for b in content if b.get("type") == "tool_use"]
    if not calls:
        raise Refused("step-2-first", "the latest recording of step 2 holds no tool call; run --step 2 again")
    ids = {b["id"]: toolu_id(b["id"]) for b in calls}
    assistant = []  # type: List[dict]
    for b in content:
        if b.get("type") == "tool_use":
            assistant.append({"type": "tool_use", "id": ids[b["id"]], "name": b.get("name"), "input": b.get("input")})
        elif b.get("type") == "text" and b.get("text"):
            assistant.append({"type": "text", "text": b["text"]})
    results = [{"type": "tool_result", "tool_use_id": ids[b["id"]], "content": TOOL_RESULT} for b in calls]
    turns = {}  # type: Dict[str, dict]
    for item, keyed in red.reasoning:
        if keyed is None:
            continue
        kind, value = keyed
        if kind == "call" and value in ids:
            key = inbound.call_key(ids[value])
        elif kind == "text":
            key = inbound.text_key(files.session, value)
        else:
            continue
        replay = dict(item)
        if not keep_ids:
            replay.pop("id", None)
        turns.setdefault(key, {"items": [], "phase": None})["items"].append(replay)
    for text, phase in red.phases.items():
        turns.setdefault(inbound.text_key(files.session, text), {"items": [], "phase": None})["phase"] = phase
    return first + [{"role": "assistant", "content": assistant}, {"role": "user", "content": results}], turns.get


def request_for(step: int, files: LaneFiles) -> inbound.NeutralRequest:
    """The step's request, as the bridge would build it from Claude Code's body."""
    ids = server.catalogue_ids(files.catalogue)
    if not ids:
        raise Refused("no-catalogue", "the lane catalogue is absent, unreadable or empty; run 'ccrc models "
                      + files.lane + " refresh'")
    model = ids[0]
    lookup = lambda key: None  # type: Callable[[str], Optional[dict]]  # noqa: E731
    tools = None  # type: Optional[List[dict]]
    if step in (1, 5):
        messages = [{"role": "user", "content": ONE_WORD}]  # type: List[dict]
    elif step == 2:
        messages, tools = [{"role": "user", "content": TWO_CALLS}], [TOOL]
    elif step == 4:
        messages = [{"role": "user", "content": ONE_WORD}, {"role": "system", "content": LATE_DEVELOPER}]
    else:
        messages, lookup = round_trip(files, model, keep_ids=step == 3)
        tools = [TOOL]
    return inbound.from_anthropic(_body(model, messages, tools), {inbound.SESSION_HEADER: files.session},
                                  names=ListSink(), lookup=lookup)


def wire_body(req: inbound.NeutralRequest) -> bytes:
    """The Responses body, never in the `instructions` form."""
    return backend.encode_body(backend.build_body(req, instructions_form=False))


# ── the credential ───────────────────────────────────────────────────────────────────────────────────────────────
def credential(files: LaneFiles) -> object:
    """Stage 1's `read` of the lane's credential, never a refresh: an absent or expired token refuses."""
    path = os.environ.get("CCRC_CODEX_AUTH_LIB") or os.path.expanduser(DEFAULT_AUTH_LIB)
    try:
        lib = server.load_auth_lib(path)
    except Exception:
        raise Refused(errors.AUTH_LIBRARY_ABSENT, server.AUTH_LIBRARY_REMEDY)
    r = lib.read(files.auth_dir)  # type: ignore[attr-defined]
    if r.credential != "present":
        raise Refused("no-credential", "the lane's credential reads " + _name(r.credential) + "; see 'ccrc codex "
                      "status " + files.lane + "'")
    if lib.expired(r):  # type: ignore[attr-defined]
        raise Refused("token-expired", "the lane's access token has expired, and the probe never refreshes it (the "
                      "lane's LiteLLM does); run the step once the lane has refreshed it")
    return r


# ── the answer ───────────────────────────────────────────────────────────────────────────────────────────────────
def _usage_lines(usage: object, path: str = "") -> List[str]:
    out = []  # type: List[str]
    if not isinstance(usage, dict):
        return out
    for key, value in usage.items():
        name = path + _name(key)
        if isinstance(value, dict):
            out.extend(_usage_lines(value, name + "."))
        elif isinstance(value, int) and not isinstance(value, bool):
            out.append("usage %s %d" % (name, value))
    return out


def report(up: backend.Upstream, rec: Optional[record.Recording]) -> int:
    """Read the whole answer into the recording and print its names (the module docstring); 0 for a 2xx."""
    _out("status %d" % up.status)
    _out("request-id " + (errors.request_id_of(up.headers) or "none"))
    for name in up.headers:
        _out("header " + _name(name))
    ok = 200 <= up.status < 300
    parser = sse.SseParser()
    terminal = None  # type: Optional[dict]
    size = 0
    try:
        for chunk in up.chunks:
            if rec is not None:
                rec.write(chunk)
            size += len(chunk)
            if not ok:
                if size >= backend.ERROR_BODY_MAX:
                    break
                continue
            for ev in parser.feed(chunk):
                terminal = _event(ev, terminal)
        if ok:
            for ev in parser.close():
                terminal = _event(ev, terminal)
    except backend.UpstreamTimeout as e:
        _out("transport timeout-" + _name(e.phase))
        ok = False
    except Exception as e:  # its class only: an exception's text can carry a value. Kept apart from main's catch below,
        # so a terminal seen before the failure is still reported (the mid-stream case pins it)
        _out("transport " + _name(type(e).__name__))
        ok = False
    if terminal is not None or ok:
        response = (terminal or {}).get("response")
        response = response if isinstance(response, dict) else {}
        end_turn = response.get("end_turn")
        _out("end_turn " + ("true" if end_turn is True else "false" if end_turn is False else "absent"))
        for line in _usage_lines(response.get("usage")):
            _out(line)
    return 0 if ok else 3


def _event(ev: sse.SseEvent, terminal: Optional[dict]) -> Optional[dict]:
    _out("event " + _name(ev.type))
    data = ev.data if isinstance(ev.data, dict) else {}
    if ev.type == "response.output_item.done":
        item = data.get("item")
        _out("item " + _name(item.get("type") if isinstance(item, dict) else None))
    if ev.type in _TERMINALS:
        return data
    return terminal


# ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
USAGE = "usage: liveprobe.py --lane <id> --step <1-6> [--dry-run]"


def parse(argv: List[str]) -> Optional[Tuple[str, int, bool]]:
    lane, step, dry = None, None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--dry-run":
            dry = True
            i += 1
        elif a in ("--lane", "--step") and i + 1 < len(argv):
            v = argv[i + 1]
            if a == "--lane":
                lane = v
            elif v.isascii() and v.isdigit():
                step = int(v)
            i += 2
        else:
            return None
    if lane is None or not server.LANE_RE.fullmatch(lane) or step not in STEPS:
        return None
    return lane, step, dry  # type: ignore[return-value]


def main(argv: List[str]) -> int:
    args = parse(argv)
    if args is None:
        sys.stderr.write(PREFIX + USAGE + "\n")
        return 2
    lane, step, dry = args
    try:
        files = lane_files(lane)
        count = read_count(files.lane_dir)
        if count >= PROBE_MAX:
            raise Refused("count-exhausted", "the lane's %d live requests are spent; the operator rules on any more"
                          % PROBE_MAX)
        body = wire_body(request_for(step, files))
        if dry:
            sys.stdout.write(body.decode("utf-8") + "\n")
            return 0
        try:
            base = backend.upstream_base(os.environ)
        except ValueError:
            raise Refused("bad-upstream-base", backend.UPSTREAM_BASE_ENV + " must be an http:// URL on a loopback "
                          "host; unset it for the default endpoint")
        reading = credential(files)
        ua = backend.user_agent(os.environ.get("CCGPT_CCRC_VERSION") or "dev")
        headers = backend.headers_for(reading, files.session, ua)
        n = count + 1
        write_count(files.lane_dir, n)  # raised before the request is sent, so a request that dies still counts
    except Refused as r:
        sys.stderr.write(PREFIX + "refused " + r.word + ": " + r.sentence + "\n")
        return 1
    except Exception as e:  # its class only: an exception's text can carry a value (nothing has been sent)
        sys.stderr.write(PREFIX + "failed " + _name(type(e).__name__) + "; nothing was sent\n")
        return 1
    try:
        up = backend.post(base, body, headers)
    except backend.UpstreamTimeout as e:
        _out("transport timeout-" + _name(e.phase))
        return 3
    except Exception as e:  # its class only: http.client formats a header it refuses with %r, the token's included
        _out("transport " + _name(type(e).__name__))
        return 3
    rec = None  # type: Optional[record.Recording]
    try:
        if record.ensure_dir(files.rec_dir):
            name = "liveprobe-%d-%s-%d.sse" % (step, time.strftime(record.UTC_FORMAT, time.gmtime()), n)
            rec = record.open_file(files.rec_dir, name)
        if rec is not None:
            rec.write(record.head(up.status, up.headers))
        return report(up, rec)
    except Exception as e:  # its class only, as above: a failure recording the answer, or in report() outside its
        # own catch (the recording-failure case pins it)
        _out("transport " + _name(type(e).__name__))
        return 3
    finally:
        if rec is not None:
            rec.close()
        up.close()
