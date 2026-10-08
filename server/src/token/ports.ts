// Box-token ports, ring L2: interfaces and their failure contracts, declared
// by their consumer, the driver (`token/driver.ts`). The read vocabularies the
// file adapter answers in (`ValueRead`, `StateRead`, `RetiredRead`) are
// declared HERE and re-exported by `token/files.ts`, so this file imports no
// adapter: L2 depends on L1 and L0 only.
import type {
  BoxTokenState, GateNode, GenerationObservation, SyncResult, WriteRecord,
} from './policy.js';

/** Every path derives from `dir = path.dirname(cfg.mailTokenPath)`, so `CCRC_MAIL_TOKEN_PATH` moves them all;
 *  `fleetFile` and `agentEnv` derive from the home. */
export interface TokenPaths {
  dir: string; current: string; previous: string;
  pending(id: string): string;
  state: string; retired: string; generation: string;
  fleetFile: string; agentEnv: string;
}

/** lstat's answer for a value file, never its bytes. */
export interface FileMeta { dev: number; ino: number; mtimeMs: number; mode: number; kind: 'regular' | 'symlink' | 'other' }

/** Four outcomes, never folded (CLAUDE.md "No overloaded null at a seam"). `absent` is a proven ENOENT of the
 *  path itself; `unreadable` carries the errno word (EACCES, EISDIR, ELOOP, EIO, or ENOENT for a link whose
 *  target is gone). */
export type ValueRead =
  | { kind: 'value'; value: string; meta: FileMeta }
  | { kind: 'absent' }
  | { kind: 'unusable'; meta: FileMeta }
  | { kind: 'placeholder' }
  | { kind: 'unreadable'; code: string };
export type StateRead = { kind: 'state'; state: BoxTokenState } | { kind: 'absent' } | { kind: 'unusable' };
export type RetiredRead = { kind: 'retired'; digests: string[] } | { kind: 'absent' } | { kind: 'unusable' };

/** The driver's file store. Every write is the atomic, fsynced, 0600-from-birth write; a rejection means the
 *  target is unchanged. `removeValue` treats ENOENT as success. `renameOver` is one atomic replace followed by a
 *  directory fsync (promotion step (c), spec §5). */
export interface TokenStore {
  readonly paths: TokenPaths;
  readState(): Promise<StateRead>;
  writeState(s: BoxTokenState): Promise<void>;
  readValue(p: string): Promise<ValueRead>;
  writeValue(p: string, value: string): Promise<WriteRecord>;
  removeValue(p: string): Promise<void>;
  renameOver(from: string, to: string): Promise<void>;
  readRetired(): Promise<RetiredRead>;
  appendRetired(digestHex: string, at: number): Promise<void>;
  mintValue(): string; mintGenerationId(): string; mintClaimCode(): string;
}

/** The one op the driver sends. Never rejects: every outcome is a `SyncResult`. */
export interface TokenSyncLink { send(code: string): Promise<SyncResult> }

/** The fleet's `box-token-generation`, with `measuredAt` taken after the read resolved (D-4389). Never rejects. */
export interface GenerationReader { read(): Promise<GenerationObservation> }

/** The gate's node rows (`null` when there is no coord), the link, and the time of the last `ready`. */
export interface GateRowsSource { nodes(): readonly GateNode[] | null; linkUp(): boolean; lastReadyAt(): number | null }

/** A recorded-both box's own write: the fleet file, then the generation file when `generation` is non-null.
 *  A rejection means the fleet file may be unchanged; nothing is promoted on one. */
export interface BothRoleWriter { write(value: string, generation: string | null): Promise<void> }
