// The agent link's readout (W2 Task S9, D-5472): the status bar's dot and word for the one `/api/fleet/health` poll
// (`useFleetChrome().health`). Pure, so the word is decided once and a part only places it.
import type { FleetHealth, SessionBucket } from '../../../shared/api';

export interface AgentLink {
  /** The `StatusDot` bucket that draws it: the identity core's lamps, never a skin's own colour. */
  readonly dot: SessionBucket;
  readonly word: string;
}

/** The fact that a remote fleet's agent is not connected; false while no answer has come, and in local mode. */
export function agentDown(health: FleetHealth | null): boolean {
  return health !== null && health.mode !== 'local' && !health.connected;
}

/** No answer yet is "checking", never an all-clear; local mode has no second box to link to. */
export function agentLink(health: FleetHealth | null): AgentLink {
  if (health === null) return { dot: 'idle', word: 'agent: checking' };
  if (health.mode === 'local') return { dot: 'done', word: 'local' };
  return agentDown(health) ? { dot: 'dead', word: 'agent down' } : { dot: 'done', word: 'agent connected' };
}
