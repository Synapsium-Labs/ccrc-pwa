"""overlordMayAct (§7.1), the rung-by-kind cells (Table 7.1a), Figure 6 and the gate order (§11.2).

Two encodings of the decider are compared over one domain: `prose` follows §6.3, §6.7, §7.1, §7.2 and
Table 11.6; `figure` follows Figure 6 edge by edge. `FIX=1` applies the edits REPORT.md proposes.
"""
import itertools
import os
import re
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

# ---- Table 7.1a ---------------------------------------------------------------------------------------------------
cat = table_rows('*Table 7.1a')
assert cat[0][5:] == ['`chat`', '`advise`', '`full`'], cat[0]
RUNGS = ['off', 'chat', 'advise', 'full']
KIND_ROW = {}
for r in cat[1:]:
    names = ticks(r[0]) or ['reads']
    for n in names:
        KIND_ROW[n] = r
ALL_KINDS = sorted(KIND_ROW)


def cell(kind, rung, armed=True):
    r = KIND_ROW[kind]
    if rung == 'off':
        return None                                     # the table has no column for `off`
    c = r[5 + RUNGS.index(rung) - 1]
    if c.startswith('allow, when that kind is armed'):
        return 'allow' if armed else 'shadow'
    for w in ('allow', 'refuse', 'proposal'):
        if c.startswith(w):
            return w
    raise ValueError(c)


for k in ALL_KINDS:
    for rung in RUNGS[1:]:
        assert cell(k, rung) in ('allow', 'refuse', 'proposal', 'shadow')
ok('Table 7.1a: %d act kinds and the reads row x chat, advise, full: every cell reads allow, shadow, proposal or refuse' % (len(ALL_KINDS) - 1))

# a lower rung never allows more
bad = 0
ORDER = {'refuse': 0, 'shadow': 1, 'proposal': 1, 'allow': 2}
for k in ALL_KINDS:
    for a, b in (('chat', 'advise'), ('advise', 'full')):
        if ORDER[cell(k, a)] > ORDER[cell(k, b)]:
            bad += 1
            ce('ACT-rung', '`%s` is %s at `%s` and %s at `%s`' % (k, cell(k, a), a, cell(k, b), b))
if not bad:
    ok('Table 7.1a: no kind is allowed at a lower rung and refused at a higher one')

# ---- the gate order, for the three doors that must answer at `off` -----------------------------------------------
anchor('`off`: every Overlord door refuses, except the card, probe and note doors')
anchor('The card, probe and note doors skip** steps 3, 4, 6, 8 and 9')
anchor('10. the rung, by act kind (`rung-below`), and the act kind\'s ceiling')
anchor('| `rung-below` | Every Overlord write door | The effective rung does not allow this act kind.')
SKIP = {3, 4, 6, 8, 9}
if FIX:
    SKIP_RUNG_AT_OFF = True
else:
    SKIP_RUNG_AT_OFF = 'and, at the `off` rung, the rung of step 10' in FLAT


def note_door_at(rung):
    """The note door (`write-note`), called by the designated session, every other gate passing."""
    for step in range(1, 12):
        if step in SKIP:
            continue
        if step == 4 and rung == 'off':
            return 'overlord-off'
        if step == 10:
            if rung == 'off' and SKIP_RUNG_AT_OFF:
                continue
            c = cell('write-note', rung)
            if c != 'allow':
                return 'rung-below'                     # no cell, or a refusing one: the rung does not allow it
    return 'answers'


for rung in RUNGS:
    a = note_door_at(rung)
    if a == 'answers':
        ok('the note door at `%s`: answers' % rung)
    else:
        ce('ACT-off', 'the note door at `%s`: §3.2 and §7.5 say it answers; the gate order skips steps 3, 4, 6, 8 and 9'
           ' for it, and step 10 has no cell for `%s` in Table 7.1a, so it refuses `%s`' % (rung, rung, a))

# open-request with no message
anchor('- **A request with no message is the Overlord\'s own** (H7). It has `origin: overlord`.')
if '`open-request` (for an operator message)' in SPEC and not FIX:
    ce('ACT-openreq', 'Table 7.1a gives `open-request` cells "for an operator message" only; §5.1 lets the Overlord open a'
       ' request that cites none (`origin: overlord`), and no row gives that act a cell')
else:
    ok('`open-request` has cells with and without a cited message')

# drop-request's reversibility word against §10.1's definition
anchor('- **reversible**: an overturn restores the before-state')
anchor('- **Reopening is a new request** that names the old one. No move leaves a terminal state.')
if '`drop-request` reversible, but reopening is a new request' in SPEC and not FIX:
    ce('ACT-drop', '`drop-request` reads "reversible, but reopening is a new request". §10.1: reversible means an overturn'
       ' restores the before-state; §5.1: no move leaves `dropped`. By §10.1 that is compensable, and it names no compensator')
else:
    ok('`drop-request` is compensable and names its compensator')

# ---- overlordMayAct: prose against Figure 6 ---------------------------------------------------------------------
anchor('D{"Is every class member<br/>of the effect covered?"}') if not FIX else None
anchor('D -- "class none" --> E{"Evidence strong enough<br/>for this act?"}') if not FIX else None
anchor('G -- "yes, by command" --> AC["allow<br/>the command is spent"]')
anchor('- **An act needs every member covered.**')
anchor('- `identity-too-weak`, when the caller is weaker than the effect or the grant needs (§7.4);')
anchor('| `ask-is-cheaper` | The answer doors |')
anchor('| `evidence-too-weak` | The answer doors |')
anchor('- **It ends stalls that need no grant.** Routing, relays and follow-up (§5) run at `advise`.')
anchor('no cell of `askOrAct` yet has a record that lets it act, so every cell asks')
anchor('For `state-a-fact` only, no grant covers O5. Its one cover is a cited entry')

# act: (name, the effect's own class, is it an answer, is its effect grantable)
ACTS = [
    ('write-note', frozenset(), False, False),
    ('relay', frozenset(), False, False),
    ('nudge-owner', frozenset(), False, False),
    ('answer, class none', frozenset(), True, False),
    ('answer, effect approve-spec', frozenset({'O3'}), True, True),
    ('answer, effect state-a-fact', frozenset({'O5'}), True, False),
    ('start, operator request names it', frozenset(), False, False),
]
EXTRA = [frozenset(), frozenset({'O2'}), frozenset({'unknown'})]     # members of the effective class beyond the effect's
COVER = ['none', 'grant', 'command', 'entry']
BLIND = ['unarmed', 'armed, a clear yes', 'armed, not a clear yes', 'armed, then sent back to shadow by drift']
DOM = list(itertools.product(ACTS, EXTRA, COVER, [True, False], [True, False], ['strong', 'weak'], ['routine', 'big'],
                             ['act', 'ask'], BLIND))


def sensible(d):
    """A grant or a command stands behind a grantable effect only, and a stated entry behind `state-a-fact` only."""
    act, extra, cover = d[0], d[1], d[2]
    if extra and not act[2]:
        return False                                    # only a question carries a class beyond its effect's
    if cover in ('grant', 'command'):
        return act[3]
    if cover == 'entry':
        return 'state-a-fact' in act[0]
    return True


DOM = [d for d in DOM if sensible(d)]


def covered(member, act, cover):
    name, own, is_answer, grantable = act
    if member == 'O5' and 'state-a-fact' in name:
        return cover == 'entry'
    if cover == 'command':
        return True
    if cover == 'grant' and grantable and member in own:
        return True
    return False


def blind_passes(blind):
    if blind == 'armed, a clear yes':
        return True
    if blind == 'armed, not a clear yes':
        return False
    if blind == 'unarmed':
        return True                                     # skipped: the code checks and the veto window stand
    # the server sent an armed row back to shadow: "Unarmed, the check is skipped"
    return False if FIX else True


def prose(act, extra, cover, ident, isolated, evidence, size, aoa, blind):
    name, own, is_answer, grantable = act
    members = own | extra
    if any(not covered(m, act, cover) for m in members):
        return 'operator-only'
    if not ident:
        return 'identity-too-weak'
    if cover in ('grant', 'command') and not isolated:
        return 'server-not-isolated'
    commanded = cover == 'command'
    if is_answer and not (FIX and commanded):
        if evidence == 'weak' and (size == 'big' or own):
            return 'evidence-too-weak'
        if aoa == 'ask':
            return 'ask-is-cheaper'
    if commanded:
        return 'allow'
    if cover == 'grant' and members:
        if not blind_passes(blind):
            return 'defer'
        return 'staged' if 'O3' in members else 'allow-by-grant'
    return 'allow'


def figure(act, extra, cover, ident, isolated, evidence, size, aoa, blind):
    name, own, is_answer, grantable = act
    members = (own | extra) if FIX else own             # D: "every class member of the effect"
    if any(not covered(m, act, cover) for m in members):
        return 'operator-only'
    by = None
    if members and cover == 'command':
        by = 'command'
    elif members and cover == 'grant':
        by = 'grant'
    if by:                                              # G
        if not ident:
            return 'identity-too-weak'
        if not isolated:
            return 'server-not-isolated'
        if by == 'command':
            return 'allow'
    elif FIX and not ident:                             # the caption's sentence
        return 'identity-too-weak'
    if FIX and not is_answer:
        return 'allow'                                  # the new edge: class none, any other act
    if evidence == 'weak' and (size == 'big' or own):   # E
        return 'evidence-too-weak'
    if aoa == 'ask':                                    # F
        return 'ask-is-cheaper'
    if by == 'grant':
        if not blind_passes(blind):
            return 'defer'
        return 'staged' if 'O3' in members else 'allow-by-grant'
    return 'allow'


ACTING = {'allow', 'allow-by-grant', 'staged'}
diff = {}
for d in DOM:
    act, extra, cover = d[0], d[1], d[2]
    p, f = prose(*d), figure(*d)
    if p != f:
        diff.setdefault((p, f), []).append(d)
ok('overlordMayAct: %d inputs, each gets one answer under both encodings' % len(DOM))


def show(d):
    act, extra, cover, ident, isolated, evidence, size, aoa, blind = d
    return ('%s; extra class %s; cover %s; identity %s; %s; evidence %s; %s; askOrAct %s'
            % (act[0], '{%s}' % ', '.join(sorted(extra)) if extra else 'none', cover, 'strong enough' if ident else 'too weak',
               'isolated' if isolated else 'shared-user, no opt-in', evidence, size, aoa))


for (p, f), ds in sorted(diff.items()):
    ce('ACT-fig6', 'the prose answers `%s`, Figure 6 answers `%s`: %d inputs, e.g. [%s]' % (p, f, len(ds), show(ds[0])))
if not diff:
    ok('the prose and Figure 6 agree on all %d inputs' % len(DOM))

# day one: a relay with no record in any cell
d = (ACTS[1], frozenset(), 'none', True, True, 'weak', 'routine', 'ask', 'unarmed')
note('day one, a relay at `advise`, no record in any cell: prose `%s`, Figure 6 `%s`' % (prose(*d), figure(*d)))

# adding a class never turns a refusal into an allow (prose)
bad = 0
for d in DOM:
    act, extra = d[0], d[1]
    if extra:
        continue
    base = prose(*d)
    for more in EXTRA[1:]:
        e = (act, more) + d[2:]
        if base not in ACTING and prose(*e) in ACTING:
            bad += 1
            ce('ACT-classadd', 'adding %s turns `%s` into `%s`: %s' % (sorted(more), base, prose(*e), show(d)))
if not bad:
    ok('prose: adding a class member never turns a refusal into an allow (%d base inputs x 2 members)' % len([d for d in DOM if not d[1]]))

# a fault never moves the answer towards acting (prose): identity, isolation, evidence, record, the blind check
bad = {}
for d in DOM:
    act, extra, cover, ident, isolated, evidence, size, aoa, blind = d
    base = prose(*d)
    worse = []
    if ident:
        worse.append(('identity', (act, extra, cover, False, isolated, evidence, size, aoa, blind)))
    if isolated:
        worse.append(('isolation', (act, extra, cover, ident, False, evidence, size, aoa, blind)))
    if evidence == 'strong':
        worse.append(('evidence', (act, extra, cover, ident, isolated, 'weak', size, aoa, blind)))
    if size == 'routine':
        worse.append(('size', (act, extra, cover, ident, isolated, evidence, 'big', aoa, blind)))
    if aoa == 'act':
        worse.append(('record', (act, extra, cover, ident, isolated, evidence, size, 'ask', blind)))
    if blind == 'armed, a clear yes':
        worse.append(('blind check', (act, extra, cover, ident, isolated, evidence, size, aoa, 'armed, not a clear yes')))
    if blind == 'armed, not a clear yes':
        worse.append(('blind check', (act, extra, cover, ident, isolated, evidence, size, aoa, BLIND[3])))
    for what, w in worse:
        if base not in ACTING and prose(*w) in ACTING:
            bad.setdefault((what, base, prose(*w)), []).append((d, w))
for (what, a, b), pairs in sorted(bad.items()):
    d, w = pairs[0]
    ce('DM-drift' if what == 'blind check' else 'ACT-monotonic',
       '%s made worse moves `%s` to `%s`: %d input pairs, e.g. [%s] with the blind check "%s" -> "%s"'
       % (what, a, b, len(pairs), show(d), d[8], w[8]))
if not bad:
    ok('prose: no fault (identity, isolation, evidence, size, record, the blind check) moves a refusal to an allow')
anchor('Drift sends the row back to shadow.')
anchor('Any change sends the row back to shadow.')
anchor('- **Easing a gate is an authority change.** A refit that makes a gate easier to pass is journalled')
anchor('Unarmed, the check is skipped:')

summary('overlordMayAct, Table 7.1a, Figure 6, gate order%s' % (' (with the proposed edits)' if FIX else ''),
        '%d inputs; %d act kinds and the reads row x 3 rungs; the note door x 4 rungs' % (len(DOM), len(ALL_KINDS) - 1))
