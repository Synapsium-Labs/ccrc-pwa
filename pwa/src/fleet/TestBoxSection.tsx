// Test box plan TB10 (D-7412; spec 2026-10-28 §2.7 "The card"): Settings › Automation › Test box, the section's last
// card (D-7418). Its read is the Settings frame's (`SettingsDataProvider`, `useTestboxView`), handed in as `poll`; it
// writes two doors, `POST /api/testbox/switch` (`{on}` and nothing else) and `POST /api/testbox/tools-sync` (no body).
//
// TWO FIELDS, NEVER FOLDED (D-7444). The switch's position is the block's `switch` field, never the tap: a write is
// answered `requested`, and the re-read block says where the switch is. The state, with its reasons, is drawn whether
// the switch is on or off, so a healthy box reads `ok` before anyone arms it.
//
// THE THREE WIDTHS (spec §2.7's table; D-7566). The band is read once, from the desk query (`useDesk`) and the wide
// query below, and set on the card as `data-band`; the stylesheet lays each band out (`settings.css`):
//   * phone: one column; the switch and the state on top, Bring tools up to date full-width, a two-row summary (runs,
//     queue), and the versions, the 24-hour counts, the pristine installs and the failed keys behind one disclosure;
//   * laptop: the switch and the state on one line with the button at the state line's end, a three-cell row (runs,
//     queue, fallbacks), the versions table open under it, the rest behind the disclosure;
//   * wide: the same, with the versions table and the pristine-installs table open side by side.
// Every table is one shape (`TestboxTable`), so the four are one block written once.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, RadioFieldset, Section, Skeleton, elapsedWords, useDesk, useMediaQuery, useNow } from '@ccrc/ui';
import {
  TESTBOX_FALLBACK, TESTBOX_TOOLS, versionCellsDiffer, type StatusAnswer, type TestboxTool, type TestboxToolVersions,
} from '../../../shared/testbox';
import { ApiError, api, apiErrorText } from '../lib/api';
import { isRecord } from '../lib/wire';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, UNCONFIRMED_TEXT, useResultLine } from './settingsText';
import type { TestboxBlock, TestboxPoll } from './useTestboxView';

/** The wide band's query: the width at which the shell's other wide layouts start (`tokens.css`'s 1600). */
export const TESTBOX_WIDE_QUERY = '(min-width: 1600px)';

export type TestboxBand = 'phone' | 'laptop' | 'wide';

/** The card's words. The wire's values do not change; only these words do. */
export const TESTBOX_TEXT = {
  legend: 'Remote runs',
  on: 'On',
  off: 'Off',
  switchNote: 'When on, ccrc test sends each run it can to the test box, and runs it here whenever the box cannot take it.',
  switchUnknown: 'The server could not read the switch, so neither position is checked.',
  state: (summary: string) => `State: ${summary}`,
  lastAnswer: (ago: string) => `Last answer ${ago} ago`,
  service: (version: string, proto: number) => `Service ${version}, protocol ${proto}`,
  sync: 'Bring tools up to date',
  syncing: (tool: string) => `syncing ${tool}`,
  syncingAll: 'tools',
  lastSync: (at: string, result: string) => `Last sync ${at}: ${result}`,
  noSync: 'No tool sync has run yet.',
  syncDone: 'done',
  syncRunning: 'running',
  syncFailed: (detail: string | null) => (detail === null ? 'failed' : `failed (${detail})`),
  syncSent: 'The sync was sent to the test box.',
  syncNotSent: (outcome: string, detail: string | null) => `Not sent: ${outcome}${detail === null ? '' : ` (${detail})`}`,
  runs: (n: number, limit: number) => `${n} of ${limit}`,
  runsLabel: 'Runs',
  queueLabel: 'Queue',
  queue: (n: number) => `${n} waiting`,
  fallbacksLabel: 'Fallbacks, 24 h',
  details: 'Versions, counts and installs',
  more: 'Counts and installs',
  versions: 'Versions',
  tool: 'Tool',
  host: 'Fleet host',
  box: 'Test box',
  release: 'release',
  differs: 'differs',
  unmeasured: 'unmeasured',
  counts: 'Last 24 hours',
  reason: 'Reason',
  count: 'Count',
  remote: 'ran on the test box',
  refused: 'refused',
  unreadable: 'unreadable lines',
  countsUnread: 'The runs log could not be read.',
  pristine: 'Pristine installs',
  repository: 'Repository',
  package: 'Package',
  installs: 'Installs',
  nonePristine: 'No pristine installs yet.',
  failed: 'Failed pristine keys',
  key: 'Key',
  exit: 'Exit',
  attempts: 'Attempts',
  next: 'Next attempt',
  unread: 'The test box status could not be read.',
  stale: 'The latest read failed; this is the last status that landed.',
  unpolled: 'The server has not checked the test box yet.',
  unanswered: 'No answer from the server',
} as const;

const T = TESTBOX_TEXT;

/** A UTC stamp to the minute, as the card prints the box's times. */
const utcMinute = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** A fallback reason in the card's words: the printed reason without its `test box:` lead, its holes shown as `…`. */
export function fallbackLabel(text: string): string {
  return text.replace(/^test box: /, '').replace(/ \([^)]*<[^)]*\)$/, '').replace(/<[^>]*>/g, '…');
}

/** The tools whose two cells differ, through the shared rule; an unmeasured fleet host value differs. */
export function differingTools(host: TestboxBlock['host'], box: StatusAnswer): ReadonlySet<TestboxTool> {
  if (host === null) return new Set(TESTBOX_TOOLS);
  const fleet = Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, host.tools[t] ?? ''])) as TestboxToolVersions;
  return new Set(versionCellsDiffer(fleet, box.tools));
}

/** Whether **Bring tools up to date** is shown: a tool or the release differs, the last sync failed, or one runs. */
export function syncShown(block: TestboxBlock): boolean {
  const box = block.box;
  if (box === null) return false;
  if (box.sync.state !== 'idle') return true;
  return differingTools(block.host, box).size > 0 || block.host?.release !== box.release;
}

function useBand(): TestboxBand {
  const desk = useDesk();
  const wide = useMediaQuery(TESTBOX_WIDE_QUERY);
  return !desk ? 'phone' : wide ? 'wide' : 'laptop';
}

export function TestBoxSection({ poll }: { poll: TestboxPoll }): ReactNode {
  const { view, failure } = poll;
  const card = SETTINGS_CARDS.automation.testbox;
  const band = useBand();
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-band={band} className="testbox-card">
      {failure === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null && view.block !== null ? (
        <TestboxBody block={view.block} stale={failure !== null} poll={poll} band={band} />
      ) : view !== null ? (
        <p className="settings-note">{T.unpolled}</p>
      ) : failure !== null ? (
        <p className="settings-note">{T.unread}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </Section>
  );
}

/** A refusal's words: the server's detail, else the client's one reading of the error (`apiErrorText`). */
function refusalText(err: unknown): string {
  if (!(err instanceof ApiError)) return T.unanswered;
  const body = isRecord(err.body) ? err.body : {};
  const detail = typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : null;
  return detail ?? apiErrorText(err);
}

function TestboxBody({ block, stale, poll, band }: { block: TestboxBlock; stale: boolean; poll: TestboxPoll; band: TestboxBand }): ReactNode {
  const now = useNow(30_000);
  const [switching, setSwitching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const switchLine = useResultLine();
  const syncLine = useResultLine();
  const box = block.box;

  const flip = (on: boolean): void => {
    if (switching) return;
    setSwitching(true);
    switchLine.clear();
    void api.setTestboxSwitch(on)
      .then(
        (answer) => { if (answer === 'unreadable') switchLine.say(UNCONFIRMED_TEXT); },
        (err: unknown) => { switchLine.say(refusalText(err), 'refusal'); },
      )
      .finally(() => { setSwitching(false); poll.reload(); });
  };

  const sync = (): void => {
    if (syncing) return;
    setSyncing(true);
    syncLine.clear();
    void api.testboxToolsSync()
      .then(
        (answer) => {
          if (answer === 'unreadable') { syncLine.say(UNCONFIRMED_TEXT); return; }
          if (answer.ok) { syncLine.say(T.syncSent); return; }
          const outcome = typeof answer.outcome === 'string' ? answer.outcome : T.unanswered;
          syncLine.say(T.syncNotSent(outcome, typeof answer.detail === 'string' ? answer.detail : null), 'refusal');
        },
        (err: unknown) => { syncLine.say(refusalText(err), 'refusal'); },
      )
      .finally(() => { setSyncing(false); poll.reload(); });
  };

  const running = syncing || box?.sync.state === 'syncing';
  const shown = syncShown(block) || syncing;
  const label = running ? T.syncing(box?.sync.state === 'syncing' && box.sync.detail !== null ? box.sync.detail : T.syncingAll) : T.sync;

  const fallbacks = block.counts === null ? null : block.counts.fallback + block.counts.refused;
  const cells = box === null ? [] : [
    { name: T.runsLabel, value: T.runs(box.runs.inProgress, box.runs.limit), cell: 'runs' },
    { name: T.queueLabel, value: T.queue(box.queueDepth), cell: 'queue' },
    ...(band === 'phone' ? [] : [{ name: T.fallbacksLabel, value: fallbacks === null ? T.unmeasured : String(fallbacks), cell: 'fallbacks' }]),
  ];

  const versions = box === null ? null : <VersionsTable block={block} box={box} />;
  const pristine = box === null ? null : <PristineTable box={box} />;
  const rest = (
    <>
      <CountsTable block={block} />
      {box !== null && box.failedKeys.length > 0 && <FailedKeysTable box={box} />}
    </>
  );

  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
      <div className="testbox-head" data-testbox="head">
        <div className="testbox-switch" data-testbox="switch">
          <RadioFieldset<'on' | 'off'>
            legend={T.legend}
            name="settings-testbox-switch"
            value={block.switch === 'unknown' ? null : block.switch}
            disabled={switching}
            onPick={(v) => flip(v === 'on')}
            options={[{ value: 'on', label: T.on }, { value: 'off', label: T.off }]}
          />
          <p className="settings-note">{T.switchNote}</p>
          {block.switch === 'unknown' && <p className={SETTINGS_AMBER_NOTE}>{T.switchUnknown}</p>}
          <ResultLine line={switchLine.line} />
        </div>
        <div className="testbox-state-line" data-testbox="state-line">
          <p className="testbox-state" data-testbox="state" data-state={block.state}>{T.state(block.summary)}</p>
          {shown && (
            <Button
              variant="ghost"
              size={band === 'phone' ? 'full' : 'fit'}
              className="flex-none"
              disabled={running}
              onClick={sync}
              data-testbox="sync"
            >
              {label}
            </Button>
          )}
        </div>
      </div>
      {shown && (
        <p className="settings-note" data-testbox="last-sync">
          {box === null || box.sync.at === null
            ? T.noSync
            : T.lastSync(utcMinute(box.sync.at),
              box.sync.state === 'failed' ? T.syncFailed(box.sync.detail) : box.sync.state === 'syncing' ? T.syncRunning : T.syncDone)}
        </p>
      )}
      <ResultLine line={syncLine.line} />
      <p className="settings-note" data-testbox="answer">
        {T.lastAnswer(elapsedWords(now - block.at))}
        {box !== null && <>{' · '}{T.service(box.serviceVersion, box.proto)}</>}
      </p>
      {cells.length > 0 && (
        <dl className="testbox-cells" data-testbox="cells">
          {cells.map((c) => (
            <div key={c.cell} data-cell={c.cell}>
              <dt className="settings-note">{c.name}</dt>
              <dd className="testbox-cell-value">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {band === 'phone' ? (
        <TestboxFold summary={T.details}>{versions}{rest}{pristine}</TestboxFold>
      ) : (
        <>
          <div className={band === 'wide' ? 'testbox-tables testbox-tables--side' : 'testbox-tables'} data-testbox="open">
            {versions}
            {band === 'wide' && pristine}
          </div>
          <TestboxFold summary={T.more}>{rest}{band === 'wide' ? null : pristine}</TestboxFold>
        </>
      )}
    </>
  );
}

/** The card's one disclosure: the release row's fold (`.settings-release-fold`), shut until it is opened. */
function TestboxFold({ summary, children }: { summary: string; children: ReactNode }): ReactNode {
  return (
    <details className="settings-release-fold testbox-fold" data-testbox="disclosure">
      <summary className="settings-note">{summary}</summary>
      <div className="testbox-tables">{children}</div>
    </details>
  );
}

/** The one table shape: a caption, a head row and body rows of cells, each cell optionally marked. */
function TestboxTable({ name, caption, head, rows }: {
  name: string; caption: string; head: readonly string[];
  rows: readonly { key: string; cells: readonly { text: string; marked?: boolean }[] }[];
}): ReactNode {
  return (
    <table className="testbox-table" data-table={name}>
      <caption className="settings-note">{caption}</caption>
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            {r.cells.map((c, i) => (
              <td key={i} data-differs={c.marked === true ? 'true' : undefined} className={c.marked === true ? 'settings-catalogue--amber' : undefined}>
                {c.text}{c.marked === true && <span className="testbox-mark">{` (${T.differs})`}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VersionsTable({ block, box }: { block: TestboxBlock; box: StatusAnswer }): ReactNode {
  const differ = differingTools(block.host, box);
  const hostRelease = block.host?.release ?? null;
  const rows = [
    ...TESTBOX_TOOLS.map((t) => ({
      key: t,
      cells: [{ text: t }, { text: block.host?.tools[t] ?? T.unmeasured }, { text: box.tools[t], marked: differ.has(t) }],
    })),
    { key: 'release', cells: [{ text: T.release }, { text: hostRelease ?? T.unmeasured }, { text: box.release, marked: hostRelease !== box.release }] },
  ];
  return <TestboxTable name="versions" caption={T.versions} head={[T.tool, T.host, T.box]} rows={rows} />;
}

function CountsTable({ block }: { block: TestboxBlock }): ReactNode {
  const c = block.counts;
  if (c === null) return <p className={SETTINGS_AMBER_NOTE}>{T.countsUnread}</p>;
  const rows = [
    { key: 'remote', cells: [{ text: T.remote }, { text: String(c.remote) }] },
    ...TESTBOX_FALLBACK.filter((r) => (c.byReason[r.id] ?? 0) > 0)
      .map((r) => ({ key: r.id, cells: [{ text: fallbackLabel(r.text) }, { text: String(c.byReason[r.id]) }] })),
    ...(c.refused > 0 ? [{ key: 'refused', cells: [{ text: T.refused }, { text: String(c.refused) }] }] : []),
    ...(c.unreadable > 0 ? [{ key: 'unreadable', cells: [{ text: T.unreadable }, { text: String(c.unreadable) }] }] : []),
  ];
  return <TestboxTable name="counts" caption={T.counts} head={[T.reason, T.count]} rows={rows} />;
}

function PristineTable({ box }: { box: StatusAnswer }): ReactNode {
  if (box.pristine.length === 0) return <p className="settings-note" data-table="pristine">{T.nonePristine}</p>;
  const per = new Map<string, { repository: string; package: string; n: number }>();
  for (const p of box.pristine) {
    const k = `${p.repository}\u0000${p.package}`;
    const row = per.get(k) ?? { repository: p.repository, package: p.package, n: 0 };
    row.n += 1;
    per.set(k, row);
  }
  const rows = [...per.entries()].map(([k, r]) => ({ key: k, cells: [{ text: r.repository }, { text: r.package }, { text: String(r.n) }] }));
  return <TestboxTable name="pristine" caption={T.pristine} head={[T.repository, T.package, T.installs]} rows={rows} />;
}

function FailedKeysTable({ box }: { box: StatusAnswer }): ReactNode {
  const rows = box.failedKeys.map((k) => ({
    key: `${k.repository}\u0000${k.package}\u0000${k.key}`,
    cells: [{ text: k.package }, { text: k.key.slice(0, 12) }, { text: String(k.exit) }, { text: String(k.attempts) }, { text: utcMinute(k.nextAttempt) }],
  }));
  return <TestboxTable name="failed" caption={T.failed} head={[T.package, T.key, T.exit, T.attempts, T.next]} rows={rows} />;
}
