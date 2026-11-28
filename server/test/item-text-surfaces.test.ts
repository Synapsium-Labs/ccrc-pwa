// Every place that SUMMARISES an item's title shows plain text, through the one projection (`itemPlainText`, shared/itemText.ts):
// the push copy, the raise's operator notice and the continuity card's open item. The tick mail's subject is a lookup key and
// keeps the raw title, as main builds it (fix round 1, F4). One case per surface, each over a title carrying backticks, emphasis and a link.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { itemPushPayload } from '../src/pushOutbox.js';
import { itemMailBody, itemMailSubject, tickMail } from '../src/coord/ledgersMail.js';
import { insertSystemMailTx } from '../src/coord/rundefsTx.js';
import { registerLedgerCoordinatorRoutes } from '../src/coord/ledgersRoutes.js';
import { Bus } from '../src/bus.js';
import { gatherCardFacts, type CardFactsDeps } from '../src/continuity/cardFacts.js';
import type { ChildMark, ChildReclaimGeneration } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const RAW = 'Set `FLAG` to **on** for [the spec](https://example.com/a)';
const PLAIN = 'Set FLAG to on for the spec';
const NOW = 1_800_000_000_000;
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-item-text-'), '.ccrc', 'coord.db')));
const raiseOn = (c: CoordStore, program: string, raisedBy: string, runId: number | null = null) =>
  c.raiseItem({ program, runId, raisedBy, kind: 'do', title: RAW, why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW - 5_000);

describe('an item title in a summary is plain text', () => {
  it('the push body', () => {
    expect(itemPushPayload(7, RAW).body).toBe(PLAIN);
  });

  // Fix round 1 of wave 186, F4: the tick mail's SUBJECT is a lookup key, not a summary for the operator. The stale label and
  // the duplicate-tick guard find an item's newest tick mail by the whole subject, so it stays exactly as main builds it, the
  // raw title included; only the summary surfaces project.
  it('the tick mail subject is main\'s, byte for byte, for a title with marks; the body keeps the raw text too', () => {
    const c = store();
    const id = raiseOn(c, 'prog-a', 'lane-a');
    const item = c.itemById(id)!;
    expect(itemMailSubject(item)).toBe(`done: item ${id}: ${RAW}`);
    const mail = tickMail(item, null);
    expect(mail.ok && mail.subject).toBe(`done: item ${id}: ${RAW}`);
    expect(itemMailBody(item, null)).toContain(RAW);
  });

  it('a tick mail queued with the raw-title subject is still found by both readers (the stale label\'s and the duplicate guard\'s)', () => {
    const c = store();
    const id = raiseOn(c, 'prog-a', 'lane-a');
    const item = c.itemById(id)!;
    // Queued as an older build queued it: the raw title in the subject.
    insertSystemMailTx(c, null, { fromId: 'operator', toId: 'lane-a', runId: null, kind: 'answer', subject: `done: item ${id}: ${RAW}`, body: 'b' });
    // The stale label's reader (`viewOfItem`) asks by `itemMailSubject(row)`; the duplicate guard's (`tickPlan`) by the
    // subject `tickMail` builds for the next tick.
    expect(c.newestTickMail(itemMailSubject(item))).toMatchObject({ toId: 'lane-a' });
    const next = tickMail(item, null);
    if (!next.ok) throw new Error('the tick mail is too large');
    expect(c.newestTickMail(next.subject)).toMatchObject({ toId: 'lane-a' });
  });

  it('the continuity card\'s open item', async () => {
    const c = store();
    c.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'lane-a-project-a' });
    raiseOn(c, 'prog-a', 'lane-a-project-a');
    const deps: CardFactsDeps = {
      coord: c, childMark: async (): Promise<ChildMark | never> => ({ kind: 'none' }),
      incarnation: async (): Promise<ChildReclaimGeneration> => ({ kind: 'value', v: '0b1c2d3e-4f50-4617-8899-aabbccddeeff' }), declaredIntent: () => false,
    };
    const { facts } = await gatherCardFacts(deps, 'lane-a-project-a', NOW);
    if (facts.itemsRaised.kind !== 'read') throw new Error('unmeasured');
    expect(facts.itemsRaised.value.map((i) => i.text)).toEqual([PLAIN]);
  });

  it('the raise\'s operator notice', async () => {
    const c = store();
    c.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'lane-a' });
    const seen: { title: string; body: string }[] = [];
    const app = Fastify();
    registerLedgerCoordinatorRoutes(app, {
      coord: c, requireMailToken: () => true, requireAttribution: async () => true, bus: new Bus(), now: () => NOW,
      notice: ((e: { title: string; body: string }) => { seen.push({ title: e.title, body: e.body }); return {}; }) as never,
      presenceOf: () => ({ kind: 'live' }) as never, secretOf: () => null,
    });
    const res = await app.inject({
      method: 'POST', url: '/api/programmes/prog-a/items',
      payload: { byId: 'lane-a', byUuid: 'u-lane-a', kind: 'do', title: RAW, why: 'w', how: ['x'], neededBy: 'blocking' } as never,
    });
    await app.close();
    expect(res.statusCode, res.body).toBe(200);
    expect(seen).toEqual([{ title: 'Waiting on you', body: PLAIN }]);
  });
});
