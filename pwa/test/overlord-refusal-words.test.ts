// The Overlord place's door refusals in words (Overlord W1 home B; review 3998 M3): one table of sentences, one reader. A word
// whose sentence depends on the act says the act that was refused (`auth-off` refuses every stepped door while sign-in is off, and
// "to start the Overlord" is true of Start alone); the facts an answer names are added; an unknown word is drawn raw.
import { describe, expect, it } from 'vitest';
import { ApiError, OVERLORD_PLACE_REFUSAL_TEXT, REBIND_MOVED_TEXT, overlordRefusalText, type OverlordDoorAct } from '../src/lib/api';

const refused = (error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(409, { ok: false, error, ...extra });
/** The acts whose door asks the account gate, so sign-in off refuses them `auth-off`. Pause and a lowered rung are not among
 *  them: the server asks sign-in only of a raise (home C's carried 4a). */
const GATED: readonly OverlordDoorAct[] = ['start', 'rebind', 'restart', 'raise', 'clear', 'retire', 'model', 'account-set'];
const UNGATED: readonly OverlordDoorAct[] = ['pause', 'lower'];
const ACTS: readonly OverlordDoorAct[] = [...GATED, ...UNGATED];

describe('overlordRefusalText', () => {
  it('auth-off says the act that was refused, one sentence per gated act, and Start keeps its own', () => {
    const said = GATED.map((act) => overlordRefusalText(refused('auth-off'), act));
    expect(said[0]).toBe(OVERLORD_PLACE_REFUSAL_TEXT['auth-off']);
    expect(new Set(said).size, 'each act its own sentence').toBe(GATED.length);
    expect(overlordRefusalText(refused('auth-off'), 'rebind')).toBe('Sign-in must be on to rebind the Overlord.');
    expect(overlordRefusalText(refused('auth-off'), 'raise')).toBe("Sign-in must be on to raise the Overlord's rung.");
    expect(overlordRefusalText(refused('auth-off'), 'clear')).toBe("Sign-in must be on to clear a latch of the Overlord's ladder.");
    expect(overlordRefusalText(refused('auth-off'), 'retire')).toBe('Sign-in must be on to retire the Overlord.');
    for (const act of GATED.slice(1)) expect(overlordRefusalText(refused('auth-off'), act), act).not.toContain('to start the Overlord');
  });

  it('Pause and a lowered rung never claim sign-in is needed: the server asks it only of a raise, so the word is drawn raw', () => {
    for (const act of UNGATED) {
      const said = overlordRefusalText(refused('auth-off'), act);
      expect(said, act).toBe('Refused: auth-off');
      expect(said, act).not.toMatch(/Sign-in must be on/);
    }
  });

  it('stale-designation has a sentence for Rebind alone (call 1685): every other act draws it raw, so no other screen\'s meaning changes', () => {
    expect(overlordRefusalText(refused('stale-designation', { detail: 'lane-b-overlord is bound, at term 2' }), 'rebind')).toBe(REBIND_MOVED_TEXT);
    for (const act of ACTS.filter((a) => a !== 'rebind')) {
      expect(overlordRefusalText(refused('stale-designation'), act), act).toBe('Refused: stale-designation');
    }
    expect(Object.values(OVERLORD_PLACE_REFUSAL_TEXT)).not.toContain(REBIND_MOVED_TEXT);
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

  it('overlord-lanes-unarmed (overlord-v1\'s guard): its sentence says where lanes are set live, then each lane the answer names, by the card\'s row name', () => {
    const lanes = [{ lane: 'continuity', reads: 'shadow' }, { lane: 'launch-profile', reads: 'gated' }, { lane: 'anchor-slot', reads: 'unread' }];
    const sentence = OVERLORD_PLACE_REFUSAL_TEXT['overlord-lanes-unarmed'];
    expect(sentence).toContain('Shadow lanes card');
    for (const act of ['start', 'rebind'] as const) {
      expect(overlordRefusalText(refused('overlord-lanes-unarmed', { lanes }), act)).toBe(`${sentence} Not live: Renew long-lived sessions (in shadow), `
        + 'Launch profiles (set live, but its gate is closed), Anchor at every start (could not be read).');
    }
  });

  it('overlord-lanes-unarmed with a lane list this console cannot read draws the sentence alone, never a guessed lane', () => {
    const sentence = OVERLORD_PLACE_REFUSAL_TEXT['overlord-lanes-unarmed'];
    for (const lanes of [undefined, [], 'continuity', [{ lane: 'a-newer-lane', reads: 'shadow' }], [{ lane: 'continuity', reads: 'asleep' }], [null]]) {
      expect(overlordRefusalText(refused('overlord-lanes-unarmed', lanes === undefined ? {} : { lanes }), 'start'), JSON.stringify(lanes)).toBe(sentence);
    }
  });
});
