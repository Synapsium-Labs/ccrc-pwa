// X5 A5.1 (plan 2026-11-19-native-docs-html-artifacts, Task A5.1; spec §2.5, §3.2 "Earlier versions", §6.1 Figure 4): which
// tier an HTML page is offered, decided by `artifactOffer` from the box's availability and two facts about the page alone.
// It takes no input about what the walls refused, so a page the walls ran and one they refused are the same call.
import { describe, expect, it } from 'vitest';
import { ARTIFACT_MAX_ORIGINS, ARTIFACT_OFF_WHYS, ARTIFACT_REFUSALS, originAdmitted, type ArtifactOffWhy } from '../../shared/artifacts';
import { ARTIFACT_REFUSAL_TEXT, ARTIFACT_TEXT } from '../src/docs/artifact/artifactWords';
import { aboveFolderCount, artifactOffer, artifactRefusalOf, artifactStop, sheetOrigins } from '../src/docs/artifact/tier';
import { failureSentence, slotSentence } from '../src/docs/docsText';
import type { MockupAssetRow } from '../src/docs/mockup/ports';

const AVAILABLE = { available: true } as const;
const CURRENT = { folder: false, version: false } as const;
const off = (why: ArtifactOffWhy) => ({ available: false, why }) as const;

describe('artifactOffer: Figure 4', () => {
  it('offer: every HTML page (an available box gives the button; the walls are no input, so a page they ran and one they refused are the same call)', () => {
    const ranInFull = artifactOffer(AVAILABLE, CURRENT);
    const refusedByBudget = artifactOffer(AVAILABLE, CURRENT);
    expect(ranInFull).toEqual({ kind: 'button', text: ARTIFACT_TEXT.open });
    expect(refusedByBudget).toEqual(ranInFull);
    expect(ARTIFACT_TEXT.open).toBe('Open as artifact');
  });

  it.each(['unset', 'partial', 'invalid'] as const)('%s: a disabled button with the setup sentence', (why) => {
    expect(artifactOffer(off(why), CURRENT)).toEqual({ kind: 'disabled', text: ARTIFACT_TEXT.setup });
  });

  it('by-address: disabled with the address sentence', () => {
    expect(artifactOffer(off('by-address'), CURRENT)).toEqual({ kind: 'disabled', text: ARTIFACT_TEXT.byAddress });
  });

  it('listener-down: disabled with the listener sentence', () => {
    expect(artifactOffer(off('listener-down'), CURRENT)).toEqual({ kind: 'disabled', text: ARTIFACT_TEXT.listenerDown });
  });

  it('auth-off: no offer, no sentence', () => {
    expect(artifactOffer(off('auth-off'), CURRENT)).toEqual({ kind: 'none', text: '' });
  });

  it('an outside-folder page: no offer, whether or not the box has the tier', () => {
    expect(artifactOffer(AVAILABLE, { folder: true, version: false })).toEqual({ kind: 'none', text: '' });
    expect(artifactOffer(off('unset'), { folder: true, version: false })).toEqual({ kind: 'none', text: '' });
  });

  it('offer: a version page gets its sentence (and the same page at its current version gets the button)', () => {
    expect(artifactOffer(AVAILABLE, { folder: false, version: true })).toEqual({ kind: 'none', text: ARTIFACT_TEXT.version });
    expect(artifactOffer(AVAILABLE, { folder: false, version: false }).kind).toBe('button');
  });

  it('Figure 4 order: the version question comes first, so a version page gets its sentence on any box that is not folder-bound', () => {
    expect(artifactOffer(off('unset'), { folder: false, version: true })).toEqual({ kind: 'none', text: ARTIFACT_TEXT.version });
  });

  it('every off reason is answered (a new reason added to the vocabulary fails here until it has a sentence or a none)', () => {
    for (const why of ARTIFACT_OFF_WHYS) {
      const o = artifactOffer(off(why), CURRENT);
      expect(o.kind === 'disabled' ? o.text.length > 0 : o.kind === 'none' && why === 'auth-off', why).toBe(true);
    }
  });
});

describe('the words', () => {
  it('the sentences are the spec\'s (§2.5, §3.2, §6.2)', () => {
    expect(ARTIFACT_TEXT.setup).toBe('Running it in full needs this box\'s artifact host (ccrc expose artifacts).');
    expect(ARTIFACT_TEXT.byAddress).toBe('This box is reached by address, and artifacts need names.');
    expect(ARTIFACT_TEXT.listenerDown).toBe('This box\'s artifact listener is not running. ccrc doctor says why.');
    expect(ARTIFACT_TEXT.version).toBe('Only the current version of a page runs as an artifact. Go back to the latest to open it.');
  });

  it('the sheet\'s Why line is the words module\'s constant', () => {
    expect(ARTIFACT_TEXT.why).toBe(
      'The view above runs this page within ccrc\'s walls, where dialogs, windows, downloads, WebAssembly, workers and large files may not work. '
      + 'As an artifact it runs in full, in a new tab.');
  });
});

describe('artifactRefusalOf', () => {
  it('a refusal word in an {ok: false, error} body is that word', () => {
    for (const word of ARTIFACT_REFUSALS) expect(artifactRefusalOf({ ok: false, error: word })).toBe(word);
  });

  it('a string that is not a word is null', () => {
    expect(artifactRefusalOf({ ok: false, error: 'something-else' })).toBeNull();
  });

  it('a docs failure body is null', () => {
    expect(artifactRefusalOf({ ok: false, failure: 'not-found' })).toBeNull();
  });

  it('an ok body, a non-string error, a primitive and null are null', () => {
    expect(artifactRefusalOf({ ok: true, error: 'pin-moved' })).toBeNull();
    expect(artifactRefusalOf({ ok: false, error: 7 })).toBeNull();
    expect(artifactRefusalOf('pin-moved')).toBeNull();
    expect(artifactRefusalOf(null)).toBeNull();
    expect(artifactRefusalOf(undefined)).toBeNull();
  });
});

/** A census row as the planner leaves it, with only the fields `aboveFolderCount` reads. */
const rowAt = (basePath: string, raw: string): MockupAssetRow => (
  { ref: { key: raw, raw, basePath, kind: 'img', depth: 0 }, verdict: { v: 'missing' }, size: null } as unknown as MockupAssetRow
);

describe('aboveFolderCount (A5.2: the references the launch sheet says will not load)', () => {
  const page = { section: 'specs', path: 'pages/m.html' } as const;
  const at = (raw: string, basePath = 'specs/pages/m.html'): MockupAssetRow => rowAt(basePath, raw);

  it('counts a reference to a file above the page\'s folder in its own section', () => {
    expect(aboveFolderCount([at('../shared/lib.js'), at('./own.js'), at('sub/own.png')], page)).toBe(1);
  });

  it('counts a reference into another section, and one to a repo path outside the docs', () => {
    expect(aboveFolderCount([at('../../../plans/p.md'), at('../../../../logo.png')], { section: 'specs', path: 'a/b/m.html' })).toBe(2);
  });

  it('counts a reference that climbs above the repository root', () => {
    expect(aboveFolderCount([at('../../../../../../x.png')], page)).toBe(1);
  });

  it('does not count a reference below or beside the page', () => {
    expect(aboveFolderCount([at('a.js'), at('./a/b.js'), at('../pages/c.css')], page)).toBe(0);
  });

  it('a page at a section root has the whole section as its folder', () => {
    const root = { section: 'specs', path: 'm.html' } as const;
    expect(aboveFolderCount([at('other/x.js', 'specs/m.html'), at('x.js', 'specs/m.html')], root)).toBe(0);
    expect(aboveFolderCount([at('../plans/p.md', 'specs/m.html'), at('../../logo.png', 'specs/m.html')], root)).toBe(2);
  });

  it('a stylesheet\'s reference is resolved from the stylesheet\'s own folder, not the page\'s', () => {
    // pages/css/s.css naming ../../up.png is specs/up.png: above the page's folder `pages`.
    expect(aboveFolderCount([at('../../up.png', 'specs/pages/css/s.css')], page)).toBe(1);
    expect(aboveFolderCount([at('../img.png', 'specs/pages/css/s.css')], page)).toBe(0);
  });

  it('does not count external, fragment, data, blob, scheme, root-relative or empty references', () => {
    const none = ['https://cdn.example.test/a.js', '#top', 'data:image/png;base64,AAAA', 'blob:x', 'javascript:f()', '/abs.png', '//cdn.test/a.js', ''];
    expect(aboveFolderCount(none.map((r) => at(r)), page)).toBe(0);
  });
});

describe('artifactStop (A5.2: what stops a scope read or a mint)', () => {
  it('a refusal word is its own sentence, and only pin-moved has the action; only unmeasured offers a retry', () => {
    for (const word of ARTIFACT_REFUSALS) {
      expect(artifactStop({ s: 'refused', word }), word).toEqual({
        sentence: ARTIFACT_REFUSAL_TEXT[word], pinMoved: word === 'pin-moved', retry: word === 'unmeasured',
      });
    }
  });

  it('a docs slot and a docs failure word are the docs views\' sentences, never pin-moved, and each offers a retry', () => {
    expect(artifactStop({ s: 'auth' })).toEqual({ sentence: slotSentence({ s: 'auth' }), pinMoved: false, retry: true });
    expect(artifactStop({ s: 'unreachable' })).toEqual({ sentence: slotSentence({ s: 'unreachable' }), pinMoved: false, retry: true });
    const body = { ok: false, failure: 'absent' } as const;
    expect(artifactStop({ s: 'failed', body })).toEqual({ sentence: failureSentence(body), pinMoved: false, retry: true });
  });
});

describe('sheetOrigins (A5.2: the origins the sheet offers, by the one origin rule of shared/artifacts)', () => {
  const origin = (host: string): string => `https://${host}`;

  it('drops an origin on any of the own hosts, on any port, and keeps the rest in order', () => {
    const got = sheetOrigins(
      [origin('cdn.a.test'), origin('console.test'), origin('art.test:8443'), origin('content.test:9'), origin('cdn.b.test')],
      ['Console.test', 'art.test:8443', 'content.test:8444'],
    );
    expect(got).toEqual([origin('cdn.a.test'), origin('cdn.b.test')]);
  });

  it('keeps at most ARTIFACT_MAX_ORIGINS, the first ones', () => {
    const many = Array.from({ length: 11 }, (_v, i) => origin(`h${i}.test`));
    expect(ARTIFACT_MAX_ORIGINS).toBe(8);
    expect(sheetOrigins(many, [])).toEqual(many.slice(0, 8));
  });

  it('drops what the mint would refuse, and counts only the kept ones against the cap', () => {
    const many = [
      'not a url', 'http://plain.test', 'https://127.0.0.2', 'https://10.1', 'https://0x7f.0.0.1', 'https://Upper.test', 'https://trail.test.',
      ...Array.from({ length: 9 }, (_v, i) => origin(`h${i}.test`)),
    ];
    expect(sheetOrigins(many, [])).toEqual(many.slice(7, 15));
  });

  it('is the shared admission, origin by origin: whatever the mint admits the sheet offers, and the reverse', () => {
    const ours = ['console.test', 'art.test:8443'];
    for (const o of [origin('cdn.a.test'), origin('art.test'), origin('art.test:1'), 'https://127.0.0.2', origin('Up.test'), 'x']) {
      expect(sheetOrigins([o], ours).length === 1, o).toBe(originAdmitted(o, ours));
    }
  });
});
