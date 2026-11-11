#!/usr/bin/env python3
"""measure-autonomy.py: the coordinator-autonomy census (spec 2026-11-09 §1.2 and §10), READ-ONLY.

This file holds the `transcripts` subcommand, run on the FLEET box, where the session transcripts live. It reads
every `*.jsonl` under its `--root` directories (default: each `$HOME/.claude*/projects`) and writes nothing outside
`--out`. A transcript is opened for reading only; an `--out` inside a transcript root is refused (exit 2) before
anything is created, and so is a root that does not exist. No login, host, path or session name is written into this
file, and a printed table carries counts and hours only: an excerpt of a question goes to `--out` and nowhere else.

    python3 deploy/measure-autonomy.py transcripts [--since YYYY-MM-DD] [--until YYYY-MM-DD]
                                                   [--root DIR]... [--out DIR]

A wait counts in the window when it STARTED in [--since, --until) (UTC days).

The `items` subcommand runs on the SERVER box, over the coordination database, READ-ONLY: the connection is opened
`mode=ro` with `query_only` on, every statement is a SELECT, and a missing `--db` exits 2 without creating a file.

    python3 deploy/measure-autonomy.py items --db PATH [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out DIR]

  M3, per programme: operator items raised (`operator_items.raisedAt` in the window) plus asks released to the operator
  (the asks that reached the operator: a coordinator-parent ask moved off the coordinator, state released, declined,
  answering or answered with `releasedAt` in the window (the sweep's lapse by `CoordStore.releaseAsk`, the parent's
  hand-over by `declineAsk`, and a row minted released with a `releaseReason`), and an operator-parent ask whose `at`
  is in the window; a `stale` row is in neither, nobody decided it), over programme-days with an open run. An ask
  belongs to the programme of its `runId`; an ask with no run is counted in `unattributed-asks` and in no programme. A
  run is open from `runs.openedAt` to its terminal `run_events` row (toState done, failed or unknown), else to its
  `closedAt`, else to the window's end; a UTC day counts when any run of the programme was open for any part of it.
  M6, per ISO week (UTC, Monday): coordinator-hours flagged by `coord-blocked`. Where the verdict is recorded
  (`applyStallSession` in server/src/watch.ts): a run-less coordinator's push goes through `pushOne` with
  `recordAlways`, which archives a `feed_events` row of kind `run` titled "coordinator blocked" (rung 1) or "coordinator
  blocked (escalated)" (rung 2), and nothing else records it (the latch is in memory). This reads that one source. A
  flagged coordinator-hour is a distinct (session, UTC hour) holding at least one such row, a lower bound: the arm
  records no recovery row, and the feed keeps only its newest rows (`FEED_RETENTION`).
  M6 is valid only while the arm delivers live. `applyStallSession` writes no `feed_events` row when `stallNotifyDelivery`
  reads shadow (a wave-1 arm, until the box's stall-watch markers read live AND escalate): a run-less coordinator then
  leaves a console warning and nothing else (not measurable), and a coordinator with a run leaves a `run_events` row
  whose detail starts `stall-shadow:coord-blocked:`. `m6-shadow-rows` counts those rows in the window; a non-zero value
  means the weeks above under-count and the figure is not a baseline.
Rows printed: `programmes`, `unattributed-asks`, `m3-p1`.. (`items=N asks=N days=N value=V`, an ordinal in slug order, never
a slug), `m3-all`, `m6-shadow-rows` and `m6-YYYY-MM-DD` (the week's Monday). `--out` gets `items.json` (the same figures with the slugs).

The `sample` and `score` subcommands are the M4 reading (spec §5.1's split rule). `sample` runs on the SERVER box over the
same read-only connection as `items`; `score` reads one local CSV and touches no database.

    python3 deploy/measure-autonomy.py sample --db PATH --out DIR [--n 30] [--seed 1] [--since D] [--until D]
    python3 deploy/measure-autonomy.py score FILE

  `sample` draws `n` operator items raised in the window (all of them when fewer), with `random.Random(seed)` over the
  ids in ascending order, so a re-run with the same seed and window draws the same ids. It writes `sample.csv` (columns
  id, kind, title, why, parts; `parts` empty) under `--out`, the only place it writes. A reviewer fills `parts` with one
  class per PART of the question, `;`-separated: `routine`, `big`, `o1`..`o6` or `p1`..`p4`. `score` prints `parts`, the
  count per class, `routine-or-big` and `m4` (that share of all parts, a percentage), and exits 2 naming the row for an
  empty `parts` or an unknown class.

Rows printed (one `name: value` per line):
  transcripts     transcript files read
  coordinators    transcripts that are a coordinator by `is_coordinator`, with at least one row of their own after
                  the swap copies are removed
  typed-reply, dialog, all
                  `count=N over_1h=N hours=H median_h=H p90_h=H`: the waits of that kind (all: both), those over
                  one hour, their summed hours, the median and the nearest-rank 90th percentile in hours
Files under --out: `waits.json` (every Wait, with an `id`), `waits-over-1h.csv` (columns id, kind, hours, excerpt,
parts; `parts` is left empty for a reviewer).
Exit 0 measured; 2 an input missing or refused.
"""
import argparse, csv, datetime, glob, json, os, random, re, sqlite3, sys, time, urllib.parse

# `shared/api.ts`'s IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX and MAIL_ENVELOPE_FENCE: second spellings, bound
# to the first by measure-autonomy.test.ts, which reds when they differ.
IDLE_NUDGE = "Continue with your open tasks. If you were waiting for the operator's answer, say so in one line and stop."
RESUME_PREFIX = 'Continue from where you left off.'
MAIL_FENCE = 'ccrc-mail'
# The head of `server/src/coord/envelope.ts`'s renderMailNudge, the plain-text prompt the mail lane TYPES into a
# session (the fenced envelope reaches a session only as a fetched tool result). Bound by measure-autonomy.test.ts.
MAIL_NUDGE_HEAD = 'ccrc-mail: you have new mail.'
# Other user rows the harness writes that no operator typed: a background-task or subagent completion, a message from
# another session, a slash-command echo and its output, an interrupt marker.
HARNESS_HEADS = ('<task-notification>', 'Another Claude session', '<command-name>', '<command-message>',
                 '<local-command-stdout>', '<local-command-stderr>', '<local-command-caveat>', '[Request interrupted')
# `server/src/idlenudge.ts`'s TURN_END_SUBTYPES: the system rows that follow an `end_turn` assistant row.
TURN_END_SUBTYPES = ('stop_hook_summary', 'turn_duration')
QUESTION_TAIL = 700
EXCERPT_CHARS = 300
HEAD_CHARS = 400
CMD_CHARS = 4000

OPENS_A_RUN = re.compile(r'ccrc-api\s+runs\s+(?:open|dispatch)\b|(?:-X|--request)\s*POST\b[^\n]*?/api/runs(?![\w/-])|POST\s+/api/runs(?![\w/-])')
DECLARES_INTENT = re.compile(r'ccrc-api\s+coordinators\s+intent\s+set\b')
SKILL_NAME = 'ccrc-coordinator'


def fail(msg):
    print(f'measure-autonomy: {msg}', file=sys.stderr)
    sys.exit(2)


def parse_ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def parse_day(s, flag):
    try:
        return datetime.datetime.strptime(s, '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        fail(f'{flag} {s!r} is not a YYYY-MM-DD date')


def slim_block(b):
    """One content block, cut to what the census reads."""
    if isinstance(b, str):
        b = {'type': 'text', 'text': b}
    if not isinstance(b, dict):
        return None
    t = b.get('type')
    if t == 'text' and isinstance(b.get('text'), str):
        s = b['text']
        return {'type': 'text', 'head': s[:HEAD_CHARS], 'tail': s[-QUESTION_TAIL:], 'whole': s if len(s) <= HEAD_CHARS else None}
    if t == 'tool_use':
        inp = b.get('input') if isinstance(b.get('input'), dict) else {}
        out = {'type': 'tool_use', 'name': b.get('name'), 'id': b.get('id')}
        if isinstance(inp.get('command'), str):
            out['command'] = inp['command'][:CMD_CHARS]
        if isinstance(inp.get('skill'), str):
            out['skill'] = inp['skill']
        qs = inp.get('questions')
        if isinstance(qs, list):
            out['question'] = '\n'.join(q.get('question', '') for q in qs if isinstance(q, dict) and isinstance(q.get('question'), str))
        elif isinstance(inp.get('question'), str):
            out['question'] = inp['question']
        return out
    if t == 'tool_result':
        return {'type': 'tool_result', 'id': b.get('tool_use_id')}
    return None


def slim_row(r):
    """A transcript row, or None for one the census never reads."""
    if not isinstance(r, dict):
        return None
    t = r.get('type')
    if t not in ('user', 'assistant', 'system'):
        return None
    msg = r.get('message') if isinstance(r.get('message'), dict) else {}
    content = msg.get('content')
    if isinstance(content, (str, dict)):
        content = [content]
    blocks = [x for x in (slim_block(b) for b in (content if isinstance(content, list) else [])) if x is not None]
    return {
        't': t, 'sub': r.get('subtype'), 'ts': parse_ts(r.get('timestamp')), 'side': r.get('isSidechain') is True,
        'meta': r.get('isMeta') is True, 'compact': r.get('isCompactSummary') is True,
        'uuid': r.get('uuid') if isinstance(r.get('uuid'), str) else None,
        'mid': msg.get('id') if isinstance(msg.get('id'), str) else None,
        'stop': msg.get('stop_reason'), 'blocks': blocks,
    }


def read_transcript(path):
    rows = []
    with open(path, encoding='utf8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = slim_row(json.loads(line))
            except ValueError:
                continue
            if row is not None:
                rows.append(row)
    return rows


def uses(rows):
    for r in rows:
        if r['t'] == 'assistant':
            for b in r['blocks']:
                if b['type'] == 'tool_use':
                    yield b


def is_coordinator(rows):
    """Opened or dispatched a run, AND loaded the coordinator skill or declared coordinator intent."""
    opened = loaded = intent = False
    for b in uses(rows):
        cmd = b.get('command') or ''
        if b['name'] == 'Bash':
            opened = opened or OPENS_A_RUN.search(cmd) is not None
            intent = intent or DECLARES_INTENT.search(cmd) is not None
        elif b['name'] == 'Skill' and SKILL_NAME in (b.get('skill') or ''):
            loaded = True
    return opened and (loaded or intent)


def row_key(r, nth):
    """The identity a swap copy keeps: the message id (the nth row carrying it, since one message is written as a row
    per content block), or a user row's uuid."""
    if r['mid'] is not None:
        return ('m', r['mid'], nth)
    if r['uuid'] is not None:
        return ('u', r['uuid'])
    return None


def dedupe(transcripts):
    """[(name, rows)] -> [(name, rows)] with a row dropped when an EARLIER transcript already holds its key; a swap
    copy contributes nothing new. Transcripts are taken in the order given."""
    seen = set()
    out = []
    for name, rows in transcripts:
        count = {}
        mine, kept = set(), []
        for r in rows:
            nth = count.get(r['mid'], 0) if r['mid'] is not None else 0
            if r['mid'] is not None:
                count[r['mid']] = nth + 1
            k = row_key(r, nth)
            if k is not None:
                if k in seen:
                    continue
                mine.add(k)
            kept.append(r)
        seen |= mine
        out.append((name, kept))
    return out


def text_of(r):
    """(head, tail) of a row's text blocks joined."""
    heads = [b['head'] for b in r['blocks'] if b['type'] == 'text']
    tails = [b['tail'] for b in r['blocks'] if b['type'] == 'text']
    return ''.join(heads), ''.join(tails)


def whole_text(r):
    """A short row's whole text, else None."""
    ts = [b for b in r['blocks'] if b['type'] == 'text']
    if not ts or any(b['whole'] is None for b in ts):
        return None
    return ''.join(b['whole'] for b in ts)


def tool_results_only(r):
    return len(r['blocks']) > 0 and all(b['type'] == 'tool_result' for b in r['blocks'])


def is_mail(r):
    head, _ = text_of(r)
    m = re.match(r'^(`{3,})' + re.escape(MAIL_FENCE) + r'\s*(?:\n|$)', head.lstrip())
    return m is not None or head.lstrip().startswith(MAIL_NUDGE_HEAD)


def is_harness_row(r):
    head, _ = text_of(r)
    return head.lstrip().startswith(HARNESS_HEADS)


def is_system_nudge(r):
    whole = whole_text(r)
    head, _ = text_of(r)
    return ((whole is not None and whole.strip() == IDLE_NUDGE) or head.lstrip().startswith(RESUME_PREFIX)
            or is_harness_row(r))


def mk_wait(session, started, ended, kind, excerpt):
    return {'session': session, 'started': started, 'ended': ended, 'hours': round((ended - started) / 3600.0, 4),
            'kind': kind, 'excerpt': excerpt[-EXCERPT_CHARS:]}


def question_waits(rows, session=''):
    """A finished main-thread turn whose last 700 characters hold a `?`, counted only when the next user row is typed
    by the operator (not a mail wake, a system nudge, a harness-written row (task completion, cross-session message, slash-command echo, interrupt marker), a compaction summary or a meta row). Span: the turn's end to
    that prompt."""
    waits = []
    cur_mid, cur_tail = None, ''
    ended_turn = False
    pending = None  # (turn end, tail)
    for r in rows:
        if r['side']:
            continue
        if r['t'] == 'assistant':
            _, tail = text_of(r)
            if r['mid'] is not None and r['mid'] == cur_mid:
                cur_tail = (cur_tail + tail)[-QUESTION_TAIL:]
            else:
                cur_mid, cur_tail = r['mid'], tail
            ended_turn = r['stop'] == 'end_turn'
            pending = None
        elif r['t'] == 'system':
            if r['sub'] in TURN_END_SUBTYPES and ended_turn and r['ts'] is not None:
                pending = (r['ts'], cur_tail)
                ended_turn = False
        elif r['t'] == 'user':
            if r['compact'] or r['meta'] or tool_results_only(r):
                if r['compact'] or r['meta']:
                    pending = None
                continue
            if pending is not None:
                typed = not is_mail(r) and not is_system_nudge(r)
                if typed and r['ts'] is not None and '?' in pending[1][-QUESTION_TAIL:] and r['ts'] >= pending[0]:
                    waits.append(mk_wait(session, pending[0], r['ts'], 'typed-reply', pending[1]))
            pending = None
            ended_turn = False
    return waits


def dialog_waits(rows, session=''):
    """An `AskUserQuestion` tool use to its `tool_result`."""
    open_ = {}
    waits = []
    for r in rows:
        if r['side']:
            continue
        for b in r['blocks']:
            if r['t'] == 'assistant' and b['type'] == 'tool_use' and b['name'] == 'AskUserQuestion' and b.get('id'):
                if r['ts'] is not None:
                    open_[b['id']] = (r['ts'], b.get('question') or '')
            elif r['t'] == 'user' and b['type'] == 'tool_result' and b.get('id') in open_:
                started, q = open_.pop(b['id'])
                if r['ts'] is not None and r['ts'] >= started:
                    waits.append(mk_wait(session, started, r['ts'], 'dialog', q))
    return waits


def p90(sorted_hours):
    """Nearest-rank 90th percentile: the value at 1-based rank ceil(90n/100), in integer arithmetic."""
    n = len(sorted_hours)
    return sorted_hours[(90 * n + 99) // 100 - 1]


def median(sorted_hours):
    n = len(sorted_hours)
    return sorted_hours[n // 2] if n % 2 else (sorted_hours[n // 2 - 1] + sorted_hours[n // 2]) / 2


def table_row(waits):
    hs = sorted(w['hours'] for w in waits)
    if not hs:
        return 'count=0 over_1h=0 hours=0 median_h=0 p90_h=0'
    return (f'count={len(hs)} over_1h={sum(1 for h in hs if h > 1)} hours={round(sum(hs), 2):g} '
            f'median_h={round(median(hs), 2):g} p90_h={round(p90(hs), 2):g}')


def default_roots():
    return sorted(p for p in glob.glob(os.path.join(os.path.expanduser('~'), '.claude*', 'projects')) if os.path.isdir(p))


def inside(path, root):
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def cmd_transcripts(a):
    roots = [os.path.realpath(r) for r in (a.root or default_roots())]
    if not roots:
        fail('no transcript root: pass --root DIR')
    for r in roots:
        if not os.path.isdir(r):
            fail(f'no transcript root at {r}')
    out = None
    if a.out:
        out = os.path.realpath(a.out)
        for r in roots:
            if inside(out, r):
                fail(f'--out {a.out} is inside the transcript root {r}; it must be elsewhere')
    since = parse_day(a.since, '--since') if a.since else None
    until = parse_day(a.until, '--until') if a.until else None
    files = sorted({p for r in roots for p in glob.glob(os.path.join(glob.escape(r), '**', '*.jsonl'), recursive=True)})
    loaded = []
    for p in files:
        try:
            loaded.append((os.path.splitext(os.path.basename(p))[0], read_transcript(p)))
        except OSError as e:
            fail(f'cannot read a transcript: {e.strerror}')
    coordinator = [is_coordinator(rows) for _, rows in loaded]
    deduped = dedupe(loaded)
    waits, n_coord = [], 0
    for (name, rows), is_c in zip(deduped, coordinator):
        if not is_c or not rows:
            continue
        n_coord += 1
        waits += question_waits(rows, name) + dialog_waits(rows, name)
    waits = [w for w in waits if (since is None or w['started'] >= since) and (until is None or w['started'] < until)]
    waits.sort(key=lambda w: (w['started'], w['session'], w['kind']))
    for i, w in enumerate(waits, 1):
        w['id'] = f'w{i}'
    print(f'transcripts: {len(loaded)}')
    print(f'coordinators: {n_coord}')
    for kind in ('typed-reply', 'dialog'):
        print(f'{kind}: {table_row([w for w in waits if w["kind"] == kind])}')
    print(f'all: {table_row(waits)}')
    if out is not None:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, 'waits.json'), 'w', encoding='utf8') as f:
            json.dump(waits, f, indent=1)
        with open(os.path.join(out, 'waits-over-1h.csv'), 'w', encoding='utf8', newline='') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(['id', 'kind', 'hours', 'excerpt', 'parts'])
            for x in waits:
                if x['hours'] > 1:
                    w.writerow([x['id'], x['kind'], f'{x["hours"]:g}', x['excerpt'], ''])


DAY_MS = 86_400_000
HOUR_MS = 3_600_000
OPERATOR_PRINCIPAL = 'operator'          # `ASK_OPERATOR_PRINCIPAL` in shared/api.ts
BLOCKED_TITLE = '\u26a0 coordinator blocked'   # `stallCoordBlockedPushText`'s title, rung 1; rung 2 appends " (escalated)"
RUN_TERMINAL = ('done', 'failed', 'unknown')   # the states `RUN_TRANSITIONS` leaves no edge out of


def open_ro(db_path):
    if not os.path.isfile(db_path):
        fail(f'no database at {db_path}')
    try:
        con = sqlite3.connect('file:' + urllib.parse.quote(os.path.abspath(db_path)) + '?mode=ro', uri=True)
        con.execute('PRAGMA query_only = ON')
        con.execute('SELECT 1 FROM sqlite_master LIMIT 1')
    except sqlite3.Error as e:
        fail(f'cannot read the database: {e}')
    return con


def day_floor(ms):
    return ms // DAY_MS


def programme_days(spans, lo, hi):
    """The UTC days any [open, end) span touches inside [lo, hi): a set of day numbers."""
    days = set()
    for o, e in spans:
        o2, e2 = max(o, lo), min(e, hi)
        if e2 < o2 or (e2 == o2 and not lo <= o < hi):
            continue
        for d in range(day_floor(o2), day_floor(max(e2 - 1, o2)) + 1):
            days.add(d)
    return days


def week_monday(ms):
    d = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).date()
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def figure(v):
    return str(round(v, 2))


# An ask that reached the operator (M3). A coordinator-parent row counts when it left the coordinator (released by the
# lapse, declined by the hand-over, or minted released) at `releasedAt`; a stale row was decided by nobody. An
# operator-parent row is minted held and was the operator's from the start, so it counts by `at`, stale ones left out.
REACHED_OPERATOR = (
    '((a.parentId <> ? AND a.releasedAt >= ? AND a.releasedAt < ? AND a.state IN (\'released\', \'declined\', \'answering\', \'answered\')) '
    'OR (a.parentId = ? AND a.at >= ? AND a.at < ? AND a.state <> \'stale\'))')


def cmd_items(a):
    con = open_ro(a.db)
    lo = int(parse_day(a.since, '--since') * 1000) if a.since else 0
    hi = int(parse_day(a.until, '--until') * 1000) if a.until else int((time.time() // 86400 + 1) * DAY_MS)
    try:
        slugs = [r[0] for r in con.execute("SELECT slug FROM programs WHERE slug <> 'linear-sync' ORDER BY slug")]
        runs = con.execute('SELECT id, program, openedAt, closedAt FROM runs').fetchall()
        terminal = dict(con.execute(
            'SELECT runId, MAX(at) FROM run_events WHERE toState IN (%s) GROUP BY runId' % ','.join('?' * len(RUN_TERMINAL)),
            RUN_TERMINAL).fetchall())
        items = dict(con.execute(
            'SELECT program, COUNT(*) FROM operator_items WHERE raisedAt >= ? AND raisedAt < ? GROUP BY program', (lo, hi)).fetchall())
        asks = con.execute(
            'SELECT r.program, COUNT(*) FROM asks a JOIN runs r ON r.id = a.runId WHERE ' + REACHED_OPERATOR + ' GROUP BY r.program',
            (OPERATOR_PRINCIPAL, lo, hi, OPERATOR_PRINCIPAL, lo, hi)).fetchall()
        unattributed = con.execute(
            'SELECT COUNT(*) FROM asks a LEFT JOIN runs r ON r.id = a.runId WHERE (' + REACHED_OPERATOR + ') AND r.id IS NULL',
            (OPERATOR_PRINCIPAL, lo, hi, OPERATOR_PRINCIPAL, lo, hi)).fetchone()[0]
        shadow = con.execute(
            'SELECT COUNT(*) FROM run_events WHERE detail LIKE ? AND at >= ? AND at < ?',
            ('stall-shadow:coord-blocked:%', lo, hi)).fetchone()[0]
        blocked = con.execute(
            'SELECT sessionId, at FROM feed_events WHERE kind = ? AND (title LIKE ? OR title LIKE ?) AND at >= ? AND at < ?',
            ('run', BLOCKED_TITLE + ' \u203a%', BLOCKED_TITLE + ' (escalated)%', lo, hi)).fetchall()
    except sqlite3.Error as e:
        fail(f'cannot read the database: {e}')
    finally:
        con.close()
    ask_n = dict(asks)
    spans = {}
    for rid, prog, opened, closed in runs:
        end = terminal.get(rid, closed if closed is not None else hi)
        spans.setdefault(prog, []).append((opened, end))
    rows_out, tot_i, tot_a, tot_d = [], 0, 0, 0
    for slug in slugs:
        d = len(programme_days(spans.get(slug, []), lo, hi))
        i, k = items.get(slug, 0), ask_n.get(slug, 0)
        rows_out.append({'slug': slug, 'items': i, 'asks': k, 'days': d, 'value': (i + k) / d if d else 0.0})
        tot_i, tot_a, tot_d = tot_i + i, tot_a + k, tot_d + d
    print(f'programmes: {len(slugs)}')
    print(f'unattributed-asks: {unattributed}')
    for n, r in enumerate(rows_out, 1):
        print(f'm3-p{n}: items={r["items"]} asks={r["asks"]} days={r["days"]} value={figure(r["value"])}')
    all_v = (tot_i + tot_a) / tot_d if tot_d else 0.0
    print(f'm3-all: items={tot_i} asks={tot_a} days={tot_d} value={figure(all_v)}')
    print(f'm6-shadow-rows: {shadow}')
    hours = {}
    for sid, at in blocked:
        hours.setdefault(week_monday(at), set()).add((sid, at // HOUR_MS))
    weeks = {w: len(h) for w, h in sorted(hours.items())}
    for w, n in weeks.items():
        print(f'm6-{w}: {n}')
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, 'items.json'), 'w', encoding='utf8') as f:
            json.dump({'programmes': rows_out, 'all': {'items': tot_i, 'asks': tot_a, 'days': tot_d, 'value': all_v},
                       'unattributedAsks': unattributed, 'm6': weeks, 'm6ShadowRows': shadow}, f, indent=1)


PART_CLASSES = ('routine', 'big') + tuple(f'o{n}' for n in range(1, 7)) + tuple(f'p{n}' for n in range(1, 5))
SAMPLE_COLUMNS = ('id', 'kind', 'title', 'why', 'parts')


def cmd_sample(a):
    if a.n < 1:
        fail('--n must be at least 1')
    con = open_ro(a.db)
    lo = int(parse_day(a.since, '--since') * 1000) if a.since else 0
    hi = int(parse_day(a.until, '--until') * 1000) if a.until else int((time.time() // 86400 + 1) * DAY_MS)
    try:
        pool = con.execute(
            'SELECT id, kind, title, why FROM operator_items WHERE raisedAt >= ? AND raisedAt < ? ORDER BY id', (lo, hi)).fetchall()
    except sqlite3.Error as e:
        fail(f'cannot read the database: {e}')
    finally:
        con.close()
    drawn = sorted(random.Random(a.seed).sample(pool, min(a.n, len(pool))))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'sample.csv'), 'w', encoding='utf8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(SAMPLE_COLUMNS)
        for r in drawn:
            w.writerow([r[0], r[1], r[2], r[3], ''])
    print(f'pool: {len(pool)}')
    print(f'sampled: {len(drawn)}')


def cmd_score(a):
    if not os.path.isfile(a.file):
        fail(f'no file at {a.file}')
    with open(a.file, encoding='utf8', newline='') as f:
        rd = csv.DictReader(f)
        if not rd.fieldnames or 'id' not in rd.fieldnames or 'parts' not in rd.fieldnames:
            fail('the file needs the columns id and parts')
        counts = dict.fromkeys(PART_CLASSES, 0)
        for n, row in enumerate(rd, 1):
            rid = (row.get('id') or '').strip() or f'line {n + 1}'
            raw = (row.get('parts') or '').strip()
            if not raw:
                fail(f'row {rid}: parts is empty')
            for part in raw.split(';'):
                cls = part.strip()
                if cls not in counts:
                    fail(f'row {rid}: unknown class {cls!r}')
                counts[cls] += 1
    total = sum(counts.values())
    easy = counts['routine'] + counts['big']
    print(f'parts: {total}')
    for c in PART_CLASSES:
        if counts[c]:
            print(f'class-{c}: {counts[c]}')
    print(f'routine-or-big: {easy}')
    print(f'm4: {round(100 * easy / total, 1) if total else 0.0}')


def main(argv):
    ap = argparse.ArgumentParser(prog='measure-autonomy.py', description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('transcripts', help='the wait census over session transcripts (the fleet box)')
    t.add_argument('--since')
    t.add_argument('--until')
    t.add_argument('--root', action='append')
    t.add_argument('--out')
    t.set_defaults(fn=cmd_transcripts)
    i = sub.add_parser('items', help='M3 and M6 over the coordination database (the server box)')
    i.add_argument('--db', required=True)
    i.add_argument('--since')
    i.add_argument('--until')
    i.add_argument('--out')
    i.set_defaults(fn=cmd_items)
    m = sub.add_parser('sample', help='draw operator items for the M4 review (the server box)')
    m.add_argument('--db', required=True)
    m.add_argument('--n', type=int, default=30)
    m.add_argument('--seed', type=int, default=1)
    m.add_argument('--since')
    m.add_argument('--until')
    m.add_argument('--out', required=True)
    m.set_defaults(fn=cmd_sample)
    sc = sub.add_parser('score', help='the M4 share from a reviewer-filled sample.csv')
    sc.add_argument('file')
    sc.set_defaults(fn=cmd_score)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == '__main__':
    main(sys.argv[1:])
