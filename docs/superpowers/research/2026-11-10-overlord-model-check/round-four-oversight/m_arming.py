"""Machine 3: arming a kind of answer, the ladder's latches, the replay gate, a fallback, and one grant.

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2542 merged it. Section numbers in comments are that file's.

A kind (`answer-item`) is armed by the operator once the first gate passes (Table 9.5a, §7.5). A release changes
the skill or the card template: the digest (Table 3.3.11b, "Evaluation due"). A renewal mints the next generation on
the release's digest, on the designated class or on the fallback class (§3.4). "Answers stay in shadow until the
replay passes that digest": the third gate, "the bound is no lower than the last generation's less 0.05" (Table
9.5a). A missed drill returns answers to shadow once drills latch (Table 7.5a, §7.5). One grant names the designated
class (§7.2).

A bound is a level: one level is 0.05. The kind is armed at level L0. A replay returns a level within two of the
reference.

Bounds: RELEASES releases, one fallback and one return, one drill, one overturn burst, RERUNS re-runs of a failed
replay, levels 0 to LMAX.
"""
from collections import namedtuple

DEFAULT = dict(
    RELEASES=2, FALLBACKS=1, DRILLS=1, BURSTS=1, RERUNS=1, L0=3, LMAX=4, GRANT=0, ARMED0=False, RESTORE=0,
    # ---- switches: the safe readings ---------------------------------------------------------------------
    GATE3_REF='armed',        # the third gate compares with: 'armed' (the bound the operator armed the kind on)
                              # 'last' ("the last generation's": the bound of the last replay that passed: the text)
    FAIL_EXIT='operator',     # after a replay fails: 'operator' (an item; the operator may arm on that digest, step-up)
                              # 'rerun' (the lane runs it again) | 'none' (the text names no exit)
    GRANT_MODEL='strict',     # a grant off the class it names: 'strict' (never holds) | 'replay' (holds once the
                              # running class's replay has passed: Table 7.2a)
    FB_AHEAD=True,            # the replay lane can replay the fallback class while the designated class runs (§3.4)
    DRILL_MODE='latch',       # 'latch' | 'advisory' (while the replay body can tell a drill from a real case)
    MUTATION=None,
)

S = namedtuple('S', 'orung armed armed_lvl ref latch_drill latch_adv dig gdig gmodel rp rf lvl grant snap rolled '
                    'b_rel b_fb b_drill b_burst b_rerun b_restore')
# rp: the (digest, class) pairs whose replay passed, with the level each passed at. rf: pairs whose replay failed.


def init(c):
    return S(orung='full', armed=c.ARMED0, armed_lvl=c.L0 if c.ARMED0 else None, ref=c.L0, latch_drill=False,
             latch_adv=False, dig=0, gdig=0, gmodel='des', rp=frozenset([(0, 'des', c.L0)]), rf=frozenset(), lvl=c.L0,
             grant='live' if c.GRANT else 'none', snap=None, rolled=False,
             b_rel=c.RELEASES, b_fb=c.FALLBACKS, b_drill=c.DRILLS, b_burst=c.BURSTS, b_rerun=c.RERUNS, b_restore=c.RESTORE)


def passed(s, pair):
    return any((d, m) == pair for d, m, _ in s.rp)


def level_of(s, pair):
    for d, m, lv in s.rp:
        if (d, m) == pair:
            return lv
    return None


def eff_rung(s, c):
    # §7.5: "`effectiveRung` is the lowest of the operator's rung and every cap a standing latch or condition sets"
    r = s.orung
    if s.latch_adv or s.rolled:
        r = 'advise'
    # Table 7.5a: "a generation off the designated model, its replay not passed | one under the operator's rung"
    if s.gmodel == 'fb' and not passed(s, (s.gdig, 'fb')) and c.MUTATION != 'fallback_no_cap':
        r = 'advise'
    return r


def answers_live(s, c):
    # §6.7: the effective rung is `full` and the kind is armed live; §7.5: a missed drill returns answers to shadow;
    # Table 3.3.11b: "Answers stay in shadow until the replay passes that digest"
    ok = passed(s, (s.gdig, s.gmodel)) or c.MUTATION == 'answers_before_replay'
    return eff_rung(s, c) == 'full' and s.armed and not s.latch_drill and ok


def grant_usable(s, c):
    if s.grant != 'live' or eff_rung(s, c) != 'full':
        return False
    if s.gmodel == 'des':
        return True
    # §7.2 conditions: "The grant holds only on the model class it names." Table 7.2a: suspended while "a generation
    # is off the model the grant names, and that model's replay has not passed"
    return c.GRANT_MODEL == 'replay' and passed(s, (s.gdig, 'fb'))


def fmt(s):
    return ('rung %s, kind %s%s | latches: drill %d, advise %d | release %d, generation on digest %d, class %s | replay '
            'passed %s, failed %s | reference level %d, answering at level %s | grant %s' % (
                s.orung, 'armed' if s.armed else 'in shadow', (' at level %d' % s.armed_lvl) if s.armed else '',
                s.latch_drill, s.latch_adv, s.dig, s.gdig, 'designated' if s.gmodel == 'des' else 'fallback',
                sorted(s.rp), sorted(s.rf), s.ref, s.lvl, s.grant))


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    pair = (s.gdig, s.gmodel)
    # ---- the operator's doors (§7.5: "Only the operator steps up") ---------------------------------------------
    if not s.armed and not s.rolled:
        add('operator: arms the kind from its item, behind the step-up', s._replace(armed=True, armed_lvl=s.lvl if passed(s, pair) else s.ref),
            actor='operator-stepup')
    if s.latch_drill and not s.rolled:
        add('operator: clears the missed-drill latch, behind the step-up', s._replace(latch_drill=False), actor='operator-stepup')
    if s.latch_adv and not s.rolled:
        add('operator: clears the advise latch, behind the step-up', s._replace(latch_adv=False), actor='operator-stepup')
    if s.grant == 'susp' and not s.rolled:
        add('operator: returns the grant from its latched suspension, behind the step-up', s._replace(grant='live'),
            actor='operator-stepup')
    if s.rolled:
        # §7.6: Confirm the restore takes the stricter of the database and the journal, and keeps every grant latched
        j = s.snap
        add('operator: Confirm the restore, behind the step-up',
            s._replace(rolled=False, armed=s.armed and j[0], latch_drill=s.latch_drill or j[1], latch_adv=True,
                       grant='susp' if s.grant != 'none' else 'none', snap=None), actor='operator-stepup')
        return E
    # ---- releases, renewals, the fallback (Table 3.3.11b, §3.4) -------------------------------------------------
    if s.b_rel:
        add('a release changes the skill or the card template: digest %d' % (s.dig + 1), s._replace(dig=s.dig + 1, b_rel=s.b_rel - 1),
            actor='world')
    if s.gdig != s.dig:
        s2 = s._replace(gdig=s.dig)
        add('renewal lane (evaluation due): a fresh start on digest %d' % s.dig, s2._replace(lvl=level_of(s2, (s2.gdig, s2.gmodel))),
            actor='server', condition_ends=passed(s2, (s2.gdig, s2.gmodel)))
    if s.b_fb and s.gmodel == 'des':
        s2 = s._replace(gmodel='fb', gdig=s.dig, b_fb=s.b_fb - 1)
        add('ccd: the designated class cannot be served; the next generation runs the fallback class',
            s2._replace(lvl=level_of(s2, (s2.gdig, 'fb'))), actor='world', condition_ends=passed(s2, (s2.gdig, 'fb')))
    if s.gmodel == 'fb':
        s2 = s._replace(gmodel='des', gdig=s.dig)
        add('ccd: the hold-down is over; the next generation runs the designated class', s2._replace(lvl=level_of(s2, (s2.gdig, 'des'))),
            actor='server', condition_ends=True)
    # ---- the replay lane (§9.5, Table 9.5a row 3) ----------------------------------------------------------------
    targets = [pair]
    if c.FB_AHEAD and s.gmodel == 'des' and s.gdig == s.dig:
        targets.append((s.dig, 'fb'))            # §3.4: "The fallback class is replayed at each release, ahead of need."
    for tp in targets:
        if passed(s, tp):
            continue
        failed = tp in s.rf
        if failed and not (c.FAIL_EXIT == 'rerun' and s.b_rerun):
            continue
        for r in sorted(set(max(0, min(c.LMAX, s.ref + d)) for d in (-2, -1, 0, 1))):
            ok = r >= s.ref - 1 or c.MUTATION == 'gate3_always_passes'    # "no lower than ... less 0.05"
            s2 = s._replace(b_rerun=s.b_rerun - (1 if failed else 0))
            if ok:
                s2 = s2._replace(rp=s.rp | {tp + (r,)}, rf=s.rf - {tp})
                if c.GATE3_REF == 'last':
                    s2 = s2._replace(ref=r)
                if tp == pair:
                    s2 = s2._replace(lvl=r)
                add('replay lane: digest %d on the %s class replays at level %d: it passes' % (tp[0], 'designated' if tp[1] == 'des' else 'fallback', r),
                    s2, actor='server', condition_ends=True)
            else:
                add('replay lane: digest %d on the %s class replays at level %d: it fails' % (tp[0], 'designated' if tp[1] == 'des' else 'fallback', r),
                    s2._replace(rf=s.rf | {tp}), actor='server')
    if pair in s.rf and not passed(s, pair) and c.FAIL_EXIT == 'operator':
        # the report's edit: one item, and the operator may arm the kind on that digest from it
        add('operator: arms the kind on the failed digest from its item, behind the step-up',
            s._replace(rp=s.rp | {pair + (s.ref - 2 if s.ref >= 2 else 0,)}, rf=s.rf - {pair}, armed=True,
                       armed_lvl=max(0, s.ref - 2), ref=max(0, s.ref - 2), lvl=max(0, s.ref - 2)), actor='operator-stepup')
    # ---- the judges (Table 7.5a) ---------------------------------------------------------------------------------
    if s.b_drill:
        s2 = s._replace(b_drill=s.b_drill - 1)
        if c.DRILL_MODE == 'latch' and c.MUTATION != 'drill_ignored':
            s2 = s2._replace(latch_drill=True)
        add('drill lane: a drill is missed', s2, actor='server', drill=True)
    if s.b_burst:
        add('three answers are overturned in 24 hours: the ladder latches at advise',
            s._replace(latch_adv=True, b_burst=s.b_burst - 1, grant='susp' if s.grant == 'live' else s.grant), actor='operator')
    if c.MUTATION == 'server_clears_latch' and s.latch_drill:
        add('server: the missed-drill latch is cleared after a week', s._replace(latch_drill=False), actor='server')
    # ---- a restore (§7.6): the rows go back, the journal does not -------------------------------------------------
    if s.b_restore and s.snap is None:
        add('a snapshot is taken', s._replace(snap=(s.armed, s.latch_drill, s.latch_adv)), actor='world')
    if s.b_restore and s.snap is not None:
        j = (s.armed, s.latch_drill, s.latch_adv)                     # what the journal holds: the rows before the restore
        a0, d0, v0 = s.snap
        s2 = s._replace(armed=a0, latch_drill=d0, latch_adv=v0, snap=j, b_restore=s.b_restore - 1)
        if c.MUTATION != 'restore_undetected':
            s2 = s2._replace(rolled=True)                             # boot coherence, or a witness: `authority-rolled-back`
        add('a restore brings back the snapshot\'s rows', s2, actor='fault')
    return E


def a1(s, lbl, info, s2, c):
    # I11: authority widens only in the transaction of an operator's step-up door, or when a condition measurably ends
    wid = (answers_live(s2, c) and not answers_live(s, c)) or (grant_usable(s2, c) and not grant_usable(s, c))
    if wid and info.get('actor') != 'operator-stepup' and not info.get('condition_ends'):
        return 'answers or a grant went live outside an operator\'s step-up door, with no condition ending'
    return None


def a2(s, c):
    if answers_live(s, c) and not passed(s, (s.gdig, s.gmodel)):
        return 'answers are live on a digest and class the replay has not passed'
    return None


def a3(s, c):
    # added by this model: the operator armed the kind on a bound; a change may cost 0.05 of it, not 0.05 each time
    if answers_live(s, c) and s.lvl is not None and s.lvl < s.armed_lvl - 1:
        return 'answers are live at level %d: more than 0.05 under the bound the operator armed the kind on (level %d)' % (s.lvl, s.armed_lvl)
    return None


def a6(s, c):
    if grant_usable(s, c) and s.gmodel != 'des':
        return 'a grant that names the designated class is used by a generation on the fallback class'
    return None


def a7(s, lbl, info, s2, c):
    if info.get('drill') and c.DRILL_MODE == 'latch' and answers_live(s, c) and answers_live(s2, c):
        return 'a missed drill left answers live while drills latch'
    return None


def a9(s, c):
    # Table 7.5a: "a generation off the designated model, its replay not passed | one under the operator's rung"
    if s.gmodel == 'fb' and not passed(s, (s.gdig, 'fb')) and s.orung == 'full' and eff_rung(s, c) == 'full':
        return 'a generation on the fallback class, its replay not passed, runs at the operator\'s own rung'
    return None


STATE_CHECKS = [('A2', a2), ('A3', a3), ('A6', a6), ('A9', a9)]
EDGE_CHECKS = [('A1', a1), ('A7', a7)]
NOREL = lambda lbl: not lbl.startswith('a release') and not lbl.startswith('ccd:')
LIVE_CHECKS = [
    # after a failed replay the armed kind can answer again without waiting for another release
    ('A4', lambda s, c: s.armed and not s.latch_drill and not s.latch_adv and not s.rolled and s.orung == 'full'
     and (s.gdig, s.gmodel) in s.rf and s.gdig == s.dig and s.gmodel == 'des' and s.b_rerun == c.RERUNS,
     lambda s, c: answers_live(s, c), NOREL),
    # every latch has a door that clears it
    ('A5', lambda s, c: s.latch_drill or s.latch_adv, lambda s, c: not s.latch_drill and not s.latch_adv,
     lambda lbl: lbl.startswith('operator')),
    # §3.4: "A routine fallback costs nothing": the fallback class can be replayed before it is needed
    ('A8', lambda s, c: s.gmodel == 'des' and s.gdig == s.dig and s.b_fb == c.FALLBACKS and not passed(s, (s.dig, 'fb'))
     and (s.dig, 'fb') not in s.rf and not s.rolled,
     lambda s, c: passed(s, (s.dig, 'fb')) or (s.dig, 'fb') in s.rf,
     lambda lbl: lbl.startswith('replay lane')),
]
FACTS = [
    ('answers are live on a later digest', lambda s, c: s.gdig > 0 and answers_live(s, c)),
    ('answers are live on the fallback class', lambda s, c: s.gmodel == 'fb' and answers_live(s, c)),
]
SCEN = {
    'releases': dict(ARMED0=True, FALLBACKS=0, DRILLS=0, BURSTS=0),
    'fallback': dict(ARMED0=True, RELEASES=1, DRILLS=0, BURSTS=0, GRANT=1),
    'latches': dict(RELEASES=0, FALLBACKS=0),
    'restore': dict(ARMED0=True, RELEASES=0, FALLBACKS=0, BURSTS=0, RESTORE=1),
}
READINGS = [
    ('GATE3_REF', 'last', 'releases', 'A3'),
    ('FAIL_EXIT', 'none', 'releases', 'A4'),
    ('FAIL_EXIT', 'rerun', 'releases', ''),
    ('GRANT_MODEL', 'replay', 'fallback', 'A6'),
    ('FB_AHEAD', False, 'fallback', 'A8'),
    ('DRILL_MODE', 'advisory', 'latches', ''),
]
MUTATIONS = [
    ('answers_before_replay', 'releases', {}, 'A2'),
    ('gate3_always_passes', 'releases', {}, 'A3'),
    ('fallback_no_cap', 'fallback', {}, 'A9'),
    ('drill_ignored', 'latches', dict(ARMED0=True), 'A7'),
    ('server_clears_latch', 'latches', dict(ARMED0=True), 'A1'),
    ('restore_undetected', 'restore', {}, 'A1'),
]
TRACES = [
    ('arming-ratchet', 'releases', dict(GATE3_REF='last'), ('A3',)),
    ('arming-failed-replay-no-exit', 'releases', dict(FAIL_EXIT='none', RELEASES=1), ('A4',)),
    ('arming-grant-on-fallback', 'fallback', dict(GRANT_MODEL='replay'), ('A6',)),
    ('arming-fallback-not-ahead', 'fallback', dict(FB_AHEAD=False), ('A8',)),
]
