// The workspace rename's refusals (named workspaces S9): every answer `POST /api/sessions/:id/title` can give reads as its
// own sentence, and the CLASS is read from status AND word, never from a status alone (400 is five different things here,
// and 502 is two).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import {
  RENAME_TEXT, classifyRenameError, renameRefusalText, slugStays, type RenameRefusal,
} from '../src/fleet/workspaceRenameWords';
import { NAME_REFUSALS, NAME_REFUSAL_TEXT } from '../../shared/slug';
import { BLANK_TITLE_TEXT } from '../src/fleet/workspaceNameWords';

const err = (status: number, body: unknown): ApiError => new ApiError(status, body);

describe('classifyRenameError reads status and word', () => {
  const cases: [string, unknown, RenameRefusal][] = [
    ['400 bad-request', err(400, { ok: false, error: 'bad-request' }), { kind: 'bad-request' }],
    ['400 bad-session-id', err(400, { ok: false, error: 'bad-session-id' }), { kind: 'bad-session-id' }],
    ['400 name-too-long', err(400, { ok: false, error: 'name-too-long' }), { kind: 'name-too-long' }],
    ['400 bad-name with its reason', err(400, { ok: false, error: 'bad-name', reason: 'too-short', detail: 'x' }), { kind: 'bad-name', reason: 'too-short' }],
    ['400 bad-name with a reason this build lacks', err(400, { ok: false, error: 'bad-name', reason: 'from-the-future' }), { kind: 'bad-name', reason: null }],
    ['400 bad-title with its reason', err(400, { ok: false, error: 'bad-title', reason: 'control-characters' }), { kind: 'bad-title', reason: 'control-characters' }],
    ['400 bad-title with a reason this build lacks', err(400, { ok: false, error: 'bad-title', reason: 'x' }), { kind: 'bad-title', reason: null }],
    ['404 unknown-session', err(404, { ok: false, error: 'unknown-session' }), { kind: 'unknown-session' }],
    ['409 not-a-workspace', err(409, { ok: false, error: 'not-a-workspace' }), { kind: 'not-a-workspace' }],
    ['501 unsupported naming the verb', err(501, { ok: false, error: 'unsupported', needs: 'ws-title' }), { kind: 'unsupported' }],
    ['502 title-not-saved', err(502, { ok: false, error: 'title-not-saved' }), { kind: 'not-saved' }],
    ['502 with ccd stderr', err(502, { ok: false, stderr: ' no space\n' }), { kind: 'ccd-failed', stderr: 'no space' }],
    ['502 with none', err(502, { ok: false, stderr: '  ' }), { kind: 'ccd-failed', stderr: null }],
    ['a thrown TypeError (offline)', new TypeError('Failed to fetch'), { kind: 'unreached' }],
    ['a status this build has no word for', err(418, { error: 'teapot' }), { kind: 'other', status: 418 }],
    ['a 409 word that is not ours', err(409, { error: 'pool-mismatch' }), { kind: 'other', status: 409 }],
    ['a 400 with no body', err(400, 'nope'), { kind: 'other', status: 400 }],
  ];
  it.each(cases)('%s', (_name, thrown, want) => {
    expect(classifyRenameError(thrown)).toEqual(want);
  });

  it('does not read a word off the wrong status', () => {
    // `not-a-workspace` is a 409 and `title-not-saved` a 502. Read by word alone, a 400 carrying either would pass for it.
    expect(classifyRenameError(err(400, { error: 'not-a-workspace' }))).toEqual({ kind: 'other', status: 400 });
    expect(classifyRenameError(err(409, { error: 'bad-name' }))).toEqual({ kind: 'other', status: 409 });
    expect(classifyRenameError(err(500, { error: 'title-not-saved' }))).toEqual({ kind: 'other', status: 500 });
  });
});

describe('renameRefusalText', () => {
  const every: RenameRefusal[] = [
    { kind: 'bad-request' }, { kind: 'bad-session-id' }, { kind: 'name-too-long' },
    ...NAME_REFUSALS.map((reason): RenameRefusal => ({ kind: 'bad-name', reason })),
    { kind: 'bad-name', reason: null },
    { kind: 'bad-title', reason: 'blank' }, { kind: 'bad-title', reason: 'control-characters' },
    { kind: 'bad-title', reason: 'too-long' }, { kind: 'bad-title', reason: null },
    { kind: 'not-a-workspace' }, { kind: 'unknown-session' }, { kind: 'unsupported' }, { kind: 'not-saved' },
    { kind: 'ccd-failed', stderr: 'no space' }, { kind: 'ccd-failed', stderr: null },
    { kind: 'unreached' }, { kind: 'other', status: 418 },
  ];

  it('gives every refusal a sentence of its own, and no sentence is the start of another', () => {
    const texts = every.map(renameRefusalText);
    expect(new Set(texts).size).toBe(texts.length);
    for (const a of texts) for (const b of texts) if (a !== b) expect(b.startsWith(a), `${a} starts ${b}`).toBe(false);
  });

  it("says its own sentence for an empty title, and the grammar's for any other reason a box could still name", () => {
    // A rename is not bound by the slug grammar: the one `bad-name` this server answers is a title with nothing in it,
    // and "no letters or numbers" would be false of an emoji title. Any other reason is an older box, and its words stand.
    expect(renameRefusalText({ kind: 'bad-name', reason: 'no-usable-characters' })).toBe(BLANK_TITLE_TEXT);
    expect(BLANK_TITLE_TEXT).not.toBe(NAME_REFUSAL_TEXT['no-usable-characters']);
    for (const reason of NAME_REFUSALS.filter((r) => r !== 'no-usable-characters')) {
      expect(renameRefusalText({ kind: 'bad-name', reason })).toBe(NAME_REFUSAL_TEXT[reason]);
    }
  });

  it("says ccd's reason when it gave one, and says it gave none when it did not", () => {
    expect(renameRefusalText({ kind: 'ccd-failed', stderr: 'no space' })).toContain('no space');
    expect(renameRefusalText({ kind: 'ccd-failed', stderr: null })).toContain('no reason');
  });

  it('a refusal the box can only answer by update says so, and names no token', () => {
    const text = renameRefusalText({ kind: 'unsupported' });
    expect(text).toContain('Update the fleet box');
    expect(text).not.toMatch(/ws-title/);
  });

  it('a half-made write says it may be half changed and that trying again is the way out', () => {
    expect(renameRefusalText({ kind: 'not-saved' })).toMatch(/half changed.*Try again/);
  });
});

describe('the words around the field', () => {
  it('the slug line says the slug stays', () => {
    expect(slugStays('quiet-harbor')).toBe('slug stays quiet-harbor');
  });

  it('the confirm has a word for each of its states', () => {
    expect([RENAME_TEXT.save, RENAME_TEXT.clear, RENAME_TEXT.saveBusy, RENAME_TEXT.clearBusy, RENAME_TEXT.fixName])
      .toEqual(['Save title', 'Clear title', 'Saving…', 'Clearing…', 'Fix the name to continue']);
  });
});
