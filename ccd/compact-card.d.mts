// ccd/compact-card.d.mts — types for the vitest import of compact-card.mjs
// (the `shared/mark.d.mts` precedent). Hand-written; grows with each task.
export const EXIT: Readonly<{ OK: 0; FAILURE: 1; USAGE: 2; EMPTY: 3 }>;
export const WINDOW_CAP: number;
export const CHUNK: number;
export interface WindowResult { text: string; boundary: boolean }
export function isBoundaryLine(line: string): boolean;
export function readWindow(path: string, cap?: number, chunkSize?: number): WindowResult;
export function parseArgs(argv: string[]):
  { cmd: string | undefined; opts: Record<string, string | true>; error?: undefined } | { error: string; cmd?: undefined; opts?: undefined };
export function main(argv: string[]): number;
export type Tag = 'edited' | 'touched' | 'carried';
export const TAGS: readonly Tag[];
export const WORKSET_CAP: number;
export interface Token { token: string; tag: Tag }
export interface SetFile { path: string; tag: Tag; count: number }
export interface SetStats { tokens: number; resolved: number; ambiguous: number; outside: number; nomatch: number }
export function extensionsOf(files: Iterable<string>): string[];
export function tokenRegex(exts: string[]): RegExp | null;
export function mineTokens(windowText: string, re: RegExp | null): Token[];
export interface FileIndex { files: Set<string>; byBase: Map<string, string[]> }
export function fileIndex(files: Iterable<string>): FileIndex;
export function resolveToken(token: string, index: FileIndex, cwd: string):
  { path: string; reason?: undefined } | { reason: 'outside' | 'ambiguous' | 'nomatch'; path?: undefined };
export function workingSet(tokens: Token[], index: FileIndex, cwd: string, cap?: number): { files: SetFile[]; stats: SetStats };
export interface GraphNode { id: string; label: string; source_file: string; source_location?: string; community?: number; metadata?: { kind?: string } }
export interface GraphLink { source: string; target: string; relation: string }
export const GRAPH_MAX_BYTES: number;
export function readBoundedDescriptor(fd: number, maxBytes: number,
  read?: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number): string;
export interface Graph { nodes: Map<string, GraphNode>; byFile: Map<string, GraphNode[]>; files: Set<string>; index: FileIndex; links: GraphLink[]; degree: Map<string, number> }
export function loadGraph(graphPath: string, maxBytes?: number): Graph;
export function loadLabels(labelsPath: string): Record<string, string>;
export interface FileFacts { community: string | null; symbols: string[]; usedBy: string[] }
export function fileFacts(file: string, graph: Graph, labels: Record<string, string>, workset: Set<string>): FileFacts;
export interface CompactSet {
  v: 1; at: number; nonce: string; scope: 'main' | 'subagent' | 'ambiguous'; agent: string | null; transcript: string | null;
  parentLive: boolean | null; liveAgents: number | null;
  cwd: string | null; built: string | null; fresh: string | null; steered: boolean; served: boolean;
  files: SetFile[] | null; stats: SetStats | null;
}
export function slotIsMine(setPath: string, nonce: string): CompactSet | null;
export function renderCard(set: CompactSet & { files: SetFile[] }, graph: Graph, labels: Record<string, string>,
  opts: { maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent'; agent: string | null }): string;
export function cardCommand(o: {
  transcript: string; cwd: string; graph: string; labels: string; out: string; set: string;
  maxChars: number; maxFiles: number; built: string; fresh: string; scope: 'main' | 'subagent';
  agent: string | null; at: number; nonce: string;
  writeAtomic?: (target: string, text: string) => void;
}): number;
