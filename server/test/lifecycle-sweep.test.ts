// The sweep rides the EXISTING tick. Two properties, and the second is the one
// a reviewer cannot hold in place: no new timer, and `sweepMail` untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetWatcher, LC_SWEEP_MS } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  LC_ACT_UNKNOWN, LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LIFECYCLE_ACTS,
} from '../../shared/api.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const G1 = '1755780000000000000';
const NOW = 1_785_300_000_000;

// `mail-sweep.test.ts:239-245`'s shipped idiom, verbatim: only `Date` is faked,
// so `fs` and the microtask queue behave. A `vi.setSystemTime` with no
// `useFakeTimers` throws `Timers are not mocked`.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

const rig = () => {
  const home = mkTmp('ccrc-lcsweep-');
  const deps = testDeps(home);
  const dir = path.join(deps.cfg.registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher(
    { ...deps, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never,
    new Bus(),
  );
  return { w, dir, coord };
};

const aLine = (uid: string): string =>
  `${JSON.stringify({ uid, at: 1, act: AN_ACT, outcome: 'done', id: 'demo' })}\n`;

describe('FleetWatcher.sweepLifecycle', () => {
  it('ingests the journal on the existing tick', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
  });

  it('is GATED — a second call inside LC_SWEEP_MS does no io', async () => {
    const r = rig();
    await r.w.sweepLifecycle();                       // the FIRST sweep always runs
    fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }), 'the gate did not hold').toEqual([]);
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
  });

  // FIX ROUND 1, F8 (task-36-37 review, STANDING RULE 1): this used to be one
  // `it` asserting both claims with hard `expect`s — if the `'ok'` claim ever
  // failed, the coord-absent `null` claim was never measured at all. Split so
  // each has its own failure surface.
  it('answers a health block once it has swept', async () => {
    const r = rig();
    await r.w.sweepLifecycle();
    expect(r.w.lifecycleHealth()?.state).toBe('ok');
  });

  it('answers null with no coordination database', () => {
    const bare = new FleetWatcher(testDeps(mkTmp('ccrc-lcsweep-')), new Bus());
    expect(bare.lifecycleHealth()).toBeNull();
  });

  it('builds the mirror ONCE — its in-memory record must survive the tick', async () => {
    // A mirror re-minted per tick forgets everything it holds between sweeps:
    // the recorded-once gap names first of all, so a standing condition would
    // produce a gap row every five seconds forever.
    const r = rig();
    fs.writeFileSync(path.join(r.dir, `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`), aLine('x.1'));
    await r.w.sweepLifecycle();
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleGaps(10), 'the mirror was re-minted between ticks').toHaveLength(1);
  });
});

describe('the tick itself', () => {
  const src = fs.readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');

  it('adds NO new timer — the sweep rides the tick that already exists', () => {
    // `start()` is the one place a timer is created in this class (`:484`). A
    // second setInterval/setTimeout would be a second clock nothing stops on
    // close. FIX ROUND 1, F8: two independent claims, softened (lower stakes
    // than the health split above — neither dereferences the other's result —
    // but both should get to report rather than the first hiding the second).
    expect.soft(src.match(/setInterval\(/g) ?? []).toHaveLength(1);
    expect.soft(src).not.toContain('lifecycleTimer');
  });

  it('dispatches the sweep from tick(), never awaited', () => {
    expect(src).toContain('void this.sweepLifecycle().catch(');
  });

  // FIX ROUND 1, F7 (task-36-37 review): renamed from "leaves sweepMail
  // byte-identical" — this body proves sweepMail has not SHRUNK and carries
  // no lifecycle vocabulary, which is a parity SIGNAL a reviewer can act on,
  // NOT a byte-identity proof; a wholesale rewrite that happened to avoid
  // both words would still pass here. Actual byte-identity against the
  // pre-wave commit is a `diff` a human/reviewer runs against git history —
  // not reproducible inside a hermetic suite without embedding a specific
  // commit SHA — and was confirmed that way in review (`sweepMail`
  // unchanged against `05033c5`). This test is the parity SIGNAL, named for
  // exactly that.
  it('sweepMail has not shrunk, and takes NO dependency on the lifecycle subsystem — a parity SIGNAL, not a proof of byte-identity', () => {
    // The most load-bearing loop on the box. Wave 4 adds a producer beside it,
    // never inside it. The slice ends on the method's OWN closing brace —
    // `\n  }\n` at two-space indent — rather than on the next member, so it
    // cannot silently widen to four hundred unrelated lines.
    //
    // NARROWED 2026-08-30, D-309's refinement, and the narrowing is the point
    // rather than a concession. This assertion used to read
    // `not.toContain('lifecycle')` — broader than the rule it was defending.
    // Its own comment states that rule: wave 4 must add a PRODUCER beside this
    // loop, never inside it. What the mail sweep must not grow is a dependency
    // on the lifecycle SUBSYSTEM — the mirror, the sweep, the health readout,
    // a second clock — because that is a whole moving part behind the box's
    // busiest loop.
    //
    // Reading one PURE FUNCTION over a record this loop has already read is not
    // that, and the ladder now needs it: `tmux-gone` had to learn to tell a
    // pane that is coming back from one that is not, and `sessionLifecycle` is
    // where that distinction is already drawn. No new I/O, no new timer, no
    // call into the sweep next door.
    //
    // So the allow-list below is EXPLICIT and short. A new lifecycle reference
    // that is not one of these three reds this test, which is a stricter
    // statement of the same rule than the blanket substring ever was — that one
    // could only say "none", and had no way to say "these, and nothing else".
    const from = src.indexOf('  async sweepMail(');
    expect(from, 'sweepMail was not found — this assertion would pass vacuously').toBeGreaterThan(-1);
    const to = src.indexOf('\n  }\n', from);
    expect(to, 'sweepMail has no two-space closing brace').toBeGreaterThan(from);
    const body = src.slice(from, to);
    expect.soft(body.length).toBeGreaterThan(2000);

    // The producer and its neighbours stay out, by name.
    for (const banned of ['sweepLifecycle', 'lifecycleHealth', 'JournalMirror', 'lastLifecycleSweep']) {
      expect.soft(body, `sweepMail reached into the lifecycle subsystem: ${banned}`).not.toContain(banned);
    }

    // …and every remaining mention of the word is one of the three permitted
    // pure reads. Comments are stripped first: the paragraph explaining WHY
    // this rung reads a lifecycle must not itself trip the scan.
    //
    // LINE COMMENTS GO FIRST, AND THE ORDER IS THE WHOLE FIX. Written the other
    // way round — block comments, then line comments — this scan was VACUOUS,
    // measured: `sweepMail` ends with a shipped `/** TELL THE SENDER … */` doc
    // comment, so a single ordinary `//` line anywhere above it containing the
    // two characters `/*` (this codebase's house style is full of them —
    // `~/.cc-sessions/*`, `shared/*.ts`) opened a non-greedy block match that
    // closed on that doc comment and deleted 94% of the body. The census then
    // saw an empty haystack, reported `unexpected: []`, and a genuinely
    // forbidden reference on the next line went unnoticed while the suite
    // stayed green. Stripping `//`-to-end-of-line first takes the stray `/*`
    // with it, so no block match can open.
    const code = body.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const ALLOWED = ['sessionLifecycle(', 'lifecycleIsDead(', 'lifecycleInputFor('];
    const mentions = [...code.matchAll(/[A-Za-z_$]*[Ll]ifecycle[A-Za-z_$]*\s*\(?/g)].map((m) => m[0].trim());

    // THE CANARY, and it is the mechanism rather than the ordering above. Any
    // future way of blinding the strip — a `/*` inside a string literal, an
    // `http://` on a line with a real reference, a tokenizer bug — makes the
    // haystack shrink, and a scan that finds NOTHING must never be read as a
    // scan that found nothing WRONG. The three permitted reads are known to be
    // in this method; if the census cannot see them, it cannot see anything.
    expect.soft(mentions.length,
      'the lifecycle census found none of the three reads it knows are there — the comment strip has ' +
      'blinded it, and `unexpected: []` below would be vacuous rather than clean')
      .toBeGreaterThanOrEqual(ALLOWED.length);

    const unexpected = mentions.filter((m) => !ALLOWED.some((a) => m.startsWith(a.slice(0, -1))));
    expect.soft(unexpected,
      'a lifecycle reference in sweepMail that is not one of the three permitted pure reads')
      .toEqual([]);
  });
});
