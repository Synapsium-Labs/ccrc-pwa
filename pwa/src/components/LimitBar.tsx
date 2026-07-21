// Limits bar — two thin rows (5h / 7d), mono tabular readouts, fills banded
// to the operator's routing-policy thresholds (DIRECTION.md): ok < 50,
// warn 50–75 ("prefer handoff"), critical > 75 ("hand off everything
// spec-able"). Width changes glide over --dur-bar via the CSS transition.
import type { ReactNode } from 'react';
import './primitives.css';

export type LimitBand = 'ok' | 'warn' | 'crit';

/** Band for a usage percentage, per the routing policy in DIRECTION.md. */
export function limitBand(pct: number): LimitBand {
  if (pct > 75) return 'crit';
  if (pct >= 50) return 'warn';
  return 'ok';
}

function Row({ label, value }: { label: string; value: number | null }): ReactNode {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <div className="limit-row">
      <span>{label}</span>
      <span className="limit-track">
        {pct !== null && (
          <span
            className={`limit-fill limit-fill--${limitBand(pct)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="limit-pct">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  );
}

export function LimitBar({ five, seven }: { five: number | null; seven: number | null }): ReactNode {
  return (
    <div className="limits">
      <Row label="5h" value={five} />
      <Row label="7d" value={seven} />
    </div>
  );
}
