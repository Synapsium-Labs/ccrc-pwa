// Child reclamation wave 9 (spec §5.10): the collector's SAFETY bounds, at the lane. At most ONE `ws-collect` in flight
// fleet-wide, and the slot's life is exact: taken when the act job is queued; freed when it settles having composed
// nothing (shadow's would-collect, presence at step 6) or when the act answers a document or a recognised pre-lock die;
// KEPT, with its id, until CHILD_RECLAIM_STALL_MS after an act that answered no document; kept for as long as a job does
// not settle, never "stops counting". No act job is offered inside the lane's first CHILD_RECLAIM_STALL_MS. A call or
// job that never settles is listed at its bound, never re-queued, and never stops a later pass. `flock-unavailable`
// latches for the process.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model, the registry a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CHILD_RECLAIM_STALL_MS, CHILD_RECLAIM_SWEEP_MS, COLLECT_AUDIT_STALL_MS } from '../src/watch.js';
import { CHILD_RECLAIM_DEFER_CEILING_MS } from '../src/childReclaimSweep.js';
import type { CollectLanePort } from '../src/coord/collectTempRoot.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

/** A LIVE lane, past its hold-off, where demo-a holds a pair ripe on the next pass and demo-b is planted to be learned on
 *  that same pass, so the next pass offers demo-a its act and demo-b ripens one pass later. */
const live = async (): Promise<CollectRig> => {
  const f = await collectRig();
  f.pastHoldOff(); await f.goLive();
  f.witness('demo-a');
  f.next(); await f.pass(); await f.settled();              // demo-a: observation 1
  f.witness('demo-b');
  return f;
};
/** The box-wide lines that name `id`. */
const linesFor = async (f: CollectRig, id: string) => f.boxWide(await f.attention()).filter((a) => a.sentence.includes(id));

describe('the slot is kept, with its id, after an act that may have acted (spec §5.10)', () => {
  it('an act answering NO DOCUMENT blocks every act, and its own id, until STALL after it was composed', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.noDocument() : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-a's act: no document. demo-b learned
    const act = f.collects('demo-a')[0];
    expect(act, 'demo-a’s act was composed').toBeDefined();
    const until = act!.mono + CHILD_RECLAIM_STALL_MS;
    expect(f.lane().slot).toEqual({ kind: 'kept', id: 'demo-a', untilMono: until });
    const from = f.calls.length;
    await f.passesUntil(() => f.collects('demo-b').length > 0);
    const inside = f.calls.slice(from).filter((c) => c.mono < until);
    expect(inside.filter((c) => c.verb === 'collect'), 'no act, on any id, inside the window').toEqual([]);
    expect(inside.filter((c) => c.id === 'demo-a'), 'demo-a is not asked at all inside it').toEqual([]);
    expect(f.collects('demo-b')[0]!.mono).toBeGreaterThanOrEqual(until);
  });

  it('after the window, the next act on that id follows two fresh observations: never a re-spend', async () => {
    const f = await live();
    f.unwitness('demo-b');
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.noDocument() : undefined));
    f.next(); await f.pass(); await f.settled();
    f.scripts.delete('demo-a');
    await f.passesUntil(() => f.collects('demo-a').length > 1, 40);
    const at = f.calls.flatMap((c, i) => (c.verb === 'collect' && c.id === 'demo-a' ? [i] : []));
    const between = f.calls.slice(at[0]! + 1, at[1]).filter((c) => c.verb === 'audit' && c.id === 'demo-a');
    expect(between.length).toBeGreaterThanOrEqual(2);
  });

  it('an act whose call rejects is read as one that may have acted: the slot and the id wait STALL', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => { if (verb === 'collect') throw new Error('link lost'); return undefined; });
    f.next(); await f.pass(); await f.settled();
    const act = f.collects('demo-a')[0];
    expect(act).toBeDefined();
    expect(f.lane().slot).toEqual({ kind: 'kept', id: 'demo-a', untilMono: act!.mono + CHILD_RECLAIM_STALL_MS });
  });

  it('an act job that itself rejects may have acted: the slot and its id are kept STALL after it SETTLED, then another id’s act follows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await live();
    // demo-a's job reads presence at its step 3, and that read itself throws, once: the executor does not catch it, so
    // the job REJECTS (no outcome) rather than answering one.
    let thrown = false;
    f.setVisible((id) => {
      if (id === 'demo-a' && !thrown) { thrown = true; throw new Error('presence gone'); }
      return false;
    });
    f.next(); await f.pass(); await f.settled();            // demo-a's job rejects before any call. demo-b learned
    expect(thrown, 'demo-a’s job reached its presence read').toBe(true);
    expect(f.collects('demo-a'), 'it composed nothing').toEqual([]);
    const until = f.mono() + CHILD_RECLAIM_STALL_MS;        // the rig's clocks stand still while a pass's calls settle
    expect(f.lane().slot, 'kept, never left as a job nothing will settle').toEqual({ kind: 'kept', id: 'demo-a', untilMono: until });
    expect(warn.mock.calls.some(([m]) => String(m).includes("the collector's job for demo-a threw (presence gone)")))
      .toBe(true);
    const from = f.calls.length;
    await f.passesUntil(() => f.collects('demo-b').length > 0);
    expect(f.calls.slice(from).filter((c) => c.verb === 'collect' && c.mono < until), 'no act inside the window').toEqual([]);
    expect(f.collects('demo-b')[0]!.mono).toBeGreaterThanOrEqual(until);
  });
});

describe('the slot is freed by everything else (spec §5.10)', () => {
  it('an arm-1 lock-unopenable answer acted nothing: the next pass composes another id’s act', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.lockUnopenable('demo-a') : undefined));
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-a')).toHaveLength(1);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-b')).toHaveLength(1);
  });

  it('a presence that appears at step 6 composes nothing and frees the slot: the next pass composes another id’s act', async () => {
    const f = await live();
    let looked = false;                                     // step 3 reads nobody; step 6, after the job's audit, reads someone
    f.setVisible((id) => id === 'demo-a' && looked);
    f.onCall.push((c) => {
      const s = f.lane().slot;
      if (c.verb === 'audit' && c.id === 'demo-a' && s.kind === 'job') looked = true;
    });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-a')).toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-b')).toHaveLength(1);
  });

  it('an open-run hold composes nothing, frees the slot and CLEARS THE PAIR: once it releases, the act follows two observations composed after it, a ceiling later', async () => {
    const f = await live();
    const program = 'w9-collect-held';
    const r = f.coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    f.coord.bindSession(r.id, 'demo-a');                    // an open run names demo-a: the hold's (d)
    f.next(); await f.pass(); await f.settled();            // demo-a's act job: held at step 4
    expect(f.collects('demo-a')).toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'free' });
    expect(f.lane().entries.get('demo-a')?.obs ?? null, 'the hold cleared the pair').toBeNull();
    const heldAt = f.calls.length;
    const heldMono = f.mono();
    const c = f.coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`closeRun refused: ${JSON.stringify(c)}`);
    await f.passesUntil(() => f.collects('demo-a').length > 0, 40);
    const fresh = f.calls.slice(heldAt).filter((x) => x.verb === 'audit' && x.id === 'demo-a');
    expect(fresh.length, 'two observations composed after the hold').toBeGreaterThanOrEqual(2);
    expect(f.collects('demo-a')[0]!.mono - heldMono, 'the held id waited the ceiling').toBeGreaterThanOrEqual(CHILD_RECLAIM_DEFER_CEILING_MS);
  });

  it('two ids each get a would-collect on consecutive shadow passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();
    f.witness('demo-b');
    f.next(); await f.pass(); await f.settled();            // demo-a: would-collect. demo-b learned
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
    f.next(); await f.pass(); await f.settled();
    expect(f.wouldCollects('demo-b')).toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });
});

describe('the start hold-off (spec §5.10)', () => {
  it('a lane composes no act inside CHILD_RECLAIM_STALL_MS of its start — no act job runs at all', async () => {
    const f = await collectRig({ armed: true });
    f.witness('demo-a');
    for (; f.mono() - f.startMono < CHILD_RECLAIM_STALL_MS; f.next()) { await f.pass(); await f.settled(); }
    expect(f.lane().lastSeenLive, 'no act job ran: none saw the marker').toBe(false);
    expect(f.collects()).toEqual([]);
    expect(f.audits('demo-a'), 'it learned meanwhile, once').toHaveLength(1);
    await f.pass(); await f.settled();                      // the first pass past the hold-off
    expect(f.lane().lastSeenLive, 'the first act job runs now').toBe(true);
  });

  it('exactly CHILD_RECLAIM_STALL_MS after its start, the act is offered', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass(); await f.settled();                      // at the start: observation 1
    f.advance(CHILD_RECLAIM_STALL_MS);
    await f.pass(); await f.settled();
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
  });
});

describe('a call or job that never settles (spec §5.10: local mode’s runner has no timeout)', () => {
  it('a learning audit is listed at twice the audit row, not before, and is never queued again', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    f.hold('audit', 'demo-a');                              // never released
    await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(1));
    const queued = f.mono();
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < COLLECT_AUDIT_STALL_MS) { f.next(); await f.pass(); }
    expect(await linesFor(f, 'demo-a'), 'not before its bound').toEqual([]);
    f.next(); await f.pass();
    expect(f.mono() - queued).toBeGreaterThanOrEqual(COLLECT_AUDIT_STALL_MS);
    expect(await linesFor(f, 'demo-a')).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) { f.next(); await f.pass(); }
    expect(f.audits('demo-a'), 'never queued again while it stands').toHaveLength(1);
  });

  it('an executor audit that never settles raises the line at COLLECT_AUDIT_STALL_MS while later passes still compose learning audits for other ids, and at STALL says the act slot is held', async () => {
    const f = await live();
    f.hold('audit', 'demo-a');                              // the NEXT audit of demo-a: its act job's own, never answered
    f.next(); await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(2));
    const queued = f.mono();
    expect(f.lane().slot).toEqual({ kind: 'job', id: 'demo-a', sinceMono: queued });
    f.witness('demo-c');
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < COLLECT_AUDIT_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(await linesFor(f, 'demo-a'), 'not before its bound').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line, 'listed at the audit’s bound, not the act’s').toHaveLength(1);
    expect(line[0]!.sentence, 'an audit, not a held slot').not.toMatch(/act slot is held/);
    expect(f.audits('demo-c').length, 'later passes still learn other ids').toBeGreaterThanOrEqual(1);
    expect(f.collects()).toEqual([]);
    while (f.mono() - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    const atStall = await linesFor(f, 'demo-a');
    expect(atStall, 'still one line, now at the job’s own bound').toHaveLength(1);
    expect(atStall[0]!.sentence, 'its audit still out at STALL: the act slot is held').toMatch(/act slot is held/);
  });

  it('an act job keeps the slot past STALL — it never stops counting — is listed as holding it, and later passes still learn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await live();
    f.hold('collect', 'demo-a');                            // demo-a's ws-collect never answers
    f.next();
    await f.pass();
    await vi.waitFor(() => expect(f.collects('demo-a')).toHaveLength(1));
    const queued = f.mono();
    f.witness('demo-c');
    while (f.mono() - queued < CHILD_RECLAIM_STALL_MS + 2 * CHILD_RECLAIM_SWEEP_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects('demo-b'), 'the slot was never freed by time').toEqual([]);
    expect(f.lane().slot).toEqual({ kind: 'job', id: 'demo-a', sinceMono: queued });
    const line = await linesFor(f, 'demo-a');
    expect(line).toHaveLength(1);
    expect(line[0]!.sentence, 'its act is out: the act slot is held').toMatch(/act slot is held/);
    expect(f.audits('demo-c').length, 'later passes still learn other ids').toBeGreaterThanOrEqual(1);
    // Counted, not merely found: several passes find it past its bound, and it is logged ONCE.
    const logged = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("the collector's call for demo-a has not settled"));
    expect(logged, 'logged once, as its ws-collect call').toHaveLength(1);
    expect(logged[0], 'the act slot stays taken').toContain('the act slot stays taken');
  });

  it('an executor job queued behind a never-settling job on its key raises the slot-held line at STALL', async () => {
    const f = await live();
    f.occupy('demo-a');                                     // another lane's job on demo-a's key, never released
    f.next(); await f.pass(); await f.settled();
    const s = f.lane().slot;
    expect(s, 'the act job took the slot as it was queued').toMatchObject({ kind: 'job', id: 'demo-a' });
    const queued = s.kind === 'job' ? s.sinceMono : Number.NaN;
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(await linesFor(f, 'demo-a'), 'not before STALL').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line, 'a job that composed nothing is listed too').toHaveLength(1);
    expect(line[0]!.sentence).toMatch(/act slot is held/);
    expect(f.audits('demo-a'), 'the job composed nothing: only observation 1').toHaveLength(1);
  });

  it('a job whose own audit answered, waiting between its calls, is no unsettled audit: it is listed at STALL, holding the slot', async () => {
    const f = await live();
    const step5: { release: () => void }[] = [];            // the job's step-5 listing, held once its own audit is composed
    f.onCall.push((c) => {
      const s = f.lane().slot;
      if (step5.length === 0 && c.verb === 'audit' && c.id === 'demo-a' && s.kind === 'job') step5.push(f.holdListing('demo-a'));
    });
    f.next(); await f.pass(); await f.settled();            // demo-a's job: its audit answered; its step 5 waits
    expect(f.audits('demo-a')).toHaveLength(2);
    const s = f.lane().slot;
    expect(s).toMatchObject({ kind: 'job', id: 'demo-a' });
    expect(f.lane().inFlight.get('demo-a')?.phase, 'back to queued once its audit answered').toBe('queued');
    const queued = s.kind === 'job' ? s.sinceMono : Number.NaN;
    while (f.mono() + CHILD_RECLAIM_SWEEP_MS + 1 - queued < CHILD_RECLAIM_STALL_MS) { f.next(); await f.pass(); await f.settled(); }
    expect(f.mono() - queued).toBeGreaterThanOrEqual(COLLECT_AUDIT_STALL_MS);
    expect(await linesFor(f, 'demo-a'), 'its audit answered: no unsettled audit, and not yet STALL').toEqual([]);
    f.next(); await f.pass(); await f.settled();
    const line = await linesFor(f, 'demo-a');
    expect(line).toHaveLength(1);
    expect(line[0]!.sentence).toMatch(/act slot is held/);
  });
});

describe('flock-unavailable latches for the process (spec §5.10)', () => {
  it('no act job after it; learning goes on; a box-wide line says so', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.flockUnavailable() : undefined));
    f.next(); await f.pass(); await f.settled();            // demo-a's act: the die. demo-b learned
    expect(f.lane().flockLatched).toBe(true);
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects().map((c) => c.id), 'nothing composed after it').toEqual(['demo-a']);
    f.witness('demo-c');
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-c'), 'learning is not latched').toHaveLength(1);
    expect(f.boxWide(await f.attention()).some((a) => /flock/.test(a.sentence))).toBe(true);
  });
});

describe('a fold that throws never wedges an id or the slot (spec §5.10)', () => {
  it('a learning audit whose fold throws is logged, and its flight still settles: the id is asked again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await collectRig();
    vi.spyOn(f.watcher as unknown as { collectFoldAudit: () => unknown }, 'collectFoldAudit')
      .mockImplementationOnce(() => { throw new Error('fold broke'); });
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(warn.mock.calls.some(([m]) => String(m).includes('folding the learning audit for demo-a failed (fold broke)')))
      .toBe(true);
    expect(f.lane().inFlight.has('demo-a'), 'its flight settled').toBe(false);
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'never wedged: asked again').toHaveLength(2);
  });

  it('an act job whose fold throws is logged, its flight still settles and its lane effects stand: the next pass composes another id’s act', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await live();
    vi.spyOn(f.watcher as unknown as { collectFoldJob: () => unknown }, 'collectFoldJob')
      .mockImplementationOnce(() => { throw new Error('fold broke'); });
    f.next(); await f.pass(); await f.settled();            // demo-a's act: collected, then its fold throws. demo-b learned
    expect(f.collects('demo-a')).toHaveLength(1);
    expect(warn.mock.calls.some(([m]) => String(m).includes("folding the collector's job for demo-a failed (fold broke)")))
      .toBe(true);
    expect(f.lane().inFlight.has('demo-a'), 'its flight settled').toBe(false);
    expect(f.lane().slot, 'the slot was freed before the fold').toEqual({ kind: 'free' });
    f.next(); await f.pass(); await f.settled();
    expect(f.collects('demo-b')).toHaveLength(1);
  });

  it('a learning audit that itself rejects is folded as an audit with no document: the failing run moves, and nothing was composed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await collectRig();
    // The lane's port for demo-a's learning audit fails on its first read, before the runner: `learnCollect` rejects.
    const port: CollectLanePort = {
      clock: () => ({ mono: f.mono(), wall: f.now() }),
      generations: () => { throw new Error('port gone'); },
      observation: () => null, cleared: () => {}, flipped: () => false,
    };
    vi.spyOn(f.watcher as unknown as { collectPortFor: () => CollectLanePort }, 'collectPortFor').mockImplementationOnce(() => port);
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'nothing reached ccd').toEqual([]);
    expect(f.lane().inFlight.has('demo-a'), 'its flight settled').toBe(false);
    expect(f.lane().entries.get('demo-a')?.failing, 'paced as a failure, never dropped')
      .toMatchObject({ kind: 'run', run: 1, word: 'no-document' });
  });
});
