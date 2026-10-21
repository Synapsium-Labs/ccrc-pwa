// One row of Settings → Appearance: a radio, a name over a note. Layout
// (SkinFieldset.tsx) draws it; Theme is a preview grid of cards since settings
// Task R2e (D-5503), which reads its choices from `THEME_CHOICES` below.
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
import { RADIO_FIELDSET, RADIO_LEGEND, Radio, SYSTEM, THEMES } from '@ccrc/ui';
import { doorMark } from '../command/door';

/** One Appearance fieldset: the set, and its legend. `command` is the
 *  registry command whose argument the choice is (Switch theme, Switch
 *  layout): the fieldset is that command's door, marked and not handled,
 *  because the radios already act (`doorMark`, D-5469). */
export function AppearanceFieldset(
  { legend, command, children }: { legend: string; command: string; children: ReactNode },
): ReactNode {
  return (
    <fieldset className={RADIO_FIELDSET} {...doorMark(command)}>
      <legend className={RADIO_LEGEND}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/** Theme's choices, one list (settings Task R2e, D-5503): "Follow system", then the catalogue in its own order (the
 *  eight dark, then the four light). "Follow system" is not a palette, and deliberately not in `THEMES`: the generator
 *  writes that list and `themes:check` rules on it. It is the choice that says "whichever of Phosphor & Ink and
 *  Phosphor Daylight the device is in". */
const FOLLOW_SYSTEM = {
  id: SYSTEM,
  label: 'Follow system',
  note: 'Phosphor & Ink after dark, Phosphor Daylight otherwise.',
};
export const THEME_CHOICES: readonly { id: string; label: string; note: string }[] = [FOLLOW_SYSTEM, ...THEMES];

export function AppearanceRow({ choice, current, onPick, group }: {
  /** Structural, not `ThemeChoice`: "Follow system" is not a palette and
   *  carries no `mode`. A skin is this row (D-5458). */
  choice: { id: string; label: string; note: string };
  current: string;
  onPick: (id: string) => void;
  /** The radio group's `name`: one per fieldset (D-5458). */
  group: string;
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
        <span className="settings-theme-name">{choice.label}</span>
        <span className="settings-note">{choice.note}</span>
      </span>
    </Radio>
  );
}
