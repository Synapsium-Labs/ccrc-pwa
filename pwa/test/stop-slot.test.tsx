// Stop in the send slot (W2 Task S7b; D-5471, inside D-5099's "Later").
//
// While a turn runs and the draft is empty, the composer's send slot is a `danger` Stop. Typing returns the slot to
// Send (sending during a turn is unchanged) and a `danger-ghost` Stop stays beside it, so Stop is never more than one
// tap away. The slot's Stop reports the source word the server already records for the on-screen control, `keycap`:
// W2 changes no wire. The variant is asserted HERE, on the slot's own button, not through the variant suite.
//
// The Escape key's interrupt is S2d's hook, unchanged: it still fires under a fine pointer, and never from inside the
// composer's text field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Composer, STOP_SETTLE_MS } from '../src/session/Composer';
import { api } from '../src/lib/api';
import { useEscapeInterrupt } from '../src/session/useEscapeInterrupt';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

const stops = (): HTMLElement[] => screen.queryAllByRole('button', { name: 'Stop' });

describe('Stop in the send slot', () => {
  it('while busy with an empty draft, the send slot is Stop, carrying the danger variant\'s marker, and interrupts with source keycap', () => {
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} pending={[]} busy onInterrupt={onInterrupt} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(stops()).toHaveLength(1);
    const stop = stops()[0]!;
    expect(stop).toHaveClass('btn-danger');
    expect(stop).not.toHaveClass('btn-primary');
    // The word is on the control; the square is decoration beside it.
    expect(stop).toHaveTextContent('Stop');
    expect(stop.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(stop);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith('keycap');
  });

  it('typing while busy returns the slot to Send, and a Stop carrying the danger-ghost marker stays beside it', () => {
    const onInterrupt = vi.fn();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} busy onInterrupt={onInterrupt} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'one more thing' } });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    expect(stops()).toHaveLength(1);
    const ghost = stops()[0]!;
    expect(ghost).toHaveClass('btn-danger-ghost');
    expect(ghost).not.toHaveClass('btn-danger');
    // Beside it, in the same bar: the ghost Stop and Send are siblings.
    expect(ghost.parentElement).toBe(send.parentElement);
    fireEvent.click(ghost);
    expect(onInterrupt).toHaveBeenCalledWith('keycap');
    // Sending during a turn is unchanged.
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith('one more thing');
    // The draft is empty again, so the slot is Stop again.
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(stops()[0]).toHaveClass('btn-danger');
  });

  it('a second tap right after Send during a busy turn does not interrupt: the Stop that replaces Send settles first', () => {
    // A double-tap on Send used to send the prompt and then stop the turn, because the danger Stop takes Send's spot
    // the moment the draft empties. The Stop ignores taps for STOP_SETTLE_MS after a send, then works as before.
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const onInterrupt = vi.fn();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} busy onInterrupt={onInterrupt} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'quick one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('quick one');
    now += 120;
    fireEvent.click(stops()[0]!);
    expect(onInterrupt).not.toHaveBeenCalled();
    now += STOP_SETTLE_MS;
    fireEvent.click(stops()[0]!);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith('keycap');
  });

  it('a staged image alone counts as drafted: Send stays in the slot, with the danger-ghost Stop beside it', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue({ path: '/p/shot-1.png', name: 'shot-1.png', bytes: 9 });
    render(<Composer id="claude:ProjectC" onSend={vi.fn()} pending={[]} busy onInterrupt={vi.fn()} />);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File([new Uint8Array(64)], 'shot.png', { type: 'image/png' }) }],
        getData: () => '',
      },
    });
    fireEvent(screen.getByRole('textbox', { name: 'Message' }), event);
    await screen.findByAltText('shot.png');
    expect(await screen.findByRole('button', { name: 'Send' })).toBeEnabled();
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveClass('btn-danger-ghost');
  });

  it('the danger-ghost Stop keeps the 44px tap floor', () => {
    render(<Composer onSend={vi.fn()} pending={[]} busy onInterrupt={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'x' } });
    expect(stops()[0]).toHaveClass('min-w-tap');
  });

  it('an idle session keeps Send in the slot and draws no Stop', () => {
    render(<Composer onSend={vi.fn()} pending={[]} busy={false} onInterrupt={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(stops()).toHaveLength(0);
  });
});

function Harness({ busy, onInterrupt }: { busy: boolean; onInterrupt: (s: string) => void }): ReactNode {
  useEscapeInterrupt({ busy, onInterrupt: () => onInterrupt('escape-key') });
  return <Composer onSend={vi.fn()} pending={[]} busy={busy} onInterrupt={onInterrupt} />;
}

describe('the Escape key, beside the slot', () => {
  it('Escape still interrupts a busy turn under a fine pointer, and never from the composer', () => {
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<Harness busy onInterrupt={onInterrupt} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Escape' });
    expect(onInterrupt).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith('escape-key');
  });
});
