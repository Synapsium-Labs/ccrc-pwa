// `ccrc-api` reaches a box the same way `ccd` does, and this file is why that
// stays true. Two properties, and the second is what makes the first correct.
//
// It installs through `install_atomic` in the AGENT lane, beside `ccd` — the
// fleet host is where sessions run, and a session-side client on the server box
// would be a copy nobody invokes. And it is SELF-CONTAINED: the moment it
// `source`s a sibling it stops being installable as one file, and needs the shim
// treatment `ccrc` has (deploy.sh's `install_ccrc_shim` argues that at length).
// That loss is silent — the deploy still succeeds, the file still lands, and the
// verb dies the first time a box runs it. So it is pinned here rather than
// trusted.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API } from './ccdWsHelpers.js';

const DEPLOY = path.join(import.meta.dirname, '..', '..', 'deploy', 'deploy.sh');
const deploy = (): string => fs.readFileSync(DEPLOY, 'utf8');

/** Executable lines only. deploy.sh's own comments discuss its helpers by name,
 *  and a scrape that counted prose would "prove" an ordering the shell never
 *  runs — a trap this file's subject records having sprung twice. */
const code = (): string[] =>
  deploy().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('ccrc-api ships', () => {
  it('installs through install_atomic, at 755, under .local/bin', () => {
    const line = code().filter((l) => l.startsWith('install_atomic ccd/ccrc-api'));
    expect(line, 'deploy.sh installs ccd/ccrc-api exactly once').toHaveLength(1);
    expect(line[0]).toBe('install_atomic ccd/ccrc-api .local/bin/ccrc-api 755');
  });

  it('installs in the same lane as ccd, not the server lane', () => {
    // Adjacency to `ccd` is the check, because "the agent lane" is not a thing
    // the file names — it is the block that installs ccd. If ccd moves, this
    // follows it; if ccrc-api drifts into the server lane, the two stop being
    // neighbours and this reds.
    const lines = code();
    const ccd = lines.findIndex((l) => l.startsWith('install_atomic ccd/ccd '));
    const api = lines.findIndex((l) => l.startsWith('install_atomic ccd/ccrc-api '));
    expect(ccd, 'deploy.sh still installs ccd').toBeGreaterThan(-1);
    expect(api, 'deploy.sh installs ccrc-api').toBeGreaterThan(-1);
    expect(Math.abs(api - ccd),
      'ccrc-api installs beside ccd — the fleet host is where sessions run').toBeLessThanOrEqual(2);
  });

  it('sources nothing — the property the one-file install depends on', () => {
    // A `source`/`.` of a sibling would make the lone copy at ~/.local/bin dead
    // on every box, and the deploy would not notice.
    const src = fs.readFileSync(CCRC_API, 'utf8');
    const sourcing = src.split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('#'))
      .filter((l) => /^(source|\.)\s+\S/.test(l));
    expect(sourcing).toEqual([]);
  });

  it('is committed executable, so a box that installs it can run it', () => {
    // `install_atomic … 755` sets the mode on the destination, so this is belt
    // and braces — but `ccrc install` and a hand-run from a checkout both use
    // the file where it lies.
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(CCRC_API).mode & 0o111).toBeGreaterThan(0);
  });
});
