// Prose that must stay TRUE about account pools: README's placement and pools
// sections, CLAUDE.md's invariant bullet, and the three non-README sentences the
// design measured as false (D-1685, D-1686, D-1687, D-1688).
//
// The shape is `readme-holds.test.ts`'s, for its reason as much as its form:
// slice the passage by its OWN markers and check it against the SOURCE it
// describes, never against a fixed sentence a future edit could silently
// falsify. Four times before this file existed, prose in this tree overclaimed
// and no assertion held it.
//
// Terminators are DISTINCTIVE literals, never `'\n### '` or `'\n- **'` —
// `ledger-instruction.test.ts`'s D-1443 lesson: `indexOf` stops at the FIRST
// closing anchor after the opener, so a generic terminator is matched by any new
// heading or bullet written INSIDE the region; the passage silently truncates,
// the length check is a lower bound a truncated passage still clears, and every
// negative assertion then passes over text that was cut away.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The path to the ccd script is spelled in exactly ONE file in this tree and
// `single-definition.test.ts` enforces it — import the constant, never re-spell
// it here (`readme-holds.test.ts` records the same rule).
import { CCD } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const readme = (): string => read('README.md');
const ccd = (): string => readFileSync(CCD, 'utf8');

/** A passage sliced by its own markers. Both anchors must exist and the slice
 *  must be long enough to BE the passage: an anchor that stopped matching would
 *  otherwise yield '' and satisfy every negative assertion below it. */
const passage = (name: string, text: string, from: string, to: string, min = 200): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(min);
  return out;
};

/** Whitespace-flattened. EVERY multi-word assertion in this file runs over a
 *  flattened passage, because README and CLAUDE.md are hard-wrapped prose: the
 *  phrase a check looks for routinely spans a line break, and a raw
 *  `toContain`/`toMatch` would then miss it. On a NEGATIVE assertion that is a
 *  false GREEN — the exact failure mode that gets a scanner deleted — and on a
 *  positive one it is a red for the wrong reason. Line-anchored checks (the
 *  numbered rollout steps, the bullet's line count) use the raw slice. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** Sentence-split, not whole-section matching: an absolute word used correctly
 *  three paragraphs away must not trip a check aimed at one claim. Splits on
 *  `.`/`:` followed by whitespace — coarse, but it keeps each claim in its own
 *  window (`readme-holds.test.ts`'s helper, copied). Always fed a FLATTENED
 *  passage, so a sentence is one line by the time it is matched. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.:])\s+/);

const placementSection = (): string =>
  passage('README, the disabled-marker section', readme(),
    '### Placement honors the disabled marker', '\n### Login screens get no keystrokes');

describe('README: manual placement is not a blanket override (spec §11 row 52)', () => {
  it('no longer says the manual verbs bypass the gate entirely', () => {
    expect(flat(placementSection())).not.toMatch(/bypasses the gate entirely/);
  });

  it('does not claim a manual verb bypasses placement policy, in a wider set of phrasings', () => {
    // The literal above is one spelling of the claim. This is the claim itself:
    // any sentence that names a manual verb AND an overriding word has to say
    // what it does NOT override, or it is the same overclaim reworded.
    for (const s of sentencesOf(flat(placementSection()))) {
      if (/\b(bypass(es|ed)?|ignor(es|ed)?|overrides?)\b/i.test(s)
          && /`ccd (start|swap|prefer)`/.test(s)) {
        expect(s, `unqualified override claim: "${s.trim()}"`).toMatch(/--cross-pool/);
      }
    }
  });

  it('names the flag a crossing actually takes, and ccd actually has it', () => {
    expect(flat(placementSection())).toMatch(/--cross-pool/);
    // Grounded in the shipped script, not merely asserted in prose: the flag
    // exists and the refusal it overrides has its own die prefix.
    expect(ccd(), 'ccd has no --cross-pool flag — the README now describes a flag that is gone')
      .toMatch(/--cross-pool/);
    expect(ccd(), 'ccd no longer refuses a pool mismatch — re-decide this paragraph')
      .toMatch(/pool-mismatch: /);
  });
});

/** Every symbol the generator actually writes into `accounts.sh`, read off its
 *  own template rather than listed here — the same derivation discipline the
 *  roster itself is under (`single-definition.test.ts`). */
const emittedNames = (): string[] => {
  const gen = read('shared/generate.mjs');
  const names = [
    ...[...gen.matchAll(/^(CCRC_[A-Z_]+)=/gm)].map((m) => m[1]!),
    ...[...gen.matchAll(/^(_ccrc_[a-z_]+)\(\) \{/gm)].map((m) => m[1]!),
  ];
  expect(names.length, 'the accounts.sh template moved — this derivation is over nothing')
    .toBeGreaterThan(6);
  return names;
};

describe('README: the roster-side account facts (D-1686)', () => {
  const entrySentence = (): string =>
    flat(passage('README, the account-entry sentence', readme(),
      'An account entry is', '**Getting the file onto a box.**'));

  it('names EXACTLY the keys parseRoster accepts — derived from ACCOUNT_KEYS, not remembered', () => {
    const m = /const ACCOUNT_KEYS: ReadonlySet<string> = new Set\(\s*\[([^\]]*)\]/
      .exec(read('shared/roster.ts'));
    expect(m, 'the ACCOUNT_KEYS literal moved — this derivation is over nothing').not.toBeNull();
    const keys = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(keys.length, 'the ACCOUNT_KEYS literal came out empty').toBeGreaterThan(5);
    // The brace group, not the paragraph: `toContain('id')` would be satisfied
    // by the word "considered", so a per-word scan here proves almost nothing.
    const g = /An account entry is `\{([^}]*)\}`/.exec(entrySentence());
    expect(g, "the account-entry sentence no longer opens with a `{…}` key list").not.toBeNull();
    const listed = g![1]!.split(/,\s*/).map((k) => k.trim()).filter(Boolean);
    expect([...listed].sort(),
      'the README key list and ACCOUNT_KEYS disagree — one of them grew and the other did not')
      .toEqual([...keys].sort());
  });

  it('names every symbol the generator emits into accounts.sh', () => {
    const p = flat(passage('README, the projection paragraph', readme(),
      '`accounts.sh` is a pure projection', 'Nothing hand-edits it'));
    for (const n of emittedNames()) {
      expect(p, `the projection paragraph never names \`${n}\``).toContain(n);
    }
  });

  it('states which side of the roster digest each optional key falls on', () => {
    const p = flat(passage('README, the two-boxes bullet', readme(),
      'It compares the **projections**', '- **Limit telemetry is roster-driven too**'));
    expect(p, 'the digest paragraph does not say where `pool` falls').toMatch(/`pool`/);
    expect(p, 'the digest paragraph does not say where `hidden` falls').toMatch(/`hidden`/);
    // Grounded, both ways round: the generator emits pools and emits nothing
    // named for `hidden` — which is the entire content of the claim.
    expect(emittedNames().filter((n) => /pool/i.test(n)),
      'accounts.sh carries no pool emission — the README claim that pools are inside the digest is false')
      .not.toEqual([]);
    expect(emittedNames().filter((n) => /hidden/i.test(n)),
      'accounts.sh now carries hidden — the README claim that it is outside the digest is false')
      .toEqual([]);
  });
});
