// Prose that must stay TRUE about cross-repo programmes: README's own
// subsection and its run-lifecycle/mail paragraphs, the immutable Aug 11 ruling,
// and the programme ledger. Every assertion is grounded in the SOURCE it
// describes — `RUN_REFUSE_CODES`, the route handlers, the PWA files, and the
// current build spec's own §9 paragraph — never in a fixed sentence a later edit could
// silently falsify, which is `readme-holds.test.ts`'s founding lesson.
//
// The helpers below are deliberately local. `box-token-census.test.ts:239` and
// `readme-holds.test.ts:29` each spell their own slicer for the same reason:
// `server/test` is not one of `single-definition.test.ts`'s four ROOTS, and a
// shared slicer would couple three unrelated ratchets to one another's anchors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDLE_RUN_STATES, RUN_REFUSE_CODES, TERMINAL_RUN_STATES } from '../../shared/api.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

const README = read('README.md');
const ROUTES = read('server/src/coord/routes.ts');
const STORE = read('server/src/coord/store.ts');

/** A named window of a document, from one distinctive marker to the next, so a
 *  match anywhere else in a 2500-line file cannot satisfy an assertion about
 *  this passage. Both anchors are asserted present with their own message: a
 *  moved heading and a deleted paragraph are different repairs. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
  return out;
};

/** README's cross-repo subsection alone — its own `###` heading to the next
 *  `###`, which is `### Workspace holds & programs`. */
const crossSection = (): string =>
  passage('README, the cross-repo subsection', README,
    '### Cross-repo programmes: one home, waves anywhere', '\n### ');

/** Every refusal code whose name ENDS in `-mismatch`, derived from the wire's
 *  own list rather than typed here. A third one lands the day it is declared,
 *  and this section reds until it is documented — which is the whole reason to
 *  derive rather than to list. */
const MISMATCH_CODES = RUN_REFUSE_CODES.filter((c) => c.endsWith('-mismatch'));

describe('README: cross-repo programmes', () => {
  it('names every -mismatch refusal the wire declares, with its status and its by', () => {
    // ANTI-VACUITY FIRST. If wave 1 is not in the tree the filter is empty and
    // every loop below passes over nothing — the exact failure mode this file's
    // header warns about. Refuse instead: this wave runs last, by construction.
    expect(MISMATCH_CODES.length,
      'no -mismatch codes in RUN_REFUSE_CODES — wave 1 has not landed, so this wave is out of order')
      .toBeGreaterThanOrEqual(2);
    const s = crossSection();
    for (const code of MISMATCH_CODES) {
      expect(s, `the cross-repo section does not name the refusal \`${code}\``).toContain(`\`${code}\``);
    }
    expect(s, 'the section names the refusals without their status').toContain('409');
    expect(s, 'the section drops `by`, which is the only field that says WHICH project')
      .toContain('"by"');
  });

  it("names the open response's own fields, and homeProject as the request field it actually is", () => {
    // D-2754: this loop used to include `homeProject`, which is never a key
    // in the open route's response object (`routes.ts:1299-1315` sends `ok`,
    // `id`, `program`, `state`, `ledgerPath`, `ledgerRepo`, `ledgerAbsPath`) —
    // it is the REQUEST body field the route destructures off `body`
    // (`:1142`). The loop passed anyway because `ROUTES` contains both uses
    // of the literal and `crossSection()` names `homeProject` for an
    // unrelated reason (the open call's own request contract, README:1488).
    for (const field of ['ledgerPath', 'ledgerRepo', 'ledgerAbsPath']) {
      expect(ROUTES, `${field} is not in coord/routes.ts — this loop is over nothing`)
        .toContain(field);
      expect(crossSection(), `the cross-repo section does not name ${field}`).toContain(field);
    }
    // D-2754, fix rounds 5 and 6: both halves below used to be bare
    // `toContain('homeProject')` — the same call the bug was, relabelled. `routes.ts`
    // holds the token many times over (a comment at `:329`, live code at `:1155`, and
    // helpers), so any one of them alibied the destructure; and `crossSection()` names
    // it three further times, so rewording the request-contract sentence alone left the
    // suite green. Round 5's replacement was still file-wide while its message named
    // the open handler: adding the token to ANOTHER registration's destructure kept it
    // green. Both halves now pin the one construct they name, and the ROUTES half is
    // scoped to the `POST /api/runs` handler body before it looks.
    const openHandler = (): string =>
      passage('the open route handler', ROUTES,
        "app.post('/api/runs', async (req, reply) => {", "\n  app.post('/api/runs/:id/dispatch'");
    expect(openHandler(), 'the open handler no longer destructures homeProject off the request body')
      .toMatch(/const \{[^}]*\bhomeProject\b[^}]*\} = body;/);
    expect(crossSection(), 'the cross-repo section no longer states the request contract — ' +
      'that the canonical open body takes homeProject on every wave')
      .toMatch(/body takes `homeProject` on every wave/);
  });

  it('pins the mandatory plan read and the dependency-gated producer proof', () => {
    const s = crossSection();
    for (const coordinate of ['homeRepoRoot', 'planRepoPath', 'planSha']) {
      expect(s, `the cross-repo section does not name mandatory ${coordinate}`).toContain(coordinate);
    }
    expect(s, 'the section does not carry the exact named-plan read')
      .toContain('git -C "$homeRepoRoot" show "$planSha:$planRepoPath"');
    expect(s, 'the plan tuple is not required for every foreign-plan wave')
      .toMatch(/every foreign-plan wave[\s\S]{0,220}?homeRepoRoot[\s\S]{0,120}?planRepoPath[\s\S]{0,120}?planSha/i);

    for (const coordinate of ['producerRepoRoot', 'producerSourceRepoPath', 'producerSha']) {
      expect(s, `the dependency-gated producer contract does not name ${coordinate}`).toContain(coordinate);
    }
    expect(s, 'the producer tuple and excerpt are not conditional on an interface dependency')
      .toMatch(/only[\s\S]{0,100}?depends on a producer interface[\s\S]{0,220}?producerRepoRoot[\s\S]{0,240}?inline/i);
    expect(s, 'a no-dependency foreign wave still invents producer evidence')
      .toMatch(/no producer-interface dependency[\s\S]{0,160}?no producer tuple[\s\S]{0,100}?no invented\s+excerpt/i);
    expect(s, 'the section does not carry the exact producer-source read')
      .toContain('git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"');
    expect(s, 'the section does not fail closed when a required immutable object cannot resolve')
      .toMatch(/required immutable blob[\s\S]{0,140}?report and stop/i);
    expect(s, 'the section treats ledgerAbsPath as a plan coordinate')
      .toMatch(/ledgerAbsPath[\s\S]{0,180}?programme ledger/i);
    expect(s, 'the inline excerpt is no longer the dispatched shape authority')
      .toMatch(/inline[\s\S]{0,100}?dispatched[\s\S]{0,80}?shape authority/i);
    expect(s, 'the named plan blob is no longer the requirements authority')
      .toMatch(/plan blob[\s\S]{0,100}?requirements\s+authority/i);
    expect(s, 'the dependency-bearing arm never requires independent merge proof at producerSha')
      .toMatch(/when that dependency exists[\s\S]{0,180}?independently prove[\s\S]{0,180}?producerSha/i);
    expect(s, 'the current README no longer points to the immutable historical ruling')
      .toContain('docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md');
    expect(s, 'the current README no longer says the historical rulings stand')
      .toMatch(/rulings stand/i);
    expect(s).not.toContain('show "HEAD:');
    expect(s).not.toContain('read the home plan by the absolute path');
    expect(s).not.toMatch(/state[^\n]{0,40}`done`[^\n]{0,80}(?:is enough|proves the merge)/i);
  });

  it('states the worker role AND the runId rule that keeps a worker off the refusal', () => {
    expect(ROUTES, "the send route no longer carries the 'worker' literal — this check is over nothing")
      .toContain("'worker'");
    const s = crossSection();
    expect(s, "the section does not name the worker role").toContain("toId: 'worker'");
    expect(s, "the section does not name the coordinator role beside it").toContain("toId: 'coordinator'");
    // WITHIN ONE WINDOW, not merely both present somewhere: the rule is that a
    // `worker` mail carries a runId, and a section that names the role in one
    // paragraph and `runId` four paragraphs later has not stated the rule.
    expect(s, 'the section describes the worker role without the runId rule beside it')
      .toMatch(/toId: 'worker'[\s\S]{0,700}?runId/);
    expect(s, 'the section does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
  });

  it('distinguishes outstanding mail, full mail history, and the feed archive', () => {
    // THE HANDLER BODY, NOT THE GAP TO THE NEXT REGISTRATION. Each handler is
    // grounded in the query keys it actually reads before README's prose is
    // checked, so a route name alone cannot satisfy this test.
    const feed = passage('the feed handler', ROUTES, "app.get('/api/feed'", '\n  });');
    const mail = passage('the mail list handler', ROUTES, "app.get('/api/mail'", '\n  });');
    expect(feed, 'the feed handler does not read `q.program` — wave 1 has not landed').toContain('q.program');
    expect(mail, 'the mail list handler does not read `q.program` — wave 1 has not landed').toContain('q.program');
    expect(mail, 'the mail handler no longer reads `q.all` — full history is not selectable').toContain('q.all');
    const s = crossSection();
    expect(s, 'the section does not name the exact full-history URL')
      .toContain('GET /api/mail?program=<slug>&all=1');
    expect(s, 'the section does not say the default programme mail read is outstanding-only')
      .toMatch(/GET \/api\/mail\?program=<slug>`[\s\S]{0,120}?outstanding/i);
    expect(s, 'the section does not name the feed filter').toContain('GET /api/feed?program=');
    expect(s, 'the section does not state that the feed is the full archive')
      .toMatch(/feed[\s\S]{0,120}?full\s+(?:feed\s+|event\s+)?archive/i);
    expect(s, 'the section does not say what happens to an event with no run behind it')
      .toContain('programless');
    // The mailbox and the thread are two different questions, and the route
    // refuses a request that asks both at once. Grounded in the guard itself,
    // so the day `to` and `program` stop being mutually exclusive the sentence
    // saying they are reds with it.
    expect(mail, 'the mail handler no longer refuses both-or-neither — this claim is over nothing')
      .toContain('(to === null) === (program === null)');
    expect(s, 'the section does not say `to` and `program` are mutually exclusive')
      .toMatch(/`to`[\s\S]{0,120}?`program`[\s\S]{0,60}?mutually exclusive/i);
    expect(s, 'the section does not say what naming both answers')
      .toMatch(/naming both[\s\S]{0,60}?400/i);
    expect(s, 'the folded sentence came back — `to` is not merely optional beside `program`')
      .not.toMatch(/`to` becomes optional/);
  });

  it("names the board's three cues, grounded in the PWA files that render them", () => {
    const runsScreen = read('pwa/src/screens/RunsScreen.tsx');
    const card = read('pwa/src/fleet/ProjectCard.tsx');
    expect(runsScreen, 'the runs screen carries no `run-project` — wave 2 has not landed')
      .toContain('run-project');
    expect(card, 'the project card carries no `abroad` — wave 2 has not landed').toContain('abroad');
    const s = crossSection();
    expect(s, 'the section does not name the badge the runs screen renders').toContain('run-project');
    expect(s, "the section does not name the home card's abroad line").toContain('abroad');
    // The board's own two-cue rule, said where an operator reads it: a marker
    // that is only a colour is a marker half the fleet cannot see.
    expect(s, 'the section describes the crossing marker without the two-cue rule')
      .toMatch(/by colour alone/i);
  });

  it('states the measured cap predicates, not a workspace-to-slot equivalence', () => {
    const s = crossSection();
    // PIN THE DERIVATION, NOT A HAND-WRITTEN LIST. This assertion used to spell
    // `('done','failed')` inline, which went red the moment PR #108 narrowed the
    // predicate from "non-terminal" to "active" — correctly, and the README said
    // the old thing for a day. The store now builds the list from
    // `IDLE_RUN_STATES ∪ TERMINAL_RUN_STATES`, so this pins that it is BUILT
    // rather than retyped, and the membership assertion below pins what the two
    // lists mean. A spelling pin would have to be re-edited by every change to
    // either list; this one only reds when the derivation itself is broken.
    expect(STORE, 'the running cap no longer counts dispatched rows by a DERIVED inactive list')
      .toContain('dispatchedAt IS NOT NULL AND state NOT IN ${INACTIVE_RUN_STATES_SQL}');
    expect(STORE, 'INACTIVE_RUN_STATES_SQL is no longer built from the two shared lists')
      .toMatch(/const INACTIVE_RUN_STATES_SQL =[^\n]*IDLE_RUN_STATES[^\n]*TERMINAL_RUN_STATES/);
    expect([...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES].slice().sort(),
      'the states excluded from the running cap are no longer idle ∪ terminal')
      .toEqual(['awaiting-review', 'closing', 'done', 'failed', 'merging', 'planned']);
    expect(STORE, 'the daily cap no longer counts rows dispatched inside its rolling window')
      .toContain('dispatchedAt IS NOT NULL AND dispatchedAt > ?');
    expect(s, 'the section still equates two held workspaces with two running-worker slots')
      .not.toMatch(/two concurrency slots/i);
    expect(s, 'the section does not say concurrency counts dispatched runs in an ACTIVE state')
      .toMatch(/concurrency[\s\S]{0,180}?dispatched runs in\s*\n?an ACTIVE state/i);
    expect(s, 'the section does not say an IDLE run gives its slot back without closing')
      .toMatch(/IDLE[\s\S]{0,120}?gives its slot back without closing/i);
    expect(s, 'the section does not say a planned undispatched consumer uses no running slot')
      .toMatch(/planned[\s\S]{0,80}?undispatched[\s\S]{0,100}?no running-worker slot/i);
    expect(s, 'the section does not say a terminal retained producer uses no running slot')
      .toMatch(/terminal[\s\S]{0,80}?producer[\s\S]{0,100}?no running-worker slot/i);
    expect(s, 'the section does not state that every accepted dispatch consumes daily budget')
      .toMatch(/each[\s\S]{0,60}?dispatch[\s\S]{0,80}?daily/i);
    for (const code of ['cap-concurrency', 'cap-daily']) {
      expect(RUN_REFUSE_CODES as readonly string[],
        `${code} is not a declared RunRefuseCode — this claim is over nothing`).toContain(code);
      expect(s, `the section does not keep \`${code}\` authoritative`).toContain(code);
    }
    // README's caps paragraph stays count-free; the cross-repo subsection names
    // predicates rather than preserving the now-refuted hand-kept count.
    const caps = passage('README, the caps paragraph', README, '**Caps and pause.**', 'Pause is a');
    expect(caps, 'the cross-repo accounting was moved into the count-free caps paragraph')
      .not.toMatch(/\btwo\b/i);
  });

  it('the heir inherits outstanding mail, grounded in the worker-arm predicate it reuses (D-2747)', () => {
    // D-2747: the paragraph used to say "undelivered", which
    // OUTSTANDING_STATES_SQL (`('queued','delivered')`, store.ts:400) refutes
    // — a `delivered`-but-unacked row IS outstanding, not undelivered.
    // `bindSession` calls `requeueAbandonedMail` with role 'worker', whose
    // source predicate for THAT arm is this exact literal; the coordinator
    // arm (`ABANDONED_PARK_SQL`) is a different predicate and is unreachable
    // from `bindSession`, so the claim is grounded in the worker arm only,
    // never generalised to the whole private method.
    expect(STORE, "the worker-arm requeue predicate is not 'd.state IN ${OUTSTANDING_STATES_SQL}' — this claim is over nothing")
      .toContain('d.state IN ${OUTSTANDING_STATES_SQL}');
    // D-2754: `crossSection()` is 7472 chars and contains THREE unrelated
    // `/outstanding/i` matches (the heir sentence, the programme-mail read,
    // and the feed's no-split sentence) — a positive `.toMatch` against the
    // whole section is satisfied by the other two even with the heir
    // paragraph deleted entirely, so it can never fire for its stated
    // subject. Slice the heir paragraph itself first, exactly as the D-2680
    // describe in `readme-holds.test.ts` slices its own crossing sub-passage,
    // and assert against that slice instead.
    const heir = passage('the heir paragraph', crossSection(),
      "When a run's session is replaced", "**Finding a programme's traffic.**");
    expect(heir, 'the section does not say the heir inherits outstanding mail')
      .toMatch(/outstanding/i);
    expect(heir, 'the section still calls outstanding mail undelivered')
      .not.toMatch(/undelivered/i);
  });
});

/** The run-lifecycle numbered list alone — its own bold lead-in to the mail-bus
 *  paragraph that follows it. Deliberately NOT the whole "Fleet coordination"
 *  section: a code named in the mail-bus paragraph must not satisfy a claim
 *  about the route that emits it. */
const lifecyclePassage = (): string =>
  passage('README, the run lifecycle', README, '**Run lifecycle**', '\n**The mail bus');

/** The programme-mail paragraph alone, between the mail-bus paragraph (whose
 *  own passage `box-token-census.test.ts:319-352` pins count-free) and the caps
 *  paragraph (likewise, `:353-371`). Both anchors are those files' anchors, so
 *  a paragraph inserted into either pinned slice by mistake fails HERE with a
 *  length or ordering error rather than confusing the census. */
const programmeMailPassage = (): string =>
  passage('README, the programme-mail paragraph', README,
    '**Programme mail at scale.**', '\n**Caps and pause.**');

describe('README: the run lifecycle and programme mail', () => {
  it('names each -mismatch refusal in the lifecycle step that emits it', () => {
    expect(MISMATCH_CODES.length, 'no -mismatch codes — wave 1 has not landed')
      .toBeGreaterThanOrEqual(2);
    const p = lifecyclePassage();
    for (const code of MISMATCH_CODES) {
      expect(p, `the run lifecycle does not name \`${code}\` in the step that emits it`)
        .toContain(`\`${code}\``);
    }
    // THE ORDERING CLAIM, which is the whole reason the dispatch refusal is
    // safe: spec §3 F1 requires the resume-arm check BEFORE the hold, the
    // `/clear` and the transition. A README that names the code without saying
    // when it fires has documented a refusal and hidden its one guarantee.
    expect(p, 'the lifecycle names the dispatch refusal without saying it fires before the hold')
      .toMatch(/before the hold/i);
  });

  it('states where each refusal is measured, not merely that it exists', () => {
    const p = lifecyclePassage();
    expect(p, "step 1 does not say the open refusal happens before the row is opened")
      .toMatch(/before the row is opened/i);
    expect(p, 'the lifecycle does not name the field the home refusal compares')
      .toContain('homeProject');
    for (const field of ['ledgerRepo', 'ledgerAbsPath']) {
      expect(ROUTES, `${field} is not in coord/routes.ts — this loop is over nothing`)
        .toContain(field);
      expect(p, `step 1 does not name the response field ${field}`).toContain(field);
    }

    const same = passage('README, same-project succession', p,
      'For a same-project successor', 'For a cross-project successor');
    const sameOpen = same.indexOf('same `sessionId`');
    const sameClose = same.indexOf('`final:false`');
    const sameClosed = same.indexOf('closed row');
    // D-2740, fix round 6: `same.lastIndexOf('dispatch')` pinned the WORD, not the
    // gate — this arm holds `dispatch` exactly once, inside the gate sentence, so a
    // reword that kept the word left it green. Derived from the gate sentence itself,
    // as the cross arm now is.
    const sameDispatch = same.indexOf('Only then dispatch');
    for (const [marker, at] of [
      ['same `sessionId`', sameOpen], ['`final:false`', sameClose],
      ['closed row', sameClosed], ['Only then dispatch', sameDispatch],
    ] as const) {
      expect(at, `same-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(sameOpen, 'same-project producer closes before successor open').toBeLessThan(sameClose);
    expect(sameClose).toBeLessThan(sameClosed);
    expect(sameClosed).toBeLessThan(sameDispatch);

    // D-2745: this passage (the run-lifecycle list, steps 1-6) is pinned
    // TWICE, by two suites in two files with different slicers, and neither
    // is discoverable from the other. This file's `lifecyclePassage()`
    // ('**Run lifecycle**' → '\n**The mail bus') pins the MECHANISM names
    // (response fields, refusal codes, evidence tokens) over the whole list.
    // `server/test/readme-holds.test.ts`'s D-2680 describe pins the
    // operator-visible SENTENCES as literals over the same region, via its
    // own `lifecycleSection()` ('**Run lifecycle**' → '**The mail bus and
    // its token.**') and a further '\n6. ' sub-slice on the crossing. An
    // edit to this passage must be run against BOTH files.
    //
    // D-2740 fix round 1 (Fix 4): bounded at step 6, exactly as
    // `readme-holds.test.ts:70` bounds its own `crossing` slice — an unbounded
    // slice ran past step 5 into step 6 and beyond, and mutation 5b measured a
    // cross-arm anchor (`final:true`) resolving there instead of failing.
    const cross = passage('README, cross-project succession', p,
      'For a cross-project successor', '\n6. ');
    expect(cross, 'cross-project succession does not omit the producer session')
      .toMatch(/without the producer's\s+`sessionId`/);
    expect(cross, 'cross-project succession does not verify the closed producer')
      .toMatch(/closed row[\s\S]{0,100}?`done`/i);
    expect(cross, '`done` is incorrectly treated as merge proof')
      .toMatch(/`done`[\s\S]{0,180}?not[\s\S]{0,40}?merge proof/i);
    // D-2740: the brief's literal `cross.indexOf("without the producer's
    // \`sessionId\`")` never matches this passage — the prescribed prose wraps
    // that phrase across a line, so the literal reads -1. The sibling assertion
    // two lines up already used `\s+` and passed; this one is now the same
    // shape, searched rather than indexed so its offset still orders below.
    const crossOpen = cross.search(/without the producer's\s+`sessionId`/);
    const crossClose = cross.indexOf('`final:true`');
    const crossRelease = cross.indexOf('`released:true`');
    const crossClosed = cross.indexOf('closed row');
    const crossDependency = cross.indexOf('If the consumer depends');
    const crossMerge = cross.indexOf('independently prove');
    // D-2740 fact (1), closed this fix round: `lastIndexOf('dispatch')`
    // resolved to the trailing caveat's "report and do not dispatch", never to
    // any of the arm's own three `dispatch` occurrences. Derived from the gate
    // sentence itself instead, which the arm states exactly once.
    const crossDispatch = cross.indexOf('Only then dispatch');
    for (const [marker, at] of [
      ["without the producer's sessionId", crossOpen], ['`final:true`', crossClose],
      ['`released:true`', crossRelease], ['closed row', crossClosed],
      ['If the consumer depends', crossDependency], ['independently prove', crossMerge],
      ['Only then dispatch', crossDispatch],
    ] as const) {
      expect(at, `cross-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(crossOpen, 'cross-project producer closes before successor open').toBeLessThan(crossClose);
    expect(crossClose).toBeLessThan(crossRelease);
    expect(crossRelease).toBeLessThan(crossClosed);
    expect(crossClosed).toBeLessThan(crossDependency);
    expect(crossDependency).toBeLessThan(crossMerge);
    expect(crossMerge).toBeLessThan(crossDispatch);

    // D-2746 fix round 2: scoped THREE predicates PER ARM, not once over the
    // whole passage `p` (round 1 only scoped two of the three). Measured by
    // the coordinator: 8 arm-local mutations left every p-wide predicate
    // green, because each arm's own copy alibied the other's mutation. The
    // THIRD hole round 1 missed: the dependency-gate regex below was left
    // cross-only — deleting "If the consumer depends on an interface from
    // this producer," from the SAME-project arm left every scoped assertion
    // green, because nothing checked that arm's own dependency gate. All
    // three predicates now run over `same` and over `cross` independently.
    //
    // Fix round (review 170 F10): the cross arm's own workspace is RELEASED
    // by its `final:true` close, and a CHILD producer's release queues its
    // reclaim, which purges the row `ccd pr-state --session` would need — so
    // that proof, done AFTER this close, usually cannot run (a race the
    // same-project arm never has: its `final:false` close never releases the
    // workspace `ccd pr-state --session` reads). The cross arm now proves the
    // merge by PR NUMBER instead, and only NAMES `ccd pr-state --session` to
    // FORBID it after the close — so it is no longer common "evidence" the
    // shared loop below asserts of both arms; `phase` and `ccd pr-state
    // --session` (the same-project arm's own, still-used mechanism) and the
    // cross arm's own PR-number mechanism are each asserted against their own
    // arm below, tied to the actual sentence rather than as bare substrings.
    for (const [armName, arm] of [['same-project', same], ['cross-project', cross]] as const) {
      for (const evidence of ['handoffCommit', 'headRefOid', 'producerSha']) {
        expect(arm, `${armName} producer merge proof does not name ${evidence}`).toContain(evidence);
      }
      expect(arm, `${armName}'s named producer SHA is not pinned to the closed row and raw PR row`)
        .toMatch(/`headRefOid`[\s\S]{0,160}?`handoffCommit`[\s\S]{0,120}?`producerSha`/);
      expect(arm, `${armName} succession makes merge proof universal instead of dependency-gated`)
        .toMatch(/if the consumer depends[\s\S]{0,160}?independently prove/i);
    }

    // Same-project (fix round, review 170/fr-J-r1 M2/N3): two SEPARATE
    // bindings, restoring the pre-F10 tightness the merged M2 regex had
    // loosened. (1) the OPENING sentence's own "prove the producer PR merged
    // at `producerSha`" — measured 47 chars from "independently prove" — is
    // bound on its own, tightly, so deleting "at `producerSha`" from that
    // sentence reds here (it did not before: the merged regex's lazy match
    // skipped past it to the LATER equality clause's `producerSha`, 312
    // chars on, and stayed green). (2) the session-based mechanism
    // (`ccd pr-state --session`, `phase`, and that same later `producerSha`)
    // is its own, separate assertion — unaffected by anything the cross arm
    // does.
    expect(same, 'same-project succession does not bind its opening sentence to `producerSha` directly')
      .toMatch(/independently prove[\s\S]{0,60}?producerSha/i);
    expect(same, 'same-project succession does not prove merge by session, reading `phase`')
      .toMatch(/`ccd pr-state --session[\s\S]{0,150}?`phase`[\s\S]{0,170}?producerSha/i);

    // Cross-project (review 170 M2, corrected fr-J-r1 N1): proof is BY PR
    // NUMBER, tied to the one sentence that states it — `gh pr view`,
    // `--repo`, `producerRepoRoot` (M1's `--repo` value, now N1's derivation:
    // `gh repo view --json nameWithOwner` run FROM INSIDE `producerRepoRoot`)
    // and `MERGED`, each measured in the order and proximity the prose
    // actually uses them, not as bare substrings anywhere in a wide window.
    // The distance from "independently prove" to the first `producerSha`
    // (measured here at 1141-481=660 chars) is THIS clause — the `gh pr
    // view`/`--repo`/`producerRepoRoot` derivation N1 added on top of M1 —
    // never the later "Never … after this close" caution, which sits
    // further on past that first `producerSha` and is bound by its own
    // regex below.
    expect(cross, 'cross-project succession does not prove merge by PR number, scoped to producerRepoRoot, requiring MERGED')
      .toMatch(/independently prove[\s\S]{0,60}?`gh pr view[\s\S]{0,30}?--repo[\s\S]{0,170}?producerRepoRoot[\s\S]{0,400}?`MERGED`[\s\S]{0,90}?producerSha/i);
    expect(cross, 'cross-project succession does not forbid the session-scoped proof after its close')
      .toMatch(/never[\s\S]{0,40}?`ccd pr-state --session[\s\S]{0,40}?after this close/i);
  });

  it('the programme-mail paragraph names both roles and the exact read semantics', () => {
    const p = programmeMailPassage();
    expect(p, 'the paragraph does not name the worker role').toContain("toId: 'worker'");
    expect(p, 'the paragraph does not name the coordinator role').toContain("toId: 'coordinator'");
    expect(p, 'the paragraph does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
    expect(p, 'the paragraph does not name the exact full-history URL')
      .toContain('GET /api/mail?program=<slug>&all=1');
    expect(p, 'the paragraph does not say the default programme mail read is outstanding-only')
      .toMatch(/GET \/api\/mail\?program=<slug>`[\s\S]{0,120}?outstanding/i);
    expect(p, 'the paragraph does not name the feed filter').toContain('GET /api/feed?program=');
    expect(p, 'the paragraph does not say the feed is the full archive')
      .toMatch(/feed[\s\S]{0,120}?full\s+(?:feed\s+|event\s+)?archive/i);
    // The heir promise, and the one writer it is kept in — grounded, so a
    // rename of the funnel reds the sentence that names it.
    const store = read('server/src/coord/store.ts');
    expect(store, 'bindSession is gone from the store — wave 1 has not landed').toContain('bindSession');
    expect(p, 'the paragraph does not name the funnel the heir promise is kept in')
      .toContain('bindSession');
    // D-2742: the identical `to`/`program` correction Task 1 made in the
    // cross-repo subsection has a second, independent copy here — the
    // programme-mail paragraph's own read-semantics sentence, which the plan
    // originally wrote as "`to` becomes optional when `program` is given", a
    // claim `server/src/coord/routes.ts:1046-1048` refutes: the two are
    // mutually exclusive, and naming both is a 400.
    expect(p, 'the paragraph does not say `to` and `program` are mutually exclusive')
      .toMatch(/`to`[\s\S]{0,120}?`program`[\s\S]{0,60}?mutually exclusive/i);
    expect(p, 'the folded sentence came back — `to` is not merely optional beside `program`')
      .not.toMatch(/`to` becomes optional/);
  });

  it('does not disturb the two count-free paragraphs it sits between', () => {
    // Locality, asserted rather than hoped: the new paragraph must be OUTSIDE
    // both pinned slices. If it landed inside either, that slice would now
    // contain this paragraph's own text — which these two checks catch here,
    // with a message that says what to do, instead of in the census with a
    // message about hand-kept door counts.
    const mailBus = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    expect(mailBus, 'the programme-mail paragraph was inserted INSIDE the pinned mail-bus slice')
      .not.toContain('**Programme mail at scale.**');
    const caps = passage('README, the caps paragraph', README, '**Caps and pause.**', 'Pause is a');
    expect(caps, 'the programme-mail paragraph was inserted INSIDE the pinned caps slice')
      .not.toContain('**Programme mail at scale.**');
  });
});

const LEDGER_PATH = 'docs/superpowers/programs/crossrepo-programmes.md';
const BUILD_SPEC_PATH = 'docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md';
const LEDGER = read(LEDGER_PATH);
const BUILD_SPEC = read(BUILD_SPEC_PATH);

/** The ledger's wave table alone — the `## Waves` heading to the next `## `. */
const ledgerWaves = (): string => passage('the ledger wave table', LEDGER, '## Waves', '\n## ');

describe('the programme ledger', () => {
  it('records a merged PR for every wave this programme has shipped', () => {
    const table = ledgerWaves();
    const rows = new Map(['1', '2', '3'].map((n) => [
      n, table.split('\n').find((l) => l.startsWith(`| ${n} |`)),
    ]));
    for (const n of ['1', '2']) {
      const row = rows.get(n);
      expect(row, `the ledger has no wave ${n} row`).toBeDefined();
      // A PR NUMBER, not a dash: "the ledger's wave table records both PRs" is
      // one of the dogfood's own exit criteria, and a programme that cannot
      // keep its own table is in no position to hold another one to it.
      expect(row!, `wave ${n} names no PR — the row still reads a dash`).toMatch(/#\d+/);
      expect(row!, `wave ${n} is not closed`).toMatch(/merged/i);
    }
    expect(rows.get('2'), 'wave 2 does not record the allocated acceptance corrections')
      .toMatch(/D-2680[\s\S]*D-2687[\s\S]*D-2715[\s\S]*D-2720/);
    expect(rows.get('3'), 'the ledger has no wave 3 row').toBeDefined();
    expect(rows.get('3'), 'wave 3 still says it edits the Aug 11 status line')
      .not.toMatch(/Aug 11 spec's status line/i);
    expect(rows.get('3'), 'wave 3 does not name byte-preservation of the historical Aug 11 spec')
      .toMatch(/byte-preservation[\s\S]{0,100}?historical Aug 11 spec/i);
    // Wave 3 is THIS wave and closes in Task 7, so it is deliberately not
    // required to name its PR or read merged here.
  });

  it("carries the build spec's non-provenance dogfood acceptance concepts", () => {
    // The spec paragraph is the source, but the ledger deliberately expands its
    // corrected provenance sentence into independently mutation-pinned bullets.
    // Ground the remaining concepts in the spec before requiring them in the ledger.
    const para = passage("the spec's dogfood paragraph", BUILD_SPEC,
      '**Dogfood, as its own programme', '\n---');
    const checks: Array<[string, RegExp]> = [
      ['the runs-screen crossing cue', /board[\s\S]{0,100}?crossing[\s\S]{0,100}?wave-2 row/i],
      ['the home-card abroad cue', /abroad line[\s\S]{0,80}?home card/i],
      ['both PRs across two repositories', /wave table records both PRs across two repos/i],
      ['the no-copy rule', /no content moved by copy-paste/i],
      ['the refusal-as-test rule', /`project-mismatch`\s+never fires in anger[\s\S]{0,80}?proof is a test/i],
    ];
    const section = passage('the ledger exit criteria', LEDGER,
      '## Dogfood exit criteria', '\n## ');
    for (const [name, pattern] of checks) {
      expect(para, `the current spec no longer carries ${name}; update this derived guard`)
        .toMatch(pattern);
      expect(section, `the ledger's exit criteria drop ${name}`).toMatch(pattern);
    }
  });

  it('names the dogfood pair and the shape of its open, so the criteria have a subject', () => {
    const section = passage('the ledger exit criteria', LEDGER,
      '## Dogfood exit criteria', '\n## ');
    expect(section, 'the exit criteria do not say the wave-2 run opens without a sessionId')
      .toMatch(/opened without `sessionId`/);
    for (const coordinate of [
      'homeRepoRoot', 'planRepoPath', 'planSha', 'producerRepoRoot',
      'producerSourceRepoPath', 'producerSha',
    ]) {
      expect(section, `the dogfood contract does not carry ${coordinate}`).toContain(coordinate);
    }
    expect(section, 'the dogfood never reads the immutable plan blob')
      .toMatch(/reads that exact plan blob/);
    expect(section, 'the dogfood does not say why its conditional producer contract is present')
      .toMatch(/depends on wave 1's producer interface/);
    expect(section, 'the dogfood never reads through the producer repository root')
      .toContain('git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"');
    expect(section, 'the plan blob is not identified as the requirements authority')
      .toMatch(/plan blob[\s\S]{0,80}?requirements\s+authority/);
    expect(section, 'the dogfood never reads the immutable producer source blob')
      .toMatch(/reads[\s\S]{0,60}?immutable producer source blob/);
    expect(section, 'the producer source blob is not identified as provenance')
      .toMatch(/producer source blob[\s\S]{0,80}?provenance/);
    expect(section, 'the inline excerpt is no longer the dispatched shape authority')
      .toMatch(/inline excerpt[\s\S]{0,100}?dispatched interface-shape authority/);
    expect(section, 'the dogfood does not require the exact closed producer row to be done')
      .toMatch(/closed producer row[\s\S]{0,60}?`done`/);
    expect(section, 'the dogfood treats done as the whole producer guard')
      .toMatch(/independently proves[\s\S]{0,100}?producer PR merged/);
    expect(section, 'the independent merge proof is not tied to the named producer head')
      .toMatch(/selected PR head[\s\S]{0,80}?same `producerSha`/);
  });
});

describe('the legacy-flip measurement is recorded, whichever way it went', () => {
  it('the ledger carries both numbers and the date they were taken', () => {
    // WHY BOTH NUMBERS (D-2067): spec §3 F2's
    // criterion is "zero `legacy-home-project` events over seven consecutive
    // days", and a box that opened no runs at all in the window satisfies it
    // while proving nothing. `opens_7d` is the denominator that makes the zero
    // mean something, and the ledger must carry it beside the numerator or the
    // record is not a measurement.
    const m = passage('the ledger measurement block', LEDGER, '## Measurements', '\n## ');
    expect(m, 'the measurement does not name the event it counted')
      .toContain('legacy-home-project');
    expect(m, 'the measurement records no legacy-event count').toMatch(/legacy_7d\s*=\s*\d+/);
    expect(m, 'the measurement records no run-open count — the zero above means nothing without it')
      .toMatch(/opens_7d\s*=\s*\d+/);
    expect(m, 'the measurement is undated, so nobody can tell whether the window has moved')
      .toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('says the historical read was an operator act, and names every route that now reads the trail', () => {
    const m = passage('the ledger measurement block', LEDGER, '## Measurements', '\n## ');
    expect(m, 'the measurement does not say where it was taken').toContain('coord.db');
    // GROUNDED THE OTHER WAY NOW (routing slice 5, Task 2, 2026-09-16): this
    // test used to pin `runEvents` absent from every route, with a comment
    // predicting the day that stopped being true. That day arrived —
    // `POST /api/runs/:id/route` legitimately reads it for its own ladder
    // bookkeeping (`priorSameKind`/`lastDemotion`) — so the guard now DERIVES
    // every route whose handler body mentions `runEvents` and requires the
    // ledger to name each one, rather than reverting to a blanket claim
    // nobody re-derives or silently deleting the check a second route would
    // need.
    const starts = [...ROUTES.matchAll(/app\.(get|post)\('([^']+)'/g)]
      .map((h) => ({ key: `${h[1]!.toUpperCase()} ${h[2]!}`, at: h.index! }));
    const runEventsRoutes = starts
      .filter(({ at }, i) => ROUTES.slice(at, starts[i + 1]?.at ?? ROUTES.length).includes('runEvents'))
      .map((h) => h.key);
    expect(runEventsRoutes.length, 'no route reads runEvents any more — the ledger correction ' +
      'naming one can be reverted to the original "no route can serve it" claim').toBeGreaterThan(0);
    for (const route of runEventsRoutes) {
      expect(m, `the ledger measurement block does not name ${route} as now reading runEvents`)
        .toContain(route);
    }
  });
});
