// The prompt composition rule, shared so the server that types a prompt and the
// PWA that recognises its echo can never disagree — plus its inverse, which has
// to cope with `ccd clip` typing a path on either side of the user's prose.
import { describe, expect, it } from 'vitest';
import { composePrompt, splitClipPaths } from '../../shared/api';

const P1 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150340-a1b2.png';
const P2 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150341-c3d4.jpg';

describe('composePrompt', () => {
  it('puts each attachment on its own line above the text', () => {
    expect(composePrompt('look at this', [P1])).toBe(`${P1}\nlook at this`);
    expect(composePrompt('two', [P1, P2])).toBe(`${P1}\n${P2}\ntwo`);
  });

  it('is the identity when there are no attachments', () => {
    expect(composePrompt('plain text', [])).toBe('plain text');
  });

  it('omits the blank line when an image is sent with no text', () => {
    expect(composePrompt('', [P1])).toBe(P1);
  });
});

describe('splitClipPaths', () => {
  it('splits its own composed output back apart', () => {
    expect(splitClipPaths(composePrompt('look at this', [P1, P2]))).toEqual({
      paths: [P1, P2],
      rest: 'look at this',
    });
  });

  it('extracts a TRAILING path — what `ccd clip` produces when you type first', () => {
    // Verbatim from the transcript that motivated this feature.
    const raw =
      'Please make the handling of of screenshot attachments much nicer from a ' +
      `ui/ux perspective, what's there now is Poor ${P1}`;
    expect(splitClipPaths(raw)).toEqual({
      paths: [P1],
      rest:
        'Please make the handling of of screenshot attachments much nicer from a ' +
        "ui/ux perspective, what's there now is Poor",
    });
  });

  it('extracts a LEADING same-line path and eats ccd\'s trailing space', () => {
    expect(splitClipPaths(`${P1} what is this`)).toEqual({ paths: [P1], rest: 'what is this' });
  });

  it('extracts a MID-line path without doubling the surrounding spaces', () => {
    expect(splitClipPaths(`before ${P1} after`)).toEqual({ paths: [P1], rest: 'before after' });
  });

  it('reports a repeated path once', () => {
    expect(splitClipPaths(`${P1} and again ${P1}`)).toEqual({ paths: [P1], rest: 'and again' });
  });

  it('leaves a non-clip absolute path as prose', () => {
    const raw = 'see /etc/hosts and /home/me/photo.png';
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('returns text-only input untouched', () => {
    expect(splitClipPaths('nothing here')).toEqual({ paths: [], rest: 'nothing here' });
  });
});
