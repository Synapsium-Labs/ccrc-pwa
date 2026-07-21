import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/session/MessageBubble';

afterEach(cleanup);

const assistant = (text: string) =>
  render(<MessageBubble event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z', text }} />);

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
    render(<MessageBubble event={{ kind: 'user', uuid: 'u1', ts: '2026-07-21T20:00:00Z', text: 'check https://example.com/x' }} />);
    const a = screen.getByRole('link', { name: 'https://example.com/x' });
    expect(a).toHaveAttribute('target', '_blank');
  });
});
