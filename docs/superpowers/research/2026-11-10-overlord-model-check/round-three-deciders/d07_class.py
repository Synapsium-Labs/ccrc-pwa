"""itemClassFloor and the class sets (§6.7, Table 6.7a), and the settling-act part of mayHold (Table 6.7b)."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

anchor('`operatorClass` on an item or an ask is `none`, or a set of O1 to O6. A missing field is `unknown`.')
anchor('- **The effective class** is a union of five sets.')
anchor('`unknown` is a member that no grant covers.')
anchor('| an ask released `cannot-decide` | none | Held for one window when `mayHold` is true |')
anchor('| a `decide` item with no class | {`unknown`} | Escalate, or return as over-asked |')
anchor('| a `value` item | {O5} |')
anchor('| a `decide` item with class `unknown` | yes, a triage hold of 5 minutes |') if not FIX else None
anchor('| a `value` item with a cited entry that is `stated`, rests on an operator message, is not retired, and has the item\'s subject | yes |') if not FIX else None
anchor('| any other classed item or ask; a `secret` or `do` item; a lapsed or root ask | no:')
anchor('- **Why.** A hold on a row the Overlord may not answer can only end in an escalation.')
anchor('- the Overlord has a settling act it may take alone (Table 6.7b).')
anchor('An unclassed item that is plainly operator-only') if False else None

ITEMS = ['secret', 'do', 'value', 'decide']
ASKS = ['operator-only', 'cannot-decide', 'lapsed', 'root', 'no reason']
STATED = ['missing', 'none', 'O3', 'O2', 'O3+O2']
LINEAGE = [frozenset(), frozenset({'O3'})]
RAISE = [frozenset(), frozenset({'O2'})]           # the decision model's raise, or the Overlord's own stated class
GRANT = [False, True]                              # a live grant in scope for the row's effect (an O3 effect)
ENTRY = [False, True]                              # a stated entry on an operator message with the item's subject


def stated_set(s, missing_is_unknown):
    if s == 'missing':
        return frozenset({'unknown'}) if missing_is_unknown else frozenset()
    if s == 'none':
        return frozenset()
    return frozenset(s.split('+'))


def floor(row, s):
    """Table 6.7a. Returns a set, or None for a `do` item (the operator's own act)."""
    kind, what = row
    if kind == 'item':
        if what == 'secret':
            return frozenset({'O4'})
        if what == 'do':
            return None
        if what == 'value':
            return frozenset({'O5'})
        if s == 'missing':
            return frozenset({'unknown'})
        return stated_set(s, False)
    if what == 'operator-only':
        return stated_set(s, False)
    if what == 'cannot-decide':
        return frozenset()
    return frozenset({'unknown'})


def effective(row, s, lineage, raised, missing_is_unknown):
    f = floor(row, s)
    if f is None:
        return None
    return stated_set(s, missing_is_unknown) | f | lineage | raised


def held(row, eff, grant, entry, unknown_alone, value_alone):
    """Table 6.7b, its rows in the table's order. Returns (held?, the acts the row admits)."""
    kind, what = row
    if eff is None:
        return (False, 'attach-brief')
    if (row == ('item', 'decide') or row == ('ask', 'cannot-decide')) and not eff:
        return (True, 'answer')
    if row == ('item', 'decide') and ('unknown' in eff) and (eff == {'unknown'} or not unknown_alone):
        return (True, 'triage')
    if kind == 'item' and eff and all(m == 'O3' for m in eff) and grant and what == 'decide':
        return (True, 'answer by grant')
    if row == ('item', 'value') and entry and (eff == {'O5'} or not value_alone):
        return (True, 'state-a-fact')
    return (False, 'attach-brief')


def may_settle(row, eff, grant, entry, acts):
    """Whether the act the held row admits passes `overlordMayAct`'s cover rule: every member covered."""
    if acts == 'triage':
        return True                                   # a triage hold admits no answer: escalate or return
    for m in eff:
        if m == 'O3' and grant and acts == 'answer by grant':
            continue
        if m == 'O5' and entry and acts == 'state-a-fact':
            continue
        return False
    return True


ROWS = [('item', k) for k in ITEMS] + [('ask', k) for k in ASKS]
DOM = list(itertools.product(ROWS, STATED, LINEAGE, RAISE, GRANT, ENTRY))
ok('domain: %d rows x stated class x lineage x raise x grant x entry = %d inputs' % (len(ROWS), len(DOM)))

# 1. "A missing field is `unknown`" against the floors of Table 6.7a
# The sentence applies to every item and ask. Table 6.7a and Table 6.1a give a `cannot-decide` ask the class none
# and hold it, whether or not the release names a class.
for row in ROWS:
    a = effective(row, 'missing', frozenset(), frozenset(), True)      # the sentence
    b = effective(row, 'missing', frozenset(), frozenset(), False)     # the floor of Table 6.7a alone
    if a is None:
        continue
    ha = held(row, a, False, True, True, True)[0]
    hb = held(row, b, False, True, True, True)[0]
    if row == ('ask', 'cannot-decide'):
        if FIX:
            ok('ask cannot-decide, no class named: the release reason states none, so it is held')
        else:
            ce('CLS-missing', 'ask cannot-decide, `operatorClass` left out: "A missing field is `unknown`" gives the class %s,'
               ' which is not held; Table 6.7a and Table 6.1a give it the class none and hold it' % sorted(a))
    elif a != b:
        note('%s %s, `operatorClass` left out: the sentence gives %s, the floor alone gives %s; held %s either way'
             % (row[0], row[1], sorted(a), sorted(b) or 'none', ha) if ha == hb else
             '%s %s, `operatorClass` left out: the sentence gives %s (held: %s), the floor alone gives %s (held: %s)'
             % (row[0], row[1], sorted(a), ha, sorted(b) or 'none', hb))


def eff_of(row, s, lin, rai):
    """The sentence everywhere, but for a `cannot-decide` ask, whose release reason is its stated class."""
    return effective(row, s, lin, rai, row != ('ask', 'cannot-decide'))


# 2. it holds only what it may settle
cls = {}
for row, s, lin, rai, g, e in DOM:
    eff = eff_of(row, s, lin, rai)
    h, acts = held(row, eff, g, e, FIX, FIX)
    if h and not may_settle(row, eff, g, e, acts):
        cls.setdefault((row, acts), []).append((s, sorted(eff), g, e))
for (row, acts), v in sorted(cls.items()):
    ce('CLS-held', '%s %s is held for `%s` in %d inputs where a member of its class has no cover, so the hold can only end'
       ' in an escalation, e.g. stated %s, effective class %s' % (row[0], row[1], acts, len(v), v[0][0], v[0][1]))
if not cls:
    ok('every held row admits an act whose every class member is covered')

# 3. a triage hold on a row that already carries a member of O1 to O6
both = [(row, s, sorted(eff_of(row, s, lin, rai))) for row, s, lin, rai, g, e in DOM
        if row == ('item', 'decide') and eff_of(row, s, lin, rai) and 'unknown' in eff_of(row, s, lin, rai)
        and eff_of(row, s, lin, rai) != {'unknown'} and not g and not e]
if both and not FIX:
    ce('CLS-triage', 'a `decide` item whose class is `unknown` with a member of O1 to O6 beside it (%d inputs, e.g. %s):'
       ' Table 6.7b\'s second row ("with class `unknown`") gives a triage hold of 5 minutes, its last row ("any other'
       ' classed item") sends it to the operator at once. The table gives no order' % (len(both), both[0][2]))
else:
    ok('a `decide` item is triaged only when `unknown` is its whole class')

# 4. adding a class member never turns "not held" into "held"
bad = {}
for row, s, lin, rai, g, e in DOM:
    eff = eff_of(row, s, lin, rai)
    if eff is None:
        continue
    h0 = held(row, eff, g, e, FIX, FIX)[0]
    for more in ('unknown', 'O1', 'O2', 'O3', 'O5'):
        if more in eff:
            continue
        h1 = held(row, eff | {more}, g, e, FIX, FIX)[0]
        if h1 and not h0:
            bad.setdefault((row, more), []).append(sorted(eff))
for (row, more), v in sorted(bad.items()):
    ce('CLS-add', '%s %s: adding `%s` to the class %s turns "not held" into "held" (%d inputs)' % (row[0], row[1], more, v[0] or 'none', len(v)))
if not bad:
    ok('adding a class member never turns "not held" into "held"')

# 5. the floor is never undercut, and a lineage member is never lost
for row, s, lin, rai, g, e in DOM:
    eff = eff_of(row, s, lin, rai)
    if eff is None:
        continue
    assert floor(row, s) <= eff and lin <= eff and rai <= eff
ok('the effective class contains the floor, the lineage and every raise on all %d inputs' % len(DOM))

summary('itemClassFloor, class sets, the settling act of mayHold%s' % (' (with the proposed edits)' if FIX else ''), '%d inputs' % len(DOM))
