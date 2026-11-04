// Export's colouring, read and counted (spec 2026-10-01 4.17 "Highlighting"; M4.EX18; native Docs reader W5, Export).
// `exportEntry` is the ONE reading of a drawn code block for Export: the page's store says first whether it skipped this
// very copy (`copySkip(at)`, `at` being the block's own `pre` element; review 1364 F1), else what its key holds (`peek`).
// It never calls `request`, so building an export asks no highlighter anything. The builder draws each block through it
// and `exportColouring` counts through it, so the file and its provenance cannot disagree. A block is counted as the sink
// draws it: an `html` entry the check never made (`isCheckedHighlightHtml` false) is drawn plain, so it counts `failed`;
// a worker `unregistered` answer, like a block in no registered grammar, is not counted, since nothing would colour it.
//
// Ring L1: pure; it reads a store it is given.
import {
  UNREQUESTED_ENTRY, blockKey, isCheckedHighlightHtml,
  type BlockKey, type CodeBlockText, type HighlightEntry, type HighlightStore, type PlainCause,
} from '../../lib/highlightStore';
import type { ExportPlain } from './policy';

/** What an export's colouring came to: the coloured blocks, the plain ones by class, or that colouring was dropped to fit
 *  the size limit (then nothing is counted by class). */
export interface ExportColouring {
  readonly coloured: number;
  readonly plain: ReadonlyMap<ExportPlain, number>;
  readonly dropped: boolean;
}

/** The entry a drawn block shows: `UNREQUESTED_ENTRY` (plain) with no store or no key; else the store's verdict on this
 *  copy, then its key's entry. */
export function exportEntry(store: HighlightStore | null, answer: BlockKey, at: object | undefined): HighlightEntry {
  if (store === null || answer.kind !== 'key') return UNREQUESTED_ENTRY;
  const skipped = at === undefined ? null : store.copySkip(at);
  return skipped === null ? store.peek(answer.key) : { kind: 'skipped', ceiling: skipped };
}

/** A failure's class; `null`: not counted. */
function plainClassOf(first: PlainCause): ExportPlain | null {
  switch (first.kind) {
    case 'timeout':
      return 'timeout';
    case 'too-large':
      return 'too-large';
    case 'worker-unavailable':
      return 'no-worker';
    case 'unregistered':
      return null;
    case 'threw':
    case 'malformed':
    case 'worker-failed':
    case 'line-too-long':
      return 'failed';
  }
}

/** Every block of `blocks` (a tree's `codeBlocksOf`, or a text leaf's one block), counted by what it draws. `dropped`:
 *  the builder rendered with no store to fit the size limit. `store: null` has one meaning: no store, which only goes
 *  with `dropped` (a text leaf with no grammar has no block to count, so it never reaches this). */
export function exportColouring(
  blocks: readonly CodeBlockText[], store: HighlightStore | null, dropped: boolean,
): ExportColouring {
  const plain = new Map<ExportPlain, number>();
  if (dropped) return { coloured: 0, plain, dropped: true };
  let coloured = 0;
  const count = (word: ExportPlain): void => {
    plain.set(word, (plain.get(word) ?? 0) + 1);
  };
  for (const b of blocks) {
    const answer = store === null ? blockKey(b.lang, b.raw) : store.keyOf(b.lang, b.raw);
    if (answer.kind === 'unregistered') continue;
    if (answer.kind === 'over-cap') {
      count('over-cap');
      continue;
    }
    const entry = exportEntry(store, answer, b.at);
    switch (entry.kind) {
      case 'html':
        if (isCheckedHighlightHtml(entry.checked)) coloured += 1;
        else count('failed');
        break;
      case 'skipped':
        count('page-ceiling');
        break;
      case 'plain': {
        const word = plainClassOf(entry.first);
        if (word !== null) count(word);
        break;
      }
      case 'unrequested':
      case 'pending':
        // A settled store has none; drawn plain, so counted, never left out.
        count('failed');
        break;
    }
  }
  return { coloured, plain, dropped: false };
}
