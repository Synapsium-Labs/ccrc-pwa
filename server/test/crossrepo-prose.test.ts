// Prose that must stay TRUE about cross-repo programmes: README's own
// subsection and its run-lifecycle/mail paragraphs, the immutable Aug 11 ruling,
// and the programme ledger. Every assertion is grounded in the SOURCE it
// describes — `RUN_REFUSE_CODES`, the route handlers, the PWA files, and the
// current build spec's own §9 paragraph — never in a fixed sentence a later edit could
// silently falsify, which is `readme-holds.test.ts`'s founding lesson.
//
// The helpers below are deliberately local. `box-token-census.test.ts:227` and
// `readme-holds.test.ts:27` each spell their own slicer for the same reason:
// `server/test` is not one of `single-definition.test.ts`'s four ROOTS, and a
// shared slicer would couple three unrelated ratchets to one another's anchors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_REFUSE_CODES } from '../../shared/api.js';

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

  it('names the response fields the open route actually sends', () => {
    for (const field of ['homeProject', 'ledgerRepo', 'ledgerAbsPath']) {
      expect(ROUTES, `${field} is not in coord/routes.ts — this loop is over nothing`)
        .toContain(field);
      expect(crossSection(), `the cross-repo section does not name ${field}`).toContain(field);
    }
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
    expect(STORE, 'the running cap no longer counts dispatched non-terminal rows')
      .toContain("dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')");
    expect(STORE, 'the daily cap no longer counts rows dispatched inside its rolling window')
      .toContain('dispatchedAt IS NOT NULL AND dispatchedAt > ?');
    expect(s, 'the section still equates two held workspaces with two running-worker slots')
      .not.toMatch(/two concurrency slots/i);
    expect(s, 'the section does not say concurrency counts dispatched non-terminal runs')
      .toMatch(/concurrency[\s\S]{0,180}?dispatched[\s\S]{0,100}?non-terminal runs/i);
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
});

/** The run-lifecycle numbered list alone — its own bold lead-in to the mail-bus
 *  paragraph that follows it. Deliberately NOT the whole "Fleet coordination"
 *  section: a code named in the mail-bus paragraph must not satisfy a claim
 *  about the route that emits it. */
const lifecyclePassage = (): string =>
  passage('README, the run lifecycle', README, '**Run lifecycle**', '\n**The mail bus');

/** The programme-mail paragraph alone, between the mail-bus paragraph (whose
 *  own passage `box-token-census.test.ts:307-339` pins count-free) and the caps
 *  paragraph (likewise, `:341-360`). Both anchors are those files' anchors, so
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
    const sameDispatch = same.lastIndexOf('dispatch');
    for (const [marker, at] of [
      ['same `sessionId`', sameOpen], ['`final:false`', sameClose],
      ['closed row', sameClosed], ['dispatch', sameDispatch],
    ] as const) {
      expect(at, `same-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(sameOpen, 'same-project producer closes before successor open').toBeLessThan(sameClose);
    expect(sameClose).toBeLessThan(sameClosed);
    expect(sameClosed).toBeLessThan(sameDispatch);

    // D-2740 fix round 1 (Fix 4): bounded at step 6, exactly as
    // `readme-holds.test.ts:62` bounds its own `crossing` slice — an unbounded
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
    expect(cross, 'cross-project succession makes merge proof universal instead of dependency-gated')
      .toMatch(/if the consumer depends[\s\S]{0,160}?independently prove[\s\S]{0,200}?producerSha/i);
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
    const crossDispatch = cross.lastIndexOf('dispatch');
    for (const [marker, at] of [
      ["without the producer's sessionId", crossOpen], ['`final:true`', crossClose],
      ['`released:true`', crossRelease], ['closed row', crossClosed],
      ['If the consumer depends', crossDependency], ['independently prove', crossMerge],
      ['dispatch', crossDispatch],
    ] as const) {
      expect(at, `cross-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(crossOpen, 'cross-project producer closes before successor open').toBeLessThan(crossClose);
    expect(crossClose).toBeLessThan(crossRelease);
    expect(crossRelease).toBeLessThan(crossClosed);
    expect(crossClosed).toBeLessThan(crossDependency);
    expect(crossDependency).toBeLessThan(crossMerge);
    expect(crossMerge).toBeLessThan(crossDispatch);

    // D-2740 fix round 1 (Fix 3): scoped PER ARM, not once over the whole
    // passage `p`. Measured by the reviewer: replacing `headRefOid` with plain
    // text in the cross arm ALONE left every predicate below green, because
    // the same-project arm's own copy of the evidence still satisfied both the
    // containment loop and the SHA-chain regex — the two arms were alibiing
    // each other. Mutation row W3-2 requires "a dependency-bearing arm loses
    // its conditional same-SHA merge proof" to go red for EACH arm
    // independently; checking `p` once cannot detect a single-arm mutation.
    for (const [armName, arm] of [['same-project', same], ['cross-project', cross]] as const) {
      for (const evidence of ['handoffCommit', 'ccd pr-state --session', 'phase', 'headRefOid', 'producerSha']) {
        expect(arm, `${armName} producer merge proof does not name ${evidence}`).toContain(evidence);
      }
      expect(arm, `${armName}'s named producer SHA is not pinned to the closed row and raw PR row`)
        .toMatch(/`headRefOid`[\s\S]{0,160}?`handoffCommit`[\s\S]{0,120}?`producerSha`/);
    }
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
