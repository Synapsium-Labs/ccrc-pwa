// The bell's SIX answers — one per `EnableStatus`, each sending the reader
// somewhere different — measured at 35% of statements before this file.
//
// WHY THE MAPPING IS THE WHOLE COMPONENT. `enablePush` distinguishes six
// outcomes precisely so the UI can point at the right remedy: a browser
// setting, a server that was never configured, a push TRANSPORT that is off,
// or something unknown with its own detail. Collapsing any two of them sends
// somebody to a setting that will not help. That mapping had no test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { EnableResult } from '../src/lib/push';

const push = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true),
  pushEnabled: vi.fn(async () => false),
  enablePush: vi.fn(async (): Promise<EnableResult> => ({ status: 'enabled' })),
  disablePush: vi.fn(async () => {}),
}));
vi.mock('../src/lib/push', () => push);

const { NotificationBell } = await import('../src/fleet/NotificationBell');

beforeEach(() => {
  push.pushSupported.mockReturnValue(true);
  push.pushEnabled.mockResolvedValue(false);
  push.enablePush.mockResolvedValue({ status: 'enabled' });
  push.disablePush.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(<><NotificationBell /><ToastHost /></>);
const bell = () => screen.getByRole('button', { name: /Notifications (on|off)/ });

describe('the bell renders only where push can work', () => {
  it('renders NOTHING at all on a browser without Web Push', () => {
    // Not a disabled bell: a control that can never work is noise in a header
    // this app keeps deliberately short.
    push.pushSupported.mockReturnValue(false);
    mount();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks the browser ONCE, at mount, and never again while it is up', () => {
    // `useState(() => pushSupported())` — the support question cannot change
    // for the life of a page, and asking it per render would be three DOM
    // lookups a frame on the fleet screen's hottest row.
    mount();
    expect(push.pushSupported).toHaveBeenCalledTimes(1);
  });

  it('starts OFF and turns itself on when the browser is already subscribed', async () => {
    push.pushEnabled.mockResolvedValue(true);
    mount();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
    expect(bell()).toHaveAccessibleName('Notifications on');
    expect(bell().className).toContain('bell--on');
  });
});

describe('every status reaches its own remedy', () => {
  it('`enabled`: the bell flips on and the toast says what it bought', async () => {
    mount();
    fireEvent.click(bell());
    expect(await screen.findByText(/you'll get a ping when a session needs you/)).toBeInTheDocument();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
  });

  it('`denied`: points at the BROWSER settings, and the bell stays off', async () => {
    push.enablePush.mockResolvedValue({ status: 'denied' });
    mount();
    fireEvent.click(bell());
    const t = await screen.findByText(/Allow notifications in your browser settings first/);
    expect(t.closest('[role="alert"]'), 'a refusal is an alert, not a status').not.toBeNull();
    expect(bell(), 'a refused request must not leave the control looking armed')
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('`unconfigured`: points at the SERVER, which is nothing the reader can fix', async () => {
    push.enablePush.mockResolvedValue({ status: 'unconfigured' });
    mount();
    fireEvent.click(bell());
    expect(await screen.findByText(/Push isn't set up on the server/)).toBeInTheDocument();
  });

  it('`pushservice`: names Brave\'s own setting AND stays up, because the fix is multi-step', async () => {
    // The sticky toast is the point: an auto-dismissing one cannot carry
    // "Settings → Privacy and security" long enough to be followed, which is
    // why this arm passes an action and no other does.
    push.enablePush.mockResolvedValue({ status: 'pushservice', detail: 'AbortError' });
    mount();
    fireEvent.click(bell());
    expect(await screen.findByText(/Use Google services for push messaging/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' }),
      'the action is what keeps a multi-step remedy on screen').toBeInTheDocument();
  });

  it('`error`: carries the detail when there is one', async () => {
    push.enablePush.mockResolvedValue({ status: 'error', detail: 'key endpoint 503' });
    mount();
    fireEvent.click(bell());
    expect(await screen.findByText("Couldn't enable notifications: key endpoint 503")).toBeInTheDocument();
  });

  it('`error`: and no dangling colon when there is none', async () => {
    // The ternary's other arm. A trailing `: ` reads as a message that was
    // cut off — worse than saying less.
    push.enablePush.mockResolvedValue({ status: 'error' });
    mount();
    fireEvent.click(bell());
    expect(await screen.findByText("Couldn't enable notifications")).toBeInTheDocument();
  });
});

describe('turning it back off', () => {
  it('unsubscribes, flips the bell and says so', async () => {
    push.pushEnabled.mockResolvedValue(true);
    mount();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(bell());
    expect(await screen.findByText('Notifications off')).toBeInTheDocument();
    expect(push.disablePush).toHaveBeenCalledTimes(1);
    expect(push.enablePush, 'turning OFF must not ask to enable').not.toHaveBeenCalled();
    await waitFor(() => expect(bell()).toHaveAttribute('aria-pressed', 'false'));
  });

  it('refuses a second tap while the first is still in flight', async () => {
    // `busy` disables the button for exactly this: two taps would mint two
    // subscriptions, or race a subscribe against an unsubscribe.
    let release!: (r: EnableResult) => void;
    push.enablePush.mockReturnValue(new Promise<EnableResult>((res) => { release = res; }));
    mount();
    fireEvent.click(bell());
    await waitFor(() => expect(bell()).toBeDisabled());
    fireEvent.click(bell());
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    release({ status: 'enabled' });
    await waitFor(() => expect(bell()).not.toBeDisabled());
  });
});
