"""Machine 3: which sessions a reservation serves (§3.4 C46, §3.1, §3.2 C2, §9.5).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

"The reservations document carries, for each reserved account, the reserve and the ids of the sessions it
serves: the designated session, and the replay body while the replay lane runs one." The server renders the ids;
a fleet-host timer renders the document (Table 11.1c, "The reservations sync ... Its timer"). ccd reads the
document at every placement. This machine holds the ids on the server, the ids in the document, and one start
of each kind: a designation, a rebind and a replay run.

Bounds: one designate, one rebind, one replay run, one period in which the document cannot be refreshed.
"""
from collections import namedtuple

DEFAULT = dict(
    DESIGNATES=1, REBINDS=1, REPLAYS=1, OUTAGES=1,
    # ---- switches: the safe readings -----------------------------------------------------------------------
    START='after-sync',     # a session starts: 'after-sync' (once the document names it) | 'at-once' (the text
                            # does not order the start and the sync)
    SERVE_PENDING=True,     # a `pending` binding's session is among the served ids: True | False ("the designated
                            # session" read as the live binding only)
    MUTATION=None,
)

# bound, pend: session ids (0 none). doc: the ids the document on the fleet host names. body: {id: class}
S = namedtuple('S', 'bound pend doc out started cls guest rp rcls nextid failed b_des b_reb b_rep b_out')


def init(c):
    return S(bound=0, pend=0, doc=frozenset(), out=False, started=False, cls='-', guest=False, rp='-', rcls='-',
             nextid=1, failed=False, b_des=c.DESIGNATES, b_reb=c.REBINDS, b_rep=c.REPLAYS, b_out=c.OUTAGES)


def fmt(s):
    return ('designation: bound %s, pending %s%s | document names %s%s | body %s on %s%s | replay body %s%s' % (
        s.bound or 'none', s.pend or 'none', ' (a first start failed)' if s.failed else '',
        sorted(s.doc) or 'nobody', ' (cannot refresh)' if s.out else '',
        'started' if s.started else 'not started', {'F': 'Fable', 'O': 'Opus', '-': '-'}[s.cls],
        ', answered `reserved` on its own account' if s.guest else '', s.rp,
        '' if s.rcls == '-' else ' on ' + {'F': 'Fable', 'O': 'Opus'}[s.rcls]))


def served(s, c):
    """The ids the server renders (C46): from the designation and the replay lane."""
    ids = set()
    if s.bound:
        ids.add(s.bound)
    if s.pend and c.SERVE_PENDING:
        ids.add(s.pend)
    if s.rp in ('asked', 'running'):
        ids.add(99)
    return frozenset(ids)


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    # the operator's doors (§3.2: "The designate and rebind doors create the session and write the row as `pending`")
    if s.b_des and not s.bound and not s.pend:
        add('operator: Start the Overlord; the row is `pending` for session %d' % s.nextid,
            s._replace(pend=s.nextid, nextid=s.nextid + 1, started=False, cls='-', guest=False, failed=False,
                       b_des=s.b_des - 1), actor='operator')
    if s.b_reb and s.bound and not s.pend:
        add('operator: Rebind the Overlord; the row is `pending` for session %d' % s.nextid,
            s._replace(pend=s.nextid, nextid=s.nextid + 1, started=False, cls='-', guest=False, failed=False,
                       b_reb=s.b_reb - 1), actor='operator')
    # the reservations sync, a fleet-host timer
    if not s.out and s.doc != served(s, c):
        add('reservations sync: the document now names %s' % (sorted(served(s, c)) or 'nobody'),
            s._replace(doc=served(s, c)), actor='server')
    if s.b_out:
        add('the fleet host %s' % ('can refresh the document again' if s.out else 'cannot refresh the document'),
            s._replace(out=not s.out, b_out=s.b_out - 1), actor='fault')
    # the first start of the pending body: ccd reads the document
    if s.pend and not s.started:
        if c.START == 'at-once' or s.pend in s.doc or c.MUTATION == 'start_before_sync':
            named = s.pend in s.doc
            # C46: for a guest "Fable is unservable, with the reason `reserved`"; ccd drops one class (H16)
            add('ccd: session %d starts on a reserved account, on %s%s' % (
                s.pend, 'Fable' if named else 'Opus', '' if named else ': the document does not name it, so it is a guest'),
                s._replace(started=True, cls='F' if named else 'O', guest=not named), actor='ccd', start=True,
                guest=not named)
        elif s.out or not c.SERVE_PENDING:
            # §3.2: "A start that never reports fails the check" at the pending row's deadline
            add('renewal lane: the pending row`s deadline passes with no start; the binding fails',
                s._replace(pend=0, failed=True), actor='server')
    if s.pend and s.started:
        add('the sandbox check passes: the row is `live` for session %d' % s.pend,
            s._replace(bound=s.pend, pend=0), actor='server')
    # the replay lane (§9.5): "While it runs, the server names it among the sessions the reservation serves"
    if s.b_rep and s.rp == '-':
        add('replay lane: a replay run is asked for', s._replace(rp='asked', b_rep=s.b_rep - 1), actor='server')
    if s.rp == 'asked':
        if c.START == 'at-once' or 99 in s.doc:
            named = 99 in s.doc
            add('ccd: the replay body starts on a reserved account, on %s%s' % (
                'Fable' if named else 'Opus', '' if named else ': the document does not name it, so it is a guest'),
                s._replace(rp='running', rcls='F' if named else 'O'), actor='ccd', rstart=True, guest=not named)
    if s.rp == 'running':
        add('replay lane: the run ends', s._replace(rp='done'), actor='server')
    return E


def sv1(s, lbl, info, s2, c):
    # C46: "Fable serves the Overlord only on an account reserved for it, and there it serves only the sessions
    # the reservation serves": the designated session is one of them
    if info.get('start') and info.get('guest'):
        return 'ccd answered the Overlord`s own first start `reserved`: it begins on the fallback class'
    return None


def sv2(s, lbl, info, s2, c):
    # §9.5: the replay body "gets the Overlord's answer for every input of the serviceability answer"
    if info.get('rstart') and info.get('guest'):
        return 'the replay body started as a guest: it replays on the fallback class'
    return None


STATE_CHECKS = []
EDGE_CHECKS = [('SV1', sv1), ('SV2', sv2)]
LIVE_CHECKS = [
    # §3.2: "A pending row never stands without a deadline"
    ('SVL', lambda s, c: bool(s.pend), lambda s, c: not s.pend,
     lambda lbl: lbl.startswith(('reservations sync', 'ccd', 'the sandbox', 'renewal lane'))),
]
FACTS = [('the Overlord`s first generation runs the designated class', lambda s, c: s.started and s.cls == 'F')]
SCEN = {'ids': dict()}
READINGS = [
    ('START', 'at-once', 'ids', 'SV1 SV2'),
    (('START', 'SERVE_PENDING'), ('at-once', False), 'ids', 'SV1 SV2'),
]
MUTATIONS = [('start_before_sync', 'ids', {}, 'SV1')]
TRACES = [('served-first-start-is-a-guest', 'ids', dict(START='at-once'), ('SV1', 'SV2'))]
