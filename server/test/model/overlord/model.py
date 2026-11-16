"""Explicit-state model of the Overlord's hold, readiness, generation and push machines.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md, the merged edition. Section numbers in
comments refer to that edition. Every default below was checked against it: the record is W0-27, "The first
model, re-run on the merged edition", in docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md.
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
    # ---- W1: the authority journal, the witness and Confirm the restore (plan w1-authority-journal, Task 1) --------
    AUTH_W1=False,         # the switch: False leaves every W0 scenario exactly as it was; True replaces W0's A tuple
                           # (auth_events, boot_coherence, i7, i7t, the W0 Confirm) with AW and the W1 events below
    W1_CHANGES=0,          # operator authority doors taken (rung down or up, latch raise or clear), every outcome
    PRIVACY_RECORDS=0,     # records appended to the privacy journal (a second term of the epoch, Q7)
    DAMAGES=0,             # the authority file damaged past the torn-tail heal while the server is down (Q17)
    W1_EXCHANGES=3,        # witness exchanges (each a separate event, with a witness of the scenario's choosing)
    CONFIRMS=0,            # Confirm the restore, taken by the operator (Q13, Q17, F5)
    POST_APPEND_FAILS=0,   # the row's transaction fails after the record was appended, server keeps running (Q1, F1)
    APPEND_FAILS=0,        # an append refused or failed on a coherent journal, under an operator narrowing (X3b)
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
    CARD_DOOR_SKIPS='table',    # 'table' (§11.2: skip 3,4,6,8,9) | 'literal' (an earlier draft's §11.2: skip 3,4,6)
    CARD_LISTS_HOLDS=True,      # False: the card holds only §3.3.3's list, which names no holds
    PAUSE_REACH='per-row',      # 'per-row' | 'brief-only' (released "into a handover brief")
    STAGING_REACHES=True,       # staging push stamps reachedOperatorAt
    ANSWER_CHECKS_DEADLINE=False,  # the answer door refuses a hold past overlordUntil (§11.2 'Two more refusals' says it does; the scenarios' safe reading sets True)
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
    FAILED_RENEWAL_RETURNS='proven',   # | 'previous' | 'active' (plan review 1902, F3)
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
# W1 (only when AUTH_W1): the authority journal and its witnesses (plan w1-authority-journal Q1-Q17, Table 7.6a).
#   jr      the authority journal file, a tuple of records: ('rung', v, fork), ('latch', v, fork) and
#           ('confirm', rung, latch, epochAtConfirm, privacySeqAtConfirm, restoreGeneration, fork). `fork` is the
#           lineage the record was appended in: a restore followed by an append makes a new one, which is how two
#           histories of equal length are told apart (the head is (sequence, fork)).
#   pj      the privacy journal: a tuple of forks, one per record.
#   head    the head row (sequence, fork), or None; rows: an Overlord row exists (Table 7.6a rows 4 and 5).
#   cont    the volatile continuation of "record appended, row not yet committed": (field, value, narrowing, epoch).
#   mal     the file reads malformed (damaged past the heal, Q17).
#   guard   ('coherent',) | ('rolled-back', cause) | ('unmeasured', why): the guard. `unmeasured` is reached only
#           through an append that failed on a coherent journal (X3b); the model has no other unreadable file or row.
#   nonce   unused beyond a boot count; wit the witnesses (console, same-host agent, other-host agent), each None or the
#           tuple (epoch, base, authorityHead, privacyHead, restoreGeneration, thisBoot). `thisBoot` is the boot nonce
#           reduced to what Q8 reads of it: whether the tuple was sent under the current boot's nonce (a boot clears it
#           on every held tuple, since the nonce differs). answered the witnesses that answered
#           since this boot; lifted whether `no-witness-since-boot` is lifted (Q8); settled the witnesses that had
#           answered when the last Confirm ran (cleared by a restore).
#   pend    narrowings appended and committed, not yet held off the volume (volatile: a crash clears them);
#           told the narrowings the operator was told took effect, (field, value, record epoch) (WH, I7w).
#   snap    a snapshot of the volume; lin the lineage counter (never restored); rst restores left.
#   epdb, gdb  the epoch and the restore generation as a mutation keeps them in coord.db (a restore of the database
#           takes them back); no honest transition reads them.
AW = namedtuple('AW', 'jr pj head rows cont mal guard nonce wit answered lifted settled pend told snap lin rst '
                      'epdb gdb chg prv fail afail dmg cfm exch')
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
    if c.AUTH_W1:
        auth = w1_init(c)
    elif c.RESTORES or c.AUTH_CHANGES:
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
    if s.auth is not None and not cpn and ((s.auth.guard[0] != 'coherent') if c.AUTH_W1 else s.auth.rolled):
        return 'authority-rolled-back'      # W1: a rolled-back or unmeasured guard (Table 11.2, step 3)
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
        if c.AUTH_W1:
            auth = auth._replace(pend=frozenset())     # the door's report of a narrowing is in memory only
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
            ns = boot_w1(ns, c) if c.AUTH_W1 else boot_coherence(ns, c)
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
        out.extend(w1_events(s, c) if c.AUTH_W1 else auth_events(s, c))

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
    """§3.3.11: 'A failure before the first half returns the generation to `active` with a hold-off
    (Table 11.5b) if it was proven, whichever state the renewal began from, and to `degraded` with one
    operator item if it was not.' Three readings (plan review 1902, F3). 'proven', the default and the
    coordinator's ruling (slug failed-renewal-returns-to-active-only-if-proven): active only for a
    generation that has read its
    card and passed its probes, because 'A generation never becomes active without having read its
    card and passed its probes', else degraded. 'active', the sentence alone: always active (X4 finds
    it). 'previous': back to the state the renewal began in."""
    if back_degraded(s.gen, c):
        return gen_to(s, 'degraded', fromdeg=False)
    return gen_to(s, 'active', holdoff=True, fromdeg=False)


def back_degraded(g, c):
    if c.MUTATION == 'back_always_degraded':
        return True
    if c.FAILED_RENEWAL_RETURNS == 'active':
        return False
    if c.FAILED_RENEWAL_RETURNS == 'previous':
        return g.fromdeg
    return not (g.card and g.ok)


def back_label(g, c):
    if back_degraded(g, c):
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
            # The old conversation has ended, so its proof does not carry over (review 1912, F5).
            spent = gen_to(s, 'degraded') if c.MUTATION == 'proof_outlives_conversation' else \
                gen_to(s, 'degraded', card=False, ok=False)
            add(('clearing retries spent after the first half: degraded', spent))
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
    if s.auth is not None and not c.AUTH_W1 and s.auth.rolled:
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


# --------------------------------------------------------------------------------------
# W1: the authority journal, the witness and Confirm the restore (AUTH_W1)
#
# Source: docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md, "Open questions" Q1-Q17, the cross-plan
# rulings X3, X3b, F4 and F5, and Task 4's table (Table 7.6a). Spec section 7.6 is the spec's own text. The model keeps two
# authority fields, the operator rung (s.rung) and the latch cap (s.latch, the operator's raise or the restore-detected
# latch: one row, as the ladder keeps it), because the stricter-of rules and the widening and narrowing doors are
# the same for every field and the other fields (account set, model class, binding) add no new interleaving.
# Every transition here is one transaction or one environment event, as W0's rule says.
# --------------------------------------------------------------------------------------

COHERENT = ('coherent',)
COUNTING = (0, 2)       # the witnesses off the volume: the console and the agent on another host (Q8, Q10)
W_NAMES = ('console', 'same-host agent', 'other-host agent')


def w1_init(c):
    return AW(jr=(), pj=(), head=None, rows=False, cont=None, mal=False, guard=COHERENT, nonce=0,
              wit=(None, None, None), answered=frozenset(), lifted=False, settled=frozenset(),
              pend=frozenset(), told=frozenset(), snap=None, lin=0, rst=c.RESTORES, epdb=0, gdb=0,
              chg=c.W1_CHANGES, prv=c.PRIVACY_RECORDS, fail=c.POST_APPEND_FAILS, afail=c.APPEND_FAILS,
              dmg=c.DAMAGES, cfm=c.CONFIRMS, exch=c.W1_EXCHANGES)


def w1_db(c, v):
    """The two counters only a mutation keeps in coord.db (epoch_in_db, restore_generation_in_db); every other run
    leaves them 0 so they do not split states."""
    return v if c.MUTATION in ('epoch_in_db', 'restore_generation_in_db') else 0


def w1_fold(jr):
    """The journal's view of the fields, trailing record included (what the records say). A field the records
    never mention reads as the widest value, which is what the rows start with."""
    rung, latch = 'full', None
    for r in jr:
        if r[0] == 'rung':
            rung = r[1]
        elif r[0] == 'latch':
            latch = r[1]
        else:
            rung, latch = r[1], r[2]
    return rung, latch


def w1_lastconf(jr):
    for i in range(len(jr) - 1, -1, -1):
        if jr[i][0] == 'confirm':
            return i
    return -1


def w1_base(a):
    ci = w1_lastconf(a.jr)
    return a.jr[ci][3] if ci >= 0 else 0


def w1_gen(a):
    """Q13: the last Confirm record's restore generation, 0 when there is none. The accessor is in the journal."""
    ci = w1_lastconf(a.jr)
    return a.jr[ci][5] if ci >= 0 else 0


def w1_epoch(a, c):
    """Q7 epoch-derived-from-heads: the last Confirm's epochAtConfirm, plus the authority records and the privacy
    records after it; with no Confirm, the base is 0 and the terms are the two sequences."""
    if c.MUTATION == 'epoch_in_db':
        return a.epdb                    # a store inside coord.db, which a snapshot carries
    ci = w1_lastconf(a.jr)
    if ci < 0:
        return len(a.jr) + len(a.pj)
    r = a.jr[ci]
    return r[3] + (len(a.jr) - ci - 1) + (len(a.pj) - r[4])


def w1_tuple(a, c):
    """The tuple the server sends a witness (Task 5): epoch, base, the two heads, the generation, the boot."""
    ah = (len(a.jr), a.jr[-1][-1]) if a.jr else None
    ph = (len(a.pj), a.pj[-1]) if a.pj else None
    return (w1_epoch(a, c), w1_base(a), ah, ph, w1_gen(a), True)


def w1_verdict(a):
    """Task 4, the decider's table (Table 7.6a), first match. The model has no unreadable file or row, so the two
    `unmeasured` rows (1 and 2) are reached only through the X3b append failure, not through the decider."""
    if a.mal:
        return 'malformed'                                     # row 3
    n = len(a.jr)
    if n == 0:
        return 'coherent' if (a.head is None and not a.rows) else 'missing'    # rows 4 and 5
    if a.head is None:
        return 'trailing' if n == 1 else 'ahead'                # rows 8 and 9 with no head row
    hs, hf = a.head
    if hs <= n and a.jr[hs - 1][-1] != hf:
        return 'diverged'                                        # row 7
    if n == hs:
        return 'coherent'                                        # row 6
    if n == hs + 1:
        return 'trailing'                                        # row 8
    if n > hs + 1:
        return 'ahead'                                           # row 9
    return 'behind'                                              # row 10


def w1_to_rb(s, cause):
    """The guard's move off `coherent` or `unmeasured` (writerFailed, witnessRefused; a rolled-back guard stays as it
    is). The first move out of coherent raises the restore-detected latch, a row, row-only while the journal is not
    coherent (F4, Q9): a narrowing, which the model writes as the latch row."""
    a = s.auth
    if a.guard[0] == 'rolled-back':
        return s
    ns = s._replace(auth=a._replace(guard=('rolled-back', cause)))
    if ns.latch is None:
        ns = ns._replace(latch='chat', auth=ns.auth._replace(rows=True))
    return ns


def w1_apply(s, f, v):
    ns = s._replace(**{f: v})
    return ns._replace(auth=ns.auth._replace(rows=True))


def w1_settle(s, c):
    """WH: a narrowing is reported done (told) only when a counting witness holds an epoch at or above its record's.
    The counting witnesses are the console and the agent on another host; the same-host agent never counts (Q10)."""
    a = s.auth
    idx = (0, 1, 2) if c.MUTATION == 'same_host_agent_counts' else COUNTING
    pend, told = set(a.pend), set(a.told)
    for e in list(pend):
        if any(a.wit[i] is not None and a.wit[i][0] >= e[2] for i in idx):
            pend.discard(e)
            told.add(e)
    return s._replace(auth=a._replace(pend=frozenset(pend), told=frozenset(told)))


def boot_w1(s, c):
    """Q6 restore-fences-doors-not-boot, Task 4: the boot step records its verdict in the guard and the server starts.
    A rollback only a witness found is in memory, so it is not re-found here."""
    a = s.auth
    v = w1_verdict(a)
    guard = COHERENT if v == 'coherent' else ('rolled-back', v)
    wit = tuple(None if w is None else w[:5] + (False,) for w in a.wit)
    ns = s._replace(auth=a._replace(guard=guard, wit=wit, answered=frozenset(), lifted=False,
                                    pend=frozenset(), cont=None))
    if v != 'coherent' and ns.latch is None:
        ns = ns._replace(latch='chat', auth=ns.auth._replace(rows=True))    # F4: the boot step raises the latch
    return ns


def w1_doors(s):
    """The operator's doors: (field, value, narrowing)."""
    out = []
    for v in ('advise', 'chat', 'off'):
        if v in RUNG_TARGETS_W1 and RANK[v] < RANK[s.rung]:
            out.append(('rung', v, True))
    if s.latch is None:
        out.append(('latch', 'chat', True))
    if s.rung != 'full':
        out.append(('rung', 'full', False))
    if s.latch is not None:
        out.append(('latch', None, False))
    return out


RUNG_TARGETS_W1 = ('advise', 'chat', 'off')   # narrowed by the scenario's RUNG_TARGETS in w1_events


def w1_events(s, c):
    out = []
    a = s.auth
    m = c.MUTATION
    live = s.up and not boot_blocking(s, c)
    idle = live and a.cont is None
    g = a.guard[0]
    verdict = w1_verdict(a)

    # ---- the operator's doors (Q1, Q9, X3, X3b) -------------------------------------------------------------------
    if idle and a.chg > 0:
        for f, v, narrow in w1_doors(s):
            if f == 'rung' and v not in ('full',) and v not in c.RUNG_TARGETS:
                continue
            if f == 'rung' and v == 'full' and not c.OP_UP:
                continue
            word = '%s %s' % (f, v)
            ns0 = s._replace(auth=a._replace(chg=a.chg - 1))
            if g == 'coherent' and verdict == 'coherent':
                # Q1: the writer appends the record, then the caller's row commits in the same transaction. Two
                # transitions, joined by the continuation, which a crash clears.
                rec = (f, v, a.lin)
                jr2 = a.jr + (rec,)
                ep = w1_epoch(a._replace(jr=jr2, epdb=a.epdb + 1), c)
                out.append(('operator %s: the journal appends the %s record (row not yet committed)'
                            % ('narrows' if narrow else 'widens', word),
                            ns0._replace(auth=ns0.auth._replace(jr=jr2, cont=(f, v, narrow, ep)))))
                if narrow and a.afail > 0:
                    # X3b: an append that fails on a coherent journal writes the row only; the guard leaves coherent.
                    na = ns0.auth._replace(afail=a.afail - 1)
                    if m == 'narrowing_refused_on_append_failure':
                        out.append(('REFUSED narrowing %s: the append failed (the rule X3b withdrew)' % word,
                                    s._replace(auth=a._replace(chg=a.chg - 1, afail=a.afail - 1))))
                    else:
                        ns = w1_apply(ns0._replace(auth=na), f, v)
                        ns = ns._replace(auth=ns.auth._replace(guard=('unmeasured', 'journal')))
                        if ns.latch is None:
                            ns = ns._replace(latch='chat')
                        out.append(('operator narrows %s: the append fails, the row lands alone, the guard leaves '
                                    'coherent (X3b)' % word, ns))
            elif g == 'coherent':
                # Only a mutated guard reaches this: the writer re-reads the file and finds it incoherent (Q1).
                if narrow:
                    ns = w1_to_rb(w1_apply(ns0, f, v), verdict)
                    out.append(('operator narrows %s: the writer finds the journal %s, the row lands alone'
                                % (word, verdict), ns))
                else:
                    out.append(('operator widens %s: the writer finds the journal %s and refuses'
                                % (word, verdict), w1_to_rb(ns0, verdict)))
            elif narrow:
                if m == 'narrowing_refused_while_incoherent':
                    out.append(('REFUSED narrowing %s while the journal is incoherent (the strict rule)' % word,
                                ns0))
                elif m == 'append_over_incoherent' and verdict == 'trailing':
                    # The old shape: the writer appends over the trailing record, so the head row moves level with
                    # the file, and its apply step writes the journal's fold, trailing record included.
                    jr2 = a.jr + ((f, v, a.lin),)
                    fr, fl = w1_fold(jr2)
                    ns = ns0._replace(rung=fr, latch=fl,
                                      auth=ns0.auth._replace(jr=jr2, head=(len(jr2), a.lin), rows=True))
                    out.append(('operator narrows %s: the writer appends over a trailing record' % word, ns))
                else:
                    # Q9 / X3: a narrowing while the journal is not coherent writes its row only; no append, and
                    # the head row does not move.
                    out.append(('operator narrows %s while the journal is incoherent: row only (X3)' % word,
                                w1_apply(ns0, f, v)))
            # a widening over a non-coherent guard is refused authority-rolled-back: no transition (the door says no)

    # ---- the row commit, or its failure after the append (Q1, F1) ---------------------------------------------------
    if s.up and a.cont is not None:
        f, v, narrow, ep = a.cont
        ns = w1_apply(s, f, v)
        na = ns.auth
        pend = set(na.pend)
        told = set(na.told)
        if narrow:
            pend.add((f, v, ep))
        else:
            pend = {e for e in pend if e[0] != f}
            told = {e for e in told if e[0] != f}
        na = na._replace(cont=None, head=(len(na.jr), na.jr[-1][-1]), pend=frozenset(pend), told=frozenset(told),
                         epdb=w1_db(c, ep))
        ns = w1_settle(ns._replace(auth=na), c)
        out.append(('row committed: %s %s' % (f, v), ns, {'w1': 'narrow' if narrow else 'widen'}))
        if a.fail > 0:
            nf = s._replace(auth=a._replace(cont=None, fail=a.fail - 1))
            if m != 'writer_failure_unfenced':
                # F1: the writer calls writerFailed('trailing') at once, writer-side. A caller's own row or commit that
                # fails after the writer answered is seen only at the next append or boot (trailing-narrowing-window,
                # review 2219 F3); the model does not explore that window.
                nf = w1_to_rb(nf, 'trailing')
            out.append(('the row fails after the append: the transaction rolls back, the record stays, the '
                        'server keeps running (F1)', nf))

    # ---- a privacy record (Q7, Q11) ---------------------------------------------------------------------------------
    if idle and a.prv > 0:
        out.append(('a privacy record is appended',
                    s._replace(auth=a._replace(pj=a.pj + (a.lin,), prv=a.prv - 1, epdb=w1_db(c, a.epdb + 1)))))

    # ---- a witness exchange, each witness separately, any order (Q8, Q10, Task 5's table) ---------------------------
    if idle and not a.mal and g != 'unmeasured' and a.exch > 0:
        for i in range(3):
            out.append(w1_exchange(s, i, c))

    # ---- the door re-measures an `unmeasured` guard (Task 4) ---------------------------------------------------------
    if idle and g == 'unmeasured':
        if verdict == 'coherent':
            out.append(('the door re-measures the journal: coherent', s._replace(auth=a._replace(guard=COHERENT))))
        else:
            out.append(('the door re-measures the journal: %s' % verdict, w1_to_rb(s, verdict)))

    # ---- the file damaged past the heal (Q17), found at the next boot ------------------------------------------------
    if not s.up and a.dmg > 0 and not a.mal and a.jr:
        out.append(('the journal file is damaged past the heal', s._replace(auth=a._replace(mal=True, dmg=a.dmg - 1))))

    # ---- snapshot and restores ---------------------------------------------------------------------------------------
    if idle and a.snap is None:
        snap = (s.rung, s.latch, a.rows, a.head, a.epdb, a.gdb, a.jr, a.pj, a.wit[1])
        out.append(('backup: snapshot of the volume', s._replace(auth=a._replace(snap=snap))))
    if not s.up and a.snap is not None and a.rst > 0:
        rg, la, rw, hd, ed, gd, jr, pj, ag = a.snap
        base = s._replace(rung=rg, latch=la,
                          auth=a._replace(rows=rw, head=hd, epdb=ed, gdb=gd, lin=a.lin + 1, rst=a.rst - 1,
                                          settled=frozenset()))
        out.append(('W1 RESTORE coord.db alone from the snapshot (journal file and witnesses stay)', base))
        whole = base._replace(auth=base.auth._replace(jr=jr, pj=pj, mal=False,
                                                      wit=(a.wit[0], ag, a.wit[2])))
        out.append(('W1 RESTORE the whole volume from the snapshot (rows, head row, journal and the same-host '
                    'agent come back)', whole))

    # ---- Confirm the restore (Q7, Q13, Q17, F5, Task 8) --------------------------------------------------------------
    if idle and a.cfm > 0 and g != 'unmeasured':
        if g == 'coherent' and verdict == 'coherent':
            pass                                    # nothing waits: no transition (answers changed:false)
        elif g == 'coherent' and m == 'writer_failure_unfenced':
            out.append(('Confirm answers changed:false, nothing waits (decided from the guard alone)',
                        s._replace(auth=a._replace(cfm=a.cfm - 1))))
        elif not (a.mal and m == 'no_confirm_over_malformed'):
            out.append(w1_confirm(s, c))
    return out


def w1_exchange(s, i, c):
    """One witness exchange (Task 5's table, first match): the verdict, what the witness keeps, what it counts."""
    s = s._replace(auth=s.auth._replace(exch=s.auth.exch - 1))
    a = s.auth
    m = c.MUTATION
    T = w1_tuple(a, c)
    H = a.wit[i]
    ans = a.answered | {i}

    def put(t):
        w = list(a.wit)
        w[i] = t
        return tuple(w)

    nm = W_NAMES[i]
    if H is None:                                                        # row 2: no-witness; it takes the tuple
        ns = s._replace(auth=a._replace(wit=put(T), answered=ans))
        return ('W1 exchange with the %s: it holds nothing and takes the tuple' % nm, w1_settle(ns, c),
                {'w1x': (i, 'no-witness')})
    if H[1] < T[1]:                                                      # row 4: stale (its base is below)
        ns = s._replace(auth=a._replace(wit=put(T), answered=ans))
        return ('W1 exchange with the %s: stale, it takes the tuple' % nm, w1_settle(ns, c),
                {'w1x': (i, 'stale')})
    cause = None
    if H[1] > T[1] or H[0] > T[0]:                                       # row 5: its epoch is higher
        cause = 'witness-epoch'
    elif m != 'heads_not_checked':                                       # row 6: a head it holds is not held
        if H[2] is not None and not (H[2][0] <= len(a.jr) and a.jr[H[2][0] - 1][-1] == H[2][1]):
            cause = 'witness-heads'
        elif H[3] is not None and not (H[3][0] <= len(a.pj) and a.pj[H[3][0] - 1] == H[3][1]):
            cause = 'witness-heads'
    if cause is not None:
        ns = w1_to_rb(s._replace(auth=a._replace(answered=ans)), cause)
        return ('W1 exchange with the %s: refused, %s' % (nm, cause), ns, {'w1x': (i, 'refused', cause)})
    # row 7: consistent. It counts only off the volume, and only from an earlier boot (Q8).
    counts = (i in COUNTING or (m == 'same_host_agent_counts' and i == 1)) and \
        (not H[5] or m == 'this_boot_witness_counts')
    keep = T if H[0] < T[0] else H
    ns = s._replace(auth=a._replace(wit=put(keep), answered=ans, lifted=a.lifted or counts))
    return ('W1 exchange with the %s: consistent%s' % (nm, ', and it counts' if counts else ''), w1_settle(ns, c),
            {'w1x': (i, 'consistent', counts)})


def w1_confirm(s, c):
    """The operator's Confirm the restore (Task 8). Appends the Confirm record first (F5), then writes the stricter
    values (X3). Over a malformed file it starts a new chain (Q17)."""
    a = s.auth
    m = c.MUTATION
    ans = [a.wit[i] for i in a.answered if a.wit[i] is not None]
    verdict = w1_verdict(a)
    if a.mal:
        bound = len(a.jr)
        ep_floor, gen_floor = bound, bound
        fr, fl = 'off', None                         # Q17: the journal side reads as the narrowest value
        base_chain, lin = (), a.lin + 1
    else:
        ep_floor, gen_floor = w1_epoch(a, c), w1_gen(a)
        fr, fl = w1_fold(a.jr)
        base_chain, lin = a.jr, a.lin
    # Q13: the epoch and the generation each above the journal's own and every answered witness's.
    ep = (ep_floor if m == 'confirm_no_epoch_raise' else max([ep_floor] + [t[0] for t in ans])) + 1
    if m == 'generation_ignores_witnesses':
        gen = gen_floor + 1
    elif m == 'restore_generation_in_db':
        gen = a.gdb + 1
    else:
        gen = max([gen_floor] + [t[4] for t in ans]) + 1
    # Task 8's stricter-of table: the lower rung, the union of latches (F4: the standing latch is not lifted).
    rung = s.rung if RANK[s.rung] <= RANK[fr] else fr
    latch = 'chat' if (s.latch or fl) else None
    if m != 'confirm_ignores_told':
        # told-narrowings-survive-confirm (the coordinator's ruling for PR B and PR C): an off-volume witness carries the
        # newest narrowing state the operator was told took effect, and Confirm takes the narrowest of the restored rows,
        # the journal and that witness. The model reads it from every witness that answered since boot and holds an
        # epoch at or above the narrowing's record (the witness that made it `told`, WH).
        for f, v, e in a.told:
            if not any(i in a.answered and a.wit[i] is not None and a.wit[i][0] >= e for i in COUNTING):
                continue
            if f == 'rung' and RANK[v] < RANK[rung]:
                rung = v
            elif f == 'latch':
                latch = 'chat'
    if m == 'trailing_widening_applied' and verdict == 'trailing':
        r = a.jr[-1]
        if r[0] == 'rung':
            rung = r[1]
        elif r[0] == 'latch':
            latch = r[1]
    rec = ('confirm', rung, latch, ep, len(a.pj), gen, lin)
    jr2 = base_chain + (rec,)
    ns = s._replace(rung=rung, latch=latch,
                    auth=a._replace(jr=jr2, head=(len(jr2), lin), rows=True, mal=False, guard=COHERENT, cont=None,
                                    cfm=a.cfm - 1, lin=lin, settled=frozenset(a.answered), epdb=w1_db(c, ep), gdb=w1_db(c, gen),
                                    # what the operator was told stays told: Confirm keeps it (I7w, amended by
                                    # told-narrowings-survive-confirm; the plan's first reading dropped it here)
                                    pend=frozenset()))
    return ('operator confirms the restore%s' % (' (over a malformed journal: a new chain)' if a.mal else ''), ns,
            {'w1': 'confirm'})
