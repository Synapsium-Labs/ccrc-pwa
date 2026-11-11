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
// What the operator sees after saving is the server's answer: when it was set, its last four characters (none for a value
// outgoing text will not mask), and whether outgoing text will be masked.
//
// A STORED SECRET OUTLIVES ITS ITEM (the operator's ruling on programme item 9): while the item's slot holds a value, the view
// says "Stored" with a Remove control (`StoredSecretRemove`, which the programme screen's "Stored secrets" section shares). A
// Remove asks for confirmation, is a credential act like the save (the same step-up), and never shows any part of the value.
// A slot that holds a value whose record cannot be read (`secretSet: {at: null}`, review 1416 F4) is stored all the same: the
// view says "Stored" with its Remove, and nothing of when or how. A slot the box cannot read at all (`{unreadable: true}`,
// review 1418 F2) is neither stored nor empty as far as anyone knows: the view says so in its own slot-level sentence
// (`STORED_TEXT.slotUnreadable`; review 1440 F4), and offers no Remove and no field to give a secret.
//
// THE BAND AND THE TEXT (desktop-polish PL10, D-7952; spec §2, D26 to D28). The band's programme name is a door to the programme
// view, and a "Spec" link opens its pinned spec in the Docs reader, both addresses handed in by the route (`programme.href`,
// `programme.specHref`), so this file still names no route. The item's what, why, steps and history are drawn through
// `linkRuns`: an `https` address opens in a new tab with no opener, a console path and a repository document path (in the
// programme's home project's Docs reader) open in the console, and anything else, `javascript:` and `data:` included, is text.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, RadioFieldset, TextInput, TextLink } from '@ccrc/ui';
import {
  ANSWER_MAX, SECRET_VALUE_MAX, WAITS_ON_WORDS, isSecretValue, recommendationOf, type ItemView as ItemWire, type SecretRemoveAnswer,
  type SecretSaveAnswer, type SecretUnmasked, SECRET_TAIL_MIN,
} from '../../../shared/ledgers';
import type { AuthStatus, FleetSession, RunSummary } from '../../../shared/api';
import type { ProgHue } from '../fleet/programmeBoxes';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { api } from '../lib/api';
import { inAppClick } from '../fleet/settingsText';
import { openExternal } from '../lib/markdown';
import { ApiError } from '../lib/apiError';
import { readAuthStatus } from '../lib/auth';
import { onPageHidden } from '../lib/pageClock';
import { apiErrorText, LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { SpecLink } from './GoalsPanel';
import { linkRuns } from './ledgerLinks';
import { ItemControls, useItemActs, type ItemActs } from './ItemActs';
import { ageWords, itemNumber, itemPills, KIND_WORD, NOT_CURRENT_ACTS_WORD, RECOMMENDED_WORD, RECOMMENDED_WHY_HEADING } from './ledgerWords';
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
  /** The programme's name and fleet hue for the band; the slug and no hue when the shell has neither. `href` is the programme
   *  view's path (null: the name is words), `specHref` its pinned spec in the Docs reader (null: no Spec link), and
   *  `homeProject` the repository a document path in the item's text opens in (null: such a path stays text). */
  readonly programme?: {
    readonly name: string; readonly hue: ProgHue | null;
    readonly href?: string | null; readonly specHref?: string | null; readonly homeProject?: string | null;
  };
  /** Sends a secret item's value to its own route (plan PL6). Defaults to the console's client; a test passes its own. */
  readonly saveSecret?: SaveSecret;
  /** Removes a stored secret (the Remove door). Defaults to the console's client; a test passes its own. */
  readonly removeSecret?: RemoveSecret;
  /** The step-up's injectables (a fake box and authenticator in a test); a module constant by default, so it is stable. */
  readonly stepUpDeps?: StepUpDeps;
  /** What the box says of its sign-in (`readAuthStatus`, `lib/auth.ts`): a secret panel on a box whose sign-in is off starts
   *  disabled, so no value is ever sent to it (spec §5, review 1389 A9). A test passes its own. */
  readonly authStatus?: () => Promise<Partial<AuthStatus>>;
  /** Whether the item is drawn from live data (console speed, Task C4; spec §2.6, D16). `false` when it is the device's
   *  saved copy: Mark done, Dismiss, the secret's Save and the stored secret's Remove are disabled and refuse, and the reason
   *  is drawn once beside them; the fields stay enabled and keep their text, so an answer typed now is sent once live data
   *  lands. Default `true`, so every other caller is unchanged. */
  readonly current?: boolean;
  /** The runs heard (`null` before the runs frame): an end-request item's Abandon run names its run, so it is drawn once the
   *  run is among them. Absent, the item draws only the controls that need no run. */
  readonly runs?: readonly RunSummary[] | null;
  /** The fleet rows heard, for the abandon sheet's line about a child workspace. */
  readonly sessions?: readonly FleetSession[] | null;
  /** Told when Abandon run or Keep the run landed: the item has closed, so the page steps back to its list. */
  readonly onActed?: () => void;
}

/** Sends a secret item's value to its own route (`api.saveItemSecret`): the slot's state comes back, never the value. */
export type SaveSecret = (id: number, value: string) => Promise<SecretSaveAnswer>;

/** The panel's default: the console's client call. */
const saveItemSecret: SaveSecret = (id, value) => api.saveItemSecret(id, value);
/** Removes one stored secret (`api.removeStoredSecret`): the slot comes back, never any part of the value. */
export type RemoveSecret = (program: string, slot: string) => Promise<SecretRemoveAnswer>;
/** The Remove control's default: the console's client call. */
export const removeStoredSecret: RemoveSecret = (program, slot) => api.removeStoredSecret(program, slot);

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
  // Bytes, as the server counts (review 1391 F3): the tail is told only for a value of at least SECRET_TAIL_MIN UTF-8 bytes that
  // outgoing text will mask (review 1391 F2), never by a second floor in characters.
  hint: `The secret must be a single line. It goes straight into a protected file on the server. The coordinator is told only that it is set and when, and its last four characters only if it is at least ${SECRET_TAIL_MIN} bytes long and outgoing text will mask it.`,
  tooLong: `That is too long to be a secret this console takes (at most ${SECRET_VALUE_MAX} bytes).`,
  save: 'Save secret',
  signInOff: 'Saving a secret needs sign-in turned on for this console.',
  insecureOrigin: 'Saving a secret needs this console opened over HTTPS.',
  saved: (tail: string): string => (tail === '' ? 'Saved.' : `Saved. Ends in ${tail}.`),
  unmasked: {
    'too-short': 'Too short to be masked in outgoing text.',
    'too-long': 'Too long to be masked in outgoing text.',
    'not-one-run': 'Not masked in outgoing text: it holds a space, or a sign such as : = or a comma, where outgoing text is split, so it could never be caught whole. The coordinator was told none of its characters.',
    unregistered: 'Not registered for masking in outgoing text: the box could not take it just now. Saving it again retries.',
  } satisfies Record<SecretUnmasked, string>,
  stepUpSubject: 'a secret',
} as const;

/** The stored-secret words: the item view's "Stored" line and the programme screen's section (programme item 9). No sentence
 *  names any part of a value. */
export const STORED_TEXT = {
  stored: 'Stored.',
  remove: 'Remove',
  removeLabel: (slot: string): string => `Remove the stored secret ${slot}`,
  confirmTitle: (slot: string): string => `Remove the stored secret ${slot}?`,
  confirmConsequence: [
    'The secret is deleted from this server. The coordinator is not told, and nothing that needs it can read it any more.',
    'Outgoing text keeps masking it until the server restarts.',
  ],
  removed: 'Removed.',
  stepUpSubject: 'removing a secret',
  heading: 'Stored secrets',
  unreadable: 'The stored secrets of this programme could not be read.',
  /** One item's slot that the box could not read (review 1426 F-F): this slot, not the programme's whole store. */
  slotUnreadable: 'The box could not read the secret saved for this item, so this page cannot tell whether one is stored. Check that the server can read its folder of stored secrets on the box, then reload this page.',
  savedAt: (age: string | null): string => (age === null ? 'Saved at a time the box has no record of' : `Saved ${age}`),
  askedBy: (title: string | null): string => (title === null ? 'No item on record' : `Asked for by: ${title}`),
} as const;

/** The words where a secret's save means something other than a tick's; every other word is the item's shared sentence
 *  (`LEDGER_REFUSAL_TEXT`, which names the secret route's own two, `not-a-secret-item` and `bad-slot`). */
const SECRET_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'bad-request': `That secret was not accepted. A secret is between 1 and ${SECRET_VALUE_MAX} bytes.`,
  oversize: `That is too long to be a secret this console takes (at most ${SECRET_VALUE_MAX} bytes).`,
  'write-failed': "The box couldn't store that, so nothing was sent to the coordinator. Try again.",
};
/** Whether the panel may send a value: `asking` until the box answers its sign-in, `dark` when sign-in is off (or a save was
 *  refused `auth-off`/`insecure-origin`, the fallback), `open` otherwise; a box that cannot say opens, and its refusal decides. */
type Posture = 'asking' | 'open' | 'dark';
/** Why a dark panel is dark, each with its own sentence (review 1391 A-7: a plain-HTTP origin is not "sign-in turned off"). */
const GATE_DARK: Readonly<Record<string, 'signInOff' | 'insecureOrigin'>> = { 'auth-off': 'signInOff', 'insecure-origin': 'insecureOrigin' };
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
function SecretPanel({ item, saveSecret, stepUpDeps, authStatus, current }: {
  item: ItemWire; saveSecret: SaveSecret; stepUpDeps: StepUpDeps; authStatus: () => Promise<Partial<AuthStatus>>; current: boolean;
}): ReactNode {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [posture, setPosture] = useState<Posture>('asking');
  const [darkWhy, setDarkWhy] = useState<'signInOff' | 'insecureOrigin'>('signInOff');
  const dark = posture === 'dark';
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<SecretSaveAnswer['secret'] | null>(null);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The value never waits in a backgrounded page.
  useEffect(() => onPageHidden(() => { setValue(''); }), []);
  // The box's sign-in, read once: off means no value is ever sent (spec §5: "shows the item with its field disabled").
  // `mode === 'off'` and not `armedMode` (`lib/auth.ts`), LEGITIMATELY DIFFERENT (review 1391 A-8): `armedMode` answers what
  // the console may assume is armed, failing closed; this read only decides whether to disable a field before the server
  // decides, so it fails OPEN (an unknown or failed status opens the field) and the server's refusal stays the gate.
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
  // A saved copy sends nothing: the field keeps its text, and Save opens once live data lands.
  const ready = current && posture === 'open' && !busy && trimmed !== '' && !tooLong;
  const fieldId = useId();
  const hintId = useId();
  const tooLongId = useId();
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
      const why = word === null ? undefined : GATE_DARK[word];
      if (why !== undefined) { setDarkWhy(why); setPosture('dark'); setValue(''); return; }
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
                     aria-describedby={tooLong && !dark ? `${hintId} ${tooLongId}` : hintId} value={value} disabled={posture !== 'open'}
                     onChange={(e) => setValue(e.target.value)} />
          <span id={hintId} className="wi-hint">{dark ? SECRET_TEXT[darkWhy] : SECRET_TEXT.hint}</span>
          {tooLong && !dark && <span id={tooLongId} className="wi-hint" role="alert" data-secret="too-long">{SECRET_TEXT.tooLong}</span>}
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

/**
 * THE REMOVE CONTROL OF ONE STORED SECRET (the operator's ruling on programme item 9), shared by the item view and the programme
 * screen's "Stored secrets" section. Remove opens a confirmation; Confirm runs the removal once through the step-up (`runAct`),
 * and a `step-up-required` answer shows "Confirm it's you" and waits for the operator to press Remove again, as the save does.
 * A removal refused `secret-not-stored` is a removal already made: `onRemoved` runs either way. Nothing here sees a value.
 */
export function StoredSecretRemove({ program, slot, onRemoved, removeSecret = removeStoredSecret, stepUpDeps = NO_STEP_UP_DEPS, current = true }: {
  program: string; slot: string; onRemoved?: () => void; removeSecret?: RemoveSecret; stepUpDeps?: StepUpDeps;
  /** `false` on an item drawn from the device's saved copy: Remove is disabled and refuses (`ItemViewProps.current`). */
  current?: boolean;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const remove = async (): Promise<void> => {
    if (!current) return;
    setBusy(true);
    setRefusal(null);
    try {
      let removed = false;
      const outcome = await stepUp.runAct(async () => { await removeSecret(program, slot); removed = true; });
      if (outcome === 'step-up' || !removed || !mounted.current) return;
      setDone(true);
      onRemoved?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (wordOf(err) === 'secret-not-stored') { if (mounted.current) setDone(true); onRemoved?.(); return; }
      if (mounted.current) setRefusal(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  if (done) return <span className="wi-status" role="status" data-secret="removed">{STORED_TEXT.removed}</span>;
  return (
    <div className="wi-stored-remove" data-secret="remove">
      <Button variant="ghost" size="fit" disabled={busy || !current} aria-label={STORED_TEXT.removeLabel(slot)}
              onClick={() => { if (current) setAsking(true); }}>
        {STORED_TEXT.remove}
      </Button>
      <ConfirmItsYou stepUp={stepUp} subject={STORED_TEXT.stepUpSubject} />
      {refusal !== null && <p className="wi-refusal" role="alert">{refusal}</p>}
      <QuickConfirm open={asking} onClose={() => setAsking(false)} tone="danger" defaultFocus="cancel"
                    title={STORED_TEXT.confirmTitle(slot)} consequence={[...STORED_TEXT.confirmConsequence]}
                    confirmLabel={STORED_TEXT.remove} onConfirm={() => { setAsking(false); void remove(); }} />
    </div>
  );
}

/** The raise line of an item ccrc itself raised (a worker's or reviewer's end request that its coordinator left unanswered): the
 *  wire's actor says so, so the line never credits the coordinator with it. */
const RAISED_BY_CCRC = 'Raised for you, its coordinator did not answer';

/** The history line of one act, in the operator's words. */
const ACT_WORD: Readonly<Record<ItemWire['history'][number]['act'], string>> = {
  raise: 'Raised by the coordinator', block: 'Became blocking', unblock: 'No longer blocking', tick: 'You marked it done',
  confirm: 'The coordinator confirmed it', return: 'Sent back by the coordinator', withdraw: 'The coordinator withdrew it',
  dismiss: 'You dismissed it', act: 'You acted on it', decline: 'You declined it', settle: 'It settled on its own',
};

/** Text with its links drawn as links (`linkRuns`, PL10): an outside page in a new tab with no opener, through `openExternal`,
 *  as every outside link of the console is (an installed app's own window must not navigate, review 1466 F10); a console or
 *  Docs path through the console's own navigation. The split is made once per text and home (review 1466 F9). */
function Linked({ text, homeProject }: { text: string; homeProject: string | null }): ReactNode {
  const runs = useMemo(() => linkRuns(text, homeProject), [text, homeProject]);
  return runs.map((r, i) => {
    if (r.kind === 'text') return <span key={i}>{r.text}</span>;
    return r.external
      ? <TextLink key={i} href={r.href} onClick={(e) => openExternal(e, r.href)}>{r.text}</TextLink>
      : <TextLink key={i} href={r.href} onClick={inAppClick(r.href)}>{r.text}</TextLink>;
  });
}

function History({ item, now, homeProject }: { item: ItemWire; now: number; homeProject: string | null }): ReactNode {
  return (
    <ul className="wi-history" aria-label="History">
      {item.history.map((h, i) => (
        <li key={`${h.at}:${h.act}:${i}`}>
          {h.act === 'return' && h.note !== null ? <Linked text={`sent back: ${h.note}`} homeProject={homeProject} />
            : h.act === 'raise' && h.actor === 'ccrc' ? RAISED_BY_CCRC : ACT_WORD[h.act]}
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
 *  spec §3.2, D24). The mark is words, never colour alone, and it sits inside the option's own label, so it names that option.
 *  A real space parts the two (the flex gap draws it, but an accessible name is built from the text): "Keep the order
 *  Recommended", never "Keep the orderRecommended" (fix round 1, F8), as `OptionRow` parts its label from its tag. */
function OptionText({ text, recommended }: { text: string; recommended: boolean }): ReactNode {
  if (!recommended) return text;
  return (
    <span className="wi-opt-text" data-recommended="true">
      {text}{' '}
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

function Panel({ item, programmeLive, onTick, onDismiss, saveSecret = saveItemSecret, removeSecret = removeStoredSecret, stepUpDeps = NO_STEP_UP_DEPS, authStatus = readSignIn, current = true, runs = null, acts }:
  Pick<ItemViewProps, 'item' | 'programmeLive' | 'onTick' | 'onDismiss' | 'saveSecret' | 'removeSecret' | 'stepUpDeps' | 'authStatus' | 'current' | 'runs'> & { acts: ItemActs }): ReactNode {
  const [pick, setPick] = useState<string | null>(null);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The slot's state, told apart (reviews 1416 F4 and 1418 F2): stored (with or without a record), saved with a record, or
  // unreadable; null and an unreadable slot are never "stored".
  const set = item.secretSet;
  const unreadable = set !== null && 'unreadable' in set;
  const stored = set !== null && 'at' in set ? set : null;
  const saved = stored !== null && stored.at !== null ? stored : null;

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
    // A saved copy sends nothing, whatever reached this (the buttons are disabled too).
    if (!current) return;
    setBusy(true);
    setRefusal(null);
    try { await act(); } catch (err) { setRefusal(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err)); } finally { setBusy(false); }
  };

  const open = item.state === 'open';
  const checking = item.state === 'checking';
  // An item with an action has its own controls (spec §10, §12.2): its act closes it, so it is never ticked or dismissed.
  const acting = (item.action ?? null) !== null;
  // A programme with no open run has no coordinator waiting for a tick: nothing is asked, and only Dismiss is offered.
  const ended = (open || checking) && !programmeLive && !acting;
  const mayTick = open && programmeLive && item.kind !== 'secret' && !acting;
  const secretOpen = open && programmeLive && item.kind === 'secret' && !unreadable;
  const removable = item.kind === 'secret' && stored !== null && item.secretSlot !== null;
  // Why the acts are off on a saved copy, said once, and only where there is an act to be off.
  const notCurrent = !current && (mayTick || ended || secretOpen || removable);
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
      {secretOpen && <SecretPanel item={item} saveSecret={saveSecret} stepUpDeps={stepUpDeps} authStatus={authStatus} current={current} />}
      {checking && item.kind === 'secret' && saved !== null && <SecretState set={saved} />}
      {removable && item.secretSlot !== null && stored !== null && (
        <div className="wi-stored" data-secret="stored">
          <span className="wi-status">{STORED_TEXT.stored}</span>
          <StoredSecretRemove key={`${item.secretSlot}:${stored.at ?? 'unrecorded'}`} program={item.program} slot={item.secretSlot}
                              removeSecret={removeSecret} stepUpDeps={stepUpDeps} current={current} />
        </div>
      )}
      {item.kind === 'secret' && unreadable && (
        <p className="wi-refusal" data-secret="unreadable">{STORED_TEXT.slotUnreadable}</p>
      )}
      {checking && (
        <p className="wi-status" role="status" data-stale={item.stale ? 'true' : 'false'}>
          {item.stale
            ? 'Your tick was sent, but the coordinator is not responding. You can leave this page.'
            : 'The coordinator has been told and will confirm this or send it back. You can leave this page.'}
        </p>
      )}
      {refusal !== null && <p className="wi-refusal" role="alert">{refusal}</p>}
      {notCurrent && <p className="wi-hint" data-current="false">{NOT_CURRENT_ACTS_WORD}</p>}
      <div className="wi-actions">
        {acting && <ItemControls item={item} runs={runs} acts={acts} enabled={current} />}
        {mayTick && (
          <Button variant="primary" size="fit" disabled={busy || !ready || !current}
                  onClick={() => void run(() => (answer === null || !needsAnswer ? onTick() : onTick(answer)))}>Mark done</Button>
        )}
        {ended && (
          <Button variant="ghost" size="fit" disabled={busy || !current} onClick={() => void run(onDismiss)}>Dismiss</Button>
        )}
      </div>
    </section>
  );
}

export function ItemView({ item, onTick, onDismiss, programmeLive, now, programme, saveSecret, removeSecret, stepUpDeps, authStatus, current = true, runs = null, sessions = null, onActed }: ItemViewProps): ReactNode {
  const { acts, sheets } = useItemActs(sessions, onActed);
  const pills = itemPills(item);
  const name = programme?.name ?? item.program;
  const href = programme?.href ?? null;
  const home = programme?.homeProject ?? null;
  return (
    <div className="wi">
      <div className="wi-band" data-hue={programme?.hue ?? 'none'}>
        {href === null
          ? <span className="wi-prog">{name}</span>
          : <TextLink href={href} onClick={inAppClick(href)} className="wi-prog-door">{name}</TextLink>}
        {pills.map((p) => <span key={p.tone} className="wl-pill wi-pill" data-tone={p.tone}>{p.word}</span>)}
        <SpecLink href={programme?.specHref ?? null} programme={name} className="wi-spec" />
      </div>
      <div className="wi-detail">
        <div className="wi-card">
          {/* The kind chip and the item's number beside it (D-8194). */}
          <span className="wi-tag">
            <span className="wl-kind wi-kind">{KIND_WORD[item.kind]}</span>
            <span className="wi-num">{itemNumber(item)}</span>
          </span>
          <h1 className="wi-what"><Linked text={item.title} homeProject={home} /></h1>
          <section>
            <h3 className="wi-h">Why</h3>
            <p className="wi-text"><Linked text={item.why} homeProject={home} /></p>
          </section>
          {item.how.length > 0 && (
            <section>
              <h3 className="wi-h">How</h3>
              <ol className="wi-steps" aria-label="How">{item.how.map((s, i) => <li key={`${i}:${s}`}><Linked text={s} homeProject={home} /></li>)}</ol>
            </section>
          )}
          <section>
            <h3 className="wi-h">History</h3>
            <History item={item} now={now} homeProject={home} />
          </section>
        </div>
        <Panel item={item} programmeLive={programmeLive} onTick={onTick} onDismiss={onDismiss} current={current} runs={runs} acts={acts}
               {...(saveSecret === undefined ? {} : { saveSecret })} {...(removeSecret === undefined ? {} : { removeSecret })}
               {...(stepUpDeps === undefined ? {} : { stepUpDeps })}
               {...(authStatus === undefined ? {} : { authStatus })} />
      </div>
      {sheets}
    </div>
  );
}
