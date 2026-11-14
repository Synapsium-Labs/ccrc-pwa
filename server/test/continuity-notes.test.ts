// What a note and a handover note may say (Overlord W1a, the notes plan, Task 1; spec §3.3.2 C37). The deciders are L1 and
// pure, so every case here is exhaustive over their inputs; `notesCases` is also the mutation suite (`sim/notesMutants.ts`).
import { describe, expect, it } from 'vitest';
import { KEY_FACTS, NOTE_KEY_KINDS, NOTE_KINDS, isKeyFact, isNoteKeyKind, isNoteKind } from '../../shared/continuity.js';
import * as notes from '../src/continuity/notes.js';
import { notesCases } from './continuityNotesCases.js';

describe('the note vocabulary', () => {
  it('lists in order, one guard each', () => {
    expect(NOTE_KEY_KINDS).toEqual(['programme', 'item', 'run']);
    expect(NOTE_KINDS).toEqual(['thread', 'caution']);
    expect(KEY_FACTS).toEqual(['live', 'gone', 'not-yours', 'unmeasured']);
    const refused: unknown[] = ['', 'constructor', '__proto__', null, undefined, 0, {}, ['run']];
    for (const [guard, members, near] of [[isNoteKeyKind, NOTE_KEY_KINDS, 'Run'], [isNoteKind, NOTE_KINDS, 'threads'],
      [isKeyFact, KEY_FACTS, 'not_yours']] as const) {
      for (const m of members) expect((guard as (v: unknown) => boolean)(m)).toBe(true);
      for (const v of [...refused, near]) expect((guard as (v: unknown) => boolean)(v)).toBe(false);
    }
  });
});

describe('noteVerdict, handoverVerdict, noteKeyFact and handoverAsked', () => {
  for (const [name, run] of Object.entries(notesCases(notes))) it(name, run);
});
