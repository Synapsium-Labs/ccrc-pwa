// The face on the place (Overlord W1 home B, Task 6; plan question 11): the character at scale 4 in `useMood()`'s mood, the
// mood's cause in its accessible name, played for `MOOD_PLAY_MS` after each change and then still. `useMood` is replaced by a
// handle the test turns; `face-mark.test.tsx` pins the mood itself, and the bar's mark, over the real store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ART } from '@ccrc/ui';
import type { Mood } from '../../shared/face';
import { MOOD_PLAY_MS } from '../src/face/FaceMark';
import { MOOD_RULES } from '../src/face/mood';
import { FacePart } from '../src/overlord/FacePart';

const handle: { mood: Mood; cause: string } = { mood: 'sleeping', cause: 'nothing needs anyone' };
vi.mock('../src/face/useMood', () => ({ useMood: () => ({ mood: handle.mood, cause: handle.cause }) }));

beforeEach(() => {
  handle.mood = 'sleeping';
  handle.cause = 'nothing needs anyone';
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const face = (): SVGElement => screen.getByRole('img') as unknown as SVGElement;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('FacePart', () => {
  it('draws the character at scale 4: 128 px', () => {
    render(<FacePart />);
    expect(face().getAttribute('width')).toBe('128');
    expect(face().getAttribute('height')).toBe('128');
  });

  it('the accessible name is the art\'s label and then the cause, for every mood the console can wear', () => {
    const { rerender } = render(<FacePart />);
    expect(face().getAttribute('aria-label')).toBe(`${ART.orb.sleeping.label}: nothing needs anyone`);
    handle.mood = 'alert';
    handle.cause = MOOD_RULES.alert.kind === 'measured' ? MOOD_RULES.alert.cause : '';
    rerender(<FacePart />);
    expect(face().getAttribute('aria-label')).toBe(`${ART.orb.alert.label}: a session has a question for you`);
    expect(face().getAttribute('aria-label')).toContain(handle.cause);
  });

  it('plays for MOOD_PLAY_MS, then holds still', () => {
    render(<FacePart />);
    expect(face().hasAttribute('data-still')).toBe(false);
    advance(MOOD_PLAY_MS - 1);
    expect(face().hasAttribute('data-still')).toBe(false);
    advance(1);
    expect(face().hasAttribute('data-still')).toBe(true);
  });

  it('a new mood plays again, and the old timer does not cut it short', () => {
    const { rerender } = render(<FacePart />);
    advance(4000);
    handle.mood = 'alert';
    handle.cause = 'a session has a question for you';
    rerender(<FacePart />);
    expect(face().hasAttribute('data-still')).toBe(false);
    advance(MOOD_PLAY_MS - 1);
    expect(face().hasAttribute('data-still')).toBe(false);
    advance(1);
    expect(face().hasAttribute('data-still')).toBe(true);
  });
});
