// Chat reading Task L (D-8062; spec 2026-11-06 section 4.1): `refHref` resolves one of chat's marks to an address, with the
// session's context, or answers null and the name stays text. Placeholders only: repo `owner-a/repo-a`, project `project-a`.
import { describe, expect, it } from 'vitest';
import { markRuns, type Mark, type MarkKind } from '../src/lib/chatMarks';
import { SMALL_ID_DIGITS, refHref, type ChatRefContext } from '../src/lib/chatRefs';
import { messageRepos } from '../src/lib/chatRepoEvidence';

const ctx: ChatRefContext = {
  repo: 'owner-a/repo-a', project: 'project-a', branch: 'ws/one', knownRuns: new Set([12]), knownItems: new Set([3]),
  runsElsewhere: false,
};

/** The one mark `text` holds, as the recogniser reads it. */
function mark(text: string, kind: MarkKind): Mark {
  const marks = markRuns(text).flatMap((r) => (r.kind === 'mark' ? [r.mark] : []));
  expect(marks, text).toHaveLength(1);
  expect(marks[0]!.kind).toBe(kind);
  return marks[0]!;
}

/** `refHref` as the chat asks it, the message being the mark's own text (Task C21 added the message's evidence). */
const resolve = (m: Mark, c: ChatRefContext): ReturnType<typeof refHref> => refHref(m, c, messageRepos(m.text));

describe('refHref (chat reading Task L, D-8062)', () => {
  it('#651 opens the repo\'s issue page, external', () => {
    expect(resolve(mark('#651', 'pr'), ctx)).toEqual({ href: 'https://github.com/owner-a/repo-a/issues/651', external: true });
  });

  it('a commit opens the repo\'s commit page', () => {
    expect(resolve(mark('4c677d328', 'commit'), ctx))
      .toEqual({ href: 'https://github.com/owner-a/repo-a/commit/4c677d328', external: true });
  });

  it('with no repo, #651 and a commit stay text', () => {
    const none = { ...ctx, repo: null };
    expect(resolve(mark('#651', 'pr'), none)).toBeNull();
    expect(resolve(mark('4c677d328', 'commit'), none)).toBeNull();
  });

  it('a repository that is not owner/name stays text', () => {
    for (const repo of ['owner-a', 'owner-a/repo-a/x', '../x', 'owner-a/..', 'owner-a/.', 'owner a/repo', '', '-a/b', 'a/-b']) {
      expect(resolve(mark('#651', 'pr'), { ...ctx, repo }), repo).toBeNull();
    }
  });

  // Review 1586 A1: the console's one GitHub repository grammar (`parseGithubRepo`) decides, so a slug written with `.git`
  // links to the repository itself.
  it('a repository is read with the console\'s one GitHub grammar', () => {
    expect(resolve(mark('#651', 'pr'), { ...ctx, repo: 'owner-a/repo-a.git' })).toEqual({
      href: 'https://github.com/owner-a/repo-a/issues/651', external: true,
    });
  });

  it('run 1527 opens /runs/1527', () => {
    expect(resolve(mark('run 1527', 'run'), ctx)).toEqual({ href: '/runs/1527', external: false });
  });

  it('review 1544 opens /runs/1544', () => {
    expect(resolve(mark('review 1544', 'run'), ctx)).toEqual({ href: '/runs/1544', external: false });
  });

  it('item 34 is text unless held, item 340 opens its item', () => {
    expect(resolve(mark('item 34', 'item'), ctx)).toBeNull();
    expect(resolve(mark('item 34', 'item'), { ...ctx, knownItems: new Set([34]) })).toEqual({ href: '/waiting/34', external: false });
    expect(resolve(mark('item 340', 'item'), ctx)).toEqual({ href: '/waiting/340', external: false });
    expect(resolve(mark('item 3', 'item'), ctx)).toEqual({ href: '/waiting/3', external: false });
  });

  it('run 12 links because the console holds it, run 2 stays text', () => {
    expect(SMALL_ID_DIGITS).toBe(3);
    expect(resolve(mark('run 12', 'run'), ctx)).toEqual({ href: '/runs/12', external: false });
    expect(resolve(mark('run 2 times', 'run'), ctx)).toBeNull();
    expect(resolve(mark('run 99', 'run'), ctx)).toBeNull();
    expect(resolve(mark('run 100', 'run'), ctx)).toEqual({ href: '/runs/100', external: false });
  });

  it('a zero or a leading zero is read by its value', () => {
    expect(resolve(mark('run 0', 'run'), { ...ctx, knownRuns: new Set([0]) })).toBeNull();
    expect(resolve(mark('run 012', 'run'), { ...ctx, knownRuns: new Set([12]) })).toEqual({ href: '/runs/12', external: false });
    expect(resolve(mark('run 012', 'run'), { ...ctx, knownRuns: new Set() })).toBeNull();
  });

  it('a small id the console does not hold stays text, a run id is not an item id', () => {
    expect(resolve(mark('item 12', 'item'), ctx)).toBeNull();
    expect(resolve(mark('run 3', 'run'), ctx)).toBeNull();
  });

  it('a specs path opens the Docs reader at the session\'s branch', () => {
    expect(resolve(mark('docs/superpowers/specs/2026-11-06-x-design.md', 'doc'), ctx))
      .toEqual({ href: '/docs/project-a/specs/2026-11-06-x-design.md?ref=ws/one', external: false });
  });

  it('with no branch, the default view', () => {
    expect(resolve(mark('docs/superpowers/plans/p.md', 'doc'), { ...ctx, branch: null }))
      .toEqual({ href: '/docs/project-a/plans/p.md', external: false });
  });

  it('a branch outside the bare grammar opens the default view', () => {
    expect(resolve(mark('docs/conventions/c.md', 'doc'), { ...ctx, branch: 'HEAD' }))
      .toEqual({ href: '/docs/project-a/conventions/c.md', external: false });
  });

  it('a path outside the four sections stays text', () => {
    expect(resolve(mark('docs/other/x.md', 'doc'), ctx)).toBeNull();
    expect(resolve(mark('docs/superpowers/notes/x.md', 'doc'), ctx)).toBeNull();
  });

  it('with no project, a path stays text', () => {
    expect(resolve(mark('docs/superpowers/specs/x.md', 'doc'), { ...ctx, project: null })).toBeNull();
  });
});
