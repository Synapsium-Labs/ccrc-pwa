// `claude_build_frames` (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.3): one
// new MIGRATIONS entry holding only that table, and `CoordStore`'s three methods (`claudeBuildFrames`, `markFramesAttempt`,
// `recordFrames`; SQL in `coord/claudeBuildFramesStore.ts`) as its only writers. The slot is found by its DDL, never hard-coded.
// Fixture coord.db files only: each case copies a template migrated once, in a temporary home, never the live one.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { COORD_SCHEMA_VERSION, MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { BUILD_CAPTURE_NOT_SENT_MAP, buildTrustOf } from '../../shared/claudeBuildTrust.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { framesListOf } from '../../shared/framesLane.js';
import { FRAMES_PARTS, FRAMES_REFUSAL_MAP, frameSize, type FramesCaptureResult, type FramesRefusal } from '../../shared/framesResult.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

const CREATE = /CREATE TABLE claude_build_frames(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;

// ONE migrated coord.db for the file: opening a store runs every migration, which is slow on a loaded box, so each case copies
// a template migrated once (the delivery capture test's way).
let template = '';
const opened: CoordStore[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-frames-store-template-'), 'coord.db');
  openCoordDb(template).close();
});
removeTmpFixturesEachTest(); // the template, made in beforeAll, is older than any case's mark and stays until the file ends
afterEach(() => { for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } } });
function store(): CoordStore {
  const home = mkTmp('ccrc-frames-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const c = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(c);
  return c;
}

const RULE = '─'.repeat(60);
const TEXT = [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, '  ? for shortcuts'].join('\n') + '\n';

/** A well-formed frames result for `build` and `part`: drawn with `text`, or, with null text, a frame the box's reducer refused. */
function resultFor(build: string, part: number, text: string | null = TEXT, version: string = FRAMES_RECIPE_VERSION, release: string | null = 'v0.0.1500'): FramesCaptureResult {
  const p = FRAMES_PARTS[part]!;
  const size = frameSize(text ?? TEXT);
  return {
    recipe: 'frames', version, build, part, case: p.case, pane: p.pane, release, unmeasured: [], word: text === null ? 'gaps' : 'framed',
    sends: [{ step: 'send', send: 'ok' }], turns: 1, sideRequests: 0,
    frame: text === null
      ? { outcome: 'refused', refusal: 'private-name', ...size, cursor: null, replaced: null, text: null }
      : { outcome: 'drawn', refusal: null, ...size, cursor: [2, 1], replaced: { cwd: 0, path: 1, model: 0, account: 0 }, text },
  };
}
/** The record the store keeps for `r`: the result with its frame text null. */
const recordOf = (r: FramesCaptureResult): FramesCaptureResult => ({ ...r, frame: { ...r.frame, text: null } });
/** One raw column of one stored row. */
const raw = (c: CoordStore, column: string, build: string, part = 0): unknown =>
  (c.db.prepare(`SELECT ${column} AS v FROM claude_build_frames WHERE build = ? AND part = ?`).get(build, part) as { v: unknown } | undefined)?.v;

describe('claude_build_frames is one new entry', () => {
  it('created once, by an entry that adds that table and nothing else; claude_builds and claude_build_deliveries are not altered', () => {
    expect(SLOT).toBeGreaterThan(1);
    expect(SLOT).toBeLessThanOrEqual(COORD_SCHEMA_VERSION);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /claude_build_frames/.test(m))).toBe(false);
    expect(MIGRATIONS[SLOT - 1]).not.toMatch(/claude_builds/);
    expect(MIGRATIONS[SLOT - 1]).not.toMatch(/claude_build_deliveries/);
    const p = path.join(mkTmp('ccrc-mig-frames-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raws = new DatabaseSync(p);
    tx(raws, () => { for (let v = 0; v < SLOT - 1; v++) raws.exec(MIGRATIONS[v]!); raws.exec(`PRAGMA user_version = ${SLOT - 1}`); });
    const names = (): string[] => (raws.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as { name: string }[]).map((r) => r.name);
    const had = names();
    raws.exec(MIGRATIONS[SLOT - 1]!);
    expect(names().filter((n) => !had.includes(n))).toEqual(['claude_build_frames']);
    expect(() => raws.prepare("INSERT INTO claude_build_frames (build, part) VALUES ('2.1.400', -1)").run()).toThrow();
    expect(() => raws.prepare("INSERT INTO claude_build_frames (build, part, attempts) VALUES ('2.1.400', 0, -1)").run()).toThrow();
    raws.prepare("INSERT INTO claude_build_frames (build, part) VALUES ('2.1.400', 0)").run();
    expect(() => raws.prepare("INSERT INTO claude_build_frames (build, part) VALUES ('2.1.400', 0)").run()).toThrow();
    raws.close();
  });
});

describe('the frames writers', () => {
  it('a fresh store has no row', () => { expect(store().claudeBuildFrames()).toEqual([]); });

  it('recordFrames upserts the current result for (build, part) and reads it back whole: the record without its text, the text apart', () => {
    const c = store();
    const r = resultFor('2.1.320', 1);
    expect(c.recordFrames(r, 'clear', 50, [])).toBe(true);
    expect(c.claudeBuildFrames()).toEqual([{
      build: '2.1.320', part: 1, version: r.version, word: 'framed', record: recordOf(r), text: TEXT, checked: 'clear', at: 50,
      attempts: 0, lastAttemptAt: null, notSent: null,
    }]);
    // The two are stored apart: the record column holds the result with a null frame text, the text column holds the text.
    expect((JSON.parse(raw(c, 'record', '2.1.320', 1) as string) as FramesCaptureResult).frame.text).toBeNull();
    expect(raw(c, 'text', '2.1.320', 1)).toBe(TEXT);
    const again = resultFor('2.1.320', 1, null);
    c.recordFrames(again, 'clear', 60, []);
    expect(c.claudeBuildFrames()).toHaveLength(1);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ word: 'gaps', at: 60, text: null, checked: 'clear' });
    expect(raw(c, 'text', '2.1.320', 1), 'the older text is replaced, not kept').toBeNull();
  });

  it('the text is stored only when the receiver\'s word is clear: a refusal word stores no text and reads text null with the word', () => {
    const c = store();
    const words = Object.keys(FRAMES_REFUSAL_MAP) as FramesRefusal[];
    words.forEach((w, i) => c.recordFrames(resultFor('2.1.320', i), w, 10 + i, []));
    const rows = c.claudeBuildFrames();
    expect(rows).toHaveLength(words.length);
    for (const [i, w] of words.entries()) {
      expect(raw(c, 'text', '2.1.320', i), w).toBeNull();
      // The row keeps the box's own word as it was sent (`framed`): the store records and decides nothing, so this case pinned
      // the stored word. What a reader is answered is the list's (review 4069's A1): a refused frame, the gaps word, no counts.
      expect(rows[i], w).toMatchObject({ part: i, word: 'framed', checked: w, text: null, at: 10 + i });
      expect(rows[i]!.record, w).toEqual(recordOf(resultFor('2.1.320', i)));
      expect(framesListOf(rows, '2.1.320').frames[i], w).toMatchObject({ outcome: 'refused', refusal: w, word: 'gaps', replaced: null, hasText: false });
    }
  });

  it('a refused word replaces a clear row\'s text with none: the text a clear row held does not survive its own re-check', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0), 'clear', 10, []);
    expect(raw(c, 'text', '2.1.320')).toBe(TEXT);
    c.recordFrames(resultFor('2.1.320', 0), 'masked', 20, []);
    expect(raw(c, 'text', '2.1.320')).toBeNull();
    expect(c.claudeBuildFrames()[0]).toMatchObject({ checked: 'masked', text: null });
  });

  it('an attempt that went out counts one and clears the why; a try that sent nothing stamps the clock, counts none, records why', () => {
    const c = store();
    c.markFramesAttempt('2.1.320', 0, 10, 'no-runner');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 0, lastAttemptAt: 10, notSent: 'no-runner', word: null, record: null, version: null, text: null, checked: null, at: null });
    c.markFramesAttempt('2.1.320', 0, 20, 'sent');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 20, notSent: null });
    c.markFramesAttempt('2.1.320', 0, 30, 'busy');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 30, notSent: 'busy' });
    expect(Object.keys(BUILD_CAPTURE_NOT_SENT_MAP)).toContain('busy');
    c.markFramesAttempt('2.1.320', 0, 40, 'recipe-not-run');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 40, notSent: 'recipe-not-run' });
    expect(Object.keys(BUILD_CAPTURE_NOT_SENT_MAP), 'build trust\'s vocabulary is unchanged').not.toContain('recipe-not-run');
  });

  it('a result keeps the attempts and the clock, and an attempt keeps a recorded result', () => {
    const c = store();
    c.markFramesAttempt('2.1.320', 2, 10, 'sent');
    const r = resultFor('2.1.320', 2);
    c.recordFrames(r, 'clear', 11, []);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 10, record: recordOf(r), text: TEXT });
    c.markFramesAttempt('2.1.320', 2, 20, 'sent');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ attempts: 2, lastAttemptAt: 20, record: recordOf(r), text: TEXT, word: 'framed', checked: 'clear', at: 11 });
    c.markFramesAttempt('2.1.320', 2, 30, 'busy');
    expect(c.claudeBuildFrames()[0], 'a not-sent try on a measured part leaves its result').toMatchObject({ attempts: 2, record: recordOf(r), text: TEXT, notSent: 'busy' });
  });

  it('a recorded result clears the part\'s last not-sent word: a measured part is not also unmeasured', () => {
    const c = store();
    c.markFramesAttempt('2.1.320', 1, 10, 'recipe-not-run');
    expect(c.claudeBuildFrames()[0]).toMatchObject({ notSent: 'recipe-not-run' });
    c.recordFrames(resultFor('2.1.320', 1), 'clear', 11, []);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ notSent: null, word: 'framed', lastAttemptAt: 10 });
  });

  it('a result of the newer recipe replaces an older version\'s row', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0, TEXT, '0123456789abcdef'), 'clear', 10, []);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ version: '0123456789abcdef', word: 'framed' });
    c.recordFrames(resultFor('2.1.320', 0, null), 'clear', 20, []);
    expect(c.claudeBuildFrames()).toHaveLength(1);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ version: FRAMES_RECIPE_VERSION, word: 'gaps', at: 20, text: null });
  });

  it('rows read newest build first, numerically, then by part', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.310', 1), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.1000', 3), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.320', 1), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.320', 0), 'clear', 1, []);
    c.markFramesAttempt('2.1.9', 0, 1, 'sent');
    expect(c.claudeBuildFrames().map((r) => `${r.build}:${r.part}`)).toEqual(['2.1.1000:3', '2.1.320:0', '2.1.320:1', '2.1.310:1', '2.1.9:0']);
  });

  it('a row of a build off the grammar is left out of the read', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0), 'clear', 1, []);
    c.db.prepare("INSERT INTO claude_build_frames (build, part, attempts) VALUES ('not-a-build', 0, 1)").run();
    expect(c.claudeBuildFrames().map((r) => r.build)).toEqual(['2.1.320']);
  });
});

describe('a row is read whole or not at all', () => {
  const NONE = { version: null, word: null, record: null, text: null, checked: null, at: null };

  it('a version or a word column at odds with its stored record, or a record the reader refuses, reads as a part with none', () => {
    const c = store();
    for (let p = 0; p < 5; p++) c.recordFrames(resultFor('2.1.320', p), 'clear', 1, []);
    c.db.prepare("UPDATE claude_build_frames SET version = '0123456789abcdef' WHERE part = 0").run();
    c.db.prepare("UPDATE claude_build_frames SET word = 'gaps' WHERE part = 1").run();
    c.db.prepare("UPDATE claude_build_frames SET record = '{\"nope\":1}' WHERE part = 2").run();
    c.db.prepare("UPDATE claude_build_frames SET record = 'not json' WHERE part = 3").run();
    c.db.prepare("UPDATE claude_build_frames SET word = 'toString', record = REPLACE(record, '\"word\":\"framed\"', '\"word\":\"toString\"') WHERE part = 4").run();
    const rows = c.claudeBuildFrames();
    for (let p = 0; p < 5; p++) expect(rows[p], String(p)).toMatchObject({ part: p, ...NONE, attempts: 0 });
  });

  it('a record that is a result of another part or another build reads as none', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.320', 1), 'clear', 1, []);
    c.db.prepare('UPDATE claude_build_frames SET record = (SELECT record FROM claude_build_frames WHERE part = 1) WHERE part = 0').run();
    c.db.prepare("UPDATE claude_build_frames SET build = '2.1.321' WHERE part = 1").run();
    for (const r of c.claudeBuildFrames()) expect(r, `${r.build}:${r.part}`).toMatchObject(NONE);
  });

  it('an unknown not-sent word reads as none, whatever the row holds, and the attempts and clock stay', () => {
    const c = store();
    c.markFramesAttempt('2.1.320', 0, 3, 'busy');
    c.markFramesAttempt('2.1.320', 1, 3, 'busy');
    c.markFramesAttempt('2.1.320', 2, 3, 'busy');
    c.db.prepare("UPDATE claude_build_frames SET notSent = 'gone-fishing' WHERE part = 0").run();
    c.db.prepare("UPDATE claude_build_frames SET notSent = 'toString' WHERE part = 1").run();
    c.db.prepare("UPDATE claude_build_frames SET notSent = 'constructor' WHERE part = 2").run();
    for (const [p, row] of c.claudeBuildFrames().entries()) expect(row, String(p)).toMatchObject({ part: p, notSent: null, lastAttemptAt: 3 });
  });

  it('an unknown receiver word, a toString or a constructor, reads as none and carries no text; the row itself stays whole', () => {
    const c = store();
    for (let p = 0; p < 3; p++) c.recordFrames(resultFor('2.1.320', p), 'clear', 1, []);
    c.db.prepare("UPDATE claude_build_frames SET checked = 'gone-fishing' WHERE part = 0").run();
    c.db.prepare("UPDATE claude_build_frames SET checked = 'toString' WHERE part = 1").run();
    c.db.prepare("UPDATE claude_build_frames SET checked = 'constructor' WHERE part = 2").run();
    for (const [p, row] of c.claudeBuildFrames().entries()) {
      expect(row, String(p)).toMatchObject({ part: p, checked: null, text: null, word: 'framed', version: FRAMES_RECIPE_VERSION, at: 1 });
      expect(row.record, String(p)).not.toBeNull();
      expect(raw(c, 'text', '2.1.320', p), 'the text is still stored, and never read').toBe(TEXT);
    }
  });

  it('a refusal word on a row hides a text that is stored beside it: the text is read only under the word clear', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0), 'clear', 1, []);
    c.db.prepare("UPDATE claude_build_frames SET checked = 'private-shape'").run();
    expect(c.claudeBuildFrames()[0]).toMatchObject({ checked: 'private-shape', text: null, word: 'framed' });
  });

  it('a text the reader would refuse beside its record reads null, with the record, word and time intact', () => {
    const c = store();
    const bad: (string | null)[] = [
      'a\x1b]8;;http://x\x1b\\b\n', // a hyperlink: never stripped, never read
      'a\tb\n', // a control character
      `${'x\n'.repeat(51)}`, // 51 rows over a 50-row pane
      'y'.repeat(221) + '\n', // 221 columns over a 220-column pane
    ];
    bad.forEach((_t, p) => c.recordFrames(resultFor('2.1.320', p), 'clear', 7, []));
    bad.forEach((t, p) => c.db.prepare('UPDATE claude_build_frames SET text = ? WHERE part = ?').run(t, p));
    const rows = c.claudeBuildFrames();
    expect(rows).toHaveLength(bad.length);
    for (let p = 0; p < bad.length; p++) {
      expect(rows[p], String(p)).toMatchObject({ part: p, text: null, word: 'framed', checked: 'clear', at: 7 });
      expect(rows[p]!.record, String(p)).not.toBeNull();
    }
  });

  it('a stored text of the wrong type for a part with no carried frame: a record that holds no text reads null text', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.320', 0, null), 'clear', 1, []);
    c.db.prepare("UPDATE claude_build_frames SET text = 'planted\n'").run();
    // the record is a refused frame (no text carried), so a text beside it makes no whole result: it is never read.
    expect(c.claudeBuildFrames()[0]).toMatchObject({ word: 'gaps', checked: 'clear', text: null });
    expect(c.claudeBuildFrames()[0]!.record).not.toBeNull();
  });
});

describe('drop: the texts of the named builds are set aside in the same savepoint, their records stay', () => {
  it('names a build, and every part of it, and no other: the text goes, the record, the word and the time stay', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.300', 0), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.300', 1), 'clear', 2, []);
    c.recordFrames(resultFor('2.1.301', 0), 'clear', 3, []);
    c.recordFrames(resultFor('2.1.302', 0), 'clear', 4, ['2.1.300', '2.1.999']);
    const rows = c.claudeBuildFrames();
    const by = (b: string, p: number) => rows.find((r) => r.build === b && r.part === p)!;
    expect(by('2.1.300', 0)).toMatchObject({ text: null, word: 'framed', checked: 'clear', at: 1, record: recordOf(resultFor('2.1.300', 0)) });
    expect(by('2.1.300', 1)).toMatchObject({ text: null, word: 'framed', at: 2, record: recordOf(resultFor('2.1.300', 1)) });
    expect(by('2.1.301', 0).text, 'a build not named keeps its text').toBe(TEXT);
    expect(by('2.1.302', 0).text, 'the incoming record\'s own text is stored').toBe(TEXT);
    expect(raw(c, 'text', '2.1.300', 1)).toBeNull();
    expect(rows).toHaveLength(4);
  });

  it('an empty drop sets nothing aside', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.300', 0), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.301', 0), 'clear', 2, []);
    expect(c.claudeBuildFrames().map((r) => r.text)).toEqual([TEXT, TEXT]);
  });

  it('a build named in the drop that is the incoming one loses its own text too: the caller decides, the store only does', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.300', 0), 'clear', 1, ['2.1.300']);
    expect(c.claudeBuildFrames()[0]).toMatchObject({ word: 'framed', text: null });
  });

  it('a drop that fails part-way undoes the whole savepoint: the record is not stored and an earlier named text is kept, and the store still works', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.300', 0), 'clear', 1, []);
    c.recordFrames(resultFor('2.1.301', 0), 'clear', 2, []);
    // A trigger on the fixture db only: setting the text of 2.1.300 aside aborts, after 2.1.301's has been.
    c.db.exec("CREATE TRIGGER frames_no_drop BEFORE UPDATE ON claude_build_frames WHEN NEW.build = '2.1.300' AND NEW.text IS NULL AND OLD.text IS NOT NULL BEGIN SELECT RAISE(ABORT, 'no'); END");
    expect(() => c.recordFrames(resultFor('2.1.302', 0), 'clear', 3, ['2.1.301', '2.1.300'])).toThrow();
    expect(raw(c, 'text', '2.1.301'), 'the earlier drop is undone').toBe(TEXT);
    expect(raw(c, 'text', '2.1.300')).toBe(TEXT);
    expect(c.claudeBuildFrames().map((r) => r.build).sort()).toEqual(['2.1.300', '2.1.301']);
    c.db.exec('DROP TRIGGER frames_no_drop');
    expect(c.recordFrames(resultFor('2.1.302', 0), 'clear', 4, ['2.1.301', '2.1.300'])).toBe(true);
    expect(c.claudeBuildFrames().map((r) => [r.build, r.text === null])).toEqual([['2.1.302', false], ['2.1.301', true], ['2.1.300', true]]);
  });

  it('a record that cannot be stored throws and drops nothing', () => {
    const c = store();
    c.recordFrames(resultFor('2.1.300', 0), 'clear', 1, []);
    const bad = { ...resultFor('2.1.302', 0), part: -1 };
    expect(() => c.recordFrames(bad, 'clear', 2, ['2.1.300'])).toThrow();
    expect(raw(c, 'text', '2.1.300')).toBe(TEXT);
    expect(c.recordFrames(resultFor('2.1.302', 0), 'clear', 3, [])).toBe(true);
  });
});

describe('the table is the frames recipe\'s own', () => {
  it('never touches claude_builds, and no trust word moves', () => {
    const c = store();
    const before = JSON.stringify(c.claudeBuilds());
    c.markFramesAttempt('2.1.302', 0, 10, 'sent');
    c.recordFrames(resultFor('2.1.302', 0), 'private-name', 11, ['2.1.301']);
    expect(JSON.stringify(c.claudeBuilds())).toBe(before);
    expect(buildTrustOf(c.claudeBuilds(), '2.1.302')).toEqual({ kind: 'trusted', cwd: true });
  });

  it('never touches claude_build_deliveries', () => {
    const c = store();
    const before = JSON.stringify(c.claudeBuildDeliveries());
    c.markFramesAttempt('2.1.302', 0, 10, 'sent');
    c.recordFrames(resultFor('2.1.302', 0), 'clear', 11, []);
    expect(JSON.stringify(c.claudeBuildDeliveries())).toBe(before);
    expect(c.claudeBuildDeliveries()).toEqual([]);
  });
});
