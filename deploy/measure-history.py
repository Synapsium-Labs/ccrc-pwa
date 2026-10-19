#!/usr/bin/env python3
"""measure-history.py: the ccrc history census (spec 2026-10-05 §10.2, §10.7), READ-ONLY.

Run by hand on a session-hosting node. It reads one thing, that node's history store, and writes nothing:
the database is opened `mode=ro`, and a missing store is refused rather than created. One side effect is
SQLite's, not this script's: opening a WAL database that no process holds open may create its `-shm` and
`-wal` files, owned by whoever runs this, so run it as the store's own user, never under `sudo`.

    python3 deploy/measure-history.py [--db PATH] [--now MS]
                                      [--families FILE --window-start MS --window-end MS --row-cap N]

It prints ONE JSON object, headed by the store's own id. Outputs of several nodes are concatenated, never
merged: two nodes' families with one ccrc id are two families (spec §6.9).

  store_id, user_version  the store measured: meta.store_id and PRAGMA user_version
  script_sha256           the sha256 of this file's own bytes (read through realpath), so a record that pins
                          the instrument's hash can tell which build measured (W2-D13, W2-D24)
  counters                every `counters` row, name -> n, exactly as the sweep folded it. A name carrying
                          `:<backend>` was folded by the sweep through lib.mjs's backendOf; this script reads
                          the word and never derives one, so the backend rule is spelled once (pin O32: no
                          model-name test lives in this file). W1-i's and W1-j's counters are rows here.
  w1b_lag_p95_ms          W1-b: the p95 of ticks.lag_ms over the 7 days up to --now, counting only ticks with
                          files_behind = 0 and a measured lag (outside backfill and catch-up); null if none.
                          Both filters lean on rules the sweep keeps when it writes a ticks row: lag_ms is NULL
                          for a tick whose new rows all came from first reads or rescans (discovery, not
                          capture lag), and files_behind counts no gone or pathless row and no stale torn tail
  w1c_duplicate_entries   W1-c: uuids holding more than one entries row; 0 by the UNIQUE, reported anyway
                          because the acceptance row is this number
  w1e                     W1-e: the card line's delivery, from the counters the sweep folds (it measures
                          delivery from each compaction's transcript, never from a receipt):
                          consumed_main, consumed_other and consumed_unknown are card_consumed:<scope>
                          (a prediction a later main boundary consumed, by the scope marker its
                          compaction left); served and mismatch are card_served:* and card_id_mismatch:*
                          summed over their backend words; served_share = served / (consumed_main +
                          consumed_unknown) (target >= 0.95), other reported beside it and out of the
                          denominator, and mismatch_share = mismatch / (served + mismatch) (target
                          <= 0.02), each null, never 0, when its denominator is 0. A reading whose
                          window holds a restore or rebuild is void; a served_share above 1 is its tell
  w1f_grep_p95_ms         W1-f: the p95 of recall_calls.ms over verb = 'grep' rows with arm IS NULL; null if none
  w2                      null without --families; else {row_cap, window_start_ms, window_end_ms, families},
                          the W2 raw rows, below; the two window fields echo --window-start and --window-end
p95 is NEAREST-RANK: the value at 1-based rank ceil(95n/100) of the sorted sample, in integer arithmetic.

THE W2 RAW ROWS (§10.2; W2-D13, D-5770). This file emits rows and decides nothing about a window: the turn
rule, the window's length and end, the copy a window reads, the producer and every statistic are built in
Node by deploy/history-gate.mjs from what is printed here (W2-D14, W2-D15, W2-D16). --families names a JSON
array of {store_id, ccrc_id, generation}: the pre-registered list. A row naming another store is skipped (it
is another node's). --row-cap is required with --families and has no default. w2 echoes the window it was run
over, so the gate can refuse reports measured over different windows (W2-D22). For each listed family:
  ccrc_id, generation  as listed
  found                false when the store holds no sessions row for it; its lists are then empty
  merged_generations   the generations of the '' rows a re-key merged into it (sessions.merged_into, §6.1)
  calls                [ts_ms, rc, verb] for every recall_calls row of its own and its merged generations with
                       arm IS NULL and ts_ms >= --window-start, ordered by ts_ms then event_key. Every
                       recall_calls row is a read verb's: the sweep writes one only for an ev:"recall" spool
                       line, and only a read verb writes one (spec §8.1). arm IS NULL keeps a replay arm's
                       calls out of every live output, here and in W1-f (W2-D13)
  boundaries           its main boundaries: compact-boundary entries of a transcript whose agent_id is '', in
                       one of its confirmed epochs, with ts_ms inside [--window-start, --window-end), ordered
                       by ts_ms then entry_id, each {boundary_uuid, ts_ms, copies}
A copy is one ingest file of the boundary's transcript that holds the boundary row, found by primary-key
probes (the transcript's ingest_files, then memberships by (file_id, entry_id)), listed by file_id:
  file_id, source_key  the ingest file ('' is a live copy)
  boundary_line        the boundary row's line in it
  after_count          the membership rows after that line, uncapped
  summary_line         the first is_compact_summary row after the boundary, or null
  next_boundary_line   the next boundary row after the boundary in this file, and its ts_ms; null when none
  next_boundary_ts_ms
  last_ts_ms           the ts_ms of the file's last timed row, or null when it has none
  rows                 [line, ts_ms, msg_id, request_id, uuid, model] for each assistant entry after the
                       summary row (after the boundary when there is none) and before the next boundary, in
                       line order, at most --row-cap of them
  truncated            true when the cap cut rows
  models               the distinct values of entries.model over EVERY assistant entry after the summary row
                       (or the boundary) to the end of the file, uncapped and not stopped at the next
                       boundary, ordered by first appearance: the witnesses lib.mjs's producerOfCopy reads
The model text is printed raw: this file never tests, compares or classifies it (O32 narrowed, D-5772).

Exit 0 measured; 2 an input missing or unreadable, or a usage error.
"""
import argparse, hashlib, json, os, sqlite3, sys, time, urllib.parse

WEEK_MS = 7 * 86_400_000


def fail(msg):
    print(f'measure-history: {msg}', file=sys.stderr)
    sys.exit(2)


def p95(values):
    """Nearest-rank p95 of a sample, or None for an empty one. Integer arithmetic: 0.95 * n is a float, and a
    float that is not quite the integer it looks like moves the rank by one."""
    if not values:
        return None
    s = sorted(values)
    return s[(95 * len(s) + 99) // 100 - 1]


def open_db(path):
    if not os.path.isfile(path):
        fail(f'no history store at {path}')
    try:
        # The path is percent-encoded: SQLite reads a bare `#` as the start of the URI's fragment and a `?` as its query,
        # which silently drops `mode=ro` and opens (creating it, read-write) a file the isfile check above never saw.
        return sqlite3.connect('file:' + urllib.parse.quote(os.path.abspath(path)) + '?mode=ro', uri=True)
    except sqlite3.Error as e:
        fail(f'cannot open {path} read-only: {e}')


def load_families(path, store_id):
    try:
        with open(path, encoding='utf8') as f:
            rows = json.load(f)
    except (OSError, ValueError) as e:
        fail(f'cannot read the families list {path}: {e}')
    if not isinstance(rows, list):
        fail(f'{path} is not a JSON array of families')
    out = []
    for r in rows:
        if not isinstance(r, dict) or not all(isinstance(r.get(k), str) for k in ('store_id', 'ccrc_id', 'generation')):
            fail(f'{path}: each family is {{"store_id", "ccrc_id", "generation"}}, all strings')
        if r['store_id'] == store_id:
            out.append((r['ccrc_id'], r['generation']))
    return out


def marks(n):
    return ','.join('?' * n)


def family_scope(db, ccrc_id, generation):
    """The family's session rows, and the generations its recall lines carry: its own row, plus a '' row a
    re-key merged into it."""
    row = db.execute('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?',
                     (ccrc_id, generation)).fetchone()
    if row is None:
        return [], []
    pks, gens = [row[0]], [generation]
    for pk, gen in db.execute('SELECT session_pk, generation FROM sessions WHERE ccrc_id = ? AND merged_into = ? '
                              'ORDER BY session_pk', (ccrc_id, row[0])).fetchall():
        pks.append(pk)
        gens.append(gen)
    return pks, gens


def script_sha256():
    """The sha256 of this file's own bytes, read through realpath (W2-D13): the hash the open record's gate_code
    pins for deploy/measure-history.py (W2-D24)."""
    with open(os.path.realpath(__file__), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def copy_record(db, file_id, source_key, boundary_entry_id, row_cap):
    """One copy of a boundary: the raw rows Node's window and producer read (W2-D13). Every query is keyed on
    this file's memberships by line (memberships_order) or by its primary key; none reads a body."""
    line = db.execute('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?',
                      (file_id, boundary_entry_id)).fetchone()[0]
    after_count = db.execute('SELECT count(*) FROM memberships WHERE file_id = ? AND line > ?',
                             (file_id, line)).fetchone()[0]
    summary = db.execute(
        'SELECT m.line FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        'WHERE m.file_id = ? AND m.line > ? AND e.is_compact_summary = 1 ORDER BY m.line LIMIT 1',
        (file_id, line)).fetchone()
    summary_line = summary[0] if summary is not None else None
    nxt = db.execute(
        'SELECT m.line, e.ts_ms FROM memberships m JOIN boundaries b ON b.entry_id = m.entry_id '
        'JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT 1',
        (file_id, line)).fetchone()
    next_line, next_ts = (nxt[0], nxt[1]) if nxt is not None else (None, None)
    last = db.execute(
        'SELECT e.ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        'WHERE m.file_id = ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1',
        (file_id,)).fetchone()
    opens = summary_line if summary_line is not None else line
    rows = [list(r) for r in db.execute(
        'SELECT m.line, e.ts_ms, e.msg_id, e.request_id, e.uuid, e.model '
        'FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        "WHERE m.file_id = ? AND m.line > ? AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' "
        'ORDER BY m.line LIMIT ?',
        (file_id, opens, next_line, next_line, row_cap + 1)).fetchall()]
    witnesses = [r[0] for r in db.execute(
        'SELECT e.model FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        "WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' "
        'GROUP BY e.model ORDER BY min(m.line)',
        (file_id, opens)).fetchall()]
    return {'file_id': file_id, 'source_key': source_key, 'boundary_line': line, 'after_count': after_count,
            'summary_line': summary_line, 'next_boundary_line': next_line, 'next_boundary_ts_ms': next_ts,
            'last_ts_ms': last[0] if last is not None else None,
            'rows': rows[:row_cap], 'models': witnesses, 'truncated': len(rows) > row_cap}


def boundary_copies(db, entry_id, transcript_pk, row_cap):
    """Every copy holding one boundary, by file_id: the transcript's ingest files, each probed by the memberships
    primary key (file_id, entry_id). Never a scan of memberships by entry_id (W2-D13)."""
    out = []
    for file_id, source_key in db.execute(
            'SELECT file_id, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id',
            (transcript_pk,)).fetchall():
        held = db.execute('SELECT 1 FROM memberships WHERE file_id = ? AND entry_id = ?',
                          (file_id, entry_id)).fetchone()
        if held is not None:
            out.append(copy_record(db, file_id, source_key, entry_id, row_cap))
    return out


def family_report(db, ccrc_id, generation, start_ms, end_ms, row_cap):
    """One listed family's raw rows (W2-D13). A family the store does not hold is found: false with empty
    lists, never an empty list in its place."""
    pks, gens = family_scope(db, ccrc_id, generation)
    if not pks:
        return {'ccrc_id': ccrc_id, 'generation': generation, 'found': False, 'merged_generations': [],
                'calls': [], 'boundaries': []}
    calls = [list(r) for r in db.execute(
        f'SELECT ts_ms, rc, verb FROM recall_calls WHERE ccrc_id = ? AND generation IN ({marks(len(gens))}) '
        'AND arm IS NULL AND ts_ms >= ? ORDER BY ts_ms, event_key',
        (ccrc_id, *gens, start_ms)).fetchall()]
    bounds = db.execute(
        'SELECT DISTINCT b.entry_id, b.transcript_pk, e.uuid, e.ts_ms FROM boundaries b '
        'JOIN entries e ON e.entry_id = b.entry_id '
        "JOIN transcripts t ON t.transcript_pk = b.transcript_pk AND t.agent_id = '' "
        'JOIN epochs p ON p.cc_session_uuid = t.cc_session_uuid AND p.confirmed_ms IS NOT NULL '
        f'WHERE p.session_pk IN ({marks(len(pks))}) AND e.ts_ms >= ? AND e.ts_ms < ? '
        'ORDER BY e.ts_ms, b.entry_id',
        (*pks, start_ms, end_ms)).fetchall()
    return {'ccrc_id': ccrc_id, 'generation': generation, 'found': True, 'merged_generations': gens[1:],
            'calls': calls,
            'boundaries': [{'boundary_uuid': uuid, 'ts_ms': ts, 'copies': boundary_copies(db, entry_id, tpk, row_cap)}
                           for entry_id, tpk, uuid, ts in bounds]}


def w1e_statistic(counters):
    """W1-e (spec 2026-10-05 §10.7, §8.6; ruling RC3): the card line's delivery, from the counters alone. The
    sweep counts each prediction file a later main boundary consumed as card_consumed:<scope>, by the scope marker
    the hook wrote at that compaction's PreCompact: main (a line was due), other (subagent or ambiguous: no line
    was ever due) or unknown (the marker overwritten, emptied or unreadable). It counts card_served:<backend> or
    card_id_mismatch:<backend> once per leaf whose post-boundary SessionStart attachment named a node: its own
    leaf, or another. The backend word after the colon is summed over and never read, so no model name is classified
    here (O32).

    served_share = served / (main + unknown): other is out of the denominator and reported beside it, and unknown
    stays in it, so an unreadable marker can only lower the share. The mismatch share is of the lines that
    arrived, so a compaction whose attachment carried no line lowers the served share and leaves the mismatch
    share alone. A reading whose window holds a restore or rebuild (a completed `recover` step) is void:
    re-derived leaves are measured again, so a served share above 1 is the tell."""
    def total(word):
        return sum(n for name, n in counters.items() if name.partition(':')[0] == word)

    def consumed(scope):
        return sum(n for name, n in counters.items() if name == 'card_consumed:' + scope)

    main, other, unknown = consumed('main'), consumed('other'), consumed('unknown')
    served, mismatch = total('card_served'), total('card_id_mismatch')
    return {'consumed_main': main, 'consumed_other': other, 'consumed_unknown': unknown,
            'served': served, 'mismatch': mismatch,
            'served_share': served / (main + unknown) if main + unknown else None,
            'mismatch_share': mismatch / (served + mismatch) if served + mismatch else None}


def main():
    home = os.path.expanduser('~')
    ap = argparse.ArgumentParser(description='the ccrc history census, read-only')
    ap.add_argument('--db', default=os.path.join(home, '.ccrc', 'history', 'db', 'history.db'))
    ap.add_argument('--now', type=int, default=None, help='epoch ms; default: the clock')
    ap.add_argument('--families', default=None)
    ap.add_argument('--window-start', type=int, default=None)
    ap.add_argument('--window-end', type=int, default=None)
    ap.add_argument('--row-cap', type=int, default=None, help='the most assistant rows printed per copy; required with --families')
    a = ap.parse_args()
    if a.families is not None and (a.window_start is None or a.window_end is None):
        fail('--families needs --window-start and --window-end (epoch ms)')
    if a.families is not None and a.row_cap is None:
        fail('--families needs --row-cap')
    if a.row_cap is not None and a.row_cap < 1:
        fail('--row-cap must be a positive integer')
    now = a.now if a.now is not None else int(time.time() * 1000)

    db = open_db(a.db)
    try:
        row = db.execute("SELECT v FROM meta WHERE k = 'store_id'").fetchone()
        store_id = row[0] if row is not None else None
        report = {
            'store_id': store_id,
            'user_version': db.execute('PRAGMA user_version').fetchone()[0],
            'script_sha256': script_sha256(),
            'counters': {name: n for name, n in db.execute('SELECT name, n FROM counters ORDER BY name').fetchall()},
            'w1b_lag_p95_ms': p95([r[0] for r in db.execute(
                'SELECT lag_ms FROM ticks WHERE files_behind = 0 AND lag_ms IS NOT NULL AND ts_ms > ? AND ts_ms <= ?',
                (now - WEEK_MS, now)).fetchall()]),
            'w1c_duplicate_entries': db.execute(
                'SELECT count(*) FROM (SELECT uuid FROM entries GROUP BY uuid HAVING count(*) > 1)').fetchone()[0],
            'w1e': None,   # W1-e: filled from 'counters' below the literal, in this place in the key order
            'w1f_grep_p95_ms': p95([r[0] for r in db.execute(
                "SELECT ms FROM recall_calls WHERE verb = 'grep' AND arm IS NULL").fetchall()]),
            'w2': None,
        }
        report['w1e'] = w1e_statistic(report['counters'])
        if a.families is not None:
            report['w2'] = {'row_cap': a.row_cap, 'window_start_ms': a.window_start, 'window_end_ms': a.window_end, 'families': [
                family_report(db, ccrc_id, generation, a.window_start, a.window_end, a.row_cap)
                for ccrc_id, generation in load_families(a.families, store_id)]}
    except sqlite3.Error as e:
        fail(f'cannot read {a.db}: {e}')
    finally:
        db.close()
    print(json.dumps(report))


if __name__ == '__main__':
    main()
