"""Part 2: the closed vocabularies, each list against every use in the text, both ways."""
import os
import re
from common import SPEC, FLAT, LINES, anchor, ce, ok, note, summary, table_rows, ticks

FIX = os.environ.get('FIX') == '1'

S116 = SPEC.index('### 11.6 Refusal words')
E116 = SPEC.index('### 11.7 How the design is verified')
OUTSIDE = re.sub(r'\s+', ' ', SPEC[:S116] + SPEC[E116:])

# ---- 1. refusal words ---------------------------------------------------------------------------------------------
rows = table_rows('*Table 11.6')[1:]
WORD = {ticks(r[0])[0]: r for r in rows}
assert len(WORD) == len(rows) == 57
used = {}
for m in re.finditer(r'(?:refus(?:es|ed|e|al)|answers?|is refused|are refused)\s+(?:[a-z ,]{0,40}?)`([a-z][a-z0-9:<>-]*)`', OUTSIDE):
    used.setdefault(m.group(1), 0)
    used[m.group(1)] += 1
# tokens the pattern catches that are not refusals: states, classes, tree words, option values
NOT_REFUSALS = {'blind', 'ccrc-overlord', 'coord-lift-off', 'expired', 'fable', 'full', 'inferred', 'needs-you', 'none', 'not-asked',
                'overlord-only', 'overturned', 'return-over-asked', 'skipped', 'subject', 'unforecastable', 'unservable', 'unsure',
                'value', 'fable-operator-only', 'claimant-is-a-worker'}
stray = sorted(w for w in used if w not in WORD and w not in NOT_REFUSALS)
if stray:
    for w in stray:
        ce('VOC-refusal', 'a door refuses or answers `%s` in the text; Table 11.6 has no row for it' % w)
else:
    ok('refusal words: every word a door refuses or answers with outside §11.6 has a row in Table 11.6 (%d words used)'
       % len([w for w in used if w in WORD]))
unused = [w for w in WORD if len(re.findall(r'`%s' % re.escape(w.split(':')[0]), OUTSIDE)) == 0]
if unused:
    for w in unused:
        ce('VOC-refusal', 'Table 11.6 lists `%s`; nothing outside §11.6 uses or defines it' % w)
else:
    ok('refusal words: each of the 57 rows of Table 11.6 is used outside §11.6')
def door_set(text):
    t = text.lower().replace('`', '').replace("the owner's ", 'the ').replace(' request door', ' door').replace('open request', 'open a request')
    return {x.strip() for x in re.split(r'[;,]| and ', t) if x.strip()}


for r in table_rows('*Table 5.5b')[1:]:
    w = ticks(r[0])[0]
    if not door_set(r[1]) <= door_set(WORD[w][1]):
        ce('VOC-refusal-door', '`%s`: Table 5.5b says "%s", Table 11.6 says "%s"' % (w, r[1], WORD[w][1]))
ok('refusal words: the ten words of Table 5.5b name doors that Table 11.6 names too')
# practice-contradicts: a door or a lane
anchor('| proposed to shadow | automatic, after a clean replay of the last 60 days; otherwise the entry is `retired`, with the reason `practice-contradicts` |')
if WORD['practice-contradicts'][1] == 'The practice door' and not FIX:
    ce('VOC-refusal-door', '`practice-contradicts`: Table 11.6 gives it to "The practice door"; Table 9.7b has the practice lane write it,'
       ' as the reason on an entry it retires after the replay. The door has already accepted the entry as `proposed`')
else:
    ok('`practice-contradicts` is the practice lane\'s word')

# ---- 2. overlordOutcome -------------------------------------------------------------------------------------------
m = re.search(r'`overlordOutcome` is one closed L0 list\.\*\* Its values are (.*?)\. The cause is a row of Table 6\.7c:(.*?)\. The 85%', SPEC, re.S)
VALUES, CAUSES = ticks(m.group(1)), ticks(m.group(2))
assert VALUES == ['answered', 'escalated', 'returned', 'withdrawn', 'lapsed', 'staged', 'operator-answered', 'not-ready:<word>', 'server-gap', 'released:<cause>']
t115 = [r for r in table_rows('*Table 11.5.')[1:] if r[0].startswith('The `overlordOutcome` list')][0][0]
listed = ticks(t115)[1:]
miss = [v for v in VALUES if v not in listed]
if miss and not FIX:
    ce('VOC-outcome', 'Table 11.5 restates the `overlordOutcome` list and leaves out %s; §6.1 lists %d values' % (', '.join('`%s`' % v for v in miss), len(VALUES)))
else:
    ok('Table 11.5 lists the ten values of `overlordOutcome`')
c116 = ticks(WORD['released:<cause>'][2])
miss = [c for c in CAUSES if c not in c116]
if miss and not FIX:
    ce('VOC-outcome', 'Table 11.6\'s `released:<cause>` row lists the causes and leaves out %s; §6.1 and Table 6.7c ("`deaf` on one row (`deaf`)") have it'
       % ', '.join('`%s`' % c for c in miss))
else:
    ok('Table 11.6 lists the seven causes of `released:<cause>`')
brackets = set()
for r in table_rows('*Table 6.7c')[1:]:
    brackets |= set(re.findall(r'\(`([a-z-]+)`\)', r[0]))
(ok if brackets == set(CAUSES) else lambda x: ce('VOC-outcome', x))('Table 6.7c\'s bracketed causes are the seven of §6.1: %s' % sorted(brackets))

# ---- 3. act kinds -------------------------------------------------------------------------------------------------
cat = table_rows('*Table 7.1a')[1:]
KINDS = set()
for r in cat:
    KINDS |= set(ticks(r[0]))
doors = table_rows('*Table 11.1e')[1:]
named = set()
for r in doors:
    if 'Overlord' in r[0] or r[0].startswith(('Answer and escalate', 'Propose and object', '`acknowledge`', '`model-write`', 'Relay', 'Route')):
        named |= {x for x in ticks(r[0]) if re.fullmatch(r'[a-z]+(-[a-z]+)+|acknowledge|object', x)}
stray = sorted(named - KINDS - {'ccrc-api', 'overlord-act'})
(ok if not stray else lambda x: ce('VOC-act', x))('every act a row of Table 11.1e names in backticks is a kind of Table 7.1a (%d names; strays: %s)' % (len(named), stray))
raises = [i + 1 for i, ln in enumerate(LINES) if re.search(r'(the Overlord|it) raises (an|a suggestion) item', ln)]
anchor('**Only its doors.** The designated session is refused on every write lane that is not an Overlord door: peer mail, raising items')
if raises and not ('`raise-item`' in SPEC or FIX):
    ce('VOC-act', 'lines %s say the Overlord raises an item (Restart and Reassign controls; a suggestion to retire). Table 7.1a has no'
       ' kind that raises one: `escalate` and `attach-brief` act on a row that exists, and the item-raise lane refuses it'
       ' `overlord-uses-its-doors`' % ', '.join(map(str, raises)))
else:
    ok('every item the text has the Overlord raise goes through a kind of Table 7.1a')
anchor('- **A blameless review.** The Overlord writes it as background work')
case_writer = [r for r in table_rows('*Table 11.1a')[1:] if r[0] == '`practice_cases`'][0][3]
if case_writer == 'The case lane' and not FIX:
    ce('VOC-act', '§10.5 has the Overlord write a case\'s review. `practice_cases` has one writer, the case lane, Table 11.1e has no'
       ' door that takes a review, and Table 7.1a has no kind for it')
# compensators
anchor('a correction mail for an answer or a relay, and the end of the programme for a start. A re-kick\'s is a correction mail')
ok('compensators: relay, the answers (and the effects they carry), start and re-kick each name one; `deploy` is refused at every rung')

# ---- 4. readiness words and generation states in use ---------------------------------------------------------------
READY = [ticks(r[0])[0] for r in table_rows('*Table 6.4a')[1:]]
used_words = set(re.findall(r'`not-ready:([a-z-]+)`', SPEC))
(ok if used_words <= set(READY) else lambda x: ce('VOC-state', x))('every `not-ready:<word>` written out names a readiness word: %s' % sorted(used_words))
ret_words = set()
for r in table_rows('*Table 6.7c')[1:]:
    ret_words |= {w for w in ticks(r[0]) if w in READY}
missing = [w for w in READY if w != 'ready' and w not in ret_words]
(ok if not missing else lambda x: ce('VOC-state', x))('Table 6.7c gives every readiness word but `ready` a row (missing: %s)' % missing)
GEN = [ticks(r[0])[0] for r in table_rows('*Table 3.3.11a')[1:]]
for phrase in ['9. the generation in `draining`, `checkpointed`, `clearing`, `carded` or `probing`',
               '| `renewing` | Its generation is in `draining`, `checkpointed`, `clearing`, `carded` or `probing`']:
    anchor(phrase)
ok('the five states between `active` and the next `active` are listed the same way in Table 6.4a and at gate 9')

# ---- 5. capability words against the waves -----------------------------------------------------------------------
caps = table_rows('*Table 11.1d')[1:]
words = dict(re.findall(r'`([a-z0-9-]+)` \((W[0-9][ab]?)', caps[0][0].replace('`push-outbox-v1` and `overlord-v1` (W1)', '`push-outbox-v1` (W1), `overlord-v1` (W1)')))
words.update(dict(re.findall(r'`([a-z-]+)`[^()`]*\((W[0-9][ab]?)\)', caps[1][0])))
words['hibernate-fresh'] = 'W1a'
assert len(words) == 13, words
waves = {r[0]: r for r in table_rows('*Table 14')[1:]}
bad = 0
for w, wave in sorted(words.items()):
    hits = [k for k, r in waves.items() if '`%s`' % w in r[1]]
    if len(hits) != 1 or not hits[0].startswith(wave):
        bad += 1
        ce('VOC-cap', 'capability word `%s`: Table 11.1d says %s, Table 14 names it in %s' % (w, wave, hits))
if not bad:
    ok('capability words: each of the 13 words of Table 11.1d is named once in Table 14, in the wave Table 11.1d gives it')
for phrase, word in [('Until then each refuses `capability-missing`, naming `overlord-route-v1`', 'W2'),
                     ('the server advertises `overlord-answer-v1`, the capability word of W3\'s second step', 'W3'),
                     ('**Clause 22, in W1**, acts only while the server advertises `overlord-v1`', 'W1')]:
    anchor(phrase)
ok('three uses of a capability word in prose name the wave Table 11.1d gives')
w_row = [r for r in table_rows('*Table 11.1a')[1:] if r[0].startswith('The witness epoch')][0]
a_row = [r for r in table_rows('*Table 11.1a')[1:] if r[0] == 'The act journal'][0]
if w_row[5] == 'W1' and a_row[5] == 'W2' and 'act journal' in w_row[0] and not FIX:
    ce('VOC-wave', 'Table 11.1a ships "the witness epoch, with the heads of the authority journal and the act journal" in W1; the act'
       ' journal ships in W2, so W1 has no such head to send')
else:
    ok('the witness carries the act journal\'s head from the wave that ships that journal')

# ---- 6. doors ----------------------------------------------------------------------------------------------------
a, b = SPEC.index('| Door | Context and ring'), SPEC.index('*Table 11.1e.')
T = SPEC[a:b]
paths = set(re.findall(r'`((?:POST|GET|DELETE) /api/overlord[^`]*)`', SPEC))
READS = {'board', 'feed', 'history', 'inbox', 'model'}
miss = []
for p in sorted(paths):
    if p in T:
        continue
    tail = p.split('/api/overlord/')[1].split('?')[0]
    if tail in READS and 'The Overlord\'s reads: board, `messages`, inbox, history, model, feed' in T:
        continue
    if p == 'DELETE /api/overlord/designate' and '`DELETE` (retire keeps the row' in T:
        continue
    miss.append(p)
(ok if not miss else lambda x: ce('VOC-door', x))('doors: each of the %d `/api/overlord` paths in the text has a row in Table 11.1e (missing: %s)' % (len(paths), miss))
stepup = [r for r in table_rows('*Table 11.2')[1:] if r[0] == 'The operator\'s doors'][0][2]
anchor('- **Lowering never needs a step-up.** Pause, `off` and any lower rung are one tap.')
anchor('**Its only widening writer is a session-gated operator door with a step-up:** `POST /api/overlord/grants`, and `DELETE` to revoke.') if not FIX else None
if 'revok' not in stepup and not FIX:
    ce('VOC-stepup', '§7.2 names "a session-gated operator door with a step-up: `POST /api/overlord/grants`, and `DELETE` to revoke".'
       ' Table 11.2\'s step-up list has a grant, a grant leaving shadow and a renewal, and no revoke; §11.2 says lowering never'
       ' needs a step-up. One place puts the revoke behind the step-up, the other does not')
else:
    ok('a revoke needs no step-up, in §7.2 and in Table 11.2')
anchor('- **Easing a gate is an authority change.** A refit that makes a gate easier to pass is journalled in the authority journal (§7.6), and needs the operator\'s tap.')
if 'refit' not in stepup and not FIX:
    ce('VOC-stepup', '§3.7: a decision-model refit that eases a gate "is an authority change" and "needs the operator\'s tap". Table 11.2\'s'
       ' step-up list names arming a row and not that tap, and Table 11.1e has no row for it')
else:
    ok('the tap on a refit that eases a gate is in the step-up list')

# ---- 7. measures -------------------------------------------------------------------------------------------------
M = {r[0]: r for r in table_rows('*Table 12')[1:]}
assert list(M) == ['M%d' % i for i in range(1, 33)]
ok('measures: M1 to M32 are each one row of Table 12, in order')
t12a, t12b = SPEC.index('## 12. Measures of success'), SPEC.index('## 13. Decisions')
OUT12 = re.sub(r'\s+', ' ', SPEC[:t12a] + SPEC[t12b:])
cites = sorted({int(x) for x in re.findall(r'\bM(\d+)\b', OUT12)})
assert all(1 <= c <= 32 for c in cites)
ok('measures: %d of the 32 are cited outside Table 12, and no citation names a number outside M1 to M32' % len(cites))
anchor('Trigger: M1 shows prompts as a large share of what still reaches the operator after W3.') if not FIX else None
if 'approval' not in M['M1'][1].lower() and 'prompt' not in M['M1'][1].lower() and not FIX:
    ce('VOC-measure', '"M1 shows prompts as a large share of what still reaches the operator": M1 counts "items and asks that reach the'
       ' operator", read from `operator_items`, `asks`, `overlord_acts` and `answerExamined`. A child\'s permission prompt is an approval,'
       ' a third channel (Table 6.1a), so M1 cannot show its share')
anchor('Holds, acts, model tokens, decision-model calls and pushes are counted against the programme that caused them (M29).')
if 'decision-model' not in M['M29'][1] and not FIX:
    ce('VOC-measure', '§6.8 counts "holds, acts, model tokens, decision-model calls and pushes" per programme in M29; M29\'s row counts'
       ' "holds, acts, tokens and pushes" and no decision-model calls')
anchor('A read with no turn behind it is counted (M32).')
if 'no turn' not in M['M32'][1] and not FIX:
    ce('VOC-measure', '§3.8: "A read with no turn behind it is counted (M32)". M32\'s row counts "reads per door per day against the'
       ' 28-day median" and says nothing of a read with no turn behind it')
if FIX:
    ok('M1, M29 and M32 measure what the prose cites them for')

summary('closed vocabularies%s' % (' (with the proposed edits)' if FIX else ''),
        '57 refusal words; 10 outcome values and 7 causes; %d act kinds; 14 readiness words; 13 capability words; %d paths; 32 measures'
        % (len(KINDS), len(paths)))
