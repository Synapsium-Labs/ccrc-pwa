// ── the files a public repository is judged by, and the claims that go stale ─
//
// Pre-flip hygiene (Stage 5). None of this is exotic; all of it is the kind of
// thing that is written once, drifts, and is noticed by a stranger rather than
// by us. Each assertion here exists because the audit found the thing missing
// or wrong, not because a checklist said a repo "should have" it.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

describe('SECURITY.md', () => {
  it('exists', () => {
    expect(existsSync(join(REPO, 'SECURITY.md')),
      'a tool that runs shell on developer machines, with no private way to report a hole')
      .toBe(true);
  });

  it('names a PRIVATE channel and steers reporters off public issues', () => {
    const s = read('SECURITY.md');
    expect(s).toMatch(/private vulnerability reporting/i);
    expect(s).toMatch(/do not open a public issue/i);
  });

  it('says what makes THIS project unusual, not generic boilerplate', () => {
    // A security policy that could belong to any repo tells a reporter nothing
    // about where to look. ccrc's surface is shell, tmux, systemd and git on a
    // real box — the policy has to say so or it is decoration.
    const s = read('SECURITY.md');
    expect(s).toMatch(/shell|tmux|systemd/i);
    expect(s).toMatch(/fails?\s+\*{0,2}open\*{0,2}|fail\s+open/i);   // the gate's failure direction
  });

  it('states the known-by-design items, so they are not reported as findings', () => {
    const s = read('SECURITY.md');
    expect(s).toMatch(/attribution, not authentication/i);
    expect(s).toMatch(/CCRC_AUTH/);
  });
});

describe('CONTRIBUTING.md', () => {
  it('exists', () => {
    expect(existsSync(join(REPO, 'CONTRIBUTING.md'))).toBe(true);
  });

  it('warns about the traps that cost an outsider an afternoon', () => {
    // Four packages with no root runner, and a bare `npx vitest` that resolves
    // a global copy with no jsdom and reports "no tests" — which reads as a
    // pass. Anyone who does not know these two things will conclude the suite
    // is broken or, worse, that it passed.
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/no root .?package\.json|four packages/i);
    expect(c).toMatch(/npx vitest/);
    expect(c).toMatch(/node_modules\/\.bin\/vitest/);
  });

  it('states the mutation-table doctrine, which is how review here actually works', () => {
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/goes red when the guard is removed|red when the guard/i);
    expect(c).toMatch(/D-N|deviation ledger/i);
  });

  it('says contributions are AGPL, matching the root LICENSE', () => {
    expect(read('CONTRIBUTING.md')).toMatch(/AGPL-3\.0/);
  });
});

describe('claims that go stale', () => {
  it("CLAUDE.md's README size claim is still true", () => {
    // It said "817 lines" while the file was 1,590 — a reader budgeting their
    // attention was told the wrong thing by a factor of two. Pinned with a
    // tolerance rather than exactly: the number should track the file, and a
    // restructure that moves it 10% should update the sentence that describes
    // it.
    const claimed = /README\.md` \(~?([0-9,]+) lines\)/.exec(read('CLAUDE.md'));
    expect(claimed, 'CLAUDE.md no longer states the README size').not.toBeNull();
    const said = Number(claimed![1].replace(/,/g, ''));
    const real = read('README.md').split('\n').length - 1;
    expect(Math.abs(said - real) / real,
      `CLAUDE.md says ${said} lines, README.md is ${real}`).toBeLessThan(0.1);
  });
});

describe('workflow and package posture', () => {
  it('ci.yml declares least privilege rather than inheriting it', () => {
    // The org default already computes to read-only. Declaring it means a job
    // that later wants write has to ask for it in the diff, where a reviewer
    // sees it.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^permissions:\s*$/m);
    expect(ci).toMatch(/^\s+contents:\s+read\s*$/m);
  });

  it('ci.yml uses pull_request, never pull_request_target', () => {
    // `pull_request_target` runs a fork's PR with the BASE repo's token and
    // secrets. On a public repo whose suite shells out, that is the difference
    // between a CI run and handing a stranger the repository.
    // Read the TRIGGER KEYS, not the file text: a comment that names the
    // dangerous trigger in order to explain why it is not used is exactly the
    // documentation we want, and a substring check would forbid it. (Measured:
    // this assertion's first form went red on this file's own comment.)
    const ci = read('.github/workflows/ci.yml');
    const triggerKeys = ci.split('\n')
      .filter((l) => /^ {2}[a-z_]+:/.test(l))
      .map((l) => l.trim().replace(':', ''));
    expect(triggerKeys, 'ci.yml no longer triggers on pull_request').toContain('pull_request');
    expect(triggerKeys, 'pull_request_target would run fork code with our token and secrets')
      .not.toContain('pull_request_target');
  });

  it('no workflow reads a repository secret', () => {
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      expect(read(f), `${f} references secrets — fork PRs must never reach one`)
        .not.toMatch(/secrets\./);
    }
  });

  it('every package is marked private — none of these publish to npm', () => {
    for (const d of ['server', 'agent', 'pwa', 'shared']) {
      const pkg = JSON.parse(read(join(d, 'package.json'))) as { private?: boolean };
      expect(pkg.private, `${d}/package.json is publishable to npm`).toBe(true);
    }
  });
});
