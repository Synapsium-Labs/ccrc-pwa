"""briefRevealMode, answerExamined, tripwireDue and fatigueSignals (§6.6)."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

# ---- answerExamined ---------------------------------------------------------------------------------------------
anchor('One L1 decider, `answerExamined(events)`, reads the console\'s own events and answers one word.')
anchor('- `examined` needs one of three things: a choice other than the recommended one, or an edit or a note, or the downsides of at least one other option opened, with a dwell past a floor')
anchor('- `glanced`: a tap from a push, or a bulk Seen.') if not FIX else None
anchor('- `blind`: answered before the reveal in `blind-sample` mode.')
anchor('- `unmeasured`: an older console that does not report the events.')
anchor('Otherwise it is `examined` at most.')
anchor('A `glanced` accept is no evidence.')

FIELDS = ['reports', 'mode', 'before_reveal', 'overlord_text_seen', 'other_choice', 'edit_or_note', 'opened_downsides', 'from_push', 'bulk_seen']
DOM = [dict(zip(FIELDS, v)) for v in itertools.product([True, False], ['shown', 'on-tap', 'blind-sample'], [False, True],
                                                       [False, True], [False, True], [False, True], [False, True],
                                                       [False, True], [False, True])]
DOM = [e for e in DOM if e['mode'] == 'blind-sample' or not e['before_reveal']]     # only a blind sample has a reveal to beat
# a console that does not report its events reports none of them
DOM = [e for e in DOM if e['reports'] or not any(e[k] for k in FIELDS[2:])]


def words(e):
    """Every word whose bullet matches these events."""
    out = set()
    if not e['reports']:
        out.add('unmeasured')
    if e['mode'] == 'blind-sample' and e['before_reveal'] and not e['overlord_text_seen']:
        out.add('blind')
    if e['other_choice'] or e['edit_or_note'] or e['opened_downsides']:
        out.add('examined')
    if e['from_push'] or e['bulk_seen']:
        out.add('glanced')
    return out


def answer(e):
    w = words(e)
    if FIX:                                               # the first match wins, and `glanced` is every other answer
        for x in ('unmeasured', 'blind', 'examined'):
            if x in w:
                return {x}
        return {'glanced'}
    return w


none = [e for e in DOM if len(answer(e)) == 0]
many = {}
for e in DOM:
    w = answer(e)
    if len(w) > 1:
        many.setdefault(tuple(sorted(w)), []).append(e)
if none:
    e = [x for x in none if x['mode'] == 'shown'][0]
    ce('EXM-none', '%d of %d inputs get no word: the console reports its events, the answer is not from a push or a bulk Seen,'
       ' and none of the three things `examined` needs happened. The plain case is one of them: the operator opens the item,'
       ' reads the brief and taps the recommended option' % (len(none), len(DOM)))
    b = [x for x in none if x['mode'] == 'blind-sample' and x['before_reveal'] and x['overlord_text_seen']]
    if b:
        ce('EXM-none', '%d of those are a blind-sample answer with the Overlord\'s chat text on screen: "examined at most",'
           ' and no word when none of the three things happened' % len(b))
if many:
    total = sum(len(v) for v in many.values())
    ce('EXM-order', '%d inputs match more than one bullet and the text gives no order: %s. A tap from a push that picks another'
       ' option is a disagreement: read as `glanced` it drops out of every count'
       % (total, '; '.join('%s in %d' % (' and '.join('`%s`' % x for x in k), len(v)) for k, v in sorted(many.items()))))
if not none and not many:
    ok('answerExamined: %d inputs, exactly one word each' % len(DOM))
if FIX:
    # worse events never move the word towards counting as agreement
    RANK = {'blind': 0, 'examined': 1, 'glanced': 2, 'unmeasured': 2}
    bad = 0
    for e in DOM:
        a = list(answer(e))[0]
        for k, worse in (('reports', False), ('overlord_text_seen', True), ('other_choice', False), ('edit_or_note', False),
                         ('opened_downsides', False)):
            if e[k] != worse:
                g = dict(e)
                g[k] = worse
                if RANK[list(answer(g))[0]] < RANK[a]:
                    bad += 1
    (ok if not bad else lambda m: ce('EXM-monotonic', m))('a missing event never moves an answer towards `blind` or `examined` (%d violations)' % bad)

# ---- briefRevealMode --------------------------------------------------------------------------------------------
anchor('One L1 decider, `briefRevealMode`, picks one of three modes.')
anchor('It is used for O3, a start, a cell with under 10 blind cases or a bound under the floor, precedents that disagree, and while the fatigue rule (below) is in force.')
anchor('- `blind-sample`: the server picks it after the brief is filed')
BDOM = list(itertools.product([False, True], [False, True], [0, 9, 10], [False, True], [False, True], [False, True], [False, True]))


def modes(o3, start, cases, low_bound, disagree, fatigue, sampled):
    out = set()
    if sampled:
        out.add('blind-sample')
    if o3 or start or cases < 10 or low_bound or disagree or fatigue:
        out.add('on-tap')
    if not out:
        out.add('shown')
    return out


both = [d for d in BDOM if len(modes(*d)) > 1]
if both and not ('The first match wins: `blind-sample`' in FLAT or FIX):
    ce('BRF-order', 'briefRevealMode: `blind-sample` and `on-tap` both match %d of %d inputs (the server sampled a row that is O3,'
       ' a start, thin, disputed or under the fatigue rule) and the text gives no order. `on-tap` shows the recommendation'
       ' after a tap, before the answer; `blind-sample` only after it' % (len(both), len(BDOM)))
else:
    ok('briefRevealMode: %d inputs, one mode each' % len(BDOM))

# ---- tripwireDue, fatigueSignals: context ------------------------------------------------------------------------
anchor('One L1 decider, `tripwireDue`, raises one item when the first fires.')
note('tripwireDue: the text gives no answer for a `reopenIf` predicate that cannot be measured; `reviewBy` bounds the wait')
anchor('Over its line (0.15 for the gap and 40% for the glanced share, to start), the next ten decisions are `on-tap`.')
note('fatigueSignals reads five signals and names a line for two of them (the gap, the glanced share)')

summary('answerExamined, briefRevealMode%s' % (' (with the proposed edits)' if FIX else ''), '%d and %d inputs' % (len(DOM), len(BDOM)))
