// Message bubble — terminal semantics, modern clothes. User turns are input:
// right-aligned raised bubbles with a mono receipt. Assistant turns are
// output: full-width flush prose with rendered markdown (code blocks in dark
// wells that scroll inside the bubble). System events are centered dividers.
import { useState, type ReactNode } from 'react';
import { Prose } from '@ccrc/ui';
import type { ChatEvent } from '../../../shared/api';
import { isImageClip, splitClipPaths } from '../../../shared/api';
import { clipUrl } from '../lib/api';
import { resetClock } from '../lib/clock';
import { ChatMarkdown, openExternal } from '../lib/markdown';
import './chat.css';

export type MessageEvent = Extract<ChatEvent, { kind: 'user' | 'assistant' | 'system' }>;

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

/** Whether this row renders as a `FoldedCard` — one collapsed row, whatever its
 *  text — rather than as its text: a /compact recap (user- or assistant-kind),
 *  or a `system` row carrying a BODY (more than one line) rather than a label.
 *  The harness's own system rows (`origin`) are pills and never fold.
 *
 *  ONE DEFINITION for two readers: `MessageBubble` decides the fold by it, and
 *  the chat list prices the row by it (`ChatList.tsx`'s `shapeOf`) — a recap
 *  priced by its text was thousands of px for a 47px row. */
export function foldsAway(event: MessageEvent): boolean {
  if (event.kind === 'system') return event.origin === undefined && event.text.includes('\n');
  return COMPACTION_RE.test(event.text);
}

/** The fold, now used by TWO callers: the /compact recap above, and a `system`
 *  row that carries a BODY rather than a label (see the system branch below).
 *  Both are noise to a reader driving the session and neither may be thrown
 *  away, which is the same card rather than a second one.
 *
 *  EVERY DEFAULT IS THE COMPACTION CARD'S OWN, so that call site passes nothing
 *  and its DOM — classes, glyph, label, hint, and the class ORDER in
 *  `compaction compaction--open` — is what it was.
 *
 *  `raw` renders the body as text rather than Markdown. The parser hands a
 *  `system` row a `text: string` and declares no format for it, so reading it
 *  as Markdown is the delivery layer inventing one: a literal `*` becomes
 *  emphasis and disappears, a `|` row becomes a table, and the newlines this
 *  card exists to keep collapse under Markdown's own `white-space: normal`. */
function FoldedCard({
  text,
  label = 'Context compacted',
  glyph = '⤺',
  hint = 'show summary',
  variant = '',
  raw = false,
}: {
  text: string;
  label?: string;
  glyph?: string;
  hint?: string;
  /** Extra class on the card, for a rule one caller needs and the other must
   *  not get (`.compaction--sys` clamps a label that can be any length). */
  variant?: string;
  raw?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const cls = ['compaction', variant, open ? 'compaction--open' : ''].filter((c) => c !== '').join(' ');
  return (
    <div className={cls}>
      <button
        type="button"
        className="compaction-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="compaction-glyph" aria-hidden="true">{glyph}</span>
        <span className="compaction-label">{label}</span>
        <span className="compaction-hint">{open ? 'hide' : hint}</span>
      </button>
      {open && (raw
        ? <pre className="compaction-body compaction-raw">{text}</pre>
        : (
          <Prose className="compaction-body">
            <ChatMarkdown text={text} />
          </Prose>
        ))}
    </div>
  );
}

/** Sent attachments. A clip deleted off disk must degrade to its name, never
 *  to a broken-image box — and a DOCUMENT must never be asked to be an image in
 *  the first place. `<img src="…/clip-x.md">` reaches the same `msg-attach-gone`
 *  fallback, but only by failing to decode a file that is perfectly fine, so a
 *  clip present on disk would render as "deleted". The extension decides, before
 *  any request goes out. */
function ClipThumbs({ id, paths }: { id: string; paths: string[] }): ReactNode {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  return (
    <div className="msg-attach" data-count={Math.min(paths.length, 2)}>
      {paths.map((p) => {
        const name = p.slice(p.lastIndexOf('/') + 1);
        if (broken.has(p)) return <span key={p} className="msg-attach-gone">{name}</span>;
        const href = clipUrl(id, name);
        if (!isImageClip(name)) {
          return (
            <a
              key={p}
              href={href}
              className="msg-attach-doc"
              onClick={(e) => openExternal(e, href)}
            >
              {name}
            </a>
          );
        }
        return (
          <a key={p} href={href} className="msg-img-link" onClick={(e) => openExternal(e, href)}>
            <img
              src={href}
              alt={name}
              loading="lazy"
              className="msg-attach-img"
              onError={() => setBroken((s) => new Set(s).add(p))}
            />
          </a>
        );
      })}
    </div>
  );
}

export function MessageBubble({
  event,
  id,
  streaming = false,
}: {
  event: MessageEvent;
  /** Session id — clip thumbnails resolve against `clipUrl(id, name)`. */
  id: string;
  /** Last assistant turn while the session is busy — shows the block caret. */
  streaming?: boolean;
}): ReactNode {
  if (event.kind === 'system') {
    // D-2228: the harness's resume pair. The prompt line is neutral (whether it
    // was submitted is what the NEXT row says); the padding line IS the stall —
    // it exists only when Claude Code wrote the prompt and drove nothing.
    if (event.origin === 'resume-prompt') {
      return <p className="sys-divider sys-divider--restart">restart · resume prompt</p>;
    }
    if (event.origin === 'no-response') {
      return (
        <p className="sys-divider sys-divider--stalled">
          restart · interrupted turn not re-driven — send a message to resume
        </p>
      );
    }
    if (event.origin === 'limit') {
      // D-2366: the row Claude Code appends on a 429 is a harness event. The
      // viewer's clock, not the box's; Claude Code's own sentence ("… resets
      // Sep 15, 12am (UTC)") stays as the tooltip so nothing is lost.
      const when = event.resetsAt !== undefined ? resetClock(event.resetsAt) : null;
      return (
        <p className="sys-divider sys-divider--limit" title={event.text}>
          {when === null ? `usage limit · ${event.text}` : `usage limit · resets ${when}`}
        </p>
      );
    }
    // A system row whose text runs to more than ONE LINE cannot be told by the
    // pill below, and the pill does not fail loudly — it lies quietly.
    // `.sys-divider` declares no `white-space`, so every newline COLLAPSES into
    // one run; it is 11px mono at `--tracking-caps`, the tracking meant for
    // uppercase eyebrows; it is centred; and `--r-full` clamps to a ~175px lens
    // once the box is tall, whose curved corners cut inside the line boxes. The
    // harness injects skill bodies of tens of KB and hundreds of lines into the
    // user channel, so a multi-line system row is now the ordinary case.
    //
    // THE PREDICATE IS THE NEWLINE, not a size: it is derived from what the pill
    // can actually render — one line — rather than tuned to a corpus. Nothing is
    // dropped. The first line becomes the label, which is the only part a pill
    // could ever have carried honestly, and the whole text is one tap away
    // VERBATIM, as text rather than Markdown.
    if (foldsAway(event)) {
      const first = event.text.slice(0, event.text.indexOf('\n')).trim();
      return (
        <FoldedCard
          text={event.text}
          label={first === '' ? 'system message' : first}
          glyph="≡"
          hint="show"
          variant="compaction--sys"
          raw
        />
      );
    }
    return <p className="sys-divider">{event.text}</p>;
  }

  // Compaction recap (user- or assistant-kind): fold it away by default.
  if (foldsAway(event)) {
    return <FoldedCard text={event.text} />;
  }

  if (event.kind === 'user') {
    const { paths, rest } = splitClipPaths(event.text);
    const time = timeOf(event.ts);
    return (
      <>
        {paths.length > 0 && <ClipThumbs id={id} paths={paths} />}
        {rest !== '' && <div className="msg-user">{linkify(rest)}</div>}
        <p className="msg-receipt msg-receipt--ok">
          {time} <b aria-label="delivered">✓</b>
        </p>
      </>
    );
  }

  return (
    <Prose>
      <ChatMarkdown text={event.text} />
      {streaming && <span className="stream-caret" aria-hidden="true" />}
    </Prose>
  );
}
