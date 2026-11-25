// The authority witness reaches the ladder through the composed server (Overlord W1 authority journal B; review 3787 F1).
// `buildServer` hands the ladder two pieces of the exchange: the `no-witness-since-boot` row's input, and the witness a
// narrowing asks (`deps.ladderWitness ?? deps.overlordAuthorityExchange`). A merge could drop either one and every unit
// suite would stay green, because each reads the ladder with its own inputs. This case drives `GET /api/overlord/ladder` on
// the composed server with a stand-in exchange whose two answers move once a witness is recorded.
//
// Mutation table (each wiring piece, and what goes red without it):
//   `noWitnessSinceBoot` handed to `ladderConditionInputs` ... the row reads `unmeasured`, not `standing`
//   the `?? deps.overlordAuthorityExchange` fallback ......... the narrowing stays `no-witness-yet` once a witness is recorded
import { expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { OverlordAuthorityExchange } from '../src/coord/overlordAuthorityExchange.js';
import { buildServer } from '../src/server.js';
import { fakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';

const NOW_MS = 2_000_000_000_000;

it('the composed server reads the no-witness row and a narrowing\'s witness from the authority exchange', async () => {
  const fixture = testDeps();
  const db = openCoordDb(':memory:');
  const coord = new CoordStore(db);
  // A witness is recorded when `recorded` turns true: the row lifts, and the operator's journalled narrowing is held.
  let recorded = false;
  const exchange = {
    noWitnessSinceBoot: (): 'standing' | 'lifted' => (recorded ? 'lifted' : 'standing'),
    heldFor: (seq: number): 'held' | 'not-yet' | 'unmeasured' => (recorded && seq === 7 ? 'held' : 'not-yet'),
  } as unknown as OverlordAuthorityExchange;
  const deps = { ...fixture, coord, time: fakeTime({ wallMs: NOW_MS }).ports, overlordAuthorityExchange: exchange };
  try {
    // The operator's narrowing, journalled at authority sequence 7.
    db.exec(`INSERT INTO overlord_ladder (id, operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt)
      VALUES (1, 'chat', 'operator-a', 1, 7, NULL, 1)`);
    const app = await buildServer(deps, new Bus());
    try {
      const ladder = async (): Promise<{ row: unknown; narrowing: unknown }> => {
        const res = await app.inject('/api/overlord/ladder');
        expect(res.statusCode).toBe(200);
        const body = res.json();
        return { row: body.conditions.find((c: { cause: string }) => c.cause === 'no-witness-since-boot'), narrowing: body.lastChange?.narrowing };
      };
      expect(await ladder()).toMatchObject({
        row: { reading: 'standing' }, narrowing: { state: 'taking-effect', why: 'no-witness-yet' },
      });
      recorded = true;
      expect(await ladder()).toMatchObject({ row: { reading: 'lifted' }, narrowing: { state: 'done' } });
    } finally { await app.close(); }
  } finally { db.close(); }
});
