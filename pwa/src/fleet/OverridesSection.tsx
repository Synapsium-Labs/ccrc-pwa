// D-8382 (#1442): Settings › Automation › Overrides in force, after Stall watch. Read only: every emergency override that
// stands on the fleet box, what it does, what its absence means and how to lift it at a terminal. The rows are the
// switchboard's own (`overrideSwitchNames`): the server says which stand (`GET /api/fleet/overrides`, read through
// `useOverridesView`), and every line comes from the switchboard row (`overrideLines`), so no override is named here.
// No control, on purpose: each override is placed and lifted at a terminal, and the card says how.
//
// The conventions are the Automation cards': NOT AVAILABLE WINS (an older server's 404); a failed read keeps the last
// answer with the stale line; an override that could not be read is counted in its own amber line, never shown as lifted.
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import { OVERRIDES_TEXT, overridesInForce, type OverridesView } from '../../../shared/overrides';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS } from './settingsText';
import { overrideLines, overridesUnmeasuredLine } from './overridesWords';
import { useOverridesView } from './useOverridesView';

export function OverridesSection({ pollMs }: { pollMs?: number }): ReactNode {
  const { view, failure } = useOverridesView(pollMs);
  const card = SETTINGS_CARDS.automation.overrides;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className={SETTINGS_NOW_CLASS.note}>{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <OverridesBody view={view} stale={failure !== null} />
      ) : failure !== null ? (
        <p className={SETTINGS_NOW_CLASS.note}>{OVERRIDES_TEXT.unread}</p>
      ) : (
        <Skeleton lines={2} />
      )}
    </Section>
  );
}

function OverridesBody({ view, stale }: { view: OverridesView; stale: boolean }): ReactNode {
  const { set, unmeasured } = overridesInForce(view.overrides);
  const unmeasuredLine = overridesUnmeasuredLine(unmeasured);
  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{OVERRIDES_TEXT.stale}</p>}
      {set.length === 0 && unmeasured === 0 && <p className={SETTINGS_NOW_CLASS.note}>{OVERRIDES_TEXT.none}</p>}
      {set.length > 0 && (
        // Inline layout with no colour, the box-token card's rule (D-5614): no stylesheet changes for a list.
        <ul data-overrides="" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-3)' }}>
          {set.map((name) => {
            const l = overrideLines(name);
            return (
              <li key={name} data-override={name} style={{ display: 'grid', gap: 'var(--sp-1)', minWidth: 0 }}>
                <p className={SETTINGS_NOW_CLASS.warn}><code style={{ overflowWrap: 'anywhere' }}>{l.name}</code></p>
                <p className={SETTINGS_NOW_CLASS.note}>{l.does}</p>
                <p className={SETTINGS_NOW_CLASS.note}>{l.without}</p>
                <p className={SETTINGS_NOW_CLASS.note}>{l.remedy}</p>
              </li>
            );
          })}
        </ul>
      )}
      {unmeasuredLine !== null && <p className={SETTINGS_AMBER_NOTE}>{unmeasuredLine}</p>}
    </>
  );
}
