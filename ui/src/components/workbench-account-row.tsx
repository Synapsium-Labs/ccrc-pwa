// WorkbenchAccountRow — the desk sidebar's foot: both usage windows of every
// account, always in view (design system card "WorkbenchAccountRow").
//
// An "Accounts" eyebrow head that folds the list, the `5h`/`7d` column heads,
// and one dense row per account. Each row is ONE button (it opens the Accounts
// screen) laid out on one grid, so a hot account is found by scanning a column.
//
// PLAIN DATA IN. The app maps its accounts store onto `WorkbenchAccountItem`:
// the display name, the hue its own `accountHue(...)` chose (stamped here as
// `data-acct`, which tokens.css rebinds `--acct-active` from — no hue list
// here), each window's percentage and its reset text from `formatReset`. The
// swap ceiling lives in `shared/` and reaches this row only as a `note`, in the
// app's words. The fold is the only state kept here.
//
// THREE READINGS, NEVER COLLAPSED. `—` is a window never measured (no fill),
// `0%` a measured zero (a zero-width fill), `reset` a window that ended with
// nothing measuring the new one (no fill). An account that cannot take work
// keeps its last numbers: `Meter off` greys the fills while the track keeps its
// band, the hue dot becomes a hollow ring, and the note says why in words.
//
// THE METER CARRIES THE BAND, THE NUMBER CARRIES THE FACT: the percentage is
// never coloured by band. Nothing here glows — an account is not alive, its
// sessions are.
//
// THE FOLDED LINE NEVER DROPS AN OFF ACCOUNT. It is the phone's default view,
// so the accounts that cannot take work sit in a tail (one named, two or more
// counted) and the hot windows before it ellipsize first. A long single name
// ellipsizes inside the tail down to a floor, but the word `off` after it is a
// span of its own that never shrinks: the state is never the part that goes.
//
// THE GRID FITS ITS COLUMN. The rows sit in a size container, so a narrow
// sidebar drops the reset columns (the 7d one first, then the 5h one) rather
// than drawing past its edge; each reset stays in the row's name.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { EYEBROW } from '../lib/text';
import { Meter, limitBand, type LimitBand } from '../primitives/meter';
import './workbench-account-row.css';

/** One usage window as the app measured it. */
export interface WorkbenchUsageWindow {
  /** 0-100. `null` = never measured: reads `—` and draws no fill. */
  pct: number | null;
  /** The window ended and nothing measures the new one yet: reads `reset`, no fill. */
  rolledOver?: boolean;
  /** The app's `formatReset(resetAt, now)`: "2h 10m", "3d 4h", "now", "—". */
  reset: string;
}

export interface WorkbenchAccountItem {
  id: string;
  /** Display name, shown in mono. Never a wrapper id. */
  name: string;
  /** The app's `accountHue(...)`; stamped as `data-acct`, `'unknown'` when null. */
  hue: string | null;
  five: WorkbenchUsageWindow;
  seven: WorkbenchUsageWindow;
  /** Cannot take work: last numbers kept, greyed fills, hollow ring. */
  off?: boolean;
  /** App words: the over-ceiling forecast (`dead`), or the reason it is off. */
  note?: { tone: 'dead' | 'off'; text: string } | null;
}

export interface WorkbenchAccountRowProps {
  accounts: readonly WorkbenchAccountItem[];
  /** Seed for the fold; the phone passes true. */
  defaultFolded?: boolean;
  /** Opens the Accounts screen, for the row's account. */
  onOpen: (accountId: string) => void;
}

type WindowName = '5h' | '7d';

/** The fold summary's threshold: a window at or past it is "hot". */
const HOT_AT = 75;

/** The off name's floor, in characters (the sheet's `min-width: 4ch`). A name
 *  this short or shorter never shrinks, so it is never padded out to the floor. */
const WHO_FLOOR = 4;

const windowsOf = (a: WorkbenchAccountItem): readonly (readonly [WindowName, WorkbenchUsageWindow])[] =>
  [['5h', a.five], ['7d', a.seven]];

/** A window that is measuring now: measured, and not rolled over. */
const liveFill = (w: WorkbenchUsageWindow): number | null =>
  w.pct === null || w.rolledOver === true ? null : w.pct;

/** What the row prints: `reset`, `—` or a whole percentage. */
function reading(w: WorkbenchUsageWindow): string {
  if (w.rolledOver === true) return 'reset';
  if (w.pct === null) return '—';
  return `${Math.round(w.pct)}%`;
}

/** What the row's name says for one window, in words. */
function spoken(name: WindowName, w: WorkbenchUsageWindow): string {
  const fact = w.rolledOver === true ? 'reset' : w.pct === null ? 'never measured' : `${Math.round(w.pct)}% used`;
  return `${name} ${fact}, resets in ${w.reset}`;
}

/** The two hottest live windows at ≥ 75 %, hottest first. Pure.
 *  Never-measured and rolled-over windows are not live; an `off` account is
 *  excluded (the fold names it separately). */
export function hottestWindows(
  accounts: readonly WorkbenchAccountItem[],
  n = 2,
): { name: string; window: WindowName; pct: number }[] {
  const out: { name: string; window: WindowName; pct: number }[] = [];
  for (const a of accounts) {
    if (a.off === true) continue;
    for (const [window, w] of windowsOf(a)) {
      const pct = liveFill(w);
      if (pct !== null && pct >= HOT_AT) out.push({ name: a.name, window, pct: Math.round(pct) });
    }
  }
  return out.sort((x, y) => y.pct - x.pct).slice(0, n);
}

/** One window's three cells: the meter, the reading, the reset. */
function Win({ name, w, off }: { name: WindowName; w: WorkbenchUsageWindow; off: boolean }): ReactNode {
  const pct = liveFill(w);
  return (
    <>
      <Meter pct={w.rolledOver === true ? null : w.pct} band={pct === null ? 'none' : limitBand(pct)} off={off} />
      <span className="wb-acct-pct">{reading(w)}</span>
      <span className="wb-acct-reset" data-win={name}>{`↻ ${w.reset}`}</span>
    </>
  );
}

function Row({ a, onOpen }: { a: WorkbenchAccountItem; onOpen: (id: string) => void }): ReactNode {
  const off = a.off === true;
  const label = `${a.name} — ${spoken('5h', a.five)}; ${spoken('7d', a.seven)}${a.note ? `; ${a.note.text}` : ''}`;
  return (
    <button
      type="button"
      className={cn('wb-acct-row', FOCUS_RING)}
      data-acct={a.hue ?? 'unknown'}
      aria-label={label}
      onClick={() => onOpen(a.id)}
    >
      <span className="wb-acct-hue" data-off={off ? 'true' : undefined} aria-hidden="true" />
      <span className="wb-acct-name">{a.name}</span>
      <Win name="5h" w={a.five} off={off} />
      <Win name="7d" w={a.seven} off={off} />
      {a.note && <span className="wb-acct-note" data-tone={a.note.tone}>{a.note.text}</span>}
    </button>
  );
}

/** The folded line's lead: the hottest windows in their band, or the calm word. */
function leadParts(accounts: readonly WorkbenchAccountItem[]): { key: string; text: string; band?: LimitBand }[] {
  const hot = hottestWindows(accounts);
  return hot.length === 0
    ? [{ key: 'calm', text: `all under ${HOT_AT}%` }]
    : hot.map((h) => ({ key: `${h.name}-${h.window}`, text: `${h.name} ${h.window} ${h.pct}%`, band: limitBand(h.pct) }));
}

/** The folded line's tail: every account that cannot take work. One is named
 *  (`lane-d` + ` off`); two or more collapse to a count (`3` + ` off`) whose
 *  names follow for assistive technology — the open list names each, with its
 *  reason. The lead ellipsizes first, so the line can never drop the accounts
 *  it was written to name; a long name then ellipsizes to a floor, and the
 *  word ` off` is never cut. Null when every account can work. Pure. */
function offSummary(accounts: readonly WorkbenchAccountItem[]): { who: string; names: string | null } | null {
  const off = accounts.filter((a) => a.off === true).map((a) => a.name);
  if (off.length === 0) return null;
  return off.length === 1 ? { who: off[0]!, names: null } : { who: String(off.length), names: off.join(', ') };
}

export function WorkbenchAccountRow({ accounts, defaultFolded = false, onOpen }: WorkbenchAccountRowProps): ReactNode {
  const [folded, setFolded] = useState(defaultFolded);
  const off = offSummary(accounts);
  return (
    <div className="wb-acct">
      <button
        type="button"
        className={cn('wb-acct-head', FOCUS_RING)}
        aria-expanded={!folded}
        onClick={() => setFolded((f) => !f)}
      >
        <span className="wb-acct-fold" aria-hidden="true">{folded ? '▸' : '▾'}</span>
        <span className={cn('wb-acct-eyebrow', EYEBROW)}>Accounts</span>
        {folded ? (
          <span className="wb-acct-sum">
            <span className="wb-acct-lead">
              {leadParts(accounts).map((p, i) => (
                <span key={p.key}>
                  {i > 0 && <span aria-hidden="true">{' · '}</span>}
                  {p.band === undefined ? p.text : <span className="wb-acct-hot" data-band={p.band}>{p.text}</span>}
                </span>
              ))}
            </span>
            {off && (
              <span className="wb-acct-off">
                {/* Drawn in three spans so the name can give and ` off` cannot;
                    spoken as ONE phrase, so no reader joins `lane-d` and `off`
                    across a span edge it trimmed (`lane-doff`). */}
                <span className="wb-acct-sep" aria-hidden="true">{' · '}</span>
                <span
                  className="wb-acct-who"
                  aria-hidden="true"
                  data-short={off.who.length <= WHO_FLOOR ? 'true' : undefined}
                  title={off.names === null ? off.who : undefined}
                >
                  {off.who}
                </span>
                <span className="wb-acct-word" aria-hidden="true">{' off'}</span>
                <span className="sr-only">{`${off.who} off${off.names === null ? '' : `: ${off.names}`}`}</span>
              </span>
            )}
          </span>
        ) : (
          <span className="wb-acct-legend">{accounts.length}</span>
        )}
      </button>
      {!folded && (
        <div className="wb-acct-list">
          <div className="wb-acct-colh" aria-hidden="true">
            <span>5h</span>
            <span>7d</span>
          </div>
          {accounts.map((a) => <Row key={a.id} a={a} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}
