// Radio — a choice made of mutually exclusive sentences.
//
// THE SYSTEM COULD NOT RENDER ONE. `TextInput` covered a line of text and
// `Select` a list behind a disclosure, and the third shape every settings
// screen needs — pick one of these, all of them visible — lived in
// `SettingsScreen` as a local `RadioFieldset` plus five rules in `fleet.css`.
// Two call sites there already shared it (the notification / channel /
// auto-install groups, and the theme picker through `ThemeRow`), and a third
// consumer would have had no way to reach either half.
//
// WHAT CAME WITH IT, AND WHAT DID NOT. The whole skin is here, because all of
// it turned out to be LAYOUT: six declarations on the option row, four on the
// fieldset, three on the legend, two on the sentence, four sizing the input.
// Not one of them sets a colour, so nothing a contrast-gate entry names has
// moved and no ground travelled with the shape. `.settings-theme` and its
// body, which DO paint, stay in fleet.css and ride along as `className` — the
// same arrangement `CollapsibleStrip` has with the three strips.
//
// THE 18px INPUT IS DELIBERATE and `control-census.test.ts` has been recording
// it as a SELECTOR verdict: a radio IS small, so the hit area is the LABEL
// that wraps it, which carries `min-h-tap`. That floor is this component's now
// rather than an app rule's, which is the one real change in where the
// guarantee lives.
//
// `fieldset`/`legend` RATHER THAN `role="radiogroup"`: the native pair gives
// the group its accessible name, and `disabled` on the fieldset disables every
// input in it with no per-option plumbing. Both call sites depend on that —
// and on it being SEPARATE from a per-option `disabled`, because one of them
// (auto-install, D-3315) must grey a single unsafe choice while leaving the
// safe one takeable.
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The option ROW: the label a thumb lands on.
 *
 *  `min-h-tap` is the whole point — the input inside is 18px, which is what a
 *  radio is, and WCAG's target is this row. `group-disabled:` reads the
 *  FIELDSET's disabled state (see `RADIO_FIELDSET`, which carries `group`):
 *  the cursor stops promising a choice that cannot be made. */
export const RADIO_OPTION =
  'flex items-center gap-2 min-w-0 min-h-tap cursor-pointer group-disabled:cursor-default';

/** The input itself. 18px square, flush: the row above supplies the target. */
export const RADIO_INPUT = 'flex-none w-[18px] h-[18px] m-0';

/** The sentence beside it. `min-w-0` so a long one wraps inside the row
 *  instead of pushing the radio off it. */
export const RADIO_SENTENCE = 'min-w-0 text-sm leading-normal';

/** The set. A grid, so the rows stack with no margin collapsing, and
 *  `min-w-0` so the whole set can shrink inside a narrow card. */
export const RADIO_FIELDSET = 'group grid min-w-0 m-0 p-0 border-0';

/** Its name. The micro-label register — mono, `--fs-xs`, medium — which is
 *  `EYEBROW`'s family without its uppercase: a legend is a phrase, not a tag. */
export const RADIO_LEGEND = 'p-0 mb-1 font-mono text-xs font-medium leading-tight';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** What the choice says. Wrapped in `RADIO_SENTENCE` unless `bare`. */
  children: ReactNode;
  /** On the LABEL — the row — because that is what a call site skins. */
  className?: string;
  /** Render `children` as given, with no sentence span around them. The theme
   *  picker's rows are a name over a note over a swatch, which is a body of
   *  its own rather than a sentence. */
  bare?: boolean;
}

export function Radio({ children, className, bare, ...props }: RadioProps): ReactNode {
  return (
    <label className={cn(RADIO_OPTION, className)}>
      <input type="radio" className={RADIO_INPUT} {...props} />
      {bare === true ? children : <span className={RADIO_SENTENCE}>{children}</span>}
    </label>
  );
}

export interface RadioFieldsetProps<T extends string> {
  legend: string;
  /** The group's `name` — the thing that makes the set ONE choice. */
  name: string;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  /** NULLABLE, because a caller may be reading it off a wire row that has not
   *  arrived: `value={fleet?.channel ?? null}` asks the question once instead
   *  of once per option. */
  value: T | null;
  onPick: (value: T) => void;
  /** The whole set. A DIFFERENT gate from an option's own `disabled`, and both
   *  are needed. */
  disabled?: boolean;
  describedBy?: string;
  /** Skin for the fieldset, for a call site whose set paints. */
  className?: string;
  /** Skin for each row. */
  optionClassName?: string;
}

export function RadioFieldset<T extends string>({
  legend, name, options, value, onPick, disabled, describedBy, className, optionClassName,
}: RadioFieldsetProps<T>): ReactNode {
  return (
    <fieldset
      className={cn(RADIO_FIELDSET, className)}
      disabled={disabled}
      aria-describedby={describedBy}
    >
      <legend className={RADIO_LEGEND}>{legend}</legend>
      {options.map((o) => (
        <Radio
          key={o.value}
          name={name}
          value={o.value}
          checked={value === o.value}
          disabled={o.disabled}
          onChange={() => onPick(o.value)}
          className={optionClassName}
        >
          {o.label}
        </Radio>
      ))}
    </fieldset>
  );
}
