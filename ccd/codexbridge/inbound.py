"""codexbridge.inbound — an Anthropic request becomes a neutral request.

Codex-bridge spec 2026-10-15 §2.3 (request translation) and §2.5 (the reasoning store's keys); plan 2026-10-22,
Task 2 and "The bridge's contract": the neutral request; D-6417 (no `clear_tool_uses`), D-6425 (`output_config.format`
becomes the Responses `text.format`), D-6426 (the sampling fields are dropped on the backend route too), D-6427 (an
image counts a fixed IMAGE_TOKENS).

`from_anthropic` maps every field of a Claude Code `/v1/messages` body to the Responses side, or drops it on purpose
and reports its NAME to the NameSink. A value is never reported, logged or put in an error message: an error message
names a block or tool type only, bounded by `errors.CODE_RE`.

THE ORDER OF THE ITEMS. The developer message (the top-level system text) is `items[0]` when there is one; the
backend adapter (Task 7) moves it to `instructions` when the lane's `bridge-instructions` marker is set. Every other
item keeps its place in the conversation. A stored turn's reasoning items are re-inserted just before the block whose
key they were stored under (Task 4's `remember`: the key of the FIRST item the upstream emitted after them), so a
replayed turn keeps the upstream's order: reasoning, message, reasoning, call. A key's reasoning is re-inserted once,
before the LATEST block carrying it, because a store row under a repeated text holds the latest turn's reasoning; its
`phase` is replayed on every message carrying that text.
Codex sends its own history in the order it recorded it and moves no item (upstream openai/codex @ 092d3ac:
codex-rs/core/src/session/turn.rs:1641-1650, codex-rs/core/src/context_manager/history.rs:600-613, 963-977).

THE COUNT. `countable_bytes` is the UTF-8 length of the compact JSON of {developer, items, tools} as sent, with the
developer text counted once (not again as `items[0]`), each `input_image`'s `image_url` emptied, and the dropped
blocks (thinking and its signature, `cache_control`, the billing line) absent because they are never sent. D24's
estimate adds `image_count` x IMAGE_TOKENS (Task 5). `count_tokens` runs this same translation (Task 8).
"""

import hashlib
import json
import uuid
from typing import Callable, Dict, FrozenSet, List, Mapping, NamedTuple, Optional, Tuple

from . import NameSink, errors

BILLING_PREFIX = "x-anthropic-billing-header:"
COMPACTION_MARKER = "CRITICAL: Respond with TEXT ONLY"
IMAGE_TOKENS = 1600

NAME_MAX = 64
CUT_KEEP = 55
CUT_HASH = 8

SESSION_HEADER = "x-claude-code-session-id"
AGENT_HEADER = "x-claude-code-agent-id"
BETA_HEADER = "anthropic-beta"

DEFERRED_PLACEHOLDER = "DeferredToolPlaceholder"
OUTPUT_SCHEMA_NAME = "ccrc_output_schema"
TOOL_LOADED = "Tool loaded: "

# The top-level keys inbound reads. Every other key is dropped and its name counted `requestField:<name>`: the
# sampling fields (`max_tokens`, `temperature`, `top_p`, `top_k`, `stop_sequences`), `metadata`, `service_tier`,
# `mcp_servers`, `container`, a `thinking` the effort hook left, and anything unknown (D-6426).
READ_KEYS = frozenset({
    "model", "messages", "system", "tools", "tool_choice", "stream", "reasoning", "output_config",
    "context_management",
})

# The block types of a message and of a tool result that inbound maps; any other is refused (a plain 400 naming it).
_DOCUMENT = "document"
_CUSTOM_TOOL_TYPES = (None, "custom")

_TOOL_CHOICE = {"auto": "auto", "any": "required", "none": "none"}


class NeutralRequest(NamedTuple):
    """The request the backend adapter builds a Responses body from (the plan's "The neutral request")."""
    model: str
    developer: Optional[str]
    items: List[dict]
    tools: List[dict]
    name_map: Dict[str, str]
    tool_choice: object
    parallel_tool_calls: bool
    effort: Optional[str]
    output_format: Optional[dict]
    cache_key: str
    session_id: Optional[str]
    stream: bool
    compaction: bool
    countable_bytes: int
    image_count: int
    tools_required: FrozenSet[str]


# ── the keys and the names ───────────────────────────────────────────────────────────────────────────────────────
def cut_name(name: str) -> str:
    """A tool name the upstream accepts: unchanged at NAME_MAX characters or fewer, else its first CUT_KEEP
    characters, `_` and the first CUT_HASH hex of its sha256, so two long names sharing a prefix stay distinct and
    the same name always cuts the same way (the reverse map is rebuilt from each request's own tool list)."""
    if len(name) <= NAME_MAX:
        return name
    return name[:CUT_KEEP] + "_" + hashlib.sha256(name.encode("utf-8", "surrogatepass")).hexdigest()[:CUT_HASH]


def cache_key(session_id: Optional[str], agent_id: Optional[str]) -> str:
    """The `prompt_cache_key`: `ccrc:<session>`, or `ccrc:<session>:<agent>` for a subagent; a fresh
    `ccrc:anon-<uuid4>` when there is no session id."""
    if not session_id:
        return "ccrc:anon-" + str(uuid.uuid4())
    return "ccrc:" + session_id + ((":" + agent_id) if agent_id else "")


def text_key(session_id: Optional[str], text: str) -> str:
    """The reasoning store's key for an assistant text: a hash scoped to the session, so two sessions' equal replies
    never share reasoning. The key holds no text."""
    raw = ((session_id or "") + "\0" + text).encode("utf-8", "surrogatepass")
    return "text:" + hashlib.sha256(raw).hexdigest()


def call_key(call_id: str) -> str:
    """The reasoning store's key for a tool call."""
    return "call:" + call_id


# ── the refusals ─────────────────────────────────────────────────────────────────────────────────────────────────
def _shown(value: object) -> str:
    """A type as an error message may name it: lower-cased under errors.CODE_RE, else `unrecognised`."""
    if isinstance(value, str):
        lowered = value.lower()
        if errors.CODE_RE.fullmatch(lowered):
            return lowered
    return errors.UNRECOGNISED_CODE


def _malformed(what: str) -> errors.BridgeError:
    return errors.BridgeError(400, errors.INVALID_REQUEST, "malformed request: " + what, kind="refused")


def _unsupported(what: str, value: object, names: NameSink) -> errors.BridgeError:
    """A type Claude Code's capability classes do not cover (a server tool, an unknown block): a plain 400 naming it,
    never retried, since a retry sends the same thing."""
    names.name("unsupportedField", value if isinstance(value, str) else errors.UNRECOGNISED_CODE)
    return errors.BridgeError(400, errors.INVALID_REQUEST, "unsupported %s: %s" % (what, _shown(value)),
                              dict(errors.NO_RETRY), kind="refused")


# ── headers ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _header_values(headers: Mapping[str, str], name: str) -> List[str]:
    """Every value of one header: `get_all` on an http.client message (case-insensitive already), else a
    case-insensitive scan of a plain mapping."""
    get_all = getattr(headers, "get_all", None)
    if get_all is not None:
        return [v for v in (get_all(name) or []) if isinstance(v, str)]
    out = []
    for k, v in getattr(headers, "items", lambda: [])():
        if isinstance(k, str) and k.lower() == name and isinstance(v, str):
            out.append(v)
    return out


def _header(headers: Mapping[str, str], name: str) -> Optional[str]:
    values = _header_values(headers, name)
    if not values:
        return None
    value = values[0].strip()
    return value or None


# ── content ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _texts(content: object, what: str) -> List[str]:
    """The non-empty texts of a string or a list of blocks (a system value, a system entry): text blocks only."""
    if isinstance(content, str):
        return [content] if content else []
    if not isinstance(content, list):
        raise _malformed(what)
    return [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text"
            and isinstance(b.get("text"), str) and b["text"]]


def _drop_billing(text: str) -> str:
    """A text without its billing line: Claude Code's first system block is `x-anthropic-billing-header: …;`, whose
    suffix varies between requests and would break the prefix cache. Only the block's FIRST line is removed: the
    rest of a block (or of a string system value) that starts with the billing line is kept, so no system text after
    it is lost (D-TBD-inbound-billing-first-line)."""
    if not text.startswith(BILLING_PREFIX):
        return text
    newline = text.find("\n")
    return "" if newline < 0 else text[newline + 1:].lstrip("\n")


def _developer(system: object) -> Optional[str]:
    if system is None:
        return None
    parts = [t for t in (_drop_billing(t) for t in _texts(system, "system")) if t]
    return "\n\n".join(parts) if parts else None


def _developer_item(text: str) -> dict:
    return {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": text}]}


def _image(block: dict, names: NameSink) -> dict:
    source = block.get("source")
    if isinstance(source, dict):
        kind = source.get("type")
        if kind == "base64":
            if isinstance(source.get("data"), str) and isinstance(source.get("media_type"), str):
                url = "data:" + source["media_type"] + ";base64," + source["data"]
                return {"type": "input_image", "image_url": url, "detail": "auto"}
            raise _malformed("an image block's base64 source is incomplete")
        if kind == "url":
            if isinstance(source.get("url"), str):
                return {"type": "input_image", "image_url": source["url"], "detail": "auto"}
            raise _malformed("an image block's url source has no url")
        raise _unsupported("image source", "image." + kind if isinstance(kind, str) else None, names)
    raise _malformed("an image block has no source")


def _input_part(block: object, names: NameSink, *, in_tool_result: bool) -> Optional[dict]:
    """One user-side block as a Responses input part (`input_text`, `input_image`), or None for an empty text."""
    if not isinstance(block, dict):
        raise _malformed("a content block is not an object")
    kind = block.get("type")
    if kind == "text":
        text = block.get("text")
        if not isinstance(text, str):
            raise _malformed("a text block has no text")
        return {"type": "input_text", "text": text} if text else None
    if kind == "image":
        return _image(block, names)
    if in_tool_result and kind == "tool_reference":
        name = block.get("tool_name", block.get("name"))
        if not isinstance(name, str):
            raise _malformed("a tool_reference block has no tool name")
        return {"type": "input_text", "text": TOOL_LOADED + name}
    if kind == _DOCUMENT:
        names.name("unsupportedField", _DOCUMENT)
        raise errors.capability("document_block", "")
    raise _unsupported("content block", kind, names)


def _tool_output(content: object, names: NameSink) -> object:
    """A tool result's content: a string stays a string; a list of blocks is a list of input parts; nothing is ``.
    No size cap: Claude Code already bounds what it sends."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        raise _malformed("a tool_result's content is neither text nor blocks")
    parts = [p for p in (_input_part(b, names, in_tool_result=True) for b in content) if p is not None]
    return parts if parts else ""


class _Translation:
    """One request's message walk: the items, in order, and what the walk counted along the way."""

    def __init__(self, names: NameSink, lookup: Callable[[str], Optional[dict]], session_id: Optional[str]) -> None:
        self.names = names
        self.lookup = lookup
        self.session_id = session_id
        self.items = []  # type: List[dict]
        self.last_at = {}  # type: Dict[str, int]  (store key -> the index of the latest block carrying it)
        self.turns = {}  # type: Dict[str, Optional[dict]]

    def _stored(self, key: str) -> Optional[dict]:
        """The stored turn under `key`, asked of the store once per request."""
        if key not in self.turns:
            turn = self.lookup(key)
            self.turns[key] = turn if isinstance(turn, dict) else None
        return self.turns[key]

    def _reasoning(self, key: str, at: int, turn: Optional[dict]) -> None:
        """The turn's reasoning items, when `at` is the latest block carrying `key`."""
        if turn is None or self.last_at.get(key) != at:
            return
        stored = turn.get("items")
        if isinstance(stored, list):
            self.items.extend(item for item in stored if isinstance(item, dict))

    @staticmethod
    def _blocks(content: object, what: str) -> List[object]:
        if isinstance(content, str):
            return [{"type": "text", "text": content}] if content else []
        if not isinstance(content, list):
            raise _malformed(what)
        return content

    def plan(self, messages: List[object]) -> None:
        """First pass: the latest position of every store key, so a repeated key replays once, at its latest. A
        position counts keyed blocks only (a non-empty text, a tool_use), exactly as `_assistant` counts them."""
        at = 0
        for m in messages:
            if not isinstance(m, dict) or m.get("role") != "assistant":
                continue
            for block in self._blocks(m.get("content"), "an assistant message's content"):
                key = self._key(block)
                if key is not None:
                    self.last_at[key] = at
                    at += 1

    def _key(self, block: object) -> Optional[str]:
        if not isinstance(block, dict):
            return None
        if block.get("type") == "text" and isinstance(block.get("text"), str) and block["text"]:
            return text_key(self.session_id, block["text"])
        if block.get("type") == "tool_use" and isinstance(block.get("id"), str):
            return call_key(block["id"])
        return None

    def walk(self, messages: List[object]) -> None:
        self.plan(messages)
        at = 0
        for m in messages:
            if not isinstance(m, dict):
                raise _malformed("a message is not an object")
            role = m.get("role")
            if role == "system":
                texts = _texts(m.get("content"), "a system entry's content")
                if texts:
                    self.items.append({"type": "message", "role": "developer",
                                       "content": [{"type": "input_text", "text": t} for t in texts]})
            elif role == "user":
                self._user(m.get("content"))
            elif role == "assistant":
                at = self._assistant(m.get("content"), at)
            else:
                raise _malformed("a message role is not user, assistant or system")

    def _user(self, content: object) -> None:
        parts = []  # type: List[dict]

        def flush() -> None:
            if parts:
                self.items.append({"type": "message", "role": "user", "content": list(parts)})
                del parts[:]

        for block in self._blocks(content, "a user message's content"):
            if isinstance(block, dict) and block.get("type") == "tool_result":
                flush()
                call_id = block.get("tool_use_id")
                if not isinstance(call_id, str):
                    raise _malformed("a tool_result has no tool_use_id")
                if "is_error" in block:
                    self.names.name("requestField", "is_error")
                self.items.append({"type": "function_call_output", "call_id": call_id,
                                   "output": _tool_output(block.get("content"), self.names)})
                continue
            part = _input_part(block, self.names, in_tool_result=False)
            if part is not None:
                parts.append(part)
        flush()

    def _assistant(self, content: object, at: int) -> int:
        for block in self._blocks(content, "an assistant message's content"):
            if not isinstance(block, dict):
                raise _malformed("a content block is not an object")
            kind = block.get("type")
            if kind in ("thinking", "redacted_thinking"):
                self.names.name("requestField", "thinking-block")
                continue
            if kind == "text":
                text = block.get("text")
                if not isinstance(text, str):
                    raise _malformed("a text block has no text")
                if not text:
                    continue
                key = text_key(self.session_id, text)
                turn = self._stored(key)
                self._reasoning(key, at, turn)
                at += 1
                item = {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}
                phase = turn.get("phase") if turn is not None else None
                if isinstance(phase, str) and phase:
                    item["phase"] = phase
                self.items.append(item)
                continue
            if kind == "tool_use":
                call_id, name = block.get("id"), block.get("name")
                if not isinstance(call_id, str) or not isinstance(name, str):
                    raise _malformed("a tool_use has no id or name")
                key = call_key(call_id)
                self._reasoning(key, at, self._stored(key))
                at += 1
                arguments = json.dumps(block.get("input", {}), separators=(",", ":"), ensure_ascii=False)
                self.items.append({"type": "function_call", "call_id": call_id, "name": cut_name(name),
                                   "arguments": arguments})
                continue
            raise _unsupported("content block", kind, self.names)
        return at


# ── the request's other fields ───────────────────────────────────────────────────────────────────────────────────
def _tools(tools: object, names: NameSink) -> Tuple[List[dict], Dict[str, str], FrozenSet[str]]:
    if tools is None:
        return [], {}, frozenset()
    if not isinstance(tools, list):
        raise _malformed("tools is not a list")
    out = []  # type: List[dict]
    name_map = {}  # type: Dict[str, str]
    required = set()
    for tool in tools:
        if not isinstance(tool, dict):
            raise _malformed("a tool is not an object")
        kind = tool.get("type")
        if kind not in _CUSTOM_TOOL_TYPES:
            raise _unsupported("server tool", kind, names)
        name = tool.get("name")
        if not isinstance(name, str) or not name:
            raise _malformed("a tool has no name")
        if "defer_loading" in tool:
            names.name("requestField", "defer_loading")
        if name == DEFERRED_PLACEHOLDER:
            continue
        schema = tool.get("input_schema")
        if not isinstance(schema, dict):
            schema = {"type": "object", "properties": {}}
        description = tool.get("description")
        cut = cut_name(name)
        name_map[cut] = name
        out.append({"type": "function", "name": cut, "description": description if isinstance(description, str)
                    else "", "parameters": schema, "strict": False})
        req = schema.get("required")
        if isinstance(req, list) and req:
            required.add(cut)
    return out, name_map, frozenset(required)


def _tool_choice(choice: object, names: NameSink) -> Tuple[object, bool]:
    """(tool_choice, parallel_tool_calls). Claude Code 2.1.308 never sends one; the default is Codex's plain path:
    no choice (the adapter sends `auto`) and parallel calls on."""
    if choice is None:
        return None, True
    if not isinstance(choice, dict):
        names.name("requestField", "tool_choice")
        return None, True
    parallel = not bool(choice.get("disable_parallel_tool_use", False))
    kind = choice.get("type")
    if kind in _TOOL_CHOICE:
        return _TOOL_CHOICE[kind], parallel
    if kind == "tool" and isinstance(choice.get("name"), str):
        return {"type": "function", "name": cut_name(choice["name"])}, parallel
    names.name("requestField", "tool_choice")
    return None, parallel


def _output_format(output_config: object, names: NameSink) -> Optional[dict]:
    """`output_config.format` json_schema becomes the Responses `text.format`, in Codex's own shape (upstream
    openai/codex @ 092d3ac: codex-rs/codex-api/src/common.rs:196-223, 392-410; D-6425). `effort` is the effort
    hook's; every other key is dropped and counted."""
    if output_config is None:
        return None
    if not isinstance(output_config, dict):
        names.name("requestField", "output_config")
        return None
    result = None
    for key in output_config:
        if key == "effort":
            continue
        if key == "format":
            fmt = output_config["format"]
            if not (isinstance(fmt, dict) and fmt.get("type") == "json_schema" and isinstance(fmt.get("schema"),
                                                                                                dict)):
                names.name("unsupportedField", "output_config.format")
                raise errors.capability("structured_outputs_unsupported", "")
            names.name("requestField", "output_config.format")
            result = {"type": "json_schema", "strict": True, "schema": fmt["schema"], "name": OUTPUT_SCHEMA_NAME}
            continue
        names.name("requestField", "output_config." + key if isinstance(key, str) else "output_config")
    return result


def _compaction(messages: List[object]) -> bool:
    """True when the LAST user turn holds Claude Code's compaction marker."""
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            content = m.get("content")
            if isinstance(content, str):
                return COMPACTION_MARKER in content
            if isinstance(content, list):
                return any(isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
                           and COMPACTION_MARKER in b["text"] for b in content)
            return False
    return False


def _counted(value: object) -> object:
    """A copy of what is sent with every `input_image`'s `image_url` emptied."""
    if isinstance(value, list):
        return [_counted(v) for v in value]
    if isinstance(value, dict):
        if value.get("type") == "input_image":
            return {k: ("" if k == "image_url" else v) for k, v in value.items()}
        return {k: _counted(v) for k, v in value.items()}
    return value


def _images(value: object) -> int:
    if isinstance(value, list):
        return sum(_images(v) for v in value)
    if isinstance(value, dict):
        own = 1 if value.get("type") == "input_image" else 0
        return own + sum(_images(v) for v in value.values())
    return 0


# ── the entry ────────────────────────────────────────────────────────────────────────────────────────────────────
def from_anthropic(body: dict, headers: Mapping[str, str], *, names: NameSink, output_config: object = None,
                   lookup: Callable[[str], Optional[dict]] = lambda key: None) -> NeutralRequest:
    """An Anthropic `/v1/messages` body (after the shim's effort hook) as a NeutralRequest. `output_config` is what
    that hook popped from the body (`ccd/ccgpt-proxy.py`'s `_apply_effort`); a body the hook never saw still carries
    it, and is read from there. `lookup` is the reasoning store's `get` (Task 4). Raises errors.BridgeError for a
    request the bridge refuses."""
    if not isinstance(body, dict):
        raise _malformed("the body is not an object")
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise _malformed("model is not a string")
    messages = body.get("messages")
    if not isinstance(messages, list):
        raise _malformed("messages is not a list")
    if output_config is None:
        output_config = body.get("output_config")

    for key in body:
        if key not in READ_KEYS:
            names.name("requestField", key if isinstance(key, str) else errors.UNRECOGNISED_CODE)
    if "system" in body:
        names.name("requestField", "system")
    context = body.get("context_management")
    if isinstance(context, dict) and isinstance(context.get("edits"), list):
        for edit in context["edits"]:
            if isinstance(edit, dict) and isinstance(edit.get("type"), str):
                names.name("contextEdit", edit["type"])
    for value in _header_values(headers, BETA_HEADER):
        for beta in value.split(","):
            if beta.strip():
                names.name("betaValue", beta.strip())

    session_id = _header(headers, SESSION_HEADER)
    agent_id = _header(headers, AGENT_HEADER)
    developer = _developer(body.get("system"))
    tools, name_map, tools_required = _tools(body.get("tools"), names)
    tool_choice, parallel = _tool_choice(body.get("tool_choice"), names)
    output_format = _output_format(output_config, names)
    reasoning = body.get("reasoning")
    effort = reasoning.get("effort") if isinstance(reasoning, dict) else None

    walk = _Translation(names, lookup, session_id)
    walk.walk(messages)
    items = ([_developer_item(developer)] if developer is not None else []) + walk.items

    counted = json.dumps({"developer": developer, "items": _counted(walk.items), "tools": tools},
                         separators=(",", ":"), ensure_ascii=False)
    return NeutralRequest(
        model=model,
        developer=developer,
        items=items,
        tools=tools,
        name_map=name_map,
        tool_choice=tool_choice,
        parallel_tool_calls=parallel,
        effort=effort if isinstance(effort, str) and effort else None,
        output_format=output_format,
        cache_key=cache_key(session_id, agent_id),
        session_id=session_id,
        stream=body.get("stream") is True,
        compaction=_compaction(messages),
        countable_bytes=len(counted.encode("utf-8", "surrogatepass")),
        image_count=_images(walk.items),
        tools_required=tools_required,
    )
