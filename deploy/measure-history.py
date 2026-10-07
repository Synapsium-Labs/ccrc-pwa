#!/usr/bin/env python3
"""measure-history.py: the ccrc history census (spec 2026-10-05 §10.2, §10.7), READ-ONLY.

Run by hand on a session-hosting node. It reads one thing, that node's history store, and writes nothing:
the database is opened `mode=ro`, and a missing store is refused rather than created. One side effect is
SQLite's, not this script's: opening a WAL database that no process holds open may create its `-shm` and
`-wal` files, owned by whoever runs this, so run it as the store's own user, never under `sudo`.

    python3 deploy/measure-history.py [--db PATH] [--now MS]
                                      [--families FILE --window-start MS --window-end MS]

It prints ONE JSON object, headed by the store's own id. Outputs of several nodes are concatenated, never
merged: two nodes' families with one ccrc id are two families (spec §6.9).

  store_id, user_version  the store measured: meta.store_id and PRAGMA user_version
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
  w1f_grep_p95_ms         W1-f: the p95 of recall_calls.ms over verb = 'grep' rows with arm IS NULL; null if none
  w2                      null without --families; else the W2 window statistic, below
p95 is NEAREST-RANK: the value at 1-based rank ceil(95n/100) of the sorted sample, in integer arithmetic.

THE W2 WINDOW STATISTIC (§10.2). --families names a JSON array of {store_id, ccrc_id, generation}: the
pre-registered list. A row naming another store is skipped (it is another node's). For each listed family:
  * its sessions are its own row plus a '' family a re-key merged into it (sessions.merged_into, §6.1);
  * its main boundaries are compact-boundary entries of a transcript whose agent_id is '', in one of its
    confirmed epochs, with ts_ms inside [--window-start, --window-end);
  * the copy holding a boundary is the ingest file holding it with the most rows after it (ties: the lowest
    file_id), so a swap's continued copy is read rather than the one left behind;
  * its summary row is the first is_compact_summary entry after the boundary in that copy (none: the window
    opens at the boundary itself);
  * the window is the first 10 assistant entries after that row, and ends at the 10th one's ts_ms, or at the
    copy's last timed row when there are fewer;
  * a window COUNTS when a recall_calls row of the family, with arm IS NULL, has a ts_ms from the boundary's
    ts_ms to that end, both inclusive. Every recall_calls row is a read verb's: the sweep writes one only for
    an ev:"recall" spool line, and only a read verb writes one (spec §8.1).
It reports the windows, those with a call, the calls and assistant entries summed over windows, the per-turn
rate (calls / assistant entries), the windows it could not time (`unmeasured`), and each family's windows.
The bootstrap that turns this into the gate is the W2 driver's, not this file's.

Exit 0 measured; 2 an input missing or unreadable.
"""
import argparse, json, os, sqlite3, sys, time

WEEK_MS = 7 * 86_400_000
K = 10   # the window: the first K assistant entries after a main boundary's summary row (ruled Q14)


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
        return sqlite3.connect(f'file:{path}?mode=ro', uri=True)
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
    for pk, gen in db.execute('SELECT session_pk, generation FROM sessions WHERE ccrc_id = ? AND merged_into = ?',
                              (ccrc_id, row[0])).fetchall():
        pks.append(pk)
        gens.append(gen)
    return pks, gens


def family_windows(db, ccrc_id, generation, start_ms, end_ms):
    pks, gens = family_scope(db, ccrc_id, generation)
    if not pks:
        return []
    bounds = db.execute(
        'SELECT DISTINCT b.entry_id, e.uuid, e.ts_ms FROM boundaries b '
        'JOIN entries e ON e.entry_id = b.entry_id '
        "JOIN transcripts t ON t.transcript_pk = b.transcript_pk AND t.agent_id = '' "
        'JOIN epochs p ON p.cc_session_uuid = t.cc_session_uuid AND p.confirmed_ms IS NOT NULL '
        f'WHERE p.session_pk IN ({marks(len(pks))}) AND e.ts_ms >= ? AND e.ts_ms < ? '
        'ORDER BY e.ts_ms, b.entry_id',
        (*pks, start_ms, end_ms)).fetchall()
    out = []
    for entry_id, uuid, ts in bounds:
        copy = db.execute(
            'SELECT m.file_id, m.line, '
            '(SELECT count(*) FROM memberships n WHERE n.file_id = m.file_id AND n.line > m.line) AS after '
            'FROM memberships m WHERE m.entry_id = ? ORDER BY after DESC, m.file_id LIMIT 1',
            (entry_id,)).fetchone()
        if copy is None:
            out.append({'boundary_uuid': uuid, 'boundary_ts_ms': ts, 'end_ts_ms': None,
                        'assistant_entries': 0, 'calls': None})
            continue
        file_id, line = copy[0], copy[1]
        summary = db.execute(
            'SELECT m.line FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
            'WHERE m.file_id = ? AND m.line > ? AND e.is_compact_summary = 1 ORDER BY m.line LIMIT 1',
            (file_id, line)).fetchone()
        opens = summary[0] if summary is not None else line
        turns = db.execute(
            'SELECT e.ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
            "WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' ORDER BY m.line LIMIT ?",
            (file_id, opens, K)).fetchall()
        if len(turns) == K:
            end = turns[-1][0]
        else:
            last = db.execute(
                'SELECT e.ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
                'WHERE m.file_id = ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1',
                (file_id,)).fetchone()
            end = last[0] if last is not None else None
        calls = None
        if end is not None:
            calls = db.execute(
                f'SELECT count(*) FROM recall_calls WHERE ccrc_id = ? AND generation IN ({marks(len(gens))}) '
                'AND arm IS NULL AND ts_ms >= ? AND ts_ms <= ?',
                (ccrc_id, *gens, ts, end)).fetchone()[0]
        out.append({'boundary_uuid': uuid, 'boundary_ts_ms': ts, 'end_ts_ms': end,
                    'assistant_entries': len(turns), 'calls': calls})
    return out


def w2_statistic(db, families, start_ms, end_ms):
    by_family, windows, with_call, calls, turns, unmeasured = [], 0, 0, 0, 0, 0
    for ccrc_id, generation in families:
        ws = family_windows(db, ccrc_id, generation, start_ms, end_ms)
        by_family.append({'ccrc_id': ccrc_id, 'generation': generation, 'windows': ws})
        for w in ws:
            if w['calls'] is None:
                unmeasured += 1
                continue
            windows += 1
            with_call += 1 if w['calls'] > 0 else 0
            calls += w['calls']
            turns += w['assistant_entries']
    return {'windows': windows, 'with_call': with_call, 'calls': calls, 'assistant_entries': turns,
            'per_turn_rate': calls / turns if turns else None, 'unmeasured': unmeasured, 'by_family': by_family}


def main():
    home = os.path.expanduser('~')
    ap = argparse.ArgumentParser(description='the ccrc history census, read-only')
    ap.add_argument('--db', default=os.path.join(home, '.ccrc', 'history', 'db', 'history.db'))
    ap.add_argument('--now', type=int, default=None, help='epoch ms; default: the clock')
    ap.add_argument('--families', default=None)
    ap.add_argument('--window-start', type=int, default=None)
    ap.add_argument('--window-end', type=int, default=None)
    a = ap.parse_args()
    if a.families is not None and (a.window_start is None or a.window_end is None):
        fail('--families needs --window-start and --window-end (epoch ms)')
    now = a.now if a.now is not None else int(time.time() * 1000)

    db = open_db(a.db)
    try:
        row = db.execute("SELECT v FROM meta WHERE k = 'store_id'").fetchone()
        store_id = row[0] if row is not None else None
        report = {
            'store_id': store_id,
            'user_version': db.execute('PRAGMA user_version').fetchone()[0],
            'counters': {name: n for name, n in db.execute('SELECT name, n FROM counters ORDER BY name').fetchall()},
            'w1b_lag_p95_ms': p95([r[0] for r in db.execute(
                'SELECT lag_ms FROM ticks WHERE files_behind = 0 AND lag_ms IS NOT NULL AND ts_ms > ? AND ts_ms <= ?',
                (now - WEEK_MS, now)).fetchall()]),
            'w1c_duplicate_entries': db.execute(
                'SELECT count(*) FROM (SELECT uuid FROM entries GROUP BY uuid HAVING count(*) > 1)').fetchone()[0],
            'w1f_grep_p95_ms': p95([r[0] for r in db.execute(
                "SELECT ms FROM recall_calls WHERE verb = 'grep' AND arm IS NULL").fetchall()]),
            'w2': None,
        }
        if a.families is not None:
            report['w2'] = w2_statistic(db, load_families(a.families, store_id), a.window_start, a.window_end)
    except sqlite3.Error as e:
        fail(f'cannot read {a.db}: {e}')
    finally:
        db.close()
    print(json.dumps(report))


if __name__ == '__main__':
    main()
