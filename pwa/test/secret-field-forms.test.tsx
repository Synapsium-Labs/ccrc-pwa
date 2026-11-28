// The secret field's two newer pieces (`accounts/SecretField.tsx`, Overlord W2 Settings, ruled call 1815), on the component alone: a
// read that leaves the value in the field (`peek`), and the multiline form (an uncontrolled, unmasked text area for the private-name
// list). The existing behaviour, `take`, `clear`, the hidden page, the route change and the markup, is pinned in
// `secret-field-sheets.test.tsx`; this file pins what the two additions must not move, and what they add. Synthetic values only.
import { createRef, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SecretField, type SecretFieldHandle } from '../src/accounts/SecretField';
import { navigate } from '../src/lib/router';
import { expectSecretInput } from './secretInputAttrs';

const VALUE = 'zz-alpha-' + 'q'.repeat(24);
const LINES = 'zz-alpha\nexact: zq-bravo-x9\n\nwords: zz-charlie';
const LABEL = 'The field';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

function host(multiline: boolean): { handle: () => SecretFieldHandle; presence: ReturnType<typeof vi.fn> } {
  const presence = vi.fn();
  // The host's ref lives outside the render, so the handle survives the host's own re-renders.
  const held: { current: SecretFieldHandle | null } = { current: null };
  function Host(): ReactNode {
    const handle = useRef<SecretFieldHandle>(null);
    const [, setN] = useState(0);
    held.current = handle.current;
    return (
      <SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={(has) => { presence(has); setN((n) => n + 1); }} />
    );
  }
  const drawn = render(<Host />);
  // Mounted: the handle is set by now; read it through a re-render of the host.
  drawn.rerender(<Host />);
  return { handle: () => held.current!, presence };
}
const field = (): HTMLInputElement & HTMLTextAreaElement => screen.getByLabelText(LABEL) as HTMLInputElement & HTMLTextAreaElement;
const type = (value: string): void => { fireEvent.input(field(), { target: { value } }); };

describe('peek, on the single-line field', () => {
  it('peek() returns the typed value and leaves it in the field, and onPresence is not told false', () => {
    const { handle, presence } = host(false);
    type(VALUE);
    presence.mockClear();
    expect(handle().peek()).toBe(VALUE);
    expect(field().value).toBe(VALUE);
    expect(presence).not.toHaveBeenCalledWith(false);
    // Read again: still there, as many times as asked.
    expect(handle().peek()).toBe(VALUE);
    expect(field().value).toBe(VALUE);
  });

  it('take() still empties it, after a peek', () => {
    const { handle, presence } = host(false);
    type(VALUE);
    expect(handle().peek()).toBe(VALUE);
    expect(handle().take()).toBe(VALUE);
    expect(field().value).toBe('');
    expect(presence).toHaveBeenLastCalledWith(false);
    expect(handle().peek()).toBe('');
  });

  it('clear() after a peek empties it', () => {
    const { handle, presence } = host(false);
    type(VALUE);
    handle().peek();
    act(() => handle().clear());
    expect(field().value).toBe('');
    expect(presence).toHaveBeenLastCalledWith(false);
    expect(handle().peek()).toBe('');
  });

  it('a page hide empties it even after a peek', () => {
    const { handle } = host(false);
    type(VALUE);
    handle().peek();
    act(() => setVisibility('visible'));
    expect(field().value).toBe(VALUE);
    act(() => setVisibility('hidden'));
    expect(field().value).toBe('');
    expect(handle().peek()).toBe('');
  });
});

describe('the multiline form', () => {
  it('is a text area with no type, no Show control and no name, unmasked', () => {
    host(true);
    expect(field().tagName).toBe('TEXTAREA');
    expect(field().hasAttribute('type')).toBe(false);
    expect(field().hasAttribute('name')).toBe(false);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('Show')).toBeNull();
    type(LINES);
    // Unmasked: the typed text is what the box shows, line breaks included.
    expect(field().value).toBe(LINES);
  });

  it('carries the single-line field\'s attributes: every autofill, correction and password-manager opt-out, and no credential-like id', () => {
    host(true);
    // The assertion is typed for an input; every attribute it reads is the same on a text area.
    expectSecretInput(field() as unknown as HTMLInputElement);
    expect(field().rows).toBeGreaterThan(1);
    cleanup();
    host(false);
    expectSecretInput(field());
  });

  it('is emptied on a page hide', () => {
    host(true);
    type(LINES);
    act(() => setVisibility('visible'));
    expect(field().value).toBe(LINES);
    act(() => setVisibility('hidden'));
    expect(field().value).toBe('');
  });

  it('is emptied on a route change while it stays mounted', () => {
    host(true);
    type(LINES);
    const node = field();
    act(() => navigate('/accounts?lane=lane-a'));
    expect(field()).toBe(node);
    expect(field().value).toBe('');
  });

  it('never puts the typed text in the markup: it is uncontrolled', () => {
    host(true);
    type(LINES);
    expect(field().value).toBe(LINES);
    expect(document.documentElement.outerHTML).not.toContain('zz-alpha');
    expect(document.documentElement.outerHTML).not.toContain('zq-bravo-x9');
    expect(field().textContent).toBe('');
    expect(field().getAttribute('value')).toBeNull();
  });

  it('peek() returns the whole multi-line text and leaves it; take() returns it once and empties it', () => {
    const { handle, presence } = host(true);
    type(LINES);
    presence.mockClear();
    expect(handle().peek()).toBe(LINES);
    expect(field().value).toBe(LINES);
    expect(presence).not.toHaveBeenCalledWith(false);
    expect(handle().take()).toBe(LINES);
    expect(field().value).toBe('');
    expect(presence).toHaveBeenLastCalledWith(false);
  });

  it('tells onPresence whether it holds anything as it is typed in', () => {
    const { presence } = host(true);
    type(LINES);
    expect(presence).toHaveBeenLastCalledWith(true);
    type('');
    expect(presence).toHaveBeenLastCalledWith(false);
  });
});

// Review 4167 F2, ruled call 1930: a host holds the field while a step shows. The prop is additive: absent, the field is as before.
describe('held', () => {
  const drawn = (multiline: boolean, held?: boolean): void => {
    const handle = createRef<SecretFieldHandle>();
    render(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} {...(held === undefined ? {} : { held })} />);
  };
  it.each([false, true])('absent or false, the field takes input as before (multiline %s)', (multiline) => {
    drawn(multiline);
    expect(field().disabled).toBe(false);
    cleanup();
    drawn(multiline, false);
    expect(field().disabled).toBe(false);
  });
  it.each([false, true])('held, the field is disabled, so no keystroke reaches it, and the value it holds is kept (multiline %s)', (multiline) => {
    const handle = createRef<SecretFieldHandle>();
    const { rerender } = render(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} />);
    type(VALUE);
    rerender(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} held />);
    expect(field().disabled).toBe(true);
    expect(field().value).toBe(VALUE);
    expect(handle.current!.peek()).toBe(VALUE);
    rerender(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} />);
    expect(field().disabled).toBe(false);
    expect(field().value).toBe(VALUE);
  });
  it.each([false, true])('held, the page hide still empties it (multiline %s)', (multiline) => {
    const handle = createRef<SecretFieldHandle>();
    const { rerender } = render(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} />);
    type(VALUE);
    rerender(<SecretField label={LABEL} handle={handle} multiline={multiline} onPresence={() => {}} held />);
    act(() => setVisibility('hidden'));
    expect(field().value).toBe('');
  });
});
