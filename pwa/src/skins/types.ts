// What a skin supplies (D-5469, W2 Task S2b; spec §5.2 as D-5466 amends it).
//
// A skin is a set of PARTS that one shared frame places, never a shell of its own: two shell components are two
// element types, and React unmounts every child of an element whose type changes, the route ladder included, which
// would lose the composer's text, every open sheet and the terminal's socket on a switch (spec §5.4). So the frame
// (`frame.tsx`) is shared and keyed, and a set only says which component fills each keyed slot.
//
// A part takes no props: it reads what it shows from the shared stores, hooks and models, so a part can never be
// handed a value the other skin computes differently. A part that is `null` leaves its slot empty.
import type { ComponentType } from 'react';
import type { SkinId } from '@ccrc/ui';

export type Part = ComponentType | null;

export interface SkinSet {
  readonly id: SkinId;
  /** The frame's skin class (`ref-frame`, `ins-frame`): the hook the skin's own stylesheet lays the grid out on. */
  readonly frameClass: string;
  /** The bar across the top on a desk, inside the frame's `<header>`. */
  readonly Bar: Part;
  /** Instrument's icon rail, its own keyed grid item beside the list column, inside a `<nav>`. */
  readonly Rail: Part;
  /** The fleet column: the list beside the detail on a desk, the whole page on a phone's fleet route. */
  readonly Nav: Part;
  /** The fleet list a `Nav` places (S6, S10). */
  readonly FleetList: Part;
  /** A session's chrome around the shared transcript and composer (S7c, S12), reached through `useSkinSet()`. */
  readonly SessionChrome: Part;
  /** One transcript row's shell (S13b, S14), reached through `useSkinSet()`. */
  readonly TranscriptRow: Part;
  /** The inspector, inside the frame's `<aside aria-label="Inspector">` (S8, S12). */
  readonly Inspector: Part;
  /** The status bar, inside the frame's `<footer>` (S9). */
  readonly StatusBar: Part;
  /** A phone's bottom navigation, inside a `<nav>` (S11). */
  readonly PhoneNav: Part;
  /** Data, not logic: `ChatList` applies the shared `groupToolRun` when this says so (S13b). */
  readonly transcriptGrouping: 'tool-runs' | 'none';
}
