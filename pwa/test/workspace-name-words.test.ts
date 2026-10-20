// What the name field shows (named workspaces S7): the preview from the grammar alone, and what each lookup answer
// does to it. Pure; the debounce and the call are `useNamePreview`'s (workspace-name-field.test.tsx).
import { describe, expect, it } from 'vitest';
import {
  LOOKUP_NOTE, confirmLabel, isResolveReason, localPreview, needsLookup, shortTitle, withLookup, type NamePreview,
} from '../src/fleet/workspaceNameWords';
import { NAME_REFUSAL_TEXT } from '../../shared/slug';

describe('localPreview', () => {
  it('an empty or blank field is today: nothing to send', () => {
    expect(localPreview('')).toEqual({ kind: 'empty' });
    expect(localPreview('   ')).toEqual({ kind: 'empty' });
  });

  it('a refusal is the grammar\'s, shown at once with its own sentence', () => {
    expect(localPreview('!!')).toEqual({ kind: 'refused', reason: 'no-usable-characters', text: NAME_REFUSAL_TEXT['no-usable-characters'] });
    expect(localPreview('a')).toEqual({ kind: 'refused', reason: 'too-short', text: NAME_REFUSAL_TEXT['too-short'] });
    expect(localPreview('https://example.test/x/y')).toMatchObject({ kind: 'refused', reason: 'url-not-recognised' });
  });

  it('a plain name needs no lookup and keeps the operator\'s own words as its title', () => {
    const p = localPreview('Login cleanup');
    expect(p).toMatchObject({ kind: 'named', slug: 'login-cleanup', title: 'Login cleanup', lookup: 'none', note: null });
    expect(needsLookup(p)).toBe(false);
  });

  it('a ticket id is pending, with the offline title and the slug', () => {
    const p = localPreview('ENG-1234');
    expect(p).toMatchObject({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234', short: 'ENG-1234', lookup: 'pending' });
    expect(needsLookup(p)).toBe(true);
  });

  it('a pasted link is a ticket too: its title is the one Linear\'s own slug spells, until Linear answers', () => {
    const p = localPreview(['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'ENG-2087', 'export-drops-the-last-row'].join('/'));
    expect(p).toMatchObject({ kind: 'named', slug: 'eng-2087-export-drops-the-last', shortened: true, title: 'ENG-2087 - Export drops the last row', lookup: 'pending' });
  });

  it('a copied branch is a ticket and is looked up', () => {
    const p = localPreview('user-a/eng-1301-retry-the-upload');
    expect(p).toMatchObject({ kind: 'named', slug: 'eng-1301-retry-the-upload', title: 'ENG-1301 - Retry the upload', lookup: 'pending' });
  });

  it('says when the slug had to be cut to fit', () => {
    const p = localPreview('Investigate the flaky upload test on the staging runner');
    expect(p).toMatchObject({ kind: 'named', shortened: true });
    if (p.kind === 'named') expect(p.slug.length).toBeLessThanOrEqual(31);
  });
});

describe('withLookup', () => {
  const pending = localPreview('ENG-1234');

  it('Linear\'s title replaces the offline one, and the slug does not move', () => {
    const p = withLookup(pending, { title: 'ENG-1234 - Fix the login flow', source: 'linear', note: null });
    expect(p).toMatchObject({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow', short: 'ENG-1234', lookup: 'linear', note: null });
  });

  it('an offline answer keeps the typed title and carries its reason', () => {
    const p = withLookup(pending, { title: 'ENG-1234', source: 'offline', note: 'not-found' });
    expect(p).toMatchObject({ lookup: 'offline', title: 'ENG-1234', note: 'not-found' });
  });

  it('a failed call is an offline answer with its own note, never a refusal', () => {
    expect(withLookup(pending, 'call-failed')).toMatchObject({ kind: 'named', lookup: 'offline', note: 'call-failed' });
  });

  it('an answer never repaints a preview that was not waiting for one', () => {
    const plain = localPreview('Login cleanup');
    const answer = { title: 'ENG-1 - Other', source: 'linear' as const, note: null };
    expect(withLookup(plain, answer)).toBe(plain);
    const refused = localPreview('!!');
    expect(withLookup(refused, answer)).toBe(refused);
    const answered = withLookup(pending, answer);
    expect(withLookup(answered, { ...answer, title: 'ENG-1 - Later' })).toBe(answered);
  });

  it('a Linear answer never carries a note, whatever it was sent with', () => {
    expect(withLookup(pending, { title: 'ENG-1234 - X', source: 'linear', note: 'timeout' })).toMatchObject({ note: null });
  });
});

describe('LOOKUP_NOTE', () => {
  it('has one sentence per word and points at Settings only where the remedy is there', () => {
    const hints = Object.values(LOOKUP_NOTE).map((n) => n.hint);
    expect(new Set(hints).size).toBe(hints.length);
    const pointers = Object.entries(LOOKUP_NOTE).filter(([, n]) => n.pointer !== null).map(([k]) => k);
    expect(pointers.sort()).toEqual(['not-configured', 'unauthorised']);
  });

  it('reads the server\'s words and none of the client\'s own as a server reason', () => {
    for (const w of ['not-configured', 'unauthorised', 'not-found', 'timeout', 'malformed', 'unreachable']) expect(isResolveReason(w)).toBe(true);
    for (const w of ['unrecognised', 'call-failed', 'nope', 3, null, undefined]) expect(isResolveReason(w)).toBe(false);
  });
});

describe('shortTitle and confirmLabel', () => {
  it('keeps a ticket id short enough to leave room for the account in a confirm', () => {
    expect(shortTitle('ENG-1234 - Fix the login flow')).toBe('ENG-1234');
    expect(shortTitle('ENG-1234')).toBe('ENG-1234');
    expect(shortTitle('Login cleanup')).toBe('Login cleanup');
    expect(shortTitle('Release notes - draft')).toBe('Release notes - draft');
  });

  const door = { empty: 'Add workspace', named: (s: string) => `Add ${s}` };
  const label = (p: NamePreview): string => confirmLabel(p, door);
  it('narrates each state', () => {
    expect(label(localPreview(''))).toBe('Add workspace');
    expect(label(localPreview('!!'))).toBe('Fix the name to continue');
    expect(label(localPreview('ENG-1234'))).toBe('Add ENG-1234');
    expect(label(localPreview('Login cleanup'))).toBe('Add Login cleanup');
  });
});
