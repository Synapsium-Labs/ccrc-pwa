// The pane scope's two acts side by side, the cross table (D-7303; ARCH-72, Task C5l; plan
// 2026-10-29-consolidation-k16-panescope-reader.md, rows X1 to X8 and three rows over the whole table). One FIXTURE
// box (`paneScopeFixture.ts`): `ccd-cap-scopes` runs, then `ccd-scope-sweep` runs ARMED (the fixture's own
// scope-sweep-live, in the fixture HOME, so a stop is a stub call) over the SAME listed units, beside the marker files a
// real fleet would hold. Each row is a unit kind; its two cells are the cap's answer and the sweep's. systemctl, tmux
// and getconf are stubs on PATH; no case reaches a user manager, a real /proc or a real tmux server. Green on the
// shipped scripts; the plan's Step 4 mutation table is the measurement.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bashBodies } from './census-w5/accountMarkers.js';
import { makePaneScopeBox, CAP, HOUR, type PaneScopeBox } from './paneScopeFixture.js';

const CAPPED_12G = String(12 * 2 ** 30);
const ROWS = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8'] as const;
type Row = (typeof ROWS)[number];
type Markers = 'fleet' | 'every' | 'none';

/** Each row's unit, by the box's own names. */
const unitsOf = (b: PaneScopeBox): Record<Row, string> => ({
  X1: b.unitName(1), X2: b.unitName(2), X3: b.unitName(3), X4: b.unitName(4),
  X5: b.unitName(5), X6: b.unitName(6), X7: b.unitName(7), X8: 'ccrc-tmux-server.scope',
});

/** The session whose `$REG/<id>.panescope` names each row's unit, when one does. X2 is a session's SECOND pane: its
 *  session's marker names X1, so no marker ever names it. */
const SESSION: Partial<Record<Row, string>> = {
  X1: 'project-a-one', X3: 'project-a-three', X4: 'project-a-four', X5: 'project-a-five', X6: 'project-a-six', X7: 'project-a-seven',
};
/** The markers a real fleet holds: X3's session was reaped (its marker purged), X6's scope failed and X7's vanished. */
const FLEET_MARKERS: readonly Row[] = ['X1', 'X4', 'X5'];

/** The table's units planted in box `b`, and `markers`' marker files. */
function build(b: PaneScopeBox, markers: Markers): Record<Row, string> {
  const x = unitsOf(b);
  const live = (n: number, o: { slice?: string } = {}): void => {
    b.proc(3000 + n, { age: 2 * 86400, cg: b.cgOf(b.unitName(n)) });
    b.scope(n, { pane: 3000 + n, procs: [3000 + n], ...o });
  };
  live(1);                                        // X1: a live session's first pane, uncapped
  live(2);                                        // X2: the same session's second pane, uncapped
  b.inert(3);                                     // X3: a reaped session's pane scope, dead and inert for seven hours
  live(4, { slice: 'app.slice' });                // X4: D-307's layout, bare app.slice; dead and inert too
  b.seen(x.X4, 7 * HOUR, 7255660000);
  live(5);                                        // X5: a capped live pane
  b.memoryMax(x.X5, CAPPED_12G);
  // X6: a failed-state unit: listed with ●, and the show answers a stopped scope has (no cgroup, no CPU).
  b.scope(6, { pane: 3006, procs: [], cgShown: '', cpuShown: '[not set]', noProcsFile: true });
  const units = path.join(b.fx.base, 'units');
  fs.writeFileSync(units, fs.readFileSync(units, 'utf8').replace(`${x.X6} loaded active running`, `● ${x.X6} loaded failed failed`));
  b.gone('●');                                    // the glyph is no unit the manager has loaded
  b.listLine(`  ${x.X7} loaded active running tmux child pane`);   // X7: listed, then gone before show
  b.gone(x.X7);
  b.listLine(`  ${x.X8} loaded active running tmux server`);       // X8
  b.livePanes(3001, 3002, 3005);
  const reg = path.join(b.fx.home, '.cc-sessions');
  const named: readonly Row[] = markers === 'none' ? [] : markers === 'fleet' ? FLEET_MARKERS : (Object.keys(SESSION) as Row[]);
  for (const row of named) fs.writeFileSync(path.join(reg, `${SESSION[row]!}.panescope`), x[row]);
  return x;
}

interface Table { cap: Record<Row, string>; sweep: Record<Row, string>; capCalls: string[]; sweepCalls: string[]; capRc: number; sweepRc: number }

/** The cap, then the armed sweep, over box `b`; each row's two cells read off the stub's argv log and the record. */
function runTable(b: PaneScopeBox, x: Record<Row, string>): Table {
  b.arm();
  const capR = b.runScript(CAP);
  const capCalls = b.calls();
  b.clearCalls();
  const sweepR = b.run();
  const sweepCalls = b.calls();
  const memmax = (u: string): string | null => {
    const p = path.join(b.fx.base, 'memmax', u);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
  };
  const capCell = (u: string): string => {
    if (capCalls.some((c) => c.startsWith(`--user set-property --runtime ${u} `))) return memmax(u) === CAPPED_12G ? 'capped' : 'set-property failed';
    if (capCalls.includes(`--user show ${u} -p MemoryMax --value`)) return 'not asked to set';
    return 'not listed';
  };
  const dead = b.rows('dead');
  const carry = b.rows('carry');
  const sweepCell = (u: string): string => {
    if (!sweepCalls.some((c) => c.startsWith(`--user show ${u} `))) return 'not listed';
    const stop = sweepCalls.includes(`--user stop --no-block ${u}`);
    if (dead[u]) return `dead verdict=${dead[u]!['verdict']}${stop ? ' + stop --no-block' : ''}`;
    if (stop) return 'stop without a dead row';
    if (carry[u]) return `carry why=${carry[u]!['why']}`;
    return 'no row';
  };
  const cap = {} as Record<Row, string>;
  const sweep = {} as Record<Row, string>;
  for (const row of ROWS) { cap[row] = capCell(x[row]); sweep[row] = sweepCell(x[row]); }
  return { cap, sweep, capCalls, sweepCalls, capRc: capR.code, sweepRc: sweepR.code };
}

describe('the cross table: the cap and the armed sweep over the same listed pane scopes (D-7303)', () => {
  const box = makePaneScopeBox({ honourPattern: true });
  const other = makePaneScopeBox({ honourPattern: true });

  const EXPECTED: Record<Row, { cap: string; sweep: string }> = {
    X1: { cap: 'capped', sweep: 'no row' },                                     // live
    X2: { cap: 'capped', sweep: 'no row' },                                     // live
    X3: { cap: 'capped', sweep: 'dead verdict=stopped + stop --no-block' },
    X4: { cap: 'capped', sweep: 'no row' },                                     // outside the session slice
    X5: { cap: 'not asked to set', sweep: 'no row' },                           // live
    X6: { cap: 'not listed', sweep: 'carry why=control-group' },               // the cap asked `show ●`
    X7: { cap: 'set-property failed', sweep: 'carry why=unit-show' },
    X8: { cap: 'not listed', sweep: 'not listed' },
  };
  const TITLES: Record<Row, string> = {
    X1: 'a live session\'s first pane, uncapped, its marker naming it',
    X2: 'the same session\'s second pane, uncapped, no marker naming it',
    X3: 'a reaped session\'s pane scope, dead and inert for seven hours, its marker purged',
    X4: 'an uncapped scope in bare app.slice (D-307\'s layout)',
    X5: 'a capped live pane',
    X6: 'a failed-state unit listed with ● (the cap\'s known gap), its scope stopped',
    X7: 'a unit that vanished between list and show',
    X8: 'ccrc-tmux-server.scope',
  };

  it.each(ROWS.map((r) => [r, TITLES[r], EXPECTED[r].cap, EXPECTED[r].sweep] as const))('%s %s: cap %s, sweep %s', (row) => {
    const x = build(box, 'fleet');
    const t = runTable(box, x);
    expect({ rc: t.capRc, sweepRc: t.sweepRc }).toEqual({ rc: 0, sweepRc: 0 });
    expect({ cap: t.cap[row], sweep: t.sweep[row] }).toEqual(EXPECTED[row]);
    if (row === 'X6') {
      expect(t.capCalls).toContain('--user show ● -p MemoryMax --value');
      expect(t.capCalls.filter((c) => c.includes(x.X6))).toEqual([]);
    }
  });

  it('the whole table: the cap caps every listed pane scope the sweep judges, except X6 (the ● known gap, D-7303)', () => {
    const x = build(box, 'fleet');
    const t = runTable(box, x);
    const judged = ROWS.filter((r) => t.sweep[r] !== 'not listed');
    expect(judged.filter((r) => t.cap[r] === 'not listed')).toEqual(['X6']);
  });

  it('the whole table: neither act reads $REG/<id>.panescope (every session\'s marker present, or none: every cell the same)', () => {
    const withEvery = runTable(box, build(box, 'every'));
    const withNone = runTable(other, build(other, 'none'));
    expect(fs.readdirSync(path.join(box.fx.home, '.cc-sessions')).filter((f) => f.endsWith('.panescope')).length).toBe(6);
    expect(fs.readdirSync(path.join(other.fx.home, '.cc-sessions')).filter((f) => f.endsWith('.panescope'))).toEqual([]);
    expect({ cap: withNone.cap, sweep: withNone.sweep }).toEqual({ cap: withEvery.cap, sweep: withEvery.sweep });
    expect(withEvery.cap).toEqual(Object.fromEntries(ROWS.map((r) => [r, EXPECTED[r].cap])));
    expect(withEvery.sweep).toEqual(Object.fromEntries(ROWS.map((r) => [r, EXPECTED[r].sweep])));
  });

  it('the whole table: the two acts are two units (two services, two timers, two scripts, nothing between them)', () => {
    const SYSTEMD = path.resolve(__dirname, '../../deploy/systemd');
    /** A unit file's `key=value` directives, comments and section headers dropped. */
    const directives = (name: string): Array<[string, string]> => fs.readFileSync(path.join(SYSTEMD, name), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith(';') && !l.startsWith('['))
      .map((l): [string, string] => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
    const values = (name: string, key: string): string[] => directives(name).filter(([k]) => k === key).map(([, v]) => v);
    expect(values('ccd-cap-scopes.service', 'ExecStart')).toEqual(['%h/.local/bin/ccd-cap-scopes']);
    expect(values('ccd-scope-sweep.service', 'ExecStart')).toEqual(['%h/.local/bin/ccd-scope-sweep']);
    const COUPLING = ['After', 'Before', 'Requires', 'Wants', 'BindsTo', 'PartOf', 'ExecStartPre', 'ExecStartPost', 'Unit'];
    const pairs: Array<[string, string]> = [
      ['ccd-cap-scopes.service', 'ccd-scope-sweep'], ['ccd-cap-scopes.timer', 'ccd-scope-sweep'],
      ['ccd-scope-sweep.service', 'ccd-cap-scopes'], ['ccd-scope-sweep.timer', 'ccd-cap-scopes'],
    ];
    for (const [file, theOther] of pairs) {
      const named = directives(file).filter(([k, v]) => COUPLING.includes(k) && v.includes(theOther));
      expect(named, `${file} names ${theOther} in an ordering, dependency or exec directive`).toEqual([]);
    }
    expect({ OnBootSec: values('ccd-cap-scopes.timer', 'OnBootSec'), OnUnitActiveSec: values('ccd-cap-scopes.timer', 'OnUnitActiveSec') })
      .toEqual({ OnBootSec: ['45s'], OnUnitActiveSec: ['60s'] });
    expect({ OnActiveSec: values('ccd-scope-sweep.timer', 'OnActiveSec'), OnUnitActiveSec: values('ccd-scope-sweep.timer', 'OnUnitActiveSec') })
      .toEqual({ OnActiveSec: ['2min'], OnUnitActiveSec: ['60s'] });
    const codeLines = (script: string): string[] => bashBodies(fs.readFileSync(path.resolve(__dirname, '../../ccd', script), 'utf8'))
      .flatMap((b) => b.lines.map((r) => r.code)).filter((c) => c.trim() !== '');
    expect(codeLines('ccd-cap-scopes').filter((c) => c.includes('ccd-scope-sweep')), 'the cap\'s code names the sweep').toEqual([]);
    expect(codeLines('ccd-scope-sweep').filter((c) => c.includes('ccd-cap-scopes')), 'the sweep\'s code names the cap').toEqual([]);
  });
});
