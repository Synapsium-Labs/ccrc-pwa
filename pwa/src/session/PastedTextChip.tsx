// The chat's chip for a pasted text the session received as a file (desktop-polish wave 194), and the user bubble's
// body that places it. Ring L4: it renders what `pastedTurn.ts` (L1) composed and decides nothing.
//
// The chip is a link to the saved file, opened in a new tab as a document chip is (`openExternal`). Its URL is built
// from THIS session's id and the file's name alone (`clipUrl`, which encodes both), so even a pointer typed by hand can
// open nothing but this session's own clips through the clip route. Nothing is fetched until it is opened.
import { Fragment, type ReactNode } from 'react';
import { clipUrl } from '../lib/api';
import { openExternal } from '../lib/markdown';
import type { TurnPartView } from './pastedTurn';
import './chat.css';

export function PastedTextChip({ id, name, label, aria }: {
  id: string;
  name: string;
  label: string;
  aria: string;
}): ReactNode {
  const href = clipUrl(id, name);
  return (
    <a href={href} className="msg-paste" aria-label={aria} onClick={(e) => openExternal(e, href)}>
      <span className="msg-paste-glyph" aria-hidden="true">≡</span>
      {label}
    </a>
  );
}

/** A user bubble's content in order: each text part as `text` renders it, each pointer as its chip. */
export function TurnParts({ id, parts, text }: {
  id: string;
  parts: readonly TurnPartView[];
  text: (t: string) => ReactNode;
}): ReactNode {
  return parts.map((p, i) => (p.kind === 'text'
    ? <Fragment key={i}>{text(p.text)}</Fragment>
    : <PastedTextChip key={i} id={id} name={p.name} label={p.label} aria={p.aria} />));
}
