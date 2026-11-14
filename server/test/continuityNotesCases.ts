// The note deciders' cases (Overlord W1a, the notes plan, Task 1), over a loaded module: `continuity-notes.test.ts` runs them
// on the source, and `sim/notesMutants.ts` on each mutated copy, so the floors and the suite assert the same things.
import { expect } from 'vitest';
import { TOOL_RESULT_CUT_BYTES } from '../../shared/continuity-card.js';
import { HANDOVER_MAX_BYTES, HANDOVER_TONE_MAX_CHARS, KEY_FACTS, NOTES_CAP, isBlankText, type GenerationState, type HandoverNote, type KeyFact } from '../../shared/continuity.js';
import { GENERATION_STATES } from '../../shared/continuity.js';
import { NOTE_REFUSALS } from '../../shared/refusal.js';
import { utf8Bytes } from '../../shared/utf8.js';
import type * as NotesModule from '../src/continuity/notes.js';

type Notes = typeof NotesModule;
type Case = () => void;

const CALLER = 'lane-a-project-a';
const note = (over: Partial<NotesModule.NoteInput> = {}): NotesModule.NoteInput => ({
  key: { kind: 'run', id: 11 }, kind: 'thread', waitsOn: 'the review of run 12', next: 'rule on its report', revises: null,
  closes: false, ...over,
});
const s = (n: number, ch = 'a'): string => ch.repeat(n);
const CAP = NOTES_CAP.count;
const REVISED: readonly NotesModule.RevisedFact[] = [...KEY_FACTS, 'not-revising'];
/** Worse key facts, in order: a fact later in the list never turns a refusal into ok. */
const ORDER: readonly KeyFact[] = ['live', 'unmeasured', 'not-yours', 'gone'];

/** The verdict, written out independently of the decider: the expectation the exhaustive case checks. */
function expected(n: NotesModule.NoteInput, key: KeyFact, count: number | 'unmeasured', revised: NotesModule.RevisedFact): string {
  if (n.closes && n.revises === null) return 'bad-request';
  if (!n.closes && n.kind === 'thread' && isBlankText(n.next)) return 'bad-request';
  if ([...n.waitsOn].length > NOTES_CAP.chars || [...n.next].length > NOTES_CAP.chars) return NOTE_REFUSALS.tooLong;
  if ((n.revises === null) !== (revised === 'not-revising')) return 'unmeasured';
  const facts = [...(revised === 'not-revising' ? [] : [revised]), ...(n.closes ? [] : [key])];
  if (facts.some((f) => f === 'gone' || f === 'not-yours')) return NOTE_REFUSALS.keyUnknown;
  if (facts.includes('unmeasured')) return 'unmeasured';
  if (n.revises !== null) return 'ok';
  if (count === 'unmeasured') return 'unmeasured';
  return count >= CAP ? NOTE_REFUSALS.cap : 'ok';
}
const word = (v: NotesModule.NoteVerdict): string => (v.ok ? 'ok' : v.refusal);

const handover = (over: Partial<HandoverNote> = {}): HandoverNote => ({
  threads: [{ ref: { kind: 'run', id: 11 }, waitsOn: 'the review', next: 'rule on it' }],
  cautions: ['the radar is slow today'], tone: 'brisk', ...over,
});

export function notesCases(m: Notes): Record<string, Case> {
  return {
    'noteVerdict: exhaustive over the key facts x the caps at, under and over x revises, closes and the count': () => {
      const texts = [s(NOTES_CAP.chars - 1), s(NOTES_CAP.chars), s(NOTES_CAP.chars + 1), '🙂'.repeat(NOTES_CAP.chars)];
      const counts: (number | 'unmeasured')[] = [0, CAP - 1, CAP, CAP + 1, 'unmeasured'];
      let n = 0;
      const pairs = [[texts[0]!, texts[1]!], [texts[2]!, 'x'], ['x', texts[2]!], [texts[3]!, texts[3]!], ['x', ' \t '], ['x', '\u200b\u2800']] as const;
      for (const key of KEY_FACTS) for (const revised of REVISED) for (const count of counts) for (const closes of [false, true])
        for (const revises of [null, 7]) for (const kind of ['thread', 'caution'] as const) for (const [waitsOn, next] of pairs) {
          const input = note({ kind, waitsOn, next, revises, closes });
          expect(word(m.noteVerdict(input, key, count, revised)), JSON.stringify({ key, revised, count, closes, revises, kind, w: waitsOn.length, x: next.length }))
            .toBe(expected(input, key, count, revised));
          n += 1;
        }
      expect(n).toBe(4 * 5 * 5 * 2 * 2 * 2 * 6);
    },
    'noteVerdict: the plan\'s named cases': () => {
      expect(m.noteVerdict(note(), 'live', CAP - 1, 'not-revising')).toEqual({ ok: true });
      expect(m.noteVerdict(note(), 'live', CAP, 'not-revising')).toEqual({ ok: false, refusal: 'note-cap' });
      expect(m.noteVerdict(note({ revises: 3 }), 'live', CAP, 'live')).toEqual({ ok: true });
      expect(m.noteVerdict(note(), 'gone', 0, 'not-revising')).toEqual({ ok: false, refusal: 'note-key-unknown' });
      expect(m.noteVerdict(note(), 'not-yours', 0, 'not-revising')).toEqual({ ok: false, refusal: 'note-key-unknown' });
      expect(m.noteVerdict(note(), 'unmeasured', 0, 'not-revising')).toEqual({ ok: false, refusal: 'unmeasured' });
      expect(m.noteVerdict(note({ revises: 3 }), 'live', 0, 'gone')).toEqual({ ok: false, refusal: 'note-key-unknown' });
      expect(m.noteVerdict(note({ revises: 3, closes: true }), 'gone', CAP, 'live')).toEqual({ ok: true });
      expect(m.noteVerdict(note({ revises: 3, closes: true }), 'live', 0, 'unmeasured')).toEqual({ ok: false, refusal: 'unmeasured' });
      expect(m.noteVerdict(note({ next: s(NOTES_CAP.chars + 1) }), 'unmeasured', CAP, 'not-revising')).toEqual({ ok: false, refusal: 'note-too-long' });
      // A thread names its next act; a caution need not; a close names the note it closes (review 2039, F1 and a nit).
      expect(m.noteVerdict(note({ next: '' }), 'live', 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
      expect(m.noteVerdict(note({ next: '  \n ' }), 'live', 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
      expect(m.noteVerdict(note({ kind: 'caution', next: '' }), 'live', 0, 'not-revising')).toEqual({ ok: true });
      // Invisible characters are blank too (review 2046, F3): a zero-width space, the braille blank, a Hangul filler.
      for (const next of ['\u200b', '\u2800', '\u3164 \u00ad', '\u200d\u2060\ufeff']) {
        expect(m.noteVerdict(note({ next }), 'live', 0, 'not-revising'), JSON.stringify(next)).toEqual({ ok: false, refusal: 'bad-request' });
      }
      expect(m.noteVerdict(note({ next: '\u200bgo' }), 'live', 0, 'not-revising')).toEqual({ ok: true });
      expect(m.noteVerdict(note({ next: '', revises: 3, closes: true }), 'live', 0, 'live')).toEqual({ ok: true });
      expect(m.noteVerdict(note({ closes: true }), 'live', 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
      // A definite refusal outranks an unreadable fact, whichever of the two it is.
      expect(m.noteVerdict(note({ revises: 3 }), 'unmeasured', 0, 'gone')).toEqual({ ok: false, refusal: 'note-key-unknown' });
      expect(m.noteVerdict(note({ revises: 3 }), 'not-yours', 0, 'unmeasured')).toEqual({ ok: false, refusal: 'note-key-unknown' });
    },
    'noteVerdict: monotone, a worse key fact never turns a refusal into ok': () => {
      for (const revised of REVISED) for (const count of [0, CAP, 'unmeasured'] as const) for (const closes of [false, true])
        for (const revises of [null, 7]) {
          const input = note({ revises, closes });
          let refused = false;
          for (const key of ORDER) {
            const ok = m.noteVerdict(input, key, count, revised).ok;
            if (refused) expect(ok, `${key} after a refusal`).toBe(false);
            refused = refused || !ok;
          }
        }
    },
    'handoverVerdict: a good note is stored whole, nothing dropped': () => {
      expect(m.handoverVerdict(handover(), ['live'])).toEqual({ ok: true, cleaned: handover(), dropped: 0 });
      expect(m.handoverVerdict(handover({ threads: [], cautions: [], tone: '' }), [])).toEqual({
        ok: true, cleaned: { threads: [], cautions: [], tone: '' }, dropped: 0,
      });
    },
    'handoverVerdict: each reference fact': () => {
      expect(m.handoverVerdict(handover(), ['gone'])).toEqual({ ok: false, refusal: 'reference-unknown' });
      expect(m.handoverVerdict(handover(), ['not-yours'])).toEqual({ ok: false, refusal: 'reference-unknown' });
      expect(m.handoverVerdict(handover(), ['unmeasured'])).toEqual({ ok: false, refusal: 'unmeasured' });
      const two = handover({ threads: [handover().threads[0]!, { ref: { kind: 'item', id: 4 }, waitsOn: 'w', next: 'n' }] });
      expect(m.handoverVerdict(two, ['unmeasured', 'gone'])).toEqual({ ok: false, refusal: 'reference-unknown' });
      expect(m.handoverVerdict(two, ['gone', 'unmeasured'])).toEqual({ ok: false, refusal: 'reference-unknown' });
      expect(m.handoverVerdict(two, ['live', 'unmeasured'])).toEqual({ ok: false, refusal: 'unmeasured' });
      expect(m.handoverVerdict(two, ['live'])).toEqual({ ok: false, refusal: 'unmeasured' });
      expect(m.handoverVerdict(two, ['live', 'live']).ok).toBe(true);
    },
    'handoverVerdict: the caps, at and over': () => {
      const tone = (n: number): HandoverNote => handover({ tone: s(n) });
      expect(m.handoverVerdict(tone(HANDOVER_TONE_MAX_CHARS), ['live']).ok).toBe(true);
      expect(m.handoverVerdict(tone(HANDOVER_TONE_MAX_CHARS + 1), ['live'])).toEqual({ ok: false, refusal: 'note-too-long' });
      expect(m.handoverVerdict(handover({ tone: '🙂'.repeat(HANDOVER_TONE_MAX_CHARS) }), ['live']).ok).toBe(true);
      const t = handover().threads[0]!;
      for (const [over, ok] of [[NOTES_CAP.chars, true], [NOTES_CAP.chars + 1, false]] as const) {
        expect(m.handoverVerdict(handover({ threads: [{ ...t, waitsOn: s(over) }] }), ['live']).ok).toBe(ok);
        expect(m.handoverVerdict(handover({ threads: [{ ...t, next: s(over) }] }), ['live']).ok).toBe(ok);
        expect(m.handoverVerdict(handover({ cautions: ['c', s(over)] }), ['live']).ok).toBe(ok);
      }
      for (const [n, ok] of [[CAP, true], [CAP + 1, false]] as const) {
        expect(m.handoverVerdict(handover({ threads: Array.from({ length: n }, () => t) }), Array.from({ length: n }, () => 'live' as const)).ok).toBe(ok);
        expect(m.handoverVerdict(handover({ cautions: Array.from({ length: n }, () => 'c') }), ['live']).ok).toBe(ok);
      }
      // The whole note's JSON is capped too (review 2039, F3): at `HANDOVER_MAX_BYTES` it is stored, one byte over it is not.
      const sized = (bytes: number): HandoverNote => {
        for (let full = Math.floor(bytes / (NOTES_CAP.chars + 3)); full >= 0; full -= 1) {
          const base = handover({ cautions: [...Array.from({ length: full }, () => s(NOTES_CAP.chars)), ''] });
          const rest = bytes - utf8Bytes(JSON.stringify(base));
          if (rest >= 0 && rest <= NOTES_CAP.chars) return handover({ cautions: [...base.cautions.slice(0, -1), s(rest)] });
        }
        throw new Error(`no handover of ${bytes} bytes`);
      };
      expect(utf8Bytes(JSON.stringify(sized(HANDOVER_MAX_BYTES)))).toBe(HANDOVER_MAX_BYTES);
      expect(m.handoverVerdict(sized(HANDOVER_MAX_BYTES), ['live']).ok).toBe(true);
      expect(m.handoverVerdict(sized(HANDOVER_MAX_BYTES + 1), ['live'])).toEqual({ ok: false, refusal: 'note-too-long' });
      // The caps measure the note as STORED (review 2046, F1): a mark is longer than the word it replaces. A field that fits
      // as sent but not as stored, and a whole note that fits as sent but not as stored, are both refused.
      const doneField = 'done '.repeat(NOTES_CAP.chars / 5).trimEnd();
      expect([...doneField].length).toBeLessThanOrEqual(NOTES_CAP.chars);
      expect(m.handoverVerdict(handover({ cautions: [doneField] }), ['live'])).toEqual({ ok: false, refusal: 'note-too-long' });
      const many = handover({ cautions: Array.from({ length: 40 }, () => 'done '.repeat(20).trimEnd()) });
      expect(utf8Bytes(JSON.stringify(many))).toBeLessThan(HANDOVER_MAX_BYTES);
      const stored = { ...many, cautions: many.cautions.map((c) => m.dropStatusWords(c).text) };
      expect(stored.cautions.every((c) => [...c].length <= NOTES_CAP.chars)).toBe(true);
      expect(utf8Bytes(JSON.stringify(stored))).toBeGreaterThan(HANDOVER_MAX_BYTES);
      expect(m.handoverVerdict(many, ['live'])).toEqual({ ok: false, refusal: 'note-too-long' });
      // In bytes, not characters: four-byte text reaches the cap at a quarter of the characters.
      const wide = handover({ cautions: Array.from({ length: 9 }, () => '🙂'.repeat(NOTES_CAP.chars)) });
      expect(m.handoverVerdict(wide, ['live'])).toEqual({ ok: false, refusal: 'note-too-long' });
      // A field over its cap is refused before its reference is read.
      expect(m.handoverVerdict(tone(HANDOVER_TONE_MAX_CHARS + 1), ['gone'])).toEqual({ ok: false, refusal: 'note-too-long' });
    },
    'handoverVerdict: status words are dropped from every free text and counted': () => {
      const r = m.handoverVerdict(handover({
        threads: [{ ref: { kind: 'run', id: 11 }, waitsOn: 'PR is merged and approved', next: 'Done: ship it' }],
        cautions: ['the fix is FIXED, not green-ish', 'landed\nnot verified yet'], tone: 'calm, all resolved',
      }), ['live']);
      const X = m.STATUS_WORD_MARK;
      expect(r).toEqual({
        ok: true, dropped: 7, cleaned: {
          threads: [{ ref: { kind: 'run', id: 11 }, waitsOn: `PR is ${X} and ${X}`, next: `${X}: ship it` }],
          cautions: [`the fix is ${X}, not green-ish`, `${X}\nnot ${X} yet`], tone: `calm, all ${X}`,
        },
      });
      expect(m.dropStatusWords('undone, mergedness, re-merged, done_x')).toEqual({ text: 'undone, mergedness, re-merged, done_x', dropped: 0 });
      expect(m.dropStatusWords('  keep   my   spacing ')).toEqual({ text: '  keep   my   spacing ', dropped: 0 });
      for (const w of m.HANDOVER_STATUS_WORDS) expect(m.dropStatusWords(`a ${w} b`), w).toEqual({ text: `a ${X} b`, dropped: 1 });
      // The mark keeps the sense visible and spacing is never closed up, on the line or any other (review 2039, F8).
      expect(m.dropStatusWords('it is not  merged;\n  do not   merge')).toEqual({ text: `it is not  ${X};\n  do not   merge`, dropped: 1 });
      // Matched on the NFKC fold with format characters stripped: fullwidth letters, a soft hyphen, a zero-width space.
      expect(m.dropStatusWords('ｄｏｎｅ, me\u00adrged, ap\u200bproved, ﬁxed')).toEqual({ text: `${X}, ${X}, ${X}, ${X}`, dropped: 4 });
      // The fold is for matching only: what is stored is the author's text as written, but for the mark (review 2046, F4).
      const written = 'x² ½ ﬁle ™ … 👨\u200d👩\u200d👧 می\u200cخواهم';
      expect(m.dropStatusWords(written)).toEqual({ text: written, dropped: 0 });
      expect(m.dropStatusWords(`x² done ½ ${written}`)).toEqual({ text: `x² ${X} ½ ${written}`, dropped: 1 });
      expect(m.dropStatusWords('\u200bdone\u200b')).toEqual({ text: `\u200b${X}\u200b`, dropped: 1 });
      expect(m.STATUS_WORD_MARK.match(new RegExp(`\\b(?:${m.HANDOVER_STATUS_WORDS.join('|')})\\b`, 'i'))).toBeNull();
    },
    'notesPage: older than before, at most limit, under the page bytes, always the first, and more': () => {
      const ns = [9, 7, 5, 4, 2].map((id) => ({ id }));
      const ids = (r: { page: readonly { id: number }[]; more: boolean }) => [r.page.map((n) => n.id), r.more];
      expect(ids(m.notesPage(ns, null, 20, () => 1))).toEqual([[9, 7, 5, 4, 2], false]);
      expect(ids(m.notesPage(ns, null, 2, () => 1))).toEqual([[9, 7], true]);
      expect(ids(m.notesPage(ns, 7, 2, () => 1))).toEqual([[5, 4], true]);
      expect(ids(m.notesPage(ns, 5, 20, () => 1))).toEqual([[4, 2], false]);
      expect(ids(m.notesPage(ns, 2, 20, () => 1))).toEqual([[], false]);
      expect(ids(m.notesPage(ns, 10, 1, () => 1))).toEqual([[9], true]);
      const half = Math.floor(m.NOTE_LIST_PAGE_BYTES / 2);
      expect(ids(m.notesPage(ns, null, 20, () => half))).toEqual([[9, 7], true]);
      expect(ids(m.notesPage(ns, null, 20, () => half + 1))).toEqual([[9], true]);
      expect(ids(m.notesPage(ns, null, 20, () => m.NOTE_LIST_PAGE_BYTES * 2))).toEqual([[9], true]);
      expect(m.NOTE_LIST_PAGE_BYTES).toBeLessThan(TOOL_RESULT_CUT_BYTES);
      // A note is sized with the widest key fact and its comma (review 2046, F2).
      expect(m.noteListBytes({ id: 1 })).toBe(utf8Bytes('{"id":1,"keyFact":"unmeasured"}') + 1);
      expect(m.NOTE_LIST_LIMIT.max).toBe(CAP);
    },
    'isBlankText: whitespace and invisible characters are blank; any visible character is not': () => {
      for (const b of ['', ' ', '\n\t', '\u00a0', '\u3000', '\u200b', '\u200c\u200d', '\u2060', '\u00ad', '\u2800', '\u3164', '\u115f\u1160', '\uffa0', '\u034f', '\u061c', '\u200e', '\ufeff']) {
        expect(isBlankText(b), JSON.stringify(b)).toBe(true);
      }
      for (const v of ['a', '.', '\u200ba', '🙂', '-', '\u0301']) expect(isBlankText(v), JSON.stringify(v)).toBe(false);
    },
    'noteKeyFact: a programme, an item and a run, for the caller': () => {
      const f = m.noteKeyFact;
      expect([true, false, 'unmeasured'].map((claims) => f({ kind: 'programme', claims: claims as boolean | 'unmeasured' }, CALLER)))
        .toEqual(['live', 'not-yours', 'unmeasured']);
      const it = (state: string, raisedBy: string, claimsProgramme: boolean | 'unmeasured') =>
        f({ kind: 'item', item: { state: state as 'open', raisedBy, program: 'prog-a', claimsProgramme } }, CALLER);
      expect(f({ kind: 'item', item: 'absent' }, CALLER)).toBe('gone');
      expect(f({ kind: 'item', item: 'unmeasured' }, CALLER)).toBe('unmeasured');
      for (const state of ['open', 'checking']) {
        expect(it(state, CALLER, false), state).toBe('live');
        expect(it(state, CALLER, 'unmeasured'), state).toBe('live');
        expect(it(state, 'lane-b', true), state).toBe('live');
        expect(it(state, 'lane-b', false), state).toBe('not-yours');
        expect(it(state, 'lane-b', 'unmeasured'), state).toBe('unmeasured');
      }
      for (const state of ['done', 'withdrawn', 'dismissed']) expect(it(state, CALLER, true), state).toBe('gone');
      const run = (state: string, claimedByCaller: boolean | 'unmeasured') => f({ kind: 'run', run: { state: state as 'working', claimedByCaller } }, CALLER);
      expect(f({ kind: 'run', run: 'absent' }, CALLER)).toBe('gone');
      expect(f({ kind: 'run', run: 'unmeasured' }, CALLER)).toBe('unmeasured');
      for (const state of ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown']) {
        expect([run(state, true), run(state, false), run(state, 'unmeasured')], state).toEqual(['live', 'not-yours', 'unmeasured']);
      }
      for (const state of ['done', 'failed']) expect(run(state, true), state).toBe('gone');
    },
    'revisedNoteFact: a live note of the caller\'s, a superseded one, another\'s, none, unread': () => {
      const f = m.revisedNoteFact;
      expect([
        f({ identity: CALLER, live: true }, CALLER), f({ identity: CALLER, live: false }, CALLER), f({ identity: 'lane-b', live: true }, CALLER),
        f({ identity: 'lane-b', live: false }, CALLER), f('absent', CALLER), f('unmeasured', CALLER),
      ]).toEqual(['live', 'gone', 'not-yours', 'not-yours', 'gone', 'unmeasured']);
    },
    'handoverAsked: only checkpointed asks': () => {
      for (const g of GENERATION_STATES as readonly GenerationState[]) expect(m.handoverAsked(g), g).toBe(g === 'checkpointed' ? 'asked' : 'not-asked');
      expect(m.handoverAsked('no-generation')).toBe('not-asked');
      expect(m.handoverAsked('unmeasured')).toBe('unmeasured');
    },
  };
}
