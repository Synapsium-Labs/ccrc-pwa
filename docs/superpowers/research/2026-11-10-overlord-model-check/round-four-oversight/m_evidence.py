"""Machine 1: one escalated question, the operator's answer, and what it adds to which record.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it. Section numbers in comments are that file's.

The Overlord files a brief and a sealed prediction on a row that has reached the operator (§6.5, §6.6, §9.5). The
server picks the reveal mode after the brief is filed (`briefRevealMode`, §6.6). The operator answers. The server
classifies the answer (`answerExamined`, §6.6), scores the prediction (§9.5), and adds a case to the kind's gate
(Table 9.5a, row 1) and, for a blind answer, to the grant evidence (§7.2).

Options are A and B. `OWN` is what the operator would choose with nothing in view. The brief recommends one option
and the sealed prediction names one: the two doors are separate (`attach-brief`, `seal-prediction`, Table 7.1a).

A row that reaches the operator waits for its brief until a deadline: its `neededBy`, or ten minutes (§6.8, band 2).

Bounds: one question (or one bundle of BUNDLE rows answered by one tap), one chat text, one hint, one re-file.
"""
from collections import namedtuple

DEFAULT = dict(
    ROW='coord',          # 'coord': a coordinator's item. 'self': an item the Overlord raised (`raise-item`, Table 7.1a)
    BUNDLE=1,             # rows that one tap answers (§6.6, "Bundles are the server's")
    CONSOLE='new',        # 'old': a console that reports no events (`unmeasured`, §6.6)
    OWN='A',
    CHAT=1, HINT=1, REFILE=1,
    # ---- switches: the safe readings ---------------------------------------------------------------------
    SCORE_AGAINST='pick',   # the blind score reads: 'pick' (the first pick, before the reveal)
                            # 'final' (the row's answer after "keeps or switches": §6.5 "against the operator's own answer")
    PRED_REFILE='first',    # a second `seal-prediction` on the row: 'first' (the first stands) | 'last' (it replaces)
    PRED_LATE='pick',       # `prediction-late` once: 'pick' (the operator made a first pick) | 'final' (the row is answered)
    BUNDLE_COUNTS='once',   # a bundle's tap adds: 'once' (one case) | 'each' (one case a row)
    SELF_COUNTS=False,      # an item the Overlord raised itself counts for a gate
    MISSING='miss',         # a row the Overlord left without a prediction past its brief deadline: 'miss' (a
                            # disagreement in the gate's bound) | 'left-out' (Table 9.5a counts answers "each with ... a
                            # sealed prediction filed before it")
    MUTATION=None,
)

S = namedtuple('S', 'brief rec pred pred_rep pred_late mode chat chat_at_pick hint pick revealed final engaged how '
                    'word agree gate grant due miss b_chat b_hint b_refile')


def init(c):
    return S(brief=0, rec=None, pred=None, pred_rep=0, pred_late=0, mode=None, chat=0, chat_at_pick=0, hint=0, pick=None,
             revealed=0, final=None, engaged=0, how=None, word=None, agree=None, gate=0, grant=0, due=0, miss=0,
             b_chat=c.CHAT, b_hint=c.HINT, b_refile=c.REFILE)


def fmt(s):
    return ('brief %s, prediction %s%s%s | mode %s | chat on screen %d, hint %d | pick %s, revealed %d, final %s (%s) | '
            'scored %s, agree %s | gate cases %d, grant cases %d, misses %d%s' % (
                ('recommends %s' % s.rec) if s.brief else 'none', s.pred, ' (replaced after a hint)' if s.pred_rep else '',
                ' (filed after the pick)' if s.pred_late else '', s.mode, s.chat, s.hint, s.pick, s.revealed, s.final,
                s.how, s.word, s.agree, s.gate, s.grant, s.miss, ' | brief deadline passed' if s.due else ''))


def other(o):
    return 'B' if o == 'A' else 'A'


def score(s, c, final, how, engaged):
    """The transaction of the operator's answer: `answerExamined`, the prediction's score, the records."""
    rec = s.rec
    # §6.6: the first match wins: `unmeasured`, `blind`, `examined`, then `glanced`
    if c.CONSOLE == 'old' and c.MUTATION != 'unmeasured_counts':
        word = 'unmeasured'
    elif how == 'delegated':
        word = 'delegated'            # §6.6: "You decide" is logged `delegated`, never counted as agreement
    elif s.mode == 'blind' and s.pick is not None and (not s.chat_at_pick or c.MUTATION == 'chat_ignored'):
        word = 'blind'                # "answered before the reveal in `blind-sample` mode", no chat text on screen
    elif s.brief and (final != rec or engaged):
        word = 'examined'             # another option than the recommended one, or an edit, a note or a dwell
    else:
        word = 'glanced'              # a plain accept; an answer with no brief on the row
    if c.MUTATION == 'delegated_counts' and how == 'delegated':
        word = 'examined'
    # §9.5: "Agreement is an exact match of the chosen option". Which answer a blind score reads is the switch.
    read = s.pick if (word == 'blind' and c.SCORE_AGAINST == 'pick') else final
    agree = None if s.pred is None else (s.pred == read)
    counts = word in ('blind', 'examined') and s.pred is not None       # Table 9.5a, row 1
    if c.ROW == 'self' and not c.SELF_COUNTS:
        counts = False
    n = (c.BUNDLE if c.BUNDLE_COUNTS == 'each' else 1) if counts else 0
    g = n if word == 'blind' else 0                                       # §7.2: "from blind answers only"
    # §9.5: "A missing prediction, where the Overlord had its triage window, is a miss."
    miss = 1 if (s.pred is None and s.due and c.MISSING == 'miss' and c.ROW == 'coord') else 0
    return s._replace(final=final, how=how, engaged=engaged, word=word, agree=agree, gate=n, grant=g, miss=miss)


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    if s.final is not None:
        return E
    if not s.due:
        add('time: the row\'s brief deadline passes', s._replace(due=1), actor='time')
    # ---- the Overlord ---------------------------------------------------------------------------------------
    if not s.brief:
        for o in 'AB':
            add('Overlord: attach-brief, recommending %s' % o, s._replace(brief=1, rec=o), actor='overlord')
    late = (s.pick is not None) if c.PRED_LATE == 'pick' else False      # the row is not answered until `final`
    if not late:
        for o in 'AB':
            if s.pred is None:
                add('Overlord: seal-prediction %s' % o, s._replace(pred=o, pred_late=1 if s.pick is not None else 0),
                    actor='overlord')
            elif o != s.pred and s.b_refile and c.PRED_REFILE == 'last':
                # a second prediction on the same row, under a new operation key
                add('Overlord: seal-prediction %s again (it replaces the first)' % o,
                    s._replace(pred=o, pred_rep=1 if s.hint else s.pred_rep, pred_late=1 if s.pick is not None else s.pred_late,
                               b_refile=s.b_refile - 1), actor='overlord')
    if s.brief and s.b_chat and s.pick is None:
        # clause 13 forbids a recommendation in the chat; the server's test is the events (§6.6)
        add('Overlord: writes chat text after the filing; the console shows it', s._replace(chat=1, b_chat=s.b_chat - 1),
            actor='overlord')
    # ---- the server -----------------------------------------------------------------------------------------
    if s.brief and s.mode is None:        # §6.6: "the server picks it after the brief is filed"
        for m in ('blind', 'ontap', 'shown'):
            add('server: briefRevealMode picks %s' % m, s._replace(mode=m), actor='server')
    # ---- the operator ---------------------------------------------------------------------------------------
    if s.b_hint and s.pick is None:
        add('operator: a chat message that gives away the lean (%s)' % c.OWN, s._replace(hint=1, b_hint=s.b_hint - 1),
            actor='operator')
    if s.mode == 'blind':
        if s.pick is None:
            add('operator: picks %s before the reveal' % c.OWN, s._replace(pick=c.OWN, chat_at_pick=s.chat), actor='operator')
        elif not s.revealed:
            add('console: the recommendation (%s) is revealed' % s.rec, s._replace(revealed=1), actor='server')
        else:
            add('operator: keeps %s' % s.pick, score(s, c, s.pick, 'kept', 0), actor='operator', answer=True)
            if s.rec != s.pick:
                add('operator: switches to the recommended %s' % s.rec, score(s, c, s.rec, 'switched', 0),
                    actor='operator', answer=True)
    elif s.mode in ('ontap', 'shown'):
        rec = s.rec
        add('operator: answers %s, a plain tap' % c.OWN, score(s, c, c.OWN, 'tap', 0), actor='operator', answer=True)
        add('operator: opens the other option\'s downsides, dwells, answers %s' % c.OWN, score(s, c, c.OWN, 'dwell', 1),
            actor='operator', answer=True)
        if rec != c.OWN:
            add('operator: accepts the recommended %s, a plain tap' % rec, score(s, c, rec, 'accept', 0), actor='operator',
                answer=True)
        add('operator: "You decide" (%s)' % rec, score(s, c, rec, 'delegated', 0), actor='operator', answer=True)
    elif s.mode is None and not s.brief:
        add('operator: answers %s before any brief' % c.OWN, score(s, c, c.OWN, 'no-brief', 0), actor='operator', answer=True)
    return E


# ---- checks -------------------------------------------------------------------------------------------------

def e1(s, c):
    # §6.6: `blind` is "answered before the reveal". An agreement scored blind must be the operator's own pick.
    if s.word == 'blind' and s.agree and s.gate and s.pick != s.pred:
        return 'a blind agreement was scored on an answer the operator changed after seeing the recommendation'
    if s.word == 'blind' and s.chat_at_pick:
        return 'an answer was scored blind with the Overlord\'s chat text on screen before the pick'
    return None


def e2(s, c):
    # one decision of the operator's is one case
    if s.gate > 1 or s.grant > 1:
        return 'one tap of the operator added %d cases to the kind\'s gate and %d to the grant evidence' % (s.gate, s.grant)
    return None


def e3(s, c):
    # §9.5: "every gate reads evidence the Overlord cannot reach or shape"
    if c.ROW == 'self' and (s.gate or s.grant):
        return 'a question the Overlord raised and worded itself added a case to a gate'
    return None


def e4(s, c):
    # §9.5: "nothing the Overlord can read holds the answer"; C20: filed "before the operator answers"
    if s.gate and s.agree and s.pred_rep:
        return 'the scored prediction replaced an earlier one after the operator gave the lean away'
    if s.gate and s.pred_late:
        return 'the scored prediction was filed after the operator\'s first pick'
    return None


def e5(s, c):
    if c.CONSOLE == 'old' and (s.gate or s.grant):
        return 'an answer from a console that reports no events added a case'
    return None


def e6(s, c):
    if s.how in ('delegated', 'no-brief') and (s.gate or s.grant):
        return 'a "You decide", or an answer with no brief on the row, added a case'
    if s.how == 'accept' and s.gate:
        return 'a plain accept of the recommendation added a case'
    return None


def e7(s, c):
    # §9.5: "The denominator is every escalated item in the cell." A question left unpredicted counts against the record.
    if s.final is not None and s.pred is None and s.due and c.ROW == 'coord' and not s.miss:
        return 'a question the Overlord had its time on, and sealed no prediction for, is left out of the gate'
    return None


STATE_CHECKS = [('E1', e1), ('E2', e2), ('E3', e3), ('E4', e4), ('E5', e5), ('E6', e6), ('E7', e7)]
EDGE_CHECKS = []
LIVE_CHECKS = []
FACTS = [
    ('a blind case reaches the grant evidence', lambda s, c: s.grant == 1),
    ('an examined case reaches the kind\'s gate', lambda s, c: s.gate == 1 and s.word == 'examined'),
]
SCEN = {
    'item': dict(),
    'bundle': dict(BUNDLE=2, HINT=0, CHAT=0),
    'own-item': dict(ROW='self', HINT=0),
    'old-console': dict(CONSOLE='old', HINT=0),
}
READINGS = [
    ('SCORE_AGAINST', 'final', 'item', 'E1'),
    ('PRED_REFILE', 'last', 'item', 'E4'),
    ('PRED_LATE', 'final', 'item', 'E4'),
    ('BUNDLE_COUNTS', 'each', 'bundle', 'E2'),
    ('SELF_COUNTS', True, 'own-item', 'E3'),
    ('MISSING', 'left-out', 'item', 'E7'),
]
MUTATIONS = [
    ('chat_ignored', 'item', {}, 'E1'),
    ('unmeasured_counts', 'old-console', {}, 'E5'),
    ('delegated_counts', 'item', {}, 'E6'),
]
TRACES = [
    ('evidence-switch-scored-blind', 'item', dict(SCORE_AGAINST='final', HINT=0, CHAT=0), ('E1',)),
    ('evidence-prediction-replaced', 'item', dict(PRED_REFILE='last', CHAT=0), ('E4',)),
    ('evidence-prediction-after-pick', 'item', dict(PRED_LATE='final', HINT=0, CHAT=0), ('E4',)),
    ('evidence-bundle-counts-twice', 'bundle', dict(BUNDLE_COUNTS='each'), ('E2',)),
    ('evidence-own-item-counts', 'own-item', dict(SELF_COUNTS=True, CHAT=0), ('E3',)),
    ('evidence-unpredicted-left-out', 'item', dict(MISSING='left-out', CHAT=0, HINT=0), ('E7',)),
]
