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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, reclaimRun, type ReclaimDeps } from '../src/coord/reclaim.js';
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
