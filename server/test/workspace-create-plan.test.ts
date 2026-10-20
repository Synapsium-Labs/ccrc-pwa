// `server/src/workspaceCreate.ts` (L1) on its own: the decisions of the named create that the route test reaches only
// through a whole server. Pure functions, no fixtures.
import { describe, it, expect } from 'vitest';
import { classifyAddFailure, isWsWrapper, planCreate } from '../src/workspaceCreate.js';

describe('classifyAddFailure', () => {
  it("reads the lane's reason out of the sentence, up to ccd's tail", () => {
    expect(classifyAddFailure({ stderr: 'ccd: --wrapper refused — lane-a:class=opus-unservable; the account was named, so …' }))
      .toEqual({ kind: 'account-refused', reason: 'lane-a:class=opus-unservable', leftBehind: false });
  });

  it("reads ccd's EXIST clause as leftBehind: the post-worktree refusal left a worktree and a branch no row names", () => {
    const post = 'ccd: --wrapper refused — lane-a:no-longer-qualifies; the account was named, so ccd will not place this workspace on another. '
      + 'The worktree /w and the branch ws/eng-1234 EXIST and no registry row names them: fix the account or choose another, then adopt them with: ccd start <wrapper> demo /w';
    expect(classifyAddFailure({ stderr: post }))
      .toEqual({ kind: 'account-refused', reason: 'lane-a:no-longer-qualifies', leftBehind: true });
    // The pre-flight sentence leaves the box as it found it: the same word, the opposite fact.
    expect(classifyAddFailure({ stderr: 'ccd: --wrapper refused — lane-a:auth-dead; the account was named, so ccd will not place this workspace on another — nothing was touched' }))
      .toMatchObject({ kind: 'account-refused', leftBehind: false });
  });

  it("keeps the rest of the line when ccd's tail changes, and never answers an empty reason", () => {
    expect(classifyAddFailure({ stderr: 'ccd: --wrapper refused — lane-a:disabled\nmore' }))
      .toEqual({ kind: 'account-refused', reason: 'lane-a:disabled', leftBehind: false });
    expect(classifyAddFailure({ stderr: 'ccd: --wrapper refused — ' })).toEqual({ kind: 'account-refused', reason: 'refused', leftBehind: false });
  });

  it('a refusal wins over a slug sentence in the same stderr only because it is checked first', () => {
    expect(classifyAddFailure({ stderr: 'slug in use: x\nccd: --wrapper refused — lane-a:missing; the account was named' }).kind)
      .toBe('account-refused');
  });

  it('an unrecognised line is other', () => {
    expect(classifyAddFailure({ stderr: 'ccd: no space left' })).toEqual({ kind: 'other' });
    expect(classifyAddFailure({ stderr: '' })).toEqual({ kind: 'other' });
  });

  it('ran:false is other whatever the text says', () => {
    expect(classifyAddFailure({ ran: false, stderr: "invalid slug 'x'" })).toEqual({ kind: 'other' });
  });
});

describe('isWsWrapper', () => {
  it.each(['lane-a', 'lane.b', 'Lane_9', 'a'])('accepts %j', (w) => { expect(isWsWrapper(w)).toBe(true); });
  it.each(['', '-a', '.a', 'a b', 'a/b', 'a'.repeat(65), 'é'])('refuses %j', (w) => { expect(isWsWrapper(w)).toBe(false); });
});

describe('planCreate', () => {
  const caps = { title: true, wrapper: true };

  it('a name that derives a slug and its ticket carries both', () => {
    const plan = planCreate('project-a', { name: 'ENG-1234' }, caps);
    expect(plan.kind).toBe('named');
    if (plan.kind !== 'named') return;
    expect(plan.ask.slug).toBe('eng-1234');
    expect(plan.ask.ticket).toMatchObject({ key: 'ENG', num: '1234' });
    expect(plan.wrapper).toBeNull();
  });

  it('absent wrapper stays null, a present one is carried', () => {
    const plan = planCreate('project-a', { name: 'x y', wrapper: 'lane-a' }, caps);
    expect(plan.kind === 'named' && plan.wrapper).toBe('lane-a');
  });

  it('checks the project before the name: a refused name on a bad project is bad-project', () => {
    const plan = planCreate('-x', { name: '!!' }, caps);
    expect(plan).toEqual({ kind: 'refuse', refusal: { error: 'bad-project', extra: {} } });
  });
});
