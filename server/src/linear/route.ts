/**
 * Workspace routing (#1444, D-7668; spec 2026-10-31 §4.2): which Linear slot a call reaches, from what it names.
 *
 * L1 POLICY: pure and total. It imports types only, makes no I/O and never calls Linear, so routing costs a call
 * nothing and cannot spend its deadline (§4.3, §6.6). A miss is answered here at once; refreshing what the slots know
 * is the background refresher's (`refresher.ts`), never a request's.
 *
 * NEVER A GUESS. Team keys are compared uppercased (a key can repeat across Linear workspaces), and where two slots
 * match, the answer is a refusal that names them, never the first match. An issue reference's prefix is a ROUTING HINT
 * only: it picks the slot, and the issue's team is whatever Linear says it is now (§4.5).
 */
import type { LinearSlotRef, LinearStoreRead } from './store.js';

/** A slot as the router reads it: where it points, and what its last check learned (nothing, when none has). */
export interface LinearRouteSlot {
  ref: LinearSlotRef;
  /** The workspace's id. Always known for a file slot (it is the file's name); the legacy slot is routable only once
   *  its Check again has learned it. */
  workspaceId: string;
  /** The workspace's URL key (`--workspace`), or null when no check of the present key has learned it. */
  urlKey: string | null;
  /** The team keys the key's user reaches, uppercased; empty when nothing is learned. */
  teamKeys: readonly string[];
}

/** What a call names (§4.2's input). `issue`: an issue reference's prefix, a hint. `team`: `--team`, or a body's
 *  `team`. `workspace`: a workspace-wide verb. Each may also name a workspace by its URL key. */
export type LinearRouteAsk =
  | { kind: 'issue'; prefix: string; workspace: string | null }
  | { kind: 'team'; team: string; workspace: string | null }
  | { kind: 'workspace'; workspace: string | null };

/** The router's refusal words (spec §6.8): `team-unknown` and `workspace-unknown` (404), `team-ambiguous` and
 *  `workspace-required` (409), `not-configured` (501). */
export type LinearRouteRefusal = 'team-unknown' | 'workspace-unknown' | 'workspace-required' | 'not-configured';

export type LinearRoute =
  | { kind: 'slot'; slot: LinearRouteSlot }
  | { kind: 'refused'; word: LinearRouteRefusal }
  /** `candidates`: the matching slots' URL keys, sorted, for the detail: `--workspace` is the remedy. */
  | { kind: 'refused'; word: 'team-ambiguous'; candidates: string[] };

type Listed = Extract<LinearStoreRead, { kind: 'listed' }>;

/**
 * The slots a store read can route (§3.4). Every file slot is one: its id is its workspace's, and its URL key and teams
 * are its record's only while that record describes the key now in the file (the digest rule), so a record left by a
 * replaced key routes nothing. The legacy slot is one only once its Check again has learned its workspace (a
 * `legacy-teams.json` whose digest matches), and never while a file slot holds that workspace: the file slot wins, so
 * one workspace never routes ambiguously against itself.
 */
export function routableSlots(store: Listed): LinearRouteSlot[] {
  const out: LinearRouteSlot[] = store.slots.map((s) => {
    const current = s.key.kind === 'key' && s.record.kind === 'details' && s.record.details.keyDigest === s.key.digest
      ? s.record.details : null;
    return {
      ref: { source: 'file', id: s.id },
      workspaceId: s.id,
      urlKey: current?.urlKey ?? null,
      teamKeys: (current?.teams ?? []).map((t) => t.key.toUpperCase()),
    };
  });
  const legacy = store.legacy;
  if (legacy !== null && legacy.workspace !== null && !legacy.superseded) {
    out.push({
      ref: { source: 'legacy' },
      workspaceId: legacy.workspace.workspaceId,
      urlKey: legacy.workspace.urlKey,
      teamKeys: legacy.workspace.teams.map((t) => t.key.toUpperCase()),
    });
  }
  return out;
}

/** Whether a slot holds a team: both sides uppercased, whoever built the slot. */
const holds = (s: LinearRouteSlot, team: string): boolean => s.teamKeys.some((k) => k.toUpperCase() === team.toUpperCase());

/** §4.2's table. Total: every ask answers one slot or one refusal word. */
export function routeLinear(slots: readonly LinearRouteSlot[], ask: LinearRouteAsk): LinearRoute {
  if (slots.length === 0) return { kind: 'refused', word: 'not-configured' };

  // A named workspace first: every row that names one is answered within it.
  if (ask.workspace !== null) {
    const named = slots.filter((s) => s.urlKey !== null && s.urlKey === ask.workspace);
    if (named.length === 0) return { kind: 'refused', word: 'workspace-unknown' };
    // Two slots claiming one URL key (a store a later check repairs) are never chosen between.
    if (named.length > 1) return { kind: 'refused', word: 'workspace-required' };
    const only = named[0]!;
    // An issue reference with a workspace takes that slot whatever its prefix (§4.5 resolves the team), so a prefix
    // two workspaces share, or one no slot holds any more, can still be reached.
    if (ask.kind === 'team' && !holds(only, ask.team)) return { kind: 'refused', word: 'team-unknown' };
    return { kind: 'slot', slot: only };
  }

  if (ask.kind === 'workspace') {
    return slots.length === 1 ? { kind: 'slot', slot: slots[0]! } : { kind: 'refused', word: 'workspace-required' };
  }

  const key = ask.kind === 'team' ? ask.team : ask.prefix;
  const holding = slots.filter((s) => holds(s, key));
  if (holding.length === 1) return { kind: 'slot', slot: holding[0]! };
  if (holding.length === 0) return { kind: 'refused', word: 'team-unknown' };
  const candidates = holding.flatMap((s) => (s.urlKey === null ? [] : [s.urlKey])).sort();
  return { kind: 'refused', word: 'team-ambiguous', candidates };
}
