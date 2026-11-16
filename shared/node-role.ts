// Leaf module for NodeRole — extracted from api.ts so that server/src/config.ts
// (and the test helpers that transitively reach it) do not pull in the
// ~10k-line api.ts at runtime.  api.ts re-exports everything below, so every
// existing import keeps working.  This file is L0 like the rest of shared/:
// no runtime imports, nothing from node:*. Any type it uses stays as a
// type-only import from api.ts (none needed here — NodeRole is self-contained).

/** A node's role (§6 `nodes.role`): the bash spine's `CCRC_ROLE` words. A
 *  token outside the list reads `null` on the wire. */
export type NodeRole = 'server' | 'fleet' | 'both';
export const NODE_ROLES = ['server', 'fleet', 'both'] as const satisfies readonly NodeRole[];
/** Use THIS, never `NODE_ROLES.includes(x as NodeRole)` — `isRunState`'s rule. */
export function isNodeRole(v: unknown): v is NodeRole {
  return typeof v === 'string' && (NODE_ROLES as readonly string[]).includes(v);
}
