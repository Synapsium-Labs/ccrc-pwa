"""Machine 1: authority. Grants, the ladder, staging, the veto clock and the staged commit.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it. Section numbers in comments are that file's.

One grant (effect approve-dod, O3, one programme), one item of class O3 whose effect that
grant covers, one staged act. Time moves in ticks. The server's lanes (expiry, the veto
commit, the eight-hour fallback, retention) are urgent: the clock does not move while one is
due and the server is up, but door calls and taps can still fall before them.

Bounds (see DEFAULT): T_MAX ticks; a grant lives EXP ticks; the veto window is VETO_OBS
observed ticks; "eight hours" is UNSEEN_W ticks; each fault and tap has a budget.
"""
from collections import namedtuple

RUNGS = ('off', 'chat', 'advise', 'full')
RANK = {r: i for i, r in enumerate(RUNGS)}
LATCH_CAP = {'ceiling': 'advise', 'probes': 'chat'}     # Table 7.5a: an act ceiling hit; probes failed twice

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    T_MAX=4, EXP=3, VETO_OBS=2, UNSEEN_W=3,
    G0='none',            # the grant's first state: none | shadow | live
    Q0='none',            # the item's first state: none | held
    CREATES=1, LIVE_TAPS=1, REVOKES=1, RENEWS=1, OVERTURNS=1,
    CONDS=1,              # "a generation is off the model the grant names" comes and goes (Table 7.2a)
    CRASHES=1, SKEWS=0, RENEWALS=0, REBINDS=0,
    LATCHES=(),           # ladder latch causes that may fire, each once
    CLEARS=0, OP_LOWERS=0, OP_RAISES=0, DEGRADES=0, DISARMS=0, ARMS=0,
    BC_ARMS=0,            # the operator arms the blind check (§7.2)
    CONSOLE=True, VETO=True, ANSWER_NOW=True,
    OLD_CALLER=False,     # a door process of an ended generation calls (the fence, §3.3.11)
    # ---- switches: readings of the text -------------------------------------------------
    COND_SUSPEND='computed',     # 'computed' (read at each call, as the ladder is) | 'stored-nokind'
    SHADOW_LATCH='stays-shadow',  # a latch on a shadow grant: 'stays-shadow' | 'suspended'
    LATCH_STORE='rows',          # the ladder's latches: 'rows' | 'single-min' | 'single-overwrite'
    COMMIT_FENCE='term+gen',     # the fence at the staged commit: 'term+gen' | 'term'
    EXPIRY_GATE='expiresAt',     # what a door reads: 'expiresAt' against now | 'state' only
    COMMIT_BLIND='row',          # the blind check at the commit: 'row' (needs a recorded yes) | 'skip'
    UNSEEN='not-run-out',        # "eight hours unseen": 'not-run-out' | 'never-shown'
    VOID_WHEN='eager-latch',     # a latch, revoke or expiry voids a staged act: 'eager-latch' | 'lazy'
    VOID_NOTIFY='push',          # a voided act: 'push' (the row pushes again) | 'none' (the text)
    MUTATION=None,
)

# act: st none|staged|effective|vetoed|voided|preempted; obs observed ticks; gobs the ghost count
Act = namedtuple('Act', 'st obs gobs seen at term gen blind why')
NOACT = Act('none', 0, 0, False, 0, 0, 0, None, None)

S = namedtuple('S', 't skw last up wit '
                    'gst gexp gcond ghl ghsh '
                    'orung lat deg armed '
                    'term gen bc q a con told '
                    'b_create b_live b_rev b_renew b_ovt b_cond b_crash b_skew b_ren b_reb '
                    'b_lat b_clear b_low b_raise b_deg b_dis b_arm b_bc b_old')


def init(c):
    live = c.G0 == 'live'
    return S(t=0, skw=0, last=0, up=True, wit=True,
             gst=c.G0, gexp=(c.EXP if c.G0 != 'none' else -1), gcond=False, ghl=False, ghsh=live,
             orung='full', lat=(), deg=False, armed=True,
             term=1, gen=1, bc=False, q=c.Q0, a=NOACT, con=False,
             told=None,
             b_create=c.CREATES, b_live=c.LIVE_TAPS, b_rev=c.REVOKES, b_renew=c.RENEWS, b_ovt=c.OVERTURNS,
             b_cond=c.CONDS, b_crash=c.CRASHES, b_skew=c.SKEWS, b_ren=c.RENEWALS, b_reb=c.REBINDS,
             b_lat=tuple(c.LATCHES), b_clear=c.CLEARS, b_low=c.OP_LOWERS, b_raise=c.OP_RAISES,
             b_deg=c.DEGRADES, b_dis=c.DISARMS, b_arm=c.ARMS, b_bc=c.BC_ARMS, b_old=1 if c.OLD_CALLER else 0)


def fmt(s):
    a = s.a
    act = '' if a.st == 'none' else ' act=%s%s(obs %d, %s, staged at %d, term %d gen %d, blind=%s)' % (
        a.st, ':' + a.why if a.why else '', a.obs, 'seen' if a.seen else 'unseen', a.at, a.term, a.gen, a.blind)
    return ('t=%d%s %s | grant=%s%s%s%s expires@%s | rung=%s latches=%s%s%s %s | term %d gen %d%s | '
            'item=%s%s%s%s' % (
                s.t, ' (clock reads %d)' % (s.t - s.skw) if s.skw else '', 'up' if s.up else 'DOWN',
                s.gst, ' [a latch stands]' if s.ghl else '', ' [condition]' if s.gcond else '',
                '' if s.wit else ' [no witness yet]', s.gexp,
                s.orung, list(s.lat), ' degraded' if s.deg else '', '' if s.armed else ' kind-in-shadow',
                'effective=%s' % eff_rung_raw(s), s.term, s.gen, ' blind-check-armed' if s.bc else '',
                s.q, act, ' console-shows-it' if s.con else '',
                '' if s.told is None else ' last-push="%s"' % (
                    'the Overlord will answer' if s.told == 'will' else 'yours to answer')))


# --------------------------------------------------------------------------------------
# Readers
# --------------------------------------------------------------------------------------

def now(s, c):
    """§11.5: "A clock that reads earlier than the last stored time is treated as that time."""
    rd = s.t - s.skw
    if c.MUTATION == 'skew_unguarded':
        return rd
    return max(rd, s.last)


def eff_rung_raw(s):
    r = RANK[s.orung]
    for cause in s.lat:
        r = min(r, RANK[LATCH_CAP[cause]])
    if s.deg:
        r = min(r, RANK['chat'])        # Table 7.5a: a generation `degraded`, cap chat
    if not s.wit:
        r = min(r, RANK['advise'])      # Table 7.5a: no witness since boot, cap advise
    return RUNGS[r]


def grant_ok(s, c):
    """What a door reads as "a live grant in scope" (§7.1, §7.2)."""
    if s.gst != 'live':
        return False
    if c.COND_SUSPEND == 'computed':
        # Table 7.2a conditions, read at each call: the model condition, and no witness since boot
        if s.gcond or not s.wit:
            return False
    if c.EXPIRY_GATE == 'expiresAt' and now(s, c) >= s.gexp:
        return False
    return True


def grant_truth(s, c):
    """The grant as the text means it, whatever the switches: live, no latch, no condition, not expired."""
    rd = max(s.t - s.skw, s.last)
    return s.gst == 'live' and not s.ghl and not s.gcond and s.wit and rd < s.gexp


def may_hold(s, c):
    # §6.7 H18, cut to the parts this machine has: the rung at full, the kind armed, a live grant
    return s.up and eff_rung_raw(s) == 'full' and s.armed and grant_ok(s, c)


def width(s, c):
    return (RANK[eff_rung_raw(s)], 1 if grant_ok(s, c) else 0, 1 if s.armed else 0)


# --------------------------------------------------------------------------------------
# Helpers that write
# --------------------------------------------------------------------------------------

def void(s, c, why):
    """Table 10.1b: `staged` leaves to `voided` on a change of authority or eight hours unseen.
    §7.2: "the answer falls back to an ordinary item for the operator"."""
    told = 'yours' if c.VOID_NOTIFY == 'push' else s.told
    return s._replace(a=s.a._replace(st='voided', why=why), q='reached', told=told, con=False)


def eager(s, c):
    """A latch, a revocation, an expiry, a lower rung or a raised term: under 'eager-latch' the
    staged act is voided in the same transaction. A condition never voids eagerly."""
    if c.VOID_WHEN != 'eager-latch' or s.a.st != 'staged':
        return s
    gone = (s.gst in ('revoked', 'expired', 'suspended') or RANK[s.orung] < RANK['full'] or s.lat
            or not s.armed or s.a.term != s.term
            or (c.COMMIT_FENCE == 'term+gen' and s.a.gen != s.gen))
    if not gone:
        return s
    renewal = (s.a.term == s.term and s.a.gen != s.gen and s.gst == 'live' and not s.lat and s.armed
               and RANK[s.orung] == RANK['full'])
    return void(s, c, 'renewal' if renewal else 'authority')


def latch_grant(s, c):
    """Table 7.2a: an overturn, a rebind, a retire or a detected restore latches the grant."""
    if c.MUTATION == 'rebind_no_latch':
        return s._replace(ghl=s.ghl or s.gst in ('live', 'suspended'))
    if s.gst == 'live' or s.gst == 'suspended':
        return s._replace(gst='suspended', ghl=True)
    if s.gst == 'shadow' and c.SHADOW_LATCH == 'suspended':
        return s._replace(gst='suspended', ghl=True)
    return s


def add_latch(s, c, cause):
    if c.LATCH_STORE == 'rows':
        return s._replace(lat=tuple(sorted(set(s.lat) | {cause})))
    if c.LATCH_STORE == 'single-overwrite' or not s.lat:
        return s._replace(lat=(cause,))
    old = s.lat[0]
    keep = cause if RANK[LATCH_CAP[cause]] < RANK[LATCH_CAP[old]] else old
    return s._replace(lat=(keep,))


def cond_start(s, c):
    s = s._replace(gcond=True)
    if c.COND_SUSPEND == 'stored-nokind' and s.gst == 'live':
        s = s._replace(gst='suspended')
    return s


def cond_end(s, c):
    s = s._replace(gcond=False)
    # 'stored-nokind': one `state` column and no kind (C26's column list has none), so the lane
    # that lifts a condition returns every suspended grant to live once no condition stands
    if c.COND_SUSPEND == 'stored-nokind' and s.gst == 'suspended' and s.wit:
        s = s._replace(gst='live')
    return s


# --------------------------------------------------------------------------------------
# Successors
# --------------------------------------------------------------------------------------

def urgent(s, c):
    """Server lanes that run within one sweep: yields (label, state)."""
    if not s.up:
        return
    n = now(s, c)
    # §7.2: "Every grant expires after 30 days." The server writes the narrowing move.
    if s.gst in ('shadow', 'live', 'suspended') and n >= s.gexp and c.MUTATION != 'expiry_never':
        yield 'expiry lane: the grant becomes `expired`', eager(s._replace(gst='expired', ghl=False), c)
    a = s.a
    if a.st == 'staged':
        # §7.2 "After eight hours unseen, the answer falls back to an ordinary item"
        if n - a.at >= c.UNSEEN_W and c.MUTATION != 'eight_hours_never':
            if c.UNSEEN == 'not-run-out' or not a.seen:
                yield 'fallback lane: eight hours unseen, the act is `voided`', void(s, c, 'unseen')
        # §7.2 "The commit re-checks": overlordMayAct, the fence, the rung and the row's state
        if a.obs >= c.VETO_OBS:
            m = c.MUTATION
            ok = True
            if m != 'commit_skips_grant' and not grant_ok(s, c):
                ok = False
            if c.COMMIT_BLIND == 'row' and s.bc and a.blind != 'yes':
                ok = False
            if m != 'commit_skips_fence':
                if a.term != s.term or (c.COMMIT_FENCE == 'term+gen' and a.gen != s.gen):
                    ok = False
            if m != 'commit_skips_rung' and not (eff_rung_raw(s) == 'full' and s.armed):
                ok = False
            if s.q != 'staged':
                ok = False
            if ok:
                yield 'veto clock ran out: the commit re-checks pass, the act is `effective`', \
                    s._replace(a=a._replace(st='effective'), q='ans_ov', con=False)
            else:
                only_gen = (grant_ok(s, c) and a.term == s.term and a.gen != s.gen
                            and eff_rung_raw(s) == 'full' and s.armed)
                yield 'veto clock ran out: a commit re-check fails, the act is `voided`', \
                    void(s, c, 'renewal' if only_gen else 'recheck')
    # Table 6.7c: a hold whose grant ended, or whose rung left full, is released
    if s.q == 'held' and not may_hold(s, c) and c.MUTATION != 'hold_kept_without_grant':
        yield 'retention: the hold is released to the operator', s._replace(q='reached', told='yours')


def succ(s, c):
    E = []

    def add(label, s2, actor, cond_end_=False):
        E.append((label, s2, dict(actor=actor, cond_end=cond_end_)))

    urg = list(urgent(s, c))
    for lbl, s2 in urg:
        add(lbl, s2, 'server')

    # ---- time ---------------------------------------------------------------------------
    if s.t < c.T_MAX and not urg:
        a = s.a
        if a.st == 'staged':
            watched = s.up and s.con
            if watched or (c.MUTATION == 'veto_counts_unobserved'):
                a = a._replace(obs=a.obs + 1)
            if watched:
                a = a._replace(gobs=a.gobs + 1)
        s2 = s._replace(t=s.t + 1, a=a)
        if s2.up:
            s2 = s2._replace(last=max(s2.last, s2.t - s2.skw))
        add('tick', s2, 'time')
    if s.b_skew and s.skw == 0 and s.t >= 1:
        add('CLOCK SKEW: the wall clock reads one tick earlier', s._replace(skw=1, b_skew=s.b_skew - 1), 'env')

    # ---- server faults ------------------------------------------------------------------
    if s.up and s.b_crash:
        # §7.6: after each boot grants read as suspended until a witness off the volume answers
        s2 = s._replace(up=False, wit=False, b_crash=s.b_crash - 1)
        if c.COND_SUSPEND == 'stored-nokind' and s2.gst == 'live':
            s2 = s2._replace(gst='suspended')
        add('SERVER CRASH', s2, 'env')
    if not s.up:
        add('server boots', s._replace(up=True, last=max(s.last, s.t - s.skw)), 'server')
        return E
    if not s.wit:
        s2 = s._replace(wit=True)
        if c.COND_SUSPEND == 'stored-nokind' and s2.gst == 'suspended' and not s2.gcond:
            s2 = s2._replace(gst='live')
        add('a witness off the volume answers', s2, 'env', True)

    # ---- the operator's grant doors (§7.2, each behind the step-up) ----------------------
    if s.gst == 'none' and s.b_create:
        add('operator: creates the grant (it starts in shadow)',
            s._replace(gst='shadow', gexp=now(s, c) + c.EXP, ghl=False, ghsh=False, b_create=s.b_create - 1),
            'operator-stepup')
    if s.b_live:
        if s.gst == 'shadow':
            add('operator: taps the shadow report, the grant goes live',
                s._replace(gst='live', ghsh=True, b_live=s.b_live - 1), 'operator-stepup')
        elif s.gst == 'suspended' and (s.ghl or c.COND_SUSPEND == 'stored-nokind'):
            add('operator: returns the grant from its latched suspension',
                s._replace(gst='live', ghl=False, b_live=s.b_live - 1), 'operator-stepup')
        elif s.gst == 'revoked' and c.MUTATION == 'live_tap_revives_revoked':
            add('operator: a stale tap on the live door', s._replace(gst='live', b_live=s.b_live - 1),
                'operator-stepup')
    if s.gst in ('shadow', 'live', 'suspended') and s.b_rev:
        add('operator: revokes the grant', eager(s._replace(gst='revoked', ghl=False, b_rev=s.b_rev - 1), c),
            'operator')
    if s.b_renew:
        if s.gst == 'live':
            add('operator: renews the grant after the blind spot-checks',
                s._replace(gexp=now(s, c) + c.EXP, b_renew=s.b_renew - 1), 'operator-stepup')
        elif s.gst == 'expired':
            # §7.2: "Renewing it later starts it again in `shadow`."
            add('operator: renews the expired grant (it starts again in shadow)',
                s._replace(gst='shadow', gexp=now(s, c) + c.EXP, ghsh=False, ghl=False, b_renew=s.b_renew - 1),
                'operator-stepup')

    # ---- what suspends a grant (Table 7.2a) -----------------------------------------------
    if s.b_ovt and s.gst == 'live':
        add('server: an act under the grant is overturned, the grant is latched',
            eager(latch_grant(s._replace(b_ovt=s.b_ovt - 1), c), c), 'server')
    if s.b_cond and not s.gcond:
        add('condition: the generation is off the model the grant names', cond_start(s, c), 'env')
    if s.gcond:
        add('condition ends: the generation is back on the model', cond_end(s._replace(b_cond=s.b_cond - 1), c),
            'env', True)

    # ---- the ladder (§7.5) ----------------------------------------------------------------
    for cause in s.b_lat:
        rest = tuple(x for x in s.b_lat if x != cause)
        add('server: latch `%s` (cap %s)' % (cause, LATCH_CAP[cause]),
            eager(add_latch(s._replace(b_lat=rest), c, cause), c), 'server')
    if s.b_clear and s.lat:
        for cause in s.lat:
            keep = tuple(x for x in s.lat if x != cause) if c.LATCH_STORE == 'rows' else ()
            add('operator: clears the latch `%s`' % cause, s._replace(lat=keep, b_clear=s.b_clear - 1),
                'operator-stepup')
    if c.MUTATION == 'server_clears_latch' and s.lat:
        add('server: clears a latch by itself', s._replace(lat=()), 'server')
    if s.b_low and s.orung == 'full':
        add('operator: lowers the rung to advise', eager(s._replace(orung='advise', b_low=s.b_low - 1), c),
            'operator')
    if s.b_raise and s.orung != 'full':
        add('operator: steps the rung up to full', s._replace(orung='full', b_raise=s.b_raise - 1),
            'operator-stepup')
    if c.MUTATION == 'overlord_raises_rung' and s.orung != 'full':
        add('the Overlord: raises its own rung', s._replace(orung='full'), 'overlord')
    if s.b_deg and not s.deg:
        add('condition: the generation is `degraded`', s._replace(deg=True), 'env')
    if s.deg:
        add('condition ends: the generation leaves `degraded`', s._replace(deg=False, b_deg=s.b_deg - 1),
            'env', True)
    if s.b_dis and s.armed:
        add('server: a missed drill returns answers to shadow',
            eager(s._replace(armed=False, b_dis=s.b_dis - 1), c), 'server')
    if s.b_arm and not s.armed:
        add('operator: arms the kind of answer', s._replace(armed=True, b_arm=s.b_arm - 1), 'operator-stepup')
    if s.b_bc and not s.bc:
        add('operator: arms the blind check', s._replace(bc=True, b_bc=s.b_bc - 1), 'operator')

    # ---- the body (§3.1, §3.3.11) ----------------------------------------------------------
    if s.b_ren:
        add('renewal: generation %d starts' % (s.gen + 1),
            eager(s._replace(gen=s.gen + 1, b_ren=s.b_ren - 1), c), 'env')
    if s.b_reb:
        # §3.1: the rebind transaction raises the term and latches every grant
        add('operator: rebinds the Overlord (the term rises, every grant is latched)',
            eager(latch_grant(s._replace(term=s.term + 1, gen=s.gen + 1, b_reb=s.b_reb - 1), c), c), 'operator')

    # ---- the Overlord's answer door --------------------------------------------------------
    if s.q == 'held' and s.a.st == 'none':
        if s.t + c.UNSEEN_W + c.SKEWS <= c.T_MAX:     # a model bound: the fallback fits before T_MAX
            passes = eff_rung_raw(s) == 'full' and s.armed and grant_ok(s, c)     # §11.2 steps 10 and 11
            if passes:
                def stage(blind):
                    return s._replace(q='staged', told='will',      # §7.2 "Staging settles the hold"
                                      a=Act('staged', 0, 0, False, now(s, c), s.term, s.gen, blind, None))
                if s.bc:
                    add('Overlord: answers; the blind check says a clear yes; staged', stage('yes'), 'overlord')
                    add('Overlord: answers; the blind check is short of a clear yes: `defer`',
                        s._replace(q='reached', told='yours'), 'overlord')
                else:
                    add('Overlord: answers; staged for the veto window (blind check unarmed)', stage('notrun'),
                        'overlord')
        add('Overlord: escalates the item', s._replace(q='reached', told='yours'), 'overlord')
    if s.b_old and s.q == 'held' and s.a.st == 'none' and s.gen > 1 and c.MUTATION == 'no_fence':
        add('an ended generation`s door process answers; accepted',
            s._replace(q='staged', told='will', b_old=0,
                       a=Act('staged', 0, 0, False, now(s, c), s.term, s.gen - 1, 'notrun', None)), 'overlord')

    # ---- the operator at the staged row (§7.2) ---------------------------------------------
    if c.CONSOLE:
        if not s.con and s.a.st == 'staged':
            add('operator: a console shows the staged row', s._replace(con=True, a=s.a._replace(seen=True)),
                'operator')
        if s.con:
            add('operator: the console stops showing it', s._replace(con=False), 'operator')
        if s.q == 'reached' and s.told == 'will':
            add('operator: opens Waiting on you and sees the item is theirs', s._replace(told='yours'), 'operator')
    if s.a.st == 'staged':
        if c.VETO:
            add('operator: Veto', s._replace(a=s.a._replace(st='vetoed'), q='reached', told='yours', con=False),
                'operator')
        if c.ANSWER_NOW:
            add('operator: Answer now (the act exits `preempted`)',
                s._replace(a=s.a._replace(st='preempted'), q='ans_op', con=False), 'operator')
    if s.q == 'reached':
        add('operator: answers the item', s._replace(q='ans_op'), 'operator')
    return E


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def a1(s, lbl, info, s2, c):
    # §7 intro: "Widening authority is always the operator's act." §7.5 "Only the operator steps up."
    # A condition that measurably ends may lift what it capped.
    if info['actor'] == 'operator-stepup' or info['cond_end']:
        return None
    w, w2 = width(s, c), width(s2, c)
    names = ('the effective rung', 'the grant', 'the armed kind')
    for k in range(3):
        if w2[k] > w[k]:
            return '%s widened on "%s", which is no operator step-up and no condition ending' % (names[k], lbl)
    return None


def a2(s, lbl, info, s2, c):
    # §7.2 "The commit re-checks"; I4: an act of a class commits with a live grant in scope.
    if s.a.st == 'staged' and s2.a.st == 'effective':
        if not grant_truth(s, c):
            return 'a staged act became effective under a grant that is not live (%s%s%s%s%s)' % (
                s.gst, ', latched' if s.ghl else '', ', under a condition' if s.gcond else '',
                '' if s.wit else ', no witness since boot',
                ', past its expiry' if max(s.t - s.skw, s.last) >= s.gexp else '')
        if not (eff_rung_raw(s) == 'full' and s.armed):
            return 'a staged act became effective below the rung it needs (rung %s, kind %s)' % (
                eff_rung_raw(s), 'armed' if s.armed else 'in shadow')
        if s.a.term != s.term:
            return 'a staged act became effective under an older term (%d, now %d)' % (s.a.term, s.term)
    if s.q == 'held' and s2.q == 'staged' and not grant_truth(s, c):
        return 'the answer door staged an act under a grant that is not live (%s%s%s)' % (
            s.gst, ', latched' if s.ghl else '', ', past its expiry' if max(s.t - s.skw, s.last) >= s.gexp else '')
    return None


def a2b(s, lbl, info, s2, c):
    # §7.2 "When it is armed, the decision model's grant.inside row runs after the code checks pass.
    # Anything short of a clear yes answers `defer`." The commit "runs overlordMayAct ... again".
    if s.a.st == 'staged' and s2.a.st == 'effective' and s.bc and s.a.blind != 'yes':
        return 'a staged act became effective with the blind check armed and no clear yes on record'
    return None


def a3(s, c):
    # Table 7.2a: a latch is lifted by "the operator only".
    if s.ghl and grant_ok(s, c):
        return 'a latched grant reads as live, and no operator tap returned it'
    return None


def a4(s, c):
    # §7.2 H26: "It leaves shadow only on the operator's tap on its shadow report".
    if s.gst == 'live' and not s.ghsh:
        return 'the grant is live and its shadow report was never tapped'
    return None


def a7(s, c):
    # §7.2: "The veto clock counts observed time only ... The window is ten minutes of that time."
    if s.a.st == 'effective' and s.a.gobs < c.VETO_OBS:
        return 'an act became effective after %d observed ticks; the window is %d' % (s.a.gobs, c.VETO_OBS)
    return None


def a9(s, lbl, info, s2, c):
    # §7.2 "Every grant expires after 30 days": the lane writes `expired` within its sweep.
    if lbl == 'tick' and s.up and s.gst in ('shadow', 'live', 'suspended') and now(s, c) >= s.gexp:
        return 'time passed with the grant still `%s` at its expiry (%d, now %d)' % (s.gst, s.gexp, now(s, c))
    return None


def a10(s, lbl, info, s2, c):
    if s.gst == 'revoked' and s2.gst != 'revoked':
        return 'a revoked grant left `revoked` (to `%s`)' % s2.gst
    return None


def a11(s, lbl, info, s2, c):
    # Table 6.7c: "its grant is revoked, suspended or expires: that row released"
    if lbl == 'tick' and s.up and s.q == 'held' and not may_hold(s, c):
        return 'time passed with a hold standing that `mayHold` refuses'
    return None


def i5lit(s, lbl, info, s2, c):
    # I5 "A write is accepted only from the current term, generation and act key", read on the commit.
    if s.a.st == 'staged' and s2.a.st == 'effective' and s.a.gen != s.gen:
        return 'the commit made effective an act that generation %d staged; the current one is %d' % (
            s.a.gen, s.gen)
    if s.q == 'held' and s2.q == 'staged' and s2.a.gen != s.gen:
        return 'the answer door accepted a write from generation %d; the current one is %d' % (s2.a.gen, s.gen)
    return None


def v2(s, c):
    # Table 10.1b: `voided` on "a change of authority". A staged row tells the operator "The Overlord
    # will answer B": that must not stand once a latch, a revocation or an expiry has ended the authority.
    a = s.a
    if a.st != 'staged' or not s.up:
        return None
    if s.gst in ('revoked', 'expired'):
        return 'an act is still staged though its grant is `%s`' % s.gst
    if s.gst == 'suspended' and s.ghl:
        return 'an act is still staged though its grant is latched suspended'
    if a.term != s.term:
        return 'an act is still staged though the term rose'
    return None


STATE_CHECKS = [('A3', a3), ('A4', a4), ('A7', a7), ('V2', v2)]
EDGE_CHECKS = [('A1', a1), ('A2', a2), ('A2b', a2b), ('A9', a9), ('A10', a10), ('A11', a11), ('I5', i5lit)]


def _server_only(lbl):
    return lbl == 'tick' or lbl.startswith(('expiry lane', 'fallback lane', 'veto clock', 'retention',
                                            'server boots'))


LIVE_CHECKS = [
    # A staged act must have an exit the operator need not provide (§7.2: eight hours unseen).
    ('L1', lambda s, c: s.a.st == 'staged' and s.up, lambda s, c: s.a.st != 'staged', _server_only),
    # A row whose only push said "the Overlord will answer" must not become the operator's in silence.
    ('V1', lambda s, c: s.q == 'reached' and s.told == 'will' and s.up,
     lambda s, c: not (s.q == 'reached' and s.told == 'will'), _server_only),
]

FACTS = [
    ('a staged act becomes effective', lambda s, c: s.a.st == 'effective'),
    ('a renewal alone voids a staged act', lambda s, c: s.a.st == 'voided' and s.a.why == 'renewal'),
]

# --------------------------------------------------------------------------------------
# Scenarios, readings, mutations
# --------------------------------------------------------------------------------------

SCEN = {
    # a grant's whole life, with no question: create, shadow, live, latch, condition, expiry, renew
    'grant': dict(T_MAX=4, EXP=3, CREATES=1, LIVE_TAPS=2, REVOKES=1, RENEWS=1, OVERTURNS=1, CONDS=1,
                  CRASHES=1, REBINDS=1, SKEWS=1),
    # the ladder alone: two latches with different caps, conditions, the operator's doors
    'ladder': dict(T_MAX=1, CREATES=0, LIVE_TAPS=0, REVOKES=0, RENEWS=0, OVERTURNS=0, CONDS=0, CRASHES=1,
                   LATCHES=('ceiling', 'probes'), CLEARS=2, OP_LOWERS=1, OP_RAISES=1, DEGRADES=1, DISARMS=1,
                   ARMS=1),
    # one held O3 item under a live grant: staging, the veto clock, the commit, and the grant's own changes
    'staging': dict(T_MAX=4, EXP=9, VETO_OBS=2, UNSEEN_W=3, G0='live', Q0='held', CREATES=0, LIVE_TAPS=1,
                    REVOKES=1, RENEWS=0, OVERTURNS=1, CONDS=1, CRASHES=1),
    # the same item, with the ladder moving under the staged act
    'staging-ladder': dict(T_MAX=4, EXP=9, VETO_OBS=2, UNSEEN_W=3, G0='live', Q0='held', CREATES=0,
                           LIVE_TAPS=0, REVOKES=0, RENEWS=0, OVERTURNS=0, CONDS=0, CRASHES=0,
                           LATCHES=('ceiling',), CLEARS=1, OP_LOWERS=1, OP_RAISES=1, DISARMS=1, ARMS=1,
                           DEGRADES=1),
    # the same item, with the body changing under the staged act: a renewal, a rebind, a re-armed grant
    'staging-body': dict(T_MAX=4, EXP=9, VETO_OBS=2, UNSEEN_W=3, G0='live', Q0='held', CREATES=0,
                         LIVE_TAPS=1, REVOKES=0, RENEWS=0, OVERTURNS=0, CONDS=0, CRASHES=1, RENEWALS=1,
                         REBINDS=1),
    # the same, with the blind check armed part-way and the grant expiring inside the run
    'expiry': dict(T_MAX=5, EXP=3, VETO_OBS=1, UNSEEN_W=2, G0='live', Q0='held', CREATES=0, LIVE_TAPS=0,
                   REVOKES=0, RENEWS=1, OVERTURNS=0, CONDS=0, CRASHES=1, SKEWS=1, BC_ARMS=1),
}

# (switch, value, scenario, what it should break)
READINGS = [
    ('COND_SUSPEND', 'stored-nokind', 'grant', 'A3'),
    ('SHADOW_LATCH', 'suspended', 'grant', 'A4'),
    ('LATCH_STORE', 'single-overwrite', 'ladder', 'A1'),
    ('LATCH_STORE', 'single-min', 'ladder', ''),
    ('COMMIT_FENCE', 'term', 'staging-body', 'I5'),
    ('EXPIRY_GATE', 'state', 'expiry', 'A2'),
    ('COMMIT_BLIND', 'skip', 'expiry', 'A2b'),
    ('UNSEEN', 'never-shown', 'staging', 'L1'),
    ('VOID_WHEN', 'lazy', 'staging', 'V2'),
    ('VOID_NOTIFY', 'none', 'staging', 'V1'),
]

# (mutation, scenario, overrides, the check that should catch it)
MUTATIONS = [
    ('commit_skips_grant', 'staging', dict(VOID_WHEN='lazy'), 'A2'),
    ('commit_skips_rung', 'staging-ladder', dict(VOID_WHEN='lazy'), 'A2'),
    ('commit_skips_fence', 'staging-body', dict(VOID_WHEN='lazy'), 'A2 I5'),
    ('expiry_never', 'grant', {}, 'A9'),
    ('server_clears_latch', 'ladder', {}, 'A1'),
    ('overlord_raises_rung', 'ladder', {}, 'A1'),
    ('veto_counts_unobserved', 'staging', {}, 'A7'),
    ('eight_hours_never', 'staging', {}, 'L1'),
    ('skew_unguarded', 'expiry', {}, 'A1 A2'),
    ('rebind_no_latch', 'grant', {}, 'A3'),
    ('live_tap_revives_revoked', 'grant', {}, 'A10'),
    ('hold_kept_without_grant', 'staging', {}, 'A11'),
    ('no_fence', 'staging-body', dict(OLD_CALLER=True), 'I5'),
]

# (trace file, scenario, overrides, the checks or facts to print)
TRACES = [
    ('grant-condition-lifts-latch', 'grant', dict(COND_SUSPEND='stored-nokind'), ('A3',)),
    ('grant-shadow-latch-skips-report', 'grant', dict(SHADOW_LATCH='suspended'), ('A4',)),
    ('ladder-second-latch-raises-rung', 'ladder', dict(LATCH_STORE='single-overwrite'), ('A1',)),
    ('commit-fence-term-only', 'staging-body', dict(COMMIT_FENCE='term'), ('I5',)),
    ('commit-fence-renewal-voids', 'staging-body', {}, ('a renewal alone voids a staged act',)),
    ('commit-expired-grant', 'expiry', dict(EXPIRY_GATE='state'), ('A2',)),
    ('commit-blind-check-skipped', 'expiry', dict(COMMIT_BLIND='skip'), ('A2b',)),
    ('staged-act-no-exit', 'staging', dict(UNSEEN='never-shown'), ('L1',)),
    ('staged-act-stands-after-revoke', 'staging', dict(VOID_WHEN='lazy'), ('V2',)),
    ('voided-act-silent', 'staging', dict(VOID_NOTIFY='none', REVOKES=0, OVERTURNS=0, CONDS=0, LIVE_TAPS=0,
                                          CRASHES=0, VETO=False, ANSWER_NOW=False), ('V1',)),
]
