"""Machine 5: one operator-model entry, its carriers, the privacy controls and a restore
(§9.1 to §9.4, §7.6, §3.3.2, §3.3.3, §3.3.5, Table 3.3.11b, §6.7, §7.1, §7.2).

Source: docs/superpowers/specs/2026-11-09-overlord-design.md as #2538 merged it. Section numbers in comments are that file's.

One entry about one subject. Its one source is an operator message (SRC='message': `stated`, with a quoted
span of the message) or a history row of project p (SRC='history': `inferred`). The statement has a version:
1 as first learned, 2 after the operator's Edit or a supersede. "Withdrawn" is what the operator took back:
every version after a Retire or a wipe, version 1 after an Edit or a supersede.

The carriers of an entry's words: the running generation's context (`ctx`), the Overlord's own notes and the
replies the checkpoint carries (`noted`), a staged act that cites it (`stg`), and the store itself after a
restore. The privacy journal is a file no snapshot carries (§7.6, §9.4 rule 12).

Bounds: one entry, one source row, one snapshot, one restore; each tap, read, note, act and renewal has a budget.
"""
from collections import namedtuple

DEFAULT = dict(
    SRC='message', LEARNED=True,
    RESTORE='store',           # a restore brings back: 'store' (the private store; the journals stand) | 'volume' (the
                               # whole volume: the store and the privacy journal as the snapshot held them)
    CONFIRMS=0, EDITS=0, RETIRES=0, WIPES=0, PAUSES=0, EXCLS=0, BACKUPS=0, RESTORES=0,
    READS=1, NOTES=1, ACTS=1, FACTS=0, STAGES=0, SUPERSEDES=0, DISTILS=1, OVL_RETIRES=0,
    # ---- switches: the safe readings -----------------------------------------------------------------------
    CARD_CARRIES='withheld',   # after the trigger "an entry it was served was retired, edited or wiped", the next
                               # card: 'withheld' (no checkpoint, and that generation's notes are not rendered)
                               # | 'rendered' (the text: the checkpoint and the notes ride the card, §3.3.2, §3.3.3)
    EDIT_JOURNAL=True,         # an Edit and a supersede are privacy journal records: True | False (the text, rule 12)
    TOMBSTONE=True,            # a replayed retirement of an entry the snapshot lacks writes a retired row: True |
                               # False (the text: the record replays onto a row that is not there)
    WIPE_CURSORS='end',        # a wipe and the feed cursors: 'end' (the wipe moves each to its feed's end, its
                               # record carries them, and a replayed wipe puts them back) | 'rewind' (the text: the
                               # cursors stay, and "rewind after a restore") | 'wiped' (they are wiped with the rest)
    ENTRY_IDS='journal',       # entry ids after a restore start above: 'journal' (its highest) | 'store' (the text)
    ACTIVE_ONLY=True,          # a door refuses an act that cites an entry that is not `active`: True | False (the
                               # text: "a retired entry" only)
    EDIT_SOURCES='replaced',   # the operator's Edit: 'replaced' (the edit is the entry's source) | 'kept' (the text
                               # does not say; the old message's span stays the quote)
    COMMIT_RECHECK=True,       # the staged commit refuses when a cited entry is no longer active: True | False
    WIPE_RULES=True,           # the rules version rises on a wipe too: True | False (the text, §3.3.5)
    WITNESS=True,              # a witness off the volume holds the privacy journal's head: True | False (the text:
                               # the witness holds the authority and act journals' heads only, §7.6)
    FACT_SEEN=True,            # `state-a-fact` needs an entry the operator confirmed, edited, or whose quote is the
                               # whole message: True | False (the text)
    MUTATION=None,
)

S = namedtuple('S', 'st basis ver seen msgsrc old eid nxt hi cur paused excl jr snap wd locked '
                    'ctx noted due unread stg reused '
                    'b_conf b_edit b_ret b_wipe b_pause b_excl b_bak b_res b_read b_note b_act b_fact b_stage '
                    'b_sup b_dist b_oret')


def init(c):
    learned = c.LEARNED
    return S(st='active' if learned else 'none', basis='stated' if c.SRC == 'message' else 'inferred', ver=1,
             seen=False, msgsrc=c.SRC == 'message', old=False, eid=1 if learned else 0, nxt=2 if learned else 1,
             hi=1 if learned else 0, cur=1 if learned else 0, paused=False, excl=False, jr=(), snap=None, wd=None, locked=False,
             ctx=0, noted=0, due=False, unread=False, stg=None, reused=False,
             b_conf=c.CONFIRMS, b_edit=c.EDITS, b_ret=c.RETIRES, b_wipe=c.WIPES, b_pause=c.PAUSES, b_excl=c.EXCLS,
             b_bak=c.BACKUPS, b_res=c.RESTORES, b_read=c.READS, b_note=c.NOTES, b_act=c.ACTS, b_fact=c.FACTS,
             b_stage=c.STAGES, b_sup=c.SUPERSEDES, b_dist=c.DISTILS, b_oret=c.OVL_RETIRES)


def fmt(s):
    e = 'none' if s.st == 'none' else 'entry %d %s, %s, version %d%s%s' % (
        s.eid, s.st, s.basis, s.ver, ', seen by the operator' if s.seen else '',
        ', version 1 kept as `superseded`' if s.old else '')
    return ('store: %s; cursor %s%s%s | journal %s | snapshot %s | the operator withdrew: %s | generation: context '
            'holds %s, notes hold %s%s%s | staged act: %s' % (
                e, 'past the source' if s.cur else 'before the source', ' learning paused' if s.paused else '',
                (' project excluded' if s.excl else '') + (' SERVES AND LEARNS NOTHING until the operator rules'
                                                         if s.locked else ''), list(s.jr) or '[]', 'taken' if s.snap else 'none',
                s.wd or 'nothing', 'version %d' % s.ctx if s.ctx else 'nothing',
                'version %d' % s.noted if s.noted else 'nothing', ', a hard renewal is due' if s.due else '',
                ', `card-unread`' if s.unread else '', s.stg or 'none'))


def withdrawn(s, v):
    if v == 0:
        return False
    if s.wd in ('retire', 'wipe'):
        return True
    return s.wd == 'edit' and v == 1


def served_now(s, c):
    # Table 9.2a: `stated` is served at once; `inferred` after three supporting sources (taken as met here)
    return s.st == 'active' and not s.locked


def touch(s, c, kind):
    """What the operator's change of a served entry sets off (§3.3.5 C40, Table 3.3.11b)."""
    served = s.ctx != 0
    rules = kind in ('retire', 'edit') or (kind == 'wipe' and c.WIPE_RULES)
    return s._replace(due=s.due or (served and c.MUTATION != 'no_hard_renewal'), unread=s.unread or rules)


def succ(s, c):
    E = []

    def add(label, s2, **info):
        E.append((label, s2, info))

    doors_open = not s.unread            # `card-unread`: every door but card, probe and note refuses (§3.3.3)

    # ---- the operator: About you and the learning controls (§9.3, §9.4 rule 11) --------------------------
    if s.b_conf and s.st == 'active' and not s.seen:
        add('operator: Confirm on About you', s._replace(basis='stated', seen=True, b_conf=s.b_conf - 1),
            actor='operator')
    if s.b_edit and s.st == 'active' and s.ver == 1:
        s2 = touch(s, c, 'edit')._replace(ver=2, basis='stated', seen=True, wd='edit', b_edit=s.b_edit - 1,
                                         msgsrc=s.msgsrc and c.EDIT_SOURCES == 'kept')
        if c.EDIT_JOURNAL:
            s2 = s2._replace(jr=s2.jr + (('edit', s.eid),))
        add('operator: Edit on About you (the statement is rewritten in the operator`s words)', s2, actor='operator')
    if s.b_ret and s.st == 'active':
        add('operator: Retire on About you',
            touch(s, c, 'retire')._replace(st='retired', wd='retire', jr=s.jr + (('retire', s.eid),),
                                           b_ret=s.b_ret - 1), actor='operator')
    if s.b_wipe:
        cur = {'wiped': 0, 'end': 1, 'rewind': s.cur}[c.WIPE_CURSORS]
        rec = ('wipe', cur) if c.WIPE_CURSORS == 'end' else ('wipe', None)
        add('operator: wipe everything',
            touch(s, c, 'wipe')._replace(locked=False, st='none', old=False, wd='wipe' if s.st != 'none' else s.wd, cur=cur,
                                         jr=s.jr + (rec,),
                                         b_wipe=s.b_wipe - 1), actor='operator')
    if s.b_pause:
        add('operator: %s learning' % ('resumes' if s.paused else 'pauses'),
            s._replace(paused=not s.paused, jr=s.jr + (('pause', not s.paused),), b_pause=s.b_pause - 1),
            actor='operator')
    if s.b_excl and not s.excl:
        add('operator: excludes project p as a source', s._replace(excl=True, jr=s.jr + (('excl', True),),
                                                                 b_excl=s.b_excl - 1), actor='operator')
    if s.b_bak and s.snap is None:
        add('`ccrc backup` takes a snapshot of the private store',
            s._replace(snap=(s.st, s.basis, s.ver, s.seen, s.msgsrc, s.old, s.eid, s.nxt, s.cur, s.paused, s.excl,
                             s.jr, s.hi), b_bak=s.b_bak - 1), actor='operator')
    if s.b_res and s.snap is not None:
        st, basis, ver, seen, msgsrc, old, eid, nxt, cur, paused, excl, sjr, shi = s.snap
        # §7.6: the privacy events "go to the privacy journal and are replayed after a restore". A snapshot of the
        # whole volume carries the journal too (§7.6 says so of the authority journal), so only the records it
        # held then are replayed.
        jr, hi, locked = s.jr, s.hi, s.locked
        if c.RESTORE == 'volume':
            if c.WITNESS:
                locked = locked or len(s.jr) > len(sjr)     # the witness holds a head the restored journal lacks
            else:
                hi = shi
            jr = sjr
        for rec in jr:
            if rec[0] == 'wipe':
                st, old = 'none', False
                if rec[1] is not None:
                    cur = rec[1]
            elif rec[0] == 'retire':
                if st != 'none' and eid == rec[1]:
                    st = 'retired'
                elif c.TOMBSTONE and st == 'none':
                    st, eid = 'retired', rec[1]
            elif rec[0] == 'edit':
                # the journal holds no words (§7.6), so the edit itself cannot be replayed: the old row is retired
                if st == 'active' and eid == rec[1] and ver == 1:
                    st = 'retired'
                elif c.TOMBSTONE and st == 'none':
                    st, eid = 'retired', rec[1]
            elif rec[0] == 'pause':
                paused = rec[1]
            elif rec[0] == 'excl':
                excl = True
        if c.ENTRY_IDS == 'journal':
            nxt = max(nxt, hi + 1)
        # every generation ends at a confirmed restore (the raised term is a hard trigger, Table 3.3.11b)
        add('operator: restores %s and confirms the restore; the privacy journal is replayed' % (
            'the whole volume' if c.RESTORE == 'volume' else 'the private store from the snapshot'),
            s._replace(st=st, basis=basis, ver=ver, seen=seen, msgsrc=msgsrc, old=old, eid=eid, nxt=nxt, cur=cur,
                       paused=paused, excl=excl, jr=jr, locked=locked, ctx=0, due=False, unread=False, stg=None,
                       b_res=s.b_res - 1),
            actor='operator', restore=True)
    if s.locked:
        add('operator: rules that the restored store stands as it is', s._replace(locked=False, wd=None),
            actor='operator')

    # ---- the Overlord's running generation ------------------------------------------------------------------
    if doors_open and s.b_read and served_now(s, c):
        add('Overlord: reads the entry (a packet, or the model read)', s._replace(ctx=s.ver, b_read=s.b_read - 1),
            actor='overlord')
    if s.b_note and s.ctx:
        # §3.3.2: notes are the Overlord's own words; the checkpoint carries its replies to the operator
        add('Overlord: writes a note, or a reply to the operator, that restates what it holds',
            s._replace(noted=s.ctx, b_note=s.b_note - 1), actor='overlord')
    if doors_open and s.b_act and s.ctx:
        # C30: "An inferred entry may guide a routine answer of class none". The answer cites nothing here, so no
        # door can refuse it for the entry.
        add('Overlord: answers a routine question of class none, guided by what its context holds',
            s._replace(b_act=s.b_act - 1), actor='overlord', uses=s.ctx)
    if doors_open and s.b_fact and s.eid:
        # §7.1: `state-a-fact` is covered by "a cited entry that is `stated`, rests on an operator message, is not
        # retired, and has the item's subject. It answers with the quoted span"
        for cite_old in ((False, True) if s.old else (False,)):
            status = 'superseded' if cite_old else s.st
            if status == 'none':
                continue
            ok = s.basis == 'stated' and (s.msgsrc or cite_old) and status != 'retired'
            if c.ACTIVE_ONLY and status != 'active':
                ok = False
            if c.FACT_SEEN and not s.seen and not cite_old:
                ok = False
            if c.MUTATION == 'fact_from_inferred':
                ok = status != 'retired'
            if ok:
                # the quoted span is a span of the entry's source message: the newer message after a
                # supersede, the first message otherwise (an Edit that keeps the sources keeps that quote)
                q = 2 if (s.old and not cite_old) else 1
                add('Overlord: `state-a-fact` cites entry %s; the server answers the item with the quoted span' % (
                    'version 1 (superseded)' if cite_old else '%d' % s.eid),
                    s._replace(b_fact=s.b_fact - 1), actor='overlord', uses=q, fact=True, basis=s.basis,
                    msgsrc=s.msgsrc or cite_old, seen=s.seen)
            elif not cite_old:
                add('Overlord: `state-a-fact` cites the entry; the door refuses', s._replace(b_fact=s.b_fact - 1),
                    actor='overlord')
    if doors_open and s.b_stage and s.st == 'active' and s.ctx and s.stg is None:
        add('Overlord: a grant-backed answer that cites the entry is staged',
            s._replace(stg='staged, citing version %d' % s.ver, b_stage=s.b_stage - 1), actor='overlord')
    if doors_open and s.b_sup and s.st == 'active' and s.ver == 1:
        # §9.3: "A stated entry changes only by a `supersede` that cites a newer operator source"
        s2 = touch(s, c, 'supersede')._replace(ver=2, old=True, eid=s.nxt, nxt=s.nxt + 1, hi=max(s.hi, s.nxt),
                                               wd='edit', b_sup=s.b_sup - 1)
        if c.EDIT_JOURNAL:
            s2 = s2._replace(jr=s2.jr + (('edit', s.eid),))
        add('Overlord: `supersede`, citing a newer operator message', s2, actor='overlord')
    if doors_open and s.b_oret and s.st == 'active':
        if s.basis == 'stated' and c.MUTATION != 'overlord_retires_stated':
            add('Overlord: `retire-entry` on a stated entry; refused `entry-stated`', s._replace(b_oret=s.b_oret - 1),
                actor='overlord')
        else:
            add('Overlord: `retire-entry`', touch(s, c, 'retire')._replace(
                st='retired', jr=s.jr + (('retire', s.eid),), b_oret=s.b_oret - 1), actor='overlord',
                oretire=True, basis=s.basis)

    # ---- the server ---------------------------------------------------------------------------------------
    if s.due:
        # the hard renewal lands: a fresh conversation, then the card (§3.3.11). A hard trigger skips the
        # handover note; the checkpoint's replies and the notes are the card's (§3.3.2, §3.3.3 items 3 and 6)
        carried = s.noted if c.CARD_CARRIES == 'rendered' else 0
        add('renewal lane (hard: an entry it was served changed): a fresh start, and the card is read%s' % (
            ', with the notes and the replies of the checkpoint' if carried else ''),
            s._replace(ctx=carried, due=False, unread=False,
                       noted=s.noted if c.CARD_CARRIES == 'rendered' else 0,
                       stg='voided' if s.stg and s.stg.startswith('staged') else s.stg), actor='server',
            renewal=True)
    elif s.unread:
        add('Overlord: reads its card again (the rules version rose)', s._replace(unread=False), actor='overlord')
    if s.stg and s.stg.startswith('staged'):
        ver = int(s.stg[-1])
        gone = s.st != 'active' or s.ver != ver
        if gone and c.COMMIT_RECHECK:
            add('veto clock: the commit finds the cited entry no longer active; the act is `voided`',
                s._replace(stg='voided'), actor='server')
        else:
            add('veto clock: the window runs out; the staged act is `effective`', s._replace(stg='effective'),
                actor='server', uses=ver, commit=True)
    if s.b_dist and s.cur == 0 and c.SRC == 'history' or (s.b_dist and s.cur == 0 and c.MUTATION == 'never'):
        blocked = ((s.paused or s.excl) and c.MUTATION != 'learns_while_paused') or s.locked
        if not blocked:
            if s.st in ('active', 'retired'):
                # §9.2: "It checks each proposal against active and retired entries, so a retired entry is not
                # proposed again."
                add('distillation: reads the source; an entry for the subject exists, so nothing is proposed',
                    s._replace(cur=1, b_dist=s.b_dist - 1), actor='server')
            else:
                eid = s.nxt
                add('distillation: reads the source%s and the Overlord adds the entry, as id %d' % (
                    ' again' if s.hi else '', eid),
                    s._replace(st='active', basis='inferred', ver=1, seen=False, msgsrc=False, eid=eid,
                               nxt=eid + 1, hi=max(s.hi, eid), cur=1, reused=s.reused or eid <= s.hi,
                               b_dist=s.b_dist - 1), actor='server', learn=True, paused=s.paused, excl=s.excl)
    return E


# ---------------------------------------------------------------------------------------------------------
# checks

def pv1(s, c):
    # §3.3.5: "An entry the generation was served that is retired, edited or wiped also makes a renewal due at
    # once ... So no generation keeps that text in context (§9.2)."
    if not s.due and withdrawn(s, s.ctx):
        return 'no renewal is due, and the generation holds version %d, which the operator withdrew (%s)' % (
            s.ctx, s.wd)
    return None


def pv2(s, lbl, info, s2, c):
    # the task's check: after a wipe, an edit or a retirement, no generation acts on the old entry
    v = info.get('uses')
    if v and withdrawn(s, v):
        if info.get('fact'):
            return '`state-a-fact` answered a `value` item with the words of version %d, withdrawn by %s' % (v, s.wd)
        if info.get('commit'):
            return 'a staged act that cites version %d took effect after the operator withdrew it (%s)' % (v, s.wd)
        return 'an answer was guided by version %d after the operator withdrew it (%s)' % (v, s.wd)
    return None


def pv3(s, c):
    # §9.4 rule 12: "They are replayed after a restore, so a restore never un-wipes."
    # §9.3: Retire "stays visible under `Retired`, so the distillation does not propose it again."
    if s.locked:
        return None
    if s.wd in ('retire', 'wipe') and s.st == 'active':
        return 'the store serves an entry for the subject again after the operator`s %s' % s.wd
    if s.wd == 'edit' and s.st == 'active' and s.ver == 1:
        return 'the store serves version 1 again after the operator replaced it'
    return None


def pv4(s, lbl, info, s2, c):
    # C30: `state-a-fact` needs an entry that is `stated` and rests on an operator message
    if info.get('fact') and (info['basis'] != 'stated' or not info['msgsrc']):
        return '`state-a-fact` was covered by an entry that is %s%s' % (
            info['basis'], '' if info['msgsrc'] else ' and rests on no operator message')
    return None


def pv5(s, lbl, info, s2, c):
    # §5.1: "never a span inside a message. A span can drop a negation." The check this model adds for O5.
    if info.get('fact') and not info['seen'] and not withdrawn(s, 1):
        return ('`state-a-fact` answered with a span of a message that the Overlord chose and the operator never '
                'saw as an entry')
    return None


def pv6(s, lbl, info, s2, c):
    # §9.4 rule 11, rule 12: learning paused, a project excluded
    if info.get('learn') and (info['paused'] or info['excl']):
        return 'the distillation learned an entry while learning was %s' % (
            'paused' if info['paused'] else 'excluded for its project')
    return None


def pv7(s, c):
    if s.reused:
        return 'an entry id was issued twice: act rows that cite the first now point at another entry'
    return None


def pv8(s, lbl, info, s2, c):
    # §9.3: "The Overlord does not retire what the operator said."
    if info.get('oretire') and info['basis'] == 'stated':
        return 'the Overlord retired a stated entry'
    return None


STATE_CHECKS = [('PV1', pv1), ('PV3', pv3), ('PV7', pv7)]
EDGE_CHECKS = [('PV2', pv2), ('PV4', pv4), ('PV5', pv5), ('PV6', pv6), ('PV8', pv8)]
LIVE_CHECKS = []
FACTS = [
    ('a hard renewal lands after an entry changed', lambda s, c: s.wd is not None and not s.due and s.ctx == 0
     and s.b_read < c.READS),
    ('`state-a-fact` is refused or answered', lambda s, c: s.b_fact < c.FACTS),
]

SCEN = {
    # the operator retires, edits or wipes an entry the generation was served
    'withdraw': dict(RETIRES=1, EDITS=1, WIPES=1, READS=2, NOTES=1, ACTS=1),
    # a value item, and the entry that may answer it
    'fact': dict(FACTS=2, EDITS=1, SUPERSEDES=1, CONFIRMS=1, READS=1, NOTES=0, ACTS=0, OVL_RETIRES=1),
    'fact-inferred': dict(SRC='history', FACTS=1, CONFIRMS=1, READS=0, NOTES=0, ACTS=0, OVL_RETIRES=1),
    # a staged act that cites the entry
    'staged': dict(STAGES=1, RETIRES=1, EDITS=1, READS=1, NOTES=0, ACTS=0),
    # a snapshot, then a retirement, an edit or a wipe, then a restore
    'restore': dict(SRC='history', LEARNED=False, BACKUPS=1, RESTORES=1, RETIRES=1, WIPES=1, EDITS=1, DISTILS=3,
                    READS=1, NOTES=0, ACTS=0),
    'restore-learned': dict(SRC='history', BACKUPS=1, RESTORES=1, RETIRES=1, WIPES=1, EDITS=1, SUPERSEDES=0,
                            DISTILS=2, READS=1, NOTES=0, ACTS=0),
    'restore-volume': dict(SRC='history', RESTORE='volume', BACKUPS=1, RESTORES=1, RETIRES=1, WIPES=1, EDITS=0,
                           DISTILS=1, READS=1, NOTES=0, ACTS=0),
    'controls': dict(SRC='history', LEARNED=False, BACKUPS=1, RESTORES=1, PAUSES=2, EXCLS=1, DISTILS=2, READS=0,
                     NOTES=0, ACTS=0),
}

READINGS = [
    ('CARD_CARRIES', 'rendered', 'withdraw', 'PV1 PV2'),
    ('WIPE_RULES', False, 'withdraw', 'PV2'),
    ('EDIT_SOURCES', 'kept', 'fact', 'PV2'),
    ('ACTIVE_ONLY', False, 'fact', 'PV2'),
    ('FACT_SEEN', False, 'fact', 'PV5'),
    ('COMMIT_RECHECK', False, 'staged', 'PV2'),
    ('TOMBSTONE', False, 'restore', 'PV3'),
    ('WIPE_CURSORS', 'rewind', 'restore', 'PV3'),
    ('WIPE_CURSORS', 'wiped', 'restore-learned', 'PV3'),
    ('EDIT_JOURNAL', False, 'restore-learned', 'PV3'),
    ('ENTRY_IDS', 'store', 'restore', 'PV7'),
    ('WITNESS', False, 'restore-volume', 'PV3'),
]

MUTATIONS = [
    ('no_hard_renewal', 'withdraw', {}, 'PV1'),
    ('fact_from_inferred', 'fact-inferred', {}, 'PV4'),
    ('learns_while_paused', 'controls', {}, 'PV6'),
    ('overlord_retires_stated', 'fact', {}, 'PV8'),
]

TRACES = [
    ('privacy-notes-carry-the-entry', 'withdraw', dict(CARD_CARRIES='rendered'), ('PV1',)),
    ('privacy-wipe-leaves-doors-open', 'withdraw', dict(WIPE_RULES=False), ('PV2',)),
    ('privacy-fact-answers-old-words', 'fact', dict(EDIT_SOURCES='kept'), ('PV2',)),
    ('privacy-superseded-entry-still-covers', 'fact', dict(ACTIVE_ONLY=False), ('PV2',)),
    ('privacy-fact-span-unseen', 'fact', dict(FACT_SEEN=False), ('PV5',)),
    ('privacy-staged-act-commits', 'staged', dict(COMMIT_RECHECK=False), ('PV2',)),
    ('privacy-restore-unretires', 'restore', dict(TOMBSTONE=False, EDITS=0, WIPES=0), ('PV3',)),
    ('privacy-restore-unwipes', 'restore', dict(WIPE_CURSORS='rewind', EDITS=0, RETIRES=0), ('PV3',)),
    ('privacy-restore-unedits', 'restore-learned', dict(EDIT_JOURNAL=False, RETIRES=0, WIPES=0), ('PV3',)),
    ('privacy-entry-id-reused', 'restore', dict(ENTRY_IDS='store'), ('PV7',)),
    ('privacy-volume-restore-unwipes', 'restore-volume', dict(WITNESS=False, RETIRES=0), ('PV3',)),
]
