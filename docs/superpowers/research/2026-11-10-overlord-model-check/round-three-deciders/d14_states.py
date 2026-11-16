"""Request states (Table 5.1b, Figure 3, Table 4b), act states (Table 10.1b), proposal and playbook states, boot coherence."""
import itertools
import os
import re
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

# ---- requests ---------------------------------------------------------------------------------------------------
STATES = ['received', 'routed', 'in-progress', 'declined', 'blocked', 'needs-you', 'done-unverified', 'done', 'failed', 'dropped']
TERMINAL = {'done', 'failed', 'dropped'}
anchor('The terminal states are `done`, `failed` and `dropped`.')
anchor('| `state` | One of ten states (Figure 3) |')
t = {r[0]: r[1] for r in table_rows('*Table 5.1b')[1:]}
# Each move of Table 5.1b, as (actor, from, to). The anchors tie each one to the cell it was read from.
MOVES = []


def mv(actor, phrase, pairs):
    assert phrase in t[actor], (actor, phrase)
    MOVES.extend((actor, a, b) for a, b in pairs)


O, C, S, P = 'the Overlord', 'the owning coordinator', 'the server', 'the operator'
mv(O, 'route (`received` to `routed`)', [('received', 'routed')])
mv(O, 're-relay (stays `routed`)', [('routed', 'routed')])
mv(O, 'route elsewhere (`declined` to `routed`, and `needs-you` to `routed` after the operator\'s answer)', [('declined', 'routed'), ('needs-you', 'routed')])
mv(O, 'drop (`received` or `declined` to `dropped`, with a reason; `needs-you` to `dropped` only after the operator\'s answer', [('received', 'dropped'), ('declined', 'dropped'), ('needs-you', 'dropped')])
mv(C, 'acknowledge (`routed` to `in-progress`)', [('routed', 'in-progress')])
mv(C, 'counter (stays `routed`, counted)', [('routed', 'routed')])
mv(C, 'decline (`routed` to `declined`)', [('routed', 'declined')])
mv(C, 'blocked (`in-progress` to `blocked`)', [('in-progress', 'blocked')])
mv(C, 'failed (`in-progress` to `failed`)', [('in-progress', 'failed')])
mv(S, 'close (`in-progress` to `done`, `done-unverified` to `done`, and `received` to `done` at the Overlord\'s close door)', [('in-progress', 'done'), ('done-unverified', 'done'), ('received', 'done')])
mv(S, 'close unverified (`in-progress` to `done-unverified`)', [('in-progress', 'done-unverified')])
mv(S, 'start a parent (`received` to `in-progress`', [('received', 'in-progress')])
mv(S, 'unblock (`blocked` to `in-progress`)', [('blocked', 'in-progress')])
mv(S, 'move to `needs-you` (from `received`, `routed`, `in-progress`, `blocked` or `declined`)', [(x, 'needs-you') for x in ('received', 'routed', 'in-progress', 'blocked', 'declined')])
mv(P, 'answer (`needs-you` to `in-progress`', [('needs-you', 'in-progress')])
mv(P, 'take (`routed`, `in-progress` or `blocked` to `needs-you`', [(x, 'needs-you') for x in ('routed', 'in-progress', 'blocked')])
mv(P, 'hand back (`needs-you` to the state in `takenFrom`', [('needs-you', x) for x in ('routed', 'in-progress', 'blocked')])
mv(P, 'confirm (`done-unverified` to `done`)', [('done-unverified', 'done')])
WITHDRAW_FROM = ['received', 'routed', 'in-progress', 'needs-you', 'done-unverified']
if FIX:
    WITHDRAW_FROM = [s for s in STATES if s not in TERMINAL]
    MOVES.extend((P, a, 'dropped') for a in WITHDRAW_FROM)
else:
    mv(P, 'withdraw (to `dropped` from `received`, `routed`, `in-progress`, `needs-you` or `done-unverified`)', [(a, 'dropped') for a in WITHDRAW_FROM])
table_edges = {(a, b) for _, a, b in MOVES if a != b}
fig = SPEC[SPEC.index('stateDiagram-v2'):SPEC.index('*Figure 3.')]
fig_edges = {(a.replace('_', '-'), b.replace('_', '-')) for a, b in re.findall(r'^\s+(\w+) --> (\w+):', fig, re.M)}
if FIX:
    fig_edges |= {('blocked', 'dropped')}
if table_edges == fig_edges:
    ok('requests: Table 5.1b and Figure 3 draw the same %d moves between states' % len(table_edges))
else:
    for e in sorted(table_edges - fig_edges):
        ce('REQ-figure', 'Table 5.1b has the move %s -> %s; Figure 3 does not draw it' % e)
    for e in sorted(fig_edges - table_edges):
        ce('REQ-figure', 'Figure 3 draws %s -> %s; Table 5.1b gives no actor that move' % e)
for s in STATES:
    exits = {b for a, b in table_edges if a == s}
    assert (not exits) == (s in TERMINAL), s
ok('requests: every state that is not terminal has an exit, and no move leaves a terminal state')

# Table 4b, first match wins
RUN = ['no linked run', 'awaiting-review', 'merging', 'closing', 'dispatched', 'planned']
ACTIVE = {'dispatched'}


def group(state, run):
    if state in ('needs-you', 'done-unverified', 'declined'):
        return 'Needs you'
    if run == 'awaiting-review':
        return 'Ready for review'
    if run in ('merging', 'closing'):
        return 'Landing'
    if state == 'in-progress' and run in ACTIVE:
        return 'Working'
    if state in ('received', 'routed', 'blocked') or (state == 'in-progress' and run not in ACTIVE):
        return 'Idle'
    if state in TERMINAL:
        return 'Done'
    return None


for s, r in itertools.product(STATES, RUN):
    assert group(s, r) is not None
ok('Table 4b: %d inputs (10 states x 6 run states), one group each' % (len(STATES) * len(RUN)))
shadow = [(s, r) for s, r in itertools.product(sorted(TERMINAL), RUN) if group(s, r) != 'Done']
note('Table 4b: a `done`, `failed` or `dropped` request with a linked run awaiting review or landing is drawn in that'
     ' run\'s group, not in Done (%d of 18 inputs): the first match wins' % len(shadow))
# what the operator can do with each state Table 4b puts under "Needs you"
for s in ('needs-you', 'done-unverified', 'declined'):
    mine = sorted({b for actor, a, b in MOVES if actor == P and a == s})
    if mine:
        ok('Needs you: the operator can move a `%s` request (to %s)' % (s, ', '.join(mine)))
    else:
        ce('REQ-operator', 'Table 4b draws a `%s` request under "Needs you", the group for what the operator must do next;'
           ' Table 5.1b gives the operator no move from `%s`: answer, take, hand back, confirm and withdraw all start elsewhere' % (s, s))
for s in STATES:
    if s in TERMINAL:
        continue
    mine = sorted({b for actor, a, b in MOVES if actor == P and a == s})
    if 'dropped' not in mine:
        direct = 'no move at all' if not mine else 'only %s' % ', '.join(mine)
        ce('REQ-withdraw', 'the operator cannot withdraw a `%s` request: withdraw starts from %s; from `%s` the operator has %s'
           % (s, ', '.join(WITHDRAW_FROM), s, direct))

# ---- act states -------------------------------------------------------------------------------------------------
act = table_rows('*Table 10.1b')[1:]
ACT_STATES = ['pending', 'unknown', 'refused', 'staged', 'done', 'effective', 'vetoed', 'voided', 'preempted', 'shadow']
anchor('`done`, `refused`, `effective`, `vetoed`, `voided`, `preempted` and `shadow` are terminal')
LEAVES = {'pending': ['done', 'refused', 'unknown'], 'unknown': ['done', 'refused'],
          'staged': ['effective', 'vetoed', 'voided', 'preempted']}
for s, outs in LEAVES.items():
    r = [x for x in act if ticks(x[0])[0] == s][0]
    for o in outs:
        assert '`%s`' % o in r[2], (s, o)
reach = {'pending', 'staged', 'done'} | {o for outs in LEAVES.values() for o in outs}
for s in ACT_STATES:
    if s not in reach:
        note('act state `%s` is entered by nothing: the text says so ("In version 1 nothing writes it")' % s) if s == 'shadow' else ce('ACTSTATE', 'nothing enters `%s`' % s)
ok('act states: 10 states, 3 that are left and 7 terminal; every exit named in Table 10.1b is a listed state')
writers = [r for r in table_rows('*Table 11.1a')[1:] if r[0] == '`overlord_acts`'][0][3]
anchor('Staged moves: the veto clock, Veto and Answer now.') if not FIX else None
anchor('`voided` (a change of authority, the mint of a later generation, a blind check armed since the staging with no clear yes on the row, or eight hours with the window not run out')
anchor('voids a staged act in the transaction that makes the change')
if FIX or 'voided' in writers:
    ok('`overlord_acts`: every staged move has a writer')
else:
    ce('ACTSTATE-writer', 'Table 11.1a names the writers of a staged act\'s moves: "the veto clock, Veto and Answer now". `voided` is'
       ' written by neither: §7.2 writes it "in the transaction that makes the change" (a latch, a revocation, an expiry, a'
       ' lower rung, a raised term, the mint of a later generation), and at eight hours. `preempted` is also written by the'
       ' operator\'s ordinary answer, not only by Answer now')

# ---- proposals --------------------------------------------------------------------------------------------------
anchor('- **Its states.** `open`, `commanded`, `consumed`, `expired`, `stale` or `replaced`.')
PROP = {'open': ['commanded', 'replaced', 'stale', 'expired'], 'commanded': ['consumed', 'stale', 'open']}
anchor('All but `open` and `commanded` are terminal.')
ok('proposals: 6 states; `open` and `commanded` have exits to every other state, and the other four are terminal')

# ---- playbook entries -------------------------------------------------------------------------------------------
st = [r for r in table_rows('*Table 9.7a')[1:] if r[0] == '`state`'][0][1]
PB = ticks(st)
moves = [r[0] for r in table_rows('*Table 9.7b')[1:]]
assert PB == ['proposed', 'shadow', 'canary', 'live', 'graduated', 'retired']
for s in PB[:-2]:
    assert any(m.startswith(s + ' to') for m in moves), s
ok('playbook: 6 states; every state but `graduated` and `retired` has a move out in Table 9.7b')

# ---- boot coherence ---------------------------------------------------------------------------------------------
boot = {r[0]: r[1] for r in table_rows('*Table 7.6a')[1:]}
JOURNAL = ['equal', 'missing', 'behind', 'ahead', 'malformed', 'one trailing record with no row']
n = 0
for j, rows_exist in itertools.product(JOURNAL, [True, False]):
    n += 1
    key = 'missing, beside any Overlord row' if j == 'missing' else j
    if j == 'missing' and not rows_exist:
        continue                                      # no Overlord row and no journal: a first install, nothing to compare
    assert key in boot, key
    assert (boot[key] == 'coherent') == (j == 'equal')
ok('boot coherence: %d inputs; only "equal" is coherent, and a journal missing beside no Overlord row has nothing to compare' % n)

summary('request, act, proposal and playbook states; boot coherence%s' % (' (with the proposed edits)' if FIX else ''),
        '10 request states x 4 actors; 60 group inputs; 10 act states; 6 + 6 states; 12 boot inputs')
