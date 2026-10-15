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
