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
import { compactionSequence, sessionStartAttachment, userRow, type Row } from './historyFixtures.js';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { brotli, closeWriter, createStore, openWriter } from '../../ccd/history/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeHistoryBox, runSweep, runDriver, plantSession, plantTranscript, spoolLine, openStoreRO, counters, skipOnDarwin,
  recoverRow, rewindStoreToV1, PRELOADS, type DriverDeps, type HistoryBox,
} from './historyHelpers.js';

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
      // Card-like near misses are no card line (cardLeafOf is the positive grammar, not the prefix): replaced at
      // end-of-file, removed otherwise, never kept and never a consumption. Each reads as a card line, or throws, if the
      // grammar is loosened to the prefix or to the leaf's start.
      ['a card-like line with a node and no leaf grammar, off end-of-file', value('History: node Lzzzz\n'), now, false, { act: 'delete', consumed: false }],
      ['a card line cut short after its leaf, off end-of-file', value(`${lineOf(leaf).slice(0, 'History: node L000000… (this compaction)'.length)}\n`), now, false, { act: 'delete', consumed: false }],
      ['a card line with trailing words, the leaf moved, off end-of-file', value(`${lineOf(leaf)} and more\n`), moved, false, { act: 'delete', consumed: false }],
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
      ['a session whose transcript copy the pass skipped (D-5061)', { arm: 'copy', uuid: 'u-1', skipped: ['u-0', 'u-1'] }, 'copy-skipped'],
    ];
    for (const [name, pass, reason] of rows) expect(libCard.decideCardWithdraw(pass), name).toEqual({ act: 'withdraw', reason });
    expect(libCard.decideCardWithdraw(run({})), 'the card step ran over a caught-up ingest').toEqual({ act: 'keep' });
    expect(libCard.decideCardWithdraw({ arm: 'copy', uuid: 'u-2', skipped: ['u-0', 'u-1'] }), "another session's copy was skipped: its line stands").toEqual({ act: 'keep' });
    expect(libCard.decideCardWithdraw({ arm: 'copy', uuid: 'u-1', skipped: [] }), 'no copy was skipped').toEqual({ act: 'keep' });
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

// ===========================================================================
// W1-B3 Tasks 5-7: the sweep's card work through REAL passes. Each box is a fixture HOME; a session is planted as
// B2's derivation tests plant one (registry rows, a transcript in compactionSequence's measured shape, the
// SessionStart(startup) line the hook spools), and sweep.mjs runs as the shim would. A Stop line spooled before a
// pass hints its session, so that pass reads the transcript to its end: the end-of-file a prediction is written at.
// ===========================================================================
const CARD_SLUG = '-home-u-worktrees-p-card-demo';
const CARD_GEN = '0189abcd-1234-4678-9abc-0000000000c0';
/** A day before now: every raw-leaf grace (lib RAW_LEAF_GRACE_MS) is long past, so a boundary read to the end is final. */
const T0C = Date.now() - 86_400_000;
/** The filesystem the statfs seam describes for a floor-pause case, and lib's own floor over it (never retyped). */
const FS_C = 10 * 1024 ** 3;
const FLOOR_C = libCard.floorThreshold(FS_C);
const sidC = (n: number): string => `0189abcd-1234-4678-9abc-${n.toString(16).padStart(12, '0')}`;
type SeqC = ReturnType<typeof compactionSequence>;
/** The index of boundary k in a sequence's rows: rows.slice(0, it) is the transcript just before compaction k. */
const cutBefore = (s: SeqC, k: number): number => s.rows.findIndex((r) => r['uuid'] === s.boundaryUuids[k]);
const firstUuidC = (s: SeqC): string => String(s.rows[0]!['uuid']);

/** One session: its registry rows (generation CARD_GEN), its transcript under `account`, and the SessionStart(startup)
 *  line whose `reg` is its sid, so the drain confirms the epoch on the line's own evidence. Returns the transcript. */
function plantC(box: HistoryBox, id: string, uuid: string, rows: readonly Row[], account = 'claude'): string {
  plantSession(box, id, { uuid, generation: CARD_GEN, project: 'demo', workdir: '/home/u/worktrees/p/card-demo' });
  const p = plantTranscript(box, account, CARD_SLUG, uuid, [...rows]);
  spoolLine(box, id, { v: 1, ev: 'SessionStart', id, sid: uuid, src: 'startup', reg: uuid, gen: CARD_GEN });
  return p;
}
function passC(box: HistoryBox): void {
  const r = runSweep(box);
  expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
}
/** B2's settle: pass 1 makes the store, runs the first registry scan (each registry-named session gets a confirmed
 *  `import` epoch and its transcript is ingested and derived in that tick) and renames the spool; pass 2 drains the
 *  SessionStart lines; pass 3 is one more. Rows planted BEFORE a boundary leave the store empty of nodes through pass 1. */
function settleC(box: HistoryBox): void {
  for (let i = 0; i < 3; i += 1) passC(box);
}
/** A Stop line per id, then one pass: that pass reads each id's transcripts to their end. */
function pokeC(box: HistoryBox, ...ids: string[]): void {
  for (const id of ids) spoolLine(box, id, { v: 1, ev: 'Stop', id });
  passC(box);
}
/** `pokeC`, through the run-pass driver: the same Stop lines and one pass, with `deps` injected into it (a read fault, a parser crash). */
function pokeDrivenC(box: HistoryBox, deps: DriverDeps, ids: readonly string[]): void {
  for (const id of ids) spoolLine(box, id, { v: 1, ev: 'Stop', id });
  const r = runDriver(box, deps);
  expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
}
/** B2 holds a session's leaves while a spool file this tick renamed is unread (derive.mjs deriveOne, pendingReceiptState),
 *  so a boundary a Stop-hinted pass ingested gets its leaf (and its parents) on the NEXT pass: the cases wait one plain
 *  pass. That pass reads no transcript to its end, so it writes no card, but it can still consume or delete one
 *  (a prediction written on the hinted pass can predate the leaf it ingested). D-5058 (history-card-predicted-under-the-receipt-hold) */
function derivedC(box: HistoryBox): void {
  passC(box);
}
function appendRows(p: string, rows: readonly Row[]): void {
  fs.appendFileSync(p, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}
const cardPath = (box: HistoryBox, id: string, uuid: string): string => path.join(box.root, 'card', id, `${uuid}.txt`);
const cardOf = (box: HistoryBox, id: string, uuid: string): string | null =>
  (fs.existsSync(cardPath(box, id, uuid)) ? fs.readFileSync(cardPath(box, id, uuid), 'utf8') : null);
function qC<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as unknown as T[]; } finally { db.close(); }
}
/** A transcript's leaves, in boundary order. */
const leavesC = (box: HistoryBox, uuid: string): string[] => qC<{ node_id: string }>(box,
  `SELECT n.node_id FROM nodes n JOIN boundaries b ON b.entry_id = n.boundary_entry_id
   JOIN transcripts t ON t.transcript_pk = n.transcript_pk WHERE t.cc_session_uuid = ? AND n.depth = 0 ORDER BY b.ord`, uuid)
  .map((r) => r.node_id);
const childrenC = (box: HistoryBox, nodeId: string): string[] => qC<{ child_id: string }>(box,
  'SELECT child_id FROM node_children WHERE node_id = ? ORDER BY ord', nodeId).map((r) => r.child_id);
/** Every node of a session id's families: the set a card's display prefixes are unique within. */
const familyC = (box: HistoryBox, id: string): string[] => qC<{ node_id: string }>(box,
  'SELECT n.node_id FROM nodes n JOIN sessions s ON s.session_pk = n.session_pk WHERE s.ccrc_id = ?', id).map((r) => r.node_id);
/** Every consumption counter, scoped or not (ruling RC3): a bare `card_consumed` would show here too. A case that
 *  plants no scope marker expects `card_consumed:unknown`. */
const consumedC = (box: HistoryBox): Record<string, number> =>
  Object.fromEntries(Object.entries(counters(box)).filter(([k]) => k === 'card_consumed' || k.startsWith('card_consumed:')));
/** The text a correct prediction file holds: lib's line over the family's display prefixes, and one LF. */
const expectedCard = (family: readonly string[], leaf: string, parent: string | null = null): string => {
  const shown = libCard.displayPrefixes([...family, leaf, ...(parent === null ? [] : [parent])]);
  return `${libCard.cardLine({ leaf: shown.get(leaf)!, parent: parent === null ? null : shown.get(parent)! })}\n`;
};
/** The leaf and parent prefixes a card file prints. */
const printed = (text: string): { leaf: string; parent: string | null } => {
  const m = /^History: node (L[0-9a-f]{6,20})… \(this compaction\)(?: · parent (N[0-9a-f]{6,20})…)?/.exec(text);
  if (m === null) throw new Error(`not a card line: ${text}`);
  return { leaf: m[1]!, parent: m[2] ?? null };
};

describe('the sweep writes and consumes card/<id>/<uuid>.txt at end-of-file (spec 8.6 Timing, 9.2 step 6; W1-B3 Task 5)', () => {
  skipOnDarwin();

  it("the first compaction: the card names the epoch's first leaf and no parent; ingested, that is the leaf derivation mints, and the next prediction replaces the consumed one", () => {
    const box = makeHistoryBox('ccrc-hist-card-first-');
    const [ID, U] = ['card-first', sidC(0xf1)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf1, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    const card0 = cardOf(box, ID, U);
    expect(card0).toBe(expectedCard([], want0));
    expect(printed(card0!).parent).toBeNull();
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U)).toEqual([want0]);
    expect(want0.startsWith(printed(card0!).leaf), 'derivation minted the leaf the card printed').toBe(true);
    expect(consumedC(box), 'no scope marker beside it: counted unknown').toEqual({ 'card_consumed:unknown': 1 });
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
  }, 240_000);

  it("the 8th leaf of a run: the card names its depth-1 parent, which derivation then mints over the same 8 leaves; after it, the epoch's newest condensed node", () => {
    const box = makeHistoryBox('ccrc-hist-card-eighth-');
    const [ID, U] = ['card-eighth', sidC(0xf2)];
    const s = compactionSequence({ n: 8, trigger: 'auto', seed: 0xf2, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 7)));
    settleC(box);
    pokeC(box, ID);
    const seven = leavesC(box, U);
    expect(seven).toHaveLength(7);
    const l7 = libCard.leafId(ID, U, s.headUuids[6]!);
    const P = libCard.parentId([...seven, l7]);
    const card = cardOf(box, ID, U)!;
    expect(card).toBe(expectedCard(seven, l7, P));
    appendRows(p, s.rows.slice(cutBefore(s, 7)));
    pokeC(box, ID);
    // B2's receipt hold has not derived l7 yet, so its slot is not final and ends the run: the card on this hinted pass
    // names l8 with no parent (and no condensed node exists yet). D-5058 (history-card-predicted-under-the-receipt-hold)
    const l8 = libCard.leafId(ID, U, s.headUuids[7]!);
    expect(cardOf(box, ID, U), 'the hinted pass predates l7 and its parent: l8, parentless').toBe(expectedCard(familyC(box, ID), l8));
    derivedC(box);
    // The card written on the hinted pass predates the leaf and the parent it names next; the next hinted pass writes it.
    pokeC(box, ID);
    expect(leavesC(box, U)).toEqual([...seven, l7]);
    expect(childrenC(box, P), 'derivation minted the predicted parent over the same eight leaves').toEqual([...seven, l7]);
    expect(P.startsWith(printed(card).parent!)).toBe(true);
    expect(cardOf(box, ID, U), 'the next leaf is no 8th: the newest condensed node is named').toBe(expectedCard(familyC(box, ID), l8, P));
  }, 240_000);

  it('a leaf not final in the run stops the prediction: no predicted parent and, with no condensed node, no parent at all', () => {
    const box = makeHistoryBox('ccrc-hist-card-gap-');
    const [ID, U] = ['card-gap', sidC(0xf3)];
    // Rows two minutes old: boundary 3, its summary row dropped, is inside the raw-leaf grace, so it has no leaf yet.
    const s = compactionSequence({ n: 8, trigger: 'manual', seed: 0xf3, sessionId: U, startMs: Date.now() - 120_000 });
    plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 7)).filter((r) => r['uuid'] !== s.summaryUuids[3]));
    settleC(box);
    pokeC(box, ID);
    const leaves = leavesC(box, U);
    expect(leaves, 'six leaves; boundary 3 waits').toHaveLength(6);
    expect(cardOf(box, ID, U)).toBe(expectedCard(leaves, libCard.leafId(ID, U, s.headUuids[6]!)));
  }, 240_000);

  it('a next leaf the fork rule would qualify: no card, counted card_skipped:fork-qualified; CONTROL: the same copy with no other fork gets one', () => {
    const box = makeHistoryBox('ccrc-hist-card-fork-');
    const [ID, U] = ['card-fork', sidC(0xf4)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf4, sessionId: U, startMs: T0C });
    const other = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xf5, sessionId: U, startMs: T0C + 600_000 });
    // Copy A (the first account's home) compacted again after pre's head; copy B (the second's) did not, and is the
    // copy written last.
    const a = plantTranscript(box, 'claude', CARD_SLUG, U, [...pre.rows, ...other.rows]);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(a, hourAgo, hourAgo);
    plantC(box, ID, U, [...pre.rows, userRow({ uuid: sidC(0xbf4), ts: new Date(T0C + 900_000).toISOString(), sessionId: U, text: 'fork b' })], 'claude-a');
    const [ID2, U2] = ['card-fork-control', sidC(0xf6)];
    const pre2 = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf6, sessionId: U2, startMs: T0C });
    plantC(box, ID2, U2, pre2.rows, 'claude-a');
    settleC(box);
    pokeC(box, ID, ID2);
    expect(leavesC(box, U), "copy A's second boundary holds the plain id of the span B would start next").toContain(libCard.leafId(ID, U, pre.headUuids[0]!));
    expect(cardOf(box, ID, U)).toBeNull();
    expect(counters(box)['card_skipped:fork-qualified']).toBeGreaterThanOrEqual(1);
    expect(cardOf(box, ID2, U2), 'CONTROL').toBe(expectedCard(familyC(box, ID2), libCard.leafId(ID2, U2, pre2.headUuids[0]!)));
  }, 240_000);

  it('a consumed prediction whose next leaf the fork rule would qualify: deleted and still counted card_consumed', () => {
    const box = makeHistoryBox('ccrc-hist-card-fork-consumed-');
    const [ID, U] = ['card-fork-consumed', sidC(0xf5c)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf5c, sessionId: U, startMs: T0C });
    const other = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xf5d, sessionId: U, startMs: T0C + 600_000 });
    const head = pre.rows.slice(0, cutBefore(pre, 0));
    // Copies A (the first account's home) and B (the second's: the registry's session, written last) start equal,
    // before pre's boundary, so B's first prediction is the epoch's first leaf, bound nowhere yet.
    const a = plantTranscript(box, 'claude', CARD_SLUG, U, [...head]);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(a, hourAgo, hourAgo);
    const b = plantC(box, ID, U, head, 'claude-a');
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(pre));
    expect(cardOf(box, ID, U), 'the first prediction, before any boundary').toBe(expectedCard([], want0));
    // A compacts at pre's boundary and again after its head; B compacts at pre's boundary only and stays the copy
    // written last. B's next span starts at pre's head, whose plain id A's second boundary holds. Both boundaries must
    // be ingested, and A's leaves derived, on ONE pass, with B's prediction still on disk: a Stop-hinted pass cannot
    // (B2's receipt hold derives the session's leaf a pass after the ingest, and the plain pass that derives it would
    // delete B's prediction as a fork skip, uncounted). So the ingest here is the periodic discovery scan, which needs
    // no hint and leaves no draining file: the Stop line is drained first and the scan clock (`scan_discover_ms`) reset.
    passC(box);
    appendRows(a, [...pre.rows.slice(cutBefore(pre, 0)), ...other.rows]);
    fs.utimesSync(a, hourAgo, hourAgo);
    appendRows(b, [...pre.rows.slice(cutBefore(pre, 0)),
      userRow({ uuid: sidC(0xbf5c), ts: new Date(T0C + 900_000).toISOString(), sessionId: U, text: 'fork b' })]);
    const w = openWriter(libCard.historyPaths(box.home).dbFile);
    try { w.prepare("DELETE FROM meta WHERE k = 'scan_discover_ms'").run(); } finally { closeWriter(w); }
    const [written, skipped] = [counters(box)['card_written'] ?? 0, counters(box)['card_skipped:fork-qualified'] ?? 0];
    passC(box);
    expect(leavesC(box, U), 'derivation minted the leaf the first card printed, on the pass that ingested it').toContain(want0);
    expect(leavesC(box, U), "CONTROL: A's second boundary holds the plain id of B's next span, derived on the same pass")
      .toContain(libCard.leafId(ID, U, pre.headUuids[0]!));
    expect(counters(box)['card_skipped:fork-qualified'], 'the pass met the fork skip').toBe(skipped + 1);
    expect(counters(box)['card_written'] ?? 0, "no card written in the consumed one's place").toBe(written);
    expect(cardOf(box, ID, U), 'the consumed prediction is deleted, and none is written in its place').toBeNull();
    expect(fs.readdirSync(path.join(box.root, 'card', ID)), 'no .txt left; the id keeps no card').not.toContain(`${U}.txt`);
    expect(consumedC(box), 'the consumption is counted though the next prediction is a skip').toEqual({ 'card_consumed:unknown': 1 });
  }, 240_000);

  it("a spooled fork (ruled Q16): once B2's fork line confirms the fork's epoch, its card starts at the head of the parent's boundary its copy holds, derivation mints that leaf, and the fork's prediction replaces the parent's", () => {
    const box = makeHistoryBox('ccrc-hist-card-forked-');
    const [ID, U, UF] = ['card-forked', sidC(0xfb1), sidC(0xfb2)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xfb1, sessionId: U, startMs: T0C });
    const own = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0xfb2, sessionId: UF, startMs: T0C + 600_000 });
    plantC(box, ID, U, pre.rows);
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U), "CONTROL: the parent's prediction").toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, pre.headUuids[0]!)));
    // An in-pane /branch (spec 6.1): a fresh sid whose transcript copies the parent's rows verbatim, so each is one
    // entry with a membership in each file, and the parent's boundary stays the parent transcript's. The hook's line
    // carries the parent's uuid as `reg` (it fires before _sync_uuid moves .uuid), and .uuid names the fork before the
    // sweep observes the line, so the fork epoch confirms by the observation, as a resume line would.
    plantSession(box, ID, { uuid: UF });
    const f = plantTranscript(box, 'claude', CARD_SLUG, UF, [...pre.rows]);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: UF, src: 'fork', reg: U, gen: CARD_GEN });
    settleC(box);
    pokeC(box, ID);
    expect(qC<{ cause: string; declared_by: string }>(box,
      'SELECT cause, declared_by FROM epochs WHERE cc_session_uuid = ? AND confirmed_ms IS NOT NULL', UF)
      .map((r) => `${r.cause}/${r.declared_by}`), "CONTROL: B2's fork line chained a confirmed fork epoch").toEqual(['fork/hook']);
    const wantF = libCard.leafId(ID, UF, pre.headUuids[0]!);
    expect(cardOf(box, ID, UF), "the fork's next leaf starts at the head of the parent's boundary its copy holds")
      .toBe(expectedCard(familyC(box, ID), wantF));
    expect(cardOf(box, ID, U), "one prediction per id: the parent's is removed").toBeNull();
    expect(consumedC(box), 'a removal is no consumption').toEqual({});
    appendRows(f, own.rows);
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, UF), 'derivation minted the leaf the card printed').toEqual([wantF]);
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    expect(cardOf(box, ID, UF), "the fork's own boundary starts its next span")
      .toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, UF, own.headUuids[0]!)));
  }, 240_000);

  it('the end-of-file gate: a torn last line holds the write; a boundary ingested on a pass that ends short of end-of-file consumes and deletes the prediction', () => {
    const box = makeHistoryBox('ccrc-hist-card-eof-');
    const [ID, U] = ['card-eof', sidC(0xf7)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0xf7, sessionId: U, startMs: T0C });
    /** One whole row's JSON with no LF after it: a line still being written. */
    const torn = (n: number): string => JSON.stringify(userRow({ uuid: sidC(0xbf70 + n), ts: new Date(T0C + 3_600_000 + n).toISOString(), sessionId: U, text: `still being written ${n}` }));
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    fs.appendFileSync(p, torn(1));
    settleC(box);
    pokeC(box, ID);
    expect(leavesC(box, U), 'boundary 0 is final: its leaf exists').toHaveLength(1);
    expect(cardOf(box, ID, U), 'never at end-of-file: no prediction').toBeNull();
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
    appendRows(p, s.rows.slice(cutBefore(s, 1), cutBefore(s, 2)));
    fs.appendFileSync(p, torn(2));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U)).toHaveLength(2);
    expect(cardOf(box, ID, U), 'consumed short of end-of-file: deleted, not rewritten').toBeNull();
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it("the file: the line and one LF, 0600, in 0700 directories, one per id (a /clear's replaces the last), other names kept; a symlinked card/<id> refused and its target untouched", () => {
    const box = makeHistoryBox('ccrc-hist-card-file-');
    const [ID, U1, U2] = ['card-file', sidC(0xf8), sidC(0xf9)];
    plantC(box, ID, U1, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf8, sessionId: U1, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U1)).not.toBeNull();
    fs.writeFileSync(path.join(box.root, 'card', ID, 'notes'), "not the writer's");
    // A /clear: the registry names the new uuid, and the hook spools the clear line.
    const s2 = compactionSequence({ n: 1, trigger: 'manual', seed: 0xf9, sessionId: U2, startMs: T0C + 3_600_000 });
    plantSession(box, ID, { uuid: U2 });
    plantTranscript(box, 'claude', CARD_SLUG, U2, s2.rows);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U2, src: 'clear', gen: CARD_GEN });
    settleC(box);
    pokeC(box, ID);
    const f = cardPath(box, ID, U2);
    expect(fs.readFileSync(f, 'utf8')).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U2, s2.headUuids[0]!)));
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    for (const d of [path.join(box.root, 'card'), path.join(box.root, 'card', ID)]) expect(fs.statSync(d).mode & 0o777, d).toBe(0o700);
    // U1's prediction and its generation record went with the write; U2's record stands beside its prediction.
    expect(fs.readdirSync(path.join(box.root, 'card', ID)).sort()).toEqual([`${U2}.gen`, `${U2}.txt`, 'notes']);
    const [ID3, U3] = ['card-link', sidC(0xfa)];
    plantC(box, ID3, U3, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfa, sessionId: U3, startMs: T0C }).rows);
    const target = path.join(box.home, 'elsewhere');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'kept');
    fs.symlinkSync(target, path.join(box.root, 'card', ID3));
    settleC(box);
    pokeC(box, ID3);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
    expect(fs.lstatSync(path.join(box.root, 'card', ID3)).isSymbolicLink()).toBe(true);
    expect(counters(box)['card_dir_refused']).toBeGreaterThanOrEqual(1);
  }, 240_000);

  it('only the session the registry names gets a prediction; one it no longer names is still consumed and deleted when its boundary is ingested', () => {
    const box = makeHistoryBox('ccrc-hist-card-reg-');
    const [ID, U] = ['card-reg', sidC(0xfd)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xfd, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
    fs.rmSync(path.join(box.reg, `${ID}.uuid`));
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U)).toHaveLength(2);
    expect(cardOf(box, ID, U), 'consumed, and not written again: the registry names no session').toBeNull();
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'still unnamed: still no prediction').toBeNull();
    plantSession(box, ID, { uuid: U });
    pokeC(box, ID);
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it.skipIf(process.getuid?.() === 0)('a card directory the sweep cannot write: counted card_write_failed, nothing written, and the pass still exits 0', () => {
    const box = makeHistoryBox('ccrc-hist-card-ro-');
    const [ID, U] = ['card-ro', sidC(0xfb)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfb, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    const dir = path.join(box.root, 'card', ID);
    // card/ exists once the sweep has ticked (Task 5's ensureHistoryDirs); made here too, so that before Task 5 the
    // case reds at card_write_failed rather than at an ENOENT from the mkdir below.
    fs.mkdirSync(path.join(box.root, 'card'), { recursive: true, mode: 0o700 });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { mode: 0o500 });
    try {
      pokeC(box, ID);
      expect(counters(box)['card_write_failed']).toBeGreaterThanOrEqual(1);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  }, 240_000);

  // The temp half is a CONTROL on B1's writeFileAtomic, which removes its own `<path>.tmp.<pid>` on any failure before
  // the rename: card.mjs unlinks no temp, so no card.mjs mutant reds it. The cleanup half is card.mjs's own guard.
  it("a card write that fails after its temp exists leaves no temp behind (CONTROL: B1's writeFileAtomic cleanup, not card.mjs); a cleanup that fails never loses the write's count", () => {
    const box = makeHistoryBox('ccrc-hist-card-temp-');
    const [ID, U] = ['card-temp', sidC(0xfe)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xfe, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    const dir = path.join(box.root, 'card', ID);
    fs.mkdirSync(path.join(box.root, 'card'), { recursive: true, mode: 0o700 });
    fs.rmSync(dir, { recursive: true, force: true });
    // A directory where the prediction goes: the temp is opened and written, and its rename fails (EISDIR).
    fs.mkdirSync(path.join(dir, `${U}.txt`), { recursive: true, mode: 0o700 });
    pokeC(box, ID);
    expect(counters(box)['card_write_failed']).toBeGreaterThanOrEqual(1);
    // The generation record is written first and lands (R-recalloff-parity); the prediction's rename then fails.
    expect(fs.readdirSync(dir).sort(), 'a failed write left its temp behind').toEqual([`${U}.gen`, `${U}.txt`]);
    // A directory under another uuid's card name: the write lands, and removing that name fails (unlink: EISDIR).
    fs.rmSync(path.join(dir, `${U}.txt`), { recursive: true });
    fs.mkdirSync(path.join(dir, `${sidC(0xff)}.txt`));
    const written = counters(box)['card_written'] ?? 0;
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'the write landed').not.toBeNull();
    expect(counters(box)['card_cleanup_failed']).toBeGreaterThanOrEqual(1);
    expect(counters(box)['card_written'], 'the write is counted although its cleanup failed').toBe(written + 1);
  }, 240_000);

  // D-5059 (history-card-consumed-write-fails-closed): a consumed prediction whose replacement write fails goes too.
  // The fault is the faults preload's ENOSPC on the first Buffer write to the prediction's temp (`<uuid>.txt.tmp.<pid>`):
  // the generation record, written first, is a different name and lands, so the record is unchanged and the write is the
  // only thing that fails. An unlink succeeds where that write met ENOSPC, which is the point.
  it('D-5059 consumed write failure: the consumed prediction is removed, counted card_write_failed once and card_consumed once, and a further failing pass counts no second consumption', () => {
    const box = makeHistoryBox('ccrc-hist-card-consumedfail-');
    const [ID, U] = ['card-cfail', sidC(0xf11)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf11, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    expect(cardOf(box, ID, U), 'CONTROL: the prediction stands').toBe(expectedCard([], want0));
    const gen = fs.readFileSync(path.join(box.root, 'card', ID, `${U}.gen`), 'utf8');
    const failing = (): void => {
      spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID });
      const r = runSweep(box, [], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: `${U}.txt.tmp` } });
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    };
    const before = counters(box);
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    failing();   // ingests boundary 0 at end-of-file: the new prediction would replace the consumed one, and cannot be written
    const after = counters(box);
    expect(cardOf(box, ID, U), 'the consumed line is gone, not served as the next compaction').toBeNull();
    expect(fs.existsSync(cardPath(box, ID, U)), 'and no temp or other name stands in its place').toBe(false);
    expect(fs.readFileSync(path.join(box.root, 'card', ID, `${U}.gen`), 'utf8'), 'the generation record is unchanged').toBe(gen);
    expect((after['card_write_failed'] ?? 0) - (before['card_write_failed'] ?? 0)).toBe(1);
    expect(consumedC(box)).toEqual({ 'card_consumed:unknown': 1 });
    expect(after['card_unrecorded_removed'] ?? 0, 'the record was acted on: this is no unrecorded removal').toBe(before['card_unrecorded_removed'] ?? 0);
    failing();   // the write still fails and nothing stands: nothing more is consumed
    expect(cardOf(box, ID, U)).toBeNull();
    expect(consumedC(box), 'consumed once').toEqual({ 'card_consumed:unknown': 1 });
    derivedC(box);
    expect(consumedC(box), 'and still once').toEqual({ 'card_consumed:unknown': 1 });
    pokeC(box, ID);   // CONTROL: with the fault gone the next prediction is written
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
  }, 240_000);

  // D-5061 (history-card-withdraw-on-a-skipped-copy), review 476 F1: a pass that cannot read ONE of a session's copies, or
  // whose admission refuses it, or whose parse of it crashes, did not see the boundary that copy may hold, so the standing
  // line (compaction k's) must not be served as compaction k+1's. The boundary is appended BEFORE the copy is spoiled, so
  // the copy holds the consuming boundary the pass cannot read. Another session's prediction, on a copy the pass did read,
  // stands. Three feeds make a copy skipped (ingestPath's admission refusal, ingestTick's D-4340 read-error catch, ingestPath's
  // parse crash), and each has its own case below (review 479 F2): the two ADMISSION cases spoil the file, the READ-ERROR and
  // PARSE-CRASH cases run the same real pass through the run-pass driver with a fault injected into it (the faults preload has
  // no read event, so run-pass.mjs carries the EIO and the crash). `restore` undoes the spoil; `fired` proves the fault ran.
  interface SpoiledCopy {
    restore: () => void;
    run?: (box: HistoryBox, ids: readonly string[]) => void;
    fired?: (after: Record<string, number>, before: Record<string, number>) => void;
  }
  const skippedCopyCase = (name: string, seed: number, spoil: (p: string, s: SeqC) => SpoiledCopy): void => {
    const box = makeHistoryBox(`ccrc-hist-card-skip-${name}-`);
    const [ID, U] = [`card-skip-${name}`, sidC(seed)];
    const [OID, OU] = [`card-skip-${name}-other`, sidC(seed + 1)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    plantC(box, OID, OU, compactionSequence({ n: 1, trigger: 'manual', seed: seed + 1, sessionId: OU, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID, OID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    expect(cardOf(box, ID, U), 'CONTROL: compaction 0 is served its prediction').toBe(expectedCard([], want0));
    const other = cardOf(box, OID, OU);
    expect(other, "CONTROL: the other session's prediction stands").not.toBeNull();
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));   // compaction 0 happens: the line is consumed
    const spoiled = spoil(p, s);
    const before = counters(box);
    const withdrawn = before['card_withdrawn:copy-skipped'] ?? 0;
    (spoiled.run ?? ((b, ids) => { pokeC(b, ...ids); }))(box, [ID, OID]);
    spoiled.restore();
    spoiled.fired?.(counters(box), before);
    expect(cardOf(box, ID, U), "the copy was not read: compaction 1 is not served compaction 0's leaf").toBeNull();
    expect(counters(box)['card_withdrawn:copy-skipped'] ?? 0, 'one prediction withdrawn, counted under the one word').toBe(withdrawn + 1);
    expect(cardOf(box, OID, OU), "another session's prediction on a copy the pass read stands").toBe(other);
    expect(consumedC(box), 'a withdrawal is no consumption').toEqual({});
    pokeC(box, ID, OID);   // the copy readable again: its boundary is ingested and the next prediction written
    derivedC(box);
    expect(cardOf(box, ID, U), 'CONTROL: the next pass at end-of-file writes the prediction for compaction 1')
      .toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
  };

  it.skipIf(process.getuid?.() === 0)("D-5061 the ADMISSION arm, EACCES at admitFile's open: an unreadable copy (mode 000) withdraws that session's prediction, counted card_withdrawn:copy-skipped, and no other", () => {
    skippedCopyCase('unreadable', 0xf31, (p) => {
      const mode = fs.statSync(p).mode & 0o777;
      fs.chmodSync(p, 0o000);
      return { restore: () => fs.chmodSync(p, mode) };
    });
  }, 240_000);

  it("D-5061 the ADMISSION arm, ELOOP and non_regular: a copy admission refuses (a link at the transcript's name) withdraws that session's prediction, counted card_withdrawn:copy-skipped, and no other", () => {
    skippedCopyCase('refused', 0xf33, (p) => {
      fs.renameSync(p, `${p}.real`);
      fs.symlinkSync(`${p}.real`, p);
      return { restore: () => { fs.rmSync(p); fs.renameSync(`${p}.real`, p); } };
    });
  }, 240_000);

  // Review 479 F2, D-4340's arm (ingestTick's catch, `skipped.add` after countAdmission): the copy is ADMITTED and a read of it
  // then fails with EIO. Mode 000 fails earlier, at admitFile's open (the case above), so this one injects the read error
  // into a real pass, as history-ingest's FR2-d case does into a tick.
  it('D-5061 the READ-ERROR arm (D-4340): an admitted copy whose read fails with EIO withdraws that session\'s prediction, counted card_withdrawn:copy-skipped, and no other', () => {
    skippedCopyCase('eio', 0xf35, (p) => ({
      restore: () => undefined,
      run: (box, ids) => { pokeDrivenC(box, { eioOnRead: path.basename(p) }, ids); },
      fired: (after, before) => {
        expect(after['file_unreadable'] ?? 0, 'the read error fired and was counted').toBeGreaterThan(before['file_unreadable'] ?? 0);
      },
    }));
  }, 240_000);

  // Review 479 F2, ingestPath's parse-crash feed (79ccc0332): the copy is admitted and read, and the parser throws on the chunk that
  // holds compaction 1's lines, so the cursor holds before the compaction-0 boundary the chunk carries. The throw is a sha256 hash
  // fed the text of a row after that boundary (run-pass.mjs's parserCrashOn), the one call prepareLines makes outside its own try.
  it('D-5061 the PARSE-CRASH arm: an admitted copy whose parse crashes withdraws that session\'s prediction, counted card_withdrawn:copy-skipped, and no other', () => {
    skippedCopyCase('crash', 0xf37, (_p, s) => {
      const crashOn = 'Segment 1 request 0.';
      expect(s.rows.some((r) => JSON.stringify(r).includes(crashOn)), 'the crash text is in the appended rows').toBe(true);
      return {
        restore: () => undefined,
        run: (box, ids) => { pokeDrivenC(box, { parserCrashOn: crashOn }, ids); },
        fired: (after, before) => {
          expect(after['parser_crash'] ?? 0, 'the parser crash fired and was counted').toBeGreaterThan(before['parser_crash'] ?? 0);
        },
      };
    });
  }, 240_000);

  // Review 476 F2(b): a consumed prediction in a card/<id> the sweep cannot write (mode 0500): the replacement write and the
  // fallback unlink both fail, so the consumed file STANDS. The failure is counted card_write_failed on every tick, and the
  // consumption is not counted while the file stands (the `gone &&` guard of the consumed arm), or card_consumed would
  // grow on every tick and deflate W1-e's served share. Once the mode is restored the next end-of-file pass writes and
  // counts the consumption exactly once.
  it.skipIf(process.getuid?.() === 0)('F2 a consumed prediction in a card/<id> that cannot be written or unlinked stands uncounted, and the pass after the mode is restored counts it exactly once', () => {
    const box = makeHistoryBox('ccrc-hist-card-consumed-stuck-');
    const [ID, U] = ['card-cstuck', sidC(0xf41)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0xf41, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    const line0 = expectedCard([], want0);
    expect(cardOf(box, ID, U), 'CONTROL: the prediction stands').toBe(line0);
    const dir = path.join(box.root, 'card', ID);
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    fs.chmodSync(dir, 0o500);
    try {
      let failed = counters(box)['card_write_failed'] ?? 0;
      for (let tick = 1; tick <= 3; tick += 1) {
        if (tick === 1) pokeC(box, ID); else passC(box);   // the first at end-of-file, the rest not
        expect(cardOf(box, ID, U), `tick ${tick}: the consumed line cannot be replaced or removed, so it stands`).toBe(line0);
        expect(counters(box)['card_write_failed'] ?? 0, `tick ${tick}: the failure is counted`).toBeGreaterThan(failed);
        failed = counters(box)['card_write_failed'] ?? 0;
        expect(consumedC(box), `tick ${tick}: a consumption is not counted while the file stands`).toEqual({});
      }
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    pokeC(box, ID);
    expect(consumedC(box), 'the mode restored: the consumption is counted once').toEqual({ 'card_consumed:unknown': 1 });
    expect(cardOf(box, ID, U), 'and the next prediction is written').toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[0]!)));
    passC(box);
    expect(consumedC(box), 'and still once').toEqual({ 'card_consumed:unknown': 1 });
  }, 240_000);

  // R-recalloff-parity (spec §9.7, §8.2, C68): when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation resolves a
  // generation, B2's CLI compares recall-off/<id> with the id's newest family's generation, which only the store knows.
  // The hook reads the record this writes instead (Task 9). The expectation is B2's own familiesOf over the fixture
  // store, folded as B2's readContext folds it under 'newest' (`own.length === 1 ? own[0].generation : ''`), never a
  // second spelling of the newest-family query.
  it('the generation record: beside each prediction the sweep records the generation the CLI resolves under newest, follows a newer or a legacy newest family, and a record it cannot write holds the prediction', async () => {
    const box = makeHistoryBox('ccrc-hist-card-gen-');
    const [ID, U] = ['card-gen', sidC(0xf10)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf10, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    const genPath = path.join(box.root, 'card', ID, `${U}.gen`);
    const recall = (await import('../../ccd/history/recall.mjs')) as unknown as {
      familiesOf(db: unknown, sel: object): ReadonlyArray<{ generation: string }>;
    };
    const cliGen = (): string => {
      const db = openStoreRO(box);
      try {
        const own = recall.familiesOf(db, { kind: 'family', id: ID, generation: null, project: null, workdir: null, workdirReal: null });
        return own.length === 1 ? own[0]!.generation : '';
      } finally {
        db.close();
      }
    };
    const setGen = (sql: string, ...args: (string | number)[]): void => {
      const w = openWriter(libCard.historyPaths(box.home).dbFile);
      try { w.prepare(sql).run(...args); } finally { closeWriter(w); }
    };
    expect(cardOf(box, ID, U), 'CONTROL: a prediction stands').not.toBeNull();
    expect(cliGen(), 'CONTROL: the newest family is the planted one').toBe(CARD_GEN);
    expect(fs.readFileSync(genPath, 'utf8'), 'the record is the generation the CLI resolves, and one LF').toBe(`${cliGen()}\n`);
    expect(fs.statSync(genPath).mode & 0o777).toBe(0o600);
    // A newer family of the same id (the id reused under another generation): the CLI resolves it now, and so must
    // the record, at the next write.
    const G2 = sidC(0xf11);
    setGen('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, ?, ?)', ID, G2, 'demo', Date.now());
    expect(cliGen(), 'CONTROL: the CLI resolves the newer family').toBe(G2);
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the next prediction stands').not.toBeNull();
    expect(fs.readFileSync(genPath, 'utf8'), 'the record follows the newest family').toBe(`${G2}\n`);
    // A legacy newest family: the CLI compares with '', and the record is one LF; a kept prediction refreshes it.
    const line = cardOf(box, ID, U);
    setGen("UPDATE sessions SET generation = '' WHERE ccrc_id = ? AND generation = ?", ID, G2);
    expect(cliGen(), 'CONTROL: the CLI resolves the legacy family').toBe('');
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the prediction is kept, not rewritten').toBe(line);
    expect(fs.readFileSync(genPath, 'utf8'), 'a legacy newest family is recorded as one LF').toBe('\n');
    // A record that cannot be written (a directory at its name): the prediction is not written beside it.
    fs.rmSync(cardPath(box, ID, U));
    fs.rmSync(genPath);
    fs.mkdirSync(genPath);
    const failed = counters(box)['card_write_failed'] ?? 0;
    const unrecorded = counters(box)['card_unrecorded_removed'] ?? 0;
    pokeC(box, ID);
    expect(counters(box)['card_write_failed'], 'the record write failed').toBe(failed + 1);
    expect(cardOf(box, ID, U), 'no prediction beside a record that could not be written').toBeNull();
    // The prediction was already gone, so the unlink beside the failed record removed nothing: no removal is counted
    // (review 476 F2: the `gone &&` guard of the unrecorded arm).
    expect(counters(box)['card_unrecorded_removed'] ?? 0, 'nothing was removed beside the record, so nothing is counted').toBe(unrecorded);
  }, 240_000);

  // R-recalloff-keep (the final check's R2): a record that is due beside a prediction that STANDS (kept, its line
  // unchanged) and cannot be acted on takes the prediction with it. A directory at the record's name is unreadable,
  // so the record is due: rewritten at end-of-file (writeFileAtomic's rename refuses a directory) and removed off it
  // (unlink refuses a directory), and both fail, while the prediction's own unlink succeeds: the ENOSPC shape, where
  // a write fails and an unlink does not. Root meets the same two refusals, so the case runs as root too. Off
  // end-of-file is a torn last line, as in the end-of-file gate case: the pass reads to it and stops short.
  it('a record that cannot be written or removed beside a kept prediction removes the prediction too, counted card_unrecorded_removed, at end-of-file and off it', () => {
    const box = makeHistoryBox('ccrc-hist-card-genkeep-');
    const [ID, U] = ['card-genkeep', sidC(0xf20)];
    const p = plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf20, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const genPath = path.join(box.root, 'card', ID, `${U}.gen`);
    const line = cardOf(box, ID, U);
    expect(line, 'CONTROL: a prediction stands').not.toBeNull();
    expect(fs.readFileSync(genPath, 'utf8'), 'CONTROL: its record stands').toBe(`${CARD_GEN}\n`);
    const removed = (): number => counters(box)['card_unrecorded_removed'] ?? 0;
    const failed = (): number => counters(box)['card_write_failed'] ?? 0;
    const blockRecord = (): void => { fs.rmSync(genPath, { recursive: true, force: true }); fs.mkdirSync(genPath); };
    // At end-of-file: the prediction is kept, and its record is due for a rewrite that fails.
    blockRecord();
    let [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(failed(), 'at end-of-file: the record write failed').toBe(f0 + 1);
    expect(cardOf(box, ID, U), 'at end-of-file: no prediction left beside the record').toBeNull();
    expect(removed(), 'at end-of-file: counted').toBe(r0 + 1);
    // CONTROL: the record unblocked, the same pass shape writes both back, and nothing is removed.
    fs.rmSync(genPath, { recursive: true });
    [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: the prediction is written back').toBe(line);
    expect(fs.readFileSync(genPath, 'utf8'), 'CONTROL: and its record').toBe(`${CARD_GEN}\n`);
    expect([removed(), failed()], 'CONTROL: nothing failed, nothing removed').toEqual([r0, f0]);
    // Off end-of-file (a torn last line): CONTROL first, a healthy record keeps both.
    fs.appendFileSync(p, JSON.stringify(userRow({ uuid: sidC(0xbf20), ts: new Date(T0C + 3_600_000).toISOString(), sessionId: U, text: 'still being written' })));
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: off end-of-file a recorded prediction is kept').toBe(line);
    // Then the record is due for a removal that fails.
    blockRecord();
    [r0, f0] = [removed(), failed()];
    pokeC(box, ID);
    expect(failed(), 'off end-of-file: the record removal failed').toBe(f0 + 1);
    expect(cardOf(box, ID, U), 'off end-of-file: no prediction left beside the record').toBeNull();
    expect(removed(), 'off end-of-file: counted').toBe(r0 + 1);
  }, 240_000);

  it('scope/ and card/ are made 0700 by a bound store\'s first tick, and by nothing else: not on a server-role box, not under history-off, not when the store is refused', () => {
    const box = makeHistoryBox('ccrc-hist-card-dirs-');
    passC(box);
    for (const d of ['scope', 'card']) expect(fs.statSync(path.join(box.root, d)).mode & 0o777, d).toBe(0o700);
    const server = makeHistoryBox('ccrc-hist-card-dirs-server-', { role: 'server' });
    expect(runSweep(server).code).toBe(0);
    const off = makeHistoryBox('ccrc-hist-card-dirs-off-');
    fs.writeFileSync(path.join(off.home, '.ccrc', 'history-off'), '');
    expect(runSweep(off).code).toBe(0);
    const refused = makeHistoryBox('ccrc-hist-card-dirs-refused-');
    fs.mkdirSync(refused.root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(refused.root, 'store.id'), `${sidC(0xd1)}\n`);
    expect(runSweep(refused).code, 'store-missing is refused').not.toBe(0);
    for (const b of [server, off, refused]) {
      for (const d of ['scope', 'card']) expect(fs.existsSync(path.join(b.root, d)), `${b.home}: ${d}`).toBe(false);
    }
  }, 240_000);

  it('a registered recovery step withdraws the card: the recover arm removes every prediction, counted card_withdrawn:recovering, and consumes and writes none; the tick after it writes the next', () => {
    const box = makeHistoryBox('ccrc-hist-card-recover-');
    const [ID, U] = ['card-recover', sidC(0xfc)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0xfc, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    // A recovery step registered on the box's store, as a restore's commit leaves one (B2's registerRecovery).
    const db = openWriter(libCard.historyPaths(box.home).dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
    } finally {
      closeWriter(db);
    }
    let passes = 0;
    while ((recoverRow(box)?.completed_ms ?? null) === null) {
      passC(box);
      passes += 1;
      expect(passes, 'the recovery step completes within five passes').toBeLessThanOrEqual(5);
      expect(cardOf(box, ID, U), `recovery pass ${passes}: withdrawn, never left for a second compaction`).toBeNull();
      expect(consumedC(box), 'the recover arm consumes nothing').toEqual({});
    }
    expect(counters(box)['card_withdrawn:recovering'], 'one prediction, withdrawn once').toBe(1);
    pokeC(box, ID);
    expect(consumedC(box), 'a withdrawn prediction is never counted consumed later').toEqual({});
    expect(cardOf(box, ID, U)).toBe(expectedCard(familyC(box, ID), libCard.leafId(ID, U, s.headUuids[1]!)));
  }, 240_000);

  it('a floor pause withdraws every prediction, counted card_withdrawn:low-disk, and never through a linked card/<id>; the next plain pass writes it again', () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-floor-');
    const [ID, U] = ['card-withdraw-floor', sidC(0xf0a)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0a, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const before = cardOf(box, ID, U);
    expect(before, 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    // A card/<id> that is a link to a directory holding a file under a card name: never walked, never unlinked.
    const elsewhere = path.join(box.home, 'elsewhere-card');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${sidC(0xf0e)}.txt`), 'not this writer\'s\n');
    fs.symlinkSync(elsewhere, path.join(box.root, 'card', 'card-linked'));
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: `${FLOOR_C - 4096}:${FS_C}` } });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(counters(box)['capture_paused_low_disk'], 'CONTROL: the pass was a floor pause').toBeGreaterThanOrEqual(1);
    expect(cardOf(box, ID, U), 'withdrawn under the floor pause').toBeNull();
    expect(counters(box)['card_withdrawn:low-disk'], 'one prediction; the linked directory is never walked').toBe(1);
    expect(fs.readdirSync(elsewhere), "the link's target is untouched").toEqual([`${sidC(0xf0e)}.txt`]);
    expect(consumedC(box), 'a withdrawal is no consumption').toEqual({});
    pokeC(box, ID);
    expect(cardOf(box, ID, U), 'the next plain pass at end-of-file writes it again').toBe(before);
  }, 240_000);

  it('the card step\'s own floor spent (a one-byte run gives every derivation step a byte floor of 0): the consume and delete still run, nothing is written, and the predictions left are withdrawn, counted card_withdrawn:budget', () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-budget-');
    const [A, UA] = ['card-budget-a', sidC(0xf0b)];
    const [B, UB] = ['card-budget-b', sidC(0xf0c)];
    const sa = compactionSequence({ n: 2, trigger: 'manual', seed: 0xf0b, sessionId: UA, startMs: T0C });
    const pa = plantC(box, A, UA, sa.rows.slice(0, cutBefore(sa, 1)));
    plantC(box, B, UB, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0c, sessionId: UB, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, A, B);
    expect(cardOf(box, A, UA), 'CONTROL: A has a prediction').not.toBeNull();
    expect(cardOf(box, B, UB), 'CONTROL: B has a prediction').not.toBeNull();
    const written = counters(box)['card_written'] ?? 0;
    const boundariesOf = (uuid: string): number => qC<{ n: number }>(box,
      'SELECT count(*) AS n FROM boundaries b JOIN transcripts t ON t.transcript_pk = b.transcript_pk WHERE t.cc_session_uuid = ?', uuid)[0]!.n;
    expect(boundariesOf(UA)).toBe(1);
    appendRows(pa, sa.rows.slice(cutBefore(sa, 1)));
    spoolLine(box, A, { v: 1, ev: 'Stop', id: A });
    // One byte of budget (D-6935, D-6939): ingest's ceiling admits one unit, so A's one chunk of new rows is read; every
    // derivation step's floor is floor(1 x share / 1000) = 0 bytes, so the card step's own slice is spent when it starts.
    const r = runDriver(box, { budgetBytes: 1 });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(boundariesOf(UA), "CONTROL: A's second boundary was ingested within the budget").toBe(2);
    expect(cardOf(box, A, UA), "A's prediction was consumed and deleted").toBeNull();
    expect(consumedC(box), 'the consumption is counted, never swallowed by the withdrawal').toEqual({ 'card_consumed:unknown': 1 });
    expect(counters(box)['card_written'] ?? 0, 'no write past the budget').toBe(written);
    expect(cardOf(box, B, UB), "B's prediction is withdrawn").toBeNull();
    expect(counters(box)['card_withdrawn:budget'], "B's alone: A's was already consumed").toBe(1);
  }, 240_000);

  it("a hold withdraws too: a writer token gone (held, its DB open) counts card_withdrawn:held; a store.id naming another store (refused, no DB open) puts the count on the pass's outcome line; a linked card/ is never walked", () => {
    const box = makeHistoryBox('ccrc-hist-card-withdraw-hold-');
    const [ID, U] = ['card-withdraw-hold', sidC(0xf0d)];
    plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0xf0d, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const line = cardOf(box, ID, U);
    expect(line, 'CONTROL: a plain pass leaves the prediction in place').not.toBeNull();
    const P = libCard.historyPaths(box.home);
    fs.rmSync(P.writer);
    const held = runSweep(box);
    expect(held.code, `${held.stderr}${held.stdout}`).toBe(0);
    expect(held.stdout, 'CONTROL: the pass held on the writer token').toContain('history-sweep: held');
    expect(cardOf(box, ID, U), 'withdrawn by the held pass').toBeNull();
    expect(counters(box)['card_withdrawn:held']).toBe(1);
    // A store.id naming another store: refused before any DB opens, so nothing is counted and the outcome line says it.
    fs.writeFileSync(cardPath(box, ID, U), line!, { mode: 0o600 });
    fs.writeFileSync(P.storeId, `${sidC(0xd2)}\n`);
    const refused = runSweep(box);
    expect(refused.code, 'store-mismatch waits on the operator').toBe(5);
    expect(refused.stdout).toContain('history-sweep: store-mismatch\n');
    expect(refused.stdout).toContain('history-sweep: card_withdrawn:refused 1\n');
    expect(cardOf(box, ID, U), 'withdrawn by the refused pass').toBeNull();
    // card/ itself a link to a directory that holds a card name: the next refused pass never walks it.
    const elsewhere = path.join(box.home, 'elsewhere-root');
    fs.mkdirSync(path.join(elsewhere, ID), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, ID, `${U}.txt`), line!);
    fs.rmSync(path.join(box.root, 'card'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(box.root, 'card'));
    const linked = runSweep(box);
    expect(linked.code, 'CONTROL: still store-mismatch').toBe(5);
    expect(linked.stdout, 'nothing withdrawn through a linked card/').not.toContain('card_withdrawn');
    expect(fs.existsSync(path.join(elsewhere, ID, `${U}.txt`)), "the link's target is untouched").toBe(true);
  }, 240_000);

  it("a consumption is counted by the scope marker its compaction's PreCompact left: ambiguous as card_consumed:other, out of W1-e's denominator; main as card_consumed:main; a marker through a link as unknown", () => {
    const box = makeHistoryBox('ccrc-hist-card-scope-');
    const runs = [
      { id: 'card-scope-amb', uuid: sidC(0xa1), seed: 0xa1, word: 'ambiguous', link: false },
      { id: 'card-scope-main', uuid: sidC(0xa2), seed: 0xa2, word: 'main', link: false },
      { id: 'card-scope-link', uuid: sidC(0xa3), seed: 0xa3, word: 'main', link: true },
    ].map((r) => ({ ...r, s: compactionSequence({ n: 1, trigger: 'manual', seed: r.seed, sessionId: r.uuid, startMs: T0C }) }));
    const paths = runs.map((r) => plantC(box, r.id, r.uuid, r.s.rows.slice(0, cutBefore(r.s, 0))));
    settleC(box);
    pokeC(box, ...runs.map((r) => r.id));
    for (const r of runs) expect(cardOf(box, r.id, r.uuid), `CONTROL: ${r.id} has its first prediction`).not.toBeNull();
    // What the hook's PreCompact writes a second before each boundary (Task 8's marker); the third through a link.
    for (const r of runs) {
      const ts = Date.parse(String(r.s.rows[cutBefore(r.s, 0)]!['timestamp']));
      const text = `${r.word} ${r.uuid} ${ts - 1000}\n`;
      const marker = path.join(box.root, 'scope', r.id);
      if (r.link) {
        fs.writeFileSync(path.join(box.home, 'marker-target'), text);
        fs.symlinkSync(path.join(box.home, 'marker-target'), marker);
      } else {
        fs.writeFileSync(marker, text);
      }
    }
    runs.forEach((r, i) => appendRows(paths[i]!, r.s.rows.slice(cutBefore(r.s, 0))));
    pokeC(box, ...runs.map((r) => r.id));
    derivedC(box);
    for (const r of runs) expect(leavesC(box, r.uuid), `CONTROL: ${r.id}'s boundary was ingested`).toHaveLength(1);
    expect(consumedC(box)).toEqual({ 'card_consumed:other': 1, 'card_consumed:main': 1, 'card_consumed:unknown': 1 });
  }, 240_000);
});

// ===========================================================================
// W1-B3 Task 6: card delivery measured from the transcript (spec §8.6 RV17, §10.7 W1-e).
// ===========================================================================
/** The measure's cursor, ('card-measure', 1): the highest nodes.rowid it has decided. */
const measureCursor = (box: HistoryBox): string | null =>
  qC<{ cursor: string | null }>(box, "SELECT cursor FROM derivation_state WHERE step = 'card-measure' AND version = 1")[0]?.cursor ?? null;
const topLeafRow = (box: HistoryBox): number =>
  Number(qC<{ r: number }>(box, 'SELECT max(rowid) AS r FROM nodes WHERE depth = 0')[0]!.r);
const STANDING = 'Graph: fixture graph card. Hold: none.';
const COMPACT_CARD = 'Compaction card (fixture): the files touched before the compaction.';

/** A sequence's rows with the SessionStart attachment carrying `text` spliced in right after summary k. */
function withAttachment(s: SeqC, k: number, text: string, uuid: string, sessionId: string): Row[] {
  const at = s.rows.findIndex((r) => r['uuid'] === s.summaryUuids[k]);
  const ts = new Date(Date.parse(String(s.rows[at]!['timestamp'])) + 500).toISOString();
  return [...s.rows.slice(0, at + 1), sessionStartAttachment({ uuid, ts, sessionId, text }), ...s.rows.slice(at + 1)];
}

describe("card delivery is measured from the transcript's SessionStart attachment (spec 8.6 RV17, 10.7 W1-e; W1-B3 Task 6)", () => {
  skipOnDarwin();

  it('an attachment naming the derived leaf counts card_served, one naming another leaf card_id_mismatch, none at all nothing; each by producer', () => {
    const box = makeHistoryBox('ccrc-hist-card-measure-');
    const runs = [
      { id: 'card-served', uuid: sidC(0xe1), seed: 0xe1 },
      { id: 'card-mismatch', uuid: sidC(0xe2), seed: 0xe2 },
      { id: 'card-none', uuid: sidC(0xe3), seed: 0xe3 },
    ].map((r) => ({ ...r, s: compactionSequence({ n: 1, trigger: 'manual', seed: r.seed, sessionId: r.uuid, startMs: T0C }) }));
    const paths = runs.map((r) => plantC(box, r.id, r.uuid, r.s.rows.slice(0, cutBefore(r.s, 0))));
    settleC(box);
    pokeC(box, ...runs.map((r) => r.id));
    const [served, mismatch] = runs;
    const line = cardOf(box, served!.id, served!.uuid)!.replace(/\n$/, '');
    const leafM = libCard.leafId(mismatch!.id, mismatch!.uuid, firstUuidC(mismatch!.s));
    const other = libCard.cardLine({ leaf: `L${leafM[1] === 'f' ? '0' : 'f'}${leafM.slice(2, 7)}` });
    // The served line sits mid-line, after the standing cards, as _hook_emit_context joins them with one space.
    const texts = [`${STANDING} ${line}\n${COMPACT_CARD}`, `${other}\n${COMPACT_CARD}`, COMPACT_CARD];
    runs.forEach((r, i) => {
      appendRows(paths[i]!, withAttachment(r.s, 0, texts[i]!, sidC(0xea0 + i), r.uuid).slice(cutBefore(r.s, 0)));
    });
    pokeC(box, ...runs.map((r) => r.id));
    derivedC(box); // D-5058: the hinted pass ingested the boundaries; their leaves come one plain pass later
    for (const r of runs) expect(leavesC(box, r.uuid), r.id).toEqual([libCard.leafId(r.id, r.uuid, firstUuidC(r.s))]);
    const c = counters(box);
    expect(Object.fromEntries(Object.entries(c).filter(([k]) => /^card_(served|id_mismatch):/.test(k))))
      .toEqual({ 'card_served:anthropic': 1, 'card_id_mismatch:anthropic': 1 });
    expect(measureCursor(box), 'every leaf decided: the none window closed at end-of-file past the grace').toBe(String(topLeafRow(box)));
  }, 240_000);

  it('an open window holds the cursor, and a leaf behind it waits with it; each is then counted once, and 40 rows close a window with no line', () => {
    const box = makeHistoryBox('ccrc-hist-card-window-');
    const [A, UA] = ['card-wait-a', sidC(0xe4)];
    const [B, UB] = ['card-wait-b', sidC(0xe5)];
    const [C, UC] = ['card-wait-c', sidC(0xe6)];
    // A: compacted a minute ago, no attachment yet, a few rows after the boundary: its window is open. A is planted
    // BEFORE its boundary: B1's first pass is a registry scan that maps every registry-named session (a confirmed
    // `import` epoch) and ingests its transcript in that same tick, and the derivation after the ingest mints a leaf
    // for any boundary already stored, so a transcript planted whole would have its leaf before the measure's first
    // pass, and the cursor would start past it.
    const sa = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe4, sessionId: UA, startMs: Date.now() - 60_000 });
    const pa = plantC(box, A, UA, sa.rows.slice(0, cutBefore(sa, 0)));
    settleC(box);
    expect(measureCursor(box), "the first pass started at the empty store's top").toBe('0');
    appendRows(pa, sa.rows.slice(cutBefore(sa, 0)));
    pokeC(box, A);
    derivedC(box); // D-5058: A's leaf comes one plain pass after the hinted pass that ingested its boundary
    const [leafA] = leavesC(box, UA);
    expect(leafA).toBe(libCard.leafId(A, UA, firstUuidC(sa)));
    expect(measureCursor(box), "A's open window holds it").toBe('0');
    // B: served, but derived after A.
    const sb = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe5, sessionId: UB, startMs: T0C });
    const pb = plantC(box, B, UB, sb.rows.slice(0, cutBefore(sb, 0)));
    settleC(box);
    pokeC(box, B);
    const lineB = cardOf(box, B, UB)!.replace(/\n$/, '');
    appendRows(pb, withAttachment(sb, 0, lineB, sidC(0xeb5), UB).slice(cutBefore(sb, 0)));
    pokeC(box, B);
    derivedC(box); // D-5058: B's leaf, likewise
    expect(leavesC(box, UB)).toHaveLength(1);
    expect(counters(box)['card_served:anthropic'], "B waits behind A's open window").toBeUndefined();
    expect(measureCursor(box)).toBe('0');
    // A's attachment arrives: A is decided, then B, each once.
    appendRows(pa, [sessionStartAttachment({
      uuid: sidC(0xea4), ts: new Date().toISOString(), sessionId: UA, text: libCard.cardLine({ leaf: leafA!.slice(0, 7) }),
    })]);
    pokeC(box, A);
    expect(counters(box)['card_served:anthropic'], 'A, then B').toBe(2);
    const top = topLeafRow(box);
    expect(measureCursor(box)).toBe(String(top));
    // C: open, with no line; 40 more rows close it, and nothing is counted.
    const sc = compactionSequence({ n: 1, trigger: 'manual', seed: 0xe6, sessionId: UC, startMs: Date.now() - 60_000 });
    const pc = plantC(box, C, UC, sc.rows);
    settleC(box);
    expect(leavesC(box, UC)).toHaveLength(1);
    expect(measureCursor(box), "C's window is open").toBe(String(top));
    appendRows(pc, Array.from({ length: libCard.CARD_MEASURE_ROWS }, (_, i) => userRow({
      uuid: sidC(0xec000 + i), ts: new Date().toISOString(), sessionId: UC, text: `row ${i}`,
    })));
    pokeC(box, C);
    expect(measureCursor(box)).toBe(String(topLeafRow(box)));
    expect(counters(box)['card_served:anthropic']).toBe(2);
  }, 240_000);
});

// In-process, against a store built by hand: a case can put a leaf on a subagent transcript, fail the cursor's write,
// mark a copy gone, or age a leaf. B2's epochFixture9 shape, with attachment and assistant rows.
interface Card6 {
  measureCardDelivery(db: DatabaseSync, ictx: object, budget: object): { measured: number; served: number; mismatch: number; waiting: number };
}
interface Sweep6 {
  makeIngestCtx(home: string, homes: string[], nowMs: number, ids: unknown): Record<string, unknown>;
  newBudget(): object;
}
const card6 = async (): Promise<Card6> => (await import('../../ccd/history/card.mjs')) as unknown as Card6;
const sweep6 = async (): Promise<Sweep6> => (await import('../../ccd/history/sweep.mjs')) as unknown as Sweep6;
const E6 = 'd6e00000-1111-4111-8111-111111111111';
interface Store6 {
  home: string;
  db: DatabaseSync;
  leaf(k: number, o: { transcript: 1 | 2; serve: boolean; createdMs?: number }): string;
  attach(k: number, o: { transcript: 1 | 2; text: string; rawLen?: number }): void;
}

/** One family and one confirmed epoch; its main transcript (pk 1, file 1) and a subagent transcript of the same uuid
 *  (pk 2, agent 'agent-x', file 2), both live and read to their end now. leaf(k) puts boundary k at line 100k of its
 *  transcript's file, a minute old (inside the raw-leaf grace, so end-of-file alone closes no window), and a leaf over
 *  it; with `serve`, the SessionStart attachment naming that leaf at 100k+1 and an assistant row at 100k+2.
 *  attach(k) puts one more hook_additional_context attachment carrying `text` at 100k+3, its blob's raw_len set to
 *  `rawLen` when one is given (the stored body itself stays small, so only the declared size differs). */
function store6(): Store6 {
  const home = mkTmp('ccrc-hist-card-measure6-');
  createStore(home);
  const db = openWriter(libCard.historyPaths(home).dbFile);
  const now = Date.now();
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'card-measure', '', 'demo', 1)").run();
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E6);
  db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (1, ?, ''), (2, ?, 'agent-x')").run(E6, E6);
  db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, eof_ms, parser_version) VALUES (1, 1, 6001, 1, 'live', ?, 1), (2, 1, 6002, 2, 'live', ?, 1)").run(now, now);
  const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)");
  const ent = db.prepare(`INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, model, provenance, prov_version,
    struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, ?, ?, ?, ?, 'harness', 1, 0, 0, ?, ?)`);
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  let entry = 0;
  const row = (t: number, line: number, type: string, subtype: string | null, model: string | null, body: unknown): number => {
    entry += 1;
    const raw = Buffer.from(JSON.stringify(body));
    const b = Number(blob.run(createHash('sha256').update(raw).digest(), brotli(raw), raw.length).lastInsertRowid);
    ent.run(entry, `d6e00000-0000-4000-8000-${entry.toString(16).padStart(12, '0')}`, t, type, subtype, model, b, now - 60_000 + line);
    member.run(t, entry, line);
    return entry;
  };
  const leaf = (k: number, o: { transcript: 1 | 2; serve: boolean; createdMs?: number }): string => {
    const t = o.transcript;
    const id = libCard.leafId('card-measure', E6, `span-${t}-${k}`);
    const b = row(t, 100 * k, 'system', 'compact_boundary', null, { boundary: k, t });
    db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)').run(b, t, k);
    if (o.serve) {
      row(t, 100 * k + 1, 'attachment', null, null, { type: 'hook_additional_context', content: [libCard.cardLine({ leaf: id.slice(0, 7) })], k, t });
      row(t, 100 * k + 2, 'assistant', null, 'claude-fixture-4', { answer: k, t });
    }
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, boundary_entry_id,
      parser_version, created_ms) VALUES (?, 1, 1, ?, 'native_leaf', 0, 'not-requested', ?, 1, ?)`).run(id, t, b, o.createdMs ?? now);
    return id;
  };
  const attach = (k: number, o: { transcript: 1 | 2; text: string; rawLen?: number }): void => {
    const e = row(o.transcript, 100 * k + 3, 'attachment', null, null, { type: 'hook_additional_context', content: [o.text], k, extra: true });
    if (o.rawLen !== undefined) {
      db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE entry_id = ?)').run(o.rawLen, e);
    }
  };
  return { home, db, leaf, attach };
}

describe("in-process: the measure's cursor, scope and transaction (spec 8.6 RV17, 10.7 W1-e; W1-B3 Task 6)", () => {
  const run6 = async (fx: Store6): Promise<ReturnType<Card6['measureCardDelivery']>> => {
    const C = await card6();
    const S = await sweep6();
    return C.measureCardDelivery(fx.db, S.makeIngestCtx(fx.home, [], Date.now(), null), S.newBudget());
  };
  const counters6 = (db: DatabaseSync): Record<string, number> => Object.fromEntries(
    (db.prepare("SELECT name, n FROM counters WHERE name LIKE 'card%' ORDER BY name").all() as Array<{ name: string; n: number }>)
      .map((r) => [r.name, Number(r.n)]));
  const cursor6 = (db: DatabaseSync): string | null =>
    (db.prepare("SELECT cursor FROM derivation_state WHERE step = 'card-measure' AND version = 1").get() as { cursor: string | null } | undefined)?.cursor ?? null;

  it('the first measuring pass reads no leaf that already exists: it starts the cursor at the newest node; a leaf derived after it is measured', async () => {
    const fx = store6();
    try {
      fx.leaf(1, { transcript: 1, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      expect(cursor6(fx.db)).toBe('1');
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      fx.leaf(2, { transcript: 1, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('a leaf of a subagent transcript is never measured, whatever its window holds', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: true });
      fx.leaf(2, { transcript: 2, serve: true });
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('the count and the cursor commit together: a cursor write that fails leaves no count, and the retry counts once', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: true });
      fx.db.exec(`CREATE TRIGGER card_measure_fail_i BEFORE INSERT ON derivation_state WHEN NEW.step = 'card-measure'
        BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END`);
      fx.db.exec(`CREATE TRIGGER card_measure_fail_u BEFORE UPDATE ON derivation_state WHEN NEW.step = 'card-measure'
        BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END`);
      await expect(run6(fx)).rejects.toThrow(/injected cursor failure/);
      expect(counters6(fx.db)).toEqual({});
      expect(cursor6(fx.db)).toBe('0');
      fx.db.exec('DROP TRIGGER card_measure_fail_i; DROP TRIGGER card_measure_fail_u;');
      expect(await run6(fx)).toMatchObject({ measured: 1, served: 1 });
      expect(await run6(fx)).toMatchObject({ measured: 0 });
      expect(counters6(fx.db)).toEqual({ 'card_served:anthropic': 1 });
    } finally {
      fx.db.close();
    }
  });

  it('a window cannot wedge the walk: a copy no longer live decides at once, and so does a leaf past CARD_MEASURE_MAX_WAIT_MS; a young open one waits', async () => {
    const fx = store6();
    try {
      await run6(fx);
      fx.leaf(1, { transcript: 1, serve: false });
      expect(await run6(fx), 'young, live, short of 40 rows, no next boundary: it waits').toMatchObject({ measured: 0, waiting: 1 });
      expect(cursor6(fx.db)).toBe('0');
      fx.db.prepare("UPDATE ingest_files SET status = 'gone' WHERE file_id = 1").run();
      expect(await run6(fx), 'its copy gone: decided, nothing counted').toMatchObject({ measured: 1, waiting: 0 });
      fx.db.prepare("UPDATE ingest_files SET status = 'live' WHERE file_id = 1").run();
      fx.leaf(2, { transcript: 1, serve: false, createdMs: Date.now() - libCard.CARD_MEASURE_MAX_WAIT_MS - 1000 });
      expect(await run6(fx), 'past the wait bound: decided').toMatchObject({ measured: 1, waiting: 0 });
      expect(counters6(fx.db)).toEqual({});
    } finally {
      fx.db.close();
    }
  });

  it('an attachment body past CARD_ATTACHMENT_MAX_BYTES is never decoded, so even a History line in one counts nothing; CONTROL: the same row within the bound is read', async () => {
    const fx = store6();
    try {
      await run6(fx);
      // Each leaf is past the wait bound, so its window is closed while its copy stays live and is read.
      const old = Date.now() - libCard.CARD_MEASURE_MAX_WAIT_MS - 1000;
      fx.leaf(1, { transcript: 1, serve: false, createdMs: old });
      fx.attach(1, { transcript: 1, text: libCard.cardLine({ leaf: 'Lffffff' }), rawLen: libCard.CARD_ATTACHMENT_MAX_BYTES + 1 });
      expect(await run6(fx), 'decided with the large body unread').toMatchObject({ measured: 1, mismatch: 0 });
      fx.leaf(2, { transcript: 1, serve: false, createdMs: old });
      fx.attach(2, { transcript: 1, text: libCard.cardLine({ leaf: 'Lffffff' }) });
      expect(await run6(fx), 'CONTROL: within the bound the line is read, and names another leaf').toMatchObject({ measured: 1, mismatch: 1 });
    } finally {
      fx.db.close();
    }
  });
});

// ===========================================================================
// W1-B3 Task 7: purged sessions' scope markers and card directories, collected at the scan, 7 days on (spec §9.4).
// runDriver moves the pass clock past SCAN_INTERVAL_MS, so that pass's registry scan is due.
// ===========================================================================
describe("purged sessions' scope markers and card directories go 7 days on, at the scan (spec 9.4; W1-B3 Task 7)", () => {
  skipOnDarwin();
  const DAY = 24 * 60 * 60 * 1000;
  const SCAN_LATER = { offsetMs: libCard.SCAN_INTERVAL_MS + 60_000 };
  /** Sets an entry's own times (a link's, never its target's) to `ms` ago. */
  const age = (p: string, ms: number): void => {
    const t = (Date.now() - ms) / 1000;
    fs.lutimesSync(p, t, t);
  };
  const scopeOf = (box: HistoryBox, id: string): string => path.join(box.root, 'scope', id);
  /** A short transcript: two rows, no boundary yet, so its card predicts the epoch's first leaf. */
  const tiny = (uuid: string, n: number): Row[] => [
    userRow({ uuid: sidC(n), ts: new Date(T0C).toISOString(), sessionId: uuid, text: 'a request' }),
    userRow({ uuid: sidC(n + 1), ts: new Date(T0C + 1000).toISOString(), sessionId: uuid, text: 'a follow-up' }),
  ];
  /** A session with its prediction written and a scope marker (as the hook would write it), all aged `days`. */
  const seeded = (box: HistoryBox, rows: ReadonlyArray<readonly [string, string, number]>): void => {
    rows.forEach(([id, uuid], i) => plantC(box, id, uuid, tiny(uuid, 0x7100 + 16 * i)));
    settleC(box);
    pokeC(box, ...rows.map(([id]) => id));
    for (const [id, uuid, days] of rows) {
      expect(cardOf(box, id, uuid), id).not.toBeNull();
      fs.writeFileSync(scopeOf(box, id), `main ${uuid} ${Date.now()}\n`);
      // D-5053 (history-card-purge-fixture-ages-record): the generation record is a file of the directory, and a directory is as old as its newest entry; the directory is aged last.
      for (const p of [scopeOf(box, id), cardPath(box, id, uuid), path.join(box.root, 'card', id, `${uuid}.gen`), path.join(box.root, 'card', id)]) age(p, days * DAY);
    }
  };
  const purge = (box: HistoryBox, id: string): void => {
    for (const f of fs.readdirSync(box.reg).filter((n) => n.startsWith(`${id}.`))) fs.rmSync(path.join(box.reg, f));
  };

  it('registry absent and 8 days old: removed and counted; 6 days old, or still in the registry: kept; nothing at a pass whose scan is not due', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-');
    const fam = [['card-gone', sidC(0x71), 8], ['card-young', sidC(0x72), 6], ['card-live', sidC(0x73), 8]] as const;
    seeded(box, fam);
    purge(box, 'card-gone');
    purge(box, 'card-young');
    passC(box);
    for (const [id] of fam) expect(fs.existsSync(scopeOf(box, id)), `${id}: this pass's scan was not due`).toBe(true);
    expect(counters(box)['scope_files_purged']).toBeUndefined();
    const r = runDriver(box, SCAN_LATER);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(fs.existsSync(scopeOf(box, 'card-gone'))).toBe(false);
    expect(fs.existsSync(path.join(box.root, 'card', 'card-gone'))).toBe(false);
    expect(fs.existsSync(path.join(box.root, 'card', 'card-gone', `${fam[0][1]}.gen`)), 'its generation record went with its directory').toBe(false);
    for (const [id, uuid] of fam.slice(1)) {
      expect(fs.existsSync(scopeOf(box, id)), id).toBe(true);
      expect(cardOf(box, id, uuid), id).not.toBeNull();
    }
    const c = counters(box);
    expect([c['scope_files_purged'], c['card_files_purged']]).toEqual([1, 1]);
  }, 240_000);

  it.skipIf(process.getuid?.() === 0)('a registry entry that cannot be measured keeps the files: unmeasured is never absent', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-eacces-');
    const ID = 'card-unmeasured';
    const U = sidC(0x74);
    seeded(box, [[ID, U, 8]]);
    fs.chmodSync(box.reg, 0o600);
    let code: number | null = null;
    try {
      code = runDriver(box, SCAN_LATER).code;
    } finally {
      fs.chmodSync(box.reg, 0o700);
    }
    expect(code, 'the pass ran its scan to the end').toBe(0);
    expect(fs.existsSync(scopeOf(box, ID))).toBe(true);
    expect(cardOf(box, ID, U)).not.toBeNull();
    expect(counters(box)['scope_files_purged']).toBeUndefined();
  }, 240_000);

  it('no registry directory measures no session absent: an aged scope marker and card directory are both kept and nothing is counted', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-noreg-');
    passC(box);
    const scope = scopeOf(box, 'card-noreg');
    const card = path.join(box.root, 'card', 'card-noreg');
    fs.writeFileSync(scope, 'main x 1\n');
    fs.mkdirSync(card, { recursive: true });
    fs.writeFileSync(path.join(card, 'note'), 'x');
    for (const p of [scope, path.join(card, 'note'), card]) age(p, 8 * DAY);
    fs.rmSync(box.reg, { recursive: true, force: true });
    const r = runDriver(box, SCAN_LATER);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(fs.existsSync(scope), 'the marker stands').toBe(true);
    expect(fs.existsSync(card), 'the card directory stands').toBe(true);
    const c = counters(box);
    expect([c['scope_files_purged'], c['card_files_purged']]).toEqual([undefined, undefined]);
  }, 240_000);

  it('a link is unlinked and its target kept; a name failing idOk, a card directory holding a directory, and the other history directories stay', () => {
    const box = makeHistoryBox('ccrc-hist-card-purge-shapes-');
    passC(box);
    const outside = path.join(box.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'target');
    const link = scopeOf(box, 'card-link');
    fs.symlinkSync(outside, link);
    const bad = scopeOf(box, 'bad name');
    fs.writeFileSync(bad, 'x');
    const nested = path.join(box.root, 'card', 'card-nested');
    fs.mkdirSync(path.join(nested, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(nested, 'note'), 'x');
    for (const p of [link, bad, path.join(nested, 'note'), path.join(nested, 'sub'), nested]) age(p, 8 * DAY);
    const listing = (d: string): string[] => (fs.existsSync(path.join(box.root, d)) ? fs.readdirSync(path.join(box.root, d)).sort() : []);
    const journal = listing('journal');
    const r = runDriver(box, SCAN_LATER);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(() => fs.lstatSync(link), 'the link itself is gone').toThrow();
    expect(fs.readdirSync(outside), 'its target is untouched').toEqual(['keep.txt']);
    expect(fs.existsSync(bad), 'a name failing idOk is never read as a session').toBe(true);
    expect(fs.readdirSync(nested).sort(), 'a directory this writer never makes keeps its card directory whole').toEqual(['note', 'sub']);
    expect(listing('journal'), 'journal/ is never walked').toEqual(journal);
    expect(fs.statSync(path.join(box.root, 'spool')).isDirectory()).toBe(true);
    expect(counters(box)['scope_files_purged']).toBe(1);
  }, 240_000);
});

// ===========================================================================
// W3 Task 1B: the steer file, a second artifact of the card's per-session step (spec 2026-10-05 §7.1, §9.4; plan
// 2026-10-29-ccrc-history-w3-steering.md Task 1B). `steer/<id>/<uuid>.txt` is decided by the card's own lib deciders
// (decideCardFile with artifact 'steer', decideCardWithdraw, decideCardGenFile's record) and acted on in oneCard from the
// card's own prediction, atEof, mayWrite and recorded. Each case below is the card's own, applied to the steer file.
// ===========================================================================
const steerPath = (box: HistoryBox, id: string, uuid: string): string => path.join(box.root, 'steer', id, `${uuid}.txt`);
const steerOf = (box: HistoryBox, id: string, uuid: string): string | null =>
  (fs.existsSync(steerPath(box, id, uuid)) ? fs.readFileSync(steerPath(box, id, uuid), 'utf8') : null);
/** Every steer counter (and the directory refusal), so a case that expects none reads `{}`. */
const steerCountersC = (box: HistoryBox): Record<string, number> =>
  Object.fromEntries(Object.entries(counters(box)).filter(([k]) => k.startsWith('steer_') || k === 'history_dir_refused:steer'));
const NO_PAIRS = libCard.makePairIndex([]);
/** The text a correct steer file holds: lib's composition for the leaf (and a previous leaf when one is quotable), and one LF. */
const expectedSteer = (leaf: string, prev: libCard.SteerPrev | null = null): string =>
  `${libCard.composeSteerFile({ leafId: leaf, prev, children: [], pairIdx: NO_PAIRS }).text}\n`;

describe("the steer file rides the card's lifecycle: written, consumed, withdrawn and collected with the card (spec 7.1, 9.4; W3 Task 1B)", () => {
  skipOnDarwin();

  it("the steer file's id equals the card's predicted leaf id: an ordinary next span, a first span, and a fork (no file, O6 (a))", () => {
    // An ordinary next span: the last boundary's head.
    const box = makeHistoryBox('ccrc-hist-steer-parity-');
    const [ID, U] = ['steer-parity', sidC(0x1b01)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0x1b01, sessionId: U, startMs: T0C });
    plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    const next = libCard.leafId(ID, U, s.headUuids[0]!);
    const file = steerOf(box, ID, U);
    expect(file, 'the ordinary span').toBe(expectedSteer(next));
    expect(libCard.steerLeafOf(file!.replace(/\n$/, '')), 'the id the file names').toBe(next);
    expect(next.startsWith(printed(cardOf(box, ID, U)!).leaf), "it is the card's own leaf").toBe(true);
    expect(fs.statSync(steerPath(box, ID, U)).mode & 0o777).toBe(0o600);
    for (const d of [path.join(box.root, 'steer'), path.join(box.root, 'steer', ID)]) expect(fs.statSync(d).mode & 0o777, d).toBe(0o700);
    expect(steerCountersC(box)).toEqual({ steer_written: 1 });
    // A first span: no boundary yet, the copy's first row.
    const [ID1, U1] = ['steer-parity-first', sidC(0x1b02)];
    const s1 = compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b02, sessionId: U1, startMs: T0C });
    plantC(box, ID1, U1, s1.rows.slice(0, cutBefore(s1, 0)));
    settleC(box);
    pokeC(box, ID1);
    const first = libCard.leafId(ID1, U1, firstUuidC(s1));
    expect(steerOf(box, ID1, U1), 'the first span').toBe(expectedSteer(first));
    expect(first.startsWith(printed(cardOf(box, ID1, U1)!).leaf)).toBe(true);
    // A fork: the plain id is bound to another boundary, so the card skips fork-qualified and no steer file stands.
    const [ID2, U2] = ['steer-parity-fork', sidC(0x1b03)];
    const pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b03, sessionId: U2, startMs: T0C });
    const other = compactionSequence({ n: 1, trigger: 'manual', tailRows: 0, seed: 0x1b04, sessionId: U2, startMs: T0C + 600_000 });
    const a = plantTranscript(box, 'claude', CARD_SLUG, U2, [...pre.rows, ...other.rows]);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(a, hourAgo, hourAgo);
    plantC(box, ID2, U2, [...pre.rows, userRow({ uuid: sidC(0xbb03), ts: new Date(T0C + 900_000).toISOString(), sessionId: U2, text: 'fork b' })], 'claude-a');
    settleC(box);
    pokeC(box, ID2);
    expect(cardOf(box, ID2, U2), 'the card skipped').toBeNull();
    expect(counters(box)['card_skipped:fork-qualified']).toBeGreaterThanOrEqual(1);
    expect(steerOf(box, ID2, U2), 'so no steer file stands').toBeNull();
    expect(steerCountersC(box)).toEqual({ steer_written: 2 });
  }, 240_000);

  it('the steer file is written only at end-of-file with budget left, and a spent budget still consumes it', () => {
    const box = makeHistoryBox('ccrc-hist-steer-eof-');
    const [ID, U] = ['steer-eof', sidC(0x1b11)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0x1b11, sessionId: U, startMs: T0C });
    const torn = (n: number): string => JSON.stringify(userRow({ uuid: sidC(0xbb110 + n), ts: new Date(T0C + 3_600_000 + n).toISOString(), sessionId: U, text: `still being written ${n}` }));
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    fs.appendFileSync(p, torn(1));
    settleC(box);
    pokeC(box, ID);
    expect(leavesC(box, U), 'boundary 0 is final').toHaveLength(1);
    expect(steerOf(box, ID, U), 'never at end-of-file: no steer file').toBeNull();
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(steerOf(box, ID, U)).toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!)));
    // A spent budget: A's steer file is consumed by the boundary this pass ingests and is not rewritten; B's, which no
    // boundary reached, is withdrawn under the budget word.
    const [B, UB] = ['steer-eof-b', sidC(0x1b12)];
    plantC(box, B, UB, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b12, sessionId: UB, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, B);
    expect(steerOf(box, B, UB), 'CONTROL: B has a steer file').not.toBeNull();
    const before = steerCountersC(box);
    appendRows(p, s.rows.slice(cutBefore(s, 1), cutBefore(s, 2)));
    fs.appendFileSync(p, '\n');
    spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID });
    const r = runDriver(box, { budgetBytes: 1 });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(steerOf(box, ID, U), "A's steer file was consumed and deleted").toBeNull();
    expect(steerOf(box, B, UB), "B's steer file is withdrawn").toBeNull();
    const after = steerCountersC(box);
    expect(after['steer_written'], 'no write past the budget').toBe(before['steer_written']);
    expect((after['steer_consumed'] ?? 0) - (before['steer_consumed'] ?? 0), 'the consumption is counted').toBe(1);
    expect(after['steer_withdrawn:budget'], "B's alone: A's was already consumed").toBe(1);
  }, 240_000);

  it('a consumed steer file is deleted off end-of-file, and the next pass at end-of-file re-mints it with the new predicted id', () => {
    const box = makeHistoryBox('ccrc-hist-steer-remint-');
    const [ID, U] = ['steer-remint', sidC(0x1b21)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0x1b21, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'the first span').toBe(expectedSteer(libCard.leafId(ID, U, firstUuidC(s))));
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    fs.appendFileSync(p, JSON.stringify(userRow({ uuid: sidC(0xbb21), ts: new Date(T0C + 3_600_000).toISOString(), sessionId: U, text: 'still being written' })));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U), 'boundary 0 ingested').toHaveLength(1);
    expect(steerOf(box, ID, U), 'consumed off end-of-file: deleted, not rewritten').toBeNull();
    expect(steerCountersC(box)).toMatchObject({ steer_written: 1, steer_consumed: 1 });
    fs.appendFileSync(p, '\n');
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'the next pass at end-of-file re-mints it, naming the next leaf')
      .toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!)));
    expect(steerCountersC(box)).toMatchObject({ steer_written: 2, steer_consumed: 1 });
  }, 240_000);

  // Every reason in CARD_WITHDRAW_REASONS, each driven through its real pass. A withdrawal unlinks the steer file with the
  // card's prediction under the card's own verdict, counted `steer_withdrawn:<reason>` (or printed as a line when no DB is
  // open), and the next pass at end-of-file re-mints it. The hook half (what PreCompact prints after one) is Task 1C's.
  describe('every withdrawal reason unlinks the steer file with the card\'s prediction', () => {
    const GiB = 1024 ** 3;
    interface Planted { id: string; uuid: string; path: string; s: SeqC }
    interface Drive {
      /** Runs the withdrawing pass; answers what to undo and what it printed. */
      run(box: HistoryBox, c: { id: string; uuid: string; path: string; s: SeqC; extra: Planted | null }): { stdout: string; restore?: () => void };
      /** Plants what the pass needs beside the subject, before the counters are read. */
      prepare?(box: HistoryBox): Planted;
      /** The consumptions the pass makes of its own besides the withdrawal (default 0). */
      consumed?: number;
      /** A reason with no DB open prints its count instead of counting it. */
      printed?: boolean;
      /** The next leaf the re-mint names: head 0 unless the drive appended boundary 1 for the pass to ingest. */
      head?: 0 | 1;
      /** The drive appends boundary 1's rows before the pass. */
      appends?: boolean;
      skipIfRoot?: boolean;
    }
    const sweepOut = (r: { code: number | null; stdout: string; stderr: string }, code = 0): string => {
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(code);
      return r.stdout;
    };
    const DRIVES: Record<string, Drive> = {
      'at-cap': {
        run(box) {
          const cap = path.join(box.home, '.ccrc', 'history-max-gb');
          fs.writeFileSync(cap, '1\n');
          const r = runDriver(box, { sizeBytes: 2 * GiB });
          expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
          expect(counters(box)['capture_paused_at_cap'], 'CONTROL: the pass was a cap pause').toBeGreaterThanOrEqual(1);
          return { stdout: r.stdout, restore: () => fs.unlinkSync(cap) };
        },
      },
      'low-disk': {
        run(box) {
          const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: `${FLOOR_C - 4096}:${FS_C}` } });
          expect(counters(box)['capture_paused_low_disk'], 'CONTROL: the pass was a floor pause').toBeGreaterThanOrEqual(1);
          return { stdout: sweepOut(r) };
        },
      },
      'floor-stop': {
        appends: true,
        run(box, c) {
          spoolLine(box, c.id, { v: 1, ev: 'Stop', id: c.id });
          const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS_AFTER: `1:1:${2 ** 40}` } });
          return { stdout: sweepOut(r) };
        },
      },
      'roster-unreadable': {
        run(box) { return { stdout: sweepOut(runSweep(box, ['--roster-unreadable'])) }; },
      },
      budget: {
        // The run's one byte is spent by a second session's ingest, so the card step's own slice is spent when it starts;
        // that session's own steer file is consumed by the boundary the pass ingests, never withdrawn.
        consumed: 1,
        prepare(box) {
          const [A, UA] = ['steer-wd-budget-a', sidC(0x1b9a)];
          const sa = compactionSequence({ n: 2, trigger: 'manual', seed: 0x1b9a, sessionId: UA, startMs: T0C });
          const pa = plantC(box, A, UA, sa.rows.slice(0, cutBefore(sa, 1)));
          settleC(box);
          pokeC(box, A);
          return { id: A, uuid: UA, path: pa, s: sa };
        },
        run(box, c) {
          const a = c.extra!;
          appendRows(a.path, a.s.rows.slice(cutBefore(a.s, 1)));
          spoolLine(box, a.id, { v: 1, ev: 'Stop', id: a.id });
          const r = runDriver(box, { budgetBytes: 1 });
          expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
          return { stdout: r.stdout };
        },
      },
      recovering: {
        run(box) {
          const db = openWriter(libCard.historyPaths(box.home).dbFile);
          try {
            db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
          } finally {
            closeWriter(db);
          }
          let out = '';
          for (let passes = 1; (recoverRow(box)?.completed_ms ?? null) === null; passes += 1) {
            expect(passes, 'the recovery step completes within five passes').toBeLessThanOrEqual(5);
            out += sweepOut(runSweep(box));
          }
          return { stdout: out };
        },
      },
      migrating: {
        run(box) {
          const P = libCard.historyPaths(box.home);
          rewindStoreToV1(P.dbFile);
          const out = sweepOut(runSweep(box));
          expect(out, 'CONTROL: the pass migrated').toContain('history-sweep: migrated');
          return { stdout: out };
        },
      },
      held: {
        run(box) {
          const P = libCard.historyPaths(box.home);
          const token = fs.readFileSync(P.writer);
          fs.rmSync(P.writer);
          const out = sweepOut(runSweep(box));
          expect(out, 'CONTROL: the pass held on the writer token').toContain('history-sweep: held');
          return { stdout: out, restore: () => fs.writeFileSync(P.writer, token) };
        },
      },
      unreachable: {
        printed: true,
        run(box) {
          const out = sweepOut(runSweep(box, [], { env: { HISTORY_TEST_STATFS: 'hang' } }));
          expect(out, 'CONTROL: the pass held on the volume').toContain('history-sweep: store-unreachable');
          return { stdout: out };
        },
      },
      refused: {
        printed: true,
        run(box) {
          const P = libCard.historyPaths(box.home);
          const id = fs.readFileSync(P.storeId);
          fs.writeFileSync(P.storeId, `${sidC(0xd2)}\n`);
          const out = sweepOut(runSweep(box), 5);
          expect(out).toContain('history-sweep: store-mismatch');
          return { stdout: out, restore: () => fs.writeFileSync(P.storeId, id) };
        },
      },
      unbound: {
        printed: true,
        run(box) {
          const P = libCard.historyPaths(box.home);
          const id = fs.readFileSync(P.storeId);
          fs.rmSync(P.storeId);
          const out = sweepOut(runSweep(box), 5);
          expect(out).toContain('history-sweep: store-unbound');
          return { stdout: out, restore: () => fs.writeFileSync(P.storeId, id) };
        },
      },
      'copy-skipped': {
        appends: true,
        skipIfRoot: true,
        run(box, c) {
          const mode = fs.statSync(c.path).mode & 0o777;
          fs.chmodSync(c.path, 0o000);
          pokeC(box, c.id);
          return { stdout: '', restore: () => fs.chmodSync(c.path, mode) };
        },
      },
    };

    it('the table covers every word in CARD_WITHDRAW_REASONS, once', () => {
      expect(Object.keys(DRIVES).sort()).toEqual([...libCard.CARD_WITHDRAW_REASONS].sort());
    });

    for (const [reason, drive] of Object.entries(DRIVES)) {
      it.skipIf(drive.skipIfRoot === true && process.getuid?.() === 0)(`${reason}: both files are gone, steer_withdrawn:${reason} is counted (or printed), and the next run-arm pass at end-of-file re-mints it`, () => {
        const box = makeHistoryBox(`ccrc-hist-steer-wd-${reason}-`);
        const [ID, U] = [`steer-wd-${reason}`, sidC(0x1c00 + Object.keys(DRIVES).indexOf(reason))];
        const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0x1c00 + Object.keys(DRIVES).indexOf(reason), sessionId: U, startMs: T0C });
        const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
        settleC(box);
        pokeC(box, ID);
        const standing = expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!));
        expect(steerOf(box, ID, U), 'CONTROL: a plain pass leaves the steer file in place').toBe(standing);
        expect(cardOf(box, ID, U), 'CONTROL: and the card').not.toBeNull();
        if (drive.appends === true) appendRows(p, s.rows.slice(cutBefore(s, 1), cutBefore(s, 2)));
        const extra = drive.prepare?.(box) ?? null;
        const before = steerCountersC(box);
        const done = drive.run(box, { id: ID, uuid: U, path: p, s, extra });
        done.restore?.();
        expect(cardOf(box, ID, U), 'the card is withdrawn').toBeNull();
        expect(steerOf(box, ID, U), 'the steer file goes with it').toBeNull();
        if (drive.printed === true) {
          expect(done.stdout, "no DB is open: the card's count and the steer's are lines").toContain(`history-sweep: card_withdrawn:${reason} 1\n`);
          expect(done.stdout).toContain(`history-sweep: steer_withdrawn:${reason} 1\n`);
        } else {
          expect((steerCountersC(box)[`steer_withdrawn:${reason}`] ?? 0) - (before[`steer_withdrawn:${reason}`] ?? 0), 'counted once').toBe(1);
        }
        expect((steerCountersC(box)['steer_consumed'] ?? 0) - (before['steer_consumed'] ?? 0), 'a withdrawal is no consumption').toBe(drive.consumed ?? 0);
        pokeC(box, ID);
        derivedC(box);
        pokeC(box, ID);
        const want = libCard.leafId(ID, U, s.headUuids[drive.head ?? (drive.appends === true ? 1 : 0)]!);
        expect(steerOf(box, ID, U), 'the next pass at end-of-file re-mints it').toBe(expectedSteer(want));
      }, 240_000);
    }
  });

  // D-5059's arm for the steer file: the seam is the faults preload's ENOSPC on the first Buffer write to the steer file's
  // temp, which only the steer path holds (`/steer/<id>/`), so the card's own write lands and the steer write is the one that fails.
  it("a consumed steer file whose replacement cannot be written is unlinked, counted steer_write_failed once, and consumed once (D-5059's arm)", () => {
    const box = makeHistoryBox('ccrc-hist-steer-consumedfail-');
    const [ID, U] = ['steer-cfail', sidC(0x1b31)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0x1b31, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 0)));
    settleC(box);
    pokeC(box, ID);
    const want0 = libCard.leafId(ID, U, firstUuidC(s));
    expect(steerOf(box, ID, U), 'CONTROL: the steer file stands').toBe(expectedSteer(want0));
    const failing = (): void => {
      spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID });
      const r = runSweep(box, [], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: `/steer/${ID}/${U}.txt.tmp` } });
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    };
    const before = steerCountersC(box);
    appendRows(p, s.rows.slice(cutBefore(s, 0), cutBefore(s, 1)));
    failing();   // ingests boundary 0 at end-of-file: the new steer file would replace the consumed one, and cannot be written
    const after = steerCountersC(box);
    expect(steerOf(box, ID, U), 'the consumed file is gone, not served as the next compaction').toBeNull();
    expect(fs.readdirSync(path.join(box.root, 'steer', ID)), 'and no temp or other name stands in its place').toEqual([]);
    expect(cardOf(box, ID, U), "the card's own write was not matched by the seam, and landed").not.toBeNull();
    expect((after['steer_write_failed'] ?? 0) - (before['steer_write_failed'] ?? 0)).toBe(1);
    expect((after['steer_consumed'] ?? 0) - (before['steer_consumed'] ?? 0), 'consumed once, counted once it is gone').toBe(1);
    expect(after['steer_unrecorded_removed'], 'the record was acted on: this is no unrecorded removal').toBeUndefined();
    failing();   // the write still fails and nothing stands: nothing more is consumed
    expect(steerOf(box, ID, U)).toBeNull();
    expect(steerCountersC(box)['steer_consumed']).toBe(after['steer_consumed']);
    pokeC(box, ID);   // CONTROL: with the fault gone the next steer file is written
    derivedC(box);
    expect(steerOf(box, ID, U)).toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!)));
  }, 240_000);

  it('an unrecorded generation record takes the steer file with the card, counted steer_unrecorded_removed (R-recalloff-keep)', () => {
    const box = makeHistoryBox('ccrc-hist-steer-genkeep-');
    const [ID, U] = ['steer-genkeep', sidC(0x1b41)];
    const p = plantC(box, ID, U, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b41, sessionId: U, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const genPath = path.join(box.root, 'card', ID, `${U}.gen`);
    const text = steerOf(box, ID, U);
    expect(text, 'CONTROL: a steer file stands').not.toBeNull();
    const removed = (): number => steerCountersC(box)['steer_unrecorded_removed'] ?? 0;
    const blockRecord = (): void => { fs.rmSync(genPath, { recursive: true, force: true }); fs.mkdirSync(genPath); };
    // At end-of-file: the record is due for a rewrite that fails.
    blockRecord();
    let r0 = removed();
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'at end-of-file: no steer file left beside the stale record').toBeNull();
    expect(removed(), 'at end-of-file: counted').toBe(r0 + 1);
    // CONTROL: the record unblocked, the same pass shape writes both back, and nothing is removed.
    fs.rmSync(genPath, { recursive: true });
    r0 = removed();
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'CONTROL: the steer file is written back').toBe(text);
    expect(removed(), 'CONTROL: nothing removed').toBe(r0);
    // Off end-of-file (a torn last line): a healthy record keeps both, and a record whose removal fails takes both.
    fs.appendFileSync(p, JSON.stringify(userRow({ uuid: sidC(0xbb41), ts: new Date(T0C + 3_600_000).toISOString(), sessionId: U, text: 'still being written' })));
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'CONTROL: off end-of-file a recorded steer file is kept').toBe(text);
    blockRecord();
    r0 = removed();
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'off end-of-file: no steer file left beside the stale record').toBeNull();
    expect(removed(), 'off end-of-file: counted').toBe(r0 + 1);
  }, 240_000);

  it("one steer file per id: another uuid's file and a stale temp are removed after a write, and other names stay", () => {
    const box = makeHistoryBox('ccrc-hist-steer-one-');
    const [ID, U1, U2] = ['steer-one', sidC(0x1b51), sidC(0x1b52)];
    plantC(box, ID, U1, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b51, sessionId: U1, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, ID);
    const dir = path.join(box.root, 'steer', ID);
    expect(fs.readdirSync(dir), 'CONTROL: the steer directory holds the one file and no .gen').toEqual([`${U1}.txt`]);
    fs.writeFileSync(path.join(dir, 'notes'), "not the writer's");
    fs.writeFileSync(path.join(dir, `${sidC(0x1b53)}.txt.tmp.99999`), 'a killed writer\'s temp');
    // A /clear: the registry names the new uuid, and the hook spools the clear line.
    const s2 = compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b52, sessionId: U2, startMs: T0C + 3_600_000 });
    plantSession(box, ID, { uuid: U2 });
    plantTranscript(box, 'claude', CARD_SLUG, U2, s2.rows);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U2, src: 'clear', gen: CARD_GEN });
    settleC(box);
    pokeC(box, ID);
    expect(steerOf(box, ID, U2)).toBe(expectedSteer(libCard.leafId(ID, U2, s2.headUuids[0]!)));
    expect(fs.readdirSync(dir).sort(), "U1's file and the stale temp went with the write; notes stays").toEqual([`${U2}.txt`, 'notes']);
  }, 240_000);

  it('a steer file the registry no longer names is still consumed when its boundary is ingested, with or without the card file beside it', () => {
    const box = makeHistoryBox('ccrc-hist-steer-reg-');
    const [ID, U] = ['steer-reg', sidC(0x1b61)];
    const s = compactionSequence({ n: 3, trigger: 'manual', seed: 0x1b61, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    expect(steerOf(box, ID, U)).toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!)));
    fs.rmSync(path.join(box.reg, `${ID}.uuid`));
    appendRows(p, s.rows.slice(cutBefore(s, 1), cutBefore(s, 2)));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U)).toHaveLength(2);
    expect(steerOf(box, ID, U), 'consumed, and not written again: the registry names no session').toBeNull();
    expect(steerCountersC(box)).toMatchObject({ steer_consumed: 1, steer_written: 1 });
    pokeC(box, ID);
    expect(steerOf(box, ID, U), 'still unnamed: still no steer file').toBeNull();
    plantSession(box, ID, { uuid: U });
    pokeC(box, ID);
    expect(steerOf(box, ID, U)).toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[1]!)));
    // The steer file alone: the registry names no session and no card file stands, so only the steer directory's own listing
    // finds it. It is still consumed when its boundary is ingested.
    fs.rmSync(path.join(box.reg, `${ID}.uuid`));
    for (const f of [`${U}.txt`, `${U}.gen`]) fs.rmSync(path.join(box.root, 'card', ID, f));
    appendRows(p, s.rows.slice(cutBefore(s, 2)));
    pokeC(box, ID);
    derivedC(box);
    expect(leavesC(box, U)).toHaveLength(3);
    expect(steerOf(box, ID, U), 'consumed from the steer directory alone').toBeNull();
    expect(steerCountersC(box)).toMatchObject({ steer_consumed: 2 });
    expect(cardOf(box, ID, U), 'and no card file is made for a session the registry does not name').toBeNull();
  }, 240_000);

  it('a link at steer/, steer/<id> or the file itself is never entered, read or written through', () => {
    const box = makeHistoryBox('ccrc-hist-steer-links-');
    const [ID, U] = ['steer-link', sidC(0x1b71)];
    const [ID2, U2] = ['steer-link-dir', sidC(0x1b72)];
    const [ID3, U3] = ['steer-link-root', sidC(0x1b73)];
    const s1 = compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b71, sessionId: U, startMs: T0C });
    plantC(box, ID, U, s1.rows);
    plantC(box, ID2, U2, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b72, sessionId: U2, startMs: T0C }).rows);
    settleC(box);
    // The file itself a link to a file elsewhere: never read through, and the write replaces the link, never its target.
    const victim = path.join(box.home, 'victim.txt');
    fs.writeFileSync(victim, 'the target, untouched');
    fs.mkdirSync(path.join(box.root, 'steer', ID), { recursive: true, mode: 0o700 });
    fs.symlinkSync(victim, steerPath(box, ID, U));
    // steer/<id> a link to a directory holding a file under a steer name: never entered.
    const elsewhere = path.join(box.home, 'elsewhere-steer-id');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${U2}.txt`), 'kept\n');
    fs.symlinkSync(elsewhere, path.join(box.root, 'steer', ID2));
    pokeC(box, ID, ID2);
    expect(fs.readFileSync(victim, 'utf8'), 'the link\'s target is untouched').toBe('the target, untouched');
    expect(fs.lstatSync(steerPath(box, ID, U)).isSymbolicLink(), 'the link was replaced by the write').toBe(false);
    expect(steerOf(box, ID, U)).toBe(expectedSteer(libCard.leafId(ID, U, s1.headUuids[0]!)));
    expect(fs.readdirSync(elsewhere), 'steer/<id> as a link is never entered').toEqual([`${U2}.txt`]);
    expect(fs.readFileSync(path.join(elsewhere, `${U2}.txt`), 'utf8')).toBe('kept\n');
    expect(fs.lstatSync(path.join(box.root, 'steer', ID2)).isSymbolicLink()).toBe(true);
    expect(counters(box)['steer_dir_refused'], 'the refused directory is counted').toBeGreaterThanOrEqual(1);
    // steer/ itself a link: never walked by a pass that consumes, writes or withdraws, and refused by the directory step.
    const root = path.join(box.home, 'elsewhere-steer-root');
    fs.mkdirSync(path.join(root, ID3), { recursive: true });
    fs.writeFileSync(path.join(root, ID3, `${U3}.txt`), 'kept\n');
    fs.rmSync(path.join(box.root, 'steer'), { recursive: true });
    fs.symlinkSync(root, path.join(box.root, 'steer'));
    plantC(box, ID3, U3, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b73, sessionId: U3, startMs: T0C }).rows);
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: `${FLOOR_C - 4096}:${FS_C}` } });   // a withdrawing pass
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    pokeC(box, ID3);
    expect(fs.readdirSync(path.join(root, ID3)), "the link's target is untouched").toEqual([`${U3}.txt`]);
    expect(fs.readFileSync(path.join(root, ID3, `${U3}.txt`), 'utf8')).toBe('kept\n');
    expect(counters(box)['history_dir_refused:steer'], 'the directory step refuses a link at steer/').toBeGreaterThanOrEqual(1);
  }, 240_000);

  it('history-off writes, consumes and withdraws nothing: the steer file stands as the card does (D-5062\'s arm, as today)', () => {
    const box = makeHistoryBox('ccrc-hist-steer-off-');
    const [ID, U] = ['steer-off', sidC(0x1b81)];
    const s = compactionSequence({ n: 2, trigger: 'manual', seed: 0x1b81, sessionId: U, startMs: T0C });
    const p = plantC(box, ID, U, s.rows.slice(0, cutBefore(s, 1)));
    settleC(box);
    pokeC(box, ID);
    const standing = steerOf(box, ID, U);
    expect(standing).toBe(expectedSteer(libCard.leafId(ID, U, s.headUuids[0]!)));
    const card = cardOf(box, ID, U);
    const counted = counters(box);
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    appendRows(p, s.rows.slice(cutBefore(s, 1)));
    pokeC(box, ID);   // a boundary no pass will ingest while the switch stands
    passC(box);
    expect(steerOf(box, ID, U), 'the steer file stands').toBe(standing);
    expect(cardOf(box, ID, U), 'and so does the card').toBe(card);
    expect(steerCountersC(box), 'nothing counted').toEqual(Object.fromEntries(Object.entries(counted).filter(([k]) => k.startsWith('steer_'))));
    fs.rmSync(path.join(box.home, '.ccrc', 'history-off'));
    pokeC(box, ID);
    derivedC(box);
    expect(steerCountersC(box)).toMatchObject({ steer_consumed: 1 });
  }, 240_000);

  it('writes one file per registered session, keyed on the uuid; a subagent boundary never re-mints it (G4)', async () => {
    // Two registered sessions, each with its own file.
    const box = makeHistoryBox('ccrc-hist-steer-per-session-');
    const [A, UA, B, UB] = ['steer-ps-a', sidC(0x1b91), 'steer-ps-b', sidC(0x1b92)];
    plantC(box, A, UA, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b91, sessionId: UA, startMs: T0C }).rows);
    plantC(box, B, UB, compactionSequence({ n: 1, trigger: 'manual', seed: 0x1b92, sessionId: UB, startMs: T0C }).rows);
    settleC(box);
    pokeC(box, A, B);
    expect(fs.readdirSync(path.join(box.root, 'steer')).sort()).toEqual([A, B]);
    expect(fs.readdirSync(path.join(box.root, 'steer', A))).toEqual([`${UA}.txt`]);
    expect(libCard.steerLeafOf(steerOf(box, B, UB)!.replace(/\n$/, ''))).not.toBe(libCard.steerLeafOf(steerOf(box, A, UA)!.replace(/\n$/, '')));
    // A subagent transcript of the same uuid with a boundary of its own: the step reads the main transcript's copy only.
    const fx = await store7();
    try {
      const first = await fx.run();
      expect(first.text, 'the main copy names its leaf').toBe(expectedSteer(fx.nextLeaf));
      fx.addSubagentBoundary();
      const second = await fx.run();
      expect(second.text, 'a subagent boundary re-mints nothing').toBe(first.text);
      expect(fx.counter('steer_written'), 'and writes nothing').toBe(1);
    } finally {
      fx.db.close();
    }
  }, 240_000);

  it("a purged id's steer directory is collected 7 days on, and steer/.lanes/ is never entered", () => {
    const box = makeHistoryBox('ccrc-hist-steer-purge-');
    const DAY = 24 * 60 * 60 * 1000;
    const rows = [['steer-gone', sidC(0x1ba1), 8], ['steer-young', sidC(0x1ba2), 6], ['steer-live', sidC(0x1ba3), 8]] as const;
    rows.forEach(([id, uuid], i) => plantC(box, id, uuid, [
      userRow({ uuid: sidC(0x7200 + 16 * i), ts: new Date(T0C).toISOString(), sessionId: uuid, text: 'a request' }),
      userRow({ uuid: sidC(0x7201 + 16 * i), ts: new Date(T0C + 1000).toISOString(), sessionId: uuid, text: 'a follow-up' }),
    ]));
    settleC(box);
    pokeC(box, ...rows.map(([id]) => id));
    const age = (p: string, ms: number): void => {
      const t = (Date.now() - ms) / 1000;
      fs.lutimesSync(p, t, t);
    };
    // The lane map's directory: a lane file inside it, aged past the grace, with no registry entry of that name.
    const lanes = path.join(box.root, 'steer', '.lanes');
    fs.mkdirSync(lanes, { mode: 0o700 });
    fs.writeFileSync(path.join(lanes, 'lane-a'), 'anthropic\n');
    for (const [id, uuid, days] of rows) {
      expect(steerOf(box, id, uuid), id).not.toBeNull();
      for (const p of [steerPath(box, id, uuid), path.join(box.root, 'card', id, `${uuid}.txt`), path.join(box.root, 'card', id, `${uuid}.gen`), path.join(box.root, 'card', id), path.join(box.root, 'steer', id)]) age(p, days * DAY);
    }
    for (const p of [path.join(lanes, 'lane-a'), lanes]) age(p, 8 * DAY);
    const purge = (id: string): void => {
      for (const f of fs.readdirSync(box.reg).filter((n) => n.startsWith(`${id}.`))) fs.rmSync(path.join(box.reg, f));
    };
    purge('steer-gone');
    purge('steer-young');
    passC(box);
    expect(fs.existsSync(path.join(box.root, 'steer', 'steer-gone')), "this pass's scan was not due").toBe(true);
    const r = runDriver(box, { offsetMs: libCard.SCAN_INTERVAL_MS + 60_000 });
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(fs.existsSync(path.join(box.root, 'steer', 'steer-gone')), 'registry absent and 8 days old: removed').toBe(false);
    expect(steerOf(box, 'steer-young', rows[1][1]), '6 days old: kept').not.toBeNull();
    expect(steerOf(box, 'steer-live', rows[2][1]), 'still in the registry: kept').not.toBeNull();
    expect(fs.readFileSync(path.join(lanes, 'lane-a'), 'utf8'), 'steer/.lanes/ is never entered').toBe('anthropic\n');
    expect(steerCountersC(box)).toMatchObject({ steer_files_purged: 1 });
  }, 240_000);
});

// ── prevLeafOf and the stored directive_flag, end to end through oneCard (in-process; review 1695 A1) ───────────────────
// A fixture store whose one registered session has a previous level-0 node of the test's choosing: card.mjs's
// consumeAndWriteCards runs over it exactly as the tick runs it (the registry names the session, its live copy is read to
// its end this tick), so only these cases read the stored `nodes` columns Task 1A's hand-built previous leaves do not.
interface Prev7 {
  kind?: string; status?: string; gist?: string | null; flag?: number | string; nodeId?: string;
  earliest?: number | string | null; latest?: number | string | null;
}
interface Store7 {
  home: string;
  db: DatabaseSync;
  /** The leaf the next compaction will be (the card's own prediction, by lib's span rule). */
  nextLeaf: string;
  prevId: string;
  run(): Promise<{ text: string | null }>;
  addSubagentBoundary(): void;
  counter(name: string): number;
}
const E7 = 'd7e00000-1111-4111-8111-111111111111';
const ID7 = 'steer-prev';
const store7Imports = async (): Promise<{ C: { consumeAndWriteCards(db: DatabaseSync, ictx: object, budget: object): object; ensureHistoryDirs(db: DatabaseSync, home: string): object }; S: { makeIngestCtx(home: string, homes: string[], nowMs: number, ids: unknown): Record<string, unknown>; newBudget(): object } }> => ({
  C: (await import('../../ccd/history/card.mjs')) as never,
  S: (await import('../../ccd/history/sweep.mjs')) as never,
});
async function store7(prev: Prev7 | null = null): Promise<Store7> {
  const { C, S } = await store7Imports();
  const home = mkTmp('ccrc-hist-steer-prev-');
  createStore(home);
  const P = libCard.historyPaths(home);
  const db = openWriter(P.dbFile);
  const now = Date.now();
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID7);
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E7);
  db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (1, ?, ''), (2, ?, 'agent-x')").run(E7, E7);
  db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, eof_ms, parser_version) VALUES (1, 1, 7001, 1, 'live', ?, 1), (2, 1, 7002, 2, 'live', ?, 1)").run(now, now);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 7), Buffer.from([0]));
  const ent = db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, ?, ?, ?, 'harness', 1, 0, 0, 1, ?)");
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  ent.run(1, 'd7e00000-0000-4000-8000-000000000001', 1, 'user', null, 1000);
  member.run(1, 1, 1);
  ent.run(2, 'd7e00000-0000-4000-8000-000000000002', 1, 'system', 'compact_boundary', 2000);
  db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (2, 1, 1)').run();
  member.run(1, 2, 2);
  const prevId = prev?.nodeId ?? libCard.leafId(ID7, E7, 'd7e00000-0000-4000-8000-000000000001');
  if (prev !== null) {
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, boundary_entry_id,
      earliest_ms, latest_ms, src_chars, desc_count, desc_chars, directive_flag, parser_version, created_ms)
      VALUES (?, 1, 1, 1, ?, 0, ?, ?, 2, ?, ?, 100, 0, 0, ?, 1, 1)`).run(
      prevId, prev.kind ?? 'steered_leaf', prev.status ?? 'ok', prev.gist === undefined ? 'Moved the parser into lib and kept the old reader for one release.' : prev.gist,
      prev.earliest === undefined ? Date.UTC(2026, 9, 29, 7, 5) : prev.earliest, prev.latest === undefined ? Date.UTC(2026, 9, 29, 9, 40) : prev.latest,
      prev.flag ?? 0);
  }
  fs.mkdirSync(P.reg, { recursive: true });
  fs.writeFileSync(path.join(P.reg, `${ID7}.uuid`), E7);
  C.ensureHistoryDirs(db, home);
  const ictx = S.makeIngestCtx(home, [], now, null);
  const nextLeaf = libCard.leafId(ID7, E7, libCard.predictedSpanStart({ firstRowUuid: null, lastBoundary: { uuid: 'd7e00000-0000-4000-8000-000000000002', headUuid: null } })!);
  return {
    home, db, nextLeaf, prevId,
    async run() {
      C.consumeAndWriteCards(db, ictx, S.newBudget());
      const f = path.join(P.root, 'steer', ID7, `${E7}.txt`);
      return { text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null };
    },
    addSubagentBoundary() {
      db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (3, 'd7e00000-0000-4000-8000-000000000003', 2, 'system', 'compact_boundary', 'harness', 1, 0, 0, 1, 3000)").run();
      db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (3, 2, 1)').run();
      db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (2, 3, 1)').run();
    },
    counter: (name) => Number((db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n ?? 0),
  };
}

describe("the previous leaf a steer file quotes is read from the stored node row (W3 Task 1B; review 1695 A1)", () => {
  skipOnDarwin();
  const GIST = 'Moved the parser into lib and kept the old reader for one release.';
  const quotable = (fx: Store7): libCard.SteerPrev => ({
    id: fx.prevId, range: libCard.nodeRangeText(Date.UTC(2026, 9, 29, 7, 5), Date.UTC(2026, 9, 29, 9, 40)),
    kind: 'steered_leaf', status: 'ok', gist: GIST, flag: false,
  });

  it('a stored steered ok previous leaf is quoted only when its directive_flag is 0: 0 quotes, 1 and 2 (a value derive never writes) quote nothing', async () => {
    for (const [flag, quotes] of [[0, true], [1, false], [2, false]] as const) {
      const fx = await store7({ flag });
      try {
        const { text } = await fx.run();
        expect(text, `flag ${flag}`).toBe(expectedSteer(fx.nextLeaf, quotes ? quotable(fx) : null));
        expect(text!.includes('Previous leaf'), `flag ${flag}: the lines`).toBe(quotes);
        expect(text!.includes(GIST), `flag ${flag}: the gist`).toBe(quotes);
      } finally {
        fx.db.close();
      }
    }
  });

  it('a previous leaf whose node row cannot be read quotes no gist: an unknown status or an unreadable instant answers unreadable, and the file is still written', async () => {
    const { prevLeafOf } = (await import('../../ccd/history/steer.mjs')) as unknown as {
      prevLeafOf(db: DatabaseSync, copyFileId: number, epoch: { session_pk: number; seq: number }): libCard.SteerPrev | null;
    };
    for (const [name, prev] of [
      ['a status outside lib\'s words', { status: 'bogus' }],
      ['a non-numeric earliest instant', { earliest: 'not-a-time' }],
      ['an instant out of the date range', { latest: 9e15 }],
      ['a non-finite directive_flag', { flag: 'x' }],
      ['a steered ok leaf with no gist', { gist: null }],
    ] as const) {
      const fx = await store7(prev);
      try {
        const direct = prevLeafOf(fx.db, 1, { session_pk: 1, seq: 1 });
        expect(direct?.status, `${name}: prevLeafOf`).toBe('unreadable');
        const { text } = await fx.run();
        expect(text, `${name}: the steer file`).toBe(expectedSteer(fx.nextLeaf));
        expect(fx.counter('steer_write_failed'), `${name}: nothing threw through oneCard`).toBe(0);
      } finally {
        fx.db.close();
      }
    }
  });

  // The steer text is composed (and the previous leaf read) only when a write is possible. A spy on the one statement that reads the
  // previous leaf counts it through oneCard; every off-end-of-file arm must still reach the verdict it reaches with the text.
  it('the previous leaf is read only when a write is possible: off end-of-file no composition runs, and every arm decides as it does with the text', async () => {
    const { C, S } = await store7Imports();
    const PREV_SQL = 'FROM nodes n JOIN memberships m';
    for (const [name, atEof, seed, want] of [
      ['CONTROL: at end-of-file with no file, a write composes once', true, null, 'written'],
      ['off end-of-file, no file: none', false, null, 'absent'],
      ['off end-of-file, this leaf as written: keep', false, 'own', 'kept'],
      ['off end-of-file, this leaf re-rendered (another previous gist): keep', false, 'rerendered', 'kept'],
      ['off end-of-file, another leaf (consumed): delete', false, 'other', 'deleted'],
      ['off end-of-file, an empty file: delete (an empty text is not the line)', false, '', 'deleted'],
      ['off end-of-file, text that is no steer file: delete', false, 'not a steer file\n', 'deleted'],
    ] as const) {
      const fx = await store7({});
      try {
        const f = path.join(libCard.historyPaths(fx.home).root, 'steer', ID7, `${E7}.txt`);
        const own = (await fx.run()).text!;   // at end-of-file: the file as the writer makes it
        fs.rmSync(f);
        if (seed === 'own') fs.writeFileSync(f, own);
        else if (seed === 'rerendered') fs.writeFileSync(f, `${own}Previous leaf, context only, do not repeat it: [stale]\n`);
        else if (seed === 'other') fs.writeFileSync(f, own.replace(fx.nextLeaf, `L${'0'.repeat(20)}`));
        else if (seed !== null) fs.writeFileSync(f, seed);
        let reads = 0;
        const spy = new Proxy(fx.db, {
          get(target, prop) {
            const v = Reflect.get(target, prop, target) as unknown;
            if (typeof v !== 'function') return v;
            if (prop !== 'prepare') return (v as (...a: unknown[]) => unknown).bind(target);
            return (sql: string) => {
              const st = (v as (q: string) => Record<string, unknown>).call(target, sql);
              if (!sql.includes(PREV_SQL)) return st;
              return new Proxy(st, {
                get(t, p) {
                  const m = Reflect.get(t, p, t) as unknown;
                  if (typeof m !== 'function') return m;
                  return (...a: unknown[]) => { if (p === 'get') reads += 1; return (m as (...x: unknown[]) => unknown).apply(t, a); };
                },
              });
            };
          },
        }) as DatabaseSync;
        const eofMs = Number((fx.db.prepare('SELECT eof_ms FROM ingest_files WHERE file_id = 1').get() as { eof_ms: number }).eof_ms);
        const ictx = S.makeIngestCtx(fx.home, [], atEof ? eofMs : eofMs + 1, null);
        C.consumeAndWriteCards(spy, ictx, S.newBudget());
        const after = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
        expect(reads, `${name}: previous-leaf reads`).toBe(atEof ? 1 : 0);
        if (want === 'written') expect(after).toBe(own);
        else if (want === 'absent' || want === 'deleted') expect(after, name).toBeNull();
        else expect(after, name).toBe(seed === 'own' ? own : `${own}Previous leaf, context only, do not repeat it: [stale]\n`);
      } finally {
        fx.db.close();
      }
    }
  });

  it("prevLeafOf answers unreadable for a node_id off the grammar, null when the copy has no level-0 node, and the row's own fields otherwise", async () => {
    const { prevLeafOf } = (await import('../../ccd/history/steer.mjs')) as unknown as {
      prevLeafOf(db: DatabaseSync, copyFileId: number, epoch: { session_pk: number; seq: number }): libCard.SteerPrev | null;
    };
    const none = await store7(null);
    try {
      expect(prevLeafOf(none.db, 1, { session_pk: 1, seq: 1 }), 'no node: null').toBeNull();
    } finally {
      none.db.close();
    }
    const ok = await store7({});
    try {
      expect(prevLeafOf(ok.db, 1, { session_pk: 1, seq: 1 })).toEqual(quotable(ok));
      expect(prevLeafOf(ok.db, 2, { session_pk: 1, seq: 1 }), "another copy's boundary is not this copy's").toBeNull();
    } finally {
      ok.db.close();
    }
    for (const nodeId of ['Lxyz', `L${'0'.repeat(19)}`, `X${'0'.repeat(20)}`, `L${'0'.repeat(20)}0`, `L${'G'.repeat(20)}`]) {
      const fx = await store7({ nodeId });
      try {
        expect(prevLeafOf(fx.db, 1, { session_pk: 1, seq: 1 })?.status, nodeId).toBe('unreadable');
      } finally {
        fx.db.close();
      }
    }
  });
});
