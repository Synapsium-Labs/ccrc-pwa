// Move-to-another-account sheet — plus the shared account-picker row that
// NewSessionSheet reuses. Target rows exclude the session's current account;
// each carries the account chip and its live limit gauges from the fleet
// store (or honestly says "limits unknown"), and the least-loaded target
// wears a mono "suggested" tag. Tapping a target opens a QuickConfirm whose
// consequence sentence does the explaining; confirming posts api.swap — the
// restart itself then plays out over the fleet stream.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { QuickConfirm } from '../components/QuickConfirm';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { accountColorVar, accountLabel, KNOWN_WRAPPERS } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useDisabledWrappers } from './useProjectedHome';
import './fleet.css';

export type AccountLimits = { five: number | null; seven: number | null } | null;

/** The accounts a session may be moved to. `disabled` names lanes ccd's
 *  kill-switch has switched off — they are excluded, because offering a swap
 *  target that cannot take work is worse than offering none. */
export function pickableWrappers(sessions: FleetSession[], disabled: readonly string[] = []): string[] {
  const all = [...KNOWN_WRAPPERS];
  for (const s of sessions) {
    if (!all.includes(s.wrapper)) all.push(s.wrapper);
  }
  return all.filter((w) => !disabled.includes(w));
}

/** An account's live limits, read off any fleet session on that wrapper —
 *  limits are per-account, so the first session that knows them speaks for
 *  all. Null when no live session carries them. */
export function limitsFor(sessions: FleetSession[], wrapper: string): AccountLimits {
  for (const s of sessions) {
    if (s.wrapper === wrapper && s.limits !== null) return s.limits;
  }
  return null;
}

/** Load score for "suggested" ranking — the tighter of the two windows, or
 *  null when there is no such thing.
 *
 *  Fix round 3, verifier P7 (eleventh measurement forgery, adjudicated REAL).
 *  This was `Math.max(l.five ?? 0, l.seven ?? 0)`, and `five`/`seven` are
 *  `number | null` where null means THE WINDOW WAS NOT READ
 *  (shared/api.ts). Both nulls is a producible state, not a hypothetical:
 *  `readLimits` writes `{five: null, seven: null, …}` for any account whose
 *  limits file is missing or unparseable (server/src/limits.ts), and
 *  `server/src/fleet.ts` hands that straight to the session as a non-null
 *  `limits` object. The row therefore rendered "5h — · 7d —" and wore the
 *  "suggested" tag at the same time, beating a genuinely-measured account at
 *  5%: an account nobody could read was recommended precisely BECAUSE nobody
 *  could read it.
 *
 *  One known window is not enough either. The score is a MAXIMUM, so with the
 *  other window unread the true score is only bounded below — `{five: 3,
 *  seven: null}` scored 3 and won the ranking while its 7-day window could
 *  have been at 99. A recommendation built on that is a guess about the number
 *  that would have decided it.
 *
 *  Not scoring is not a refusal to help: an account with no score is simply
 *  not ranked, its gauges still say `—`, and it remains tappable. What is gone
 *  is ccrc telling the reader it is the emptiest pool. */
const load = (l: AccountLimits): number | null =>
  l === null || l.five === null || l.seven === null ? null : Math.max(l.five, l.seven);

/** The least-loaded wrapper among those whose BOTH limit windows were actually
 *  read; null if none was. */
export function leastLoaded(sessions: FleetSession[], wrappers: string[]): string | null {
  let best: string | null = null;
  let bestLoad = Infinity;
  for (const w of wrappers) {
    const score = load(limitsFor(sessions, w));
    if (score !== null && score < bestLoad) {
      bestLoad = score;
      best = w;
    }
  }
  return best;
}

/** One thin gauge row — mono label · track · tabular percentage. Spans only,
 *  so the row stays valid inside the AccountRow button. */
function Gauge({ label, value }: { label: string; value: number | null }): ReactNode {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <span className="acct-gauge">
      <span>{label}</span>
      <span className="limit-track">
        {pct !== null && (
          <span
            className={`limit-fill limit-fill--${limitBand(pct)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="acct-gauge-pct">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </span>
  );
}

/** A tappable account row: chip (label + hue), live limit gauges, chevron.
 *  Shared by SwapSheet (targets) and NewSessionSheet (step 1). */
export function AccountRow({
  wrapper,
  limits,
  suggested = false,
  onPick,
}: {
  wrapper: string;
  limits: AccountLimits;
  suggested?: boolean;
  onPick: (wrapper: string) => void;
}): ReactNode {
  const colorVar = accountColorVar(wrapper);
  const chipStyle: CSSProperties = {
    color: `var(${colorVar})`,
    background: colorVar.startsWith('--acct-') ? `var(${colorVar}-tint)` : 'var(--bg-raised)',
  };
  return (
    <button type="button" className="acct-row" onClick={() => onPick(wrapper)}>
      <span className="chip" style={chipStyle}>
        <i aria-hidden="true" />
        {accountLabel(wrapper)}
      </span>
      {suggested && <span className="acct-suggested">suggested</span>}
      <span className="acct-gauges">
        {limits === null ? (
          <span className="acct-unknown">limits unknown</span>
        ) : (
          <>
            <Gauge label="5h" value={limits.five} />
            <Gauge label="7d" value={limits.seven} />
          </>
        )}
      </span>
      <span className="acct-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export interface SwapSheetProps {
  session: Pick<FleetSession, 'id' | 'wrapper' | 'project'>;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

export function SwapSheet({
  session,
  open,
  onClose,
  fleet = useFleetStore,
}: SwapSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  // The target awaiting its consequence confirm (null = still browsing).
  const [target, setTarget] = useState<string | null>(null);

  const disabledWrappers = useDisabledWrappers(open);
  const wrappers = pickableWrappers(sessions, disabledWrappers).filter((w) => w !== session.wrapper);
  const suggested = leastLoaded(sessions, wrappers);

  const move = (wrapper: string): void => {
    void (async () => {
      try {
        await api.swap(session.id, wrapper);
        toast(`Moving ${session.project} to ${accountLabel(wrapper)}…`);
      } catch (err) {
        toast(`Couldn't move — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };

  const targetLabel = target === null ? '' : accountLabel(target);

  return (
    <>
      <Sheet open={open} onClose={onClose} eyebrow="move session" title="Move to another account">
        <p className="sheet-copy">
          {session.project} runs on {accountLabel(session.wrapper)} now. Pick where it should
          live.
        </p>
        <div className="acct-list">
          {wrappers.map((w) => (
            <AccountRow
              key={w}
              wrapper={w}
              limits={limitsFor(sessions, w)}
              suggested={w === suggested}
              onPick={setTarget}
            />
          ))}
        </div>
      </Sheet>
      <QuickConfirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`Move to ${targetLabel}?`}
        consequence={`The session restarts under ${targetLabel}. Anyone attached is briefly disconnected.`}
        confirmLabel="Move"
        onConfirm={() => {
          if (target !== null) move(target);
        }}
      />
    </>
  );
}
