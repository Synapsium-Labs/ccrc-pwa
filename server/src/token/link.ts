// The driver's two fleet adapters, ring L3: the `token-sync` op over the one
// agent connection, and the fleet's `box-token-generation` read through the
// inventory's own `readNodeFile` (lstat-gated, size-capped, deadline-bounded;
// D-4389). Neither narrows what it received: every answer of the op is one
// `SyncResult` arm, and the generation read keeps absent, unreadable and an id
// apart (`readGenerationFile`, the one reader).
import path from 'node:path';
import { AgentOpError, LinkNotSentError, type FleetClient } from '../remote/client.js';
import type { FleetIO } from '../io.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from '../update/inventory.js';
import { openPoolReadDeadline } from '../pools.js';
import {
  NODE_FILES, TOKEN_SYNC_OP, TOKEN_SYNC_OP_TIMEOUT_MS, isTokenSyncOpError, readTokenTransport,
} from '../../../shared/agent-protocol.js';
import { GENERATION_ID_RE, readGenerationFile } from '../../../shared/box-token.js';
import type { GateRowsSource, GenerationReader, TokenSyncLink } from './ports.js';
import type { GateNode, SyncResult } from './policy.js';
import { NODE_ID_RE, type NodeRow } from '../coord/store.js';

const LOST_WORDS = ['timeout', 'disconnected', 'aborted'] as const;

/** `request` with the op's own 50 s deadline (`FleetClient`'s default is 15 s). `bad-request` from this op means
 *  the agent predates it; a `LinkNotSentError` means the frame never left; a plain Error after the send (timeout,
 *  disconnected, aborted) is a LOST result — the fleet may already hold the value. */
export function tokenSyncLinkOver(client: Pick<FleetClient, 'request'>): TokenSyncLink {
  return {
    async send(code: string): Promise<SyncResult> {
      try {
        const res = await client.request({ t: 'req', op: TOKEN_SYNC_OP, code }, TOKEN_SYNC_OP_TIMEOUT_MS);
        const synced = (res as { synced?: unknown }).synced;
        if (typeof synced === 'string' && GENERATION_ID_RE.test(synced)) {
          return { kind: 'synced', generation: synced, transport: readTokenTransport((res as { transport?: unknown }).transport) };
        }
        return { kind: 'refused', word: 'spawn-failed', detail: 'the agent answered ok without a generation id' };
      } catch (e) {
        if (e instanceof AgentOpError) {
          if (e.code === 'bad-request') return { kind: 'predates-op' };
          if (isTokenSyncOpError(e.code)) return { kind: 'refused', word: e.code, detail: e.detail };
          return { kind: 'refused', word: 'spawn-failed', detail: e.detail ?? e.code };
        }
        if (e instanceof LinkNotSentError) return { kind: 'unsent' };
        const m = e instanceof Error ? e.message : '';
        const why = (LOST_WORDS as readonly string[]).includes(m) ? (m as (typeof LOST_WORDS)[number]) : 'disconnected';
        return { kind: 'lost', why };
      }
    },
  };
}

/** One bounded read of `<ccrcDir>/box-token-generation` over the fleet's io; `measuredAt` is taken AFTER the
 *  read resolved, so a confirmation can never predate what it read (D-4389). Never rejects. */
export function generationReaderOver(io: FleetIO, ccrcDir: string, now: () => number): GenerationReader {
  return {
    async read() {
      const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
      try {
        const r = await readNodeFile(io, path.join(ccrcDir, NODE_FILES.tokenGeneration), deadline);
        return { read: readGenerationFile(r), measuredAt: now() };
      } catch {
        return { read: { kind: 'unreadable' }, measuredAt: now() };
      } finally {
        deadline?.close();
      }
    },
  };
}

/** The gate's rows over the inventory's live node rows (an addition to the contract, which placed this mapping in
 *  `index.ts`; a mapping is adapter work, and L5 composes only). `nodeIdMeasured` is the store's own `NODE_ID_RE`,
 *  never re-spelled. A null store is "no coord" (the hold `no-coord`). */
export function gateRowsOver(store: { nodes(): NodeRow[] } | null, linkUp: () => boolean, lastReadyAt: () => number | null): GateRowsSource {
  return {
    nodes: (): readonly GateNode[] | null => store === null ? null : store.nodes().map((n) => ({
      nodeId: n.nodeId, nodeIdMeasured: NODE_ID_RE.test(n.nodeId), label: n.label, role: n.role, reachable: n.reachable,
      os: n.os, caps: n.caps, agentOps: n.agentOps, updateState: n.updateState, reportedPhase: n.reportedPhase,
    })),
    linkUp,
    lastReadyAt,
  };
}
