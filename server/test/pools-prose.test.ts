// Prose that must stay TRUE about account pools: README's placement and pools
// sections, CLAUDE.md's invariant bullet, and the non-README sentences the
// design measured as false (D-1685, D-1686, D-1687, D-1688/D-2827).
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
//
// FIX ROUND 1 (review lens B) rewrote most of the assertions below. The round's
// finding, in one sentence: a free-floating `toMatch(/never places/)` holds a
// SUBSTRING, not a CLAIM — the reviewer inverted "ccd decides; the server
// refuses" in both documents and the suite stayed 25/25 green. Three rules came
// out of that and are applied throughout:
//   1. BIND THE SUBJECT. A claim about who does what is checked per sentence
//      with the actor bound to the verb (`bindsAuthority`), never as two
//      substrings that could sit in any sentence.
//   2. UNDERSTAND NEGATION. Every true sentence here is a NEGATIVE ("the server
//      never writes the marker", "neither is ever downgraded to untagged"), so a
//      naive negative regex reds the truth. Each guard therefore looks for a
//      negator BETWEEN the subject and the verb, which is what makes the
//      inverted sentence — and only the inverted sentence — red.
//   3. THE MESSAGE TEACHES THE RULE. A per-sentence guard fires on text whose
//      author could not see the constraint, so every message states the
//      constraint rather than the regex (the round's M-4 ruling: a comment in
//      README would be a request; the red is the mechanism).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

const NEGATOR = /\b(never|not|no|nor|neither)\b/i;

/** THE AUTHORITY CLAIM, BOUND TO ITS SUBJECT.
 *
 *  "`ccd` decides; the server refuses and forecasts … it never places a session
 *  and it never writes the marker" is the load-bearing sentence of this whole
 *  feature — it is what a coder reads before deciding where to put a write. It
 *  used to be pinned as `toMatch(/never places/)` plus
 *  `toMatch(/never writes the marker/)`, two substrings with no subject bound to
 *  them, and BOTH documents survived a full inversion (server decides and
 *  writes; ccd only forecasts) at 25/25 green.
 *
 *  This binds the subject instead: after every mention of `the server`, each
 *  authority verb must have a NEGATOR between it and that mention. The true
 *  sentences pass because they say "never"; the inverted ones red because they
 *  do not. A verb that sits BEFORE `the server` in the sentence — "`ccd` decides
 *  at every placement …; the server REFUSES …" — is left alone, which is the
 *  point: its subject is ccd. */
const AUTHORITY_VERB = /\b(decides|decide|places a session|places sessions|writes the marker)\b/gi;
const bindsAuthority = (where: string, sentence: string): void => {
  const i = sentence.toLowerCase().indexOf('the server');
  if (i < 0) return;
  const after = sentence.slice(i + 'the server'.length);
  for (const m of after.matchAll(AUTHORITY_VERB)) {
    expect(after.slice(0, m.index!),
      `${where}: "the server" is described as "${m[0]}" with nothing negating it. ` +
      'ccd DECIDES and WRITES; the server only refuses (409/503), forecasts and composes the ' +
      `wire. Sentence: "${sentence.trim()}"`)
      .toMatch(NEGATOR);
  }
};

/** THE NO-OVERLOADED-NULL RULE, AS PROSE CAN BREAK IT.
 *
 *  CLAUDE.md calls collapsing two conditions a caller handles differently "a
 *  defect, not style". The old guard was `not.toMatch(/(reads?|treated) as
 *  untagged/i)` — ONE spelling: "treated as untagged" red, "falls back to
 *  untagged" green, same defect. Widened toward the claim, and negation-aware
 *  for the same reason `bindsAuthority` is: the TRUE sentence says "neither is
 *  ever quietly downgraded to untagged", which the bare pattern would red. */
const FOLD = /\b(reads?|treated|falls? back|defaults?|downgrad\w+|counts? as)\b[^.]{0,40}\buntagged\b/gi;
const doesNotFold = (where: string, sentence: string): void => {
  for (const m of sentence.matchAll(FOLD)) {
    expect(sentence.slice(0, m.index!),
      `${where}: an undecidable tag is folded into untagged ("${m[0].trim()}") with nothing ` +
      'negating it. `unreadable` and `malformed` are NOT `untagged` — on a tag nobody can read, ' +
      `nobody decides. Sentence: "${sentence.trim()}"`)
      .toMatch(NEGATOR);
  }
};

/** "A manual verb overrides X" has to say what it does NOT override. Run over
 *  BOTH prose sections: narrowing `placementSection()` to fix its attribution
 *  (it used to swallow the pools section whole, so a red there named a heading
 *  180 lines away) would otherwise have left the pools section unguarded. */
const noUnqualifiedOverride = (where: string, section: string): void => {
  for (const s of sentencesOf(flat(section))) {
    if (/\b(bypass(es|ed)?|ignor(es|ed)?|overrides?)\b/i.test(s)
        && /`ccd (start|swap|prefer)`/.test(s)) {
      expect(s,
        `${where}: a manual verb is described as overriding without naming what it does NOT `
        + 'override. `ccd start`/`swap`/`prefer` override the -disabled gate, never the pool rule '
        + `— that takes --cross-pool. Sentence: "${s.trim()}"`)
        .toMatch(/--cross-pool/);
    }
  }
};

const placementSection = (): string =>
  // Terminated at the pools section, not at `### Login screens`: the pools
  // section sits BETWEEN the two, so the old terminator made this passage a
  // superset of `poolsSection()` and reds planted in the pools section were
  // reported against the disabled-marker section 180 lines away.
  passage('README, the disabled-marker section', readme(),
    '### Placement honors the disabled marker', '\n### Account pools: tagging a project');

const poolsSection = (): string =>
  passage('README, the account-pools section', readme(),
    '### Account pools: tagging a project to a set of accounts',
    '\n### Login screens get no keystrokes');

/** Every .ts under a root, recursively — the shape `single-definition.test.ts`
 *  uses to scan a whole surface rather than one module. */
const tsFilesUnder = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`);
    }
  };
  walk(rel);
  return out;
};

/** THE SERVER-NEVER-WRITES CLAIM, GROUNDED OVER THE SERVER.
 *  The old grounding scanned `server/src/pools.ts` alone — a 325-line READER
 *  module — so adding a `writeFileSync(…/pools/<project>)` to the tag route in
 *  `server.ts` left the claim green. The claim's surface is the whole server. */
const poolWritesInServer = (): string[] => {
  const hits: string[] = [];
  for (const rel of tsFilesUnder('server/src')) {
    const text = read(rel);
    for (const m of text.matchAll(
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|rmSync|renameSync|mkdirSync)\b/g)) {
      const window = text.slice(m.index!, m.index! + 200);
      if (/pools/i.test(window)) hits.push(`${rel}: ${m[1]!} … ${window.split('\n')[0]!.trim()}`);
    }
  }
  return hits;
};

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

/** The four words `_project_pool_state` actually answers, read off its own body
 *  rather than listed here. The old check hardcoded THREE of the four and
 *  grounded them only in the function's EXISTENCE. Comment lines are dropped
 *  first: one of them contains `echo pool-a > pools/demo` as an example. */
const readerWords = (): string[] => {
  const body = passage('ccd, _project_pool_state', ccd(),
    '_project_pool_state() {', '\n# An account is a legal AUTOMATIC destination', 400);
  const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const words = [...new Set([...code.matchAll(/\becho\s+"?([a-z]+)/g)].map((m) => m[1]!))];
  expect(words.sort(), 'the four-word reader changed its vocabulary — re-decide the prose that quotes it')
    .toEqual(['malformed', 'named', 'unreadable', 'untagged']);
  return words;
};

/** The two refusal codes, read off the route that sends them. They were three
 *  bare literals in the prose and three bare literals here, so a route that
 *  moved 409 → 422 would leave README false and this suite green. */
const refusalCodes = (): { mismatch: string; unreadable: string } => {
  const p = passage('server.ts, refusePool', read('server/src/server.ts'),
    'const refusePool = (', '\n  const runCcdOr502', 150);
  const m = /'pool-mismatch'\s*\?\s*reply\.code\((\d+)\)/.exec(p);
  const u = /reply\.code\((\d+)\)\.send\(\{ ok: false, error: 'pool-unreadable'/.exec(p);
  expect(m, 'refusePool no longer answers pool-mismatch with a literal code').not.toBeNull();
  expect(u, 'refusePool no longer answers pool-unreadable with a literal code').not.toBeNull();
  return { mismatch: m![1]!, unreadable: u![1]! };
};

/** The four groundings both the README describe and the CLAUDE.md describe make.
 *  They were written out twice, verbatim — and `single-definition.test.ts`
 *  cannot see the duplication, because `server/test` is deliberately not one of
 *  its four ROOTS, so nothing would ever have flagged a third copy. */
const groundedInShippedMechanism = (): void => {
  expect(ccd(), 'ccd relocated its pools directory — the prose names a path that is gone')
    .toMatch(/POOLS_DIR="\$REG\/pools"/);
  expect(ccd(), 'the four-word reader is gone').toMatch(/_project_pool_state\(\)/);
  expect(read('server/src/pools.ts'), 'the server no longer spells the directory once')
    .toMatch(/POOLS_DIR_NAME = 'pools'/);
  expect(poolWritesInServer(),
    'the server now writes something under the pools directory — the prose says it never writes the marker')
    .toEqual([]);
};

describe('README: manual placement is not a blanket override (spec §11 row 52)', () => {
  it('no longer says the manual verbs bypass the gate entirely', () => {
    expect(flat(placementSection())).not.toMatch(/bypasses the gate entirely/);
  });

  it('does not claim a manual verb bypasses placement policy, in a wider set of phrasings', () => {
    // The literal above is one spelling of the claim. This is the claim itself:
    // any sentence that names a manual verb AND an overriding word has to say
    // what it does NOT override, or it is the same overclaim reworded. Checked
    // over the pools section too, so a planted overclaim is caught wherever it
    // lands and is reported against the section it is actually in.
    noUnqualifiedOverride('README, the disabled-marker section', placementSection());
    noUnqualifiedOverride('README, the account-pools section', poolsSection());
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

describe('README: the roster-side account facts (D-1686, D-2828)', () => {
  const entrySentence = (): string =>
    flat(passage('README, the account-entry sentence', readme(),
      'An account entry is', '**Getting the file onto a box.**'));
  const projectionParagraph = (): string =>
    flat(passage('README, the projection paragraph', readme(),
      '`accounts.sh` is a pure projection', 'Nothing hand-edits it'));

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

  it('names EXACTLY the symbols the generator emits — set equality, both directions', () => {
    // Was one-way (README ⊇ emitted), so deleting an emission left README
    // naming a symbol nothing emits, green. The paragraph's own claim is
    // "the whole emitted surface", which is an equality.
    const listed = [...projectionParagraph().matchAll(/`(CCRC_[A-Z_]+|_ccrc_[a-z_]+)`/g)]
      .map((m) => m[1]!);
    expect([...new Set(listed)].sort(),
      'the projection paragraph and the generator disagree — it claims "the whole emitted surface", '
      + 'so a symbol on either side alone is a false claim')
      .toEqual([...new Set(emittedNames())].sort());
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

describe('README: where the project tag lives (spec §4, §5.4.1)', () => {
  const stateParagraph = (): string =>
    flat(passage('README, the four-word state paragraph', readme(),
      'The file holds one token', '**Why the tag lives there.**'));

  it('states the rule and that untagged means unconstrained', () => {
    const s = flat(poolsSection());
    expect(s, 'the section never states the rule itself').toMatch(/either side is untagged or/i);
    expect(s, 'ruling 3 is the one thing every operator must read here').toMatch(/unconstrained/);
    expect(s).toMatch(/tagging only ever tightens/i);
  });

  it('pins the marker path in the SENTENCE that states the rule, not just somewhere', () => {
    // Was a section-wide `toContain`, which the bash fence satisfied on its own:
    // the rule sentence could be rewritten to `$REG/<project>.pool` — the home
    // this section REJECTS, and the namespace footgun CLAUDE.md calls
    // non-negotiable — and the suite stayed green.
    const s = flat(poolsSection());
    const rule = sentencesOf(s).find((x) => /a project is tagged by/.test(x));
    expect(rule, 'the rule sentence ("a project is tagged by …") is gone').toBeDefined();
    expect(rule!,
      'the rule sentence names a home other than the registry subdirectory. The tag lives at '
      + '~/.cc-sessions/pools/<project>; $REG/<project>.<x> collides with session `<wrapper>-<project>`')
      .toContain('~/.cc-sessions/pools/<project>');
    for (const sentence of sentencesOf(s)) {
      if (/\btagged by\b|\bthe tag lives\b/.test(sentence)) {
        expect(sentence,
          'the tag is described as living at $REG/<project>.<x> — the home this section rejects, '
          + `because session ids ARE <wrapper>-<project>. Sentence: "${sentence.trim()}"`)
          .not.toMatch(/\$REG\/<project>\./);
      }
    }
    expect(s).toContain('ccd project-pool');
    groundedInShippedMechanism();
  });

  it('names all four reader words, derived from the reader, in the paragraph that states them', () => {
    // Three defects in the old version: three hardcoded words for a four-word
    // reader; presence checked over the WHOLE section, so `unreadable` three
    // paragraphs away in the rejected-homes argument satisfied it; and the only
    // grounding was that the function EXISTS, never what it returns.
    const p = stateParagraph();
    for (const w of readerWords()) {
      expect(p, `the state paragraph never names the reader's \`${w}\` answer`).toContain(w);
    }
    for (const sentence of sentencesOf(p)) doesNotFold('README, the state paragraph', sentence);
  });

  it('says the server refuses and forecasts but never places or writes — with the subject BOUND', () => {
    const s = flat(poolsSection());
    expect(s, 'the section never says which side decides').toMatch(/`ccd` decides/);
    expect(s).toMatch(/never places/);
    expect(s).toMatch(/never writes the marker/);
    for (const sentence of sentencesOf(s)) bindsAuthority('README, the account-pools section', sentence);
    groundedInShippedMechanism();
  });

  it('says the tag outlives every workspace and survives an uninstall', () => {
    const s = flat(poolsSection());
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'forget']) {
      expect(s, `the section does not name \`${verb}\` among the verbs that leave the tag alone`)
        .toContain(verb);
    }
    expect(s).toContain('ccrc uninstall');
    expect(s, 'the section does not say the tag is outside the backup set').toMatch(/not backed up/i);
    // Grounded in the VERB the claim is about. Was a whole-file negative over an
    // ~11,800-line multi-verb CLI, so a comment above `cmd_doctor` naming
    // `pools/` reddened it with a message blaming the uninstaller — and README
    // rollout step 3 promises a doctor `pools` check, so that collision is
    // scheduled rather than hypothetical.
    const uninstall = passage('ccrc, cmd_uninstall', read('ccd/ccrc'), 'cmd_uninstall() {', '\n}', 200);
    expect(uninstall,
      'ccrc uninstall now names pools/ — the README claim that it leaves the tag standing is false')
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
    // Each figure must sit BESIDE ITS OWN NAME. A bare `toContain(swap)` let
    // SWAP_COOLDOWN move 900 → 1800 and stay green, because 1800 was already in
    // the prose as SWAPBLOCK's figure — the two checks covered for each other.
    expect(s, `the prose does not state ${swap} s beside \`SWAP_COOLDOWN\` — ccd now enforces ${swap}`)
      .toMatch(new RegExp('`SWAP_COOLDOWN`,?\\s*' + swap + '\\s*s\\b'));
    expect(s, `the prose does not state ${block} s beside \`SWAPBLOCK_COOLDOWN\` — ccd now enforces ${block}`)
      .toMatch(new RegExp('`SWAPBLOCK_COOLDOWN`,?\\s*' + block + '\\s*s\\b'));
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
      if (!/--force/.test(sentence)) continue;
      // The flag's OWN spelling contains "cross" and "pool", so mask it before
      // matching or every true sentence that mentions both flags reds. Widened
      // past "crosses a pool": "overrides the pool rule" is the same false claim
      // and used to pass.
      const probe = sentence.replace(/--cross-pool/g, '<<FLAG>>');
      expect(probe,
        '`--force` is described as a pool override. It means ONE thing — accept the transcript '
        + 'loss a swap costs. Crossing a pool is a separate decision with its own flag, and the '
        + `two compose. Sentence: "${sentence.trim()}"`)
        .not.toMatch(/\b(cross(es|ing)?|overrid\w+|bypass\w*|ignor\w+|defeats?)\b[^.]{0,30}\bpool\b/i);
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
    // The two refusal codes are DERIVED from the route that sends them; 501 and
    // 502 stay literals because they are ccd-cap and ccd-failure answers this
    // section attributes to no single line.
    const { mismatch, unreadable } = refusalCodes();
    expect(s, `the section never mentions ${mismatch}, which is what refusePool answers a mismatch with`)
      .toContain(mismatch);
    expect(s, `the section never mentions ${unreadable}, which is what refusePool answers an unreadable tag with`)
      .toContain(unreadable);
    for (const code of ['501', '502']) {
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
        expect(s,
          'the docstring describes one file reaching two boxes. `ship_roster` seeds a MISSING '
          + `accounts.json and never overwrites, so each box's copy is hand-owned. Sentence: "${s.trim()}"`)
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

// D-1688 AS FOUND, NOT AS PLANNED (D-2827). The plan's Task 6 rewrote this
// comment to say the telemetry gap was still open and only its stated CAUSE was
// wrong. Between the plan (at 2b15144e) and this wave, the account wave CLOSED
// the gap: `_ws_least_loaded` now calls `_account_measured`, and the comment was
// rewritten in the same change to record it, citing D-2596. So the finding is
// discharged and writing the plan's prescribed text would REGRESS an accurate
// comment into a false one. The pin is therefore inverted: it holds the CLOSURE
// rather than the gap, and it holds the correction against being re-asserted as
// a live claim.
describe('ccd: accounts.sh carries telemetry and the consumer LANDED (D-1688, D-2827)', () => {
  const header = (): string =>
    flat(passage('ccd, the _ws_least_loaded header comment', ccd(),
      '_ws_least_loaded() {', 'local best=""').replace(/^\s*#\s?/gm, ''));
  const body = (): string =>
    passage('ccd, the _ws_least_loaded body', ccd(), 'local best="" bs=1000', '\n}', 80);

  it('never asserts, as a LIVE claim, that the generated file carries no telemetry', () => {
    // The false sentence is allowed to survive as a QUOTE of what this comment
    // used to say — that is how the correction explains itself. What is
    // forbidden is asserting it. The marker must come BEFORE the stale wording:
    // a re-asserted live claim that happens to carry "no longer" about something
    // else LATER in the same sentence used to pass.
    for (const s of sentencesOf(header())) {
      const m = /no telemetry field at all|nothing to consult/.exec(s);
      if (!m) continue;
      const before = s.slice(0, m.index);
      expect(before,
        'the stale telemetry claim is being ASSERTED, not quoted. accounts.sh has carried '
        + 'CCRC_MEASURED since stage 2a; mark the old wording as historical (or quote it) before '
        + `stating it. Sentence: "${s.trim()}"`)
        .toMatch(/used to|has been false|no longer|stale|earlier version/i);
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

describe('deploy.sh + README: the divergent banner between the two lanes is EXPECTED', () => {
  it('the agent lane prints the note beside the fingerprint it explains', () => {
    const lane = passage('deploy.sh, the agent lane roster block', read('deploy/deploy.sh'),
      'if [ "$TARGET" = "agent" ]; then', 'THE SECOND SEED-ONCE FACT');
    expect(lane, 'the fingerprint line moved out of the agent lane').toMatch(/roster fingerprint on \$BOX/);
    expect(lane, 'the agent lane never mentions the divergence its own run produces')
      .toMatch(/divergent/);
    // It names the remedy — the OTHER lane — so the note is actionable rather
    // than merely reassuring.
    expect(lane, 'the note does not name the second lane that clears it')
      .toMatch(/deploy\/deploy\.sh/);
    // And it must not re-tell the falsehood this round removed: the server lane
    // does not COPY a roster to the other box, it restarts the server against
    // this box's own hand-owned accounts.json.
    for (const sentence of sentencesOf(flat(lane))) {
      if (/server lane/.test(sentence)) {
        expect(sentence,
          'the server lane is described as shipping or copying a roster to the other box. It does '
          + 'not: `ship_roster` seeds a MISSING accounts.json only, and the server lane restarts the '
          + `server against THIS box's own copy. Sentence: "${sentence.trim()}"`)
          .not.toMatch(/ships? the same roster|copies the roster|ships? this roster/i);
      }
    }
  });

  it('README says the same thing where it states the ordering rule', () => {
    const p = flat(passage('README, the deploy ordering paragraph', readme(),
      '**Ordering between the two targets.**', '**Restore** (manual, from the target box'));
    expect(p, 'the ordering paragraph does not mention pools').toMatch(/pool/i);
    expect(p, 'the ordering paragraph does not name the transient the two lanes produce')
      .toMatch(/divergent/);
    // What differs between the lanes is the PROJECTION, not the two
    // `accounts.json` files: on a code-only deploy they are byte-identical and
    // the fleet host simply has the new emitter's output.
    for (const sentence of sentencesOf(p)) {
      if (/divergent|between the two lanes/.test(sentence)) {
        expect(sentence,
          'the transient is attributed to the two ROSTERS differing. On a code-only deploy they are '
          + 'identical — what differs is the two PROJECTIONS, because one box has the new emitter. '
          + `Sentence: "${sentence.trim()}"`)
          .not.toMatch(/the boxes' rosters differ|the two rosters differ/i);
      }
    }
  });
});

describe('CLAUDE.md: the account-pools bullet is TRUE, not merely present', () => {
  const RAW_BULLET: [string, string] = ['- **Account pools', '\n## Coordination (Build 7) invariants'];
  const bullet = (): string =>
    flat(passage('CLAUDE.md, the account-pools bullet', read('CLAUDE.md'), ...RAW_BULLET));

  it('states the rule, the authority, and the namespace fact', () => {
    const b = bullet();
    expect(b, 'ruling 3 in five words').toMatch(/untagged = unconstrained/i);
    expect(b, 'tagging only tightens — the other half of ruling 3').toMatch(/only tighten/i);
    expect(b, 'the marker path a coder must not relocate').toContain('~/.cc-sessions/pools/<project>');
    expect(b, 'the rejected spelling has to be named to be forbidden').toContain('$REG/<project>');
    expect(b, 'ccd is the authority; the server refuses and forecasts').toMatch(/never places/i);
    expect(b, 'the four-word reader is the only reader').toMatch(/_project_pool_state/);
    expect(b, '--cross-pool is not --force').toContain('--cross-pool');
    expect(b, 'the three per-id fields purge with the row').toMatch(/purge with the row/i);
    expect(b, 'fixture pool names, so nobody types a real one').toMatch(/pool-a/);
    // The same subject-bound authority rule the README describe applies. The
    // bullet's own TITLE says "`ccd` is the authority", and inverting the body
    // (server decides and writes) used to leave this green.
    for (const sentence of sentencesOf(b)) bindsAuthority('CLAUDE.md, the account-pools bullet', sentence);
    for (const sentence of sentencesOf(b)) doesNotFold('CLAUDE.md, the account-pools bullet', sentence);
  });

  it('does not attribute the pool-name rule to a scanner that has no pool class', () => {
    // `topology-clean` has SEVEN forbidden classes and not one of them is a pool
    // name (`grep -c pool` over that suite is 0). In this file's idiom a trailing
    // `(suite)` names the mechanism holding the sentence, so citing it here
    // asserted a guard that does not exist — in a repo bound for public release,
    // against this tree's own "a comment is a request; a red suite is a
    // mechanism". The bullet must say the check is by hand for as long as that
    // is true, and this reds the day someone adds the class and forgets to.
    const scans = /\bpool\b/i.test(read('server/test/topology-clean.test.ts'));
    const b = bullet();
    if (!scans) {
      expect(b,
        'the bullet implies a ratchet holds real pool names out of the tree. topology-clean has no '
        + 'pool class, so nothing scans for them — say so, or add the class and change this sentence.')
        .toMatch(/NOTHING scans for|no pool class|by hand/i);
    }
  });

  it('is short enough to be the non-obvious rules rather than the README', () => {
    const raw = passage('CLAUDE.md, the account-pools bullet (raw)', read('CLAUDE.md'), ...RAW_BULLET);
    expect(raw.split('\n').filter((l) => l.trim() !== '').length,
      'CLAUDE.md says README is canonical — this bullet is over 12 lines').toBeLessThanOrEqual(12);
  });

  it("keeps CLAUDE.md's README size claim within 100 lines of the real file", () => {
    // This wave had to hand-bump it 2485 → 2890, which is the evidence it goes
    // stale. `oss-metadata` allows 10% (±289 lines here); this is the tighter
    // ratchet, and it lives beside the prose that moved.
    const claimed = /README\.md` \(~?([0-9,]+) lines\)/.exec(read('CLAUDE.md'));
    expect(claimed, 'CLAUDE.md no longer states the README size').not.toBeNull();
    const said = Number(claimed![1]!.replace(/,/g, ''));
    const real = readme().split('\n').length - 1;
    expect(Math.abs(said - real),
      `CLAUDE.md says ${said} lines, README.md is ${real} — re-measure it in this commit`)
      .toBeLessThanOrEqual(100);
  });

  it('is grounded in the shipped mechanism it describes', () => {
    groundedInShippedMechanism();
  });
});
