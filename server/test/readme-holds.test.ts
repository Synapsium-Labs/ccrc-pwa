// The README's "Workspace holds & programs" section is the operator-facing
// statement of what a hold DOES, and it drifted the moment the second consumer
// shipped: it read "the one thing a hold changes: archiveMerged's gate …
// everything else is unchanged" while ccd already refused `ws-rm` and
// `ws-reap` on a held workspace (the spec's Mechanism 1 lists BOTH consumers).
// An operator who believed that paragraph archived a held workspace, tapped
// "Clean up workspace…" in the same sheet, and met a refusal the README said
// could not exist.
//
// This pins the prose to the SHIPPED rungs rather than to a fixed sentence: it
// greps ccd itself, so if a rung is ever deleted the test fails here too and
// the paragraph gets re-decided instead of quietly becoming false again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The path to the ccd script is spelled in exactly ONE file in this tree and
// `single-definition.test.ts` enforces it — import the constant, never re-spell
// it here (this file's first draft did, and that guard caught it).
import { CCD } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const ccd = readFileSync(CCD, 'utf8');

/** The holds subsection alone — from its own `###` heading to the next
 *  top-level heading — so a match anywhere else in a 500-line README cannot
 *  satisfy an assertion about this paragraph. */
const holdsSection = (): string => {
  const start = readme.indexOf('### Workspace holds & programs');
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf('\n## ', start);
  return readme.slice(start, end === -1 ? undefined : end);
};

describe('README: workspace holds', () => {
  it('names every consumer of the hold that ccd actually ships', () => {
    // Both rungs exist, right now, in ccd — `cmd_ws_rm` dies, `cmd_ws_reap`
    // answers a named token on stdout (a die there would put a shell string
    // on a phone screen).
    expect(ccd).toMatch(/die "held: /);
    expect(ccd).toMatch(/"refused":"held"/);
    const section = holdsSection();
    expect(section).toMatch(/ws-rm/);
    expect(section).toMatch(/ws-reap/);
  });

  it('does not claim the archive gate is the only thing a hold changes', () => {
    expect(holdsSection()).not.toMatch(/one thing a hold changes/i);
  });

  it('states the gate with the polarity the code actually has', () => {
    // FIX-WAVE FINDING 8. The paragraph said the gate "gains `held !== null`
    // as an extra conjunct". The code is `if (r.held !== null) continue` — a
    // SKIP — so the conjunct is `held === null`, and as written the README
    // described a gate that auto-archives exactly the workspaces a hold exists
    // to protect and never archives released ones. The two tests above pinned
    // which consumers are named and one forbidden sentence; neither pinned the
    // conjunct, so the inversion was invisible to the very file that exists to
    // stop this paragraph drifting.
    const section = holdsSection();
    expect(section).not.toMatch(/gains\s+`held !== null`/);
    expect(section).toMatch(/`held === null`/);
    // And the spec's own words for it, so a future rewrite that drops the
    // code-shaped spelling still has to say which way round it is.
    expect(section).toMatch(/merged \*\*and unheld\*\*/);
  });

  it('does not claim the server sends the same empty-reason sentence the client does', () => {
    // Same finding's other half: the paragraph said an empty reason refuses
    // "on both the client and ccd itself, with the identical sentence", which
    // omitted the route — the ONLY enforcement for any non-PWA client, and one
    // that answers a bare 400 `bad-request` with no sentence at all.
    const section = holdsSection();
    expect(section).not.toMatch(/on both the client and ccd itself, with the identical sentence/);
    expect(section).toMatch(/bad-request/);
    // The refusal is about whitespace too, in all three layers (ccd's guard
    // strips it, the route and the composer trim) — and ccd is the layer the
    // orchestrator path actually goes through.
    expect(section).toMatch(/whitespace-only/i);
    expect(ccd).toMatch(/\$\{reason\/\/\[\[:space:\]\]\/\}/);
  });
});
