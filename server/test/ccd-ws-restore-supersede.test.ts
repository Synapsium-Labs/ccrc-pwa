// server/test/ccd-ws-restore-supersede.test.ts
//
// Today archive -> restore is a clean forgery of history: ccd:4445 unlinks
// `.archived`, `.archivedreason` and `.archivemanifest` and nothing anywhere
// records that they existed. Four rows on the live box are stamped `merged:#N`
// while heartbeating right now, so the one field in the registry carrying a WHY
// is false on half the rows that have it.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-restore-sup-'); });
afterEach(() => { h.cleanup(); });

const STUB = `_spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  _ws_supervise() { :; }; _reg_claim() { :; }; tmux() { :; };`;

const archived = (id = 'demo-still-river'): string => {
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(wt, { recursive: true });
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river; _reg_set ${id} workdir ${wt}
    _reg_set ${id} archived 1787000000
    _reg_set ${id} archivedreason merged:#42
    _reg_set ${id} archivemanifest '{"id":"x","worktreeBytes":4096}'`);
  return id;
};

describe('ws-restore records what it is about to erase', () => {
  it('carries archivedAt, archivedReason and manifestBytes on the restore line', () => {
    // Mutant: delete the emit -> this fails with `expected undefined to be
    // 'merged:#42'`, and archive -> restore is a clean forgery again.
    const id = archived();
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const [e] = eventsOf(h.home, 'restore');
    expect(e, 'ws-restore wrote no line').toBeTruthy();
    const m = measOf(e!);
    expect(m['archivedReason']).toBe('merged:#42');
    expect(m['archivedAt']).toBe('1787000000');
    expect(Number(m['manifestBytes'])).toBeGreaterThan(0);
  });

  it('THE MUTANT: an emit moved below the rm -f reads three files that are gone', () => {
    // Mutant: move the `_lc_done restore` line below ccd:4445 -> this fails
    // with `expected undefined to be 'merged:#42'`.
    const id = archived();
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    expect(measOf(eventsOf(h.home, 'restore')[0]!)['archivedReason']).toBe('merged:#42');
    for (const f of ['archived', 'archivedreason', 'archivemanifest']) {
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.${f}`))).toBe(false);
    }
  });

  it('omits manifestBytes for a manifest that was never written — never 0', () => {
    const id = 'demo-bare';
    const wt = path.join(h.home, 'worktrees', 'demo', 'bare');
    fs.mkdirSync(wt, { recursive: true });
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} workdir ${wt}; _reg_set ${id} archived 1787000000`);
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const m = measOf(eventsOf(h.home, 'restore')[0]!);
    expect(m, 'a fabricated 0 argues that nothing was lost').not.toHaveProperty('manifestBytes');
    expect(m, 'an absent reason is a legitimate state, not an empty one')
      .not.toHaveProperty('archivedReason');
  });

  it('writes NO new registry field — the journal carries it, the registry does not', () => {
    const id = archived();
    const before = new Set(fs.readdirSync(path.join(h.home, '.cc-sessions')));
    h.sh(`${STUB} cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const added = fs.readdirSync(path.join(h.home, '.cc-sessions'))
      .filter((f) => !before.has(f) && f.startsWith(`${id}.`));
    expect(added, 'a 25th per-session field costs 24 extra agent round-trips per 2s tick')
      .toEqual([]);
  });

  it('records spawn-failed when the undo landed and the session did not come back', () => {
    // Mutant: delete the `_lc_fail restore … spawn-failed` call -> this fails
    // with `expected [] to have a length of 1`, and the one state a restore can
    // leave behind — stamps gone, session down — is recorded nowhere.
    const id = archived();
    h.sh(`_spawn_start() { return 4; }; _spawn_settle() { :; }; _ws_supervise() { :; }
      _reg_claim() { :; }; tmux() { :; }
      cmd_ws_restore --session ${id} 2>/dev/null || true`);
    const fails = eventsOf(h.home, 'restore').filter((e) => e['outcome'] === 'failed');
    expect(fails).toHaveLength(1);
    expect(fails[0]!['refusal']).toBe('spawn-failed');
  });
});
