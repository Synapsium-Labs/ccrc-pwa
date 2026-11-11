"""The generation machine (Table 3.3.11a, Figure 2, the receipt) and `renewalDue` (Table 3.3.11b)."""
import itertools
import os
import re
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

# ---- Table 3.3.11a ----------------------------------------------------------------------------------------------
rows = table_rows('*Table 3.3.11a')[1:]
STATES = [ticks(r[0])[0] for r in rows]
assert STATES == ['active', 'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'degraded', 'ended']
cell = {ticks(r[0])[0]: r[2] for r in rows}
secs = {s: int(re.match(r'(\d+)', cell[s]).group(1)) for s in ('draining', 'checkpointed', 'clearing', 'carded', 'probing')}
anchor('From `checkpointed` to `active` takes at most 360 seconds')
total = sum(secs[s] for s in ('checkpointed', 'clearing', 'carded', 'probing'))
if total == 360:
    ok('budget: checkpointed %d + clearing %d + carded %d + probing %d = 360 s' % tuple(secs[s] for s in ('checkpointed', 'clearing', 'carded', 'probing')))
else:
    ce('GEN-budget', 'the four deadlines sum to %d, the budget says 360' % total)

# Three descriptions of "a renewal fails before the old conversation ended".
anchor('A failure before the first half returns the generation to the state it left: `active` with a hold-off (Table 11.5b), or `degraded` if the renewal began there.')
anchor('C -- "timeout: back, with a hold-off" --> A')
anchor('E -- "failed before the old one ended" --> A')
anchor('X -- "a hard trigger, or Renew now" --> C')        # so a renewal can begin in `degraded`


def table_says(state, began):
    if state == 'draining':
        if FIX:
            return began
        m = re.search(r'then back to `(\w+)`', cell['draining'])
        return m.group(1)
    return None                                             # the cell gives seconds only


def receipt_says(state, began):
    return began                                            # "the state it left"


def figure_says(state, began):
    return 'active'                                         # both edges end at A


n = 0
for state, began in itertools.product(['draining', 'clearing'], ['active', 'degraded']):
    n += 1
    t, r, f = table_says(state, began), receipt_says(state, began), figure_says(state, began)
    answers = {'Table 3.3.11a': t, 'the receipt': r, 'Figure 2': f}
    if t is not None and t != r:
        ce('GEN-back', 'a renewal that began in `%s` fails in `%s` before the old conversation ended: Table 3.3.11a'
           ' says back to `%s`, the receipt says `%s`' % (began, state, t, r))
    elif f != r:
        note('a renewal that began in `%s` fails in `%s`: Figure 2 draws the edge to `active`, the receipt says `%s`'
             % (began, state, r))
    else:
        ok('began `%s`, failed in `%s`: all three say `%s`' % (began, state, r))
for s in ('clearing', 'carded', 'probing'):
    if 'then' not in cell[s]:
        note('Table 3.3.11a gives `%s` its seconds ("%s") and not what follows a timeout; Figure 2 and the receipt do' % (s, cell[s]))

# ---- Table 3.3.11b: renewalDue ----------------------------------------------------------------------------------
trig = table_rows('*Table 3.3.11b')[1:]
T = [(r[0], r[1], [x.strip() for x in r[2].split(',')]) for r in trig]
assert all(c in ('hard', 'soft') for _, c, _ in T)
ROLES = ['overlord', 'coordinator', 'worker', 'reviewer', 'auditor', 'replay', 'plain']
anchor('Exhaustive tests of first-match deciders, with a monotonicity property | `overlordReadiness`, `itemClassFloor`, `overlordMayAct`, `renewalDue`, `followUpDue`, `mayHold`')
anchor('Each row is a row of `renewalDue`\'s table for the roles it names.')
order_stated = 'tests the hard rows first' in FLAT
for role in ROLES:
    mine = [(i, name, cls) for i, (name, cls, roles) in enumerate(T) if role in roles]
    if not mine:
        ok('renewalDue: `%s` has no trigger row, so it is never due' % role)
        continue
    k = len(mine)
    wrong = 0
    first_pair = None
    for bits in range(1, 2 ** k):
        fired = [mine[j] for j in range(k) if bits >> j & 1]
        strongest = 'hard' if any(c == 'hard' for _, _, c in fired) else 'soft'
        if order_stated or FIX:
            fired = sorted(fired, key=lambda x: (x[2] != 'hard', x[0]))
        first = fired[0][2]
        if first != strongest:
            wrong += 1
            if first_pair is None:
                first_pair = (fired[0][1], [n_ for _, n_, c in fired if c == 'hard'][0])
    if wrong:
        ce('RNW-order', '`%s`: %d rows, %d non-empty sets of fired triggers; in the table\'s own order the first match is'
           ' `soft` while a `hard` row also fired in %d of them, e.g. "%s" before "%s". A soft answer waits for the'
           ' preconditions, the budget and the least age.' % (role, k, 2 ** k - 1, wrong, first_pair[0][:50], first_pair[1][:60]))
    else:
        ok('renewalDue: `%s`, %d sets of fired triggers: a hard row always answers first' % (role, 2 ** k - 1))

# The coordinator's rows against C50 in Table 13a.
c50 = [r for r in table_rows('*Table 13a')[1:] if r[0] == 'C50'][0][3]
KEY = {
    'Hard cap': 'the hard cap', 'Two compactions': 'two compactions', 'A new ccrc install': 'a new install',
    'A probe failed': 'a failed probe', 'A proactive compaction the PreCompact arm refused': 'a refused proactive compaction',
    'Not local': 'not local', 'A resumed long conversation': 'a resumed long conversation', 'A wave boundary': 'a wave boundary',
}
for name, cls, roles in T:
    if 'coordinator' not in roles:
        continue
    k = [v for kk, v in KEY.items() if name.startswith(kk)]
    assert k, name
    if k[0] in c50 or (FIX and k[0] == 'a refused proactive compaction'):
        ok('C50 names the coordinator row "%s"' % name[:40])
    else:
        ce('RNW-c50', 'Table 3.3.11b gives the coordinator the row "%s" (%s); C50 in Table 13a lists its rows and leaves it out' % (name, cls))

# A stale sample.
anchor('A stale sample is unmeasured, never "below"')
sidecar = [r for r in table_rows('*Table 3.6a')[1:] if r[0] == 'the statusline sidecar'][0][3]
reads = [r[0] for r in trig if 'context' in (r[0] + r[3]) or 'The same reading' in r[3]]
if 'blind' in sidecar or FIX:
    ok('a stale sidecar: the %d rows that read the context are blind' % len(reads))
else:
    ce('RNW-stale', '%d trigger rows read the context sample. For a stale sample Table 3.3.11b says "unmeasured, never'
       ' below" and Table 3.6a says "%s": neither says whether the row fires. The two journals beside it say "that'
       ' trigger is blind".' % (len(reads), sidecar))

summary('generation machine, renewalDue%s' % (' (with the proposed edits)' if FIX else ''),
        '4 failure cases; %d trigger rows x 7 roles, every set of fired triggers (2^19 - 1 for the Overlord, 255 for a coordinator)' % len(T))
