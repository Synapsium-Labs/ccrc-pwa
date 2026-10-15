// server/test/history-card.test.ts: the card line's sweep half (spec 2026-10-05 §8.6, §5.1, §5.2, §9.2 step 6,
// §9.4, §10.7 W1-e; W1-B3 plan Tasks 1-7).
//   - Tasks 1-3: pure lib cases (the vocabulary, the line, the prediction, the file, delivery and purge decisions).
//     They run on darwin too.
//   - Task 4: derive.mjs's exported slot lists, in-process against a store built by hand.
//   - Tasks 5-7: the sweep's card writer, delivery measure and collector, through REAL sweep passes in fixture HOMEs
//     (historyHelpers' makeHistoryBox). Each of those describes calls skipOnDarwin() inside its own body, so the pure
//     describes above still run on darwin.
// Nothing here reads or writes the live ~/.ccrc, a registry or an account home.
import { describe, it, expect } from 'vitest';
import * as libCard from '../../ccd/history/lib.mjs';
import { compactionSequence } from './historyFixtures.js';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { brotli, closeWriter, createStore, openWriter } from '../../ccd/history/store.mjs';

/** Spec §8.6's grammar, as the spec spells it. */
const SPEC_GRAMMAR = String.raw`^History: node L[0-9a-f]{6,20}… \(this compaction\)( · parent N[0-9a-f]{6,20}…)? · ~/\.local/bin/ccrc history describe L[0-9a-f]{6,20}$`;
/** Spec §8.6's example line (rev 3.3). */
const SPEC_EXAMPLE = 'History: node L03a9c1… (this compaction) · parent N7c1e2f… · ~/.local/bin/ccrc history describe L03a9c1';
const HEX20 = '0123456789abcdef0123';

describe('the card line: vocabulary, grammar, paths and line builder (spec 8.6, 5.2; W1-B3 Task 1)', () => {
  it('the directories, the cap, the describe command and the purge grace are spelled once, in lib', () => {
    expect(libCard.CARD_DIR).toBe('card');
    expect(libCard.SCOPE_DIR).toBe('scope');
    expect(libCard.CARD_LINE_MAX).toBe(512);
    expect(libCard.CARD_DESCRIBE_CMD).toBe('~/.local/bin/ccrc history describe');
    expect(libCard.PURGED_FILES_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('CARD_LINE_PATTERN is the spec grammar character for character, and it opens with CARD_PREFIX', () => {
    expect(libCard.CARD_LINE_PATTERN).toBe(SPEC_GRAMMAR);
    expect(libCard.CARD_LINE_PATTERN.startsWith(`^${libCard.CARD_PREFIX}node `)).toBe(true);
    expect(libCard.CARD_LINE_RE.source).toBe(new RegExp(SPEC_GRAMMAR).source);
  });

  it('the grammar takes the spec example and its parent-less form, and refuses trailing text, a newline, upper case, 5 hex, an N leaf, an L parent and another path', () => {
    const re = libCard.CARD_LINE_RE;
    expect(re.test(SPEC_EXAMPLE)).toBe(true);
    expect(re.test('History: node L03a9c1… (this compaction) · ~/.local/bin/ccrc history describe L03a9c1')).toBe(true);
    for (const bad of [
      `${SPEC_EXAMPLE} && rm -rf /`, `${SPEC_EXAMPLE}\nextra`, SPEC_EXAMPLE.replace('L03a9c1…', 'L03A9C1…'),
      SPEC_EXAMPLE.replace('L03a9c1…', 'L03a9c…'), SPEC_EXAMPLE.replace('node L03a9c1', 'node N03a9c1'),
      SPEC_EXAMPLE.replace('parent N7c1e2f', 'parent L7c1e2f'), SPEC_EXAMPLE.replace('~/.local', '$HOME/.local'),
    ]) expect(re.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it('cardLine writes the spec example exactly; 6- and 20-hex ids with and without a parent pass the grammar, the longest in 145 characters', () => {
    expect(libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' })).toBe(SPEC_EXAMPLE);
    expect(libCard.cardLine({ leaf: 'L03a9c1' })).toBe('History: node L03a9c1… (this compaction) · ~/.local/bin/ccrc history describe L03a9c1');
    const pairs: Array<[string, string | null]> = [['L03a9c1', null], [`L${HEX20}`, `N${HEX20}`], [`L${HEX20}`, null], ['L03a9c1', `N${HEX20}`]];
    for (const [leaf, parent] of pairs) {
      const line = libCard.cardLine({ leaf, parent });
      expect(libCard.CARD_LINE_RE.test(line), line).toBe(true);
      expect(line.length, line).toBeLessThanOrEqual(libCard.CARD_LINE_MAX);
    }
    expect(libCard.cardLine({ leaf: `L${HEX20}`, parent: `N${HEX20}` })).toHaveLength(145);
  });

  it('cardLine throws on an N leaf, an L parent, upper case, 5 or 21 hex digits, or anything else the grammar refuses', () => {
    const bad: Array<{ leaf: string; parent?: string | null }> = [
      { leaf: 'N03a9c1' }, { leaf: 'L03a9c1', parent: 'L7c1e2f' }, { leaf: 'L03A9C1' }, { leaf: 'L03a9c' },
      { leaf: `L${HEX20}0` }, { leaf: 'L03a9c1 x' }, { leaf: 'L03a9c1', parent: 'N7c1e2f\nx' },
    ];
    // The builder's own message, not just any TypeError: before the lib block exists, calling the missing export
    // throws `TypeError: libCard.cardLine is not a function`, which a bare toThrow(TypeError) would accept.
    for (const b of bad) expect(() => libCard.cardLine(b), JSON.stringify(b)).toThrow(/^cardLine: not a card line/);
  });

  it('B2 describe reads the line this builder writes: extractNodeId takes its structural leaf id', () => {
    expect(libCard.extractNodeId(libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' }))).toEqual({ ok: true, id: 'L03a9c1' });
    expect(libCard.extractNodeId(libCard.cardLine({ leaf: `L${HEX20}` }))).toEqual({ ok: true, id: `L${HEX20}` });
  });

  it('the path helpers run idOk on the id and the UUID grammar on the uuid before any path is formed (C66 shape)', () => {
    const home = '/home/u';
    const U = '0189abcd-1234-4678-9abc-0000000000c1';
    expect(libCard.cardDirOf(home, 'demo-quiet-basin')).toBe('/home/u/.ccrc/history/card/demo-quiet-basin');
    expect(libCard.cardFileOf(home, 'demo-quiet-basin', U)).toBe(`/home/u/.ccrc/history/card/demo-quiet-basin/${U}.txt`);
    expect(libCard.scopeMarkerOf(home, 'demo-quiet-basin')).toBe('/home/u/.ccrc/history/scope/demo-quiet-basin');
    expect(libCard.cardDirOf(home, 'x'.repeat(224))).toBe(`/home/u/.ccrc/history/card/${'x'.repeat(224)}`);
    for (const id of ['.', '..', '../x', 'a/b', '', 'x'.repeat(225)]) {
      expect(() => libCard.cardDirOf(home, id), id).toThrow(TypeError);
      expect(() => libCard.cardFileOf(home, id, U), id).toThrow(TypeError);
      expect(() => libCard.scopeMarkerOf(home, id), id).toThrow(TypeError);
    }
    for (const uuid of [U.toUpperCase(), `${U}.txt`, '../x', '']) {
      expect(() => libCard.cardFileOf(home, 'demo-quiet-basin', uuid), uuid).toThrow(TypeError);
    }
  });
});

// ===========================================================================
// W1-B3 Task 2: the prediction and the card file decision (spec §8.6, §6.1, §6.3). Pure.
// ===========================================================================
describe('the card prediction and the card file decision (spec 8.6, 6.1, 6.3; W1-B3 Task 2)', () => {
  const ID = 'demo-quiet-basin';
  const U = '0189abcd-1234-4678-9abc-0000000000c2';
  const leafOf = (start: string): string => libCard.leafId(ID, U, start);
  const base: libCard.CardPredictionInputs = {
    ccrcId: ID, ccUuid: U, firstRowUuid: 'r-first', lastBoundary: null, plainBoundOther: false, slots: [],
    newestCondensed: null, familyIds: [],
  };
  const writeOf = (p: libCard.CardPrediction): Extract<libCard.CardPrediction, { act: 'write' }> => {
    if (p.act !== 'write') throw new Error(`expected a write, got ${JSON.stringify(p)}`);
    return p;
  };

  it("the span start: the copy's first row before any boundary, else the last boundary's head (its uuid when it has none), equal to planSpans' over the whole copy", () => {
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: null })).toBe('r-first');
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: { uuid: 'b-1', headUuid: 'h-1' } })).toBe('h-1');
    expect(libCard.predictedSpanStart({ firstRowUuid: 'r-first', lastBoundary: { uuid: 'b-1', headUuid: null } })).toBe('b-1');
    expect(libCard.predictedSpanStart({ firstRowUuid: null, lastBoundary: null })).toBeNull();
    for (const trigger of ['manual', 'auto'] as const) {
      const s = compactionSequence({ n: 3, trigger, seed: 0xc2 });
      const rows = s.rows.map((r, pos) => {
        const uuid = String(r['uuid']);
        return { uuid, pos, isBoundary: s.boundaryUuids.includes(uuid), isSummary: s.summaryUuids.includes(uuid) };
      });
      const boundaries = s.boundaryUuids.map((uuid, k) => ({
        uuid, headUuid: s.headUuids[k]!, kept: new Set(s.keptUuids[k]!), summaryUuid: s.summaryUuids[k]!,
      }));
      const spans = libCard.planSpans({ rows, boundaries }).leaves;
      expect(spans).toHaveLength(3);
      spans.forEach((leaf, k) => {
        const predicted = libCard.predictedSpanStart({
          firstRowUuid: rows[0]!.uuid,
          lastBoundary: k === 0 ? null : { uuid: s.boundaryUuids[k - 1]!, headUuid: s.headUuids[k - 1]! },
        });
        expect(predicted, `${trigger} leaf ${k}`).toBe(leaf.spanStartUuid);
      });
    }
  });

  it('the leaf is the plain id; its depth-1 parent is predicted when it is the 8th final, unparented slot of the run', () => {
    const seven = Array.from({ length: 7 }, (_, k) => leafOf(`s-${k}`));
    const leaf = leafOf('h-7');
    const p = writeOf(libCard.planCardPrediction({
      ...base, lastBoundary: { uuid: 'b-7', headUuid: 'h-7' }, slots: seven.map((nodeId) => ({ nodeId, parented: false })),
    }));
    expect({ leafId: p.leafId, parentId: p.parentId, parentKind: p.parentKind })
      .toEqual({ leafId: leaf, parentId: libCard.parentId([...seven, leaf]), parentKind: 'predicted' });
  });

  it('grouping starts at the first unparented slot; a parented slot never regroups; a slot not yet final stops the run', () => {
    const ids = Array.from({ length: 15 }, (_, k) => leafOf(`s-${k}`));
    const leaf = leafOf('h-15');
    const at = { ...base, lastBoundary: { uuid: 'b-15', headUuid: 'h-15' } };
    const after8 = writeOf(libCard.planCardPrediction({ ...at, slots: ids.map((nodeId, k) => ({ nodeId, parented: k < 8 })) }));
    expect([after8.parentId, after8.parentKind]).toEqual([libCard.parentId([...ids.slice(8), leaf]), 'predicted']);
    const gap = writeOf(libCard.planCardPrediction({ ...at, slots: ids.map((nodeId, k) => ({ nodeId: k === 10 ? null : nodeId, parented: k < 8 })) }));
    expect([gap.leafId, gap.parentId, gap.parentKind]).toEqual([leaf, null, null]);
    const ninth = writeOf(libCard.planCardPrediction({ ...at, slots: ids.slice(0, 9).map((nodeId, k) => ({ nodeId, parented: k < 8 })) }));
    expect([ninth.parentId, ninth.parentKind]).toEqual([null, null]);
  });

  it("with no predicted parent the epoch's newest condensed node is named; a malformed one, or none, names no parent", () => {
    const N = `N${'c'.repeat(20)}`;
    const p = writeOf(libCard.planCardPrediction({ ...base, newestCondensed: N }));
    expect([p.parentId, p.parentKind]).toEqual([N, 'newest-condensed']);
    expect(p.line).toContain(` · parent ${N.slice(0, 7)}…`);
    for (const bad of [`L${'c'.repeat(20)}`, 'Nbad', `N${'C'.repeat(20)}`, `N${'c'.repeat(19)}`]) {
      const q = writeOf(libCard.planCardPrediction({ ...base, newestCondensed: bad }));
      expect([q.parentId, q.parentKind], bad).toEqual([null, null]);
    }
  });

  it('no epoch, no rows, and a plain id already bound elsewhere (a fork: the qualified id would hash a boundary not yet written) each skip', () => {
    expect(libCard.planCardPrediction({ ...base, ccrcId: null })).toEqual({ act: 'skip', reason: 'no-epoch' });
    expect(libCard.planCardPrediction({ ...base, firstRowUuid: null })).toEqual({ act: 'skip', reason: 'no-rows' });
    expect(libCard.planCardPrediction({ ...base, plainBoundOther: true }), 'a fork skip names the plain id it could not use')
      .toEqual({ act: 'skip', reason: 'fork-qualified', plainLeafId: leafOf('r-first') });
  });

  it('display prefixes are at least 6 hex and unique over the family: a family id sharing 7 hex digits with the leaf forces 8', () => {
    const leaf = leafOf('r-first');
    const plain = writeOf(libCard.planCardPrediction(base));
    expect(plain.line).toBe(libCard.cardLine({ leaf: leaf.slice(0, 7) }));
    const twin = `${leaf.slice(0, 8)}${leaf[8] === '0' ? '1' : '0'}${leaf.slice(9)}`;
    const p = writeOf(libCard.planCardPrediction({ ...base, familyIds: [twin, `N${'d'.repeat(20)}`] }));
    expect(p.line).toBe(libCard.cardLine({ leaf: leaf.slice(0, 9) }));
  });

  it('decideCardFile: write only at end-of-file, keep an unchanged line, delete a consumed or orphaned prediction off end-of-file; consumed exactly when the leaf moved', () => {
    const leaf = leafOf('h-1');
    const next = leafOf('h-2');
    const lineOf = (id: string, parent: string | null = null): string => libCard.cardLine({ leaf: id.slice(0, 7), parent });
    const write = (id: string, line: string): libCard.CardPrediction => ({ act: 'write', line, leafId: id, parentId: null, parentKind: null });
    const value = (v: string): libCard.Presence<string> => ({ state: 'value', value: v });
    const absent: libCard.Presence<string> = { state: 'absent' };
    const unreadable: libCard.Presence<string> = { state: 'unreadable' };
    const now = write(leaf, lineOf(leaf));
    const reRendered = write(leaf, lineOf(leaf, `N${'e'.repeat(6)}`));
    const moved = write(next, lineOf(next));
    expect(next.startsWith(leaf.slice(0, 7)), 'CONTROL: the two fixture leaves differ in their first 7 characters').toBe(false);
    const rows: Array<[string, libCard.Presence<string>, libCard.CardPrediction, boolean, { act: string; consumed: boolean }]> = [
      ['no file, at end-of-file', absent, now, true, { act: 'write', consumed: false }],
      ['no file, off end-of-file', absent, now, false, { act: 'none', consumed: false }],
      ['the same line and its LF', value(`${lineOf(leaf)}\n`), now, true, { act: 'keep', consumed: false }],
      ['the same leaf, a parent now, at end-of-file', value(`${lineOf(leaf)}\n`), reRendered, true, { act: 'write', consumed: false }],
      ['the same leaf, a parent now, off end-of-file', value(`${lineOf(leaf)}\n`), reRendered, false, { act: 'keep', consumed: false }],
      ['the leaf moved, at end-of-file', value(`${lineOf(leaf)}\n`), moved, true, { act: 'write', consumed: true }],
      ['the leaf moved, off end-of-file', value(`${lineOf(leaf)}\n`), moved, false, { act: 'delete', consumed: true }],
      ['a file that is no card line, at end-of-file', value('free text\n'), now, true, { act: 'write', consumed: false }],
      ['a file that is no card line, off end-of-file', value('free text\n'), now, false, { act: 'delete', consumed: false }],
      ['an unreadable file, at end-of-file', unreadable, now, true, { act: 'write', consumed: false }],
      ['an unreadable file, off end-of-file', unreadable, now, false, { act: 'delete', consumed: false }],
      ['a fork skip, the leaf unmoved', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: leaf }, true, { act: 'delete', consumed: false }],
      ['a fork skip after the leaf moved', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, true, { act: 'delete', consumed: true }],
      ['a fork skip after the leaf moved, off end-of-file', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, false, { act: 'delete', consumed: true }],
      ['a no-epoch skip, with a file', value(`${lineOf(leaf)}\n`), { act: 'skip', reason: 'no-epoch' }, true, { act: 'delete', consumed: false }],
      ['a fork skip over a file that is no card line', value('free text\n'), { act: 'skip', reason: 'fork-qualified', plainLeafId: next }, true, { act: 'delete', consumed: false }],
      ['a skip, with none', absent, { act: 'skip', reason: 'no-epoch' }, true, { act: 'none', consumed: false }],
    ];
    for (const [name, current, prediction, atEof, want] of rows) {
      expect(libCard.decideCardFile({ current, prediction, atEof }), name).toEqual(want);
    }
  });

  // R-recalloff-parity (spec §9.7, §8.2, C68): the record the hook compares recall-off/<id> with when neither the env
  // nor the registry resolves a generation. A stale record must never stand beside a prediction: it is rewritten
  // where a write is allowed and removed where it is not, so the hook withholds rather than serve on it.
  it('decideCardGenFile: the generation record beside a standing prediction is kept only when it names the resolved generation; a stale one is rewritten at a write, removed otherwise; none without a prediction', () => {
    const G = '0189abcd-1234-4678-9abc-0000000000c0';
    const G2 = '0189abcd-1234-4678-9abc-0000000000c9';
    const value = (v: string): libCard.Presence<string> => ({ state: 'value', value: v });
    const absent: libCard.Presence<string> = { state: 'absent' };
    const unreadable: libCard.Presence<string> = { state: 'unreadable' };
    const rows: Array<[string, libCard.Presence<string>, string, 'keep' | 'write' | 'delete' | 'none', boolean, string]> = [
      ['a prediction written, no record', absent, G, 'write', true, 'write'],
      ['a prediction written, the record equal', value(`${G}\n`), G, 'write', true, 'keep'],
      ['a prediction written, the record naming another generation', value(`${G2}\n`), G, 'write', true, 'write'],
      ['a record without its LF is rewritten', value(G), G, 'write', true, 'write'],
      ['a prediction kept, the record equal', value(`${G}\n`), G, 'keep', false, 'keep'],
      ['a prediction kept at end-of-file, the record stale', value(`${G2}\n`), G, 'keep', true, 'write'],
      ['a prediction kept off end-of-file, the record stale', value(`${G2}\n`), G, 'keep', false, 'delete'],
      ['a prediction kept off end-of-file, no record', absent, G, 'keep', false, 'none'],
      ['a prediction kept off end-of-file, an unreadable record', unreadable, G, 'keep', false, 'delete'],
      ['a legacy newest family: the record is one LF', value('\n'), '', 'keep', false, 'keep'],
      ['a legacy newest family against a record naming G', value(`${G}\n`), '', 'keep', false, 'delete'],
      ['no prediction standing: a stale record left alone', value(`${G2}\n`), G, 'delete', false, 'none'],
      ['no prediction at all', absent, G, 'none', true, 'none'],
    ];
    for (const [name, current, generation, card, mayWrite, want] of rows) {
      expect(libCard.decideCardGenFile({ current, generation, card, mayWrite }), name).toBe(want);
    }
  });

  // D-5049 (history-card-gen-path-helper): the generation record's path is lib's checked helper's, like cardFileOf's.
  it('cardGenFileOf: the generation record beside the prediction, <uuid>.gen in the id\'s card directory; a bad id or uuid throws before any path is formed', () => {
    const home = '/home/u';
    const GU = '0189abcd-1234-4678-9abc-0000000000c1';
    expect(libCard.cardGenFileOf(home, 'demo-quiet-basin', GU)).toBe(libCard.cardFileOf(home, 'demo-quiet-basin', GU).replace(/\.txt$/, '.gen'));
    expect(libCard.cardGenFileOf(home, 'demo-quiet-basin', GU)).toBe(`${libCard.cardDirOf(home, 'demo-quiet-basin')}/${GU}.gen`);
    for (const id of ['.', '..', '../x', 'a/b', '', 'x'.repeat(225)]) {
      expect(() => libCard.cardGenFileOf(home, id, GU), id).toThrow(TypeError);
    }
    for (const uuid of [GU.toUpperCase(), `${GU}.txt`, '../x', '']) {
      expect(() => libCard.cardGenFileOf(home, 'demo-quiet-basin', uuid), uuid).toThrow(TypeError);
    }
  });
});

// ===========================================================================
// W1-B3 Task 3: card delivery, consumption-scope, withdrawal and purge decisions (spec §8.6 RV17, §9.4, §10.7 W1-e;
// rulings RC2 and RC3). Pure.
// ===========================================================================
describe('card delivery, scope, withdrawal, window and purge decisions (spec 8.6 RV17, 9.4, 10.7 W1-e; rulings RC2, RC3; W1-B3 Task 3)', () => {
  const ctx = (...content: unknown[]): Record<string, unknown> =>
    ({ type: 'hook_additional_context', content, hookName: 'SessionStart:compact' });
  const line = libCard.cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' });

  it('cardIdsIn finds the History id at a line start, after standing-card text on the same line, and inside nested string-array content', () => {
    expect(libCard.cardIdsIn(ctx(`${line}\nCompaction card: files touched.`))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx(`Graph: fixture. Hold: none. ${line}\nCompaction card: files touched.`))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx('first', ['nested', `x ${line}`]))).toEqual(['L03a9c1']);
    expect(libCard.cardIdsIn(ctx(`${line} ${libCard.cardLine({ leaf: 'L000001abc' })}`))).toEqual(['L000001abc', 'L03a9c1']);
  });

  it('cardIdsIn ignores a parent first, upper case, fewer than 6 hex, a longer word, another attachment type and a non-object', () => {
    for (const text of ['History: node N7c1e2f… (this compaction)', 'History: node L03A9C1… (this compaction)',
      'History: node L03a9c… (this compaction)', 'History: node L03a9c1x… (this compaction)']) {
      expect(libCard.cardIdsIn(ctx(text)), text).toEqual([]);
    }
    expect(libCard.cardIdsIn({ type: 'todo_reminder', content: [line] })).toEqual([]);
    for (const v of [null, line, [line], 7, undefined]) expect(libCard.cardIdsIn(v), String(v)).toEqual([]);
  });

  it('decideCardDelivery: served when an id prefixes the leaf, mismatch when ids name only others, none once the window closed empty, wait while it is open', () => {
    const leaf = `L03a9c1${'0'.repeat(13)}`;
    expect(libCard.decideCardDelivery({ ids: ['L03a9c1'], leafId: leaf, windowComplete: false })).toBe('served');
    expect(libCard.decideCardDelivery({ ids: ['Lffffff', 'L03a9c1'], leafId: leaf, windowComplete: false })).toBe('served');
    expect(libCard.decideCardDelivery({ ids: ['Lffffff'], leafId: leaf, windowComplete: false })).toBe('mismatch');
    expect(libCard.decideCardDelivery({ ids: [], leafId: leaf, windowComplete: true })).toBe('none');
    expect(libCard.decideCardDelivery({ ids: [], leafId: leaf, windowComplete: false })).toBe('wait');
  });

  it('cardWindowComplete: CARD_MEASURE_ROWS rows, the next boundary, the copy read to its end past the grace, a copy not live, or the wait bound closes it', () => {
    expect(libCard.CARD_MEASURE_ROWS).toBe(40);
    expect(libCard.CARD_MEASURE_MAX_WAIT_MS).toBe(24 * 60 * 60 * 1000);
    expect(libCard.CARD_ATTACHMENT_MAX_BYTES).toBe(1024 * 1024);
    const open = { live: true, rowsSeen: libCard.CARD_MEASURE_ROWS - 1, nextBoundary: false, eofAfter: false, waitedMs: 0 };
    expect(libCard.cardWindowComplete(open)).toBe(false);
    expect(libCard.cardWindowComplete({ ...open, rowsSeen: libCard.CARD_MEASURE_ROWS })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, nextBoundary: true })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, eofAfter: true })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, live: false })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, waitedMs: libCard.CARD_MEASURE_MAX_WAIT_MS })).toBe(true);
    expect(libCard.cardWindowComplete({ ...open, waitedMs: libCard.CARD_MEASURE_MAX_WAIT_MS - 1 })).toBe(false);
  });

  it('decidePurgedEntry: removes only a registry-absent entry older than 7 days; present, unmeasured, young or undated is kept', () => {
    const now = Date.UTC(2026, 9, 7);
    const old = now - libCard.PURGED_FILES_GRACE_MS - 1;
    const rows: Array<[string, 'present' | 'absent' | 'unmeasured', number | null, 'keep' | 'remove']> = [
      ['absent, 7 days and 1 ms', 'absent', old, 'remove'],
      ['absent, exactly 7 days', 'absent', now - libCard.PURGED_FILES_GRACE_MS, 'keep'],
      ['absent, 6 days', 'absent', now - 6 * 24 * 60 * 60 * 1000, 'keep'],
      ['present, 8 days', 'present', old, 'keep'],
      ['unmeasured, 8 days', 'unmeasured', old, 'keep'],
      ['absent, no time', 'absent', null, 'keep'],
    ];
    for (const [name, reg, newestMtimeMs, want] of rows) {
      expect(libCard.decidePurgedEntry({ reg, newestMtimeMs, nowMs: now }), name).toBe(want);
    }
  });

  it("decideConsumedScope folds the marker its compaction left: main inside the boundary's window, other for subagent or ambiguous there, unknown for anything else (ruling RC3)", () => {
    const U = '0189abcd-1234-4678-9abc-0000000000c3';
    const OTHER = '0189abcd-1234-4678-9abc-0000000000c4';
    const B = Date.UTC(2026, 9, 7, 12);
    const MAX = libCard.SCOPE_MARKER_MAX_AGE_MS;
    const v = (value: string): libCard.Presence<string> => ({ state: 'value', value });
    expect(MAX).toBe(1200 * 1000);
    expect(libCard.CARD_CONSUMED_SCOPES).toEqual(['main', 'other', 'unknown']);
    const rows: Array<[string, libCard.Presence<string>, number | null, libCard.CardConsumedScope]> = [
      ['main, a second before the boundary, with its LF', v(`main ${U} ${B - 1000}\n`), B, 'main'],
      ['main, at the boundary', v(`main ${U} ${B}`), B, 'main'],
      ['main, exactly the max age before', v(`main ${U} ${B - MAX}`), B, 'main'],
      ['main, older than the max age', v(`main ${U} ${B - MAX - 1}`), B, 'unknown'],
      ['main, after the boundary (a later PreCompact overwrote it)', v(`main ${U} ${B + 1}`), B, 'unknown'],
      ['ambiguous, a second before', v(`ambiguous ${U} ${B - 1000}`), B, 'other'],
      ['subagent, a second before', v(`subagent ${U} ${B - 1000}`), B, 'other'],
      ['ambiguous, after the boundary', v(`ambiguous ${U} ${B + 1}`), B, 'unknown'],
      ['another uuid', v(`main ${OTHER} ${B - 1000}`), B, 'unknown'],
      ['emptied by a later main PreCompact', v(''), B, 'unknown'],
      ['a non-numeric ms', v(`main ${U} soon`), B, 'unknown'],
      ['a word the hook never writes', v(`card ${U} ${B - 1000}`), B, 'unknown'],
      ['a second line', v(`main ${U} ${B - 1000}\nmain ${U} ${B - 1000}\n`), B, 'unknown'],
      ['absent', { state: 'absent' }, B, 'unknown'],
      ['unreadable', { state: 'unreadable' }, B, 'unknown'],
      ['no boundary time', v(`main ${U} ${B - 1000}`), null, 'unknown'],
    ];
    for (const [name, marker, boundaryTsMs, want] of rows) {
      expect(libCard.decideConsumedScope({ marker, uuid: U, boundaryTsMs }), name).toBe(want);
    }
  });

  it("consumedBoundaryTs names the boundary whose span the file printed: the first for a first-row prediction, a later one by its predecessor's head (its uuid with none); null for no card line, no epoch, or no boundary yet (ruling RC3)", () => {
    const ID = 'demo-quiet-basin';
    const U = '0189abcd-1234-4678-9abc-0000000000c5';
    const bs: libCard.CardBoundaryAt[] = [
      { uuid: 'b-1', headUuid: 'h-1', tsMs: 1000 }, { uuid: 'b-2', headUuid: null, tsMs: 2000 }, { uuid: 'b-3', headUuid: 'h-3', tsMs: 3000 },
    ];
    const prefixOf = (start: string): string => libCard.leafId(ID, U, start).slice(0, 7);
    const fileOf = (start: string): libCard.Presence<string> => ({ state: 'value', value: `${libCard.cardLine({ leaf: prefixOf(start) })}\n` });
    const at = (current: libCard.Presence<string>, ccrcId: string | null = ID): number | null =>
      libCard.consumedBoundaryTs({ current, ccrcId, ccUuid: U, firstRowUuid: 'r-first', boundaries: bs });
    expect(new Set(['r-first', 'h-1', 'b-2', 'h-3'].map(prefixOf)).size, 'CONTROL: the four fixture leaves differ in their first 7 characters').toBe(4);
    expect(at(fileOf('r-first'))).toBe(1000);
    expect(at(fileOf('h-1'))).toBe(2000);
    expect(at(fileOf('b-2')), 'b-2 has no head: its own uuid starts the next span').toBe(3000);
    expect(at(fileOf('h-3')), "the next compaction's prediction: no boundary consumed it yet").toBeNull();
    expect(at({ state: 'value', value: 'free text\n' })).toBeNull();
    expect(at({ state: 'absent' })).toBeNull();
    expect(at(fileOf('r-first'), null), 'no epoch names the session').toBeNull();
  });

  it('decideCardWithdraw names a reason for every pass that runs no card step, and keeps the predictions only when the step ran over a caught-up ingest (ruling RC2)', () => {
    const run = (o: { pause?: 'at-cap' | 'low-disk' | null; floorStop?: boolean; ingested?: boolean; budgetLeft?: boolean }): libCard.CardPassFacts =>
      ({ arm: 'run', pause: null, floorStop: false, ingested: true, budgetLeft: true, ...o });
    const rows: Array<[string, libCard.CardPassFacts, libCard.CardWithdrawReason]> = [
      ['a cap pause', run({ pause: 'at-cap' }), 'at-cap'],
      ['a floor pause', run({ pause: 'low-disk' }), 'low-disk'],
      ['a per-chunk floor stop', run({ floorStop: true }), 'floor-stop'],
      ['an ingest an unreadable roster skipped', run({ ingested: false }), 'roster-unreadable'],
      ['a budget spent before the card step', run({ budgetLeft: false }), 'budget'],
      ['a floor pause with the budget spent too: the pause names it', run({ pause: 'low-disk', budgetLeft: false }), 'low-disk'],
      ['the recover arm', { arm: 'recover' }, 'recovering'],
      ['the migrate arm', { arm: 'migrate' }, 'migrating'],
      ['a writer token still to come', { arm: 'hold', word: 'held' }, 'held'],
      ['a migration held for room', { arm: 'hold', word: 'migration-refused' }, 'held'],
      ['a migration that waits on the operator (doctor --migrate)', { arm: 'hold', word: 'migration-needs-op' }, 'held'],
      ['a volume that did not answer', { arm: 'hold', word: 'store-unreachable' }, 'unreachable'],
      ['a store.id naming another store', { arm: 'hold', word: 'store-mismatch' }, 'refused'],
      ['a newer schema', { arm: 'hold', word: 'schema-newer' }, 'refused'],
      ['a DB no store.id binds', { arm: 'hold', word: 'store-unbound' }, 'unbound'],
    ];
    for (const [name, pass, reason] of rows) expect(libCard.decideCardWithdraw(pass), name).toEqual({ act: 'withdraw', reason });
    expect(libCard.decideCardWithdraw(run({})), 'the card step ran over a caught-up ingest').toEqual({ act: 'keep' });
    expect([...new Set(rows.map(([, , r]) => r))].sort(), 'every reason word is reached, and none outside the vocabulary')
      .toEqual([...libCard.CARD_WITHDRAW_REASONS].sort());
    expect(() => libCard.decideCardWithdraw({ arm: 'off' } as unknown as libCard.CardPassFacts)).toThrow(/^decideCardWithdraw: not a pass arm/);
  });
});

// ===========================================================================
// W1-B3 Task 4: derive.mjs's level-0 slot lists, exported unchanged (spec 6.3, ruling RB4). In-process, against a
// store built by hand in the shape of B2's epochFixture9: one family, one confirmed epoch, one main transcript whose
// boundaries are held by live file 1, file 2 or both.
// ===========================================================================
interface Derive4 {
  epochCopySlots(db: DatabaseSync, sessionPk: number, epochSeq: number): Map<number, Array<string | null>>;
  holdingCopyOf(db: DatabaseSync, b: { entry_id: number; transcript_pk: number }): { file_id: number; eof_ms: number | null; source_key: string } | null;
  epochOfUuid(db: DatabaseSync, ccUuid: string): { session_pk: number; seq: number; ccrc_id: string } | null;
  deriveParents(db: DatabaseSync, ictx: object, budget: object): number;
}
const derive4 = async (): Promise<Derive4> => (await import('../../ccd/history/derive.mjs')) as unknown as Derive4;
const sweep4 = async (): Promise<{ newBudget(): object }> => (await import('../../ccd/history/sweep.mjs')) as unknown as { newBudget(): object };
const E4 = 'd4e00000-1111-4111-8111-111111111111';
const uid4 = (n: number): string => `d4e00000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** `n` boundaries in one transcript, boundary k held by the live files `holders(k)` names, each with a native leaf. */
function forkStore4(n: number, holders: (k: number) => readonly number[]): { db: DatabaseSync; leafIds: string[] } {
  const home = mkTmp('ccrc-hist-card-slots-');
  createStore(home);
  const db = openWriter(libCard.historyPaths(home).dbFile);
  const leafIds: string[] = [];
  db.exec('BEGIN');
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'card-slots', '', 'demo', 1)").run();
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E4);
  db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(E4);
  const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (?, 1, ?, 1, 'live', 1)");
  file.run(1, 4001);
  file.run(2, 4002);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 4), Buffer.from([0]));
  const ent = db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'system', 'compact_boundary', 'harness', 1, 0, 0, 1, ?)");
  const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, 1, ?)');
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  const leaf = db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, boundary_entry_id, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'not-requested', ?, ?, ?, ?, 100, 0, 0, 1, 1)");
  for (let k = 1; k <= n; k += 1) {
    ent.run(k, uid4(k), 1000 * k);
    bnd.run(k, k);
    for (const f of holders(k)) member.run(f, k, k);
    const id = libCard.leafId('card-slots', E4, `span-${k}`);
    leafIds.push(id);
    leaf.run(id, `Leaf ${k} did part ${k}.`, k, 1000 * k, 1000 * k + 500);
  }
  db.exec('COMMIT');
  return { db, leafIds };
}

/** Boundaries 1-3 in both copies (a shared head: the smaller file_id holds it), 4-9 in file 1 only, 10-17 in file 2. */
const FORKED4 = (k: number): readonly number[] => (k <= 3 ? [1, 2] : k <= 9 ? [1] : [2]);

describe('derive.mjs exports the slot lists fan-in reads, unchanged (spec 6.3, ruling RB4; W1-B3 Task 4)', () => {
  it("epochCopySlots splits one epoch's level-0 slots per holding copy, in ord; holdingCopyOf picks a live copy, then the smaller file_id", async () => {
    const d = await derive4();
    const fx = forkStore4(17, FORKED4);
    try {
      const slots = d.epochCopySlots(fx.db, 1, 1);
      expect([...slots.keys()].map(Number).sort((x, y) => x - y)).toEqual([1, 2]);
      expect(slots.get(1)).toEqual(fx.leafIds.slice(0, 9));
      expect(slots.get(2)).toEqual(fx.leafIds.slice(9));
      expect(Number(d.holdingCopyOf(fx.db, { entry_id: 2, transcript_pk: 1 })!.file_id)).toBe(1);
      expect(Number(d.holdingCopyOf(fx.db, { entry_id: 12, transcript_pk: 1 })!.file_id)).toBe(2);
      expect(d.holdingCopyOf(fx.db, { entry_id: 99, transcript_pk: 1 })).toBeNull();
    } finally {
      fx.db.close();
    }
  });

  it("the parents deriveParents mints are exactly parentId over planFanIn's groups of those lists: the card's prediction and fan-in read one list", async () => {
    const d = await derive4();
    const s = await sweep4();
    const fx = forkStore4(17, FORKED4);
    try {
      const want = [...d.epochCopySlots(fx.db, 1, 1).values()].flatMap((list) => libCard.planFanIn({
        slots: list.map((nodeId) => ({ nodeId, final: nodeId !== null, parented: false })), width: libCard.FAN_IN.leaf,
      })).map((g) => [libCard.parentId(g), g] as const);
      expect(want.map(([, g]) => g), 'one group per copy, never one across the fork').toEqual([fx.leafIds.slice(0, 8), fx.leafIds.slice(9, 17)]);
      d.deriveParents(fx.db, { nowMs: 5_000, fts: false, pairIdx: libCard.makePairIndex([]) }, s.newBudget());
      const made = (fx.db.prepare('SELECT node_id FROM nodes WHERE depth = 1 ORDER BY node_id').all() as Array<{ node_id: string }>).map((r) => r.node_id);
      expect(made).toEqual(want.map(([id]) => id).sort());
      for (const [id, g] of want) {
        const kids = (fx.db.prepare('SELECT child_id FROM node_children WHERE node_id = ? ORDER BY ord').all(id) as Array<{ child_id: string }>).map((r) => r.child_id);
        expect(kids, id).toEqual(g);
      }
    } finally {
      fx.db.close();
    }
  });

  it('epochOfUuid answers the epoch row of a confirmed uuid of an unmerged family, and null for an unknown uuid: the one epoch rule derivation and the card share (D-5052)', async () => {
    const d = await derive4();
    const fx = forkStore4(1, () => [1]);
    try {
      const row = d.epochOfUuid(fx.db, E4);
      expect(row).not.toBeNull();
      expect({ session_pk: Number(row!.session_pk), seq: Number(row!.seq), ccrc_id: row!.ccrc_id }).toEqual({ session_pk: 1, seq: 1, ccrc_id: 'card-slots' });
      expect(d.epochOfUuid(fx.db, 'd4e00000-9999-4999-8999-999999999999')).toBeNull();
    } finally {
      fx.db.close();
    }
  });
});
