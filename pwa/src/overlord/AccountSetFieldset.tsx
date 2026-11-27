// The Overlord's account set as checkboxes (Overlord W1 home B and C): one box per pool and one for the untagged accounts. Ring L4,
// context C5: it draws the boxes it is handed and decides nothing. Start (the place's body part) and Settings › Overlord's account
// set card both draw it, so the set has one fieldset (the brief's ruling 3: one definition, no second copy). Each caller builds its
// boxes from `poolOptions` over the roster: Start in the roster's order, Settings in the saved set's order (`setBoxesOf`).
//
// The classes are the place's one stylesheet's (`overlord.css`): `ov-account-set` (the fieldset), `ov-account-legend` and
// `ov-account-hit` (a box's label, the whole 44 px row its hit area).
import type { ReactNode } from 'react';

export interface SetCheckbox {
  readonly key: string;
  readonly label: string;
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}

export function AccountSetFieldset({ legend, boxes, disabled, marker }: {
  readonly legend: string;
  readonly boxes: readonly SetCheckbox[];
  readonly disabled: boolean;
  /** The data attribute a caller's tests find the fieldset by. */
  readonly marker: 'data-overlord-account-set' | 'data-settings-account-set';
}): ReactNode {
  return (
    <fieldset className="ov-account-set" disabled={disabled} {...{ [marker]: '' }}>
      <legend className="ov-account-legend">{legend}</legend>
      {boxes.map((box) => (
        <label key={box.key} className="ov-account-hit" data-set-box={box.key}>
          <input type="checkbox" checked={box.on} onChange={(e) => box.set(e.currentTarget.checked)} />
          {box.label}
        </label>
      ))}
    </fieldset>
  );
}
