// program-leverage wave 5 (F5) — the dead-proof guard. TDD red-first: this file
// was written and run before `src/coord/reclaim.ts` existed, to confirm it failed
// for the right reason.
//
// What is pinned HERE is the LADDER — which input collapses into which of the
// three answers — and not the route, which is a union->status map with its own
// file. The asymmetry is why the fixtures are per-rung rather than per-answer:
// refusing a live coordinator's reclaim costs the operator a retry, while
// reclaiming a live one puts two coordinators on one program, which spec:291-292
// calls a non-goal precisely because nothing in this build arbitrates it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, reclaimRun, type ReclaimDeps } from '../src/coord/reclaim.js';
import { readSessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;            // epoch MILLISECONDS, the units the ladder takes
const SEC = Math.floor(NOW / 1000);       // …and what ccd's `date +%s` actually writes to $REG
const DEAD = 'demo-quiet-mesa';           // the coordinator being replaced
const LIVE = 'demo-brisk-fen';            // the session taking over
const PROGRAM = 'f5-demo';

const GONE: SessionVerdict = { verdict: 'gone' };
const ALIVE: SessionVerdict = { verdict: 'live' };

/** The registry row ccd writes, minus whatever a fixture wants absent. `stopped`
 *  and `supervised` are epoch SECONDS here because that is what is on disk —
 *  `lifecycleInputFor` owns the one x1000 (fleet.ts:186-198). */
const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const store = (home: string): CoordStore =>
  new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** The tmux port pinned to ONE verdict. This is what the contract's one-method
 *  port buys the tests: a fixture STATES the substrate's answer instead of
 *  scripting an exec runner into producing it — and it cannot state the
 *  `hasSession` boolean at all, because the port has no such method. */
const depsFor = (home: string, coord: CoordStore, verdict: SessionVerdict,
                 io: FleetIO = localIO): ReclaimDeps =>
  ({ coord, io, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => verdict } });

const blindIO = (): FleetIO => ({ ...localIO, readdir: async () => null });

/** Lists ONCE, then goes blind. The shape D-1144's third arm needs and no other
 *  fixture in this file can state: `readSessionRecord` opens with a listing that
 *  SUCCEEDS (so the read is `absent`, not `unlistable`), and the consumer's
 *  re-listing — the one that tells a proven absence from a half-written row —
 *  then fails. `blindIO` above cannot reach it: it fails the FIRST listing, so
 *  the ladder never leaves the `unlistable` rung. */
const listsOnceThenBlindIO = (): FleetIO => {
  let listings = 0;
  return { ...localIO, readdir: async (dir: string) => (listings++ === 0 ? localIO.readdir(dir) : null) };
};

/** A registry entry that IS listed and CANNOT be assembled — `buildRecord`'s own
 *  words for it are "a session mid-write or mid-teardown" (registry.ts:488-505).
 *  `<id>.uuid` is on disk, so `readSessionRecord`'s first rung passes it through;
 *  the identity triple is incomplete, so `buildRecord` drops the row and the read
 *  comes back `absent` — the SAME word a session that was never listed gets. This
 *  is the input D-1144 exists for: on a live fleet it is a coordinator between two
 *  `_reg_set` writes, and rung 1 used to call it dead. */
const seedHalfWritten = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${id}.uuid`), `u-${id}`);
  writeFileSync(path.join(reg, `${id}.started`), '1');
  // No `.wrapper`, no `.workdir`: two thirds of the identity triple are not there
  // yet. Nothing else about the row is malformed — that is the point of the case.
};

/** The other route to the same drop: a triple member that reads back MEASURED-EMPTY
 *  (`buildRecord`'s second null, an empty field rather than a missing one). Seeded
 *  from a COMPLETE row so the only difference from a healthy session is the zero-byte
 *  `.uuid` a half-finished write leaves behind. */
const seedEmptyIdentity = (home: string, id: string): void => {
  seedRow(home, id);
  writeFileSync(path.join(home, '.cc-sessions', `${id}.uuid`), '');
};

/** THE FIXTURE-REACHABILITY PIN, asserted before every D-1144 case rather than
 *  assumed. The arm under test is only reached when BOTH of these hold, and each
 *  is one edit away from silently ceasing to: if `<id>.uuid` stopped being listed
 *  the case would fall into the proven-absence arm and pass for the wrong reason,
 *  and if the row started assembling the read would answer `found: true` and skip
 *  rung 1 entirely. An unreachable arm asserted green is the failure mode this
 *  file's whole per-rung fixture design exists to avoid. */
const expectListedButUnassembled = async (home: string, id: string): Promise<void> => {
  expect(readdirSync(path.join(home, '.cc-sessions'))).toContain(`${id}.uuid`);
  expect(await readSessionRecord(localIO, testDeps(home).cfg, id))
    .toEqual({ found: false, reason: 'absent' });
};

describe('measureClaimant — three answers, and the inputs that collapse into each', () => {
  it('an unlistable registry is UNMEASURABLE, never dead', async () => {
    // The fail-open shape dispatch.ts:462-480 had to close, one ring up: an
    // outage must not read as a death certificate for a session it never saw.
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, DEAD);
    const v = await measureClaimant(depsFor(home, store(home), GONE, blindIO()), DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(v.why).toContain('could not be listed');
  });

  it('no row in a directory that listed cleanly is DEAD', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, LIVE);                 // somebody IS listed — the listing is real, DEAD is not in it
    const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
    expect(v.state).toBe('dead');
    expect(v.why).toContain('listed cleanly');
  });

  // D-1144 — the three cases below are one finding: `SingleRead`'s `absent` is a
  // fold of three conditions and only two of them are deaths. The case above is
  // the fold's honest member (nothing was ever listed); these are the two that
  // used to borrow its sentence — "no registry row in a directory that listed
  // cleanly" — while `<id>.uuid` was sitting right there in the listing.
  it('a row that IS listed but cannot be ASSEMBLED is UNMEASURABLE, never dead (D-1144)', async () => {
    // On a live fleet this is a coordinator mid-write, not a corpse. Answering
    // `dead` reclaims a program out from under a session that is still running
    // it — and it is the only arm of this ladder whose error PROCEEDS.
    const home = mkTmp('ccrc-reclaim-');
    seedHalfWritten(home, DEAD);
    await expectListedButUnassembled(home, DEAD);
    const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(v.why).toContain(`${DEAD}.uuid`);       // the evidence, not a category
    expect(v.why).toContain('could not be assembled');
  });

  it('a measured-EMPTY identity field reaches that same arm — the other way a listed row drops', async () => {
    // `buildRecord` has two nulls and both must land here. Pinning only the
    // half-written one would leave the empty-field route free to answer `dead`
    // again, which is the same defect with a different fixture.
    const home = mkTmp('ccrc-reclaim-');
    seedEmptyIdentity(home, DEAD);
    await expectListedButUnassembled(home, DEAD);
    const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(v.why).toContain('could not be assembled');
  });

  it('the D-1144 arm sits AHEAD of the tmux consultation — tmux is never asked', async () => {
    // PLACEMENT, pinned as an observable rather than read off the source, the
    // way rung 2's own order test above is. A split placed BELOW the tmux rung
    // still answers `unmeasurable` for this fixture and looks identical from the
    // outside — until tmux says `gone` about a pane whose registry row is merely
    // half-written, which is exactly the pair of facts a mid-write coordinator
    // presents (the pane is being restarted, the row is being rewritten). Asking
    // tmux at all here is asking a witness that cannot see the question.
    const home = mkTmp('ccrc-reclaim-');
    seedHalfWritten(home, DEAD);
    await expectListedButUnassembled(home, DEAD);
    let asked = 0;
    const deps: ReclaimDeps = {
      coord: store(home), io: localIO, cfg: testDeps(home).cfg,
      tmux: { sessionVerdict: async () => { asked += 1; return GONE; } },
    };
    const v = await measureClaimant(deps, DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(asked).toBe(0);
  });

  it('a re-listing that FAILS is UNMEASURABLE — doubt in front of a destructive act refuses', async () => {
    // The fixture is the DEAD-answering one above, id for id: DEAD is genuinely
    // not in the first listing. What changes is that the evidence separating a
    // proven absence from a half-written row is no longer obtainable, because
    // `SingleRead` threw away the first listing's own answer and the second
    // listing failed. `dead` here would be a guess, and the guess proceeds.
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, LIVE);
    const v = await measureClaimant(
      depsFor(home, store(home), GONE, listsOnceThenBlindIO()), DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(v.why).toContain('stopped listing');
    expect(v.why).not.toContain('listed cleanly');   // and it does not borrow the dead sentence
  });

  it('a live pane is ALIVE, and the lifecycle is never consulted', async () => {
    // The row carries a stop stamp, which `sessionLifecycle` reads as `stopped`
    // — a dead word. tmux outranks it: the pane is THERE. A ladder that read the
    // registry last would answer `dead` about a session an operator is typing in.
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, DEAD, { stopped: `${SEC} ccd` });
    const v = await measureClaimant(depsFor(home, store(home), ALIVE), DEAD, NOW);
    expect(v.state).toBe('alive');
    expect(v.why).toContain('tmux');
  });

  it('tmux that did not answer is UNMEASURABLE, and carries tmux\'s own words', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, DEAD);
    const detail = 'no server running on the default socket';
    const v = await measureClaimant(
      depsFor(home, store(home), { verdict: 'unknown', detail }), DEAD, NOW);
    expect(v.state).toBe('unmeasurable');
    expect(v.why).toBe(detail);          // verbatim: the message IS the diagnosis (D-309)
  });

  it('gone + a stop stamp is DEAD', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, DEAD, { stopped: `${SEC} ccd` });
    const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
    expect(v.state).toBe('dead');
    expect(v.why).toContain('stopped');
  });

  it('gone + a FRESH supervisor heartbeat is ALIVE — the arm a bare !alive folds', async () => {
    // THE ARM THIS FILE EXISTS FOR. `supervised` is stamped at NOW, so
    // `nowMs - supervisedAt*1000 === 0`: fresh, and the lifecycle is `restarting`.
    // A supervisor is bringing this session back and the reclaim must not race it.
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, DEAD, { supervised: String(SEC) });
    const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
    expect(v.state).toBe('alive');
    expect(v.why).toContain('restarting');
  });
});

const seedRun = (s: CoordStore, claimedBy: string, wave = 1): number => {
  const r = s.openRun({ program: PROGRAM, title: 'F5 demo', project: 'demo',
    wave, waveOf: 2, claimedBy });
  if ('refused' in r) throw new Error(`fixture: openRun refused (${r.refused})`);
  return r.id;
};

/** Counts the commit WITHOUT stubbing it out — the delegate still runs, so a test
 *  asserting both "never entered" and "claimedBy unchanged" is asserting two
 *  independent facts rather than one fact twice. */
const watchCommit = (s: CoordStore): { calls: number } => {
  const seen = { calls: 0 };
  const real = s.reclaimProgram.bind(s);
  s.reclaimProgram = ((runId: number, to: string, at: number) => {
    seen.calls += 1;
    return real(runId, to, at);
  }) as CoordStore['reclaimProgram'];
  return seen;
};

describe('reclaimRun — the order is the guard', () => {
  it('unknown-run for an id no row carries', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seedRow(home, LIVE);
    const r = await reclaimRun(depsFor(home, store(home), GONE), 9999, LIVE);
    expect(r).toEqual({ ok: false, kind: 'unknown-run' });
  });

  it('no-claimant for a reconstructed row whose claimedBy is NULL', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    // The shape `reconstruct` inserts and `openRun`'s D-12 clause skips: a row
    // rebuilt from ccd's flat files, which cannot know who will resume it. Ruling
    // R1 leaves these NULL, so this door must refuse rather than adopt one.
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);
    seedRow(home, LIVE);
    const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
    expect(r).toEqual({ ok: false, kind: 'no-claimant' });
  });

  it('no-claimant is measured BEFORE any registry read — an unlistable directory does not change it', async () => {
    // Rung 2's PLACEMENT, pinned as an order rather than as an answer, because
    // the answer alone cannot see it: `reclaimProgram` re-checks the same NULL
    // inside its own transaction and refuses `no-claimant` too, so against a
    // listable registry the rung can be deleted with the case above still green
    // (measured — the mutation table's row 11). What the placement changes is
    // the answer when the box cannot read its registry at all: rung 3 would
    // refuse `registry-unmeasurable` first, and a 502 saying "this box could not
    // read its registry" about a run that names nobody sends the operator to fix
    // a substrate that is not the problem.
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);
    const r = await reclaimRun(depsFor(home, s, GONE, blindIO()), id, LIVE);
    expect(r).toEqual({ ok: false, kind: 'no-claimant' });
  });

  it('unknown-session when the INCOMING coordinator has no registry row', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD);                 // the listing is real; only LIVE is missing from it
    const w = watchCommit(s);
    const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
    expect(r).toEqual({ ok: false, kind: 'unknown-session' });
    expect(w.calls).toBe(0);
    expect(s.run(id)!.claimedBy).toBe(DEAD);
  });

  it('registry-unmeasurable when the directory will not list — and NOTHING is written', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD); seedRow(home, LIVE);
    const w = watchCommit(s);
    const r = await reclaimRun(depsFor(home, s, GONE, blindIO()), id, LIVE);
    expect(r).toMatchObject({ ok: false, kind: 'registry-unmeasurable' });
    expect(w.calls).toBe(0);
    expect(s.run(id)!.claimedBy).toBe(DEAD);
    expect(s.runEvents(id)).toEqual([]);   // openRun writes no event, so [] is a real "untouched"
  });

  it('registry-unmeasurable when the CLAIMANT cannot be measured — and NOTHING is written', async () => {
    // THE ARM'S SECOND PRODUCER, and the reason it carries a `detail` at all.
    // The directory listed, so rung 3 proved the incoming coordinator is real;
    // what could not be measured is the OUTGOING one, because tmux did not
    // answer. Doubt is not evidence in either direction — a substrate fault must
    // not read as a death certificate for the session holding the program — and
    // this is the ONLY fixture that reaches the ladder's `unmeasurable` arm
    // through `reclaimRun`: `blindIO` above is caught one rung earlier, on the
    // incoming read, so without this case that refusal could be deleted with the
    // whole suite still green (measured — the mutation table's row 10).
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD); seedRow(home, LIVE);
    const w = watchCommit(s);
    const detail = 'no server running on the default socket';
    const r = await reclaimRun(depsFor(home, s, { verdict: 'unknown', detail }), id, LIVE);
    expect(r).toMatchObject({ ok: false, kind: 'registry-unmeasurable' });
    if (r.ok) throw new Error('unreachable — narrowed above');
    // Verbatim, and that is the pin: `detail` is the only thing separating this
    // producer from the unlistable-directory one above, so a summarised sentence
    // here would fold the two conditions the route is built not to collapse.
    expect(r.kind === 'registry-unmeasurable' && r.detail).toBe(detail);
    expect(w.calls).toBe(0);
    expect(s.run(id)!.claimedBy).toBe(DEAD);
  });

  it('registry-unmeasurable when the CLAIMANT is listed but unassembled — and NOTHING is written', async () => {
    // D-1144 end to end, through the door rather than through the ladder: the
    // incoming coordinator is a healthy row (so rung 3 passes), and the OUTGOING
    // one is listed with an identity triple that is still half-written. Before
    // the split this returned `ok: true` and rewrote `claimedBy` — the single
    // destructive outcome this whole file is here to keep behind a measurement.
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedHalfWritten(home, DEAD); seedRow(home, LIVE);
    await expectListedButUnassembled(home, DEAD);
    const w = watchCommit(s);
    const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
    expect(r).toMatchObject({ ok: false, kind: 'registry-unmeasurable' });
    if (r.ok) throw new Error('unreachable — narrowed above');
    expect(r.kind === 'registry-unmeasurable' && r.detail).toContain('could not be assembled');
    expect(w.calls).toBe(0);
    expect(s.run(id)!.claimedBy).toBe(DEAD);
    expect(s.runEvents(id)).toEqual([]);
  });

  it('claimant-alive when the current coordinator answers — and NOTHING is written', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD); seedRow(home, LIVE);
    const w = watchCommit(s);
    const r = await reclaimRun(depsFor(home, s, ALIVE), id, LIVE);
    expect(r).toMatchObject({ ok: false, kind: 'claimant-alive', by: DEAD });
    if (r.ok) throw new Error('unreachable — narrowed above');
    expect(r.kind === 'claimant-alive' && r.detail).toContain('tmux');
    expect(w.calls).toBe(0);
    expect(s.run(id)!.claimedBy).toBe(DEAD);
  });

  it('rewrites EVERY run of the program, terminal rows included (ruling R1)', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const w1 = seedRun(s, DEAD, 1);
    const w2 = seedRun(s, DEAD, 2);
    // Wave 1 has finished. It is the row `openRun`'s guard (store.ts:381-383) and
    // `resolveCoordinator(null)` both read FIRST — `ORDER BY id LIMIT 1`, with no
    // state predicate — so a terminal-sparing rewrite leaves both readers still
    // answering the corpse, and the wedge survives the reclaim.
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(w1);
    seedRow(home, DEAD, { stopped: `${SEC} ccd` });
    seedRow(home, LIVE);
    const r = await reclaimRun(depsFor(home, s, GONE), w2, LIVE);
    expect(r).toMatchObject({ ok: true, program: PROGRAM, from: DEAD, to: LIVE });
    if (!r.ok) throw new Error('unreachable — narrowed above');
    expect([...r.runIds].sort((a, b) => a - b)).toEqual([w1, w2]);
    expect(s.run(w1)!.claimedBy).toBe(LIVE);
    expect(s.run(w2)!.claimedBy).toBe(LIVE);
  });

  it('a `to` that is already the claimant is a no-op SUCCESS, not a refusal', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD);
    // Note the verdict: the current claimant is LIVE. Running the ladder here
    // would answer `claimant-alive` about the very session the operator named as
    // the winner — which is why the identity case short-circuits AHEAD of the
    // ladder rather than inside it.
    const r = await reclaimRun(depsFor(home, s, ALIVE), id, DEAD);
    expect(r).toMatchObject({ ok: true, runIds: [], from: DEAD, to: DEAD });
    expect(s.run(id)!.claimedBy).toBe(DEAD);
  });
});

describe('the ring pin — reclaim.ts reaches for the measuring reads, never the collapsing ones', () => {
  it('calls neither hasSession nor readRegistry', () => {
    const src = readFileSync(new URL('../src/coord/reclaim.ts', import.meta.url), 'utf8');
    expect(src.length).toBeGreaterThan(600);        // anti-vacuity: we read a real file
    expect(src).toContain('readSessionRecord(');     // …and it calls the right reads
    expect(src).toContain('sessionVerdict(');
    // A CALL, not a mention — `single-definition.test.ts:431`'s own anchoring
    // rule. Both names appear in prose above, deliberately: a forbid-mention pin
    // would forbid the argument for the ban along with the ban.
    expect(src).not.toMatch(/\bhasSession\s*\(/);
    expect(src).not.toMatch(/\breadRegistry\s*\(/);
  });
});
