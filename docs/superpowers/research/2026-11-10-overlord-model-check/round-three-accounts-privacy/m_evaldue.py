"""Machine 4: the "evaluation due" trigger and the replay (Table 3.3.11b, §9.5, §3.4).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

A release changes the skill, the card template or the model id: the digest. The running generation was minted
with one digest. The replay gate (Table 9.5a, third row) passes a digest. The replay lane runs the replay body
"only while no renewal is due" (§3.4, §9.5). A renewal is due while `renewalDue` reads a trigger true: it is
read here as a function of the state, as the lane reads it on each sweep.

Bounds: two releases, T_MAX ticks, the soft budget of three, one refill of it.
"""
from collections import namedtuple

DEFAULT = dict(
    RELEASES=1, T_MAX=4, LEAST=1, SOFT_BUDGET=3, REFILLS=1, SOFT0=None,
    # ---- switches: the safe readings -----------------------------------------------------------------------
    EVAL_DUE='minted',    # "changed since the last generation that passed" compares the release's digest with:
                          # 'minted' (the digest the running generation was minted with)
                          # 'gate'   (the digest of the last generation that passed the replay gate: the text)
    MUTATION=None,
)

S = namedtuple('S', 't dig gdig passed age soft b_rel b_refill')


def init(c):
    return S(t=0, dig=0, gdig=0, passed=frozenset([0]), age=0, soft=c.SOFT_BUDGET if c.SOFT0 is None else c.SOFT0,
             b_rel=c.RELEASES, b_refill=c.REFILLS)


def fmt(s):
    return 't=%d release digest %d | the generation was minted with %d, age %d | the replay passed %s | answers %s | soft left %d' % (
        s.t, s.dig, s.gdig, s.age, sorted(s.passed), 'live' if s.gdig in s.passed else 'in shadow', s.soft)


def due(s, c):
    # Table 3.3.11b: "Evaluation due: the model, the skill or the card template changed since the last generation
    # that passed | soft"
    if c.EVAL_DUE == 'minted':
        return s.dig != s.gdig
    return s.dig not in s.passed


def answers_live(s, c):
    # "Until the replay passes, answers are in shadow (§9.5)"
    return s.gdig in s.passed or c.MUTATION == 'answers_before_replay'


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    d = due(s, c)
    if d and s.age >= c.LEAST and s.soft > 0:
        s2 = s._replace(gdig=s.dig, age=0, soft=s.soft - 1)
        add('renewal lane (soft, evaluation due): a fresh start on digest %d' % s.dig, s2, actor='server',
            renew=True, again=due(s2, c))
    # §9.5: "The lane runs it only on a reserved account under the soft line, and only while no renewal is due."
    if s.dig not in s.passed and (not d or c.MUTATION == 'replay_ignores_due'):
        add('replay lane: the replay runs on digest %d and passes' % s.dig,
            s._replace(passed=s.passed | {s.dig}), actor='server', replay=True, due=d)
    if s.t < c.T_MAX:
        add('tick (30 minutes)', s._replace(t=s.t + 1, age=min(s.age + 1, c.LEAST)), actor='time')
    if s.b_rel:
        add('a release changes the skill: digest %d' % (s.dig + 1), s._replace(dig=s.dig + 1, b_rel=s.b_rel - 1),
            actor='world')
    if s.b_refill and s.soft == 0:
        add('six hours pass: the soft budget refills', s._replace(soft=c.SOFT_BUDGET, b_refill=s.b_refill - 1),
            actor='time')
    return E


def ev2(s, lbl, info, s2, c):
    # a renewal that does not clear its own trigger renews again as soon as the budget allows
    if info.get('renew') and info.get('again'):
        return 'the renewal for `evaluation due` landed and the same trigger is still true'
    return None


def ev3(s, lbl, info, s2, c):
    if info.get('replay') and info.get('due'):
        return 'the replay body ran while a renewal was due'
    return None


def ev4(s, c):
    if answers_live(s, c) and s.gdig not in s.passed:
        return 'answers are live on a digest the replay has not passed'
    return None


STATE_CHECKS = [('EV4', ev4)]
EDGE_CHECKS = [('EV2', ev2), ('EV3', ev3)]
LIVE_CHECKS = [
    # §9.5: a change "must pass the replay before it answers": the replay can be reached by the lanes and time alone
    ('EV1', lambda s, c: s.dig not in s.passed and s.t == 0, lambda s, c: s.dig in s.passed,
     lambda lbl: not lbl.startswith('a release')),
]
FACTS = [('answers are live on the new digest', lambda s, c: s.dig > 0 and s.gdig == s.dig and s.gdig in s.passed)]
SCEN = {'release': dict(), 'release-budget-spent': dict(SOFT0=0)}
READINGS = [('EVAL_DUE', 'gate', 'release', 'EV1 EV2')]
MUTATIONS = [('replay_ignores_due', 'release', {}, 'EV3'), ('answers_before_replay', 'release', {}, 'EV4')]
TRACES = [('evaldue-replay-never-runs', 'release', dict(EVAL_DUE='gate'), ('EV1', 'EV2'))]
