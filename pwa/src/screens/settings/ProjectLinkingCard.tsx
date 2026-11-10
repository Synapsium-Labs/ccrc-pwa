// Settings › Security › Project linking (the linking standard, D-8147; plan Task 8). One row per project, from the
// `linking` cell of `GET /api/projects`:
//   * Team key: a short field (uppercased as typed), Save; empty clears it.
//   * Visibility: the measured word and its age ("Private, read 3h ago", "Not read yet", "Couldn't read: offline"), and
//     the override select (Automatic, Private, Public), written the moment it changes.
//   * PR template: Present / Absent, and, for a private project with no template and a team key, "Open a template PR"
//     behind a `QuickConfirm` that names the repository and the file.
// THE ANSWER IS WHAT IS SHOWN. A write renders the row the server stored (`api.saveLinking`'s answer), and the template
// act shows the pull request's URL as a link. A refusal is its word's fixed sentence (`LINKING_REFUSAL_TEXT`); the box's
// own text never reaches the screen. A project whose cell is absent (an older server) draws nothing.
// Layout is `settings.css`'s `.linking-*` (a container query on the card, so the pane's width decides, not the window's).
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, Section, Select, TextInput, TextLink, elapsedWords, useNow } from '@ccrc/ui';
import type { LinkingOverride, ProjectLinkingWire } from '../../../../shared/linking';
import { LINKING_TEMPLATE_PATH } from '../../../../shared/linking';
import type { ProjectRow } from '../../../../shared/api';
import { ResultLine, SETTINGS_CARDS, useResultLine } from '../../fleet/settingsText';
import { api } from '../../lib/api';
import { apiErrorText } from '../../lib/refusalWords';

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

function LinkingRow({ name, linking, now, onStored }: {
  name: string; linking: ProjectLinkingWire; now: number; onStored: (project: string, linking: ProjectLinkingWire) => void;
}): ReactNode {
  const keyId = useId();
  const overrideId = useId();
  const [draft, setDraft] = useState(linking.teamKey ?? '');
  const [busy, setBusy] = useState(false);
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
        (a) => { onStored(name, a.linking); result.say(LINKING_TEXT.saved); },
        (err: unknown) => result.say(apiErrorText(err), 'refusal'),
      )
      .finally(() => setBusy(false));
  };
  const saveKey = (): void => {
    const key = draft.trim().toUpperCase();
    write({ teamKey: key === '' ? null : key, override: linking.override });
  };
  const openTemplate = (): void => {
    setBusy(true);
    result.clear();
    void api.openTemplatePr(name)
      .then(
        (a) => { setPr(a.url); onStored(name, withTemplatePresent(linking)); },
        (err: unknown) => result.say(apiErrorText(err), 'refusal'),
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

/** One read of the project list, and the rows the cards draw from it. */
type Read = { kind: 'loading' } | { kind: 'failed' } | { kind: 'read'; rows: ProjectRow[] };

export function ProjectLinkingCard(): ReactNode {
  const card = SETTINGS_CARDS.security.linking;
  const now = useNow(30_000);
  const [read, setRead] = useState<Read>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    api.projects().then(
      (r) => { if (live) setRead({ kind: 'read', rows: r.projects }); },
      () => { if (live) setRead({ kind: 'failed' }); },
    );
    return () => { live = false; };
  }, []);

  const stored = useCallback((project: string, linking: ProjectLinkingWire): void => {
    setRead((r) => r.kind !== 'read' ? r : { kind: 'read', rows: r.rows.map((p) => p.name === project ? { ...p, linking } : p) });
  }, []);

  let body: ReactNode;
  if (read.kind === 'loading') body = <p className="settings-note">{LINKING_TEXT.loading}</p>;
  else if (read.kind === 'failed') body = <p className="settings-note">{LINKING_TEXT.unreadable}</p>;
  else {
    const shown = read.rows.filter((p) => p.linking !== undefined);
    body = read.rows.length === 0 ? <p className="settings-note">{LINKING_TEXT.none}</p>
      : shown.length === 0 ? <p className="settings-note">{LINKING_TEXT.noRows}</p>
        : (
          <ul className="linking-list">
            {shown.map((p) => <LinkingRow key={p.name} name={p.name} linking={p.linking!} now={now} onStored={stored} />)}
          </ul>
        );
  }
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-linking="section" className="linking-section">
      <div className="linking-card">{body}</div>
    </Section>
  );
}
