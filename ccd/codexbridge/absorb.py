"""codexbridge.absorb — which upstream failure the bridge answers by trying again, and when (D-TBD-bridge-absorb).

Plan 2026-11-25 (codex-bridge absorb overload). A lane's launcher gives Claude Code two retries (`ccd/ccrc-codex`),
because a retry after the request timeout costs 870 s (plan 2026-09-08, the compaction wedge). The same count covers a
failure that comes back in milliseconds, so a backend that said it was overloaded for five seconds ended the turn. The
bridge tries such a failure again itself, and answers it exactly as before once the bounds below are spent.

PURE: no clock, no I/O, no state. `server._Request._absorb` measures, waits and acts on what this module decides; it
also holds what only the request knows (nothing committed to the client, the client still there, Claude Code's own
request).

WHICH (`word`). The error table's `overloaded` and `unavailable` rows (errors.py), and a POST that got no answer at all
(the bridge's own `unavailable`, code `transport`, with no upstream status: TRANSPORT). Every other row is answered at
once: a rate limit, a plan limit, a policy refusal, an overflow, an ineligible plan, a refused token, a capability, any
other 4xx. A 2xx whose terminal `response.completed` or `response.incomplete` arrived is never sent again, whatever the
bridge then made of it: that response ended, and the parity section has counted it.

WHEN (`delay`). An attempt that took FAST_S or longer is not tried again: only a fast failure is cheap to repeat, and a
slow one is the wedge (the connect bound, 30 s, and the idle bound, 300 s, are both past it). The waits double from
FIRST_S to CAP_S, each spread by JITTER; an upstream `retry-after` longer than the wait replaces it. A wait that would
end past BUDGET_S from the message's first POST is not started, so a retry never begins later than that, and a
`retry-after` that does not fit is answered at once.

Every constant is read when it is used, so the test driver's `consts` reach it.
"""

import random
from typing import Callable, Optional

BUDGET_S = 120.0  # from the message's first POST to the last moment a retry may start
FIRST_S = 1.0
CAP_S = 20.0
JITTER = 0.25  # each wait is spread over plus or minus this share of itself, and never past CAP_S
FAST_S = 30.0  # an attempt that took this long or longer is answered, never retried

ROWS = ("overloaded", "unavailable")  # the error table's rows (BridgeError.kind)
TRANSPORT = "transport"  # no answer at all: the connect or the exchange failed
WORDS = ROWS + (TRANSPORT,)  # the stats file's keys, and the only words `word` answers


def word(kind: str, status: Optional[int], ended: bool) -> Optional[str]:
    """The failure's word in WORDS, or None for one that is never retried. `kind` is the BridgeError's row, `status`
    the upstream's HTTP status (None: no answer), `ended` whether a terminal completed or incomplete response came."""
    if ended or kind not in ROWS:
        return None
    return TRANSPORT if status is None else kind


def delay(retries: int, *, took_s: float, spent_s: float, retry_after_s: Optional[float],
          rand: Callable[[], float] = random.random) -> Optional[float]:
    """The seconds to wait before the next attempt, or None to answer the failure now. `retries` is how many this
    message has had, `took_s` the failed attempt's own length, `spent_s` the time since the message's first POST."""
    if took_s >= FAST_S:
        return None
    wait = min(CAP_S, FIRST_S * 2 ** min(retries, 16))
    wait = min(CAP_S, wait * (1 - JITTER + 2 * JITTER * rand()))
    if retry_after_s is not None:
        wait = max(wait, retry_after_s)
    return wait if spent_s + wait <= BUDGET_S else None
