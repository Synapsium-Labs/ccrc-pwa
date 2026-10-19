// One row of Settings → Appearance: a radio, a name over a note, and (for a
// palette) its swatch. Two fieldsets draw it: Theme (SettingsScreen.tsx) and
// Layout (SkinFieldset.tsx).
//
// IT LEFT SettingsScreen.tsx WHEN THE SECOND FIELDSET ARRIVED (D-5458). It was
// `ThemeRow` there, and the plan's Task 12b asks for the Layout rows "built
// like ThemeRow". Copying its markup into SkinFieldset.tsx is the duplicate
// the markup census exists to refuse (its body/head/name/note block, twice),
// and importing it back from SettingsScreen.tsx, which mounts SkinFieldset,
// would be a cycle. So the row is a module of its own, its markup unchanged.
//
// `group` IS NEW, AND IT IS NOT OPTIONAL. The row used to hard-code
// `name="settings-theme"`, which was harmless while one fieldset drew it. Two
// fieldsets sharing a radio `name` are ONE radio group to the browser: picking
// a layout would uncheck the chosen theme, and arrow keys would walk from one
// set into the other. Each caller names its own group.
//
// THE FIELDSET AND ITS HEADINGS CAME WITH IT. `RADIO_FIELDSET` and
// `RADIO_LEGEND` are the skin of `<Radio>`, and the design-system boundary
// lets a file hold them only beside the primitive (design-system-boundary
// .test.ts). With the row gone, SettingsScreen.tsx no longer rendered a
// `<Radio>`, so the frame both fieldsets share lives here too.
import type { ReactNode } from 'react';
import { PHOSPHOR, RADIO_FIELDSET, RADIO_LEGEND, Radio } from '@ccrc/ui';

/** One Appearance fieldset: the set, and its legend. */
export function AppearanceFieldset({ legend, children }: { legend: string; children: ReactNode }): ReactNode {
  return (
    <fieldset className={RADIO_FIELDSET}>
      <legend className={RADIO_LEGEND}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A group heading inside a fieldset — not a second <legend>, which would be
 *  invalid, and not a control. */
export function AppearanceGroup({ children }: { children: ReactNode }): ReactNode {
  return <p className={`${RADIO_LEGEND} settings-theme-group`}>{children}</p>;
}

export function AppearanceRow({ choice, current, onPick, group, swatch = true }: {
  /** Structural, not `ThemeChoice`: "Follow system" is not a palette and
   *  carries no `mode`, but it IS this row — same label over the same note,
   *  same radio, in the same group. It was written out a second time instead,
   *  and the markup census found it. A skin is this row too (D-5458). */
  choice: { id: string; label: string; note: string };
  current: string;
  onPick: (id: string) => void;
  /** The radio group's `name`: one per fieldset (D-5458). */
  group: string;
  /** "Follow system" draws none: there is no single palette to preview, and
   *  five swatches of whichever one happens to be applied would be a preview
   *  of the wrong thing. A skin draws none either: a skin owns no colour. */
  swatch?: boolean;
}): ReactNode {
  const active = current === choice.id;
  return (
    <Radio
      className="settings-theme"
      data-active={active}
      name={group}
      value={choice.id}
      checked={active}
      onChange={() => onPick(choice.id)}
      bare
    >
      <span className="settings-theme-body">
        {/* THE SWATCH RIDES THE NAME'S LINE, not the row's far edge. As the
            row's last flex item behind a `flex: 1` body it sat at the right
            edge of the section — about 1400px from its own name at a 1920px
            window — so a palette and its preview read as two columns that
            happened to share a stripe of tint. Beside the name it is that
            palette's preview at every width, phone to wide. */}
        <span className="settings-theme-head">
          <span className="settings-theme-name">{choice.label}</span>
          {/* `data-theme` on the swatch itself: tokens.css's blocks are plain
              attribute selectors, so they resolve on ANY element, not just the
              root. The preview is therefore the real palette rather than a
              hand-copied approximation of it. `phosphor` carries no block — it
              is :root — so it deliberately stamps nothing and inherits the
              default. */}
          {swatch && (
            <span
              className="settings-theme-swatch"
              aria-hidden="true"
              {...(choice.id === PHOSPHOR ? {} : { 'data-theme': choice.id })}
            >
              <i style={{ background: 'var(--bg-surface)' }} />
              <i style={{ background: 'var(--ink-primary)' }} />
              <i style={{ background: 'var(--accent)' }} />
              <i style={{ background: 'var(--status-attention)' }} />
              <i style={{ background: 'var(--status-dead)' }} />
            </span>
          )}
        </span>
        <span className="settings-note">{choice.note}</span>
      </span>
    </Radio>
  );
}
