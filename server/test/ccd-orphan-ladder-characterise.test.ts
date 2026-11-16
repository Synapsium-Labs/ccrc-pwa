// Delegation broker wave 5 PR4, Task 5.4.1: today's orphan ladder, pinned before the lease rung lands (W5-O0). Six trees, each
// on a FIXTURE HOME with the probe stubs of `ccd-ws-orphan-verb.test.ts`: for each, `_ws_orphan_audit`'s `verdict` and
// `refusal`, and the NAMES of the token's input lines (and of the rescue token's), read by running `_ws_orphan_ladder` with
// `_ws_reclaim_fingerprint` redefined to print its arguments' names. The six documents equal the committed fixture
// `fixtures/orphan-ladder/characterise.json`, written on `main` (CHARACTERISE_WRITE=1 rewrites it; a run never does by default).
// It pins, it does not drive: a change to the ladder's words or inputs reds here, and the lease rung's PR changes the fixture
// for its three new input names only, in a commit of its own. The six trees and the reader live in `orphanLadderFixture.ts`,
// which the lease rung's inertness rows share.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { LADDER_CASES as CASES, LADDER_FIXTURE as FIXTURE, characterise, type LadderDoc as Doc } from './orphanLadderFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-orphan-char-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const docs: Record<string, Doc> = {};

describe('W5-O0: the orphan ladder before the lease rung', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: verdict, refusal and token input names`, () => {
      docs[name] = characterise(h, c.build(h));
      expect(docs[name]!.verdict).toMatch(/^(token|refused|unmeasured)$/);
    }, 60_000);
  }

  it('the six documents equal the committed fixture', () => {
    expect(Object.keys(docs).sort()).toEqual(Object.keys(CASES).sort());
    const ordered = Object.fromEntries(Object.keys(CASES).map((k) => [k, docs[k]]));
    if (process.env['CHARACTERISE_WRITE'] === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(ordered, null, 2)}\n`);
    }
    expect(ordered).toEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  });
});
