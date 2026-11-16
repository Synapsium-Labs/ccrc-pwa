"""Machine 5: one playbook entry (§9.7, Table 9.7b). A light model, made last.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it, §9.7, §10.5. Section numbers are that file's.

One entry with a direction (`narrow` or `widen`) and a basis (`measured` or `operator`). The
canary serves it on most occurrences and withholds it on the rest (the holdout). Clocks are
ticks left: 45 days is RENEW ticks from live, 90 days is OLD ticks. NEED exposures stand for
the 20 a `narrow` entry needs. Each tap and each event has a budget.
"""
from collections import namedtuple

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    DIRECTION='narrow', BASIS='measured', NEED=2, RENEW=2, OLD=4,
    EXPOSURES=3, BREACHES=1, TICKS_OP=1, BUDGET_FULL=False, CONTRADICTS=True, PR_MERGES=1,
    # ---- switches: readings of the text -------------------------------------------------
    LIVE_HOLDOUT='kept',         # a live entry still has a holdout: 'kept' | 'none'
    NO_MEASURE='retire',         # 45 days with nothing measured: 'retire' | 'renew'
    CONTRADICT='retired',        # a proposed entry whose replay contradicts: 'retired' | 'stays-proposed'
    AGE_FROM='first-serving',    # "90 days without graduation" counts from: 'first-serving' | 'live'
    OPERATOR_BREACH='item',      # a guard breach on an `operator` entry: an 'item' | 'retire'
    MUTATION=None,
)

# st: proposed shadow canary live graduated retired
S = namedtuple('S', 'st held meas sign renew old breach item byop b_exp b_breach b_tick b_pr replayed')


def init(c):
    st = 'live' if c.BASIS == 'operator' else 'proposed'      # Table 9.7b: an operator entry is live at the tap
    return S(st=st, held=0, meas=False, sign=0, renew=c.RENEW if st == 'live' else -1,
             old=c.OLD if st == 'live' else -1, breach=False, item=False, byop=False,
             b_exp=c.EXPOSURES, b_breach=c.BREACHES, b_tick=c.TICKS_OP, b_pr=c.PR_MERGES, replayed=False)


def fmt(s):
    return 'entry=%s holdout-exposures=%d %s renew-in=%s age-left=%s%s%s%s' % (
        s.st, s.held, 'effect=%s' % ('none measured' if not s.meas else ('non-negative' if s.sign >= 0 else 'negative')),
        'n/a' if s.renew < 0 else s.renew, 'n/a' if s.old < 0 else s.old,
        ' guard-breached' if s.breach else '', ' operator-item' if s.item else '',
        ' retired-by-operator' if s.byop else '')


def retire(s):
    return s._replace(st='retired', renew=-1, old=-1)


def urgent(s, c):
    op = c.BASIS == 'operator'
    # Table 9.7b: "any state to retired: automatic on a guard breach"
    if s.breach and s.st in ('canary', 'live') and c.MUTATION != 'breach_ignored':
        if op and c.OPERATOR_BREACH == 'item':
            if not s.item:
                yield 'practice lane: a guard breach on an operator entry raises an item', s._replace(item=True)
        else:
            yield 'practice lane: guard breach, the entry is retired', retire(s)
            return
    if s.st == 'proposed' and not s.replayed:
        # "proposed to shadow: automatic, after a clean replay of the last 60 days; otherwise refused"
        yield 'practice lane: the 60-day replay is clean, `shadow`', s._replace(st='shadow', replayed=True)
        if c.CONTRADICTS:
            if c.CONTRADICT == 'retired':
                yield 'practice lane: the replay contradicts (`practice-contradicts`), `retired`', \
                    retire(s._replace(replayed=True))
            else:
                yield 'practice lane: the replay contradicts (`practice-contradicts`); the row stays', \
                    s._replace(replayed=True)
    if s.st == 'shadow' and (c.DIRECTION == 'narrow' or c.MUTATION == 'widen_auto'):
        # "shadow to canary: a `narrow` entry: automatic"
        yield 'practice lane: `canary`', s._replace(st='canary', old=c.OLD if c.AGE_FROM == 'first-serving' else -1)
    if s.st == 'canary' and c.DIRECTION == 'narrow' and not c.BUDGET_FULL:
        # "canary to live: automatic, once the holdout shows a non-negative effect over at least 20 exposures"
        need = 0 if c.MUTATION == 'canary_needs_nothing' else c.NEED
        if s.held >= need and (s.sign >= 0 or c.MUTATION == 'canary_needs_nothing'):
            yield 'practice lane: the holdout is non-negative, `live`', \
                s._replace(st='live', renew=c.RENEW, old=s.old if s.old >= 0 else c.OLD, held=0, meas=False, sign=0)
    if s.st == 'live' and not op:
        if s.renew == 0:
            # "live to live, renewed: at 45 days, on a non-negative measured effect"
            if s.meas and s.sign >= 0:
                yield 'practice lane: 45 days, a non-negative measured effect, renewed', \
                    s._replace(renew=c.RENEW, meas=False, sign=0, held=0)
            elif not s.meas and c.NO_MEASURE == 'renew':
                yield 'practice lane: 45 days, nothing measured, renewed all the same', s._replace(renew=c.RENEW)
            else:
                yield 'practice lane: 45 days, %s: the entry expires, `retired`' % (
                    'a negative effect' if s.meas else 'nothing measured'), retire(s)
    if s.st in ('canary', 'live') and s.old == 0 and not op:
        yield 'practice lane: 90 days without graduation, `retired`', retire(s)


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    urg = list(urgent(s, c))
    for lbl, s2 in urg:
        add(lbl, s2, actor='server')
    if not urg:
        s2 = s
        if s.renew > 0:
            s2 = s2._replace(renew=s.renew - 1)
        if s.old > 0:
            s2 = s2._replace(old=s.old - 1)
        add('tick', s2, actor='time')
    served = s.st == 'canary' or s.st == 'live' or (c.MUTATION == 'serve_retired' and s.st == 'retired')
    if served and s.b_exp and not urg:        # servings fall between the lane's sweeps
        add('the trigger fires and the entry is served', s._replace(b_exp=s.b_exp - 1), actor='env', serve=True)
        holdout = s.st == 'canary' or (s.st == 'live' and c.LIVE_HOLDOUT == 'kept')
        if holdout:
            for sign, word in ((0, 'no worse'), (-1, 'worse')):
                add('the trigger fires and the entry is withheld (the holdout); the outcome with it is %s' % word,
                    s._replace(b_exp=s.b_exp - 1, held=min(s.held + 1, c.NEED), meas=True,
                               sign=min(s.sign, sign)), actor='env')
        if s.b_breach and not s.breach:
            add('a serving breaches the entry`s guard', s._replace(breach=True, b_breach=s.b_breach - 1), actor='env')
    if s.b_tick:
        b = s.b_tick - 1
        if s.st == 'shadow' and c.DIRECTION == 'widen':
            add('operator: ticks the entry into canary',
                s._replace(st='canary', old=c.OLD if c.AGE_FROM == 'first-serving' else -1, b_tick=b),
                actor='operator')
        if s.st == 'canary' and (c.DIRECTION == 'widen' or c.BUDGET_FULL):
            if not c.BUDGET_FULL:
                add('operator: ticks the entry live', s._replace(st='live', renew=c.RENEW,
                                                               old=s.old if s.old >= 0 else c.OLD, b_tick=b),
                    actor='operator')
        if s.st not in ('retired', 'graduated'):
            add('operator: retires the entry', retire(s)._replace(b_tick=b, byop=True), actor='operator')
    if s.st == 'live' and s.b_pr and c.BASIS != 'operator':
        add('practice lane: the guard or skill pull request merged, `graduated`',
            s._replace(st='graduated', renew=-1, old=-1, b_pr=s.b_pr - 1), actor='server')
    return E


def pr1(s, lbl, info, s2, c):
    # Table 9.7b: "live to live, renewed: the practice lane, at 45 days, on a non-negative measured effect"
    if lbl.startswith('practice lane: 45 days') and s2.st == 'live' and not (s.meas and s.sign >= 0):
        return 'the entry was renewed with %s' % ('nothing measured' if not s.meas else 'a negative effect')
    return None


def pr2(s, lbl, info, s2, c):
    # §9.7: an `operator` entry "goes live at the operator's tap and never expires by itself";
    # "An `operator` entry lasts until it is retired."
    if c.BASIS == 'operator' and s.st == 'live' and s2.st == 'retired' and info['actor'] != 'operator':
        return 'the server retired an operator`s entry by itself'
    return None


def pr3(s, lbl, info, s2, c):
    if s.st in ('retired', 'graduated') and s2.st != s.st:
        return 'the entry left `%s`' % s.st
    return None


def pr4(s, lbl, info, s2, c):
    # "canary to live: a `narrow` entry: automatic, once the holdout shows a non-negative effect over at least
    # 20 exposures"; "shadow to canary ... A `widen` or `role:overlord` entry: the operator's tick"
    if s.st == 'canary' and s2.st == 'live' and info['actor'] == 'server' and not (s.held >= c.NEED and s.sign >= 0):
        return 'the entry went live by itself on %d holdout exposures (it needs %d)' % (s.held, c.NEED)
    if c.DIRECTION == 'widen' and s.st != s2.st and s2.st in ('canary', 'live') and info['actor'] != 'operator':
        return 'a `widen` entry moved to `%s` with no tick from the operator' % s2.st
    return None


def pr6(s, lbl, info, s2, c):
    if info.get('serve') and s.st not in ('canary', 'live'):
        return 'an entry in `%s` was served' % s.st
    if info.get('serve') and s.breach and c.BASIS != 'operator':
        return 'an entry was served after its guard was breached'
    return None


STATE_CHECKS = []
EDGE_CHECKS = [('PR1', pr1), ('PR2', pr2), ('PR3', pr3), ('PR4', pr4), ('PR6', pr6)]


def _server_only(lbl):
    return lbl == 'tick' or lbl.startswith('practice lane') and 'pull request' not in lbl


LIVE_CHECKS = [
    # a proposed entry does not stand for ever: the lane moves it on, or ends it
    ('PL1', lambda s, c: s.st == 'proposed', lambda s, c: s.st != 'proposed', _server_only),
    # a measured entry that is being served ends by itself or is renewed on a measure: it never just stands
    ('PL2', lambda s, c: s.st == 'canary' and c.BASIS != 'operator' and c.DIRECTION == 'narrow',
     lambda s, c: s.st in ('live', 'retired', 'graduated'), _server_only),
]

FACTS = [
    ('an entry reaches `graduated`', lambda s, c: s.st == 'graduated'),
    ('an entry reaches `live`', lambda s, c: s.st == 'live'),
]

SCEN = {
    'narrow': dict(DIRECTION='narrow', BASIS='measured', EXPOSURES=4, BREACHES=1, TICKS_OP=1),
    'narrow-full': dict(DIRECTION='narrow', BASIS='measured', EXPOSURES=3, BREACHES=0, TICKS_OP=0, BUDGET_FULL=True),
    'widen': dict(DIRECTION='widen', BASIS='measured', EXPOSURES=3, BREACHES=1, TICKS_OP=2),
    'operator': dict(DIRECTION='narrow', BASIS='operator', EXPOSURES=2, BREACHES=1, TICKS_OP=1, CONTRADICTS=False),
}

READINGS = [
    (('LIVE_HOLDOUT', 'NO_MEASURE'), ('none', 'renew'), 'narrow', 'PR1'),
    ('CONTRADICT', 'stays-proposed', 'narrow', 'PL1'),
    ('AGE_FROM', 'live', 'narrow-full', 'PL2'),
    ('OPERATOR_BREACH', 'retire', 'operator', 'PR2'),
]

MUTATIONS = [
    ('canary_needs_nothing', 'narrow', {}, 'PR4'),
    ('widen_auto', 'widen', {}, 'PR4'),
    ('serve_retired', 'narrow', {}, 'PR6'),
    ('breach_ignored', 'narrow', {}, 'PR6'),
]

TRACES = [
    ('practice-renewed-unmeasured', 'narrow', dict(LIVE_HOLDOUT='none', NO_MEASURE='renew'), ('PR1',)),
    ('practice-proposed-stays', 'narrow', dict(CONTRADICT='stays-proposed'), ('PL1',)),
    ('practice-canary-waits-for-ever', 'narrow-full', dict(AGE_FROM='live'), ('PL2',)),
    ('practice-operator-entry-retired', 'operator', dict(OPERATOR_BREACH='retire'), ('PR2',)),
]
