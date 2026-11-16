"""pushAdmission (§4.2, Table 4.2a): when a push the Overlord's tier causes goes out."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

anchor('| `blocking-now` | None: it pushes at once | The server measures a run or a hold waiting behind the item |')
anchor('| `blocking-by` a time | That time, less a lead time (Table 11.5b) | Always |')
anchor('| `batchable` | The next briefing time. With no briefing time set, it is not deferred | Always |')
anchor('Nothing defers a push past its limit. Quiet hours and "away until" hold a push only up to it')
anchor('- **A spent budget lets through a verified `blocking-now`, and a `blocking-by` at its deferral limit.**') if not FIX else None
anchor('deferred by the attention budget to a stated time no later than its deferral limit (Table 4.2a)')
anchor('The server accepts `blocking-now` only when it measures a run or a hold waiting.') if not FIX else None

URG = ['batchable', 'blocking-by, before its limit', 'blocking-by, at its limit', 'blocking-now, verified', 'blocking-now, not verified']
DOM = list(itertools.product(URG, ['a briefing time is set', 'no briefing time'], ['budget left', 'budget spent'],
                             ['no quiet hours', 'quiet hours or away'], ['console closed', 'console open']))

NOW, LATER, CONSOLE = 'pushed now', 'deferred, to its limit at the latest', 'delivered in the console, no push'


def admission(urg, briefing, budget, quiet, console):
    """Returns the set of answers the rules of §4.2 give. One answer is what the text should give."""
    out = set()
    spent = budget == 'budget spent'
    held = quiet == 'quiet hours or away'
    if urg == 'blocking-now, not verified':
        if FIX:
            return admission('batchable', briefing, budget, quiet, console)    # recorded as batchable
        return out                                       # not accepted: no rule says what the door does with it
    if urg in ('blocking-now, verified', 'blocking-by, at its limit'):
        out.add(NOW + (', an overdraft' if spent else ''))  # no deferral limit left; a spent budget lets it through
        return out
    if urg == 'blocking-by, before its limit':
        out.add(LATER if (spent or held) else NOW)
        return out
    # batchable
    if briefing == 'a briefing time is set':
        out.add(CONSOLE if console == 'console open' else 'deferred, to the next briefing time')
        return out
    out.add(NOW)                                          # "it is not deferred", and nothing defers past a limit
    if spent:
        if FIX:
            return {NOW + ', an overdraft'}
        out.add('not let through')                        # the spent budget lets through two kinds, and this is neither
    return out


gaps, clashes = {}, {}
for d in DOM:
    a = admission(*d)
    if len(a) == 0:
        gaps.setdefault(d[0], []).append(d)
    elif len(a) > 1:
        clashes.setdefault((d[0], d[1], d[2]), []).append((d, a))
for u, ds in gaps.items():
    ce('PUSH-none', '%s: no answer in %d inputs. Table 4.2a says when the urgency is accepted, not what the escalate door'
       ' does with one it does not accept' % (u, len(ds)))
for k, v in clashes.items():
    ce('PUSH-clash', '%s; %s; %s: two rules, two answers in %d inputs: "nothing defers a push past its limit" pushes it now,'
       ' and a spent budget "lets through" only a verified `blocking-now` and a `blocking-by` at its limit'
       % (k[0], k[1], k[2], len(v)))
if not gaps and not clashes:
    ok('total: %d inputs, one answer each' % len(DOM))

# a lower urgency never goes out sooner
RANK = {NOW: 0, NOW + ', an overdraft': 0, LATER: 1, 'deferred, to the next briefing time': 1, CONSOLE: 1, 'not let through': 1}
inv = []
for d in DOM:
    if d[0] != 'batchable':
        continue
    a = admission(*d)
    e = ('blocking-by, before its limit',) + d[1:]
    b = admission(*e)
    if a and b and min(RANK[x] for x in a) < min(RANK[x] for x in b):
        inv.append(d)
if inv:
    note('with no briefing time set, a `batchable` push goes out now in %d inputs where a `blocking-by` push still inside its'
         ' limit waits (quiet hours, "away until" or a spent budget), e.g. %s' % (len(inv), inv[0][1:]))
summary('pushAdmission%s' % (' (with the proposed edits)' if FIX else ''), '%d inputs' % len(DOM))
