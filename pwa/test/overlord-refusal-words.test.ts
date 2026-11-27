// The Overlord place's door refusals in words (Overlord W1 home B; review 3998 M3): one table of sentences, one reader. A word
// whose sentence depends on the act says the act that was refused (`auth-off` refuses every stepped door while sign-in is off, and
// "to start the Overlord" is true of Start alone); the facts an answer names are added; an unknown word is drawn raw.
import { describe, expect, it } from 'vitest';
import { ApiError, OVERLORD_PLACE_REFUSAL_TEXT, overlordRefusalText, type OverlordDoorAct } from '../src/lib/api';

const refused = (error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(409, { ok: false, error, ...extra });
const ACTS: readonly OverlordDoorAct[] = ['start', 'rebind', 'restart', 'pause', 'lower', 'raise', 'clear'];

describe('overlordRefusalText', () => {
  it('auth-off says the act that was refused, one sentence per act, and Start keeps its own', () => {
    const said = ACTS.map((act) => overlordRefusalText(refused('auth-off'), act));
    expect(said[0]).toBe(OVERLORD_PLACE_REFUSAL_TEXT['auth-off']);
    expect(new Set(said).size, 'each act its own sentence').toBe(ACTS.length);
    expect(overlordRefusalText(refused('auth-off'), 'rebind')).toBe('Sign-in must be on to rebind the Overlord.');
    expect(overlordRefusalText(refused('auth-off'), 'raise')).toBe("Sign-in must be on to raise the Overlord's rung.");
    expect(overlordRefusalText(refused('auth-off'), 'clear')).toBe("Sign-in must be on to clear a latch of the Overlord's ladder.");
    for (const act of ACTS.slice(1)) expect(overlordRefusalText(refused('auth-off'), act), act).not.toContain('to start the Overlord');
  });

  it('a word whose sentence does not depend on the act says the same for every act', () => {
    for (const act of ACTS) expect(overlordRefusalText(refused('overlord-exists'), act)).toBe(OVERLORD_PLACE_REFUSAL_TEXT['overlord-exists']);
  });

  it('adds what the answer names: the capability word, the accounts counted, the detail', () => {
    expect(overlordRefusalText(refused('capability-missing', { needs: 'overlord-route-v1' }), 'raise'))
      .toBe(`${OVERLORD_PLACE_REFUSAL_TEXT['capability-missing']} It needs overlord-route-v1.`);
    expect(overlordRefusalText(refused('overlord-single-account', { count: 1 }), 'start'))
      .toBe(`${OVERLORD_PLACE_REFUSAL_TEXT['overlord-single-account']} It counts 1.`);
    expect(overlordRefusalText(refused('overlord-body-alive', { detail: 'unmeasured' }), 'rebind'))
      .toBe(`${OVERLORD_PLACE_REFUSAL_TEXT['overlord-body-alive']} (unmeasured)`);
  });

  it('draws an unknown word raw, and a failure with no word as its message', () => {
    expect(overlordRefusalText(refused('a-newer-word'), 'pause')).toBe('Refused: a-newer-word');
    expect(overlordRefusalText(new TypeError('Failed to fetch'), 'pause')).toBe('Failed to fetch');
  });
});
