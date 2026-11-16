"""followUpDue (§5.4): what the follow-up arm does when a request's clock comes due."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

anchor('So every open request outside `needs-you`, `done-unverified` and `blocked` has a clock.')
anchor('- **After two nudges with no measured movement,** the server itself moves the request to `needs-you`.')
anchor('effective rung instead, at `advise` and `full` (§7.5). At `chat` it sends no nudge: a follow-up that comes due')
anchor('- **The `off` rung stops every nudge,** and moves each open request whose owner has not acknowledged to `needs-you`')
anchor('`hands-off` programme gets no follow-up nudges.')
anchor('- **One L1 decider, `followUpDue`, decides a nudge.** Its inputs: no acknowledgement, no news, no linked work, a quiet')

CLOCKED = ['routed', 'in-progress', 'declined', 'received']      # open, outside needs-you, done-unverified and blocked
ACKED = {'in-progress'}
RUNG = ['off', 'chat', 'advise', 'full']
ENG = ['full', 'advise', 'hands-off']
DOM = list(itertools.product(CLOCKED, RUNG, ENG, [0, 1, 2]))


def due(state, rung, eng, nudges):
    """The clock came due with no measured movement. Returns the arm's answer, or None where the text gives none."""
    if rung == 'off':
        if state not in ACKED:
            return 'moved to needs-you'                  # by the `off` transaction itself
        return 'moved to needs-you' if FIX else None     # nudges stop; nothing is said of an acknowledged request
    if rung == 'chat':
        return 'moved to needs-you'
    if eng == 'hands-off':
        return 'moved to needs-you' if FIX else None     # no nudge is sent, so "after two nudges" never comes
    if nudges >= 2:
        return 'moved to needs-you'
    return 'a nudge row in the inbox'


none = {}
for d in DOM:
    if due(*d) is None:
        key = 'the `off` rung, an acknowledged request' if d[1] == 'off' else 'a `hands-off` programme, at `%s`' % d[1]
        none.setdefault(key, []).append(d)
for k, v in sorted(none.items()):
    ce('FUP-silent', '%s: the clock comes due and no rule nudges or moves the request (%d inputs, e.g. state `%s`, %d'
       ' nudges so far). It stays where it is, and the operator is never told' % (k, len(v), v[0][0], v[0][3]))
if not none:
    ok('total: %d inputs, every due clock ends in a nudge or in needs-you' % len(DOM))

# a lower rung or a lower engagement never leaves the operator out
RANK = {'a nudge row in the inbox': 0, 'moved to needs-you': 1, None: -1}
bad = 0
for state, rung, eng, n in DOM:
    a = due(state, rung, eng, n)
    for r2 in RUNG[:RUNG.index(rung)]:
        if RANK[due(state, r2, eng, n)] < RANK[a]:
            bad += 1
    for e2 in ENG[ENG.index(eng) + 1:]:
        if RANK[due(state, rung, e2, n)] < RANK[a]:
            bad += 1
if bad:
    ce('FUP-monotonic', 'a lower rung or a lower engagement turns "a nudge" or "moved to needs-you" into no answer in %d input pairs' % bad)
else:
    ok('monotonic: a lower rung or engagement never turns a nudge or a move into silence')

# the reason a nudge names
REASONS = ['no acknowledgement', 'no news', 'no linked work', 'a quiet run', 'a dead coordinator', 'a stall rung repeated']
order_stated = 'The first that holds names the nudge' in FLAT or FIX
pairs = [(a, b) for a in REASONS for b in REASONS if a < b]
if order_stated:
    ok('the reasons are tested in a stated order')
else:
    ce('FUP-order', '`followUpDue` is a first-match decider (Table 11.7b) and "the nudge names its reason"; §5.4 lists %d reasons'
       ' and no order. %d pairs can hold together. In the order listed, "no acknowledgement" names the nudge of a request'
       ' whose coordinator is dead, and the Overlord nudges a dead owner' % (len(REASONS), len(pairs)))

summary('followUpDue%s' % (' (with the proposed edits)' if FIX else ''), '%d inputs; %d pairs of reasons' % (len(DOM), len(pairs)))
