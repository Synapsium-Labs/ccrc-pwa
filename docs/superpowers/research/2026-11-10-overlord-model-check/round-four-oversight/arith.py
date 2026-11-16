"""Round four, arithmetic: what it takes to earn each kind of trust (docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it).

Python 3 standard library only. Every figure is derived from the spec's own starting values (Table 9.5a, Table
11.5b, §3.7, §6.6, §9.5, §9.6). Nothing here is sampled: every probability is an exact binomial sum.

  python3 arith.py            prints every section; a line that starts with `CE <tag>:` is a counterexample
  FIX=1 python3 arith.py      the same sweeps with the report's proposed edits applied

Sections: T1 bounds, T2 the first gate and what `examined` selects, T3 the third gate (noise, ratchet), T4
`askOrAct` cells, T5 the grant gate, T6 the label queue, T7 the consistency divisor, T8 the auditor's model, T9
the operator's weekly load, T10 the trust table.
"""
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# The edition these figures were read from: the spec as #2542 merged it. Set OVERLORD_SPEC to a file to read another.
SPEC_REV = '28bae25d213e91ef0e18188362fea0c9d46789c0'
SPEC_FILE = 'docs/superpowers/specs/2026-11-09-overlord-design.md'
if os.environ.get('OVERLORD_SPEC'):
    SPEC = open(os.environ['OVERLORD_SPEC'], encoding='utf-8').read()
else:
    import subprocess
    SPEC = subprocess.check_output(['git', 'show', SPEC_REV + ':' + SPEC_FILE], cwd=HERE).decode('utf-8')
FLAT = re.sub(r'\s+', ' ', SPEC)
FIX = os.environ.get('FIX') == '1'
_n = {'ce': 0, 'ok': 0}


def ce(tag, msg):
    _n['ce'] += 1
    print('CE %s: %s' % (tag, msg))


def ok(msg):
    _n['ok'] += 1
    print('ok  %s' % msg)


def note(msg):
    print('note %s' % msg)


def anchor(phrase):
    """The spec must contain this phrase: it ties an encoded rule to the text it was read from."""
    if re.sub(r'\s+', ' ', phrase) not in FLAT:
        print('ANCHOR MISSING: %r' % phrase)
        sys.exit(2)


# ---------------------------------------------------------------------------------------------------------
# exact binomial bounds

def logpmf(i, n, p):
    if p <= 0.0:
        return 0.0 if i == 0 else float('-inf')
    if p >= 1.0:
        return 0.0 if i == n else float('-inf')
    return (math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1)
            + i * math.log(p) + (n - i) * math.log1p(-p))


def tail_ge(k, n, p):
    """P(X >= k) for X ~ Binomial(n, p)."""
    return sum(math.exp(logpmf(i, n, p)) for i in range(k, n + 1))


def lower_bound(k, n, conf=0.95):
    """One-sided lower bound on a rate after k successes in n (Clopper and Pearson)."""
    if k == 0:
        return 0.0
    lo, hi = 0.0, 1.0
    for _ in range(60):
        p = (lo + hi) / 2
        if tail_ge(k, n, p) < 1 - conf:
            lo = p
        else:
            hi = p
    return lo


def upper_bound(d, n, conf=0.95):
    """One-sided upper bound on a rate after d events in n."""
    return 1.0 - lower_bound(n - d, n, conf)


_lb = {}


def LB(k, n):
    if (k, n) not in _lb:
        _lb[(k, n)] = lower_bound(k, n)
    return _lb[(k, n)]


def least_agree(n, floor):
    """The least k with LB(k, n) >= floor, or None."""
    for k in range(n + 1):
        if LB(k, n) >= floor:
            return k
    return None


def least_n_for_rate(rate, floor, n0, n_max=4000):
    """The least n >= n0 at which the expected count floor(rate * n) passes the floor; None when the rate is at or
    under the floor, or when it takes more than n_max cases."""
    if rate <= floor:
        return None
    n = n0
    while n <= n_max:
        if LB(int(math.floor(rate * n + 1e-9)), n) >= floor:
            return n
        n += 1 if n < 200 else 10
    return None


BLIND = 1.0 / 8          # "About one in eight" (§6.6, §9.5)
FLOOR = 0.85             # Table 9.5a
RATES = (1, 5, 20)       # operator answers a day, as the brief asks


def days(n_answers):
    return ' / '.join('%s' % (('%.0f' % (n_answers / r)) if n_answers / r >= 10 else ('%.1f' % (n_answers / r))) for r in RATES)


# ---------------------------------------------------------------------------------------------------------
print('## T1. The bounds the text quotes')
anchor('12 agreeing cases out of 12 prove no more than 78% agreement at 95% confidence. 19 of 19 prove 85%, and 29 of 29 prove 90%')
for n, pct in [(12, 0.78), (19, 0.85), (29, 0.90)]:
    (ok if abs(LB(n, n) - pct) < 0.006 else (lambda m: ce('BOUND', m)))('%d of %d: lower bound %.3f (text %d%%)' % (n, n, LB(n, n), round(pct * 100)))
anchor('30 operator answers that were `blind` or `examined`, each with a shadow answer or a sealed prediction filed before it')
for n in (19, 20, 30, 31, 40, 60, 100, 200):
    k = least_agree(n, FLOOR)
    note('a lower bound of %.2f over %3d cases needs %3d agreeing (%d misses allowed); %d of %d gives %.3f'
         % (FLOOR, n, k, n - k, k - 1, n, LB(k - 1, n)))
n1 = next(n for n in range(19, 200) if LB(n - 1, n) >= FLOOR)
n2 = next(n for n in range(19, 400) if LB(n - 2, n) >= FLOOR)
note('with one miss the least count is %d; with two misses it is %d' % (n1, n2))

# ---------------------------------------------------------------------------------------------------------
print('\n## T2. The first gate: what `examined` selects (§6.6, Table 9.5a)')
anchor('So a plain accept of the recommendation is `glanced`, and a tap from a push that picks another option is `examined`: a disagreement always counts.')
anchor('Only `blind` and `examined` answers count as agreement (M1).')
anchor('Over its line (0.15 for the gap and 40% for the glanced share, to start)')
# p: the operator's own choice equals the Overlord's prediction. b: the blind share. x: of the accepts made with the
# recommendation in view, the share the operator examined (an edit, a note, or another option's downsides with a
# dwell). Every disagreement with the recommendation in view is `examined` by the first bullet of `examined`.
# Counted for the gate: blind answers (rate p), examined accepts, and every disagreement.


def pooled(p, b, x):
    agree = p * (b + (1 - b) * x)
    counted = agree + (1 - p)
    glanced = (1 - b) * p * (1 - x)
    return agree / counted, counted, glanced


print('| true agreement | examined share of accepts | glanced share of all answers | measured agreement | cases to pass | operator answers | days at 1 / 5 / 20 a day |')
print('|---|---|---|---|---|---|---|')
t2 = {}
for p in (0.90, 0.95, 0.98):
    for x in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
        a, c, g = pooled(p, BLIND, x)
        n = least_n_for_rate(a, FLOOR, 30)
        t2[(p, x)] = n
        never = 'never' if a <= FLOOR else 'over 4000'
        print('| %.2f | %.0f%% | %.0f%% | %.3f | %s | %s | %s |' % (
            p, x * 100, g * 100, a, n if n else never, ('%.0f' % (n / c)) if n else never, days(n / c) if n else never))
for p in (0.90, 0.95, 0.98):
    # the largest glanced share at which the measured agreement is still over the floor
    xs = [x / 100 for x in range(0, 101)]
    okx = [x for x in xs if pooled(p, BLIND, x)[0] > FLOOR]
    x0 = okx[0] if okx else None
    msg = 'at a true agreement of %.2f the measured agreement passes %.2f only while at least %.0f%% of accepts are examined (a glanced share of at most %.0f%%)' % (
        p, FLOOR, x0 * 100, pooled(p, BLIND, x0)[2] * 100)
    if pooled(p, BLIND, x0)[2] < 0.40:
        ce('G1-bias', msg + ': below the fatigue line of 40%, so the gate closes before the fatigue rule acts' +
           (' (kept, and stated in §9.5 as edited)' if FIX else ''))
    else:
        note(msg)
# Which rows carry a prediction is the Overlord's choice unless a missing one counts (§9.5 "is a miss").
anchor('The denominator is every escalated item in the cell. A missing prediction, where the Overlord had its triage window, is a miss.')
anchor('It settles no question alone.')
p_all, share, p_sure = 0.70, 0.5, 0.95
n_pick = least_n_for_rate(p_sure, FLOOR, 30)
if FIX:
    ok('a missing prediction on a row that waited its brief deadline is a disagreement in the bound: an Overlord right on %.0f%% of rows shows %.2f whichever rows it predicts' % (p_all * 100, p_all))
else:
    ce('G1-pick', 'before the hold tier nothing is "escalated", so no denominator binds: an Overlord right on %.0f%% of rows that seals predictions only on the %.0f%% '
                  'it is surest of (right on %.0f%% of those) shows %.2f and passes the first gate at %d cases' % (p_all * 100, share * 100, p_sure * 100, p_sure, n_pick))
note('the same Overlord scored on blind answers alone passes at %s cases (p 0.90, 0.95, 0.98): %s operator answers' % (
    ', '.join(str(least_n_for_rate(p, FLOOR, 30)) for p in (0.90, 0.95, 0.98)),
    ', '.join('%.0f' % (least_n_for_rate(p, FLOOR, 30) / BLIND) for p in (0.90, 0.95, 0.98))))

# ---------------------------------------------------------------------------------------------------------
print('\n## T3. The third gate: a change of model, skill or card template (Table 9.5a)')
anchor('the bound is no lower than the last generation\'s less 0.05, and the scenario suite passes')
anchor('the replay set, which holds only `blind` or `examined` answers')
TOL = 0.05
print('| replay set | bound at n of n | one answer changed | two changed | three changed | changed answers the gate tolerates |')
print('|---|---|---|---|---|---|')
for n in (19, 30, 40, 60, 100, 200, 400):
    k0 = n - max(1, round(0.05 * n))             # the last generation agreed on about 95%
    drops = [LB(k0, n) - LB(k0 - j, n) for j in (1, 2, 3)]
    tol = 0
    while k0 - tol - 1 >= 0 and LB(k0, n) - LB(k0 - tol - 1, n) <= TOL:
        tol += 1
    print('| %d | %.3f | -%.3f | -%.3f | -%.3f | %d |' % (n, LB(n, n), drops[0], drops[1], drops[2], tol))
    if tol == 0 and not FIX:
        ce('G3-noise', 'a replay set of %d: one changed answer moves the bound by %.3f, more than the gate\'s 0.05' % (n, drops[0]))


def false_fail(n, p):
    """P(the new replay's bound is under the last one's less 0.05) when both have the same true agreement p and are
    independent. The same questions are replayed, so the two are correlated and this is an upper estimate."""
    pm = [math.exp(logpmf(i, n, p)) for i in range(n + 1)]
    tot = 0.0
    for k1 in range(n + 1):
        if pm[k1] < 1e-12:
            continue
        for k2 in range(k1):
            if pm[k2] < 1e-12:
                continue
            if LB(k2, n) < LB(k1, n) - TOL:
                tot += pm[k1] * pm[k2]
    return tot


if not FIX:
    print('| replay set | false failure at equal true agreement 0.90 | at 0.95 |')
    print('|---|---|---|')
    for n in (30, 60, 100, 200, 400):
        f90, f95 = false_fail(n, 0.90), false_fail(n, 0.95)
        print('| %d | %.0f%% | %.0f%% |' % (n, f90 * 100, f95 * 100))
        if f95 > 0.10:
            ce('G3-noise', 'a replay set of %d and no change in judgement: the gate fails %.0f%% of changes (independent replays, true agreement 0.95)' % (n, f95 * 100))
if FIX:
    ref = LB(29, 30)                              # the bound the kind was armed on: 29 of 30
    print('| replay set | false failure against a fixed reference of %.3f, true agreement 0.90 | at 0.95 |' % ref)
    print('|---|---|---|')
    for n in (30, 60, 100, 200, 400):
        out = []
        for p in (0.90, 0.95):
            pm = [math.exp(logpmf(i, n, p)) for i in range(n + 1)]
            lo = int(n * p - 8 * math.sqrt(n * p * (1 - p)) - 2)
            out.append(sum(pm[k] for k in range(max(0, lo), n + 1) if LB(k, n) < ref - TOL) + sum(pm[:max(0, lo)]))
        print('| %d | %.0f%% | %.0f%% |' % (n, out[0] * 100, out[1] * 100))
    note('a failure raises one item, and the operator may arm the kind on that digest: chance no longer leaves a kind in shadow')
# the ratchet: each change passes at exactly the last generation's bound less 0.05
b, steps = 0.90, []
while b - TOL > 0.5:
    b = b - TOL
    steps.append(b)
if FIX:
    ok('the reference is the bound the operator armed the kind on, and a pass never moves it: a kind armed at 0.90 never answers under 0.85')
else:
    ce('G3-ratchet', 'each change passes at "the last generation\'s less 0.05": a kind armed at 0.90 answers at %s after %d changes, every gate green' % (
        ', '.join('%.2f' % s for s in steps[:6]), len(steps[:6])))
anchor('the third gate holds answers in shadow until the replay passes')
anchor('| A change of model, skill or card template | the replay set')
note('Table 9.5a gives the third gate no least count: before the first gate passes, the replay set is under 30 cases')

# ---------------------------------------------------------------------------------------------------------
print('\n## T4. `askOrAct` cells (§6.3, Table 11.5b)')
anchor('`W_wrong`: reversible and routine 7, reversible and big 20, compensable and routine 20, compensable and big 60')
anchor('`W_ask`: batchable 1, `blocking-by` 1.5, `blocking-now` 2')
anchor('Its record comes from blind answers, weekly spot-checks (§9.6) and overturns.')
W_WRONG = {'routine': 20, 'big': 60}
W_ASK = {'batchable': 1.0, 'blocking-by': 1.5, 'blocking-now': 2.0}


def least_clean(u_max, d=0):
    n = max(1, d)
    while upper_bound(d, n) > u_max:
        n += 1
    return n


print('| size | urgency | lambda | bound needed | clean blind answers | with one disagreement | escalations in the cell at one in eight | days at 1 / 5 / 20 a day |')
print('|---|---|---|---|---|---|---|---|')
t4 = {}
for lam in (1, 3):
    for size in ('routine', 'big'):
        for urg in ('batchable', 'blocking-by', 'blocking-now'):
            u = lam * W_ASK[urg] / W_WRONG[size]
            c0, c1 = least_clean(u), least_clean(u, 1)
            t4[(lam, size, urg)] = (c0, c1)
            print('| %s | %s | %d | %.3f | %d | %d | %d | %s |' % (size, urg, lam, u, c0, c1, c0 * 8, days(c0 * 8)))
anchor('about sixty blind answers with none overturned')
anchor('about 180 such answers, and 0.033 when the row blocks now, about ninety')
(ok if t4[(1, 'routine', 'batchable')][0] == 59 and t4[(1, 'big', 'batchable')][0] == 179 and t4[(1, 'big', 'blocking-now')][0] == 89
 else (lambda m: ce('ASK', m)))('the text\'s "about sixty", "about 180" and "about ninety" are 59, 179 and 89')
# What feeds a cell before it has ever acted, and after.
anchor('**Three spot-checks** of recent Overlord answers the operator never saw.')
note('before a cell acts, a weekly spot-check has nothing to draw from it: its only source is the blind sample of its escalations')
note('once a cell acts, its rows are answered and no longer escalated: the blind sample stops, and the record grows by at most 3 spot-checks a week, shared by every cell')
n59 = t4[(1, 'routine', 'batchable')][0]
note('a cell that needs %d clean cases and gets only spot-checks: %d weeks if every spot-check of every week fell in it' % (n59, math.ceil(n59 / 3)))

# ---------------------------------------------------------------------------------------------------------
print('\n## T5. The grant gate (§7.2, Table 9.5a)')
anchor('| A grant proposal, per effect and scope | 19 blind, spread over at least five days and distinct subjects, with a cap on cases from one programme | the same bound |')
anchor('`scope`: a programme\'s row and its incarnation, never its slug')
anchor('**Evidence is an interval, for one effect and one scope.**')
k19 = least_agree(19, FLOOR)
note('19 blind cases pass only at %d of 19; one miss needs %d blind cases, two need %d' % (k19, n1, n2))
for reading, cap in (('per effect and scope', 'under 19'), ('per effect and scope', '19 or more'), ('per effect, across programmes', 'under 19')):
    if reading == 'per effect and scope' and cap == 'under 19':
        res = 'unsatisfiable: every case is from the scope\'s one programme'
    elif reading == 'per effect and scope':
        res = 'the cap never binds'
    else:
        res = 'satisfiable, and §7.2\'s "one scope" is false'
    print('reading: evidence %s, a cap %s -> %s' % (reading, cap, res))
if FIX:
    ok('the cap is dropped: a scope is one programme, so the row asks for 19 blind cases of one effect in one programme')
else:
    ce('G2-cap', 'a scope is one programme: "a cap on cases from one programme" is either unsatisfiable (a cap under 19) or never binds')
note('19 blind cases at one in eight are %d questions of one effect in one programme: %s days at 1 / 5 / 20 such questions a day' % (19 * 8, days(19 * 8)))
note('with one miss: %d questions; the five days are met by then at any rate under %d a day' % (n1 * 8, 19 * 8 // 5))
anchor('the one-sided 95% lower bound, and the window.')
if FIX:
    ok('the window is rolling, and its length is a starting value of Table 11.5b')
else:
    ce('G2-window', 'the grant evidence has "the window" and no length for it: at 30 days the gate needs %.1f questions a day of one effect in one '
                    'programme, at 90 days %.1f, at 180 days %.1f' % (152 / 30.0, 152 / 90.0, 152 / 180.0))
anchor('The renewal sheet shows three acts from the grant\'s last period as blind spot-checks.')
anchor('Every grant expires after 30 days.')
note('a renewal needs three acts under the grant in its 30 days; an O3 item of one effect in one programme may come less often')

# ---------------------------------------------------------------------------------------------------------
print('\n## T6. The label queue (§3.7)')
anchor('That takes 29 labelled answers beyond the line with no error for a 10% target, and 59 for 5%.')
anchor('Up to ten one-tap cards a week across all rows')
(ok if least_clean(0.10) == 29 and least_clean(0.05) == 59 else (lambda m: ce('BOUND', m)))('a 10%% target needs %d clean answers and a 5%% target %d' % (least_clean(0.10), least_clean(0.05)))
# Rows whose label source is `label-queue` in Table 3.7b, with the wave each ships in, and the labels its line needs.
QUEUE_ROWS = [('scope.widens', 2, 59), ('relay.method', 2, 29), ('readback.omits', 2, 29), ('readback.adds', 2, 29),
              ('precedent.same', 3, 29), ('passage.instructs', 3, 29), ('audit.follows', 3, 29), ('audit.outcome', 3, 29),
              ('audit.cited-supports', 3, 29), ('entries.same', 4, 29), ('entries.contradict', 4, 29), ('practice.widens', 5, 29)]
for r, w, need in QUEUE_ROWS:
    anchor('`%s`' % r)
total = sum(n for _, _, n in QUEUE_ROWS)
note('%d rows take their labels from the queue; their lines need %d labels beyond the line in all: %.0f weeks at ten a week, if every card lands beyond a line' % (
    len(QUEUE_ROWS), total, total / 10))


def queue(policy, weeks=400, wave_gap=8):
    """Ten cards a week. A row's cases arrive every week once its wave has shipped (waves `wave_gap` weeks apart);
    arrivals outnumber the cards. Returns the week each row's line is admitted, or None."""
    have = {r: 0 for r, _, _ in QUEUE_ROWS}
    done = {}
    backlog = []                                   # (arrival week, row), oldest first
    for wk in range(weeks):
        live = [(r, n) for r, w, n in QUEUE_ROWS if (w - 2) * wave_gap <= wk]
        for r, n in live:
            backlog.extend([(wk, r)] * 6)          # six fresh cases a row a week: more than ten in all
        cards = 10
        if policy == 'oldest case first':
            take, backlog = backlog[:cards], backlog[cards:]
            for _, r in take:
                have[r] += 1
        elif policy == 'newest case first':
            take, backlog = backlog[-cards:], backlog[:-cards]
            for _, r in take:
                have[r] += 1
        elif policy == 'a gate first, then the row nearest its line':
            order = sorted([(r, n) for r, n in live if have[r] < n], key=lambda rn: (0 if rn[0] == 'scope.widens' else 1, rn[1] - have[rn[0]]))
            for r, n in order:
                t = min(cards, n - have[r])
                have[r] += t
                cards -= t
        elif policy == 'equal shares':
            need = [r for r, n in live if have[r] < n]
            i = 0
            while cards and need:
                have[need[i % len(need)]] += 1
                cards -= 1
                i += 1
        for r, w, n in QUEUE_ROWS:
            if r not in done and have[r] >= n:
                done[r] = wk + 1
    return done


print('| how the ten cards are shared | first line admitted | `scope.widens` (a gate, 59) | last line admitted | rows with no line after 400 weeks |')
print('|---|---|---|---|---|')
for pol in ('oldest case first', 'newest case first', 'equal shares', 'a gate first, then the row nearest its line'):
    d = queue(pol)
    missing = [r for r, _, _ in QUEUE_ROWS if r not in d]
    print('| %s | week %s | week %s | %s | %s |' % (pol, min(d.values()) if d else '-', d.get('scope.widens', '-'),
                                               ('week %d' % max(d.values())) if d and not missing else '-', len(missing)))
    if missing and not FIX:
        ce('LQ-starve', 'ten cards a week shared "%s": %d rows never reach a line (%s ...)' % (pol, len(missing), missing[0]))
anchor('| `grant.inside` | Yes or no, blind | Is this answer inside the grant\'s scope? A strict yes line | Fail closed when armed. Skipped when the operator has not armed it | A false yes* | 5%* | `overturn` |')
if FIX:
    ok('`grant.inside` takes its labels from the queue as well: a right yes can be labelled')
else:
    ce('LQ-source', '`grant.inside` needs 59 labelled yes answers with no error, and its one label source, `overturn`, labels a yes only as wrong: its line is never admitted')

# ---------------------------------------------------------------------------------------------------------
print('\n## T7. The consistency divisor (§9.5)')
anchor('So agreement is divided by the operator\'s own consistency, measured on near-duplicate questions they answered at least a week apart.')
anchor('Below 20 such pairs the divisor is 1.')
print('| pairs | consistent | divisor as written (the rate) | raw bound the 0.85 floor then asks | agreeing of 30 | divisor at its 95% upper bound | agreeing of 30 |')
print('|---|---|---|---|---|---|---|')
worst = None
for pairs, cons in ((20, 20), (20, 18), (20, 16), (20, 14), (50, 40), (100, 81)):
    c = cons / pairs
    cu = upper_bound(pairs - cons, pairs)         # the upper bound on the consistency rate
    cu = 1.0 - lower_bound(pairs - cons, pairs) if cons < pairs else 1.0
    k_as = least_agree(30, FLOOR * c)
    k_ub = least_agree(30, FLOOR * min(1.0, cu))
    print('| %d | %d | %.2f | %.3f | %d | %.2f | %d |' % (pairs, cons, c, FLOOR * c, k_as, min(1.0, cu), k_ub))
    if pairs == 20 and cons == 14:
        worst = (k_as, k_ub)
if FIX:
    ok('the divisor is the upper bound of the consistency rate: 14 of 20 consistent pairs ask for %d of 30, not %d' % (worst[1], worst[0]))
else:
    ce('G-divisor', 'the divisor is a point estimate on as few as 20 pairs: at 14 of 20 the "0.85" gate passes at %d of 30 agreeing (%d misses)' % (worst[0], 30 - worst[0]))

# ---------------------------------------------------------------------------------------------------------
print('\n## T8. The auditor\'s model (§3.4, §9.5)')
anchor('One decider, `auditorModelFor`, takes the generation\'s model and never returns it.')
anchor('every box-token write that names `fable` is refused')
anchor('the auditor. The served ids come from server rows')
CLASSES = ['fable', 'opus']                       # the designation's two classes (C45)
GUEST_OK = {'fable': False, 'opus': True}         # the auditor is a guest: a reservation serves named sessions, and
#                                                   Fable runs only where the operator selected it (D-6790)
extra = ['sonnet'] if FIX else []
for judged in CLASSES:
    cands = [c for c in CLASSES + extra if c != judged and (GUEST_OK.get(c, True))]
    if cands:
        ok('the Overlord on %s: the auditor may run %s' % (judged, ' or '.join(cands)))
    else:
        ce('AUD-total', 'the Overlord on %s (a fallback generation): no class is left for the auditor. `fable` is the operator\'s choice for the '
                        'designated session only, and `opus` is the judged model' % judged)

# ---------------------------------------------------------------------------------------------------------
print('\n## T9. The operator\'s week when every mechanism asks at once (§4.1, §3.7, §9.5, §9.6, §7.2)')
anchor('| Weekly | About ten minutes | One Week page: the weekly check (§9.6)')
anchor('- **A weekly check of about five minutes.**')
anchor('The operator labels twenty audit rows a quarter.')
GRANTS = 3
load = [
    ('the weekly check (§9.6)', 5, 'five cards at most', 5.0, 'inside the Week page'),
    ('the rest of the Week page (§4.1)', 0, 'the track record, overturns, ladder changes, drills, grants, entries', 5.0, 'about ten minutes with the check'),
    ('the daily view, seven days (§4.1)', 0, 'about two minutes a day', 14.0, 'its own cadence'),
    ('the label queue (§3.7)', 10, 'up to ten one-tap cards', 10 * 0.5, 'in no cadence of Table 4.1a'),
    ('the judge\'s labels (§9.5)', round(20 / 13.0, 1), 'twenty audit rows a quarter', 20 / 13.0, 'monthly, "not fixed"'),
    ('grant renewals, %d grants (§7.2)' % GRANTS, round(GRANTS * 3 / 4.3, 1), 'three spot-checks a grant every 30 days', GRANTS * 3 / 4.3, 'monthly, "not fixed"'),
    ('the blind sample\'s second step (§9.5)', 0, 'one escalation in eight is answered twice', 0.0, 'in the decision queue'),
]
print('| what asks | cards a week | from | minutes a week | where it is budgeted |')
print('|---|---|---|---|---|')
for name, cards, src, mins, where in load:
    print('| %s | %s | %s | %.1f | %s |' % (name, cards, src, mins, where))
cards = sum(c for _, c, _, _, _ in load)
mins = sum(m for _, _, _, m, _ in load)
note('in all: %.1f cards and about %.0f minutes a week, at half a minute a one-tap card and one minute a spot-check or label' % (cards, mins))
note('the promises hold one by one: five cards in the check, ten label cards. Table 4.1a budgets %d of the %.0f minutes' % (10 + 14, mins))
if not FIX:
    ce('LOAD-unbudgeted', 'the label queue\'s ten cards a week sit in no cadence of Table 4.1a, and "behind the operator\'s own items" gives them no place on the Week page')

# ---------------------------------------------------------------------------------------------------------
print('\n## T10. What it takes to earn each kind of trust')
print('An "answer" is an operator answer that falls in the gate\'s own population: one kind, one cell, or one effect in one')
print('programme. Days are at 1, 5 and 20 such answers a day. The blind share is one in eight.')
print('| Gate | The events it needs | Least count | Operator answers | Days at 1 a day | at 5 | at 20 | Practical? |')
print('|---|---|---|---|---|---|---|---|')


def dcols(n):
    if not n:
        return ['-', '-', '-']
    return [('%.0f' % (n / r)) if n / r >= 10 else ('%.1f' % (n / r)) for r in RATES]


rows = []
rows.append(('A kind of answer leaves shadow (Table 9.5a, row 1): every accept examined', 'answers of that kind, `blind` or `examined`, a prediction sealed before each',
             '30, at most 1 miss', 30, 'yes'))
for x, lab in ((0.6, 'three accepts in five examined'), (0.4, 'two accepts in five examined')):
    a, c, g = pooled(0.95, BLIND, x)
    n = least_n_for_rate(a, FLOOR, 30)
    rows.append(('the same, true agreement 0.95, %s' % lab, 'as above; every disagreement counts, a plain accept does not', '%d' % n, n / c, 'yes' if n / c < 200 else 'slow'))
a, c, g = pooled(0.95, BLIND, 0.0)
rows.append(('the same, no accept examined', 'only the blind answers and the disagreements count', 'never: the measured agreement is %.2f' % a, None, 'no'))
rows.append(('A grant proposal (row 2)', '`blind` answers on one effect in one programme, on five days', '19 of 19', 19 * 8, 'no: 152 O3 questions of one effect in one programme'))
rows.append(('the same, one miss', 'as above', '%d of %d' % (n1 - 1, n1), n1 * 8, 'no'))
rows.append(('A grant leaves shadow (§7.2)', 'the operator\'s tap on its shadow report', 'no least count', None, 'yes: the operator\'s call'))
rows.append(('A grant renews (§7.2)', 'three acts under the grant in its 30 days, answered as spot-checks', '3 acts every 30 days', None, 'only for a busy effect'))
rows.append(('A change of model, skill or card (row 3)', 'a replay of the replay set, and the scenario suite', 'no least count; no operator answer', None,
             'fails by chance %.0f%% of the time at 30 cases' % (false_fail(30, 0.95) * 100)))
for (lam, size, urg) in ((1, 'routine', 'batchable'), (1, 'routine', 'blocking-now'), (1, 'big', 'batchable'), (1, 'big', 'blocking-now'), (3, 'routine', 'batchable'), (3, 'big', 'batchable')):
    c0 = t4[(lam, size, urg)][0]
    rows.append(('An `askOrAct` cell acts: %s, %s, `lambda` %d' % (size, urg, lam), 'clean `blind` answers in that cell', '%d' % c0, c0 * 8,
                 'no' if c0 * 8 / 5 > 60 else 'slow'))
eq = queue('equal shares')
gf = queue('a gate first, then the row nearest its line')
rows.append(('A decision-model line, 10% target', 'label cards beyond the line, none wrong', '29', None,
             '%d weeks alone; weeks %d to %d at equal shares of ten cards' % (math.ceil(29 / 10), min(eq.values()), max(eq.values()))))
rows.append(('A decision-model line, 5% target (`scope.widens`)', 'as above', '59', None,
             '%d weeks alone; week %d at equal shares, week %d gate first' % (math.ceil(59 / 10), eq['scope.widens'], gf['scope.widens'])))
rows.append(('`grant.inside`, 5% target', 'labels from `overturn` only', '59 yes answers labelled right', None, 'no: an overturn labels a yes only as wrong'))
for g_, ev, cnt, ans, prac in rows:
    d = dcols(ans)
    print('| %s | %s | %s | %s | %s | %s | %s | %s |' % (g_, ev, cnt, '-' if ans is None else ('%.0f' % ans), d[0], d[1], d[2], prac))

print('\n== arith%s: counterexamples %d; checks passed %d' % (' (with the proposed edits)' if FIX else '', _n['ce'], _n['ok']))
