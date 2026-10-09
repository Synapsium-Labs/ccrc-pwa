#!/usr/bin/env python3
"""The workspace-lifecycle rows (spec 2026-09-24-workspace-lifecycle-design.md §9), measured READ-ONLY.

Run on the SERVER box, which holds both inputs: `~/.ccrc/coord.db` (the runs, and the lifecycle journal the server
mirrors from ccd's `$REG/.lifecycle/`) and `~/.ccrc/state-cache.json` (the server's last assembled fleet — every
registry fact the rows need, as the board saw it). It writes no row and no file of its own: the database is
opened `mode=ro`, and a missing input is refused rather than created. One side effect is SQLite's, not this
script's: opening a WAL database that no process holds open creates its `-shm` and `-wal` files, owned by whoever
runs this — so run it as the server's own user, never under `sudo`.

    python3 deploy/measure-workspace-lifecycle.py [--db PATH] [--cache PATH] [--now EPOCH_S] [--days N]

Rows (one `name: value` per line; detail lines are indented):
  rows_total                  sessions in the snapshot
  snapshot_age_s              how old the snapshot is — a stale one describes a server that stopped
  released_computed           rows this script finds released, by the six conditions of spec §5.1, computed
                              here from the runs and the snapshot, independently of the server
  released_needs_person       of those, rows that stay at the top level by design (attention, working, stranded)
  released_top_level          of those, the rest that the wire did NOT mark released — the rows still loose on a
                              card. Baseline 2026-09-24: 29 of 56. Target after wave 1: 0.
  released_wire_only          rows the wire marks released that this script does not — the server deciding
                              something the rule does not say. Target: 0.
  archived_over_7d_unheld     archived workspaces archived more than 7 days ago, no hold
  archived_over_7d_held       the same, held (listed: stage 3 routes these to attention)
  archive_returns             returns from archive in the journal: an `archive` done, then the next return act
                              done on the same session (start ensure restore swap spawn unarchive); a second
                              archive restarts the clock; a removal or a re-creation (destroy purge reap forget create
                              expire reclaim) ends it
  archive_return_max_s        the longest of them
  archive_returns_over_6d     those later than 6 days — spec §9's kill-rule band
  archive_returns_over_7d     those later than 7 days — any here holds stage 3 until the operator has seen it
  journal_horizon_days        how far back the journal reaches, so a zero above can be read for what it covers
  archive_acts_per_day        `archive` acts done, per UTC day, over --days (every actor)
  dead_coordinator_ended      programmes the dead-coordinator lane ended (spec §5.4), each with the instant its
                              coordinator was first seen dead — from the lane's own feed rows
  dead_coordinator_partly_ended  programmes an act closed only part of (it stopped, or a run could not be moved)
  dead_coordinator_would_end  the shadowed lane's records: what an armed lane would have ended, per coordinator
  dead_coordinator_breaker_trips  the circuit breaker's trips, each naming the coordinators it held
  dead_coordinator_slugs_reopened  of the ended programmes, those a run was opened for AFTER the lane ended them
Exit 0 measured; 2 an input missing or unreadable.
"""
import argparse, collections, datetime, json, os, re, sqlite3, sys, time

# `shared/api.ts`'s TERMINAL_RUN_STATES — a second spelling, bound to the first by
# measure-workspace-lifecycle.test.ts, which reds when they differ.
TERMINAL = ('done', 'failed')
# ccd's `_LC_ACTS` members that bring an archived workspace back (spec §3).
RETURN_ACTS = ('start', 'ensure', 'restore', 'swap', 'spawn', 'unarchive')
# ccd's `_LC_ACTS` members that END an archive without returning from it: a removal (`expire` and `reclaim` among
# them — the server's two teardowns), or a new workspace created under the same id (a reused slug). What follows
# either is a new workspace's life, never a return.
ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create', 'expire', 'reclaim')
# ccd's `_LC_ACTS` members that neither return from an archive nor end it. With `archive` itself, the three lists
# classify every act exactly once — measure-workspace-lifecycle.test.ts runs ccd's array and reds on an act that has
# no place here, so a new act is decided, never silently ignored.
NEUTRAL_ACTS = ('attic-drop', 'claim', 'enable', 'gc', 'hold', 'release', 'rename', 'rehome', 'route', 'stop',
                'supervise', 'unsupervise')
WEEK_S = 7 * 86400
# The dead-coordinator lane's feed titles (`server/src/deadCoordinator.ts`'s `deadCoordinatorFeedRows` and
# `deadCoordinatorBreakerFeedRow`) — a second spelling, bound to the first by measure-workspace-lifecycle.test.ts.
DC_ENDED = 'dead coordinator: programme ended'
DC_PARTLY = 'dead coordinator: programme partly ended'
DC_WOULD = 'dead coordinator: programme would be ended'
DC_BREAKER = 'dead coordinator: breaker tripped'
# Rows that stay at the top level of a card, released or not (spec §5.1).
NEEDS_PERSON = ('attention', 'working')


def fail(msg):
    print(f'measure-workspace-lifecycle: {msg}', file=sys.stderr)
    sys.exit(2)


def load_snapshot(path):
    try:
        with open(path, encoding='utf8') as f:
            snap = json.load(f)
    except (OSError, ValueError) as e:
        fail(f'cannot read the state cache {path}: {e}')
    if not isinstance(snap, dict) or not isinstance(snap.get('sessions'), list):
        fail(f'{path} is not a fleet snapshot (no sessions list)')
    return snap


def open_db(path):
    if not os.path.isfile(path):
        fail(f'no coord.db at {path}')
    try:
        return sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    except sqlite3.Error as e:
        fail(f'cannot open {path} read-only: {e}')


def close_time(text):
    """The server's rule for a close time (`persistedInt` in `lastRunBySession`, server/src/coord/store.ts): the column
    CAST to text, read as a number, is a positive safe integer — anything else (NULL, zero, a negative, a fraction, a
    word) is doubt, None. The SAME answer for every text CAST makes of an INTEGER or REAL value, and for ASCII decimal
    TEXT; `_` is refused because Python's float() reads `1_000` and JavaScript's Number() does not. Divergences are left,
    stated, each measured, among them: a hand-written TEXT value in JavaScript's own radix spellings (`0x10`, `0b1`, `0o7`) is a
    number to the server and doubt here; Arabic-Indic digits (U+0661 and its row) and fullwidth digits (U+FF11 and its
    row) are an int here (float() reads any Unicode decimal digit) and NaN, so doubt, on the server; a leading U+FEFF
    (the byte-order mark) is None here (float() does not strip it) and the number on the server (Number() does); a
    leading U+0085 (NEL) is the reverse: float() strips it, so `'\\x8512'` is 12 here, and Number() does not, so it is
    NaN, doubt, on the server (review 288, F7). No writer produces any of them (the server writes closedAt as an integer)."""
    if text is None or '_' in text:
        return None
    try:
        v = float(text)
    except ValueError:
        return None
    return int(v) if v.is_integer() and 1 <= v <= 2 ** 53 - 1 else None


def released_computed(sessions, runs):
    """The six conditions of spec §5.1, from the runs and the snapshot's registry facts."""
    newest, open_workers, open_claimants = {}, set(), set()
    for rid, sid, state, claimed, closed in runs:
        if sid is not None and (sid not in newest or rid > newest[sid][0]):
            newest[sid] = (rid, state, close_time(closed))
        if state not in TERMINAL:
            if sid is not None:
                open_workers.add(sid)
            if claimed is not None:
                open_claimants.add(claimed)
    out = set()
    for s in sessions:
        sid = s.get('id')
        if s.get('workspace') is None or s.get('held') is not None or s.get('archivedAt') is not None:
            continue
        last = newest.get(sid)
        if last is None or last[1] not in TERMINAL or last[2] is None:
            continue
        if sid in open_workers or sid in open_claimants:
            continue
        out.add(sid)
    return out


def main():
    home = os.path.expanduser('~')
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(home, '.ccrc', 'coord.db'))
    ap.add_argument('--cache', default=os.path.join(home, '.ccrc', 'state-cache.json'))
    ap.add_argument('--now', type=int, default=None)
    ap.add_argument('--days', type=int, default=14)
    a = ap.parse_args()
    now = a.now if a.now is not None else int(time.time())

    snap = load_snapshot(a.cache)
    sessions = [s for s in snap['sessions'] if isinstance(s, dict)]
    db = open_db(a.db)
    try:
        runs = db.execute('SELECT id, sessionId, state, claimedBy, CAST(closedAt AS TEXT) FROM runs').fetchall()
        journal = db.execute(
            'SELECT sessionId, act, outcome, at FROM lifecycle_events '
            "WHERE outcome = 'done' AND sessionId IS NOT NULL ORDER BY at, id").fetchall()
        untimed = db.execute(
            "SELECT count(*) FROM lifecycle_events WHERE outcome = 'done' AND at IS NULL").fetchone()[0]
        dead_feed = db.execute(
            'SELECT at, sessionId, title, body FROM feed_events WHERE title IN (?, ?, ?, ?) ORDER BY at, id',
            (DC_ENDED, DC_PARTLY, DC_WOULD, DC_BREAKER)).fetchall()
        opened = db.execute('SELECT program, CAST(openedAt AS TEXT) FROM runs').fetchall()
    except sqlite3.Error as e:
        fail(f'cannot read {a.db}: {e}')
    finally:
        db.close()

    print(f'rows_total: {len(sessions)}')
    saved = snap.get('savedAt')
    print(f"snapshot_age_s: {now - saved // 1000 if isinstance(saved, int) else 'unknown'}")

    computed = released_computed(sessions, runs)
    by_id = {s.get('id'): s for s in sessions}
    needs = {i for i in computed if by_id[i].get('bucket') in NEEDS_PERSON or by_id[i].get('stranded') is not None}
    wire = {s.get('id') for s in sessions if s.get('releasedFrom') is not None}
    top = sorted(i for i in computed - needs if i not in wire)
    print(f'released_computed: {len(computed)}')
    print(f'released_needs_person: {len(needs)}')
    print(f'released_top_level: {len(top)}')
    for i in top:
        print(f'  {i}')
    wire_only = sorted(wire - computed)
    print(f'released_wire_only: {len(wire_only)}')
    for i in wire_only:
        print(f'  {i}')

    old = [s for s in sessions if s.get('workspace') is not None and isinstance(s.get('archivedAt'), (int, float))
           and now - s['archivedAt'] > WEEK_S]
    unheld = sorted(s['id'] for s in old if s.get('held') is None)
    held = sorted(s['id'] for s in old if s.get('held') is not None)
    print(f'archived_over_7d_unheld: {len(unheld)}')
    for i in unheld:
        print(f'  {i}')
    print(f'archived_over_7d_held: {len(held)}')
    for i in held:
        print(f'  {i}')

    pending, delays = {}, []
    for sid, act, _outcome, at in journal:
        if at is None:
            continue
        if act == 'archive':
            pending[sid] = at                       # a second archive restarts the clock: the NEWEST one pairs
        elif act in ENDS_THE_ARCHIVE:
            pending.pop(sid, None)
        elif act in RETURN_ACTS and sid in pending:
            delays.append((sid, (at - pending.pop(sid)) // 1000))
    over6 = sorted((d, sid) for sid, d in delays if d > 6 * 86400)
    over7 = [(d, sid) for d, sid in over6 if d > WEEK_S]
    print(f'archive_returns: {len(delays)}')
    print(f"archive_return_max_s: {max((d for _s, d in delays), default=0)}")
    print(f'archive_returns_over_6d: {len(over6)}')
    for d, sid in over6:
        print(f'  {sid} {d}')
    print(f'archive_returns_over_7d: {len(over7)}')
    timed = [at for _s, _a, _o, at in journal if at is not None]
    print(f"journal_horizon_days: {round((now * 1000 - min(timed)) / 86400000, 1) if timed else 0}")
    if untimed:
        print(f'  ({untimed} done rows carry no time and are not counted)')

    since = (now - a.days * 86400) * 1000
    per_day = collections.Counter(
        datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
        for _s, act, _o, at in journal if act == 'archive' and at is not None and at >= since)
    print(f'archive_acts_per_day: {sum(per_day.values())} over {a.days} days')
    for day in sorted(per_day):
        print(f'  {day} {per_day[day]}')

    dead_rows(dead_feed, opened)


def iso_min(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')


def dead_rows(feed, opened):
    """Spec §9's stage-4 row: the programmes the dead-coordinator lane ended, its breaker trips, and the later reopening
    of an ended programme's slug — each ended one with its coordinator's first-dead instant, read off the lane's own feed
    rows (`dead since <instant>`)."""
    since_re = re.compile(r'\(dead since ([^)]*)\)')
    slug_re = re.compile(r'programme (\S+) (?:ended|was NOT ended)|would end programme (\S+) ')
    ended, partly, would, trips = [], [], set(), []
    for at, sid, title, body in feed:
        m, s = since_re.search(body), slug_re.search(body)
        slug = (s.group(1) or s.group(2)) if s else '?'
        dead = m.group(1) if m else 'unknown'
        if title == DC_ENDED:
            ended.append((at, slug, sid, dead))
        elif title == DC_PARTLY:
            partly.append((at, slug, sid, dead))
        elif title == DC_WOULD:
            would.add((sid, slug))
        else:
            trips.append((at, sid, body))
    print(f'dead_coordinator_ended: {len(ended)}')
    for at, slug, sid, dead in ended:
        print(f'  {iso_min(at)} {slug} coordinator {sid} dead since {dead}')
    print(f'dead_coordinator_partly_ended: {len(partly)}')
    for at, slug, sid, dead in partly:
        print(f'  {iso_min(at)} {slug} coordinator {sid} dead since {dead}')
    print(f'dead_coordinator_would_end: {len(would)}')
    for sid, slug in sorted(would):
        print(f'  {sid} {slug}')
    print(f'dead_coordinator_breaker_trips: {len(trips)}')
    for at, sid, body in trips:
        print(f'  {iso_min(at)} {body[:160]}')
    reopened = []
    for at, slug, _sid, _dead in ended:
        later = [int(o) for p, o in opened if p == slug and o is not None and o.lstrip('-').isdigit() and int(o) > at]
        if later:
            reopened.append((slug, min(later)))
    print(f'dead_coordinator_slugs_reopened: {len(reopened)}')
    for slug, o in reopened:
        print(f'  {slug} {iso_min(o)}')


if __name__ == '__main__':
    main()
