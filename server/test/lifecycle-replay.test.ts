// D8's claim, executed rather than asserted in a comment: `lifecycle_events` is
// a RE-MEASUREMENT of the flat file, so losing it and sweeping again must
// reproduce it EXACTLY — modulo `id` (an autoincrement) and `ingestedAt` (the
// SERVER'S clock, explicitly labelled as such and never read as an event time).
//
// Byte equality rather than resemblance, because `raw` holds the line verbatim.
//
// SCOPE OF THE BYTE-EQUALITY CLAIM, stated honestly rather than papered over
// (FIX ROUND 1, F2/F3 — task-36-37 review; corrects an earlier draft of this
// same paragraph that named only three columns and undersold the `uid` case):
// it holds for `raw` unconditionally (a real UTF-8 file read can never decode
// into a JS string carrying a raw unpaired surrogate — invalid UTF-8 degrades
// to U+FFFD at read time, before this code ever sees it), and for
// `obs`/`dec`/`meas` even when a nested string carries a lone-surrogate JSON
// escape (`CoordStore.ingestJournal` re-`JSON.stringify`s them before storage,
// which re-escapes the surrogate to plain ASCII before it reaches a bind
// parameter). It does NOT hold for the EIGHT columns `store.ts`'s
// `ingestJournal` binds as the raw JS string itself, with no re-escaping pass
// in between: `uid`, `badact`, `badoutcome`, `verb`, `sessionId`, `tx`,
// `refusal`, `detail`. A lone unpaired UTF-16 surrogate in any of those is
// silently replaced with U+FFFD by the TEXT column, with no signal. The
// `detail` test below in this file proves and pins that boundary directly.
//
// `uid` is the one of the eight where this is NOT merely a display caveat:
// `lifecycle_uid` is `CREATE UNIQUE INDEX … ON lifecycle_events(uid) WHERE
// uid IS NOT NULL`, so two DISTINCT uids that differ only in a surrogate that
// degrades identically collapse to ONE row under `INSERT OR IGNORE` — no gap
// row, no error, no counter. Measured directly: uids `k\uD800` and `k\uD801`
// (both real, both legal JSON, both syntactically distinct) yield exactly one
// stored row, `{uid: 'k�', ...}`. This is durable data loss, not a
// cosmetic byte-equality footnote — and it is confined to a genuinely
// malformed uid: real ccd uids are ASCII `<epochNs>.<pid>.<seq>`
// (`journalparse.ts`'s own comment on `JournalRow.uid`), so a forged or
// corrupt line carrying an invalid uid can collide with another invalid uid,
// but can never erase a genuine ASCII one.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { JournalMirror } from '../src/coord/mirror.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import { LC_ACT_UNKNOWN, LC_DIR_NAME, LIFECYCLE_ACTS } from '../../shared/api.js';

const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const G1 = '1755780000000000000';
const G2 = '1755790000000000000';

/** A body with every shape the mirror has to model: a full record with all
 *  three families, a refusal with its detail, a line whose act AND outcome
 *  this build does not declare (FIX ROUND 1, F1: `outcome: 'stalled'` added
 *  to `a.3` so `badoutcome` — the column `COLS` was silently skipping — is
 *  actually non-null somewhere this drill checks), and a line without an
 *  `at` key at all (FIX ROUND 1, F4: `a.4`, so Step 2's clock-fallback
 *  mutant has a row to leak through — every other line here carries a
 *  numeric `at`, so `n(o,'at') ?? Date.now()` was previously dead code on
 *  every path this fixture exercised), and a line that is not JSON at all. */
const BODY_1 = [
  JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'intent', verb: 'ws-rm',
    id: 'demo-quiet-basin', tx: 'a',
    obs: { cg: 'pane', cgraw: '0::/user.slice/session-3.scope', pid: 31415, ppid: 2,
           pane: 'cc-demo', paneWhy: 'ppid-ancestry', tty: true, ssh: null },
    dec: { surface: 'cli', actor: 'you', reason: 'stale wave' },
    meas: { project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin', uuid: 'u',
            wrapper: 'claude', tip: 'deadbeef', attic: 3, archivedAt: null,
            archivedReason: null, held: null } }),
  JSON.stringify({ uid: 'a.2', at: 110, act: AN_ACT, outcome: 'refused',
    verb: 'ws-rm', id: 'demo-quiet-basin', tx: 'a', refusal: 'held',
    detail: 'held: program:build8 wave:2/4 — release first' }),
  JSON.stringify({ uid: 'a.3', at: 120, act: 'quarantine', outcome: 'stalled',
    verb: 'ws-rm', id: 'demo-quiet-basin', truncated: true }),
  JSON.stringify({ uid: 'a.4', act: AN_ACT, outcome: 'done', verb: 'ws-rm',
    id: 'demo-quiet-basin' }),
  'ws-rm demo-quiet-basin  # a child wrote into the log',
].join('\n') + '\n';

const BODY_2 = JSON.stringify({ uid: 'b.1', at: 200, act: AN_ACT, outcome: 'done',
  verb: 'forget', id: 'other-session' }) + '\n';

/** FIX ROUND 1, F1: EVERY column this table has, DERIVED from
 *  `PRAGMA table_info` rather than hand-listed, except `id` (an
 *  autoincrement) and `ingestedAt` (the server's clock, pinned separately
 *  below). The previous version of this file hand-listed sixteen names and
 *  silently dropped a THIRD column, `badoutcome`, alongside the two
 *  deliberately-excluded ones — exactly the "second enumeration of a value
 *  that already has one" this repo's `single-definition.test.ts` exists to
 *  catch, just not in a place that scanner reaches. A 20th column added
 *  later cannot be silently skipped here: it is either excluded by name,
 *  deliberately, or it is in `COLS`. */
const EXCLUDED_COLS = new Set(['id', 'ingestedAt']);
const colsFor = (s: CoordStore): string =>
  (s.db.prepare('PRAGMA table_info(lifecycle_events)').all() as { name: string }[])
    .map((c) => c.name)
    .filter((n) => !EXCLUDED_COLS.has(n))
    .join(', ');

const snapshot = (s: CoordStore): unknown[] =>
  s.db.prepare(`SELECT ${colsFor(s)} FROM lifecycle_events ORDER BY gen, uid, raw`).all();

const plant = (bodies: readonly (readonly [string, string])[]) => {
  const home = mkTmp('ccrc-replay-');
  const registryDir = path.join(home, '.cc-sessions');
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  for (const [gen, body] of bodies) fs.writeFileSync(path.join(dir, genFile(gen)), body);
  const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  return { home, registryDir, store };
};

const mirrorOver = (registryDir: string, store: CoordStore, now: () => number): JournalMirror =>
  new JournalMirror({
    io: localIO, registryDir, store,
    ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now, staleAfterMs: 15_000,
  });

describe('the re-measurement drill (D8)', () => {
  it('reproduces every row byte for byte after the mirror is destroyed and replayed', async () => {
    const w = plant([[G1, BODY_1], [G2, BODY_2]]);
    let now = 1_000_000;
    await mirrorOver(w.registryDir, w.store, () => now).sweep();

    const before = snapshot(w.store);
    // FIX ROUND 1, F4: 5 -> 6 rows (BODY_1 gained `a.4`).
    expect(before, 'the drill would pass vacuously over an empty table').toHaveLength(6);

    // LOSE THE MIRROR. Both tables: the events AND the cursors, which is what
    // "a lost coord.db reconstructs from the flat files" actually means.
    w.store.db.exec('DELETE FROM lifecycle_events');
    w.store.db.exec('DELETE FROM lifecycle_generations');
    expect(snapshot(w.store)).toEqual([]);

    now += 60_000;                       // a DIFFERENT server clock on replay
    await mirrorOver(w.registryDir, w.store, () => now).sweep();

    expect(snapshot(w.store)).toEqual(before);
    // …and `ingestedAt` is the one value that legitimately moved, which is
    // why it is excluded above rather than quietly ignored.
    expect(w.store.db.prepare('SELECT DISTINCT ingestedAt FROM lifecycle_events').all())
      .toEqual([{ ingestedAt: 1_060_000 }]);
  });

  it('a second sweep with the cursor rewound changes nothing — the cursor is an optimisation', async () => {
    const w = plant([[G1, BODY_1]]);
    let now = 1_000_000;
    const mirror = mirrorOver(w.registryDir, w.store, () => now);
    await mirror.sweep();
    const before = snapshot(w.store);
    // FIX ROUND 1, F4: 4 -> 5 rows (BODY_1 gained `a.4`).
    expect(before).toHaveLength(5);

    // Wind the cursor back to 0 by hand: re-reading a generation from offset 0
    // must be no-op-or-catch-up, never a duplicate (D6). `size` is wound back
    // with it, or `frameRead` correctly calls the unchanged file a shrink.
    w.store.db.prepare('UPDATE lifecycle_generations SET cursor = 0, size = 0').run();
    now += 5000;
    await mirror.sweep();
    expect(snapshot(w.store)).toEqual(before);
  });

  it('a lone unpaired surrogate in `detail` is NOT preserved byte-for-byte — a real, scoped hole in the byte-equality claim', async () => {
    // `\uD800` here is a genuine lone (unpaired) UTF-16 surrogate code unit
    // living in this JS string literal. `JSON.stringify`'s well-formed-string
    // behaviour re-escapes it to the six-character ASCII text `\ud800` in the
    // JSON it produces — verified directly: `JSON.stringify({d:'\uD800'})`
    // -> `'{"d":"\\ud800"}'`. So the JOURNAL FILE on disk never contains a raw
    // invalid UTF-16 code unit, only that ASCII escape, and `JSON.parse` on
    // the way back in reconstructs the identical lone surrogate as a real
    // character in `detail`.
    //
    // `detail` is bound to `node:sqlite` AS THE JS STRING, unlike
    // `obs`/`dec`/`meas`, which `CoordStore.ingestJournal` re-`JSON.stringify`s
    // before storage (`store.ts`'s `ingestJournal`) — that second pass
    // re-escapes any lone surrogate back to plain ASCII before it ever
    // reaches a bind parameter, so a surrogate nested inside those three
    // families does NOT hit this hazard the way the eight raw-bound string
    // columns (file-level docstring above) do. Verified directly (scratch
    // probe, not asserted here): an identical lone surrogate placed in
    // `obs.ssh` round-trips exactly, because by the time it is bound it is
    // the ASCII escape sequence, not a raw code unit.
    const detail = 'x\uD800y';
    const gen = '1755795000000000000';
    const body = JSON.stringify({ uid: 'c.1', at: 300, act: AN_ACT, outcome: 'refused',
      verb: 'ws-rm', id: 'demo', tx: 'c', refusal: 'held', detail }) + '\n';
    const w = plant([[gen, body]]);
    await mirrorOver(w.registryDir, w.store, () => 1_000_000).sweep();
    const row = w.store.db.prepare('SELECT detail, raw FROM lifecycle_events').get() as
      { detail: string; raw: string } | undefined;
    expect(row, 'the row exists at all').toBeDefined();
    // `raw` is unaffected — the FILE never held a real surrogate, only its
    // ASCII escape, so D8's byte-equality claim for `raw` stands even here.
    expect.soft(row!.raw, 'raw is byte-identical').toBe(body.trimEnd());
    // `detail` IS affected: this is the documented, measured boundary —
    // `node:sqlite`'s TEXT column silently replaces a lone unpaired surrogate
    // with U+FFFD on the way back out. D8's byte-equality claim does NOT
    // extend to the eight raw-bound string columns for a line carrying one;
    // it is scoped to `raw`, which cannot carry a raw surrogate by
    // construction, and to `obs`/`dec`/`meas`, which re-escape one before
    // storage.
    expect.soft(row!.detail, 'detail silently degrades — documented, not papered over').not.toBe(detail);
    expect.soft(row!.detail, 'degrades exactly to U+FFFD in place of the lone surrogate').toBe('x�y');
  });
});
