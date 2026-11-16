// A door runs its command (D-5469, W2 Task S2b).
//
// A shell control that performs a registry command is built with `commandDoor(id)`, never with a handler of its own:
// clicking it asks the one `CommandLayer` to run that command with the same context the palette and the keys use, so a
// door and the palette can never disagree about what "Go to Runs" or "New session" does. A fieldset whose choice IS
// the command's argument (Switch layout, Switch theme) carries `doorMark(id)`, the attribute alone. A control that
// opens a per-row fleet flow is built with `actionDoor(id, fn)`. The parity test (S17) finds every door by its
// `data-command` or `data-action`, in both skins.
//
// WHY AN EVENT, NOT A HOOK. A door is spread onto a primitive inside any part of either skin, often far below the
// layer, and `commandDoor` is a plain function so a part can build one inline. The layer listens on `window` for
// `DOOR_EVENT` and runs the command by id; it is mounted once, above the frame, in `app.tsx`. Pure: no store.

import { navigate } from '../lib/router';

/** The event a door dispatches; `CommandLayer` is its one listener. */
export const DOOR_EVENT = 'ccrc:command';

export interface CommandDoor {
  'data-command': string;
  onClick: () => void;
}

/** The props of a control that runs registry command `id`. */
export function commandDoor(id: string): CommandDoor {
  return {
    'data-command': id,
    onClick: () => window.dispatchEvent(new CustomEvent<string>(DOOR_EVENT, { detail: id })),
  };
}

/** The mark of a fieldset whose choice is command `id`'s argument: no handler, the fieldset already acts. */
export function doorMark(id: string): { 'data-command': string } {
  return { 'data-command': id };
}

/** The props of a control that opens per-row fleet flow `id` (`open-actions`, `open-pool`, …). */
export function actionDoor(id: string, fn: () => void): { 'data-action': string; onClick: () => void } {
  return { 'data-action': id, onClick: fn };
}

/** A page's back to the fleet (W2 Task S5, the door table's `go-fleet` row on a phone): `PageScaffold`'s `back`, marked
 *  as the `go-fleet` door. A back whose target is not `/` carries no mark. */
export function backToFleet(className?: string): { label: string; onClick: () => void; className?: string; 'data-command': string } {
  return { label: 'Back to fleet', onClick: () => navigate('/'), className, ...doorMark('go-fleet') };
}
