"""Machine 2: designation, the term, the authority journal, the witness and a restore.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2533 merged it, §3.1, §3.2, §7.6, §10.1, Table 11.1a. Section numbers are that file's.

The database side (`DB`) is what a snapshot carries. The authority journal (`jr`), the act
journal (`aj`) and the server's authority epoch (`ep`) sit outside every snapshot (§7.6); a
whole-volume snapshot carries them too. One witness off the volume keeps the highest epoch it
has seen (`wep`).

Authority is cut to three fields: the operator's rung (full or chat), one grant, and the
designation's bound session with its term. One request can be relayed once: its relay is the
act whose row a restore can drop.

Assumptions, each a place where the text is silent:
  - a designate or rebind is journalled when the row goes `live`, not at `pending`;
  - the operator's authority doors refuse while `authority-rolled-back` stands, Confirm excepted;
  - the server's authority epoch counts journal records, and Confirm sets it above the witness's.
"""
from collections import namedtuple

RUNGS = ('off', 'chat', 'advise', 'full')
RANK = {r: i for i, r in enumerate(RUNGS)}
GW = {'none': 0, 'revoked': 0, 'susp': 1, 'live': 2}     # how wide a grant state is

DEFAULT = dict(
    # ---- bounds -----------------------------------------------------------------------
    START='live',          # 'none' (never designated) | 'live' (session 1 designated, term 1)
    DESIGNATES=0, REBINDS=0, RETIRES=0, DEATHS=0, RESTARTS=0,
    OPS=2,                 # operator authority taps: lower, raise, create a grant, revoke it
    LATCHES=1,             # the server latches the grant (an overturn)
    RELAYS=1, SNAPS=1, RESTORES=1, CRASHES=1, CRASH_MID=0, WIT_TOGGLES=1,
    SNAP='db',             # what a restore brings back: 'db' (coord.db alone) | 'volume' (journals too)
    WIT0='on',             # the witness at the start: 'on' | 'off'
    POST_GRANT=0,          # the operator creates a grant after a confirmed restore
    POST_CLEAR=0,          # the operator clears the restore's chat latch after Confirm
    POST_LATCH=0,          # the server journals a narrowing of its own after the restore
    # ---- switches: readings of the text -------------------------------------------------
    TRAILING='refuse',           # Table 7.6a's last row: 'literal' (a crash) | 'refuse' | 'mark' (a commit mark)
    EPOCH_COUNTS_ACTS=True,      # the epoch a witness keeps rises with each settled act too | False (the text)
    EPOCH_COMPARE='hash',        # a witness also keeps its epoch's chain hash | 'number' (the text)
    WITNESS_CAP='chat',          # the cap until a witness answers after a boot: 'chat' | 'advise' (the text)
    ACT_COHERENCE='settle-needs-row',  # boot compares the act journal too | 'none' (the text)
    RECONCILE='rebuild',         # the pass writes the missing act rows | 'mark-only' (the text)
    VOLUME_RECONCILE='all-to-operator',  # journals went back too: every open row to the operator | 'journal-only'
    CONFIRM_BODY='unbind-if-differs',  # | 'row' ("Confirm the restore keeps the same body")
    TERM_AT_CONFIRM='max+1',     # the term rises above the row's and the journal's | 'row+1'
    ID_FLOOR='journal',          # a grant id after a restore: above the journal's highest | 'db'
    PENDING_DEADLINE='column',   # a pending binding's deadline: a 'column' | the 'door' process
    MUTATION=None,
)

DB = namedtuple('DB', 'sess pend term rung lat grant gid gnext japp nk pdl')
S = namedtuple('S', 'db jr tmark aj ep fork wep wit up chk rolled alive nsid snap vsnap restored tr eff thi gids '
                    'told gnew door confirmed '
                    'b_des b_reb b_ret b_die b_rst b_op b_latch b_relay b_snap b_rest b_crash b_mid b_wit b_pg b_pc b_pl')


def init(c):
    if c.START == 'live':
        db = DB(sess=1, pend=0, term=1, rung='full', lat=False, grant='none', gid=0, gnext=1, japp=1, nk=False,
                pdl=False)
        jr, alive, nsid, thi = (('des', 1),), frozenset({1}), 2, 1
    else:
        db = DB(sess=0, pend=0, term=0, rung='full', lat=False, grant='none', gid=0, gnext=1, japp=0, nk=False,
                pdl=False)
        jr, alive, nsid, thi = (), frozenset(), 1, 0
    ep = len(jr)
    return S(db=db, jr=jr, tmark=True, aj=0, ep=ep, fork=-1, wep=ep if c.WIT0 == 'on' else 0, wit=c.WIT0, up=True, chk=True,
             rolled=False, alive=alive, nsid=nsid, snap=None, vsnap=None, restored=False, tr=None, eff=0,
             thi=thi, gids=frozenset(), told='full', gnew=False, door=False, confirmed=False,
             b_des=c.DESIGNATES, b_reb=c.REBINDS, b_ret=c.RETIRES, b_die=c.DEATHS, b_rst=c.RESTARTS,
             b_op=c.OPS, b_latch=c.LATCHES, b_relay=c.RELAYS, b_snap=c.SNAPS, b_rest=c.RESTORES,
             b_crash=c.CRASHES, b_mid=c.CRASH_MID, b_wit=c.WIT_TOGGLES, b_pg=c.POST_GRANT, b_pc=c.POST_CLEAR,
             b_pl=c.POST_LATCH)


def fmt(s):
    d = s.db
    body = 'none' if not d.sess else 's%d%s' % (d.sess, '' if d.sess in s.alive else '(dead)')
    return ('%s%s%s | row: body=%s%s term=%d rung=%s%s grant=%s%s rows-reflect=%d relay-row=%s | '
            'journal=%d records%s, act journal=%d, epoch=%d | witness %s holds %d | alive=%s effects=%d%s' % (
                'up' if s.up else 'DOWN', '' if s.chk else ' (boot coherence not run)',
                ' AUTHORITY-ROLLED-BACK' if s.rolled else '',
                body, ' pending=s%d' % d.pend if d.pend else '', d.term, d.rung,
                ' latch:chat' if d.lat else '', d.grant, '#%d' % d.gid if d.gid else '', d.japp,
                'yes' if d.nk else 'no', len(s.jr), (' last=%s' % (s.jr[-1],)) if s.jr else '', s.aj, s.ep,
                s.wit, s.wep, sorted(s.alive), s.eff,
                '' if s.tr is None else ' | before the restore: rung=%s grant=%s body=%s term=%d acts=%d' % (
                    s.tr[0], s.tr[1], 's%d' % s.tr[3] if s.tr[3] else 'none', s.tr[4], s.tr[5])))


# --------------------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------------------

def narrows(db, rec):
    k = rec[0]
    if k == 'rung':
        return RANK[rec[1]] < RANK[db.rung]
    if k == 'g':
        return True
    if k == 'ret':
        return True
    return False             # 'g+' (a grant created) and 'des' (designate, rebind) widen


def apply(db, rec):
    """The row write that follows a journal record, in the same transaction (§7.6)."""
    k = rec[0]
    d = db._replace(japp=db.japp + 1)
    if k == 'rung':
        return d._replace(rung=rec[1])
    if k == 'g+':
        return d._replace(grant='live', gid=rec[1], gnext=max(d.gnext, rec[1] + 1))
    if k == 'g':
        return d._replace(grant=rec[1])
    if k == 'ret':            # §3.1: retire clears the bound session, raises the term, latches every grant
        return d._replace(sess=0, pend=0, term=d.term + 1, grant='susp' if d.grant == 'live' else d.grant)
    if k == 'des':            # §3.1: one transaction makes the row live, raises the term, latches every grant
        return d._replace(sess=rec[1], pend=0, pdl=False, term=d.term + 1,
                          grant='susp' if d.grant == 'live' else d.grant)
    raise ValueError(rec)


def jstate(jr):
    """What the authority journal says stands: (rung, grant, gid, sess, term, highest grant id)."""
    rung, grant, gid, sess, term, hi = 'full', 'none', 0, 0, 0, 0
    for rec in jr:
        k = rec[0]
        if k == 'rung':
            rung = rec[1]
        elif k == 'g+':
            grant, gid, hi = 'live', rec[1], max(hi, rec[1])
        elif k == 'g':
            grant = rec[1]
        elif k == 'ret':
            sess, term = 0, term + 1
            grant = 'susp' if grant == 'live' else grant
        elif k == 'des':
            sess, term = rec[1], term + 1
            grant = 'susp' if grant == 'live' else grant
        elif k == 'cfm':
            _, rung, grant, gid, sess, term = rec
        # 'srv' (a server narrowing the model does not follow further) changes none of these fields
    return rung, grant, gid, sess, term, hi


def eff_rung(s, c=None):
    r = RANK[s.db.rung]
    if s.db.lat:
        r = min(r, RANK['chat'])       # Table 7.5a: a restore detected, cap chat
    if s.wit != 'on':
        # Table 7.5a: no witness since boot, cap advise (the text); 'chat' is the stricter reading
        r = min(r, RANK[c.WITNESS_CAP if c is not None else 'advise'])
    return RUNGS[r]


def witness_flags(s, c):
    """§7.6: "A server whose epoch is lower than a witness's refuses". Under 'hash' the witness also
    keeps the chain hash of its epoch, so a journal that forked below it is seen whatever its length."""
    if s.wep > s.ep:
        return True
    return c.EPOCH_COMPARE == 'hash' and s.fork >= 0 and s.wep > s.fork


def grant_usable(s):
    return s.db.grant == 'live' and s.wit == 'on'


# --------------------------------------------------------------------------------------
# Successors
# --------------------------------------------------------------------------------------

def commit(s, c, rec, widening):
    """Journal first, then the row, in one transaction. The witness learns the new epoch after it."""
    s2 = s._replace(jr=s.jr + (rec,), tmark=True, db=apply(s.db, rec), ep=s.ep + 1)
    if s2.wit == 'on':
        s2 = s2._replace(wep=s2.ep)
    if rec[0] == 'rung':
        # §7.6: a narrowing is reported done only once a witness off the volume holds its epoch
        if widening or s2.wit == 'on':
            s2 = s2._replace(told=rec[1])
    if rec[0] in ('des', 'ret'):
        s2 = s2._replace(thi=max(s2.thi, s2.db.term))
    if rec[0] == 'g+':
        s2 = s2._replace(gids=s2.gids | {rec[1]})
    return s2


def succ(s, c):
    E = []
    d = s.db

    def add(label, s2, **info):
        E.append((label, s2, info))

    def op(label, rec, widening, **kw):
        s2 = commit(s._replace(**kw), c, rec, widening)
        add(label, s2, actor='operator' if not label.startswith('server') else 'server', rec=rec)
        if s.b_mid:
            # a crash between the journal append and the row's commit: one trailing record with no row
            add('SERVER CRASH between the journal record and the row (%s)' % label,
                s._replace(jr=s.jr + (rec,), tmark=False, ep=s.ep + 1, up=False, chk=False, door=False,
                           wit='wait' if s.wit == 'on' else s.wit, b_mid=s.b_mid - 1))

    if not s.up:
        add('server boots', s._replace(up=True))
        return E

    # ---- boot coherence (§7.6, Table 7.6a): urgent, before any door --------------------------
    if not s.chk:
        if c.MUTATION == 'boot_coherence_skipped':
            add('boot coherence: skipped', s._replace(chk=True))
            return E
        nj, nr = len(s.jr), d.japp
        s2 = s._replace(chk=True)
        verdict = 'coherent'
        if nj == nr + 1 and (c.TRAILING == 'literal' or (c.TRAILING == 'mark' and not s.tmark)):
            rec = s.jr[-1]
            if narrows(d, rec) or c.MUTATION == 'rollfwd_widening':
                s2 = s2._replace(db=apply(d, rec), tmark=True)
                verdict = 'one trailing record with no row: a crash, rolled forward'
            else:
                s2 = s2._replace(jr=s.jr[:-1], ep=s.ep - 1, tmark=True)
                verdict = 'one trailing record with no row: a crash, dropped'
        elif nj != nr:
            s2 = s2._replace(rolled=True)
            verdict = 'the journal is %s the rows: refuse `authority-rolled-back`' % (
                'behind' if nj < nr else 'ahead of')
        if c.ACT_COHERENCE == 'settle-needs-row' and s.aj > (1 if s2.db.nk else 0) and not s2.rolled:
            s2 = s2._replace(rolled=True)
            verdict = 'the act journal holds a settled act with no row: refuse `authority-rolled-back`'
        add('boot coherence: %s' % verdict, s2, boot=True)
        return E

    # ---- the witness (§7.6) -------------------------------------------------------------------
    if s.wit == 'wait':
        if witness_flags(s, c) and c.MUTATION != 'witness_ignored':
            add('the witness answers and the server is behind it: refuse `authority-rolled-back`',
                s._replace(wit='on', rolled=True))
        else:
            add('the witness answers', s._replace(wit='on', wep=max(s.wep, s.ep)), cond_end=True)
    if s.b_wit and s.wit == 'on' and not s.restored:
        add('the witness disconnects', s._replace(wit='off', b_wit=s.b_wit - 1))
    if s.wit == 'off' and not s.restored:
        if witness_flags(s, c):
            add('the witness connects and the server is behind it: refuse `authority-rolled-back`',
                s._replace(wit='on', rolled=True))
        else:
            add('the witness connects', s._replace(wit='on', wep=max(s.wep, s.ep)), cond_end=True)

    # ---- crash, snapshot, restore --------------------------------------------------------------
    if s.b_crash:
        add('SERVER CRASH', s._replace(up=False, chk=False, door=False, wit='wait' if s.wit == 'on' else s.wit,
                                       b_crash=s.b_crash - 1))
    if s.b_snap and not s.rolled and not d.pend and not s.restored:
        add('a snapshot is taken (%s)' % c.SNAP,
            s._replace(snap=d, vsnap=(s.jr, s.aj, s.ep, s.tmark) if c.SNAP == 'volume' else None,
                       b_snap=s.b_snap - 1))
    if s.b_rest and s.snap is not None and not s.rolled and not d.pend and not s.restored:
        tr = (d.rung, d.grant, d.gid, d.sess, d.term, s.aj)
        s2 = s._replace(db=s.snap, up=False, chk=False, door=False, restored=True, tr=tr, confirmed=False,
                        wit='wait' if s.wit == 'on' else s.wit, b_rest=s.b_rest - 1)
        if s.vsnap is not None:
            s2 = s2._replace(jr=s.vsnap[0], aj=s.vsnap[1], ep=s.vsnap[2], tmark=s.vsnap[3],
                             fork=s.vsnap[2] if s.ep > s.vsnap[2] else -1)
        add('RESTORE: the %s comes back from the snapshot' % ('whole volume' if s.vsnap is not None else 'database'),
            s2, restore=True)

    # ---- Confirm the restore (§7.6) ---------------------------------------------------------------
    if s.rolled:
        jrung, jgrant, jgid, jsess, jterm, jhi = jstate(s.jr)
        lax = c.MUTATION == 'confirm_takes_laxer'
        pick = max if lax else min
        rung = RUNGS[pick(RANK[d.rung], RANK[jrung])]
        # the stricter of the row and the journal: a grant the journal revoked stays revoked, one the
        # database lacks stays absent; then every grant stays latched suspended
        if d.gid and d.gid == jgid:
            grant = d.grant if GW[d.grant] <= GW[jgrant] else jgrant
            if lax:
                grant = d.grant if GW[d.grant] >= GW[jgrant] else jgrant
        else:
            grant = d.grant if d.gid else 'none'
            if d.gid and not lax:
                grant = 'susp' if d.grant == 'live' else d.grant
        if grant == 'live' and c.MUTATION != 'confirm_keeps_grant_live':
            grant = 'susp'
        sess = d.sess
        if c.CONFIRM_BODY == 'unbind-if-differs' and d.sess != jsess:
            sess = 0
        term = (max(d.term, jterm) if c.TERM_AT_CONFIRM == 'max+1' else d.term) + 1
        nk = d.nk or (c.RECONCILE == 'rebuild' and s.aj > 0)
        if s.vsnap is not None and s.restored and c.VOLUME_RECONCILE == 'all-to-operator':
            nk = True      # the request is the operator's (`needs-you`): the Overlord's moves on it refuse
        ep = max(s.ep, s.wep) + 1
        rec = ('cfm', rung, grant, d.gid if grant != 'none' else 0, sess, term)
        jr = s.jr + (rec,)
        db2 = d._replace(rung=rung, lat=True, grant=grant, sess=sess, term=term, nk=nk, japp=len(jr),
                         gid=d.gid if grant != 'none' else 0)
        if d.pend and (d.pdl or s.door):
            add('pending deadline: no start report, the check is treated as failed',
                s._replace(db=d._replace(pend=0, pdl=False), door=False, alive=s.alive - {d.pend}), lane=True)
        add('operator: Confirm the restore', s._replace(db=db2, jr=jr, tmark=True, ep=ep, fork=-1,
                                                         wep=ep if s.wit == 'on' else s.wep,
                                                         rolled=False, confirmed=True,
                                                         thi=max(s.thi, term)), actor='operator',
            confirm=True)
        return E

    # ---- the operator's authority doors ------------------------------------------------------------
    if not s.restored and s.b_op:
        b = dict(b_op=s.b_op - 1)
        if d.rung == 'full':
            op('operator: lowers the rung to chat', ('rung', 'chat'), False, **b)
        if d.rung == 'chat' and not d.lat:
            op('operator: steps the rung up to full', ('rung', 'full'), True, **b)
        if d.grant == 'none':
            op('operator: creates a grant', ('g+', d.gnext), True, **b)
        if d.grant in ('live', 'susp'):
            op('operator: revokes the grant', ('g', 'revoked'), False, **b)
    if not s.restored and s.b_latch and d.grant == 'live':
        op('server: latches the grant (an overturn)', ('g', 'susp'), False, b_latch=s.b_latch - 1)
    if s.restored and s.b_pl:
        # any narrowing the server journals by itself (a latch, an expiry): here a ceiling's latch
        s2 = s._replace(jr=s.jr + (('srv',),), db=d._replace(japp=d.japp + 1), ep=s.ep + 1, b_pl=s.b_pl - 1)
        if s2.wit == 'on':
            s2 = s2._replace(wep=s2.ep)
        add('server: journals a narrowing of its own (a latch)', s2, actor='server')
    if s.restored and s.confirmed and s.b_pc and d.lat:
        add('operator: clears the restore latch', s._replace(db=d._replace(lat=False), b_pc=s.b_pc - 1),
            actor='operator')
    if s.restored and s.confirmed and s.b_pg and d.grant == 'none':
        jhi = jstate(s.jr)[5]
        gid = max(d.gnext, jhi + 1) if c.ID_FLOOR == 'journal' else d.gnext
        s2 = commit(s._replace(b_pg=s.b_pg - 1, gnew=True), c, ('g+', gid), True)
        add('operator: creates a grant (it gets id %d)' % gid, s2, actor='operator', newgrant=gid,
            reused=gid in s.gids)

    # ---- designation (§3.1, §3.2) ---------------------------------------------------------------------
    if not s.restored:
        if s.b_des and not d.sess and not d.pend:
            add('operator: Start the Overlord (session s%d created, the row is `pending`)' % s.nsid,
                s._replace(db=d._replace(pend=s.nsid, pdl=c.PENDING_DEADLINE == 'column'),
                           door=c.PENDING_DEADLINE == 'door', alive=s.alive | {s.nsid}, nsid=s.nsid + 1,
                           b_des=s.b_des - 1), actor='operator')
        if s.b_reb and d.sess and not d.pend:
            forced = d.sess in s.alive
            add('operator: Rebind the Overlord%s (session s%d created, `pending`)' % (
                ', forced: the old session is stopped first' if forced else '', s.nsid),
                s._replace(db=d._replace(pend=s.nsid, pdl=c.PENDING_DEADLINE == 'column'),
                           door=c.PENDING_DEADLINE == 'door', alive=(s.alive - {d.sess}) | {s.nsid},
                           nsid=s.nsid + 1, b_reb=s.b_reb - 1), actor='operator')
        if s.b_ret and d.sess and not d.pend:
            op('operator: retires the Overlord (the row stays, no session bound)', ('ret',), False,
               b_ret=s.b_ret - 1)
    if d.pend:
        if d.pend in s.alive:
            op('the pending session reports its start and passes the sandbox check: the row is `live`',
               ('des', d.pend), True)
            add('the pending session fails the sandbox check: it is stopped, `overlord-sandbox-unmet`',
                s._replace(db=d._replace(pend=0, pdl=False), door=False, alive=s.alive - {d.pend}))
        # §3.2 "A start that never reports fails the check ... A pending row never stands without a deadline"
        if d.pdl or s.door:
            add('pending deadline: no start report, the check is treated as failed',
                s._replace(db=d._replace(pend=0, pdl=False), door=False, alive=s.alive - {d.pend}), lane=True)
    if s.b_die and d.sess in s.alive and not d.pend:
        add('the bound session dies', s._replace(alive=s.alive - {d.sess}, b_die=s.b_die - 1))
    if s.b_rst and d.sess and d.sess not in s.alive and not d.pend:
        add('operator: Restart the Overlord (the same session id starts again)',
            s._replace(alive=s.alive | {d.sess}, b_rst=s.b_rst - 1), actor='operator')

    # ---- the Overlord relays the one request (§5.3: the mail and the act row in one transaction) -------
    def relay(who, stale):
        s2 = s._replace(db=d._replace(nk=True), aj=s.aj + 1, eff=s.eff + 1, b_relay=s.b_relay - 1)
        if c.EPOCH_COUNTS_ACTS:
            s2 = s2._replace(ep=s2.ep + 1)
            if s2.wit == 'on':
                s2 = s2._replace(wep=s2.ep)
        return s2
    if s.b_relay and not d.pend and RANK[eff_rung(s, c)] >= RANK['advise'] and not d.nk:
        if d.sess and d.sess in s.alive:
            add('Overlord (s%d): relays the request' % d.sess, relay(d.sess, False), actor='overlord')
        if c.MUTATION == 'no_designation_check':
            for x in sorted(s.alive - {d.sess}):
                add('a session that is not designated (s%d) relays; accepted' % x, relay(x, True),
                    actor='overlord', stale=True)
    return E


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def settled(s):
    return s.restored and s.up and s.chk and not s.rolled


def i7(s, c):
    # I7 "After a restore, no authority field is wider than the journal's". The journal here is what
    # the authority journal held when the restore was made (`tr`).
    if not settled(s):
        return None
    rung, grant, gid, sess, term, aj = s.tr
    if s.vsnap is not None:
        # the whole volume came back: the journal file went back too, so "the journal's" is what the
        # operator was told was done (§7.6 "A narrowing is done only once a witness holds it")
        # Once the operator has confirmed the restore, each further widening is their own tap.
        if s.wit == 'on' and not s.confirmed and RANK[eff_rung(s, c)] > RANK[s.told]:
            return 'the rung is %s; the operator was told %s was done; a witness has answered and no ' \
                   'restore was flagged' % (eff_rung(s, c), s.told)
        return None
    if RANK[eff_rung(s, c)] > RANK[rung]:
        return 'the rung is %s; the journal held %s' % (eff_rung(s, c), rung)
    if grant_usable(s) and not s.gnew and grant != 'live':
        return 'the grant reads live; the journal held it `%s`' % grant
    if s.db.sess and s.db.sess != sess:
        return 'the row binds session s%d; the journal held %s as the body' % (
            s.db.sess, 's%d' % sess if sess else 'no session (retired)')
    return None


def i7b(s, c):
    # §7.6 "every grant stays latched suspended"
    if settled(s) and s.confirmed and s.db.grant == 'live' and not s.gnew:
        return 'a grant reads live after Confirm the restore, with no operator tap on its live door'
    return None


def i7w(s, c):
    # "an authority change reported done is never lost by a restore": the window before a witness answers
    if settled(s) and s.wit != 'on' and RANK[eff_rung(s, c)] > RANK[s.told]:
        return 'the rung is %s; the operator was told %s was done; no witness has answered yet' % (
            eff_rung(s, c), s.told)
    return None


def r1(s, c):
    # §7.6: a restored database "would drop the rows of acts that happened"; the pass must reach them
    if not settled(s) or s.tr[5] == 0:
        return None
    if s.vsnap is not None:
        # the act journal went back with the volume, so no pass can rebuild the row: the restore must
        # at least be flagged once a witness has answered
        if s.wit == 'on' and not s.confirmed and not s.db.nk:
            return 'an act that happened is gone, a witness has answered, and no restore was flagged'
        return None
    if not s.db.nk:
        return 'an act that happened has no row, and no restore stands flagged'
    return None


def i3(s, c):
    # I3 "At most one effect per natural key"
    if s.eff > 1:
        return 'the request was relayed %d times at one revision' % s.eff
    return None


def t1(s, lbl, info, s2, c):
    # §3.1 "A call that carries an older term is refused": a term is never issued twice
    if info.get('restore') or info.get('boot'):
        return None
    if s2.db.term != s.db.term and s2.db.term <= s.thi:
        return 'term %d is issued again (the highest issued before was %d)' % (s2.db.term, s.thi)
    return None


def g1(s, lbl, info, s2, c):
    if info.get('reused'):
        return 'grant id %d is used twice: the journal already records a grant with it' % info['newgrant']
    return None


def w1(s, lbl, info, s2, c):
    # Table 7.6a "Only narrowing records are ever replayed"
    if info.get('boot'):
        if RANK[s2.db.rung] > RANK[s.db.rung] or GW[s2.db.grant] > GW[s.db.grant] or \
                (s2.db.sess and s2.db.sess != s.db.sess):
            return 'boot coherence widened authority (rung %s to %s, grant %s to %s)' % (
                s.db.rung, s2.db.rung, s.db.grant, s2.db.grant)
    return None


def d2(s, lbl, info, s2, c):
    if info.get('stale'):
        return 'a relay was accepted from a session the row does not bind'
    return None


STATE_CHECKS = [('I7', i7), ('I7b', i7b), ('I7w', i7w), ('R1', r1), ('I3', i3)]
EDGE_CHECKS = [('T1', t1), ('G1', g1), ('W1', w1), ('D2', d2)]


def _lanes(lbl):
    return lbl.startswith(('pending deadline', 'server boots', 'boot coherence'))


LIVE_CHECKS = [
    # §3.2 "A pending row never stands without a deadline, so `overlord-exists` cannot wedge"
    ('LP', lambda s, c: s.db.pend != 0, lambda s, c: s.db.pend == 0, _lanes),
]

FACTS = [
    ('a restore is flagged `authority-rolled-back`', lambda s, c: s.restored and s.rolled),
    ('a restore reads coherent at boot', lambda s, c: settled(s) and not s.confirmed),
    ('a crash between record and row is flagged `authority-rolled-back`',
     lambda s, c: s.rolled and not s.restored),
]


SCEN = {
    # coord.db alone comes back; the journals stay
    'restore-db': dict(START='live', OPS=2, LATCHES=1, RELAYS=2, SNAPS=1, RESTORES=1, CRASHES=1, CRASH_MID=1,
                       WIT_TOGGLES=1, SNAP='db', POST_GRANT=1, POST_CLEAR=1),
    # the whole volume comes back, journals included; only the witness can tell
    'restore-volume': dict(START='live', OPS=2, LATCHES=1, RELAYS=2, SNAPS=1, RESTORES=1, CRASHES=1, CRASH_MID=0,
                           WIT_TOGGLES=1, SNAP='volume', POST_LATCH=1, POST_CLEAR=1),
    # a rebind or a retire falls between the snapshot and the restore
    'restore-body': dict(START='live', OPS=0, LATCHES=0, RELAYS=2, SNAPS=1, RESTORES=1, CRASHES=0, CRASH_MID=0,
                         WIT_TOGGLES=0, SNAP='db', REBINDS=1, RETIRES=1, DESIGNATES=1, DEATHS=1, RESTARTS=1),
    # designate, rebind and retire with crashes, and no restore
    'designate': dict(START='none', OPS=0, LATCHES=0, RELAYS=1, SNAPS=0, RESTORES=0, CRASHES=2, CRASH_MID=1,
                      WIT_TOGGLES=0, DESIGNATES=2, REBINDS=1, RETIRES=1, DEATHS=1, RESTARTS=1),
}

READINGS = [
    ('ACT_COHERENCE', 'none', 'restore-db', 'R1 I3'),
    ('TRAILING', 'literal', 'restore-db', 'G1'),
    ('TRAILING', 'literal', 'restore-body', 'I7'),
    ('TRAILING', 'mark', 'restore-db', ''),
    ('TRAILING', 'mark', 'restore-body', ''),
    (('ACT_COHERENCE', 'TRAILING'), ('none', 'literal'), 'restore-db', 'R1 I3 G1'),
    ('RECONCILE', 'mark-only', 'restore-db', 'I3 R1'),
    ('EPOCH_COUNTS_ACTS', False, 'restore-volume', 'R1'),
    ('EPOCH_COMPARE', 'number', 'restore-volume', 'I7'),
    ('WITNESS_CAP', 'advise', 'restore-volume', 'I7w I3'),
    ('VOLUME_RECONCILE', 'journal-only', 'restore-volume', 'I3'),
    ('CONFIRM_BODY', 'row', 'restore-body', 'I7'),
    ('TERM_AT_CONFIRM', 'row+1', 'restore-body', 'T1'),
    ('ID_FLOOR', 'db', 'restore-db', 'G1'),
    ('PENDING_DEADLINE', 'door', 'designate', 'LP'),
]

MUTATIONS = [
    ('boot_coherence_skipped', 'restore-db', {}, 'I7'),
    ('witness_ignored', 'restore-volume', {}, 'I7'),
    ('confirm_takes_laxer', 'restore-db', {}, 'I7'),
    ('confirm_keeps_grant_live', 'restore-db', {}, 'I7b'),
    ('rollfwd_widening', 'restore-db', dict(TRAILING='literal'), 'W1'),
    ('no_designation_check', 'restore-body', {}, 'D2'),
]

TRACES = [
    ('restore-acts-only-coherent', 'restore-db', dict(ACT_COHERENCE='none'), ('R1', 'I3')),
    ('restore-trailing-record-revives-body', 'restore-body', dict(TRAILING='literal'), ('I7',)),
    ('restore-trailing-record-id-reuse', 'restore-db', dict(TRAILING='literal'), ('G1',)),
    ('restore-volume-acts-only', 'restore-volume', dict(EPOCH_COUNTS_ACTS=False), ('R1',)),
    ('restore-volume-epoch-catches-up', 'restore-volume', dict(EPOCH_COMPARE='number'), ('I7',)),
    ('restore-volume-window-before-witness', 'restore-volume', dict(WITNESS_CAP='advise'), ('I7w', 'I3')),
    ('restore-volume-acts-repeat', 'restore-volume', dict(VOLUME_RECONCILE='journal-only'), ('I3',)),
    ('restore-reconcile-marks-nothing', 'restore-db', dict(RECONCILE='mark-only'), ('I3',)),
    ('restore-revives-earlier-body', 'restore-body', dict(CONFIRM_BODY='row'), ('I7',)),
    ('restore-term-issued-twice', 'restore-body', dict(TERM_AT_CONFIRM='row+1'), ('T1',)),
    ('restore-grant-id-reused', 'restore-db', dict(ID_FLOOR='db'), ('G1',)),
    ('pending-designation-no-deadline', 'designate', dict(PENDING_DEADLINE='door'), ('LP',)),
    ('crash-flagged-as-restore', 'restore-db', {}, ('a crash between record and row is flagged `authority-rolled-back`',)),
]
