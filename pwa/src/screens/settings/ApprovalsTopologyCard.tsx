// D-8382 (#1442): Settings › Security › Approvals, the section's last card: one read-only line on the approvals topology,
// where approval rulings are minted and signed, and what the single-box opt-in (`~/.ccrc/approvals-single-box` on the
// server box) does here, present or absent. It reads `GET /api/fleet/overrides`'s `approvals` (the server's
// `approvalsTopologyOf`, whose answer is the ruling gate's own), and the file's name comes off the wire. No control: the
// opt-in is placed and removed at a terminal on the server box, and the line says so.
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import { APPROVALS_TOPOLOGY_TEXT, approvalsTopologyLine } from '../../../../shared/overrides';
import { COLLECT_SECTION_TEXT } from '../../fleet/collectLaneWords';
import { SETTINGS_CARDS, SETTINGS_NOW_CLASS } from '../../fleet/settingsText';
import { useOverridesView } from '../../fleet/useOverridesView';

export function ApprovalsTopologyCard({ pollMs }: { pollMs?: number }): ReactNode {
  const { view, failure } = useOverridesView(pollMs);
  const card = SETTINGS_CARDS.security.approvals;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className={SETTINGS_NOW_CLASS.note}>{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <p className={SETTINGS_NOW_CLASS.note} data-approvals={`${view.approvals.boxes}-${view.approvals.marker}`}>
          {approvalsTopologyLine(view.approvals)}
        </p>
      ) : failure !== null ? (
        <p className={SETTINGS_NOW_CLASS.note}>{APPROVALS_TOPOLOGY_TEXT.unread}</p>
      ) : (
        <Skeleton lines={1} />
      )}
    </Section>
  );
}
