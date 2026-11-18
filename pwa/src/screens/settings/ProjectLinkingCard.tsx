// Settings › Security › Project linking (the linking standard, D-8147; plan Task 8). One row per project, from the
// `linking` cell of `GET /api/projects` (D-8405: one per project NAME, `linkingRowsOf`, though the route answers one row
// per checkout directory):
//   * Team key: a short field (uppercased as typed), Save; empty clears it. D-8405: a key the automatic pass linked says
//     so under the field, with its evidence; a project with no key shows the pass's candidates, each a one-tap Link that
//     saves its key as the operator's (the action sits on the row). The pass never writes over the operator's key.
//   * Visibility: the measured word and its age ("Private, read 3h ago", "Not read yet", "Couldn't read: offline"), and
//     the override select (Automatic, Private, Public), written the moment it changes.
//   * PR template: Present / Absent, and, for a private project with no template and a team key, "Open a template PR"
//     behind a `QuickConfirm` that names the repository and the file.
// THE ANSWER IS WHAT IS SHOWN. A write renders the row the server stored (`api.saveLinking`'s answer), and the template
// act shows the pull request's URL as a link. A refusal is its word's fixed sentence (`LINKING_REFUSAL_TEXT`); the box's
// own text never reaches the screen. A project whose cell is absent (an older server) draws nothing.
// Layout is `settings.css`'s `.linking-*` (a container query on the card, so the pane's width decides, not the window's).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, OptionRow, QuickConfirm, Section, Select, TextInput, TextLink, elapsedWords, useNow } from '@ccrc/ui';
import type { LinkingOverride, ProjectLinkingWire } from '../../../../shared/linking';
import { LINKING_TEMPLATE_PATH } from '../../../../shared/linking';
import type { ProjectRow } from '../../../../shared/api';
import type { HierarchyAnswer, HierarchyProjectRow } from '../../../../shared/plan';
import { ResultLine, SETTINGS_CARDS, inAppClick, useResultLine } from '../../fleet/settingsText';
import { itemPath } from '../../ledgers/ledgerWords';
import {
  HIERARCHY_TEXT, coordinatorWords, defaultHierarchyRow, defaultOwnerWords, hierarchyAbsent, hierarchyWriteText, inboundWords, namedOwnerWords, ownerForAllConsequence, ownerInheritedNote, sharesTeamKey, stateWords,
} from '../../fleet/hierarchyWords';
import { api } from '../../lib/api';
import { upkeepPath } from '../../lib/routes';
import { writeOutcomeUnknown } from '../../lib/apiError';
import { loadProjects } from '../../fleet/useProjectRows';
import { candidateLabel, candidateWhy, candidatesShown, linkingRowsOf, teamLinkLine } from '../../fleet/linkingWords';
import { linkingErrorText } from '../../lib/refusalWords';

/** The card's words. Short labels only; the sentences a refusal says are `LINKING_REFUSAL_TEXT`'s. */
export const LINKING_TEXT = {
  teamKey: 'Team key',
  save: 'Save',
  saved: 'Saved.',
  override: 'Visibility override',
  automatic: 'Automatic',
  private: 'Private',
  public: 'Public',
  internal: 'Internal',
  notRead: 'Not read yet',
  templatePresent: 'PR template: present',
  templateAbsent: 'PR template: absent',
  openTemplate: 'Open a template PR',
  openTemplateConfirm: 'Open pull request',
  openTemplateTitle: 'Open the template pull request?',
  templatePr: 'Template pull request',
  loading: 'Reading the projects…',
  none: 'There are no projects on this fleet.',
  unreadable: "The project list could not be read. Reload this page to try again.",
  noRows: 'This server does not report project linking yet.',
  candidates: 'Suggested teams',
} as const;

/** The consequence line of the confirm: the repository and the file, named. */
export const openTemplateConsequence = (slug: string): string =>
  `Adds ${LINKING_TEMPLATE_PATH} to ${slug} on a branch of its own and opens a pull request. Nothing is pushed to the default branch.`;

const WORD: Readonly<Record<'private' | 'public' | 'internal', string>> = {
  private: LINKING_TEXT.private, public: LINKING_TEXT.public, internal: LINKING_TEXT.internal,
};

/** The visibility line: what was measured, and when, or why it could not be. */
export function visibilityLine(m: ProjectLinkingWire['measured'], now: number): string {
  if (m.state === 'unmeasured') return LINKING_TEXT.notRead;
  if (m.state === 'failed') return `Couldn't read: ${m.reason.replace(/-/g, ' ')}`;
  return `${WORD[m.visibility]}, read ${elapsedWords(Math.max(0, now - m.at))} ago`;
}

const overrideOf = (v: string): LinkingOverride | null => (v === 'private' || v === 'public' ? v : null);

/** The template button's rule: a private project (measured or overridden), a template reading of `absent`, and a key. */
export const templateOffered = (l: ProjectLinkingWire): boolean =>
  l.mode === 'private' && l.teamKey !== null && l.measured.state === 'measured' && l.measured.template === 'absent';

/** The hierarchy cell of one row (D-8184): the Linear owner, the initiatives toggle, the owning-project toggle where the team
 *  key is shared, and the state. Every value shown, and every body written, is the hierarchy answer's row, the one source the
 *  server re-measures after each write (it clears `ownsTeam` on a sibling in the same transaction). Each control writes the
 *  moment it changes, the whole settings body at once. */
function HierarchyCell({ name, answer, reread, busy, locked, setBusy, raise, track, result }: {
  name: string; answer: HierarchyAnswer; reread: () => number; busy: boolean; locked: boolean; setBusy: (b: boolean) => void;
  raise: (seq: number) => void; track: (d: 1 | -1) => void; result: ReturnType<typeof useResultLine>;
}): ReactNode {
  const ownerId = useId();
  // A project the answer does not list is drawn at the server's defaults (`defaultHierarchyRow`), and a write sends them.
  const h = answer.projects.find((p) => p.project === name) ?? defaultHierarchyRow(name);
  const write = (patch: Partial<Pick<HierarchyProjectRow, 'initiatives' | 'linearOwner' | 'ownsTeam'>>): void => {
    setBusy(true);
    track(1);
    result.clear();
    void api.saveHierarchy(name, { initiatives: h.initiatives, linearOwner: h.linearOwner, ownsTeam: h.ownsTeam, ...patch })
      .then(
        // The row stays locked until a read at least as new as this write has LANDED (`locked`): the next write's body is this
        // row's answer, so it must be the new one. A failed re-read keeps the lock (the card offers a retry of the read).
        // A write can change other rows on the server (an owning-project write clears its siblings), so it raises the card's floor.
        () => { result.say(LINKING_TEXT.saved); raise(reread()); },
        (err: unknown) => {
          // A write whose result is unknown (no answer, or a 5xx that can follow a commit) may have landed: lock behind a read, as after a success.
          if (writeOutcomeUnknown(err)) raise(reread());
          result.say(hierarchyWriteText(err), 'refusal');
        },
      )
      .finally(() => { track(-1); setBusy(false); });
  };
  const inbound = inboundWords(h.inboundWaiting);
  const named = h.linearOwner;
  const inheritedNote = ownerInheritedNote(h);
  const known = answer.coordinators.some((c) => c.id === named);
  return (
    <div className="linking-cell linking-hier" data-linking-hier="">
      <div className="linking-cell linking-owner">
        <label htmlFor={ownerId} className="settings-note">{HIERARCHY_TEXT.owner}</label>
        <Select id={ownerId} value={named ?? ''} disabled={busy || locked} onChange={(e) => write({ linearOwner: e.target.value === '' ? null : e.target.value })}>
          <option value="">{defaultOwnerWords(h)}</option>
          {named !== null && !known && <option value={named}>{namedOwnerWords(h, named)}</option>}
          {answer.coordinators.map((c) => <option key={c.id} value={c.id}>{coordinatorWords(c)}</option>)}
        </Select>
        {inheritedNote !== null && <p className="settings-note">{inheritedNote}</p>}
      </div>
      <div className="linking-cell linking-toggles">
        <OptionRow label={HIERARCHY_TEXT.initiatives} checked={h.initiatives === 'on'} disabled={busy || locked}
          onClick={() => write({ initiatives: h.initiatives === 'on' ? 'off' : 'on' })} />
        {sharesTeamKey(name, answer.projects) && (
          <OptionRow label={HIERARCHY_TEXT.owning} checked={h.ownsTeam} disabled={busy || locked} onClick={() => write({ ownsTeam: !h.ownsTeam })} />
        )}
      </div>
      <div className="linking-cell linking-state" data-linking-state={h.state}>
        {h.state === 'map-waiting' && h.itemId !== null
          ? <TextLink href={itemPath(h.itemId)} onClick={inAppClick(itemPath(h.itemId))}>{HIERARCHY_TEXT.mapWaiting}</TextLink>
          : <p className="settings-note">{stateWords(h)}</p>}
        {inbound !== null && <p className="settings-note">{inbound}</p>}
        {h.teamKey !== null && <TextLink href={upkeepPath(name)} onClick={inAppClick(upkeepPath(name))}>{HIERARCHY_TEXT.upkeep}</TextLink>}
      </div>
    </div>
  );
}

function LinkingRow({ name, linking, now, onStored, answer, landed, floor, inflight, raise, track, reread }: {
  name: string; linking: ProjectLinkingWire; now: number; onStored: (project: string, linking: ProjectLinkingWire) => void;
  answer: HierarchyAnswer | null; landed: number; floor: number; inflight: number; raise: (seq: number) => void; track: (d: 1 | -1) => void; reread: () => number;
}): ReactNode {
  const keyId = useId();
  const overrideId = useId();
  const [draft, setDraft] = useState(linking.teamKey ?? '');
  const [busy, setBusy] = useState(false);
  // The seq of the re-read this row's last write needs: the hierarchy controls stay locked until a read that new has landed.
  const [need, setNeed] = useState(0);
  const [asking, setAsking] = useState(false);
  const [pr, setPr] = useState<string | null>(null);
  const result = useResultLine();

  // The stored row is what the field shows: a re-read (the answer of a write) puts the field back on it.
  useEffect(() => { setDraft(linking.teamKey ?? ''); }, [linking.teamKey]);

  const write = (body: { teamKey: string | null; override: LinkingOverride | null }): void => {
    setBusy(true);
    result.clear();
    void api.saveLinking(name, body)
      .then(
        (a) => { onStored(name, a.linking); setNeed(reread()); result.say(LINKING_TEXT.saved); },
        (err: unknown) => {
          if (writeOutcomeUnknown(err)) setNeed(reread());
          result.say(hierarchyWriteText(err), 'refusal');
        },
      )
      .finally(() => setBusy(false));
  };
  const saveKey = (): void => {
    const key = draft.trim().toUpperCase();
    write({ teamKey: key === '' ? null : key, override: linking.override });
  };
  const linkLine = teamLinkLine(linking);
  const candidates = candidatesShown(linking);
  const openTemplate = (): void => {
    setBusy(true);
    result.clear();
    void api.openTemplatePr(name)
      .then(
        (a) => { setPr(a.url); onStored(name, withTemplatePresent(linking)); },
        (err: unknown) => result.say(linkingErrorText(err), 'refusal'),
      )
      .finally(() => setBusy(false));
  };

  const slug = linking.measured.state === 'measured' ? linking.measured.slug : name;
  const template = linking.measured.state === 'measured' ? linking.measured.template : null;
  return (
    <li className="linking-row" data-linking-row={name}>
      <p className="linking-name">{name}</p>
      <div className="linking-cell linking-key">
        <label htmlFor={keyId} className="settings-note">{LINKING_TEXT.teamKey}</label>
        <div className="linking-key-line">
          <TextInput
            id={keyId}
            value={draft}
            maxLength={16}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
          />
          <Button variant="ghost" disabled={busy} onClick={saveKey}>{LINKING_TEXT.save}</Button>
        </div>
        {linkLine !== null && <p className="settings-note linking-auto" data-linking-auto="">{linkLine}</p>}
        {candidates.length > 0 && (
          <div className="linking-candidates" role="group" aria-label={LINKING_TEXT.candidates}>
            <p className="settings-note">{LINKING_TEXT.candidates}</p>
            {candidates.map((c) => (
              <div key={c.key} className="linking-candidate" data-linking-candidate={c.key}>
                <Button variant="ghost" disabled={busy} onClick={() => write({ teamKey: c.key, override: linking.override })}>
                  {candidateLabel(c)}
                </Button>
                <p className="settings-note">{candidateWhy(c)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="linking-cell linking-visibility">
        <p className="settings-note linking-measured">{visibilityLine(linking.measured, now)}</p>
        <label htmlFor={overrideId} className="settings-note">{LINKING_TEXT.override}</label>
        <Select
          id={overrideId}
          value={linking.override ?? ''}
          disabled={busy}
          onChange={(e) => write({ teamKey: linking.teamKey, override: overrideOf(e.target.value) })}
        >
          <option value="">{LINKING_TEXT.automatic}</option>
          <option value="private">{LINKING_TEXT.private}</option>
          <option value="public">{LINKING_TEXT.public}</option>
        </Select>
      </div>
      <div className="linking-cell linking-template">
        {template !== null && (
          <p className="settings-note">{template === 'present' ? LINKING_TEXT.templatePresent : LINKING_TEXT.templateAbsent}</p>
        )}
        {templateOffered(linking) && (
          <Button variant="ghost" disabled={busy} onClick={() => setAsking(true)}>{LINKING_TEXT.openTemplate}</Button>
        )}
        {pr !== null && <TextLink href={pr}>{LINKING_TEXT.templatePr}</TextLink>}
      </div>
      {answer !== null && <HierarchyCell name={name} answer={answer} reread={reread} busy={busy} locked={inflight > 0 || landed < Math.max(need, floor)} setBusy={setBusy} raise={raise} track={track} result={result} />}
      <div className="linking-result"><ResultLine line={result.line} /></div>
      <QuickConfirm
        open={asking}
        onClose={() => setAsking(false)}
        title={LINKING_TEXT.openTemplateTitle}
        consequence={openTemplateConsequence(slug)}
        confirmLabel={LINKING_TEXT.openTemplateConfirm}
        onConfirm={openTemplate}
      />
    </li>
  );
}

/** The stored reading after the template pull request opened: the template cell reads `present`, as the server writes it. */
function withTemplatePresent(l: ProjectLinkingWire): ProjectLinkingWire {
  return l.measured.state === 'measured' ? { ...l, measured: { ...l.measured, template: 'present' } } : l;
}

/** The card's one act on every project (D-8184): pick a coordinator, then confirm. The answer is read back, not assumed. */
function OwnerForAll({ answer, reread, setFloor, track }: { answer: HierarchyAnswer; reread: () => number; setFloor: (seq: number) => void; track: (d: 1 | -1) => void }): ReactNode {
  const pickId = useId();
  const [pick, setPick] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const result = useResultLine();
  const apply = (): void => {
    setBusy(true);
    track(1);
    result.clear();
    void api.ownerForAll(pick)
      // It wrote every row: every row stays locked until a read at least as new as this write has landed (the card's floor).
      .then(() => { result.say(HIERARCHY_TEXT.allDone); setFloor(reread()); }, (err: unknown) => {
        if (writeOutcomeUnknown(err)) setFloor(reread());
        result.say(hierarchyWriteText(err), 'refusal');
      })
      .finally(() => { track(-1); setBusy(false); });
  };
  return (
    <div className="linking-all" data-linking-all="">
      <label htmlFor={pickId} className="settings-note">{HIERARCHY_TEXT.allPick}</label>
      <Select id={pickId} value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
        <option value="">{HIERARCHY_TEXT.allNone}</option>
        {answer.coordinators.map((c) => <option key={c.id} value={c.id}>{coordinatorWords(c)}</option>)}
      </Select>
      <Button variant="ghost" disabled={busy || pick === ''} onClick={() => setAsking(true)}>{HIERARCHY_TEXT.allAct}</Button>
      <ResultLine line={result.line} />
      <QuickConfirm open={asking} onClose={() => setAsking(false)} title={HIERARCHY_TEXT.allTitle}
        consequence={ownerForAllConsequence(pick)} confirmLabel={HIERARCHY_TEXT.allConfirm} onConfirm={apply} />
    </div>
  );
}

/** One read of the project list, and the rows the cards draw from it. */
type Read = { kind: 'loading' } | { kind: 'failed' } | { kind: 'read'; rows: ProjectRow[] };

export function ProjectLinkingCard(): ReactNode {
  const card = SETTINGS_CARDS.security.linking;
  const now = useNow(30_000);
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  // The hierarchy answer (D-8184), four conditions apart: unread yet, an older server (the route is absent: 404, no hierarchy
  // controls and no note), a read that failed (said, with its fixed sentence) and the answer itself.
  // The note shows while a read that failed is newer than the last one that landed (`failedSeq > landed`): the last good answer
  // stays, a row that wrote stays locked behind a read, and the card says so and offers Read again.
  const [hier, setHier] = useState<{ kind: 'loading' | 'absent' | 'failed' } | { kind: 'read'; answer: HierarchyAnswer; landed: number }>({ kind: 'loading' });
  // Every read is numbered when it starts, and `landedRef` is the number of the last answer that landed. A read lands only when
  // it is newer than that (so a newer one settling first is kept and an older one settling after it is dropped; two rows can
  // write at once). A failed read lands nothing: it only marks what is shown stale. A row stays locked until `landed` reaches
  // the number of the read its own write started.
  const [failedSeq, setFailedSeq] = useState(0);
  const seqRef = useRef(0);
  const landedRef = useRef(0);
  const reread = useCallback((): number => {
    const mine = ++seqRef.current;
    void api.hierarchy().then(
      (answer) => {
        if (mine <= landedRef.current) return;
        landedRef.current = mine;
        setHier({ kind: 'read', answer, landed: mine });
      },
      (err: unknown) => {
        if (mine <= landedRef.current) return;
        setFailedSeq((f) => Math.max(f, mine));
        setHier((h) => (h.kind === 'read' ? h : { kind: hierarchyAbsent(err) ? 'absent' : 'failed' }));
      },
    );
    return mine;
  }, []);
  // The seq of the read the last owner-for-all save needs: a floor every row's lock also checks.
  const [floor, setFloorState] = useState(0);
  // Hierarchy writes (and owner-for-all) in flight: every row is locked from the moment one starts, since it may change other rows.
  const [inflight, setInflight] = useState(0);
  const track = useCallback((d: 1 | -1): void => setInflight((n) => n + d), []);
  const raise = useCallback((seq: number): void => setFloorState((f) => Math.max(f, seq)), []);

  useEffect(() => {
    let live = true;
    loadProjects().then(
      (r) => { if (live) setRead({ kind: 'read', rows: r.projects }); },
      () => { if (live) setRead({ kind: 'failed' }); },
    );
    void reread();
    return () => { live = false; };
  }, [reread]);
  const stored = useCallback((project: string, linking: ProjectLinkingWire): void => {
    setRead((r) => r.kind !== 'read' ? r : { kind: 'read', rows: r.rows.map((p) => p.name === project ? { ...p, linking } : p) });
  }, []);
  const answer = hier.kind === 'read' ? hier.answer : null;

  let body: ReactNode;
  if (read.kind === 'loading') body = <p className="settings-note">{LINKING_TEXT.loading}</p>;
  else if (read.kind === 'failed') body = <p className="settings-note">{LINKING_TEXT.unreadable}</p>;
  else {
    const shown = linkingRowsOf(read.rows);
    body = read.rows.length === 0 ? <p className="settings-note">{LINKING_TEXT.none}</p>
      : shown.length === 0 ? <p className="settings-note">{LINKING_TEXT.noRows}</p>
        : (
          <ul className="linking-list">
            {shown.map((p) => <LinkingRow key={p.name} name={p.name} linking={p.linking} now={now} onStored={stored} answer={answer} landed={hier.kind === 'read' ? hier.landed : 0} floor={floor} inflight={inflight} raise={raise} track={track} reread={reread} />)}
          </ul>
        );
  }
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-linking="section" className="linking-section">
      <div className="linking-card">{hier.kind === 'failed' && <p className="settings-note" role="alert">{HIERARCHY_TEXT.unreadable}</p>}
        {hier.kind === 'read' && failedSeq > hier.landed && <div className="linking-stale" role="alert">
          <p className="settings-note">{HIERARCHY_TEXT.rereadFailed}</p>
          <Button variant="ghost" onClick={() => reread()}>{HIERARCHY_TEXT.readAgain}</Button>
        </div>}{body}
        {answer !== null && read.kind === 'read' && read.rows.length > 0 && <OwnerForAll answer={answer} reread={reread} setFloor={raise} track={track} />}</div>
    </Section>
  );
}
