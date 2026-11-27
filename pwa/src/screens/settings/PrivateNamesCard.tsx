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
// refused row. The text is emptied on the door's answer only: a refused row and a step-up keep it, so the named line can be fixed
// or the same list sent once more after the confirm. A second `step-up-required`, on that retry, is final: it is worded and the
// field is emptied (the coordinator's condition 4). The field is emptied on page hide and on a route change by the field itself.
//
// NEVER EMPTY BY ACCIDENT (the brief's ruling 4). Text with no name in it sends nothing and says so. "Clear the list", drawn only
// while a list is stored, asks first and sends the door's own clear flag (`{ rows: [], clear: true }`), the only empty upload the
// door accepts.
import { useRef, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, Section } from '@ccrc/ui';
import type { NameListStatus } from '../../../../shared/privateNames';
import { SecretField, type SecretFieldHandle } from '../../accounts/SecretField';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { api } from '../../lib/api';
import { NAME_LIST_WORDS as W, nameListRefusalText, nameListRowsOf, nameListStatusOf, uploadAnswerWords } from '../../overlord/nameListWords';
import { DoorLines, ReadLine, settingsRefusal, useCardDoor, useCardRead, valueOf, type SectionCtx } from './overlordCards';

const CARD = SETTINGS_CARDS.overlord.privateNames;
const dateOf = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const NO_PRESENCE = (): void => {};

function statusLine(s: NameListStatus): string {
  if (s.state === 'list') return W.list(s.rows, dateOf(s.uploadedAt));
  if (s.state === 'unreadable') return W.unreadable(s.reason);
  return W.none;
}

export function PrivateNamesCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const { read, reread } = useCardRead<NameListStatus>(() => api.privateNameList(), nameListStatusOf);
  /** The line each sent row came from, for a refused row's sentence. Line numbers only: never a name. */
  const lines = useRef<readonly number[]>([]);
  const door = useCardDoor(ctx, 'private-names', (err) => nameListRefusalText(err, lines.current, settingsRefusal(ctx, 'name-list')));
  const text = useRef<SecretFieldHandle>(null);
  const steppedUp = useRef(false);
  const [local, setLocal] = useState<string | null>(null);
  const [askClear, setAskClear] = useState(false);
  if (read.state === 'absent') return null;
  const v = valueOf(read);
  const send = (rows: Parameters<typeof api.uploadPrivateNames>[0], words: (a: unknown) => readonly string[]): void => {
    void door.run(() => api.uploadPrivateNames(rows), words, async (o) => {
      if (o === 'step-up' && !steppedUp.current) {
        steppedUp.current = true;
      } else {
        if (o === 'step-up') { setLocal(W.stepUpFinal); text.current?.clear(); }
        steppedUp.current = false;
        if (o === 'done') text.current?.clear();
      }
      await reread();
    });
  };
  const upload = (): void => {
    setLocal(null);
    const parsed = nameListRowsOf(text.current?.peek() ?? '');
    if (!parsed.ok) { setLocal(parsed.why === 'empty' ? W.empty : W.badMode(parsed.line)); return; }
    lines.current = parsed.lines;
    send({ rows: parsed.rows }, uploadAnswerWords);
  };
  return (
    <Section level={3} scope={CARD.scope} title={CARD.title} purpose={CARD.purpose} data-settings-card="private-names">
      <ReadLine read={read} unread={W.unread} card="private-names" reread={() => { void reread(); }} />
      {/* The controls only once the status is read, as every card with its own read (a read that failed draws its sentence). */}
      {v !== null && (
        <>
          <p className="ovs-note" role="status" data-names-state={v.state}>{statusLine(v)}</p>
          <p className="ovs-note">{W.replaces}</p>
          <p className="ovs-note">{W.format}</p>
          <SecretField label={W.textLabel} handle={text} onPresence={NO_PRESENCE} multiline />
          <div className="ovs-actions">
            <Button variant="primary" size="fit" data-settings-control="names-upload" disabled={door.busy} onClick={upload}>
              {door.busy ? W.uploading : W.upload}
            </Button>
            {v.state === 'list' && (
              <Button variant="danger-ghost" size="fit" data-settings-control="names-clear" disabled={door.busy} onClick={() => setAskClear(true)}>
                {W.clear}
              </Button>
            )}
          </div>
        </>
      )}
      {v !== null && v.state === 'list' && (
        <QuickConfirm
          open={askClear} onClose={() => setAskClear(false)} title={W.clearTitle(v.rows)} consequence={W.clearWhy} confirmLabel={W.clear}
          tone="danger" defaultFocus="cancel"
          onConfirm={() => { setAskClear(false); setLocal(null); lines.current = []; send({ rows: [], clear: true }, () => [W.cleared]); }}
        />
      )}
      {ctx.confirmFor('private-names')}
      <DoorLines said={[]} refusal={local} card="private-names-local" />
      <DoorLines said={door.said} refusal={door.refusal} card="private-names" />
    </Section>
  );
}
