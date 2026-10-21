// What the name field shows (named workspaces S7): the preview from the grammar alone, and what each lookup answer
// does to it. Pure; the debounce and the call are `useNamePreview`'s (workspace-name-field.test.tsx).
import { describe, expect, it } from 'vitest';
import {
  BLANK_TITLE_TEXT, LOOKUP_NOTE, NAME_DOOR_TEXT, confirmLabel, isResolveReason, localPreview, nameDoorReason, needsLookup, shortTitle, withLookup,
  type NamePreview,
} from '../src/fleet/workspaceNameWords';
import { accountIsHomeAble } from '../src/lib/accounts';
import { LINEAR_FAILURES } from '../../shared/linear';
import { TEST_ROSTER } from './rosterFixture';
import { NAME_REFUSAL_TEXT, WS_TITLE_MAX_BYTES, sanitizeTitle } from '../../shared/slug';

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

  it('shows the title the create will SAVE: control runs become one space, and a name past the byte cap ends in an ellipsis', () => {
    // The route saves `sanitizeTitle(offlineTitle(name) ?? name.trim())` (`server/test/workspaces-named-route.test.ts` pins that
    // argv); the preview must show the same text, not the whole of what was typed.
    expect(localPreview('Login\tcleanup\n\nflow')).toMatchObject({ kind: 'named', title: 'Login cleanup flow', short: 'Login cleanup flow' });
    const typed = 'word '.repeat(200).trim();
    const p = localPreview(typed);
    if (p.kind !== 'named') throw new Error('expected a named preview');
    expect(new TextEncoder().encode(p.title).length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
    expect(p.title.endsWith('…')).toBe(true);
    expect(p.title).toBe(sanitizeTitle(typed));
    expect(p.title.length).toBeLessThan(typed.length);
    // Whole code points: four-byte glyphs are not split by the cut.
    const emoji = localPreview(`ab ${'😀'.repeat(300)}`);
    if (emoji.kind !== 'named') throw new Error('expected a named preview');
    expect(emoji.title).not.toContain('\uFFFD');
    expect(new TextEncoder().encode(emoji.title).length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
  });

  it('a name that fits is shown exactly as typed, trimmed', () => {
    expect(localPreview('  Login cleanup  ')).toMatchObject({ title: 'Login cleanup' });
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

describe('localPreview in rename mode (a rename never changes the slug)', () => {
  const keep = { keepSlug: 'quiet-harbor' };

  it.each([
    ['CJK', '日本語のタイトル'], ['an emoji', '🚀'], ['one character', 'x'], ['punctuation', '!!'], ['a non-Linear link', 'https://example.test/x/y'],
  ])('%s is a title, never a refusal, and the slug it carries is the workspace\'s own', (_why, title) => {
    const p = localPreview(title, keep);
    expect(p).toMatchObject({ kind: 'named', slug: 'quiet-harbor', shortened: false, title, lookup: 'none', note: null });
    expect(needsLookup(p)).toBe(false);
    // The create's grammar still refuses what it always refused.
    expect(localPreview(title).kind === 'named' && title === '日本語のタイトル').toBe(false);
  });

  it('blank is empty (a clear), and only control characters are refused, in the rename\'s own words', () => {
    expect(localPreview('   ', keep)).toEqual({ kind: 'empty' });
    expect(localPreview('\u0001\u0002', keep)).toEqual({ kind: 'refused', reason: 'no-usable-characters', text: BLANK_TITLE_TEXT });
  });

  it('a ticket is still looked up, and a pasted link still reads as its id and title until Linear answers', () => {
    const p = localPreview('ENG-1301', keep);
    expect(p).toMatchObject({ kind: 'named', slug: 'quiet-harbor', title: 'ENG-1301', lookup: 'pending' });
    expect(needsLookup(p)).toBe(true);
    const link = ['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'ENG-2087', 'export-drops-the-last-row'].join('/');
    expect(localPreview(link, keep)).toMatchObject({ title: 'ENG-2087 - Export drops the last row', lookup: 'pending' });
  });

  it('shows the title the rename will save: sanitised and capped', () => {
    expect(localPreview('Login\tcleanup', keep)).toMatchObject({ title: 'Login cleanup' });
    const p = localPreview('語'.repeat(400), keep);
    if (p.kind !== 'named') throw new Error('expected a named preview');
    expect(p.title).toBe(sanitizeTitle('語'.repeat(400)));
    expect(p.title.endsWith('…')).toBe(true);
  });
});

describe('LOOKUP_NOTE', () => {
  it('has one sentence per word and points at Settings only where the remedy is there', () => {
    const hints = Object.values(LOOKUP_NOTE).map((n) => n.hint);
    expect(new Set(hints).size).toBe(hints.length);
    const pointers = Object.entries(LOOKUP_NOTE).filter(([, n]) => n.pointer !== null).map(([k]) => k);
    expect(pointers.sort()).toEqual(['not-configured', 'unauthorised']);   // a 403 is not the key's fault: no pointer
  });

  it('reads the server\'s words and none of the client\'s own as a server reason', () => {
    // Derived from the one list the server also reads, so a new arm is covered here the day it is added.
    for (const w of LINEAR_FAILURES) expect(isResolveReason(w)).toBe(true);
    expect(Object.keys(LOOKUP_NOTE).sort()).toEqual([...LINEAR_FAILURES, 'unrecognised', 'call-failed'].sort());
    for (const w of ['unrecognised', 'call-failed', 'nope', 3, null, undefined]) expect(isResolveReason(w)).toBe(false);
  });
});

describe('nameDoorReason', () => {
  it('a crossing project and an overflow account are two conditions with two sentences', () => {
    expect(nameDoorReason({ crossing: true, homeAble: true })).toBe(NAME_DOOR_TEXT.crossing);
    expect(nameDoorReason({ crossing: false, homeAble: false })).toBe(NAME_DOOR_TEXT.overflow);
    expect(NAME_DOOR_TEXT.crossing).not.toBe(NAME_DOOR_TEXT.overflow);
  });

  it('says the crossing first when both hold, since the project step can fix it', () => {
    expect(nameDoorReason({ crossing: true, homeAble: false })).toBe(NAME_DOOR_TEXT.crossing);
  });

  it('is open for an in-pool project on a home-able account', () => {
    expect(nameDoorReason({ crossing: false, homeAble: true })).toBeNull();
  });
});

describe('accountIsHomeAble (absence permits)', () => {
  it('reads the roster entry, and leaves a wrapper the roster has no entry for open', () => {
    expect(accountIsHomeAble(TEST_ROSTER, 'claude')).toBe(true);
    expect(accountIsHomeAble(TEST_ROSTER, 'gpt')).toBe(false);
    expect(accountIsHomeAble(TEST_ROSTER, 'not-in-the-roster')).toBe(true);
    expect(accountIsHomeAble([], 'claude')).toBe(true);
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
    // A refused name keeps the plain label: the button is disabled (dimmed), and the instruction is the sentence under the field.
    expect(label(localPreview('!!'))).toBe('Add workspace');
    expect(label(localPreview('ENG-1234'))).toBe('Add ENG-1234');
    expect(label(localPreview('Login cleanup'))).toBe('Add Login cleanup');
  });
});
