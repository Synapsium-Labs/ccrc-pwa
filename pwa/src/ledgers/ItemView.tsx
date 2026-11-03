// One item (desktop-polish PL5a, D-7712; spec §2 and §3; the prototype's view 3, and PL6's secret panel): what, why, how as
// numbered steps, a needed-by pill, the history, and the action panel for the item's kind.
//
// The operator moves an item only by ticking it ("Mark done"), or by dismissing it while its programme has no open run;
// both go to the parent as promises, so a refusal comes back as an `ApiError` and is put in the operator's words HERE, with
// the button left enabled: a refused tick leaves the item as it was, and the operator may try again. An item's state is its
// `state` column only (plan PL5b R2): after a return, its note is shown as HISTORY ("sent back: <note>"), never as the
// current state, and a secret item's answer is never rendered at all.
//
// THE SECRET PANEL (plan PL6, spec §5; modelled on the Linear key's field, `screens/LinearSection.tsx`). The value is a
// `type=password` field held in the panel's own state only (never a store, never browser storage), cleared the moment a save
// lands and whenever the page goes to the background, and sent once, to its own route (`PUT /api/items/:id/secret`), never
// to the tick. The save is a credential act: `useStepUp`'s `runAct` runs it once, and a `step-up-required` answer shows
// "Confirm it's you" and waits for the operator to press Save again. A box whose sign-in is not armed (`auth-off`, or a
// plain-HTTP origin, `insecure-origin`) disables the field with the sentence that says why; there is no unconfirmed save.
// What the operator sees after saving is the server's answer: when it was set, its last four characters (none for a short
// value), and whether outgoing text will be masked.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, RadioFieldset, TextInput } from '@ccrc/ui';
import {
  ANSWER_MAX, SECRET_VALUE_MAX, WAITS_ON_WORDS, isSecretValue, recommendationOf, type ItemView as ItemWire, type SecretSaveAnswer,
  type SecretUnmasked, SECRET_TAIL_MIN,
} from '../../../shared/ledgers';
import type { AuthStatus } from '../../../shared/api';
import type { ProgHue } from '../fleet/programmeBoxes';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiError';
import { readAuthStatus } from '../lib/auth';
import { onPageHidden } from '../lib/pageClock';
import { apiErrorText, LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { ageWords, itemPills, KIND_WORD, RECOMMENDED_WORD, RECOMMENDED_WHY_HEADING } from './ledgerWords';
import './ledgers.css';

export interface ItemViewProps {
  readonly item: ItemWire;
  /** Tick the item. `decide` and `value` pass the answer; `do` passes none. Rejects with the route's `ApiError` on a refusal. */
  readonly onTick: (answer?: string) => Promise<void>;
  readonly onDismiss: () => Promise<void>;
  /** The programme has an open run (`programmeIsLive`). When it has none no coordinator is waiting: a tick is refused
   *  `programme-ended`, so only Dismiss is offered, with the line that says why. */
  readonly programmeLive: boolean;
  /** The page clock, epoch ms. */
  readonly now: number;
  /** The programme's name and fleet hue for the band; the slug and no hue when the shell has neither. */
  readonly programme?: { readonly name: string; readonly hue: ProgHue | null };
  /** Sends a secret item's value to its own route (plan PL6). Defaults to the console's client; a test passes its own. */
  readonly saveSecret?: SaveSecret;
  /** The step-up's injectables (a fake box and authenticator in a test); a module constant by default, so it is stable. */
  readonly stepUpDeps?: StepUpDeps;
  /** What the box says of its sign-in (`readAuthStatus`, `lib/auth.ts`): a secret panel on a box whose sign-in is off starts
   *  disabled, so no value is ever sent to it (spec §5, review 1389 A9). A test passes its own. */
  readonly authStatus?: () => Promise<Partial<AuthStatus>>;
}

/** Sends a secret item's value to its own route (`api.saveItemSecret`): the slot's state comes back, never the value. */
export type SaveSecret = (id: number, value: string) => Promise<SecretSaveAnswer>;

/** The panel's default: the console's client call. */
const saveItemSecret: SaveSecret = (id, value) => api.saveItemSecret(id, value);

const NO_STEP_UP_DEPS: StepUpDeps = {};
/** The panel's default reader of the box's sign-in: the console's one spelling of `GET /api/auth/status`. A module constant, so
 *  the panel's effect reads it once. */
const readSignIn = (): Promise<Partial<AuthStatus>> => readAuthStatus();
/** The hook is told the session's step-up is fresh until an act proves otherwise (the Linear card's rule): a panel that
 *  fetched a passkey challenge on every open would also take it from another tab. */
const ASSUME_FRESH = Infinity;

/** The panel's words. */
export const SECRET_TEXT = {
  label: 'The secret',
  hint: `The secret must be a single line. It goes straight into a protected file on the server; the coordinator is told only that it is set and when, and, for a secret of ${SECRET_TAIL_MIN} characters or more, its last four characters.`,
  tooLong: `That is too long to be a secret this console takes (at most ${SECRET_VALUE_MAX} characters).`,
  save: 'Save secret',
  signInOff: 'Saving a secret needs sign-in turned on for this console.',
  saved: (tail: string): string => (tail === '' ? 'Saved.' : `Saved. Ends in ${tail}.`),
  unmasked: {
    'too-short': 'Too short to be masked in outgoing text.',
    'too-long': 'Too long to be masked in outgoing text.',
    unregistered: 'Not registered for masking in outgoing text: the box could not take it just now. Saving it again retries.',
  } satisfies Record<SecretUnmasked, string>,
  stepUpSubject: 'a secret',
} as const;

/** The words where a secret's save means something other than a tick's; every other word is the item's shared sentence
 *  (`LEDGER_REFUSAL_TEXT`, which names the secret route's own two, `not-a-secret-item` and `bad-slot`). */
const SECRET_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'bad-request': `That secret was not accepted. A secret is between 1 and ${SECRET_VALUE_MAX} characters.`,
  oversize: `That is too long to be a secret this console takes (at most ${SECRET_VALUE_MAX} characters).`,
  'write-failed': "The box couldn't store that, so nothing was sent to the coordinator. Try again.",
};
/** Whether the panel may send a value: `asking` until the box answers its sign-in, `dark` when sign-in is off (or a save was
 *  refused `auth-off`/`insecure-origin`, the fallback), `open` otherwise; a box that cannot say opens, and its refusal decides. */
type Posture = 'asking' | 'open' | 'dark';
const GATE_DARK = new Set(['auth-off', 'insecure-origin']);
const wordOf = (err: unknown): string | null => {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const w = (err.body as { error?: unknown }).error;
  return typeof w === 'string' ? w : null;
};

/** The slot's state as a line or two: when it was saved, how it ends, and whether outgoing text masks it. */
function SecretState({ set }: { set: { tail: string; masked: boolean; why?: SecretUnmasked } }): ReactNode {
  return (
    <>
      <p className="wi-status" role="status">{SECRET_TEXT.saved(set.tail)}</p>
      {!set.masked && <p className="wi-hint" data-secret="unmasked">{SECRET_TEXT.unmasked[set.why ?? 'unregistered']}</p>}
    </>
  );
}

/** The Give a secret panel. Shown only while the item is open and its programme has a coordinator to tell. */
function SecretPanel({ item, saveSecret, stepUpDeps, authStatus }: {
  item: ItemWire; saveSecret: SaveSecret; stepUpDeps: StepUpDeps; authStatus: () => Promise<Partial<AuthStatus>>;
}): ReactNode {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [posture, setPosture] = useState<Posture>('asking');
  const dark = posture === 'dark';
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<SecretSaveAnswer['secret'] | null>(null);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The value never waits in a backgrounded page.
  useEffect(() => onPageHidden(() => { setValue(''); }), []);
  // The box's sign-in, read once: off means no value is ever sent (spec §5: "shows the item with its field disabled").
  useEffect(() => {
    let live = true;
    void authStatus().then(
      (s) => { if (live) setPosture((p) => (p === 'dark' ? p : s.mode === 'off' ? 'dark' : 'open')); },
      () => { if (live) setPosture((p) => (p === 'dark' ? p : 'open')); },
    );
    return () => { live = false; };
  }, [authStatus]);

  const trimmed = value.trim();
  // The bound counts the TRIMMED value, the one that is sent: spaces around a paste never cut it short.
  const tooLong = trimmed !== '' && !isSecretValue(trimmed);
  const ready = posture === 'open' && !busy && trimmed !== '' && !tooLong;
  const fieldId = useId();
  const hintId = useId();
  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    try {
      let answer: SecretSaveAnswer | null = null;
      const outcome = await stepUp.runAct(async () => { answer = await saveSecret(item.id, trimmed); });
      if (outcome === 'step-up' || answer === null) return;
      if (!mounted.current) return;
      setValue('');
      setSaved((answer as SecretSaveAnswer).secret);
    } catch (err) {
      const word = wordOf(err);
      if (word !== null && GATE_DARK.has(word)) { setPosture('dark'); setValue(''); return; }
      // A 401 raises the login screen, which is the answer.
      if (err instanceof ApiError && err.status === 401) return;
      setRefusal((word !== null ? SECRET_REFUSAL_TEXT[word] : undefined) ?? refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="wi-secret" data-secret="panel">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="wi-field">
          <label className="wi-label" htmlFor={fieldId}>{SECRET_TEXT.label}</label>
          <TextInput id={fieldId} className="wi-input" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
                     aria-describedby={hintId} value={value} disabled={posture !== 'open'}
                     onChange={(e) => setValue(e.target.value)} />
          <span id={hintId} className="wi-hint">{dark ? SECRET_TEXT.signInOff : SECRET_TEXT.hint}</span>
          {tooLong && !dark && <span className="wi-hint" data-secret="too-long">{SECRET_TEXT.tooLong}</span>}
        </div>
        <div className="wi-actions">
          <Button type="submit" variant="primary" size="fit" disabled={!ready}>{SECRET_TEXT.save}</Button>
        </div>
      </form>
      {/* Outside the form: the step's own passphrase form must never submit the save (the act runs once, D-5512). */}
      <ConfirmItsYou stepUp={stepUp} subject={SECRET_TEXT.stepUpSubject} />
      {saved !== null && <SecretState set={saved} />}
      {refusal !== null && <p className="wi-refusal" role="alert">{refusal}</p>}
    </div>
  );
}

/** The history line of one act, in the operator's words. */
const ACT_WORD: Readonly<Record<ItemWire['history'][number]['act'], string>> = {
  raise: 'Raised by the coordinator', block: 'Became blocking', unblock: 'No longer blocking', tick: 'You marked it done',
  confirm: 'The coordinator confirmed it', return: 'Sent back by the coordinator', withdraw: 'The coordinator withdrew it',
  dismiss: 'You dismissed it',
};

function History({ item, now }: { item: ItemWire; now: number }): ReactNode {
  return (
    <ul className="wi-history" aria-label="History">
      {item.history.map((h, i) => (
        <li key={`${h.at}:${h.act}:${i}`}>
          {h.act === 'return' && h.note !== null ? `sent back: ${h.note}` : ACT_WORD[h.act]}
          {` · ${ageWords(h.at, now)}`}
        </li>
      ))}
    </ul>
  );
}

/** What joins a note to the choice inside the one `answer` string: the tick carries `{answer}` and no more, and the route
 *  takes any decide answer of 1 to `ANSWER_MAX` characters, so a note travels inside it (departure pl5a-note-in-answer). */
const NOTE_JOIN = '\n\nNote: ';
/** The radio value of "Your own answer"; an option's is `o<index>`, so no option's words can collide with it. */
const OWN = 'own';
const OWN_WORD = 'Your own answer';

/** An option's row text: the option's words, and on the one its raiser recommends the "Recommended" mark (plan PL9;
 *  spec §3.2, D24). The mark is words, never colour alone, and it sits inside the option's own label, so it names that option. */
function OptionText({ text, recommended }: { text: string; recommended: boolean }): ReactNode {
  if (!recommended) return text;
  return (
    <span className="wi-opt-text" data-recommended="true">
      {text}
      <span className="wi-rec">{RECOMMENDED_WORD}</span>
    </span>
  );
}

/** One labelled line of text, with a hint under it. */
function Field({ label, value, onChange, maxLength, hint }: {
  label: string; value: string; onChange: (v: string) => void; maxLength: number; hint?: string;
}): ReactNode {
  return (
    <label className="wi-field">
      <span className="wi-label">{label}</span>
      <TextInput className="wi-input" value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      {hint !== undefined && <span className="wi-hint">{hint}</span>}
    </label>
  );
}

function Panel({ item, programmeLive, onTick, onDismiss, saveSecret = saveItemSecret, stepUpDeps = NO_STEP_UP_DEPS, authStatus = readSignIn }:
  Pick<ItemViewProps, 'item' | 'programmeLive' | 'onTick' | 'onDismiss' | 'saveSecret' | 'stepUpDeps' | 'authStatus'>): ReactNode {
  const [pick, setPick] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const options = item.options ?? [];
  const decide = item.kind === 'decide';
  // The one reader of the two fields: an item raised before the rule, or from a server before it, has none and draws as before.
  const rec = recommendationOf(item);
  const whyId = useId();
  // What the operator chose or typed, trimmed; `null` while a decide has no choice yet. `''` is a field left empty.
  const choice: string | null = decide
    ? (pick === OWN ? own.trim() : pick === null ? null : options[Number(pick.slice(1))] ?? null)
    : item.kind === 'value' ? typed.trim() : null;
  const noteText = note.trim();
  const noteCost = noteText === '' ? 0 : NOTE_JOIN.length + noteText.length;
  const answer: string | null = choice === null ? null : decide && noteText !== '' ? `${choice}${NOTE_JOIN}${noteText}` : choice;
  const tooLong = answer !== null && answer.length > ANSWER_MAX;
  const needsAnswer = decide || item.kind === 'value';
  // A decision is an option, or own text that is not empty: a note alone is not one (it would send the coordinator "Note: …" with no choice).
  const ready = !needsAnswer || (choice !== null && choice !== '' && !tooLong);

  const run = async (act: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try { await act(); } catch (err) { setRefusal(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err)); } finally { setBusy(false); }
  };

  const open = item.state === 'open';
  const checking = item.state === 'checking';
  // A programme with no open run has no coordinator waiting for a tick: nothing is asked, and only Dismiss is offered.
  const ended = (open || checking) && !programmeLive;
  const mayTick = open && programmeLive && item.kind !== 'secret';
  return (
    <section className="wi-card wi-act" aria-label="Your move">
      {ended && <p className="wi-hint">{WAITS_ON_WORDS.ended}</p>}
      {mayTick && decide && (
        <>
          {/* The reasons come BEFORE the choices and describe them, so they are read before the pick; nothing is picked for
              the operator, who may take any option or write their own. */}
          {rec !== null && (
            <section className="wi-why-rec" aria-label={RECOMMENDED_WHY_HEADING}>
              <h3 className="wi-h">{RECOMMENDED_WHY_HEADING}</h3>
              <p id={whyId} className="wi-text">{rec.why}</p>
            </section>
          )}
          <RadioFieldset legend="Your decision" name={`item-${item.id}`} optionClassName="wi-opt"
                         {...(rec === null ? {} : { describedBy: whyId })}
                         options={[
                           ...options.map((o, i) => ({ value: `o${i}`, label: <OptionText text={o} recommended={rec?.index === i} /> })),
                           { value: OWN, label: OWN_WORD },
                         ]}
                         value={pick} onPick={setPick} />
          {pick === OWN && <Field label={OWN_WORD} value={own} onChange={setOwn} maxLength={ANSWER_MAX - noteCost} />}
          <Field label="Note to the coordinator (optional)" value={note} onChange={setNote}
                 maxLength={Math.max(0, ANSWER_MAX - (choice?.length ?? 0) - NOTE_JOIN.length)} />
        </>
      )}
      {mayTick && item.kind === 'value' && (
        <Field label="Your value" value={typed} onChange={setTyped} maxLength={ANSWER_MAX}
               hint="An ordinary value: it is sent to the coordinator and may be written into the programme ledger." />
      )}
      {mayTick && needsAnswer && answer !== null && (
        <span className="wi-hint">{`${answer.length} of ${ANSWER_MAX} characters`}</span>
      )}
      {mayTick && item.kind === 'do' && (
        <p className="wi-hint">Nothing to fill in. The coordinator checks it itself and either closes the item or sends it back with what it found.</p>
      )}
      {open && programmeLive && item.kind === 'secret' && <SecretPanel item={item} saveSecret={saveSecret} stepUpDeps={stepUpDeps} authStatus={authStatus} />}
      {checking && item.kind === 'secret' && item.secretSet !== null && <SecretState set={item.secretSet} />}
      {checking && (
        <p className="wi-status" role="status" data-stale={item.stale ? 'true' : 'false'}>
          {item.stale
            ? 'Your tick was sent, but the coordinator is not responding. You can leave this page.'
            : 'The coordinator has been told and will confirm this or send it back. You can leave this page.'}
        </p>
      )}
      {refusal !== null && <p className="wi-refusal" role="alert">{refusal}</p>}
      <div className="wi-actions">
        {mayTick && (
          <Button variant="primary" size="fit" disabled={busy || !ready}
                  onClick={() => void run(() => (answer === null || !needsAnswer ? onTick() : onTick(answer)))}>Mark done</Button>
        )}
        {ended && (
          <Button variant="ghost" size="fit" disabled={busy} onClick={() => void run(onDismiss)}>Dismiss</Button>
        )}
      </div>
    </section>
  );
}

export function ItemView({ item, onTick, onDismiss, programmeLive, now, programme, saveSecret, stepUpDeps, authStatus }: ItemViewProps): ReactNode {
  const pills = itemPills(item);
  const name = programme?.name ?? item.program;
  return (
    <div className="wi">
      <div className="wi-band" data-hue={programme?.hue ?? 'none'}>
        <span className="wi-prog">{name}</span>
        {pills.map((p) => <span key={p.tone} className="wl-pill wi-pill" data-tone={p.tone}>{p.word}</span>)}
      </div>
      <div className="wi-detail">
        <div className="wi-card">
          <span className="wl-kind wi-kind">{KIND_WORD[item.kind]}</span>
          <h1 className="wi-what">{item.title}</h1>
          <section>
            <h3 className="wi-h">Why</h3>
            <p className="wi-text">{item.why}</p>
          </section>
          {item.how.length > 0 && (
            <section>
              <h3 className="wi-h">How</h3>
              <ol className="wi-steps" aria-label="How">{item.how.map((s, i) => <li key={`${i}:${s}`}>{s}</li>)}</ol>
            </section>
          )}
          <section>
            <h3 className="wi-h">History</h3>
            <History item={item} now={now} />
          </section>
        </div>
        <Panel item={item} programmeLive={programmeLive} onTick={onTick} onDismiss={onDismiss}
               {...(saveSecret === undefined ? {} : { saveSecret })} {...(stepUpDeps === undefined ? {} : { stepUpDeps })}
               {...(authStatus === undefined ? {} : { authStatus })} />
      </div>
    </div>
  );
}
