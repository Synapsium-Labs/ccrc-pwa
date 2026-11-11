"""Explicit-state model of the Overlord's hold, readiness, generation and push machines.

Source: an earlier draft of docs/superpowers/specs/2026-11-09-overlord-design.md. Section numbers in
comments refer to that draft, so a few differ from the merged edition.
Every rule the model encodes cites the section it comes from. Where the text is silent or
ambiguous, the rule reads a named switch in the config (see SWITCHES in DEFAULT below), and
check.py runs both readings.

State = the server's rows + the environment. A transition is one transaction, or one
environment event. A server crash can fall between any two transitions, which is how
"a crash between two writes in different transactions" is modelled. Work that the text puts
in two transactions is two transitions, joined by a volatile continuation flag that a crash
clears.
"""
from collections import namedtuple

# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    N_Q=2,                 # question slots
    T_MAX=4,               # last wall-clock tick explored
    ASK_W=1, ITEM_W=2, TRIAGE_W=1,  # hold windows in ticks (C22: 180 s, 20 min, 5 min)
    SERVICE=1,             # stated default service time for admission (§6.8)
    RENEW_BOUND=1,         # renewal budget, ticks, as the `renewing` word's own bound (Table 6.7c)
    RESTART_BOUND=1,       # measured restart time, ticks (Table 6.4a, 6.7c)
    GEN_D=1,               # ticks a transient generation state may last before its timeout is due
    VETO_OBS=1,            # veto window, observed ticks (§7.2)
    SERVER_CRASHES=1,
    SESSION_CRASHES=1,
    SWAPS=0,
    RENEWALS=1,            # renewal triggers (soft or hard) plus Renew now
    REBINDS=0,
    OPERATOR_MSGS=1,
    RUNG_OPS=1,            # operator rung changes (lower, Pause, off, step back up)
    PUSH_FAILS=1,          # push-service refusals
    SKEWS=0,               # wall clock read earlier than the stored time
    FAULTS=('wedged',),    # environment readiness faults that may come and go
    FAULT_EVENTS=1,
    GRANT_REVOKES=0,
    CLASS_RAISES=0,
    OP_CLASS_REMOVALS=0,
    RESTORES=0,
    AUTH_CHANGES=0,        # journalled authority changes (I7 scenario)
    KINDS=(('item_none', 'ask_cd'), ('item_none', 'ask_cd')),
    BLOCKING=(True,),
    STALE_CALLERS=True,
    STALE_REVS=True,
    OP_STALE_TAPS=True,
    EARLY_OP_ANSWERS=True,
    CARD_CAP=None,         # max live-state entries on a card (None: no trimming)
    BREAKER_WAIT=1,
    GRANT_INITIAL='live',
    # ---- switches: readings of ambiguous text ------------------------------------------
    RAISE_TXN='one',            # 'one' | 'split': row insert and the hold-or-reach decision
    OUTCOME_REACH_TXN='same',   # 'same' | 'outcome-first' | 'reach-first'
    OUTCOME_AT='pending',       # outside-DB answer: overlordOutcome written at 'pending' or 'done'
    REV_BUMP_AT='pending',      # outside-DB answer: row revision moves at 'pending' or 'settle'
    REFUSED_SETTLE='none',      # a pending answer settled `refused`: 'none' (text) | 'reach'
    STALE_OPERATOR_TAP='nothing',  # 'nothing' (§6.7 revisions) | 'stands' (§6.7 `superseded`)
    CARD_DOOR_SKIPS='table',    # 'table' (Table 11.6: skip 3,4,6,8,9) | 'literal' (§11.2: skip 3,4,6)
    CARD_LISTS_HOLDS=True,      # False: the card holds only §3.3.3's list, which names no holds
    PAUSE_REACH='per-row',      # 'per-row' | 'brief-only' (released "into a handover brief")
    STAGING_REACHES=True,       # staging push stamps reachedOperatorAt
    ANSWER_CHECKS_DEADLINE=False,  # the answer door refuses a hold past overlordUntil (not in §11.2)
    DOORS_BEFORE_BOOT_PASS=True,   # doors serve before the boot pass ends (text silent)
    RETRY_AT_RUNTIME=False,     # sender retries a refused push before the next boot (text: at boot)
    NONBLOCKING_PUSH='push',    # 'push' (every reach has an outbox row) | 'none' | 'silent'
    START_WHILE_DOWN='reported-at-boot',  # | 'lost-oldkey' | 'lost-nokey'
    CHECKPOINTED_TIMEOUT='clearing',      # | 'active'
    NO_PROOF_WORD='unmeasured',  # word when nothing matches and no fresh proof: 'unmeasured' | 'previous'
    REINHERIT='inherit',        # re-raise: 'inherit' lineage classes | 'replace' with the stated class
    STATE_A_FACT_AUTH='entry',  # 'entry' (C30, Table 6.7b) | 'grant'
    BOOT_UNMEASURED_RELEASES=True,  # Table 6.4a+6.7c at boot: 'unmeasured' releases every hold
    I9_SCOPE='rows',            # 'rows' | 'all' (count the dead-Overlord push too)
    DEAF_ROWS=False,
    FAILED_RENEWAL_RETURNS='active',   # | 'previous'
    MAX_ACTS=2,            # bound on act rows (a model bound)
    WITNESS_LAG=True,      # a witness learns an epoch after the commit (separate event)
    PROBE_FAILS=True,      # probes may fail (generation machine)
    GEN_TIMEOUTS=True,     # transient generation states may time out
    RUNG_TARGETS=('advise', 'chat', 'off'),
    PAUSE=True,
    OP_UP=True,
    IDLE_PROOF=True,
    MUTATION=None,
)


class Cfg(dict):
    __getattr__ = dict.__getitem__


def cfg(**kw):
    d = dict(DEFAULT)
    for k in kw:
        if k not in d:
            raise KeyError(k)
    d.update(kw)
    return Cfg(d)


# --------------------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------------------

TRANSIENT = ('draining', 'checkpointed', 'clearing', 'carded', 'probing')
RUNGS = ('off', 'chat', 'advise', 'full')
RANK = {r: i for i, r in enumerate(RUNGS)}

# A generation row (§3.3.11). conv: the conversation it was minted for.
G = namedtuple('G', 'n st card hard half fails holdoff ent conv ok fromdeg')  # ok: probes passed; fromdeg: renewal began in degraded
# A question row (asks and items, §6.1, §6.7).
Q = namedtuple('Q', 'st kind cls blk rev rev0 until outcome nreach held i1due ok closed_by '
                    'effects lin offered seen taken phase mhspec base')
# An act row (§7.1, §10.1). cont: the volatile continuation of a two-step act.
Act = namedtuple('Act', 'kind q nk st term n conv eff auth obs cont')
# An outbox row (§6.7).
OB = namedtuple('OB', 'q sent att silent')
# Authority journal and restore bookkeeping (§7.6), only when RESTORES > 0.
A = namedtuple('A', 'jgrant jrung jterm repoch jepoch wepoch snap rolled trail cont truth')
S = namedtuple('S', 't up boot measured crashes scr swaps ren rebinds term gen alive downt conv '
                    'startpend fault fev deafn brk rung latch grant msg msgs qs ob acts skew skews '
                    'ops revokes craises oprem word wsince proof auth pushfails')

KIND_W = {'item_none': 'ITEM_W', 'ask_cd': 'ASK_W', 'item_unknown': 'TRIAGE_W',
          'item_o3': 'ITEM_W', 'item_value': 'ITEM_W', 'item_reraise': 'ITEM_W'}
ASKS = ('ask_cd', 'ask_oo', 'ask_lapsed')


def floor_cls(kind):
    """Table 6.7a, the floor by kind and by release reason."""
    return {
        'item_none': frozenset(),          # a decide item stated none
        'ask_cd': frozenset(),             # an ask released cannot-decide
        'item_unknown': frozenset({'unknown'}),
        'item_o3': frozenset({'O3'}),      # stated class, effect approve-dod (grantable)
        'item_value': frozenset({'O5'}),
        'item_classed': frozenset({'O1'}),
        'ask_oo': frozenset({'O1'}),       # operator-only release with its stated classes
        'ask_lapsed': frozenset({'unknown'}),
        'item_reraise': frozenset(),       # stated none on the re-raise
    }[kind]


def init_state(c):
    qs = tuple(Q('u', None, frozenset(), False, 0, 0, None, None, 0, False, None, False, None,
                 (), i, False, False, None, None, False, 0) for i in range(c.N_Q))
    auth = None
    if c.RESTORES or c.AUTH_CHANGES:
        auth = A(jgrant=c.GRANT_INITIAL, jrung='full', jterm=1, repoch=0, jepoch=0, wepoch=0,
                 snap=None, rolled=False, trail=None, cont=None,
                 truth=(c.GRANT_INITIAL, 'full', 1))
    return S(t=0, up=True, boot=frozenset(), measured=True, crashes=c.SERVER_CRASHES,
             scr=c.SESSION_CRASHES, swaps=c.SWAPS, ren=c.RENEWALS, rebinds=c.REBINDS, term=1,
             gen=G(1, 'active', True, False, False, 0, False, 0, 1, True, False), alive='up', downt=0, conv=1,
             startpend=False, fault=None, fev=c.FAULT_EVENTS, deafn=0,
             brk=('closed', 0, 0, None), rung='full', latch=None, grant=c.GRANT_INITIAL,
             msg='none', msgs=c.OPERATOR_MSGS, qs=qs, ob=(), acts=(), skew=0, skews=c.SKEWS,
             ops=c.RUNG_OPS, revokes=c.GRANT_REVOKES, craises=c.CLASS_RAISES,
             oprem=c.OP_CLASS_REMOVALS, word='ready', wsince=0, proof=True, auth=auth,
             pushfails=c.PUSH_FAILS)


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------

def setq(s, i, q):
    qs = list(s.qs)
    qs[i] = q
    return s._replace(qs=tuple(qs))


def eff_rung(s):
    """§7.5: effectiveRung is the lowest of operatorRung, latchedCap and live conditions."""
    r = s.rung
    if s.latch is not None and RANK[s.latch] < RANK[r]:
        r = s.latch
    return r


def standing(q):
    """A standing hold: overlordUntil set, no overlordOutcome yet, row open (§6.1, C31)."""
    return q.st == 'o' and q.until is not None and q.outcome is None


def key_ok(s, c):
    """The current conversation's door process holds a key the server accepts (§3.3.11)."""
    if s.conv == s.gen.conv:
        return True
    return c.START_WHILE_DOWN == 'lost-oldkey'   # W0 fallback: the 0600 file kept gen n's key


def edf_ok(s, c, extra=None):
    """§6.8 admission: earliest deadline first over the whole inbox."""
    ds = sorted([q.until for q in s.qs if standing(q)] + ([extra] if extra is not None else []))
    for k, d in enumerate(ds, start=1):
        if k * c.SERVICE > d - s.t:
            return False
    return True


def facts_word(s, c):
    """Table 6.4a, overlordReadiness(facts, now). First match wins."""
    if eff_rung(s) == 'off':
        return 'off'
    if not s.measured:
        return 'unmeasured'
    if s.alive == 'down':
        return 'restarting' if s.t - s.downt <= c.RESTART_BOUND else 'dead'
    if s.gen.st in TRANSIENT:
        return 'renewing'
    if s.gen.st == 'degraded':
        return 'degraded'
    if s.fault:
        return s.fault
    if s.deafn >= 2:
        return 'deaf'
    if not edf_ok(s, c):
        return 'saturated'
    if s.proof:
        return 'ready'
    # The table has no row for "no fault, but no fresh proof" (ambiguity NO_PROOF_WORD).
    if c.NO_PROOF_WORD == 'previous' and s.word != 'ready':
        return s.word
    return 'unmeasured'


def holdable_kind(s, q, c):
    """Table 6.7b: the Overlord has a settling act it may take alone."""
    k = q.kind
    if k in ('item_none', 'ask_cd'):
        return not q.cls
    if k == 'item_unknown':
        return True                                   # triage hold
    if k == 'item_reraise':
        return True                                   # none: answer; unknown: triage
    if k == 'item_o3':
        return s.grant == 'live' and q.cls <= {'O3'}  # every class covered by a live grant
    if k == 'item_value':
        if c.STATE_A_FACT_AUTH == 'grant':
            return s.grant == 'live' and q.cls <= {'O5'}
        return q.cls <= {'O5'}
    return False


def may_hold(s, q, c, mutated=True):
    """H18 mayHold(row): every condition must be true."""
    m = c.MUTATION if mutated else None
    if eff_rung(s) != 'full':
        return False
    if m != 'mayhold_ignores_readiness':
        if facts_word(s, c) != 'ready':
            return False
    st, n, obs, trial = s.brk
    if st == 'open' or (st == 'half' and trial is not None):
        return False
    if not edf_ok(s, c, s.t + window(q, c)):
        return False
    return holdable_kind(s, q, c)


def window(q, c):
    if q.kind == 'item_reraise' and 'unknown' in q.cls:
        return c.TRIAGE_W
    if q.kind not in KIND_W:
        return c.ASK_W if q.kind in ASKS else c.ITEM_W
    return c[KIND_W[q.kind]]


def push_due(q, c):
    """pushDue(row) for a reach: asks always push; a blocking item pushes; a non-blocking
    item follows the NONBLOCKING_PUSH reading."""
    if q.kind in ASKS or q.blk:
        return 'push'
    return c.NONBLOCKING_PUSH


def write_reach(s, i, c, group=False):
    """§6.7: the reach stamp and one outbox row are written in one transaction."""
    q = s.qs[i]
    if q.nreach > 0 and c.MUTATION != 'no_reach_guard':
        return s
    q = q._replace(nreach=q.nreach + 1)
    s = setq(s, i, q)
    if c.MUTATION == 'reach_without_outbox':
        return s
    p = push_due(q, c)
    if p == 'push':
        s = s._replace(ob=s.ob + (OB(i, False, False, False),))
    elif p == 'silent':
        s = s._replace(ob=s.ob + (OB(i, True, True, True),))
    return s


def release(s, i, outcome, c):
    """End a hold (or route a row at once) so that it reaches the operator.
    OUTCOME_REACH_TXN decides whether overlordOutcome and the reach stamp share a txn."""
    q = s.qs[i]
    mode = c.OUTCOME_REACH_TXN
    if mode == 'same':
        s = setq(s, i, q._replace(outcome=outcome))
        return write_reach(s, i, c)
    if mode == 'outcome-first':
        return setq(s, i, q._replace(outcome=outcome, phase='R'))
    # reach-first
    s = write_reach(s, i, c)
    q = s.qs[i]
    return setq(s, i, q._replace(phase=('O', outcome)))


def add_effect(s, i, actor, nk, c):
    """ok: the row was settled in time for I1. The operator's own answer always settles it.
    The Overlord's (or a return) settles it only by the hold's deadline: C22 'A deadline never
    moves'; the boot's 'one sweep' grace is for reaching the operator, not for answering."""
    q = s.qs[i]
    if actor == 'operator':
        ok = True
    else:
        ok = q.ok or q.until is None or s.t <= q.until
    return setq(s, i, q._replace(effects=q.effects + ((actor, nk),), ok=ok))


def close(s, i, by):
    q = s.qs[i]
    return setq(s, i, q._replace(st='c', closed_by=by))


def brk_served(s, i):
    st, n, obs, trial = s.brk
    if st == 'half' and trial == i:
        return s._replace(brk=('closed', 0, 0, None))
    return s


def brk_void(s, i):
    st, n, obs, trial = s.brk
    if st == 'half' and trial == i:
        return s._replace(brk=('half', n, obs, None))
    return s


# --------------------------------------------------------------------------------------
# Normalisation: the readiness lane and the retention table (§6.4, Table 6.7c)
# --------------------------------------------------------------------------------------

def retention_keep(s, q, word, c):
    """Table 6.7c, standing holds by cause, plus the rung/grant/class rows."""
    if eff_rung(s) != 'full':
        return False, 'notready:' + word if word == 'off' else 'released'
    if q.kind == 'item_o3' and s.grant != 'live':
        return False, 'released'
    if not (q.cls <= floor_cls(q.kind) | (frozenset({'unknown'}) if q.kind == 'item_reraise' else frozenset())):
        return False, 'released'    # a class raised on a held row
    if word == 'ready':
        return True, None
    if word in ('renewing', 'restarting'):
        if word == 'renewing':
            bound = s.wsince + c.RENEW_BOUND
        else:
            bound = s.downt + c.RESTART_BOUND
        if c.MUTATION == 'renewing_keeps_all':
            return True, None
        return (q.until > bound), 'notready:' + word
    if word in ('saturated', 'deaf'):
        return True, None
    if word == 'unmeasured' and not c.BOOT_UNMEASURED_RELEASES and s.boot:
        return True, None
    return False, 'notready:' + word


def canon(s, c):
    """Erase fields that no longer influence any future step, so equal futures share a state."""
    g = s.gen
    kw = {}
    if g.st not in TRANSIENT and g.ent != 0:
        kw['ent'] = 0
    if g.st != 'probing' and g.fails:
        kw['fails'] = 0
    if g.st != 'clearing' and g.half:
        kw['half'] = False
    if g.st not in ('draining', 'checkpointed', 'clearing') and g.hard:
        kw['hard'] = False
    if g.st not in ('draining', 'checkpointed', 'clearing') and g.fromdeg:
        kw['fromdeg'] = False
    if kw:
        s = s._replace(gen=g._replace(**kw))
    if s.alive == 'up' and s.downt != 0:
        s = s._replace(downt=0)
    if s.word != 'renewing' and s.wsince != 0:
        s = s._replace(wsince=0)
    if s.msg == 'settled':
        s = s._replace(msg='none')
    qs = None
    for i, q in enumerate(s.qs):
        if q.st != 'u' and not standing(q) and (q.offered or q.seen or q.taken is not None):
            if qs is None:
                qs = list(s.qs)
            qs[i] = q._replace(offered=False, seen=False, taken=None)
    for i, q in enumerate(s.qs if qs is None else qs):
        if q.nreach > 0 and q.phase is None and isinstance(q.outcome, str) and q.outcome.startswith('notready:') \
                and not any(a.q == i and a.st in ('pending', 'staged', 'unknown') for a in s.acts):
            if qs is None:
                qs = list(s.qs)
            qs[i] = q._replace(outcome='notready')
    if qs is not None:
        s = s._replace(qs=tuple(qs))
    if len(s.ob) > 1:
        ob = tuple(sorted(s.ob))
        if ob != s.ob:
            s = s._replace(ob=ob)
    if s.boot:
        b = set(s.boot)
        if 'acts' in b and not any(a.st == 'pending' for a in s.acts):
            b.discard('acts')
        if 'outbox' in b and not any((not o.sent and o.att) for o in s.ob):
            b.discard('outbox')
        if 'reseed' in b and not any(standing(q) for q in s.qs):
            b.discard('reseed')
        if len(b) != len(s.boot):
            s = s._replace(boot=frozenset(b))
    return s


def normalize(s, c):
    s = _normalize(s, c)
    return canon(s, c)


def _normalize(s, c):
    if not s.up:
        return s
    w = facts_word(s, c)
    if w != s.word:
        proof = s.proof if s.word != 'ready' else False
        ob = s.ob
        if w == 'dead':
            ob = ob + (OB(-1, False, False, False),)   # C23: one push with a Restart control
        s = s._replace(word=w, wsince=s.t, proof=proof, ob=ob)
    for i, q in enumerate(s.qs):
        if standing(q) and q.phase is None:
            keep, why = retention_keep(s, q, w, c)
            if not keep:
                s = release(s, i, why, c)
    return s


# --------------------------------------------------------------------------------------
# Door gates (§11.2)
# --------------------------------------------------------------------------------------

def gate(s, c, door, caller):
    """Returns None (pass) or the refusal word. door: read|card|write. caller: (term,n,keyok,conv)."""
    term, n, kok, conv = caller
    cpn = door == 'card'
    # 1. who calls: the designated session and its current uuid
    if conv != s.conv or s.alive != 'up':
        return 'not-the-overlord'
    # 3. authority-rolled-back
    if s.auth is not None and s.auth.rolled and not cpn:
        return 'authority-rolled-back'
    # 4. the off rung
    if s.rung == 'off' and not cpn:
        return 'overlord-off'
    fenced = door != 'read'
    # 5. stale-designation
    if fenced and term < s.term:
        return 'stale-designation'
    # 7. stale-generation
    if fenced and c.MUTATION != 'no_fence':
        if n != s.gen.n or not kok:
            return 'stale-generation'
    skip89 = cpn and c.CARD_DOOR_SKIPS == 'table'
    # 8. card-unread
    if not skip89 and not s.gen.card:
        return 'card-unread'
    # 9. the generation not active
    if not skip89 and s.gen.st != 'active':
        return 'renewing'
    return None


def callers(s, c, write):
    """The current door process, and (for write doors) stale ones: an earlier generation's
    door process (§3.3.11 'a reader started before a renewal') and the old body after a
    rebind ('the old body after a rebind')."""
    out = [('cur', (s.term, s.gen.n, key_ok(s, c), s.conv))]
    if write and c.STALE_CALLERS:
        if s.gen.n > 1:
            out.append(('stale-gen', (s.term, s.gen.n - 1, True, s.conv)))
        if s.term > 1:
            out.append(('stale-term', (s.term - 1, s.gen.n, True, s.conv)))
    return out


# --------------------------------------------------------------------------------------
# Transitions
# --------------------------------------------------------------------------------------

def mint(s, c, conv, why):
    """§3.3.11 'Every start mints a generation': n+1 at carded; voids n's key; n ended."""
    g = s.gen
    return s._replace(gen=G(g.n + 1, 'carded', False, False, False, 0, False, s.t, conv, False, False))


def gen_to(s, st, **kw):
    g = s.gen._replace(st=st, ent=s.t, **kw)
    return s._replace(gen=g)


def boot_blocking(s, c):
    return s.boot and not c.DOORS_BEFORE_BOOT_PASS


def urgent_pending(s, c):
    """Things that must happen before wall time advances (they take milliseconds, or the
    design says 'by its deadline')."""
    if not s.up:
        return False
    if s.boot:
        return True
    now_sweep = s.t - s.skew if c.MUTATION == 'sweep_raw_clock' else s.t
    if 'reseed' not in s.boot:
        for q in s.qs:
            if standing(q) and q.phase is None and q.until <= now_sweep:
                return True
    for q in s.qs:
        if q.phase is not None:
            return True
    for a in s.acts:
        if a.cont:
            return True
        if a.st == 'staged' and a.obs >= c.VETO_OBS:
            return True
    g = s.gen
    if g.st in TRANSIENT and s.t - g.ent >= c.GEN_D:
        return True
    if s.auth is not None and s.auth.cont is not None:
        return True
    return False


def successors(s, c):
    out = []
    add = out.append
    t = s.t

    # ---------------- time -------------------------------------------------------------
    if t < c.T_MAX and not urgent_pending(s, c):
        ns = s._replace(t=t + 1, skew=0, gen=s.gen._replace(holdoff=False))
        if s.up:
            acts = tuple(a._replace(obs=a.obs + 1) if a.st == 'staged' else a for a in ns.acts)
            ns = ns._replace(acts=acts)
            st, n, obs, trial = ns.brk
            if st == 'open':
                obs += 1
                if obs >= c.BREAKER_WAIT:
                    ns = ns._replace(brk=('half', n, 0, None))
                else:
                    ns = ns._replace(brk=(st, n, obs, trial))
        add(('tick', ns))
    if s.skews > 0 and s.skew == 0:
        add(('wall clock reads one tick early', s._replace(skew=1, skews=s.skews - 1)))

    # ---------------- server crash and boot ------------------------------------------
    if s.up and s.crashes > 0:
        qs = tuple(q._replace(phase=None) for q in s.qs)
        acts = tuple(a._replace(cont=False) for a in s.acts)
        auth = s.auth._replace(cont=None) if s.auth is not None else None
        add(('SERVER CRASH', s._replace(up=False, crashes=s.crashes - 1, qs=qs, acts=acts,
                                        boot=frozenset(), auth=auth)))
    if not s.up:
        boot = {'reseed', 'acts', 'outbox'}
        if s.startpend:
            boot.add('start')
        qs = tuple(q._replace(i1due=t) if (q.held and q.st == 'o' and q.nreach == 0 and not q.ok
                                            and q.i1due is not None and q.i1due < t) else q
                   for q in s.qs)
        ns = s._replace(up=True, boot=frozenset(boot), measured=False, qs=qs)
        if s.auth is not None:
            ns = boot_coherence(ns, c)
        add(('server boots', ns))

    # ---------------- boot pass (three writers, three transactions) -------------------
    if s.up and s.boot:
        if 'reseed' in s.boot:
            ns = s._replace(boot=s.boot - {'reseed'})
            for i, q in enumerate(ns.qs):
                if standing(q):
                    if c.MUTATION == 'restart_extends_deadline':
                        ns = setq(ns, i, q._replace(until=t + window(q, c)))
                    elif q.until <= t:
                        ns = release(ns, i, 'server-gap', c)   # §6.7, one grouped push
            add(('boot: re-seed holds', ns))
        if 'acts' in s.boot:
            base = s._replace(boot=s.boot - {'acts'})
            pend = [k for k, a in enumerate(s.acts) if a.st == 'pending']
            results = [base]
            for k in pend:
                nxt = []
                for r in results:
                    nxt.append(settle_act(r, k, 'done' if r.acts[k].eff else 'refused', c))
                    nxt.append(settle_act(r, k, 'unknown', c))
                results = nxt
            for r in results:
                add(('boot: settle pending acts by measuring', r))
        if 'outbox' in s.boot:
            ob = tuple(o._replace(att=False) if not o.sent else o for o in s.ob)
            add(('boot: outbox resend armed', s._replace(boot=s.boot - {'outbox'}, ob=ob)))
        if 'start' in s.boot:
            ns = mint(s._replace(boot=s.boot - {'start'}, startpend=False), c, s.conv, 'start')
            add(('boot: the host reports the start; mint generation', ns))

    if s.up and not s.measured:
        add(('readiness lane measures', s._replace(measured=True)))

    # ---------------- the push sender (one sender, §6.7) -------------------------------
    if s.up:
        for k, o in enumerate(s.ob):
            if not o.sent and (not o.att or c.RETRY_AT_RUNTIME):
                ob = list(s.ob)
                ob[k] = o._replace(sent=True, att=True)
                add(('push sender: service accepts outbox row q%s' % o.q, s._replace(ob=tuple(ob))))
                if s.pushfails > 0:
                    ob2 = list(s.ob)
                    ob2[k] = o._replace(att=True)
                    add(('push sender: service refuses outbox row q%s' % o.q,
                         s._replace(ob=tuple(ob2), pushfails=s.pushfails - 1)))

    # ---------------- coordinators raise questions -------------------------------------
    if s.up and not boot_blocking(s, c):
        for i, q in enumerate(s.qs):
            if q.st != 'u':
                continue
            if any(p.st == 'u' for p in s.qs[:i]):
                break
            for kind in c.KINDS[i]:
                if kind == 'item_reraise':
                    q0 = s.qs[0]
                    if not (q0.st == 'c' and q0.closed_by == 'returned'):
                        continue
                for blk in ((True,) if kind in ASKS else c.BLOCKING):
                    add(raise_q(s, i, kind, blk, c))
            break
        for i, q in enumerate(s.qs):
            if q.phase == 'ins':
                add(('mayHold decides q%d (second txn)' % i, decide(s._replace(), i, c)))

    # ---------------- continuations of two-transaction writes ---------------------------
    if s.up:
        for i, q in enumerate(s.qs):
            if q.phase == 'R':
                ns = setq(s, i, q._replace(phase=None))
                add(('reach txn for q%d' % i, write_reach(ns, i, c)))
            elif isinstance(q.phase, tuple):
                ns = setq(s, i, q._replace(phase=None, outcome=q.phase[1]))
                add(('outcome txn for q%d' % i, ns))

    # ---------------- the deadline sweep -------------------------------------------------
    if s.up and 'reseed' not in s.boot:
        now_sweep = t - s.skew if c.MUTATION == 'sweep_raw_clock' else t
        for i, q in enumerate(s.qs):
            if standing(q) and q.phase is None and q.until <= now_sweep:
                ns = s
                st, n, obs, trial = s.brk
                attributed = (facts_word(s, c) == 'ready' and q.offered)
                if attributed:
                    if st == 'half' and trial == i:
                        ns = ns._replace(brk=('open', 0, 0, None))
                    elif st == 'closed':
                        ns = ns._replace(brk=('open', 0, 0, None) if n + 1 >= 2 else ('closed', n + 1, 0, None))
                add(('deadline sweep: q%d lapsed' % i, release(ns, i, 'lapsed', c)))

    # ---------------- the coalesced wake (offers rows) ----------------------------------
    if s.up and s.alive == 'up' and s.gen.st == 'active' and s.gen.card:
        idx = [i for i, q in enumerate(s.qs) if standing(q) and not q.offered]
        if idx:
            ns = s
            for i in idx:
                ns = setq(ns, i, ns.qs[i]._replace(offered=True))
            add(('wake: held rows offered', ns))

    # ---------------- per-row deafness (Table 6.4a deaf, Table 6.7c) --------------------
    if s.up and c.DEAF_ROWS:
        for i, q in enumerate(s.qs):
            if standing(q) and q.phase is None and q.offered and not q.seen and q.taken is not None \
                    and t >= q.taken + (window(q, c) + 1) // 2 and s.deafn < 2:
                ns = s._replace(deafn=s.deafn + 1)
                add(('row q%d deaf: past half its window, no door call since offered' % i,
                     release(ns, i, 'notready:deaf', c)))

    # ---------------- generation machine (the renewal lane, §3.3.11) --------------------
    if s.up and not s.boot:
        out.extend(gen_steps(s, c))

    # ---------------- outside-DB act steps (§7.1) ---------------------------------------
    if s.up:
        for k, a in enumerate(s.acts):
            if a.st == 'pending' and a.cont and not a.eff:
                out.append(effect_step(s, k, c))
            if a.st == 'pending' and a.cont and a.eff:
                out.append(('door settles act %d done' % k, settle_act(s._replace(), k, 'done', c)))
            if a.st == 'unknown':
                out.append(('lane measures unknown act %d' % k,
                            settle_act(s, k, 'done' if a.eff else 'refused', c)))
            if a.st == 'staged' and a.obs >= c.VETO_OBS:
                out.append(staged_commit(s, k, c))

    # ---------------- Overlord doors -----------------------------------------------------
    if s.up and s.alive == 'up' and not boot_blocking(s, c):
        out.extend(overlord_doors(s, c))

    # ---------------- the operator ----------------------------------------------------------
    if s.up and not boot_blocking(s, c):
        out.extend(operator_events(s, c))

    # ---------------- the session (Claude Code + ccd) ------------------------------------
    if s.alive == 'up' and s.scr > 0:
        add(('SESSION CRASH', s._replace(alive='down', downt=t, scr=s.scr - 1)))
    if s.alive == 'down':
        add(start_report(s._replace(alive='up', conv=s.conv + 1), c, 'session restarts (crash restart)'))
    if s.alive == 'up' and s.swaps > 0:
        add(start_report(s._replace(conv=s.conv + 1, swaps=s.swaps - 1), c, 'swap lands'))
    if c.IDLE_PROOF and s.up and s.alive == 'up' and s.gen.st == 'active' and not s.proof:
        add(('idle word over a finished turn (proof)', s._replace(proof=True)))

    # ---------------- environment readiness faults --------------------------------------
    if s.fev > 0:
        for f in c.FAULTS:
            if s.fault != f:
                add(('fault: %s' % f, s._replace(fault=f, fev=s.fev - 1)))
    if s.fault is not None:
        add(('fault clears', s._replace(fault=None)))

    # ---------------- a class is raised on a held row (Table 6.7c) ----------------------
    if s.up and s.craises > 0:
        for i, q in enumerate(s.qs):
            if standing(q):
                ns = setq(s, i, q._replace(cls=q.cls | {'O1'}))
                add(('class O1 raised on held q%d' % i, ns._replace(craises=s.craises - 1)))

    # ---------------- restore (I7) ---------------------------------------------------------
    if s.auth is not None:
        out.extend(auth_events(s, c))

    res = []
    for tr in out:
        if len(tr) == 2:
            lbl, ns = tr
            info = None
        else:
            lbl, ns, info = tr
        res.append((lbl, normalize(ns, c), info))
    return res


def start_report(s, c, label):
    """§3.3.11 Any SessionStart the host reports that is not a compaction mints n+1."""
    if s.up and not s.boot:
        return (label + '; server mints generation', mint(s, c, s.conv, 'start'))
    if s.up and s.boot:
        return (label + '; server mints generation (during boot pass)', mint(s, c, s.conv, 'start'))
    if c.START_WHILE_DOWN == 'reported-at-boot':
        return (label + ' while the server is down; start report queued', s._replace(startpend=True))
    return (label + ' while the server is down; start report lost', s)


def raise_q(s, i, kind, blk, c):
    q = s.qs[i]
    cls = floor_cls(kind)
    lin = i
    if kind == 'item_reraise':
        lin = 0
        if c.REINHERIT == 'inherit':
            cls = cls | s.qs[0].cls        # §6.7 Lineage: inherits every class it reached
    base = 1 if (kind in ASKS or blk) else 0   # today's build: asks push, blocking items push
    q = q._replace(st='o', kind=kind, cls=cls, blk=blk, lin=lin, base=base)
    ns = setq(s, i, q)
    lbl = 'coordinator raises q%d %s%s' % (i, kind, '' if kind in ASKS else (' blocking' if blk else ' non-blocking'))
    if c.RAISE_TXN == 'split':
        return (lbl + ' (row only)', setq(ns, i, ns.qs[i]._replace(phase='ins')))
    return (lbl, decide(ns, i, c))


def decide(s, i, c):
    q = s.qs[i]._replace(phase=None)
    s = setq(s, i, q)
    mh = may_hold(s, q, c)
    mhspec = may_hold(s, q, c, mutated=False)
    if mh:
        st, n, obs, trial = s.brk
        if st == 'half':
            s = s._replace(brk=(st, n, obs, i))
        w = window(q, c)
        q = q._replace(until=s.t + w, held=True, taken=s.t, i1due=s.t + w, mhspec=mhspec)
        return setq(s, i, q)
    s = setq(s, i, q._replace(mhspec=mhspec))
    word = facts_word(s, c)
    if word != 'ready':
        why = 'notready:' + word
    elif not edf_ok(s, c, s.t + window(q, c)) and holdable_kind(s, q, c) and eff_rung(s) == 'full':
        why = 'notready:saturated'
    else:
        why = 'brief-pending'
    return release(s, i, why, c)


def settle_act(s, k, result, c):
    """Settle a pending act: the door on the effect's result, or the boot pass by measuring."""
    a = s.acts[k]
    acts = list(s.acts)
    acts[k] = a._replace(st=result, cont=False)
    s = s._replace(acts=tuple(acts))
    i = a.q
    q = s.qs[i]
    if result == 'done':
        if c.OUTCOME_AT == 'done' and q.outcome is None:
            q = q._replace(outcome='answered')
        if c.REV_BUMP_AT == 'settle':
            q = q._replace(rev=q.rev + 1)
        s = setq(s, i, q)
        if s.qs[i].st == 'o':
            s = close(s, i, 'overlord')
        s = brk_served(s, i)
    elif result == 'refused':
        # Table 7.1b: pending -> refused. The text says nothing about the question row.
        if c.REFUSED_SETTLE == 'reach' and q.st == 'o' and q.nreach == 0:
            s = release(s, i, q.outcome or 'refused', c) if q.outcome is None else write_reach(s, i, c)
    elif result == 'unknown':
        # Table 7.1b: unknown 'always sends its question to the operator'
        if q.st == 'o' and q.nreach == 0:
            if q.outcome is None:
                s = release(s, i, 'unknown-act', c)
            else:
                s = write_reach(s, i, c)
    return s


def effect_step(s, k, c):
    """The key press in the child's dialog (an effect outside the database)."""
    a = s.acts[k]
    i = a.q
    q = s.qs[i]
    if q.st == 'o' and not q.effects:
        acts = list(s.acts)
        acts[k] = a._replace(eff=True)
        ns = s._replace(acts=tuple(acts))
        ns = add_effect(ns, i, 'overlord', a.nk, c)
        return ('effect lands: key pressed for act %d on q%d' % (k, i), ns)
    # the dialog is gone: the door settles refused on the effect's result
    return ('effect fails (dialog gone) for act %d' % k, settle_act(s, k, 'refused', c))


def staged_commit(s, k, c):
    """§7.2 the commit re-checks overlordMayAct, the fence, the rung and the row's state."""
    a = s.acts[k]
    i = a.q
    q = s.qs[i]
    fence_ok = (a.term == s.term and a.n == s.gen.n and a.conv == s.gen.conv)
    if c.MUTATION == 'staged_no_fence_recheck':
        fence_ok = True
    grant_ok = s.grant == 'live' or c.MUTATION == 'staged_no_grant_recheck'
    ok = fence_ok and grant_ok and eff_rung(s) == 'full' and q.st == 'o'
    acts = list(s.acts)
    if ok:
        acts[k] = a._replace(st='effective')
        ns = s._replace(acts=tuple(acts))
        ns = add_effect(ns, i, 'overlord', a.nk, c)
        ns = close(ns, i, 'overlord')
        return ('veto window ends: staged act %d effective' % k, ns, {'accepted_write': (a.term, a.n, True, a.conv), 'act_commit': (a.kind, i, a.auth)})
    acts[k] = a._replace(st='voided')
    ns = s._replace(acts=tuple(acts))
    return ('veto window ends: staged act %d voided' % k, ns)


def back(s, c):
    """§3.3.11 'A failure before the first half returns the generation to active, with a hold-off.'
    FAILED_RENEWAL_RETURNS='active' is that sentence; 'previous' returns a renewal that began in
    degraded to degraded."""
    if s.gen.fromdeg and c.FAILED_RENEWAL_RETURNS == 'previous':
        return gen_to(s, 'degraded', fromdeg=False)
    return gen_to(s, 'active', holdoff=True, fromdeg=False)


def back_label(g, c):
    if g.fromdeg and c.FAILED_RENEWAL_RETURNS == 'previous':
        return 'back to degraded'
    return 'active with hold-off'


def gen_steps(s, c):
    out = []
    g = s.gen
    add = out.append
    if g.st == 'active' and s.ren > 0:
        if not g.holdoff:
            add(('soft trigger: draining', gen_to(s._replace(ren=s.ren - 1), 'draining', hard=False)))
        add(('hard trigger: draining', gen_to(s._replace(ren=s.ren - 1), 'draining', hard=True)))
    if g.st == 'degraded' and s.ren > 0:
        add(('hard trigger or Renew now from degraded: draining',
             gen_to(s._replace(ren=s.ren - 1), 'draining', hard=True, fromdeg=True)))
    if g.st == 'draining':
        add(('drained', gen_to(s, 'clearing' if g.hard else 'checkpointed', half=False)))
        if c.GEN_TIMEOUTS or s.t - g.ent >= c.GEN_D:
            add(('draining times out: ' + back_label(g, c), back(s, c)))
    if g.st == 'checkpointed':
        add(('handover note written', gen_to(s, 'clearing', half=False)))
        if c.CHECKPOINTED_TIMEOUT == 'clearing':
            add(('checkpointed times out: clearing', gen_to(s, 'clearing', half=False)))
        else:
            add(('checkpointed times out: ' + back_label(g, c), back(s, c)))
    if g.st == 'clearing':
        if not g.half:
            add(('clearing fails before the old conversation ended: ' + back_label(g, c), back(s, c)))
            ns = s._replace(gen=g._replace(half=True))
            add(('receipt first half: old conversation ended', ns))
        else:
            add(start_report(s._replace(conv=s.conv + 1), c, 'receipt second half: fresh conversation starts'))
            add(('clearing retries spent after the first half: degraded', gen_to(s, 'degraded')))
    if g.st == 'carded' and (c.GEN_TIMEOUTS or s.t - g.ent >= c.GEN_D):
        add(('carded times out after one re-nudge: degraded', gen_to(s, 'degraded')))
    if g.st == 'probing':
        add(('probes pass: active', gen_to(s, 'active', ok=True)))
        if not c.PROBE_FAILS:
            pass
        elif g.fails == 0:
            add(('probe round fails once', s._replace(gen=g._replace(fails=1))))
        else:
            add(('probes fail twice: degraded, ladder latched at chat',
                 gen_to(s._replace(latch='chat'), 'degraded')))
    return out


def overlord_doors(s, c):
    out = []
    add = out.append
    cur = (s.term, s.gen.n, key_ok(s, c), s.conv)
    # the inbox read (a read door; the heartbeat)
    if gate(s, c, 'read', cur) is None and eff_rung(s) != 'off':
        ns = s._replace(proof=True)
        for i, q in enumerate(ns.qs):
            if standing(q):
                ns = setq(ns, i, q._replace(offered=True, seen=True))
        if ns != s:
            add(('Overlord reads its inbox', ns))
    # the card door
    if s.gen.st == 'carded' and not s.gen.card:
        for nm, cl in callers(s, c, True):
            if gate(s, c, 'card', cl) is None:
                listed = card_listing(s, c)
                ns = s._replace(gen=s.gen._replace(card=True, st='probing', ent=s.t, fails=0))
                add(('Overlord (%s) reads its card' % nm, ns,
                     {'accepted_write': cl, 'card': listed}))
    # acknowledge the operator's message (keep its own records; allowed at chat)
    if s.msg == 'unsettled':
        for nm, cl in callers(s, c, True):
            if gate(s, c, 'write', cl) is None and RANK[eff_rung(s)] >= RANK['chat']:
                add(('Overlord (%s) acknowledges the operator message' % nm,
                     s._replace(msg='settled', proof=True), {'accepted_write': cl}))
    # answer, escalate, return-over-asked
    for i, q in enumerate(s.qs):
        if q.st != 'o':
            continue
        for nm, cl in callers(s, c, True):
            g = gate(s, c, 'write', cl)
            if g is not None:
                continue
            revs = [q.rev] + ([q.rev - 1] if (c.STALE_REVS and q.rev > 0) else [])
            for rv in revs:
                for act in ('answer', 'escalate', 'return'):
                    r = door_act(s, c, i, act, cl, rv, nm)
                    if r is not None:
                        add(r)
    return out


def card_listing(s, c):
    """§3.3.3: the card's live state. Holds are listed only under CARD_LISTS_HOLDS."""
    items = []
    if s.msg == 'unsettled':
        items.append('msg')
    if c.CARD_LISTS_HOLDS:
        items.extend('q%d' % i for i, q in enumerate(s.qs) if standing(q))
    if c.CARD_CAP is not None:
        items = items[:c.CARD_CAP]   # "The server trims live state by rank"
    return frozenset(items)


def door_act(s, c, i, act, cl, rv, nm):
    q = s.qs[i]
    rung = eff_rung(s)
    # 10. the rung, by act kind
    if act == 'answer' and rung != 'full':
        return None
    if act in ('escalate', 'return') and RANK[rung] < RANK['advise']:
        return None
    # row checks: operator-has-it, and a held row admits only the acts of Table 6.7b
    bypass = c.MUTATION == 'no_operator_has_it' and act == 'answer'
    if q.nreach > 0 and not bypass:
        return None
    if not standing(q) and not (bypass and q.held and q.st == 'o'):
        return None
    if q.phase is not None:
        return None
    if c.ANSWER_CHECKS_DEADLINE and s.t >= q.until:
        return None
    lbl = 'Overlord (%s) %s q%d at rev %d' % (nm, act, i, rv)
    info = {'accepted_write': cl}
    s = s._replace(proof=True)          # §6.4: a door call is proof
    if rv != q.rev:
        return (lbl + ': stale revision, nothing changes', s)
    if act == 'return':
        if 'unknown' not in q.cls:
            return None
        a = Act('return-over-asked', i, rv, 'done', cl[0], cl[1], cl[3], True, 'none', 0, False)
        ns = setq(s, i, q._replace(outcome='returned', rev=q.rev + 1))._replace(acts=s.acts + (a,))
        ns = add_effect(ns, i, 'returned', rv, c)
        ns = close(ns, i, 'returned')
        ns = brk_served(ns, i)
        return (lbl, ns, info)
    if act == 'escalate':
        ns = setq(s, i, q._replace(rev=q.rev + 1))
        ns = release(ns, i, 'escalated', c)
        ns = brk_served(ns, i)
        return (lbl, ns, info)
    # answer: 11. overlordMayAct
    if 'unknown' in q.cls:
        return None                                    # operator-only
    if any(a.q == i and a.nk == rv for a in s.acts) and c.MUTATION != 'no_natural_key':
        return None                                    # natural unique key
    if len(s.acts) >= c.MAX_ACTS:
        return None                                    # model bound, not a design rule
    if q.kind in ASKS:
        if q.cls:
            return None
        a = Act('answer-ask', i, rv, 'pending', cl[0], cl[1], cl[3], False, 'none', 0, True)
        nq = q
        if c.OUTCOME_AT == 'pending':
            nq = nq._replace(outcome='answered')
        if c.REV_BUMP_AT == 'pending':
            nq = nq._replace(rev=nq.rev + 1)
        ns = setq(s, i, nq)._replace(acts=s.acts + (a,))
        return (lbl + ' (act pending)', ns, info)
    if q.kind == 'item_o3':
        if s.grant != 'live':
            return None
        a = Act('answer-item', i, rv, 'staged', cl[0], cl[1], cl[3], False, 'grant', 0, False)
        ns = setq(s, i, q._replace(outcome='staged', rev=q.rev + 1))._replace(acts=s.acts + (a,))
        if c.STAGING_REACHES:
            ns = write_reach(ns, i, c)
        info = dict(info, act_commit=('answer-item', i, 'grant-staged'))
        return (lbl + ' (staged under grant)', ns, info)
    auth = 'none'
    if q.kind == 'item_value':
        if c.STATE_A_FACT_AUTH == 'grant':
            if s.grant != 'live':
                return None
            auth = 'grant'
        else:
            auth = 'entry'
    if q.cls and auth == 'none':
        return None
    a = Act('state-a-fact' if q.kind == 'item_value' else 'answer-item', i, rv, 'done',
            cl[0], cl[1], cl[3], True, auth, 0, False)
    ns = setq(s, i, q._replace(outcome='answered', rev=q.rev + 1))
    if c.MUTATION != 'item_answer_no_act_row':
        ns = ns._replace(acts=s.acts + (a,))
    ns = add_effect(ns, i, 'overlord', rv, c)
    ns = close(ns, i, 'overlord')
    ns = brk_served(ns, i)
    info = dict(info, act_commit=(a.kind, i, auth))
    return (lbl, ns, info)


def operator_events(s, c):
    out = []
    add = out.append
    t = s.t
    for i, q in enumerate(s.qs):
        if q.st == 'o' and c.EARLY_OP_ANSWERS:
            ns = op_answer(s, i, q.rev, c)
            add(('operator answers q%d at rev %d' % (i, q.rev), ns))
        if c.OP_STALE_TAPS and q.rev > q.rev0 and q.st in ('o', 'c') and q.closed_by != 'operator' \
                and not any(e[0] == 'operator' for e in q.effects):
            rv = q.rev - 1
            if c.STALE_OPERATOR_TAP == 'nothing':
                add(('operator taps q%d at stale rev %d: nothing changes' % (i, rv), s))
            else:
                add(('operator taps q%d at stale rev %d: superseded, the operator answer stands' % (i, rv),
                     op_answer(s, i, rv, c, stale=True)))
        if s.oprem > 0 and q.st == 'o' and q.cls:
            m = sorted(q.cls)[0]
            add(('operator removes class %s from q%d' % (m, i),
                 setq(s, i, q._replace(cls=q.cls - {m}))._replace(oprem=s.oprem - 1)))
    for k, a in enumerate(s.acts):
        if a.st == 'staged':
            acts = list(s.acts)
            acts[k] = a._replace(st='vetoed')
            add(('operator vetoes staged act %d' % k, s._replace(acts=tuple(acts))))
    if s.msgs > 0 and s.msg != 'unsettled':
        add(('operator sends a message', s._replace(msg='unsettled', msgs=s.msgs - 1)))
    if s.ops > 0 and s.auth is None:
        for r in c.RUNG_TARGETS:
            if RANK[r] < RANK[s.rung]:
                add(('operator lowers the rung to %s' % r, op_lower(s, r, c)))
        if c.PAUSE and RANK[s.rung] > RANK['chat']:
            add(('operator presses Pause', op_pause(s, c)))
        if c.OP_UP and s.rung != 'full':
            add(('operator steps the rung up to full', s._replace(rung='full', ops=s.ops - 1)))
    if s.revokes > 0 and s.grant == 'live':
        add(('operator revokes the grant', op_revoke(s, c)))
    if s.rebinds > 0 and s.alive == 'down':
        add(('operator rebinds the Overlord', op_rebind(s, c)))
    if s.auth is not None and s.auth.rolled:
        add(('operator confirms the restore', s._replace(auth=s.auth._replace(rolled=False))))
    return out


def op_answer(s, i, rv, c, stale=False):
    q = s.qs[i]
    ns = s
    if q.kind in ASKS:
        if not q.effects:
            ns = add_effect(ns, i, 'operator', rv, c)       # the press lands in the dialog
    else:
        ns = add_effect(ns, i, 'operator', rv, c)           # the answer mails the coordinator
    q = ns.qs[i]
    if not stale:
        q = q._replace(rev=q.rev + 1)
    ns = setq(ns, i, q)
    if q.st == 'o':
        ns = close(ns, i, 'operator')
    acts = tuple(a._replace(st='superseded') if (a.q == i and a.st == 'staged') else a for a in ns.acts)
    ns = ns._replace(acts=acts)
    ns = brk_void(ns, i)
    return ns


def op_lower(s, r, c):
    ns = s._replace(rung=r, ops=s.ops - 1)
    # `off` is one transaction: holds released (grouped push); pending acts settled by measuring.
    return ns       # normalize() applies the retention table in the same transaction


def op_pause(s, c):
    ns = s._replace(rung='chat', ops=s.ops - 1)
    for i, q in enumerate(ns.qs):
        if standing(q) and q.phase is None:
            if c.PAUSE_REACH == 'per-row':
                ns = release(ns, i, 'paused', c)
            else:
                ns = setq(ns, i, q._replace(outcome='paused-into-brief'))
    return ns


def op_revoke(s, c):
    # A staged act is voided by the commit's re-check (§7.2 'The commit re-checks'), not here.
    ns = s._replace(grant='revoked', revokes=s.revokes - 1)
    if ns.auth is not None:
        ns = ns._replace(auth=ns.auth._replace(jgrant='revoked', truth=('revoked',) + ns.auth.truth[1:]))
    return ns


def op_rebind(s, c):
    """§3.1: one transaction raises the term, releases standing holds by the retention table,
    re-targets mail and latches every grant."""
    ns = s._replace(term=s.term + 1, rebinds=s.rebinds - 1,
                    grant='suspended' if s.grant == 'live' else s.grant)
    for i, q in enumerate(ns.qs):
        if standing(q) and q.phase is None:
            ns = release(ns, i, 'rebind', c)
    return ns


# --------------------------------------------------------------------------------------
# I7: authority journal, snapshot and restore (§7.6)
# --------------------------------------------------------------------------------------

GW = {'live': 2, 'shadow': 1, 'suspended': 0, 'revoked': 0, 'expired': 0, 'none': 0}


def auth_events(s, c):
    out = []
    a = s.auth
    if s.up and not s.boot and a.cont is None and s.ops > 0:
        # Authority changes: journal record appended first, then the row (two writes).
        if s.grant == 'live':
            out.append(('authority: journal appends "grant revoked"',
                        s._replace(ops=s.ops - 1, auth=a._replace(jgrant='revoked', jepoch=a.jepoch + 1,
                                                                   cont=('grant', 'revoked')))))
        if s.grant in ('revoked', 'suspended'):
            out.append(('authority: journal appends "grant live" (operator re-arms)',
                        s._replace(ops=s.ops - 1, auth=a._replace(jgrant='live', jepoch=a.jepoch + 1,
                                                                   cont=('grant', 'live')))))
        if s.rung != 'chat':
            out.append(('authority: journal appends "rung chat"',
                        s._replace(ops=s.ops - 1, auth=a._replace(jrung='chat', jepoch=a.jepoch + 1,
                                                                   cont=('rung', 'chat')))))
    if s.up and a.cont is not None:
        f, v = a.cont
        ns = s._replace(**({'grant': v} if f == 'grant' else {'rung': v}))
        ep = a.repoch + 1
        truth = (v, a.truth[1], a.truth[2]) if f == 'grant' else (a.truth[0], v, a.truth[2])
        out.append(('authority: row committed (the operator is told it took effect)',
                    ns._replace(auth=a._replace(cont=None, repoch=ep, truth=truth,
                                                wepoch=a.wepoch if c.WITNESS_LAG else max(a.wepoch, ep)))))
    if s.up and a.wepoch < a.repoch and a.cont is None and c.WITNESS_LAG:
        # §7.6: 'The server sends its authority epoch to every agent and every signed-in console.'
        # Delivery is a separate event: a witness may be offline when a change commits.
        out.append(('a witness (agent or console) learns epoch %d' % a.repoch,
                    s._replace(auth=a._replace(wepoch=a.repoch))))
    if s.up and a.snap is None and not s.boot:
        snap = (s.grant, s.rung, s.term, a.repoch, a.jgrant, a.jrung, a.jterm, a.jepoch)
        out.append(('backup: snapshot of coord.db (and the volume)', s._replace(auth=a._replace(snap=snap))))
    if not s.up and a.snap is not None and c.RESTORES > 0 and a.snap != 'used':
        g, r, tm, ep, jg, jr, jt, je = a.snap
        out.append(('RESTORE coord.db from the snapshot (journal file kept)',
                    s._replace(grant=g, rung=r, term=tm, auth=a._replace(repoch=ep, snap='used'))))
        out.append(('RESTORE the whole volume from the snapshot (journal too)',
                    s._replace(grant=g, rung=r, term=tm,
                               auth=a._replace(repoch=ep, jgrant=jg, jrung=jr, jterm=jt, jepoch=je, snap='used'))))
    return out


def boot_coherence(s, c):
    """Table 7.6a and 'After a restore'."""
    a = s.auth
    rows = (s.grant, s.rung, s.term)
    jour = (a.jgrant, a.jrung, a.jterm)
    trail = a.jepoch == a.repoch + 1
    if trail and rows != jour:
        # one trailing record with no row: roll forward if it narrows, drop if it widens
        if GW[a.jgrant] < GW[s.grant] or RANK[a.jrung] < RANK[s.rung]:
            return s._replace(grant=a.jgrant, rung=a.jrung,
                              auth=a._replace(repoch=a.jepoch, truth=(a.jgrant, a.jrung, a.truth[2]),
                                              wepoch=a.wepoch if c.WITNESS_LAG else max(a.wepoch, a.jepoch)))
        return s._replace(auth=a._replace(jgrant=s.grant, jrung=s.rung, jepoch=a.repoch,
                                          truth=(s.grant, s.rung, a.truth[2])))
    restored = (rows != jour) or (a.repoch < a.wepoch) or (a.jepoch != a.repoch)
    if c.MUTATION == 'no_restore_detection':
        restored = False
    if not restored:
        return s
    g = s.grant if GW[s.grant] <= GW[a.jgrant] else a.jgrant
    r = s.rung if RANK[s.rung] <= RANK[a.jrung] else a.jrung
    if g == 'live':
        g = 'suspended'
    term = max(s.term, a.jterm) + 1
    return s._replace(grant=g, rung=r, term=term, latch='chat',
                      auth=a._replace(jgrant=g, jrung=r, jterm=term, rolled=True,
                                      repoch=max(a.repoch, a.wepoch) + 1, jepoch=max(a.repoch, a.wepoch) + 1,
                                      wepoch=max(a.repoch, a.wepoch) + 1))
