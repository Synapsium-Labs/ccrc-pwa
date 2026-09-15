// The serviceability clause in bash, driven over the SAME table as the L0
// function (`fixtures/serviceability.ts`), plus the three things only a
// two-language pin can hold: the twinned constants, the ladder, and the
// rounding at .5.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { SERVICEABILITY_CASES } from './fixtures/serviceability.js';
import { CLASSES } from '../../shared/models.js';
import {
  FABLE_SHARE_CEILING_PCT, SEVEN_DAY_CEILING_PCT, SHARE_FRESH_S, classBelow, serviceability,
} from '../../shared/serviceability.js';
import { readLimits, sevenOf } from '../src/limits.js';
import { readSharesMeasured, shareFor } from '../src/shares.js';
import { localIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { seedRoster } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ccdSrc = fs.readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
const bashConst = (name: string): number => {
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(ccdSrc);
  if (!m) throw new Error(`ccd/ccd declares no ${name}= — the twin moved or was renamed`);
  return Number(m[1]);
};

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-serviceable-'); seedAccountsSh(h.home); seedRoster(h.home); });
afterEach(() => { h.cleanup(); });

const now = (): number => Math.floor(Date.now() / 1000);
// `t0` is sampled ONCE per case, by the caller, and threaded through every
// clock read for that case — the seed file, and both L0 `now` arguments —
// rather than each site resampling its own fresh `now()`. The bash arm still
// samples wall time independently (`_share_pct`'s python re-reads
// `time.time()` after a real subprocess spawn), so a shared t0 alone does not
// bound that arm; `alignToSecondBoundary` below does, by giving the whole
// spawn path a wide margin before the next whole-second tick.
const seedCase = (c: (typeof SERVICEABILITY_CASES)[number], t0: number): void => {
  const lim = path.join(h.home, '.cc-limits'); fs.mkdirSync(lim, { recursive: true });
  for (const f of fs.readdirSync(lim)) fs.rmSync(path.join(lim, f));
  if (c.limits) fs.writeFileSync(path.join(lim, `${c.lane}.json`), c.limits(t0));
  const sw = path.join(h.home, '.cc-sessions', 'usage', 'sweep'); fs.rmSync(sw, { recursive: true, force: true });
  if (c.sweep) {
    fs.mkdirSync(sw, { recursive: true });
    const finishedAt = new Date((t0 - c.sweep.ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const perAccount = 'estimate' in c.sweep ? { [c.lane]: { fableShare: { estimate: c.sweep.estimate } } } : {};
    fs.writeFileSync(path.join(sw, 'latest.json'), JSON.stringify({ finishedAt, perAccount }));
  }
};
// Review finding #1: the "exactly SHARE_FRESH_S is still fresh" row is on a
// whole-second-boundary edge, so a wall clock that ticks over between seeding
// and either arm's freshness sample flips it to stale in BOTH languages, with
// no load involved — pure clock phase. Sourcing `ccd/ccd` in a fixture HOME
// plus a python3 spawn plus fs writes measures ~50-60ms idle, so aligning to
// just past a boundary before sampling t0 buys ~800ms of headroom against
// that path — deterministic rather than probabilistic.
const alignToSecondBoundary = async (): Promise<void> => {
  while (Date.now() % 1000 >= 200) await new Promise((r) => setTimeout(r, 5));
};
const RC: Record<string, number> = { servable: 0, unservable: 1, unmeasured: 2, skipped: 3 };

describe('the twinned constants and the ladder', () => {
  it('FABLE_SHARE_CEILING_PCT, SHARE_FRESH_S are spelled equal in both languages; SEVEN_DAY_CEILING_PCT is ccd\'s SWAP_CEILING', () => {
    expect(bashConst('FABLE_SHARE_CEILING_PCT')).toBe(FABLE_SHARE_CEILING_PCT);
    expect(bashConst('SHARE_FRESH_S')).toBe(SHARE_FRESH_S);
    expect(bashConst('SWAP_CEILING')).toBe(SEVEN_DAY_CEILING_PCT);
  });
  it('_class_below walks ROUTE_CLASSES to the same answers classBelow walks CLASSES to', () => {
    for (const c of CLASSES) {
      expect(h.sh(`_class_below ${c}`)).toBe(classBelow(c) ?? '');
    }
    expect(h.sh('_class_below default')).toBe('');
    // THE EMPTY WORD, and it is NOT the same shape as `default` (controller
    // ruling S3-R2): the bash loop seeds `prev=""` and matches on the first
    // word, so before its guard `_class_below ""` printed the TOP rung — a
    // fabricated class where the honest answer is "there is no rung". The L0
    // twin is typed (`ModelClass`) and cannot be asked this, so the pin has to
    // live on the bash side alone.
    expect(h.sh("_class_below ''")).toBe('');
  });
});

describe('_serviceable over SERVICEABILITY_CASES — four exit codes, and the L0 function agrees row by row', () => {
  it('guards the guard: the table covers every answer and both why-words of each', () => {
    expect(SERVICEABILITY_CASES.length).toBeGreaterThanOrEqual(14);
    for (const e of ['skipped', 'servable', 'unservable', 'unmeasured']) expect(SERVICEABILITY_CASES.some((c) => c.expect === e), e).toBe(true);
    for (const w of ['ceiling', 'backend', 'no-figure', 'stale']) expect(SERVICEABILITY_CASES.some((c) => c.why === w), w).toBe(true);
  });

  it.each(SERVICEABILITY_CASES.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    await alignToSecondBoundary();
    const t0 = now();
    seedCase(c, t0);
    // `|rc=` (not a leading space) as the delimiter: `h.sh` trims the whole
    // captured string, and the `skipped` case is the one row where
    // `_serviceable` prints NOTHING before it — a space-only prefix would sit
    // at the string's own boundary and vanish under that trim, losing the
    // token the split depends on.
    const out = h.sh(`_serviceable ${c.lane} ${c.cls}; echo "|rc=$?"`);
    const [word, rcTok] = out.split('|rc=');
    expect(Number(rcTok)).toBe(RC[c.expect]);
    if (c.expect === 'servable' || (c.expect === 'unservable' && c.why === 'ceiling')) expect(Number(word)).toBe(c.figurePct);
    if (c.why === 'backend' || c.expect === 'unmeasured') expect(word).toBe(c.why);
    // the L0 side over the SAME bytes, and the SAME instant t0 the seed used —
    // never a freshly resampled `now()`, which would let this arm disagree
    // with the seed (and with the bash arm above) about what "now" was.
    const cfg = loadConfig({ CCRC_HOME: h.home });
    const limits = await readLimits(localIO, cfg, t0);
    const shares = await readSharesMeasured(localIO, cfg.registryDir);
    const v = serviceability(c.cls, { anthropic: c.lane === 'claude', seven: sevenOf(limits[c.lane]), share: shareFor(shares, c.lane) }, t0);
    expect(v.kind).toBe(c.expect);
    if ('why' in v) expect(v.why).toBe(c.why);
    if ('figurePct' in v && c.figurePct !== undefined) expect(v.figurePct).toBe(c.figurePct);
  });
});
