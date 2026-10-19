import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, TextInput } from '@ccrc/ui';
import type { StepUp } from './useStepUp';

export { LOCKED_TEXT } from './useStepUp';

/**
 * "CONFIRM IT'S YOU" (D-5512, spec §3.2; accounts plan Task A6; D-5690): the explicit step an account sheet shows
 * before Continue, Remove or Replace when the session's step-up is no longer fresh. The sheet owns the step
 * (`useStepUp`) so its act can feed a `step-up-required` refusal back; this draws it, and draws nothing while the
 * stamp is fresh.
 *
 * A body, not a container: it sits inside whatever `Sheet` the account sheet opened, and its width is the sheet's.
 * Both skins draw it through the same primitives, so there is nothing here a skin varies.
 */
export function ConfirmItsYou({ stepUp }: { stepUp: StepUp }): ReactNode {
  if (!stepUp.needed) return null;
  const { arm } = stepUp;
  return (
    <div className="flex flex-col gap-3" data-step-up={arm}>
      {arm !== 'locked' && arm !== 'unavailable' && (
        <p className="m-0">Changing an account needs a fresh check that it&apos;s you.</p>
      )}
      {/* A live region: a refusal arrives after the tap, so it announces itself. */}
      <p className="m-0" role="status">{stepUp.notice ?? ''}</p>
      {(arm === 'loading' || arm === 'passkey') && (
        // `confirm` is synchronous by contract: the passkey prompt opens inside this tap's user activation.
        <Button variant="primary" disabled={!stepUp.ready} onClick={stepUp.confirm}>
          {stepUp.busy ? 'Confirming…' : "Confirm it's you"}
        </Button>
      )}
      {arm === 'passphrase' && <PassphraseStep stepUp={stepUp} />}
      {arm === 'unavailable' && stepUp.canRetry && (
        <Button variant="ghost" onClick={stepUp.retry}>Try again</Button>
      )}
    </div>
  );
}

/**
 * The passphrase arm, on a box with no passkey enrolled. Its own component so the field's value lives only while the
 * arm shows: it is cleared on submit (before the answer), when the step hides (this unmounts), and when the page
 * goes to the background (spec §3.3's rule for a secret in a sheet). It never enters a store or browser storage.
 */
function PassphraseStep({ stepUp }: { stepUp: StepUp }): ReactNode {
  const [passphrase, setPassphrase] = useState('');
  const fieldId = useId();
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') setPassphrase('');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const value = passphrase;
    setPassphrase('');
    stepUp.submitPassphrase(value);
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label htmlFor={fieldId}>Passphrase</label>
      <TextInput
        id={fieldId}
        type="password"
        autoComplete="current-password"
        spellCheck={false}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={stepUp.busy || passphrase === ''}>
        {stepUp.busy ? 'Confirming…' : 'Confirm with passphrase'}
      </Button>
    </form>
  );
}
