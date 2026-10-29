// ccd-cap-scopes, the cap verdict table (D-7303; ARCH-72, Task C5l; plan
// 2026-10-29-consolidation-k16-panescope-reader.md, rows K0 to K13). The OOM guardrail's first behaviour tests: one
// row per cap decision (what it lists, what it asks, what counts as uncapped, what it sets, what it counts, how it
// ends), each pinning the systemctl stub's exact argv log, stdout, stderr and rc. Every run is a FIXTURE
// (`paneScopeFixture.ts`): systemctl is a stub on PATH that answers the fixture's units and logs every argv, so no
// case reaches a user manager or sets a property on a real unit. Green on the shipped script; the plan's Step 4
// mutation table is the measurement that each row has teeth.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePaneScopeBox, CAP, SLICE } from './paneScopeFixture.js';

const SET = 'MemoryHigh=8G MemoryMax=12G MemorySwapMax=2G TasksMax=4096';
const LIST = '--user list-units --no-legend tmux-spawn-*.scope';
const show = (u: string): string => `--user show ${u} -p MemoryMax --value`;
const set = (u: string): string => `--user set-property --runtime ${u} ${SET}`;
const CAPPED_12G = String(12 * 2 ** 30);

describe('K0 the fixture itself: without honourPattern the stub lists every unit whatever the pattern', () => {
  const box = makePaneScopeBox();

  it('K0 the stub\'s `list-units \'tmux-spawn-*.scope\'` answer still names ccrc-tmux-server.scope (the default scope-sweep.test.ts relies on)', () => {
    box.listLine('  ccrc-tmux-server.scope loaded active running tmux server');
    box.listLine(`  ${box.unitName(1)} loaded active running tmux child pane`);
    const r = spawnSync(path.join(box.fx.bin, 'systemctl'), ['--user', 'list-units', '--no-legend', 'tmux-spawn-*.scope'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`  ccrc-tmux-server.scope loaded active running tmux server\n  ${box.unitName(1)} loaded active running tmux child pane\n`);
  });
});

describe('the cap verdict table: ccd-cap-scopes over the pane-scope box (D-7303)', () => {
  const box = makePaneScopeBox({ honourPattern: true });
  const { unitName, listLine, memoryMax, gone, emptyShow, setPropertyRc, listRc, calls, clearCalls, scope } = box;
  const cap = (cwd?: string) => box.runScript(CAP, {}, cwd);
  /** A pane scope as the cap's list (no `--plain`) prints it: two leading spaces. */
  const pane = (n: number): string => { const u = unitName(n); listLine(`  ${u} loaded active running tmux child pane`); return u; };

  it('K1 the argv: one uncapped unit is listed, asked MemoryMax by name, and set at runtime with the four values', () => {
    const u = pane(1);
    const r = cap();
    expect(calls()).toEqual([LIST, show(u), set(u)]);
    expect(r).toEqual({ code: 0, out: 'capped 1 new pane scope(s)\n', err: '' });
  });

  it('K2 already capped: a MemoryMax of 12884901888 is not set again, and the tick is silent', () => {
    const u = pane(1);
    memoryMax(u, CAPPED_12G);
    const r = cap();
    expect(calls()).toEqual([LIST, show(u)]);
    expect(r).toEqual({ code: 0, out: '', err: '' });
  });

  it('K3 only `infinity` is uncapped: max, 0, `infinity ` (a trailing blank) and Infinity are each left alone (the comparison is exact)', () => {
    const us = [1, 2, 3, 4].map(pane);
    ['max', '0', 'infinity ', 'Infinity'].forEach((v, i) => memoryMax(us[i]!, v));
    const r = cap();
    expect(calls()).toEqual([LIST, ...us.map(show)]);
    expect(r).toEqual({ code: 0, out: '', err: '' });
  });

  it('K4 every slice: uncapped scopes in the session slice, in bare app.slice and in a third slice are each capped once', () => {
    const us = [SLICE, 'app.slice', 'other.slice'].map((slice, i) => scope(i + 1, { pane: 3001 + i, procs: [], slice }));
    const r = cap();
    expect(calls()).toEqual([LIST, ...us.flatMap((u) => [show(u), set(u)])]);
    expect(r).toEqual({ code: 0, out: 'capped 3 new pane scope(s)\n', err: '' });
  });

  it('K5 no Description check and no marker: a scope whose Description does not parse, and that no $REG/<id>.panescope names, is capped', () => {
    const u1 = scope(1, { pane: 3001, procs: [], desc: 'not a tmux pane description' });
    const u2 = scope(2, { pane: 3002, procs: [] });
    fs.writeFileSync(path.join(box.fx.home, '.cc-sessions', 'project-a-one.panescope'), unitName(9));   // names neither
    const r = cap();
    expect(calls()).toEqual([LIST, show(u1), set(u1), show(u2), set(u2)]);
    expect(r).toEqual({ code: 0, out: 'capped 2 new pane scope(s)\n', err: '' });
  });

  it('K6 the glob is the cap\'s only filter: ccrc-tmux-server.scope and a claude-session@x.service are neither shown nor capped', () => {
    listLine('  ccrc-tmux-server.scope loaded active running tmux server');
    listLine('  claude-session@x.service loaded active running a session');
    const u = pane(1);
    const r = cap();
    expect(calls()).toEqual([LIST, show(u), set(u)]);
    expect(r).toEqual({ code: 0, out: 'capped 1 new pane scope(s)\n', err: '' });
  });

  it('K7 a vanished unit, two ways: an empty show is skipped; the manager default `infinity` reaches a failing set-property, not counted, silent, rc 0', () => {
    const empty = pane(1);
    const vanished = pane(2);
    emptyShow(empty);
    gone(vanished);
    const r = cap();
    expect(calls()).toEqual([LIST, show(empty), show(vanished), set(vanished)]);
    expect(r).toEqual({ code: 0, out: '', err: '' });
  });

  it('K8 a failing set-property: both units attempted, the second still capped, the count is the successes', () => {
    const u1 = pane(1);
    const u2 = pane(2);
    setPropertyRc(u1, 1);
    const r = cap();
    expect(calls()).toEqual([LIST, show(u1), set(u1), show(u2), set(u2)]);
    expect(r).toEqual({ code: 0, out: 'capped 1 new pane scope(s)\n', err: '' });
  });

  it('K9 a failing list-units: no further call, stdout and stderr empty, rc 0', () => {
    pane(1);
    listRc(1);
    const r = cap();
    expect(calls()).toEqual([LIST]);
    expect(r).toEqual({ code: 0, out: '', err: '' });
  });

  it('K10 nothing to cap: an empty list, and a list of capped units only, end rc 0 (the final `exit 0` keeps a quiet tick from failing the unit)', () => {
    const empty = cap();
    expect(calls()).toEqual([LIST]);
    expect(empty).toEqual({ code: 0, out: '', err: '' });
    clearCalls();
    const us = [1, 2].map(pane);
    us.forEach((u) => memoryMax(u, CAPPED_12G));
    const quiet = cap();
    expect(calls()).toEqual([LIST, ...us.map(show)]);
    expect(quiet).toEqual({ code: 0, out: '', err: '' });
  });

  it('K11 idempotent: K4\'s fixture run twice, the second run sets nothing and is silent', () => {
    const us = [SLICE, 'app.slice', 'other.slice'].map((slice, i) => scope(i + 1, { pane: 3001 + i, procs: [], slice }));
    expect(cap()).toEqual({ code: 0, out: 'capped 3 new pane scope(s)\n', err: '' });
    clearCalls();
    const second = cap();
    expect(calls()).toEqual([LIST, ...us.map(show)]);
    expect(second).toEqual({ code: 0, out: '', err: '' });
  });

  it('K12 KNOWN GAP, no memory consequence (D-7303): a failed-state unit listed with the ● glyph is asked as `●` and never capped under its own name', () => {
    // Without --plain, list-units prints ● in the first column of a failed unit, and awk '{print $1}' hands the cap
    // the glyph. The stub answers `●` as a name the manager does not have loaded (its default `infinity`, a failing
    // set-property). By systemd's unit model a failed scope has been stopped, so nothing is left uncapped that runs.
    const failed = unitName(1);
    listLine(`● ${failed} loaded failed failed tmux child pane`);
    gone('●');
    const u2 = pane(2);
    const r = cap();
    expect(calls()).toEqual([LIST, show('●'), set('●'), show(u2), set(u2)]);
    expect(calls().filter((c) => c.includes(failed))).toEqual([]);
    expect(r).toEqual({ code: 0, out: 'capped 1 new pane scope(s)\n', err: '' });
  });

  it('K13 a quoted glob: run from a directory holding a file named tmux-spawn-x.scope, the pattern reaches systemctl unexpanded', () => {
    const cwd = path.join(box.fx.base, 'cwd');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'tmux-spawn-x.scope'), '');
    const u = pane(1);
    const r = cap(cwd);
    expect(calls()).toEqual([LIST, show(u), set(u)]);
    expect(r).toEqual({ code: 0, out: 'capped 1 new pane scope(s)\n', err: '' });
  });
});
