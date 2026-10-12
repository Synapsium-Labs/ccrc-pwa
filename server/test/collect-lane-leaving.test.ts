// Child reclamation wave 9 (spec §5.10): what the collector's lane owes when an id LEAVES its population, at the lane.
// L1 decides each (`collect-leaving-l1.test.ts` pins the rules); these cases pin that the watcher applies them:
// - a `collected` act whose id was forgotten while its `ws-collect` was out still writes its feed row, worded from the
//   job's own observation-2 document: ccd drops the quarantine record as a collection's last step, so a gather can
//   land between that drop and the fold, and the operator's record of a server-made deletion is never lost;
// - a box-wide line never outlives the ids behind it: the pass-scoped `no-document` line drops once none of its ids is
//   still a candidate, and stands while they are merely paced; the box-probe line clears once the measured population
//   holds no ids, and stands while a listing is unmeasured;
// - an id whose registry row stands again projects no per-id item, and its memory is kept: the item returns once the
//   row goes.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model, the registry a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COLLECT_FEED_TITLE, collectFeedCollectedBody } from '../src/collectLane.js';
import type { ChildReclaimAttention, ChildReclaimCollectAttention } from '../../shared/api.js';
import { collectRig, type CcdAnswer, type CollectRig } from './collectLaneFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

/** The box-wide words standing on the frame. */
const boxWords = async (f: CollectRig): Promise<string[]> => f.boxWide(await f.attention()).map((a) => a.word);
/** The per-id collector items for `id` on the frame. */
const itemsFor = (items: readonly ChildReclaimAttention[], id: string): ChildReclaimCollectAttention[] =>
  items.filter((a): a is ChildReclaimCollectAttention => a.kind === 'collect' && a.sessionId === id);
/** ccd's exit-1 `unmeasured` document for a box-wide probe, as `_ws_collect_audit_doc` prints it. */
const boxProbe = (f: CollectRig, id: string, probe: string): CcdAnswer => ({ code: 1, stdout: JSON.stringify({
  session: id, mode: 'collect', exists: true,
  collect: { leaf: path.join(f.home, '.cc-tmp', id), records: [], unmeasured: probe, witness: null },
  verdict: 'unmeasured', detail: `${probe} is not usable on this box` }) });

describe('a collected act whose id was forgotten mid-flight still writes its row (spec §5.10)', () => {
  it('the gather that forgets the id lands while ws-collect is out: the collected row is written, from the job’s own observation 2, and no entry comes back', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();            // demo-a: observation 1
    const act = f.hold('collect', 'demo-a');
    f.next(); await f.pass();                               // the act job: its own audit, then ws-collect, held
    await vi.waitFor(() => expect(act.reached()).toBe(true));
    f.unwitness('demo-a');                                  // the collection's last step: nothing names demo-a now
    f.next(); await f.pass();                               // a gather lands before the act's answer is folded
    expect(f.lane().entries.has('demo-a'), 'forgotten while its act was out').toBe(false);
    act.release(); await f.settled();
    const rows = f.coord.feedEvents(500).filter((e) => e.title === COLLECT_FEED_TITLE.collected);
    expect(rows.map((e) => e.sessionId), 'the deletion the server made is recorded').toEqual(['demo-a']);
    expect(rows[0]!.runId, 'the witness’s run, from observation 2').toBe(f.mintingRun);
    expect(rows[0]!.body).toBe(collectFeedCollectedBody('demo-a', f.mintingRun, path.join(f.home, '.cc-tmp', 'demo-a'),
      { kind: 'collected', record: 'demo-a.1790000000000000000.4242', resumed: false, witness: 'dropped' }));
    expect(f.lane().entries.has('demo-a'), 'the row re-created no memory').toBe(false);
    expect(f.lane().slot, 'and the act freed the slot').toEqual({ kind: 'free' });
  });
});

describe('a box-wide line never outlives the ids behind it (spec §5.10)', () => {
  const twoSilent = async (): Promise<CollectRig> => {
    const f = await collectRig();
    for (const id of ['demo-a', 'demo-b']) {
      f.witness(id);
      f.scripts.set(id, (verb) => (verb === 'audit' ? f.answers.noDocument() : undefined));
    }
    await f.pass(); await f.settled();                      // two learning audits, one pass, neither printed anything
    expect(await boxWords(f)).toContain('no-document');
    return f;
  };

  it('two ids answer no document, then both leave the measured listing: the line is gone within one pass', async () => {
    const f = await twoSilent();
    f.unwitness('demo-a'); f.unwitness('demo-b');
    f.next(); await f.pass(); await f.settled();            // a pass that queues nothing
    expect(f.audits(), 'no call was queued that could publish a tally').toHaveLength(2);
    expect(await boxWords(f)).not.toContain('no-document');
  });

  it('the same ids still listed but waiting their pace: the line stands', async () => {
    const f = await twoSilent();
    f.next(); await f.pass(); await f.settled();            // both paced past this pass: nothing is queued
    expect(f.audits(), 'neither was asked again this pass').toHaveLength(2);
    expect(await boxWords(f)).toContain('no-document');
  });

  it('a box-probe line stands while a listing is unmeasured, and clears once the measured population holds no ids', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    f.scripts.set('demo-a', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-a', 'flock') : undefined));
    await f.pass(); await f.settled();
    expect(await boxWords(f)).toContain('box-probe');
    f.breakTmproots();                                      // demo-a's witness is gone, but its listing is unmeasured
    f.next(); await f.pass(); await f.settled();
    expect(await boxWords(f), 'an unmeasured listing changes nothing').toContain('box-probe');
    rmSync(path.join(f.reg, 'tmproots'), { force: true });  // the listing measured again, and empty
    mkdirSync(path.join(f.reg, 'tmproots'));
    f.next(); await f.pass(); await f.settled();
    expect(await boxWords(f), 'no id left to answer it: cleared').not.toContain('box-probe');
  });
});

describe('an id whose registry row stands again projects no item, and keeps its memory (spec §5.10)', () => {
  it('a would-collect item goes while <id>.uuid is listed, and returns as it stood once the row goes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();
    f.next(); await f.pass(); await f.settled();            // shadow: demo-a would be collected
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
    expect(itemsFor(await f.attention(), 'demo-a').map((a) => a.word)).toEqual(['would-collect']);
    const kept = f.lane().entries.get('demo-a');
    f.next(); await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    expect(itemsFor(await f.attention(), 'demo-a'), 'a reused slug’s live workspace wears no collector item').toEqual([]);
    expect(f.lane().entries.get('demo-a'), 'its pacing memory is kept, untouched').toBe(kept);
    f.next(); await f.pass(); await f.settled();
    expect(itemsFor(await f.attention(), 'demo-a').map((a) => a.word), 'the row went: the item returns').toEqual(['would-collect']);
  });

  it('while tmpquarantine cannot be read the registered id’s item stands, with the tmpquarantine line beside it; once it reads again the item is hidden again', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();
    f.next(); await f.pass(); await f.settled();            // shadow: demo-a would be collected
    f.next(); await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    expect(itemsFor(await f.attention(), 'demo-a'), 'the row stands and the record listing is measured: hidden').toEqual([]);
    f.breakQuarantine();                                    // tmpquarantine is now a link: no record can be read from it
    f.next(); await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    const blind = await f.attention();
    expect(itemsFor(blind, 'demo-a').map((a) => a.word), 'a record it cannot see is not a record it can rule out').toEqual(['would-collect']);
    expect(f.boxWide(blind).map((a) => a.word), 'and the doubt is said').toContain('tmpquarantine');
    f.mendQuarantine();                                     // measured again, with no record
    f.next(); await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    const mended = await f.attention();
    expect(itemsFor(mended, 'demo-a'), 'a measured listing that names no record hides it again').toEqual([]);
    expect(f.boxWide(mended).map((a) => a.word)).not.toContain('tmpquarantine');
  });

  it('a listing in doubt hides nothing: with tmproots unmeasured, a would-collect item still stands', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();
    f.next(); await f.pass(); await f.settled();            // shadow: demo-a would be collected
    expect(itemsFor(await f.attention(), 'demo-a').map((a) => a.word)).toEqual(['would-collect']);
    f.breakTmproots();                                      // the listing that names demo-a is now unmeasured
    f.next(); await f.pass(); await f.settled();
    const items = await f.attention();
    expect(f.boxWide(items).map((a) => a.word), 'the doubt is said').toContain('tmproots');
    expect(itemsFor(items, 'demo-a').map((a) => a.word), 'and the item is not hidden by it').toEqual(['would-collect']);
  });
});
