/**
 * "How fresh is fresh" is one number spelled in two files, and they cannot be
 * held equal structurally: `ccd/ccd` sources nothing from this repository, and
 * `ccd/ccd-telemetry-keepalive` is a sibling executable that sources nothing
 * from ccd. This is `pool-name-parity.test.ts`'s two-tier `exactlyOne`
 * mechanism applied to the one value the keepalive design puts in two places.
 *
 * WHY THEY MUST AGREE. `SWAP_FRESH`'s own comment calls it "telemetry younger
 * than this qualifies for pre-emptive swaps" — the tree's definition of a
 * usable reading. The keepalive asks the same question from the other side:
 * an account whose telemetry is still fresh by that definition does not need a
 * turn spent on it. Two spellings that drifted would mean the fleet spending
 * on accounts the swap lane already trusts, or trusting readings the keepalive
 * had given up on.
 *
 * The keepalive's is a DEFAULT, not a constant: `CCRC_KEEPALIVE_FRESH=7200` in
 * a systemd drop-in is the supported way to widen the interval on a box. What
 * is pinned is the shipped default, which is what an unconfigured box runs.
 *
 * TWO-TIER, NOT A SINGLE `^`-ANCHORED SCAN. A count taken only over the
 * canonical, unindented spelling answers "exactly one" by finding zero of a
 * shadowing duplicate AND zero of the canonical line it thinks it is
 * counting when a duplicate is spelled differently — measured: an indented
 * `  SWAP_FRESH=999` in `ccd/ccd`, or an indented
 * `  : "${CCRC_KEEPALIVE_FRESH:=555}"` in the keepalive, was invisible to a
 * bare `^NAME=`/`^: "..."` count while bash honours the LAST assignment at
 * runtime — a shadowing duplicate that a naive scan cannot see. So each side
 * is counted BROADLY first — tolerating indentation, and for `ccd`'s plain
 * assignment, decorating keywords (`export`/`declare`/`local`/`readonly`/
 * `typeset`); for the keepalive's parameter-expansion idiom, either quote
 * style — asserted to be EXACTLY ONE occurrence in ANY of those spellings,
 * and only THEN is that one occurrence checked against the canonical,
 * undecorated shape. A broad count of two is a shadowing duplicate; a broad
 * count of one that fails the narrow check is the single assignment that
 * exists being in the wrong spelling — not "nothing found".
 *
 * THE VALUE MUST END WHERE THE DIGITS END. `SWAP_FRESH=1800s` used to satisfy
 * a narrow regex of `/^SWAP_FRESH=([0-9]+)/` by capturing the leading digits
 * and silently ignoring the trailing unit suffix — a defect the keepalive
 * side never had, because its `\}"` must follow the digits immediately. The
 * canonical `ccd` regex below requires the digits to end at whitespace or
 * end-of-line, so a unit suffix now fails the narrow check the same way a
 * shadowing duplicate does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const CCD_CONTENT = readFileSync(CCD, 'utf8');
const KEEPALIVE = readFileSync(path.join(ROOT, 'ccd', 'ccd-telemetry-keepalive'), 'utf8');

/**
 * `pool-name-parity.test.ts`'s two-tier `exactlyOne`, generalized to take an
 * explicit broad regex alongside the canonical one — the two assignment
 * idioms here (a plain `NAME=value` line, and a `: "${NAME:=value}"`
 * parameter-expansion default) don't share one shape, so unlike that file's
 * top-level helper the broad pattern can't be derived from the narrow one by
 * reading off a bare `^NAME=` prefix; it is supplied by each call site
 * instead. The two-step CONTRACT is identical: broad count asserted to be
 * exactly one BEFORE the canonical shape is even asked about, so "found 2"
 * and "wrong spelling" stay two distinct, correctly-attributed failures.
 */
function exactlyOne(src: string, broadRe: RegExp, narrowRe: RegExp, what: string): string {
  const broad = [...src.matchAll(new RegExp(broadRe.source, 'gm'))];
  expect(broad.length, `${what}: expected exactly one occurrence, found ${broad.length}`).toBe(1);
  const canon = [...src.matchAll(new RegExp(narrowRe.source, 'gm'))];
  expect(canon.length, `${what}: the one assignment found is not in the canonical spelling`).toBe(1);
  return canon[0]![1]!;
}

/** Any indentation, any of the decorating keywords bash allows in front of a
 *  plain assignment, any value at all — this is what counts as "an
 *  assignment to SWAP_FRESH exists here", before asking whether it is the
 *  one shape this suite trusts. */
const CCD_BROAD =
  /^[ \t]*(?:(?:export|declare|local|readonly|typeset)(?:[ \t]+-[A-Za-z]+)*[ \t]+)?SWAP_FRESH=.*$/;
/** The canonical shape: column zero, no decorating keyword, and digits that
 *  end at whitespace or end-of-line — not just digits at the front. */
const CCD_NARROW = /^SWAP_FRESH=([0-9]+)(?=[ \t]|$)/;

/** Any indentation, either quote style, any value inside the braces — the
 *  broad half of the keepalive's parameter-expansion idiom. */
const KEEPALIVE_BROAD = /^[ \t]*:[ \t]+(["'])\$\{CCRC_KEEPALIVE_FRESH:=[^}]*\}\1$/;
/** The canonical shape: column zero, double-quoted, bare integer default. */
const KEEPALIVE_NARROW = /^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/;

describe('the keepalive spends on the tree’s own definition of stale', () => {
  it('ccd still declares SWAP_FRESH as a bare integer, in exactly one spelling', () => {
    expect(exactlyOne(CCD_CONTENT, CCD_BROAD, CCD_NARROW, 'ccd/ccd SWAP_FRESH')).toMatch(/^[0-9]+$/);
  });

  it('the keepalive still declares CCRC_KEEPALIVE_FRESH as a bare default, in exactly one spelling', () => {
    expect(exactlyOne(KEEPALIVE, KEEPALIVE_BROAD, KEEPALIVE_NARROW,
      'the keepalive CCRC_KEEPALIVE_FRESH default')).toMatch(/^[0-9]+$/);
  });

  it('and the two are the same number', () => {
    const swap = exactlyOne(CCD_CONTENT, CCD_BROAD, CCD_NARROW, 'ccd/ccd SWAP_FRESH');
    const keep = exactlyOne(KEEPALIVE, KEEPALIVE_BROAD, KEEPALIVE_NARROW,
      'the keepalive CCRC_KEEPALIVE_FRESH default');
    expect(Number(keep),
      'the keepalive would now spend a turn on telemetry the swap lane still calls fresh, '
      + 'or refuse to spend on telemetry the swap lane has already given up on')
      .toBe(Number(swap));
  });
});

/**
 * A SECOND "how fresh is fresh" pair, same two files, different question:
 * `_session_state` (ccd/ccd) inlines the literal `120` in its own freshness
 * comparison — `now - sup < 120` — to decide whether a supervisor heartbeat
 * is still live. `_ka_session_on` (the keepalive) reuses that exact window
 * as `KA_SESSION_FRESH`, by value, to skip a turn on an account whose only
 * session already has a running supervisor — its own header names
 * `_session_state`'s 120s window as the thing it is copying, "for the reason
 * CCRC_KEEPALIVE_FRESH above re-spells SWAP_FRESH by value". A drift here
 * would let the keepalive believe a supervisor is running past the point
 * `_session_state` itself gives up on it, or the reverse.
 *
 * `ccd/ccd` never binds this value to a name — the comparison is inlined —
 * so unlike SWAP_FRESH above, the broad tier here matches the COMPARISON
 * SHAPE itself (`sup` immediately followed by `<` and digits, tolerant of
 * whitespace), not an assignment; the keepalive's `KA_SESSION_FRESH=120`
 * IS a plain assignment, so its pair reuses CCD_BROAD/CCD_NARROW's exact
 * shape from above, renamed to the variable it actually declares.
 */
const CCD_SESSION_BROAD = /\bsup\b[ \t]*<[ \t]*([0-9]+)/;
const CCD_SESSION_NARROW = /now - sup < ([0-9]+)(?=[^0-9]|$)/;

const KA_SESSION_BROAD =
  /^[ \t]*(?:(?:export|declare|local|readonly|typeset)(?:[ \t]+-[A-Za-z]+)*[ \t]+)?KA_SESSION_FRESH=.*$/;
const KA_SESSION_NARROW = /^KA_SESSION_FRESH=([0-9]+)(?=[ \t]|$)/;

describe('the keepalive borrows _session_state’s own notion of a live supervisor', () => {
  it('ccd still compares sup against 120 as a bare integer, in exactly one spelling', () => {
    expect(exactlyOne(CCD_CONTENT, CCD_SESSION_BROAD, CCD_SESSION_NARROW,
      'ccd/ccd sup freshness comparison')).toMatch(/^[0-9]+$/);
  });

  it('the keepalive still declares KA_SESSION_FRESH as a bare integer, in exactly one spelling', () => {
    expect(exactlyOne(KEEPALIVE, KA_SESSION_BROAD, KA_SESSION_NARROW,
      'the keepalive KA_SESSION_FRESH')).toMatch(/^[0-9]+$/);
  });

  it('and the two are the same number', () => {
    const ccdFresh = exactlyOne(CCD_CONTENT, CCD_SESSION_BROAD, CCD_SESSION_NARROW,
      'ccd/ccd sup freshness comparison');
    const kaFresh = exactlyOne(KEEPALIVE, KA_SESSION_BROAD, KA_SESSION_NARROW,
      'the keepalive KA_SESSION_FRESH');
    expect(Number(kaFresh),
      'the keepalive would now call a supervisor fresh past the window _session_state itself gives up on it, '
      + 'or give up on a supervisor _session_state still calls live')
      .toBe(Number(ccdFresh));
  });
});
