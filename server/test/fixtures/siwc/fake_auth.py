"""A fake Sign in with ChatGPT authorization server for `siwc-trial.test.ts`. Loopback only, standard library only.

    python3 -I fake_auth.py --log <file> --config <file>

It binds 127.0.0.1 on a free port and prints `port <n>`. It serves the four routes `deploy/siwc-trial.py` uses:
`GET /api/accounts/authorize` (a 302 to the loopback `redirect_uri`), `POST /api/accounts/oauth/token` (the
`authorization_code` and `refresh_token` grants, form-encoded; PKCE S256 is checked), `GET
/.well-known/openid-configuration` and `POST /api/accounts/oauth/revoke`.

THE LOG is one JSON object per line: every request (`route`, its query or form, its headers) and every value the
server issues (`issued`: the code, the tokens), so a test can name each secret and look for it in the tool's output.
Every issued value is synthetic and carries the word `sentinel`.

THE CONFIG is a JSON object, read again at each request, so a test can change the server between two verbs:
  issued_client_id     the client id a new registration is issued (default `oaiapp_fixture`)
  callback             the callback's shape: `ok` (default), `no-client-id`, `no-code`, or an OAuth error word such
                       as `access_denied`
  callback_client_id   the client id the callback names, whatever was asked
  scope                the granted scopes, space-separated
  subject, email       the ID token's `sub` and `email`
  id_claims            claims merged over the ID token's (a null value removes the claim)
  aud_list             true: the ID token's `aud` is a list holding the client id
  id_token             a string sent as the ID token as it is
  expires_in           the access token's lifetime in seconds (default 3600)
  no_refresh_token     true: the token answer carries no refresh token
  token_delay_ms       how long the token route waits before it answers
  exchange_error       `{"status": n, "body": {...}}` answered to the authorization_code grant; a body of `"echo"`
                       answers `{"error": <the code it was sent>}`
  refresh_error        the same for the refresh_token grant; `"echo"` answers the refresh token it was sent
  revocation           `published` (default), `absent` or `elsewhere` (an endpoint on another host)
  revocation_status    the revocation route's status (default 200)
  discovery_status     the discovery route's status (default 200)
  discovery_fields     fields merged over the discovery document's (a null value removes the field)
  discovery_body       a string sent as the discovery route's body as it is
"""

import base64
import hashlib
import http.server
import json
import re
import secrets
import socketserver
import sys
import time
import urllib.parse

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
ALL_SCOPES = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke"
CALLBACK_RE = re.compile(r"^http://127\.0\.0\.1:[0-9]{1,5}/auth/callback$")


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def jwt(claims, tail):
    """An unsigned JWT-shaped token: a header, the claims, and a tail that is no signature."""
    return ".".join([b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode()),
                     b64url(json.dumps(claims).encode()), tail])


class State:
    def __init__(self, log_path, config_path):
        self.log_path = log_path
        self.config_path = config_path
        self.codes = {}  # code -> the authorization request it answers
        self.refresh = {}  # a live refresh token -> its grant
        self.n = 0

    def config(self):
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                value = json.load(f)
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def log(self, entry):
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def tokens(self, grant, cfg, with_id_token):
        """A token answer for `grant` (client_id, nonce), logged as issued."""
        self.n += 1
        now = int(time.time())
        expires_in = cfg.get("expires_in", 3600)  # sent as configured, a value that is no number included
        life = expires_in if isinstance(expires_in, int) else 3600
        scope = cfg.get("scope", ALL_SCOPES)
        subject = cfg.get("subject", "sub-sentinel-0001")
        access = jwt({"sub": subject, "aud": RESOURCE, "client_id": grant["client_id"], "scope": scope,
                      "iss": ISSUER, "iat": now, "exp": now + life, "jti": "jti-sentinel-%d" % self.n},
                     "ACCESS-SENTINEL-TAIL-%d" % self.n)
        answer = {"access_token": access, "token_type": "Bearer", "expires_in": expires_in, "scope": scope,
                  "earliest_refresh_at": now + 300}
        if not cfg.get("no_refresh_token"):
            refresh = "rtok-sentinel-%d-%s" % (self.n, secrets.token_hex(8))
            self.refresh[refresh] = dict(grant)
            answer["refresh_token"] = refresh
        if with_id_token:
            claims = {"iss": ISSUER, "sub": subject, "aud": [grant["client_id"]] if cfg.get("aud_list")
                      else grant["client_id"], "nonce": grant.get("nonce"), "iat": now, "exp": now + 3600,
                      "email": cfg.get("email", "user@example.com"), "name": "Name Sentinel"}
            for key, value in (cfg.get("id_claims") or {}).items():
                if value is None:
                    claims.pop(key, None)
                else:
                    claims[key] = value
            answer["id_token"] = cfg.get("id_token") or jwt(claims, "IDTOKEN-SENTINEL-TAIL-%d" % self.n)
        self.log({"issued": {k: answer[k] for k in ("access_token", "refresh_token", "id_token") if k in answer}})
        return answer


class Handler(http.server.BaseHTTPRequestHandler):
    state = None  # type: State

    def log_message(self, *args):
        pass

    def _send(self, status, body, headers=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("x-request-id", "req-auth-sentinel-value")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def _headers(self):
        return {k.lower(): v for k, v in self.headers.items()}

    def _form(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace")
        return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}

    def do_GET(self):
        st, cfg = self.state, self.state.config()
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/.well-known/openid-configuration":
            st.log({"route": "discovery", "headers": self._headers()})
            base = "http://127.0.0.1:%d" % self.server.server_address[1]
            doc = {"issuer": ISSUER, "authorization_endpoint": base + "/api/accounts/authorize",
                   "token_endpoint": base + "/api/accounts/oauth/token"}
            how = cfg.get("revocation", "published")
            if how == "published":
                doc["revocation_endpoint"] = base + "/api/accounts/oauth/revoke"
            elif how == "elsewhere":
                doc["revocation_endpoint"] = "http://127.0.0.1:1/api/accounts/oauth/revoke"
            for key, value in (cfg.get("discovery_fields") or {}).items():
                if value is None:
                    doc.pop(key, None)
                else:
                    doc[key] = value
            body = cfg["discovery_body"].encode("utf-8") if "discovery_body" in cfg else doc
            self._send(cfg.get("discovery_status", 200), body)
            return
        if url.path != "/api/accounts/authorize":
            self._send(404, {"error": "not_found"})
            return
        query = {k: v[0] for k, v in urllib.parse.parse_qs(url.query, keep_blank_values=True).items()}
        st.log({"route": "authorize", "query": query, "raw_query": url.query})
        redirect = query.get("redirect_uri", "")
        if not CALLBACK_RE.fullmatch(redirect):  # the fake never redirects anywhere but a loopback callback
            self._send(400, {"error": "invalid_request"})
            return
        asked = query.get("client_id", "")
        issued = cfg.get("issued_client_id", "oaiapp_fixture") if asked == "dynamic_agent_client" else asked
        code = "code-sentinel-" + secrets.token_hex(8)
        st.codes[code] = {"client_id": issued, "nonce": query.get("nonce"), "challenge": query.get("code_challenge"),
                          "redirect_uri": redirect}
        st.log({"issued": {"code": code}})
        shape = cfg.get("callback", "ok")
        back = {"state": query.get("state", "")}
        if shape in ("ok", "no-client-id"):
            back["code"] = code
            back["scope"] = cfg.get("scope", ALL_SCOPES)
        elif shape != "no-code":
            back["error"] = shape
        if shape != "no-client-id" and "error" not in back:
            back["client_id"] = issued
        if "callback_client_id" in cfg:
            back["client_id"] = cfg["callback_client_id"]
        self.send_response(302)
        self.send_header("Location", redirect + "?" + urllib.parse.urlencode(back))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        st, cfg = self.state, self.state.config()
        url = urllib.parse.urlsplit(self.path)
        form = self._form()
        if url.path == "/api/accounts/oauth/revoke":
            st.log({"route": "revoke", "form": form, "headers": self._headers()})
            st.refresh.pop(form.get("token", ""), None)
            self._send(cfg.get("revocation_status", 200), b"")
            return
        if url.path != "/api/accounts/oauth/token":
            self._send(404, {"error": "not_found"})
            return
        st.log({"route": "token", "form": form, "headers": self._headers()})
        delay = cfg.get("token_delay_ms", 0)
        if delay:
            time.sleep(delay / 1000.0)
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            refusal = cfg.get("exchange_error")
            if refusal:
                body = {"error": form.get("code", "")} if refusal.get("body") == "echo" else refusal.get("body")
                self._send(refusal.get("status", 400), body)
                return
            asked = st.codes.pop(form.get("code", ""), None)
            verifier = form.get("code_verifier", "")
            ok = (asked is not None and form.get("client_id") == asked["client_id"]
                  and form.get("redirect_uri") == asked["redirect_uri"] and form.get("resource") == RESOURCE
                  and b64url(hashlib.sha256(verifier.encode("ascii", "replace")).digest()) == asked["challenge"])
            if not ok:
                self._send(400, {"error": "invalid_grant"})
                return
            self._send(200, st.tokens(asked, cfg, True))
            return
        if grant_type == "refresh_token":
            refusal = cfg.get("refresh_error")
            if refusal:
                body = ({"error": form.get("refresh_token", "")} if refusal.get("body") == "echo"
                        else refusal.get("body"))
                self._send(refusal.get("status", 400), body)
                return
            grant = st.refresh.pop(form.get("refresh_token", ""), None)
            if grant is None or form.get("client_id") != grant["client_id"] or form.get("resource") != RESOURCE:
                self._send(400, {"error": "invalid_grant"})
                return
            self._send(200, st.tokens(grant, cfg, False))
            return
        self._send(400, {"error": "unsupported_grant_type"})


class Server(http.server.ThreadingHTTPServer):
    """`ThreadingHTTPServer` without `HTTPServer.server_bind`'s `socket.getfqdn` of the bind address, which nothing
    reads and which has taken about 35 s on macOS, past the test's 15 s wait for `port <n>` (D-8343)."""

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def main(argv):
    args = dict(zip(argv[0::2], argv[1::2]))
    Handler.state = State(args["--log"], args["--config"])
    server = Server(("127.0.0.1", 0), Handler)
    sys.stdout.write("port %d\n" % server.server_address[1])
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
