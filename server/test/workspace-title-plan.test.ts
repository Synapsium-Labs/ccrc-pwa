// `server/src/workspaceTitle.ts` (L1) on its own: the decisions of the workspace rename that the route test reaches only
// through a whole server. Pure functions, no fixtures.
import { describe, it, expect } from 'vitest';
import { classifyTitleFailure, planRetitle } from '../src/workspaceTitle.js';

const YES = { verb: true };
const NO = { verb: false };

describe('planRetitle', () => {
  it('a title carries the text untouched, and its ticket when it is one', () => {
    const plan = planRetitle({ title: '  ENG-1234  ' }, YES);
    expect(plan.kind).toBe('title');
    if (plan.kind !== 'title') return;
    expect(plan.name).toBe('  ENG-1234  ');
    expect(plan.ticket).toMatchObject({ key: 'ENG', num: '1234' });
  });

  it('a plain title has no ticket', () => {
    const plan = planRetitle({ title: 'Login cleanup' }, YES);
    expect(plan.kind === 'title' && plan.ticket).toBeNull();
  });

  // A RENAME NEVER CHANGES THE SLUG, so the slug grammar has no say in what a title may be: it refused exactly the
  // titles a slug cannot be made of. Only what ccd re-proves (non-blank, no control characters, within the byte cap) can
  // refuse a title, and the last two are sanitised away before ccd sees them.
  it.each([
    ['CJK, no ASCII letter or digit', '日本語のタイトル'],
    ['an emoji alone', '🚀'],
    ['one character', 'x'],
    ['symbols only', '!!'],
    ['a non-Linear link', 'https://example.com/a/b'],
    ['accented text', 'Ünïcödé — ✓'],
  ])('%s is a title', (_why, title) => {
    const plan = planRetitle({ title }, YES);
    expect(plan.kind).toBe('title');
    if (plan.kind !== 'title') return;
    expect(plan.name).toBe(title);
    expect(plan.ticket).toBeNull();
  });

  it('a title that is a Linear link still has its ticket', () => {
    const link = ['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'ENG-2087', 'export-drops-the-last-row'].join('/');
    const plan = planRetitle({ title: link }, YES);
    expect(plan.kind === 'title' && plan.ticket).toMatchObject({ key: 'ENG', num: '2087' });
  });

  it('{clear:true} is a clear', () => {
    expect(planRetitle({ clear: true }, YES)).toEqual({ kind: 'clear' });
  });

  it.each([
    [{}], [{ title: 3 }], [{ title: null }], [{ clear: 1 }], [{ clear: 'true' }], [{ clear: false }],
    [{ clear: true, title: 'x' }], [{ clear: true, title: '' }], [{ clear: false, title: 'Login' }],
  ])('the body %j is bad-request', (body) => {
    expect(planRetitle(body, YES)).toEqual({ kind: 'refuse', refusal: { error: 'bad-request', extra: {} } });
  });

  it('a blank title is bad-name, never a clear', () => {
    const plan = planRetitle({ title: ' \t ' }, YES);
    expect(plan).toMatchObject({ kind: 'refuse', refusal: { error: 'bad-name', extra: { reason: 'no-usable-characters' } } });
  });

  it('a title of nothing but control characters is blank once sanitised: bad-name, never a clear', () => {
    expect(planRetitle({ title: '\u0001\u0007\t' }, YES))
      .toMatchObject({ kind: 'refuse', refusal: { error: 'bad-name', extra: { reason: 'no-usable-characters' } } });
  });

  it('a title past the bound is name-too-long, and the bound is characters, not bytes', () => {
    expect(planRetitle({ title: 'a'.repeat(1025) }, YES)).toMatchObject({ refusal: { error: 'name-too-long' } });
    expect(planRetitle({ title: 'a'.repeat(1024) }, YES).kind).toBe('title');
  });

  it('a box without the verb is unsupported, naming it, for a set and a clear alike', () => {
    const want = { kind: 'refuse', refusal: { error: 'unsupported', extra: { needs: 'ws-title' } } };
    expect(planRetitle({ title: 'Login cleanup' }, NO)).toEqual(want);
    expect(planRetitle({ clear: true }, NO)).toEqual(want);
  });

  it('a malformed body is refused as malformed before the missing verb is mentioned', () => {
    expect(planRetitle({ title: 5 }, NO)).toMatchObject({ refusal: { error: 'bad-request' } });
    expect(planRetitle({ title: ' \u0001 ' }, NO)).toMatchObject({ refusal: { error: 'bad-name' } });
  });
});

describe('classifyTitleFailure', () => {
  const sentence = (s: string): ReturnType<typeof classifyTitleFailure> => classifyTitleFailure({ stderr: s });

  it.each([
    ['ccd: bad session id', { kind: 'bad-session-id' }],
    ['ccd: no such session: project-a-x', { kind: 'unknown-session' }],
    ["ccd: project-a-x is not a workspace — a main checkout's name is its project", { kind: 'not-a-workspace' }],
    ['ccd: --title must be non-blank', { kind: 'bad-title', reason: 'blank' }],
    ['ccd: --title must not contain control characters', { kind: 'bad-title', reason: 'control-characters' }],
    ['ccd: --title is longer than 480 bytes', { kind: 'bad-title', reason: 'too-long' }],
    ['ccd: could not record the title for project-a-x — see the warning above', { kind: 'not-saved' }],
    ['ccd: could not clear the title for project-a-x — a title or named field STANDS', { kind: 'not-saved' }],
  ])('reads %j', (stderr, want) => {
    expect(sentence(stderr)).toEqual(want);
  });

  it("a verb's warning lines, which precede its refusal and name the same fields, are read through to the refusal", () => {
    const err = 'ccd: warn: could not write /h/x.title — x has no display title\nccd: could not record the title for x — see above\n';
    expect(sentence(err)).toEqual({ kind: 'not-saved' });
  });

  it('a warning alone is not a refusal', () => {
    expect(sentence('ccd: warn: could not write /h/x.title — x has no display title')).toEqual({ kind: 'other' });
  });

  it('the usage line and an unknown line are other', () => {
    expect(sentence('ccd: usage: ccd ws-title --session <id> (--title <text> | --clear)')).toEqual({ kind: 'other' });
    expect(sentence('boom')).toEqual({ kind: 'other' });
    expect(sentence('')).toEqual({ kind: 'other' });
  });

  it('a sentence is read only at the start of a line, never inside another', () => {
    expect(sentence('something ccd: bad session id')).toEqual({ kind: 'other' });
  });

  it('ran:false is other whatever the text says', () => {
    expect(classifyTitleFailure({ ran: false, stderr: 'ccd: bad session id' })).toEqual({ kind: 'other' });
  });
});
