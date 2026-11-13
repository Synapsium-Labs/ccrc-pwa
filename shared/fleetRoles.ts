import type { SessionRole } from './api.js';

/** The fleet's role vocabulary and its one table (Overlord design spec §3.3.9, C49; the spec is
 *  `docs/superpowers/specs/2026-11-09-overlord-design.md`). Ring L0, context K: pure vocabulary, one
 *  type-only import of a sibling, no runtime import. The L1 reader `roleOf` consumes this table.
 *
 *  Columns that ship with values now: `longLived` (Table 3.3.9a) and `sessionRole`, today's two-word
 *  view, which becomes a column read with one definition.
 *
 *  Columns typed `null` until their owning piece lands. Each such piece widens its column's type, and
 *  the compiler then refuses every row until it is filled. Nothing reads a `null` column.
 *   - `launchProfile`: the launch-profile piece of W1a (spec §3.6, H1).
 *   - `cardRenderer`: the card door piece (spec §3.3.3), which brings renderers; today's role card is
 *     bash in the session hook.
 *   - `compactInstructions`: waits on history W3-1 (spec §14, C51); today there is a bare `/compact`.
 *   - `probeSet`: the probe piece of W1a (spec §3.3.5, C52).
 *
 *  Mail pace and the renewal triggers are not columns: they are L1 records keyed by role (spec
 *  §3.3.9, §11.1), built by their own pieces.
 *
 *  Derived-enumeration discipline (`SESSION_ROLE_MAP`'s idiom, `shared/api.ts#SessionRole`): the union
 *  first, the `Record` typed against it, so a missing row is TS2741 and a stray one TS2353. */
export type FleetRole = 'overlord' | 'auditor' | 'replay' | 'worker' | 'reviewer' | 'coordinator' | 'plain';

export interface FleetRoleRow {
  readonly longLived: boolean;
  /** Today's two-word view (`SessionRole`). */
  readonly sessionRole: SessionRole;
  /** Typed and absent until their pieces land. */
  readonly launchProfile: null;
  readonly cardRenderer: null;
  readonly compactInstructions: null;
  readonly probeSet: null;
}

/** Keys in Table 3.3.9a's order. */
export const FLEET_ROLES: Readonly<Record<FleetRole, FleetRoleRow>> = {
  overlord: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  auditor: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  replay: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  worker: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  reviewer: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  coordinator: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
  plain: {
    longLived: false,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: null,
    compactInstructions: null,
    probeSet: null,
  },
};

export const FLEET_ROLE_NAMES: readonly FleetRole[] = Object.keys(FLEET_ROLES) as FleetRole[];

/** The only way to narrow an untrusted value to a `FleetRole`, for a future reader of a persisted or wire value (Overlord W1a plan, open question 5). Derived from the table, so a new row is accepted with no edit here. */
export function isFleetRole(v: unknown): v is FleetRole { return typeof v === 'string' && (FLEET_ROLE_NAMES as readonly string[]).includes(v); }
