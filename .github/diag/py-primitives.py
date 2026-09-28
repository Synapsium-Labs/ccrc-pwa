# DIAGNOSTIC ONLY: time the python-side primitives the proxy's start path touches.
import sys, time
label = sys.argv[1] if len(sys.argv) > 1 else "?"
def t(name, fn):
    t0 = time.time()
    try:
        r = fn()
    except Exception as e:
        r = f"raised {type(e).__name__}: {e}"
    print(f"[{label}] {name}: {time.time() - t0:.3f}s -> {str(r)[:120]}", flush=True)
t0 = time.time()
import socket
t("import http.server", lambda: __import__("http.server"))
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import socketserver
t("socket.gethostname()", socket.gethostname)
t("socket.getfqdn('127.0.0.1')", lambda: socket.getfqdn("127.0.0.1"))
t("socket.getfqdn()", socket.getfqdn)
t("socket.gethostbyaddr('127.0.0.1')", lambda: socket.gethostbyaddr("127.0.0.1"))
t("getaddrinfo('localhost')", lambda: socket.getaddrinfo("localhost", 80))
def mk(cls):
    s = cls(("127.0.0.1", 0), BaseHTTPRequestHandler)
    s.server_close()
    return getattr(s, "server_name", "-")
t("ThreadingHTTPServer(127.0.0.1:0) construct", lambda: mk(ThreadingHTTPServer))
t("socketserver.TCPServer(127.0.0.1:0) construct", lambda: mk(socketserver.TCPServer))
