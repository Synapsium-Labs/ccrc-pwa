// ccd/history/fts-structure.mjs — an FTS5 index's structure record, read, and the merge step's one decision
// (D-8726, history-fts-fold-once; spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §6.2).
//
// L1: pure. It takes the record's bytes and answers values; store.mjs reads the bytes, sweep.mjs runs the merge, and
// lib.mjs's deriveHealth judges the counts. It imports only lib.mjs's thresholds.
//
// The record is FTS5's own, row id 10 of `<table>_data` (FTS5_STRUCTURE_ROWID, ext/fts5/fts5_index.c,
// fts5StructureDecode): a 4-byte cookie; the V2 marker ff 00 00 01 when the table is contentless_delete; then nLevel,
// nSegment and nWriteCounter; then per level nMerge and nSeg, and per segment iSegid, pgnoFirst and pgnoLast, with five
// more in V2 (iOrigin1, iOrigin2, nPgTombstone, nEntryTombstone, nEntry). Every number is an SQLite varint: big-endian
// 7-bit groups, the high bit set on every byte but the last, a 9th byte taken whole.
import { FTS_SEGMENTS_DRAIN } from './lib.mjs';

/** The structure record's row id in `<table>_data`. */
export const FTS_STRUCTURE_ROWID = 10;
/** decideFtsMerge's arms: continue the merge in progress, fold every segment into one new merge, or drain without folding. */
export const FTS_MERGE_ARMS = Object.freeze(['continue', 'fold', 'drain']);

const V2_MARKER = [0xff, 0x00, 0x00, 0x01];

/** One varint at `at`: [value, next offset], or null when the bytes end inside it. */
function varintAt(b, at) {
  let v = 0;
  for (let k = 0; k < 9; k += 1) {
    if (at + k >= b.length) return null;
    const c = b[at + k];
    if (k === 8) return [v * 256 + c, at + 9];
    v = v * 128 + (c & 0x7f);
    if ((c & 0x80) === 0) return [v, at + k + 1];
  }
  return null;
}

/** The structure record's bytes → `{ state: 'ok', v2, nLevel, nSegment, levels: [{ nMerge, nSeg, segids }], tombstonePages }`;
 *  `{ state: 'missing' }` for no record; `{ state: 'unreadable' }` for bytes FTS5 itself would call corrupt (cut short, a
 *  level merging more segments than it holds, or levels that do not sum to nSegment). Never throws. */
export function parseFtsStructure(block) {
  if (block === null || block === undefined) return { state: 'missing' };
  if (!(block instanceof Uint8Array) || block.length < 4) return { state: 'unreadable' };
  let at = 4;
  const v2 = block.length >= 8 && V2_MARKER.every((x, i) => block[4 + i] === x);
  if (v2) at = 8;
  const next = () => {
    const r = varintAt(block, at);
    if (r === null) throw new RangeError('cut short');
    at = r[1];
    return r[0];
  };
  try {
    const nLevel = next();
    const nSegment = next();
    next();   // nWriteCounter
    const levels = [];
    let seen = 0;
    let tombstonePages = 0;
    for (let l = 0; l < nLevel; l += 1) {
      const nMerge = next();
      const nSeg = next();
      if (nMerge > nSeg) return { state: 'unreadable' };
      const segids = [];
      for (let s = 0; s < nSeg; s += 1) {
        segids.push(next());
        next(); next();   // pgnoFirst, pgnoLast
        if (v2) { next(); next(); tombstonePages += next(); next(); next(); }
      }
      seen += nSeg;
      levels.push({ nMerge, nSeg, segids });
    }
    if (seen !== nSegment) return { state: 'unreadable' };
    return { state: 'ok', v2, nLevel, nSegment, levels, tombstonePages };
  } catch {
    return { state: 'unreadable' };
  }
}

/** The rank of the merge step's next `'merge'` on one table, from its structure, as `{ arm, pages }`:
 *  - `continue` (+pages) while any level has a merge in progress: FTS5 continues that level's merge into the output segment
 *    it already has, allocating no segment id, and deletes the inputs when it ends;
 *  - `drain` (+pages) from FTS_SEGMENTS_DRAIN segments up, or when the record cannot be read: never a fold, which takes a new
 *    segment id; a positive merge only merges a level holding usermerge segments;
 *  - `fold` (-pages) otherwise: FTS5 puts every segment on one level and starts one merge of them all, which rewrites every
 *    segment, so the bytes a contentless delete left are purged when it ends (§6.2, O47). A record that is missing has
 *    nothing to fold, and the fold is a no-op. */
export function decideFtsMerge(structure, pages) {
  if (structure.state === 'missing') return { arm: 'fold', pages: -pages };
  if (structure.state !== 'ok') return { arm: 'drain', pages };
  if (structure.levels.some((l) => l.nMerge > 0)) return { arm: 'continue', pages };
  if (structure.nSegment >= FTS_SEGMENTS_DRAIN) return { arm: 'drain', pages };
  return { arm: 'fold', pages: -pages };
}
