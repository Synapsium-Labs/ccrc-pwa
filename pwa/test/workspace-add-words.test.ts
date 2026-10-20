// The workspace create's refusals (named workspaces S7/S8): every answer the route can give reads as its own
// sentence, and the CLASS is read from status AND word, never from a status alone (400 is five different things).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import { accountRefusedText, addRefusalText, classifyAddError, type AddRefusal } from '../src/fleet/workspaceAddWords';
import { NAME_REFUSALS, NAME_REFUSAL_TEXT } from '../../shared/slug';
import { TEST_ROSTER } from './rosterFixture';

const ctx = { project: 'project-a', slug: 'eng-1234', roster: TEST_ROSTER };
const err = (status: number, body: unknown): ApiError => new ApiError(status, body);

describe('classifyAddError reads status and word', () => {
  const cases: [string, unknown, AddRefusal][] = [
    ['400 bad-request', err(400, { ok: false, error: 'bad-request' }), { kind: 'bad-request' }],
    ['400 bad-project', err(400, { ok: false, error: 'bad-project' }), { kind: 'bad-project' }],
    ['400 name-too-long', err(400, { ok: false, error: 'name-too-long' }), { kind: 'name-too-long' }],
    ['400 bad-name with its reason', err(400, { ok: false, error: 'bad-name', reason: 'too-short', detail: 'x' }), { kind: 'bad-name', reason: 'too-short' }],
    ['400 bad-name with a reason this build lacks', err(400, { ok: false, error: 'bad-name', reason: 'from-the-future' }), { kind: 'bad-name', reason: null }],
    ['400 bad-wrapper', err(400, { ok: false, error: 'bad-wrapper' }), { kind: 'bad-wrapper' }],
    ['400 bad-slug', err(400, { ok: false, error: 'bad-slug' }), { kind: 'bad-slug' }],
    ['409 slug-taken', err(409, { ok: false, error: 'slug-taken' }), { kind: 'slug-taken' }],
    ['409 account-refused', err(409, { ok: false, error: 'account-refused', reason: 'lane-a:auth-dead' }), { kind: 'account-refused', reason: 'lane-a:auth-dead' }],
    ['409 account-refused without a reason', err(409, { ok: false, error: 'account-refused' }), { kind: 'account-refused', reason: 'refused' }],
    ['501 unsupported ws-title-v1', err(501, { ok: false, error: 'unsupported', needs: 'ws-title-v1' }), { kind: 'unsupported', needs: 'ws-title-v1' }],
    ['501 unsupported ws-wrapper-v1', err(501, { ok: false, error: 'unsupported', needs: 'ws-wrapper-v1' }), { kind: 'unsupported', needs: 'ws-wrapper-v1' }],
    ['501 unsupported, no token', err(501, { ok: false, error: 'unsupported' }), { kind: 'unsupported', needs: null }],
    ['502 with ccd stderr', err(502, { ok: false, stderr: ' no origin/HEAD\n' }), { kind: 'ccd-failed', stderr: 'no origin/HEAD' }],
    ['502 with none', err(502, { ok: false, stderr: '  ' }), { kind: 'ccd-failed', stderr: null }],
    ['a thrown TypeError (offline)', new TypeError('Failed to fetch'), { kind: 'unreached' }],
    ['a status this build has no word for', err(418, { error: 'teapot' }), { kind: 'other', status: 418 }],
    ['a 409 word that is not ours', err(409, { error: 'pool-mismatch' }), { kind: 'other', status: 409 }],
    ['a 400 with no body', err(400, 'nope'), { kind: 'other', status: 400 }],
  ];
  it.each(cases)('%s', (_name, thrown, want) => {
    expect(classifyAddError(thrown)).toEqual(want);
  });

  it('does not read a word off the wrong status', () => {
    // `slug-taken` is a 409. A 400 carrying it is not one, and a refusal read by word alone would call it one.
    expect(classifyAddError(err(400, { error: 'slug-taken' }))).toEqual({ kind: 'other', status: 400 });
    expect(classifyAddError(err(409, { error: 'bad-name' }))).toEqual({ kind: 'other', status: 409 });
  });
});

describe('addRefusalText', () => {
  const every: AddRefusal[] = [
    { kind: 'bad-request' }, { kind: 'bad-project' }, { kind: 'name-too-long' },
    ...NAME_REFUSALS.map((reason): AddRefusal => ({ kind: 'bad-name', reason })),
    { kind: 'bad-name', reason: null },
    { kind: 'bad-wrapper' }, { kind: 'bad-slug' }, { kind: 'slug-taken' },
    { kind: 'account-refused', reason: 'lane-a:auth-dead' },
    { kind: 'unsupported', needs: 'ws-title-v1' }, { kind: 'unsupported', needs: 'ws-wrapper-v1' }, { kind: 'unsupported', needs: null },
    { kind: 'ccd-failed', stderr: 'no origin/HEAD' }, { kind: 'ccd-failed', stderr: null },
    { kind: 'unreached' }, { kind: 'other', status: 418 },
  ];

  it('gives every refusal its own sentence', () => {
    const texts = every.map((r) => addRefusalText(r, ctx));
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) expect(t.trim()).not.toBe('');
  });

  it('says the name refusal in the grammar\'s own words', () => {
    for (const reason of NAME_REFUSALS) {
      expect(addRefusalText({ kind: 'bad-name', reason }, ctx)).toBe(NAME_REFUSAL_TEXT[reason]);
    }
  });

  it('names the id that is taken, from the project and the slug the operator asked for', () => {
    expect(addRefusalText({ kind: 'slug-taken' }, ctx)).toContain('project-a-eng-1234 already exists');
    expect(addRefusalText({ kind: 'slug-taken' }, ctx)).toMatch(/Your text is kept/);
    expect(addRefusalText({ kind: 'slug-taken' }, { ...ctx, slug: null })).not.toContain('project-a-');
  });

  it('says plainly that the box\'s ccd is too old, and for which feature', () => {
    expect(addRefusalText({ kind: 'unsupported', needs: 'ws-title-v1' }, ctx)).toMatch(/ccd is too old to name a workspace/);
    expect(addRefusalText({ kind: 'unsupported', needs: 'ws-wrapper-v1' }, ctx)).toMatch(/ccd is too old to start a named workspace on the account you picked/);
  });

  it('shows ccd\'s stderr for a 502, and says it gave none when it gave none', () => {
    expect(addRefusalText({ kind: 'ccd-failed', stderr: 'no origin/HEAD' }, ctx)).toContain('no origin/HEAD');
    expect(addRefusalText({ kind: 'ccd-failed', stderr: null }, ctx)).toMatch(/gave no reason/);
  });

  it('warns that an unreached create may have landed', () => {
    expect(addRefusalText({ kind: 'unreached' }, ctx)).toMatch(/may not have been created/);
  });
});

describe('accountRefusedText reads ccd\'s <lane>:<why>', () => {
  const label = (id: string): string => TEST_ROSTER.find((a) => a.id === id)?.label ?? id;
  it.each([
    ['claude:not-home-able', /overflow account/],
    ['claude:auth-dead', /can't sign in/],
    ['claude:missing', /isn't set up/],
    ['claude:disabled', /switched off/],
    ['claude:pool=pool-b', /pool pool-b, which isn't this project's pool/],
    ['claude:projection=stale', /pool can't be checked.*\(stale\)/],
    ['claude:class=fable-unservable', /can't serve the fable class today/],
    ['claude:something-new', /can't take a new workspace \(something-new\)/],
  ])('%s', (reason, shape) => {
    const text = accountRefusedText(reason, TEST_ROSTER);
    expect(text).toMatch(shape);
    expect(text).toContain(label('claude'));
  });

  it('never shows the fleet box\'s file path for an unreadable project pool tag', () => {
    const text = accountRefusedText('tag:malformed <pools-dir>/project-a', TEST_ROSTER);
    expect(text).toMatch(/pool tag can't be read/);
    expect(text).not.toContain('<pools-dir>');
  });

  it('keeps a reason with no lane readable', () => {
    expect(accountRefusedText('refused', TEST_ROSTER)).toBe("That account can't take a new workspace (refused).");
  });
});
