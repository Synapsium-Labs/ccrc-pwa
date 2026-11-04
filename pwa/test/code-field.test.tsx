// The code field (accounts plan Task A22, D-7849; spec §3.7, §6.2 step 6, §12.4): paste-first, trimmed, sent once, and
// held only in its own DOM node. The sheet's use of it is `sign-in-sheet.test.tsx`'s.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodeField } from '../src/accounts/CodeField';
import { CODE_FIELD_LABEL, SEND_CODE } from '../src/fleet/accountWords';

const CODE = 'A'.repeat(48) + '#' + 'b'.repeat(40) + '-_9';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = (): HTMLInputElement => screen.getByLabelText(CODE_FIELD_LABEL) as HTMLInputElement;
const send = (): HTMLButtonElement => screen.getByRole('button', { name: SEND_CODE }) as HTMLButtonElement;
const paste = (text: string): void => {
  fireEvent.paste(field(), { clipboardData: { getData: (t: string) => (t === 'text' ? text : '') } });
};

describe('the code field (spec §3.7, §12.4)', () => {
  it('is a one-time-code field in mono, with no name a password manager keys on', () => {
    render(<CodeField onSend={() => {}} />);
    const f = field();
    expect(f).toHaveAttribute('autocomplete', 'one-time-code');
    expect(f).toHaveAttribute('autocapitalize', 'off');
    expect(f).toHaveAttribute('spellcheck', 'false');
    expect(f).toHaveAttribute('inputmode', 'text');
    expect(f).not.toHaveAttribute('name');
    expect(f.className).toMatch(/font-mono/);
    // Nothing to send yet.
    expect(send()).toBeDisabled();
  });

  it('a pasted code is trimmed and sent once; the field is disabled after Send', () => {
    const onSend = vi.fn();
    render(<CodeField onSend={onSend} />);
    paste(`  \n${CODE}\t \n`);
    expect(field().value).toBe(CODE);
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    fireEvent.click(send());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(CODE);
    expect(field()).toBeDisabled();
    expect(send()).toBeDisabled();
    // Emptied as it was read: the code is in no node of the page.
    expect(field().value).toBe('');
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('a typed code is trimmed too, and Enter sends it', () => {
    const onSend = vi.fn();
    render(<CodeField onSend={onSend} />);
    fireEvent.input(field(), { target: { value: `  ${CODE}  ` } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith(CODE);
    expect(field()).toBeDisabled();
  });

  it("the host's hold sends nothing", () => {
    const onSend = vi.fn();
    render(<CodeField onSend={onSend} disabled />);
    expect(field()).toBeDisabled();
    expect(send()).toBeDisabled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('the code is never written to a store or storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const onSend = vi.fn();
    render(<CodeField onSend={onSend} />);
    paste(CODE);
    // Before Send the value is the DOM node's alone: never the markup's `value` attribute.
    expect(field().getAttribute('value')).toBeNull();
    expect(document.body.innerHTML).not.toContain(CODE);
    fireEvent.click(send());
    expect(setItem).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith(CODE);
  });
});
