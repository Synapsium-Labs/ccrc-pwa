// Every subagent the fleet is running, in one place — Orca's indented child
// rows, at fleet scale rather than one card at a time.
//
// WHY A STRIP AND NOT ROWS ON EVERY CARD. Orca puts child rows on the card;
// this tree has two design rulings protecting the uniform card shape, and on a
// ~20-session list a card that grows three rows breaks the scan the fleet
// screen exists for. The strip gives the same information with one collapsed
// line, and the per-card disclosure (`SessionLine`'s `⑂ N`) still answers
// "what is THIS session doing" for the card you are already looking at.
//
// HotFilesStrip's shape, deliberately: collapsed headline, expands to rows,
// and renders NOTHING when nothing is live — an idle fleet must not pay a row.
// Unlike that strip this one owns no poll: `FleetSession.subagents` already
// rides /ws/fleet, so the data is in the store the caller already has.
//
// WHAT IT DOES NOT SAY. There is no per-subagent state glyph, because there is
// no per-subagent state to source: the launch record carries no status and
// `SubagentStart` sends only `{agent_id, agent_type}`. And it never claims
// liveness — `hookUpdatedAt` is not a wire field, so the strip cannot know how
// old a roster is. Its note says what it actually knows: what the hooks last
// reported.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { StatusDot } from '../components/StatusDot';
import { accountLabel } from '../lib/accounts';
import { useNow } from '../lib/useNow';
import { NEST_BRACKET } from './ProjectCard';
import { sessionLabel } from './sessionLabel';
import './fleet.css';

/** '<1m' | '5m' | '3h' — SessionLine's own vocabulary for the same fact. */
function elapsed(startedAt: number, nowMs: number): string {
  const m = Math.floor(Math.max(0, nowMs - startedAt) / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export interface SubagentsStripProps {
  sessions: readonly FleetSession[];
  roster: Parameters<typeof accountLabel>[0];
  onOpen: (id: string) => void;
}

export function SubagentsStrip({ sessions, roster, onOpen }: SubagentsStripProps): ReactNode {
  const [open, setOpen] = useState(false);

  // `null` (no hook data) and `[]` (a measurement of zero) are DIFFERENT facts
  // and neither is hoisted into a boolean — SessionLine's stated rule, and a
  // second consumer of this field has to repeat it or the discipline is
  // pointless. A DEAD session is excluded even though the wire still carries
  // its pre-exit roster: subagents of a session with no pane are not running.
  const groups = sessions.filter(
    (s) => s.bucket !== 'dead' && s.subagents !== null && s.subagents.length > 0,
  );

  // The clock ticks only while there is something to time — `active` exists on
  // this hook precisely so an idle fleet runs no timer.
  const nowMs = useNow(30_000, groups.length > 0);

  if (groups.length === 0) return null;

  const total = groups.reduce((n, s) => n + (s.subagents?.length ?? 0), 0);

  return (
    <section className="subagents-strip" aria-label="Subagents">
      <button
        type="button"
        className="subagents-strip-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="subagents-strip-mark" aria-hidden="true">⑂</span>
        <span className="subagents-strip-headline">
          {total} subagent{total === 1 ? '' : 's'} · {groups.length} session{groups.length === 1 ? '' : 's'}
        </span>
        <span className="subagents-strip-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      {open && (
        <div className="subagents-strip-body">
          <ol className="subagents-strip-groups">
            {groups.map((s) => (
              <li key={s.id} className="subagents-strip-group">
                <button
                  type="button"
                  className="subagents-strip-parent"
                  onClick={() => onOpen(s.id)}
                >
                  {/* The SESSION's state, labelled as the session's — there is
                      no subagent-level counterpart and this dot must not be
                      read as one. */}
                  <StatusDot status={s.bucket} />
                  <span className="subagents-strip-label">{sessionLabel(s)}</span>
                  <span className="subagents-strip-acct">{accountLabel(roster, s.wrapper)}</span>
                  <span className="subagents-strip-count">⑂ {s.subagents?.length ?? 0}</span>
                </button>
                <ul className="subagents-strip-rows">
                  {(s.subagents ?? []).map((sa) => (
                    <li key={`${sa.name}-${sa.startedAt}`} className="subagents-strip-row">
                      <span className="subagents-strip-bracket" aria-hidden="true">{NEST_BRACKET}</span>
                      {/* Description first, type as the fallback — the same
                          ladder SessionLine's disclosure uses, for the same
                          reason: `name` is always the agent type. */}
                      <span
                        className="subagents-strip-name"
                        title={sa.description === null ? sa.name : `${sa.name} — ${sa.description}`}
                      >
                        {sa.description ?? sa.name}
                      </span>
                      <span className="subagents-strip-elapsed">{elapsed(sa.startedAt, nowMs)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {/* Not "running now". The roster is what the hooks last wrote, and a
              missed SubagentStop lingers until the hookstate ages out — the
              strip cannot detect that, so it must not claim otherwise. */}
          <p className="subagents-strip-note">What each session&rsquo;s hooks last reported.</p>
        </div>
      )}
    </section>
  );
}
