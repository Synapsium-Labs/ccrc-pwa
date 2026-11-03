import { useId, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Button, TextInput } from '@ccrc/ui';
import { CODE_FIELD_LABEL, SEND_CODE } from '../fleet/accountWords';

/**
 * THE CODE FIELD (spec §6.2 step 6, §3.7, §12.4; accounts plan Task A22, D-7849): where the operator pastes the code
 * claude.ai shows after the sign-in, and **Send code**.
 *
 * - Mono, `autocomplete="one-time-code"`, `autocapitalize="off"`, `spellcheck=false`, `inputmode="text"`, and no `name`
 *   a password manager would key on. PASTE-FIRST: a paste replaces the field with the pasted text, trimmed of the
 *   whitespace a copy from a page carries; what is sent is trimmed again.
 * - THE CODE LIVES IN THIS FIELD'S OWN DOM NODE (the secret field's rule, D-7740): the input is uncontrolled, so the
 *   value is never a React state, a store, `localStorage`, `sessionStorage` or IndexedDB, and never the markup's
 *   `value` attribute. It is read once, on Send, which empties the field.
 * - SENT ONCE (spec §3.7: one code per attempt). The first Send disables the field and the button for this mount, before
 *   the host's answer comes, so a second tap sends nothing. A host that learns nothing was sent (a code off its shape,
 *   the server's `bad-code`) mounts a fresh field (a new `key`) for the next paste.
 */
export function CodeField({ onSend, disabled = false, describedBy }: {
  /** Called once with the trimmed code; the field is empty and disabled when it is called. */
  onSend: (code: string) => void;
  /** The host's own hold (offline, an act in flight): nothing may be sent. */
  disabled?: boolean;
  describedBy?: string;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [has, setHas] = useState(false);
  const [sent, setSent] = useState(false);
  const once = useRef(false);
  const fieldId = useId();

  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text');
    if (text === '') return;
    e.preventDefault();
    e.currentTarget.value = text.trim();
    setHas(e.currentTarget.value !== '');
  };
  const send = (): void => {
    if (once.current || disabled) return;
    const v = (input.current?.value ?? '').trim();
    if (v === '') return;
    once.current = true;
    if (input.current !== null) input.current.value = '';
    setHas(false);
    setSent(true);
    onSend(v);
  };
  const held = sent || disabled;
  return (
    <div className="acct-field acct-code">
      <label htmlFor={fieldId}>{CODE_FIELD_LABEL}</label>
      <div className="acct-secret-row">
        <TextInput
          ref={input}
          id={fieldId}
          className="font-mono"
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          disabled={held}
          aria-describedby={describedBy}
          onPaste={onPaste}
          onInput={(e) => setHas(e.currentTarget.value.trim() !== '')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
        />
        <Button variant="primary" size="fit" className="flex-none acct-code-send" disabled={held || !has} onClick={send}>
          {SEND_CODE}
        </Button>
      </div>
    </div>
  );
}
