"""askOrAct and its weights (§6.3, Table 11.5b), and the bounds the text quotes beside them."""
import itertools
import math
import os
import re
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

anchor('The Overlord acts only when `U x W_wrong <= lambda x W_ask`')
anchor('A cell with no record asks.')
row = [r for r in table_rows('*Table 11.5b')[1:] if r[0].startswith('`W_wrong`')][0][0]
W_WRONG = {}
for m in re.finditer(r'(reversible|compensable) and (routine|big) (\d+)', row):
    W_WRONG[(m.group(1), m.group(2))] = int(m.group(3))
row = [r for r in table_rows('*Table 11.5b')[1:] if r[0].startswith('`W_ask`')][0][0]
W_ASK = {'batchable': 1.0, 'blocking-by': 1.5, 'blocking-now': 2.0}
for k, v in W_ASK.items():
    assert re.search(r'%s`? %s' % (k, ('%g' % v)), row), (k, row)
assert W_WRONG == {('reversible', 'routine'): 7, ('reversible', 'big'): 20, ('compensable', 'routine'): 20, ('compensable', 'big'): 60}


def upper_clean(n):
    """One-sided 95% upper bound on the disagreement rate after n answers with none overturned (exact binomial)."""
    return 1.0 - 0.05 ** (1.0 / n)


def lower_bound(k, n, conf=0.95):
    """One-sided lower bound on a rate after k successes in n (Clopper and Pearson), by bisection."""
    if k == 0:
        return 0.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        p = (lo + hi) / 2
        tail = sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))
        if tail < 1 - conf:
            lo = p
        else:
            hi = p
    return lo


def ask_or_act(rev, size, urgency, n_clean, lam=1.0):
    if size == 'unknown':
        size = 'big'                       # "the answer reads as big"
    if n_clean == 0:
        return 'ask'                       # a cell with no record asks
    if (rev, size) not in W_WRONG:
        return 'ask'                       # no weight: irreversible never passes an Overlord door in version 1
    return 'act' if upper_clean(n_clean) * W_WRONG[(rev, size)] <= lam * W_ASK[urgency] else 'ask'


def least_n(rev, size, urgency, lam=1.0):
    n = 1
    while ask_or_act(rev, size, urgency, n, lam) == 'ask':
        n += 1
    return n


REV = ['reversible', 'compensable', 'irreversible']
SIZE = ['routine', 'big', 'unknown']
URG = ['batchable', 'blocking-by', 'blocking-now']
NS = [0, 10, 19, 20, 28, 29, 38, 39, 58, 59, 88, 89, 178, 179, 180, 400]
LAM = [0.5, 1.0, 2.0]
dom = list(itertools.product(REV, SIZE, URG, NS, LAM))
for d in dom:
    assert ask_or_act(*d) in ('ask', 'act')
ok('total: %d inputs, each asks or acts' % len(dom))

# monotonic: a thinner record, an unknown size, a harder-to-undo act or a lower urgency never moves it to act
bad = 0
for rev, size, urg, n, lam in dom:
    a = ask_or_act(rev, size, urg, n, lam)
    worse = []
    worse += [(rev, size, urg, m, lam) for m in NS if m < n]
    if size == 'routine':
        worse += [(rev, 'big', urg, n, lam), (rev, 'unknown', urg, n, lam)]
    if size == 'big':
        worse += [(rev, 'unknown', urg, n, lam)]
    if rev != 'irreversible':
        worse += [(REV[REV.index(rev) + 1], size, urg, n, lam)]
    if urg != 'batchable':
        worse += [(rev, size, URG[URG.index(urg) - 1], n, lam)]
    for w in worse:
        if a == 'ask' and ask_or_act(*w) == 'act':
            bad += 1
            ce('ASK-monotonic', '%s asks, the worse %s acts' % ((rev, size, urg, n, lam), w))
if not bad:
    ok('monotonic: a thinner record, an unknown size, a less reversible act or a lower urgency never moves it to act')

# The worked examples under Table 11.5b.
anchor('a routine, reversible answer on a batchable row needs a disagreement bound of at most 0.14, about twenty blind answers with none overturned')
anchor('A big, compensable answer needs at most 0.017 on a batchable row, about 180 such answers, and 0.033 when the row blocks now, about ninety')
for rev, size, urg, bound, about in [('reversible', 'routine', 'batchable', 0.14, 20), ('compensable', 'big', 'batchable', 0.017, 180),
                                     ('compensable', 'big', 'blocking-now', 0.033, 90)]:
    b = W_ASK[urg] / W_WRONG[(rev, size)]
    n = least_n(rev, size, urg)
    if abs(b - bound) < 0.005 and abs(n - about) <= 0.03 * about + 1:
        ok('example: %s, %s, %s: bound %.4f (text %.3g), least clean answers %d (text "about %d")' % (rev, size, urg, b, bound, n, about))
    else:
        ce('ASK-example', '%s %s %s: bound %.4f, least n %d; the text says %.3g and about %d' % (rev, size, urg, b, n, bound, about))

# Which acts reach askOrAct, and with which reversibility.
anchor('| `ask-is-cheaper` | The answer doors | `askOrAct` says asking costs less than a wrong act |')
anchor('| `answer-item`, `answer-ask` (carriers) | Answer a held question with an option | the effect\'s | the effect\'s, compensable at least |')
anchor('are compensable at least, and are never granted themselves')
cat = table_rows('*Table 7.1a')[1:]
answer_rows = [r for r in cat if 'answer-item' in r[0] or 'state-a-fact' in r[0] or 'approve-spec' in r[0]]
reach = set()
for r in answer_rows:
    reach.add('compensable')                 # each of these rows reads "compensable"
    assert 'compensable' in r[3], r[3]
unread = [k for k in W_WRONG if k[0] not in reach]
if FIX:
    ok('the example names a compensable answer; the reversible weights are marked unused')
else:
    for k in unread:
        ce('ASK-unreachable', 'the weight for "%s and %s" (%d) is never read: `ask-is-cheaper` is an answer door\'s word,'
           ' and every answer is compensable at least (Table 7.1a, §6.7)' % (k[0], k[1], W_WRONG[k]))
    n = least_n('compensable', 'routine', 'batchable')
    ce('ASK-example', 'the text\'s cheapest case, "a routine, reversible answer", is a cell no answer has. A routine answer is'
       ' compensable: bound %.3f on a batchable row, %d blind answers with none overturned, not "about twenty"'
       % (W_ASK['batchable'] / W_WRONG[('compensable', 'routine')], n))
note('least clean blind answers before a routine answer may act: batchable %d, blocking-by %d, blocking-now %d'
     % tuple(least_n('compensable', 'routine', u) for u in URG))
note('least clean blind answers before a big answer may act: batchable %d, blocking-by %d, blocking-now %d'
     % tuple(least_n('compensable', 'big', u) for u in URG))

# The other bounds the text quotes.
anchor('12 agreeing cases out of 12 prove no more than 78% agreement at 95% confidence. 19 of 19 prove 85%, and 29 of 29 prove 90%')
for n, pct in [(12, 0.78), (19, 0.85), (29, 0.90)]:
    lb = lower_bound(n, n)
    (ok if abs(lb - pct) < 0.006 else lambda m: ce('BOUND', m))('%d of %d: lower bound %.3f (text %d%%)' % (n, n, lb, round(pct * 100)))
anchor('That takes 29 labelled answers beyond the line with no error for a 10% target, and 59 for 5%')
for target, n_text in [(0.10, 29), (0.05, 59)]:
    n = 1
    while upper_clean(n) > target:
        n += 1
    (ok if n == n_text else lambda m: ce('BOUND', m))('a %d%% target needs %d clean answers (text %d)' % (round(target * 100), n, n_text))
anchor('"17 of 19 blind, lower bound 0.70; 2 overturned"')
lb = lower_bound(17, 19)
(ok if abs(lb - 0.70) < 0.01 else lambda m: ce('BOUND', m))('17 of 19: lower bound %.3f (text 0.70)' % lb)
anchor('the one-sided 95% lower bound of normalised agreement is at least 0.85')
for n in (19, 30):
    need = min(k for k in range(n + 1) if lower_bound(k, n) >= 0.85)
    note('a lower bound of 0.85 over %d answers needs %d agreeing (%d of %d gives %.3f, %d of %d gives %.3f)'
         % (n, need, need, n, lower_bound(need, n), need - 1, n, lower_bound(need - 1, n)))

summary('askOrAct%s' % (' (with the proposed edits)' if FIX else ''), '%d inputs' % len(dom))
