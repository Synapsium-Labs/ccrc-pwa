"""Machine 3b: a proposal, the operator's command on it, and the two-step act it authorises.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it, §3.8 (H8), §8.2 (a start is a two-step act), §10.1 (Table 10.1b, "Two
keys", "An authority is spent once"), Table 11.6 (`proposal-stale`, `proposal-limit`).
Section numbers are that file's.

One target (a request that needs a start), up to PROPOSALS proposals for it one after another,
one command at a time, one act row for the target's natural key. The act's effect lies outside
the database (ccd on another host), so it is written `pending`, performed, then settled.
Clocks are ticks left: a proposal lives PEXP ticks from its filing (24 hours), a command CEXP
ticks (15 minutes). Time itself has no bound; each fault and each tap has a budget.
"""
from collections import namedtuple

P_TERMINAL = ('consumed', 'expired', 'stale', 'replaced')

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    PEXP=3, CEXP=1,
    PROPOSALS=2, TAPS=2, TARGET_MOVES=1, CRASHES=1, FAR_FAILS=1, UNMEASURED=1, RETRIES=1,
    # ---- switches: readings of the text -------------------------------------------------
    NATKEY='refused-frees',      # a `refused` row and its natural key: 'refused-frees' | 'blocks'
    REFUSED_TOLD='told',         # a commanded act that settles `refused`: the operator is 'told' | 'none' (the text)
    STALE_DETECT='open-or-commanded',  # a target row moves: | 'open-only' (the text's list of moves)
    MUTATION=None,
)

S = namedtuple('S', 'up pn p prem cmd crem moved a did cont eff told toldf '
                    'b_prop b_tap b_move b_crash b_fail b_unm b_retry')


def init(c):
    return S(up=True, pn=0, p='none', prem=0, cmd='none', crem=0, moved=False, a='none', did=False, cont=False,
             eff=0, told=False, toldf=False,
             b_prop=c.PROPOSALS, b_tap=c.TAPS, b_move=c.TARGET_MOVES, b_crash=c.CRASHES, b_fail=c.FAR_FAILS,
             b_unm=c.UNMEASURED, b_retry=c.RETRIES)


def fmt(s):
    return ('%s | proposal %d=%s%s%s | command=%s%s | act=%s%s effects=%d%s%s' % (
        'up' if s.up else 'DOWN', s.pn, s.p, ' (%d left)' % s.prem if s.p in ('open', 'commanded') else '',
        ' target-moved' if s.moved else '', s.cmd, ' (%d left)' % s.crem if s.cmd == 'live' else '',
        s.a, ' door-call-in-flight' if s.cont else '', s.eff,
        ' operator-told-command-expired' if s.told else '', ' operator-told-act-refused' if s.toldf else ''))


def settle_refused(s, c):
    s2 = s._replace(a='refused', cont=False)
    if c.REFUSED_TOLD == 'told' and s2.p == 'consumed':
        s2 = s2._replace(toldf=True)
    return s2


def urgent(s, c):
    if not s.up:
        return
    # §3.8 "The command is valid for 15 minutes. One that expires unused returns its proposal to `open`"
    if s.cmd == 'live' and s.crem == 0 and c.MUTATION != 'command_never_expires':
        s2 = s._replace(cmd='expired', told=True)       # "A command that expires unused is told to the operator."
        if s2.p == 'commanded':
            s2 = s2._replace(p='open')
        yield 'command lane: the 15 minutes passed unused, the proposal returns to `open`', s2
    # §3.8 "`open` moves ... to `expired` after 24 hours"
    if s.p == 'open' and s.prem == 0:
        yield 'proposal lane: 24 hours after filing, `expired`', s._replace(p='expired')
    # §10.1 "A boot pass and a lane settle every `pending` row by measuring again"
    if s.a in ('pending', 'unknown') and not s.cont:
        if s.did:
            yield 'settling lane: measured, the effect happened, the act is `done`', s._replace(a='done')
        else:
            yield 'settling lane: measured, the effect did not happen, the act is `refused`', settle_refused(s, c)
        if s.a == 'pending' and s.b_unm:
            yield 'settling lane: the effect cannot be measured, the act is `unknown`', \
                s._replace(a='unknown', b_unm=s.b_unm - 1)


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    urg = list(urgent(s, c))
    for lbl, s2 in urg:
        add(lbl, s2, actor='server')
    if not urg:
        s2 = s
        if s.p in ('open', 'commanded') and s.prem > 0:
            s2 = s2._replace(prem=s.prem - 1)
        if s.cmd == 'live' and s.crem > 0:
            s2 = s2._replace(crem=s.crem - 1)
        add('tick', s2, actor='time')
    if s.up and s.b_crash:
        add('SERVER CRASH', s._replace(up=False, cont=False, b_crash=s.b_crash - 1), actor='env')
    if not s.up:
        add('server boots', s._replace(up=True), actor='server')
        return E

    # ---- the Overlord files a proposal (§3.8: one open proposal per target) ------------------------
    if s.b_prop and s.p in ('none',) + P_TERMINAL and s.a in ('none', 'refused'):
        add('Overlord: files a proposal for the start',
            s._replace(pn=s.pn + 1, p='open', prem=c.PEXP, cmd='none', crem=0, moved=False, told=False,
                       b_prop=s.b_prop - 1), actor='overlord', newprop=True)

    # ---- a target row moves (§3.8: "to `stale` when a target row moves") -----------------------------
    if s.b_move and s.p in ('open', 'commanded') and not s.moved:
        s2 = s._replace(moved=True, b_move=s.b_move - 1)
        if s.p == 'open' or c.STALE_DETECT == 'open-or-commanded':
            s2 = s2._replace(p='stale')
            if s2.cmd == 'live':
                s2 = s2._replace(cmd='expired', told=True)
        add('a target row moves', s2, actor='env')

    # ---- the operator's tap on the card (§3.8, behind the step-up) ------------------------------------
    if s.b_tap:
        if s.p == 'open' and (not s.moved or c.MUTATION == 'tap_ignores_moved_target'):
            add('operator: taps Command on the card', s._replace(p='commanded', cmd='live', crem=c.CEXP,
                                                              b_tap=s.b_tap - 1), actor='operator', tap=True)
        elif s.p == 'open' and s.moved:
            add('operator: taps Command; refused `proposal-stale`', s._replace(b_tap=s.b_tap - 1), actor='operator')
        elif s.p in P_TERMINAL and c.MUTATION == 'tap_on_terminal':
            add('operator: a stale tap on a card that is no longer open; accepted',
                s._replace(p='commanded', cmd='live', crem=c.CEXP, b_tap=s.b_tap - 1), actor='operator', tap=True)

    # ---- the Overlord carries the command out through its start door (§8.2, §10.1) ---------------------
    key_free = s.a == 'none' or (s.a == 'refused' and c.NATKEY == 'refused-frees')
    live = s.cmd == 'live' and (s.crem > 0 or c.MUTATION == 'act_after_expiry')
    if c.MUTATION == 'act_after_expiry' and s.cmd == 'expired' and s.p == 'open':
        live = True
    okp = s.p == 'commanded' or (c.MUTATION == 'act_after_expiry' and s.p == 'open')
    fresh = not s.moved or c.MUTATION == 'act_ignores_moved_target'
    if okp and live and fresh:
        if key_free:
            # "A command is consumed in the transaction that writes its act row, as `pending`"
            add('Overlord: the start door writes the act `pending`; the command and the proposal are consumed',
                s._replace(a='pending', did=False, cont=True, cmd='consumed', p='consumed'), actor='overlord',
                act=True)
        else:
            add('Overlord: the start door finds a `%s` row under the natural key and does not act' % s.a, s,
                actor='overlord')
    if s.a == 'pending' and s.cont:
        if not s.did:
            add('the effect is performed on the far host', s._replace(did=True, eff=s.eff + 1), actor='overlord',
                effect=True)
            if s.b_fail:
                add('the far host refuses the start; the door settles the act `refused`',
                    settle_refused(s._replace(b_fail=s.b_fail - 1), c), actor='overlord')
        else:
            add('the door settles the act `done`', s._replace(a='done', cont=False), actor='overlord')
    if s.b_retry and s.a in ('pending', 'done', 'refused', 'unknown'):
        # §10.1: "a repeated key returns the first call's row and outcome, and never acts again"
        if c.MUTATION == 'retry_spends_again' and s.a in ('pending', 'done'):
            add('Overlord: retries with the same operation key; the effect runs again',
                s._replace(eff=s.eff + 1, b_retry=s.b_retry - 1), actor='overlord', effect=True)
        else:
            add('Overlord: retries with the same operation key; the first row is returned',
                s._replace(b_retry=s.b_retry - 1), actor='overlord')
    return E


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def i3(s, c):
    # I3 "At most one effect per natural key"
    if s.eff > 1:
        return 'the start ran %d times for one request' % s.eff
    return None


def s2_(s, lbl, info, s2, c):
    # §10.1 "An authority is spent once"; §3.8: valid for 15 minutes, bound to what the card showed
    if info.get('act'):
        if s.cmd != 'live' or s.crem == 0:
            return 'an act row was written under a command that is %s' % (
                'past its 15 minutes' if s.cmd in ('live', 'expired') else s.cmd)
        if s.p != 'commanded':
            return 'an act row was written for a proposal that is `%s`' % s.p
        if s.moved:
            return 'an act row was written though a target row moved after the card was shown'
    if info.get('tap') and (s.p != 'open' or s.moved):
        return 'a command was made on a proposal that is `%s`%s' % (s.p, ' with a moved target' if s.moved else '')
    return None


def s5(s, lbl, info, s2, c):
    # §3.8 "All but `open` and `commanded` are terminal."
    if s.p in P_TERMINAL and s2.pn == s.pn and s2.p != s.p:
        return 'proposal %d left the terminal state `%s` (to `%s`)' % (s.pn, s.p, s2.p)
    return None


def s8(s, c):
    # §3.8 "to `stale` when a target row moves": an open card must not show a target that has moved
    if s.up and s.p == 'open' and s.moved:
        return 'the proposal is `open` though its target row moved'
    return None


def s9(s, c):
    # §3.8 "One live command per proposal": a live command stands only on a `commanded` proposal
    if s.cmd == 'live' and s.p != 'commanded':
        return 'a command is live on a proposal that is `%s`' % s.p
    return None


STATE_CHECKS = [('I3', i3), ('S8', s8), ('S9', s9)]
EDGE_CHECKS = [('S2', s2_), ('S5', s5)]


def _server_only(lbl):
    return lbl == 'tick' or lbl.startswith(('command lane', 'proposal lane', 'settling lane', 'server boots'))


LIVE_CHECKS = [
    # every proposal ends by itself (24 hours), and every command (15 minutes)
    ('L2', lambda s, c: s.p in ('open', 'commanded') and s.up, lambda s, c: s.p in P_TERMINAL, _server_only),
    # every pending act is settled by measuring (§10.1)
    ('L4', lambda s, c: s.a == 'pending' and not s.cont and s.up, lambda s, c: s.a != 'pending', _server_only),
    # a commanded act that did not happen: the server tells the operator (as it does for an expired command)
    ('L1', lambda s, c: s.a == 'refused' and s.p == 'consumed' and s.eff == 0 and s.up,
     lambda s, c: s.toldf or s.eff > 0, _server_only),
    # ... and the start can still be made: a `refused` row must not hold the request's one start for ever
    ('L3', lambda s, c: s.a == 'refused' and s.eff == 0 and s.up and s.b_prop > 0 and s.b_tap > 0,
     lambda s, c: s.eff > 0 or s.a in ('pending', 'done'),
     lambda lbl: not lbl.startswith(('SERVER CRASH', 'a target row moves', 'the far host refuses'))),
]

FACTS = [
    ('a commanded start is done', lambda s, c: s.a == 'done' and s.eff == 1),
    ('a command expires unused and the operator is told', lambda s, c: s.cmd == 'expired' and s.told),
    ('a commanded act settles `refused`', lambda s, c: s.a == 'refused' and s.p == 'consumed'),
]

SCEN = {
    'command': dict(PEXP=3, CEXP=1, PROPOSALS=2, TAPS=2, TARGET_MOVES=1, CRASHES=1, FAR_FAILS=1, UNMEASURED=1,
                    RETRIES=1),
    # a second attempt after a refused start: more taps and proposals, no target moves
    'retry': dict(PEXP=3, CEXP=1, PROPOSALS=3, TAPS=3, TARGET_MOVES=0, CRASHES=1, FAR_FAILS=1, UNMEASURED=0,
                  RETRIES=0),
}

READINGS = [
    ('NATKEY', 'blocks', 'retry', 'L3'),
    ('REFUSED_TOLD', 'none', 'command', 'L1'),
    ('STALE_DETECT', 'open-only', 'command', 'S8'),
]

MUTATIONS = [
    ('command_never_expires', 'command', {}, 'L2'),
    ('act_after_expiry', 'command', {}, 'S2'),
    ('act_ignores_moved_target', 'command', dict(STALE_DETECT='open-only'), 'S2'),
    ('tap_ignores_moved_target', 'command', dict(STALE_DETECT='open-only'), 'S2'),
    ('tap_on_terminal', 'command', {}, 'S2 S5'),
    ('retry_spends_again', 'command', {}, 'I3'),
]

TRACES = [
    ('command-refused-start-blocks-retry', 'retry', dict(NATKEY='blocks'), ('L3',)),
    ('command-refused-act-untold', 'command', dict(REFUSED_TOLD='none'), ('L1',)),
    ('proposal-open-with-moved-target', 'command', dict(STALE_DETECT='open-only'), ('S8',)),
]
