// X5 A5.1 (plan 2026-11-19-native-docs-html-artifacts, Task A5.1; spec §2.5, §3.2 "Earlier versions", §6.1 Figure 4): which
// tier an HTML page is offered, decided by `artifactOffer` from the box's availability and two facts about the page alone.
// It takes no input about what the walls refused, so a page the walls ran and one they refused are the same call.
import { describe, expect, it } from 'vitest';
import { ARTIFACT_OFF_WHYS, ARTIFACT_REFUSALS, type ArtifactOffWhy } from '../../shared/artifacts';
import { ARTIFACT_TEXT } from '../src/docs/artifact/artifactWords';
import { artifactOffer, artifactRefusalOf } from '../src/docs/artifact/tier';

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
