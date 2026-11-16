"""Machine 1: the Overlord's account and model class (§3.4, Table 3.4a, Table 3.4b, Table 3.3.11b, §6.4).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

NRES accounts reserved for the Overlord, then NOTHER other accounts, in listed order (Table 3.4a).
Each account has a load level, the higher of its five-hour and weekly figures:
  0 under the soft line (70)   1 past the soft line   2 past the harder line (85)   3 at the ceiling (a limit)
Each reserved account has a Fable share: room (0) or spent (1), read against the ceiling of 40.
The Overlord is on one account, on Fable (F, the designated class) or Opus (O, the fallback).
ccd's degraded stamp has an age in ticks as ccd's clock reads it (`stamp`) and a true age (`tage`).
One tick is TICK_MIN minutes. A renewal is one step: the pick, the settle and the mint together.

Bounds: T_MAX ticks; every use, spend, ageing, reset, stale reading, crash and clock step has a budget.
"""
from collections import namedtuple

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    NRES=2, NOTHER=0, LOAD0=None, FAB0=None, CLS0='F',
    T_MAX=3, TICK_MIN=30, START_MIN=1, CHAIN_MAX=3,
    USES=2,        # guests (or anyone else) raise an account's load by one level
    OWN_USES=0,    # the Overlord's own turn raises its account's load by one level
    SPENDS=1,      # the Overlord's turn brings its account's Fable share to the ceiling
    AGES=1,        # old Fable use ages out of a window: spent -> room
    DROPS=0,       # a window resets: the load falls to 0
    STALES=0, LSTALES=0, CRASHES=0, SKEWS=0, SKEW_BY=3,
    SOFT_BUDGET=3,     # §3.3.11: at most three soft renewals in six hours (not refilled inside one run)
    LEAST=1,           # §3.3.11: a generation lives 30 minutes before a soft trigger may end it, in ticks
    # ---- switches: readings of the text. The values here are the safe readings ------------------------------
    GUEST_REACH=0,     # the highest load guests' use alone can bring a reserved account to while its reserve has
                       # room. The text's ceiling (98 less what is left) gives 2: `arith.py` measures it. A ceiling
                       # counted from the soft line gives 0
    HOLD_MIN=60,       # the hold-down before ccd restores the designated class. The text: 30 (§3.4, Table 11.5b)
    PICK_ORDER='class',      # 'class': among accounts under the soft line, one that serves the designated class
                             #   first (§3.4 "the next generation runs on the next one")
                             # 'listed': listed order and the soft line only, the class asked at the settle (C56 as worded)
    PICK_ALL_PAST='least',   # every listed account is past the soft line: 'least' loaded that can serve | 'stranded'
    HARD85_TARGET=True,      # the 85% trigger needs another account under the soft line: True | False (the text)
    STAMP_CLAMP=True,        # a degraded stamp later than ccd's clock is written again as now: True | False (the text)
    MUTATION=None,
)

S = namedtuple('S', 't load fab stale lstale acct cls stamp tage due age soft busy strand carried chain flips own '
                    'b_use b_own b_spend b_age b_drop b_stale b_lstale b_crash b_skew')


def n_acc(c):
    return c.NRES + c.NOTHER


def init(c):
    n = n_acc(c)
    return S(t=0, load=tuple(c.LOAD0 or (0,) * n), fab=tuple(c.FAB0 or (0,) * c.NRES), stale=False, lstale=False,
             acct=0, cls=c.CLS0, stamp=None if c.CLS0 == 'F' else 0, tage=None if c.CLS0 == 'F' else 0,
             due=None, age=0, soft=c.SOFT_BUDGET, busy=False, strand=False, carried=False, chain=0, flips=0, own=False,
             b_use=c.USES, b_own=c.OWN_USES, b_spend=c.SPENDS, b_age=c.AGES, b_drop=c.DROPS, b_stale=c.STALES,
             b_lstale=c.LSTALES, b_crash=c.CRASHES, b_skew=c.SKEWS)


LOADW = ('under 70', 'past 70', 'past 85', 'at the limit')


def name(c, x):
    return 'ABCDEF'[x] + ('' if x < c.NRES else '(not reserved)')


def fmt(s):
    acc = []
    for x, l in enumerate(s.load):
        f = ''
        if x < len(s.fab):
            f = ', Fable ' + ('spent' if s.fab[x] else 'has room')
        acc.append('%s: %s%s' % ('ABCDEF'[x], LOADW[l], f))
    st = 'none' if s.stamp is None else '%d ticks old on ccd`s clock, %d in truth' % (s.stamp, s.tage)
    return 't=%d [%s]%s%s | Overlord on %s, %s, generation age %d%s%s%s | degraded stamp: %s | due: %s | soft left %d' % (
        s.t, '; '.join(acc), ' share reading STALE' if s.stale else '', ' limit samples STALE' if s.lstale else '',
        'ABCDEF'[s.acct], 'Fable' if s.cls == 'F' else 'Opus', s.age, ' busy' if s.busy else ' idle',
        ' STRANDED' if s.strand else '', ' (conversation carried from another class)' if s.carried else '',
        st, s.due or 'nothing', s.soft)


# ---------------------------------------------------------------------------------------------------------
# ccd's serviceability answer for the Overlord (H16)

def fable_answer(s, c, x):
    # §3.4: "Fable serves the Overlord only on an account reserved for it"
    if x >= c.NRES:
        return 'servable' if c.MUTATION == 'fable_off_reserve' and s.load[x] < 3 else 'unservable'
    # §3.4: "Unmeasured keeps the current class. A Fable share reading older than eight hours ... changes nothing"
    if s.stale:
        return 'unservable' if c.MUTATION == 'stale_reads_unservable' else 'unmeasured'
    # §3.4: "The test refuses Fable when that part reaches FABLE_SHARE_CEILING_PCT (40)"; and the lane's own limits
    if s.fab[x] or (not s.lstale and s.load[x] >= 3):
        return 'unservable'
    return 'servable'


def opus_answer(s, c, x):
    if s.lstale:
        return 'unmeasured'
    return 'unservable' if s.load[x] >= 3 else 'servable'     # the seven-day ceiling, 98


def hold_passed(s, c):
    # §3.4: "it restores only once the degraded stamp is older than the hold-down, 30 minutes to start, by ccd's
    # own clock". The fresh start falls START_MIN minutes after the tick it was decided in.
    if c.MUTATION == 'no_holddown':
        return True
    return s.stamp * c.TICK_MIN + c.START_MIN > c.HOLD_MIN


def truly_passed(s, c):
    return s.tage is None or s.tage * c.TICK_MIN + c.START_MIN > c.HOLD_MIN


def compose(s, c, x):
    """The settle on account x: the class the start takes, and the stamp after it (H16, `_route_degrade`,
    `_route_restore`)."""
    a = fable_answer(s, c, x)
    if a == 'servable':
        if s.stamp is None or hold_passed(s, c):
            return 'F', None
        return 'O', s.stamp
    if a == 'unmeasured':
        return ('O', s.stamp) if s.stamp is not None else ('F', None)
    return 'O', (s.stamp if s.stamp is not None else 0)


def past_soft(s, c, x):
    # C57: "ccd passes over an account past the soft line"; an unmeasured figure is not "past" it
    return (not s.lstale) and s.load[x] >= 1


def can_any(s, c, x):
    return opus_answer(s, c, x) != 'unservable'


def pick(s, c):
    """C56: "ccd picks from the list in listed order before load, and passes over an account past the soft line"."""
    n = n_acc(c)
    if c.MUTATION == 'pick_ignores_soft':
        under = [x for x in range(n) if can_any(s, c, x)]
    else:
        under = [x for x in range(n) if not past_soft(s, c, x) and can_any(s, c, x)]
    if c.PICK_ORDER == 'class':
        for x in under:
            if compose(s, c, x)[0] == 'F':
                return x
    if under:
        return under[0]
    # every listed account is past the soft line: the text does not say
    if c.PICK_ALL_PAST == 'stranded':
        return None
    cands = sorted((s.load[x], x) for x in range(n) if can_any(s, c, x))
    if not cands:
        return None
    if c.PICK_ORDER == 'class':
        best = cands[0][0]
        for l, x in cands:
            if l == best and compose(s, c, x)[0] == 'F':
                return x
    return cands[0][1]


def trig(s, c):
    """`renewalDue` for the rows of Table 3.3.11b this machine holds."""
    if s.due == 'hard-resumed':
        return 'hard-resumed'
    # "The generation's class is no longer servable on its account | hard | ccd's serviceability answer"
    a = fable_answer(s, c, s.acct) if s.cls == 'F' else opus_answer(s, c, s.acct)
    if a == 'unservable':
        return 'hard-class'
    # "Account load: the account is past the harder line, 85%, and the session is idle (C57) | hard"
    if not s.lstale and s.load[s.acct] >= 2 and not s.busy:
        if not c.HARD85_TARGET or any(x != s.acct and not past_soft(s, c, x) and can_any(s, c, x)
                                      for x in range(n_acc(c))):
            return 'hard-load'
    if s.due == 'soft':
        # §3.3.11: the soft budget, and the least age of a generation
        if c.MUTATION == 'soft_ignores_budget' or (s.age >= c.LEAST and s.soft > 0):
            return 'soft'
    return None


def mint(s, c, x, fresh, why):
    cls2, st2 = compose(s, c, x)
    tage2 = None if st2 is None else (s.tage if s.stamp is not None else 0)
    flipped = cls2 != s.cls
    s2 = s._replace(acct=x, cls=cls2, stamp=st2, tage=tage2, age=0, strand=False, busy=False)
    if fresh:
        s2 = s2._replace(due=None, carried=False, chain=min(s.chain + 1, c.CHAIN_MAX),
                        flips=min(s.flips + 1, 3) if flipped else 0)
    else:
        # C45, Table 3.3.11b: "A start that resumed the conversation on another model class | hard"
        if flipped:
            s2 = s2._replace(carried=True, due=None if c.MUTATION == 'no_resumed_trigger' else 'hard-resumed')
    return s2, flipped


def succ(s, c):
    E = []
    n = n_acc(c)

    def add(label, s2, **info):
        E.append((label, s2, info))

    def env(s2):
        return s2._replace(chain=0)

    # ---- the server's and ccd's own steps ----------------------------------------------------------------
    urgent = False
    tr = trig(s, c)
    if tr and not s.busy:
        urgent = True
        x = pick(s, c)
        if x is None:
            if not s.strand:
                add('renewal lane (%s): ccd finds no account to pick; readiness reads `stranded`' % tr,
                    s._replace(strand=True, due=None, chain=min(s.chain + 1, c.CHAIN_MAX)), actor='server', renew=True, why=tr,
                    stranded=True, flipped=False)
            else:
                urgent = False
        else:
            s2, flipped = mint(s, c, x, True, tr)
            if tr == 'soft':
                s2 = s2._replace(soft=max(0, s.soft - 1))
            add('renewal lane (%s): a fresh start; ccd picks %s and composes %s%s' % (
                tr, name(c, x), 'Fable' if s2.cls == 'F' else 'Opus',
                ', the designated class restored' if flipped and s2.cls == 'F' else
                (', the fallback' if flipped else '')),
                s2, actor='server', renew=True, why=tr, flipped=flipped, stranded=False, frm=s.acct)
    # C57: "If a limit still hits mid-turn, ccd swaps as it does for any session" (the hard-block rescue)
    if s.busy and s.load[s.acct] >= 3:
        urgent = True
        tg = sorted((s.load[x], x) for x in range(n) if x != s.acct and s.load[x] < 3)
        if c.MUTATION == 'rescue_never_retries' and s.strand:
            tg = []
        if not tg:
            add('ccd: the limit hits and no account can take the session (`a swap is blocked`); `stranded`',
                s._replace(strand=True, busy=False), actor='ccd', rescue=True)
        else:
            same = [x for l, x in tg if compose(s, c, x)[0] == s.cls]
            x = same[0] if same else tg[0][1]
            s2, flipped = mint(s, c, x, False, 'rescue')
            add('ccd: the limit hits mid-turn; the hard-block rescue lands on %s on %s, the conversation resumed' % (
                name(c, x), 'Fable' if s2.cls == 'F' else 'Opus'), s2, actor='ccd', rescue=True, flipped=flipped)
    if c.MUTATION == 'affinity_not_stood_down' and not s.busy and not s.strand and s.load[s.acct] >= 2:
        # C57: today's affinity arm leaves an account at a clean turn boundary and carries the conversation
        tg = sorted((s.load[x], x) for x in range(n) if x != s.acct and s.load[x] < 2)
        if tg:
            s2, flipped = mint(s, c, tg[0][1], False, 'affinity')
            add('ccd: the affinity arm moves the session to %s' % name(c, tg[0][1]), s2, actor='ccd', affinity=True)

    # ---- time -------------------------------------------------------------------------------------------
    if not urgent and not s.busy and s.t < c.T_MAX:
        cap = c.HOLD_MIN // c.TICK_MIN + 2
        add('tick (%d minutes)' % c.TICK_MIN,
            s._replace(t=s.t + 1, age=min(s.age + 1, c.LEAST + 1), chain=0,
                       stamp=None if s.stamp is None else min(s.stamp + 1, cap),
                       tage=None if s.tage is None else min(s.tage + 1, cap)), actor='time')

    # ---- the session ------------------------------------------------------------------------------------
    if not s.busy:
        if s.load[s.acct] >= 3:
            add('a turn starts and fails on its account', env(s._replace(busy=True, strand=True)), actor='session')
        elif not (tr and tr != 'soft'):
            add('a turn starts', env(s._replace(busy=True, strand=False)), actor='session')
    if s.busy and s.load[s.acct] < 3:
        add('the turn ends', env(s._replace(busy=False)), actor='session')
        if s.b_own and s.load[s.acct] < 3:
            ld = list(s.load)
            ld[s.acct] += 1
            add('the Overlord`s turn raises the load on %s' % name(c, s.acct),
                env(s._replace(load=tuple(ld), b_own=s.b_own - 1, own=True)), actor='session')
        if s.b_spend and s.cls == 'F' and s.acct < c.NRES and not s.fab[s.acct]:
            fb = list(s.fab)
            fb[s.acct] = 1
            add('the Overlord`s turn brings the Fable share on %s to its ceiling' % name(c, s.acct),
                env(s._replace(fab=tuple(fb), b_spend=s.b_spend - 1)), actor='session')
    if s.b_crash and not s.strand:
        s2, flipped = mint(s, c, s.acct, False, 'crash')
        add('the session crashes and restarts on %s on %s, the conversation resumed' % (
            name(c, s.acct), 'Fable' if s2.cls == 'F' else 'Opus'),
            env(s2._replace(b_crash=s.b_crash - 1)), actor='fault', restart=True, flipped=flipped)

    # ---- the world --------------------------------------------------------------------------------------
    if s.b_use:
        for x in range(n):
            top = 3
            if x < c.NRES and not s.fab[x]:
                top = c.GUEST_REACH             # §3.4: a guest's ceiling keeps what is left of the reserve
            if s.load[x] < top:
                ld = list(s.load)
                ld[x] += 1
                add('guests` use raises the load on %s to "%s"' % (name(c, x), LOADW[ld[x]]),
                    env(s._replace(load=tuple(ld), b_use=s.b_use - 1)), actor='world')
    if s.b_age:
        for x in range(c.NRES):
            if s.fab[x]:
                fb = list(s.fab)
                fb[x] = 0
                add('old Fable use ages out of the window on %s: the share has room again' % name(c, x),
                    env(s._replace(fab=tuple(fb), b_age=s.b_age - 1)), actor='world')
    if s.b_drop:
        for x in range(n):
            if s.load[x]:
                ld = list(s.load)
                ld[x] = 0
                add('the windows of %s reset' % name(c, x), env(s._replace(load=tuple(ld), b_drop=s.b_drop - 1)),
                    actor='world')
    if s.b_stale:
        add('the Fable share reading %s' % ('is fresh again' if s.stale else 'goes stale (older than eight hours)'),
            env(s._replace(stale=not s.stale, b_stale=s.b_stale - 1)), actor='world')
    if s.b_lstale:
        add('the limit samples %s' % ('are fresh again' if s.lstale else 'go stale'),
            env(s._replace(lstale=not s.lstale, b_lstale=s.b_lstale - 1)), actor='world')
    if s.b_skew and s.stamp is not None:
        add('the fleet host`s clock steps back by %d ticks' % c.SKEW_BY,
            env(s._replace(b_skew=s.b_skew - 1, stamp=0 if c.STAMP_CLAMP else s.stamp - c.SKEW_BY,
                           tage=0 if c.STAMP_CLAMP else s.tage)), actor='fault')
    if s.due is None and not s.strand:
        add('a soft trigger comes due (the daily backstop, a new install)', env(s._replace(due='soft')), actor='world')
    return E


# ---------------------------------------------------------------------------------------------------------
# checks

def storm(s, lbl, info, s2, c):
    # §3.3.11: "Hard triggers ignore the budget." Nothing else bounds them, so a hard trigger that its own renewal
    # does not clear renews again at once.
    if info.get('renew') and s2.chain >= c.CHAIN_MAX:
        return '%d renewals in a row with nothing else happening between them (the last for `%s`)' % (
            s2.chain, info['why'])
    return None


def could_serve_f(s, c):
    return [x for x in range(c.NRES) if not s.fab[x] and not s.stale and s.load[x] < 3]


def own(s, lbl, info, s2, c):
    # C46: "No other session may spend the capacity the Overlord needs."
    if not info.get('renew') or s.own or c.OWN_USES:
        return None
    room = could_serve_f(s, c)
    if not room or not truly_passed(s, c):
        return None
    if info.get('stranded'):
        return None
    if s2.cls != 'F':
        return 'the renewal composes Opus on %s though the Fable share on %s has room, and the Overlord used none of it' % (
            name(c, s2.acct), ', '.join(name(c, x) for x in room))
    if info['why'] == 'hard-load' and not s.fab[s.acct]:
        return 'guests` use alone moved the Overlord off %s, whose reserve has room (the 85%% line)' % name(c, s.acct)
    return None


def strand_ok(s, lbl, info, s2, c):
    # Table 6.4a: `stranded` is "No account can serve it"
    if info.get('stranded') and any(s.load[x] < 3 for x in range(n_acc(c))):
        return 'readiness reads `stranded` while %s can still serve it' % ', '.join(
            name(c, x) for x in range(n_acc(c)) if s.load[x] < 3)
    return None


def flip(s, lbl, info, s2, c):
    # §3.4: "A reading that hovers at the cap therefore does not flip the model at every renewal."
    # The earliest soft renewal a fallback generation can meet is the one at its least age (§3.3.11).
    if (info.get('renew') and info['why'] == 'soft' and s.cls == 'O' and s2.cls == 'F' and s.age == c.LEAST
            and s.stamp == s.age and s.stamp == s.tage):
        return ('the earliest soft renewal after the fallback restores the class: the hold-down of %d minutes '
                'is no longer than a generation`s least age' % c.HOLD_MIN)
    return None


def stale_dir(s, lbl, info, s2, c):
    # §3.4: "Unmeasured keeps the current class."
    if (info.get('renew') or info.get('restart')) and s.stale and info.get('flipped') and s2.acct == s.acct:
        return 'the class changed on a stale share reading'
    return None


def c45(s, c):
    # C45: "no conversation is carried from one model or provider to another for longer than it takes that renewal
    # to land"
    if s.carried and s.due != 'hard-resumed':
        return 'a conversation carried from another model class goes on with no renewal due'
    return None


def res(s, c):
    if s.cls == 'F' and s.acct >= c.NRES:
        return 'the Overlord runs Fable on an account that is not reserved for it'
    return None


def move(s, lbl, info, s2, c):
    # C57: "Between renewals only the hard-block rescue moves the Overlord"
    if s2.acct != s.acct and not info.get('renew') and not info.get('rescue'):
        return 'the Overlord changed account by a step that is neither a renewal nor the hard-block rescue'
    return None


def softline(s, lbl, info, s2, c):
    # C57: "At each renewal, ccd passes over an account past the soft line"
    if info.get('renew') and not info.get('stranded') and past_soft(s, c, s2.acct):
        if any(not past_soft(s, c, x) and can_any(s, c, x) for x in range(n_acc(c))):
            return 'the renewal landed on %s, past the soft line, though another listed account is under it' % name(
                c, s2.acct)
    return None


def bud(s, lbl, info, s2, c):
    if info.get('renew') and info['why'] == 'soft' and (s.soft <= 0 or s.age < c.LEAST):
        return 'a soft renewal ran outside the soft budget or before the generation`s least age'
    return None


def hd1(s, lbl, info, s2, c):
    # Table 11.5b: "30 minutes | The hold-down before ccd restores the designated class"
    if not (info.get('renew') or info.get('restart')) or s.stamp is None or info.get('stranded'):
        return None
    restored = s2.cls == 'F' and s.cls == 'O'
    if restored and not truly_passed(s, c):
        return 'the designated class came back before the hold-down had run'
    if (not restored and s2.cls == 'O' and truly_passed(s, c) and fable_answer(s, c, s2.acct) == 'servable'
            and not hold_passed(s, c)):
        return 'the hold-down held for longer than its %d minutes: the stamp reads %d ticks old, and is %d' % (
            c.HOLD_MIN, s.stamp, s.tage)
    return None


STATE_CHECKS = [('C45', c45), ('RES', res)]
EDGE_CHECKS = [('STORM', storm), ('OWN', own), ('STRAND', strand_ok), ('FLIP', flip), ('STALE', stale_dir),
               ('MOVE', move), ('SOFT', softline), ('BUD', bud), ('HD', hd1)]


def _auto(lbl):
    return (lbl.startswith('renewal lane') or lbl.startswith('ccd') or lbl.startswith('tick')
            or lbl.startswith('a turn') or lbl.startswith('the turn ends') or lbl.startswith('a soft trigger'))


LIVE_CHECKS = [
    # no interval where no account serves it though one could: a stranded Overlord gets out by itself
    ('NOSERVE', lambda s, c: s.strand and any(s.load[x] < 3 for x in range(n_acc(c))) and s.t < c.T_MAX,
     lambda s, c: not s.strand, _auto),
    # §3.4 "It goes home": once a reserved account can serve the designated class under the soft line, and the
    # hold-down has run, the server and ccd alone bring the Overlord back to it
    ('RETURN', lambda s, c: (s.cls == 'O' and not s.strand and s.soft > 0 and s.t + 2 <= c.T_MAX and not s.lstale
                             and truly_passed(s, c) and (s.stamp is None or hold_passed(s, c))
                             and any(not s.fab[x] and not s.stale and s.load[x] < 1 for x in range(c.NRES))),
     lambda s, c: s.cls == 'F', _auto),
]

FACTS = [
    ('the Overlord runs the fallback class', lambda s, c: s.cls == 'O'),
    ('readiness reads `stranded`', lambda s, c: s.strand),
    ('the designated class is restored after a fallback', lambda s, c: s.cls == 'F' and s.flips >= 2),
]

SCEN = {
    # guests fill the reserved accounts; the Overlord itself uses nothing
    'guests': dict(NOTHER=1, USES=3, OWN_USES=0, SPENDS=0, AGES=0, T_MAX=2),
    # every account fills, by anyone's use: the Overlord's own included
    'load': dict(NOTHER=0, USES=0, OWN_USES=5, SPENDS=0, AGES=0, DROPS=1, T_MAX=2),
    # both shares reach the ceiling, and old use ages out
    'hover': dict(NOTHER=0, USES=0, SPENDS=2, AGES=2, T_MAX=5, FAB0=(0, 1)),
    'return': dict(NOTHER=0, USES=1, SPENDS=1, AGES=1, T_MAX=4, FAB0=(0, 0)),
    # its own use takes its account to the limit in the middle of a turn
    'rescue': dict(NOTHER=1, USES=2, OWN_USES=3, SPENDS=1, AGES=0, DROPS=1, CRASHES=1, T_MAX=3),
    'stale': dict(NOTHER=0, USES=1, OWN_USES=1, SPENDS=1, AGES=1, STALES=2, LSTALES=2, CRASHES=1, T_MAX=3),
    'skew': dict(NOTHER=0, USES=0, SPENDS=0, AGES=0, SKEWS=1, T_MAX=5, CLS0='O', FAB0=(0, 1)),
    # its account reaches the limit while the limit samples are stale, and the other account is full
    'blocked': dict(NOTHER=0, USES=0, OWN_USES=1, SPENDS=0, AGES=0, DROPS=1, LSTALES=1, T_MAX=2, LOAD0=(2, 3)),
}

READINGS = [
    # (switch, value, scenario, the checks it is expected to break)
    ('GUEST_REACH', 2, 'guests', 'OWN'),
    ('GUEST_REACH', 1, 'guests', 'OWN'),
    ('HARD85_TARGET', False, 'load', 'STORM'),
    (('HARD85_TARGET', 'PICK_ALL_PAST'), (False, 'stranded'), 'load', 'STRAND'),
    ('PICK_ALL_PAST', 'stranded', 'load', 'STRAND'),
    ('PICK_ORDER', 'listed', 'return', 'OWN RETURN'),
    ('HOLD_MIN', 30, 'hover', 'FLIP'),
    ('STAMP_CLAMP', False, 'skew', 'HD OWN'),
]

MUTATIONS = [
    ('no_holddown', 'hover', {}, 'HD'),
    ('stale_reads_unservable', 'stale', {}, 'STALE'),
    ('no_resumed_trigger', 'rescue', {}, 'C45'),
    ('affinity_not_stood_down', 'rescue', {}, 'MOVE'),
    ('pick_ignores_soft', 'rescue', {}, 'SOFT'),
    ('fable_off_reserve', 'rescue', {}, 'RES'),
    ('soft_ignores_budget', 'hover', {}, 'BUD'),
    ('rescue_never_retries', 'blocked', {}, 'NOSERVE'),
]

TRACES = [
    ('swap-renewal-storm', 'load', dict(HARD85_TARGET=False), ('STORM',)),
    ('swap-stranded-with-room', 'load', dict(PICK_ALL_PAST='stranded'), ('STRAND',)),
    ('swap-guests-move-the-overlord', 'guests', dict(GUEST_REACH=2), ('OWN',)),
    ('swap-guests-push-it-to-opus', 'guests', dict(GUEST_REACH=1), ('OWN',)),
    ('swap-hover-flips', 'hover', dict(HOLD_MIN=30), ('FLIP',)),
    ('swap-listed-pick-skips-the-next-account', 'return', dict(PICK_ORDER='listed'), ('OWN', 'RETURN')),
    ('swap-clock-step-holds-the-fallback', 'skew', dict(STAMP_CLAMP=False), ('HD',)),
]
