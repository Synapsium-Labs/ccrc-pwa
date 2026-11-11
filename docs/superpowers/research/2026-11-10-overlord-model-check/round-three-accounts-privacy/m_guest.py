"""Machine 2: one guest session and one reserved account (§3.4, C46: "Guests yield through machinery that exists").

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

X is an account reserved for the Overlord, with reservePct 40. Y is any other account the guest's pool admits:
it has room, or it is full. The guest's class is CLS (`fable`, `opus`, or `default` for no class). The figures
of X are whole tens: `g` is every session's use but the Overlord's Fable, `f` is the Overlord's Fable, both in
points of the seven-day window. The five-hour window is not modelled here (`arith.py` sweeps it).

Bounds: G_MAX and F_MAX cap the figures; every use, stale reading, unmeasured figure and manual move has a budget.
"""
from collections import namedtuple

CEIL, R, FCEIL, SOFT = 98, 40, 40, 70

DEFAULT = dict(
    CLS='opus', Y='room',          # Y: 'room' | 'full' | 'none'
    G0=0, F0=0, WHERE0='-',
    USES=4, FABLES=2, STALES=1, UNMEAS=1, MANUAL=1, YFLIPS=1, SWEEPS=3,
    # ---- switches: the safe readings -----------------------------------------------------------------------
    BASE='soft',          # the guest ceiling counts from: 'soft' (the soft line) | 'text' (the seven-day ceiling)
    REASON_ALL=True,      # every refusal the reservation causes says `reserved`: True | False (the text: Fable and
                          # an unmeasured figure only)
    STALE_SECOND=False,   # a stale share reading can move a guest mid-turn: False | True (the text)
    MUTATION=None,
)

S = namedtuple('S', 'g f fresh meas y where run busy word pin past item b_use b_fab b_stale b_unm b_man b_y b_sw')


def init(c):
    return S(g=c.G0, f=c.F0, fresh=True, meas=True, y=c.Y, where=c.WHERE0, run=c.CLS, busy=False, word=None,
             pin=False, past=0, item=False, b_use=c.USES, b_fab=c.FABLES, b_stale=c.STALES, b_unm=c.UNMEAS,
             b_man=c.MANUAL, b_y=c.YFLIPS, b_sw=c.SWEEPS)


def fmt(s):
    return ('X: others %d + Overlord`s Fable %d = %d of the window%s%s | Y: %s | guest on %s, runs %s, %s%s%s | '
            'told: %s%s' % (s.g, s.f, s.g + s.f, '' if s.fresh else ' (share reading STALE)',
                            '' if s.meas else ' (seven-day UNMEASURED)', s.y, s.where, s.run,
                            'busy' if s.busy else 'idle', ' pinned' if s.pin else '',
                            ' past the line for %d sweeps' % s.past if s.past else '', s.word or 'nothing',
                            ' | operator item raised' if s.item else ''))


def left(s):
    # "An unmeasured or stale reading counts as nothing used, so the whole reserve is kept."
    return R if not s.fresh else max(0, R - s.f)


def ceiling(s, c):
    lf = left(s)
    if c.BASE == 'text':
        return CEIL - lf                    # "the seven-day ceiling (98) minus what is left of the reserve"
    return CEIL if lf == 0 else SOFT - lf


def answer_x(s, c, cls, placing):
    """The serviceability answer for a guest on X, with its reason."""
    if cls == 'fable':
        if c.MUTATION == 'fable_guest_served':
            return 'servable', None
        return 'unservable', 'reserved'     # "Fable is unservable, with the reason `reserved`"
    if not s.meas:
        # "An unmeasured seven-day figure admits no new guest there ... The swap keeps today's answer, so no guest
        # is moved."
        if placing:
            return ('servable', None) if c.MUTATION == 'unmeasured_admits' else ('unservable', 'reserved')
        return 'unmeasured', None
    tot = s.g + s.f
    if tot >= CEIL:
        return 'unservable', 'limit'
    if tot >= ceiling(s, c):
        return 'unservable', ('reserved' if c.REASON_ALL else None)
    return 'servable', None


def past_second(s, c):
    # "Once either window's figure is past the guest's ceiling by half of what is left of the reserve, ccd moves
    # the guest as it does on a hard block, in the middle of its turn."
    if not s.meas:
        return False
    if not s.fresh and not c.STALE_SECOND:
        return False
    return s.g + s.f > ceiling(s, c) + left(s) / 2.0


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    # ---- ccd -------------------------------------------------------------------------------------------
    if s.where == '-':
        ans, why = answer_x(s, c, s.run, True)
        if ans == 'servable':
            add('ccd places the guest on X', s._replace(where='X', word=None), actor='ccd', place='X')
        elif s.y == 'room':
            add('ccd passes over X (%s) and places the guest on Y' % (why or 'no word'),
                s._replace(where='Y', word=why), actor='ccd', place='Y', why=why, reserve=why != 'limit')
        elif s.run == 'fable':
            # "ccd already drops a Fable session one class where Fable cannot be served"
            add('ccd drops the guest one class (X: %s)' % why, s._replace(run='opus', word=why), actor='ccd',
                why=why, reserve=True)
        elif s.word != (why or 'no word'):
            add('ccd finds no account for the guest (X: %s)' % (why or 'no word'),
                s._replace(word=why or 'no word'), actor='ccd', stranded=True, why=why, reserve=why != 'limit')
    if s.where == 'X' and s.b_sw:
        ans, why = answer_x(s, c, s.run, False)
        if ans == 'unservable':
            mid = s.busy and past_second(s, c)
            # `_swap_pinned` holds a manual move "unless the guest is past the line"
            if (not s.busy or mid) and c.MUTATION != 'pin_holds_past_line' or (not s.pin and (not s.busy or mid)):
                if s.y == 'room':
                    add('ccd moves the guest off X to Y%s (%s)' % (' in the middle of its turn' if mid else
                                                                 ' at its idle boundary', why or 'no word'),
                        s._replace(where='Y', busy=False, pin=False, past=0, word=why, b_sw=s.b_sw - 1),
                        actor='ccd', moved=True, mid=mid, why=why, stale=not s.fresh, reserve=why != 'limit')
                elif s.run == 'fable':
                    add('ccd drops the guest one class on X (%s)' % why,
                        s._replace(run='opus', word=why, b_sw=s.b_sw - 1), actor='ccd', why=why, reserve=True)
                else:
                    # M32: "guests standing past the line for longer than two sweeps" raise an operator item
                    p = min(s.past + 1, 3)
                    add('ccd`s sweep: the guest must leave X and nothing can take it (%s)' % (why or 'no word'),
                        s._replace(past=p, word=why or 'no word', item=s.item or p >= 3, b_sw=s.b_sw - 1),
                        actor='ccd', stranded=True, why=why, reserve=why != 'limit')
    if s.where == 'Y' and s.y == 'full' and s.b_sw:
        add('ccd moves the guest off Y, which is full', s._replace(where='-', busy=False, b_sw=s.b_sw - 1),
            actor='ccd')

    # ---- the guest and the world ------------------------------------------------------------------------
    if s.where != '-':
        add('the guest`s turn %s' % ('ends' if s.busy else 'starts'), s._replace(busy=not s.busy), actor='guest')
    if s.b_use and s.g + s.f + 10 <= 100:
        # other guests are placed only under the ceiling; this guest's own long turn is bounded by the second line
        own = s.where == 'X' and s.busy and not past_second(s, c)
        others = s.meas and s.g + s.f < ceiling(s, c)
        if own or others:
            add('%s use raises X by 10' % ('the guest`s own' if own else 'other guests`'),
                s._replace(g=s.g + 10, b_use=s.b_use - 1), actor='world', guest_use=True)
    if s.b_fab and s.f + 20 <= FCEIL and s.g + s.f + 20 <= 100:
        add('the Overlord`s Fable raises X by 20', s._replace(f=s.f + 20, b_fab=s.b_fab - 1), actor='world')
    if s.b_stale:
        add('the Fable share reading %s' % ('is fresh again' if not s.fresh else 'goes stale'),
            s._replace(fresh=not s.fresh, b_stale=s.b_stale - 1), actor='world')
    if s.b_unm:
        add('the seven-day figure %s' % ('is measured again' if not s.meas else 'goes unmeasured'),
            s._replace(meas=not s.meas, b_unm=s.b_unm - 1), actor='world')
    if s.b_y and s.y != 'none':
        add('Y %s' % ('has room again' if s.y == 'full' else 'fills'),
            s._replace(y='room' if s.y == 'full' else 'full', b_y=s.b_y - 1), actor='world')
    if s.b_man and s.where != 'X':
        # "A move the operator makes by hand onto a reserved account is never refused: ccd says the account is
        # reserved and has no room. The manual-swap pin then holds it"
        if c.MUTATION != 'manual_refused' or answer_x(s, c, s.run, True)[0] == 'servable':
            ans, why = answer_x(s, c, s.run, True)
            add('operator: moves the guest onto X by hand%s' % ('' if ans == 'servable' else ' (ccd says: reserved, no room)'),
                s._replace(where='X', pin=True, busy=False, b_man=s.b_man - 1,
                           run='opus' if s.run == 'fable' and ans != 'servable' else s.run),
                actor='operator', manual=True)
        else:
            add('operator: moves the guest onto X by hand; ccd refuses', s._replace(b_man=s.b_man - 1),
                actor='operator', manual=True, refused=True)
    return E


# ---------------------------------------------------------------------------------------------------------
# checks

def g_word(s, lbl, info, s2, c):
    # the check this model adds: a guest the reservation turns away is told so
    if info.get('reserve') and info.get('why') != 'reserved' and (info.get('moved') or info.get('stranded')
                                                                  or info.get('place') == 'Y'):
        if s.g + s.f < CEIL:
            return ('the reservation turns the guest away at %d of the window, and the word is `%s`, not `reserved`'
                    % (s.g + s.f, info.get('why') or 'none'))
    return None


def g_fable(s, c):
    # C46: "Fable is unservable, with the reason `reserved`"; M32's target is zero
    if s.where == 'X' and s.run == 'fable':
        return 'a guest runs Fable on a reserved account'
    return None


def g_reserve(s, lbl, info, s2, c):
    # C46: "No other session may spend the capacity the Overlord needs." The second line allows half of what is left.
    if info.get('guest_use') and s2.fresh and s2.meas:
        lf = max(0, R - s2.f)
        if s2.g + s2.f + lf / 2.0 > CEIL + 10:
            return 'guests took the figure to %d with %d of the reserve left' % (s2.g + s2.f, lf)
    return None


def g_unmeasured(s, lbl, info, s2, c):
    # "An unmeasured seven-day figure admits no new guest there ... so no guest is moved."
    if not s.meas and info.get('place') == 'X':
        return 'a guest was placed on the reserved account while its seven-day figure was unmeasured'
    if not s.meas and info.get('moved'):
        return 'a guest was moved off the reserved account on an unmeasured figure'
    return None


def g_manual(s, lbl, info, s2, c):
    # "swaps are never refused" (the operator's ruling of 2026-10-19)
    if info.get('manual') and info.get('refused'):
        return 'a move the operator made by hand was refused'
    return None


def g_stale(s, lbl, info, s2, c):
    # the check this model adds, after "The swap keeps today's answer, so no guest is moved" for an unmeasured figure
    if info.get('moved') and info.get('mid') and info.get('stale'):
        fresh_ok = s.g + s.f < (CEIL - max(0, R - s.f) if c.BASE == 'text' else
                                (CEIL if R - s.f <= 0 else SOFT - (R - s.f)))
        if fresh_ok:
            return 'a stale share reading moved a guest in the middle of its turn; a fresh one would have kept it'
    return None


STATE_CHECKS = [('GF', g_fable)]
EDGE_CHECKS = [('GW', g_word), ('GRES', g_reserve), ('GU', g_unmeasured), ('GMAN', g_manual), ('GSTALE', g_stale)]

LIVE_CHECKS = [
    # a guest past its line on X leaves, or the operator is told (M32), by ccd's sweeps alone
    ('GL', lambda s, c: (s.where == 'X' and s.meas and s.b_sw >= 3 and not s.busy
                         and answer_x(s, c, s.run, False)[0] == 'unservable'),
     lambda s, c: s.where != 'X' or s.item or answer_x(s, c, s.run, False)[0] != 'unservable',
     lambda lbl: lbl.startswith('ccd')),
]

FACTS = [
    ('a guest is placed on the reserved account', lambda s, c: s.where == 'X'),
    ('a guest stands past the line with nowhere to go, and the operator has an item',
     lambda s, c: s.where == 'X' and s.item),
]

SCEN = {
    'opus': dict(CLS='opus', Y='room'),
    'opus-nowhere': dict(CLS='opus', Y='full', G0=20, WHERE0='X', UNMEAS=0, MANUAL=0),
    'default': dict(CLS='default', Y='room', UNMEAS=0, MANUAL=0),
    'fable': dict(CLS='fable', Y='room', USES=2, STALES=0),
    'fable-nowhere': dict(CLS='fable', Y='none', USES=2, STALES=0, UNMEAS=0),
    'stale': dict(CLS='opus', Y='room', G0=50, F0=40, WHERE0='X', USES=2, FABLES=0, UNMEAS=0, MANUAL=0, STALES=2),
}

READINGS = [
    ('REASON_ALL', False, 'opus', 'GW'),
    ('REASON_ALL', False, 'default', 'GW'),
    ('REASON_ALL', False, 'opus-nowhere', 'GW'),
    (('STALE_SECOND', 'BASE'), (True, 'text'), 'stale', 'GSTALE'),
    ('STALE_SECOND', True, 'stale', 'GSTALE'),
    ('BASE', 'text', 'opus', ''),
]

MUTATIONS = [
    ('fable_guest_served', 'fable', {}, 'GF'),
    ('unmeasured_admits', 'opus', {}, 'GU'),
    ('manual_refused', 'opus', {}, 'GMAN'),
    ('pin_holds_past_line', 'opus', {}, 'GL'),
]

TRACES = [
    ('guest-turned-away-with-no-word', 'opus-nowhere', dict(REASON_ALL=False, BASE='text'), ('GW',)),
    ('guest-moved-mid-turn-on-a-stale-reading', 'stale', dict(STALE_SECOND=True, BASE='text'), ('GSTALE',)),
]
