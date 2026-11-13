import type { SessionRole } from './api.js';
import type { CardRenderer } from './continuity-card.js';

/** The fleet's role vocabulary and its one table (Overlord design spec §3.3.9, C49; the spec is
 *  `docs/superpowers/specs/2026-11-09-overlord-design.md`). Ring L0, context K: pure vocabulary, type-only
 *  imports of siblings, no runtime import. The L1 reader `roleOf` consumes this table.
 *
 *  Columns that ship with values now: `longLived` (Table 3.3.9a), `sessionRole`, today's two-word
 *  view, which becomes a column read with one definition, and `cardRenderer` (the card door piece of W1a,
 *  spec §3.3.3, C38 and C51): the renderer each role's card is drawn by; `auditor` and `replay` take `plain`.
 *
 *  Columns typed `null` until their owning piece lands. Each such piece widens its column's type, and
 *  the compiler then refuses every row until it is filled. Nothing reads a `null` column.
 *   - `launchProfile`: the launch-profile piece of W1a (spec §3.6, H1).
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
  /** `launchProfile`, `compactInstructions` and `probeSet` are typed and absent until their pieces land. */
  readonly launchProfile: null;
  /** The card's renderer (`server/src/continuity/card.ts#renderCard`). */
  readonly cardRenderer: CardRenderer;
  readonly compactInstructions: null;
  readonly probeSet: null;
}

/** Keys in Table 3.3.9a's order. */
export const FLEET_ROLES: Readonly<Record<FleetRole, FleetRoleRow>> = {
  overlord: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: 'overlord',
    compactInstructions: null,
    probeSet: null,
  },
  auditor: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: 'plain',
    compactInstructions: null,
    probeSet: null,
  },
  replay: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: 'plain',
    compactInstructions: null,
    probeSet: null,
  },
  worker: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: 'worker',
    compactInstructions: null,
    probeSet: null,
  },
  reviewer: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: null,
    cardRenderer: 'reviewer',
    compactInstructions: null,
    probeSet: null,
  },
  coordinator: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: 'coordinator',
    compactInstructions: null,
    probeSet: null,
  },
  plain: {
    longLived: false,
    sessionRole: 'coordinator',
    launchProfile: null,
    cardRenderer: 'plain',
    compactInstructions: null,
    probeSet: null,
  },
};

export const FLEET_ROLE_NAMES: readonly FleetRole[] = Object.keys(FLEET_ROLES) as FleetRole[];

/** The only way to narrow an untrusted value to a `FleetRole`, for a future reader of a persisted or wire value (Overlord W1a plan, open question 5). Derived from the table, so a new row is accepted with no edit here. */
export function isFleetRole(v: unknown): v is FleetRole { return typeof v === 'string' && (FLEET_ROLE_NAMES as readonly string[]).includes(v); }
