// The coordinator advisor (plan `docs/superpowers/plans/2026-11-23-coordinator-advisor.md`, spec
// `docs/superpowers/specs/2026-11-23-coordinator-advisor-design.md`, D-8967..D-8972): coordinators on Opus consult a
// stronger model through Claude Code's advisor tool, capped per coordinator per UTC day. This file is its L0 half: the
// Settings row's choices, cap and scope, the wire view of `GET`/`POST /api/coord/coordinator-advisor`, the readout's
// states and the row's words. L0: the PWA bundles `shared/`, so this file imports only `shared/api.ts`. It sits outside
// `shared/api.ts` for `plainAutoMemory.ts`'s reason.
//
// WHAT IT MOVES. Nothing, on its own: the launch-profile lane reads it (`advisorFor`) and writes the lane-only route field
// `advisor`, and ccd renders that as `--advisor <model>` at the coordinator's next spawn. While the `launch-profile` lane
// is shadow, the lane gives no coordinator the field; it still removes one it gave while live (at the cap, a drop or Off).

import { isRegistryId } from './api.js';

/** The row's stored choice (`advisor_settings.choice`): no advisor, or the model coordinators consult. */
export const ADVISOR_CHOICES = ['off', 'opus', 'fable'] as const;
export type AdvisorChoice = (typeof ADVISOR_CHOICES)[number];
export function isAdvisorChoice(v: unknown): v is AdvisorChoice {
  return typeof v === 'string' && (ADVISOR_CHOICES as readonly string[]).includes(v);
}
/** The models the route field carries (ccd's `_route_valid` takes exactly these two words). */
export type AdvisorModel = Exclude<AdvisorChoice, 'off'>;
/** Off until the operator turns it on. The migration seeds it, and a lost row reads as it. */
export const ADVISOR_DEFAULT: AdvisorChoice = 'off';

/** Advisor calls per coordinator per UTC day before the lane clears the field (D-8970). */
export const ADVISOR_CAP_DEFAULT = 12;
export const ADVISOR_CAP_MIN = 1;
export const ADVISOR_CAP_MAX = 200;
export function isAdvisorCap(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= ADVISOR_CAP_MIN && v <= ADVISOR_CAP_MAX;
}

/** Which coordinators the row covers: every one, or a named list of session ids (a trial). */
export type AdvisorScope = { readonly kind: 'all' } | { readonly kind: 'sessions'; readonly ids: readonly string[] };
export const ADVISOR_SCOPE_MAX_IDS = 16;
/** The one narrowing of a scope, from the wire or from the stored JSON: null when it is not one. */
export function advisorScopeOf(v: unknown): AdvisorScope | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { kind?: unknown; ids?: unknown };
  if (o.kind === 'all') return { kind: 'all' };
  if (o.kind !== 'sessions' || !Array.isArray(o.ids) || o.ids.length === 0 || o.ids.length > ADVISOR_SCOPE_MAX_IDS) return null;
  const ids = o.ids as unknown[];
  if (!ids.every((x): x is string => isRegistryId(x))) return null;
  return new Set(ids).size === ids.length ? { kind: 'sessions', ids: [...(ids as string[])].sort() } : null;
}
export function advisorScopeHas(scope: AdvisorScope, id: string): boolean {
  return scope.kind === 'all' || scope.ids.includes(id);
}

/** The setting as one value: what the lane decides from. */
export interface CoordinatorAdvisorSetting {
  readonly choice: AdvisorChoice;
  readonly cap: number;
  readonly scope: AdvisorScope;
}
export const COORDINATOR_ADVISOR_DEFAULT: CoordinatorAdvisorSetting = { choice: ADVISOR_DEFAULT, cap: ADVISOR_CAP_DEFAULT, scope: { kind: 'all' } };

/** One coordinator's advisor, as measured (spec §6). One decider (`advisorStateOf`) writes these; no null is overloaded.
 *  - `off`: nothing is requested.
 *  - `queued`: the route asks for it; the running pane's spawn did not apply it.
 *  - `requested`: the spawn applied it; the transcript shows no sign yet.
 *  - `live`: since that spawn, an `advisor_tool` attachment with `available:true`, or an advisor call.
 *  - `dropped`: an `available:false` attachment since that spawn, or ccd's fast-death fallback.
 *  - `unseen`: applied, and `ADVISOR_UNSEEN_REQUESTS` main-loop requests later still no sign (a doubt, not a drop).
 *  - `capped`: today's calls reached the cap; calls until the session restarts are overrun.
 *  - `unmeasured`: the spawn record could not be read, so what the running pane has is unknown. */
export const ADVISOR_STATES = ['off', 'queued', 'requested', 'live', 'dropped', 'unseen', 'capped', 'unmeasured'] as const;
export type AdvisorState = (typeof ADVISOR_STATES)[number];
export const ADVISOR_UNSEEN_REQUESTS = 20;

/** What ccd's last spawn of a session applied, from `$REG/<id>.advisorspawn` (`_advisor_spawn_compose`; its one reader is
 *  `registry.ts#advisorSpawnOf`): the model it passed with the spawn's epoch (seconds), or `off` with the epoch and whether
 *  it was the fast-death fallback (D-8968). */
export type AdvisorSpawnRecord =
  | { readonly kind: 'applied'; readonly model: AdvisorModel; readonly at: number }
  | { readonly kind: 'off'; readonly at: number; readonly fastDeath: boolean };

/** Which act applies a change of the field to a running coordinator (spec §5). */
export const ADVISOR_APPLY_PATHS = ['roll', 'renewal', 'next-spawn'] as const;
export type AdvisorApplyPath = (typeof ADVISOR_APPLY_PATHS)[number];

/** Today's advisor tokens, summed over the `advisor_message` usage iterations the transcript carried. */
export interface AdvisorTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** `FleetSession.advisor` (additive, absent for a session the advisor never touched): the readout's one value. */
export interface FleetAdvisor {
  readonly state: AdvisorState;
  /** The model the route asks for, or the spawn applied; null when neither names one. */
  readonly model: AdvisorModel | null;
  /** Today's (UTC) counted calls; null when the count could not be read. */
  readonly today: number | null;
  readonly cap: number;
  /** Calls counted today past the cap. */
  readonly overrun: number;
  readonly tokens: AdvisorTokens | null;
  readonly applies: AdvisorApplyPath;
}

/** `GET`/`POST /api/coord/coordinator-advisor`'s answer: the setting as read (null when the stored row could not be read
 *  or holds a word this build does not know, which the lane reads as unmeasured and writes nothing for), the defaults and
 *  the choices. */
export interface CoordinatorAdvisorView {
  readonly setting: CoordinatorAdvisorSetting | null;
  readonly default: CoordinatorAdvisorSetting;
  readonly choices: readonly AdvisorChoice[];
  readonly capMin: number;
  readonly capMax: number;
}

/** The row's words. One sentence each; nothing in the PWA retypes one. */
export const COORDINATOR_ADVISOR_TEXT = {
  legend: 'Coordinator advisor',
  purpose: 'Coordinators on Opus can consult a stronger model before they commit to an approach. Advisor calls count '
    + 'against the account\'s plan limits, so each coordinator has a daily cap.',
  choices: { off: 'Off', opus: 'Opus', fable: 'Fable' } satisfies Record<AdvisorChoice, string>,
  notes: {
    off: 'No coordinator is given an advisor. One that has it drops it at its next restart.',
    opus: 'Coordinators on Opus consult Opus, from their next restart, up to the daily cap.',
    fable: 'Coordinators on Opus consult Fable, from their next restart, up to the daily cap.',
  } satisfies Record<AdvisorChoice, string>,
  capLabel: 'Daily calls per coordinator',
  scopeLabel: 'Coordinators',
  scopeAll: 'Every coordinator',
  scopeSessions: 'Only these sessions',
  save: 'Save the cap and coordinators',
  shadow: 'No coordinator is given an advisor until the Launch profiles lane is live (Settings › Automation › Shadow lanes). One given it earlier still loses it at the cap or when this is Off.',
  unread: 'The server could not read this row, so no coordinator\'s advisor is changed.',
  states: {
    off: 'Off',
    queued: 'Asked for, applies at the next restart',
    requested: 'Passed at launch, not seen yet',
    live: 'Live',
    dropped: 'Dropped by Claude Code',
    unseen: 'Passed at launch, never seen',
    capped: 'Capped for today',
    unmeasured: 'Not measured: its launch record could not be read',
  } satisfies Record<AdvisorState, string>,
  applies: {
    roll: 'a change applies at its next idle restart',
    renewal: 'a change applies at its next renewal',
    'next-spawn': 'a change applies at its next start',
  } satisfies Record<AdvisorApplyPath, string>,
} as const;
