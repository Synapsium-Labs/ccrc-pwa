import type { KeyFact, NoteKind } from './continuity.js';
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

/** One live note of the session's identity (the notes piece, spec §3.3.2 C37): what a thread waits on and what comes next,
 *  keyed to a row. `key` is the key as one phrase (`noteKeyText`), and `keyFact` what that row is now: a note whose row is
 *  gone stays on the card and says so, never dropped. Its `waitsOn` and `next` are untrusted. */
export interface CardNote {
  readonly id: number;
  readonly at: number;
  readonly kind: NoteKind;
  readonly key: string;
  readonly keyFact: KeyFact;
  readonly waitsOn: string;
  readonly next: string;
}

/** One thread of a handover note, its reference as one phrase (`noteKeyText`). Untrusted. */
export interface CardHandoverThread { readonly ref: string; readonly waitsOn: string; readonly next: string }
/** The handover note the generation before this one wrote in `checkpointed` (the notes piece), its status words already
 *  dropped (`dropped` counts them). Its claims of done, ids, promises, authority and preferences are never rows (C37), and
 *  all of its text is untrusted. */
export interface CardHandover {
  readonly generation: number;
  readonly dropped: number;
  readonly threads: readonly CardHandoverThread[];
  readonly cautions: readonly string[];
  readonly tone: string;
}
/** The checkpoint carried across a renewal: in W1a, the handover note of the generation this one replaced (the notes piece;
 *  the renewal-act piece adds the thread). `at` is when the note was written. */
export interface CardCheckpoint { readonly at: number; readonly handover: CardHandover }

/** One pending timer of the session's own (the timers piece of W1a, plan `w1a-timers.md` Task 10): its id, its due time
 *  (an absolute stamp), the first words of its note (`timerPreview`, the one cut: the note itself never rides the card),
 *  and the run or programme it is bound to. The preview is untrusted. */
export interface CardTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly preview: string;
  readonly runId: number | null;
  readonly programme: string | null;
}

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
  /** The identity's live notes, newest first. */
  readonly notes: Fact<readonly CardNote[]>;
  /** Null while the generation this one replaced wrote no handover note (or there is none). */
  readonly checkpoint: Fact<CardCheckpoint | null>;
  /** The session's own pending timers, oldest due first (the timers piece). */
  readonly timers: Fact<readonly CardTimer[]>;
  readonly history: Fact<CardHistory>;
}

/** THE ANCHOR (C38; plan `w1a-anchor.md`): the card's short part, which the session hook prints in its first slot at a
 *  start, and once after an automatic compaction that brought no start. Its ceilings, counted in UTF-8 BYTES, so the text
 *  fits them under any count Claude Code or a bash in any locale makes (a byte bound is also a character and a UTF-16
 *  bound; slug anchor-cap-in-bytes). The hook's own clip (`ANCHOR_CARD_MAX_CHARS` in `ccd/session-hook.sh`) is the same
 *  number, so a server answer never meets it. */
export const ANCHOR_CARD_MAX_CHARS = 1_500;
/** The prompt's anchor after an automatic compaction: the canaries and the instruction only (W0-04 measured a 600-character
 *  UserPromptSubmit context arriving with the prompt). */
export const ANCHOR_PROMPT_MAX_CHARS = 600;
/** The anchor's forms: `start` (role, canaries, counts, instruction), `prompt` (canaries and instruction) and `fork` (no
 *  text: the door answers whether the slot is live, and the hook prints its one refusal line). */
const ANCHOR_FORM_MAP: Readonly<Record<'start' | 'prompt' | 'fork', true>> = { start: true, prompt: true, fork: true };
export type AnchorForm = keyof typeof ANCHOR_FORM_MAP;
export const ANCHOR_FORMS = Object.keys(ANCHOR_FORM_MAP) as readonly AnchorForm[];
export function isAnchorForm(v: unknown): v is AnchorForm {
  return typeof v === 'string' && (ANCHOR_FORMS as readonly string[]).includes(v);
}
/** The generation canary's facts: the identity's live generation (its term and `n`, and whether a newer start of the
 *  session is not yet minted, which reads `n+1 starting`), `none` when the identity has no live generation, or what could
 *  not be read. */
export type AnchorGeneration =
  | { readonly kind: 'live'; readonly term: number; readonly n: number; readonly starting: boolean }
  | { readonly kind: 'none' }
  | { readonly kind: 'unmeasured'; readonly what: string };

/** One part of a rendered card. Sections are in reading order (stable first, live last); `rank` orders what trimming
 *  drops (lowest first), and a `keep` section is never dropped. */
export interface CardSection {
  readonly key: string;
  readonly rank: number;
  readonly keep: boolean;
  readonly text: string;
}
