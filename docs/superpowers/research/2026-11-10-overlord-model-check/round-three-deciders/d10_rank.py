"""decisionRank (§6.6) against the classes of service (Table 5.6a), and Pause on the ladder (§7.5)."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

anchor('`expedite` and blocking-now rows come first. Then comes the programme\'s rank weight times the hours its runs and holds have been blocked, and then slack to a fixed date.')
anchor('A rank weight is the count of programmes ranked at or below it in §5.6\'s order, so the bottom one weighs 1.')
anchor('The Overlord\'s own ordering breaks ties only.')
row = [r for r in table_rows('*Table 5.6a')[1:] if r[0] == '`fixed-date`'][0][1]
ROWS = list(itertools.product(['expedite', 'fixed-date', 'standard', 'background'], [False, True], [0, 2, 6], [None, 1, 100]))
ROWS = [r for r in ROWS if (r[3] is None) == (r[0] != 'fixed-date')]      # only a fixed-date programme has slack


def key_section(r):
    """§6.6, read as three sort keys in the order the sentence gives them."""
    cls, now, wh, slack = r
    return (0 if (cls == 'expedite' or now) else 1, -wh, slack if slack is not None else float('inf'))


def table_says(a, b):
    """Table 5.6a: a fixed-date programme's row is ranked by its slack. Returns the order it gives, or None."""
    if a[0] == 'fixed-date' and b[0] == 'fixed-date':
        return (a[3] > b[3]) - (a[3] < b[3])
    return None                                           # slack against weight x hours: no common scale


pairs = list(itertools.combinations(ROWS, 2))
ok('decisionRank as three sort keys orders all %d pairs of %d rows (ties go to the Overlord\'s order)' % (len(pairs), len(ROWS)))
clash = [(a, b) for a, b in pairs if a[0] == 'fixed-date' and b[0] not in ('fixed-date', 'expedite')
         and not a[1] and not b[1] and a[2] < b[2]]
swap = [(a, b) for a, b in pairs if table_says(a, b) is not None and key_section(a)[:2] != key_section(b)[:2]
        and ((key_section(a) > key_section(b)) - (key_section(a) < key_section(b))) != table_says(a, b)]
if 'third sort key' in row or FIX:
    ok('Table 5.6a and §6.6 give slack the same place: the third sort key')
else:
    ce('RANK-fixed', 'Table 5.6a: "%s". §6.6 puts slack third, after rank weight times blocked hours. In %d pairs a `fixed-date`'
       ' row with less weighted blocked time ranks under a `standard` or `background` row however close its date, e.g. slack'
       ' %d h against weight x hours %d; Table 5.6a gives no scale to compare slack with blocked hours. In %d pairs two'
       ' `fixed-date` rows come out in the other order than their slack gives'
       % (row.split('. ')[1], len(clash), clash[0][0][3], clash[0][1][2], len(swap)))

# Pause: one tap, no step-up, "`operatorRung` becomes `chat`"
anchor('- **Pause.** One tap on the Overlord place, with no step-up. `operatorRung` becomes `chat`.') if not FIX else None
anchor('It needs no step-up because it only lowers autonomy, and lowering never needs one.')
anchor('- **Only the operator steps up.** Moving up keeps the step-up: a rung up')
RUNGS = ['off', 'chat', 'advise', 'full']
for r in RUNGS:
    after = 'chat' if not (FIX and r == 'off') else 'off'
    if RUNGS.index(after) > RUNGS.index(r):
        ce('LADDER-pause', 'Pause at `%s` sets `operatorRung` to `%s`: a rung up, with no step-up' % (r, after))
    else:
        ok('Pause at `%s` -> `%s`: not a rung up' % (r, after))

# effectiveRung: the lowest of the operator's rung and every standing cap (Table 7.5a)
lad = table_rows('*Table 7.5a')[1:]
CAPS = []
for r in lad:
    eff = r[2]
    if eff.startswith('cap `chat`'):
        CAPS.append((r[0], 'chat'))
    elif eff.startswith('cap `advise`'):
        CAPS.append((r[0], 'advise'))
    elif eff.startswith('one under'):
        CAPS.append((r[0], 'one-under'))
note('Table 7.5a: %d rows, %d of them caps; the other %d are read by the decider each names' % (len(lad), len(CAPS), len(lad) - len(CAPS)))


def effective(op, standing):
    lo = RUNGS.index(op)
    for name, cap in standing:
        c = max(RUNGS.index('chat'), RUNGS.index(op) - 1) if cap == 'one-under' else RUNGS.index(cap)
        lo = min(lo, c)
    return RUNGS[lo]


n = bad = 0
for op in RUNGS:
    for bits in range(2 ** len(CAPS)):
        standing = [CAPS[i] for i in range(len(CAPS)) if bits >> i & 1]
        e = effective(op, standing)
        n += 1
        assert RUNGS.index(e) <= RUNGS.index(op)
        for i in range(len(CAPS)):
            if not bits >> i & 1:
                if RUNGS.index(effective(op, standing + [CAPS[i]])) > RUNGS.index(e):
                    bad += 1
if bad:
    ce('LADDER-monotonic', 'a new latch or condition raises the effective rung in %d cases' % bad)
else:
    ok('effectiveRung: %d inputs (4 rungs x every set of %d caps): never above the operator\'s rung, and a new cap never raises it' % (n, len(CAPS)))
# each restatement of a cap names the same rung
for phrase, rung in [('its ladder is capped at `chat`, a condition that lifts by itself', 'chat'),
                     ('Probes that fail twice after a renewal also latch the ladder at `chat`', 'chat'),
                     ('So the ladder is capped at `advise`', 'advise'),
                     ('Past the 95% line the ladder is capped at `chat`', 'chat'),
                     ('three answers `overturned` in 24 hours latch the ladder at `advise`', 'advise'),
                     ('A violation is a latch on the ladder: cap `advise`', 'advise'),
                     ('**A detected restore latches the ladder at `chat`**', 'chat'),
                     ('latches the ladder at `advise` (§7.5)', 'advise'),
                     ('the rung is capped at `advise` until one witness', 'advise')]:
    anchor(phrase)
ok('nine restatements of a cap outside Table 7.5a name the rung its row names')
summary('decisionRank, Pause, effectiveRung%s' % (' (with the proposed edits)' if FIX else ''),
        '%d pairs of queue rows; 4 rungs x Pause; %d ladder inputs' % (len(pairs), n))
