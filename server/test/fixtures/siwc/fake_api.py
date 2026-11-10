"""A fake Responses API for `siwc-trial.test.ts`. Loopback only, standard library only.

    python3 -I fake_api.py --log <file> --config <file>

It binds 127.0.0.1 on a free port and prints `port <n>`. It serves `GET /v1/models` and `POST /v1/responses`, the two
routes `deploy/siwc-trial.py` uses with the access token.

THE LOG is one JSON object per line, one per request: `route`, the request `headers` (names lower-cased), the parsed
`body` of a POST, and `answered` (the status, and the sha256 and length of the body it sent), so a test can check
each recording byte for byte.

A `/v1/responses` ANSWER follows the request, as the route's pages describe it. A body that is not `store:false` and
`stream:true`, that carries a field of UNSUPPORTED or a `system`-role message is answered 400 with the route's
`unsupported_capability` code and the field in `error.param`. Otherwise the answer is a stream: one function call (two
with `parallel_tool_calls`) when the request offers a tool, has no tool result yet and `tool_choice` is not `none`,
after a reasoning item when `include` asks for encrypted reasoning; else one message, which is a JSON object when the
request has a `text.format`. Every id, text, encrypted content and header value it sends carries the word `sentinel`,
so a test can look for each in the tool's output.

THE CONFIG is a JSON object, read again at each request:
  mode   `normal` (default); `not-eligible` (403 with a structured error); `detail-401` (a `{"detail": ...}` body);
         `failed` (a stream that ends with `response.failed`); `incomplete` (one that ends with
         `response.incomplete`); `no-terminal` (one that ends with no terminal event); `echo-code` (a 400 whose
         `error.code` and `error.param` are the lower-cased bearer token); `drop` (the connection is closed with no
         answer)
"""

import hashlib
import http.server
import json
import sys

UNSUPPORTED = ("background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation",
               "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs",
               "top_p", "truncation", "user", "previous_response_id")
CAPABILITY = "subscription_sharing_unsupported_capability"
MODELS = {"models": [
    {"slug": "model-fixture-a", "display_name": "Display Sentinel A", "visibility": "list"},
    {"slug": "model-fixture-b", "display_name": "Display Sentinel B", "visibility": "hide"},
]}
TEXT = "ok sentinel reply text"
ENCRYPTED = "gAAAAAB-sentinel-encrypted-content-0123456789"


def event(kind, data):
    return ("event: %s\ndata: %s\n\n" % (kind, json.dumps(dict(type=kind, **data), separators=(",", ":")))).encode()


def offered(body):
    """The first function the request offers, as (name, namespace or None): top-level `tools` first, then any
    `additional_tools` input item."""
    groups = [body.get("tools") or []]
    groups += [item.get("tools") or [] for item in body.get("input") or []
               if isinstance(item, dict) and item.get("type") == "additional_tools"]
    for tools in groups:
        for tool in tools:
            if tool.get("type") == "function":
                return tool.get("name"), None
            if tool.get("type") == "namespace":
                for inner in tool.get("tools") or []:
                    if inner.get("type") == "function":
                        return inner.get("name"), tool.get("name")
    return None


def refusal(body):
    """The field a request is refused for, or None."""
    if body.get("store") is not False:
        return "store"
    if body.get("stream") is not True:
        return "stream"
    for field in UNSUPPORTED:
        if field in body:
            return field
    if not isinstance(body.get("input"), list):
        return "input"
    for i, item in enumerate(body["input"]):
        if isinstance(item, dict) and item.get("type", "message") == "message" and item.get("role") == "system":
            return "input[%d].role" % i
    return None


def stream(body, n, seen_keys, mode):
    rid = "resp_sentinel%010d" % n
    out = [event("response.created", {"response": {"id": rid, "object": "response", "status": "in_progress",
                                                   "model": body.get("model"), "output": []}, "sequence_number": 0})]
    items = []
    tool = offered(body)
    answered = any(isinstance(i, dict) and i.get("type") == "function_call_output" for i in body["input"])
    if tool is not None and not answered and body.get("tool_choice") != "none":
        if "reasoning.encrypted_content" in (body.get("include") or []):
            items.append({"type": "reasoning", "id": "rs_sentinel%010d" % n, "summary": [],
                          "encrypted_content": ENCRYPTED})
        for k, word in enumerate(("one", "two")[:2 if body.get("parallel_tool_calls") else 1]):
            call = {"type": "function_call", "id": "fc_sentinel%09d%d" % (n, k), "status": "completed",
                    "call_id": "call_sentinel%09d%d" % (n, k), "name": tool[0],
                    "arguments": json.dumps({"word": word})}
            if tool[1] is not None:
                call["namespace"] = tool[1]
            items.append(call)
    else:
        text = '{"word":"ok"}' if isinstance(body.get("text"), dict) else TEXT
        mid = "msg_sentinel%010d" % n
        out.append(event("response.output_item.added", {"output_index": 0, "item": {
            "type": "message", "id": mid, "role": "assistant", "status": "in_progress", "content": []}}))
        out.append(event("response.output_text.delta", {"item_id": mid, "output_index": 0, "content_index": 0,
                                                        "delta": text}))
        items.append({"type": "message", "id": mid, "role": "assistant", "status": "completed",
                      "content": [{"type": "output_text", "text": text, "annotations": []}]})
    for index, item in enumerate(items):
        out.append(event("response.output_item.done", {"output_index": index, "item": item}))
    key = body.get("prompt_cache_key")
    cached = 1024 if key is not None and key in seen_keys else 0
    if key is not None:
        seen_keys.add(key)
    usage = {"input_tokens": 1100, "input_tokens_details": {"cached_tokens": cached}, "output_tokens": 7,
             "output_tokens_details": {"reasoning_tokens": 3}, "total_tokens": 1107}
    if mode == "failed":
        out.append(event("response.failed", {"response": {"id": rid, "status": "failed", "error": {
            "code": "subscription_sharing_usage_limit_exceeded", "message": "message sentinel text"}}}))
    elif mode == "incomplete":
        out.append(event("response.incomplete", {"response": {
            "id": rid, "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "usage": usage}}))
    elif mode != "no-terminal":
        out.append(event("response.completed", {"response": {"id": rid, "status": "completed", "output": items,
                                                             "usage": usage}}))
    return b"".join(out)


class Handler(http.server.BaseHTTPRequestHandler):
    log_path = ""
    config_path = ""
    count = 0
    seen_keys = set()

    def log_message(self, *args):
        pass

    def _config(self):
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                value = json.load(f)
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _answer(self, entry, status, raw, content_type):
        entry["answered"] = {"status": status, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("x-request-id", "req_sentinel0123456789")
        self.send_header("x-fixture-usage-primary", "header-sentinel-value-42")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, entry, status, body):
        self._answer(entry, status, json.dumps(body).encode("utf-8"), "application/json")

    def _mode(self, entry, mode):
        """The whole-answer modes; True when one answered."""
        if mode == "not-eligible":
            self._json(entry, 403, {"error": {"message": "message sentinel text", "type": "invalid_request_error",
                                             "param": None, "code": "subscription_sharing_user_not_eligible"}})
        elif mode == "detail-401":
            self._json(entry, 401, {"detail": "detail sentinel text"})
        elif mode == "echo-code":
            token = (self.headers.get("Authorization") or "").replace("Bearer ", "").lower()
            self._json(entry, 400, {"error": {"message": "message sentinel text", "type": "invalid_request_error",
                                             "param": token, "code": token}})
        elif mode == "drop":
            entry["answered"] = None
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            self.close_connection = True
        else:
            return False
        return True

    def do_GET(self):
        entry = {"route": "models" if self.path == "/v1/models" else self.path,
                 "headers": {k.lower(): v for k, v in self.headers.items()}}
        if self.path != "/v1/models":
            self._json(entry, 404, {"error": {"code": "not_found", "message": "message sentinel text"}})
            return
        if not self._mode(entry, self._config().get("mode", "normal")):
            self._json(entry, 200, MODELS)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            body = None
        entry = {"route": "responses" if self.path == "/v1/responses" else self.path,
                 "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}
        if self.path != "/v1/responses" or not isinstance(body, dict):
            self._json(entry, 404, {"error": {"code": "not_found", "message": "message sentinel text"}})
            return
        mode = self._config().get("mode", "normal")
        if self._mode(entry, mode):
            return
        field = refusal(body)
        if field is not None:
            self._json(entry, 400, {"error": {"message": "message sentinel text", "type": "invalid_request_error",
                                             "param": field, "code": CAPABILITY}})
            return
        Handler.count += 1
        self._answer(entry, 200, stream(body, Handler.count, Handler.seen_keys, mode), "text/event-stream")


def main(argv):
    args = dict(zip(argv[0::2], argv[1::2]))
    Handler.log_path = args["--log"]
    Handler.config_path = args["--config"]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    sys.stdout.write("port %d\n" % server.server_address[1])
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
