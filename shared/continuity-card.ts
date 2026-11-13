import type { FleetRole } from './fleetRoles.js';
import type { ItemKind, ItemState, NeededBy } from './ledgers.js';

/** The card's vocabulary (Overlord design spec §3.3.3, C38; §3.3.9, C50 to C52; the spec is
 *  `docs/superpowers/specs/2026-11-09-overlord-design.md`). Ring L0, context K: pure vocabulary, type-only imports of
 *  siblings, no runtime import.
 *
 *  A card is rendered from FACTS the server gathered for one session at one moment. A fact is either a reading or an
 *  `unmeasured` value naming what could not be read: a failed read is a fact the card renders as a line, never an empty
 *  list that would read as "nothing there" (no overloaded value at a seam). The renderers (`server/src/continuity/
 *  card.ts`) are L1 and take these values as their only input; the time of rendering is in the facts, so a renderer
 *  reads no clock. */

/** The renderer each role's card is drawn by, one per `FLEET_ROLES` row's `cardRenderer` column. `auditor` and
 *  `replay` take `plain` (C51). `overlord` renders one line until W1 ships its card. */
export type CardRenderer = 'overlord' | 'coordinator' | 'worker' | 'reviewer' | 'plain';
const CARD_RENDERER_MAP: Readonly<Record<CardRenderer, true>> = {
  overlord: true, coordinator: true, worker: true, reviewer: true, plain: true,
};
export const CARD_RENDERERS = Object.keys(CARD_RENDERER_MAP) as readonly CardRenderer[];

/** The card's budget, counted as a tool result (C38: 15k tokens). */
export const CARD_BUDGET_TOKENS = 15_000;
/** One page of the card door's answer, in characters: under the size at which Claude Code cuts a tool result. */
export const CARD_PAGE_CHARS = 12_000;
/** The UTF-8 bytes counted as one token when the card is measured against its budget. */
export const BYTES_PER_TOKEN = 3.2;

/** A reading, or what could not be read. `what` is a short noun phrase ("the runs", "the programme ledger"). */
export type Fact<T> =
  | { readonly kind: 'read'; readonly value: T }
  | { readonly kind: 'unmeasured'; readonly what: string };

/** One run the session claims (a coordinator) or serves (a worker or reviewer). */
export interface CardRun {
  readonly id: number;
  readonly programme: string;
  readonly wave: number;
  readonly waveOf: number | null;
  readonly state: string;
  readonly planPath: string | null;
  /** `work` or `review` (the run's kind). */
  readonly kind: string;
}

/** One goal of a programme. A goal the operator has not ratified is untrusted data (C50, §3.8). */
export interface CardGoal { readonly text: string; readonly ratified: boolean }
/** One decision recorded in a programme's ledger. */
export interface CardDecision { readonly at: number; readonly text: string }

/** One item: an open item of a programme's ledger, or an item this session raised. Its text is untrusted. */
export interface CardItem {
  readonly id: number;
  readonly programme: string;
  readonly kind: ItemKind;
  readonly state: ItemState;
  readonly neededBy: NeededBy;
  readonly at: number;
  readonly text: string;
}

/** One programme's ledger, by slug. */
export interface CardProgramme {
  readonly slug: string;
  readonly goals: readonly CardGoal[];
  readonly openItems: readonly CardItem[];
  readonly decisions: readonly CardDecision[];
}

/** One claim the session holds. */
export interface CardClaim {
  readonly id: number;
  readonly paths: readonly string[];
  readonly runId: number | null;
  readonly expiresAt: number;
}

/** One delivery addressed to the session and not yet answered. Its subject is untrusted. */
export interface CardMail {
  readonly deliveryId: number;
  readonly fromId: string;
  readonly at: number;
  readonly subject: string;
}

/** One note the session or its earlier generation left (the notes piece fills these). Its text is untrusted. */
export interface CardNote { readonly id: number; readonly at: number; readonly text: string }

/** The checkpoint carried across a renewal (the notes and renewal-act pieces fill it). Its text is untrusted. */
export interface CardCheckpoint { readonly at: number; readonly text: string }

/** The history line's facts: the verb that reads a node, and this session's newest node when a read names it. */
export interface CardHistory { readonly verb: string; readonly node: string | null }

export interface CardFacts {
  readonly sessionId: string;
  readonly role: FleetRole | 'undecided';
  readonly roleWhy: string;
  /** The server's time of rendering, epoch milliseconds. */
  readonly at: number;
  readonly runs: Fact<readonly CardRun[]>;
  readonly ledger: Fact<readonly CardProgramme[]>;
  readonly claims: Fact<readonly CardClaim[]>;
  readonly intent: Fact<boolean>;
  readonly itemsRaised: Fact<readonly CardItem[]>;
  readonly mailOutstanding: Fact<readonly CardMail[]>;
  /** Empty until the notes piece fills it. */
  readonly notes: Fact<readonly CardNote[]>;
  /** Null except at a renewal. */
  readonly checkpoint: Fact<CardCheckpoint | null>;
  readonly history: Fact<CardHistory>;
}

/** One part of a rendered card. Sections are in reading order (stable first, live last); `rank` orders what trimming
 *  drops (lowest first), and a `keep` section is never dropped. */
export interface CardSection {
  readonly key: string;
  readonly rank: number;
  readonly keep: boolean;
  readonly text: string;
}
