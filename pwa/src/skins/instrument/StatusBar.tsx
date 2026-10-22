// Instrument's status bar (W2 Task S9, D-5472), inside the frame's `<footer>`, which is not a live region: the agent
// link (`agentLink` over the one health poll), the fleet's one count readout (`fleetSummary`, the readout every shell
// renders; this file counts nothing itself), and two keys, ⌘K (the palette) and ? (the shortcut sheet), each a door
// to its registry command. 24px tall only under a fine pointer; on any other pointer it and its keys are `--tap-min`
// (instrument.css). The integrity readout joins it in S16.
import type { ReactNode } from 'react';
import { Icon, Keycap, StatusDot } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { agentLink } from '../../fleet/agentLink';
import { useFleetChrome } from '../../fleet/FleetChrome';
import { fleetSummary } from '../../fleet/fleetSummary';
import { UpdateIndicator } from '../../fleet/UpdateIndicator';
import { useFleetStore } from '../../stores/fleet';

export function StatusBar(): ReactNode {
  const { health } = useFleetChrome();
  const sessions = useFleetStore((s) => s.sessions);
  const runs = useFleetStore((s) => (s.runsFrameSeen ? s.runs : null));
  const link = agentLink(health);
  return (
    <div className="ins-status">
      <span className="ins-status-link">
        <span aria-hidden="true"><StatusDot status={link.dot} /></span>
        {link.word}
      </span>
      <span className="ins-status-summary">{fleetSummary(sessions, runs).readout}</span>
      <UpdateIndicator form="status" />
      <span className="ins-status-keys">
        <Keycap className="ins-status-key" aria-label="Open the command palette" {...commandDoor('open-palette')}>
          <Icon name="command" size={16} />K
        </Keycap>
        <Keycap className="ins-status-key" aria-label="Show shortcuts" {...commandDoor('show-shortcuts')}>?</Keycap>
      </span>
    </div>
  );
}
