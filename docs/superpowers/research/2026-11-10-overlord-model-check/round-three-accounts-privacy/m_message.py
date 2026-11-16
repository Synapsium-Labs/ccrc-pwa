"""Machine 6: one operator message, the root request it founds, and what a crash, a wipe and a restore do
(§3.8 H7, §5.1, §9.1, §9.4 rules 5 and 12, §7.6).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

The message row lives in the private store (a second SQLite file). The request that cites it lives in
`coord.db`. "A citing door commits in `coord.db` first, and then moves the message's state" (§9.1). The privacy
journal, which no snapshot carries, keeps the highest message id issued and the wipes.

`ever` counts the root requests the message has founded in truth, lost rows included. `acts` counts the relays
and starts made under its authority, which are effects in the world and survive every restore.

Bounds: two messages at most, one snapshot of both files, one restore, one crash, one wipe.
"""
from collections import namedtuple

DEFAULT = dict(
    SENDS=1, OPENS=2, ACTS=2, ACKS=1, CRASHES=1, WIPES=0, BACKUPS=0, RESTORES=0, DAYS=1, OWNER_ACTS=0,
    RESTORE='volume',         # what a restore brings back: 'volume' (both files and every journal on the volume)
                              # | 'db' (coord.db alone) | 'store' (the private store alone)
    # ---- switches: the safe readings -----------------------------------------------------------------------
    SPENT_READ='rows',        # the open door finds a message spent from: 'rows' (the root requests that cite it, in
                              # the door's own transaction) | 'state' (the message row's state, moved after the commit)
    BOOT_SPENT=True,          # the boot pass re-derives `spent` with `settled`: True | False (the text: `settled`)
    REDERIVE='both-ways',     # the boot pass on `settled`: 'both-ways' (a message no row cites is unsettled again)
                              # | 'adds-only'
    RESTORE_SPENDS=True,      # after a confirmed restore every message up to the journal's highest id is spent:
                              # True | False (the text does not say)
    WIPE_REQUESTS='needs-you',  # a wipe and the open requests that cite only wiped messages: 'needs-you' | 'stay'
    WITNESS_IDS=True,         # a witness off the volume holds the privacy journal's head and its highest message id:
                              # True | False (the text: the witness holds the authority and act journals' heads)
    MUTATION=None,
)

# m: none recorded delivered picked settled wiped. root: none open needs-you. mark: the door committed, the move waits
S = namedtuple('S', 'm spent mid his hij hiw wiped sent root ever acts acked mark day snap rest reused up '
                    'b_send b_open b_act b_ack b_crash b_wipe b_bak b_res b_day b_own')


def init(c):
    return S(m='none', spent=False, mid=0, his=0, hij=0, hiw=0, wiped=False, sent=False, root='none', ever=0, acts=0, acked=False,
             mark=False, day=False, snap=None, rest=False, reused=False, up=True,
             b_send=c.SENDS, b_open=c.OPENS, b_act=c.ACTS, b_ack=c.ACKS, b_crash=c.CRASHES, b_wipe=c.WIPES,
             b_bak=c.BACKUPS, b_res=c.RESTORES, b_day=c.DAYS, b_own=c.OWNER_ACTS)


def fmt(s):
    return ('private store: message %s%s%s (highest id %d; the journal`s %d) | coord.db: root request %s%s | in '
            'truth: %d root(s) founded, %d relay or start made%s%s%s' % (
                s.m if s.m == 'none' else '%d %s' % (s.mid, s.m), ', spent' if s.spent else '',
                ', older than 24 hours' if s.day else '', s.his, s.hij, s.root,
                ' (its message move not yet made)' if s.mark else '', s.ever, s.acts,
                '' if s.up else ' | SERVER DOWN', ' | restored' if s.rest else '',
                ' | AN ID WAS ISSUED TWICE' if s.reused else ''))


def is_spent(s, c):
    # §5.1: "One message founds one root request, within 24 hours. After that the message is spent"
    if s.day:
        return True
    if s.rest and c.RESTORE_SPENDS:
        return True
    if c.SPENT_READ == 'rows':
        return s.root != 'none' or s.spent
    return s.spent


def boot(s, c):
    """§3.8: "The boot pass re-derives `settled` from the citing rows (I8)." """
    cited = s.root != 'none'
    s2 = s._replace(up=True, mark=False)
    if s.m in ('recorded', 'delivered', 'picked', 'settled'):
        if cited:
            s2 = s2._replace(m='settled', spent=s.spent or c.BOOT_SPENT)
        elif s.m == 'settled' and not s.acked and c.REDERIVE == 'both-ways':
            s2 = s2._replace(m='picked')
    return s2


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    if not s.up:
        add('the server boots; the boot pass runs', boot(s, c), actor='server')
        return E
    if s.b_crash:
        add('the server crashes', s._replace(up=False, b_crash=s.b_crash - 1), actor='fault')
    # ---- the operator --------------------------------------------------------------------------------------
    if s.b_send and s.m in ('none', 'wiped') and not s.sent:
        # §3.8: "A message id is never used twice: the privacy journal keeps the highest id, across a wipe and a
        # restore."
        mid = (s.his if c.MUTATION == 'id_from_store' else max(s.his, s.hij)) + 1
        add('operator: sends a message; the prompt route records it as id %d, then delivery starts' % mid,
            s._replace(m='recorded', spent=False, mid=mid, his=mid, hij=max(s.hij, mid), hiw=max(s.hiw, mid),
                       sent=True, day=False, reused=s.reused or mid <= s.hiw, b_send=s.b_send - 1), actor='operator')
    if s.b_wipe and s.m not in ('none', 'wiped'):
        root = s.root
        if root == 'open' and c.WIPE_REQUESTS == 'needs-you':
            root = 'needs-you'
        add('operator: wipe everything', s._replace(m='wiped', spent=False, mark=False, root=root, sent=False,
                                                    wiped=True, b_wipe=s.b_wipe - 1), actor='operator')
    if s.b_bak and s.snap is None:
        add('`ccrc backup` snapshots coord.db and the private store',
            s._replace(snap=(s.m, s.spent, s.mid, s.his, s.root, s.acked, s.hij, s.m == 'wiped'),
                       b_bak=s.b_bak - 1), actor='operator')
    if s.b_res and s.snap is not None:
        m, spent, mid, his, root, acked, hij, jwiped = s.snap
        s2 = s._replace(b_res=s.b_res - 1, rest=True, mark=False)
        if c.RESTORE in ('volume', 'store'):
            # §9.4 rule 12: the privacy journal replays a wipe. A snapshot of the whole volume carries the journal
            # too, so it replays only what the journal held when the snapshot was taken (§7.6 says so of the
            # authority journal).
            replay_wipe = jwiped if c.RESTORE == 'volume' else s.m == 'wiped'
            if c.RESTORE == 'volume':
                s2 = s2._replace(hij=max(hij, s.hiw) if c.WITNESS_IDS else hij)
                if c.WITNESS_IDS and s.wiped and not jwiped:
                    replay_wipe = True            # the witness holds a head the journal lacks: the store stays wiped
            m2 = 'wiped' if replay_wipe else m
            s2 = s2._replace(m=m2, mid=mid if m2 != 'none' else s.mid, spent=spent, his=his, acked=acked,
                             sent=s.sent and m2 != 'none')
        if c.RESTORE in ('volume', 'db'):
            s2 = s2._replace(root=root)
        add('operator: restores %s and confirms the restore; the boot pass runs' % (
            {'volume': 'the whole volume', 'db': 'coord.db alone', 'store': 'the private store alone'}[c.RESTORE]),
            boot(s2, c), actor='operator', restore=True)
    # ---- the lanes -----------------------------------------------------------------------------------------
    if s.m == 'recorded':
        add('delivery lane: the nudge is delivered', s._replace(m='delivered'), actor='server')
    if s.m == 'delivered':
        add('the hook reports the pick-up', s._replace(m='picked'), actor='server')
    if s.b_day and s.m not in ('none', 'wiped') and not s.day:
        add('24 hours pass since the message', s._replace(day=True, b_day=s.b_day - 1), actor='time')
    if s.mark:
        add('the open door moves the message to `settled` and `spent`, in the private store',
            s._replace(m='settled', spent=True, mark=False), actor='server')
    # ---- the Overlord's doors ------------------------------------------------------------------------------
    if s.mark:
        return E          # the open door has not returned yet: only its own move, or a crash, comes next
    if s.b_open and s.m in ('picked', 'settled', 'delivered'):
        spent = is_spent(s, c) and c.MUTATION != 'spent_ignored'
        if spent:
            add('Overlord: opens a root request that cites the message; refused `said-not-operator` (spent)',
                s._replace(b_open=s.b_open - 1), actor='overlord')
        else:
            add('Overlord: opens a root request that cites the message; committed in coord.db',
                s._replace(root='open', ever=s.ever + 1, mark=True, b_open=s.b_open - 1), actor='overlord',
                opened=True, day=s.day)
    if s.b_open and s.m == 'wiped' and c.MUTATION == 'wiped_still_cited':
        add('Overlord: opens a root request that cites the wiped message; committed',
            s._replace(root='open', ever=s.ever + 1, b_open=s.b_open - 1), actor='overlord', opened=True, wiped=True)
    if s.b_act and s.root == 'open':
        # §5.1: "the relay, kickoff and start doors refuse `said-not-operator`" unless the stored hash equals the row's
        if s.m in ('wiped', 'none') and c.MUTATION != 'wiped_still_cited':
            add('Overlord: relays under the request; refused `said-not-operator` (the message is no longer on record)',
                s._replace(b_act=s.b_act - 1), actor='overlord')
        else:
            add('Overlord: relays under the request (one relay per owner, H7)',
                s._replace(acts=s.acts + 1, b_act=s.b_act - 1), actor='overlord', act=True,
                wiped=s.m in ('wiped', 'none'))
    if s.b_own and s.root == 'open' and s.acts:
        # §6.3: `goals modify` takes "a request this programme owns whose relay carried the widening"
        add('the owner: `goals modify` cites the relayed request', s._replace(b_own=s.b_own - 1), actor='owner',
            owner=True, wiped=s.m in ('wiped', 'none'))
    if s.b_ack and s.m == 'picked':
        add('Overlord: `acknowledge` settles the message', s._replace(m='settled', acked=True, b_ack=s.b_ack - 1),
            actor='overlord')
    return E


def ms1(s, c):
    # §5.1: "One message founds one root request"; "A root request authorises one relay per owner"
    if s.ever > 1:
        return 'one message founded %d root requests' % s.ever
    return None


def ms2(s, c):
    if s.reused:
        return 'a message id was issued twice'
    return None


def ms3(s, lbl, info, s2, c):
    # the task's check: a wiped message cannot authorise a new act
    if info.get('wiped') and (info.get('act') or info.get('opened') or info.get('owner')):
        return '%s under a message the operator wiped' % (
            'the owner changed its goals' if info.get('owner') else 'an act landed')
    return None


def ms6(s, c):
    # §9.4 rule 12: "a restore never un-wipes"
    if s.wiped and s.m not in ('wiped', 'none') and s.mid and s.rest and s.sent is False:
        return 'a restore brought back a message the operator wiped'
    return None


def ms4(s, c):
    # I8, read for a restore: a message that reads `settled` while no row cites it is on no card and no list
    if s.up and s.m == 'settled' and s.root == 'none' and not s.acked and not s.mark:
        return 'the message reads `settled`, no request cites it, and nothing lists it'
    return None


def ms5(s, lbl, info, s2, c):
    if info.get('opened') and info.get('day'):
        return 'a message older than 24 hours founded a root request'
    return None


STATE_CHECKS = [('MS1', ms1), ('MS2', ms2), ('MS4', ms4), ('MS6', ms6)]
EDGE_CHECKS = [('MS3', ms3), ('MS5', ms5)]
LIVE_CHECKS = []
FACTS = [('the message founds a root request', lambda s, c: s.ever == 1)]

SCEN = {
    'crash': dict(CRASHES=1, OPENS=2, ACTS=0, DAYS=1),
    'restore-volume': dict(CRASHES=0, BACKUPS=1, RESTORES=1, RESTORE='volume', OPENS=2, ACTS=1, DAYS=0, SENDS=2),
    'restore-db': dict(CRASHES=0, BACKUPS=1, RESTORES=1, RESTORE='db', OPENS=2, ACTS=1, DAYS=0),
    'restore-store': dict(CRASHES=0, BACKUPS=1, RESTORES=1, RESTORE='store', OPENS=2, ACTS=1, DAYS=0, SENDS=2),
    'wipe': dict(CRASHES=0, WIPES=1, OPENS=1, ACTS=2, OWNER_ACTS=1, DAYS=0, SENDS=2),
    'wipe-volume': dict(CRASHES=0, WIPES=1, BACKUPS=1, RESTORES=1, RESTORE='volume', OPENS=0, ACTS=0, DAYS=0, SENDS=1),
}

READINGS = [
    (('SPENT_READ', 'BOOT_SPENT'), ('state', False), 'crash', 'MS1'),
    ('RESTORE_SPENDS', False, 'restore-volume', 'MS1'),
    (('RESTORE_SPENDS', 'SPENT_READ'), (False, 'state'), 'restore-store', 'MS1'),
    ('REDERIVE', 'adds-only', 'restore-db', 'MS4'),
    ('WIPE_REQUESTS', 'stay', 'wipe', 'MS3'),
    ('WITNESS_IDS', False, 'restore-volume', 'MS2'),
    ('WITNESS_IDS', False, 'wipe-volume', 'MS6'),
]

MUTATIONS = [
    ('id_from_store', 'restore-store', {}, 'MS2'),
    ('spent_ignored', 'crash', {}, 'MS1'),
    ('wiped_still_cited', 'wipe', {}, 'MS3'),
]

TRACES = [
    ('message-crash-founds-two-roots', 'crash', dict(SPENT_READ='state', BOOT_SPENT=False), ('MS1',)),
    ('message-restore-founds-two-roots', 'restore-volume', dict(RESTORE_SPENDS=False), ('MS1',)),
    ('message-settled-with-no-request', 'restore-db', dict(REDERIVE='adds-only'), ('MS4',)),
    ('message-wiped-request-still-acts', 'wipe', dict(WIPE_REQUESTS='stay'), ('MS3',)),
    ('message-volume-restore-reuses-an-id', 'restore-volume', dict(WITNESS_IDS=False), ('MS2',)),
    ('message-volume-restore-unwipes', 'wipe-volume', dict(WITNESS_IDS=False), ('MS6',)),
]
