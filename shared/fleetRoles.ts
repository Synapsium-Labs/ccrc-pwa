import type { SessionRole } from './api.js';
import type { CardRenderer } from './continuity-card.js';

/** The fleet's role vocabulary and its one table (Overlord design spec §3.3.9, C49; the spec is
 *  `docs/superpowers/specs/2026-11-09-overlord-design.md`). Ring L0, context K: pure vocabulary, type-only
 *  imports of siblings, no runtime import. The L1 reader `roleOf` consumes this table.
 *
 *  Columns that ship with values now: `longLived` (Table 3.3.9a), `sessionRole`, today's two-word
 *  view, which becomes a column read with one definition, `cardRenderer` (the card door piece of W1a,
 *  spec §3.3.3, C38 and C51): the renderer each role's card is drawn by; `auditor` and `replay` take `plain`,
 *  and `launchProfile` (the launch-profile piece of W1a, spec §3.6 H1, §3.3.7 H14, §3.3.4 C39): the switches a
 *  role's sessions launch with. ccd reads it from `ccd/lib/launch-profiles.json`, a projection of this column held
 *  equal by `server/test/launch-profiles-file.test.ts`; a route field `profile` names the row a spawn applies.
 *
 *  `compactInstructions` (the compaction piece of W1a, spec §3.3.9 C51, §3.3.10 C53): the role's compaction text, read
 *  through `server/src/continuity/compaction.ts#compactInstructionsFor`. `auditor` and `replay` take `plain`'s. It
 *  reaches ccd and the hook as `compactText` in `ccd/lib/launch-profiles.json` (the same projection), so ccd types
 *  `/compact <text>` and history's PreCompact print carries it as a section, both only when the route carries
 *  `compactwindow` (decision compaction-text-follows-continuity). Each text is one line of printable ASCII, at most
 *  600 characters, with no quote character, backslash, `$` or `;` (tmux drops a trailing one), so it is typed as one
 *  literal send (instructions-one-line).
 *
 *  Columns typed `null` until their owning piece lands. Each such piece widens its column's type, and
 *  the compiler then refuses every row until it is filled. Nothing reads a `null` column.
 *   - `probeSet`: the probe piece of W1a (spec §3.3.5, C52).
 *
 *  Mail pace and the renewal triggers are not columns: they are L1 records keyed by role (spec
 *  §3.3.9, §11.1), built by their own pieces.
 *
 *  Derived-enumeration discipline (`SESSION_ROLE_MAP`'s idiom, `shared/api.ts#SessionRole`): the union
 *  first, the `Record` typed against it, so a missing row is TS2741 and a stray one TS2353. */
export type FleetRole = 'overlord' | 'auditor' | 'replay' | 'worker' | 'reviewer' | 'coordinator' | 'plain';

/** One role's launch switches (spec §3.6, H1). Literals only: nothing here is a secret, and ccd puts them on an argv. */
export interface LaunchProfile {
  /** Environment set on the spawn line. Keys are `CLAUDE_CODE_*`; values are literals. */
  readonly env: Readonly<Record<string, string>>;
  /** Claude Code settings merged into the one `--settings` value after the fleet pins, so a profile pin wins. */
  readonly settings: Readonly<Record<string, boolean | string | number>>;
  /** Auto memory: `off` sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1; `switch` lets the Settings row decide (plain only, H14). */
  readonly autoMemory: 'off' | 'switch';
  /** Long-lived roles' compaction columns (C39), applied by ccd only when the route carries `compactwindow`, which
   *  the lane writes only while `continuity` is live. `settings` here merges after `settings` above. */
  readonly compaction: {
    readonly settings: Readonly<Record<string, boolean>>;
    /** The auto-compact point sits this many points of the window above the hard cap. */
    readonly aboveHardCapPts: number;
  } | null;
}

/** The long-lived roles' compaction columns (C39): idle compaction off, the auto-compact point 10 points above the cap. */
const LONG_LIVED_COMPACTION = { settings: { idleCompaction: false }, aboveHardCapPts: 10 } as const;
/** Every compaction text ends with this sentence (C51: the summary ends with the history node). */
const COMPACT_TEXT_END = 'End the summary with the history node of this conversation and the line: check what you recall against ccrc history or the server before you act on it.';
/** What every role drops and follows (C51: tool output dropped, the operator's standing instructions followed). */
const COMPACT_DROP = 'Drop tool output, and follow any standing compaction instructions the operator gave.';
/** What a coordinator's summary keeps (C51); the overlord keeps the same and more. */
const COORDINATOR_KEEPS = 'every run id and its wave, each plan path and the step it is at, every claim id and path, every operator or Overlord ruling with its date, every open ask and item id';
/** What a worker's or a reviewer's summary keeps (C51). */
const WORKER_KEEPS = 'the plan path, the task and step, the failing test or command and its last output line, every deviation slug or number, and the branch tip sha';
const compactText = (label: string, keeps: string): string => `Compaction instructions (${label}): keep, verbatim, ${keeps}. ${COMPACT_DROP} ${COMPACT_TEXT_END}`;
/** `plain`'s text, which `auditor` and `replay` reuse. */
const PLAIN_COMPACT = compactText('plain', 'every id, path and sha you were given, and every instruction the operator gave, in its words');
/** Every short-lived role's profile: auto memory off and nothing else (H14). */
const MEMORY_OFF: LaunchProfile = { env: {}, settings: {}, autoMemory: 'off', compaction: null };

export interface FleetRoleRow {
  readonly longLived: boolean;
  /** Today's two-word view (`SessionRole`). */
  readonly sessionRole: SessionRole;
  /** The role's launch switches (`LaunchProfile`). */
  readonly launchProfile: LaunchProfile;
  /** The card's renderer (`server/src/continuity/card.ts#renderCard`). */
  readonly cardRenderer: CardRenderer;
  /** The role's compaction text (C51), read through `compactInstructionsFor`. */
  readonly compactInstructions: string;
  /** Typed and absent until its piece lands. */
  readonly probeSet: null;
}

/** Keys in Table 3.3.9a's order. */
export const FLEET_ROLES: Readonly<Record<FleetRole, FleetRoleRow>> = {
  overlord: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: { env: { CLAUDE_CODE_FORK_SUBAGENT: '0', CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' }, settings: {}, autoMemory: 'off', compaction: LONG_LIVED_COMPACTION },
    cardRenderer: 'overlord',
    compactInstructions: compactText('overlord', `${COORDINATOR_KEEPS}, every mail you have not answered, every request id, and every operator message id you answered or owe an answer`),
    probeSet: null,
  },
  auditor: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: MEMORY_OFF,
    cardRenderer: 'plain',
    compactInstructions: PLAIN_COMPACT,
    probeSet: null,
  },
  replay: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: MEMORY_OFF,
    cardRenderer: 'plain',
    compactInstructions: PLAIN_COMPACT,
    probeSet: null,
  },
  worker: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: MEMORY_OFF,
    cardRenderer: 'worker',
    compactInstructions: compactText('worker', WORKER_KEEPS),
    probeSet: null,
  },
  reviewer: {
    longLived: false,
    sessionRole: 'child',
    launchProfile: MEMORY_OFF,
    cardRenderer: 'reviewer',
    compactInstructions: compactText('reviewer', WORKER_KEEPS),
    probeSet: null,
  },
  coordinator: {
    longLived: true,
    sessionRole: 'coordinator',
    launchProfile: { env: {}, settings: {}, autoMemory: 'off', compaction: LONG_LIVED_COMPACTION },
    cardRenderer: 'coordinator',
    compactInstructions: compactText('coordinator', `${COORDINATOR_KEEPS}, and every mail you have not answered`),
    probeSet: null,
  },
  plain: {
    longLived: false,
    sessionRole: 'coordinator',
    launchProfile: { env: {}, settings: {}, autoMemory: 'switch', compaction: null },
    cardRenderer: 'plain',
    compactInstructions: PLAIN_COMPACT,
    probeSet: null,
  },
};

export const FLEET_ROLE_NAMES: readonly FleetRole[] = Object.keys(FLEET_ROLES) as FleetRole[];

/** The only way to narrow an untrusted value to a `FleetRole`, for a future reader of a persisted or wire value (Overlord W1a plan, open question 5). Derived from the table, so a new row is accepted with no edit here. */
export function isFleetRole(v: unknown): v is FleetRole { return typeof v === 'string' && (FLEET_ROLE_NAMES as readonly string[]).includes(v); }
