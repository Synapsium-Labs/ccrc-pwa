"""roleOf (Table 3.3.9a), its undecided answers, and the columns and records that read a role (§3.3.9)."""
import itertools
import os
from common import SPEC, FLAT, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

rows = table_rows('*Table 3.3.9a')[1:]
ORDER = [ticks(r[0])[0] for r in rows]
assert ORDER == ['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain']
anchor('*Table 3.3.9a. The roles, in the order `roleOf` tests them.*')
anchor('An unreadable child mark, or a child of a run whose kind is unknown, reads as undecided between `worker` and `reviewer`.')
anchor('A claim or an intent that could not be measured, with no measured yes beside it, reads as undecided between `coordinator` and `plain`.')
anchor('The members of each undecided answer share one `SessionRole` view')
anchor('Where a fact is unmeasured `roleOf` gives a typed undecided answer, never a guess')
anchor('The server reaches it only through the agent\'s measured reads, which tell absent, unreadable and stale apart.')
VIEW = {'overlord': 'coordinator', 'coordinator': 'coordinator', 'plain': 'coordinator',
        'worker': 'child', 'reviewer': 'child', 'auditor': 'child', 'replay': 'child'}
anchor('`worker`, `reviewer`, `auditor` and `replay` read as `child`')
anchor('`overlord`, `coordinator` and `plain` read as `coordinator`')

DES = ['none', 'pending', 'live', 'retired']
MARK = ['absent', 'on a work run', 'on a review run', 'on a run of unknown kind', 'unreadable', 'not measured']
TRI = ['no', 'yes', 'not measured']
DOM = list(itertools.product(DES, [False, True], [False, True], MARK, TRI, TRI))


def role_of(des, audit, replay, mark, claim, intent):
    """Returns a role, a frozenset of roles (an undecided answer), or None where the text gives no answer."""
    if des in ('pending', 'live'):
        return 'overlord'
    if audit:
        return 'auditor'
    if replay:
        return 'replay'
    if mark == 'on a work run':
        return 'worker'
    if mark == 'on a review run':
        return 'reviewer'
    if mark in ('on a run of unknown kind', 'unreadable'):
        return frozenset({'worker', 'reviewer'})
    if mark == 'not measured':
        if FIX:
            return frozenset({'worker', 'reviewer'})      # read as an unreadable mark: the view is `child`
        return None
    if claim == 'yes' or intent == 'yes':
        return 'coordinator'
    if claim == 'not measured' or intent == 'not measured':
        return frozenset({'coordinator', 'plain'})
    return 'plain'


none = [d for d in DOM if role_of(*d) is None]
if none:
    ce('ROLE-none', '%d of %d inputs get no answer: the child mark could not be measured at all (the agent did not answer).'
       ' §3.3.9 types an unreadable mark and a run of unknown kind, and the tree tells unreadable from unmeasured'
       % (len(none), len(DOM)))
else:
    ok('roleOf: %d inputs, each gets a role or a typed undecided answer' % len(DOM))
for d in DOM:
    r = role_of(*d)
    if isinstance(r, frozenset):
        assert len({VIEW[x] for x in r}) == 1               # the members share one view
ok('every undecided answer has members of one `SessionRole` view')

# What reads a role beyond the view: long-lived (renewal), MAIL_PACE, the compaction text, the card renderer.
anchor('`MAIL_PACE` (§6.4) and the renewal triggers (Table 3.3.11b). Each is total over the roles')
LONG = {ticks(r[0])[0]: r[2] for r in rows}
und = sorted({tuple(sorted(role_of(*d))) for d in DOM if isinstance(role_of(*d), frozenset)})
for u in und:
    lived = {LONG[x] for x in u}
    if len(lived) > 1 and not ('takes the member that does less' in FLAT or FIX):
        ce('ROLE-undecided', 'undecided between `%s` and `%s`: the members differ in the long-lived column (%s), so `renewalDue`,'
           ' `MAIL_PACE` and the card have no row to read. Read as `coordinator`, a renewal ends the conversation of a session'
           ' that may be `plain`' % (u[0], u[1], ' and '.join('%s: %s' % (x, LONG[x]) for x in u)))
    else:
        ok('undecided between `%s` and `%s`: one answer for every reader' % u)

# The compaction text is a column of FLEET_ROLES.
anchor('`compactInstructionsFor(role)`, with text for `overlord`, `coordinator`, `worker`, `reviewer` and `plain`.') if not FIX else None
have = {'overlord', 'coordinator', 'worker', 'reviewer', 'plain'} | ({'auditor', 'replay'} if FIX else set())
for r in ORDER:
    if r not in have:
        ce('ROLE-compact', 'the compaction instructions are a column of `FLEET_ROLES` and C51 gives "every session" instructions;'
           ' the text names five roles and `%s` has none' % r)
if set(ORDER) <= have:
    ok('every role has compaction text')
summary('roleOf%s' % (' (with the proposed edits)' if FIX else ''), '%d inputs; %d undecided answers x 4 readers; 7 roles x the compaction column' % (len(DOM), len(und)))
