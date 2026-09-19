// A workspace cannot be archived and running at once. `ws-archive` kills the
// pane and unsupervises the unit, but nothing stopped a later `start`/`ensure`/
// `swap` from creating a pane again — and none of those cleared the stamp, so
// the workspace stayed archived while it ran. Every cleanup selector that
// filters on `.archived` then calls a live session dormant (CCR-10: two live
// sessions carried the stamp for weeks, one mid-deploy on an irreversible step).
//
// `_spawn_start` is the single pane-creating chokepoint — every start path
// reaches tmux through it — so the repair lives there. It CLEARS rather than
// REFUSES because `cmd_swap` kills the pane before it re-spawns: a refusal
// there would leave a live session dead with nothing to bring it back.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-unarch-'); });
afterEach(() => { h.cleanup(); });

/** The real `_spawn_start`, stopped at the pane. The guard under test runs
 *  BEFORE `tname=$(_tmux …)`, so a tmux that always fails still exercises it —
 *  and proves the clear does not depend on the spawn succeeding. */
const SPAWN_STUBS = `sleep() { :; }; tmux() { return 1; };
  _accept_first_run_prompts() { return 0; };`;

const reg = (id: string, field: string): string =>
  path.join(h.home, '.cc-sessions', `${id}.${field}`);
const exists = (id: string, field: string): boolean => fs.existsSync(reg(id, field));

/** A workspace with a full archive on it — all three files, as `ws-archive`
 *  leaves them. */
const archivedWorkspace = (slug: string): string => {
  const id = `proj-${slug}`;
  h.makeRepo('proj');
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add proj`);
  fs.writeFileSync(reg(id, 'archived'), '1786431390\n');
  fs.writeFileSync(reg(id, 'archivedreason'), 'merged:#28\n');
  fs.writeFileSync(reg(id, 'archivemanifest'), '{"paths":[]}\n');
  return id;
};

/** Run the real `_spawn_start`, keeping stderr and never throwing: it is
 *  EXPECTED to fail at the pane, and the assertions are about what it did
 *  before that. */
const spawnStart = (id: string, mode = 'resume'): string => {
  h.sh(`${SPAWN_STUBS} _spawn_start ${id} ${mode} 2>"$HOME/spawn-err" || true`);
  return fs.readFileSync(path.join(h.home, 'spawn-err'), 'utf8');
};

describe('_ws_unarchive removes the whole archive, not part of it', () => {
  it('unlinks all three archive files', () => {
    const id = archivedWorkspace('alpha');
    h.sh(`_ws_unarchive ${id}`);
    // Each asserted separately: a mutant that drops any ONE path from either
    // `rm -f` leaves that file standing, and a single combined assertion
    // could not say which.
    expect(exists(id, 'archived'), '.archived').toBe(false);
    expect(exists(id, 'archivedreason'), '.archivedreason').toBe(false);
    expect(exists(id, 'archivemanifest'), '.archivemanifest').toBe(false);
  });

  it('clears the stamp when the detail files were never written', () => {
    const id = archivedWorkspace('beta');
    fs.rmSync(reg(id, 'archivedreason')); fs.rmSync(reg(id, 'archivemanifest'));
    h.sh(`_ws_unarchive ${id}`);
    expect(exists(id, 'archived')).toBe(false);
  });
});

describe('a spawn on an archived workspace repairs the invariant', () => {
  it('clears the archive even though the spawn itself fails', () => {
    const id = archivedWorkspace('gamma');
    spawnStart(id);
    expect(exists(id, 'archived'), '.archived').toBe(false);
    expect(exists(id, 'archivedreason'), '.archivedreason').toBe(false);
    expect(exists(id, 'archivemanifest'), '.archivemanifest').toBe(false);
  });

  it('warns on stderr, naming the session and the archive reason', () => {
    const id = archivedWorkspace('delta');
    const err = spawnStart(id);
    expect(err, 'names the session').toContain(id);
    // The REASON, not just the fact: a mutant that drops `${archreason:+ …}`
    // still warns, and the operator loses why it was archived.
    expect(err, 'names the archive reason').toContain('merged:#28');
    expect(err, 'names the deliberate way back').toContain('ws-restore');
  });

  it('journals an unarchive act carrying the archive it dropped', () => {
    const id = archivedWorkspace('epsilon');
    spawnStart(id, 'resume');
    const [e] = eventsOf(h.home, 'unarchive');
    expect(e, 'an unarchive record was emitted').toBeTruthy();
    const m = measOf(e!);
    expect(m.archivedReason, 'meas.archivedReason').toBe('merged:#28');
    expect(m.archivedAt, 'meas.archivedAt').toBe('1786431390');
    expect(m.mode, 'meas.mode — which spawn path resurrected it').toBe('resume');
  });

  it('says nothing and journals nothing when the workspace was not archived', () => {
    const id = `proj-zeta`;
    h.makeRepo('proj');
    h.sh(`${WS_ADD} CCD_WS_SLUG=zeta cmd_ws_add proj`);
    const err = spawnStart(id);
    // Guards the guard: without this, a mutant making the `if` unconditional
    // passes every assertion above.
    expect(eventsOf(h.home, 'unarchive'), 'no unarchive act').toEqual([]);
    expect(err, 'no archive warning').not.toContain('was archived');
  });
});

describe('ws-restore still removes the whole archive through the shared helper', () => {
  it('leaves none of the three behind', () => {
    const id = archivedWorkspace('eta');
    h.sh(`_spawn_start() { return 0; }; _spawn_settle() { :; }; _ws_supervise() { :; };
          _reg_claim() { :; }; cmd_ws_restore --session ${id} >/dev/null 2>&1 || true`);
    expect(exists(id, 'archived'), '.archived').toBe(false);
    expect(exists(id, 'archivedreason'), '.archivedreason').toBe(false);
    expect(exists(id, 'archivemanifest'), '.archivemanifest').toBe(false);
  });
});
