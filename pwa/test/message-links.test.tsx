import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/session/MessageBubble';

afterEach(cleanup);

const assistant = (text: string) =>
  render(<MessageBubble id="s" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z', text }} />);

describe('MessageBubble link + image rendering', () => {
  it('renders bare URLs as external links (target=_blank, rel=noopener)', () => {
    assistant('see https://example.com/docs for details');
    const a = screen.getByRole('link', { name: 'https://example.com/docs' });
    expect(a).toHaveAttribute('href', 'https://example.com/docs');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('renders markdown image syntax as an inline <img>', () => {
    assistant('![a chart](https://example.com/chart.png)');
    const img = screen.getByRole('img', { name: 'a chart' });
    expect(img).toHaveAttribute('src', 'https://example.com/chart.png');
  });

  it('renders a bare image URL as an inline image, not a text link', () => {
    assistant('here it is: https://example.com/render.jpg');
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/render.jpg');
  });

  it('clicking a link opens a new browser context via window.open (not in-app nav)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    assistant('go to https://example.com/docs now');
    fireEvent.click(screen.getByRole('link', { name: 'https://example.com/docs' }));
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('normalizes a scheme-less link so it is not resolved same-origin', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    assistant('[docs](example.com/guide)');
    fireEvent.click(screen.getByRole('link', { name: 'docs' }));
    expect(open).toHaveBeenCalledWith('https://example.com/guide', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('makes URLs in a user message tappable', () => {
    render(<MessageBubble id="s" event={{ kind: 'user', uuid: 'u1', ts: '2026-07-21T20:00:00Z', text: 'check https://example.com/x' }} />);
    const a = screen.getByRole('link', { name: 'https://example.com/x' });
    expect(a).toHaveAttribute('target', '_blank');
  });
});

// — Sent attachments. A user turn carries its clips as PATHS in the text; the
//   bubble lifts them out and draws one per clip. An image gets a thumbnail; a
//   document has nothing to draw, so it gets its name.
//
//   Not cosmetic: `<img src="…/clip-x.md">` fails to decode and lands on the
//   same onError fallback that exists for a clip DELETED off disk, so a file
//   that is present and perfectly readable would render as "gone".
const ID = 'claude2-demo-app-ts';
const clip = (name: string) => `/home/you/.cc-clips/${ID}/${name}`;
const userWith = (text: string) =>
  render(<MessageBubble id={ID} event={{ kind: 'user', uuid: 'u2', ts: '2026-07-21T20:00:00Z', text }} />);

describe('MessageBubble sent attachments', () => {
  it('draws a document clip as its name, and issues no image request for it', () => {
    const { container } = userWith(`${clip('clip-20260726-150342-e5f6-design-notes.md')}\nread this`);

    expect(container.querySelector('img')).toBeNull();
    const chip = screen.getByRole('link', { name: 'clip-20260726-150342-e5f6-design-notes.md' });
    expect(chip).toHaveClass('msg-attach-doc');
    expect(chip.getAttribute('href'))
      .toContain(`/api/sessions/${encodeURIComponent(ID)}/clip/clip-20260726-150342-e5f6-design-notes.md`);
    // The prose survives the lift, with the path's line closed up.
    expect(screen.getByText('read this')).toBeInTheDocument();
  });

  it('still draws an image clip as a thumbnail', () => {
    userWith(clip('clip-20260726-150340-a1b2-shot.png'));
    expect(screen.getByAltText('clip-20260726-150340-a1b2-shot.png')).toBeInTheDocument();
  });

  it('draws one of each when a message carries both', () => {
    const { container } = userWith(
      `${clip('clip-1-a1b2-shot.png')}\n${clip('clip-2-c3d4-notes.md')}\nboth`,
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelectorAll('.msg-attach-doc')).toHaveLength(1);
  });
});
