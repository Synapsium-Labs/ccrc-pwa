// Child reclamation wave 9 (spec §5.10): what the collector's lane owes when an id LEAVES its population, at the lane.
// L1 decides each (`collect-leaving-l1.test.ts` pins the rules); these cases pin that the watcher applies them:
// - a `collected` act whose id was forgotten while its `ws-collect` was out still writes its feed row, worded from the
//   job's own observation-2 document: ccd drops the quarantine record as a collection's last step, so a gather can
//   land between that drop and the fold, and the operator's record of a server-made deletion is never lost;
// - a box-wide line never outlives the ids behind it: the pass-scoped `no-document` line drops once none of its ids is
//   still a candidate, and stands while they are merely paced; the box-probe line clears once the measured population
//   holds no ids, and stands while a listing is unmeasured;
// - an id whose registry row stands again projects no per-id item, and its memory is kept: the item returns once the
//   row goes;
// - an answer older than the box-wide probes' latest change says nothing of them: an act job folds its observation 2 when
//   the JOB settles, so a probe a later answer raised, or an act's own answer, is cleared by an older answer never.
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

/** The box-wide probes the lane holds now, read where they live: the frame carries them only at the child lane's publish. */
const probesOf = (f: CollectRig): ReadonlyMap<string, string> =>
  (f.watcher as unknown as { collectBoxProbes: ReadonlyMap<string, string> }).collectBoxProbes;
/** ccd's `ws-collect` refusal document: a verb answer that passes no rung. */
const refusedInUse = (): CcdAnswer => ({ code: 0, stdout: JSON.stringify({ refused: 'in-use', detail: 'd', paths: [] }) });

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

describe('an answer older than the box-wide probes’ latest change says nothing of them (spec §5.10)', () => {
  /** A live lane past its hold-off where demo-a holds observation 1; its act is composed by the next pass. */
  const live = async (): Promise<CollectRig> => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();            // observation 1 (goLive ended on a pass: the next one is throttled)
    return f;
  };
  /** Arms the job's step-5 listing to wait, from demo-a's own audit call: the next listing of the registry after it. */
  const holdStep5 = (f: CollectRig): { release: () => void }[] => {
    const held: { release: () => void }[] = [];
    f.onCall.push((c) => {
      const s = f.lane().slot;
      if (held.length === 0 && c.verb === 'audit' && c.id === 'demo-a' && s.kind === 'job') held.push(f.holdListing('demo-a'));
    });
    return held;
  };

  it('a probe raised after the act job’s observation 2 arrived outlives that answer, folded when the job settles: the line stands', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? refusedInUse() : undefined));
    const step5 = holdStep5(f);
    f.next(); await f.pass(); await f.settled();            // demo-a's job: observation 2 collectable; its step 5 waits
    expect(step5, 'the job reached its audit').toHaveLength(1);
    f.witness('demo-b');
    f.scripts.set('demo-b', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-b', 'mv') : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-b answers mv, a whole interval after observation 2
    expect([...probesOf(f).keys()], 'demo-b raised the probe').toEqual(['mv']);
    step5[0]!.release(); await f.settled();                 // demo-a's act: refused in-use, which passes no rung
    expect(f.collects('demo-a'), 'the job composed its act').toHaveLength(1);
    expect([...probesOf(f).keys()], 'observation 2 is older than the probe: it clears nothing').toEqual(['mv']);
    expect(await boxWords(f), 'the line stands on the frame').toContain('box-probe');
  });

  it('an answer that leaves the probes standing never moves the stamp: observation 2, after the probe, still clears it', async () => {
    const f = await live();
    f.witness('demo-b');
    f.scripts.set('demo-b', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-b', 'mv') : undefined));
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? refusedInUse() : undefined));
    const late = f.hold('audit', 'demo-a');                 // demo-a's job's own audit (observation 2), composed and never answered
    f.next(); await f.pass(); await f.settled();            // demo-b answers mv while observation 2 is out
    expect(late.reached(), 'observation 2 is out').toBe(true);
    expect([...probesOf(f).keys()]).toEqual(['mv']);
    f.advance(1);                                           // observation 2 arrives after the probe
    const step5 = f.holdListing('demo-a');                  // armed here, never by a pass: the job's step 5 is the next listing
    late.release();
    await f.settled();                                      // demo-a's job waits at step 5
    f.unwitness('demo-b');
    f.witness('demo-c');
    f.scripts.set('demo-c', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-c', 'rows') : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-c answers a per-id probe: the box probes are unchanged
    expect([...probesOf(f).keys()], 'rows is no box-wide probe').toEqual(['mv']);
    step5.release(); await f.settled();                     // demo-a's act: refused in-use
    expect(f.collects('demo-a')).toHaveLength(1);
    expect(probesOf(f).size, 'observation 2 arrived after the last CHANGE: it clears the probe').toBe(0);
    expect(await boxWords(f)).not.toContain('box-probe');
  });

  it('a probe raised between observation 2 and a collected act’s answer is cleared by that answer, at its own arrival', async () => {
    const f = await live();
    const act = f.hold('collect', 'demo-a');
    f.next(); await f.pass();                               // the act job: observation 2 answered, then ws-collect, held
    await vi.waitFor(() => expect(act.reached()).toBe(true));
    f.next();
    f.witness('demo-b');
    f.scripts.set('demo-b', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-b', 'mv') : undefined));
    await f.pass(); await f.settled();                      // demo-b answers mv while the act is out
    expect([...probesOf(f).keys()], 'the probe stands while the act is out').toEqual(['mv']);
    f.advance(1);
    act.release(); await f.settled();                       // ws-collect answers collected
    expect(f.coord.feedEvents(500).filter((e) => e.title === COLLECT_FEED_TITLE.collected), 'the act collected').toHaveLength(1);
    expect(probesOf(f).size, 'the collected answer passed every rung after the probe').toBe(0);
    expect(await boxWords(f)).not.toContain('box-probe');
  });

  it('a forgotten id’s collected act still clears a probe raised while it was out: the act’s answer counts for the box before its id is looked up', async () => {
    const f = await live();
    const act = f.hold('collect', 'demo-a');
    f.next(); await f.pass();                               // the act job: observation 2 answered, then ws-collect, held
    await vi.waitFor(() => expect(act.reached()).toBe(true));
    f.unwitness('demo-a');                                  // nothing names demo-a now: the next gather forgets it
    f.next();
    f.witness('demo-b');
    f.scripts.set('demo-b', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-b', 'mv') : undefined));
    await f.pass(); await f.settled();                      // demo-a is forgotten, and demo-b answers mv
    expect(f.lane().entries.has('demo-a'), 'forgotten while its act was out').toBe(false);
    expect([...probesOf(f).keys()], 'the probe stands while the act is out').toEqual(['mv']);
    f.advance(1);
    act.release(); await f.settled();                       // ws-collect answers collected, for an id the lane forgot
    expect(f.coord.feedEvents(500).filter((e) => e.title === COLLECT_FEED_TITLE.collected).map((e) => e.sessionId),
      'the forgotten id’s row is still written').toEqual(['demo-a']);
    expect(probesOf(f).size, 'the collected answer passed every rung after the probe, its id forgotten or not').toBe(0);
    expect(await boxWords(f)).not.toContain('box-probe');
  });

  it('control: an act answer that passes no rung leaves that probe standing', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? refusedInUse() : undefined));
    const act = f.hold('collect', 'demo-a');
    f.next(); await f.pass();
    await vi.waitFor(() => expect(act.reached()).toBe(true));
    f.next();
    f.witness('demo-b');
    f.scripts.set('demo-b', (verb) => (verb === 'audit' ? boxProbe(f, 'demo-b', 'mv') : undefined));
    await f.pass(); await f.settled();
    f.advance(1);
    act.release(); await f.settled();
    expect(f.collects('demo-a')).toHaveLength(1);
    expect([...probesOf(f).keys()]).toEqual(['mv']);
    expect(await boxWords(f)).toContain('box-probe');
  });
});
