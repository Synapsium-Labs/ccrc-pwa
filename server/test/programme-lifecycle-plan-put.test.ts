// Programme lifecycle W1 (R11 rules 3, 4 and 6, D-8993; W1 review S4 and C3): a `plan put` on a slug that does not exist
// yet starts a programme its putter owns, exactly as its first run would, so it is refused exactly as that run is. On the
// builder's first cut a refused putter still got a 200 and an unbound programme it went on owning through `planBy`, on
// which no run could ever open. Through the real plan routes (`charWorld`, a fixture HOME).
import { afterEach, describe, expect, it } from 'vitest';
import { CHAR_COORD, CHAR_COORD_B, charWorld, ONE, planVerb, SIX, type CharWorld } from './helpers/planPhasesFixture.js';

let worlds: CharWorld[] = [];
afterEach(async () => { for (const w of worlds) await w.app.close(); worlds = []; });
const world = async (): Promise<CharWorld> => { const w = await charWorld(); worlds.push(w); return w; };

describe('plan put on a new slug is a start (R11)', () => {
  it('binds the putter, with its attributed uuid, and records who started it', async () => {
    const w = await world();
    expect((await planVerb(w, 'prog-a', '', SIX)).statusCode).toBe(200);
    expect(w.coord.programmeLifecycleRow('prog-a')).toMatchObject({ state: 'active', coordinator: CHAR_COORD, coordinatorUuid: `u-${CHAR_COORD}` });
    expect(w.plan.planOwnerOf('prog-a')).toBe(CHAR_COORD);
    expect(w.coord.claimsProgramme(CHAR_COORD, 'prog-a', `u-${CHAR_COORD}`)).toBe(true);
    expect(w.coord.claimsProgramme(CHAR_COORD, 'prog-a', 'u-a-new-incarnation')).toBe(false);
  });

  it('a putter that owns another programme is refused owns-another-programme, naming it, and nothing is minted', async () => {
    const w = await world();
    expect((await planVerb(w, 'prog-a', '', SIX)).statusCode).toBe(200);
    const r = await planVerb(w, 'prog-b', '', ONE);
    expect([r.statusCode, r.json()]).toMatchObject([409, { ok: false, refused: 'owns-another-programme' }]);
    expect((r.json() as { detail: string }).detail).toContain('prog-a');
    expect(w.coord.programmeLifecycleRow('prog-b')).toBeNull();
    expect(w.plan.planOf('prog-b').epics).toEqual([]);
    // another coordinator, never joined, may start it
    expect((await planVerb(w, 'prog-b', '', ONE, CHAR_COORD_B)).statusCode).toBe(200);
    expect(w.coord.programmeLifecycleRow('prog-b')?.coordinator).toBe(CHAR_COORD_B);
  });

  it('a putter left owning nothing (its programme released) is refused not-your-programme: it is given one, never takes one', async () => {
    const w = await world();
    expect((await planVerb(w, 'prog-a', '', SIX)).statusCode).toBe(200);
    expect(w.coord.reclaimProgramme('prog-a', CHAR_COORD, null, Date.now(), null)).toMatchObject({ ok: true });
    const r = await planVerb(w, 'prog-b', '', ONE);
    expect([r.statusCode, r.json()]).toMatchObject([403, { ok: false, error: 'not-your-programme' }]);
    expect(w.coord.programmeLifecycleRow('prog-b')).toBeNull();
    // and its released programme's plan is no longer its own to write
    const again = await planVerb(w, 'prog-a', '', SIX);
    expect(again.statusCode).not.toBe(200);
  });
});
