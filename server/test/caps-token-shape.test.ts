// Every token `ccd cmd_caps` prints must survive `parseCcdCaps`.
//
// WHY THIS FILE EXISTS. Build 9a added `echo lifecycle-v1` and
// `echo actor-flags-v1` to `cmd_caps`, reasoning — in `ccd/ccd`'s own comment
// and again in `agent/test/caps.test.ts` — that a token "shaped like a verb
// (lowercase + hyphens)" needs no new parsing because it "passes the agent's
// existing `/^[a-z][a-z-]*$/` filter unchanged". That was TRUE of
// `stop-surface` and FALSE of both new tokens: the class had no digits, so
// `parseCcdCaps` silently dropped them. `lifecycleState` then read the absence
// as a measured fact and answered `unavailable` — a health surface asserting
// that a box's ccd does not write the journal, about a ccd that does.
//
// It survived every existing suite because NOTHING crossed real `cmd_caps`
// text through the real parser:
//   - server tests inject `ccdVerbs` as literal arrays;
//   - `agent/test/caps.test.ts` writes its own stub ccd and only ever proves
//     `stop-surface`, the one token with no digit in it;
//   - `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` names all three, but
//     compares them against the DISPATCHER, never against the filter.
// Three mechanisms, each correct about its own question, and the seam between
// them unguarded. This file is that seam.
//
// DERIVED, NOT HAND-KEPT. The token list is read out of `ccd/ccd`'s `cmd_caps`
// body, so a token added there is covered here the day it lands — the house
// rule that runtime lists come from their source rather than a second copy
// (`PR_REASONS = Object.keys(PR_REASON_MAP)`). A hand-maintained list here
// would reproduce exactly the drift that let this through.
// `CCD` imported, rather than re-deriving the script's path here: it is
// single-sourced in ccdWsHelpers.ts and `single-definition.test.ts` goes red
// on a second spelling. That guard caught this file twice on the way in —
// once for the join, once for a comment that quoted the join's arguments
// adjacently, which is the false positive that guard's own prose warns about.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCcdCaps } from '../../shared/agent-protocol.js';
import { CCD } from './ccdWsHelpers.js';

/** The literal tokens `cmd_caps` prints unconditionally, read from ccd itself.
 *  Only bare `echo <token>` lines inside the function body — anything
 *  interpolated or conditional is a runtime question this static read cannot
 *  answer, and pretending otherwise would be a worse lie than omitting it. */
function emittedCapsTokens(): string[] {
  const src = readFileSync(CCD, 'utf8').split('\n');
  const start = src.findIndex((l) => /^cmd_caps\(\)/.test(l));
  if (start < 0) throw new Error('ccd/ccd no longer defines cmd_caps() at column 0 — re-anchor this test');
  const end = src.findIndex((l, i) => i > start && /^\}/.test(l));
  if (end < 0) throw new Error('ccd/ccd: cmd_caps() has no closing brace at column 0 — re-anchor this test');
  const toks = src.slice(start, end)
    .map((l) => /^\s*echo\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]!);
  if (toks.length === 0) throw new Error('ccd/ccd: cmd_caps() printed no bare `echo <token>` lines — re-anchor this test');
  return toks;
}

describe('every ccd caps token survives parseCcdCaps', () => {
  it('reads a non-trivial token set out of ccd (anti-vacuity)', () => {
    const toks = emittedCapsTokens();
    // If this ever shrinks to nothing the assertions below pass vacuously.
    expect(toks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(toks).size).toBe(toks.length);
  });

  it('keeps EVERY token ccd advertises — none is silently dropped by the filter', () => {
    const toks = emittedCapsTokens();
    // The real parser, over text shaped exactly like real `ccd caps` stdout.
    const kept = parseCcdCaps(toks.join('\n') + '\n');
    const dropped = toks.filter((t) => !kept.includes(t));
    expect(dropped, `parseCcdCaps dropped ${dropped.length} of ${toks.length} tokens ccd advertises`).toEqual([]);
  });

  it('keeps the two versioned capability tokens by name', () => {
    // Named explicitly as well as derived: the derived assertion above goes
    // quiet if cmd_caps is ever restructured, and these two are the ones whose
    // loss is invisible at runtime rather than loud.
    const kept = parseCcdCaps('lifecycle-v1\nactor-flags-v1\nstop-surface\n');
    expect(kept).toEqual(['lifecycle-v1', 'actor-flags-v1', 'stop-surface']);
  });

  it('still rejects the noise the filter exists to drop', () => {
    // Widening the class to admit digits must not turn the filter off. These
    // are the shapes real `ccd caps` stdout carries around its token lines.
    const kept = parseCcdCaps([
      '', '   ', 'Usage: ccd {start|stop}', 'ERROR: something broke',
      '# a comment', '-flag', '1leading-digit', 'Capitalised', 'has space',
    ].join('\n'));
    expect(kept).toEqual([]);
  });
});
