"""Machine 2: one answer the Overlord gave, and the checks made of it afterwards.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it. Section numbers in comments are that file's.

An answer is either routine (class none, not surfaced: §10.2) or under a grant (O3, staged, shown to the operator
with a veto window: §7.2). Afterwards it can be drawn as a spot-check of the weekly check (§9.6), overturned
(§10.3), and drawn again on its grant's renewal sheet (§7.2). The weekly check also carries one seeded wrong call
(§9.6). `askOrAct`'s record takes "blind answers, weekly spot-checks and overturns" (§6.3); a grant's evidence takes
blind answers only (§7.2); three overturns in 24 hours latch the ladder (Table 7.5a).

`OWN` is what the operator would answer with nothing in view; `ACT` is what the Overlord answered.

Bounds: one answer, ACTS acts under the grant in its period, one weekly check, one renewal sheet, one seeded call,
T ticks of the grant's 30 days.
"""
from collections import namedtuple

DEFAULT = dict(
    KIND='routine',        # 'routine' | 'grant' (staged)
    OWN='B', ACT='A',
    ACTS=1,                # acts under the grant in its period (the renewal sheet asks for three)
    SEEDED=0,              # the weekly check carries its seeded wrong call
    T=2,
    # ---- switches: the safe readings ---------------------------------------------------------------------
    SPOT_OVERTURN='once',  # a spot-check that disagrees, and the Overturn it opens: 'once' (one case) | 'both'
    RENEWAL_WORD='seen',   # a renewal spot-check of an act the operator watched: 'seen' (examined at most) | 'blind'
    RENEW_FEWER='blocked', # under three acts in the period: 'blocked' (no renewal: it expires, and starts again in
                           # shadow) | 'shown' (the sheet shows those there are, and Renew is enabled)
    MUTATION=None,
)

S = namedtuple('S', 'acted seen weekly renew overturned cell_n cell_d grant_ev trip seeded pairs gstate t renew_ok')


def init(c):
    return S(acted=0, seen=0, weekly=None, renew=None, overturned=0, cell_n=0, cell_d=0, grant_ev=0, trip=0,
             seeded='none' if c.SEEDED else 'off', pairs=0, gstate='live' if c.KIND == 'grant' else 'none', t=0,
             renew_ok=0)


def fmt(s):
    return ('answered %d, the operator saw the pick %d | weekly spot-check %s, renewal spot-check %s, overturned %d | '
            'cell record %d cases, %d disagreeing | grant evidence %d | overturns towards the latch %d | seeded call %s, '
            'consistency pairs %d | grant %s, day %d, Renew enabled %d' % (
                s.acted, s.seen, s.weekly, s.renew, s.overturned, s.cell_n, s.cell_d, s.grant_ev, s.trip, s.seeded,
                s.pairs, s.gstate, s.t * 15, s.renew_ok))


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    agree = c.OWN == c.ACT
    if not s.acted:
        if c.KIND == 'routine':
            # §10.2: "Routine answers are not surfaced": the operator has not seen it
            add('Overlord: answers %s (routine, not surfaced)' % c.ACT, s._replace(acted=1), actor='overlord')
        else:
            # §7.2: staged, shown as "The Overlord will answer %s", and the veto clock runs only while a console shows it
            add('Overlord: answers %s under the grant; staged; the operator watches the veto window; effective' % c.ACT,
                s._replace(acted=1, seen=1), actor='overlord')
        return E
    # ---- the weekly check (§9.6) ------------------------------------------------------------------------------
    if s.weekly is None and not s.seen and not s.overturned:
        # "Three spot-checks of recent Overlord answers the operator never saw": a seen act is not drawn
        w = 'agree' if agree else 'disagree'
        add('weekly check: the operator answers %s without the Overlord\'s pick, then it is revealed (%s)' % (c.OWN, w),
            s._replace(weekly=w, seen=1, cell_n=s.cell_n + 1, cell_d=s.cell_d + (0 if agree else 1),
                       grant_ev=s.grant_ev + (1 if c.KIND == 'grant' else 0)), actor='operator')
    if s.seeded == 'none':
        add('weekly check: the seeded wrong call, a real past question, is shown', s._replace(seeded='shown'), actor='server')
    elif s.seeded == 'shown':
        s2 = s._replace(seeded='answered')
        if c.MUTATION == 'seeded_is_a_case':
            s2 = s2._replace(cell_n=s.cell_n + 1, cell_d=s.cell_d + 1)
        if c.MUTATION == 'seeded_is_a_pair':
            s2 = s2._replace(pairs=s.pairs + 1)
        add('operator: answers the seeded call; it is revealed as a drill', s2, actor='operator')
    elif s.seeded == 'answered':
        s2 = s._replace(seeded='overturn-tapped')
        if c.MUTATION == 'seeded_overturn_acts':
            s2 = s2._replace(trip=s.trip + 1)
        add('operator: taps Overturn on the seeded call', s2, actor='operator')
    # ---- overturn (§10.3) ---------------------------------------------------------------------------------------
    if not agree and s.seen and not s.overturned:
        dup = s.weekly == 'disagree' and c.SPOT_OVERTURN == 'once'
        add('operator: Overturn%s' % (' (opened from the spot-check)' if s.weekly == 'disagree' else ''),
            s._replace(overturned=1, trip=s.trip + 1, cell_n=s.cell_n + (0 if dup else 1), cell_d=s.cell_d + (0 if dup else 1),
                       gstate='susp' if s.gstate == 'live' else s.gstate), actor='operator')
    # ---- the grant's renewal (§7.2, §9.6) -----------------------------------------------------------------------
    if s.gstate == 'live' and s.renew is None and s.t >= 1:
        enough = c.ACTS >= 3 or c.RENEW_FEWER == 'shown'
        if enough:
            # "The renewal sheet shows three acts from the grant's last period as blind spot-checks."
            word = 'blind' if (c.RENEWAL_WORD == 'blind' or not s.seen) else 'examined'
            add('renewal sheet: the operator answers %s on the act as a spot-check (scored %s)' % (c.OWN, word),
                s._replace(renew=word, renew_ok=1, grant_ev=s.grant_ev + (1 if word == 'blind' else 0),
                           cell_n=s.cell_n + (1 if word == 'blind' else 0),
                           cell_d=s.cell_d + (1 if word == 'blind' and not agree else 0)), actor='operator')
    if s.gstate == 'live' and s.renew_ok and s.t >= 1:
        add('operator: Renew, behind the step-up', s._replace(gstate='renewed'), actor='operator-stepup')
    if s.t < c.T:
        s2 = s._replace(t=s.t + 1)
        if s2.t >= c.T and s.gstate == 'live':
            s2 = s2._replace(gstate='expired')        # §7.2: "With no answer by the expiry, the grant becomes `expired`"
        add('15 days pass', s2, actor='time')
    return E


def s1(s, c):
    # §9.6: a spot-check is of an answer "the operator never saw"; §9.5: only blind answers are grant evidence
    if s.renew == 'blind' and c.KIND == 'grant':
        return 'a renewal spot-check of a staged act, whose veto window the operator watched, was scored blind'
    return None


def s2(s, c):
    if s.cell_n > 1 or s.cell_d > 1 or s.grant_ev > 1:
        return 'one answer of the Overlord\'s added %d cases (%d disagreeing) to its cell and %d to its grant\'s evidence' % (
            s.cell_n, s.cell_d, s.grant_ev)
    return None


def s3(s, c):
    if c.SEEDED and s.acted == 1 and s.weekly is None and s.renew is None and not s.overturned and (s.cell_n or s.pairs):
        return 'the seeded wrong call added a case or a consistency pair'
    return None


def s4(s, c):
    if s.trip > s.overturned:
        return 'an Overturn tapped on the seeded wrong call counted towards the three overturns in 24 hours'
    return None


STATE_CHECKS = [('S1', s1), ('S2', s2), ('S3', s3), ('S4', s4)]
EDGE_CHECKS = []
def s5(s, c):
    # a renewal rests on three answered spot-checks, never on fewer
    if s.gstate == 'renewed' and c.ACTS < 3:
        return 'a grant with %d act in its period was renewed: the sheet had fewer than three acts to show' % c.ACTS
    return None


STATE_CHECKS.append(('S5', s5))
LIVE_CHECKS = []
FACTS = [('a weekly spot-check adds a blind case to a cell', lambda s, c: s.weekly is not None and s.cell_n == 1),
         ('the grant is renewed', lambda s, c: s.gstate == 'renewed'),
         ('the grant expires', lambda s, c: s.gstate == 'expired')]
SCEN = {
    'routine': dict(),
    'routine-agree': dict(OWN='A'),
    'grant': dict(KIND='grant', ACTS=3, OWN='A'),
    'grant-quiet': dict(KIND='grant', ACTS=1, OWN='A'),
    'seeded': dict(SEEDED=1, OWN='A'),
}
READINGS = [
    ('SPOT_OVERTURN', 'both', 'routine', 'S2'),
    ('RENEWAL_WORD', 'blind', 'grant', 'S1'),
    ('RENEW_FEWER', 'shown', 'grant-quiet', 'S5'),
]
MUTATIONS = [
    ('seeded_is_a_case', 'seeded', {}, 'S3'),
    ('seeded_is_a_pair', 'seeded', {}, 'S3'),
    ('seeded_overturn_acts', 'seeded', {}, 'S4'),
]
TRACES = [
    ('spot-disagreement-counts-twice', 'routine', dict(SPOT_OVERTURN='both'), ('S2',)),
    ('spot-renewal-scored-blind', 'grant', dict(RENEWAL_WORD='blind'), ('S1',)),
    ('spot-renewal-under-three-acts', 'grant-quiet', dict(RENEW_FEWER='shown'), ('S5',)),
]
