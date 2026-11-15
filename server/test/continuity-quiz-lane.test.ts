// Overlord W1a, the replay quiz piece (plan `w1a-replay-quiz.md` Task 4; spec §3.3.9 C52; W0-28 ruled B): the weekly quiz
// lane raises one operator item a week asking the operator to run history's replay quiz by hand and record it, and raises
// nothing while the record path (the single-arm mode and `ccrc quiz-record`, a later plan) is absent (ask 434, slug
// quiz-item-waits-for-the-record-path). The rules are L1 (`quiz.ts`: `quizWeek`, `quizItemText`, `quizLaneVerdict`); the
// lane (`quizLane.ts`) reads and raises.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  QUIZ_ITEM_PROGRAMME, QUIZ_RECORD_READY, quizItemText, quizLaneVerdict, quizWeek, type QuizLaneFacts,
} from '../src/continuity/quiz.js';
import { runQuizLane, type QuizLanePort } from '../src/continuity/quizLane.js';
import { insertQuizRun, quizLanePortOf } from '../src/continuity/quizStore.js';
import { ITEM_STEPS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX } from '../../shared/ledgers.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');
const MON = Date.UTC(2026, 10, 16, 0, 0, 0);       // Monday 2026-11-16, ISO week 2026-W47 (UTC)
const DAY = 86_400_000;

const facts = (over: Partial<QuizLaneFacts> = {}): QuizLaneFacts => ({
  recordReady: true, week: quizWeek(MON + DAY), recordedAts: { ok: true, value: [] }, baseline: { ok: true, exists: false },
  itemRaised: { ok: true, value: false }, ...over,
});

describe('quizWeek: the ISO week, in UTC (slug quiz-week-is-utc)', () => {
  it('names the week and its Monday start', () => {
    expect(quizWeek(MON)).toEqual({ key: '2026-W47', start: MON });
    expect(quizWeek(MON + 7 * DAY - 1)).toEqual({ key: '2026-W47', start: MON });
    expect(quizWeek(MON - 1)).toEqual({ key: '2026-W46', start: MON - 7 * DAY });
  });

  it('crosses a year by the ISO rule', () => {
    expect(quizWeek(Date.UTC(2027, 0, 1, 12)).key).toBe('2026-W53');
    expect(quizWeek(Date.UTC(2027, 0, 4)).key).toBe('2027-W01');
    expect(quizWeek(Date.UTC(2026, 0, 1)).key).toBe('2026-W01');
  });
});

describe('quizLaneVerdict (L1)', () => {
  it('raises nothing while the record path is absent, whatever else holds', () => {
    expect(quizLaneVerdict(facts({ recordReady: false }))).toEqual({ kind: 'hold', why: 'record-path-absent' });
  });

  it('with the path present: one item for a week with no run and no item, titled the baseline before one exists', () => {
    const v = quizLaneVerdict(facts());
    expect(v).toEqual({ kind: 'raise', item: quizItemText('2026-W47', false) });
    expect(v.kind === 'raise' && v.item.title).toMatch(/baseline/);
    const after = quizLaneVerdict(facts({ baseline: { ok: true, exists: true } }));
    expect(after.kind === 'raise' && after.item.title).not.toMatch(/baseline/);
  });

  it('none when a run was recorded this week; a run recorded last week does not count', () => {
    expect(quizLaneVerdict(facts({ recordedAts: { ok: true, value: [MON + 3_600_000] } }))).toEqual({ kind: 'hold', why: 'recorded' });
    expect(quizLaneVerdict(facts({ recordedAts: { ok: true, value: [MON - 1] } }))).toMatchObject({ kind: 'raise' });
  });

  it('none when this week\'s item was already raised, in any state', () => {
    expect(quizLaneVerdict(facts({ itemRaised: { ok: true, value: true } }))).toEqual({ kind: 'hold', why: 'raised' });
  });

  it('a read that failed raises nothing (unmeasured), never folded into a raise', () => {
    expect(quizLaneVerdict(facts({ recordedAts: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
    expect(quizLaneVerdict(facts({ baseline: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
    expect(quizLaneVerdict(facts({ itemRaised: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
  });
});

describe('the item says what, how and why, and names every condition', () => {
  for (const baseline of [false, true]) {
    it(`fits the item's bounds and carries the four conditions (baseline recorded: ${String(baseline)})`, () => {
      const t = quizItemText('2026-W47', baseline);
      expect(t.title.length).toBeLessThanOrEqual(ITEM_TITLE_MAX);
      expect(t.title).toContain('2026-W47');
      expect(t.why.length).toBeLessThanOrEqual(ITEM_TEXT_MAX);
      expect(t.how.length).toBeLessThanOrEqual(ITEM_STEPS_MAX);
      for (const step of t.how) expect(step.length).toBeLessThanOrEqual(ITEM_TEXT_MAX);
      const all = [t.why, ...t.how].join('\n');
      expect(all).toMatch(/read-only/);                                   // 1: the history store, read-only
      expect(all).toMatch(/writing form of `ccrc history`/);              // 1
      expect(all).toMatch(/marker/);                                      // 2: no history marker
      expect(all).toMatch(/by hand/);                                     // 3: the driver by the operator's hand
      expect(all).toMatch(/never a W2 result, a PASS or a measured benefit/); // 4
      expect(all).toMatch(/ccrc quiz-record --report <file> --sha <hex>/);
    });
  }
});

const SHA = (c: string): string => c.repeat(64);
const setup = (recordReady = true) => {
  const home = mkTmp('ccrc-quiz-lane-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  return { coord, port: quizLanePortOf(coord, recordReady) };
};
const recordRun = (coord: CoordStore, at: number, sha = 'a'): void => {
  insertQuizRun(coord.db, { recordedBy: 'operator', recordedAt: at, report: {
    measuredAt: at, reportSha: SHA(sha), questionsSha: SHA('b'), questions: 40, families: 6, score: 0.7, lo: 0.6, hi: 0.8,
    judgeModel: 'judge-a', ccrcRelease: 'v1', claudeBuilds: ['2.1.0'], steerArmed: 'no', agentsOnArmed: 'no',
  } }, (lane) => coord.laneArmSetting(lane));
};
const quizItems = (coord: CoordStore) => coord.itemsFor(QUIZ_ITEM_PROGRAMME, MON + 30 * DAY).open;

describe('the lane over the store', () => {
  it('raises nothing while the record path is absent', () => {
    const { coord, port } = setup(false);
    expect(runQuizLane(port, MON + DAY)).toEqual({ kind: 'hold', why: 'record-path-absent' });
    expect(quizItems(coord)).toEqual([]);
  });

  it('one item a week, none twice, and the next week\'s once more', () => {
    const { coord, port } = setup();
    expect(runQuizLane(port, MON + DAY)).toMatchObject({ kind: 'raised' });
    expect(runQuizLane(port, MON + 2 * DAY)).toEqual({ kind: 'hold', why: 'raised' });
    const first = quizItems(coord);
    expect(first.map((i) => [i.title, i.raisedBy, i.kind, i.neededBy])).toEqual([[quizItemText('2026-W47', false).title, 'ccrc', 'do', 'soon']]);
    expect(runQuizLane(port, MON + 8 * DAY)).toMatchObject({ kind: 'raised' });
    expect(quizItems(coord).map((i) => i.title)).toEqual([quizItemText('2026-W47', false).title, quizItemText('2026-W48', false).title]);
  });

  it('a dismissed or done item of this week is not raised again', () => {
    const { coord, port } = setup();
    runQuizLane(port, MON + DAY);
    coord.db.exec("UPDATE operator_items SET state = 'dismissed'");
    expect(runQuizLane(port, MON + 2 * DAY)).toEqual({ kind: 'hold', why: 'raised' });
  });

  it('none when a run is recorded that week; the title drops "the baseline" once one exists', () => {
    const { coord, port } = setup();
    recordRun(coord, MON + 3_600_000);
    expect(runQuizLane(port, MON + DAY)).toEqual({ kind: 'hold', why: 'recorded' });
    expect(runQuizLane(port, MON + 8 * DAY)).toMatchObject({ kind: 'raised' });
    expect(quizItems(coord).map((i) => i.title)).toEqual([quizItemText('2026-W48', true).title]);
  });

  it('a failed read raises nothing', () => {
    const { coord, port } = setup();
    coord.db.exec('DROP TABLE continuity_quiz_runs');
    expect(runQuizLane(port, MON + DAY)).toEqual({ kind: 'hold', why: 'unmeasured' });
    expect(quizItems(coord)).toEqual([]);
  });

  it('a raise that throws is the lane\'s failure, not a silent hold', () => {
    const port: QuizLanePort = { ...setup().port, raise: () => { throw new Error('disk full'); } };
    expect(() => runQuizLane(port, MON + DAY)).toThrow(/disk full/);
  });
});

describe('the record path\'s gate and the four conditions, pinned', () => {
  it('QUIZ_RECORD_READY is false until the record door ships, and true with it: the later PR turns both on together', () => {
    expect(QUIZ_RECORD_READY).toBe(existsSync(path.join(SRC, 'continuity/quizRoutes.ts')));
  });

  it('the lane and its rules import nothing that runs a process or writes a file, and nothing of history\'s', () => {
    for (const f of ['continuity/quizLane.ts', 'continuity/quiz.ts']) {
      const src = readFileSync(path.join(SRC, f), 'utf8');
      const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
      expect(specs.length, f).toBeGreaterThan(0);
      for (const s of specs) {
        expect(s, `${f} imports ${s}`).not.toMatch(/^node:(child_process|fs|fs\/promises|worker_threads)$|^(child_process|fs)$|\/io\.js$|ccdArgv|runner|exec|history/);
      }
      expect(src, f).not.toMatch(/history-replay|history-gate|\.ccrc\/history/);
    }
  });

  it('no server source names the quiz driver, its scorer or the history store\'s path', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(SRC).filter((f) => f.endsWith('.ts') && /history-replay\.mjs|history-gate\.mjs/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
