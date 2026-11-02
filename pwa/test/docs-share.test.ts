// Docs W5 Share (spec 2026-10-01 4.5, 4.7, 4.16; native Docs reader W5, Share): what Share sends and when, pure.
// Task 1, the words: the refusal and note maps, exhaustive by key; Export's clause as a seam no page takes yet; the
// closed worktree label. Task 2, `shareTargetFor` over hand-built tree answers and pins (M4.SH1, M4.SH2, M4.SH3's
// Share half, M4.SH6, M4.EX12's pure half, M4.T7's Share clause). Task 3, `shareStateFor` (M4.SH8's pure half and
// M4.EX12's "disabled while the pin differs"). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`.
import { describe, expect, it } from 'vitest';
import {
  DOCS_HEAD_TEXT, SHARE_EXPORT_CLAUSE, SHARE_EXPORT_CLAUSE_FOR, SHARE_NOTE, SHARE_SENTENCE, closedWorktreeLabel,
  shareNoteSentence, shareRefusalSentence, worktreeLabel,
} from '../src/docs/docsText';
import type { ShareRefusal } from '../src/docs/share';

const SHORT_A = 'a'.repeat(8);

describe('the Share words (spec 4.7, 4.16; M4.SH6)', () => {
  const REFUSALS: ShareRefusal[] =
    ['bad-slug', 'bad-target', 'new-draft', 'new-withheld', 'no-github-origin', 'not-on-origin', 'unmeasured'];
  const NOTES = ['access', 'admitted-committed', 'dir-drafts', 'drafts-excluded', 'html-source', 'onRef-not-contained',
    'onRef-unmeasured', 'view-committed'];
  const FIELDS = { short: SHORT_A, withheld: 'The draft is too large for Docs to read' };

  it('SHARE_SENTENCE has one sentence per refusal word, and SHARE_NOTE one per note word', () => {
    expect(Object.keys(SHARE_SENTENCE).sort()).toEqual(REFUSALS);
    expect(Object.keys(SHARE_NOTE).sort()).toEqual(NOTES);
  });

  it("no refusal sentence carries Export's clause while no page offers Export (refinement (c))", () => {
    for (const why of REFUSALS) expect(shareRefusalSentence(why, FIELDS, false), why).not.toContain('Export makes');
  });

  it('the Export seam: a page that offers Export adds the clause to exactly the four refusals the spec gives it', () => {
    const takers = REFUSALS.filter((why) => shareRefusalSentence(why, FIELDS, true).endsWith(' ' + SHARE_EXPORT_CLAUSE));
    expect(takers).toEqual(['bad-slug', 'bad-target', 'new-draft', 'no-github-origin']);
    expect([...SHARE_EXPORT_CLAUSE_FOR].sort()).toEqual(takers);
  });

  it("the refusal sentences are spec 4.16's, without Export's clause", () => {
    expect(shareRefusalSentence('no-github-origin', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-slug', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-target', {}, false)).toBe('Docs could not build a GitHub link for this page.');
    expect(shareRefusalSentence('not-on-origin', { short: SHORT_A }, false))
      .toBe(`Commit ${SHORT_A} is not on origin; push it to share.`);
    expect(shareRefusalSentence('unmeasured', { short: SHORT_A }, false))
      .toBe(`Docs could not measure whether origin has ${SHORT_A}; Refresh, then share.`);
    expect(shareRefusalSentence('new-draft', {}, false)).toBe('Not committed yet, so GitHub has nothing to show.');
    expect(shareRefusalSentence('new-withheld', FIELDS, false))
      .toBe('Not committed yet, and Docs did not read it (The draft is too large for Docs to read); nothing to share or export.');
  });

  it("the notes are spec 4.16's", () => {
    expect(shareNoteSentence({ note: 'access', fields: { slug: 'example-org/example-repo' } }))
      .toBe("Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.");
    expect(shareNoteSentence({ note: 'html-source', fields: {} })).toBe('GitHub shows this page as source.');
    expect(shareNoteSentence({ note: 'view-committed', fields: { label: 'main checkout' } }))
      .toBe('Uncommitted changes in main checkout are not included.');
  });

  it('dir-drafts counts in words: one doc is, three docs are (refinement (i))', () => {
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 1, s: '', be: 'is' } }))
      .toBe('1 uncommitted doc here is not included.');
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 3, s: 's', be: 'are' } }))
      .toBe('3 uncommitted docs here are not included.');
  });

  it('closedWorktreeLabel names a worktree from a closed set, never another segment of its path (refinement (b))', () => {
    expect(closedWorktreeLabel({ path: '/repo/demo', class: 'main' })).toBe('main checkout');
    expect(closedWorktreeLabel({ path: '/repo/demo/.ws/ws-a/', class: 'workspace' })).toBe('workspace ws-a');
    expect(closedWorktreeLabel({ path: '/', class: 'workspace' })).toBe(DOCS_HEAD_TEXT.worktreeOther);
    expect(closedWorktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('another worktree');
    // The truth line's label is unchanged: it stays in the browser and may name the last two segments.
    expect(worktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('elsewhere/wt-b');
  });
});
