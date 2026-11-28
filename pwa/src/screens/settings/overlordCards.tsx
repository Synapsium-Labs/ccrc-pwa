// Settings › Overlord's cards (Overlord W1 home C, Task 8; plan `w1-home.md` Task 8): the Overlord (Retire), the model class, the
// account set, the renewal backstop and the response retention. Ring L4, context K (a settings screen): every card reads the
// store or its own read and asks `overlordSettingsWords.ts` (L1) what to say; it decides nothing.
//
// EVERY DOOR IS SENT, NEVER JUDGED (the brief's ruling 1). A card runs its act once through the section's one step-up
// (`stepUp.runAct`): a door that asks for the step answers `step-up-required`, the section's one `ConfirmItsYou` is drawn in that
// card, and the operator presses the act again. A door that asks nothing lands in one tap, because nothing here asks for a step.
// Every refusal is drawn by its word's sentence (`overlordSettingsRefusalText`), and a 401 is left to the sign-in screen. After
// any answer the card reads again: the designation cards through `refreshOverlord`, the others their own read.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, RadioFieldset, Section, Select, TextInput } from '@ccrc/ui';
import type { OverlordModelClass } from '../../../../shared/overlord-designation';
import type { StepUp } from '../../accounts/useStepUp';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { ApiError, api, overlordSettingsRefusalText, type OverlordSettingsAct } from '../../lib/api';
import { poolOptions } from '../../lib/pools';
import { navigate } from '../../lib/router';
import { placePath } from '../../lib/routes';
import { AccountSetFieldset } from '../../overlord/AccountSetFieldset';
import {
  BACKSTOP_HOURS, OVERLORD_SETTINGS_WORDS as W, accountSetAnswerWords, backstopOf, backstopWords, bindingWordOf, editedSetOf,
  hourLabel, modelAnswerWords, retentionChoicesOf, retentionOf, retentionWords, retireAnswerOf, retireOffered, retireWords,
  sameSet, setBoxesOf, storeAnswered, zoneChoicesOf, type BackstopView, type OverlordGate, type RetentionView,
} from '../../overlord/overlordSettingsWords';
import { MODEL_CLASS_OPTIONS } from '../../overlord/placeWords';
import { nextReadState, type ReadOutcome } from '../../overlord/readOutcome';
import type { ReadState } from '../../overlord/readState';
import { refreshOverlord } from '../../stores/overlord';
import { useFleetStore } from '../../stores/fleet';

const CARDS = SETTINGS_CARDS.overlord;

/** The act a card hands the section with its `step-up-required`, for the confirm to send once more (review 4139 F1, ruled call
 *  1876): `act` names it, so the mark is per act, and the retry's answer is worded for that act. A card makes it at its own level,
 *  outside every send, so the closure the section keeps while the step shows can reach no value a send read (review 4167 F1, held
 *  by `settings-retry-census.test.ts`). */
export interface StepRetry { readonly act: string; readonly send: () => void }

/** What every card is handed by the section: the one step-up, which card asked for it last, and the designation's gate. */
export interface SectionCtx {
  readonly stepUp: StepUp;
  readonly gate: OverlordGate;
  /** The section's one `ConfirmItsYou`, drawn by the card whose act was refused `step-up-required`, or null in every other. */
  readonly confirmFor: (card: string) => ReactNode;
  /** Shows the step in `card` (null hides it). With `retry`, the confirm sends that act once more by itself: that send is the
   *  retry, and a press by the operator is always a first send. Any other `ask` drops a retry not yet sent. */
  readonly ask: (card: string | null, retry?: StepRetry) => void;
  /** Whether `card`'s step is showing. A card that hands a retry holds itself whole while it does, every input and every act
   *  (review 4167 F2, F3, ruled call 1930), so nothing typed or pressed meets the retry; another card's answer frees it. */
  readonly held: (card: string) => boolean;
}

/** A Settings door's refusal in words, for a card's act: the store's answer decides how `not-found` reads (plan question 3). */
export const settingsRefusal = (ctx: SectionCtx, act: OverlordSettingsAct) => (err: unknown): string =>
  overlordSettingsRefusalText(err, act, storeAnswered(ctx.gate));

/** One card's door: one act at a time, its answer's words, its refusal's sentence (`refuse`, the door's own reader), and a read
 *  after every answer. */
export function useCardDoor(ctx: SectionCtx, card: string, refuse: (err: unknown) => string) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The reader as of the newest render, so a refusal is read against the store as it stands when the answer arrives, not as it
  // stood when the act was pressed (a `not-found` after the store went unmeasured is not "no designation row").
  const refuseNow = useRef(refuse);
  refuseNow.current = refuse;
  /** `after` runs after every answer, a refusal and a step-up included, and is told which, with the refusal's error: a card keeps
   *  the operator's picks unless the door answered, so pressing the act again after the step sends the same act. `retry`, when
   *  given, is handed to the section with a `step-up-required`, and the confirm sends it (`SectionCtx.ask`). */
  const run = async (
    call: () => Promise<unknown>, words: (answer: unknown) => readonly string[],
    after: (outcome: 'done' | 'step-up' | 'refused', err?: unknown) => Promise<unknown> | void,
    retry?: StepRetry,
  ): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaid([]);
    setRefusal(null);
    let outcome: 'done' | 'step-up' | 'refused' = 'refused';
    let failure: unknown;
    try {
      let answer: unknown;
      outcome = await ctx.stepUp.runAct(async () => { answer = await call(); });
      if (outcome === 'step-up') ctx.ask(card, retry);
      else if (mounted.current) { ctx.ask(null); setSaid(words(answer)); }
    } catch (err) {
      failure = err;
      if (!(err instanceof ApiError && err.status === 401) && mounted.current) setRefusal(refuseNow.current(err));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      await after(outcome, failure);
    }
  };
  return { busy, said, refusal, run };
}

/** A card's answer lines and refusal, in one place under its controls. */
export function DoorLines({ said, refusal, card }: { readonly said: readonly string[]; readonly refusal: string | null; readonly card: string }): ReactNode {
  return (
    <>
      {said.length > 0 && (
        <ul className="ovs-said" role="status" data-settings-said={card}>
          {said.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      {refusal !== null && <p className="ovs-refusal" role="alert" data-settings-refusal={card}>{refusal}</p>}
    </>
  );
}

/** The gate's sentence for a card that acts on the designation, or null when it has a row to act on. */
function GateLine({ gate, card }: { readonly gate: OverlordGate; readonly card: string }): ReactNode {
  const text = gate.kind === 'absent' ? W.absent : gate.kind === 'loading' ? W.loading : gate.kind === 'unmeasured' ? W.unmeasured(gate.error)
    : gate.kind === 'none' ? W.none : null;
  const stale = gate.kind === 'row' || gate.kind === 'none' ? gate.staleAt : null;
  return (
    <>
      {text !== null && <p className="ovs-note" role="status" data-settings-gate={`${card}:${gate.kind}`}>{text}</p>}
      {stale !== null && <p className="ovs-note" data-settings-stale={card}>{W.stale(stale)}</p>}
    </>
  );
}

const goPlace = (): void => navigate(placePath('overlord'));

// ── The Overlord: its state, the place's link, and Retire ──

export function DesignationCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const door = useCardDoor(ctx, 'designation', settingsRefusal(ctx, 'retire'));
  const g = ctx.gate;
  return (
    <Section level={3} scope={CARDS.designation.scope} title={CARDS.designation.title} purpose={CARDS.designation.purpose} data-settings-card="designation">
      <GateLine gate={g} card="designation" />
      {g.kind === 'none' && (
        <div className="ovs-actions">
          <Button variant="primary" size="fit" data-settings-control="start-on-place" onClick={goPlace}>{W.startOnPlace}</Button>
        </div>
      )}
      {g.kind === 'row' && (
        <>
          <p className="ovs-note" data-settings-binding>{bindingWordOf(g.row)}</p>
          {g.row.stopsOwed.length > 0 && <p className="ovs-note" data-settings-owed>{W.owedStops(g.row.stopsOwed)}</p>}
          <div className="ovs-actions">
            <Button variant="ghost" size="fit" data-settings-control="open-place" onClick={goPlace}>
              {g.row.bound !== null ? W.rebindOnPlace : W.openPlace}
            </Button>
            {retireOffered(g.row) && (
              <Button
                variant="danger-ghost" size="fit" data-settings-control="retire" disabled={door.busy}
                onClick={() => { void door.run(() => api.overlordRetire(), (a) => retireWords(retireAnswerOf(a)), refreshOverlord); }}
              >
                {door.busy ? W.retiring : W.retire}
              </Button>
            )}
          </div>
        </>
      )}
      {ctx.confirmFor('designation')}
      <DoorLines said={door.said} refusal={door.refusal} card="designation" />
    </Section>
  );
}

// ── The model class ──

export function ModelCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const door = useCardDoor(ctx, 'model', settingsRefusal(ctx, 'model'));
  const [pick, setPick] = useState<OverlordModelClass | null>(null);
  const g = ctx.gate;
  const saved = g.kind === 'row' ? g.row.model : null;
  const value = pick ?? saved;
  return (
    <Section level={3} scope={CARDS.model.scope} title={CARDS.model.title} purpose={CARDS.model.purpose} data-settings-card="model">
      <GateLine gate={g} card="model" />
      {g.kind === 'row' && value !== null && (
        <>
          <RadioFieldset
            legend={W.modelLegend} name="settings-overlord-model" options={MODEL_CLASS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={value} onPick={setPick} disabled={door.busy}
          />
          <p className="ovs-note">{W.modelLater}</p>
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="model-save" disabled={door.busy || value === saved}
              onClick={() => { void door.run(() => api.overlordModel(value), modelAnswerWords, async (o) => { if (o === 'done') setPick(null); await refreshOverlord(); }); }}
            >
              {door.busy ? W.saving : W.save}
            </Button>
          </div>
        </>
      )}
      {ctx.confirmFor('model')}
      <DoorLines said={door.said} refusal={door.refusal} card="model" />
    </Section>
  );
}

// ── The account set ──

export function AccountSetCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const door = useCardDoor(ctx, 'account-set', settingsRefusal(ctx, 'account-set'));
  const roster = useFleetStore((s) => s.roster);
  const accountsHeard = useFleetStore((s) => s.accountsHeard);
  const options = useMemo(() => poolOptions(roster), [roster]);
  const [picks, setPicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const g = ctx.gate;
  const saved = g.kind === 'row' ? g.row.accountPools : null;
  const after = async (o: 'done' | 'step-up' | 'refused'): Promise<void> => { if (o === 'done') setPicks(new Map()); await refreshOverlord(); };
  return (
    <Section level={3} scope={CARDS.accountSet.scope} title={CARDS.accountSet.title} purpose={CARDS.accountSet.purpose} data-settings-card="account-set">
      <GateLine gate={g} card="account-set" />
      {saved !== null && (() => {
        const edited = editedSetOf(saved, options, picks);
        // Start's empty-set gate does not govern this card (review 4056 F8, ruled): the card edits the saved set and the door
        // decides, saving an empty set with its warning while nothing is bound. Only the roster gates it: the options are not
        // known before the accounts are heard.
        const flip = (key: string) => (on: boolean): void => setPicks((cur) => new Map(cur).set(key, on));
        return (
          <>
            <AccountSetFieldset
              legend={W.setLegend} disabled={door.busy || !accountsHeard} marker="data-settings-account-set"
              boxes={setBoxesOf(saved, options, accountsHeard).map((b) => ({
                key: b.key,
                label: b.pool === null ? W.untagged : b.rostered === false ? W.notRostered(b.pool) : b.pool,
                on: b.pool === null ? edited.untagged : edited.pools.includes(b.pool),
                set: flip(b.key),
              }))}
            />
            {!accountsHeard && <p className="ovs-note" role="status" data-settings-set-wait="waiting">{W.waitsForAccounts}</p>}
            <div className="ovs-actions">
              <Button
                variant="primary" size="fit" data-settings-control="set-save" disabled={door.busy || !accountsHeard || sameSet(edited, saved)}
                onClick={() => { void door.run(() => api.overlordAccountSet(edited), accountSetAnswerWords, after); }}
              >
                {door.busy ? W.saving : W.save}
              </Button>
              <Button
                variant="ghost" size="fit" data-settings-control="set-save-again" disabled={door.busy}
                onClick={() => { void door.run(() => api.overlordAccountSet(saved), accountSetAnswerWords, after); }}
              >
                {W.saveAgain}
              </Button>
            </div>
            <p className="ovs-note">{W.saveAgainWhy}</p>
          </>
        );
      })()}
      {ctx.confirmFor('account-set')}
      <DoorLines said={door.said} refusal={door.refusal} card="account-set" />
    </Section>
  );
}

// ── A card's own read ──

/** One card's own read, kept as a `ReadState` through the store's L1 rule (`nextReadState`), so the card's absent, unread and
 *  stale states are the same five the Overlord store keeps. `parse` is the answer's one reader. With `detailOf`, an answer
 *  `parse` refuses keeps the reader's own words (`unreadable`, null after any other outcome): a card says what a Read again
 *  cannot cure (review 4139 F4). */
export function useCardRead<T>(call: () => Promise<unknown>, parse: (body: unknown) => T | null, detailOf?: (body: unknown) => string | null) {
  const [read, setRead] = useState<ReadState<T>>({ state: 'loading' });
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const seq = useRef(0);
  const outcomeOf = (body: unknown): { o: ReadOutcome<T>; why: string | null } => {
    if (typeof body === 'object' && body !== null && (body as { absent?: unknown }).absent === true) return { o: { kind: 'absent' }, why: null };
    const v = parse(body);
    if (v !== null) return { o: { kind: 'value', value: v }, why: null };
    return { o: { kind: 'failed', error: 'unreadable answer' }, why: detailOf === undefined ? null : (detailOf(body) ?? 'unreadable answer') };
  };
  const keep = (r: { o: ReadOutcome<T>; why: string | null }): void => {
    setUnreadable(r.why);
    setRead((prev) => nextReadState(prev, r.o, Date.now()));
  };
  const reread = async (): Promise<void> => {
    const mine = ++seq.current;
    const r = await call().then(outcomeOf, (err: unknown) => ({
      o: { kind: 'failed', error: err instanceof ApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err) } as ReadOutcome<T>,
      why: null,
    }));
    if (mine === seq.current) keep(r);
  };
  /** A door's answer that carries the read's own view: kept as the read's answer, as a fresh read would be. */
  const put = (body: unknown): void => { const r = outcomeOf(body); seq.current++; keep(r); };
  /** A door's answer that carries part of the view (a row's side, plan SQ4): installed over the value held, as an answer. A read
   *  with no value yet is left as it is; the card reads again after every answer anyway. */
  const patch = (f: (value: T) => T): void => {
    seq.current++;
    setRead((prev) => (prev.state === 'answered' || prev.state === 'stale'
      ? nextReadState(prev, { kind: 'value', value: f(prev.value) }, Date.now()) : prev));
  };
  // Once, on mount: the card's one read. A door's answer that carries the view goes through `put`, and Read again through `reread`.
  useEffect(() => { void reread(); }, []);
  return { read, reread, put, patch, unreadable };
}

/** A note and the controls that act on it, in one row: a read's failure and its Read again, and (W2 Settings) a held row and its
 *  Resume, an offered line and its Approve. `data` names the row for its tests. */
export function NoteRow({ note, status = false, data, children }: {
  readonly note: string; readonly status?: boolean; readonly data: Readonly<Record<`data-${string}`, string>>; readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className="ovs-actions" {...data}>
      <p className="ovs-note" {...(status ? { role: 'status' } : {})}>{note}</p>
      {children}
    </div>
  );
}

/** One labelled field of a card: its label above its control. */
export function CardField({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <label className="ovs-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A read that failed, or is still loading, with its Read again. Shared by every card with its own read (the W2 Settings cards
 *  included). `unreadable`, when given, is the sentence for an answer this console cannot read: it is drawn with Reload in place
 *  of a Read again that cannot cure it (review 4139 F4). */
export function ReadLine({ read, unread, card, reread, unreadable = null }: {
  readonly read: ReadState<unknown>; readonly unread: (error: string) => string; readonly card: string; readonly reread: () => void;
  readonly unreadable?: { readonly sentence: string; readonly reload: string } | null;
}): ReactNode {
  if (read.state === 'loading') return <p className="ovs-note" role="status">{W.loading}</p>;
  if (read.state !== 'unmeasured' && read.state !== 'stale') return null;
  const said = unreadable === null ? unread(read.error) : unreadable.sentence;
  return (
    <NoteRow note={read.state === 'stale' ? `${said} ${W.stale(read.at)}` : said} status data={{ 'data-settings-unread': card }}>
      {unreadable === null
        ? <Button variant="ghost" size="fit" onClick={reread}>{W.readAgain}</Button>
        : <Button variant="ghost" size="fit" data-settings-control={`${card}-reload`} onClick={() => window.location.reload()}>{unreadable.reload}</Button>}
    </NoteRow>
  );
}

export const valueOf = <T,>(r: ReadState<T>): T | null => (r.state === 'answered' || r.state === 'stale' ? r.value : null);

// ── The renewal backstop ──

/** The browser's own zone list, or null where it has none (`Intl.supportedValuesOf`). */
const browserZones = (): readonly string[] | null => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try { return typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : null; } catch { return null; }
};

export function BackstopCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const { read, reread, put } = useCardRead<BackstopView>(() => api.renewalBackstop(), backstopOf);
  const door = useCardDoor(ctx, 'backstop', settingsRefusal(ctx, 'backstop'));
  const [hour, setHour] = useState<number | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  if (read.state === 'absent') return null;
  const v = valueOf(read);
  const h = hour ?? v?.hour ?? null;
  const z = zone ?? v?.zone ?? null;
  const zones = zoneChoicesOf(browserZones(), z);
  return (
    <Section level={3} scope={CARDS.backstop.scope} title={CARDS.backstop.title} purpose={CARDS.backstop.purpose} data-settings-card="backstop">
      <ReadLine read={read} unread={W.backstopUnread} card="backstop" reread={() => { void reread(); }} />
      {v !== null && h !== null && z !== null && (
        <>
          <p className="ovs-note" data-settings-backstop>{backstopWords(v)}</p>
          <div className="ovs-fields">
            <label className="ovs-field">
              <span>{W.hourLabel}</span>
              <Select value={String(h)} onChange={(e) => setHour(Number(e.currentTarget.value))} disabled={door.busy} data-settings-input="hour">
                {BACKSTOP_HOURS.map((x) => <option key={x} value={x}>{hourLabel(x)}</option>)}
              </Select>
            </label>
            <label className="ovs-field">
              <span>{W.zoneLabel}</span>
              {zones === null ? (
                <TextInput value={z} onChange={(e) => setZone(e.currentTarget.value)} disabled={door.busy} data-settings-input="zone" />
              ) : (
                <Select value={z} onChange={(e) => setZone(e.currentTarget.value)} disabled={door.busy} data-settings-input="zone">
                  {zones.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              )}
            </label>
          </div>
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="backstop-save" disabled={door.busy || (h === v.hour && z === v.zone)}
              onClick={() => {
                void door.run(async () => { const a = await api.setRenewalBackstop({ hour: h, zone: z }); put(a); return a; }, () => [W.saved], (o) => { if (o === 'done') { setHour(null); setZone(null); } });
              }}
            >
              {door.busy ? W.saving : W.save}
            </Button>
          </div>
        </>
      )}
      {ctx.confirmFor('backstop')}
      <DoorLines said={door.said} refusal={door.refusal} card="backstop" />
    </Section>
  );
}

// ── The response retention ──

export function RetentionCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const { read, reread, put } = useCardRead<RetentionView>(() => api.responseRetention(), retentionOf);
  const door = useCardDoor(ctx, 'retention', settingsRefusal(ctx, 'retention'));
  const [days, setDays] = useState<number | null>(null);
  if (read.state === 'absent') return null;
  const v = valueOf(read);
  const d = days ?? v?.days ?? null;
  return (
    <Section level={3} scope={CARDS.retention.scope} title={CARDS.retention.title} purpose={CARDS.retention.purpose} data-settings-card="retention">
      <ReadLine read={read} unread={W.retentionUnread} card="retention" reread={() => { void reread(); }} />
      {v !== null && (
        <>
          <p className="ovs-note" data-settings-retention>{retentionWords(v)}</p>
          <div className="ovs-fields">
            <label className="ovs-field">
              <span>{W.daysLabel}</span>
              <Select
                value={d === null ? '' : String(d)} onChange={(e) => setDays(Number(e.currentTarget.value))} disabled={door.busy}
                data-settings-input="days"
              >
                {d === null && <option value="" disabled>{'—'}</option>}
                {retentionChoicesOf(v).map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </label>
          </div>
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="retention-save" disabled={door.busy || d === null || (v.days !== null && d === v.days)}
              onClick={() => {
                if (d === null) return;
                void door.run(async () => { const a = await api.setResponseRetention(d); put(a); return a; }, () => [W.saved], (o) => { if (o === 'done') setDays(null); });
              }}
            >
              {door.busy ? W.saving : W.save}
            </Button>
          </div>
        </>
      )}
      {ctx.confirmFor('retention')}
      <DoorLines said={door.said} refusal={door.refusal} card="retention" />
    </Section>
  );
}
