// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { componentFamily } from '../sourceScan.js';
import { PR_REASONS, LIFECYCLE_ACTS, LC_ACT_UNKNOWN, ASK_STATES, isAskState, ASK_REFUSE_CODES, isAskRefuseCode, SPAWN_VERDICTS } from '../../../shared/api.js';
import { reclaimPauseParseSites } from '../consolidationCensus.js';
import { callsIn, symbolOf } from '../scan/symbols.js';
import { ALL, BASH, ROOTS, ccrcRoot, codeLines, here, holdersOf, isBash, prose, rel, sources } from './helpers.js';


// — Build 4, Task 10: the wave's own two definitions —
describe('Build 4 — one MarkerState, one coordinator-paused literal', () => {
  // The type's fingerprint: the union as it is declared, not every mention.
  const DECLARES = /export type MarkerState\s*=/;

  it('MarkerState is declared in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it("'coordinator-paused' is a literal in exactly one source file", () => {
    // `COORDINATOR_PAUSE_MARKER` (its `shared/switches.ts` row, D-5855,
    // re-exported by `server/src/coord/rundefs.ts`) is the ONE definition;
    // `dispatch.ts` and `watch.ts` both import it. A second literal is how the
    // pause banner and the dispatch gate would come to disagree about what
    // "paused" means — one of them reading a name the other never writes.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'coordinator-paused'")).map(rel);
    expect(holders).toEqual(['shared/switches.ts']);
  });

  it("'mail-disabled' is held by a NAMED list: one marker literal, the rest other words that spell it", () => {
    // THE LIST IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom. The marker literal is
    // defined ONCE, in its `shared/switches.ts` row (D-5855); `watch.ts`'s
    // module-local copy is gone (it held a second literal on purpose until
    // then), and `rundefs.ts` re-exports the row. Any new holder still
    // fails.
    //
    // Two of the four are refusal codes, not marker literals: `'mail-disabled'` is also
    // a `RunRefuseCode` member, so `shared/api.ts` (the vocabulary) and
    // `coord/dispatch.ts` (the refusal that uses it) spell the same characters
    // for a different reason. Listing them here is the honest shape — a scan
    // that pretended they were copies would be describing the tree wrongly.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'mail-disabled'")).map(rel).sort();
    expect(holders).toEqual([
      'server/src/coord/dispatch.ts',   // the refusal CODE (the outcome union's member)
      'server/src/coord/dispatchDecide.ts', // the refusal CODE, decided (ARCH-22, #553)
      'server/src/coord/stall.ts',      // the hold named for the marker it honours
      'shared/api.ts',                  // the refusal-code vocabulary
      'shared/switches.ts',             // the marker literal (its one definition, D-5855)
    ]);
  });

  it('watch.ts reaches the pause marker through the shared constant, never a copy', () => {
    // Not just "no second literal" — that is satisfied by deleting the emitter.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toContain('COORDINATOR_PAUSE_MARKER');
    // The property is "reached through the shared constant, FROM that module",
    // not "that import line names exactly one symbol". Widened in
    // program-leverage wave 4, which imports `MAIL_ROLE_IDS` from the same
    // place: the alternative was a second import line from one module purely to
    // satisfy a regex, which is a contortion, not a guard. The `\b` anchors keep
    // it from matching a longer name that merely contains this one.
    expect(src).toMatch(/import \{[^}]*\bCOORDINATOR_PAUSE_MARKER\b[^}]*\} from '\.\/coord\/rundefs\.js'/);
  });
});


// — Child-reclamation wave 4: the reclaim switch's file name —
describe("child-reclamation wave 4 — one 'reclaim-paused' literal", () => {
  it("'reclaim-paused' is a literal in exactly one source file", () => {
    // `RECLAIM_PAUSE_MARKER` (its `shared/switches.ts` row, D-5855; re-exported
    // by `server/src/coord/rundefs.ts`) is the ONE definition. A second literal
    // is how the banner and the sweep would come to disagree about what
    // "paused" means — one reading a name the other never checks, with the
    // deleting side the one that is wrong.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'reclaim-paused'")).map(rel);
    expect(holders).toEqual(['shared/switches.ts']);
  });

  it('watch.ts reaches the reclaim marker through readSwitches, never a private parse (D-5856)', () => {
    // Not just "no second literal" — that is satisfied by deleting the reader. Symbol-keyed (scan/symbols.ts): each lane
    // site calls the switchboard's one reader, and no `includes(RECLAIM_PAUSE_MARKER)` is left in watch.ts.
    for (const m of ['emitCoord', 'childReclaimPass', 'archivedExpiryPass', 'deadCoordinatorPass']) expect(callsIn(symbolOf('server/src/watch.ts', `FleetWatcher.${m}`)).map((c) => c.name), m).toContain('readSwitches');
    expect(reclaimPauseParseSites().filter((x) => x.file === 'server/src/watch.ts'), 'a private parse in watch.ts').toEqual([]);
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bRECLAIM_PAUSE_MARKER\b[^}]*\} from '\.\/coord\/rundefs\.js'/);
  });
});


// — Build 4, Task 15: one envelope grammar —
describe('Build 4 — one ccrc-mail fence', () => {
  // The GRAMMAR is minted server-side (`renderEnvelope`) and parsed back
  // (`parseMailEnvelope`); a second spelling of the info string is how those
  // two would come to disagree about what opens an envelope — the renderer
  // emitting a fence the parser does not recognise, and every delivered mail
  // silently falling back to an ordinary bubble.
  it('MAIL_ENVELOPE_FENCE is declared in exactly one file, and that file is shared/api.ts', () => {
    const DECLARES = /export const MAIL_ENVELOPE_FENCE\s*=/;
    const holders = ALL.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('envelope.ts reaches the fence through the shared constant, never a literal', () => {
    // Not just "no second literal" — that is satisfied by deleting the
    // renderer. The emitter must still reach the shared constant.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'coord', 'envelope.ts'), 'utf8');
    expect(src).toContain('MAIL_ENVELOPE_FENCE');
    expect(src).toMatch(/import \{ MAIL_ENVELOPE_FENCE, type MailKind \} from '\.\.\/\.\.\/\.\.\/shared\/api\.js'/);
    expect(src).toContain('${fence}${MAIL_ENVELOPE_FENCE}');
  });

  it('the fence spelling survives NOWHERE else — the named gap is closed', () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom this file already
    // uses for `'mail-disabled'` one describe up.
    //
    // `inject/send.ts` (`isMailResidue`) used to test a DRAFT for a stranded
    // envelope opener with a hand-spelled copy of the info string, recorded
    // here as a named gap with an instruction attached: whoever next had a
    // reason to edit that file should import `MAIL_ENVELOPE_FENCE` and shorten
    // this list to `shared/api.ts` alone. Build 8's wave 4 had five reasons
    // and took the invitation, so the list is one entry again and the
    // exclusion it documented is gone rather than merely smaller.
    //
    // ANY QUOTING, NOT JUST `'…'` (Task 19 mutation sweep, and the reason this
    // test was rewritten): the first draft scanned for the single-quoted
    // literal only, and the realistic regression — re-inlining the fence into
    // `renderEnvelope`'s own template literal, ``${fence}ccrc-mail\n`` — is
    // spelled with no quotes at all. That mutant was applied and left this
    // assertion GREEN while only the sibling test above caught it. The scan is
    // now over the bare token in comment-stripped source, so the copy people
    // would actually write is the copy it sees.
    //
    // Three non-fence spellings share these characters and are excluded by the
    // character that follows them, not by a file name: `ccrc-mail.token` (the
    // secret's filename), `x-ccrc-mail-token` (the header) and the nudge's own
    // `ccrc-mail: you have new mail` sentence. None of them is the info
    // string, and none of them would drift with it.
    const noComments = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const FENCE_SPELLING = /ccrc-mail(?![.\-:])/;
    const holders = ALL.filter((f) => FENCE_SPELLING.test(noComments(readFileSync(f, 'utf8'))))
      .map(rel).sort();
    expect(holders).toEqual([
      'shared/api.ts',               // MAIL_ENVELOPE_FENCE (the definition)
    ]);
  });
});


// §1.6b. Neither new vocabulary gets this protection for free, and neither did
// the one PR #50 shipped. "A new fleet mutation is not done until its interrupted
// state is either impossible or named" is only a doctrine if a SECOND copy of the
// naming is a red suite.
describe('Build 8 vocabularies — one definition each, all derived from their map', () => {
  const oneDefinition = (decl: RegExp, name: string) => {
    const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel), name).toEqual(['shared/api.ts']);
  };

  it('defines SpawnVerdict and SPAWN_VERDICTS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type SpawnVerdict\b/m, 'SpawnVerdict');
    oneDefinition(/^\s*export const SPAWN_VERDICTS\b/m, 'SPAWN_VERDICTS');
  });

  it('DERIVES SPAWN_VERDICTS from its map — never a hand-written array beside the type', () => {
    // The technique `PR_REASONS` and `SESSION_LIFECYCLES` already use: a member
    // added to the union with no key in the map is TS2739 here, and a key the
    // union does not have is TS2353. A literal array is a list that nothing forces
    // to agree with the type it claims to enumerate.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SPAWN_VERDICTS: readonly SpawnVerdict\[\] =\s*\n?\s*Object\.keys\(SPAWN_VERDICT_MAP\)/);
    expect(api).not.toMatch(/SPAWN_VERDICTS[^=]*=\s*\[/);
  });

  it('spells the spawn members nowhere else — no second free-standing list of them', () => {
    // `SessionLine.tsx`'s `SPAWN_WORD` is a PRESENTATIONAL map keyed BY the type
    // (`Record<SpawnVerdict, string | null>`, which the compiler keeps total), not
    // a second enumeration — so it holds the member names as KEYS and is exempt by
    // being typed. What this forbids is a free-standing list.
    //
    // BUILT FROM `SPAWN_VERDICTS`, in any order, the way the deliberate-cancel
    // SET scan above is. The literal this replaced spelled the six members the
    // union had when it was written, in that order — so once `narrow` joined,
    // the one list it could still see was the stale one, and a copy of the
    // union as it now stands passed. A list holding all but one member counts:
    // a copy written from memory is as likely to drop one as to reorder them.
    const M = `(?:${SPAWN_VERDICTS.join('|')})`;
    const LIST = new RegExp(`\\[\\s*'${M}'\\s*(?:,\\s*'${M}'\\s*){${SPAWN_VERDICTS.length - 2},}\\]`);
    expect(LIST.test(`['${[...SPAWN_VERDICTS].reverse().join("', '")}']`)).toBe(true);
    expect(LIST.test(`['${SPAWN_VERDICTS.slice(1).join("','")}']`)).toBe(true);
    expect(LIST.test("['ready', 'login', 'blocked']")).toBe(false);
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('defines DivergenceKind and DIVERGENCE_KINDS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type DivergenceKind\b/m, 'DivergenceKind');
    oneDefinition(/^\s*export const DIVERGENCE_KINDS\b/m, 'DIVERGENCE_KINDS');
  });

  it('DERIVES DIVERGENCE_KINDS from its map', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const DIVERGENCE_KINDS: readonly DivergenceKind\[\] =\s*\n?\s*Object\.keys\(DIVERGENCE_KIND_MAP\)/);
    expect(api).not.toMatch(/DIVERGENCE_KINDS[^=]*=\s*\[/);
  });

  it('has exactly ONE census producer — the frame is emitted from one file', () => {
    // Splitting `DIVERGENCE_KINDS` (L0) from `divergences()` (L1) is defensible
    // ONLY if the census has one producer. `reviveFleetSession` must never become
    // a second, which is why the census rides a FRAME and not a `FleetSession`
    // field.
    const emitters = ALL.filter((f) => /bus\.emit\(\s*'divergence'/.test(readFileSync(f, 'utf8')));
    expect(emitters.map(rel)).toEqual(['server/src/watch.ts']);
    const callers = ALL.filter((f) => /\bdivergences\s*\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map(rel).sort()).toEqual(['server/src/divergence.ts', 'server/src/watch.ts']);
  });

  it('defines SESSION_LIFECYCLES exactly once — THE GAP PR #50 SHIPPED WITH', () => {
    // Not a new rule: the same rule, applied to the vocabulary this build is
    // extending. It had no describe at all, which is how a second copy would have
    // arrived unnoticed in exactly the wave that adds a member to it.
    oneDefinition(/^\s*export type SessionLifecycle\b/m, 'SessionLifecycle');
    oneDefinition(/^\s*export const SESSION_LIFECYCLES\b/m, 'SESSION_LIFECYCLES');
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SESSION_LIFECYCLES: readonly SessionLifecycle\[\] =\s*\n?\s*Object\.keys\(SESSION_LIFECYCLE_MAP\)/);
    expect(api).not.toMatch(/SESSION_LIFECYCLES[^=]*=\s*\[/);
  });

  it('mints NO `spawnstate` FIELD anywhere — the shipped registry field is `spawn`', () => {
    // Every occurrence of the word in the spec is a stale draft artifact. A
    // word-only field would destroy the timestamp `_supervised_start` compares
    // `at >= since` against.
    //
    // THE REGEX MATCHES A FIELD, NOT THE WORD, AND THAT IS NOT A WEAKENING — it
    // is the difference between this scan and a spell-checker. Task 101's
    // `SpawnVerdict` docstring and Task 109's `run_events` comment both FORBID
    // the field in prose, inside `shared/api.ts` and `server/src/coord/dispatch.ts`
    // — two files inside ROOTS. A bare `\bspawnstate\b` would red on the very
    // sentences that exist to prevent it, which is a guard eating its own
    // documentation. So: a property access, a quoted key, or a
    // declaration/assignment — every shape an actual field can take.
    //
    // THE BACKTICK IS NOT IN THE QUOTE CLASS, and that correction was forced by
    // measurement rather than taste: both forbidding comments spell the word
    // `spawnstate` in MARKDOWN backticks, so a class of ['"`] red on
    // `shared/api.ts` the moment this describe was written — the guard eating its
    // own documentation, exactly the failure the paragraph above names. A
    // backtick cannot quote an object key in TypeScript anyway (only a computed
    // one), so nothing a real field could look like is lost; a template-string
    // access is still caught by the `\.spawnstate` alternative.
    const FIELD = /\.spawnstate\b|['"]spawnstate['"]|\bspawnstate\s*[:=]/;
    for (const f of ALL) {
      expect(FIELD.test(readFileSync(f, 'utf8')),
        `${rel(f)} names a spawnstate field`).toBe(false);
    }
  });

  it('and the two prose FORBIDDINGS still pass — the guard does not eat its own docs', () => {
    // The positive case, so nobody "fixes" the regex above back into \b…\b and
    // discovers the breakage only when Task 101 lands.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    const dispatch = readFileSync(path.join(ccrcRoot, 'server/src/coord/dispatch.ts'), 'utf8');
    expect(api).toContain('spawnstate');       // in the SpawnVerdict docstring
    expect(dispatch).toContain('spawnstate');  // in the run_events detail comment
  });

  // program-leverage wave 2 (F2). `SkillState` joins this family on the same
  // terms: one type, one presentational `Record` keyed BY the type (which the
  // compiler keeps total), and a runtime list DERIVED from that map's keys.
  // The fold ruling for this wave is what makes single-definition load-bearing
  // here rather than merely tidy — the adjacent graphify lane is building its
  // own skill-presence machinery, and the two lanes converge on this
  // vocabulary. A second spelling anywhere is the drift that ruling forbids.
  it('defines SkillState, SKILL_STATE_MAP and SKILL_STATES exactly once, in shared/', () => {
    oneDefinition(/^\s*export type SkillState\b/m, 'SkillState');
    oneDefinition(/^\s*export const SKILL_STATE_MAP\b/m, 'SKILL_STATE_MAP');
    oneDefinition(/^\s*export const SKILL_STATES\b/m, 'SKILL_STATES');
  });

  it('DERIVES SKILL_STATES from its map — never a hand-written array beside the type', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SKILL_STATES: readonly SkillState\[\] =\s*\n?\s*Object\.keys\(SKILL_STATE_MAP\)/);
    expect(api, 'SKILL_STATES is hand-typed as a literal array — derive it from SKILL_STATE_MAP')
      .not.toMatch(/SKILL_STATES[^=]*=\s*\[/);
  });

  it('spells the three skill-state members nowhere else — no second copy of the words', () => {
    // A free-standing list is how a PWA badge or an agent-side probe silently
    // drifts from the wire. The Record in shared/api.ts is keyed by the type,
    // so it is not an enumeration and is not matched here.
    const LIST = /\[\s*'present',\s*'absent',\s*'unmeasurable'\s*\]/;
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('does not respell io.ts read-failure pair as the skill vocabulary', () => {
    // SkillState deliberately says `unmeasurable`, not `unreadable`. The two
    // vocabularies answer different questions — one read's failure vs a
    // conclusion drawn from a read that may never have happened — and the
    // bespoke assertion below already pins the PAIR to server/src/io.ts alone.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).not.toMatch(/'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/);
  });

  // program-leverage wave 3 (F3). Four readiness vocabularies join this family
  // on the same terms `SkillState` did: one type, one presentational `Record`
  // keyed BY the type, a runtime list DERIVED from that map's keys. They are
  // pinned here rather than in a describe of their own because the family is
  // the thing being protected — a fifth vocabulary added next to these should
  // trip the same three assertions without anyone remembering to write them.
  it('defines the four readiness vocabularies exactly once, in shared/', () => {
    oneDefinition(/^\s*export type FloorState\b/m, 'FloorState');
    oneDefinition(/^\s*export const FLOOR_STATE_MAP\b/m, 'FLOOR_STATE_MAP');
    oneDefinition(/^\s*export type TokenState\b/m, 'TokenState');
    oneDefinition(/^\s*export const TOKEN_STATE_MAP\b/m, 'TOKEN_STATE_MAP');
    oneDefinition(/^\s*export type CoordDbState\b/m, 'CoordDbState');
    oneDefinition(/^\s*export const COORD_DB_STATE_MAP\b/m, 'COORD_DB_STATE_MAP');
    oneDefinition(/^\s*export type ReadyVerdict\b/m, 'ReadyVerdict');
    oneDefinition(/^\s*export const READY_VERDICT_MAP\b/m, 'READY_VERDICT_MAP');
  });

  it('DERIVES every readiness member list from its map', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const [list, map] of [
      ['FLOOR_STATES', 'FLOOR_STATE_MAP'], ['TOKEN_STATES', 'TOKEN_STATE_MAP'],
      ['COORD_DB_STATES', 'COORD_DB_STATE_MAP'], ['READY_VERDICTS', 'READY_VERDICT_MAP'],
    ] as const) {
      expect(api, `${list} is not derived from ${map}`).toMatch(
        new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
      expect(api, `${list} is hand-typed as a literal array — derive it from ${map}`)
        .not.toMatch(new RegExp(`${list}[^=]*=\\s*\\[`));
    }
  });

  it('the projects wire row is declared once, and no inline twin survives', () => {
    // D-1028, and then D-1028's own gap. The shape was spelled THREE times —
    // `lifecycle.ts`'s return type, a local `interface Project` in the sheet,
    // and this generic in `pwa/src/lib/api.ts` — the last of which sits two
    // lines under a comment warning that "a field added in Stage 2a is exactly
    // the kind of addition that lands in two of three copies". F3's
    // `readiness` was that field: it typechecks against the twin (the property
    // is optional), so nothing failed — the declared type simply went on
    // denying a field the server was already sending. Caught in self-review,
    // not by a test, which is why this one exists.
    oneDefinition(/^\s*export interface ProjectRow\b/m, 'ProjectRow');
    // PREFIX-LESS, deliberately (fix round 1, minor 3). The first version of
    // this scan keyed on the INLINE GENERIC spelling (`projects: { name:
    // string; workdir: string }[]`) and so was blind to the other way the twin
    // is written — a local `interface Project { name; workdir }` — which was
    // LIVE in the tree at the time, in NewSessionSheet.tsx, with this suite
    // green. A fingerprint that only catches the copy you already fixed is not
    // a guard. This matches the FIELD PAIR however it is spelled, and the one
    // legal holder is the declaration itself.
    const TWIN = /\bname:\s*string;\s*\n?\s*workdir:\s*string\b/;
    expect(
      ALL.filter((f) => TWIN.test(readFileSync(f, 'utf8'))).map(rel),
      'a twin of the projects row — import ProjectRow from shared/api instead',
    ).toEqual(['shared/api.ts']);
  });

  it('the readiness verdict is DERIVED in one place, never recomputed by a consumer', () => {
    // `readyVerdict` is L0 and pure so the PWA renders the server's answer
    // rather than folding five fields a second time. A second fold is how the
    // badge and the board come to disagree about the same box.
    oneDefinition(/^\s*export function readyVerdict\b/m, 'readyVerdict');
    oneDefinition(/^\s*export function foldSkillStates\b/m, 'foldSkillStates');
  });

  describe('AskState', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const oneDefinition = (name: string): string[] =>
      ALL.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_STATE_MAP')).toEqual(['shared/api.ts']);
      expect(oneDefinition('ASK_STATES')).toEqual(['shared/api.ts']);
    });

    it('derives its runtime list from the map, never a second array', () => {
      const src = read('shared/api.ts');
      expect(src).not.toMatch(/ASK_STATES[^=]*=\s*\[/);
    });

    it('round-trips every member and refuses non-members', () => {
      // SEVEN since D-5289: `declined`, a parent's own release, terminal,
      // apart from the lapse's `released`, which stays answerable.
      expect(ASK_STATES.length).toBe(7);
      expect(ASK_STATES).toContain('declined');
      expect(new Set(ASK_STATES).size).toBe(ASK_STATES.length);
      for (const s of ASK_STATES) expect(isAskState(s)).toBe(true);
      expect(isAskState('nope')).toBe(false);
      expect(isAskState(null)).toBe(false);
      expect(isAskState(7)).toBe(false);
    });
  });

  describe('AskRefuseCode', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const oneDefinition = (name: string): string[] =>
      ALL.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_REFUSE_CODE_MAP')).toEqual(['shared/api.ts']);
    });

    it('leaves no second copy of the literal set in inject/ask.ts', () => {
      // D-2174: the union used to live here, inline, with no runtime list.
      expect(read('server/src/inject/ask.ts')).not.toMatch(/'menu-mismatch'\s*;/);
    });

    it('round-trips every member', () => {
      // RULING F1: fourteen, not the brief's ten — the four route-level
      // refusals (`unknown-ask`, `not-held`, `ask-moved`, `not-parent`,
      // emitted by later tasks' routes in server/src/coord) share this same
      // refusal family and so join this one union rather than a second.
      // FIFTEEN since the whole-branch review (M2): `child-unmeasurable`
      // split "this box could not read the child" back out of `ask-moved`,
      // which had been carrying both — a narrowing that reached the shipped
      // coordinator contract, not merely a taxonomy.
      // SEVENTEEN since D-5289: `declined` (the parent released the question
      // itself) and `already-answered` (a principal already ruled), which a
      // take used to fold onto `not-held`.
      expect(ASK_REFUSE_CODES.length).toBe(17);
      for (const c of ASK_REFUSE_CODES) expect(isAskRefuseCode(c)).toBe(true);
      expect(isAskRefuseCode('nope')).toBe(false);
      expect(isAskRefuseCode(null)).toBe(false);
    });
  });

  // WHOLE-BRANCH REVIEW, F1: the one principal token BOTH sides act on —
  // `server.ts` writes it into `asks.answeredBy`, the PWA renders a
  // different sentence for it ("answered by you"). Two literals would let
  // the writer and the reader drift into a chip that silently stops
  // recognising the operator's own answer and falls back to naming the
  // parent, which is exactly the defect F1 closed.
  describe('ASK_OPERATOR_PRINCIPAL', () => {
    const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    const definers = (): string[] =>
      ALL.filter((f) => /export const ASK_OPERATOR_PRINCIPAL\b/.test(readFileSync(f, 'utf8'))).map(rel);

    it('is spelled once, in shared/api.ts', () => {
      expect(definers()).toEqual(['shared/api.ts']);
    });

    it("leaves no bare 'operator' literal in either file that acts on it", () => {
      // The writer and the renderer, by name. `coord/rundefs.ts` legitimately
      // owns the same WORD for the mail lane (`SYSTEM_MAIL_SENDER_MAP`) and is
      // deliberately not scanned: those members answer "who sent this", a
      // different question from "who pressed the key".
      expect(read('server/src/server.ts')).not.toMatch(/'operator'/);
      // THE ROW'S FAMILY, not one path. This was `read('…/SessionLine.tsx')`
      // until the row's meta line — the half that renders the ask chip and so
      // the half this negative is about — moved to `SessionMeta.tsx`. A
      // negative assertion against a file the code has left does not go red;
      // it goes VACUOUS, which is worse. `componentFamily` follows what the
      // row renders.
      expect(componentFamily(ccrcRoot, 'pwa/src/fleet/SessionLine.tsx'))
        .not.toMatch(/'operator'/);
    });
  });
});


// Task 5 (docs/superpowers/plans/2026-08-20-fleetio-measured-read.md): the
// `'absent' | 'unreadable'` read-failure vocabulary lives once, in
// `shared/agent-protocol.ts`'s `ReadFailure` — it was `server/src/io.ts`'s
// until D-1438 moved it, which is what the first `it()` below asserts and
// what this paragraph went on claiming for a wave — and `registry.ts`'s
// `BranchEvidence`
// DERIVES it (`'named' | ReadFailure | 'empty'`) rather than restating the
// pair — it used to spell `'absent' | 'unreadable'` a second time at
// `registry.ts:21`. `oneDefinition` above is per-named-symbol and hardcodes
// `shared/api.ts` as the one legal home, so it cannot be reused for a
// symbol whose home is `shared/agent-protocol.ts` — this is a bespoke assertion in
// the same style.
//
// The fingerprint is the ORDERED PAIR, not either word alone:
// `shared/api.ts` legitimately declares `WsAuditUnit = 'enabled' | 'loaded'
// | 'absent'`, where `'absent'` appears with no `'unreadable'` beside it —
// a bare `/'absent'/` or `/'unreadable'/` scan would false-positive there.
describe('one absent/unreadable read vocabulary', () => {
  // ORDER-INSENSITIVE (wave-1 review minor m1). The vocabulary is a SET of two
  // words; a second copy that happens to spell them the other way round is
  // exactly the drift this scan exists to catch, and the original single
  // ordering let it through silently. Still a PAIR rather than either word
  // alone — `shared/api.ts`'s `WsAuditUnit = 'enabled' | 'loaded' | 'absent'`
  // is a legitimate lone `'absent'` and must not trip it.
  const PAIR = /'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/;

  // D-1438: moved from `server/src/io.ts` to `shared/agent-protocol.ts`. The
  // pair is wire-adjacent vocabulary both `agent/src/fileops.ts` and
  // `server/src/io.ts` fold their read/stat outcomes into — declaring it
  // server-side only left the agent side to restate it (twice: `ReadB64Result`
  // and `ReadFromResult`), which is exactly the drift this scan exists to
  // catch. `shared/` is a real consumer of both ends already (`agent/src/
  // server.ts`, `server/src/remote/io.ts` both import `agent-protocol.ts`),
  // so it is the one home reachable from both packages without an agent
  // importing `server/src`.
  it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => PAIR.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('is what registry.ts derives BranchEvidence from, not a second copy', () => {
    const registry = readFileSync(path.join(ccrcRoot, 'server/src/registry.ts'), 'utf8');
    expect(registry).not.toMatch(PAIR);
    expect(registry).toMatch(/export type BranchEvidence = 'named' \| ReadFailure \| 'empty';/);
    expect(registry).toMatch(/import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\/io\.js'/);
  });

  it('is what delegation-model.ts derives a census record\'s state from, not a third copy (ruling R43)', () => {
    const model = readFileSync(path.join(ccrcRoot, 'server/src/coord/delegation-model.ts'), 'utf8');
    expect(model).not.toMatch(PAIR);
    expect(model).toMatch(/state: 'present' \| ReadFailure;/);
    expect(model).toMatch(/import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/agent-protocol\.js'/);
  });

  it('server/src/io.ts re-exports ReadFailure rather than restating it', () => {
    const io = readFileSync(path.join(ccrcRoot, 'server/src/io.ts'), 'utf8');
    expect(io).not.toMatch(PAIR);
    expect(io).toMatch(
      /import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/,
    );
  });

  it('agent/src/fileops.ts imports ReadFailure rather than restating it', () => {
    const fileops = readFileSync(path.join(ccrcRoot, 'agent/src/fileops.ts'), 'utf8');
    expect(fileops).not.toMatch(PAIR);
    expect(fileops).toMatch(
      /import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/,
    );
  });

  it('trips on EITHER ordering — a second copy spelled the other way round is still a second copy', () => {
    // Wave-1 review minor m1. The scan is a text scan, so the fingerprint has
    // to be the SET, not one spelling of it. Measured before the fix: a file
    // containing `type X = 'unreadable' | 'absent'` scored zero hits and the
    // suite stayed green.
    expect(PAIR.test("type X = 'unreadable' | 'absent';")).toBe(true);
    expect(PAIR.test("type X = 'absent' | 'unreadable';")).toBe(true);
    // Still not a bare-word scan: `WsAuditUnit = 'enabled' | 'loaded' |
    // 'absent'` must stay invisible, which is the whole reason the fingerprint
    // is a PAIR (see this describe's own header).
    expect(PAIR.test("type WsAuditUnit = 'enabled' | 'loaded' | 'absent';")).toBe(false);
  });
});


// Delegation broker wave 3, Task 4 (docs/superpowers/plans/2026-10-08-
// delegation-broker-wave3-observe.md, "Shared event and state vocabulary"):
// eleven closed vocabularies, each an `as const` array in `shared/api.ts` with
// its type DERIVED from it. Same family as the block above, and the same
// reason: a second spelling of a closed set is how a vocabulary drifts, and
// nothing but a red suite stops the copy. This scans only the arrays and the
// types derived from them. The interfaces around them are shapes, not sets.
//
// The fingerprint for a hand-typed copy is a union whose members are EXACTLY a
// vocabulary's, in any order. A superset or subset is not a copy — the
// workspace and attempt-verdict sets overlap `FleetHealth`-style fields that
// say something else (`'present' | 'absent' | 'unmeasured'`) — so the compare
// is set EQUALITY, never "contains three of them".
describe('delegation wave 3: the closed vocabularies are declared once, in shared/api.ts, and their types derived', () => {
  const VOCABS = [
    ['DELEGATION_EVENT_KINDS', 'DelegationEventKind',
      ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'SessionEnd']],
    ['DELEGATION_ACTIVITY_SOURCE_KINDS', 'DelegationActivitySourceKind', ['agent', 'workflow', 'bash-worktree']],
    ['DELEGATION_LEASE_SOURCE_KINDS', 'DelegationLeaseSourceKind', ['agent', 'workflow', 'raw', 'attached']],
    ['DELEGATION_EXECUTION_STATES', 'DelegationExecutionState', ['active', 'ended', 'unknown']],
    ['DELEGATION_PARENTAGE_STATES', 'DelegationParentageState', ['linked', 'unresolved', 'conflicting', 'unmeasured']],
    ['DELEGATION_WORKSPACE_STATES', 'DelegationWorkspaceState', ['none', 'provisioning', 'present', 'absent', 'unmeasured']],
    ['DELEGATION_DISPOSITIONS', 'DelegationDisposition', ['ephemeral', 'adopted', 'retained', 'promoted']],
    ['DELEGATION_CLEANUP_STATES', 'DelegationCleanupState',
      ['not-due', 'pending', 'running', 'refused', 'reclaimed', 'unmeasured']],
    ['DELEGATION_CLEANUP_POPULATIONS', 'DelegationCleanupPopulation', ['ephemeral-lease']],
    ['DELEGATION_INTENT_SOURCES', 'DelegationIntentSource', ['explicit', 'run-owner', 'delegation-inferred', 'retained-lineage']],
    ['DELEGATION_ATTEMPT_VERDICTS', 'DelegationAttemptVerdict', ['linked', 'unresolved', 'conflicting', 'unmeasured']],
  ] as const;
  const apiText = (): string => readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
  const declaredIn = (decl: RegExp): string[] => ALL.filter((f) => decl.test(readFileSync(f, 'utf8'))).map(rel);

  it('finds the vocabularies it scans (a scan over nothing passes everything)', () => {
    expect(VOCABS.length).toBe(11);
    expect(apiText()).toContain('DELEGATION_EVENT_KINDS');
  });

  for (const [arr, type, members] of VOCABS) {
    it(`${arr} is declared exactly once, in shared/api.ts, with the plan's members in the plan's order`, async () => {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${arr}\\b`, 'm');
      expect(declaredIn(DEF), arr).toEqual(['shared/api.ts']);
      const api = (await import('../../../shared/api.js')) as unknown as Record<string, unknown>;
      expect(api[arr], `${arr} is exported`).toEqual(members);
    });

    it(`${type} is declared exactly once, in shared/api.ts, DERIVED from ${arr}`, () => {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${type}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${type}\\b)`, 'm');
      expect(declaredIn(DEF), type).toEqual(['shared/api.ts']);
      expect(apiText()).toMatch(new RegExp(`^export type ${type} =\\s*\\(typeof ${arr}\\)\\[number\\];$`, 'm'));
    });
  }

  // Union runs: `'a' | 'b' | 'c'`, however the lines wrap.
  const UNION_RUN = /'[^'\n]+'(?:\s*\|\s*'[^'\n]+')+/g;
  const unionSets = (text: string): Array<ReadonlySet<string>> =>
    (text.match(UNION_RUN) ?? []).map((run) => new Set([...run.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]!)));
  const equalsSet = (set: ReadonlySet<string>, members: readonly string[]): boolean =>
    set.size === members.length && members.every((m) => set.has(m));

  it('the union fingerprint is order-insensitive, set-EQUAL, and leaves overlapping non-copies alone', () => {
    const parentage = VOCABS[4][2];
    const spelled = (text: string): boolean => unionSets(text).some((set) => equalsSet(set, parentage));
    expect(spelled("type X = 'linked' | 'unresolved' | 'conflicting' | 'unmeasured';")).toBe(true);
    expect(spelled("type X = 'unmeasured' | 'conflicting' | 'linked' | 'unresolved';"), 'any order').toBe(true);
    expect(spelled("type X =\n  | 'linked'\n  | 'unresolved'\n  | 'conflicting'\n  | 'unmeasured';"), 'wrapped').toBe(true);
    expect(spelled("type X = 'linked' | 'unresolved' | 'conflicting';"), 'a subset is not a copy').toBe(false);
    expect(spelled("type X = 'linked' | 'unresolved' | 'conflicting' | 'unmeasured' | 'extra';"), 'a superset is not a copy').toBe(false);
    expect(spelled("capabilityState: 'present' | 'absent' | 'unmeasured';"), 'an overlapping other set').toBe(false);
  });

  for (const [arr, type, members] of VOCABS) {
    if (members.length < 2) continue;   // a union of one word states no set
    it(`no source hand-types a union equal to ${arr} — ${type} comes from the array`, () => {
      const holders = ALL.filter((f) => unionSets(readFileSync(f, 'utf8')).some((set) => equalsSet(set, members))).map(rel);
      expect(holders).toEqual([]);
    });
  }
});


// Delegation broker wave 3, Task 4: `ReadFailure` stays declared ONCE, in
// `shared/agent-protocol.ts` (D-1438), and the two consumer shapes this task
// adds to the seam carry it by NAME. A `{ok:false; reason: 'absent' |
// 'unreadable'}` spelled inline in either would be the pair's third copy, and
// the pair scan above already refuses it in io.ts by its fingerprint; these
// pin the same fact by the names the new shapes are supposed to use.
describe('delegation wave 3: the measured directory and byte-range reads carry ReadFailure by name', () => {
  const read = (relPath: string): string => readFileSync(path.join(ccrcRoot, relPath), 'utf8');
  const declaredIn = (decl: RegExp): string[] => ALL.filter((f) => decl.test(readFileSync(f, 'utf8'))).map(rel);

  it('ReadFailure is declared in exactly one file, shared/agent-protocol.ts, and server/src/io.ts only re-exports it', () => {
    expect(declaredIn(/^\s*(?:export\s+)?type\s+ReadFailure\b\s*=/m)).toEqual(['shared/agent-protocol.ts']);
    const io = read('server/src/io.ts');
    expect(io).toMatch(/^export type \{ ReadFailure \};$/m);
    expect(io).not.toMatch(/^\s*(?:export\s+)?type\s+ReadFailure\b\s*=/m);
  });

  it.each([
    ['MeasuredDirectoryRead', 'entries: readonly string[]'],
    ['MeasuredByteRangeRead', 'bytes: Uint8Array; size: number'],
  ])('%s is declared once, in server/src/io.ts, and its failure arm is { ok: false; reason: ReadFailure }', (name, okArm) => {
    expect(declaredIn(new RegExp(`^\\s*(?:export\\s+)?type\\s+${name}\\b\\s*=`, 'm'))).toEqual(['server/src/io.ts']);
    const io = read('server/src/io.ts');
    const at = io.indexOf(`export type ${name} =`);
    expect(at, `${name}'s declaration`).toBeGreaterThan(-1);
    // To the blank line that ends the declaration: its arms hold `;` inside braces.
    const rest = io.slice(at);
    const body = rest.slice(0, rest.indexOf('\n\n'));
    expect(body).toContain(okArm);
    expect(body).toMatch(/\{ ok: false; reason: ReadFailure \}/);
    expect(body).not.toMatch(/'absent'|'unreadable'/);
  });

  it('the new consumers import ReadFailure rather than restating it', () => {
    // fileops.ts is already pinned by the pair scan above; the new agent-side
    // directory result lives in the same file and names the type, and the
    // remote adapter takes it from the seam it implements.
    const fileops = read('agent/src/fileops.ts');
    const at = fileops.indexOf('export type ListDirResult =');
    expect(at, 'ListDirResult\'s declaration').toBeGreaterThan(-1);
    const rest = fileops.slice(at);
    expect(rest.slice(0, rest.indexOf('\n\n'))).toMatch(/\{ ok: false; reason: ReadFailure \}/);
    expect(read('server/src/remote/io.ts')).toMatch(
      /import\s+type\s*\{[^}]*\bReadFailure\b[^}]*\}\s*from\s*'\.\.\/io\.js'/,
    );
  });
});


// — Stage 4, Task 7: the supervisor sweep's preflight, in BOTH copies —
describe('the supervisor sweep — both copies carry the KillMode=process preflight', () => {
  // R1 (granted 2026-08-21) carves the ONE scoped exception into CLAUDE.md's
  // never-touch rule: `ccrc update`'s step-4 sweep and deploy.sh's existing
  // sweep may try-restart `claude-session@*` units — each ONLY behind the
  // mandatory preflight, because without KillMode=process a try-restart is a
  // fleet kill (every session a child of ONE tmux server sitting in whichever
  // claude-session@ cgroup created it). deploy.sh keeps its own copy for now
  // (it executes over SSH while `ccrc` may be mid-replacement — spec §6), so
  // the safety property exists TWICE by design; this pin is what keeps the
  // two from drifting on it. Deleting the preflight from either copy is a
  // red suite, not a review comment.
  const sweepBodies = (): Array<[name: string, body: string]> => {
    const ccrc = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    const upd = /_upd_sweep\(\) \{([\s\S]*?)\n\}/.exec(ccrc);
    expect(upd, 'ccd/ccrc has no _upd_sweep').toBeTruthy();
    const deploySh = readFileSync(path.join(ccrcRoot, 'deploy', 'deploy.sh'), 'utf8');
    // SWEEP_CMD is a single-quoted assignment with no embedded single quotes
    // (deploy.sh's own comment: bash has no escape for one inside one).
    const cmd = /SWEEP_CMD='([\s\S]*?)'/.exec(deploySh);
    expect(cmd, 'deploy.sh has no SWEEP_CMD').toBeTruthy();
    return [['ccd/ccrc _upd_sweep', upd![1]!], ['deploy.sh SWEEP_CMD', cmd![1]!]];
  };

  /** `_upd_sweep`'s two platform arms, split so each arm's preflight is
   *  asserted IN THAT ARM. The first cut of this pin ran its indexOf over the
   *  whole body, and the macOS port's Darwin arm — which spells its guard
   *  `grep -q 'AbandonProcessGroup'` and its restart `_svc_try_restart` —
   *  satisfied nothing and broke nothing: all three indices resolved inside
   *  the Linux arm, and deleting the entire Darwin preflight left this
   *  describe green (measured). The Darwin arm opens at its `$CCD_OS` test
   *  and closes at the arm's own two-space `fi`; every inner block indents
   *  deeper, so the two-space match is the arm's close. deploy.sh's SWEEP_CMD
   *  executes over SSH against the Linux fleet box only and has no arm to
   *  split. */
  const updSweepArms = (body: string): { darwin: string; linux: string } => {
    const d0 = body.indexOf('"$CCD_OS" = darwin');
    expect(d0, '_upd_sweep lost its Darwin arm').toBeGreaterThan(-1);
    const dEnd = body.indexOf('\n  fi', d0);
    expect(dEnd, "_upd_sweep's Darwin arm never closes").toBeGreaterThan(d0);
    return { darwin: body.slice(d0, dEnd), linux: body.slice(dEnd) };
  };

  it('each implementation compares the resolved value to KillMode=process', () => {
    for (const [name, body] of sweepBodies()) {
      const scope = name === 'ccd/ccrc _upd_sweep' ? updSweepArms(body).linux : body;
      expect(scope, `${name} lost its KillMode=process preflight`)
        .toContain('"KillMode=process"');
      expect(scope, `${name} asks the unit file, not systemd — drop-ins would be invisible`)
        .toContain('show -p KillMode');
    }
  });

  it('and in each, the preflight comes BEFORE the try-restart', () => {
    // Not merely present: a guard that runs after the sweep guards nothing.
    for (const [name, body] of sweepBodies()) {
      const scope = name === 'ccd/ccrc _upd_sweep' ? updSweepArms(body).linux : body;
      const guard = scope.indexOf('"KillMode=process"');
      const restart = scope.indexOf('try-restart');
      expect(restart, `${name} has no try-restart — the sweep is gone`).toBeGreaterThan(-1);
      // indexOf's -1 would sit "before" any restart — an ABSENT preflight must
      // red THIS test too, not only its sibling.
      expect(guard, `${name} has no preflight at all`).toBeGreaterThan(-1);
      expect(guard, `${name}: the preflight does not precede the try-restart`)
        .toBeLessThan(restart);
    }
  });

  it('the Darwin arm carries its own preflight — the negated AbandonProcessGroup grep — BEFORE its kickstart', () => {
    // The macOS counterpart of R1's mandate, pinned in the arm that holds it.
    // The NEGATION is part of the pin: `! grep -q` refuses when the key is
    // ABSENT, and inverting it (measured green under the old pin) would make
    // the sweep refuse exactly the boxes that are safe and sweep the ones
    // that are not.
    const [name, body] = sweepBodies()[0]!;
    expect(name).toBe('ccd/ccrc _upd_sweep');
    const { darwin } = updSweepArms(body);
    expect(darwin, 'the Darwin preflight (negated grep) is gone')
      .toContain("! grep -q 'AbandonProcessGroup'");
    const guard = darwin.indexOf("! grep -q 'AbandonProcessGroup'");
    const restart = darwin.indexOf('_svc_try_restart');
    expect(restart, 'the Darwin arm has no _svc_try_restart — the sweep is gone')
      .toBeGreaterThan(-1);
    expect(guard, 'the Darwin preflight does not precede the kickstart')
      .toBeLessThan(restart);
    // Refused is DEGRADED, never fatal — the same spec §6 shape as Linux.
    expect(darwin).toContain('update: DEGRADED: the supervisor sweep did not run');
  });
});


// — Stage 5, Task 2: the release owner (S1) — the deliberate pair, held to two —
describe('the release owner literal — two named assignments, and no third spelling', () => {
  // Three suites now hold three different halves of one fact, and the split is
  // deliberate:
  //   - license.test.ts pins the VALUE — both lanes name the ruled owner, and
  //     the previous org survives nowhere in shipping code;
  //   - ccrc-update-kept.test.ts pins the AGREEMENT — install.sh's owner/repo pair
  //     and ccd/ccrc's are equal, so the two lanes download the same release;
  //   - THIS pins the COUNT — those two assignments are the only spellings of
  //     the org anywhere in shipped code, so a third copy (a hardcoded release
  //     URL in a workflow, a `const OWNER` in the server, a literal in some
  //     deploy script) is a red suite rather than a URL that keeps working
  //     through GitHub's post-transfer redirect and dies the day the old org
  //     name is recreated.
  //
  // TWO definitions, not one, and that is D-92's cross-file class rather than
  // a drift — ccd/ccrc's own release-source header carries the argument:
  // `install.sh --release` runs before any ccrc exists on the box, so it
  // cannot read ccrc's pair, and `ccrc update` runs on boxes install.sh has
  // long left. The stage-5 plan's Task 2 asked for "defined once, in
  // install.sh"; the pin ships against the tree that exists, whose second
  // definition is deliberate and separately held equal (D-191).
  const DEFINES = /^CCRC_RELEASE_OWNER="/;

  /** The org name every scan below hunts for: READ from the definition, never
   *  restated here. A scanner that hand-spelled the owner would follow a
   *  rename one commit late — this file's own disease, in the file that
   *  exists to prevent it. */
  const owner = (): string => {
    const m = /^CCRC_RELEASE_OWNER="([^"]+)"$/m.exec(
      readFileSync(path.join(ccrcRoot, 'install.sh'), 'utf8'));
    expect(m, 'install.sh no longer spells CCRC_RELEASE_OWNER').not.toBeNull();
    return m![1]!;
  };

  const OWNER = owner();

  /** The two lanes, named once. The test below asserts the tree agrees with
   *  this list; every later test DERIVES from it rather than restating it —
   *  a hand-kept second copy of the holder list, inside the suite that exists
   *  to forbid second copies, is the joke this file cannot afford. */
  const HOLDERS = [
    'ccd/ccrc',    // the box's lane — `ccrc update` downloads with it
    'install.sh',  // the clone's lane — `install.sh --release` does too
  ];

  it('is assigned in exactly two bash files, and each is named here BY NAME', () => {
    const holders = BASH
      .filter((f) => codeLines(f).some((l) => DEFINES.test(l)))
      .map(rel).sort();
    expect(holders).toEqual(HOLDERS);
  });

  it('no other line of shipped bash spells the org — everything else derives', () => {
    // Within the two holders, the assignment is the ONLY code line carrying
    // the literal (the URL below each is built from `$CCRC_RELEASE_OWNER`);
    // in every other bash file, no code line carries it at all. Prose may
    // discuss the owner anywhere — only a line of shell is a copy.
    for (const f of BASH) {
      const lines = codeLines(f).filter((l) => l.includes(OWNER));
      const want = DEFINES.test(lines[0] ?? '') && HOLDERS.includes(rel(f))
        ? [`CCRC_RELEASE_OWNER="${OWNER}"`]
        : [];
      expect(lines, rel(f)).toEqual(want);
    }
  });

  it('both lanes build their release URL through the variable, not a restatement', () => {
    // Not merely "no second literal" — deleting the download would satisfy
    // that. Each lane must still READ the variable it defines.
    for (const f of HOLDERS) {
      const uses = codeLines(path.join(ccrcRoot, f))
        .filter((l) => l.includes('$CCRC_RELEASE_OWNER'));
      expect(uses.length, `${f} never reads $CCRC_RELEASE_OWNER`).toBeGreaterThan(0);
    }
  });

  it('the four TS roots never name the org — no server-side release identity', () => {
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes(OWNER)).map(rel);
    expect(holders).toEqual([]);
  });

  it('the workflows never name the org — the release lane derives its repo from the checkout', () => {
    // release.yml's `gh release create` writes to the repository the runner
    // checked out — no owner argument anywhere, which is what lets the repo
    // transfer orgs without touching a workflow. YAML comments are prose,
    // same as bash's (`codeLines` treats both).
    const wfDir = path.join(ccrcRoot, '.github', 'workflows');
    const wfs = readdirSync(wfDir).filter((e) => /\.ya?ml$/.test(e));
    expect(wfs.length, 'the workflow directory is empty — this scan sees nothing').toBeGreaterThan(0);
    for (const wf of wfs) {
      const hits = codeLines(path.join(wfDir, wf)).filter((l) => l.includes(OWNER));
      expect(hits, `.github/workflows/${wf}`).toEqual([]);
    }
  });
});


describe('Build 9 nouns — the lifecycle journal vocabulary', () => {
  const oneDefinition = (decl: RegExp, name: string): void => {
    const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel), name).toEqual(['shared/api.ts']);
  };

  it('defines each type and its derived list exactly once, in shared/', () => {
    oneDefinition(/^\s*export type LifecycleAct\b/m, 'LifecycleAct');
    oneDefinition(/^\s*export const LIFECYCLE_ACTS\b/m, 'LIFECYCLE_ACTS');
    oneDefinition(/^\s*export const LC_ACT_UNKNOWN\b/m, 'LC_ACT_UNKNOWN');
    oneDefinition(/^\s*export type LifecycleOutcome\b/m, 'LifecycleOutcome');
    oneDefinition(/^\s*export const LIFECYCLE_OUTCOMES\b/m, 'LIFECYCLE_OUTCOMES');
    oneDefinition(/^\s*export const LC_OUTCOME_UNKNOWN\b/m, 'LC_OUTCOME_UNKNOWN');
    oneDefinition(/^\s*export type ActorClass\b/m, 'ActorClass');
    oneDefinition(/^\s*export const ACTOR_CLASSES\b/m, 'ACTOR_CLASSES');
    oneDefinition(/^\s*export type Corroboration\b/m, 'Corroboration');
    oneDefinition(/^\s*export function corroboration\b/m, 'corroboration');
    oneDefinition(/^\s*export type LcRefusalToken\b/m, 'LcRefusalToken');
    oneDefinition(/^\s*export const LC_REFUSAL_WORD\b/m, 'LC_REFUSAL_WORD');
    oneDefinition(/^\s*export interface LifecycleEvent\b/m, 'LifecycleEvent');
    oneDefinition(/^\s*export interface MirroredLifecycleEvent\b/m, 'MirroredLifecycleEvent');
    oneDefinition(/^\s*export function compareGenerations\b/m, 'compareGenerations');
  });

  it('DERIVES every runtime list from its total map — never a hand-written array', () => {
    // The `PR_REASONS`/`SPAWN_VERDICTS`/`DIVERGENCE_KINDS` guard, applied to
    // the five new vocabularies. A member added to a union with no key in its
    // map is TS2739; a key the union does not have is TS2353. A
    // `readonly X[]` literal beside the type gives neither, and accepts a typo.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const [list, map] of [
      ['LIFECYCLE_ACTS', 'LIFECYCLE_ACT_MAP'],
      ['LIFECYCLE_OUTCOMES', 'LIFECYCLE_OUTCOME_MAP'],
      ['ACTOR_CLASSES', 'ACTOR_CLASS_MAP'],
      ['CORROBORATIONS', 'CORROBORATION_MAP'],
      // The refusal list derives from the EXPORTED rendering map itself —
      // there is no private twin, and there must not be one: see the third
      // `it` below.
      ['LC_REFUSAL_TOKENS', 'LC_REFUSAL_WORD'],
      // Account pools wave 2b: the same idiom, applied to `meas` and `dec`
      // key vocabularies (`LIFECYCLE_MEAS_KEY_MAP`/`LIFECYCLE_DEC_KEY_MAP`,
      // both module-private in shared/api.ts). `tsc` already pins each MAP
      // against its interface both ways; this is what pins the exported
      // LIST as DERIVED rather than hand-written (D-1890).
      ['LIFECYCLE_MEAS_KEYS', 'LIFECYCLE_MEAS_KEY_MAP'],
      ['LIFECYCLE_DEC_KEYS', 'LIFECYCLE_DEC_KEY_MAP'],
    ] as const) {
      expect.soft(api, `${list} must derive from ${map}`)
        .toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
      expect.soft(api, `${list} is a hand-written array`)
        .not.toMatch(new RegExp(`export const ${list}[^=]*=\\s*\\[`));
    }
  });

  it('keeps the NARROWING maps module-private, and the RENDERING map exported', () => {
    // `STOP_SURFACES`' argument (:1215-1223), one level in: with the map
    // unexported, `LIFECYCLE_ACT_MAP[raw]` cannot be written in another file
    // at all, so `isLifecycleAct` is the only narrowing route.
    //
    // LC_REFUSAL_WORD IS THE EXCEPTION, AND THE EXCEPTION IS THE RULE READ
    // CORRECTLY: it renders a token for a person, it narrows nothing, the
    // PWA types its own renderer against it, and `isLcRefusalToken` is still
    // the only door. `SENTENCES` (`wsaudit.ts:17`) is the precedent. A
    // private `LC_REFUSAL_WORD_MAP` twin aliased to an export would be a
    // second name for one value, declared only to satisfy a guard written
    // for the other case — so this test forbids it in BOTH directions.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    for (const m of ['LIFECYCLE_ACT_MAP', 'LIFECYCLE_OUTCOME_MAP', 'ACTOR_CLASS_MAP',
      'CORROBORATION_MAP', 'DEC_CORROBORATES']) {
      expect.soft(api, `${m} must not be exported`)
        .not.toMatch(new RegExp(`^\\s*export const ${m}\\b`, 'm'));
      expect.soft(api, `${m} must exist`).toMatch(new RegExp(`^\\s*const ${m}\\b`, 'm'));
    }
    expect(api, 'LC_REFUSAL_WORD is the renderer and is exported directly')
      .toMatch(/^\s*export const LC_REFUSAL_WORD\b/m);
    expect(api, 'no LC_REFUSAL_WORD_MAP alias — one value, one name')
      .not.toMatch(/LC_REFUSAL_WORD_MAP/);
  });

  it('enumerates the act vocabulary only where the compiler enforces exhaustiveness', () => {
    // The rule, stated as the assertion: a file may list the WHOLE act
    // vocabulary only if a `Record<LifecycleAct, …>` over it makes a missing
    // member a compile error. Two files qualify: `shared/api.ts` (the union
    // and `LIFECYCLE_ACT_MAP`) and — since wave 9 landed it, at
    // `pwa/src/session/journalWords.ts` rather than the `pwa/src/lib/` this
    // comment once predicted (D-215) — `journalWords.ts`, ONLY because it
    // types `ACT_WORD` as `Record<LifecycleAct, string>`.
    //
    // Membership is tested per token in ANY form, quoted or as an object key,
    // the way the `PrReason` scan above does — a quoted-literals-only scan
    // would exclude a map written with unquoted keys by accident rather than
    // by rule.
    const enumerates = (src: string): boolean =>
      LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
    const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['pwa/src/session/journalWords.ts', 'shared/api.ts']);
  });

  it('and the act scan is looking at something — guards the guard', () => {
    // A `LIFECYCLE_ACTS` that had gone empty would make `every` vacuously true
    // for EVERY file, turning the assertion above into a list of all 200-odd
    // sources — loud, but for the wrong reason. This fails first, and
    // specifically. Measured when written: the highest-scoring NON-holder is
    // `pwa/src/lib/api.ts` at 8 of 24, so the margin is 15 tokens.
    const enumerates = (src: string): boolean =>
      LIFECYCLE_ACTS.every((a) => new RegExp(`(?:'${a}'|(?<![\\w'-])${a}\\s*:)`).test(src));
    expect(LIFECYCLE_ACTS.length).toBe(29);
    expect(LIFECYCLE_ACTS).toContain(LC_ACT_UNKNOWN);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8'))).toBe(true);
    expect(enumerates(readFileSync(path.join(ccrcRoot, 'pwa/src/lib/api.ts'), 'utf8'))).toBe(false);
  });

  it('LC_REFUSAL_WORD has exactly one holder — the second copy is the whole failure mode', () => {
    const tokens = ['scratch-unwritable', 'tip-unreadable', 'bad-session-id',
      'flock-unavailable', 'lock-unopenable', 'is-a-workspace',
      'session-live', 'session-verdict-unknown', 'spawn-failed'];
    const enumerates = (src: string): boolean =>
      tokens.every((t) => src.includes(`'${t}'`));
    expect(ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel))
      .toEqual(['shared/api.ts']);
    expect(tokens.length, 'guards the guard — an empty list passes everything').toBe(9);
  });
});


// Build 9b fix round — the ledger's stale horizon. `LEDGER_STALE_MS` is an L0
// constant ("The present tense's numbers", `shared/api.ts`: every one lives
// THERE and nowhere else) with two readers that must agree: `coord/routes.ts`
// derives the wire `stale` per row from it, and `watch.ts`'s reconcile sweep
// reports stale allocations against it. Wave 7 shipped `watch.ts` carrying a
// private `const LEDGER_STALE_MS = 7 * 24 * 3_600_000` beside the import path
// it already used for other L0 numbers — equal by arithmetic coincidence,
// spelled differently, with nothing forcing agreement: `UNCHECKED_PR`'s exact
// shape, one drift earlier in its life.
describe('one LEDGER_STALE_MS — the stale horizon has one home', () => {
  // A DEFINITION in any form — exported or module-private, which is the form
  // the real copy took — never a mention: an import names the constant
  // without `const … =`, and prose has no assignment at all.
  const DEFINES = /^\s*(?:export\s+)?const\s+LEDGER_STALE_MS\s*=/m;

  it('is defined in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => DEFINES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('is what both readers import, not re-derive', () => {
    // Not merely "the copy is gone" — deleting either reader's staleness
    // logic satisfies that. Each must still reach the shared constant.
    for (const f of ['server/src/coord/routes.ts', 'server/src/watch.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f)
        .toMatch(/import\s*\{[^}]*\bLEDGER_STALE_MS\b[^}]*\}\s*from\s*'[^']*shared\/api\.js'/);
    }
  });
});


describe('graphify — one pin, one census path', () => {
  it("the pip pin literal 'graphifyy==' lives in exactly one bash file, ccd/ccrc", () => {
    expect(holdersOf('graphifyy==')).toEqual(['ccd/ccrc']);
  });
  it('GRAPHIFY_PIN is assigned in exactly one bash file, ccd/ccrc', () => {
    const holders = BASH.filter((f) =>
      codeLines(f).some((l) => /^\s*GRAPHIFY_PIN=/.test(l))).map(rel).sort();
    expect(holders).toEqual(['ccd/ccrc']);
  });
  it("the census path '.ccrc/graph-sweep.json' is spelled by writers/readers, not duplicated as a second constant", () => {
    // The sweep WRITES it; doctor and the session hook READ it. Spelling a
    // path you read is not duplicating a constant — what this guard forbids is
    // a SECOND definition, a `CENSUS=`-shaped copy nothing derives from. The
    // hook is a legitimate third holder (D-1333): it is installed on its own
    // into ~/.cc-sessions and runs as Claude Code's hook with no ccd around to
    // source, so it can only spell the path. The list stays exact-match, so a
    // FOURTH holder still reddens this.
    const holders = holdersOf('graph-sweep.json');
    expect(holders).toEqual(
      ['ccd/ccd-graph-sweep', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh']);
  });
});


// — Plan 2b-2 Task 3 (D-3487): the Codex runtime's LiteLLM requirement —
describe('the Codex runtime — one LiteLLM requirement, in one file', () => {
  // `graphify`'s two rows above, for the second venv this tree builds: the
  // requirement (extra, floor and ceiling in ONE string) lives in
  // `ccd/ccgpt-runtime`, and every other reader reads the STAMP a passing
  // build writes. The third row exists because the first two cannot see the
  // files most likely to grow a second copy: `isBash` rejects every dotted
  // name, so a `litellm==` in `ccd/ccgpt-usage.py`, `shared/litellm.mjs` or a
  // `deploy/*.yaml` scores no hit in `holdersOf` at all (runtime-probe HR13).
  it("the requirement literal 'litellm[proxy]' lives in exactly one bash file, ccd/ccgpt-runtime", () => {
    expect(holdersOf('litellm[proxy]')).toEqual(['ccd/ccgpt-runtime']);
  });

  it('LITELLM_REQUIREMENT is assigned in exactly one bash file, ccd/ccgpt-runtime', () => {
    const holders = BASH.filter((f) =>
      codeLines(f).some((l) => /^\s*LITELLM_REQUIREMENT=/.test(l))).map(rel).sort();
    expect(holders).toEqual(['ccd/ccgpt-runtime']);
  });

  it('no other file under ccd, deploy, shared or install.sh — of ANY type — spells a litellm version spec', () => {
    // EVERY line, comments included: this is a literal-absence pin, and prose
    // naming a version is the first draft of a second pin. `--others
    // --exclude-standard` as well as the index, so a new file is seen before
    // it is staged — a gate over the index alone cannot see an uncommitted
    // definition. It refuses to answer when git cannot list the tree.
    const r = spawnSync('git', ['-C', ccrcRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
      '--', 'ccd', 'deploy', 'shared', 'install.sh'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    const files = [...new Set(r.stdout.split('\0').filter(Boolean))].sort();
    // The floor: a scan over too few files passes everything, and these five
    // are the ones this row exists to see — three of them dotted.
    expect(files.length).toBeGreaterThan(50);
    for (const f of ['ccd/ccgpt-runtime', 'ccd/ccgpt-proxy.py', 'ccd/ccgpt-usage.py', 'shared/litellm.mjs', 'install.sh']) {
      expect(files, f).toContain(f);
    }
    const SPEC = /\blitellm\[|\blitellm\s*(?:===|==|~=|>=|<=|!=|<|>)\s*\d/;
    const holders = files.filter((f) => {
      const p = path.join(ccrcRoot, f);
      return existsSync(p) && statSync(p).isFile() && SPEC.test(readFileSync(p, 'utf8'));
    });
    expect(holders).toEqual(['ccd/ccgpt-runtime']);
  });
});


describe('the ccrc-install fixture tree — one TREE_FILES, one installFixtureTree', () => {
  // The same shape as "extraction finding — one path to the ccd script"
  // above, applied to a copy that was made for a stated reason and copied
  // anyway: the `ccrc-install-*.test.ts` family (one fixture module since D-6767) and `ccrc-install-graphify.test.ts` each
  // carried their own `TREE_FILES` / `TREE_STUBS` / `installFixtureTree`,
  // both headers citing the same excuse (importing a sibling `.test.ts` module
  // for its helpers double-registers that file's `describe` blocks). The
  // excuse argued for a THIRD file with no `describe()` in it, not for two
  // copies — `installTreeFixture.ts` is that file. The cost of the old shape
  // was measured, not theoretical: an edit to one `TREE_FILES` that missed the
  // other broke 34 tests in the file nobody touched.
  //
  // Scans `server/test` AND `server/test-e2e`, which `ROOTS` above
  // deliberately does not cover, for the same reason the ccd-script-path
  // finding does: these are TEST files, and the fixture they define is data
  // no shipped source ring owns. The sibling directory is in scope for the
  // same reason the ccd-script-path finding put it there — an e2e run that
  // needs the same `ccrc install` tree is exactly the shape that would reach
  // for its own `TREE_FILES` copy rather than importing this one, and a scan
  // that stopped at `server/test` would score that copy no hit at all.
  const testDir = path.join(ccrcRoot, 'server', 'test');
  const testDirs = [testDir, path.join(ccrcRoot, 'server', 'test-e2e')];
  const testFiles = testDirs.flatMap(sources);

  // Matches the shape of an ASSIGNMENT to an array literal, not a reference or
  // an import — an `import { … } from './installTreeFixture.js'` line has no
  // assignment-to-a-bracket in it, so a consumer importing the shared list is
  // not mistaken for a second holder of it. (This comment deliberately never
  // spells the three characters the pattern hunts for adjacently, the same
  // reason the ccd-script-path finding above avoids writing its own literal.)
  const DEFINES_TREE_FILES = /\bTREE_FILES\s*=\s*\[/;
  const DEFINES_TREE_STUBS = /\bTREE_STUBS\s*:\s*Record<string,\s*string>\s*=\s*\{/;
  const DEFINES_INSTALL_FIXTURE_TREE = /(?:export\s+)?function\s+installFixtureTree\(/;

  it('found the test tree it is scanning', () => {
    // A scan over an empty list passes everything. Each directory is checked
    // separately so a moved or renamed sibling turns this red on its own,
    // rather than the other directory's file count silently covering for it
    // (the same reason the ccd-script-path finding's own version of this
    // check does it directory-by-directory rather than on the flattened sum).
    for (const d of testDirs) expect(sources(d).length, rel(d)).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(40);
    expect(testFiles.map(rel)).toContain('server/test/installTreeFixture.ts');
    expect(testFiles.map(rel)).toContain('server/test/ccrc-installFixture.ts');
    expect(testFiles.map(rel)).toContain('server/test/ccrc-install-graphify.test.ts');
    expect(testFiles.map(rel)).toContain('server/test-e2e/helpers.ts');
  });

  it('TREE_FILES is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_TREE_FILES.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('TREE_STUBS is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_TREE_STUBS.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('installFixtureTree is defined in exactly one file, installTreeFixture.ts', () => {
    const holders = testFiles
      .filter((f) => DEFINES_INSTALL_FIXTURE_TREE.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/installTreeFixture.ts']);
  });

  it('is what the two former copy sites now import', () => {
    // Not just "the copies are gone" — that is satisfied by deleting the
    // fixture. Each former copy site must still reach the shared module.
    for (const f of ['ccrc-installFixture.ts', 'ccrc-install-graphify.test.ts']) {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      expect(src, f).toMatch(
        /import\s*\{[^}]*\binstallFixtureTree\b[^}]*\}\s*from\s*'\.\/installTreeFixture\.js'/);
    }
  });
});


// ── D-2375: the scratch-slug predicate ─────────────────────────────────────
describe('one scratch-slug predicate — four prefixes and one infix, three bash sites, one mirror', () => {
  // "Did the harness mint this slug for a throwaway directory?" is asked at
  // three sites that cannot share a function between them:
  //
  //   - `ccrc`'s `_mem_is_scratch` is the rule and carries the measurement.
  //     Its two callers (the census and `--apply`) reach it directly.
  //   - `ccrc-doctor-checks`'s `_check_memory` cannot: the table is sourced
  //     under `set -u` by things that are not `ccrc` (`ccrc-doctorFixture.ts`'s
  //     `tableNames()`), so a `declare -F` guard would be the second spelling
  //     with a branch in front of it. D-92's trade, unchanged.
  //   - `session-hook.sh` is installed INTO an agent home and sources nothing
  //     from this tree at all.
  //
  // So the agreement cannot be structural, and this is the mechanism that
  // holds it instead. It matters more than the usual drift argument does: the
  // hook DERIVES its slug from a live cwd (`pwd -P`), so its own copy can only
  // ever be exercised on the platform the suite runs on — a Linux-only
  // spelling was invisible to every ubuntu leg and to five task reviews, and
  // only `test-macos` caught it. The two read-side sites read a directory
  // NAME, so they are measurable everywhere; this pin is what carries their
  // coverage across to the one site that is not.
  //
  // THE SITE LIST IS THREE BECAUSE THE HOOK ASKS IN SLUG SPACE. It holds the
  // un-lossy value and could ask an exact question of it instead (the
  // completeness critic's C1, 2026-09-10); `_mem_is_scratch`'s own comment
  // records why it does not. If that is ever revisited, this list shrinks to
  // two — a deliberate edit, not a drift.
  const PRED = '-tmp*|-private-tmp*|-var-folders*|-private-var-folders*|*--cc-tmp-*';

  /** The guard line at one site, found by the one token no other line in
   *  these tools carries. Exactly one per file, or the row that reads it is
   *  measuring something it did not mean to. */
  const guardLine = (f: string): string => {
    const hits = codeLines(f).filter((l) => l.includes('-var-folders'));
    expect(hits, `${rel(f)}: expected exactly one scratch-guard code line`).toHaveLength(1);
    return hits[0] ?? '';
  };

  it('is spelled identically at exactly three sites, each named here BY NAME', () => {
    expect(holdersOf(PRED)).toEqual([
      'ccd/ccrc',                 // _mem_is_scratch — the rule, and the measurement
      'ccd/ccrc-doctor-checks',   // _check_memory — spelled here, D-92's trade
      'ccd/session-hook.sh',      // the hook's own case — shares nothing with either
    ]);
  });

  it('each site carries the WHOLE alternation and nothing appended to it', () => {
    // EQUALITY, NOT CONTAINMENT, and the difference is the whole value of this
    // row. `holdersOf` matches with `String.includes`, so the row above stays
    // green when a site APPENDS an alternative — measured 2026-09-10: adding
    // `|-private-var-*` to `session-hook.sh` alone left every Linux-visible
    // row in the tree green while, on Darwin, it would have swept up
    // `/private/var/tmp` and skipped every fixture in `session-hook.test.ts`'s
    // memory-convergence block. Capturing the arm closes both directions at
    // once, and it is what makes the row above's title true.
    for (const f of ['ccd/ccrc', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh']) {
      const m = /case "\$(?:1|slug)" in ([^)]*)\)/.exec(guardLine(path.join(ccrcRoot, f)));
      expect(m, `${f}: the scratch guard is not a case arm this row can read`).toBeTruthy();
      expect(m?.[1], f).toBe(PRED);
    }
  });

  it('no site anywhere in the corpus carries the narrower Linux-only spelling', () => {
    // The row above pins the three KNOWN sites. This one has a different
    // population: a FOURTH site, written anywhere in these tools with the
    // pre-D-2375 rule — which named the OS scratch root on Linux and nothing
    // at all on Darwin.
    for (const f of BASH) {
      const narrow = codeLines(f).filter((l) => /in\s+-tmp\*\)/.test(l));
      expect(narrow, rel(f)).toEqual([]);
    }
  });

  it('no site anywhere in the corpus sweeps up /var/tmp, in either spelling', () => {
    // The widening's UPPER BOUND, and the prefix a careless one takes first:
    // `/var/tmp` survives a reboot by design, `session-hook.test.ts` roots its
    // memory-convergence fixtures there, and skipping it would hide a real
    // fork from the operator.
    //
    // BOTH SPELLINGS, and bare rather than glob-anchored. Measured
    // 2026-09-10, twice: an over-widening written `-var-tmp-*` — a dash before
    // the star, which is what a hand actually writes — slipped a needle
    // anchored as `-var-tmp*`; and `-private-var-tmp` is the spelling a real
    // Darwin box produces, which a Linux-only control cannot see at all.
    for (const needle of ['-var-tmp', '-private-var-tmp']) {
      for (const f of BASH) {
        const swept = codeLines(f).filter((l) => l.includes(needle));
        expect(swept, `${rel(f)} (${needle})`).toEqual([]);
      }
    }
  });

  // KNOWN BOUND, stated rather than implied: a FOURTH site written in some
  // other shell shape — a `[[ ]]` test, a helper of its own — is caught by
  // neither the equality row (it reads three sites by name) nor the narrowing
  // row (it looks for the old `case` spelling). Nothing here scans for an
  // arbitrary re-implementation of the question.
  it('the TypeScript mirror in scratchSlugs.ts carries the same four prefixes and one infix', () => {
    // Three suites state fixture preconditions against this rule and none can
    // import a bash `case`, so `server/test/scratchSlugs.ts` is the one mirror
    // they share. The first cut of D-2375 put a copy in each suite and pinned
    // one of the three; this row is why that is now impossible.
    const src = readFileSync(path.join(ccrcRoot, 'server/test/scratchSlugs.ts'), 'utf8');
    const m = /export const SCRATCH_PREFIXES = \[([^\]]*)\]/.exec(src);
    expect(m, 'scratchSlugs.ts declares no SCRATCH_PREFIXES').toBeTruthy();
    const mirror = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    const arms = PRED.split('|'), infix = arms.pop() ?? '';   // A4: the infix has its own list, below
    expect(mirror).toHaveLength(4);           // an empty capture must not pass as agreement
    expect(mirror).toEqual(arms.map((p) => p.replace(/\*$/, '')).sort());
    // A4: stripping only a TRAILING `*` leaves the infix's leading one on, so
    // `arms.map` above cannot fold it in — `SCRATCH_INFIXES` is its own list.
    const im = /export const SCRATCH_INFIXES = \[([^\]]*)\]/.exec(src);
    expect(im, 'scratchSlugs.ts declares no SCRATCH_INFIXES').toBeTruthy();
    const infixMirror = [...(im?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(infixMirror).toEqual([infix.replace(/^\*/, '').replace(/\*$/, '')]);
  });

  it('no suite re-declares the mirror — scratchSlugs.ts is its only home', () => {
    // The same two directories the scans above enumerate rather than name:
    // an unscanned sibling is the "clean and unchecked becomes dirty and
    // unchecked with nothing saying so" shape this file already refuses.
    const holders = [path.join(ccrcRoot, 'server', 'test'),
      path.join(ccrcRoot, 'server', 'test-e2e')]
      .flatMap(sources)
      // ANCHORED TO A DECLARATION, not a mention, and that is not cosmetic:
      // the bare needle read the regex literal in the row above and reported
      // THIS file as a second holder (measured). A declaration is what the
      // row claims anyway.
      .filter((f) => /^\s*(?:export\s+)?(?:const|let|var)\s+SCRATCH_(?:PREFIXES|INFIXES)\s*=/m
        .test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/scratchSlugs.ts']);
  });
});
