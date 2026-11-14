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
/** The size at which Claude Code stops showing a Bash tool result whole, in UTF-8 BYTES, as measured in a fleet pane on
 *  build 2.1.325 (2026-11-14): 29,900 ASCII characters arrived whole, while 30,050 characters, and 29,443 characters that were
 *  30,243 bytes, were each replaced by a 2 KB preview and a file path. So the cut counts bytes, at about 30,000 (slug
 *  card-page-chars). Re-measure it on a new build, and keep `CARD_PAGE_CHARS` under it. */
export const TOOL_RESULT_CUT_BYTES = 30_000;
/** One page of the card, in code points: `ccrc-api card` prints one page and a footer line per call, so a page of four-byte
 *  characters (28,000 bytes) still sits under `TOOL_RESULT_CUT_BYTES` with room for the footer. */
export const CARD_PAGE_CHARS = 7_000;
/** At most this many outstanding deliveries are listed on a card; `mailMore` says when more exist. */
export const CARD_MAIL_MAX = 100;
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
  /** True when the operator ever ticked it (its `tickedAt` is set), even if it was returned to `open` since: a ticked
   *  item carries a ruling, so an abstention probe never asks about one (review 1999, F2a). */
  readonly everTicked: boolean;
  /** Still inside its coordinator-first hold (`heldUntil` in the future): the operator is not shown it yet. Only the card of
   *  the coordinator whose hold it is carries a held item (the coordinator's ruling F14 on review 2023). */
  readonly held: boolean;
}

/** One programme's ledger, by slug. */
export interface CardProgramme {
  readonly slug: string;
  readonly goals: readonly CardGoal[];
  readonly openItems: readonly CardItem[];
  readonly decisions: readonly CardDecision[];
}

/** One claim the session holds. No lease expiry: a lease renews while its holder runs, so it would change the card
 *  and its snapshot with no row changing (plan review A4). */
export interface CardClaim {
  readonly id: number;
  readonly paths: readonly string[];
  readonly runId: number | null;
}

/** One delivery addressed to the session and not yet answered. Its subject is untrusted. */
export interface CardMail {
  readonly deliveryId: number;
  readonly fromId: string;
  readonly at: number;
  readonly subject: string;
  /** The delivery lane stopped retrying it (a terminal delivery state that the mailbox still shows): it never reached the
   *  session as a nudge. */
  readonly parked: boolean;
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
  /** The server's time of rendering, epoch milliseconds. Never rendered, and kept out of the snapshot id's hash, so one
   *  card's text and id are stable across requests (plan review A4). */
  readonly at: number;
  readonly runs: Fact<readonly CardRun[]>;
  readonly ledger: Fact<readonly CardProgramme[]>;
  readonly claims: Fact<readonly CardClaim[]>;
  readonly intent: Fact<boolean>;
  readonly itemsRaised: Fact<readonly CardItem[]>;
  readonly mailOutstanding: Fact<readonly CardMail[]>;
  /** More outstanding deliveries exist than the card read (`CARD_MAIL_MAX`). */
  readonly mailMore: boolean;
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
