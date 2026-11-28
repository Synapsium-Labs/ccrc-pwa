import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Button, TextInput } from '@ccrc/ui';
import { onPageHidden } from '../lib/pageClock';
import { SECRET_INPUT } from '../lib/secretInput';
import { useLocation } from '../lib/router';

/**
 * THE SECRET FIELD (spec §3.3, §12.4; accounts plan Task A18, D-7740): where a pasted token or key is typed, and the
 * one place in the app its value lives.
 *
 * - `type="password"` with a Show toggle (hidden by default), {@link SECRET_INPUT} (autocomplete, capitalisation,
 *   correction and spellcheck off, and the password managers' opt-outs, D-8404), `inputmode="text"`, and no `name` a
 *   password manager would key on.
 * - THE VALUE LIVES IN THIS FIELD'S OWN DOM NODE, never in React state, a store or browser storage. The field is
 *   uncontrolled on purpose: React keeps a controlled input's `value` ATTRIBUTE in step with what is typed, which would
 *   put the secret in the document's markup, where an `outerHTML` or a mutation observer reads it. The host reads it
 *   once, with {@link SecretFieldHandle.take}, which empties the field in the same call.
 * - IT IS CLEARED on submit (`take`), on close and on a route change (both unmount it, and a route change that keeps it
 *   mounted clears it), and on `visibilitychange` to hidden. A refusal therefore always re-presents it empty.
 * - A HOST WHOSE DOOR MAY ASK THE STEP-UP reads with {@link SecretFieldHandle.peek} instead (Overlord W2 Settings, ruled call
 *   1815, review 4139 F1): the value stays in the field, so the retry the confirm starts sends it once more, and the host empties
 *   the field with `clear` on the door's answer and on every refusal, never on a first `step-up-required`. What `peek` returns
 *   lives in the request body it builds and nowhere else: the host reads it inside the request, and makes its retry outside the
 *   send, so no value stands in the scope its retry is made in (review 4167 F1). From the press to the end of the step (its send
 *   in flight, then the step) the host passes `held`, which disables the field, so nothing is typed into it before the retry reads
 *   it (F2; review 4183 F1). The Show toggle is not held (it sends nothing). Held, the field is still emptied by its own rule (a
 *   page hide, a route change that keeps it mounted), and a retry that finds it emptied sends nothing and says so: it never sends
 *   less than the first send carried. The account sheets read with `take` and never pass `held`, as before.
 * - `multiline` draws an uncontrolled text area instead (the private-name list): unmasked, because the operator must see the
 *   names, with no Show control, and the same attributes and the same emptying on page hide and route change. ITS ONE EXCEPTION
 *   to "a refusal re-presents it empty" (review 4139 A2, slug `names-kept-only-to-be-edited`): the names stay only where the
 *   operator must edit or confirm them, a refused row, a refused cap and a first step-up, so a `bad-request` or an `oversize`
 *   keeps them; so does the one server fault that answers `bad-request` with no row (a row it could not hash), which the console's
 *   own body cannot cause. A 401 empties it, because the person at the screen is no longer proven, and so does every other
 *   refusal.
 */
export interface SecretFieldHandle {
  /** The value, read once: the field is empty when this returns. */
  take(): string;
  /** The value, read without emptying the field: the host empties it itself (`clear`) once the door has answered. */
  peek(): string;
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
  /** An uncontrolled, unmasked text area of several lines, with no Show control. */
  multiline?: boolean;
  /** Held by its host while a step shows (Overlord W2 Settings, review 4167 F2): disabled, its value kept. Absent: as before. */
  held?: boolean;
}

export function SecretField({ label, handle, onPresence, describedBy, multiline = false, held = false }: SecretFieldProps): ReactNode {
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
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
    peek: () => input.current?.value ?? '',
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

  if (multiline) {
    return (
      <div className="acct-secret">
        <label htmlFor={fieldId}>{label}</label>
        <textarea
          ref={input}
          id={fieldId}
          className="acct-secret-text font-mono"
          rows={6}
          {...SECRET_INPUT}
          disabled={held}
          aria-describedby={describedBy}
          onInput={(e) => presence.current(e.currentTarget.value !== '')}
        />
      </div>
    );
  }
  return (
    <div className="acct-secret">
      <label htmlFor={fieldId}>{label}</label>
      <div className="acct-secret-row">
        <TextInput
          ref={input}
          id={fieldId}
          type={shown ? 'text' : 'password'}
          className="font-mono"
          {...SECRET_INPUT}
          inputMode="text"
          disabled={held}
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
