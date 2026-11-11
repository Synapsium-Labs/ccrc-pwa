"""Machine 4: the push outbox under the attention budget.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it, §4.2 (H35, Table 4.2a), §6.7 ("Pushes go through an outbox"), I2 and I9
(Table 11.7a), Table 11.5b (the one-hour lead time). Section numbers are that file's.

One question row reaches the operator at some tick. Its level is one of:
  now    a verified `blocking-now` (the server measures a run or a hold waiting behind it)
  by     `blocking-by` a time D; its deferral limit is D less the lead time
  batch  `batchable`; its deferral limit is the next briefing time
  block  a coordinator's blocking item the Overlord's tier never held (`mayHold` false): today's
         build pushes it once, at once, and I9 says this build must do the same

The budget is live (not in shadow). One day: BRIEF holds the briefing times, QUIET the quiet
hours [from, to), BUDGET the interrupting pushes left. Time moves in ticks up to T_MAX.
"""
from collections import namedtuple

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    T_MAX=6, LEVEL='by', D=4, LEAD=1, BRIEF=(5,), QUIET=(), BUDGET=1, REPEAT_AFTER=2,
    RAISE_BY=3,            # the row reaches the operator at some tick up to this one
    SPENDS=1,              # other interrupting pushes that can spend the budget first
    CRASHES=0, PUSH_FAILS=0, CONSOLE=True,
    # ---- switches: readings of the text -------------------------------------------------
    SPENT_BY='push',             # a `blocking-by` at its limit with the budget spent: 'push' | 'defer' (the text)
    QUIET_RULE='limit-wins',     # quiet hours against a deferral limit: 'limit-wins' | 'defers'
    CONSOLE_SETTLES='batch-only',  # opening the console settles: a pending 'batch-only' | 'all-deferred'
    NOBRIEF='push-now',          # `batchable` with no briefing time set: 'push-now' | 'never' (the text)
    BOOT_SENDS='unsent-only',    # the boot pass sends: 'unsent-only' | 'deferred-too' ("every unsent row")
    REPEAT_SCOPE='tier-only',    # the two-hour repeat applies to: rows the tier held ('tier-only') | 'all-blocking'
    REPEAT_ROW='same-row',       # the repeat: re-sends the row's one outbox row | a 'new-row'
    MUTATION=None,
)

S = namedtuple('S', 't up psvc con reach rat ob defat obn pushes sentat rep seen ans bud over fault '
                    'b_spend b_crash b_pf')


def init(c):
    return S(t=0, up=True, psvc=True, con=False, reach=False, rat=-1, ob='none', defat=-1, obn=0, pushes=0,
             sentat=-1, rep='none', seen=False, ans=False, bud=c.BUDGET, over=0, fault=False,
             b_spend=c.SPENDS, b_crash=c.CRASHES, b_pf=c.PUSH_FAILS)


def fmt(s):
    return ('t=%d %s%s%s | row: %s%s outbox=%s%s (%d row%s) notifications=%d%s%s | budget left=%d overdrafts=%d' % (
        s.t, 'up' if s.up else 'DOWN', '' if s.psvc else ' push-service-down', ' console-open' if s.con else '',
        'reached@%d' % s.rat if s.reach else 'not raised', ' answered' if s.ans else '',
        s.ob, ' until %d' % s.defat if s.ob == 'deferred' and s.defat >= 0 else
        (' with no time' if s.ob == 'deferred' else ''), s.obn, '' if s.obn == 1 else 's', s.pushes,
        ' repeat-sent' if s.rep == 'done' else '', ' seen' if s.seen else '', s.bud, s.over))


def in_quiet(t, c):
    return bool(c.QUIET) and c.QUIET[0] <= t < c.QUIET[1]


def next_brief(t, c):
    for b in c.BRIEF:
        if b >= t:
            return b
    return -1


def limit(c):
    return c.D - c.LEAD          # Table 4.2a: "That time, less a lead time (Table 11.5b)"


def admit(s, c):
    """`pushAdmission` (§4.2), asked when the row reaches the operator and again when a deferral ends.
    Returns the outbox state to write: ('unsent', cost) | ('deferred', until)."""
    lv, t = c.LEVEL, s.t
    if lv == 'block':
        return ('unsent', 0)                    # not a push the tier causes: as today's build (I9)
    if lv == 'now':
        if c.MUTATION == 'budget_blocks_now' and s.bud == 0:
            return ('deferred', next_brief(t, c))
        return ('unsent', 1)                    # "None: it pushes at once"; an overdraft when spent
    if lv == 'by':
        lim = limit(c)
        if c.MUTATION == 'deferral_ignores_deadline':
            return ('deferred', next_brief(t, c))
        if t < lim:
            return ('deferred', lim)
        if in_quiet(t, c) and c.QUIET_RULE == 'defers':
            return ('deferred', c.QUIET[1])
        if s.bud == 0 and c.SPENT_BY == 'defer':
            # "A spent budget lets only a verified `blocking-now` through."
            if next_brief(t, c) == t:
                return ('unsent', 0)            # "A push at a briefing time costs 0."
            return ('deferred', next_brief(t, c))
        return ('unsent', 1)
    # batchable: "The next briefing time"
    nb = next_brief(t, c)
    if nb == t:
        return ('unsent', 0)                    # "A push at a briefing time costs 0."
    if nb < 0:
        return ('unsent', 1) if c.NOBRIEF == 'push-now' else ('deferred', -1)
    return ('deferred', nb)


def write(s, c):
    kind, x = admit(s, c)
    if kind == 'deferred':
        return s._replace(ob='deferred', defat=x)
    s2 = s._replace(ob='unsent', defat=-1)
    if x:
        if s2.bud >= x:
            s2 = s2._replace(bud=s2.bud - x)
        else:
            s2 = s2._replace(over=s2.over + 1)   # "That push is logged as an overdraft, with its cause."
    return s2


def urgent(s, c):
    if not s.up:
        return
    if s.ans:
        return
    # the one sender (§6.7): "It marks a row sent when the push service accepts it."
    if s.ob == 'unsent' and s.psvc and c.MUTATION != 'sender_stuck':
        yield 'sender: the push service accepts the push', s._replace(ob='sent', pushes=s.pushes + 1, sentat=s.t)
    # a deferral ends at its stated time
    if s.ob == 'deferred' and s.defat >= 0 and s.t >= s.defat:
        if c.LEVEL == 'batch':
            # the briefing time came (or passed while the server was down): one push, at no cost
            yield 'deferral ends: the batch goes out', s._replace(ob='unsent', defat=-1)
        else:
            yield 'deferral ends: `pushAdmission` is asked again', write(s, c)
    # §4.2 "An unseen blocking item pushes once more after two hours ... That repeat costs 2."
    if (s.ob == 'sent' and s.rep == 'none' and not s.seen and c.LEVEL in ('now', 'by', 'block')
            and s.t >= s.sentat + c.REPEAT_AFTER and s.psvc):
        if c.LEVEL != 'block' or c.REPEAT_SCOPE == 'all-blocking':
            s2 = s._replace(rep='done', pushes=s.pushes + 1, bud=max(0, s.bud - 2))
            if c.REPEAT_ROW == 'new-row':
                s2 = s2._replace(obn=s2.obn + 1)
            yield 'repeat: the unseen blocking item pushes once more', s2


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    urg = list(urgent(s, c))
    for lbl, s2 in urg:
        add(lbl, s2, actor='server')
    if s.t < c.T_MAX and not urg:
        add('tick', s._replace(t=s.t + 1, fault=s.fault or not s.up or not s.psvc), actor='time')
    if s.up and s.b_crash:
        add('SERVER CRASH', s._replace(up=False, b_crash=s.b_crash - 1, fault=True), actor='env')
    if not s.up:
        s2 = s._replace(up=True)
        # §6.7 "sends every unsent row again at boot"
        if s2.ob == 'deferred' and c.BOOT_SENDS == 'deferred-too':
            s2 = s2._replace(ob='unsent', defat=-1)
        if s2.ob == 'deferred' and c.MUTATION == 'boot_drops_deferral':
            s2 = s2._replace(defat=-1)
        add('server boots', s2, actor='server', boot=True)
        return E
    if s.b_pf and s.psvc:
        add('the push service goes down', s._replace(psvc=False, b_pf=s.b_pf - 1, fault=True), actor='env')
    if not s.psvc:
        add('the push service is back', s._replace(psvc=True), actor='env')
    if s.b_spend and s.bud > 0:
        add('another interrupting push spends the budget', s._replace(bud=s.bud - 1, b_spend=s.b_spend - 1),
            actor='env')
    # ---- the row reaches the operator: reach stamp and outbox row in one transaction (§6.7) -------------
    if not s.reach and s.t <= c.RAISE_BY:
        s2 = s._replace(reach=True, rat=s.t, obn=1)
        if c.MUTATION == 'reach_without_outbox':
            add('the row reaches the operator (no outbox row)', s2._replace(obn=0), actor='server')
        else:
            add('the row reaches the operator; `pushAdmission` rules on its push', write(s2, c), actor='server')
    # ---- the operator ----------------------------------------------------------------------------------------
    if c.CONSOLE and s.reach and not s.ans:
        if not s.con:
            s2 = s._replace(con=True)
            # §4.2 "A pending batch is delivered when the operator opens the console, with no push."
            if s2.ob == 'deferred' and (c.LEVEL == 'batch' or c.CONSOLE_SETTLES == 'all-deferred'):
                s2 = s2._replace(ob='settled', defat=-1)
            add('operator: opens the console', s2, actor='operator')
        else:
            add('operator: closes the console', s._replace(con=False), actor='operator')
            add('operator: opens the row and answers it', s._replace(ans=True, seen=True), actor='operator')
    return E


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def p1(s, lbl, info, s2, c):
    # Table 4.2a: each urgency has a deferral limit. A `blocking-by` row pushes by its limit, a
    # `blocking-now` row at once. Faults are set aside here (they are D3-style liveness, round one).
    if lbl != 'tick' or not s.reach or s.ans or s.fault or not s.up:
        return None
    if c.LEVEL == 'by' and s.t >= max(limit(c), s.rat) and s.ob not in ('sent',):
        return 'time passed the deferral limit (%d; needed by %d) and the row has not been pushed (outbox %s%s)' % (
            limit(c), c.D, s.ob, ' until %d' % s.defat if s.ob == 'deferred' and s.defat >= 0 else '')
    if c.LEVEL == 'now' and s.ob != 'sent':
        return 'a verified `blocking-now` row was not pushed at once (outbox %s)' % s.ob
    return None


def i2(s, c):
    # I2: "exactly one reach stamp and one outbox row"
    if s.reach and s.obn != 1:
        return 'the row reached the operator and has %d outbox rows' % s.obn
    return None


def i9(s, lbl, info, s2, c):
    # I9: "While `mayHold` is false, the pushes ... equal those of a build without the Overlord"
    if c.LEVEL == 'block' and s2.pushes > 1:
        return 'a blocking item the tier never held was pushed %d times; today`s build pushes it once' % s2.pushes
    if c.LEVEL == 'block' and lbl == 'tick' and s.reach and not s.ans and s.up and not s.fault and s.ob != 'sent':
        return 'a blocking item the tier never held was not pushed at once'
    return None


def b1(s, lbl, info, s2, c):
    # §4.2: a `batchable` push goes out at a briefing time, or is settled when the console opens
    if c.LEVEL == 'batch' and c.BRIEF and s2.pushes > s.pushes and s.t not in c.BRIEF and not s.fault:
        return 'a `batchable` push went out at tick %d, which is no briefing time' % s.t
    if info.get('boot') and s.ob == 'deferred' and s2.ob == 'unsent':
        return 'the boot pass sent a push that the budget had deferred to tick %d' % s.defat
    return None


def m25(s, c):
    # M25's target: "every overdraft a verified `blocking-now`". Under SPENT_BY='push' the target has
    # to admit a `blocking-by` at its limit too, so the check follows the reading.
    ok = ('now', 'by') if c.SPENT_BY == 'push' else ('now',)
    if s.over and c.LEVEL not in ok:
        return 'an overdraft was logged for a `%s` row' % c.LEVEL
    return None


STATE_CHECKS = [('I2', i2), ('M25', m25)]
EDGE_CHECKS = [('P1', p1), ('I9', i9), ('B1', b1)]


def _server_only(lbl):
    return lbl == 'tick' or lbl.startswith(('sender', 'deferral ends', 'repeat', 'server boots',
                                            'the push service is back'))


LIVE_CHECKS = [
    # §4.2 "Deferred is never hidden": a deferred push still goes out with no act of the operator's
    ('L5', lambda s, c: s.ob in ('deferred', 'unsent') and not s.ans and s.t <= c.RAISE_BY,
     lambda s, c: s.ob in ('sent', 'settled'), _server_only),
]

FACTS = [
    ('a push is deferred', lambda s, c: s.ob == 'deferred'),
    ('an overdraft is logged', lambda s, c: s.over > 0),
]

SCEN = {
    # blocking-by 4 (limit 3), a briefing at 5, a budget that another push can spend
    'by': dict(LEVEL='by', D=4, LEAD=1, BRIEF=(5,), BUDGET=1, SPENDS=1, T_MAX=6, RAISE_BY=3),
    # the same row, with quiet hours over its limit
    'by-quiet': dict(LEVEL='by', D=4, LEAD=1, BRIEF=(5,), QUIET=(2, 5), BUDGET=1, SPENDS=0, T_MAX=6, RAISE_BY=3),
    'now': dict(LEVEL='now', BRIEF=(5,), QUIET=(1, 3), BUDGET=1, SPENDS=1, T_MAX=5, RAISE_BY=2),
    'batch': dict(LEVEL='batch', BRIEF=(4,), BUDGET=1, SPENDS=1, T_MAX=6, RAISE_BY=3, CRASHES=1),
    'batch-nobrief': dict(LEVEL='batch', BRIEF=(), BUDGET=1, SPENDS=0, T_MAX=4, RAISE_BY=2),
    # a coordinator's blocking item the tier never held
    'block': dict(LEVEL='block', BRIEF=(4,), BUDGET=1, SPENDS=1, T_MAX=5, RAISE_BY=1),
    # faults: the push service and the server go down under a deferred and an unsent push
    'faults': dict(LEVEL='by', D=4, LEAD=1, BRIEF=(5,), BUDGET=1, SPENDS=0, T_MAX=6, RAISE_BY=2, CRASHES=1,
                   PUSH_FAILS=1),
}

READINGS = [
    ('SPENT_BY', 'defer', 'by', 'P1'),
    ('QUIET_RULE', 'defers', 'by-quiet', 'P1'),
    ('CONSOLE_SETTLES', 'all-deferred', 'by', 'P1'),
    ('NOBRIEF', 'never', 'batch-nobrief', 'L5'),
    ('BOOT_SENDS', 'deferred-too', 'batch', 'B1'),
    ('REPEAT_SCOPE', 'all-blocking', 'block', 'I9'),
    ('REPEAT_ROW', 'new-row', 'by', 'I2'),
]

MUTATIONS = [
    ('deferral_ignores_deadline', 'by', {}, 'P1'),
    ('budget_blocks_now', 'now', {}, 'P1'),
    ('reach_without_outbox', 'by', {}, 'I2'),
    ('sender_stuck', 'now', {}, 'P1 L5'),
    ('boot_drops_deferral', 'batch', {}, 'L5'),
]

TRACES = [
    ('push-blocking-by-deferred-past-limit', 'by', dict(SPENT_BY='defer'), ('P1',)),
    ('push-quiet-hours-past-limit', 'by-quiet', dict(QUIET_RULE='defers'), ('P1',)),
    ('push-console-settles-blocking-by', 'by', dict(CONSOLE_SETTLES='all-deferred'), ('P1',)),
    ('push-batch-no-briefing-time', 'batch-nobrief', dict(NOBRIEF='never'), ('L5',)),
    ('push-boot-sends-deferred', 'batch', dict(BOOT_SENDS='deferred-too'), ('B1',)),
    ('push-repeat-never-held-row', 'block', dict(REPEAT_SCOPE='all-blocking'), ('I9',)),
    ('push-repeat-second-outbox-row', 'by', dict(REPEAT_ROW='new-row'), ('I2',)),
]
