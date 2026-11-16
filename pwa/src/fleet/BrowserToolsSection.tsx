// D-8121: Settings › Automation › Browser tools. Read-only: the box default and the server list are the fleet box's own
// settings (`CCRC_BROWSER_MCP_DEFAULT`, `CCRC_BROWSER_MCP_SERVERS` in its ccrc.env), read off the one `/api/updates`
// poll the frame already holds (`browserBoxOf`), and the count is the fleet frame's (`browserFleetCount`). A session's
// own choice is its menu's Browser tools sheet. The rows are the Box settings card's (`box-settings-*`: one column,
// every cell `overflow-wrap: anywhere`), so a long server name wraps at phone width instead of widening the page. The
// words are `browserMcpWords.ts`'; this file spells none of them.
import type { ReactNode } from 'react';
import { Button, Section, Skeleton } from '@ccrc/ui';
import type { NodeWire } from '../../../shared/api';
import { useFleetStore } from '../stores/fleet';
import {
  BROWSER_DEFAULT_SERVERS, BROWSER_TEXT, browserBoxOf, browserCountLine, browserFleetCount,
} from './browserMcpWords';
import { PANE_SCOPE_STOP_ANCHOR } from './paneScopeStopWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_WHEN } from './settingsText';
import './fleet.css';

export function BrowserToolsSection({ nodes, store = useFleetStore }: {
  /** The nodes of the frame's one updates poll; null before its first answer. */
  nodes: readonly NodeWire[] | null; store?: typeof useFleetStore;
}): ReactNode {
  const sessions = store((s) => s.sessions);
  const card = SETTINGS_CARDS.automation.browser;
  const box = nodes === null ? null : browserBoxOf(nodes);
  const count = browserFleetCount(sessions, box?.default ?? null);
  const toStopLeftovers = (): void => {
    document.getElementById(PANE_SCOPE_STOP_ANCHOR)?.scrollIntoView({ block: 'start' });
  };
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <dl className="box-settings-rows">
        <div className="box-settings-row">
          <dt className="box-settings-key">{BROWSER_TEXT.defaultLegend}</dt>
          <dd className="box-settings-value" data-browser-default={box?.default ?? ''}>
            {box === null ? <Skeleton lines={1} />
              : box.default === null ? <span className={SETTINGS_AMBER_NOTE}>{BROWSER_TEXT.defaultUnknown}</span>
                : <span className="settings-note">{box.default === 'on' ? BROWSER_TEXT.defaultOn : BROWSER_TEXT.defaultOff}</span>}
          </dd>
        </div>
        <div className="box-settings-row">
          <dt className="box-settings-key">{BROWSER_TEXT.serversLegend}</dt>
          {box?.servers === 'custom' ? (
            <dd className="box-settings-value"><span className="settings-note">{BROWSER_TEXT.serversCustom}</span></dd>
          ) : BROWSER_DEFAULT_SERVERS.map((n) => <dd key={n} className="box-settings-value"><span>{n}</span></dd>)}
        </div>
        <div className="box-settings-row">
          <dt className="box-settings-key">{BROWSER_TEXT.countLegend}</dt>
          <dd className="box-settings-value" data-browser-count=""><span className="settings-note">{browserCountLine(count)}</span></dd>
        </div>
      </dl>
      <p className={SETTINGS_WHEN}>{BROWSER_TEXT.setting}</p>
      <p className={SETTINGS_WHEN}>{BROWSER_TEXT.perSession}</p>
      <p className={SETTINGS_WHEN}>{BROWSER_TEXT.parking}</p>
      <div>
        <Button variant="ghost" onClick={toStopLeftovers}>{BROWSER_TEXT.stopLeftovers}</Button>
      </div>
      <p className={SETTINGS_WHEN}>{BROWSER_TEXT.restartLimit}</p>
    </Section>
  );
}
