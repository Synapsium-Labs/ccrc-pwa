// Settings › Overlord's private-name list (Overlord W2 Settings, plan `w2-settings.md` Task 3, SQ6 to SQ9; spec 2026-11-09 §9.4
// rule 7; the private-names plan's question 9). Ring L4, context K (a settings screen): the status is the section's card read
// (`useCardRead` over `GET /api/overlord/private-names`), the upload goes through the section's card door and its one step-up, and
// every word is `nameListWords.ts`' (L1) or the section's refusal table's.
//
// DRAWN LIKE THE BACKSTOP AND THE RETENTION (the brief's ruling 3): not gated on a designation. A server without the read (404)
// draws no card; a read that failed draws its sentence and Read again; a list never uploaded is its own sentence.
//
// THE NAMES (the brief's ruling 6, ruled call 1815). They are typed into the secret field's multiline form (`SecretField`), an
// uncontrolled text area whose text lives only in its own DOM node: never in component state, a store, a log line or an error.
// Upload reads it without emptying it (`peek`), turns it into rows (`nameListRowsOf`, the console's own one-name-a-line format), and
// sends them; the rows live in the request body and nowhere else, and only the line numbers they came from are kept, to word a
// refused row. The text stays in the box only where the operator must edit or confirm it (review 4139 A2, slug
// `names-kept-only-to-be-edited`): a refused row, a refused cap and a first step-up. The door's answer, a 401 and every other
// refusal empty it (`nameListKeepsText`). The field is emptied on page hide and on a route change by the field itself.
//
// THE CONFIRM STARTS THE RETRY (review 4139 F1, ruled call 1876). Upload and Clear the list each hand the section their own retry
// with a `step-up-required`, so the mark is per act, and while an act's step shows its control is held. The confirm sends the
// retry, which reads the box again; the retry's own `step-up-required` is final: worded for its act (A4) and the box emptied (the
// coordinator's condition 4). A retry that finds the box emptied (the page was hidden while the step showed) sends nothing and
// says so: it never sends less than the first send carried (F2). A press by the operator is always a first send.
//
// NEVER EMPTY BY ACCIDENT (the brief's ruling 4). Text with no name in it sends nothing and says so. "Clear the list", drawn only
// while a list with names is stored, asks first and sends the door's own clear flag (`{ rows: [], clear: true }`), the only empty
// upload the door accepts. A list read back with no names (after a Clear) is its own sentence, with no Clear (A3).
import { useRef, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, Section } from '@ccrc/ui';
import type { NameListStatus } from '../../../../shared/privateNames';
import { SecretField, type SecretFieldHandle } from '../../accounts/SecretField';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { api } from '../../lib/api';
import {
  NAME_LIST_WORDS as W, nameListKeepsText, nameListRefusalText, nameListRowsOf, nameListStatusOf, uploadAnswerWords,
} from '../../overlord/nameListWords';
import { DoorLines, ReadLine, settingsRefusal, useCardDoor, useCardRead, valueOf, type SectionCtx } from './overlordCards';

const CARD = SETTINGS_CARDS.overlord.privateNames;
const dateOf = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const NO_PRESENCE = (): void => {};

/** The status as drawn: `empty` is a list stored with no names (a Clear's), which says so and offers no Clear. */
const shownState = (s: NameListStatus): string => (s.state === 'list' && s.rows === 0 ? 'empty' : s.state);

function statusLine(s: NameListStatus): string {
  if (s.state === 'list') return s.rows === 0 ? W.listEmpty(dateOf(s.uploadedAt)) : W.list(s.rows, dateOf(s.uploadedAt));
  if (s.state === 'unreadable') return W.unreadable(s.reason);
  return W.none;
}

type Act = 'upload' | 'clear';

export function PrivateNamesCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const { read, reread } = useCardRead<NameListStatus>(() => api.privateNameList(), nameListStatusOf);
  /** The line each sent row came from, for a refused row's sentence. Line numbers only: never a name. */
  const lines = useRef<readonly number[]>([]);
  const door = useCardDoor(ctx, 'private-names', (err) => nameListRefusalText(err, lines.current, settingsRefusal(ctx, 'name-list')));
  const text = useRef<SecretFieldHandle>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [askClear, setAskClear] = useState(false);
  if (read.state === 'absent') return null;
  const v = valueOf(read);
  /** One send of `act`; `retry` is the send the confirm starts, whose own step-up is final. */
  const send = (act: Act, body: Parameters<typeof api.uploadPrivateNames>[0], words: (a: unknown) => readonly string[], retry: boolean): void => {
    void door.run(() => api.uploadPrivateNames(body), words, async (o, err) => {
      if (o === 'step-up' && retry) {
        ctx.ask(null);
        setLocal(act === 'clear' ? W.clearFinal : W.stepUpFinal);
        text.current?.clear();
      } else if (o === 'done' || (o === 'refused' && !nameListKeepsText(err))) {
        text.current?.clear();
      }
      await reread();
    }, retry ? undefined : { act, send: act === 'clear' ? () => clear(true) : () => upload(true) });
  };
  const upload = (retry: boolean): void => {
    setLocal(null);
    const parsed = nameListRowsOf(text.current?.peek() ?? '');
    if (!parsed.ok) {
      // A retry whose box was emptied while the step showed sends nothing, never less than the first send carried.
      if (retry) ctx.ask(null);
      setLocal(parsed.why === 'mode' ? W.badMode(parsed.line) : retry ? W.namesGone : W.empty);
      return;
    }
    lines.current = parsed.lines;
    send('upload', { rows: parsed.rows }, uploadAnswerWords, retry);
  };
  const clear = (retry: boolean): void => {
    setLocal(null);
    lines.current = [];
    send('clear', { rows: [], clear: true }, () => [W.cleared], retry);
  };
  const listRows = v !== null && v.state === 'list' ? v.rows : 0;
  const clearOffered = listRows > 0;
  return (
    <Section level={3} scope={CARD.scope} title={CARD.title} purpose={CARD.purpose} data-settings-card="private-names">
      <ReadLine read={read} unread={W.unread} card="private-names" reread={() => { void reread(); }} />
      {/* The controls only once the status is read, as every card with its own read (a read that failed draws its sentence). */}
      {v !== null && (
        <>
          <p className="ovs-note" role="status" data-names-state={shownState(v)}>{statusLine(v)}</p>
          <p className="ovs-note">{W.replaces}</p>
          <p className="ovs-note">{W.format}</p>
          <SecretField label={W.textLabel} handle={text} onPresence={NO_PRESENCE} multiline />
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="names-upload" disabled={door.busy || ctx.stepShows('private-names', 'upload')}
              onClick={() => upload(false)}
            >
              {door.busy ? W.uploading : W.upload}
            </Button>
            {clearOffered && (
              <Button
                variant="danger-ghost" size="fit" data-settings-control="names-clear" disabled={door.busy || ctx.stepShows('private-names', 'clear')}
                onClick={() => setAskClear(true)}
              >
                {W.clear}
              </Button>
            )}
          </div>
        </>
      )}
      {clearOffered && (
        <QuickConfirm
          open={askClear} onClose={() => setAskClear(false)} title={W.clearTitle(listRows)} consequence={W.clearWhy} confirmLabel={W.clear}
          tone="danger" defaultFocus="cancel"
          onConfirm={() => { setAskClear(false); clear(false); }}
        />
      )}
      {ctx.confirmFor('private-names')}
      <DoorLines said={[]} refusal={local} card="private-names-local" />
      <DoorLines said={door.said} refusal={door.refusal} card="private-names" />
    </Section>
  );
}
