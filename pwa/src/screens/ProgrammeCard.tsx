// A programme card (the runs rebuild, Task 18, D-8075; spec 2026-11-04 §8.2.2): a glance, never a second programme page (A1).
// Lamp and word, the name (a door to the programme), the one marker, one context line. The word keeps the motion and the
// marker says "needs you", so a card gives two facts, not one fact twice. No run number, no coordinator, no spend: those are
// the header's (card = glance, header = superset, D-5545). Pure over its props: the board hands it the page clock.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ProgrammeRow } from '../../../shared/api';
import { motionState, movedWords } from '../fleet/programmeBoxes';
import { cardWord, programmeStuckLine } from '../fleet/stuckWords';
import { inAppClick } from '../fleet/settingsText';
import { programmeIsOpenable, programmePath, runsAdvancedPath, waitingPath } from '../lib/routes';
import { endingWords, type CardProgramme } from './usePrograms';
import './programme-card.css';

const GLYPH = { moving: '●', stalled: '○', stuck: '✕', paused: '‖' } as const;

/** Whether every open run is stuck or waits behind a stuck run (o5), so the card reads stuck. */
export const everyOpenRunStuck = (open: CardProgramme['open']): boolean =>
  open.length > 0 && open.every((r) => r.stuck != null || r.blockedBy != null);

/** The context line (§8.2.2): the stuck runs' count and what happens next, else the wave counts and the last move. */
export function cardLine(card: CardProgramme, nowMs: number): string {
  const stuck = card.open.flatMap((r) => (r.stuck == null ? [] : [r.stuck]));
  if (stuck.length > 0) return programmeStuckLine(stuck, nowMs);
  const { waves, lastMoveAt } = card.row;
  const parts: string[] = [];
  if (waves.working > 0) parts.push(`${waves.working} working`);
  if (waves.waiting > 0) parts.push(`${waves.waiting} waiting`);
  if (waves.queued > 0) parts.push(`${waves.queued} queued`);
  if (waves.done > 0) parts.push(`${waves.done} done`);
  if (lastMoveAt !== null) parts.push(movedWords(lastMoveAt, nowMs));
  return parts.join(' · ');
}

/** A programme's name, a door to its page when the route takes the slug; written once for the card and the Finished row. */
function ProgrammeName({ slug, title }: { slug: string; title: string }): ReactNode {
  if (!programmeIsOpenable(slug)) return <span className="programme-card-name">{title}</span>;
  const href = programmePath(slug);
  return <a className="programme-card-name" href={href} onClick={inAppClick(href)}>{title}</a>;
}

export function ProgrammeCard({ card, nowMs, quietMs, paused, needs }: {
  card: CardProgramme;
  nowMs: number;
  /** The stall watch's quiet time, or null on a server that sends none (no card stalls). */
  quietMs: number | null;
  paused: boolean;
  /** The one needs-you source's count for this programme (`needsYouCount`), 0 for none. */
  needs: number;
}): ReactNode {
  const { row, title } = card;
  const word = cardWord(motionState(row.lastMoveAt, nowMs, quietMs, paused), everyOpenRunStuck(card.open));
  const marker = waitingPath(row.slug);
  const line = cardLine(card, nowMs);
  return (
    <li className="programme-card" data-testid="programme-card" data-programme={row.slug} data-word={word}>
      <p className="programme-card-top">
        <span className="programme-card-lamp"><span aria-hidden="true">{GLYPH[word]}</span> <span className={word === 'stuck' ? 'programme-card-word programme-card-word-stuck' : 'programme-card-word'}>{word}</span></span>
        {needs > 0 && (
          <a className="programme-card-marker" href={marker} onClick={inAppClick(marker)}>needs you · {needs}</a>
        )}
      </p>
      <ProgrammeName slug={row.slug} title={title} />
      {line !== '' && <p className="programme-card-line">{line}</p>}
    </li>
  );
}

/** A fold on the board (§8.2 items 8 and 9): folded by default at every width, one toggle at the tap floor. */
function Fold({ name, count, id, children }: { name: string; count: number; id: string; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="programme-fold" data-fold={id}>
      <button type="button" className="programme-fold-toggle" aria-expanded={open} aria-controls={`programme-fold-${id}`}
        onClick={() => setOpen(!open)}>
        <span className="programme-fold-name">{name}</span>
        <span className="programme-fold-count">· {count}</span>
      </button>
      {open && <div id={`programme-fold-${id}`} className="programme-fold-body">{children}</div>}
    </div>
  );
}

/** Quiet programmes (§8.2 item 8): no run opened or closed in 7 days, the same cards under a fold. */
export function QuietFold({ cards, nowMs, quietMs, paused }: {
  cards: readonly CardProgramme[]; nowMs: number; quietMs: number | null; paused: boolean;
}): ReactNode {
  if (cards.length === 0) return null;
  return (
    <Fold name="Quiet programmes" count={cards.length} id="quiet">
      <ul className="programme-cards">
        {cards.map((c) => <ProgrammeCard key={c.row.slug} card={c} nowMs={nowMs} quietMs={quietMs} paused={paused} needs={0} />)}
      </ul>
    </Fold>
  );
}

/** Finished (§8.2.3): a programme with no open run, for 7 days after its last close, its ending in words. The fold ends with
 *  "All runs, newest close first", which opens the list on Advanced. */
export function FinishedFold({ rows }: { rows: readonly ProgrammeRow[] }): ReactNode {
  return (
    <Fold name="Finished" count={rows.length} id="finished">
      <ul className="programme-finished">
        {rows.map((r) => {
          const name = r.title.trim() === '' ? r.slug : r.title;
          return (
            <li key={r.slug} className="programme-finished-row" data-programme={r.slug}>
              <ProgrammeName slug={r.slug} title={name} />
              {r.ending !== null && <span className="programme-finished-ending">{endingWords(r.ending)}</span>}
            </li>
          );
        })}
      </ul>
      <a className="programme-finished-all" href={runsAdvancedPath()} onClick={inAppClick(runsAdvancedPath())}>All runs, newest close first</a>
    </Fold>
  );
}
