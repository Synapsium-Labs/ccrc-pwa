"""The serviceability answer on a reserved account and the reservation arithmetic (§3.4, Table 3.4c), the load lines."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'
CEILING, FABLE_CEILING = 98, 40

anchor('Every other class meets a lower ceiling: the seven-day ceiling (98) minus what is left of the reserve.')
anchor('left is the reserve minus the Fable the account has used in the window, never below zero. An unmeasured or stale reading counts as nothing used')
anchor('- The five-hour figure meets the same line. No Fable reading exists for that window, so the whole reserve is set aside in it.')
anchor('- An unmeasured seven-day figure admits no new guest there: for a guest\'s placement the reservation arm answers `unservable`, with the reason `reserved`.') if not FIX else None
anchor('That is a stated exception to "unmeasured never refuses", in the safe direction for the reserve')
anchor('- Fable is unservable, with the reason `reserved`.')
anchor('- A billing fact for each account, a roster field: where an account bills Fable to usage credits, Fable is unservable for the Overlord')
anchor('- A continuity record for each lane, a roster field (below): on a lane without one, no class serves the Overlord.')


def left(reserve, fable_used):
    return max(0, reserve - (fable_used or 0))


def guest(cls, seven, five, reserve, fable_used):
    """A new guest's placement on a reserved account."""
    if cls == 'fable':
        return 'unservable'
    if seven is None:
        return 'unservable'                           # the stated exception
    if seven >= CEILING - left(reserve, fable_used):
        return 'unservable'
    if five is None:
        return 'unservable' if FIX else 'servable'    # "unmeasured never refuses": no exception is stated for this window
    if five >= CEILING - reserve:
        return 'unservable'
    return 'servable'


def overlord_fable(seven, share, billing, continuity, current='fable'):
    if not continuity:
        return 'unservable'
    if billing == 'credits':
        return 'unservable'
    if billing is None:
        return 'unservable' if FIX else None           # the roster has no billing fact for the account
    if seven is None or share is None:
        return 'keeps its class'
    return 'unservable' if seven * share >= FABLE_CEILING else 'servable'


# Table 3.4c, reserve 40
tab = table_rows('*Table 3.4c')[1:]
cases = [(30, 1 / 3, 'servable', 'servable'), (70, 1 / 7, 'servable', 'unservable'), (70, 4 / 7, 'unservable', 'servable'),
         (30, None, 'keeps its class', 'servable')]
for (seven, share, want_o, want_g), r in zip(cases, tab):
    used = None if share is None else round(seven * share)
    o = overlord_fable(seven, share, 'plan', True)
    g = guest('opus', seven, 0, 40, used)
    gf = guest('fable', seven, 0, 40, used)
    words_o = r[1].lower()
    assert (want_o == 'servable') == ('fable servable' in words_o) or want_o != 'servable'
    if (o, g, gf) == (want_o, want_g, 'unservable'):
        ok('Table 3.4c row "%s": Overlord %s, guest %s, guest on Fable unservable' % (r[0][:40], o, g))
    else:
        ce('RSV-table', 'row "%s": computed %s' % (r[0], (o, g, gf)))

SEVEN = [None, 0, 30, 57, 58, 59, 67, 68, 69, 97, 98, 99]
FIVE = [None, 0, 57, 58, 59, 98]
RES = [0, 20, 40, 100]
USED = [None, 0, 10, 40]
CLS = ['fable', 'opus', 'default']
DOM = list(itertools.product(CLS, SEVEN, FIVE, RES, USED))
for d in DOM:
    assert guest(*d) in ('servable', 'unservable')
ok('guest placement: %d inputs, each servable or unservable' % len(DOM))


def worse_num(vals, v):
    return [w for w in vals if w is None or (v is not None and w > v)] if v is not None else []


bad = {}
for cls, seven, five, res, used in DOM:
    if guest(cls, seven, five, res, used) != 'unservable':
        continue
    # making one input better must not be needed to explain it; check the other direction: from here, worse stays unservable
    for s2 in worse_num(SEVEN, seven):
        if guest(cls, s2, five, res, used) == 'servable':
            bad.setdefault('the seven-day figure', []).append(((cls, seven, five, res, used), s2))
    for f2 in worse_num(FIVE, five):
        if guest(cls, seven, f2, res, used) == 'servable':
            bad.setdefault('the five-hour figure', []).append(((cls, seven, five, res, used), f2))
    if used is not None and guest(cls, seven, five, res, None) == 'servable':
        bad.setdefault('the Fable reading', []).append(((cls, seven, five, res, used), None))
for k, v in bad.items():
    d, w = sorted(v, key=lambda x: (x[0][3] != 40, x[0][1] != 30, x[0][0] != 'opus'))[0]
    ce('RSV-monotonic', '%s made worse turns a refused guest into an admitted one in %d input pairs, e.g. class %s, seven-day %s,'
       ' five-hour %s past its line of %d, reserve %d: unservable; five-hour unmeasured: servable'
       % (k, len(v), d[0], d[1], d[2], CEILING - d[3], d[3]) if k == 'the five-hour figure' else
       '%s made worse admits a refused guest in %d pairs, e.g. %s -> %s' % (k, len(v), d, w))
if not bad:
    ok('guest placement: a higher or an unmeasured figure never admits a guest that a lower one refused')

# the Overlord's Fable, with the roster facts
ODOM = list(itertools.product([None, 30, 70], [None, 1 / 7, 4 / 7], ['plan', 'credits', None], [True, False]))
none = [d for d in ODOM if overlord_fable(*d) is None]
if none:
    ce('RSV-billing', 'the Overlord\'s Fable on an account whose roster entry has no billing fact: no answer in %d of %d inputs.'
       ' A lane with no continuity record refuses; a missing billing fact is not given an answer, and "credits" is spend (O2)'
       % (len(none), len(ODOM)))
else:
    ok('the Overlord\'s Fable: %d inputs, one answer each' % len(ODOM))

# the load lines
anchor('A line is measured on the least-loaded account that can serve the Overlord now, as the higher of its five-hour and weekly figures.')
anchor('the Overlord\'s accounts are under the load line that stops this row (Table 6.8a)')
if 'An unmeasured load' in FLAT or FIX:
    ok('an unmeasured load has an answer for `mayHold`')
else:
    ce('LOAD-unmeasured', '`mayHold` needs the accounts "under the load line that stops this row". Table 6.8a gives 70, 85 and 95;'
       ' no sentence says what an unmeasured figure reads as, so an item hold is taken on an account whose load is unknown')

summary('reservation, serviceability, load lines%s' % (' (with the proposed edits)' if FIX else ''),
        '%d guest inputs; %d Overlord inputs; 4 rows of Table 3.4c' % (len(DOM), len(ODOM)))
