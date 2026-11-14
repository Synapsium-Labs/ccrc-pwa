// D-8382 (#1442): Overrides in force and the approvals topology, the wire of `GET /api/fleet/overrides` and every word
// the console says of it. L0: it imports only its siblings.
//
// The overrides are the switchboard's own rows (`overrideSwitchNames`, `shared/switches.ts`): the wire carries each
// row's name and what was read of it, and the console says what the row does, what its absence means and where it
// stands from the row itself, so no second list of overrides is kept here or anywhere. Every one is terminal-only on
// purpose: nothing here, or on the console, writes one.
import type { MarkerState } from './api.js';
import type { OverrideReading, OverrideSwitchName } from './switches.js';

/** The approvals topology of the server box (coordinator-first routing spec §6.1): `two` when the server and the
 *  sessions run on two boxes (a remote fleet with a role other than `both`), `one` otherwise; whether the server box's
 *  `~/.ccrc/<file>` opt-in stands; and the file's name, spelled once on the server (`APPROVALS_SINGLE_BOX_FILE`). */
export interface ApprovalsTopologyWire {
  readonly boxes: 'one' | 'two';
  readonly marker: 'present' | 'absent';
  readonly file: string;
}

/** The read's answer: every override with its state, in the switchboard's order, and the approvals topology. */
export interface OverridesView {
  readonly overrides: readonly OverrideReading[];
  readonly approvals: ApprovalsTopologyWire;
}

/** The Overrides in force card's words. `{path}` is `switchPath`'s, `{default}` the row's absence, `{n}` a count. */
export const OVERRIDES_TEXT = {
  title: 'Overrides in force',
  purpose: 'Emergency switches placed by hand on the fleet box, what each does and how to lift it. None has a control '
    + 'here, on purpose: each is placed and lifted at a terminal.',
  none: 'No override is in force.',
  unmeasured: '{n} of them could not be read on the fleet box, so whether they stand is not known: its agent may be older '
    + 'than this console, or the link is down.',
  without: 'Without it: {default}.',
  remedy: 'To lift it, remove {path} at a terminal on the fleet box.',
  unread: 'The overrides could not be read.',
  stale: 'The latest read failed: this is the last answer that landed.',
} as const;

/** Settings › Security's one line on the approvals topology, by boxes and marker. `{file}` is the wire's file name. */
export const APPROVALS_TOPOLOGY_TEXT = {
  title: 'Approvals',
  purpose: 'Where approval rulings are minted and signed, and what the single-box opt-in does here.',
  two: {
    absent: 'The server and the sessions run on two boxes, so approval rulings are minted and signed on the server box, '
      + "out of the sessions' reach.",
    present: 'The server and the sessions run on two boxes, so approval rulings are minted and signed on the server box, '
      + "out of the sessions' reach. ~/.ccrc/{file} is present on the server box, but it changes nothing on two boxes.",
  },
  one: {
    present: 'This server shares one box with the sessions, and ~/.ccrc/{file} opts in: approval rulings are minted and '
      + 'signed here, though on one box the signature cannot separate the server from the sessions. Remove it at a '
      + 'terminal on this box to stop.',
    absent: 'This server shares one box with the sessions, so it mints and signs no approval rulings: on one box the '
      + 'signature could not separate it from the sessions. Placing ~/.ccrc/{file} on this box at a terminal opts in.',
  },
  unread: 'The approvals topology could not be read.',
} as const satisfies { two: Record<ApprovalsTopologyWire['marker'], string>; one: Record<ApprovalsTopologyWire['marker'], string> } & Record<string, unknown>;

/** The line for one topology answer. */
export function approvalsTopologyLine(a: ApprovalsTopologyWire): string {
  return APPROVALS_TOPOLOGY_TEXT[a.boxes][a.marker].replace('{file}', a.file);
}

/** The overrides that stand, in the answer's order, and how many could not be read. */
export function overridesInForce(rows: readonly OverrideReading[]): { readonly set: readonly OverrideSwitchName[]; readonly unmeasured: number } {
  const isState = (s: MarkerState) => (r: OverrideReading): boolean => r.state === s;
  return { set: rows.filter(isState('set')).map((r) => r.name), unmeasured: rows.filter(isState('unmeasurable')).length };
}
