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
import { TOOL_RESULT_CUT_BYTES } from '../../../shared/continuity-card.js';
import {
  HANDOVER_MAX_BYTES, HANDOVER_TONE_MAX_CHARS, KEY_FACTS, NOTES_CAP, isBlankText, type GenerationState, type HandoverNote, type KeyFact, type NoteKey, type NoteKind,
} from '../../../shared/continuity.js';
import { OPEN_ITEM_STATES, type ItemState } from '../../../shared/ledgers.js';
import { NOTE_REFUSALS, type NoteRefusal } from '../../../shared/refusal.js';
import { utf8Bytes } from '../../../shared/utf8.js';

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

/** A refusal: the note door's own words, `unmeasured` for a fact it could not read, or `bad-request` for a note that is not
 *  one (a thread with no next act, a close that names no note). */
export type NoteVerdictRefusal = NoteRefusal | 'unmeasured' | 'bad-request';
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
 * May this note be appended? In order: a thread whose `next` is blank, or a close that names no note (`bad-request`: a
 * thread is a thing to do next, and the continuation probe asks for it, review 2039 F1); a field over `NOTES_CAP.chars`
 * (`note-too-long`); the key and the revised note (a
 * key that is not a live row of the caller's, or a revised note that is not a live note of the caller's, is
 * `note-key-unknown`; one that could not be read is `unmeasured`); and, for a new note only, the cap of live notes
 * (`note-cap`): a revision supersedes one live note, so it never raises the count. A close needs no live key: it ends a
 * note whose row may be gone (slug close-needs-no-live-key), so a dead key never pins a note against the cap.
 */
export function noteVerdict(n: NoteInput, key: KeyFact, liveCount: number | 'unmeasured', revised: RevisedFact): NoteVerdict {
  if (n.closes && n.revises === null) return { ok: false, refusal: 'bad-request' };
  if (!n.closes && n.kind === 'thread' && isBlankText(n.next)) return { ok: false, refusal: 'bad-request' };
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

/** The words a handover note may not use to claim a state (C37: "drops status words"). Whole words, any case, MATCHED on
 *  the text NFKC-folded with its format characters (`\p{Cf}`: zero-width and soft hyphen among them) stripped; the text
 *  STORED is the author's, as written, but for the mark where a word was (review 2046, F4). */
export const HANDOVER_STATUS_WORDS = [
  'done', 'merged', 'fixed', 'approved', 'complete', 'completed', 'finished', 'landed', 'shipped', 'resolved', 'passed',
  'green', 'closed', 'released', 'accepted', 'verified',
] as const;
const STATUS_RE = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${HANDOVER_STATUS_WORDS.join('|')})(?![\\p{L}\\p{N}_-])`, 'giu');

/** What a dropped status word leaves in its place, so the reader sees that a word was there (`not done` must not read
 *  `not`, review 2039 F8). It holds no status word itself. */
export const STATUS_WORD_MARK = '[status word dropped]';

/** `text` folded for matching, a character at a time (NFKC, format characters dropped), with each folded UTF-16 unit's
 *  span in the original: `from[k]` to `to[k]`. */
function foldForMatching(text: string): { readonly folded: string; readonly from: readonly number[]; readonly to: readonly number[] } {
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const ch of text) {
    const f = /\p{Cf}/u.test(ch) ? '' : ch.normalize('NFKC');
    for (let k = 0; k < f.length; k += 1) { from.push(at); to.push(at + ch.length); }
    folded += f;
    at += ch.length;
  }
  return { folded, from, to };
}

/** `text` as written, with each status word found in its fold replaced by `STATUS_WORD_MARK` (the whole stretch of the
 *  original it came from, format characters inside it included), and how many it replaced. Nothing else changes. */
export function dropStatusWords(text: string): { readonly text: string; readonly dropped: number } {
  const { folded, from, to } = foldForMatching(text);
  let out = '';
  let last = 0;
  let dropped = 0;
  for (const m of folded.matchAll(STATUS_RE)) {
    const start = from[m.index]!;
    if (start < last) continue;
    out += text.slice(last, start) + STATUS_WORD_MARK;
    last = to[m.index + m[0].length - 1]!;
    dropped += 1;
  }
  return { text: dropped === 0 ? text : out + text.slice(last), dropped };
}

export type HandoverVerdict =
  | { readonly ok: true; readonly cleaned: HandoverNote; readonly dropped: number }
  | { readonly ok: false; readonly refusal: typeof NOTE_REFUSALS.referenceUnknown | typeof NOTE_REFUSALS.tooLong | 'unmeasured' };

/** Is a handover over a cap: a field, the tone, the counts, or its whole JSON in bytes? */
function handoverOverCap(h: HandoverNote): boolean {
  return h.threads.length > NOTES_CAP.count || h.cautions.length > NOTES_CAP.count
    || h.threads.some((t) => overCap(t.waitsOn, NOTES_CAP.chars) || overCap(t.next, NOTES_CAP.chars))
    || h.cautions.some((c) => overCap(c, NOTES_CAP.chars)) || overCap(h.tone, HANDOVER_TONE_MAX_CHARS)
    || utf8Bytes(JSON.stringify(h)) > HANDOVER_MAX_BYTES;
}

/**
 * May this handover note be stored, and as what? In order: a thread's field or a caution over `NOTES_CAP.chars`, the tone
 * over `HANDOVER_TONE_MAX_CHARS`, more threads or cautions than `NOTES_CAP.count`, or the whole note's JSON over
 * `HANDOVER_MAX_BYTES` (`note-too-long`), measured on the note as sent and again on the note as it would be stored; then each thread's
 * reference, `refs[i]` for `threads[i]` (one that is not a live row of the caller's is `reference-unknown`, one that could
 * not be read `unmeasured`, never `reference-unknown`); then the status words, dropped from every free text and counted.
 */
export function handoverVerdict(h: HandoverNote, refs: readonly KeyFact[]): HandoverVerdict {
  if (handoverOverCap(h)) return { ok: false, refusal: NOTE_REFUSALS.tooLong };
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
  // The caps measure what is STORED (review 2046, F1): a mark is longer than the word it replaces, so a note that fits as
  // sent can be over as stored.
  if (handoverOverCap(cleaned)) return { ok: false, refusal: NOTE_REFUSALS.tooLong };
  return { ok: true, cleaned, dropped };
}

/** `ccrc-api note list`'s page: at most this many notes when the caller names no `--limit`, and never more than the cap. */
export const NOTE_LIST_LIMIT = { default: 20, max: NOTES_CAP.count } as const;
/** A page's notes, as JSON, stay within this many bytes, so the whole answer stays under the tool result cut with room for
 *  its envelope and the masker's marks (review 2039, F2). */
export const NOTE_LIST_PAGE_BYTES = TOOL_RESULT_CUT_BYTES - 4_000;

/** The widest `keyFact` word an answer can carry. */
const WIDEST_KEY_FACT = KEY_FACTS.reduce((a, b) => (b.length > a.length ? b : a));
/** One note's bytes in a list answer, sized as if its key fact were the widest and with its comma, so a page stays under
 *  the cut whatever the facts are when they are read (review 2046, F2). */
export const noteListBytes = (n: object): number => utf8Bytes(JSON.stringify({ ...n, keyFact: WIDEST_KEY_FACT })) + 1;

/**
 * One page of the live notes, newest first: those older than `before` (every one when it is null), at most `limit`, and
 * within `NOTE_LIST_PAGE_BYTES` as `bytesOf` sizes them, but always the first when there is one (a note at its caps is far
 * under the page). `more` says older live notes remain: the next page is `before` the last one here.
 */
export function notesPage<T extends { readonly id: number }>(
  newestFirst: readonly T[], before: number | null, limit: number, bytesOf: (n: T) => number,
): { readonly page: readonly T[]; readonly more: boolean } {
  const older = newestFirst.filter((n) => before === null || n.id < before);
  const page: T[] = [];
  let bytes = 0;
  for (const n of older) {
    const b = bytesOf(n);
    if (page.length >= limit || (page.length > 0 && bytes + b > NOTE_LIST_PAGE_BYTES)) break;
    page.push(n);
    bytes += b;
  }
  return { page, more: page.length < older.length };
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
  | {
    readonly kind: 'run';
    /** The run's row, with whether it is among the caller's open claimed runs, as the binding's own reader answers
     *  (`bindingsOf(caller).claimant()`, ARCH-62: no run/session equality is decided here), or `absent`, or `unmeasured`. */
    readonly run: { readonly state: RunState; readonly claimedByCaller: boolean | 'unmeasured' } | 'absent' | 'unmeasured';
  };

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
      return r.run.claimedByCaller === 'unmeasured' ? 'unmeasured' : r.run.claimedByCaller ? 'live' : 'not-yours';
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
