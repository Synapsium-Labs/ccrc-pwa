"""Machine 4: one gate row of the decision model (`grant.inside`), its line, and one grant-backed answer.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it. Section numbers in comments are that file's (§3.7 H6, §7.2 "The blind check").

The row is off by default. The operator arms it (step-up, Table 11.2). While armed it fails closed: anything short
of a clear yes is `defer`. Drift on the anchor set, a changed key or the canary sends it back to shadow, where it
"stays shut" until the operator arms it again or switches it off. Answers are gathered before the act's transaction
and passed in; there is "one answer per key ... recorded and reused". A staged act's commit "reads that record and
asks nothing again".

The case in hand: an answer that is NOT inside its grant. `OLD_SAYS` is what the model said of it while it answered as
its line was measured, and `NEW_SAYS` what it says after it drifted, or under a new model id. By default the old
model says no and the changed one says yes: the costly error.

Bounds: one act, one drift, one change of model id, one outage, two operator switches, one retry by the Overlord.
"""
from collections import namedtuple

DEFAULT = dict(
    ARMED0=True, DRIFTS=1, KEYS=1, DOWNS=1, RETRIES=1, SWITCHES=2, OLD_SAYS='no', NEW_SAYS='yes',
    # ---- switches: the safe readings ---------------------------------------------------------------------
    ANCHOR='asked',          # the daily anchor set: 'asked' (asked again each day) | 'cached' ("never asked twice")
    COMMIT_SHADOW='shut',    # a staged act commits while the row is in server shadow: 'shut' (voided) | 'letter'
                             # ("if the check is armed at the commit and the row holds no clear yes": not armed, so it commits)
    COMMIT_KEY='void',       # the record on the row was gathered under another key: 'void' | 'reuse'
    REARM='readmit',         # arming again after shadow: 'readmit' (the labelled cases are asked again first) | 'tap'
    RECORDS='admission',     # a recorded answer is reused: 'admission' (only under the key and the admission of the
                             # line it was gathered under) | 'kept' ("one answer per key ... recorded and reused")
    GATHERED='checked',      # the transaction, on an answer gathered before it: 'checked' (it reads the row's key and
                             # line itself; an answer from another key or admission is no clear yes) | 'used'
    OFF_DOOR='stepup',       # switching an armed gate off: 'stepup' (journalled, behind the step-up) | 'plain'
    MUTATION=None,
)

S = namedtuple('S', 'op srv key model down line_key stale epoch rec gathered act how b_drift b_key b_down b_retry b_sw')
# rec, gathered: an answer for the act's state: (answer, key, epoch) or None. epoch: how many times the line was
# admitted. line_key: the key the line was admitted under. stale: a drift was found since the line was admitted.


def init(c):
    return S(op='on' if c.ARMED0 else 'off', srv='ok', key=0, model='good', down=False, line_key=0, stale=False, epoch=0, rec=None,
             gathered=None, act='none', how=None, b_drift=c.DRIFTS, b_key=c.KEYS, b_down=c.DOWNS, b_retry=c.RETRIES,
             b_sw=c.SWITCHES)


def fmt(s):
    return ('row %s%s, model id %d (%s%s), line %s | recorded %s, gathered %s | act %s%s' % (
        'armed' if s.op == 'on' else 'off', ', sent back to shadow' if s.srv == 'shadow' else '', s.key, s.model, ', down' if s.down else '',
        'measured on this model' if fresh(s) else 'measured before the change', s.rec, s.gathered, s.act,
        (' on %s' % s.how) if s.how else ''))


def fresh(s):
    return s.line_key == s.key and not s.stale


def model_says(s, c):
    return c.OLD_SAYS if (s.model == 'good' and s.key == 0) else c.NEW_SAYS


def usable(a, s):
    """An answer gathered under the row's current key and the current admission of its line."""
    return a is not None and a[1] == s.key and a[2] == s.epoch


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    # ---- the world --------------------------------------------------------------------------------------------
    if s.b_drift and s.model == 'good':
        add('the hosted model changes behind the same id: it drifts', s._replace(model='drifted', b_drift=s.b_drift - 1), actor='world')
    if s.b_key and s.key == 0:
        # §3.7: "The line's key ... Any change sends the row back to shadow."
        s2 = s._replace(key=1, b_key=s.b_key - 1)
        if c.MUTATION != 'key_change_ignored':
            s2 = s2._replace(srv='shadow' if s.op == 'on' else s.srv)
        add('the model id changes', s2, actor='world')
    if s.b_down and not s.down:
        add('the model is down', s._replace(down=True, b_down=s.b_down - 1), actor='world')
    # ---- the anchor lane (§3.7 "Checked after arming") -----------------------------------------------------------
    if s.model == 'drifted' and not s.down and s.op == 'on' and s.srv == 'ok' and c.ANCHOR == 'asked':
        s2 = s._replace(srv='shadow', stale=True)
        add('anchor lane: the 20 fixture states are asked again; the bands moved; the row goes back to shadow', s2, actor='server')
    if s.model == 'drifted' and not s.down and s.op == 'on' and s.srv == 'ok' and c.ANCHOR == 'cached':
        add('anchor lane: one answer per key is recorded and reused; the bands read as yesterday\'s', s, actor='server')
    # ---- the server re-admits the line (the report's edit) --------------------------------------------------------
    if not fresh(s) and not s.down and c.REARM == 'readmit':
        add('server: asks the labelled cases again under this model and admits a line by the bound',
            s._replace(line_key=s.key, stale=False, epoch=s.epoch + 1), actor='server', readmit=True)
    # ---- the operator's switches ----------------------------------------------------------------------------------
    if s.b_sw:
        if s.op == 'on':
            add('operator: switches the row off%s' % (', behind the step-up' if c.OFF_DOOR == 'stepup' else ''),
                s._replace(op='off', srv='ok', b_sw=s.b_sw - 1), actor='operator-stepup' if c.OFF_DOOR == 'stepup' else 'operator',
                eases=True, journal=c.OFF_DOOR == 'stepup')
        if s.op == 'off' or s.srv == 'shadow':
            if c.REARM == 'tap' or fresh(s):
                add('operator: arms the row, behind the step-up', s._replace(op='on', srv='ok', b_sw=s.b_sw - 1), actor='operator-stepup')
    if c.MUTATION == 'refit_eases_alone' and s.op == 'on' and s.srv == 'ok' and s.act == 'none':
        add('server: a refit moves the yes line down; the recorded answer now reads as a clear yes',
            s._replace(rec=('yes', s.key, s.epoch) if s.rec else s.rec), actor='server', eases=True, journal=False)
    # ---- the door gathers, then the act's transaction (§3.7 "Answers come first, then the act") -------------------
    if s.act in ('none', 'deferred') and s.gathered is None and (s.act == 'none' or s.b_retry):
        b = s.b_retry - (1 if s.act == 'deferred' else 0)
        if s.op == 'off':
            add('door: the row is off, nothing is asked', s._replace(gathered='not-run', act='none', b_retry=b), actor='overlord')
        elif s.rec is not None and (c.MUTATION == 'record_any_key' or (s.rec[1] == s.key and (c.RECORDS == 'kept' or s.rec[2] == s.epoch))):
            # "Never asked twice. There is one answer per key ... It is recorded and reused."
            add('door: the recorded answer (%s) is reused' % s.rec[0], s._replace(gathered=s.rec, act='none', b_retry=b), actor='overlord')
        elif s.down:
            add('door: the call ends `unavailable` after its deadline', s._replace(gathered=('unavailable', s.key, s.epoch), act='none', b_retry=b),
                actor='overlord')
        else:
            a = (model_says(s, c), s.key, s.epoch)
            add('door: asks the model before the transaction: %s' % a[0], s._replace(gathered=a, rec=a, act='none', b_retry=b), actor='overlord')
    if s.act == 'none' and s.gathered is not None:
        if s.op == 'off':
            # §7.2: "the check is skipped: the code checks and the veto window stand, and the act row records that it did not run"
            add('transaction: the check did not run; the answer is staged', s._replace(act='staged', how='skipped', gathered=None), actor='overlord')
        elif s.srv == 'shadow' and c.MUTATION != 'shadow_is_skipped':
            add('transaction: the row is in shadow; `defer`', s._replace(act='deferred', gathered=None), actor='overlord')
        elif (s.gathered[0] == 'yes' and (c.GATHERED == 'used' or c.MUTATION == 'record_any_key' or usable(s.gathered, s))) or \
                (c.MUTATION == 'fail_open_gate' and s.gathered[0] == 'unavailable') or \
                (c.MUTATION == 'shadow_is_skipped' and s.srv == 'shadow'):
            add('transaction: a clear yes; the answer is staged', s._replace(act='staged', how='yes', gathered=None, rec=s.gathered if s.gathered[0] == 'yes' else s.rec),
                actor='overlord', used=s.gathered, fail=s.gathered[0] != 'yes')
        else:
            add('transaction: no clear yes it may use (%s); `defer`' % s.gathered[0], s._replace(act='deferred', gathered=None), actor='overlord')
    # ---- the commit of the staged act (§7.2) ------------------------------------------------------------------------
    if s.act == 'staged':
        armed = s.op == 'on' and s.srv == 'ok'
        shut = s.op == 'on' and s.srv == 'shadow'
        yes = s.rec is not None and s.rec[0] == 'yes' and s.how == 'yes'
        if shut:
            void = c.COMMIT_SHADOW == 'shut'
        elif armed:
            void = not yes or (not usable(s.rec, s) and c.COMMIT_KEY == 'void')
        else:
            void = False                          # the operator's own switch makes the gate skipped
        if void:
            add('veto window runs out: the commit finds no clear yes it may use; `voided`, the item is the operator\'s',
                s._replace(act='voided'), actor='server')
        else:
            add('veto window runs out: the commit reads the record and asks nothing again; `effective`',
                s._replace(act='effective'), actor='server', commit=True)
    if s.down:
        add('the model is back', s._replace(down=False), actor='world')
    return E


def d1(s, lbl, info, s2, c):
    # §3.7: "A gate sent back to shadow stays shut."
    if s.op == 'on' and s.srv == 'shadow' and s2.op == 'on' and s2.srv == 'shadow' and s.how == 'yes' and s2.act == 'effective' and s.act == 'staged':
        return 'a staged act committed on a recorded yes while the row was in shadow'
    if s.op == 'on' and s.srv == 'shadow' and s2.act == 'staged' and s.act != 'staged':
        return 'an answer was staged while the row was in shadow'
    return None


def d2(s, lbl, info, s2, c):
    # a yes is used only if it was gathered under the row's current key and since the line was last admitted
    a = None
    if s2.act == 'staged' and s.act != 'staged' and s2.how == 'yes':
        a = info.get('used')
    elif info.get('commit') and s.how == 'yes':
        a = s.rec
    if a is not None and s.op == 'on' and a[0] == 'yes':
        if a[1] != s.key:
            return 'a yes gathered under another model id let an act through'
        if a[2] != s.epoch:
            return 'a yes gathered before the line was admitted again let an act through'
    return None


def d4(s, c):
    if s.op == 'on' and s.srv == 'ok' and not fresh(s):
        return 'the row is armed on a line whose bound was measured before the model changed'
    return None


def d5(s, lbl, info, s2, c):
    # §3.7: "Easing a gate is an authority change": journalled, and the operator's tap behind the step-up (Table 11.2)
    if info.get('eases') and (info.get('actor') != 'operator-stepup' or not info.get('journal')):
        return 'a gate was eased outside an operator\'s step-up door, or with no record in the authority journal'
    return None


def d6(s, lbl, info, s2, c):
    if info.get('fail'):
        return 'an answer was staged on a call that failed'
    return None


STATE_CHECKS = [('D4', d4)]
EDGE_CHECKS = [('D1', d1), ('D2', d2), ('D5', d5), ('D6', d6)]
LIVE_CHECKS = [
    # a drifted model is found by the server alone
    ('D3', lambda s, c: s.model == 'drifted' and s.op == 'on' and s.srv == 'ok' and not s.stale,
     lambda s, c: s.srv == 'shadow' or s.op == 'off' or s.model != 'drifted',
     lambda lbl: lbl.startswith('anchor lane') or lbl.startswith('server') or lbl == 'the model is back'),
    # once the line is admitted again, a state answered before can be asked again
    ('D7', lambda s, c: s.op == 'on' and s.srv == 'ok' and fresh(s) and not s.down and s.rec is not None and not usable(s.rec, s)
     and s.act == 'deferred' and s.b_retry > 0 and s.gathered is None,
     lambda s, c: usable(s.rec, s) or s.act in ('staged', 'effective', 'voided'), lambda lbl: lbl.startswith('door') or lbl.startswith('transaction')),
]
FACTS = [
    ('an answer that is not inside its grant takes effect', lambda s, c: s.act == 'effective' and s.how == 'yes'),
    ('the armed row defers it', lambda s, c: s.act == 'deferred' and s.op == 'on' and s.srv == 'ok'),
]
SCEN = {
    'drift': dict(KEYS=0),
    'key': dict(DRIFTS=0),
    'key-old-yes': dict(DRIFTS=0, OLD_SAYS='yes', NEW_SAYS='no'),
    'down': dict(DRIFTS=0, KEYS=0),
    'off': dict(DRIFTS=0, KEYS=0, DOWNS=0),
}
READINGS = [
    ('ANCHOR', 'cached', 'drift', 'D3'),
    ('COMMIT_SHADOW', 'letter', 'drift', 'D1 D2'),
    ('COMMIT_KEY', 'reuse', 'key-old-yes', 'D2'),
    ('REARM', 'tap', 'drift', 'D4'),
    ('RECORDS', 'kept', 'drift', 'D7'),
    (('RECORDS', 'GATHERED'), ('kept', 'used'), 'drift', 'D2 D7'),
    ('GATHERED', 'used', 'drift', 'D2'),
    ('OFF_DOOR', 'plain', 'off', 'D5'),
]
MUTATIONS = [
    ('fail_open_gate', 'down', {}, 'D6'),
    ('shadow_is_skipped', 'drift', {}, 'D1'),
    ('key_change_ignored', 'key', {}, 'D4'),
    ('record_any_key', 'key-old-yes', {}, 'D2'),
    ('refit_eases_alone', 'off', {}, 'D5'),
]
TRACES = [
    ('decision-anchor-cached', 'drift', dict(ANCHOR='cached'), ('D3',)),
    ('decision-commit-in-shadow', 'drift', dict(COMMIT_SHADOW='letter'), ('D1',)),
    ('decision-record-reused-after-rearm', 'drift', dict(RECORDS='kept', GATHERED='used', DOWNS=0), ('D2',)),
    ('decision-record-never-asked-again', 'drift', dict(RECORDS='kept', DOWNS=0), ('D7',)),
    ('decision-gathered-then-stale', 'drift', dict(GATHERED='used', DOWNS=0), ('D2',)),
    ('decision-commit-other-key', 'key-old-yes', dict(COMMIT_KEY='reuse', DOWNS=0), ('D2',)),
    ('decision-rearm-old-line', 'drift', dict(REARM='tap'), ('D4',)),
    ('decision-off-switch', 'off', dict(OFF_DOOR='plain'), ('D5',)),
]
