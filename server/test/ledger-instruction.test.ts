// server/test/ledger-instruction.test.ts
// The LIVE-INSTRUCTION surfaces for getting a deviation number: root CLAUDE.md's
// ledger bullet, CONTRIBUTING.md's ledger paragraph, and the account-provisioning
// spec's section 14. Merged PLANS are history and deliberately out of reach here
// (operator ruling).
//
// This is three ANCHORED PASSAGES, not a corpus scanner. topology-clean.test.ts's
// FORBIDDEN table is the corpus ratchet, and its `scope?` docstring (:216-219)
// states "at ship NO class carries one" — a class scoped to three files would
// break a stated ship invariant of that file. box-token-census.test.ts's
// `passage()` idiom touches nothing shared, so that is the one copied.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** box-token-census.test.ts's `passage()` helper, copied for its REASON as much as its
 *  shape: an anchor that stopped matching yields '', and '' satisfies every
 *  negative assertion below it. This tree has been bitten by that twice.
 *
 *  A THIRD case, measured 2026-09-04 (D-1443), and the reason both terminators
 *  below are now DISTINCTIVE literals rather than `'\n- **'` and `'\n**Do'`:
 *  BOTH anchors can exist and the slice still be wrong. `indexOf` stops at the
 *  FIRST closing anchor after the opener, so a GENERIC terminator — the next
 *  bullet, the next bold lead-in — is matched by any new bullet or paragraph
 *  written INSIDE the region. The passage silently truncates; the length check
 *  is a LOWER bound a truncated passage still clears; and every negative
 *  assertion then passes because the text it exists to catch was cut away.
 *  Measured on the live files: promoting one sentence of CLAUDE.md's ledger
 *  bullet into its own bullet collapsed that passage 2443 -> 1582 chars with
 *  all seven assertions still green, and a BY_SCANNING regression planted in
 *  the cut tail went unseen. Naming the terminator actually intended closes it
 *  — a new bullet cannot be mistaken for `Wire discipline` — and if that
 *  neighbour is renamed or moved, the existing "closing anchor is gone"
 *  assertion reds LOUDLY instead of the region quietly shrinking. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b).replace(/\s+/g, ' ');
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
  return out;
};

/** A section that runs to end of file. The spec's §14 is the LAST section (the
 *  §14 opens at :890, measured 2026-09-04 — the file's TOTAL line count stood
 *  here too and was stale within twelve minutes of being written, by a sibling
 *  commit on this same branch, so it is gone rather than refreshed: D-1445), so
 *  `passage`'s closing anchor cannot exist and would red for the wrong reason. */
const sectionToEnd = (name: string, text: string, from: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const out = text.slice(a).replace(/\s+/g, ' ');
  expect(out.length, `${name} is too short to be the section`).toBeGreaterThan(120);
  return out;
};

/** The allocator's route may be named only as history: in a sentence that says it retired. */
const ALLOCATOR = 'POST /api/ledger/deviations';
const allocatorAsInstruction = (text: string): string[] =>
  text.split(/(?<=\.)\s/).filter((s) => s.includes(ALLOCATOR) && !/retired/i.test(s));

describe('the numbering instruction (self-assigned since 2026-11-23)', () => {
  it('CLAUDE.md tells you to take a number with the helper, from 10000', () => {
    const b = passage('CLAUDE.md, the deviation-ledger bullet', read('CLAUDE.md'),
      '- **Deviation ledger (D-N):**', '\n- **Wire discipline');
    expect(b, 'the bullet does not name the helper').toContain('next-deviation');
    expect(b, 'the bullet does not state the 10000 start').toContain('10000');
    expect(allocatorAsInstruction(b), 'the bullet still sends a session to the retired allocator').toEqual([]);
    expect(b, 'the bullet no longer says how a collision is caught').toContain('deviation-refs.test.ts');
    expect(b, 'the reconciled legacy series is described as still running')
      .not.toMatch(/runs alongside/);
    expect(b, 'source cannot run ahead of the plans — deviation-refs.test.ts reds on it')
      .not.toMatch(/[Ss]ource runs ahead/);
    expect(b, 'a collision cardinal is back; the bullet names two events and the tree counts them differently elsewhere')
      .not.toMatch(/\b(two|three|four|five|six|seven|eight)\s+(incidents|collisions|times)\b/i);
  });

  it('CONTRIBUTING.md, the public-facing copy, says the same thing and no cardinal', () => {
    const p = passage('CONTRIBUTING.md, the ledger paragraph', read('CONTRIBUTING.md'),
      '**`D-N` markers in comments are the deviation ledger**',
      "\n**Don't collapse two conditions");
    expect(p, 'the public file does not name the helper').toContain('next-deviation');
    expect(p, 'the public file does not state the 10000 start').toContain('10000');
    expect(allocatorAsInstruction(p), 'the public file still sends a contributor to the retired allocator').toEqual([]);
    expect(p, 'the public file no longer says how a collision is caught').toContain('deviation-refs.test.ts');
    expect(p, 'a renumber cardinal is back; this file names no incident at all')
      .not.toMatch(/\b(two|three|four|five|six|seven|eight)\s+times\b/i);
  });

  it('the allocator-route check is LIVE — it catches an instruction and spares a retirement note', () => {
    expect(allocatorAsInstruction('You are ISSUED numbers by `POST /api/ledger/deviations`. Next.')).toHaveLength(1);
    expect(allocatorAsInstruction('The allocator (`POST /api/ledger/deviations`) retired on 2026-11-23. Next.')).toEqual([]);
  });

  it('the account-provisioning spec keeps its incident record', () => {
    // A design SPEC, imperative and present tense — not a dated note. Its
    // INCIDENT RECORD stays: the D-108..D-140 renumber is why the section
    // exists, and deleting the instruction must not take the history with it.
    const s = sectionToEnd('account-provisioning spec, section 14',
      read('docs/superpowers/specs/2026-08-21-account-provisioning-design.md'),
      '## 14. Deviations');
    expect(s, 'the incident record was deleted along with the instruction')
      .toContain('descending-order rewrite');
  });
});
