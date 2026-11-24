// L1, context C3 (Session Conversation): the operator's two hand-offs into the renewal lane (Overlord spec §3.3.11, Table
// 11.1e row "The operator's Renew now"; W1a, the hand-offs piece, plan `w1a-renewal-handoffs.md` Tasks 1 and 2). Pure: the
// routes and the generations lane read the rows and act; these say what the rows mean.
//
// - `renewDoorVerdict`: may the operator's Renew now be recorded for this session? Only a session with a live generation of a
//   long-lived role (the renewal lane mints generations for nothing else, so a generation is the measured "long-lived", and
//   the one the request will act on), and only once until the lane has read the request before it.
// - `renewNowStands`: the `operator` row's input, `renewNow`. While the `continuity` row is live, a live-pressed request the
//   lane reads this pass, or an operator due the generation already carries, so a Renew now whose renewal waits (a
//   capability, the Overlord first) stays due until the renewal starts or the generation ends, rather than for one pass.
//   In shadow it is never true (ruling F1 on review 2312): a shadow pass never writes an `operator` due, and its due write
//   clears one a lowered row left, so a Renew now never renews at the flip.
// - `promptRenewing`: the console's prompt route answers `renewing` while the session's live generation's `state` is
//   `clearing` or `carded`: the session is between conversations, and a prompt typed now would land in neither.
import { FLEET_ROLES } from '../../../shared/fleetRoles.js';
import { RENEWAL_MODE_DEFAULT, isRenewalMode, type GenerationState, type RenewalMode, type RenewalTrigger } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';

/** The door's answer: record it, or why not. `unmeasured` when a row it needs could not be read. */
export type RenewDoorVerdict = 'ok' | 'renew-not-long-lived' | 'renew-pending' | 'unmeasured';

/** What the door read: the session's live generation (its role), and whether a request of its stands past the lane's cursor. */
export interface RenewDoorFacts {
  readonly live: { readonly role: FleetRole } | null | 'unmeasured';
  readonly pending: boolean | 'unmeasured';
}

export function renewDoorVerdict(f: RenewDoorFacts): RenewDoorVerdict {
  if (f.live === 'unmeasured') return 'unmeasured';
  if (f.live === null || !FLEET_ROLES[f.live.role].longLived) return 'renew-not-long-lived';
  if (f.pending === 'unmeasured') return 'unmeasured';
  return f.pending ? 'renew-pending' : 'ok';
}

/** `renewalDue`'s `renewNow` for one generation: while the `continuity` row is live, a request pressed live and read this
 *  pass, or the operator due it already carries; in shadow, never. */
export function renewNowStands(requested: boolean, dueWhy: RenewalTrigger | null, live: boolean): boolean {
  return live && (requested || dueWhy === 'operator');
}

/** The states in which a session is between conversations (the renewal's `clearing`, and `carded` before its card is read).
 *  `checkpointed` is deliberately not one (review 2312 F4): the old conversation is live then and is being asked for its
 *  handover note, so a prompt typed in it is answered and can enter the note; the spec holds prompts only between
 *  conversations. */
const BETWEEN: ReadonlySet<GenerationState> = new Set<GenerationState>(['clearing', 'carded']);

/** Does the prompt route answer `renewing`? It reads the live generation's `state`, never `shadowState`: `state` moves only
 *  while `continuity` is live, so a shadow walk never holds a prompt (ruling R1). No generation types as today. */
export function promptRenewing(state: GenerationState | null): boolean {
  return state !== null && BETWEEN.has(state);
}

/** The Setting "when soft renewals happen" as the store read it: a stored word through the one narrowing, a lost row the
 *  default; a word this build does not know, or a read that failed, is null (the door shows it as unreadable, and the lane
 *  takes the default, which waits for the operator's break: the safer of the two). */
export function renewalModeOf(r: { kind: 'row'; mode: unknown } | { kind: 'absent' } | { kind: 'unreadable' }): RenewalMode | null {
  if (r.kind === 'absent') return RENEWAL_MODE_DEFAULT;
  if (r.kind === 'unreadable') return null;
  return isRenewalMode(r.mode) ? r.mode : null;
}
