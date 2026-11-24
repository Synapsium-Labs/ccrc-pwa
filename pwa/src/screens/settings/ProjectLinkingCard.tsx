// Settings › Integrations › Project linking (the linking standard, D-8147; plan Task 8; the compact list,
// D-8932). One row per project, from the `linking` cell of `GET /api/projects` (D-8405: one per
// project NAME, `linkingRowsOf`, though the route answers one row per checkout directory).
//
// THE LIST, as `linkingList` (linkingWords.ts) decides it; this file draws the answer and decides nothing:
//   * The card's head says the counts once: how many rows need a decision, how many are linked, how many are not.
//   * A row that WAITS FOR THE OPERATOR (a suggested team, a key two workspaces hold, a shared key with no owning project,
//     a map waiting, inbound issues with no live owner) comes first, open and flagged. Each reason is said in words with
//     the ONE control that settles it directly under it (`LinkingDecision.control`); the rest of the row's form sits
//     behind "More settings". A row the operator settles keeps its place and its controls until they shut it.
//   * A LINKED project is ONE LINE: its name, the team it is linked to (key and name), how it was linked, who owns the
//     team now, where its migration stands, and a few words where it differs from a quiet row. The line is a native
//     disclosure; it opens to every control below.
//   * Every project with NO TEAM and nothing to decide sits in one group at the foot ("N projects not linked to Linear"),
//     which opens to a plain list that names the field once: the name, the key field, Save and "More settings" on a line.
// One `<ul>` holds every row, whatever its kind, so a row a write moves from one kind to another keeps its state (the
// lock its write needs, its result line): the group is a control of that list, never a second list.
//
// THE CONTROLS, unchanged from the card's first shape (the same writes, the same routes):
//   * Team key: a short field (uppercased as typed), Save; empty clears it. D-8405: a key the automatic pass linked says
//     so under the field, with its evidence; a project with no key shows the pass's candidates, each a one-tap Link that
//     saves its key as the operator's (the action sits on the row). The pass never writes over the operator's key.
//   * Visibility: the measured word and its age ("Private, read 3h ago", "Not read yet", "Couldn't read: offline"), and
//     the override select (Automatic, Private, Public), written the moment it changes.
//   * PR template: Present / Absent, and, for a private project with no template and a team key, "Open a template PR"
//     behind a `QuickConfirm` that names the repository and the file.
//   * The hierarchy cell (D-8184): the Linear owner, the initiatives toggle, the owning-project toggle, the state.
// THE ANSWER IS WHAT IS SHOWN. A write renders the row the server stored (`api.saveLinking`'s answer), and the template
// act shows the pull request's URL as a link. A refusal is its word's fixed sentence (`LINKING_REFUSAL_TEXT`); the box's
// own text never reaches the screen. A project whose cell is absent (an older server) draws nothing.
// Layout is `settings.css`'s `.linking-*` (a container query on the card, so the pane's width decides, not the window's).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, OptionRow, QuickConfirm, Section, Select, TextInput, TextLink, cn, elapsedWords, useNow } from '@ccrc/ui';
import type { LinkingOverride, LinkingWriteBody, ProjectLinkingWire, TeamCandidateWire } from '../../../../shared/linking';
import type { LinearLegacyRow, LinearWorkspaceShown } from '../../../../shared/linear';
import { LINKING_TEMPLATE_PATH } from '../../../../shared/linking';
import type { HierarchyAnswer, HierarchyProjectRow, HierarchyState } from '../../../../shared/plan';
import { ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, inAppClick, useResultLine } from '../../fleet/settingsText';
import { itemPath } from '../../ledgers/ledgerWords';
import {
  HIERARCHY_TEXT, NOT_LIVE_WORDS, coordinatorChoices, coordinatorWords, defaultHierarchyRow, defaultOwnerWords, hierarchyAbsent, hierarchyOutcomeUnknown, hierarchyWriteText, inboundWords, migrateOutcomeUnknown, migrateWriteText, reshapeConsequence, reshapeOffered, reshapeTitle, namedOwnerWords, ownerForAllConsequence, ownerInheritedNote, sharesTeamKey, stateWords,
} from '../../fleet/hierarchyWords';
import { api } from '../../lib/api';
import { upkeepPath } from '../../lib/routes';
import {
  LINKING_ROW_WORDS, PICKER_WORDS, candidateAriaLabel, candidateKeyOf, candidateLabel, candidateTap, candidateWhy, candidateWorkspaceLine, candidatesShown, keyWriteText,
  liftedControls, linkingCountsWords, linkingList, overlordCallLink, pickerWorkspacesOf, teamLinkLine, templateOffered, unlinkedGroupOpenAtFirst, unlinkedGroupWords, workspaceToWrite, workspacesHoldingKey,
  type LinkingControl, type LinkingListRow,
} from '../../fleet/linkingWords';
import { linkingErrorText } from '../../lib/refusalWords';
import type { ProjectList } from './useProjectList';

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

/** A listed row's line: a native `<details>`, so it needs no script to be reached and worked from the keyboard. */
function Fold({ summary, open, onOpen, children }: {
  summary: ReactNode; open: boolean; onOpen: (open: boolean) => void; children: ReactNode;
}): ReactNode {
  return (
    <details className="settings-release-fold linking-fold" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
      <summary className="linking-sum">{summary}</summary>
      {children}
    </details>
  );
}

/** What "More settings" shows: the rest of a row's form, kept in the page (its fields keep their state) and out of the
 *  layout and the keyboard's reach until asked for. */
function Rest({ id, shown, children }: { id: string; shown: boolean; children: ReactNode }): ReactNode {
  return <div id={id} className="linking-body" hidden={!shown}>{children}</div>;
}

/** A select of coordinators (the row's Linear owner, and the one coordinator for every project): what
 *  `coordinatorChoices` offers, and its control that shows the rest, in a group of their own. `first` is the empty
 *  option's words, which state the default. `between` is drawn after the select and before that control, so a caller's
 *  act that sits beside the select comes next in the keyboard's order too. */
function CoordinatorSelect({ id, value, disabled, first, coordinators, unlisted, onPick, between }: {
  id: string; value: string; disabled: boolean; first: string; coordinators: HierarchyAnswer['coordinators'];
  unlisted: (id: string) => string; onPick: (id: string) => void; between?: ReactNode;
}): ReactNode {
  const [all, setAll] = useState(false);
  const c = coordinatorChoices(coordinators, value === '' ? null : value, all, unlisted);
  return (
    <>
      <Select id={id} value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
        <option value="">{first}</option>
        {c.selected !== null && <option value={c.selected.id}>{c.selected.words}</option>}
        {c.live.map((o) => <option key={o.id} value={o.id}>{o.words}</option>)}
        {c.notLive.length > 0 && (
          <optgroup label={NOT_LIVE_WORDS.group}>
            {c.notLive.map((o) => <option key={o.id} value={o.id}>{o.words}</option>)}
          </optgroup>
        )}
      </Select>
      {between}
      {c.more !== null && (
        <Button variant="ghost" size="fit" className="linking-more" data-linking-more="" aria-expanded={all} onClick={() => setAll(!all)}>{c.more}</Button>
      )}
    </>
  );
}

/** The pieces of one row's hierarchy settings (D-8184), so the row can draw the one a reason names directly under that
 *  reason and the rest in the hierarchy cell. `owning` is null where the team key is not shared; `map` is null unless a
 *  map waits. */
interface HierarchyParts {
  owner: ReactNode; initiatives: ReactNode; owning: ReactNode | null; map: ReactNode | null;
  state: HierarchyState; stateWords: string; rest: ReactNode; confirm: ReactNode;
}

/** One row's hierarchy settings (D-8184): the Linear owner, the initiatives toggle, the owning-project toggle where the team
 *  key is shared, and the state. Every value shown, and every body written, is the hierarchy answer's row, the one source the
 *  server re-measures after each write (it clears `ownsTeam` on a sibling in the same transaction). Each control writes the
 *  moment it changes, the whole settings body at once. Null while there is no answer. */
function useHierarchyParts({ name, answer, reread, busy, locked, setBusy, raise, track, result }: {
  name: string; answer: HierarchyAnswer | null; reread: () => number; busy: boolean; locked: boolean; setBusy: (b: boolean) => void;
  raise: (seq: number) => void; track: (d: 1 | -1) => void; result: ReturnType<typeof useResultLine>;
}): HierarchyParts | null {
  const ownerId = useId();
  // Reshape in Linear (D-8186): asks the team's Linear owner for the map. The hierarchy is read again, so the state line follows.
  const [reshaping, setReshaping] = useState(false);
  if (answer === null) return null;
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
          if (hierarchyOutcomeUnknown(err)) raise(reread());
          result.say(hierarchyWriteText(err), 'refusal');
        },
      )
      .finally(() => { track(-1); setBusy(false); });
  };
  const reshape = (): void => {
    setBusy(true);
    track(1);
    result.clear();
    void api.migrate(name)
      .then(
        () => { result.say(HIERARCHY_TEXT.reshapeAsked); raise(reread()); },
        (err: unknown) => {
          if (migrateOutcomeUnknown(err)) raise(reread());
          result.say(migrateWriteText(err), 'refusal');
        },
      )
      .finally(() => { track(-1); setBusy(false); });
  };
  const inbound = inboundWords(h.inboundWaiting);
  const inheritedNote = ownerInheritedNote(h);
  const off = busy || locked;
  return {
    owner: (
      <div className="linking-cell linking-owner">
        <label htmlFor={ownerId} className="settings-note">{HIERARCHY_TEXT.owner}</label>
        <CoordinatorSelect id={ownerId} value={h.linearOwner ?? ''} disabled={off} first={defaultOwnerWords(h)}
          coordinators={answer.coordinators} unlisted={(id) => namedOwnerWords(h, id)}
          onPick={(id) => write({ linearOwner: id === '' ? null : id })} />
        {inheritedNote !== null && <p className="settings-note">{inheritedNote}</p>}
      </div>
    ),
    initiatives: (
      <OptionRow label={HIERARCHY_TEXT.initiatives} checked={h.initiatives === 'on'} disabled={off}
        onClick={() => write({ initiatives: h.initiatives === 'on' ? 'off' : 'on' })} />
    ),
    owning: !sharesTeamKey(name, answer.projects) ? null : (
      <OptionRow label={HIERARCHY_TEXT.owning} checked={h.ownsTeam} disabled={off} onClick={() => write({ ownsTeam: !h.ownsTeam })} />
    ),
    map: h.state === 'map-waiting' && h.itemId !== null
      ? <TextLink href={itemPath(h.itemId)} onClick={inAppClick(itemPath(h.itemId))}>{HIERARCHY_TEXT.mapWaiting}</TextLink>
      : null,
    state: h.state,
    stateWords: stateWords(h),
    rest: (
      <>
        {inbound !== null && <p className="settings-note">{inbound}</p>}
        {reshapeOffered(h) && (
          <Button variant="ghost" className="linking-reshape" disabled={off} onClick={() => setReshaping(true)}>{HIERARCHY_TEXT.reshape}</Button>
        )}
        {h.teamKey !== null && <TextLink href={upkeepPath(name)} onClick={inAppClick(upkeepPath(name))}>{HIERARCHY_TEXT.upkeep}</TextLink>}
      </>
    ),
    confirm: (
      <QuickConfirm open={reshaping} onClose={() => setReshaping(false)} title={reshapeTitle(h.teamKey ?? '')}
        consequence={reshapeConsequence(h.teamKey ?? '')} confirmLabel={HIERARCHY_TEXT.reshapeConfirm} onConfirm={reshape} />
    ),
  };
}

/** The hierarchy cell: every piece but the ones the row drew under a reason (`lifted`). */
function HierarchyCell({ parts, lifted }: { parts: HierarchyParts; lifted: readonly LinkingControl[] }): ReactNode {
  const mapAbove = lifted.includes('map') && parts.map !== null;
  return (
    <div className="linking-cell linking-hier" data-linking-hier="">
      {!lifted.includes('owner') && parts.owner}
      <div className="linking-cell linking-toggles">
        {parts.initiatives}
        {!lifted.includes('owning') && parts.owning}
      </div>
      <div className="linking-cell linking-state" data-linking-state={parts.state}>
        {!mapAbove && (parts.map ?? <p className="settings-note">{parts.stateWords}</p>)}
        {parts.rest}
      </div>
    </div>
  );
}

function LinkingRow({ row, hidden, onReveal, now, workspaces, onStored, refreshList, answer, landed, floor, inflight, raise, track, reread }: {
  row: LinkingListRow; hidden: boolean; onReveal: () => void; now: number; workspaces: readonly LinearWorkspaceShown[] | null;
  onStored: (project: string, linking: ProjectLinkingWire) => void; refreshList: () => Promise<void>;
  answer: HierarchyAnswer | null; landed: number; floor: number; inflight: number; raise: (seq: number) => void; track: (d: 1 | -1) => void; reread: () => number;
}): ReactNode {
  const { name, linking, kind, decisions, summary } = row;
  const keyId = useId();
  const overrideId = useId();
  const workspaceId = useId();
  const restId = useId();
  const [draft, setDraft] = useState(linking.teamKey ?? '');
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const locked = busy || listBusy;
  // The seq of the re-read this row's last write needs: the hierarchy controls stay locked until a read that new has landed.
  const [need, setNeed] = useState(0);
  const [asking, setAsking] = useState(false);
  const [pr, setPr] = useState<string | null>(null);
  const result = useResultLine();
  const parts = useHierarchyParts({ name, answer, reread, busy: locked, locked: inflight > 0 || landed < Math.max(need, floor), setBusy, raise, track, result });

  // The row's line is open while it waits for the operator, and opens when it starts to; a row that stops waiting stays as
  // the operator left it, so the answer of the write that settled it stays in view.
  const waiting = kind === 'decision';
  const [open, setOpen] = useState(waiting);
  useEffect(() => { if (waiting) setOpen(true); }, [waiting]);
  // The controls drawn under a reason, above the rest of the form (`liftedControls`): each stays where it was drawn while
  // the row stays open, so the control the operator just used is the same element after its reason went. Shutting the
  // line forgets them: a settled row opens again as the whole form.
  const kept = useRef<LinkingControl[]>([]);
  kept.current = kind === 'unlinked' ? [] : liftedControls(kept.current, decisions);
  const lifted = kept.current;
  const toggle = (o: boolean): void => { if (!o) kept.current = []; setOpen(o); };
  // "More settings": the rest of an unlinked row's form, and of a row's that draws a control under a reason.
  const [more, setMore] = useState(false);
  // A write of this row's own that moves it between the listed rows and the group takes the operator with it: the row is
  // shown where it now sits (its line opened, or the group opened), and focus goes to it, since the control that was
  // pressed is gone. A row that moves for any other reason (a read, another project's write) is left alone.
  const li = useRef<HTMLLIElement | null>(null);
  const wrote = useRef(false);
  const was = useRef(kind);
  const [focusOn, setFocusOn] = useState<'input' | 'summary' | null>(null);
  useEffect(() => {
    const from = was.current;
    was.current = kind;
    const moved = (from === 'unlinked') !== (kind === 'unlinked');
    if (moved && wrote.current) {
      if (kind === 'unlinked') onReveal(); else setOpen(true);
      setFocusOn(kind === 'unlinked' ? 'input' : 'summary');
    }
    wrote.current = false;
  }, [linking, kind, onReveal]);
  // Focus goes there once it can be taken: the field is no longer locked by the write that moved the row (a locked field
  // is disabled, and a disabled field takes no focus). The group is open by then: `onReveal` and `setFocusOn` are one update.
  useEffect(() => {
    if (focusOn === null || locked) return;
    li.current?.querySelector<HTMLElement>(focusOn)?.focus();
    setFocusOn(null);
  }, [focusOn, locked]);

  // The stored row is what the field shows: a re-read (the answer of a write) puts the field back on it.
  useEffect(() => { setDraft(linking.teamKey ?? ''); }, [linking.teamKey]);
  // D-8808: the workspace the typed key lives in, among the connected workspaces that hold it; the stored one is preselected.
  const [chosen, setChosen] = useState(linking.teamWorkspace ?? '');
  useEffect(() => { setChosen(linking.teamWorkspace ?? ''); }, [linking.teamWorkspace]);
  const holders = workspacesHoldingKey(workspaces, draft);

  const write = (body: LinkingWriteBody): void => {
    setBusy(true);
    wrote.current = true;
    result.clear();
    void api.saveLinking(name, body)
      .then(
        (a) => { onStored(name, a.linking); setNeed(reread()); result.say(LINKING_TEXT.saved); },
        (err: unknown) => {
          // The project list holds the linking cell, so it is read again too, and the row's controls stay locked until it lands (D-8186 A1).
          if (hierarchyOutcomeUnknown(err)) { setNeed(reread()); setListBusy(true); void refreshList().finally(() => setListBusy(false)); }
          // A refusal wrote nothing, so no later move of this row is this write's.
          else wrote.current = false;
          result.say(keyWriteText(err, holders.length), 'refusal');
        },
      )
      .finally(() => setBusy(false));
  };
  // A key held by several workspaces needs one chosen: Save and Enter wait for it.
  const needsWorkspace = holders.length > 1 && workspaceToWrite(holders, chosen) === undefined;
  const saveKey = (): void => {
    if (locked || needsWorkspace) return;
    const key = draft.trim().toUpperCase();
    const workspace = key === '' ? undefined : workspaceToWrite(workspacesHoldingKey(workspaces, key), chosen);
    write({ teamKey: key === '' ? null : key, override: linking.override, ...(workspace === undefined ? {} : { workspace }) });
  };
  // A candidate's tap (`candidateTap`): its pair is written, or, for a key several workspaces hold and the candidate names none of,
  // the key goes into the field with no workspace chosen, so the picker asks and Save waits for it (final review I2).
  const tapCandidate = (c: TeamCandidateWire): void => {
    const tap = candidateTap(c, workspaces);
    if (tap.kind === 'pick') { setDraft(c.key); setChosen(''); return; }
    write({ teamKey: c.key, override: linking.override, ...(tap.workspace === undefined ? {} : { workspace: tap.workspace }) });
  };
  const linkLine = teamLinkLine(linking);
  const callLink = overlordCallLink(linking.teamLink);
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
  // An unlinked row's field has no label of its own: the group says "Team key" once, and the field is named for its project.
  const plain = kind === 'unlinked';
  const keyCell = (
    <div className="linking-cell linking-key">
      {!plain && <label htmlFor={keyId} className="settings-note">{LINKING_TEXT.teamKey}</label>}
      <div className="linking-key-line">
        <TextInput
          id={keyId}
          aria-label={plain ? LINKING_ROW_WORDS.keyFor(name) : undefined}
          value={draft}
          maxLength={16}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={locked}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
        />
        <Button variant="ghost" disabled={locked || needsWorkspace} onClick={saveKey}>{LINKING_TEXT.save}</Button>
      </div>
      {holders.length > 1 && (
        <div className="linking-workspace" data-linking-workspace="">
          <label htmlFor={workspaceId} className="settings-note">{PICKER_WORDS.label}</label>
          <Select id={workspaceId} value={chosen} disabled={locked} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{PICKER_WORDS.choose}</option>
            {holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
          {needsWorkspace && <p className="settings-note">{PICKER_WORDS.needed}</p>}
        </div>
      )}
      {linkLine !== null && <p className="settings-note linking-auto" data-linking-auto="">{linkLine}</p>}
      {callLink !== null && (
        <TextLink href={callLink.href} onClick={inAppClick(callLink.href)}>{callLink.words}</TextLink>
      )}
      {candidates.length > 0 && (
        <div className="linking-candidates" role="group" aria-label={LINKING_TEXT.candidates}>
          <p className="settings-note">{LINKING_TEXT.candidates}</p>
          {candidates.map((c) => (
            <div key={candidateKeyOf(c)} className="linking-candidate" data-linking-candidate={c.key}>
              <Button variant="ghost" disabled={locked} aria-label={candidateAriaLabel(c)}
                onClick={() => tapCandidate(c)}>
                {candidateLabel(c)}
              </Button>
              {candidateWorkspaceLine(c) !== null && <p className="settings-note">{candidateWorkspaceLine(c)}</p>}
              <p className="settings-note">{candidateWhy(c)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  // Everything but the key: the visibility cell, the template cell and the hierarchy cell (less what a reason drew above).
  const rest = (
    <>
      <div className="linking-cell linking-visibility">
        <p className="settings-note linking-measured">{visibilityLine(linking.measured, now)}</p>
        <label htmlFor={overrideId} className="settings-note">{LINKING_TEXT.override}</label>
        <Select
          id={overrideId}
          value={linking.override ?? ''}
          disabled={locked}
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
          <Button variant="ghost" disabled={locked} onClick={() => setAsking(true)}>{LINKING_TEXT.openTemplate}</Button>
        )}
        {pr !== null && <TextLink href={pr}>{LINKING_TEXT.templatePr}</TextLink>}
      </div>
      {parts !== null && <HierarchyCell parts={parts} lifted={lifted} />}
    </>
  );
  // The control each reason names: the card draws it under the reason; which reason names which is `linkingDecisions`'.
  const control: Record<LinkingControl, ReactNode> = {
    key: keyCell, owning: parts?.owning ?? null, map: parts?.map ?? null, owner: parts?.owner ?? null,
  };
  const moreButton = (
    <Button variant="ghost" size="fit" className="linking-rest" data-linking-rest="" aria-expanded={more} aria-controls={restId}
      aria-label={plain ? LINKING_ROW_WORDS.moreFor(name) : undefined} onClick={() => setMore(!more)}>
      {plain ? LINKING_ROW_WORDS.moreShort : LINKING_ROW_WORDS.more}
    </Button>
  );
  const said = <div className="linking-result"><ResultLine line={result.line} /></div>;
  return (
    <li ref={li} className="linking-row" data-linking-row={name} data-linking-kind={kind} hidden={hidden}>
      {plain ? (
        <>
          <div className="linking-plain">
            <p className="linking-name">{name}</p>
            {keyCell}
            {moreButton}
          </div>
          <Rest id={restId} shown={more}>{rest}</Rest>
          {said}
        </>
      ) : (
        <Fold open={open} onOpen={toggle} summary={(
          <span className="linking-line">
            <span className="linking-name">{name}</span>
            <span className="settings-note linking-sum-team" data-linking-sum="team">{summary.team}</span>
            {summary.owner !== null && <span className="settings-note linking-sum-owner" data-linking-sum="owner">{summary.owner}</span>}
            {summary.state !== null && <span className="settings-note linking-sum-state" data-linking-sum="state">{summary.state}</span>}
            {(waiting || summary.notes.length > 0) && (
              <span className="linking-extra">
                {waiting && <span className={cn(SETTINGS_AMBER_NOTE, 'linking-flag')} data-linking-flag="">{LINKING_ROW_WORDS.flag}</span>}
                {summary.notes.map((n) => <span key={n} className="settings-note" data-linking-sum="note">{n}</span>)}
              </span>
            )}
          </span>
        )}>
          {lifted.length === 0 ? <div className="linking-body">{keyCell}{rest}</div> : (
            <>
              <ul className="linking-decide">
                {lifted.map((c) => {
                  const reasons = decisions.filter((d) => d.control === c);
                  if (reasons.length === 0 && control[c] === null) return null;
                  return (
                    <li key={c} className="linking-slot" data-linking-control={c}>
                      {reasons.map((d) => <p key={d.kind} className={SETTINGS_AMBER_NOTE} data-linking-decision={d.kind}>{d.words}</p>)}
                      {control[c]}
                    </li>
                  );
                })}
              </ul>
              {moreButton}
              <Rest id={restId} shown={more}>{!lifted.includes('key') && keyCell}{rest}</Rest>
            </>
          )}
          {said}
        </Fold>
      )}
      {parts?.confirm}
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
        if (hierarchyOutcomeUnknown(err)) setFloor(reread());
        result.say(hierarchyWriteText(err), 'refusal');
      })
      .finally(() => { track(-1); setBusy(false); });
  };
  return (
    <div className="linking-all" data-linking-all="">
      <label htmlFor={pickId} className="settings-note">{HIERARCHY_TEXT.allPick}</label>
      {/* The act is drawn beside the select, so it follows it in the page too: Tab goes select, act, then the "show" control. */}
      <CoordinatorSelect id={pickId} value={pick} disabled={busy} first={HIERARCHY_TEXT.allNone} coordinators={answer.coordinators}
        unlisted={(id) => coordinatorWords({ id, live: false })} onPick={setPick}
        between={<Button variant="ghost" className="linking-all-act" disabled={busy || pick === ''} onClick={() => setAsking(true)}>{HIERARCHY_TEXT.allAct}</Button>} />
      <ResultLine line={result.line} />
      <QuickConfirm open={asking} onClose={() => setAsking(false)} title={HIERARCHY_TEXT.allTitle}
        consequence={ownerForAllConsequence(pick)} confirmLabel={HIERARCHY_TEXT.allConfirm} onConfirm={apply} />
    </div>
  );
}

/** `workspaces` and `legacy` are the Settings frame's one read of `GET /api/linear/workspaces` (the Linear card's poll), never a
 *  read of the card's own: `workspaces` is `null` while it is unread or unreadable, so no picker (D-8808). The picker offers the
 *  file slots and the legacy key's workspace while it routes (`pickerWorkspacesOf`, review 2971 A1). `list` is the section's one
 *  read of the project list (`useProjectList`), which the GitHub card beside this one draws from too. */
export function ProjectLinkingCard({ workspaces: slots, legacy = null, list }: {
  workspaces: readonly LinearWorkspaceShown[] | null; legacy?: LinearLegacyRow | null; list: ProjectList;
}): ReactNode {
  const workspaces = useMemo(() => pickerWorkspacesOf(slots, legacy), [slots, legacy]);
  const card = SETTINGS_CARDS.integrations.linking;
  const now = useNow(30_000);
  const { read, stored, refresh: refreshList } = list;
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

  useEffect(() => { void reread(); }, [reread]);
  const answer = hier.kind === 'read' ? hier.answer : null;

  // The group of unlinked projects: open or shut as the operator left it; until they touch it, as the first read of the
  // list decided (`unlinkedGroupOpenAtFirst`), which is not asked again, so the group never shuts under a row being typed in.
  const [groupOpen, setGroupOpen] = useState<boolean | null>(null);
  const atFirst = useRef<boolean | null>(null);
  const reveal = useCallback((): void => setGroupOpen(true), []);
  // The projects whose row has waited for the operator since this page opened: `linkingList` keeps such a row with the
  // rows that wait once it is settled, so it does not jump down the list from under the answer of the write that settled it.
  const held = useRef(new Set<string>());

  let body: ReactNode;
  if (read.kind === 'loading') body = <p className="settings-note">{LINKING_TEXT.loading}</p>;
  else if (read.kind === 'failed') body = <p className="settings-note">{LINKING_TEXT.unreadable}</p>;
  else {
    const { listed, unlinked, counts } = linkingList(read.rows, workspaces, answer?.projects ?? null, held.current);
    for (const r of listed) if (r.kind === 'decision') held.current.add(r.name);
    if (atFirst.current === null) atFirst.current = unlinkedGroupOpenAtFirst(listed.length);
    const shut = !(groupOpen ?? atFirst.current);
    const rowOf = (r: LinkingListRow, hidden: boolean): ReactNode => (
      <LinkingRow key={r.name} row={r} hidden={hidden} onReveal={reveal} now={now} workspaces={workspaces} onStored={stored} refreshList={refreshList} answer={answer} landed={hier.kind === 'read' ? hier.landed : 0} floor={floor} inflight={inflight} raise={raise} track={track} reread={reread} />
    );
    // ONE array of keyed rows, the group's control among them: React matches a row by its key within one array, so a row
    // that a write moves across the group keeps its state. Two arrays side by side would mount it anew.
    const items = [
      ...listed.map((r) => rowOf(r, false)),
      ...(unlinked.length === 0 ? [] : [(
        <li key=":group" className="linking-group" data-linking-group="">
          <Button variant="ghost" size="fit" aria-expanded={!shut} onClick={() => setGroupOpen(shut)}>{unlinkedGroupWords(unlinked.length)}</Button>
          {/* The unlinked rows' fields carry no label each: the group names the field once, while it is open. */}
          {!shut && <p className="settings-note" data-linking-hint="">{LINKING_ROW_WORDS.unlinkedHint}</p>}
        </li>
      )]),
      ...unlinked.map((r) => rowOf(r, shut)),
    ];
    const countsWords = linkingCountsWords(counts);
    body = read.rows.length === 0 ? <p className="settings-note">{LINKING_TEXT.none}</p>
      : items.length === 0 ? <p className="settings-note">{LINKING_TEXT.noRows}</p>
        : (
          <>
            {countsWords !== null && <p className="settings-note linking-counts" data-linking-counts="">{countsWords}</p>}
            <ul className="linking-list">{items}</ul>
          </>
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
