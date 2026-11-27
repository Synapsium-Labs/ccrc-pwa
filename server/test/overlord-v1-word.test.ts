// The `overlord-v1` word (Overlord W1, plan 2026-11-25-overlord-w1-overlord-v1.md Task 1, Table 1 rows H1 to H9 and H23):
// the server advertises it, and with the PRODUCTION word list every Overlord door that carries it passes step 2 of the gate
// order. The doors' own suites inject their words, so this is the one case that reads `SERVER_CAPS` itself (finding G2: the
// census's hand list named the word while no server advertised it).
import { describe, expect, it } from 'vitest';
import { SERVER_CAPS } from '../../shared/api.js';
import { OVERLORD_DOORS, type OverlordDoorRow } from '../src/coord/overlordDoors.js';
import { overlordGate } from '../src/coord/overlordGate.js';
import { passFacts } from './sim/gateSets.js';

/** The W1 words a door row may carry (`overlord-doors-census.test.ts#SERVER_WORDS`' W1 rows). */
const W1_WORDS = ['continuity-v1', 'timers-v1', 'overlord-v1'] as const;

const overlordRows = (): [string, OverlordDoorRow][] => Object.entries(OVERLORD_DOORS)
  .filter((e): e is [string, OverlordDoorRow] => e[1].group === 'overlord');
const wordRows = (): [string, OverlordDoorRow][] => overlordRows().filter(([, r]) => r.word === 'overlord-v1');

describe('the overlord-v1 word (Overlord W1, overlord-v1 Task 1)', () => {
  it('SERVER_CAPS advertises overlord-v1', () => {
    expect(SERVER_CAPS as readonly string[]).toContain('overlord-v1');
  });

  it('every Overlord door that carries overlord-v1 passes step 2 under the production word list, link-team included', () => {
    const rows = wordRows();
    // Counted from the door table, never from the plan: seven on main at this build.
    expect(rows.map(([k]) => k).sort()).toEqual(['acknowledge', 'board', 'history', 'inbox', 'link-team', 'messages', 'sequence']);
    for (const [key, row] of rows) {
      const v = overlordGate(passFacts(row, { serverWords: SERVER_CAPS }));
      expect(v.kind === 'refuse' && v.step === '2', `${key}: ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('CONTROL: the same rows refuse capability-missing at step 2 under the word list less overlord-v1', () => {
    for (const [key, row] of wordRows()) {
      const v = overlordGate(passFacts(row, { serverWords: SERVER_CAPS.filter((w) => w !== 'overlord-v1') }));
      expect(v, key).toMatchObject({ kind: 'refuse', word: 'capability-missing', step: '2' });
    }
  });

  it('every W1 word on an Overlord door row is in SERVER_CAPS', () => {
    const onRows = new Set(overlordRows().map(([, r]) => r.word).filter((w) => (W1_WORDS as readonly string[]).includes(w)));
    expect([...onRows].sort()).toEqual([...W1_WORDS].sort());
    for (const w of onRows) expect(SERVER_CAPS as readonly string[], w).toContain(w);
  });
});
