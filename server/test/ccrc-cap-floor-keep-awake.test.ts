// The Overlord W1 ccd arms (cross-plan ruling X8): `keep-awake-v1` joins the capability floor. Its row's fact is the
// route field `acctorder`, the Overlord's ordered account list, written for the Overlord's row only by the designation's
// create, which also sets its keep-awake markers (the coordinator's ruling for run 2216: a twin fact must be a route
// field, `CapFloorRow.fact`, and no existing reader tells keep-awake's stamped `.no-roll` from a hand-made one). The row
// is data: B1's readers (`_cap_floor_standing`, `_upd_cap_floor_check`) refuse and proceed on it with no code change.
// FIXTURE HOMEs only (`freshUpdateBox`): nothing here reaches the live box.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { plantOldBox, writeManifest, stubTree, packRelease, runUpdate, freshUpdateBox, fileText, linkOf } from './ccrc-updateFixture.js';

removeTmpFixturesEachTest();

const REMEDY = 'the operator releases the Overlord from their own shell, never a session: ccd keep-awake --session <id> --state off, then ccd route --session <id> --set acctorder=';
const NOTHING = 'Nothing on this box was changed';

/** A STUB v2.0.0 release whose staged `build.json` carries `ccdCaps` as given, published as latest; the box on v1.0.0. */
function movingBox(prefix: string, caps: readonly string[]): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v1.0.0' });
  const tree = stubTree(home, { version: 'v2.0.0' });
  const stamp = join(tree, 'build.json');
  writeFileSync(stamp, `${JSON.stringify({ ...JSON.parse(readFileSync(stamp, 'utf8')) as object, ccdCaps: caps })}\n`);
  rmSync(join(tree, 'MANIFEST'));
  writeManifest(tree);
  packRelease(home, tree, { tag: 'v2.0.0' });
  return home;
}
/** The Overlord's ordered list standing for `id`: a regular file at `~/.cc-sessions/<id>.acctorder`. */
function plantOrder(home: string, id = 'lane-a-overlord'): void {
  mkdirSync(join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(join(home, '.cc-sessions', `${id}.acctorder`), 'lane-a,lane-b\n');
}
const snapshot = (home: string): { stamp: string; link: string | null; installed: boolean } =>
  ({ stamp: fileText(join(home, '.ccrc', 'build.json')), link: linkOf(home), installed: existsSync(join(home, '.ccrc', 'installed')) });

describe('capability floor: the keep-awake-v1 row (Overlord W1 ccd arms)', () => {
  it('an ordered list stands and the target lacks keep-awake-v1: refused at exit 1, the remedy first, nothing changed', () => {
    const home = movingBox('ccrc-capfloor-ka-refuse-', ['ws-add', 'pool-set']);
    plantOrder(home);
    const before = snapshot(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${REMEDY}: the target build lacks keep-awake-v1; a acctorder stands for lane-a-overlord. ${NOTHING}`);
    expect(snapshot(home)).toEqual(before);
  });

  it('an ordered list stands and the target holds keep-awake-v1: proceeds', () => {
    const home = movingBox('ccrc-capfloor-ka-holds-', ['ws-add', 'keep-awake-v1']);
    plantOrder(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toContain('keep-awake-v1');
  });

  it('a hand-made .no-roll alone never blocks: the row reads the ordered list, not the markers', () => {
    const home = movingBox('ccrc-capfloor-ka-hand-', ['ws-add']);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'lane-a-project-a.no-roll'), '');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });
});
