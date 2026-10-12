// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
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
import { remarkAlerts } from './remarkAlerts';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from './markdownLimits';
import '../session/chat.css';

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Absolute, scheme-qualified URL — a bare "example.com" would otherwise resolve
 *  same-origin and get swallowed by the PWA's navigation fallback. */
export function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][\w+.-]*:/i.test(href)) return href; // mailto:, tel:, …
  return `https://${href}`;
}

/** Open in a real new browser tab/instance. A plain target=_blank in a
 *  standalone PWA is unreliable (the app window itself can navigate, and the
 *  service worker's navigateFallback then serves index.html — the "back to the
 *  landing page" symptom), so force a fresh context via window.open. */
export function openExternal(e: React.MouseEvent, href: string | undefined): void {
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

export const LANG_LABEL: Readonly<Record<string, string>> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
export function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** Keystroke-shaped inline code → real <kbd> caps (`Cmd+K`, `Esc`). */
const NAMED_KEY =
  /^(?:Ctrl|Control|Cmd|Command|⌘|Alt|Option|⌥|Opt|Shift|⇧|Win|Super|Meta|Fn|Esc|Escape|Enter|Return|↵|⏎|Tab|⇥|Space|Spacebar|Backspace|⌫|Delete|Del|Insert|Ins|Home|End|PageUp|PgUp|PageDown|PgDn|Up|Down|Left|Right|↑|↓|←|→|F(?:[1-9]|1[0-2]))$/;
const SINGLE = /^[\p{L}\p{N}`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/u;
export function keystrokeParts(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*\+\s*/);
  const ok = (p: string): boolean => NAMED_KEY.test(p) || SINGLE.test(p);
  if (parts.length > 1) return parts.every(ok) ? parts : null;
  return NAMED_KEY.test(parts[0]!) ? parts : null; // bare single chars stay chips
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay.
 *  Highlighted only when the language is registered, `highlight` is not `false`, and the block is at most
 *  `MD_HIGHLIGHT_BLOCK_MAX_CHARS` characters (after the trailing-newline strip); a registered block over the cap
 *  renders as plain text and says so in its label, its size in whole KiB of characters, rounded up. */
export function CodeBlock({ children, highlight }: { children?: ReactNode; highlight?: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const wanted = highlight !== false && Boolean(lang && hljs.getLanguage(lang));
  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;
  const html = wanted && !overCap
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
        <span className="code-block-lang">
          {overCap ? `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)` : label}
        </span>
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
export function TableWrap({ children }: { children?: ReactNode }): ReactNode {
  return <div className="md-table-wrap"><table>{children}</table></div>;
}

/** The components chat and the Docs screen share: inline code (kbd chips), fenced code, tables. */
export const SHARED_COMPONENTS: Components = {
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

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images. */
export const CHAT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
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

/** One chat message body (an assistant turn, an opened compaction recap) as Markdown: GFM, then the alert
 *  callouts, through chat's components. The streaming caret is the caller's sibling after it. */
export function ChatMarkdown({ text }: { text: string }): ReactNode {
  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;
}
