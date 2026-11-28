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
// sends them; the rows are built inside the request (`rowsBodyOf`) and live in its body and nowhere else, the heap included, and
// only the line numbers they came from are kept, to word a refused row (review 4167 F1). The text stays in the box only where the
// operator must edit or confirm it (review 4139 A2, slug `names-kept-only-to-be-edited`): a refused row, a refused cap and a first
// step-up, so a `bad-request` or an `oversize` keeps it; so does the one server fault that answers `bad-request` with no row (a row
// it could not hash), which the console's own body cannot cause. The door's answer, a 401 and every other refusal empty it
// (`nameListKeepsText`). The field is emptied on page hide and on a route change by the field itself.
//
// THE CONFIRM STARTS THE RETRY (review 4139 F1, ruled call 1876). Upload and Clear the list each hand the section their own retry
// with a `step-up-required`, so the mark is per act: the retry's answer is worded for its act. Each retry is made outside every send
// (`uploadRetry`, `clearRetry`), from the act alone, so no value stands in the scope the retry is made in (review 4167 F1). From
// the press to the end of the step the box, Upload and Clear are held (F2, F3, ruled call 1930; review 4183 F1), by the send in
// flight and then by the step, so no edit meets the retry and no other act of the card is in flight when the confirm lands; the
// step's confirm, another card's answered act or step, or leaving Settings puts it away. Read again is not held: it sends nothing.
// The confirm sends the retry, which reads the box again; the retry's own `step-up-required` is final: worded for its act (A4) and
// the box emptied (the coordinator's condition 4). A retry that finds the box emptied (held, the box is emptied only by its own
// rule, on a page hide or a route change) sends nothing and says so: it never sends less than the first send carried (F2). A press
// by the operator is always a first send.
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
import { DoorLines, ReadLine, settingsRefusal, useCardDoor, useCardRead, valueOf, type SectionCtx, type StepRetry } from './overlordCards';

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
type Body = Parameters<typeof api.uploadPrivateNames>[0];
const clearBody = (): Body => ({ rows: [], clear: true });

/** The upload's body, built inside the request from the box as it stands, so the rows live in the request alone (review 4167 F1).
 *  The send checked the same text in the same task, before any await, so text that no longer parses here is a fault: it is refused
 *  before anything is sent (never an emptier upload). */
function rowsBodyOf(field: SecretFieldHandle | null): Body {
  const parsed = nameListRowsOf(field?.peek() ?? '');
  if (!parsed.ok) throw new Error('the names changed between the check and the send; nothing was sent');
  return { rows: parsed.rows };
}

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
  /** One send of `act`; `retry` is the send the confirm starts, whose own step-up is final. `body` builds the request's body inside
   *  the request, so no local of a send holds the names (review 4167 F1). */
  const send = (act: Act, body: () => Body, words: (a: unknown) => readonly string[], retry: boolean): void => {
    void door.run(() => api.uploadPrivateNames(body()), words, async (o, err) => {
      if (o === 'step-up' && retry) {
        ctx.ask(null);
        setLocal(act === 'clear' ? W.clearFinal : W.stepUpFinal);
        text.current?.clear();
      } else if (o === 'done' || (o === 'refused' && !nameListKeepsText(err))) {
        text.current?.clear();
      }
      await reread();
    }, retry ? undefined : act === 'clear' ? clearRetry : uploadRetry);
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
    send('upload', () => rowsBodyOf(text.current), uploadAnswerWords, retry);
  };
  const clear = (retry: boolean): void => {
    setLocal(null);
    lines.current = [];
    send('clear', clearBody, () => [W.cleared], retry);
  };
  // The retries the confirm starts, made here, outside every send, from the act alone (review 4167 F1): the section keeps one while
  // the step shows, and it can reach no name. Each reads the box again when it is sent; the card is held, so nothing changed it.
  const uploadRetry: StepRetry = { act: 'upload', send: () => upload(true) };
  const clearRetry: StepRetry = { act: 'clear', send: () => clear(true) };
  const held = ctx.held('private-names');
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
          <SecretField label={W.textLabel} handle={text} onPresence={NO_PRESENCE} multiline held={door.busy || held} />
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="names-upload" disabled={door.busy || held}
              onClick={() => upload(false)}
            >
              {door.busy ? W.uploading : W.upload}
            </Button>
            {clearOffered && (
              <Button
                variant="danger-ghost" size="fit" data-settings-control="names-clear" disabled={door.busy || held}
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
