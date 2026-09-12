// D-2012: ctxPct must not survive a tick whose captured pane carried no `▓
// ctx` segment, even while the rest of the statusline (model/branch/effort)
// is retained. `watch.ts`'s `detectDialogs` is the one place that decides
// what a tick's parse overwrites versus keeps — this file drives it through
// `tick()` (the only public entry point that populates `this.statuslines`)
// and reads the result back off `currentStatuslines()`, the same idiom
// `name-sweep.test.ts` already uses for the identical reason (a sweep alone
// would leave the map empty and prove nothing about the merge).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-ctx-pressure';
const UUID = 'c'.repeat(36);
const WORKDIR = '/w/demo/ctx-pressure';

/** Registry row for a live workspace — same shape `name-sweep.test.ts` seeds,
 *  minimal fields `readRegistry` needs to keep the row (registry.ts:124). */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'ctx-pressure', branch: 'ws/ctx-pressure',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};

/** A full statusline row, ctx segment included — same fixture shape
 *  `statusline.test.ts` itself uses. */
const FULL_PANE = (pct: number): string =>
  `  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ ws/ctx-pressure │ 🎯 demo │ ▓ ctx ████░░░░ ${pct}%`;

/** The statusline row with everything BUT the ctx bar — model/branch/effort
 *  still parse; only the `▓` segment is gone (an older statusline-command.sh,
 *  or the operator trimmed the field). */
const NO_CTX_PANE = '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ ws/ctx-pressure │ 🎯 demo';

/** No statusline at all — a dialog/permission overlay painted over the whole
 *  row, `parseStatusline`'s own "empties" fixture shape. */
const DIALOG_PANE = '❯ 1. Yes\n  2. No, exit\nEnter to select';

/** The ctx segment ALONE — no 🤖, no ⎇. Both are independently conditional
 *  in ccd/statusline-command.sh:134-149 (model on `.model.display_name`,
 *  branch on being inside a repo), so this is a real, measured pane shape,
 *  not a contrived one. */
const CTX_ONLY_PANE = (pct: number): string => `  ▓ ctx ████░░░░ ${pct}%`;

describe('ctx pressure survives only the tick that measured it (D-2012)', () => {
  let paneOut = FULL_PANE(82);
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { code: 0, stdout: paneOut, stderr: '' };
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };

  beforeEach(() => { paneOut = FULL_PANE(82); });

  it('drops ctxPct on a tick whose pane has a statusline but no ctx segment, while model/branch are retained', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    const first = w.currentStatuslines().get(ID);
    expect(first?.ctxPct, 'the fixture only proves the merge if the first tick really measured 82%')
      .toBe(82);
    expect(first?.model).toBe('Sonnet 5');

    paneOut = NO_CTX_PANE;
    await w.tick();
    const second = w.currentStatuslines().get(ID);
    expect(second?.ctxPct).toBeUndefined();
    expect(second?.model).toBe('Sonnet 5');
    expect(second?.branch).toBe('ws/ctx-pressure');
  });

  it('drops ctxPct — does not let the stale reading ride — even when a dialog hides the WHOLE statusline for a tick, while still keeping model/branch (the "right for model and branch" case D-2012 names)', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    paneOut = DIALOG_PANE;
    await w.tick();
    const afterDialog = w.currentStatuslines().get(ID);
    // The whole-object-replace mutant keeps `{model:undefined,...}` here
    // (today's `if (sl.model || sl.branch || sl.effort)` guard is false, so
    // nothing is touched at all) — which is right for model/branch, per
    // D-2012's own text, but wrong for ctxPct: a stale 82% reading as
    // current on a row the console cannot currently even see the statusline
    // for is worse than no reading.
    expect(afterDialog?.ctxPct, 'a stale ctxPct rode a tick that measured nothing at all').toBeUndefined();
    expect(afterDialog?.model, 'model must still survive a one-tick overlay miss, unlike ctxPct').toBe('Sonnet 5');
    expect(afterDialog?.branch).toBe('ws/ctx-pressure');
  });

  it('a tick that measures ONLY the ctx segment merges the fresh reading onto retained identity, never blanking model/branch (Finding 3)', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.model).toBe('Sonnet 5');
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    paneOut = CTX_ONLY_PANE(91);
    await w.tick();
    const afterCtxOnly = w.currentStatuslines().get(ID);
    // The whole-object-replace mutant (`this.statuslines.set(r.id, sl)`
    // whenever `sl.ctxPct !== undefined`, with no merge) sets model/branch
    // to `undefined` here — the exact regression this branch exists to
    // stop, and the one the reviewer measured surviving a naive
    // `sl.model || sl.branch || sl.effort` guard with all three touched
    // suites still green.
    expect(afterCtxOnly?.ctxPct, 'the fresh ctx-only reading must still land').toBe(91);
    expect(afterCtxOnly?.model, 'model must survive a tick where only the ctx segment rendered').toBe('Sonnet 5');
    expect(afterCtxOnly?.branch).toBe('ws/ctx-pressure');
  });

  it('a dead pane deletes the WHOLE entry, not just ctxPct — distinguishable from the two misses above', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const deadRun: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') return { code: 1, stdout: '', stderr: '' }; // Tmux.capture -> null
      if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    const w2 = new FleetWatcher(testDeps(home, deadRun), new Bus(), 2000);
    await w2.tick();
    expect(w2.currentStatuslines().has(ID)).toBe(false);
  });
});
