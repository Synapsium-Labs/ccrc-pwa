// Message bubble — terminal semantics, modern clothes. User turns are input:
// right-aligned raised bubbles with a mono receipt. Assistant turns are
// output: full-width flush prose with rendered markdown (code blocks in dark
// wells that scroll inside the bubble). System events are centered dividers.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { type ReactNode } from 'react';
import type { ChatEvent } from '../../../shared/api';
import './chat.css';

export type MessageEvent = Extract<ChatEvent, { kind: 'user' | 'assistant' | 'system' }>;

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Absolute, scheme-qualified URL — a bare "example.com" would otherwise resolve
 *  same-origin and get swallowed by the PWA's navigation fallback. */
function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][\w+.-]*:/i.test(href)) return href; // mailto:, tel:, …
  return `https://${href}`;
}

/** Open in a real new browser tab/instance. A plain target=_blank in a
 *  standalone PWA is unreliable (the app window itself can navigate, and the
 *  service worker's navigateFallback then serves index.html — the "back to the
 *  landing page" symptom), so force a fresh context via window.open. */
function openExternal(e: React.MouseEvent, href: string | undefined): void {
  if (!href) return;
  e.preventDefault();
  window.open(absolute(href), '_blank', 'noopener,noreferrer');
}

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images. */
const mdComponents: Components = {
  a({ href, children }) {
    if (isImageUrl(href)) {
      const name = href.split('/').pop()?.split(/[?#]/)[0] || 'image';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
          <img src={href} alt={name} loading="lazy" className="msg-img" />
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
        <img src={src} alt={alt ?? ''} loading="lazy" className="msg-img" />
      </a>
    );
  },
};

const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

/** Make bare URLs in plain user text tappable (they open externally). */
export function linkify(text: string): ReactNode[] {
  return text.split(URL_SPLIT).map((part, i) =>
    isUrl(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, part)}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** 'HH:MM' from an ISO ts; '' when unparsable (receipts degrade quietly). */
export function timeOf(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function MessageBubble({
  event,
  streaming = false,
}: {
  event: MessageEvent;
  /** Last assistant turn while the session is busy — shows the block caret. */
  streaming?: boolean;
}): ReactNode {
  if (event.kind === 'system') {
    return <p className="sys-divider">{event.text}</p>;
  }

  if (event.kind === 'user') {
    const time = timeOf(event.ts);
    return (
      <>
        <div className="msg-user">{linkify(event.text)}</div>
        <p className="msg-receipt msg-receipt--ok">
          {time} <b aria-label="delivered">✓</b>
        </p>
      </>
    );
  }

  return (
    <div className="msg-assist">
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{event.text}</Markdown>
      {streaming && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
}
