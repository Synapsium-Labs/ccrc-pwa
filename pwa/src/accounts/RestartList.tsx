// THE LANE'S SESSIONS, EACH WITH ONE-TAP RESTART (spec §9; accounts plan Tasks A19 and A23, D-7742, D-7871 (4)): after
// a credential changed under a lane, a running session keeps the one it started with, so the sheet lists the sessions
// that were live when it changed, each with Restart (the existing stop, then ensure). The replace sheet (A19) and the
// method switch sheet (A23) list them the same way, so the list and its restarts live here once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, RESET_LIST } from '@ccrc/ui';
import { isArchivedRow, type FleetSession, type StopBody } from '../../../shared/api';
import { RESTART, RESTARTED, RESTART_FAILED } from '../fleet/accountWords';
import { presenceOf } from '../fleet/presence';
import { sessionLabel } from '../fleet/sessionLabel';

export type RestartState = 'busy' | 'done' | 'failed';

/** The sessions to list: those the server reads alive on lane `id` (`presenceOf`, D-7181), not archived. A sleeper holds
 *  no credential in a running process, and wakes onto the new one. */
export function restartableOn(sessions: readonly FleetSession[], id: string): string[] {
  return sessions.filter((s) => s.wrapper === id && !isArchivedRow(s) && presenceOf(s) === 'alive').map((s) => s.id);
}

/** Each listed session's restart, and the act: stop, then ensure; a second tap while one runs, or after it is done,
 *  sends nothing. */
export function useRestarts(stop: (sid: string, body?: StopBody) => Promise<unknown>, ensure: (sid: string) => Promise<void>, blocked: boolean): {
  readonly restarts: Readonly<Record<string, RestartState>>;
  readonly restart: (sid: string) => Promise<void>;
} {
  const [restarts, setRestarts] = useState<Readonly<Record<string, RestartState>>>({});
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const restart = async (sid: string): Promise<void> => {
    if (blocked || restarts[sid] === 'busy' || restarts[sid] === 'done') return;
    setRestarts((r) => ({ ...r, [sid]: 'busy' }));
    try {
      // D-8199: the stop half of a restart keeps the session id, so it says so and its claimed runs stay where they are.
      await stop(sid, { restart: true });
      await ensure(sid);
      if (live.current) setRestarts((r) => ({ ...r, [sid]: 'done' }));
    } catch {
      if (live.current) setRestarts((r) => ({ ...r, [sid]: 'failed' }));
    }
  };
  return { restarts, restart };
}

/** The list: `lead` says what the sessions still hold; each row its name and Restart, or the word its restart left. */
export function RestartList({ ids, lead, sessions, restarts, blocked, onRestart }: {
  ids: readonly string[];
  lead: string;
  sessions: readonly FleetSession[];
  restarts: Readonly<Record<string, RestartState>>;
  blocked: boolean;
  onRestart: (sid: string) => void;
}): ReactNode {
  if (ids.length === 0) return null;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return (
    <section className="acct-remove-block" aria-label={lead}>
      <p className="acct-field-note">{lead}</p>
      <ul className={RESET_LIST}>
        {ids.map((sid) => {
          const s = byId.get(sid);
          const r = restarts[sid];
          return (
            <li key={sid} className="acct-remove-session" data-restart={r}>
              <span className="acct-remove-name">{s === undefined ? sid : sessionLabel(s)}</span>
              {r === 'done' ? <span className="acct-session-word">{RESTARTED}</span> : (
                <>
                  {r === 'failed' && <span className="acct-session-word">{RESTART_FAILED}</span>}
                  <Button
                    variant="ghost" size="fit" disabled={blocked || r === 'busy'} aria-busy={r === 'busy' || undefined}
                    onClick={() => onRestart(sid)}
                  >
                    {RESTART}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
