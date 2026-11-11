"""Machine 5: the judges beside the Overlord's own work: a drill, the invariant monitor, the audit, the weekly check.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it. Section numbers in comments are that file's.

A drill is a row of `overlord_drills`, served by "every Overlord read that would show a real row of that kind" and
seen by no console (§7.5, §6.8). It is graded by the door the Overlord calls. One real row may be raised beside it.
The Overlord serves one row a tick. Admission is earliest deadline first over band 2 (§6.8). The breaker counts a
lapse the Overlord caused (§6.4). The invariant monitor reads `overlord_sequence` (§10.4, I1, I2, I10). The audit
runs once a day and latches the ladder when its score drops (Table 7.5a). Two missed weekly checks pause grant
renewals (Table 7.5a, §9.6).

Bounds: one drill, one real row, T ticks, DAYS days of audit, WEEKS weeks.
"""
from collections import namedtuple

DEFAULT = dict(
    HOLDS=True,            # `mayHold` is true for the real row (the rung is `full` and the kind is armed)
    DRILL='held',          # the drill is seated as: 'held' (a held row) | 'brief' (a row that waits for a brief)
    DD=1, DR=1, T=2, DAYS=0, WEEKS=0, GRANT=0, REAL=1,
    # ---- switches: the safe readings ---------------------------------------------------------------------
    ADMISSION='counted',   # a held drill in the admission test: 'counted' | 'ignored'
    SEQUENCE='marked',     # a drill's hold in `overlord_sequence`: 'marked' (stamped, with a mark the monitor reads and
                           # the cursor read does not serve) | 'stamped' (as a real row's) | 'absent'
    SEAT='as-live',        # a held drill is seated: 'as-live' (only while a real row of that kind would be held) | 'any'
    AUDIT_GAP='condition', # days with no verdict: 'condition' (a cap on the ladder) | 'nothing' (the text)
    JUDGE='good',          # the judge's agreement with the operator's twenty labels a quarter: 'good' | 'low' | 'unmeasured'
    UNMEASURED='binds',    # a judge nobody has labelled yet: 'binds' (its drop latches) | 'advisory'
    MUTATION=None,
)

S = namedtuple('S', 'real drill t serving breaker monitor effect cap audit_age weeks_missed renew_paused grant day wk '
                    'dropped latch')


def init(c):
    return S(real='none', drill='none', t=0, serving=None, breaker=0, monitor=False, effect=False, cap=False, audit_age=0,
             weeks_missed=0, renew_paused=False, grant='live' if c.GRANT else 'none', day=0, wk=0, dropped=False, latch=False)


def fmt(s):
    return ('tick %d | real row %s | drill %s | serving %s | lapses the breaker counts %d | monitor latch %d | drill '
            'delivered something %d | audit: %d days with no verdict, ladder capped %d | weekly checks missed %d, renewals '
            'paused %d, grant %s%s' % (s.t, s.real, s.drill, s.serving, s.breaker, s.monitor, s.effect, s.audit_age, s.cap,
                                       s.weeks_missed, s.renew_paused, s.grant,
                                       (' | the audit dropped, ladder latched %d' % s.latch) if s.dropped else ''))


def tells(s, c):
    """The reads by which the Overlord can tell the drill from a real row before it is graded."""
    out = []
    if s.drill == 'held':
        if c.SEQUENCE == 'absent':
            out.append('the sequence read shows every real hold and not this one')
        if not c.HOLDS:
            out.append('a row is held while nothing can be held')
    return out


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    # ---- the drill lane (§7.5) ------------------------------------------------------------------------------------
    if s.drill == 'none' and s.t == 0 and c.DRILL:
        # with ADMISSION 'counted' the lane asks the admission test before it seats a held drill, as for any row
        fits = not (s.real == 'held' and c.DR <= c.DD) or (2 <= c.DD - s.t) or c.ADMISSION == 'ignored'
        if c.DRILL == 'held' and (c.HOLDS or c.SEAT == 'any') and fits:
            s2 = s._replace(drill='held')
            if c.SEQUENCE == 'stamped':
                # I10: "Every open row is on the operator's list at all times"; no console read can see a drill
                s2 = s2._replace(monitor=True)
            add('drill lane: seats a drill as a held item, due at tick %d' % c.DD, s2, actor='server')
        if c.DRILL == 'brief' or (c.DRILL == 'held' and not c.HOLDS and c.SEAT == 'as-live'):
            add('drill lane: seats a drill as a row that waits for a brief', s._replace(drill='brief'), actor='server')
    # ---- a real row is raised (§6.7, §6.8) --------------------------------------------------------------------------
    if s.real == 'none' and c.REAL and s.t == 0:
        if not c.HOLDS:
            add('a coordinator raises an item: it reaches the operator at once, "brief pending"', s._replace(real='operator'), actor='world')
        else:
            # earliest deadline first, one tick a row: the rows due by a deadline must fit before it
            load = 1 + (1 if (s.drill == 'held' and c.ADMISSION == 'counted' and c.DD <= c.DR) else 0)
            if load <= c.DR - s.t:
                add('a coordinator raises an item: admitted and held, due at tick %d' % c.DR, s._replace(real='held'), actor='world')
            else:
                add('a coordinator raises an item: admission refuses it (`not-ready:saturated`); it reaches the operator at once',
                    s._replace(real='operator'), actor='world', refused_by_drill=s.drill == 'held')
    # ---- the Overlord serves one row a tick ---------------------------------------------------------------------------
    if s.serving is None:
        if s.real == 'held':
            add('Overlord: takes the real row', s._replace(serving='real'), actor='overlord')
        if s.drill in ('held', 'brief'):
            add('Overlord: takes the drill (it looks like a real row)', s._replace(serving='drill'), actor='overlord')
    # ---- time -----------------------------------------------------------------------------------------------------------
    if s.t < c.T:
        s2 = s._replace(t=s.t + 1, serving=None)
        if s.serving == 'real':
            s2 = s2._replace(real='settled')
        if s.serving == 'drill':
            s2 = s2._replace(drill='graded', effect=c.MUTATION == 'drill_delivers')
        # deadlines
        if s2.real == 'held' and s2.t >= c.DR:
            s2 = s2._replace(real='lapsed', breaker=s2.breaker + 1)        # §6.4: a lapse the Overlord caused
        if s2.drill == 'held' and s2.t >= c.DD:
            # §7.5: "A lapsed drill is void, and never pushes."
            s2 = s2._replace(drill='void', breaker=s2.breaker + (1 if c.MUTATION == 'drill_lapse_counts' else 0),
                             effect=s2.effect or c.MUTATION == 'drill_lapse_pushes')
        add('a tick passes', s2, actor='time', drill_first=s.serving == 'drill' and s.real == 'held')
    # ---- the audit, daily (§3.3.5, §9.5) ----------------------------------------------------------------------------------
    if s.day < c.DAYS:
        add('audit lane: today\'s verdicts land', s._replace(day=s.day + 1, audit_age=0, cap=False), actor='server')
        if not s.dropped:
            # Table 7.5a: "the audit under its floor, or down ten points | latch | cap `advise`"; §9.5: "The judge's scores
            # are advisory while its agreement with those labels is low."
            binds = c.JUDGE == 'good' or (c.JUDGE == 'unmeasured' and c.UNMEASURED == 'binds')
            if c.MUTATION == 'low_judge_latches':
                binds = True
            add('audit lane: today\'s score is under its floor (the judge is %s)' % c.JUDGE,
                s._replace(day=s.day + 1, audit_age=0, cap=False, dropped=True, latch=binds), actor='server')
        age = s.audit_age + 1
        add('audit lane: no auditor can run today', s._replace(day=s.day + 1, audit_age=age,
                                                             cap=(age >= 2 and c.AUDIT_GAP == 'condition')), actor='fault')
    # ---- the weekly check (§9.6, Table 7.5a) --------------------------------------------------------------------------------
    if s.wk < c.WEEKS:
        add('operator: does the weekly check', s._replace(wk=s.wk + 1, weeks_missed=0, renew_paused=False), actor='operator')
        m = s.weeks_missed + 1
        s2 = s._replace(wk=s.wk + 1, weeks_missed=m, renew_paused=(m >= 2 and c.MUTATION != 'missed_weeks_ignored'))
        if s2.wk >= c.WEEKS and s2.grant == 'live':
            s2 = s2._replace(grant='expired')         # §7.2: "With no answer by the expiry, the grant becomes `expired`"
        add('a week passes with no weekly check', s2, actor='time')
    if s.grant == 'live' and not s.renew_paused and c.WEEKS and s.wk >= 1 and s.wk < c.WEEKS:
        add('operator: renews the grant from its sheet, behind the step-up', s._replace(grant='renewed'), actor='operator-stepup', renew=True)
    if c.MUTATION == 'paused_grant_renews' and s.grant == 'live' and s.renew_paused:
        add('operator: renews the grant from its sheet, behind the step-up', s._replace(grant='renewed'), actor='operator-stepup', renew=True)
    return E


def j1(s, c):
    if s.effect:
        return 'a drill delivered something: a mail, a key press or a push'
    return None


def j2(s, lbl, info, s2, c):
    # a judge does not make a real question wait out its window for nothing
    if s2.real == 'lapsed' and s.real == 'held' and info.get('drill_first'):
        return 'a real hold lapsed while the Overlord served a drill that admission never counted'
    return None


def j3(s, c):
    if s.monitor:
        return 'the invariant monitor latched the ladder on a drill: a held row that is on no operator\'s list (I10)'
    return None


def j4(s, c):
    t = tells(s, c)
    if t:
        return 'an Overlord read tells the drill from a real row before grading: ' + '; '.join(t)
    return None


def j5(s, c):
    if s.breaker and s.real != 'lapsed':
        return 'the breaker counted a drill\'s lapse'
    return None


def j6(s, c):
    # a judge that is absent fails towards less autonomy
    if s.audit_age >= 2 and not s.cap:
        return 'two days with no audit verdict, and the ladder stands where it stood'
    return None


def j9(s, c):
    # a judge fails towards less autonomy unless the operator's labels showed it wrong
    if s.dropped and c.JUDGE != 'low' and not s.latch:
        return 'the audit dropped under its floor and the ladder did not latch: the judge is %s' % c.JUDGE
    if s.dropped and c.JUDGE == 'low' and s.latch:
        return 'a judge the operator\'s labels showed wrong latched the ladder'
    return None


def j7(s, c):
    if s.weeks_missed >= 2 and not s.renew_paused:
        return 'two weekly checks missed, and grant renewals are not paused'
    return None


def j8(s, lbl, info, s2, c):
    if info.get('renew') and s.renew_paused:
        return 'a grant was renewed while renewals were paused'
    return None


STATE_CHECKS = [('J1', j1), ('J3', j3), ('J4', j4), ('J5', j5), ('J6', j6), ('J7', j7), ('J9', j9)]
EDGE_CHECKS = [('J2', j2), ('J8', j8)]
LIVE_CHECKS = []
FACTS = [
    ('a real row goes straight to the operator because a drill holds the slot', lambda s, c: s.real == 'operator' and c.HOLDS and s.drill == 'held'),
    ('the drill is graded', lambda s, c: s.drill == 'graded'),
    ('a paused renewal ends in an expired grant', lambda s, c: s.grant == 'expired' and s.renew_paused),
]
SCEN = {
    'drill-burst': dict(),
    'drill-day-one': dict(HOLDS=False),
    'drill-brief': dict(DRILL='brief', HOLDS=False),
    'audit': dict(DRILL=None, REAL=0, T=0, DAYS=3),
    'audit-unlabelled': dict(DRILL=None, REAL=0, T=0, DAYS=2, JUDGE='unmeasured'),
    'audit-low-judge': dict(DRILL=None, REAL=0, T=0, DAYS=2, JUDGE='low'),
    'weekly': dict(DRILL=None, REAL=0, T=0, WEEKS=3, GRANT=1),
}
READINGS = [
    ('ADMISSION', 'ignored', 'drill-burst', 'J2'),
    ('SEQUENCE', 'stamped', 'drill-burst', 'J3'),
    ('SEQUENCE', 'absent', 'drill-burst', 'J4'),
    ('SEAT', 'any', 'drill-day-one', 'J4'),
    ('AUDIT_GAP', 'nothing', 'audit', 'J6'),
    ('UNMEASURED', 'advisory', 'audit-unlabelled', 'J9'),
]
MUTATIONS = [
    ('drill_delivers', 'drill-burst', {}, 'J1'),
    ('drill_lapse_pushes', 'drill-burst', {}, 'J1'),
    ('drill_lapse_counts', 'drill-burst', {}, 'J5'),
    ('missed_weeks_ignored', 'weekly', {}, 'J7'),
    ('paused_grant_renews', 'weekly', {}, 'J8'),
    ('low_judge_latches', 'audit-low-judge', {}, 'J9'),
]
TRACES = [
    ('judges-drill-starves-real-row', 'drill-burst', dict(ADMISSION='ignored'), ('J2',)),
    ('judges-drill-trips-monitor', 'drill-burst', dict(SEQUENCE='stamped'), ('J3',)),
    ('judges-drill-told-by-sequence', 'drill-burst', dict(SEQUENCE='absent'), ('J4',)),
    ('judges-drill-held-on-day-one', 'drill-day-one', dict(SEAT='any'), ('J4',)),
    ('judges-audit-absent', 'audit', dict(AUDIT_GAP='nothing'), ('J6',)),
    ('judges-audit-unlabelled', 'audit-unlabelled', dict(UNMEASURED='advisory'), ('J9',)),
]
