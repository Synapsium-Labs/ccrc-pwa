// The desk shell's status bar: one quiet line along the bottom that keeps the
// fleet's pulse in view while the operator works inside one session tab — the
// agent link, the fleet totals, what needs you, the palette and shortcut
// hints, and the running build. Each item is a quiet button that opens where
// its fact lives; WHERE that is belongs to the app (the callbacks).
//
// Plain data in, callbacks out. The bar formats ONLY its own counts
// ("19 sessions · 5 runs", "2 need you", "nothing needs you", "1 exited") and
// names its own controls. The build words arrive already decided, with the
// app's own predicates (BuildLine's), as `build.text` + `build.warn` — so the
// bar never sees a node inventory, a pending tag or a remote side.
//
// Rules from the card, kept here:
//   - GLOW MEANS LIFE: nothing on the bar glows. The link dot is matte, and it
//     is NOT a `StatusDot` — those glyphs and words are a session's buckets,
//     not a connection.
//   - Two cues per state: "offline", "need you", "exited" and the build's
//     warning words are written out, never colour alone. The link's state is
//     also its button's accessible name, so the WORD "connected" may yield on
//     a narrow window while "offline" never does.
//   - Never "0 need you" — at zero it is "nothing needs you", and when the bar
//     runs out of room those calm words ellipsize rather than turn into a count.
//
// The yield order is the bar's own (a container query on its width, never the
// viewport's): the totals truncate first; then `?` and the word "connected"
// hide; then the palette hint; and only then the calm words and, last, the
// build line, down to a floor that keeps its first 11 characters.
//
// Desk-only: there is no status bar on a phone (the app moves its counts into
// the fleet subtitle). The card's 20px items are therefore the fine-pointer
// size; any other pointer keeps the `--tap-min` floor (the sheet).
//
// Landmark: the root is a `<footer>` labelled "Fleet status". It is the
// `contentinfo` landmark only when it is NOT inside `<main>`, `<section>` or
// `<article>`, so the desk shell must render it as a sibling of its main column.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { Icon } from '../primitives/icon';
import './workbench-status-bar.css';

export interface WorkbenchStatusBarProps {
  /** The agent link is up. */
  connected: boolean;
  /** Plain fleet totals. */
  sessions: number;
  runs: number;
  /** The app's Needs-you count and its exited count. */
  needYou: number;
  exited: number;
  /** The running build, already worded by the app: "v1.4.2", "v1.4.2 → v1.4.3",
   *  "unversioned (bd2bf57a)", "… dirty". `warn` paints it in the attention ink —
   *  only ever beside words that say why. */
  build: { text: string; warn: boolean };
  onOpenLink: () => void;
  onOpenFleet: () => void;
  onOpenNeeds: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  onOpenBuild: () => void;
}

/** `1 session`, `19 sessions`, `0 runs`. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The one JSX site for every item, so the markup census sees one button.
 *  `part` stamps the per-item hook the sheet's yield order selects. */
/** The build line's floor, in characters: it keeps this much before it yields further. */
const BUILD_FLOOR = 11;

function Item({ part, label, title, calm, long, onClick, children }: {
  part: string;
  label?: string;
  title?: string;
  /** The needs item at zero: the one item whose words may yield (the sheet). */
  calm?: boolean;
  /** Words longer than the build floor, so the floor applies; a shorter build
   *  line is its own floor, and a fixed one would pad it with blank space. */
  long?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      className={cn('wb-status-item', `wb-status-${part}`, FOCUS_RING)}
      aria-label={label}
      title={title}
      data-calm={calm ? 'true' : undefined}
      data-long={long ? 'true' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The ` · ` between facts: ink-tertiary, and silent to assistive tech. */
function Sep(): ReactNode {
  return <span className="wb-status-sep" aria-hidden="true"> · </span>;
}

export function WorkbenchStatusBar({
  connected, sessions, runs, needYou, exited, build,
  onOpenLink, onOpenFleet, onOpenNeeds, onOpenPalette, onOpenShortcuts, onOpenBuild,
}: WorkbenchStatusBarProps): ReactNode {
  const link = connected ? 'on' : 'off';
  const totals = `${count(sessions, 'session', 'sessions')} · ${count(runs, 'run', 'runs')}`;
  const need = needYou > 0 ? `${needYou} need you` : 'nothing needs you';
  const gone = exited > 0 ? `${exited} exited` : null;
  return (
    <footer className="wb-status" aria-label="Fleet status">
      <Item part="link" label={connected ? 'Agent link connected' : 'Agent link offline'} onClick={onOpenLink}>
        <span className="wb-status-dot" data-link={link} aria-hidden="true" />
        <span className="wb-status-word" data-link={link}>{connected ? 'connected' : 'offline'}</span>
      </Item>
      <Sep />
      <Item part="totals" title={totals} onClick={onOpenFleet}>
        <span className="wb-status-text">{totals}</span>
      </Item>
      <Sep />
      {/* With an exited count the visible ` · ` is aria-hidden, so the name is
          given whole — otherwise it would read "2 need you1 exited". */}
      <Item
        part="needs"
        label={gone === null ? undefined : `${need}, ${gone}`}
        calm={needYou === 0 && gone === null}
        onClick={onOpenNeeds}
      >
        {/* Two branches, not a ternary on className: a single-quoted class
            literal would be a hook the census must own (contract §1.2). The
            calm words ellipsize (the sheet's yield order); "need you" never. */}
        {needYou > 0 ? <span className="wb-status-need">{need}</span> : <span className="wb-status-text">{need}</span>}
        {gone !== null && <Sep />}
        {gone !== null && <span className="wb-status-exited">{gone}</span>}
      </Item>
      <span className="wb-status-spacer" />
      <Item part="palette" label="Command palette, ⌘K" onClick={onOpenPalette}>
        <Icon name="command" size={16} />
        <span aria-hidden="true">K</span>
      </Item>
      <Item part="keys" label="Keyboard shortcuts" onClick={onOpenShortcuts}>
        <span aria-hidden="true">?</span>
      </Item>
      <Item part="build" title={build.text} long={build.text.length > BUILD_FLOOR} onClick={onOpenBuild}>
        <span className="wb-status-text" data-warn={build.warn ? 'true' : undefined}>{build.text}</span>
      </Item>
    </footer>
  );
}
