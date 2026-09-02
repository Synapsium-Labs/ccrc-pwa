// Wave 5 (F5) — the L0 slice: a sixth typed refusal union, the wave-N re-kickoff,
// and the one docstring in `shared/api.ts` that stopped being true the day an
// operator could succeed a dead coordinator (D-1125, D-1126, D-1127).
//
// WHY ITS OWN FILE. `server/test/peers-claims-l0.test.ts:1-19` declares itself
// "Build 9b, wave 1 — the L0 slice", subjects peers/claims/ledger. A wave-5 union
// filed under that heading is the drift its own doctrine is about. It IS the shape
// copied here: one wave's L0 vocabulary in one place, derivation pinned before the
// guard, import purity last.
//
// WHAT THIS PINS AND WHY:
//  - `RECLAIM_REFUSE_CODES` is DERIVED from `RECLAIM_REFUSE_CODE_MAP`
//    (`RUN_REFUSE_CODE_MAP`'s idiom, `shared/api.ts:3498-3504`), so a member deleted
//    from the map cannot leave a runtime list still promising it.
//  - `isReclaimRefuseCode` narrows with `hasOwnProperty`, never `in`. That is the one
//    place this guard's shape differs from its four siblings, which all spell
//    `(CODES as readonly string[]).includes(v)` — and the difference has teeth:
//    `'toString' in RECLAIM_REFUSE_CODE_MAP` is TRUE, so an `in` mutant admits every
//    key of `Object.prototype` to a refusal vocabulary.
//  - The union is NOT a `RunRefuseCode`, as a MECHANISM rather than a docstring:
//    `server/test/coordinator-skill.test.ts:318-321` asserts every member of THAT
//    union is named somewhere in the coordinator corpus, and this door's whole
//    obligation (ruling R2) is to stay unnamed there.
//  - `programResumeKickoff` is compared against `ccd/coordinator-skill/references/
//    resume.md` §4's own code block — two speakers of one sentence, checked against
//    EACH OTHER. The literal check beside it carries
//    `pwa/test/start-program.test.tsx:114-128`'s argument over verbatim: a constant
//    compared only against itself cannot notice the text drifting off the brief.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECLAIM_REFUSE_CODES, isReclaimRefuseCode,
  RUN_REFUSE_CODES, programKickoff, programResumeKickoff, ledgerPath,
} from '../../shared/api.js';
import type { ReclaimRefuseCode } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const apiPath = path.join(root, 'shared', 'api.ts');
const resumeMd = path.join(root, 'ccd', 'coordinator-skill', 'references', 'resume.md');

/** `coordinator-skill.test.ts:605`'s helper plus the comment-marker strip: a
 *  docstring's line wrapping is not part of the claim it makes. */
const flat = (s: string): string => s.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();

describe('the sixth refusal union', () => {
  it('derives the runtime list from the map, in declaration order', () => {
    expect(RECLAIM_REFUSE_CODES).toEqual(['claimant-alive', 'no-claimant']);
  });

  it('is total in both directions at compile time', () => {
    // TS2741 here the day the union gains a member this map lacks; TS2353 the day
    // the map gains one the union does not have. `typecheck-tests.test.ts` compiles
    // this directory under `test/tsconfig.tests.json`, whose `include` carries
    // `../../shared/**/*.ts`, so this is a gate and not a comment.
    const total: Record<ReclaimRefuseCode, true> = { 'claimant-alive': true, 'no-claimant': true };
    expect(Object.keys(total)).toEqual([...RECLAIM_REFUSE_CODES]);
  });

  it('builds the list with Object.keys, never a second hand-written array', () => {
    // The `RUN_REFUSE_CODES`/`MAIL_GATES` idiom. A hand-written twin compiles, passes
    // the assertion above on the day it is written, and drifts on the next edit —
    // which is the whole reason `single-definition.test.ts` exists one ring up.
    const src = readFileSync(apiPath, 'utf8');
    expect(src).toMatch(
      /export const RECLAIM_REFUSE_CODES: readonly ReclaimRefuseCode\[\] =\s*\n?\s*Object\.keys\(RECLAIM_REFUSE_CODE_MAP\)/,
    );
  });

  it('isReclaimRefuseCode is the only narrowing door, and it refuses the near-misses', () => {
    for (const c of RECLAIM_REFUSE_CODES) expect(isReclaimRefuseCode(c), c).toBe(true);
    // `claimant-live`/`no-claimaint` are the typos a later edit actually makes;
    // `not-owner` and `unknown-session` are real members of a DIFFERENT union
    // (`CLAIM_REFUSE_CODES`) and must not be smuggled in by proximity.
    for (const near of ['claimant_alive', 'claimant-live', 'alive',
      'no-claimaint', 'claimant', 'not-owner', 'unknown-session', '']) {
      expect(isReclaimRefuseCode(near), near).toBe(false);
    }
    for (const junk of [undefined, null, 1, {}, ['claimant-alive']]) {
      expect(isReclaimRefuseCode(junk), String(junk)).toBe(false);
    }
  });

  it('refuses the prototype keys an `in` check would let through', () => {
    // The killer for the one mutation the guard's shape exists to stop. `'toString' in
    // RECLAIM_REFUSE_CODE_MAP` is TRUE — swap `hasOwnProperty.call` for `in` and a
    // route's 409 body can name `constructor` as a refusal code.
    for (const proto of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(isReclaimRefuseCode(proto), proto).toBe(false);
    }
  });

  it('is deliberately NOT a RunRefuseCode — the corpus census must never reach it', () => {
    // `coordinator-skill.test.ts:318-321` loops `RUN_REFUSE_CODES` and requires each
    // member to appear in `allSkillText`. Folding either of these two in there would
    // force the word into the coordinator corpus, and ruling R2 is that this door
    // stays unnamed in it. The docstring says so; this is the mechanism.
    for (const c of RECLAIM_REFUSE_CODES) {
      expect(RUN_REFUSE_CODES as readonly string[], c).not.toContain(c);
    }
  });

  it('both members are kebab tokens the coord scanner will actually see', () => {
    // Anti-vacuity for the arm added to `mail-routes.test.ts:469` in this same
    // commit. That scanner matches `/'([a-z]+(?:-[a-z]+)+)'/` over every `.ts` under
    // `server/src/coord`; a single-word member would need no arm at all and the arm
    // would be decoration. Renaming a member to `'alive'` reds this and nothing else.
    const KEBAB = /^[a-z]+(?:-[a-z]+)+$/;
    for (const c of RECLAIM_REFUSE_CODES) expect(KEBAB.test(c), c).toBe(true);
  });

  it('the coord kebab scanner admits them through the guard, never through NOT_CODES', () => {
    // The difference is the point, and `mail-routes.test.ts:474-481` already states
    // it for `LifecycleGapReason`: an allowlist entry accepts exactly one spelling for
    // ever, a guard accepts a member added later and still rejects a typo'd one.
    const src = readFileSync(path.join(root, 'server/test/mail-routes.test.ts'), 'utf8');
    expect(src).toContain('|| isReclaimRefuseCode(tok)');
    // …imported, not just mentioned in prose. This reads the import BLOCK rather
    // than the literal `isReclaimRefuseCode }`, which was an accidental encoding of
    // that property: it held only while the symbol happened to sit LAST in a
    // one-line import, and died the moment a second vocabulary joined that import
    // and reflowed it. `[^}]*` cannot cross a closing brace, so the capture is that
    // one specifier list — a mention in a comment between imports is not in it.
    const apiImport = /import\s*\{([^}]*)\}\s*from\s*'[^']*shared\/api\.js'/.exec(src);
    expect(apiImport, "mail-routes.test.ts no longer imports a specifier list from "
      + "'shared/api.js' — this harvest is reading a shape that moved").not.toBeNull();
    expect((apiImport as RegExpExecArray)[1]!).toContain('isReclaimRefuseCode');
    const notCodes = /const NOT_CODES = new Set\(\[([\s\S]*?)\n\s*\]\);/.exec(src);
    expect(notCodes, 'mail-routes.test.ts no longer declares `const NOT_CODES = new Set([...]);` — '
      + 'this harvest is reading a shape that moved, and a silent miss would pass everything').not.toBeNull();
    for (const c of RECLAIM_REFUSE_CODES) {
      expect((notCodes as RegExpExecArray)[1]!, c).not.toContain(`'${c}'`);
    }
  });
});

describe('the wave-N re-kickoff', () => {
  const SLUG = 'program-leverage';
  const TITLE = 'Program leverage';
  const RUN_ID = 18;
  const WAVE = 5;

  /** `resume.md` §4's own indented code block, harvested rather than retyped. */
  const briefBlock = (): string[] => {
    const lines = readFileSync(resumeMd, 'utf8').split('\n');
    const start = lines.findIndex((l) => l.startsWith('    You are the coordinator for program'));
    expect(start, 'resume.md §4 no longer opens its brief block with "You are the coordinator for '
      + 'program" at four-space indent — this harvest is reading a shape that moved').toBeGreaterThan(-1);
    const out: string[] = [];
    for (let i = start; i < lines.length && lines[i]!.startsWith('    '); i++) out.push(lines[i]!.slice(4));
    return out;
  };

  it('IS resume.md §4 with the placeholders filled — one text, two speakers', () => {
    // The runbook told a revived coordinator to be briefed BY HAND with this block
    // (`resume.md:80-87`). Wave 5 gives the text a composer, and the failure mode of
    // that move is the ordinary one: two copies, one edited. So the composer is
    // checked against the DOC, not against itself.
    const block = briefBlock();
    expect(block.length, `resume.md §4's block is ${block.length} lines, not 5`).toBe(5);
    const filled = block.join('\n')
      .replaceAll('<slug>', SLUG)
      .replaceAll('<title>', TITLE)
      .replaceAll('<run id>', String(RUN_ID))
      .replaceAll('<N>', String(WAVE));
    expect(programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE)).toBe(filled);
  });

  it('matches the brief\'s code block byte for byte', () => {
    // `pwa/test/start-program.test.tsx:114-128`'s argument, carried: the assertion
    // above compares two things that can be edited together in one commit, so it
    // cannot see the pair drifting off the brief as a pair. This is the one place
    // the brief's exact text is checked against what ships.
    expect(programResumeKickoff('build9-demo', 'Build 9: demo', 7, 3)).toBe(
      'You are the coordinator for program `build9-demo` (Build 9: demo).\n'
      + 'Its ledger is `docs/superpowers/programs/build9-demo.md`.\n'
      + 'Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read `GET /api/runs`,\n'
      + 'find run 7 at wave 3, and pick that wave up where the ledger says it\n'
      + 'stands. Do not open the run for wave 3 again, and do not open wave 1 again.',
    );
  });

  it('shares its first two lines with programKickoff — one greeting, one ledger path', () => {
    // The sibling relationship as a mechanism. A second inline ledger path was fix
    // round 1's Minor 3 on `programKickoff` (`shared/api.ts:3106` builds it from
    // `ledgerPath`); this is what stops it being reintroduced by the copy.
    const resume = programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE).split('\n');
    const start = programKickoff(SLUG, TITLE).split('\n');
    expect(resume.slice(0, 2)).toEqual(start.slice(0, 2));
    expect(resume[1]).toBe(`Its ledger is \`${ledgerPath(SLUG)}\`.`);
  });

  it('never carries the wave-1 sentence the machine kickoff hardcodes', () => {
    // The whole reason this constant exists (`resume.md:80-81`): the started-program
    // text is correct exactly once and wrong for every revive after it. A composer
    // that ends with the wave-1 sentence has silently become `programKickoff`.
    const body = programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE);
    expect(body).not.toContain('and open the run for wave 1');
    expect(body).toContain('Its run is ALREADY OPEN');
    expect(body).toContain('do not open wave 1 again');
  });
});

describe('RunSummary.claimedBy stops claiming what stopped being true', () => {
  /** The docstring, sliced between the two field declarations that bracket it —
   *  both spellings are unique in the file (measured), so this cannot drift onto a
   *  neighbour. */
  const doc = (): string => {
    const src = readFileSync(apiPath, 'utf8');
    const open = '  state: RunState;\n';
    const a = src.indexOf(open);
    const b = src.indexOf('  claimedBy: string | null;', a);
    expect(a, 'RunSummary no longer opens with `state: RunState;` — this slice moved').toBeGreaterThan(-1);
    expect(b, 'RunSummary no longer declares `claimedBy: string | null;` after it').toBeGreaterThan(a);
    return flat(src.slice(a + open.length, b));
  };

  it('is reading a real docstring — anti-vacuity before anything is asserted about it', () => {
    // A slice that came back empty passes every negative below.
    expect(doc().length).toBeGreaterThan(800);
    expect(doc()).toContain('coordinator');
  });

  /** THE SOURCE CORPUS — every `.ts`/`.tsx`/`.mjs` file the four shipped roots
   *  hold, walked FROM THE DIRECTORIES rather than typed out. Straight from
   *  `coordinator-skill.test.ts`'s `allSkillText`, whose own docstring paid for
   *  the rule at D-1000: a literal array is a PROJECTION of something real that
   *  a future change drifts away from in silence, and a comment asking the next
   *  author to keep it in sync is not a mechanism.
   *
   *  TWO CORPORA ARE DELIBERATELY OUT. `docs/` — a plan's ledger QUOTES the
   *  falsified sentence as the history of its own correction, and `CLAUDE.md`
   *  says a plan is a snapshot rather than a teaching surface, so forbidding
   *  the words there would force the ledgers to stop recording what was fixed.
   *  `ccd/` — the coordinator and worker corpora are already scanned whole by
   *  `coordinator-skill.test.ts`'s `allSkillText`, which forbids this claim's
   *  own skill-side wording corpus-wide (D-1124); a second scanner over the
   *  same files is the duplicate list this idiom exists to avoid. */
  const SOURCE_ROOTS: readonly string[] = ['shared', 'server/src', 'pwa/src', 'agent/src'];
  const SOURCE_EXT = /\.(?:ts|tsx|mjs)$/;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return SOURCE_EXT.test(e.name) ? [full] : [];
    });

  /** Each source file as (repo-relative path, comment markers stripped and
   *  whitespace collapsed). FLATTENED, because a claim is not less of a claim
   *  for having wrapped at the 80th column — and that is not a hypothetical
   *  here: the survivor this scan was widened for spelled the sentence across
   *  two `//` lines, so a plain grep for it found `shared/api.ts` and missed
   *  `pwa/src/fleet/nestFleet.ts` entirely. */
  const sources = (): { file: string; text: string }[] =>
    SOURCE_ROOTS.flatMap((r) => walk(path.join(root, r))).map((full) => ({
      file: path.relative(root, full),
      text: readFileSync(full, 'utf8')
        .replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)\s?/gm, '')
        .replace(/\s+/g, ' '),
    }));

  /** The three sentences the reclaim door falsified, in the wording each was
   *  written in. TRUNCATED where the original was longer (`rewritten by no
   *  route afterwards` -> `rewritten by no route`), the idiom
   *  `coordinator-skill.test.ts`'s `carries no copy of the pre-reclaim
   *  absolute, in EITHER corpus file` states: a negative cut short catches the
   *  claim re-added in a wording nobody predicted, where a negative quoting the
   *  full sentence catches only the sentence.
   *
   *  THE COROLLARY, and it binds the corrections themselves: a file that
   *  corrects one of these may PARAPHRASE the old claim but may never quote it.
   *  `shared/api.ts` already does that ("went on to say the column is written
   *  once and by one route"), and `nestFleet.ts`'s correction says out loud
   *  that it is doing the same and why. A correction that recites its own
   *  falsehood verbatim reds this scan, which is the right answer: a reader
   *  greps for the sentence, not for the paragraph around it. */
  const FALSIFIED: readonly string[] = [
    'rewritten by no route',
    'refused FOREVER',
    'never reassigning the run',
  ];

  it('walked the tree it claims to scan — a scan over an empty corpus passes everything', () => {
    // `coord-pause-route.test.ts`'s "finds the routes it claims to scan" and
    // `topology-clean.test.ts`'s corpus check, for the same reason both exist:
    // a moved root turns every negative below into a tautology, and a
    // tautology is indistinguishable from a pass.
    const files = sources().map((s) => s.file);
    expect(files.length, 'a source root moved — this scan is over nothing').toBeGreaterThan(150);
    // Named by hand ON PURPOSE, and these two only: not the corpus (that is
    // derived) but the smoke alarm for it — one file per side of the wire, the
    // L0 type and the render that reads it, which are exactly the two that
    // carried this claim.
    expect(files, 'the L0 side is outside the corpus').toContain('shared/api.ts');
    expect(files, 'the render side is outside the corpus').toContain('pwa/src/fleet/nestFleet.ts');
    // …and the flattening has to actually reach a `//` block, or the widened
    // scan reads source with its comments still folded and finds nothing.
    const nest = sources().find((s) => s.file === 'pwa/src/fleet/nestFleet.ts');
    expect(nest?.text, 'the flattener no longer strips `//` comments')
      .toContain('THE EDGE IS `run.claimedBy` -> `run.sessionId`');
  });

  it('drops the three claims the reclaim door falsified — in EVERY source file, not just the one', () => {
    // Each of these was TRUE of the tree that shipped it. `claimedBy` was written at
    // open and by nothing else, so "the second coordinator is refused for ever" and
    // "recovery never reassigns the run" followed from it. A door that measures the
    // claimant and succeeds a dead one falsifies all three at once, and a wire type
    // whose docstring still asserts them is worse than one with no docstring: a
    // reader trusts it (D-1125).
    //
    // TREE-WIDE, and this test was per-file until D-1153 found out why that is
    // not enough: D-1125 corrected `shared/api.ts` and this pin, scanning
    // `shared/api.ts` alone, called the wave done — while `pwa/src/fleet/
    // nestFleet.ts` went on asserting the same claim AND citing the corrected
    // docstring as its authority for it. That is the finding
    // `coordinator-skill.test.ts` already recorded — BY NAME, not by line, since
    // D-1005 is about exactly this citation going stale: `carries no copy of the
    // pre-reclaim absolute, in EITHER corpus file` argues "a per-file pin would
    // have let the survivor go on teaching … the D-1000 shape, one file at a
    // time." Arriving a second time, in the same programme, in the same shape,
    // in a different corpus. The file nearest the render is the one a reader
    // reaches for, so the survivor was the more dangerous of the two copies,
    // not the lesser.
    //
    // The POSITIVES below (`keeps the part that still holds`, `teaches no call`)
    // are what stop a deletion passing for a fix, which no negative can do on
    // its own.
    const offenders = sources().flatMap(({ file, text }) =>
      FALSIFIED.filter((claim) => text.includes(claim)).map((claim) => `${file}: ${claim}`));
    expect(offenders, 'a source file still teaches a claim the reclaim door falsified').toEqual([]);
  });

  it('keeps the part that still holds — the refusal AT OPEN TIME', () => {
    // The correction is a narrowing, not a deletion: `claimed-by-another` is exactly
    // as absolute as it ever was for a claimant that is alive, and that is what the
    // door measures before it writes anything.
    const d = doc();
    expect(d).toContain('claimed-by-another');
    expect(d).toContain('refused AT OPEN TIME');
    expect(d).toContain('a corpse can be succeeded');
  });

  it('teaches no call — the reclaim PATH appears nowhere in it', () => {
    // Method-spelled or not. Nothing that READS this field calls that door: the PWA
    // renders the ownership edge and `resolveCoordinator` addresses mail. A wire
    // type that names a call its own readers do not make is where a doc lie starts —
    // and this file's neighbouring docstrings show how easily the habit spreads
    // (`POST /api/runs`, `POST /api/sessions/:id/prompt`, both correct there).
    const d = doc();
    expect(d).not.toContain('/api/runs/:id/reclaim');
    // …while the route that DOES write this field at open is still named, correctly.
    expect(d).toContain('POST /api/runs');
  });
});
