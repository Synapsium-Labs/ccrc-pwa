// The worker skill is prose a model follows unsupervised, in a workspace it can
// wedge and on a fleet it can destroy. It is the coordinator skill's mirror
// image and it gets the same mechanism: the CONTRACT is a literal array, so a
// PARAPHRASE fails exactly as a deletion does, and the destructive verbs are
// counted rather than merely forbidden.
//
// CORPUS = `ccd/worker-skill/SKILL.md` ALONE, and that is a deliberate,
// enforced property rather than an assumption (`the skill carries no
// references of its own` below). The plan's locked decision is that this skill
// POINTS at `../ccrc-coordinator/references/{wave-lifecycle,mail-envelope}.md`
// instead of shipping 35KB of its own copies — both skills install side by side
// under `<config dir>/skills/`, and a second copy of pinned content is a second
// thing to rot. MEASURED at that decision: neither coordinator reference names
// any of the five destructive verbs even once (`coordinator-skill.test.ts`'s
// own census pins all three of ITS verbs to SKILL.md's clause 3), so pointing
// at them licenses nothing this file cannot see.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIL_MAX_ATTEMPTS, type PrPhase } from '../../shared/api.js';
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/worker-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');

/** The frontmatter block. Hoisted because two tests read it now — the shape
 *  check below and the dispatch-prefix pin at the foot of this file — and a
 *  second slice expression is a second thing that has to stay in step with the
 *  first. */
const frontmatter = skill.slice(4, skill.indexOf('\n---', 4));

// The twelve clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 1
// quotes `tmux display-message -p '#S'` and clause 3 quotes `toId:'coordinator'`
// — both carry single quotes, and the sibling suite's single-quoted style would
// need escaping exactly where a copy-paste from SKILL.md is most useful.
// For the same reason SKILL.md is written with STRAIGHT apostrophes throughout:
// `coordinator-skill.test.ts`'s literals carry curly ones (`operator’s`,
// `judgement`) because its prose does, and a straight/curly mismatch is a
// paraphrase failure that reads like a mystery.
//
// D-104, the operative constraint both files live under: NO clause in this
// skill may contain a `"` character, and a curly apostrophe pasted into
// SKILL.md reds this pin without looking like a change. SKILL.md's contract
// section states the same rule where an editor of the prose will see it.
const CONTRACT = [
  "Learn who you are on EVERY call: `fromId` is your own `cc-<id>` from `tmux display-message -p '#S'`, and `fromUuid` is the current contents of `$REG/<id>.uuid`, re-read each time. `/clear` rotates that uuid and dispatch `/clear`s you on every wave >= 2, so a uuid you cached is guaranteed stale.",
  "Commit on THIS workspace's own branch (`ws/<slug>`), never a separate feature branch. The done-fingerprint re-measures the workspace branch's tip, so work parked on a feature branch leaves that tip unmoved and wedges every close `stale-tip` forever (F5 — the server's own `stale-tip` detail names this as the almost-certain cause).",
  // D-105: this clause used to name the 6 for BOTH lanes. It is the
  // PRE-DELIVERY budget only; a delivered-but-unacked nudge has its own.
  "Ack before you act, and key the ack on the row's DELIVERY id, never the mail row's own `id` — a brief that never landed retries `MAIL_MAX_ATTEMPTS` (6) times and then parks unread, while a delivered nudge you leave unacked replays `MAIL_REPLAY_MAX_ATTEMPTS` (20) times and then parks read-but-unanswered. Reply to the coordinator through mail (`toId:'coordinator'`), never by typing into your own pane.",
  "Keep your input box empty. A half-typed draft makes the delivery lane refuse `draft-present`, only you can clear your own text, and a parked delivery means your brief was never read.",
  "Every question for the operator rides the AskUserQuestion tool — the structured ask the session hook captures and the PWA surfaces — never free text in your pane.",
  "Your requirements are the brief plus the plan file it names, including that plan's deviation ledger, and the plan's text governs over your recollection of the spec. Invoke the execution skill the brief names rather than improvising one.",
  "Large payloads travel as files: write the file, then name its ABSOLUTE path in the mail's `artifacts` (a relative entry is refused `bad-kind`). Never ask for content to be pasted into your pane (F7).",
  "Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, at any wave, for any reason.",
  "A done-claim's fingerprint is measured ONCE and sent ONCE: `handoffCommit` must equal the branch tip you measured, and `prPhase` must be one of the eight enum words (`unchecked`, `none`, `no-commits`, `open`, `draft`, `merged`, `closed`, `unknown`). After `wave-done` you stop pushing — a new commit under your own claim makes it stale — and a rejected claim is never re-asserted without new commits and a fresh measurement.",
  "Remote control is decided at your creation, not by you: dispatched workers spawn WITHOUT it (the 2026-08-13 ruling, task #37 — landed), declared by the dispatch path at `ws-add --no-rc` and stamped as the registry's `rc` field, while `~/.ccrc/remote-control` still governs every non-dispatched session on this box. Neither file is yours to write.",
  "Claim before you edit: `POST /api/claims` with every path this wave touches, all-or-nothing. A 409 is an answer, not an obstacle — it names the holder, and the holder IS the address: mail them through the response's own `mailHint` instead of editing anyway. Discovery is `GET /api/peers?of=<your id>`, history is `GET /api/lifecycle`, and each row's own lifecycle is what to read — never its archive stamp, which is silently false on some live rows. Peer mail is human-timescale: a busy peer answers when it next idles, so send once and work what is uncontested. Never invent a deviation number — the coordinator allocated this program's block at run-open, and a number you cannot get is `D-TBD-<slug>` plus a report, never a guess.",
  "When your workspace carries `graphify-out/graph.json`, a question about the codebase goes to `graphify query` before `grep` or a file read, and to `graphify path` / `graphify explain` for relationships and concepts — but weigh that answer by your SessionStart card: only `fresh` licenses taking it as read, while `N commits behind HEAD`, `freshness unmeasured`, or no freshness clause at all makes every query answer a LEAD to verify by opening the file it names. Never run `graphify update` or any graphify build in the workspace: the sweep owns the write side, and a session-side build holds you at `working` for minutes and wedges the next dispatch as `worker-busy`.",
];

/** The forbidding clause, by its own index — named once so a re-ordering of the
 *  array cannot silently point the census at the wrong sentence. */
const FORBIDS = CONTRACT[7]!;

describe('the worker skill: its contract', () => {
  it('carries all twelve clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
    }
  });

  // ── the COUNT, which the verbatim pin above structurally cannot see ──────
  //
  // MEASURED (R2 review, round 2), and both holes are the same hole: the
  // CONTRACT pin is a SUBSET check, so appending a 13th clause to SKILL.md left
  // every assertion in this file GREEN — the contract could be extended with no
  // pin at all, which is the one thing "pinned verbatim" exists to prevent —
  // and reverting "These twelve clauses" to "eleven" in SKILL.md, README.md or
  // CLAUDE.md was green too, because no assertion anywhere held the word. The
  // count was hand-maintained in five places and pinned in none. Both are
  // cardinality claims, so both are now derived from ONE value, `CONTRACT.length`.

  /** Number words, index-addressed — `box-token-census.test.ts`'s own idiom,
   *  aimed here at the single count this repo spells out in prose five times. */
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty'];
  const COUNT_WORD = WORDS[CONTRACT.length];

  it('numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps', () => {
    // `^\d+\. ` matches the contract lines and nothing else in this file — the
    // contract is the only ordered list SKILL.md carries (measured). So a 13th
    // clause forces a 13th literal above instead of slipping past the subset
    // check, and a deleted clause reds here as well as there.
    const numbered = [...skill.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered, 'SKILL.md numbers a different set of clauses than the CONTRACT pins')
      .toEqual(CONTRACT.map((_, i) => i + 1));
  });

  it('spells that same count, as one derived word, everywhere prose states it', () => {
    expect(COUNT_WORD, `${CONTRACT.length} clauses is past the end of WORDS — extend the array`)
      .toBeTruthy();
    // SKILL.md states it twice in its own words ("These twelve clauses", "these
    // twelve lines"). HARVESTED, never matched literally, so a revert to
    // "eleven" fails with the wrong word named rather than with a missing string.
    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines)\b/g)]
      .map((m) => m[1]!).filter((w) => WORDS.includes(w));
    expect(stated.length, 'SKILL.md no longer states its own clause count in prose')
      .toBeGreaterThanOrEqual(2);
    for (const w of stated) {
      expect(w, `SKILL.md says ${w} where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
    }
    // README.md and CLAUDE.md each describe this skill BY PATH, with the count
    // in the same sentence. The sites are derived from that path rather than
    // listed by line number, so a fourth mention is covered the day it lands and
    // a moved paragraph does not silently stop being checked.
    const marker = 'ccd/worker-skill/SKILL.md';
    for (const rel of ['README.md', 'CLAUDE.md']) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      let hits = 0;
      for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) {
        const m = /\b([a-z]+) clauses\b/.exec(text.slice(i, i + 160));
        expect(m, `${rel} names ${marker} without stating how many clauses it has`).not.toBeNull();
        expect(m![1], `${rel} says ${m![1]} clauses where the CONTRACT pins ${CONTRACT.length}`)
          .toBe(COUNT_WORD);
        hits++;
      }
      expect(hits, `${rel} no longer names ${marker} at all`).toBeGreaterThan(0);
    }
  });

  it('names the five destructive verbs ONLY inside the clause that forbids them', () => {
    // A skill that mentions `ws-reap` anywhere else has given a model a reason
    // to consider it. The forbidding clause is the one licensed mention, and
    // the assertion is EQUALITY (not a ceiling): a guard that stays green on an
    // extra mention cannot red for the thing it claims to guard.
    //
    // Five verbs here, three in the coordinator's: a worker sits INSIDE the
    // workspace these verbs delete, so `ws-archive`/`ws-restore` — a
    // coordinator's clutter — are a worker's own foot-gun.
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'ws-archive', 'ws-restore']) {
      const hits = skill.split(verb).length - 1;
      const licensed = FORBIDS.split(verb).length - 1;
      expect(licensed, `${verb} is not named in the forbidding clause at all`).toBeGreaterThan(0);
      expect(hits, `${verb} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('carries no references of its own — the census corpus is the whole skill (D-103)', () => {
    // The plan's locked decision, made mechanical. Two things break the moment
    // a `references/` directory appears here: the duplicate-content ban (the
    // coordinator's references are pinned by their own suite; a copy would be
    // an untested second one), AND the census above, which would quietly stop
    // covering part of the skill it claims to cover.
    expect(readdirSync(skillDir).sort()).toEqual(['SKILL.md']);
    // And the pointer it uses instead is a real relative path from
    // `<config dir>/skills/ccrc-worker/` to the coordinator's own tree.
    for (const ref of ['../ccrc-coordinator/references/wave-lifecycle.md',
      '../ccrc-coordinator/references/mail-envelope.md',
      '../ccrc-coordinator/references/peer-protocol.md']) {
      expect(skill, `the skill points at no ${ref}`).toContain(ref);
      expect(readFileSync(path.join(root, 'ccd/coordinator-skill',
        ref.replace('../ccrc-coordinator/', '')), 'utf8').length,
      `${ref} does not exist in the repo`).toBeGreaterThan(0);
    }
  });

  it('tells the session how to learn its own id the ONE way that works on this box', () => {
    // ccd/session-hook.sh:15-19 — derived from tmux, never from a `from:`
    // field, and never cached: `/clear` rotates `$REG/<id>.uuid`, and dispatch
    // clears this session on every wave >= 2.
    expect(skill).toContain("tmux display-message -p '#S'");
    expect(skill).toContain('cc-');
    expect(skill).toContain('.uuid');
  });

  it('has YAML frontmatter with exactly a name and a description that says when NOT to use it', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    const fm = frontmatter;
    expect(fm).toContain('name: ccrc-worker');
    expect(fm).toMatch(/description:.+/);
    // Two keys, exactly — the coordinator skill's shape. A third key here is
    // either a harness field this repo does not ship or a description that
    // wrapped onto a line starting with a word and a colon.
    expect(fm.split('\n').filter((l) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(l))
      .map((l) => l.slice(0, l.indexOf(':')))).toEqual(['name', 'description']);
    // The anti-use sentence, in the register the coordinator's own description
    // set: the mirror-image failure is a worker that starts dispatching.
    expect(fm.toLowerCase()).toContain(
      'never use it to coordinate a program — a worker that starts dispatching ' +
      'has become a coordinator without a ledger');
  });
});

describe('the worker skill: the facts it states about the wire', () => {
  /**
   * The eight phases, derived from the UNION rather than from a list —
   * `prphase.test.ts`'s idiom, and its reasoning applies here unchanged:
   * `PR_PHASES` is module-private in `shared/api.ts` and importing it would
   * re-open that hole for a test's convenience.
   *
   * This is NOT a weaker duplicate of the clause-9 pin above, which is what
   * would make it worth deleting. That pin is a hand-written literal: it can
   * only ever go red for an edit to the sentence a human already knows about.
   * THIS one goes red for a cause the literal structurally cannot see — a ninth
   * member added to `PrPhase` forces a key into the record below (the tests
   * directory is typechecked, `typecheck-tests.test.ts`), and a skill that
   * still promises eight words then fails: MEASURED on a planted `'x-ninth'`
   * phase, red on the count, and on the word itself once the count is relaxed.
   */
  const ALL_PHASES: Record<PrPhase, true> = {
    unchecked: true, none: true, 'no-commits': true, open: true,
    draft: true, merged: true, closed: true, unknown: true,
  };
  const PHASES = Object.keys(ALL_PHASES) as PrPhase[];

  it('spells every PrPhase word a worker is allowed to claim, and says how many there are', () => {
    expect(PHASES.length).toBe(8);
    for (const phase of PHASES) {
      // Backticked, deliberately: a bare `draft` also matches `draft-present`
      // and a bare `open` matches ordinary prose, so the unquoted form would
      // pass on text that never told the worker the vocabulary at all.
      expect(skill, `the skill never spells the \`${phase}\` phase`).toContain(`\`${phase}\``);
    }
    expect(skill, 'the skill should say the vocabulary is closed at eight').toContain('eight');
  });

  it('states the delivery budget as the number the lane actually enforces', () => {
    // `MAIL_MAX_ATTEMPTS` (shared/api.ts) is 6, and a worker whose input box is
    // occupied has that many ticks before its brief parks unread. DERIVED from
    // the constant rather than typed as a 6, so raising the ceiling turns this
    // red — the clause-9-style literal pin above cannot see that change. The
    // `draft-present` bullet is what satisfies it: a refused draft is a row
    // that was NEVER delivered, which is the one lane this ceiling governs.
    expect(skill, 'the skill states a delivery budget the lane does not enforce')
      .toContain(`${MAIL_MAX_ATTEMPTS} attempts`);
  });

  /**
   * The OTHER ceiling, harvested from `watch.ts`'s source text rather than
   * imported: `MAIL_REPLAY_MAX_ATTEMPTS` is module-private there, and
   * re-exporting it so a test could read it conveniently is the hole
   * `PR_PHASES`' own docstring warns about at length. Harvest-and-compare is
   * this repo's established idiom for exactly that shape (`wsaudit.test.ts`,
   * and the coordinator suite's route/refusal scans). A rename or a deletion
   * throws HERE, at module scope, rather than passing vacuously.
   */
  const REPLAY_CONST = 'MAIL_REPLAY_MAX_ATTEMPTS';
  const replayCeiling = ((): number => {
    const src = readFileSync(path.join(root, 'server/src/watch.ts'), 'utf8');
    const m = new RegExp(`^const ${REPLAY_CONST} = (\\d+);$`, 'm').exec(src);
    if (!m) throw new Error(`watch.ts declares no ${REPLAY_CONST} — this harvest is ` +
      'looking at the wrong file, or the constant was renamed and the skill now cites a ghost');
    return Number(m[1]);
  })();
  /** `\`NAME\` (N)` — the one form the skill states a ceiling in, built from the
   *  live value so a moved constant moves the pattern with it. */
  const cited = (name: string, n: number): string => `\`${name}\` \\(${n}\\)`;

  it('names BOTH delivery ceilings, each with the constant its own lane enforces (D-105)', () => {
    // The two lanes are deliberately separate in the delivery code, and
    // `MAIL_MAX_ATTEMPTS`'s own docstring is emphatic about it: that budget
    // "applies ONLY while a delivery's own `deliveredAt` is still null"
    // (`watch.ts:160-176`), the park is gated on `d.deliveredAt === null`
    // (`:2042`), and a delivered row that is merely never acked parks on
    // `MAIL_REPLAY_MAX_ATTEMPTS` instead (`:207`, park at `:1981-1983`).
    //
    // D-105: clause 3's plan-locked content named the 6 for both, which
    // under-states a worker's real ack window by more than 3x AND calls a mail
    // that was read "parked unread". Both numbers are now cited WITH the
    // constant that owns them, and both are pinned to their source — a policy
    // number restated in prose is only safe while something reds when it moves.
    expect(skill).toContain(`\`MAIL_MAX_ATTEMPTS\` (${MAIL_MAX_ATTEMPTS})`);
    expect(skill).toContain(`\`${REPLAY_CONST}\` (${replayCeiling})`);
  });

  // ── each ceiling BOUND TO ITS OWN LANE ───────────────────────────────────
  //
  // MEASURED, and the reason this shape replaced the first one (fix round 2,
  // re-review): the earlier pair of regexes matched the lane PHRASES only
  // (`never landed … parks unread`, `delivered … unacked … replays`) and left
  // the numbers to the two `toContain` lines above, which do not care WHERE in
  // the file a citation sits. Swapping the two citations between the lanes —
  // both numbers present, both correctly formatted, each attached to the wrong
  // lane, which is D-105's original error with the words rearranged — left all
  // 8 tests GREEN. A guard that cannot red for the very error it was written
  // for is the thing this repo's mutation discipline exists to catch.
  //
  // The verbatim CONTRACT pin cannot cover it either, and that is structural,
  // not an oversight: the pin FORCES its literal to be updated by whoever edits
  // the clause, so an author who "corrects" the sentence wrongly updates the
  // literal in the same breath and the pin follows them. Only an assertion that
  // knows which number belongs to which lane can disagree with that author.
  //
  // Two separate `it`s rather than two `expect`s in one: a failing `expect`
  // throws, so a single test would report the first lane and never evaluate the
  // second — and the swap breaks BOTH lanes, which is what the measurement
  // needs to show. Both patterns are built from the live constants, so a
  // renamed or re-valued ceiling moves the assertion with it instead of
  // silently ceasing to match.
  it('binds the never-landed lane to MAIL_MAX_ATTEMPTS, inside that lane (D-105)', () => {
    expect(skill, `the never-landed lane must cite ${cited('MAIL_MAX_ATTEMPTS', MAIL_MAX_ATTEMPTS)}`)
      .toMatch(new RegExp(
        `never landed[\\s\\S]{0,120}${cited('MAIL_MAX_ATTEMPTS', MAIL_MAX_ATTEMPTS)}[\\s\\S]{0,80}parks unread`));
  });

  it(`binds the delivered-but-unacked lane to ${REPLAY_CONST}, inside that lane (D-105)`, () => {
    expect(skill, `the delivered-but-unacked lane must cite ${cited(REPLAY_CONST, replayCeiling)}`)
      .toMatch(new RegExp(
        `delivered[\\s\\S]{0,120}unacked[\\s\\S]{0,80}replays[\\s\\S]{0,80}${cited(REPLAY_CONST, replayCeiling)}`));
  });
});

describe('the worker skill: the name dispatch invokes it by', () => {
  /**
   * The skill's OWN name, harvested from its frontmatter rather than typed
   * here — the `replayCeiling` idiom above, for the same reason: a pin whose
   * two sides are both hand-written can only ever go red for an edit its
   * author already knows about.
   *
   * A skill is invoked BY NAME and by nothing else. Nothing in the harness
   * resolves `ccrc-worker` to this directory: the installer copies the tree to
   * `<config dir>/skills/ccrc-worker/` and the model reads the frontmatter,
   * so the name in this file and the name in the sentence dispatch mails every
   * worker are two independent strings that MUST agree. Renaming the skill and
   * leaving the prefix behind does not fail anywhere a human would see it — the
   * worker is simply told to run something that does not exist, on a box where
   * no test runs, and gets on with the wave without its standing protocol.
   */
  const SKILL_NAME = ((): string => {
    const m = /^name:\s*(\S+)\s*$/m.exec(frontmatter);
    if (!m) throw new Error('the worker skill\'s frontmatter declares no `name:` — this pin is ' +
      'looking at the wrong file, or the skill lost the one field it is invoked by');
    return m[1]!;
  })();

  it('is the name the dispatch kickoff prefix tells every worker to run', () => {
    // The whole point of the pin: this is a RENAME detector, not a spelling
    // test. `WORKER_KICKOFF_PREFIX` is imported (never harvested as text) so
    // the string under test is the one dispatch actually composes onto a brief.
    expect(WORKER_KICKOFF_PREFIX,
      `dispatch's kickoff prefix does not name the \`${SKILL_NAME}\` skill:\n${WORKER_KICKOFF_PREFIX}`)
      .toContain(`the ${SKILL_NAME} skill`);
  });
});


describe('the worker skill: clause 12 branches on the card the hook actually prints', () => {
  /** Every freshness word the `SessionStart` graph card can carry, HARVESTED
   *  from `ccd/session-hook.sh`'s own assignments and normalised over the count
   *  (`$behind commits behind HEAD` / `1 commit behind HEAD` → `behind HEAD`).
   *
   *  Harvest-and-compare rather than a typed list, this file's `replayCeiling`
   *  idiom: the hook WRITES this vocabulary, and a clause that branches on a
   *  word the hook stopped printing is a rule that can never fire — the exact
   *  failure that a doc three files away drifted into (R2 review). */
  const FRESHNESS = ((): string[] => {
    const hook = readFileSync(path.join(root, 'ccd/session-hook.sh'), 'utf8');
    const vals = [...hook.matchAll(/\bfresh="([^"]+)"/g)].map((m) => m[1]!);
    if (vals.length < 4) throw new Error('ccd/session-hook.sh assigns fewer than the four ' +
      'freshness words this pin was written against — the card was rewritten, or this harvest is ' +
      'looking at the wrong file');
    return [...new Set(vals.map((v) => v.replace(/^(?:\$behind|\d+) commits? /, '')))];
  })();

  /** Word-BOUNDARY match, never a raw substring. `fresh` is a substring of
   *  `freshness unmeasured`, so a `toContain` arm for the one state that
   *  licenses trusting the graph passes on the mere presence of the longer
   *  word and can never fail — vacuous exactly where this describe is most
   *  load-bearing (D-1342). `\bfresh\b` is false on `freshness unmeasured`
   *  and true on the clause's own `` `fresh` ``. */
  const wordRe = (w: string): RegExp =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

  it('names every freshness word the card can carry, and says what each licenses', () => {
    const clause = CONTRACT[CONTRACT.length - 1]!;
    for (const word of FRESHNESS) {
      expect(clause, `clause 12 branches on no card word matching \`${word}\``)
        .toMatch(wordRe(word));
    }
    // The BRANCH, not merely the vocabulary. A clause that lists the words
    // without saying what each one licenses is information delivered with no
    // decision rule attached — a comment standing in for a mechanism, which is
    // what this clause shipped as before the fix.
    expect(clause, 'clause 12 lists the card words but attaches no rule to them')
      .toMatch(/LEAD to verify/);
  });
});
