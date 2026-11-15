"""Breadth-first search over model.py's state space, checking I1 to I10 (§11.7, Table 11.7a, of
docs/superpowers/specs/2026-11-09-overlord-design.md, the merged edition) and design-relevant deadlocks.
Python 3 standard library only. Section numbers in comments refer to that edition; W0-27, "The first model,
re-run on the merged edition", in docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md, records that
every default was checked against it.

Usage:
  python3 check.py --list
  python3 check.py SCENARIO [KEY=VALUE ...]        # one run; prints violations and traces
  python3 check.py --json SCENARIO [KEY=VALUE ...] # one run; prints one JSON object (exit 3 on the state bound)
  python3 check.py --matrix                         # every scenario x reading, a summary table
  python3 check.py --mutations                      # planted bugs; each must be caught
  python3 check.py --json --mutations               # the same, as one JSON array
"""
import json
import os
import sys
import time
from array import array
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M  # noqa: E402

# --------------------------------------------------------------------------------------
# Invariants. The wording of Table 11.7a is quoted above each predicate.
# --------------------------------------------------------------------------------------


def i1(s, c):
    # I1 "A held row reaches the operator by its deadline, or within one sweep of the first
    # boot after it".  Read: a row that was held and that the Overlord (or the operator) did
    # not settle by its deadline has reachedOperatorAt by then.  i1due is the deadline,
    # moved to the boot time when the server was down across it (model.py, 'server boots';
    # the boot pass is urgent, so 'within one sweep' = before the clock moves on).
    if not s.up:
        return None
    for i, q in enumerate(s.qs):
        if q.held and q.i1due is not None and s.t > q.i1due and q.nreach == 0 and not q.ok:
            return 'q%d was held, its deadline %d passed (now %d), it never reached the operator ' \
                   'and nobody settled it in time (outcome=%s, st=%s)' % (i, q.i1due, s.t, q.outcome, q.st)
    return None


def i2(s, c):
    # I2 "A row that reached the operator has exactly one reach stamp and a sent outbox row".
    # Safety half checked here: exactly one stamp, and an outbox row exists (§6.7: "The reach
    # stamp and one outbox row are written in one transaction"). The 'sent' half is a liveness
    # property, checked as D3 (the row can still be sent without a server crash).
    for i, q in enumerate(s.qs):
        if q.nreach > 1:
            return 'q%d has %d reach stamps' % (i, q.nreach)
        if q.nreach == 1 and not any(o.q == i for o in s.ob):
            return 'q%d reached the operator with no outbox row' % i
    return None


def i3(s, c):
    # I3 "At most one effect per natural key, and every effect has an act row".
    # Natural key = the target row's revision (§10.1 "Two keys").
    for i, q in enumerate(s.qs):
        seen = {}
        for actor, nk in q.effects:
            seen.setdefault(nk, []).append(actor)
        for nk, actors in seen.items():
            if len(actors) > 1:
                return 'q%d has %d effects on natural key (rev) %d: %s' % (i, len(actors), nk, actors)
        for actor, nk in q.effects:
            if actor in ('overlord', 'returned'):
                if not any(a.q == i and a.nk == nk and a.st in ('pending', 'done', 'effective', 'unknown')
                           for a in s.acts):
                    return 'q%d has an Overlord effect at rev %d with no live act row' % (i, nk)
    return None


def i6_lineage(s):
    out = {}
    for q in s.qs:
        if q.st != 'u':
            out[q.lin] = q.cls
    return out


def i7(s, c):
    # I7 "After a restore, no authority field is wider than the journal's".
    # Reading A: the journal file as it stands after the restore.
    a = s.auth
    if a is None or not s.up or s.boot or a.cont is not None or a.snap != 'used':
        return None
    if M.GW[s.grant] > M.GW[a.jgrant]:
        return 'grant %s is wider than the journal (%s)' % (s.grant, a.jgrant)
    if M.RANK[M.eff_rung(s)] > M.RANK[a.jrung]:
        return 'rung %s is wider than the journal (%s)' % (M.eff_rung(s), a.jrung)
    if s.term < a.jterm:
        return 'term %d is older than the journal (%d)' % (s.term, a.jterm)
    return None


def i7t(s, c):
    # I7, reading B: "the journal's" = every authority change the operator was told committed,
    # which a restore of the whole volume can take away with the journal file.
    a = s.auth
    if a is None or not s.up or s.boot or a.cont is not None or a.snap != 'used':
        return None
    tg, tr, tt = a.truth
    if M.GW[s.grant] > M.GW[tg]:
        return 'grant %s is wider than the authority the operator last set (%s)' % (s.grant, tg)
    if M.RANK[M.eff_rung(s)] > M.RANK[tr]:
        return 'rung %s is wider than the rung the operator last set (%s)' % (M.eff_rung(s), tr)
    return None


def shown(s, i):
    return 1 if any(o.q == i and o.sent and not o.silent for o in s.ob) else 0


def i9(s, c):
    # I9 "While `mayHold` is false, pushes and row states equal those of a build without the
    # Overlord". Compared per row whose spec mayHold was false (it was never held), once its
    # outbox is drained (the sender's lag is not a difference in what is pushed).
    total_extra = 0
    for i, q in enumerate(s.qs):
        if q.st == 'u' or q.mhspec or q.phase is not None:
            continue
        if any(o.q == i and not o.sent for o in s.ob):
            continue
        if shown(s, i) != q.base:
            return 'q%d (%s, %s): %d notification(s) shown, a build without the Overlord shows %d' % (
                i, q.kind, 'blocking' if q.blk else 'non-blocking', shown(s, i), q.base)
        if q.st == 'c' and q.closed_by != 'operator':
            return 'q%d was closed by %s, not by the operator' % (i, q.closed_by)
    if c.I9_SCOPE == 'all':
        if any(o.q == -1 and o.sent for o in s.ob) and all((q.st == 'u' or not q.mhspec) for q in s.qs):
            return 'the dead-Overlord push was shown; a build without the Overlord sends none'
    return None


def i10(s, c):
    # I10 "Every open row is on the operator's list at all times". §6.7: "A hold delays the
    # push, never the row. A held row stays on Waiting on you, in a collapsed group".
    for i, q in enumerate(s.qs):
        if q.st == 'o' and not on_list(q, c):
            return 'q%d is open and not on the list' % i
    return None


def on_list(q, c):
    if c.MUTATION == 'held_rows_hidden':
        return q.st == 'o' and not M.standing(q)
    return q.st == 'o'          # held rows are drawn in the collapsed group


def x1(s, c):
    # Extra: an ask's recorded answer is the answer the child received.
    for i, q in enumerate(s.qs):
        if q.kind in M.ASKS and q.st == 'c' and q.closed_by == 'operator' and q.effects:
            # Only a tap made at the same revision the Overlord's answer used (its natural key):
            # a tap made with the Overlord's answer in view is an overturn (§10.3), not a race.
            if q.effects[0][0] == 'overlord' and q.effects[0][1] == q.rev - 1:
                return 'q%d records the %s as answering, but the dialog received the %s\'s press' % (
                    i, q.closed_by, q.effects[0][0])
    return None


def x4(s, c):
    # Extra: §3.3.8 "Every start enters at `carded`. The session reads its card and passes its
    # probes before it acts." A generation is active only after both.
    if s.gen.st == 'active' and not (s.gen.card and s.gen.ok):
        return 'generation %d is active with %s' % (s.gen.n, 'its card unread' if not s.gen.card else
                                                     'its probes not passed')
    return None


STATE_CHECKS = [('I1', i1), ('I2', i2), ('I3', i3), ('I7', i7), ('I7t', i7t), ('I9', i9), ('I10', i10), ('X1', x1), ('X4', x4)]


def trans_checks(s, lbl, info, s2, c):
    out = []
    if info:
        w = info.get('accepted_write')
        if w is not None:
            # I5 "A write is accepted only from the current term, generation and act key".
            # 'generation' = one conversation (§3.3.1 "One word").
            term, n, kok, conv = w
            if term != s.term or n != s.gen.n or not kok or conv != s.gen.conv:
                out.append(('I5', 'write accepted from term %d, generation %d, conversation %d; '
                                  'current term %d, generation %d minted for conversation %d'
                            % (term, n, conv, s.term, s.gen.n, s.gen.conv)))
        ac = info.get('act_commit')
        if ac is not None:
            kind, i, auth = ac
            q = s.qs[i]
            # I4 "Every act of a class other than none commits with a live grant in scope, a
            # consumed command for its proposal, or a request bound to an operator message".
            if q.cls and auth != 'grant-staged':
                if not (auth == 'grant' and s.grant == 'live'):
                    out.append(('I4', '%s on q%d (class %s) committed on authority %r with grant %s'
                                % (kind, i, sorted(q.cls), auth, s.grant)))
        card = info.get('card')
        if card is not None:
            # I8 "After a crash at any step, the next card lists every unsettled message and open hold".
            need = set()
            if s.msg == 'unsettled':
                need.add('msg')
            need |= {'q%d' % i for i, q in enumerate(s.qs) if M.standing(q)}
            miss = need - set(card)
            if miss:
                out.append(('I8', 'card for generation %d omits %s' % (s.gen.n, sorted(miss))))
    # I6 "A lineage's class never loses a member".
    a, b = i6_lineage(s), i6_lineage(s2)
    for lin, cl in a.items():
        if lin in b and not cl <= b[lin]:
            out.append(('I6', 'lineage %d lost %s (was %s, now %s)' % (lin, sorted(cl - b[lin]),
                                                                       sorted(cl), sorted(b[lin]))))
    # Extra X5: §3.3.3 "Until this generation has read the current hash ... no hold is taken for it."
    for i, (q1, q2) in enumerate(zip(s.qs, s2.qs)):
        if q2.held and not q1.held and not s2.gen.card:
            out.append(('X5', 'a hold was taken on q%d while generation %d has not read its card'
                        % (i, s2.gen.n)))
    # Extra X6 (review 1912, F5; review 1920, R3; reworded for review 1925, N5): a renewal begun in degraded never returns
    # to active. A degraded generation is never proven: one that timed out in carded or failed its probes never read its
    # card and passed a round, one sent back() unproven never was proven, and one that degraded after the first half lost
    # its proof with its conversation. So a failure before the first half returns it to degraded; only probes passing in a
    # new generation reach active.
    if s.gen.fromdeg and s.gen.st in ('draining', 'checkpointed', 'clearing') and s2.gen.st == 'active' and \
            s2.gen.n == s.gen.n:
        out.append(('X6', 'generation %d returned to active from a renewal begun in degraded (%s)' % (s.gen.n, lbl)))
    # Extra X2: no Overlord effect lands on a row that has already reached the operator.
    for i, (q1, q2) in enumerate(zip(s.qs, s2.qs)):
        if lbl.startswith('effect lands') and len(q2.effects) > len(q1.effects) and \
                q2.effects[-1][0] == 'overlord' and q1.nreach > 0:
            out.append(('X2', 'an Overlord answer landed on q%d after it reached the operator' % i))
    return out


# --------------------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------------------

CAT_OTHER, CAT_OPANS, CAT_CRASH = 0, 1, 2


def cat(lbl):
    if lbl.startswith('operator answers') or lbl.startswith('operator taps'):
        return CAT_OPANS
    if lbl.startswith('SERVER CRASH'):
        return CAT_CRASH
    return CAT_OTHER


def explore(c, max_states=3_000_000, keep_edges=True, stop_on=None):
    s0 = M.init_state(c)
    ids = {s0: 0}
    states = [s0]
    parent = array('i', [-1])
    plabel = ['init']
    src, dst, ecat = array('i'), array('i'), array('b')
    viol = {}       # name -> (state id, message, transition label or None)
    q = deque([0])
    ntrans = 0
    t0 = time.time()
    while q:
        sid = q.popleft()
        s = states[sid]
        for name, f in STATE_CHECKS:
            if name not in viol:
                m = f(s, c)
                if m:
                    viol[name] = (sid, m, None)
        for lbl, s2, info in M.successors(s, c):
            ntrans += 1
            for name, m in trans_checks(s, lbl, info, s2, c):
                if name not in viol:
                    # record the target state, reached through this edge
                    viol[name] = ('edge', sid, lbl, s2, m)
            nid = ids.get(s2)
            if nid is None:
                nid = len(states)
                ids[s2] = nid
                states.append(s2)
                parent.append(sid)
                plabel.append(lbl)
                q.append(nid)
                if len(states) > max_states:
                    raise RuntimeError('state bound exceeded')
            if keep_edges:
                src.append(sid)
                dst.append(nid)
                ecat.append(cat(lbl))
    return dict(states=states, ids=ids, parent=parent, plabel=plabel, src=src, dst=dst, ecat=ecat,
                viol=viol, ntrans=ntrans, secs=time.time() - t0)


def path_to(g, sid):
    p = []
    while sid != -1:
        p.append(sid)
        sid = g['parent'][sid]
    return list(reversed(p))


def fmt_state(s):
    gq = []
    for i, q in enumerate(s.qs):
        if q.st == 'u':
            continue
        gq.append('q%d[%s %s cls=%s rev=%d until=%s out=%s reach=%d %s%s eff=%s]' % (
            i, q.st, q.kind, ','.join(sorted(q.cls)) or 'none', q.rev, q.until, q.outcome, q.nreach,
            ('closed_by=%s ' % q.closed_by) if q.closed_by else '', ('phase=%s ' % (q.phase,)) if q.phase else '',
            list(q.effects)))
    ob = ['%s%s' % ('dead' if o.q == -1 else 'q%d' % o.q, '+' if o.sent else ('~' if o.att else '-')) for o in s.ob]
    acts = ['%s(q%d,nk%d,%s,term%d,gen%d)' % (a.kind, a.q, a.nk, a.st, a.term, a.n) for a in s.acts]
    g = s.gen
    out = 't=%d server=%s%s session=%s conv=%d term=%d gen=%d:%s%s word=%s rung=%s%s grant=%s msg=%s' % (
        s.t, 'up' if s.up else 'DOWN', ('(boot:%s)' % ','.join(sorted(s.boot))) if s.boot else '',
        s.alive, s.conv, s.term, g.n, g.st, '' if g.card else '(card unread)', s.word, s.rung,
        ('(latch %s)' % s.latch) if s.latch else '', s.grant, s.msg)
    out += '\n        ' + ' '.join(gq)
    if ob:
        out += '\n        outbox: ' + ' '.join(ob)
    if acts:
        out += '\n        acts: ' + ' '.join(acts)
    if s.auth is not None:
        a = s.auth
        out += '\n        journal: grant=%s rung=%s term=%d; truth=%s; epochs row/journal/witness=%d/%d/%d%s' % (
            a.jgrant, a.jrung, a.jterm, a.truth, a.repoch, a.jepoch, a.wepoch, ' ROLLED' if a.rolled else '')
    return out


def print_trace(g, sid, extra=None):
    p = path_to(g, sid)
    lines = []
    for k, x in enumerate(p):
        lbl = g['plabel'][x]
        lines.append('%2d. %s\n        %s' % (k, lbl, fmt_state(g['states'][x])))
    if extra is not None:
        lbl, s2 = extra
        lines.append('%2d. %s\n        %s' % (len(p), lbl, fmt_state(s2)))
    return '\n'.join(lines)


# --------------------------------------------------------------------------------------
# Liveness: EF over the explored graph (backward reachability)
# --------------------------------------------------------------------------------------

def backward(g, good, allowed):
    n = len(g['states'])
    src, dst, ec = g['src'], g['dst'], g['ecat']
    # reverse CSR
    cnt = array('i', [0]) * (n + 1)
    for k in range(len(dst)):
        if ec[k] in allowed:
            cnt[dst[k] + 1] += 1
    for k in range(n):
        cnt[k + 1] += cnt[k]
    rev = array('i', [0]) * cnt[n]
    pos = array('i', cnt)
    for k in range(len(dst)):
        if ec[k] in allowed:
            d = dst[k]
            rev[pos[d]] = src[k]
            pos[d] += 1
    mark = bytearray(n)
    dq = deque()
    for k in range(n):
        if good[k]:
            mark[k] = 1
            dq.append(k)
    while dq:
        x = dq.popleft()
        for j in range(cnt[x], cnt[x + 1]):
            y = rev[j]
            if not mark[y]:
                mark[y] = 1
                dq.append(y)
    return mark


def liveness(g, c):
    res = []
    st = g['states']
    n = len(st)
    # D1: a question that can never reach the operator (nor be settled) without the operator
    # happening to answer a row that never pushed. A standing hold counts as safe (I1 covers it).
    for i in range(c.N_Q):
        def goodf(s):
            q = s.qs[i]
            return q.st != 'o' or q.nreach > 0 or M.standing(q) or q.phase is not None or \
                any(a.q == i and a.st in ('pending', 'staged', 'unknown') for a in s.acts)
        good = bytearray(1 if goodf(s) else 0 for s in st)
        mark = backward(g, good, {CAT_OTHER, CAT_CRASH})
        bad = [k for k in range(n) if not mark[k]]
        if bad:
            res.append(('D1', bad[0], 'q%d is open, not held, not reached, with no act in flight, and no '
                                      'sequence of events (other than the operator answering it unprompted) '
                                      'ever pushes it to the operator' % i, len(bad)))
    # D2: the generation machine can always return to `active`.
    good = bytearray(1 if (s.gen.st == 'active' and s.gen.card and s.gen.ok) else 0 for s in st)
    mark = backward(g, good, {CAT_OTHER, CAT_CRASH, CAT_OPANS})
    bad = [k for k in range(n) if not mark[k]]
    # discount states where only the renewal budget (a bound) is spent
    bad_real = [k for k in bad if st[k].ren > 0]
    if bad_real:
        res.append(('D2', bad_real[0], 'generation machine cannot return to active with card read and probes passed '
                                                 '(%d states; %d of them with renewal budget left)'
                    % (len(bad), len(bad_real)), len(bad_real)))
    good = bytearray(1 if s.gen.st in ('active', 'degraded') else 0 for s in st)
    mark = backward(g, good, {CAT_OTHER, CAT_CRASH, CAT_OPANS})
    bad = [k for k in range(n) if not mark[k]]
    if bad:
        res.append(('D2b', bad[0], 'generation machine cannot return to active or degraded', len(bad)))
    # D3: an outbox row that can no longer be sent without a server crash (push service fair).
    for k in range(-1, c.N_Q):
        good = bytearray(0 if any(o.q == k and not o.sent for o in s.ob) else 1 for s in st)
        mark = backward(g, good, {CAT_OTHER, CAT_OPANS})
        bad = [x for x in range(n) if not mark[x]]
        if bad:
            res.append(('D3', bad[0], 'an outbox row for %s is unsent and can be sent again only after a '
                                      'server crash and boot' % ('the dead push' if k == -1 else 'q%d' % k),
                        len(bad)))
            break
    return res


# --------------------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------------------

# The baseline reading of every switch: the reading that the model found to keep every
# invariant. The matrix flips one switch (or one named combination) at a time against it.
SAFE = dict(RAISE_TXN='one', OUTCOME_REACH_TXN='same', OUTCOME_AT='pending', REV_BUMP_AT='pending',
            REFUSED_SETTLE='reach', STALE_OPERATOR_TAP='nothing', CARD_DOOR_SKIPS='table',
            CARD_LISTS_HOLDS=True, CARD_CAP=None, PAUSE_REACH='per-row', STAGING_REACHES=True,
            ANSWER_CHECKS_DEADLINE=True, DOORS_BEFORE_BOOT_PASS=False, RETRY_AT_RUNTIME=True,
            NONBLOCKING_PUSH='silent', START_WHILE_DOWN='reported-at-boot', CHECKPOINTED_TIMEOUT='clearing',
            NO_PROOF_WORD='unmeasured', REINHERIT='inherit', STATE_A_FACT_AUTH='grant',
            BOOT_UNMEASURED_RELEASES=True, I9_SCOPE='rows', WITNESS_LAG=False,
            FAILED_RENEWAL_RETURNS='proven')

QUIET = dict(SERVER_CRASHES=0, SESSION_CRASHES=0, SWAPS=0, RENEWALS=0, REBINDS=0, OPERATOR_MSGS=0,
             RUNG_OPS=0, PUSH_FAILS=0, FAULTS=(), FAULT_EVENTS=0, PROBE_FAILS=False, GEN_TIMEOUTS=False,
             STALE_CALLERS=False, STALE_REVS=False, OP_STALE_TAPS=False)


def sc(**kw):
    d = dict(SAFE)
    d.update(QUIET)
    d.update(kw)
    return d


SCEN = {
    # Holds, the sweep, the boot pass, the outbox and the rung: a class-none decide item and a
    # cannot-decide ask; one server crash; one push refusal; Pause, off or advise; a fault.
    'core': sc(KINDS=(('item_none',), ('ask_cd',)), T_MAX=3, SERVER_CRASHES=1,
               RUNG_OPS=1, RUNG_TARGETS=('off',), OP_UP=False, PAUSE=False),
    # The outbox and its sender: one ask, one push refusal, one server crash.
    'push': sc(N_Q=1, KINDS=(('ask_cd',),), T_MAX=3, SERVER_CRASHES=1, PUSH_FAILS=1,
               RUNG_OPS=1, RUNG_TARGETS=('off',), OP_UP=False, PAUSE=False),
    # Pause with two standing item holds.
    'pause': sc(KINDS=(('item_none',), ('item_none',)), T_MAX=3, RUNG_OPS=1, RUNG_TARGETS=(), OP_UP=False),
    # Revisions deciding a race: an item and an ask, stale taps by the operator and stale
    # revisions at the Overlord's door.
    'race': sc(KINDS=(('item_none',), ('ask_cd',)), T_MAX=2, STALE_REVS=True, OP_STALE_TAPS=True),
    # Renewal and crash restart around a standing item hold and an operator message: the card (I8),
    # the fence (I5), retention while renewing.
    'renewal': sc(N_Q=1, KINDS=(('item_none',),), ITEM_W=3, T_MAX=3, RENEWALS=1, SESSION_CRASHES=1,
                  SERVER_CRASHES=1, OPERATOR_MSGS=1, STALE_CALLERS=True),
    # One ask: the outside-DB answer, its pending act, the dialog race, the boot settlement.
    'asks': sc(N_Q=1, KINDS=(('ask_cd',),), ASK_W=2, T_MAX=3, SERVER_CRASHES=1, STALE_REVS=True,
               OP_STALE_TAPS=True, RUNG_OPS=1, RUNG_TARGETS=('off',), OP_UP=False, PAUSE=False),
    # An O3 item staged under a grant: revocation, a class raise, a renewal across the veto window.
    'grants': sc(N_Q=1, KINDS=(('item_o3',),), T_MAX=3, RENEWALS=1, GRANT_REVOKES=1, CLASS_RAISES=1,
                 SERVER_CRASHES=1, STALE_CALLERS=True),
    # A value item answered with state-a-fact.
    'value': sc(N_Q=1, KINDS=(('item_value',),), T_MAX=3, GRANT_REVOKES=1),
    # Lineage: an item with no class, returned as over-asked, raised again.
    'lineage': sc(KINDS=(('item_unknown',), ('item_reraise',)), T_MAX=3),
    # mayHold false: the rung below full; a blocking or non-blocking item and an operator-only ask.
    'nohold': sc(KINDS=(('item_none',), ('ask_oo',)), BLOCKING=(True, False), T_MAX=2, SERVER_CRASHES=1,
                 PUSH_FAILS=1, RUNG_OPS=1, RUNG_TARGETS=('advise',), PAUSE=False, OP_UP=False),
    # The dead-Overlord push while nothing can be held.
    'deadpush': sc(N_Q=1, KINDS=(('ask_oo',),), T_MAX=3, SESSION_CRASHES=1, RESTART_BOUND=0),
    # Restore: the authority journal, a snapshot, both kinds of restore, a trailing record.
    'restore': sc(N_Q=0, KINDS=(), RESTORES=1, AUTH_CHANGES=1, RUNG_OPS=2, SERVER_CRASHES=2, T_MAX=2),
    # Generation machine alone, with a bigger renewal budget, for D2.
    'genmachine': sc(N_Q=0, KINDS=(), RENEWALS=3, SESSION_CRASHES=1, SERVER_CRASHES=1, SWAPS=1,
                     OPERATOR_MSGS=1, PROBE_FAILS=True, GEN_TIMEOUTS=True, STALE_CALLERS=True, T_MAX=3),
    # A failed renewal's return alone (plan review 1902, F3): two renewals, one server crash, no swaps or operator
    # messages, so a generation degraded before it was proven can renew and fail. Small enough for the fast tests.
    'genback': sc(N_Q=0, KINDS=(), RENEWALS=2, SERVER_CRASHES=1, PROBE_FAILS=True, GEN_TIMEOUTS=True, T_MAX=2),
    # Rebind with a standing hold, and stale callers of both kinds.
    'rebind': sc(N_Q=1, KINDS=(('item_none',),), REBINDS=1, SESSION_CRASHES=1, SERVER_CRASHES=1,
                 STALE_CALLERS=True, STALE_REVS=True, T_MAX=3, RESTART_BOUND=0),
    # Readiness inputs: faults, per-row deafness, saturation (two asks), proof.
    'readiness': sc(KINDS=(('ask_cd',), ('item_none',)), ASK_W=2, FAULTS=('wedged',),
                    FAULT_EVENTS=1, DEAF_ROWS=True, SESSION_CRASHES=1, T_MAX=3),
}

# The ambiguity switches, and the scenario that exercises each.
SWITCHES = [
    # (switch, readings, scenario). The baseline (SAFE) reading is run once per scenario.
    ('RAISE_TXN', ['split'], 'core'),
    ('OUTCOME_REACH_TXN', ['outcome-first', 'reach-first'], 'core'),
    ('OUTCOME_AT', ['done'], 'asks'),
    ('REV_BUMP_AT', ['settle'], 'asks'),
    ('REFUSED_SETTLE', ['none'], 'asks'),
    ('STALE_OPERATOR_TAP', ['stands'], 'race'),
    ('CARD_DOOR_SKIPS', ['literal'], 'genmachine'),
    ('CARD_LISTS_HOLDS', [False], 'renewal'),
    ('CARD_CAP', [1], 'renewal'),
    ('PAUSE_REACH', ['brief-only'], 'pause'),
    ('STAGING_REACHES', [False], 'grants'),
    ('ANSWER_CHECKS_DEADLINE', [False], 'core'),
    ('DOORS_BEFORE_BOOT_PASS', [True], 'core'),
    ('RETRY_AT_RUNTIME', [False], 'push'),
    ('NONBLOCKING_PUSH', ['push', 'none'], 'nohold'),
    ('START_WHILE_DOWN', ['lost-oldkey', 'lost-nokey'], 'genmachine'),
    ('CHECKPOINTED_TIMEOUT', ['active'], 'genmachine'),
    ('FAILED_RENEWAL_RETURNS', ['previous', 'active'], 'genmachine'),
    ('FAILED_RENEWAL_RETURNS', ['previous', 'active'], 'renewal'),
    ('FAILED_RENEWAL_RETURNS', ['previous', 'active'], 'genback'),
    ('NO_PROOF_WORD', ['previous'], 'readiness'),
    ('REINHERIT', ['replace'], 'lineage'),
    ('OP_CLASS_REMOVALS', [1], 'lineage'),
    ('STATE_A_FACT_AUTH', ['entry'], 'value'),
    ('BOOT_UNMEASURED_RELEASES', [False], 'core'),
    ('I9_SCOPE', ['all'], 'deadpush'),
    ('WITNESS_LAG', [True], 'restore'),
]

# Switches that only matter together.
COMBOS = [
    ('late answer after a gap', 'core', dict(ANSWER_CHECKS_DEADLINE=False, DOORS_BEFORE_BOOT_PASS=True,
                                             BOOT_UNMEASURED_RELEASES=False)),
    ('outcome at done, revision at settle', 'asks', dict(OUTCOME_AT='done', REV_BUMP_AT='settle')),
    ('the text as written (every literal reading)', 'core', dict(
        ANSWER_CHECKS_DEADLINE=False, DOORS_BEFORE_BOOT_PASS=True, RETRY_AT_RUNTIME=False,
        REFUSED_SETTLE='none', NONBLOCKING_PUSH='push', BOOT_UNMEASURED_RELEASES=True)),
]

# Planted bugs: (name, scenario, overrides, the invariant expected to catch it)
MUTATIONS = [
    # (name, scenario, overrides, what should catch it). Each runs against the same scenario
    # and overrides without the mutation; 'caught by' lists only the new violations.
    ('restart_extends_deadline', 'core', {'BOOT_UNMEASURED_RELEASES': False}, 'I1'),
    ('reach_without_outbox', 'push', {}, 'I2'),
    ('no_reach_guard', 'core', {'OUTCOME_REACH_TXN': 'reach-first'}, 'I2'),
    ('sweep_raw_clock', 'core', {'SKEWS': 1, 'SERVER_CRASHES': 0}, 'I1'),
    ('item_answer_no_act_row', 'core', {}, 'I3'),
    ('no_fence', 'rebind', {}, 'I5'),
    ('staged_no_fence_recheck', 'grants', {}, 'I5'),
    ('staged_no_grant_recheck', 'grants', {}, 'I4'),
    ('mayhold_ignores_readiness', 'deadpush', {'KINDS': (('item_none',),)}, 'I9'),
    ('no_operator_has_it', 'asks', {}, 'X2'),
    ('no_restore_detection', 'restore', {}, 'I7'),
    ('held_rows_hidden', 'core', {}, 'I10'),
    ('renewing_keeps_all', 'renewal', {}, 'none expected: retention is not an invariant'),
    ('no_natural_key', 'asks', {'OUTCOME_AT': 'done', 'REV_BUMP_AT': 'settle'},
     'none expected: the dialog takes one press'),
    ('proof_outlives_conversation', 'genback', {}, 'X6'),
    ('back_always_degraded', 'genback', {},
     "none expected: the fact 'a failed renewal returns to active with a hold-off' becomes unreachable"),
]

# Reachability facts reported with every run (sanity of the model, and some design questions).
FACTS = {
    'a hold is taken': lambda s: any(q.held for q in s.qs),
    'the Overlord answers a held row': lambda s: any(q.closed_by == 'overlord' for q in s.qs),
    'a re-raised item is answered by the Overlord':
        lambda s: any(q.kind == 'item_reraise' and q.closed_by == 'overlord' for q in s.qs),
    'a staged act becomes effective': lambda s: any(a.st == 'effective' for a in s.acts),
    'generation 2 reaches active': lambda s: s.gen.n >= 2 and s.gen.st == 'active' and s.gen.ok,
    'a generation is active with its card unread': lambda s: s.gen.st == 'active' and not s.gen.card,
    'a row is released server-gap': lambda s: any(q.outcome == 'server-gap' for q in s.qs),
    'a failed renewal returns to active with a hold-off': lambda s: s.gen.st == 'active' and s.gen.holdoff,
}

ALL_NAMES = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I7t', 'I8', 'I9', 'I10', 'X1', 'X2', 'X4', 'X5', 'X6', 'D1', 'D2', 'D2b',
             'D3']


def run(name, overrides, show=True, live=True):
    over = dict(SCEN[name])
    over.update(overrides)
    c = M.cfg(**over)
    try:
        g = explore(c)
    except RuntimeError:
        if show:
            print('scenario %s %s: state bound exceeded' % (name, overrides))
        return dict(states=-1, trans=-1, secs=-1, found={'BOUND': None}, facts={})
    found = {}
    for vn, v in g['viol'].items():
        if v[0] == 'edge':
            _, sid, lbl, s2, m = v
            found[vn] = (m, print_trace(g, sid, (lbl, s2)), len(path_to(g, sid)))
        else:
            sid, m, _ = v
            found[vn] = (m, print_trace(g, sid), len(path_to(g, sid)) - 1)
    if show:
        print('scenario %s %s: %d states, %d transitions, %.1fs' % (name, overrides, len(g['states']),
                                                                    g['ntrans'], g['secs']))
    lv = liveness(g, c) if live else []
    facts = {}
    for fname, f in FACTS.items():
        k = next((k for k, s in enumerate(g['states']) if f(s)), None)
        facts[fname] = k
        if k is not None and show:
            print('reachable: %s (shortest %d steps)' % (fname, len(path_to(g, k)) - 1))
        elif show:
            print('NOT reachable: %s' % fname)
    for vn, sid, m, cnt in lv:
        found[vn] = (m + ' [%d states]' % cnt, print_trace(g, sid), len(path_to(g, sid)) - 1)
    res = dict(states=len(g['states']), trans=g['ntrans'], secs=g['secs'], found=found, facts=facts)
    if show:
        for vn in ALL_NAMES:
            if vn in found:
                m, tr, ln = found[vn]
                print('\n=== %s VIOLATED: %s\n--- shortest trace (%d steps):\n%s' % (vn, m, ln, tr))
        print('\nholds within bounds:', ' '.join(v for v in ALL_NAMES if v not in found))
    return res


def parse_val(v):
    if v in ('True', 'False'):
        return v == 'True'
    if v == 'None':
        return None
    try:
        return int(v)
    except ValueError:
        return v


def main_json(argv):
    """`--json SCENARIO [KEY=VALUE ...]` and `--json --mutations [NAME ...]`: one JSON value on stdout."""
    if argv and argv[0] == '--mutations':
        rows = []
        base = {}
        only = set(argv[1:])
        for mname, sc, over, exp in MUTATIONS:
            if only and mname not in only:
                continue
            key = (sc, tuple(sorted(over.items())))
            if key not in base:
                base[key] = run(sc, over, show=False)
            o = dict(over)
            o['MUTATION'] = mname
            r = run(sc, o, show=False)
            rows.append(dict(mutation=mname, scenario=sc, expected=exp,
                             caught=sorted(set(r['found']) - set(base[key]['found']))))
        print(json.dumps(rows))
        return 0
    name = argv[0]
    over = {}
    for a in argv[1:]:
        k, v = a.split('=', 1)
        over[k] = parse_val(v)
    r = run(name, over, show=False)
    if r['states'] < 0:
        print(json.dumps(dict(scenario=name, bound=True)))
        return 3
    print(json.dumps(dict(scenario=name, overrides=over, states=r['states'], transitions=r['trans'],
                          violated=sorted(r['found']),
                          reachable=sorted(k for k, v in r['facts'].items() if v is not None))))
    return 0


def main(argv):
    if argv and argv[0] == '--json':
        return main_json(argv[1:])
    if not argv or argv[0] == '--list':
        print('scenarios:', ', '.join(SCEN))
        print('switches:')
        for k, vals, sc in SWITCHES:
            print('  %s %s (scenario %s)' % (k, vals, sc))
        print('mutations:', ', '.join(m[0] for m in MUTATIONS))
        return
    if argv[0] == '--matrix':
        t0 = time.time()
        print('| scenario | switch=value | states | transitions | secs | violated |')
        print('|---|---|---|---|---|---|')
        for nm in SCEN:
            r = run(nm, {}, show=False)
            print('| %s | (defaults) | %d | %d | %.1f | %s |' % (nm, r['states'], r['trans'], r['secs'],
                                                              ' '.join(sorted(r['found'])) or '-'))
            sys.stdout.flush()
        for k, vals, sc in SWITCHES:
            for v in vals:
                r = run(sc, {k: v}, show=False)
                print('| %s | %s=%s | %d | %d | %.1f | %s |' % (sc, k, v, r['states'], r['trans'], r['secs'],
                                                              ' '.join(sorted(r['found'])) or '-'))
                sys.stdout.flush()
        for nm, sc, over in COMBOS:
            r = run(sc, over, show=False)
            print('| %s | %s | %d | %d | %.1f | %s |' % (sc, nm, r['states'], r['trans'], r['secs'],
                                                       ' '.join(sorted(r['found'])) or '-'))
            sys.stdout.flush()
        print('\ntotal %.1fs' % (time.time() - t0))
        return
    if argv[0] == '--mutations':
        print('| mutation | scenario | expected | caught by | states | secs |')
        print('|---|---|---|---|---|---|')
        base = {}
        only = set(argv[1:])
        for mname, sc, over, exp in MUTATIONS:
            if only and mname not in only:
                continue
            key = (sc, tuple(sorted(over.items())))
            if key not in base:
                base[key] = run(sc, over, show=False)
            o = dict(over)
            o['MUTATION'] = mname
            r = run(sc, o, show=False)
            new = sorted(set(r['found']) - set(base[key]['found']))
            print('| %s | %s %s | %s | %s | %d | %.1f |' % (mname, sc, over or '', exp, ' '.join(new) or 'NOT CAUGHT',
                                                          r['states'], r['secs']))
            sys.stdout.flush()
        return
    name = argv[0]
    over = {}
    for a in argv[1:]:
        k, v = a.split('=', 1)
        over[k] = parse_val(v)
    run(name, over)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]) or 0)
