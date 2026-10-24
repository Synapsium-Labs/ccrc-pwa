"""codexbridge — a Codex lane's `direct` mode: an Anthropic endpoint speaking the ChatGPT backend's Responses route.

Codex-bridge spec 2026-10-15 §2.1 and §2.8 (Stage 2), plan 2026-10-22 "The bridge's contract". The shim
(`ccd/ccgpt-proxy.py`) imports this package in `direct` mode only, from the box's installed tree, with the `ccd`
directory first on `sys.path`; `litellm` mode never imports it.

THE RULES EVERY MODULE HERE KEEPS (the plan's Global Constraints):
- Standard library only, plus Stage 1's credential library (`ccd/ccgpt-auth.py`), which is loaded BY PATH
  (`CCRC_CODEX_AUTH_LIB`, `importlib.util.spec_from_file_location`), never through `sys.path`.
- Python 3.9 syntax: every module passes `ast.parse(src, feature_version=(3, 9))`, no PEP 604 union in an annotation
  or an `isinstance` call (`typing.Optional` instead), no `match`, no parenthesised context managers. A socket timeout
  is caught as `socket.timeout`, which on 3.9 is an `OSError` that is not `TimeoutError`.
- No body, token or content is ever logged, counted or written to a non-secret file.
- Every entry that imports the package sets `sys.dont_write_bytecode = True` first: `-I` implies `-E`, so
  PYTHONDONTWRITEBYTECODE is ignored and an import would write `__pycache__` into the tree.

`load_all()` runs at import and imports every module in MODULES, so an update that rewrites the tree under a running
bridge changes nothing that bridge runs.
"""

import importlib.util
from typing import List, Protocol, Tuple

VERSION = "1"

# Every module of the package, in import order: a module imports only modules before it.
MODULES = ("sse", "errors", "inbound", "reducer", "store")


class NameSink(Protocol):
    """Where a module reports a name it saw (a drift name, a dropped field, an error code), by family. The value is
    a NAME, never content; Task 5's `Stats` bounds it by NAME_RE. Tasks 2-3 take one before `Stats` exists."""

    def name(self, family: str, value: str) -> None:
        ...


class ListSink:
    """The list-backed NameSink: `names` holds each `(family, value)` in the order it was reported."""

    def __init__(self) -> None:
        self.names = []  # type: List[Tuple[str, str]]

    def name(self, family: str, value: str) -> None:
        self.names.append((family, value))


def load_all() -> None:
    """Import every module in MODULES, so each is in `sys.modules` and bound on this package from the first import."""
    for module in MODULES:
        importlib.import_module(__name__ + "." + module)


load_all()
