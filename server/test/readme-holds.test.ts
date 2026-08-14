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

/**
 * Fix round 2 (task 14 follow-up, Minor #2): the plan owner's own count —
 * this branch has now caught prose overclaiming FOUR times, twice in text
 * an implementer wrote. This section is what makes the fifth one a red
 * suite instead of a reviewer's patience: the `--surface` bullet in "Agent
 * security model" > Exec whitelist, pinned the same way the holds section
 * above is — sliced by its own markers, checked against the code, not
 * against a fixed sentence a future edit could silently falsify again.
 */
const execWhitelistBullet = (): string => {
  const start = readme.indexOf('- **Exec whitelist**:');
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf('- **Path whitelist**:', start);
  expect(end).toBeGreaterThan(start);
  return readme.slice(start, end);
};

/** Sentence-split, not the whole bullet — an absolute word ("every"/"all")
 *  used correctly three paragraphs away from `pwa`/`cli` must not trip a
 *  check aimed at one specific false pairing. Split on `.`/`:` followed by
 *  whitespace, which is coarse but keeps each claim in its own window. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.:])\s+/);

describe('README: the --surface bullet', () => {
  // Fix round 3 (task 14 follow-up, Minor #4): round 2's two negative pins
  // matched the exact WRONG SENTENCE, not the underlying claim — a
  // reworded re-overclaim ("all API stops record pwa", "cli is exclusive
  // to a self-stop") would have sailed past both while still being false.
  // Widened to catch a WIDER set of phrasings of the same two claims.
  //
  // STATED HONESTLY (fix round 4, task 14, Minor #5 — round 3's own comment
  // here claimed these checks "do not depend on round 2's specific phrasing
  // surviving verbatim", i.e. implied they were reword-proof; the reviewer
  // then wrote a DIFFERENT overclaim — "always stamps … without exception",
  // "belongs to … and to nothing else" — that used none of the words either
  // regex looked for, and all 11 tests in this file stayed green against
  // it). These are TEXT scans over a finite word list, exactly the class
  // `single-definition.test.ts` names its own limit for: "these scan TEXT,
  // deliberately… A determined author can evade [one]… The bar is 'a
  // reasonable person adding a copy in the ordinary way is stopped before
  // review', not 'unforgeable'." Same bar here, not a stronger one — the
  // word lists below were widened once, with the specific words the
  // reviewer's own bypass used, and will need widening again the next time
  // someone finds a synonym neither list has yet.
  it('does not claim every/all/always API-reached stops record/stamp pwa, in a wide set of phrasings', () => {
    const bullet = execWhitelistBullet();
    for (const s of sentencesOf(bullet)) {
      if (/\b(every|all|any|always)\b/i.test(s) && /\bpwa\b/i.test(s)
          && (/\brecord/i.test(s) || /\bstamp/i.test(s))) {
        expect(s, `unqualified absolute claim: "${s.trim()}"`).toMatch(/ws-rm/);
      }
      // "without exception" carries the same claim with neither trigger
      // word above present.
      if (/\bwithout exception\b/i.test(s) && /\bpwa\b/i.test(s)) {
        expect(s, `unqualified absolute claim: "${s.trim()}"`).toMatch(/ws-rm/);
      }
    }
    // And the exception is still actually named somewhere — a corrected
    // sentence that goes silent on it is still an overclaim by omission.
    expect(bullet).toMatch(/ws-rm/);
    expect(bullet.toLowerCase()).toMatch(/reap/);
    expect(bullet).toMatch(/forget/);
    expect(bullet).toMatch(/archiveMerged/);
    // Grounded in the real default `_ws_unsupervise` falls back to.
    expect(ccd).toMatch(/surface="\$\{2-ccd\}"/);
  });

  it('does not claim cli is reserved/exclusive/only/nothing-else for a session stopping itself', () => {
    for (const s of sentencesOf(execWhitelistBullet())) {
      if (/\bcli\b/i.test(s)) {
        expect(s, `possible exclusivity claim: "${s.trim()}"`)
          .not.toMatch(/\b(reserved|exclusive(ly)?|only|nothing else|belongs to)\b/i);
      }
    }
  });

  it('states the check is CONDITIONAL on the deployed ccd advertising the capability', () => {
    // The hazard this whole round exists to close: an unconditional
    // `--surface` sent to an old ccd parses as a two-argument stop of a
    // session named `<id>---surface` and exits 0 having touched nothing.
    // The bullet must say the send is gated, name the mechanism, and the
    // mechanism must actually exist in the source it claims.
    const bullet = execWhitelistBullet();
    expect(bullet).toMatch(/conditional/i);
    expect(bullet).toMatch(/stop-surface/);
    expect(bullet).toMatch(/stopSurfaceSupported/);
    expect(ccd).toMatch(/echo stop-surface/);
    const ccdargv = readFileSync(path.join(root, 'server', 'src', 'ccdargv.ts'), 'utf8');
    expect(ccdargv).toMatch(/export function stopSurfaceSupported/);
  });

  // Fix round 3, Important #2/#3 — the two corrections that made "never a
  // call that silently does nothing" (kept, deliberately, from round 2's
  // text) actually true. Grounded in the real inverted default and the
  // real local-mode probe, not merely asserted in prose.
  it('states the no-evidence default is INVERTED for this capability, and says why', () => {
    const bullet = execWhitelistBullet();
    expect(bullet).toMatch(/opposite/i);
    expect(bullet).toMatch(/silent success/i);
    const ccdargv = readFileSync(path.join(root, 'server', 'src', 'ccdargv.ts'), 'utf8');
    const fn = ccdargv.slice(ccdargv.indexOf('export function stopSurfaceSupported'));
    expect(fn, 'the no-evidence branch must refuse, not permit').toMatch(/if \(verbs === null\) return false;/);
  });

  it('states local mode measures its OWN ccd, not merely the remote one', () => {
    const bullet = execWhitelistBullet();
    expect(bullet).toMatch(/local/i);
    expect(bullet).toMatch(/boot/i);
    const indexTs = readFileSync(path.join(root, 'server', 'src', 'index.ts'), 'utf8');
    expect(indexTs).toMatch(/readLocalCcdCaps/);
    const localcaps = readFileSync(path.join(root, 'server', 'src', 'localcaps.ts'), 'utf8');
    expect(localcaps).toMatch(/export async function readLocalCcdCaps/);
  });

  it('names the rollback window honestly — bounded, not zero', () => {
    // The one edge the inversion narrows but cannot close: an old ccd
    // exits 0 on the bad argv, so there is no failure to trigger an early
    // re-probe. The bullet must say "60" (CAPS_REFRESH_MS) and must NOT
    // claim the window is instant or the gate is total.
    const bullet = execWhitelistBullet();
    expect(bullet).toMatch(/rollback/i);
    expect(bullet).toMatch(/60/);
    expect(bullet).not.toMatch(/\binstant(ly)?\b/i);
    const watchTs = readFileSync(path.join(root, 'server', 'src', 'watch.ts'), 'utf8');
    expect(watchTs).toMatch(/CAPS_REFRESH_MS\s*=\s*60_000/);
  });

  it('the grant it describes (a bare one-token `stop` prefix) is the grant that actually ships', () => {
    const whitelist = readFileSync(path.join(root, 'agent', 'src', 'whitelist.ts'), 'utf8');
    // Loose but load-bearing: `['stop']` appears as its own grant entry, not
    // widened to require a flag the way ws-reap/ws-rename do.
    expect(whitelist).toMatch(/\[\s*'stop'\s*\]/);
    const bullet = execWhitelistBullet();
    expect(bullet).toMatch(/bare one-token/);
  });
});
