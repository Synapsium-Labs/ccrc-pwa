// The body both the epic page and the Upkeep page draw (Linear hierarchy design §11.2 and §7.6, D-8184): the epic's head, its
// checkpoints (the epic page only) and its tickets. Ring L4: it decides nothing. Every sentence is `epicWords.ts`'s; the
// addresses are the one owners': `pullUrl` (a pull request), `itemPath` (an item), `docHref` (a repository path in the Docs
// reader) and `runPath` (a run). A title, a summary and an identifier are a reporter's or a coordinator's text, drawn as plain
// text nodes (never Markdown or HTML) and wrapped, never clipped.
import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { TextLink } from '@ccrc/ui';
import type { CheckpointView, EpicView, TicketView } from '../../../shared/plan';
import { pullUrl } from '../../../shared/release-notes';
import { docHref } from '../docs/docsLinks';
import { loadProjects } from '../fleet/useProjectRows';
import { inAppClick } from '../fleet/settingsText';
import { openExternal } from '../lib/markdown';
import { runPath } from '../lib/routes';
import { runStateWord } from '../fleet/runWords';
import { useFleetStore } from '../stores/fleet';
import {
  EPIC_TEXT, checkpointStateWords, epicStateWords, evidenceWords, linearHref, metWords, runWords, ticketKindWords, ticketStateWords,
} from './epicWords';
import { itemPath } from './ledgerWords';
import './ledgers.css';

/** `owner/repo` of the project's repository, from the project list's measured linking cell; null when none is known (the list
 *  unread, the project unknown, or its repository unmeasured). Read once per project. */
export function useRepoSlug(project: string | null): string | null {
  const [read, setRead] = useState<{ project: string; slug: string | null } | null>(null);
  useEffect(() => {
    if (project === null) return undefined;
    let live = true;
    loadProjects().then(
      (answer) => {
        if (!live) return;
        const row = answer.projects.find((p) => p.name === project && p.linking?.measured.state === 'measured');
        const m = row?.linking?.measured;
        setRead({ project, slug: m !== undefined && m.state === 'measured' ? m.slug : null });
      },
      () => { if (live) setRead({ project, slug: null }); },
    );
    return () => { live = false; };
  }, [project]);
  return read !== null && read.project === project ? read.slug : null;
}

function External({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return <TextLink href={href} onClick={(e: MouseEvent<HTMLAnchorElement>) => openExternal(e, href)}>{children}</TextLink>;
}
function Internal({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return <TextLink href={href} onClick={inAppClick(href)}>{children}</TextLink>;
}

/** The checkpoint's evidence: a link where the address is known, its words as plain text where it is not. */
function Evidence({ checkpoint, repo, home }: { checkpoint: CheckpointView; repo: string | null; home: string }): ReactNode {
  const e = checkpoint.evidence;
  if (e === null) return null;
  const words = evidenceWords(e);
  let href: string | null = null;
  let external = false;
  if ('pr' in e) {
    const at = repo === null ? -1 : repo.indexOf('/');
    href = at < 0 ? null : pullUrl({ owner: repo!.slice(0, at), repo: repo!.slice(at + 1) }, e.pr);
    external = true;
  } else if ('itemId' in e) href = itemPath(e.itemId);
  else href = docHref(e.path, home);
  if (href === null) return <span className="ep-evidence">{words}</span>;
  return <span className="ep-evidence">{external ? <External href={href}>{words}</External> : <Internal href={href}>{words}</Internal>}</span>;
}

function CheckpointRow({ checkpoint, repo, home }: { checkpoint: CheckpointView; repo: string | null; home: string }): ReactNode {
  const met = metWords(checkpoint.state, checkpoint.metAt);
  return (
    <li className="ep-row ep-cp" data-checkpoint={checkpoint.key} data-state={checkpoint.state}>
      <span className="ep-title">{checkpoint.title}</span>
      <span className="ep-meta">
        <span className="ep-state" data-state={checkpoint.state}>{checkpointStateWords(checkpoint.state)}</span>
        {met !== null && <span>{met}</span>}
        <Evidence checkpoint={checkpoint} repo={repo} home={home} />
      </span>
    </li>
  );
}

function TicketRow({ ticket }: { ticket: TicketView }): ReactNode {
  const url = linearHref(ticket.url);
  // Spec §11.4: from 1920 up, the ticket's run state is inline. It is the fleet store's live run, worded by the console's one
  // `runStateWord`; a run not in the live list (closed, or not heard yet) draws none: the wire carries no run state to fall back on.
  // The store is read as the WORD (a string, or null), never the run object: a runs frame that changes nothing this row shows
  // does not re-render it.
  const runWord = useFleetStore((s) => {
    const run = ticket.runId === null ? undefined : s.runs.find((r) => r.id === ticket.runId);
    return run === undefined ? null : runStateWord(run);
  });
  return (
    <li className="ep-row ep-tk" data-ticket={ticket.key} data-state={ticket.state}>
      <span className="ep-title">{ticket.title}</span>
      <span className="ep-meta">
        <span className="ep-state" data-state={ticket.state}>{ticketStateWords(ticket.state)}</span>
        <span>{ticketKindWords(ticket.kind)}</span>
        {ticket.identifier !== null && <span className="ep-ident">{ticket.identifier}</span>}
        {ticket.runId !== null && <Internal href={runPath(ticket.runId)}>{runWords(ticket.runId)}</Internal>}
        {runWord !== null && <span className="ep-state ep-run-state" data-ticket-run-state>{runWord}</span>}
        {url !== null && <External href={url}>{EPIC_TEXT.openInLinear}</External>}
      </span>
    </li>
  );
}

/** The root of both pages and of their one-line states: `epic` is set when an epic is drawn. */
export function EpicFrame({ epic, children }: { epic?: EpicView; children: ReactNode }): ReactNode {
  return <div className="wl ep" {...(epic === undefined ? {} : { 'data-epic': epic.key })}>{children}</div>;
}

/** A page's header with only a kicker and a way back, and one line under it: what the page says when it has no epic to draw. */
export function EpicLine({ head, line, role }: { head: ReactNode; line: string; role: 'status' | 'alert' }): ReactNode {
  return <EpicFrame>{head}<p className="wl-note" role={role}>{line}</p></EpicFrame>;
}

/** The epic's checkpoints (when `showCheckpoints`) and tickets, side by side from 1280. `head` is the page's own header. */
export function EpicBody({ epic, showCheckpoints, head, after }: {
  epic: EpicView; showCheckpoints: boolean; head: ReactNode; after?: ReactNode;
}): ReactNode {
  // Only a checkpoint's pull request evidence can need the repository, so the Upkeep page (no checkpoints) reads no project list.
  const repo = useRepoSlug(showCheckpoints ? epic.project : null);
  return (
    <EpicFrame epic={epic}>
      {head}
      <div className="ep-cols" data-cols={showCheckpoints ? 'two' : 'one'}>
        {showCheckpoints && (
          <section className="ep-col" aria-label={EPIC_TEXT.checkpoints}>
            <h2 className="ep-h">{EPIC_TEXT.checkpoints}</h2>
            {epic.checkpoints.length === 0
              ? <p className="wl-note">{EPIC_TEXT.noCheckpoints}</p>
              : <ul className="ep-list">{epic.checkpoints.map((c) => <CheckpointRow key={c.key} checkpoint={c} repo={repo} home={epic.project} />)}</ul>}
          </section>
        )}
        <section className="ep-col" aria-label={EPIC_TEXT.tickets}>
          <h2 className="ep-h">{EPIC_TEXT.tickets}</h2>
          {epic.tickets.length === 0
            ? <p className="wl-note">{EPIC_TEXT.noTickets}</p>
            : <ul className="ep-list">{epic.tickets.map((t) => <TicketRow key={t.key} ticket={t} />)}</ul>}
        </section>
      </div>
      {after}
    </EpicFrame>
  );
}

/** The epic page's header: the way back, the epic's title and state, its summary and its Linear link when it has one. */
export function EpicHead({ epic, back }: { epic: EpicView; back: ReactNode }): ReactNode {
  const url = linearHref(epic.url);
  return (
    <header className="ep-head">
      {back}
      <span className="ep-kicker">{EPIC_TEXT.kicker}</span>
      <h1 className="ep-name">{epic.title}</h1>
      <span className="ep-state" data-state={epic.state}>{epicStateWords(epic.state)}</span>
      {epic.summary !== '' && <p className="ep-summary">{epic.summary}</p>}
      {url !== null && <span className="ep-link"><External href={url}>{EPIC_TEXT.openInLinear}</External></span>}
    </header>
  );
}
