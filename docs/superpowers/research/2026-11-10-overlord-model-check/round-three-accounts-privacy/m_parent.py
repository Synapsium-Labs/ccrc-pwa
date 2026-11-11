"""Machine 8: a parent request and its children (§5.1 Table 5.1b, §5.3, §5.4 C15, §5.5 H22, I12).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

One parent P, split into two children C1 and C2, one per owner (§5.3). C2's owner is one "the cited words do
not name" when UNNAMED2 is set: the operator confirms that split with one tap (§5.1). A third child C3 can
replace a child that ended other than done. `clk` is a follow-up time (§5.4).

Bounds: two children and one replacement; one decline, one failure, one withdraw, one crash, one follow-up lapse.
"""
from collections import namedtuple

OPEN = ('received', 'routed', 'in-progress', 'needs-you', 'blocked', 'declined', 'done-unverified')
EXEMPT = ('needs-you', 'done-unverified', 'blocked')
TERMINAL = ('done', 'failed', 'dropped')

DEFAULT = dict(
    UNNAMED2=False, DECLINES=1, FAILS=1, WITHDRAW_P=0, WITHDRAW_C=0, CRASHES=1, LAPSES=0, P_ANSWERS=1, C_TAPS=1,
    REPLACE=1,
    # ---- switches: the safe readings -----------------------------------------------------------------------
    PARENT_CLOSE='same-tx',    # the parent closes: 'same-tx' (in the transaction that closes its last child, and
                               # again at boot) | 'after' (a step of its own after the child's close; the text
                               # names no trigger for it)
    PARENT_ANSWER='resumes',   # the operator's answer on a parent in `needs-you`: 'resumes' (to `in-progress`)
                               # | 'stays' (the text: only a request "its owner has acknowledged" moves)
    WITHDRAW_CASCADE=True,     # withdrawing a parent drops its open children: True | False (the text does not say)
    I12_READ='each-child',     # "a parent whose children have theirs": 'each-child' (each open child has a time or
                               # is itself in `needs-you`, `done-unverified` or `blocked`) | 'literal'
    MUTATION=None,
)

S = namedtuple('S', 'p c1 k1 c2 k2 c3 k3 pk ans tap2 evalp up b_dec b_fail b_wp b_wc b_crash b_lapse b_pans '
                    'b_tap b_rep')


def init(c):
    return S(p='received', c1='none', k1=False, c2='none', k2=False, c3='none', k3=False, pk=True, ans=False,
             tap2=False, evalp=False, up=True, b_dec=c.DECLINES, b_fail=c.FAILS, b_wp=c.WITHDRAW_P, b_wc=c.WITHDRAW_C,
             b_crash=c.CRASHES, b_lapse=c.LAPSES, b_pans=c.P_ANSWERS, b_tap=c.C_TAPS, b_rep=c.REPLACE)


def fmt(s):
    def one(n, st, k):
        return '%s %s%s' % (n, st, ' (follow-up time)' if k and st in OPEN else '')
    return 'parent %s%s | %s | %s%s%s%s%s' % (
        s.p, ' (follow-up time)' if s.pk else '', one('C1', s.c1, s.k1), one('C2', s.c2, s.k2),
        ' | ' + one('C3', s.c3, s.k3) if s.c3 != 'none' else '', ' | the operator answered the parent' if s.ans else '',
        ' | the parent`s close is pending' if s.evalp else '', '' if s.up else ' | SERVER DOWN')


def kids(s):
    return [(n, getattr(s, n), getattr(s, 'k' + n[1])) for n in ('c1', 'c2', 'c3') if getattr(s, n) != 'none']


def counted(s, c):
    """The children the parent's end counts. Once the operator has answered a parent, a child that ended other
    than done no longer counts (the safe reading of `PARENT_ANSWER`)."""
    ks = kids(s)
    if c.PARENT_ANSWER == 'resumes' and s.ans:
        ks = [(n, st, k) for n, st, k in ks if st not in ('failed', 'dropped')]
    return ks


def after_child(s, c):
    """What the server does to the parent when a child moves, in that move's transaction (§5.5: "A parent waits
    on its children. The parent is done when the server measures every child done")."""
    ks = counted(s, c)
    resumable = s.p == 'needs-you' and s.ans and c.PARENT_ANSWER == 'resumes'
    if s.p != 'in-progress' and not resumable:
        return s
    if ks and all(st == 'done' for _, st, _ in ks):
        if c.PARENT_CLOSE == 'same-tx':
            return s._replace(p='done')
        return s._replace(p='in-progress', evalp=True)
    if any(st in OPEN for _, st, _ in ks):
        return s._replace(p='in-progress')
    return s._replace(p='needs-you')


def ended_badly(s, c, child):
    if c.MUTATION == 'child_fail_silent':
        return s
    if s.p in ('in-progress', 'received'):
        return s._replace(p='needs-you', ans=False, pk=False)
    return s


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    if not s.up:
        s2 = s._replace(up=True, evalp=False)
        ks = kids(s2)
        if c.PARENT_CLOSE == 'same-tx':
            s2 = after_child(s2, c)
        add('the server boots', s2, actor='server')
        return E
    if s.b_crash:
        add('the server crashes', s._replace(up=False, b_crash=s.b_crash - 1), actor='fault')
    if s.evalp:
        add('server: measures every child done and closes the parent', s._replace(p='done', evalp=False),
            actor='server')

    # ---- the Overlord --------------------------------------------------------------------------------------
    if s.p == 'received' and s.c1 == 'none':
        # §5.3: "a parent request with one child request per owner"; §5.4: "A parent takes none of its own"
        c2 = 'needs-you' if c.UNNAMED2 else 'received'
        add('Overlord: splits the request: C1 and C2 are opened%s' % (
            '; C2`s owner is not named in the words, so C2 waits for the operator`s tap' if c.UNNAMED2 else ''),
            s._replace(c1='received', k1=True, c2=c2, k2=not c.UNNAMED2, pk=False), actor='overlord')
    for n in ('c1', 'c2', 'c3'):
        st = getattr(s, n)
        kn = 'k' + n[1]
        N = n.upper()
        gone = s.p == 'dropped'
        if st == 'received' or (st == 'needs-you' and n == 'c2' and s.tap2) or st == 'declined':
            if gone and c.WITHDRAW_CASCADE:
                continue
            s2 = s._replace(**{n: 'routed', kn: True})
            if s2.p == 'received':
                s2 = s2._replace(p='in-progress')           # Table 5.1b: "start a parent ... first child is routed"
            else:
                s2 = after_child(s2, c)
            add('Overlord: relays %s to its owner%s' % (N, ' (routed elsewhere)' if st == 'declined' else ''), s2,
                actor='overlord', relay=True, root_gone=gone)
        if st == 'declined':
            add('Overlord: drops %s' % N, ended_badly(s._replace(**{n: 'dropped'}), c, n), actor='overlord')
        # ---- the owner ----------------------------------------------------------------------------------
        if st == 'routed':
            add('owner: acknowledges %s' % N, s._replace(**{n: 'in-progress', kn: True}), actor='owner')
            if s.b_dec:
                add('owner: declines %s' % N, s._replace(**{n: 'declined', kn: True, 'b_dec': s.b_dec - 1}),
                    actor='owner')
        if st == 'in-progress':
            s2 = after_child(s._replace(**{n: 'done'}), c)
            if c.MUTATION == 'parent_done_early' and s2.p == 'in-progress':
                s2 = s2._replace(p='done')
            add('server: %s`s done test passes; %s is `done`' % (N, N), s2, actor='server')
            if s.b_fail:
                add('owner: %s failed' % N, ended_badly(s._replace(**{n: 'failed', 'b_fail': s.b_fail - 1}), c, n),
                    actor='owner')
            if s.b_lapse:
                # §5.4: "After two nudges with no measured movement, the server itself moves the request to `needs-you`"
                add('server: two nudges on %s with no movement; %s is `needs-you`' % (N, N),
                    s._replace(**{n: 'needs-you', kn: False, 'b_lapse': s.b_lapse - 1}), actor='server')
        if s.b_wc and st in ('received', 'routed', 'in-progress', 'needs-you'):
            add('operator: withdraws %s' % N, ended_badly(s._replace(**{n: 'dropped', 'b_wc': s.b_wc - 1}), c, n),
                actor='operator')
        if c.MUTATION == 'terminal_moves' and st == 'failed':
            add('owner: acknowledges %s again' % N, s._replace(**{n: 'in-progress'}), actor='owner', left_terminal=True)
    if s.b_rep and s.c3 == 'none' and s.p in ('in-progress', 'needs-you') and s.ans and any(
            st in ('failed', 'dropped') for _, st, _ in kids(s)):
        add('Overlord: opens C3 for another owner, in place of the child that ended', s._replace(
            c3='received', k3=True, b_rep=s.b_rep - 1), actor='overlord')

    # ---- the operator --------------------------------------------------------------------------------------
    if s.b_tap and s.c2 == 'needs-you' and not s.tap2 and c.UNNAMED2:
        add('operator: confirms the split with one tap', s._replace(tap2=True, b_tap=s.b_tap - 1), actor='operator')
    if s.b_pans and s.p == 'needs-you' and not s.ans:
        if c.PARENT_ANSWER == 'resumes':
            s2 = after_child(s._replace(ans=True, b_pans=s.b_pans - 1), c)
            add('operator: answers the parent (carry on without the child that ended); the parent is `%s`' % s2.p,
                s2, actor='operator')
        else:
            # Table 5.1b: "for any other such request the answer is recorded and it stays `needs-you`"
            add('operator: answers the parent (carry on); a parent has no owner that acknowledged, so it stays '
                '`needs-you`', s._replace(ans=True, b_pans=s.b_pans - 1), actor='operator')
    if s.b_wp and s.p in ('received', 'in-progress', 'needs-you'):
        s2 = s._replace(p='dropped', pk=False, b_wp=s.b_wp - 1)
        if c.WITHDRAW_CASCADE:
            for n in ('c1', 'c2', 'c3'):
                if getattr(s2, n) in OPEN:
                    s2 = s2._replace(**{n: 'dropped'})
        add('operator: withdraws the parent%s' % ('; its open children are dropped with it' if c.WITHDRAW_CASCADE
                                                   else ''), s2, actor='operator')
    return E


# ---------------------------------------------------------------------------------------------------------
# checks

def i12(s, c):
    # I12: "Every open request outside `needs-you`, `done-unverified` and `blocked` has a follow-up time, or is a
    # parent whose children have theirs"
    if not s.up or s.evalp:
        return None
    for n, st, k in kids(s):
        if st in OPEN and st not in EXEMPT and not k:
            return '%s is `%s` with no follow-up time' % (n.upper(), st)
    if s.p in OPEN and s.p not in EXEMPT and not s.pk:
        ks = kids(s)
        opn = [(n, st, k) for n, st, k in ks if st in OPEN]
        if not ks:
            return 'the request is `%s` with no follow-up time and no child' % s.p
        if not opn:
            return 'the parent is `%s`, every child has ended, and nothing has a follow-up time' % s.p
        if c.I12_READ == 'literal' and not all(k for _, _, k in opn):
            n, st = [(n, st) for n, st, k in opn if not k][0]
            return ('read to the letter: the parent is `%s` and its open child %s has no follow-up time (it is `%s`, '
                    'itself exempt)' % (s.p, n.upper(), st))
    return None


def pa3(s, lbl, info, s2, c):
    # §5.1: "Child requests inherit that authority." The operator withdrew the root.
    if info.get('relay') and info.get('root_gone'):
        return 'a child was relayed under a root request the operator had withdrawn'
    return None


def pa4(s, c):
    # §5.5: "The parent is done when the server measures every child done."
    ks = counted(s, c)
    if s.p == 'done' and not (ks and all(st == 'done' for _, st, _ in ks)):
        return 'the parent is `done` while a child is not'
    return None


def pa5(s, lbl, info, s2, c):
    if info.get('left_terminal'):
        return 'a request left a terminal state'
    return None


def pa6(s, c):
    # §5.5: "A child that ends other than done moves the parent to `needs-you`."
    if s.up and s.p == 'in-progress' and not s.ans and any(st in ('failed', 'dropped') for _, st, _ in kids(s)):
        return 'a child ended other than done and the parent is still `in-progress`, with nothing said'
    return None


STATE_CHECKS = [('I12', i12), ('PA4', pa4), ('PA6', pa6)]
EDGE_CHECKS = [('PA3', pa3), ('PA5', pa5)]


def _all_done(s):
    ks = [(n, st) for n, st, _ in kids(s) if st not in ('failed', 'dropped')]
    return bool(ks) and all(st == 'done' for _, st in ks)


LIVE_CHECKS = [
    # every child is done: the server alone closes the parent
    ('PA1', lambda s, c: s.p == 'in-progress' and counted(s, c) and all(st == 'done' for _, st, _ in counted(s, c)),
     lambda s, c: s.p == 'done', lambda lbl: lbl.startswith(('server', 'the server boots'))),
    # the operator said carry on: the parent can still reach `done` without another act of the operator's
    ('PA2', lambda s, c: s.p == 'needs-you' and s.ans and s.b_rep > 0,
     lambda s, c: s.p in ('done', 'in-progress'), lambda lbl: not lbl.startswith('operator')),
]

FACTS = [('the parent reaches `done`', lambda s, c: s.p == 'done')]

SCEN = {
    'split': dict(),
    'split-unnamed': dict(UNNAMED2=True, DECLINES=0, FAILS=0, LAPSES=1),
    'withdraw': dict(WITHDRAW_P=1, WITHDRAW_C=1, DECLINES=0, FAILS=0, CRASHES=0),
}

READINGS = [
    ('PARENT_CLOSE', 'after', 'split', 'I12 PA1'),
    ('PARENT_ANSWER', 'stays', 'split', 'PA2'),
    ('WITHDRAW_CASCADE', False, 'withdraw', 'PA3'),
    ('I12_READ', 'literal', 'split-unnamed', 'I12'),
]

MUTATIONS = [
    ('parent_done_early', 'split', {}, 'PA4'),
    ('child_fail_silent', 'split', {}, 'PA6'),
    ('terminal_moves', 'split', {}, 'PA5'),
]

TRACES = [
    ('parent-never-closes', 'split', dict(PARENT_CLOSE='after'), ('PA1', 'I12')),
    ('parent-stuck-in-needs-you', 'split', dict(PARENT_ANSWER='stays'), ('PA2',)),
    ('parent-withdrawn-children-go-on', 'withdraw', dict(WITHDRAW_CASCADE=False), ('PA3',)),
    ('parent-i12-read-to-the-letter', 'split-unnamed', dict(I12_READ='literal'), ('I12',)),
]
