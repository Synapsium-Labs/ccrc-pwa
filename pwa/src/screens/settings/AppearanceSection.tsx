// Settings › Appearance (settings spec §3.3, §5.2; D-5503): one card (scope "This device") holding Layout's
// `SkinFieldset` and its fonts line, then Theme's rows. This device's choices, so it reads nothing from the frame's
// view. The page's `<h2>` is the frame's; the card's title is an `<h3>`.
import type { ReactNode } from 'react';
import { SYSTEM, Section, THEMES } from '@ccrc/ui';
import { AppearanceFieldset, AppearanceGroup, AppearanceRow } from '../AppearanceRow';
import { SkinFieldset } from '../SkinFieldset';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
// `dayClock` and `elapsedWords` come THROUGH the update plane's reading
// surface, which is where the twenty wire-row-to-sentence helpers moved: the
// box-token card landed on main while that move was happening on this branch,
// and it reads two of the same clocks.
import { setTheme, useThemeChoice } from '../../lib/theme';
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import '../../fleet/fleet.css';


// The row the Theme fieldset draws moved to `AppearanceRow.tsx` (D-5458): the
// Layout fieldset draws it too, and two copies of its markup are what the
// markup census refuses.

/** Not a palette, and deliberately not in `THEMES`: the generator writes that
 *  list and `themes:check` rules on it. This is the row that says "whichever
 *  of those two the phone is in". */
const FOLLOW_SYSTEM = {
  id: SYSTEM,
  label: 'Follow system',
  note: 'Phosphor & Ink after dark, Phosphor Daylight otherwise.',
};

/** The Appearance page's body (the heading is the frame's `<h2>`). Exported for its tests: it reads no poll, so a test
 *  of a radio group needs no control plane. */
export function AppearanceSection(): ReactNode {
  // The choice in force, as `initTheme` read it at boot or `setTheme` last
  // made it — here or in the palette's "Switch theme…" — so the control opens
  // on what is actually applied and never keeps a stale row (D-5572).
  const current = useThemeChoice();
  const pick = (id: string): void => { setTheme(id); };

  const dark = THEMES.filter((t) => t.mode === 'dark');
  const light = THEMES.filter((t) => t.mode === 'light');

  const card = SETTINGS_CARDS.appearance.look;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <SkinFieldset />
      <AppearanceFieldset legend="Theme" command="switch-theme">
        <AppearanceRow choice={FOLLOW_SYSTEM} current={current} onPick={pick} group="settings-theme" swatch={false} />
        {/* Grouped by how the palette reads, because that is the first thing
            anyone is choosing between — and the ask was light AND dark, not a
            dark list with one light apology. */}
        <AppearanceGroup>Dark</AppearanceGroup>
        {dark.map((t) => <AppearanceRow key={t.id} choice={t} current={current} onPick={pick} group="settings-theme" />)}
        <AppearanceGroup>Light</AppearanceGroup>
        {light.map((t) => <AppearanceRow key={t.id} choice={t} current={current} onPick={pick} group="settings-theme" />)}
      </AppearanceFieldset>
    </Section>
  );
}
