"""Machine 7: the joint cases round two took from separate machines (§7.2, §7.6, §6.7, §10.1, §10.3, §5.1).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

One live grant with `max-per-day:1`. Two items of class O3 in its scope, Q (held) and Q2. One staged act on
each at most. One request R with an operator origin. One snapshot and one restore: of `coord.db` alone (the
journals stand) or of the whole volume (the journals go back too, and a witness off the volume sees it).
`eff` and `effd` are the truth: answers that reached the coordinator for Q, and effects under the grant today.

Bounds: the veto window is one observed tick; one Veto tap, one mint of a later generation, one withdraw.
"""
from collections import namedtuple

DEFAULT = dict(
    RESTORE='db', BACKUPS=1, RESTORES=1, VETOS=1, MINTS=0, WITHDRAWS=0, RELAYS=1, STAGE2=0, OP_ANSWERS=1, OPENS=0,
    Q0='held', R0='received',
    # ---- switches: the safe readings -----------------------------------------------------------------------
    LATE_VETO='overturned',   # a Veto that arrives after the commit: 'overturned' (a correction, the grant latches)
                              # | 'superseded' (no tripwire; the text gives a Veto no answer to stand) | 'ignored'
    COUNTS='rows',            # `max-per-day` counts: 'rows' (every act row under the grant but a `refused` one)
                              # | 'effects' (rows that took effect)
    COMMIT_RECOUNT=True,      # the staged commit counts again: True | False
    RECONCILE='behind',       # the reconciliation pass covers: 'behind' (an act the table lacks, or holds in an
                              # earlier state than its settle record) | 'lacks' (the text: an act the table lacks)
    REQ_JOURNAL=True,         # the operator's withdraw of a request is an authority record: True | False (the text)
    REQ_IDS='journal',        # after a restore request ids start above: 'journal' (the highest the act journal or a
                              # witness holds) | 'table' (the text names grants, acts, proposals and commands only)
    MUTATION=None,
)

S = namedtuple('S', 'q a out ja a2 g eff effd corr r rel relrow jw snap rest tap told rid dbmax reuse vf '
                    'b_bak b_res b_veto b_mint b_wd b_rel b_st2 b_ans b_open')


def init(c):
    return S(q=c.Q0, a='none', out=None, ja='none', a2='none', g='live', eff=0, effd=0, corr=False, r=c.R0, rel=0,
             relrow=False, jw=False, snap=None, rest=None, tap=None, told=False, rid=1, dbmax=1, reuse=False, vf=False,
             b_bak=c.BACKUPS, b_res=c.RESTORES, b_veto=c.VETOS, b_mint=c.MINTS, b_wd=c.WITHDRAWS, b_rel=c.RELAYS,
             b_st2=c.STAGE2, b_ans=c.OP_ANSWERS, b_open=c.OPENS)


def fmt(s):
    return ('item Q %s | act on Q: %s%s (act journal: %s) | act on Q2: %s | grant %s | in truth: %d answer(s) reached '
            'the coordinator for Q%s, %d effect(s) under the grant today | request R %s, %d relay(s) made%s%s%s' % (
                s.q, s.a, ', outcome `%s`' % s.out if s.out else '', s.ja, s.a2, s.g, s.eff,
                ', a correction followed' if s.corr else '', s.effd, s.r, s.rel,
                ' | the operator`s Veto is on its way' if s.tap else '',
                ' | restored (%s)' % s.rest if s.rest else '', ' | the operator was told' if s.told else '')
            + ' | request ids issued in truth: %d, highest in the table: %d%s' % (
                s.rid, s.dbmax, ' | A REQUEST ID WAS ISSUED TWICE' if s.reuse else ''))


def counted(s, c):
    """§7.2: "`max-per-day:<n>`, over a rolling 24 hours of act rows. An overturned act still counts." """
    rows = [s.a, s.a2]
    if c.COUNTS == 'rows':
        return sum(1 for x in rows if x not in ('none', 'refused'))
    return sum(1 for x in rows if x == 'effective')


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    live = s.g == 'live'
    # ---- the Overlord ------------------------------------------------------------------------------------
    if s.q == 'held' and s.a == 'none' and live and counted(s, c) < 1:
        # §7.2: "Staging settles the hold. It writes the row's reach stamp"
        add('Overlord: answers Q under the grant; the answer is staged', s._replace(a='staged', ja='intent', q='staged'),
            actor='overlord')
    if s.b_st2 and s.a2 == 'none' and live:
        if counted(s, c) < 1 or c.MUTATION == 'cap_ignored':
            add('Overlord: answers Q2 under the same grant; the answer is staged',
                s._replace(a2='staged', b_st2=s.b_st2 - 1), actor='overlord')
        else:
            add('Overlord: answers Q2 under the same grant; `max-per-day` is reached, so Q2 goes to the operator',
                s._replace(a2='refused', b_st2=s.b_st2 - 1), actor='overlord')
    if s.b_rel and s.r == 'received':
        # §5.1: "A root request authorises one relay per owner"
        add('Overlord: relays under request R', s._replace(r='routed', rel=s.rel + 1, relrow=True, b_rel=s.b_rel - 1),
            actor='overlord', relay=True, withdrawn=s.jw or False)
    if s.b_open:
        # §7.6: "No id is used twice across a restore." It names grants, acts, proposals and commands.
        nid = (s.dbmax if c.REQ_IDS == 'table' or not s.rest else max(s.dbmax, s.rid)) + 1
        add('Overlord: opens another request; the server gives it id %d' % nid,
            s._replace(rid=max(s.rid, nid), dbmax=nid, reuse=s.reuse or nid <= s.rid, b_open=s.b_open - 1),
            actor='overlord')
    # ---- the veto clock and the commit (§7.2) ---------------------------------------------------------------
    for which in ('a', 'a2'):
        if getattr(s, which) == 'staged':
            ok = live
            if c.COMMIT_RECOUNT and c.COUNTS == 'effects' and counted(s, c) >= 1:
                ok = False
            if ok:
                s2 = s._replace(**{which: 'effective'})._replace(effd=s.effd + 1)
                if which == 'a':
                    s2 = s2._replace(q='answered by the Overlord', eff=s.eff + 1, ja='settled effective')
                add('veto clock: the window runs out and the commit passes; the act on %s is `effective`' % (
                    'Q' if which == 'a' else 'Q2'), s2, actor='server', commit=True)
            else:
                s2 = s._replace(**{which: 'voided'})
                if which == 'a':
                    s2 = s2._replace(q='with the operator', ja='settled voided')
                add('veto clock: the commit re-checks and fails; the act on %s is `voided`, and the row pushes again'
                    % ('Q' if which == 'a' else 'Q2'), s2, actor='server')
    if s.b_mint and (s.a == 'staged' or s.a2 == 'staged'):
        # §7.2: "the mint of a later generation voids a staged act"
        s2 = s._replace(b_mint=s.b_mint - 1, vf=s.a2 == 'none')
        if s.a == 'staged':
            s2 = s2._replace(a='voided', q='with the operator', ja='settled voided')
        if s.a2 == 'staged':
            s2 = s2._replace(a2='voided')
        add('renewal lane: a later generation is minted; the staged acts are `voided`', s2, actor='server')
    # ---- the operator --------------------------------------------------------------------------------------
    if s.b_veto and s.a == 'staged' and s.tap is None:
        add('operator: presses Veto on the staged row', s._replace(tap='veto', b_veto=s.b_veto - 1), actor='operator')
    if s.tap == 'veto':
        if s.a == 'staged':
            add('the Veto arrives: the act is `vetoed`',
                s._replace(a='vetoed', q='with the operator', ja='settled vetoed', tap=None), actor='operator')
        elif s.a == 'effective':
            # §6.7: "An operator's tap is never refused for a stale revision: it is applied at the row's current
            # revision, as a correction of the act it raced"
            if c.LATE_VETO == 'overturned':
                add('the Veto arrives after the commit: the act is `overturned`, a correction goes to the '
                    'coordinator, the grant latches and Q is the operator`s',
                    s._replace(out='overturned', corr=True, g='suspended', q='with the operator', tap=None),
                    actor='operator', late=True)
            elif c.LATE_VETO == 'superseded':
                add('the Veto arrives after the commit: the act is `superseded`; a Veto carries no answer to stand',
                    s._replace(out='superseded', tap=None), actor='operator', late=True)
            else:
                add('the Veto arrives after the commit: the act is no longer staged, and the tap changes nothing',
                    s._replace(tap=None), actor='operator', late=True)
        else:
            add('the Veto arrives: the act is already %s' % s.a, s._replace(tap=None), actor='operator')
    if s.b_ans and s.q == 'with the operator':
        add('operator: answers Q', s._replace(q='answered by the operator', eff=s.eff + 1, b_ans=s.b_ans - 1),
            actor='operator', op_answer=True)
    if s.b_wd and s.r in ('received', 'routed'):
        add('operator: withdraws request R', s._replace(r='dropped', jw=True, b_wd=s.b_wd - 1), actor='operator')
    if s.b_bak and s.snap is None:
        add('`ccrc backup` takes a snapshot',
            s._replace(snap=(s.q, s.a, s.out, s.a2, s.g, s.r, s.relrow, s.ja, s.dbmax), b_bak=s.b_bak - 1),
            actor='operator')
    if s.b_res and s.snap is not None:
        q, a, out, a2, g, r, relrow, sja, dbmax = s.snap
        vol = c.RESTORE == 'volume'
        ja = sja if vol else s.ja
        # detected: the journals are ahead of the rows (boot coherence), or a witness holds a higher epoch (§7.6).
        # The epoch rises with authority records and act settle records only.
        ahead = ((s.ja != sja) or (s.g != g) or (s.relrow and not relrow) or s.dbmax != dbmax
                 or (c.REQ_JOURNAL and s.r == 'dropped' and r != 'dropped'))
        if not ahead:
            # nothing the journals record changed since the snapshot: the restore is not detected
            add('operator: restores %s; boot coherence passes and no witness holds a higher epoch' % (
                'the whole volume' if vol else 'coord.db alone'),
                s._replace(q=q, a=a, out=out, a2=a2, g=g, r=r, relrow=relrow, ja=ja, rest='not detected', tap=None,
                           dbmax=dbmax, b_res=s.b_res - 1), actor='operator', restore=True)
        else:
            # Confirm the restore: "every grant stays latched suspended"; holds are released (the `chat` latch)
            g2 = 'live' if c.MUTATION == 'restore_keeps_grants' else 'suspended'
            told = False
            if vol:
                # "no record says which rows were acted on, so every open ask, item and request goes to the operator"
                if a == 'staged':
                    a = 'voided'
                if a2 == 'staged':
                    a2 = 'voided'
                if q in ('held', 'staged'):
                    q = 'with the operator'
                if r in ('received', 'routed'):
                    r = 'needs-you'
                told = True
            else:
                # the reconciliation pass: "For each act the act journal holds and the table lacks, it writes the
                # act's row with `divergedAt` set"
                if a == 'none' and ja != 'none':
                    a = {'intent': 'voided', 'settled effective': 'effective', 'settled vetoed': 'vetoed',
                         'settled voided': 'voided'}[ja]
                    q = 'with the operator'
                    told = True
                elif a == 'staged' and ja.startswith('settled') and c.RECONCILE == 'behind':
                    a = ja.split(' ')[1]
                    q = 'with the operator'
                    told = True
                if a == 'staged':
                    a = 'voided'             # §7.2: a latch voids a staged act
                if a2 == 'staged':
                    a2 = 'voided'
                if q in ('held', 'staged') and c.MUTATION != 'restore_keeps_holds':
                    q = 'with the operator'
                if s.relrow and not relrow:
                    relrow = True            # the relay's act row is written again, so its natural key stays taken
                    r = 'needs-you'          # "those requests move to `needs-you`"
                if c.REQ_JOURNAL and s.r == 'dropped':
                    r = 'dropped'            # the stricter of the row and the journal
            add('operator: restores %s; the restore is detected and confirmed' % (
                'the whole volume' if vol else 'coord.db alone'),
                s._replace(q=q, a=a, out=out, a2=a2, g=g2, r=r, relrow=relrow, ja=ja, rest='confirmed', told=told,
                           tap=None, dbmax=dbmax, b_res=s.b_res - 1), actor='operator', restore=True)
    return E


# ---------------------------------------------------------------------------------------------------------
# checks

def j1(s, lbl, info, s2, c):
    # §6.7: "An operator's tap is never refused for a stale revision"; §10.3: "Veto and Answer now settle it"
    if info.get('late') and s2.a == 'effective' and not s2.corr:
        return 'the operator vetoed, and the Overlord`s answer stays in effect with no correction (`%s`)' % (
            s2.out or 'no outcome')
    return None


def j2(s, lbl, info, s2, c):
    # I3: "At most one effect per natural key, and every effect has an act row"; §7.6's first paragraph
    if info.get('op_answer') and s.eff >= 1 and s.a != 'effective' and s.rest == 'confirmed' and c.RESTORE == 'db':
        return ('a second answer reaches the coordinator for Q, and the act row reads `%s`: no row says the first '
                'took effect' % s.a)
    return None


def j3(s, c):
    # §7.2: `max-per-day:1`
    if s.effd > 1:
        return '%d effects under a grant with `max-per-day:1`' % s.effd
    return None


def j5(s, lbl, info, s2, c):
    # I4: an act commits with "a request bound to an operator message"; the operator withdrew this one
    if info.get('relay') and info.get('withdrawn'):
        return 'a relay went out under a request the operator had withdrawn%s' % (
            ' (the restore was not detected)' if s.rest == 'not detected' else '')
    return None


def j8(s, c):
    # §7.6: "No id is used twice across a restore"; §8.2: "The name is derived from the request id. A retried start
    # finds the session the first call made."
    if s.reuse:
        return ('a request id was issued twice: the first owner`s ack, reports and runs bind to the second request, '
                'and a start under it derives the first one`s session name')
    return None


def j6(s, c):
    # I7; §7.6: "every grant stays latched suspended"
    if s.rest == 'confirmed' and s.g == 'live':
        return 'a grant is live after a confirmed restore'
    return None


def j7(s, c):
    # I1, I10: a held row reaches the operator; §7.6: a detected restore latches the ladder at `chat`
    if s.rest == 'confirmed' and s.q in ('held', 'staged') and s.a != 'staged':
        return 'a row is still held for the Overlord after a confirmed restore'
    return None


STATE_CHECKS = [('J3', j3), ('I7', j6), ('I1', j7), ('J8', j8)]
EDGE_CHECKS = [('J1', j1), ('I3', j2), ('J5', j5)]
LIVE_CHECKS = []
FACTS = [
    ('a voided act uses up the grant`s day: the next answer under it goes to the operator',
     lambda s, c: s.a == 'voided' and s.a2 == 'refused' and s.effd == 0 and s.vf),
    ('a vetoed act uses up the grant`s day', lambda s, c: s.a == 'vetoed' and s.a2 == 'refused'),
    ('two answers are staged at once under `max-per-day:1`', lambda s, c: s.a == 'staged' and s.a2 == 'staged'),
    ('the operator watched a window whose commit then voided the act', lambda s, c: s.a2 == 'voided' and s.a == 'effective'
     or s.a == 'voided' and s.a2 == 'effective'),
]

SCEN = {
    'veto': dict(BACKUPS=0, RESTORES=0, VETOS=1, RELAYS=0),
    'cap': dict(BACKUPS=0, RESTORES=0, VETOS=1, MINTS=1, STAGE2=1, RELAYS=0),
    'restore-db': dict(RESTORE='db', VETOS=1, RELAYS=1, WITHDRAWS=1, OPENS=2),
    'restore-volume': dict(RESTORE='volume', VETOS=1, RELAYS=1, WITHDRAWS=1, OPENS=2),
}

READINGS = [
    ('LATE_VETO', 'superseded', 'veto', 'J1'),
    ('LATE_VETO', 'ignored', 'veto', 'J1'),
    ('COUNTS', 'effects', 'cap', ''),
    (('COUNTS', 'COMMIT_RECOUNT'), ('effects', False), 'cap', 'J3'),
    ('RECONCILE', 'lacks', 'restore-db', 'I3'),
    ('REQ_JOURNAL', False, 'restore-db', 'J5'),
    ('REQ_JOURNAL', False, 'restore-volume', 'J5'),
    ('REQ_IDS', 'table', 'restore-db', 'J8'),
    ('REQ_IDS', 'table', 'restore-volume', 'J8'),
]

MUTATIONS = [
    ('cap_ignored', 'cap', {}, 'J3'),
    ('restore_keeps_grants', 'restore-db', {}, 'I7'),
    ('restore_keeps_holds', 'restore-db', {}, 'I1'),
]

TRACES = [
    ('joint-late-veto-changes-nothing', 'veto', dict(LATE_VETO='superseded'), ('J1',)),
    ('joint-staged-then-effective-then-restored', 'restore-db', dict(RECONCILE='lacks'), ('I3',)),
    ('joint-withdrawn-request-comes-back', 'restore-db', dict(REQ_JOURNAL=False), ('J5',)),
    ('joint-request-id-issued-twice', 'restore-db', dict(REQ_IDS='table'), ('J8',)),
    ('joint-max-per-day-two-staged', 'cap', dict(COUNTS='effects', COMMIT_RECOUNT=False), ('J3',)),
    ('joint-max-per-day-what-counts', 'cap', {}, ('a voided act uses up the grant`s day: the next answer under it '
                                                  'goes to the operator',)),
    ('joint-max-per-day-effects-reading', 'cap', dict(COUNTS='effects'),
     ('two answers are staged at once under `max-per-day:1`',
      'the operator watched a window whose commit then voided the act')),
]
