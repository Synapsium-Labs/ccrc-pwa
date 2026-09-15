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

/** The raw slice — line-anchored checks need it. Every phrase check below runs
 *  over `flat(poolsSection())` instead. */
const poolsSection = (): string =>
  passage('README, the account-pools section', readme(),
    '### Account pools: tagging a project to a set of accounts',
    '\n### Login screens get no keystrokes');

describe('README: where the project tag lives (spec §4, §5.4.1)', () => {
  it('states the rule and that untagged means unconstrained', () => {
    const s = flat(poolsSection());
    expect(s, 'the section never states the rule itself').toMatch(/either side is untagged or/i);
    expect(s, 'ruling 3 is the one thing every operator must read here').toMatch(/unconstrained/);
    expect(s).toMatch(/tagging only ever tightens/i);
  });

  it('names the marker path ccd actually reads, and the verb that writes it', () => {
    const s = flat(poolsSection());
    expect(s).toContain('~/.cc-sessions/pools/');
    expect(s).toContain('ccd project-pool');
    // Grounded: one bash constant, one server constant, same directory name.
    expect(ccd(), 'ccd no longer keeps its pools directory where the README says')
      .toMatch(/POOLS_DIR="\$REG\/pools"/);
    expect(read('server/src/pools.ts'), 'the server no longer spells the directory once')
      .toMatch(/POOLS_DIR_NAME = 'pools'/);
  });

  it('keeps the four reader words distinct — unreadable is never untagged', () => {
    const s = flat(poolsSection());
    for (const w of ['untagged', 'malformed', 'unreadable']) {
      expect(s, `the section never names the \`${w}\` state`).toContain(w);
    }
    // The overloaded-null defect, stated as prose can state it: no sentence may
    // say an unreadable or malformed tag is TREATED as untagged.
    for (const sentence of sentencesOf(s)) {
      if (/\b(unreadable|malformed)\b/.test(sentence)) {
        expect(sentence, `a sentence folds an undecidable tag into untagged: "${sentence.trim()}"`)
          .not.toMatch(/\b(reads?|treated) as untagged\b/i);
      }
    }
    // Grounded in the reader that produces the four words.
    expect(ccd(), 'ccd has no four-word pool reader — re-decide this paragraph')
      .toMatch(/_project_pool_state\(\)/);
  });

  it('says the server refuses and forecasts but never places or writes', () => {
    const s = flat(poolsSection());
    expect(s).toMatch(/never places/);
    expect(s).toMatch(/never writes the marker/);
    // Grounded: the server's pools module is a READER. A write appearing here is
    // the change that makes the sentence false.
    expect(read('server/src/pools.ts'), 'server/src/pools.ts now writes — the README claim is false')
      .not.toMatch(/writeFile|io\.write/);
  });

  it('says the tag outlives every workspace and survives an uninstall', () => {
    const s = flat(poolsSection());
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'forget']) {
      expect(s, `the section does not name \`${verb}\` among the verbs that leave the tag alone`)
        .toContain(verb);
    }
    expect(s).toContain('ccrc uninstall');
    expect(s, 'the section does not say the tag is outside the backup set').toMatch(/not backed up/i);
    // Grounded: the uninstaller does not name `pools` at all, which is exactly
    // why the tag survives it.
    expect(read('ccd/ccrc'), 'ccrc now touches pools/ — the README claim that uninstall leaves it is false')
      .not.toMatch(/pools/);
  });
});

describe('README: what a retag does, and when (spec §5.5.4, §5.8, §5.7, §5.11, §15)', () => {
  /** Both gate figures, read off ccd rather than remembered — the bash-floor
   *  idiom in `ccrc-update.test.ts`: a bumped constant must move the prose. */
  const cooldowns = (): { swap: string; block: string } => {
    const s = /^SWAP_COOLDOWN=(\d+)/m.exec(ccd());
    const b = /^SWAPBLOCK_COOLDOWN=(\d+)/m.exec(ccd());
    expect(s, 'ccd no longer spells SWAP_COOLDOWN — this derivation is over nothing').not.toBeNull();
    expect(b, 'ccd no longer spells SWAPBLOCK_COOLDOWN — this derivation is over nothing').not.toBeNull();
    return { swap: s![1]!, block: b![1]! };
  };

  it('states the two gates a retag waits on, with the numbers ccd actually enforces', () => {
    const s = flat(poolsSection());
    const { swap, block } = cooldowns();
    expect(s, `the timing paragraph does not state the ${swap}s swap cooldown`).toContain(swap);
    expect(s, `the timing paragraph does not state the ${block}s refusal cooldown`).toContain(block);
    expect(s).toContain('SWAP_COOLDOWN');
    expect(s).toContain('SWAPBLOCK_COOLDOWN');
    // The three exceptions to "it waits", each named.
    expect(s, 'hard-blocked sessions do not wait; the paragraph must say so').toMatch(/hard-blocked/);
    expect(s, 'a hold defers a retag; the paragraph must say so').toMatch(/held|hold/);
    expect(s, 'the visible waiting state is the one an operator can act on').toContain('data-offpool');
    // Grounded in the PWA cell that renders it.
    expect(read('pwa/src/fleet/SessionLine.tsx'),
      'the PWA no longer marks an off-pool row — the README describes a cell that is gone')
      .toContain('data-offpool');
  });

  it('describes the strand with the vocabulary ccd actually writes, and three remedies', () => {
    const s = flat(poolsSection());
    expect(s).toContain('cc swap STRANDED');
    expect(s).toContain('stranded');
    expect(s).toContain('unstranded');
    // The three remedies of ruling 6, each identifiable.
    expect(s, 'remedy 1 (enable a lane) is missing').toMatch(/-disabled/);
    expect(s, 'remedy 2 (tag another account into the pool) is missing')
      .toMatch(/tag another account/i);
    expect(s, 'remedy 3 (untag the project) is missing').toMatch(/--clear|untag the project/);
    // Grounded: the marker, the clear and the banner text all exist.
    expect(ccd()).toMatch(/_strand_mark/);
    expect(ccd()).toMatch(/_strand_clear/);
    expect(ccd(), 'the notify banner text changed — the README quotes a sentence nobody sends')
      .toContain('cc swap STRANDED: ');
  });

  it('keeps --cross-pool and --force distinct, and states which one sticks', () => {
    const s = flat(poolsSection());
    expect(s).toContain('--cross-pool');
    expect(s).toContain('--force');
    for (const sentence of sentencesOf(s)) {
      if (/--force/.test(sentence)) {
        expect(sentence, `--force is described as a pool override: "${sentence.trim()}"`)
          .not.toMatch(/cross(es|ing)? (a )?pool/i);
      }
    }
    expect(s, 'the swap/prefer split (spec §14 O1) is the thing operators get wrong')
      .toMatch(/prefer --cross-pool/);
    expect(s, 'automatic moves never cross — the sentence that keeps ruling 8 honest')
      .toMatch(/never cross/i);
    // Grounded: the marker and its end-of-life log verb.
    expect(ccd()).toMatch(/crosspool/);
    expect(ccd(), 'the crossing no longer ends with a logged reason').toMatch(/crosspool-ended/);
  });

  it('names the skew states an operator can see, and the six rollout steps', () => {
    const s = flat(poolsSection());
    for (const code of ['409', '501', '502', '503']) {
      expect(s, `the skew table never mentions ${code}`).toContain(code);
    }
    expect(s, 'the transient the two lanes produce is the one that gets reported as a fault')
      .toContain('divergent');
    expect(s, 'the agent lane goes first — the ordering rule this whole feature rides on')
      .toMatch(/deploy\.sh agent/);
    // Six steps, numbered — over the RAW slice, because this one is anchored to
    // the start of a line and flattening would destroy the anchor.
    const raw = poolsSection();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(raw, `rollout step ${n} is missing`).toMatch(new RegExp(`^${n}\\. `, 'm'));
    }
  });
});

describe('server/src/config.ts: the roster is SEEDED once per box (D-1687)', () => {
  /** The docstring, flattened out of its ` * ` prefixes — a hard-wrapped claim
   *  routinely spans a line break, and a literal containment check would miss
   *  it: a false GREEN on a negative assertion, which is worse than a false
   *  red. */
  const doc = (): string =>
    flat(passage('config.ts, the loadRoster docstring', read('server/src/config.ts'),
      'Reads and validates `accountsPath`', 'function loadRoster')
      .replace(/\n\s*\*\s?/g, ' '));

  it('no longer claims deploy ships the same accounts.json to both boxes', () => {
    expect(doc()).not.toMatch(/ships? the same `accounts\.json` to both boxes/);
    // The claim, not just its spelling: no sentence may pair the deploy with
    // both boxes as if one file reached them.
    for (const s of sentencesOf(doc())) {
      if (/\bdeploy\b/.test(s) && /both boxes/.test(s)) {
        expect(s, `the docstring still describes one file reaching two boxes: "${s.trim()}"`)
          .toMatch(/seed|never overwrit|hand-owned/i);
      }
    }
  });

  it('names the seed that actually ships it, and deploy.sh still behaves that way', () => {
    expect(doc()).toMatch(/ship_roster/);
    const deploy = read('deploy/deploy.sh');
    // The create-if-missing guard IS the fact the docstring now states.
    expect(deploy, 'ship_roster no longer seeds create-if-missing — the docstring is false again')
      .toMatch(/ship_roster\(\) \{[\s\S]{0,400}?\[ -f ~\/\.ccrc\/accounts\.json \]/);
  });
});

// D-1688 AS FOUND, NOT AS PLANNED. The plan's Task 6 rewrote this comment to say
// the telemetry gap was still open and only its stated CAUSE was wrong ("what is
// missing is the CONSUMER — this loop never reads it"). Between the plan (at
// 2b15144e) and this wave, the account wave CLOSED the gap: `_ws_least_loaded`
// now calls `_account_measured` (ccd/ccd), and the comment was rewritten in the
// same change to record it, citing D-2596. So the finding is discharged and
// writing the plan's prescribed text would REGRESS an accurate comment into a
// false one. The pin is therefore inverted: it holds the CLOSURE rather than the
// gap, and it holds the correction against being re-asserted as a live claim.
describe('ccd: accounts.sh carries telemetry and the consumer LANDED (D-1688)', () => {
  const header = (): string =>
    flat(passage('ccd, the _ws_least_loaded header comment', ccd(),
      '_ws_least_loaded() {', 'local best=""').replace(/^\s*#\s?/gm, ''));
  const body = (): string =>
    passage('ccd, the _ws_least_loaded body', ccd(), 'local best="" bs=1000', '\n}', 80);

  it('never asserts, as a LIVE claim, that the generated file carries no telemetry', () => {
    // The false sentence is allowed to survive as a QUOTE of what this comment
    // used to say — that is how the correction explains itself. What is
    // forbidden is asserting it. Any sentence carrying the old wording must
    // also carry the marker that makes it historical.
    for (const s of sentencesOf(header())) {
      if (/no telemetry field at all|nothing to consult/.test(s)) {
        expect(s, `the stale telemetry claim is being asserted again, not quoted: "${s.trim()}"`)
          .toMatch(/used to|has been false|no longer|stale|earlier version/i);
      }
    }
  });

  it('names the array that carries it, and the generator still emits that array', () => {
    expect(header(), 'the comment does not name the array bash can actually read')
      .toMatch(/CCRC_MEASURED/);
    expect(emittedNames(), 'the generator stopped emitting CCRC_MEASURED — rewrite this comment again')
      .toContain('CCRC_MEASURED');
  });

  it('the gap the comment declares CLOSED is still closed — this loop consumes the roster answer', () => {
    // Two-sided, the same way the plan's version was, but pointing the other
    // way. The comment now says the consumer LANDED. If a future change removes
    // it, this reds — and it should: the comment would then be describing a
    // closure that has reopened, which is exactly how it went wrong the first
    // time. Rewrite the comment in the same commit that reopens it.
    expect(body(), 'the loop no longer consults the roster on telemetry — the comment above it is stale again')
      .toMatch(/_account_measured/);
    expect(ccd(), 'ccd has no _account_measured — the comment names a helper that is gone')
      .toMatch(/_account_measured\(\) \{/);
  });
});
