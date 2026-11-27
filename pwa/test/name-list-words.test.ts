// Settings › Overlord's private-name list, its words and pure readers (Overlord W2 Settings, plan `w2-settings.md` Task 1):
// `nameListWords.ts` (L1). Synthetic names only (`zz-alpha`, `zq-bravo-x9`): the repository is public, and no real name is a
// fixture.
import { describe, expect, it } from 'vitest';
import { NAME_LIST_MODES, NAME_LIST_ROW_REFUSALS, NAME_LIST_STATES, NAME_LIST_UNREADABLE } from '../../shared/privateNames';
import { ApiError, OVERLORD_SETTINGS_REFUSAL_TEXT as ST, overlordSettingsRefusalText } from '../src/lib/api';
import {
  NAME_LIST_MODE_WORDS, NAME_LIST_ROW_TEXT, NAME_LIST_UNREADABLE_TEXT, NAME_LIST_WORDS as W, nameListKeepsText, nameListRefusalText,
  nameListRowsOf, nameListStatusOf, uploadAnswerWords,
} from '../src/overlord/nameListWords';

const refused = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(status, { ok: false, error, ...extra });
/** The reader as the card calls it: Settings' table for the list's act as the fallback. */
const refusal = (err: unknown, lines: readonly number[]): string =>
  nameListRefusalText(err, lines, (e) => overlordSettingsRefusalText(e, 'name-list', true));

describe('the status read: three answers, and anything else is unreadable', () => {
  it.each<[string, unknown, unknown]>([
    ['none', { state: 'none' }, { state: 'none' }],
    ['a list', { state: 'list', rows: 3, uploadedAt: 1_700_000_000_000 }, { state: 'list', rows: 3, uploadedAt: 1_700_000_000_000 }],
    ['unreadable', { state: 'unreadable', reason: 'key-mismatch' }, { state: 'unreadable', reason: 'key-mismatch' }],
    ['a list with no count', { state: 'list', uploadedAt: 1 }, null],
    ['an unreadable list with a reason this build does not know', { state: 'unreadable', reason: 'zz-newer' }, null],
    ['a state this build does not know', { state: 'some' }, null],
    ['no body', null, null],
  ])('%s', (_n, body, read) => { expect(nameListStatusOf(body)).toEqual(read); });

  it('each state and each unreadable reason has its words, both ways', () => {
    expect(NAME_LIST_STATES).toEqual(['none', 'list', 'unreadable']);
    expect(Object.keys(NAME_LIST_UNREADABLE_TEXT).sort()).toEqual([...NAME_LIST_UNREADABLE].sort());
    for (const r of NAME_LIST_UNREADABLE) expect(W.unreadable(r)).toContain(NAME_LIST_UNREADABLE_TEXT[r]);
    expect(W.list(1, 'today')).toBe('1 name, uploaded today. Every outgoing relay is checked against them.');
    expect(W.list(3, 'today')).toBe('3 names, uploaded today. Every outgoing relay is checked against them.');
  });
});

describe('the text: one name a line, an optional mode in front, and never empty by accident', () => {
  it('a plain line is part; a mode word and a colon set its mode; blank lines are skipped and lines keep their numbers', () => {
    const r = nameListRowsOf('zz-alpha\n\nexact: zq-bravo-x9\r\n  run:zz-charlie  \nwords: zz delta\n');
    expect(r).toEqual({
      ok: true,
      rows: [{ text: 'zz-alpha', mode: 'part' }, { text: 'zq-bravo-x9', mode: 'exact' }, { text: 'zz-charlie', mode: 'run' }, { text: 'zz delta', mode: 'words' }],
      lines: [1, 3, 4, 5],
    });
  });
  it('a word before the colon that is no mode is refused with its line, and nothing is sent', () => {
    expect(nameListRowsOf('zz-alpha\nexat: zq-bravo-x9')).toEqual({ ok: false, why: 'mode', line: 2 });
    expect(W.badMode(2)).toBe('Line 2: the word before the colon is not part, exact, run or words.');
  });
  it('a capitalised word before a colon is part of the name', () => {
    expect(nameListRowsOf('Zz: alpha')).toEqual({ ok: true, rows: [{ text: 'Zz: alpha', mode: 'part' }], lines: [1] });
  });
  it.each<[string, string]>([['empty', ''], ['blank lines', '\n  \n\t\n']])('%s text is refused empty, never zero rows', (_n, text) => {
    expect(nameListRowsOf(text)).toEqual({ ok: false, why: 'empty' });
  });
  it('the caps and the characters are the door\'s: a long or non-ASCII line is sent as it is', () => {
    const long = 'z'.repeat(500);
    expect(nameListRowsOf(`${long}\nzz-ä`)).toEqual({ ok: true, rows: [{ text: long, mode: 'part' }, { text: 'zz-ä', mode: 'part' }], lines: [1, 2] });
  });
});

describe('a refused row names its line, never its text', () => {
  it('each of the door\'s row reasons has its sentence, both ways', () => {
    expect(Object.keys(NAME_LIST_ROW_TEXT).sort()).toEqual([...NAME_LIST_ROW_REFUSALS].sort());
  });
  it.each(NAME_LIST_ROW_REFUSALS.map((r) => [r]))('%s: the row index is turned back into its line', (reason) => {
    const said = refusal(refused(400, 'bad-request', { detail: 'row 3: …', row: 3, reason }), [1, 3, 4, 7, 9]);
    // The fourth row sent (index 3) came from line 7: blank lines before it are skipped, never counted as rows.
    expect(said).toBe(`Line 7: ${NAME_LIST_ROW_TEXT[reason]}`);
  });
  it('a bad-request with no row is the list\'s own sentence with the door\'s detail', () => {
    expect(refusal(refused(400, 'bad-request', { detail: 'at most 1000 rows' }), [1]))
      .toBe(`${ST['names-bad-request']} (at most 1000 rows)`);
  });
  it('a row index past the lines, or a reason this build does not know, falls back to the list\'s sentence', () => {
    expect(refusal(refused(400, 'bad-request', { detail: 'row 5: x', row: 5, reason: 'length' }), [1])).toBe(`${ST['names-bad-request']} (row 5: x)`);
    expect(refusal(refused(400, 'bad-request', { detail: 'row 0: x', row: 0, reason: 'zz-newer' }), [1])).toBe(`${ST['names-bad-request']} (row 0: x)`);
  });
  it('the door\'s other words', () => {
    expect(refusal(refused(403, 'auth-off'), [])).toBe(ST['names-auth-off']);
    expect(refusal(refused(413, 'oversize'), [])).toBe(ST.oversize);
    expect(refusal(refused(503, 'write-failed', { detail: 'the list could not be stored; upload it again' }), []))
      .toBe(`${ST['write-failed']} (the list could not be stored; upload it again)`);
    expect(refusal(refused(503, 'slot-busy'), [])).toBe(ST['slot-busy']);
  });
});

describe('the fix round\'s words', () => {
  it('the new sentences are strings', () => {
    expect(typeof W.namesGone).toBe('string');
    expect(typeof W.clearFinal).toBe('string');
    expect(typeof W.listEmpty('today')).toBe('string');
    expect(W.listEmpty('today')).toContain('today');
    expect(typeof W.stepUpFinal).toBe('string');
  });
  it('each mode has its word, both ways, and the sentences that list the modes name every one', () => {
    expect(Object.keys(NAME_LIST_MODE_WORDS).sort()).toEqual([...NAME_LIST_MODES].sort());
    for (const w of Object.values(NAME_LIST_MODE_WORDS)) {
      expect(W.format).toContain(w);
      expect(W.badMode(3)).toContain(w);
      expect(NAME_LIST_ROW_TEXT.mode).toContain(w);
    }
  });
});

describe('which refusals keep the text in the box', () => {
  it.each<[string, unknown]>([
    ['a refused row', refused(400, 'bad-request', { row: 2, reason: NAME_LIST_ROW_REFUSALS[0] })],
    ['a refused cap (no row)', refused(400, 'bad-request', { detail: 'at most 1000 rows' })],
    ['oversize', refused(413, 'oversize')],
  ])('%s: kept', (_n, err) => { expect(nameListKeepsText(err)).toBe(true); });
  it.each<[string, unknown]>([
    ['write-failed', refused(503, 'write-failed')],
    ['auth-off', refused(409, 'auth-off')],
    ['slot-busy', refused(503, 'slot-busy')],
    ['an unknown word', refused(500, 'zz-newer-word')],
    ['a 401', refused(401, 'unauthenticated')],
    ['a plain Error', new Error('zz')],
    ['a non-error value', 'zz'],
  ])('%s: emptied', (_n, err) => { expect(nameListKeepsText(err)).toBe(false); });
});

describe('the upload\'s answer', () => {
  it('says how many names the server took', () => {
    expect(uploadAnswerWords({ ok: true, rows: 2, entries: 9, uploadedAt: 1 })).toEqual(['Uploaded: 2 names.']);
    expect(uploadAnswerWords('unreadable')).toEqual([]);
  });
});
