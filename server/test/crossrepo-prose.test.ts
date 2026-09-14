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
