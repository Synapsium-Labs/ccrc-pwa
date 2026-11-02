import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Button, TextInput } from '@ccrc/ui';
import { onPageHidden } from '../lib/pageClock';
import { useLocation } from '../lib/router';

/**
 * THE SECRET FIELD (spec §3.3, §12.4; accounts plan Task A18, D-7740): where a pasted token or key is typed, and the
 * one place in the app its value lives.
 *
 * - `type="password"` with a Show toggle (hidden by default), `autocomplete="off"`, `autocapitalize="off"`,
 *   `spellcheck=false`, `inputmode="text"`, and no `name` a password manager would key on.
 * - THE VALUE LIVES IN THIS FIELD'S OWN DOM NODE, never in React state, a store or browser storage. The field is
 *   uncontrolled on purpose: React keeps a controlled input's `value` ATTRIBUTE in step with what is typed, which would
 *   put the secret in the document's markup, where an `outerHTML` or a mutation observer reads it. The host reads it
 *   once, with {@link SecretFieldHandle.take}, which empties the field in the same call.
 * - IT IS CLEARED on submit (`take`), on close and on a route change (both unmount it, and a route change that keeps it
 *   mounted clears it), and on `visibilitychange` to hidden. A refusal therefore always re-presents it empty.
 */
export interface SecretFieldHandle {
  /** The value, read once: the field is empty when this returns. */
  take(): string;
  /** Empties the field. */
  clear(): void;
}

export interface SecretFieldProps {
  label: string;
  handle: Ref<SecretFieldHandle>;
  /** Told whether the field holds anything, so the host can enable its primary without ever holding the value. */
  onPresence: (has: boolean) => void;
  /** The sentence under the field (a refusal), by id. */
  describedBy?: string;
}

export function SecretField({ label, handle, onPresence, describedBy }: SecretFieldProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  const fieldId = useId();
  const presence = useRef(onPresence);
  presence.current = onPresence;

  const clear = (): void => {
    if (input.current !== null) input.current.value = '';
    presence.current(false);
  };
  useImperativeHandle(handle, () => ({
    take: () => {
      const v = input.current?.value ?? '';
      clear();
      return v;
    },
    clear,
  }), []);

  // Hidden: the app went to the background (another app, the lock screen, a tab switch). The field is emptied, so a
  // secret never waits in a page nobody is looking at.
  useEffect(() => onPageHidden(() => {
    if (document.visibilityState === 'hidden') clear();
  }), []);

  // A route change that keeps the field mounted (a `?lane=` arrival) still empties it.
  const { path, search } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    clear();
  }, [path, search]);

  return (
    <div className="acct-secret">
      <label htmlFor={fieldId}>{label}</label>
      <div className="acct-secret-row">
        <TextInput
          ref={input}
          id={fieldId}
          type={shown ? 'text' : 'password'}
          className="font-mono"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby={describedBy}
          onInput={(e) => presence.current(e.currentTarget.value !== '')}
        />
        <Button variant="ghost" size="fit" className="flex-none" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </Button>
      </div>
    </div>
  );
}
