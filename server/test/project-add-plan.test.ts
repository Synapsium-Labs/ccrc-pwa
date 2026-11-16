// Add a project from the console (spec 2026-11-04 §4, Server): the L1 decider `planProjectAdd` and the reader of ccd's
// refusal, `classifyProjectAddFailure`. Pure: a body in, a refusal word or an argv out. Every refusal is decided here,
// before any argv exists, so a refused body can never reach ccd.
import { describe, it, expect } from 'vitest';
import { classifyProjectAddFailure, planProjectAdd, type ProjectAddBox } from '../src/projectAdd.js';
import { CCD_ARGV } from '../src/ccdargv.js';

/** A box whose measured `ccd caps` list names the verb. */
const WITH: ProjectAddBox = { ccdVerbs: ['caps', 'project-add'] };
const plan = (body: unknown, box: ProjectAddBox = WITH): ReturnType<typeof planProjectAdd> => planProjectAdd(body, box);

const refusal = (body: unknown, box: ProjectAddBox = WITH): string | null => {
  const p = plan(body, box);
  return p.kind === 'refuse' ? p.error : null;
};

describe('planProjectAdd: a clone', () => {
  it('names the project after the repo when no name is given', () => {
    expect(plan({ source: 'github', repo: 'example/repo' })).toEqual({
      kind: 'run', name: 'repo', source: 'github', argv: CCD_ARGV.projectAddClone('repo', 'https://github.com/example/repo.git'),
    });
  });

  it('a blank name is no name: the repo names it', () => {
    const p = plan({ source: 'github', repo: 'https://github.com/example/repo.git', name: '   ' });
    expect(p).toMatchObject({ kind: 'run', name: 'repo' });
  });

  it("takes the operator's name, trimmed, over the repo's", () => {
    expect(plan({ source: 'github', repo: 'example/repo', name: ' project-a ' })).toEqual({
      kind: 'run', name: 'project-a', source: 'github',
      argv: CCD_ARGV.projectAddClone('project-a', 'https://github.com/example/repo.git'),
    });
  });

  it('keeps the SSH transport the operator chose', () => {
    const p = plan({ source: 'github', repo: 'git@github.com:example/repo.git' });
    expect(p).toMatchObject({ kind: 'run', argv: CCD_ARGV.projectAddClone('repo', 'git@github.com:example/repo.git') });
  });

  it('the argv is the clone entry: --name leads, the url is its own token after --url', () => {
    const p = plan({ source: 'github', repo: 'example/repo' });
    expect(p.kind === 'run' ? [...p.argv] : null)
      .toEqual(['project-add', '--name', 'repo', '--url', 'https://github.com/example/repo.git']);
  });

  it('a repo that is not a GitHub repository is bad-source', () => {
    for (const repo of ['https://gitlab.com/example/repo', 'example', '', 'ext::sh -c x', 'example/-repo', 'file:///srv/r.git',
      'owner.with.dot/repo', 'github.com/example', 'example/..']) {
      expect(refusal({ source: 'github', repo }), repo).toBe('bad-source');
    }
  });

  it("a repo whose own name cannot be a project's, with no name given, is bad-project", () => {
    expect(refusal({ source: 'github', repo: `example/${'r'.repeat(65)}` })).toBe('bad-project');
    // …and naming it fixes that.
    expect(plan({ source: 'github', repo: `example/${'r'.repeat(65)}`, name: 'project-a' }))
      .toMatchObject({ kind: 'run', name: 'project-a' });
  });

  it("a repo that leads with a dot (GitHub's own .github) needs a typed name: its own cannot be a project's", () => {
    expect(refusal({ source: 'github', repo: 'example/.github' })).toBe('bad-project');
    expect(plan({ source: 'github', repo: 'example/.github', name: 'example-github' })).toEqual({
      kind: 'run', name: 'example-github', source: 'github',
      argv: CCD_ARGV.projectAddClone('example-github', 'https://github.com/example/.github.git'),
    });
  });

  it('the scheme-less paste github.com/owner/repo is cloned over HTTPS', () => {
    expect(plan({ source: 'github', repo: 'github.com/example/repo' }))
      .toMatchObject({ kind: 'run', name: 'repo', argv: CCD_ARGV.projectAddClone('repo', 'https://github.com/example/repo.git') });
  });

  it('a name outside the new-project grammar is bad-project', () => {
    for (const name of ['-flag', '.hidden', '_under', 'a/b', 'a b', 'repo.git', 'a'.repeat(65), '..']) {
      expect(refusal({ source: 'github', repo: 'example/repo', name }), name).toBe('bad-project');
    }
  });

  it('a non-string repo or name is bad-request', () => {
    expect(refusal({ source: 'github' })).toBe('bad-request');
    expect(refusal({ source: 'github', repo: 7 })).toBe('bad-request');
    expect(refusal({ source: 'github', repo: 'example/repo', name: null })).toBe('bad-request');
    expect(refusal({ source: 'github', repo: 'example/repo', name: ['a'] })).toBe('bad-request');
  });

  it('the shape is checked before the repo: a non-string name refuses bad-request even when the repo is bad too', () => {
    expect(refusal({ source: 'github', repo: 'gitlab.com/x/y/z', name: 3 })).toBe('bad-request');
  });
});

describe('planProjectAdd: an empty project', () => {
  it('is the empty entry with the given name, trimmed', () => {
    expect(plan({ source: 'empty', name: ' project-a ' })).toEqual({
      kind: 'run', name: 'project-a', source: 'empty', argv: CCD_ARGV.projectAddEmpty('project-a'),
    });
    const p = plan({ source: 'empty', name: 'project-a' });
    expect(p.kind === 'run' ? [...p.argv] : null).toEqual(['project-add', '--name', 'project-a', '--empty']);
  });

  it('ignores a repo field: the source decides', () => {
    expect(plan({ source: 'empty', name: 'project-a', repo: 'example/repo' }))
      .toMatchObject({ kind: 'run', argv: CCD_ARGV.projectAddEmpty('project-a') });
  });

  it('a missing or non-string name is bad-request; a blank or ungrammatical one bad-project', () => {
    expect(refusal({ source: 'empty' })).toBe('bad-request');
    expect(refusal({ source: 'empty', name: 1 })).toBe('bad-request');
    for (const name of ['', '   ', '-flag', '.hidden', 'repo.git', 'a'.repeat(65)]) {
      expect(refusal({ source: 'empty', name }), JSON.stringify(name)).toBe('bad-project');
    }
  });

  it('a name of exactly 64 bytes is taken, 65 refused', () => {
    expect(plan({ source: 'empty', name: 'a'.repeat(64) })).toMatchObject({ kind: 'run', name: 'a'.repeat(64) });
    expect(refusal({ source: 'empty', name: 'a'.repeat(65) })).toBe('bad-project');
  });
});

describe('planProjectAdd: the body itself', () => {
  it.each([
    ['no body', undefined], ['null', null], ['a string', 'example/repo'], ['an array', [{ source: 'empty', name: 'a' }]],
    ['a number', 1],
  ])('%s is bad-request', (_what, body) => {
    expect(refusal(body)).toBe('bad-request');
  });

  it('a source outside the two is bad-request: the sheet only ever sends one of them', () => {
    for (const source of [undefined, 'gitlab', 'GITHUB', '', 1, null]) {
      expect(refusal({ source, repo: 'example/repo', name: 'project-a' }), String(source)).toBe('bad-request');
    }
  });
});

describe("planProjectAdd: the deployed ccd's caps", () => {
  const CLONE = { source: 'github', repo: 'example/repo' };
  const EMPTY = { source: 'empty', name: 'project-a' };

  it('a measured list without project-add is unsupported, for both entries: an older ccd is never sent the verb', () => {
    for (const box of [{ ccdVerbs: ['caps', 'ws-add'] }, { ccdVerbs: [] }]) {
      expect(refusal(CLONE, box)).toBe('unsupported');
      expect(refusal(EMPTY, box)).toBe('unsupported');
    }
  });

  it('no evidence (no list, or no state at all) permits, as every verbRow does', () => {
    // Called directly: `plan`'s default would stand in for an `undefined` box.
    for (const box of [{ ccdVerbs: null }, undefined]) {
      expect(planProjectAdd(CLONE, box)).toMatchObject({ kind: 'run' });
      expect(planProjectAdd(EMPTY, box)).toMatchObject({ kind: 'run' });
    }
  });

  it('what the operator sent is answered first: a bad body on an old box is its own word, not unsupported', () => {
    const OLD = { ccdVerbs: ['caps'] };
    expect(refusal({ source: 'github', repo: 'gitlab.com/x/y/z' }, OLD)).toBe('bad-source');
    expect(refusal({ source: 'empty', name: '-x' }, OLD)).toBe('bad-project');
    expect(refusal({ source: 'nope' }, OLD)).toBe('bad-request');
  });
});

describe('classifyProjectAddFailure', () => {
  const ran = (stderr: string): Parameters<typeof classifyProjectAddFailure>[0] => ({ ran: true, stderr });
  const notRan = (reason: 'transport' | 'spawn' | 'timeout', stderr = ''): Parameters<typeof classifyProjectAddFailure>[0] =>
    ({ ran: false, reason, stderr });

  it("ccd's `project exists: <name>` is exists", () => {
    expect(classifyProjectAddFailure(ran('ccd: project exists: project-a\n'))).toBe('exists');
    expect(classifyProjectAddFailure(ran('ccd: project exists: project-a'))).toBe('exists');
  });

  it('anything else ccd answered is other: a failed clone, a usage error, an empty stderr', () => {
    expect(classifyProjectAddFailure(ran("fatal: repository 'https://github.com/example/repo.git/' not found"))).toBe('other');
    expect(classifyProjectAddFailure(ran('ccd: usage: ccd project-add …'))).toBe('other');
    expect(classifyProjectAddFailure(ran(''))).toBe('other');
  });

  it('a runner that may have run ccd (its own wait expired, the link dropped) is unknown: the box may have added it', () => {
    expect(classifyProjectAddFailure(notRan('timeout', 'timeout'))).toBe('unknown');
    expect(classifyProjectAddFailure(notRan('transport', 'agent link closed'))).toBe('unknown');
  });

  it('a runner that never started ccd (spawn) is other: nothing was added', () => {
    expect(classifyProjectAddFailure(notRan('spawn', 'spawn ccd ENOENT'))).toBe('other');
  });

  it('a not-ran answer is never a refusal, whatever its text says', () => {
    expect(classifyProjectAddFailure(notRan('spawn', 'ccd: project exists: project-a'))).toBe('other');
    expect(classifyProjectAddFailure(notRan('transport', 'ccd: project exists: project-a'))).toBe('unknown');
  });
});
