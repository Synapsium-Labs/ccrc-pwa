// Settings › Appearance (settings spec §3.3, §5.2; D-5503): one card (scope "This device") holding Layout's
// `SkinFieldset` and its fonts line, then Theme as a preview grid (settings Task R2e). This device's choices, so it
// reads nothing from the frame's view. The page's `<h2>` is the frame's; the card's title is an `<h3>`.
//
// THE GRID (spec §5.2). Thirteen cards, `THEME_CHOICES`' order: Follow the system, then the eight dark and four light
// palettes. Each palette card carries `data-theme`, so it is drawn IN the palette it names: tokens.css's blocks are
// plain attribute selectors and resolve on any element, so a card cannot show a hand-copied approximation. Phosphor &
// Ink's colours answer to `[data-theme='phosphor']` as well as `:root` (tokens.css), so its card is dark on a light
// page; Follow the system is not a palette and stamps none (it draws the page's own palette). Each card is a `Radio`
// (the label is the 44px target; its input is the group's one tab stop), its note in the card's `title` and, on a
// phone, under the grid for the checked card only; a column of 480 or more shows every card's note (settings.css's
// container query). The note is the radio's DESCRIPTION, not part of its name, so a phone's screen reader still hears
// every palette's note while the visible one is hidden.
//
// ONE RADIO GROUP, AND THE KEYS ARE OURS. Theme stays an `AppearanceFieldset`, like Layout: its legend names it and it
// is the Switch theme command's door (`doorMark`, D-5469). Inside it the cards are one `role="radiogroup"`. The arrow keys move the choice
// here, and `preventDefault` keeps the browser's own radio arrowing from moving it a second time: one press is one
// `setTheme`, one storage write. The checked card is `useThemeChoice()`, the choice in force as the boot read it from
// storage or `setTheme` last made it (D-5572), never a copy of the last tap.
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { Radio, SYSTEM, Section } from '@ccrc/ui';
import { AppearanceFieldset, THEME_CHOICES } from '../AppearanceRow';
import { SkinFieldset } from '../SkinFieldset';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { setTheme, useThemeChoice } from '../../lib/theme';
import '../../fleet/fleet.css';
import './settings.css';

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function ThemeGrid(): ReactNode {
  const current = useThemeChoice();
  const noteId = useId();
  const at = Math.max(0, THEME_CHOICES.findIndex((c) => c.id === current));
  const checked = THEME_CHOICES[at]!;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEP[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const n = THEME_CHOICES.length;
    const next = (at + step + n) % n;
    setTheme(THEME_CHOICES[next]!.id);
    e.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')[next]?.focus();
  };

  return (
    <AppearanceFieldset legend="Theme" command="switch-theme">
      <div className="settings-palettes-wrap">
        <div role="radiogroup" aria-label="Theme palettes" className="settings-palettes" onKeyDown={onKeyDown}>
          {THEME_CHOICES.map((c) => {
            const active = c.id === checked.id;
            const stamp = c.id === SYSTEM ? {} : { 'data-theme': c.id };
            return (
              <span key={c.id} className="settings-palette" data-active={active} title={c.note} {...stamp}>
                <Radio
                  className="settings-palette-hit"
                  name="settings-theme"
                  value={c.id}
                  checked={active}
                  tabIndex={active ? 0 : -1}
                  aria-describedby={`${noteId}-${c.id}`}
                  onChange={() => setTheme(c.id)}
                  bare
                >
                  <span className="settings-palette-chips" aria-hidden="true">
                    <i className="settings-palette-chip-accent" />
                    <i className="settings-palette-chip-attention" />
                    <i className="settings-palette-chip-dead" />
                  </span>
                  <span className="settings-palette-text">
                    <span className="settings-palette-name">{c.label}</span>
                    <span id={`${noteId}-${c.id}`} className="settings-palette-note" aria-hidden="true">{c.note}</span>
                  </span>
                  {active && <span className="settings-palette-check" aria-hidden="true">✓</span>}
                </Radio>
              </span>
            );
          })}
        </div>
        <p className="settings-note settings-palette-current">{checked.note}</p>
      </div>
    </AppearanceFieldset>
  );
}

/** The Appearance page's body (the heading is the frame's `<h2>`). Exported for its tests: it reads no poll, so a test
 *  of a radio group needs no control plane. */
export function AppearanceSection(): ReactNode {
  const card = SETTINGS_CARDS.appearance.look;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <SkinFieldset />
      <ThemeGrid />
    </Section>
  );
}
