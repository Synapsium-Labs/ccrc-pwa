// The sweep's default noise list reaches a fleet host by TWO lanes, and until
// D-1161 only one of them was pinned. `ccrc install` converges it
// (`_inst_graph_noise`, covered in `ccrc-install-graphify.test.ts`); `deploy.sh
// agent` ships it too, deliberately, because a fleet host is DEPLOYED day to
// day and installed rarely — a box that only ever sees deploys would otherwise
// keep refusing builds over `.remember/` and `.superpowers/` files that ccrc
// itself wrote there.
//
// That second lane shipped with no test at all: deleting both of its lines
// reddened nothing, which is the same "a comment is a request, a red suite is a
// mechanism" gap this repo keeps finding. It is a source scan rather than a
// behavioural test for the reason `ccrc-api-ship.test.ts` gives — deploy.sh
// runs over ssh against a real box and cannot be exercised here — and it is
// scoped to executable lines for the same reason that file records: deploy.sh's
// own comments name its helpers, so a scrape counting prose would "prove" an
// ordering the shell never runs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DEPLOY = path.join(import.meta.dirname, '..', '..', 'deploy', 'deploy.sh');
const code = (): string[] =>
  fs.readFileSync(DEPLOY, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

describe('graph-noise default list ships on the agent lane (D-1160/D-1161)', () => {
  it('installs through install_atomic, at 644, under .ccrc/graph-noise', () => {
    const line = code().filter((l) => l.startsWith('install_atomic ccd/graph-noise.default.list'));
    expect(line, 'deploy.sh installs the default noise list exactly once').toHaveLength(1);
    expect(line[0]).toBe('install_atomic ccd/graph-noise.default.list .ccrc/graph-noise/_default.list 644');
  });

  it('creates the directory first — install_atomic writes a file, it does not mkdir', () => {
    const lines = code();
    const mk = lines.findIndex((l) => l.includes('mkdir -p ~/.ccrc/graph-noise'));
    const put = lines.findIndex((l) => l.startsWith('install_atomic ccd/graph-noise.default.list'));
    expect(mk, 'nothing creates ~/.ccrc/graph-noise on the box').toBeGreaterThan(-1);
    expect(put).toBeGreaterThan(-1);
    expect(mk, 'the directory is created after the file is written into it').toBeLessThan(put);
  });

  it('ships in the same lane as the sweep it feeds, not the server lane', () => {
    // Adjacency to `ccd-graph-sweep` is the check, for the reason
    // `ccrc-api-ship.test.ts` states: "the agent lane" is not a name the file
    // uses — it is the block that installs the sweep. If the sweep moves, this
    // follows it; if the list drifts into the server lane, they stop being
    // neighbours and this reds.
    const lines = code();
    const sweep = lines.findIndex((l) => l.startsWith('install_atomic ccd/ccd-graph-sweep'));
    const list = lines.findIndex((l) => l.startsWith('install_atomic ccd/graph-noise.default.list'));
    expect(sweep, 'deploy.sh no longer installs the sweep').toBeGreaterThan(-1);
    expect(Math.abs(list - sweep),
      'the list and the sweep that reads it drifted apart in deploy.sh').toBeLessThanOrEqual(3);
  });

  it('the shipped file carries no "!" line — one would refuse every build on the box', () => {
    const listed = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'ccd', 'graph-noise.default.list'), 'utf8');
    expect(listed.split('\n').filter((l) => /^\s*!/.test(l))).toEqual([]);
    // and it is not empty — a vacuous list would pass every assertion above
    expect(listed.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length)
      .toBeGreaterThan(0);
  });
});
