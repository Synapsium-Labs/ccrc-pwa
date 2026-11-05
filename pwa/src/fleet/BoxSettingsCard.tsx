// The Box settings card's body (box settings view, spec 2026-10-25 §2.5; D-6917): one block per node, in the order of
// the nodes card, each saying what the BOX reported about its own settings. Read-only: it renders no control, and it
// holds no state and no poll of its own. `UpdatesSection` hands it the nodes of the one `/api/updates` poll it already
// holds, so a second poll of the same route is not possible from here (nothing imported below can issue one).
// Every word comes from `boxSettingsWords.ts`, and the field's one reader (`boxSettingsOf`) has already refused a
// wrong shape, so a bad node says so in its own block and blanks nothing else. It reads no clock: the age it shows is the
// server's (`ageS`, worked out with the request's clock), so a device whose clock is off never changes what a block says.
import type { ReactNode } from 'react';
import type { BoxSettingsRead, NodeWire } from '../../../shared/api';
import {
  BOX_SETTINGS_READ_TEXT, BOX_SETTINGS_TEXT, ageLine, backupsLine, boxSettingsOf, diskLine, familyGroups, familyLine, settingLine,
} from './boxSettingsWords';
import { SETTINGS_AMBER_NOTE } from './settingsText';
import './fleet.css';

/** The danger tone's class. Its ink is `--status-dead-text`, the red the page's other refusals already use. */
const DANGER = 'box-settings-danger';

function Readout({ read, role }: { read: Extract<BoxSettingsRead, { state: 'ok' }>; role: NodeWire['role'] }): ReactNode {
  const age = ageLine(read);
  const backups = backupsLine(read.doc.backups);
  const disk = diskLine(read.doc.disk);
  return (
    <>
      <p className={age.warn ? SETTINGS_AMBER_NOTE : 'settings-note'}>{age.text}</p>
      {familyGroups(read.doc.settings, role).map((g) => (g.used ? (
        <details key={g.family} className="settings-release-fold box-settings-family" data-family={g.family} open={g.refused + g.unmeasured > 0 || g.family === 'other'}>
          <summary><span>{familyLine(g)}</span></summary>
          <dl className="box-settings-rows">
            {g.rows.map((row) => {
              const line = settingLine(row, role);
              return (
                <div key={row.key} className="box-settings-row">
                  <dt className="box-settings-key">{line.key}</dt>
                  <dd className="box-settings-value">
                    <span>{line.value}</span>
                    {line.from !== null && <span className="settings-note">{line.from}</span>}
                    {line.mark !== null && <span className="settings-note">{line.mark}</span>}
                  </dd>
                  {line.why !== null && <dd className={`box-settings-why ${DANGER}`}>{line.why}</dd>}
                </div>
              );
            })}
          </dl>
        </details>
      ) : (
        <p key={g.family} className="box-settings-line settings-note">{familyLine(g)}</p>
      )))}
      <p className={backups.danger ? `box-settings-line ${DANGER}` : 'box-settings-line'}>{backups.text}</p>
      <p className={disk.danger ? `box-settings-line ${DANGER}` : 'box-settings-line'}>{disk.text}</p>
    </>
  );
}

function NodeBlock({ node }: { node: NodeWire }): ReactNode {
  const read = boxSettingsOf(node);
  const headId = `box-settings-${node.nodeId}`;
  return (
    <div role="group" aria-labelledby={headId} className="box-settings-node">
      <h4 id={headId} className="box-settings-head">
        <span className="settings-node-label">{node.label}</span>
        {/* The space keeps the group's accessible name two words ("fleet reported by the box"), not one run. */}
        {' '}
        <span className="settings-node-detail">{BOX_SETTINGS_TEXT.reportedBy}</span>
      </h4>
      {typeof read === 'string' ? (
        <p className="settings-note">{BOX_SETTINGS_READ_TEXT[read]}</p>
      ) : read.state === 'ok' ? (
        <Readout read={read} role={node.role} />
      ) : (
        <p className="settings-note">{BOX_SETTINGS_READ_TEXT[read.state]}</p>
      )}
    </div>
  );
}

export function BoxSettingsCard({ nodes }: { nodes: readonly NodeWire[] }): ReactNode {
  return (
    <>
      {nodes.map((n) => <NodeBlock key={n.nodeId} node={n} />)}
      <p className="settings-note">{BOX_SETTINGS_TEXT.how}</p>
    </>
  );
}
