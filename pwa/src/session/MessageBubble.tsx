// Message bubble — terminal semantics, modern clothes. User turns are input:
// right-aligned raised bubbles with a mono receipt. Assistant turns are
// output: full-width flush prose with rendered markdown (code blocks in dark
// wells that scroll inside the bubble). System events are centered dividers.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { useCallback, useState, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // html / svg
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
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

for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml,
  yaml, markdown, diff, sql, dockerfile, rust, go,
})) hljs.registerLanguage(name, def);
hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });

const LANG_LABEL: Record<string, string> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkAlerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = (node: any): void => {
    const p = node.children?.[0];
    if (!p || p.type !== 'paragraph') return;
    const lead = p.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = ALERT_RE.exec(lead.value);
    if (!m) return;
    lead.value = lead.value.slice(m[0].length).replace(/^[^\S\n]*\n?/, '');
    if (lead.value === '') {
      p.children.shift();
      if (p.children.length === 0) node.children.shift();
    }
    node.data = { hName: 'div', hProperties: { className: ['callout'], 'data-callout': m[1]!.toLowerCase() } };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): void => {
    if (node.type === 'blockquote') tag(node);
    if (node.children) for (const c of node.children) walk(c);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => walk(tree);
}

/** Keystroke-shaped inline code → real <kbd> caps (`Cmd+K`, `Esc`). */
const NAMED_KEY =
  /^(?:Ctrl|Control|Cmd|Command|⌘|Alt|Option|⌥|Opt|Shift|⇧|Win|Super|Meta|Fn|Esc|Escape|Enter|Return|↵|⏎|Tab|⇥|Space|Spacebar|Backspace|⌫|Delete|Del|Insert|Ins|Home|End|PageUp|PgUp|PageDown|PgDn|Up|Down|Left|Right|↑|↓|←|→|F(?:[1-9]|1[0-2]))$/;
const SINGLE = /^[\p{L}\p{N}`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/u;
function keystrokeParts(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*\+\s*/);
  const ok = (p: string): boolean => NAMED_KEY.test(p) || SINGLE.test(p);
  if (parts.length > 1) return parts.every(ok) ? parts : null;
  return NAMED_KEY.test(parts[0]!) ? parts : null; // bare single chars stay chips
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay. */
function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const html = lang && hljs.getLanguage(lang)
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [raw]);
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{label}</span>
        <button type="button" className="code-block-copy" onClick={onCopy}
                aria-label="Copy code" data-copied={copied || undefined}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        {html != null
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code className="hljs">{raw}</code>}
      </pre>
    </div>
  );
}

/** Wrap tables so the scroller is a div (enables the edge-fade affordance). */
function TableWrap({ children }: { children?: ReactNode }): ReactNode {
  return <div className="md-table-wrap"><table>{children}</table></div>;
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
  code({ className, children }) {
    const text = String(children ?? '');
    if (/language-/.test(className ?? '') || text.includes('\n')) {
      return <code className={className}>{children}</code>; // block code → left to CodeBlock
    }
    const keys = keystrokeParts(text);
    if (keys) {
      return (
        <span className="kbd-combo">
          {keys.map((k, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="kbd-plus">+</span>}
              <kbd>{k}</kbd>
            </React.Fragment>
          ))}
        </span>
      );
    }
    return <code className="md-code">{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <TableWrap>{children}</TableWrap>,
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

// A /compact turn injects a long "This session is being continued …/Summary:"
// block that's noise to a reader driving the session. Collapse it to a quiet
// card (like a tool call) — expandable when you actually want the recap.
const COMPACTION_RE = /^\s*(?:\[[^\]]*]\s*)?This session is being continued from a previous conversation/;

function CompactionCard({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'compaction compaction--open' : 'compaction'}>
      <button
        type="button"
        className="compaction-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="compaction-glyph" aria-hidden="true">⤺</span>
        <span className="compaction-label">Context compacted</span>
        <span className="compaction-hint">{open ? 'hide' : 'show summary'}</span>
      </button>
      {open && (
        <div className="compaction-body msg-assist">
          <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{text}</Markdown>
        </div>
      )}
    </div>
  );
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

  // Compaction recap (user- or assistant-kind): fold it away by default.
  if (COMPACTION_RE.test(event.text)) {
    return <CompactionCard text={event.text} />;
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
      <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{event.text}</Markdown>
      {streaming && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
}
