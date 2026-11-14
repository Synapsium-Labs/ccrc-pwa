// The note deciders' mutant sets (Overlord W1a, the notes plan, Task 1; the floors rule is D-8217's): `noteVerdict`,
// `handoverVerdict` and `noteKeyFact`, each run against the cases `continuity-notes.test.ts` asserts, loaded from the
// mutated copy of server/src/continuity/notes.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as NotesModule from '../../src/continuity/notes.js';
import { notesCases } from '../continuityNotesCases.js';
import type { MutantSet } from './mutate.js';

const NOTES_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/notes.ts');
const suite = (m: typeof NotesModule) => notesCases(m);

const NOTE_VERDICT_SET: MutantSet<typeof NotesModule> = {
  modulePath: NOTES_TS,
  mutants: [
    { id: 'N1 the length cap off by one', old: 'const overCap = (s: string, cap: number): boolean => chars(s) > cap;', new: 'const overCap = (s: string, cap: number): boolean => chars(s) >= cap;' },
    { id: 'N2 the length counted in UTF-16 units', old: 'const chars = (s: string): number => [...s].length;', new: 'const chars = (s: string): number => s.length;' },
    { id: 'N3 next unchecked', old: 'overCap(n.waitsOn, NOTES_CAP.chars) || overCap(n.next, NOTES_CAP.chars)) return', new: 'overCap(n.waitsOn, NOTES_CAP.chars)) return' },
    { id: 'N4 the count cap off by one', old: 'if (liveCount >= NOTES_CAP.count) return', new: 'if (liveCount > NOTES_CAP.count) return' },
    { id: 'N5 a revision counted against the cap', old: '  if (n.revises === null) {\n    if (liveCount', new: '  {\n    if (liveCount' },
    { id: 'N6 a close checks its key', old: '  if (!n.closes) facts.push(key);', new: '  facts.push(key);' },
    { id: 'N7 the revised note unchecked', old: '  if (revised !== \'not-revising\') facts.push(revised);', new: '' },
    { id: 'N8 unmeasured reads as unknown', old: "f === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.keyUnknown", new: 'NOTE_REFUSALS.keyUnknown' },
    { id: 'N9 not-yours accepted', old: "return f === 'live' ? null :", new: "return f === 'live' || f === 'not-yours' ? null :" },
    { id: 'N10 an unreadable fact outranks a definite one', old: "refusals.find((r) => r !== 'unmeasured') ?? refusals[0] ?? null", new: 'refusals[0] ?? null' },
    { id: 'N11 an unmeasured count accepted', old: "    if (liveCount === 'unmeasured') return { ok: false, refusal: 'unmeasured' };\n", new: '' },
    { id: 'N12 a mismatched revision fact accepted', old: "  if ((n.revises === null) !== (revised === 'not-revising')) return { ok: false, refusal: 'unmeasured' };\n", new: '' },
  ],
  suite,
};

const HANDOVER_VERDICT_SET: MutantSet<typeof NotesModule> = {
  modulePath: NOTES_TS,
  mutants: [
    { id: 'H1 the tone cap off by one', old: 'overCap(h.tone, HANDOVER_TONE_MAX_CHARS)', new: 'overCap(h.tone, HANDOVER_TONE_MAX_CHARS + 1)' },
    { id: 'H2 the tone unchecked', old: ' || overCap(h.tone, HANDOVER_TONE_MAX_CHARS);', new: ';' },
    { id: 'H3 cautions unchecked', old: '    || h.cautions.some((c) => overCap(c, NOTES_CAP.chars))', new: '    ' },
    { id: 'H4 the thread count unchecked', old: 'h.threads.length > NOTES_CAP.count || ', new: '' },
    { id: 'H5 the caution count unchecked', old: ' || h.cautions.length > NOTES_CAP.count', new: '' },
    { id: 'H6 a missing reference fact accepted', old: "  if (refs.length !== h.threads.length) return { ok: false, refusal: 'unmeasured' };\n", new: '' },
    { id: 'H7 an unknown reference answers unmeasured', old: "refused === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.referenceUnknown", new: "'unmeasured'" },
    { id: 'H8 an unreadable reference answers reference-unknown', old: "refused === 'unmeasured' ? 'unmeasured' : NOTE_REFUSALS.referenceUnknown", new: 'NOTE_REFUSALS.referenceUnknown' },
    { id: 'H9 status words kept in the tone', old: '    tone: clean(h.tone),', new: '    tone: h.tone,' },
    { id: 'H10 status words kept in the cautions', old: '    cautions: h.cautions.map(clean),', new: '    cautions: h.cautions,' },
    { id: 'H11 the drop count not kept', old: 'dropped += r.dropped;', new: '' },
    { id: 'H12 status words matched case-sensitively', old: "'giu');", new: "'gu');" },
    { id: 'H13 a word inside a word dropped', old: '(?<![\\\\p{L}\\\\p{N}_-])(?:', new: '(?:' },
    { id: 'H14 spaces left open', old: ".map((l) => l.replace(/[ \\t]{2,}/g, ' ').trim())", new: '' },
  ],
  suite,
};

const NOTE_KEY_SET: MutantSet<typeof NotesModule> = {
  modulePath: NOTES_TS,
  mutants: [
    { id: 'K1 a closed item is live', old: "if (r.item === 'absent' || !OPEN_ITEMS.has(r.item.state)) return 'gone';", new: "if (r.item === 'absent') return 'gone';" },
    { id: 'K2 an item of another programme is live', old: "if (r.item.raisedBy === caller) return 'live';", new: "return 'live';" },
    { id: 'K3 a terminal run is live', old: "if (r.run === 'absent' || TERMINAL_RUNS.has(r.run.state)) return 'gone';", new: "if (r.run === 'absent') return 'gone';" },
    { id: 'K4 another\'s run is live', old: "r.run.claimedByCaller ? 'live' : 'not-yours'", new: "'live'" },
    { id: 'K13 an unread claim is not yours', old: "return r.run.claimedByCaller === 'unmeasured' ? 'unmeasured' :", new: "return r.run.claimedByCaller === 'unmeasured' ? 'not-yours' :" },
    { id: 'K5 an unclaimed programme is gone', old: "r.claims ? 'live' : 'not-yours';\n    case 'item'", new: "r.claims ? 'live' : 'gone';\n    case 'item'" },
    { id: 'K6 an unreadable programme is not yours', old: "return r.claims === 'unmeasured' ? 'unmeasured' :", new: "return r.claims === 'unmeasured' ? 'not-yours' :" },
    { id: 'K7 an unreadable item is gone', old: "if (r.item === 'unmeasured') return 'unmeasured';", new: "if (r.item === 'unmeasured') return 'gone';" },
    { id: 'K8 an unreadable run is gone', old: "if (r.run === 'unmeasured') return 'unmeasured';", new: "if (r.run === 'unmeasured') return 'gone';" },
    { id: 'K10 another\'s note revisable', old: "  if (r.identity !== caller) return 'not-yours';\n", new: '' },
    { id: 'K11 a superseded note revisable', old: "  return r.live ? 'live' : 'gone';", new: "  return 'live';" },
    { id: 'K12 an unread note is gone', old: "  if (r === 'unmeasured') return 'unmeasured';\n  if (r === 'absent')", new: "  if (r === 'unmeasured') return 'gone';\n  if (r === 'absent')" },
    { id: 'K9 handover asked outside checkpointed', old: "gen === 'checkpointed' ? 'asked' : 'not-asked'", new: "gen !== 'no-generation' ? 'asked' : 'not-asked'" },
  ],
  suite,
};

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const NOTES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/notes.ts#noteVerdict': NOTE_VERDICT_SET as MutantSet<never>,
  'server/src/continuity/notes.ts#handoverVerdict': HANDOVER_VERDICT_SET as MutantSet<never>,
  'server/src/continuity/notes.ts#noteKeyFact': NOTE_KEY_SET as MutantSet<never>,
};
