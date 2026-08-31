// Name a workspace, or paste a Linear ticket — the door the project card's `+`
// now opens instead of creating immediately.
//
// WHY A SHEET AT ALL, given `+` used to be one tap: this is the only
// irreversible create on the fleet screen with no confirmation, and the slug it
// mints is the workspace's directory, id, branch, tmux session and systemd unit
// FOR LIFE (no verb renames a slug). It is also the only place the account
// projection can be a sentence rather than a `title` attribute a phone never
// renders. The auto-name path is kept to two thumb taps and no keyboard.
//
// BOARD-HOSTED, not card-hosted: creating flips the card that would own the
// sheet, which is the unmount bug the attention-ux ruling names. FleetScreen
// mounts it beside its other sheets.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { deriveWorkspaceSlug, NAME_REFUSAL_TEXT } from '../../../shared/slug';
import './fleet.css';

export interface NewWorkspaceSheetProps {
  /** The project to add to; `null` closes the sheet. */
  project: string | null;
  onClose: () => void;
  /** Fires the create. Rejects with the server's error so the sheet can keep
   *  the operator's text on a collision. */
  onCreate: (project: string, name?: string) => Promise<void>;
  /** The same sentence the card's `+` carries in its accessible name — where
   *  the next workspace will land. Shown as a line here because a phone never
   *  renders a `title` attribute. */
  projectedLabel: string;
}

export function NewWorkspaceSheet({
  project, onClose, onCreate, projectedLabel,
}: NewWorkspaceSheetProps): ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** The server's own refusal, kept until the next keystroke. */
  const [refusal, setRefusal] = useState<string | null>(null);

  // A closed sheet forgets everything — reopening starts clean, the same rule
  // NewSessionSheet follows.
  useEffect(() => {
    if (project !== null) return;
    setText('');
    setBusy(false);
    setRefusal(null);
  }, [project]);

  // ONE slug rule, imported from the module the SERVER validates with — not a
  // second copy that can drift. This is preview only: it renders the label and
  // arms the button, and never rewrites what was typed.
  const ask = deriveWorkspaceSlug(text);
  // Kept as the discriminated value rather than flattened to two booleans —
  // narrowing on `named.slug`/`named.shortened` is what stops the render
  // reading a field the `auto` arm does not have.
  const named = ask.kind === 'named' ? ask : null;
  const preview = named === null ? null : `${project ?? ''}-${named.slug}`;
  const blocked = ask.kind === 'refused';

  const create = async (): Promise<void> => {
    if (project === null || busy || blocked) return;
    setBusy(true);
    setRefusal(null);
    try {
      await onCreate(project, text.trim() === '' ? undefined : text);
      onClose();
    } catch (err) {
      // The sheet STAYS OPEN with the text intact. A collision is the case
      // this exists for: one ticket maps to one slug, so the second attempt
      // for the same ticket is refused by design, and the operator's next move
      // is to edit the name — which they cannot do if the sheet closed.
      setRefusal(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={project !== null}
      onClose={onClose}
      eyebrow="new workspace"
      title={project ?? ''}
    >
      <p className="sheet-copy">{projectedLabel}</p>

      <input
        className="proj-search"
        type="text"
        /* The label is the aria-label, never the placeholder — nothing in this
           tree uses placeholder-as-label. */
        aria-label="Name or Linear ticket"
        placeholder="ENG-1234, a link, or a name"
        /* A slug is lowercase and a ticket id is not free text: every one of
           these fights the operator on a phone keyboard. */
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(e) => { setText(e.target.value); setRefusal(null); }}
      />

      {/* The line that makes the client rule advisory instead of a second
          authority: the operator SEES what will be created before committing
          to a name nothing can change afterwards. */}
      {refusal !== null ? (
        <p className="proj-none" role="alert">{refusal}</p>
      ) : blocked ? (
        <p className="proj-none" role="alert">{NAME_REFUSAL_TEXT[ask.reason]}</p>
      ) : named !== null ? (
        <p className="proj-none">
          <span aria-hidden="true">→ </span>{preview}
          {named.shortened && ' · shortened to fit'}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary sheet-confirm"
        disabled={busy || blocked}
        onClick={() => void create()}
      >
        {busy
          ? 'Creating…'
          : preview !== null
            ? `Create ${preview}`
            : `Add a workspace to ${project ?? ''}`}
      </button>
    </Sheet>
  );
}
