"""overlordReadiness (Table 6.4a), the retention decider (Table 6.7c) and the breaker (§6.4).

Encoded as the text gives them. `FIX=1` in the environment applies the edits REPORT.md proposes and runs again.
"""
import itertools
import os
import re
from common import SPEC, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

# ---- Table 6.4a, in its own order -------------------------------------------------------------------------------
rows = table_rows('*Table 6.4a')[1:]
WORDS = [ticks(r[0])[0] for r in rows]
assert WORDS == ['absent', 'off', 'unmeasured', 'dead', 'restarting', 'renewing', 'degraded', 'stranded',
                 'dialog-open', 'wedged', 'deaf', 'saturated', 'unproved', 'ready'], WORDS
anchor('answers one word. The first match')
anchor('It measures dead, and neither `restarting` nor `renewing` (below) matches')
anchor('It is within its measured restart time, and it has restarted at most twice in the last hour')
anchor('or has not read its card or passed its probes. A pending designation reads `renewing`')
# Every way into `degraded` is a generation that has not read its card or has not passed its probes.
anchor('F -- "timeout after one re-nudge" --> X["degraded')      # card never read
anchor('E -- "retries spent after the old one ended" --> X')      # new conversation never read its card
anchor('G -- "second fail" --> X')                                # probes not passed
anchor('A generation never becomes `active` without having read its card and passed its probes')
anchor('or `degraded` if the renewal began there')                # the only way to stay degraded

# `carded` and `probing` are entered two ways: by a renewal the lane started, or by any other start (a crash
# restart, a swap landing, a wake). Table 6.4a does not tell them apart, so the unfixed decider does not either.
anchor('S["any other start<br/>a crash restart, a swap landing, a wake"] --> F')
GEN = ['active', 'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'carded:restart', 'probing:restart',
       'degraded:card-unread', 'degraded:probes-failed']
MOVING = {'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'carded:restart', 'probing:restart'}
LANE_RENEWAL = {'draining', 'checkpointed', 'clearing', 'carded', 'probing'}


def card_and_probes(gen):
    """True when the generation has read its card and passed its probes."""
    return gen == 'active'


def readiness(f):
    degraded = f['gen'].startswith('degraded')
    if f['bound'] == 'none':
        return 'absent'
    if f['off']:
        return 'off'
    if f['registry'] == 'unreadable' or f['boot'] == 'fresh':
        return 'unmeasured'
    renewing = f['gen'] in MOVING or f['bound'] == 'pending'
    if FIX:
        renewing = renewing or (not degraded and not card_and_probes(f['gen']))
    else:
        renewing = renewing or not card_and_probes(f['gen'])
    restarting = f['restart'] == 'within, at most 2'
    if FIX:
        lane_renewal = f['gen'] in LANE_RENEWAL or f['bound'] == 'pending'
        if (f['dead'] or f['restart'] == 'within, over 2') and not restarting and not lane_renewal:
            return 'dead'
    elif f['dead'] and not restarting and not renewing:
        return 'dead'
    if restarting:
        return 'restarting'
    if renewing:
        return 'renewing'
    if degraded:
        return 'degraded'
    if f['stranded']:
        return 'stranded'
    if f['dialog']:
        return 'dialog-open'
    if f['wedged']:
        return 'wedged'
    if f['deaf']:
        return 'deaf'
    if f['saturated']:
        return 'saturated'
    if not f['proof']:
        return 'unproved'
    return 'ready'


DOMAIN = {
    'bound': ['live', 'pending', 'none'],
    'off': [False, True],
    'registry': ['ok', 'unreadable'],
    'boot': ['old', 'fresh'],
    'dead': [False, True],
    'restart': ['none', 'within, at most 2', 'within, over 2'],
    'gen': GEN,
    'stranded': [False, True],
    'dialog': [False, True],
    'wedged': [False, True],
    'deaf': [False, True],
    'saturated': [False, True],
    'proof': [True, False],
}
KEYS = list(DOMAIN)
ALL = [dict(zip(KEYS, v)) for v in itertools.product(*[DOMAIN[k] for k in KEYS])]

# ---- Table 6.7c: what each word does to holds -----------------------------------------------------------------
# Level of an answer, from "takes and keeps holds" (0) to "releases every hold towards the operator" (4).
# This order is ours: the text gives no order on the words. It is read off Table 6.7c, column by column.
ret = table_rows('*Table 6.7c')[1:]
anchor('| `renewing`, `restarting` | none | kept if the deadline is later than the word\'s own bound')
anchor('| `saturated`, `unproved` | none | kept |')
anchor('| `unmeasured`, because the server has only just started | none | kept until the boot re-seed decides them |')
anchor('`dead`, `stranded`, `dialog-open`, `wedged`, `deaf`, `degraded` | none | all released in one grouped push |')
RELEASE_ALL = {'absent', 'off', 'dead', 'stranded', 'dialog-open', 'wedged', 'deaf', 'degraded'}


anchor('| a generation `degraded` | condition | cap `chat` |')
anchor('| the rung leaves `full` (`rung`), a kind is disarmed (`disarmed`), engagement leaves `full`')


def level(word, f):
    if f['gen'].startswith('degraded'):
        return 4          # whatever the word: a degraded generation caps the rung at `chat`, and the rung row releases all
    if word == 'ready':
        return 0
    if word in ('saturated', 'unproved'):
        return 1
    if word == 'unmeasured':
        return 4 if f['registry'] == 'unreadable' else 2
    if word in ('renewing', 'restarting'):
        return 3
    assert word in RELEASE_ALL, word
    return 4


LEVEL_NAME = {0: 'takes holds', 1: 'no new hold, standing kept', 2: 'kept until the boot re-seed',
              3: 'kept if the deadline is later than the bound', 4: 'all released'}

# 1. total
seen = {}
for f in ALL:
    w = readiness(f)
    assert w in WORDS
    seen.setdefault(w, f)
ok('total: %d inputs, each gets one word' % len(ALL))

# 2. rows that can never be reached
for w in WORDS:
    if w not in seen:
        ce('RDY-unreachable', 'the word `%s` is never answered: every input its row matches is caught by an earlier row' % w)
for cause in ('degraded:card-unread', 'degraded:probes-failed'):
    f = dict(bound='live', off=False, registry='ok', boot='old', dead=False, restart='none', gen=cause,
             stranded=False, dialog=False, wedged=False, deaf=False, saturated=False, proof=True)
    w = readiness(f)
    if w != 'degraded':
        ce('RDY-degraded', 'generation %s, nothing else wrong -> `%s`, not `degraded`. Its holds are released all the same,'
           ' as `released:rung`: the ladder caps a degraded generation at `chat` (Table 7.5a)' % (cause, w))
    else:
        ok('generation %s -> `degraded`' % cause)

# 3. monotonic: one input made worse never moves the answer towards holding
WORSE = {
    'registry': [('ok', 'unreadable')],
    'dead': [(False, True)],
    'restart': [('within, at most 2', 'within, over 2')],
    'gen': [('active', 'degraded:card-unread'), ('active', 'degraded:probes-failed')],
    'stranded': [(False, True)],
    'dialog': [(False, True)],
    'wedged': [(False, True)],
    'deaf': [(False, True)],
    'saturated': [(False, True)],
    'proof': [(True, False)],
}
classes = {}
for f in ALL:
    w0 = readiness(f)
    l0 = level(w0, f)
    for k, pairs in WORSE.items():
        for a, b in pairs:
            if f[k] != a:
                continue
            g = dict(f)
            g[k] = b
            w1 = readiness(g)
            l1 = level(w1, g)
            if l1 < l0:
                classes.setdefault((k, a, b, w0, w1), []).append((f, g))
for (k, a, b, w0, w1), pairs in sorted(classes.items(), key=lambda kv: str(kv[0])):
    f, g = pairs[0]
    others = {x: f[x] for x in KEYS if f[x] not in (False, 'ok', 'old', 'none', 'live', True) or (x == 'proof' and not f[x])}
    ce('RDY-monotonic', '%s: %s -> %s moves `%s` (%s) to `%s` (%s); %d input pairs, e.g. %s'
       % (k, a, b, w0, LEVEL_NAME[level(w0, f)], w1, LEVEL_NAME[level(w1, g)], len(pairs), others))
if not classes:
    ok('monotonic by what Table 6.7c does to holds: no single input made worse keeps more holds')

# 4. the crash loop of §3.4
anchor('A crash loop therefore cannot keep holds standing.')
f = dict(bound='live', off=False, registry='ok', boot='old', dead=True, restart='within, over 2', gen='carded:restart',
         stranded=False, dialog=False, wedged=False, deaf=False, saturated=False, proof=False)
w = readiness(f)
if level(w, f) < 4:
    ce('RDY-crashloop', 'it measures dead, third restart in the hour, its generation still `carded` from the last start'
       ' -> `%s` (%s). §3.4: "A crash loop therefore cannot keep holds standing."' % (w, LEVEL_NAME[level(w, f)]))
else:
    ok('a third restart in the hour with the generation in `carded` -> `%s`' % w)

# 5. context, not counted: a state (not a fault) that shadows a release-all word
f = dict(bound='live', off=False, registry='ok', boot='old', dead=False, restart='none', gen='draining',
         stranded=True, dialog=False, wedged=False, deaf=False, saturated=False, proof=True)
note('no account can serve it while a renewal drains -> `%s` (%s); Table 3.4b says `stranded` releases all. The word'
     ' reaches `stranded` when the renewal fails back to `active`.' % (readiness(f), LEVEL_NAME[level(readiness(f), f)]))

# ---- the retention decider: every part of mayHold against the causes of Table 6.7c --------------------------------
anchor('Retention.** What happens to holds is asked again on every event that can change a part of `mayHold`: readiness,')
m = re.search(r'on every event that can change a part of `mayHold`: (.*?)\. There is no fixed grace', SPEC, re.S)
events = [e.strip() for e in re.sub(r'\s+', ' ', m.group(1)).split(',')]
table_text = ' '.join(' '.join(r) for r in ret)
EVENT_ROW = {
    'readiness': '`renewing`, `restarting`',
    'the ladder': 'the rung leaves `full`',
    'arming': 'a kind is disarmed',
    'a grant revoked': 'its grant is revoked, suspended or expires',
    'suspended or expired': 'its grant is revoked, suspended or expires',
    'a class raised': 'a class is raised on a held row',
    'the breaker': 'the breaker' if not FIX else 'the breaker opens',
    'engagement': 'engagement leaves `full`',
    'a load line': 'the 85% load line is crossed',
    'a bypass': 'a kind is bypassed for a programme',
}
fixed_rows = table_text + (' the breaker opens (kept to their deadlines) the operator speaks to that programme' if FIX else '')
for e in events:
    key = EVENT_ROW[e]
    if key in fixed_rows:
        ok('retention: the event "%s" has a row' % e)
    else:
        ce('RET-norow', 'the Retention sentence names the event "%s"; Table 6.7c has no row for it' % e)
anchor("the programme's engagement is `full`, and the operator is not at that programme")
if 'operator-at-programme' in fixed_rows or 'the operator speaks to that programme' in fixed_rows:
    ok('retention: "the operator is at that programme" has a row')
else:
    ce('RET-norow', '`mayHold` needs "the operator is not at that programme"; Table 6.7c has no row for the mark'
       ' being written, and the Retention sentence does not name it')

# ---- the breaker ------------------------------------------------------------------------------------------------
anchor('Half-open admits one trial hold.** Served closes it: the Overlord answered, escalated or returned the row before')
anchor('A lapse or a release opens it again with the next wait')
anchor('Void')
m = re.search(r'`overlordOutcome` is one closed L0 list\.\*\* Its values are (.*?)\. The cause is a row of Table 6\.7c:(.*?)\. The 85%',
              SPEC, re.S)
values = ticks(m.group(1))
causes = ticks(m.group(2))
READY_WORDS = [w for w in WORDS if w != 'ready']
outcomes = []
for v in values:
    if v == 'not-ready:<word>':
        outcomes += ['not-ready:' + w for w in READY_WORDS]
    elif v == 'released:<cause>':
        outcomes += ['released:' + c for c in causes]
    else:
        outcomes.append(v)


def trial(outcome):
    """What a half-open breaker does when its one trial hold ends, by the four sentences of §6.4."""
    if outcome in ('answered', 'escalated', 'returned'):
        return 'closed'                       # served
    if outcome == 'lapsed':
        return 'open'                         # a lapse
    if outcome in ('not-ready:wedged', 'not-ready:dialog-open', 'not-ready:deaf'):
        return 'open'                         # a release, as §6.4 defines it
    if outcome in ('operator-answered', 'withdrawn'):
        return 'half-open'                    # void: the trial is given back
    if FIX:
        if outcome == 'staged':
            return 'closed'                   # served: a staged answer settles the hold (§7.2)
        if outcome == 'released:deaf':
            return 'open'                     # a release: that row alone was let go as `deaf`
        return 'half-open'                    # void: any other end the Overlord did not cause
    return None


missing = [o for o in outcomes if trial(o) is None]
if missing:
    ce('BRK-trial', 'half-open, the trial hold ends with an outcome §6.4 gives no rule for, so the breaker neither closes,'
       ' opens nor gets its trial back: %s' % ', '.join(missing))
else:
    ok('breaker: every one of the %d hold outcomes moves a half-open breaker' % len(outcomes))

summary('overlordReadiness, retention, breaker%s' % (' (with the proposed edits)' if FIX else ''),
        '%d readiness inputs; %d retention events; %d trial outcomes' % (len(ALL), len(events) + 1, len(outcomes)))
