/**
 * WHAT A NOTE AND A HANDOVER NOTE MAY SAY (Overlord design spec §3.3.2, C37; plan `w1a-notes.md` Task 1). L1, context C3:
 * pure deciders over facts the note door (`routes.ts`) and the card's gatherer (`cardFacts.ts`) measured; no store, no
 * clock, no `fs`.
 *
 * A NOTE NEVER KEYS TO NOTHING. Its key must name a live row of the caller's: a programme it coordinates, an open item it
 * raised or its programme holds, or a run it claims that is not terminal (`noteKeyFact`). A key the door could not read is
 * `unmeasured`, never `gone`: it refuses, and with its own word (`unmeasured`), never `note-key-unknown` or
 * `reference-unknown` (the coordinator's null rule; slug unmeasured-key-is-unmeasured).
 *
 * ROWS OUTRANK A NOTE. Nothing here reads a note's text as a fact: a note is data a session wrote. The handover note's
 * status words ("done", "merged", ...) are dropped and counted, because a claim of done is a row or nothing (C37).
 */
import { TERMINAL_RUN_STATES, type RunState } from '../../../shared/api.js';
import {
  HANDOVER_TONE_MAX_CHARS, NOTES_CAP, type GenerationState, type HandoverNote, type KeyFact, type NoteKey, type NoteKind,
} from '../../../shared/continuity.js';
import { OPEN_ITEM_STATES, type ItemState } from '../../../shared/ledgers.js';
import { NOTE_REFUSALS, type NoteRefusal } from '../../../shared/refusal.js';

/** What a session asks to write. `revises` names the note it supersedes; `closes` ends that note with no successor. */
export interface NoteInput {
  readonly key: NoteKey;
  readonly kind: NoteKind;
  readonly waitsOn: string;
  readonly next: string;
  readonly revises: number | null;
  readonly closes: boolean;
}

/** The revised note's fact: one of `KeyFact` (`live` is a live note of the caller's), or `not-revising` for a new note. */
export type RevisedFact = KeyFact | 'not-revising';

/** A refusal: the note door's own words, or `unmeasured` for a fact it could not read. */
export type NoteVerdictRefusal = NoteRefusal | 'unmeasured';
export type NoteVerdict = { readonly ok: true } | { readonly ok: false; readonly refusal: NoteVerdictRefusal };

const chars = (s: string): number => [...s].length;
const overCap = (s: string, cap: number): boolean => chars(s) > cap;

/** One fact's refusal, or null when it is `live`. */
function factRefusal(f: KeyFact): NoteVerdictRefusal | null {
  return f === 'live' ? null : f === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.keyUnknown;
}

/** The facts, worst first: a definite refusal outranks a fact that could not be read, so one unreadable fact never hides
 *  a key that is certainly not the caller's. */
function worst(facts: readonly KeyFact[]): NoteVerdictRefusal | null {
  const refusals = facts.map(factRefusal).filter((r): r is NoteVerdictRefusal => r !== null);
  return refusals.find((r) => r !== 'unmeasured') ?? refusals[0] ?? null;
}

/**
 * May this note be appended? In order: a field over `NOTES_CAP.chars` (`note-too-long`); the key and the revised note (a
 * key that is not a live row of the caller's, or a revised note that is not a live note of the caller's, is
 * `note-key-unknown`; one that could not be read is `unmeasured`); and, for a new note only, the cap of live notes
 * (`note-cap`): a revision supersedes one live note, so it never raises the count. A close needs no live key: it ends a
 * note whose row may be gone (slug close-needs-no-live-key), so a dead key never pins a note against the cap.
 */
export function noteVerdict(n: NoteInput, key: KeyFact, liveCount: number | 'unmeasured', revised: RevisedFact): NoteVerdict {
  if (overCap(n.waitsOn, NOTES_CAP.chars) || overCap(n.next, NOTES_CAP.chars)) return { ok: false, refusal: NOTE_REFUSALS.tooLong };
  // A revision with no fact for the note it revises, or a new note with one, is a caller that measured the wrong thing.
  if ((n.revises === null) !== (revised === 'not-revising')) return { ok: false, refusal: 'unmeasured' };
  const facts: KeyFact[] = [];
  if (revised !== 'not-revising') facts.push(revised);
  if (!n.closes) facts.push(key);
  const refused = worst(facts);
  if (refused !== null) return { ok: false, refusal: refused };
  if (n.revises === null) {
    if (liveCount === 'unmeasured') return { ok: false, refusal: 'unmeasured' };
    if (liveCount >= NOTES_CAP.count) return { ok: false, refusal: NOTE_REFUSALS.cap };
  }
  return { ok: true };
}

/** The words a handover note may not use to claim a state (C37: "drops status words"). Whole words, any case. */
export const HANDOVER_STATUS_WORDS = [
  'done', 'merged', 'fixed', 'approved', 'complete', 'completed', 'finished', 'landed', 'shipped', 'resolved', 'passed',
  'green', 'closed', 'released', 'accepted', 'verified',
] as const;
const STATUS_RE = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${HANDOVER_STATUS_WORDS.join('|')})(?![\\p{L}\\p{N}_-])`, 'giu');

/** `text` with every status word dropped, its spaces closed up, and how many it dropped. */
export function dropStatusWords(text: string): { readonly text: string; readonly dropped: number } {
  let dropped = 0;
  const out = text.replace(STATUS_RE, () => { dropped += 1; return ''; });
  return { text: dropped === 0 ? text : out.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim()).join('\n'), dropped };
}

export type HandoverVerdict =
  | { readonly ok: true; readonly cleaned: HandoverNote; readonly dropped: number }
  | { readonly ok: false; readonly refusal: typeof NOTE_REFUSALS.referenceUnknown | typeof NOTE_REFUSALS.tooLong | 'unmeasured' };

/**
 * May this handover note be stored, and as what? In order: a thread's field or a caution over `NOTES_CAP.chars`, the tone
 * over `HANDOVER_TONE_MAX_CHARS`, or more threads or cautions than `NOTES_CAP.count` (`note-too-long`); then each thread's
 * reference, `refs[i]` for `threads[i]` (one that is not a live row of the caller's is `reference-unknown`, one that could
 * not be read `unmeasured`, never `reference-unknown`); then the status words, dropped from every free text and counted.
 */
export function handoverVerdict(h: HandoverNote, refs: readonly KeyFact[]): HandoverVerdict {
  const long = h.threads.length > NOTES_CAP.count || h.cautions.length > NOTES_CAP.count
    || h.threads.some((t) => overCap(t.waitsOn, NOTES_CAP.chars) || overCap(t.next, NOTES_CAP.chars))
    || h.cautions.some((c) => overCap(c, NOTES_CAP.chars)) || overCap(h.tone, HANDOVER_TONE_MAX_CHARS);
  if (long) return { ok: false, refusal: NOTE_REFUSALS.tooLong };
  if (refs.length !== h.threads.length) return { ok: false, refusal: 'unmeasured' };
  const refused = worst(refs);
  if (refused !== null) return { ok: false, refusal: refused === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.referenceUnknown };
  let dropped = 0;
  const clean = (s: string): string => { const r = dropStatusWords(s); dropped += r.dropped; return r.text; };
  const cleaned: HandoverNote = {
    threads: h.threads.map((t) => ({ ref: t.ref, waitsOn: clean(t.waitsOn), next: clean(t.next) })),
    cautions: h.cautions.map(clean),
    tone: clean(h.tone),
  };
  return { ok: true, cleaned, dropped };
}

/** What the door read of one key, before any decision: a row's fields, `absent`, or `unmeasured`. */
export type KeyReading =
  | { readonly kind: 'programme'; readonly claims: boolean | 'unmeasured' }
  | {
    readonly kind: 'item';
    /** The item's row, with whether the caller claims an open run of its programme (`unmeasured` when that could not be
     *  read), or `absent`, or `unmeasured` when the item could not be read. */
    readonly item: {
      readonly state: ItemState; readonly raisedBy: string; readonly program: string; readonly claimsProgramme: boolean | 'unmeasured';
    } | 'absent' | 'unmeasured';
  }
  | { readonly kind: 'run'; readonly run: { readonly state: RunState; readonly claimedBy: string | null } | 'absent' | 'unmeasured' };

const OPEN_ITEMS: ReadonlySet<ItemState> = new Set(OPEN_ITEM_STATES);
const TERMINAL_RUNS: ReadonlySet<RunState> = new Set(TERMINAL_RUN_STATES);

/** A key's fact for `caller`: a programme it coordinates (claims an open run of); an open item it raised or whose
 *  programme it coordinates; a run it claims that is not terminal. */
export function noteKeyFact(r: KeyReading, caller: string): KeyFact {
  switch (r.kind) {
    case 'programme':
      return r.claims === 'unmeasured' ? 'unmeasured' : r.claims ? 'live' : 'not-yours';
    case 'item': {
      if (r.item === 'unmeasured') return 'unmeasured';
      if (r.item === 'absent' || !OPEN_ITEMS.has(r.item.state)) return 'gone';
      if (r.item.raisedBy === caller) return 'live';
      return r.item.claimsProgramme === 'unmeasured' ? 'unmeasured' : r.item.claimsProgramme ? 'live' : 'not-yours';
    }
    case 'run':
      if (r.run === 'unmeasured') return 'unmeasured';
      if (r.run === 'absent' || TERMINAL_RUNS.has(r.run.state)) return 'gone';
      return r.run.claimedBy === caller ? 'live' : 'not-yours';
  }
}

/** The note a revision names, as the door read it: its owner and whether it is live, `absent`, or `unmeasured`. A live note
 *  of the caller's is `live`; a superseded or closed one is `gone`, like an absent one; another identity's is `not-yours`. */
export function revisedNoteFact(r: { readonly identity: string; readonly live: boolean } | 'absent' | 'unmeasured', caller: string): KeyFact {
  if (r === 'unmeasured') return 'unmeasured';
  if (r === 'absent') return 'gone';
  if (r.identity !== caller) return 'not-yours';
  return r.live ? 'live' : 'gone';
}

/** Was a handover asked of the caller? Only while its live generation's effective state (`effectiveGeneration`, the one
 *  accessor) is `checkpointed` (slug handover-only-when-asked). */
export function handoverAsked(gen: GenerationState | 'no-generation' | 'unmeasured'): 'asked' | 'not-asked' | 'unmeasured' {
  return gen === 'unmeasured' ? 'unmeasured' : gen === 'checkpointed' ? 'asked' : 'not-asked';
}
