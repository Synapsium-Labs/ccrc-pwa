/**
 * JUMP TO LATEST NEVER COVERS RETRY OR DISCARD (the audit's B12; plan Task 17,
 * D-5464).
 *
 * `.jump-latest` is absolutely placed over the foot of the list, `--sp-3` above
 * it and at least `--tap-min` tall, and `ChatList` raises it whenever virtuoso
 * reports the reader is not at the bottom. With virtuoso's own at-bottom
 * threshold (4px), a reader 6-40px above the end got the pill ON TOP of a
 * failed send's Retry (measured at 390 in headless Chromium against the built
 * app: the pill at 714-758, Retry's top at 724-758). The cause is (b) in the plan's
 * terms: the pill shows while the last row is still in its band.
 *
 * The plan's remedy for (b), a Footer the pill's size present only while it
 * shows, was measured and moves nothing: added below the viewport, it leaves
 * every row exactly where it was, and the row clears the pill only at the very
 * end, where the pill already hides (D-5464). So the reader counts as at the
 * newest turn while its foot is anywhere inside the pill's band: virtuoso's
 * at-bottom threshold is the pill's height plus its offset, read from the same
 * two tokens the pill's rule is drawn with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import type { ChatEvent } from '../../shared/api';
import type { PendingSend } from '../src/stores/session';

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrolls: [] as unknown[],
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: Record<string, unknown>) => {
      seen.props = props;
      React.useImperativeHandle(props.ref as React.Ref<unknown>, () => ({
        scrollToIndex: (location: unknown) => { seen.scrolls.push(location); },
      }));
      const count = props.totalCount as number;
      const content = props.itemContent as (i: number) => ReactNode;
      const keyOf = props.computeItemKey as (i: number) => string | number;
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: count }, (_, i) =>
          React.createElement('div', { key: keyOf(i), 'data-index': i }, content(i))),
      );
    },
  };
});

const { ChatList } = await import('../src/session/ChatList');

const root = document.documentElement;
const tokens = (tap: string | null, sp3: string | null): void => {
  if (tap === null) root.style.removeProperty('--tap-min'); else root.style.setProperty('--tap-min', tap);
  if (sp3 === null) root.style.removeProperty('--sp-3'); else root.style.setProperty('--sp-3', sp3);
};

afterEach(() => {
  cleanup();
  tokens(null, null);
  seen.props = null;
  seen.scrolls = [];
});

const events: ChatEvent[] = [
  { kind: 'user', uuid: 'u0', ts: '2026-10-15T11:58:00Z', text: 'A question about lane-a' },
  { kind: 'assistant', uuid: 'a0', ts: '2026-10-15T11:59:00Z', text: 'An answer.' },
];
const failed: PendingSend = { key: 'k1', text: 'A message that did not send', state: 'failed', error: 'Not sent.' };

const visit = (): void => {
  render(
    <ChatList id="project-a" events={events} pending={[failed]} onRetry={() => {}} onDiscard={() => {}} />,
  );
};
const atBottom = (bottom: boolean): void => {
  act(() => { (seen.props?.atBottomStateChange as (b: boolean) => void)(bottom); });
};
const pill = (): Element | null => document.querySelector('.jump-latest');

describe('Jump to latest never covers a failed send\'s Retry or Discard', () => {
  it('the reader is at the newest turn while its foot is inside the pill\'s band: the threshold is the pill\'s height plus its offset', () => {
    tokens('44px', '12px');
    visit();
    expect(seen.props?.atBottomThreshold).toBe(44 + 12);
  });

  it('reads the band from the tokens, not from a copy of their values', () => {
    tokens('50px', '10px');
    visit();
    expect(seen.props?.atBottomThreshold).toBe(60);
  });

  it('the band is the pill\'s own: its rule is drawn with the same two tokens', () => {
    const css = readFileSync(resolve(__dirname, '../src/session/chat.css'), 'utf8');
    const rule = /\n\.jump-latest \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/\n\s*bottom: var\(--sp-3\);/);
    expect(rule).toMatch(/\n\s*min-height: var\(--tap-min\);/);
  });

  it('with tokens it cannot read, it keeps virtuoso\'s own threshold rather than a made-up one', () => {
    tokens(null, null);
    visit();
    expect(seen.props).not.toBeNull();
    expect(seen.props?.atBottomThreshold).toBeUndefined();
  });

  it('a failed send as the newest item: no pill at the bottom; past the band the pill shows, and it jumps to the send', () => {
    tokens('44px', '12px');
    visit();
    expect(document.querySelector('.pending-actions')).not.toBeNull();
    expect(pill()).toBeNull();
    // Out of the list's settling window, so leaving the bottom is the reader's own doing.
    fireEvent.wheel(document.querySelector('[data-testid="virtuoso"]')!);
    atBottom(false);
    expect(pill()).not.toBeNull();
    fireEvent.click(pill()!);
    expect(seen.scrolls.at(-1)).toEqual({ index: 3, behavior: 'smooth' });
  });
});
