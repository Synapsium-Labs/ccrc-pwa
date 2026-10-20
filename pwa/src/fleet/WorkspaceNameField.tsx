// The "Name or Linear ticket" field (named workspaces S7, design 2026-10-20 §5): ONE component behind both doors, the
// new-session sheet and the sheet the project card's `+` opens. It renders and disables; it NEVER rewrites what the
// operator typed (the value is the parent's, and every change goes up as typed), and it NEVER autofocuses: the Sheet
// owns the focus, and a field that took it would raise a phone's keyboard on a two-tap path that needs none.
//
// WHAT IT SHOWS, from the preview it is handed (`useNamePreview`, which the sheet owns because its confirm reads the
// same answer): nothing typed is the door's own hint; a refusal is the grammar's sentence; a name is the title the
// board will show, where that title came from, the id and branch it will get, and, when Linear could not be asked,
// one quiet sentence and (where the remedy is in Settings) the way there.
//
// A DISABLED FIELD SAYS WHY. A door that cannot take a name (a crossing project, an overflow account) disables the
// field and says it in one line, instead of leaving an input that silently ignores what is typed into it.
import { useId } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Button, Chip, TextInput } from '@ccrc/ui';
import { LOOKUP_NOTE, type Lookup, type NamePreview } from './workspaceNameWords';
import './fleet.css';

/** The words of the field itself. Each door's own sentences (its empty hint, its disabled reasons) are passed in. */
export const NAME_FIELD_TEXT = {
  label: 'Name or Linear ticket',
  placeholder: 'ENG-1234, a Linear link, or a name',
  lookingUp: 'looking up…',
  fromLinear: 'from Linear',
  offline: 'offline',
  shortened: 'Shortened to fit the 31-character limit; the slug cannot be renamed later.',
} as const;

/** The field's own class strings, named once: the sheets that host it draw the same hint and refusal lines, and a
 *  literal copied between files is what the markup census exists to refuse. */
export const NAME_FIELD_CLASS = {
  stack: 'grid gap-2',
  hint: 'm-0 text-meta text-ink-secondary',
  refusal: 'm-0 text-ui text-status-dead-text',
} as const;

const BADGE: Record<Exclude<Lookup, 'none'>, { text: string; tone: string }> = {
  pending: { text: NAME_FIELD_TEXT.lookingUp, tone: 'bg-raised text-ink-tertiary' },
  linear: { text: NAME_FIELD_TEXT.fromLinear, tone: 'bg-phosphor-tint text-ink-primary' },
  offline: { text: NAME_FIELD_TEXT.offline, tone: 'bg-raised text-ink-secondary' },
};

export interface WorkspaceNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  preview: NamePreview;
  /** The project the workspace will be in: the id it will get is `<project>-<slug>`. */
  project: string;
  /** What an empty field means at THIS door ("Leave empty for an automatic name."). */
  emptyHint: string;
  /** A sentence when this door cannot take a name right now: the field is disabled and says it. */
  disabledReason?: string | null;
  /** Opens Settings, for the one line that points there. Absent: the pointer is not drawn. */
  onOpenSettings?: () => void;
}

export function WorkspaceNameField({
  value, onChange, preview, project, emptyHint, disabledReason = null, onOpenSettings,
}: WorkspaceNameFieldProps): ReactNode {
  const id = useId();
  const describedBy = `${id}-preview`;
  const disabled = disabledReason !== null;
  return (
    <div className={NAME_FIELD_CLASS.stack}>
      <label htmlFor={id} className="grid gap-1">
        <span className="route-field-label">{NAME_FIELD_TEXT.label}</span>
        <TextInput
          id={id}
          value={value}
          disabled={disabled}
          placeholder={NAME_FIELD_TEXT.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={!disabled && preview.kind === 'refused' ? true : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      </label>
      <div id={describedBy} aria-live="polite" className="grid min-h-11 content-start gap-1">
        {disabled ? (
          <p className={NAME_FIELD_CLASS.hint}>{disabledReason}</p>
        ) : preview.kind === 'empty' ? (
          <p className={NAME_FIELD_CLASS.hint}>{emptyHint}</p>
        ) : preview.kind === 'refused' ? (
          <p className={NAME_FIELD_CLASS.refusal}>{preview.text}</p>
        ) : (
          <>
            <p className="m-0 flex flex-wrap items-center gap-2 text-ui font-medium text-ink-primary [overflow-wrap:anywhere]">
              <span>{preview.title}</span>
              {preview.lookup !== 'none' && (
                <Chip className={BADGE[preview.lookup].tone}>{BADGE[preview.lookup].text}</Chip>
              )}
            </p>
            <p className="m-0 font-mono text-meta text-ink-secondary [overflow-wrap:anywhere]">
              {`new workspace ${project}-${preview.slug} · branch ws/${preview.slug}`}
            </p>
            {preview.shortened && <p className={NAME_FIELD_CLASS.hint}>{NAME_FIELD_TEXT.shortened}</p>}
            {preview.note !== null && (
              <p className={NAME_FIELD_CLASS.hint}>{LOOKUP_NOTE[preview.note].hint}</p>
            )}
            {preview.note !== null && LOOKUP_NOTE[preview.note].pointer !== null && onOpenSettings !== undefined && (
              <Button variant="ghost" size="fit" className="justify-self-start" onClick={onOpenSettings}>
                {LOOKUP_NOTE[preview.note].pointer}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
