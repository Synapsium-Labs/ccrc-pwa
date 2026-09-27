// The reviewer skill is prose a model follows unsupervised, in a workspace of
// its own, against a branch it must never write to. Same mechanism as
// worker-skill.test.ts: the CONTRACT is a literal array (a paraphrase fails as
// a deletion does), the destructive verbs and the run routes are COUNTED, and
// the skill ships no references/ of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEWER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/reviewer-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const frontmatter = skill.slice(4, skill.indexOf('\n---', 4));

// Ten clauses, verbatim, DOUBLE-quoted (worker-skill.test.ts's convention and
// its D-104 rule: straight apostrophes only, no `"` inside a clause).
const CONTRACT = [
  "Learn who you are on EVERY call: `fromId` and `fromUuid` come from `ccrc-api whoami`, which reads the pane you are in and REFUSES rather than naming another session. Re-read them each time; a uuid you cached is guaranteed stale after the `/clear` dispatch runs.",
  "Ack before you act, keyed on the row's DELIVERY id, never the mail row's own `id`. Reply to the coordinator through mail (`toId:'coordinator'`, with the `runId` of THIS review run), never by typing into your own pane.",
  "Measure the reviewed tip ONCE, before you read a line: `reviewedTip` is the 40-hex sha of the worker branch the brief names, read from this repository's own ref (`git rev-parse refs/heads/ws/<worker-slug>`). Every finding cites that sha. If the ref moves while you read, say so in the report and stop — a report about two tips is a report about neither.",
  "Read in YOUR OWN worktree only: `git checkout --detach <reviewedTip>` here, and never `checkout` the worker's branch, never commit, amend, rebase, cherry-pick, reset or push it, never open a PR on it, and never `git worktree add` or `remove` anything. This workspace's own branch (`ws/<slug>`) stays where dispatch left it; you land nothing on it.",
  "Run the SDD shape the brief names and nothing lighter: the review lenses over the wave's whole diff against the plan file the brief names (that plan's text governs over your recollection of the spec), then the whole-branch pass, then the suites the plan says to run, in this worktree, at `reviewedTip`.",
  "Report, never rule. This session never calls `POST /api/runs/:id/advance`, `POST /api/runs/:id/close`, `POST /api/runs/:id/dispatch` or `POST /api/ledger/deviations` on any run, never mails the worker, never sends work back and never allocates a deviation number. A finding that needs a ruling is written as such in the report — `needs a ruling:` and the question — and the coordinator rules.",
  "One report, written ONCE: to an absolute path under `$HOME/.cc-clips/<your session id>/`, by temp file and `mv` so a half-written report never exists at that path, named in the `review-done` mail's `artifacts`; after that mail you do not touch it. NOT under this worktree, however readable the file looks to you: the close route stats that path through the agent, whose read allowlist is `.cc-sessions`, `.cc-limits`, `.cc-clips`, `$HOME/.claude*` and the projects root — and every session worktree sits outside all five, so a report beside your checkout is refused `report-unreadable`. The mail's body opens with one JSON line, `{\"reviewedTip\":\"<sha>\",\"report\":\"<absolute path>\"}`, which the coordinator submits to the close route exactly as you wrote it.",
  "Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, for any reason.",
  "Every question rides the AskUserQuestion tool — the structured ask the session hook captures — never free text in your pane; your parent (the coordinator) may answer it before the operator is notified. Keep your input box empty: a half-typed draft makes the delivery lane refuse `draft-present`.",
  "Remote control is decided at your creation, not by you: dispatched reviewers spawn WITHOUT it (`ws-add --no-rc`, the dispatch path's own declaration), and `~/.ccrc/remote-control` governs every non-dispatched session on this box. Neither is yours to write.",
];
const FORBIDS_VERBS = CONTRACT[7]!;
const FORBIDS_ROUTES = CONTRACT[5]!;

describe('the reviewer skill: its contract', () => {
  it('carries all ten clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
    }
  });

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
  const COUNT_WORD = WORDS[CONTRACT.length];

  it('numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps', () => {
    const numbered = [...skill.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered).toEqual(CONTRACT.map((_, i) => i + 1));
  });

  it('spells that same count, as one derived word, everywhere prose states it', () => {
    expect(COUNT_WORD).toBeTruthy();
    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines)\b/g)]
      .map((m) => m[1]!).filter((w) => WORDS.includes(w));
    expect(stated.length, 'SKILL.md no longer states its own clause count').toBeGreaterThanOrEqual(2);
    for (const w of stated) expect(w, `SKILL.md says ${w} where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
    const marker = 'ccd/reviewer-skill/SKILL.md';
    for (const rel of ['README.md', 'CLAUDE.md']) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      let hits = 0;
      for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) {
        const m = /\b([a-z]+) clauses\b/.exec(text.slice(i, i + 160));
        expect(m, `${rel} names ${marker} without stating how many clauses it has`).not.toBeNull();
        expect(m![1], `${rel} says ${m![1]} clauses where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
        hits++;
      }
      expect(hits, `${rel} no longer names ${marker} at all`).toBeGreaterThan(0);
    }
  });

  it('names the five destructive verbs ONLY inside the clause that forbids them', () => {
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'ws-archive', 'ws-restore']) {
      const hits = skill.split(verb).length - 1;
      const licensed = FORBIDS_VERBS.split(verb).length - 1;
      expect(licensed, `${verb} is not named in the forbidding clause`).toBeGreaterThan(0);
      expect(hits, `${verb} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('names the run-mutating routes and the allocator ONLY inside the clause that forbids them (spec §9 inv. 1)', () => {
    for (const route of ['/advance', '/close', '/dispatch', '/api/ledger/deviations']) {
      const hits = skill.split(route).length - 1;
      const licensed = FORBIDS_ROUTES.split(route).length - 1;
      expect(licensed, `${route} is not named in the forbidding clause`).toBeGreaterThan(0);
      expect(hits, `${route} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('never tells the reviewer to write the worker branch — the four git writes appear only in the clause that forbids them', () => {
    const FORBIDS_GIT = CONTRACT[3]!;
    for (const w of ['git push', 'rebase', 'cherry-pick', 'git worktree add']) {
      expect(skill.split(w).length - 1, `${w} appears outside clause 4`).toBe(FORBIDS_GIT.split(w).length - 1);
    }
  });

  it('carries no references of its own and points at the coordinator\'s', () => {
    expect(readdirSync(skillDir).sort()).toEqual(['SKILL.md']);
    for (const ref of ['../ccrc-coordinator/references/wave-lifecycle.md',
      '../ccrc-coordinator/references/mail-envelope.md']) {
      expect(skill, `the skill points at no ${ref}`).toContain(ref);
      expect(readFileSync(path.join(root, 'ccd/coordinator-skill', ref.replace('../ccrc-coordinator/', '')), 'utf8').length)
        .toBeGreaterThan(0);
    }
  });

  it('has YAML frontmatter with exactly a name and a description that says when NOT to use it', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    expect(frontmatter).toContain('name: ccrc-reviewer');
    expect(frontmatter.split('\n').filter((l) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(l))
      .map((l) => l.slice(0, l.indexOf(':')))).toEqual(['name', 'description']);
    expect(frontmatter.toLowerCase()).toContain(
      'never use it to rule on a wave — a reviewer that sends work back or allocates a deviation has become a coordinator with no ledger');
  });

  it('states the review-done mail shape the close route re-measures', () => {
    expect(skill).toContain('"reviewedTip"');
    expect(skill).toContain('"report"');
    expect(skill).toContain('review-done');
    expect(skill).toContain('stale-review');
    expect(skill).toContain('report-unreadable');
  });
});

describe('the reviewer skill: the name dispatch invokes', () => {
  const SKILL_NAME = ((): string => {
    const m = /^name:\s*(\S+)\s*$/m.exec(frontmatter);
    if (!m) throw new Error('the reviewer skill declares no `name:`');
    return m[1]!;
  })();
  it('is the name the reviewer kickoff prefix tells every reviewer to run', () => {
    expect(REVIEWER_KICKOFF_PREFIX).toContain(`the ${SKILL_NAME} skill`);
  });
});

// THE REPORT PATH IS PART OF THE CONTRACT, because the close route re-measures
// it and the reviewer never sees the refusal itself.
//
// MEASURED, review run 69, 2026-09-17. A reviewer followed the clause as it
// then read — "an absolute path under this worktree" — and the coordinator's
// close was refused `report-unreadable` TWICE on a mode-664 file the reviewer
// could `cat` in the same shell. The file was never the problem: on a two-box
// fleet the server reaches the fleet host only through the agent, whose
// `checkPath(path, cfg, 'read')` grants `$HOME/.cc-sessions`, `.cc-limits`,
// `.cc-clips`, `$HOME/.claude*` and the projects root — and answers
// `forbidden` for everything else. `CCRC_PROJECTS_ROOT` is `$HOME/projects`,
// while every dispatched session's worktree is cut under `$HOME/worktrees`,
// so the prescribed location was outside all five roots for EVERY reviewer on
// this fleet. `statMeasured` therefore never saw ENOENT, which is why the
// detail said `unreadable` rather than `no such file` and cost an hour to
// diagnose from the reviewer's side.
//
// A clause is a request; this is the mechanism. Both ends of the seam are
// pinned, because either one moving alone re-opens the defect: the skill must
// keep sending reports to a granted root, AND the agent must keep granting it.
describe('the reviewer skill: the report lands where the close route can read it', () => {
  it('sends the report to .cc-clips and never to the worktree', () => {
    const clause = CONTRACT[6]!;
    // Bind the SUBJECT, not a loose substring: the clause that owns the report
    // path must name the granted root, and must say the worktree is excluded.
    expect(clause, 'clause 7 must name the granted root it writes to')
      .toContain('$HOME/.cc-clips/<your session id>/');
    expect(clause, 'clause 7 must say the worktree is NOT it, or a reader will "fix" it back')
      .toContain('NOT under this worktree');
    expect(clause, 'clause 7 must name the refusal it exists to prevent')
      .toContain('report-unreadable');
    // The worked example and the copyable snippet have to agree with the
    // clause — a reviewer copies those, not the contract.
    expect(skill, 'the worked report path must sit under $CLIPS')
      .toContain('`$CLIPS/review-<review-run-id>-<tip first 8>.md`');
    expect(skill, '$CLIPS must be defined as the granted root')
      .toContain('CLIPS="$HOME/.cc-clips/$id"');
    // Literal-absence pin: the old, refused location must not come back in any
    // of the three places that used to spell it.
    expect(skill, 'the refused worktree report path must not return')
      .not.toMatch(/\$WT\/\.ccrc-review/);
  });

  it('and the agent still grants that root — the other end of the same seam', () => {
    // Derived from the agent's OWN source, not restated here: if someone drops
    // `.cc-clips` from the read arm, this reds and names the skill as what
    // breaks, instead of the next reviewer rediscovering it from a refusal.
    const whitelist = readFileSync(path.join(root, 'agent/src/whitelist.ts'), 'utf8');
    const readArm = whitelist.slice(whitelist.indexOf('const readAllowed'));
    expect(readArm.slice(0, readArm.indexOf(';')),
      "the agent's read allowlist must still grant .cc-clips, or the reviewer skill's report path stops being readable")
      .toContain(".cc-clips");
  });
});
