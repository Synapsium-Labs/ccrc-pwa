"""Machine 3a: one request, its owner and the follow-up arm.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it, §5.1 (Table 5.1b, Figure 3), §5.4, §5.5, §7.5 (`off`, Pause), §11.5.
Section numbers are that file's.

One request, one owning programme with one coordinator, one thing a `blocked` request waits on.
Every move is a row of Table 5.1b. Time moves in ticks; a follow-up interval is FU ticks. The clock is
kept as ticks left, so time itself has no bound: each fault and each tap has a budget instead.

The liveness question (L1): from every open state that is not in the home's "Needs you" group
(Table 4b), can the server alone, with time, bring the request to the operator or to an end?
"The server alone" means no act of the Overlord, the owner or the operator. §5.4: "After two
nudges with no measured movement, the server itself moves the request to `needs-you`. It does
not wait for the Overlord."
"""
from collections import namedtuple

RUNGS = ('off', 'chat', 'advise', 'full')
RANK = {r: i for i, r in enumerate(RUNGS)}
TERMINAL = ('done', 'failed', 'dropped')
OPERATORS = ('needs-you', 'done-unverified', 'declined')      # Table 4b: the group "Needs you"

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    FU=2,
    ST0='received',        # the request's first state
    RUNG0='full',
    OVERLORD=True, OWNER=True, OPERATOR=True,
    CRASHES=1, DEATHS=1, REKICKS=1, ENDS=0, MOVES=1, WORK=1, UNMEASURABLE=1, DEPS=1,
    RUNG_OPS=1,            # the operator's rung taps (lower to chat, off, back up)
    SERVER_CHAT=0,         # the server caps the rung at chat by itself (a latch or a condition)
    TAKES=1, HANDBACKS=1, ANSWERS=1, WITHDRAWS=1,
    # ---- switches: readings of the text -------------------------------------------------
    FIRST_CLOCK='open',          # `followUpAt` first set: at the 'open' (and each owed move) | 'readback' (the text)
    ARM_BELOW='needs-you',       # a follow-up due below `advise`: 'needs-you' | 'stops' (the text)
    GAP_RETIME='overdue',        # after a server gap: only an 'overdue' clock is timed again | 'all' (the text)
    ANSWER_UNACKED='stays',      # the operator answers a request no owner acknowledged: 'stays' | 'in-progress' (the text)
    DROP_NEEDS_YOU='needs-answer',  # the Overlord drops a `needs-you` request: 'needs-answer' | 'table' (the text)
    UNBLOCK='level',             # the server unblocks: whenever it measures ('level') | at the event only ('edge')
    MUTATION=None,
)

S = namedtuple('S', 'up st owner acked dt fu nud ctr news taken dep work coord prog rung ov ans inbox '
                    'b_crash b_die b_rekick b_end b_move b_work b_unm b_dep b_rung b_schat b_take b_hand b_ans b_wd')


def init(c):
    fu = c.FU if c.FIRST_CLOCK == 'open' else -1
    return S(up=True, st=c.ST0, owner=False, acked=False, dt='none', fu=fu, nud=0, ctr=0,
             news=0, taken=None, dep='none', work='open', coord='alive', prog='live', rung=c.RUNG0, ov=True,
             ans=False, inbox=False,
             b_crash=c.CRASHES, b_die=c.DEATHS, b_rekick=c.REKICKS, b_end=c.ENDS, b_move=c.MOVES, b_work=c.WORK,
             b_unm=c.UNMEASURABLE, b_dep=c.DEPS, b_rung=c.RUNG_OPS, b_schat=c.SERVER_CHAT, b_take=c.TAKES,
             b_hand=c.HANDBACKS, b_ans=c.ANSWERS, b_wd=c.WITHDRAWS)


def fmt(s):
    return ('%s rung=%s%s | request=%s%s%s%s done-test=%s follow-up=%s nudges=%d counters=%d%s%s | '
            'coordinator=%s%s%s%s' % (
                'up' if s.up else 'DOWN', s.rung, '' if s.ov else ' (Overlord not ready)',
                s.st, ' owner=P' if s.owner else ' no-owner', ' acked' if s.acked else '',
                ' takenFrom=%s' % s.taken if s.taken else '', s.dt,
                'unset' if s.fu < 0 else ('due' if s.fu == 0 else 'in %d' % s.fu), s.nud, s.ctr,
                ' operator-answered' if s.ans else '', ' inbox-row' if s.inbox else '',
                s.coord, '' if s.prog == 'live' else ' programme-ended',
                '' if s.dep == 'none' else ' waits-on=%s' % s.dep, '' if s.work == 'open' else ' work=%s' % s.work))


def clock(s, c):
    return s._replace(fu=c.FU)


def owed(s, c):
    """Set the clock at a move that leaves the next step owed to a session (the 'open' reading)."""
    return clock(s, c) if c.FIRST_CLOCK == 'open' else s


def to_needs_you(s):
    return s._replace(st='needs-you', inbox=False)


def arm_state(s, c):
    """The states the follow-up arm watches. §5.4 names `routed` and `in-progress` (Figure 3's "two
    silent nudges") and `declined` ("The follow-up arm holds it to that"). The 'open' reading adds
    `received`."""
    if s.st in ('routed', 'in-progress', 'declined'):
        return True
    return s.st == 'received' and c.FIRST_CLOCK == 'open'


def urgent(s, c):
    if not s.up:
        return
    # ---- the follow-up arm (§5.4 C15) -------------------------------------------------------
    watched = arm_state(s, c) and s.taken is None
    if c.MUTATION == 'nudge_while_taken' and s.taken is not None:
        watched = True
    if s.fu == 0 and watched:
        if RANK[s.rung] >= RANK['advise']:
            if s.nud < 2 or c.MUTATION == 'nudges_unbounded':
                # "The nudge arrives in the inbox as a follow-up row"; "Each later nudge re-times it."
                yield 'follow-up arm: nudge %d, a row in the Overlord`s inbox' % (s.nud + 1), \
                    clock(s._replace(nud=min(s.nud + 1, 2), inbox=True), c)
            else:
                # "After two nudges with no measured movement, the server itself moves the request"
                yield 'follow-up arm: two silent nudges, the server moves the request to `needs-you`', \
                    to_needs_you(s)
        elif s.rung == 'chat' and c.ARM_BELOW == 'needs-you':
            yield 'follow-up arm: due below `advise`, the server moves the request to `needs-you`', to_needs_you(s)
    # ---- the done-test lane (§5.5) -------------------------------------------------------------
    if s.st == 'in-progress' and s.work == 'done':
        yield 'done-test lane: the test passes, the request is `done`', s._replace(st='done')
    if s.st == 'in-progress' and s.work == 'unmeasurable':
        yield 'done-test lane: a predicate cannot be measured, `done-unverified`', s._replace(st='done-unverified')
    # ---- dependencies (§5.5) -------------------------------------------------------------------
    if s.st == 'blocked' and c.UNBLOCK == 'level':
        if s.dep == 'done':
            yield 'server: what it waits on is done, unblocked', clock(s._replace(st='in-progress', dep='none'), c)
        if s.dep == 'ended':
            yield 'server: what it waits on ended not done, `needs-you`', to_needs_you(s._replace(dep='none'))


def succ(s, c):
    E = []

    def add(label, s2, actor):
        E.append((label, s2, dict(actor=actor)))

    urg = list(urgent(s, c))
    for lbl, s2 in urg:
        add(lbl, s2, 'server')
    if not urg:
        add('tick', s._replace(fu=s.fu - 1) if s.fu > 0 else s, 'time')
    if s.up and s.b_crash:
        add('SERVER CRASH', s._replace(up=False, b_crash=s.b_crash - 1), 'env')
    if not s.up:
        s2 = s._replace(up=True)
        if s2.fu >= 0:
            # §5.4 "After a server gap the follow-up clocks are dropped and timed again from the boot."
            if c.GAP_RETIME == 'all':
                s2 = s2._replace(fu=c.FU)
            elif s2.fu == 0:
                s2 = s2._replace(fu=1)       # only an overdue clock, spread after the boot
        add('server boots', s2, 'server')
        return E
    live = s.st not in TERMINAL
    advise = RANK[s.rung] >= RANK['advise']

    # ---- the Overlord's request doors (Table 5.1b) ----------------------------------------------------
    if c.OVERLORD and s.ov and advise and live:
        refused = s.taken is not None        # Table 11.6 `operator-has-it`: the operator took the request
        if not refused or c.MUTATION == 'overlord_moves_taken':
            if s.st == 'received':
                add('Overlord: routes it (the relay fixes the done test)',
                    owed(s._replace(st='routed', owner=True, acked=False, dt='fixed', ctr=0, nud=0, inbox=False), c),
                    'overlord')
            if s.st == 'routed' and s.dt == 'countered':
                add('Overlord: re-relays with the revised done test', owed(s._replace(dt='fixed', inbox=False), c),
                    'overlord')
            if s.st == 'declined':
                add('Overlord: routes it elsewhere',
                    owed(s._replace(st='routed', owner=True, acked=False, dt='fixed', ctr=0, nud=0, inbox=False), c),
                    'overlord')
            if refused and s.st == 'needs-you':
                add('Overlord: routes a request the operator took',
                    s._replace(st='routed', taken=None), 'overlord')
            elif s.st == 'needs-you' and (s.ans or c.MUTATION == 'route_without_answer'):
                add('Overlord: routes it after the operator`s answer',
                    owed(s._replace(st='routed', owner=True, acked=False, dt='fixed', ctr=0, nud=0, ans=False,
                                    taken=None), c), 'overlord')
            if s.st in ('received', 'declined'):
                add('Overlord: drops it, with a reason', s._replace(st='dropped'), 'overlord')
            if s.st == 'needs-you' and (s.ans or c.DROP_NEEDS_YOU == 'table'):
                add('Overlord: drops the `needs-you` request, with a reason', s._replace(st='dropped'), 'overlord')
            if s.inbox:
                add('Overlord: `nudge-owner` (mail to the owner)', s._replace(inbox=False), 'overlord')
            if s.coord == 'dead' and s.prog == 'live' and s.b_rekick and s.owner:
                add('Overlord: re-kicks the coordinator as the same session',
                    s._replace(coord='alive', b_rekick=s.b_rekick - 1, inbox=False), 'overlord')
    if s.ov and s.b_die:
        pass
    # ---- the owning coordinator's doors ------------------------------------------------------------------
    if c.OWNER and s.owner and s.coord == 'alive' and s.prog == 'live' and s.taken is None:
        if s.st == 'routed' and s.dt == 'fixed':
            add('owner: acknowledges with its read-back (first news due in %d)' % c.FU,
                clock(s._replace(st='in-progress', acked=True, dt='accepted', nud=0, news=0), c), 'owner')
            if s.ctr < 2:
                s2 = s._replace(ctr=s.ctr + 1, dt='countered')
                s2 = clock(s2, c)
                if s2.ctr == 2:
                    # §5.5 "Two counter-proposals move the request to `needs-you`."
                    s2 = to_needs_you(s2)
                add('owner: counter-proposes (counter %d)' % (s.ctr + 1), s2, 'owner')
            add('owner: declines, with a reason', owed(s._replace(st='declined'), c), 'owner')
        if s.st == 'in-progress':
            if s.dep == 'none' and s.b_dep:
                add('owner: blocked on a named request', s._replace(st='blocked', dep='open'), 'owner')
            add('owner: reports it cannot finish (`failed`)', s._replace(st='failed'), 'owner')
            if s.news < 2 or c.MUTATION == 'news_resets_forever':
                # §5.4 "News resets the clock at most twice without measured movement"
                add('owner: reports news (the clock is reset)',
                    clock(s._replace(news=min(s.news + 1, 2)), c), 'owner')
    # ---- measured movement and the end of the work ------------------------------------------------------
    if s.st == 'in-progress' and s.coord == 'alive' and s.prog == 'live' and s.work == 'open':
        if s.b_move:
            add('measured movement on the linked work', clock(s._replace(news=0, nud=0, b_move=s.b_move - 1), c),
                'env')
        if s.b_work:
            add('the linked work closes and merges', s._replace(work='done', b_work=s.b_work - 1), 'env')
        if s.b_unm:
            add('the work ends where a predicate cannot be measured',
                s._replace(work='unmeasurable', b_unm=s.b_unm - 1), 'env')
    if s.dep == 'open':
        ev = [('what it waits on is done', 'done'), ('what it waits on ends not done', 'ended')]
        for lbl, v in ev:
            s2 = s._replace(dep=v)
            if c.UNBLOCK == 'edge':
                # the unblock runs at this event, and only for a request that is `blocked` right now
                if s.st == 'blocked':
                    s2 = clock(s2._replace(st='in-progress', dep='none'), c) if v == 'done' else \
                        to_needs_you(s2._replace(dep='none'))
            add(lbl, s2, 'env')
    # ---- faults ----------------------------------------------------------------------------------------------
    if s.b_die and s.coord == 'alive':
        add('the owning coordinator dies', s._replace(coord='dead', b_die=s.b_die - 1), 'env')
    if s.b_end and s.prog == 'live' and s.owner:
        add('the owning programme ends', s._replace(prog='ended', coord='dead', b_end=s.b_end - 1), 'env')
    if s.ov:
        add('the Overlord stops being ready', s._replace(ov=False), 'env')
    else:
        add('the Overlord is ready again', s._replace(ov=True), 'env')
    # ---- the ladder (§7.5) ---------------------------------------------------------------------------------
    if s.b_rung:
        b = s.b_rung - 1
        if RANK[s.rung] > RANK['chat']:
            add('operator: Pause (the rung becomes chat)', s._replace(rung='chat', b_rung=b), 'operator')
        if s.rung != 'off':
            # §7.5 "`off` is one transaction ... Open requests whose owner has not acknowledged move to needs-you"
            s2 = s._replace(rung='off', b_rung=b, inbox=False)
            if s2.st in ('received', 'routed', 'declined') and c.MUTATION != 'off_keeps_unacked':
                s2 = to_needs_you(s2)
            add('operator: sets the rung to off', s2, 'operator')
        if s.rung in ('off', 'chat'):
            add('operator: steps the rung up to full', s._replace(rung='full', b_rung=b), 'operator')
    if s.b_schat and RANK[s.rung] > RANK['chat']:
        add('server: caps the rung at chat (a latch or a condition)', s._replace(rung='chat', b_schat=s.b_schat - 1),
            'server-cap')
    # ---- the operator's request doors (Table 5.1b) ------------------------------------------------------------
    if c.OPERATOR and live:
        if s.st in ('routed', 'in-progress', 'blocked') and s.b_take:
            add('operator: takes the request (`needs-you`, takenFrom=%s)' % s.st,
                s._replace(st='needs-you', taken=s.st, b_take=s.b_take - 1, inbox=False), 'operator')
        if s.st == 'needs-you' and s.taken is not None and s.b_hand:
            add('operator: hands it back (to `%s`)' % s.taken, s._replace(st=s.taken, taken=None,
                                                                      b_hand=s.b_hand - 1), 'operator')
        if s.st == 'needs-you' and s.taken is None and s.b_ans and not s.ans:
            if (s.owner and s.acked) or c.ANSWER_UNACKED == 'in-progress':
                add('operator: answers (the request goes to `in-progress`)',
                    clock(s._replace(st='in-progress', b_ans=s.b_ans - 1, nud=0), c), 'operator')
            else:
                add('operator: answers (recorded; the request stays `needs-you` for the Overlord to route)',
                    s._replace(ans=True, b_ans=s.b_ans - 1), 'operator')
        if s.st == 'done-unverified':
            add('operator: confirms it done', s._replace(st='done'), 'operator')
        if s.st in ('received', 'routed', 'in-progress', 'needs-you', 'done-unverified') and s.b_wd:
            add('operator: withdraws it', s._replace(st='dropped', b_wd=s.b_wd - 1), 'operator')
    return E


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def s1(s, c):
    # Table 5.1a: `owner` is "Exactly one programme"; §5.5: the done test is "accepted in the read-back".
    # (A parent request, which has no owner, is not modelled.)
    if s.st == 'in-progress' and not (s.owner and s.acked):
        return 'the request is `in-progress` with %s' % ('no owner' if not s.owner else
                                                       'an owner that never acknowledged it')
    return None


def s3(s, lbl, info, s2, c):
    # §5.1 "No move leaves a terminal state."
    if s.st in TERMINAL and s2.st != s.st:
        return 'a move left the terminal state `%s`' % s.st
    return None


def s4(s, lbl, info, s2, c):
    # §5.1 "While a request is the operator's, the follow-up arm sends no nudge and the Overlord relays nothing"
    if s.taken is not None:
        if lbl.startswith('follow-up arm'):
            return 'the follow-up arm acted on a request the operator took'
        if info['actor'] == 'overlord' and s2.st != s.st:
            return 'the Overlord moved a request the operator took'
    return None


def s5(s, lbl, info, s2, c):
    # §5.4 "After two nudges with no measured movement, the server itself moves the request"
    if lbl.startswith('follow-up arm: nudge') and s.nud >= 2:
        return 'a third nudge was sent with no measured movement'
    if lbl.startswith('owner: reports news') and s.news >= 2:
        return 'news reset the clock a third time with no measured movement'
    return None


def s6(s, c):
    # §7.5 `off`: "Open requests whose owner has not acknowledged move to `needs-you`."
    if s.rung == 'off' and s.up and s.st in ('received', 'declined'):
        return 'the rung is off and an unacknowledged request stands in `%s`' % s.st
    return None


def s8(s, lbl, info, s2, c):
    # §6.7's rule for questions, asked of requests: what waits on the operator is not taken away
    # by the Overlord alone. Table 5.1b lets it drop a `needs-you` request with only a reason.
    if info['actor'] == 'overlord' and s.st == 'needs-you' and s2.st != 'needs-you' and not s.ans:
        return 'the Overlord moved a `needs-you` request to `%s` with no answer from the operator' % s2.st
    return None


def fu1(s, lbl, info, s2, c):
    # §5.4 "The server keeps the clocks": a gap must not push out a follow-up that was not yet due.
    if lbl == 'server boots' and s.fu > 0 and s2.fu > s.fu:
        return 'the boot moved a follow-up that was due in %d out to %d' % (s.fu, s2.fu)
    return None


STATE_CHECKS = [('S1', s1), ('S6', s6)]
EDGE_CHECKS = [('S3', s3), ('S4', s4), ('S5', s5), ('S8', s8), ('FU1', fu1)]


def _server_only(lbl):
    return lbl == 'tick' or lbl.startswith(('follow-up arm', 'done-test lane', 'server:', 'server boots'))


def _needs(s, c):
    if s.st in TERMINAL or s.st in OPERATORS or not s.up:
        return False
    if s.rung == 'off':
        return False          # the operator's own brake: "Follow-up nudges stop" (§7.5)
    if s.st == 'blocked' and s.dep == 'open':
        return False          # it waits on a request that has a clock of its own
    return True


LIVE_CHECKS = [
    ('L1', _needs, lambda s, c: s.st in TERMINAL or s.st in OPERATORS, _server_only),
    # the same question, asked only of a relayed request whose owner has not answered
    ('L1r', lambda s, c: _needs(s, c) and s.st == 'routed' and not s.acked,
     lambda s, c: s.st in TERMINAL or s.st in OPERATORS, _server_only),
]

FACTS = [
    ('the server moves a silent request to `needs-you`', lambda s, c: s.st == 'needs-you' and s.nud == 2),
]

SCEN = {
    # the whole life, every actor, one crash
    'life': dict(FU=2, CRASHES=1, DEATHS=1, REKICKS=1, MOVES=1, WORK=1, UNMEASURABLE=1, DEPS=0,
                 RUNG_OPS=0, TAKES=0, HANDBACKS=0, ANSWERS=1, WITHDRAWS=0),
    # the operator's doors: take, hand back, answer, withdraw, with a dependency
    'operator': dict(FU=2, CRASHES=0, DEATHS=0, REKICKS=0, MOVES=0, WORK=1, UNMEASURABLE=0, DEPS=1,
                     RUNG_OPS=0, TAKES=1, HANDBACKS=1, ANSWERS=1, WITHDRAWS=1),
    # the ladder moves under the request: Pause, off, back up, and a cap the server sets
    'ladder': dict(FU=2, CRASHES=0, DEATHS=1, REKICKS=0, MOVES=0, WORK=0, UNMEASURABLE=0, DEPS=0,
                   RUNG_OPS=2, SERVER_CHAT=1, TAKES=0, HANDBACKS=0, ANSWERS=1, WITHDRAWS=0),
    # a silent owner and server gaps: the Overlord and the operator do nothing
    'gap': dict(FU=3, ST0='received', CRASHES=2, DEATHS=1, REKICKS=0, MOVES=0, WORK=0, UNMEASURABLE=0,
                DEPS=0, RUNG_OPS=0, TAKES=0, HANDBACKS=0, ANSWERS=0, WITHDRAWS=0, OPERATOR=False),
    # the owner's programme ends while its request stands
    'ends': dict(FU=2, CRASHES=0, DEATHS=0, REKICKS=0, ENDS=1, MOVES=0, WORK=0, UNMEASURABLE=0, DEPS=1,
                 RUNG_OPS=0, TAKES=0, HANDBACKS=0, ANSWERS=0, WITHDRAWS=0),
}

READINGS = [
    ('FIRST_CLOCK', 'readback', 'life', 'L1 L1r'),
    ('ARM_BELOW', 'stops', 'ladder', 'L1'),
    ('GAP_RETIME', 'all', 'gap', 'FU1'),
    ('ANSWER_UNACKED', 'in-progress', 'life', 'S1'),
    ('DROP_NEEDS_YOU', 'table', 'life', 'S8'),
    ('UNBLOCK', 'edge', 'operator', 'L1'),
]

MUTATIONS = [
    ('nudge_while_taken', 'operator', {}, 'S4'),
    ('overlord_moves_taken', 'operator', {}, 'S4'),
    ('nudges_unbounded', 'life', {}, 'S5 L1'),
    ('news_resets_forever', 'life', {}, 'S5'),
    ('off_keeps_unacked', 'ladder', {}, 'S6'),
    ('route_without_answer', 'life', {}, 'S8'),
]

TRACES = [
    ('request-no-clock-before-readback', 'life', dict(FIRST_CLOCK='readback'), ('L1', 'L1r')),
    ('request-arm-stops-at-chat', 'ladder', dict(ARM_BELOW='stops', RUNG_OPS=0, SERVER_CHAT=1), ('L1',)),
    ('request-gap-pushes-followup-out', 'gap', dict(GAP_RETIME='all'), ('FU1',)),
    ('request-answer-without-ack', 'life', dict(ANSWER_UNACKED='in-progress'), ('S1',)),
    ('request-overlord-drops-needs-you', 'life', dict(DROP_NEEDS_YOU='table'), ('S8',)),
    ('request-handback-to-blocked', 'operator', dict(UNBLOCK='edge'), ('L1',)),
]
