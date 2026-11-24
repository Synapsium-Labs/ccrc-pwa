// ccd/history/fts-structure.d.mts — types for the vitest import of fts-structure.mjs (the store.d.mts precedent).
// Hand-written; nothing machine-checks it against fts-structure.mjs, so every export is declared here. D-8726.
export const FTS_STRUCTURE_ROWID: 10;
export type FtsMergeArm = 'continue' | 'fold' | 'drain';
export const FTS_MERGE_ARMS: readonly ['continue', 'fold', 'drain'];
export interface FtsLevel { readonly nMerge: number; readonly nSeg: number; readonly segids: readonly number[] }
export type FtsStructure =
  | { readonly state: 'ok'; readonly v2: boolean; readonly nLevel: number; readonly nSegment: number; readonly levels: readonly FtsLevel[]; readonly tombstonePages: number }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable' };
export function parseFtsStructure(block: Uint8Array | null | undefined): FtsStructure;
export function decideFtsMerge(structure: FtsStructure, pages: number): { arm: FtsMergeArm; pages: number };
