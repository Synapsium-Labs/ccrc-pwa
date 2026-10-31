// The session header's Inspector toggle (desktop polish T3e, D-6385): the door to `toggle-inspector`.
//
// It is built with `commandDoor`, never a handler of its own, so a tap, the palette and `i` run one command with one
// context. It is MOUNTED only while a part publishes an inspector target (`InspectorRail`: >=1600 on a session route),
// shown or hidden, and never hidden by CSS: below 1600 and in a skin that places no inspector there is no toggle to
// find. Its name is "Inspector" in both states; `aria-expanded` says which, `aria-controls` names the aside, and the
// `title` says what a tap does. It wears the header's other keycaps (glyph at 44px, the word from 900), so it sits
// beside them. Refined's header places it; Instrument places none until S12, which reuses this command and choice.
import type { ReactNode } from 'react';
import { Icon, Keycap } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { INSPECTOR_ID } from '../skins/frame';
import { useInspectorCommandTarget } from './inspectorShown';

export function InspectorToggle(): ReactNode {
  const target = useInspectorCommandTarget();
  if (target === null) return null;
  return (
    <Keycap
      className="keycap--inspector"
      aria-label="Inspector"
      aria-expanded={target.shown}
      aria-controls={INSPECTOR_ID}
      aria-keyshortcuts="i"
      title={target.shown ? 'Hide the inspector' : 'Show the inspector'}
      {...commandDoor('toggle-inspector')}
    >
      <span aria-hidden="true"><Icon name={target.shown ? 'panel-right-close' : 'panel-right-open'} /></span>
      <span className="keycap-word" aria-hidden="true">Inspector</span>
    </Keycap>
  );
}
